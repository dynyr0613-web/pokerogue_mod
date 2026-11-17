/**
 * Local fork (2026-11-12): trainer Pokémon hold more of the ordinary held items, and more of them are battle items
 * (the user, after reading docs/트레이너_배틀도구_합체_강화_계획.md: "끈기갈고리손톱 제외하고, 커스텀 아이템도 제외하고 도구
 * 확률과 개수를 올려보죠", "뺏을 도구가 많은건 대부분 타입 강화 효과 도구만 유효하니까, 타입 강화 효과 도구보단 다른 아이템을
 * 가질 확률을 올려보고").
 *
 * - Who: the Pokémon of a TRAINER battle, in every mode. Wild battles and mystery-encounter battles (their battle type
 *   is MYSTERY_ENCOUNTER and they roll from the wild pool) keep upstream's numbers.
 * - How many (`BattleScene.generateEnemyModifiers`): each of the ceil(difficulty wave / 10) tries succeeds at
 *   1 / {@linkcode getEnemyTrainerItemChance} instead of `GameMode.getEnemyModifierChance`; the trainer's tier comes
 *   from `getTrainerBattleFormTier` (보통 / 엘리트 / 보스), and a Pokémon with a boss bar counts as boss. A boss still
 *   gets at least floor(tries / 2).
 * - Which tier (`getNewModifierTypeOption` in modifier-type.ts, the TRAINER pool only): the roll out of 1024 is read
 *   with {@linkcode getEnemyTrainerTierCounts} instead of the base 768/195/48/12/1, so 로그 and 마스터 (기합의머리띠,
 *   선제공격손톱, 광각렌즈, 왕의징표석, 먹다남은음식, 조개껍질방울, 초점렌즈) come far more often than before while 하이퍼 (only
 *   the type boosters) grows less.
 * - The trainer pool (init-modifier-pools.ts `initTrainerModifierPool`) gives no 끈기갈고리손톱 (Grip Claw) and no
 *   행복의알 (Lucky Egg, useless on an enemy).
 * - Not touched: the fork's own enemy items (enemy-custom-items.ts), the wild pool, the player's pool, the enemy caps.
 * - Local fork (2026-11-12): fusions (the plan's (C); the user, approving the plan: "합체 포켓몬도 추천안대로 넣어두고"): an
 *   Endless trainer's Pokémon that the fusion token did not fuse rolls once more, at its trainer tier's chance
 *   ({@linkcode ENEMY_TRAINER_BUFFS}.fusion); the rule and its exclusions are in enemy-trainer-fusion.ts.
 *
 * Every tunable number is in {@linkcode ENEMY_TRAINER_BUFFS}; tests force the fusion roll through
 * {@linkcode enemyTrainerBuffDice}.
 */

import type { TierCounts } from "#balance/endless-balance";
import type { BattleFormChanceCurve, TrainerBattleFormTier } from "#data/enemy-battle-forms";
import { randSeedInt } from "#utils/common";

/** Local fork (2026-11-12): every number of the trainer item buff (see the file comment) */
export const ENEMY_TRAINER_BUFFS = Object.freeze({
  items: Object.freeze({
    /**
     * Each item try succeeds at 1 / this, per trainer tier. Before: Classic / Challenge / Daily 18 (boss 6), Endless
     * 12 (boss 4), the same as wild Pokémon (`GameMode.getEnemyModifierChance`).
     */
    chanceDenominator: Object.freeze({
      classic: Object.freeze({ ordinary: 12, elite: 9, boss: 6 }),
      endless: Object.freeze({ ordinary: 9, elite: 6, boss: 4 }),
    }),
    /**
     * Tier counts out of 1024 for the TRAINER pool, 일반/슈퍼/하이퍼/로그/마스터 (before: 768/195/48/12/1). Classic and the
     * other modes use `classic`; Endless uses it up to `endlessFromWave`, then moves in a straight line to `endlessTop` at
     * `endlessToWave` and stays there.
     */
    tierCounts: Object.freeze({
      classic: Object.freeze([720, 176, 72, 48, 8] as const),
      endlessTop: Object.freeze([600, 160, 96, 136, 32] as const),
      endlessFromWave: 100,
      endlessToWave: 1000,
    }),
    /** Weights in the trainer pool's 로그 tier (before: Grip Claw 1, Lucky Egg 4) */
    trainerPoolWeights: Object.freeze({
      GRIP_CLAW: 0,
      LUCKY_EGG: 0,
    }),
  }),
  /**
   * Local fork (2026-11-12): the extra fusion roll of an Endless trainer's Pokémon (enemy-trainer-fusion.ts; the user,
   * approving the plan: "합체 포켓몬도 추천안대로 넣어두고"), per trainer tier (`getTrainerBattleFormTier`): the percent
   * chance per Pokémon on a difficulty wave, the curve of `getBattleFormChanceAt` (`chance` at `minWave`, plus `step`
   * every `everyWaves` waves, at most `max`; 0 before `minWave`). Rolled only when the fusion token did not fuse it, so a
   * Pokémon fuses at 1 - (1 - this)(1 - token).
   * - `ordinary`: 3% at wave 100, 9% at 300, 18% at 600, 30% from 1000;
   * - `elite` (엘리트 트레이너 / 엘리트 콤비): 5% at 100, 13% at 300, 25% at 600, 40% from 1000;
   * - `boss` (gym leaders, named trainers, evil-team bosses...): 2% at 100, 6% at 300, 12% at 600, 20% from 1000.
   */
  fusion: Object.freeze({
    ordinary: Object.freeze({ minWave: 100, chance: 3, everyWaves: 100, step: 3, max: 30 }),
    elite: Object.freeze({ minWave: 100, chance: 5, everyWaves: 100, step: 4, max: 40 }),
    boss: Object.freeze({ minWave: 100, chance: 2, everyWaves: 100, step: 2, max: 20 }),
  } satisfies Record<TrainerBattleFormTier, BattleFormChanceCurve>),
});

/**
 * Local fork (2026-11-12): the seeded roller of the trainer buffs' rolls (`roll(range)` returns an integer in
 * [0, range)); today only the extra fusion roll of an Endless trainer's Pokémon (enemy-trainer-fusion.ts) uses it. A
 * test hook: tests stub `roll` with `vi.spyOn(enemyTrainerBuffDice, "roll")` to force an outcome; game code never
 * replaces it. Kept apart from {@linkcode ENEMY_TRAINER_BUFFS}, which stays frozen.
 */
export const enemyTrainerBuffDice = {
  roll: (range: number): number => randSeedInt(range),
};

/**
 * Local fork (2026-11-12): the denominator of one item try for a trainer's Pokémon (success = 1 / this)
 * @param tier - The trainer's tier (`getTrainerBattleFormTier`), `boss` for a Pokémon with a boss bar
 * @param isEndless - Whether the run is Endless or Spliced Endless
 */
export function getEnemyTrainerItemChance(tier: TrainerBattleFormTier, isEndless: boolean): number {
  const table = ENEMY_TRAINER_BUFFS.items.chanceDenominator;
  return (isEndless ? table.endless : table.classic)[tier];
}

/**
 * Local fork (2026-11-12): the tier counts (out of 1024, 일반..마스터) of the TRAINER pool at `wave`. Endless moves from
 * `classic` to `endlessTop` between `endlessFromWave` and `endlessToWave`; the running totals from 마스터 upward are
 * rounded, as `getEndlessTierCounts` does, so the counts always add up to 1024 and the rarer tiers only grow.
 * @param wave - The current wave
 * @param isEndless - Whether the run is Endless or Spliced Endless
 */
export function getEnemyTrainerTierCounts(wave: number, isEndless: boolean): TierCounts {
  const { classic, endlessTop, endlessFromWave, endlessToWave } = ENEMY_TRAINER_BUFFS.items.tierCounts;
  if (!isEndless || wave <= endlessFromWave) {
    return classic;
  }
  const t = Math.min(1, (wave - endlessFromWave) / (endlessToWave - endlessFromWave));
  const [, great, ultra, rogue, master] = classic.map((c, k) => c + (endlessTop[k] - c) * t);
  const m = Math.round(master);
  const r = Math.round(master + rogue);
  const u = Math.round(master + rogue + ultra);
  const g = Math.round(master + rogue + ultra + great);
  return [1024 - g, g - u, u - r, r - m, m];
}
