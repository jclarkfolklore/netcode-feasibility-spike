/**
 * 008.6 — headless scripted drive for the determinism-cost experience.
 *
 * Per the sub-spec's Review resolution F8: the reproducibility demo MUST be
 * a headless scripted drive, never a live sim run. Two reasons, both
 * verified against the current source (no `src/` file is imported for
 * mutation, only read for types/functions):
 *
 *   1. `resolveAttack` (`src/game/systems/CombatSystem.ts:38-90`) calls
 *      `Math.random()` directly (`:52`, `:58`) and takes no RNG parameter —
 *      threading a seed through its signature would be a `src/` change,
 *      which is out of scope. Instead we monkey-patch the GLOBAL
 *      `Math.random` around the call, then restore it — harness-side only.
 *   2. A *live* `FightScene` run diverges even with seeded RNG, because
 *      charge (`chargeMs`) and confidence/timers accumulate real,
 *      variable `requestAnimationFrame` `delta` and feed back into damage
 *      (`getChargeMultiplier`, `Fighter.attackReachBonus`,
 *      `Fighter.damageMultiplier`) — determinism only holds under a FIXED
 *      synthetic timestep + a scripted input tape, which a live browser
 *      loop cannot give us. So this harness fabricates both: a fixed tick
 *      duration standing in for a hypothetical fixed-step engine, and a
 *      pre-scripted sequence of attacks (no live keyboard/network input).
 *
 * Non-determinism sources enumerated (verified against current source,
 * 2026-07-23):
 *   - `src/game/systems/CombatSystem.ts:52` — `Math.random() < 0.25` crit
 *     roll (gated on the `hallucination_crit` trait).
 *   - `src/game/systems/CombatSystem.ts:58` — `Math.random() < 0.1`
 *     bug-prone damage-reduction roll (gated on the `bug_prone` trait).
 *   - `src/game/systems/Announcer.ts:10` — `Math.floor(Math.random() *
 *     lines.length)` announcer line-pick.
 *   - Variable timestep, structural: every timer in `Fighter.ts`
 *     (`tickTimers` `:253-270`, `regenConfidence` `:197-201`,
 *     `updateAnimations` `:279-311`) and `Announcer.tick` (`:17-19`) is
 *     keyed on the real, variable `delta` passed in from Phaser's
 *     `update(time, delta)` — there is no tick counter anywhere in
 *     `src/game`, so two runs of the same input sequence at different
 *     frame rates (or with the same frame rate but different
 *     scheduler jitter) accumulate different intermediate timer values
 *     and can diverge in outcome even with seeded RNG.
 *   - Physics/floating point, structural: canonical position/velocity
 *     live in a Phaser `Arcade.Body` (`Fighter.ts:142-150`), stepped by
 *     Phaser's Arcade physics on the engine's own (non-fixed-step-locked)
 *     update — floating-point drift and non-fixed-step integration are
 *     not bitwise-reproducible across runs/machines without converting to
 *     a fixed-point or fixed-step-locked physics step.
 */

import { resolveAttack, getChargeMultiplier, type AttackResult } from "../../../../../../src/game/systems/CombatSystem";
import { Announcer } from "../../../../../../src/game/systems/Announcer";
import type { CharacterDef, MoveId, AnnouncerData } from "../../../../../../src/game/types";
import type { Fighter } from "../../../../../../src/game/entities/Fighter";

/** Stands in for a hypothetical fixed-step engine tick, 60Hz. */
export const FIXED_DT_MS = 1000 / 60;

/**
 * The exact surface `resolveAttack` touches on a `Fighter`
 * (verified against `src/game/entities/Fighter.ts`): `sprite.x` (`:36`),
 * `isBlocking()` (`:162-164`), `takeDamage()` (`:177-187`), `def`
 * (`:76` — the constructor param), `facingRight` (`:42`),
 * `attackReachBonus()` (`:170-175`), `drainConfidence()` (`:189-191`),
 * `applyKnockback()` (`:193-195`). `Fighter` cannot be constructed
 * headlessly (its constructor requires a live `Phaser.Scene` and builds
 * real GameObjects), so this stub satisfies the same call surface without
 * a scene, and is cast to `Fighter` at the `resolveAttack` call site —
 * the same "Fighter-shaped stub" the sub-spec calls for.
 */
export interface FighterStub {
  sprite: { x: number };
  def: CharacterDef;
  facingRight: boolean;
  health: number;
  blocking: boolean;
  chargeMs: number;
  confidenceDrained: number;
  knockbackLog: number[];
  isBlocking(): boolean;
  takeDamage(amount: number): void;
  attackReachBonus(): number;
  drainConfidence(amount: number): void;
  applyKnockback(px: number): void;
}

export function createFighterStub(def: CharacterDef, x: number, facingRight: boolean): FighterStub {
  return {
    sprite: { x },
    def,
    facingRight,
    health: def.stats.health,
    blocking: false,
    chargeMs: 0,
    confidenceDrained: 0,
    knockbackLog: [],
    isBlocking() {
      return this.blocking;
    },
    takeDamage(amount: number) {
      this.health = Math.max(0, this.health - amount);
    },
    attackReachBonus() {
      // Mirrors Fighter.ts:170-175 exactly: +20 reach once charge exceeds
      // 400ms, gated on the `growing_power` trait.
      if (this.def.traits.includes("growing_power") && this.chargeMs > 400) {
        return 20;
      }
      return 0;
    },
    drainConfidence(amount: number) {
      this.confidenceDrained += amount;
    },
    applyKnockback(px: number) {
      this.knockbackLog.push(px);
    },
  };
}

/** Minimal-but-real `Math.random` monkey-patch, always restored. Never touches `src/`. */
export function withSeededRandom<T>(seed: number, fn: () => T): T {
  const original = Math.random;
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

/** mulberry32 — small, fast, deterministic PRNG (public-domain algorithm). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One scripted, pre-authored attack — the "input tape" (no live input). */
export interface ScriptedFrame {
  attackerPlayer: 1 | 2;
  moveId: MoveId;
  /** Fixed synthetic ticks of charge accumulated before this attack, at `FIXED_DT_MS` each. */
  chargeTicks: number;
  /** Fixed synthetic distance (px) between attacker and defender for this attack. */
  distance: number;
  /** Whether the defender is scripted to be blocking this attack. */
  defenderBlocking: boolean;
}

export interface TapeRunResult {
  events: AttackResult[];
  p1Health: number;
  p2Health: number;
  winner: 0 | 1 | 2;
}

/**
 * Drives `resolveAttack` through a scripted tape under a seeded
 * `Math.random`. Same seed + same tape => identical `TapeRunResult`
 * (deep-equal). Different seed => the crit/bug-prone rolls can differ,
 * which can cascade into different damage/KO outcomes.
 */
export function runScriptedTape(
  seed: number,
  frames: ScriptedFrame[],
  charDefs: [CharacterDef, CharacterDef],
): TapeRunResult {
  const p1 = createFighterStub(charDefs[0], 100, true);
  const p2 = createFighterStub(charDefs[1], 160, false);

  const events = withSeededRandom(seed, () => {
    const results: AttackResult[] = [];
    for (const frame of frames) {
      const attacker = frame.attackerPlayer === 1 ? p1 : p2;
      const defender = frame.attackerPlayer === 1 ? p2 : p1;

      attacker.chargeMs = frame.chargeTicks * FIXED_DT_MS;
      defender.blocking = frame.defenderBlocking;
      defender.sprite.x = attacker.sprite.x + (attacker.facingRight ? frame.distance : -frame.distance);

      const chargeMultiplier = getChargeMultiplier(attacker.chargeMs);
      const result = resolveAttack(
        attacker as unknown as Fighter,
        defender as unknown as Fighter,
        frame.moveId,
        chargeMultiplier,
      );
      results.push(result);
    }
    return results;
  });

  const winner: 0 | 1 | 2 = p1.health <= 0 ? 2 : p2.health <= 0 ? 1 : 0;
  return { events, p1Health: p1.health, p2Health: p2.health, winner };
}

/**
 * Same headless-drive technique applied to the third RNG site
 * (`Announcer.ts:10`). `Announcer` takes no `src/`-side dependency beyond
 * plain data, so it is used directly (no stub needed) — only `Math.random`
 * is patched.
 */
export function runAnnouncerPick(seed: number, data: AnnouncerData, pool: keyof AnnouncerData): string {
  const announcer = new Announcer(data);
  return withSeededRandom(seed, () => announcer.pick(pool));
}

/** Synthetic character fixtures exercising both RNG-gated traits. */
export const SYNTHETIC_CHAR_DEFS: [CharacterDef, CharacterDef] = [
  {
    id: "synthetic-crit",
    name: "Synthetic Critter",
    tagline: "determinism-harness fixture",
    icon: "synthetic",
    stats: { health: 100, speed: 5, power: 10, defense: 5 },
    traits: ["hallucination_crit", "growing_power"],
    moves: { light: "token_overflow", heavy: "hotfix_fury", special: "production_push" },
    colors: { primary: "#888888", accent: "#cccccc" },
  },
  {
    id: "synthetic-bugprone",
    name: "Synthetic Buggy",
    tagline: "determinism-harness fixture",
    icon: "synthetic",
    stats: { health: 100, speed: 5, power: 10, defense: 5 },
    traits: ["bug_prone", "strong_block"],
    moves: { light: "context_loss", heavy: "rollback_denied", special: "regression_strike" },
    colors: { primary: "#444444", accent: "#999999" },
  },
];

/** The canonical scripted tape used by both the demo page and its test. */
export const DEMO_TAPE: ScriptedFrame[] = [
  { attackerPlayer: 1, moveId: "hotfix_fury", chargeTicks: 0, distance: 40, defenderBlocking: false },
  { attackerPlayer: 2, moveId: "rollback_denied", chargeTicks: 10, distance: 40, defenderBlocking: false },
  { attackerPlayer: 1, moveId: "production_push", chargeTicks: 40, distance: 30, defenderBlocking: true },
  { attackerPlayer: 2, moveId: "regression_strike", chargeTicks: 0, distance: 200, defenderBlocking: false },
  { attackerPlayer: 1, moveId: "hotfix_fury", chargeTicks: 80, distance: 40, defenderBlocking: false },
  { attackerPlayer: 2, moveId: "rollback_denied", chargeTicks: 20, distance: 40, defenderBlocking: false },
  { attackerPlayer: 1, moveId: "hotfix_fury", chargeTicks: 0, distance: 45, defenderBlocking: false },
  { attackerPlayer: 2, moveId: "rollback_denied", chargeTicks: 0, distance: 45, defenderBlocking: false },
];
