import type Phaser from "phaser";

/** Clear Phaser canvas nodes before mounting a new game on the same DOM parent. */
export function clearGameParent(parent: HTMLElement): void {
  parent.replaceChildren();
}

/** Whether a Phaser scene is safe to touch (timers/tweens/game objects). */
export function isSceneLive(scene: Phaser.Scene): boolean {
  return Boolean(scene.sys?.isActive());
}
