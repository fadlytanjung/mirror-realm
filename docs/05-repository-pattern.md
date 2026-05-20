# 05 — Repository Pattern

> **Status**: normative · **Owner**: project lead · **Last revised**: 2026-05-20

How the backend talks to storage. Defines an abstract `Repository[T]` interface, concrete Firestore implementations, transaction boundaries, and the testing strategy that lets us swap real Firestore for the emulator without changing call sites.

---

## Table of Contents

1. [Why a repository layer at all](#why)
2. [`AbstractRepository[T]` interface](#abstract)
3. [Concrete repositories](#concrete)
4. [Firestore client adapter](#client)
5. [Transactions](#transactions)
6. [Pagination & queries](#queries)
7. [Error mapping](#errors)
8. [Testing the layer](#testing)

---

<a id="why"></a>

## 1. Why a repository layer at all

We use Firestore directly via `google-cloud-firestore`. So why a repository layer?

1. **One place per collection where mapping logic lives.** Pydantic → dict → Firestore happens in `LevelRepository.set()`, nowhere else.
2. **Testability without mocks.** The emulator gives real Firestore semantics; we just point the adapter at it via env var. No interface re-implementation needed.
3. **Service code reads cleanly.** `await self.levels.get(hash)` beats wiring the client + collection name + decode dance at every call site.
4. **Boundary for cost guards & telemetry.** Span attributes (`db.collection`, `db.op`) are added in one place.

What we **don't** do: write an ORM. Firestore isn't relational. Repositories are thin shims.

<a id="abstract"></a>

## 2. `AbstractRepository[T]` interface

```python
# apps/api/app/repositories/base.py
# docs: 05-repository-pattern.md#abstract
from abc import ABC, abstractmethod
from typing import Generic, TypeVar
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)

class AbstractRepository(ABC, Generic[T]):
    """
    Thin async CRUD over one Firestore collection.
    Implementations decode/encode via Pydantic; no domain logic here.
    """

    @abstractmethod
    async def get(self, doc_id: str) -> T | None: ...

    @abstractmethod
    async def set(self, doc_id: str, entity: T) -> None:
        """Idempotent. Overwrites existing doc."""

    @abstractmethod
    async def delete(self, doc_id: str) -> None:
        """Returns silently if doc doesn't exist."""

    @abstractmethod
    async def exists(self, doc_id: str) -> bool: ...
```

Each concrete repository adds collection-specific query methods (e.g. `LevelRepository.oldest_submission()`), but never adds CRUD methods beyond what's above.

<a id="concrete"></a>

## 3. Concrete repositories

### 3.1 LevelRepository

```python
# apps/api/app/repositories/levels.py
# docs: 05-repository-pattern.md#concrete
from google.cloud.firestore_v1 import AsyncCollectionReference
from pydantic import BaseModel
from datetime import datetime

from .base import AbstractRepository
from ..domain.level import Level

class StoredLevel(BaseModel):
    """What we persist for short-URL sharing. The Level itself plus metadata."""
    level: Level
    createdAt: datetime
    ttl: datetime              # createdAt + 30 days

class LevelRepository(AbstractRepository[StoredLevel]):
    COLLECTION = "levels"

    def __init__(self, collection: AsyncCollectionReference) -> None:
        self._col = collection

    async def get(self, doc_id: str) -> StoredLevel | None:
        snap = await self._col.document(doc_id).get()
        if not snap.exists:
            return None
        return StoredLevel.model_validate(snap.to_dict())

    async def set(self, doc_id: str, entity: StoredLevel) -> None:
        await self._col.document(doc_id).set(entity.model_dump(mode="json"))

    async def delete(self, doc_id: str) -> None:
        await self._col.document(doc_id).delete()

    async def exists(self, doc_id: str) -> bool:
        snap = await self._col.document(doc_id).get()
        return snap.exists
```

### 3.2 SubmissionRepository

```python
# apps/api/app/repositories/submissions.py
# docs: 05-repository-pattern.md#concrete
from google.cloud.firestore_v1 import AsyncCollectionReference
from .base import AbstractRepository
from ..domain.submission import Submission

class SubmissionRepository(AbstractRepository[Submission]):
    COLLECTION = "submissions"

    def __init__(self, collection: AsyncCollectionReference) -> None:
        self._col = collection

    async def get(self, doc_id: str) -> Submission | None:
        snap = await self._col.document(doc_id).get()
        return Submission.model_validate(snap.to_dict()) if snap.exists else None

    async def set(self, doc_id: str, entity: Submission) -> None:
        await self._col.document(doc_id).set(entity.model_dump(mode="json"))

    async def delete(self, doc_id: str) -> None:
        await self._col.document(doc_id).delete()

    async def exists(self, doc_id: str) -> bool:
        snap = await self._col.document(doc_id).get()
        return snap.exists

    # Collection-specific:
    async def pop_oldest(self) -> Submission | None:
        """Atomic-ish: read oldest, delete it, return. Used by daily rotation."""
        q = self._col.order_by("createdAt").limit(1)
        async for snap in q.stream():
            entity = Submission.model_validate(snap.to_dict())
            await snap.reference.delete()
            return entity
        return None
```

> **Note on `pop_oldest`**: not truly atomic across reads + delete. Acceptable because the daily rotation has exactly one caller (the cron) — no contention. If we later let users trigger rotation, wrap in a Firestore transaction.

### 3.3 DailyRepository

```python
# apps/api/app/repositories/daily.py
# docs: 05-repository-pattern.md#concrete
from datetime import date
from google.cloud.firestore_v1 import AsyncCollectionReference
from .base import AbstractRepository
from ..domain.daily import DailyWorld

class DailyRepository(AbstractRepository[DailyWorld]):
    COLLECTION = "daily"

    def __init__(self, collection: AsyncCollectionReference) -> None:
        self._col = collection

    async def get(self, doc_id: str) -> DailyWorld | None:
        snap = await self._col.document(doc_id).get()
        return DailyWorld.model_validate(snap.to_dict()) if snap.exists else None

    async def set(self, doc_id: str, entity: DailyWorld) -> None:
        await self._col.document(doc_id).set(entity.model_dump(mode="json"))

    async def delete(self, doc_id: str) -> None:
        await self._col.document(doc_id).delete()

    async def exists(self, doc_id: str) -> bool:
        snap = await self._col.document(doc_id).get()
        return snap.exists

    # Collection-specific:
    async def get_today(self) -> DailyWorld | None:
        return await self.get("today")

    async def set_today_and_archive(self, world: DailyWorld) -> None:
        """Write to BOTH daily/today and daily/{forDate}. Idempotent."""
        await self.set("today", world)
        await self.set(world.forDate.isoformat(), world)
```

### 3.4 CostGuardRepository

```python
# apps/api/app/repositories/cost_guard.py
# docs: 05-repository-pattern.md#concrete
from google.cloud.firestore_v1 import AsyncCollectionReference, Increment
from .base import AbstractRepository
from ..domain.cost_guard import CostGuardRecord

class CostGuardRepository(AbstractRepository[CostGuardRecord]):
    COLLECTION = "costGuard"

    def __init__(self, collection: AsyncCollectionReference) -> None:
        self._col = collection

    async def get(self, doc_id: str) -> CostGuardRecord | None:
        snap = await self._col.document(doc_id).get()
        return CostGuardRecord.model_validate(snap.to_dict()) if snap.exists else None

    async def set(self, doc_id: str, entity: CostGuardRecord) -> None:
        await self._col.document(doc_id).set(entity.model_dump(mode="json"))

    async def delete(self, doc_id: str) -> None:
        await self._col.document(doc_id).delete()

    async def exists(self, doc_id: str) -> bool:
        snap = await self._col.document(doc_id).get()
        return snap.exists

    # Collection-specific atomic counter updates:
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

    async def increment_submission(self, doc_id: str, *, device_hash: str) -> None:
        await self._col.document(doc_id).set(
            {
                "submissions": Increment(1),
                f"submissionsByDevice.{device_hash}": Increment(1),
                "forDate": doc_id,
            },
            merge=True,
        )
```

Atomic increments via `Increment(N)` mean parallel requests can't lose counter writes. Firestore handles this server-side.

<a id="client"></a>

## 4. Firestore client adapter

A single async Firestore client is created at FastAPI startup and threaded into repositories via FastAPI's dependency-injection system.

```python
# apps/api/app/adapters/firestore_client.py
# docs: 05-repository-pattern.md#client
from functools import lru_cache
from google.cloud import firestore
from google.cloud.firestore_v1 import AsyncClient
from ..settings import settings

@lru_cache(maxsize=1)
def firestore_client() -> AsyncClient:
    """Singleton. Picks up GOOGLE_APPLICATION_CREDENTIALS / workload identity automatically."""
    return AsyncClient(project=settings.gcp_project, database=settings.firestore_database)
```

```python
# apps/api/app/repositories/__init__.py
# docs: 05-repository-pattern.md#client
from fastapi import Depends
from ..adapters.firestore_client import firestore_client
from .levels import LevelRepository
from .submissions import SubmissionRepository
from .daily import DailyRepository
from .cost_guard import CostGuardRepository

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
```

Routers receive repositories via `Depends(...)`. This is what makes substituting the emulator a one-env-var change.

<a id="transactions"></a>

## 5. Transactions

Mirror Realm needs transactions in exactly **one** place: the daily-rotate handler, where we want "pop oldest submission + write daily/today + delete submission" to be all-or-nothing.

Because the rotate handler has a single caller (Cloud Scheduler), and contention is impossible, we **don't** wrap it in a Firestore transaction in v1. Failure mode: a partial rotation could leave a submission deleted but daily/today not updated. Recovery: the operator re-runs the cron manually (`gcloud scheduler jobs run daily-rotate`) and the queue is one shorter.

If/when this gets multi-caller, wrap with `firestore.AsyncClient.transaction()` — but write the spec change in this doc first.

Counters use `Increment(N)` which is server-side atomic; no transaction needed.

<a id="queries"></a>

## 6. Pagination & queries

v1 has exactly one query that returns multiple results: `pop_oldest()`, which uses `limit(1)`. We don't need cursor-based pagination.

If a future feature needs paging (e.g. browsing submission queue from an admin page), add a `list(after: Cursor | None, limit: int)` method to the relevant repository, returning `(items, next_cursor)`. Document it here before implementing.

<a id="errors"></a>

## 7. Error mapping

Firestore client errors are wrapped at the repository layer into our internal exception hierarchy:

```python
# apps/api/app/errors.py
# docs: 05-repository-pattern.md#errors
class RepositoryError(Exception): ...
class NotFound(RepositoryError): ...
class ConflictError(RepositoryError): ...   # reserved; unused in v1
class UnavailableError(RepositoryError): ...
```

Mapping (handled by a small decorator on each repo method):

| Firestore exception | Our exception | HTTP status (mapped in router) |
|---|---|---|
| `google.api_core.exceptions.NotFound` | not raised — we return `None` from `get()` | (n/a — endpoint maps None → 404) |
| `google.api_core.exceptions.ServiceUnavailable` / `DeadlineExceeded` | `UnavailableError` | 503 |
| `google.api_core.exceptions.GoogleAPICallError` (other) | `RepositoryError` | 500 |

Routers map our exceptions to HTTP via FastAPI exception handlers, not inline `try/except`.

<a id="testing"></a>

## 8. Testing the layer

Repositories are tested against the **real Firestore emulator**, not mocks. See [`14-testing-strategy.md`](./14-testing-strategy.md) for the harness.

Test rules:

- One test class per repository.
- Each test starts with an empty collection (fixture clears).
- Tests assert behavior, never implementation details (no patching `_col.document`).
- Integration tests (router → service → repo → emulator) live in `apps/api/tests/integration/`.

What's NOT tested at this layer:

- Domain invariants — tested in `app/domain/` tests, not repository tests.
- Agent retry logic — tested in `app/agents/` tests with a fake Vertex stub.

---

_End of 05 — Repository Pattern._
