// Local fork (2026-11-14): passive rebalance. Batch A of the new custom abilities.
// Spec: tools/drive/passive_adjust_1114/impl_batches.json -> "abilities"[ID] ("효과자세히" is the exact behaviour).
// Guide: tools/drive/passive_adjust_1114/pokerogue_scaffold.md
// Keep the entries in this order: `allAbilities` is indexed by `AbilityId`, so the order must match the enum.
// Do not import init-abilities.ts here (it imports this file); shared helpers are in custom-ability-helpers.ts.
//
// Every ability of batch A is a renamed copy of an existing ability: each entry carries exactly the attrs and flags
// (ignorable or not, edge-case markers) of its base in init-abilities.ts, so it behaves the same as a regular ability
// and as a passive. Effects that react to the base's ID instead of its attrs: none were found for these bases (the
// Mega Sol, Mega Launcher, Magician and Gale Herald effects all go through their attrs or arena tags).
import {
  MoveHealBoostAbAttr,
  MovePowerBoostAbAttr,
  MoveTypePowerBoostAbAttr,
  PostAttackApplyStatusEffectAbAttr,
  PostAttackStealHeldItemAbAttr,
  PostSummonAddUserSideTagAbAttr,
  PostVictoryStatStageChangeAbAttr,
  PreAttackWeatherOverrideAbAttr,
  ReceivedMoveDamageMultiplierAbAttr,
} from "#abilities/ab-attrs";
import { AbBuilder, type Ability } from "#abilities/ability";
import { beastBoostHighestStatCalc } from "#abilities/custom-ability-helpers";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";

/** Batch A of the 2026-11-14 custom abilities, in `AbilityId` order. */
export function customAbilities1114A(): Ability[] {
  return [
    // Local fork (2026-11-14): passive rebalance. Frost Fur = Ice Scales renamed: damage from special moves x0.5;
    // ignored by Mold Breaker, Teravolt and Turboblaze. With Ice Scales on the same Pokémon the halving would apply
    // twice, so the sheet never gives both.
    new AbBuilder(AbilityId.FROST_FUR, 9) //
      .attr(ReceivedMoveDamageMultiplierAbAttr, (_target, _user, move) => move.category === MoveCategory.SPECIAL, 0.5)
      .ignorable()
      .build(),
    // Local fork (2026-11-14): passive rebalance. Cat Burglar = Magician renamed: after damaging a target with an
    // attack, steals one of its held items. The fork's filter (only items the thief can still receive) lives inside
    // PostAttackStealHeldItemAbAttr, so it applies here too.
    new AbBuilder(AbilityId.CAT_BURGLAR, 9) //
      .attr(PostAttackStealHeldItemAbAttr)
      .build(),
    // Local fork (2026-11-14): passive rebalance. Sunbathe = Mega Sol renamed: the holder's own moves act as if the
    // weather were harsh sunlight (no Solar Beam / Solar Blade charge, Fire x1.5, Water x0.5, Fire Weather Ball,
    // 2/3 healing from Synthesis / Morning Sun / Moonlight). The real weather is unchanged, so weather abilities such
    // as Chlorophyll or Solar Power do not activate.
    new AbBuilder(AbilityId.SUNBATHE, 9) //
      .attr(PreAttackWeatherOverrideAbAttr, WeatherType.SUNNY)
      // Same open points as Mega Sol: Sand Veil / Snow Cloak interactions and flyout conformity
      .edgeCase()
      .build(),
    // Local fork (2026-11-14): passive rebalance. Shock Absorber = Shadow Shield renamed: damage x0.5 at full HP;
    // NOT ignorable (Mold Breaker, Teravolt and Turboblaze do not bypass it).
    new AbBuilder(AbilityId.SHOCK_ABSORBER, 9) //
      .attr(ReceivedMoveDamageMultiplierAbAttr, (target, _user, _move) => target.isFullHp(), 0.5)
      .build(),
    // Local fork (2026-11-14): passive rebalance. Beam Cannon = Hilt Cannon renamed: pulse moves and moves whose
    // MoveId ends in BEAM get x1.5 power. Like Hilt Cannon, Heal Pulse's healing is not boosted. Ball and bomb moves
    // are not included. With Mega Launcher / Hilt Cannon on the same Pokémon the boosts would stack, so the sheet
    // never gives both.
    new AbBuilder(AbilityId.BEAM_CANNON, 9) //
      .attr(
        MovePowerBoostAbAttr,
        (_user, _target, move) => move.hasFlag(MoveFlags.PULSE_MOVE) || MoveId[move.id].endsWith("BEAM"),
        1.5,
      )
      .build(),
    // Local fork (2026-11-14): passive rebalance. Glow Veil = Polar Light renamed: Aurora Veil for 5 turns on the
    // holder's side on every entry, whatever the weather; nothing (and no turn refresh) if the side already has one.
    // No once-per-battle limit. With Polar Light on the same Pokémon the second attr finds the veil already up, so it
    // is set only once.
    new AbBuilder(AbilityId.GLOW_VEIL, 9) //
      .attr(PostSummonAddUserSideTagAbAttr, ArenaTagType.AURORA_VEIL, 5)
      .build(),
    // Local fork (2026-11-14): passive rebalance. Hand-to-Hand = Tough Claws renamed: contact moves x1.3 power.
    // The same contact check as Tough Claws: the fork's Punching Glove (2026-11-11 rule) hides contact only from the
    // target's side and keeps Tough Claws' bonus, so it keeps this one too. Stacks with Tough Claws, so the sheet
    // never gives both.
    // After review: the spec's "no boost once the glove removes contact" is the main-series / Essentials rule; the
    // sheet's detailed-description column (detail_final.json) and the 효과자세히 note record the PokeRogue exception
    // ("포켓로그: 펀치글러브를 지녀 접촉하지 않게 된 펀치 기술에도 1.3배가 적용된다"), as for Tough Claws.
    new AbBuilder(AbilityId.HAND_TO_HAND, 9) //
      .attr(MovePowerBoostAbAttr, (_user, _target, move) => move.hasFlag(MoveFlags.MAKES_CONTACT), 1.3)
      .build(),
    // Local fork (2026-11-14): passive rebalance. Flameworker = Fire Mane renamed: Fire-type moves x1.5 power, judged
    // by the move's type after type changes (MoveTypePowerBoostAbAttr uses getMoveType). Stacks with Fire Mane, so
    // Mega Pyroar never gets it.
    new AbBuilder(AbilityId.FLAMEWORKER, 9) //
      .attr(MoveTypePowerBoostAbAttr, PokemonType.FIRE)
      .build(),
    // Local fork (2026-11-14): passive rebalance. Aura Master = Mega Launcher renamed: pulse moves x1.5 power and
    // Heal Pulse x1.5 healing (1/2 -> 3/4 of max HP). Stacks with Mega Launcher, so Clawitzer / Blastoise with that
    // ability never get it.
    new AbBuilder(AbilityId.AURA_MASTER, 9) //
      .attr(MovePowerBoostAbAttr, (_user, _target, move) => move.hasFlag(MoveFlags.PULSE_MOVE), 1.5)
      .attr(MoveHealBoostAbAttr, (_user, _target, move) => move.hasFlag(MoveFlags.PULSE_MOVE), 1.5)
      .build(),
    // Local fork (2026-11-14): passive rebalance. Toxic Spray = Toxic Chain renamed: 30% chance to badly poison a
    // target hit by one of the holder's attacks (contact or not); targets that can't be badly poisoned (Poison and
    // Steel types, immunities) are left alone by the status code. Rolls twice with Toxic Chain, so Okidogi never gets it.
    new AbBuilder(AbilityId.TOXIC_SPRAY, 9) //
      .attr(PostAttackApplyStatusEffectAbAttr, false, 30, StatusEffect.TOXIC)
      .build(),
    // Local fork (2026-11-14): passive rebalance. Current Herald = Gale Herald renamed: Tailwind for 4 turns on the
    // holder's side on entry; nothing if the side already has Tailwind. The Wind Rider / Wind Power reactions are
    // tied to the Tailwind tag (TailwindTag.onAdd), so they work as with Gale Herald. With Gale Herald on the same
    // Pokémon the Tailwind starts only once.
    new AbBuilder(AbilityId.CURRENT_HERALD, 9) //
      .attr(PostSummonAddUserSideTagAbAttr, ArenaTagType.TAILWIND, 4)
      .build(),
    // Local fork (2026-11-14): passive rebalance. High Spirits = Beast Boost renamed: after the holder knocks out a
    // target with a move, its highest stat other than HP (before stat stages; ties: Atk > Def > SpAtk > SpDef > Spd)
    // rises by 1. Other knock-out abilities such as Moxie trigger as well.
    new AbBuilder(AbilityId.HIGH_SPIRITS, 9) //
      .attr(PostVictoryStatStageChangeAbAttr, beastBoostHighestStatCalc)
      .build(),
  ];
}
