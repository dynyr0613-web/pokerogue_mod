/**
 * Local fork (2026-11-08): the reward screen's reroll price, taken out of `SelectModifierPhase.getRerollCost` (which
 * now calls it, unchanged in behaviour) so the Vending Machine encounter, whose prices are twice a locked one-item
 * reroll, can never drift from it. It lives here rather than in the phase module to keep phases out of the mystery
 * encounters' import graph.
 */
import { globalScene } from "#app/global-scene";
import { activeOverrides } from "#app/overrides";
import type { ModifierTier } from "#enums/modifier-tier";
import { HealShopCostModifier } from "#modifiers/modifier";
import { NumberHolder } from "#utils/common";

/** With the Lock Capsule's tier lock on, each item on the screen adds this much to the base price, by tier */
export const LOCKED_REROLL_TIER_VALUES: readonly number[] = [50, 125, 300, 750, 2000];
/** The base price without the tier lock, whatever the screen holds */
export const UNLOCKED_REROLL_BASE_VALUE = 250;

/**
 * Local fork (2026-11-08): the reroll price on the current wave. With `lockedTiers` (the tier of each item on the
 * screen, the Lock Capsule's tier lock on) the base is the sum of their {@linkcode LOCKED_REROLL_TIER_VALUES}, else
 * {@linkcode UNLOCKED_REROLL_BASE_VALUE}; it is multiplied by ceil(wave / 10), 2^`rerollCount` and `multiplier`, then
 * by Black Sludge ({@linkcode HealShopCostModifier}). 0 with `WAIVE_ROLL_FEE_OVERRIDE`.
 * @param lockedTiers - The tiers on the screen while they are locked, or `null` when they are not
 * @param rerollCount - Rerolls already done on this screen
 * @param multiplier - The screen's custom reroll multiplier (1 on an ordinary screen; a negative one means no reroll
 *   and is handled by the caller)
 */
export function computeRerollCost(
  lockedTiers: readonly (ModifierTier | undefined)[] | null,
  rerollCount: number,
  multiplier: number,
): number {
  let baseValue = 0;
  if (activeOverrides.WAIVE_ROLL_FEE_OVERRIDE) {
    return baseValue;
  }
  if (lockedTiers) {
    for (const tier of lockedTiers) {
      baseValue += LOCKED_REROLL_TIER_VALUES[tier ?? 0];
    }
  } else {
    baseValue = UNLOCKED_REROLL_BASE_VALUE;
  }

  const baseMultiplier = Math.min(
    Math.ceil(globalScene.currentBattle.waveIndex / 10) * baseValue * 2 ** rerollCount * multiplier,
    Number.MAX_SAFE_INTEGER,
  );

  // Apply Black Sludge to reroll cost
  const modifiedRerollCost = new NumberHolder(baseMultiplier);
  globalScene.applyModifier(HealShopCostModifier, true, modifiedRerollCost);
  return modifiedRerollCost.value;
}
