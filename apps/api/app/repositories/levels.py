# apps/api/app/repositories/levels.py
# docs: 05-repository-pattern.md#concrete
from __future__ import annotations

from datetime import datetime

from google.cloud.firestore_v1 import AsyncCollectionReference
from pydantic import BaseModel

from ..agents.schemas import Level
from .base import AbstractRepository, map_firestore_errors


class StoredLevel(BaseModel):
    """What we persist for short-URL sharing: the Level plus metadata."""

    level: Level
    createdAt: datetime
    ttl: datetime  # createdAt + 30 days


class LevelRepository(AbstractRepository[StoredLevel]):
    COLLECTION = "levels"

    def __init__(self, collection: AsyncCollectionReference) -> None:
        self._col = collection

    @map_firestore_errors
    async def get(self, doc_id: str) -> StoredLevel | None:
        snap = await self._col.document(doc_id).get()
        if not snap.exists:
            return None
        return StoredLevel.model_validate(snap.to_dict())

    @map_firestore_errors
    async def set(self, doc_id: str, entity: StoredLevel) -> None:
        await self._col.document(doc_id).set(entity.model_dump(mode="json"))

    @map_firestore_errors
    async def delete(self, doc_id: str) -> None:
        await self._col.document(doc_id).delete()

    @map_firestore_errors
    async def exists(self, doc_id: str) -> bool:
        snap = await self._col.document(doc_id).get()
        return bool(snap.exists)
