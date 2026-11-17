import { VALUE_REDUCTION_MAX } from "#app/constants";
import type { IntClosedRange } from "type-fest";

export const POKERUS_STARTER_COUNT = 5;

// #region Friendship constants

/** The multiplier applied to candy friendship gain in classic mode. */
export const CLASSIC_CANDY_FRIENDSHIP_MULTIPLIER = 3;
/** The base amount of friendship gained from a single battle. */
export const FRIENDSHIP_GAIN_FROM_BATTLE = 3;
/** The base amount of friendship gained from using a Rare Candy. */
export const FRIENDSHIP_GAIN_FROM_RARE_CANDY = 6;
/** The amount of friendship lost upon fainting. */
export const FRIENDSHIP_LOSS_FROM_FAINT = 5;
/** The minimum friendship value for enemy trainers at wave 1. */
export const TRAINER_MIN_FRIENDSHIP = 50;
/** The wave at which enemy trainers reach the maximum friendship value of 255. */
export const TRAINER_MAX_FRIENDSHIP_WAVE = 145;

// #endregion Friendship constants

/** The numeric point cost of a starter. */
export type StarterCost = IntClosedRange<1, 10>;

/**
 * Function to get the cumulative friendship threshold at which a candy is earned
 * @param starterCost - The cost of the starter
 * @returns aforementioned threshold
 */
// TODO: maybe move to the species registry class
export function getStarterValueFriendshipCap(starterCost: StarterCost): number {
  switch (starterCost) {
    case 1:
      return 25;
    case 2:
      return 50;
    case 3:
      return 75;
    case 4:
      return 100;
    case 5:
      return 150;
    case 6:
      return 200;
    case 7:
      return 300;
    case 8:
    case 9:
      return 450;
    case 10:
    default: // fallback for invalid starter costs (should never happen, but just in case)
      return 600;
  }
}

interface StarterCandyCosts {
  /** The candy cost to unlock the starter's passive ability */
  readonly passive: number;
  /** The candy costs to reduce the starter's point cost */
  readonly costReduction: readonly [number, number];
  /** The costs to buy a same-species egg */
  readonly eggCost: number;
}

const allStarterCandyCosts: readonly StarterCandyCosts[] = [
  { passive: 40, costReduction: [25, 60], eggCost: 20 }, // 1 Cost
  { passive: 40, costReduction: [25, 60], eggCost: 20 }, // 2 Cost
  { passive: 35, costReduction: [20, 50], eggCost: 15 }, // 3 Cost
  { passive: 30, costReduction: [15, 40], eggCost: 12 }, // 4 Cost
  { passive: 25, costReduction: [12, 35], eggCost: 10 }, // 5 Cost
  { passive: 20, costReduction: [10, 30], eggCost: 8 }, // 6 Cost
  { passive: 15, costReduction: [8, 20], eggCost: 7 }, // 7 Cost
  { passive: 10, costReduction: [5, 15], eggCost: 6 }, // 8 Cost
  { passive: 10, costReduction: [5, 15], eggCost: 6 }, // 9 Cost
  { passive: 10, costReduction: [5, 15], eggCost: 5 }, // 10 Cost
];

/**
 * Getter for {@linkcode allStarterCandyCosts} for passive unlock candy cost based on initial point cost
 * @param starterCost - The default point cost of the starter
 * @returns the candy cost for passive unlock
 */
/**
 * Local fork (2026-11-17): the candy price of the Partner Mark for a starter (the user: "파트너의 증표 - 친밀도 사탕으로
 * 구매"): what its passive costs.
 * @param starterCost - The default point cost of the starter
 */
export function getPartnerMarkCandyCount(starterCost: number): number {
  return allStarterCandyCosts[starterCost - 1].passive;
}

/**
 * Local fork (2026-11-17): the candy price of the Best Friends Ribbon for a starter, the step after the Partner Mark
 * (the user: "절친리본은 친밀도 사탕의 다음 단계 구매로"): twice the Partner Mark's.
 * @param starterCost - The default point cost of the starter
 */
export function getBestFriendsRibbonCandyCount(starterCost: number): number {
  return getPartnerMarkCandyCount(starterCost) * 2;
}

export function getPassiveCandyCount(starterCost: number): number {
  return allStarterCandyCosts[starterCost - 1].passive;
}

/**
 * Getter for {@linkcode allStarterCandyCosts} for value reduction unlock candy cost based on initial point cost
 * @param starterCost - The default point cost of the starter
 * @returns respective candy cost for the two cost reductions as an array 2 numbers
 */
export function getValueReductionCandyCounts(starterCost: number): readonly number[] {
  // Local fork (2026-11-17): every starter can be brought down to 1 point (the user: "사탕으로 코스트를 감소시키는것의
  // 제한을 풀어보죠, 전부 1코스트까지 감소시킬 수 있도록. 사탕 요구 개수만 조절하고"). The first two reductions cost what
  // they always did, and each one after costs more by the same step as between those two (the user: "5 15 25 35
  // 식으로 선형적으로 증가하도록 하죠"). A 10-point starter: 5, 15, 25, 35, 45, 55, 65, 75, 85.
  const [first, second] = allStarterCandyCosts[starterCost - 1].costReduction;
  const counts = [first, second];
  for (let n = 2; n < getMaxValueReductions(starterCost); n++) {
    counts.push(counts[n - 1] + (second - first));
  }
  return counts;
}

/**
 * Local fork (2026-11-17): how many cost reductions a starter can buy with candy: enough to reach 1 point, and never
 * fewer than the base game's two (which take a 1 or 2 point starter below 1 point, as before).
 * @param starterCost - The default point cost of the starter
 */
export function getMaxValueReductions(starterCost: number): number {
  return Math.max(VALUE_REDUCTION_MAX, starterCost - 1);
}

/**
 * Getter for {@linkcode allStarterCandyCosts} for egg purchase candy cost based on initial point cost
 * @param starterCost - The default point cost of the starter
 * @returns the candy cost for the purchasable egg
 */
export function getSameSpeciesEggCandyCounts(starterCost: number): number {
  return allStarterCandyCosts[starterCost - 1].eggCost;
}
