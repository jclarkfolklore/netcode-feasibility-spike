# Review 01 — Relevance & Coverage

**Question:** Does the netcode-feasibility spike measure the right things for *this specific game*, and what does it leave unmeasured that the real multiplayer decision needs?

**Scope of this review:** strategic fit between the four experiments and the real host-authoritative decision for rock-em-sock-em. This is not a code-quality or bug audit — those findings are supplied as established context and used here only as evidence.

---

## Bottom line

The spike asks the right *first* question — "can the real FightScene be captured, relayed, and re-rendered cheaply?" — and answers it well: snapshot cost is trivially cheap (~63 B binary, sub-millisecond encode), and RNG-based non-determinism is a non-issue for host-authoritative (the host is the sole source of truth, so `Math.random()` calls never need to agree across machines). Those are real, decision-relevant, correctly-scoped results.

But the spike measures **wire-level feasibility of one honest game loop**, not **operational viability of a shippable feature**. Four gaps would each independently overturn or reshape the "host-authoritative is viable" conclusion if left unaddressed, and none are instrumented at all: **mid-match disconnection has no recovery path**, **the host can trivially cheat because nothing validates its snapshots**, **cross-machine clock sync doesn't exist** (so the one number everything else depends on — felt input lag — is currently unmeasurable on two real machines, per the known two-machine breakage), and **the entire "online" feature — matchmaking, lobby, reconnection, room persistence — does not exist anywhere in the codebase**, so "feasible" here means "the wire protocol works," not "the feature is close to done."

None of this invalidates the spike's technical conclusions. It means the summary page's composite score should not be read as "multiplayer is N% ready" — it is "the host-authoritative data-plane is cheap and honest." The gap between those two framings is where a tech lead could be misled.

---

## 1. Experience-by-experience: does it measure what governs viability for THIS game?

| # | Experience | Real question for rock-em-sock-em | Measures it? | Model fidelity vs real FightScene |
|---|---|---|---|---|
| 1 | Transport (WS vs WebRTC) | Is the wire fast/reliable enough to carry ~60Hz snapshots + input? | **Yes**, cleanly | Payload sizes are synthetic (`8..16384` B, default `64` B — `transportExperience.ts:25,50`), decoupled from the real measured snapshot size, but happen to land almost exactly on it (see §3.1) |
| 2 | Sim-snapshot | Can the real Phaser sim's state be captured/serialized/rendered elsewhere? | **Yes**, and honestly — it also surfaces the render-fidelity gap as a qualitative finding rather than hiding it in the score (`snapshotExperience.ts:180,242-243`) | High — boots the real `FightScene` via subclass, drives it via real public `Fighter` mutators |
| 3 | Remote-input E2E | What will the guest actually *feel*? | **Yes in principle — the single most decision-relevant number in the whole spike** (`e2eExperience.ts:680-681` literally says so) — but currently **not obtainable on two real machines** (established: cross-tab clock-epoch skew, dead control channel under StrictMode, no run choreography) | High model fidelity (real `NetFightScene`, real `RemoteInput`, real edge-exactly-once contract) but the *measurement infrastructure* around it is the weakest link in the whole spike |
| 4 | Determinism-cost | Should Decision 1 (host-authoritative over rollback) be revisited? | **Yes, correctly scoped as a separate axis** — not blended into the feasibility composite (`scoring.ts:111-137`), and it correctly concludes rollback does *not* reopen the decision | N/A (static analysis + headless reproducibility demo, not a live-sim model) |

### 1.1 Transport
Measures real RTT/jitter/loss/reorder over the actual transports the game would ship with, with an honest HOL-blocking distinction (`contracts.md` §4; `transportExperience.ts:501-506`). This is squarely the right first-principles question and the spike answers it soundly. Its only relevance gap is that its payload sizes are an independent sweep, not derived from the real snapshot codec (see §3.1) — a coincidental match today, not a maintained one.

### 1.2 Sim-snapshot
This is the strongest experience in the set relative to the real decision. It:
- Captures the **actual** `FightScene` internals via the sanctioned type-cast technique (`snapshotCodec.ts:32-56`), not a stand-in model.
- Measures real encode cost against the real 16.67 ms frame budget and a real sub-MTU byte ceiling.
- **Explicitly refuses to let a clean encode-cost number paper over the render-fidelity gap** — `raw.fidelity` in `snapshotExperience.ts:216-240` enumerates, per render mode, exactly which visual state does not survive the snapshot (attack lunge tweens, hit-flash, block-shield alpha, charge-ring pulse, walk leg-swing, the action-badge text, and — the sharpest one — *which specific move is playing*, since the frozen schema carries only the coarse `state` enum, never `attackKind`/`moveId`).
- Names the two concrete production blockers this implies: (1) all pose/animation lives in fire-and-forget Phaser Tweens with no snapshottable tween state, and (2) `Fighter.chargeMs` (`Fighter.ts:45`) is dead — the real charge lives on `FightScene.chargeP1`/`chargeP2` (`FightScene.ts:31-32`), so a production snapshot API needs either promoting charge onto `Fighter` or reaching past it exactly as this harness does (`snapshotExperience.ts:242-243`).

This is exactly the kind of finding Decision 2 (the production input/state seam) needs, and it is delivered as a **named, unscored finding** rather than diluted into the composite — the right call per `contracts.md` §5's "must not paper over a structural gap" instruction.

### 1.3 Remote-input E2E
Correctly identified in the code itself as the decisive number (`e2eExperience.ts:680-681`), and the model fidelity is genuinely high: real `NetFightScene` subclass, real edge-exactly-once `RemoteInput` (`remoteInput.ts:69-113`), real interpolation buffer, real transport RTT via peer-echo. The solo-preview path is honestly labeled and excluded from cross-network verdicts (`e2eExperience.ts:255-321`).

The problem — already established and not re-litigated here — is that the **paired two-machine path**, the only one that produces a trustworthy number, is currently broken end-to-end. That means today the spike's single most decision-relevant metric produces either a failure or a silently-wrong "0.0ms / band good" reading on real hardware. Until that's fixed, this experience's contribution to the actual go/no-go decision is close to zero, regardless of how well-designed the measurement code is.

### 1.4 Determinism-cost
Correctly scoped as an offline, evidence-anchored estimate, not a live metric (`determinismCost.ts:110-129`), and correctly split onto its own axis so a good transport score can never mask "rollback would be expensive" or vice versa (`scoring.ts:115-122`). The enumerated non-determinism sources are accurate against the real code:
- `CombatSystem.ts:52` (crit roll), `CombatSystem.ts:58` (bug-prone roll) — cheap, seedable `Math.random()` sites.
- `Announcer.ts:10` — cosmetic RNG.
- Every timer in `Fighter.ts` (attackTimer, hitstunTimer, confidence regen, walk-cycle phase) and `Announcer.ts` cooldowns is keyed on Phaser's variable `update(time, delta)` — there is no fixed-tick counter anywhere in `src/game`, confirmed by reading `FightScene.update()` (`FightScene.ts:150`) directly.
- Canonical position/velocity live in a Phaser Arcade `Body` integrated on a non-locked step, and `CombatSystem.ts:70-72`'s range check runs on floating-point positions — structurally non-reproducible without a fixed-point/locked-step rewrite.

The 25/100 `determinism-readiness` score is by design (not a failure state) and the recommendation — "rollback does not reopen Decision 1" — is well-supported by this enumeration plus the MKX cost anchor. **One relevance note the current write-up doesn't make explicit but should**: host-authoritative's whole appeal is that it *needs none of this to be true*. The RNG/timestep/physics non-determinism this experience finds only matters if rollback is later reconsidered — for the live Decision 1 architecture, none of these three sources is a defect, because only the host's own `Math.random()`/timers/physics ever run. Worth a one-line callout on the page so a reader doesn't mistake "the sim is non-deterministic" for a host-authoritative risk.

---

## 2. Model fidelity vs the real FightScene/Fighter/CombatSystem

| Dimension | Real game | Spike's model | Match? |
|---|---|---|---|
| State size | 2 `Fighter`s, ~10 scalar/enum fields each + 3 scene-level fields (`round`, `countdown`, `winner`) | `Snapshot`/`FighterSnap` (`contracts.ts:32-63`) mirrors this near-exactly, including the `chargeMs`-lives-on-the-scene wrinkle | Faithful |
| Tick model | Phaser `update(time, delta)`, variable frame rate, no fixed timestep (`FightScene.ts:150`) | Harness adds its own `tick` counter (`NetFightScene.ts:51,85-95`) purely as a wire sequence number, still driven by the same variable-delta loop underneath | Faithful to what exists — but see §3.7 below, this "tick" is not a simulation tick |
| Input model | Keyboard only, level-held movement + `JustDown` edges for light/heavy/special (`InputManager.ts:35-58`) | `RemoteInput`/`ButtonState`/`EdgeState` reproduce level+edge semantics exactly, including the "missing frame → all edges false, never replay a stale attack" rule (`remoteInput.ts:82-113`) | Faithful |
| Animation/pose | Tween-driven, fire-and-forget, no state→render separation (`Fighter.ts` startAttack/setBlocking/playHitVisual all call `scene.tweens.add` directly) | Explicitly modeled as unrecoverable from the frozen schema; the spike measures and names the gap rather than hiding it (§1.2) | Honestly incomplete — the *right* kind of incomplete (named, not glossed) |

The model is unusually faithful for a spike — it drives the real classes, not stand-ins, and the fidelity gaps it does have are the ones the real production code also has (they're findings about `src/game`, not limitations invented by the harness).

---

## 3. Gaps — ranked by how much each could change the decision

### 3.1 Reconnection / mid-match drop — **no handling exists** (High impact)
`server/wsRelay.ts:99-104`: on either peer's socket closing, the relay closes the other with code `4000` ("peer left") and deletes room traffic bookkeeping. `RoomRegistry.leave()` (`rooms.ts:49-54`) removes the seat entirely — there is no grace period, no reconnect token, no resume. The client-side `Transport.onStateChange` reports `'closed'` and that's the end of the story (`contracts.ts:142`, `webrtc.ts` state machine).

For a real match, a guest's wifi hiccup or phone lock-screen currently **ends the match outright** with no path back in. This is squarely a host-authoritative-specific risk the spike is positioned to speak to (state-relay in principle makes "guest resyncs from a fresh snapshot" trivial — the host already has full authoritative state) but nothing here measures or even attempts it. This is the single highest-value cheap addition: proving "guest disconnects for 3s, reconnects, gets a fresh full snapshot, keeps playing" would directly de-risk shipping, and the architecture (host owns all state) makes it nearly free to demonstrate.

### 3.2 Authority / anti-cheat — **not addressed at all** (High impact, unaddressed by design)
Host-authoritative means whichever peer is `host` runs the one and only simulation and streams its own conclusions to the guest, unverified (`rooms.ts` role assignment: first joiner or explicit `?role=host`, no privilege distinction beyond that). Nothing in any experience checks whether a snapshot is plausible, rate-limited, or consistent with prior state. A host player can, in principle, edit `health`/`specialMeter`/`x` locally before its own snapshot is even produced, or run a modified client, and the guest has no way to detect it.

This is not a flaw in the spike — it's outside what a wire-format feasibility spike should measure — but it is a **permanent architectural consequence of Decision 1** that the summary page's "feasible" framing doesn't surface. A casual 1-on-1 party game between friends may find this fully acceptable; a matchmaking-based or ranked mode would not. This should be an explicit, named caveat on the summary page, not an implicit assumption.

### 3.3 Matchmaking / lobby / room lifecycle — **the "online" feature does not exist in the game today** (High impact, correctly out of scope but under-communicated)
`spec.md:46` correctly puts this out of scope for the spike ("this is a measurement instrument, not the feature"), which is the right call for a spike. But it's worth being blunt about the actual state: grepping the real game finds `mode: "online"` (`src/game/types.ts:119`) exists **only as an unused type-level placeholder** — no lobby scene, no matchmaking, no room-creation UI, no reconnection UX, nothing, exists anywhere in `src/`. The server's `RoomRegistry` (`rooms.ts`) is a bare in-memory two-peer seat map with **no persistence across a process restart** — and the deployment is a single Render free-tier instance (`render.yaml`, `DEPLOY.md`) that cold-starts after ~15 min idle, meaning any in-flight room state is wiped on a redeploy or a restart.

None of this is a spike defect. It is, however, the majority of the actual engineering cost of "ship online multiplayer," and it is not reflected anywhere in the spike's cumulative score. A tech lead reading only the summary page's number could reasonably (and wrongly) infer "the hard part is done." The hard-part-that's-done is the data plane; the hard-part-that-isn't-started is everything session/lifecycle-shaped around it.

### 3.4 Clock sync across real machines — **absent, and the one number everything depends on needs it** (High impact — established, cited here for its downstream effect)
`interpBuffer.ts:56-66`'s own doc comment says it plainly: "In this loopback demo host and guest share one clock... a real cross-machine guest would need clock sync (e.g. an NTP-style offset from the ping/pong RTT exchange) to compute the same number honestly." No such offset is computed anywhere — `session.ts` has no clock-sync logic at all, and `SessionInfo` carries no clock offset field. This is the root cause of the already-established cross-tab clock-epoch skew that makes a real two-machine E2E run silently report "0.0ms / band good" instead of failing loudly. Given felt input lag is described in the code itself as the single most decision-relevant number (§1.3), this is not a peripheral gap — it's the reason that number currently cannot be trusted on the hardware configuration (two real machines) that the decision is actually about.

### 3.5 Mobile + real cellular/WAN conditions — **untested, and the input model doesn't support it yet either** (Medium-high impact)
Two independent gaps stack here:
- **Network**: `WebRTCTransport` ships STUN-only (`webrtc.ts:60`, `DEFAULT_ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }]`), no TURN — already established to fail under symmetric NAT / carrier-grade NAT, which is common on cellular. No experience runs under real cellular conditions (throttled/lossy/high-jitter) at all; every "real network" run in this spike is either loopback-simulated latency or same-network WS/WebRTC over presumably-clean links.
- **Input**: `LocalKeyboardInput` (`InputManager.ts`) is the only `InputProvider` the real game has; there is no touch/virtual-stick input source in `src/game` at all. Even if the network worked, a mobile guest has no way to produce the button-state/edge stream `RemoteInput` expects, because that input source doesn't exist yet in the real game, independent of netcode.

If mobile play is anywhere on the roadmap, this compounds: the netcode might work and mobile players still couldn't play, for reasons the spike's scope never touches.

### 3.6 The state→render API gap (tweens / moveId / damage amount) — **the spike already found this; it's correctly the strongest finding in the set** (High impact, already surfaced — flagged here as the one gap that's actually well-handled)
Covered fully in §1.2. Calling this out separately only to make the ranking complete: of all the gaps in this list, this is the one the spike itself already measured, quantified, and reported honestly, without letting it distort the composite score. It should be treated as a **template** for how the other gaps in this list (reconnection, authority, clock sync) ought to be written up — named, evidenced, and explicitly excluded from the score — rather than left as absent context.

One added, decision-relevant data point not in the existing write-up: the real production fix is cheap. Adding `attackKind` (3 values) and `moveId` (22 `MoveId` variants, `types.ts:1-24`) to the wire schema costs on the order of **2 bytes per fighter** (both fit in single-byte enums) — i.e., the schema's own missing fields are not a scaling risk, just an omission. This should reassure, not alarm, whoever reads the finding: the render-fidelity gap is closeable without materially changing the size/cost conclusion in §3.1 of the transport comparison below.

### 3.7 Host frame-rate / performance degradation — **not stress-tested** (Low-medium impact, worth one experiment)
The `tick` field the harness adds (`NetFightScene.ts:51`) is a per-`update()`-call counter, not a fixed simulation step — the underlying combat timers (`attackTimer`, `hitstunTimer`, confidence regen, etc.) are still `delta`-keyed milliseconds (§1.4). This is fine for host-authoritative in principle (only the host's own experience of time needs to be internally consistent), but it does mean a host running under CPU load (background tab throttling, a weak device, a long GC pause) changes the *feel* of combat for both players, and nothing in any experience simulates host-side frame-rate variance or CPU contention. Lower priority than §3.1–§3.5, but cheap to add (throttle the host's `requestAnimationFrame` during a pass and watch what happens to snapshot cadence and interp staleness) and directly relevant to "which player should host."

### 3.8 >2 players (2v2) / spectators — **not a gap; architecturally a non-question today** (informational, not a risk)
Worth resolving explicitly rather than leaving open: rock-em-sock-em's combat model is **hard-wired to exactly two fighters**. `FightScene` declares exactly `p1`/`p2` (`FightScene.ts:22-23`), `CombatSystem.resolveAttack` takes a single `attacker`/`defender` pair (`CombatSystem.ts:38-43`), and `MatchConfig` has exactly two character slots (`types.ts:115-120`). There is no near-term path to 2v2 or spectators that this netcode decision needs to accommodate — and structurally, the server's `RoomRegistry`'s `Role = 'host' | 'guest'` type (`rooms.ts:16-34`) would reject any third connection outright today (`join()` returns `null` once both seats are taken). If 2v2/spectator modes ever enter the roadmap, that is a game-design-and-combat-system rewrite first, netcode-topology question second — not something this spike under-covers, because it isn't yet a real question.

---

## 4. What's sound — don't relitigate

Per the brief, these are confirmed correct on inspection and should not be second-guessed:
- **Geometric-mean + min-gate composite scoring** (`scoring.ts:17-37`) — a single `bad` sub-score correctly caps the composite rather than being averaged away; failed experiences are excluded, never zeroed (`scoring.ts:63-64`).
- **Feasibility-vs-determinism axis split** (`scoring.ts:111-137`) — correctly prevents a good transport number from masking a bad determinism-readiness number or vice versa.
- **Peer-echo single-clock RTT design** (`contracts.md` §1) — RTT measured on the sender's own clock avoids cross-machine clock skew for *that* metric specifically (it just doesn't extend to the interpolation-staleness/felt-lag numbers, which is exactly §3.4's gap).

---

## 5. Recommendations, ranked by decision impact

1. **Fix the two-machine E2E path before trusting any felt-lag number** (clock sync/offset via the ping/pong exchange already in place, plus the already-known run-choreography and control-channel fixes). Until this works, the spike's most decision-relevant metric is not actually available on the hardware configuration the decision is about.
2. **Add a mid-match disconnect/reconnect demonstration.** Given the architecture already puts full state on the host, proving "guest drops for N seconds, rejoins, gets a fresh snapshot, keeps playing" is cheap relative to its de-risking value, and directly addresses §3.1.
3. **Name the authority/anti-cheat and matchmaking-is-greenfield caveats explicitly on the summary page**, next to the composite score, so "feasible" is never read as "close to shippable." This is a documentation fix, not new engineering — it just needs to happen before the summary page is used to make the actual call.
4. **Treat the render-fidelity write-up (§1.2/§3.6) as the template** for how §3.1–§3.4 should eventually be written up: named, evidenced, explicitly excluded from the score.
5. **Before any mobile milestone**, note that TURN and a touch/virtual-stick `InputProvider` are both fully unstarted — cellular NAT traversal and mobile input are two separate blockers, not one.
6. Lower priority: a host-CPU-degradation stress pass (§3.7) once the above are addressed.

**Overall:** the spike is a well-built instrument that correctly answers "is the data plane cheap and honest," and its own honesty about the render-fidelity gap is a model for rigor. The risk is scope-creep of interpretation, not scope-creep of the spike itself: the summary composite must not be read as an answer to "is online multiplayer ready to ship," because five of the eight gaps above (reconnection, authority, lobby/matchmaking, mobile input, TURN) are entirely outside what any of the four experiments measure, and the sixth (clock sync) currently blocks the one experiment designed to measure the decisive number.
