import type { CharacterDef } from "../types";

export const config: CharacterDef = {
  id: "scope_creep",
  name: "Scope Creep Titan",
  tagline: "Actually, one more thing…",
  icon: "trending",
  stats: { health: 105, speed: 4, power: 7, defense: 4 },
  traits: ["growing_power"],
  moves: {
    light: "context_loss",
    heavy: "requirements_storm",
    special: "scope_bloat",
  },
  colors: { primary: "#e85d04", accent: "#fdba74" },
  rig: {
    scale: 1.01,
    bodySize: { width: 60, height: 90 },
    parts: {
      torso: {
        shape: "rect",
        width: 60,
        height: 90,
        offset: { x: 0, y: 0 },
        fill: "primary",
        stroke: "accent",
        strokeWidth: 3,
      },
      head: {
        shape: "rect",
        width: 44,
        height: 34,
        offset: { x: 2, y: -62 },
        fill: "accent",
      },
      legL: {
        shape: "rect",
        width: 20,
        height: 28,
        offset: { x: -16, y: 55 },
        fill: "primary",
        stroke: "accent",
        strokeWidth: 2,
      },
      legR: {
        shape: "rect",
        width: 20,
        height: 28,
        offset: { x: 16, y: 55 },
        fill: "primary",
        stroke: "accent",
        strokeWidth: 2,
      },
    },
    attacks: {
      light: { reach: 22, duration: 155 },
      heavy: { reach: 44, duration: 260, armY: -12, torsoLunge: 16 },
      special: {
        reach: 60,
        duration: 500,
        armY: -28,
        torsoLunge: 26,
        ringBurst: true,
        badgeLabel: "SCOPE BLOAT",
        badgeHoldMs: 1200,
      },
    },
  },
};
