# 00 — Project Overview

> **Status**: normative · **Owner**: project lead · **Last revised**: 2026-05-20

This is the entry doc. It answers: _what is Mirror Realm, who is it for, what's the success criteria, and what's out of scope._

For the narrative/inspirational pitch, see [`MirrorRealm-Design-Doc.md`](../MirrorRealm-Design-Doc.md). This doc is the formal specification's preamble.

---

## Table of Contents

1. [Elevator description](#elevator)
2. [Personas](#personas)
3. [Success criteria (v1)](#success-criteria)
4. [Non-goals](#non-goals)
5. [Glossary](#glossary)
6. [Top-level capabilities](#capabilities)
7. [Reading order for new contributors](#reading-order)

---

<a id="elevator"></a>

## 1. Elevator description

Mirror Realm is a Progressive Web App (PWA). The user opens it on their iPhone, points the camera at any real-world scene, taps the shutter, and within ~15 seconds the photo is transformed into a playable side-scrolling pixel-art platformer level. They play it, optionally share it as a QR code or short URL, optionally submit it to a globally rotating "Daily World" pool.

The transformation pipeline is:

```
photo (JPEG, ~200KB)
  → Cloud Run API (FastAPI)
    → Google ADK agent
      → gemini-3.1-flash-lite (Vertex AI, vision + JSON mode)
    ← Level JSON (validated against packages/shared/level.schema.json)
  ← Level JSON
PWA renders Level JSON with pre-baked Phaser tilesets
```

Nothing about the visual style is generated at runtime — the AI only decides _where_ platforms go and _which_ pre-shipped tileset to use. This is the central engineering bet: ship 12 hand-curated tilesets, let the model handle layout, get consistent results.

<a id="personas"></a>

## 2. Personas

| Persona | Goal | What we owe them |
|---|---|---|
| **Solo player** (you) | 1-5 minute fidget moments — turn any scene into a tiny game | Camera→playable in under 30 seconds; no friction |
| **Friend recipient** | Play a level you sent them via QR/URL | Open URL → playable in under 5 seconds; no install required |
| **Daily World player** | One shared level per day to play and react to | Open app → daily level fetched and playable |
| **Operator** (you again, in maintenance hat) | Keep costs bounded, kill runaway loops | Hard budget caps, kill-switch, observable agent traces |

There are no end-user accounts. Persona separation is by context, not by identity.

<a id="success-criteria"></a>

## 3. Success criteria (v1)

v1 is "done" when **all** of these are true:

- [ ] **Round-trip ≤ 20 seconds.** From shutter tap to playable level, p95 on a mid-2023 iPhone over LTE.
- [ ] **Cost ceiling holds.** Monthly spend at hobby scale (≤ 150 levels/day) stays under $5; hard budget cap at $15 with kill-switch wired.
- [ ] **No API keys in the browser bundle.** Audited via build-time grep; failing the check fails the build.
- [ ] **All 12 vibes produce visually consistent levels.** Manual review: each vibe should look "deliberately made", not "AI slop".
- [ ] **QR-shareable.** Median level JSON ≤ 600 bytes after lz-string compression, fits in a QR with error-correction level M.
- [ ] **Reachable goal.** Every Gemini-produced level passes a server-side A* check from spawn to goal before being returned to the client.
- [ ] **PWA installable on iOS 14.5+.** Standalone mode works, camera permission persists across launches.
- [ ] **Spec-code parity.** Every public API path, env var, IAM role, and schema field in `docs/` is grep-able in the corresponding source file.

<a id="non-goals"></a>

## 4. Non-goals (v1)

What we are **not** building:

| Non-goal | Why |
|---|---|
| User accounts, auth, profiles | Adds friction; not needed for the core loop |
| Live image generation (Imagen at request time) | Cost + latency + visual inconsistency |
| Multi-screen scrolling levels (panoramas) | Doubles physics complexity; stretch idea |
| Multiplayer | Stretch idea — see [`16-roadmap.md`](./16-roadmap.md) |
| Custom tileset upload by users | Asset moderation problem we don't want |
| Leaderboards / scoring | Stretch idea |
| Native iOS app (App Store) | PWA covers iPhone with zero distribution cost |
| Self-hosted models / non-Vertex inference | We chose GCP; that's the bet |
| GKE, Cloud SQL, Pub/Sub, Cloud Tasks | Over-engineering for v1 scale |

If a future request touches a non-goal, it goes through the [roadmap](./16-roadmap.md), not the v1 plan.

<a id="glossary"></a>

## 5. Glossary

| Term | Meaning |
|---|---|
| **Level** | A playable JSON document conforming to `packages/shared/level.schema.json`. Contains platforms, hazards, decorations, spawn, goal, and a `vibe` tag. |
| **Vibe** | One of 12 pre-defined art styles (e.g. `cozy`, `neon`, `forest`). Determines which tileset Phaser loads. Enum is locked in [`04-domain-model.md`](./04-domain-model.md#vibes). |
| **Tileset** | A static pixel-art PNG bundled with the PWA. One per vibe. Sourced from Kenney / OpenGameArt / generated once with Imagen. |
| **Daily World** | A single Level rotated globally every 00:00 UTC by Cloud Scheduler. Read-mostly; one Firestore doc. |
| **Submission** | A user-created Level queued for possible promotion to Daily World. Stored in Firestore with a 30-day TTL. |
| **Agent** | A Google ADK `Agent` instance. Mirror Realm v1 has exactly one: `LevelDesignerAgent`, which converts photos to Level JSON. |
| **ADK** | [Google Agent Development Kit](https://adk.dev/get-started/) — the Python framework wrapping Vertex AI agent calls with tracing, sessions, and tools. |
| **ADC** | Application Default Credentials. `gcloud auth application-default login` provides local Vertex AI auth without service-account keys. |
| **Vibe-locked** | A Level whose vibe matches the photo's dominant aesthetic per Gemini's judgment. Constrained by the `responseSchema` enum. |
| **Reachability check** | Server-side A* simulation from `spawn` to `goal` over the platform graph, with the player's jump/move physics. Levels failing this trigger a single retry to the agent. |
| **Kill-switch** | A Cloud Function subscribed to billing Pub/Sub that disables billing on the GCP project when the budget threshold trips. See [`15-cost-and-limits.md`](./15-cost-and-limits.md). |
| **Trace** | An OpenTelemetry span tree captured by ADK + Cloud Trace covering one request lifecycle. See [`12-observability.md`](./12-observability.md). |

<a id="capabilities"></a>

## 6. Top-level capabilities

The boundary of v1 — what the system can do. Each capability has a dedicated feature spec in [`09-features.md`](./09-features.md).

| ID | Capability | Spec ref |
|---|---|---|
| **C1** | Capture a photo and receive a playable Level | [`09-features.md#f1-capture-to-play`](./09-features.md#f1-capture-to-play) |
| **C2** | Play a Level (jump, die, respawn, win) | [`09-features.md#f2-play-runtime`](./09-features.md#f2-play-runtime) |
| **C3** | Encode a Level into a QR / short URL and share | [`09-features.md#f3-share`](./09-features.md#f3-share) |
| **C4** | Open a Level from a QR scan or URL | [`09-features.md#f4-open-shared`](./09-features.md#f4-open-shared) |
| **C5** | Fetch and play today's Daily World | [`09-features.md#f5-daily-world`](./09-features.md#f5-daily-world) |
| **C6** | Submit a beaten Level to the Daily World pool | [`09-features.md#f6-submit`](./09-features.md#f6-submit) |
| **C7** | Rotate the Daily World on a cron schedule | [`09-features.md#f7-daily-rotate`](./09-features.md#f7-daily-rotate) |
| **C8** | Track and enforce per-project monthly spend | [`09-features.md#f8-cost-guard`](./09-features.md#f8-cost-guard) |

Everything else (replay screen polish, badges, SFX) is leaf-level and lives inside the parent capability's spec.

<a id="reading-order"></a>

## 7. Reading order for new contributors

If you're new to this repo (human or AI), read in this order:

1. [`CLAUDE.md`](../CLAUDE.md) — the contract
2. [`MirrorRealm-Design-Doc.md`](../MirrorRealm-Design-Doc.md) — the vision (input doc)
3. This file (`00-overview.md`)
4. [`01-architecture.md`](./01-architecture.md) — how the pieces talk
5. [`02-repository-structure.md`](./02-repository-structure.md) — where things live
6. [`04-domain-model.md`](./04-domain-model.md) — what a Level _is_
7. [`06-ai-agent-layer.md`](./06-ai-agent-layer.md) — the ADK heart
8. The rest, in numeric order

Don't skip to feature work without reading 1-4. The contract in `CLAUDE.md` and the architecture in `01-` are how we avoid spec drift.

---

_End of 00 — Project Overview._
