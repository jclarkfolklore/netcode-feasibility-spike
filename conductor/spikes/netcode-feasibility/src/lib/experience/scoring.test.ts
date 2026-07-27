import { describe, expect, it } from "vitest";
import type { ExperienceResult, SubScore } from "../contracts";
import {
  aggregateResults,
  applyWeightOverrides,
  bandFor,
  crossNetworkResults,
  isSoloTopology,
  scoreExperienceResult,
  scoreSubScores,
  splitAxes,
} from "./scoring";

function sub(partial: Partial<SubScore> & Pick<SubScore, "value0to100" | "band">): SubScore {
  return {
    key: "latency",
    weight: 1,
    rationale: "test",
    ...partial,
  };
}

describe("scoreSubScores", () => {
  it("returns null for no sub-scores", () => {
    expect(scoreSubScores([])).toBeNull();
  });

  it("is a geometric mean, not an average, for equal weights", () => {
    const score = scoreSubScores([
      sub({ value0to100: 100, band: "good" }),
      sub({ value0to100: 25, band: "acceptable" }),
    ]);
    // geometric mean of 100,25 = 50; arithmetic mean would be 62.5
    expect(score).toBeCloseTo(50, 5);
  });

  it("excludes a weight-0 sub-score from the composite (shown but not scored)", () => {
    // A neutral/informational placeholder (e.g. unscored loss-resilience) must
    // NOT drag the mean. weight:0 → contributes nothing; the result equals the
    // score of the remaining weighted sub-scores alone.
    const withPlaceholder = scoreSubScores([
      sub({ value0to100: 100, band: "good", weight: 1 }),
      sub({ value0to100: 25, band: "acceptable", weight: 1 }),
      sub({ value0to100: 50, band: "acceptable", weight: 0 }),
    ]);
    const without = scoreSubScores([
      sub({ value0to100: 100, band: "good", weight: 1 }),
      sub({ value0to100: 25, band: "acceptable", weight: 1 }),
    ]);
    expect(withPlaceholder).toBeCloseTo(without!, 5);
  });

  it("returns null when every sub-score is weight-0 (nothing to score)", () => {
    expect(
      scoreSubScores([sub({ value0to100: 50, band: "acceptable", weight: 0 })]),
    ).toBeNull();
  });

  it("min-gates the composite when any sub-score is bad", () => {
    const score = scoreSubScores([
      sub({ value0to100: 95, band: "good" }),
      sub({ value0to100: 95, band: "good" }),
      sub({ value0to100: 20, band: "bad" }),
    ]);
    // geometric mean alone would be ~57; the bad value (20) must cap it
    expect(score).not.toBeNull();
    expect(score!).toBeLessThanOrEqual(20);
  });

  it("weights pull the mean toward the higher-weight sub-score", () => {
    const heavy = scoreSubScores([
      sub({ value0to100: 90, band: "good", weight: 5 }),
      sub({ value0to100: 10, band: "bad", weight: 1 }),
    ]);
    // even ignoring the min-gate, the weighted mean should sit above the
    // unweighted geometric mean of 90 and 10 (~30) because 90 is weighted more
    const unweighted = Math.sqrt(90 * 10);
    // heavy is min-gated to 10 (bad value), so assert on the pre-gate shape
    // via a non-bad variant instead:
    const heavyNoBad = scoreSubScores([
      sub({ value0to100: 90, band: "good", weight: 5 }),
      sub({ value0to100: 10, band: "acceptable", weight: 1 }),
    ]);
    expect(heavyNoBad!).toBeGreaterThan(unweighted);
    expect(heavy).not.toBeNull();
  });
});

function completedResult(subScores: SubScore[]): ExperienceResult {
  return {
    experienceId: "x",
    status: "completed",
    topology: "loopback",
    lossMode: "none",
    raw: {},
    subScores,
    verdict: "test",
    measuredCaveat: "test",
  };
}

describe("scoreExperienceResult", () => {
  it("is null for failed/skipped results, never zero", () => {
    expect(
      scoreExperienceResult({ ...completedResult([]), status: "failed" }),
    ).toBeNull();
    expect(
      scoreExperienceResult({ ...completedResult([]), status: "skipped" }),
    ).toBeNull();
  });

  it("scores completed results", () => {
    const result = completedResult([sub({ value0to100: 80, band: "good" })]);
    expect(scoreExperienceResult(result)).toBeCloseTo(80, 5);
  });
});

describe("aggregateResults", () => {
  it("excludes failed results from the mean instead of zeroing them", () => {
    const good = completedResult([sub({ value0to100: 80, band: "good" })]);
    const failed: ExperienceResult = { ...completedResult([]), experienceId: "y", status: "failed" };

    const agg = aggregateResults([good, failed]);
    expect(agg.completedCount).toBe(1);
    expect(agg.failedCount).toBe(1);
    expect(agg.compositeScore).toBeCloseTo(80, 5);
    expect(agg.perExperience.y).toBeNull();
  });

  it("returns a null composite when nothing completed", () => {
    const failed: ExperienceResult = { ...completedResult([]), status: "failed" };
    const agg = aggregateResults([failed]);
    expect(agg.compositeScore).toBeNull();
  });
});

describe("applyWeightOverrides", () => {
  it("leaves weights unchanged with no overrides", () => {
    const subs = [sub({ value0to100: 80, band: "good", weight: 2 })];
    expect(applyWeightOverrides(subs)).toEqual(subs);
  });

  it("scales the authored weight by the override multiplier", () => {
    const subs = [sub({ key: "jitter", value0to100: 80, band: "good", weight: 2 })];
    const result = applyWeightOverrides(subs, { jitter: 2 });
    expect(result[0].weight).toBe(4);
    // unaffected keys keep their authored weight
    const subs2 = [sub({ key: "latency", value0to100: 80, band: "good", weight: 3 })];
    expect(applyWeightOverrides(subs2, { jitter: 2 })[0].weight).toBe(3);
  });

  it("perturbing a weight changes the aggregate composite (transparency, not hidden arbitrariness)", () => {
    const highJitterBad = completedResult([
      sub({ key: "latency", value0to100: 95, band: "good", weight: 1 }),
      sub({ key: "jitter", value0to100: 20, band: "acceptable", weight: 1 }),
    ]);
    const baseline = aggregateResults([highJitterBad]).compositeScore!;
    const jitterWeightedUp = aggregateResults([highJitterBad], { jitter: 2 }).compositeScore!;
    // weighting the lower sub-score (jitter=20) up should pull the composite DOWN.
    expect(jitterWeightedUp).toBeLessThan(baseline);
  });
});

describe("splitAxes", () => {
  it("separates the determinism-cost experience from the feasibility set", () => {
    const feasibility = { ...completedResult([sub({ value0to100: 80, band: "good" })]), experienceId: "transport" };
    const determinism = { ...completedResult([sub({ key: "determinism-readiness", value0to100: 25, band: "bad" })]), experienceId: "determinism-cost" };

    const { feasibilityResults, determinismResult } = splitAxes([feasibility, determinism]);
    expect(feasibilityResults).toEqual([feasibility]);
    expect(determinismResult).toEqual(determinism);
  });

  it("a bad determinism-readiness score never caps the feasibility composite", () => {
    const feasibility = { ...completedResult([sub({ value0to100: 90, band: "good" })]), experienceId: "transport" };
    const determinism = {
      ...completedResult([sub({ key: "determinism-readiness", value0to100: 25, band: "bad" })]),
      experienceId: "determinism-cost",
    };

    const { feasibilityResults } = splitAxes([feasibility, determinism]);
    const feasibilityScore = aggregateResults(feasibilityResults).compositeScore;
    expect(feasibilityScore).toBeCloseTo(90, 5); // not min-gated to 25 by the OTHER axis's bad score
  });
});

describe("isSoloTopology / crossNetworkResults", () => {
  it("flags only 'loopback' as solo", () => {
    expect(isSoloTopology("loopback")).toBe(true);
    expect(isSoloTopology("same-machine-two-tabs")).toBe(false);
    expect(isSoloTopology("LAN")).toBe(false);
    expect(isSoloTopology("WAN")).toBe(false);
  });

  it("excludes loopback results from the cross-network set", () => {
    const loop = { ...completedResult([]), experienceId: "a", topology: "loopback" as const };
    const wan = { ...completedResult([]), experienceId: "b", topology: "WAN" as const };
    expect(crossNetworkResults([loop, wan])).toEqual([wan]);
  });
});

describe("bandFor", () => {
  it("bands a lower-is-better metric (e.g. latency ms)", () => {
    expect(bandFor(20, { goodMax: 30, acceptableMax: 60 })).toBe("good");
    expect(bandFor(45, { goodMax: 30, acceptableMax: 60 })).toBe("acceptable");
    expect(bandFor(120, { goodMax: 30, acceptableMax: 60 })).toBe("bad");
  });

  it("bands a higher-is-better metric", () => {
    const bands = { goodMax: 90, acceptableMax: 60, higherIsBetter: true };
    expect(bandFor(95, bands)).toBe("good");
    expect(bandFor(70, bands)).toBe("acceptable");
    expect(bandFor(10, bands)).toBe("bad");
  });
});
