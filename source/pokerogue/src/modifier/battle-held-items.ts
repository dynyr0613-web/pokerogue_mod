/**
 * Local fork (2026-11-11): the battle rules of seven held items. The user: "로그 등급에 파워풀허브도 넣어두죠, 전투당
 * 개수만큼 발동할 수 있고, 최대 2개까지 / 메트로놈도 넣어두죠, 하이퍼 등급, 최대 3개, 증가치는 10/15/20%로 / 속임수주사위도
 * 로그 등급으로 넣어두죠 / 씨앗주머니(열매주머니의 색깔을 조금 다르게 해서 제작)도 넣어둡시다, 풀타입 포켓몬이 지닐 시
 * 씨뿌리기 효과와 동일한 효과를 내도록(풀타입 없으면 애초에 안나오도록), 로그 등급으로, 최대 1개 / 연료(드럼통에 담긴 기름
 * 모양으로 합시다)도 넣어두죠, 하이퍼 등급으로, 불타입이 지니면 공특공 1.1배. 최대 3개에 연료끼리는 합연산. / 저희
 * 달인의띠 넣어뒀나요? 없다면 로그 등급으로, 최대 1개로 넣어두죠 / 초점렌즈 색깔을 좀 바꿔서 로그 등급으로 『 정밀렌즈 』
 * 넣어두죠, 급소를 맞췄을때 추가 데미지가 증가하도록, 20/30%. 급소 데미지가 원래도 1.5배이니 1/2개일때 1.7/1.8배의 데미지가
 * 들어가겠네요".
 *
 * - 파워풀허브 (Power Herb): not used up; per battle (wave) its holder skips the charging turn of a two-turn move as many
 *   times as it holds herbs ({@linkcode tryPowerHerbCharge}, `MoveChargePhase`).
 * - 메트로놈 (Metronome): each consecutive use of the same move +10/15/20% power for 1/2/3 held, at most 5 steps
 *   ({@linkcode applyMetronomePower}, `Move.calculateBattlePower`).
 * - 속임수주사위 (Loaded Dice): 2-5-hit moves hit 4 or 5 times; Triple Kick / Triple Axel / Population Bomb check
 *   accuracy once, and Population Bomb hits 4-10 times (`MultiHitAttr`, `MoveEffectPhase.hitCheck`).
 * - 씨앗주머니 (Seed Pouch): a Grass-type holder on the field seeds every opposing Pokémon on the field with the real
 *   Leech Seed ({@linkcode applySeedPouchOnEntry}, `PostSummonPhase`).
 * - 연료 (Fuel): a Fire-type holder's Attack and Sp. Atk x1.1 / 1.2 / 1.3, added up (`FuelModifier` in
 *   custom-held-items.ts, an effective-stat multiplier).
 * - 달인의띠 (Expert Belt): super-effective hits deal x1.2 ({@linkcode applyExpertBeltDamage}, `Pokemon.getAttackDamage`).
 * - 정밀렌즈 (Precision Lens): a critical hit deals x1.7 / x1.8 instead of x1.5; Sniper's x1.5 goes on top
 *   ({@linkcode getCriticalHitMultiplier}, `Pokemon.getAttackDamage`).
 *
 * Local fork (2026-11-11), the third batch: five more held items, one per Pokémon each. The user: "클리어참 / 부스트에너지
 * 추가해두죠. 클리어참은 효과 그대로 로그 등급, 부스트에너지(로그)는 일반 포켓몬이 가지고있으면 가장 높은 능력 1.2배, 패러독스
 * 포켓몬(코라미라이돈 포함)은 1.5배. 목스프레이(전투당 한번, 소리 기술 사용 시 특수공격 +1)도 넣어둡시다, 하이퍼 정도가
 * 적당하겠네요. 힘의머리띠 / 박식안경도 하이퍼 등급으로 넣어두죠".
 *
 * - 클리어참 (Clear Amulet): the main-series item. Other Pokémon's moves and abilities cannot lower the holder's stats
 *   ({@linkcode applyClearAmulet}, `StatStageChangePhase`); its own drops (Close Combat, Superpower) still apply.
 * - 부스트에너지 (Booster Energy): not used up. The holder's highest stat x1.2, x1.5 for a Paradox Pokémon (Koraidon and
 *   Miraidon too) (`BoosterEnergyModifier` in custom-held-items.ts, an effective-stat multiplier; {@linkcode getHighestStat}).
 * - 목스프레이 (Throat Spray): not used up. Once per battle (wave), after the holder used a sound move, its Sp. Atk +1;
 *   not again while that +1 can still be there (after review) ({@linkcode tryThroatSpray}, `MoveEffectPhase.end`).
 * - 힘의머리띠 / 박식안경 (Muscle Band / Wise Glasses): physical / special moves x1.1 power
 *   ({@linkcode applyCategoryBandPower}, `Move.calculateBattlePower`).
 *
 * Like contact-gloves.ts, this module imports nothing from the modifier or move modules at run time: `Move`, `Pokemon`,
 * `MultiHitAttr`, `MoveEffectPhase` and the phases call it, and the item classes (custom-held-items.ts) carry the
 * {@linkcode BattleHeldItem.battleItem} marker so no `instanceof` is needed here. Player and enemy holders alike.
 */

import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { NON_LEGEND_PARADOX_POKEMON } from "#balance/special-species-groups"; // Local fork (2026-11-11): Booster Energy
import { allMoves } from "#data/data-lists";
// Local fork (2026-11-11), after review: Contrary for Clear Amulet, Sheer Force for Throat Spray
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category"; // Local fork (2026-11-11): Muscle Band / Wise Glasses
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { MultiHitType } from "#enums/multi-hit-type";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id"; // Local fork (2026-11-11): Booster Energy
// Local fork (2026-11-11): EFFECTIVE_STATS / getStatKey for Booster Energy and Throat Spray
import { EFFECTIVE_STATS, type EffectiveStat, getStatKey, Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import type { Move } from "#moves/move";
import type { StatChange } from "#types/stat-change"; // Local fork (2026-11-11): Clear Amulet
import { type NumberHolder, toDmgValue } from "#utils/common";
import i18next from "i18next";

/**
 * Local fork (2026-11-11): which of the items of this module a held item is (the marker {@linkcode BattleHeldItem}
 * carries): the seven of the second batch, then the five of the third
 */
export type BattleItemKind =
  | "powerHerb"
  | "metronome"
  | "loadedDice"
  | "seedPouch"
  | "fuel"
  | "expertBelt"
  | "precisionLens"
  | "clearAmulet"
  | "boosterEnergy"
  | "throatSpray"
  | "muscleBand"
  | "wiseGlasses";

/**
 * Local fork (2026-11-11): every number of the seven items (and of the five of the third batch, below), by modifier
 * type id.
 * - `maxHeld`: how many one Pokémon can hold (the user's 최대 2 / 3 / 1 / 1 / 3 / 1 / 2), the same for player and enemy;
 * - `poolWeight`: the player's reward pool weight (init-modifier-pools.ts), next to the items of the same tier: ROGUE
 *   held items sit at 3-5 (Leftovers 3, Scope Lens / Life Orb / Training Shackles 4, Focus Band / Grip Claw 5), the
 *   gated ULTRA Punching Glove at 6. Power Herb, Loaded Dice and Seed Pouch (4) and Fuel (6) only while some party
 *   member could use them, like the gloves and Radioactive Waste; Metronome (4, like the Reviver Seed) and Expert Belt
 *   (4, like the Scope Lens and the Life Orb) always; Precision Lens 3, one below the Scope Lens, as it only matters on
 *   a critical hit.
 */
export const BATTLE_HELD_ITEMS = Object.freeze({
  POWER_HERB: Object.freeze({
    kind: "powerHerb" as BattleItemKind,
    maxHeld: 2,
    poolWeight: 4,
    /** The two-turn moves it does not cover: Sky Drop, as in the main series */
    excludedMoves: Object.freeze([MoveId.SKY_DROP]) as readonly MoveId[],
  }),
  METRONOME: Object.freeze({
    kind: "metronome" as BattleItemKind,
    maxHeld: 3,
    poolWeight: 4,
    /** Power added per consecutive step, in percent, for 1 / 2 / 3 held (the user's 10/15/20%) */
    stepPercentByCount: Object.freeze([10, 15, 20]) as readonly number[],
    /** The most steps that count, like the main-series item (x1.5 / x1.75 / x2 at the cap; 3 held = the official one) */
    maxSteps: 5,
  }),
  LOADED_DICE: Object.freeze({
    kind: "loadedDice" as BattleItemKind,
    maxHeld: 1,
    poolWeight: 4,
    /** Population Bomb's hits with the dice: 10 minus 0-6 (4-10, each equally likely), as in the main series */
    populationBombMaxReduction: 6,
  }),
  SEED_POUCH: Object.freeze({ kind: "seedPouch" as BattleItemKind, maxHeld: 1, poolWeight: 4 }),
  FUEL: Object.freeze({
    kind: "fuel" as BattleItemKind,
    maxHeld: 3,
    poolWeight: 6,
    stats: Object.freeze([Stat.ATK, Stat.SPATK]) as readonly EffectiveStat[],
    /** Tenths added per fuel, added up (11 / 12 / 13 = x1.1 / 1.2 / 1.3), applied as `value * tenths / 10` */
    tenthsPerFuel: 1,
  }),
  EXPERT_BELT: Object.freeze({
    kind: "expertBelt" as BattleItemKind,
    maxHeld: 1,
    poolWeight: 4,
    /** x1.2 in tenths, applied as `damage * 12 / 10` */
    tenths: 12,
  }),
  PRECISION_LENS: Object.freeze({
    kind: "precisionLens" as BattleItemKind,
    maxHeld: 2,
    poolWeight: 3,
    /** A critical hit without the lens, in tenths (x1.5) */
    baseCritTenths: 15,
    /** A critical hit with 1 / 2 lenses, in tenths (x1.7 / x1.8: the user's +20 / +30%) */
    critTenthsByCount: Object.freeze([17, 18]) as readonly number[],
  }),
  /*
   * Local fork (2026-11-11), the third batch: one per Pokémon each. Weights next to the same tier: ROGUE held items sit
   * at 3-5 (Leftovers / Shell Bell / King's Rock 3, Scope Lens / Life Orb / Expert Belt 4); ULTRA ones the ungated
   * Metronome / Reviver Seed at 4 and the gated Punching Glove / Fuel at 6.
   * - Clear Amulet 3, like Leftovers and King's Rock: a defensive item that only matters against Intimidate and drops;
   * - Booster Energy 4, like the Life Orb and the Expert Belt: an always-on boost for anyone (x1.5 for a Paradox);
   * - Throat Spray 6, like the other gated ULTRA items, only while a party member knows a sound move;
   * - Muscle Band / Wise Glasses 4, like the Metronome: nearly every party has a physical / special move, so their gate
   *   is almost always open, and x1.1 on a whole category is about the Punching Glove's x1.1 spread wider.
   */
  CLEAR_AMULET: Object.freeze({ kind: "clearAmulet" as BattleItemKind, maxHeld: 1, poolWeight: 3 }),
  BOOSTER_ENERGY: Object.freeze({
    kind: "boosterEnergy" as BattleItemKind,
    maxHeld: 1,
    poolWeight: 4,
    /** The highest stat x1.2 in tenths, applied as `value * tenths / 10` like Fuel */
    tenths: 12,
    /** x1.5 for a Paradox Pokémon (the user: "패러독스 포켓몬(코라미라이돈 포함)은 1.5배"), in tenths */
    paradoxTenths: 15,
    /** The Paradox Pokémon: the non-legendary ones, Koraidon and Miraidon (any form; a fusion counts if either is one) */
    paradoxSpecies: Object.freeze([
      ...NON_LEGEND_PARADOX_POKEMON,
      SpeciesId.KORAIDON,
      SpeciesId.MIRAIDON,
    ]) as readonly SpeciesId[],
  }),
  THROAT_SPRAY: Object.freeze({
    kind: "throatSpray" as BattleItemKind,
    maxHeld: 1,
    poolWeight: 6,
    /** The stat it raises, and by how many stages (the user: "특수공격 +1") */
    stat: Stat.SPATK as EffectiveStat,
    stages: 1,
  }),
  /**
   * Local fork (2026-11-11): up to 99 like the type boosters, added up: x(10 + n)/10 for n held (x1.1, x1.2, x1.3...).
   * The user: "힘의머리띠 / 박식안경 의 최대 개수는 타입 강화 아이템들처럼 99로 둡시다, 힘의머리띠 / 박식안경 끼리는 합연산으로 계산하게 하고"
   */
  MUSCLE_BAND: Object.freeze({
    kind: "muscleBand" as BattleItemKind,
    maxHeld: 99,
    poolWeight: 4,
    category: MoveCategory.PHYSICAL,
    /** +0.1 per item in tenths, added up and applied as `power * (10 + n) / 10` like the Punching Glove */
    powerTenthsPerItem: 1,
  }),
  WISE_GLASSES: Object.freeze({
    kind: "wiseGlasses" as BattleItemKind,
    maxHeld: 99,
    poolWeight: 4,
    category: MoveCategory.SPECIAL,
    powerTenthsPerItem: 1,
  }),
});

export type BattleHeldItemId = keyof typeof BATTLE_HELD_ITEMS;

/** Local fork (2026-11-11): the marker the seven items' modifiers carry (custom-held-items.ts) */
export interface BattleHeldItem {
  readonly battleItem: BattleItemKind;
}

/** Local fork (2026-11-11): the table row of `kind` */
export function getBattleItemRow(kind: BattleItemKind): (typeof BATTLE_HELD_ITEMS)[BattleHeldItemId] {
  return Object.values(BATTLE_HELD_ITEMS).find(row => row.kind === kind)!;
}

/** Local fork (2026-11-11): the held item of `kind` on `pokemon`, if any */
export function findBattleItem(pokemon: Pokemon, kind: BattleItemKind): PokemonHeldItemModifier | undefined {
  return pokemon.getHeldItems().find(item => (item as Partial<BattleHeldItem>).battleItem === kind);
}

/** Local fork (2026-11-11): how many of `kind` `pokemon` holds, never more than its cap (0 when it holds none) */
export function getBattleItemStack(pokemon: Pokemon, kind: BattleItemKind): number {
  const item = findBattleItem(pokemon, kind);
  return item ? Math.min(item.getStackCount(), getBattleItemRow(kind).maxHeld) : 0;
}

/**
 * Local fork (2026-11-11), after review: whether `pokemon` is of `type` by its own typing (species, form, fusion and
 * permanent changes), leaving out what lasts only in battle (Protean / Libero, Soak, Burn Up, Forest's Curse,
 * Transform, a Tera Type). The reward pool's Seed Pouch and Fuel gates ask it, since the active Pokémon's battle
 * changes are still set on the reward screen; the items themselves use the types as in battle.
 */
export function isOfOwnType(pokemon: Pokemon, type: PokemonType): boolean {
  return pokemon.isOfType(type, { includeTeraType: false, bypassSummonData: true, ignoreThirdType: true });
}

// #region Power Herb

/** Local fork (2026-11-11): whether Power Herb covers `move`: every two-turn (charging) move but Sky Drop */
export function isPowerHerbMove(move: Move): boolean {
  return move.isChargingMove() && !BATTLE_HELD_ITEMS.POWER_HERB.excludedMoves.includes(move.id);
}

/** Local fork (2026-11-11): the charging turns `pokemon`'s Power Herbs can still skip this battle (wave) */
export function getPowerHerbUsesLeft(pokemon: Pokemon): number {
  return Math.max(getBattleItemStack(pokemon, "powerHerb") - pokemon.waveData.powerHerbUses, 0);
}

/**
 * Local fork (2026-11-11): Power Herb (파워풀허브). Called by `MoveChargePhase.end` when the move's own conditions did
 * not make it instant (Solar Beam in sun, Electro Shot in rain never spend a use): if `user`'s herbs have a use left
 * this battle and cover `move`, one use is spent (`PokemonWaveData.powerHerbUses`, reset every wave), the official
 * message is shown and the move attacks this turn. The herb is not used up.
 * @returns Whether the charging turn is skipped
 */
export function tryPowerHerbCharge(user: Pokemon, move: Move): boolean {
  if (!isPowerHerbMove(move) || getPowerHerbUsesLeft(user) <= 0) {
    return false;
  }
  user.waveData.powerHerbUses++;
  globalScene.phaseManager.queueMessage(
    i18next.t("modifier:powerHerbApply", {
      pokemonNameWithAffix: getPokemonNameWithAffix(user),
      typeName: findBattleItem(user, "powerHerb")!.type.name,
    }),
  );
  return true;
}

// #endregion Power Herb

// #region Metronome

/**
 * Local fork (2026-11-11), after review: the index of the first entry of `user`'s move history that belongs to this
 * battle (wave): what `Pokemon.resetWaveData` recorded, or 0 when the history was replaced since (switching out clears
 * it) or nothing was recorded (an enemy, which is new every wave)
 */
function getWaveHistoryStart(user: Pokemon): number {
  const history = user.getMoveHistory();
  const { moveHistoryAtStart, moveHistoryLengthAtStart } = user.waveData;
  return moveHistoryAtStart === history ? Math.min(moveHistoryLengthAtStart, history.length) : 0;
}

/**
 * Local fork (2026-11-11): how many times in a row `user` used `move` successfully just before this use, at most 5
 * (Metronome's steps). Read from the move history like Fury Cutter's `ConsecutiveUsePowerMultiplierAttr`: the newest
 * entry is this use itself (`MoveEffectPhase` records it before the damage), so it is skipped. A different move, a
 * failure or a miss ends the run, as in the main series; a charging turn of the same move (result `OTHER`) neither
 * counts nor ends it. The history is cleared when the user leaves the field.
 * Local fork (2026-11-11), after review: only this battle's (wave's) moves count, so every battle starts at x1 as in
 * the main series (wild waves keep the history of a Pokémon that stays out); and a move-calling move that worked
 * (Nature Power, Sleep Talk, Copycat, Metronome the move ...: `CallMoveAttr`) is passed over, so the move it calls
 * builds its own run, as in Showdown.
 */
export function getMetronomeSteps(user: Pokemon, move: Move): number {
  const { maxSteps } = BATTLE_HELD_ITEMS.METRONOME;
  const history = user.getMoveHistory();
  const waveStart = getWaveHistoryStart(user);
  let steps = 0;
  for (let i = history.length - 2; i >= waveStart; i--) {
    const turnMove = history[i];
    if (turnMove.move !== move.id) {
      if (turnMove.result === MoveResult.SUCCESS && allMoves[turnMove.move]?.hasAttr("CallMoveAttr")) {
        continue;
      }
      break;
    }
    if (turnMove.result === MoveResult.OTHER) {
      continue;
    }
    if (turnMove.result !== MoveResult.SUCCESS || ++steps >= maxSteps) {
      break;
    }
  }
  return steps;
}

/**
 * Local fork (2026-11-11): `move`'s power with `user`'s Metronomes, in percent (100 = none): +10 / 15 / 20 per step
 * for 1 / 2 / 3 held ({@linkcode getMetronomeSteps}), so at most 150 / 175 / 200
 */
export function getMetronomePowerPercent(user: Pokemon, move: Move): number {
  const held = getBattleItemStack(user, "metronome");
  if (held === 0) {
    return 100;
  }
  return 100 + BATTLE_HELD_ITEMS.METRONOME.stepPercentByCount[held - 1] * getMetronomeSteps(user, move);
}

/**
 * Local fork (2026-11-11): multiply `power` by `user`'s Metronome (`Move.calculateBattlePower`, next to the gloves);
 * `power * percent / 100` keeps a whole power exact (40 at +15% is 46)
 */
export function applyMetronomePower(user: Pokemon, move: Move, power: NumberHolder): void {
  const percent = getMetronomePowerPercent(user, move);
  if (percent !== 100) {
    power.value = (power.value * percent) / 100;
  }
}

// #endregion Metronome

// #region Loaded Dice

/** Local fork (2026-11-11): whether `pokemon` holds Loaded Dice (속임수주사위) */
export function holdsLoadedDice(pokemon: Pokemon): boolean {
  return getBattleItemStack(pokemon, "loadedDice") > 0;
}

/**
 * Local fork (2026-11-11): Loaded Dice on a 2-5-hit move. `MultiHitAttr.getHitCount` rolls 0-19 and maps it to hits
 * (0-2: 5, 3-5: 4, 6-12: 3, 13-19: 2); with the dice the same roll gives 5 (0-9) or 4 (10-19), half each, and Skill
 * Link (`MaxMultiHitAbAttr`, applied after this) still makes it 5. The roll is drawn as before, so seeded battles keep
 * their order of random numbers.
 * @param user - The attacker
 * @param roll - The 0-19 roll
 * @returns The roll to map to hits
 */
export function applyLoadedDiceRoll(user: Pokemon, roll: number): number {
  if (!holdsLoadedDice(user)) {
    return roll;
  }
  return roll < 10 ? 0 : 3;
}

/**
 * Local fork (2026-11-11): Population Bomb's hits (`MultiHitType.TEN`): 10, or with Loaded Dice 4-10 as in the main
 * series (Showdown's `10 - random(7)`), unless Skill Link makes every hit count anyway (then 10, Skill Link wins)
 */
export function getPopulationBombHitCount(user: Pokemon): number {
  if (!holdsLoadedDice(user) || user.hasAbilityWithAttr("MaxMultiHitAbAttr")) {
    return 10;
  }
  return 10 - user.randBattleSeedInt(BATTLE_HELD_ITEMS.LOADED_DICE.populationBombMaxReduction + 1);
}

/**
 * Local fork (2026-11-11): whether Loaded Dice changes `move` at all: a 2-5-hit move, or one that checks accuracy on
 * every hit (Triple Kick, Triple Axel, Population Bomb). The reward pool asks it.
 */
export function isLoadedDiceMove(move: Move): boolean {
  return (
    move.hasFlag(MoveFlags.CHECK_ALL_HITS)
    || move.getAttrs("MultiHitAttr").some(attr => attr.getMultiHitType() === MultiHitType.TWO_TO_FIVE)
  );
}

// #endregion Loaded Dice

// #region Seed Pouch

/**
 * Local fork (2026-11-11): whether `pokemon`'s Seed Pouch (씨앗주머니) works: it holds one, is on the field and is a
 * Grass type as in battle (a Tera Type or a changed type counts, so a Pokémon Terastallized out of Grass gets nothing;
 * a Stellar Tera keeps its original types, as for Radioactive Waste)
 */
export function isSeedPouchActive(pokemon: Pokemon): boolean {
  return (
    getBattleItemStack(pokemon, "seedPouch") > 0
    && pokemon.isActive(true)
    && pokemon.isOfType(PokemonType.GRASS, { returnOriginalTypesIfStellar: true })
  );
}

/** Local fork (2026-11-11), after review: the semi-invulnerable states (Fly, Dig, Dive, Phantom / Shadow Force) */
const SEMI_INVULNERABLE_TAGS: readonly BattlerTagType[] = Object.freeze([
  BattlerTagType.FLYING,
  BattlerTagType.UNDERGROUND,
  BattlerTagType.UNDERWATER,
  BattlerTagType.HIDDEN,
]);

/**
 * Local fork (2026-11-11), after review: whether Leech Seed used by `holder` would miss or be blocked before it reached
 * `target`, the checks of `MoveEffectPhase.hitCheck` that can apply to it (Leech Seed's accuracy is not rolled):
 * - Commander (a Tatsugiri inside Dondozo) and a semi-invulnerable state (Fly, Dig ...; not against No Guard);
 * - Protect / Spiky Shield / Baneful Bunker (the protections that block status moves, `ProtectedTag.blockStatus`;
 *   read without lapsing them) and Crafty Shield;
 * - Magic Coat / Magic Bounce: Leech Seed would bounce back to the Grass-type holder, which is immune.
 */
function isLeechSeedBlocked(holder: Pokemon, target: Pokemon): boolean {
  const commanded = target.getAlly()?.getTag(BattlerTagType.COMMANDED);
  if (globalScene.currentBattle.double && commanded?.getSourcePokemon() === target) {
    return true;
  }
  const noGuard = holder.hasAbilityWithAttr("AlwaysHitAbAttr") || target.hasAbilityWithAttr("AlwaysHitAbAttr");
  if (!noGuard && SEMI_INVULNERABLE_TAGS.some(tag => target.getTag(tag))) {
    return true;
  }
  const targetSide = target.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
  if (
    target.findTags(tag => (tag as Partial<{ readonly blockStatus: boolean }>).blockStatus === true).length > 0
    || globalScene.arena.getTagOnSide(ArenaTagType.CRAFTY_SHIELD, targetSide)
  ) {
    return true;
  }
  return !!target.getTag(BattlerTagType.MAGIC_COAT) || target.hasAbilityWithAttr("ReflectStatusMoveAbAttr");
}

/**
 * Local fork (2026-11-11): whether Leech Seed would take on `target`: not already seeded, not a Grass type (the
 * `SeedTag`'s own check), no Substitute (Leech Seed fails against one), and no ability keeps the tag off.
 * Local fork (2026-11-11), after review: and as if `holder` had used Leech Seed ("씨뿌리기 효과와 동일한 효과"): nothing
 * makes it miss or blocks it ({@linkcode isLeechSeedBlocked}), and no ability makes the target immune to it (Good as
 * Gold, Sap Sipper ...: `getMoveEffectiveness`, simulated, so Sap Sipper does not raise Attack for the item)
 */
function canPouchSeed(holder: Pokemon, target: Pokemon): boolean {
  return (
    target.isActive(true)
    && !target.getTag(BattlerTagType.SUBSTITUTE)
    && !target.isOfType(PokemonType.GRASS)
    && target.canAddTag(BattlerTagType.SEEDED)
    && !isLeechSeedBlocked(holder, target)
    && target.getMoveEffectiveness(holder, allMoves[MoveId.LEECH_SEED], false, true) !== 0
  );
}

/**
 * Local fork (2026-11-11): `holder`'s pouch seeds each of `targets` it can: one item message, then the real Leech Seed
 * (`BattlerTagType.SEEDED`, with `holder` as the source as if it had used Leech Seed), whose own message follows
 * @returns Whether any target was seeded
 */
function seedFromPouch(holder: Pokemon, targets: readonly Pokemon[]): boolean {
  const seedable = targets.filter(target => canPouchSeed(holder, target));
  if (seedable.length === 0) {
    return false;
  }
  globalScene.phaseManager.queueMessage(
    i18next.t("modifier:seedPouchApply", {
      pokemonNameWithAffix: getPokemonNameWithAffix(holder),
      typeName: findBattleItem(holder, "seedPouch")!.type.name,
    }),
  );
  let seeded = false;
  for (const target of seedable) {
    seeded = target.addTag(BattlerTagType.SEEDED, 0, MoveId.LEECH_SEED, holder.id) || seeded;
  }
  return seeded;
}

/**
 * Local fork (2026-11-11): Seed Pouch (씨앗주머니), called by `PostSummonPhase` for every Pokémon that comes onto the
 * field (the start of a battle, a switch, a replacement), after the entry hazards:
 * - if the newcomer's own pouch works ({@linkcode isSeedPouchActive}), every opposing Pokémon on the field is seeded;
 * - if an opposing Pokémon on the field has a working pouch, the newcomer is seeded by it (by the first one).
 * Everything after that is Leech Seed's own rules: Grass types are immune, switching out / Rapid Spin / Mortal Spin
 * remove it, Magic Guard, Liquid Ooze, Big Root ...
 * @param pokemon - The Pokémon that just came onto the field
 */
export function applySeedPouchOnEntry(pokemon: Pokemon): void {
  if (!pokemon.isActive(true)) {
    return;
  }
  if (isSeedPouchActive(pokemon)) {
    seedFromPouch(pokemon, pokemon.getOpponents());
  }
  for (const opponent of pokemon.getOpponents()) {
    if (isSeedPouchActive(opponent) && seedFromPouch(opponent, [pokemon])) {
      break;
    }
  }
}

// #endregion Seed Pouch

// #region Fuel

/**
 * Local fork (2026-11-11): whether Fuel (연료) works for `pokemon`: a Fire type as in battle (Terastallized out of Fire:
 * no; a Stellar Tera keeps its original types)
 */
export function isFuelBurner(pokemon: Pokemon): boolean {
  return pokemon.isOfType(PokemonType.FIRE, { returnOriginalTypesIfStellar: true });
}

/** Local fork (2026-11-11): the Attack / Sp. Atk multiplier of `stackCount` fuels, in tenths: 11 / 12 / 13 (added up) */
export function getFuelTenths(stackCount: number): number {
  const { maxHeld, tenthsPerFuel } = BATTLE_HELD_ITEMS.FUEL;
  return 10 + tenthsPerFuel * Math.min(Math.max(stackCount, 0), maxHeld);
}

// #endregion Fuel

// #region Expert Belt

/**
 * Local fork (2026-11-11): Expert Belt (달인의띠): a super-effective hit (`typeMultiplier` 2 or more) of a holder deals
 * x1.2, as `damage * 12 / 10`, rounded down. `Pokemon.getAttackDamage` calls it among the final multipliers, right
 * before the Life Orb (the main series' order).
 */
export function applyExpertBeltDamage(source: Pokemon, typeMultiplier: number, damage: NumberHolder): void {
  if (typeMultiplier >= 2 && getBattleItemStack(source, "expertBelt") > 0) {
    damage.value = toDmgValue((damage.value * BATTLE_HELD_ITEMS.EXPERT_BELT.tenths) / 10);
  }
}

// #endregion Expert Belt

// #region Precision Lens

/**
 * Local fork (2026-11-11): the critical-hit damage multiplier of `source`: x1.5, or with Precision Lens (정밀렌즈) x1.7 /
 * x1.8 for 1 / 2 held. `Pokemon.getAttackDamage` starts from it and applies Sniper's x1.5 on top (1.7 x 1.5 = 2.55).
 * The critical-hit rate is not changed.
 */
export function getCriticalHitMultiplier(source: Pokemon): number {
  const { baseCritTenths, critTenthsByCount } = BATTLE_HELD_ITEMS.PRECISION_LENS;
  const held = getBattleItemStack(source, "precisionLens");
  return (held === 0 ? baseCritTenths : critTenthsByCount[held - 1]) / 10;
}

// #endregion Precision Lens

// #region Clear Amulet

/** Local fork (2026-11-11): whether `pokemon` holds a Clear Amulet (클리어참) */
export function holdsClearAmulet(pokemon: Pokemon): boolean {
  return getBattleItemStack(pokemon, "clearAmulet") > 0;
}

/**
 * Local fork (2026-11-11): Clear Amulet (클리어참), the main-series item (the user: "클리어참은 효과 그대로"). Called by
 * `StatStageChangePhase.removeCancelledChanges` for changes another Pokémon (or nobody: a Sticky Web whose setter left,
 * Mirror Armor's reflection) caused, before Mist and the abilities, as Showdown orders it (the item's `onTryBoost` comes
 * first). When the holder would lose a stat stage, the official message is shown and the caller drops every lowering
 * change, so nothing after it sees one: Mist, Clear Body and Mirror Armor do nothing, and as nothing fell, Defiant /
 * Competitive do not trigger. Raises in the same change (Spicy Extract's Attack) still apply, and Contrary has already
 * turned a drop into a raise by then (`applyStageMultipliers`). Mold Breaker does not get past an item. The holder's own
 * drops (Close Combat, Superpower, Weak Armor ...) never come here (the phase's `selfTarget`).
 * @param pokemon - The Pokémon whose stats would change
 * @param changes - The changes, after the stage multipliers
 * @param showMessage - Local fork (2026-11-11), after review: `false` for Octolock's drops every turn, which Showdown
 *   blocks without the message (default `true`)
 * @returns Whether the amulet blocked a drop (the caller then removes every negative change)
 */
export function applyClearAmulet(pokemon: Pokemon, changes: readonly StatChange[], showMessage = true): boolean {
  if (!changes.some(c => c.stages < 0) || !holdsClearAmulet(pokemon)) {
    return false;
  }
  if (showMessage) {
    globalScene.phaseManager.queueMessage(
      i18next.t("modifier:clearAmuletApply", {
        pokemonNameWithAffix: getPokemonNameWithAffix(pokemon),
        typeName: findBattleItem(pokemon, "clearAmulet")!.type.name,
      }),
    );
  }
  return true;
}

/**
 * Local fork (2026-11-11), after review: whether `pokemon`'s Clear Amulet (클리어참) stops a drop another Pokémon gives
 * it, for the effects that look ahead of `StatStageChangePhase` (Parting Shot's switch, Rattled after Intimidate): it
 * holds one and Contrary does not turn the drop into a raise first (`applyStageMultipliers` runs before the amulet;
 * Simple only doubles it)
 */
export function clearAmuletBlocksDrop(pokemon: Pokemon): boolean {
  return holdsClearAmulet(pokemon) && !pokemon.hasAbility(AbilityId.CONTRARY);
}

// #endregion Clear Amulet

// #region Booster Energy

/**
 * Local fork (2026-11-11): `pokemon`'s highest stat among Attack, Defense, Sp. Atk, Sp. Def and Speed, the way
 * Protosynthesis and Quark Drive pick theirs (`HighestStatBoostTag.onAdd`, which calls this): the in-battle stats with
 * their stat stages, leaving out abilities and held items; on a tie the first in that order (Atk > Def > SpA > SpD >
 * Spe), as in the main series.
 */
export function getHighestStat(pokemon: Pokemon): EffectiveStat {
  let highest: EffectiveStat = Stat.ATK;
  let highestValue = 0;
  for (const stat of EFFECTIVE_STATS) {
    const value = pokemon.getEffectiveStat(stat, {
      ignoreAbility: true,
      ignoreOppAbility: true,
      ignoreAllyAbility: true,
      ignoreHeldItems: true,
    });
    if (value > highestValue) {
      highest = stat;
      highestValue = value;
    }
  }
  return highest;
}

/**
 * Local fork (2026-11-11): whether `pokemon` is a Paradox Pokémon for Booster Energy (부스트에너지): one of
 * {@linkcode BATTLE_HELD_ITEMS}.BOOSTER_ENERGY.paradoxSpecies in any form, or a fusion with one as either species (the
 * way the Ultimate Gene checks Mewtwo)
 */
export function isBoosterEnergyParadox(pokemon: Pokemon): boolean {
  const { paradoxSpecies } = BATTLE_HELD_ITEMS.BOOSTER_ENERGY;
  return (
    paradoxSpecies.includes(pokemon.getSpeciesForm(true).speciesId)
    || (pokemon.isFusion() && paradoxSpecies.includes(pokemon.getFusionSpeciesForm(true).speciesId))
  );
}

/** Local fork (2026-11-11): Booster Energy's multiplier for `pokemon`, in tenths: 15 for a Paradox Pokémon, else 12 */
export function getBoosterEnergyTenths(pokemon: Pokemon): number {
  const { tenths, paradoxTenths } = BATTLE_HELD_ITEMS.BOOSTER_ENERGY;
  return isBoosterEnergyParadox(pokemon) ? paradoxTenths : tenths;
}

// #endregion Booster Energy

// #region Throat Spray

/**
 * Local fork (2026-11-11): Throat Spray (목스프레이; the user: "전투당 한번, 소리 기술 사용 시 특수공격 +1"). Called by
 * `MoveEffectPhase.end` once every hit of `move` is done, when it hit (or took effect on) at least one target: if `user`
 * holds a spray, `move` is a sound move (`MoveFlags.SOUND_BASED`), `user` is still on the field and has not used its
 * spray this battle (`PokemonWaveData.throatSprayUsed`, reset every wave), its Sp. Atk rises by 1 stage with the official
 * message ("The Throat Spray raised ..."). The spray is not used up. At +6 it does nothing and keeps its use, as in the
 * main series; with Contrary or Simple the stat change goes through those (a fall / +2) under the usual message. The
 * change is the holder's own, so Clear Amulet and Mist never stop it.
 *
 * Local fork (2026-11-11), after review:
 * - The use is also kept on `summonData` (`PokemonSummonData.throatSprayUsed`, saved with it), which is cleared exactly
 *   when stat stages are (switching out, fainting, a new biome / trainer / Mystery Encounter). A holder that stays on
 *   the field keeps its +1 into the next wild wave, so the spray does not work again until that +1 is gone; otherwise
 *   it would stack another +1 every wild wave up to +6. Within a wave it still works only once, even after a switch.
 * - With Sheer Force on a move it boosts (`move.chance >= 1`, the ability's own rule) the spray does not work, as in
 *   Showdown, where Sheer Force skips the after-move item effects.
 * @returns Whether the spray took effect
 */
export function tryThroatSpray(user: Pokemon, move: Move): boolean {
  if (
    !move.hasFlag(MoveFlags.SOUND_BASED)
    || getBattleItemStack(user, "throatSpray") === 0
    || user.waveData.throatSprayUsed
    || user.summonData.throatSprayUsed
    || !user.isActive(true)
    || (move.chance >= 1 && user.hasAbility(AbilityId.SHEER_FORCE))
  ) {
    return false;
  }
  const { stat, stages } = BATTLE_HELD_ITEMS.THROAT_SPRAY;
  const changesStages = user.hasAbilityWithAttr("StatStageChangeMultiplierAbAttr");
  if (!changesStages && user.getStatStage(stat) >= 6) {
    return false;
  }
  user.waveData.throatSprayUsed = true;
  user.summonData.throatSprayUsed = true;
  const typeName = findBattleItem(user, "throatSpray")!.type.name;
  globalScene.phaseManager.unshiftNew("StatStageChangePhase", {
    battlerIndex: user.getBattlerIndex(),
    changes: [{ stat, stages }],
    sourcePokemon: user,
    message: changesStages
      ? undefined
      : pokemon =>
          i18next.t("modifier:throatSprayApply", {
            pokemonNameWithAffix: getPokemonNameWithAffix(pokemon),
            typeName,
            statName: i18next.t(getStatKey(stat)),
          }),
  });
  return true;
}

// #endregion Throat Spray

// #region Muscle Band / Wise Glasses

/**
 * Local fork (2026-11-11): the power multiplier of `user`'s Muscle Band (힘의머리띠) or Wise Glasses (박식안경) for a
 * move of `category`, in tenths (10 = none): 10 + n for n bands on a physical move or n glasses on a special one
 * (Local fork (2026-11-11): up to 99, added up, like the type boosters).
 *
 * Local fork (2026-11-11), after review: the category comes from the caller, as the move turns out
 * (`Pokemon.getAttackDamage` works it out once and passes it down through `getBaseDamage`), and is never worked out
 * here. Working it out here, inside `Move.calculateBattlePower`, sent Shell Side Arm into endless recursion (its
 * category forecast runs `getBaseDamage`, which runs `calculateBattlePower` again), held item or not, and would draw
 * one more tie-break roll than the move itself.
 */
export function getCategoryBandPowerTenths(user: Pokemon, category: MoveCategory): number {
  for (const { kind, category: boosted, powerTenthsPerItem } of [
    BATTLE_HELD_ITEMS.MUSCLE_BAND,
    BATTLE_HELD_ITEMS.WISE_GLASSES,
  ]) {
    if (category === boosted) {
      return 10 + getBattleItemStack(user, kind) * powerTenthsPerItem;
    }
  }
  return 10;
}

/**
 * Local fork (2026-11-11): multiply `power` by `user`'s Muscle Band / Wise Glasses (`Move.calculateBattlePower`, next to
 * the gloves); `power * tenths / 10` keeps a whole power exact (75 becomes 82.5). With no `category` (Shell Side Arm's
 * category forecast, which in the main series compares the bare stats) neither applies.
 * @param category - The move's category as used (Photon Geyser, Shell Side Arm and Tera Blast as they turn out)
 */
export function applyCategoryBandPower(user: Pokemon, category: MoveCategory | undefined, power: NumberHolder): void {
  if (category == null) {
    return;
  }
  const tenths = getCategoryBandPowerTenths(user, category);
  if (tenths !== 10) {
    power.value = (power.value * tenths) / 10;
  }
}

// #endregion Muscle Band / Wise Glasses
