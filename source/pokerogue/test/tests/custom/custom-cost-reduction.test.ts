// Local fork (2026-11-17): candy cost reductions down to 1 point for every starter (starters.ts). The user: "사탕으로
// 코스트를 감소시키는것의 제한을 풀어보죠, 전부 1코스트까지 감소시킬 수 있도록. 사탕 요구 개수만 조절하고".
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { getMaxValueReductions, getValueReductionCandyCounts } from "#balance/starters";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { isValueReductionAvailable } from "#ui/starter-select-ui-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Local fork - cost reduction down to 1 point", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("keeps the base game's first two prices and adds rising ones after", () => {
    const baseFirstTwo = [
      [25, 60],
      [25, 60],
      [20, 50],
      [15, 40],
      [12, 35],
      [10, 30],
      [8, 20],
      [5, 15],
      [5, 15],
      [5, 15],
    ];
    for (let cost = 1; cost <= 10; cost++) {
      const counts = getValueReductionCandyCounts(cost);
      expect(counts).toHaveLength(getMaxValueReductions(cost));
      expect(counts.slice(0, 2), `cost ${cost}`).toEqual(baseFirstTwo[cost - 1]);
      for (let n = 1; n < counts.length; n++) {
        expect(counts[n], `cost ${cost}, reduction ${n + 1}`).toBeGreaterThan(counts[n - 1]);
      }
    }
    expect(getMaxValueReductions(1)).toBe(2);
    expect(getMaxValueReductions(2)).toBe(2);
    expect(getMaxValueReductions(3)).toBe(2);
    expect(getMaxValueReductions(4)).toBe(3);
    expect(getMaxValueReductions(10)).toBe(9);
    expect(getValueReductionCandyCounts(4)).toEqual([15, 40, 80]);
    expect(getValueReductionCandyCounts(10)).toEqual([5, 15, 30, 50, 75, 105, 140, 180, 225]);
  });

  it("brings every starter of 3 points and more down to exactly 1 point", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const { gameData } = game.scene;
    for (const starterId of speciesDataRegistry.getAllStarters()) {
      const cost = speciesDataRegistry.getStarterCost(starterId);
      const max = getMaxValueReductions(cost);
      const value = gameData.getSpeciesStarterValue(starterId, max);
      if (cost >= 3) {
        expect(value, `starter ${SpeciesId[starterId]} (${cost})`).toBe(1);
      } else {
        // 1 and 2 point starters keep the base game's two reductions, which go below 1 point
        expect(value).toBe(cost === 2 ? 0.5 : 0.25);
      }
    }
  });

  it("offers the next reduction until the starter is at 1 point", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const entry = game.scene.gameData.starterData[SpeciesId.MEWTWO];
    const cost = speciesDataRegistry.getStarterCost(SpeciesId.MEWTWO);
    const counts = getValueReductionCandyCounts(cost);
    expect(cost).toBeGreaterThanOrEqual(8);

    entry.candyCount = 9999;
    for (let bought = 0; bought < counts.length; bought++) {
      entry.valueReduction = bought;
      expect(isValueReductionAvailable(SpeciesId.MEWTWO), `after ${bought}`).toBe(true);
    }
    entry.valueReduction = counts.length;
    expect(isValueReductionAvailable(SpeciesId.MEWTWO)).toBe(false);
    expect(game.scene.gameData.getSpeciesStarterValue(SpeciesId.MEWTWO)).toBe(1);

    // Not with too few candies for the next one
    entry.valueReduction = 2;
    entry.candyCount = counts[2] - 1;
    expect(isValueReductionAvailable(SpeciesId.MEWTWO)).toBe(false);
    entry.candyCount = counts[2];
    expect(isValueReductionAvailable(SpeciesId.MEWTWO)).toBe(true);
  });
});
