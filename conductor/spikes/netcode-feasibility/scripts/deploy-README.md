# Netcode Feasibility Spike — Rock 'Em Sock 'Em

**▶ Live:** https://netcode-feasibility-spike.onrender.com/
&nbsp;(Render free tier — the first load after ~15 min idle takes ~30–60 s to wake; a "waking server" banner shows meanwhile.)

A self-contained, deployable **measurement instrument** that answers one question for the
[rock-em-sock-em](https://github.com/Folklore-Digital/rock-em-sock-em) browser fighting game with
**real data instead of guesswork**:

> Is **host-authoritative** online multiplayer feasible for this game — and if so, how should it be built?

This repo is a purpose-made, standalone slice of the parent project. It is **auto-generated** from
the spike inside the monorepo (`conductor/spikes/netcode-feasibility/`) — do not hand-edit here;
edit in the monorepo and run `npm run deploy` to re-sync, push, and trigger a build.
**Auto-deploy on push is off** — deploys are explicit, so a push alone never rebuilds.

---

## Why this exists

Rock 'Em Sock 'Em is a Phaser browser fighting game. Adding online multiplayer has a pivotal
unknown: how much **input lag** does a guest feel, and is the wire fast/cheap enough? A prior
decision (**Decision 1**) tentatively chose a **host-authoritative / state-relay** model — the host
runs the real simulation and streams state snapshots; the guest renders them with no local sim and
sends its input back — because a fully deterministic rewrite (needed for rollback netcode) is
expensive. This spike replaces argument with measurement before the multiplayer track commits.

It boots the **real** `FightScene` (imported read-only from the game, subclassed harness-side with
zero edits) so every number comes from the actual game code, not a stand-in.

## What it measures (four experiments)

| Experiment | Question |
|---|---|
| **Transport** | WebSocket (TCP) vs WebRTC DataChannel (UDP-like) — RTT / jitter / loss under injected loss. Does TCP head-of-line blocking bite in the tail? |
| **Sim-snapshot** | Capture the real fight state each tick, serialize (JSON / binary / delta), render on a sim-free guest. Is a snapshot cheap, and does it look right? |
| **Remote-input (E2E)** | The full loop — a guest button-press → host sim → snapshot back → guest render. Measures the guest's **felt input lag**, the decisive number. |
| **Determinism-cost** | Enumerate the sim's non-determinism (verified `file:line`) + estimate the rollback retrofit cost. Should rollback be reopened? |

Results roll up into a Summary with a traffic-light composite score (feasibility) and a separate
rollback-readiness axis.

## Current status & findings — CLOSED

**Host-authoritative state-relay is confirmed feasible.** The decisive **two-machine felt-lag
reading was taken** (deployed, over the Oregon relay, three consistent times): **p50 ~292 ms ≈
17.5 frames at ~204 ms RTT** — and it is **relay-bound, not netcode-bound** (felt lag = RTT +
50 ms interp + ~15–38 ms app). Isolating the relay collapsed felt lag to **4.0 frames (≈67 ms)** at a
LAN-class relay (1.1 ms RTT); a real same-region WAN relay (20–60 ms RTT) projects to **~5–7.5
frames**. **Client-side prediction** targets ~sub-frame own-input independent of relay (a projected
ceiling — not yet built). Snapshots are tiny/cheap; the determinism retrofit is genuinely expensive
(so rollback stays closed).

**Path to smooth gameplay:** (1) put the relay near the players (or P2P) — the dominant lever;
(2) add client-side prediction for the local character (no determinism tax); (3) design gameplay
around the irreducible opponent latency (≥~4–5 frames) — no frame-1 punishes, telegraphed moves,
generous hit/block windows.

> Do **not** read the summary's single composite number as a verdict — it can't express a
> topology-conditional finding. Use the per-metric bands + distributions.

Full record: the track's `008.8-measurement-results-and-optimization.md`. Earlier multi-pass review
lives in [`conductor/spikes/netcode-feasibility/reviews/`](conductor/spikes/netcode-feasibility/reviews/).

## Repo layout (why it looks like a mini-monorepo)

```
render.yaml                                  # Render Blueprint (rootDir → the spike)
conductor/spikes/netcode-feasibility/        # the spike app + Node server (client + WS relay + signaling)
src/game/                                    # the real game code the spike exercises, read-only
```

The nested path is required: the spike imports `../../../src/game`, so the game code sits three
levels up exactly as in the parent monorepo.

## Run it

```bash
cd conductor/spikes/netcode-feasibility
npm install
npm run dev        # client on :5173, server (WS relay + signaling) on :8080
# or, production:
npm run build && npm start   # serves the whole app on $PORT (default 8080)
```

## Deploy (Render)

`render.yaml` is a Render Blueprint. In the Render dashboard: **New → Blueprint → this repo →
Apply**. It builds `conductor/spikes/netcode-feasibility` (`npm install && npm run build`), runs
`npm run start`, and health-checks `/api/health`. Free tier spins down after ~15 min idle (a
"waking server" banner covers the ~30–60 s cold start).

## The two-machine felt-lag test (the point)

On each machine open the live URL with a shared room:

- **Host:** https://netcode-feasibility-spike.onrender.com/?room=test&role=host#/e2e-remote-input
- **Guest:** https://netcode-feasibility-spike.onrender.com/?room=test&role=guest#/e2e-remote-input

Run the measurement — the **guest** produces the trustworthy felt-lag distribution. Same-region
(same wifi / nearby) matches the project's target; that reading is what the whole spike exists to
produce.
