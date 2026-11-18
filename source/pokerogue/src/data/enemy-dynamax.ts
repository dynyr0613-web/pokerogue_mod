/**
 * Local fork (2026-11-18): enemy Pokémon in the Dynamax state (pokemon-forms-dynamax.ts). The user: "적 다이맥스 상태
 * 넣고".
 *
 * - The state: an enemy holding active Max Mushrooms (다이버섯) in no G-Max / E-Max form is in the Dynamax state as one
 *   of the player's Pokémon is (`isInDynamaxState`): its form, ability and passive stay, its max HP is x1.5 (after every
 *   other multiplier: the Endless boss-bar correction, an alpha's boost, the raid's) and it is drawn x1.5, the field
 *   zooming out for it. `Pokemon.isDynamaxed()` is true for it. Its HP starts full at the new max.
 * - The item: the roll gives the enemy Max Mushrooms made as the battle-form items are (`newFormChangeItem`,
 *   enemy-battle-forms.ts): active and not transferable, so Thief / Covet / Knock Off / Pickpocket / Magician / Grip
 *   Claw and the post-battle loot never take them, and they show in the enemy's item bar. They are saved with the
 *   enemy's items, so the state needs no save field and a reloaded wave has it again without a roll. An enemy's
 *   mushrooms never change its form (the item form-change trigger reads only the player's items), a G-Max species' in
 *   its base form included: the G-Max form stays the battle-form roll's.
 * - Chances ({@linkcode ENEMY_DYNAMAX}): by the difficulty wave (`gameMode.getWaveForDifficulty`), in every game mode,
 *   nothing before wave 50: per trainer BATTLE (one roll, since 2026-11-18's review: rolling every member made it up
 *   to 95% of elite battles), an ordinary trainer 3%, +2 every 100 waves, at most 20%; an elite or boss trainer
 *   (`getTrainerBattleFormTier`), or a party with boss bars, 8%, +4 every 100 waves, at most 40%; and on a hit its ace
 *   gets it ({@linkcode getTrainerDynamaxOrder}: the most boss bars, then the highest level, then the later party slot;
 *   the next one if the ace cannot take it). Per wild Pokémon: 1%; a wild boss 5%, +2 every 100 waves, at most 20%.
 * - Who ({@linkcode canTakeEnemyDynamax}): not in a G-Max / E-Max form, its own or its fusion's (it is Dynamaxed
 *   already), not Eternatus (head or tail), not the Endless raid's boss (its HP has the raid's own multiplier), not one
 *   already holding Max Mushrooms. A Mega / Primal enemy may (Mega + Dynamax, as for the player), and so may a fusion
 *   (its form does not change) and a Terastallized one.
 * - Never in a mystery-encounter battle, for the Classic final boss or for the Daily final boss
 *   (`getBattleFormRollWave`, as the battle forms and the Z / Max move conversions).
 * - Hooks (encounter-phase.ts, inside the new-wave `!loaded` blocks): the last of the enemy rolls, after the battle forms
 *   and fixed fusions, the Endless boss bars and the Z / Max move conversions (`rollTrainerMoveConversions` /
 *   `rollWildMoveConversion`), so the HP it multiplies is final; before the Pokédex, the boss-bar split of a double
 *   wild battle, the sprites and the HP shown. The order with the move conversions changes nothing (each has its own
 *   seed and neither reads the other).
 * - Seeds: the rolls run through `executeWithSeedOffset` on their own offsets ({@linkcode getEnemyDynamaxSeedOffset}),
 *   which restores the running RNG afterwards, so every other draw of the wave is as before.
 * - Terastallization: the enemy rules stay (`isTeraBlockedForm`: a Mega / Primal / G-Max form or Ultra Necrozma). The
 *   state is no form, so an enemy in it (not Mega) may Terastallize, as the player's may; a Mega one with it still may
 *   not, for its Mega form.
 * - Capture ({@linkcode prepareEnemyDynamaxCapture}, attempt-capture-phase.ts and `catchPokemon`, before
 *   `prepareBattleFormCapture`): the caught Pokémon leaves every Max Mushrooms the enemy held behind and its HP drops
 *   back in proportion, so the player gets neither the mushrooms nor the x1.5 HP.
 *
 * Tests force the rolls through {@linkcode enemyDynamaxDice} or read {@linkcode getEnemyDynamaxChance}.
 */

import { globalScene } from "#app/global-scene";
import { isRaidBoss } from "#data/endless-raid";
import {
  type BattleFormChanceCurve,
  getBattleFormChanceAt,
  getBattleFormRollWave,
  getTrainerBattleFormTier,
  newFormChangeItem,
  type TrainerBattleFormTier,
} from "#data/enemy-battle-forms";
import { holdsMaxMushrooms, isInDynamaxState } from "#data/pokemon-forms-dynamax";
import { BattleType } from "#enums/battle-type";
import { FormChangeItem } from "#enums/form-change-item";
import { SpeciesId } from "#enums/species-id";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";
import { PokemonFormChangeItemModifier } from "#modifiers/modifier";
import { randSeedInt } from "#utils/common";

/**
 * Local fork (2026-11-18): a trainer entry of {@linkcode ENEMY_DYNAMAX}: a `BattleFormChanceCurve` (`chance` at
 * `minWave`, plus `step` every `everyWaves` waves, at most `max`) per Pokémon, with the party's cap and roll order
 */
export interface TrainerDynamaxChanceCurve extends BattleFormChanceCurve {
  /** At most this many Pokémon of one trainer's party are Dynamaxed */
  readonly perParty: number;
  /** Whether the party rolls from its ace down ({@linkcode getTrainerDynamaxOrder}); else in party order */
  readonly aceFirst: boolean;
}

/**
 * Local fork (2026-11-18): every number of the enemy Dynamax state, in one place.
 * - `trainer`: per trainer tier (`getTrainerBattleFormTier`: `ordinary`, `elite`, `boss`), the percent chance per
 *   trainer battle (one roll, at the chance of the first Pokémon in order), `perParty`, the most Pokémon of one party
 *   that get it, and `aceFirst`, the order (ace first for every tier since 2026-11-18); a party with boss bars uses the
 *   `boss` chance and order;
 *   - `ordinary`: 3% at wave 50, +2 every 100 waves (5% at 150), 20% from wave 950; 1 per party, its ace;
 *   - `elite`: 8% at wave 50, +4 every 100 waves (12% at 150), 40% from wave 850; 1 per party, from the ace down;
 *   - `boss`: the elite numbers, an entry of their own so the two can be tuned apart;
 * - `wild`: the percent chance per ordinary wild Pokémon, from wave 50;
 * - `wildBoss`: the same per wild boss (`isBoss()`): 5% at wave 50, +2 every 100 waves, 20% from wave 850.
 */
export const ENEMY_DYNAMAX = Object.freeze({
  trainer: Object.freeze({
    ordinary: Object.freeze({
      chance: 3,
      step: 2,
      everyWaves: 100,
      max: 20,
      minWave: 50,
      perParty: 1,
      aceFirst: true,
    }),
    elite: Object.freeze({ chance: 8, step: 4, everyWaves: 100, max: 40, minWave: 50, perParty: 1, aceFirst: true }),
    boss: Object.freeze({ chance: 8, step: 4, everyWaves: 100, max: 40, minWave: 50, perParty: 1, aceFirst: true }),
  }) satisfies Readonly<Record<TrainerBattleFormTier, TrainerDynamaxChanceCurve>>,
  wild: Object.freeze({ chance: 1, minWave: 50 }) satisfies BattleFormChanceCurve,
  wildBoss: Object.freeze({
    chance: 5,
    step: 2,
    everyWaves: 100,
    max: 20,
    minWave: 50,
  }) satisfies BattleFormChanceCurve,
});

/**
 * Local fork (2026-11-18): the seeded roller of the enemy Dynamax rolls (`roll(range)` returns an integer in
 * [0, range)). A test hook: tests stub `roll` with `vi.spyOn(enemyDynamaxDice, "roll")` to force an outcome; game code
 * never replaces it. Kept apart from {@linkcode ENEMY_DYNAMAX}, which stays frozen.
 */
export const enemyDynamaxDice = {
  roll: (range: number): number => randSeedInt(range),
};

/**
 * Local fork (2026-11-18): the percent chance that an enemy Pokémon comes in the Dynamax state
 * ({@linkcode ENEMY_DYNAMAX}); 0 before the entry's `minWave` and for other battles.
 * @param battleType - The battle's type
 * @param isBoss - Whether the Pokémon has boss bars (a trainer's then uses the `boss` entry)
 * @param difficultyWave - The wave for difficulty (`gameMode.getWaveForDifficulty`)
 * @param trainerTier - The trainer's tier (`getTrainerBattleFormTier`; ignored for wild Pokémon); default `ordinary`
 */
export function getEnemyDynamaxChance(
  battleType: BattleType,
  isBoss: boolean,
  difficultyWave: number,
  trainerTier: TrainerBattleFormTier = "ordinary",
): number {
  let entry: BattleFormChanceCurve;
  if (battleType === BattleType.TRAINER) {
    entry = ENEMY_DYNAMAX.trainer[isBoss ? "boss" : trainerTier];
  } else if (battleType === BattleType.WILD) {
    entry = isBoss ? ENEMY_DYNAMAX.wildBoss : ENEMY_DYNAMAX.wild;
  } else {
    return 0;
  }
  return getBattleFormChanceAt(entry, difficultyWave);
}

/**
 * Local fork (2026-11-18): how a trainer's party rolls ({@linkcode TrainerDynamaxChanceCurve}): its tier's cap and order,
 * the `boss` entry's taken in (the larger cap, the ace first) when a member has boss bars
 * @param trainerTier - The trainer's tier
 * @param hasBossMember - Whether a member of the party has boss bars
 */
export function getTrainerDynamaxRule(
  trainerTier: TrainerBattleFormTier,
  hasBossMember: boolean,
): { perParty: number; aceFirst: boolean } {
  const { trainer } = ENEMY_DYNAMAX;
  const { perParty, aceFirst } = trainer[trainerTier];
  if (!hasBossMember) {
    return { perParty, aceFirst };
  }
  return { perParty: Math.max(perParty, trainer.boss.perParty), aceFirst: aceFirst || trainer.boss.aceFirst };
}

/**
 * Local fork (2026-11-18): the order in which a trainer's party rolls: party order, or with `aceFirst` from its ace down:
 * the most boss bars first (an Endless boss trainer's ace past wave 200, endless-boss-bars.ts), then the highest level,
 * then the later party slot (a trainer's ace is its last and strongest member)
 * @param members - The party's members, in party order
 * @param aceFirst - Whether the ace rolls first
 */
export function getTrainerDynamaxOrder(members: readonly EnemyPokemon[], aceFirst: boolean): EnemyPokemon[] {
  if (!aceFirst) {
    return members.slice();
  }
  return members
    .map((pokemon, index) => ({ pokemon, index, bars: pokemon.bossSegments ?? 0 }))
    .sort((a, b) => b.bars - a.bars || b.pokemon.level - a.pokemon.level || b.index - a.index)
    .map(({ pokemon }) => pokemon);
}

/** Whether `pokemon` is Eternatus, as its head or its fusion's tail */
function hasEternatus(pokemon: Pokemon): boolean {
  return pokemon.species.speciesId === SpeciesId.ETERNATUS || pokemon.fusionSpecies?.speciesId === SpeciesId.ETERNATUS;
}

/**
 * Local fork (2026-11-18): whether the enemy `pokemon` can be put in the Dynamax state: not in a G-Max / E-Max form
 * (its own or its fusion's, `isMax`: it is Dynamaxed already), not Eternatus (head or tail), not the Endless raid's
 * boss, not already holding Max Mushrooms. A Mega / Primal form, a fusion and Terastallization are no obstacle.
 */
export function canTakeEnemyDynamax(pokemon: Pokemon): boolean {
  return (
    pokemon.isEnemy()
    && !pokemon.isMax()
    && !hasEternatus(pokemon)
    && !isRaidBoss(pokemon)
    && !holdsMaxMushrooms(pokemon)
  );
}

/**
 * Local fork (2026-11-18): puts the enemy in the Dynamax state (no roll): gives it Max Mushrooms, active and not
 * transferable (adding them changes no form and redraws it x1.5, `PokemonFormChangeItemModifier.apply`), then works
 * out its stats (max HP x1.5) and starts it at the new max HP when it was full (a new enemy always is).
 * @returns Whether it is in the state now (`false` when {@linkcode canTakeEnemyDynamax} says no)
 */
export function giveEnemyDynamax(enemy: EnemyPokemon): boolean {
  if (!canTakeEnemyDynamax(enemy)) {
    return false;
  }
  const wasFull = enemy.hp >= enemy.getMaxHp();
  globalScene.addEnemyModifier(newFormChangeItem(FormChangeItem.MAX_MUSHROOMS, enemy), true);
  enemy.calculateStats();
  if (wasFull) {
    enemy.hp = enemy.getMaxHp();
  }
  enemy.updateScale();
  console.log(`[enemy-dynamax] ${enemy.name} is Dynamaxed (${enemy.getMaxHp()} HP)`);
  return isInDynamaxState(enemy);
}

/**
 * Local fork (2026-11-18): the seed offset of the Dynamax rolls of the current wave: `3000w + 2005 + 8i` (5 modulo 8,
 * apart from the offsets special-spawns.ts lists and from the move conversions' 3 modulo 8), `i` 0 for a trainer's
 * party, the party index + 1 for a wild Pokémon
 */
export function getEnemyDynamaxSeedOffset(index: number): number {
  return (globalScene.currentBattle?.waveIndex ?? 0) * 3000 + 2005 + 8 * index;
}

/**
 * Local fork (2026-11-18): rolls, for the members of the enemy trainer's party that can take it
 * ({@linkcode canTakeEnemyDynamax}) one after another ({@linkcode getTrainerDynamaxOrder}), whether one comes in the
 * Dynamax state, until the party's cap; called by encounter-phase.ts after the trainer's battle form, fixed fusion,
 * boss bars and move conversions, before the party loads its sprites. Nothing is rolled for an ineligible member or
 * when every chance is 0.
 * @param party - The enemy party (`currentBattle.enemyParty`)
 * @returns The Pokémon put in the state
 */
export function rollTrainerDynamax(party: readonly EnemyPokemon[]): EnemyPokemon[] {
  const wave = getBattleFormRollWave();
  const trainer = globalScene.currentBattle?.trainer;
  const dynamaxed: EnemyPokemon[] = [];
  if (wave == null || !trainer) {
    return dynamaxed;
  }
  const { battleType } = globalScene.currentBattle;
  const tier = getTrainerBattleFormTier(trainer.config);
  const members = party.filter(p => !!p);
  const { perParty, aceFirst } = getTrainerDynamaxRule(
    tier,
    members.some(p => p.isBoss()),
  );
  const chanceOf = (p: EnemyPokemon) => getEnemyDynamaxChance(battleType, p.isBoss(), wave, tier);
  const candidates = getTrainerDynamaxOrder(members.filter(canTakeEnemyDynamax), aceFirst).filter(p => chanceOf(p) > 0);
  if (candidates.length === 0) {
    return dynamaxed;
  }
  globalScene.executeWithSeedOffset(() => {
    // Local fork (2026-11-18): ONE roll per trainer battle, at the chance of the first in order (its ace), so the
    // table's numbers are the chance per battle (rolling every member until the cap made an elite trainer's party
    // Dynamax in up to 95% of battles); on a hit the first that can take it (the ace) gets it
    if (enemyDynamaxDice.roll(100) >= chanceOf(candidates[0])) {
      return;
    }
    for (const enemy of candidates) {
      if (dynamaxed.length >= perParty) {
        break;
      }
      if (giveEnemyDynamax(enemy)) {
        dynamaxed.push(enemy);
      }
    }
  }, getEnemyDynamaxSeedOffset(0));
  return dynamaxed;
}

/**
 * Local fork (2026-11-18): rolls whether a newly made wild Pokémon comes in the Dynamax state; called by
 * encounter-phase.ts for each wild Pokémon after its battle form and move conversion, before it loads its sprite.
 * Nothing is rolled when it is not eligible or its chance is 0.
 * @param enemy - The wild Pokémon
 * @param partyIndex - Its index in the enemy party (its own seed offset)
 * @returns Whether it was put in the state
 */
export function rollWildDynamax(enemy: EnemyPokemon, partyIndex: number): boolean {
  const wave = getBattleFormRollWave();
  if (wave == null || !canTakeEnemyDynamax(enemy)) {
    return false;
  }
  const chance = getEnemyDynamaxChance(globalScene.currentBattle.battleType, enemy.isBoss(), wave);
  if (chance <= 0) {
    return false;
  }
  let given = false;
  globalScene.executeWithSeedOffset(
    () => {
      given = enemyDynamaxDice.roll(100) < chance && giveEnemyDynamax(enemy);
    },
    getEnemyDynamaxSeedOffset(partyIndex + 1),
  );
  return given;
}

/**
 * Local fork (2026-11-18): readies a just-caught enemy for the capture code, which then copies the Pokémon and its
 * side's items to the player; called first thing by the capture code, before `prepareBattleFormCapture`: every Max
 * Mushrooms the enemy holds (the Dynamax state's, or a G-Max form's, which `prepareBattleFormCapture` would take off
 * anyway) is taken off it, and when it was in the Dynamax state its stats are worked out again, so its max HP loses the
 * x1.5 and its current HP keeps its ratio (`Pokemon.calculateStats`). Taking them off first also keeps a G-Max enemy
 * that `prepareBattleFormCapture` turns back to its base form out of the state while its stats are worked out.
 */
export function prepareEnemyDynamaxCapture(pokemon: EnemyPokemon): void {
  const mushrooms = globalScene.findModifiers(
    m =>
      m instanceof PokemonFormChangeItemModifier
      && m.pokemonId === pokemon.id
      && m.formChangeItem === FormChangeItem.MAX_MUSHROOMS,
    false,
  );
  if (mushrooms.length === 0) {
    return;
  }
  const wasInState = isInDynamaxState(pokemon);
  for (const modifier of mushrooms) {
    // Its apply changes no form and redraws the sprite at its own scale (PokemonFormChangeItemModifier.apply)
    globalScene.removeModifier(modifier, true);
  }
  if (wasInState) {
    pokemon.calculateStats();
  }
  pokemon.updateScale();
}
