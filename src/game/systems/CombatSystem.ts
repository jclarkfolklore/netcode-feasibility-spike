import type { CharacterDef, MoveId } from "../types";
import type { Fighter } from "../entities/Fighter";

const MOVE_DAMAGE: Partial<Record<MoveId, number>> = {
  token_overflow: 6,
  context_loss: 8,
  rate_limit: 14,
  hallucination_crit: 16,
  blueprint_slam: 12,
  merge_conflict: 10,
  hotfix_fury: 18,
  fabricated_facts: 15,
  stakeholder_wall: 9,
  redirect_blame: 11,
  technical_debt: 13,
  cannot_die_yet: 10,
  regression_strike: 11,
  blocker_filed: 14,
  requirements_storm: 15,
  scope_bloat: 17,
  broken_reference: 12,
  migration_wave: 16,
  production_push: 20,
  rollback_denied: 22,
  revision_round: 10,
  feedback_loop: 12,
  master_plan: 14,
};

export interface AttackResult {
  hit: boolean;
  blocked: boolean;
  damage: number;
  crit: boolean;
  moveName: string;
}

export function resolveAttack(
  attacker: Fighter,
  defender: Fighter,
  moveId: MoveId,
  chargeMultiplier: number,
): AttackResult {
  const base = MOVE_DAMAGE[moveId] ?? 8;
  let damage = Math.round(
    base * (attacker.def.stats.power / 5) * chargeMultiplier,
  );

  let crit = false;
  if (
    attacker.def.traits.includes("hallucination_crit") &&
    Math.random() < 0.25
  ) {
    crit = true;
    damage = Math.round(damage * 1.75);
  }

  if (attacker.def.traits.includes("bug_prone") && Math.random() < 0.1) {
    damage = Math.max(1, Math.round(damage * 0.4));
  }

  const blocked = defender.isBlocking();
  if (blocked) {
    const blockReduction = defender.def.traits.includes("strong_block")
      ? 0.85
      : 0.65;
    damage = Math.round(damage * (1 - blockReduction));
  }

  const inRange =
    Math.abs(attacker.sprite.x - defender.sprite.x) <
    70 + attacker.attackReachBonus();

  const hit = inRange && damage > 0;
  if (hit) {
    defender.takeDamage(damage);
    const knock = (attacker.facingRight ? 1 : -1) * (6 + damage * 0.35);
    defender.applyKnockback(knock);
  } else if (!inRange) {
    attacker.drainConfidence(8);
  }

  return {
    hit,
    blocked: blocked && hit,
    damage: hit ? damage : 0,
    crit,
    moveName: moveId.replace(/_/g, " ").toUpperCase(),
  };
}

export function getChargeMultiplier(chargeMs: number): number {
  if (chargeMs > 1200) return 1.6;
  if (chargeMs > 600) return 1.25;
  return 1;
}

export function characterById(
  roster: CharacterDef[],
  id: string,
): CharacterDef | undefined {
  return roster.find((c) => c.id === id);
}
