# apps/api/app/routers/submit.py
# docs: 07-api-contracts.md#submit · 09-features.md#f6-submit
from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..agents.schemas import Level
from ..domain.level import validate_endpoints
from ..domain.reachability import check_reachable
from ..domain.submission import Submission
from ..errors import UnreachableLevel
from ..repositories import SubmissionsDep
from ..repositories.submissions import SubmissionRepository
from ..services.cost_guard import CostGuard, CostGuardServiceDep
from ..services.share_codec import content_hash

router = APIRouter(prefix="/api", tags=["submit"])

TTL_DAYS = 30


class SubmitRequest(BaseModel):
    model_config = {"extra": "forbid"}
    level: Level
    deviceHash: str = Field(min_length=8, max_length=64)


class SubmitResponse(BaseModel):
    status: str  # "queued" | "already_queued"
    contentHash: str


@router.post("/submit", response_model=SubmitResponse)
async def submit(
    req: SubmitRequest,
    repo: SubmissionRepository = SubmissionsDep,
    cg: CostGuard = CostGuardServiceDep,
) -> SubmitResponse:
    # Defense in depth: never trust a client-supplied level (docs/13 §6).
    if validate_endpoints(req.level) or not check_reachable(req.level):
        raise UnreachableLevel()

    chash = content_hash(req.level)

    # Idempotent: same content already queued — no extra rate-limit charge.
    if await repo.exists(chash):
        return SubmitResponse(status="already_queued", contentHash=chash)

    today = datetime.now(UTC).date()
    await cg.check_submission_allowed(today, device_hash=req.deviceHash)

    now = datetime.now(UTC)
    await repo.set(
        chash,
        Submission(
            contentHash=chash,
            level=req.level,
            deviceHash=req.deviceHash,
            createdAt=now,
            ttl=now + timedelta(days=TTL_DAYS),
        ),
    )
    await cg.record_submission(today, device_hash=req.deviceHash)
    return SubmitResponse(status="queued", contentHash=chash)
