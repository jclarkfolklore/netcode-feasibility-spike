import type { CharacterDef } from "../types";

export const config: CharacterDef = {
  id: "qa_goblin",
  name: "QA Goblin",
  tagline: "Found a bug in your fun.",
  icon: "bug",
  stats: { health: 100, speed: 6, power: 5, defense: 5 },
  traits: ["blocks_bad_moves"],
  moves: {
    light: "token_overflow",
    heavy: "regression_strike",
    special: "blocker_filed",
  },
  colors: { primary: "#14b8a6", accent: "#5eead4" },
  rig: {
    scale: 0.87,
    bodySize: { width: 48, height: 78 },
    parts: {
      torso: {
        shape: "rect",
        width: 48,
        height: 78,
        offset: { x: 0, y: 4 },
        fill: "primary",
        stroke: "accent",
        strokeWidth: 2,
      },
      head: {
        shape: "circle",
        width: 40,
        height: 40,
        offset: { x: 0, y: -52 },
        fill: "accent",
      },
      legL: {
        shape: "rect",
        width: 15,
        height: 22,
        offset: { x: -12, y: 46 },
        fill: "primary",
        stroke: "accent",
        strokeWidth: 1,
      },
      legR: {
        shape: "rect",
        width: 15,
        height: 22,
        offset: { x: 12, y: 46 },
        fill: "primary",
        stroke: "accent",
        strokeWidth: 1,
      },
    },
    attacks: {
      light: { reach: 20, duration: 122 },
      heavy: { reach: 32, duration: 200 },
      special: {
        reach: 42,
        duration: 390,
        armY: -18,
        torsoLunge: 16,
        ringBurst: true,
        badgeLabel: "BLOCKER FILED",
        badgeHoldMs: 950,
      },
    },
  },
};
