import { describe, expect, it } from "vitest";
import { DelayedLocalInput } from "./delayedLocalInput";
import type { InputProvider } from "../../../../../../src/game/systems/InputManager";
import { EMPTY_INPUT, type PlayerInput } from "../../../../../../src/game/types";

/** Scripted stand-in for `LocalKeyboardInput` — a fixed sequence of frames, one per `getInput` call. */
class ScriptedSource implements InputProvider {
  private i = 0;
  constructor(private readonly frames: PlayerInput[]) {}
  getInput(): PlayerInput {
    const frame = this.frames[this.i] ?? { ...EMPTY_INPUT };
    this.i += 1;
    return frame;
  }
}

function frame(overrides: Partial<PlayerInput>): PlayerInput {
  return { ...EMPTY_INPUT, ...overrides };
}

describe("DelayedLocalInput — symmetric host-side delay knob", () => {
  it("passes samples through immediately when delayTicks is 0", () => {
    const source = new ScriptedSource([frame({ light: true }), frame({ heavy: true })]);
    let tick = 0;
    const delayed = new DelayedLocalInput(source, 1, () => tick, () => 0);

    tick = 0;
    expect(delayed.getInput(1).light).toBe(true);
    tick = 1;
    expect(delayed.getInput(1).heavy).toBe(true);
  });

  it("delays samples by N ticks and returns neutral input before the ramp-up window fills", () => {
    const source = new ScriptedSource([
      frame({ light: true }),
      frame({}),
      frame({ heavy: true }),
      frame({}),
    ]);
    let tick = 0;
    const delayed = new DelayedLocalInput(source, 1, () => tick, () => 2);

    tick = 0;
    expect(delayed.getInput(1)).toEqual(frame({})); // ramp-up: nothing at (0-2) yet
    tick = 1;
    expect(delayed.getInput(1)).toEqual(frame({}));
    tick = 2;
    expect(delayed.getInput(1).light).toBe(true); // tick 0's sample, delivered at tick 2
    tick = 3;
    expect(delayed.getInput(1)).toEqual(frame({})); // tick 1's sample was neutral
    tick = 4;
    expect(delayed.getInput(1).heavy).toBe(true); // tick 2's sample, delivered at tick 4
  });

  it("returns the neutral input for the other player slot", () => {
    const source = new ScriptedSource([frame({ light: true })]);
    const delayed = new DelayedLocalInput(source, 1, () => 0, () => 0);
    expect(delayed.getInput(2)).toEqual({ ...EMPTY_INPUT });
  });
});
