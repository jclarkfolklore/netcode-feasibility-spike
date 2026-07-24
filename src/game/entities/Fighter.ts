import Phaser from "phaser";
import { ARENA } from "../config";
import { isSceneLive } from "../lifecycle";
import { buildRigParts } from "../rig/buildRig";
import { attackSpecFor, resolveCharacterRig } from "../rig/resolveRig";
import type { CharacterDef, CharacterRig, FighterStateKind } from "../types";

export type ActionVisual =
  | "idle"
  | "walk"
  | "block"
  | "charge"
  | "light"
  | "heavy"
  | "special"
  | "hit"
  | "ko";

const ACTION_LABELS: Record<ActionVisual, string> = {
  idle: "",
  walk: "",
  block: "BLOCK",
  charge: "CHARGE",
  light: "JAB",
  heavy: "SMASH",
  special: "SPECIAL",
  hit: "HIT",
  ko: "KO",
};

function formatMoveName(moveId: string): string {
  return moveId.replace(/_/g, " ").toUpperCase();
}

export class Fighter {
  sprite: Phaser.GameObjects.Container;
  body: Phaser.Physics.Arcade.Body;
  health: number;
  maxHealth: number;
  confidence = 100;
  state: FighterStateKind = "idle";
  facingRight: boolean;
  attackTimer = 0;
  hitstunTimer = 0;
  chargeMs = 0;
  specialMeter = 0;
  readonly player: 1 | 2;

  private scene: Phaser.Scene;
  private rig: CharacterRig;
  private bodyVisual: Phaser.GameObjects.Container;
  private uiRoot: Phaser.GameObjects.Container;
  private torso: Phaser.GameObjects.Rectangle;
  private head: Phaser.GameObjects.Rectangle;
  private armL?: Phaser.GameObjects.Rectangle;
  private legL: Phaser.GameObjects.Rectangle;
  private legR: Phaser.GameObjects.Rectangle;
  private punchArm: Phaser.GameObjects.Rectangle;
  private blockShield: Phaser.GameObjects.Rectangle;
  private chargeRing: Phaser.GameObjects.Arc;
  private actionBadge: Phaser.GameObjects.Text;
  private currentVisual: ActionVisual = "idle";
  private isCharging = false;
  private walkPhase = 0;
  private readonly bodyW: number;
  private readonly bodyH: number;
  private readonly primaryColor: number;
  private readonly accentColor: number;

  private get sceneReady(): boolean {
    return isSceneLive(this.scene);
  }

  constructor(
    scene: Phaser.Scene,
    public readonly def: CharacterDef,
    player: 1 | 2,
    x: number,
  ) {
    this.scene = scene;
    this.player = player;
    this.facingRight = player === 1;
    this.rig = resolveCharacterRig(def);
    this.maxHealth = def.stats.health;
    this.health = this.maxHealth;

    const primary = Phaser.Display.Color.HexStringToColor(
      def.colors.primary,
    ).color;
    const accent = Phaser.Display.Color.HexStringToColor(
      def.colors.accent,
    ).color;
    this.primaryColor = primary;
    this.accentColor = accent;

    this.bodyW = this.rig.bodySize.width;
    this.bodyH = this.rig.bodySize.height;

    const parts = buildRigParts(scene, this.rig, primary, accent);
    this.torso = parts.torso as Phaser.GameObjects.Rectangle;
    this.head = parts.head as Phaser.GameObjects.Rectangle;
    this.armL = parts.armL as Phaser.GameObjects.Rectangle | undefined;
    this.legL = parts.legL as Phaser.GameObjects.Rectangle;
    this.legR = parts.legR as Phaser.GameObjects.Rectangle;
    this.punchArm = parts.punchArm as Phaser.GameObjects.Rectangle;
    this.blockShield = parts.blockShield as Phaser.GameObjects.Rectangle;
    this.chargeRing = parts.chargeRing as Phaser.GameObjects.Arc;

    const bodyChildren = [
      this.chargeRing,
      this.torso,
      this.legL,
      this.legR,
      this.armL,
      this.head,
      this.punchArm,
      this.blockShield,
    ].filter(Boolean) as Phaser.GameObjects.GameObject[];

    this.bodyVisual = scene.add.container(0, 0, bodyChildren);
    this.bodyVisual.setScale(this.rig.scale ?? 1);

    // No name label under fighters — players are identified by the React HUD
    // (P1/P2 + name + icon) and a per-player icon marker above each head.
    this.actionBadge = scene.add
      .text(0, -108, "", {
        fontSize: "14px",
        color: "#fbbf24",
        fontFamily: "monospace",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setAlpha(0);

    this.uiRoot = scene.add.container(0, 0, [this.actionBadge]);

    this.sprite = scene.add.container(x, ARENA.floorY - this.bodyH / 2, [
      this.bodyVisual,
      this.uiRoot,
    ]);

    scene.physics.add.existing(this.sprite);
    this.body = this.sprite.body as Phaser.Physics.Arcade.Body;
    this.body.setSize(this.bodyW, this.bodyH);
    this.body.setOffset(-this.bodyW / 2, -this.bodyH / 2);
    this.body.setAllowGravity(false);
    this.body.setCollideWorldBounds(true);
    this.body.setMaxVelocity(def.stats.speed * 55, 800);
    this.body.setDrag(1200, 0);
    this.body.setImmovable(true);

    this.applyFacing();
    this.setVisual("idle");
  }

  // Stage-space y of the top of the fighter (head) — for the React HUD's
  // above-head player marker.
  get headTopY(): number {
    return this.sprite.y - this.bodyH / 2;
  }

  isBlocking(): boolean {
    return this.state === "block";
  }

  isAttackable(): boolean {
    return this.state !== "ko" && this.hitstunTimer <= 0;
  }

  attackReachBonus(): number {
    if (this.def.traits.includes("growing_power") && this.chargeMs > 400) {
      return 20;
    }
    return 0;
  }

  takeDamage(amount: number): void {
    if (this.state === "ko") return;
    this.health = Math.max(0, this.health - amount);
    this.hitstunTimer = 280;
    this.state = "hitstun";
    this.playHitVisual();
    if (this.health <= 0) {
      this.state = "ko";
      this.setVisual("ko");
    }
  }

  drainConfidence(amount: number): void {
    this.confidence = Math.max(0, this.confidence - amount);
  }

  applyKnockback(px: number): void {
    this.body.setVelocityX(px * 12);
  }

  regenConfidence(delta: number): void {
    if (this.state === "idle" && this.confidence < 100) {
      this.confidence = Math.min(100, this.confidence + delta * 0.008);
    }
  }

  addSpecialMeter(amount: number): void {
    this.specialMeter = Math.min(100, this.specialMeter + amount);
  }

  consumeSpecial(): boolean {
    if (this.specialMeter < 50) return false;
    this.specialMeter = 0;
    return true;
  }

  updateFacing(opponentX: number): void {
    if (this.state === "attack" || this.state === "hitstun") return;
    const nextFacing = this.sprite.x < opponentX;
    if (nextFacing !== this.facingRight) {
      this.facingRight = nextFacing;
      this.applyFacing();
    }
  }

  applyFacingForPreview(): void {
    this.applyFacing();
  }

  private applyFacing(): void {
    const flip = this.facingRight ? 1 : -1;
    this.bodyVisual.setScale((this.rig.scale ?? 1) * flip, this.rig.scale ?? 1);
    const punchSpec = this.rig.parts.punchArm;
    const punchX = punchSpec?.offset.x ?? 38;
    this.punchArm.x = punchX * flip;
    this.blockShield.x = this.facingRight ? 34 : -34;
  }

  /** Reset state between preview steps or after KO. */
  forceIdle(): void {
    this.state = "idle";
    this.attackTimer = 0;
    this.hitstunTimer = 0;
    this.isCharging = false;
    if (this.sceneReady) {
      this.resetPose();
      this.currentVisual = "idle";
      this.actionBadge.setAlpha(0);
    }
  }

  restoreHealth(): void {
    this.health = this.maxHealth;
    this.state = "idle";
  }

  tickTimers(delta: number): void {
    if (this.attackTimer > 0) {
      this.attackTimer -= delta;
      if (this.attackTimer <= 0 && this.state === "attack") {
        this.state = "idle";
        this.resetPose();
        this.setVisual("idle");
      }
    }
    if (this.hitstunTimer > 0) {
      this.hitstunTimer -= delta;
      if (this.hitstunTimer <= 0 && this.state === "hitstun") {
        this.state = "idle";
        this.resetColors();
        this.setVisual("idle");
      }
    }
  }

  private resetColors(): void {
    this.torso.setFillStyle(this.primaryColor);
    this.head.setFillStyle(this.accentColor);
    if (this.legL) this.legL.setFillStyle(this.primaryColor);
    if (this.legR) this.legR.setFillStyle(this.primaryColor);
  }

  updateAnimations(delta: number, moving: boolean): void {
    if (!this.sceneReady) return;
    if (this.state === "walk" || moving) {
      this.walkPhase += delta * 0.012;
      this.torso.y = Math.sin(this.walkPhase) * 3;
      if (this.legL && this.legR) {
        this.legL.y =
          (this.rig.parts.legL?.offset.y ?? 52) + Math.sin(this.walkPhase) * 4;
        this.legR.y =
          (this.rig.parts.legR?.offset.y ?? 52) +
          Math.sin(this.walkPhase + Math.PI) * 4;
      }
    } else if (this.state === "idle" && !this.isCharging) {
      this.torso.y = Phaser.Math.Linear(this.torso.y, 0, 0.2);
      if (this.legL)
        this.legL.y = Phaser.Math.Linear(
          this.legL.y,
          this.rig.parts.legL?.offset.y ?? 52,
          0.2,
        );
      if (this.legR)
        this.legR.y = Phaser.Math.Linear(
          this.legR.y,
          this.rig.parts.legR?.offset.y ?? 52,
          0.2,
        );
    }

    if (this.isCharging) {
      const pulse = 1 + Math.sin(this.scene.time.now * 0.012) * 0.08;
      this.chargeRing.setScale(pulse);
    }
  }

  startAttack(kind: "light" | "heavy" | "special", moveId?: string): void {
    const spec = attackSpecFor(this.rig, kind);
    this.state = "attack";
    this.attackTimer = spec.duration + 80;
    const badge =
      kind === "special" && moveId
        ? formatMoveName(moveId)
        : (spec.badgeLabel ??
          ACTION_LABELS[
            kind === "light" ? "light" : kind === "heavy" ? "heavy" : "special"
          ]);
    this.playAttackVisual(kind, spec, badge);
  }

  setBlocking(blocking: boolean): void {
    if (!this.sceneReady || this.state === "ko" || this.state === "hitstun")
      return;
    if (blocking) {
      this.state = "block";
      this.setVisual("block");
      this.scene.tweens.add({
        targets: this.torso,
        y: 6,
        scaleY: 0.92,
        duration: 80,
        ease: "Quad.easeOut",
      });
      this.blockShield.setVisible(true);
      this.blockShield.setAlpha(0);
      this.scene.tweens.add({
        targets: this.blockShield,
        alpha: 0.75,
        duration: 100,
      });
    } else if (this.state === "block") {
      this.state = "idle";
      this.resetPose();
      this.setVisual("idle");
    }
  }

  setCharging(charging: boolean): void {
    if (
      this.state === "ko" ||
      this.state === "hitstun" ||
      this.state === "attack"
    )
      return;
    this.isCharging = charging;
    if (charging) {
      this.setVisual("charge");
      this.chargeRing.setVisible(true);
      this.chargeRing.setAlpha(0.35);
    } else if (this.currentVisual === "charge") {
      this.chargeRing.setVisible(false);
      this.chargeRing.setAlpha(0);
      this.setVisual(this.state === "walk" ? "walk" : "idle");
    }
  }

  setWalking(): void {
    if (this.state === "idle") {
      this.state = "walk";
      if (!this.isCharging) this.setVisual("walk");
    }
  }

  stopWalking(): void {
    if (this.state === "walk") {
      this.state = "idle";
      if (!this.isCharging) this.setVisual("idle");
    }
  }

  damageMultiplier(): number {
    const confMult = 0.65 + (this.confidence / 100) * 0.35;
    return confMult;
  }

  private setVisual(
    action: ActionVisual,
    opts?: { label?: string; holdMs?: number },
  ): void {
    if (!this.sceneReady) return;
    if (action === this.currentVisual && action !== "idle" && !opts?.label)
      return;
    this.currentVisual = action;
    const text = opts?.label ?? ACTION_LABELS[action];
    if (text) {
      this.actionBadge.setText(text);
      this.actionBadge.setAlpha(1);
      this.actionBadge.setScale(0.6);
      const hold = opts?.holdMs ?? (action === "special" ? 900 : 500);
      this.scene.tweens.add({
        targets: this.actionBadge,
        scale: 1,
        alpha: 0,
        duration: hold,
        delay: action === "special" ? 120 : 200,
        ease: "Quad.easeOut",
      });
    }
  }

  private playAttackVisual(
    kind: "light" | "heavy" | "special",
    spec: import("../types").AttackAnimSpec,
    badge: string,
  ): void {
    if (!this.sceneReady) return;
    const visual =
      kind === "light" ? "light" : kind === "heavy" ? "heavy" : "special";
    this.setVisual(visual, { label: badge, holdMs: spec.badgeHoldMs });

    const reach = spec.reach;
    const duration = spec.duration;
    const armY = spec.armY ?? -8;
    const lunge = spec.torsoLunge ?? 10;
    const punchBaseX = this.rig.parts.punchArm?.offset.x ?? 38;

    this.punchArm.setVisible(true);
    this.punchArm.setPosition(
      this.facingRight ? punchBaseX : -punchBaseX,
      armY,
    );
    this.punchArm.setSize(
      reach,
      kind === "heavy" || kind === "special" ? 18 : 14,
    );

    if (kind === "special") {
      this.torso.setFillStyle(0xffffff);
      this.head.setFillStyle(this.accentColor);
      this.chargeRing.setVisible(true);
      this.chargeRing.setAlpha(0.85);
      this.scene.tweens.add({
        targets: this.chargeRing,
        alpha: { from: 0.9, to: 0 },
        scale: { from: 0.7, to: 1.6 },
        duration: duration * 0.85,
      });
      this.scene.tweens.add({
        targets: [this.torso, this.head],
        scaleX: { from: 1, to: 1.12 },
        scaleY: { from: 1, to: 1.08 },
        duration: duration * 0.25,
        yoyo: true,
        ease: "Quad.easeOut",
        onComplete: () => this.resetColors(),
      });
    }

    this.scene.tweens.add({
      targets: this.torso,
      x: this.facingRight ? lunge : -lunge,
      duration: duration * 0.45,
      yoyo: true,
      ease: "Quad.easeOut",
    });

    this.scene.tweens.add({
      targets: this.punchArm,
      x: this.facingRight
        ? punchBaseX + reach * 0.55
        : -punchBaseX - reach * 0.55,
      duration,
      ease: kind === "special" ? "Back.easeOut" : "Quad.easeOut",
      onComplete: () => {
        this.punchArm.setVisible(false);
        this.punchArm.setPosition(
          this.facingRight ? punchBaseX : -punchBaseX,
          -8,
        );
        if (kind !== "special") this.chargeRing.setVisible(false);
      },
    });

    if (spec.ringBurst && kind === "special") {
      const flash = this.scene.add.circle(
        this.sprite.x + (this.facingRight ? 40 : -40),
        this.sprite.y - 20,
        8,
        this.accentColor,
        0.9,
      );
      this.scene.tweens.add({
        targets: flash,
        scale: 12,
        alpha: 0,
        duration: 280,
        onComplete: () => flash.destroy(),
      });
    }
  }

  private playHitVisual(): void {
    this.setVisual("hit");
    this.torso.setFillStyle(0xff6b6b);
    this.head.setFillStyle(0xff8888);
    this.scene.tweens.add({
      targets: [this.torso, this.head],
      angle: { from: 0, to: this.facingRight ? -8 : 8 },
      duration: 60,
      yoyo: true,
      onComplete: () => {
        if (this.state !== "hitstun") this.resetColors();
      },
    });
  }

  private resetPose(): void {
    if (!this.sceneReady) return;
    this.scene.tweens.killTweensOf([
      this.torso,
      this.punchArm,
      this.blockShield,
      this.head,
      this.chargeRing,
    ]);
    this.torso.setPosition(0, 0);
    this.torso.setScale(1, 1);
    this.head.setScale(1, 1);
    this.resetColors();
    this.punchArm.setVisible(false);
    this.blockShield.setVisible(false);
    this.chargeRing.setVisible(false);
    this.chargeRing.setAlpha(0);
    this.isCharging = false;
  }
}
