// Local fork (2026-11-19): 1.2.0 D12, the passive sheet's extra abilities ("추가 조정 특성"; the user: "d12 실행").
// The three abilities that column gives to species and the fork did not have yet. Exact rules:
// tools/drive/answers_1118/detail_final_before_laststand_20261118.json (특성목록 상세 설명) and
// tools/drive/passive_adjust_1114/custom_abilities.json (Essentials' Custom Abilities plugin).
// Keep the entries in `AbilityId` order: `allAbilities` is indexed by `AbilityId`, and this file is spread after
// custom-abilities-1114-f.ts (Turnabout).
// Do not import init-abilities.ts here (it imports this file).
import { AiMovegenMoveStatsAbAttr, PostSummonStatStageChangeAbAttr, StatMultiplierAbAttr } from "#abilities/ab-attrs";
import { AbBuilder, type Ability } from "#abilities/ability";
import { getOncePerBattleCondition } from "#abilities/custom-ability-helpers";
import { AbilityId } from "#enums/ability-id";
import { MoveCategory } from "#enums/move-category";
import { Stat } from "#enums/stat";
import type { PokemonAttackCondition } from "#types/ability-types";

/**
 * Archmage and Grit only act on special moves (Essentials: "특수 기술의 데미지를 계산할 때 ... 물리 기술에는 영향이 없다"),
 * so a physical slicing move that reads Sp. Atk through Mind Blade is not boosted
 */
const notPhysical: PokemonAttackCondition = (_user, _target, move) => move.category !== MoveCategory.PHYSICAL;

/** The D12 abilities, in `AbilityId` order (after `TURNABOUT`). */
export function customAbilities1119D12(): Ability[] {
  return [
    // Local fork (2026-11-19): Archmage (대마도사), the special Huge Power: Sp. Atk x2 for special moves (as a passive
    // too). Like Huge Power, enemy moveset generation rates its special moves x2.
    new AbBuilder(AbilityId.ARCHMAGE, 9) //
      .attr(StatMultiplierAbAttr, Stat.SPATK, 2, notPhysical)
      .attr(AiMovegenMoveStatsAbAttr, ({ move, powerMult }) => {
        if (move.category === MoveCategory.SPECIAL) {
          powerMult.value *= 2;
        }
      })
      .build(),
    // Local fork (2026-11-19): Wicked Scheme (흑심), Blade Dance's Nasty Plot twin: Sp. Atk +2 on its first entry in a
    // battle (wave) only; coming back in later in the same battle does nothing
    new AbBuilder(AbilityId.WICKED_SCHEME, 9) //
      .attr(PostSummonStatStageChangeAbAttr, [{ stat: Stat.SPATK, stages: 2 }], true)
      .condition(getOncePerBattleCondition(AbilityId.WICKED_SCHEME))
      .build(),
    // Local fork (2026-11-19): Grit (투혼), the special Guts: Sp. Atk x1.5 for special moves while it has a status
    // condition (or Comatose, as Guts counts it)
    new AbBuilder(AbilityId.GRIT, 9) //
      .conditionalAttr(
        pokemon => !!pokemon.status || pokemon.hasAbility(AbilityId.COMATOSE),
        StatMultiplierAbAttr,
        Stat.SPATK,
        1.5,
        notPhysical,
      )
      .build(),
  ];
}
