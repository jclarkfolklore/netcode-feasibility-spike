import Phaser from "phaser";
import { ARENA, GAME_HEIGHT, GAME_WIDTH } from "../config";
import { Fighter } from "../entities/Fighter";
import { Announcer } from "../systems/Announcer";
import {
  characterById,
  getChargeMultiplier,
  resolveAttack,
} from "../systems/CombatSystem";
import { LocalKeyboardInput } from "../systems/InputManager";
import { TRAINING_DUMMY } from "../trainingDummy";
import type {
  AnnouncerData,
  CharacterDef,
  FightHudState,
  MatchConfig,
  MoveId,
  PlayerInput,
} from "../types";

export class FightScene extends Phaser.Scene {
  private p1!: Fighter;
  private p2!: Fighter;
  private keyboard!: LocalKeyboardInput;
  private announcer!: Announcer;
  private announcerText!: Phaser.GameObjects.Text;
  private countdown = 3;
  private fighting = false;
  private winner: 1 | 2 | null = null;
  private round = 1;
  private chargeP1 = 0;
  private chargeP2 = 0;
  private pendingAttack: {
    attacker: Fighter;
    defender: Fighter;
    move: MoveId;
    chargeMs: number;
    attackKind: "light" | "heavy" | "special";
  } | null = null;

  constructor() {
    super({ key: "Fight" });
  }

  init(data: MatchConfig): void {
    this.registry.set("match", data);
  }

  create(): void {
    // scene.restart() reuses this instance, so reset round state explicitly
    // (field initializers only run once, at construction).
    this.countdown = 3;
    this.fighting = false;
    this.winner = null;
    this.chargeP1 = 0;
    this.chargeP2 = 0;
    this.pendingAttack = null;

    const roster = this.registry.get("roster") as CharacterDef[];
    const announcerData = this.registry.get("announcer") as AnnouncerData;
    const match = this.registry.get("match") as MatchConfig;

    // "Try in arena" pits the player against the training dummy, which lives
    // outside the roster — resolve it explicitly so it can be an opponent.
    const resolveFighter = (charId: string): CharacterDef | undefined =>
      charId === TRAINING_DUMMY.id
        ? TRAINING_DUMMY
        : characterById(roster, charId);

    const p1Def = resolveFighter(match.p1) ?? roster[0];
    const p2Def = resolveFighter(match.p2) ?? roster[1];

    const transparent = this.registry.get("transparent") === true;
    if (!transparent) this.cameras.main.setBackgroundColor("#0b1220");
    this.drawArena(transparent);

    // Start positions match the style research arena (P1 at 33%, P2 at 67% of the
    // 960-wide stage) so future WebGPU backgrounds align with the fighters.
    this.p1 = new Fighter(this, p1Def, 1, Math.round(GAME_WIDTH * 0.33));
    this.p2 = new Fighter(this, p2Def, 2, Math.round(GAME_WIDTH * 0.67));

    this.keyboard = new LocalKeyboardInput(this);
    this.announcer = new Announcer(announcerData);

    // Announcer text is rendered by the React HUD (AnnouncerText slot), not the
    // canvas (ADR-001: Phaser draws fighters + sim only). This object stays as the
    // string holder that feeds the one-way bridge, but is never drawn.
    this.announcerText = this.add
      .text(GAME_WIDTH / 2, 48, "", {
        fontSize: "20px",
        color: "#fbbf24",
        fontFamily: "Georgia, serif",
        align: "center",
      })
      .setOrigin(0.5)
      .setVisible(false);

    // Control hints removed from the canvas — controls live in the header Controls
    // modal now (not constantly on screen).

    this.showAnnouncer(this.announcer.pick("roundStart"), 0);
    this.emitHud();

    // The React victory overlay's "Rematch" button reaches the scene over the
    // one-way bridge (React → Phaser); clean it up on shutdown.
    this.game.events.once("request-rematch", this.handleRematch, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off("request-rematch", this.handleRematch, this);
    });

    this.time.addEvent({
      delay: 1000,
      repeat: 2,
      callback: () => {
        this.countdown -= 1;
        if (this.countdown > 0) {
          this.showAnnouncer(String(this.countdown), 0);
        } else {
          this.showAnnouncer("FIGHT!", 0);
          this.fighting = true;
        }
      },
    });
  }

  private drawArena(transparent = false): void {
    const g = this.add.graphics();
    // In transparent mode the React/WebGPU stage bakes its own sky AND ground
    // (split at the floor line), so Phaser draws nothing but the fighters — no
    // opaque fills, no contact-shadow circle. The baked stage owns the floor line.
    if (transparent) return;

    g.fillStyle(0x111827, 1);
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    g.fillStyle(0x1e293b, 1);
    g.fillCircle(GAME_WIDTH / 2, ARENA.floorY + 40, 280);
    g.lineStyle(4, 0x334155, 1);
    g.strokeCircle(GAME_WIDTH / 2, ARENA.floorY + 40, 280);
    g.fillStyle(0x0f172a, 1);
    g.fillRect(0, ARENA.floorY, GAME_WIDTH, GAME_HEIGHT - ARENA.floorY);
    g.lineStyle(2, 0x475569, 1);
    g.lineBetween(
      ARENA.leftBound,
      ARENA.floorY,
      ARENA.rightBound,
      ARENA.floorY,
    );
  }

  update(_time: number, delta: number): void {
    this.announcer.tick(delta);
    this.p1.tickTimers(delta);
    this.p2.tickTimers(delta);
    this.p1.regenConfidence(delta);
    this.p2.regenConfidence(delta);
    this.p1.updateAnimations(delta, this.p1.body.velocity.x !== 0);
    this.p2.updateAnimations(delta, this.p2.body.velocity.x !== 0);

    // Emit every frame so the React HUD's above-head markers track the fighters.
    this.emitHud();

    if (!this.fighting || this.winner) {
      if (this.winner && this.keyboard.getInput(1).special) {
        this.scene.restart(this.registry.get("match"));
      }
      return;
    }

    const i1 = this.keyboard.getInput(1);
    const i2 = this.keyboard.getInput(2);

    this.processMovement(this.p1, i1);
    this.processMovement(this.p2, i2);
    this.p1.updateFacing(this.p2.sprite.x);
    this.p2.updateFacing(this.p1.sprite.x);

    this.processCombat(this.p1, this.p2, i1, delta, this.chargeP1, (v) => {
      this.chargeP1 = v;
    });
    this.processCombat(this.p2, this.p1, i2, delta, this.chargeP2, (v) => {
      this.chargeP2 = v;
    });

    if (this.pendingAttack) {
      const { attacker, defender, move, chargeMs, attackKind } =
        this.pendingAttack;
      const player = attacker === this.p1 ? 1 : (2 as 1 | 2);
      const result = resolveAttack(
        attacker,
        defender,
        move,
        getChargeMultiplier(chargeMs) * attacker.damageMultiplier(),
      );
      if (result.hit) {
        const line =
          this.announcer.speak(result.crit ? "bigHit" : "bigHit") ??
          result.moveName;
        this.showAnnouncer(line);
        attacker.addSpecialMeter(12);
        if (result.damage >= 14) this.cameras.main.shake(120, 0.004);
        // ADR-001: combat → stage background rides the one-way bridge (Phaser →
        // React), consumed by the React/WebGPU stage layer via an impactRef.
        this.game.events.emit("impact", {
          side: player === 1 ? "p1" : "p2",
          kind: attackKind,
        });
      } else {
        const line = this.announcer.speak("miss");
        if (line) this.showAnnouncer(line);
      }
      if (result.blocked) {
        const blockLine = this.announcer.speak("block");
        if (blockLine) this.showAnnouncer(blockLine);
      }
      this.pendingAttack = null;
    }

    if (this.p1.confidence < 25 || this.p2.confidence < 25) {
      const line = this.announcer.speak("lowConfidence", 3000);
      if (line) this.showAnnouncer(line);
    }

    this.checkKo();
    this.emitHud();
  }

  private processMovement(fighter: Fighter, input: PlayerInput): void {
    if (fighter.state === "ko" || fighter.state === "hitstun") return;

    if (input.block) {
      fighter.setCharging(false);
      fighter.setBlocking(true);
      fighter.body.setVelocityX(0);
      return;
    }
    fighter.setBlocking(false);

    const speed = fighter.def.stats.speed * 55;
    if (input.left && !input.right) {
      fighter.setWalking();
      fighter.body.setVelocityX(-speed);
    } else if (input.right && !input.left) {
      fighter.setWalking();
      fighter.body.setVelocityX(speed);
    } else {
      fighter.stopWalking();
      fighter.body.setVelocityX(0);
    }

    fighter.sprite.x = Phaser.Math.Clamp(
      fighter.sprite.x,
      ARENA.leftBound,
      ARENA.rightBound,
    );
  }

  private processCombat(
    attacker: Fighter,
    defender: Fighter,
    input: PlayerInput,
    delta: number,
    chargeMs: number,
    setCharge: (v: number) => void,
  ): void {
    if (attacker.state === "ko" || attacker.state === "hitstun") return;
    if (input.block) return;

    if (input.charge) {
      setCharge(chargeMs + delta);
      attacker.setCharging(true);
      return;
    }

    attacker.setCharging(false);

    let move: MoveId | null = null;
    let attackKind: "light" | "heavy" | "special" = "light";
    let usedCharge = chargeMs;
    setCharge(0);

    if (input.special && attacker.consumeSpecial()) {
      move = attacker.def.moves.special;
      attackKind = "special";
      usedCharge = 1200;
    } else if (input.heavy) {
      move = attacker.def.moves.heavy;
      attackKind = "heavy";
    } else if (input.light) {
      move = attacker.def.moves.light;
      attackKind = "light";
    } else if (usedCharge > 300 && !input.charge) {
      move = attacker.def.moves.heavy;
      attackKind = "heavy";
    }

    if (!move || attacker.state === "attack") return;
    if (!defender.isAttackable()) return;

    attacker.startAttack(
      attackKind,
      attackKind === "special" ? move : undefined,
    );
    this.pendingAttack = {
      attacker,
      defender,
      move,
      chargeMs: usedCharge,
      attackKind,
    };
    attacker.addSpecialMeter(6);
  }

  private checkKo(): void {
    if (this.p1.health <= 0 && !this.winner) {
      this.winner = 2;
      this.endRound(this.p2);
    } else if (this.p2.health <= 0 && !this.winner) {
      this.winner = 1;
      this.endRound(this.p1);
    }
  }

  private endRound(winner: Fighter): void {
    this.fighting = false;
    const line = this.announcer.pick("ko");
    this.showAnnouncer(`${line} — ${winner.def.name} wins!`);
    // The 3D victory overlay (React) now owns the post-KO screen + rematch CTA.
  }

  private handleRematch(): void {
    if (this.winner) {
      this.scene.restart(this.registry.get("match"));
    }
  }

  private showAnnouncer(text: string, cooldown = 1200): void {
    this.announcerText.setText(text);
    if (cooldown > 0) this.announcer.setCooldown(cooldown);
  }

  private emitHud(): void {
    const hud: FightHudState = {
      p1Health: this.p1.health,
      p1MaxHealth: this.p1.maxHealth,
      p1Confidence: Math.round(this.p1.confidence),
      p1Special: Math.round(this.p1.specialMeter),
      p2Health: this.p2.health,
      p2MaxHealth: this.p2.maxHealth,
      p2Confidence: Math.round(this.p2.confidence),
      p2Special: Math.round(this.p2.specialMeter),
      announcer: this.announcerText.text,
      winner: this.winner,
      round: this.round,
      p1X: this.p1.sprite.x,
      p1HeadY: this.p1.headTopY,
      p2X: this.p2.sprite.x,
      p2HeadY: this.p2.headTopY,
    };
    this.game.events.emit("hud-update", hud);
  }
}
