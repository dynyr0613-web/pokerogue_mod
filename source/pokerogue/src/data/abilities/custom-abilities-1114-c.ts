// Local fork (2026-11-14): passive rebalance. Batch C of the new custom abilities.
// Spec: tools/drive/passive_adjust_1114/impl_batches.json -> "abilities"[ID] ("효과자세히" is the exact behaviour).
// Guide: tools/drive/passive_adjust_1114/pokerogue_scaffold.md
// Keep the entries in this order: `allAbilities` is indexed by `AbilityId`, so the order must match the enum.
// Do not import init-abilities.ts here (it imports this file); shared helpers are in custom-ability-helpers.ts.
//
// Every ability of batch C combines two existing abilities: each entry chains the attrs of both bases as they are in
// init-abilities.ts (none of the bases is ignorable). Where the spec says a part must not stack with the same effect
// from the regular ability ("본 특성"), that part carries a `mainAbilityIs` condition.
// Effects that react to a base's ID instead of its attrs: Wind Power's Tailwind half (TailwindTag.onAdd in
// src/data/arena-tag.ts) needs THUNDERCLOUD added there; that file is outside this batch file (see the batch report).
import {
  type AbAttrParamsWithCancel,
  AiMovegenMoveStatsAbAttr,
  BlockRecoilDamageAttr,
  BlockWeatherDamageAttr,
  BypassBurnDamageReductionAbAttr,
  getWeatherCondition,
  MovePowerBoostAbAttr,
  MoveTypePowerBoostAbAttr,
  PostBiomeChangeWeatherChangeAbAttr,
  PostDefendAbAttr,
  PostDefendApplyBattlerTagAbAttr,
  PostDefendApplyStatusEffectAbAttr,
  PostDefendContactDamageAbAttr,
  type PostMoveInteractionAbAttrParams,
  PostSummonStatStageChangeAbAttr,
  PostSummonWeatherChangeAbAttr,
  PostVictoryStatStageChangeAbAttr,
  StatMultiplierAbAttr,
} from "#abilities/ab-attrs";
import { AbBuilder, type Ability } from "#abilities/ability";
import { droughtAiMovegenEffect, mainAbilityIs } from "#abilities/custom-ability-helpers";
import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { type BattleStat, Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import type { AbAttrCondition } from "#types/ability-types";

/**
 * Local fork (2026-11-14): passive rebalance.
 * Rock Head's recoil block for Headstrong (막무가내). The spec keeps Chloroblast's HP cost ("클로로블라스트의 HP 소모는
 * 그대로 받는다"), which upstream models as blockable recoil (`RecoilAttr(true, 0.5)`), so this copy lets that one
 * through. Mind Blown / Steel Beam, crash damage, Struggle and the Life Orb never consult this attr, as with Rock Head.
 * It still extends {@linkcode BlockRecoilDamageAttr}, so `RecoilAttr` finds it like Rock Head's attr.
 */
class HeadstrongBlockRecoilAbAttr extends BlockRecoilDamageAttr {
  override canApply(params: AbAttrParamsWithCancel): boolean {
    return super.canApply(params) && params.pokemon.getLastXMoves(1)[0]?.move !== MoveId.CHLOROBLAST;
  }
}

/**
 * Local fork (2026-11-14): passive rebalance.
 * The category a hit really used, for Toughness (맷집): Photon Geyser, Shell Side Arm and Tera Blast change theirs.
 * For those moves it reads the category the damage step itself used (`PokemonTurnData.lastHitCategory`, set by
 * `Pokemon.getAttackDamage`), so nothing is worked out again after the hit: Shell Side Arm breaks an exact
 * physical/special tie with a battle RNG roll, and a second roll could disagree with the damage step. The variable attrs
 * run here only as a fallback when no record of this hit exists (never during a real hit).
 * Psyshock-like moves keep their own category (special), as the spec asks.
 */
function hitCategory(target: Pokemon, user: Pokemon, move: Move): MoveCategory {
  if (move.category === MoveCategory.STATUS || !move.hasAttr("VariableMoveCategoryAttr")) {
    return move.category;
  }
  const lastHit = target.turnData.lastHitCategory;
  if (lastHit != null && lastHit.sourceId === user.id && lastHit.move === move.id) {
    return lastHit.category;
  }
  return user.getMoveCategory(target, move);
}

/**
 * Local fork (2026-11-14): passive rebalance.
 * Toughness (맷집): one attr that raises Def by 1 after a physical hit or Sp. Def by 1 after a special hit, so a hit
 * always raises exactly one of the two (two separate Stamina-style attrs each asked for the category on their own).
 * Like `PostDefendStatStageChangeAbAttr`, it shows the ability and queues a `StatStageChangePhase`.
 */
class ToughnessStatStageChangeAbAttr extends PostDefendAbAttr {
  constructor() {
    super(true);
  }

  /** The stat this hit raises, or `undefined` for a status move */
  private static statFor(pokemon: Pokemon, attacker: Pokemon, move: Move): BattleStat | undefined {
    switch (hitCategory(pokemon, attacker, move)) {
      case MoveCategory.PHYSICAL:
        return Stat.DEF;
      case MoveCategory.SPECIAL:
        return Stat.SPDEF;
      default:
        return undefined;
    }
  }

  override canApply({ pokemon, opponent: attacker, move }: PostMoveInteractionAbAttrParams): boolean {
    return ToughnessStatStageChangeAbAttr.statFor(pokemon, attacker, move) !== undefined;
  }

  override apply({ simulated, pokemon, opponent: attacker, move }: PostMoveInteractionAbAttrParams): void {
    if (simulated) {
      return;
    }
    const stat = ToughnessStatStageChangeAbAttr.statFor(pokemon, attacker, move);
    if (stat === undefined) {
      return;
    }
    globalScene.phaseManager.unshiftNew("StatStageChangePhase", {
      battlerIndex: pokemon.getBattlerIndex(),
      changes: [{ stat, stages: 1 }],
      sourcePokemon: pokemon,
    });
  }
}

/** Local fork (2026-11-14): passive rebalance. Sandstorm is up (and not suppressed by Cloud Nine / Air Lock). */
const inSandstorm: AbAttrCondition = getWeatherCondition(WeatherType.SANDSTORM);
/** Local fork (2026-11-14): passive rebalance. Sun or harsh sun is up (Chlorophyll's condition). */
const inSun: AbAttrCondition = getWeatherCondition(WeatherType.SUNNY, WeatherType.HARSH_SUN);
/** Local fork (2026-11-14): passive rebalance. Guts / Quick Feet trigger: any status, or Comatose. */
const hasStatusForGuts: AbAttrCondition = pokemon => !!pokemon.status || pokemon.hasAbility(AbilityId.COMATOSE);

/** Batch C of the 2026-11-14 custom abilities, in `AbilityId` order. */
export function customAbilities1114C(): Ability[] {
  return [
    // Local fork (2026-11-14): passive rebalance. Headstrong (막무가내) = Reckless + Rock Head.
    // Reckless part: RECKLESS_MOVE moves x1.2 (also Jump Kick / High Jump Kick, which carry the flag here); skipped
    // when the regular ability is Reckless, so the x1.2 applies once.
    // Rock Head part: no recoil from those moves; crash damage, Struggle, the Life Orb, Mind Blown, Steel Beam and
    // Chloroblast still cost HP (see HeadstrongBlockRecoilAbAttr).
    new AbBuilder(AbilityId.HEADSTRONG, 9) //
      .conditionalAttr(
        pokemon => !mainAbilityIs(pokemon, AbilityId.RECKLESS),
        MovePowerBoostAbAttr,
        (_user, _target, move) => move.hasFlag(MoveFlags.RECKLESS_MOVE),
        1.2,
      )
      .attr(HeadstrongBlockRecoilAbAttr)
      .build(),
    // Local fork (2026-11-14): passive rebalance. Full Bloom (만개) = Drought + Chlorophyll.
    // Drought part: sun on entry and on biome change (Heat Rock 8 turns, blocked by the strong weathers, through
    // PostSummonWeatherChangeAbAttr as for Drought); Flower Gift reacts to the weather change by itself.
    // Chlorophyll part: Speed x2 in sun or harsh sun. The spec says Full Bloom is "the same as Drought" for a
    // Chlorophyll holder, so the Speed part is skipped when the regular ability is Chlorophyll (no x4).
    new AbBuilder(AbilityId.FULL_BLOOM, 9) //
      .attr(PostSummonWeatherChangeAbAttr, WeatherType.SUNNY)
      .attr(PostBiomeChangeWeatherChangeAbAttr, WeatherType.SUNNY)
      .attr(AiMovegenMoveStatsAbAttr, droughtAiMovegenEffect)
      .conditionalAttr(
        pokemon => inSun(pokemon) && !mainAbilityIs(pokemon, AbilityId.CHLOROPHYLL),
        StatMultiplierAbAttr,
        Stat.SPD,
        2,
      )
      .build(),
    // Local fork (2026-11-14): passive rebalance. Sand Sprint (모래질주) = Sand Rush + Sand Force, in sandstorm only
    // (ability-level condition, as on both bases). Speed x2 (skipped with a regular Sand Rush), Rock / Ground / Steel
    // x1.3 (skipped with a regular Sand Force), no sandstorm damage. It never summons sandstorm itself.
    new AbBuilder(AbilityId.SAND_SPRINT, 9) //
      .conditionalAttr(pokemon => !mainAbilityIs(pokemon, AbilityId.SAND_RUSH), StatMultiplierAbAttr, Stat.SPD, 2)
      .conditionalAttr(
        pokemon => !mainAbilityIs(pokemon, AbilityId.SAND_FORCE),
        MoveTypePowerBoostAbAttr,
        PokemonType.ROCK,
        1.3,
        true,
      )
      .conditionalAttr(
        pokemon => !mainAbilityIs(pokemon, AbilityId.SAND_FORCE),
        MoveTypePowerBoostAbAttr,
        PokemonType.GROUND,
        1.3,
        true,
      )
      .conditionalAttr(
        pokemon => !mainAbilityIs(pokemon, AbilityId.SAND_FORCE),
        MoveTypePowerBoostAbAttr,
        PokemonType.STEEL,
        1.3,
        true,
      )
      .attr(BlockWeatherDamageAttr, WeatherType.SANDSTORM)
      .condition(inSandstorm)
      .build(),
    // Local fork (2026-11-14): passive rebalance. Lookout (망보기) = Intimidate + Stakeout.
    // Intimidate part keeps the intimidate flag, so Inner Focus / Oblivious / Own Tempo / Scrappy, Guard Dog, Rattled,
    // Defiant / Competitive and the Adrenaline Orb react exactly as to Intimidate.
    // Stakeout part: x2 power against a target that switched in this turn (turn data is reset at turn start, so a
    // Pokémon sent in after a faint at the end of a turn does not count).
    new AbBuilder(AbilityId.LOOKOUT, 9) //
      .attr(PostSummonStatStageChangeAbAttr, [{ stat: Stat.ATK, stages: -1 }], false, true)
      .attr(MovePowerBoostAbAttr, (_user, target, _move) => !!target?.turnData.switchedInThisTurn, 2)
      .build(),
    // Local fork (2026-11-14): passive rebalance. Thundercloud (번개구름) = Transistor + Wind Power.
    // Electric moves x1.3; Charged when hit by a wind move (no change if already Charged).
    // The "own-side Tailwind starts" half is hard-coded by ability ID in TailwindTag.onAdd (src/data/arena-tag.ts),
    // which must check THUNDERCLOUD beside WIND_POWER.
    new AbBuilder(AbilityId.THUNDERCLOUD, 9) //
      .attr(MoveTypePowerBoostAbAttr, PokemonType.ELECTRIC, 1.3)
      .attr(
        PostDefendApplyBattlerTagAbAttr,
        (_target, _user, move) => move.hasFlag(MoveFlags.WIND_MOVE),
        BattlerTagType.CHARGED,
      )
      .build(),
    // Local fork (2026-11-14): passive rebalance. Rock Fangs (바위송곳니) = Rocky Payload + Strong Jaw:
    // Rock moves x1.5, biting moves x1.5 (no Rock biting move exists, so they never stack).
    new AbBuilder(AbilityId.ROCK_FANGS, 9) //
      .attr(MoveTypePowerBoostAbAttr, PokemonType.ROCK)
      .attr(MovePowerBoostAbAttr, (_user, _target, move) => move.hasFlag(MoveFlags.BITING_MOVE), 1.5)
      .build(),
    // Local fork (2026-11-14): passive rebalance. Shock Barbs (전기가시) = Iron Barbs + Static.
    // On a contact hit: the attacker loses 1/8 of its max HP (Magic Guard blocks it), then a separate 30% roll
    // paralyses it (Electric types, Limber etc. block it). Both work when the hit makes the holder faint.
    new AbBuilder(AbilityId.SHOCK_BARBS, 9) //
      .attr(PostDefendContactDamageAbAttr, 8)
      .attr(PostDefendApplyStatusEffectAbAttr, 30, true, StatusEffect.PARALYSIS)
      .bypassFaint()
      .build(),
    // Local fork (2026-11-14): passive rebalance. Sand Tempest (모래폭풍) = Sand Stream + Sand Force.
    // Sandstorm on entry and on biome change (Smooth Rock 8 turns, blocked by the strong weathers). In sandstorm:
    // Rock / Ground / Steel x1.3 (skipped with a regular Sand Force) and no sandstorm damage. The sandstorm conditions
    // sit on the attrs, not on the ability, so the weather setting still works when there is no sandstorm.
    new AbBuilder(AbilityId.SAND_TEMPEST, 9) //
      .attr(PostSummonWeatherChangeAbAttr, WeatherType.SANDSTORM)
      .attr(PostBiomeChangeWeatherChangeAbAttr, WeatherType.SANDSTORM)
      .conditionalAttr(
        pokemon => inSandstorm(pokemon) && !mainAbilityIs(pokemon, AbilityId.SAND_FORCE),
        MoveTypePowerBoostAbAttr,
        PokemonType.ROCK,
        1.3,
        true,
      )
      .conditionalAttr(
        pokemon => inSandstorm(pokemon) && !mainAbilityIs(pokemon, AbilityId.SAND_FORCE),
        MoveTypePowerBoostAbAttr,
        PokemonType.GROUND,
        1.3,
        true,
      )
      .conditionalAttr(
        pokemon => inSandstorm(pokemon) && !mainAbilityIs(pokemon, AbilityId.SAND_FORCE),
        MoveTypePowerBoostAbAttr,
        PokemonType.STEEL,
        1.3,
        true,
      )
      .conditionalAttr(inSandstorm, BlockWeatherDamageAttr, WeatherType.SANDSTORM)
      .build(),
    // Local fork (2026-11-14): passive rebalance. Hunting Instinct (사냥본능) = Strong Jaw + Moxie.
    // Biting moves x1.5 (skipped with a regular Strong Jaw); Atk +1 after knocking out a foe (skipped with a regular
    // Moxie).
    new AbBuilder(AbilityId.HUNTING_INSTINCT, 9) //
      .conditionalAttr(
        pokemon => !mainAbilityIs(pokemon, AbilityId.STRONG_JAW),
        MovePowerBoostAbAttr,
        (_user, _target, move) => move.hasFlag(MoveFlags.BITING_MOVE),
        1.5,
      )
      .conditionalAttr(pokemon => !mainAbilityIs(pokemon, AbilityId.MOXIE), PostVictoryStatStageChangeAbAttr, [
        { stat: Stat.ATK, stages: 1 },
      ])
      .build(),
    // Local fork (2026-11-14): passive rebalance. Rampage (폭주) = Guts + Quick Feet, with any status (or Comatose).
    // Guts part: Atk x1.5 and no burn halving of physical damage. Quick Feet part: Speed x1.5, with the paralysis
    // halving undone (x2 while paralysed, as Quick Feet does). As in the Essentials version, the Atk part is skipped
    // with a regular Guts and the Speed parts with a regular Quick Feet, so the multipliers apply once.
    new AbBuilder(AbilityId.RAMPAGE, 9) //
      .attr(BypassBurnDamageReductionAbAttr)
      .conditionalAttr(
        pokemon => hasStatusForGuts(pokemon) && !mainAbilityIs(pokemon, AbilityId.GUTS),
        StatMultiplierAbAttr,
        Stat.ATK,
        1.5,
      )
      .conditionalAttr(
        pokemon => pokemon.status?.effect === StatusEffect.PARALYSIS && !mainAbilityIs(pokemon, AbilityId.QUICK_FEET),
        StatMultiplierAbAttr,
        Stat.SPD,
        2,
      )
      .conditionalAttr(
        pokemon => hasStatusForGuts(pokemon) && !mainAbilityIs(pokemon, AbilityId.QUICK_FEET),
        StatMultiplierAbAttr,
        Stat.SPD,
        1.5,
      )
      .build(),
    // Local fork (2026-11-14): passive rebalance. Toughness (맷집) = Stamina / Fortitude split by the hit's category:
    // a physical hit raises Def by 1, a special hit (Psyshock too) raises Sp. Def by 1. Every hit of a multi-strike
    // move counts; status moves and hits on a substitute do not (PostDefend is skipped for substitute hits).
    // One attr (ToughnessStatStageChangeAbAttr) follows the category the damage step used, so exactly one stat rises.
    new AbBuilder(AbilityId.TOUGHNESS, 9) //
      .attr(ToughnessStatStageChangeAbAttr)
      .build(),
  ];
}
