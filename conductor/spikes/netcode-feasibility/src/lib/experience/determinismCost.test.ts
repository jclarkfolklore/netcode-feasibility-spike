import { describe, expect, it } from "vitest";
import { createDeterminismCostExperience, NON_DETERMINISM_SOURCES, COST_TABLE } from "./determinismCost";

describe("createDeterminismCostExperience", () => {
  it("is soloCapable (no network/peer needed)", () => {
    const experience = createDeterminismCostExperience(() => "loopback");
    expect(experience.soloCapable).toBe(true);
  });

  it("enumerates all 5 verified non-determinism sources", () => {
    expect(NON_DETERMINISM_SOURCES).toHaveLength(5);
    const rngSites = NON_DETERMINISM_SOURCES.filter((s) => s.kind === "rng");
    expect(rngSites).toHaveLength(3);
    expect(rngSites.map((s) => s.location)).toEqual([
      "src/game/systems/CombatSystem.ts:52",
      "src/game/systems/CombatSystem.ts:58",
      "src/game/systems/Announcer.ts:10",
    ]);
    const structural = NON_DETERMINISM_SOURCES.filter((s) => s.cost === "structural");
    expect(structural).toHaveLength(2);
  });

  it("the cost table covers both the cheap and structural parts", () => {
    expect(COST_TABLE.some((r) => r.cost === "cheap")).toBe(true);
    expect(COST_TABLE.some((r) => r.cost === "structural")).toBe(true);
  });

  it("run() with matching seeds emits a completed result with a determinism-readiness sub-score, badged as an estimate", async () => {
    const experience = createDeterminismCostExperience(() => "loopback");
    const controller = new AbortController();
    const result = await experience.run(experience.defaultConfig, controller.signal);

    expect(result.status).toBe("completed");
    expect(result.experienceId).toBe("determinism-cost");
    const raw = result.raw as { reproducibility: { reproducible: boolean } };
    expect(raw.reproducibility.reproducible).toBe(true);
    expect(result.subScores).toHaveLength(1);
    expect(result.subScores[0].key).toBe("determinism-readiness");
    expect(result.subScores[0].value0to100).toBeGreaterThanOrEqual(0);
    expect(result.subScores[0].value0to100).toBeLessThanOrEqual(100);
    expect(result.measuredCaveat.toLowerCase()).toContain("estimate");
    expect(result.measuredCaveat.toLowerCase()).not.toContain("live network metric measured");
  });

  it("run() reports aborted signals as a failed result, never throws", async () => {
    const experience = createDeterminismCostExperience(() => "loopback");
    const controller = new AbortController();
    controller.abort("test-abort");
    const result = await experience.run(experience.defaultConfig, controller.signal);

    expect(result.status).toBe("failed");
    expect(result.subScores).toEqual([]);
  });
});
