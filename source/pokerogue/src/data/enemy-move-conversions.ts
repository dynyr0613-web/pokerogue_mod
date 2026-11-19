/**
 * Local fork (2026-11-18): enemy Pokémon that come with one move slot already converted into a Z-Move or a Max Move
 * (the Z / Max move conversions of move-transform.ts). The user: "적의 기술은 그냥 낮은 확률로 적 포켓몬 기술 중
 * 하나가 z기술/다이맥스기술 중 하나로 대체되게".
 *
 * - Chance: per enemy Pokémon, growing with the difficulty wave (`gameMode.getWaveForDifficulty`), in every game mode
 *   ({@linkcode ENEMY_MOVE_CONVERSIONS}, in the `BattleFormChanceCurve` style of enemy-battle-forms.ts): an ordinary
 *   trainer's Pokémon 2% at wave 50, +1 every 100 waves, at most 10%, at most 1 per party; an elite or boss trainer's
 *   (`getTrainerBattleFormTier`), and any trainer Pokémon with boss bars, 4% at wave 50, +2 every 100 waves, at most
 *   20%, at most 2 per party; a wild Pokémon 1% from wave 50; a wild boss 5% at wave 50, +2 every 100 waves, at most
 *   20%. Nothing before wave 50.
 * - What: at most one slot per Pokémon. Max or Z, half and half ({@linkcode ENEMY_MOVE_CONVERSIONS}.maxMovePercent);
 *   when the Pokémon has no slot for one of them, the other. The Max side is what a 다이사탕 (Dynamax Candy) gives the
 *   slot (`getConversionResult`, so the G-Max move by the species rule, as for the player); the Z side is what the type
 *   Z crystal of the slot's type gives, or the exclusive Z crystal's move when the Pokémon is (or is fused with) its
 *   species (`isExclusiveZEligibleSpecies`). Only results whose derived move is an attack count (never Max Guard,
 *   다이검무, a Z status move or Extreme Evoboost), and never a Z다이 move (only plain slots are converted). The slot is
 *   picked at random among the ones that can take the chosen side.
 * - Hooks (encounter-phase.ts only; nothing else may import this module, it imports move-transform.ts, which imports
 *   the move classes): inside the new-wave (`!loaded`) blocks, after the battle forms (`rollTrainerBattleForm`, the
 *   fixed fusions and the Endless boss bars for a trainer; `rollWildBattleForm` for each wild Pokémon) and before the
 *   sprites and move animations load, so the derived move's animation loads with the Pokémon.
 * - Never in a mystery-encounter battle, for the Classic final boss or the Daily final boss (`getBattleFormRollWave`),
 *   or while `ENEMY_MOVESET_OVERRIDE` is set (the override rebuilds the enemy moveset each time it is read).
 * - Local fork (2026-11-19): the final Endless trainer (wave 5850, `isEndlessFinalTrainerBattle`) rolls nothing: its
 *   ace's damaging slots all become Max moves and exactly one other member gets one Z-Move
 *   ({@linkcode applyEndlessFinalMoveConversions}).
 * - Seeds: the rolls run through `executeWithSeedOffset` on their own offsets ({@linkcode getMoveConversionSeedOffset}),
 *   which restores the running RNG afterwards, so every other draw of the wave is as before.
 * - A reloaded wave keeps its slots (`PokemonMove.transform` is saved with the moveset) and rolls nothing again.
 * - Capture: the caught Pokémon's slots lose their conversion (attempt-capture-phase.ts and `catchPokemon`, next to
 *   `prepareBattleFormCapture`), so the player never gets a free converted slot.
 *
 * Tests force the rolls through {@linkcode enemyMoveConversionDice} or read {@linkcode getEnemyMoveConversionChance}.
 */

import { globalScene } from "#app/global-scene";
import { activeOverrides } from "#app/overrides";
import { allMoves } from "#data/data-lists";
import {
  type BattleFormChanceCurve,
  getBattleFormChanceAt,
  getBattleFormRollWave,
  getTrainerBattleFormTier,
  type TrainerBattleFormTier,
} from "#data/enemy-battle-forms";
import { getEndlessFinalAce } from "#data/enemy-dynamax";
import { BattleType } from "#enums/battle-type";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";
import { getConversionResult, isExclusiveZEligibleSpecies, type MoveTransform } from "#moves/move-transform";
import type { PokemonMove } from "#moves/pokemon-move";
import { EXCLUSIVE_Z } from "#moves/zmax-data";
import { isEndlessFinalTrainerBattle } from "#trainers/endless-final-trainer";
import { coerceArray } from "#utils/array";
import { randSeedInt } from "#utils/common";

/**
 * Local fork (2026-11-18): one chance entry of {@linkcode ENEMY_MOVE_CONVERSIONS}: a `BattleFormChanceCurve` (`chance`
 * at `minWave`, plus `step` every `everyWaves` waves, at most `max`), with the trainer entries' party cap
 */
export interface MoveConversionChanceCurve extends BattleFormChanceCurve {
  /** At most this many Pokémon of one trainer's party get a converted slot (trainer entries only) */
  readonly perParty?: number;
}

/**
 * Local fork (2026-11-18): every number of the enemy Z / Max move conversions, in one place.
 * - `trainer`: per trainer tier (`getTrainerBattleFormTier`: `ordinary`, `elite`, `boss`), the percent chance per
 *   Pokémon of the party, and `perParty`, the most Pokémon of one party that get one; a trainer Pokémon with boss bars
 *   uses the `boss` entry whatever its trainer's tier;
 *   - `ordinary`: 2% at wave 50, +1 every 100 waves (3% at 150), 10% from wave 850; at most 1 per party;
 *   - `elite`: 4% at wave 50, +2 every 100 waves (6% at 150), 20% from wave 850; at most 2 per party;
 *   - `boss`: the elite numbers, an entry of their own so the two can be tuned apart;
 * - `wild`: the percent chance per ordinary wild Pokémon, from wave 50;
 * - `wildBoss`: the same per wild boss (`isBoss()`): 5% at wave 50, +2 every 100 waves, 20% from wave 850;
 * - `maxMovePercent`: the percent chance that the conversion is a Max Move (else a Z-Move), when both are possible.
 */
export const ENEMY_MOVE_CONVERSIONS = Object.freeze({
  trainer: Object.freeze({
    ordinary: Object.freeze({ chance: 2, step: 1, everyWaves: 100, max: 10, minWave: 50, perParty: 1 }),
    elite: Object.freeze({ chance: 4, step: 2, everyWaves: 100, max: 20, minWave: 50, perParty: 2 }),
    boss: Object.freeze({ chance: 4, step: 2, everyWaves: 100, max: 20, minWave: 50, perParty: 2 }),
  }) satisfies Readonly<Record<TrainerBattleFormTier, MoveConversionChanceCurve>>,
  wild: Object.freeze({ chance: 1, minWave: 50 }) satisfies MoveConversionChanceCurve,
  wildBoss: Object.freeze({
    chance: 5,
    step: 2,
    everyWaves: 100,
    max: 20,
    minWave: 50,
  }) satisfies MoveConversionChanceCurve,
  maxMovePercent: 50,
});

/** Local fork (2026-11-18): the two sides of an enemy conversion: a Max Move (G-Max included) or a Z-Move */
export type EnemyMoveConversionSide = "max" | "z";

/** Local fork (2026-11-18): a slot of an enemy that can take a conversion, and what it becomes */
export interface EnemyMoveConversionOption {
  /** The slot's index in the Pokémon's moveset */
  readonly slotIndex: number;
  /** What the slot becomes */
  readonly transform: Readonly<MoveTransform>;
}

/**
 * Local fork (2026-11-18): the seeded roller of the conversion rolls (`roll(range)` returns an integer in
 * [0, range)). A test hook: tests stub `roll` with `vi.spyOn(enemyMoveConversionDice, "roll")` to force an outcome;
 * game code never replaces it. Kept apart from {@linkcode ENEMY_MOVE_CONVERSIONS}, which stays frozen.
 */
export const enemyMoveConversionDice = {
  roll: (range: number): number => randSeedInt(range),
};

/**
 * Local fork (2026-11-18): the percent chance that an enemy Pokémon comes with a converted slot
 * ({@linkcode ENEMY_MOVE_CONVERSIONS}); 0 before the entry's `minWave` and for other battles.
 * @param battleType - The battle's type
 * @param isBoss - Whether the Pokémon has boss bars (a trainer's then uses the `boss` entry)
 * @param difficultyWave - The wave for difficulty (`gameMode.getWaveForDifficulty`)
 * @param trainerTier - The trainer's tier (`getTrainerBattleFormTier`; ignored for wild Pokémon); default `ordinary`
 */
export function getEnemyMoveConversionChance(
  battleType: BattleType,
  isBoss: boolean,
  difficultyWave: number,
  trainerTier: TrainerBattleFormTier = "ordinary",
): number {
  let entry: MoveConversionChanceCurve;
  if (battleType === BattleType.TRAINER) {
    entry = ENEMY_MOVE_CONVERSIONS.trainer[isBoss ? "boss" : trainerTier];
  } else if (battleType === BattleType.WILD) {
    entry = isBoss ? ENEMY_MOVE_CONVERSIONS.wildBoss : ENEMY_MOVE_CONVERSIONS.wild;
  } else {
    return 0;
  }
  return getBattleFormChanceAt(entry, difficultyWave);
}

/**
 * Local fork (2026-11-18): the most Pokémon of one trainer's party that get a converted slot: the tier's `perParty`,
 * raised to the `boss` entry's when a member has boss bars
 * @param trainerTier - The trainer's tier
 * @param hasBossMember - Whether a member of the party has boss bars
 */
export function getTrainerMoveConversionCap(trainerTier: TrainerBattleFormTier, hasBossMember: boolean): number {
  const { trainer } = ENEMY_MOVE_CONVERSIONS;
  const cap = trainer[trainerTier].perParty;
  return hasBossMember ? Math.max(cap, trainer.boss.perParty) : cap;
}

/** Whether `t` turns the slot into an attack (not Max Guard, 다이검무, a Z status move or Extreme Evoboost; no Z다이) */
function isAttackConversion(t: MoveTransform | null): t is MoveTransform {
  if (!t || t.kind === "zMax") {
    return false;
  }
  // A derived attack is a copy of the Max / G-Max / Z move's registry entry; a Z status move keeps the base status
  // move's id, Max Guard / 다이검무 / Extreme Evoboost are status moves in the registry
  const derived = allMoves[t.moveId];
  return !!derived && derived.category !== MoveCategory.STATUS;
}

/** The Max side of `slot`: what a 다이사탕 gives it (the G-Max move by the species rule), if that is an attack */
function getMaxSide(pokemon: Pokemon, slot: PokemonMove): MoveTransform | null {
  const result = getConversionResult(pokemon, slot, { kind: "candy" });
  return isAttackConversion(result) ? result : null;
}

/**
 * The Z side of `slot`: the exclusive Z move of a crystal whose species `pokemon` is (or is fused with) when it is an
 * attack of the slot's type, else the type Z crystal's move, if that is an attack
 */
function getZSide(pokemon: Pokemon, slot: PokemonMove): MoveTransform | null {
  for (const info of EXCLUSIVE_Z) {
    if (!isExclusiveZEligibleSpecies(pokemon, info.key)) {
      continue;
    }
    const exclusive = getConversionResult(pokemon, slot, { kind: "zExclusive", key: info.key });
    if (isAttackConversion(exclusive)) {
      return exclusive;
    }
  }
  const typed = getConversionResult(pokemon, slot, { kind: "zType", type: slot.getMove().type });
  return isAttackConversion(typed) ? typed : null;
}

/**
 * Local fork (2026-11-18): the slots of `pokemon` that can take each side of a conversion, in moveset order; none
 * when a slot of it is already converted (one per Pokémon)
 */
export function getEnemyMoveConversionOptions(
  pokemon: Pokemon,
): Record<EnemyMoveConversionSide, EnemyMoveConversionOption[]> {
  const options: Record<EnemyMoveConversionSide, EnemyMoveConversionOption[]> = { max: [], z: [] };
  if (pokemon.moveset.some(slot => slot?.transform)) {
    return options;
  }
  pokemon.moveset.forEach((slot, slotIndex) => {
    if (!slot) {
      return;
    }
    const max = getMaxSide(pokemon, slot);
    if (max) {
      options.max.push({ slotIndex, transform: max });
    }
    const z = getZSide(pokemon, slot);
    if (z) {
      options.z.push({ slotIndex, transform: z });
    }
  });
  return options;
}

/**
 * Local fork (2026-11-18): converts one slot of `pokemon` (no chance roll): Max or Z at
 * {@linkcode ENEMY_MOVE_CONVERSIONS}.maxMovePercent (the other side when one has no slot), then a random slot of that
 * side. Draws from {@linkcode enemyMoveConversionDice}, so game code calls it inside a seeded offset.
 * Local fork (2026-11-19): `forcedSide` skips the Max-or-Z draw (the final Endless trainer's Z-Move,
 * {@linkcode applyEndlessFinalMoveConversions}); `null` when that side has no slot.
 * @returns The option applied, or `null` when no slot can take a conversion
 */
export function convertEnemyMoveSlot(
  pokemon: Pokemon,
  forcedSide?: EnemyMoveConversionSide,
): EnemyMoveConversionOption | null {
  const options = getEnemyMoveConversionOptions(pokemon);
  let side: EnemyMoveConversionSide;
  if (forcedSide != null) {
    if (options[forcedSide].length === 0) {
      return null;
    }
    side = forcedSide;
  } else if (options.max.length > 0 && options.z.length > 0) {
    side = enemyMoveConversionDice.roll(100) < ENEMY_MOVE_CONVERSIONS.maxMovePercent ? "max" : "z";
  } else if (options.max.length > 0) {
    side = "max";
  } else if (options.z.length > 0) {
    side = "z";
  } else {
    return null;
  }
  const pool = options[side];
  const option = pool[enemyMoveConversionDice.roll(pool.length)];
  const slot = pokemon.moveset[option.slotIndex];
  slot.transform = { kind: option.transform.kind, moveId: option.transform.moveId };
  console.log(
    `[enemy-move-conversions] ${pokemon.name}'s ${MoveId[slot.moveId]} becomes ${MoveId[option.transform.moveId]}`,
  );
  return option;
}

/**
 * Rolls `chance` for `pokemon`, then converts one of its slots; nothing is rolled when the chance is 0 or no slot can
 * take a conversion
 */
function rollEnemyMoveConversion(pokemon: Pokemon, chance: number): boolean {
  if (chance <= 0) {
    return false;
  }
  const options = getEnemyMoveConversionOptions(pokemon);
  if (options.max.length === 0 && options.z.length === 0) {
    return false;
  }
  if (enemyMoveConversionDice.roll(100) >= chance) {
    return false;
  }
  return convertEnemyMoveSlot(pokemon) != null;
}

/**
 * Local fork (2026-11-18): the current battle's difficulty wave, or `null` when no conversion may be rolled in it: the
 * battles without battle-form rolls (`getBattleFormRollWave`: a mystery encounter, the Classic and Daily final bosses)
 * and every battle while `ENEMY_MOVESET_OVERRIDE` is set
 */
function getMoveConversionRollWave(): number | null {
  if (coerceArray(activeOverrides.ENEMY_MOVESET_OVERRIDE).length > 0) {
    return null;
  }
  return getBattleFormRollWave();
}

/**
 * Local fork (2026-11-18): the seed offset of the conversion rolls of the current wave: `3000w + 2003 + 8i` (3 modulo
 * 8, apart from the offsets special-spawns.ts lists), `i` 0 for a trainer's party, the party index + 1 for a wild
 * Pokémon
 */
function getMoveConversionSeedOffset(index: number): number {
  return (globalScene.currentBattle?.waveIndex ?? 0) * 3000 + 2003 + 8 * index;
}

/**
 * Local fork (2026-11-19): turns every plain damaging slot of `pokemon` into its Max side, what a 다이사탕 gives it
 * (the G-Max move where the species rule picks it); status slots and converted slots stay as they are
 * @returns How many slots were converted
 */
function convertDamagingSlotsToMax(pokemon: Pokemon): number {
  let count = 0;
  for (const slot of pokemon.moveset) {
    if (!slot || slot.transform || slot.getMove().category === MoveCategory.STATUS) {
      continue;
    }
    const max = getMaxSide(pokemon, slot);
    if (!max) {
      continue;
    }
    slot.transform = { kind: max.kind, moveId: max.moveId };
    console.log(`[enemy-move-conversions] ${pokemon.name}'s ${MoveId[slot.moveId]} becomes ${MoveId[max.moveId]}`);
    count++;
  }
  return count;
}

/**
 * Local fork (2026-11-19): the final Endless trainer's fixed conversions, instead of the rolls (the user: "5850웨이브 적
 * 트레이너가 다이맥스와 다이맥스 기술은 사용하고, z기술은 에이스가 아닌 포켓몬이 한마리 확정으로 가지고 있도록 하죠"):
 * - its ace (`getEndlessFinalAce`, enemy-dynamax.ts, which then always gives it the Dynamax state): every damaging slot
 *   becomes a Max move ({@linkcode convertDamagingSlotsToMax}; a G-Max move where the 다이사탕 rule picks one), status
 *   slots stay;
 * - exactly one other member, drawn from {@linkcode enemyMoveConversionDice} among the ones with a slot that can take a
 *   Z-Move: one slot becomes a Z-Move ({@linkcode convertEnemyMoveSlot} with the Z side forced).
 * Called by {@linkcode rollTrainerMoveConversions}, on its seed offset.
 * @param party - The enemy party (`currentBattle.enemyParty`)
 * @returns The Pokémon that got a converted slot (the ace first)
 */
export function applyEndlessFinalMoveConversions(party: readonly EnemyPokemon[]): EnemyPokemon[] {
  const members = party.filter(p => !!p);
  const ace = getEndlessFinalAce(members);
  const converted: EnemyPokemon[] = [];
  if (ace && convertDamagingSlotsToMax(ace) > 0) {
    converted.push(ace);
  }
  const zPool = members.filter(p => p !== ace && getEnemyMoveConversionOptions(p).z.length > 0);
  if (zPool.length > 0) {
    const holder = zPool[enemyMoveConversionDice.roll(zPool.length)];
    if (convertEnemyMoveSlot(holder, "z")) {
      converted.push(holder);
    }
  }
  return converted;
}

/**
 * Local fork (2026-11-18): rolls, for each Pokémon of the enemy trainer's party in order, whether it comes with a
 * converted slot, until the party's cap ({@linkcode getTrainerMoveConversionCap}); called by encounter-phase.ts after
 * the trainer's battle form, fixed fusion and boss bars, before the party loads its sprites.
 * @param party - The enemy party (`currentBattle.enemyParty`)
 * @returns The Pokémon that got a converted slot
 */
export function rollTrainerMoveConversions(party: readonly EnemyPokemon[]): EnemyPokemon[] {
  const wave = getMoveConversionRollWave();
  const trainer = globalScene.currentBattle?.trainer;
  const converted: EnemyPokemon[] = [];
  if (wave == null || !trainer) {
    return converted;
  }
  // Local fork (2026-11-19): the final Endless trainer rolls nothing: fixed conversions (Max moves for its ace, one
  // Z-Move for another member), on the same seed offset
  if (isEndlessFinalTrainerBattle()) {
    globalScene.executeWithSeedOffset(() => {
      converted.push(...applyEndlessFinalMoveConversions(party));
    }, getMoveConversionSeedOffset(0));
    return converted;
  }
  const { battleType } = globalScene.currentBattle;
  const tier = getTrainerBattleFormTier(trainer.config);
  const members = party.filter(p => !!p);
  const cap = getTrainerMoveConversionCap(
    tier,
    members.some(p => p.isBoss()),
  );
  if (members.every(p => getEnemyMoveConversionChance(battleType, p.isBoss(), wave, tier) <= 0)) {
    return converted;
  }
  globalScene.executeWithSeedOffset(() => {
    for (const enemy of members) {
      if (converted.length >= cap) {
        break;
      }
      if (rollEnemyMoveConversion(enemy, getEnemyMoveConversionChance(battleType, enemy.isBoss(), wave, tier))) {
        converted.push(enemy);
      }
    }
  }, getMoveConversionSeedOffset(0));
  return converted;
}

/**
 * Local fork (2026-11-18): rolls whether a newly made wild Pokémon comes with a converted slot; called by
 * encounter-phase.ts for each wild Pokémon after its battle-form roll, before it loads its sprite.
 * @param enemy - The wild Pokémon
 * @param partyIndex - Its index in the enemy party (its own seed offset)
 * @returns Whether a slot was converted
 */
export function rollWildMoveConversion(enemy: EnemyPokemon, partyIndex: number): boolean {
  const wave = getMoveConversionRollWave();
  if (wave == null) {
    return false;
  }
  const chance = getEnemyMoveConversionChance(globalScene.currentBattle.battleType, enemy.isBoss(), wave);
  if (chance <= 0) {
    return false;
  }
  let converted = false;
  globalScene.executeWithSeedOffset(
    () => {
      converted = rollEnemyMoveConversion(enemy, chance);
    },
    getMoveConversionSeedOffset(partyIndex + 1),
  );
  return converted;
}
