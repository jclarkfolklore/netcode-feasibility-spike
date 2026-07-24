import Phaser from "phaser";
import { roster } from "../characters/registry";
import type { AnnouncerData, MatchConfig } from "../types";

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super({ key: "Preload" });
  }

  preload(): void {
    this.load.json("announcer", "/data/announcer.json");
  }

  create(): void {
    const announcer = this.cache.json.get("announcer") as AnnouncerData;
    const match = this.registry.get("match") as MatchConfig;

    this.registry.set("roster", Array.from(roster));
    this.registry.set("announcer", announcer);

    if (!match?.p1 || !match?.p2) {
      this.scene.start("Fight", { p1: "qa_goblin", p2: "deploy_friday" });
      return;
    }
    this.scene.start("Fight", match);
  }
}
