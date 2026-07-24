import Phaser from "phaser";
import { ARENA, GAME_HEIGHT, GAME_WIDTH } from "../config";
import { Fighter } from "../entities/Fighter";
import { resolveAttack } from "../systems/CombatSystem";
import { PREVIEW_POSITIONS, TRAINING_DUMMY } from "../trainingDummy";
import { previewStepLabel, type PreviewStepId } from "@/lib/characterMeta";
import { getCharacter, roster } from "../characters/registry";
import { pendingPreviewCharacterId } from "../previewMain";
import type { CharacterDef, MoveId } from "../types";

export interface PreviewStepEvent {
  step: PreviewStepId;
  label: string;
  index: number;
  total: number;
}

interface PreviewStepRunner {
  step: PreviewStepId;
  duration: number;
  start: (scene: PreviewScene) => void;
  end?: (scene: PreviewScene) => void;
}

export class PreviewScene extends Phaser.Scene {
  fighter!: Fighter;
  opponent!: Fighter;
  private stepIndex = 0;
  private walkTween?: Phaser.Tweens.Tween;
  private characterId = "";
  private alive = false;

  constructor() {
    super({ key: "Preview" });
  }

  init(): void {
    this.characterId =
      (this.registry.get("previewCharacterId") as string) ||
      pendingPreviewCharacterId ||
      "";
    this.registry.set("previewCharacterId", this.characterId);
  }

  create(): void {
    this.alive = true;

    const def = getCharacter(this.characterId) ?? roster[0];

    if (!def) {
      this.add
        .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, "No fighter data", {
          color: "#f87171",
        })
        .setOrigin(0.5);
      return;
    }

    this.cameras.main.setBackgroundColor("#0b1220");
    this.drawArena(def.colors.primary);

    const floorY = ARENA.floorY - 44;
    this.fighter = new Fighter(this, def, 1, PREVIEW_POSITIONS.fighter);
    this.opponent = new Fighter(
      this,
      TRAINING_DUMMY,
      2,
      PREVIEW_POSITIONS.dummy,
    );
    this.fighter.sprite.y = floorY;
    this.opponent.sprite.y = floorY;
    this.fighter.facingRight = true;
    this.opponent.facingRight = false;
    this.fighter.applyFacingForPreview();
    this.opponent.applyFacingForPreview();

    // Labels (current move, matchup, hint) are rendered cleanly by the React layer,
    // not on the canvas — keeps the preview stage uncluttered like the battle screen.
    this.resetFighters();
    this.stepIndex = 0;
    this.runStepLoop(def);
  }

  update(_time: number, delta: number): void {
    if (!this.alive) return;
    this.fighter.tickTimers(delta);
    this.opponent.tickTimers(delta);
    this.fighter.updateFacing(this.opponent.sprite.x);
    this.opponent.updateFacing(this.fighter.sprite.x);
    const moving =
      this.fighter.body.velocity.x !== 0 || this.walkTween !== undefined;
    this.fighter.updateAnimations(delta, moving);
    this.opponent.updateAnimations(delta, false);
  }

  private drawArena(primaryHex: string): void {
    const g = this.add.graphics();
    g.fillStyle(0x111827, 1);
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    g.fillStyle(0x1e293b, 1);
    g.fillCircle(GAME_WIDTH / 2, ARENA.floorY + 40, 220);
    g.lineStyle(
      3,
      Phaser.Display.Color.HexStringToColor(primaryHex).color,
      0.6,
    );
    g.strokeCircle(GAME_WIDTH / 2, ARENA.floorY + 40, 220);
    g.fillStyle(0x0f172a, 1);
    g.fillRect(0, ARENA.floorY, GAME_WIDTH, GAME_HEIGHT - ARENA.floorY);
  }

  private emitStep(
    def: CharacterDef,
    step: PreviewStepId,
    index: number,
  ): void {
    if (!this.alive) return;
    const label = previewStepLabel(step, def);
    const payload: PreviewStepEvent = {
      step,
      label,
      index,
      total: 7,
    };
    this.game.events.emit("preview-step", payload);
  }

  private runStepLoop(def: CharacterDef): void {
    const runners = this.buildRunners(def);

    const runAt = (idx: number) => {
      if (!this.alive) return;

      const runner = runners[idx % runners.length];
      this.stepIndex = idx % runners.length;
      this.endCurrentStep();
      this.resetFighters();
      this.emitStep(def, runner.step, this.stepIndex);
      runner.start(this);

      this.time.delayedCall(runner.duration, () => {
        if (!this.alive) return;
        runner.end?.(this);
        runAt(idx + 1);
      });
    };

    runAt(0);
  }

  private resetFighters(): void {
    this.fighter.sprite.x = PREVIEW_POSITIONS.fighter;
    this.opponent.sprite.x = PREVIEW_POSITIONS.dummy;
    this.opponent.restoreHealth();
    this.fighter.confidence = 100;
  }

  private endCurrentStep(): void {
    this.walkTween?.stop();
    this.walkTween?.destroy();
    this.walkTween = undefined;

    if (!this.alive) return;

    this.tweens.killTweensOf([this.fighter.sprite, this.opponent.sprite]);
    this.fighter.forceIdle();
    this.opponent.forceIdle();
    this.fighter.body.setVelocityX(0);
    this.opponent.body.setVelocityX(0);
  }

  private scheduleHit(
    attacker: Fighter,
    defender: Fighter,
    moveId: MoveId,
    delayMs: number,
    chargeMult = 1,
  ): void {
    this.time.delayedCall(delayMs, () => {
      if (!this.alive) return;
      resolveAttack(
        attacker,
        defender,
        moveId,
        chargeMult * attacker.damageMultiplier(),
      );
    });
  }

  private buildRunners(def: CharacterDef): PreviewStepRunner[] {
    return [
      {
        step: "idle",
        duration: 1600,
        start: () => {
          /* resetFighters already spaced them */
        },
      },
      {
        step: "walk",
        duration: 2400,
        start: (scene) => {
          scene.fighter.setWalking();
          scene.walkTween = scene.tweens.add({
            targets: scene.fighter.sprite,
            x: PREVIEW_POSITIONS.fighter + 28,
            duration: 2400,
            yoyo: true,
            ease: "Sine.easeInOut",
          });
        },
        end: (scene) => scene.fighter.stopWalking(),
      },
      {
        step: "block",
        duration: 1800,
        start: (scene) => {
          scene.fighter.setBlocking(true);
          scene.time.delayedCall(500, () => {
            if (!scene.alive) return;
            scene.opponent.startAttack("light", "token_overflow");
            scene.scheduleHit(
              scene.opponent,
              scene.fighter,
              "token_overflow",
              220,
              0.8,
            );
          });
        },
        end: (scene) => scene.fighter.setBlocking(false),
      },
      {
        step: "charge",
        duration: 2000,
        start: (scene) => {
          scene.fighter.setCharging(true);
        },
        end: (scene) => scene.fighter.setCharging(false),
      },
      {
        step: "light",
        duration: 1100,
        start: (scene) => {
          scene.fighter.startAttack("light", def.moves.light);
          scene.scheduleHit(
            scene.fighter,
            scene.opponent,
            def.moves.light,
            200,
          );
        },
      },
      {
        step: "heavy",
        duration: 1300,
        start: (scene) => {
          scene.fighter.startAttack("heavy", def.moves.heavy);
          scene.scheduleHit(
            scene.fighter,
            scene.opponent,
            def.moves.heavy,
            280,
            1.15,
          );
        },
      },
      {
        step: "special",
        duration: 1600,
        start: (scene) => {
          scene.fighter.addSpecialMeter(100);
          scene.fighter.startAttack("special", def.moves.special);
          scene.scheduleHit(
            scene.fighter,
            scene.opponent,
            def.moves.special,
            360,
            1.4,
          );
        },
      },
    ];
  }

  shutdown(): void {
    this.alive = false;
    this.time.removeAllEvents();
    this.tweens.killAll();
    this.walkTween?.destroy();
    this.walkTween = undefined;
  }
}
