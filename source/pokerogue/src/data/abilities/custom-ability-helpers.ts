// Local fork (2026-11-14): passive rebalance.
// Helpers shared by `initAbilities` and the custom ability batch files (custom-abilities-1114-*.ts).
// They used to live inside init-abilities.ts; they sit here so the batch files can use them without
// importing init-abilities.ts, which imports the batch files (that would be a circular import).
// Do not import init-abilities.ts from this file.
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { allAbilities, allMoves } from "#data/data-lists";
import type { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { EFFECTIVE_STATS, type EffectiveStat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { noAbilityTypeOverrideMoves } from "#moves/invalid-moves";
import type { AbAttrCondition, AiMovegenMoveStatsAbAttrParams, PokemonAttackCondition } from "#types/ability-types";
import i18next from "i18next";

/**
 * Creates an ability condition that causes the ability to fail if that ability
 * has already been used by that pokemon that battle. It requires an ability to
 * be specified due to current limitations in how conditions on abilities work.
 * @param ability The ability to check if it's already been applied
 * @returns The condition
 */
export function getOncePerBattleCondition(ability: AbilityId): AbAttrCondition {
  return (pokemon: Pokemon) => {
    return !pokemon.waveData.abilitiesApplied.has(ability);
  };
}

export function getTerrainCondition(...terrainTypes: TerrainType[]): AbAttrCondition {
  return (_pokemon: Pokemon) => {
    const terrainType = globalScene.arena.terrain?.terrainType;
    return !!terrainType && terrainTypes.indexOf(terrainType) > -1;
  };
}

/** Kicking moves boosted by Footwork. */
export const footworkMoves: ReadonlySet<MoveId> = new Set([
  MoveId.DOUBLE_KICK,
  MoveId.MEGA_KICK,
  MoveId.JUMP_KICK,
  MoveId.ROLLING_KICK,
  MoveId.LOW_KICK,
  MoveId.HIGH_JUMP_KICK,
  MoveId.TRIPLE_KICK,
  MoveId.BLAZE_KICK,
  MoveId.LOW_SWEEP,
  MoveId.STOMP,
  MoveId.TROP_KICK,
  MoveId.TRIPLE_AXEL,
  MoveId.THUNDEROUS_KICK,
  MoveId.AXE_KICK,
  MoveId.PYRO_BALL,
  MoveId.GUNK_SHOT,
]);

/**
 * Condition function checking whether a move can have its type changed by an ability.
 * - Variable-type moves (e.g. {@linkcode MoveId.MULTI_ATTACK}) can't have their type changed.
 * - Tera-based moves can't have their type changed if the move's type would be changed due to the user being Terastallized.
 * @returns Whether the move can have its type changed by an ability
 * @remarks
 * Used for {@link https://bulbapedia.bulbagarden.net/wiki/Normalize_(Ability) | Normalize}
 * and as part of the conditions for similar type-changing abilities
 */
export const anyTypeMoveConversionCondition: PokemonAttackCondition = (user, _target, move): boolean => {
  if (noAbilityTypeOverrideMoves.has(move.id)) {
    return false;
  }

  if (!user.isTerastallized) {
    return true;
  }

  if (move.id === MoveId.TERA_BLAST) {
    return false;
  }
  if (
    move.id === MoveId.TERA_STARSTORM
    && user.getTeraType() === PokemonType.STELLAR
    && user.hasSpecies(SpeciesId.TERAPAGOS)
  ) {
    return false;
  }

  return true;
};

/**
 * Similar to {@linkcode anyTypeMoveConversionCondition}, except that the given move must also be Normal-type.
 * @remarks
 * Used for {@link https://bulbapedia.bulbagarden.net/wiki/Pixilate_(Ability) | Pixilate} et al.
 */
export const normalTypeMoveConversionCondition: PokemonAttackCondition = (user, target, move): boolean =>
  move.type === PokemonType.NORMAL && anyTypeMoveConversionCondition(user, target, move);

/**
 * DRY implementation for the `AIMovegenMoveStatsAbAttr` effect of harsh-sunlight summoning abilities
 * @param __namedParameters.move - Needed for proper typedoc rendering
 */
export function droughtAiMovegenEffect({ move, powerMult, accMult, instantCharge }: AiMovegenMoveStatsAbAttrParams) {
  if (move.id === MoveId.WEATHER_BALL) {
    // double power in addition to weather boost
    powerMult.value *= 3;
    return;
  }

  if (move.id === MoveId.HYDRO_STEAM || move.type === PokemonType.FIRE) {
    powerMult.value *= 1.5;
  } else if (move.type === PokemonType.WATER) {
    powerMult.value *= 0.5;
  }

  if (move.hasAttr("ThunderAccuracyAttr")) {
    accMult.value *= 0.5;
  }

  if (
    move.isChargingMove()
    && move.getChargeAttrs("WeatherInstantChargeAttr").some(attr => attr.weatherTypes.includes(WeatherType.SUNNY))
  ) {
    instantCharge.value = true;
  }
}

/**
 * DRY implementation for the `PostVictoryStatStageChangeAbAttr`
 * abilities that boost the highest stat on victory.
 *
 * @remarks Used for {@link https://bulbapedia.bulbagarden.net/wiki/Beast_Boost_(Ability) | Beast Boost}
 * and {@link https://bulbapedia.bulbagarden.net/wiki/Eelevate_(Ability) | Beast Boost}
 *
 * @param pokemon - The Pokémon under consideration
 */
export function beastBoostHighestStatCalc(pokemon: Pokemon) {
  let highestStat: EffectiveStat;
  let highestValue = 0;
  for (const s of EFFECTIVE_STATS) {
    const value = pokemon.getStat(s, false);
    if (value > highestValue) {
      highestStat = s;
      highestValue = value;
    }
  }
  // Bang is safe here as for loop ensuers highestStat is assigned.
  return [{ stat: highestStat!, stages: 1 }];
}

/**
 * Local fork (2026-11-14): passive rebalance.
 * Whether the Pokémon's non-passive ability (`getAbility`, "본 특성") is one of `abilities` and is currently active.
 * Composite custom abilities use this to skip a part that the regular ability already gives,
 * so the same multiplier is never applied twice (e.g. Farsight skips its Tinted Lens part on a Tinted Lens holder).
 * @param pokemon - The Pokémon to check
 * @param abilities - The regular abilities whose effect the composite ability would duplicate
 * @returns `true` if the non-passive ability is one of `abilities` and can apply right now
 */
export function mainAbilityIs(pokemon: Pokemon, ...abilities: AbilityId[]): boolean {
  return abilities.includes(pokemon.getAbility().id) && pokemon.canApplyAbility();
}

/** i18n key of the text shown when an All-Out Pitch (전력투구) holder tries to select a status move. */
export const ALL_OUT_PITCH_DENIED_KEY = "battle:allOutPitchNoStatusMove";

/**
 * Local fork (2026-11-14): passive rebalance.
 * The text shown when `pokemon` tries to select `moveId` while its All-Out Pitch (전력투구, regular or passive, not
 * suppressed) forbids status moves the way Taunt does, or `undefined` if the move is not restricted.
 * Asked by `Pokemon.isMoveSelectable` (fight menu, AI choice, Struggle when nothing is selectable), next to the Last
 * Stand and vest rules, and by `MovePhase` for a status move used anyway (Encore, Instruct, a called move).
 * It lives here rather than in custom-abilities-1114-d.ts so that pokemon.ts and move-phase.ts don't import ab-attrs.ts.
 * @param pokemon - The would-be user
 * @param moveId - The move
 * @returns The denial text, or `undefined`
 */
export function getAllOutPitchMoveDeniedText(pokemon: Pokemon, moveId: MoveId): string | undefined {
  if (allMoves[moveId].category !== MoveCategory.STATUS || !pokemon.hasAbility(AbilityId.ALL_OUT_PITCH)) {
    return undefined;
  }
  // Falls back to the generic text if a locale lacks the key
  const key = i18next.exists(ALL_OUT_PITCH_DENIED_KEY) ? ALL_OUT_PITCH_DENIED_KEY : "battle:moveDisabled";
  return i18next.t(key, {
    pokemonNameWithAffix: getPokemonNameWithAffix(pokemon),
    moveName: allMoves[moveId].name,
    abilityName: allAbilities[AbilityId.ALL_OUT_PITCH].name,
  });
}
