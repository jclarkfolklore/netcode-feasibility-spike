import type { CharacterDef } from "../types";

export const config: CharacterDef = {
  id: "deploy_friday",
  name: "Deploy Friday Demon",
  tagline: "Pushing to prod at 4:58 PM.",
  icon: "fire",
  stats: { health: 85, speed: 8, power: 8, defense: 2 },
  traits: ["high_risk_high_reward"],
  moves: {
    light: "rate_limit",
    heavy: "production_push",
    special: "rollback_denied",
  },
  colors: { primary: "#ef4444", accent: "#fca5a5" },
  rig: {
    scale: 0.95,
    bodySize: { width: 52, height: 84 },
    parts: {
      torso: {
        shape: "rect",
        width: 52,
        height: 84,
        offset: { x: 0, y: 0 },
        fill: "primary",
        stroke: "accent",
        strokeWidth: 3,
      },
      head: {
        shape: "rect",
        width: 38,
        height: 28,
        offset: { x: 3, y: -56 },
        fill: "accent",
      },
      legL: {
        shape: "rect",
        width: 17,
        height: 26,
        offset: { x: -13, y: 51 },
        fill: "primary",
        stroke: "accent",
        strokeWidth: 2,
      },
      legR: {
        shape: "rect",
        width: 17,
        height: 26,
        offset: { x: 13, y: 51 },
        fill: "primary",
        stroke: "accent",
        strokeWidth: 2,
      },
    },
    attacks: {
      light: { reach: 26, duration: 98, torsoLunge: 14 },
      heavy: { reach: 44, duration: 155, armY: -14, torsoLunge: 18 },
      special: {
        reach: 60,
        duration: 295,
        armY: -30,
        torsoLunge: 28,
        ringBurst: true,
        badgeLabel: "ROLLBACK DENIED",
        badgeHoldMs: 900,
      },
    },
  },
};
