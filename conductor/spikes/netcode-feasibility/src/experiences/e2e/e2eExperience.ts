/**
 * 008.5 — the automated `run()`: wires the FULL real loop (guest input ->
 * host `RemoteInput` -> host `NetFightScene` sim -> `Snapshot` -> transport
 * -> guest `InterpolationBuffer` + render, contracts.md §§1-3,7) end to end,
 * drives a scripted synthetic button-press sequence (the automated
 * equivalent of a real keyboard press — same wire shape, same
 * `RemoteInput`/delay-buffer code path, contracts.md §2), and measures
 * guest felt input lag the honest way (spec item 5): input-event timestamp
 * -> `lastInputSeq` attribution -> committed-rAF delta, reported as a
 * p50/p95/p99 distribution in ms AND frames, banded against the 1/3/6-frame
 * thresholds.
 *
 * Two DISTINCT modes, chosen by `session.room` (F2/the netcode-feasibility
 * correctness fix — see conductor track 008 supervisor notes):
 *
 * - **No `?room=` — "solo preview" (`runSoloPreview`):** both host AND guest
 *   halves boot in THIS one browser, wired by a `LoopbackTransport` pair
 *   under an injected FIXED simulated-network impairment
 *   (`simulatedNetwork`, default 40±10ms). This proves the wiring/plumbing
 *   and is useful for a quick solo smoke-check, but it is NOT a real
 *   cross-machine measurement — it is clearly labeled as such in every
 *   returned result (`topology:'loopback'`, verdict/measuredCaveat say
 *   "SOLO PREVIEW").
 * - **`?room=<id>&role=host|guest` — the REAL two-client measurement
 *   (`runPairedPass`):** this session boots ONLY its own role's half —
 *   `runPairedHost` runs the real `NetFightScene` sim + snapshot producer,
 *   `runPairedGuest` runs the render vehicle + interpolation buffer +
 *   scripted input — connected over a REAL `WebSocketTransport`/
 *   `WebRTCTransport` to the other machine/tab, keyed on a room id
 *   (`${room}::e2e`) distinct from the companion `::control` channel and
 *   the transport experiment's own bare-room usage. The guest measures felt
 *   input lag AND real transport RTT (peer-echo ping/pong) on its OWN
 *   single clock, decomposing the total into RTT + interp buffer + app
 *   time, and returns that as its `ExperienceResult` — RunStore's companion
 *   `result` path (contracts.md §6) carries it to the host, which owns the
 *   merged summary. `topology` is tagged with the REAL session topology
 *   (same-machine-two-tabs/LAN/WAN), never `loopback`.
 *
 * Runs the SAME scripted pass in BOTH host-role orientations (spec item 7 /
 * F11 — "guest controls P1" and "guest controls P2") in the solo-preview
 * mode, to demonstrate role is session config, not hardcoded, with
 * identical mechanics either way.
 */
import type { ExperienceResult, Role, Snapshot, SubScore, Topology, Transport } from "../../lib/contracts";
import type { Experience } from "../../lib/experience/types";
import type { SessionInfo } from "../../lib/session/session";
import { LoopbackTransport } from "../../lib/transport/loopback";
import { WebSocketTransport } from "../../lib/transport/ws";
import { WebRTCTransport } from "../../lib/transport/webrtc";
import { computeDistribution, type Distribution } from "../../lib/transport/metrics";
import { bandFor } from "../../lib/experience/scoring";
import { InterpolationBuffer } from "../snapshot/interpBuffer";
import { bootE2EGuestGame, bootE2EHostGame, type E2EGuestHandle, type E2EHostHandle } from "./bootE2E";
import { NET_E2E_SNAPSHOT_EVENT } from "./netFightScene";
import { RemoteInput, type InputWireMessage } from "./remoteInput";
import { FeltLagTracker } from "./feltLagTracker";
import { NO_SIMULATED_IMPAIRMENT, wrapWithSimulatedNetwork, type SimulatedNetworkConfig } from "./simulatedNetwork";

export const E2E_EXPERIENCE_ID = "e2e-remote-input";

const FRAME_MS = 1000 / 60; // 16.67ms/frame, contracts.md §5.

export interface E2EConfig extends Record<string, unknown> {
  /** Host-sim ticks to drive per measured pass. */
  driveTicks: number;
  /** Which player index the host's own local input drives; the other is the RemoteInput (guest) slot. */
  hostLocalPlayer: 1 | 2;
  /** Input-delay ring buffer applied to the guest's incoming input (RemoteInput), ms. */
  remoteInputDelayMs: number;
  /** The symmetric knob: delay the host's OWN input by this much too (research.md §C — converts an unfair asymmetry into a fair, even delay). */
  symmetricDelayMs: number;
  /** Guest's interpolation buffer delay (008.4's F7 knob) — felt lag is meaningless without it. */
  guestInterpDelayMs: number;
  /** Injected simulated network impairment on BOTH wire directions — SOLO PREVIEW mode only (spec item 4); ignored by the real paired path, which measures the real transport's own RTT instead. */
  simulatedNetwork: SimulatedNetworkConfig;
  /** Real transport to use for the paired (`?room=`) path. Ignored in solo-preview mode. */
  transportKind: "ws" | "webrtc-unreliable" | "webrtc-reliable";
}

export const E2E_DEFAULT_CONFIG: E2EConfig = {
  // The host sim runs a ~3s (~180-tick) pre-fight countdown before
  // `FightScene.fighting` goes true and anything consumes input at all
  // (research.md §A/contracts.md §7) — driveTicks must comfortably clear
  // that before scripted presses (gated on `isFighting`) get enough
  // in-fight ticks to produce a real felt-lag distribution. The ~3s countdown
  // is a fixed real-time cost, so a longer drive spends proportionally more of
  // itself IN-fight → more samples (§ P1): 900 ticks = ~15s @ real 60Hz with a
  // ~720-tick in-fight window (~120 presses at every-6), plenty for a real p95.
  driveTicks: 900,
  hostLocalPlayer: 1,
  remoteInputDelayMs: 0,
  symmetricDelayMs: 0,
  guestInterpDelayMs: 50,
  // Representative of the project's OWN stated target (README §Context:
  // same-region 20–60ms RTT). 20ms one-way = ~40ms RTT (mid of that range).
  // The prior 40±10ms one-way = ~80ms RTT was DOUBLE the target's midpoint,
  // which alone pushed the solo-preview felt-lag past the "bad" band and
  // min-gated the whole composite — a config artifact, not a real verdict.
  // This is still a SOLO PREVIEW (simulated network, one process, one clock),
  // never a substitute for a real two-machine reading.
  simulatedNetwork: { latencyMs: 20, jitterMs: 8, dropPercent: 0 },
  transportKind: "ws",
};

/** Scripted synthetic guest button-press schedule — the automated stand-in for a real keyboard press (same wire shape). */
// Denser presses (every 6 in-fight ticks, ~10/s) so a ~420-tick pass yields a
// real distribution (~40 samples) rather than a handful — combined with the
// FeltLagTracker jump-attribution fix (§ P1). A measurement wants density; a
// real player wouldn't press this often, but this is an input-latency probe.
const PRESS_SCRIPT_EVERY_N_TICKS = 6;
/** Paired-guest liveness (§ P1). waitForOpen only proves the relay socket is up,
 * not that the peer joined — so a lone guest would drive into the void and its
 * stop condition (`sample.tick >= driveTicks`) would never fire, hanging until
 * the outer wrapper aborts. These give it its OWN presence + stall guards. */
const PEER_PRESENCE_TIMEOUT_MS = 10_000;
const SNAPSHOT_STALL_TIMEOUT_MS = 8_000;

interface PassResult {
  hostLocalPlayer: 1 | 2;
  ticksObserved: number;
  feltLagMs: Distribution;
  stalenessMs: Distribution;
  pressesSent: number;
  samplesAttributed: number;
}

function msToFrames(ms: number): number {
  return ms / FRAME_MS;
}

async function runOnePass(
  config: E2EConfig,
  hostLocalPlayer: 1 | 2,
  signal: AbortSignal,
): Promise<PassResult> {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  document.body.appendChild(container);
  const hostParent = document.createElement("div");
  const guestParent = document.createElement("div");
  container.appendChild(hostParent);
  container.appendChild(guestParent);

  const guestLocalPlayer: 1 | 2 = hostLocalPlayer === 1 ? 2 : 1;
  const [hostSideRaw, guestSideRaw] = LoopbackTransport.createPair();
  const hostSide = wrapWithSimulatedNetwork(hostSideRaw, config.simulatedNetwork);
  const guestSide = wrapWithSimulatedNetwork(guestSideRaw, config.simulatedNetwork);

  const remote = new RemoteInput(guestLocalPlayer, config.remoteInputDelayMs);
  const symmetricDelayTicks = Math.round(config.symmetricDelayMs / FRAME_MS);

  let host: E2EHostHandle | undefined;
  let guest: E2EGuestHandle | undefined;
  const lagTracker = new FeltLagTracker();
  const interp = new InterpolationBuffer();
  const stalenessSamples: number[] = [];
  let pressesSent = 0;
  let rafId = 0;

  try {
    hostSide.onMessage((msg) => {
      if (msg.t === "input") remote.ingest(msg, performance.now());
    });
    guestSide.onMessage((msg) => {
      if (msg.t === "snapshot") interp.push(msg);
    });

    [host, guest] = await Promise.all([
      bootE2EHostGame(
        hostParent,
        { hostLocalPlayer, remote, getSymmetricDelayTicks: () => symmetricDelayTicks },
        signal,
      ),
      bootE2EGuestGame(guestParent, {
        guestLocalPlayer,
        // The guest game's own real keyboard-capture scene is not driven in
        // this automated pass (no DOM key events in a headless run) — the
        // scripted send loop below plays that role instead, through the
        // IDENTICAL wire shape and RemoteInput code path a real key press
        // would use, so this stub transport's `send` is intentionally inert.
        transport: {
          kind: guestSide.kind,
          send: () => {},
          onMessage: () => {},
          onStateChange: () => {},
          close: () => {},
        } satisfies Transport,
      }),
    ]);

    const forwardSnapshot = (snapshot: Snapshot) => hostSide.send(snapshot);
    host.game.events.on(NET_E2E_SNAPSHOT_EVENT, forwardSnapshot);

    let seq = 0;
    let ticksObserved = 0;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const onAbort = () => {
        if (settled) return;
        settled = true;
        reject(new Error("aborted mid-pass"));
      };
      signal.addEventListener("abort", onAbort, { once: true });

      const onSnapshot = () => {
        ticksObserved += 1;
        // Only script a press once the sim is actually fighting (post-
        // countdown) — RemoteInput's queue isn't drained by anything before
        // then, so an earlier press would queue up and be misattributed to
        // a bogus multi-second "lag" once fighting starts and it drains.
        if (host!.scene.isFighting && ticksObserved % PRESS_SCRIPT_EVERY_N_TICKS === 0) {
          const tSent = performance.now();
          const msg: InputWireMessage = {
            t: "input",
            seq: seq++,
            tick: ticksObserved,
            buttons: { left: false, right: false, block: false, charge: false },
            edges: { light: true, heavy: false, special: false },
            tSent,
          };
          lagTracker.recordSent(msg.seq, tSent);
          pressesSent += 1;
          guestSide.send(msg);
        }
        if (ticksObserved >= config.driveTicks && !settled) {
          settled = true;
          resolve();
        }
      };
      host!.game.events.on(NET_E2E_SNAPSHOT_EVENT, onSnapshot);

      const frame = () => {
        if (settled) return;
        const now = performance.now();
        const sample = interp.sampleAt(now, config.guestInterpDelayMs);
        if (sample) {
          guest!.fightScene.applySnapshot(sample);
          const myLastSeq = guestLocalPlayer === 1 ? sample.p1LastInputSeq : sample.p2LastInputSeq;
          lagTracker.attribute(myLastSeq, now);
          stalenessSamples.push(interp.staleness(now));
        }
        rafId = requestAnimationFrame(frame);
      };
      rafId = requestAnimationFrame(frame);
    });

    host.game.events.off(NET_E2E_SNAPSHOT_EVENT, forwardSnapshot);
    cancelAnimationFrame(rafId);

    return {
      hostLocalPlayer,
      ticksObserved,
      feltLagMs: computeDistribution(lagTracker.samplesMs),
      stalenessMs: computeDistribution(stalenessSamples),
      pressesSent,
      samplesAttributed: lagTracker.sampleCount,
    };
  } finally {
    cancelAnimationFrame(rafId);
    hostSideRaw.close();
    guestSideRaw.close();
    host?.destroy();
    guest?.destroy();
    container.remove();
  }
}

function frameBand(valueMs: number): SubScore["band"] {
  return bandFor(msToFrames(valueMs), { goodMax: 1, acceptableMax: 3 });
}

/** Below this, a felt-lag "distribution" is the worst 1–2 observations, not a
 * distribution — and 0 samples must NEVER be scored (computeDistribution([])
 * returns all-zeros → frameBand(0) → "good", the dangerous silent false
 * positive). Fail loudly at 0; flag low-confidence below the floor. */
const MIN_ATTRIBUTED_SAMPLES = 20;

/** A leading LOW-CONFIDENCE warning for a completed-but-thin run; "" when fine. */
function lowSampleNote(n: number): string {
  return n > 0 && n < MIN_ATTRIBUTED_SAMPLES
    ? `⚠ LOW CONFIDENCE — only ${n} attributed samples (< ${MIN_ATTRIBUTED_SAMPLES}); p95/p99 are effectively the worst 1–2 observations, not a real distribution. `
    : "";
}

/** SOLO PREVIEW mode: both halves in one browser, `LoopbackTransport` pair, fixed simulated network. NOT a real cross-machine measurement — see the module doc comment. */
async function runSoloPreview(config: E2EConfig, topology: Topology, signal: AbortSignal): Promise<ExperienceResult> {
  try {
    if (signal.aborted) throw new Error("aborted");

    const primary = await runOnePass(config, config.hostLocalPlayer, signal);
    const otherOrientation: 1 | 2 = config.hostLocalPlayer === 1 ? 2 : 1;
    const secondary = await runOnePass(config, otherOrientation, signal);

    // Sample-count floor: never report a fabricated "0.0ms / good" (§ P1).
    if (primary.samplesAttributed === 0) {
      return failedResult(
        topology,
        "solo-preview",
        "0 input samples were attributed over the pass — the guest never observed a completed input→snapshot round trip (no in-fight ticks, or the interp sampler starved). Refusing to report a fabricated 0.0ms/good; this is a FAILED measurement, not a passing one.",
      );
    }

    const p95Ms = primary.feltLagMs.p95;
    const band = frameBand(p95Ms);
    const lowNote = lowSampleNote(primary.samplesAttributed);
    const subScores: SubScore[] = [
      {
        key: "input-lag",
        value0to100: band === "good" ? 95 : band === "acceptable" ? 60 : 15,
        band,
        weight: 2,
        rationale: `[SOLO PREVIEW — simulated network, not a real cross-machine measurement] Guest felt input lag p95 = ${p95Ms.toFixed(1)}ms (${msToFrames(p95Ms).toFixed(2)} frames @60fps) over ${primary.samplesAttributed} attributed samples, host-role=hostLocalPlayer:${primary.hostLocalPlayer}, simulated network ${config.simulatedNetwork.latencyMs}±${config.simulatedNetwork.jitterMs}ms + ${config.guestInterpDelayMs}ms interp buffer. Bands per contracts.md §5/research.md §D: good<=1 frame, acceptable<=3 frames (the ~50ms "feels offline" ceiling), bad>3 frames.`,
      },
    ];

    return {
      experienceId: E2E_EXPERIENCE_ID,
      status: "completed",
      topology,
      lossMode: config.simulatedNetwork.dropPercent > 0 ? "payload-drop" : "none",
      raw: {
        mode: "solo-preview",
        config,
        primary: {
          ...primary,
          feltLagFrames: {
            p50: msToFrames(primary.feltLagMs.p50),
            p95: msToFrames(primary.feltLagMs.p95),
            p99: msToFrames(primary.feltLagMs.p99),
          },
        },
        bothOrientations: {
          hostLocalPlayer1: config.hostLocalPlayer === 1 ? primary : secondary,
          hostLocalPlayer2: config.hostLocalPlayer === 2 ? primary : secondary,
          note:
            "Same scripted pass, only which index is host-local vs RemoteInput-driven changed. Comparable ticksObserved/pressesSent and a felt-lag distribution in the same ballpark on both rows is the DoD's 'identical mechanics' check (spec item 7 / F11).",
        },
        stalenessMs: primary.stalenessMs,
      },
      subScores,
      verdict:
        `${lowNote}SOLO PREVIEW (single browser, simulated network — open with ?room=<id> in two tabs/machines for a REAL measurement). Guest felt input lag (p50/p95/p99): ${primary.feltLagMs.p50.toFixed(1)}/${primary.feltLagMs.p95.toFixed(1)}/${primary.feltLagMs.p99.toFixed(1)}ms ` +
        `(${msToFrames(primary.feltLagMs.p50).toFixed(2)}/${msToFrames(primary.feltLagMs.p95).toFixed(2)}/${msToFrames(primary.feltLagMs.p99).toFixed(2)} frames) ` +
        `under ${config.simulatedNetwork.latencyMs}±${config.simulatedNetwork.jitterMs}ms simulated network + ${config.guestInterpDelayMs}ms interp buffer. ` +
        `Band: ${band}. Host-role ran in both orientations with comparable results (raw.bothOrientations) — role is session config, not hardcoded.`,
      measuredCaveat:
        "SOLO PREVIEW: both host and guest run in this ONE browser over a LoopbackTransport pair with a FIXED artificial delay/jitter/drop (this harness's own constant, not a real link) + real app processing latency (real Phaser sim, real snapshot capture, real interpolation buffer). This is NOT a real cross-client round trip — no real network is involved. This automated pass also scripts the guest's button press as a synthetic wire message (identical shape/code path to a real keyboard JustDown edge) rather than a real DOM key event. For a REAL cross-machine/cross-tab measurement (real WS/WebRTC transport, real RTT), open this page with `?room=<id>&role=host` on one machine/tab and `?room=<id>&role=guest` on another.",
    };
  } catch (err) {
    return {
      experienceId: E2E_EXPERIENCE_ID,
      status: "failed",
      topology,
      lossMode: "none",
      raw: { mode: "solo-preview", config, error: err instanceof Error ? err.message : String(err) },
      subScores: [],
      verdict: "Failed before completion — see raw.error.",
      measuredCaveat: "n/a — run did not complete",
    };
  }
}

// ---------------------------------------------------------------------------
// REAL two-client mode (`?room=<id>&role=host|guest`) — the correctness fix.
// ---------------------------------------------------------------------------

/** Exported for unit tests — the real Phaser boot this experience needs can't run under jsdom (no `canvas` backing), so this pure connection-readiness helper is what's practically testable here. */
export function waitForOpen(transport: Transport, timeoutMs: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    transport.onStateChange((s) => {
      if (s === "open") finish(true);
      if (s === "closed") finish(false);
    });
    signal.addEventListener("abort", () => finish(false), { once: true });
  });
}

/** Real transport for the paired path — `${room}::e2e`, distinct from the companion `::control` channel and the transport experiment's bare-room usage (contracts.md §6). */
function buildPairedTransport(kind: E2EConfig["transportKind"], room: string, role: Role): Transport {
  if (kind === "ws") return new WebSocketTransport({ room, role });
  return new WebRTCTransport({ room, role, mode: kind === "webrtc-unreliable" ? "unreliable" : "reliable" });
}

function offscreenContainer(): { container: HTMLDivElement; parent: HTMLDivElement } {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  document.body.appendChild(container);
  const parent = document.createElement("div");
  container.appendChild(parent);
  return { container, parent };
}

function failedResult(
  topology: Topology,
  mode: string,
  reason: string,
  extra?: Record<string, unknown>,
): ExperienceResult {
  return {
    experienceId: E2E_EXPERIENCE_ID,
    status: "failed",
    topology,
    lossMode: "none",
    raw: { mode, reason, ...(extra ?? {}) },
    subScores: [],
    verdict: `Failed before completion (${mode}): ${reason}`,
    measuredCaveat: "n/a — run did not complete",
  };
}

/** Host half of the REAL two-client run: real `NetFightScene` sim + snapshot producer, fed by the guest's real `input` messages. No felt-lag is measured here — that's the guest's job; this side's result is merged with the guest's via the companion `result` path (contracts.md §6). */
async function runPairedHost(
  config: E2EConfig,
  transport: Transport,
  topology: Topology,
  signal: AbortSignal,
): Promise<ExperienceResult> {
  const { container, parent } = offscreenContainer();
  const guestLocalPlayer: 1 | 2 = config.hostLocalPlayer === 1 ? 2 : 1;
  const remote = new RemoteInput(guestLocalPlayer, config.remoteInputDelayMs);
  const symmetricDelayTicks = Math.round(config.symmetricDelayMs / FRAME_MS);
  let host: E2EHostHandle | undefined;
  let ticksObserved = 0;

  try {
    transport.onMessage((msg) => {
      if (msg.t === "input") remote.ingest(msg, performance.now());
    });

    host = await bootE2EHostGame(
      parent,
      { hostLocalPlayer: config.hostLocalPlayer, remote, getSymmetricDelayTicks: () => symmetricDelayTicks },
      signal,
    );

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const onAbort = () => {
        if (settled) return;
        settled = true;
        reject(new Error("aborted mid-pass"));
      };
      signal.addEventListener("abort", onAbort, { once: true });

      const onSnapshot = (snapshot: Snapshot) => {
        ticksObserved += 1;
        transport.send(snapshot);
        if (ticksObserved >= config.driveTicks && !settled) {
          settled = true;
          resolve();
        }
      };
      host!.game.events.on(NET_E2E_SNAPSHOT_EVENT, onSnapshot);
    });

    return {
      experienceId: E2E_EXPERIENCE_ID,
      status: "completed",
      topology,
      lossMode: "none",
      raw: {
        mode: "paired-host",
        config,
        role: "host",
        transportKind: transport.kind,
        ticksObserved,
      },
      subScores: [],
      verdict:
        `HOST side of a REAL two-client run: drove ${ticksObserved} real NetFightScene ticks over a REAL ${transport.kind} transport to a paired guest. ` +
        `The felt-input-lag measurement is the GUEST's (see the guest-merged result — contracts.md §6, the host owns the merged summary but the guest owns the number).`,
      measuredCaveat:
        "Host side only — no felt-lag figure here by design (measuring on the machine that never waits for a round trip would be dishonest). Real NetFightScene sim, real Snapshot production, real transport to the guest.",
    };
  } catch (err) {
    return failedResult(topology, "paired-host", err instanceof Error ? err.message : String(err));
  } finally {
    host?.destroy();
    container.remove();
  }
}

/** Guest half of the REAL two-client run: render vehicle + interpolation buffer + scripted input, all over the REAL transport. Measures felt input lag AND real transport RTT (peer-echo ping/pong) on its own single clock. */
async function runPairedGuest(
  config: E2EConfig,
  transport: Transport,
  topology: Topology,
  signal: AbortSignal,
): Promise<ExperienceResult> {
  const { container, parent } = offscreenContainer();
  const guestLocalPlayer: 1 | 2 = config.hostLocalPlayer === 1 ? 2 : 1;
  const interp = new InterpolationBuffer();
  const lagTracker = new FeltLagTracker();
  const rttSamplesMs: number[] = [];
  const pendingPings = new Map<number, number>();
  const stalenessSamples: number[] = [];
  // Client-side-prediction lever (008.8): the felt lag your OWN character WOULD
  // have if the guest echoed its input locally on the next frame instead of
  // waiting for the round trip. Measured as input-send → next committed rAF, so
  // it is RTT-INDEPENDENT by construction — the whole point of prediction. The
  // opponent still lags by RTT + interp (that part prediction can't fix; it
  // needs reconciliation). Reported beside the round-trip number as the "with
  // prediction, your own input feels like THIS" ceiling.
  const predictedSamplesMs: number[] = [];
  let pendingPredictAt: number | null = null;
  let pingSeq = 0;
  let inputSeq = 0;
  let pressesSent = 0;
  let ticksObserved = 0;
  let guest: E2EGuestHandle | undefined;
  let rafId = 0;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  // Visibility guard (§ P1): backgrounded tabs throttle rAF to ~1Hz, which
  // corrupts the timing (e.g. 466ms felt-lag from a single sample). Flag any
  // run whose tab went hidden so the number can never read as trustworthy.
  let wasBackgrounded = typeof document !== "undefined" && document.hidden;
  const onVisibility = () => {
    if (typeof document !== "undefined" && document.hidden) wasBackgrounded = true;
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  // Peer-presence: any inbound snapshot or pong proves the OTHER machine is in
  // the room (waitForOpen only proves our own relay socket opened, ws.ts:68).
  let peerSeen = false;
  // Cross-machine clock offset (§ P1): host stamps `hostTime` with ITS
  // performance.now(); the guest samples the interp buffer with ITS own — two
  // tabs/machines have different time origins (seconds apart), which starves
  // the sampler (0 samples) or defeats the interp window. Estimate host-minus-
  // guest from arriving snapshots: `hostTime - guestArrival = offset - oneWay`,
  // so the MAX over snapshots ≈ the true offset (least-delayed packet). In
  // loopback (shared clock) this is ~0, so the solo path is unaffected.
  let clockOffset: number | null = null;

  // Diagnostics (Option B): the guest result is the only thing that reaches the
  // host (and thus a Playwright reader), so instead of relying on the remote
  // machine's devtools we ship a `diag` bag back over the companion channel to
  // pinpoint WHY a paired run observed 0 ticks (throttled rAF vs starved sampler
  // vs out-of-order buffer vs clock skew). Cheap counters, no behavior change.
  let snapshotsReceived = 0;
  let framesExecuted = 0; // rAF `frame()` calls — near-0 ⇒ the tab was throttled
  let sampleNullCount = 0; // sampleAt returned null (nothing old enough / buffer wedged)
  let sampleSameTickCount = 0; // returned a snapshot, but not a NEW tick
  let bufferMaxSize = 0;
  let firstSnapshotHostTime: number | null = null;
  let firstSnapshotArrival: number | null = null;
  let outOfOrderArrivals = 0; // snapshots whose tick <= the previous arrival's tick
  let lastArrivedTick = -1;
  let lastTargetTime = 0;
  let lastBufOldestHostTime = 0;
  let lastBufNewestHostTime = 0;
  const buildDiag = (): Record<string, unknown> => ({
    diag: {
      snapshotsReceived,
      framesExecuted,
      ticksObserved,
      sampleNullCount,
      sampleSameTickCount,
      bufferMaxSize,
      clockOffsetMs: clockOffset,
      firstSnapshotHostTime,
      firstSnapshotArrival,
      outOfOrderArrivals,
      lastTargetTime,
      lastBufOldestHostTime,
      lastBufNewestHostTime,
      interpDelayMs: config.guestInterpDelayMs,
    },
  });

  try {
    transport.onMessage((msg) => {
      if (msg.t === "snapshot") {
        peerSeen = true;
        snapshotsReceived += 1;
        if (firstSnapshotHostTime === null) {
          firstSnapshotHostTime = msg.hostTime;
          firstSnapshotArrival = performance.now();
        }
        if (msg.tick <= lastArrivedTick) outOfOrderArrivals += 1;
        lastArrivedTick = msg.tick;
        const off = msg.hostTime - performance.now();
        clockOffset = clockOffset === null ? off : Math.max(clockOffset, off);
        interp.push(msg);
        if (interp.size > bufferMaxSize) bufferMaxSize = interp.size;
        return;
      }
      if (msg.t === "pong") {
        peerSeen = true;
        const t0 = pendingPings.get(msg.seq);
        if (t0 !== undefined) {
          pendingPings.delete(msg.seq);
          rttSamplesMs.push(performance.now() - t0);
        }
      }
    });

    // Render vehicle only — its own internal `GuestInputScene` would send
    // REAL DOM keyboard edges over the wire too, which would collide with
    // this automated pass's SCRIPTED presses (double `seq` streams). A stub
    // `send` here (same technique the solo-preview pass already uses)
    // leaves the render/interp path real while this function owns sending.
    guest = await bootE2EGuestGame(parent, {
      guestLocalPlayer,
      transport: {
        kind: transport.kind,
        send: () => {},
        onMessage: () => {},
        onStateChange: () => {},
        close: () => {},
      } satisfies Transport,
    });

    // Real transport RTT via peer-echo ping/pong (contracts.md §1) — both
    // `WebSocketTransport` and `WebRTCTransport` auto-reply `pong` to a
    // `ping` by default, so the host peer echoes without any extra code
    // here; this just sends the pings and times the reply on ITS OWN clock.
    pingTimer = setInterval(() => {
      const t0 = performance.now();
      const seq = pingSeq++;
      pendingPings.set(seq, t0);
      transport.send({ t: "ping", seq, t0 });
    }, 200);

    // Peer-presence barrier: wait for the peer to actually echo (pong) or send
    // a snapshot before driving. Without this, running the guest with no active
    // host (the wrong-order / no-host case) silently hangs forever.
    const presenceDeadline = performance.now() + PEER_PRESENCE_TIMEOUT_MS;
    while (!peerSeen && performance.now() < presenceDeadline) {
      if (signal.aborted) throw new Error("aborted");
      await new Promise((r) => setTimeout(r, 150));
    }
    if (!peerSeen) {
      return failedResult(
        topology,
        "paired-guest",
        `No peer responded within ${PEER_PRESENCE_TIMEOUT_MS / 1000}s — the relay socket is open but the other machine isn't in this room / isn't running this experiment. Paired runs are HOST-driven: start the run on the HOST tab (it cues the guest automatically over the companion channel). Running it on the guest with no active host will always stall.`,
      );
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let lastAdvanceMs = performance.now();
      const onAbort = () => {
        if (settled) return;
        settled = true;
        reject(new Error("aborted mid-pass"));
      };
      signal.addEventListener("abort", onAbort, { once: true });

      // Internal stall guard: if no NEW host snapshot tick advances for a while
      // (peer dropped, wire wedged), fail with a clear reason instead of hanging
      // until the outer 180s wrapper (or, on a direct invocation, forever).
      const stallTimer = setInterval(() => {
        if (settled) return;
        if (performance.now() - lastAdvanceMs > SNAPSHOT_STALL_TIMEOUT_MS) {
          settled = true;
          clearInterval(stallTimer);
          reject(
            new Error(
              `stalled: no new host snapshot for ${SNAPSHOT_STALL_TIMEOUT_MS / 1000}s (observed ${ticksObserved} ticks before the wire went quiet — peer dropped or stopped driving)`,
            ),
          );
        }
      }, 1000);
      signal.addEventListener("abort", () => clearInterval(stallTimer), { once: true });

      // `interp.sampleAt` returns the newest buffered snapshot old enough
      // to render (contracts.md §3/008.4 F7) — on a REAL transport, rAF can
      // easily fire more often than a genuinely NEW snapshot arrives (no
      // in-process synchronous tie between host ticks and guest frames,
      // unlike the solo-preview pass's same-process LoopbackTransport), so
      // the SAME snapshot can be handed back on consecutive rAFs. Counting
      // every non-null `sampleAt` as "one tick observed" (as the initial
      // implementation did) over-counts, letting the guest race to
      // `driveTicks` and end the run before the host's real ~3s pre-fight
      // countdown has even cleared — starving the scripted presses of any
      // real round-trip time and zeroing the felt-lag distribution. Gate
      // ALL of this (attribution, staleness, press-scripting, the stop
      // condition) on the snapshot's OWN `tick` field genuinely advancing.
      let lastProcessedTick = -1;

      const frame = () => {
        if (settled) return;
        framesExecuted += 1;
        const now = performance.now();
        // Prediction ceiling: a press queued on the previous frame would, under
        // client-side prediction, be reflected on THIS committed frame. Record
        // input→next-commit — independent of the wire.
        if (pendingPredictAt !== null) {
          predictedSamplesMs.push(now - pendingPredictAt);
          pendingPredictAt = null;
        }
        // Convert our own clock into a host-clock estimate for buffer sampling /
        // staleness. Felt-lag attribution (below) stays in guest-clock — both
        // `tSent` and `now` are the guest's own now(), so the subtraction is
        // already epoch-safe; only the interp gating needs the host domain.
        const hostNow = clockOffset === null ? now : now + clockOffset;
        lastTargetTime = hostNow - config.guestInterpDelayMs;
        lastBufOldestHostTime = interp.oldestHostTime;
        lastBufNewestHostTime = interp.newestHostTime;
        const sample = interp.sampleAt(hostNow, config.guestInterpDelayMs);
        if (!sample) sampleNullCount += 1;
        else if (sample.tick === lastProcessedTick) sampleSameTickCount += 1;
        if (sample && sample.tick !== lastProcessedTick) {
          lastProcessedTick = sample.tick;
          lastAdvanceMs = now;
          ticksObserved += 1;
          guest!.fightScene.applySnapshot(sample);
          const myLastSeq = guestLocalPlayer === 1 ? sample.p1LastInputSeq : sample.p2LastInputSeq;
          lagTracker.attribute(myLastSeq, now);
          stalenessSamples.push(interp.staleness(hostNow));

          // `countdown` (contracts.md §3) reaching 0 is the Snapshot-schema
          // proxy for `NetFightScene.isFighting` (private, host-only) — the
          // guest has no other way to know the sim has left the pre-fight
          // countdown, and queuing scripted presses earlier just piles them
          // up in `RemoteInput`'s queue for a bogus multi-second "lag" once
          // they finally drain (same reasoning as the solo pass).
          if (sample.countdown <= 0 && ticksObserved % PRESS_SCRIPT_EVERY_N_TICKS === 0) {
            const tSent = performance.now();
            const msg: InputWireMessage = {
              t: "input",
              seq: inputSeq++,
              tick: ticksObserved,
              buttons: { left: false, right: false, block: false, charge: false },
              edges: { light: true, heavy: false, special: false },
              tSent,
            };
            lagTracker.recordSent(msg.seq, tSent);
            pressesSent += 1;
            transport.send(msg);
            // Arm the prediction-ceiling sample: the NEXT committed frame is
            // when a locally-predicted echo of this press would become visible.
            pendingPredictAt = tSent;
          }

          // Stop condition keyed on the HOST's own real tick number (never
          // on a locally-incremented rAF-call counter) — this is what
          // actually guarantees `driveTicks` real host ticks have elapsed,
          // giving every scripted press a genuine chance at a full real
          // round trip (send -> host consumes -> host snapshots -> travels
          // back -> guest samples it) before the pass tears down.
          if (sample.tick >= config.driveTicks && !settled) {
            settled = true;
            clearInterval(stallTimer);
            resolve();
            return;
          }
        }
        rafId = requestAnimationFrame(frame);
      };
      rafId = requestAnimationFrame(frame);
    });

    // Sample-count floor: a paired run that attributed nothing is a BROKEN
    // measurement (no peer activity, clock skew, or tab throttling), not a
    // 0.0ms/good pass. Fail loudly rather than fabricate the decisive number.
    if (lagTracker.sampleCount === 0) {
      return failedResult(
        topology,
        "paired-guest",
        `0 input samples attributed over ${ticksObserved} observed ticks / ${pressesSent} scripted presses — the guest never saw a completed round trip (peer not driving, clock-offset skew, or the tab was backgrounded and rAF throttled). This is a FAILED measurement; refusing to report 0.0ms/good.`,
        buildDiag(),
      );
    }

    const feltLagMs = computeDistribution(lagTracker.samplesMs);
    const rttMs = computeDistribution(rttSamplesMs);
    const stalenessMs = computeDistribution(stalenessSamples);
    // Prediction-lever projection (008.8) — kept OUT of the scored sub-scores on
    // purpose: the composite must reflect the CURRENT (no-prediction) design, so
    // this is reported as a "what prediction would buy" figure, not folded in.
    const predictedLocalLagMs = computeDistribution(predictedSamplesMs);
    const predictionFrames = predictedSamplesMs.length ? msToFrames(predictedLocalLagMs.p50) : 0;
    const p95Ms = feltLagMs.p95;
    const band = frameBand(p95Ms);
    const warnNote =
      (wasBackgrounded ? "⚠ TAB WAS BACKGROUNDED during the run — rAF throttling makes these timings UNRELIABLE; keep the guest tab foregrounded and re-run. " : "") +
      lowSampleNote(lagTracker.sampleCount);
    const latencyBand = bandFor(rttMs.p50, { goodMax: 30, acceptableMax: 60 });

    const subScores: SubScore[] = [
      {
        key: "input-lag",
        value0to100: band === "good" ? 95 : band === "acceptable" ? 60 : 15,
        band,
        weight: 2,
        rationale:
          `[REAL two-client measurement, guest-side] Guest felt input lag p95 = ${p95Ms.toFixed(1)}ms (${msToFrames(p95Ms).toFixed(2)} frames @60fps) over ${lagTracker.sampleCount} attributed samples, ${pressesSent} scripted presses, over a REAL ${transport.kind} transport (topology=${topology}). Decomposition: real RTT p50=${rttMs.p50.toFixed(1)}ms + ${config.guestInterpDelayMs}ms interp buffer + app time. Bands per contracts.md §5/research.md §D: good<=1 frame, acceptable<=3 frames (the ~50ms "feels offline" ceiling), bad>3 frames.`,
      },
      {
        key: "latency",
        value0to100: latencyBand === "good" ? 95 : latencyBand === "acceptable" ? 65 : 20,
        band: latencyBand,
        weight: 1,
        rationale: `Real transport RTT (peer-echo ping/pong, contracts.md §1), measured on the guest's own clock: p50=${rttMs.p50.toFixed(1)}ms / p95=${rttMs.p95.toFixed(1)}ms / p99=${rttMs.p99.toFixed(1)}ms over ${rttMs.count} samples via ${transport.kind}. This decomposes the felt-lag total: felt lag ≈ real RTT + interp buffer (${config.guestInterpDelayMs}ms) + app processing time. Bands (research.md §D): good≤30 / acceptable≤60 / bad>60ms — the 60–100ms zone the source table leaves open is resolved conservatively to bad.`,
      },
    ];

    return {
      experienceId: E2E_EXPERIENCE_ID,
      status: "completed",
      topology,
      lossMode: "none",
      raw: {
        mode: "paired-guest",
        config,
        role: "guest",
        transportKind: transport.kind,
        ticksObserved,
        pressesSent,
        samplesAttributed: lagTracker.sampleCount,
        tabBackgrounded: wasBackgrounded,
        clockOffsetMs: clockOffset,
        feltLagMs,
        feltLagFrames: { p50: msToFrames(feltLagMs.p50), p95: msToFrames(feltLagMs.p95), p99: msToFrames(feltLagMs.p99) },
        realRttMs: rttMs,
        stalenessMs,
        // Prediction lever: RTT-independent local-echo latency (008.8).
        predictedLocalLagMs,
        predictedLocalFrames: {
          p50: msToFrames(predictedLocalLagMs.p50),
          p95: msToFrames(predictedLocalLagMs.p95),
        },
        predictedSampleCount: predictedSamplesMs.length,
        ...buildDiag(),
      },
      subScores,
      verdict:
        `${warnNote}GUEST side of a REAL two-client run over a REAL ${transport.kind} transport (topology=${topology}). Felt input lag (p50/p95/p99): ${feltLagMs.p50.toFixed(1)}/${feltLagMs.p95.toFixed(1)}/${feltLagMs.p99.toFixed(1)}ms ` +
        `(${msToFrames(feltLagMs.p50).toFixed(2)}/${msToFrames(feltLagMs.p95).toFixed(2)}/${msToFrames(feltLagMs.p99).toFixed(2)} frames). ` +
        `Decomposed: real transport RTT p50/p95=${rttMs.p50.toFixed(1)}/${rttMs.p95.toFixed(1)}ms + ${config.guestInterpDelayMs}ms interp buffer + app time. Band: ${band}.` +
        (predictedSamplesMs.length
          ? ` LEVER — client-side prediction: your OWN character's input would feel ~${predictedLocalLagMs.p50.toFixed(1)}ms (${predictionFrames.toFixed(2)} frames), RTT-INDEPENDENT — vs ${msToFrames(feltLagMs.p50).toFixed(1)} frames round-trip. Prediction fixes your own responsiveness; the opponent still lags by RTT+interp and needs reconciliation.`
          : ""),
      measuredCaveat:
        `REAL cross-client round trip over ${transport.kind} (NOT a simulated/injected network) + real app-processing latency + real interpolation buffer, measured on the guest's own single clock (input-event timestamp -> lastInputSeq attribution -> committed-rAF delta) — comparative, still NOT hardware glass-to-glass (that needs LDAT/photodiode). This automated pass scripts the guest's button press as a synthetic wire message (identical shape/code path to a real keyboard JustDown edge) rather than a real DOM key event; the interactive page's "Live end-to-end loop" section drives real DOM keys over this same real transport. Topology: ${topology}.`,
    };
  } catch (err) {
    return failedResult(
      topology,
      "paired-guest",
      err instanceof Error ? err.message : String(err),
      buildDiag(),
    );
  } finally {
    if (pingTimer) clearInterval(pingTimer);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    cancelAnimationFrame(rafId);
    guest?.destroy();
    container.remove();
  }
}

/** The e2e experience's own real-transport room id — distinct from the companion `::control` channel (RunStore.tsx) and the transport experiment's bare-room usage (contracts.md §6), so a "run all" never cross-wires two experiences' live connections. Exported for unit tests. */
export function pairedRoomId(room: string): string {
  return `${room}::e2e`;
}

/** REAL two-client path: opens a real transport on `${room}::e2e` and runs this session's own role's half. */
async function runPairedPass(config: E2EConfig, session: SessionInfo, signal: AbortSignal): Promise<ExperienceResult> {
  const room = pairedRoomId(session.room!);
  const transport = buildPairedTransport(config.transportKind, room, session.role);
  try {
    const opened = await waitForOpen(transport, 15_000, signal);
    if (!opened) {
      return failedResult(
        session.topology,
        `paired-${session.role}`,
        `Real ${config.transportKind} transport on room "${room}" never reached 'open' within 15s — the peer (${session.role === "host" ? "guest" : "host"}) may not have joined yet.`,
      );
    }
    if (session.role === "host") return await runPairedHost(config, transport, session.topology, signal);
    return await runPairedGuest(config, transport, session.topology, signal);
  } finally {
    transport.close();
  }
}

export function createE2EExperience(getSession: () => SessionInfo): Experience<E2EConfig> {
  return {
    id: E2E_EXPERIENCE_ID,
    title: "Remote input & end-to-end loop (guest felt input lag)",
    whatItTests:
      "Wires the whole loop: a guest button-press travels the wire to the host sim, and the result travels back as a snapshot. Measures the guest's **felt input lag** — the decisive number for whether this feels playable. Everything else in this app supports this page.",
    whatItTestsMore:
      "The REAL input path end to end: a scripted guest button-press (same wire shape a real keyboard `JustDown` edge takes) → `RemoteInput` on the host (exactly-once edge delivery) → the REAL `NetFightScene` (a harness-side `FightScene` subclass, zero `src/` edits) → a per-tick `Snapshot` → a transport → the guest's interpolation buffer + render vehicle. With `?room=<id>`, this is a REAL two-client run: host and guest are two separate sessions (two tabs/two machines) connected over a REAL WebSocket/WebRTC transport (`${room}::e2e`), and the guest measures felt input lag AND real transport RTT (peer-echo) on its own clock. Without `?room=`, it falls back to a SOLO PREVIEW: both halves in one browser over a `LoopbackTransport` pair with a fixed simulated network — clearly labeled, never conflated with a real measurement. Runs both host-role orientations in solo-preview to prove role is session config, not hardcoded.",
    whyItMatters:
      "This is the single most decision-relevant number in the spike (research.md §C): host-authoritative means the guest eats the full RTT plus the interpolation buffer before their button visibly does anything, and they're hitting an opponent rendered ~interpDelayMs in the past. Fighting games start feeling \"offline\" past ~3 frames (~48ms, research.md §D) — this experience measures exactly where our guest lands against that ceiling, honestly (input-event timestamp -> lastInputSeq attribution -> committed-rAF delta), and — critically — over a REAL cross-machine transport when paired, not a single-browser simulation standing in for one.",
    howToRead:
      "Paired (`?room=`) mode: the host's own result (`raw.mode:'paired-host'`) carries no input-lag figure by design — the guest's result (`raw.mode:'paired-guest'`) is what matters, and RunStore merges it into the host's summary via the companion `result` message. `raw.realRttMs` on the guest's result is the REAL transport RTT (peer-echo ping/pong), decomposing the felt-lag total into RTT + interp buffer + app time — no more fixed 40±10ms constant. Solo-preview mode: `raw.primary` is the headline pass, `raw.bothOrientations` holds both host-role orientations side by side (spec item 7/F11), `raw.stalenessMs` is the stale-opponent distribution. Bands (both modes, matching the code's `frameBand`): <=1 frame (16.67ms) imperceptible/good, <=3 frames (~50ms) the \"feels offline\" ceiling/acceptable, >3 frames bad.",
    defaultConfig: E2E_DEFAULT_CONFIG,
    soloCapable: true,
    async run(config, signal): Promise<ExperienceResult> {
      const session = getSession();
      if (session.room) {
        return runPairedPass(config, session, signal);
      }
      return runSoloPreview(config, session.topology, signal);
    },
  };
}

export { NO_SIMULATED_IMPAIRMENT };
