# apps/api/app/adapters/firestore_client.py
# docs: 05-repository-pattern.md#client
from __future__ import annotations

from functools import lru_cache

from google.cloud.firestore_v1 import AsyncClient

from ..settings import settings


@lru_cache(maxsize=1)
def firestore_client() -> AsyncClient:
    """Singleton. Picks up workload identity / ADC, or FIRESTORE_EMULATOR_HOST locally."""
    return AsyncClient(project=settings.gcp_project, database=settings.firestore_database)
