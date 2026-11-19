import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PartyUiMode } from "#enums/party-ui-mode";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import type { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import type { PartyUiHandler } from "#ui/party-ui-handler";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// Local fork (2026-11-19): A6, random failures in full runs. The tests of a worker share one scene, and a screen left
// active under another one (opened with `setModeWithoutClear`) used to reach the next test: `PartyUiHandler.show` and
// `ModifierSelectUiHandler.show` return early while active, so a switch test got the old Party screen and hung, and a
// reward screen showed the old options; a Party message with a prompt cut off by the end of a test left the Party screen
// ignoring every button. `GameManager` now clears such screens and input state when it resets the scene. The tests run
// in order in pairs: the first leaves the UI in that state, the second checks that it starts clean.
describe("Local fork - the test harness clears UI a previous test left open (A6)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingLevel(100)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH);
  });

  it("1/4: ends with the reward screen under the Party screen, its options menu open, under the Summary", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
    game.move.use(MoveId.SPLASH);
    await game.doKillOpponents();
    await game.phaseInterceptor.to("SelectModifierPhase");
    const { ui } = game.scene;
    expect(ui.mode).toBe(UiMode.MODIFIER_SELECT);

    await ui.setModeWithoutClear(UiMode.PARTY, PartyUiMode.CHECK);
    const party = ui.handlers[UiMode.PARTY] as PartyUiHandler;
    party.setCursor(1);
    party.showOptions();
    await ui.setModeWithoutClear(UiMode.SUMMARY, game.scene.getPlayerParty()[1]);

    expect(ui.mode).toBe(UiMode.SUMMARY);
    expect(ui.handlers[UiMode.MODIFIER_SELECT].active).toBe(true);
    expect(party.active).toBe(true);
    expect(party["optionsMode"]).toBe(true);
  });

  it("2/4: starts with those screens closed, switches through a fresh Party screen and gets fresh rewards", async () => {
    const { ui } = game.scene;
    const party = ui.handlers[UiMode.PARTY] as PartyUiHandler;
    const rewards = ui.handlers[UiMode.MODIFIER_SELECT] as ModifierSelectUiHandler;
    expect(party.active).toBe(false);
    expect(party["optionsMode"]).toBe(false);
    expect(rewards.active).toBe(false);
    expect(rewards.options).toEqual([]);

    await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
    game.doSwitchPokemon(1);
    await game.toNextTurn();
    expect(game.field.getPlayerPokemon().species.speciesId).toBe(SpeciesId.MAGIKARP);

    game.move.use(MoveId.SPLASH);
    await game.doKillOpponents();
    await game.phaseInterceptor.to("SelectModifierPhase");
    expect(ui.mode).toBe(UiMode.MODIFIER_SELECT);
    expect(rewards.active).toBe(true);
    expect(rewards.options.length).toBeGreaterThan(0);
  });

  it("3/4: ends while the Party screen still types a message with a prompt", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
    const { ui } = game.scene;
    await ui.setMode(UiMode.PARTY, PartyUiMode.CHECK);
    const party = ui.handlers[UiMode.PARTY] as PartyUiHandler;
    // As a filter message ("... has no energy left to battle!") is shown: typed on the shared clock, then a prompt
    party.showText("The test ends before this message is typed out. ".repeat(4), undefined, () => {}, undefined, true);
    expect(party.pendingPrompt).toBe(true);
  });

  it("4/4: starts with no prompt pending on the Party screen, and switches", async () => {
    const party = game.scene.ui.handlers[UiMode.PARTY] as PartyUiHandler;
    expect(party.pendingPrompt).toBe(false);
    expect(party["awaitingActionInput"]).toBeFalsy();
    expect(party["onActionInput"]).toBeFalsy();

    await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
    game.doSwitchPokemon(1);
    await game.toNextTurn();
    expect(game.field.getPlayerPokemon().species.speciesId).toBe(SpeciesId.MAGIKARP);
  });
});
