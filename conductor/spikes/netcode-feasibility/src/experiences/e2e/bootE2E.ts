/**
 * 008.5 — two-games-in-one-page boot, same constraint and technique 008.4
 * already established (`src/game/instances.ts`'s `createGame` singleton
 * tears down any prior game, so a host AND guest can't share it): `new
 * Phaser.Game` is instantiated directly here too, bypassing `createGame`
 * entirely. The HOST boots the REAL sim (`NetFightScene extends
 * FightScene`); the GUEST boots 008.4's render-only `SnapshotGuestScene`
 * (reused, read-only, unmodified) alongside this sub-spec's own
 * `GuestInputScene` for keyboard capture.
 */
import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH } from "../../../../../../src/game/config";
import { BootScene } from "../../../../../../src/game/scenes/BootScene";
import { PreloadScene } from "../../../../../../src/game/scenes/PreloadScene";
import type { MatchConfig } from "../../../../../../src/game/types";
import { SnapshotGuestScene } from "../snapshot/guestScene";
import { NetFightScene, NET_E2E_SNAPSHOT_EVENT, type NetFightSceneConfig } from "./netFightScene";
import { GuestInputScene, type GuestInputSceneConfig } from "./guestInputScene";

const E2E_MATCH_CONFIG: MatchConfig = {
  p1: "coder",
  p2: "scope_creep",
  stage: "",
  mode: "online",
};

export interface E2EHostHandle {
  game: Phaser.Game;
  scene: NetFightScene;
  destroy(): void;
}

export interface E2EGuestHandle {
  game: Phaser.Game;
  fightScene: SnapshotGuestScene;
  inputScene: GuestInputScene;
  destroy(): void;
}

/** Boots the REAL sim through the NetFightScene seam. Resolves once the first snapshot has been produced. */
export function bootE2EHostGame(
  parent: HTMLElement,
  config: NetFightSceneConfig,
  signal?: AbortSignal,
): Promise<E2EHostHandle> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted before host game boot"));
      return;
    }
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      parent,
      backgroundColor: "#0b1220",
      audio: { noAudio: true },
      physics: {
        default: "arcade",
        arcade: { gravity: { x: 0, y: 1200 }, debug: false },
      },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [BootScene, PreloadScene, NetFightScene],
    });
    game.registry.set("match", E2E_MATCH_CONFIG);
    game.registry.set("transparent", false);
    game.registry.set("netE2EConfig", config);

    const onAbort = () => {
      game.destroy(true);
      reject(new Error("aborted while waiting for host game to boot"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    game.events.once(NET_E2E_SNAPSHOT_EVENT, () => {
      signal?.removeEventListener("abort", onAbort);
      const scene = game.scene.getScene("Fight") as unknown as NetFightScene;
      resolve({
        game,
        scene,
        destroy: () => {
          game.events.removeAllListeners();
          game.destroy(true);
        },
      });
    });
  });
}

/** Boots the guest: 008.4's render-only vehicle + this sub-spec's keyboard-capture scene, side by side in one game. */
export function bootE2EGuestGame(
  parent: HTMLElement,
  config: GuestInputSceneConfig,
): Promise<E2EGuestHandle> {
  return new Promise((resolve) => {
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      parent,
      backgroundColor: "#160f26",
      audio: { noAudio: true },
      physics: {
        default: "arcade",
        arcade: { gravity: { x: 0, y: 1200 }, debug: false },
      },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [SnapshotGuestScene, GuestInputScene],
    });
    game.registry.set("e2eGuestInputConfig", config);

    game.events.once(Phaser.Core.Events.READY, () => {
      // Only the FIRST scene in the array auto-starts; the input-capture scene
      // must be launched explicitly or it never ticks (its `update` — and thus
      // input send — would never run).
      if (!game.scene.isActive("E2EGuestInput")) game.scene.start("E2EGuestInput");
      const wait = () => {
        const fightScene = game.scene.getScene("SnapshotGuest") as unknown as SnapshotGuestScene;
        const inputScene = game.scene.getScene("E2EGuestInput") as unknown as GuestInputScene;
        if (fightScene?.fighterP1 && fightScene?.fighterP2 && inputScene) {
          resolve({
            game,
            fightScene,
            inputScene,
            destroy: () => {
              game.events.removeAllListeners();
              game.destroy(true);
            },
          });
          return;
        }
        requestAnimationFrame(wait);
      };
      wait();
    });
  });
}
