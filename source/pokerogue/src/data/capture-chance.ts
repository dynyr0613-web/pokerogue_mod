/**
 * Local fork (2026-11-20): Q3, the capture chance in the ball menu. The user: "실행" (to "볼 고를 때 포획 확률 표시":
 * next to each ball, the chance to catch the foe now).
 *
 * The capture math of `AttemptCapturePhase` (modified catch rate → shake probability, critical capture) and the rules
 * of `CommandPhase` on when a ball may be thrown live here, so the throw and the number in the ball menu
 * (`BallUiHandler`) are one calculation and cannot drift apart:
 * - {@linkcode getCaptureOdds}: the numbers the throw rolls against, exactly as `AttemptCapturePhase.start` worked
 *   them out (it now calls this);
 * - {@linkcode getCaptureSuccessChance}: the chance (0 to 1) that the throw ends in a catch, following the throw's checks:
 *   a Master Ball always catches; a critical capture (a roll out of 256) needs one shake check and any other throw
 *   three; a modified catch rate of 255 or more passes the three on its own;
 * - {@linkcode getBallBlockKey}: why a ball cannot be thrown now, as the key of the message `CommandPhase` shows, or
 *   `null`: the field rules ({@linkcode getBallFieldBlockKey}: trainer battles, the END biome, Mystery Encounters that
 *   forbid it, the Endless raid that allows it), two foes at once, and a boss with bars left, where only the Master
 *   Ball works ({@linkcode getBossBallBlockKey}). `CommandPhase` calls the same functions, in the same order.
 *
 * Fork rules need nothing of their own: an alpha's HP boost, the Endless boss-bar correction, the raid's x3 and the enemy
 * Dynamax state's x1.5 are all in `getMaxHp()` / `hp`, which the formula reads, and the raid boss' bars block the balls
 * below the Master Ball as any boss' do.
 */

import { timedEventManager } from "#app/global-event-manager";
import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { getDailyEventSeedBoss } from "#data/daily-run";
import { isDailyFinalBoss } from "#data/daily-seed-utils";
import { isEndlessRaidWave } from "#data/endless-raid";
import { getCriticalCaptureChance, getPokeballCatchMultiplier } from "#data/pokeball";
import { getStatusEffectCatchRateMultiplier } from "#data/status-effect";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { PokeballType } from "#enums/pokeball";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";

/** The numbers a throw rolls against (`AttemptCapturePhase`) */
export interface CaptureOdds {
  /** The species' own catch rate */
  readonly catchRate: number;
  /** The ball's multiplier; -1 for the Master Ball */
  readonly pokeballMultiplier: number;
  readonly statusMultiplier: number;
  readonly shinyMultiplier: number;
  /** The catch rate after HP, ball, status and shiny bonus; 255 or more passes the shake checks */
  readonly modifiedCatchRate: number;
  /** A shake check passes when a roll out of 65536 is below this */
  readonly shakeProbability: number;
  /** A throw is a critical capture when a roll out of 256 is below this */
  readonly criticalCaptureChance: number;
}

/**
 * The numbers a ball of `pokeballType` thrown at `pokemon` now rolls against: the calculation `AttemptCapturePhase.start`
 * had inline (moved here unchanged)
 */
export function getCaptureOdds(pokemon: Pokemon, pokeballType: PokeballType): CaptureOdds {
  const _3m = 3 * pokemon.getMaxHp();
  const _2h = 2 * pokemon.hp;
  const catchRate = pokemon.species.catchRate;
  const pokeballMultiplier = getPokeballCatchMultiplier(pokeballType);
  const statusMultiplier = pokemon.status ? getStatusEffectCatchRateMultiplier(pokemon.status.effect) : 1;
  const shinyMultiplier = pokemon.isShiny() ? timedEventManager.getShinyCatchMultiplier() : 1;
  const modifiedCatchRate = Math.round(
    (((_3m - _2h) * catchRate * pokeballMultiplier) / _3m) * statusMultiplier * shinyMultiplier,
  );
  const shakeProbability = Math.round(65536 / Math.pow(255 / modifiedCatchRate, 0.1875)); // Formula taken from gen 6
  const criticalCaptureChance = getCriticalCaptureChance(modifiedCatchRate);
  return {
    catchRate,
    pokeballMultiplier,
    statusMultiplier,
    shinyMultiplier,
    modifiedCatchRate,
    shakeProbability,
    criticalCaptureChance,
  };
}

/** @returns The share of the `range` values a roll `randBattleSeedInt(range) < threshold` passes for (0 for `NaN`) */
function passShare(threshold: number, range: number): number {
  return threshold > 0 ? Math.min(threshold, range) / range : 0;
}

/**
 * The chance (0 to 1) that a throw with `odds` catches, following `AttemptCapturePhase`'s checks: a Master Ball always;
 * otherwise a critical capture (`criticalCaptureChance` out of 256) is caught after its one shake check, and any other
 * throw after three, which a modified catch rate of 255 or more passes on its own
 */
export function getCaptureSuccessChance(odds: CaptureOdds): number {
  if (odds.pokeballMultiplier === -1) {
    return 1;
  }
  const critical = passShare(odds.criticalCaptureChance, 256);
  const shake = passShare(odds.shakeProbability, 65536);
  const plainShake = odds.modifiedCatchRate >= 255 ? 1 : shake;
  return critical * shake + (1 - critical) * plainShake ** 3;
}

/** The foes a ball would be thrown at: the active ones on the field, as `CommandPhase.handleBallCommand` picks them */
export function getBallTargets(): EnemyPokemon[] {
  return globalScene.getEnemyField().filter(p => p.isActive(true));
}

/**
 * The field rules on balls (moved unchanged from `CommandPhase.checkCanUseBall`): a ball may not be thrown in a trainer
 * battle, in a Mystery Encounter that forbids it, or in the END biome unless one of its exceptions holds; the Endless
 * raid's boss can always be caught
 * @returns The key of the message `CommandPhase` shows, or `null` when the field allows a ball
 */
export function getBallFieldBlockKey(): string | null {
  const { arena, currentBattle, gameData, gameMode } = globalScene;
  const { battleType } = currentBattle;
  const { biomeId } = arena;
  const { isClassic, isEndless, isDaily } = gameMode;
  const { dexData } = gameData;

  const isClassicFinalBoss = gameMode.isBattleClassicFinalBoss(currentBattle.waveIndex);
  const isEndlessMinorBoss = gameMode.isEndlessMinorBoss(currentBattle.waveIndex);
  const isFullFreshStart = gameMode.isFullFreshStartChallenge();
  const someUncaughtSpeciesOnField = globalScene
    .getEnemyField()
    .some(p => p.isActive() && !dexData[p.species.speciesId].caughtAttr);
  const missingMultipleStarters =
    gameData.getStarterCount(d => !!d.caughtAttr) < speciesDataRegistry.getAllStarters().length - 1;
  const isCatchableDailyBoss = isDailyFinalBoss() && (getDailyEventSeedBoss()?.catchable ?? false);

  // Local fork (2026-11-17): the raid's boss can always be caught, in the END biome too (endless-raid.ts)
  if (isEndlessRaidWave(gameMode, currentBattle.waveIndex) && battleType === BattleType.WILD) {
    return null;
  }
  if (biomeId === BiomeId.END && battleType === BattleType.WILD) {
    if (
      (isClassic && !isClassicFinalBoss && someUncaughtSpeciesOnField)
      || (isFullFreshStart && !isClassicFinalBoss)
      || (isEndless && !isEndlessMinorBoss)
    ) {
      // Uncatchable paradox mons in classic and endless
      return "battle:noPokeballForce";
    }
    if (
      (isClassic && isClassicFinalBoss && missingMultipleStarters)
      || (isFullFreshStart && isClassicFinalBoss)
      || (isEndless && isEndlessMinorBoss)
      || (isDaily && !isCatchableDailyBoss)
    ) {
      // Uncatchable final boss in classic, endless and daily
      return "battle:noPokeballForceFinalBoss";
    }
    return null;
  }
  if (battleType === BattleType.TRAINER) {
    return "battle:noPokeballTrainer";
  }
  if (currentBattle.isBattleMysteryEncounter() && !currentBattle.mysteryEncounter!.catchAllowed) {
    return "battle:noPokeballMysteryEncounter";
  }
  return null;
}

/**
 * The boss rule on balls (moved unchanged from `CommandPhase.handleBallCommand`): a boss with bars left (Wonder Guard
 * aside) takes only the Master Ball, and the Classic final boss not even that while a challenge is on
 * @returns The key of the message `CommandPhase` shows, or `null` when the ball may be thrown at the foe
 */
export function getBossBallBlockKey(pokeballType: PokeballType): string | null {
  const { currentBattle, gameMode } = globalScene;
  const isChallengeActive = gameMode.hasAnyChallenges();
  const isFinalBoss = gameMode.isBattleClassicFinalBoss(currentBattle.waveIndex);
  const isCatchableDailyBoss = isDailyFinalBoss() && (getDailyEventSeedBoss()?.catchable ?? false);

  const targetPokemon = globalScene.getEnemyPokemon(false);
  if (
    targetPokemon?.isBoss()
    && targetPokemon?.bossSegmentIndex >= 1 // TODO: Decouple this hardcoded exception for wonder guard and just check the target...
    && !targetPokemon?.hasAbility(AbilityId.WONDER_GUARD, false, true)
  ) {
    // When facing the final boss, it must be weakened unless a Master Ball is used AND no challenges are active.
    // The message is customized for the final boss.
    if (
      isFinalBoss
      && (pokeballType < PokeballType.MASTER_BALL || (pokeballType === PokeballType.MASTER_BALL && isChallengeActive))
    ) {
      return "battle:noPokeballForceFinalBossCatchable";
    }
    // When facing any other boss, Master Ball can always be used, and we use the standard message.
    if (isCatchableDailyBoss || pokeballType < PokeballType.MASTER_BALL) {
      return "battle:noPokeballStrong";
    }
  }
  return null;
}

/**
 * Why a ball of `pokeballType` cannot be thrown now: the checks of `CommandPhase.handleBallCommand` in its order (the
 * field, then two foes at once, then a boss with bars left)
 * @returns The key of the message `CommandPhase` shows, or `null` when the ball may be thrown
 */
export function getBallBlockKey(pokeballType: PokeballType): string | null {
  return (
    getBallFieldBlockKey()
    ?? (getBallTargets().length > 1 ? "battle:noPokeballMulti" : null)
    ?? getBossBallBlockKey(pokeballType)
  );
}

/**
 * The chance (0 to 1) that a ball of `pokeballType` thrown now catches the foe, or `null` when it cannot be thrown or
 * there is no single foe to throw it at (the ball menu shows "—")
 */
export function getBallCaptureChance(pokeballType: PokeballType): number | null {
  const targets = getBallTargets();
  if (targets.length !== 1 || getBallBlockKey(pokeballType) !== null) {
    return null;
  }
  return getCaptureSuccessChance(getCaptureOdds(targets[0], pokeballType));
}

/**
 * The ball menu's text for `chance`: a whole percent, "100%" only for a sure catch and at least "1%" for any chance,
 * "—" for `null`
 */
export function formatCaptureChance(chance: number | null): string {
  if (chance === null) {
    return "—";
  }
  if (chance >= 1) {
    return "100%";
  }
  if (chance <= 0) {
    return "0%";
  }
  return `${Math.min(99, Math.max(1, Math.round(chance * 100)))}%`;
}
