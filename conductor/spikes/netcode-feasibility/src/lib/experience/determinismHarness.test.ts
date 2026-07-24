import { describe, expect, it } from "vitest";
import {
  DEMO_TAPE,
  SYNTHETIC_CHAR_DEFS,
  runAnnouncerPick,
  runScriptedTape,
} from "./determinismHarness";

describe("runScriptedTape — headless scripted drive (F8)", () => {
  it("same seed + same tape => identical damage/KO outcome across two runs", () => {
    const runA = runScriptedTape(42, DEMO_TAPE, SYNTHETIC_CHAR_DEFS);
    const runB = runScriptedTape(42, DEMO_TAPE, SYNTHETIC_CHAR_DEFS);

    expect(runB).toEqual(runA);
    expect(runB.events).toEqual(runA.events);
    expect(runB.p1Health).toBe(runA.p1Health);
    expect(runB.p2Health).toBe(runA.p2Health);
    expect(runB.winner).toBe(runA.winner);
  });

  it("restores the global Math.random after the run", () => {
    const original = Math.random;
    runScriptedTape(1, DEMO_TAPE, SYNTHETIC_CHAR_DEFS);
    expect(Math.random).toBe(original);
  });

  it("does not mutate the input tape or character fixtures", () => {
    const tapeCopy = JSON.parse(JSON.stringify(DEMO_TAPE));
    const defsCopy = JSON.parse(JSON.stringify(SYNTHETIC_CHAR_DEFS));
    runScriptedTape(7, DEMO_TAPE, SYNTHETIC_CHAR_DEFS);
    expect(DEMO_TAPE).toEqual(tapeCopy);
    expect(SYNTHETIC_CHAR_DEFS).toEqual(defsCopy);
  });

  it("a different seed can change the crit/bug-prone rolls and cascade into a different outcome", () => {
    const baseline = runScriptedTape(42, DEMO_TAPE, SYNTHETIC_CHAR_DEFS);
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const outcomes = seeds.map((seed) => runScriptedTape(seed, DEMO_TAPE, SYNTHETIC_CHAR_DEFS));

    // Not every alternate seed is guaranteed to differ (a 0.25/0.1 roll can
    // coincidentally repeat), but across ten alternate seeds at least one
    // must diverge from the baseline — otherwise the demo would be
    // (wrongly) proving the outcome is seed-independent.
    const anyDivergent = outcomes.some((o) => JSON.stringify(o) !== JSON.stringify(baseline));
    expect(anyDivergent).toBe(true);
  });
});

describe("runAnnouncerPick — headless drive of the third RNG site (Announcer.ts:10)", () => {
  const data = {
    roundStart: ["a", "b", "c", "d"],
    bigHit: ["e", "f", "g", "h"],
    miss: ["i"],
    lowConfidence: ["j"],
    ko: ["k"],
    block: ["l"],
  };

  it("same seed => identical line pick across two runs", () => {
    const a = runAnnouncerPick(99, data, "roundStart");
    const b = runAnnouncerPick(99, data, "roundStart");
    expect(b).toBe(a);
  });
});
