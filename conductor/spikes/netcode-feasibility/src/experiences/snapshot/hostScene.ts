/**
 * 008.4 — the host side: the REAL `FightScene` (imported read-only from
 * `src/game`), subclassed harness-side only to hook a per-tick snapshot
 * producer onto its existing `update()` loop. No `src/` file is edited; this
 * mirrors the subclass technique contracts.md §7 already sanctions for
 * 008.5's input seam.
 */
import { FightScene } from "../../../../../../src/game/scenes/FightScene";
import type { InputProvider } from "../../../../../../src/game/systems/InputManager";
import type { Fighter } from "../../../../../../src/game/entities/Fighter";
import { captureSnapshot } from "./snapshotCodec";

/** Event name emitted on `this.game.events` once per tick with the produced `Snapshot`. */
export const NET_SNAPSHOT_EVENT = "net-snapshot";

/** Registry config (optional). Lets the interactive demo drive real movement
 * through the game's own combat by swapping the input source (a harness-side
 * seam, mirroring `NetFightScene`; the automated run leaves it unset). */
export interface SnapshotDemoConfig {
  localSource?: (scene: SnapshotHostScene) => InputProvider;
}

export class SnapshotHostScene extends FightScene {
  private tick = 0;
  // Real input isn't wired in 008.4 (008.5's scope) — stub the seq source by
  // counting every tick as one incorporated input frame per player, per the
  // sub-spec's explicit instruction. This is NOT a measurement of anything;
  // it exists so p1LastInputSeq/p2LastInputSeq are present and monotonic on
  // the wire, ready for 008.5 to replace with the real RemoteInput counters.
  private p1Seq = 0;
  private p2Seq = 0;

  create(): void {
    super.create();
    // Optional demo input seam: swap the inherited keyboard provider so a bot
    // can drive real movement/combat. Absent for the automated run (fighters
    // stay idle there, puppeteered by the experiment's mutator script instead).
    const cfg = this.registry.get("snapshotDemoConfig") as SnapshotDemoConfig | undefined;
    if (cfg?.localSource) {
      (this as unknown as { keyboard: InputProvider }).keyboard = cfg.localSource(this);
    }
  }

  update(time: number, delta: number): void {
    super.update(time, delta);
    this.tick += 1;
    this.p1Seq += 1;
    this.p2Seq += 1;
    const snapshot = captureSnapshot(this, this.tick, performance.now(), this.p1Seq, this.p2Seq);
    this.game.events.emit(NET_SNAPSHOT_EVENT, snapshot);
  }

  /**
   * Exposes the two live `Fighter` instances so an external driver (the
   * automated experiment / the interactive page) can puppeteer varied fight
   * states — `startAttack`/`setBlocking`/`setCharging`/`takeDamage` are all
   * public `Fighter` methods, called the exact same way
   * `src/game/scenes/PreviewScene.ts` already calls them externally.
   * `CombatSystem.processCombat` is never invoked by this harness — only the
   * scene's own inherited `update()` (via `super.update()` above) runs it,
   * driven by whatever `InputProvider` is wired (keyboard, by default, since
   * 008.4 doesn't touch input — 008.5's scope).
   */
  get fighters(): [Fighter, Fighter] {
    const s = this as unknown as { p1: Fighter; p2: Fighter };
    return [s.p1, s.p2];
  }

  get currentTick(): number {
    return this.tick;
  }
}
