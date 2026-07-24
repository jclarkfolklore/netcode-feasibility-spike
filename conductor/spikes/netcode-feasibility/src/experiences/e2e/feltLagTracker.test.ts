import { describe, expect, it } from "vitest";
import { FeltLagTracker } from "./feltLagTracker";

describe("FeltLagTracker", () => {
  it("attributes exactly one sample per new lastInputSeq advance", () => {
    const tracker = new FeltLagTracker();
    tracker.recordSent(0, 1000);
    tracker.recordSent(1, 1020);

    expect(tracker.attribute(0, 1050)).toBe(50);
    // Same seq again (snapshot hasn't advanced yet) -> no new sample.
    expect(tracker.attribute(0, 1080)).toBeNull();
    expect(tracker.attribute(1, 1100)).toBe(80);
    expect(tracker.samplesMs).toEqual([50, 80]);
  });

  it("returns null for a seq it never recorded a send for", () => {
    const tracker = new FeltLagTracker();
    expect(tracker.attribute(5, 2000)).toBeNull();
    expect(tracker.samplesMs).toEqual([]);
  });

  it("attributes EVERY recorded send in a seq jump (host consumed a burst)", () => {
    const tracker = new FeltLagTracker();
    tracker.recordSent(0, 1000);
    tracker.recordSent(1, 1010);
    tracker.recordSent(2, 1020);
    tracker.recordSent(3, 1030);
    // The guest skipped intermediate frames; the next rendered snapshot jumps
    // straight to lastInputSeq=3. All four presses first became visible now.
    tracker.attribute(3, 1100);
    expect(tracker.samplesMs).toEqual([100, 90, 80, 70]);
    expect(tracker.sampleCount).toBe(4);
  });

  it("skips gaps with no recorded send but still attributes the ones present", () => {
    const tracker = new FeltLagTracker();
    tracker.recordSent(2, 1000); // seqs 0,1 never sent by this player
    tracker.attribute(3, 1050);
    expect(tracker.samplesMs).toEqual([50]);
  });
});
