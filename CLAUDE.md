# CLAUDE.md — Mirror Realm Project Boundary

> **Read this file first.** It defines what this repo is, what it isn't, how to work in it, and the **docs-as-source-of-truth contract** that every change must honor.

---

## 1. What this project is

**Mirror Realm** is a PWA that turns iPhone photos into playable side-scrolling pixel-art platformer levels using Gemini vision. One tap to capture, ~15 seconds of "scanning", playable level on screen, QR-shareable.

- **Vision document** (the *why*): [`MirrorRealm-Design-Doc.md`](./MirrorRealm-Design-Doc.md)
- **Infrastructure playbook** (the *where it runs*): [`GCP-Infrastructure-Guide.md`](./GCP-Infrastructure-Guide.md)
- **Specifications & implementation contracts** (the *how*): [`docs/00-overview.md`](./docs/00-overview.md) → `docs/16-roadmap.md`

The two source markdown files in the repo root are **inputs** (design intent). The `docs/` tree is the **specification** that code must conform to.

---

## 2. The Docs-as-Source-of-Truth Contract

This project follows **Spec-Driven Design (SDD)**. The rule is simple and non-negotiable:

> **`docs/` is the source of truth. Code conforms to docs. When code must diverge, update docs FIRST in the same change.**

### What this means in practice

1. **Every code file maps to a doc section.** The mapping is recorded in [`docs/09-features.md`](./docs/09-features.md) → "Traceability Matrix" and in each domain doc's "Implementation" section.
2. **Code blocks inside `docs/*.md` are normative.** When a doc shows a function signature, request/response schema, IAM role, or env var, the code MUST match it exactly. CI checks (see [`docs/14-testing-strategy.md`](./docs/14-testing-strategy.md)) enforce schema parity.
3. **No code change without a docs change.** If you rename a function, move a route, add a field, or swap a dependency — you update the relevant `docs/*.md` section in the **same commit**.
4. **No docs change without a rationale.** Every doc edit includes a one-line `> _Changed: <date> — <why>_` note inline near the change, or in the commit body.
5. **Docs anchors are stable.** Each doc uses `<a id="anchor-name"></a>` HTML anchors above key sections. Code refers back to docs via inline comments like `# docs: 06-ai-agent-layer.md#level-prompt`. Don't rename anchors casually — they're referenced from code.

### What this is NOT

- Not auto-generation. Docs do not "auto-update" from code. They update because **you update them** when the corresponding code changes.
- Not bidirectional sync. Code reflects docs; docs do not reflect code drift. If they diverge, **docs are right** until consciously revised.

### When you (or a future Claude session) are asked to implement a feature

1. Read the relevant `docs/*.md` section(s).
2. If the spec is ambiguous or wrong, **fix the spec first**, then implement.
3. Implement code matching the spec exactly.
4. Add `# docs: <file>#<anchor>` comments at the top of each new source file.
5. Update the Traceability Matrix in `docs/09-features.md`.
6. Commit docs + code together (see §5 below).

---

## 3. Repository layout

This is a **monorepo**. Each top-level directory has a single responsibility.

```
mirror-realm/
├── CLAUDE.md                   # this file — boundary & contract
├── README.md                   # human-readable entry point
├── MirrorRealm-Design-Doc.md   # vision (input)
├── GCP-Infrastructure-Guide.md # infra playbook (input)
├── docs/                       # SPECIFICATION (source of truth)
│   ├── 00-overview.md
│   ├── 01-architecture.md
│   ├── 02-repository-structure.md
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
│   ├── web/                    # Vite + Phaser PWA frontend (TypeScript)
│   │   └── src/
│   └── api/                    # FastAPI + Google ADK backend (Python)
│       └── app/
├── packages/
│   └── shared/                 # Shared schemas (level.schema.json, vibes.json)
├── infra/                      # firebase.json, cloudbuild.yaml, deploy scripts
└── .github/workflows/          # CI: spec parity check, lint, test, deploy
```

For full structure rules see [`docs/02-repository-structure.md`](./docs/02-repository-structure.md).

---

## 4. Setup & Run — boundary capability

> **Detailed walkthrough** lives in [`docs/10-local-development.md`](./docs/10-local-development.md). This section is the 60-second version so a fresh clone is runnable.

### One-time prerequisites

| Tool | Min version | Why |
|---|---|---|
| Node | 20.x | frontend (Vite, Phaser) |
| pnpm | 9.x | workspace package manager |
| Python | 3.12 | backend (FastAPI + ADK) |
| uv | 0.4+ | Python package manager (faster than pip) |
| gcloud CLI | latest | GCP deploys + ADC |
| Firebase CLI | 13.x | frontend hosting deploys |
| Docker | latest | local container builds |

### First-time setup

```bash
# 1. Clone + install JS deps
pnpm install

# 2. Install Python deps for backend
cd apps/api && uv sync && cd ../..

# 3. Authenticate gcloud (browser flow)
gcloud auth login
gcloud auth application-default login    # for local ADC -> Vertex AI

# 4. Set the active GCP project (see docs/11-deployment-guide.md for project creation)
gcloud config set project <your-project-id>

# 5. Copy env templates
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
```

### Run locally (two terminals)

```bash
# Terminal 1 — backend on :8080
cd apps/api && uv run uvicorn app.main:app --reload --port 8080

# Terminal 2 — frontend on :5173
cd apps/web && pnpm dev
```

Open `http://localhost:5173` on your laptop, or use your machine's LAN IP from your iPhone for camera testing.

### Deploy

```bash
# Backend → Cloud Run (asia-southeast2)
./infra/deploy-api.sh

# Frontend → Firebase Hosting
./infra/deploy-web.sh
```

See [`docs/11-deployment-guide.md`](./docs/11-deployment-guide.md) for the underlying gcloud/firebase commands.

---

## 5. Commit & change conventions

Every commit is a **traceable unit of change**. Bigger commits are fine; un-scoped commits are not.

### Format

```
<type>(<scope>): <imperative summary, ≤72 chars>

<optional body — explain WHY, not WHAT>

<optional footer — refs, breaking changes>
```

### Types

- `docs` — spec changes only
- `feat` — new feature (must include docs update)
- `fix` — bug fix (must include docs update if behavior changes)
- `refactor` — internal change, no behavior change
- `chore` — tooling, scaffolding, CI
- `infra` — deploy scripts, GCP config

### Scopes

- `web` — frontend (`apps/web`)
- `api` — backend (`apps/api`)
- `shared` — `packages/shared`
- `infra` — `infra/` or GCP
- `docs` — `docs/*.md`
- `spec` — multi-area spec touching docs + multiple apps

### Rules

- **One logical change per commit.** Don't mix a refactor with a feature.
- **Docs commits come first** when adding a new feature: spec the thing, commit; then implement, commit.
- **No `--no-verify`**, no force-push to main, no amending pushed commits.
- **No mass deletions in feature commits.** If you're removing something, dedicate a commit to the deletion with a `chore(cleanup):` or `refactor:` message explaining what and why.

---

## 6. Code conventions

Per-stack conventions live in [`docs/03-tech-stack.md`](./docs/03-tech-stack.md) and [`docs/14-testing-strategy.md`](./docs/14-testing-strategy.md). Cross-cutting rules:

- **No secrets in code.** Service accounts auth Cloud Run → Vertex. Local dev uses ADC. See [`docs/13-security.md`](./docs/13-security.md).
- **No API keys in the browser bundle.** The PWA only talks to your Cloud Run URL. Anything secret-shaped that ends up in `apps/web/dist/` is a bug.
- **No backwards-compat shims.** This is a fresh project; if a contract changes, fix all call sites in the same change.
- **Trust internal code.** Validate at boundaries (incoming HTTP requests, Gemini responses). Don't sprinkle defensive `if x is None` inside well-typed internal code.
- **Comments explain WHY, not WHAT.** Identifier names cover what; comments are for non-obvious constraints, workarounds, references to docs anchors.
- **No emoji** in code or commits unless the user explicitly asks.

---

## 7. Working with AI / ADK

Mirror Realm's AI surface is intentionally small (today: one vision agent that converts photos into level JSON). It uses **Google ADK** with **`gemini-3.1-flash-lite`** on Vertex AI. Details: [`docs/06-ai-agent-layer.md`](./docs/06-ai-agent-layer.md).

Key rules when touching agent code:

- **Never call Gemini directly from `apps/web`.** All AI calls go through `apps/api`.
- **All agent prompts live in `apps/api/app/agents/prompts/` as `.md` files**, not as Python string literals. They're versioned and reviewable like any other spec artifact.
- **Response schemas are defined once in `packages/shared/`**, imported by both Python (Pydantic) and TypeScript (auto-generated). Single source of truth: the JSON Schema.
- **ADK tracing is on by default.** Don't disable it. See [`docs/12-observability.md`](./docs/12-observability.md).
- **Cost ceiling is enforced.** Every agent call increments a counter; if monthly spend projects above the budget, the agent returns a friendly "we're full for the month" error. See [`docs/15-cost-and-limits.md`](./docs/15-cost-and-limits.md).

---

## 8. Quick reference — where do I look for…?

| Question | File |
|---|---|
| What is this app supposed to do? | [`docs/00-overview.md`](./docs/00-overview.md) + [`MirrorRealm-Design-Doc.md`](./MirrorRealm-Design-Doc.md) |
| How do the pieces fit together? | [`docs/01-architecture.md`](./docs/01-architecture.md) |
| Where does X live in the repo? | [`docs/02-repository-structure.md`](./docs/02-repository-structure.md) |
| Why did we choose tool Y? | [`docs/03-tech-stack.md`](./docs/03-tech-stack.md) |
| What does a Level look like? | [`docs/04-domain-model.md`](./docs/04-domain-model.md) |
| How do I read/write Firestore? | [`docs/05-repository-pattern.md`](./docs/05-repository-pattern.md) |
| How does the Gemini agent work? | [`docs/06-ai-agent-layer.md`](./docs/06-ai-agent-layer.md) |
| What are the HTTP endpoints? | [`docs/07-api-contracts.md`](./docs/07-api-contracts.md) |
| How is the PWA built? | [`docs/08-frontend-app.md`](./docs/08-frontend-app.md) |
| What features exist + status? | [`docs/09-features.md`](./docs/09-features.md) |
| How do I run locally? | [`docs/10-local-development.md`](./docs/10-local-development.md) |
| How do I deploy? | [`docs/11-deployment-guide.md`](./docs/11-deployment-guide.md) |
| How do I monitor / trace? | [`docs/12-observability.md`](./docs/12-observability.md) |
| Security model + IAM? | [`docs/13-security.md`](./docs/13-security.md) |
| How are things tested? | [`docs/14-testing-strategy.md`](./docs/14-testing-strategy.md) |
| What does this cost? | [`docs/15-cost-and-limits.md`](./docs/15-cost-and-limits.md) |
| What's next on the roadmap? | [`docs/16-roadmap.md`](./docs/16-roadmap.md) |

---

## 9. What this repo is NOT

To prevent scope creep — explicit non-goals:

- **No user accounts.** Friends share via QR/URL. No auth, no profiles, no leaderboards in v1.
- **No live image generation.** Tilesets are pre-baked CC0 assets.
- **No GKE, no Cloud SQL, no Pub/Sub, no Cloud Tasks.** Cloud Run + Firestore + Cloud Storage cover everything we need.
- **No Android-first features.** iPhone PWA is primary; Android is best-effort.
- **No multiplayer.** Single-player only.

If you find yourself building any of the above, stop and check `docs/16-roadmap.md` first.

---

_End of CLAUDE.md._
