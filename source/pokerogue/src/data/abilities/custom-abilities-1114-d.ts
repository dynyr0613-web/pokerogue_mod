// Local fork (2026-11-14): passive rebalance. Batch D of the new custom abilities.
// Spec: tools/drive/passive_adjust_1114/impl_batches.json -> "abilities"[ID] ("효과자세히" is the exact behaviour).
// Guide: tools/drive/passive_adjust_1114/pokerogue_scaffold.md
// Keep the entries in this order: `allAbilities` is indexed by `AbilityId`, so the order must match the enum.
// Do not import init-abilities.ts here (it imports this file); shared helpers are in custom-ability-helpers.ts.
//
// Renamed copies carry exactly the attrs and flags (ignorable or not) of their base in init-abilities.ts, so they behave
// the same as a regular ability and as a passive. Effects that react to a base's ID instead of its attrs: only the
// mystery-encounter requirement list of Well-Baked Body (Fire immunity), which does not concern Mud Armor (Water).
import {
  AiMovegenMoveStatsAbAttr,
  AllyMoveCategoryPowerBoostAbAttr,
  MovePowerBoostAbAttr,
  MoveTypeChangeAbAttr,
  PostSummonAddArenaTagAbAttr,
  ReceivedMoveDamageMultiplierAbAttr,
  StatMultiplierAbAttr,
  TypeImmunityStatStageChangeAbAttr,
} from "#abilities/ab-attrs";
import { AbBuilder, type Ability } from "#abilities/ability";
import { anyTypeMoveConversionCondition } from "#abilities/custom-ability-helpers";
import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import type { AiMovegenMoveStatsAbAttrParams } from "#types/ability-types";

/**
 * Local fork (2026-11-14): passive rebalance.
 * Whether someone else's Mold Breaker-like effect is ignoring abilities right now. It mirrors the check that
 * `Pokemon.canApplyAbility` makes for `.ignorable()` abilities, for one attr of an ability that is not ignorable as a
 * whole (Chime Voice: only the damage-taken part is ignored).
 * @param target - The Pokémon whose ability part would apply
 * @returns `true` if that part must not apply
 */
function isAbilityIgnoredByOther(target: Pokemon): boolean {
  if (globalScene.movesetGenInProgress) {
    return false;
  }
  const arena = globalScene.arena;
  return arena.ignoreAbilities && arena.ignoringEffectSource !== target.getBattlerIndex();
}

/**
 * Local fork (2026-11-14): passive rebalance.
 * Moveset-generation weighting of Hustle's Attack x1.5 without its accuracy drop (Vigor, All-Out Pitch).
 * @param __namedParameters.move - Needed for proper typedoc rendering
 */
function attackBoostAiMovegenEffect({ move, powerMult }: AiMovegenMoveStatsAbAttrParams): void {
  if (move.category === MoveCategory.PHYSICAL) {
    powerMult.value *= 1.5;
  }
}

/** Batch D of the 2026-11-14 custom abilities, in `AbilityId` order. */
export function customAbilities1114D(): Ability[] {
  return [
    // Local fork (2026-11-14): passive rebalance. Aura Guard copy (Fluffy without the Fire weakness): contact damage
    // taken x0.5, judged on the target side (an attacker's Punching Glove hides contact), ignorable
    new AbBuilder(AbilityId.PLUSH_BODY, 9) //
      .attr(
        ReceivedMoveDamageMultiplierAbAttr,
        (target, user, move) =>
          move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user, target, targetSide: true }),
        0.5,
      )
      .ignorable()
      .build(),
    // Local fork (2026-11-14): passive rebalance. Hustle without the accuracy drop: Attack x1.5
    new AbBuilder(AbilityId.VIGOR, 9) //
      .attr(StatMultiplierAbAttr, Stat.ATK, 1.5)
      .attr(AiMovegenMoveStatsAbAttr, attackBoostAiMovegenEffect)
      .build(),
    // Local fork (2026-11-14): passive rebalance. Hustle's Attack x1.5 without the accuracy drop; instead status moves
    // can't be selected, like Taunt (the rule is `getAllOutPitchMoveDeniedText` in custom-ability-helpers.ts, asked by
    // `Pokemon.isMoveSelectable` and `MovePhase`)
    new AbBuilder(AbilityId.ALL_OUT_PITCH, 9) //
      .attr(StatMultiplierAbAttr, Stat.ATK, 1.5)
      .attr(AiMovegenMoveStatsAbAttr, attackBoostAiMovegenEffect)
      .build(),
    // Local fork (2026-11-14): passive rebalance. Well-Baked Body for Water: Water-move immunity + Defense +2, ignorable
    new AbBuilder(AbilityId.MUD_ARMOR, 9) //
      .attr(TypeImmunityStatStageChangeAbAttr, PokemonType.WATER, Stat.DEF, 2)
      .ignorable()
      .build(),
    // Local fork (2026-11-14): passive rebalance. Battery that also covers the user: the allies' special moves x1.3
    // (Battery's attr, applied from the ally by move.ts) and the user's own special moves x1.3. Two holders side by side
    // (or a Battery ally) multiply: 1.3 x 1.3
    new AbBuilder(AbilityId.POWER_CHEER, 9) //
      .attr(AllyMoveCategoryPowerBoostAbAttr, [MoveCategory.SPECIAL], 1.3)
      .attr(MovePowerBoostAbAttr, (_user, _target, move) => move.category === MoveCategory.SPECIAL, 1.3)
      .build(),
    // Local fork (2026-11-14): passive rebalance. Liquid Voice with Psychic instead of Water + Punk Rock (the same frame
    // as Vocal Sac): sound moves become Psychic and get x1.3; sound damage taken x0.5. Only the damage-taken part is
    // ignored by Mold Breaker and the like, so the ability is not `.ignorable()` and that attr checks it itself
    new AbBuilder(AbilityId.CHIME_VOICE, 9) //
      .attr(
        MoveTypeChangeAbAttr,
        PokemonType.PSYCHIC,
        (user, target, move) =>
          move.hasFlag(MoveFlags.SOUND_BASED) && anyTypeMoveConversionCondition(user, target, move),
      )
      .attr(MovePowerBoostAbAttr, (_user, _target, move) => move.hasFlag(MoveFlags.SOUND_BASED), 1.3)
      .attr(
        ReceivedMoveDamageMultiplierAbAttr,
        (target, _user, move) => move.hasFlag(MoveFlags.SOUND_BASED) && !isAbilityIgnoredByOther(target),
        0.5,
      )
      .build(),
    // Local fork (2026-11-14): passive rebalance. Trick Room (5 turns, whole field) on entry. Re-adding a room tag
    // removes it (`RoomArenaTag.onOverlap`), so nothing happens while Trick Room is already up: it is neither lifted
    // nor refreshed. PokeRogue has no Afterglow (7 turns in Essentials) and no Room Service item
    new AbBuilder(AbilityId.SPACE_WARP, 9) //
      .conditionalAttr(
        () => !globalScene.arena.getTag(ArenaTagType.TRICK_ROOM),
        PostSummonAddArenaTagAbAttr,
        true,
        ArenaTagType.TRICK_ROOM,
        5,
      )
      .build(),
    // Local fork (2026-11-14): passive rebalance. Mega Launcher's ball-and-bomb version: moves blocked by Bulletproof
    // (MoveFlags.BALLBOMB_MOVE, the spec's 25 moves plus Syrup Bomb, as Essentials' `bombMove?`) x1.3
    new AbBuilder(AbilityId.CANNONEER, 9) //
      .attr(MovePowerBoostAbAttr, (_user, _target, move) => move.hasFlag(MoveFlags.BALLBOMB_MOVE), 1.3)
      .build(),
  ];
}
