import { getGameMode } from "#app/game-mode";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** What Endless trainers and encounters exposed once they were switched on. */
describe("Custom Endless fixes", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH])
      .mysteryEncounterChance(0);
  });

  /** Start an Endless run the way the title screen would, with no gym offset, and play to the first `CommandPhase`. */
  async function runToCommand(species: SpeciesId[]): Promise<void> {
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.ENDLESS);
      game.scene.offsetGym = false;
      const starters = generateStarters(game.scene, species);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    await game.phaseInterceptor.to("EncounterPhase");
    game.removeEnemyHeldItems();
    await game.phaseInterceptor.to("CommandPhase", false);
  }

  it("keeps trainer Pokemon IVs at 31 deep into Endless", async () => {
    game.override.startingWave(400).battleType(BattleType.TRAINER);
    await runToCommand([SpeciesId.FEEBAS]);

    expect(game.scene.currentBattle.battleType).toBe(BattleType.TRAINER);
    const party = game.scene.getEnemyParty();
    expect(party.length).toBeGreaterThan(0);
    for (const pokemon of party) {
      expect(pokemon.hasTrainer()).toBe(true);
      expect(pokemon.ivs).toEqual([31, 31, 31, 31, 31, 31]);
    }
  });

  it("slides a trainer onto the field on an X6 wave, which starts in NewBiomeEncounterPhase", async () => {
    game.override.startingWave(85);
    await runToCommand([SpeciesId.FEEBAS]);
    expect(game.scene.currentBattle.waveIndex).toBe(85);

    game.override.battleType(BattleType.TRAINER);
    // The test harness runs tweens by calling onComplete at once, so check the slide-in by its targets
    const tweenSpy = vi.spyOn(game.scene.tweens, "add");
    game.move.select(MoveId.SPLASH);
    await game.doKillOpponents();
    await game.toNextWave();

    const { currentBattle } = game.scene;
    expect(currentBattle.waveIndex).toBe(86);
    expect(game.phaseInterceptor.phaseLog).toContain("NewBiomeEncounterPhase");
    expect(currentBattle.battleType).toBe(BattleType.TRAINER);
    expect(currentBattle.trainer).toBeDefined();
    const slideIns = tweenSpy.mock.calls.filter(([config]) => (config as { x?: string }).x === "+=300");
    expect(slideIns.length).toBeGreaterThan(0);
    expect(
      slideIns.some(([config]) => [(config as { targets: unknown }).targets].flat(2).includes(currentBattle.trainer)),
    ).toBe(true);
  });

  describe("trainer lookahead", () => {
    beforeEach(async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      game.scene.gameMode = getGameMode(GameModes.ENDLESS);
      game.scene.offsetGym = false;
      vi.spyOn(game.scene.arena, "trainerChance", "get").mockReturnValue(8);
    });

    // isWaveTrainer rolls the two earlier waves (a roll of 1 means "no trainer there"), then its own wave
    function rollNoneThenHit() {
      return vi
        .spyOn(Phaser.Math.RND, "integerInRange")
        .mockReturnValueOnce(1)
        .mockReturnValueOnce(1)
        .mockReturnValue(0);
    }

    it("no longer treats an Endless boss wave as a nearby gym battle", () => {
      const rnd = rollNoneThenHit();
      expect(game.scene.gameMode.isEndlessBoss(50)).toBe(true);
      expect(game.scene.gameMode.isWaveTrainer(48)).toBe(true);
      rnd.mockRestore();
    });

    it("still keeps random trainers away from a real gym wave", () => {
      const rnd = rollNoneThenHit();
      expect(game.scene.gameMode.isWaveTrainer(18)).toBe(false);
      rnd.mockRestore();
    });
  });
});
