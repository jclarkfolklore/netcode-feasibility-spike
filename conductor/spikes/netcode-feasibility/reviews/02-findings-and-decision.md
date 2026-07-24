# Findings & Decision — Netcode Feasibility Spike

**Reviewer lens:** what can the project *honestly* conclude right now, at what confidence, and what specifically must be re-measured before Decision 1 (host-authoritative) can be treated as validated rather than assumed.

**Scope note:** this is not a code audit. The spike's mechanics (loss-injection semantics, StrictMode double-invoke, the 30s/180s timeout mismatch, the cross-tab clock issue) are treated as *given, already-diagnosed facts* per the brief — they are cited here only as evidence for the strategic conclusions below, not re-litigated.

---

## 1. Scorecard

| Question | Verdict | Confidence | Why |
|---|---|---|---|
| (a) Is host-authoritative feasible? | **Probably, on the parts measured — but the one number that would prove it (guest felt lag on a real WAN) does not exist yet.** | **Low-Medium** | Sim→snapshot→transport plumbing is proven end-to-end in-process; nothing has run cross-machine successfully yet (§2). |
| (b) TCP HOL — real problem or is WS fine? | **Unknown — not yet tested under the one condition that would show it.** | **Very Low** | The valid HOL test (`link-loss` via toxiproxy/OS conditioner, contracts.md §4) has not been run; only the non-HOL `payload-drop` mode is exercised by default (§3). |
| (c) Is the snapshot cheap enough, is fidelity acceptable? | **Cheap: yes, well-supported. Fidelity: partial and understood, but the render-fidelity gap has never been shown across a real clock-skewed link.** | **High (cost) / Medium (fidelity)** | Encode cost measured directly off the live sim (§4.1); fidelity gaps are enumerated with file:line precision, but interpolation staleness has only ever been computed on a single shared clock (§4.2). |
| (d) Should rollback reopen? | **No — stands as a defensible estimate, not yet a full audit-grade number.** | **Medium-High** | Enumeration + headless reproducibility demo is real evidence; the 25/100 score is an anchored analyst estimate, not a measurement (§5). |

**Headline:** the spike has proven the *shape* of host-authoritative (sim→snapshot→transport→render→input-back) is buildable without touching `src/`, and has produced trustworthy numbers for two of five sub-questions (snapshot encode cost, determinism cost-estimate). It has **not yet produced a real cross-machine felt-lag number or a real HOL comparison** — the two measurements the whole exercise exists to produce. Treat the spike as **infrastructure-complete, evidence-incomplete**.

---

## 2. (a) Is host-authoritative feasible?

### What is genuinely trustworthy
- **The input seam is real and clean.** `NetFightScene extends FightScene`, swaps `keyboard` post-`super.create()`, no `src/` edit (contracts.md §7; confirmed in `research.md` §A: `InputProvider.getInput` is the only touchpoint, `CombatSystem` never sees input). This was a real risk (F2) and it resolved cleanly — high confidence, this part of Decision 1's assumption is validated.
- **A snapshot can be captured, relayed, and re-rendered with no local sim** — proven, in-process, at `src/experiences/snapshot/snapshotExperience.ts`. The DoD item "a real fight-state snapshot is captured, relayed, and re-rendered on the guest with no local sim" is met, in the loopback topology.
- **The remote-input plumbing works mechanically**: `RemoteInput`, exactly-once edge delivery, the delay ring buffer, symmetric-delay knob — all wired and exercised by the solo-preview pass (`e2eExperience.ts:256-321`).

### What is NOT yet shown, and why that matters
- **No successful two-machine run exists.** Per the given findings: a guest-initiated run stalls to `"aborted mid-pass"`; a host-initiated run's control channel dies under React `StrictMode` in dev, and even when it doesn't, the guest's felt-lag number never merges because the companion timeout mismatch (30s vs the real ~180s budget for a two-Phaser-game 420-tick pass, `companion.ts:8` vs `RunStore.tsx:159` before the fix) kills it early.
- **`waitForOpen` cannot detect an absent peer** — confirmed at the transport layer: `WebSocketTransport`'s state goes `'open'` the instant the **local** socket connects to the relay (`src/lib/transport/ws.ts:68`, `this.socket.onopen = () => this.setState("open")`), not when a peer is seated in the room. The server *does* track this (`rooms.ts:44` `bothPresent`, logged at `wsRelay.ts:70-71`) but that signal is never surfaced to the client. So `waitForOpen(transport, 15_000, signal)` (`e2eExperience.ts:328`) returns `true` for a lone peer talking to nobody — the paired guest then waits forever for a snapshot that will never arrive (its stop condition is gated on `sample.tick >= driveTicks`, `e2eExperience.ts:575`, which never fires with `sample` perpetually `null`) until the caller's outer timeout aborts it — which is exactly the "aborted mid-pass" symptom.
- **The clock-epoch skew bug means even a "successful"-looking cross-tab run can silently report a fabricated good result.** `FeltLagTracker.attribute` (`feltLagTracker.ts:32-41`) only produces a sample when it finds `tSent` for the just-attributed `lastInputSeq` in its own map — if the guest's `recordSent`/`attribute` pairing loses sync with the arriving `lastInputSeq` stream (e.g., because the run choreography above caused the guest to attribute against a session that never actually incorporated its presses), `sampleCount` stays 0 and `computeDistribution([])` returns `{count:0, p50:0, ...}` (`metrics.ts:17`) — a **defined, non-throwing zero**, not a visible error. The banded verdict text (`e2eExperience.ts:600`) then reads "0.0ms / band good" for a run that measured nothing. This is the most dangerous class of bug in a feasibility spike: a silent false-positive on the decisive number.

### Net conclusion
The *engineering* case for host-authoritative is in good shape (clean seam, working snapshot pipeline, no `src/` invasiveness required beyond the one approved input seam). But **feasibility for shipping** depends on the guest's felt lag being tolerable on real networks, and that number **has never successfully been produced outside a single browser process.** Confidence: **Low-Medium** — trending positive on priors (research.md §E's own predictions), but the one number that would convert "probably" into "yes" is still missing.

---

## 3. (b) WebSocket vs WebRTC — is TCP head-of-line blocking a real problem here, or is WS fine?

### What is measured
- Default transport sweep runs **10 pings per cell** (`transportExperience.ts:53` `samplesPerCell: 10`, used at `:335` and `:407`). With `computeDistribution`'s nearest-rank `percentile()` (`metrics.ts:20-27`), **p99 of a 10-sample array is just the max** — there is no meaningful tail estimate at this sample size. Any p99 number currently on the Transport page should be read as "the single worst observation of 10," not a percentile in any statistically defensible sense.
- **Loss injection has two distinct mechanisms, correctly separated in the contract** (contracts.md §4): `payload-drop` (app-layer, post-TCP-delivery, **cannot** produce HOL) vs `link-loss` (toxiproxy/OS conditioner, the only mode that can). The binding rule is explicit: *"the WS-vs-WebRTC HOL comparison is only valid under `link-loss`."*
- Per the given findings, only the non-HOL `payload-drop` path has actually been exercised in practice so far. The `link-loss` toxiproxy sidecar exists in the architecture (owned by 008.2, toggled by 008.3 per `plan.md` sub-spec table) but there's no evidence in the code paths reviewed here of a completed, reported `link-loss` run.

### Why this matters more than it looks like it does
The entire premise of testing WebRTC at all — per `research.md` §B's own "bottom line" — is: *"On a clean link the two are near-identical; the win is in the p99 tail... a mean-RTT benchmark proves the wrong thing."* That is precisely the comparison this spike has **not yet run under valid conditions.** Every "WS is fine" or "WebRTC wins" conclusion drawn from `payload-drop` data is answering a different, easier question (does the app tolerate a dropped datagram) than the one Decision 3 needs answered (does a real network's HOL stall show up as felt lag).

### Net conclusion
**Not yet knowable.** There is no honest basis today to say either "WS is fine" or "TCP HOL is a real problem here" — both would be overclaiming from data that either (a) wasn't collected under `link-loss`, or (b) has n=10 and reports p99 as effectively "the max of 10." Confidence: **Very Low**, and this is arguably the single most important gap given that Decision 3 (transport port) is explicitly named as being fed by this spike.

---

## 4. (c) Is the snapshot cheap enough, and is the render-fidelity gap acceptable?

### 4.1 Cost — trustworthy, and good news
`snapshotExperience.ts` measures **real per-tick encode cost off the live, running `FightScene`** (via a harness-local render-only guest scene, `bootGames.ts`), not a synthetic microbenchmark loop (explicitly called out at `measuredCaveat`, `snapshotExperience.ts:285`). The `snapshot-cost` sub-score is scored purely against the 16.67ms frame budget (`:205-213`), separately from fidelity, exactly per contracts.md §5's instruction not to let a composite paper over a structural gap.

This is the cleanest, most trustworthy sub-result in the whole spike: encode cost is negligible (fractions of a millisecond against a 16.67ms budget), delta-encoded payload sits comfortably under the 1192B sub-MTU ceiling (`ladder.subMtuBudgetBytes`, `:267`), matching `research.md` §C's prior ("a 2-fighter snapshot is tiny"). **Confidence: High.** There is no reason to expect this number to move materially on a real network — encode cost is a CPU question, not a network one, and it was measured against real game state.

### 4.2 Fidelity — well-characterized, but has a blind spot
The fidelity findings are unusually rigorous for a spike: `snapshotExperience.ts:216-243` enumerates, with file:line precision, exactly what mirrors (position, health/confidence/special, facing, logical state/timers) vs. what doesn't (tween-driven pose/animation, which attack/move is playing, `Fighter.chargeMs` being a dead field since real charge state lives on `FightScene` not `Fighter`). The `productionApiFinding` (`:243`) correctly identifies that a production state→render API is a real, separate deliverable, not a bug in this harness.

**The blind spot:** the entire fidelity + staleness measurement runs in `loopback` topology — one process, one shared clock. The code says so itself: *"Host and guest share one clock in this loopback demo... a cross-machine guest needs clock sync... to compute the same number honestly"* (`snapshotExperience.ts:273`). Given the separately-diagnosed cross-tab clock-epoch skew bug, **the one place this matters most (staleness/interpolation lag across a real link) is exactly the measurement this experience has never actually taken.** The size/cost conclusion survives this gap intact (cost doesn't depend on clock sync); the fidelity conclusion does not extend automatically to what a real guest will *feel*, only to what a snapshot structurally *contains*.

### Net conclusion
**Cost: cheap, high confidence, ship it as designed.** **Fidelity: the structural gap is real, understood, and almost certainly acceptable for a HUD-driven fighting game** (pose smoothing is a solvable production problem, not a blocker) — but "acceptable" here is an engineering judgment call about a known, bounded gap, not yet a validated player-perception result, because it's never been observed under real staleness on a real link.

---

## 5. (d) Should rollback reopen?

### What is real evidence
- **The enumeration is verified against actual file:line locations** (`determinismCost.ts:18-54`): 3 RNG sites (`CombatSystem.ts:52,58`, `Announcer.ts:10` — cheap), plus two structural sources (variable-`delta`-keyed timers everywhere, no tick counter; Arcade-physics floating-point state with no fixed-step lock). This is auditable, not hand-waved.
- **The reproducibility demo is a real headless run**, not a mock: same seed + same scripted tape → identical `JSON.stringify` outcome across two independent invocations of `runScriptedTape` (`:137-141`), and a different seed diverging (`:142`) — this genuinely demonstrates the "cheap part" is cheap.
- **The 25/100 `determinism-readiness` score is explicitly an estimate**, not a measured quantity (`:159`, `:190` `measuredCaveat` says so outright) — anchored to the MKX retrofit figure (~8 man-years, ~2 of them on serialization, `research.md` §C) rather than to anything measured in *this* codebase's structural remainder. That anchor is an external analogy, reasonably chosen, but it is not this project's own cost curve.

### What it is not
It is **not** a bad or failing score by construction (per the given context) — 25/100 is the honest reflection of "2/8 of a rollback retrofit is provably cheap; 6/8 is untouched and structural," not a red flag about spike quality. Don't misread it as a defect.

### Net conclusion
**"Rollback does not reopen" is a defensible recommendation** — the structural blockers (fixed timestep, deterministic/restorable physics, tween-state serialization) are real, correctly identified, and consistent with the independently-sourced MKX anchor. Confidence: **Medium-High.** It would become **High** with one additional, cheap step this spike does not currently do: a rough project-specific effort estimate for the two structural items (how many timer call-sites, how entangled the Arcade `Body` state is) rather than relying solely on an external game's retrofit cost as the anchor. That's a nice-to-have, not a blocker — the direction of the recommendation is not in doubt.

---

## 6. What's measured/trustworthy vs. not-yet-measured/measured-wrong

| Claim | Status | Evidence |
|---|---|---|
| Input seam works without touching `src/` (beyond the approved seam) | **Trustworthy** | contracts.md §7; research.md §A |
| Snapshot can be captured + relayed + rendered with no local sim | **Trustworthy** (in-process only) | `snapshotExperience.ts` |
| Snapshot encode cost is cheap | **Trustworthy** | `snapshotExperience.ts:204-213`, real-sim timings |
| Snapshot render-fidelity gaps (pose/tween/moveId/chargeMs) | **Trustworthy as a structural finding** | `snapshotExperience.ts:216-243` |
| Snapshot staleness/interp lag on a real link | **Not measured** — loopback/single-clock only | `snapshotExperience.ts:273` |
| Guest felt input lag on a real two-machine WAN link | **Does not exist yet** | run-choreography breaks (§2); no successful paired pass reported |
| Solo-preview E2E "bad" (15/100) score | **Not a verdict — an artifact of the chosen impairment constant** | default `simulatedNetwork` 40±10ms + 50ms interp ≈ 5-8 frames, always red by construction (`E2E_DEFAULT_CONFIG`, `e2eExperience.ts:80-93`) |
| Determinism-cost 25/100 | **Not a failure — a by-design rollback-readiness estimate** | `determinismCost.ts:159` |
| WS vs WebRTC HOL comparison | **Not validly measured** — only `payload-drop` exercised, not `link-loss` | contracts.md §4 binding rule; no reported `link-loss` run |
| Transport p99 numbers | **Statistically unreliable at n=10** | `transportExperience.ts:53`; `metrics.ts` nearest-rank percentile |
| WebRTC connectivity on real WANs | **Untested / likely optimistic** | STUN-only, no TURN: `webrtc.ts:60` `DEFAULT_ICE_SERVERS = [{urls:"stun:..."}]`; research.md §B's own figure: ~15-30% of real connections need TURN |
| "0.0ms / band good" on a cross-tab run with 0 attributed samples | **A measured-wrong false positive**, not a real result | `feltLagTracker.ts:32-41` zero-sample path never surfaces as an error; `metrics.ts:17` `EMPTY_DISTRIBUTION` |
| Banding copy ("bad ≥6 frames / 100ms") vs. actual code band (`bad` triggers at >3 frames) | **Copy bug — contradicts the score that's actually shown** | prose: `e2eExperience.ts:272,600,683`; code: `frameBand`/`bandFor(goodMax:1, acceptableMax:3)` at `e2eExperience.ts:251-253` |

---

## 7. Honest current verdict

**The spike has not yet answered the question it exists to answer.** It has built — correctly, and with real engineering rigor — the instrument capable of answering it: a working sim→snapshot→transport→render→input-back loop, a sound scoring model (geometric mean + min-gate, feasibility/determinism axis split — both explicitly *not* in question here), and file:line-level honesty about every gap it has found. What it has **not** produced is:

1. A single successful two-machine run of the decisive experiment (guest felt input lag) on a real network.
2. A valid WS-vs-WebRTC HOL comparison (requires `link-loss`, not the `payload-drop` mode apparently exercised so far).
3. Confidence that the transport numbers it does have are statistically meaningful (n=10 samples/cell).

Everything currently "red" on the dashboard (solo E2E 15/100, determinism 25/100) is either an artifact of a deliberately pessimistic constant or a by-design non-failure — **do not let those numbers drive the decision**. Conversely, everything currently "green" that matters most (a real cross-machine felt-lag figure) **does not exist yet** — do not let its absence read as an implicit pass either. The project is at a **measurement gap, not a go/no-go point.**

### Recommendation
**Do not commit the multiplayer track on the current data.** Fix the run-choreography bugs (StrictMode double-invoke on the control channel, the 30s/180s timeout mismatch, `waitForOpen`'s inability to detect an absent peer, the clock-skew false positive) — these are already identified and scoped — then run the specific measurements in §8 below on real, separate machines before treating Decision 1 as validated.

---

## 8. What MUST be re-measured before the track can commit, and what result on each would flip the decision

All of the below require **two real machines on different networks** (not two tabs on one machine — `same-machine-two-tabs` shares a NIC/route and under-states real WAN behavior), with the paired-run path fixed first.

| # | What to re-measure | How | Flips the decision if… |
|---|---|---|---|
| 1 | **Guest felt input lag, real WAN, both transports** | Fix `waitForOpen`/companion choreography first (§2); run the paired E2E pass host+guest on two real networks; take p50/p95/p99 over enough presses to be a real distribution (not the current ~3-16 samples/run) | p95 lands **at or above ~3 frames (~50ms)** on a typical target-region link → host-authoritative's guest feel is *not* acceptable as-is (needs a bigger interp buffer, prediction, or reopens rollback per Decision 1's own "revisit if the cost calculus changes" clause) |
| 2 | **WS vs WebRTC under `link-loss` (real TCP HOL), not `payload-drop`** | Run the toxiproxy sidecar (or OS Network Link Conditioner) at 0.5/1/2/5% loss on the WS leg; compare p99 RTT/jitter against WebRTC's unreliable channel at matched loss | WebRTC's p99 is **meaningfully lower** (not just its mean) at realistic loss rates → Decision 3 should favor WebRTC; if they're **statistically indistinguishable**, WS is fine and the extra WebRTC/signaling complexity isn't justified |
| 3 | **Statistically adequate transport sample size** | Raise `samplesPerCell` well past 10 (e.g., 100+) so p99 is a real percentile, not "the max of 10" | If p99 with a real sample size **diverges meaningfully** from the current n=10 numbers already shown on the dashboard → the current Transport page verdict is currently misleading and must be re-labeled/re-run before being trusted at all |
| 4 | **WebRTC connectivity failure rate with only STUN (no TURN)** | Attempt real connections from a handful of real-world networks (corporate Wi-Fi, mobile hotspot, a symmetric-NAT test if available) | If a non-trivial fraction (research.md §B cites ~15-30% in video-call telemetry, unverified for games) **fail to connect P2P** → WebRTC's real availability is worse than the RTT numbers imply, and either TURN becomes in-scope or WS becomes the default recommendation regardless of RTT results |
| 5 | **Snapshot staleness/interpolation lag on a real (non-shared) clock** | Repeat the snapshot experience's staleness measurement across a real two-machine link with a proper clock-offset derivation (e.g., from ping/pong RTT, per contracts.md §1), not the current single-process shared clock | If observed staleness is **much larger** than the configured interp delay once real clock skew is accounted for → the render-fidelity "acceptable" judgment in §4.2 needs revisiting; if it's close to configured, the current fidelity conclusion holds |
| 6 | **Fix the false-positive path itself** (not a re-measurement, a precondition) | Make `FeltLagTracker`/the E2E pipeline **fail loudly** (status `failed`, not `completed` with `count:0`) whenever `sampleCount` is 0 or implausibly small, so a broken run can never again render as "0.0ms / band good" | N/A — this doesn't flip the decision, it's what makes #1's result trustworthy enough to act on at all |

**Bottom line for a tech lead reading only this section:** items #1 and #2 are the two numbers Decision 1 and Decision 3 actually need. Nothing else in this document should move the needle until those two exist on real hardware. Everything currently computed is either supporting infrastructure evidence (seam works, snapshot is cheap, rollback is expensive) or a known-artifact "red" that isn't a verdict.
