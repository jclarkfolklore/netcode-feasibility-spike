/**
 * 008.4 — the two-games-in-one-page constraint (research.md §A / contracts
 * §7): `src/game/instances.ts`'s `createGame` tears down ANY prior Phaser
 * game (its own module-level singleton) before starting a new one, so it
 * cannot be used here — a host AND a guest game must coexist. Per the
 * sub-spec's instruction, this harness instantiates `new Phaser.Game`
 * directly, bypassing `createGame`/`instances.ts` entirely (never imported),
 * each with its OWN DOM parent, so neither touches the other's lifecycle.
 */
import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH } from "../../../../../../src/game/config";
import { BootScene } from "../../../../../../src/game/scenes/BootScene";
import { PreloadScene } from "../../../../../../src/game/scenes/PreloadScene";
import type { MatchConfig } from "../../../../../../src/game/types";
import { NET_SNAPSHOT_EVENT, SnapshotHostScene, type SnapshotDemoConfig } from "./hostScene";
import { SnapshotGuestScene } from "./guestScene";

const HOST_MATCH_CONFIG: MatchConfig = {
  p1: "qa_goblin",
  p2: "deploy_friday",
  stage: "",
  mode: "online",
};

export interface HostGameHandle {
  game: Phaser.Game;
  scene: SnapshotHostScene;
  destroy(): void;
}

export interface GuestGameHandle {
  game: Phaser.Game;
  scene: SnapshotGuestScene;
  destroy(): void;
}

/**
 * Boots the REAL sim (`BootScene` -> `PreloadScene` -> the harness's
 * `SnapshotHostScene extends FightScene`) into `parent`, so
 * `/data/announcer.json` loads exactly as it does in the real game (008.2
 * serves it). Resolves once the first snapshot has been produced — proof
 * the scene chain reached a live, ticking `FightScene.update()`.
 */
export function bootHostGame(
  parent: HTMLElement,
  opts: { signal?: AbortSignal; localSource?: SnapshotDemoConfig["localSource"] } = {},
): Promise<HostGameHandle> {
  const { signal, localSource } = opts;
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
      scene: [BootScene, PreloadScene, SnapshotHostScene],
    });
    game.registry.set("match", HOST_MATCH_CONFIG);
    game.registry.set("transparent", false);
    game.registry.set("snapshotDemoConfig", { localSource } satisfies SnapshotDemoConfig);

    const onAbort = () => {
      game.destroy(true);
      reject(new Error("aborted while waiting for host game to boot"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    game.events.once(NET_SNAPSHOT_EVENT, () => {
      signal?.removeEventListener("abort", onAbort);
      const scene = game.scene.getScene("Fight") as unknown as SnapshotHostScene;
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

/**
 * Boots the harness-local render-only guest scene. No asset preload is
 * needed (Fighter draws primitive Phaser shapes, no textures), so this
 * resolves as soon as the scene's `create()` has run.
 */
export function bootGuestGame(parent: HTMLElement): Promise<GuestGameHandle> {
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
      scene: [SnapshotGuestScene],
    });

    game.events.once(Phaser.Core.Events.READY, () => {
      // SnapshotGuestScene.create() runs synchronously during boot once the
      // scene plugin starts it; poll a few rAFs to be safe across browsers.
      const wait = () => {
        const scene = game.scene.getScene("SnapshotGuest") as unknown as SnapshotGuestScene;
        if (scene?.fighterP1 && scene?.fighterP2) {
          resolve({
            game,
            scene,
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
