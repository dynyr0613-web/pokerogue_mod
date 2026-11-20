/*
 * Dev Bridge (local development only): turning the names the bridge takes into game ids. Local fork (2026-11-21):
 * moved here from dev-bridge.ts so that the bridge tools (bridge-look / bridge-setup / bridge-scenario) share them.
 */

import { enumByName } from "#app/dev-bridge/bridge-pure";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { SpeciesId } from "#enums/species-id";
import { getEnumValues } from "#utils/enums";

/** Accepts a SpeciesId, an enum key ("CHARMANDER") or a displayed name ("파이리") */
export function resolveSpecies(species: number | string): SpeciesId {
  if (typeof species === "number") {
    return species as SpeciesId;
  }
  const key = species
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  const byKey = (SpeciesId as Record<string, string | number>)[key];
  if (typeof byKey === "number") {
    return byKey as SpeciesId;
  }
  const wanted = species.trim();
  for (const id of getEnumValues(SpeciesId)) {
    if (speciesDataRegistry.getSpecies(id).getName() === wanted) {
      return id;
    }
  }
  throw new Error(`unknown species: ${species}`);
}

export function resolveMove(move: number | string): MoveId {
  return typeof move === "number" ? (move as MoveId) : enumByName(MoveId, move, "move");
}

export function resolveNature(nature: number | string | undefined): Nature {
  if (nature == null) {
    return Nature.HARDY;
  }
  return typeof nature === "number" ? (nature as Nature) : enumByName(Nature, nature, "nature");
}

/**
 * The form index a form key ("mega-x", "MEGA_X", "gigantamax") or index stands for, for a species
 * @throws When the species has no such form
 */
export function resolveFormIndex(speciesId: SpeciesId, form: string | number | undefined): number {
  if (form == null || form === "") {
    return 0;
  }
  const forms = speciesDataRegistry.getSpecies(speciesId).forms;
  if (typeof form === "number") {
    if (form > 0 && form >= forms.length) {
      throw new Error(
        `${SpeciesId[speciesId]} has no form ${form} (forms: ${forms.map(f => f.formKey || '""').join(", ")})`,
      );
    }
    return form;
  }
  const wanted = form.trim().toLowerCase().replace(/_/g, "-");
  const index = forms.findIndex(f => f.formKey.toLowerCase() === wanted);
  if (index < 0) {
    throw new Error(
      `${SpeciesId[speciesId]} has no form "${form}" (forms: ${forms.map((f, i) => `${i}=${f.formKey || '""'}`).join(", ")})`,
    );
  }
  return index;
}
