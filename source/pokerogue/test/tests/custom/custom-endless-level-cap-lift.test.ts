// Local fork (2026-11-18): the player's EXP level cap is lifted from Endless / Spliced Endless battle wave 1000. The
// user: "1000웨이브 이후는 레벨캡은 그냥 풉시다." `BattleScene.getMaxExpLevel` gives no cap there, so EXP keeps levelling a
// Pokémon past the old cap and every user of the cap agrees (who gets EXP, EXP Balance, the red level numbers, the
// summary's EXP bar). The old formula stays as the wave's expected level C (`BattleScene.getWaveLevelCap`): the enemy
// level follow rule divides by it, and the battle score and Dynamax Cannon's "overleveled foe" check read it, so they
// keep their meaning. Before wave 1000 and in Classic, Challenge and Daily nothing changes. The level cap message at the
// wave 999 -> 1000 change of biome says the cap is gone instead of showing 9,007,199,254,740,991.
import { Battle } from "#app/battle";
import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import {
  ENDLESS_EXP_LEVEL_CAP_LIFT_WAVE,
  getNaturalMaxExpLevel,
  isEndlessExpLevelCapLifted,
} from "#balance/endless-level-scaling";
import { allMoves, modifierTypes } from "#data/data-lists";
import { getLevelTotalExp } from "#data/exp";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { UiMode } from "#enums/ui-mode";
import { LevelCapPhase } from "#phases/level-cap-phase";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import { NumberHolder } from "#utils/value-holder";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

/** The wave formula's caps around the lift (custom-endless-level-scaling.test.ts pins them too) */
const CAP_999 = 4374;
const CAP_5850 = 320_222;

describe("Local fork: the EXP level cap is lifted from Endless wave 1000", () => {
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
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH])
      .enemyMoveset(MoveId.SPLASH)
      .mysteryEncounterChance(0);
  });

  afterEach(() => {
    logSpy?.mockRestore();
    logSpy = undefined;
    vi.restoreAllMocks();
  });

  /** Sets the game mode and a current wild battle on `wave` */
  function setBattle(mode: GameModes, wave: number): Battle {
    game.scene.gameMode = getGameMode(mode);
    const battle = new Battle(game.scene.gameMode, {
      waveIndex: wave,
      battleType: BattleType.WILD,
      double: false,
    });
    game.scene.currentBattle = battle;
    return battle;
  }

  /** Replaces the player's party with one Garchomp per level */
  function setPlayerLevels(...levels: number[]) {
    const party = game.scene.getPlayerParty();
    for (const p of party.splice(0)) {
      p.destroy();
    }
    for (const level of levels) {
      const p = game.scene.addPlayerPokemon(speciesDataRegistry.getSpecies(SpeciesId.GARCHOMP), level);
      p.exp = getLevelTotalExp(level, p.species.growthRate);
      party.push(p);
    }
    return party;
  }

  it("no cap from Endless / Spliced Endless battle wave 1000; the old caps before it and in the other modes", async () => {
    await game.runToTitle();
    expect(ENDLESS_EXP_LEVEL_CAP_LIFT_WAVE).toBe(1000);
    for (const mode of [GameModes.ENDLESS, GameModes.SPLICED_ENDLESS]) {
      const gameMode = getGameMode(mode);
      for (const wave of [1, 200, 500, 990, 991, 999]) {
        setBattle(mode, wave);
        expect(isEndlessExpLevelCapLifted(gameMode, wave), `${GameModes[mode]} ${wave}`).toBe(false);
        expect(game.scene.getMaxExpLevel(), `${GameModes[mode]} ${wave}`).toBe(getNaturalMaxExpLevel(gameMode, wave));
        expect(game.scene.getWaveLevelCap(), `${GameModes[mode]} ${wave}`).toBe(getNaturalMaxExpLevel(gameMode, wave));
      }
      // 991-999 round up to wave 1000's formula: the last enforced cap is 4,374
      setBattle(mode, 999);
      expect(game.scene.getMaxExpLevel()).toBe(CAP_999);
      for (const wave of [1000, 1001, 2000, 4000, 5849, 5850, 6000]) {
        setBattle(mode, wave);
        expect(isEndlessExpLevelCapLifted(gameMode, wave), `${GameModes[mode]} ${wave}`).toBe(true);
        expect(game.scene.getMaxExpLevel(), `${GameModes[mode]} ${wave}`).toBe(Number.MAX_SAFE_INTEGER);
        // The formula stays as the expected level C
        expect(game.scene.getWaveLevelCap(), `${GameModes[mode]} ${wave}`).toBe(getNaturalMaxExpLevel(gameMode, wave));
      }
      setBattle(mode, 5850);
      expect(game.scene.getWaveLevelCap()).toBe(CAP_5850);
    }
    for (const [mode, waves] of [
      [GameModes.CLASSIC, [1, 200, 999, 1000, 5850]],
      [GameModes.CHALLENGE, [1, 200, 1000]],
      [GameModes.DAILY, [1, 50]],
    ] as const) {
      for (const wave of waves) {
        setBattle(mode, wave);
        expect(isEndlessExpLevelCapLifted(getGameMode(mode), wave)).toBe(false);
        expect(game.scene.getMaxExpLevel(), `${GameModes[mode]} ${wave}`).toBe(game.scene.getWaveLevelCap());
        expect(game.scene.getMaxExpLevel(), `${GameModes[mode]} ${wave}`).toBeLessThan(Number.MAX_SAFE_INTEGER);
      }
    }
    // Classic's formula on wave 5850 (no S(w)): 69,222
    setBattle(GameModes.CLASSIC, 5850);
    expect(game.scene.getMaxExpLevel()).toBe(69_222);
  });

  it("the test overrides still win over the lift", async () => {
    game.override.levelCap(100);
    await game.runToTitle();
    setBattle(GameModes.ENDLESS, 5850);
    expect(game.scene.getMaxExpLevel()).toBe(100);
    expect(game.scene.getWaveLevelCap()).toBe(100);
    game.override.levelCap(-1);
    expect(game.scene.getWaveLevelCap()).toBe(Number.MAX_SAFE_INTEGER);
    setBattle(GameModes.ENDLESS, 500);
    expect(game.scene.getMaxExpLevel()).toBe(Number.MAX_SAFE_INTEGER);
    // ignoreLevelCap (Rare Candy, Candy Pile) is unbounded as before
    game.override.levelCap(0);
    expect(game.scene.getMaxExpLevel(true)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("battle EXP reaches the members above the old cap from wave 1000 (EXP Balance counts them too)", async () => {
    await game.runToTitle();
    const created: [string, number, number][] = [];
    const realCreate = game.scene.phaseManager.create.bind(game.scene.phaseManager);
    vi.spyOn(game.scene.phaseManager, "create").mockImplementation(((name: string, ...args: any[]) => {
      if (name === "ExpPhase" || name === "ShowPartyExpBarPhase") {
        created.push([name, args[0], args[1]]);
      }
      return (realCreate as any)(name, ...args);
    }) as any);

    // Wave 999: the level-5,000 Garchomp is over the cap (4,374) and gets nothing; the level-100 one gets its share
    setBattle(GameModes.ENDLESS, 999);
    let party = setPlayerLevels(5000, 100);
    game.scene.applyPartyExp(10_000, false, false, new Set(party.map(p => p.id)));
    expect(created.map(([, index, exp]) => [index, exp])).toEqual([[1, 5000]]);

    // Wave 1000: both share it
    created.splice(0);
    setBattle(GameModes.ENDLESS, 1000);
    party = setPlayerLevels(5000, 100);
    game.scene.applyPartyExp(10_000, false, false, new Set(party.map(p => p.id)));
    expect(created.map(([, index, exp]) => [index, exp])).toEqual([
      [0, 5000],
      [1, 5000],
    ]);
    game.scene.phaseManager.clearPhaseQueue();

    // EXP Balance (균형학습장치) x1: the members under the cap are averaged (applyPartyExp's `medianLevel` is the floored
    // mean level of the EXP members), the ones at or below it share the total, and each member moves 20% of the way
    // from its own share to that split
    game.scene.addModifier(modifierTypes.EXP_BALANCE().withIdFromFunc(modifierTypes.EXP_BALANCE).newModifier()!);
    // Wave 999: only the level-100 one is under the cap, so it is alone in the average and keeps its 5,000
    created.splice(0);
    setBattle(GameModes.ENDLESS, 999);
    party = setPlayerLevels(5000, 100);
    game.scene.applyPartyExp(10_000, false, false, new Set(party.map(p => p.id)));
    expect(created.map(([, index, exp]) => [index, exp])).toEqual([[1, 5000]]);
    game.scene.phaseManager.clearPhaseQueue();
    // Wave 1000: the level-5,000 one counts too (average 2,550), only the level-100 one is at or below it and gets the
    // whole 10,000 as its split: 5,000 -> 5,000 + 0.2 x (10,000 - 5,000) = 6,000, the other 5,000 - 0.2 x 5,000 = 4,000
    created.splice(0);
    setBattle(GameModes.ENDLESS, 1000);
    party = setPlayerLevels(5000, 100);
    game.scene.applyPartyExp(10_000, false, false, new Set(party.map(p => p.id)));
    expect(created.map(([, index, exp]) => [index, exp])).toEqual([
      [0, 4000],
      [1, 6000],
    ]);
    game.scene.phaseManager.clearPhaseQueue();

    // A level-400,000 Garchomp levels from EXP on wave 5850: two levels' worth from 400,000 gives 400,002
    setBattle(GameModes.ENDLESS, 5850);
    const [ace] = setPlayerLevels(400_000);
    const rate = ace.species.growthRate;
    ace.addExp(getLevelTotalExp(400_002, rate) - getLevelTotalExp(400_000, rate));
    expect(ace.level).toBe(400_002);
    expect(ace.exp).toBe(getLevelTotalExp(400_002, rate));
  });

  it("the battle score and Dynamax Cannon still measure against the expected level C past wave 1000", async () => {
    await game.runToTitle();
    setBattle(GameModes.ENDLESS, 5850);
    const [user] = setPlayerLevels(CAP_5850);
    const species = speciesDataRegistry.getSpecies(SpeciesId.MAGIKARP);

    // Score: base EXP x (enemy level / C) x the IV factor (186 / 93 x 0.2 + 0.8 = 1.2 for perfect IVs), as before the
    // lift (not / 9,007,199,254,740,991, which would give 1 point)
    const enemy = game.scene.addEnemyPokemon(species, CAP_5850, TrainerSlot.NONE);
    enemy.ivs = [31, 31, 31, 31, 31, 31];
    game.scene.currentBattle.battleScore = 0;
    game.scene.addFaintedEnemyScore(enemy);
    const baseExp = enemy.getSpeciesForm().getBaseExp();
    expect(game.scene.currentBattle.battleScore).toBe(
      Math.ceil(baseExp * (CAP_5850 / CAP_5850) * ((186 / 93) * 0.2 + 0.8)),
    );
    expect(game.scene.currentBattle.battleScore).toBeGreaterThan(baseExp);

    // Dynamax Cannon: 100 against C, x 1.5 at 2.5% over it, x 2 from 5% over it (same as under the cap)
    const cannon = allMoves[MoveId.DYNAMAX_CANNON];
    const attr = cannon.getAttrs("MovePowerMultiplierAttr")[0];
    for (const [level, power] of [
      [CAP_5850, 100],
      [CAP_5850 + Math.round(CAP_5850 * 0.025), 150],
      [Math.ceil(CAP_5850 * 1.05), 200],
      [CAP_5850 * 3, 200],
    ] as const) {
      enemy.level = level;
      const holder = new NumberHolder(100);
      attr.apply(user, enemy, cannon, [holder]);
      expect(holder.value, `${level}`).toBeCloseTo(power, 0);
    }
    enemy.destroy();
  });

  it("the level cap message says the cap is gone on the lifted waves, and shows the number before", async () => {
    await game.runToTitle();
    vi.spyOn(game.scene.ui, "setMode").mockResolvedValue(undefined as never);
    const shown: string[] = [];
    vi.spyOn(game.scene.ui, "showText").mockImplementation(((text: string) => {
      shown.push(text);
    }) as any);

    setBattle(GameModes.ENDLESS, 1000);
    new LevelCapPhase().start();
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0]).toBe(i18next.t("battle:levelCapLifted"));
    expect(shown[0]).not.toContain(String(Number.MAX_SAFE_INTEGER));

    setBattle(GameModes.ENDLESS, 999);
    new LevelCapPhase().start();
    await vi.waitFor(() => expect(shown).toHaveLength(2));
    expect(shown[1]).toBe(i18next.t("battle:levelCapUp", { levelCap: CAP_999 }));
  });

  it("a real run: winning wave 999 lifts the cap on wave 1000 with the message, and the level numbers stop being red", async () => {
    const seed = "cap-lift";
    game.override.startingWave(999).startingLevel(5000).seed(seed).disableTrainerWaves();
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
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await game.phaseInterceptor.to("CommandPhase", false);
    expect(game.scene.currentBattle.waveIndex).toBe(999);
    expect(game.scene.getMaxExpLevel()).toBe(CAP_999);
    const player = game.scene.getPlayerParty()[0];
    expect(player.level).toBe(5000);

    game.move.select(MoveId.SPLASH);
    await game.doKillOpponents();
    await game.toNextWave();
    expect(game.scene.currentBattle.waveIndex).toBe(1000);
    expect(game.phaseInterceptor.phaseLog).toContain("NewBiomeEncounterPhase");
    expect(game.phaseInterceptor.phaseLog).toContain("LevelCapPhase");
    expect(game.scene.getMaxExpLevel()).toBe(Number.MAX_SAFE_INTEGER);
    expect(game.textInterceptor.logs).toContain(i18next.t("battle:levelCapLifted"));
    // Nothing is over the cap any more (the party screen and the battle info read this)
    expect(player.level < game.scene.getMaxExpLevel()).toBe(true);
  });
});
