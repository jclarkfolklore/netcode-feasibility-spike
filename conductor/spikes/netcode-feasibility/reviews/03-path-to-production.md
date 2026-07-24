# Path to Production — Multiplayer for Rock 'Em Sock 'Em

**Lens:** how to actually build this, given what the spike measured.
**Audience:** tech lead making the go/no-go + sequencing call on the multiplayer track.
**Builds on:** the technical findings already established for this spike (harness fragility, scoring construction, banding text bug, sample sizes, STUN-only WebRTC, deployment specifics) — not re-litigated here. This document assumes those findings and asks: *given they're true, what do we actually build, in what order, starting with what?*

---

## 0. Bottom line

1. **Keep Decision 1 (host-authoritative state-relay).** The spike's determinism-cost analysis is the correct reason, and it generalizes beyond the 3 known RNG sites: the structural blockers (fixed timestep, deterministic physics, snapshottable tween state) are exactly the ones that make **any** sim-replicated model — rollback *or* plain delay-based/lockstep — expensive here. State-relay is the only architecture on the table that sidesteps that cost entirely, because only the host ever runs the sim.
2. **The decisive number (felt input lag) is not yet trustworthy.** Per the established findings, the two-machine path is currently broken and the solo-preview "bad" score is a synthetic-network artifact, not a real-WAN measurement. Before this track can honestly close, the smallest next step is: **fix the two-tab/two-machine run choreography and get one real cross-network felt-lag sample.** Everything downstream (MVP scope, whether to invest in guest-side prediction) depends on that number being real.
3. **The production input seam and snapshot API do not exist in `src/game` yet** — today it's a `LocalKeyboardInput` hardcoded into `FightScene.create()` and zero serialization anywhere. The harness proved the *shape* of both (harness-side, by design, per the track's own no-`src/`-edit constraint) but none of it is real product code yet. Section 2 below is the concrete diff list.
4. **WebRTC is not production-ready for WAN play as configured (STUN-only, no TURN)** — this is a go/no-go blocker for "play with a friend over the internet," not a nice-to-have. Budget for TURN or ship WS-only for v1 and treat WebRTC as an opportunistic upgrade behind automatic fallback (the `Transport` abstraction already supports this cheaply — see §4).
5. **The server/infra in the spike is a spike server** (in-memory single-instance room registry, no reconnection, no auth) — correctly scoped for measurement, not launch. None of it blocks an MVP with a handful of concurrent matches; all of it is a real to-do before a public launch (§5).

---

## 1. Netcode model recommendation

### Recommendation: **host-authoritative state-relay.** Confirmed, not just carried over from Decision 1.

| Model | Requires bitwise-deterministic sim on ≥2 machines? | Cost given current architecture | Verdict |
|---|---|---|---|
| **Host-authoritative state-relay** (Decision 1) | No — only the host ever simulates | Needs a snapshot/render API (new, medium effort) but **zero** determinism work | **Recommended** |
| **Rollback** (predict, simulate ahead, resimulate on correction) | Yes — every peer must reproduce identical outcomes from identical inputs | Structural: fixed timestep + deterministic physics + snapshot/restore of tween-driven animation state, none of which exist today | Rejected — same as Decision 1 |
| **Delay-based / lockstep** (fixed input delay, no rollback, but every peer simulates) | **Yes, same requirement as rollback** — lockstep only works if all peers reach the identical state from the identical input stream | Same structural cost as rollback; the only thing it *saves* relative to rollback is the resimulation/prediction machinery, not the determinism prerequisite | Rejected for the same reason as rollback |

The nuance worth being explicit about for the tech lead: **"delay-based" is not a cheaper alternative to rollback here.** It's tempting to read "rollback is expensive, so let's do delay-based instead" as if delay-based avoids the determinism cost — it doesn't. Both peers still have to run the same sim to the same conclusion; delay-based just skips prediction/resimulation on top of that shared requirement. The only model that structurally avoids the determinism prerequisite is one where a single machine is the sole simulator — i.e., state-relay. That is the actual argument for Decision 1, and the spike's determinism-cost experience (`src/lib/experience/determinismCost.ts:116-194`) is the right evidence for it, anchored on the MKX retrofit citation (~8 man-years, only ~2 of them serialization) and the two structural non-determinism sources it enumerates:

- `src/game/entities/Fighter.ts:253-270,197-201,279-311` + `src/game/systems/Announcer.ts:17-19` — every timer is `delta`-keyed (real milliseconds), no tick counter anywhere in `src/game`. Two runs of the same input sequence at different frame rates diverge.
- `src/game/entities/Fighter.ts:142-150` (Arcade `Body`) + `CombatSystem.ts:70-72` (float range checks) — canonical position/velocity live in Phaser's non-fixed-rate Arcade physics step; not bitwise-reproducible cross-machine without a fixed-point/locked-step rewrite.

Both are correctly scored `structural` (weeks–months), not `cheap` (hours), in `determinismCost.ts:64-83`. **Do not revisit rollback/lockstep until one of those two items is independently justified** (e.g. a physics rewrite for unrelated reasons) — retrofitting determinism *purely* to enable rollback is not currently worth it, exactly as Decision 1 already concluded.

### The real open question is not "which model" — it's "what felt-lag ceiling does state-relay leave us with, and is that acceptable for this game."

State-relay's known cost is exposed, not hidden, input lag: the guest has no local sim, so every input round-trips host RTT + the interpolation buffer before the guest sees any effect. The spike's default synthetic network (40±10ms each way + 50ms interpolation buffer ≈ 5–8 frames) scores "bad" by construction — that's a property of the *chosen test defaults*, not proof the shipped game will feel bad on a real connection, but it is a legitimate warning that the ceiling is close to the "acceptable" band's edge even under decent network conditions. Two mitigations exist without touching the netcode model:

1. **Shrink the interpolation buffer** and/or make it adaptive to measured jitter (currently a flat 50ms constant — see the interpolation-buffer experience).
2. **Client-side prediction of the guest's *own* locally-controlled fighter** — a well-established middle ground (used by e.g. Rocket League, most non-fighting action-multiplayer titles) that predicts only the local player's movement/attack state optimistically and reconciles against the host's authoritative snapshot when it arrives, while the *opponent* fighter still renders however many frames behind is honest. This does **not** require the sim to be deterministic across machines the way rollback/lockstep does, because only one machine (the guest) ever predicts its own single fighter, and reconciliation is a snap-to-authoritative-state correction, not a resimulation. This is the single highest-leverage netcode investment beyond the MVP wire-up, and it's worth a cheap experiment (§6, Phase 0) before deciding whether to build it.

The roster's tone (`Deploy Friday`, `QA Goblin`, `Scope Creep`) suggests a casual/party framing rather than a competitive-FGC one — worth factoring into how much felt-lag is actually tolerable before investing in prediction. That's a product call, not an engineering one; flag it explicitly rather than assuming FGC-grade latency expectations apply.

---

## 2. Required `src/game` changes

None of this exists yet. The harness correctly built everything **harness-side only** (contracts.md §7, `conductor/tracks/008-netcode-feasibility_20260723/contracts.md:110-119`) under an explicit "no `src/` edit beyond one surgical seam" constraint — that constraint is a spike-scoping decision, not a production one. Below is the concrete diff list for turning the proven harness shape into real product code.

### 2.1 Input seam (small, mechanical, do first)

- **Today:** `FightScene.ts:24` declares `private keyboard!: LocalKeyboardInput;` and `FightScene.ts:82` hardcodes `this.keyboard = new LocalKeyboardInput(this);`. There is no way to inject another `InputProvider` without subclassing and reaching past `private` with a type-cast — exactly what the harness's `NetFightScene` (`conductor/spikes/netcode-feasibility/src/experiences/e2e/netFightScene.ts:82`, `(this as unknown as { keyboard: InputProvider }).keyboard = provider`) had to do because it was contractually forbidden from touching `src/`.
- **Change:** type the field `protected keyboard!: InputProvider;` (the `InputProvider` interface already exists and is exactly right — `src/game/systems/InputManager.ts:5-7`) and accept an optional injected provider through `init()`/a constructor param, defaulting to `new LocalKeyboardInput(this)` when absent. This is a ~10-line change and removes the only reason a production multiplayer scene would need to subclass-and-cast.
- **Tick counter:** `FightScene` has no monotonic tick counter today (`contracts.md §7` explicitly notes the harness had to put it on `NetFightScene` for this reason). Add a real `protected tick = 0;` incremented once per `update()`, exposed via a getter — needed by the input-delay buffer, snapshot tagging, and any future fixed-timestep work.

### 2.2 Snapshot / state→render API — separate "what changed" from "how to animate"

This is the fidelity gap the spike's `guestScene.ts` explicitly documents and cannot close by design (`conductor/spikes/netcode-feasibility/src/experiences/snapshot/guestScene.ts:136-141`): the frozen `Snapshot` schema carries `state: FighterStateKind` (`idle|walk|attack|block|hitstun|ko`) but never *which* attack (`moveId`) or *what kind* (`light|heavy|special`), so a guest reconstructing pose on a state transition into `"attack"` can only ever guess `f.startAttack("light")` (`guestScene.ts:149-150`) — never the host's real move, crit, or damage amount.

The root cause is real and specific: `FightScene.pendingAttack` (`FightScene.ts:33-39`) — `{ attacker, defender, move, chargeMs, attackKind }` — is populated in `processCombat` (`FightScene.ts:299-310`) and **consumed and discarded in the same tick** (`FightScene.ts:184-216`, `this.pendingAttack = null` at `:215`). The exact data a network layer needs (move id, attack kind, hit/blocked/crit, damage dealt) exists for one tick and is thrown away.

**Recommendation:** promote this into a real event, following the pattern the codebase already uses for the Phaser→React one-way bridge (ADR-001; `game.events.emit("impact", ...)` at `FightScene.ts:203`). Concretely:

```ts
// emitted once per resolved attack, alongside (not instead of) the per-tick state
this.game.events.emit("attack-resolved", {
  tick: this.tick,
  attacker: player,          // 1 | 2
  move,                      // MoveId
  attackKind,                // "light" | "heavy" | "special"
  hit: result.hit,
  blocked: result.blocked,
  crit: result.crit,
  damage: result.damage,
});
```

A network snapshot layer captures this alongside the per-tick numeric snapshot as a parallel **event log** (not part of the periodic state snapshot — events are discrete and must never be missed by an interpolation buffer the way continuous state can tolerably be). The guest applies numeric state from snapshots (as it does today) and **replays the correct animation/pose from the event log**, closing the fidelity gap the spike's "redrive-mutators" mode could only approximate. This is a genuinely new API, not a refactor of an existing one — budget accordingly (see roadmap, Phase 1).

### 2.3 `Fighter.chargeMs` — dead field, and it's a bug beyond netcode

`Fighter.ts:45` declares `chargeMs = 0`, and it is read exactly once, at `Fighter.ts:171` inside `attackReachBonus()`:

```ts
if (this.def.traits.includes("growing_power") && this.chargeMs > 400) {
  return 20;
}
```

**It is never written anywhere in `src/game`.** The actual accumulating charge duration lives on `FightScene` as two plain numbers, `chargeP1`/`chargeP2` (`FightScene.ts:31-32`), threaded through `processCombat`'s `setCharge` callback (`FightScene.ts:263, 269, 279`) and passed as a raw argument into `getChargeMultiplier(chargeMs)` (`CombatSystem.ts:92-96`, called at `FightScene.ts:192`) — never assigned back onto the `Fighter` instance.

This means **`attackReachBonus()`'s reach bonus for the `growing_power` trait is dead code today, in single-player, independent of any multiplayer work** — `scope_creep` (`src/game/characters/scope_creep/index.ts:9`, `traits: ["growing_power"]`) never gets its charge-based reach bonus because `this.chargeMs` is permanently `0`. Worth flagging to the game team as a pre-existing gameplay bug, found as a side effect of this spike's snapshot-fidelity analysis, separate from the multiplayer decision.

**Fix (serves both goals):** move charge-accumulation ownership from `FightScene` down onto `Fighter` (e.g. `Fighter.tickCharge(delta: number, charging: boolean)`, called from `processCombat` instead of the local closure variables), so `Fighter.chargeMs` becomes real and a snapshot of "the fighter" is actually complete without reaching into scene-private state the way `snapshotCodec.ts`'s `captureSnapshot` currently has to (`conductor/spikes/netcode-feasibility/src/experiences/snapshot/snapshotCodec.ts:38-52`, explicitly commented as reaching past `Fighter` into `FightScene.chargeP1`/`chargeP2` because "a production snapshot API would need to either promote this to a real `Fighter` field or have the producer reach past the fighter into scene state, exactly as this harness does below").

### 2.4 Fighter state — what's serializable today vs. not

| Field / behavior | Serializable today? | Notes |
|---|---|---|
| `x`, `body.velocity.x`, `health`, `confidence`, `specialMeter`, `attackTimer`, `hitstunTimer`, `facingRight`, `state` | Yes — plain numbers/booleans/enum | Already exactly what `snapshotCodec.ts` captures |
| `chargeMs` | No — dead field (§2.3) | Fix as above |
| Which move / attack kind is resolving | No — `pendingAttack` is scene-local and discarded same-tick | Fix as §2.2 |
| Tween-driven animation (`playAttackVisual`, `playHitVisual`, `setBlocking`, `resetPose` — all `scene.tweens.add(...)`, `Fighter.ts:333-346, 417-506, 508-521`) | **No, structurally** — fire-and-forget Phaser tweens have no serializable representation, confirmed by `determinismCost.ts`'s research citation ("tween-driven animation state is not currently snapshottable at all") | Not a blocker for state-relay (only the host ever runs tweens; the guest reconstructs approximate visuals from discrete events per §2.2) — but **is** a hard blocker for rollback/lockstep, reinforcing §1's model recommendation |

### 2.5 Wire it to the existing (unused) `MatchConfig.mode` stub

`MatchConfig` already has a `mode: "local" | "online"` field (`src/game/types.ts:119`) — but grep confirms it is **read nowhere** in `src/game` or `src/app` today; it's an unwired stub. Production wiring: branch scene construction (`src/game/main.ts`, `src/components/PhaserGame.tsx`) on `match.mode === "online"` to boot the appropriate host/guest scene variant instead of the always-local `FightScene`. This is a convenient, already-half-designed seam — use it rather than inventing a new config surface.

---

## 3. Summary: production `src/game` diff list

| # | Change | File(s) | Size |
|---|---|---|---|
| 1 | Type `keyboard` as `InputProvider`, injectable | `FightScene.ts:24,82` | Small |
| 2 | Real tick counter on `FightScene` | `FightScene.ts` | Small |
| 3 | `attack-resolved` event (moveId, attackKind, hit/blocked/crit/damage) | `FightScene.ts:184-216` (new emit alongside `pendingAttack` consumption) | Medium |
| 4 | Promote `chargeMs` ownership onto `Fighter` (fixes existing gameplay bug too) | `Fighter.ts`, `FightScene.ts:31-32,177-311` | Medium |
| 5 | Public read accessors for `p1`/`p2`/`round`/`winner`/`countdown` (currently `private`, only reachable via the harness's type-cast trick) | `FightScene.ts:22-39` | Small |
| 6 | Guest-render scene as a first-class `src/game` citizen (a real "no local sim, apply snapshots + replay events" scene, not harness-only) | new file, mirrors `guestScene.ts`'s proven shape | Medium |
| 7 | Wire `MatchConfig.mode === "online"` end-to-end | `main.ts`, `PhaserGame.tsx` | Small |

None of this requires fixed timestep or deterministic physics — that work is correctly deferred per §1.

---

## 4. Transport & TURN/ICE

**Recommendation: ship WebSocket-only for v1; treat WebRTC as an additive, automatically-falling-back upgrade, not a launch dependency.**

- The spike's WebRTC transport is **STUN-only** (`conductor/spikes/netcode-feasibility/src/lib/transport/webrtc.ts:60`, `DEFAULT_ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }]`) with no TURN relay configured anywhere in the harness or server. STUN alone fails to establish a direct P2P path across symmetric NAT (common on carrier-grade NAT, many corporate networks, some consumer routers) — this is a **known, structural failure mode for a meaningful fraction of real players**, not an edge case.
- Two ways forward, not mutually exclusive:
  1. **Add a managed TURN provider** (Cloudflare Calls TURN, Twilio Network Traversal Service, Xirsys, or self-hosted `coturn`) before claiming "WebRTC works over the internet." This has a real recurring cost (relayed TURN traffic is metered) — budget for it explicitly rather than discovering it post-launch when players "the game doesn't connect" report in from behind corporate NAT.
  2. **Automatic fallback to the WS relay.** The codebase already has both `WebSocketTransport` and `WebRTCTransport` behind the same `Transport` port (`contracts.ts:141-149`) — this is exactly the abstraction that makes "try WebRTC, and on `ice-failed`/connection timeout transparently reconnect over WS instead" a cheap addition, not a rearchitecture. `WebRTCTransport` already surfaces `ice-failed` as a state transition (`webrtc.ts:133-136, 224-226`) — the missing piece is a caller that catches that transition and retries with `WebSocketTransport` instead of just reporting failure.
- **For an MVP**, (2) alone is probably sufficient and is nearly free given the existing abstraction — ship WS as the default with WebRTC attempted opportunistically for its lower jitter under loss, falling back silently. Add TURN only once/if the WebRTC path is shown to matter enough (i.e. its transport-comparison numbers, once trustworthy, show a real UX difference under realistic loss) to justify the ongoing TURN cost.
- The transport comparison itself (WS vs WebRTC-unreliable RTT/jitter/loss) is sound methodology and worth trusting *once* the statistically-thin-sample issue (10 pings/cell default, called out in the established findings) is fixed with a larger sample size — that's a config change (`defaultConfig` in the transport experience), not a re-architecture.

---

## 5. Server / infrastructure

| Concern | Spike state today | Production requirement |
|---|---|---|
| Room pairing | `RoomRegistry<Peer>` (`server/rooms.ts:16-59`) — in-memory `Map`, exactly-two-peer, first-join = host | Fine to reuse the pattern verbatim for MVP. Becomes a bottleneck the moment the service needs >1 process (a room lives only in one process's memory — no cross-instance routing). |
| Scaling | Single-instance only; Render free-tier plan | For real concurrent-match volume: either sticky-session routing to keep a room's both peers on one instance, or move room state to a shared store (Redis) with pub/sub relay across instances. Not needed for a friends-invite MVP; needed before any public-matchmaking launch. |
| Signaling (WebRTC SDP/ICE) | `server/signaling.ts` — same two-peer-per-room model, fixed offerer/answerer split (host always offers) sidesteps full glare-avoidance (`signaling.ts:64-72`) | Reusable as-is; the fixed-role simplification is *correct* for a strictly-1v1 model and doesn't need generalizing unless the game ever supports >2-peer sessions. |
| Reconnection | None — either peer disconnecting closes the other's socket with code 4000 ("peer left"), no resumption (`wsRelay.ts:99-105`) | **This is comparatively cheap to add precisely because state-relay already makes the guest stateless** — a reconnecting guest just needs a fresh transport + one keyframe snapshot, not a resimulated history. Call this out as a real advantage of the chosen model, not just a gap. Host-side disconnection is harder (no other authority to fail over to) — decide the product behavior (pause-and-wait vs. forfeit) explicitly. |
| Auth / room security | None — any peer with a room id can join as host or guest, first-come | Fine for a link-shared friends MVP. Needs an invite-token or matchmaking layer before any public/discoverable room list. |
| Ops | `/api/health` healthcheck exists (`render.yaml`); Render free-tier cold-start (~15min idle spindown) is already documented in `DEPLOY.md` | Carries over; not a spike-only concern — the real game's multiplayer server will have the same cold-start consideration on Render's free/starter tiers if deployed there. |
| Deployment specifics already flagged | prod build hard-aliases `phaser` to the monorepo-root `node_modules`; `tsx` must be a prod dependency (already established) | Applies identically if the production multiplayer server is folded into or deployed alongside the main app — don't rediscover this. |

---

## 6. Biggest risks, ranked by impact

1. **The decisive felt-lag number is currently unproven on a real network.** Per the established findings, the two-machine path is broken (run choreography, clock-epoch skew silently reporting "0.0ms / band good" on 0 attributed samples) and the solo number is a synthetic-network artifact. **Shipping a go/no-go decision off either number as currently produced would be a mistake.** This is the highest-priority fix, and it's cheap relative to everything else in this document.
2. **No TURN — WebRTC will fail for a real fraction of WAN players.** Addressed in §4; either pay for TURN or make the WS fallback automatic before calling multiplayer "done."
3. **The animation/move fidelity gap will read as visibly broken to real players** ("wrong move flashes," generic light-attack pose on every hit) until §2.2's event channel ships — cosmetic today only because the spike's guest is a throwaway harness scene; not acceptable in the shipped game.
4. **State-relay's exposed-latency ceiling may or may not be acceptable** for this game's feel once the real (not synthetic) network number exists — this is a product-risk item, not just an engineering one, and the mitigation (guest-side local-input prediction, §1) is a real but non-trivial addition, not a config toggle. Don't commit to shipping without or with it until Phase 0's real number and a cheap prediction prototype (§7) both exist.
5. **`chargeMs`/reach-bonus is a live, unrelated gameplay bug** (§2.3) — small, but worth fixing in the same pass since the multiplayer work touches exactly that code path anyway.
6. **Server/infra immaturity is fine for MVP, a real project for public launch** — not urgent, but should not be mistaken for "solved" because a spike server exists.

---

## 7. Phased roadmap

### Phase 0 — de-risk the decision (days, before committing further engineering)

1. **Fix the two-tab/two-machine harness choreography** (companion timeout budget mismatch, StrictMode control-channel death, clock-epoch skew, guest-absence detection in `waitForOpen`) — all already enumerated in the established findings. This is fixing the *measurement instrument*, not the game.
2. **Run the remote-input E2E experience on two real machines on different real networks** (not two tabs on localhost) and get one trustworthy felt-input-lag sample. This is **the single smallest next step that actually de-risks the production decision** — right now nothing downstream can be sized or prioritized with confidence without it.
3. **Cheaply prototype guest-side local-input prediction** in the harness (predict the guest's own fighter's movement optimistically, snap-correct against the next host snapshot) and re-measure felt lag. This tells you, before committing to §2's `src/` changes, whether state-relay's ceiling is acceptable as-is or whether prediction is worth building into the MVP rather than being a Phase-2 nice-to-have.

### Phase 1 — MVP wiring into the real game

4. Land the §2/§3 `src/game` diff list: injectable input seam, real tick counter, `attack-resolved` event, `chargeMs` promoted to `Fighter`, public read accessors, guest-render scene, `MatchConfig.mode` wired end-to-end.
5. Promote the transport layer: `Transport` port + `WebSocketTransport` + `WebRTCTransport` (with automatic WS fallback on ICE failure, §4) into the real app or a small dedicated multiplayer service.
6. Promote the room/signaling server pattern (`RoomRegistry`, `/ws` relay, `/signal` relay) as the MVP's server, accepting the single-instance/no-auth limitations for a friends-invite launch.
7. Re-run the full spike (now pointed at the real wired-up game, not the harness's standalone scenes) as a regression gate — confirm the production wiring reproduces the same numbers the spike measured.

### Phase 2 — hardening before real/public launch

8. TURN (managed or self-hosted) if Phase 0's WebRTC-vs-WS comparison (once statistically sound) justifies the cost.
9. Reconnection/session resumption for a dropped guest (cheap, per §5); decide + implement host-disconnect product behavior.
10. Minimal room auth (invite tokens) ahead of any public/discoverable matchmaking.
11. Scale the room registry off single-process memory only if/when concurrent-match volume requires it.
12. Build guest-side local-input prediction for real (not just prototype) if Phase 0 showed it's worth it.

---

## 8. What to promote from the harness vs. what was throwaway

### Promote (adapt, don't copy verbatim — production seams differ from the harness's private-cast workaround)

| Harness asset | Where | Why it's reusable |
|---|---|---|
| `Transport` port + `WebSocketTransport` + `WebRTCTransport` | `src/lib/transport/*.ts` | Solid abstraction; add automatic fallback (§4) and it's close to production-ready as-is |
| Snapshot encoding ladder (JSON → binary → delta) | `src/experiences/snapshot/snapshotCodec.ts` | Good pattern for the real wire format once the schema gains `moveId`/`attackKind` (§2.2) |
| `RemoteInput` — exactly-once edge delivery over an input-delay ring buffer | `src/experiences/e2e/remoteInput.ts` | Genuinely production-grade input-seam logic; reuse near-verbatim once wired to the real, injectable `InputProvider` seam (§2.1) instead of the harness's cast-based swap |
| Room pairing pattern | `server/rooms.ts` (`RoomRegistry`) | Good starting shape for the MVP server, with the scaling caveats in §5 |
| Interpolation buffer concept | `src/experiences/snapshot/interpBuffer.ts` | Standard guest-side smoothing approach; reusable, tune the fixed-50ms constant to be adaptive (§1) |
| Determinism enumeration + cost table | `src/lib/experience/determinismCost.ts` | Valuable as living documentation — capture as an ADR referencing Decision 1, not as shipped code |

### Throwaway / harness-only — do not carry into production

| Harness asset | Why it doesn't ship |
|---|---|
| The `(this as unknown as {...})` private-field-casting technique (`netFightScene.ts:82`, `hostScene.ts:40`, `snapshotCodec.ts:54-56`) | Correct *harness* workaround for the spike's own "don't touch `src/`" constraint — production should use the real public seam from §2 instead, never this pattern in shipped code |
| `SnapshotGuestScene`'s synthetic `GUEST_FIGHTER_DEFS` fixtures (`guestScene.ts:33-54`) | Placeholder character defs for the harness only |
| The "redrive-mutators" approximate animation mode (`guestScene.ts:115-134,142-167`) | An honest experiment proving the fidelity gap exists — not a fix; ship the real `attack-resolved` event (§2.2) instead |
| In-process `LossProxy` (toxiproxy substitute) | Useful local-dev/test tool, not part of the shipped product; fine to keep around for internal testing, not a production dependency |
| Companion/run-all orchestration, geometric-mean composite scoring | Spike-only measurement meta-tooling; no place in the shipped game (the *engineering judgment* behind it — never-additive scoring with a min-gate — is good practice to remember for future measurement work, not code to carry forward) |
