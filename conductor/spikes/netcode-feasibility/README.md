# Spike: netcode feasibility

**▶ Live:** https://netcode-feasibility-spike.onrender.com/ · **Repo:** https://github.com/jclarkfolklore/netcode-feasibility-spike

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
- **Cumulative (008.7):** determinism is shown as a **separate** axis (25/100), not blended. ⚠️ **Do not quote the single feasibility composite (~49/100) as a verdict** — it is not a reliable decision artifact (the cross-experiment roll-up is a plain geometric mean with **no** cross-experiment min-gate, sub-scores are band-keyed constants, and it sits on the label boundary; a single number cannot express a *topology-conditional* finding). Read the **bands + raw distributions**, not the number. See 008.8 for the full caveat.

## Finding (FINAL — real two-machine reading captured 2026-07-27)

The decisive cross-machine number was produced (deployed app, two machines over the Render **Oregon** relay), three consistent times, and the optimization levers were quantified. See [`../../tracks/008-netcode-feasibility_20260723/subspecs/008.8-measurement-results-and-optimization.md`](../../tracks/008-netcode-feasibility_20260723/subspecs/008.8-measurement-results-and-optimization.md) for the full record.

**Real two-machine felt lag: p50 ~292 ms ≈ 17.5 frames · RTT p50 ~204 ms** (three readings: 316/300/292 ms felt, 244/223/204 ms RTT). This is **relay-bound, not netcode-bound** — felt lag = RTT + 50 ms interp buffer + ~15–38 ms app.

1. **Guest input lag is the key risk, and it is dominated by relay distance — a topology lever, not a netcode flaw.** Isolating the relay: Oregon → a LAN-class relay collapsed felt lag **17.5 → 4.0 frames** (RTT 204 ms → 1.1 ms); ~13 frames were pure relay round-trip. A genuine **same-region WAN relay (20–60 ms RTT) projects to ~5–7.5 frames** (RTT + interp + app; ~4 fr is the RTT≈0 floor — an *earlier "~2–3.5 frames" estimate was wrong, it counted RTT only*). **Client-side prediction** targets ~sub-frame own-input **independent of relay** (a projected ceiling — no prediction code exists yet), while the opponent still lags by RTT+interp and needs reconciliation.
2. **Snapshotting is bandwidth-cheap but render-lossy.** Tiny snapshots, trivial encode cost; faithful guest *pose* needs a production state→render API in `src/` (or accept lossy pose — likely fine for a HUD-first game).
3. **The input seam is clean** — swappable entirely harness-side; production only needs `FightScene` to type its input field as `InputProvider` and accept an injected provider.
4. **Rollback does not reopen** — the determinism retrofit (fixed timestep + deterministic physics) is structural and expensive; Decision 1's host-authoritative choice stands on cost grounds. (determinism-readiness "bad/25" is the *confirmation* of that cost, not a defect.)

**Net:** **host-authoritative state-relay is confirmed feasible** — the architecture is sound and the felt lag is entirely explained by relay distance + fixed pipeline terms, not the model. The path to smooth gameplay is **(a) put the relay near the players (or go P2P)** — the dominant lever — **then (b) add client-side prediction** for the local character (no determinism tax; predicts only own-character, reconciles on snapshot). Relay placement alone lands at ~5–7.5 frames (still perceptible), so **prediction is a second *required* lever for a twitch feel, not optional**. Where the latency is irreducible (the opponent is always ≥~4–5 frames behind), **gameplay must be designed around it**: no frame-1 punishes / sub-100 ms reaction-dependent windows vs the opponent; favor telegraphed, wind-up moves and generous hit/block windows; the 50 ms interp buffer is a tunable smoothness-vs-lag knob.

## Status: CLOSED

The spike is concluded — deployed, reliable, observable instrument; real two-machine reading; both optimization levers quantified; metrics audited (Opus + Fable) and confirmed trustworthy. Learnings carried into `conductor/planning/multiplayer/`. Full record: **008.8**.

## References

- `conductor/planning/multiplayer/clarification.md` — Decision 1 (netcode), Decision 3 (transport port)
- `conductor/tracks/008-netcode-feasibility_20260723/` — the build
