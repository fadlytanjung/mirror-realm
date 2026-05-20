# 06 — AI Agent Layer

> **Status**: normative · **Owner**: project lead · **Last revised**: 2026-05-20

The heart of the product. Defines the Google ADK setup, the single `LevelDesignerAgent`, prompts (as files, not strings), schema-constrained outputs, retry policy, and tracing. Everything Gemini-related lives downstream of this doc.

---

## Table of Contents

1. [Why ADK (and not raw Vertex SDK)](#why-adk)
2. [Agent inventory](#inventory)
3. [`LevelDesignerAgent`](#level-designer)
4. [Prompts](#prompts)
5. [Response schema](#response-schema)
6. [Retry policy](#retry)
7. [Tracing](#tracing)
8. [Cost recording hook](#cost)
9. [Local testing without burning quota](#local-test)

---

<a id="why-adk"></a>

## 1. Why ADK (and not raw Vertex SDK)

Both work. We pick ADK for these specific reasons — if all of them stop being true, revisit.

| Reason | What ADK gives us |
|---|---|
| **Native OpenTelemetry tracing** | One trace tree from FastAPI handler down through `agent.run()` → Vertex call. Manual OTel wiring is doable but error-prone. |
| **Session abstraction** | Even our single-turn agent benefits from session/event semantics for trace-grouping multi-step runs (e.g., the retry round). |
| **Prompt-as-file convention** | ADK encourages loading system instructions from files. Reviewable in git diffs; not buried in Python string literals. |
| **Future-proof for tool use** | If we add a "place a tile" tool later (stretch idea), ADK's `Tool` abstraction is already in place. |
| **Cloud-native** | Built by Google, deploys cleanly to Cloud Run with workload identity. |

What ADK does NOT do for us, and we manage ourselves:

- Cost accounting → see [`§8`](#cost) below
- Schema validation of model output → we validate with Pydantic on top
- Reachability checking → our own A* in `app/domain/reachability.py`

Reference: [adk.dev/get-started/](https://adk.dev/get-started/).

<a id="inventory"></a>

## 2. Agent inventory

v1 has exactly one agent:

| Agent | Purpose | Inputs | Outputs |
|---|---|---|---|
| **`LevelDesignerAgent`** | Convert a photo into a playable Level | JPEG bytes (≤200KB) | `Level` (Pydantic, schema-validated) |

No router agents, no multi-agent setups, no tools. v1 is one shot in, one shot out.

If you find yourself wanting a second agent, write the spec entry here first and explain why a function call wouldn't do.

<a id="level-designer"></a>

## 3. `LevelDesignerAgent`

Skeleton — adjust ADK class names if upstream API shifts; the **contract** below is what's normative.

```python
# apps/api/app/agents/level_designer.py
# docs: 06-ai-agent-layer.md#level-designer
from __future__ import annotations
from pathlib import Path
from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types as gen_types

from ..settings import settings
from ..domain.physics import (
    GRAVITY, MOVE_VEL, JUMP_VEL, PLAYER_W, PLAYER_H,
    MAX_JUMP_HEIGHT, MAX_JUMP_DISTANCE,
)
from .schemas import Level

PROMPTS_DIR = Path(__file__).parent / "prompts"

def _render_system_prompt() -> str:
    template = (PROMPTS_DIR / "level_designer.system.md").read_text(encoding="utf-8")
    return template.format(
        gravity=GRAVITY,
        move_vel=MOVE_VEL,
        jump_vel=JUMP_VEL,
        player_w=PLAYER_W,
        player_h=PLAYER_H,
        max_jump_height=MAX_JUMP_HEIGHT,
        max_jump_distance=MAX_JUMP_DISTANCE,
    )

def _render_retry_prompt(violations: list[str]) -> str:
    template = (PROMPTS_DIR / "level_designer.retry.md").read_text(encoding="utf-8")
    return template.format(violations="\n".join(f"- {v}" for v in violations))

# Module-level singletons (initialized once per Cloud Run instance):
_session_service = InMemorySessionService()

level_designer_agent = Agent(
    name="level_designer",
    model=settings.gemini_model,                 # "gemini-3.1-flash-lite"
    instruction=_render_system_prompt(),
    generate_content_config=gen_types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=Level.model_json_schema(),
        temperature=0.7,
        top_p=0.95,
        max_output_tokens=2048,
    ),
)

runner = Runner(
    agent=level_designer_agent,
    app_name="mirror-realm",
    session_service=_session_service,
)
```

### Public API of the agent module

```python
# apps/api/app/agents/level_designer.py (continued)
# docs: 06-ai-agent-layer.md#level-designer
from dataclasses import dataclass

@dataclass
class AgentRun:
    level: Level
    input_tokens: int
    output_tokens: int
    was_retry: bool

async def run_level_designer(
    *,
    image_bytes: bytes,
    mime_type: str = "image/jpeg",
    violations_for_retry: list[str] | None = None,
) -> AgentRun:
    """
    Single-turn run. If `violations_for_retry` is provided, the retry prompt
    is prepended to the user turn. Returns the candidate Level (UNVALIDATED
    against invariants I2-I7; only schema-validated). Caller runs reachability
    and decides whether to retry.
    """
    user_parts: list[gen_types.Part] = [
        gen_types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
        gen_types.Part.from_text(text="Analyze this photo and produce a level."),
    ]
    if violations_for_retry:
        user_parts.append(gen_types.Part.from_text(text=_render_retry_prompt(violations_for_retry)))

    session_id = _session_service.create_session(app_name="mirror-realm", user_id="anon")
    response = await runner.run_async(
        session_id=session_id,
        new_message=gen_types.Content(role="user", parts=user_parts),
    )

    # ADK exposes usage via response.usage_metadata (exact attribute names per SDK version).
    candidate_text = response.text
    usage = response.usage_metadata

    level = Level.model_validate_json(candidate_text)
    return AgentRun(
        level=level,
        input_tokens=usage.prompt_token_count,
        output_tokens=usage.candidates_token_count,
        was_retry=violations_for_retry is not None,
    )
```

The router (`app/routers/analyze.py`) consumes `run_level_designer` and orchestrates the retry decision based on reachability. Retry is **at most once**; the agent module never retries itself.

<a id="prompts"></a>

## 4. Prompts

Prompts are files, not strings. They live at `apps/api/app/agents/prompts/` and are loaded at agent construction. Curly-brace placeholders are filled by `_render_system_prompt`.

### 4.1 `level_designer.system.md`

```markdown
You are a level designer for a 2D side-scrolling pixel-art platformer.
Your job: look at a real-world photo and design a playable single-screen level.

# Output

Return ONLY valid JSON matching the response schema. No prose, no markdown.

# World

- Coordinate system: (0,0) is top-left. World is 1920 wide × 540 tall.
- The player is {player_w} × {player_h} pixels.
- The player can move horizontally at ~{move_vel} px/sec.
- The player can jump with initial velocity ~{jump_vel} px/sec under gravity ~{gravity} px/sec².
- That means in one jump the player covers up to ~{max_jump_height}px vertically and ~{max_jump_distance}px horizontally.

# Design rules

- Place 4–12 platforms.
- Spawn the player at the LEFT side of the world, roughly (50, 50).
- Place the goal at the RIGHT side, x ≥ 1850.
- Ensure a physically-possible sequence of jumps from spawn to goal.
  - Gaps between platforms must be ≤ {max_jump_distance}px horizontally.
  - Step-ups must be ≤ {max_jump_height}px vertically.
- Place at most 3 hazards. Hazards must not make the level unbeatable.
- Each platform should map loosely to an object in the photo: label it (e.g., "coffee mug", "book stack").
- Pick exactly one `vibe` from the enum that matches the photo's mood.
  - Bright daylight scenes → cozy / forest / desert / snow / cosmic
  - Night / artificial light → neon / vapor
  - Decayed / industrial scenes → ruined / industrial
  - Bookshelves / interiors → library / cozy
  - Aquatic / blue-dominant → underwater
  - High-contrast / minimalist → monochrome

# Schema

(Schema is supplied via `responseSchema`; you do not need to repeat it here.)
```

### 4.2 `level_designer.retry.md`

```markdown
Your previous level had these problems:

{violations}

Produce a new level that:
- Fixes all listed issues.
- Keeps platforms within jumping range (≤220px horizontal gaps, ≤128px vertical step-ups).
- Still feels like a thoughtful response to the same photo.

Same output rules apply: JSON only, schema-conformant.
```

These two files **are the spec for the agent's behavior**. Changes to either need a docs commit referencing this section.

<a id="response-schema"></a>

## 5. Response schema

The agent's `responseSchema` is the JSON Schema in `packages/shared/level.schema.json`. ADK passes it through to Vertex's structured-output mode; Vertex constrains generation to the schema; Pydantic validates the result on the way out (defense in depth — if Vertex ever lets a malformed token slip, Pydantic catches it).

The schema's `enum` for `vibe` is normative. Vertex will not produce an out-of-enum value.

Versioning: every Level we emit has `schemaVersion: "1.0.0"`. If we bump (e.g. to add a `coin` array), the agent prompt explicitly mentions the new field and the schema's `const` bumps. Old shared URLs continue to work because v1 levels stay v1 in storage — the client checks `schemaVersion` and selects a renderer.

<a id="retry"></a>

## 6. Retry policy

Defined in `apps/api/app/routers/analyze.py`. Codified here so it can't change silently.

```
Pseudocode (in plain English):

1. Call run_level_designer(image_bytes).
2. Validate domain invariants I2-I8 (see docs/04#invariants).
3. Run reachability check (I5).
4. If steps 2 or 3 pass: return level. DONE.
5. If steps 2 or 3 fail AND this was first attempt:
     Build a list of violation strings (1-3 items, human readable).
     Call run_level_designer(image_bytes, violations_for_retry=violations).
6. Re-validate. Return level regardless, with wasUnreachableOnFirstAttempt=true.
```

Hard rules:

- **Max one retry.** Two Gemini calls per `/api/analyze` request, ceiling.
- **Total wall clock ≤ 25s.** Each agent call gets a 12s timeout; A* gets 200ms; some slack for marshaling.
- **No exponential backoff.** Vertex outages are not "we'll wait it out" outages; we surface them to the user.

Violations list format (examples):

- `"Goal at (1900, 300) is not reachable from spawn at (50, 50) — max horizontal gap between platforms 2 and 3 is 280px (limit 220)."`
- `"Platform 4 overlaps the spawn point by more than 8px."`
- `"goal.x must be ≥ spawn.x + 800 — got 720."`

These come from the invariant-checking code, not from free-form generation.

<a id="tracing"></a>

## 7. Tracing

ADK ships with OpenTelemetry instrumentation. We configure the Cloud Trace exporter in `app/telemetry/tracing.py`:

```python
# apps/api/app/telemetry/tracing.py
# docs: 06-ai-agent-layer.md#tracing
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.cloud_trace import CloudTraceSpanExporter
from opentelemetry.sdk.resources import Resource

from ..settings import settings

def configure_tracing() -> None:
    resource = Resource.create({
        "service.name": "mirror-realm-api",
        "service.version": settings.git_sha,
    })
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(
        BatchSpanProcessor(CloudTraceSpanExporter(project_id=settings.gcp_project))
    )
    trace.set_tracer_provider(provider)
```

Spans we expect to see for one `/api/analyze` request:

```
POST /api/analyze                                  (FastAPI instrumentation)
└── analyze_request                                (manual span in router)
    ├── cost_guard.check                           (manual)
    ├── level_designer.run                         (ADK)
    │   └── vertex.generate_content                (ADK→Vertex)
    ├── reachability.check                         (manual)
    ├── (optional) level_designer.run (retry)      (ADK)
    │   └── vertex.generate_content                (ADK→Vertex)
    ├── (optional) reachability.check (retry)
    └── cost_guard.record                          (manual)
```

Span attributes we always set:

- `mr.vibe` — chosen vibe
- `mr.platforms` — count
- `mr.retry` — bool
- `mr.tokens_in` / `mr.tokens_out`
- `mr.reachable` — bool

These power the dashboards described in [`12-observability.md`](./12-observability.md).

<a id="cost"></a>

## 8. Cost recording hook

Every successful agent run (whether first or retry) must record usage. Implemented as a thin wrapper that the analyze router calls **after** the model run completes:

```python
# apps/api/app/services/cost_guard.py
# docs: 06-ai-agent-layer.md#cost
from datetime import date
from ..repositories.cost_guard import CostGuardRepository

# Pricing constants for gemini-3.1-flash-lite (update when official pricing changes;
# see docs/15-cost-and-limits.md). All values USD per 1M tokens.
INPUT_PRICE_PER_MTOK = 0.10
OUTPUT_PRICE_PER_MTOK = 0.40

def _estimate_cost_usd(input_tokens: int, output_tokens: int) -> float:
    return (input_tokens * INPUT_PRICE_PER_MTOK + output_tokens * OUTPUT_PRICE_PER_MTOK) / 1_000_000

class CostGuard:
    def __init__(self, repo: CostGuardRepository) -> None:
        self._repo = repo

    async def check_can_run_agent(self, today: date) -> None:
        """Raises BudgetExhausted if soft cap tripped. Called BEFORE the agent."""
        rec = await self._repo.get(today.isoformat())
        if rec is None:
            return
        if rec.geminiCalls >= 300 or rec.estimatedCostUsd >= 1.0:
            from ..errors import BudgetExhausted
            raise BudgetExhausted()

    async def record_agent_run(
        self,
        today: date,
        *,
        input_tokens: int,
        output_tokens: int,
    ) -> None:
        cost = _estimate_cost_usd(input_tokens, output_tokens)
        await self._repo.increment_gemini_call(
            today.isoformat(),
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            estimated_cost_usd=cost,
        )
```

Note: a retry run is a second call and is recorded separately. The 300/day cap counts retries.

<a id="local-test"></a>

## 9. Local testing without burning quota

For unit tests and most integration tests we use a **fake** in place of the real ADK agent. The fake is a Pydantic-typed function that returns hand-built `Level` instances.

```python
# apps/api/tests/fakes/agent_fake.py
# docs: 06-ai-agent-layer.md#local-test
from app.agents.level_designer import AgentRun
from app.agents.schemas import Level

class FakeAgent:
    def __init__(self, scripted_returns: list[Level]) -> None:
        self._returns = list(scripted_returns)
        self.calls: list[tuple[bytes, list[str] | None]] = []

    async def __call__(self, *, image_bytes: bytes, violations_for_retry=None, **_) -> AgentRun:
        self.calls.append((image_bytes, violations_for_retry))
        level = self._returns.pop(0)
        return AgentRun(level=level, input_tokens=300, output_tokens=400, was_retry=violations_for_retry is not None)
```

The fake is injected via FastAPI dependency override in tests:

```python
# apps/api/tests/conftest.py
# docs: 06-ai-agent-layer.md#local-test
from app.main import app
from app.routers.analyze import get_agent_runner
from .fakes.agent_fake import FakeAgent

@pytest.fixture
def fake_agent(monkeypatch):
    fake = FakeAgent(scripted_returns=[...])
    app.dependency_overrides[get_agent_runner] = lambda: fake
    yield fake
    app.dependency_overrides.clear()
```

**Golden tests** (a small set, gated behind an env var so they don't run on every PR) DO call real Vertex with a fixed set of photos. They live in `apps/api/tests/golden/` and are run manually before a release. See [`14-testing-strategy.md#golden`](./14-testing-strategy.md#golden).

---

_End of 06 — AI Agent Layer._
