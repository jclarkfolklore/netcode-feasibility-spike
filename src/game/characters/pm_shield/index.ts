import type { CharacterDef } from "../types";

export const config: CharacterDef = {
  id: "pm_shield",
  name: "The PM",
  tagline: "Shields up. Scope unclear.",
  icon: "shield",
  stats: { health: 105, speed: 4, power: 4, defense: 8 },
  traits: ["strong_block"],
  moves: {
    light: "token_overflow",
    heavy: "stakeholder_wall",
    special: "redirect_blame",
  },
  colors: { primary: "#6366f1", accent: "#a5b4fc" },
  rig: {
    scale: 1.05,
    bodySize: { width: 66, height: 86 },
    parts: {
      torso: {
        shape: "rect",
        width: 66,
        height: 86,
        offset: { x: 0, y: 0 },
        fill: "primary",
        stroke: "accent",
        strokeWidth: 4,
      },
      head: {
        shape: "rect",
        width: 46,
        height: 34,
        offset: { x: 0, y: -59 },
        fill: "accent",
      },
      legL: {
        shape: "rect",
        width: 22,
        height: 28,
        offset: { x: -18, y: 52 },
        fill: "primary",
        stroke: "accent",
        strokeWidth: 2,
      },
      legR: {
        shape: "rect",
        width: 22,
        height: 28,
        offset: { x: 18, y: 52 },
        fill: "primary",
        stroke: "accent",
        strokeWidth: 2,
      },
    },
    attacks: {
      light: { reach: 20, duration: 160 },
      heavy: { reach: 30, duration: 250, armY: -10, torsoLunge: 10 },
      special: {
        reach: 44,
        duration: 490,
        armY: -22,
        torsoLunge: 18,
        ringBurst: true,
        badgeLabel: "REDIRECT BLAME",
        badgeHoldMs: 1100,
      },
    },
  },
};
