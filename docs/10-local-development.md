# 10 — Local Development

> **Status**: normative · **Owner**: project lead · **Last revised**: 2026-05-20

How to get a clone running on your laptop: the FastAPI backend calls Gemini with an
AI Studio API key (`MR_GEMINI_API_KEY`) and Firestore via ADC, with the frontend
talking to the local backend — all without breaking your monthly budget.

> _Changed: 2026-05-22 — Gemini auth is now an API key (AI Studio), not Vertex ADC.
> For the friendly step-by-step + test scenarios, see [`../RUNNING.md`](../RUNNING.md)._

---

## Table of Contents

1. [Prereqs](#prereqs)
2. [One-time setup (10 minutes)](#one-time)
3. [Env files](#env)
4. [Day-to-day loop](#day-to-day)
5. [Firestore emulator](#emulator)
6. [Testing your iPhone against the laptop backend](#iphone)
7. [Common errors](#errors)
8. [Tearing it all down](#teardown)

---

<a id="prereqs"></a>

## 1. Prereqs

Install once:

| Tool | Install command (macOS) | Verify |
|---|---|---|
| Node 20 | `brew install node@20` | `node -v` → `v20.x` |
| pnpm 9 | `corepack enable && corepack prepare pnpm@latest --activate` | `pnpm -v` → `9.x` |
| Python 3.12 | `brew install python@3.12` | `python3.12 --version` |
| uv | `brew install uv` _or_ `curl -LsSf https://astral.sh/uv/install.sh \| sh` | `uv --version` |
| gcloud CLI | `brew install --cask google-cloud-sdk` | `gcloud --version` |
| Firebase CLI | `pnpm add -g firebase-tools` | `firebase --version` |
| Docker Desktop | `brew install --cask docker` | `docker version` |
| mise (optional) | `brew install mise` | `mise --version` |

A working iPhone with iOS 14.5+ and Safari is required for end-to-end testing of the capture flow. Earlier OS versions won't have reliable `getUserMedia`.

<a id="one-time"></a>

## 2. One-time setup (10 minutes)

```bash
# 1. Clone
git clone <your-fork-url> mirror-realm
cd mirror-realm

# 2. Install JS workspace deps
pnpm install

# 3. Install Python backend deps (uv creates apps/api/.venv automatically)
cd apps/api && uv sync && cd ../..

# 4. Authenticate gcloud (browser flow)
gcloud auth login

# 5. Set the active project (assumes you've already created it; if not, see docs/11)
gcloud config set project <your-project-id>

# 6. Application Default Credentials — for Firestore (NOT Gemini; Gemini uses the API key)
gcloud auth application-default login
gcloud auth application-default set-quota-project <your-project-id>

# 7. Generate shared types from JSON Schema
pnpm gen

# 8. Copy env templates, then put your AI Studio key in apps/api/.env (MR_GEMINI_API_KEY)
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env

# 9. Quick smoke check
pnpm typecheck     # runs tsc on apps/web
cd apps/api && uv run mypy app && uv run pytest -q tests/unit && cd ../..
```

If step 9 passes, you're set.

<a id="env"></a>

## 3. Env files

### `apps/api/.env`

```bash
# apps/api/.env.example — committed to repo (placeholders only, no real values)
# docs: 10-local-development.md#env

# GCP — replace <your-project-id> with your actual GCP project ID
MR_GCP_PROJECT=<your-project-id>
MR_GCP_LOCATION=asia-southeast2
MR_FIRESTORE_DATABASE=(default)

# Gemini
MR_GEMINI_MODEL=gemini-3.1-flash-lite

# Cost guard caps (overrideable per env)
MR_DAILY_GEMINI_CALL_CAP=300
MR_DAILY_GEMINI_USD_CAP=1.0
MR_DAILY_SUBMISSION_CAP_PER_DEVICE=5

# Cloud Scheduler verification — SA name is deterministic, swap only the project
MR_SCHEDULER_SA_EMAIL=mirror-realm-scheduler@<your-project-id>.iam.gserviceaccount.com
MR_ALLOW_UNAUTH_ROTATE=false       # set true ONLY for local rotate testing

# CORS — comma-separated origins. Add your Firebase Hosting + dev URLs.
MR_CORS_ORIGINS=http://localhost:5173,https://<your-project-id>.web.app

# Telemetry
MR_TRACE_ENABLED=true
MR_GIT_SHA=local-dev
```

### `apps/web/.env.local`

```bash
# apps/web/.env.local — NOT committed
# docs: 10-local-development.md#env
VITE_API_BASE_URL=http://localhost:8080
```

For LAN testing from an iPhone, change to `VITE_API_BASE_URL=http://<your-laptop-LAN-IP>:8080`. See [§6](#iphone).

### Loading rules

- Backend: `pydantic-settings` reads `MR_*` from environment. The `.env` file is loaded by `uvicorn` if `MR_LOAD_DOTENV=true` (default in `apps/api/.env.example`).
- Frontend: Vite reads `VITE_*` automatically. `.env.local` is git-ignored and overrides `.env`.

<a id="day-to-day"></a>

## 4. Day-to-day loop

Two terminals.

```bash
# Terminal 1 — backend
cd apps/api
uv run uvicorn app.main:app --reload --port 8080
```

```bash
# Terminal 2 — frontend
cd apps/web
pnpm dev
# Vite prints local + LAN URLs
```

Open `http://localhost:5173` in your laptop browser. Use Chromium-based DevTools' device emulation to fake a small viewport.

### Common scripts (pnpm workspace root)

| Script | What it does |
|---|---|
| `pnpm gen` | Regenerates TS types + Pydantic models from `packages/shared/*.schema.json` |
| `pnpm typecheck` | `tsc --noEmit` across the workspace |
| `pnpm lint` | eslint + ruff |
| `pnpm test` | vitest (web) + pytest (api) |
| `pnpm test:e2e` | Playwright against running dev servers |
| `pnpm build:web` | Vite production build |
| `pnpm build:api` | Docker build of the API container |
| `pnpm gen:check` | Fails if generated files are stale vs schema (CI uses this) |

<a id="emulator"></a>

## 5. Firestore emulator

For integration tests and offline dev, run the Firestore emulator.

```bash
# Install the emulator (one-time)
gcloud components install cloud-firestore-emulator

# Run
gcloud beta emulators firestore start \
  --host-port=127.0.0.1:8081 \
  --database-mode=firestore-native
```

Then in another terminal, point the backend at it:

```bash
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8081
cd apps/api && uv run uvicorn app.main:app --reload --port 8080
```

The Google Cloud Firestore client library auto-detects `FIRESTORE_EMULATOR_HOST` and bypasses auth.

Caveats:
- Firestore TTL policies are **not** simulated by the emulator. Tests that depend on TTL must mock `datetime.now()` or use a fake clock.
- Atomic increments work as expected.

<a id="iphone"></a>

## 6. Testing your iPhone against the laptop backend

The camera doesn't work on `localhost` from an iPhone — it works only over HTTPS or on a same-LAN HTTP origin that Safari trusts. The simplest path:

```bash
# 1. Find your laptop's LAN IP
ipconfig getifaddr en0   # macOS Wi-Fi; replace en0 if on wired

# 2. Edit apps/web/.env.local
echo 'VITE_API_BASE_URL=http://192.168.x.y:8080' > apps/web/.env.local

# 3. Restart Vite — it'll print the LAN URL too
pnpm --filter web dev --host

# 4. On your iPhone (same Wi-Fi), open http://192.168.x.y:5173
```

If Safari refuses to grant camera permission on plain HTTP, you have two options:

- **Option A (recommended for serious testing)**: deploy to Cloud Run + Firebase Hosting (see [`11-deployment-guide.md`](./11-deployment-guide.md)). Real HTTPS, real PWA install, real cost (~pennies).
- **Option B (clever hack)**: use `mkcert` to issue a local CA, run a local Caddy reverse proxy that fronts Vite over HTTPS, install the CA cert on the iPhone via TestFlight or AirDrop. Documented in `infra/local-https/README.md` if/when added.

<a id="errors"></a>

## 7. Common errors

| Symptom | Cause | Fix |
|---|---|---|
| `google.auth.exceptions.DefaultCredentialsError` | ADC not set | `gcloud auth application-default login` |
| `RESOURCE_EXHAUSTED` from Vertex | Quota or budget cap | Check Cloud Console → IAM → Quotas; or set `MR_DAILY_GEMINI_CALL_CAP=999` for local |
| 503 `budget_exhausted` in dev | Local cost guard tripped | Same as above, or `DELETE` the `costGuard/{today}` doc in the emulator |
| `firebase-tools: command not found` | global install missed | `pnpm add -g firebase-tools` |
| Camera permission silently denied on iPhone | Insecure context | Use HTTPS (deploy) or LAN IP |
| Phaser canvas blank on iOS | iOS 14.4 or older | Update iPhone; we don't support older Safari |
| `mypy: not found` | Python venv not activated | `cd apps/api && uv sync && uv run mypy app` |

<a id="teardown"></a>

## 8. Tearing it all down

If you want a clean slate locally:

```bash
# Wipe node + python deps
rm -rf node_modules apps/*/node_modules apps/api/.venv

# Wipe generated types
rm apps/web/src/domain/level.ts apps/web/src/domain/vibes.ts
rm apps/api/app/agents/schemas.py

# Wipe local env
rm apps/web/.env.local apps/api/.env

# Wipe ADC (NOT the gcloud login itself)
gcloud auth application-default revoke
```

Then re-run [§2](#one-time) from scratch.

To wipe your **GCP project's** data (Firestore docs etc.) — that's a deployment-guide topic, see [`11-deployment-guide.md`](./11-deployment-guide.md). Don't do it on a project you share with anyone.

---

_End of 10 — Local Development._
