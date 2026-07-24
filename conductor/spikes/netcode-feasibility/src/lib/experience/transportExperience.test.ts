import { describe, expect, it } from "vitest";
import type { SessionInfo } from "../session/session";
import {
  DEFAULT_SWEEP_CONFIG,
  buildVerdict,
  computeSubScores,
  createTransportExperience,
  type CellResult,
} from "./transportExperience";

function soloSession(): SessionInfo {
  return { room: null, role: "host", topology: "loopback" };
}

function cell(overrides: Partial<CellResult> = {}): CellResult {
  return {
    transport: "ws",
    rateHz: 60,
    payloadBytes: 64,
    lossMode: "none",
    lossPercent: 0,
    linkLossApplied: false,
    pathological: false,
    sent: 10,
    received: 10,
    lossPercentObserved: 0,
    reorderCount: 0,
    throughputBps: 1000,
    rttMs: { count: 10, p50: 10, p95: 12, p99: 14, max: 15, mean: 10 },
    jitterMs: 2,
    ...overrides,
  };
}

describe("createTransportExperience — loopback (no ?room=)", () => {
  it("runs the plumbing demo and completes with a real (if trivial) measurement", async () => {
    const experience = createTransportExperience(soloSession);
    const controller = new AbortController();
    const result = await experience.run(DEFAULT_SWEEP_CONFIG, controller.signal);

    expect(result.status).toBe("completed");
    expect(result.topology).toBe("loopback");
    expect(result.lossMode).toBe("none");
    expect(result.subScores.length).toBeGreaterThan(0);
    expect(result.verdict).toMatch(/loopback/i);
    expect(result.measuredCaveat).toMatch(/not a network measurement/i);

    const raw = result.raw as { cells: CellResult[] };
    expect(raw.cells).toHaveLength(1);
    expect(raw.cells[0].received).toBeGreaterThan(0);
  });

  it("reports aborted as a failed status, never throws", async () => {
    const experience = createTransportExperience(soloSession);
    const controller = new AbortController();
    controller.abort("test-abort");
    const result = await experience.run(DEFAULT_SWEEP_CONFIG, controller.signal);
    expect(result.status).toBe("failed");
    expect(result.subScores).toEqual([]);
  });

  it("is soloCapable, per contracts.md §6", () => {
    const experience = createTransportExperience(soloSession);
    expect(experience.soloCapable).toBe(true);
  });
});

describe("buildVerdict", () => {
  it("labels payload-drop as NOT a HOL basis regardless of the numbers", () => {
    const verdict = buildVerdict(
      [cell({ transport: "ws", lossPercent: 5, lossMode: "payload-drop" })],
      { ...DEFAULT_SWEEP_CONFIG, lossMode: "payload-drop" },
    );
    expect(verdict).toMatch(/NOT link-loss/);
    expect(verdict).toMatch(/head-of-line/i);
  });

  it("says no verdict is possible when lossMode is 'none'", () => {
    const verdict = buildVerdict(
      [cell({ transport: "ws", lossPercent: 0 })],
      { ...DEFAULT_SWEEP_CONFIG, lossMode: "none" },
    );
    expect(verdict).toMatch(/No loss was injected/);
  });

  it("declares the WS p99 gap widened when WS p99 is clearly worse under link-loss", () => {
    const cells = [
      cell({ transport: "ws", lossPercent: 2, lossMode: "link-loss", linkLossApplied: true, rttMs: { count: 10, p50: 20, p95: 200, p99: 400, max: 450, mean: 60 } }),
      cell({ transport: "webrtc-unreliable", lossPercent: 2, lossMode: "link-loss", rttMs: { count: 10, p50: 15, p95: 20, p99: 25, max: 30, mean: 16 } }),
    ];
    const verdict = buildVerdict(cells, { ...DEFAULT_SWEEP_CONFIG, lossMode: "link-loss" });
    expect(verdict).toMatch(/head-of-line/i);
    expect(verdict).toMatch(/400\.0ms/);
  });

  it("does not overclaim a widened gap when p99s are close", () => {
    const cells = [
      cell({ transport: "ws", lossPercent: 2, lossMode: "link-loss", linkLossApplied: true, rttMs: { count: 10, p50: 20, p95: 22, p99: 24, max: 25, mean: 20 } }),
      cell({ transport: "webrtc-unreliable", lossPercent: 2, lossMode: "link-loss", rttMs: { count: 10, p50: 18, p95: 20, p99: 22, max: 23, mean: 18 } }),
    ];
    const verdict = buildVerdict(cells, { ...DEFAULT_SWEEP_CONFIG, lossMode: "link-loss" });
    expect(verdict).toMatch(/did NOT measurably widen/);
  });
});

describe("computeSubScores", () => {
  it("returns no sub-scores for an empty cell set", () => {
    expect(computeSubScores([], DEFAULT_SWEEP_CONFIG)).toEqual([]);
  });

  it("bands latency/jitter off the no-loss WS baseline cell", () => {
    const scores = computeSubScores(
      [cell({ transport: "ws", lossPercent: 0, rttMs: { count: 10, p50: 15, p95: 18, p99: 20, max: 22, mean: 16 }, jitterMs: 2 })],
      { ...DEFAULT_SWEEP_CONFIG, lossMode: "none" },
    );
    const latency = scores.find((s) => s.key === "latency")!;
    const jitter = scores.find((s) => s.key === "jitter")!;
    expect(latency.band).toBe("good"); // 15ms < 30ms good threshold
    expect(jitter.band).toBe("good"); // 2ms < 5ms good threshold
  });

  it("marks loss-resilience 'acceptable'/neutral when no link-loss comparison is available", () => {
    const scores = computeSubScores([cell()], { ...DEFAULT_SWEEP_CONFIG, lossMode: "none" });
    const loss = scores.find((s) => s.key === "loss-resilience")!;
    expect(loss.band).toBe("acceptable");
    expect(loss.rationale).toMatch(/No link-loss comparison/);
  });

  it("bands loss-resilience off WS's own p99 degradation under link-loss", () => {
    const scores = computeSubScores(
      [
        cell({ transport: "ws", lossPercent: 0, rttMs: { count: 10, p50: 10, p95: 11, p99: 12, max: 13, mean: 10 } }),
        cell({ transport: "ws", lossPercent: 2, lossMode: "link-loss", linkLossApplied: true, rttMs: { count: 10, p50: 20, p95: 300, p99: 500, max: 600, mean: 80 } }),
        cell({ transport: "webrtc-unreliable", lossPercent: 2, lossMode: "link-loss", rttMs: { count: 10, p50: 15, p95: 18, p99: 20, max: 22, mean: 16 } }),
      ],
      { ...DEFAULT_SWEEP_CONFIG, lossMode: "link-loss" },
    );
    const loss = scores.find((s) => s.key === "loss-resilience")!;
    expect(loss.band).toBe("bad"); // 500-12 = 488ms degradation, way over the 300ms 'bad' threshold
  });
});
