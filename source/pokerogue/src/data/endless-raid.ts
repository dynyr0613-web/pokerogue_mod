/*
 * Local fork (2026-11-17): the raid before the end of Endless. The user: "최강의 증표 - 나중에 5849웨이브를 7성 레이드같은
 * 환경으로 꾸미고, 그 웨이브에서 나온 보스 포켓몬을 잡으면 획득하게".
 *
 * Wave 5849 of Endless and Spliced Endless, the one before the final trainer (endless-final-trainer.ts), is set up
 * like a 7-star Tera Raid:
 * - always a wild battle, never a trainer or a Mystery Encounter, and two against one as in the main series' raids:
 *   the player sends out two Pokémon against the one boss (`BattleScene`, `Battle`);
 * - the wild Pokémon is always a boss with its wave's health bars (`BattleScene.getEncounterBossSegments`), and its
 *   max HP is multiplied by {@linkcode RAID_HP_MULTIPLIER} while it is the raid's boss (`Pokemon.calculateStats`);
 * - at the end of every turn it shakes off its status condition, and each time its HP has fallen past one of
 *   {@linkcode RAID_RESET_THRESHOLDS} it clears the player's Pokémon's raised stats and its own lowered ones
 *   ({@linkcode applyRaidTurnEnd}; the user: "본가처럼 2대1, 적 레이드 보스 hp 배율, 매 턴마다 상태이상 회복, 일정 hp
 *   구간마다 랭크업 초기화");
 * - it is Terastallized from the start and carries the Mightiest Mark, "최강의" before its name (`EnemyPokemon`);
 * - it can be caught, also in the END biome where Endless otherwise forbids it (`CommandPhase.checkCanUseBall`), and
 *   catching it is the only way to the Mightiest Mark.
 */

import type { GameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { getStatusEffectHealText } from "#data/status-effect";
import { PokemonMark } from "#enums/pokemon-mark";
import { BATTLE_STATS } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { ENDLESS_FINAL_WAVE } from "#trainers/endless-final-trainer";
import i18next from "i18next";

/** The raid's wave: the one before the last */
export const ENDLESS_RAID_WAVE = ENDLESS_FINAL_WAVE - 1;

/** @returns Whether `waveIndex` is the raid wave of `gameMode` (Endless or Spliced Endless) */
export function isEndlessRaidWave(gameMode: GameMode | undefined, waveIndex: number | undefined): boolean {
  return gameMode?.isEndless === true && waveIndex === ENDLESS_RAID_WAVE;
}

/** What the raid boss' max HP is multiplied by */
export const RAID_HP_MULTIPLIER = 3;

/** The shares of its max HP at which the raid boss clears stat changes, highest first */
export const RAID_RESET_THRESHOLDS: readonly number[] = [0.75, 0.5, 0.25];

/** How many of {@linkcode RAID_RESET_THRESHOLDS} each raid boss (by Pokémon id) has already answered */
const answeredThresholds = new Map<number, number>();

/** @returns Whether the Pokémon is the raid's boss: the enemy boss with the Mightiest Mark on the raid wave */
export function isRaidBoss(pokemon: Pokemon): boolean {
  return (
    pokemon.isEnemy()
    && pokemon.isBoss()
    && pokemon.hasMark(PokemonMark.MIGHTIEST_MARK)
    && isEndlessRaidWave(globalScene.gameMode, globalScene.currentBattle?.waveIndex)
  );
}

/**
 * The raid boss' max HP: {@linkcode RAID_HP_MULTIPLIER} times what it would be. A caught one is no longer the raid's
 * boss, so its HP is its own again.
 * @param pokemon - The Pokémon whose stats are calculated
 * @param maxHp - Its max HP so far
 */
export function applyRaidHpMultiplier(pokemon: Pokemon, maxHp: number): number {
  return isRaidBoss(pokemon) ? maxHp * RAID_HP_MULTIPLIER : maxHp;
}

/**
 * How many of {@linkcode RAID_RESET_THRESHOLDS} the HP share has fallen to or past.
 * @param hpRatio - Current HP over max HP
 */
export function getRaidThresholdsPassed(hpRatio: number): number {
  return RAID_RESET_THRESHOLDS.filter(threshold => hpRatio <= threshold).length;
}

/**
 * The raid boss' turn end: it shakes off its status condition, and once for each HP threshold it has newly fallen
 * past it clears the raised stats of the player's Pokémon on the field and its own lowered stats.
 * @param pokemon - Any Pokémon on the field; only the raid's boss does anything
 */
export function applyRaidTurnEnd(pokemon: Pokemon): void {
  if (!isRaidBoss(pokemon) || pokemon.isFainted()) {
    return;
  }
  if (pokemon.status) {
    globalScene.phaseManager.queueMessage(
      getStatusEffectHealText(pokemon.status.effect, getPokemonNameWithAffix(pokemon)),
    );
    // At once, not as a phase: the turn goes on with the Pokémon already cured
    pokemon.resetStatus(false, false, false, false);
    pokemon.updateInfo();
  }

  const passed = getRaidThresholdsPassed(pokemon.getHpRatio());
  if (passed <= (answeredThresholds.get(pokemon.id) ?? 0)) {
    return;
  }
  answeredThresholds.set(pokemon.id, passed);
  for (const stat of BATTLE_STATS) {
    for (const player of globalScene.getPlayerField()) {
      if (player.getStatStage(stat) > 0) {
        player.setStatStage(stat, 0);
      }
    }
    if (pokemon.getStatStage(stat) < 0) {
      pokemon.setStatStage(stat, 0);
    }
  }
  for (const affected of [...globalScene.getPlayerField(), pokemon]) {
    affected.updateInfo();
  }
  globalScene.phaseManager.queueMessage(
    i18next.t("pokemonMarks:raidStatReset", { pokemonName: getPokemonNameWithAffix(pokemon) }),
  );
}
