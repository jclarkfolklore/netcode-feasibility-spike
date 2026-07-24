# Netcode Feasibility Spike — Rock 'Em Sock 'Em

A self-contained, deployable **measurement instrument** that answers one question for the
[rock-em-sock-em](https://github.com/Folklore-Digital/rock-em-sock-em) browser fighting game with
**real data instead of guesswork**:

> Is **host-authoritative** online multiplayer feasible for this game — and if so, how should it be built?

This repo is a purpose-made, standalone slice of the parent project. It is **auto-generated** from
the spike inside the monorepo (`conductor/spikes/netcode-feasibility/`) — do not hand-edit here;
edit in the monorepo and run `npm run deploy` to re-sync + push (Render then auto-builds).

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

## Current status & findings

**Host-authoritative is confirmed as the right architecture** (rollback's determinism retrofit is
genuinely expensive; nothing reopens it). Snapshots are tiny and cheap. The **decisive felt-lag
number needs a real two-machine reading** — the measurement instrument has been hardened for exactly
that (peer-presence handshake, cross-machine clock offset, sample-count floor, visibility guard,
and a real ~80-sample distribution). The dashboard's "Not feasible" headline was a config artifact
(a default RTT 2× the project's 20–60 ms target); at the real target the simulated felt lag is
~2–3.5 frames.

Full multi-pass review (relevance, findings, path-to-production, an independent audit, and the
consolidated synthesis) lives in
[`conductor/spikes/netcode-feasibility/reviews/`](conductor/spikes/netcode-feasibility/reviews/) —
start with `00-SYNTHESIS.md`.

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

Once deployed, on each machine open the same URL with a shared room:

- **Host:** `https://<your-url>/?room=test&role=host#/e2e-remote-input`
- **Guest:** `https://<your-url>/?room=test&role=guest#/e2e-remote-input`

Run the measurement — the **guest** produces the trustworthy felt-lag distribution. Same-region
(same wifi / nearby) matches the project's target; that reading is what the whole spike exists to
produce.
