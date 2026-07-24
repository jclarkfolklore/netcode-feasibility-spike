# Netcode Spike — Consolidated Synthesis & Next Steps

**Status:** the spike is **infrastructure-complete, evidence-incomplete.** The architecture question
is effectively settled; the flagship *measurement* is not yet trustworthy, and the dashboard is
currently misleading. Do **not** commit the multiplayer track on the current numbers.

This document consolidates **four independent passes**:
- Three strategic reviews — [`01-relevance-and-coverage.md`](./01-relevance-and-coverage.md),
  [`02-findings-and-decision.md`](./02-findings-and-decision.md),
  [`03-path-to-production.md`](./03-path-to-production.md) (Sonnet, high-effort).
- A failure diagnosis + deployment report — [`04-diagnosis-and-deployment.md`](./04-diagnosis-and-deployment.md) (Fable).
- An independent run-the-app review + reconciliation memo — [`05-independent-review-and-reconciliation.md`](./05-independent-review-and-reconciliation.md) (Opus, unbiased first pass).

All four converge far more than they conflict. Where they differed, the Opus reconciliation is the
tie-breaker and is reflected below.

---

## 1. The consolidated verdict

| Question | Verdict | Confidence |
|---|---|---|
| Keep host-authoritative (state-relay)? | **Yes — confirmed, not just inherited.** Rollback *and* delay-based/lockstep both require a bitwise-deterministic sim across machines; only state-relay avoids it. Nothing reopens rollback. | High |
| Commit the multiplayer track now? | **No.** The decisive number (real-hardware guest felt lag) doesn't trustworthily exist yet. | High |
| Is the scary `Not feasible / 49.1` a real verdict? | **No — it's a config artifact.** The default injects 80 ms RTT (2× the project's own 20–60 ms target) + a *tunable* 50 ms interp buffer; the composite is min-gated by that one `bad` sub-score. | High |
| Likely real-world outcome once measured properly? | **Probably acceptable.** Felt lag decomposes as `≈ RTT + interp + ~10 ms app`; at the project's target with a tuned buffer the (simulated) number is **2–3.5 frames**, not 6.4. Leans feasible, especially for a casual game — but this is still a *simulated* number and must be confirmed on real hardware. | Medium |

**Honest framing:** the instrument is well-built and unusually faithful (it drives the *real*
`FightScene`/`Fighter`/`CombatSystem` with zero `src/` edits). Its *robust* findings are
trustworthy; its *flagship* number is its weakest and its dashboard headline actively misleads.

---

## 2. What's solid (do not relitigate)

- **Snapshot is cheap:** 63 B fixed binary / ~26 B avg delta / **~0.01 ms/frame** encode vs a
  16.67 ms budget, measured off the live sim. High confidence; encode cost is a CPU question, won't
  move on a real network.
- **Input seam is clean** — harness-side subclass swap, zero `src/` edits, verified.
- **Rollback/lockstep are structurally expensive here** — real `file:line` enumeration: variable-
  `delta` timers (no fixed tick), Arcade float physics, un-snapshottable fire-and-forget tweens.
- **Scoring model is sound** — geometric-mean + min-gate, feasibility/determinism axis split,
  peer-echo single-clock RTT.
- **A real pre-existing gameplay bug** surfaced: `Fighter.chargeMs` (`Fighter.ts:45`) is never
  written, so `scope_creep`'s `growing_power` charge-reach bonus (`Fighter.ts:171`) is **dead code
  today**, independent of multiplayer. Worth flagging to the game team.

---

## 3. What's broken — the flagship felt-lag is corrupt in FOUR independent ways

Fixing clock sync alone (which the strategic reviews emphasized) is **necessary but not
sufficient.** The paired felt-lag path lacks all four of: presence barrier, clock sync, visibility
guard, sample-count floor. Fix all four or trust none.

| # | Corruptor | Symptom | Direction |
|---|---|---|---|
| A | **No peer-presence barrier** — `waitForOpen` resolves on relay-socket "open", not peer presence (`ws.ts:68`); stop condition gates on `sample.tick >= driveTicks` which never fires if snapshots never arrive | whoever runs first, the other **silently hangs** (Opus hung it unbounded bypassing the outer wrapper; Fable's "aborted mid-pass" is the 180 s `runExperience` wrapper rescuing the same defect — the experience has **no internal liveness guard**) | no number |
| B | **Cross-tab clock skew** starves the interp sampler — `interpBuffer.sampleAt` compares guest `now` vs host `hostTime` (different tab time-origins). *Correction from Opus:* the felt-lag subtraction itself is epoch-safe (both `tSent` and `now` are guest-clock); the skew poisons the **sampler gating**, not the math | **"0.0 ms / band good"** — silent false **positive** (most dangerous) | false positive |
| C | **rAF throttling** on a backgrounded tab — the whole measurement loop (sample+attribute+send) is rAF-driven, no `visibilitychange` guard | 466 ms from 1 sample vs a 1 ms RTT | false negative |
| D | **~4–5 attributed samples/run** | p95 = p99 = the single worst sample | hollow either way |

### Plus two measurement-validity bugs the strategic reviews missed
- **The automated E2E measures button-*ack*, not the input model.** The scripted press is a bare
  `light:true` edge (`e2eExperience.ts:200,559`) with no movement/block/charge/special/directional,
  and fighters spawn ~320 px apart vs a 70 px reach (`FightScene.ts:79-80`, `CombatSystem.ts:71`) —
  so attacks almost never connect. It measures acknowledgment latency of one out-of-range button.
- **The transport HOL verdict is structurally unfair.** `link-loss` is only toggled for WS cells
  and the loss proxy only fronts the `:8080` port — it **physically cannot reach the P2P WebRTC
  channel** (`transportExperience.ts:397`; `lossProxy.ts`). So the headline compares
  **WS-with-loss vs WebRTC-with-*no*-loss** (`buildVerdict`, `transportExperience.ts:232-248`). Only
  the loss-resilience sub-score (WS-loss vs WS-baseline) is fair. A real WS-vs-WebRTC HOL comparison
  needs an **OS conditioner (tc/Network Link Conditioner) on both legs' packets**, not the in-app proxy.

### Other confirmed issues
- **Banding text contradicts code:** copy says "bad ≥6 frames (100 ms)"; code bands anything
  **>3 frames** as bad (`frameBand`/`bandFor(goodMax:1, acceptableMax:3)`).
- **Transport samples are thin:** default 10 pings/cell → p99 = "the max of 10".
- **WebRTC is STUN-only (no TURN)** → ~15–30 % of real pairs won't connect on WANs.
- **WebGL context churn** — ~4 throwaway Phaser games per E2E run; "too many active WebGL contexts".

---

## 4. Netcode model — the options (for the record)

The one axis that decides cost: **who simulates?** — because that dictates whether you need bitwise
determinism (the expensive rewrite this game lacks).

| Model | Who simulates | Needs determinism? | Feel | Cost here |
|---|---|---|---|---|
| **Host-authoritative state-relay** (Decision 1) | one player | No | guest eats RTT+interp; host 0 lag (**asymmetric**) | cheapest |
| **Server-authoritative** (dedicated headless sim) | a server | No | both eat RTT (**fair**); no host cheating | moderate (server compute) |
| **Delay-based lockstep** | both peers | **Yes** | fixed delay + hitches on loss | expensive *and* worse — dominated |
| **Rollback (GGPO)** | both peers | **Yes** | **best** (local input instant) | expensive: determinism rewrite |
| **State-relay + guest client-side prediction** | host + guest predicts *own* fighter | No | own movement instant; opponent ~RTT behind | moderate — **the sweet spot** |

**Recommendation:** keep host-authoritative as the base. The one meaningful upgrade that does **not**
require the determinism tax is **client-side prediction of the guest's own fighter** — the highest-
leverage improvement over pure state-relay. Consider **server-authoritative** only if fairness/anti-
cheat/ranked matters. **Rollback** only if the game goes competitive-FGC and you fund the rewrite
(the casual roster argues against it).

---

## 5. Gaps outside the spike's scope (the "feasible ≠ shippable" caveat)

The composite score answers "is the *data plane* cheap and honest," **not** "is multiplayer ready."
Five operational gaps sit entirely outside what any experiment measures:
1. **Reconnection** — none; a peer drop closes the other with code 4000, no resume (comparatively
   cheap to add *because* state-relay makes the guest stateless).
2. **Authority / anti-cheat** — the host is unverified by design (fine for friends, not for ranked).
3. **Matchmaking / lobby** — greenfield; `MatchConfig.mode:"online"` is a read-nowhere stub.
4. **Mobile** — no touch `InputProvider` exists; plus TURN needed for cellular NAT.
5. **Clock sync** — faked (shared process clock in loopback).

`2v2`/spectators are **not** a near-term question — combat is hard-wired to two fighters
(`FightScene` `p1`/`p2`, `CombatSystem.resolveAttack(attacker, defender)`).

---

## 6. Action plan (prioritized) — the "next steps"

### P1 — Make the felt-lag measurement decision-grade *(pivotal, cheap, do first)*
Union fix-list across all four passes, in `src/experiences/e2e/*` (+ `interpBuffer.ts`, `ws.ts`):
- **Peer-presence barrier** — surface the server's already-tracked `bothPresent` (`rooms.ts:44`) to
  the client; don't start the pass until the peer is seated.
- **Internal stall timeout** — the paired guest pass must fail loudly if no snapshots advance, not
  rely on the outer 180 s wrapper.
- **Cross-machine clock offset** — derive from the ping/pong RTT already in place; convert guest
  `now` → host-clock estimate for `interp.sampleAt`/`staleness`.
- **`visibilitychange` guard** — pause/annotate the measurement when the tab is backgrounded.
- **Sample-count floor** — fail (status `failed`, explicit verdict) when `sampleCount === 0` or
  below a minimum; never render `count:0` as "0.0 ms / good".
- **Raise sample volume** — drive enough in-fight ticks for *hundreds* of presses; transport
  `samplesPerCell` ≫ 10.
- **Widen the scripted input** — beyond one out-of-range `light` edge (movement into range, blocks,
  varied attacks) so the loop exercises the real input model and attacks actually connect.

**Acceptance:** a paired run either produces a p50/p95/p99 over ≥100+ real samples, or fails loudly
with a clear reason — never a silent "0.0 ms good" and never an unbounded hang.

### P2 — Stop the dashboard from lying *(cheap, do alongside P1)*
- Default the E2E config to the project's own target RTT (20–60 ms), or clearly separate "config
  artifact" from verdict on the page, so `Not feasible / 49` stops misleading teammates.
- Fix the banding **text** (`≥6 frames`) to match the **code** (`>3 frames`) — or introduce a real
  middle band.

### P3 — Deploy to Render + take one real two-machine reading
Deploy blockers to clear first: copy `render.yaml` to repo root; build a cold-start "waking
server…" UI (required by `DEPLOY.md`, not built); make `tsx` a prod dependency; resolve the
prod build's root-`node_modules/phaser` alias; note the in-memory single-instance room registry.
Then run the (fixed) E2E on two real machines on different networks at the project's target, sweep
the interp buffer (16/33/50 ms), and re-read the verdict. For a fair WS-vs-WebRTC HOL number, use an
OS conditioner on both legs.

### P4 — Prototype guest-side input prediction, re-measure
Predict the guest's own fighter optimistically, snap-correct against the host snapshot; re-measure
felt lag. Tells us whether plain state-relay is enough or prediction is MVP-critical **before**
committing the `src/game` production work.

### Later — production `src/game` changes (only after P1–P3 confirm the number)
Injectable `InputProvider` seam; real tick counter; an `attack-resolved` event carrying
`moveId`/`attackKind`/`crit`/`damage` (fixes the pose/animation gap); promote `chargeMs` onto
`Fighter` (also fixes the gameplay bug); public accessors; first-class guest scene; wire
`MatchConfig.mode`. **None require determinism work.** Transport: WS-only v1 + automatic WebRTC
fallback; TURN only if the fair comparison later justifies it.

---

## 7. My recommendation

Do **P1 + P2 now** — they make the spike both *trustworthy* and *honest*, and are prerequisites for
a meaningful Render test. Then P3 (real two-machine number), then P4 (prediction prototype). The
architecture is settled; the work now is turning a misleading instrument into a decision-grade one
and getting the one number the whole exercise exists to produce.
