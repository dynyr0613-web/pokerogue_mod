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
 * cap on a difficulty wave, rounded to a whole level (rounded, not floored, so the anchors come out exactly).
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
 *
 * From Endless / Spliced Endless battle wave 4000 on, every enemy level the normal formulas give (wild:
 * `Battle.getLevelForWave`, S(w) included; trainers: `Trainer.getPartyLevels`, S(w) included; the Mystery Encounter
 * enemies that take their levels from those two) is multiplied by f = max(1, P / C) ^ α and rounded, where
 *   P = the highest level in the player's party (fainted members included) when the battle's levels are rolled,
 *   C = the player's normal EXP level cap on that wave (`getNaturalMaxExpLevel`, the formula `BattleScene.getMaxExpLevel`
 *       uses, S(w) included, without its test overrides), and
 *   α = `ENDLESS_PLAYER_LEVEL_FOLLOW_EXPONENT`, 0.5 (a square root).
 * A trainer's ace sits at about 1.007 to 1.009 x C on the normal curve, so it ends up at about 1.007 to 1.009 x C x f.
 * The other members keep their ratio to the ace, and a player at or under the cap sees the normal curve (f is never
 * below 1). The wild bosses on multiples of 250 are scaled before their rounding up to a multiple of 25, so they still
 * land on one.
 *
 * Local fork (2026-11-13): 09 명세 1번 "4000웨이브+ 레벨 따라가기 지수 완충". The 08 rule had α = 1 (f = P / C), and
 * with both sides' levels times the same factor the damage / HP ratios froze: candy levels past the cap stopped
 * mattering ("대미지 ÷ HP 비율이 완전히 고정(NC = NE, EC = EI = EE)"). With α = 0.5 the enemies follow only the square
 * root of the player's lead, so P / (C x f) = (P / C) ^ 0.5: at wave 5850 (C = 320,222) the final trainers' ace
 * (322,526 at the cap) is 353,305 for P = 384,256, 387,937 for 463,280, 411,527 for 521,337 (525,088 with α = 1) and
 * 558,631 for 960,666 (3 x C).
 *
 * Levels are rolled once, when the battle is made (`BattleScene.newBattle` -> the `Battle` constructor; a Mystery
 * Encounter's battle when it starts). The session is saved after the enemies exist, and a reloaded battle takes their
 * saved levels (`GameData.loadSession` overwrites `enemyLevels` and restores the enemies), so a different party level
 * after a reload changes nothing. The factor draws no random numbers, so it moves no other roll.
 * Before wave 4000, in every other mode and for the player's own EXP cap nothing changes.
 */

/**
 * Local fork (2026-11-13): the first battle wave whose enemy levels follow the player, "4000웨이브 정도부턴 레벨
 * 스케일링을 플레이어에게 맞춰보죠"
 */
export const ENDLESS_PLAYER_LEVEL_FOLLOW_START_WAVE = 4000;

/**
 * Local fork (2026-11-13): the lowest follow factor f = max(1, P / C) ^ α: a player at or under the cap sees the normal
 * curve, never a lower one
 */
export const ENDLESS_PLAYER_LEVEL_FOLLOW_MIN_FACTOR = 1;

/**
 * Local fork (2026-11-13): 09 명세 1번, the damping exponent α of f = max(1, P / C) ^ α. The spec: "지수 완충 계수 (0.5
 * 권장, 0.5 ~ 0.6 범위)"; its recommended 0.5 (a square root) is used. It was 1 (f = P / C) in the 08 rule.
 */
export const ENDLESS_PLAYER_LEVEL_FOLLOW_EXPONENT = 0.5;

/**
 * Local fork (2026-11-13): the player's EXP level cap on a battle wave without the test overrides, the formula that was
 * inline in `BattleScene.getMaxExpLevel` (moved here unchanged so the follow rule's C is the cap by construction): the
 * wave is rounded up to the next 10, then ceil(base x 1.2 / 2) x 2 + 2 + S(w).
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

/** Local fork (2026-11-13): whether a battle wave's enemy levels follow the player (Endless / Spliced Endless, wave >= 4000) */
export function isEndlessPlayerLevelFollowWave(gameMode: GameMode, waveIndex: number): boolean {
  return gameMode.isEndless === true && waveIndex >= ENDLESS_PLAYER_LEVEL_FOLLOW_START_WAVE;
}

/** Local fork (2026-11-13): P, the highest level in the player's party, fainted members included (0 for no party) */
export function getHighestPlayerPartyLevel(): number {
  return (globalScene.getPlayerParty() ?? []).reduce((highest, p) => Math.max(highest, p?.level ?? 0), 0);
}

/**
 * Local fork (2026-11-13): the follow factor f = max(1, P / C) ^ α (α = 0.5 since the 09 spec) of a battle wave for a
 * given P
 * @param gameMode - The current game mode
 * @param waveIndex - The battle wave
 * @param highestPlayerLevel - P, the highest level in the player's party
 * @returns f, exactly 1 before wave 4000, outside Endless and for P at or under the cap
 */
export function getEndlessPlayerLevelFollowFactor(
  gameMode: GameMode,
  waveIndex: number,
  highestPlayerLevel: number,
): number {
  if (!isEndlessPlayerLevelFollowWave(gameMode, waveIndex)) {
    return ENDLESS_PLAYER_LEVEL_FOLLOW_MIN_FACTOR;
  }
  const ratio = highestPlayerLevel / getNaturalMaxExpLevel(gameMode, waveIndex);
  if (!(ratio > ENDLESS_PLAYER_LEVEL_FOLLOW_MIN_FACTOR)) {
    return ENDLESS_PLAYER_LEVEL_FOLLOW_MIN_FACTOR;
  }
  // Local fork (2026-11-13): 09 명세 1번, damped by the exponent: f = (P / C) ^ 0.5 instead of P / C
  return Math.pow(ratio, ENDLESS_PLAYER_LEVEL_FOLLOW_EXPONENT);
}

/**
 * Local fork (2026-11-13): the follow factor f for the battle being made on `waveIndex`, with P read from the current
 * player party (only where the rule applies)
 */
export function getEndlessEnemyLevelFactor(gameMode: GameMode, waveIndex: number): number {
  if (!isEndlessPlayerLevelFollowWave(gameMode, waveIndex)) {
    return ENDLESS_PLAYER_LEVEL_FOLLOW_MIN_FACTOR;
  }
  return getEndlessPlayerLevelFollowFactor(gameMode, waveIndex, getHighestPlayerPartyLevel());
}

/**
 * Local fork (2026-11-13): one enemy level from the normal formulas times the follow factor, rounded to a whole level;
 * the level itself, untouched, when f is 1
 */
export function applyEndlessEnemyLevelFactor(level: number, factor: number): number {
  return factor > ENDLESS_PLAYER_LEVEL_FOLLOW_MIN_FACTOR ? Math.round(level * factor) : level;
}
