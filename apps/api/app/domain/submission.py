# apps/api/app/domain/submission.py
# docs: 04-domain-model.md#submission
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from ..agents.schemas import Level


class Submission(BaseModel):
    model_config = {"extra": "forbid"}

    contentHash: str = Field(min_length=8, max_length=16)  # Firestore doc id
    level: Level
    deviceHash: str = Field(min_length=8, max_length=64)   # anonymous client id
    createdAt: datetime
    ttl: datetime                                          # createdAt + 30 days; Firestore TTL
