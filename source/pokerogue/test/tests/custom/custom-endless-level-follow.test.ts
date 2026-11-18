// Local fork (2026-11-13): from Endless battle wave 4000 the enemies' levels follow the player. The user: "4000웨이브
// 정도부턴 레벨 스케일링을 플레이어에게 맞춰보죠, 적의 에이스 포켓몬이 플레이어의 가장 높은 레벨의 포켓몬의 레벨에
// 비례하도록". Every level the normal Endless formulas give (wild `Battle.getLevelForWave`, trainer
// `Trainer.getPartyLevels`, both with S(w), and the Mystery Encounters built on them) is multiplied by a factor f of
// P / C: P the player's highest party level when the battle is made, C the wave's expected level (the EXP level cap
// formula, endless-level-scaling.ts). Other modes see the old levels; a reload keeps the saved enemy levels.
// Local fork (2026-11-13): 09 명세 1번 "레벨 따라가기 지수 완충" made it f = max(1, P / C) ^ 0.5.
// Local fork (2026-11-18): two-sided and from battle wave 1000. The user: "밸런스는 레벨을 따라가는걸 조금더 플레이어
// 상대 유동적으로 바꿔보죠, 초보에게는 조금더 낮고, 고수에게는 좀더 높은 레벨의 상대가 나오도록" and "1000웨이브 이후는
// 레벨캡은 그냥 풉시다". 1 at wave 999 and before.
// Local fork (2026-11-18): option 다 of 11_레벨_따라가기_양방향.md 3-1, chosen 2026-11-18 because the novice models are
// above C (the first 11-18 rule, (P / C) ^ 0.6 at or above C and max(0.8, (P / C) ^ 0.5) under it, gave the novice
// model NE at 1.2 x C foes 1.8% higher than the 3차 rule): f = max(0.8, 0.9637 x (P / C) ^ 0.6) for every P > 0, so
// f = 0.9637 at C, 1 at 1.0636 x C (the normal level curve) and 0.8 from 0.7332 x C down.
// Expected values are written out below and the hard-coded levels were computed apart from the game code.
import { Battle } from "#app/battle";
import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import {
  applyEndlessEnemyLevelFactor,
  ENDLESS_PLAYER_LEVEL_FOLLOW_EXPONENT,
  ENDLESS_PLAYER_LEVEL_FOLLOW_MIN_FACTOR,
  ENDLESS_PLAYER_LEVEL_FOLLOW_NEUTRAL_FACTOR,
  ENDLESS_PLAYER_LEVEL_FOLLOW_NEUTRAL_RATIO,
  ENDLESS_PLAYER_LEVEL_FOLLOW_SCALE,
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

/** The expected levels C the numbers below are built on (custom-endless-level-scaling.test.ts pins them too) */
const CAP_1000 = 4374;
const CAP_1001 = 4495;
const CAP_2000 = 26_897;
const CAP_4000 = 137_332;
const CAP_4001 = 138_110;
const CAP_5000 = 226_396;
const CAP_5850 = 320_222;

/**
 * The whole levels where the factor is about 1 (round(C x 1.0635638522056858), 1.0636 = 0.9637 ^ (-1 / 0.6)): a player
 * there meets the normal level curve (the levels the old rule gave at C)
 */
const NEUTRAL_1000 = 4652;
const NEUTRAL_1001 = 4781;
const NEUTRAL_4000 = 146_061;
const NEUTRAL_4001 = 146_889;
const NEUTRAL_5000 = 240_787;
const NEUTRAL_5850 = 340_577;

/** The follow factor written out apart from the game code: max(0.8, 0.9637 x (P / C) ^ 0.6), 1 for P = 0 */
function expectedFactor(highestPlayerLevel: number, cap: number): number {
  return highestPlayerLevel > 0 ? Math.max(0.8, 0.9637 * (highestPlayerLevel / cap) ** 0.6) : 1;
}

/** One level times the expected factor, rounded (untouched at f = 1) */
function expectedLevel(level: number, highestPlayerLevel: number, cap: number): number {
  const factor = expectedFactor(highestPlayerLevel, cap);
  return factor === 1 ? level : Math.round(level * factor);
}

describe("Local fork: Endless enemy levels follow the player both ways from wave 1000", () => {
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

  it("f = max(0.8, 0.9637 x (P / C) ^ 0.6) for every P > 0 (option 다), from Endless battle wave 1000 only", async () => {
    await game.runToTitle();
    expect(ENDLESS_PLAYER_LEVEL_FOLLOW_START_WAVE).toBe(1000);
    expect(ENDLESS_PLAYER_LEVEL_FOLLOW_EXPONENT).toBe(0.6);
    expect(ENDLESS_PLAYER_LEVEL_FOLLOW_SCALE).toBe(0.9637);
    expect(ENDLESS_PLAYER_LEVEL_FOLLOW_MIN_FACTOR).toBe(0.8);
    expect(ENDLESS_PLAYER_LEVEL_FOLLOW_NEUTRAL_FACTOR).toBe(1);
    // 0.9637 = 1.447 ^ -0.1 to 4 places, so f meets the 3차 rule (max(1, P / C) ^ 0.5) at the middle model EI
    // (P / C = 1.447); f = 1 at P / C = 0.9637 ^ (-1 / 0.6) = 1.0636, the floor 0.8 from (0.8 / 0.9637) ^ (1 / 0.6) =
    // 0.7332 down
    expect(1.447 ** -0.1).toBeCloseTo(0.9637, 4);
    expect(ENDLESS_PLAYER_LEVEL_FOLLOW_NEUTRAL_RATIO).toBeCloseTo(1.0635638522056858, 12);
    for (const [cap, neutral] of [
      [CAP_1000, NEUTRAL_1000],
      [CAP_1001, NEUTRAL_1001],
      [CAP_4000, NEUTRAL_4000],
      [CAP_4001, NEUTRAL_4001],
      [CAP_5000, NEUTRAL_5000],
      [CAP_5850, NEUTRAL_5850],
    ]) {
      expect(Math.round(cap * ENDLESS_PLAYER_LEVEL_FOLLOW_NEUTRAL_RATIO), `${cap}`).toBe(neutral);
    }

    // C is the wave's level cap formula: the enforced cap before Endless wave 1000 and in the other modes, only the
    // expected level (`getWaveLevelCap`) from Endless wave 1000, where the cap is lifted
    for (const mode of [GameModes.CLASSIC, GameModes.CHALLENGE, GameModes.DAILY, GameModes.ENDLESS]) {
      for (const wave of [1, 9, 10, 49, 50, 199, 200, 501, 999, 1000, 3999, 4000, 4001, 5000, 5841, 5850]) {
        makeBattle(mode, wave);
        const cap = getNaturalMaxExpLevel(game.scene.gameMode, wave);
        expect(cap, `${GameModes[mode]} ${wave}`).toBe(game.scene.getWaveLevelCap());
        expect(game.scene.getMaxExpLevel(), `${GameModes[mode]} ${wave}`).toBe(
          mode === GameModes.ENDLESS && wave >= 1000 ? Number.MAX_SAFE_INTEGER : cap,
        );
      }
    }
    const endless = getGameMode(GameModes.ENDLESS);
    expect([999, 1000, 1001, 2000, 4000, 4001, 5000, 5850].map(w => getNaturalMaxExpLevel(endless, w))).toEqual([
      CAP_1000,
      CAP_1000,
      CAP_1001,
      CAP_2000,
      CAP_4000,
      CAP_4001,
      CAP_5000,
      CAP_5850,
    ]);

    for (const mode of [GameModes.ENDLESS, GameModes.SPLICED_ENDLESS]) {
      const gameMode = getGameMode(mode);
      // Wave 999: 1 for any P
      expect(getEndlessPlayerLevelFollowFactor(gameMode, 999, 10_000_000)).toBe(1);
      expect(getEndlessPlayerLevelFollowFactor(gameMode, 999, 5)).toBe(1);
      // No party (P = 0): 1
      expect(getEndlessPlayerLevelFollowFactor(gameMode, 1000, 0)).toBe(1);
      // P exactly at C: 0.9637, foes 3.6% under the normal curve (the 3차 rule and the first 11-18 rule gave 1)
      expect(getEndlessPlayerLevelFollowFactor(gameMode, 1000, CAP_1000)).toBe(0.9637);
      expect(getEndlessPlayerLevelFollowFactor(gameMode, 4000, CAP_4000)).toBe(0.9637);
      expect(getEndlessPlayerLevelFollowFactor(gameMode, 5850, CAP_5850)).toBe(0.9637);
      // 1 at 1.0636 x C
      for (const [wave, cap] of [
        [1000, CAP_1000],
        [4000, CAP_4000],
        [5850, CAP_5850],
      ]) {
        expect(getEndlessPlayerLevelFollowFactor(gameMode, wave, cap * ENDLESS_PLAYER_LEVEL_FOLLOW_NEUTRAL_RATIO)).toBeCloseTo(
          1,
          12,
        );
      }
      // Above it: 0.9637 x (P / C) ^ 0.6, so 2 x C gives 1.4607 and 4 x C 2.2140 (1.5157 / 2.2974 under the first 11-18
      // rule, 1.4142 / 2 under the 3차 rule)
      expect(getEndlessPlayerLevelFollowFactor(gameMode, 1000, 2 * CAP_1000)).toBeCloseTo(1.4606960551460706, 12);
      expect(getEndlessPlayerLevelFollowFactor(gameMode, 4000, 4 * CAP_4000)).toBeCloseTo(2.214001209421285, 12);
      expect(getEndlessPlayerLevelFollowFactor(gameMode, 5850, 518_760)).toBeCloseTo(
        0.9637 * (518_760 / CAP_5850) ** 0.6,
        12,
      );
      // Under C the same formula: 0.81 x C gives 0.8492, and never under 0.8 (reached at 0.7332 x C)
      expect(getEndlessPlayerLevelFollowFactor(gameMode, 1000, 0.81 * CAP_1000)).toBeCloseTo(0.849244749126546, 12);
      expect(getEndlessPlayerLevelFollowFactor(gameMode, 4000, 0.7332412346418793 * CAP_4000)).toBeCloseTo(0.8, 12);
      expect(getEndlessPlayerLevelFollowFactor(gameMode, 4000, 0.7 * CAP_4000)).toBe(0.8);
      expect(getEndlessPlayerLevelFollowFactor(gameMode, 4000, 0.5 * CAP_4000)).toBe(0.8);
      expect(getEndlessPlayerLevelFollowFactor(gameMode, 5850, 1)).toBe(0.8);
    }
    for (const mode of [GameModes.CLASSIC, GameModes.CHALLENGE, GameModes.DAILY]) {
      for (const wave of [50, 200, 1000, 4000, 5850]) {
        expect(getEndlessPlayerLevelFollowFactor(getGameMode(mode), wave, 10_000_000)).toBe(1);
        expect(getEndlessPlayerLevelFollowFactor(getGameMode(mode), wave, 1)).toBe(1);
      }
    }

    // One formula: f never goes down as P grows, has no step at C, and is continuous at the floor; above C it grows
    // slower than P / C
    let previous = 0;
    for (const ratio of [0.01, 0.5, 0.7, 0.7332, 0.75, 0.9, 0.999, 1, 1.001, 1.0636, 1.2, 1.5, 3, 10]) {
      const factor = getEndlessPlayerLevelFollowFactor(endless, 5850, ratio * CAP_5850);
      expect(factor, `${ratio}`).toBeGreaterThanOrEqual(previous);
      expect(factor, `${ratio}`).toBeCloseTo(expectedFactor(ratio * CAP_5850, CAP_5850), 12);
      if (ratio > 1) {
        expect(factor).toBeLessThan(ratio);
      }
      previous = factor;
    }
    expect(getEndlessPlayerLevelFollowFactor(endless, 5850, 0.999_999 * CAP_5850)).toBeCloseTo(0.9637, 5);
    expect(getEndlessPlayerLevelFollowFactor(endless, 5850, 1.000_001 * CAP_5850)).toBeCloseTo(0.9637, 5);
    expect(getEndlessPlayerLevelFollowFactor(endless, 5850, 0.733_240 * CAP_5850)).toBe(0.8);
    expect(getEndlessPlayerLevelFollowFactor(endless, 5850, 0.733_242 * CAP_5850)).toBeCloseTo(0.8, 5);
    expect(getEndlessPlayerLevelFollowFactor(endless, 5850, 0.733_242 * CAP_5850)).toBeGreaterThan(0.8);

    // P is the party's highest level, fainted members included; f reads it from the party
    setPlayerLevels(150_000, 300_000, 200_000);
    game.scene.getPlayerParty()[1].hp = 0;
    expect(getHighestPlayerPartyLevel()).toBe(300_000);
    expect(getEndlessEnemyLevelFactor(endless, 4000)).toBeCloseTo(1.5401093763863383, 12);
    expect(getEndlessEnemyLevelFactor(endless, 1000)).toBeCloseTo(12.181123450166936, 12);
    expect(getEndlessEnemyLevelFactor(endless, 999)).toBe(1);
    setPlayerLevels(5);
    expect(getEndlessEnemyLevelFactor(endless, 1000)).toBe(0.8);
    expect(getEndlessEnemyLevelFactor(endless, 999)).toBe(1);
    setPlayerLevels();
    expect(getHighestPlayerPartyLevel()).toBe(0);
    expect(getEndlessEnemyLevelFactor(endless, 4000)).toBe(1);

    // f = 1 leaves a level as it is; otherwise it rounds: 137,329 x 0.8 = 109,863.2 -> 109,863 and
    // 137,329 x 0.9637 x (200,000 / 137,332) ^ 0.6 = 165,828.5 -> 165,828; never under level 1
    expect(applyEndlessEnemyLevelFactor(137_329, 1)).toBe(137_329);
    expect(applyEndlessEnemyLevelFactor(137_329, 0.8)).toBe(109_863);
    expect(applyEndlessEnemyLevelFactor(137_329, 0.9637 * (200_000 / CAP_4000) ** 0.6)).toBe(165_828);
    expect(applyEndlessEnemyLevelFactor(1, 0.8)).toBe(1);
  });

  it("wild levels: wave 999 unchanged, from wave 1000 lower under 1.0636 x C and higher above it (exact numbers)", async () => {
    await game.runToTitle();

    // Wave 999 (no boss), offset 0: round(2,097.3) + S(999) = 2,097 + 1,842, whatever the party
    setPlayerLevels(5);
    expect(wildLevelNoOffset(GameModes.ENDLESS, 999)).toBe(3939);
    setPlayerLevels(1_000_000);
    expect(wildLevelNoOffset(GameModes.ENDLESS, 999)).toBe(3939);

    // Wave 1001 (C = 4,495, the cap formula of wave 1010), offset 0: round(2,104.7) + S(1001) = 2,105 + 1,858 = 3,963 on
    // the normal curve (P = 4,781 = 1.0636 x C, f = 1.000035 -> 3,963.1 -> 3,963); 0.8 x for a level-5 party (3,170.4
    // -> 3,170), x 0.829363 for 3,500 -> 3,287, x 0.9637 at C -> 3,819, x 1.027273 for 5,000 -> 4,071 and x 1.863008 at
    // 3 x C -> 7,383 (the first 11-18 rule: 3,170 / 3,497 / 3,963 / 4,224 / 7,661)
    for (const [p, level] of [
      [5, 3170],
      [3500, 3287],
      [CAP_1001, 3819],
      [NEUTRAL_1001, 3963],
      [5000, 4071],
      [3 * CAP_1001, 7383],
    ] as const) {
      setPlayerLevels(p);
      expect(wildLevelNoOffset(GameModes.ENDLESS, 1001), `${p}`).toBe(level);
      expect(wildLevelNoOffset(GameModes.SPLICED_ENDLESS, 1001), `${p}`).toBe(level);
      expect(level, `${p}`).toBe(expectedLevel(3963, p, CAP_1001));
    }

    // Wave 4001, offset 0: round(27,614.3) + S(4001) = 27,614 + 104,270 = 131,884 on the normal curve (P = 146,889 =
    // 1.0636 x C); 105,507 (x 0.8) for a level-5 party and for P = 100,000 (0.724 x C, under the floor's 0.7332),
    // 110,875 for 110,000 (x 0.840703), 127,097 at C (138,110, x 0.9637), 128,137 for 140,000 (x 0.971591) and 202,429
    // for 300,001 (x 1.534901; 194,375 under the 3차 rule, 210,054 under the first 11-18 rule)
    for (const [p, level] of [
      [5, 105_507],
      [100_000, 105_507],
      [110_000, 110_875],
      [CAP_4001, 127_097],
      [140_000, 128_137],
      [NEUTRAL_4001, 131_884],
      [300_001, 202_429],
    ] as const) {
      setPlayerLevels(p);
      expect(wildLevelNoOffset(GameModes.ENDLESS, 4001), `${p}`).toBe(level);
      expect(level, `${p}`).toBe(expectedLevel(131_884, p, CAP_4001));
    }

    // The random roll is scaled with the rest: every level on the wave is round(normal x f), both ways (the normal
    // levels read with the player at 1.0636 x C)
    for (let i = 0; i < 30; i++) {
      setPlayerLevels(NEUTRAL_4001);
      game.scene.setSeed(`wild-${i}`);
      game.scene.resetSeed(4003);
      const unscaled = makeBattle(GameModes.ENDLESS, 4003).enemyLevels![0];
      for (const p of [5, CAP_4001, 300_001]) {
        setPlayerLevels(p);
        game.scene.setSeed(`wild-${i}`);
        game.scene.resetSeed(4003);
        const scaled = makeBattle(GameModes.ENDLESS, 4003).enemyLevels![0];
        expect(scaled).toBe(expectedLevel(unscaled, p, CAP_4001));
      }
    }

    // The wild boss on wave 1000 (a multiple of 250): floor(2,101 x 1.2) + S(1000) = 4,371, rounded up to a multiple of
    // 25 = 4,375 on the normal curve (P = 4,652 = 1.0636 x C); x f first, then rounded up: 3,500 for a level-5 party
    // (3,496.8 -> 3,497 -> 3,500), 4,225 at C (4,212.3 -> 4,212 -> 4,225), 6,400 at 2 x C (6,384.7 -> 6,385 -> 6,400)
    setPlayerLevels(5);
    expect(makeBattle(GameModes.ENDLESS, 1000).enemyLevels).toEqual([3500]);
    setPlayerLevels(CAP_1000);
    expect(makeBattle(GameModes.ENDLESS, 1000).enemyLevels).toEqual([4225]);
    setPlayerLevels(NEUTRAL_1000);
    expect(makeBattle(GameModes.ENDLESS, 1000).enemyLevels).toEqual([4375]);
    setPlayerLevels(2 * CAP_1000);
    expect(makeBattle(GameModes.ENDLESS, 1000).enemyLevels).toEqual([6400]);

    // The wild boss on wave 4000: floor(27,601 x 1.2) + S(4000) = 137,329 -> 137,350 on the normal curve; x f first
    // (109,863 / 109,863 / 132,344 / 137,329 / 165,828 / 211,502 / 304,047), then rounded up to a multiple of 25
    for (const [p, level] of [
      [5, 109_875],
      [100_000, 109_875],
      [CAP_4000, 132_350],
      [NEUTRAL_4000, 137_350],
      [200_000, 165_850],
      [300_001, 211_525],
      [4 * CAP_4000, 304_050],
    ] as const) {
      setPlayerLevels(p);
      expect(makeBattle(GameModes.ENDLESS, 4000).enemyLevels, `${p}`).toEqual([level]);
      expect(Math.ceil(expectedLevel(137_329, p, CAP_4000) / 25) * 25, `${p}`).toBe(level);
    }
    // Mystery Encounters that take the wave's level follow (additive 0 here; the last battle made: 4 x C)
    expect(getEncounterPokemonLevelForWave(0)).toBe(304_050);
    // Wave 5000: floor(42,501 x 1.2) + S(5000) = 51,001 + 175,392 = 226,393 -> 226,400 on the normal curve (P = 240,787);
    // x 0.9637 = 218,174.9 -> 218,175 at C, x 1.141023 = 258,319.5 -> 258,325 for P = 300,001 and x 0.8 = 181,114.4 ->
    // 181,125 for a level-5 party
    setPlayerLevels(NEUTRAL_5000);
    expect(makeBattle(GameModes.ENDLESS, 5000).enemyLevels).toEqual([226_400]);
    setPlayerLevels(CAP_5000);
    expect(makeBattle(GameModes.ENDLESS, 5000).enemyLevels).toEqual([218_175]);
    setPlayerLevels(300_001);
    expect(makeBattle(GameModes.ENDLESS, 5000).enemyLevels).toEqual([258_325]);
    setPlayerLevels(5);
    expect(makeBattle(GameModes.ENDLESS, 5000).enemyLevels).toEqual([181_125]);

    // A boss off the multiples of 250 (wave 4010), offset 0: (floor(27,734.16 x 1.2) + S(4010)) x f
    setPlayerLevels(NEUTRAL_4001);
    expect(wildLevelNoOffset(GameModes.ENDLESS, 4010)).toBe(33_280 + 104_826);
    setPlayerLevels(CAP_4001);
    expect(wildLevelNoOffset(GameModes.ENDLESS, 4010)).toBe(133_093);
    setPlayerLevels(5);
    expect(wildLevelNoOffset(GameModes.ENDLESS, 4010)).toBe(110_485);
    setPlayerLevels(4 * CAP_4001);
    expect(wildLevelNoOffset(GameModes.ENDLESS, 4010)).toBe(305_767);
  });

  it("trainer levels: every member x the same f, both ways, so the ace sits at ~1.007-1.009 x C x f", async () => {
    await game.runToTitle();
    const fHigh = 0.9637 * (518_760 / CAP_5850) ** 0.6;
    for (const type of ENDLESS_FINAL_TRAINER_POOL) {
      // The normal curve: the player at 1.0636 x C
      setPlayerLevels(NEUTRAL_5850);
      const unscaled = trainerLevels(type, ENDLESS_FINAL_WAVE);
      setPlayerLevels(518_760);
      const scaled = trainerLevels(type, ENDLESS_FINAL_WAVE);
      expect(scaled, TrainerType[type]).toEqual(unscaled.map(level => expectedLevel(level, 518_760, CAP_5850)));
      setPlayerLevels(CAP_5850);
      const atC = trainerLevels(type, ENDLESS_FINAL_WAVE);
      expect(atC, TrainerType[type]).toEqual(unscaled.map(level => Math.round(level * 0.9637)));
      setPlayerLevels(5);
      const low = trainerLevels(type, ENDLESS_FINAL_WAVE);
      expect(low, TrainerType[type]).toEqual(unscaled.map(level => Math.round(level * 0.8)));
      // The ace: about 1.007 to 1.009 x C on the normal curve, the same ratio to C x f otherwise, so
      // P / ace = (P / C) ^ 0.4 / 0.9637 / that ratio above the floor
      expect(unscaled.at(-1)! / CAP_5850).toBeGreaterThan(1.005);
      expect(unscaled.at(-1)! / CAP_5850).toBeLessThan(1.01);
      expect(scaled.at(-1)! / (CAP_5850 * fHigh)).toBeCloseTo(unscaled.at(-1)! / CAP_5850, 5);
      expect(518_760 / scaled.at(-1)!).toBeGreaterThan(1.24);
      expect(518_760 / scaled.at(-1)!).toBeLessThan(1.26);
      // Wave 999: unchanged for any P
      setPlayerLevels(5);
      const before = trainerLevels(type, 999);
      setPlayerLevels(10_000_000);
      expect(trainerLevels(type, 999), TrainerType[type]).toEqual(before);
    }
    // Giovanni 2 at 5850, the template every final trainer has: members 321,373 / 321,544 / 321,544, sub-aces
    // 321,373 x 2 and the ace 322,526 on the normal curve (P = 340,577 = 1.0636 x C); x 0.9637 at C; P = 518,760
    // (1.62 x C) gives each x 0.9637 x (518,760 / 320,222) ^ 0.6 = x 1.287215 (x 1.335701 under the first 11-18 rule:
    // 429,258 / 429,487 / 430,798; x 1.272793 under the 3차 rule: 409,041 / 409,259 / 410,509), 0.5 x C x 0.8
    setPlayerLevels(NEUTRAL_5850);
    expect(trainerLevels(TrainerType.ROCKET_BOSS_GIOVANNI_2, ENDLESS_FINAL_WAVE)).toEqual([
      321_373, 321_544, 321_544, 321_373, 321_373, 322_526,
    ]);
    setPlayerLevels(CAP_5850);
    expect(trainerLevels(TrainerType.ROCKET_BOSS_GIOVANNI_2, ENDLESS_FINAL_WAVE)).toEqual([
      309_707, 309_872, 309_872, 309_707, 309_707, 310_818,
    ]);
    setPlayerLevels(518_760);
    expect(trainerLevels(TrainerType.ROCKET_BOSS_GIOVANNI_2, ENDLESS_FINAL_WAVE)).toEqual([
      413_676, 413_896, 413_896, 413_676, 413_676, 415_160,
    ]);
    setPlayerLevels(160_111);
    expect(trainerLevels(TrainerType.ROCKET_BOSS_GIOVANNI_2, ENDLESS_FINAL_WAVE)).toEqual([
      257_098, 257_235, 257_235, 257_098, 257_098, 258_021,
    ]);
    // Wave 4000: 137,882 / 137,940 / 137,940 / 137,882 / 137,882 / 138,434 on the normal curve (P = 146,061), x 1.075103
    // at P = 1.2 x C (164,798; x 1.115599 under the first 11-18 rule: 153,821 ... 154,437)
    setPlayerLevels(NEUTRAL_4000);
    expect(trainerLevels(TrainerType.ROCKET_BOSS_GIOVANNI_2, 4000)).toEqual([
      137_882, 137_940, 137_940, 137_882, 137_882, 138_434,
    ]);
    setPlayerLevels(164_798);
    expect(trainerLevels(TrainerType.ROCKET_BOSS_GIOVANNI_2, 4000)).toEqual([
      148_237, 148_300, 148_300, 148_237, 148_237, 148_831,
    ]);
    // Wave 1000 (C = 4,374): 4,414 / 4,404 / 4,404 / 4,414 / 4,414 / 4,456 on the normal curve (P = 4,652), x 0.9637 at
    // C, x 0.8 at 0.5 x C, x 1.863008 at 3 x C (x 1.933182 under the first 11-18 rule: 8,533 ... 8,614)
    setPlayerLevels(NEUTRAL_1000);
    expect(trainerLevels(TrainerType.ROCKET_BOSS_GIOVANNI_2, 1000)).toEqual([4414, 4404, 4404, 4414, 4414, 4456]);
    setPlayerLevels(CAP_1000);
    expect(trainerLevels(TrainerType.ROCKET_BOSS_GIOVANNI_2, 1000)).toEqual([4254, 4244, 4244, 4254, 4254, 4294]);
    setPlayerLevels(2187);
    expect(trainerLevels(TrainerType.ROCKET_BOSS_GIOVANNI_2, 1000)).toEqual([3531, 3523, 3523, 3531, 3531, 3565]);
    setPlayerLevels(3 * CAP_1000);
    expect(trainerLevels(TrainerType.ROCKET_BOSS_GIOVANNI_2, 1000)).toEqual([8223, 8205, 8205, 8223, 8223, 8302]);
  });

  it("the wave 5850 players of the 09 spec and of the 11-18 table: the final trainers' levels and the player's lead", async () => {
    await game.runToTitle();
    const endless = getGameMode(GameModes.ENDLESS);
    // P -> f = max(0.8, 0.9637 x (P / C) ^ 0.6); the lead P / (C x f) = (P / C) ^ 0.4 / 0.9637 above the floor
    for (const [p, f] of [
      [160_111, 0.8],
      [256_178, 0.842938],
      [320_222, 0.9637],
      [NEUTRAL_5850, 1],
      [384_256, 1.075087],
      [463_280, 1.202755],
      [521_337, 1.291048],
      [960_666, 1.863008],
    ] as const) {
      const factor = getEndlessPlayerLevelFollowFactor(endless, 5850, p);
      expect(factor, `${p}`).toBeCloseTo(f, 5);
      expect(factor, `${p}`).toBeCloseTo(expectedFactor(p, CAP_5850), 12);
      if (factor > 0.8) {
        expect(p / (CAP_5850 * factor), `${p}`).toBeCloseTo((p / CAP_5850) ** 0.4 / 0.9637, 12);
      }
    }

    // Why option 다: against the 3차 rule (f = max(1, P / C) ^ 0.5) the novice models get lower foes (NC at C -3.6%, NE
    // at 1.2 x C -1.9%), the middle model EI (1.447 x C) the same and the expert model EE (1.628 x C) higher ones (+1.2%);
    // the first 11-18 rule gave NE +1.8% ("초보에게는 조금더 낮고" broken) and EE +5.0%
    for (const [p, change, first1118] of [
      [320_222, -0.0363, 0],
      [384_256, -0.0186, 0.0184],
      [463_280, 0, 0.0376],
      [521_337, 0.0118, 0.0499],
    ] as const) {
      const old = Math.sqrt(Math.max(1, p / CAP_5850));
      expect(getEndlessPlayerLevelFollowFactor(endless, 5850, p) / old - 1, `${p}`).toBeCloseTo(change, 3);
      expect(Math.max(1, p / CAP_5850) ** 0.6 / old - 1, `${p}`).toBeCloseTo(first1118, 3);
    }

    // P -> the final-trainer template at 5850 (members, sub-aces, ace), worked out by hand as round(level x f) from the
    // normal curve (the first row, P = 340,577 = 1.0636 x C)
    const table: [number, number[]][] = [
      [NEUTRAL_5850, [321_373, 321_544, 321_544, 321_373, 321_373, 322_526]],
      [320_222, [309_707, 309_872, 309_872, 309_707, 309_707, 310_818]],
      [160_111, [257_098, 257_235, 257_235, 257_098, 257_098, 258_021]],
      [256_178, [270_898, 271_042, 271_042, 270_898, 270_898, 271_870]],
      [384_256, [345_504, 345_688, 345_688, 345_504, 345_504, 346_743]],
      [463_280, [386_533, 386_739, 386_739, 386_533, 386_533, 387_920]],
      [521_337, [414_908, 415_129, 415_129, 414_908, 414_908, 416_396]],
      [960_666, [598_720, 599_039, 599_039, 598_720, 598_720, 600_868]],
    ];
    // P / the ace: 1.0560 at 1.0636 x C, 1.0303 at C, 0.6205 / 0.9423 under it, 1.1082 / 1.1943 / 1.2520 / 1.5988 above
    // it (the 3차 rule: 1.0876 / 1.1942 / 1.2668 / 1.7197; the first 11-18 rule: 1.0680 / 1.1509 / 1.2066 / 1.5408)
    const leads = [1.05597, 1.03026, 0.62053, 0.94228, 1.10819, 1.19427, 1.25202, 1.5988];
    for (const [i, [p, levels]] of table.entries()) {
      setPlayerLevels(p);
      for (const type of ENDLESS_FINAL_TRAINER_POOL) {
        expect(trainerLevels(type, ENDLESS_FINAL_WAVE), `${TrainerType[type]} ${p}`).toEqual(levels);
      }
      expect(levels).toEqual(table[0][1].map(level => expectedLevel(level, p, CAP_5850)));
      expect(p / levels.at(-1)!, `${p}`).toBeCloseTo(leads[i], 4);
    }
    // The 3차 rule (f = max(1, P / C) ^ 0.5) put the 384,256 / 463,280 / 521,337 players' aces at 353,305 / 387,937 /
    // 411,527 (now 346,743 / 387,920 / 416,396) and the 160,111 one's at the normal 322,526 (now 258,021)
    expect([384_256, 463_280, 521_337].map(p => Math.round(322_526 * Math.sqrt(p / CAP_5850)))).toEqual([
      353_305, 387_937, 411_527,
    ]);
  });

  it("Classic, Challenge and Daily levels never follow the player", async () => {
    await game.runToTitle();
    for (const [mode, waves] of [
      [GameModes.CLASSIC, [10, 150, 199, 200, 1000, 4000, 5850]],
      [GameModes.CHALLENGE, [50, 200, 1000, 4000]],
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

  it("the real wave 5850 final trainer follows a player at 1.62 x C", async () => {
    await startRun(GameModes.ENDLESS, ENDLESS_FINAL_WAVE, 518_760);
    const battle = game.scene.currentBattle;
    expect(ENDLESS_FINAL_TRAINER_POOL).toContain(battle.trainer!.config.trainerType);
    const levels = game.scene.getEnemyParty().map(p => p.level);
    expect(levels).toEqual(battle.enemyLevels);
    // Every member between 1.0 x and 1.01 x C x f (f = 0.9637 x (518,760 / 320,222) ^ 0.6 = 1.287215), so under P; the
    // ace highest
    const f = 0.9637 * (518_760 / CAP_5850) ** 0.6;
    for (const level of levels) {
      expect(level / (CAP_5850 * f)).toBeGreaterThan(1);
      expect(level / (CAP_5850 * f)).toBeLessThan(1.01);
      expect(level).toBeLessThan(518_760);
    }
    expect(Math.max(...levels)).toBe(levels.at(-1));
    // The same trainer for a player on the normal curve (1.0636 x C): those levels x f exactly
    const type = battle.trainer!.config.trainerType;
    setPlayerLevels(NEUTRAL_5850);
    const unscaled = trainerLevels(type, ENDLESS_FINAL_WAVE);
    expect(levels).toEqual(unscaled.map(level => expectedLevel(level, 518_760, CAP_5850)));
  });

  it("the real wave 1000 boss is 20% lower for a level-5 party (3,500 instead of 4,375)", async () => {
    game.override.disableTrainerWaves();
    await startRun(GameModes.ENDLESS, 1000, 5);
    expect(game.scene.currentBattle.battleType).toBe(BattleType.WILD);
    expect(game.scene.getEnemyParty().map(p => p.level)).toEqual([3500]);
  });

  it("a session save and reload keeps the enemy levels rolled for the party the battle was made with", async () => {
    game.override.disableTrainerWaves();
    // The wave-4000 wild boss against a party at 200,000: 165,850 (137,329 x 0.9637 x (200,000 / 137,332) ^ 0.6 =
    // 165,828.5 -> 165,828, rounded up to a multiple of 25)
    await startRun(GameModes.ENDLESS, 4000, 200_000);
    expect(game.scene.getEnemyParty().map(p => p.level)).toEqual([165_850]);
    const enemyId = game.scene.getEnemyParty()[0].id;

    // The save is edited so the party comes back at 300,001; rolled again, the boss would be 211,525
    const { gameData } = game.scene;
    const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
    const sessionData = gameData.parseSessionData(json);
    sessionData.party[0].level = 300_001;
    game.reload["sessionData"] = sessionData;
    await game.reload.reloadSession();

    expect(game.scene.getPlayerParty()[0].level).toBe(300_001);
    expect(game.scene.getEnemyParty().map(p => [p.id, p.level])).toEqual([[enemyId, 165_850]]);
    expect(game.scene.currentBattle.enemyLevels).toEqual([165_850]);
  });
});
