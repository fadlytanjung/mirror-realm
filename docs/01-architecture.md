# 01 — Architecture

> **Status**: normative · **Owner**: project lead · **Last revised**: 2026-05-20

How the system is wired. Topology, request flows, failure modes, and the boundaries between layers.

---

## Table of Contents

1. [Topology](#topology)
2. [Layer responsibilities](#layers)
3. [Trust boundaries](#trust)
4. [Primary request flow — capture to play](#flow-capture)
5. [Secondary flows](#flow-secondary)
6. [Failure modes](#failures)
7. [Why this shape (and not the alternatives)](#why)

---

<a id="topology"></a>

## 1. Topology

```mermaid
flowchart TB
    subgraph iPhone["iPhone (iOS 14.5+ Safari)"]
        PWA["PWA (Vite + Phaser)<br/>installed via Add to Home Screen"]
    end

    subgraph FBH["Firebase Hosting (CDN, asia-southeast2 edge)"]
        Assets["Static bundle<br/>HTML / JS / CSS<br/>+ tilesets + SFX (~5MB)"]
    end

    subgraph Run["Cloud Run — mirror-realm-api"]
        FastAPI["FastAPI (Python 3.12)<br/>+ Google ADK"]
        Agent["LevelDesignerAgent<br/>(ADK Agent)"]
        Reach["Reachability checker<br/>(A* over platforms)"]
        FastAPI --> Agent
        FastAPI --> Reach
    end

    subgraph Vertex["Vertex AI (asia-southeast2)"]
        Gemini["gemini-3.1-flash-lite<br/>(vision + JSON mode)"]
    end

    subgraph Storage["GCP managed storage"]
        FS[("Firestore (Native)<br/>levels/, daily/today,<br/>submissions/, costGuard/")]
        GCS[("Cloud Storage<br/>(future: MP4 exports)")]
    end

    subgraph Ops["Operations"]
        Sched["Cloud Scheduler<br/>00:00 UTC — daily rotate"]
        Trace["Cloud Trace<br/>(ADK OTel exporter)"]
        Logs["Cloud Logging<br/>(structured)"]
        Budget["Billing alert + Pub/Sub<br/>+ kill-switch CF"]
    end

    PWA -->|"GET / (HTML, JS, tiles)"| FBH
    PWA -->|"POST /api/analyze<br/>POST /api/submit<br/>GET /api/daily<br/>GET /api/level/:hash"| FastAPI
    Agent -->|"workload identity"| Gemini
    FastAPI --> FS
    FastAPI -.->|"future: write generated mp4"| GCS
    Sched -->|"OIDC-authed HTTPS"| FastAPI
    FastAPI -.->|"spans"| Trace
    FastAPI -.->|"logs"| Logs
    Budget -.->|"disables billing on threshold"| Run
```

Single backend, single LLM, two GCP storage primitives. No queues, no caches, no API gateway. Every box on this diagram is justified in [`03-tech-stack.md`](./03-tech-stack.md); every box NOT on it is explicitly rejected in [`00-overview.md#non-goals`](./00-overview.md#non-goals).

<a id="layers"></a>

## 2. Layer responsibilities

| Layer | Responsibility | Forbidden from |
|---|---|---|
| **PWA (`apps/web`)** | Camera capture, JPEG compression, UI/UX, Phaser game runtime, QR encode/decode, IndexedDB local cache | Calling Vertex directly; storing secrets; persisting submissions; running reachability check |
| **API (`apps/api`)** | HTTP routing, request validation, ADK agent orchestration, reachability check, Firestore I/O, response shaping, cost-guard enforcement | UI logic; bundling static assets; storing per-user state |
| **Agent layer (`apps/api/app/agents`)** | Prompt management, schema-constrained Gemini calls, retry with stricter constraints | Direct HTTP routing; Firestore reads outside of context-prep tools |
| **Shared schemas (`packages/shared`)** | JSON Schema for Level + Vibe metadata, codegen sources for Pydantic and TS types | Containing executable code; depending on any framework |
| **Infra (`infra/`)** | Deploy scripts, Cloud Build config, Firebase config, IAM role lists | Application logic |

**The golden rule**: contracts cross layer boundaries only via files in `packages/shared/`. If two layers need to agree on a shape, that shape lives there.

<a id="trust"></a>

## 3. Trust boundaries

```mermaid
flowchart LR
    Untrusted["UNTRUSTED<br/>(any browser, any actor)"] -->|"HTTPS"| CORS["CORS allow<br/>only your hosting origin"]
    CORS --> Validated["VALIDATED<br/>(Pydantic-checked input)"]
    Validated --> Trusted["TRUSTED<br/>(internal Python code)"]
    Trusted -->|"workload identity"| GCP["GCP services<br/>(scoped IAM roles)"]
```

Three trust zones. Rules:

1. **Browser → API**: anything the browser sends is untrusted until Pydantic-validated. The CORS allowlist only stops casual cross-origin abuse; it is **not** an auth mechanism. If we ever need real anti-abuse, App Check goes here ([`13-security.md`](./13-security.md)).
2. **API → Vertex**: workload identity. No keys. The Cloud Run service account has exactly `roles/aiplatform.user` + `roles/datastore.user` + scoped `roles/storage.objectAdmin`. Audit: [`13-security.md#iam`](./13-security.md#iam).
3. **API → Firestore**: same workload identity. Security rules on Firestore are configured to deny all client-direct access — the only writer is the Cloud Run SA.

The PWA never holds anything secret. Concretely: the bundle's network surface is `GET https://<api>/api/*` + image fetches from Firebase Hosting. Anything else in the bundle is a bug.

<a id="flow-capture"></a>

## 4. Primary request flow — capture to play

This is C1 from the overview. The sequence that defines the product.

```mermaid
sequenceDiagram
    autonumber
    actor U as User (iPhone)
    participant W as PWA (Phaser shell)
    participant API as FastAPI /api/analyze
    participant CG as CostGuard
    participant A as LevelDesignerAgent (ADK)
    participant G as gemini-3.1-flash-lite
    participant RC as ReachabilityChecker
    participant FS as Firestore (costGuard/today)

    U->>W: Tap shutter
    W->>W: Compress to JPEG ≤200KB
    W->>W: Play scan animation (non-blocking)
    W->>API: POST /api/analyze {photo: base64}
    API->>API: Pydantic-validate request
    API->>CG: budget_remaining(today)?
    CG->>FS: get costGuard/today
    FS-->>CG: { tokens_spent, calls }
    CG-->>API: ok | denied
    alt denied
        API-->>W: 503 {code: "budget_exhausted"}
        W-->>U: "We're full for the month — try yesterday's Daily World"
    else ok
        API->>A: agent.run(image_bytes)
        A->>G: generate_content(image + system prompt, responseSchema=Level)
        G-->>A: candidate Level JSON
        A->>A: schema-validate (pydantic strict)
        A-->>API: candidate level
        API->>RC: is_reachable(level)?
        alt unreachable
            API->>A: retry with stricter physics constraints
            A->>G: generate_content(...retry)
            G-->>A: retry Level JSON
            A-->>API: retry level
            API->>RC: is_reachable(level)?
        end
        RC-->>API: ok
        API->>CG: record_usage(tokens, 1 call)
        CG->>FS: increment costGuard/today
        API-->>W: 200 {level}
        W->>W: Pick tileset by vibe, build Phaser scene
        W-->>U: Player drops in, level is playable
    end
```

Hard limits encoded in this flow:

- **Single retry only.** If retry also fails reachability, we return the retry level anyway with a flag `wasUnreachableOnFirstAttempt: true` so the client can show a hint. We do not loop indefinitely.
- **Timeouts**: agent call has a 25s wall clock; reachability check has 200ms wall clock. Hard fail outside those.
- **No image stored.** The photo is processed in memory and discarded. We never write the source image to GCS or Firestore.

<a id="flow-secondary"></a>

## 5. Secondary flows

### 5.1 Share via short URL (C3)

```mermaid
sequenceDiagram
    actor U as Creator
    participant W as PWA
    participant API as POST /api/level/save
    participant FS as Firestore levels/

    U->>W: Tap "Share"
    W->>W: lz-string compress level JSON
    alt fits in QR (≤ 600 bytes)
        W->>W: Encode QR with inline compressed JSON
        W-->>U: Show QR
    else too big
        W->>API: POST /api/level/save {compressed}
        API->>API: Hash 6 chars (collision check)
        API->>FS: levels/{hash}.set({compressed, ttl: +30d})
        FS-->>API: ok
        API-->>W: { url: "https://your-host.web.app/l/{hash}" }
        W->>W: Encode short URL into QR
        W-->>U: Show QR + copyable URL
    end
```

### 5.2 Open shared level (C4)

```mermaid
flowchart LR
    Scan["Scan QR or open URL"] --> Branch{"URL has<br/>/p/ or /l/?"}
    Branch -->|"/p/{compressed}"| Decode["lz-string decompress inline"]
    Branch -->|"/l/{hash}"| Fetch["GET /api/level/{hash}"]
    Fetch --> Decode
    Decode --> Validate["JSON-schema validate"]
    Validate --> Render["Phaser render"]
```

### 5.3 Daily World (C5 + C7)

```mermaid
flowchart LR
    Cron["Cloud Scheduler<br/>00:00 UTC"] -->|"OIDC HTTPS"| Rotate["POST /api/daily-rotate"]
    Rotate --> Pop["Pop oldest from submissions/<br/>(ordered by createdAt)"]
    Pop --> WriteToday["Firestore: daily/today.set(level)"]
    WriteToday --> WriteArchive["Firestore: daily/{YYYY-MM-DD}.set(level)"]
    AppOpen["App launch"] --> FetchDaily["GET /api/daily"]
    FetchDaily --> ReadToday["Firestore: get daily/today"]
    ReadToday --> Show["Render with offline cache"]
```

### 5.4 Submit (C6)

```mermaid
sequenceDiagram
    actor U as User
    participant W as PWA
    participant API as POST /api/submit
    participant FS as Firestore submissions/

    U->>W: Beat level, tap "Submit to Daily pool"
    W->>API: POST /api/submit {level, deviceHash}
    API->>API: Pydantic validate, check rate limit (5/day per deviceHash)
    API->>API: Reachability re-check (defense in depth)
    API->>FS: submissions/{contentHash}.set({level, createdAt, ttl})
    FS-->>API: ok (or "already submitted")
    API-->>W: { status: "queued" }
    W-->>U: "In the pool!"
```

<a id="failures"></a>

## 6. Failure modes

Defensive design — what fails, what we do, what the user sees.

| Failure | Detection | Response | User experience |
|---|---|---|---|
| Gemini returns invalid JSON (despite responseSchema) | Pydantic raises | Single retry with stricter prompt | 1-2s extra latency; transparent |
| Gemini returns unreachable level twice | A* fails after retry | Return retry anyway with `wasUnreachableOnFirstAttempt` flag | Subtle "tricky one!" badge |
| Gemini exceeds 25s wall clock | asyncio timeout | Return 504; client offers "try a different photo" | "Reading taking too long" |
| Safety filter blocks photo | Vertex returns safety-block error code | Return 422 with reason | "We can't read this scene" |
| Firestore unavailable | Google API error | Return 503; client suggests retry | "Database hiccup, try again" |
| Cost guard tripped | Daily limit exceeded | Return 503 `budget_exhausted` | "We're full — play Daily World" |
| Cloud Run cold start | First request of the day | Accept the 2-5s delay | Scan animation absorbs latency |
| iOS PWA loses camera context (suspended tab) | `getUserMedia` error on resume | Re-init camera | Brief reload state |
| QR scan returns garbage | jsQR decode + JSON validate fails | Show "invalid QR" toast | "Doesn't look like a Mirror Realm level" |
| Daily/today missing (cron didn't run) | Firestore returns nothing | Fall back to yesterday's archive | Tiny "yesterday's pick" label |

There is no retry loop wrapping the agent at the request boundary — retries live **inside** the agent layer with explicit caps. If the API endpoint returns an error, the client treats it as terminal.

<a id="why"></a>

## 7. Why this shape (and not the alternatives)

| Choice | Alternative we considered | Why we picked this |
|---|---|---|
| **One Cloud Run service, four routes** | Multiple services per concern | Free-tier ceilings are per-service; one service maximizes free headroom and simplifies deploys |
| **FastAPI + ADK in Python** | Node/Hono (per design doc) | ADK is Python-native; tracing is built in; agent abstractions are cleaner |
| **Firestore (Native) for everything** | Cloud SQL / Spanner | Always-free tier; serverless; trivial Python client |
| **One agent class (`LevelDesignerAgent`)** | Multi-agent / tool-using setups | v1 has one job — extract layout JSON. Don't over-architect. |
| **Pre-baked tilesets** | Imagen at request time | 10× cost saving; visual consistency; <1s render |
| **lz-string + inline-in-QR fallback to short URL** | URL-only | QRs work fully offline (in-app share without a network round-trip) |
| **Workload identity, no keys** | API keys in env | Eliminates an entire class of leak |
| **No queues / Pub/Sub** | Pub/Sub between API and agent | Synchronous is fine at scale ≤5 concurrent users |

When in doubt, the simplest GCP-native option wins. We add complexity only when a success criterion in [`00-overview.md`](./00-overview.md#success-criteria) demands it.

---

_End of 01 — Architecture._
