# Mirror Realm

> _Photograph reality. Play it as a game._

A PWA that turns any iPhone photo into a playable side-scrolling pixel-art platformer in ~15 seconds. Tap to capture, swipe up to jump, share the level as a QR.

## For humans

- **What it does + why it exists** → [`MirrorRealm-Design-Doc.md`](./MirrorRealm-Design-Doc.md)
- **Where it runs (GCP / Gemini)** → [`GCP-Infrastructure-Guide.md`](./GCP-Infrastructure-Guide.md)

## For builders (and AI assistants)

- **Start here** → [`CLAUDE.md`](./CLAUDE.md)
- **Full specification** → [`docs/`](./docs/) (read in order, `00-` through `16-`)

## Quick start

```bash
pnpm install
cd apps/api && uv sync && cd ../..
gcloud auth application-default login
```

Then follow [`docs/10-local-development.md`](./docs/10-local-development.md).

## Stack at a glance

| Layer | Tech |
|---|---|
| Frontend | Vite + Phaser 3 + TypeScript (PWA) |
| Backend | FastAPI + Google ADK (Python 3.12) |
| AI | `gemini-3.1-flash-lite` via Vertex AI |
| Data | Firestore (Native) + Cloud Storage |
| Hosting | Firebase Hosting (web) + Cloud Run (api) |

## License

Personal project. Tilesets under their original CC0/CC-BY licenses (see `docs/03-tech-stack.md`).
