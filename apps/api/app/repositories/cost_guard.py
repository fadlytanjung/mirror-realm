# apps/api/app/repositories/cost_guard.py
# docs: 05-repository-pattern.md#concrete
from __future__ import annotations

from google.cloud.firestore_v1 import AsyncCollectionReference, Increment

from ..domain.cost_guard import CostGuardRecord
from .base import AbstractRepository, map_firestore_errors


class CostGuardRepository(AbstractRepository[CostGuardRecord]):
    COLLECTION = "costGuard"

    def __init__(self, collection: AsyncCollectionReference) -> None:
        self._col = collection

    @map_firestore_errors
    async def get(self, doc_id: str) -> CostGuardRecord | None:
        snap = await self._col.document(doc_id).get()
        return CostGuardRecord.model_validate(snap.to_dict()) if snap.exists else None

    @map_firestore_errors
    async def set(self, doc_id: str, entity: CostGuardRecord) -> None:
        await self._col.document(doc_id).set(entity.model_dump(mode="json"))

    @map_firestore_errors
    async def delete(self, doc_id: str) -> None:
        await self._col.document(doc_id).delete()

    @map_firestore_errors
    async def exists(self, doc_id: str) -> bool:
        snap = await self._col.document(doc_id).get()
        return bool(snap.exists)

    # Collection-specific atomic counter updates (server-side, lossless):
    @map_firestore_errors
    async def increment_gemini_call(
        self,
        doc_id: str,
        *,
        input_tokens: int,
        output_tokens: int,
        estimated_cost_usd: float,
    ) -> None:
        await self._col.document(doc_id).set(
            {
                "geminiCalls": Increment(1),
                "geminiInputTokens": Increment(input_tokens),
                "geminiOutputTokens": Increment(output_tokens),
                "estimatedCostUsd": Increment(estimated_cost_usd),
                "forDate": doc_id,
            },
            merge=True,
        )

    @map_firestore_errors
    async def increment_submission(self, doc_id: str, *, device_hash: str) -> None:
        await self._col.document(doc_id).set(
            {
                "submissions": Increment(1),
                f"submissionsByDevice.{device_hash}": Increment(1),
                "forDate": doc_id,
            },
            merge=True,
        )
