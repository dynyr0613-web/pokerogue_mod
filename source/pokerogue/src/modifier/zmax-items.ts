/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Local fork (2026-11-16): the rewards of the Z-Moves and Max Moves: Z링 (Z-Ring), Z크리스탈 (Z crystals) and 다이사탕
 * (Dynamax Candy). The user:
 * - "다이맥스한 포켓몬이 있을 경우 다이사탕(하이퍼)이 보상 테이블에서 나올 수 있음 / 다이사탕 사용 시 원하는 기술을 다이
 *   기술로 바꿈 / 해당 포켓몬의 전용기는 거다이 기술로 바꿈 (멜메탈: 불릿펀치 -> 다이스틸, 더블펀처 -> 거다이융격) /
 *   전용기가 없는 거다이 포켓몬은 그냥 거다이맥스 기술의 타입 기술이 거다이 기술로 바뀜"
 * - "z링 보유 시 + 해당 타입 기술 보유 포켓몬이 있는 경우(거다이맥스 기술 제외) Z 크리스탈이 보상 테이블에 등록됨 / z
 *   크리스탈 사용 시 해당 타입 기술을 z기술로 변환 / 전용 z 크리스탈은 해당 타입의 기술을 전용 z기술로 변환"
 *
 * - Z링: a ROGUE key item like the Dynamax Band (never twice). It only opens the Z crystals.
 * - 다이사탕: an ULTRA consumable, offered while a party member is Dynamaxed (`Pokemon.isDynamaxed()`, 2026-11-18: a
 *   G-Max form or the Dynamax state) and some party move can take it. Any party member can use it.
 * - Z크리스탈: an ULTRA consumable, one reward id (`Z_CRYSTAL`) whose generator picks a type crystal (노말Z ...) or a
 *   species-exclusive one (피카츄Z ...), weighted by the party's eligible moves ({@linkcode getZCrystalCandidates}).
 * - Using the candy or a crystal converts one move slot for good: `PokemonMove.transform` (move-transform.ts, which also
 *   holds every eligibility rule). The use flow is the Master TM's: party screen, then the move picker
 *   (`#ui/move-conversion-picker`), then yes / no; nothing is used before yes.
 *
 * The numbers are in {@linkcode ZMAX_REWARD_RULES}. Consumables are never saved, so only {@linkcode ZRingModifier} is in
 * the save registry (`customModifierClasses`, custom-held-items.ts).
 */

import { globalScene } from "#app/global-scene";
import { initMoveAnim, loadMoveAnimAssets } from "#data/battle-anims";
import { allMoves } from "#data/data-lists";
import { PokemonType } from "#enums/pokemon-type";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { ConsumablePokemonMoveModifier, PersistentModifier } from "#modifiers/modifier";
import type { ModifierType } from "#modifiers/modifier-type";
import type * as MoveTransformModule from "#moves/move-transform";
import type { ConversionItem, MoveTransform } from "#moves/move-transform";
import type { PokemonMove } from "#moves/pokemon-move";
import { EXCLUSIVE_Z, type ExclusiveZInfo } from "#moves/zmax-data";
import { randSeedInt } from "#utils/common";

/**
 * Local fork (2026-11-16): the reward numbers of the Z-Ring, the Dynamax Candy and the Z crystals (design_spec §5 / §7b).
 * - `zRing`: the Dynamax Band's ROGUE rule, `min(ceil(wave / 50), 4) * 9` (max 36); a key item, so it leaves the pool
 *   once owned.
 * - `dynamaxCandy`: ULTRA weight 6 (like the Punching Glove and Throat Spray) while a party member is Dynamaxed and some
 *   party move can take it.
 * - `zCrystal`: ULTRA weight 8 while the Z-Ring is owned and a crystal can be used. The generator weighs each type crystal
 *   by the party's eligible moves of that type (at most `typeCap`, like the type boosters) and each exclusive crystal by
 *   `exclusiveMultiplier` x the eligible moves of its species.
 */
export const ZMAX_REWARD_RULES = Object.freeze({
  zRing: Object.freeze({ weightPerStep: 9, wavesPerStep: 50, maxSteps: 4, maxWeight: 36 }),
  dynamaxCandy: Object.freeze({ weight: 6 }),
  zCrystal: Object.freeze({ weight: 8, typeCap: 3, exclusiveMultiplier: 3 }),
});

/** Local fork (2026-11-16): the Z-Ring's ROGUE weight at `waveIndex` (the Dynamax Band's rule) */
export function getZRingWeight(waveIndex: number): number {
  const { weightPerStep, wavesPerStep, maxSteps } = ZMAX_REWARD_RULES.zRing;
  return Math.min(Math.ceil(waveIndex / wavesPerStep), maxSteps) * weightPerStep;
}

// #region Conversion rules

/**
 * Local fork (2026-11-16): the per-slot conversion rules of move-transform.ts that the rewards use. This file is
 * imported by modifier-type.ts and custom-held-items.ts, which move.ts reaches through the ability code, and
 * move-transform.ts imports move.ts: a static import here would close an import cycle. So `initModifierPools`
 * (init-modifier-pools.ts, outside the cycle) registers them at startup, before any reward is rolled, the way
 * `#data/data-lists` is filled.
 */
export type ZMaxConversionRules = Pick<
  typeof MoveTransformModule,
  "canSlotTakeItem" | "getAnimMoveId" | "getConversionResult" | "getTransformedMove" | "isExclusiveZEligibleSpecies"
>;

let conversionRules: ZMaxConversionRules | null = null;

/** Local fork (2026-11-16): called once by `initModifierPools` with move-transform.ts's functions */
export function registerZMaxConversionRules(registered: ZMaxConversionRules): void {
  conversionRules = registered;
}

/** Local fork (2026-11-16): the registered conversion rules (see {@linkcode ZMaxConversionRules}) */
function rules(): ZMaxConversionRules {
  if (!conversionRules) {
    throw new Error("Z/Max conversion rules used before initModifierPools registered them");
  }
  return conversionRules;
}

/** Local fork (2026-11-16): move-transform's `canSlotTakeItem` (slot state and type only; the move screen's filter) */
export function canSlotTakeConversion(slot: PokemonMove, item: ConversionItem): boolean {
  return rules().canSlotTakeItem(slot, item);
}

// #endregion Conversion rules

// #region Z-Ring

/**
 * Local fork (2026-11-16): Z링 (Z-Ring), a key item like the Dynamax Band: with it the Z crystals can be offered
 * ("z링 보유 시 ... Z 크리스탈이 보상 테이블에 등록됨"). One at most.
 */
export class ZRingModifier extends PersistentModifier {
  clone(): ZRingModifier {
    return new ZRingModifier(this.type, this.stackCount);
  }

  apply(..._args: unknown[]): boolean {
    return true;
  }

  getMaxStackCount(): number {
    return 1;
  }
}

/** Local fork (2026-11-16): whether the player owns the Z-Ring */
export function hasZRing(): boolean {
  return globalScene.getModifiers(ZRingModifier).length > 0;
}

// #endregion Z-Ring

// #region Conversion items

/** Local fork (2026-11-16): the Dynamax Candy as a conversion item (move-transform.ts) */
export const DYNAMAX_CANDY_ITEM: ConversionItem = Object.freeze({ kind: "candy" });

/**
 * Local fork (2026-11-16): which Z crystal a `Z_CRYSTAL` reward is: a {@linkcode PokemonType} for a type crystal (노말Z
 * ...), or the key of an exclusive one (`EXCLUSIVE_Z[].key`, "PIKANIUM_Z" ...). The generator's pregen argument.
 */
export type ZCrystalKey = PokemonType | string;

/** Local fork (2026-11-16): the 18 types with a type crystal, in the game's type order (no ??? or Stellar) */
export const Z_TYPE_CRYSTAL_TYPES: readonly PokemonType[] = Object.freeze([
  PokemonType.NORMAL,
  PokemonType.FIGHTING,
  PokemonType.FLYING,
  PokemonType.POISON,
  PokemonType.GROUND,
  PokemonType.ROCK,
  PokemonType.BUG,
  PokemonType.GHOST,
  PokemonType.STEEL,
  PokemonType.FIRE,
  PokemonType.WATER,
  PokemonType.GRASS,
  PokemonType.ELECTRIC,
  PokemonType.PSYCHIC,
  PokemonType.ICE,
  PokemonType.DRAGON,
  PokemonType.DARK,
  PokemonType.FAIRY,
]);

/** Local fork (2026-11-16): the item atlas frame of each type crystal (placeholder recolours, tools/port_zmax_1116) */
export const Z_TYPE_CRYSTAL_ICONS: Readonly<Partial<Record<PokemonType, string>>> = Object.freeze({
  [PokemonType.NORMAL]: "normalium_z",
  [PokemonType.FIGHTING]: "fightinium_z",
  [PokemonType.FLYING]: "flyinium_z",
  [PokemonType.POISON]: "poisonium_z",
  [PokemonType.GROUND]: "groundium_z",
  [PokemonType.ROCK]: "rockium_z",
  [PokemonType.BUG]: "buginium_z",
  [PokemonType.GHOST]: "ghostium_z",
  [PokemonType.STEEL]: "steelium_z",
  [PokemonType.FIRE]: "firium_z",
  [PokemonType.WATER]: "waterium_z",
  [PokemonType.GRASS]: "grassium_z",
  [PokemonType.ELECTRIC]: "electrium_z",
  [PokemonType.PSYCHIC]: "psychium_z",
  [PokemonType.ICE]: "icium_z",
  [PokemonType.DRAGON]: "dragonium_z",
  [PokemonType.DARK]: "darkinium_z",
  [PokemonType.FAIRY]: "fairium_z",
});

/** Local fork (2026-11-16): the exclusive crystal with key `key`, if there is one */
export function getExclusiveZInfo(key: string): ExclusiveZInfo | undefined {
  return EXCLUSIVE_Z.find(info => info.key === key);
}

/** Local fork (2026-11-16): whether `value` names a Z crystal (a type with a crystal or an exclusive key) */
export function isZCrystalKey(value: unknown): value is ZCrystalKey {
  if (typeof value === "number") {
    return Z_TYPE_CRYSTAL_TYPES.includes(value as PokemonType);
  }
  return typeof value === "string" && getExclusiveZInfo(value) !== undefined;
}

/** Local fork (2026-11-16): whether `crystal` is an exclusive crystal */
export function isExclusiveZCrystal(crystal: ZCrystalKey): crystal is string {
  return typeof crystal === "string";
}

/** Local fork (2026-11-16): the conversion item of Z crystal `crystal` */
export function getZCrystalItem(crystal: ZCrystalKey): ConversionItem {
  return isExclusiveZCrystal(crystal) ? { kind: "zExclusive", key: crystal } : { kind: "zType", type: crystal };
}

/** Local fork (2026-11-16): the move type Z crystal `crystal` works on */
export function getZCrystalType(crystal: ZCrystalKey): PokemonType {
  return isExclusiveZCrystal(crystal) ? (getExclusiveZInfo(crystal)?.type ?? PokemonType.UNKNOWN) : crystal;
}

/** Local fork (2026-11-16): the item atlas frame of Z crystal `crystal` */
export function getZCrystalIcon(crystal: ZCrystalKey): string {
  return isExclusiveZCrystal(crystal)
    ? (getExclusiveZInfo(crystal)?.icon ?? "normalium_z")
    : (Z_TYPE_CRYSTAL_ICONS[crystal] ?? "normalium_z");
}

/**
 * Local fork (2026-11-16): the conversion `item` would make on move slot `moveIndex` of `pokemon`'s own (saved) moveset,
 * or `null` when it cannot be used there. The permanent moveset, not `getMoveset()`: a Pokémon still transformed at the
 * reward screen keeps its own moves (see `MoveConversionModifier`).
 */
export function getSlotConversion(pokemon: Pokemon, moveIndex: number, item: ConversionItem): MoveTransform | null {
  const slot: PokemonMove | undefined = pokemon.moveset[moveIndex];
  return slot ? rules().getConversionResult(pokemon, slot, item) : null;
}

/** Local fork (2026-11-16): whether `item` can be used on at least one of `pokemon`'s moves (the party screen filter) */
export function canUseConversionItem(pokemon: Pokemon, item: ConversionItem): boolean {
  return pokemon.moveset.some((slot, i) => !!slot && getSlotConversion(pokemon, i, item) !== null);
}

/**
 * Local fork (2026-11-16): why a conversion item cannot be used on a move slot, for the move picker's text
 * (`<item locale key>.reason.<reason>`):
 * - `maxMove`: candy on a Max / G-Max Move ("already a Max Move"); exclusive crystal on a Max Move;
 * - `converted`: candy on an exclusive Z-Move or a Z-Max Move (nothing further);
 * - `wrongType`: a crystal on a move whose own type is not the crystal's;
 * - `gmax`: a crystal on a G-Max Move ("거다이맥스 기술 제외");
 * - `zMove`: a crystal on a Z-Move, an exclusive Z-Move or a Z-Max Move;
 * - `wrongSpecies`: an exclusive crystal on a Pokémon of another species;
 * - `cannot`: any other move the item cannot convert.
 *
 * Review fix (2026-11-16): no `status` reason any more, an exclusive crystal converts status moves of its type too.
 */
export type ConversionBlockReason =
  | "maxMove"
  | "converted"
  | "wrongType"
  | "gmax"
  | "zMove"
  | "wrongSpecies"
  | "cannot";

/**
 * Local fork (2026-11-16): why `item` cannot convert `slot` of `pokemon` (design_spec §3), or `null` when it can.
 * The rules themselves are `getConversionResult`'s (move-transform.ts); this only names the reason.
 */
export function getConversionBlockReason(
  pokemon: Pokemon,
  slot: PokemonMove,
  item: ConversionItem,
): ConversionBlockReason | null {
  if (rules().getConversionResult(pokemon, slot, item)) {
    return null;
  }
  const kind = slot.transform?.kind;
  if (item.kind === "candy") {
    if (kind === "max" || kind === "gmax") {
      return "maxMove";
    }
    return kind ? "converted" : "cannot";
  }
  const type = item.kind === "zType" ? item.type : getZCrystalType(item.key);
  if (allMoves[slot.moveId]?.type !== type) {
    return "wrongType";
  }
  if (kind === "gmax") {
    return "gmax";
  }
  if (kind === "z" || kind === "zExclusive" || kind === "zMax") {
    return "zMove";
  }
  if (kind === "max") {
    return "maxMove";
  }
  if (item.kind === "zExclusive" && !rules().isExclusiveZEligibleSpecies(pokemon, item.key)) {
    return "wrongSpecies";
  }
  return "cannot";
}

// #endregion Conversion items

// #region Reward weights

/**
 * Local fork (2026-11-16): the Dynamax Candy's ULTRA weight: {@linkcode ZMAX_REWARD_RULES}.dynamaxCandy while one of the
 * player's Pokémon is Dynamaxed ("다이맥스한 포켓몬이 있을 경우") and some player Pokémon has a move it can convert,
 * else 0. Local fork (2026-11-18): Dynamaxed in any way (`Pokemon.isDynamaxed`): a G-Max / E-Max form or the Dynamax
 * state of Max Mushrooms without one (pokemon-forms-dynamax.ts).
 */
export function getDynamaxCandyWeight(party: readonly Pokemon[]): number {
  const players = party.filter(p => p.isPlayer());
  const offered = players.some(p => p.isDynamaxed()) && players.some(p => canUseConversionItem(p, DYNAMAX_CANDY_ITEM));
  return offered ? ZMAX_REWARD_RULES.dynamaxCandy.weight : 0;
}

/**
 * Local fork (2026-11-16): the Z crystals the `Z_CRYSTAL` generator can offer `party` and their weights, in party / move
 * order. The Z-Ring is not checked here (see {@linkcode getZCrystalWeight} and {@linkcode pickZCrystal}).
 * - Type crystal T: +1 for each party move slot of base type T that a T crystal can convert (a plain move to a Z-Move,
 *   a Max Move to a Z-Max Move; G-Max moves never: "거다이맥스 기술 제외"), at most
 *   {@linkcode ZMAX_REWARD_RULES}.zCrystal.typeCap.
 * - Exclusive crystal: +{@linkcode ZMAX_REWARD_RULES}.zCrystal.exclusiveMultiplier for each such slot of a Pokémon of its
 *   species ("전용 z 크리스탈은 해당 타입의 기술을 전용 z기술로 변환").
 * Only the player's Pokémon allowed in the run's challenges count (like the type boosters).
 */
export function getZCrystalCandidates(party: readonly Pokemon[]): Map<ZCrystalKey, number> {
  const { typeCap, exclusiveMultiplier } = ZMAX_REWARD_RULES.zCrystal;
  const weights = new Map<ZCrystalKey, number>();
  for (const p of party) {
    if (!p.isPlayer() || !p.isAllowedInChallenge()) {
      continue;
    }
    const exclusives = EXCLUSIVE_Z.filter(info => rules().isExclusiveZEligibleSpecies(p, info.key));
    p.moveset.forEach((slot, i) => {
      if (!slot) {
        return;
      }
      const type = allMoves[slot.moveId]?.type;
      if (
        type !== undefined
        && Z_TYPE_CRYSTAL_TYPES.includes(type)
        && getSlotConversion(p, i, { kind: "zType", type })
      ) {
        weights.set(type, Math.min((weights.get(type) ?? 0) + 1, typeCap));
      }
      for (const info of exclusives) {
        if (getSlotConversion(p, i, { kind: "zExclusive", key: info.key })) {
          weights.set(info.key, (weights.get(info.key) ?? 0) + exclusiveMultiplier);
        }
      }
    });
  }
  return weights;
}

/**
 * Local fork (2026-11-16): the Z crystal's ULTRA weight: {@linkcode ZMAX_REWARD_RULES}.zCrystal while the Z-Ring is owned
 * and some crystal can be used ("z링 보유 시 + 해당 타입 기술 보유 포켓몬이 있는 경우"), else 0 (exactly when the
 * generator returns `null`, so a pick never burns retries)
 */
export function getZCrystalWeight(party: readonly Pokemon[]): number {
  return hasZRing() && getZCrystalCandidates(party).size > 0 ? ZMAX_REWARD_RULES.zCrystal.weight : 0;
}

/**
 * Local fork (2026-11-16): the `Z_CRYSTAL` generator's draw (seeded): one crystal of {@linkcode getZCrystalCandidates} by
 * weight, or `null` without the Z-Ring or without a candidate
 */
export function pickZCrystal(party: readonly Pokemon[]): ZCrystalKey | null {
  if (!hasZRing()) {
    return null;
  }
  const weights = getZCrystalCandidates(party);
  let total = 0;
  for (const w of weights.values()) {
    total += w;
  }
  if (total <= 0) {
    return null;
  }
  let roll = randSeedInt(total);
  for (const [crystal, w] of weights) {
    if (roll < w) {
      return crystal;
    }
    roll -= w;
  }
  return null;
}

// #endregion Reward weights

// #region Conversion modifier

/**
 * Local fork (2026-11-16): the effect of a used Dynamax Candy or Z crystal: move slot `moveIndex` of the chosen Pokémon
 * gets the conversion `item` makes there (`PokemonMove.transform`, kept for good and saved with the move). Made only
 * after the player said yes in the move picker; eligibility is checked again here.
 *
 * It writes to the Pokémon's own moveset (`pokemon.moveset`, the saved one), not `getMoveset()`: a Pokémon still
 * transformed at the reward screen would otherwise change a copied move. The converted move's animation is loaded
 * right away (like a newly learned move).
 */
export class MoveConversionModifier extends ConsumablePokemonMoveModifier {
  public readonly item: ConversionItem;

  constructor(type: ModifierType, pokemonId: number, moveIndex: number, item: ConversionItem) {
    super(type, pokemonId, moveIndex);
    this.item = item;
  }

  override shouldApply(playerPokemon?: PlayerPokemon, ...args: unknown[]): boolean {
    return (
      super.shouldApply(playerPokemon, ...args)
      && !!playerPokemon
      && getSlotConversion(playerPokemon, this.moveIndex, this.item) !== null
    );
  }

  override apply(playerPokemon: PlayerPokemon): boolean {
    const slot = playerPokemon.moveset[this.moveIndex];
    const result = getSlotConversion(playerPokemon, this.moveIndex, this.item);
    if (!slot || !result) {
      return false;
    }
    slot.transform = result;
    const animMoveId = rules().getAnimMoveId(rules().getTransformedMove(slot.moveId, result));
    initMoveAnim(animMoveId).then(() => loadMoveAnimAssets([animMoveId], true));
    return true;
  }
}

// #endregion Conversion modifier
