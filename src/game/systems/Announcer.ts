import type { AnnouncerData } from "../types";

export class Announcer {
  private cooldown = 0;

  constructor(private data: AnnouncerData) {}

  pick(pool: keyof AnnouncerData): string {
    const lines = this.data[pool];
    return lines[Math.floor(Math.random() * lines.length)] ?? "";
  }

  canSpeak(): boolean {
    return this.cooldown <= 0;
  }

  tick(delta: number): void {
    if (this.cooldown > 0) this.cooldown -= delta;
  }

  speak(pool: keyof AnnouncerData, minCooldownMs = 1200): string | null {
    if (!this.canSpeak()) return null;
    this.cooldown = minCooldownMs;
    return this.pick(pool);
  }

  setCooldown(ms: number): void {
    this.cooldown = ms;
  }
}
