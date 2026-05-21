# apps/api/app/repositories/submissions.py
# docs: 05-repository-pattern.md#concrete
from __future__ import annotations

from google.cloud.firestore_v1 import AsyncCollectionReference

from ..domain.submission import Submission
from .base import AbstractRepository, map_firestore_errors


class SubmissionRepository(AbstractRepository[Submission]):
    COLLECTION = "submissions"

    def __init__(self, collection: AsyncCollectionReference) -> None:
        self._col = collection

    @map_firestore_errors
    async def get(self, doc_id: str) -> Submission | None:
        snap = await self._col.document(doc_id).get()
        return Submission.model_validate(snap.to_dict()) if snap.exists else None

    @map_firestore_errors
    async def set(self, doc_id: str, entity: Submission) -> None:
        await self._col.document(doc_id).set(entity.model_dump(mode="json"))

    @map_firestore_errors
    async def delete(self, doc_id: str) -> None:
        await self._col.document(doc_id).delete()

    @map_firestore_errors
    async def exists(self, doc_id: str) -> bool:
        snap = await self._col.document(doc_id).get()
        return bool(snap.exists)

    # Collection-specific:
    @map_firestore_errors
    async def pop_oldest(self) -> Submission | None:
        """Read oldest by createdAt, delete it, return. Single caller (cron) — no contention."""
        q = self._col.order_by("createdAt").limit(1)
        async for snap in q.stream():
            entity = Submission.model_validate(snap.to_dict())
            await snap.reference.delete()
            return entity
        return None
