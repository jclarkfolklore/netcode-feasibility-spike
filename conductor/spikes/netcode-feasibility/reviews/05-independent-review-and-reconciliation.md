# Independent Review + Reconciliation (Opus)

An unbiased first pass (no access to the other reviews), all numbers produced by driving the real
modules in a real Chromium against the running dev server + Node relay — followed by a reconciliation
of that pass against the three strategic reviews and the Fable diagnosis.

---

## Part 1 — Independent assessment

**Verdict:** Keep host-authoritative. Do NOT treat the spike's `Not feasible / 49.1` headline as
decision-grade — it is an artifact of a pessimistic default config and a statistically hollow
measurement. The spike's *supporting* findings are sound; its *flagship* number is its weakest.

### Q1 — Right things, faithful model? Mostly yes (HIGH)
`NetFightScene`/`SnapshotHostScene extends FightScene` both call `super.update()`, so the real
`FightScene.update → processCombat → resolveAttack` drives the sim; only input is swapped. Zero
`src/` edits — boundary confirmed. Gaps: (a) the E2E only ever sends a bare `light:true` edge
(`e2eExperience.ts:200,559`) with fighters ~320 px apart vs 70 px reach (`FightScene.ts:79-80`,
`CombatSystem.ts:71`) → measures button-ack latency, not the input model; (b) determinism
"reproducibility" runs on synthetic char defs with monkey-patched `Math.random`, not the real
`FightScene` — `reproducible=true` is near-tautological (3 pure RNG calls are seedable, never in
doubt); the 25/100 is an estimate, not a measurement.

### Q2 — Trustworthy conclusions? Split (HIGH)
**Believable:** snapshot cost/size (measured **63 B binary, 25.9 B avg delta, 0.0103 ms/frame** over
120 real ticks); the render-fidelity gap is real (the guest is a **teleporting puppet** —
`SnapshotGuestScene.update()` is empty (`guestScene.ts:82`), never runs tweens/timers); input seam
verified; `chargeMs` dead field verified.
**NOT trustworthy — the flagship input-lag number:**
1. **Statistically hollow** — every run attributes **4–5 samples** → p95 = p99 = max-of-5.
2. **The "BAD 6.4-frame wall" is a config artifact.** Swept it — `felt ≈ RTT + interp + ~10 ms app`:

   | Config | RTT | interp | felt p50 | frames | band |
   |---|---|---|---|---|---|
   | spike default | 80 ms | 50 ms | 107 ms | **6.4** | bad |
   | LAN-ish | 20 ms | 16 ms | 34 ms | 2.0 | acceptable |
   | project target | 30 ms | 33 ms | 58 ms | 3.5 | borderline |
   | zero net | 0 | 0 | 9.5 ms | 0.6 | good |

   Default injects 80 ms RTT = **2× the project's own 20–60 ms target**; at target it's 2–3.5 frames,
   not "past the 6-frame ceiling." The composite `49.1 "Not feasible"` is min-gated by this one
   `bad` sub-score (`scoring.ts:30`).
3. **Transport HOL verdict is unfair** — `link-loss` only toggled for WS cells (`transportExperience.ts:397`),
   loss proxy only fronts `:8080`; WebRTC never touches it. `buildVerdict` (`:232-248`) compares
   WS-with-loss vs WebRTC-with-no-loss. Only the loss-resilience sub-score (`:303`) is fair.

### Q3 — Does the paired path work? Partially (HIGH — ran it)
**It connects and runs:** two tabs, real WS over the relay — host drove **420 ticks in 3.5 s**,
guest returned a completed result, **real RTT p50 = 1.04 ms over 17 samples** (correctly relayed
host→server→guest→server→host). But the paired felt-lag is broken two ways: (a) **backgrounded-tab
rAF throttling** → felt-lag 466.75 ms from 1 sample against 1 ms RTT (no `visibilitychange` guard);
(b) **no presence barrier** → host-drives-first blasts all snapshots into the relay (dropped, no
peer), completes, closes; the late guest waits **forever** (hung to the 1822 s tool timeout — no
internal stall guard). Works only when the guest is foregrounded AND subscribed before the host drives.

### Q4 — Gaps/risks (ranked)
1. The decisive metric is the least reliable (5 samples; config-driven banding; garbage/hang on the
   real path). 2. State→render gap is the real unsolved product problem. 3. No TURN → 15–30 % won't
   connect. 4. Clock sync is faked (shared process clock). 5. Unbuilt: reconnection, matchmaking,
   authority, host-migration, mobile. 6. WebGL context exhaustion.

### Q5 — Deployment-ready? Config-ready, not deployed (HIGH)
`/api/health`→ok, COOP/COEP present both ports, `/data/announcer.json`→200, loss API toggles,
`render.yaml`+`DEPLOY.md` complete. Blockers: (a) `render.yaml` must be copied to repo root
(documented, not done); (b) **no cold-start "waking server…" UI built** despite `DEPLOY.md:72`
requiring it; (c) the paired-path presence/stall/visibility bugs make a first real two-machine
attempt hang/garbage unless fixed first.

### Q6 — Bottom line
Keep host-authoritative (robust findings support it; nothing reopens rollback). Do NOT commit on the
current numbers — the one gating number is 5 samples, banded BAD only under a 2×-harsh network, and
corrupted/hangs on the real path; at target-consistent settings it's borderline-acceptable.
**Single most important next step:** make felt-lag decision-grade (hundreds of samples;
`visibilitychange` guard + stall timeout + presence barrier; then real hardware at 20–60 ms RTT with
interp swept), then re-read the verdict.

---

## Part 2 — Reconciliation memo (against the priors)

Four passes converge far more than they conflict.

### Agreements
Keep host-authoritative (delay-based is NOT the cheap escape — same determinism prerequisite as
rollback); snapshot cheap; fidelity structurally lossy; the decisive felt-lag doesn't exist on real
hardware; `chargeMs` dead field; STUN-only; n=10 transport p99; `waitForOpen`≠peer-presence; scoring
sound; server is a spike server. The "BAD/49 is a config artifact" was already stated by Review 02
§6 / Path-to-Prod §1 — **quantified**, not discovered, by the Opus pass.

### What the Opus pass adds (confirmed)
1. **NEW** — E2E measures button-*ack*, not the input model (bare `light` edge, out of range).
2. **NEW** — rAF throttling silently corrupts paired felt-lag on a backgrounded tab (466 ms/1 sample).
3. Quantified the felt-lag gradient and located where the project's target sits (2–3.5 frames).
4. **Holds ground** — the WS-vs-WebRTC HOL comparison is *structurally* unfair, not merely un-run:
   the in-app proxy physically can't reach the P2P channel, so even a completed `link-loss` run
   compares WS-with-loss vs WebRTC-with-no-loss. Fair comparison needs an **OS conditioner on both
   legs** — which the reviews don't state as a hard precondition.
5. **NEW manifestation** — host-drives-first → guest hangs unbounded (no internal stall guard).

### Contradictions resolved
**(a) "aborted mid-pass at 180 s" (Fable) vs "hung to 1822 s" (Opus): same root defect, two
manifestations.** No peer-presence barrier + stop condition gated on `sample.tick >= driveTicks`
that never fires. Fable's 180 s is the *outer* `runExperience` wrapper (`RunStore.tsx:159`) rescuing
the hang; Opus invoked `exp.run()` directly, bypassing it, proving the paired path has **zero
internal liveness guard**. Fix = presence barrier (surface `bothPresent`, `rooms.ts:44`) + internal
stall timeout, not just the outer wrapper.

**(b) How many ways can a "completed" paired felt-lag be wrong?** At least **four independent
corruptors** (A presence/hang, B clock-skew→0-samples false positive, C rAF throttling false
negative, D n≈1–5 hollow) — none subsumes another. **Precise correction:** the felt-lag *subtraction*
is epoch-safe (both `tSent` and `now` are guest-clock, `e2eExperience.ts:555,539`); clock skew
poisons the **interp sampler gating** (`interpBuffer.ts:38`, guest `now` vs host `hostTime`), not
the timestamp math. So Fable is right about the *effect* (0 samples) but the *locus* is the sampler.
**Consequence:** fixing clock sync alone does NOT make the number trustworthy — C, D, A remain.

### Overstated (either side)
- Priors imply **clock sync is *the* fix** — overstated; necessary but insufficient (needs
  visibility guard + sample floor + presence barrier too).
- Priors imply **`link-loss` yields the WS-vs-WebRTC comparison** — overstated; needs an OS
  conditioner on both legs.
- Review 02 calls the determinism reproducibility demo "real evidence" — mildly over-generous;
  it's real but low-information (seeds 3 pure RNG calls, never the real sim).
- **Opus concession:** the "borderline-acceptable at target" reframing is itself a *simulated*
  (loopback + simulated-network, single-clock) number — it sharpens the "measurement gap"; it does
  **not** close it. Thin samples were already noted by Review 02.

### Consolidated verdict (all four passes)
Infrastructure-complete, evidence-incomplete. **Keep host-authoritative — confirmed.** **Don't
commit the track now.** The reframing shifts the *outlook* from "feared near the acceptable edge" to
"the fear is largely an artifact — at the project's target the (simulated) number is 2–3.5 frames,
so the real measurement is more likely to pass than the dashboard implies" — **compatible with, and
refining, the priors; it changes the outlook, not the action.** Everyone still says measure first.
**The one convergent next step:** fix the paired measurement instrument (presence barrier + internal
stall timeout + clock offset + `visibilitychange` guard + sample-count floor + more samples + wider
input), then take one trustworthy felt-lag reading on two real machines. The WS-vs-WebRTC HOL
question additionally needs an OS conditioner on both legs, not the in-app proxy.
