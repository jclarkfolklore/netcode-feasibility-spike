/**
 * Shared demo choreography — makes the live demos show a REAL fight (moves,
 * blocks, damage, meter, KO) with no keyboard input, so what's on screen looks
 * like a match and the wire carries real fight state (DESIGN-PHILOSOPHY.md §10,
 * UX-REVIEW W1.1).
 *
 * Two drivers, one per demo's available seam:
 *  - Snapshot demo: no input seam exists (008.4 scope) — puppeteer the host's
 *    two `Fighter` instances through their PUBLIC mutators (the same technique
 *    `PreviewScene` / the automated `snapshotExperience` already use), looped.
 *  - E2E demo: an input seam exists — synthesize the same `PlayerInput` a
 *    keypress would produce (see `e2eDemoInput`), fed through the real
 *    `RemoteInput` / `InputProvider` path.
 *
 * No `src/game` file is edited: these only CALL public methods / build public
 * input structs. Human keypresses always take precedence (callers pause the
 * bot for a short window after any real input).
 */
import Phaser from "phaser";
import { LocalKeyboardInput, type InputProvider } from "../../../../../src/game/systems/InputManager";
import type { Fighter } from "../../../../../src/game/entities/Fighter";
import type { PlayerInput } from "../../../../../src/game/types";

/** Pause the bot for this long after any real keypress (humans win, DP §10). */
export const DEMO_HUMAN_OVERRIDE_MS = 5000;

// ---------------------------------------------------------------------------
// Snapshot demo — public-mutator fight choreography
// ---------------------------------------------------------------------------

/** Minimal surface the choreography needs from the host scene (read-only). */
interface DemoScene {
  fighters: [Fighter, Fighter];
}

/** One tick of the loop. Length ≈ 13s @ 60Hz — a full exchange ending in a KO. */
export const SNAPSHOT_DEMO_LOOP_TICKS = 780;

type ScriptStep = { at: number; run: (p1: Fighter, p2: Fighter) => void };

/**
 * A fixed cadence of public-API actions → real state/pose/meter/damage variety.
 * Driving `takeDamage` directly sets a real `ko` pose WITHOUT tripping the
 * scene's win/rematch state machine (that only fires inside `processCombat`,
 * which this harness never calls), so `restoreHealth()` cleanly starts the
 * next round and the loop sustains itself indefinitely.
 */
const SNAPSHOT_SCRIPT: ScriptStep[] = [
  { at: 30, run: (p1) => p1.setCharging(true) },
  { at: 70, run: (p1) => { p1.setCharging(false); p1.startAttack("light", "demo_jab"); p1.addSpecialMeter(10); } },
  { at: 80, run: (_p1, p2) => p2.setBlocking(true) },
  { at: 100, run: (_p1, p2) => { p2.setBlocking(false); p2.takeDamage(7); } },
  { at: 130, run: (_p1, p2) => { p2.startAttack("heavy", "demo_smash"); p2.addSpecialMeter(16); } },
  { at: 160, run: (p1) => p1.takeDamage(12) },
  { at: 200, run: (p1) => p1.setBlocking(true) },
  { at: 230, run: (p1) => { p1.setBlocking(false); p1.startAttack("light", "demo_jab"); p1.addSpecialMeter(10); } },
  { at: 250, run: (_p1, p2) => p2.takeDamage(8) },
  { at: 300, run: (_p1, p2) => p2.setCharging(true) },
  { at: 340, run: (_p1, p2) => { p2.setCharging(false); p2.startAttack("light", "demo_jab"); p2.addSpecialMeter(12); } },
  { at: 360, run: (p1) => p1.takeDamage(9) },
  { at: 410, run: (p1) => { p1.startAttack("heavy", "demo_smash"); p1.addSpecialMeter(16); } },
  { at: 440, run: (_p1, p2) => p2.takeDamage(14) },
  { at: 500, run: (_p1, p2) => { p2.startAttack("light", "demo_jab"); p2.addSpecialMeter(12); } },
  { at: 520, run: (p1) => p1.takeDamage(10) },
  { at: 580, run: (p1) => p1.setCharging(true) },
  { at: 660, run: (p1) => { p1.setCharging(false); p1.startAttack("special", "demo_finisher"); p1.addSpecialMeter(50); } },
  { at: 690, run: (_p1, p2) => p2.takeDamage(9999) }, // finishing blow → real KO pose
  { at: 760, run: (p1, p2) => { p1.restoreHealth(); p2.restoreHealth(); } }, // round reset
];

/**
 * Drive one tick of the looping demo fight on the host scene. `tick` is the
 * host's monotonic tick counter; the choreography is keyed on `tick % LOOP`,
 * so it self-repeats. Safe to call every host tick.
 */
export function driveSnapshotDemo(scene: DemoScene, tick: number): void {
  const [p1, p2] = scene.fighters;
  if (!p1 || !p2) return;
  const r = tick % SNAPSHOT_DEMO_LOOP_TICKS;
  for (const step of SNAPSHOT_SCRIPT) {
    if (step.at === r) step.run(p1, p2);
  }
}

// ---------------------------------------------------------------------------
// E2E demo — synthesized-input fight choreography
// ---------------------------------------------------------------------------

const NEUTRAL: PlayerInput = {
  left: false,
  right: false,
  block: false,
  light: false,
  heavy: false,
  charge: false,
  special: false,
};

/** E2E choreography loop length ≈ 10s @ 60Hz. */
export const E2E_DEMO_LOOP_TICKS = 600;

/**
 * The demo input for one fighter on one tick, as a real `PlayerInput`. Edge
 * actions (`light`/`heavy`/`special`) are true on exactly ONE tick so they read
 * as a single press, matching `InputManager`'s `JustDown` semantics. `phase`
 * offsets the two fighters so they trade blows instead of mirroring.
 *
 * Returns a fresh object each call (never the shared NEUTRAL) so callers may
 * mutate freely.
 */
export function e2eDemoInput(tick: number, phase: number): PlayerInput {
  const r = (tick + phase) % E2E_DEMO_LOOP_TICKS;
  const input: PlayerInput = { ...NEUTRAL };

  // Footsies — keep the fighters ROAMING the stage most of the loop (advance /
  // retreat / reposition). Movement is the transferable state, so this is what
  // makes the guest visibly mirror the host and the round-trip legible.
  if ((r >= 0 && r < 90) || (r >= 240 && r < 300) || (r >= 480 && r < 540)) input.right = true;
  else if ((r >= 120 && r < 180) || (r >= 360 && r < 430)) input.left = true;

  // Blocks (held) over the windows where the opponent is attacking.
  if ((r >= 190 && r < 215) || (r >= 545 && r < 570)) input.block = true;

  // Charge toward a special while backing off.
  if (r >= 360 && r < 430) input.charge = true;

  // Edge attacks — one tick each, spaced so both fighters land hits.
  if (r === 95 || r === 305 || r === 545) input.light = true;
  if (r === 100 || r === 430) input.heavy = true;
  if (r === 431) input.special = true;

  return input;
}

/** True on exactly the ticks where `e2eDemoInput` fires an edge action. */
export function e2eDemoHasEdge(input: PlayerInput): boolean {
  return input.light || input.heavy || input.special;
}

/** Phase offsets so the two fighters trade blows instead of mirroring. */
export const E2E_HOST_PHASE = 0;
export const E2E_GUEST_PHASE = Math.floor(E2E_DEMO_LOOP_TICKS / 2);

/**
 * Builds an `InputProvider` that drives a fighter with the demo choreography,
 * but yields to a real human: for `DEMO_HUMAN_OVERRIDE_MS` after the most
 * recent keypress (`lastHumanAt()`), it returns the real keyboard input
 * instead. The provider is constructed INSIDE the scene (it needs the scene for
 * `LocalKeyboardInput`), so callers pass a factory to the boot config.
 *
 * `getInput` is called at most once per tick per player, so the internal tick
 * counter advances one frame per call — matching `JustDown` edge semantics.
 */
export function createE2EBotProvider(
  scene: Phaser.Scene,
  phase: number,
  lastHumanAt: () => number,
): InputProvider {
  const realKeyboard = new LocalKeyboardInput(scene);
  let botTick = 0;
  return {
    getInput(player: 1 | 2): PlayerInput {
      // Always sample the real keyboard so JustDown edges are consumed and
      // never fire late, even while the bot is driving.
      const real = realKeyboard.getInput(player);
      botTick += 1;
      if (performance.now() - lastHumanAt() < DEMO_HUMAN_OVERRIDE_MS) return real;
      return e2eDemoInput(botTick, phase);
    },
  };
}

/**
 * Snapshot-demo provider: drives BOTH fighters through the real combat by
 * routing each player's input from the choreography (phase-offset so they trade
 * blows AND move around the stage). Movement (X position) is the state that
 * transfers over the wire, so the guest visibly mirrors it a beat later — the
 * whole point of the round-trip demo. Yields to a real keypress for
 * `DEMO_HUMAN_OVERRIDE_MS`. `getTick` returns the host scene's current tick,
 * stable within a frame across the per-player getInput calls.
 */
export function createSnapshotBotProvider(
  scene: Phaser.Scene,
  getTick: () => number,
  lastHumanAt: () => number,
): InputProvider {
  const realKeyboard = new LocalKeyboardInput(scene);
  return {
    getInput(player: 1 | 2): PlayerInput {
      const real = realKeyboard.getInput(player);
      if (performance.now() - lastHumanAt() < DEMO_HUMAN_OVERRIDE_MS) return real;
      const phase = player === 1 ? E2E_HOST_PHASE : E2E_GUEST_PHASE;
      return e2eDemoInput(getTick(), phase);
    },
  };
}
