import type { CharacterDef } from "./types";
import { config as architect } from "./architect";
import { config as coder } from "./coder";
import { config as hallucinator } from "./hallucinator";
import { config as pm_shield } from "./pm_shield";
import { config as legacy_system } from "./legacy_system";
import { config as qa_goblin } from "./qa_goblin";
import { config as scope_creep } from "./scope_creep";
import { config as contentful_overlord } from "./contentful_overlord";
import { config as deploy_friday } from "./deploy_friday";
import { config as client_feedback } from "./client_feedback";

export const CHARACTERS: Record<string, CharacterDef> = {
  architect,
  coder,
  hallucinator,
  pm_shield,
  legacy_system,
  qa_goblin,
  scope_creep,
  contentful_overlord,
  deploy_friday,
  client_feedback,
};

export const roster: readonly CharacterDef[] = Object.values(CHARACTERS);

export function getCharacter(id: string): CharacterDef | undefined {
  return CHARACTERS[id];
}
