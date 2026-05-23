# apps/api/app/routers/analyze.py
# docs: 07-api-contracts.md#analyze · 06-ai-agent-layer.md#retry · 04-domain-model.md#invariants
from __future__ import annotations

import binascii
import uuid
from base64 import b64decode
from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..agents.level_designer import AgentRunner, run_level_designer
from ..agents.schemas import Level
from ..domain.level import validate_endpoints
from ..domain.reachability import check_reachable
from ..errors import AgentError, AgentTimeoutError, SafetyFilterError, ValidationFailed
from ..services.cost_guard import CostGuard, CostGuardServiceDep
from ..telemetry.tracing import current_trace_id

router = APIRouter(prefix="/api", tags=["analyze"])


class AnalyzeRequest(BaseModel):
    model_config = {"extra": "forbid"}
    photo: str = Field(min_length=100, max_length=320_000)  # base64 of <=200KB JPEG
    deviceHash: str = Field(min_length=8, max_length=64)


class AnalyzeResponse(BaseModel):
    level: Level
    wasUnreachableOnFirstAttempt: bool = False
    tracingId: str


def get_agent_runner() -> AgentRunner:
    """Overridable in tests via app.dependency_overrides (docs/06 §9)."""
    return run_level_designer


AgentRunnerDep = Depends(get_agent_runner)


def _decode_photo(photo_b64: str) -> bytes:
    try:
        raw = b64decode(photo_b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValidationFailed() from exc
    # JPEG magic bytes; the only format the camera pipeline emits (docs/13 §6).
    if len(raw) < 4 or raw[0:2] != b"\xff\xd8":
        raise ValidationFailed()
    return raw


def _violations(level: Level) -> list[str]:
    out = validate_endpoints(level)
    if not check_reachable(level):
        out.append("The path from spawn to goal is not reachable with one chain of jumps.")
    return out


def _tracing_id() -> str:
    return current_trace_id() or uuid.uuid4().hex


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(
    req: AnalyzeRequest,
    cg: CostGuard = CostGuardServiceDep,
    runner: AgentRunner = AgentRunnerDep,
) -> AnalyzeResponse:
    today = datetime.now(UTC).date()
    await cg.check_can_run_agent(today)

    image_bytes = _decode_photo(req.photo)

    first = await runner(image_bytes=image_bytes)
    await cg.record_agent_run(
        today, input_tokens=first.input_tokens, output_tokens=first.output_tokens
    )

    violations = _violations(first.level)
    if not violations:
        return AnalyzeResponse(
            level=first.level, wasUnreachableOnFirstAttempt=False, tracingId=_tracing_id()
        )

    # One retry only (docs/06 §6). The first level is already schema-valid (just not
    # reachable), so if the retry fails — bad JSON, timeout, safety block — we keep the
    # first level rather than 500-ing the user. We always have something playable.
    try:
        retry = await runner(image_bytes=image_bytes, violations_for_retry=violations)
    except (AgentError, AgentTimeoutError, SafetyFilterError):
        return AnalyzeResponse(
            level=first.level, wasUnreachableOnFirstAttempt=True, tracingId=_tracing_id()
        )
    await cg.record_agent_run(
        today, input_tokens=retry.input_tokens, output_tokens=retry.output_tokens
    )
    still_bad = bool(_violations(retry.level))
    return AnalyzeResponse(
        level=retry.level, wasUnreachableOnFirstAttempt=still_bad, tracingId=_tracing_id()
    )
