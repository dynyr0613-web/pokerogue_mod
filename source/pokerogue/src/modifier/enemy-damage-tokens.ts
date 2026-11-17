/**
 * Local fork (2026-11-12): the enemy's 대미지 토큰 (Damage Token, `ENEMY_DAMAGE_BOOSTER`) and 보호 토큰 (Protection Token,
 * `ENEMY_DAMAGE_REDUCTION`) in the damage path, and the player's counter to the Protection Tokens, 관통 토큰 (Piercing
 * Token, `PIERCING_TOKEN`). The user: "적의 데미지 증가 / 데미지 감소 / 토큰에 저항할만한 파티 아이템의 구현이네요.
 * 개인적으로 생각해둔건 토큰이 곱연산으로 데미지 감소량 계산 -> 곱연산으로 계산된 수치에 합연산으로 빼는(즉 토큰이 999개여서
 * 받는 데미지 감소가 99.92%정도 되는 경우, 이 아이템이 3개 있어서 3%데미지는 보장된다던가) 파티 아이템인데요", and for the
 * Damage Token: "데미지 토큰은 그냥 저런거 없이 합연산시키면 편합니다". Later the same day the user cut both: "일격 토큰의 데미지
 * 증가량을 3.5%정도까지만 너프해둡시다" (the Damage Token, 5% -> 3.5% per token) and "관통 토큰도 조금 너프해보죠, 개당 0.25%에
 * 최대 10개정도로" (1 -> 0.25 percentage point per Piercing Token, still up to 10).
 *
 * - 대미지 토큰: additive, damage x (1 + 0.035 x stacks) (`EnemyDamageBoosterModifier`, modifier.ts); before, x1.05^stacks
 *   (99 tokens: x4.465, was x125; 999: x35.965). Worked out in whole numbers ({@linkcode getEnemyDamageBoostedValue}).
 *   No counter item.
 * - 보호 토큰: unchanged, damage x 0.975^n (n = the enemy side's stacks, `EnemyDamageReducerModifier`).
 * - 관통 토큰 (`PiercingTokenModifier`, modifier.ts): a party item, up to {@linkcode ENEMY_DAMAGE_TOKEN_RULES}
 *   .piercingMaxStack. When one of the player's Pokémon damages an enemy, the Protection Tokens' multiplier becomes
 *   min(1, 0.975^n + 0.0025 x m), m = the party's Piercing Tokens ({@linkcode getPiercedReductionMultiplier}): with n = 999
 *   and m = 10, at least 2.5% gets through; it never goes past the token-free damage, does nothing while the enemy has no
 *   Protection Token, and nothing for an enemy hitting an enemy (confusion, its ally).
 * - Reward: ROGUE tier of the player's pool, weight {@linkcode ENEMY_DAMAGE_TOKEN_RULES}.piercingWeight while the enemy
 *   side holds at least one Protection Token and the party has fewer than the max ({@linkcode getPiercingTokenWeight});
 *   gated by the first Classic clear (fork-unlock.ts). Enemies never get it, and it cannot be stolen or moved (a party
 *   item, not a held item).
 * - Hook: {@linkcode applyEnemyDamageTokens} replaces the two token calls in `Pokemon.getAttackDamage` (pokemon.ts,
 *   "Apply the enemy's Damage and Resistance tokens").
 * - 방호 토큰 (Guard Token, `GUARD_TOKEN`, `GuardTokenModifier` in modifier.ts; Local fork 2026-11-13, 09 명세 4번): the
 *   player's party item against the Damage Tokens. The spec: "1개당 아군이 받는 피해 0.5%씩 곱연산 감소 (× 0.995^n)",
 *   "최대 개수 도달 시: 최종 받는 피해가 원래의 70% ~ 75% 수준". When an enemy's attack damages one of the player's
 *   Pokémon, the damage is multiplied by 0.995^m, m = the party's Guard Tokens up to {@linkcode GUARD_TOKEN_RULES}
 *   .maxStacks (65: x0.72194), in the Damage Tokens' step, one floor over both ({@linkcode getGuardedDamageValue}).
 *   GREAT tier, weight {@linkcode GUARD_TOKEN_RULES}.poolWeight only in Endless while the enemy side holds a Damage
 *   Token and the party has fewer than the max ({@linkcode getGuardTokenWeight}); gated by the first Classic clear;
 *   never an enemy's, and a party item, so nothing can steal or move it.
 *
 * Runtime imports stay leaf-level (no modifier.ts / custom-held-items.ts values): modifier.ts reads
 * {@linkcode ENEMY_DAMAGE_TOKEN_RULES} from here, and the modifiers are found with `Modifier.is`.
 */

import { globalScene } from "#app/global-scene";
import type { Pokemon } from "#field/pokemon";
import type { ModifierInstanceMap } from "#types/modifier-types";
import { type NumberHolder, toDmgValue } from "#utils/common";

/**
 * Local fork (2026-11-12): every number of the enemy damage tokens and the Piercing Token, in one place.
 * - `boosterPerStack`: 대미지 토큰, each one adds this much of the damage (additive: x(1 + 0.035 x stacks));
 * - `piercingPerStack`: 관통 토큰, each one gives back this much (0.25 percentage point) of the damage the Protection Tokens
 *   took away, up to the token-free damage;
 * - `piercingMaxStack`: how many Piercing Tokens the party can have;
 * - `piercingWeight`: its weight in the player's ROGUE pool while it would do something ({@linkcode getPiercingTokenWeight}).
 */
export const ENEMY_DAMAGE_TOKEN_RULES = Object.freeze({
  boosterPerStack: 0.035,
  piercingPerStack: 0.0025,
  piercingMaxStack: 10,
  piercingWeight: 3,
});

/**
 * Local fork (2026-11-12): the Damage Tokens' multiplier for `stacks` of them, additive (the user: "데미지 토큰은 그냥
 * 저런거 없이 합연산시키면 편합니다", then 3.5% per token): 1 + 0.035 x stacks (1: x1.035, 99: x4.465, 999: x35.965)
 */
export function getEnemyDamageBoosterMultiplier(stacks: number): number {
  return 1 + ENEMY_DAMAGE_TOKEN_RULES.boosterPerStack * Math.max(0, stacks);
}

/** Local fork (2026-11-12): basis points (1/10000) for the Damage Tokens' whole-number math */
const BOOSTER_BASIS_POINTS = 10_000;

/**
 * Local fork (2026-11-12): `damage` after `stacks` Damage Tokens, additive, worked out in whole basis points:
 * toDmgValue(damage x (10000 + 350 x stacks) / 10000). The plain float multiplier floors some exact results 1 short
 * (at 5% per token, 100 x 1.15 was 114.99999999999999, so 3 tokens on 100 damage gave 114, not 115); the same fix as the IV candy (90 x 1.3
 * came out as 116.999..., docs/엔드리스_보상_제안.md) and the Expert Belt's tenths.
 * @param damage - The damage before the tokens
 * @param stacks - The enemy side's Damage Tokens
 * @returns The boosted damage, floored and at least 1 (toDmgValue)
 */
export function getEnemyDamageBoostedValue(damage: number, stacks: number): number {
  const perStack = Math.round(ENEMY_DAMAGE_TOKEN_RULES.boosterPerStack * BOOSTER_BASIS_POINTS);
  return toDmgValue((damage * (BOOSTER_BASIS_POINTS + perStack * Math.max(0, stacks))) / BOOSTER_BASIS_POINTS);
}

/**
 * Local fork (2026-11-12): the Protection Tokens' multiplier once `piercingStacks` Piercing Tokens give some back:
 * min(1, `reduction` + 0.0025 x m), m = `piercingStacks` capped at the max; `reduction` unchanged when m is 0.
 * @param reduction - The Protection Tokens' own multiplier (0.975^n)
 * @param piercingStacks - The party's Piercing Tokens
 */
export function getPiercedReductionMultiplier(reduction: number, piercingStacks: number): number {
  const { piercingPerStack, piercingMaxStack } = ENEMY_DAMAGE_TOKEN_RULES;
  const stacks = Math.min(Math.max(0, piercingStacks), piercingMaxStack);
  if (stacks <= 0) {
    return reduction;
  }
  return Math.min(1, reduction + piercingPerStack * stacks);
}

/** Local fork (2026-11-12): the Piercing Token stack on the player's side (0 without one) */
export function getPlayerPiercingTokenStacks(): number {
  return globalScene.findModifier(m => m.is("PiercingTokenModifier"), true)?.getStackCount() ?? 0;
}

/** Local fork (2026-11-12): whether the enemy side holds at least one Protection Token (보호 토큰) */
export function enemyHoldsProtectionToken(): boolean {
  return globalScene.findModifier(m => m.is("EnemyDamageReducerModifier"), false) !== undefined;
}

/**
 * Local fork (2026-11-12): the Piercing Token's weight in the player's ROGUE pool: {@linkcode ENEMY_DAMAGE_TOKEN_RULES}
 * .piercingWeight while the enemy side holds a Protection Token and the party has fewer than the max, else 0
 */
export function getPiercingTokenWeight(): number {
  const { piercingMaxStack, piercingWeight } = ENEMY_DAMAGE_TOKEN_RULES;
  if (!enemyHoldsProtectionToken() || getPlayerPiercingTokenStacks() >= piercingMaxStack) {
    return 0;
  }
  return piercingWeight;
}

/**
 * Local fork (2026-11-13): 방호 토큰 (Guard Token)'s numbers, 09 명세 4번 (its recommended B: "GUARD_TOKEN_MAX_STACKS =
 * 65(피격 72.2%)"):
 * - `perStackMultiplier`: each one multiplies the damage an enemy's attack deals to the player's Pokémon by this
 *   (multiplicative, "1개당 아군이 받는 피해 0.5%씩 곱연산 감소");
 * - `maxStacks`: how many the party can have (0.995^65 = 0.72194: 72.2% of the damage, "70~75% 구간 정중앙"; the spec writes 0.72196);
 * - `poolWeight`: its weight in the player's GREAT pool while it would do something ({@linkcode getGuardTokenWeight}).
 */
export const GUARD_TOKEN_RULES = Object.freeze({
  perStackMultiplier: 0.995,
  maxStacks: 65,
  poolWeight: 4,
});

/**
 * Local fork (2026-11-13): the Guard Tokens' damage multiplier for `stacks` of them: 0.995^m, m = `stacks` clamped to
 * 0..65 (1: x0.995, 10: x0.95111, 65: x0.72194; more than 65 counts as 65), exactly 1 without one
 */
export function getGuardTokenMultiplier(stacks: number): number {
  const clamped = Math.min(Math.max(0, stacks), GUARD_TOKEN_RULES.maxStacks);
  if (clamped <= 0) {
    return 1;
  }
  return Math.pow(GUARD_TOKEN_RULES.perStackMultiplier, clamped);
}

/**
 * Local fork (2026-11-13): an enemy's hit on the player's Pokémon after the enemy's Damage Tokens and the party's Guard
 * Tokens, one floor over both: toDmgValue(damage x (10000 + 350 x s) / 10000 x 0.995^m), the Damage Tokens' whole
 * basis points first (as {@linkcode getEnemyDamageBoostedValue}), then the Guard Tokens (m capped at 65). Flooring once loses at most 1 where flooring after each could lose 2. Checked against exact integer
 * math (BigInt, 199^m / 200^m) for every damage 1-20000, s in {0, 1, 3, 10, 99, 999} and m 1-65, and 2 million damages
 * from 1,000,000 up: no difference (the test keeps a smaller sweep).
 * @param damage - The damage before either token
 * @param boosterStacks - The stacks of each Damage Token modifier that applies (one in practice; none is fine)
 * @param guardStacks - The party's Guard Tokens
 * @returns The damage, floored and at least 1 (toDmgValue)
 */
export function getGuardedDamageValue(damage: number, boosterStacks: readonly number[], guardStacks: number): number {
  const perStack = Math.round(ENEMY_DAMAGE_TOKEN_RULES.boosterPerStack * BOOSTER_BASIS_POINTS);
  let value = damage;
  for (const stacks of boosterStacks) {
    value = (value * (BOOSTER_BASIS_POINTS + perStack * Math.max(0, stacks))) / BOOSTER_BASIS_POINTS;
  }
  return toDmgValue(value * getGuardTokenMultiplier(guardStacks));
}

/** Local fork (2026-11-13): the Guard Token stack on the player's side (0 without one) */
export function getPlayerGuardTokenStacks(): number {
  return globalScene.findModifier(m => m.is("GuardTokenModifier"), true)?.getStackCount() ?? 0;
}

/** Local fork (2026-11-13): whether the enemy side holds at least one Damage Token (대미지 토큰) */
export function enemyHoldsDamageToken(): boolean {
  return globalScene.findModifier(m => m.is("EnemyDamageBoosterModifier"), false) !== undefined;
}

/**
 * Local fork (2026-11-13): the Guard Token's weight in the player's GREAT pool, 09 명세 4번 ("적에게 대미지 토큰이 1개
 * 이상 있고 아군의 방호 토큰이 최대 개수 미만일 때 (클래식·챌린지·데일리에서는 가중치 0)"): {@linkcode GUARD_TOKEN_RULES}
 * .poolWeight in Endless (and Spliced Endless) while the enemy side holds a Damage Token and the party has fewer than
 * the max, else 0
 */
export function getGuardTokenWeight(): number {
  const { maxStacks, poolWeight } = GUARD_TOKEN_RULES;
  if (!globalScene.gameMode.isEndless || !enemyHoldsDamageToken() || getPlayerGuardTokenStacks() >= maxStacks) {
    return 0;
  }
  return poolWeight;
}

/** Local fork (2026-11-12): the enemy side's token modifiers of `className`, as `globalScene.applyModifiers` finds them */
function enemyTokens<T extends "EnemyDamageBoosterModifier" | "EnemyDamageReducerModifier">(
  className: T,
  damage: NumberHolder,
): ModifierInstanceMap[T][] {
  return globalScene
    .findModifiers(m => m.is(className), false)
    .filter(m => m.shouldApply(damage)) as ModifierInstanceMap[T][];
}

/**
 * Local fork (2026-11-13): the Damage Tokens' step of an enemy's hit: each Damage Token modifier on its own, as before,
 * while `guardStacks` is 0; with Guard Tokens, the Damage Tokens and the Guard Tokens in one floor
 * ({@linkcode getGuardedDamageValue})
 * @param guardStacks - The party's Guard Tokens when the target is the player's, else 0
 * @param damage - The damage so far, changed in place
 */
function applyDamageAndGuardTokens(guardStacks: number, damage: NumberHolder): void {
  const boosters = enemyTokens("EnemyDamageBoosterModifier", damage);
  if (guardStacks <= 0) {
    for (const booster of boosters) {
      booster.apply(damage);
    }
    return;
  }
  damage.value = getGuardedDamageValue(
    damage.value,
    boosters.map(b => b.getStackCount()),
    guardStacks,
  );
}

/**
 * Local fork (2026-11-12): applies the enemy's Damage and Protection Tokens to the damage `source` deals to `target`,
 * in place of the two calls `Pokemon.getAttackDamage` made before ("Apply the enemy's Damage and Resistance tokens"):
 * - the Damage Tokens when `source` is not the player's (additive since 2026-11-12, in the modifier itself);
 * - the Protection Tokens when `target` is not the player's, as before, except that when `source` IS the player's, the
 *   party's Piercing Tokens raise their multiplier ({@linkcode getPiercedReductionMultiplier}); when that reaches 1 the
 *   damage is left exactly as it would be without the tokens. An enemy hitting an enemy gets no piercing.
 * - Local fork (2026-11-13): when `source` is not the player's and `target` is, the party's Guard Tokens (방호 토큰)
 *   join the Damage Tokens' step: toDmgValue(damage x Damage Tokens x 0.995^m), one floor over both
 *   ({@linkcode getGuardedDamageValue}). Without a Guard Token that step is exactly what it was. Only hits that go
 *   through `getAttackDamage` reach here, so confusion self-hits, recoil, weather, status and other indirect damage
 *   never get it; neither does the player's Pokémon hitting itself or its ally, nor anything hitting an enemy.
 * @param source - The attacker
 * @param target - The Pokémon taking the damage
 * @param damage - The damage so far, changed in place
 */
export function applyEnemyDamageTokens(source: Pokemon, target: Pokemon, damage: NumberHolder): void {
  if (!source.isPlayer()) {
    applyDamageAndGuardTokens(target.isPlayer() ? getPlayerGuardTokenStacks() : 0, damage);
  }
  if (target.isPlayer()) {
    return;
  }
  const piercing = source.isPlayer() ? getPlayerPiercingTokenStacks() : 0;
  for (const reducer of enemyTokens("EnemyDamageReducerModifier", damage)) {
    if (piercing <= 0) {
      reducer.apply(damage);
      continue;
    }
    const multiplier = getPiercedReductionMultiplier(reducer.getDamageMultiplier(), piercing);
    if (multiplier < 1) {
      damage.value = toDmgValue(damage.value * multiplier);
    }
  }
}
