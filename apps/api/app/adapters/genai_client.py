# apps/api/app/adapters/genai_client.py
# docs: 06-ai-agent-layer.md#auth · 03-tech-stack.md#ai · 13-security.md#secrets
#
# Points google-genai at the Gemini Developer API (AI Studio) using
# MR_GEMINI_API_KEY. The key is injected from Secret Manager at deploy time
# (docs/13 §3) and from apps/api/.env locally. Called once at startup.
from __future__ import annotations

import os

import structlog

from ..settings import settings

log = structlog.get_logger(__name__)


def configure_genai() -> None:
    # Route google-genai at AI Studio (Gemini Developer API), not Vertex.
    os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "false"
    if settings.gemini_api_key:
        # google-genai reads GOOGLE_API_KEY; mirror MR_GEMINI_API_KEY into it.
        os.environ["GOOGLE_API_KEY"] = settings.gemini_api_key
    log.info("genai_configured", model=settings.gemini_model, has_key=bool(settings.gemini_api_key))


def check_genai_credentials() -> bool:
    """Lightweight check for /readyz: is an API key present? (no model call)."""
    return bool(settings.gemini_api_key or os.environ.get("GOOGLE_API_KEY"))
