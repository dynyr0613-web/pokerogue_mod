// Local fork (2026-11-14): passive rebalance. Batch B of the new custom abilities.
// Spec: tools/drive/passive_adjust_1114/impl_batches.json -> "abilities"[ID] ("효과자세히" is the exact behaviour).
// Guide: tools/drive/passive_adjust_1114/pokerogue_scaffold.md
// Keep the entries in this order: `allAbilities` is indexed by `AbilityId`, so the order must match the enum.
// Do not import init-abilities.ts here (it imports this file); shared helpers are in custom-ability-helpers.ts.
//
// Every ability of batch B combines two existing abilities: each entry chains the attrs of both bases from
// init-abilities.ts. Where only one base is ignorable (Fur Coat, Solid Rock, Punk Rock), the ability itself is not
// ignorable and only that base's attr carries `notIgnoredByMoldBreaker`. Where the spec asks for a multiplier to apply
// once (Dream Weaver, Iron Legs, Farsight), that part is skipped while the regular ability (`mainAbilityIs`) already
// gives it.
import {
  AiMovegenMoveStatsAbAttr,
  ConditionalCritAbAttr,
  getWeatherCondition,
  IgnoreTypeImmunityAbAttr,
  IntimidateImmunityAbAttr,
  MoveDamageBoostAbAttr,
  MovePowerBoostAbAttr,
  MoveTypeChangeAbAttr,
  PostAttackContactApplyStatusEffectAbAttr,
  PostBiomeChangeWeatherChangeAbAttr,
  PostDefendApplyArenaTrapTagAbAttr,
  PostDefendApplyStatusEffectAbAttr,
  PostDefendContactDamageAbAttr,
  PostDefendStatStageChangeAbAttr,
  PostFaintContactDamageAbAttr,
  PostSummonWeatherChangeAbAttr,
  PostTurnHurtIfSleepingAbAttr,
  ReceivedMoveDamageMultiplierAbAttr,
  StatMultiplierAbAttr,
} from "#abilities/ab-attrs";
import { AbBuilder, type Ability } from "#abilities/ability";
import {
  anyTypeMoveConversionCondition,
  droughtAiMovegenEffect,
  footworkMoves,
  mainAbilityIs,
} from "#abilities/custom-ability-helpers";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagType } from "#enums/arena-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import type { Move } from "#moves/move";
import type { AbAttrBaseParams, AbAttrCondition, AiMovegenMoveStatsAbAttrParams } from "#types/ability-types";
import { toDmgValue } from "#utils/common";
import i18next from "i18next";

/**
 * Local fork (2026-11-14): passive rebalance.
 * `false` while another Pokémon's Mold Breaker-type effect ignores abilities, as `Pokemon.canApplyAbility` does for an
 * ignorable ability. `ignorable()` works on a whole ability, so a composite ability with one ignorable base stays
 * non-ignorable and puts this condition on that base's attr only.
 */
const notIgnoredByMoldBreaker: AbAttrCondition = pokemon => {
  const { arena } = globalScene;
  return !(arena.ignoreAbilities && arena.ignoringEffectSource !== pokemon.getBattlerIndex());
};

/**
 * Local fork (2026-11-14): passive rebalance.
 * Moves whose accuracy the Compound Eyes part of Dream Weaver raises: not one-hit KO moves and not Dark Void
 * (PokeRogue's Dark Void has 80 accuracy and no Darkrai lock, so x1.3 would make it a sure-hit spread sleep).
 */
const dreamWeaverBoostsAccuracy = (move: Move): boolean =>
  !move.hasAttr("OneHitKOAttr") && move.id !== MoveId.DARK_VOID;

/**
 * Local fork (2026-11-14): passive rebalance.
 * Moves whose accuracy the Compound Eyes part of Farsight raises: every move except one-hit KO moves.
 */
const farsightBoostsAccuracy = (move: Move): boolean => !move.hasAttr("OneHitKOAttr");

/**
 * Local fork (2026-11-14): passive rebalance.
 * The moveset-generation half of Compound Eyes (`accMult` x1.3), limited to the moves the in-battle half boosts.
 */
function compoundEyesAiMovegenEffect(boostsAccuracy: (move: Move) => boolean) {
  return ({ move, accMult }: AiMovegenMoveStatsAbAttrParams): void => {
    if (boostsAccuracy(move)) {
      accMult.value *= 1.3;
    }
  };
}

/**
 * Local fork (2026-11-14): passive rebalance.
 * Copy of Snow Warning's moveset-generation effect (it is an inline callback in init-abilities.ts).
 */
function snowWarningAiMovegenEffect({ move, powerMult, accMult, instantCharge }: AiMovegenMoveStatsAbAttrParams): void {
  if (move.id === MoveId.WEATHER_BALL) {
    // double power in addition to weather boost
    powerMult.value *= 2;
    return;
  }
  if (move.hasAttr("BlizzardAccuracyAttr")) {
    accMult.value = Number.POSITIVE_INFINITY;
  }
  if (move.hasAttr("AntiSunlightPowerDecreaseAttr")) {
    powerMult.value *= 0.5;
  }
  if (
    move.isChargingMove()
    && move.getChargeAttrs("WeatherInstantChargeAttr").some(attr => attr.weatherTypes.includes(WeatherType.SNOW))
  ) {
    instantCharge.value = true;
  }
}

/**
 * Local fork (2026-11-14): passive rebalance.
 * Bad Dreams for Dream Weaver: at the end of the turn, each sleeping (or Comatose) foe on the field loses 1/8 of its
 * max HP. Unlike the base {@linkcode PostTurnHurtIfSleepingAbAttr.apply}, which asks whether the *holder* has Magic
 * Guard, this checks each foe's own Magic Guard (the spec: "매직가드는 막음"); the activation check (`canApply`) is
 * inherited unchanged.
 */
class SleepingFoesHurtAbAttr extends PostTurnHurtIfSleepingAbAttr {
  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }

    for (const opp of pokemon.getOpponentsGenerator()) {
      if (
        (opp.status?.effect !== StatusEffect.SLEEP && !opp.hasAbility(AbilityId.COMATOSE))
        || opp.switchOutStatus
        || opp.hasAbilityWithAttr("BlockNonDirectDamageAbAttr")
      ) {
        continue;
      }

      opp.damageAndUpdate(toDmgValue(opp.getMaxHp() / 8), { result: HitResult.INDIRECT });
      globalScene.phaseManager.queueMessage(
        i18next.t("abilityTriggers:badDreams", { pokemonName: getPokemonNameWithAffix(opp) }),
      );
    }
  }
}

/** Batch B of the 2026-11-14 custom abilities, in `AbilityId` order. */
export function customAbilities1114B(): Ability[] {
  return [
    // Local fork (2026-11-14): passive rebalance. Venom Hunt = Poison Touch (30% poison on contact) + Merciless
    // (always crits a poisoned or badly poisoned target; the hit that poisons is not itself a crit).
    new AbBuilder(AbilityId.VENOM_HUNT, 9) //
      .attr(PostAttackContactApplyStatusEffectAbAttr, 30, StatusEffect.POISON)
      .attr(
        ConditionalCritAbAttr,
        (_user, target, _move) =>
          target?.status?.effect === StatusEffect.TOXIC || target?.status?.effect === StatusEffect.POISON,
      )
      .build(),
    // Local fork (2026-11-14): passive rebalance. Flame Fur = Fur Coat (physical damage taken x0.5, ignored by Mold
    // Breaker-type effects) + Flame Body (30% burn on contact, also when fainting). Not ignorable as a whole, so the
    // Flame Body half still works against Mold Breaker.
    new AbBuilder(AbilityId.FLAME_FUR, 9) //
      .conditionalAttr(
        notIgnoredByMoldBreaker,
        ReceivedMoveDamageMultiplierAbAttr,
        (_target, _user, move) => move.category === MoveCategory.PHYSICAL,
        0.5,
      )
      .attr(PostDefendApplyStatusEffectAbAttr, 30, true, StatusEffect.BURN)
      .bypassFaint()
      .build(),
    // Local fork (2026-11-14): passive rebalance. Vocal Sac = Liquid Voice (sound moves become Water) + Punk Rock
    // (sound moves x1.3; sound damage taken x0.5, the part Mold Breaker-type effects ignore).
    new AbBuilder(AbilityId.VOCAL_SAC, 9) //
      .attr(
        MoveTypeChangeAbAttr,
        PokemonType.WATER,
        (user, target, move) =>
          move.hasFlag(MoveFlags.SOUND_BASED) && anyTypeMoveConversionCondition(user, target, move),
      )
      .attr(MovePowerBoostAbAttr, (_user, _target, move) => move.hasFlag(MoveFlags.SOUND_BASED), 1.3)
      .conditionalAttr(
        notIgnoredByMoldBreaker,
        ReceivedMoveDamageMultiplierAbAttr,
        (_target, _user, move) => move.hasFlag(MoveFlags.SOUND_BASED),
        0.5,
      )
      .build(),
    // Local fork (2026-11-14): passive rebalance. Iron Sand = Sand Stream (sandstorm on entry and on biome change) +
    // Solid Rock (super-effective damage taken x0.75, the part Mold Breaker-type effects ignore).
    new AbBuilder(AbilityId.IRON_SAND, 9) //
      .attr(PostSummonWeatherChangeAbAttr, WeatherType.SANDSTORM)
      .attr(PostBiomeChangeWeatherChangeAbAttr, WeatherType.SANDSTORM)
      .conditionalAttr(
        notIgnoredByMoldBreaker,
        ReceivedMoveDamageMultiplierAbAttr,
        (target, user, move) => target.getMoveEffectiveness(user, move) >= 2,
        0.75,
      )
      .build(),
    // Local fork (2026-11-14): passive rebalance. Dream Weaver = Compound Eyes (accuracy x1.3, not one-hit KO moves
    // nor Dark Void) + Bad Dreams (1/8 max HP to each sleeping foe at the end of the turn, blocked by the foe's Magic
    // Guard). A part is skipped while the regular ability is Compound Eyes / Bad Dreams, so it applies once.
    new AbBuilder(AbilityId.DREAM_WEAVER, 9) //
      .conditionalAttr(
        pokemon => !mainAbilityIs(pokemon, AbilityId.COMPOUND_EYES),
        StatMultiplierAbAttr,
        Stat.ACC,
        1.3,
        (_user, _target, move) => dreamWeaverBoostsAccuracy(move),
      )
      .conditionalAttr(
        pokemon => !mainAbilityIs(pokemon, AbilityId.COMPOUND_EYES),
        AiMovegenMoveStatsAbAttr,
        compoundEyesAiMovegenEffect(dreamWeaverBoostsAccuracy),
      )
      .conditionalAttr(pokemon => !mainAbilityIs(pokemon, AbilityId.BAD_DREAMS), SleepingFoesHurtAbAttr)
      .build(),
    // Local fork (2026-11-14): passive rebalance. Solar Pulse = Orichalcum Pulse + Turbo Engine: sun on entry and on
    // biome change, and Atk x4/3 and Sp. Atk x4/3 in sun or harsh sun (none under Air Lock / Cloud Nine). No recoil.
    new AbBuilder(AbilityId.SOLAR_PULSE, 9) //
      .attr(PostSummonWeatherChangeAbAttr, WeatherType.SUNNY)
      .attr(PostBiomeChangeWeatherChangeAbAttr, WeatherType.SUNNY)
      .conditionalAttr(
        getWeatherCondition(WeatherType.SUNNY, WeatherType.HARSH_SUN),
        StatMultiplierAbAttr,
        Stat.ATK,
        4 / 3,
      )
      .conditionalAttr(
        getWeatherCondition(WeatherType.SUNNY, WeatherType.HARSH_SUN),
        StatMultiplierAbAttr,
        Stat.SPATK,
        4 / 3,
      )
      .attr(AiMovegenMoveStatsAbAttr, params => {
        droughtAiMovegenEffect(params);
        if (params.move.category !== MoveCategory.STATUS) {
          params.powerMult.value *= 4 / 3;
        }
      })
      .build(),
    // Local fork (2026-11-14): passive rebalance. Cold Snap = Snow Warning (snow on entry and on biome change) +
    // Slush Rush (Speed x2 in snow or hail, none under Air Lock / Cloud Nine).
    new AbBuilder(AbilityId.COLD_SNAP, 9) //
      .attr(PostSummonWeatherChangeAbAttr, WeatherType.SNOW)
      .attr(PostBiomeChangeWeatherChangeAbAttr, WeatherType.SNOW)
      .conditionalAttr(getWeatherCondition(WeatherType.HAIL, WeatherType.SNOW), StatMultiplierAbAttr, Stat.SPD, 2)
      .attr(AiMovegenMoveStatsAbAttr, snowWarningAiMovegenEffect)
      .build(),
    // Local fork (2026-11-14): passive rebalance. Iron Legs = Footwork (kicking moves x1.2) + Scrappy (Normal and
    // Fighting moves hit Ghost types, Intimidate immunity). A part is skipped while the regular ability is Footwork /
    // Scrappy, so it applies once.
    new AbBuilder(AbilityId.IRON_LEGS, 9) //
      .conditionalAttr(
        pokemon => !mainAbilityIs(pokemon, AbilityId.FOOTWORK),
        MovePowerBoostAbAttr,
        (_user, _target, move) => footworkMoves.has(move.id),
        1.2,
      )
      .conditionalAttr(
        pokemon => !mainAbilityIs(pokemon, AbilityId.SCRAPPY),
        IgnoreTypeImmunityAbAttr,
        PokemonType.GHOST,
        [PokemonType.NORMAL, PokemonType.FIGHTING],
      )
      .conditionalAttr(pokemon => !mainAbilityIs(pokemon, AbilityId.SCRAPPY), IntimidateImmunityAbAttr)
      .build(),
    // Local fork (2026-11-14): passive rebalance. Gas Leak = Toxic Debris (a layer of Toxic Spikes on the attacker's
    // side after each physical hit) + Aftermath (1/4 of the attacker's max HP when a contact move knocks it out;
    // Damp and Magic Guard block it).
    new AbBuilder(AbilityId.GAS_LEAK, 9) //
      .attr(
        PostDefendApplyArenaTrapTagAbAttr,
        (_target, _user, move) => move.category === MoveCategory.PHYSICAL,
        ArenaTagType.TOXIC_SPIKES,
      )
      .attr(PostFaintContactDamageAbAttr, 4)
      .bypassFaint()
      .build(),
    // Local fork (2026-11-14): passive rebalance. Farsight = Compound Eyes (accuracy x1.3, not one-hit KO moves) +
    // Tinted Lens (not very effective damage x2). A part is skipped while the regular ability is Compound Eyes /
    // Tinted Lens, so the multiplier applies once (e.g. a Tinted Lens Noctowl deals x2, not x4).
    new AbBuilder(AbilityId.FARSIGHT, 9) //
      .conditionalAttr(
        pokemon => !mainAbilityIs(pokemon, AbilityId.COMPOUND_EYES),
        StatMultiplierAbAttr,
        Stat.ACC,
        1.3,
        (_user, _target, move) => farsightBoostsAccuracy(move),
      )
      .conditionalAttr(
        pokemon => !mainAbilityIs(pokemon, AbilityId.COMPOUND_EYES),
        AiMovegenMoveStatsAbAttr,
        compoundEyesAiMovegenEffect(farsightBoostsAccuracy),
      )
      .conditionalAttr(
        pokemon => !mainAbilityIs(pokemon, AbilityId.TINTED_LENS),
        MoveDamageBoostAbAttr,
        2,
        (user, target, move) => (target?.getMoveEffectiveness(user!, move) ?? 1) <= 0.5,
      )
      .build(),
    // Local fork (2026-11-14): passive rebalance. Thorn Armor = Rough Skin (1/8 of a contact attacker's max HP, also
    // when fainting) + Stamina (Def +1 per damaging hit). The Stamina half stays off once the holder has fainted, as
    // Stamina itself (not bypassFaint) does.
    new AbBuilder(AbilityId.THORN_ARMOR, 9) //
      .attr(PostDefendContactDamageAbAttr, 8)
      .conditionalAttr(
        pokemon => !pokemon.isFainted(),
        PostDefendStatStageChangeAbAttr,
        (_target, _user, move) => move.category !== MoveCategory.STATUS,
        Stat.DEF,
        1,
      )
      .bypassFaint()
      .build(),
  ];
}
