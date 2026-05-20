# 02 — Repository Structure

> **Status**: normative · **Owner**: project lead · **Last revised**: 2026-05-20

The canonical layout, the conventions, and the rules that keep this monorepo from rotting. If something in this doc disagrees with the on-disk layout, **fix the disk, not the doc** (and explain why in the commit).

---

## Table of Contents

1. [Top-level layout](#top-level)
2. [`apps/web/` — PWA frontend](#apps-web)
3. [`apps/api/` — FastAPI backend](#apps-api)
4. [`packages/shared/` — contracts](#shared)
5. [`infra/` — deploy & CI](#infra)
6. [`docs/` — the spec](#docs-tree)
7. [Naming conventions](#naming)
8. [Adding a new directory](#adding)

---

<a id="top-level"></a>

## 1. Top-level layout

```
mirror-realm/
├── CLAUDE.md                       # boundary contract (read first)
├── README.md                       # human entry point
├── MirrorRealm-Design-Doc.md       # vision (input, not edited)
├── GCP-Infrastructure-Guide.md     # infra playbook (input, not edited)
├── .gitignore
├── .github/
│   └── workflows/                  # CI: lint, test, spec-parity, deploy
├── docs/                           # SPECIFICATION (source of truth)
│   ├── 00-overview.md
│   ├── 01-architecture.md
│   ├── 02-repository-structure.md  # ← this file
│   ├── 03-tech-stack.md
│   ├── 04-domain-model.md
│   ├── 05-repository-pattern.md
│   ├── 06-ai-agent-layer.md
│   ├── 07-api-contracts.md
│   ├── 08-frontend-app.md
│   ├── 09-features.md
│   ├── 10-local-development.md
│   ├── 11-deployment-guide.md
│   ├── 12-observability.md
│   ├── 13-security.md
│   ├── 14-testing-strategy.md
│   ├── 15-cost-and-limits.md
│   └── 16-roadmap.md
├── apps/
│   ├── web/                        # Vite + Phaser PWA (TypeScript)
│   └── api/                        # FastAPI + Google ADK (Python 3.12)
├── packages/
│   └── shared/                     # JSON Schemas (canonical contracts)
├── infra/                          # firebase.json, cloudbuild.yaml, scripts
├── package.json                    # pnpm workspace root
├── pnpm-workspace.yaml
└── tsconfig.base.json              # base TS config inherited by apps/web
```

Two non-negotiable rules at the top level:

1. **Input docs (`MirrorRealm-Design-Doc.md`, `GCP-Infrastructure-Guide.md`) are immutable.** They represent the original ideation. Improvements go into `docs/` instead.
2. **No source code lives at the root.** Root is for project metadata only.

<a id="apps-web"></a>

## 2. `apps/web/` — PWA frontend

```
apps/web/
├── package.json
├── tsconfig.json                   # extends ../../tsconfig.base.json
├── vite.config.ts
├── index.html
├── public/
│   ├── manifest.webmanifest
│   ├── service-worker.ts           # registered by vite-plugin-pwa
│   ├── icons/                      # PWA icons (192, 512, maskable)
│   ├── tilesets/                   # 12 *.png — one per vibe (≤200KB each)
│   ├── sprites/
│   │   └── spark.png               # player sprite sheet (24x32 frames)
│   └── sfx/
│       ├── jump.ogg
│       ├── die.ogg
│       └── win.ogg
├── src/
│   ├── main.ts                     # Vite entry
│   ├── app.ts                      # Phaser.Game bootstrapper + route handler
│   ├── routes/                     # tiny hash-router
│   │   ├── home.ts
│   │   ├── capture.ts
│   │   ├── play.ts                 # consumes ?source=fresh|qr|daily|short
│   │   ├── daily.ts
│   │   └── share.ts
│   ├── scenes/                     # Phaser scenes
│   │   ├── BootScene.ts
│   │   ├── MenuScene.ts
│   │   ├── CaptureScene.ts         # camera + scan animation
│   │   ├── LevelScene.ts           # the playable game
│   │   └── ResultScene.ts          # win/lose + share QR
│   ├── domain/                     # type-only mirror of packages/shared
│   │   ├── level.ts                # `import type` from generated types
│   │   └── vibes.ts
│   ├── services/                   # one file per external dependency
│   │   ├── api.ts                  # fetch wrapper for apps/api
│   │   ├── camera.ts               # getUserMedia + JPEG compress
│   │   ├── storage.ts              # IndexedDB (idb)
│   │   ├── qr.ts                   # qrious + jsQR
│   │   └── compression.ts          # lz-string wrapper
│   ├── game/                       # platformer-specific logic
│   │   ├── physics.ts              # constants: gravity, jumpVel, moveVel
│   │   ├── builder.ts              # Level JSON → Phaser tile layout
│   │   └── controls.ts             # touch + keyboard input
│   └── ui/                         # non-Phaser UI overlays (DOM)
│       ├── ScanOverlay.ts
│       ├── ShareSheet.ts
│       └── styles.css
├── tests/
│   ├── unit/
│   └── e2e/                        # Playwright; runs on PR
├── .env.example
└── README.md                       # short pointer to docs/08-frontend-app.md
```

Conventions:

- **One file per Phaser scene.** Scenes are referenced by class name; no aliases.
- **`domain/` holds types only.** Anything runtime goes in `services/` or `game/`.
- **`public/tilesets/` filenames match vibe IDs.** `public/tilesets/{vibe}.png` is loaded by `LevelScene.preload()`.
- **No SVG/font/audio imports in TS.** Static assets live in `public/` and are referenced by absolute path.

<a id="apps-api"></a>

## 3. `apps/api/` — FastAPI backend

```
apps/api/
├── pyproject.toml
├── uv.lock
├── Dockerfile
├── app/
│   ├── __init__.py
│   ├── main.py                     # FastAPI() instance + uvicorn entry
│   ├── settings.py                 # pydantic-settings; env vars only
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── analyze.py              # POST /api/analyze
│   │   ├── level.py                # POST /api/level/save + GET /api/level/{hash}
│   │   ├── daily.py                # GET /api/daily + POST /api/daily-rotate
│   │   ├── submit.py               # POST /api/submit
│   │   └── health.py               # GET /healthz, /readyz
│   ├── agents/
│   │   ├── __init__.py
│   │   ├── level_designer.py       # LevelDesignerAgent (ADK Agent subclass)
│   │   ├── prompts/
│   │   │   ├── level_designer.system.md
│   │   │   └── level_designer.retry.md
│   │   └── schemas.py              # Pydantic models generated from level.schema.json
│   ├── domain/
│   │   ├── __init__.py
│   │   ├── level.py                # Level dataclass (Pydantic) + invariants
│   │   ├── vibes.py                # Vibe enum + tileset metadata
│   │   └── reachability.py         # A* pathfinder + jump physics simulation
│   ├── repositories/
│   │   ├── __init__.py
│   │   ├── base.py                 # AbstractRepository[T]
│   │   ├── levels.py               # LevelRepository (Firestore levels/)
│   │   ├── submissions.py
│   │   ├── daily.py
│   │   └── cost_guard.py
│   ├── services/
│   │   ├── __init__.py
│   │   ├── cost_guard.py           # business rules wrapping cost_guard repo
│   │   └── share_codec.py          # lz-string-compatible (server side decode for /l/{hash})
│   ├── adapters/
│   │   ├── __init__.py
│   │   ├── firestore_client.py     # singleton AsyncFirestore client
│   │   └── vertex_client.py        # ADK + Vertex AI setup
│   ├── telemetry/
│   │   ├── __init__.py
│   │   ├── tracing.py              # OTel setup, Cloud Trace exporter
│   │   └── logging.py              # structured JSON logs
│   └── errors.py                   # custom exception types + HTTP mappers
├── tests/
│   ├── unit/                       # pytest
│   ├── integration/                # uses Firestore emulator + Vertex sandbox
│   └── golden/                     # AI golden tests (photo → expected level shape)
├── .env.example
└── README.md                       # short pointer to docs/06 + docs/07
```

Conventions:

- **Layered (Clean Architecture lite)**: `routers` → `services` → `repositories` → `adapters`. Calls go down only.
- **Pydantic everywhere at boundaries.** Request models, response models, agent outputs, repository return types.
- **One adapter per external system.** Vertex, Firestore, GCS each get exactly one module.
- **Prompts as files, not strings.** `app/agents/prompts/*.md` are loaded at startup; the Python file just references the path. This keeps prompts diff-reviewable.

<a id="shared"></a>

## 4. `packages/shared/` — contracts

```
packages/shared/
├── level.schema.json               # CANONICAL: see docs/04-domain-model.md
├── vibes.json                      # tileset metadata
├── api.openapi.yaml                # CANONICAL API contract; see docs/07
└── codegen/
    ├── generate-ts.mjs             # JSON Schema → apps/web/src/domain/*.ts
    └── generate-py.py              # JSON Schema → apps/api/app/agents/schemas.py
```

Rules:

- **Edit the source, never the generated.** `*.ts` and `schemas.py` are regenerated by `pnpm gen` (frontend) and `uv run python codegen/generate-py.py` (backend). CI fails if they drift.
- **Versioning.** Each schema has `"const": "1.0.0"` for its `schemaVersion` field. Breaking changes bump major; CI compares old vs new and warns on incompat.

<a id="infra"></a>

## 5. `infra/` — deploy & CI

```
infra/
├── firebase.json                   # Hosting + emulators config
├── .firebaserc                     # project mapping
├── cloudbuild.yaml                 # Cloud Build trigger config
├── cloudrun.service.yaml           # declarative Cloud Run service (gcloud apply)
├── scheduler.yaml                  # Cloud Scheduler jobs (daily-rotate)
├── firestore.rules                 # deny-all client; SA full
├── firestore.indexes.json
├── deploy-api.sh                   # builds + deploys Cloud Run
├── deploy-web.sh                   # builds + deploys Firebase Hosting
├── grant-iam.sh                    # idempotent: applies IAM bindings from docs/13
└── kill-switch/                    # source for the billing kill-switch Cloud Function
    ├── main.py
    └── requirements.txt
```

Rules:

- **Idempotent scripts only.** Running `grant-iam.sh` twice must not error or change state.
- **Declarative > imperative.** Prefer YAML applied via `gcloud apply` over a sequence of `gcloud create`/`update` calls.
- **Single project per env.** Pick any GCP project IDs you like (e.g. `<your-project-id>-dev`, `<your-project-id>-prod`). Project IDs are configured via `MR_GCP_PROJECT` in `apps/api/.env` and `firebase use` on the web side — never hardcoded in source.

<a id="docs-tree"></a>

## 6. `docs/` — the spec

Rules unique to `docs/`:

- **Sequential numbering.** Files are `NN-name.md` where `NN` is 00..99. Never renumber; if you need to insert between 04 and 05, add `04a-…` or merge into an existing doc.
- **One topic per file.** Cross-cutting topics go in `09-features.md` (the only "menu" doc).
- **Anchors are HTML `<a id="…">` tags** placed _above_ section headings. Anchors are part of the public surface — once published, don't rename without grep-and-replace across all code comments.
- **Tables of Contents at the top.** Every doc above ~150 lines must have a TOC. Generated by hand to keep them honest.
- **No code outside fenced blocks.** Treat each fenced block as canonical — if it shows a function signature, the source file must match.

<a id="naming"></a>

## 7. Naming conventions

| Concern | Convention |
|---|---|
| **TypeScript files** | kebab-case for non-class files (`api.ts`, `share-codec.ts`); PascalCase only when the file's default export is a class (`LevelScene.ts`) |
| **Python files** | snake_case always (`level_designer.py`, `firestore_client.py`) |
| **Python classes** | PascalCase (`LevelDesignerAgent`, `LevelRepository`) |
| **Python functions** | snake_case |
| **JSON Schema files** | dot-separated kind (`level.schema.json`, `api.openapi.yaml`) |
| **Tilesets** | lowercase vibe id matches enum (`cozy.png`, `neon.png`) |
| **Docs** | `NN-kebab-case.md` |
| **Env vars** | `SCREAMING_SNAKE_CASE` with `MR_` prefix in API (`MR_GCP_PROJECT`, `MR_GEMINI_MODEL`) and `VITE_` prefix in web (`VITE_API_BASE_URL`) |
| **Firestore collections** | lowercase plural (`levels`, `submissions`); subcollections same |
| **Cloud Run service** | `mirror-realm-api` |
| **Service account** | `mirror-realm-runtime@<project>.iam.gserviceaccount.com` |
| **Git branches** | `type/short-summary` — e.g. `feat/cost-guard`, `docs/agent-prompts` |

<a id="adding"></a>

## 8. Adding a new directory

Before creating any new top-level or near-top-level directory:

1. Does an existing directory cover this? Default: yes. Push back on adding new ones.
2. If it must exist, write a one-paragraph rationale in this doc under the appropriate section.
3. Add a `.gitkeep` so it survives a clean clone.
4. Update [`CLAUDE.md`](../CLAUDE.md) §3 if it's top-level.

New `docs/*.md` files: if it's a real new topic, take the next available number. If it's notes about a feature, add it as a section in [`09-features.md`](./09-features.md) instead.

---

_End of 02 — Repository Structure._
