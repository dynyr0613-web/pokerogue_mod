// Local fork (2026-11-13): 08 명세 4번, "사탕단지 99개 기준 5850웨이브 레벨 스케일링 (~320,000 Lv)". Past Endless wave 500
// the Candy Jar term S(w) = ((w - 500) / A) ^ B (endless-level-scaling.ts, A and B solved from the spec's stated targets
// +1,850 at wave 1000 and +251,000 at wave 5850) is added to the final level of wild enemies, of trainer party members
// and to the player's EXP level cap. Classic, Challenge and Daily keep their levels exactly. Also the numbers that come
// with levels near 500,000: EXP totals, level-ups, Candy feeding past the cap and saving.
import { Battle } from "#app/battle";
import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import {
  ENDLESS_LEVEL_SCALING_DIVISOR,
  ENDLESS_LEVEL_SCALING_EXPONENT,
  getEndlessLevelBonus,
} from "#balance/endless-level-scaling";
import { GrowthRate, getLevelRelExp, getLevelTotalExp } from "#data/exp";
import { BattleType } from "#enums/battle-type";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { Trainer } from "#field/trainer";
import { feedCandy } from "#modifiers/custom-consumables";
import { getEncounterPokemonLevelForWave } from "#mystery-encounters/encounter-pokemon-utils";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import { getEnumValues } from "#utils/enums";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** The level formula's base level for a difficulty wave (`Battle.getLevelForWave`, `Trainer.getPartyLevels`) */
function baseLevel(wave: number): number {
  return 1 + wave / 2 + (wave / 25) ** 2;
}

/** The EXP level cap before 08 명세 4번 (`BattleScene.getMaxExpLevel` without the term), for a battle wave */
function oldMaxExpLevel(gameModeId: GameModes, wave: number): number {
  const difficultyWave = getGameMode(gameModeId).getWaveForDifficulty(Math.ceil(wave / 10) * 10);
  return Math.ceil((baseLevel(difficultyWave) * 1.2) / 2) * 2 + 2;
}

describe("Local fork: Endless level scaling past wave 500 (08 명세 4번)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Sets the game mode and a current battle on `wave` (wild unless a trainer is given) */
  function setBattle(mode: GameModes, wave: number, trainer?: Trainer): Battle {
    game.scene.gameMode = getGameMode(mode);
    const battle = new Battle(game.scene.gameMode, {
      waveIndex: wave,
      battleType: trainer ? BattleType.TRAINER : BattleType.WILD,
      trainer,
      double: false,
    });
    game.scene.currentBattle = battle;
    return battle;
  }

  it("solves A and B from the spec's stated targets, Endless and Spliced Endless only", () => {
    // B = ln(251,000 / 1,850) / ln(5350 / 500), A = 500 / 1,850 ^ (1 / B)
    expect(ENDLESS_LEVEL_SCALING_EXPONENT).toBeCloseTo(2.0716296869117, 10);
    expect(ENDLESS_LEVEL_SCALING_DIVISOR).toBeCloseTo(13.239384902605, 10);
    for (const mode of [GameModes.ENDLESS, GameModes.SPLICED_ENDLESS]) {
      const gameMode = getGameMode(mode);
      // The spec's anchors exactly, nothing up to wave 500
      expect([1, 200, 499, 500, 501, 1000, 5850].map(w => getEndlessLevelBonus(gameMode, w))).toEqual([
        0, 0, 0, 0, 0, 1850, 251_000,
      ]);
      expect([750, 2000, 3000, 4000, 5000].map(w => getEndlessLevelBonus(gameMode, w))).toEqual([
        440, 18_013, 51_901, 104_208, 175_392,
      ]);
      // It never goes down from one wave to the next
      let last = 0;
      for (let w = 500; w <= 5850; w++) {
        const bonus = getEndlessLevelBonus(gameMode, w);
        expect(bonus).toBeGreaterThanOrEqual(last);
        last = bonus;
      }
    }
    for (const mode of [GameModes.CLASSIC, GameModes.CHALLENGE, GameModes.DAILY]) {
      for (const wave of [200, 501, 1000, 5850]) {
        expect(getEndlessLevelBonus(getGameMode(mode), wave)).toBe(0);
      }
    }
  });

  it("adds S(w) to wild levels after the boss x1.2, keeping the 250-wave bosses on a multiple of 25", async () => {
    await game.runToTitle();
    // Wave 1000 boss: ceil((floor(2101 x 1.2) + 1850) / 25) x 25 = 4375 (Classic's formula gives 2525)
    expect(setBattle(GameModes.CLASSIC, 1000).enemyLevels).toEqual([2525]);
    const boss1000 = setBattle(GameModes.ENDLESS, 1000);
    expect(boss1000.enemyLevels).toEqual([4375]);
    // Mystery Encounters that take the wave's level follow
    expect(getEncounterPokemonLevelForWave(0)).toBe(4375);
    expect(setBattle(GameModes.SPLICED_ENDLESS, 1000).enemyLevels).toEqual([4375]);

    // Wave 5850 boss level: floor(57,682 x 1.2) + 251,000 = 320,218, then the usual +-floor(5850 / 10)
    const boss5850 = setBattle(GameModes.ENDLESS, 5850);
    for (let i = 0; i < 200; i++) {
      const level = boss5850.getLevelForWave();
      expect(level).toBeGreaterThanOrEqual(320_218 - 585);
      expect(level).toBeLessThanOrEqual(320_218 + 585);
    }
    // A plain wild Pokémon on wave 5851: the old roll plus S(5851)
    const bonus = getEndlessLevelBonus(game.scene.gameMode, 5851);
    expect(bonus).toBeGreaterThan(251_000);
    const wild = setBattle(GameModes.ENDLESS, 5851);
    for (let i = 0; i < 200; i++) {
      const level = wild.getLevelForWave();
      expect(level).toBeGreaterThanOrEqual(Math.round(baseLevel(5851)) + bonus);
      expect(level).toBeLessThanOrEqual(Math.round(baseLevel(5851) + 5851 / 10) + bonus);
    }
  });

  it("adds S(w) to every trainer member after its slot multiplier", async () => {
    await game.runToTitle();
    for (const [type, wave] of [
      [TrainerType.CYNTHIA, 5850],
      [TrainerType.ROCKET_BOSS_GIOVANNI_2, 5850],
      [TrainerType.ACE_TRAINER, 3000],
      [TrainerType.YOUNGSTER, 750],
    ] as const) {
      setBattle(GameModes.ENDLESS, wave);
      game.scene.setSeed(`levels-${type}`);
      const trainer = new Trainer(type, TrainerVariant.DEFAULT);
      game.scene.gameMode = getGameMode(GameModes.CLASSIC);
      const classic = trainer.getPartyLevels(wave);
      game.scene.gameMode = getGameMode(GameModes.ENDLESS);
      const endless = trainer.getPartyLevels(wave);
      const bonus = getEndlessLevelBonus(game.scene.gameMode, wave);
      expect(bonus, TrainerType[type]).toBeGreaterThan(0);
      expect(endless, TrainerType[type]).toEqual(classic.map(level => level + bonus));
      trainer.destroy();
    }
    // Cynthia at 5850: 70,373 x 4, 71,526 and her ace 72,103 before, each + 251,000 now
    setBattle(GameModes.ENDLESS, 5850);
    game.scene.setSeed("levels-cynthia");
    const cynthia = new Trainer(TrainerType.CYNTHIA, TrainerVariant.DEFAULT);
    expect(cynthia.getPartyLevels(5850)).toEqual([321_373, 321_373, 321_373, 321_373, 322_526, 323_103]);
    cynthia.destroy();
  });

  it("raises the EXP level cap by the same S(w), from the wave rounded up to 10; Classic, Challenge, Daily unchanged", async () => {
    await game.runToTitle();
    const endlessCaps = [500, 1000, 2000, 3000, 4000, 5000, 5841, 5850].map(wave => {
      setBattle(GameModes.ENDLESS, wave);
      return game.scene.getMaxExpLevel();
    });
    expect(endlessCaps).toEqual([784, 4374, 26_897, 70_985, 137_332, 226_396, 320_222, 320_222]);
    for (const wave of [1000, 5850]) {
      expect(oldMaxExpLevel(GameModes.ENDLESS, wave) + getEndlessLevelBonus(getGameMode(GameModes.ENDLESS), wave)).toBe(
        endlessCaps[wave === 1000 ? 1 : 7],
      );
    }
    for (const [mode, waves] of [
      [GameModes.CLASSIC, [1, 10, 50, 150, 199, 200, 5850]],
      [GameModes.CHALLENGE, [1, 50, 200]],
      [GameModes.DAILY, [1, 10, 49, 50]],
    ] as const) {
      for (const wave of waves) {
        setBattle(mode, wave);
        expect(game.scene.getMaxExpLevel(), `${GameModes[mode]} ${wave}`).toBe(oldMaxExpLevel(mode, wave));
      }
    }
    // The 5850 cap before this change, for the record
    setBattle(GameModes.CLASSIC, 5850);
    expect(game.scene.getMaxExpLevel()).toBe(69_222);
  });

  it("keeps EXP, level-ups, Candy feeding past the cap and saving sane up to level 500,000", async () => {
    await game.runToTitle();
    // EXP totals: past Number.MAX_SAFE_INTEGER from about level 190,000, but still finite, rising, and each level's
    // EXP is far above the doubles' spacing there, so adding a level's worth always counts
    for (const rate of getEnumValues(GrowthRate)) {
      for (const level of [69_222, 320_222, 500_000]) {
        const total = getLevelTotalExp(level, rate);
        const rel = getLevelRelExp(level + 1, rate);
        expect(Number.isFinite(total), `${GrowthRate[rate]} ${level}`).toBe(true);
        expect(rel, `${GrowthRate[rate]} ${level}`).toBeGreaterThan(0);
        expect(total + rel, `${GrowthRate[rate]} ${level}`).toBeGreaterThan(total);
      }
    }

    setBattle(GameModes.ENDLESS, 5850);
    expect(game.scene.getMaxExpLevel()).toBe(320_222);
    const garchomp = game.scene.addPlayerPokemon(speciesDataRegistry.getSpecies(SpeciesId.GARCHOMP), 300_000);
    const rate = garchomp.species.growthRate;
    garchomp.exp = getLevelTotalExp(300_000, rate);
    // Under the cap EXP still levels it, one level at a time
    garchomp.addExp(getLevelRelExp(300_001, rate) + getLevelRelExp(300_002, rate) + 1);
    expect(garchomp.level).toBe(300_002);
    // At the cap EXP stops, and the EXP is cut back to the cap level's total
    garchomp.level = 320_221;
    garchomp.exp = getLevelTotalExp(320_221, rate);
    garchomp.addExp(getLevelRelExp(320_222, rate) * 10);
    expect(garchomp.level).toBe(320_222);
    expect(garchomp.exp).toBe(getLevelTotalExp(320_222, rate));

    // Candies go past the cap: the level rises and the EXP follows it (feedCandy, Candy Pile / Rare Candy)
    feedCandy(garchomp, 179_778);
    expect(garchomp.level).toBe(500_000);
    expect(garchomp.exp).toBe(getLevelTotalExp(500_000, rate));
    expect(garchomp.exp).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
    // EXP above the cap does nothing to the level
    garchomp.addExp(1e9);
    expect(garchomp.level).toBe(500_000);
    garchomp.calculateStats();
    expect(garchomp.getStats().every(stat => Number.isSafeInteger(stat) && stat > 0)).toBe(true);
    expect(garchomp.getMaxHp()).toBeGreaterThan(1_000_000);

    // Saving and loading keeps the level and the (unsafe-integer) EXP exactly
    const saved = new PokemonData(JSON.parse(JSON.stringify(new PokemonData(garchomp))));
    expect([saved.level, saved.exp]).toEqual([500_000, garchomp.exp]);
    garchomp.destroy();
  });
});
