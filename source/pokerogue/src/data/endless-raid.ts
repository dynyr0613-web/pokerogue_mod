/*
 * Local fork (2026-11-17): the raid before the end of Endless. The user: "최강의 증표 - 나중에 5849웨이브를 7성 레이드같은
 * 환경으로 꾸미고, 그 웨이브에서 나온 보스 포켓몬을 잡으면 획득하게".
 *
 * Wave 5849 of Endless and Spliced Endless, the one before the final trainer (endless-final-trainer.ts), is set up
 * like a 7-star Tera Raid:
 * - always a single wild battle, never a trainer, a double battle or a Mystery Encounter (`BattleScene`);
 * - the wild Pokémon is always a boss with its wave's health bars (`BattleScene.getEncounterBossSegments`);
 * - it is Terastallized from the start and carries the Mightiest Mark, "최강의" before its name (`EnemyPokemon`);
 * - it can be caught, also in the END biome where Endless otherwise forbids it (`CommandPhase.checkCanUseBall`), and
 *   catching it is the only way to the Mightiest Mark.
 */

import type { GameMode } from "#app/game-mode";
import { ENDLESS_FINAL_WAVE } from "#trainers/endless-final-trainer";

/** The raid's wave: the one before the last */
export const ENDLESS_RAID_WAVE = ENDLESS_FINAL_WAVE - 1;

/** @returns Whether `waveIndex` is the raid wave of `gameMode` (Endless or Spliced Endless) */
export function isEndlessRaidWave(gameMode: GameMode | undefined, waveIndex: number | undefined): boolean {
  return gameMode?.isEndless === true && waveIndex === ENDLESS_RAID_WAVE;
}
