import type { CharacterDef } from "../types";

export const config: CharacterDef = {
  id: "legacy_system",
  name: "Legacy System",
  tagline: "Still running since 2009.",
  icon: "server",
  stats: { health: 130, speed: 2, power: 5, defense: 9 },
  traits: ["tanky", "slow"],
  moves: {
    light: "rate_limit",
    heavy: "technical_debt",
    special: "cannot_die_yet",
  },
  colors: { primary: "#78716c", accent: "#d6d3d1" },
  rig: {
    scale: 1.18,
    bodySize: { width: 76, height: 106 },
    parts: {
      torso: {
        shape: "rect",
        width: 76,
        height: 106,
        offset: { x: 0, y: 0 },
        fill: "primary",
        stroke: "accent",
        strokeWidth: 5,
      },
      head: {
        shape: "rect",
        width: 52,
        height: 38,
        offset: { x: 0, y: -72 },
        fill: "accent",
      },
      legL: {
        shape: "rect",
        width: 26,
        height: 32,
        offset: { x: -22, y: 65 },
        fill: "primary",
        stroke: "accent",
        strokeWidth: 3,
      },
      legR: {
        shape: "rect",
        width: 26,
        height: 32,
        offset: { x: 22, y: 65 },
        fill: "primary",
        stroke: "accent",
        strokeWidth: 3,
      },
    },
    attacks: {
      light: { reach: 28, duration: 210 },
      heavy: { reach: 48, duration: 340, armY: -14, torsoLunge: 12 },
      special: {
        reach: 66,
        duration: 640,
        armY: -34,
        torsoLunge: 30,
        ringBurst: true,
        badgeLabel: "CANNOT DIE YET",
        badgeHoldMs: 1400,
      },
    },
  },
};
