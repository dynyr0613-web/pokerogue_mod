import type { PokemonSpecies, PokemonSpeciesFilter } from "#data/pokemon-species";
import type { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#types/move-types";
import type { BooleanHolder } from "#utils/common";

/**
 * The type that {@linkcode PokemonSpeciesForm} is converted to when an object containing it serializes it.
 */
export type SerializedSpeciesForm = {
  id: SpeciesId;
  formIdx: number;
};

export interface RandomEncounterParams {
  /** The level of the mon */
  level: number;

  /** A custom function used to return the {@linkcode PokemonSpecies} to generate */
  speciesFunction?: () => PokemonSpecies;

  /**
   * Whether the Pokemon should be a Boss.
   * @defaultValue `false`
   */
  isBoss?: boolean;

  /**
   * Whether Sub-legendaries can be encountered, mainly for event encounters
   * @defaultValue `true`
   */
  includeSubLegendary?: boolean;

  /**
   * Whether Legendaries can be encountered
   * @defaultValue `true`
   */
  includeLegendary?: boolean;

  /**
   * Whether Mythicals can be encountered
   * @defaultValue `true`
   */
  includeMythical?: boolean;

  /**
   * The chance out of 100 to pick an event encounter
   * @defaultValue `50`
   */
  eventChance?: number;

  /**
   * Number of rerolls for Hidden Ability (HA) that should be attempted
   * @defaultValue `0`
   */
  hiddenRerolls?: number;

  /**
   * Number of rerolls for shininess/variants that should be attempted
   * @defaultValue `0`
   */
  shinyRerolls?: number;

  /**
   * Number of extra HA rerolls for event mons
   * @defaultValue `0`
   */
  eventHiddenRerolls?: number;

  /**
   * Number of extra shiny rerolls for event mons
   * @defaultValue `0`
   */
  eventShinyRerolls?: number;

  /**
   * The overridden HA chance, defaults to base
   */
  hiddenAbilityChance?: number;

  /**
   * The overridden shiny chance, defaults to base
   */
  shinyChance?: number;

  /**
   * The max shiny threshold after modifiers are applied. Values below 1 mean no maximum
   * @defaultValue `0` (no maximum)
   */
  maxShinyChance?: number;

  /**
   * An optional filter for eligible mons, applied to the event encounter pool.
   * If omitted, no filter will be applied.
   */
  speciesFilter?: PokemonSpeciesFilter;

  /** An optional {@linkcode BooleanHolder} used to let the caller know if it pulled from an event. */
  isEventEncounter?: BooleanHolder;
}

/**
 * Parameters for {@linkcode Pokemon#getEffectiveStat}
 *
 * @remarks
 * Does not include the `stat` parameter, which is passed outside of the object.
 */
export interface GetEffectiveStatParams {
  /** The other pokemon in the interaction
   *
   * @remarks
   * Used to respect the abilities for the interaction; (unaware, mega sol, ally's flower gift)
   */
  opponent?: Pokemon;
  /**
   * The move being used in the interaction
   *
   * @remarks
   * Passed to respect the effects of moves that ignore stat changes.
   */
  move?: Move;
  /**
   * Whether to ignore the user's ability during the calculation
   * @defaultValue `false`
   */
  ignoreAbility?: boolean;
  /**
   * Whether to ignore the opponent's ability during the calculation
   * @defaultValue `false`
   */
  ignoreOppAbility?: boolean;
  /**
   * Whether to ignore the ability of the opponent's ally
   *
   * @defaultValue `false`
   *
   * @remarks
   * For example, the effects of the ally's
   * {@link https://bulbapedia.bulbagarden.net/wiki/Flower_Gift_(Ability) | Flower Gift} ability
   */
  ignoreAllyAbility?: boolean;
  /**
   * Whether the move being used will land as a critical hit
   * @defaultValue `false`
   *
   * @remarks
   * Used to ignore offensive/defensive stat stage drops/boosts.
   */
  isCritical?: boolean;
  /**
   * Whether to suppress changes to game state
   * @defaultValue `true`
   *
   * @remarks
   * Passed to the `applyAbAttrs` method invocations
   */
  simulated?: boolean;
  /**
   * Whether to ignore this pokemon's held items
   * @defaultValue `false`
   */
  ignoreHeldItems?: boolean;
  /**
   * Whether the stat is being calculated as though the move is being used
   * _against_ this Pokémon.
   * @defaultValue `false`
   *
   * @remarks
   * Currently only used to ignore the weather boost for sandstorm/snow
   * when the opponent has Mega Sol.
   */
  forDefend?: boolean;
  /**
   * Local fork (2026-11-13): Foul Play's target (08 명세 1번). When set, the calculation starts from that Pokémon's
   * plain stat ({@linkcode Pokemon#getFoulPlayStat}: no held items, no abilities, no Soul Dew) and reads its stat
   * stages, while this Pokémon's (the user's) own held items, abilities and field effects apply on top, as for any
   * physical move (the main series' rule)
   */
  foulPlayTarget?: Pokemon;
  /**
   * Local fork (2026-11-20): Wonder Room's exceptions in the main series (the user: "원더룸 - 본가 규칙 따르기").
   * When set, the plain Defense / Sp. Def is read as if Wonder Room were not up, and its stat stages then come from the
   * other defensive stat (Game Freak's own quirk, as in Pokémon Showdown's `getStat(stat, false, true)`). Used by
   * Download, Protosynthesis / Quark Drive / Booster Energy, Body Press and Shell Side Arm's category check.
   * @defaultValue `false`
   */
  ignoreWonderRoom?: boolean;
}
