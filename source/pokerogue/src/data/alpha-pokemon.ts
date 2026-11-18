/*
 * Local fork (2026-11-17): alpha Pokémon (우두머리), after the alphas of Legends: Arceus.
 *
 * An alpha has every stat raised by 1 to 20% (`Pokemon.alphaBoost`, the percentage) and is drawn 10% larger. A wild
 * Pokémon or a hatched egg is one 1 time in 50, with any of the 20 boosts equally likely. Being an alpha stays with
 * the Pokémon through evolution, Mega Evolution, Dynamax and every other form change, and is saved with it.
 *
 * - An alpha carries the Alpha Mark (우두머리의증표) and the Jumbo Mark (커다란증표), and one with the full 20% also
 *   the Golden Alpha Mark (황금우두머리의증표); see pokemon-marks.ts.
 * - A wild Pokémon that is not an alpha is a mini one 1 time in 50: drawn 10% smaller, with the Mini Mark
 *   (조그만증표) and no stat change. It is small for as long as it carries the mark.
 * - Catching or hatching one records its boost for the starter of its line (`StarterDataEntry.alphaBoost`, the best
 *   so far). From then on the starter can be taken as an alpha with that boost, switched on and off in the starter
 *   select (`StarterDataEntry.alphaEnabled`).
 */

import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry"; // Local fork (2026-11-18): syncAlphaLineBoosts
import { getWildRollSeedOffset } from "#data/pokemon-marks";
import { PokemonMark } from "#enums/pokemon-mark";
import type { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import type { StarterData, StarterDataEntry } from "#types/save-data";
import { randSeedInt } from "#utils/common";

/** The largest stat boost of an alpha, in percent; an alpha with it is a golden alpha */
export const ALPHA_MAX_BOOST = 20;
/** A wild Pokémon or a hatched egg is an alpha 1 time in this many */
export const ALPHA_RATE = 50;
/** An alpha's sprite is this much larger */
export const ALPHA_SPRITE_SCALE = 1.1;
/** A wild Pokémon that is not an alpha is a mini one (10% smaller, with the Mini Mark) 1 time in this many */
export const MINI_RATE = 50;
/** A mini Pokémon's sprite is this much smaller */
export const MINI_SPRITE_SCALE = 0.9;

/**
 * Clean an alpha boost read from save data or a copied Pokémon.
 * @param boost - `Pokemon.alphaBoost` / `PokemonData.alphaBoost` / `StarterDataEntry.alphaBoost` of any save
 * @returns A whole percentage from 0 (not an alpha) to {@linkcode ALPHA_MAX_BOOST}
 */
export function normalizeAlphaBoost(boost: unknown): number {
  if (typeof boost !== "number" || !Number.isFinite(boost)) {
    return 0;
  }
  return Math.min(Math.max(Math.floor(boost), 0), ALPHA_MAX_BOOST);
}

/**
 * Roll whether a newly generated Pokémon is an alpha, and its boost. Uses the seeded RNG.
 * @returns The boost in percent, or 0 for an ordinary Pokémon
 */
export function rollAlphaBoost(): number {
  if (randSeedInt(ALPHA_RATE)) {
    return 0;
  }
  return randSeedInt(ALPHA_MAX_BOOST, 1);
}

/**
 * Make a freshly generated wild Pokémon an alpha or a mini Pokémon, if the rolls say so. The rolls have their own
 * seed (`getWildRollSeedOffset`), so they change nothing else the wave generates.
 * @param pokemon - The wild Pokémon
 */
export function applyWildAlpha(pokemon: Pokemon): void {
  const battle = globalScene.currentBattle;
  if (!battle) {
    return;
  }
  globalScene.executeWithSeedOffset(
    () => {
      pokemon.setAlphaBoost(rollAlphaBoost());
      // A Pokémon is an alpha or a mini one, never both; a mini one has no stat change, only its size and its mark
      if (!pokemon.isAlpha() && !randSeedInt(MINI_RATE)) {
        pokemon.addMark(PokemonMark.MINI_MARK);
        pokemon.updateScale();
      }
    },
    getWildRollSeedOffset(pokemon, 104729),
    globalScene.waveSeed,
  );
}

/**
 * Local fork (2026-11-17): undo {@linkcode applyWildAlpha} on a Pokémon generated as a wild one but fought as a boss
 * (bosses are never alphas or mini Pokémon): the boost, the size and the alpha, jumbo and mini marks go. Its wild mark
 * stays, as other bosses have one.
 * @param pokemon - The Pokémon
 */
export function clearWildAlpha(pokemon: Pokemon): void {
  if (!pokemon.isAlpha() && !pokemon.hasMark(PokemonMark.MINI_MARK)) {
    return;
  }
  pokemon.setAlphaBoost(0);
  pokemon.marks = pokemon.marks.filter(
    m =>
      m !== PokemonMark.ALPHA_MARK
      && m !== PokemonMark.JUMBO_MARK
      && m !== PokemonMark.GOLDEN_ALPHA_MARK
      && m !== PokemonMark.MINI_MARK,
  );
  pokemon.updateScale();
}

/**
 * Local fork (2026-11-18): make a freshly generated wild Pokémon an alpha for certain, for the "우두머리!" encounter
 * (alpha-encounter.ts; the user: "우두머리와 싸운다"). One that {@linkcode applyWildAlpha} already made an alpha keeps
 * its boost; any other gets the usual boost roll, 1 to {@linkcode ALPHA_MAX_BOOST}% with each value equally likely, and
 * with it the Alpha and Jumbo Marks (and the Golden Alpha Mark at 20%). A Pokémon is never an alpha and a mini one at
 * once, so a Mini Mark it was met with goes. Other marks it was met with (a wild mark) stay. Uses the seeded RNG.
 * @param pokemon - The wild Pokémon
 */
export function forceWildAlpha(pokemon: Pokemon): void {
  if (pokemon.hasMark(PokemonMark.MINI_MARK)) {
    pokemon.marks = pokemon.marks.filter(m => m !== PokemonMark.MINI_MARK);
  }
  if (!pokemon.isAlpha()) {
    pokemon.setAlphaBoost(randSeedInt(ALPHA_MAX_BOOST, 1));
  }
  pokemon.updateScale();
}

/**
 * Apply an alpha's boost to one of its stats, rounded down.
 * @param pokemon - The Pokémon
 * @param stat - The stat's value before the boost
 */
export function applyAlphaStatBoost(pokemon: Pokemon, stat: number): number {
  return pokemon.alphaBoost > 0 ? Math.floor((stat * (100 + pokemon.alphaBoost)) / 100) : stat;
}

/**
 * Record an alpha the player now owns (caught or hatched) for the starter of its line.
 * @param pokemon - The Pokémon
 * @returns Whether the starter's best boost went up
 */
export function registerAlpha(pokemon: Pokemon): boolean {
  if (pokemon.alphaBoost <= 0) {
    return false;
  }
  // Local fork (2026-11-17): a line with a later-stage starter (Pikachu next to Pichu) credits both starters, as the
  // classic-win ribbons do (game-over-phase.ts); the root alone left the Pikachu starter without an alpha forever
  const starterIds = new Set([pokemon.species.getRootSpeciesId(), pokemon.species.getRootSpeciesId(true)]);
  let raised = false;
  for (const starterId of starterIds) {
    const entry: StarterDataEntry | undefined = globalScene.gameData.starterData[starterId];
    if (entry && normalizeAlphaBoost(entry.alphaBoost) < pokemon.alphaBoost) {
      entry.alphaBoost = pokemon.alphaBoost;
      raised = true;
    }
  }
  // Local fork (2026-11-18): an alpha Pichu (whose two roots are both Pichu) reaches the Pikachu starter at once too, as
  // it would on the next load (syncAlphaLineBoosts)
  if (raised) {
    syncAlphaLineBoosts(globalScene.gameData.starterData);
  }
  return raised;
}

/**
 * Local fork (2026-11-18): even out the alpha records of the lines with two starters (Pichu and Pikachu) in a save from
 * before 11-17, when {@linkcode registerAlpha} credited the root of the line only: an alpha Pikachu or Raichu caught then
 * was recorded for the Pichu starter and never for the Pikachu one. For each species whose root (`getRootSpeciesId()`)
 * and starter (`getRootSpeciesId(true)`) differ, both starter entries get the larger of their two boosts (the user: "버그성
 * 빈틈도 다 수정"). `alphaEnabled` stays as each entry has it (the starter select switch). Nothing is added to a line
 * without an alpha, and running it again changes nothing.
 *
 * Meant for the save loading loop (`GameData.initParsedSystem`, next to `syncAchievedLineMarks`).
 * @remarks The old records do not say which species of the line was caught, so the larger value goes to both starters.
 * Run on every load, it also gives the Pikachu starter a Pichu alpha caught later (which `registerAlpha` records for
 * Pichu only) from the next load on: an alpha Pichu evolves into an alpha Pikachu anyway.
 * @param starterData - The save's starter data, changed in place
 * @returns The starters whose boost went up
 */
export function syncAlphaLineBoosts(starterData: StarterData): SpeciesId[] {
  const raised = new Set<SpeciesId>();
  const pairs = new Set<string>();
  for (const species of speciesDataRegistry.getAllSpecies()) {
    const rootId = species.getRootSpeciesId();
    const starterId = species.getRootSpeciesId(true);
    const pairKey = `${rootId}:${starterId}`;
    if (rootId === starterId || pairs.has(pairKey)) {
      continue;
    }
    pairs.add(pairKey);
    const entries = [rootId, starterId].map(id => [id, starterData[id]] as const);
    const best = Math.max(...entries.map(([, entry]) => normalizeAlphaBoost(entry?.alphaBoost)));
    if (best <= 0) {
      continue;
    }
    for (const [id, entry] of entries) {
      if (entry && normalizeAlphaBoost(entry.alphaBoost) < best) {
        entry.alphaBoost = best;
        raised.add(id);
      }
    }
  }
  return [...raised];
}

/**
 * The boost a starter is taken with: its line's best alpha boost while the alpha is switched on.
 * @param entry - The starter's data
 * @returns The boost in percent, or 0
 */
export function getStarterAlphaBoost(entry: StarterDataEntry | undefined): number {
  return entry?.alphaEnabled ? normalizeAlphaBoost(entry.alphaBoost) : 0;
}
