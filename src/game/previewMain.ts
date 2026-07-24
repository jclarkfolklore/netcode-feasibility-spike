import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH } from "./config";
import {
  destroyAllPhaserGames,
  destroyPreviewGameInstance,
  setPreviewGame,
} from "./instances";
import { clearGameParent } from "./lifecycle";
import { PreviewScene, type PreviewStepEvent } from "./scenes/PreviewScene";

/** Set before game boot so PreviewScene can read the fighter id on first frame. */
export let pendingPreviewCharacterId = "";

export function destroyPreviewGame(): void {
  destroyPreviewGameInstance();
}

export function createPreviewGame(
  parent: HTMLElement,
  characterId: string,
  onStep?: (event: PreviewStepEvent) => void,
): Phaser.Game {
  destroyAllPhaserGames();
  clearGameParent(parent);
  pendingPreviewCharacterId = characterId;

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    parent,
    backgroundColor: "#0b1220",
    audio: { noAudio: true },
    physics: {
      default: "arcade",
      arcade: { gravity: { x: 0, y: 0 }, debug: false },
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [PreviewScene],
  });

  game.registry.set("previewCharacterId", characterId);

  if (onStep) {
    game.events.on("preview-step", onStep);
  }

  setPreviewGame(game);
  return game;
}

export type { PreviewStepEvent };
