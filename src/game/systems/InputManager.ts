import Phaser from "phaser";
import type { PlayerInput } from "../types";
import { EMPTY_INPUT } from "../types";

export interface InputProvider {
  getInput(player: 1 | 2): PlayerInput;
}

export class LocalKeyboardInput implements InputProvider {
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;

  constructor(private scene: Phaser.Scene) {
    if (!scene.input.keyboard) return;
    const kb = scene.input.keyboard;
    this.keys = {
      p1Left: kb.addKey("A"),
      p1Right: kb.addKey("D"),
      p1Block: kb.addKey("S"),
      p1Light: kb.addKey("F"),
      p1Heavy: kb.addKey("G"),
      p1Charge: kb.addKey("SHIFT"),
      p1ChargeAlt: kb.addKey("W"),
      p1Special: kb.addKey("Q"),
      p2Left: kb.addKey("LEFT"),
      p2Right: kb.addKey("RIGHT"),
      p2Block: kb.addKey("DOWN"),
      p2Light: kb.addKey("PERIOD"),
      p2Heavy: kb.addKey("COMMA"),
      p2Charge: kb.addKey("UP"),
      p2ChargeAlt: kb.addKey("SLASH"),
      p2Special: kb.addKey("ENTER"),
    };
  }

  getInput(player: 1 | 2): PlayerInput {
    if (!this.keys) return { ...EMPTY_INPUT };
    if (player === 1) {
      return {
        left: this.keys.p1Left.isDown,
        right: this.keys.p1Right.isDown,
        block: this.keys.p1Block.isDown,
        light: Phaser.Input.Keyboard.JustDown(this.keys.p1Light),
        heavy: Phaser.Input.Keyboard.JustDown(this.keys.p1Heavy),
        charge: this.keys.p1Charge.isDown || this.keys.p1ChargeAlt.isDown,
        special: Phaser.Input.Keyboard.JustDown(this.keys.p1Special),
      };
    }
    return {
      left: this.keys.p2Left.isDown,
      right: this.keys.p2Right.isDown,
      block: this.keys.p2Block.isDown,
      light: Phaser.Input.Keyboard.JustDown(this.keys.p2Light),
      heavy: Phaser.Input.Keyboard.JustDown(this.keys.p2Heavy),
      charge: this.keys.p2Charge.isDown || this.keys.p2ChargeAlt.isDown,
      special: Phaser.Input.Keyboard.JustDown(this.keys.p2Special),
    };
  }
}
