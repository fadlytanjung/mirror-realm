# apps/api/app/services/cost_guard.py
# docs: 06-ai-agent-layer.md#cost · 04-domain-model.md#cost-guard · 09-features.md#f8-cost-guard
from __future__ import annotations

from datetime import date

from fastapi import Depends

from ..errors import BudgetExhausted, SubmissionRateLimited
from ..repositories import CostGuardDep
from ..repositories.cost_guard import CostGuardRepository
from ..settings import settings

# Pricing for gemini-3.1-flash-lite, USD per 1M tokens (docs/15). Update on price change.
INPUT_PRICE_PER_MTOK = 0.10
OUTPUT_PRICE_PER_MTOK = 0.40


def _estimate_cost_usd(input_tokens: int, output_tokens: int) -> float:
    return (input_tokens * INPUT_PRICE_PER_MTOK + output_tokens * OUTPUT_PRICE_PER_MTOK) / 1_000_000


class CostGuard:
    def __init__(self, repo: CostGuardRepository) -> None:
        self._repo = repo

    async def check_can_run_agent(self, today: date) -> None:
        """Raise BudgetExhausted if a soft cap tripped. Called BEFORE the agent."""
        rec = await self._repo.get(today.isoformat())
        if rec is None:
            return
        if rec.geminiCalls >= settings.daily_gemini_call_cap:
            raise BudgetExhausted()
        if rec.estimatedCostUsd >= settings.daily_gemini_usd_cap:
            raise BudgetExhausted()

    async def record_agent_run(self, today: date, *, input_tokens: int, output_tokens: int) -> None:
        cost = _estimate_cost_usd(input_tokens, output_tokens)
        await self._repo.increment_gemini_call(
            today.isoformat(),
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            estimated_cost_usd=cost,
        )

    async def check_submission_allowed(self, today: date, *, device_hash: str) -> None:
        """Raise SubmissionRateLimited if this device hit its daily cap."""
        rec = await self._repo.get(today.isoformat())
        if rec is None:
            return
        used = rec.submissionsByDevice.get(device_hash, 0)
        if used >= settings.daily_submission_cap_per_device:
            raise SubmissionRateLimited()

    async def record_submission(self, today: date, *, device_hash: str) -> None:
        await self._repo.increment_submission(today.isoformat(), device_hash=device_hash)


def cost_guard_service(repo: CostGuardRepository = CostGuardDep) -> CostGuard:
    return CostGuard(repo)


CostGuardServiceDep = Depends(cost_guard_service)
