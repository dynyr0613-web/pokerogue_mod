/*
 * Local fork (2026-11-17): alpha Pokémon (우두머리), after the alphas of Legends: Arceus.
 *
 * An alpha has every stat raised by 1 to 20% (`Pokemon.alphaBoost`, the percentage) and is drawn 10% larger. A wild
 * Pokémon or a hatched egg is one 1 time in 50, with any of the 20 boosts equally likely. Being an alpha stays with
 * the Pokémon through evolution, Mega Evolution, Dynamax and every other form change, and is saved with it.
 *
 * - An alpha carries the Alpha Mark (우두머리의증표), and one with the full 20% also the Golden Alpha Mark
 *   (황금우두머리의증표); see pokemon-marks.ts.
 * - Catching or hatching one records its boost for the starter of its line (`StarterDataEntry.alphaBoost`, the best
 *   so far). From then on the starter can be taken as an alpha with that boost, switched on and off in the starter
 *   select (`StarterDataEntry.alphaEnabled`).
 */

import { globalScene } from "#app/global-scene";
import type { Pokemon } from "#field/pokemon";
import type { StarterDataEntry } from "#types/save-data";
import { randSeedInt } from "#utils/common";

/** The largest stat boost of an alpha, in percent; an alpha with it is a golden alpha */
export const ALPHA_MAX_BOOST = 20;
/** A wild Pokémon or a hatched egg is an alpha 1 time in this many */
export const ALPHA_RATE = 50;
/** An alpha's sprite is this much larger */
export const ALPHA_SPRITE_SCALE = 1.1;

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
 * Make a freshly generated wild Pokémon an alpha, if the roll says so. The roll has its own seed (the wave's, offset
 * by the Pokémon's place in the enemy party), so it changes nothing else the wave generates.
 * @param pokemon - The wild Pokémon
 */
export function applyWildAlpha(pokemon: Pokemon): void {
  const battle = globalScene.currentBattle;
  if (!battle) {
    return;
  }
  globalScene.executeWithSeedOffset(
    () => pokemon.setAlphaBoost(rollAlphaBoost()),
    battle.waveIndex * 16 + battle.enemyParty.length + 104729,
    globalScene.waveSeed,
  );
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
  const entry: StarterDataEntry | undefined = globalScene.gameData.starterData[pokemon.species.getRootSpeciesId()];
  if (!entry || normalizeAlphaBoost(entry.alphaBoost) >= pokemon.alphaBoost) {
    return false;
  }
  entry.alphaBoost = pokemon.alphaBoost;
  return true;
}

/**
 * The boost a starter is taken with: its line's best alpha boost while the alpha is switched on.
 * @param entry - The starter's data
 * @returns The boost in percent, or 0
 */
export function getStarterAlphaBoost(entry: StarterDataEntry | undefined): number {
  return entry?.alphaEnabled ? normalizeAlphaBoost(entry.alphaBoost) : 0;
}
