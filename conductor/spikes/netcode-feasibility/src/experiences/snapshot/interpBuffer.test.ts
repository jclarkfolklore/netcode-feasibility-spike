import { describe, expect, it } from "vitest";
import type { Snapshot } from "../../lib/contracts";
import { InterpolationBuffer } from "./interpBuffer";

function snap(tick: number, hostTime: number): Snapshot {
  return {
    t: "snapshot",
    tick,
    hostTime,
    p1LastInputSeq: tick,
    p2LastInputSeq: tick,
    round: 1,
    countdown: 0,
    winner: 0,
    fighters: [
      { x: tick, vx: 0, health: 100, confidence: 100, special: 0, state: "idle", facingRight: true, attackTimer: 0, hitstunTimer: 0, chargeMs: 0 },
      { x: -tick, vx: 0, health: 100, confidence: 100, special: 0, state: "idle", facingRight: false, attackTimer: 0, hitstunTimer: 0, chargeMs: 0 },
    ],
  };
}

describe("InterpolationBuffer", () => {
  it("returns null before any snapshot is old enough for the requested delay", () => {
    const buf = new InterpolationBuffer();
    buf.push(snap(1, 1000));
    expect(buf.sampleAt(1000, 100)).toBeNull();
  });

  it("returns the newest snapshot at or before hostNow - delayMs", () => {
    const buf = new InterpolationBuffer();
    buf.push(snap(1, 1000));
    buf.push(snap(2, 1016));
    buf.push(snap(3, 1033));
    buf.push(snap(4, 1050));

    // hostNow=1050, delay=0 -> newest snapshot at/before 1050 is tick 4.
    expect(buf.sampleAt(1050, 0)?.tick).toBe(4);
    // hostNow=1050, delay=50 -> target=1000 -> tick 1 (the only one <=1000).
    expect(buf.sampleAt(1050, 50)?.tick).toBe(1);
    // hostNow=1050, delay=17 -> target=1033 -> tick 3.
    expect(buf.sampleAt(1050, 17)?.tick).toBe(3);
  });

  it("tracks the rendered timestamp and reports staleness = hostNow - renderedHostTime", () => {
    const buf = new InterpolationBuffer();
    buf.push(snap(1, 1000));
    buf.push(snap(2, 1016));

    buf.sampleAt(1016, 16); // renders tick 1 (hostTime 1000)
    expect(buf.staleness(1016)).toBeCloseTo(16, 5);
    expect(buf.lastRenderedTick).toBe(1);

    // Clock advances without a new sample being old enough yet -> staleness grows.
    expect(buf.staleness(1100)).toBeCloseTo(100, 5);
  });

  it("staleness is 0 before anything has ever been rendered", () => {
    const buf = new InterpolationBuffer();
    expect(buf.staleness(9999)).toBe(0);
  });

  it("prunes old entries beyond its buffer cap", () => {
    const buf = new InterpolationBuffer();
    for (let i = 0; i < 500; i++) buf.push(snap(i, i * 16.67));
    expect(buf.size).toBeLessThanOrEqual(300);
  });
});
