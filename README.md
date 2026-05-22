# Mirror Realm

> _Photograph reality. Play it as a game._

A PWA that turns any iPhone photo into a playable side-scrolling pixel-art platformer level in ~15 seconds. Point your camera at a coffee mug and books, tap the shutter — the saucer becomes a slope, the books become a staircase. Swipe up to jump. Share the level as a QR code.

This repo is the **specification + scaffold** for the project. Implementation is in progress.

---

## Status

| Surface | State |
|---|---|
| Specification (`docs/00-` → `docs/16-`) | Complete (Level schema v1.0.0) |
| Backend (`apps/api`) | Not yet implemented — spec ready |
| Frontend (`apps/web`) | Not yet implemented — spec ready |
| Public demo | Not yet deployed |

Track feature progress in [`docs/09-features.md`](./docs/09-features.md#status).

## For humans (the vision)

- **What it does + why it exists** → [`MirrorRealm-Design-Doc.md`](./MirrorRealm-Design-Doc.md)
- **Where it runs (Google Cloud + Gemini)** → [`GCP-Infrastructure-Guide.md`](./GCP-Infrastructure-Guide.md)

## For builders (and AI assistants)

This project follows **Spec-Driven Design**: `docs/` is the source of truth and code conforms to it. Before writing any code, read:

1. [`CLAUDE.md`](./CLAUDE.md) — the boundary contract (docs↔code rules, commit conventions, what this repo is _not_)
2. [`docs/00-overview.md`](./docs/00-overview.md) — personas, success criteria, non-goals
3. [`docs/01-architecture.md`](./docs/01-architecture.md) — system topology
4. The rest of `docs/`, in numeric order

## Stack at a glance

| Layer | Tech |
|---|---|
| Frontend | Vite + Phaser 3 + TypeScript (PWA, installable on iOS) |
| Backend | FastAPI + [`google-genai`](https://ai.google.dev/) (Python 3.12) |
| AI | `gemini-3.1-flash-lite` via AI Studio (Gemini Developer API) |
| Data | Firestore (Native mode) + Cloud Storage |
| Hosting | Firebase Hosting (web) + Cloud Run (api) |
| Scheduler | Cloud Scheduler (Daily World rotation) |

Full rationale and version pins → [`docs/03-tech-stack.md`](./docs/03-tech-stack.md).

## Repository layout (monorepo)

```
mirror-realm/
├── CLAUDE.md               # read first
├── docs/                   # spec (source of truth, 00-16)
├── apps/
│   ├── web/                # Vite + Phaser PWA
│   └── api/                # FastAPI + google-genai
├── packages/shared/        # canonical JSON Schemas
└── infra/                  # firebase, cloud run, scheduler, kill-switch
```

Detail: [`docs/02-repository-structure.md`](./docs/02-repository-structure.md).

## Quick start

> **New here? The easiest path is [`RUNNING.md`](./RUNNING.md)** — a copy-paste guide
> covering one-time GCP setup, local run, iPhone testing, test scenarios, and deploy.

You'll need: **Node 20**, **pnpm 9**, **Python 3.12**, **uv**, **gcloud CLI**, **Firebase CLI**, **Docker**, and an **AI Studio API key**. (Versions in [`docs/03-tech-stack.md`](./docs/03-tech-stack.md#1-pinning-policy).)

```bash
# Install
pnpm install
cd apps/api && uv sync && cd ../..

# Authenticate with YOUR Google Cloud account (ADC is for Firestore)
gcloud auth login
gcloud auth application-default login
gcloud config set project <your-project-id>

# Copy env templates and fill in your values
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
$EDITOR apps/api/.env       # set MR_GEMINI_API_KEY (AI Studio) + MR_GCP_PROJECT
```

Full walkthrough → [`RUNNING.md`](./RUNNING.md) · deeper detail in [`docs/10-local-development.md`](./docs/10-local-development.md).
First-time GCP project setup → [`docs/11-deployment-guide.md`](./docs/11-deployment-guide.md).

## Run locally (two terminals)

```bash
# Backend on :8080
cd apps/api && uv run uvicorn app.main:app --reload --port 8080

# Frontend on :5173
cd apps/web && pnpm dev
```

## Contributing

Contributions are welcome — issues, ideas, PRs. This is a personal project that I want others to be able to learn from, fork, and improve.

Before opening a PR:

1. **Read [`CLAUDE.md`](./CLAUDE.md)** — especially §2 (the docs-as-source-of-truth contract) and §5 (commit conventions). If you're changing behavior, you update the corresponding `docs/*.md` section in the **same** commit.
2. **Run the local checks**: `pnpm lint && pnpm typecheck && pnpm test` (CI runs the same).
3. **One logical change per commit.** A bug fix doesn't ride alongside a refactor.
4. **No secrets in code, ever.** The one secret (the Gemini API key) lives in Secret Manager / a git-ignored `.env`; Firestore uses workload identity. Nothing secret ships in the web bundle.

Small fix? Send a PR. Bigger architectural change? Open an issue first so we can discuss whether it fits v1's design. Stretch ideas (multiplayer, custom tilesets, etc.) live in [`docs/16-roadmap.md`](./docs/16-roadmap.md).

## Cost & safety

Running this at hobby scale on GCP costs cents per month. The repo ships:

- Per-call cost estimates in [`docs/15-cost-and-limits.md`](./docs/15-cost-and-limits.md)
- Soft caps (300 Gemini calls/day, $1/day estimated) enforced in-app
- Hard cap: a $15/month billing kill-switch (Pub/Sub + Cloud Function disables billing on the project)

You cannot accidentally burn a lot of money with this stack. The worst case is the project halts.

## Support the project

Mirror Realm is free, open-source, no ads, no tracking, no subscriptions. After v1 launches, if it makes your day, you can buy me a coffee:

- **Star the repo** so others can find it.
- **File issues / send PRs** so it gets better.

## License

- **Code** — [MIT](./LICENSE).
- **Tilesets, sprites, SFX** — original CC0 / CC-BY licenses preserved. Provenance per asset is recorded in [`docs/03-tech-stack.md` §7](./docs/03-tech-stack.md#7-asset-sources-tilesets-sprites-sfx).

If you fork this, you're free to ship your own variant. Two asks:

1. Don't remove the asset attributions (CC-BY requires them).
2. If you find a bug in the spec, send a fix back upstream so everyone benefits.
