# apps/api/app/repositories/base.py
# docs: 05-repository-pattern.md#abstract · #errors
from __future__ import annotations

import functools
from abc import ABC, abstractmethod
from collections.abc import Callable, Coroutine
from typing import Any, Generic, ParamSpec, TypeVar

from google.api_core import exceptions as gcloud_exc
from pydantic import BaseModel

from ..errors import RepositoryError, UnavailableError

T = TypeVar("T", bound=BaseModel)
P = ParamSpec("P")
R = TypeVar("R")

_Coro = Callable[P, Coroutine[Any, Any, R]]


def map_firestore_errors(fn: _Coro[P, R]) -> _Coro[P, R]:
    """Translate google.api_core errors into our exception hierarchy (docs/05 §7)."""

    @functools.wraps(fn)
    async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return await fn(*args, **kwargs)
        except (gcloud_exc.ServiceUnavailable, gcloud_exc.DeadlineExceeded) as exc:
            raise UnavailableError() from exc
        except gcloud_exc.GoogleAPICallError as exc:
            raise RepositoryError() from exc

    return wrapper


class AbstractRepository(ABC, Generic[T]):
    """Thin async CRUD over one Firestore collection. No domain logic here."""

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
