/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { AbilityId } from "#enums/ability-id";
import { Button } from "#enums/buttons";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { PERMANENT_STATS, Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import { IV_SCANNER_BETTER_MARK } from "#ui/battle-message-ui-handler";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Local fork (2026-11-20): Q8, "(+)" after each IV the IV scanner shows that is higher than the player's record for the
 * species (battle-message-ui-handler.ts). The user: "내 개체보다 높은 개체값을 (+)로 표시".
 */
describe("Local fork - the IV scanner marks better IVs with (+) (2026-11-20)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH]);
  });

  /** Enemy IVs by stat (HP, Atk, Def, SpAtk, SpDef, Spd) and the record they are compared with */
  const ENEMY_IVS = [31, 5, 10, 11, 20, 30];
  const RECORD_IVS = [10, 10, 10, 10, 25, 29];
  /** Higher than the record: HP 31 > 10, SpAtk 11 > 10, Spd 30 > 29; not Atk 5, Def 10 (equal), SpDef 20 */
  const BETTER = [true, false, false, true, false, true];

  it("adds (+) only to IVs above the record of the species' line, and none once the record holds them", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const enemy = game.field.getEnemyPokemon();
    enemy.ivs = [...ENEMY_IVS];
    // Snorlax's line is recorded at its root, Munchlax
    const root = enemy.species.getRootSpeciesId();
    expect(root).toBe(SpeciesId.MUNCHLAX);
    game.scene.gameData.dexData[root].ivs = [...RECORD_IVS];

    const handler = game.scene.ui.getMessageHandler();
    for (const stat of PERMANENT_STATS) {
      const text = handler.getIvDescriptor(enemy.ivs[stat], stat, enemy.id);
      expect(text.includes(IV_SCANNER_BETTER_MARK), `stat ${Stat[stat]}`).toBe(BETTER[stat]);
    }

    // The record catches up (as after a catch, or IV Candies raising it): no (+) left
    game.scene.gameData.updateSpeciesDexIvs(enemy.species.getRootSpeciesId(true), enemy.ivs);
    for (const stat of PERMANENT_STATS) {
      expect(handler.getIvDescriptor(enemy.ivs[stat], stat, enemy.id)).not.toContain(IV_SCANNER_BETTER_MARK);
    }
  });

  it("shows the marks in the scanner's window, one line per stat, which closes on A", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const enemy = game.field.getEnemyPokemon();
    enemy.ivs = [...ENEMY_IVS];
    game.scene.gameData.dexData[enemy.species.getRootSpeciesId()].ivs = [...RECORD_IVS];

    const handler = game.scene.ui.getMessageHandler();
    const shown = handler.promptIvs(enemy.id, enemy.ivs);
    const lines = ((handler as any).levelUpStatsValuesContent.text as string)
      .split("\n")
      .slice(0, PERMANENT_STATS.length);
    expect(lines.map(line => line.includes(IV_SCANNER_BETTER_MARK))).toEqual(BETTER);
    expect((handler as any).levelUpStatsContainer.visible).toBe(true);

    handler.processInput(Button.ACTION);
    await shown;
  });

  // The test text objects measure no width, so the window's layout math is driven with stand-ins of known widths
  it("widens the stats window to the left only when the values come too close to the stat names, and back", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const handler = game.scene.ui.getMessageHandler() as any;
    const saved = {
      labels: handler.levelUpStatsLabelsContent,
      bg: handler.levelUpStatsBg,
      labelsX: handler.levelUpStatsLabelsX,
      bgWidth: handler.levelUpStatsBgWidth,
      values: handler.levelUpStatsValuesContent,
    };
    try {
      // As set up: stat names 30 wide ending 73 from the right edge, values right-aligned 7 from it, window 80 + 30
      const right = 320;
      const labels = {
        x: right - 73 - 30,
        displayWidth: 30,
        setX(x: number) {
          this.x = x;
          return this;
        },
      };
      const bg = {
        width: 110,
        height: 100,
        setSize(w: number, h: number) {
          this.width = w;
          this.height = h;
          return this;
        },
      };
      const values = { x: right - 7, displayWidth: 0 };
      Object.assign(handler, {
        levelUpStatsLabelsContent: labels,
        levelUpStatsBg: bg,
        levelUpStatsLabelsX: labels.x,
        levelUpStatsBgWidth: bg.width,
        levelUpStatsValuesContent: values,
      });

      // Words that fit with the 4-pixel gap (61 wide, as "Pretty Good" without the mark): the window stays as it is
      values.displayWidth = 61;
      handler.fitLevelUpStatsWindow();
      expect(labels.x).toBe(right - 103);
      expect(bg.width).toBe(110);

      // With " (+)" (77 wide): 15 short of the gap, so the names move 15 to the left and the window grows by 15
      values.displayWidth = 77;
      handler.fitLevelUpStatsWindow();
      expect(labels.x).toBe(right - 103 - 15);
      expect(bg.width).toBe(125);
      expect(labels.x + labels.displayWidth + 4).toBe(values.x - values.displayWidth);

      // The next level-up's numbers: back to its own width
      values.displayWidth = 12;
      handler.fitLevelUpStatsWindow();
      expect(labels.x).toBe(right - 103);
      expect(bg.width).toBe(110);
      expect(bg.height).toBe(100);
    } finally {
      Object.assign(handler, {
        levelUpStatsLabelsContent: saved.labels,
        levelUpStatsBg: saved.bg,
        levelUpStatsLabelsX: saved.labelsX,
        levelUpStatsBgWidth: saved.bgWidth,
        levelUpStatsValuesContent: saved.values,
      });
    }
  });
});
