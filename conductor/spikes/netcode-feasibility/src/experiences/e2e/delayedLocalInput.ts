/**
 * The symmetric input-delay knob (spec item 3, research.md §C): "delay the
 * host's own input to match the guest — converts an unfair asymmetry into
 * an even, fair delay." Wraps the host's OWN `LocalKeyboardInput` (or any
 * `InputProvider`) so its samples pass through the same kind of tick-keyed
 * delay ring buffer `RemoteInput` uses for the network side, but driven by
 * `NetFightScene`'s own tick counter instead of wall-clock arrival.
 *
 * `getInput()` samples the underlying source EXACTLY ONCE per call — this
 * matters because `Phaser.Input.Keyboard.JustDown` consumes its edge on
 * read (Phaser semantics), so this must be called at most once per tick per
 * player, same as the original `FightScene.update()` already does
 * (`FightScene.ts:169-170`). `NetFightScene` respects that by construction.
 */
import type { InputProvider } from "../../../../../../src/game/systems/InputManager";
import { EMPTY_INPUT, type PlayerInput } from "../../../../../../src/game/types";
import { TickRing } from "./tickRing";

export class DelayedLocalInput implements InputProvider {
  private readonly ring = new TickRing<PlayerInput>();
  private lastLevel: PlayerInput = { ...EMPTY_INPUT };

  constructor(
    private readonly source: InputProvider,
    private readonly player: 1 | 2,
    private readonly getTick: () => number,
    private readonly getDelayTicks: () => number,
  ) {}

  getInput(player: 1 | 2): PlayerInput {
    if (player !== this.player) return { ...EMPTY_INPUT };

    const tick = this.getTick();
    const sample = this.source.getInput(player);
    this.ring.write(tick, sample);

    const delayTicks = Math.max(0, Math.round(this.getDelayTicks()));
    if (delayTicks === 0) return sample;

    const readTick = tick - delayTicks;
    const delayed = this.ring.read(readTick);
    if (!delayed) {
      // Ramp-up window (not enough ticks elapsed yet) — neutral, never a
      // replayed/guessed attack.
      return { ...EMPTY_INPUT };
    }
    this.lastLevel = delayed;
    return delayed;
  }

  get lastAppliedLevel(): PlayerInput {
    return this.lastLevel;
  }
}
