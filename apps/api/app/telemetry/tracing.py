# apps/api/app/telemetry/tracing.py
# docs: 06-ai-agent-layer.md#tracing · 12-observability.md
from __future__ import annotations

import structlog
from opentelemetry import trace

from ..settings import settings

log = structlog.get_logger(__name__)


def configure_tracing() -> None:
    """Wire the Cloud Trace exporter. No-op (logged) if disabled or unavailable."""
    if not settings.trace_enabled:
        return
    try:
        from opentelemetry.exporter.cloud_trace import CloudTraceSpanExporter
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        resource = Resource.create(
            {"service.name": "mirror-realm-api", "service.version": settings.git_sha}
        )
        provider = TracerProvider(resource=resource)
        exporter = CloudTraceSpanExporter(project_id=settings.gcp_project)  # type: ignore[no-untyped-call]
        provider.add_span_processor(BatchSpanProcessor(exporter))
        trace.set_tracer_provider(provider)
    except Exception as exc:  # local dev without ADC / exporter — degrade gracefully
        log.warning("tracing_disabled", error=str(exc))


def get_tracer() -> trace.Tracer:
    return trace.get_tracer("mirror-realm")


def current_trace_id() -> str:
    """Hex trace id of the active span, or '' when no span is recording."""
    ctx = trace.get_current_span().get_span_context()
    if ctx.trace_id == 0:
        return ""
    return format(ctx.trace_id, "032x")
