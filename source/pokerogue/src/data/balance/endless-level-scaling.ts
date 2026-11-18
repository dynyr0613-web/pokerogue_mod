/**
 * Local fork (2026-11-13): 08 명세 4번, "사탕단지 99개 기준 5850웨이브 레벨 스케일링 (~320,000 Lv)".
 *
 * With 99 Candy Jars a player's ace reaches about 280,000 to 440,000 levels by wave 5850, against the old level cap
 * of 69,222. Past Endless wave 500 an extra term S(w) is ADDED to the final level of wild enemies
 * (`Battle.getLevelForWave`), of trainer party members (`Trainer.getPartyLevels`) and to the player's EXP level cap
 * (`BattleScene.getMaxExpLevel`). It is added after the existing multipliers (the boss x1.2, the trainer slot
 * multipliers), so it is the same number of levels for everyone on the wave. Mystery Encounters that take their levels
 * from those functions follow automatically.
 *
 * S(w) = ((w - 500) / A) ^ B for difficulty waves w > 500 in Endless and Spliced Endless, else 0.
 *
 * The spec's literal formula ((w - 500) / 15.2) ^ 2.15 gives +298,536 at wave 5850 (a total near 367,000), which
 * contradicts the spec's own stated targets (+1,850 at wave 1000, +251,000 at wave 5850, a total near 320,000). The
 * lead's decision: hit the stated targets. A and B are solved from the two anchors:
 *   S(1000) = 1,850 and S(5850) = 251,000
 *   B = ln(251,000 / 1,850) / ln((5850 - 500) / (1000 - 500)) = ln(135.6757) / ln(10.7) = 2.0716296869117299
 *   A = (1000 - 500) / 1,850 ^ (1 / B) = 13.239384902605481
 * Other waves: +440 at 750, +7,777 at 1500, +18,013 at 2000, +51,901 at 3000 (the spec's text says +49,500), +104,208
 * at 4000, +175,392 at 5000.
 *
 * Classic, Challenge and Daily never get the term (they are not Endless, and their difficulty waves never pass 500
 * either: Daily's is at most 50 + 30 + 10 = 90).
 *
 * Local fork (2026-11-13): from battle wave 4000 the enemies' levels also follow the player's strongest Pokémon (see
 * `ENDLESS_PLAYER_LEVEL_FOLLOW_START_WAVE` below).
 * Local fork (2026-11-18): from battle wave 1000 they follow it both ways (lower than the normal curve for a player
 * under about 1.064 x the expected level, higher above it: option 다), and the player's EXP level cap is lifted
 * ("1000웨이브 이후는 레벨캡은 그냥 풉시다"); S(w) still counts in C, the expected level
 * (`ENDLESS_EXP_LEVEL_CAP_LIFT_WAVE` below).
 */
import type { GameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";

/** The last difficulty wave without the extra term: "500웨이브 이후에만 사탕단지 가속을 반영한 추가 항" */
export const ENDLESS_LEVEL_SCALING_START_WAVE = 500;

/** First anchor of S(w): "w = 1000 -> +1,850" */
export const ENDLESS_LEVEL_SCALING_ANCHOR_LOW = { wave: 1000, levels: 1850 } as const;

/** Second anchor of S(w): "w = 5850 -> +251,000 (기존 ~69,000 Lv와 합쳐 최종 약 320,000 Lv)" */
export const ENDLESS_LEVEL_SCALING_ANCHOR_HIGH = { wave: 5850, levels: 251_000 } as const;

/**
 * The exponent B of S(w), from the two anchors: ln(251,000 / 1,850) / ln(5350 / 500) = 2.0716296869117299
 * (the spec's literal formula used 2.15)
 */
export const ENDLESS_LEVEL_SCALING_EXPONENT =
  Math.log(ENDLESS_LEVEL_SCALING_ANCHOR_HIGH.levels / ENDLESS_LEVEL_SCALING_ANCHOR_LOW.levels)
  / Math.log(
    (ENDLESS_LEVEL_SCALING_ANCHOR_HIGH.wave - ENDLESS_LEVEL_SCALING_START_WAVE)
      / (ENDLESS_LEVEL_SCALING_ANCHOR_LOW.wave - ENDLESS_LEVEL_SCALING_START_WAVE),
  );

/**
 * The wave divisor A of S(w), from the first anchor and B: 500 / 1,850 ^ (1 / B) = 13.239384902605481
 * (the spec's literal formula used 15.2)
 */
export const ENDLESS_LEVEL_SCALING_DIVISOR =
  (ENDLESS_LEVEL_SCALING_ANCHOR_LOW.wave - ENDLESS_LEVEL_SCALING_START_WAVE)
  / Math.pow(ENDLESS_LEVEL_SCALING_ANCHOR_LOW.levels, 1 / ENDLESS_LEVEL_SCALING_EXPONENT);

/**
 * Local fork (2026-11-13): 08 명세 4번, the extra levels S(w) added to every enemy level and to the player's EXP level
 * cap (from Endless wave 1000 only the expected level C, the cap being lifted) on a difficulty wave, rounded to a whole level (rounded, not floored, so the anchors come out exactly).
 * @param gameMode - The current game mode; anything but Endless / Spliced Endless gets 0
 * @param difficultyWave - The wave for difficulty (`gameMode.getWaveForDifficulty`, the wave itself in Endless)
 * @returns The extra levels, 0 up to wave 500
 */
export function getEndlessLevelBonus(gameMode: GameMode, difficultyWave: number): number {
  if (!gameMode.isEndless || !(difficultyWave > ENDLESS_LEVEL_SCALING_START_WAVE)) {
    return 0;
  }
  return Math.round(
    Math.pow(
      (difficultyWave - ENDLESS_LEVEL_SCALING_START_WAVE) / ENDLESS_LEVEL_SCALING_DIVISOR,
      ENDLESS_LEVEL_SCALING_EXPONENT,
    ),
  );
}

/*
 * Local fork (2026-11-13): enemy levels follow the player from battle wave 4000. The user: "4000웨이브 정도부턴 레벨
 * 스케일링을 플레이어에게 맞춰보죠, 적의 에이스 포켓몬이 플레이어의 가장 높은 레벨의 포켓몬의 레벨에 비례하도록".
 * Local fork (2026-11-13): 09 명세 1번 "4000웨이브+ 레벨 따라가기 지수 완충" damped it from f = max(1, P / C) to
 * f = max(1, P / C) ^ 0.5, because with both sides' levels times the same factor the damage / HP ratios froze ("대미지 ÷
 * HP 비율이 완전히 고정(NC = NE, EC = EI = EE)").
 *
 * Local fork (2026-11-18): the follow is two-sided, more responsive and starts at battle wave 1000. The user: "밸런스는
 * 레벨을 따라가는걸 조금더 플레이어 상대 유동적으로 바꿔보죠, 초보에게는 조금더 낮고, 고수에게는 좀더 높은 레벨의
 * 상대가 나오도록". From Endless / Spliced Endless battle wave 1000 on (`ENDLESS_PLAYER_LEVEL_FOLLOW_START_WAVE`), every
 * enemy level the normal formulas give (wild: `Battle.getLevelForWave`, S(w) included; trainers:
 * `Trainer.getPartyLevels`, S(w) included; the Mystery Encounter enemies that take their levels from those two) is
 * multiplied by f and rounded:
 *   f = max(0.8, 0.9637 x (P / C) ^ 0.6)     for every P > 0 (one formula, no separate branch under C),
 * where
 *   P = the highest level in the player's party (fainted members included) when the battle's levels are rolled; a party
 *       with no level at all (P = 0, never in a real battle) keeps f = 1,
 *   C = the expected level of that wave: the old EXP level cap formula (`getNaturalMaxExpLevel`, S(w) included). From
 *       wave 1000 that cap is no longer enforced (`ENDLESS_EXP_LEVEL_CAP_LIFT_WAVE`), but C stays the same number.
 *
 * Local fork (2026-11-18): this is option 다 of 11_레벨_따라가기_양방향.md 3-1, chosen 2026-11-18 because the novice
 * models are above C. The first 11-18 rule (f = (P / C) ^ 0.6 at or above C, max(0.8, (P / C) ^ 0.5) under it) left
 * f = 1 at P = C, but the docs' novice model (NE, P / C = 1.2, 09 명세) is above C, so it met foes 1.8% HIGHER than under
 * the 3차 rule (f = max(1, P / C) ^ 0.5), against "초보에게는 조금더 낮고". No power of P / C with f = 1 at C can lower
 * 1.2 and raise 1.628 (the expert model EE) at once, so option 다 moves the neutral point instead: 0.9637 = 1.447 ^ -0.1
 * (rounded to 4 places), so f meets the 3차 rule at the middle model EI (P / C = 1.447), is under it below that and over
 * it above. Against the 3차 rule at the models' own P / C: NC (P = C) 0.9637 (-3.6%), NE (1.2) 1.0751 (-1.9%), EI
 * (1.447) 1.2028 (0%), EE (1.628) 1.2910 (+1.2%).
 * f = 1 at P / C = 0.9637 ^ (-1 / 0.6) = 1.0636 (`ENDLESS_PLAYER_LEVEL_FOLLOW_NEUTRAL_RATIO`); the 0.8 floor is reached
 * at P / C = (0.8 / 0.9637) ^ (1 / 0.6) = 0.7332 and below. Examples: 0.5 C and 0.7 C give 0.8, 0.8 C 0.8429, C 0.9637,
 * 1.2 C 1.0751, 1.5 C 1.2291, 3 C 1.8630. A player's real lead over the foes is P / (C x f) = (P / C) ^ 0.4 / 0.9637
 * above the floor, so candies past C still matter. In waves 1000 to 3999 (no follow under the 3차 rule, f = 1) a player
 * under 1.0636 x C meets lower foes than before, one over it higher ones. A trainer's ace sits at about 1.007 to 1.009 x
 * C on the normal curve, so it ends up at about 1.007 to 1.009 x C x f; the other members keep their ratio to the ace.
 * The wild bosses on multiples of 250 are scaled before their rounding up to a multiple of 25, so they still land on one.
 *
 * Levels are rolled once, when the battle is made (`BattleScene.newBattle` -> the `Battle` constructor; a Mystery
 * Encounter's battle when it starts). The session is saved after the enemies exist, and a reloaded battle takes their
 * saved levels (`GameData.loadSession` overwrites `enemyLevels` and restores the enemies), so a different party level
 * after a reload changes nothing. The factor draws no random numbers, so it moves no other roll.
 * Before wave 1000 and in every other mode nothing changes.
 */

/**
 * Local fork (2026-11-18): the first battle wave whose enemy levels follow the player. It was 4000 ("4000웨이브
 * 정도부턴 레벨 스케일링을 플레이어에게 맞춰보죠"); the two-sided rule starts with the lifted level cap at 1000 ("1000웨이브
 * 이후는 레벨캡은 그냥 풉시다", "초보에게는 조금더 낮고, 고수에게는 좀더 높은 레벨의 상대가 나오도록").
 */
export const ENDLESS_PLAYER_LEVEL_FOLLOW_START_WAVE = 1000;

/**
 * Local fork (2026-11-18): the exponent of f = max(0.8, 0.9637 x (P / C) ^ 0.6), the same for every P (option 다,
 * chosen 2026-11-18 because the novice models are above C). The user: "밸런스는 레벨을 따라가는걸 조금더 플레이어 상대
 * 유동적으로 바꿔보죠, 초보에게는 조금더 낮고, 고수에게는 좀더 높은 레벨의 상대가 나오도록". It was 0.5 under the 3차
 * rule (09 명세 1번, "0.5 권장, 0.5 ~ 0.6 범위"; a constant of this name held that 0.5); 0.6 is the top of that range.
 * It replaces the first 11-18 rule's two exponents (0.6 at or above C, 0.5 under it).
 */
export const ENDLESS_PLAYER_LEVEL_FOLLOW_EXPONENT = 0.6;

/**
 * Local fork (2026-11-18): the scale of f = max(0.8, 0.9637 x (P / C) ^ 0.6) (option 다, chosen 2026-11-18 because the
 * novice models are above C: "초보에게는 조금더 낮고, 고수에게는 좀더 높은 레벨의 상대가 나오도록"). 0.9637 = 1.447 ^ -0.1
 * rounded to 4 places, so f meets the 3차 rule (max(1, P / C) ^ 0.5) at the middle model EI (P / C = 1.447): the novice
 * models get lower foes than under it (NC, P = C: -3.6%; NE, 1.2 C: -1.9%) and the expert model higher ones (EE, 1.628
 * C: +1.2%).
 */
export const ENDLESS_PLAYER_LEVEL_FOLLOW_SCALE = 0.9637;

/**
 * Local fork (2026-11-18): the lowest follow factor: enemies are at most 20% under their normal level, reached at
 * P / C = (0.8 / 0.9637) ^ (1 / 0.6) = 0.7332 and below. It was 1 under the 3차 rule (f never went under the normal
 * curve).
 */
export const ENDLESS_PLAYER_LEVEL_FOLLOW_MIN_FACTOR = 0.8;

/** Local fork (2026-11-18): the factor that leaves a level as it is (before wave 1000, other modes, P = 0) */
export const ENDLESS_PLAYER_LEVEL_FOLLOW_NEUTRAL_FACTOR = 1;

/**
 * Local fork (2026-11-18): the P / C where 0.9637 x (P / C) ^ 0.6 is 1, 0.9637 ^ (-1 / 0.6) = 1.0635638522056858: a
 * player there meets the normal level curve (under it lower foes, over it higher ones). Not used by the rule itself; it
 * is where a test or a tool stands a player to read the normal curve: with P = round(C x this), |f - 1| <= 0.3 / P,
 * so every enemy level under 1.6 x P (all of them: the highest, a trainer's ace, is about 1.01 x C) rounds back to
 * its normal value.
 */
export const ENDLESS_PLAYER_LEVEL_FOLLOW_NEUTRAL_RATIO =
  ENDLESS_PLAYER_LEVEL_FOLLOW_SCALE ** (-1 / ENDLESS_PLAYER_LEVEL_FOLLOW_EXPONENT);

/**
 * Local fork (2026-11-18): the first Endless / Spliced Endless battle wave without the player's EXP level cap. The user:
 * "1000웨이브 이후는 레벨캡은 그냥 풉시다." From this wave `BattleScene.getMaxExpLevel` gives no cap (EXP keeps levelling
 * a Pokémon past the old cap); the old formula stays as C, the expected level, for the follow rule above, the battle
 * score and Dynamax Cannon (`BattleScene.getWaveLevelCap`).
 */
export const ENDLESS_EXP_LEVEL_CAP_LIFT_WAVE = 1000;

/**
 * Local fork (2026-11-13): the player's EXP level cap on a battle wave without the test overrides, the formula that was
 * inline in `BattleScene.getMaxExpLevel` (moved here unchanged so the follow rule's C is the cap by construction): the
 * wave is rounded up to the next 10, then ceil(base x 1.2 / 2) x 2 + 2 + S(w).
 * Local fork (2026-11-18): from Endless wave 1000 the cap is lifted (`isEndlessExpLevelCapLifted`) and this number is
 * only the expected level C of the wave.
 * @param gameMode - The current game mode
 * @param waveIndex - The battle wave (0 or missing counts as wave 1)
 * @returns The cap level
 */
export function getNaturalMaxExpLevel(gameMode: GameMode, waveIndex: number): number {
  const capWaveIndex = Math.ceil((waveIndex || 1) / 10) * 10;
  const difficultyWaveIndex = gameMode.getWaveForDifficulty(capWaveIndex);
  const baseLevel = (1 + difficultyWaveIndex / 2 + Math.pow(difficultyWaveIndex / 25, 2)) * 1.2;
  return Math.ceil(baseLevel / 2) * 2 + 2 + getEndlessLevelBonus(gameMode, difficultyWaveIndex);
}

/**
 * Local fork (2026-11-18): whether the player's EXP level cap is lifted on a battle wave (Endless / Spliced Endless,
 * wave >= 1000): "1000웨이브 이후는 레벨캡은 그냥 풉시다."
 */
export function isEndlessExpLevelCapLifted(gameMode: GameMode, waveIndex: number): boolean {
  return gameMode.isEndless === true && waveIndex >= ENDLESS_EXP_LEVEL_CAP_LIFT_WAVE;
}

/** Local fork (2026-11-13): whether a battle wave's enemy levels follow the player (Endless / Spliced Endless, wave >= 1000) */
export function isEndlessPlayerLevelFollowWave(gameMode: GameMode, waveIndex: number): boolean {
  return gameMode.isEndless === true && waveIndex >= ENDLESS_PLAYER_LEVEL_FOLLOW_START_WAVE;
}

/** Local fork (2026-11-13): P, the highest level in the player's party, fainted members included (0 for no party) */
export function getHighestPlayerPartyLevel(): number {
  return (globalScene.getPlayerParty() ?? []).reduce((highest, p) => Math.max(highest, p?.level ?? 0), 0);
}

/**
 * Local fork (2026-11-18): the two-sided follow factor of a battle wave for a given P: max(0.8, 0.9637 x (P / C) ^ 0.6),
 * one formula for every P (option 다, chosen 2026-11-18 because the novice models are above C)
 * @param gameMode - The current game mode
 * @param waveIndex - The battle wave
 * @param highestPlayerLevel - P, the highest level in the player's party
 * @returns f, exactly 1 before wave 1000, outside Endless and for P = 0 (no party); 0.9637 at P = C, about 1 at
 * P = 1.0636 x C (`ENDLESS_PLAYER_LEVEL_FOLLOW_NEUTRAL_RATIO`), never under 0.8
 */
export function getEndlessPlayerLevelFollowFactor(
  gameMode: GameMode,
  waveIndex: number,
  highestPlayerLevel: number,
): number {
  if (!isEndlessPlayerLevelFollowWave(gameMode, waveIndex) || !(highestPlayerLevel > 0)) {
    return ENDLESS_PLAYER_LEVEL_FOLLOW_NEUTRAL_FACTOR;
  }
  const ratio = highestPlayerLevel / getNaturalMaxExpLevel(gameMode, waveIndex);
  // "초보에게는 조금더 낮고, 고수에게는 좀더 높은 레벨의 상대가 나오도록": under 1.0636 x C lower foes (at most 20%
  // lower), over it higher ones
  return Math.max(
    ENDLESS_PLAYER_LEVEL_FOLLOW_MIN_FACTOR,
    ENDLESS_PLAYER_LEVEL_FOLLOW_SCALE * Math.pow(ratio, ENDLESS_PLAYER_LEVEL_FOLLOW_EXPONENT),
  );
}

/**
 * Local fork (2026-11-13): the follow factor f for the battle being made on `waveIndex`, with P read from the current
 * player party (only where the rule applies)
 */
export function getEndlessEnemyLevelFactor(gameMode: GameMode, waveIndex: number): number {
  if (!isEndlessPlayerLevelFollowWave(gameMode, waveIndex)) {
    return ENDLESS_PLAYER_LEVEL_FOLLOW_NEUTRAL_FACTOR;
  }
  return getEndlessPlayerLevelFollowFactor(gameMode, waveIndex, getHighestPlayerPartyLevel());
}

/**
 * Local fork (2026-11-13): one enemy level from the normal formulas times the follow factor, rounded to a whole level;
 * the level itself, untouched, when f is 1. Local fork (2026-11-18): f can be under 1 now (down to 0.8); the result is
 * never under level 1.
 */
export function applyEndlessEnemyLevelFactor(level: number, factor: number): number {
  return factor === ENDLESS_PLAYER_LEVEL_FOLLOW_NEUTRAL_FACTOR ? level : Math.max(1, Math.round(level * factor));
}
