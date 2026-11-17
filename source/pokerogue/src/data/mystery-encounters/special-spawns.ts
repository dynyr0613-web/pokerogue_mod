/**
 * Local fork (2026-11-08): special spawns of mystery encounters in Endless, in one ordered table, so a new one is
 * one entry of {@linkcode SPECIAL_ENCOUNTER_SPAWNS}.
 *
 * A special spawn makes a wave its encounter whatever the normal encounter roll, the spacing between encounters, the
 * biome's encounter list or a trainer wave say (`BattleScene.isWaveMysteryEncounter` and `getMysteryEncounter` ask
 * {@linkcode getForcedSpecialEncounter}). A wave loaded from a save keeps the encounter it was saved with.
 *
 * Kept free of encounter and phase imports (like dark-gts-spawn.ts) so `BattleScene` can use it without import cycles.
 *
 * Seed offsets: every roll runs on its own offset of the session seed through `executeWithSeedOffset`, so it gives the
 * same answer each time it is asked (when the wave is generated, when its encounter is picked, after a reload).
 * `shiftCharCodes` adds the offset to every char code of the seed and `String.fromCharCode` keeps it modulo 65536, so
 * two offsets give the same seed exactly when they are equal modulo 65536. Since 65536 is a multiple of 8, an offset's
 * remainder modulo 8 survives that wrap. The rolls that must stay apart, for every wave `w` and every whole number `a`:
 * - the Endless/Classic mystery encounter roll, `3000a`: 3000 = 8 * 375, so always 0 modulo 8;
 * - the "GTS?" roll, `3000a + 1500`: 1500 = 8 * 187 + 4, so always 4 modulo 8;
 * - the encounter pick in EncounterPhase, `16a`: always 0 modulo 8;
 * - the "Mysterious Chest?" roll, `3000w + 777`: 777 = 8 * 97 + 1, so always 1 modulo 8, never equal to any of them.
 * A later entry keeps the rule with another odd constant (1 modulo 8 is taken by the chest: use 3, 5 or 7 modulo 8).
 */
import { globalScene } from "#app/global-scene";
import { GameModes } from "#enums/game-modes";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
// The "GTS?" rule stays in dark-gts-spawn.ts: isNewBiome and SelectBiomePhase use it alone to move its wave into the End
import { isDarkGtsEndWave } from "#mystery-encounters/dark-gts-spawn";
import { randSeedInt } from "#utils/common";

/** Every special-spawn roll is out of this many; chances are whole numbers of it */
export const SPECIAL_SPAWN_ROLL_RANGE = 1000;

/** "Mysterious Chest?": 77 in 1000 on its waves */
export const DARK_CHEST_SPAWN_CHANCE = 77;

/** One special spawn */
export interface SpecialEncounterSpawn {
  /** The encounter the wave becomes */
  readonly type: MysteryEncounterType;
  /** Whether `waveIndex` is this encounter's wave (its roll hit and anything it needs right now holds) */
  readonly isForcedOn: (waveIndex: number) => boolean;
}

/** Whether the run is Endless or Spliced Endless, the only modes with special spawns */
function isEndlessRun(): boolean {
  const modeId = globalScene.gameMode?.modeId;
  return modeId === GameModes.ENDLESS || modeId === GameModes.SPLICED_ENDLESS;
}

/**
 * Rolls `chance` (0 to 1, a whole number of {@linkcode SPECIAL_SPAWN_ROLL_RANGE}) on `seedOffset` of the session seed.
 * Draws nothing from the running RNG: `executeWithSeedOffset` restores its state afterwards.
 */
export function rollSpecialSpawn(chance: number, seedOffset: number): boolean {
  if (chance <= 0) {
    return false;
  }
  let roll = SPECIAL_SPAWN_ROLL_RANGE;
  globalScene.executeWithSeedOffset(() => {
    roll = randSeedInt(SPECIAL_SPAWN_ROLL_RANGE);
  }, seedOffset);
  return roll < Math.round(chance * SPECIAL_SPAWN_ROLL_RANGE);
}

/** Seed offset of the "Mysterious Chest?" roll on `waveIndex`: always 1 modulo 8 (see the top of this file) */
export function getDarkChestSeedOffset(waveIndex: number): number {
  return waveIndex * 3000 + 777;
}

/**
 * The chance (0 to 1) that `waveIndex` is a "Mysterious Chest?" wave: 77/1000 on waves 777, 1777, 2777, ... of Endless
 * and Spliced Endless, 0 elsewhere.
 */
export function getDarkChestWaveChance(waveIndex: number): number {
  if (!isEndlessRun() || waveIndex % 1000 !== 777) {
    return 0;
  }
  return DARK_CHEST_SPAWN_CHANCE / SPECIAL_SPAWN_ROLL_RANGE;
}

/** Whether the roll makes `waveIndex` a "Mysterious Chest?" wave (the wave stays in its biome) */
export function isDarkChestWave(waveIndex: number): boolean {
  return rollSpecialSpawn(getDarkChestWaveChance(waveIndex), getDarkChestSeedOffset(waveIndex));
}

/**
 * The chest's own party requirement (2 Pokémon able to battle, like the official chest): its trap knocks one out, so
 * a lone Pokémon would lose the run to it. Without it the wave stays an ordinary wave.
 */
function darkChestPartyAllows(): boolean {
  return globalScene.getPokemonAllowedInBattle().length >= 2;
}

/** In priority order: the first entry whose wave it is decides the wave */
export const SPECIAL_ENCOUNTER_SPAWNS: readonly SpecialEncounterSpawn[] = [
  // "GTS?": the wave before an Eternatus (249, 499, ...), moved into the End by its own rule in dark-gts-spawn.ts
  { type: MysteryEncounterType.DARK_GLOBAL_TRADE_SYSTEM, isForcedOn: waveIndex => isDarkGtsEndWave(waveIndex) },
  // "Mysterious Chest?": waves 777, 1777, 2777, ..., in whatever biome the run is in
  {
    type: MysteryEncounterType.DARK_MYSTERIOUS_CHEST,
    isForcedOn: waveIndex => isDarkChestWave(waveIndex) && darkChestPartyAllows(),
  },
];

/** The encounter a special spawn forces on `waveIndex`, or `null` when the wave is left to the normal rolls */
export function getForcedSpecialEncounter(waveIndex: number): MysteryEncounterType | null {
  for (const spawn of SPECIAL_ENCOUNTER_SPAWNS) {
    if (spawn.isForcedOn(waveIndex)) {
      return spawn.type;
    }
  }
  return null;
}
