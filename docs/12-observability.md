# 12 — Observability

> **Status**: normative · **Owner**: project lead · **Last revised**: 2026-05-20

How we know the system is healthy. Tracing, logging, dashboards, and the small set of alerts we actually want paged about.

---

## Table of Contents

1. [Observability stack](#stack)
2. [Logs](#logs)
3. [Traces](#traces)
4. [Metrics & dashboards](#metrics)
5. [Alerts (what wakes you up)](#alerts)
6. [Cost-relevant signals](#cost-signals)
7. [Frontend observability](#frontend)

---

<a id="stack"></a>

## 1. Observability stack

| Concern | Tool | Why |
|---|---|---|
| Structured logs | Cloud Logging | Default for Cloud Run; structlog → JSON → automatic ingest |
| Traces | Cloud Trace via OpenTelemetry | ADK and FastAPI both export OTel; one trace tree per request |
| Metrics | Cloud Monitoring | Auto-collected for Cloud Run (req count, latency, instance count) + custom metrics |
| Dashboards | Cloud Monitoring custom dashboards | Two charts: cost/day, requests/day. That's it. |
| Alerts | Cloud Monitoring alerting + email | Billing kill-switch is the critical one |
| Frontend errors | None (v1) | Web Vitals not collected; if we need it later, add Cloud Monitoring RUM |

Nothing third-party. No Sentry, no Datadog. See [`03-tech-stack.md#banned`](./03-tech-stack.md#banned).

<a id="logs"></a>

## 2. Logs

`structlog` emits JSON to stdout. Cloud Run captures stdout and Cloud Logging parses the JSON keys.

### Standard log fields

Every log line carries:

| Field | Source | Example |
|---|---|---|
| `severity` | structlog level | `INFO`, `WARNING`, `ERROR` |
| `message` | event name | `analyze_succeeded` |
| `mr.requestId` | uvicorn middleware | UUID per request |
| `mr.traceId` | OTel | matches Cloud Trace id |
| `mr.deviceHash` | request | only set if endpoint received it |
| `mr.vibe` | agent | only on analyze paths |
| `mr.tokens_in` / `mr.tokens_out` | agent | analyze only |
| `mr.retry` | router | analyze only |
| `mr.durationMs` | middleware | every request |

### Log levels (use these, not arbitrary strings)

| Level | When |
|---|---|
| `DEBUG` | Disabled in production; verbose detail for local dev only |
| `INFO` | Normal events: request started/ended, agent run, level promoted to daily, etc. |
| `WARNING` | Recovered errors: agent retry triggered, daily rotate skipped (empty queue), vibe fallback used |
| `ERROR` | Unrecovered errors: timeouts, 5xx returned, kill switch fired |
| `CRITICAL` | Not used (no human is paged from app code; only from billing alerts) |

### Structured logger setup

```python
# apps/api/app/telemetry/logging.py
# docs: 12-observability.md#logs
import logging
import structlog

def configure_logging() -> None:
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        logger_factory=structlog.PrintLoggerFactory(),
    )
```

Per-request fields are bound via `structlog.contextvars.bind_contextvars(...)` in middleware so every log line within the request inherits them.

<a id="traces"></a>

## 3. Traces

ADK ships OTel; we configure the Cloud Trace exporter once at startup ([`06-ai-agent-layer.md#tracing`](./06-ai-agent-layer.md#tracing)).

### Trace structure for `/api/analyze`

```
POST /api/analyze                                  ── FastAPI auto-instrumentation
└── analyze_request                                ── manual root span in router
    ├── cost_guard.check
    │   └── firestore.get costGuard/{today}
    ├── level_designer.run                         ── ADK
    │   └── vertex.generate_content
    ├── reachability.check
    ├── (retry) level_designer.run                 ── present only on retry
    │   └── vertex.generate_content
    ├── (retry) reachability.check
    └── cost_guard.record
        └── firestore.set costGuard/{today}
```

### Span attribute conventions (re-stated for visibility)

| Attribute | Where set |
|---|---|
| `mr.endpoint` | Each router; e.g. `analyze`, `submit`, `daily-rotate` |
| `mr.vibe` | analyze, submit |
| `mr.platforms` | analyze, submit |
| `mr.retry` | analyze |
| `mr.tokens_in` / `mr.tokens_out` | level_designer.run |
| `mr.reachable` | analyze, submit (post-check) |
| `mr.budget_remaining_calls` | cost_guard.check |
| `mr.error_code` | when an error is raised |

### Reading traces

In Cloud Console → Trace Explorer:

- Filter: `service.name = mirror-realm-api`
- For p95 latency: change "Trace explorer" to "Aggregated"
- Drill into an individual trace by clicking; child spans render Vertex AI latency contributions

The user-facing `tracingId` returned in error envelopes ([`07-api-contracts.md#errors`](./07-api-contracts.md#errors)) is the OTel trace id. Pasting it into Trace Explorer's "Trace ID" filter jumps straight to that request.

<a id="metrics"></a>

## 4. Metrics & dashboards

We rely heavily on Cloud Run's built-in metrics:

| Built-in metric | What it tells us |
|---|---|
| `run.googleapis.com/request_count` | Traffic per endpoint (filter by `route`) |
| `run.googleapis.com/request_latencies` | p50/p95/p99 per endpoint |
| `run.googleapis.com/container/cpu/utilizations` | Are we under-/over-sized? |
| `run.googleapis.com/container/instance_count` | How close to `--max-instances 5`? |
| `aiplatform.googleapis.com/prediction/request_count` | Vertex calls (cross-check with our own counter) |

Custom metrics (emitted via OTel):

| Custom metric | Type | Purpose |
|---|---|---|
| `mr.agent.tokens_in` | counter | Sum input tokens per day |
| `mr.agent.tokens_out` | counter | Sum output tokens per day |
| `mr.agent.retry_total` | counter | How often we retry |
| `mr.agent.unreachable_after_retry` | counter | How often retry still fails |
| `mr.budget.estimated_usd` | gauge | Daily running cost |

### The single dashboard

`infra/dashboards/mirror-realm.json` (Cloud Monitoring dashboard JSON) has:

1. **Daily cost** — line chart of `mr.budget.estimated_usd` for the last 30 days. Visible band at $1/day soft cap.
2. **Requests/day** — bar chart of `request_count` per endpoint.
3. **p95 latency** — line per endpoint.
4. **Retry rate** — `mr.agent.retry_total / request_count(analyze)` as a percentage.
5. **Errors** — `request_count` with `response_code_class != 2xx`, grouped by error code (from span attribute `mr.error_code`).

That's it. No fancy panels. The dashboard's job is to be readable in 10 seconds.

<a id="alerts"></a>

## 5. Alerts (what wakes you up)

We have a personal-project bar: alerts only for things that cost money or break the product silently.

| Alert | Condition | Notification |
|---|---|---|
| **Billing kill-switch fired** | Cloud Function `disable-billing` logs `DISABLED billing` | Email — this is your "the budget tripped" notice |
| **Daily rotation failed for 2 days in a row** | `daily_rotation_skipped` log occurs and `daily/today.forDate < today - 1 day` | Email — Daily World is stale |
| **5xx rate > 5% over 10 minutes** | Cloud Monitoring | Email — something is broken |
| **Vertex AI auth errors** | Log query for `DefaultCredentialsError` or `PermissionDenied` | Email — likely IAM regression |

That's it. We deliberately do **not** alert on:
- Latency creeping up (you see it on the dashboard when you log in)
- Single-request errors (noise)
- Cost approaching but not exceeding budget (the budget alert ladder at 50/90/100% covers this)

Alert delivery is via email to the project owner. No PagerDuty. No phone calls. This is a hobby project.

<a id="cost-signals"></a>

## 6. Cost-relevant signals

To monitor spend without waiting for the monthly bill:

1. `mr.budget.estimated_usd` on the dashboard (our own running estimate).
2. GCP Billing → Reports (lags by ~24h but authoritative).
3. The CostGuard Firestore doc at `costGuard/{today}` is a peek into "what's my real-time spend look like".

These three should agree within 10-15%. If they diverge significantly:
- Our token-to-USD math is off (update `INPUT_PRICE_PER_MTOK` / `OUTPUT_PRICE_PER_MTOK` in `apps/api/app/services/cost_guard.py`).
- Vertex pricing changed.
- A non-Vertex service spiked (e.g. Cloud Storage egress from an MP4 stretch).

<a id="frontend"></a>

## 7. Frontend observability

v1 has no production telemetry from the PWA. Reasons:

- No personal data without consent. We don't want to figure out a consent flow.
- The single critical metric (end-to-end latency from shutter to playable) is observable server-side at `/api/analyze`.
- Web Vitals add a 3rd-party dependency we don't want.

If we ever need it: Cloud Monitoring RUM exists. Document here before adding.

For local development, browser DevTools' Performance tab is the entire frontend "observability stack."

---

_End of 12 — Observability._
