/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Local fork (2026-11-20): Max Mushrooms (다이버섯) in the rare form change reward, F1 Q5 and Q6 of the Z/Max edge check
 * (F1-5, F1-6, F1-41).
 *
 * - Q5 (the user: "거다이가 있을 경우 24, 없을 경우 4"): the rare form change slot keeps its ROGUE weight
 *   ({@linkcode getRareFormChangeSlotWeight}: `min(ceil(wave / 50), 4) * 6`, 24 from wave 151) for the mushrooms while a
 *   party member that can Gigantamax holds none ({@linkcode hasGmaxMemberWithoutMushrooms}). Otherwise they are only the
 *   fork's "any Pokémon" Dynamax (2026-11-18) and weigh {@linkcode MAX_MUSHROOM_OFFER_RULES}.withoutGmaxWeight: the
 *   slot's whole weight when they are all it could give ({@linkcode getRareFormChangeWeightForPool}), their share of the
 *   slot's draw when other rare form change items (Mega Stones ...) are in it too ({@linkcode pickFormChangeItem}; never
 *   more than an even share, and the other items share the rest of the slot).
 * - Q6 (the user: "추천대로"): before the first Classic clear (fork-unlock.ts) the "any Pokémon" part is locked, as in
 *   the original game: the generator offers the mushrooms only for a G-Max species ready for them (its own form
 *   change), the party screen gives them only to such a Pokémon (`Pokemon.isFormChangeItemCompatible`), and none of the
 *   player's Pokémon is in the Dynamax state (`isInDynamaxState`, pokemon-forms-dynamax.ts). The live upstream event
 *   that gives the Dynamax Band at Classic wave 115 (timed-events.ts) then opens only the G-Max species' mushrooms.
 */

import { speciesDataRegistry } from "#app/global-species-data-registry";
import { SpeciesFormChangeItemTrigger } from "#data/form-change-triggers";
import { holdsMaxMushrooms, MAX_FORM_KEYS } from "#data/pokemon-forms-dynamax";
import { FormChangeItem } from "#enums/form-change-item";
import type { Pokemon } from "#field/pokemon";
import { randSeedInt } from "#utils/common";

/** Local fork (2026-11-20): the numbers of F1 Q5 */
export const MAX_MUSHROOM_OFFER_RULES = Object.freeze({
  /** The mushrooms' weight while no party member that can Gigantamax is without them ("없을 경우 4") */
  withoutGmaxWeight: 4,
});

/** Local fork (2026-11-20): the rare form change slot's ROGUE weight at `waveIndex` (unchanged: 6 / 12 / 18 / 24) */
export function getRareFormChangeSlotWeight(waveIndex: number): number {
  return Math.min(Math.ceil(waveIndex / 50), 4) * 6;
}

/**
 * Local fork (2026-11-20): whether `pokemon` can Gigantamax with Max Mushrooms: its species has a G-Max / E-Max form
 * that the mushrooms make (the original game's mushroom species, Eternatus included). Its current form is not checked.
 */
export function canGigantamaxWithMushrooms(pokemon: Pokemon): boolean {
  return speciesDataRegistry.getFormChanges(pokemon.species.speciesId).some(fc => {
    const trigger = fc.findTrigger(SpeciesFormChangeItemTrigger);
    return (
      trigger instanceof SpeciesFormChangeItemTrigger
      && trigger.item === FormChangeItem.MAX_MUSHROOMS
      && trigger.active
      && MAX_FORM_KEYS.includes(fc.formKey)
    );
  });
}

/**
 * Local fork (2026-11-20): whether one of the player's Pokémon in `party` can Gigantamax and holds no Max Mushrooms yet
 * ("거다이가 있을 경우")
 */
export function hasGmaxMemberWithoutMushrooms(party: readonly Pokemon[]): boolean {
  return party.some(p => p.isPlayer() && canGigantamaxWithMushrooms(p) && !holdsMaxMushrooms(p));
}

/**
 * Local fork (2026-11-20): the rare form change slot's weight when its generator would choose from `pool`: the slot's
 * `slotWeight`, except when Max Mushrooms are all it could give and nobody waits to Gigantamax (then
 * {@linkcode MAX_MUSHROOM_OFFER_RULES}.withoutGmaxWeight, at most `slotWeight`)
 */
export function getRareFormChangeWeightForPool(
  party: readonly Pokemon[],
  pool: readonly FormChangeItem[],
  slotWeight: number,
): number {
  const onlyMushrooms = pool.length > 0 && pool.every(item => item === FormChangeItem.MAX_MUSHROOMS);
  if (onlyMushrooms && !hasGmaxMemberWithoutMushrooms(party)) {
    return Math.min(slotWeight, MAX_MUSHROOM_OFFER_RULES.withoutGmaxWeight);
  }
  return slotWeight;
}

/**
 * Local fork (2026-11-20): the form change generators' draw from `pool` (seeded, one roll as before). Every item has an
 * even chance, except Max Mushrooms beside other items while nobody waits to Gigantamax: they get
 * {@linkcode MAX_MUSHROOM_OFFER_RULES}.withoutGmaxWeight out of the slot's `slotWeight` (an even share at most), and
 * the other items share the rest evenly.
 * @param pool - The generator's items, not empty
 */
export function pickFormChangeItem(
  party: readonly Pokemon[],
  pool: readonly FormChangeItem[],
  slotWeight: number,
): FormChangeItem {
  const n = pool.length;
  const others = pool.filter(item => item !== FormChangeItem.MAX_MUSHROOMS);
  if (others.length === 0 || others.length === n || slotWeight <= 0 || hasGmaxMemberWithoutMushrooms(party)) {
    return pool[randSeedInt(n)];
  }
  // In units of 1/n of the slot's weight, so an even share of one entry is `slotWeight` units
  const total = slotWeight * n;
  const mushroomUnits = Math.min(MAX_MUSHROOM_OFFER_RULES.withoutGmaxWeight * n, slotWeight * (n - others.length));
  const roll = randSeedInt(total);
  if (roll < mushroomUnits) {
    return FormChangeItem.MAX_MUSHROOMS;
  }
  return others[Math.floor(((roll - mushroomUnits) * others.length) / (total - mushroomUnits))];
}
