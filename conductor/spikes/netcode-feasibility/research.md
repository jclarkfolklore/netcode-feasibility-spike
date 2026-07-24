# Netcode Feasibility — Research & Context

Backing evidence for the spike's explanations, chosen metrics, and score thresholds. **Provenance tags:** `[measured]` = benchmarked/instrumented data · `[consensus]` = agreed by multiple experienced devs/FGC · `[vendor/doc]` = official docs or a single author's technical writeup · `[repo]` = verified in this codebase.

> **Verification note (per project rule "verify load-bearing claims against primary sources"):** external claims here were gathered by research agents with source URLs preserved. Claims marked **⚠ load-bearing** must be confirmed against the linked primary source before the app presents them as fact to teammates. Provenance travels with every claim shown in the UI.

---

## A. Internal — what our sim actually is `[repo]`

Verified against `src/game/**` (2026-07-23). Full map lives in the track; the load-bearing facts:

- **Input seam is clean.** `InputProvider.getInput(1|2)` (`InputManager.ts:5-7`); only `FightScene` touches it (field `:24`, construction `:82`, call sites `:163,169,170`). **`CombatSystem` never sees input** → `RemoteInput` needs zero combat changes. ✅
- **No host-role hardcoding.** `MatchConfig.mode` exists but is never read in `src/game`; `player:1|2` is just position/facing. Host-role is free to define. ✅
- **Only 3 non-determinism sources:** `CombatSystem.ts:52` (crit), `:58` (bug-prone), `Announcer.ts:10` (line pick). No `Date.now`/`performance.now` in sim. ✅ cheap to seed.
- **Snapshot-hostile ❌ (the big risk):** canonical position/velocity live in a Phaser `Arcade.Body`; all pose/animation lives in Phaser `GameObject`s driven by fire-and-forget **tweens** (no snapshottable tween state); countdown lives in a Phaser `TimerEvent`. **Sim mutations trigger rendering as a side effect** (`takeDamage`→`playHitVisual`), so there is **no state→render path** — a guest can't render a raw snapshot without re-driving sim methods.
- **Variable timestep, no tick counter** — all timers keyed on real `delta`. Rollback/lockstep both require introducing a fixed step first.
- **Can't run headless / two sims in one page** — `isSceneLive` guards everywhere; `createGame` tears down any prior game (singleton). Two clients = two full Phaser games (separate tabs/iframes or a `new Phaser.Game` bypass).

**Implication:** input injection is easy; **host-authoritative snapshotting is the unproven, load-bearing risk** and is exactly what 008.4 must measure.

---

## B. Transport — WebSocket/TCP vs WebRTC DataChannel

- **The real cost of WebSocket is TCP head-of-line blocking under loss**, not median latency: a lost packet stalls newer ones ≥1 RTT — a frozen input in a 60Hz stream. Unordered DataChannel drops and moves on. `[consensus]` — [Gaffer](https://gafferongames.com/post/why_cant_i_send_udp_packets_from_a_browser/)
- **On a clean link the two are near-identical; the win is in the p99 tail, not the median.** ⚠ load-bearing — a mean-RTT benchmark proves the wrong thing. `[consensus]`
- **Specific "WS 10–50ms vs WebRTC 20–80ms" numbers are folklore** (unsourced, ignore the tail). Do not cite. The spike replaces these with our own loss-conditioned p99.
- **DataChannel UDP-like config:** `{ordered:false, maxRetransmits:0}`; `maxRetransmits`/`maxPacketLifeTime` mutually exclusive. Use a **separate reliable channel** for match setup. `[vendor/doc]` — [MDN/web.dev](https://web.dev/articles/webrtc-datachannels), [Fisher](https://jameshfisher.com/2017/01/17/webrtc-datachannel-reliability/)
- **Keep unreliable payloads ≲1192 B** to avoid SCTP fragmentation (lose a fragment → lose the snapshot); ≤16 KiB for cross-browser safety. `[vendor/doc]` — [Grahl](https://lgrahl.de/articles/demystifying-webrtc-dc-size-limit.html)
- **WebRTC needs signaling (usually a WebSocket) + STUN/TURN.** ~70–80% connect P2P via STUN; **~15–30% need a TURN relay** (adds a hop, erases the P2P win) — ⚠ but that figure is from video-call telemetry, not games. `[measured/consensus]` — [Metered](https://www.metered.ca/blog/what-is-a-turn-server-3/)
- **Both ship in production:** geckos.io (WebRTC/UDP) vs Colyseus (WebSocket) — WebSocket is genuinely fine for many multiplayer games, esp. with prediction/rollback masking hitches. `[consensus]` — [geckos.io](https://github.com/geckosio/geckos.io), [webgamedev](https://www.webgamedev.com/backend/webrtc)

**Methodology (must-do, or the benchmark lies):**
- **Measure RTT round-trip on one clock** (`RTT = now() − t0` on the sender) — sidesteps cross-machine clock skew. `[measured]`
- **`performance.now()` is clamped** (Chrome 100µs, Firefox 1ms) unless the page is **cross-origin-isolated (COOP+COEP)**. Report browser + resolution. `[vendor/doc]`
- **Set TCP_NODELAY** or Nagle skews the WS baseline. Inject loss deliberately (`0/0.5/1/2/5%`) — on LAN loss≈0 and you measure nothing. **Report p50/p95/p99, never means.** `[consensus]`

---

## C. Netcode models — for a fighting game specifically

| | Delay-based | Rollback (GGPO) | State-relay / host-auth |
|---|---|---|---|
| Determinism required | yes | **yes, bitwise** | **no** |
| Snapshot / restore | no | snapshot **+ restore** every tick | snapshot only |
| Guest feel | sluggish w/ ping | local-instant | **guest eats RTT + interp buffer** |
| FGC acceptance | deprecated | **gold standard** | rare in FGC |
| Retrofit cost | low | **very high** | low–moderate |

- **State-relay needs NO determinism and NO restore** — the guest renders the host's snapshots and never re-simulates, so float/RNG divergence can't happen. ⚠ load-bearing (this is why it's the cheap path). `[vendor/doc]` — [Snapnet snapshot-interp](https://snapnet.dev/blog/netcode-architectures-part-3-snapshot-interpolation/)
- **But the fighting-game mismatch is fundamental:** decouple sim rate from snapshot rate (Source: 66 tick / 20 snapshot) and the guest **interpolates ~100ms in the past** (`cl_interp 0.1`), so you hit the opponent where they *were*. Shooters paper over this with server rewind; frame-1 hitboxes/throw-techs can't tolerate it. ⚠ **the central risk 008.5 must measure.** `[vendor/doc/consensus]` — [Valve](https://gist.github.com/CoolOppo/fe0586836de3fb2f90f9), [Gambetta](https://www.gabrielgambetta.com/entity-interpolation.html)
- **Serialization:** JSON is native/fast; **binary wins on size, not CPU** (userland MessagePack measured 1.6–3.2× *slower* than native JSON). Ladder: JSON to prove the loop → hand-packed `DataView` for the ~dozen changing fields → delta-encode. `[measured]` — [msgpack test](https://smali-kazmi.medium.com/when-optimized-is-slower-why-we-stuck-with-native-json-for-our-10mb-context-object-2d7dd62e6982)
- **A 2-fighter snapshot is tiny** (bandwidth grows with players²; irrelevant at 2) and should sit under one MTU — a point in our favor. `[vendor/doc]`
- **Rollback retrofit cost is brutal:** MKX ≈ **8 man-years** (~2 on serialization alone) to retrofit onto a shipped non-deterministic game; naive rollback tripled frame cost 10ms→32ms. Only worth it greenfield-deterministic. `[measured]` — [Infil p5](https://words.infil.net/w02-netcode-p5.html)
- **Symmetric input delay** (delay the host's input to match the guest) converts an unfair asymmetry into an even, fair delay — a constant, not an architecture change. `[consensus]` — [Infil p3](https://words.infil.net/w02-netcode-p3.html)

---

## D. Metrics & scoring — the thresholds the app scores against

**Unit: frames @60fps = 16.67ms/frame; ping ÷ 16 ≈ frames the netcode must hide.** `[consensus]`

**Input lag / felt latency (the decisive number):**
- ≤1 frame (~16ms): imperceptible · **~3 frames (~48ms): the "feels offline" ceiling** (Killer Instinct ships a fixed 3-frame buffer) · ≥6 frames: uncomfortable rubber-banding. `[consensus]` — [Infil p6](https://words.infil.net/w02-netcode-p6.html)
- Academic: **design goal <75ms**; perf drops sharply by 75–100ms; 60ms a better fast-game threshold than the classic 100ms. `[measured]` — [Raaen survey](https://www.ntnu.no/ojs/index.php/nikt/article/view/5252)

**Network sub-metric bands (Good / Acceptable / Bad):**
| Metric | Good | Acceptable | Bad |
|---|---|---|---|
| Latency (RTT) | <20–30ms | <50–60ms | >100–150ms |
| Jitter | <5ms | <10–30ms | >30ms |
| Packet loss | 0% | <1% | >1% |
| Snapshot/frame cost | ⟪small vs 16.67ms⟫ | — | tripling frame cost (→32ms) is BAD |

`[consensus/measured]` — [FreeISPInfo](https://freeispinfo.com/guides/best-latency-online-gaming-ping-jitter-packet-loss/). **Weight jitter high — players tolerate steady lag, not variance.** `[consensus]`

**End-to-end input lag ≠ RTT.** RTT is one term inside button-to-photon (input poll + event loop + sim + render + VSync + display). True glass-to-glass needs hardware (LDAT/photodiode). A browser measures **simulated network + app-processing latency** — comparative, not absolute. Measure input `event.timeStamp` → committed change in the `rAF` callback; **report the distribution**, state the caveat. `[measured]` — [TechteamGB](https://techteamgb.co.uk/2022/10/14/click-to-photon-latency-is-useless-and-i-made-something-better/)

**Composite scoring — how to stay honest:**
- Composite scores are **decision-unstable under re-weighting**; **normalization is weighting**; additive sums let a great metric **compensate for a fatal one**. `[measured/consensus]` — [OECD Handbook](https://www.oecd.org/content/dam/oecd/en/publications/reports/2005/08/handbook-on-constructing-composite-indicators_g17a16e3/533411815016.pdf)
- **Do:** map each sub-metric to 0–100 via the Good/Acceptable/Bad bands above (anchored to human thresholds, not dataset variance); aggregate with a **geometric mean or min-gate** so one BAD drags the whole (honest for feasibility); **show every sub-score, band, weight, and rationale**; let users perturb weights.
- **UI:** Lighthouse-style — one traffic-light verdict, ≤5–9 headline metrics, expandable sub-scores with bands + distributions, passes the 30-second time-to-answer test; avoid lone speedometers. `[consensus]`

---

## E. Bottom line going in (to be confirmed by the measured runs)

1. **Transport:** WebSocket is probably fine for same-region; the WebRTC case rests entirely on loss-conditioned p99 — measure it, don't assume it.
2. **Host-authoritative feasibility:** the input seam is easy; **snapshotting our Phaser sim is the real risk** (no state→render path) — 008.4 likely surfaces "needs a production snapshot/state→render API."
3. **The decisive number:** guest felt input lag vs the ~3-frame ceiling (008.5). State-relay imposes RTT + interp buffer + stale-opponent — likely past the ceiling off-LAN.
4. **Rollback reopening:** only if determinism is cheap — 3 RNG sites are, but fixed-timestep + physics/FP are structural; the honest cost anchors to the MKX ~8-man-year figure.

_Findings from the actual deployed runs get appended to the spike `README.md` (Research/Finding), which cites back to this file._
