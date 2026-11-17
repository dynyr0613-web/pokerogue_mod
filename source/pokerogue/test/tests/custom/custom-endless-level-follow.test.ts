// Local fork (2026-11-13): from Endless battle wave 4000 the enemies' levels follow the player. The user: "4000웨이브
// 정도부턴 레벨 스케일링을 플레이어에게 맞춰보죠, 적의 에이스 포켓몬이 플레이어의 가장 높은 레벨의 포켓몬의 레벨에
// 비례하도록". Every level the normal Endless formulas give (wild `Battle.getLevelForWave`, trainer
// `Trainer.getPartyLevels`, both with S(w), and the Mystery Encounters built on them) is multiplied by
// f = max(1, P / C) ^ 0.5: P the player's highest party level when the battle is made, C the wave's EXP level cap
// (endless-level-scaling.ts). Wave 3999, other modes and a player at or under the cap see the old levels; a reload keeps
// the saved enemy levels.
// Local fork (2026-11-13): 09 명세 1번 "레벨 따라가기 지수 완충": the exponent α = 0.5 (the spec's range 0.5 to 0.6, its
// recommendation 0.5) replaces the 08 rule's f = P / C. Expected values are written out below as sqrt(P / C) and the
// hard-coded levels were computed apart from the game code.
import { Battle } from "#app/battle";
import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import {
  applyEndlessEnemyLevelFactor,
  ENDLESS_PLAYER_LEVEL_FOLLOW_EXPONENT,
  ENDLESS_PLAYER_LEVEL_FOLLOW_MIN_FACTOR,
  ENDLESS_PLAYER_LEVEL_FOLLOW_START_WAVE,
  getEndlessEnemyLevelFactor,
  getEndlessPlayerLevelFollowFactor,
  getHighestPlayerPartyLevel,
  getNaturalMaxExpLevel,
} from "#balance/endless-level-scaling";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { UiMode } from "#enums/ui-mode";
import { Trainer } from "#field/trainer";
import { getEncounterPokemonLevelForWave } from "#mystery-encounters/encounter-pokemon-utils";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import { ENDLESS_FINAL_TRAINER_POOL, ENDLESS_FINAL_WAVE } from "#trainers/endless-final-trainer";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

/** The player's EXP level caps the numbers below are built on (custom-endless-level-scaling.test.ts pins them too) */
const CAP_4000 = 137_332;
const CAP_4001 = 138_110;
const CAP_5000 = 226_396;
const CAP_5850 = 320_222;

/** The follow factor written out apart from the game code: f = max(1, P / C) ^ 0.5, a square root */
function expectedFactor(highestPlayerLevel: number, cap: number): number {
  return Math.sqrt(Math.max(1, highestPlayerLevel / cap));
}

/** One level times the expected factor, rounded (untouched at f = 1) */
function expectedLevel(level: number, highestPlayerLevel: number, cap: number): number {
  const factor = expectedFactor(highestPlayerLevel, cap);
  return factor > 1 ? Math.round(level * factor) : level;
}

describe("Local fork: Endless enemy levels follow the player from wave 4000", () => {
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

  /** Replaces the player's party with one Feebas per level */
  function setPlayerLevels(...levels: number[]): void {
    const party = game.scene.getPlayerParty();
    for (const p of party.splice(0)) {
      p.destroy();
    }
    for (const level of levels) {
      party.push(game.scene.addPlayerPokemon(speciesDataRegistry.getSpecies(SpeciesId.FEEBAS), level));
    }
  }

  /** Sets the game mode and makes a battle on `wave` the way `BattleScene.newBattle` does, then makes it current */
  function makeBattle(mode: GameModes, wave: number, trainer?: Trainer): Battle {
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

  /** `type`'s levels on `wave`, the template read on that wave as in the run (single, default variant, seeded) */
  function trainerLevels(type: TrainerType, wave: number, mode = GameModes.ENDLESS): number[] {
    makeBattle(mode, wave);
    game.scene.setSeed(`follow-${type}`);
    game.scene.resetSeed(wave);
    const trainer = new Trainer(type, TrainerVariant.DEFAULT);
    const levels = makeBattle(mode, wave, trainer).enemyLevels ?? [];
    trainer.destroy();
    return levels;
  }

  /** A wild level on `wave` with every random offset at 0 (the plain Gaussian roll and the boss's +-wave/10) */
  function wildLevelNoOffset(mode: GameModes, wave: number): number {
    const battle = makeBattle(mode, wave);
    vi.spyOn(battle, "randSeedGaussForLevel").mockReturnValue(0);
    const rnd = vi.spyOn(Phaser.Math.RND, "realInRange").mockReturnValue(0);
    const level = battle.getLevelForWave();
    rnd.mockRestore();
    return level;
  }

  /** Starts a run in `mode` on `wave` with starters at `level`, the way the title screen would, to the first command */
  async function startRun(mode: GameModes, wave: number, level: number, seed = "follow"): Promise<void> {
    game.override.startingWave(wave).startingLevel(level).seed(seed);
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(mode);
      game.scene.offsetGym = false;
      const starters = generateStarters(game.scene, [SpeciesId.FEEBAS]);
      game.scene.setSeed(seed);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await game.phaseInterceptor.to("CommandPhase", false);
  }

  it("f = max(1, P / C) ^ 0.5 from Endless battle wave 4000 only; C is the player's EXP cap of that wave", async () => {
    await game.runToTitle();
    expect(ENDLESS_PLAYER_LEVEL_FOLLOW_START_WAVE).toBe(4000);
    expect(ENDLESS_PLAYER_LEVEL_FOLLOW_MIN_FACTOR).toBe(1);
    expect(ENDLESS_PLAYER_LEVEL_FOLLOW_EXPONENT).toBe(0.5);

    // C is the cap `getMaxExpLevel` shows on that wave, in every mode
    for (const mode of [GameModes.CLASSIC, GameModes.CHALLENGE, GameModes.DAILY, GameModes.ENDLESS]) {
      for (const wave of [1, 9, 10, 49, 50, 199, 200, 501, 3999, 4000, 4001, 5000, 5841, 5850]) {
        makeBattle(mode, wave);
        expect(getNaturalMaxExpLevel(game.scene.gameMode, wave), `${GameModes[mode]} ${wave}`).toBe(
          game.scene.getMaxExpLevel(),
        );
      }
    }
    const endless = getGameMode(GameModes.ENDLESS);
    expect([4000, 4001, 5000, 5850].map(w => getNaturalMaxExpLevel(endless, w))).toEqual([
      CAP_4000,
      CAP_4001,
      CAP_5000,
      CAP_5850,
    ]);

    for (const mode of [GameModes.ENDLESS, GameModes.SPLICED_ENDLESS]) {
      const gameMode = getGameMode(mode);
      // Wave 3999: 1 for any P
      expect(getEndlessPlayerLevelFollowFactor(gameMode, 3999, 10_000_000)).toBe(1);
      // At or under the cap: 1
      expect(getEndlessPlayerLevelFollowFactor(gameMode, 4000, 0)).toBe(1);
      expect(getEndlessPlayerLevelFollowFactor(gameMode, 4000, CAP_4000)).toBe(1);
      // Above it: (P / C) ^ 0.5, so 4 x the cap gives 2 (it gave 4 under the 08 rule) and 2 x the cap sqrt(2)
      expect(getEndlessPlayerLevelFollowFactor(gameMode, 4000, 4 * CAP_4000)).toBe(2);
      expect(getEndlessPlayerLevelFollowFactor(gameMode, 4000, 2 * CAP_4000)).toBeCloseTo(Math.SQRT2, 12);
      expect(getEndlessPlayerLevelFollowFactor(gameMode, 5850, 518_760)).toBeCloseTo(Math.sqrt(518_760 / CAP_5850), 12);
    }
    for (const mode of [GameModes.CLASSIC, GameModes.CHALLENGE, GameModes.DAILY]) {
      for (const wave of [50, 200, 4000, 5850]) {
        expect(getEndlessPlayerLevelFollowFactor(getGameMode(mode), wave, 10_000_000)).toBe(1);
      }
    }

    // P is the party's highest level, fainted members included; f reads it from the party
    setPlayerLevels(150_000, 300_000, 200_000);
    game.scene.getPlayerParty()[1].hp = 0;
    expect(getHighestPlayerPartyLevel()).toBe(300_000);
    expect(getEndlessEnemyLevelFactor(endless, 4000)).toBeCloseTo(Math.sqrt(300_000 / CAP_4000), 12);
    expect(getEndlessEnemyLevelFactor(endless, 3999)).toBe(1);
    setPlayerLevels();
    expect(getHighestPlayerPartyLevel()).toBe(0);
    expect(getEndlessEnemyLevelFactor(endless, 4000)).toBe(1);

    // f = 1 leaves a level as it is; above 1 it rounds: 137,329 x sqrt(200,000 / 137,332) = 165,726.4 -> 165,726
    expect(applyEndlessEnemyLevelFactor(137_329, 1)).toBe(137_329);
    expect(applyEndlessEnemyLevelFactor(137_329, 200_000 / CAP_4000)).toBe(199_996);
    expect(applyEndlessEnemyLevelFactor(137_329, Math.sqrt(200_000 / CAP_4000))).toBe(165_726);
  });

  it("wild levels: wave 3999 and a player under the cap unchanged, above it scaled (exact numbers)", async () => {
    await game.runToTitle();

    // Wave 3999 (no boss), offset 0: round(27,587.7) + S(3999) = 27,588 + 104,147, whatever the party
    setPlayerLevels(5);
    expect(wildLevelNoOffset(GameModes.ENDLESS, 3999)).toBe(131_735);
    setPlayerLevels(1_000_000);
    expect(wildLevelNoOffset(GameModes.ENDLESS, 3999)).toBe(131_735);

    // Wave 4001, offset 0: round(27,614.3) + S(4001) = 27,614 + 104,270 = 131,884 at or under the cap (138,110)
    setPlayerLevels(5);
    expect(wildLevelNoOffset(GameModes.ENDLESS, 4001)).toBe(131_884);
    setPlayerLevels(CAP_4001, 100_000);
    expect(wildLevelNoOffset(GameModes.ENDLESS, 4001)).toBe(131_884);
    // Above it: round(131,884 x sqrt(140,000 / 138,110)) = round(132,783.3) = 132,783 and
    // round(131,884 x sqrt(300,001 / 138,110)) = round(194,375.2) = 194,375 (133,689 / 286,477 under the 08 rule)
    setPlayerLevels(140_000);
    expect(wildLevelNoOffset(GameModes.ENDLESS, 4001)).toBe(132_783);
    expect(wildLevelNoOffset(GameModes.ENDLESS, 4001)).toBe(expectedLevel(131_884, 140_000, CAP_4001));
    setPlayerLevels(300_001);
    expect(wildLevelNoOffset(GameModes.ENDLESS, 4001)).toBe(194_375);
    expect(wildLevelNoOffset(GameModes.SPLICED_ENDLESS, 4001)).toBe(194_375);
    expect(wildLevelNoOffset(GameModes.ENDLESS, 4001)).toBe(expectedLevel(131_884, 300_001, CAP_4001));

    // The random roll is scaled with the rest: every level on the wave is round(unscaled x f)
    for (let i = 0; i < 30; i++) {
      setPlayerLevels(5);
      game.scene.setSeed(`wild-${i}`);
      game.scene.resetSeed(4003);
      const unscaled = makeBattle(GameModes.ENDLESS, 4003).enemyLevels![0];
      setPlayerLevels(300_001);
      game.scene.setSeed(`wild-${i}`);
      game.scene.resetSeed(4003);
      const scaled = makeBattle(GameModes.ENDLESS, 4003).enemyLevels![0];
      expect(scaled).toBe(Math.round(unscaled * Math.sqrt(300_001 / CAP_4001)));
    }

    // The wild boss on wave 4000 (a multiple of 250): floor(27,601 x 1.2) + S(4000) = 137,329, rounded up to a
    // multiple of 25 = 137,350 at the cap; above it x f first (165,726 / 202,973), then rounded up: 165,750 / 202,975
    setPlayerLevels(CAP_4000);
    expect(makeBattle(GameModes.ENDLESS, 4000).enemyLevels).toEqual([137_350]);
    setPlayerLevels(200_000);
    expect(makeBattle(GameModes.ENDLESS, 4000).enemyLevels).toEqual([165_750]);
    expect(Math.ceil(expectedLevel(137_329, 200_000, CAP_4000) / 25) * 25).toBe(165_750);
    setPlayerLevels(300_001);
    expect(makeBattle(GameModes.ENDLESS, 4000).enemyLevels).toEqual([202_975]);
    expect(Math.ceil(expectedLevel(137_329, 300_001, CAP_4000) / 25) * 25).toBe(202_975);
    // Mystery Encounters that take the wave's level follow (additive 0 here)
    expect(getEncounterPokemonLevelForWave(0)).toBe(202_975);
    // 4 x the cap gives f = 2 exactly: 274,658 -> 274,675
    setPlayerLevels(4 * CAP_4000);
    expect(makeBattle(GameModes.ENDLESS, 4000).enemyLevels).toEqual([274_675]);
    // Wave 5000: 226,400 at the cap, round(226,397 x sqrt(300,001 / 226,396)) = 260,614 -> 260,625 above it
    setPlayerLevels(CAP_5000);
    expect(makeBattle(GameModes.ENDLESS, 5000).enemyLevels).toEqual([226_400]);
    setPlayerLevels(300_001);
    expect(makeBattle(GameModes.ENDLESS, 5000).enemyLevels).toEqual([260_625]);

    // A boss off the multiples of 250 (wave 4010), offset 0: (floor(27,734.16 x 1.2) + S(4010)) x f, f = 2 at 4 x the cap
    setPlayerLevels(5);
    expect(wildLevelNoOffset(GameModes.ENDLESS, 4010)).toBe(33_280 + 104_826);
    setPlayerLevels(4 * CAP_4001);
    expect(wildLevelNoOffset(GameModes.ENDLESS, 4010)).toBe(2 * (33_280 + 104_826));
  });

  it("trainer levels: every member x the same f, so the ace sits at ~1.007-1.009 x C x f, under P", async () => {
    await game.runToTitle();
    for (const type of ENDLESS_FINAL_TRAINER_POOL) {
      setPlayerLevels(5);
      const unscaled = trainerLevels(type, ENDLESS_FINAL_WAVE);
      setPlayerLevels(CAP_5850);
      expect(trainerLevels(type, ENDLESS_FINAL_WAVE), TrainerType[type]).toEqual(unscaled);
      setPlayerLevels(518_760);
      const scaled = trainerLevels(type, ENDLESS_FINAL_WAVE);
      expect(scaled, TrainerType[type]).toEqual(unscaled.map(level => expectedLevel(level, 518_760, CAP_5850)));
      // The ace: about 1.007 to 1.009 x C before, the same ratio to C x f now, so P / ace = sqrt(P / C) / that ratio
      expect(unscaled.at(-1)! / CAP_5850).toBeGreaterThan(1.005);
      expect(unscaled.at(-1)! / CAP_5850).toBeLessThan(1.01);
      const f = Math.sqrt(518_760 / CAP_5850);
      expect(scaled.at(-1)! / (CAP_5850 * f)).toBeCloseTo(unscaled.at(-1)! / CAP_5850, 5);
      expect(518_760 / scaled.at(-1)!).toBeGreaterThan(1.26);
      // Wave 3999: unchanged for any P
      setPlayerLevels(5);
      const before = trainerLevels(type, 3999);
      setPlayerLevels(10_000_000);
      expect(trainerLevels(type, 3999), TrainerType[type]).toEqual(before);
    }
    // Giovanni 2 at 5850, the template every final trainer has: members 321,373 / 321,544 / 321,544, sub-aces
    // 321,373 x 2 and the ace 322,526 at the cap; P = 518,760 (1.62 x the cap) gives each x sqrt(518,760 / 320,222)
    // = x 1.272793 (x 1.62 under the 08 rule: 520,625 / 520,902 / 522,492)
    setPlayerLevels(CAP_5850);
    expect(trainerLevels(TrainerType.ROCKET_BOSS_GIOVANNI_2, ENDLESS_FINAL_WAVE)).toEqual([
      321_373, 321_544, 321_544, 321_373, 321_373, 322_526,
    ]);
    setPlayerLevels(518_760);
    expect(trainerLevels(TrainerType.ROCKET_BOSS_GIOVANNI_2, ENDLESS_FINAL_WAVE)).toEqual([
      409_041, 409_259, 409_259, 409_041, 409_041, 410_509,
    ]);
    // Wave 4000, P = 1.2 x the cap (164,798): 137,882 / 137,940 / 137,940 / 137,882 / 137,882 / 138,434 x 1.095444
    setPlayerLevels(164_798);
    expect(trainerLevels(TrainerType.ROCKET_BOSS_GIOVANNI_2, 4000)).toEqual([
      151_042, 151_106, 151_106, 151_042, 151_042, 151_647,
    ]);
  });

  it("the 09 spec's wave 5850 players (table 1-3): the final trainers' levels and the player's lead over the ace", async () => {
    await game.runToTitle();
    const endless = getGameMode(GameModes.ENDLESS);
    // The spec's table 1-3 (wave 5850, C = 320,222): f and the lead P / (C x f) = (P / C) ^ 0.5 for its five players
    for (const [p, f] of [
      [320_222, 1],
      [384_256, 1.09543],
      [463_280, 1.202808],
      [521_337, 1.27595],
      [960_666, 1.732051],
    ] as const) {
      const factor = getEndlessPlayerLevelFollowFactor(endless, 5850, p);
      expect(factor, `${p}`).toBeCloseTo(f, 5);
      expect(factor, `${p}`).toBeCloseTo(expectedFactor(p, CAP_5850), 12);
      expect(p / (CAP_5850 * factor), `${p}`).toBeCloseTo(Math.sqrt(p / CAP_5850), 12);
    }
    // f grows with P but always slower than P / C past the cap
    let previous = 1;
    for (const p of [320_223, 330_000, 400_000, 640_444, 1_000_000, 10_000_000]) {
      const factor = getEndlessPlayerLevelFollowFactor(endless, 5850, p);
      expect(factor).toBeGreaterThan(previous);
      expect(factor).toBeLessThan(p / CAP_5850);
      previous = factor;
    }

    // P -> the final-trainer template at 5850 (members, sub-aces, ace), worked out by hand as round(level x sqrt(P / C))
    const table: [number, number[]][] = [
      [320_222, [321_373, 321_544, 321_544, 321_373, 321_373, 322_526]],
      [384_256, [352_042, 352_229, 352_229, 352_042, 352_042, 353_305]],
      [463_280, [386_550, 386_756, 386_756, 386_550, 386_550, 387_937]],
      [521_337, [410_056, 410_274, 410_274, 410_056, 410_056, 411_527]],
      [960_666, [556_634, 556_931, 556_931, 556_634, 556_634, 558_631]],
    ];
    // P / the ace: 0.9929 at the cap (the 08 rule gave 0.9929 for every P), 1.0876 / 1.1942 / 1.2668 / 1.7197 above it
    const leads = [0.99286, 1.0876, 1.19421, 1.26684, 1.71968];
    for (const [i, [p, levels]] of table.entries()) {
      setPlayerLevels(p);
      for (const type of ENDLESS_FINAL_TRAINER_POOL) {
        expect(trainerLevels(type, ENDLESS_FINAL_WAVE), `${TrainerType[type]} ${p}`).toEqual(levels);
      }
      expect(levels).toEqual(table[0][1].map(level => expectedLevel(level, p, CAP_5850)));
      expect(p / levels.at(-1)!, `${p}`).toBeCloseTo(leads[i], 4);
    }
    // The 08 rule (f = P / C) would have put the 521,337 player's ace at round(322,526 x 521,337 / 320,222) = 525,088
    expect(Math.round((322_526 * 521_337) / CAP_5850)).toBe(525_088);
  });

  it("Classic, Challenge and Daily levels never follow the player", async () => {
    await game.runToTitle();
    for (const [mode, waves] of [
      [GameModes.CLASSIC, [10, 150, 199, 200, 4000, 5850]],
      [GameModes.CHALLENGE, [50, 200, 4000]],
      [GameModes.DAILY, [10, 49, 50]],
    ] as const) {
      for (const wave of waves) {
        setPlayerLevels(5);
        const low = [wildLevelNoOffset(mode, wave), ...trainerLevels(TrainerType.CYNTHIA, wave, mode)];
        setPlayerLevels(10_000_000);
        const high = [wildLevelNoOffset(mode, wave), ...trainerLevels(TrainerType.CYNTHIA, wave, mode)];
        expect(high, `${GameModes[mode]} ${wave}`).toEqual(low);
      }
    }
  });

  it("the real wave 5850 final trainer follows a player at 1.62 x the cap", async () => {
    await startRun(GameModes.ENDLESS, ENDLESS_FINAL_WAVE, 518_760);
    const battle = game.scene.currentBattle;
    expect(ENDLESS_FINAL_TRAINER_POOL).toContain(battle.trainer!.config.trainerType);
    const levels = game.scene.getEnemyParty().map(p => p.level);
    expect(levels).toEqual(battle.enemyLevels);
    // Every member between 1.0 x and 1.01 x C x f (f = sqrt(518,760 / 320,222) = 1.272793), so under P; the ace highest
    const f = Math.sqrt(518_760 / CAP_5850);
    for (const level of levels) {
      expect(level / (CAP_5850 * f)).toBeGreaterThan(1);
      expect(level / (CAP_5850 * f)).toBeLessThan(1.01);
      expect(level).toBeLessThan(518_760);
    }
    expect(Math.max(...levels)).toBe(levels.at(-1));
    // The same trainer for a player at the cap: those levels x f exactly
    const type = battle.trainer!.config.trainerType;
    setPlayerLevels(CAP_5850);
    const unscaled = trainerLevels(type, ENDLESS_FINAL_WAVE);
    expect(levels).toEqual(unscaled.map(level => expectedLevel(level, 518_760, CAP_5850)));
  });

  it("a session save and reload keeps the enemy levels rolled for the party the battle was made with", async () => {
    game.override.disableTrainerWaves();
    // The wave-4000 wild boss against a party at 200,000: 165,750 (137,329 x sqrt(200,000 / 137,332) = 165,726,
    // rounded up to a multiple of 25)
    await startRun(GameModes.ENDLESS, 4000, 200_000);
    expect(game.scene.getEnemyParty().map(p => p.level)).toEqual([165_750]);
    const enemyId = game.scene.getEnemyParty()[0].id;

    // The save is edited so the party comes back at 300,001; rolled again, the boss would be 202,975
    const { gameData } = game.scene;
    const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
    const sessionData = gameData.parseSessionData(json);
    sessionData.party[0].level = 300_001;
    game.reload["sessionData"] = sessionData;
    await game.reload.reloadSession();

    expect(game.scene.getPlayerParty()[0].level).toBe(300_001);
    expect(game.scene.getEnemyParty().map(p => [p.id, p.level])).toEqual([[enemyId, 165_750]]);
    expect(game.scene.currentBattle.enemyLevels).toEqual([165_750]);
  });
});
