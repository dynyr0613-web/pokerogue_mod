/*
 * Local fork (2026-11-13): the last wave of Endless, 5850, is a trainer battle against one of the strongest boss trainers
 * instead of the wild END-biome boss (a Paradox species). The user: "5850웨이브에 트레이너를 등장시키는, 엘리트 트레이너
 * 중에서도 가장 강한 몇만 엄선해서 등장시키는 특수 규칙을 만들도록 하죠, 기존 패러독스 보스는 5850에서 나오기엔 좀 약해서."
 * - Who: the five evil-team bosses' final versions that measured strongest at wave 5850 (each fields three members with
 *   two boss bars and an active passive; test/tests/custom/sim/sim-5850-trainer-candidates.test.ts built every champion,
 *   evil-team boss, gym leader, fork named trainer and 엘리트 트레이너 (ACE_TRAINER) party at 5850 and scored them):
 *   비주기 (ROCKET_BOSS_GIOVANNI_2, Mega Mewtwo X + Y fixed fusion), 로즈 (ROSE_2), 루자미네 (LUSAMINE_2), 게치스
 *   (GHETSIS_2), 태홍 (CYRUS_2, Origin Dialga + Origin Palkia fixed fusion). Measured scores 39.2 / 38.3 / 37.7 / 37.6 /
 *   37.5 (엘리트 트레이너 20.5, the wild 5850 boss 19.8).
 * - How: Endless and Spliced Endless only, battle wave {@linkcode ENDLESS_FINAL_WAVE}; one of the pool at even odds,
 *   drawn on the run's seed, always a single battle with the trainer's default variant. Everything else is the normal
 *   Endless boss-trainer battle of that wave (held items, vitamins, fork items, fixed fusions, enemy tokens).
 * - Hook: `BattleScene.handleNonFixedBattle` (battle-scene.ts) before the Mystery Encounter check; the run's end at the
 *   final wave (battle-end-phase.ts) now lets the trainer's defeat (`TrainerVictoryPhase`) play before `GameOverPhase`.
 * - Local fork (2026-11-19): its Dynamax and Z / Max moves are fixed, not rolled ({@linkcode isEndlessFinalTrainerBattle}).
 */

import type { GameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import { BattleType } from "#enums/battle-type";
import { TrainerType } from "#enums/trainer-type";
import { randSeedItem } from "#utils/common";

/** Local fork (2026-11-13): the last Endless wave; winning it ends the run (battle-end-phase.ts) */
export const ENDLESS_FINAL_WAVE = 5850;

/** Local fork (2026-11-13): the trainers the final Endless wave draws from, strongest first as measured at wave 5850 */
export const ENDLESS_FINAL_TRAINER_POOL: readonly TrainerType[] = Object.freeze([
  TrainerType.ROCKET_BOSS_GIOVANNI_2,
  TrainerType.ROSE_2,
  TrainerType.LUSAMINE_2,
  TrainerType.GHETSIS_2,
  TrainerType.CYRUS_2,
]);

/** Local fork (2026-11-13): whether `waveIndex` is the final Endless wave of `gameMode` (Endless or Spliced Endless) */
export function isEndlessFinalWave(gameMode: GameMode, waveIndex: number): boolean {
  return gameMode.isEndless === true && waveIndex >= ENDLESS_FINAL_WAVE;
}

/** Local fork (2026-11-13): whether `waveIndex` is the final Endless trainer battle of `gameMode` */
export function isEndlessFinalTrainerWave(gameMode: GameMode, waveIndex: number): boolean {
  return gameMode.isEndless === true && gameMode.hasTrainers === true && waveIndex === ENDLESS_FINAL_WAVE;
}

/**
 * Local fork (2026-11-19): whether the current battle is the final Endless trainer battle (a trainer battle at the final
 * wave). Its Dynamax and Z / Max moves are fixed instead of rolled: its ace (`getEndlessFinalAce`, enemy-dynamax.ts)
 * always comes in the Dynamax state with its damaging moves as Max moves, exactly one other member (seeded) always has
 * one Z-Move, and no other enemy Dynamax or move-conversion roll is made (enemy-dynamax.ts, enemy-move-conversions.ts;
 * the user: "5850웨이브 적 트레이너가 다이맥스와 다이맥스 기술은 사용하고, z기술은 에이스가 아닌 포켓몬이 한마리 확정으로
 * 가지고 있도록 하죠")
 */
export function isEndlessFinalTrainerBattle(): boolean {
  const battle = globalScene.currentBattle;
  return (
    battle?.battleType === BattleType.TRAINER
    && !!battle.trainer
    && isEndlessFinalTrainerWave(globalScene.gameMode, battle.waveIndex)
  );
}

/**
 * Local fork (2026-11-13): the final wave's trainer type, one of {@linkcode ENDLESS_FINAL_TRAINER_POOL} at even odds,
 * drawn on its own seed offset of the wave so that no other draw of the wave moves
 */
export function drawEndlessFinalTrainerType(waveIndex: number): TrainerType {
  let trainerType = ENDLESS_FINAL_TRAINER_POOL[0];
  globalScene.executeWithSeedOffset(() => {
    trainerType = randSeedItem(ENDLESS_FINAL_TRAINER_POOL);
  }, waveIndex << 8);
  return trainerType;
}
