# 07 — API Contracts

> **Status**: normative · **Owner**: project lead · **Last revised**: 2026-05-20

The HTTP surface of `apps/api`. Every endpoint here is what `apps/web` is allowed to call. Anything not on this list, `apps/web` MUST NOT call.

The canonical machine-readable contract is [`packages/shared/api.openapi.yaml`](../packages/shared/api.openapi.yaml). This doc is the human-readable mirror; both must stay in sync.

---

## Table of Contents

1. [Conventions](#conventions)
2. [Endpoint summary](#summary)
3. [`POST /api/analyze`](#analyze)
4. [`POST /api/level/save`](#save)
5. [`GET /api/level/{hash}`](#get-level)
6. [`POST /api/submit`](#submit)
7. [`GET /api/daily`](#daily-get)
8. [`POST /api/daily-rotate`](#daily-rotate)
9. [`GET /healthz` and `GET /readyz`](#health)
10. [Error envelope](#errors)

---

<a id="conventions"></a>

## 1. Conventions

- **Base URL** (prod): `https://mirror-realm-api-<hash>-as.a.run.app`. Aliased behind `https://mirror-realm.web.app/api/*` via Firebase Hosting rewrites.
- **Content-Type**: `application/json` everywhere. Photo upload uses base64 in JSON (small enough at ≤200KB) so we don't need multipart.
- **Authentication**: none from the browser. The only authenticated endpoint is `/api/daily-rotate`, which requires OIDC from Cloud Scheduler's service account.
- **CORS**: allowlist is exactly `https://mirror-realm.web.app` + `http://localhost:5173` (local dev). Configured in `app/main.py`. Anything else is rejected.
- **Method semantics**: GET is safe + cacheable; POST is everything else. No PUT/PATCH/DELETE in v1.
- **Timeouts**: server-side limit per endpoint listed below. Clients must set `AbortController` with the same limit + 2s.
- **All timestamps**: ISO 8601 UTC, suffix `Z`. Example: `"2026-05-20T14:32:11Z"`.
- **Response envelope**: success responses return the resource directly. Errors use the envelope in [`§10`](#errors).
- **Version header**: every response includes `X-MR-API-Version: 1`. Bumping is a breaking change.

<a id="summary"></a>

## 2. Endpoint summary

| Method | Path | Purpose | Auth | Timeout |
|---|---|---|---|---|
| `POST` | `/api/analyze` | Photo → Level JSON | none (CORS) | 25s |
| `POST` | `/api/level/save` | Persist large Level for short URL | none (CORS) | 5s |
| `GET` | `/api/level/{hash}` | Fetch Level by short hash | none (CORS) | 3s |
| `POST` | `/api/submit` | Add Level to Daily World pool | none (CORS) + deviceHash | 3s |
| `GET` | `/api/daily` | Get today's Daily World level | none (CORS) | 3s |
| `POST` | `/api/daily-rotate` | Rotate Daily World (cron only) | OIDC SA | 10s |
| `GET` | `/healthz` | Liveness | none | 1s |
| `GET` | `/readyz` | Readiness | none | 3s |

<a id="analyze"></a>

## 3. `POST /api/analyze`

Capture-to-play core. Implements capability C1.

### Request

```json
{
  "photo": "<base64-encoded JPEG, ≤ 200KB encoded, ≤ 300KB raw>",
  "deviceHash": "<8-64 char client-generated id>"
}
```

**Pydantic model (server-side):**

```python
# apps/api/app/routers/analyze.py
# docs: 07-api-contracts.md#analyze
from pydantic import BaseModel, Field

class AnalyzeRequest(BaseModel):
    photo: str = Field(min_length=100, max_length=320_000)   # base64 of ≤200KB JPEG
    deviceHash: str = Field(min_length=8, max_length=64)

    model_config = {"extra": "forbid"}
```

### Response — 200 OK

```json
{
  "level": { /* Level — see docs/04-domain-model.md#level */ },
  "wasUnreachableOnFirstAttempt": false,
  "tracingId": "01HXYZ..."   // OTel trace id; client may surface this in error dialogs
}
```

```python
class AnalyzeResponse(BaseModel):
    level: Level
    wasUnreachableOnFirstAttempt: bool = False
    tracingId: str
```

### Error responses

| Status | `error.code` | Trigger |
|---|---|---|
| 400 | `validation_failed` | Pydantic validation of request body fails |
| 422 | `safety_filter` | Vertex's safety filter blocked the photo |
| 503 | `budget_exhausted` | Daily cost guard tripped |
| 504 | `agent_timeout` | Total time exceeded 25s |
| 500 | `agent_error` | Unhandled agent error |

### Handler shape

```python
# apps/api/app/routers/analyze.py
# docs: 07-api-contracts.md#analyze
from datetime import date
from fastapi import APIRouter, HTTPException
from base64 import b64decode

from ..agents.level_designer import run_level_designer
from ..domain.reachability import check_reachable
from ..domain.level import validate_endpoints
from ..services.cost_guard import CostGuard
from ..errors import BudgetExhausted, SafetyFilterError, AgentTimeoutError

router = APIRouter(prefix="/api", tags=["analyze"])

@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest, cg: CostGuard = ...) -> AnalyzeResponse:
    today = date.today()
    await cg.check_can_run_agent(today)

    image_bytes = b64decode(req.photo)
    first = await run_level_designer(image_bytes=image_bytes)
    await cg.record_agent_run(today, input_tokens=first.input_tokens, output_tokens=first.output_tokens)

    violations = validate_endpoints(first.level) + (
        [] if check_reachable(first.level) else
        ["The path from spawn to goal is not reachable with one chain of jumps."]
    )

    if not violations:
        return AnalyzeResponse(level=first.level, wasUnreachableOnFirstAttempt=False, tracingId=...)

    retry = await run_level_designer(image_bytes=image_bytes, violations_for_retry=violations)
    await cg.record_agent_run(today, input_tokens=retry.input_tokens, output_tokens=retry.output_tokens)

    # Return retry regardless; flag if still bad.
    still_bad = bool(validate_endpoints(retry.level)) or not check_reachable(retry.level)
    return AnalyzeResponse(level=retry.level, wasUnreachableOnFirstAttempt=still_bad, tracingId=...)
```

<a id="save"></a>

## 4. `POST /api/level/save`

Persists a Level for the short-URL share path (C3 fallback when QR-inline is too big).

### Request

```json
{
  "level": { /* Level */ },
  "deviceHash": "<8-64 chars>"
}
```

```python
class SaveLevelRequest(BaseModel):
    level: Level
    deviceHash: str = Field(min_length=8, max_length=64)
    model_config = {"extra": "forbid"}
```

### Response — 200 OK

```json
{
  "hash": "aB3xQ9",
  "url": "https://mirror-realm.web.app/l/aB3xQ9",
  "expiresAt": "2026-06-19T00:00:00Z"
}
```

### Behavior

- Server computes `hash = sha256(canonical_json(level))[:6]`. If a doc with that hash already exists and the stored level matches, reuse it (idempotent).
- If hash collides with a different level (astronomically unlikely at 6 chars over 30 days), retry with 7 chars; if still colliding, return 500.
- TTL is set to `createdAt + 30 days`. Firestore TTL policy auto-deletes.

### Errors

| Status | code |
|---|---|
| 400 | `validation_failed` |
| 500 | `hash_collision` |

<a id="get-level"></a>

## 5. `GET /api/level/{hash}`

Fetches a previously saved Level. Used by the `/l/{hash}` PWA route.

### Response — 200 OK

```json
{
  "level": { /* Level */ },
  "savedAt": "2026-05-20T14:32:11Z"
}
```

### Errors

| Status | code |
|---|---|
| 404 | `not_found` |
| 410 | `expired` (TTL hit but doc not yet GC'd) |

<a id="submit"></a>

## 6. `POST /api/submit`

Adds a Level to the Daily World pool. Implements C6.

### Request

```json
{
  "level": { /* Level */ },
  "deviceHash": "<8-64 chars>"
}
```

### Response — 200 OK

```json
{
  "status": "queued",
  "contentHash": "ab3cd4e5f678"
}
```

If the same level (same `contentHash`) is submitted again, response is:

```json
{
  "status": "already_queued",
  "contentHash": "ab3cd4e5f678"
}
```

### Behavior

- Re-validate the Level (schema + invariants + reachability). Defense in depth: a malicious client could send a known-bad level to poison the pool.
- Compute `contentHash = sha256(canonical_json(level))[:12]`.
- Check rate limit: `costGuard/today.submissionsByDevice[deviceHash] < 5`.
- Write `submissions/{contentHash}` and increment counters.

### Errors

| Status | code |
|---|---|
| 400 | `validation_failed` |
| 422 | `unreachable_level` |
| 429 | `submission_rate_limited` |

<a id="daily-get"></a>

## 7. `GET /api/daily`

Returns today's Daily World level. Implements C5.

### Response — 200 OK

```json
{
  "forDate": "2026-05-20",
  "level": { /* Level */ },
  "isFromYesterday": false
}
```

### Behavior

- Reads `daily/today`.
- If `daily/today.forDate < today (UTC)` (cron failed), the server returns the same doc with `isFromYesterday: true` and logs `daily_stale`.
- Response is cacheable for 1 hour on the CDN edge via `Cache-Control: public, max-age=3600`. Cloud Run sets this header.

### Errors

| Status | code |
|---|---|
| 404 | `no_daily_yet` (cold project — no daily ever set) |

<a id="daily-rotate"></a>

## 8. `POST /api/daily-rotate`

Cron-triggered. Implements C7.

### Auth

Requires OIDC token from `mirror-realm-scheduler@<project>.iam.gserviceaccount.com`. The handler verifies the `Authorization: Bearer <id-token>` header. Anonymous calls return 401.

### Request

No body. Empty POST.

### Response — 200 OK

```json
{
  "rotated": true,
  "forDate": "2026-05-20",
  "promotedFromSubmissionHash": "ab3cd4e5f678"
}
```

If queue empty:

```json
{
  "rotated": false,
  "reason": "empty_queue",
  "keptDailyForDate": "2026-05-19"
}
```

### Behavior

1. `pop_oldest()` from `submissions`.
2. If null → return `rotated: false`.
3. Validate level (defense in depth). If invalid, drop and recurse to next-oldest. Log `submission_dropped`.
4. Build `DailyWorld(forDate=today, level=..., promotedFromSubmissionHash=...)`.
5. `set_today_and_archive(world)`.
6. Return `rotated: true`.

<a id="health"></a>

## 9. `GET /healthz` and `GET /readyz`

### `/healthz` — liveness

Always returns 200 with `{"status": "ok"}`. No external calls. Used by Cloud Run health checks.

### `/readyz` — readiness

Returns 200 only if:
- Firestore client can list the `costGuard` collection (1 doc).
- Vertex AI auth token can be obtained (lightweight ADC check).

Returns 503 with `{"status": "not_ready", "checks": {...}}` otherwise.

<a id="errors"></a>

## 10. Error envelope

All non-2xx responses use this shape:

```json
{
  "error": {
    "code": "budget_exhausted",
    "message": "We're full for the month — try yesterday's Daily World.",
    "tracingId": "01HXYZ..."
  }
}
```

```python
# apps/api/app/errors.py
# docs: 07-api-contracts.md#errors
from pydantic import BaseModel

class ApiErrorDetail(BaseModel):
    code: str
    message: str
    tracingId: str | None = None

class ApiErrorResponse(BaseModel):
    error: ApiErrorDetail
```

### Canonical error codes

| code | HTTP | When |
|---|---|---|
| `validation_failed` | 400 | Pydantic request validation fails |
| `not_found` | 404 | Resource not present |
| `expired` | 410 | TTL hit |
| `safety_filter` | 422 | Vertex safety filter blocked input |
| `unreachable_level` | 422 | Submitted level fails reachability |
| `submission_rate_limited` | 429 | Submitted >5 times today |
| `budget_exhausted` | 503 | Cost guard tripped |
| `firestore_unavailable` | 503 | Firestore reachability failure |
| `agent_timeout` | 504 | Wall clock exceeded |
| `agent_error` | 500 | Other agent failure |
| `internal` | 500 | Unhandled |

Codes are stable. New codes are added; existing codes are never renamed or repurposed.

---

_End of 07 — API Contracts._
