# 13 — Security

> **Status**: normative · **Owner**: project lead · **Last revised**: 2026-05-20

The security model. What's protected, what isn't, and the small set of controls that keep this hobby project from becoming a viral cost-bomb or data leak.

---

## Table of Contents

1. [Threat model](#threats)
2. [IAM bindings](#iam)
3. [Secrets handling](#secrets)
4. [CORS](#cors)
5. [App Check (deferred)](#app-check)
6. [Input validation](#input)
7. [Data retention & privacy](#privacy)
8. [Incident response](#incident)

---

<a id="threats"></a>

## 1. Threat model

Mirror Realm has no user accounts, no personal data storage, no payments. The realistic threats are:

| Threat | Likelihood | Mitigation |
|---|---|---|
| **Cost exhaustion** — someone scripts requests against `/api/analyze` to drain our Gemini budget | Medium | Cost-guard caps (300 calls/day, $1/day) + GCP budget kill-switch ($15/month). The kill switch is the hard backstop. |
| **Photo upload abuse** — submitting offensive imagery hoping it gets onto Daily World | Low | Vertex AI safety filter at the model layer + manual review queue (operator decides what gets promoted; daily-rotate config can require admin approval) |
| **Service account key leak** | Very low | No service account keys are generated. Workload identity only. |
| **CSRF / XSS** | Low | No auth state to abuse. CSP header denies inline scripts. No user-generated HTML rendered. |
| **Open redirect** | N/A | We only redirect within our own origin. |
| **Firestore data leakage to client** | Low | Security rules deny all client access; only Cloud Run SA has access via workload identity |
| **Bot scraping Daily World** | Low impact | Read-only data, no PII. Cache-Control offloads to CDN. |
| **Replay of OIDC token from Scheduler** | Negligible | OIDC tokens are short-lived; audience-pinned to our Cloud Run URL |

We are NOT trying to defend against:
- Nation-state attackers
- Sophisticated traffic-shaping abuse beyond what budget caps can handle
- A friend who knows the device hash trick and submits 6 levels a day (rate limits are convenience, not security)

<a id="iam"></a>

## 2. IAM bindings

Two service accounts. Principle of least privilege.

### `mirror-realm-runtime`

The Cloud Run service runs as this SA. Used by the API to call all downstream GCP APIs.

| Role | Why |
|---|---|
| `roles/secretmanager.secretAccessor` (scoped to `mirror-realm-gemini-api-key`) | Read the Gemini API key at startup |
| `roles/datastore.user` | Read/write Firestore |
| `roles/storage.objectAdmin` | Read/write `mirror-realm-blobs` bucket (no other buckets) |
| `roles/cloudtrace.agent` | Emit traces |
| `roles/logging.logWriter` | Write logs |
| `roles/billing.projectManager` | Used **only** by the kill-switch CF (which runs as this SA); revoke if/when we split out a separate kill-switch SA |

**Not** granted:
- `roles/owner`, `roles/editor` — too broad
- `roles/iam.*` — runtime should not modify other SAs

### `mirror-realm-scheduler`

The Cloud Scheduler job runs as this SA. Its only job is to OIDC-auth into `/api/daily-rotate`.

| Role | Why |
|---|---|
| `roles/run.invoker` (scoped to `mirror-realm-api`) | Authenticate into the rotate endpoint |

That's it. No Firestore, no Vertex. The Scheduler SA cannot do anything if leaked beyond firing daily-rotate calls.

### Locking in

`infra/grant-iam.sh` is idempotent — running it twice produces no changes. Use it after IAM updates instead of typing commands by hand. See [`11-deployment-guide.md#iam`](./11-deployment-guide.md#iam).

<a id="secrets"></a>

## 3. Secrets handling

> _Changed: 2026-05-22 — Gemini inference now authenticates with an AI Studio API key
> (`MR_GEMINI_API_KEY`) instead of Vertex workload identity. The key is the project's
> one real secret: stored in Secret Manager (`mirror-realm-gemini-api-key`), injected
> into Cloud Run at deploy time via `--set-secrets`, and read from `apps/api/.env`
> locally. It is **never** committed and **never** shipped in the web bundle._

We have exactly **one** secret: the Gemini API key.

- **Gemini API key** → Secret Manager secret `mirror-realm-gemini-api-key`, mounted as
  the `MR_GEMINI_API_KEY` env var on Cloud Run. The runtime SA holds
  `roles/secretmanager.secretAccessor` on that secret only. Locally it lives in the
  git-ignored `apps/api/.env`.
- **No DB credentials.** Firestore auth is workload identity (Cloud Run) / ADC (local).
- **No API keys in the browser.** The PWA only talks to the Cloud Run URL.
- **No tokens stored at rest.** OIDC tokens are minted per-request by Cloud Scheduler and discarded.

What we **do** treat carefully:

> _Changed: 2026-05-21 — CI/CD is Cloud Build (in-project), so there is no GitHub→GCP federation or long-lived deploy key to manage._

- **Cloud Build runs in-project** as the Cloud Build service account (`<PROJECT_NUMBER>@cloudbuild.gserviceaccount.com`), scoped to push to Artifact Registry, deploy Cloud Run, and act as the runtime SA ([`11-deployment-guide.md#deploy-api-first`](./11-deployment-guide.md)). No exported keys.
- **Firebase Hosting deploy** uses an SA with `roles/firebasehosting.admin` (or a local `firebase login`); no token is committed.

If a future feature needs a real secret (e.g. a third-party API key), it goes in Google Secret Manager and is fetched at runtime by the Cloud Run SA. **Never** in env vars on Cloud Run for the prod project.

<a id="cors"></a>

## 4. CORS

CORS is the **only** mechanism keeping a malicious origin from calling our API from a user's browser. It is not auth — it doesn't stop server-to-server calls or scripted curls. For those, budget caps + rate limits do the heavy lifting.

```python
# apps/api/app/main.py (excerpt)
# docs: 13-security.md#cors
from fastapi.middleware.cors import CORSMiddleware
from .settings import settings

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,             # exact match, no wildcards
    allow_credentials=False,                         # we use no cookies/credentials
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Mr-Device-Hash"],
    max_age=600,
)
```

Allowlist (typical prod set — fill in from `MR_CORS_ORIGINS`):

- `https://<your-project-id>.web.app` — your Firebase Hosting origin
- `http://localhost:5173` — local dev (REMOVE from prod when paranoid)
- Custom domain if/when added

Anything else gets a CORS preflight rejection. **No `*` wildcard ever.**

<a id="app-check"></a>

## 5. App Check (deferred)

[Firebase App Check](https://firebase.google.com/docs/app-check) attests that a request actually originated from our PWA. It would close the gap between "CORS thinks you're our origin" and "you really are our PWA."

We **defer** App Check to a post-v1 hardening pass for these reasons:
- It adds a Recaptcha v3 token to every request (small UX hit).
- Our budget kill-switch already caps the worst-case cost from abuse.
- It complicates local dev (need to disable for `localhost`).

Add it before opening to any non-friend distribution. Spec entry to be added in this section when implemented.

<a id="input"></a>

## 6. Input validation

Every untrusted byte is validated.

| Boundary | Validation |
|---|---|
| HTTP request body | Pydantic with `extra="forbid"` |
| Photo bytes | Pillow loads + validates → image bytes; size limit 200KB; MIME `image/jpeg` only |
| Level produced by agent | Pydantic + domain invariants + reachability ([`04-domain-model.md#invariants`](./04-domain-model.md#invariants)) |
| Level submitted by client | Same as above. Defense in depth — we don't trust the client even if it claims to be our PWA. |
| Hash path param | Regex `^[a-zA-Z0-9]{6,7}$` |
| QR-decoded text on client | TS type guards + try/catch on lz-string + Pydantic-equivalent runtime check via `@cfworker/json-schema` or hand-written |

What we never do:
- `eval` on any input
- `JSON.parse` without a try/catch and shape check
- String concatenation into Firestore paths (we use the client library's collection/document methods)
- `subprocess` with shell=True

<a id="privacy"></a>

## 7. Data retention & privacy

| Data | Where stored | Retention |
|---|---|---|
| The photo bytes | NOWHERE — processed in memory, dropped after agent call | 0 (in memory only) |
| Level JSON (shared via /l/) | Firestore `levels/` | 30 days (TTL) |
| Submission JSON | Firestore `submissions/` | 30 days or until promoted |
| Daily archive | Firestore `daily/{date}` | Forever (small, ~1KB/day → ~365KB/year) |
| Device hash | Firestore `costGuard/{date}.submissionsByDevice` | Per-day; falls off as costGuard doc expires (90 days TTL) |
| Logs & traces | Cloud Logging / Trace | Default GCP retention (30 days logs, 30 days traces) |

We do not collect:
- IP addresses (well, Cloud Run logs do — that's GCP's default; we don't read them)
- User-Agent strings (Cloud Run records them, we don't analyze)
- Geolocation
- Any personally identifying data

`deviceHash` is a randomly generated 16-byte hex string created in IndexedDB. It is not derived from anything device-specific. Users can clear it by clearing site data.

### Privacy statement

The repo's `apps/web/public/privacy.html` is the customer-facing version. Keep it short, accurate, and aligned with the table above.

<a id="incident"></a>

## 8. Incident response

If something goes wrong:

| Incident | First step | Recovery |
|---|---|---|
| Bill spiked unexpectedly | Check Billing → Reports for which service. Kill-switch should have fired. | If not fired, manually disable billing on the project. Investigate cost-guard logic. |
| API returning 5xx broadly | `gcloud run services logs tail mirror-realm-api`; check Trace for failing spans | Roll back: [`11-deployment-guide.md#rollback`](./11-deployment-guide.md#rollback) |
| Daily World shows offensive content | Open Firestore Console; delete `daily/today`; run `gcloud scheduler jobs run daily-rotate` to repopulate from queue (after vetting queue) | Long-term: add manual approval to daily-rotate (post-v1) |
| Suspected SA leak | Disable the SA, create a new one, redeploy services with `--service-account`; audit Cloud Audit Logs | See `roles/cloudasset.viewer` for forensic queries |
| Cost-guard / kill-switch bug | Manually set the budget to $0 in Billing → Budgets to halt new spend | Fix the bug, restore budget |
| Schema-breaking change deployed by accident | Roll back the API; if levels were saved against the new schema, bulk-delete them via gcloud firestore | See [`11-deployment-guide.md#rollback`](./11-deployment-guide.md#rollback) |

There is no on-call rotation. This is a personal project. The "incident response" is: the project owner gets the email, opens the console, fixes it within a reasonable time, posts a one-line note in the commit log if it required a code change.

---

_End of 13 — Security._
