# Failure Diagnosis & Deployment Report (Fable)

Two passes: (A) root-cause of the user-reported experiment failure, (B) a prioritized
recommendations report for accuracy, correctness, resources, and Render deployment. Grounded in
live paired two-tab Playwright runs, solo stress runs, and server-code review.

---

## A. The reported failure — fully reproduced & root-caused

**The user's failure is specific to the paired (`?room=`) two-tab path**, not a plain single-tab
run. Reproduced verbatim: two tabs `?room=<id>&role=host|guest`, the guest clicks Run/Run-all while
the host isn't simultaneously mid-run:

```
e2e-remote-input: failed  | verdict: "Failed before completion (paired-guest): aborted mid-pass"
                          | raw: {"mode":"paired-guest","reason":"aborted mid-pass"} | topology: same-machine-two-tabs
determinism-cost: failed  | verdict: "Aborted before this experience started."
                          | raw: {"reason":"aborted-before-start"}
```

That is character-for-character the user's report, and explains why **both** E2E *and* Determinism
"seem to fail" — Determinism never errors; it's run-all collateral of aborting a stalled E2E.

### Root-cause chain (file:line)
1. **`waitForOpen` can't detect an absent peer.** `WebSocketTransport` reports `"open"` the moment
   the socket connects to the *relay* (`ws.ts:68`, `this.socket.onopen = () => this.setState("open")`);
   the relay seats one lone peer. The guard at `e2eExperience.ts:657-663` ("peer may not have joined
   within 15s") **never fires** — the guest sails past with no host present.
2. **Nothing makes the host run its half when the guest clicks Run.** The companion channel is
   host→guest only (`RunStore.tsx:116-140`, `companion.ts`). A guest-initiated run has a live relay
   socket but zero snapshots arriving, so the rAF loop (`e2eExperience.ts:536-583`) never advances
   (`sample.tick` never reaches 420).
3. **The stall ends as "aborted mid-pass"** — the 180 s `runExperience` timeout (`RunStore.tsx:158`
   → `runner.ts:66-69`) or a user Abort fires the signal → `onAbort` (`e2eExperience.ts:514-518`)
   rejects → `failedResult()`. Verified: with no user action it fails at **180.4 s**.
4. **Determinism's failure is pure sequencing** — run-all aborts every not-yet-started experience
   `"aborted-before-start"` (`RunStore.tsx:207-223`); Determinism is last, so it always co-fails.
   Its own logic is synchronous/headless — unbreakable otherwise.

### Aggravating bugs (all verified live)
- **Companion budget was 30 s while E2E needs ~180 s** (`companion.ts:35` used the runner default;
  `RunStore.tsx:169` waited only 30 s for the guest). *(Fixed in commit `9c74a84`.)*
- **Dev StrictMode churn kills the control channel** — React double-mount makes the relay close the
  *surviving* peer with `4000 "peer left"` (`wsRelay.ts:103`); RunStore never reconnects. In every
  paired run, no `run`/`result` frames flowed and the merged result never contained `guestMerged`.
- **Clock-epoch bug corrupts the guest measurement even when both sides run** — guest samples with
  its own `performance.now()` (`e2eExperience.ts:539`) against host-stamped `Snapshot.hostTime`
  (`netFightScene.ts:93`); tab time-origins differ by seconds → renders in the past,
  `samplesAttributed: 0`, verdict **"0.0 ms … Band: good"** — a completed-but-meaningless result.

### Per-experiment verdict
Transport & Sim-snapshot: could not make them fail (solo, paired, run-all, demo-then-measure).
E2E: fails deterministically in paired mode per the chain; completes-with-garbage under clock skew;
solo mode unbreakable. Determinism: only run-all collateral. The `game.scene.start("E2EGuestInput")`
change is a non-issue (both automated paths stub the transport, so no double seq stream).

---

## B. Recommendations report (severity: **[B]** blocker / **[S]** should-fix / **[N]** nice)

### 1. Measurement accuracy / honesty
- **[B]** Guest felt-lag reports "0.0 ms / band good" with **zero** attributed samples —
  `computeDistribution([])` returns all-zeros (`metrics.ts:30-31`), scored `frameBand(0)→good`
  (`e2eExperience.ts:586-600`). Fix: fail when `sampleCount === 0`.
- **[B]** Banding text contradicts code — copy "bad ≥6 frames (100 ms)" (`e2eExperience.ts:272,600,683`)
  vs `frameBand` bands >3 frames bad (`:251-253`).
- **[S]** Solo-preview defaults make the headline "bad" by construction — 40±10 ms ×2 + 50 ms interp
  ≈ 5–8 frames (`e2eExperience.ts:91`). Separate "score is red" from "run failed".
- **[S]** p95/p99 from meaningless n — transport `samplesPerCell:10` (`transportExperience.ts:52`);
  solo E2E ~3–16 samples. Raise to ≥100; print `n=`; suppress p99 when n<~50.
- **[S]** Felt-lag attribution drops skipped presses on rAF skips (`feltLagTracker.ts:33-42`).
- **[S]** `InterpolationBuffer.sampleAt` early-`break`s assuming in-order arrival — breaks under
  `webrtc-unreliable` (`interpBuffer.ts:41-44`). Insert sorted by `hostTime`/`tick`.
- **[S]** Topology tags two-tabs-on-deployed-URL as WAN (`session.ts:24-33`).
- **[N]** `mergeGuestResult` hides a guest-side failure (`companion.ts:150-170`).
- **Sound, don't touch:** geo-mean+min-gate composite + axis split (`scoring.ts`); determinism
  harness's synchronous RNG patch/restore; peer-echo single-clock RTT.

### 2. Correctness bugs (beyond the four paired-path items)
- **[S]** Aborting E2E always takes Determinism down in run-all (`RunStore.tsx:206-223`) — leave
  un-started experiences `idle`, not `failed`.
- **[S]** `bootE2EGuestGame`/`bootGuestGame` ignore the abort signal → can leak a live Phaser game
  on abort mid-`Promise.all` (`bootE2E.ts:91-137`).
- **[S]** `runOne` has no in-flight guard; a double invocation overwrites the shared AbortController
  (`RunStore.tsx:179-194`).
- **[S]** Companion runs are unqueued and can overlap (`companion.ts:24-40`).
- **[S]** Relay "peer left" kill turns any single-tab refresh into a both-sides teardown
  (`wsRelay.ts:103`); no client reconnect.
- **[N]** Live-demo `start()` isn't abortable and races `stop()` (`E2EPage.tsx`).

### 3. Resource / perf / stability
- **[S]** WebGL context churn — 4 throwaway `Phaser.Game`s per E2E run (`Phaser.AUTO`), 2 more for
  snapshot; Chrome evicts oldest past ~16 ("too many active WebGL contexts") — the mechanism that
  blanks a long-running live-demo canvas. Use `Phaser.CANVAS` for offscreen measurement games and/or
  `WEBGL_lose_context` on destroy; reuse one pair across orientations.
- **[N]** Live demo recomputes `computeDistribution` over a growing array every rAF — throttle to ~4 Hz.

### 4. Deployment readiness (Render, two real machines)
- **[B]** WebRTC STUN-only, no TURN (`webrtc.ts:61`) → fails on symmetric/CGNAT (common on cellular).
  Config-injectable `iceServers` + a TURN server; label results with ICE candidate type.
- **[B]** Prod build depends on the monorepo-root `node_modules/phaser` (`vite.config.ts:19`) — a
  Render build that installs only inside the spike dir fails. Install root deps first, or vendor a
  pinned phaser dep.
- **[S]** ICE candidates arriving before `setRemoteDescription` are dropped (`webrtc.ts:216-224`) —
  buffer them.
- **[S]** Room state is in-memory single-instance (`rooms.ts:17-18`) — pin instance count to 1;
  restarts drop sessions.
- **[S]** The loss proxy fronts ALL traffic incl. `/signal` and `::control` (`lossProxy.ts`) —
  toggling loss can stall the control plane.
- **[S]** `npm start` → `tsx server/index.ts` requires `tsx` — **move `tsx` to dependencies** or
  precompile the server.
- **[N]** COOP/COEP parity is already correct (dev `vite.config.ts:37-40` = prod `staticServer.ts:31-37`)
  — don't touch. `wss:` derivation is correct for Render TLS.

### 5. Things that would undermine the headline verdict on a real 2-machine run
- **[B]** The paired flow has no working end-to-end choreography today (the cluster above) — a
  two-machine demo shows a host card that defers to a guest number that never arrives.
- **[S]** Persisted results mix modes invisibly (`RunStore.tsx:31-52`) — key by `(experienceId, mode)`.
- **[S]** "Run all" marks all four "running" up front (`RunStore.tsx:200`) — mark only the current one.

**Top 5:** (1) fix the paired choreography cluster; (2) zero-sample guard + clock-domain fix;
(3) TURN + ICE-candidate queue; (4) Render build (root-phaser + `tsx` prod dep); (5) banding
text/threshold + "red ≠ failed" presentation.
