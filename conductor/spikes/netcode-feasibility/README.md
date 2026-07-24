# Spike: netcode feasibility

**Status:** open
**Opened:** 2026-07-23
**Concluded:** —

## Question

Is the host-authoritative multiplayer model **feasible and performant enough**, measured end-to-end in the real problem space (real fight-state snapshots, real input seam, real transports) rather than in the abstract? Four sub-questions, answered by one deployed app:

1. **Transport** — Does WebSocket-over-TCP deliver acceptable RTT/jitter/loss for 2-player exchanges, or does WebRTC DataChannel (P2P, UDP semantics) measurably beat it — decided from real cross-machine data?
2. **Sim-snapshot** — Can the actual Phaser fight state be captured as a serializable snapshot, relayed, and applied on a second client that renders the same frame with **no local sim**? What is the snapshot's byte size and per-frame production cost?
3. **Remote-input seam** — Can `RemoteInput implements InputProvider` + an input-delay buffer slot into the real input path **without touching `CombatSystem`**, and is host-role free of a hardcoded "P1 is host" assumption?
4. **Determinism cost** — How expensive is it to make the sim deterministic (seed the 3 known `Math.random` sources + fixed timestep)? If it's cheap, rollback/lockstep reopen and beat host-authoritative.

The decision comes from **real measured data on a live deployed page**, not theory.

## Context

**What prompted this.** The multiplayer plan starts on WebSocket (`ws`) behind a swappable `Transport` port (`conductor/planning/multiplayer/clarification.md` → Decision 3) and picks **host-authoritative** netcode (Decision 1). Both rest on code-level assumptions that have never been proven end-to-end. Rather than run four separate spikes, one deployed "netcode feasibility" app exercises the *actual* host-authoritative loop — real sim → snapshot → transport → guest render — and measures the problem-space metrics that matter.

**Verified against the code (2026-07-23):**
- ✅ `InputProvider` seam exists (`src/game/systems/InputManager.ts:5`), `LocalKeyboardInput implements InputProvider`; but `FightScene` (`:169-170`) wires the concrete keyboard input directly, so injection isn't wired yet.
- ✅ Sim is non-deterministic in exactly 3 places — `CombatSystem.ts:52` (crit), `:58` (bug-prone), `Announcer.ts:10` — confirming lockstep/rollback need a rewrite *today*.
- ❌ **No fight-state snapshot / serialize / `getState` exists anywhere in `src/game`.** Host-authoritative's core premise is unproven. This is the single biggest risk in the multiplayer plan.

**What depends on it.** Feeds Decision 1 (netcode model + the snapshot format + the input-delay knob) and Decision 3 (transport library). The measured snapshot size also makes the transport benchmark's payloads *real* instead of guessed. The already-planned `tasks.md` guest-mismatch spike (013.x) depends on sub-question 2 (shared fight state) existing.

**Who builds it.** The deployable app is built under **track 008 — Netcode Feasibility Harness** (`conductor/tracks/008-netcode-feasibility_20260723/`). Per the spike skill, deployable work belongs in a track; this spike holds the *questions and findings*, the track holds the *build*.

**Known / assumed.**
- Target: same-region 2-player, ~20–60ms RTT (Decision 1). Host-authoritative; one *browser* is the host.
- Scope: WebSocket vs P2P WebRTC only (no WebTransport/TURN), so Render free tier suffices.
- The app may import `src/game` **read-only** to drive the real sim; `src/` never imports the harness (spike-workbench boundary — the forbidden direction stays forbidden).

## Design (the workbench)

One self-contained app **outside** `src/`, deployed to Render, running the real host-authoritative loop:

- **Host (browser):** runs the actual Phaser sim, fed input via the real `InputProvider` seam, captures a **serializable fight-state snapshot** each tick.
- **Transport (swappable `Transport` port):** relays snapshots over `WebSocketTransport` (browser→server→browser) or `WebRTCTransport` (P2P), with a **loss-injection knob**.
- **Guest (browser):** applies the snapshot and renders — **no local sim** — and its input is relayed back through `RemoteInput` with a tunable input-delay buffer.
- **Measures the problem-space metrics:** transport RTT p50/p95/p99, jitter, loss, throughput **+** snapshot byte size & per-frame production cost **+** end-to-end *guest input lag* (button → visible response). Sweeps snapshot rate and size; tags every run with transport, topology, loss setting, machine locations.
- **Determinism-cost:** an offline analysis mode — seed the 3 RNG sources + fixed timestep, measure the effort/regression — surfaced in the same report.
- **Dashboard/report on the live URL:** renders the real runs (tables + charts), exports CSV/JSON.
- **Deploy:** Render free tier — Root Directory pinned to this spike folder so only the app builds/runs, never the main game.

## Research

**The harness is built and locally verified (2026-07-23).** All five surfaces work; run-all produces a composite. Built by Opus (orchestrator) + Sonnet workers, one sub-spec per worker, with a checkpoint after each (git history in this repo). Numbers below are **loopback / simulated-network** on one machine — indicative, not the real cross-network measurement (see "Still needed").

**Measured (loopback / simulated):**
- **Transport (008.3):** WebSocket + WebRTC adapters both pass the port conformance suite. During the build the flagship experiment was exercised against the local server: under **15% `link-loss`** (real TCP head-of-line blocking via the toxiproxy-style proxy) the **WS tail blew out to p50 ~800ms / p99 ~1038ms** vs WebRTC-unreliable ~0.56ms clean. The `payload-drop` (app-layer) vs `link-loss` (below-TCP) distinction is enforced — only `link-loss` backs the HOL verdict.
- **Sim-snapshot (008.4):** snapshot is **cheap** — JSON ~427B, hand-packed binary **63B**, delta **~18–25B/tick**, encode cost **~0.008ms/frame** (vs the 16.67ms budget, sub-1192B MTU). **But render fidelity is partial:** HUD-visible fields mirror exactly; **pose/tweens do not reproduce from state alone** (they're side-effects of private mutators). Pose-accurate guest rendering would need a production snapshot/state→render API. (Also found: `Fighter.chargeMs` is a dead field.)
- **Remote-input & e2e (008.5):** input seam done **harness-side** (`NetFightScene` subclass, zero `src/` edits); exactly-once edge delivery proven by test. **Guest felt input lag: p50/p95/p99 ≈ 107/120/120ms = 6.4/7.2/7.2 frames — band BAD**, under only 40±10ms simulated network + 50ms interp buffer. Host-role works in both orientations (role is session config). Stale-opponent ≈ interp delay.
- **Determinism-cost (008.6):** reproducibility proven headlessly (same seed+tape → identical outcome). **determinism-readiness 25/100** — the 3 RNG sites are cheap to seed, but fixed-timestep + deterministic/snapshot-restorable physics are structural (anchored to the ~8-man-year MKX retrofit).
- **Cumulative (008.7):** host-authoritative feasibility composite **49.1/100 "Not feasible as measured"** (geometric-mean + min-gate; gated by input lag), with determinism shown as a **separate** axis (25/100), not blended.

## Finding (preliminary — pending real cross-network runs)

1. **Guest input lag is the key risk — but the magnitude is not yet a real-hardware number.** Host-authoritative state-relay's felt lag is structural: `≈ RTT + interp buffer + app time`. The earlier "~6–8 frames" reading came from a solo-preview default of **80ms RTT (40±10ms one-way) — DOUBLE the project's own 20–60ms target** — plus a *tunable* 50ms interp buffer; that config alone pushed it past the "bad" band and min-gated the composite. At the project's stated target with a tuned buffer the (still simulated) number is ~2–3.5 frames (acceptable/borderline). **The felt-lag number has never been produced on two real machines**, and the paired path had four independent measurement bugs. Treat the dashboard's `Not feasible` headline as a config artifact, not a verdict — see [`reviews/`](./reviews/) for the full multi-pass review and the fix/measure plan.
2. **Snapshotting is bandwidth-cheap but render-lossy.** Tiny snapshots, trivial encode cost; but faithful guest *pose* needs a production state→render API in `src/` (or accept lossy pose — likely fine for a HUD-first game).
3. **The input seam is clean** — swappable entirely harness-side; production only needs `FightScene` to type its input field as `InputProvider` and accept an injected provider.
4. **Rollback does not reopen** — the determinism retrofit (fixed timestep + deterministic physics) is structural and expensive; Decision 1's host-authoritative choice stands on cost grounds.

**Net:** host-authoritative is confirmed as the right architecture (rollback's determinism retrofit is genuinely expensive; nothing reopens it). It is the cheap path to *ship*, and at the project's own same-region latency target the guest's felt lag is plausibly acceptable (~2–3.5 simulated frames) — but that number has **never been measured on real hardware**, so the decision is not yet made. **Next step: fix the measurement instrument (see [`reviews/00-SYNTHESIS.md`](./reviews/00-SYNTHESIS.md) §6), then take one trustworthy two-machine reading before locking Decision 1.** Guest-side input prediction is the one model upgrade worth prototyping if the real number lands marginal.

## Still needed (require the user — cannot be done autonomously)

- **Deploy to Render** (needs the Render account; `render.yaml` + `DEPLOY.md` are ready — note: copy `render.yaml` to the repo root for auto-discovery).
- **Real cross-network runs** between two machines/networks with `?room=<id>` (host + guest) — the loopback numbers above are indicative only; the transport experiment's WS-vs-WebRTC verdict specifically needs a real link.
- Then append the real numbers here and run `/spike conclude netcode-feasibility`.

## References

- `conductor/planning/multiplayer/clarification.md` — Decision 1 (netcode), Decision 3 (transport port)
- `conductor/tracks/008-netcode-feasibility_20260723/` — the build
