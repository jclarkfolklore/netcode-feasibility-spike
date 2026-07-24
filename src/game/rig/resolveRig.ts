import type {
  AttackAnimSpec,
  BodyPartSpec,
  CharacterDef,
  CharacterRig,
} from "../types";
import { DEFAULT_ATTACKS, DEFAULT_BODY_PARTS, DEFAULT_RIG } from "./defaultRig";

function mergePart(base: BodyPartSpec, override?: BodyPartSpec): BodyPartSpec {
  if (!override) return { ...base };
  return {
    ...base,
    ...override,
    offset: { ...base.offset, ...override.offset },
  };
}

/** Merge character JSON rig with game defaults. */
export function resolveCharacterRig(def: CharacterDef): CharacterRig {
  const custom = def.rig;
  if (!custom) return DEFAULT_RIG;

  const parts: CharacterRig["parts"] = {};
  const keys = new Set([
    ...Object.keys(DEFAULT_BODY_PARTS),
    ...Object.keys(custom.parts ?? {}),
  ]);

  for (const key of keys) {
    const base = DEFAULT_BODY_PARTS[key];
    const over = custom.parts?.[key as keyof typeof custom.parts];
    if (base) parts[key as keyof typeof parts] = mergePart(base, over);
    else if (over) parts[key as keyof typeof parts] = over;
  }

  return {
    scale: custom.scale ?? DEFAULT_RIG.scale,
    bodySize: { ...DEFAULT_RIG.bodySize, ...custom.bodySize },
    parts,
    attacks: {
      light: { ...DEFAULT_ATTACKS.light, ...custom.attacks?.light },
      heavy: { ...DEFAULT_ATTACKS.heavy, ...custom.attacks?.heavy },
      special: { ...DEFAULT_ATTACKS.special, ...custom.attacks?.special },
    },
  };
}

export function attackSpecFor(
  rig: CharacterRig,
  kind: "light" | "heavy" | "special",
): AttackAnimSpec {
  return rig.attacks?.[kind] ?? DEFAULT_ATTACKS[kind];
}
