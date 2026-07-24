import { describe, expect, it } from "vitest";
import { RemoteInput, type InputWireMessage } from "./remoteInput";

const NEUTRAL_BUTTONS = { left: false, right: false, block: false, charge: false };
const NEUTRAL_EDGES = { light: false, heavy: false, special: false };

function inputMsg(seq: number, overrides: Partial<InputWireMessage["edges"]> = {}, tSent = seq): InputWireMessage {
  return {
    t: "input",
    seq,
    tick: seq,
    buttons: { ...NEUTRAL_BUTTONS },
    edges: { ...NEUTRAL_EDGES, ...overrides },
    tSent,
  };
}

describe("RemoteInput — exactly-once edge contract (contracts.md §2)", () => {
  it("delivers a single light-press edge true exactly once, false on every other read", () => {
    const remote = new RemoteInput(1, 0);
    remote.ingest(inputMsg(0, { light: true }), 0);
    remote.releaseDue(0);

    const reads = [
      remote.getInput(1).light,
      remote.getInput(1).light,
      remote.getInput(1).light,
    ];
    expect(reads).toEqual([true, false, false]);
  });

  it("never doubles or drops edges across a scripted press sequence with gaps", () => {
    const remote = new RemoteInput(1, 0);
    // Scripted sequence: light, (nothing), heavy, special, (nothing), light again.
    const script: InputWireMessage[] = [
      inputMsg(0, { light: true }),
      inputMsg(1, {}),
      inputMsg(2, { heavy: true }),
      inputMsg(3, { special: true }),
      inputMsg(4, {}),
      inputMsg(5, { light: true }),
    ];
    for (const msg of script) remote.ingest(msg, 0);
    remote.releaseDue(0);

    let lightCount = 0;
    let heavyCount = 0;
    let specialCount = 0;
    // Read one extra time beyond the script length to prove no phantom edge appears.
    for (let i = 0; i < script.length + 3; i++) {
      const input = remote.getInput(1);
      if (input.light) lightCount++;
      if (input.heavy) heavyCount++;
      if (input.special) specialCount++;
    }

    expect(lightCount).toBe(2);
    expect(heavyCount).toBe(1);
    expect(specialCount).toBe(1);
  });

  it("missing/late frame returns last level state with all edges false, never a replayed attack", () => {
    const remote = new RemoteInput(1, 0);
    remote.ingest(inputMsg(0, { light: true }), 0);
    remote.releaseDue(0);

    const first = remote.getInput(1);
    expect(first.light).toBe(true);

    // No new message ingested — queue is empty, must fall back to neutral edges.
    const second = remote.getInput(1);
    expect(second.light).toBe(false);
    expect(second.heavy).toBe(false);
    expect(second.special).toBe(false);
  });

  it("honors level-held buttons (left/right/block/charge) as level state, not edges", () => {
    const remote = new RemoteInput(2, 0);
    remote.ingest({ ...inputMsg(0), buttons: { left: true, right: false, block: false, charge: false } }, 0);
    remote.releaseDue(0);
    const first = remote.getInput(2);
    expect(first.left).toBe(true);

    // No new frame — level state persists (unlike edges, which zero out).
    const second = remote.getInput(2);
    expect(second.left).toBe(true);
  });

  it("respects the input-delay knob: a frame is not consumable before its delay elapses", () => {
    const remote = new RemoteInput(1, 50);
    remote.ingest(inputMsg(0, { light: true }), 1000);
    remote.releaseDue(1010); // 10ms elapsed of the required 50ms — not released yet
    expect(remote.getInput(1).light).toBe(false);

    remote.releaseDue(1051); // now past the 50ms delay
    expect(remote.getInput(1).light).toBe(true);
    // and still exactly once
    expect(remote.getInput(1).light).toBe(false);
  });

  it("getInput for the wrong player slot always returns the neutral/empty input", () => {
    const remote = new RemoteInput(1, 0);
    remote.ingest(inputMsg(0, { light: true }), 0);
    remote.releaseDue(0);
    expect(remote.getInput(2)).toEqual({
      left: false,
      right: false,
      block: false,
      light: false,
      heavy: false,
      charge: false,
      special: false,
    });
  });

  it("tracks lastConsumedSeq only on an actual dequeue, for Snapshot's p{1,2}LastInputSeq", () => {
    const remote = new RemoteInput(1, 0);
    expect(remote.lastConsumedSeq).toBe(-1);
    remote.ingest(inputMsg(7, { heavy: true }), 0);
    remote.releaseDue(0);
    remote.getInput(1);
    expect(remote.lastConsumedSeq).toBe(7);
    // A subsequent empty-queue read must NOT change lastConsumedSeq.
    remote.getInput(1);
    expect(remote.lastConsumedSeq).toBe(7);
  });
});
