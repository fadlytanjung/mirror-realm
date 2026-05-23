# Running Mirror Realm — Step-by-Step Guide

A friendly, copy-paste guide to run Mirror Realm locally, test it on your iPhone, and
deploy it. For the deeper "why", see [`docs/10-local-development.md`](./docs/10-local-development.md)
and [`docs/11-deployment-guide.md`](./docs/11-deployment-guide.md).

> **Auth model (read this once):** Gemini uses an **AI Studio API key**
> (`MR_GEMINI_API_KEY`). Firestore uses your Google login (ADC locally, the runtime
> service account in the cloud). The only secret is the Gemini key — locally it lives
> in the git-ignored `apps/api/.env`; in the cloud it lives in Secret Manager.

---

## 0. What you need

| Thing | Notes |
|---|---|
| Node 20 + pnpm 9 | frontend |
| Python 3.12 + uv | backend |
| gcloud CLI (logged in) | Firestore + deploys |
| An AI Studio API key | get one at <https://aistudio.google.com/apikey> |
| Access to a GCP project | use your own project id everywhere below as `<your-project-id>` |

---

## 1. One-time GCP setup

Run these once per project. They are safe to re-run (idempotent), except creating the
Firestore database (its region is permanent).

```bash
PROJECT=<your-project-id>   # your GCP project id

# Log in and point ADC at the project (this is what Firestore uses locally)
gcloud auth login
gcloud config set project "$PROJECT"
gcloud auth application-default login
gcloud auth application-default set-quota-project "$PROJECT"

# Enable the APIs we use
gcloud services enable firestore.googleapis.com secretmanager.googleapis.com \
  run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  --project "$PROJECT"

# Create the Firestore database (region is PERMANENT — asia-southeast2 = Jakarta)
gcloud firestore databases create --location=asia-southeast2 --project "$PROJECT"

# Store your WHOLE prod .env (incl. MR_GEMINI_API_KEY) as ONE secret for cloud deploys.
# Prepare a prod.env first — set MR_ALLOW_UNAUTH_ROTATE=false and MR_CORS_ORIGINS_STR to
# https://<your-project-id>.web.app,https://<your-project-id>.firebaseapp.com
gcloud secrets create mirror-realm --replication-policy=automatic --project "$PROJECT"
gcloud secrets versions add mirror-realm --data-file=prod.env --project "$PROJECT"
```

> If the Firestore database and `mirror-realm` secret already exist for your project,
> you can skip those commands. Update config later with another `secrets versions add`.

---

## 2. Install + configure

```bash
pnpm install                       # JS deps
cd apps/api && uv sync && cd ../..  # Python deps

# Env files
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
```

Edit **`apps/api/.env`** and set your key (and, for phone testing, your laptop origin):

```bash
MR_GEMINI_API_KEY=AIza...your-key...
# Allow your laptop's LAN origin so the phone's browser passes CORS:
MR_CORS_ORIGINS_STR=http://localhost:5173,http://<YOUR-LAPTOP-IP>:5173
```

You do **not** need to set `VITE_API_BASE_URL` for local or LAN dev — the web app
auto-targets the page's own host on `:8080` (so opening `http://<laptop-ip>:5173` on a
phone calls `http://<laptop-ip>:8080`, not the phone itself). Only set it for production
builds (point it at your Cloud Run URL).

---

## 3. Run locally (two terminals)

```bash
# Terminal 1 — backend on :8080
cd apps/api
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8080

# Terminal 2 — frontend on :5173
pnpm dev:web
```

Open <http://localhost:5173> on your laptop.

**Quick health check** (backend ready?):

```bash
curl -s http://localhost:8080/readyz
# expect: {"status":"ok","checks":{"firestore":true,"gemini_api":true}}
```

If `firestore` is `false` → re-check §1 (API enabled, ADC quota project). If `gemini_api`
is `false` → your `MR_GEMINI_API_KEY` isn't set in `apps/api/.env`.

---

## 4. Test on your iPhone (same Wi-Fi)

1. Find your laptop's LAN IP: `ipconfig getifaddr en0` (e.g. `192.168.0.6`).
2. Make sure `apps/api/.env`'s `MR_CORS_ORIGINS_STR` includes `http://<laptop-ip>:5173`,
   and that the backend runs with `--host 0.0.0.0` (it does in §3). No web env change is
   needed — the app figures out the API host from the page URL automatically.
3. Open `http://<laptop-ip>:5173` in the phone browser. Analyze, daily, and sharing all
   work over LAN.

> **Camera caveat:** browsers (iOS Safari *and* Chrome) only allow the **live** camera on
> a **secure context** (HTTPS or `localhost`). Over plain `http://<ip>` the live scanner
> can't open — so the capture screen automatically falls back to the **photo picker**
> (which still offers the camera on phones). For the full live-scan experience, use the
> **deployed HTTPS URL** (§6) or local HTTPS (mkcert + `vite --https`).

---

## 5. Test scenarios

Walk these to confirm everything works end-to-end.

| # | Scenario | Steps | Expect |
|---|---|---|---|
| 1 | **Capture → Play** | Tap **CAMERA**, point at any object, tap the shutter | ~15s "scanning", then a playable level appears; arrow/tilt/tap controls move the player |
| 2 | **Win → Share** | Reach the gold flag | Win screen + Share sheet with a **QR code** and a short `/l/xxxxxx` URL |
| 3 | **Open a shared link** | Open the `/l/xxxxxx` URL (or scan the QR) on another device | The same level loads and is playable |
| 4 | **Submit to Daily** | From the share sheet, submit the level | "queued" confirmation; submitting again says "already queued" |
| 5 | **Today's World** | Tap **TODAY'S WORLD** | Plays the current daily level (or a friendly "hasn't started yet" until one is rotated in) |
| 6 | **Responsive** | Rotate the phone / resize the window | Game fills the screen in both orientations — no tiny letterboxed band |

Backend-only smoke (no browser needed):

```bash
# Analyze a photo (uses a tiny JPEG) — should return a level JSON
IMG=$(base64 -i /path/to/photo.jpg | tr -d '\n')
curl -s -X POST http://localhost:8080/api/analyze \
  -H 'Content-Type: application/json' \
  -d "{\"photo\":\"$IMG\",\"deviceHash\":\"mydevicehash123\"}" | head -c 400
```

### Test Today's World locally (bypass the scheduler)

In production a Cloud Scheduler cron promotes a submitted level into the Daily World.
Locally you can do that promotion by hand:

```bash
# 1. apps/api/.env already has MR_ALLOW_UNAUTH_ROTATE=true (local-only switch).
#    If you just changed it, restart the backend.
# 2. Submit at least one level first (scenario 4 above).
# 3. Promote the oldest submitted level to today's Daily:
curl -s -X POST http://localhost:8080/api/daily-rotate | python3 -m json.tool
#    -> {"rotated": true, "forDate": "...", "promotedFromSubmissionHash": "..."}
# 4. Now tap TODAY'S WORLD — it plays the promoted level.
```

> **Production:** keep `MR_ALLOW_UNAUTH_ROTATE=false` (the default in `.env.example` and
> the deploy config). The flag is local-testing only — with it on, anyone could trigger
> a rotation.

---

## 6. Deploy

Domains are auto-assigned (`https://<your-project-id>.web.app` for the web,
a `*.run.app` URL for the API). Custom domains come later.

### Backend → Cloud Run (manual Cloud Build trigger)

CI is **Cloud Build, triggered by hand from the GCP console** (no GitHub Actions):

1. One-time: create the Artifact Registry repo and grant IAM:
   ```bash
   ./infra/create-registry.sh
   ./infra/grant-iam.sh
   ```
2. In the GCP console → **Cloud Build → Triggers**, create/point a trigger at
   [`infra/cloudbuild.yaml`](./infra/cloudbuild.yaml) and **Run** it manually.
   It runs the quality gates, builds the image, pushes it, and deploys to Cloud Run
   with the Gemini key injected from Secret Manager (`--set-secrets`).

   *(Or do the same locally with `./infra/deploy-api.sh`.)*

3. After the first deploy, point the web app at the API URL — set
   `VITE_API_BASE_URL` to the Cloud Run URL in your build env, then deploy the web.

### Frontend → Firebase Hosting

```bash
pnpm gen           # regenerate shared types
pnpm build:web     # build apps/web/dist
./infra/deploy-web.sh
```

Open `https://<your-project-id>.web.app` — and use **this HTTPS URL on your iPhone** to
test the camera capture flow.

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `/readyz` → `firestore: false` | Firestore API off, or ADC on the wrong project | §1: enable API + `set-quota-project` |
| `/readyz` → `gemini_api: false` | `MR_GEMINI_API_KEY` not set | put your key in `apps/api/.env` |
| `/api/analyze` → `agent_error` | bad/blocked image, or wrong model name | try another photo; confirm `MR_GEMINI_MODEL=gemini-3.1-flash-lite` |
| Phone: "something went wrong" / Daily fails, **no API log** | requests aren't reaching the laptop (old build pinned `localhost`, or firewall) | rebuild/refresh the web app; ensure backend runs `--host 0.0.0.0` and the laptop allows incoming `:8080` on the LAN |
| Phone: API calls fail (CORS) | LAN origin not allowed | add `http://<laptop-ip>:5173` to `MR_CORS_ORIGINS_STR` |
| "Daily World hasn't started yet" | no level has been rotated into Daily yet | submit a level, then run the daily-rotate (Cloud Scheduler / `infra/scheduler.yaml`) — expected until then |
| Phone: live camera won't open | plain-HTTP LAN isn't a secure context | it auto-falls back to the photo picker; for live scan use HTTPS |
| `budget_exhausted` | daily cost cap hit | raise `MR_DAILY_GEMINI_CALL_CAP` locally, or wait |

---

That's it. Capture something, watch it become a level, and share the QR.
