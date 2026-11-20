/*
 * Local fork (2026-11-18): Dynamax without a Gigantamax form, and Mega + Dynamax. The user: "거다이맥스 아니어도
 * 다이맥스 가능하게(특성과 패시브는 유지)해보죠 / 메가몬도 다이맥스 가능하게 해서 메가 + 다이맥스 + z기술 + 테라스탈 같은
 * 조합도 가능하게 해보고".
 *
 * - The Dynamax state ({@linkcode isInDynamaxState}): one of the player's Pokémon holding active Max Mushrooms (다이버섯)
 *   that is in no G-Max / E-Max form. Its form does not change, so its ability and passive stay; its max HP is
 *   x{@linkcode DYNAMAX_HP_MULTIPLIER} (`Pokemon.calculateStats`, the current HP in proportion when the state starts or
 *   ends) and it is drawn x{@linkcode DYNAMAX_SPRITE_SCALE} like a G-Max form (`Pokemon.getSpriteScale`, the field
 *   zooming out the same way). Nothing new is saved: the item and its active flag already are. `Pokemon.isDynamaxed()`
 *   is a G-Max / E-Max form or this state. It stays through fainting, like a G-Max form. Local fork (2026-11-20), F1
 *   Q6 (the user: "추천대로"): the player's side only after the first Classic clear (fork-unlock.ts).
 * - A species with a G-Max form, in the form that form starts from, still becomes it with the mushrooms, as before
 *   (review fix: also right after evolving into one while holding them, `EvolutionPhase`, so a reload changes nothing).
 * - The mushrooms stack with a Mega Stone or a Red / Blue Orb: a Mega / Primal form comes first (that form + the
 *   Dynamax state), the G-Max form only without one. Switching either item on the reward screen goes straight to the
 *   form the two lead to ({@linkcode getStackedItemFormChange}): Mega X -> G-Max when the stone is switched off, G-Max
 *   -> Mega X when it is switched on.
 * - The enemy side: no enemy's form change is redirected (an enemy's mushrooms never change its form: the item trigger
 *   only reads the player's items). Local fork (2026-11-18): an enemy holding active Max Mushrooms in no G-Max / E-Max
 *   form is in the Dynamax state too, with the same HP x1.5 and scale; its mushrooms come from the enemy Dynamax roll
 *   (enemy-dynamax.ts; the user: "적 다이맥스 상태 넣고").
 */

import { speciesDataRegistry } from "#app/global-species-data-registry";
// Local fork (2026-11-20): F1 Q6, the player's Dynamax state waits for the first Classic clear
import { isForkContentUnlocked } from "#balance/fork-unlock";
import { SpeciesFormChangeItemTrigger } from "#data/form-change-triggers";
import { SpeciesFormChange } from "#data/pokemon-forms";
import { FormChangeItem } from "#enums/form-change-item";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";

/** The Dynamax state's max HP multiplier */
export const DYNAMAX_HP_MULTIPLIER = 1.5;
/** The Dynamax state's sprite scale, a G-Max form's */
export const DYNAMAX_SPRITE_SCALE = 1.5;

/**
 * The G-Max / E-Max form keys, used by `Pokemon.isMax` and `Pokemon.getSpriteScale` too.
 * Local fork (2026-11-18), review fix: the one list (pokemon.ts had its own copy), so the resolver's "a Mega / Primal
 * form before the G-Max form" and `isMax()` always agree.
 */
export const MAX_FORM_KEYS: readonly string[] = Object.freeze([
  SpeciesFormKey.GIGANTAMAX,
  SpeciesFormKey.GIGANTAMAX_RAPID,
  SpeciesFormKey.GIGANTAMAX_SINGLE,
  SpeciesFormKey.ETERNAMAX,
]);

/** Whether `formKey` is a G-Max / E-Max form's */
function isMaxFormKey(formKey: string): boolean {
  return MAX_FORM_KEYS.includes(formKey);
}

/** The form-change items `pokemon` holds, with their active flags */
function getHeldFormChangeItems(pokemon: Pokemon): { formChangeItem: FormChangeItem; active: boolean }[] {
  return pokemon.getHeldItems().filter(m => m.is("PokemonFormChangeItemModifier"));
}

/**
 * Whether `pokemon` holds Max Mushrooms
 * @param pokemon - The Pokémon
 * @param activeOnly - Only active ones count
 */
export function holdsMaxMushrooms(pokemon: Pokemon, activeOnly = false): boolean {
  return getHeldFormChangeItems(pokemon).some(
    m => m.formChangeItem === FormChangeItem.MAX_MUSHROOMS && (!activeOnly || m.active),
  );
}

/** `fc`'s item trigger, if it is an item form change made with an active item (not a generated reverse one) */
function getActiveItemTrigger(fc: SpeciesFormChange): SpeciesFormChangeItemTrigger | undefined {
  const trigger = fc.findTrigger(SpeciesFormChangeItemTrigger);
  return trigger instanceof SpeciesFormChangeItemTrigger && trigger.active ? trigger : undefined;
}

/** What `pokemon`'s held form-change items lead to, see {@linkcode getItemFormTarget} */
interface ItemFormTarget {
  /** Its current form key */
  formKey: string;
  /** The form its item forms start from: the current one, unless it is in a form one of its items made */
  home: string;
  /** The item form change from `home` its active items pick, a Mega / Primal one first; none: `home` itself */
  target: SpeciesFormChange | undefined;
}

/**
 * The form a player's Pokémon's active form-change items lead to: from `home` (the form its item forms start from,
 * normally the base form), the first item form change whose item is active, a non-G-Max one first, as the forward
 * form changes are listed (Mega Stones come before the G-Max form in the data). `null` for an enemy, Necrozma (its
 * Ultra Burst starts from the item forms, left to the old rules) or a species without form changes.
 */
function getItemFormTarget(pokemon: Pokemon): ItemFormTarget | null {
  const speciesId = pokemon.species.speciesId;
  if (!pokemon.isPlayer() || speciesId === SpeciesId.NECROZMA || !speciesDataRegistry.hasFormChanges(speciesId)) {
    return null;
  }
  const formKey = pokemon.getFormKey();
  const held = getHeldFormChangeItems(pokemon).map(m => m.formChangeItem);
  const forward = speciesDataRegistry.getFormChanges(speciesId).filter(fc => getActiveItemTrigger(fc) != null);
  const reachedBy = forward.find(fc => fc.formKey === formKey && held.includes(getActiveItemTrigger(fc)!.item));
  const home = reachedBy?.preFormKey ?? formKey;
  const candidates = forward.filter(
    fc => fc.preFormKey === home && fc.conditions.every(c => c.predicate(pokemon)) && fc.trigger.canChange(pokemon),
  );
  const target = candidates.find(fc => !isMaxFormKey(fc.formKey)) ?? candidates[0];
  return { formKey, home, target };
}

/**
 * Whether `pokemon`'s active items take it straight from its current form to a G-Max / E-Max form (a G-Max species in
 * its base form holding active mushrooms and no active Mega Stone): its form change is queued or about to be
 */
function isBoundForMaxForm(pokemon: Pokemon): boolean {
  const target = getItemFormTarget(pokemon)?.target;
  return target != null && isMaxFormKey(target.formKey) && target.preFormKey === pokemon.getFormKey();
}

/**
 * Whether `pokemon` is in the Dynamax state: a Pokémon holding active Max Mushrooms, in no G-Max / E-Max form (its own
 * or its fusion's, `Pokemon.isMax`).
 * Local fork (2026-11-18), review fix: not a player's Pokémon whose mushrooms take it straight to its G-Max form
 * ({@linkcode isBoundForMaxForm}): between the item being added (whose `updateModifiers` recalculates the stats) and its
 * form change, or after evolving into a G-Max species (`EvolutionPhase` then runs the form change). Its HP follows the
 * G-Max form change as before (the rise added), not the state's ratio, and it is never drawn large in its base form.
 * Local fork (2026-11-18): an enemy too (enemy-dynamax.ts; the user: "적 다이맥스 상태 넣고"). Before, only the player's
 * Pokémon. An enemy's mushrooms never change its form, so it is never bound for a G-Max form: a G-Max species' base
 * form holding them is in the state; an enemy in its G-Max form (enemy-battle-forms.ts, a trainer config's) is not.
 * Local fork (2026-11-20), F1 Q6 (the user: "추천대로"): no player's Pokémon before the first Classic clear
 * (fork-unlock.ts), as in the original game, where mushrooms do nothing for a species without a G-Max form (one that
 * evolved from a G-Max species holding them, say). The enemies are not changed.
 */
export function isInDynamaxState(pokemon: Pokemon): boolean {
  if (pokemon.isMax() || !holdsMaxMushrooms(pokemon, true)) {
    return false;
  }
  if (pokemon.isPlayer() && !isForkContentUnlocked()) {
    return false;
  }
  return !pokemon.isPlayer() || !isBoundForMaxForm(pokemon);
}

/**
 * The item form change for a player's Pokémon holding Max Mushrooms beside other form-change items: the form its
 * active items lead to ({@linkcode getItemFormTarget}), reached in one form change even when the data only goes
 * through the base form (Mega X -> G-Max, G-Max -> Mega X: a form change made for the moment from the target's own,
 * with its trigger, so the message, the achievement and the fanfare are the target form's). Anything else, or a
 * Pokémon without mushrooms, keeps `normalMatch`, the form change `BattleScene.triggerPokemonFormChange` found.
 * @param pokemon - The Pokémon whose item form change is being looked for
 * @param normalMatch - The form change found the usual way, if any
 */
export function getStackedItemFormChange(
  pokemon: Pokemon,
  normalMatch: SpeciesFormChange | null,
): SpeciesFormChange | null {
  if (!holdsMaxMushrooms(pokemon)) {
    return normalMatch;
  }
  const info = getItemFormTarget(pokemon);
  if (info?.target == null) {
    // back to its home form (the usual reverse form change) or nothing to do
    return normalMatch;
  }
  const { formKey, target } = info;
  if (target.formKey === formKey || target.formKey === normalMatch?.formKey) {
    return normalMatch;
  }
  if (target.preFormKey === formKey) {
    return target;
  }
  return new SpeciesFormChange({
    speciesId: target.speciesId,
    preFormKey: formKey,
    evoFormKey: target.formKey,
    trigger: target.trigger,
    quiet: target.quiet,
  });
}
