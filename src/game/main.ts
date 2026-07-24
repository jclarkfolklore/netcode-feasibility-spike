import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH } from "./config";
import {
  destroyAllPhaserGames,
  destroyFightGame,
  getFightGame,
  setFightGame,
} from "./instances";
import { clearGameParent } from "./lifecycle";
import { BootScene } from "./scenes/BootScene";
import { FightScene } from "./scenes/FightScene";
import { PreloadScene } from "./scenes/PreloadScene";
import type { MatchConfig } from "./types";

export function createGame(
  parent: HTMLElement,
  match: MatchConfig,
  onHud?: (state: import("./types").FightHudState) => void,
  opts?: { transparent?: boolean },
): Phaser.Game {
  destroyAllPhaserGames();
  clearGameParent(parent);

  // Transparent mode (ADR-001 three-layer stack): the canvas shows the React/WebGPU
  // stage background through it. Defaults to opaque so the standalone flow is
  // unaffected.
  const transparent = opts?.transparent ?? false;

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    parent,
    transparent,
    backgroundColor: transparent ? "rgba(0,0,0,0)" : "#0b1220",
    audio: { noAudio: true },
    physics: {
      default: "arcade",
      arcade: {
        gravity: { x: 0, y: 1200 },
        debug: false,
      },
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [BootScene, PreloadScene, FightScene],
  });

  game.registry.set("match", match);
  game.registry.set("transparent", transparent);

  if (onHud) {
    game.events.on("hud-update", onHud);
  }

  setFightGame(game);
  return game;
}

export function destroyGame(): void {
  destroyFightGame();
}

/** Ask the running fight scene to restart for a rematch. */
export function requestRematch(): void {
  getFightGame()?.events.emit("request-rematch");
}
