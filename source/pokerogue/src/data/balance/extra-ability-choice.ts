/**
 * Local fork (2026-11-20): 1.2.0 D12 leftovers. The passive sheet's extra abilities ("추가 조정 특성") went into the
 * species' ability slots on 2026-11-19 (custom-extra-abilities-d12.test.ts). Two kinds of rows were left over, and the
 * user answered both with "포켓몬 도감에서 선택" (choose in the Pokédex):
 * - "slot2": the extra ability replaced an ability2 the species had (Magnemite line Sturdy, Porygon line Download,
 *   Mantyke / Mantine Water Absorb, Alolan Marowak Lightning Rod). On (the default, the 11-19 data): ability2 is the
 *   extra ability. Off: ability2 is the old one again.
 * - "mega": the extra ability sits in a Mega form's hidden slot that the base species can never reach, since it has no
 *   hidden ability of its own (Mega Gengar, Mega Latias, Mega Latios). Off (the default, as before): the Mega keeps its
 *   own ability. On: the Mega form's ability is the extra one in every slot.
 *
 * The choice is per species, saved on the line's starter entry (`StarterDataEntry.extraAbilityChoice`); a species with
 * no saved choice (every save from before 1.2.0) has its default. It is read when a player's Pokémon's ability is
 * looked up (`Pokemon.getAbility`), so it applies to every Pokémon of the line the player has in a run, the party of a
 * continued run included. Enemies always have the default, that is the species data as it is. The Pokédex page's
 * ability list changes it only outside a run ({@linkcode canChangeExtraAbilityChoice}).
 */

import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import type { PokemonSpeciesForm } from "#data/pokemon-species";
import { AbilityId } from "#enums/ability-id";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import type { StarterDataEntry } from "#types/save-data";

/** Which of the two leftovers a row is (see the file comment) */
export type ExtraAbilityKind = "slot2" | "mega";

export interface ExtraAbilityChoiceRow {
  readonly speciesId: SpeciesId;
  readonly kind: ExtraAbilityKind;
  /** The sheet's extra ability: what "on" gives */
  readonly extra: AbilityId;
  /** What "off" gives: ability2 from before 11-19 ("slot2"), or the Mega's own ability ("mega") */
  readonly off: AbilityId;
  /** The choice of a species nobody chose for: the behaviour before this option ("slot2" on, "mega" off) */
  readonly defaultOn: boolean;
}

function slot2Row(speciesId: SpeciesId, extra: AbilityId, off: AbilityId): ExtraAbilityChoiceRow {
  return { speciesId, kind: "slot2", extra, off, defaultOn: true };
}

function megaRow(speciesId: SpeciesId, extra: AbilityId, off: AbilityId): ExtraAbilityChoiceRow {
  return { speciesId, kind: "mega", extra, off, defaultOn: false };
}

/** The species with the choice, as the sheet rows and the 11-20 hidden-slot follow-up left them */
export const EXTRA_ABILITY_CHOICES: ReadonlyMap<SpeciesId, ExtraAbilityChoiceRow> = new Map(
  [
    // Sheet row 6 (the whole line): Sturdy -> Transistor
    slot2Row(SpeciesId.MAGNEMITE, AbilityId.TRANSISTOR, AbilityId.STURDY),
    slot2Row(SpeciesId.MAGNETON, AbilityId.TRANSISTOR, AbilityId.STURDY),
    slot2Row(SpeciesId.MAGNEZONE, AbilityId.TRANSISTOR, AbilityId.STURDY),
    // Row 9: Lightning Rod -> Gorilla Tactics
    slot2Row(SpeciesId.ALOLA_MAROWAK, AbilityId.GORILLA_TACTICS, AbilityId.LIGHTNING_ROD),
    // Rows 10 and 11: Download -> Space Warp
    slot2Row(SpeciesId.PORYGON, AbilityId.SPACE_WARP, AbilityId.DOWNLOAD),
    slot2Row(SpeciesId.PORYGON2, AbilityId.SPACE_WARP, AbilityId.DOWNLOAD),
    slot2Row(SpeciesId.PORYGON_Z, AbilityId.SPACE_WARP, AbilityId.DOWNLOAD),
    // Row 17: Water Absorb -> Lightning Rod
    slot2Row(SpeciesId.MANTYKE, AbilityId.LIGHTNING_ROD, AbilityId.WATER_ABSORB),
    slot2Row(SpeciesId.MANTINE, AbilityId.LIGHTNING_ROD, AbilityId.WATER_ABSORB),
    // Rows 7, 36 and 37: the Megas' hidden slot
    megaRow(SpeciesId.GENGAR, AbilityId.WICKED_SCHEME, AbilityId.SHADOW_TAG),
    megaRow(SpeciesId.LATIAS, AbilityId.SPEED_BOOST, AbilityId.LEVITATE),
    megaRow(SpeciesId.LATIOS, AbilityId.SPEED_BOOST, AbilityId.LEVITATE),
  ].map(row => [row.speciesId, row]),
);

export function getExtraAbilityChoiceRow(speciesId: SpeciesId): ExtraAbilityChoiceRow | undefined {
  return EXTRA_ABILITY_CHOICES.get(speciesId);
}

/** The starter entry that holds the choice of `speciesId` (its line's starter), if the save has one */
export function getExtraAbilityChoiceEntry(speciesId: SpeciesId): StarterDataEntry | undefined {
  return globalScene?.gameData?.starterData?.[speciesDataRegistry.getStarter(speciesId)];
}

/**
 * Whether `speciesId` has its extra ability on for the player
 * @param entry - The line's starter entry; default the save's
 */
export function isExtraAbilityOn(
  speciesId: SpeciesId,
  entry: StarterDataEntry | undefined = getExtraAbilityChoiceEntry(speciesId),
): boolean {
  const row = EXTRA_ABILITY_CHOICES.get(speciesId);
  if (row == null) {
    return false;
  }
  const chosen = entry?.extraAbilityChoice?.[speciesId];
  return typeof chosen === "boolean" ? chosen : row.defaultOn;
}

/**
 * Save the player's choice for `speciesId` on its line's starter entry (kept as chosen, even when it is the default).
 * The caller saves the system data.
 * @returns Whether there was an entry to save it on
 */
export function setExtraAbilityOn(speciesId: SpeciesId, on: boolean): boolean {
  const entry = getExtraAbilityChoiceEntry(speciesId);
  if (entry == null || !EXTRA_ABILITY_CHOICES.has(speciesId)) {
    return false;
  }
  const choice: Partial<Record<SpeciesId, boolean>> = {};
  // Only what an earlier save wrote correctly is kept
  for (const [key, value] of Object.entries(entry.extraAbilityChoice ?? {})) {
    if (typeof value === "boolean" && EXTRA_ABILITY_CHOICES.has(Number(key) as SpeciesId)) {
      choice[Number(key) as SpeciesId] = value;
    }
  }
  choice[speciesId] = on;
  entry.extraAbilityChoice = choice;
  return true;
}

/**
 * The ability a player's Pokémon gets from slot `abilityIndex` of `speciesForm`, with the choice applied
 * @param abilityId - What the slot holds (`speciesForm.getAbility(abilityIndex)`)
 * @param entry - The line's starter entry; default the save's
 */
export function applyExtraAbilityChoice(
  speciesForm: PokemonSpeciesForm,
  abilityIndex: number,
  abilityId: AbilityId,
  entry?: StarterDataEntry,
): AbilityId {
  const row = EXTRA_ABILITY_CHOICES.get(speciesForm.speciesId);
  if (row == null) {
    return abilityId;
  }
  // Review fix (2026-11-20): the choice is about the species data's slot. A challenge that changed the slot's ability
  // (the Ability Randomizer, in `PokemonSpeciesForm.getAbility`) keeps its result: a Mega turned "on" no longer
  // replaces the randomized ability with the extra one
  // The slot `PokemonSpeciesForm.getAbility` reads: 0, 1, anything else the hidden one
  const slot = abilityIndex === 0 || abilityIndex === 1 ? abilityIndex : 2;
  if (abilityId !== [speciesForm.ability1, speciesForm.ability2, speciesForm.abilityHidden][slot]) {
    return abilityId;
  }
  const on = isExtraAbilityOn(row.speciesId, entry ?? getExtraAbilityChoiceEntry(row.speciesId));
  if (row.kind === "slot2") {
    return !on && abilityIndex === 1 && abilityId === row.extra ? row.off : abilityId;
  }
  if (speciesForm.getFormKey() !== SpeciesFormKey.MEGA) {
    return abilityId;
  }
  if (on) {
    return row.extra;
  }
  return abilityId === row.extra ? row.off : abilityId;
}

/** The three slots of `speciesForm` as a player's Pokémon gets them (for the Pokédex and the starter screen) */
export function getPlayerAbilitySlots(speciesForm: PokemonSpeciesForm): [AbilityId, AbilityId, AbilityId] {
  const slots: [AbilityId, AbilityId, AbilityId] = [
    speciesForm.ability1,
    speciesForm.ability2,
    speciesForm.abilityHidden,
  ];
  for (const index of [0, 1, 2] as const) {
    // An empty slot stays empty, so the Pokédex shows no slot the species does not have
    if (slots[index] !== AbilityId.NONE) {
      slots[index] = applyExtraAbilityChoice(speciesForm, index, slots[index]);
    }
  }
  return slots;
}

/**
 * Whether the Pokédex may change a choice now: on the title screen and in the starter select, never during a run (a
 * running battle would see a Pokémon's ability change under it)
 */
export function canChangeExtraAbilityChoice(): boolean {
  const phaseName = globalScene.phaseManager.getCurrentPhase()?.phaseName;
  return phaseName === "TitlePhase" || phaseName === "SelectStarterPhase";
}
