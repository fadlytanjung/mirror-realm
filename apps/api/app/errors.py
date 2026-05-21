# apps/api/app/errors.py
# docs: 07-api-contracts.md#errors · 05-repository-pattern.md#errors
from __future__ import annotations

from pydantic import BaseModel


# --- Error envelope (docs/07 §10) -------------------------------------------
class ApiErrorDetail(BaseModel):
    code: str
    message: str
    tracingId: str | None = None


class ApiErrorResponse(BaseModel):
    error: ApiErrorDetail


# --- Domain / app exceptions -------------------------------------------------
class MirrorRealmError(Exception):
    """Base. Each subclass maps to one canonical error code + HTTP status."""

    code: str = "internal"
    http_status: int = 500
    message: str = "Something went wrong."


class ValidationFailed(MirrorRealmError):
    code = "validation_failed"
    http_status = 400
    message = "That request didn't look right — try again."


class BudgetExhausted(MirrorRealmError):
    code = "budget_exhausted"
    http_status = 503
    message = "We're full for the month — try yesterday's Daily World."


class SafetyFilterError(MirrorRealmError):
    code = "safety_filter"
    http_status = 422
    message = "We can't read this scene — try another."


class AgentTimeoutError(MirrorRealmError):
    code = "agent_timeout"
    http_status = 504
    message = "Reading is taking too long — try a different photo."


class AgentError(MirrorRealmError):
    code = "agent_error"
    http_status = 500
    message = "The level designer hit a snag — try again."


class UnreachableLevel(MirrorRealmError):
    code = "unreachable_level"
    http_status = 422
    message = "That level can't be finished."


class SubmissionRateLimited(MirrorRealmError):
    code = "submission_rate_limited"
    http_status = 429
    message = "That's plenty of submissions for today — try again tomorrow."


class NotFoundError(MirrorRealmError):
    code = "not_found"
    http_status = 404
    message = "Not found."


class NoDailyYet(MirrorRealmError):
    code = "no_daily_yet"
    http_status = 404
    message = "Daily World hasn't started yet — submit a level!"


class UnauthorizedError(MirrorRealmError):
    code = "unauthorized"
    http_status = 401
    message = "Not authorized."


class ExpiredError(MirrorRealmError):
    code = "expired"
    http_status = 410
    message = "This level has expired."


class HashCollisionError(MirrorRealmError):
    code = "hash_collision"
    http_status = 500
    message = "Could not store that level — try again."


# --- Repository-layer exceptions (docs/05 §7) --------------------------------
class RepositoryError(MirrorRealmError):
    code = "internal"
    http_status = 500


class UnavailableError(RepositoryError):
    code = "firestore_unavailable"
    http_status = 503
    message = "Database hiccup — try again."


class ConflictError(RepositoryError):  # reserved; unused in v1
    code = "conflict"
    http_status = 409
