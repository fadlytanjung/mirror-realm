# 16 — Roadmap

> **Status**: normative · **Owner**: project lead · **Last revised**: 2026-05-20

The build sequence to reach v1 and the stretch ideas beyond it. Items here are not committed scope — they're a backlog. Promoting a stretch idea to v1+ requires a spec doc change first.

---

## Table of Contents

1. [v1 build plan](#v1)
2. [Definition of "v1 shipped"](#shipped)
3. [v1.x small follow-ups](#v1x)
4. [Stretch ideas (ordered by lift)](#stretch)
5. [Speculative / probably-never](#speculative)

---

<a id="v1"></a>

## 1. v1 build plan

Two focused weekends with Claude as pair-programmer. Each block ends with a runnable demo.

### Weekend 1 — "The Magic Moment"

| Block | Goal | Definition of done |
|---|---|---|
| **Sat AM** — Scaffold | GCP project bootstrap; PWA boilerplate; backend boilerplate; camera capture working | Local PWA shows live camera; `pnpm test` green; `gcloud config get-value project` correct |
| **Sat PM** — Rectangle platformer | Hard-coded Level JSON renders as Phaser scene; player jumps; reaches a goal flag | Tap goal → "win" event |
| **Sun AM** — Real Gemini | Cloud Run service up; calls `gemini-3.5-flash` via ADK; returns schema-valid Level | `/api/analyze` with a real photo returns a real Level on the device |
| **Sun PM** — Tilesets + polish | Replace rectangles with Kenney tilesets per vibe; scan animation; first end-to-end magic loop | Photograph anything → playable level in the wild |

### Weekend 2 — "Make It Shareable"

| Block | Goal | Definition of done |
|---|---|---|
| **Sat AM** — Share | Compression service; QR generator; share sheet UI; `/api/level/save` + `/p/<lz>` & `/l/<hash>` routes | Send yourself a level via QR; play it from cold |
| **Sat PM** — Scan | QR scan flow; level history in IndexedDB; replay played levels offline | Scan friend's QR; played levels list works after airplane mode |
| **Sun AM** — Daily World | Firestore-backed daily; Cloud Scheduler cron; `GET /api/daily`; submission flow | Submit a level; trigger rotate; tomorrow's daily is your level |
| **Sun PM** — Production | Cost guard; kill switch wiring; observability dashboard; PWA install polish | Shippable. Iconography + screenshot. Friends test from real iPhones. |

If something slips, the cut order is: PWA install polish → submission flow → daily world → share. Capture-to-play is the magic; everything else is multipliers.

<a id="shipped"></a>

## 2. Definition of "v1 shipped"

Every success-criteria checkbox in [`00-overview.md#success-criteria`](./00-overview.md#success-criteria) ticked. Every feature in [`09-features.md#status`](./09-features.md#status) at `released`. Traceability matrix at 100% (no orphaned files, no missing implementations).

After v1 ships, this doc becomes the source of truth for what's next.

<a id="v1x"></a>

## 3. v1.x small follow-ups

Things we know we'll want, in priority order. None require spec changes — they're operational improvements.

1. **App Check enrollment.** Close the "is this really our PWA?" gap. Requires Recaptcha v3 setup + frontend integration.
2. **Manual approval for daily promotion.** Today rotation is fully automatic. Add an admin route (single-user, gcloud-IAM-gated) that lists pending submissions and lets the operator promote/reject.
3. **Custom domain.** A real domain (e.g. `your-custom-domain.com`) instead of the `.web.app` subdomain.
4. **Web vitals.** Server-side `/api/analyze` p95 is already monitored; add a tiny client-side timing payload (`time_to_playable`) for end-to-end correlation.
5. **Replay tile.** "Yesterday's Daily" tile on Home for the case where the user missed it.
6. **Better camera UX.** A "review photo" frame before submitting — a half-second double-take to give the user agency.

<a id="stretch"></a>

## 4. Stretch ideas (ordered by lift)

Each is a candidate for a v2 spec; **do not implement** without first writing a doc.

| ID | Idea | Approx. lift | Notes |
|---|---|---|---|
| **S1** | Time-attack leaderboard per level | S | One new collection `times/{levelHash}`; needs anti-cheat thinking |
| **S2** | Co-op QR (two players, one phone, split touch) | M | Phaser supports multi-touch; physics needs a second body |
| **S3** | Custom player sprite from selfie | M | Tiny image model to pixelate face; one extra Vertex call per user |
| **S4** | Boss levels — panorama photo → multi-screen level | L | Level schema must grow `screens[]`; physics already supports |
| **S5** | Ambient AR — beat a level, see it overlaid on the real photo | XL | WebXR + iOS support is unreliable; deferred until iOS Safari catches up |
| **S6** | Soundscape from photo | S | Pass image+prompt to Gemini → SFX selection rules; trivially cheap |
| **S7** | Storyboard mode — chain 5 photos = 5 levels = mini-game | M | Sequence + transition logic; storage doubles |
| **S8** | Level remix — combine two photos | S | New `/api/remix` endpoint; merges two Level JSONs |
| **S9** | Custom tileset upload | L | Asset moderation problem; not aligned with v1 ethos |
| **S10** | Native iOS app (App Store) | XL | PWA is doing fine; only worth it if distribution becomes the bottleneck |
| **S11** | Multiplayer racing (real-time WebSocket) | XL | Out of scope for Cloud Run's 60-min request cap; would need GKE |

<a id="multi-experience"></a>

## 5. Direction: from one game to many experiences

> _Added: 2026-05-23 — owner feedback: a photo should produce **varied experiences**, not
> just one Mario-like platformer with more features. Candidates: photo effects, short
> animations, even short video — chosen/generated per photo._

Today the pipeline is a single "experience generator": photo → Level JSON → Phaser
platformer (the vibe only recolors tiles, so every result feels the same). The north star
is **multiple experience types**, with the photo (and/or the user) selecting which.

| ID | Experience | Lift | Status / notes |
|---|---|---|---|
| **E2** | **Photo effect** — `PixelScene`: captured photo pixelated (Phaser postFX) | S–M | **Shipped v1 (2026-05-23).** AI picks via `experience="pixel"`. On-device; level still generated for sharing. |
| **E3** | **Short animation** — `AnimationScene`: Ken-Burns drift + scan-line | M | **Shipped v1 (2026-05-23).** AI picks via `experience="animation"`. Future: record to WebM via `MediaRecorder`. |
| **E1** | **Scoring + achievements** on the platformer | S | Coins, star rating (time/deaths), best-time. Pure client + small schema add. Next candidate. |
| **E4** | **More game modes** — Climb / Run / Collect as distinct `experience`s | L | The `experience` routing now exists; add new scenes + a `mode` per type. |
| **E5** | **AI short video** from the photo | XL | Veo-class model: expensive + slow, async job + polling. Defer until cost/latency justify. |

The **`experience` routing architecture** (analyze returns `experience`; `CaptureScene`
routes to the matching scene; `RevealScene` base for non-game variants) shipped 2026-05-23
with E2 + E3. Adding a variant is now: pick an `experience` value, add a scene.

Architecture implication: introduce an **experience type** the analyze step returns
(`{ "experience": "platformer" | "effect" | "animation" | ..., ... }`), and a frontend
registry that routes each type to its renderer. Build E1/E2/E3 first (cheap, client-side,
no new model cost); gate E4/E5 behind their own spec docs before implementation.

If you're tempted to do S5, S9, S10, or S11, write a clean v2 architecture doc first — they each break a current invariant in [`02-repository-structure.md`](./02-repository-structure.md) or [`03-tech-stack.md`](./03-tech-stack.md).

<a id="speculative"></a>

## 5. Speculative / probably-never

- Multiple language support — fun but high cost, no demand
- "Pro" mode with manual platform editing — kills the magic
- NFTs of beaten levels — no
- Generative tileset per photo — explicitly rejected in [`00-overview.md#non-goals`](./00-overview.md#non-goals); cost + visual consistency lose vs. pre-baked

Items here are kept as a parking lot to prevent re-debating.

---

_End of 16 — Roadmap. End of `docs/` spec tree._
