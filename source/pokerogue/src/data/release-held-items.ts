/*
 * Local fork (2026-11-20): Q1, a released Pokémon's held items can go to another Pokémon first (the user: "실행"; the
 * official requests #790 and #2646). Released, a Pokémon used to take all its items away
 * (`BattleScene.removePartyMemberModifiers`).
 *
 * - Released from the party menu, its items can go to another party member, chosen on the party screen.
 * - Released to make room for a Pokémon being caught, they go to that Pokémon by default: they are kept here until it
 *   joins the party (`keepHeldItemsForCaughtPokemon`, `giveKeptHeldItemsTo`).
 * - The move is the party screen's "transfer all" (party-ui-handler.ts, `processTransferOption` with `transferAll`, and
 *   SelectModifierPhase's transfer callback): every stack, the last one first, each one capped at what the receiver can
 *   still hold. What is over the receiver's limit stays, and is lost with the released Pokémon; the player is told
 *   before releasing (`countHeldItemsOverLimit`).
 */

import { globalScene } from "#app/global-scene";
import type { Pokemon } from "#field/pokemon";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import i18next from "i18next";

/**
 * The held items `pokemon` can pass on, those the party screen's transfer lists (`isTransferable`)
 * @param pokemon - The holder, the player's or the enemy's
 */
export function getTransferableHeldItems(pokemon: Pokemon): PokemonHeldItemModifier[] {
  return globalScene.findModifiers(
    m => m.is("PokemonHeldItemModifier") && m.isTransferable && m.pokemonId === pokemon.id,
    pokemon.isPlayer(),
  ) as PokemonHeldItemModifier[];
}

/** The number of items in `items`, every stack counted whole */
export function countHeldItems(items: readonly PokemonHeldItemModifier[]): number {
  return items.reduce((total, item) => total + item.stackCount, 0);
}

/**
 * `pokemon`, an enemy about to join the player's party (the Pokémon being caught), as the item caps will see it there:
 * the player's Pokémon get higher caps in Endless (`endlessHeldItemCap`, which asks `isPlayer`). Its own data (IVs,
 * species...) is read through.
 */
function asPartyMember(pokemon: Pokemon): Pokemon {
  if (pokemon.isPlayer()) {
    return pokemon;
  }
  return Object.create(pokemon, { isPlayer: { value: () => true }, isEnemy: { value: () => false } });
}

/**
 * How many of `items` would not fit on `target`: for each stack, what is over the room `target` has left for that item.
 * A stack `target` does not hold yet goes over whole, as in {@linkcode BattleScene.tryTransferHeldItemModifier}.
 * @param items - The stacks to give
 * @param target - The receiver: one of the player's, or the Pokémon being caught (still the enemy's; its caps are
 *   counted as they will be in the party)
 */
export function countHeldItemsOverLimit(items: readonly PokemonHeldItemModifier[], target: Pokemon): number {
  const capHolder = asPartyMember(target);
  let over = 0;
  for (const item of items) {
    const matching = globalScene.findModifier(
      m => m.is("PokemonHeldItemModifier") && m.matchType(item) && m.pokemonId === target.id,
      target.isPlayer(),
    ) as PokemonHeldItemModifier | undefined;
    if (matching) {
      const room = Math.max(matching.getMaxHeldItemCount(capHolder) - matching.stackCount, 0);
      over += Math.max(item.stackCount - room, 0);
    }
  }
  return over;
}

/**
 * Give `items` to `target`, the party screen's "transfer all": the last stack first, each one whole, capped by
 * {@linkcode BattleScene.tryTransferHeldItemModifier} at what `target` can still hold.
 * @returns How many items did not fit (left in their stacks)
 */
function giveAll(items: readonly PokemonHeldItemModifier[], target: Pokemon): number {
  for (let i = items.length - 1; i >= 0; i--) {
    // As SelectModifierPhase's transfer callback: no item-lost trigger (Unburden) for the giver
    globalScene.tryTransferHeldItemModifier(items[i], target, true, items[i].stackCount, undefined, undefined, false);
  }
  return countHeldItems(items);
}

/**
 * Move all of `source`'s transferable items to `target` (both in the player's party)
 * @returns How many items stayed with `source`, over `target`'s limits
 */
export function transferAllHeldItems(source: Pokemon, target: Pokemon): number {
  return giveAll(getTransferableHeldItems(source), target);
}

/** The Pokémon being caught while the party is full, set while the player picks one to release */
let catchTarget: Pokemon | null = null;
/** The items of the Pokémon released for it, waiting for it to join the party */
let keptItems: PokemonHeldItemModifier[] = [];
/** How many of {@linkcode keptItems} the player was told would not fit */
let keptItemsToldOver = 0;

/**
 * Set (or clear) the Pokémon being caught, before the party screen opens to release one for it
 * (AttemptCapturePhase, and `catchPokemon` of the mystery encounters)
 */
export function setCatchReleaseTarget(pokemon: Pokemon | null): void {
  catchTarget = pokemon;
}

/** The Pokémon being caught, if the party screen was opened to release one for it */
export function getCatchReleaseTarget(): Pokemon | null {
  return catchTarget;
}

/**
 * Take `source`'s transferable items off it, kept for the Pokémon being caught ({@linkcode giveKeptHeldItemsTo}).
 * Called just before `source` is released.
 * @param source - The Pokémon about to be released
 * @param toldOver - How many of its items the player was told would not fit
 */
export function keepHeldItemsForCaughtPokemon(source: Pokemon, toldOver = 0): void {
  keptItems = getTransferableHeldItems(source);
  keptItemsToldOver = toldOver;
  for (const item of keptItems) {
    globalScene.removeModifier(item, !source.isPlayer());
    // Held by no one until given: the transfer then finds no giver to take them from, and only adds
    item.pokemonId = -1;
  }
}

/** Whether items are waiting for the Pokémon being caught */
export function hasKeptHeldItems(): boolean {
  return keptItems.length > 0;
}

/**
 * Give the kept items to the newly caught Pokémon, once it is in the party with its own items. Clears the catch.
 * @param target - The newly caught Pokémon, or nothing if it did not join (the kept items are then lost)
 * @returns How many items did not fit and were lost, past those the player was already told about
 */
export function giveKeptHeldItemsTo(target: Pokemon | null | undefined): number {
  const items = keptItems;
  const toldOver = keptItemsToldOver;
  keptItems = [];
  keptItemsToldOver = 0;
  catchTarget = null;
  if (items.length === 0) {
    return 0;
  }
  const lost = target ? giveAll(items, target) : countHeldItems(items);
  return Math.max(lost - toldOver, 0);
}

/**
 * After a catch, tell the player about kept items that were lost without warning ({@linkcode giveKeptHeldItemsTo}),
 * then go on
 * @param lost - The number of items lost
 * @param callback - What comes next
 */
export function showLostKeptItemsNotice(lost: number, callback: () => void): void {
  if (lost <= 0) {
    callback();
    return;
  }
  globalScene.ui.showText(i18next.t("partyUiHandler:releaseItemsLost", { amount: lost }), null, callback, null, true);
}
