# 14 — Testing Strategy

> **Status**: normative · **Owner**: project lead · **Last revised**: 2026-05-20

What gets tested, where, and how. Strict separation between unit / integration / golden / e2e — they have different runtimes, different cost profiles, and different CI gating.

---

## Table of Contents

1. [Testing pyramid](#pyramid)
2. [Backend unit tests](#backend-unit)
3. [Backend integration tests (Firestore emulator)](#backend-integration)
4. [Golden AI tests](#golden)
5. [Frontend unit tests](#frontend-unit)
6. [End-to-end (Playwright)](#e2e)
7. [Spec-parity checks](#spec-parity)
8. [Coverage targets](#coverage)
9. [What we don't test](#anti)

---

<a id="pyramid"></a>

## 1. Testing pyramid

```
        /\
       /  \   e2e Playwright (web ↔ deployed api)        ── manual + nightly
      /----\
     /      \  golden AI (real Vertex)                    ── gated by env, manual
    /--------\
   /          \  backend integration (Firestore emulator) ── on PR
  /------------\
 /              \  unit tests (web vitest + api pytest)   ── on every commit
'----------------'
```

| Layer | Where it runs | Speed | Cost |
|---|---|---|---|
| Unit | Local + CI | Seconds | $0 |
| Integration | Local + CI (emulator) | Seconds-minute | $0 |
| Golden AI | Local + manual prod sweeps | ~30s per sample | ~$0.01 per sample |
| E2E | Local against `pnpm dev` + nightly against staging | 1-2 min | Negligible |

Default `pnpm test` runs **unit + integration** only. Golden + e2e are explicit.

<a id="backend-unit"></a>

## 2. Backend unit tests

Live in `apps/api/tests/unit/`. Use pytest + pytest-asyncio.

Rules:

- One test class per module under test (e.g. `tests/unit/test_reachability.py` for `app/domain/reachability.py`).
- No network, no Firestore (even emulator), no Vertex.
- Use `FakeAgent` ([`06-ai-agent-layer.md#local-test`](./06-ai-agent-layer.md#local-test)) for any code path touching the agent layer.
- Mock time with `freezegun` when testing TTL math.
- Each test name reads as a sentence: `test_pop_oldest_returns_none_when_queue_is_empty`.

What to test:

| File | Tests |
|---|---|
| `domain/level.py` | All eight invariant validators, edge cases (empty platforms, spawn-overlapping-platform, etc.) |
| `domain/reachability.py` | Known-reachable layout passes; known-unreachable fails; performance: 200ms ceiling honored on a 12-platform world |
| `domain/cost_guard.py` (record model) | Pydantic round-trip; non-negative constraints |
| `services/cost_guard.py` | Cap-tripping logic; estimated cost math |
| `services/share_codec.py` | lz-string compat with the frontend (round-trip a fixture vector) |
| `agents/level_designer.py` (with FakeAgent) | Retry triggered when violations exist; not triggered when none |
| `routers/*` | Request validation; happy + error paths (HTTPX async client + dep override) |

<a id="backend-integration"></a>

## 3. Backend integration tests (Firestore emulator)

Live in `apps/api/tests/integration/`. Require the Firestore emulator to be running.

```bash
# Run emulator + tests in one go (fixture in conftest manages emulator lifecycle if FIRESTORE_EMULATOR_HOST is unset)
cd apps/api
uv run pytest tests/integration -q
```

Conftest fixture:

```python
# apps/api/tests/integration/conftest.py
# docs: 14-testing-strategy.md#backend-integration
import os
import pytest
import pytest_asyncio
from google.cloud import firestore

@pytest_asyncio.fixture
async def fs_client():
    assert os.environ.get("FIRESTORE_EMULATOR_HOST"), \
        "Set FIRESTORE_EMULATOR_HOST=127.0.0.1:8081 before running integration tests"
    client = firestore.AsyncClient(project="mirror-realm-test")
    yield client
    # Clean: delete all docs from collections we touched
    for col in ("levels", "submissions", "daily", "costGuard"):
        async for doc in client.collection(col).stream():
            await doc.reference.delete()
```

Tests cover:

- Each repository's CRUD against a real emulator.
- `pop_oldest()` ordering correctness with multiple submissions.
- `set_today_and_archive()` writes both docs atomically (we assert both exist post-call).
- Atomic increments on `CostGuardRepository.increment_*` survive parallel calls (use asyncio.gather of N tasks).
- Router-level tests for the cron endpoint, mounting the real router + emulator + FakeAgent.

<a id="golden"></a>

## 4. Golden AI tests

Live in `apps/api/tests/golden/`. **Call real Vertex AI** with `gemini-3.1-flash-lite`. Cost: ~$0.01 per run. Gated by env var so CI doesn't accidentally pay for them.

```bash
# Only run when explicitly enabled
GOLDEN_AI=1 cd apps/api && uv run pytest tests/golden -q
```

Layout:

```
apps/api/tests/golden/
├── conftest.py
├── fixtures/
│   ├── desk.jpg              # ~150KB; messy desk
│   ├── street.jpg            # ~140KB; daylit street
│   ├── coffee.jpg            # ~120KB; cafe scene
│   └── lamp_at_night.jpg     # ~130KB; low light
└── test_level_designer.py
```

Each test asserts **shape and physics**, not exact content:

```python
# apps/api/tests/golden/test_level_designer.py (skeleton)
# docs: 14-testing-strategy.md#golden
import pytest
from pathlib import Path
from app.agents.level_designer import run_level_designer
from app.domain.reachability import check_reachable
from app.domain.level import validate_endpoints

FIXTURES = Path(__file__).parent / "fixtures"

@pytest.mark.golden
@pytest.mark.parametrize("photo", [
    "desk.jpg", "street.jpg", "coffee.jpg", "lamp_at_night.jpg",
])
async def test_real_vertex_produces_reachable_level(photo):
    image_bytes = (FIXTURES / photo).read_bytes()
    run = await run_level_designer(image_bytes=image_bytes)
    assert len(run.level.platforms) >= 4
    assert validate_endpoints(run.level) == [], "endpoint invariants must hold"
    # Reachability MAY fail on first attempt — that's OK for the agent; the router retries.
    # But the level should be schema-conformant unconditionally (Pydantic already enforced that).
```

When to run:

- Before a release (manual).
- After any change to `level_designer.system.md` or the response schema.
- Once a month to detect Gemini model drift.

If we ever automate this in CI, gate to nightly + a budget hard-cap.

<a id="frontend-unit"></a>

## 5. Frontend unit tests

Live in `apps/web/tests/unit/`. Use vitest.

```bash
pnpm --filter web test
```

What to test:

| Module | Tests |
|---|---|
| `services/compression.ts` | Round-trip fixture levels; lz-string interop with backend `share_codec.py` (shared fixture) |
| `services/qr.ts` | encode→decode round-trip via canvas |
| `services/storage.ts` | IndexedDB CRUD with `fake-indexeddb` |
| `game/builder.ts` | Given a Level, returns expected tile groups (count, positions) |
| `game/controls.ts` | Pointer events → expected control state changes |
| `app.ts:parseHash` | Each route variant parses correctly; malformed hashes fall back to `home` |

Phaser scenes themselves are not unit-tested; their behavior is covered by e2e.

<a id="e2e"></a>

## 6. End-to-end (Playwright)

Live in `apps/web/tests/e2e/`. Run with the dev server up.

```bash
# Terminal 1: backend with emulator
FIRESTORE_EMULATOR_HOST=127.0.0.1:8081 uv run uvicorn app.main:app --port 8080 &

# Terminal 2
pnpm --filter web dev &

# Terminal 3
pnpm --filter web test:e2e
```

Scenarios:

| ID | Scenario |
|---|---|
| E1 | Home → Camera → mock-photo upload → API returns canned level → playable |
| E2 | Win the level → Share modal → QR rendered → URL copyable |
| E3 | Visit `/p/<knownGoodCompressedLevel>` → playable without API call |
| E4 | Visit `/l/<unknownHash>` → friendly 404 → return to home |
| E5 | Open `/#/daily` → API returns daily → renders with vibe label |
| E6 | Submit flow: win → submit button → POST `/api/submit` 200 → "In the pool!" |

For E1, the camera is mocked by injecting a base64 fixture into the capture flow via a test-only `?testPhoto=fixtures/desk.jpg` query param recognized only in dev mode.

For Mobile Safari coverage, Playwright's WebKit project is good enough; we don't have a real iOS device CI farm.

<a id="spec-parity"></a>

## 7. Spec-parity checks

CI guarantees that the docs (this folder) and the code agree on schemas, env vars, and endpoint paths.

### Generated-files check

```bash
# pnpm gen:check (run in CI before tests)
pnpm gen
git diff --exit-code apps/web/src/domain/level.ts apps/web/src/domain/vibes.ts apps/api/app/agents/schemas.py
```

If the generators produce any diff, CI fails with "regenerate types via `pnpm gen` and commit".

### Endpoint-path check

A small Python script in `infra/scripts/check_endpoint_parity.py` walks `apps/api/app/routers/*.py`, extracts route decorators, and compares to the endpoint table in [`07-api-contracts.md#summary`](./07-api-contracts.md#summary). Discrepancies fail CI.

### Env-var check

`infra/scripts/check_env_parity.py` scans `apps/api/app/settings.py` for declared `MR_*` vars, compares to the table in [`10-local-development.md#env`](./10-local-development.md#env). New vars in code → must appear in `.env.example` + the doc.

### Traceability-matrix check

`infra/scripts/check_traceability.py` cross-references files under `apps/api/app/` and `apps/web/src/` against [`09-features.md#traceability`](./09-features.md#traceability). Orphan files (in code, not in matrix) and stale entries (in matrix, file missing) both fail CI.

These three scripts are the **enforcement teeth** of the SDD contract. Without them, docs would drift.

<a id="coverage"></a>

## 8. Coverage targets

Aspirational, not gated in CI (this is a personal project):

| Layer | Target |
|---|---|
| Backend unit | 85% |
| Backend integration (combined) | ≥ 90% of routers and repositories executed |
| Frontend unit | 70% (Phaser scenes intentionally skip) |
| E2E | All 6 scenarios green nightly |

Coverage is reported via `pytest --cov` and `vitest --coverage`, surfaced as a CI artifact. Don't game it.

<a id="anti"></a>

## 9. What we don't test

- Phaser internals
- Vertex AI internals — we trust the service
- Cloud Run / Firestore SDK internals — same
- "Does GCP work" — that's their job
- UI pixel-perfect visual regression — pixel-art tilesets are deterministic by design; we don't need visual diff tooling
- Load testing — capped at 5 concurrent instances, max realistic load is 80 concurrent users; no load issues to chase
- Browser security (XSS / CSP) — we have no user-generated HTML

Add a test for a class of failure when it actually happens once, not before.

---

_End of 14 — Testing Strategy._
