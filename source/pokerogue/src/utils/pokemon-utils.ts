import { MAX_TERAS_PER_ARENA } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { POKERUS_STARTER_COUNT } from "#balance/starters";
import { starterColors } from "#data/data-lists";
import { BattlerIndex } from "#enums/battler-index";
import { MAX_REGULAR_POKEMON_TYPE, MIN_REGULAR_POKEMON_TYPE, type RegularPokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import type { EnemyPokemon, PlayerPokemon, Pokemon } from "#field/pokemon";
import type { StarterSpeciesId } from "#types/starter-species-id";
import { randSeedIntRange, randSeedItem } from "#utils/common";

/**
 * Converts the internal id of the Pokemon into its national dex number
 * @param speciesId - The {@linkcode SpeciesId} to get the dex number of
 * @returns The national dex number matching the `SpeciesId`
 */
export function getDexNumber(speciesId: SpeciesId): number {
  return speciesId % 2000;
}

/**
 * Method to get the daily list of starters with Pokerus.
 * @returns A list of starters with Pokerus
 */
export function getPokerusStarters(): StarterSpeciesId[] {
  const pokerusStarters: StarterSpeciesId[] = [];
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  globalScene.executeWithSeedOffset(
    () => {
      while (pokerusStarters.length < POKERUS_STARTER_COUNT) {
        const randomSpeciesId = randSeedItem(speciesDataRegistry.getAllStarters());
        if (!pokerusStarters.includes(randomSpeciesId)) {
          pokerusStarters.push(randomSpeciesId);
        }
      }
    },
    0,
    date.getTime().toString(),
  );
  return pokerusStarters;
}

export function getFusedSpeciesName(speciesAName: string, speciesBName: string): string {
  const fragAPattern = /([a-z]{2}.*?[aeiou(?:y$)\-']+)(.*?)$/i;
  const fragBPattern = /([a-z]{2}.*?[aeiou(?:y$)\-'])(.*?)$/i;

  const [speciesAPrefixMatch, speciesBPrefixMatch] = [speciesAName, speciesBName].map(n => /^(?:[^ ]+) /.exec(n));
  const [speciesAPrefix, speciesBPrefix] = [speciesAPrefixMatch, speciesBPrefixMatch].map(m => (m ? m[0] : ""));

  if (speciesAPrefix) {
    speciesAName = speciesAName.slice(speciesAPrefix.length);
  }
  if (speciesBPrefix) {
    speciesBName = speciesBName.slice(speciesBPrefix.length);
  }

  const [speciesASuffixMatch, speciesBSuffixMatch] = [speciesAName, speciesBName].map(n => / (?:[^ ]+)$/.exec(n));
  const [speciesASuffix, speciesBSuffix] = [speciesASuffixMatch, speciesBSuffixMatch].map(m => (m ? m[0] : ""));

  if (speciesASuffix) {
    speciesAName = speciesAName.slice(0, -speciesASuffix.length);
  }
  if (speciesBSuffix) {
    speciesBName = speciesBName.slice(0, -speciesBSuffix.length);
  }

  const splitNameA = speciesAName.split(/ /g);
  const splitNameB = speciesBName.split(/ /g);

  const fragAMatch = fragAPattern.exec(speciesAName);
  const fragBMatch = fragBPattern.exec(speciesBName);

  let fragA: string;
  let fragB: string;

  fragA = splitNameA.length === 1 ? (fragAMatch ? fragAMatch[1] : speciesAName) : splitNameA.at(-1)!;

  if (splitNameB.length === 1) {
    if (fragBMatch) {
      const lastCharA = fragA.slice(fragA.length - 1);
      const prevCharB = fragBMatch[1].slice(fragBMatch.length - 1);
      fragB = (/[-']/.test(prevCharB) ? prevCharB : "") + fragBMatch[2] || prevCharB;
      if (lastCharA === fragB[0]) {
        if (/[aiu]/.test(lastCharA)) {
          fragB = fragB.slice(1);
        } else {
          const newCharMatch = new RegExp(`[^${lastCharA}]`).exec(fragB);
          if (newCharMatch?.index !== undefined && newCharMatch.index > 0) {
            fragB = fragB.slice(newCharMatch.index);
          }
        }
      }
    } else {
      fragB = speciesBName;
    }
  } else {
    fragB = splitNameB.at(-1)!;
  }

  if (splitNameA.length > 1) {
    fragA = `${splitNameA.slice(0, splitNameA.length - 1).join(" ")} ${fragA}`;
  }

  fragB = `${fragB.slice(0, 1).toLowerCase()}${fragB.slice(1)}`;

  // Prevents some unfortunate fusion names from Rapidash + X
  if (fragA === "Rapi") {
    fragA = "Rapid";
    if (fragB === "ng") {
      fragB = speciesBName.slice(speciesBName.length - 3);
    }
  }

  return `${speciesAPrefix || speciesBPrefix}${fragA}${fragB}${speciesBSuffix || speciesASuffix}`;
}

/**
 * Return whether two battler indices are considered allies.
 * To instead check with {@linkcode Pokemon} objects, use {@linkcode Pokemon.isOpponent}.
 * @param a - First battler index
 * @param b - Second battler index
 * @returns Whether the two battler indices are allies. Always `false` if either index is `ATTACKER`.
 */
export function areAllies(a: BattlerIndex, b: BattlerIndex): boolean {
  if (a === BattlerIndex.ATTACKER || b === BattlerIndex.ATTACKER) {
    return false;
  }
  return (
    (a === BattlerIndex.PLAYER || a === BattlerIndex.PLAYER_2)
    === (b === BattlerIndex.PLAYER || b === BattlerIndex.PLAYER_2)
  );
}

/**
 * Determine whether an enemy Pokémon will Terastallize the user
 *
 * Does not check if the Pokémon is allowed to Terastallize (e.g., if it's a mega)
 * @param pokemon - The Pokémon to check
 * @returns Whether the Pokémon will Terastallize
 *
 * @remarks
 * Should really only be called with an enemy Pokémon, but will technically work with any Pokémon.
 *
 * @privateRemarks
 * Assumes that Pokémon without a trainer will never tera, so this must be changed if
 * a wild Pokémon is allowed to tera, e.g. for a Mystery Encounter.
 */
export function willTerastallize(pokemon: Pokemon): boolean {
  // cast is safe, as if it is just a Pokémon, initialTeamIndex will be undefined triggering the null check
  const initialTeamIndex = (pokemon as EnemyPokemon).initialTeamIndex;
  return (
    initialTeamIndex != null
    && pokemon.hasTrainer()
    // Local fork (2026-11-10): an enemy in a form that cannot Terastallize (Mega, Primal, Gigantamax...) never does,
    // as `Trainer.shouldTera` now says too (enemy-battle-forms.ts)
    && !isTeraBlockedForm(pokemon)
    && (globalScene.currentBattle?.trainer?.config.trainerAI.instantTeras.includes(initialTeamIndex) ?? false)
  );
}

/**
 * Local fork (2026-11-10): whether `pokemon` is in a form that cannot Terastallize: Mega / Primal (`isMega()`),
 * Gigantamax / Eternamax (`isMax()`) or Ultra Necrozma. The player's rule ({@linkcode canSpeciesTera}), shared with the
 * enemy side (`willTerastallize`, `Trainer.shouldTera`, `TrainerConfig.setRandomTeraModifiers`) since enemies can come
 * Mega Evolved or Gigantamaxed (enemy-battle-forms.ts), so no enemy Terastallizes in a form no player could.
 * Local fork (2026-11-18): now the enemy's rule only; the player's is {@linkcode isPlayerTeraBlockedForm}.
 */
export function isTeraBlockedForm(pokemon: Pokemon): boolean {
  return pokemon.isMega() || pokemon.isMax() || pokemon.hasSpecies(SpeciesId.NECROZMA, "ultra");
}

/**
 * Determine whether the Pokémon's species is tera capable, and that the player has acquired the tera orb.
 * @param pokemon - The Pokémon to check
 * @returns Whether
 */
export function canSpeciesTera(pokemon: Pokemon): boolean {
  const hasTeraMod = globalScene.findModifier(modifier => modifier.is("TerastallizeAccessModifier")) != null;
  // Local fork (2026-11-10): the blocked forms moved, unchanged, to isTeraBlockedForm, which the enemy side asks too
  // Local fork (2026-11-18): the player's Pokémon Terastallizes in a Mega / Primal / G-Max / E-Max form or the Dynamax
  // state too (the user: "메가 + 다이맥스 + z기술 + 테라스탈 같은 조합도 가능하게 해보고"); only Ultra Necrozma stays
  // blocked. The enemy side keeps isTeraBlockedForm
  return hasTeraMod && !isPlayerTeraBlockedForm(pokemon);
}

/**
 * Local fork (2026-11-18): whether the player's `pokemon` is in a form that cannot Terastallize: Ultra Necrozma only.
 * A Mega / Primal / G-Max / E-Max form or the Dynamax state (pokemon-forms-dynamax.ts) can, and a form change into
 * one no longer ends the player's Terastallization (`Pokemon.resetTeraOnMajorFormChange`).
 */
export function isPlayerTeraBlockedForm(pokemon: Pokemon): boolean {
  return pokemon.hasSpecies(SpeciesId.NECROZMA, "ultra");
}

/**
 * Same as {@linkcode canSpeciesTera}, but also checks that the player has not already used their tera in the arena.
 *
 * @remarks
 * ⚠️ This does not account for tera commands that may be pending, so this should not be used during command selection!
 * @param pokemon - The Pokémon to check
 * @returns Whether the Pokémon can Terastallize
 */
export function canTerastallize(pokemon: PlayerPokemon): boolean {
  const hasAvailableTeras = globalScene.arena.playerTerasUsed < MAX_TERAS_PER_ARENA;
  return hasAvailableTeras && canSpeciesTera(pokemon);
}

export function decodeNickname(nickname: string, pokemonName: string): string {
  try {
    return decodeURIComponent(escape(atob(nickname))); // TODO: this seems jank, and `escape` is deprecated
  } catch (err) {
    console.error(`Failed to decode nickname for ${pokemonName}!\n`, err);
    return pokemonName;
  }
}

/** @returns A random {@linkcode RegularPokemonType} */
export function getRandomRegularPokemonType(): RegularPokemonType {
  return randSeedIntRange(MIN_REGULAR_POKEMON_TYPE, MAX_REGULAR_POKEMON_TYPE) as RegularPokemonType;
}

/**
 * Get the starter color for a given speciesId.
 * @remarks
 * Falls back to white if no color is found for the speciesId.
 * @param speciesId - The {@linkcode SpeciesId} of the Pokémon to get the starter color for
 * @returns A tuple of the starter color
 */
export function getStarterColors(speciesId: SpeciesId): [string, string] {
  if (!starterColors[speciesId]) {
    console.warn(`Missing starter colors for "${SpeciesId[speciesId]}".`);
    // Default to white if no colors are found
    starterColors[speciesId] = ["#FFFFFF", "#FFFFFF"];
  }
  return starterColors[speciesId];
}
