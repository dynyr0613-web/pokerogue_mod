// Local fork (2026-11-14): passive rebalance. Follow-up to batches A-D: Clearing Gust (선풍, Essentials CLEARINGGUST),
// the passive of the Hoppip line (HOPPIP row of Design/패시브_종족별.xlsx), which the first 42 left out.
// Sheet: "등장할 때 자기 진영의 스텔스록·압정뿌리기·독압정·끈적끈적네트(와 거다이맥스 강철 설치물)를 피해를 받기 전에 날려 버린다."
// Essentials reference: Plugins/[Custom] Custom Abilities/Custom Abilities.rb (`clear_hazards`, `pbEntryHazards`).
// Keep the entries in `AbilityId` order: `allAbilities` is indexed by `AbilityId`, and this file is spread after batch D.
// Do not import init-abilities.ts here (it imports this file).
import { ClearOwnSideEntryHazardsAbAttr } from "#abilities/ab-attrs";
import { AbBuilder, type Ability } from "#abilities/ability";
import { AbilityId } from "#enums/ability-id";

/** Follow-up abilities of the 2026-11-14 rebalance, in `AbilityId` order (after `CANNONEER`). */
export function customAbilities1114E(): Ability[] {
  return [
    // Local fork (2026-11-14): passive rebalance. On entry, before the hazards act on it: removes Stealth Rock, Spikes,
    // Toxic Spikes and Sticky Web from its own side (ability bar + message). `PostSummonPhase` applies the attr, so it
    // works the same as the regular ability and as a passive, for the player and the enemy, on every switch-in.
    // Not ignorable (Mold Breaker never acts on a switch-in anyway); Neutralizing Gas suppresses it as usual
    new AbBuilder(AbilityId.CLEARING_GUST, 9) //
      .attr(ClearOwnSideEntryHazardsAbAttr)
      .build(),
  ];
}
