export type MoveId =
  | "token_overflow"
  | "context_loss"
  | "rate_limit"
  | "hallucination_crit"
  | "blueprint_slam"
  | "merge_conflict"
  | "hotfix_fury"
  | "fabricated_facts"
  | "stakeholder_wall"
  | "redirect_blame"
  | "technical_debt"
  | "cannot_die_yet"
  | "regression_strike"
  | "blocker_filed"
  | "requirements_storm"
  | "scope_bloat"
  | "broken_reference"
  | "migration_wave"
  | "production_push"
  | "rollback_denied"
  | "revision_round"
  | "feedback_loop"
  | "master_plan";

/** Primitive placeholder or future sprite sheet part. */
export type BodyPartShape = "rect" | "circle";

export type BodyPartKey =
  | "torso"
  | "head"
  | "armL"
  | "armR"
  | "legL"
  | "legR"
  | "punchArm"
  | "blockShield"
  | "chargeRing";

/** One drawable limb / attachment, positioned relative to the rig root. */
export interface BodyPartSpec {
  shape: BodyPartShape;
  width: number;
  height: number;
  /** Position from rig center (feet at floor anchor). */
  offset: { x: number; y: number };
  /** Fill: character palette key or hex color. */
  fill: "primary" | "accent" | string;
  stroke?: "primary" | "accent" | "none";
  strokeWidth?: number;
  alpha?: number;
  /** Hidden until an action reveals it (e.g. punch arm). */
  hidden?: boolean;
}

export interface AttackAnimSpec {
  reach: number;
  duration: number;
  armY?: number;
  torsoLunge?: number;
  ringBurst?: boolean;
  badgeLabel?: string;
  badgeHoldMs?: number;
}

/** Modular body layout + per-attack motion overrides (JSON-driven). */
export interface CharacterRig {
  scale?: number;
  bodySize: { width: number; height: number };
  parts: Partial<Record<BodyPartKey, BodyPartSpec>>;
  attacks?: {
    light?: AttackAnimSpec;
    heavy?: AttackAnimSpec;
    special?: AttackAnimSpec;
  };
}

export interface CharacterDef {
  id: string;
  name: string;
  tagline: string;
  /** Semantic icon key (an IconName from src/theme/Icon.tsx) the React UI renders
   *  through the active theme's icon pack. Kept as a plain string here so the
   *  theme-agnostic game layer takes no dependency on the theme types. */
  icon: string;
  stats: {
    health: number;
    speed: number;
    power: number;
    defense: number;
  };
  traits: string[];
  moves: {
    light: MoveId;
    heavy: MoveId;
    special: MoveId;
  };
  colors: {
    primary: string;
    accent: string;
  };
  /** Optional per-character body layout; merged over game defaults. */
  rig?: CharacterRig;
}

export interface AnnouncerData {
  roundStart: string[];
  bigHit: string[];
  miss: string[];
  lowConfidence: string[];
  ko: string[];
  block: string[];
}

export interface MatchConfig {
  p1: string;
  p2: string;
  stage: string;
  mode: "local" | "online";
}

export type FighterStateKind =
  | "idle"
  | "walk"
  | "attack"
  | "block"
  | "hitstun"
  | "ko";

export interface PlayerInput {
  left: boolean;
  right: boolean;
  block: boolean;
  light: boolean;
  heavy: boolean;
  charge: boolean;
  special: boolean;
}

export const EMPTY_INPUT: PlayerInput = {
  left: false,
  right: false,
  block: false,
  light: false,
  heavy: false,
  charge: false,
  special: false,
};

export interface FightHudState {
  p1Health: number;
  p1MaxHealth: number;
  p1Confidence: number;
  p1Special: number;
  p2Health: number;
  p2MaxHealth: number;
  p2Confidence: number;
  p2Special: number;
  announcer: string;
  winner: 1 | 2 | null;
  round: number;
  /** Fighter positions in stage coords (0–960 × 0–540) so the React HUD can place
   *  a per-player marker above each fighter's head. */
  p1X: number;
  p1HeadY: number;
  p2X: number;
  p2HeadY: number;
}
