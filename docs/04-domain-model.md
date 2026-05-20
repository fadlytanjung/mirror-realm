# 04 — Domain Model

> **Status**: normative · **Owner**: project lead · **Last revised**: 2026-05-20

The entities, their invariants, and the physics constants the game world obeys. The source-of-truth for entity shapes is `packages/shared/*.schema.json`; the code blocks here mirror them and **must stay in sync**.

---

## Table of Contents

1. [Entity catalog](#catalog)
2. [Level](#level)
3. [Vibe](#vibes)
4. [Submission](#submission)
5. [DailyWorld](#daily)
6. [CostGuardRecord](#cost-guard)
7. [Player physics constants](#physics)
8. [Invariants checked server-side](#invariants)

---

<a id="catalog"></a>

## 1. Entity catalog

| Entity | Lives in | Persistence | Cardinality |
|---|---|---|---|
| **Level** | request/response + Firestore `levels/` | written only on Share-via-URL (C3) or Submit (C6) | ephemeral by default; persisted on user action |
| **Vibe** | static enum + `packages/shared/vibes.json` | bundled with PWA | exactly 12 |
| **Submission** | Firestore `submissions/` | TTL 30 days | many (rate-limited 5/day per deviceHash) |
| **DailyWorld** | Firestore `daily/today` (+ `daily/YYYY-MM-DD` archive) | rotated by cron | one current + one per past day |
| **CostGuardRecord** | Firestore `costGuard/{YYYY-MM-DD}` | overwritten | one per day |

There are no User, Profile, or Session entities. There is no authentication state to model.

<a id="level"></a>

## 2. Level

A Level is the central artifact: the JSON document that flows from agent to client and is the unit of sharing.

**Canonical schema**: [`packages/shared/level.schema.json`](../packages/shared/level.schema.json)

### Python (Pydantic) — generated from the schema

```python
# apps/api/app/agents/schemas.py
# docs: 04-domain-model.md#level
# Generated from packages/shared/level.schema.json — DO NOT EDIT BY HAND
from typing import Literal
from pydantic import BaseModel, Field, conint, conlist

class Rect(BaseModel):
    x: conint(ge=0, le=1920)
    y: conint(ge=0, le=540)
    w: conint(ge=16, le=1920)
    h: conint(ge=16, le=540)
    label: str | None = Field(default=None, max_length=64)

class Decoration(BaseModel):
    x: conint(ge=0, le=1920)
    y: conint(ge=0, le=540)
    label: str | None = Field(default=None, max_length=64)

class Point(BaseModel):
    x: conint(ge=0, le=1920)
    y: conint(ge=0, le=540)

VIBES = Literal[
    "cozy", "neon", "ruined", "forest", "vapor", "desert",
    "industrial", "snow", "underwater", "library", "cosmic", "monochrome",
]

class Level(BaseModel):
    schemaVersion: Literal["1.0.0"] = "1.0.0"
    vibe: VIBES
    platforms: conlist(Rect, min_length=4, max_length=12)
    hazards: conlist(Rect, max_length=3) = []
    decorations: conlist(Decoration, max_length=16) = []
    spawn: Point
    goal: Point

    model_config = {"extra": "forbid"}
```

### TypeScript — generated for the PWA

```ts
// apps/web/src/domain/level.ts
// docs: 04-domain-model.md#level
// Generated from packages/shared/level.schema.json — DO NOT EDIT BY HAND
export type Vibe =
  | 'cozy' | 'neon' | 'ruined' | 'forest' | 'vapor' | 'desert'
  | 'industrial' | 'snow' | 'underwater' | 'library' | 'cosmic' | 'monochrome';

export interface Rect {
  x: number; y: number; w: number; h: number;
  label?: string;
}

export interface Decoration { x: number; y: number; label?: string }
export interface Point { x: number; y: number }

export interface Level {
  schemaVersion: '1.0.0';
  vibe: Vibe;
  platforms: Rect[];            // length 4..12
  hazards?: Rect[];             // length 0..3
  decorations?: Decoration[];   // length 0..16
  spawn: Point;
  goal: Point;
}
```

### Coordinate system

- World is **1920×540** (logical pixels). Origin at top-left.
- Ground line conceptually at `y = 480` — platforms can be above or below, but the agent should place "floor" platforms around `y = 460-500`.
- Player sprite is **24×32**. `spawn` and `goal` are top-left corners of where to place the player and goal flag.

<a id="vibes"></a>

## 3. Vibe

A fixed enum of 12 values. **Source of truth**: the `enum` array in `level.schema.json` AND the `vibes` array in `vibes.json`. CI verifies they match.

```ts
// shape of packages/shared/vibes.json (see file for actual data)
interface VibeMetadata {
  id: Vibe;
  source: string;        // human-readable provenance
  palette: string[];     // 2-3 hex colors for UI accents
  tilesetPath: string;   // /tilesets/{id}.png (served by Firebase Hosting)
  fallback?: boolean;    // true on "cozy" only — used when agent picks badly
}
```

**Fallback rule**: if Gemini somehow returns an out-of-enum vibe (shouldn't happen with `responseSchema`), or if the response fails validation in a way that loses the vibe field, the API substitutes `cozy` and logs a `vibe_fallback` event.

<a id="submission"></a>

## 4. Submission

A user-created Level offered to the Daily World pool.

```python
# apps/api/app/domain/submission.py
# docs: 04-domain-model.md#submission
from datetime import datetime
from pydantic import BaseModel, Field
from .level import Level

class Submission(BaseModel):
    contentHash: str = Field(min_length=8, max_length=16)   # Firestore doc id
    level: Level
    deviceHash: str = Field(min_length=8, max_length=64)    # anonymous client id
    createdAt: datetime
    ttl: datetime                                           # createdAt + 30 days; Firestore TTL field

    model_config = {"extra": "forbid"}
```

### Invariants

- `contentHash = sha256(canonical_json(level))[:12]`. Idempotent — re-submitting the same level overwrites the same doc (no dupes pile up).
- `deviceHash` is a client-generated random ID stored in IndexedDB. **Not** a fingerprint; it's only for rate-limiting. The user can clear it.
- **Rate limit**: max 5 submissions/day per `deviceHash`. Enforced in `apps/api/app/services/cost_guard.py` (yes, same service — it tracks all daily counters).
- Submissions are queued FIFO by `createdAt`; Daily World rotation pops the oldest.

<a id="daily"></a>

## 5. DailyWorld

Today's globally shared level, plus archive.

```python
# apps/api/app/domain/daily.py
# docs: 04-domain-model.md#daily
from datetime import date, datetime
from pydantic import BaseModel
from .level import Level

class DailyWorld(BaseModel):
    forDate: date           # YYYY-MM-DD UTC
    level: Level
    promotedFromSubmissionHash: str | None    # provenance, nullable for seeded levels
    rotatedAt: datetime

    model_config = {"extra": "forbid"}
```

### Storage layout

```
/daily/today                    # mutable pointer; rotated nightly
/daily/{YYYY-MM-DD}             # immutable archive doc
```

`daily/today` always equals the doc whose `forDate` is the current UTC date. Reading the archive lets a user replay yesterday's level if they missed it.

### Rotation rules

- Cron fires at **00:00 UTC** every day.
- The handler reads the oldest submission, validates it again (defense in depth: vibe enum check, reachability re-check), writes it to both `daily/today` and `daily/{date}`, deletes the submission.
- If the submission queue is empty, the handler leaves `daily/today` untouched and logs `daily_rotation_skipped: empty_queue`. The previous day's level remains live.

<a id="cost-guard"></a>

## 6. CostGuardRecord

The daily counter that backs the budget kill-switch's early-warning behavior (the actual hard kill-switch is the GCP billing alert + Pub/Sub function — see [`15-cost-and-limits.md`](./15-cost-and-limits.md)).

```python
# apps/api/app/domain/cost_guard.py
# docs: 04-domain-model.md#cost-guard
from datetime import date, datetime
from pydantic import BaseModel, NonNegativeInt, NonNegativeFloat

class CostGuardRecord(BaseModel):
    forDate: date                       # doc id == YYYY-MM-DD
    geminiCalls: NonNegativeInt = 0
    geminiInputTokens: NonNegativeInt = 0
    geminiOutputTokens: NonNegativeInt = 0
    estimatedCostUsd: NonNegativeFloat = 0.0
    submissions: NonNegativeInt = 0     # also tracked here for rate limiting
    submissionsByDevice: dict[str, NonNegativeInt] = {}    # deviceHash -> count
    updatedAt: datetime

    model_config = {"extra": "forbid"}
```

### Daily caps (soft, in-app)

| Counter | Soft cap | What happens at cap |
|---|---|---|
| `geminiCalls` | **300/day** | `/api/analyze` returns 503 `budget_exhausted` |
| `submissionsByDevice[deviceHash]` | **5/day** | `/api/submit` returns 429 `submission_rate_limited` |
| `estimatedCostUsd` | **$1/day** | `/api/analyze` returns 503 `budget_exhausted` (whichever soft cap trips first) |

The hard cap is the billing kill-switch ($15/month), described in [`15-cost-and-limits.md`](./15-cost-and-limits.md).

<a id="physics"></a>

## 7. Player physics constants

These are **part of the spec**. The reachability checker uses the same values that the Phaser runtime applies. If you change one in code, change it here.

```python
# apps/api/app/domain/physics.py
# docs: 04-domain-model.md#physics
PLAYER_W = 24
PLAYER_H = 32

GRAVITY = 1400.0          # px/s² downward
MOVE_VEL = 250.0          # px/s horizontal
JUMP_VEL = 600.0          # px/s upward impulse on jump

# Derived (for sanity / agent prompt):
MAX_JUMP_HEIGHT = 128.0   # ≈ JUMP_VEL² / (2 * GRAVITY)
MAX_JUMP_DISTANCE = 220.0 # horizontal reach during one jump arc at MOVE_VEL
COYOTE_FRAMES = 6         # forgiveness window when running off ledge
```

```ts
// apps/web/src/game/physics.ts
// docs: 04-domain-model.md#physics
export const PLAYER_W = 24;
export const PLAYER_H = 32;
export const GRAVITY = 1400;
export const MOVE_VEL = 250;
export const JUMP_VEL = 600;
export const MAX_JUMP_HEIGHT = 128;
export const MAX_JUMP_DISTANCE = 220;
export const COYOTE_FRAMES = 6;
```

The agent's system prompt (see [`06-ai-agent-layer.md`](./06-ai-agent-layer.md)) gets these numbers injected at build time so the LLM's spatial constraints stay aligned.

<a id="invariants"></a>

## 8. Invariants checked server-side

For every Level produced by the agent or accepted from a client (share-save, submit), the API enforces:

| # | Invariant | Where enforced |
|---|---|---|
| I1 | JSON-Schema valid (Pydantic strict, extra=forbid) | `app/agents/schemas.py` |
| I2 | `spawn` and `goal` are inside the world bounds and not overlapping a platform | `app/domain/level.py:validate_endpoints()` |
| I3 | `goal.x >= spawn.x + 800` (forces lateral traversal) | same |
| I4 | No platform overlaps `spawn` or `goal` by more than 8px | same |
| I5 | A* path exists from `spawn` to `goal` using player physics | `app/domain/reachability.py` |
| I6 | All platforms are within world bounds | implicit via Rect constraints |
| I7 | At least one platform's `y` is within 32px of `spawn.y + PLAYER_H` (ground beneath the spawn) | `app/domain/level.py:validate_endpoints()` |
| I8 | Vibe is in the enum (already enforced by Literal type) | type system |

**Failure handling**:

- I1-I4, I6-I8 fail → reject the candidate; retry the agent once with the violated invariant injected into the retry prompt.
- I5 fails → retry once with stricter physics constraints in the retry prompt.
- After one retry: accept the candidate even if still failing, but mark `wasUnreachableOnFirstAttempt: true` in the API response so the client can show a hint.

---

_End of 04 — Domain Model._
