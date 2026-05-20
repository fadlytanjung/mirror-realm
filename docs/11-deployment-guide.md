# 11 — Deployment Guide

> **Status**: normative · **Owner**: project lead · **Last revised**: 2026-05-20

How to go from a fresh GCP account to a live deployment, and how to ship updates after that. All commands are copy-pasteable. Anything that diverges from this doc means a docs commit is owed in the same change.

For the conceptual GCP overview, see [`GCP-Infrastructure-Guide.md`](../GCP-Infrastructure-Guide.md). This doc is the operational checklist with Mirror Realm specifics baked in.

---

## Table of Contents

1. [GCP project bootstrap (one time)](#bootstrap)
2. [Service account + IAM (one time)](#iam)
3. [Firestore setup (one time)](#firestore)
4. [First deploy of `apps/api`](#deploy-api-first)
5. [First deploy of `apps/web`](#deploy-web-first)
6. [Cloud Scheduler job](#scheduler)
7. [Billing budget + kill switch](#budget)
8. [Subsequent deploys (CI)](#ci)
9. [Rollback](#rollback)
10. [Custom domain (optional)](#domain)

---

<a id="bootstrap"></a>

## 1. GCP project bootstrap (one time)

```bash
# Variables — change these once, paste everywhere.
export PROJECT_ID="mirror-realm-prod"
export REGION="asia-southeast2"
export BILLING_ACCOUNT_ID="<your billing account>"   # gcloud billing accounts list

# Create project
gcloud projects create "${PROJECT_ID}" \
  --name="Mirror Realm Production"

# Link billing
gcloud billing projects link "${PROJECT_ID}" \
  --billing-account="${BILLING_ACCOUNT_ID}"

# Activate
gcloud config set project "${PROJECT_ID}"

# Enable APIs
gcloud services enable \
  run.googleapis.com \
  aiplatform.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  cloudscheduler.googleapis.com \
  cloudbuild.googleapis.com \
  cloudtrace.googleapis.com \
  cloudbilling.googleapis.com \
  pubsub.googleapis.com \
  cloudfunctions.googleapis.com
```

<a id="iam"></a>

## 2. Service account + IAM (one time)

Two service accounts: one for the API (`-runtime`), one for the Scheduler caller (`-scheduler`).

```bash
# Runtime SA — Cloud Run runs as this; calls Vertex/Firestore
gcloud iam service-accounts create mirror-realm-runtime \
  --display-name "Mirror Realm runtime"

# Scheduler SA — used by Cloud Scheduler to OIDC-auth into the rotate endpoint
gcloud iam service-accounts create mirror-realm-scheduler \
  --display-name "Mirror Realm scheduler"

# IAM bindings for runtime SA
for ROLE in \
  roles/aiplatform.user \
  roles/datastore.user \
  roles/storage.objectAdmin \
  roles/cloudtrace.agent \
  roles/logging.logWriter ; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member "serviceAccount:mirror-realm-runtime@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role "${ROLE}"
done

# Allow scheduler SA to invoke the Cloud Run service (added AFTER first deploy)
# gcloud run services add-iam-policy-binding mirror-realm-api \
#   --member "serviceAccount:mirror-realm-scheduler@${PROJECT_ID}.iam.gserviceaccount.com" \
#   --role roles/run.invoker --region "${REGION}"
```

These bindings live as code in `infra/grant-iam.sh` — run that script instead of typing the commands by hand, and the script is the source of truth.

<a id="firestore"></a>

## 3. Firestore setup (one time)

```bash
# Create Firestore in Native mode in your region
gcloud firestore databases create \
  --location="${REGION}" \
  --type=firestore-native

# Apply security rules (deny-all client; SA full access)
gcloud firestore rules update infra/firestore.rules

# Apply composite indexes (the daily-rotate query needs one on submissions.createdAt asc)
gcloud firestore indexes composite create \
  --collection-group=submissions \
  --field-config field-path=createdAt,order=ascending \
  || echo "Index may already exist; safe to ignore on rerun"
```

### TTL policies

For automatic cleanup of expired levels + submissions:

```bash
# levels.ttl — auto-delete docs after 30 days
gcloud firestore fields ttls update ttl \
  --collection-group=levels \
  --enable-ttl

gcloud firestore fields ttls update ttl \
  --collection-group=submissions \
  --enable-ttl
```

The `ttl` field name in the Pydantic models matches the configured field — keep them in sync.

`infra/firestore.rules`:

```javascript
// infra/firestore.rules
// docs: 11-deployment-guide.md#firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Deny all client access. Only the Cloud Run service account (using
    // workload identity, bypasses these rules) can read/write.
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

<a id="deploy-api-first"></a>

## 4. First deploy of `apps/api`

The simplest path: build + deploy in one gcloud command via `--source` (Cloud Build under the hood).

```bash
# From repo root
gcloud run deploy mirror-realm-api \
  --source ./apps/api \
  --region "${REGION}" \
  --service-account "mirror-realm-runtime@${PROJECT_ID}.iam.gserviceaccount.com" \
  --allow-unauthenticated \
  --max-instances 5 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 60 \
  --concurrency 80 \
  --set-env-vars="MR_GCP_PROJECT=${PROJECT_ID},MR_GCP_LOCATION=${REGION},MR_GEMINI_MODEL=gemini-3.1-flash-lite,MR_CORS_ORIGINS=https://${PROJECT_ID}.web.app,MR_SCHEDULER_SA_EMAIL=mirror-realm-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
```

Once it returns, capture the URL:

```bash
export API_URL=$(gcloud run services describe mirror-realm-api \
  --region "${REGION}" --format='value(status.url)')
echo "API: ${API_URL}"
```

Now bind the scheduler SA as an invoker (from §2):

```bash
gcloud run services add-iam-policy-binding mirror-realm-api \
  --member "serviceAccount:mirror-realm-scheduler@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role roles/run.invoker --region "${REGION}"
```

Sanity:

```bash
curl -fsS "${API_URL}/healthz"        # → {"status":"ok"}
curl -fsS "${API_URL}/readyz"         # → {"status":"ok",...}
```

### `apps/api/Dockerfile` (the spec-side reference)

```dockerfile
# apps/api/Dockerfile
# docs: 11-deployment-guide.md#deploy-api-first
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy

WORKDIR /app

# uv for fast deps
RUN pip install --no-cache-dir uv==0.4.*

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY app ./app

EXPOSE 8080
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
```

<a id="deploy-web-first"></a>

## 5. First deploy of `apps/web`

```bash
# Build production bundle (Vite picks up VITE_API_BASE_URL from .env.production)
echo "VITE_API_BASE_URL=${API_URL}" > apps/web/.env.production
pnpm --filter web build

# Initialize Firebase Hosting (run once; --project flag skips interactive prompts)
firebase init hosting --project "${PROJECT_ID}"
# Configure: public dir = apps/web/dist, single-page rewrite = yes,
# additional rewrites for /p/* and /l/* both → /index.html

# Deploy
firebase deploy --only hosting --project "${PROJECT_ID}"
```

The hosted URL is `https://${PROJECT_ID}.web.app`. Open it on your iPhone (same Wi-Fi or LTE), tap the share icon → "Add to Home Screen".

### `infra/firebase.json` (the spec-side reference)

```json
{
  "hosting": {
    "public": "apps/web/dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [
      { "source": "/p/**", "destination": "/index.html" },
      { "source": "/l/**", "destination": "/index.html" },
      { "source": "**",    "destination": "/index.html" }
    ],
    "headers": [
      {
        "source": "/tilesets/**",
        "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
      },
      {
        "source": "/sfx/**",
        "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
      }
    ]
  }
}
```

<a id="scheduler"></a>

## 6. Cloud Scheduler job

Daily-rotate fires once per day at 00:00 UTC.

```bash
gcloud scheduler jobs create http daily-rotate \
  --location "${REGION}" \
  --schedule "0 0 * * *" \
  --time-zone "UTC" \
  --uri "${API_URL}/api/daily-rotate" \
  --http-method POST \
  --oidc-service-account-email "mirror-realm-scheduler@${PROJECT_ID}.iam.gserviceaccount.com" \
  --oidc-token-audience "${API_URL}" \
  --attempt-deadline "30s" \
  --max-retry-attempts 3 \
  --min-backoff "10s"
```

Manual trigger for testing:

```bash
gcloud scheduler jobs run daily-rotate --location "${REGION}"
```

Tail logs to verify:

```bash
gcloud run services logs tail mirror-realm-api --region "${REGION}"
```

### `infra/scheduler.yaml` (the spec-side declarative reference)

```yaml
# infra/scheduler.yaml
# docs: 11-deployment-guide.md#scheduler
name: daily-rotate
schedule: "0 0 * * *"
timeZone: UTC
description: Rotate Mirror Realm Daily World at 00:00 UTC.
httpTarget:
  uri: ${API_URL}/api/daily-rotate
  httpMethod: POST
  oidcToken:
    serviceAccountEmail: mirror-realm-scheduler@${PROJECT_ID}.iam.gserviceaccount.com
    audience: ${API_URL}
attemptDeadline: 30s
retryConfig:
  retryCount: 3
  minBackoffDuration: 10s
```

(Substituted via `envsubst` in `infra/deploy-scheduler.sh`.)

<a id="budget"></a>

## 7. Billing budget + kill switch

The non-negotiable safety net. See [`15-cost-and-limits.md`](./15-cost-and-limits.md) for the rationale; this section is the wiring.

```bash
# 1. Create a Pub/Sub topic that the budget alert publishes to.
gcloud pubsub topics create billing-alerts

# 2. Deploy the kill-switch Cloud Function (idempotent).
gcloud functions deploy disable-billing \
  --gen2 \
  --region "${REGION}" \
  --runtime python312 \
  --source ./infra/kill-switch \
  --entry-point handle_billing_alert \
  --trigger-topic billing-alerts \
  --service-account "mirror-realm-runtime@${PROJECT_ID}.iam.gserviceaccount.com"

# 3. Grant the runtime SA the role to disable billing on the project.
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member "serviceAccount:mirror-realm-runtime@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role roles/billing.projectManager
```

Then in the **Console** (no clean gcloud API as of writing):

1. Billing → Budgets & alerts → CREATE BUDGET
2. Name: `mirror-realm-monthly`
3. Scope: this project, all services
4. Budget amount: $15
5. Threshold rules: 50%, 90%, 100%, 120%
6. Actions → "Connect a Pub/Sub topic to this budget" → select `billing-alerts`
7. Save.

Test by manually publishing a 120%-threshold message to the topic. The kill switch should disable billing.

### `infra/kill-switch/main.py` (the spec-side reference)

```python
# infra/kill-switch/main.py
# docs: 11-deployment-guide.md#budget
import base64
import json
import os

from googleapiclient import discovery

PROJECT_ID = os.environ["GCP_PROJECT"]
KILL_AT_FRACTION = 1.0  # 100% of budget

def handle_billing_alert(event, _context):
    raw = base64.b64decode(event["data"]).decode("utf-8")
    msg = json.loads(raw)
    cost = float(msg.get("costAmount", 0))
    budget = float(msg.get("budgetAmount", 1))
    if cost < budget * KILL_AT_FRACTION:
        print(f"cost {cost} below threshold {budget * KILL_AT_FRACTION}; no action")
        return
    billing = discovery.build("cloudbilling", "v1", cache_discovery=False)
    project = f"projects/{PROJECT_ID}"
    billing.projects().updateBillingInfo(
        name=project,
        body={"billingAccountName": ""},
    ).execute()
    print(f"DISABLED billing for {project} at cost={cost} budget={budget}")
```

After this trips, re-enabling billing requires manual action in the Console — the function does not re-enable, by design.

<a id="ci"></a>

## 8. Subsequent deploys (CI)

`.github/workflows/deploy-prod.yml` runs on push to `main` (after PR review). Required environment secrets:

| Secret | Value |
|---|---|
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | OIDC provider resource name |
| `GCP_SERVICE_ACCOUNT` | A SA with `roles/run.admin` + `roles/iam.serviceAccountUser` on the runtime SA |
| `FIREBASE_TOKEN` | `firebase login:ci` output |

Workflow steps (skeleton):

```yaml
# .github/workflows/deploy-prod.yml
# docs: 11-deployment-guide.md#ci
name: deploy-prod
on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    environment: production       # requires manual approval
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm gen:check     # fails if generated files drift
      - run: pnpm typecheck
      - run: pnpm test
      - uses: astral-sh/setup-uv@v3
      - run: cd apps/api && uv sync --frozen && uv run pytest -q tests/unit
      - id: gcp-auth
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}
          service_account:           ${{ secrets.GCP_SERVICE_ACCOUNT }}
      - uses: google-github-actions/setup-gcloud@v2
      - name: Deploy API
        run: ./infra/deploy-api.sh
      - name: Build web
        run: pnpm --filter web build
      - name: Deploy web
        uses: w9jds/firebase-action@master
        with:
          args: deploy --only hosting --project mirror-realm-prod
        env:
          FIREBASE_TOKEN: ${{ secrets.FIREBASE_TOKEN }}
```

The deploys are independent — a hosting-only change does not redeploy the API.

<a id="rollback"></a>

## 9. Rollback

### API

Every Cloud Run deploy creates a new revision. To pin traffic to a previous revision:

```bash
# List revisions
gcloud run revisions list --service mirror-realm-api --region "${REGION}"

# Roll back to a known good one in five seconds
gcloud run services update-traffic mirror-realm-api \
  --to-revisions=mirror-realm-api-00012-abc=100 \
  --region "${REGION}"
```

### Web

Firebase Hosting keeps version history.

```bash
firebase hosting:channel:list --project "${PROJECT_ID}"
firebase hosting:rollback --project "${PROJECT_ID}"   # interactive picker
```

Or pin a specific version via the Console → Hosting → Release History → "Rollback".

### Schema breaks

If a deploy introduces a breaking change to `level.schema.json`, **rolling back the deploy is not enough** — already-shared `/p/<lz>` URLs may have been minted against the new schema. Mitigation:

- Always bump `schemaVersion` for breaking changes.
- The PWA's `play` route checks `level.schemaVersion` and refuses unsupported versions with a friendly error.

<a id="domain"></a>

## 10. Custom domain (optional)

If you want `mirror-realm.app` instead of `mirror-realm-prod.web.app`:

```bash
# Add custom domain in Firebase Console: Hosting → Add custom domain
# Firebase walks you through DNS verification (TXT record on the apex).

# For Cloud Run API behind the same domain:
firebase init hosting:channel    # not needed; rewrites already proxy /api/* (see firebase.json)
```

Update CORS:

```bash
gcloud run services update mirror-realm-api \
  --region "${REGION}" \
  --update-env-vars MR_CORS_ORIGINS="https://mirror-realm.app,https://${PROJECT_ID}.web.app,http://localhost:5173"
```

And update `apps/web/.env.production` to point at the new origin so the bundle calls the right `/api`. Note: if API is proxied through Firebase Hosting via rewrites, `VITE_API_BASE_URL=""` (same origin) is the cleanest setting.

---

_End of 11 — Deployment Guide._
