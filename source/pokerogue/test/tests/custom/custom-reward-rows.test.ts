import { Button } from "#enums/buttons";
import { MoveId } from "#enums/move-id";
import { ShopCursorTarget } from "#enums/shop-cursor-target";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { ExtraModifierModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import { getRewardRowLimit, type ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// Fork: up to 9 Golden Poke Balls; rewards past 6 wrap to a second row on the reward screen
describe("Custom - Golden Poke Ball cap and two reward rows", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH])
      .disableTrainerWaves();
  });

  /** Answers yes to the "skip the reward?" question that CANCEL opens on the reward screen. */
  function confirmSkip() {
    game.onNextPrompt(
      "SelectModifierPhase",
      UiMode.CONFIRM,
      () => (game.scene.ui.getHandler() as ModifierSelectUiHandler).processInput(Button.ACTION),
      () => game.isCurrentPhase("CommandPhase") || game.isCurrentPhase("NewBattlePhase"),
    );
  }

  it("splits rewards into rows of 6", () => {
    expect([3, 6, 7, 9, 12, 13, 14].map(getRewardRowLimit)).toEqual([3, 6, 6, 6, 6, 7, 7]);
  });

  it("stacks up to 9 Golden Poke Balls", async () => {
    game.override.startingModifier([{ name: "GOLDEN_POKEBALL", count: 9 }]);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    const golden = game.scene.findModifier(m => m instanceof ExtraModifierModifier) as ExtraModifierModifier;
    expect(golden.getStackCount()).toBe(9);
    expect(golden.getMaxStackCount()).toBe(9);
  });

  it("shows 12 rewards as two rows of 6 and moves the cursor between them", async () => {
    game.override.startingModifier([{ name: "GOLDEN_POKEBALL", count: 9 }]);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    game.move.use(MoveId.SPLASH);
    await game.doKillOpponents();

    let checked = false;
    game.onNextPrompt(
      "SelectModifierPhase",
      UiMode.MODIFIER_SELECT,
      () => {
        const handler = game.scene.ui.getHandler() as ModifierSelectUiHandler;
        const options = handler["options"];
        expect(options).toHaveLength(12);

        // Two rows of 6: same y within a row, the second row lower, columns spread the same way in both rows
        const ys = [...new Set(options.map(o => o.y))];
        expect(ys).toHaveLength(2);
        expect(options.slice(0, 6).every(o => o.y === options[0].y)).toBe(true);
        expect(options.slice(6).every(o => o.y === options[6].y)).toBe(true);
        expect(options[6].y).toBeGreaterThan(options[0].y);
        expect(options.slice(6).map(o => o.x)).toEqual(options.slice(0, 6).map(o => o.x));

        const at = () => [handler["rowCursor"], handler.getCursor()];
        handler.setRowCursor(ShopCursorTarget.REWARDS);
        handler.setCursor(0);
        expect(at()).toEqual([1, 0]);

        // Right wraps inside the upper row
        for (let i = 0; i < 5; i++) {
          handler.processInput(Button.RIGHT);
        }
        expect(at()).toEqual([1, 5]);
        handler.processInput(Button.RIGHT);
        expect(at()).toEqual([1, 0]);

        // Down goes to the same column of the lower row, left wraps inside it
        handler.processInput(Button.DOWN);
        expect(at()).toEqual([1, 6]);
        handler.processInput(Button.LEFT);
        expect(at()).toEqual([1, 11]);
        const cursorY = handler["cursorObj"]!.y;
        handler.processInput(Button.UP);
        expect(at()).toEqual([1, 5]);
        expect(handler["cursorObj"]!.y).toBeLessThan(cursorY);

        // From the lower row, down leaves for the buttons; coming back up lands on the lower row
        handler.processInput(Button.DOWN);
        handler.processInput(Button.DOWN);
        expect(handler["rowCursor"]).toBe(0);
        handler.processInput(Button.UP);
        expect(handler["rowCursor"]).toBe(1);
        expect(handler.getCursor()).toBeGreaterThanOrEqual(6);

        checked = true;
        handler.processInput(Button.CANCEL);
      },
      () => game.isCurrentPhase("CommandPhase") || game.isCurrentPhase("NewBattlePhase"),
      true,
    );
    confirmSkip();
    await game.phaseInterceptor.to("TurnInitPhase");
    expect(checked).toBe(true);
  });

  it("keeps 6 rewards in one row", async () => {
    game.override.startingModifier([{ name: "GOLDEN_POKEBALL", count: 3 }]);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    game.move.use(MoveId.SPLASH);
    await game.doKillOpponents();

    let checked = false;
    game.onNextPrompt(
      "SelectModifierPhase",
      UiMode.MODIFIER_SELECT,
      () => {
        const handler = game.scene.ui.getHandler() as ModifierSelectUiHandler;
        const options = handler["options"];
        expect(options).toHaveLength(6);
        expect(new Set(options.map(o => o.y)).size).toBe(1);
        expect(options.every(o => o.scale === 0.5)).toBe(true);
        checked = true;
        handler.processInput(Button.CANCEL);
      },
      () => game.isCurrentPhase("CommandPhase") || game.isCurrentPhase("NewBattlePhase"),
      true,
    );
    confirmSkip();
    await game.phaseInterceptor.to("TurnInitPhase");
    expect(checked).toBe(true);
  });
});
