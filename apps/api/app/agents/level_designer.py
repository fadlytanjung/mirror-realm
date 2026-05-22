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
    # Targeted replacement (not str.format) so the literal JSON braces in the
    # prompt's schema example are left untouched.
    template = (PROMPTS_DIR / "level_designer.system.md").read_text(encoding="utf-8")
    repl = {
        "{gravity}": str(GRAVITY),
        "{move_vel}": str(MOVE_VEL),
        "{jump_vel}": str(JUMP_VEL),
        "{player_w}": str(PLAYER_W),
        "{player_h}": str(PLAYER_H),
        "{max_jump_height}": str(MAX_JUMP_HEIGHT),
        "{max_jump_distance}": str(MAX_JUMP_DISTANCE),
    }
    for key, value in repl.items():
        template = template.replace(key, value)
    return template


def _render_retry_prompt(violations: list[str]) -> str:
    template = (PROMPTS_DIR / "level_designer.retry.md").read_text(encoding="utf-8")
    return template.replace("{violations}", "\n".join(f"- {v}" for v in violations))


@lru_cache(maxsize=1)
def _client() -> Any:
    """Build the google-genai client once per process. Imported lazily (heavy).

    Reads GOOGLE_API_KEY + GOOGLE_GENAI_USE_VERTEXAI=false set by
    adapters.genai_client.configure_genai (docs/06 §auth).
    """
    from google import genai

    return genai.Client()


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

    # JSON mode (no strict response_schema): the Developer API rejects the
    # additionalProperties/$ref keywords our Pydantic schema emits, so we pin the
    # shape in the prompt and validate with Pydantic + one retry (docs/06 §6).
    config = gen_types.GenerateContentConfig(
        system_instruction=_render_system_prompt(),
        response_mime_type="application/json",
        temperature=0.7,
        top_p=0.95,
        max_output_tokens=4096,
    )
    contents = [gen_types.Content(role="user", parts=parts)]

    client = _client()
    try:
        async with asyncio.timeout(AGENT_CALL_TIMEOUT_S):
            resp = await client.aio.models.generate_content(
                model=settings.gemini_model, contents=contents, config=config
            )
    except TimeoutError as exc:
        raise AgentTimeoutError() from exc
    except Exception as exc:  # safety blocks surface as provider errors
        if "safety" in str(exc).lower() or "blocked" in str(exc).lower():
            raise SafetyFilterError() from exc
        raise AgentError() from exc

    text = resp.text
    usage = resp.usage_metadata
    in_tok = int(getattr(usage, "prompt_token_count", 0) or 0)
    out_tok = int(getattr(usage, "candidates_token_count", 0) or 0)

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
