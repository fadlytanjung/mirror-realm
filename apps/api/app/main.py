# apps/api/app/main.py
# docs: 01-architecture.md · 13-security.md#cors · 07-api-contracts.md
from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse

from .adapters.vertex_client import configure_vertex
from .errors import ApiErrorDetail, ApiErrorResponse, MirrorRealmError, ValidationFailed
from .routers import analyze, daily, health, level, submit
from .settings import settings
from .telemetry.logging import configure_logging
from .telemetry.tracing import configure_tracing, current_trace_id

log = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    configure_tracing()
    configure_vertex()
    log.info("startup", project=settings.gcp_project, model=settings.gemini_model)
    yield


app = FastAPI(
    title="Mirror Realm API",
    version="1",
    default_response_class=ORJSONResponse,
    lifespan=lifespan,
)

# CORS — exact-match allowlist, no wildcards (docs/13 §4).
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Mr-Device-Hash"],
    max_age=600,
)


@app.middleware("http")
async def api_version_header(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    response = await call_next(request)
    response.headers["X-MR-API-Version"] = "1"
    return response


def _error_response(exc: MirrorRealmError) -> ORJSONResponse:
    detail = ApiErrorDetail(
        code=exc.code, message=exc.message, tracingId=current_trace_id() or None
    )
    body = ApiErrorResponse(error=detail)
    return ORJSONResponse(status_code=exc.http_status, content=body.model_dump())


@app.exception_handler(MirrorRealmError)
async def handle_domain_error(_request: Request, exc: MirrorRealmError) -> ORJSONResponse:
    if exc.http_status >= 500:
        log.error("domain_error", code=exc.code, exc_info=exc)
    return _error_response(exc)


@app.exception_handler(RequestValidationError)
async def handle_validation_error(
    _request: Request, _exc: RequestValidationError
) -> ORJSONResponse:
    return _error_response(ValidationFailed())


@app.exception_handler(Exception)
async def handle_unexpected(_request: Request, exc: Exception) -> ORJSONResponse:
    log.error("unhandled_error", exc_info=exc)

    class _Internal(MirrorRealmError):
        pass

    return _error_response(_Internal())


app.include_router(health.router)
app.include_router(analyze.router)
app.include_router(level.router)
app.include_router(submit.router)
app.include_router(daily.router)
