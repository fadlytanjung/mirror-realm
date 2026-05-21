# apps/api/app/repositories/__init__.py
# docs: 05-repository-pattern.md#client
from __future__ import annotations

from fastapi import Depends

from ..adapters.firestore_client import firestore_client
from .cost_guard import CostGuardRepository
from .daily import DailyRepository
from .levels import LevelRepository
from .submissions import SubmissionRepository


def levels_repo() -> LevelRepository:
    return LevelRepository(firestore_client().collection(LevelRepository.COLLECTION))


def submissions_repo() -> SubmissionRepository:
    return SubmissionRepository(firestore_client().collection(SubmissionRepository.COLLECTION))


def daily_repo() -> DailyRepository:
    return DailyRepository(firestore_client().collection(DailyRepository.COLLECTION))


def cost_guard_repo() -> CostGuardRepository:
    return CostGuardRepository(firestore_client().collection(CostGuardRepository.COLLECTION))


LevelsDep = Depends(levels_repo)
SubmissionsDep = Depends(submissions_repo)
DailyDep = Depends(daily_repo)
CostGuardDep = Depends(cost_guard_repo)
