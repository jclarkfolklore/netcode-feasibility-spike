import { describe, expect, it } from "vitest";
import type { Snapshot } from "../../lib/contracts";
import {
  BINARY_FULL_SIZE,
  decodeBinary,
  decodeDelta,
  decodeJSON,
  encodeBinary,
  encodeDelta,
  encodeJSON,
} from "./snapshotCodec";

function makeSnapshot(overrides?: Partial<Snapshot>): Snapshot {
  return {
    t: "snapshot",
    tick: 42,
    hostTime: 12345.678,
    p1LastInputSeq: 10,
    p2LastInputSeq: 11,
    round: 1,
    countdown: 0,
    winner: 0,
    fighters: [
      {
        x: 320.5,
        vx: -55,
        health: 87,
        confidence: 100,
        special: 42,
        state: "walk",
        facingRight: true,
        attackTimer: 0,
        hitstunTimer: 0,
        chargeMs: 0,
      },
      {
        x: 640.25,
        vx: 0,
        health: 100,
        confidence: 90,
        special: 0,
        state: "attack",
        facingRight: false,
        attackTimer: 140,
        hitstunTimer: 0,
        chargeMs: 800,
      },
    ],
    ...overrides,
  };
}

describe("JSON rung", () => {
  it("round-trips exactly", () => {
    const snap = makeSnapshot();
    const { bytes } = encodeJSON(snap);
    expect(decodeJSON(bytes)).toEqual(snap);
  });
});

describe("binary rung", () => {
  it("round-trips within the precision the layout promises", () => {
    const snap = makeSnapshot();
    const { bytes, size } = encodeBinary(snap);
    expect(size).toBe(BINARY_FULL_SIZE);
    const decoded = decodeBinary(bytes);
    expect(decoded.tick).toBe(snap.tick);
    expect(decoded.hostTime).toBeCloseTo(snap.hostTime, 5);
    expect(decoded.p1LastInputSeq).toBe(snap.p1LastInputSeq);
    expect(decoded.p2LastInputSeq).toBe(snap.p2LastInputSeq);
    expect(decoded.round).toBe(snap.round);
    expect(decoded.countdown).toBe(snap.countdown);
    expect(decoded.winner).toBe(snap.winner);
    expect(decoded.fighters[0].x).toBeCloseTo(snap.fighters[0].x, 2);
    expect(decoded.fighters[0].state).toBe("walk");
    expect(decoded.fighters[1].state).toBe("attack");
    expect(decoded.fighters[1].chargeMs).toBe(800);
  });

  it("is comfortably under the 1192B sub-MTU budget for a 2-fighter snapshot", () => {
    const { size } = encodeBinary(makeSnapshot());
    expect(size).toBeLessThan(1192);
  });
});

describe("delta rung", () => {
  it("a first frame (prev=null) sends everything and decodes back to the full snapshot", () => {
    const snap = makeSnapshot();
    const delta = encodeDelta(null, snap);
    // A carrier "previous full" is required to decode; when prev is null every
    // field is marked changed, so the carrier's own field values are irrelevant.
    const dummyPrev = makeSnapshot({ tick: 0 });
    const decoded = decodeDelta(dummyPrev, delta.bytes);
    expect(decoded.fighters[0].x).toBeCloseTo(snap.fighters[0].x, 2);
    expect(decoded.fighters[1].state).toBe("attack");
  });

  it("an unchanged-except-timer frame produces a much smaller delta than a full binary snapshot", () => {
    const prev = makeSnapshot();
    const curr = makeSnapshot({
      tick: 43,
      hostTime: prev.hostTime + 16.67,
      fighters: [
        { ...prev.fighters[0] },
        { ...prev.fighters[1], attackTimer: prev.fighters[1].attackTimer - 16 },
      ],
    });
    const delta = encodeDelta(prev, curr);
    expect(delta.size).toBeLessThan(BINARY_FULL_SIZE);
    // tick(4) + hostTime(8) + bitmask(4) + attackTimer(2) = 18
    expect(delta.size).toBe(18);
    expect(delta.changedFieldCount).toBe(1);

    const decoded = decodeDelta(prev, delta.bytes);
    expect(decoded.fighters[1].attackTimer).toBe(curr.fighters[1].attackTimer);
    expect(decoded.fighters[0]).toEqual(prev.fighters[0]);
    expect(decoded.round).toBe(prev.round);
  });

  it("a fully-changed frame is never worse than a small constant overhead vs full binary", () => {
    const prev = makeSnapshot();
    const curr = makeSnapshot({
      tick: 43,
      p1LastInputSeq: prev.p1LastInputSeq + 1,
      p2LastInputSeq: prev.p2LastInputSeq + 1,
      fighters: [
        { ...prev.fighters[0], x: prev.fighters[0].x + 5, vx: 10, health: prev.fighters[0].health - 1 },
        { ...prev.fighters[1], x: prev.fighters[1].x - 5, state: "hitstun" },
      ],
    });
    const delta = encodeDelta(prev, curr);
    // Worse-case delta (bitmask+tick+hostTime overhead) is small relative to payload.
    expect(delta.size).toBeLessThan(BINARY_FULL_SIZE + 20);
  });
});
