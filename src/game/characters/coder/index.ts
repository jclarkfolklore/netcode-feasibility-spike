import type { CharacterDef } from "../types";

export const config: CharacterDef = {
  id: "coder",
  name: "The Coder",
  tagline: "Ships fast. Tests never.",
  icon: "code",
  stats: { health: 90, speed: 7, power: 6, defense: 3 },
  traits: ["fast_attacks", "bug_prone"],
  moves: {
    light: "token_overflow",
    heavy: "merge_conflict",
    special: "hotfix_fury",
  },
  colors: { primary: "#22c55e", accent: "#86efac" },
  rig: {
    scale: 0.96,
    bodySize: { width: 50, height: 82 },
    parts: {
      torso: {
        shape: "rect",
        width: 50,
        height: 82,
        offset: { x: 0, y: 0 },
        fill: "primary",
        stroke: "accent",
        strokeWidth: 2,
      },
      head: {
        shape: "rect",
        width: 36,
        height: 28,
        offset: { x: 2, y: -54 },
        fill: "accent",
      },
      legL: {
        shape: "rect",
        width: 16,
        height: 26,
        offset: { x: -13, y: 50 },
        fill: "primary",
        stroke: "accent",
        strokeWidth: 1,
      },
      legR: {
        shape: "rect",
        width: 16,
        height: 26,
        offset: { x: 13, y: 50 },
        fill: "primary",
        stroke: "accent",
        strokeWidth: 1,
      },
    },
    attacks: {
      light: { reach: 20, duration: 112 },
      heavy: { reach: 32, duration: 178 },
      special: {
        reach: 44,
        duration: 340,
        armY: -20,
        torsoLunge: 18,
        ringBurst: true,
        badgeLabel: "HOTFIX FURY",
        badgeHoldMs: 950,
      },
    },
  },
};
