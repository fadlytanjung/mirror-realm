# apps/api/app/adapters/vertex_client.py
# docs: 06-ai-agent-layer.md · 03-tech-stack.md#ai
#
# Points google-genai / ADK at Vertex AI (not AI Studio) using workload identity /
# ADC — no API keys (docs/13 §3). Called once at startup.
from __future__ import annotations

import os

import structlog

from ..settings import settings

log = structlog.get_logger(__name__)


def configure_vertex() -> None:
    # google-genai reads these to route through Vertex with ADC.
    os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "true")
    os.environ.setdefault("GOOGLE_CLOUD_PROJECT", settings.gcp_project)
    os.environ.setdefault("GOOGLE_CLOUD_LOCATION", settings.gcp_location)
    log.info("vertex_configured", project=settings.gcp_project, location=settings.gcp_location)


def check_vertex_credentials() -> bool:
    """Lightweight ADC check for /readyz (no model call)."""
    try:
        import google.auth

        google.auth.default()
        return True
    except Exception as exc:  # noqa: BLE001 — readiness probe must not raise
        log.warning("vertex_credentials_unavailable", error=str(exc))
        return False
