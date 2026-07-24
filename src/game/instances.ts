import type Phaser from "phaser";

let fightGame: Phaser.Game | null = null;
let previewGame: Phaser.Game | null = null;

export function setFightGame(game: Phaser.Game | null): void {
  fightGame = game;
}

export function getFightGame(): Phaser.Game | null {
  return fightGame;
}

export function setPreviewGame(game: Phaser.Game | null): void {
  previewGame = game;
}

function teardownGame(game: Phaser.Game, sceneKeys: string[]): void {
  try {
    for (const key of sceneKeys) {
      const scene = game.scene.getScene(key);
      if (scene?.scene.isActive()) {
        game.scene.stop(key);
      }
    }
  } catch {
    /* ignore */
  }
  game.events.removeAllListeners();
  game.destroy(true);
}

export function destroyFightGame(): void {
  if (!fightGame) return;
  const game = fightGame;
  fightGame = null;
  teardownGame(game, ["Fight", "Preload", "Boot"]);
}

export function destroyPreviewGameInstance(): void {
  if (!previewGame) return;
  const game = previewGame;
  previewGame = null;
  teardownGame(game, ["Preview"]);
}

/** Tear down any running Phaser instance before starting another. */
export function destroyAllPhaserGames(): void {
  destroyPreviewGameInstance();
  destroyFightGame();
}
