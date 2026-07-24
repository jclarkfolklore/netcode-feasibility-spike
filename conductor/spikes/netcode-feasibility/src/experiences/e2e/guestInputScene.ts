/**
 * 008.5 — the guest-side producer half of the input seam (contracts.md §2):
 * "the producer samples input at 60Hz, sends an `input` message per tick
 * with `seq` monotonic." A separate, tiny Phaser scene (NOT a modification
 * of 008.4's render-only `SnapshotGuestScene` — it runs alongside it in the
 * same guest `Phaser.Game`'s scene list) so keyboard capture and rendering
 * stay cleanly separated, same spirit as `NetFightScene` staying a thin
 * subclass.
 *
 * Reuses `LocalKeyboardInput` (read-only import) purely as the real
 * keyboard-edge sampler the actual game already uses — `getInput()` is
 * called at most once per tick, matching `JustDown`'s consume-on-read
 * semantics.
 */
import Phaser from "phaser";
import { LocalKeyboardInput, type InputProvider } from "../../../../../../src/game/systems/InputManager";
import type { Transport, WireMessage } from "../../lib/contracts";

export type InputWireMessage = Extract<WireMessage, { t: "input" }>;

export interface GuestInputSceneConfig {
  /** Which player index THIS guest's keyboard drives on the host's sim. */
  guestLocalPlayer: 1 | 2;
  transport: Transport;
  /** Fires once per sent frame — the page/experience records `seq -> tSent` for felt-lag attribution. */
  onInputSent?: (msg: InputWireMessage) => void;
  /**
   * Optional override for the guest input source (F2 seam). Absent = real
   * keyboard. The demo bot passes a factory returning a choreography-driving
   * provider (which yields to a real keypress). Its inputs flow through this
   * scene's normal single send path (one `seq` stream), so felt-lag
   * attribution stays correct — no `src/` edit.
   */
  localSource?: (scene: GuestInputScene) => InputProvider;
}

export class GuestInputScene extends Phaser.Scene {
  private keyboard!: InputProvider;
  private guestLocalPlayer: 1 | 2 = 1;
  private transport!: Transport;
  private onInputSent?: (msg: InputWireMessage) => void;
  private seq = 0;
  private tick = 0;
  private paused = false;

  constructor() {
    super({ key: "E2EGuestInput" });
  }

  create(): void {
    const cfg = this.registry.get("e2eGuestInputConfig") as GuestInputSceneConfig;
    this.guestLocalPlayer = cfg.guestLocalPlayer;
    this.transport = cfg.transport;
    this.onInputSent = cfg.onInputSent;
    this.keyboard = cfg.localSource ? cfg.localSource(this) : new LocalKeyboardInput(this);
  }

  /** Interactive pages can pause capture (e.g. while a config panel has focus) without tearing the scene down. */
  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  update(): void {
    this.tick += 1;
    // Sample exactly once per tick regardless of `paused`, so JustDown edges
    // are always consumed (never left to build up and fire late) — but only
    // ever SEND a neutral frame while paused, never a stale queued edge.
    const input = this.keyboard.getInput(this.guestLocalPlayer);
    if (this.paused) return;

    const msg: InputWireMessage = {
      t: "input",
      seq: this.seq++,
      tick: this.tick,
      buttons: { left: input.left, right: input.right, block: input.block, charge: input.charge },
      edges: { light: input.light, heavy: input.heavy, special: input.special },
      tSent: performance.now(),
    };
    this.transport.send(msg);
    this.onInputSent?.(msg);
  }
}
