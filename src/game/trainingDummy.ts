import type { CharacterDef } from "./types";

/** Generic sparring partner for move previews. */
export const TRAINING_DUMMY: CharacterDef = {
  id: "training_dummy",
  name: "Training Dummy",
  tagline: "Absorbs hits. Files JIRA tickets silently.",
  icon: "target",
  stats: { health: 500, speed: 2, power: 3, defense: 4 },
  traits: [],
  moves: {
    light: "token_overflow",
    heavy: "token_overflow",
    special: "token_overflow",
  },
  colors: { primary: "#475569", accent: "#94a3b8" },
};

/** Spacing between fighter centers when in attack range (matches CombatSystem reach). */
export const PREVIEW_SPAR_RANGE = 64;

export const PREVIEW_POSITIONS = {
  fighter: 430,
  dummy: 430 + PREVIEW_SPAR_RANGE,
};
