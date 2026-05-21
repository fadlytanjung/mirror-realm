# apps/api/app/domain/cost_guard.py
# docs: 04-domain-model.md#cost-guard
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, NonNegativeFloat, NonNegativeInt


class CostGuardRecord(BaseModel):
    model_config = {"extra": "forbid"}

    forDate: date                                          # doc id == YYYY-MM-DD
    geminiCalls: NonNegativeInt = 0
    geminiInputTokens: NonNegativeInt = 0
    geminiOutputTokens: NonNegativeInt = 0
    estimatedCostUsd: NonNegativeFloat = 0.0
    submissions: NonNegativeInt = 0                        # also tracked for rate limiting
    submissionsByDevice: dict[str, NonNegativeInt] = {}    # deviceHash -> count
    updatedAt: datetime
