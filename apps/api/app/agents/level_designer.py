# apps/api/app/agents/level_designer.py
# docs: 06-ai-agent-layer.md#level-designer
#
# Single-turn ADK agent: photo bytes -> candidate Level (schema-validated only;
# the router runs domain invariants + reachability and decides on the one retry).
# ADK/Vertex objects are built lazily so importing this module (tests, the analyze
# router with a fake runner) never requires a live Vertex connection.
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Protocol

from pydantic import ValidationError

from ..domain.physics import (
    GRAVITY,
    JUMP_VEL,
    MAX_JUMP_DISTANCE,
    MAX_JUMP_HEIGHT,
    MOVE_VEL,
    PLAYER_H,
    PLAYER_W,
)
from ..errors import AgentError, AgentTimeoutError, SafetyFilterError
from ..settings import settings
from .schemas import Level

PROMPTS_DIR = Path(__file__).parent / "prompts"
AGENT_CALL_TIMEOUT_S = 12.0  # docs/06 §6: per-call wall clock


@dataclass
class AgentRun:
    level: Level
    input_tokens: int
    output_tokens: int
    was_retry: bool


class AgentRunner(Protocol):
    """The callable the analyze router depends on (overridable in tests)."""

    async def __call__(
        self,
        *,
        image_bytes: bytes,
        mime_type: str = "image/jpeg",
        violations_for_retry: list[str] | None = None,
    ) -> AgentRun: ...


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


@lru_cache(maxsize=1)
def _runner() -> Any:
    """Build the ADK runner once per process. Imported lazily (heavy + needs ADC)."""
    from google.adk.agents import Agent
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai import types as gen_types

    agent = Agent(
        name="level_designer",
        model=settings.gemini_model,
        instruction=_render_system_prompt(),
        generate_content_config=gen_types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=Level.model_json_schema(),
            temperature=0.7,
            top_p=0.95,
            max_output_tokens=2048,
        ),
    )
    return Runner(
        agent=agent,
        app_name="mirror-realm",
        session_service=InMemorySessionService(),  # type: ignore[no-untyped-call]
    )


def _extract(event: Any) -> tuple[str | None, int, int]:
    """Pull (text, input_tokens, output_tokens) from an ADK/genai event, defensively."""
    text: str | None = getattr(event, "text", None)
    if text is None:
        content = getattr(event, "content", None)
        parts = getattr(content, "parts", None) if content else None
        if parts:
            text = "".join(getattr(p, "text", "") or "" for p in parts) or None
    usage = getattr(event, "usage_metadata", None)
    in_tok = int(getattr(usage, "prompt_token_count", 0) or 0)
    out_tok = int(getattr(usage, "candidates_token_count", 0) or 0)
    return text, in_tok, out_tok


async def run_level_designer(
    *,
    image_bytes: bytes,
    mime_type: str = "image/jpeg",
    violations_for_retry: list[str] | None = None,
) -> AgentRun:
    """One Gemini turn. Returns a schema-valid candidate Level (invariants TBD by caller)."""
    from google.genai import types as gen_types

    parts = [
        gen_types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
        gen_types.Part.from_text(text="Analyze this photo and produce a level."),
    ]
    if violations_for_retry:
        parts.append(gen_types.Part.from_text(text=_render_retry_prompt(violations_for_retry)))

    runner = _runner()
    session = await _ensure_session(runner)

    text: str | None = None
    in_tok = out_tok = 0
    try:
        async with asyncio.timeout(AGENT_CALL_TIMEOUT_S):
            async for event in runner.run_async(
                user_id="anon",
                session_id=session,
                new_message=gen_types.Content(role="user", parts=parts),
            ):
                t, i, o = _extract(event)
                if t:
                    text = t
                in_tok = in_tok or i
                out_tok = out_tok or o
    except TimeoutError as exc:
        raise AgentTimeoutError() from exc
    except Exception as exc:  # safety blocks surface as provider errors
        if "safety" in str(exc).lower() or "blocked" in str(exc).lower():
            raise SafetyFilterError() from exc
        raise AgentError() from exc

    if not text:
        raise AgentError()
    try:
        level = Level.model_validate_json(text)
    except ValidationError as exc:
        raise AgentError() from exc

    return AgentRun(
        level=level,
        input_tokens=in_tok,
        output_tokens=out_tok,
        was_retry=violations_for_retry is not None,
    )


async def _ensure_session(runner: Any) -> str:
    """Create a fresh ADK session id (API shape varies across versions)."""
    svc = runner.session_service
    session = svc.create_session(app_name="mirror-realm", user_id="anon")
    if asyncio.iscoroutine(session):
        session = await session
    return str(getattr(session, "id", session))
