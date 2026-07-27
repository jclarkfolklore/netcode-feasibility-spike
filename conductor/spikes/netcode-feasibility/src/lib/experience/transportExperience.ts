import type { ExperienceResult, LossMode, SubScore, Topology, Transport, WireMessage } from "../contracts";
import type { Experience } from "./types";
import type { SessionInfo } from "../session/session";
import { LoopbackTransport } from "../transport/loopback";
import { WebSocketTransport } from "../transport/ws";
import { WebRTCTransport } from "../transport/webrtc";
import { bandFor } from "./scoring";
import {
  computeDistribution,
  computeJitter,
  computeLossPercent,
  computeReorderCount,
  computeThroughputBps,
  type Distribution,
} from "../transport/metrics";

export const EXPERIENCE_ID = "transport";

export type TransportKind = "ws" | "webrtc-unreliable" | "webrtc-reliable";

export const ALL_TRANSPORT_KINDS: TransportKind[] = ["ws", "webrtc-unreliable", "webrtc-reliable"];

/** Spec item 3's full matrix — the page's "advanced sweep" controls default to these. */
export const FULL_RATES_HZ = [30, 60, 120];
export const FULL_PAYLOAD_BYTES = [8, 64, 256, 1024, 4096, 16384];
export const FULL_LOSS_PERCENTS = [0, 0.5, 1, 2, 5];

/** Approximate JSON overhead of a `{t:'ping',seq,t0}` frame, for pad sizing. */
const PING_OVERHEAD_BYTES = 40;

/** F14: fragments across ~14 SCTP packets under an unreliable channel — expected-pathological. */
const PATHOLOGICAL_PAYLOAD_BYTES = 16384;
const PATHOLOGICAL_KIND: TransportKind = "webrtc-unreliable";

export interface TransportSweepConfig extends Record<string, unknown> {
  transports: TransportKind[];
  rates: number[];
  payloadSizes: number[];
  lossMode: LossMode;
  /** Percent (0-100); ignored when lossMode === 'none'. */
  lossRates: number[];
  samplesPerCell: number;
  perPingTimeoutMs: number;
}

/** Small, fast default — run-all must finish inside the runner's timeout budget. */
export const DEFAULT_SWEEP_CONFIG: TransportSweepConfig = {
  transports: ALL_TRANSPORT_KINDS,
  rates: [60],
  payloadSizes: [64],
  lossMode: "link-loss",
  lossRates: [2],
  samplesPerCell: 10,
  perPingTimeoutMs: 500,
};

export interface CellResult {
  transport: TransportKind;
  rateHz: number;
  payloadBytes: number;
  lossMode: LossMode;
  lossPercent: number;
  linkLossApplied: boolean;
  pathological: boolean;
  sent: number;
  received: number;
  lossPercentObserved: number;
  reorderCount: number;
  throughputBps: number;
  rttMs: Distribution;
  jitterMs: number;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function waitForOpen(transport: Transport, timeoutMs: number, signal: AbortSignal): Promise<boolean> {
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

/**
 * Runs one sweep cell (one transport, one rate, one payload size, one loss
 * setting) over an already-`open` transport. `payload-drop` is applied here
 * — client-side, before `send` — per contracts.md §4: it happens in the
 * app's send path, after nothing (there's no TCP to have already delivered
 * through), so it never causes HOL blocking. `link-loss` is applied
 * upstream (the server-side proxy toggle), not here.
 */
async function runCell(
  transport: Transport,
  transportKind: TransportKind,
  cell: { rateHz: number; payloadBytes: number; lossMode: LossMode; lossPercent: number; linkLossApplied: boolean },
  opts: { samples: number; perPingTimeoutMs: number },
  signal: AbortSignal,
): Promise<CellResult> {
  const intervalMs = 1000 / cell.rateHz;
  const padLen = Math.max(0, cell.payloadBytes - PING_OVERHEAD_BYTES);
  const pad = "x".repeat(padLen);

  const pending = new Map<number, { t0: number }>();
  const rtts: number[] = [];
  const receivedSeqOrder: number[] = [];
  let seq = 0;
  let sent = 0;
  let bytesSent = 0;
  const pendingTimers: ReturnType<typeof setTimeout>[] = [];

  const onMessage = (msg: WireMessage) => {
    if (msg.t !== "pong") return;
    const entry = pending.get(msg.seq);
    if (!entry) return;
    pending.delete(msg.seq);
    rtts.push(performance.now() - entry.t0);
    receivedSeqOrder.push(msg.seq);
  };
  transport.onMessage(onMessage);

  for (let i = 0; i < opts.samples; i++) {
    if (signal.aborted) break;

    const dropped = cell.lossMode === "payload-drop" && Math.random() * 100 < cell.lossPercent;
    const mySeq = seq++;
    if (!dropped) {
      const t0 = performance.now();
      sent++;
      bytesSent += PING_OVERHEAD_BYTES + padLen;
      pending.set(mySeq, { t0 });
      pendingTimers.push(
        setTimeout(() => {
          pending.delete(mySeq);
        }, opts.perPingTimeoutMs),
      );
      transport.send({ t: "ping", seq: mySeq, t0, pad });
    }

    await delay(intervalMs, signal);
  }

  // Let in-flight pings resolve/time out before scoring the cell.
  await delay(opts.perPingTimeoutMs + 50, signal);
  for (const t of pendingTimers) clearTimeout(t);

  const received = rtts.length;
  return {
    transport: transportKind,
    rateHz: cell.rateHz,
    payloadBytes: cell.payloadBytes,
    lossMode: cell.lossMode,
    lossPercent: cell.lossPercent,
    linkLossApplied: cell.linkLossApplied,
    pathological: cell.payloadBytes >= PATHOLOGICAL_PAYLOAD_BYTES && transportKind === PATHOLOGICAL_KIND,
    sent,
    received,
    lossPercentObserved: computeLossPercent(sent, received),
    reorderCount: computeReorderCount(receivedSeqOrder),
    throughputBps: computeThroughputBps(bytesSent, sent * intervalMs),
    rttMs: computeDistribution(rtts),
    jitterMs: computeJitter(rtts),
  };
}

function buildTransport(kind: TransportKind, room: string, role: "host" | "guest"): Transport {
  if (kind === "ws") return new WebSocketTransport({ room, role });
  return new WebRTCTransport({ room, role, mode: kind === "webrtc-unreliable" ? "unreliable" : "reliable" });
}

/** Best-effort toggle of the server's link-loss proxy (server/PROTOCOL.md `/api/loss`). */
async function setLinkLoss(enabled: boolean, dropRatePercent: number): Promise<boolean> {
  try {
    const res = await fetch("/api/loss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled, dropRate: dropRatePercent / 100 }),
    });
    return res.ok;
  } catch {
    return false; // no server reachable (e.g. static preview) — run proceeds without real link-loss.
  }
}

function lossSettingsFor(config: TransportSweepConfig): { lossPercent: number }[] {
  if (config.lossMode === "none") return [{ lossPercent: 0 }];
  return config.lossRates.map((lossPercent) => ({ lossPercent }));
}

/** Verdict text — the whole point of F1: only `link-loss` proves the HOL claim. Exported for unit tests. */
export function buildVerdict(cells: CellResult[], config: TransportSweepConfig): string {
  if (config.lossMode === "payload-drop") {
    return (
      "This run used app-layer payload-drop, NOT link-loss — it exercises payload-loss " +
      "TOLERANCE (does the app coldly ignore a gap?), not TCP head-of-line blocking, because " +
      "the drop happens after the transport has already delivered the frame. No WS-vs-WebRTC " +
      "HOL verdict can be drawn from this run (contracts.md §4, F1)."
    );
  }

  const wsUnderLoss = cells.filter((c) => c.transport === "ws" && c.lossPercent > 0);
  const rtcUnderLoss = cells.filter((c) => c.transport === "webrtc-unreliable" && c.lossPercent > 0);
  if (config.lossMode === "none" || wsUnderLoss.length === 0 || rtcUnderLoss.length === 0) {
    return (
      "No loss was injected in this run (lossMode='none' or one side of the comparison is " +
      "missing) — medians will look near-identical for WS and WebRTC by design (research.md: " +
      "the gap only appears in the loss-conditioned p99 tail). Run a link-loss sweep to see it."
    );
  }

  const wsP99 = Math.max(...wsUnderLoss.map((c) => c.rttMs.p99));
  const rtcP99 = Math.max(...rtcUnderLoss.map((c) => c.rttMs.p99));
  const anyLinkLossApplied = wsUnderLoss.some((c) => c.linkLossApplied);
  const gapMs = wsP99 - rtcP99;
  const widened = gapMs > 5; // a few ms of noise floor before calling it "widened"

  const caveat = anyLinkLossApplied
    ? ""
    : " (NOTE: the server's /api/loss toggle did not confirm — this run may not have had real link-loss applied; treat this verdict as unverified.)";

  if (widened) {
    return (
      `Under link-loss, WS's p99 RTT (${wsP99.toFixed(1)}ms) is ${gapMs.toFixed(1)}ms worse than ` +
      `WebRTC-unreliable's p99 (${rtcP99.toFixed(1)}ms) — consistent with TCP head-of-line blocking: ` +
      `a lost/delayed byte stalls every already-buffered frame behind it, where the unreliable ` +
      `DataChannel just drops and moves on.${caveat}`
    );
  }
  return (
    `Under this link-loss setting, WS's p99 (${wsP99.toFixed(1)}ms) did NOT measurably widen past ` +
    `WebRTC-unreliable's (${rtcP99.toFixed(1)}ms) on this network/run — either the loss rate was too ` +
    `low to expose HOL here, or this environment doesn't show it. Report the raw numbers, don't ` +
    `assume the general claim is false.${caveat}`
  );
}

/** Exported for unit tests. */
export function computeSubScores(cells: CellResult[], config: TransportSweepConfig): SubScore[] {
  if (cells.length === 0) return [];

  const baseline = cells.filter((c) => c.lossPercent === 0);
  const wsBaseline = baseline.find((c) => c.transport === "ws");
  const repCell = wsBaseline ?? baseline[0] ?? cells[0];

  const latencyValue = repCell.rttMs.p50;
  const latencyBand = bandFor(latencyValue, { goodMax: 30, acceptableMax: 60 });
  const latencyScore: SubScore = {
    key: "latency",
    value0to100: latencyBand === "good" ? 95 : latencyBand === "acceptable" ? 65 : 20,
    band: latencyBand,
    weight: 1,
    rationale: `p50 RTT (peer-echo) of ${repCell.transport}@${repCell.rateHz}Hz/${repCell.payloadBytes}B, no loss: ${latencyValue.toFixed(1)}ms. Bands (research.md §D): good≤30 / acceptable≤60 / bad>60ms — the 60–100ms zone the source table leaves open is resolved conservatively to bad.`,
  };

  const jitterValue = repCell.jitterMs;
  const jitterBand = bandFor(jitterValue, { goodMax: 5, acceptableMax: 30 });
  const jitterScore: SubScore = {
    key: "jitter",
    value0to100: jitterBand === "good" ? 95 : jitterBand === "acceptable" ? 65 : 15,
    band: jitterBand,
    weight: 1.5,
    rationale: `Mean abs. consecutive-RTT delta for the same baseline cell: ${jitterValue.toFixed(1)}ms. Bands per contracts.md §5 (good<5/acceptable<30/bad>30ms, weighted high).`,
  };

  const wsUnderLoss = cells.filter((c) => c.transport === "ws" && c.lossPercent > 0);
  const rtcUnderLoss = cells.filter((c) => c.transport === "webrtc-unreliable" && c.lossPercent > 0);
  let lossScore: SubScore;
  if (config.lossMode !== "link-loss" || wsUnderLoss.length === 0 || rtcUnderLoss.length === 0) {
    lossScore = {
      key: "loss-resilience",
      value0to100: 50,
      band: "acceptable",
      // weight 0 = shown but NOT folded into the composite (F2): there is no real
      // loss measurement here, so a "50" must not drag the mean up or down.
      weight: 0,
      rationale:
        "No link-loss comparison cell available in this run (payload-drop is app-layer and not a " +
        "valid HOL basis per F1) — loss-resilience is UNSCORED here (weight 0, excluded from the " +
        "composite). Run a link-loss sweep with both `ws` and `webrtc-unreliable` selected for a real number.",
    };
  } else {
    const wsP99 = Math.max(...wsUnderLoss.map((c) => c.rttMs.p99));
    const wsBaselineP99 = wsBaseline?.rttMs.p99 ?? wsP99;
    const degradationMs = Math.max(0, wsP99 - wsBaselineP99);
    const band = bandFor(degradationMs, { goodMax: 50, acceptableMax: 300 });
    lossScore = {
      key: "loss-resilience",
      value0to100: band === "good" ? 90 : band === "acceptable" ? 55 : 10,
      band,
      weight: 2,
      rationale: `WS p99 degraded ${degradationMs.toFixed(1)}ms under link-loss vs its own no-loss baseline (${wsBaselineP99.toFixed(1)}ms -> ${wsP99.toFixed(1)}ms) — this IS the HOL cost this experience exists to measure (F1/F9).`,
    };
  }

  return [latencyScore, jitterScore, lossScore];
}

async function runLoopbackDemo(
  config: TransportSweepConfig,
  topology: Topology,
  signal: AbortSignal,
): Promise<ExperienceResult> {
  const [a, b] = LoopbackTransport.createPair();
  await waitForOpen(a, 2000, signal);
  // LoopbackTransport is a bare relay (no peer-echo built in, unlike
  // WebSocketTransport/WebRTCTransport) — emulate the peer side of the
  // peer-echo rule (contracts.md §1, F9) by hand for this demo.
  b.onMessage((msg) => {
    if (msg.t === "ping") b.send({ t: "pong", seq: msg.seq, t0: msg.t0 });
  });

  const cell = await runCell(
    a,
    "ws", // labeled arbitrarily; loopback proves the metrics/ping-pong plumbing, not a real wire
    { rateHz: 60, payloadBytes: 8, lossMode: "none", lossPercent: 0, linkLossApplied: false },
    { samples: 10, perPingTimeoutMs: 200 },
    signal,
  );
  a.close();
  b.close();

  if (signal.aborted) {
    return {
      experienceId: EXPERIENCE_ID,
      status: "failed",
      topology,
      lossMode: "none",
      raw: { config, reason: "aborted" },
      subScores: [],
      verdict: "Aborted before completion.",
      measuredCaveat: "n/a — aborted",
    };
  }

  return {
    experienceId: EXPERIENCE_ID,
    status: "completed",
    topology,
    lossMode: "none",
    raw: { config, cells: [cell] },
    subScores: computeSubScores([cell], { ...config, lossMode: "none" }),
    verdict:
      "Loopback proves the ping/pong peer-echo + distribution-metrics plumbing end-to-end " +
      "(no real network, one in-process transport pair) — it does NOT compare WS vs WebRTC. " +
      "Open this page with ?room=<id> in two tabs/machines (one host, one guest) for the real sweep.",
    measuredCaveat:
      "loopback topology: near-zero in-process latency, not a network measurement. The WS-vs-WebRTC " +
      "verdict requires a live room with two peers.",
  };
}

async function runLiveSweep(
  config: TransportSweepConfig,
  session: SessionInfo,
  signal: AbortSignal,
): Promise<ExperienceResult> {
  const room = session.room!;
  const cells: CellResult[] = [];
  let anyOpened = false;
  let linkLossToggleConfirmed = false;

  for (const kind of config.transports) {
    if (signal.aborted) break;
    const transport = buildTransport(kind, room, session.role);
    const opened = await waitForOpen(transport, 10_000, signal);
    if (!opened) {
      transport.close();
      continue;
    }
    anyOpened = true;

    for (const rateHz of config.rates) {
      for (const payloadBytes of config.payloadSizes) {
        for (const { lossPercent } of lossSettingsFor(config)) {
          if (signal.aborted) break;

          let linkLossApplied = false;
          const applyLinkLossHere = config.lossMode === "link-loss" && kind === "ws" && lossPercent > 0;
          if (applyLinkLossHere) {
            linkLossApplied = await setLinkLoss(true, lossPercent);
            if (linkLossApplied) linkLossToggleConfirmed = true;
          }

          const cell = await runCell(
            transport,
            kind,
            { rateHz, payloadBytes, lossMode: config.lossMode, lossPercent, linkLossApplied },
            { samples: config.samplesPerCell, perPingTimeoutMs: config.perPingTimeoutMs },
            signal,
          );
          cells.push(cell);

          if (applyLinkLossHere) {
            await setLinkLoss(false, 0);
          }
        }
      }
    }

    transport.close();
  }

  if (signal.aborted) {
    return {
      experienceId: EXPERIENCE_ID,
      status: "failed",
      topology: session.topology,
      lossMode: config.lossMode,
      raw: { config, cells, reason: "aborted" },
      subScores: [],
      verdict: "Aborted before completion.",
      measuredCaveat: "n/a — aborted",
    };
  }

  if (!anyOpened) {
    return {
      experienceId: EXPERIENCE_ID,
      status: "failed",
      topology: session.topology,
      lossMode: config.lossMode,
      raw: { config, cells, reason: "no transport reached 'open' (no peer? WebRTC ICE/STUN failure?)" },
      subScores: [],
      verdict:
        "No requested transport reached 'open' within its wait budget — either the peer never " +
        "joined the room, or (WebRTC) STUN/ICE negotiation failed, which research.md notes happens " +
        "for an estimated 15-30% of real-world network pairs without a TURN relay (out of scope here).",
      measuredCaveat: "n/a — no successful connection",
    };
  }

  return {
    experienceId: EXPERIENCE_ID,
    status: "completed",
    topology: session.topology,
    lossMode: config.lossMode,
    raw: {
      config,
      cells,
      linkLossToggleConfirmed: config.lossMode === "link-loss" ? linkLossToggleConfirmed : undefined,
    },
    subScores: computeSubScores(cells, config),
    verdict: buildVerdict(cells, config),
    measuredCaveat:
      "Simulated/injected network conditions + real app + (same-machine-two-tabs/LAN/WAN, see " +
      "topology tag) network latency — comparative between transports on THIS run, not a glass-to-glass " +
      "hardware measurement. `link-loss` only reaches the WS leg and WebRTC's `/signal` socket — the " +
      "already-established P2P DataChannel is never touched by the server-side proxy (server/PROTOCOL.md); " +
      "a true WebRTC link-loss comparison needs an OS network conditioner, out of this spike's scope.",
  };
}

/**
 * The 008.3 Transport experience: WS vs WebRTC (both DataChannel modes)
 * under a rate x payload x loss sweep, RTT via peer-echo (contracts.md §1,
 * F9). `getSession` supplies room/role/topology (src/lib/session/session.ts)
 * — with no `?room=` the run demonstrates the plumbing in `loopback` only
 * (contracts.md §6: 008.3 is soloCapable in loopback).
 */
export function createTransportExperience(getSession: () => SessionInfo): Experience<TransportSweepConfig> {
  return {
    id: EXPERIENCE_ID,
    title: "Transport: WebSocket vs WebRTC",
    whatItTests:
      "Sends the same stream of game-sized packets over WebSocket (`TCP`) and WebRTC DataChannel " +
      "(`UDP`-like), while a proxy injects real packet loss. Reports round-trip `p50` / `p95` / `p99`, " +
      "`jitter`, and observed loss for each. The question: does TCP's head-of-line blocking actually " +
      "show up in the tail?",
    whatItTestsMore:
      "Runs both wires — native WebSocket (via the 008.2 relay) and native WebRTC DataChannel " +
      "(P2P after /signal signaling, public STUN), the latter in TWO modes (unordered+`maxRetransmits:0` " +
      "'UDP-like', and default ordered-reliable) — through the identical `Transport` port, under a " +
      "rate × payload-size × loss sweep, and reports p50/p95/p99/max RTT (peer-echo, not client-server), " +
      "jitter, loss %, reorder, and throughput for each.",
    whyItMatters:
      "TCP resends a lost packet and holds every newer one behind it — a frozen input in a 60Hz " +
      "stream, for roughly one RTT. WebRTC's unreliable channel just drops the lost packet and moves " +
      "on. On a clean link these look identical; the difference only shows up in the p99 tail under " +
      "real loss (research.md). Median-only benchmarks prove the wrong thing — that's why this page " +
      "insists on distributions, not means, and on injected loss, not just a clean-link run.",
    howToRead:
      "Two loss mechanisms are labeled separately: `payload-drop` (app-layer — drops an already-" +
      "delivered message; NOT head-of-line blocking) and `link-loss` (the server's proxy holds up the " +
      "raw TCP byte stream on the WS leg — real HOL). ONLY `link-loss` results are a valid basis for " +
      "the WS-vs-WebRTC verdict; `payload-drop` results are labeled and excluded from that claim. The " +
      "16KiB x webrtc-unreliable cell is expected to look pathological (near-total loss) — that's " +
      "SCTP fragmenting a payload that large across ~14 packets under loss, not a bug (F14).",
    defaultConfig: DEFAULT_SWEEP_CONFIG,
    soloCapable: true,
    async run(config, signal) {
      const session = getSession();
      if (!session.room) {
        return runLoopbackDemo(config, session.topology, signal);
      }
      return runLiveSweep(config, session, signal);
    },
  };
}
