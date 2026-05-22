# apps/api/app/repositories/daily.py
# docs: 05-repository-pattern.md#concrete
from __future__ import annotations

from google.cloud.firestore_v1 import AsyncCollectionReference

from ..domain.daily import DailyWorld
from .base import AbstractRepository, map_firestore_errors


class DailyRepository(AbstractRepository[DailyWorld]):
    COLLECTION = "daily"

    def __init__(self, collection: AsyncCollectionReference) -> None:
        self._col = collection

    @map_firestore_errors
    async def get(self, doc_id: str) -> DailyWorld | None:
        snap = await self._col.document(doc_id).get()
        return DailyWorld.model_validate(snap.to_dict()) if snap.exists else None

    @map_firestore_errors
    async def set(self, doc_id: str, entity: DailyWorld) -> None:
        await self._col.document(doc_id).set(entity.model_dump(mode="json"))

    @map_firestore_errors
    async def delete(self, doc_id: str) -> None:
        await self._col.document(doc_id).delete()

    @map_firestore_errors
    async def exists(self, doc_id: str) -> bool:
        snap = await self._col.document(doc_id).get()
        return bool(snap.exists)

    # Collection-specific:
    async def get_today(self) -> DailyWorld | None:
        return await self.get("today")

    async def set_today_and_archive(self, world: DailyWorld) -> None:
        """Write to BOTH daily/today and daily/{forDate}. Idempotent."""
        await self.set("today", world)
        await self.set(world.forDate.isoformat(), world)
