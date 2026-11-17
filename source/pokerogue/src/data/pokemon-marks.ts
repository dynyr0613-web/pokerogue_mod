/*
 * Local fork (2026-11-17): marks (증표) and memorial ribbons (리본), the main series' collectibles a single Pokémon
 * carries. Only the ones this game can give are here:
 *
 * - Marks: a wild Pokémon may be met with one (`rollWildMark`, the Sword / Shield odds). The Cloudy, Fishing, Curry,
 *   Destiny, size and picnic marks have nothing to stand for here and are left out.
 * - Ribbons: the party that beats a champion gets that champion's ribbon (`TRAINER_RIBBONS`). Lance, Alder and Iris
 *   have none because the main series has no Johto or Unova champion ribbon.
 * - The Alpha Mark and the Golden Alpha Mark belong to alpha Pokémon (alpha-pokemon.ts).
 *
 * A Pokémon's marks are `Pokemon.marks`, saved with it (`PokemonData.marks`) and shown on the Pokédex page opened
 * from the party (`MarkTray`). The icons are the atlas `marks` (tools/port/make_marks_atlas.py).
 */

import { globalScene } from "#app/global-scene";
import { PokemonMark } from "#enums/pokemon-mark";
import { TimeOfDay } from "#enums/time-of-day";
import { TrainerType } from "#enums/trainer-type";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { randSeedInt, randSeedItem } from "#utils/common";
import { toCamelCase } from "#utils/strings";
import i18next from "i18next";

/** The key of the icon atlas, `images/marks/marks.png`; each frame is named after its mark (`getMarkKey`) */
export const MARKS_ATLAS_KEY = "marks";

/** Every mark and ribbon in the order the tray shows them: ribbons, then the alpha marks, then the wild marks */
export const orderedPokemonMarks: readonly PokemonMark[] = [
  PokemonMark.CHAMPION_RIBBON,
  PokemonMark.HOENN_CHAMPION_RIBBON,
  PokemonMark.SINNOH_CHAMPION_RIBBON,
  PokemonMark.KALOS_CHAMPION_RIBBON,
  PokemonMark.ALOLA_CHAMPION_RIBBON,
  PokemonMark.GALAR_CHAMPION_RIBBON,
  PokemonMark.PALDEA_CHAMPION_RIBBON,
  PokemonMark.LEGEND_RIBBON,
  PokemonMark.GOLDEN_ALPHA_MARK,
  PokemonMark.ALPHA_MARK,
  PokemonMark.LUNCHTIME_MARK,
  PokemonMark.SLEEPY_TIME_MARK,
  PokemonMark.DUSK_MARK,
  PokemonMark.DAWN_MARK,
  PokemonMark.RAINY_MARK,
  PokemonMark.STORMY_MARK,
  PokemonMark.SNOWY_MARK,
  PokemonMark.BLIZZARD_MARK,
  PokemonMark.DRY_MARK,
  PokemonMark.SANDSTORM_MARK,
  PokemonMark.MISTY_MARK,
  PokemonMark.UNCOMMON_MARK,
  PokemonMark.RARE_MARK,
  PokemonMark.ROWDY_MARK,
  PokemonMark.ABSENT_MINDED_MARK,
  PokemonMark.JITTERY_MARK,
  PokemonMark.EXCITED_MARK,
  PokemonMark.CHARISMATIC_MARK,
  PokemonMark.CALMNESS_MARK,
  PokemonMark.INTENSE_MARK,
  PokemonMark.ZONED_OUT_MARK,
  PokemonMark.JOYFUL_MARK,
  PokemonMark.ANGRY_MARK,
  PokemonMark.SMILEY_MARK,
  PokemonMark.TEARY_MARK,
  PokemonMark.UPBEAT_MARK,
  PokemonMark.PEEVED_MARK,
  PokemonMark.INTELLECTUAL_MARK,
  PokemonMark.FEROCIOUS_MARK,
  PokemonMark.CRAFTY_MARK,
  PokemonMark.SCOWLING_MARK,
  PokemonMark.KINDLY_MARK,
  PokemonMark.FLUSTERED_MARK,
  PokemonMark.PUMPED_UP_MARK,
  PokemonMark.ZERO_ENERGY_MARK,
  PokemonMark.PRIDEFUL_MARK,
  PokemonMark.UNSURE_MARK,
  PokemonMark.HUMBLE_MARK,
  PokemonMark.THORNY_MARK,
  PokemonMark.VIGOR_MARK,
  PokemonMark.SLUMP_MARK,
];

/** The 28 personality marks, one of which a wild Pokémon has 1 time in 100 */
const PERSONALITY_MARKS: readonly PokemonMark[] = orderedPokemonMarks.filter(
  m => m >= PokemonMark.ROWDY_MARK && m <= PokemonMark.SLUMP_MARK,
);

/** The mark of each time of day */
const TIME_MARKS: Partial<Record<TimeOfDay, PokemonMark>> = {
  [TimeOfDay.DAWN]: PokemonMark.DAWN_MARK,
  [TimeOfDay.DAY]: PokemonMark.LUNCHTIME_MARK,
  [TimeOfDay.DUSK]: PokemonMark.DUSK_MARK,
  [TimeOfDay.NIGHT]: PokemonMark.SLEEPY_TIME_MARK,
};

/** The mark of each weather; none for clear skies and strong winds */
const WEATHER_MARKS: Partial<Record<WeatherType, PokemonMark>> = {
  [WeatherType.RAIN]: PokemonMark.RAINY_MARK,
  [WeatherType.HEAVY_RAIN]: PokemonMark.STORMY_MARK,
  [WeatherType.SNOW]: PokemonMark.SNOWY_MARK,
  [WeatherType.HAIL]: PokemonMark.BLIZZARD_MARK,
  [WeatherType.SUNNY]: PokemonMark.DRY_MARK,
  [WeatherType.HARSH_SUN]: PokemonMark.DRY_MARK,
  [WeatherType.SANDSTORM]: PokemonMark.SANDSTORM_MARK,
  [WeatherType.FOG]: PokemonMark.MISTY_MARK,
};

/** The ribbon the party gets for beating each champion that has one in the main series */
export const TRAINER_RIBBONS: Partial<Record<TrainerType, PokemonMark>> = {
  [TrainerType.BLUE]: PokemonMark.CHAMPION_RIBBON,
  [TrainerType.RED]: PokemonMark.LEGEND_RIBBON,
  [TrainerType.STEVEN]: PokemonMark.HOENN_CHAMPION_RIBBON,
  [TrainerType.WALLACE]: PokemonMark.HOENN_CHAMPION_RIBBON,
  [TrainerType.CYNTHIA]: PokemonMark.SINNOH_CHAMPION_RIBBON,
  [TrainerType.DIANTHA]: PokemonMark.KALOS_CHAMPION_RIBBON,
  [TrainerType.KUKUI]: PokemonMark.ALOLA_CHAMPION_RIBBON,
  [TrainerType.HAU]: PokemonMark.ALOLA_CHAMPION_RIBBON,
  [TrainerType.LEON]: PokemonMark.GALAR_CHAMPION_RIBBON,
  [TrainerType.MUSTARD]: PokemonMark.GALAR_CHAMPION_RIBBON,
  [TrainerType.GEETA]: PokemonMark.PALDEA_CHAMPION_RIBBON,
  [TrainerType.NEMONA]: PokemonMark.PALDEA_CHAMPION_RIBBON,
  [TrainerType.KIERAN]: PokemonMark.PALDEA_CHAMPION_RIBBON,
};

/** @returns Whether `value` is a mark or ribbon this build knows */
export function isPokemonMark(value: unknown): value is PokemonMark {
  return typeof value === "number" && orderedPokemonMarks.includes(value);
}

/** @returns Whether the mark is a memorial ribbon (as opposed to a mark) */
export function isRibbon(mark: PokemonMark): boolean {
  return mark < PokemonMark.LUNCHTIME_MARK;
}

/**
 * Clean a saved or copied mark list: known marks only, each once, in the order they were earned.
 * @param marks - `Pokemon.marks` or `PokemonData.marks` of any save (missing in older ones)
 * @returns A new array
 */
export function normalizeMarks(marks: unknown): PokemonMark[] {
  if (!Array.isArray(marks)) {
    return [];
  }
  return [...new Set(marks.filter(isPokemonMark))];
}

/** @returns The mark's locale key and atlas frame, e.g. `sleepyTimeMark` */
export function getMarkKey(mark: PokemonMark): string {
  return toCamelCase(PokemonMark[mark]);
}

export function getMarkName(mark: PokemonMark): string {
  return i18next.t(`pokemonMarks:${getMarkKey(mark)}.name`);
}

export function getMarkDescription(mark: PokemonMark): string {
  return i18next.t(`pokemonMarks:${getMarkKey(mark)}.description`);
}

/**
 * Roll the mark a wild Pokémon is met with, by the odds of Sword and Shield: in this order a rare mark (1 in 1000), a
 * personality mark (1 in 100), the uncommon mark (1 in 50), the weather's mark (1 in 50) and the time of day's mark
 * (1 in 50); the first hit is the mark. About 1 wild Pokémon in 15 has one.
 * Uses the seeded RNG, so call it inside `executeWithSeedOffset`.
 * @param timeOfDay - The arena's time of day
 * @param weather - The arena's weather
 * @returns The mark, or `null` for none
 */
export function rollWildMark(timeOfDay: TimeOfDay, weather: WeatherType): PokemonMark | null {
  if (!randSeedInt(1000)) {
    return PokemonMark.RARE_MARK;
  }
  if (!randSeedInt(100)) {
    return randSeedItem(PERSONALITY_MARKS);
  }
  if (!randSeedInt(50)) {
    return PokemonMark.UNCOMMON_MARK;
  }
  const weatherMark = WEATHER_MARKS[weather];
  if (weatherMark !== undefined && !randSeedInt(50)) {
    return weatherMark;
  }
  const timeMark = TIME_MARKS[timeOfDay];
  if (timeMark !== undefined && !randSeedInt(50)) {
    return timeMark;
  }
  return null;
}

/**
 * Give a freshly generated wild Pokémon its mark, if the roll says so. The roll has its own seed (the wave's, offset by
 * the Pokémon's place in the enemy party), so it changes nothing else the wave generates.
 * @param pokemon - The wild Pokémon
 */
export function applyWildMark(pokemon: Pokemon): void {
  const battle = globalScene.currentBattle;
  if (!battle || !globalScene.arena) {
    return;
  }
  globalScene.executeWithSeedOffset(
    () => {
      const mark = rollWildMark(globalScene.arena.getTimeOfDay(), globalScene.arena.weatherType);
      if (mark !== null) {
        pokemon.addMark(mark);
      }
    },
    battle.waveIndex * 16 + battle.enemyParty.length + 7919,
    globalScene.waveSeed,
  );
}

/**
 * Give the player's whole party the ribbon of the champion it has just beaten, as entering the Hall of Fame does in
 * the main series.
 * @param trainerType - The beaten trainer
 * @returns The ribbon if at least one party member did not have it yet, otherwise `null`
 */
export function awardTrainerRibbon(trainerType: TrainerType): PokemonMark | null {
  const ribbon = TRAINER_RIBBONS[trainerType];
  if (ribbon === undefined) {
    return null;
  }
  let awarded = false;
  for (const pokemon of globalScene.getPlayerParty()) {
    awarded = pokemon.addMark(ribbon) || awarded;
  }
  return awarded ? ribbon : null;
}
