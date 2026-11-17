// Local fork (2026-11-13): the final Endless wave, 5850, is a trainer battle against one of the strongest boss trainers
// (endless-final-trainer.ts) instead of the wild END-biome Paradox boss. The user: "5850웨이브에 트레이너를 등장시키는,
// 엘리트 트레이너 중에서도 가장 강한 몇만 엄선해서 등장시키는 특수 규칙을 만들도록 하죠, 기존 패러독스 보스는 5850에서
// 나오기엔 좀 약해서." Also the enemy buff draw once every token is at its cap (modifier-type.ts,
// getEnemyBuffModifierForWave), which used to throw on the next 50-wave victory.
import { getGameMode } from "#app/game-mode";
import { modifierTypes } from "#data/data-lists";
import { BattleType } from "#enums/battle-type";
import { GameModes } from "#enums/game-modes";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { UiMode } from "#enums/ui-mode";
import { EnemyPersistentModifier } from "#modifiers/modifier";
import { getEnemyBuffModifierForWave, regenerateModifierPoolThresholds } from "#modifiers/modifier-type";
import { AddEnemyBuffModifierPhase } from "#phases/add-enemy-buff-modifier-phase";
import { BattleEndPhase } from "#phases/battle-end-phase";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import {
  drawEndlessFinalTrainerType,
  ENDLESS_FINAL_TRAINER_POOL,
  ENDLESS_FINAL_WAVE,
  isEndlessFinalTrainerWave,
  isEndlessFinalWave,
} from "#trainers/endless-final-trainer";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

/** Every enemy buff token, as `AddEnemyBuffModifierPhase` draws them, with its cap at battle wave 2000 and after */
const TOKEN_CAPS = {
  ENEMY_DAMAGE_BOOSTER: 999,
  ENEMY_DAMAGE_REDUCTION: 999,
  ENEMY_HEAL: 10,
  ENEMY_STATUS_EFFECT_HEAL_CHANCE: 10,
  ENEMY_ENDURE_CHANCE: 10,
  ENEMY_ATTACK_POISON_CHANCE: 10,
  ENEMY_ATTACK_PARALYZE_CHANCE: 10,
  ENEMY_ATTACK_BURN_CHANCE: 10,
  ENEMY_FUSED_CHANCE: 10,
} as const;

describe("Local fork: the final Endless wave's trainer (5850)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logSpy: MockInstance | undefined;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .moveset([MoveId.SPLASH])
      .enemyMoveset(MoveId.SPLASH)
      .mysteryEncounterChance(0);
  });

  afterEach(() => {
    logSpy?.mockRestore();
    logSpy = undefined;
    vi.restoreAllMocks();
  });

  /** Starts a run in `mode` on `wave` the way the title screen would, and plays to the first command */
  async function startRun(mode: GameModes, wave: number, seed = "final-trainer"): Promise<void> {
    game.override.startingWave(wave).seed(seed);
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(mode);
      game.scene.offsetGym = false;
      const starters = generateStarters(game.scene, [SpeciesId.GARCHOMP]);
      // generateStarters resets the seed; the run's own seed is set after it
      game.scene.setSeed(seed);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await game.phaseInterceptor.to("CommandPhase", false);
  }

  it("is the last Endless and Spliced Endless wave only", () => {
    expect(ENDLESS_FINAL_WAVE).toBe(5850);
    for (const mode of [GameModes.ENDLESS, GameModes.SPLICED_ENDLESS]) {
      const gameMode = getGameMode(mode);
      expect(isEndlessFinalTrainerWave(gameMode, 5850)).toBe(true);
      expect(isEndlessFinalWave(gameMode, 5850)).toBe(true);
      for (const wave of [5800, 5849, 5000, 250, 200]) {
        expect(isEndlessFinalTrainerWave(gameMode, wave)).toBe(false);
        expect(isEndlessFinalWave(gameMode, wave)).toBe(false);
      }
    }
    for (const mode of [GameModes.CLASSIC, GameModes.CHALLENGE, GameModes.DAILY]) {
      expect(isEndlessFinalTrainerWave(getGameMode(mode), 5850)).toBe(false);
      expect(isEndlessFinalWave(getGameMode(mode), 5850)).toBe(false);
    }
  });

  it("draws the strongest five measured boss trainers at even odds, the same one for the same run seed", async () => {
    expect([...ENDLESS_FINAL_TRAINER_POOL]).toEqual([
      TrainerType.ROCKET_BOSS_GIOVANNI_2,
      TrainerType.ROSE_2,
      TrainerType.LUSAMINE_2,
      TrainerType.GHETSIS_2,
      TrainerType.CYRUS_2,
    ]);
    await game.runToTitle();
    const counts = new Map<TrainerType, number>();
    const runs = 500;
    for (let i = 0; i < runs; i++) {
      game.scene.setSeed(`final-${i}`);
      const drawn = drawEndlessFinalTrainerType(ENDLESS_FINAL_WAVE);
      expect(ENDLESS_FINAL_TRAINER_POOL).toContain(drawn);
      counts.set(drawn, (counts.get(drawn) ?? 0) + 1);
      // Same seed, same trainer
      game.scene.setSeed(`final-${i}`);
      expect(drawEndlessFinalTrainerType(ENDLESS_FINAL_WAVE)).toBe(drawn);
    }
    for (const type of ENDLESS_FINAL_TRAINER_POOL) {
      // 100 expected each; 60..140 is well over 4 standard deviations
      expect(counts.get(type) ?? 0, TrainerType[type]).toBeGreaterThan(60);
      expect(counts.get(type) ?? 0, TrainerType[type]).toBeLessThan(140);
    }
  });

  it.each([
    { mode: GameModes.ENDLESS, name: "Endless" },
    { mode: GameModes.SPLICED_ENDLESS, name: "Spliced Endless" },
  ])("$name wave 5850 is a single battle against a pool trainer's full party", async ({ mode }) => {
    await startRun(mode, ENDLESS_FINAL_WAVE);
    const battle = game.scene.currentBattle;
    expect(battle.waveIndex).toBe(ENDLESS_FINAL_WAVE);
    expect(battle.battleType).toBe(BattleType.TRAINER);
    expect(battle.double).toBe(false);
    expect(battle.trainer).not.toBeNull();
    expect(ENDLESS_FINAL_TRAINER_POOL).toContain(battle.trainer!.config.trainerType);
    expect(battle.trainer!.variant).toBe(TrainerVariant.DEFAULT);
    expect(battle.mysteryEncounter).toBeUndefined();
    expect(battle.enemyParty).toHaveLength(6);
  });

  it("the trainer drawn is the one the run seed gives", async () => {
    await startRun(GameModes.ENDLESS, ENDLESS_FINAL_WAVE, "final-seeded");
    const met = game.scene.currentBattle.trainer!.config.trainerType;
    game.scene.setSeed("final-seeded");
    game.scene.resetSeed(ENDLESS_FINAL_WAVE);
    expect(drawEndlessFinalTrainerType(ENDLESS_FINAL_WAVE)).toBe(met);
  });

  it("a test's random trainer override still picks the trainer", async () => {
    game.override.randomTrainer({ trainerType: TrainerType.CYNTHIA });
    await startRun(GameModes.ENDLESS, ENDLESS_FINAL_WAVE);
    expect(game.scene.currentBattle.battleType).toBe(BattleType.TRAINER);
    expect(game.scene.currentBattle.trainer!.config.trainerType).toBe(TrainerType.CYNTHIA);
    expect(game.scene.currentBattle.double).toBe(false);
  });

  it("disabled trainer waves and a wild battle type override keep the wild boss", async () => {
    game.override.disableTrainerWaves();
    await startRun(GameModes.ENDLESS, ENDLESS_FINAL_WAVE);
    expect(game.scene.currentBattle.battleType).toBe(BattleType.WILD);
  });

  it("wave 5800 stays the wild END boss", async () => {
    await startRun(GameModes.ENDLESS, 5800);
    expect(game.scene.currentBattle.battleType).toBe(BattleType.WILD);
    expect(game.scene.currentBattle.trainer).toBeNull();
  });

  it("winning it plays the trainer's defeat (money, voucher, victory line) before the run ends", async () => {
    await startRun(GameModes.ENDLESS, ENDLESS_FINAL_WAVE);
    expect(game.scene.currentBattle.battleType).toBe(BattleType.TRAINER);
    const { phaseManager } = game.scene;
    const clear = vi.spyOn(phaseManager, "clearPhaseQueue");
    const unshift = vi.spyOn(phaseManager, "unshiftNew");
    const phase = new BattleEndPhase(true);
    vi.spyOn(phase, "end").mockImplementation(() => {});
    phase.start();
    expect(clear).toHaveBeenCalled();
    // Unshifted last = runs first: TrainerVictoryPhase (which unshifts its own reward phases ahead), then GameOverPhase
    expect(unshift.mock.calls.map(call => call[0])).toEqual(["GameOverPhase", "TrainerVictoryPhase"]);
    expect(unshift.mock.calls[0][1]).toBe(true);
  });

  it("a final-wave battle end that is not a win never plays the trainer's defeat", async () => {
    await startRun(GameModes.ENDLESS, ENDLESS_FINAL_WAVE);
    const unshift = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    const phase = new BattleEndPhase(false);
    vi.spyOn(phase, "end").mockImplementation(() => {});
    phase.start();
    const names = unshift.mock.calls.map(call => call[0]);
    expect(names[0]).toBe("GameOverPhase");
    expect(names).not.toContain("TrainerVictoryPhase");
  });

  it("drawing an enemy buff token with every token at its cap gives none instead of throwing", async () => {
    game.override.disableTrainerWaves();
    await startRun(GameModes.ENDLESS, 5800);
    for (const id of Object.keys(TOKEN_CAPS) as (keyof typeof TOKEN_CAPS)[]) {
      const token = modifierTypes[id]().withIdFromFunc(modifierTypes[id]).newModifier() as EnemyPersistentModifier;
      await game.scene.addEnemyModifier(token, true, true);
      token.stackCount = TOKEN_CAPS[id];
    }
    regenerateModifierPoolThresholds(game.scene.getEnemyParty(), ModifierPoolType.ENEMY_BUFF);
    const tokens = () => game.scene.findModifiers(m => m instanceof EnemyPersistentModifier, false);
    for (const tier of [ModifierTier.COMMON, ModifierTier.GREAT, ModifierTier.ULTRA]) {
      expect(() => getEnemyBuffModifierForWave(tier, tokens())).not.toThrow();
      expect(getEnemyBuffModifierForWave(tier, tokens())).toBeNull();
    }

    // The 50-wave victory's phase draws nothing and leaves every token as it was
    const phase = new AddEnemyBuffModifierPhase();
    vi.spyOn(phase, "end").mockImplementation(() => {});
    expect(() => phase.start()).not.toThrow();
    const after = new Map(tokens().map(m => [m.type.id, m.stackCount]));
    for (const [id, cap] of Object.entries(TOKEN_CAPS)) {
      expect(after.get(id), id).toBe(cap);
    }
  });
});
