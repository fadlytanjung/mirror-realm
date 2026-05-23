# apps/api/app/routers/daily.py
# docs: 07-api-contracts.md#daily-get · #daily-rotate · 09-features.md#f5-daily-world
from __future__ import annotations

from datetime import UTC, datetime

import structlog
from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel

from ..agents.schemas import Level
from ..domain.daily import DailyWorld
from ..domain.level import validate_endpoints
from ..domain.reachability import check_reachable
from ..errors import NoDailyYet, UnauthorizedError
from ..repositories import DailyDep, SubmissionsDep
from ..repositories.daily import DailyRepository
from ..repositories.submissions import SubmissionRepository
from ..settings import settings

router = APIRouter(prefix="/api", tags=["daily"])
log = structlog.get_logger(__name__)


class DailyResponse(BaseModel):
    forDate: str
    level: Level
    isFromYesterday: bool


class RotateResponse(BaseModel):
    rotated: bool
    forDate: str | None = None
    promotedFromSubmissionHash: str | None = None
    reason: str | None = None
    keptDailyForDate: str | None = None


@router.get("/daily", response_model=DailyResponse)
async def get_daily(
    response: Response,
    daily: DailyRepository = DailyDep,
    submissions: SubmissionRepository = SubmissionsDep,
) -> DailyResponse:
    today = await daily.get_today()
    if today is None:
        # Lazy seed: if anyone has submitted, promote the oldest now so "Today's World"
        # works immediately after a submit, without waiting for the midnight rotate cron.
        today = await _promote_oldest(submissions, daily, datetime.now(UTC))
    if today is None:
        raise NoDailyYet()
    response.headers["Cache-Control"] = "public, max-age=3600"
    is_stale = today.forDate < datetime.now(UTC).date()
    if is_stale:
        log.info("daily_stale", for_date=today.forDate.isoformat())
    return DailyResponse(
        forDate=today.forDate.isoformat(), level=today.level, isFromYesterday=is_stale
    )


async def verify_scheduler_oidc(request: Request) -> None:
    """OIDC check for the cron-only rotate endpoint (docs/07 §8)."""
    if settings.allow_unauth_rotate:
        return
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise UnauthorizedError()
    token = header.split(" ", 1)[1]
    try:
        from google.auth.transport import requests as ga_requests
        from google.oauth2 import id_token

        claims = id_token.verify_oauth2_token(  # type: ignore[no-untyped-call]
            token, ga_requests.Request(), audience=settings.rotate_audience or None
        )
    except Exception as exc:
        raise UnauthorizedError() from exc
    if claims.get("email") != settings.scheduler_sa_email or not claims.get("email_verified"):
        raise UnauthorizedError()


def _is_valid(level: Level) -> bool:
    return not validate_endpoints(level) and check_reachable(level)


async def _promote_oldest(
    submissions: SubmissionRepository, daily: DailyRepository, now: datetime
) -> DailyWorld | None:
    """Pop the oldest VALID submission and make it today's daily. None if queue empty.

    Shared by the rotate cron and the lazy seed in GET /daily (docs/09 §f5).
    """
    while True:
        sub = await submissions.pop_oldest()
        if sub is None:
            return None
        if _is_valid(sub.level):
            break
        log.warning("submission_dropped", content_hash=sub.contentHash)

    world = DailyWorld(
        forDate=now.date(),
        level=sub.level,
        promotedFromSubmissionHash=sub.contentHash,
        rotatedAt=now,
    )
    await daily.set_today_and_archive(world)
    log.info("daily_rotated", for_date=now.date().isoformat(), from_hash=sub.contentHash)
    return world


@router.post("/daily-rotate", response_model=RotateResponse)
async def daily_rotate(
    _auth: None = Depends(verify_scheduler_oidc),
    submissions: SubmissionRepository = SubmissionsDep,
    daily: DailyRepository = DailyDep,
) -> RotateResponse:
    now = datetime.now(UTC)
    world = await _promote_oldest(submissions, daily, now)
    if world is None:
        current = await daily.get_today()
        log.info("daily_rotation_skipped", reason="empty_queue")
        return RotateResponse(
            rotated=False,
            reason="empty_queue",
            keptDailyForDate=current.forDate.isoformat() if current else None,
        )
    return RotateResponse(
        rotated=True,
        forDate=world.forDate.isoformat(),
        promotedFromSubmissionHash=world.promotedFromSubmissionHash,
    )
