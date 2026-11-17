/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/**
 * Utility functions relating to damage calculations.
 * @module
 */

import { toDmgValue } from "#utils/common";

/**
 * Local fork (2026-11-13): 10 명세 2번, the rules of the boss-bar overflow in {@linkcode calculateBossSegmentDamage}
 * ("보스 체력바 초과 대미지 로그 밑수 `2.0 → 2.4` 변경"), in every game mode.
 *
 * One hit that gets through the current bar with `leftover` damage to spare breaks
 * `1 + floor(log_logBase(leftover / segmentHp))` bars (clamped as before), so breaking k bars at once needs
 * `segmentHp * logBase^(k-1)` of leftover: with 2.4 that is 2.4 / 5.76 / 13.82 / 33.18 / 79.63 / 191.1 bars' worth
 * for k = 2..7, where upstream's base 2 needed 2 / 4 / 8 / 16 / 32 / 64. The aim is the 5850 ace of 27 bars losing about
 * 70% of them on a turn of neutral hits instead of all of them.
 *
 * The spec writes the rule with the whole hit (`1 + floor(log_2.4(대미지 / S))`); only the base changed here (its 2-3:
 * "`Math.log2(...)`를 ... `Math.log(ratio) / Math.log(BOSS_SEGMENT_OVERFLOW_LOG_BASE)`로 교체"), so the engine still
 * measures upstream's leftover past the current bar. On a full bar every threshold of the spec's table therefore needs
 * one bar's worth more of the whole hit: 2 bars from 3.4 S, 5 bars from 34.18 S (the table: 33.18), 6 from 80.63 S.
 *
 * Mutable on purpose: the battle sim (test/tests/custom/sim) sets `logBase` back to 2 for an ablation run. The game
 * itself never changes it, and whoever changes it must put it back afterwards (vitest runs with `isolate: false`, so
 * the module is shared between test files).
 */
export const BOSS_SEGMENT_OVERFLOW: { logBase: number } = {
  /** The log base of the overflow rule; upstream's rule was base 2 (`Math.log2`) */
  logBase: 2.4,
};

/**
 * Slack added to the bars-bypassed logarithm before it is floored, so a leftover of exactly `segmentHp * logBase^n`
 * (2.4^n, or 2^n with the ablation's base) still bypasses n bars despite floating point; far below 1 HP of difference
 */
const BOSS_SEGMENT_OVERFLOW_EPSILON = 1e-9;

/**
 * Calculate the adjusted damage and number of boss segments bypassed for a damage interaction
 * @param damage - The raw damage dealt.
 * @param currentHp - The target's current HP
 * @param segmentHp - The HP in each segment (total HP / number of segments)
 * @param minSegmentIndex - The minimum segment index that can be cleared; default `0` (all segments). Used for the final boss
 * @param currentSegmentIndex - The current segment index of the target; if not provided, it will be calculated from `currentHp` and `segmentHp`.
 * @returns A tuple consisting of the adjusted damage and index of the boss segment the target is in after damage is applied.
 */
export function calculateBossSegmentDamage(
  damage: number,
  currentHp: number,
  segmentHp: number,
  minSegmentIndex = 0,
  currentSegmentIndex?: number,
): [adjustedDamage: number, clearedBossSegmentIndex: number] {
  const segmentIndex = currentSegmentIndex ?? Math.ceil(currentHp / segmentHp) - 1;
  if (segmentIndex <= 0) {
    return [damage, 1];
  }

  /**
   * The HP that the current segment ends at.
   *
   * @example
   * If a Pokemon has 3 segments and 300 max HP, each segment is 100 HP.
   * In the first iteration, this would be 200 HP, as the first segment ends at 200 HP.
   */
  const segmentThreshold = segmentHp * segmentIndex;
  const roundedSegmentThreshold = Math.round(segmentThreshold);

  const remainingSegmentHp = currentHp - roundedSegmentThreshold;

  const leftoverDamage = damage - remainingSegmentHp;

  // Insufficient damage to get down to current segment HP, return original damage
  // Segment index + 1 because this segment is not considered cleared
  if (leftoverDamage < 0) {
    return [damage, segmentIndex + 1];
  }
  if (leftoverDamage === 0) {
    return [damage, segmentIndex];
  }

  // Breaking the nth segment requires dealing at least segmentHp * base^(n-1) leftover damage
  // and must ensure at least `segmentIndex - minSegmentIndex` segments remain.
  // Local fork (2026-11-13): 10 명세 2번, base = BOSS_SEGMENT_OVERFLOW.logBase (2.4) instead of upstream's Math.log2
  const overflowLog = Math.log(leftoverDamage / segmentHp) / Math.log(BOSS_SEGMENT_OVERFLOW.logBase);
  const segmentsBypassed = Math.min(
    Math.max(Math.floor(overflowLog + BOSS_SEGMENT_OVERFLOW_EPSILON), 0),
    segmentIndex - minSegmentIndex,
  );
  const adjustedDamage = toDmgValue(currentHp - segmentThreshold + segmentHp * segmentsBypassed);
  const clearedBossSegmentIndex = segmentIndex - segmentsBypassed;

  return [adjustedDamage, clearedBossSegmentIndex];
}
