import type { CharacterDef } from "../types";

export const config: CharacterDef = {
  id: "client_feedback",
  name: "Client Feedback Bot",
  tagline: "Can we make the logo bigger?",
  icon: "message",
  stats: { health: 95, speed: 5, power: 5, defense: 5 },
  traits: ["confidence_drain"],
  moves: {
    light: "context_loss",
    heavy: "revision_round",
    special: "feedback_loop",
  },
  colors: { primary: "#f59e0b", accent: "#fcd34d" },
  rig: {
    scale: 1.0,
    bodySize: { width: 56, height: 86 },
    parts: {
      torso: {
        shape: "rect",
        width: 56,
        height: 86,
        offset: { x: 0, y: 0 },
        fill: "primary",
        stroke: "accent",
        strokeWidth: 3,
      },
      head: {
        shape: "circle",
        width: 48,
        height: 48,
        offset: { x: 0, y: -60 },
        fill: "accent",
      },
      legL: {
        shape: "rect",
        width: 18,
        height: 26,
        offset: { x: -14, y: 51 },
        fill: "primary",
        stroke: "accent",
        strokeWidth: 2,
      },
      legR: {
        shape: "rect",
        width: 18,
        height: 26,
        offset: { x: 14, y: 51 },
        fill: "primary",
        stroke: "accent",
        strokeWidth: 2,
      },
    },
    attacks: {
      light: { reach: 22, duration: 142 },
      heavy: { reach: 34, duration: 225 },
      special: {
        reach: 48,
        duration: 460,
        armY: -22,
        torsoLunge: 18,
        ringBurst: true,
        badgeLabel: "FEEDBACK LOOP",
        badgeHoldMs: 1100,
      },
    },
  },
};
