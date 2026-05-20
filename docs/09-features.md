# 09 — Features

> **Status**: normative · **Owner**: project lead · **Last revised**: 2026-05-20

The catalog of features (F1-F8) mapping the eight capabilities from [`00-overview.md`](./00-overview.md#capabilities). Each feature lists its acceptance criteria, the spec sections it depends on, and the source files that implement it. The **Traceability Matrix** at the end is the canonical docs↔code map.

---

## Table of Contents

1. [How to read this doc](#how-to-read)
2. [F1 — Capture to Play](#f1-capture-to-play)
3. [F2 — Play Runtime](#f2-play-runtime)
4. [F3 — Share via QR / URL](#f3-share)
5. [F4 — Open Shared Level](#f4-open-shared)
6. [F5 — Daily World (read)](#f5-daily-world)
7. [F6 — Submit to Daily Pool](#f6-submit)
8. [F7 — Daily Rotation (cron)](#f7-daily-rotate)
9. [F8 — Cost Guard](#f8-cost-guard)
10. [Feature status board](#status)
11. [Traceability matrix](#traceability)

---

<a id="how-to-read"></a>

## 1. How to read this doc

Each feature section follows the same template:

- **Spec ref** — which capability + which prior docs define the contract
- **User-visible behavior** — what someone with an iPhone experiences
- **Acceptance criteria** — checkable list, the definition of "done"
- **Implementation slices** — what code (which files) realize each criterion
- **Open questions** — anything unresolved

When implementing, update the **status board** ([§10](#status)) and the **traceability matrix** ([§11](#traceability)) in the same commit.

---

<a id="f1-capture-to-play"></a>

## 2. F1 — Capture to Play

**Capability**: C1 · **Status**: spec complete · **Owner**: project lead

### Spec ref

- Flow: [`01-architecture.md#flow-capture`](./01-architecture.md#flow-capture)
- Endpoint: [`07-api-contracts.md#analyze`](./07-api-contracts.md#analyze)
- Agent: [`06-ai-agent-layer.md`](./06-ai-agent-layer.md)
- Domain invariants: [`04-domain-model.md#invariants`](./04-domain-model.md#invariants)

### User-visible behavior

1. Open app. Tap the giant camera button.
2. Live camera preview fills the screen. Tap shutter.
3. Photo freezes. Scan-line animation sweeps over it; "reading the world…" progress.
4. After 5-20s, animation fades; level is rendered with the player sprite spawning in.

### Acceptance criteria

- [ ] AC1.1 — Camera button on Home opens a `<video>` preview using `facingMode: 'environment'`.
- [ ] AC1.2 — Shutter tap captures a JPEG ≤ 200KB (post-base64).
- [ ] AC1.3 — POST `/api/analyze` returns 2xx with a schema-valid `Level` for at least 9/10 typical indoor scenes.
- [ ] AC1.4 — Server-side reachability invariant (I5) is enforced; max one retry; output flagged if still bad.
- [ ] AC1.5 — Scan-line animation runs continuously while the request is pending and stops smoothly when level loads.
- [ ] AC1.6 — On error (timeout / budget / safety filter), user sees a contextual message with a "try again" button.
- [ ] AC1.7 — p95 wall clock from shutter tap to playable ≤ 20s (mid-2023 iPhone, LTE).

### Implementation slices

| Slice | Files |
|---|---|
| Camera capture | `apps/web/src/services/camera.ts`, `apps/web/src/scenes/CaptureScene.ts` |
| API client | `apps/web/src/services/api.ts` |
| Server endpoint | `apps/api/app/routers/analyze.py` |
| Agent | `apps/api/app/agents/level_designer.py`, `apps/api/app/agents/prompts/*` |
| Invariants | `apps/api/app/domain/level.py`, `apps/api/app/domain/reachability.py` |
| Scan animation | `apps/web/src/ui/ScanOverlay.ts` |

### Open questions

- _None as of v1 spec lock-in 2026-05-20._

---

<a id="f2-play-runtime"></a>

## 3. F2 — Play Runtime

**Capability**: C2 · **Status**: spec complete

### Spec ref

- Scenes: [`08-frontend-app.md#scenes`](./08-frontend-app.md#scenes)
- Physics constants: [`04-domain-model.md#physics`](./04-domain-model.md#physics)
- Controls: [`08-frontend-app.md#controls`](./08-frontend-app.md#controls)

### User-visible behavior

- Player sprite drops in at `spawn`.
- Touch left / right to move; swipe up to jump.
- Hitting a hazard restarts at spawn (no score penalty).
- Reaching the goal triggers a "CLEARED!" overlay with elapsed time + share buttons.

### Acceptance criteria

- [ ] AC2.1 — Physics constants in `apps/web/src/game/physics.ts` byte-match the table in [`04-domain-model.md#physics`](./04-domain-model.md#physics).
- [ ] AC2.2 — Touch controls support concurrent movement + jump.
- [ ] AC2.3 — Coyote frames (6) work after running off a platform edge.
- [ ] AC2.4 — Hazards reset the player to spawn instantly; no save state.
- [ ] AC2.5 — Camera follow has 200ms lookahead and screen-shake on land.
- [ ] AC2.6 — `level:win` and `level:die` events emit at most once per level instance.
- [ ] AC2.7 — Wake lock acquired on scene enter; released on scene exit.

### Implementation slices

| Slice | Files |
|---|---|
| Scene | `apps/web/src/scenes/LevelScene.ts` |
| Builder | `apps/web/src/game/builder.ts`, `apps/web/src/game/tile-mapping.ts` |
| Physics | `apps/web/src/game/physics.ts` |
| Controls | `apps/web/src/game/controls.ts` |
| Result overlay | `apps/web/src/scenes/ResultScene.ts` |

---

<a id="f3-share"></a>

## 4. F3 — Share via QR / URL

**Capability**: C3

### Spec ref

- Flow: [`01-architecture.md#flow-secondary`](./01-architecture.md#flow-secondary) §5.1
- Endpoint: [`07-api-contracts.md#save`](./07-api-contracts.md#save)
- UI: [`08-frontend-app.md#sharing`](./08-frontend-app.md#sharing)

### Acceptance criteria

- [ ] AC3.1 — `compression.ts:compress(level)` is lz-string Base64URL; round-trips losslessly with `decompress`.
- [ ] AC3.2 — If compressed level ≤ 600 chars, URL is `/p/<compressed>` (no server call).
- [ ] AC3.3 — Otherwise POST `/api/level/save`; URL is `/l/<6-char-hash>`.
- [ ] AC3.4 — QR canvas renders at 256×256 with error-correction level M.
- [ ] AC3.5 — Native share button uses `navigator.share()` where available; falls back to clipboard.
- [ ] AC3.6 — Server-saved levels expire 30 days after creation (Firestore TTL policy).

### Implementation slices

| Slice | Files |
|---|---|
| Compression | `apps/web/src/services/compression.ts` |
| QR encode | `apps/web/src/services/qr.ts` |
| Share UI | `apps/web/src/ui/ShareSheet.ts` |
| Save endpoint | `apps/api/app/routers/level.py` |
| Level repo | `apps/api/app/repositories/levels.py` |

---

<a id="f4-open-shared"></a>

## 5. F4 — Open Shared Level

**Capability**: C4

### Spec ref

- Flow: [`01-architecture.md#flow-secondary`](./01-architecture.md#flow-secondary) §5.2
- Routes: [`08-frontend-app.md#routing`](./08-frontend-app.md#routing)
- Endpoint: [`07-api-contracts.md#get-level`](./07-api-contracts.md#get-level)

### Acceptance criteria

- [ ] AC4.1 — `/p/<compressed>` route decodes inline and plays without hitting the API.
- [ ] AC4.2 — `/l/<hash>` route fetches via `GET /api/level/{hash}` and plays.
- [ ] AC4.3 — QR scan flow uses `jsqr` against the camera stream; valid QR triggers level load.
- [ ] AC4.4 — Invalid / unknown level (404, garbage QR, decompression error) shows "invalid level" toast and returns to Home.
- [ ] AC4.5 — Opened levels are added to the IndexedDB history.

### Implementation slices

| Slice | Files |
|---|---|
| Route parsing | `apps/web/src/app.ts`, `apps/web/src/routes/play.ts` |
| QR decode | `apps/web/src/services/qr.ts` |
| API client | `apps/web/src/services/api.ts:getLevel` |
| Get-level endpoint | `apps/api/app/routers/level.py` |

---

<a id="f5-daily-world"></a>

## 6. F5 — Daily World (read)

**Capability**: C5

### Spec ref

- Endpoint: [`07-api-contracts.md#daily-get`](./07-api-contracts.md#daily-get)
- Repo: [`05-repository-pattern.md`](./05-repository-pattern.md) §3.3
- Offline cache: [`08-frontend-app.md#offline`](./08-frontend-app.md#offline)

### Acceptance criteria

- [ ] AC5.1 — Home shows a "Today's World" tile; tapping it routes to `#/daily`.
- [ ] AC5.2 — `GET /api/daily` is called once per app session; result cached in IndexedDB.
- [ ] AC5.3 — Response is CDN-cacheable for 1 hour (`Cache-Control: public, max-age=3600`).
- [ ] AC5.4 — If `isFromYesterday: true`, UI shows a subtle "yesterday's pick" label.
- [ ] AC5.5 — If 404 `no_daily_yet`, UI shows "Daily World hasn't started yet — submit a level!".

### Implementation slices

| Slice | Files |
|---|---|
| Daily endpoint | `apps/api/app/routers/daily.py` |
| Repo | `apps/api/app/repositories/daily.py` |
| Client cache | `apps/web/src/services/storage.ts` |
| UI tile | `apps/web/src/scenes/MenuScene.ts` |

---

<a id="f6-submit"></a>

## 7. F6 — Submit to Daily Pool

**Capability**: C6

### Spec ref

- Endpoint: [`07-api-contracts.md#submit`](./07-api-contracts.md#submit)
- Domain: [`04-domain-model.md#submission`](./04-domain-model.md#submission)
- Cost guard rate limit: [`04-domain-model.md#cost-guard`](./04-domain-model.md#cost-guard)

### Acceptance criteria

- [ ] AC6.1 — After winning a fresh level, `ResultScene` shows a "Submit to Daily pool" button.
- [ ] AC6.2 — Tap → POST `/api/submit` with the current Level + deviceHash.
- [ ] AC6.3 — Server re-validates Level (schema + invariants + reachability) before queueing.
- [ ] AC6.4 — Same content hash is idempotent (returns `already_queued`).
- [ ] AC6.5 — `>5` submissions in 24h per deviceHash returns 429.
- [ ] AC6.6 — UI shows "In the pool!" on success, friendly error otherwise.

### Implementation slices

| Slice | Files |
|---|---|
| Submit endpoint | `apps/api/app/routers/submit.py` |
| Submission repo | `apps/api/app/repositories/submissions.py` |
| Rate-limit service | `apps/api/app/services/cost_guard.py` |
| UI button | `apps/web/src/scenes/ResultScene.ts` |

---

<a id="f7-daily-rotate"></a>

## 8. F7 — Daily Rotation (cron)

**Capability**: C7

### Spec ref

- Endpoint: [`07-api-contracts.md#daily-rotate`](./07-api-contracts.md#daily-rotate)
- Scheduler config: [`11-deployment-guide.md`](./11-deployment-guide.md) §"Cloud Scheduler"

### Acceptance criteria

- [ ] AC7.1 — Cloud Scheduler job `daily-rotate` fires at `0 0 * * *` UTC.
- [ ] AC7.2 — Job uses OIDC token from `mirror-realm-scheduler@…` SA.
- [ ] AC7.3 — Endpoint pops oldest submission, validates, writes `daily/today` + `daily/{date}`, deletes submission.
- [ ] AC7.4 — Empty queue → `rotated: false`; existing `daily/today` retained.
- [ ] AC7.5 — Invalid submission → dropped + logged; recurse to next.
- [ ] AC7.6 — Manual trigger via `gcloud scheduler jobs run daily-rotate` works without modification.

### Implementation slices

| Slice | Files |
|---|---|
| Endpoint | `apps/api/app/routers/daily.py:rotate` |
| OIDC verification | `apps/api/app/routers/daily.py` (middleware) |
| Daily repo | `apps/api/app/repositories/daily.py:set_today_and_archive` |
| Submissions repo | `apps/api/app/repositories/submissions.py:pop_oldest` |
| Scheduler config | `infra/scheduler.yaml` |

---

<a id="f8-cost-guard"></a>

## 9. F8 — Cost Guard

**Capability**: C8

### Spec ref

- Domain: [`04-domain-model.md#cost-guard`](./04-domain-model.md#cost-guard)
- Cost rules: [`15-cost-and-limits.md`](./15-cost-and-limits.md)
- Recording hook: [`06-ai-agent-layer.md#cost`](./06-ai-agent-layer.md#cost)

### Acceptance criteria

- [ ] AC8.1 — Every agent run (including retries) increments `costGuard/{today}.geminiCalls`.
- [ ] AC8.2 — Token counts + estimated USD cost recorded per run.
- [ ] AC8.3 — Before each agent run, `check_can_run_agent(today)` enforces caps (300 calls/day OR $1/day estimated).
- [ ] AC8.4 — Trip returns HTTP 503 `budget_exhausted` with a user-friendly message.
- [ ] AC8.5 — Submissions counter (`submissionsByDevice[deviceHash]`) enforces 5/day per device.
- [ ] AC8.6 — Hard cap: GCP Billing Budget at $15/month with Pub/Sub kill-switch (separate Cloud Function; see infra).

### Implementation slices

| Slice | Files |
|---|---|
| Service | `apps/api/app/services/cost_guard.py` |
| Repo | `apps/api/app/repositories/cost_guard.py` |
| Domain | `apps/api/app/domain/cost_guard.py` |
| Budget alert + kill switch | `infra/kill-switch/main.py`, GCP Billing setup (manual) |

---

<a id="status"></a>

## 10. Feature status board

Status values: `not started` · `spec complete` · `wip` · `done` · `released`.

| Feature | Status | Implementation %, est. | Last update |
|---|---|---|---|
| F1 Capture to Play | spec complete | 0% | 2026-05-20 |
| F2 Play Runtime | spec complete | 0% | 2026-05-20 |
| F3 Share via QR/URL | spec complete | 0% | 2026-05-20 |
| F4 Open Shared Level | spec complete | 0% | 2026-05-20 |
| F5 Daily World (read) | spec complete | 0% | 2026-05-20 |
| F6 Submit to Daily | spec complete | 0% | 2026-05-20 |
| F7 Daily Rotation (cron) | spec complete | 0% | 2026-05-20 |
| F8 Cost Guard | spec complete | 0% | 2026-05-20 |

Update this table in the same commit as the corresponding code change.

---

<a id="traceability"></a>

## 11. Traceability matrix

The canonical mapping. Every source file (when it exists) MUST appear here under the feature(s) it implements. Files that exist but are not in this table fail the spec-parity CI check.

| Source path | Feature(s) | Notes |
|---|---|---|
| `packages/shared/level.schema.json` | F1, F2, F3, F4, F5, F6, F7 | Single source of truth for Level shape |
| `packages/shared/vibes.json` | F2 | Vibe enum mirror |
| `apps/api/app/main.py` | (all) | FastAPI app + CORS + tracing setup |
| `apps/api/app/settings.py` | (all) | pydantic-settings |
| `apps/api/app/routers/analyze.py` | F1 | `/api/analyze` |
| `apps/api/app/routers/level.py` | F3, F4 | `/api/level/save`, `/api/level/{hash}` |
| `apps/api/app/routers/submit.py` | F6 | `/api/submit` |
| `apps/api/app/routers/daily.py` | F5, F7 | `/api/daily`, `/api/daily-rotate` |
| `apps/api/app/routers/health.py` | (ops) | `/healthz`, `/readyz` |
| `apps/api/app/agents/level_designer.py` | F1 | ADK agent |
| `apps/api/app/agents/prompts/level_designer.system.md` | F1 | system prompt |
| `apps/api/app/agents/prompts/level_designer.retry.md` | F1 | retry prompt |
| `apps/api/app/agents/schemas.py` | F1 | Pydantic from JSON Schema |
| `apps/api/app/domain/level.py` | F1, F2, F4, F6, F7 | Level + invariant validators |
| `apps/api/app/domain/vibes.py` | F2 | Vibe enum |
| `apps/api/app/domain/reachability.py` | F1, F6, F7 | A* pathfinding |
| `apps/api/app/domain/submission.py` | F6, F7 | Submission entity |
| `apps/api/app/domain/daily.py` | F5, F7 | DailyWorld entity |
| `apps/api/app/domain/cost_guard.py` | F8 | CostGuardRecord |
| `apps/api/app/domain/physics.py` | F1, F2 | physics constants |
| `apps/api/app/repositories/base.py` | (all) | AbstractRepository[T] |
| `apps/api/app/repositories/levels.py` | F3, F4 | levels/ collection |
| `apps/api/app/repositories/submissions.py` | F6, F7 | submissions/ |
| `apps/api/app/repositories/daily.py` | F5, F7 | daily/ |
| `apps/api/app/repositories/cost_guard.py` | F8 | costGuard/ |
| `apps/api/app/services/cost_guard.py` | F1, F6, F8 | Cap enforcement + recording |
| `apps/api/app/services/share_codec.py` | F4 | server-side decompress |
| `apps/api/app/adapters/firestore_client.py` | (all) | singleton client |
| `apps/api/app/adapters/vertex_client.py` | F1 | ADK + Vertex setup |
| `apps/api/app/telemetry/tracing.py` | (ops) | OTel + Cloud Trace |
| `apps/api/app/telemetry/logging.py` | (ops) | structlog |
| `apps/api/app/errors.py` | (all) | exception types |
| `apps/web/src/main.ts` | (all) | Vite entry |
| `apps/web/src/app.ts` | (all) | Phaser bootstrap + router |
| `apps/web/src/services/api.ts` | F1, F3, F4, F5, F6 | API client |
| `apps/web/src/services/camera.ts` | F1, F4 | getUserMedia + JPEG |
| `apps/web/src/services/storage.ts` | F4, F5 | IndexedDB |
| `apps/web/src/services/qr.ts` | F3, F4 | encode + decode |
| `apps/web/src/services/compression.ts` | F3, F4 | lz-string |
| `apps/web/src/scenes/BootScene.ts` | (all) | preload + transition |
| `apps/web/src/scenes/MenuScene.ts` | (entry) | home |
| `apps/web/src/scenes/CaptureScene.ts` | F1 | camera flow |
| `apps/web/src/scenes/LevelScene.ts` | F2, F4, F5 | game runtime |
| `apps/web/src/scenes/ResultScene.ts` | F2, F3, F6 | win/lose + share |
| `apps/web/src/game/builder.ts` | F2 | rect → tilemap |
| `apps/web/src/game/tile-mapping.ts` | F2 | 9-slice picker |
| `apps/web/src/game/physics.ts` | F2 | constants (mirror of API) |
| `apps/web/src/game/controls.ts` | F2 | touch + keyboard |
| `apps/web/src/ui/ScanOverlay.ts` | F1 | scan animation |
| `apps/web/src/ui/ShareSheet.ts` | F3 | share UI |
| `apps/web/src/domain/level.ts` | (all) | generated TS types |
| `apps/web/src/domain/vibes.ts` | F2 | generated TS |
| `infra/firebase.json` | F3, F4 | hosting rewrites + cache headers |
| `infra/cloudrun.service.yaml` | (deploy) | service definition |
| `infra/scheduler.yaml` | F7 | daily-rotate job |
| `infra/firestore.rules` | (security) | deny-all client |
| `infra/firestore.indexes.json` | F7 | submissions order_by createdAt |
| `infra/kill-switch/main.py` | F8 | billing kill switch |

---

_End of 09 — Features._
