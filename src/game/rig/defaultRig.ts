import type { AttackAnimSpec, BodyPartSpec, CharacterRig } from "../types";

export const DEFAULT_ATTACKS: Record<
  "light" | "heavy" | "special",
  AttackAnimSpec
> = {
  light: { reach: 22, duration: 140, armY: -8, torsoLunge: 10 },
  heavy: { reach: 36, duration: 220, armY: -8, torsoLunge: 14 },
  special: {
    reach: 48,
    duration: 420,
    armY: -24,
    torsoLunge: 22,
    ringBurst: true,
    badgeLabel: "SPECIAL",
    badgeHoldMs: 900,
  },
};

export const DEFAULT_BODY_PARTS: Record<string, BodyPartSpec> = {
  torso: {
    shape: "rect",
    width: 56,
    height: 88,
    offset: { x: 0, y: 0 },
    fill: "primary",
    stroke: "accent",
    strokeWidth: 3,
  },
  head: {
    shape: "rect",
    width: 40,
    height: 32,
    offset: { x: 0, y: -58 },
    fill: "accent",
  },
  legL: {
    shape: "rect",
    width: 18,
    height: 28,
    offset: { x: -14, y: 52 },
    fill: "primary",
    stroke: "accent",
    strokeWidth: 2,
  },
  legR: {
    shape: "rect",
    width: 18,
    height: 28,
    offset: { x: 14, y: 52 },
    fill: "primary",
    stroke: "accent",
    strokeWidth: 2,
  },
  punchArm: {
    shape: "rect",
    width: 28,
    height: 14,
    offset: { x: 38, y: -8 },
    fill: "accent",
    hidden: true,
  },
  blockShield: {
    shape: "rect",
    width: 12,
    height: 70,
    offset: { x: 0, y: -10 },
    fill: "#94a3b8",
    alpha: 0.55,
    hidden: true,
  },
  chargeRing: {
    shape: "circle",
    width: 104,
    height: 104,
    offset: { x: 0, y: 0 },
    fill: "accent",
    alpha: 0,
    hidden: true,
  },
};

export const DEFAULT_RIG: CharacterRig = {
  scale: 1,
  bodySize: { width: 56, height: 88 },
  parts: DEFAULT_BODY_PARTS,
  attacks: DEFAULT_ATTACKS,
};
