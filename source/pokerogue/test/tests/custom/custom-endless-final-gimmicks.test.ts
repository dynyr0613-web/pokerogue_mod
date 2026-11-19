import { getGameMode } from "#app/game-mode";
import type { RandomTrainerOverride } from "#app/overrides";
import { allMoves } from "#data/data-lists";
import { enemyDynamaxDice, getTrainerDynamaxOrder } from "#data/enemy-dynamax";
import { enemyMoveConversionDice, getEnemyMoveConversionOptions } from "#data/enemy-move-conversions";
import { BattleType } from "#enums/battle-type";
import { GameModes } from "#enums/game-modes";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { UiMode } from "#enums/ui-mode";
import type { EnemyPokemon } from "#field/pokemon";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import {
  ENDLESS_FINAL_TRAINER_POOL,
  ENDLESS_FINAL_WAVE,
  isEndlessFinalTrainerBattle,
} from "#trainers/endless-final-trainer";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

/**
 * Local fork (2026-11-19): the final Endless trainer (wave 5850) has fixed Dynamax and Z / Max moves instead of the
 * enemy rolls: its ace always comes in the Dynamax state with its damaging moves as Max moves, exactly one other member
 * (seeded) always has one Z-Move, and no enemy Dynamax or move-conversion roll is made (enemy-dynamax.ts,
 * enemy-move-conversions.ts). The user: "5850웨이브 적 트레이너가 다이맥스와 다이맥스 기술은 사용하고, z기술은 에이스가
 * 아닌 포켓몬이 한마리 확정으로 가지고 있도록 하죠".
 */
describe("Local fork: the final Endless trainer's fixed Dynamax and Z / Max moves (2026-11-19)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let dynamaxDice: MockInstance<(range: number) => number>;
  let conversionDice: MockInstance<(range: number) => number>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    // No enemy moveset override: it turns every move conversion off
    game.override.criticalHits(false).battleStyle("single").mysteryEncounterChance(0);
    dynamaxDice = vi.spyOn(enemyDynamaxDice, "roll");
    conversionDice = vi.spyOn(enemyMoveConversionDice, "roll");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Starts an Endless run on `wave` the way the title screen would, and plays to the first command */
  async function startRun(wave: number, seed: string): Promise<void> {
    game.override.startingWave(wave).seed(seed);
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.ENDLESS);
      game.scene.offsetGym = false;
      const starters = generateStarters(game.scene, [SpeciesId.GARCHOMP]);
      game.scene.setSeed(seed);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await game.phaseInterceptor.to("CommandPhase", false);
  }

  /** The slots of `pokemon` that hold a conversion */
  const convertedSlots = (pokemon: EnemyPokemon) => pokemon.moveset.filter(slot => !!slot?.transform);

  it.each(ENDLESS_FINAL_TRAINER_POOL.map(trainerType => ({ trainerType, name: TrainerType[trainerType] })))(
    "$name: the ace is Dynamaxed with Max moves, one other member has one Z-Move, nothing is rolled",
    async ({ trainerType }) => {
      game.override.randomTrainer({ trainerType: trainerType as RandomTrainerOverride["trainerType"] });
      await startRun(ENDLESS_FINAL_WAVE, `final-gimmicks-${trainerType}`);
      const battle = game.scene.currentBattle;
      expect(battle.waveIndex).toBe(ENDLESS_FINAL_WAVE);
      expect(battle.battleType).toBe(BattleType.TRAINER);
      expect(battle.trainer!.config.trainerType).toBe(trainerType);
      expect(isEndlessFinalTrainerBattle()).toBe(true);
      const party = game.scene.getEnemyParty();
      expect(party).toHaveLength(6);

      // The ace: the first of the ace-first order among the members not already in a G-Max form, and only it
      const inState = party.filter(p => p.hasDynamaxState());
      expect(inState).toHaveLength(1);
      const ace = inState[0];
      expect(
        getTrainerDynamaxOrder(
          party.filter(p => !p.isMax()),
          true,
        )[0],
      ).toBe(ace);
      expect(ace.isDynamaxed()).toBe(true);
      expect(ace.hp).toBe(ace.getMaxHp());

      // Its damaging slots are all Max moves (a G-Max move where the 다이사탕 rule picks one); status slots stay
      for (const slot of ace.moveset) {
        const label = `${ace.name}'s ${MoveId[slot.moveId]}`;
        if (allMoves[slot.moveId].category === MoveCategory.STATUS) {
          expect(slot.transform ?? null, label).toBeNull();
        } else {
          expect(["max", "gmax"], label).toContain(slot.transform?.kind);
        }
      }
      expect(convertedSlots(ace).length).toBeGreaterThan(0);

      // Exactly one other member has exactly one Z-Move; the rest have nothing
      const others = party.filter(p => p !== ace && convertedSlots(p).length > 0);
      expect(others).toHaveLength(1);
      const [holder] = others;
      const zSlots = convertedSlots(holder);
      expect(zSlots).toHaveLength(1);
      expect(["z", "zExclusive"]).toContain(zSlots[0].transform!.kind);

      // Seeded: the holder is the one the conversion dice drew among the members that could take a Z-Move
      const zPool = party.filter(p => p !== ace && (p === holder || getEnemyMoveConversionOptions(p).z.length > 0));
      expect(conversionDice.mock.calls[0][0]).toBe(zPool.length);
      expect(zPool[conversionDice.mock.results[0].value as number]).toBe(holder);

      // No chance roll and no Max-or-Z roll (both are out of 100), no Dynamax roll
      expect(conversionDice.mock.calls.every(([range]) => range !== 100)).toBe(true);
      expect(dynamaxDice).not.toHaveBeenCalled();
    },
  );

  describe("seeded", () => {
    /** Each member's species, Dynamax state and converted move ids, from the first run of the seed */
    let firstRun: unknown[] | undefined;
    const snapshot = () =>
      game.scene
        .getEnemyParty()
        .map(p => [p.species.speciesId, p.hasDynamaxState(), p.moveset.map(m => m.transform?.moveId ?? null)]);

    // A run from the title screen needs a fresh game manager (beforeEach), so the seed is played in two tests in a row
    it("a run on a seed (first of two)", async () => {
      game.override.randomTrainer({ trainerType: TrainerType.GHETSIS_2 });
      await startRun(ENDLESS_FINAL_WAVE, "final-gimmicks-seeded");
      firstRun = snapshot();
      expect(game.scene.getEnemyParty().filter(p => p.hasDynamaxState())).toHaveLength(1);
    });

    it("the same seed again gives the same ace, Z-Move holder and moves", async () => {
      game.override.randomTrainer({ trainerType: TrainerType.GHETSIS_2 });
      await startRun(ENDLESS_FINAL_WAVE, "final-gimmicks-seeded");
      expect(firstRun).toBeDefined();
      expect(snapshot()).toEqual(firstRun);
    });
  });
});
