# apps/api/app/domain/daily.py
# docs: 04-domain-model.md#daily
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel

from ..agents.schemas import Level


class DailyWorld(BaseModel):
    model_config = {"extra": "forbid"}

    forDate: date                              # YYYY-MM-DD UTC
    level: Level
    promotedFromSubmissionHash: str | None     # provenance, nullable for seeded levels
    rotatedAt: datetime
