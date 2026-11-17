// Local fork (2026-11-14): custom moves. Gardener (정원사, Essentials GARDENER) and Turnabout (전세역전, Essentials
// TURNABOUT), the two abilities of the 2026-11-14 custom moves (tools/drive/custom_moves_1114/design_spec.json,
// "abilities"). No species has them yet: passives come only from the generated custom-passives.ts table.
// Keep the entries in `AbilityId` order: `allAbilities` is indexed by `AbilityId`, and this file is spread after
// custom-abilities-1114-e.ts (Clearing Gust).
// Do not import init-abilities.ts here (it imports this file).
import {
  PostSummonAddGardenAbAttr,
  PostSummonSwapArenaTagsAbAttr,
  SummonTerrainAiMovegenMoveStatsAbAttr,
} from "#abilities/ab-attrs";
import { AbBuilder, type Ability } from "#abilities/ability";
import { getOncePerBattleCondition } from "#abilities/custom-ability-helpers";
import { AbilityId } from "#enums/ability-id";
import { PokemonType } from "#enums/pokemon-type";

/** The custom-moves abilities, in `AbilityId` order (after `CLEARING_GUST`). */
export function customAbilities1114F(): Ability[] {
  return [
    // Local fork (2026-11-14): custom moves. On every entry, sets the Garden (정원) on its own side for 5 turns (+2 per
    // Mystical Rock stack); nothing at all while that side already has one. The usual post-summon priority 0, so
    // Pokémon entering together act in speed order as in Essentials (a slower Turnabout takes a faster Gardener's new
    // Garden). A Turnabout on the same Pokémon still swaps first and the new Garden stays on its own side (the user's
    // spec: "같은 포켓몬이 전세역전도 가지고 있으면 전세역전을 먼저 처리한 뒤 정원을 가꿉니다"): the ability acts before
    // the passive, and `PostSummonPhasePriorityQueue` puts a Turnabout passive before a Gardener ability.
    // Review fix: it was priority -1, which also put it after every other Pokémon's Turnabout.
    // Like Grassy Surge, enemy moveset generation rates its Grass moves x1.3 (the Garden's boost).
    new AbBuilder(AbilityId.GARDENER, 9) //
      .attr(PostSummonAddGardenAbAttr)
      .attr(SummonTerrainAiMovegenMoveStatsAbAttr, PokemonType.GRASS)
      .build(),
    // Local fork (2026-11-14): custom moves. On entry, swaps both sides' effects like Court Change, once per battle
    // (wave). With nothing to swap it stays quiet and keeps its use: `waveData.abilitiesApplied` only records an
    // activation (the user's spec: "바꿀 것이 없으면 발동하지 않고 횟수도 쓰지 않습니다")
    new AbBuilder(AbilityId.TURNABOUT, 9) //
      .attr(PostSummonSwapArenaTagsAbAttr)
      .condition(getOncePerBattleCondition(AbilityId.TURNABOUT))
      .build(),
  ];
}
