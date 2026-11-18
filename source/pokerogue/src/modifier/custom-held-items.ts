/**
 * Held items added by this local fork (2026-11-02).
 *
 * They live outside `modifier.ts` so that file stays close to upstream. Session saves look modifier
 * classes up by name in the `modifier.ts` module namespace, so `ModifierData.toModifier` falls back to
 * {@linkcode getCustomModifierClass} for the classes defined here.
 */

import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry"; // Local fork (2026-11-09): Evolution Crystals
import { getPokemonNameWithAffix } from "#app/messages";
import { playerHeldItemCap } from "#balance/endless-balance";
// Local fork (2026-11-10): Flame Furnace / Toxic Distillate types; allMoves for the vests' move restriction
import { allMoves, modifierTypes } from "#data/data-lists";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category"; // Local fork (2026-11-10): vests
import { MoveId } from "#enums/move-id"; // Local fork (2026-11-10): vests; 2026-11-16 a value (Z다이검무)
import { MoveTarget } from "#enums/move-target"; // Local fork (2026-11-10): vests
import { PokemonType } from "#enums/pokemon-type"; // Local fork (2026-11-09): Radioactive Waste
import { SpeciesId } from "#enums/species-id"; // Local fork (2026-11-09): Ultimate Gene
import type { EffectiveStat, PermanentStat } from "#enums/stat";
import { EFFECTIVE_STATS, getStatKey, Stat } from "#enums/stat"; // Local fork (2026-11-11): EFFECTIVE_STATS for Booster Energy
import { StatusEffect } from "#enums/status-effect"; // Local fork (2026-11-09): Flame Cauldron
import { Unlockables } from "#enums/unlockables"; // Local fork (2026-11-10): Evolution Crystals' gate
import type { Pokemon } from "#field/pokemon";
// Local fork (2026-11-11): Power Herb, Metronome, Loaded Dice, Seed Pouch, Fuel, Expert Belt, Precision Lens
import {
  BATTLE_HELD_ITEMS,
  type BattleHeldItem,
  type BattleItemKind,
  getBattleItemRow,
  getBoosterEnergyTenths, // Local fork (2026-11-11): Booster Energy
  getFuelTenths,
  getHighestStat, // Local fork (2026-11-11): Booster Energy
  isFuelBurner,
} from "#modifiers/battle-held-items";
// Local fork (2026-11-11): Punching Glove / Master Punching Glove numbers and marker
import { CONTACT_GLOVES, type ContactGloveItem, type ContactGloveKind } from "#modifiers/contact-gloves";
// Local fork (2026-11-12): EVs and the EV items
import { addEvs, EV_RULES, type EvItemId } from "#modifiers/ev-items";
import type { Modifier } from "#modifiers/modifier";
// Local fork (2026-11-09): TurnStatusEffectModifier for the Flame Cauldron swallowing a Flame Orb
// Local fork (2026-11-11): PersistentModifier as a value, the base of the luck clovers
import {
  PersistentModifier,
  PokemonHeldItemModifier,
  SpeciesStatBoosterModifier, // Local fork (2026-11-10): the Light Ball, for the Discharged Coil
  StatBoosterModifier,
  TurnStatusEffectModifier,
} from "#modifiers/modifier";
import type { ModifierType } from "#modifiers/modifier-type";
// Local fork (2026-11-16): the Z-Ring (Z링), saved with the session like the classes here
import { ZRingModifier } from "#modifiers/zmax-items";
import type { Move } from "#moves/move"; // Local fork (2026-11-10): vests
import type { PokemonMove } from "#moves/pokemon-move"; // Local fork (2026-11-16): vests judge a converted slot
import { getZStatusEffect } from "#moves/zmax-data"; // Local fork (2026-11-16): vests and the Z-Power stat boosts
import { BooleanHolder, NumberHolder, toDmgValue } from "#utils/common"; // Local fork (2026-11-11): NumberHolder as a value
import i18next from "i18next";

/** Vests: stat added per vest, added up (1 = x1.5, 2 = x2, 3 = x2.5); the user's request, 2026-11-05 */
export const VEST_BOOST_PER_STACK = 0.5;

/**
 * Assault Vest (돌격조끼): the holder's Sp. Def gets +50% per vest, added up (x1.5 / x2 / x2.5). Unlike the
 * main-series item it does not restrict the holder's moves, except (Local fork (2026-11-10)) stat-raising status moves,
 * like the Bulletproof Vest ({@linkcode getVestMoveDeniedText}). Up to 3 on the player's Pokémon, transferable.
 * Other stat items (Eviolite...) still multiply with it.
 */
export class AssaultVestModifier extends StatBoosterModifier {
  constructor(type: ModifierType, pokemonId: number, stackCount?: number) {
    super(type, pokemonId, [Stat.SPDEF], 1 + VEST_BOOST_PER_STACK, stackCount);
  }

  override apply(_pokemon: Pokemon, _stat: Stat, statValue: NumberHolder): boolean {
    statValue.value *= 1 + VEST_BOOST_PER_STACK * this.getStackCount();
    return true;
  }

  override matchType(modifier: Modifier): boolean {
    return modifier instanceof AssaultVestModifier;
  }

  override clone(): AssaultVestModifier {
    return new AssaultVestModifier(this.type, this.pokemonId, this.stackCount);
  }

  /** Only the holder's id is saved; the stat and multiplier are fixed by the class (see the constructor). */
  override getArgs(): any[] {
    return [this.pokemonId];
  }

  override getMaxHeldItemCount(pokemon?: Pokemon): number {
    return playerHeldItemCap(pokemon, 1, "ASSAULT_VEST");
  }
}

/**
 * Bulletproof Vest (방탄조끼): the holder's Defense gets +50% per vest, added up (x1.5 / x2 / x2.5).
 * Up to 3 on the player's Pokémon, transferable. Local fork (2026-11-10): its holder cannot use stat-raising status
 * moves, like the Assault Vest's ({@linkcode getVestMoveDeniedText}).
 */
export class BulletproofVestModifier extends StatBoosterModifier {
  constructor(type: ModifierType, pokemonId: number, stackCount?: number) {
    super(type, pokemonId, [Stat.DEF], 1 + VEST_BOOST_PER_STACK, stackCount);
  }

  override apply(_pokemon: Pokemon, _stat: Stat, statValue: NumberHolder): boolean {
    statValue.value *= 1 + VEST_BOOST_PER_STACK * this.getStackCount();
    return true;
  }

  override matchType(modifier: Modifier): boolean {
    return modifier instanceof BulletproofVestModifier;
  }

  override clone(): BulletproofVestModifier {
    return new BulletproofVestModifier(this.type, this.pokemonId, this.stackCount);
  }

  /** Only the holder's id is saved; the stat and multiplier are fixed by the class (see the constructor). */
  override getArgs(): any[] {
    return [this.pokemonId];
  }

  override getMaxHeldItemCount(pokemon?: Pokemon): number {
    return playerHeldItemCap(pokemon, 1, "BULLETPROOF_VEST");
  }
}

/**
 * Local fork (2026-11-10): the move targets that aim a stat raise without `selfTarget` at the user's own side: the user,
 * its allies (Howl, Coaching, Aromatic Mist, Gear Up, Magnetic Flux) or everyone (Flower Shield, Rototiller, which raise
 * the Grass types of both sides). One aimed at another Pokémon (Swagger, Flatter, Spicy Extract) is not counted, unless
 * the move aims at an ally by default (Decorate).
 */
const USER_SIDE_RAISE_TARGETS: ReadonlySet<MoveTarget> = new Set([
  MoveTarget.USER,
  MoveTarget.NEAR_ALLY,
  MoveTarget.ALLY,
  MoveTarget.USER_OR_NEAR_ALLY,
  MoveTarget.USER_AND_ALLIES,
  MoveTarget.USER_SIDE,
  MoveTarget.ALL,
]);

/**
 * Local fork (2026-11-10): whether `move` is a stat-raising ("랭크업") move for the vests' restriction: a status move that
 * raises a stat stage of its user or of the user's side.
 * - Any {@linkcode StatStageChangeAttr} (subclasses too: Growth, Belly Drum / Fillet Away / Clangorous Soul's HP cut)
 *   with a positive change, self-targeted or aimed at the user's side ({@linkcode USER_SIDE_RAISE_TARGETS}); Shell Smash
 *   counts though it also lowers stats.
 * - Acupressure, Stockpile (its tag raises Defense and Sp. Def), and Curse unless the user is a Ghost type (then it
 *   curses the target and raises nothing, as `CurseAttr` decides).
 * Damaging moves with a self-boost (Flame Charge, Power-Up Punch, Meteor Mash) are never counted, nor are moves that
 * copy, swap or invert stat stages (Psych Up, Heart Swap, Power / Guard / Speed Swap, Topsy-Turvy) or raise the
 * critical-hit ratio (Focus Energy, Dragon Cheer, Laser Focus).
 * @param move - The move
 * @param user - Who uses it (only Curse depends on it)
 */
export function isStatRaisingMove(move: Move, user: Pokemon): boolean {
  if (move.category !== MoveCategory.STATUS) {
    return false;
  }
  if (move.hasAttr("AcupressureStatStageChangeAttr")) {
    return true;
  }
  if (move.hasAttr("CurseAttr")) {
    return !user.isOfType(PokemonType.GHOST, { returnOriginalTypesIfStellar: true });
  }
  if (move.getAttrs("AddBattlerTagAttr").some(attr => attr.tagType === BattlerTagType.STOCKPILING)) {
    return true;
  }
  const userSide = USER_SIDE_RAISE_TARGETS.has(move.moveTarget) || move.allyTargetDefault;
  return move.getAttrs("StatStageChangeAttr").some(attr => attr.stages > 0 && (attr.selfTarget || userSide));
}

/**
 * Local fork (2026-11-16): whether the vests keep `pokemon` from using `moveId` (see {@linkcode getVestMoveDeniedText}).
 * A converted slot is judged by its converted move (`PokemonMove.getMove()`): plain 다이월 (any status move given a
 * Dynamax Candy) raises nothing, 다이검무 / Z다이검무 raise Attack. A Z-Move made from a status move (Z칼춤, Z다이월) also
 * counts when its Z-Power raises a stat stage of the user ({@linkcode zPowerRaisesStat}): it is a stat-raising use all
 * the same, so a vest holder cannot get +3 Attack from Z튀어오르기.
 * @param pokemon - The would-be user
 * @param moveId - The move's own (base) id, as move history and the fight menu use it
 * @param pokemonMove - The move slot actually used, if the caller has it; else `pokemon`'s slot of `moveId`, if any
 */
export function isVestRestrictedMove(pokemon: Pokemon, moveId: MoveId, pokemonMove?: PokemonMove): boolean {
  const slot = pokemonMove ?? pokemon.getMoveset().find(m => m?.moveId === moveId);
  if (!slot?.transform) {
    return isStatRaisingMove(allMoves[moveId], pokemon);
  }
  return isStatRaisingMove(slot.getMove(), pokemon) || zPowerRaisesStat(slot, pokemon);
}

/**
 * Local fork (2026-11-16): whether the Z-Power of converted slot `slot` raises a stat stage of `user`: a Z-Move made
 * from a status move (kind `z`, Z칼춤) or a Z다이월 (kind `zMax` into Max Guard) whose Showdown Z effect is a positive
 * boost, or Curse's (Attack +1 unless the user is a Ghost type). Z다이검무 gets no other bonus (its +4 is its own effect).
 * Critical-hit, heal and redirect effects raise nothing, like Focus Energy for the vests.
 */
function zPowerRaisesStat(slot: PokemonMove, user: Pokemon): boolean {
  const transform = slot.transform;
  if (
    !transform
    || (transform.kind !== "z" && transform.kind !== "zMax")
    || transform.moveId === MoveId.MAX_SWORDS_DANCE
    || allMoves[slot.moveId]?.category !== MoveCategory.STATUS
  ) {
    return false;
  }
  const effect = getZStatusEffect(slot.moveId);
  if (!effect) {
    return false;
  }
  if ("boost" in effect) {
    return Object.values(effect.boost).some(stages => (stages ?? 0) > 0);
  }
  return effect.effect === "curse" && !user.isOfType(PokemonType.GHOST, { returnOriginalTypesIfStellar: true });
}

/**
 * Local fork (2026-11-10): the Assault Vest (돌격조끼) or Bulletproof Vest (방탄조끼) that keeps `pokemon` from stat-raising
 * moves, if it holds one (the user: "돌격조끼와 방탄조끼에 랭크업 기술 사용 불가를 넣어둡시다"). Player and enemy holders.
 */
export function getStatRaiseBlockingVest(pokemon: Pokemon): PokemonHeldItemModifier | undefined {
  return pokemon.getHeldItems().find(m => m instanceof AssaultVestModifier || m instanceof BulletproofVestModifier);
}

/**
 * Local fork (2026-11-10): the text shown when a vest holder tries to select (or ends up using) a stat-raising move
 * ({@linkcode isStatRaisingMove}), or `undefined` when the move is not restricted. `Pokemon.isMoveSelectable` asks it,
 * which covers the fight menu, the AI's choice and Struggle when nothing is selectable; `MovePhase` asks it too, so a
 * move used anyway (Encore, Instruct, Dancer, a called move) fails with this text, like Taunt's.
 *
 * Local fork (2026-11-16): a converted move slot (다이사탕 / Z크리스탈, `PokemonMove.transform`) is judged by the move it
 * became ({@linkcode isVestRestrictedMove}): 다이월 made from 명상 is not a stat-raising move, 다이검무 is.
 * @param pokemon - The would-be user
 * @param moveId - The move
 * @param pokemonMove - (optional, Local fork 2026-11-16) The move slot actually used, when the caller has it (a called
 *   move is a plain one even if `pokemon` has a converted slot of the same move); without it the slot of `moveId` in
 *   `pokemon`'s moveset is judged
 */
export function getVestMoveDeniedText(pokemon: Pokemon, moveId: MoveId, pokemonMove?: PokemonMove): string | undefined {
  const vest = getStatRaiseBlockingVest(pokemon);
  if (!vest || !isVestRestrictedMove(pokemon, moveId, pokemonMove)) {
    return undefined;
  }
  return i18next.t("battle:vestNoStatRaiseMove", {
    pokemonNameWithAffix: getPokemonNameWithAffix(pokemon),
    itemName: vest.type.name,
  });
}

/** Local fork (2026-11-09): the stat multiplier of Choice Band / Choice Scarf / Choice Specs */
export const CHOICE_ITEM_MULTIPLIER = 1.5;

/** Local fork (2026-11-09): the stat each of Choice Band / Choice Scarf / Choice Specs raises, by modifier type id */
export const CHOICE_ITEM_STATS = Object.freeze({
  CHOICE_BAND: Stat.ATK,
  CHOICE_SCARF: Stat.SPD,
  CHOICE_SPECS: Stat.SPATK,
} as const satisfies Record<string, EffectiveStat>);

/** Local fork (2026-11-09): the stats Choice Armor (구애갑옷) raises (the user: "방/특방 1.3배") */
export const CHOICE_ARMOR_STATS: readonly EffectiveStat[] = Object.freeze([Stat.DEF, Stat.SPDEF]);
/** Local fork (2026-11-09): the multiplier of Choice Armor's stats */
export const CHOICE_ARMOR_MULTIPLIER = 1.3;

/**
 * Local fork (2026-11-09): Choice Band / Choice Scarf / Choice Specs (구애머리띠 / 구애스카프 / 구애안경), MASTER tier
 * (the user: "마스터 등급 아이템들에 구애머리띠 / 스카프 / 안경 넣어두죠"), and the base of Choice Armor
 * ({@linkcode ChoiceArmorModifier}, 구애갑옷).
 * - While held, the holder's Attack / Speed / Sp. Atk is x1.5: an effective-stat multiplier like the vests
 *   (`Pokemon.getEffectiveStat`), so the summary shows the raised stat in green. The stat itself is never rewritten.
 * - After the holder executes a move it selected, it can only select that move until it leaves the field or the
 *   battle ends: `ChoiceLockTag` (battler-tags.ts), added by {@linkcode applyChoiceLock}.
 * One of each per Pokémon in every mode (player and enemy), transferable and stealable like the vests. One holder
 * can carry more than one kind; they share a single lock.
 * Local fork (2026-11-09): generalised for Choice Armor, which raises two stats with its own multiplier. Every instance
 * of this class (subclasses too) is a Choice item for the lock (`applyChoiceLock`; `ChoiceLockTag` goes by the type ids
 * in `CHOICE_ITEM_TYPE_IDS`).
 */
export class ChoiceItemModifier extends StatBoosterModifier {
  /**
   * @param type - The modifier type
   * @param pokemonId - The holder's id
   * @param stats - The stat a Band / Scarf / Specs raises, or the stats of a subclass's item (Choice Armor)
   * @param stackCount - Always 1 (one per Pokémon)
   * @param multiplier - Defaults to {@linkcode CHOICE_ITEM_MULTIPLIER}. A Band / Scarf / Specs saves only its stat
   *   (see {@linkcode getArgs}), so an item with several stats or another multiplier must be a subclass that saves its
   *   own args, as {@linkcode ChoiceArmorModifier} does
   */
  constructor(
    type: ModifierType,
    pokemonId: number,
    stats: EffectiveStat | readonly EffectiveStat[],
    stackCount?: number,
    multiplier: number = CHOICE_ITEM_MULTIPLIER,
  ) {
    super(type, pokemonId, typeof stats === "number" ? [stats] : [...stats], multiplier, stackCount);
  }

  /** The stats this item raises */
  getStats(): readonly EffectiveStat[] {
    return this.stats as EffectiveStat[];
  }

  /** The multiplier applied to each of {@linkcode getStats} */
  getMultiplier(): number {
    return this.multiplier;
  }

  /**
   * A Choice Band only stacks with (and is capped against) another Choice Band, and so on: same stats, same multiplier
   * (Local fork (2026-11-09): the list rather than a single stat, so Choice Armor never matches a Band / Scarf / Specs)
   */
  override matchType(modifier: Modifier): boolean {
    return modifier instanceof ChoiceItemModifier && super.matchType(modifier);
  }

  override clone(): ChoiceItemModifier {
    return new ChoiceItemModifier(this.type, this.pokemonId, this.getStats(), this.stackCount, this.multiplier);
  }

  /**
   * The holder's id and the stat, the format saves have had since the Band / Scarf / Specs were added; the multiplier
   * is fixed ({@linkcode CHOICE_ITEM_MULTIPLIER}). Subclasses save their own args.
   */
  override getArgs(): any[] {
    return [this.pokemonId, this.stats[0]];
  }

  override getMaxHeldItemCount(_pokemon?: Pokemon): number {
    return 1;
  }
}

/**
 * Local fork (2026-11-09): Choice Armor (구애갑옷), MASTER tier, the user's request ("구애갑옷 아이템을 추가해보죠 ...
 * 기술 고정, 그대신 방/특방 1.3배, 개수 제한 1개, 등급 당연히 마스터").
 * - While held, the holder's Defense and Sp. Def are x1.3 each ({@linkcode CHOICE_ARMOR_STATS},
 *   {@linkcode CHOICE_ARMOR_MULTIPLIER}), as effective-stat multipliers like the other Choice items.
 * - The same move lock as the other Choice items (it is a {@linkcode ChoiceItemModifier}); held with one of them,
 *   every boost applies and there is still a single lock.
 * One per Pokémon, transferable and stealable. Saves keep only the holder's id, like the vests: the stats and the
 * multiplier come from the class, so a later balance change reaches saved armours too.
 */
export class ChoiceArmorModifier extends ChoiceItemModifier {
  constructor(type: ModifierType, pokemonId: number, stackCount?: number) {
    super(type, pokemonId, CHOICE_ARMOR_STATS, stackCount, CHOICE_ARMOR_MULTIPLIER);
  }

  /** Choice Armor only stacks with (and is capped against) another Choice Armor */
  override matchType(modifier: Modifier): boolean {
    return modifier instanceof ChoiceArmorModifier;
  }

  override clone(): ChoiceArmorModifier {
    return new ChoiceArmorModifier(this.type, this.pokemonId, this.stackCount);
  }

  /** Only the holder's id is saved; the stats and multiplier are fixed by the class (see the constructor) */
  override getArgs(): any[] {
    return [this.pokemonId];
  }
}

/**
 * Local fork (2026-11-09): called by `MoveEffectPhase` right after Gorilla Tactics, when `pokemon` has executed a move
 * it selected (not one called by another move, reflected or copied): a Choice item locks it into that move, unless a
 * Choice lock is already on. With Gorilla Tactics too, both locks name the same move.
 * Local fork (2026-11-09, review fix): a lock that is no longer in force (`ChoiceLockTag.isInForce`: the locked move was
 * replaced mid-turn) is replaced rather than kept until the end of the turn.
 * Local fork (2026-11-09): Choice Armor ({@linkcode ChoiceArmorModifier}) is a `ChoiceItemModifier` too, so it locks
 * the same way.
 * @param pokemon - The Pokémon that just executed a move
 */
export function applyChoiceLock(pokemon: Pokemon): void {
  if (!pokemon.getHeldItems().some(m => m instanceof ChoiceItemModifier)) {
    return;
  }
  const lock = pokemon.getTag(BattlerTagType.CHOICE_LOCK);
  if (lock && !lock.isInForce(pokemon)) {
    pokemon.removeTag(BattlerTagType.CHOICE_LOCK);
  }
  if (!pokemon.getTag(BattlerTagType.CHOICE_LOCK)) {
    pokemon.addTag(BattlerTagType.CHOICE_LOCK);
  }
}

/** Life Orb: damage added per orb (1 = x1.3, 2 = x1.6, 3 = x1.9) */
export const LIFE_ORB_DAMAGE_PER_STACK = 0.3;
/** Life Orb: share of max HP lost at the end of an attacking turn, for 1, 2 and 3 orbs */
export const LIFE_ORB_HP_LOSS: readonly number[] = [0.1, 0.15, 0.2];
/**
 * Local fork (2026-11-13): the HP the Life Orb's turn-end cost always leaves its holder (08 명세 2번: "생명의구슬 반동
 * 대미지 HP 1 하한 보장"; a Focus Band / Sturdy survivor at 1 HP used to faint to it before Leftovers, and an indirect
 * faint never triggers the Reviver Seed)
 */
export const LIFE_ORB_MIN_HP_LEFT = 1;

/**
 * Life Orb (생명의구슬), the user's version (2026-11-05):
 * - the holder's attacks deal 30% more damage per orb, added up rather than multiplied
 *   (1 = x1.3, 2 = x1.6, 3 = x1.9), see {@linkcode applyLifeOrbDamage};
 * - at the end of a turn in which it used an attacking move (`PokemonTurnData.usedAttackMove`, set when the
 *   move is executed, hit or miss), it loses 10/15/20% of its max HP for 1/2/3 orbs. Turns without an
 *   attacking move cost nothing. Magic Guard blocks the loss like other indirect damage. Local fork (2026-11-13): the
 *   loss never takes the holder below 1 HP ({@linkcode LIFE_ORB_MIN_HP_LEFT}, 08 명세 2번).
 * Up to 3 per Pokémon, transferable.
 */
export class LifeOrbModifier extends PokemonHeldItemModifier {
  override matchType(modifier: Modifier): boolean {
    return modifier instanceof LifeOrbModifier;
  }

  override clone(): LifeOrbModifier {
    return new LifeOrbModifier(this.type, this.pokemonId, this.stackCount);
  }

  /** The multiplier for the holder's attack damage */
  getDamageMultiplier(): number {
    return 1 + LIFE_ORB_DAMAGE_PER_STACK * this.getStackCount();
  }

  /** The share of max HP lost at the end of a turn in which the holder attacked */
  getHpLossRatio(): number {
    const stacks = Math.min(Math.max(this.getStackCount(), 1), LIFE_ORB_HP_LOSS.length);
    return LIFE_ORB_HP_LOSS[stacks - 1];
  }

  /**
   * Turn end (`TurnEndPhase`): the holder loses HP if it used an attacking move this turn.
   * @param pokemon - The holder
   * @returns Whether HP was lost
   */
  override apply(pokemon: Pokemon): boolean {
    if (!pokemon.turnData.usedAttackMove || pokemon.isFainted()) {
      return false;
    }
    const cancelled = new BooleanHolder(false);
    applyAbAttrs("BlockNonDirectDamageAbAttr", { pokemon, cancelled });
    if (cancelled.value) {
      return false;
    }
    // Local fork (2026-11-13): 08 명세 2번, for the player's and the enemy's holders alike: the cost is cut so the holder
    // keeps at least LIFE_ORB_MIN_HP_LEFT HP, and a holder already at 1 HP pays nothing (no message either)
    const hpLoss = Math.min(toDmgValue(pokemon.getMaxHp() * this.getHpLossRatio()), pokemon.hp - LIFE_ORB_MIN_HP_LEFT);
    if (hpLoss <= 0) {
      return false;
    }
    pokemon.damageAndUpdate(hpLoss, { result: HitResult.INDIRECT });
    globalScene.phaseManager.queueMessage(
      i18next.t("modifier:lifeOrbApply", {
        pokemonNameWithAffix: getPokemonNameWithAffix(pokemon),
        typeName: this.type.name,
      }),
    );
    return true;
  }

  override getMaxHeldItemCount(_pokemon?: Pokemon): number {
    return LIFE_ORB_HP_LOSS.length;
  }
}

/**
 * Multiply an attack's damage by the attacker's Life Orbs (called from `Pokemon.getAttackDamage`).
 * @param source - The attacker
 * @param damage - The damage so far, changed in place
 */
export function applyLifeOrbDamage(source: Pokemon, damage: NumberHolder): void {
  const orb = source.getHeldItems().find(m => m instanceof LifeOrbModifier);
  if (orb) {
    damage.value = toDmgValue(damage.value * orb.getDamageMultiplier());
  }
}

/**
 * Prism: share of a single-target hit's damage that also lands on the target's partner, by the number of Prisms
 * held: 50/75/100% for 1/2/3 (the user, 2026-11-05 night; one Prism used to be the limit)
 */
export const PRISM_SPLASH_RATIOS = [0.5, 0.75, 1] as const;
/** One Prism's share */
export const PRISM_SPLASH_RATIO = PRISM_SPLASH_RATIOS[0];

/**
 * Prism (프리즘), MASTER tier (the user's design, 2026-11-05): every hit of the holder's single-target attacks
 * also deals a share of its damage to the target's partner on the field, so it only matters in double battles:
 * 50/75/100% with 1/2/3 Prisms ({@linkcode PRISM_SPLASH_RATIOS}). Spread moves are not affected. With one Prism
 * and 3 Multi Lenses (the player's cap since 10 명세 1번, 2026-11-13) the target takes 75/25/25/25% and the partner
 * 37.5/12.5/12.5/12.5%. The splash is a
 * flat share of the hit (no type matchup); Protect, semi-invulnerability (Fly, Dig...) and a Substitute keep the
 * partner out of it. Applied by `MoveEffectPhase.applyPrismSplash`. Up to 3 on the player's Pokémon (1 on an
 * enemy's, like the vests), transferable.
 */
export class PrismModifier extends PokemonHeldItemModifier {
  override matchType(modifier: Modifier): boolean {
    return modifier instanceof PrismModifier;
  }

  override clone(): PrismModifier {
    return new PrismModifier(this.type, this.pokemonId, this.stackCount);
  }

  /** The share of each hit's damage that the target's partner takes: 50/75/100% for 1/2/3 Prisms */
  getSplashRatio(): number {
    return PRISM_SPLASH_RATIOS[Math.min(this.getStackCount(), PRISM_SPLASH_RATIOS.length) - 1];
  }

  /** Not used through `applyModifiers`; see `MoveEffectPhase.applyPrismSplash` */
  override apply(_pokemon: Pokemon): boolean {
    return false;
  }

  override getMaxHeldItemCount(pokemon?: Pokemon): number {
    return playerHeldItemCap(pokemon, 1, "PRISM");
  }
}

/**
 * IV Candy: percent added to the stat's multiplier per candy (vitamins: 10). Kept as a whole number so the result
 * is worked out in integers: 90 * 1.3 is 116.999... in floating point.
 */
export const IV_CANDY_PERCENT_PER_STACK = 3;

/**
 * Local fork (2026-11-13): the Health Candy (기력의사탕, HP) adds 6% per candy instead of 3% (the user: "영양제가 hp만
 * 15%, 사탕은 hp만 6%, 노력치 아이템도 hp만 상한을 두배로 올려보죠."): 31 of them x2.86 on top of the vitamins instead
 * of x1.93. The other five candies stay at {@linkcode IV_CANDY_PERCENT_PER_STACK}; the cap (the IV) is unchanged.
 * Since the 3rd balance patch only on the player's side: an enemy's Health Candy is
 * {@linkcode IV_CANDY_PERCENT_PER_STACK} like the others (09 명세 2-2: "적 포켓몬(`!pokemon.isPlayer()`)이 가진
 * `기력의사탕`은 다른 능력치 사탕과 동일하게 `3`"). Setting this to 3 makes the player's 3% again as well
 */
export const IV_CANDY_HP_PERCENT_PER_STACK = 6;

/**
 * Local fork (2026-11-13): percent of `stat`'s base stat one IV Candy adds: 6 for HP on the player's side, 3 for the
 * other stats and for every enemy candy (09 명세 2-2)
 * @param stat - The candy's stat
 * @param isPlayer - Whether the holder is on the player's side; `true` for a text that has no holder
 */
export function getIvCandyPercent(stat: PermanentStat, isPlayer = true): number {
  return stat === Stat.HP && isPlayer ? IV_CANDY_HP_PERCENT_PER_STACK : IV_CANDY_PERCENT_PER_STACK;
}

/**
 * Local fork (2026-11-13), round-3 review: an IV Candy's description with the percent of a holder on the player's side
 * (`isPlayer`, the reward screen's and the party's text) or on the enemy's (the enemy modifier bar's tooltip: an
 * enemy's Health Candy is 3%, 09 명세 2-2)
 */
export function getIvCandyDescription(stat: PermanentStat, isPlayer = true): string {
  return i18next.t("modifierType:ModifierType.IvCandyModifierType.description", {
    stat: i18next.t(getStatKey(stat)),
    percent: getIvCandyPercent(stat, isPlayer),
  });
}

/**
 * IV Candy (개체값사탕), COMMON tier (the user, 2026-11-06): "영양 드링크랑 같은 작용을 하되 개당 3%". Like a vitamin
 * it raises one base stat of its holder, by 3% per candy instead of 10%, and like a vitamin it stacks up to the
 * holder's IV in that stat and cannot be moved. The candies multiply the stat after the vitamins (the user, same
 * night: "사탕의 연산 방식만 곱연산으로"; `Pokemon.calculateBaseStats` applies them right after the vitamins), so
 * 10 vitamins and 10 candies give x2.6 (2.0 x 1.3), each step rounded down. Until then they were added (x2.3).
 * One class per stat key, like the vitamins: a Health Candy never stacks with a Mighty Candy.
 */
export class IvCandyModifier extends PokemonHeldItemModifier {
  public override isTransferable = false;
  protected readonly stat: PermanentStat;

  constructor(type: ModifierType, pokemonId: number, stat: PermanentStat, stackCount?: number) {
    super(type, pokemonId, stackCount);
    this.stat = stat;
  }

  /** The stat these candies raise */
  getStat(): PermanentStat {
    return this.stat;
  }

  override matchType(modifier: Modifier): boolean {
    return modifier instanceof IvCandyModifier && modifier.stat === this.stat;
  }

  override clone(): IvCandyModifier {
    return new IvCandyModifier(this.type, this.pokemonId, this.stat, this.stackCount);
  }

  override getArgs(): any[] {
    return super.getArgs().concat(this.stat);
  }

  override shouldApply(pokemon?: Pokemon, baseStats?: unknown): boolean {
    return super.shouldApply(pokemon, baseStats) && Array.isArray(baseStats);
  }

  /**
   * @param pokemon - The holder
   * @param baseStats - The holder's base stats, vitamins included; changed in place
   * @returns always `true`
   */
  override apply(pokemon: Pokemon, baseStats: number[]): boolean {
    // Local fork (2026-11-13): 6% per Health Candy on a player's Pokémon, 3% for the others (getIvCandyPercent; "사탕은
    // hp만 6%"); an enemy's Health Candy is 3% too since the 09 patch (copy encounters, enemy bundles)
    const percent = getIvCandyPercent(this.stat, pokemon.isPlayer());
    baseStats[this.stat] = Math.floor((baseStats[this.stat] * (100 + percent * this.getStackCount())) / 100);
    return true;
  }

  override getScoreMultiplier(): number {
    return 1.03;
  }

  /**
   * Local fork (2026-11-13), round-3 review: the modifier bar's tooltip with the holder's own percent, so an enemy's
   * Health Candy says 3% (the type's text is the player's 6%)
   */
  override getTooltipDescription(): string {
    return getIvCandyDescription(this.stat, this.getPokemon()?.isPlayer() ?? true);
  }

  /** Same limit as the vitamins: the holder's IV in this stat */
  override getMaxHeldItemCount(pokemon?: Pokemon): number {
    return pokemon?.ivs[this.stat] ?? 0;
  }
}

/**
 * Local fork (2026-11-08, 2026-11-12): Forged Steel's numbers. Since 2026-11-12 a Pokémon of any type can hold up to
 * five (the user: "저희 단조강철의 개수 제한을 5개로 풀고, 강철타입이 아니어도 쓸 수 있게 하는것도 좋을 것 같네요"),
 * and the pieces add up: n pieces multiply by (10 + n) / 10 (x1.1, x1.2, ... x1.5), not 1.1^n. Kept in tenths so the
 * product is a whole number and is rounded down once: 110 * 1.1 is 121.00000000000001 in floating point and
 * 70 * 1.1 is 77.00000000000001, while `110 * 11 / 10` is exactly 121.
 * Since the 3rd balance patch up to ten (09 명세 3-2: "최대 중첩 수(`maxStacks`): 기존 `5` → `10`으로 상향", "`1개
 * ×1.1`, `5개 ×1.5`, `10개 ×2.0`"), the same added-up rule: ten pieces double the three base stats.
 * Local fork (2026-11-13): 10 명세 3번, Tinkaton's Forge forges a Steel type only again and gives two pieces a forge
 * ("1회당 `단조강철 2개` 지급"): 0 -> 2 -> 4 -> 6 -> 8 -> 10, full in five visits.
 * Local fork (2026-11-18): 10 결과 8장 5번, the user: "단조강철을 받는 이벤트에서 강철은 두개, 강철 아닌놈들은 하나이게
 * 하자고 했던 것 같네요". The forge takes any type again: a Steel type still gets two pieces a forge, any other type one
 * (0 -> 1 -> ... -> 10, full in ten visits).
 */
export const FORGED_STEEL = Object.freeze({
  /** Pieces one Pokémon can hold (1 until 2026-11-12, 5 until the 09 patch) */
  maxHeld: 10,
  /**
   * Local fork (2026-11-13): pieces one forge at Tinkaton's Forge gives a Steel type (10 명세 3번: "`FORGED_STEEL.
   * stacksPerForge = 2`"), cut to what still fits under {@linkcode FORGED_STEEL.maxHeld} (nine held: one more); one
   * until this patch
   */
  stacksPerForge: 2,
  /**
   * Local fork (2026-11-18): pieces one forge gives a Pokémon that is not a Steel type (the user: "강철 아닌놈들은
   * 하나"), cut the same way; such a Pokémon couldn't be forged from the 10 명세 until this day
   */
  stacksPerForgeNonSteel: 1,
  /** Tenths each piece adds to the multiplier (1 = +10%) */
  tenthsPerPiece: 1,
  /** The base stats it raises */
  stats: Object.freeze([Stat.HP, Stat.DEF, Stat.SPDEF]) as readonly PermanentStat[],
});

/** Local fork (2026-11-12): the multiplier of `count` pieces of Forged Steel, in tenths (10 + count; 20 = x2.0) */
export function getForgedSteelTenths(count: number): number {
  return 10 + count * FORGED_STEEL.tenthsPerPiece;
}

/**
 * Local fork (2026-11-08): Forged Steel (단조강철), given by Tinkaton's Forge (the user: "선택한 강철타입 포켓몬의
 * 체력, 방어, 특수방어 종족값이 10% 증가한다(즉 계산 맨 처음으로 들어가는 값)"). Multiplies its holder's HP, Defense and
 * Sp. Def base stats as the very first step of `Pokemon.calculateBaseStats`: right after the species' (and a fusion's
 * other species') base stats are read, before Shuckle Juice, Old Gateau, the fusion average, vitamins and IV Candies.
 * Never moved, and the holder keeps it through evolution, form changes and Mega Evolution (it is tied to the
 * Pokémon's id). Local fork (2026-11-12): any type, up to {@linkcode FORGED_STEEL.maxHeld} pieces, +10% per piece
 * added up (x1.1 to x2.0 with ten since the 09 patch, x1.5 with five before), rounded down once; the old one-piece
 * saves load as one piece, x1.1 as before. Local fork (2026-11-13): the forge gives it to a Steel type only again (10
 * 명세 3번), but the item itself works on any holder, so a non-Steel Pokémon forged between 2026-11-12 and this patch
 * keeps its pieces and their boost. Local fork (2026-11-18): the forge gives it to any type again, one piece a forge
 * to a non-Steel Pokémon and two to a Steel type ({@linkcode FORGED_STEEL.stacksPerForgeNonSteel}).
 */
export class ForgedSteelModifier extends PokemonHeldItemModifier {
  public override isTransferable = false;

  override matchType(modifier: Modifier): boolean {
    return modifier instanceof ForgedSteelModifier;
  }

  override clone(): ForgedSteelModifier {
    return new ForgedSteelModifier(this.type, this.pokemonId, this.stackCount);
  }

  override shouldApply(pokemon?: Pokemon, baseStats?: unknown): boolean {
    return super.shouldApply(pokemon, baseStats) && Array.isArray(baseStats);
  }

  /**
   * @param _pokemon - The holder
   * @param baseStats - Base stats of one of the holder's species, nothing else applied yet; changed in place
   * @returns always `true`
   */
  override apply(_pokemon: Pokemon, baseStats: number[]): boolean {
    const tenths = getForgedSteelTenths(this.getStackCount());
    for (const stat of FORGED_STEEL.stats) {
      baseStats[stat] = Math.floor((baseStats[stat] * tenths) / 10);
    }
    return true;
  }

  override getScoreMultiplier(): number {
    return 1.1;
  }

  override getMaxHeldItemCount(_pokemon?: Pokemon): number {
    return FORGED_STEEL.maxHeld;
  }
}

/**
 * Local fork (2026-11-12): every number of the two HP belts, 중량밴드 (Weight Band) and 챔피언벨트 (Champion Belt), in
 * one place. The user, choosing from the bulk-item shortlist: "파워웨이트만 넣죠, 하이퍼(10%), 마스터(45%) 하나씩,
 * 하이퍼는 최대 3개로"; then, sending the art: "여기 파워웨이트랑 챔피언벨트 이미지입니다", and since 파워웨이트 is the
 * mainline HP EV item (Power Weight), the hyper one was renamed: "헬스벨트" and then "이름 중량벤드로 바꿔두죠, hp 아이템 이름을" (written 중량밴드, the usual spelling of 밴드).
 * - `percentPerPiece`: the max HP each piece adds, in whole percent (hundredths of the stat);
 * - `maxHeld`: how many one Pokémon can hold;
 * - `poolWeight`: the weight in the player's reward pool (WEIGHT_BAND in ULTRA = 하이퍼, CHAMPION_BELT in MASTER;
 *   init-modifier-pools.ts), while some party member can still take one.
 * The two add up: three Weight Bands and a Champion Belt make x1.75 (see {@linkcode getHpBeltMaxHp}).
 */
export const HP_BELTS = Object.freeze({
  WEIGHT_BAND: Object.freeze({ percentPerPiece: 10, maxHeld: 3, poolWeight: 4 }),
  CHAMPION_BELT: Object.freeze({ percentPerPiece: 45, maxHeld: 1, poolWeight: 3 }),
});

/** Local fork (2026-11-12): the modifier type ids of the two HP belts */
export type HpBeltId = keyof typeof HP_BELTS;

/**
 * Local fork (2026-11-12): a max HP raised by `percent` percent, rounded down once. Kept in hundredths so the product is
 * a whole number before the one rounding, as {@linkcode FORGED_STEEL} keeps tenths: a decimal multiplier can land just
 * under a whole number in floating point and floor one too low (100 * 1.15 is 114.99999999999999), `x * 115 / 100`
 * cannot. One rounding for both belts together: three Weight Bands on 305 HP give 396 (305 x 1.3 = 396.5), where
 * rounding each +10% down on its own would give 395.
 * @param maxHp - The max HP before the belts (whole number)
 * @param percent - The belts' total, in whole percent ({@linkcode getHpBeltPercent})
 */
export function getHpBeltMaxHp(maxHp: number, percent: number): number {
  return Math.floor((maxHp * (100 + percent)) / 100);
}

/**
 * Local fork (2026-11-12): the base of {@linkcode WeightBandModifier} and {@linkcode ChampionBeltModifier}. Each
 * kind only stacks with (and is capped against) itself, up to its `maxHeld` in {@linkcode HP_BELTS}. Never moved:
 * not transferable, so the party menu cannot hand it on and Pickup, Thief, Covet, Magician, Pickpocket, Grip Claw and
 * the Mini Black Hole all skip it (they only take transferable items), like the vitamins and Forged Steel; moving one
 * back and forth would heal through the max HP it carries. Saves keep only the holder's id.
 */
abstract class HpBeltBaseModifier extends PokemonHeldItemModifier {
  public override isTransferable = false;

  /** Which of the two belts this is */
  abstract get beltId(): HpBeltId;

  override matchType(modifier: Modifier): boolean {
    return modifier instanceof HpBeltBaseModifier && modifier.beltId === this.beltId;
  }

  override getArgs(): any[] {
    return [this.pokemonId];
  }

  override shouldApply(pokemon?: Pokemon, percent?: unknown): boolean {
    return super.shouldApply(pokemon, percent) && percent instanceof NumberHolder;
  }

  /**
   * Adds this stack's percent to `percent` (called by {@linkcode getHpBeltPercent}; the max HP itself is raised
   * once for both belts, in `Pokemon.calculateStats`)
   * @param _pokemon - The holder
   * @param percent - The holder's total so far, in whole percent; changed in place
   * @returns always `true`
   */
  override apply(_pokemon: Pokemon, percent: NumberHolder): boolean {
    percent.value += HP_BELTS[this.beltId].percentPerPiece * this.getStackCount();
    return true;
  }

  override getScoreMultiplier(): number {
    return 1.1;
  }

  override getMaxHeldItemCount(_pokemon?: Pokemon): number {
    return HP_BELTS[this.beltId].maxHeld;
  }
}

/**
 * Local fork (2026-11-12): Weight Band (중량밴드; the user: "이름 중량벤드로 바꿔두죠"), ULTRA (하이퍼) tier, up to 3: max HP +10% per
 * piece, added up
 */
export class WeightBandModifier extends HpBeltBaseModifier {
  override get beltId(): HpBeltId {
    return "WEIGHT_BAND";
  }

  override clone(): WeightBandModifier {
    return new WeightBandModifier(this.type, this.pokemonId, this.stackCount);
  }
}

/**
 * Local fork (2026-11-12): Champion Belt (챔피언벨트; the user: "챔피언벨트 이미지입니다"), MASTER tier, one per
 * Pokémon: max HP +45%, added to the Weight Bands' (x1.75 with three of them)
 */
export class ChampionBeltModifier extends HpBeltBaseModifier {
  override get beltId(): HpBeltId {
    return "CHAMPION_BELT";
  }

  override clone(): ChampionBeltModifier {
    return new ChampionBeltModifier(this.type, this.pokemonId, this.stackCount);
  }
}

/**
 * Local fork (2026-11-12): the max HP percent the belts `pokemon` holds add, both kinds together (0 to 75): 10 per
 * Weight Band, 45 for a Champion Belt
 */
export function getHpBeltPercent(pokemon: Pokemon): number {
  const percent = new NumberHolder(0);
  for (const belt of globalScene.findModifiers(
    m => m instanceof HpBeltBaseModifier && m.shouldApply(pokemon, percent),
    pokemon.isPlayer(),
  )) {
    (belt as HpBeltBaseModifier).apply(pokemon, percent);
  }
  return percent.value;
}

/**
 * Local fork (2026-11-12): the number of `id` belts `pokemon` holds (0 to its `maxHeld` in {@linkcode HP_BELTS})
 */
export function getHpBeltCount(pokemon: Pokemon, id: HpBeltId): number {
  const held = pokemon.getHeldItems().find(m => m instanceof HpBeltBaseModifier && m.beltId === id);
  return held?.getStackCount() ?? 0;
}

/**
 * Local fork (2026-11-12): `pokemon`'s max HP with its belts: the HP stat after every other HP modifier (the Macho
 * Brace's included) times (1 + 0.10 x Weight Bands + 0.45 x Champion Belt), rounded down once. Called at the end
 * of the HP branch of `Pokemon.calculateStats`, before Wonder Guard sets the HP to 1.
 * @param pokemon - The Pokémon whose stats are being calculated
 * @param maxHp - Its max HP so far
 */
export function applyHpBelts(pokemon: Pokemon, maxHp: number): number {
  const percent = getHpBeltPercent(pokemon);
  return percent === 0 ? maxHp : getHpBeltMaxHp(maxHp, percent);
}

/**
 * Local fork (2026-11-12): the six EV items (파워웨이트 / 파워리스트 / 파워벨트 / 파워렌즈 / 파워밴드 / 파워앵클릿; numbers
 * and ids in {@linkcode EV_RULES}, ev-items.ts). The user: "노력치 아이템도 추가해보죠 / 종류별로 전부 로그등급으로, 그
 * 아이템을 지닌 포켓몬이 전투에 관여하여서 경험치를 얻었을 경우(첫 턴에 등장 후 교체만 해도 됨, 학습장치로 경험치를 얻는건
 * 제외), 해당 노력치 +1, 최대 노력치는 252". One class for the six, told apart by the stat they carry (saved in the args
 * like the IV Candies'); each only stacks with (and is capped against) its own stat, one per Pokémon. Moved between the
 * player's Pokémon in the party menu like any plain held item, but never taken by an enemy (Thief, Covet, Magician,
 * Pickpocket, a Grip Claw: `BattleScene.canTakeHeldItem`), so no enemy ever holds one and catching a thief cannot bring
 * a second one into the party. Nothing goes through `applyModifiers`: {@linkcode gainEvsFromItems} reads it.
 */
export class EvItemModifier extends PokemonHeldItemModifier {
  protected readonly stat: PermanentStat;

  constructor(type: ModifierType, pokemonId: number, stat: PermanentStat, stackCount?: number) {
    super(type, pokemonId, stackCount);
    this.stat = stat;
  }

  /** The stat whose EVs this item raises */
  getStat(): PermanentStat {
    return this.stat;
  }

  override matchType(modifier: Modifier): boolean {
    return modifier instanceof EvItemModifier && modifier.stat === this.stat;
  }

  override clone(): EvItemModifier {
    return new EvItemModifier(this.type, this.pokemonId, this.stat, this.stackCount);
  }

  override getArgs(): any[] {
    return super.getArgs().concat(this.stat);
  }

  /** Not used through `applyModifiers`; see {@linkcode gainEvsFromItems} */
  override apply(_pokemon: Pokemon): boolean {
    return false;
  }

  override getMaxHeldItemCount(_pokemon?: Pokemon): number {
    return EV_RULES.maxHeld;
  }
}

/**
 * Local fork (2026-11-12): the EV item of type `id` that `pokemon` holds (any stack, 0 included), if any
 * @param id - One of the six ids of {@linkcode EV_RULES}.items
 */
export function getHeldEvItem(pokemon: Pokemon, id: EvItemId): EvItemModifier | undefined {
  const stat = EV_RULES.items[id].stat;
  return pokemon.getHeldItems().find((m): m is EvItemModifier => m instanceof EvItemModifier && m.getStat() === stat);
}

/**
 * Local fork (2026-11-12): whether some Pokémon of `party` holds the EV item `id` (the pool leaves it out then: "각
 * 노력치 아이템은 파티당 하나만 나온다")
 */
export function partyHoldsEvItem(party: readonly Pokemon[], id: EvItemId): boolean {
  return party.some(p => p.isPlayer() && (getHeldEvItem(p, id)?.getStackCount() ?? 0) > 0);
}

/**
 * Local fork (2026-11-12): what one enemy's EXP does to a party member's EVs. Called by `BattleScene.applyPartyExp`
 * for each party member it credits as a participant for a defeated enemy (fainted or caught: the `VictoryPhase` EXP),
 * the step that also gives friendship and Macho Brace stacks, so:
 * - it counts every Pokémon of the battle's participant set: each one that was on the field at the start of a turn of
 *   this battle (switched out on the first turn included) or is on the field when the enemy goes down, and has not
 *   fainted since. One enemy is +1 ({@linkcode EV_RULES}.gainPerEnemy); two KO'd in a double battle are +2;
 * - a party member that gets EXP only through the EXP Share (학습장치) is not a participant and gets nothing;
 * - like the Macho Brace, it also counts at the level cap or the max level, where the EXP itself is 0: the participant
 *   step runs for them all the same;
 * - EXP that is not an enemy's (a mystery encounter's own EXP reward, `PartyExpPhase`) gives none;
 * - each stat stops at its cap (`getEvCap`, ev-items.ts: 252, and 504 for HP since 2026-11-13: "노력치 아이템도 hp만
 *   상한을 두배로"); there is no total cap.
 * Silent, like the Macho Brace's stacks and the friendship. The stats are recalculated right away.
 * @param pokemon - A party member credited as a participant
 * @returns Whether its EVs changed
 */
export function gainEvsFromItems(pokemon: Pokemon): boolean {
  if (!pokemon.isPlayer()) {
    return false;
  }
  let changed = false;
  for (const item of pokemon.getHeldItems()) {
    if (item instanceof EvItemModifier && item.getStackCount() > 0) {
      changed = addEvs(pokemon.evs, item.getStat(), EV_RULES.gainPerEnemy * item.getStackCount()) || changed;
    }
  }
  if (changed) {
    pokemon.calculateStats();
  }
  return changed;
}

/** Local fork (2026-11-09): the multiplier of the Evolution Crystals (붉은진화의수정 / 푸른진화의수정), the Eviolite's */
export const EVOLUTION_CRYSTAL_MULTIPLIER = 1.5;

/** Local fork (2026-11-09): the stat each Evolution Crystal raises, by modifier type id */
export const EVOLUTION_CRYSTAL_STATS = Object.freeze({
  RED_EVOLUTION_CRYSTAL: Stat.ATK,
  BLUE_EVOLUTION_CRYSTAL: Stat.SPATK,
} as const satisfies Record<string, EffectiveStat>);

/**
 * Local fork (2026-11-09): the Eviolite's rule for how much of an evolution item's boost a Pokémon gets (the same
 * numbers as `EvolutionStatBoosterModifier.apply` in modifier.ts, which stays as upstream wrote it):
 * - the whole `multiplier` if it can still evolve (a fusion: both of its species can);
 * - half of the boost, `1 + (multiplier - 1) / 2`, for a fusion where only one of the two species can evolve;
 * - nothing (1) for a fully evolved Pokémon.
 * @param pokemon - The holder
 * @param multiplier - The item's full multiplier
 * @returns The multiplier to apply to the holder's stat
 */
export function getEvolutionBoostMultiplier(pokemon: Pokemon, multiplier: number): number {
  const isUnevolved = speciesDataRegistry.hasEvolutions(pokemon.getSpeciesForm(true).speciesId);
  if (
    pokemon.isFusion()
    && speciesDataRegistry.hasEvolutions(pokemon.getFusionSpeciesForm(true).speciesId) !== isUnevolved
  ) {
    return 1 + (multiplier - 1) / 2;
  }
  return isUnevolved ? multiplier : 1;
}

/**
 * Local fork (2026-11-10): whether an Evolution Crystal (붉은진화의수정 / 푸른진화의수정) can boost `pokemon` at all: it is
 * not Gigantamax'd and its species, or its fusion species, can still evolve (the Eviolite's check). Moved out of the
 * player pool's weight (`evolutionCrystalWeight` in init-modifier-pools.ts), unchanged, so the trainer / boss items
 * (enemy-custom-items.ts) ask the same thing of one Pokémon.
 */
export function canEvolutionCrystalBoost(pokemon: Pokemon): boolean {
  return (
    !pokemon.isMax()
    && (speciesDataRegistry.hasEvolutions(pokemon.getSpeciesForm(true).speciesId)
      || (pokemon.isFusion() && speciesDataRegistry.hasEvolutions(pokemon.getFusionSpeciesForm(true).speciesId)))
  );
}

/**
 * Local fork (2026-11-10), review fix: whether Evolution Crystals can turn up in this run at all, the Eviolite's gate:
 * never in a Fresh Start challenge, and only once the Eviolite is unlocked, except in the Daily run. Moved out of the
 * player pool's weight (`evolutionCrystalWeight` in init-modifier-pools.ts), unchanged, so the trainer / boss items
 * (enemy-custom-items.ts) hold no crystal the player could not be offered (a steal or a catch would hand it over).
 */
export function areEvolutionCrystalsAvailable(): boolean {
  const { gameMode, gameData } = globalScene;
  return gameMode.isDaily || (!gameMode.isFreshStartChallenge() && gameData.isUnlocked(Unlockables.EVIOLITE));
}

/**
 * Local fork (2026-11-09): Red / Blue Evolution Crystal (붉은진화의수정 / 푸른진화의수정), ULTRA tier, the Eviolite's
 * Attack and Sp. Atk versions (the user: "진화의휘석 계열 아이템을 추가해보죠. 붉은진화의수정: 공격 / 푸른진화의수정:
 * 특수공격").
 * - While held by a Pokémon that can still evolve, its Attack (red) or Sp. Atk (blue) is x1.5
 *   ({@linkcode EVOLUTION_CRYSTAL_MULTIPLIER}): an effective-stat multiplier like the Eviolite, so the summary shows
 *   the raised stat in green. A fusion where only one species can evolve gets half of it (x1.25), a fully evolved
 *   Pokémon nothing, and a Gigantamax'd one nothing ({@linkcode getEvolutionBoostMultiplier}, the Eviolite's rule).
 * - Each crystal is its own item: it never stacks with, or is capped against, the Eviolite or the other crystal. That
 *   is why this extends `StatBoosterModifier` and not `EvolutionStatBoosterModifier`, whose `matchType` takes in every
 *   instance of that class: an Eviolite would then count a crystal as another Eviolite.
 * One of each per Pokémon (Eviolite, red and blue can be held together), transferable and stealable like the Eviolite.
 * Saves keep the holder's id and the stat; the multiplier comes from the class.
 */
export class EvolutionCrystalModifier extends StatBoosterModifier {
  constructor(type: ModifierType, pokemonId: number, stat: EffectiveStat, stackCount?: number) {
    super(type, pokemonId, [stat], EVOLUTION_CRYSTAL_MULTIPLIER, stackCount);
  }

  /** The stat this crystal raises */
  getStat(): EffectiveStat {
    return this.stats[0] as EffectiveStat;
  }

  /** A red crystal only stacks with (and is capped against) another red crystal, a blue one with a blue one */
  override matchType(modifier: Modifier): boolean {
    return modifier instanceof EvolutionCrystalModifier && modifier.getStat() === this.getStat();
  }

  override clone(): EvolutionCrystalModifier {
    return new EvolutionCrystalModifier(this.type, this.pokemonId, this.getStat(), this.stackCount);
  }

  /** The holder's id and the stat; the multiplier is fixed ({@linkcode EVOLUTION_CRYSTAL_MULTIPLIER}) */
  override getArgs(): any[] {
    return [this.pokemonId, this.getStat()];
  }

  /** Like the Eviolite: no boost while the holder is Gigantamax'd */
  override shouldApply(pokemon: Pokemon, stat: Stat, statValue: NumberHolder): boolean {
    return super.shouldApply(pokemon, stat, statValue) && !pokemon.isMax();
  }

  /**
   * @param pokemon - The holder
   * @param _stat - The stat being boosted (always {@linkcode getStat}, see `shouldApply`)
   * @param statValue - The stat's value, changed in place
   * @returns Whether the holder got a boost (`false` when it is fully evolved)
   */
  override apply(pokemon: Pokemon, _stat: Stat, statValue: NumberHolder): boolean {
    const multiplier = getEvolutionBoostMultiplier(pokemon, this.multiplier);
    if (multiplier === 1) {
      return false;
    }
    statValue.value *= multiplier;
    return true;
  }

  override getMaxHeldItemCount(_pokemon?: Pokemon): number {
    return 1;
  }
}

/**
 * Local fork (2026-11-09): every number of Training Shackles (트레이닝족쇄), Ultimate Gene (궁극유전자) and Flame Cauldron
 * (화염가마솥), in one place. The user: "트레이닝 족쇄(착용시 스피드 절반, 나머지 모든 스탯 1.1배)(2개까지 가능, 2개면
 * 스피드1/3, 모든 스탯 2.2배)(등급 로그)랑 궁극유전자(마스터)(모든 스탯 1.2배, 뮤츠/메가뮤츠X/메가뮤츠Y가 사용 시 효과 두배,
 * 최대 하나), 화염가마솥(근성/열폭주를 템으로 만든 버전, 근성과 다르게 화사에만 발동, 로그 등급)".
 * - `maxHeld`: how many one Pokémon can hold;
 * - `poolWeight`: the weight in the player's reward pool (shackles and cauldron ROGUE, gene MASTER; init-modifier-pools.ts).
 * HP is never changed by any of them.
 */
export const SHACKLES_GENE_CAULDRON = Object.freeze({
  TRAINING_SHACKLES: Object.freeze({
    maxHeld: 2,
    poolWeight: 4,
    /** The stats other than Speed that the shackles raise */
    raisedStats: Object.freeze([Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF]) as readonly EffectiveStat[],
    /**
     * By the number held: index 0 is one pair, index 1 two. The other stats in tenths (12 = x1.2), applied as
     * `value * othersTenths / 10` like the Ultimate Gene so a whole number comes out exact. The user's numbers were 1/2
     * and 1.1, then 1/3 and 2.2; since 2026-11-10 x1.2 and x1.4 with the same Speed (the user: "스피드 능력치는 둘다
     * 유지하고 기본 1.2 두개 1.4로")
     */
    byCount: Object.freeze([
      Object.freeze({ speed: 1 / 2, othersTenths: 12 }),
      Object.freeze({ speed: 1 / 3, othersTenths: 14 }),
    ]),
  }),
  ULTIMATE_GENE: Object.freeze({
    maxHeld: 1,
    poolWeight: 8,
    /** Every stat but HP */
    stats: Object.freeze([Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD]) as readonly EffectiveStat[],
    /**
     * x1.2, in tenths (12 = x1.2), applied as `value * tenths / 10`. Local fork (2026-11-09): whole numbers keep the
     * result exact, as with {@linkcode FORGED_STEEL}: 175 * 1.4 is 244.99999999999997 in floating point and
     * floors to 244 (`175 * 14 / 10` is 245).
     */
    tenths: 12,
    /** The doubled bonus (+40%, x1.4) for the species in `boostedSpecies`, in tenths */
    boostedTenths: 14,
    /** Mewtwo, in every form (Mega Mewtwo X / Y are forms of it); a fusion counts if either species is one */
    boostedSpecies: Object.freeze([SpeciesId.MEWTWO]) as readonly SpeciesId[],
  }),
  FLAME_CAULDRON: Object.freeze({
    maxHeld: 1,
    poolWeight: 4,
  }),
  /** Local fork (2026-11-10): Flame Furnace (불꽃화로), what a Flame Cauldron becomes; MASTER, in no reward pool */
  FLAME_FURNACE: Object.freeze({
    maxHeld: 1,
    /**
     * Always raised. x1.5 at first ("공격과 특수공격을 1.5배로"), x1.3 since 2026-11-10 (the user: "불꽃화로의 능력치
     * 증가량도 1.3배로 너프가 필요할듯"); x1.3 floors exactly in floating point for every stat (checked to 200000)
     */
    stats: Object.freeze([Stat.ATK, Stat.SPATK]) as readonly EffectiveStat[],
    multiplier: 1.3,
  }),
  /**
   * Local fork (2026-11-10): Toxic Distiller (맹독증류기), the Flame Cauldron's twin for the Toxic Orb (the user: "맹독
   * 증류기(화염 가마솥과 동일하되 맹독구슬 버전, 올려주는 스탯은 방어와 특수방어 1.3배)"); ROGUE, no effect of its own
   */
  TOXIC_DISTILLER: Object.freeze({
    maxHeld: 1,
    poolWeight: 4,
  }),
  /** Local fork (2026-11-10): Toxic Distillate (맹독증류액), what a Toxic Distiller becomes; MASTER, in no reward pool */
  TOXIC_DISTILLATE: Object.freeze({
    maxHeld: 1,
    /** Always raised, x1.3 like the furnace (exact in floating point the same way) */
    stats: Object.freeze([Stat.DEF, Stat.SPDEF]) as readonly EffectiveStat[],
    multiplier: 1.3,
  }),
  /**
   * Local fork (2026-11-10): Discharged Coil (방전코일), the cauldron's and distiller's twin for the Light Ball (전기구슬;
   * the user: "방전코일 / 초전도코일 … 전기구슬 얻으면 변하고"); ROGUE like the other two, no effect of its own
   */
  DISCHARGED_COIL: Object.freeze({
    maxHeld: 1,
    poolWeight: 4,
  }),
  /**
   * Local fork (2026-11-10): Superconducting Coil (초전도코일), what a Discharged Coil becomes; MASTER, in no reward pool.
   * The user: "스피드 1.4배, 특이사항으로는 피카츄 계열이 소지 시 증가량 2배(스피드 1.8배)".
   */
  SUPERCONDUCTING_COIL: Object.freeze({
    maxHeld: 1,
    stats: Object.freeze([Stat.SPD]) as readonly EffectiveStat[],
    /** x1.4 in tenths, applied as `value * tenths / 10` like the Ultimate Gene (`value * 1.4` floors 1 low for some) */
    tenths: 14,
    /** The doubled bonus (+80%, x1.8) for `boostedSpecies`, in tenths */
    boostedTenths: 18,
    /** The Pikachu line: Pichu, Pikachu (every form), Raichu, Alolan Raichu; a fusion counts if either species is one */
    boostedSpecies: Object.freeze([
      SpeciesId.PICHU,
      SpeciesId.PIKACHU,
      SpeciesId.RAICHU,
      SpeciesId.ALOLA_RAICHU,
    ]) as readonly SpeciesId[],
  }),
});

/**
 * Local fork (2026-11-09): Training Shackles (트레이닝족쇄), ROGUE tier, up to 2 per Pokémon (they stack).
 * - One held: Speed x1/2, Attack / Defense / Sp. Atk / Sp. Def x1.2 (x1.1 until 2026-11-10).
 * - Two held: Speed x1/3, the other four x1.4 (x2.2 until 2026-11-10).
 * HP is untouched. Effective-stat multipliers like the vests (`Pokemon.getEffectiveStat`), chosen by the stack count
 * ({@linkcode SHACKLES_GENE_CAULDRON}); the summary shows the raised stats in green and the lowered Speed in blue.
 * Only stacks with (and is capped against) other Training Shackles. Transferable and stealable. Saves keep only the
 * holder's id: the numbers come from the table, so a later balance change reaches saved shackles too.
 */
export class TrainingShacklesModifier extends StatBoosterModifier {
  constructor(type: ModifierType, pokemonId: number, stackCount?: number) {
    const { raisedStats, byCount } = SHACKLES_GENE_CAULDRON.TRAINING_SHACKLES;
    // `multiplier` is the one-pair value, only kept for the base class; `apply` goes by the stack count
    super(type, pokemonId, [...raisedStats, Stat.SPD], byCount[0].othersTenths / 10, stackCount);
  }

  /** The Speed and other-stat multipliers for the current stack count */
  getMultipliers(): { readonly speed: number; readonly others: number } {
    const { speed, othersTenths } = this.getStep();
    return { speed, others: othersTenths / 10 };
  }

  /** The table row for the current stack count (the other stats in tenths) */
  private getStep(): { readonly speed: number; readonly othersTenths: number } {
    const { byCount } = SHACKLES_GENE_CAULDRON.TRAINING_SHACKLES;
    return byCount[Math.min(Math.max(this.getStackCount(), 1), byCount.length) - 1];
  }

  /** Speed times its fraction (unchanged); the other stats times their tenths, then divided by 10 (2026-11-10) */
  override apply(_pokemon: Pokemon, stat: Stat, statValue: NumberHolder): boolean {
    const { speed, othersTenths } = this.getStep();
    if (stat === Stat.SPD) {
      statValue.value *= speed;
    } else {
      statValue.value = (statValue.value * othersTenths) / 10;
    }
    return true;
  }

  /** Training Shackles only stack with (and are capped against) other Training Shackles */
  override matchType(modifier: Modifier): boolean {
    return modifier instanceof TrainingShacklesModifier;
  }

  override clone(): TrainingShacklesModifier {
    return new TrainingShacklesModifier(this.type, this.pokemonId, this.stackCount);
  }

  /** Only the holder's id is saved; the stats and multipliers come from the table */
  override getArgs(): any[] {
    return [this.pokemonId];
  }

  override getMaxHeldItemCount(_pokemon?: Pokemon): number {
    return SHACKLES_GENE_CAULDRON.TRAINING_SHACKLES.maxHeld;
  }
}

/**
 * Local fork (2026-11-09): Ultimate Gene (궁극유전자), MASTER tier, one per Pokémon.
 * - Attack / Defense / Sp. Atk / Sp. Def / Speed x1.2 (HP untouched).
 * - Held by Mewtwo in any form (Mega Mewtwo X / Y too), x1.4: the bonus doubled. A fusion gets x1.4 when either species
 *   is Mewtwo, checked the way Light Ball checks Pikachu (`SpeciesStatBoosterModifier.shouldApply`).
 * Effective-stat multipliers ({@linkcode SHACKLES_GENE_CAULDRON}). Only stacks with (and is capped against) another
 * Ultimate Gene. Transferable and stealable. Saves keep only the holder's id.
 */
export class UltimateGeneModifier extends StatBoosterModifier {
  constructor(type: ModifierType, pokemonId: number, stackCount?: number) {
    const { stats, tenths } = SHACKLES_GENE_CAULDRON.ULTIMATE_GENE;
    // Local fork (2026-11-09): `multiplier` (x1.2) is only kept for the base class; `apply` works in tenths
    super(type, pokemonId, [...stats], tenths / 10, stackCount);
  }

  /** Whether `pokemon` gets the doubled bonus: Mewtwo (any form), or a fusion with Mewtwo as either species */
  static isBoostedHolder(pokemon: Pokemon): boolean {
    const { boostedSpecies } = SHACKLES_GENE_CAULDRON.ULTIMATE_GENE;
    return (
      boostedSpecies.includes(pokemon.getSpeciesForm(true).speciesId)
      || (pokemon.isFusion() && boostedSpecies.includes(pokemon.getFusionSpeciesForm(true).speciesId))
    );
  }

  /** Local fork (2026-11-09): the multiplier `pokemon` gets from this gene, in tenths: 14 for Mewtwo, 12 for anyone else */
  getTenthsFor(pokemon: Pokemon): number {
    const { tenths, boostedTenths } = SHACKLES_GENE_CAULDRON.ULTIMATE_GENE;
    return UltimateGeneModifier.isBoostedHolder(pokemon) ? boostedTenths : tenths;
  }

  /** The multiplier `pokemon` gets from this gene: x1.4 for Mewtwo, x1.2 for anyone else */
  getMultiplierFor(pokemon: Pokemon): number {
    return this.getTenthsFor(pokemon) / 10;
  }

  /**
   * Local fork (2026-11-09): multiplies by the tenths, then divides by 10, so a whole-number stat comes out exact
   * (Mewtwo's 175 becomes 245; `175 * 1.4` would floor to 244).
   */
  override apply(pokemon: Pokemon, _stat: Stat, statValue: NumberHolder): boolean {
    statValue.value = (statValue.value * this.getTenthsFor(pokemon)) / 10;
    return true;
  }

  /** An Ultimate Gene only stacks with (and is capped against) another Ultimate Gene */
  override matchType(modifier: Modifier): boolean {
    return modifier instanceof UltimateGeneModifier;
  }

  override clone(): UltimateGeneModifier {
    return new UltimateGeneModifier(this.type, this.pokemonId, this.stackCount);
  }

  /** Only the holder's id is saved; the stats and multipliers come from the table */
  override getArgs(): any[] {
    return [this.pokemonId];
  }

  override getMaxHeldItemCount(_pokemon?: Pokemon): number {
    return SHACKLES_GENE_CAULDRON.ULTIMATE_GENE.maxHeld;
  }
}

/**
 * Local fork (2026-11-09, reworked 2026-11-10): Flame Cauldron (화염가마솥), ROGUE tier, one per Pokémon. Since
 * 2026-11-10 it does nothing by itself (the user: "무언가 타고 남은 재가 담긴 솥이다, 다시 불을 붙일 무언가가 필요한 듯 하다"):
 * a Flame Orb that ends up on its holder is used up and the cauldron becomes a Flame Furnace
 * ({@linkcode FlameFurnaceModifier}, see {@linkcode getOrbVesselIgnitions}). Until then its holder makes the Flame
 * Orb appear in rewards (init-modifier-pools.ts). Transferable and stealable; saves keep the holder's id.
 * (On 2026-11-09 it raised Attack / Sp. Atk x1.5 while burned, ignored the burn's halving, and later had a "lit"
 * state; a save with a lit cauldron becomes a Flame Furnace when loaded.)
 */
export class FlameCauldronModifier extends PokemonHeldItemModifier {
  /** Local fork (2026-11-10): loaded from a 2026-11-09 save as "lit" (args [pokemonId, true]) */
  public readonly legacyLit: boolean;

  /**
   * @param legacyLitOrStackCount - The stack count (the loader appends it to the saved [pokemonId]); a boolean here is
   *   the "lit" state of a 2026-11-09 save ([pokemonId, lit]), followed by the stack count
   */
  constructor(type: ModifierType, pokemonId: number, legacyLitOrStackCount?: boolean | number, stackCount?: number) {
    super(type, pokemonId, typeof legacyLitOrStackCount === "number" ? legacyLitOrStackCount : stackCount);
    this.legacyLit = legacyLitOrStackCount === true;
  }

  /**
   * A Flame Cauldron stacks with (and is capped against) another Flame Cauldron, and against a Flame Furnace. Local
   * fork (2026-11-10): the two are one item before and after, so a furnace holder cannot take a cauldron (the user's
   * bug report: "화염가마솥이 불꽃화로 있는 포켓몬한테 줄 수 있음"); the party menu, the reward's party filter and
   * transfers all go by matchType.
   */
  override matchType(modifier: Modifier): boolean {
    return modifier instanceof FlameCauldronModifier || modifier instanceof FlameFurnaceModifier;
  }

  override clone(): FlameCauldronModifier {
    return new FlameCauldronModifier(this.type, this.pokemonId, this.stackCount);
  }

  override getArgs(): any[] {
    return [this.pokemonId];
  }

  /** No effect of its own */
  override apply(_pokemon: Pokemon): boolean {
    return false;
  }

  override getMaxHeldItemCount(_pokemon?: Pokemon): number {
    return SHACKLES_GENE_CAULDRON.FLAME_CAULDRON.maxHeld;
  }
}

/**
 * Local fork (2026-11-10): Flame Furnace (불꽃화로), a Flame Cauldron that swallowed a Flame Orb (the user: "다시 활활
 * 타오르기 시작한 화로다. 뜨거운 화염의 기운으로 공격과 특수공격을 1.5배로 만들어준다"; x1.3 since 2026-11-10). MASTER tier, in no reward pool
 * ("보상 테이블에서 등장하지 않는 마스터볼 등급 아이템"). Attack and Sp. Atk x1.3 always, as effective-stat multipliers;
 * nothing about burns. One per Pokémon, transferable and stealable. Its holder can get the Flame Orb again by the
 * usual rules (Guts, Flare Boost, …; it counted as an orb until later on 2026-11-10).
 */
export class FlameFurnaceModifier extends StatBoosterModifier {
  constructor(type: ModifierType, pokemonId: number, stackCount?: number) {
    const { stats, multiplier } = SHACKLES_GENE_CAULDRON.FLAME_FURNACE;
    super(type, pokemonId, [...stats], multiplier, stackCount);
  }

  /** A Flame Furnace stacks with (and is capped against) another Flame Furnace or a Flame Cauldron (see the cauldron's) */
  override matchType(modifier: Modifier): boolean {
    return modifier instanceof FlameFurnaceModifier || modifier instanceof FlameCauldronModifier;
  }

  override clone(): FlameFurnaceModifier {
    return new FlameFurnaceModifier(this.type, this.pokemonId, this.stackCount);
  }

  /** Only the holder's id is saved; the stats and multiplier come from the table */
  override getArgs(): any[] {
    return [this.pokemonId];
  }

  override getMaxHeldItemCount(_pokemon?: Pokemon): number {
    return SHACKLES_GENE_CAULDRON.FLAME_FURNACE.maxHeld;
  }
}

/**
 * Local fork (2026-11-10): Toxic Distiller (맹독증류기), ROGUE tier, one per Pokémon, the Flame Cauldron's twin for the
 * Toxic Orb (the user: "화염 가마솥과 동일하되 맹독구슬 버전"). It does nothing by itself ("아무것도 담기지 않은 증류기다");
 * a Toxic Orb that ends up on its holder is used up and the distiller becomes a Toxic Distillate
 * ({@linkcode ToxicDistillateModifier}, see {@linkcode getOrbVesselIgnitions}). Until then its holder makes the Toxic
 * Orb appear in rewards (init-modifier-pools.ts). Independent of the cauldron: one Pokémon may hold both, and each only
 * takes its own orb. Transferable and stealable; saves keep the holder's id.
 */
export class ToxicDistillerModifier extends PokemonHeldItemModifier {
  /** One item before and after: a distillate holder cannot take a distiller (party menu, reward filter, transfers) */
  override matchType(modifier: Modifier): boolean {
    return modifier instanceof ToxicDistillerModifier || modifier instanceof ToxicDistillateModifier;
  }

  override clone(): ToxicDistillerModifier {
    return new ToxicDistillerModifier(this.type, this.pokemonId, this.stackCount);
  }

  override getArgs(): any[] {
    return [this.pokemonId];
  }

  /** No effect of its own */
  override apply(_pokemon: Pokemon): boolean {
    return false;
  }

  override getMaxHeldItemCount(_pokemon?: Pokemon): number {
    return SHACKLES_GENE_CAULDRON.TOXIC_DISTILLER.maxHeld;
  }
}

/**
 * Local fork (2026-11-10): Toxic Distillate (맹독증류액), a Toxic Distiller that took in a Toxic Orb (the user: "올려주는
 * 스탯은 방어와 특수방어 1.3배"). MASTER tier, in no reward pool, like the Flame Furnace. Defense and Sp. Def x1.3 always,
 * as effective-stat multipliers ({@linkcode SHACKLES_GENE_CAULDRON}); nothing about poison. One per Pokémon,
 * transferable and stealable. Its holder can get the Toxic Orb again by the usual rules (Toxic Boost, Poison Heal, …;
 * it counted as an orb until later on 2026-11-10).
 */
export class ToxicDistillateModifier extends StatBoosterModifier {
  constructor(type: ModifierType, pokemonId: number, stackCount?: number) {
    const { stats, multiplier } = SHACKLES_GENE_CAULDRON.TOXIC_DISTILLATE;
    super(type, pokemonId, [...stats], multiplier, stackCount);
  }

  /** Stacks with (and is capped against) another distillate or a distiller (see the distiller's) */
  override matchType(modifier: Modifier): boolean {
    return modifier instanceof ToxicDistillateModifier || modifier instanceof ToxicDistillerModifier;
  }

  override clone(): ToxicDistillateModifier {
    return new ToxicDistillateModifier(this.type, this.pokemonId, this.stackCount);
  }

  /** Only the holder's id is saved; the stats and multiplier come from the table */
  override getArgs(): any[] {
    return [this.pokemonId];
  }

  override getMaxHeldItemCount(_pokemon?: Pokemon): number {
    return SHACKLES_GENE_CAULDRON.TOXIC_DISTILLATE.maxHeld;
  }
}

/**
 * Local fork (2026-11-10): Discharged Coil (방전코일), ROGUE tier, one per Pokémon, the cauldron's and distiller's twin
 * for the Light Ball (전기구슬; the user: "전기구슬 얻으면 변하고"). It does nothing by itself; a Light Ball that ends up
 * on its holder is used up and the coil becomes a Superconducting Coil ({@linkcode SuperconductingCoilModifier}, see
 * {@linkcode getOrbVesselIgnitions}). Until then its holder makes the Light Ball appear in rewards, whatever its species
 * (`SpeciesStatBoosterModifierTypeGenerator`). Independent of the cauldron and the distiller: one Pokémon may hold all
 * three. Transferable and stealable; saves keep the holder's id.
 */
export class DischargedCoilModifier extends PokemonHeldItemModifier {
  /** One item before and after: a superconducting coil holder cannot take a discharged coil (party menu, reward filter, transfers) */
  override matchType(modifier: Modifier): boolean {
    return modifier instanceof DischargedCoilModifier || modifier instanceof SuperconductingCoilModifier;
  }

  override clone(): DischargedCoilModifier {
    return new DischargedCoilModifier(this.type, this.pokemonId, this.stackCount);
  }

  override getArgs(): any[] {
    return [this.pokemonId];
  }

  /** No effect of its own */
  override apply(_pokemon: Pokemon): boolean {
    return false;
  }

  override getMaxHeldItemCount(_pokemon?: Pokemon): number {
    return SHACKLES_GENE_CAULDRON.DISCHARGED_COIL.maxHeld;
  }
}

/**
 * Local fork (2026-11-10): Superconducting Coil (초전도코일), a Discharged Coil that took in a Light Ball. MASTER tier, in
 * no reward pool, like the Flame Furnace. Speed x1.4 always; held by the Pikachu line (Pichu, Pikachu, Raichu, Alolan
 * Raichu, or a fusion with one of them as either species) x1.8, the bonus doubled (the user: "피카츄 계열이 소지 시
 * 증가량 2배(스피드 1.8배)"). An effective-stat multiplier worked in tenths like the Ultimate Gene
 * ({@linkcode SHACKLES_GENE_CAULDRON}). One per Pokémon, transferable and stealable. A Pikachu holding it still gets the
 * Light Ball offered (it counted as a Light Ball until later on 2026-11-10); a Light Ball given then stays and works.
 */
export class SuperconductingCoilModifier extends StatBoosterModifier {
  constructor(type: ModifierType, pokemonId: number, stackCount?: number) {
    const { stats, tenths } = SHACKLES_GENE_CAULDRON.SUPERCONDUCTING_COIL;
    // `multiplier` (x1.4) is only kept for the base class; `apply` works in tenths
    super(type, pokemonId, [...stats], tenths / 10, stackCount);
  }

  /** Whether `pokemon` gets the doubled bonus: the Pikachu line, or a fusion with one of it as either species */
  static isBoostedHolder(pokemon: Pokemon): boolean {
    const { boostedSpecies } = SHACKLES_GENE_CAULDRON.SUPERCONDUCTING_COIL;
    return (
      boostedSpecies.includes(pokemon.getSpeciesForm(true).speciesId)
      || (pokemon.isFusion() && boostedSpecies.includes(pokemon.getFusionSpeciesForm(true).speciesId))
    );
  }

  /** The multiplier `pokemon` gets from this coil, in tenths: 18 for the Pikachu line, 14 for anyone else */
  getTenthsFor(pokemon: Pokemon): number {
    const { tenths, boostedTenths } = SHACKLES_GENE_CAULDRON.SUPERCONDUCTING_COIL;
    return SuperconductingCoilModifier.isBoostedHolder(pokemon) ? boostedTenths : tenths;
  }

  /** Multiplies by the tenths, then divides by 10, so a whole-number stat comes out exact */
  override apply(pokemon: Pokemon, _stat: Stat, statValue: NumberHolder): boolean {
    statValue.value = (statValue.value * this.getTenthsFor(pokemon)) / 10;
    return true;
  }

  /** Stacks with (and is capped against) another superconducting coil or a discharged coil (see the discharged coil's) */
  override matchType(modifier: Modifier): boolean {
    return modifier instanceof SuperconductingCoilModifier || modifier instanceof DischargedCoilModifier;
  }

  override clone(): SuperconductingCoilModifier {
    return new SuperconductingCoilModifier(this.type, this.pokemonId, this.stackCount);
  }

  /** Only the holder's id is saved; the stat and multipliers come from the table */
  override getArgs(): any[] {
    return [this.pokemonId];
  }

  override getMaxHeldItemCount(_pokemon?: Pokemon): number {
    return SHACKLES_GENE_CAULDRON.SUPERCONDUCTING_COIL.maxHeld;
  }
}

/**
 * Local fork (2026-11-10): whether `modifier` is a Light Ball (전기구슬), checked the way its reward generator checks it
 * (`SpeciesStatBoosterModifier.contains`: the species item for Pikachu's Attack)
 */
export function isLightBall(modifier: Modifier): boolean {
  return modifier instanceof SpeciesStatBoosterModifier && modifier.contains(SpeciesId.PIKACHU, Stat.ATK);
}

/** Local fork (2026-11-10): the orb a vessel takes in, by its status (`TurnStatusEffectModifier.getStatusEffect`) */
function isStatusOrb(modifier: Modifier, status: StatusEffect): boolean {
  return modifier instanceof TurnStatusEffectModifier && modifier.getStatusEffect() === status;
}

/**
 * Local fork (2026-11-10): one row per vessel that an orb fills: the empty vessel, the item it takes in (`isOrb`), and
 * what it becomes (class and modifier type key). The Discharged Coil's "orb" is the Light Ball (2026-11-10).
 */
const ORB_VESSELS = Object.freeze([
  Object.freeze({
    vessel: FlameCauldronModifier,
    isOrb: (m: Modifier) => isStatusOrb(m, StatusEffect.BURN),
    result: FlameFurnaceModifier,
    resultKey: "FLAME_FURNACE",
    /** A cauldron loaded as "lit" from a 2026-11-09 save becomes a furnace without an orb */
    filledWithoutOrb: (vessel: PokemonHeldItemModifier) => (vessel as FlameCauldronModifier).legacyLit,
  }),
  Object.freeze({
    vessel: ToxicDistillerModifier,
    isOrb: (m: Modifier) => isStatusOrb(m, StatusEffect.TOXIC),
    result: ToxicDistillateModifier,
    resultKey: "TOXIC_DISTILLATE",
    filledWithoutOrb: (_vessel: PokemonHeldItemModifier) => false,
  }),
  Object.freeze({
    vessel: DischargedCoilModifier,
    isOrb: isLightBall,
    result: SuperconductingCoilModifier,
    resultKey: "SUPERCONDUCTING_COIL",
    filledWithoutOrb: (_vessel: PokemonHeldItemModifier) => false,
  }),
] as const);

/**
 * Local fork (2026-11-11): whether `modifier` is one of the orb vessels before or after it is filled (화염가마솥 /
 * 불꽃화로, 맹독증류기 / 맹독증류액, 방전코일 / 초전도코일). Each pair is one item ({@linkcode FlameCauldronModifier.matchType}
 * and its twins), so the player's steals skip a pair that anyone in the party already holds
 * (`BattleScene.canTakeHeldItem`; the user: "끈기갈고리손톱/픽업/도둑질이 합체형 아이템의 합체 전 / 후 아이템이 있을
 * 경우 적에게서 합체 전/후 아이템을 못훔치게").
 */
export function isOrbVesselItem(modifier: Modifier): boolean {
  return ORB_VESSELS.some(({ vessel, result }) => modifier instanceof vessel || modifier instanceof result);
}

/** Local fork (2026-11-10): what {@linkcode getOrbVesselIgnitions} asks the caller to do, one per filled vessel */
export interface OrbVesselIgnition {
  /** The used-up orb (if any) and the vessel */
  remove: PersistentModifier[];
  /** The filled vessel (Flame Furnace / Toxic Distillate / Superconducting Coil) to add in their place, for the same holder */
  result: PokemonHeldItemModifier;
}

/**
 * Local fork (2026-11-09, 2026-11-10): after `added` went into `modifiers` (the player's or the enemy's list), whether
 * its holder now holds an empty vessel and its orb together ({@linkcode ORB_VESSELS}: a Flame Cauldron and a Flame Orb,
 * a Toxic Distiller and a Toxic Orb, a Discharged Coil and a Light Ball; or a cauldron loaded as "lit" from a
 * 2026-11-09 save). For each, the caller removes
 * the orb and the vessel and adds the returned result. `BattleScene.addModifier` and `addEnemyModifier` call this, which
 * covers rewards, transfers (`tryTransferHeldItemModifier` adds through them), steals, encounters, starting items and
 * session loads, whichever of the two items arrives second. Nothing happens for a vessel while the holder already has
 * its result (one per Pokémon). Generalised from the cauldron's own function on 2026-11-10 (Toxic Distiller).
 * @param added - The modifier just added
 * @param modifiers - The list it was added to
 */
export function getOrbVesselIgnitions(
  added: PersistentModifier,
  modifiers: readonly PersistentModifier[],
): OrbVesselIgnition[] {
  if (!(added instanceof PokemonHeldItemModifier)) {
    return [];
  }
  const holderId = added.pokemonId;
  const ignitions: OrbVesselIgnition[] = [];
  for (const { vessel: vesselClass, isOrb, result, resultKey, filledWithoutOrb } of ORB_VESSELS) {
    const vessel = modifiers.find(
      (m): m is PokemonHeldItemModifier => m instanceof vesselClass && m.pokemonId === holderId,
    );
    if (!vessel || modifiers.some(m => m instanceof result && m.pokemonId === holderId)) {
      continue;
    }
    const orb = modifiers.find(m => m instanceof PokemonHeldItemModifier && m.pokemonId === holderId && isOrb(m));
    if (!orb && !filledWithoutOrb(vessel)) {
      continue;
    }
    const type = modifierTypes[resultKey]().withIdFromFunc(modifierTypes[resultKey]);
    ignitions.push({ remove: orb ? [orb, vessel] : [vessel], result: new result(type, holderId) });
  }
  return ignitions;
}

/** Local fork (2026-11-10): whether `pokemon` holds a Flame Cauldron (it calls the Flame Orb in rewards) */
export function holdsFlameCauldron(pokemon: Pokemon): boolean {
  return pokemon.getHeldItems().some(m => m instanceof FlameCauldronModifier);
}

/** Local fork (2026-11-10): whether `pokemon` holds a Toxic Distiller (it calls the Toxic Orb in rewards) */
export function holdsToxicDistiller(pokemon: Pokemon): boolean {
  return pokemon.getHeldItems().some(m => m instanceof ToxicDistillerModifier);
}

/** Local fork (2026-11-10): whether `pokemon` holds a Discharged Coil (it calls the Light Ball in rewards) */
export function holdsDischargedCoil(pokemon: Pokemon): boolean {
  return pokemon.getHeldItems().some(m => m instanceof DischargedCoilModifier);
}

/**
 * Local fork (2026-11-09): every number of Radioactive Waste (방사성폐기물), in one place. The user: "아이템: 방사성
 * 폐기물 도 추가해두죠. 독 포켓몬이 지니면 매턴 최대체력의 1/8 회복, 아니면 독 상태이상(강철 제외)가 되도록. 등급은
 * 로그로 둡시다."
 * - `maxHeld`: how many one Pokémon can hold;
 * - `poolWeight`: the weight in the player's ROGUE reward pool while some party member wants it (init-modifier-pools.ts);
 * - `healDivisor`: a Poison-type holder heals its max HP / this at the end of each turn (Leftovers: 16);
 * - `status`: what any other holder gets at the end of each turn: regular poison (독), not bad poison (맹독).
 */
export const RADIOACTIVE_WASTE = Object.freeze({
  maxHeld: 1,
  poolWeight: 4,
  healDivisor: 8,
  status: StatusEffect.POISON,
});

/**
 * Local fork (2026-11-09): the two turn-end steps of Radioactive Waste (`TurnEndPhase` applies the item once for each):
 * `"heal"` right after Leftovers, `"poison"` right after the Toxic / Flame Orb
 */
export type RadioactiveWasteStep = "heal" | "poison";

/**
 * Local fork (2026-11-09): Radioactive Waste (방사성폐기물), ROGUE tier, one per Pokémon ({@linkcode RADIOACTIVE_WASTE}).
 * At the end of each turn:
 * - held by a Poison type ({@linkcode isRadioactiveWasteHealer}: a Tera Type or a changed type counts as it does in
 *   battle, a Stellar Tera keeps its original types), the holder heals 1/8 of its max HP the way Leftovers heals: at
 *   Leftovers' moment, with Leftovers' message naming this item, nothing at full HP, and Heal Block stops it
 *   (`PokemonHealPhase`);
 * - held by any other Pokémon except a Steel type (the user's "강철 제외", checked here so that it holds even with
 *   Corrosion, which lets a held Toxic Orb poison a Steel type), the holder is poisoned (regular 독, not 맹독) the way the
 *   Toxic Orb applies its status (`trySetStatus` with the holder as the source and the item's name), at the orb's
 *   moment, so the usual protections apply: Immunity, Pastel Veil, a status already there, Misty Terrain... Like the
 *   Toxic Orb, Safeguard does NOT stop it (Safeguard only stops statuses from another Pokémon).
 * Not an orb: it is not a `TurnStatusEffectModifier`, so it can be held next to a Toxic or Flame Orb (the orb acts first)
 * and does not count for the orbs' rewards. Only stacks with (and is capped against) another Radioactive Waste.
 * Transferable and stealable. Saves keep only the holder's id.
 */
export class RadioactiveWasteModifier extends PokemonHeldItemModifier {
  override matchType(modifier: Modifier): boolean {
    return modifier instanceof RadioactiveWasteModifier;
  }

  override clone(): RadioactiveWasteModifier {
    return new RadioactiveWasteModifier(this.type, this.pokemonId, this.stackCount);
  }

  /** Only the holder's id is saved; the numbers come from {@linkcode RADIOACTIVE_WASTE} */
  override getArgs(): any[] {
    return [this.pokemonId];
  }

  /** Only through `TurnEndPhase`, which names the step */
  override shouldApply(pokemon?: Pokemon, step?: unknown): boolean {
    return super.shouldApply(pokemon, step) && (step === "heal" || step === "poison");
  }

  /**
   * @param pokemon - The holder
   * @param step - `"heal"`: a Poison-type holder heals; `"poison"`: any other holder tries to become poisoned
   * @returns Whether a heal was queued or the holder is being poisoned
   */
  override apply(pokemon: Pokemon, step: RadioactiveWasteStep): boolean {
    const isPoisonType = isRadioactiveWasteHealer(pokemon);
    if (step === "poison") {
      // Local fork (2026-11-09): Steel types are left out here, not only through `canSetStatus`, whose Steel immunity
      // the holder's own Corrosion would cancel (the user: "강철 제외")
      return (
        !isPoisonType
        && !radioactiveWasteSeesType(pokemon, PokemonType.STEEL)
        && pokemon.trySetStatus(RADIOACTIVE_WASTE.status, pokemon, undefined, this.type.name)
      );
    }
    if (!isPoisonType || pokemon.isFullHp()) {
      return false;
    }
    globalScene.phaseManager.unshiftNew(
      "PokemonHealPhase",
      pokemon.getBattlerIndex(),
      toDmgValue(pokemon.getMaxHp() / RADIOACTIVE_WASTE.healDivisor),
      {
        message: i18next.t("modifier:turnHealApply", {
          pokemonNameWithAffix: getPokemonNameWithAffix(pokemon),
          typeName: this.type.name,
        }),
      },
    );
    return true;
  }

  override getMaxHeldItemCount(_pokemon?: Pokemon): number {
    return RADIOACTIVE_WASTE.maxHeld;
  }
}

/**
 * Local fork (2026-11-09): whether `pokemon` is of `type` for Radioactive Waste: as in battle (a Tera Type or a changed
 * type counts), but a Stellar Tera keeps its original types, the same view `Pokemon.canSetStatus` uses for the poison's
 * type immunities (so a Stellar Poison type still heals instead of doing nothing)
 */
function radioactiveWasteSeesType(pokemon: Pokemon, type: PokemonType): boolean {
  return pokemon.isOfType(type, { returnOriginalTypesIfStellar: true });
}

/**
 * Local fork (2026-11-09): whether Radioactive Waste heals `pokemon` (a Poison type) rather than poisoning it; also used
 * by the reward pool's weight
 */
export function isRadioactiveWasteHealer(pokemon: Pokemon): boolean {
  return radioactiveWasteSeesType(pokemon, PokemonType.POISON);
}

/** Local fork (2026-11-09): whether `pokemon` holds a Radioactive Waste */
export function holdsRadioactiveWaste(pokemon: Pokemon): boolean {
  return pokemon.getHeldItems().some(m => m instanceof RadioactiveWasteModifier);
}

/**
 * Local fork (2026-11-11): Punching Glove (펀치글러브), ULTRA tier, one per Pokémon (the user: "펀치글러브(하이퍼, 주먹류
 * 기술 데미지 1.1배 + 비접촉(단단한발톱의 보너스는 받는데 킬가르도가 쓰는 킹실드의 공격 랭크하락 효과는 안받도록 코드를 잘
 * 짜봐요), 최대 1개)").
 * - The holder's punching moves (the flag Iron Fist uses) get x1.1 power (`Move.calculateBattlePower`).
 * - They do not make contact for the target's side: its abilities, protection moves and tags that react to contact do
 *   nothing, while the holder's own contact bonuses (Tough Claws, Poison Touch, Unseen Fist) still apply. See
 *   contact-gloves.ts, which `Move.doesFlagEffectApply` asks for callers that pass `targetSide: true`.
 * Its effect lives in contact-gloves.ts, found through {@linkcode contactGlove}. A Master Punching Glove on the same
 * Pokémon supersedes it (no x1.1 on top); a Master glove holder cannot be given or handed a plain glove (see
 * {@linkcode MasterPunchingGloveModifier.matchType}). Transferable and stealable; saves keep the holder's id.
 */
export class PunchingGloveModifier extends PokemonHeldItemModifier implements ContactGloveItem {
  public readonly contactGlove: ContactGloveKind = CONTACT_GLOVES.PUNCHING_GLOVE.kind;

  override matchType(modifier: Modifier): boolean {
    return modifier instanceof PunchingGloveModifier;
  }

  override clone(): PunchingGloveModifier {
    return new PunchingGloveModifier(this.type, this.pokemonId, this.stackCount);
  }

  override getArgs(): any[] {
    return [this.pokemonId];
  }

  /** Not used through `applyModifiers`; see contact-gloves.ts */
  override apply(_pokemon: Pokemon): boolean {
    return false;
  }

  override getMaxHeldItemCount(_pokemon?: Pokemon): number {
    return CONTACT_GLOVES.PUNCHING_GLOVE.maxHeld;
  }
}

/**
 * Local fork (2026-11-11): Master Punching Glove (마스터 펀치글러브), MASTER tier, one per Pokémon (the user: "마스터
 * 펀치글러브(마스터, 기존 펀치글러브 디자인을 검게 변경, 로그볼과 비슷한 색조합, 모든 접촉기에게 비접촉 판정 추가(펀치글러브와
 * 비슷) + 1.2배 위력 + 보이지않는주먹 효과(포챔스 기준))").
 * - Every contact move of the holder (and every punching move) gets x1.2 power and makes no contact for the target's
 *   side, like the Punching Glove's punches.
 * - Unseen Fist as in Pokémon Champions: the holder's contact moves go through Protect, Detect, King's Shield and the
 *   like, dealing 1/4 damage (`Pokemon.getAttackDamage`); a holder with Unseen Fist itself gets the 1/4 once.
 * - It supersedes a Punching Glove on the same Pokémon (no x1.1 on top).
 * One Pokémon MAY hold both, but only in one order: a Punching Glove holder can take a Master glove (the plain one then
 * does nothing and can be handed on), while a Master glove holder is never offered or handed a plain glove.
 * Transferable and stealable; saves keep the holder's id.
 */
export class MasterPunchingGloveModifier extends PokemonHeldItemModifier implements ContactGloveItem {
  public readonly contactGlove: ContactGloveKind = CONTACT_GLOVES.MASTER_PUNCHING_GLOVE.kind;

  /**
   * A Master glove counts as full for a Master glove and for a Punching Glove: the reward's party filter, the party
   * menu's transfer and `tryTransferHeldItemModifier` all ask the held item `matchType(incoming)`, so a Master glove
   * holder never gets a plain glove. A plain glove's own `matchType` leaves the Master glove out, so a plain holder can
   * still take one (see {@linkcode match}).
   */
  override matchType(modifier: Modifier): boolean {
    return modifier instanceof MasterPunchingGloveModifier || modifier instanceof PunchingGloveModifier;
  }

  /**
   * Stacking (`PersistentModifier.add` asks the incoming item `match(held)`) is with another Master glove only, so a
   * Master glove given to a Punching Glove holder is added next to it instead of failing to stack onto it
   */
  override match(modifier: Modifier): boolean {
    return (
      modifier instanceof MasterPunchingGloveModifier
      && (modifier as PokemonHeldItemModifier).pokemonId === this.pokemonId
    );
  }

  override clone(): MasterPunchingGloveModifier {
    return new MasterPunchingGloveModifier(this.type, this.pokemonId, this.stackCount);
  }

  override getArgs(): any[] {
    return [this.pokemonId];
  }

  /** Not used through `applyModifiers`; see contact-gloves.ts */
  override apply(_pokemon: Pokemon): boolean {
    return false;
  }

  override getMaxHeldItemCount(_pokemon?: Pokemon): number {
    return CONTACT_GLOVES.MASTER_PUNCHING_GLOVE.maxHeld;
  }
}

/**
 * Local fork (2026-11-11): the base of six of the seven items of battle-held-items.ts (파워풀허브, 메트로놈, 속임수주사위,
 * 씨앗주머니, 달인의띠, 정밀렌즈; 연료 is a {@linkcode FuelModifier}). They do nothing through `applyModifiers`: the battle
 * code finds them by their {@linkcode BattleHeldItem.battleItem} marker (and, since the third batch, 클리어참, 목스프레이,
 * 힘의머리띠 and 박식안경; 부스트에너지 is a {@linkcode BoosterEnergyModifier}). Each only stacks with (and is capped against)
 * its own kind, up to its `maxHeld` in {@linkcode BATTLE_HELD_ITEMS}, for player and enemy holders alike. Transferable
 * and stealable; saves keep only the holder's id.
 */
abstract class BattleRuleHeldItemModifier extends PokemonHeldItemModifier implements BattleHeldItem {
  abstract get battleItem(): BattleItemKind;

  override matchType(modifier: Modifier): boolean {
    return (modifier as Partial<BattleHeldItem>).battleItem === this.battleItem;
  }

  override getArgs(): any[] {
    return [this.pokemonId];
  }

  /** Not used through `applyModifiers`; see battle-held-items.ts */
  override apply(_pokemon: Pokemon): boolean {
    return false;
  }

  override getMaxHeldItemCount(_pokemon?: Pokemon): number {
    return getBattleItemRow(this.battleItem).maxHeld;
  }
}

/**
 * Local fork (2026-11-11): Power Herb (파워풀허브), ROGUE tier, up to 2 (the user: "전투당 개수만큼 발동할 수 있고, 최대
 * 2개까지"). Not used up: each battle its holder skips the charging turn of a two-turn move (every one but Sky Drop) up to
 * once per herb held, and not when the move is instant anyway (`tryPowerHerbCharge`, battle-held-items.ts).
 */
export class PowerHerbModifier extends BattleRuleHeldItemModifier {
  override get battleItem(): BattleItemKind {
    return "powerHerb";
  }

  override clone(): PowerHerbModifier {
    return new PowerHerbModifier(this.type, this.pokemonId, this.stackCount);
  }
}

/**
 * Local fork (2026-11-11): Metronome (메트로놈), ULTRA tier, up to 3 (the user: "최대 3개, 증가치는 10/15/20%로"): each
 * consecutive use of the same move +10 / 15 / 20% power for 1 / 2 / 3 held, at most 5 steps (x1.5 / x1.75 / x2)
 * (`applyMetronomePower`, battle-held-items.ts).
 */
export class MetronomeModifier extends BattleRuleHeldItemModifier {
  override get battleItem(): BattleItemKind {
    return "metronome";
  }

  override clone(): MetronomeModifier {
    return new MetronomeModifier(this.type, this.pokemonId, this.stackCount);
  }
}

/**
 * Local fork (2026-11-11): Loaded Dice (속임수주사위), ROGUE tier, one per Pokémon (the user: "속임수주사위도 로그 등급으로
 * 넣어두죠"): the main-series item. 2-5-hit moves hit 4 or 5 times; Triple Kick / Triple Axel / Population Bomb check
 * accuracy once and Population Bomb hits 4-10 times; Skill Link still wins (battle-held-items.ts).
 */
export class LoadedDiceModifier extends BattleRuleHeldItemModifier {
  override get battleItem(): BattleItemKind {
    return "loadedDice";
  }

  override clone(): LoadedDiceModifier {
    return new LoadedDiceModifier(this.type, this.pokemonId, this.stackCount);
  }
}

/**
 * Local fork (2026-11-11): Seed Pouch (씨앗주머니), ROGUE tier, one per Pokémon (the user: "풀타입 포켓몬이 지닐 시 씨뿌리기
 * 효과와 동일한 효과를 내도록(풀타입 없으면 애초에 안나오도록), 로그 등급으로, 최대 1개"). While a Grass-type holder is on the
 * field, every opposing Pokémon on the field gets the real Leech Seed with the holder as its source: the ones out when it
 * comes in and every one that comes in later (`applySeedPouchOnEntry`, battle-held-items.ts). A holder that is not a
 * Grass type (or Terastallized out of Grass) does nothing.
 */
export class SeedPouchModifier extends BattleRuleHeldItemModifier {
  override get battleItem(): BattleItemKind {
    return "seedPouch";
  }

  override clone(): SeedPouchModifier {
    return new SeedPouchModifier(this.type, this.pokemonId, this.stackCount);
  }
}

/**
 * Local fork (2026-11-11): Expert Belt (달인의띠), ROGUE tier, one per Pokémon (the user: "저희 달인의띠 넣어뒀나요? 없다면 로그
 * 등급으로, 최대 1개로 넣어두죠"; it was not in the fork): super-effective hits deal x1.2 (`applyExpertBeltDamage`,
 * battle-held-items.ts).
 */
export class ExpertBeltModifier extends BattleRuleHeldItemModifier {
  override get battleItem(): BattleItemKind {
    return "expertBelt";
  }

  override clone(): ExpertBeltModifier {
    return new ExpertBeltModifier(this.type, this.pokemonId, this.stackCount);
  }
}

/**
 * Local fork (2026-11-11): Precision Lens (정밀렌즈), ROGUE tier, up to 2 (the user: "급소를 맞췄을때 추가 데미지가
 * 증가하도록, 20/30%. … 1/2개일때 1.7/1.8배의 데미지"): a critical hit deals x1.7 / x1.8 instead of x1.5, Sniper's x1.5 on top;
 * the critical-hit rate is unchanged (`getCriticalHitMultiplier`, battle-held-items.ts). Not a Scope Lens: it never
 * stacks with or is capped against one.
 */
export class PrecisionLensModifier extends BattleRuleHeldItemModifier {
  override get battleItem(): BattleItemKind {
    return "precisionLens";
  }

  override clone(): PrecisionLensModifier {
    return new PrecisionLensModifier(this.type, this.pokemonId, this.stackCount);
  }
}

/**
 * Local fork (2026-11-11): Fuel (연료), ULTRA tier, up to 3 (the user: "불타입이 지니면 공특공 1.1배. 최대 3개에 연료끼리는
 * 합연산"): a Fire-type holder (as in battle: Terastallized out of Fire gets nothing, a Stellar Tera keeps its types) has
 * Attack and Sp. Atk x1.1 / 1.2 / 1.3 for 1 / 2 / 3 held, added up, worked in tenths (`value * 12 / 10`) so a whole stat
 * comes out exact. An effective-stat multiplier like the vests, so the summary shows it in green; nothing for other
 * types. Only stacks with (and is capped against) other fuel. Transferable and stealable; saves keep the holder's id.
 */
export class FuelModifier extends StatBoosterModifier implements BattleHeldItem {
  public readonly battleItem: BattleItemKind = BATTLE_HELD_ITEMS.FUEL.kind;

  constructor(type: ModifierType, pokemonId: number, stackCount?: number) {
    // `multiplier` (one fuel's x1.1) is only kept for the base class; `apply` goes by the stack count, in tenths
    super(type, pokemonId, [...BATTLE_HELD_ITEMS.FUEL.stats], getFuelTenths(1) / 10, stackCount);
  }

  /** Only for a Fire-type holder */
  override shouldApply(pokemon: Pokemon, stat: Stat, statValue: NumberHolder): boolean {
    return super.shouldApply(pokemon, stat, statValue) && isFuelBurner(pokemon);
  }

  override apply(_pokemon: Pokemon, _stat: Stat, statValue: NumberHolder): boolean {
    statValue.value = (statValue.value * getFuelTenths(this.getStackCount())) / 10;
    return true;
  }

  override matchType(modifier: Modifier): boolean {
    return modifier instanceof FuelModifier;
  }

  override clone(): FuelModifier {
    return new FuelModifier(this.type, this.pokemonId, this.stackCount);
  }

  /** Only the holder's id is saved; the stats and multipliers come from the table */
  override getArgs(): any[] {
    return [this.pokemonId];
  }

  override getMaxHeldItemCount(_pokemon?: Pokemon): number {
    return BATTLE_HELD_ITEMS.FUEL.maxHeld;
  }
}

/*
 * Local fork (2026-11-11), the third batch of battle-held-items.ts. The user: "클리어참 / 부스트에너지 추가해두죠. 클리어참은
 * 효과 그대로 로그 등급, 부스트에너지(로그)는 일반 포켓몬이 가지고있으면 가장 높은 능력 1.2배, 패러독스 포켓몬(코라미라이돈
 * 포함)은 1.5배. 목스프레이(전투당 한번, 소리 기술 사용 시 특수공격 +1)도 넣어둡시다, 하이퍼 정도가 적당하겠네요. 힘의머리띠 /
 * 박식안경도 하이퍼 등급으로 넣어두죠". One per Pokémon each, transferable and stealable; saves keep only the holder's id.
 */

/**
 * Local fork (2026-11-11): Clear Amulet (클리어참), ROGUE tier, one per Pokémon: other Pokémon's moves and abilities cannot
 * lower its holder's stats (Intimidate, Growl, Icy Wind, Sticky Web ...); its own drops (Close Combat) still apply
 * (`applyClearAmulet`, battle-held-items.ts). Not used up.
 */
export class ClearAmuletModifier extends BattleRuleHeldItemModifier {
  override get battleItem(): BattleItemKind {
    return "clearAmulet";
  }

  override clone(): ClearAmuletModifier {
    return new ClearAmuletModifier(this.type, this.pokemonId, this.stackCount);
  }
}

/**
 * Local fork (2026-11-11): Throat Spray (목스프레이), ULTRA tier, one per Pokémon: once per battle (wave), after the holder
 * used a sound move, its Sp. Atk +1. Not used up (`tryThroatSpray`, battle-held-items.ts).
 */
export class ThroatSprayModifier extends BattleRuleHeldItemModifier {
  override get battleItem(): BattleItemKind {
    return "throatSpray";
  }

  override clone(): ThroatSprayModifier {
    return new ThroatSprayModifier(this.type, this.pokemonId, this.stackCount);
  }
}

/**
 * Local fork (2026-11-11): Muscle Band (힘의머리띠), ULTRA tier, up to 99 like the type boosters: physical moves x1.1
 * power per band, added up (`applyCategoryBandPower`, battle-held-items.ts)
 */
export class MuscleBandModifier extends BattleRuleHeldItemModifier {
  override get battleItem(): BattleItemKind {
    return "muscleBand";
  }

  override clone(): MuscleBandModifier {
    return new MuscleBandModifier(this.type, this.pokemonId, this.stackCount);
  }
}

/**
 * Local fork (2026-11-11): Wise Glasses (박식안경), ULTRA tier, up to 99 like the type boosters: special moves x1.1 power
 * per pair, added up (`applyCategoryBandPower`, battle-held-items.ts)
 */
export class WiseGlassesModifier extends BattleRuleHeldItemModifier {
  override get battleItem(): BattleItemKind {
    return "wiseGlasses";
  }

  override clone(): WiseGlassesModifier {
    return new WiseGlassesModifier(this.type, this.pokemonId, this.stackCount);
  }
}

/**
 * Local fork (2026-11-11): Booster Energy (부스트에너지), ROGUE tier, one per Pokémon, not used up (the user: "일반
 * 포켓몬이 가지고있으면 가장 높은 능력 1.2배, 패러독스 포켓몬(코라미라이돈 포함)은 1.5배"). Its holder's highest stat among
 * Attack / Defense / Sp. Atk / Sp. Def / Speed ({@linkcode getHighestStat}: Protosynthesis' rule, stat stages counted,
 * read again whenever the stat is) is x1.2, or x1.5 for a Paradox Pokémon, Koraidon and Miraidon included
 * (`isBoosterEnergyParadox`), worked in tenths like Fuel. An effective-stat multiplier like the vests, so the summary shows
 * the boosted stat in green. It does not start Protosynthesis / Quark Drive (the main-series item's effect); when one of
 * them boosts the same stat, both apply. Only stacks with (and is capped against) another Booster Energy.
 */
export class BoosterEnergyModifier extends StatBoosterModifier implements BattleHeldItem {
  public readonly battleItem: BattleItemKind = BATTLE_HELD_ITEMS.BOOSTER_ENERGY.kind;

  constructor(type: ModifierType, pokemonId: number, stackCount?: number) {
    // `stats` lists every stat it may boost and `multiplier` is x1.2, only kept for the base class; `shouldApply` picks
    // the stat and `apply` the tenths for the holder
    super(type, pokemonId, [...EFFECTIVE_STATS], BATTLE_HELD_ITEMS.BOOSTER_ENERGY.tenths / 10, stackCount);
  }

  /** Only the holder's highest stat */
  override shouldApply(pokemon: Pokemon, stat: Stat, statValue: NumberHolder): boolean {
    return super.shouldApply(pokemon, stat, statValue) && stat === getHighestStat(pokemon);
  }

  override apply(pokemon: Pokemon, _stat: Stat, statValue: NumberHolder): boolean {
    statValue.value = (statValue.value * getBoosterEnergyTenths(pokemon)) / 10;
    return true;
  }

  override matchType(modifier: Modifier): boolean {
    return modifier instanceof BoosterEnergyModifier;
  }

  override clone(): BoosterEnergyModifier {
    return new BoosterEnergyModifier(this.type, this.pokemonId, this.stackCount);
  }

  /** Only the holder's id is saved; the stats and multipliers come from the table */
  override getArgs(): any[] {
    return [this.pokemonId];
  }

  override getMaxHeldItemCount(_pokemon?: Pokemon): number {
    return BATTLE_HELD_ITEMS.BOOSTER_ENERGY.maxHeld;
  }
}

/** Local fork (2026-11-11): the luck scale (D … SSS) stops at 14, for the party's luck with or without clovers */
export const MAX_PARTY_LUCK = 14;

/**
 * Local fork (2026-11-11): every number of the luck clovers, by modifier type id. The user: "네잎클로버 잎(슈퍼, 4개
 * 모으면 행운 +1, 황금몬스터볼, 검은오물, 치유의부적처럼 모을 수 있는 형태의 아이템, 최대 4개) / 네잎클로버(하이퍼, 행운
 * +1, 역시나 판정 동일, 최대 3) / 황금 네잎클로버(로그, 행운+3, 최대 2개)".
 * - `maxStack`: how many the party can have;
 * - luck = `floor(stack / stacksPerLuck) * luckPerStep` ({@linkcode getCloverLuck}): the leaf gives +1 only with all 4;
 * - `poolWeight`: the player's reward pool weight (GREAT / ULTRA / ROGUE) while it would still do something
 *   (init-modifier-pools.ts).
 */
export const LUCK_CLOVERS = Object.freeze({
  FOUR_LEAF_CLOVER_LEAF: Object.freeze({ maxStack: 4, stacksPerLuck: 4, luckPerStep: 1, poolWeight: 3 }),
  FOUR_LEAF_CLOVER: Object.freeze({ maxStack: 3, stacksPerLuck: 1, luckPerStep: 1, poolWeight: 3 }),
  GOLDEN_FOUR_LEAF_CLOVER: Object.freeze({ maxStack: 2, stacksPerLuck: 1, luckPerStep: 3, poolWeight: 2 }),
});

export type LuckCloverId = keyof typeof LUCK_CLOVERS;

/** Local fork (2026-11-11): whether `typeId` is one of the luck clovers */
export function isLuckCloverId(typeId: string): typeId is LuckCloverId {
  return Object.hasOwn(LUCK_CLOVERS, typeId);
}

/**
 * Local fork (2026-11-11): the luck `stackCount` clovers of `id` give, before the party's cap of
 * {@linkcode MAX_PARTY_LUCK}: leaves 0/0/0/1 for 1-4, clovers 1/2/3, golden clovers 3/6
 */
export function getCloverLuck(id: LuckCloverId, stackCount: number): number {
  const { maxStack, stacksPerLuck, luckPerStep } = LUCK_CLOVERS[id];
  return Math.floor(Math.min(Math.max(stackCount, 0), maxStack) / stacksPerLuck) * luckPerStep;
}

/**
 * Local fork (2026-11-11): the luck clovers (네잎클로버 잎 / 네잎클로버 / 황금 네잎클로버), party items like the Golden Poké
 * Ball and the Healing Charm: one stack each in the party's item bar, kept in session saves. Their luck adds to the
 * party's shiny luck in `getPartyLuckValue` (modifier-type.ts), capped at {@linkcode MAX_PARTY_LUCK}, so every luck
 * reader (the luck shown on the reward screen, the reward tier upgrade rolls, wild species rarity, encounters) gets it.
 */
export abstract class LuckCloverModifier extends PersistentModifier {
  /** The clover's type id, the key of its row in {@linkcode LUCK_CLOVERS} */
  abstract get cloverId(): LuckCloverId;

  override match(modifier: Modifier): boolean {
    return modifier instanceof LuckCloverModifier && modifier.cloverId === this.cloverId;
  }

  /** The luck this stack gives, before the party's cap */
  getLuck(): number {
    return getCloverLuck(this.cloverId, this.getStackCount());
  }

  /**
   * @param luck - The party's luck so far, raised in place
   * @returns always `true`
   */
  override apply(luck: NumberHolder): boolean {
    luck.value += this.getLuck();
    return true;
  }

  override getMaxStackCount(): number {
    return LUCK_CLOVERS[this.cloverId].maxStack;
  }
}

/** Local fork (2026-11-11): 네잎클로버 잎 (Four-Leaf Clover Leaf), GREAT tier, up to 4: luck +1 once all 4 are collected */
export class FourLeafCloverLeafModifier extends LuckCloverModifier {
  override get cloverId(): LuckCloverId {
    return "FOUR_LEAF_CLOVER_LEAF";
  }

  override clone(): FourLeafCloverLeafModifier {
    return new FourLeafCloverLeafModifier(this.type, this.stackCount);
  }
}

/** Local fork (2026-11-11): 네잎클로버 (Four-Leaf Clover), ULTRA tier, up to 3: luck +1 each */
export class FourLeafCloverModifier extends LuckCloverModifier {
  override get cloverId(): LuckCloverId {
    return "FOUR_LEAF_CLOVER";
  }

  override clone(): FourLeafCloverModifier {
    return new FourLeafCloverModifier(this.type, this.stackCount);
  }
}

/** Local fork (2026-11-11): 황금 네잎클로버 (Golden Four-Leaf Clover), ROGUE tier, up to 2: luck +3 each */
export class GoldenFourLeafCloverModifier extends LuckCloverModifier {
  override get cloverId(): LuckCloverId {
    return "GOLDEN_FOUR_LEAF_CLOVER";
  }

  override clone(): GoldenFourLeafCloverModifier {
    return new GoldenFourLeafCloverModifier(this.type, this.stackCount);
  }
}

/**
 * Local fork (2026-11-11): the luck all of the player's clovers give together, before the party's cap (the caller adds
 * it to the shiny luck and caps the sum at {@linkcode MAX_PARTY_LUCK})
 */
export function getPartyCloverLuck(): number {
  const luck = new NumberHolder(0);
  for (const clover of globalScene.findModifiers(m => m instanceof LuckCloverModifier, true)) {
    (clover as LuckCloverModifier).apply(luck);
  }
  return luck.value;
}

const customModifierClasses: Readonly<Record<string, new (...args: any[]) => PersistentModifier>> = Object.freeze({
  AssaultVestModifier,
  BoosterEnergyModifier, // Local fork (2026-11-11)
  BulletproofVestModifier,
  ChampionBeltModifier, // Local fork (2026-11-12)
  ChoiceArmorModifier, // Local fork (2026-11-09)
  ChoiceItemModifier, // Local fork (2026-11-09)
  ClearAmuletModifier, // Local fork (2026-11-11)
  DischargedCoilModifier, // Local fork (2026-11-10)
  EvItemModifier, // Local fork (2026-11-12)
  EvolutionCrystalModifier, // Local fork (2026-11-09)
  ExpertBeltModifier, // Local fork (2026-11-11)
  FlameCauldronModifier, // Local fork (2026-11-09)
  FlameFurnaceModifier, // Local fork (2026-11-10)
  ForgedSteelModifier, // Local fork (2026-11-08)
  FourLeafCloverLeafModifier, // Local fork (2026-11-11)
  FourLeafCloverModifier, // Local fork (2026-11-11)
  FuelModifier, // Local fork (2026-11-11)
  GoldenFourLeafCloverModifier, // Local fork (2026-11-11)
  IvCandyModifier,
  LifeOrbModifier,
  WeightBandModifier, // Local fork (2026-11-12)
  LoadedDiceModifier, // Local fork (2026-11-11)
  MasterPunchingGloveModifier, // Local fork (2026-11-11)
  MetronomeModifier, // Local fork (2026-11-11)
  MuscleBandModifier, // Local fork (2026-11-11)
  PowerHerbModifier, // Local fork (2026-11-11)
  PrecisionLensModifier, // Local fork (2026-11-11)
  PrismModifier,
  PunchingGloveModifier, // Local fork (2026-11-11)
  RadioactiveWasteModifier, // Local fork (2026-11-09)
  SeedPouchModifier, // Local fork (2026-11-11)
  SuperconductingCoilModifier, // Local fork (2026-11-10)
  ThroatSprayModifier, // Local fork (2026-11-11)
  ToxicDistillateModifier, // Local fork (2026-11-10)
  ToxicDistillerModifier, // Local fork (2026-11-10)
  TrainingShacklesModifier, // Local fork (2026-11-09)
  UltimateGeneModifier, // Local fork (2026-11-09)
  WiseGlassesModifier, // Local fork (2026-11-11)
  ZRingModifier, // Local fork (2026-11-16): Z링 (zmax-items.ts)
});

/**
 * Look up one of this file's modifier classes by its class name, the way save data refers to it
 * (`ModifierData.className`).
 * @param className - The constructor name stored in the session save
 * @returns The class, or `undefined` when the name is not one of ours
 */
export function getCustomModifierClass(className: string): (new (...args: any[]) => PersistentModifier) | undefined {
  return customModifierClasses[className];
}
