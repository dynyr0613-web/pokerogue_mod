/*
 * Local fork (2026-11-17): marks (증표) and memorial ribbons (리본), the main series' collectibles a single Pokémon
 * carries. Only the ones this game can give are here:
 *
 * - Marks: a wild Pokémon may be met with one (`rollWildMark`, the Sword / Shield odds). The Cloudy, Fishing, Curry,
 *   Destiny, size and picnic marks have nothing to stand for here and are left out.
 * - Ribbons: the party that beats a champion gets that champion's ribbon (`TRAINER_RIBBONS`). Lance, Alder and Iris
 *   have none because the main series has no Johto or Unova champion ribbon.
 * - The Alpha, Golden Alpha and Jumbo Marks belong to alpha Pokémon, the Mini Mark to a wild Pokémon met small
 *   (alpha-pokemon.ts).
 * - The Once-in-a-Lifetime Ribbon comes with 1 Hyper GTS Wonder Trade Pokémon in 10, the Partner Mark is bought for
 *   a starter with candy, and a shiny Pokémon that is caught or hatched gets its tier's shiny mark.
 * - The Eternatus Mark is the player's own hidden mark, not a Pokémon's (`hasEternatusMark`).
 * - The Mightiest Mark is defined and shown, but nothing gives it yet (see the enum).
 * - The Best Friends Ribbon is bought after the Partner Mark; the six stat effort ribbons, the Effort Ribbon and the
 *   two footprint ribbons are earned during a run (`awardProgressRibbons`); the Endless Master Ribbon goes to the
 *   party that clears Endless (`awardPartyRibbon`).
 *
 * One mark can be worn (`Pokemon.equippedMark`): its title goes before the Pokémon's name (`getPokemonTitle`). Each
 * starter line remembers the marks its Pokémon have collected (`StarterDataEntry.marks`), and a starter can be taken
 * wearing one of them.
 *
 * A Pokémon's marks are `Pokemon.marks`, saved with it (`PokemonData.marks`) and shown on the Pokédex page opened
 * from the party (`MarkTray`). The icons are the atlas `marks` (tools/port/make_marks_atlas.py).
 */

import { globalScene } from "#app/global-scene";
import { PokemonMark } from "#enums/pokemon-mark";
import { SpeciesId } from "#enums/species-id";
import { PERMANENT_STATS, type PermanentStat, Stat } from "#enums/stat";
import { TimeOfDay } from "#enums/time-of-day";
import { TrainerType } from "#enums/trainer-type";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { getEvCap } from "#modifiers/ev-items";
import type { StarterDataEntry } from "#types/save-data";
import { randSeedInt, randSeedItem } from "#utils/common";
import { toCamelCase } from "#utils/strings";
import i18next from "i18next";
import Phaser from "phaser";

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
  PokemonMark.ONCE_IN_A_LIFETIME_RIBBON,
  PokemonMark.ENDLESS_MASTER_RIBBON,
  PokemonMark.BEST_FRIENDS_RIBBON,
  PokemonMark.FOOTPRINT_RIBBON,
  PokemonMark.GRAND_FOOTPRINT_RIBBON,
  PokemonMark.EFFORT_RIBBON,
  PokemonMark.HP_EFFORT_RIBBON,
  PokemonMark.ATK_EFFORT_RIBBON,
  PokemonMark.DEF_EFFORT_RIBBON,
  PokemonMark.SPATK_EFFORT_RIBBON,
  PokemonMark.SPDEF_EFFORT_RIBBON,
  PokemonMark.SPD_EFFORT_RIBBON,
  PokemonMark.MIGHTIEST_MARK,
  PokemonMark.GOLDEN_ALPHA_MARK,
  PokemonMark.ALPHA_MARK,
  PokemonMark.JUMBO_MARK,
  PokemonMark.MINI_MARK,
  PokemonMark.PARTNER_MARK,
  PokemonMark.SHINY_MARK,
  PokemonMark.RARE_SHINY_MARK,
  PokemonMark.EPIC_SHINY_MARK,
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

/**
 * The 41 marks a wild Pokémon is met with by the roll of {@linkcode rollWildMark} (time, weather, uncommon, rare and
 * personality); a wild Pokémon has at most one of them, next to its size's (alpha or mini)
 */
export const WILD_MARKS: readonly PokemonMark[] = orderedPokemonMarks.filter(
  m => m >= PokemonMark.LUNCHTIME_MARK && m <= PokemonMark.SLUMP_MARK,
);

/** The shiny mark of each shiny tier (`Pokemon.variant`) */
const SHINY_MARKS: readonly PokemonMark[] = [
  PokemonMark.SHINY_MARK,
  PokemonMark.RARE_SHINY_MARK,
  PokemonMark.EPIC_SHINY_MARK,
];

/**
 * The marks that give a Pokémon a title, most telling first: the one wild mark, then its size, then the rest. The
 * Jumbo Mark is left to the Alpha Mark it always comes with.
 */
const TITLE_MARKS: readonly PokemonMark[] = [
  ...WILD_MARKS,
  PokemonMark.MINI_MARK,
  PokemonMark.GOLDEN_ALPHA_MARK,
  PokemonMark.ALPHA_MARK,
  PokemonMark.MIGHTIEST_MARK,
  PokemonMark.ONCE_IN_A_LIFETIME_RIBBON,
  PokemonMark.PARTNER_MARK,
];

/** The stat effort ribbon of each stat's EVs (the user: "노력치는 노력치별로 색깔 다르게 해서 추가") */
export const STAT_EFFORT_RIBBONS: Readonly<Record<PermanentStat, PokemonMark>> = {
  [Stat.HP]: PokemonMark.HP_EFFORT_RIBBON,
  [Stat.ATK]: PokemonMark.ATK_EFFORT_RIBBON,
  [Stat.DEF]: PokemonMark.DEF_EFFORT_RIBBON,
  [Stat.SPATK]: PokemonMark.SPATK_EFFORT_RIBBON,
  [Stat.SPDEF]: PokemonMark.SPDEF_EFFORT_RIBBON,
  [Stat.SPD]: PokemonMark.SPD_EFFORT_RIBBON,
};

/** The level a Pokémon reaches for the Footprint Ribbon, and in Endless for the Grand Footprint Ribbon */
export const FOOTPRINT_LEVEL = 200;
export const GRAND_FOOTPRINT_LEVEL = 100000;

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

/** @returns The mark's title on its own ("장난꾸러기"), or an empty string if it has none */
export function getMarkTitle(mark: PokemonMark): string {
  return i18next.t(`pokemonMarks:${getMarkKey(mark)}.title`, { defaultValue: "" });
}

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

/**
 * The marks and ribbons a starter line has collected (`StarterDataEntry.marks`), in the tray's order. The two bought
 * with candy count from their flags too, so a Partner Mark bought before the per-line collection existed is there.
 * @param entry - The starter's `starterData` entry
 */
export function getCollectedMarks(entry: StarterDataEntry | undefined): PokemonMark[] {
  const marks = new Set(normalizeMarks(entry?.marks));
  if (entry?.partnerMark) {
    marks.add(PokemonMark.PARTNER_MARK);
  }
  if (entry?.bestFriendsRibbon) {
    marks.add(PokemonMark.BEST_FRIENDS_RIBBON);
  }
  return orderedPokemonMarks.filter(m => marks.has(m));
}

/**
 * The marks a complete collection does not need (the user: "한 포켓몬의 도감을 전부 채울경우(천재일우증표 제외)"): the
 * Once-in-a-Lifetime Ribbon, which only a traded Pokémon has, and the Mightiest Mark while nothing gives it.
 */
export const COMPLETION_EXEMPT_MARKS: readonly PokemonMark[] = [
  PokemonMark.ONCE_IN_A_LIFETIME_RIBBON,
  PokemonMark.MIGHTIEST_MARK,
];

/** @returns Whether the marks are every mark and ribbon there is, but for {@linkcode COMPLETION_EXEMPT_MARKS} */
export function isMarkCollectionComplete(marks: readonly PokemonMark[]): boolean {
  return orderedPokemonMarks.every(m => COMPLETION_EXEMPT_MARKS.includes(m) || marks.includes(m));
}

/**
 * Whether the player has the hidden Eternatus Mark (the user: "모든 포켓몬 잡기 + 무한다이노 잡기가 조건인 증표(포켓몬은
 * 딱히 착용 불가)로 해서 히든 증표처럼"): every starter line caught, and Eternatus, which can only be caught once all
 * the others are. It is read from the Pokédex, so it needs no save data of its own.
 */
export function hasEternatusMark(): boolean {
  const { dexData, starterData } = globalScene.gameData;
  return (
    !!dexData[SpeciesId.ETERNATUS]?.caughtAttr
    && Object.keys(starterData).every(id => !!dexData[Number(id) as SpeciesId]?.caughtAttr)
  );
}

/**
 * Whether the player has ever obtained the mark on any Pokémon: the collection's count (`GameData.markCounts`,
 * counted at every catch, hatch, award and purchase), or a starter line that has it.
 */
export function hasEverObtainedMark(mark: PokemonMark): boolean {
  const { markCounts, starterData } = globalScene.gameData;
  return (markCounts[mark] ?? 0) > 0 || Object.values(starterData).some(e => getCollectedMarks(e).includes(mark));
}

/** @returns The collected mark a starter is taken wearing, or `null` for none (or one it has not collected) */
export function getStarterEquippedMark(entry: StarterDataEntry | undefined): PokemonMark | null {
  const equipped = entry?.equippedMark;
  return isPokemonMark(equipped) && getCollectedMarks(entry).includes(equipped) ? equipped : null;
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
 * The shiny mark a shiny Pokémon of the given tier gets when it is caught or hatched.
 * @param variant - The Pokémon's shiny tier, 0 to 2
 */
export function getShinyMark(variant: number): PokemonMark {
  return SHINY_MARKS[Phaser.Math.Clamp(variant, 0, SHINY_MARKS.length - 1)];
}

/**
 * The title a Pokémon's marks give it ("장난꾸러기", "the Rowdy"), as the main series shows when a Pokémon with a mark
 * enters battle: that of the mark it wears (`Pokemon.equippedMark`), otherwise of the first mark of
 * {@linkcode TITLE_MARKS} it carries.
 * @param pokemon - The Pokémon
 * @returns The title, or an empty string for none
 */
export function getPokemonTitle(pokemon: Pokemon): string {
  // The mark the player chose to show, if any (the user: "증표 볼때 장착 가능하게 하고, 그게 이름 옆에 붙도록")
  const equipped = pokemon.equippedMark;
  const mark =
    equipped !== null && pokemon.marks.includes(equipped) ? equipped : TITLE_MARKS.find(m => pokemon.marks.includes(m));
  return mark === undefined ? "" : i18next.t(`pokemonMarks:${getMarkKey(mark)}.title`, { defaultValue: "" });
}

/**
 * A Pokémon's name with its title, for the messages that announce it (a wild Pokémon appearing, the player's being
 * sent out); the plain name if it has no title.
 * @param pokemon - The Pokémon
 * @param name - Its name as the message would show it
 */
export function getTitledName(pokemon: Pokemon, name: string): string {
  const title = getPokemonTitle(pokemon);
  return title ? i18next.t("pokemonMarks:titledName", { title, name }) : name;
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
 * The seed offset of a newly generated Pokémon's own rolls (its mark, alpha or mini): the wave and the Pokémon's id,
 * so that several Pokémon generated on one wave (the GTS's offers, the Safari Zone's Pokémon, a double battle) each
 * get their own result. The id comes from the seeded RNG, so reloading the wave gives the same Pokémon the same rolls.
 * @param pokemon - The Pokémon being generated
 * @param salt - A number that tells the kinds of roll apart
 */
export function getWildRollSeedOffset(pokemon: Pokemon, salt: number): number {
  return (globalScene.currentBattle?.waveIndex ?? 0) * 16 + (pokemon.id % 65521) + salt;
}

/**
 * Give a freshly generated wild Pokémon its mark, if the roll says so. The roll has its own seed
 * ({@linkcode getWildRollSeedOffset}), so it changes nothing else the wave generates.
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
    getWildRollSeedOffset(pokemon, 7919),
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
    if (pokemon.addMark(ribbon)) {
      awarded = true;
      // Each ribbon given counts for the collection (the mark achievements)
      globalScene.gameData.registerMarks([ribbon], pokemon);
    }
  }
  return awarded ? ribbon : null;
}

/**
 * Give the player's whole party a ribbon (the Endless Master Ribbon when Endless is cleared).
 * @param ribbon - The ribbon
 * @returns Whether at least one party member did not have it yet
 */
export function awardPartyRibbon(ribbon: PokemonMark): boolean {
  let awarded = false;
  for (const pokemon of globalScene.getPlayerParty()) {
    if (pokemon.addMark(ribbon)) {
      awarded = true;
      globalScene.gameData.registerMarks([ribbon], pokemon);
    }
  }
  return awarded;
}

/**
 * The ribbons a party member has earned by how it was raised and does not carry yet: a stat's effort ribbon for that
 * stat's EVs at their cap (ev-items.ts), the Effort Ribbon for all six, the Footprint Ribbon at level 200 and
 * the Grand Footprint Ribbon at level 100,000 in Endless.
 * @param pokemon - The player's Pokémon
 */
export function getEarnedProgressRibbons(pokemon: Pokemon): PokemonMark[] {
  const earned: PokemonMark[] = [];
  for (const stat of PERMANENT_STATS) {
    if ((pokemon.evs[stat] ?? 0) >= getEvCap(stat)) {
      earned.push(STAT_EFFORT_RIBBONS[stat]);
    }
  }
  const statRibbons = Object.values(STAT_EFFORT_RIBBONS);
  if (statRibbons.every(r => pokemon.marks.includes(r) || earned.includes(r))) {
    earned.push(PokemonMark.EFFORT_RIBBON);
  }
  if (pokemon.level >= FOOTPRINT_LEVEL) {
    earned.push(PokemonMark.FOOTPRINT_RIBBON);
  }
  if (pokemon.level >= GRAND_FOOTPRINT_LEVEL && globalScene.gameMode.isEndless) {
    earned.push(PokemonMark.GRAND_FOOTPRINT_RIBBON);
  }
  return earned.filter(r => !pokemon.marks.includes(r));
}

/**
 * Give every party member the progress ribbons it has earned ({@linkcode getEarnedProgressRibbons}), with a message
 * for each. Called when the party gains EVs and when a Pokémon levels up.
 */
export function awardProgressRibbons(): void {
  for (const pokemon of globalScene.getPlayerParty()) {
    for (const ribbon of getEarnedProgressRibbons(pokemon)) {
      pokemon.addMark(ribbon);
      globalScene.gameData.registerMarks([ribbon], pokemon);
      globalScene.phaseManager.queueMessage(
        i18next.t("pokemonMarks:ribbonEarned", {
          pokemonName: pokemon.getNameToRender(),
          ribbonName: getMarkName(ribbon),
        }),
      );
    }
  }
}
