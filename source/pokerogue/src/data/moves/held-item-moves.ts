/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Local fork (2026-11-20): the held-item moves of 1.2.0 D5: Trick (트릭), Switcheroo (바꿔치기), Fling (내던지기) and
 * Natural Gift (자연의은혜). The user: "자연의은혜(나무열매 선택, 위력과 타입 표시, 열매주머니 발동 가능),
 * 트릭/바꿔치기(주는 템은 선택, 받는 아이템은 랜덤), 내던지기(도구 선택), 내던지기용 xlsx표도 제작 ... 도구 변경은 전투 후
 * 되돌아옴 / 적 또한 플레이어 도구 간섭 가능 ... n1 그대로".
 *
 * Choosing the item
 * - After the player picks one of these moves, the fight menu lists the usable held items (`FightUiHandler`): the
 *   item to give (Trick, Switcheroo), to throw (Fling) or the berry to use (Natural Gift, each line with the type and
 *   power it gives). For Fling and Natural Gift the 강공 / 중공 / 속공 choice (S1, move-style.ts) follows; cancel at
 *   either step goes back one step. The chosen item's key ({@linkcode getHeldItemKey}) goes into the turn command
 *   (`TurnCommand.heldItemKey`, `CommandPhase.handleCommand`), and the move reads it from there
 *   ({@linkcode getCommandedHeldItemKey}). A chosen item that is gone by the time the move is used makes it fail.
 * - Enemies, and a player's move that was called (Metronome, Sleep Talk ...), pick by rule ({@linkcode pickHeldItem}):
 *   Trick gives a Choice item, a Flame / Toxic Orb or Radioactive Waste that would hurt the target, else a random item;
 *   Fling throws the item with the highest power; Natural Gift uses a berry whose type is super effective, else the
 *   strongest.
 * - Fling and Natural Gift cannot be selected without an item to throw / a berry (a message says why); Trick and
 *   Switcheroo fail as in the main series when nothing can change hands.
 *
 * The moves
 * - Trick / Switcheroo: one of the user's held items (one unit of a stack) for a random held item of the target (one
 *   unit), checked with the fork's steal filters (`BattleScene.canTakeHeldItem`). One direction is enough, as in the
 *   main series (nothing to give: it only takes; nothing to take: it only gives). Fails against Sticky Hold, or when
 *   nothing can move. Items that never move between Pokémon (form change items, vitamins ...) are never involved.
 *   Giving or receiving a Choice item lifts the holder's Choice lock. Enemies use them on the player's Pokémon too.
 * - Fling: the item's power and effect come from fling-table.ts. The item is thrown when the move is used, before the
 *   accuracy check (it is gone even after a miss, as in the main series); the effect lands only on a hit.
 * - Natural Gift: the berry's type and power ({@linkcode NATURAL_GIFT_TABLE}, Gen 6+ values). The berry is used as if
 *   eaten: the Berry Pouch (열매주머니) may keep it, and a used berry goes to `battleData.berriesEaten` (Harvest,
 *   Recycle; not Cud Chew's list, not Belch's "has eaten a berry").
 *
 * Revert after battle ("도구 변경은 전투 후 되돌아옴")
 * - Every unit Trick / Switcheroo moves, and every item a player's Pokémon throws with Fling, is written in a per-battle
 *   ledger as a net count per Pokémon and item ({@linkcode recordHeldItemMoveChange}). When the battle ends
 *   (`BattleEndPhase`: victory, flight, capture, the wave's end; `GameOverPhase`), {@linkcode revertHeldItemMoveChanges}
 *   evens out the counts of every Pokémon then in the player's party: items it gave away or threw come back (up to the
 *   item's stack cap), items it received are taken back (as many as it still holds). A caught enemy is in the party by
 *   then, so a player's item it held goes back to its owner and its own item comes back to it.
 * - Thief, Covet, Pickpocket, Magician, Grip Claw and Mini Black Hole keep their own rules; when one of them takes a
 *   unit that is on loan, the loan follows the unit ({@linkcode followHeldItemMoveClaim}, from
 *   `BattleScene.tryTransferHeldItemModifier`), so stealing a lent item back never doubles it.
 * - Local fork (2026-11-20 night): an item an enemy takes from a player's Pokémon with Thief / Covet goes in the ledger
 *   too, so it comes back after the battle (the user: "도둑질도 되돌림"; {@linkcode transferStolenHeldItem}). The
 *   player's own Thief / Covet on an enemy, Pickpocket, Magician, Grip Claw and Mini Black Hole stay lasting.
 * - A berry used by Natural Gift was eaten: it does not come back (the main session's reading of the user's rule).
 */

import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import type { Battle } from "#app/battle";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { CHOICE_ITEM_TYPE_IDS } from "#data/battler-tags";
import { getBerryEffectFunc } from "#data/berry";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BerryType } from "#enums/berry-type";
import { Command } from "#enums/command";
import { FormChangeItem } from "#enums/form-change-item";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { BATTLE_STATS, Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import { BerryModifier, type PokemonHeldItemModifier, PreserveBerryModifier } from "#modifiers/modifier";
import { FLING_DEFAULT_ENTRY, FLING_TABLE, type FlingEffect, type FlingEntry } from "#moves/fling-table";
import { BooleanHolder } from "#utils/common";
import { getPokemonTypeLocaleKey } from "#utils/i18n";
import i18next from "i18next";

// #region Kinds and tables

/** What a held-item move does with the chosen item */
export type HeldItemMoveKind = "give" | "throw" | "berry";

const HELD_ITEM_MOVE_KINDS: ReadonlyMap<MoveId, HeldItemMoveKind> = new Map<MoveId, HeldItemMoveKind>([
  [MoveId.TRICK, "give"],
  [MoveId.SWITCHEROO, "give"],
  [MoveId.FLING, "throw"],
  [MoveId.NATURAL_GIFT, "berry"],
]);

/** @returns What `moveId` does with a held item, or `undefined` for any other move */
export function getHeldItemMoveKind(moveId: MoveId): HeldItemMoveKind | undefined {
  return HELD_ITEM_MOVE_KINDS.get(moveId);
}

/** Natural Gift's type and power with one berry */
export interface NaturalGiftEntry {
  readonly type: PokemonType;
  readonly power: number;
}

/**
 * Natural Gift's type and power by berry, the main series' Gen 6+ values (N1, the user: "n1 그대로"): 자뭉 에스퍼 80,
 * 리샘 비행 80, 과사 격투 80, 치리 풀 100, 용아 얼음 100, 캄라 격투 100, 야타비 독 100, 규살 땅 100, 랑사 비행 100,
 * 스타 에스퍼 100, 의문 벌레 100.
 */
export const NATURAL_GIFT_TABLE: Readonly<Record<BerryType, NaturalGiftEntry>> = Object.freeze({
  [BerryType.SITRUS]: Object.freeze({ type: PokemonType.PSYCHIC, power: 80 }),
  [BerryType.LUM]: Object.freeze({ type: PokemonType.FLYING, power: 80 }),
  [BerryType.ENIGMA]: Object.freeze({ type: PokemonType.BUG, power: 100 }),
  [BerryType.LIECHI]: Object.freeze({ type: PokemonType.GRASS, power: 100 }),
  [BerryType.GANLON]: Object.freeze({ type: PokemonType.ICE, power: 100 }),
  [BerryType.PETAYA]: Object.freeze({ type: PokemonType.POISON, power: 100 }),
  [BerryType.APICOT]: Object.freeze({ type: PokemonType.GROUND, power: 100 }),
  [BerryType.SALAC]: Object.freeze({ type: PokemonType.FIGHTING, power: 100 }),
  [BerryType.LANSAT]: Object.freeze({ type: PokemonType.FLYING, power: 100 }),
  [BerryType.STARF]: Object.freeze({ type: PokemonType.PSYCHIC, power: 100 }),
  [BerryType.LEPPA]: Object.freeze({ type: PokemonType.FIGHTING, power: 80 }),
});

/**
 * The key of a held item in {@linkcode FLING_TABLE}, the turn command and the ledger: its modifier type id, with the
 * generated item after a colon for generated types (`BERRY:SITRUS`, `ATTACK_TYPE_BOOSTER:FIRE`; both species booster
 * types share `SPECIES_STAT_BOOSTER:<item>`). Items of one key on one Pokémon share one stack.
 */
export function getHeldItemKey(item: PokemonHeldItemModifier): string {
  if (item instanceof BerryModifier) {
    return `BERRY:${BerryType[item.berryType]}`;
  }
  const type = item.type as { id?: string; key?: unknown; moveType?: unknown; getPregenArgs?: () => unknown[] };
  const id = type?.id ?? item.constructor.name;
  if (id === "SPECIES_STAT_BOOSTER" || id === "RARE_SPECIES_STAT_BOOSTER") {
    return `SPECIES_STAT_BOOSTER:${String(type.key)}`;
  }
  if (id === "ATTACK_TYPE_BOOSTER" && typeof type.moveType === "number") {
    return `${id}:${PokemonType[type.moveType]}`;
  }
  const args = typeof type?.getPregenArgs === "function" ? type.getPregenArgs() : [];
  if (args.length === 0) {
    return id;
  }
  const arg = args[0];
  if (typeof arg !== "number") {
    return `${id}:${String(arg)}`;
  }
  if (id === "FORM_CHANGE_ITEM" || id === "RARE_FORM_CHANGE_ITEM") {
    return `${id}:${FormChangeItem[arg]}`;
  }
  if (id === "BASE_STAT_BOOSTER" || id === "IV_CANDY") {
    return `${id}:${Stat[arg]}`;
  }
  return `${id}:${arg}`;
}

/** @returns `item`'s row of {@linkcode FLING_TABLE}: its own, its type id's, else {@linkcode FLING_DEFAULT_ENTRY} */
export function getFlingEntry(item: PokemonHeldItemModifier): FlingEntry {
  const key = getHeldItemKey(item);
  return FLING_TABLE[key] ?? FLING_TABLE[key.split(":")[0]] ?? FLING_DEFAULT_ENTRY;
}

/** @returns Whether `item` can be thrown: it moves between Pokémon and its row lets it */
export function canFlingItem(item: PokemonHeldItemModifier): boolean {
  const entry = getFlingEntry(item);
  return item.isTransferable && entry.throwable !== false && entry.power > 0;
}

/** @returns Natural Gift's type and power with `item`, or `undefined` when it is not a berry */
export function getNaturalGiftEntry(item: PokemonHeldItemModifier): NaturalGiftEntry | undefined {
  return item instanceof BerryModifier ? NATURAL_GIFT_TABLE[item.berryType] : undefined;
}

// #endregion

// #region Which items

/**
 * Whether `receiver` can take one unit of `item` in a held-item move: the fork's steal filters
 * (`BattleScene.canTakeHeldItem`: room, no EV item for an enemy, the orb vessels and the full-item rule for the player),
 * or, failing the room alone, room made by `outgoing`, the unit of the same kind `receiver` gives in the same swap (a
 * Flame Orb for a Toxic Orb: one orb each).
 */
function canReceiveHeldItem(
  receiver: Pokemon,
  item: PokemonHeldItemModifier,
  outgoing?: PokemonHeldItemModifier | null,
): boolean {
  if (!item.isTransferable) {
    return false;
  }
  if (globalScene.canTakeHeldItem(item, receiver)) {
    return true;
  }
  if (outgoing == null || outgoing.pokemonId !== receiver.id || !outgoing.matchType(item)) {
    return false;
  }
  return outgoing.stackCount - 1 < Math.max(1, outgoing.getMaxHeldItemCount(receiver));
}

/** @returns The items of `target` that `user` could take in a swap where it gives `give` */
function getTakeCandidates(
  user: Pokemon,
  target: Pokemon,
  give: PokemonHeldItemModifier | null | undefined,
): PokemonHeldItemModifier[] {
  return target.getHeldItems().filter(i => i.isTransferable && canReceiveHeldItem(user, i, give));
}

/**
 * The held items `pokemon` can use with `moveId`, in the order it holds them (the item choice lists these): its
 * transferable items for Trick / Switcheroo (when the target is known, only those it can take), its throwable items for
 * Fling, its berries for Natural Gift.
 * @param target - The target, when known (Trick / Switcheroo leave out what it cannot take)
 */
export function getHeldItemMoveOptions(pokemon: Pokemon, moveId: MoveId, target?: Pokemon): PokemonHeldItemModifier[] {
  const kind = getHeldItemMoveKind(moveId);
  if (kind == null) {
    return [];
  }
  const items = pokemon.getHeldItems();
  switch (kind) {
    case "give":
      // With a known target, also an item that fits once the target gives its unit of that kind back (Flame Orb for
      // Toxic Orb)
      return items.filter(
        i =>
          i.isTransferable
          && (target == null || canReceiveHeldItem(target, i) || getForcedTake(pokemon, target, i) != null),
      );
    case "throw":
      return items.filter(i => canFlingItem(i));
    case "berry":
      return items.filter(i => i instanceof BerryModifier && !i.consumed && getNaturalGiftEntry(i) != null);
  }
}

/**
 * The key of the item the player chose for `moveId` in `pokemon`'s turn command, if that command is that move
 * (a called move, an enemy, or no choice: `undefined`)
 */
export function getCommandedHeldItemKey(pokemon: Pokemon, moveId: MoveId): string | undefined {
  const command = globalScene.currentBattle?.turnCommands[pokemon.getBattlerIndex()];
  if (command?.command !== Command.FIGHT || command.move?.move !== moveId) {
    return;
  }
  return command.heldItemKey;
}

/**
 * Whether giving `item` would hurt `target` (the AI's Trick / Switcheroo, and its score): a Choice item, a Flame / Toxic
 * Orb it can be burned / badly poisoned by, Radioactive Waste on a Pokémon that is not Poison type and can be poisoned
 */
export function isHarmfulGift(item: PokemonHeldItemModifier, target?: Pokemon): boolean {
  const id = item.type?.id;
  if (CHOICE_ITEM_TYPE_IDS.has(id)) {
    return true;
  }
  const status =
    id === "FLAME_ORB"
      ? StatusEffect.BURN
      : id === "TOXIC_ORB"
        ? StatusEffect.TOXIC
        : id === "RADIOACTIVE_WASTE"
          ? StatusEffect.POISON
          : StatusEffect.NONE;
  if (status === StatusEffect.NONE) {
    return false;
  }
  if (target == null) {
    return true;
  }
  if (id === "RADIOACTIVE_WASTE" && target.isOfType(PokemonType.POISON)) {
    return false;
  }
  return !target.status && target.canSetStatus(status, true, true, null, true);
}

/** How good Natural Gift with `entry` is against `targets`: the best type effectiveness among them */
function getNaturalGiftEffectiveness(user: Pokemon, entry: NaturalGiftEntry, targets: Pokemon[]): number {
  if (targets.length === 0) {
    return 1;
  }
  return Math.max(...targets.map(t => t.getAttackTypeEffectiveness(entry.type, { source: user })));
}

/**
 * The rule's pick among `options` (enemies, and a player's called move): see the module notes. `random` lets Trick pick
 * at random (only when the move is used, never while planning or scoring).
 */
export function pickHeldItem(
  user: Pokemon,
  moveId: MoveId,
  options: PokemonHeldItemModifier[],
  target?: Pokemon,
  random = false,
): PokemonHeldItemModifier | undefined {
  if (options.length === 0) {
    return;
  }
  switch (getHeldItemMoveKind(moveId)) {
    case "give": {
      const harmful = options.filter(i => isHarmfulGift(i, target));
      const pool = harmful.length > 0 ? harmful : options;
      return random ? pool[user.randBattleSeedInt(pool.length)] : pool[0];
    }
    case "throw":
      return options.reduce((best, i) => (getFlingEntry(i).power > getFlingEntry(best).power ? i : best));
    case "berry": {
      const targets = target ? [target] : user.getOpponents();
      const scored = options.map(i => {
        const entry = getNaturalGiftEntry(i)!;
        const effectiveness = getNaturalGiftEffectiveness(user, entry, targets);
        return { item: i, effectiveness, score: entry.power * effectiveness, power: entry.power };
      });
      const superEffective = scored.filter(s => s.effectiveness > 1);
      const pool = superEffective.length > 0 ? superEffective : scored;
      return pool.reduce((best, s) =>
        s.score > best.score || (s.score === best.score && s.power > best.power) ? s : best,
      ).item;
    }
    default:
      return;
  }
}

/**
 * The item `user`'s use of `moveId` goes with: the player's choice from the turn command (`null` when that item is no
 * longer usable, so the move fails), else the rule's pick (`undefined` when there is nothing to use).
 */
export function resolveHeldItemChoice(
  user: Pokemon,
  moveId: MoveId,
  target?: Pokemon,
  random = false,
): PokemonHeldItemModifier | null | undefined {
  const options = getHeldItemMoveOptions(user, moveId, target);
  const key = getCommandedHeldItemKey(user, moveId);
  if (key != null) {
    return options.find(i => getHeldItemKey(i) === key) ?? null;
  }
  return pickHeldItem(user, moveId, options, target, random);
}

/**
 * Whether `user`'s Fling / Natural Gift has an item to go with (the move's condition): the player's chosen item is
 * still there, or the rule finds one
 */
export function hasHeldItemForMove(user: Pokemon, moveId: MoveId, target?: Pokemon): boolean {
  return resolveHeldItemChoice(user, moveId, target) != null;
}

// #endregion

// #region Showing the choice

/** The line of the item choice for `item` (Fling with its power, Natural Gift with its type and power) */
export function getHeldItemChoiceLabel(item: PokemonHeldItemModifier, kind: HeldItemMoveKind): string {
  const itemName = item.type.name;
  if (kind === "throw") {
    return i18next.t("fightUiHandler:heldItemChoiceFling", { itemName, power: getFlingEntry(item).power });
  }
  const entry = kind === "berry" ? getNaturalGiftEntry(item) : undefined;
  if (entry) {
    return i18next.t("fightUiHandler:heldItemChoiceNaturalGift", {
      itemName,
      type: i18next.t(getPokemonTypeLocaleKey(entry.type)),
      power: entry.power,
    });
  }
  return itemName;
}

/** The power `moveId` has with the item of `key` among `pokemon`'s items (the fight menu's move info), if any */
export function getHeldItemChoicePower(pokemon: Pokemon, moveId: MoveId, key: string): number | undefined {
  const item = pokemon.getHeldItems().find(i => getHeldItemKey(i) === key);
  if (item == null) {
    return;
  }
  switch (getHeldItemMoveKind(moveId)) {
    case "throw":
      return getFlingEntry(item).power;
    case "berry":
      return getNaturalGiftEntry(item)?.power;
    default:
      return;
  }
}

// #endregion

// #region Using the item (Fling, Natural Gift)

/** One use of Fling / Natural Gift in flight: the item it went with, kept after the item itself is gone */
export interface HeldItemMoveUse {
  readonly move: MoveId;
  readonly key: string;
  readonly itemName: string;
  readonly power: number;
  readonly type?: PokemonType | undefined;
  readonly effect?: FlingEffect | undefined;
  readonly berryType?: BerryType | undefined;
}

/** Keyed by the user's `turnData`, so a record never outlives its turn */
const activeUses = new WeakMap<object, HeldItemMoveUse>();

/** @returns The item `user`'s use of `moveId` in flight went with, if it has started */
export function getActiveHeldItemUse(user: Pokemon, moveId: MoveId): HeldItemMoveUse | undefined {
  const use = user.turnData ? activeUses.get(user.turnData) : undefined;
  return use?.move === moveId ? use : undefined;
}

/** The power of `user`'s Fling / Natural Gift: the item in flight, else the one it would go with now */
export function getHeldItemMovePower(user: Pokemon, moveId: MoveId, target?: Pokemon): number | undefined {
  const use = getActiveHeldItemUse(user, moveId);
  if (use) {
    return use.power;
  }
  const item = resolveHeldItemChoice(user, moveId, target);
  if (item == null) {
    return;
  }
  return getHeldItemMoveKind(moveId) === "berry" ? getNaturalGiftEntry(item)?.power : getFlingEntry(item).power;
}

/** The type of `user`'s Natural Gift: the berry in flight, else the one it would use now (no berry: `undefined`) */
export function getNaturalGiftType(user: Pokemon): PokemonType | undefined {
  const use = getActiveHeldItemUse(user, MoveId.NATURAL_GIFT);
  if (use) {
    return use.type;
  }
  const item = resolveHeldItemChoice(user, MoveId.NATURAL_GIFT);
  return item ? getNaturalGiftEntry(item)?.type : undefined;
}

/** A one-unit copy of `item` that outlives it (for the ledger) */
function copyUnit(item: PokemonHeldItemModifier): PokemonHeldItemModifier {
  const copy = item.clone() as PokemonHeldItemModifier;
  copy.stackCount = 1;
  return copy;
}

/**
 * Start `user`'s use of Fling / Natural Gift (when the move is used, before the accuracy check): decide the item, keep
 * what the move needs from it, and let it go: Fling throws it (a player's item goes in the ledger); Natural Gift uses
 * the berry, unless the Berry Pouch keeps it. Later hits of the same use (Multi Lens) keep the first hit's item.
 * @returns Whether the use has an item (`false`: the move fails)
 */
export function startHeldItemMoveUse(user: Pokemon, moveId: MoveId, target?: Pokemon): boolean {
  if (user.turnData.hitsLeft !== -1 && getActiveHeldItemUse(user, moveId)) {
    return true;
  }
  const kind = getHeldItemMoveKind(moveId);
  const item = resolveHeldItemChoice(user, moveId, target);
  if (item == null || (kind !== "throw" && kind !== "berry")) {
    return false;
  }
  const key = getHeldItemKey(item);
  const itemName = item.type.name;
  const berryType = item instanceof BerryModifier ? item.berryType : undefined;

  if (kind === "throw") {
    const entry = getFlingEntry(item);
    activeUses.set(user.turnData, { move: moveId, key, itemName, power: entry.power, effect: entry.effect, berryType });
    globalScene.phaseManager.queueMessage(
      i18next.t("moveTriggers:flungItem", { pokemonName: getPokemonNameWithAffix(user), itemName }),
    );
    const unit = copyUnit(item);
    user.loseHeldItem(item);
    if (user.isPlayer()) {
      recordHeldItemMoveChange(user, unit, -1);
    }
  } else {
    const entry = getNaturalGiftEntry(item)!;
    activeUses.set(user.turnData, { move: moveId, key, itemName, power: entry.power, type: entry.type, berryType });
    const preserve = new BooleanHolder(false);
    globalScene.applyModifiers(PreserveBerryModifier, user.isPlayer(), user, preserve);
    if (!preserve.value) {
      user.loseHeldItem(item);
      user.battleData.berriesEaten.push(berryType!);
    }
  }
  globalScene.updateModifiers(user.isPlayer());
  return true;
}

/** Apply the effect of the item `user` threw with Fling to `target` (on a hit) */
export function applyFlingEffect(user: Pokemon, target: Pokemon): boolean {
  const use = getActiveHeldItemUse(user, MoveId.FLING);
  if (!use?.effect || target.isFainted()) {
    return false;
  }
  switch (use.effect) {
    case "burn":
      return target.trySetStatus(StatusEffect.BURN, user);
    case "toxic":
      return target.trySetStatus(StatusEffect.TOXIC, user);
    case "poison":
      return target.trySetStatus(StatusEffect.POISON, user);
    case "paralysis":
      return target.trySetStatus(StatusEffect.PARALYSIS, user);
    case "flinch":
      return target.addTag(BattlerTagType.FLINCHED, undefined, MoveId.FLING, user.id);
    case "whiteHerb": {
      let restored = false;
      for (const stat of BATTLE_STATS) {
        if (target.getStatStage(stat) < 0) {
          target.setStatStage(stat, 0);
          restored = true;
        }
      }
      if (restored) {
        globalScene.phaseManager.queueMessage(
          i18next.t("modifier:resetNegativeStatStageApply", {
            pokemonNameWithAffix: getPokemonNameWithAffix(target),
            typeName: use.itemName,
          }),
        );
      }
      return restored;
    }
    case "berry":
      if (use.berryType == null) {
        return false;
      }
      // The target eats it, whatever the berry's condition; it was not its own berry, so Harvest cannot bring it back
      getBerryEffectFunc(use.berryType)(target);
      applyAbAttrs("HealFromBerryUseAbAttr", { pokemon: target });
      target.recordEatenBerry(use.berryType, false);
      return true;
  }
}

// #endregion

// #region Trick / Switcheroo

/**
 * The give item of `user`'s Trick / Switcheroo on `target`: the player's choice (`null` when it can no longer go, so the
 * move fails), else the rule's pick, else `undefined` (nothing to give)
 */
function resolveGiveItem(
  user: Pokemon,
  target: Pokemon,
  moveId: MoveId,
  random: boolean,
): PokemonHeldItemModifier | null | undefined {
  return resolveHeldItemChoice(user, moveId, target, random);
}

/** Whether Sticky Hold (or the like) keeps `target`'s items, quietly unless `simulated` is `false` */
function itemsAreHeldFast(target: Pokemon, simulated: boolean): boolean {
  const cancelled = new BooleanHolder(false);
  applyAbAttrs("BlockItemTheftAbAttr", { pokemon: target, cancelled, simulated });
  return cancelled.value;
}

/**
 * Whether `user`'s Trick / Switcheroo on `target` can do anything (the move's condition): `target` has no Sticky Hold,
 * the player's chosen item can still go, and at least one unit can change hands.
 */
export function canSwapHeldItems(user: Pokemon, target: Pokemon | undefined, moveId: MoveId): boolean {
  if (target == null || target === user || itemsAreHeldFast(target, true)) {
    return false;
  }
  const give = resolveGiveItem(user, target, moveId, false);
  if (give === null) {
    return false;
  }
  return give != null || getTakeCandidates(user, target, give).length > 0;
}

/** The unit of `target` that must come back for `give` to fit (the same kind, at its cap), if any */
function getForcedTake(
  user: Pokemon,
  target: Pokemon,
  give: PokemonHeldItemModifier,
): PokemonHeldItemModifier | undefined {
  if (canReceiveHeldItem(target, give)) {
    return;
  }
  return target
    .getHeldItems()
    .find(t => t.matchType(give) && canReceiveHeldItem(target, give, t) && canReceiveHeldItem(user, t, give));
}

/** Take one unit of `item` from its holder (the stack goes when empty) */
function removeHeldItemUnit(item: PokemonHeldItemModifier, holder: Pokemon): void {
  item.stackCount--;
  if (item.stackCount <= 0) {
    globalScene.removeModifier(item, holder.isEnemy());
  }
}

/**
 * Give `holder` up to `count` units like `template` (merged into its stack of that kind, up to the stack cap). A player's
 * new stack goes straight into the list, so a received Flame Orb does not fill a Flame Cauldron for good mid-battle.
 * @returns How many units were given
 */
function addHeldItemUnits(holder: Pokemon, template: PokemonHeldItemModifier, count: number): number {
  const key = getHeldItemKey(template);
  const existing = holder.getHeldItems().find(i => getHeldItemKey(i) === key);
  const max = Math.max(1, (existing ?? template).getMaxHeldItemCount(holder));
  const given = Math.min(count, max - (existing?.stackCount ?? 0));
  if (given <= 0) {
    return 0;
  }
  if (existing) {
    existing.stackCount += given;
    return given;
  }
  const item = template.clone() as PokemonHeldItemModifier;
  item.pokemonId = holder.id;
  item.stackCount = given;
  if (holder.isPlayer()) {
    globalScene.modifiers.push(item);
  } else {
    globalScene.addEnemyModifier(item, true);
  }
  return given;
}

/** Whether `item` is a Choice item (its lock is lifted when it changes hands) */
function isChoiceItem(item: PokemonHeldItemModifier | null | undefined): boolean {
  return item != null && CHOICE_ITEM_TYPE_IDS.has(item.type?.id);
}

/**
 * `user`'s Trick / Switcheroo on `target`: swap the given item (the player's choice or the rule's pick) for a random
 * item of `target`, one unit each way, and write both in the ledger.
 * @returns Whether anything changed hands
 */
export function swapHeldItems(user: Pokemon, target: Pokemon, moveId: MoveId): boolean {
  if (target === user || itemsAreHeldFast(target, false)) {
    return false;
  }
  const give = resolveGiveItem(user, target, moveId, true);
  if (give === null) {
    return false;
  }
  let take = give ? getForcedTake(user, target, give) : undefined;
  if (give && take == null && !canReceiveHeldItem(target, give)) {
    return false;
  }
  if (take == null) {
    const candidates = getTakeCandidates(user, target, give);
    take = candidates.length > 0 ? candidates[user.randBattleSeedInt(candidates.length)] : undefined;
  }
  if (give == null && take == null) {
    return false;
  }

  const giveUnit = give ? copyUnit(give) : undefined;
  const takeUnit = take ? copyUnit(take) : undefined;
  if (give) {
    removeHeldItemUnit(give, user);
  }
  if (take) {
    removeHeldItemUnit(take, target);
  }
  if (giveUnit) {
    addHeldItemUnits(target, giveUnit, 1);
    recordHeldItemMoveChange(user, giveUnit, -1);
    recordHeldItemMoveChange(target, giveUnit, 1);
  }
  if (takeUnit) {
    addHeldItemUnits(user, takeUnit, 1);
    recordHeldItemMoveChange(target, takeUnit, -1);
    recordHeldItemMoveChange(user, takeUnit, 1);
  }
  // Giving or receiving a Choice item lifts the Choice lock of both (the next move locks anew, as in the main series)
  if (isChoiceItem(give) || isChoiceItem(take)) {
    user.removeTag(BattlerTagType.CHOICE_LOCK);
    target.removeTag(BattlerTagType.CHOICE_LOCK);
  }

  globalScene.phaseManager.queueMessage(
    i18next.t("moveTriggers:switchedItems", { pokemonName: getPokemonNameWithAffix(user) }),
  );
  if (takeUnit) {
    globalScene.phaseManager.queueMessage(
      i18next.t("moveTriggers:obtainedItem", {
        pokemonName: getPokemonNameWithAffix(user),
        itemName: takeUnit.type.name,
      }),
    );
  }
  if (giveUnit) {
    globalScene.phaseManager.queueMessage(
      i18next.t("moveTriggers:obtainedItem", {
        pokemonName: getPokemonNameWithAffix(target),
        itemName: giveUnit.type.name,
      }),
    );
  }
  // Unburden and the like: only for a Pokémon that gave without getting anything back, as in the main series
  if (give && !take) {
    applyAbAttrs("PostItemLostAbAttr", { pokemon: user });
  }
  if (take && !give) {
    applyAbAttrs("PostItemLostAbAttr", { pokemon: target });
  }
  globalScene.updateModifiers(true);
  globalScene.updateModifiers(false);
  return true;
}

/**
 * The AI's view of `user`'s Trick / Switcheroo on `target`: 10 when it would give a harmful item, 4 when it would only
 * take one, -5 when it would only give away a harmless item of its own
 */
export function getSwapUserBenefitScore(user: Pokemon, target: Pokemon, moveId: MoveId): number {
  if (!canSwapHeldItems(user, target, moveId)) {
    return 0;
  }
  const give = resolveGiveItem(user, target, moveId, false);
  if (give && isHarmfulGift(give, target)) {
    return 10;
  }
  return getTakeCandidates(user, target, give).length > 0 ? 4 : -5;
}

// #endregion

// #region Revert after battle

/** One Pokémon's net change of one item kind made by these moves in the current battle */
interface LedgerEntry {
  readonly pokemonId: number;
  /** A one-unit copy of the item, to give it back as it was */
  readonly item: PokemonHeldItemModifier;
  /** Units received (positive) or given away / thrown (negative) */
  delta: number;
}

let ledger: { battle: Battle | null; entries: Map<string, LedgerEntry> } | undefined;

/** The ledger of the current battle (a ledger left from an earlier battle is settled first) */
function getLedger(): Map<string, LedgerEntry> {
  const battle = globalScene.currentBattle ?? null;
  if (ledger && ledger.battle !== battle) {
    revertHeldItemMoveChanges();
  }
  ledger ??= { battle, entries: new Map() };
  return ledger.entries;
}

/** Write that `pokemon` received (`delta` > 0) or gave away / threw (`delta` < 0) units like `unit` */
export function recordHeldItemMoveChange(pokemon: Pokemon, unit: PokemonHeldItemModifier, delta: number): void {
  const entries = getLedger();
  const key = `${pokemon.id}|${getHeldItemKey(unit)}`;
  const entry = entries.get(key);
  if (entry) {
    entry.delta += delta;
  } else {
    entries.set(key, { pokemonId: pokemon.id, item: copyUnit(unit), delta });
  }
}

/**
 * Local fork (2026-11-20 night): whether the transfer under way is a foe's Thief / Covet on a player's Pokémon
 * ({@linkcode transferStolenHeldItem}); {@linkcode followHeldItemMoveClaim} then writes the stolen units in the ledger
 */
let stealingFromPlayer = false;

/**
 * Local fork (2026-11-20 night): Thief (도둑질) / Covet (탐내기) by `thief` take one unit of `item` from `victim`
 * through the usual transfer (`BattleScene.tryTransferHeldItemModifier`). The user: "도둑질도 되돌림": when an enemy
 * steals from a player's Pokémon, the stolen unit is written in the ledger like a Trick, so it goes back to that
 * Pokémon when the battle ends (the edge cases are Trick's). The player's own Thief / Covet on an enemy stays a lasting
 * steal (the user only asked about items stolen from the player).
 * @returns Whether the transfer took place
 */
export function transferStolenHeldItem(thief: Pokemon, victim: Pokemon, item: PokemonHeldItemModifier): boolean {
  stealingFromPlayer = victim.isPlayer() && !thief.isPlayer();
  try {
    return globalScene.tryTransferHeldItemModifier(item, thief, false);
  } finally {
    stealingFromPlayer = false;
  }
}

/**
 * Another item move (Thief, Covet, Pickpocket, Magician, Grip Claw, Mini Black Hole) moved `count` units of `item` from
 * `source` to `target`: units `source` holds on loan from these moves go first, and the loan follows them to `target`
 * (called from `BattleScene.tryTransferHeldItemModifier`). Local fork (2026-11-20 night): in a foe's Thief / Covet on
 * a player's Pokémon ({@linkcode transferStolenHeldItem}), the units beyond the loan are written as a Trick's are
 * (the user: "도둑질도 되돌림"); Pickpocket, Magician, Grip Claw and Mini Black Hole stay as they were.
 */
export function followHeldItemMoveClaim(
  source: Pokemon | null | undefined,
  target: Pokemon,
  item: PokemonHeldItemModifier,
  count: number,
): void {
  if (source == null || count <= 0) {
    return;
  }
  let rest = count;
  const entry =
    ledger != null && ledger.battle === (globalScene.currentBattle ?? null)
      ? ledger.entries.get(`${source.id}|${getHeldItemKey(item)}`)
      : undefined;
  if (entry != null && entry.delta > 0) {
    const moved = Math.min(entry.delta, count);
    entry.delta -= moved;
    recordHeldItemMoveChange(target, entry.item, moved);
    rest -= moved;
  }
  if (stealingFromPlayer && rest > 0) {
    recordHeldItemMoveChange(source, item, -rest);
    recordHeldItemMoveChange(target, item, rest);
  }
}

/**
 * Local fork (2026-11-20), review fix: forget the ledger without settling it. Called when the scene resets and when a
 * session loads (Save & Quit mid-battle, back to the title, a retry): the loaded party holds its items as the session
 * saved them at the wave's start, so settling the old battle's ledger on it would give a lent item back a second time
 * (Leftovers lent by Trick, then Save & Quit and Continue: two Leftovers after the battle).
 */
export function discardHeldItemMoveLedger(): void {
  ledger = undefined;
}

/** The ledger's entries with a change, for tests and the Dev Bridge */
export function getHeldItemMoveLedger(): { pokemonId: number; key: string; delta: number }[] {
  if (ledger == null) {
    return [];
  }
  return [...ledger.entries.values()]
    .filter(e => e.delta !== 0)
    .map(e => ({ pokemonId: e.pokemonId, key: getHeldItemKey(e.item), delta: e.delta }));
}

/**
 * Settle the battle's ledger ("도구 변경은 전투 후 되돌아옴"): for each Pokémon now in the player's party, take back
 * the units it received (as many as it still holds) and give back the units it gave away or threw (up to the item's
 * stack cap; units over the cap are lost). Pokémon no longer in the party (enemies, a released one) are skipped.
 * Called when the battle ends (`BattleEndPhase`) and when the run ends (`GameOverPhase`); does nothing twice.
 * @returns Whether a held item of the party changed
 */
export function revertHeldItemMoveChanges(): boolean {
  const settling = ledger;
  ledger = undefined;
  if (settling == null || globalScene == null) {
    return false;
  }
  const party = globalScene.getPlayerParty();
  const entries = [...settling.entries.values()].filter(e => e.delta !== 0);
  let changed = false;
  for (const entry of entries.filter(e => e.delta > 0)) {
    const holder = party.find(p => p.id === entry.pokemonId);
    if (holder == null) {
      continue;
    }
    const key = getHeldItemKey(entry.item);
    const held = holder.getHeldItems().find(i => getHeldItemKey(i) === key);
    const count = Math.min(entry.delta, held?.stackCount ?? 0);
    for (let i = 0; i < count; i++) {
      removeHeldItemUnit(held!, holder);
      changed = true;
    }
  }
  for (const entry of entries.filter(e => e.delta < 0)) {
    const holder = party.find(p => p.id === entry.pokemonId);
    if (holder == null) {
      continue;
    }
    const given = addHeldItemUnits(holder, entry.item, -entry.delta);
    if (given < -entry.delta) {
      console.warn(`Held-item moves: ${-entry.delta - given} ${getHeldItemKey(entry.item)} over the cap were lost`);
    }
    changed ||= given > 0;
  }
  if (changed) {
    globalScene.updateModifiers(true);
  }
  return changed;
}

// #endregion
