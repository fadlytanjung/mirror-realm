# apps/api/app/routers/level.py
# docs: 07-api-contracts.md#save · #get-level · 09-features.md#f3-share · #f4-open-shared
from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Path
from pydantic import BaseModel, Field

from ..agents.schemas import Level
from ..errors import ExpiredError, HashCollisionError, NotFoundError
from ..repositories import LevelsDep
from ..repositories.levels import LevelRepository, StoredLevel
from ..services.share_codec import canonical_json, short_hash
from ..settings import settings

router = APIRouter(prefix="/api", tags=["level"])

TTL_DAYS = 30
HASH_PATTERN = r"^[a-zA-Z0-9]{6,7}$"


class SaveLevelRequest(BaseModel):
    model_config = {"extra": "forbid"}
    level: Level
    deviceHash: str = Field(min_length=8, max_length=64)


class SaveLevelResponse(BaseModel):
    hash: str
    url: str
    expiresAt: datetime


class GetLevelResponse(BaseModel):
    level: Level
    savedAt: datetime


def _origin() -> str:
    return settings.public_base_url or f"https://{settings.gcp_project}.web.app"


@router.post("/level/save", response_model=SaveLevelResponse)
async def save_level(req: SaveLevelRequest, repo: LevelRepository = LevelsDep) -> SaveLevelResponse:
    now = datetime.now(UTC)
    ttl = now + timedelta(days=TTL_DAYS)
    target = canonical_json(req.level)

    for length in (6, 7):
        h = short_hash(req.level, length)
        existing = await repo.get(h)
        if existing is None:
            await repo.set(h, StoredLevel(level=req.level, createdAt=now, ttl=ttl))
            return SaveLevelResponse(hash=h, url=f"{_origin()}/l/{h}", expiresAt=ttl)
        if canonical_json(existing.level) == target:
            # Idempotent: same content already stored — reuse it.
            return SaveLevelResponse(hash=h, url=f"{_origin()}/l/{h}", expiresAt=existing.ttl)
        # Different content at this hash (astronomically unlikely) — widen and retry.

    raise HashCollisionError()


@router.get("/level/{hash}", response_model=GetLevelResponse)
async def get_level(
    hash: str = Path(pattern=HASH_PATTERN), repo: LevelRepository = LevelsDep
) -> GetLevelResponse:
    stored = await repo.get(hash)
    if stored is None:
        raise NotFoundError()
    if stored.ttl < datetime.now(UTC):
        raise ExpiredError()
    return GetLevelResponse(level=stored.level, savedAt=stored.createdAt)
