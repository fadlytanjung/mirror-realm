# 03 — Tech Stack

> **Status**: normative · **Owner**: project lead · **Last revised**: 2026-05-20

The full dependency list with rationale. Every entry must answer "why this and not the obvious alternative". Anything not on this list is **not allowed** in the project without first being added here.

---

## Table of Contents

1. [Pinning policy](#pinning)
2. [Frontend (`apps/web`)](#frontend)
3. [Backend (`apps/api`)](#backend)
4. [AI layer](#ai)
5. [Storage & infra](#storage-infra)
6. [Tooling](#tooling)
7. [Asset sources](#assets)
8. [Banned dependencies](#banned)

---

<a id="pinning"></a>

## 1. Pinning policy

- **Exact-pin all runtime deps** (`"phaser": "3.80.1"`, not `"^3.80"`). Lockfiles (`pnpm-lock.yaml`, `uv.lock`) are committed.
- **Dev deps may use `^` ranges.** Lint/format/test churn isn't a stability risk.
- **Bump cadence**: one PR per minor bump; group patches monthly. No "update everything" PRs.
- **Single owner per dep**. If you add a library, you're on the hook for its next bump.

<a id="frontend"></a>

## 2. Frontend (`apps/web`)

| Dep | Version | Why this, not the obvious alternative |
|---|---|---|
| **Vite** | `5.4.x` | PWA-friendly, `vite-plugin-pwa` exists, native ESM. Webpack would work but is slower; Parcel is too opaque. |
| **TypeScript** | `5.6.x` | Type safety against the shared Level schema. JS-only would lose codegen value. |
| **Phaser 3** | `3.80.1` | Mature, built-in Matter.js physics, sprite/tile primitives, scene system. Pixi.js is lower-level; PlayCanvas is overkill. |
| **vite-plugin-pwa** | `0.20.x` | Generates manifest + service worker; Workbox under the hood. Avoids hand-rolling SW. |
| **idb** | `8.0.x` | Tiny IndexedDB wrapper. Dexie is heavier; we only need a key-value cache. |
| **lz-string** | `1.5.0` | URL-safe Base64URL output; same compressor used by many shared-state-in-URL apps. brotli is bigger; pako (deflate) doesn't help much for ~600B payloads. |
| **qrious** | `4.0.2` | 5KB canvas-based QR generator. Sufficient for our payload size; `qrcode` lib is heavier. |
| **jsqr** | `1.4.0` | Frame-by-frame QR scan from `getUserMedia`. ZXing is huge; jsqr is the pragmatic JS pick. |
| **html5-qrcode** | _rejected_ | DOM-coupled, harder to integrate with our canvas-first capture flow. |

### Dev deps

| Dep | Why |
|---|---|
| **vitest** | Fast unit-test runner; works with Vite config; avoids Jest's CJS issues |
| **@playwright/test** | E2E on real Chromium / Mobile Safari emulation for the camera + game loop |
| **eslint** + **@typescript-eslint** | Standard linting |
| **prettier** | Format. Config: 2-space, single-quote, no-semi (matches Phaser docs style) |
| **typescript-json-schema** _or_ **json-schema-to-typescript** | Generates `apps/web/src/domain/level.ts` from `packages/shared/level.schema.json`. Use `json-schema-to-typescript`. |

<a id="backend"></a>

## 3. Backend (`apps/api`)

Python **3.12**. Strict-mode mypy is enabled for `app/`.

| Dep | Version | Why this, not the obvious alternative |
|---|---|---|
| **fastapi** | `0.115.x` | Async, OpenAPI-out-of-the-box, Pydantic-native. Flask is sync; Litestar is fine but FastAPI has bigger community. |
| **uvicorn[standard]** | `0.32.x` | ASGI server; `[standard]` pulls in uvloop + httptools for speed |
| **pydantic** | `2.9.x` | Validation + settings. Pinned to v2 — no v1 compatibility shims. |
| **pydantic-settings** | `2.5.x` | Env-driven config. Cleaner than `os.environ.get(...)` scattered around. |
| **google-adk** | `1.x` (latest stable at deploy time) | The AI agent framework. See `docs/06-ai-agent-layer.md`. |
| **google-cloud-aiplatform** | latest compatible with ADK | Vertex AI SDK; transitively pulled by ADK but pinned explicitly so bumps are visible. |
| **google-cloud-firestore** | `2.x` | Async client (`AsyncClient`). The official one; no third-party. |
| **httpx** | `0.27.x` | Used only for outbound calls outside GCP (e.g. health-pinging Firebase Hosting). |
| **opentelemetry-sdk** + **opentelemetry-exporter-gcp-trace** | latest | ADK uses OTel for tracing; we re-use the same exporter for FastAPI spans. |
| **structlog** | `24.x` | JSON-structured logs for Cloud Logging. Stdlib `logging` works but structlog is cleaner. |
| **orjson** | `3.10.x` | Fast JSON. FastAPI can swap its default encoder. Microoptimization but free. |

### Dev deps

| Dep | Why |
|---|---|
| **pytest** | The test runner |
| **pytest-asyncio** | Async test fixtures |
| **pytest-httpx** | Mock outbound HTTP cleanly |
| **firestore-emulator (gcloud component)** | Real Firestore semantics, no mocks. Run via gcloud beta emulators firestore. |
| **ruff** | Format + lint (replaces black + isort + flake8). Pinned in `pyproject.toml`. |
| **mypy** | Strict-mode types; `app/` must pass `mypy --strict` |
| **datamodel-code-generator** | JSON Schema → Pydantic models. Generates `app/agents/schemas.py`. |

<a id="ai"></a>

## 4. AI layer

| Concern | Choice | Why |
|---|---|---|
| **Framework** | **Google ADK** (`google-adk`) | Native Cloud Trace, agent abstractions, prompt-as-file pattern, runners with session handling. Direct Vertex SDK is fine but loses tracing ergonomics. |
| **Model** | **`gemini-3.1-flash-lite`** | Cheapest tier with vision + JSON-mode. ~$0.0005/call estimated. See [`15-cost-and-limits.md`](./15-cost-and-limits.md). |
| **Endpoint** | **Vertex AI** (not AI Studio) | Same GCP project as runtime, workload-identity auth, regional data residency, no API keys. |
| **Region** | **`asia-southeast2`** (Jakarta) | Matches user location, ≤200ms RTT from Indonesia. If Gemini isn't available there, fall back to `asia-southeast1` and document. |
| **Output mode** | **JSON-mode with `responseSchema`** | Pydantic-validated. No regex/string parsing of model output. |
| **Tracing** | **ADK → OTel → Cloud Trace** | Same trace tree spans HTTP request → agent run → Vertex call. |

Forbidden: calling Gemini via REST/HTTP directly; using AI Studio API keys; calling Gemini from `apps/web`.

<a id="storage-infra"></a>

## 5. Storage & infra

| Service | Tier / mode | Why |
|---|---|---|
| **Cloud Run** | Fully managed, scales to zero, `--max-instances 5` | Free-tier covers 2M req/month; hard ceiling caps cost |
| **Firestore** | Native mode, region matching Cloud Run | Always-free tier; serverless; works locally via emulator |
| **Cloud Storage** | Standard, single bucket `mirror-realm-blobs` | Pre-staged for stretch (MP4 export); unused in v1 |
| **Cloud Scheduler** | 1 job (`daily-rotate`), OIDC auth | Free tier covers 3 jobs |
| **Firebase Hosting** | Default | Free SSL, CDN, generous tier |
| **Cloud Build** | Optional CI deploy | Only if we wire GitHub trigger; manual `gcloud run deploy` works too |
| **Cloud Trace / Cloud Logging / Cloud Monitoring** | Default | Auto-enabled with the APIs |
| **Billing budget** | `$15/month` with thresholds + Pub/Sub kill-switch | See [`15-cost-and-limits.md`](./15-cost-and-limits.md) |

<a id="tooling"></a>

## 6. Tooling

| Tool | Version | Where it runs |
|---|---|---|
| **pnpm** | `9.x` | Local + CI; workspace mode |
| **uv** | `0.4+` | Local + CI; manages Python venv + lock |
| **gcloud CLI** | latest | Local + CI |
| **Firebase CLI** | `13.x` | Local + CI |
| **Docker** | latest | Local (for `gcloud run deploy --source` build) |
| **mise** _(optional)_ | latest | Per-repo tool version pinning; `.mise.toml` checked in |

### CI

GitHub Actions in `.github/workflows/`:

- `ci.yml` — runs on PR: install, lint, typecheck, unit tests, schema-parity check
- `spec-parity.yml` — verifies generated TS/Python types match `packages/shared/*.schema.json`
- `deploy-prod.yml` — runs on push to `main`: deploys both `apps/web` and `apps/api`. Requires manual approval.

<a id="assets"></a>

## 7. Asset sources (tilesets, sprites, sfx)

All v1 assets are CC0 or compatible. Provenance is recorded next to each file in a sibling `LICENSE.md`.

| Vibe | Source | License |
|---|---|---|
| cozy, forest, desert, snow, underwater | Kenney Pixel Platformer Pack | CC0 |
| neon, vapor, library | LimeZu / cozy recolor | mixed CC0/CC-BY |
| ruined, industrial | OpenGameArt themed packs | CC-BY-SA (attribution in LICENSE.md) |
| cosmic | Generated **once** with Imagen 4 Fast | proprietary (we own the output) |
| monochrome | Kenney 1-Bit Pack | CC0 |

Player sprite: Kenney "platformer-characters-1" (CC0), variant `spark`.

SFX: Kenney audio (CC0) — `jump.ogg`, `die.ogg`, `win.ogg`.

The generation of `cosmic.png` is a one-shot script in `infra/asset-gen/` — it's NOT part of the runtime path.

<a id="banned"></a>

## 8. Banned dependencies

The following are off-limits without an explicit doc update here justifying inclusion:

| Banned | Reason |
|---|---|
| **Sentry / Datadog / Logtail** | Cloud Logging + Trace are sufficient; another bill is over-engineering |
| **Auth libraries (NextAuth, Auth0, Supabase Auth)** | No accounts in v1 |
| **Redux / MobX / Zustand** | Game state lives inside Phaser; UI state is trivial |
| **React / Vue / Svelte** | The PWA shell is plain DOM + Phaser canvas; no SPA framework needed |
| **Tailwind / styled-components** | One CSS file with a tiny pixel-art design system; framework overhead unjustified |
| **Express / Koa / Hono on Python** | We chose FastAPI |
| **SQLAlchemy / Tortoise / Prisma** | Firestore is NoSQL; no ORM needed |
| **OpenAI / Anthropic SDKs** | Vertex AI is the chosen provider |
| **Cloudflare Workers / Vercel / Netlify** | We're on GCP. Mixing providers fragments the IAM story. |
| **Webpack / Rollup config tweaks** | Vite handles bundling; avoid escape hatches |

If you find yourself needing one of these, write a short ADR-style entry in this doc explaining the change before adding it.

---

_End of 03 — Tech Stack._
