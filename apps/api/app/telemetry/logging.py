# apps/api/app/telemetry/logging.py
# docs: 12-observability.md · 03-tech-stack.md (structlog)
from __future__ import annotations

import logging

import structlog


def configure_logging() -> None:
    """Structured JSON logs for Cloud Logging."""
    logging.basicConfig(format="%(message)s", level=logging.INFO)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.dict_tracebacks,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )
