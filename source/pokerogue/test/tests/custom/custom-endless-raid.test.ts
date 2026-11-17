// Local fork (2026-11-17): the raid on wave 5849 of Endless (endless-raid.ts). The user: "최강의 증표 - 나중에 5849웨이브를
// 7성 레이드같은 환경으로 꾸미고, 그 웨이브에서 나온 보스 포켓몬을 잡으면 획득하게".

import { getGameMode } from "#app/game-mode";
import {
  applyRaidTurnEnd,
  ENDLESS_RAID_WAVE,
  getRaidThresholdsPassed,
  isEndlessRaidWave,
  isRaidBoss,
  RAID_HP_MULTIPLIER,
  RAID_RESET_THRESHOLDS,
} from "#data/endless-raid";
import { COMPLETION_EXEMPT_MARKS, getPokemonTitle } from "#data/pokemon-marks";
import { Status } from "#data/status-effect";
import { BattleType } from "#enums/battle-type";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { PokemonMark } from "#enums/pokemon-mark";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { UiMode } from "#enums/ui-mode";
import type { CommandPhase } from "#phases/command-phase";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Local fork: the Endless raid (5849) and the Mightiest Mark", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.criticalHits(false).moveset([MoveId.SPLASH]).enemyMoveset(MoveId.SPLASH).mysteryEncounterChance(100);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Starts a run in `mode` on `wave` the way the title screen would, and plays to the first command */
  async function startRun(mode: GameModes, wave: number, seed = "raid"): Promise<void> {
    game.override.startingWave(wave).seed(seed);
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(mode);
      game.scene.offsetGym = false;
      const starters = generateStarters(game.scene, [SpeciesId.GARCHOMP, SpeciesId.MILOTIC]);
      game.scene.setSeed(seed);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await game.phaseInterceptor.to("CommandPhase", false);
  }

  it("is the wave before the last, in Endless and Spliced Endless only", () => {
    expect(ENDLESS_RAID_WAVE).toBe(5849);
    for (const mode of [GameModes.ENDLESS, GameModes.SPLICED_ENDLESS]) {
      expect(isEndlessRaidWave(getGameMode(mode), 5849)).toBe(true);
      expect(isEndlessRaidWave(getGameMode(mode), 5850)).toBe(false);
      expect(isEndlessRaidWave(getGameMode(mode), 5848)).toBe(false);
    }
    expect(isEndlessRaidWave(getGameMode(GameModes.CLASSIC), 5849)).toBe(false);
    expect(isEndlessRaidWave(undefined, 5849)).toBe(false);
    // A hidden mark: no collection needs it
    expect(COMPLETION_EXEMPT_MARKS).toContain(PokemonMark.MIGHTIEST_MARK);
  });

  it("meets one Terastallized wild boss with the Mightiest Mark, which can be caught", async () => {
    await startRun(GameModes.ENDLESS, ENDLESS_RAID_WAVE);

    const battle = game.scene.currentBattle;
    expect(battle.waveIndex).toBe(ENDLESS_RAID_WAVE);
    expect(battle.battleType).toBe(BattleType.WILD);
    // Two against one
    expect(battle.double).toBe(true);
    expect(game.scene.getPlayerField()).toHaveLength(2);

    const enemies = game.scene.getEnemyParty();
    expect(enemies).toHaveLength(1);
    const boss = enemies[0];
    expect(boss.isBoss()).toBe(true);
    expect(boss.isTerastallized).toBe(true);
    expect(boss.hasMark(PokemonMark.MIGHTIEST_MARK)).toBe(true);
    expect(getPokemonTitle(boss)).not.toBe("");

    const commandPhase = game.scene.phaseManager.getCurrentPhase() as CommandPhase;
    expect((commandPhase as any).checkCanUseBall()).toBe(true);

    // Its max HP is multiplied while it is the raid's boss, and its own again without the mark
    expect(isRaidBoss(boss)).toBe(true);
    const raidHp = boss.getMaxHp();
    expect(boss.hp).toBe(raidHp);
    boss.marks = [];
    boss.calculateStats();
    expect(isRaidBoss(boss)).toBe(false);
    expect(raidHp).toBe(boss.getMaxHp() * RAID_HP_MULTIPLIER);
    boss.addMark(PokemonMark.MIGHTIEST_MARK);
    boss.calculateStats();
    boss.hp = boss.getMaxHp();

    // Turn end: the status goes, and nothing else above the first threshold
    const [player] = game.scene.getPlayerField();
    player.setStatStage(Stat.ATK, 4);
    player.setStatStage(Stat.DEF, -2);
    boss.setStatStage(Stat.SPD, -3);
    boss.setStatStage(Stat.ATK, 2);
    boss.status = new Status(StatusEffect.BURN);
    applyRaidTurnEnd(boss);
    expect(boss.status).toBeNull();
    expect(player.getStatStage(Stat.ATK)).toBe(4);

    // Past the first threshold: the player's raised stats and its own lowered ones go, the rest stays; once
    boss.hp = Math.floor(boss.getMaxHp() * 0.7);
    applyRaidTurnEnd(boss);
    expect(player.getStatStage(Stat.ATK)).toBe(0);
    expect(player.getStatStage(Stat.DEF)).toBe(-2);
    expect(boss.getStatStage(Stat.SPD)).toBe(0);
    expect(boss.getStatStage(Stat.ATK)).toBe(2);
    player.setStatStage(Stat.ATK, 2);
    applyRaidTurnEnd(boss);
    expect(player.getStatStage(Stat.ATK)).toBe(2);
    // And again at the next one
    boss.hp = Math.floor(boss.getMaxHp() * 0.4);
    applyRaidTurnEnd(boss);
    expect(player.getStatStage(Stat.ATK)).toBe(0);
    // Not for another Pokémon
    player.setStatStage(Stat.ATK, 3);
    applyRaidTurnEnd(player);
    expect(player.getStatStage(Stat.ATK)).toBe(3);
  });

  it("counts the HP thresholds passed", () => {
    expect(RAID_RESET_THRESHOLDS).toEqual([0.75, 0.5, 0.25]);
    expect(getRaidThresholdsPassed(1)).toBe(0);
    expect(getRaidThresholdsPassed(0.76)).toBe(0);
    expect(getRaidThresholdsPassed(0.75)).toBe(1);
    expect(getRaidThresholdsPassed(0.5)).toBe(2);
    expect(getRaidThresholdsPassed(0.1)).toBe(3);
  });

  it("leaves the wave before it alone", async () => {
    game.override.mysteryEncounterChance(0);
    await startRun(GameModes.ENDLESS, ENDLESS_RAID_WAVE - 1);
    for (const enemy of game.scene.getEnemyParty()) {
      expect(enemy.hasMark(PokemonMark.MIGHTIEST_MARK)).toBe(false);
    }
  });
});
