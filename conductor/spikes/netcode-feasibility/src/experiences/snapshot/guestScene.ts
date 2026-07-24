/**
 * 008.4 — F6: the guest render vehicle. A harness-local, render-ONLY Phaser
 * scene. It constructs real `Fighter` objects (reusing the class for
 * visuals, exactly as the sub-spec's default vehicle calls for) and applies
 * `x/vx/health/state/facing/timers` from incoming snapshots. `update()`
 * never calls `processCombat` — it doesn't even have a `processCombat`; it
 * isn't a `FightScene` subclass at all, so there is no sim here, only a
 * puppet.
 *
 * Two render modes:
 *  - "state-only" (F6 DEFAULT): only primitive fields are assigned. No
 *    `Fighter` mutator that drives a tween (`startAttack`/`setBlocking`/
 *    `setCharging`/`takeDamage`) is ever called. This is the honest,
 *    unglamorous baseline — see the fidelity-gap notes below and on the page.
 *  - "redrive-mutators" (F6 EXPLICIT, SEPARATELY-FLAGGED EXPERIMENT): on a
 *    state transition, re-drives the closest public `Fighter` mutator to
 *    recover SOME pose/tween motion, then re-asserts the snapshot's
 *    authoritative numeric fields afterward (since the mutators' own
 *    internal side effects — e.g. `takeDamage`'s hardcoded 280ms hitstun —
 *    would otherwise silently drift from what the host actually snapshotted).
 */
import Phaser from "phaser";
import { Fighter } from "../../../../../../src/game/entities/Fighter";
import { ARENA, GAME_WIDTH } from "../../../../../../src/game/config";
import type { CharacterDef, FighterStateKind } from "../../../../../../src/game/types";
import type { FighterSnap, Snapshot } from "../../lib/contracts";

export type GuestRenderMode = "state-only" | "redrive-mutators";

/** Minimal fixtures — the guest vehicle doesn't need the real roster, only
 *  something `Fighter`'s constructor (and `resolveCharacterRig`'s default
 *  fallback) accepts. No `rig` override -> falls back to `DEFAULT_RIG`. */
const GUEST_FIGHTER_DEFS: [CharacterDef, CharacterDef] = [
  {
    id: "snapshot-guest-p1",
    name: "Guest P1",
    tagline: "snapshot-experience render puppet",
    icon: "snapshot",
    stats: { health: 100, speed: 5, power: 10, defense: 5 },
    traits: [],
    moves: { light: "token_overflow", heavy: "hotfix_fury", special: "production_push" },
    colors: { primary: "#38bdf8", accent: "#0ea5e9" },
  },
  {
    id: "snapshot-guest-p2",
    name: "Guest P2",
    tagline: "snapshot-experience render puppet",
    icon: "snapshot",
    stats: { health: 100, speed: 5, power: 10, defense: 5 },
    traits: [],
    moves: { light: "context_loss", heavy: "rollback_denied", special: "regression_strike" },
    colors: { primary: "#f472b6", accent: "#ec4899" },
  },
];

export class SnapshotGuestScene extends Phaser.Scene {
  fighterP1!: Fighter;
  fighterP2!: Fighter;
  mode: GuestRenderMode = "state-only";

  private prevState: [FighterStateKind, FighterStateKind] = ["idle", "idle"];
  private prevCharge: [number, number] = [0, 0];
  private appliedTicks = 0;

  constructor() {
    super({ key: "SnapshotGuest" });
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#160f26");
    const g = this.add.graphics();
    g.fillStyle(0x0f172a, 1);
    g.fillRect(0, ARENA.floorY, GAME_WIDTH, 200);
    g.lineStyle(2, 0x475569, 1);
    g.lineBetween(ARENA.leftBound, ARENA.floorY, ARENA.rightBound, ARENA.floorY);

    this.fighterP1 = new Fighter(this, GUEST_FIGHTER_DEFS[0], 1, Math.round(GAME_WIDTH * 0.33));
    this.fighterP2 = new Fighter(this, GUEST_FIGHTER_DEFS[1], 2, Math.round(GAME_WIDTH * 0.67));
  }

  /** Render-only: no scene-owned sim, no input, no `processCombat` — nothing to tick besides what `applySnapshot` sets. */
  update(): void {
    /* intentionally empty */
  }

  get ticksApplied(): number {
    return this.appliedTicks;
  }

  applySnapshot(snap: Snapshot): void {
    this.applyOne(this.fighterP1, snap.fighters[0], 0);
    this.applyOne(this.fighterP2, snap.fighters[1], 1);
    this.appliedTicks += 1;
  }

  private applyOne(f: Fighter, snap: FighterSnap, idx: 0 | 1): void {
    const prevState = this.prevState[idx];
    const prevCharge = this.prevCharge[idx];

    // Authoritative baseline — always applied, both modes.
    f.sprite.x = snap.x;
    f.body.setVelocityX(snap.vx);
    f.health = snap.health;
    f.confidence = snap.confidence;
    f.specialMeter = snap.special;
    f.attackTimer = snap.attackTimer;
    f.hitstunTimer = snap.hitstunTimer;
    f.chargeMs = snap.chargeMs;
    f.state = snap.state;
    if (f.facingRight !== snap.facingRight) {
      f.facingRight = snap.facingRight;
      f.applyFacingForPreview();
    }

    if (this.mode === "redrive-mutators") {
      this.redrive(f, prevState, snap.state, prevCharge, snap.chargeMs);
      // Re-assert: the mutators just called have their OWN internal opinions
      // about health/timers (e.g. takeDamage() always sets hitstunTimer=280
      // and derives health by subtracting its `amount` argument, which we
      // don't actually know — the snapshot doesn't carry damage dealt, only
      // resulting health). Re-applying the authoritative numbers keeps the
      // LOGICAL state correct; the tweens/visuals that already started keep
      // running on the mutator's own (possibly wrong) assumptions — THAT
      // mismatch is the honest, remaining fidelity gap even in this mode.
      f.health = snap.health;
      f.attackTimer = snap.attackTimer;
      f.hitstunTimer = snap.hitstunTimer;
      f.chargeMs = snap.chargeMs;
      f.state = snap.state;
    }

    this.prevState[idx] = snap.state;
    this.prevCharge[idx] = snap.chargeMs;
  }

  /**
   * EXPERIMENTAL, explicitly flagged (F6) — approximate by construction:
   * the frozen Snapshot schema (contracts.md §3) carries neither attack kind
   * nor move id, so an "attack" transition can only ever guess a generic
   * light attack here, never the host's real move.
   */
  private redrive(
    f: Fighter,
    prevState: FighterStateKind,
    nextState: FighterStateKind,
    prevCharge: number,
    nextCharge: number,
  ): void {
    if (nextState === "attack" && prevState !== "attack") {
      f.startAttack("light");
    } else if (nextState === "block" && prevState !== "block") {
      f.setBlocking(true);
    } else if (prevState === "block" && nextState !== "block") {
      f.setBlocking(false);
    } else if (nextState === "hitstun" && prevState !== "hitstun") {
      // takeDamage(amount) both plays the hit tween AND mutates health/
      // hitstunTimer using its own math — call it, then the caller
      // re-asserts the real numbers immediately after.
      f.takeDamage(1);
    }

    if (prevCharge === 0 && nextCharge > 0) {
      f.setCharging(true);
    } else if (prevCharge > 0 && nextCharge === 0) {
      f.setCharging(false);
    }
  }
}
