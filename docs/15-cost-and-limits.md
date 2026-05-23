# 15 — Cost & Limits

> **Status**: normative · **Owner**: project lead · **Last revised**: 2026-05-20

What this costs to run, what the safety nets are, and what happens when you (or a viral burst) hit them.

---

## Table of Contents

1. [Per-call cost](#per-call)
2. [Monthly scenarios](#scenarios)
3. [Free-tier headroom](#free-tier)
4. [Soft caps (in-app)](#soft)
5. [Hard cap (billing kill switch)](#hard)
6. [What happens at each cap](#cap-effects)
7. [Pricing assumptions — verify before deploy](#assumptions)

---

<a id="per-call"></a>

## 1. Per-call cost

Mirror Realm's only meaningful runtime cost is Gemini. Everything else lives inside free tiers at hobby scale.

> _Changed: 2026-05-23 — switched to **gemini-3.5-flash** ($1.50 / $9.00 per 1M
> input/output tokens, ~15–22× gemini-3.1-flash-lite). Per-level cost rose accordingly;
> the $1/day soft cap now trips around ~30–60 analyses/day. Thinking is disabled on the
> agent call to keep latency + cost down. Bump `MR_DAILY_GEMINI_USD_CAP` in the secret if
> you need more headroom while testing._

| Action | Tokens / units | Cost (USD) |
|---|---|---|
| One `/api/analyze` happy path (1 image ≈ 258 image-tokens + ~300 text-in + ~600 out) | ~1158 input + 600 output | **~$0.007** |
| Same, but with a retry (2 model calls) | doubled | **~$0.015** |
| One Imagen 4 Fast image (offline, asset-gen only) | 1 image | **~$0.04** (one-time during dev) |
| Firestore write | 1 op | $0 (within free tier) |
| Firestore read | 1 op | $0 (within free tier) |
| Cloud Run invocation | 1 req | $0 (within free tier) |
| Firebase Hosting GET | 1 | $0 (within free tier) |

Practical bottom line: **a level costs roughly 0.7–1.5 US cents** with gemini-3.5-flash.
The monthly scenarios below were sized for the old flash-lite price — scale them ~15×,
but remember the **$1/day soft cap** bounds actual spend regardless (excess → friendly 503).

<a id="scenarios"></a>

## 2. Monthly scenarios

| Scenario | Levels/day | Levels/month | Estimated cost |
|---|---|---|---|
| You alone, fidgeting | 5 | ~150 | **$0.08** |
| You + 20 friends sharing QRs | 100 | ~3,000 | **$1.50** |
| Demo at a party — one night burst | 200 (in one night) | — | **~$0.10 that night** |
| Daily World averages 50 plays/day | 0 _model_ calls (level cached) | 1,500 plays | **$0** (no AI calls) |
| Surprise viral spike — 10k levels in a day | 10,000 | — | **~$5 that day** (capped to $1 by soft cap → user-facing 503 after) |
| Disaster — bug causes infinite loop | bounded | — | **$15** then halts via kill switch |

The kill-switch ensures the worst-case month cannot exceed about $15-17 (the budget plus a small over-run before billing actually disables).

<a id="free-tier"></a>

## 3. Free-tier headroom

GCP always-free allowances we rely on (not promotional credit):

| Service | Always-free monthly allotment | Our expected usage |
|---|---|---|
| Cloud Run | 2,000,000 requests | <100k (50× headroom) |
| Firestore reads | 50,000/day | <5,000/day |
| Firestore writes | 20,000/day | <500/day |
| Firestore storage | 1 GiB | <10 MiB |
| Cloud Scheduler | 3 jobs | 1 |
| Cloud Build | 120 build-minutes/day | <10 (we deploy by hand or via uv-cached CI) |
| Firebase Hosting | 10 GB storage + 360 MB/day egress | <20 MB total + <50 MB/day egress |

Going viral 100× still doesn't push us off the Firestore / Cloud Run free tier. The limiting resource is Gemini.

<a id="soft"></a>

## 4. Soft caps (in-app)

Enforced by `apps/api/app/services/cost_guard.py` via the `costGuard/{YYYY-MM-DD}` Firestore doc.

| Counter | Cap | Source of truth |
|---|---|---|
| `geminiCalls` | 300/day | `MR_DAILY_GEMINI_CALL_CAP` |
| `estimatedCostUsd` | $1/day | `MR_DAILY_GEMINI_USD_CAP` |
| `submissionsByDevice[deviceHash]` | 5/day | `MR_DAILY_SUBMISSION_CAP_PER_DEVICE` |

Per [`06-ai-agent-layer.md#cost`](./06-ai-agent-layer.md#cost), `CostGuard.check_can_run_agent(today)` is called before every agent invocation; tripping returns `BudgetExhausted` → HTTP 503.

Tuning notes:

- Soft caps exist to give the **operator** visibility before the **hard cap** actually disables billing.
- A trip is a soft event: nothing breaks; existing levels remain playable; submissions remain queued; Daily World keeps rotating; only the capture endpoint refuses new work.
- If you want to raise the cap intentionally (e.g. for a launch day), set the env var and redeploy — don't edit the database manually.

<a id="hard"></a>

## 5. Hard cap (billing kill switch)

Implemented per [`11-deployment-guide.md#budget`](./11-deployment-guide.md#budget).

```
GCP Billing Budget ($15/mo)
  └─→ Threshold rule at 100%
      └─→ Pub/Sub topic billing-alerts
          └─→ Cloud Function disable-billing
              └─→ Billing.projects.updateBillingInfo(billingAccountName="")
                  └─→ All billable services on this project stop within minutes
```

Properties:

- **Irreversible by the function**. The CF deliberately doesn't re-enable. You manually re-link a billing account from the Console when ready.
- **Project-wide**. Cloud Run, Firestore, Vertex — all stop. The PWA on Firebase Hosting may still serve (static assets continue from cache) until the user reloads; new API requests will fail.
- **Idempotent**. Repeated alert messages produce no additional effect.
- **Tested manually before launch**. To test: publish a fake alert to the topic that fakes 120% cost; verify CF logs `DISABLED billing`; re-enable billing from Console.

<a id="cap-effects"></a>

## 6. What happens at each cap

| Cap | Trips when | API behavior | User experience |
|---|---|---|---|
| 50% of monthly budget ($7.50) | Email only | unchanged | unchanged |
| 90% ($13.50) | Email only | unchanged | unchanged |
| 300 calls/day OR $1/day soft cap | Daily | `/api/analyze` returns 503 `budget_exhausted` | "We're full for today — try yesterday's Daily World" |
| 100% monthly ($15) | Email + kill switch | All endpoints fail (project billing disabled) | Site shows offline error after cached assets expire |
| 120% monthly ($18) | Email (already kill-switched) | Already down | Already down |
| Per-device 5/day submissions | Per device | `/api/submit` returns 429 | "You've submitted a lot today — come back tomorrow" |

The first three rows are noticed by the operator; the last three are noticed by users.

<a id="assumptions"></a>

## 7. Pricing assumptions — verify before deploy

> **Verify these numbers in the GCP pricing page at deploy time.** They were correct at 2026-05-20 for `gemini-3.5-flash` in `asia-southeast2`.

The pricing constants live in `apps/api/app/services/cost_guard.py`:

```python
INPUT_PRICE_PER_MTOK = 1.50     # USD per 1M input tokens (gemini-3.5-flash)
OUTPUT_PRICE_PER_MTOK = 9.00    # USD per 1M output tokens (gemini-3.5-flash)
```

If Google publishes a price change:

1. Update the constants in `cost_guard.py`.
2. Update the per-call cost table in [`§1`](#per-call) of this doc.
3. Update the monthly scenarios in [`§2`](#scenarios).
4. Commit as `docs(spec): update gemini pricing constants` with a link to the pricing announcement in the body.
5. Redeploy.

Imagen pricing changes only matter if/when we regenerate the cosmic tileset — non-runtime concern, but tracked for completeness.

---

_End of 15 — Cost & Limits._
