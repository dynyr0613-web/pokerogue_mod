// Local fork (2026-11-13): boss HP bars for the Endless boss trainers past battle wave 200, with the max HP raised to
// match (endless-boss-bars.ts; 08 명세 5번, 보정 B). The user chose the HP correction over the cap on bars broken per
// hit: "보스의 원턴킬 방지로는 보스 실드 파괴 갯수 제한보단 2번째인 hp 보정이 더 좋아보이네요". Later the same day the
// bars became proportional to a wild boss's on the wave: "보스 체력바가 제가알기로 5850웨이브 기준 27개인가 되던걸로
// 기억하는데, 보스 체력바는 그냥 그 웨이브에서 보스가 지니는 보스 체력바 수랑 비례하게 합시다" (ace B, the two before it
// round(B x 0.7), the rest round(B x 0.4), B = the wild boss bars of that Pokémon on that wave).
import { Battle } from "#app/battle";
import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { rollTrainerBattleForm } from "#data/enemy-battle-forms";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { UiMode } from "#enums/ui-mode";
import type { EnemyPokemon } from "#field/pokemon";
import { Trainer } from "#field/trainer";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import {
  applyEndlessBossHpCorrection,
  applyEndlessTrainerBossBars,
  ENDLESS_BOSS_BAR_TENTHS,
  ENDLESS_BOSS_BARS_AFTER_WAVE,
  ENDLESS_BOSS_HP_PER_EXTRA_BAR,
  ENDLESS_BOSS_MIN_BARS,
  ENDLESS_BOSS_SUB_ACE_COUNT,
  type EndlessBossBarRole,
  getEndlessBossBarPlan,
  getEndlessBossBarPosition,
  getEndlessBossBarRole,
  getEndlessBossBarsForRole,
  getEndlessBossHpMultiplier,
  getEndlessWildBossBars,
  isEndlessBossBarBattle,
} from "#trainers/endless-boss-bars";
import { ENDLESS_FINAL_TRAINER_POOL, ENDLESS_FINAL_WAVE } from "#trainers/endless-final-trainer";
import { trainerConfigs } from "#trainers/trainer-config";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

/** The waves the rule's numbers are checked on: unchanged (150), the first changed one (201), 1000 and the final one */
const WAVES = [150, 201, 1000, ENDLESS_FINAL_WAVE] as const;

/**
 * The bars the real 5850 final trainer of the seed "boss-bars" (Cyrus, ace Dialga, BST 680) ends up with: its members'
 * own wild-boss bars are 26 (27 for Dialga's 670+); the ace B, the two before it round(B x 0.7), the rest round(B x 0.4)
 */
const FINAL_TRAINER_BARS = [10, 10, 10, 18, 18, 27];

/** One member before and after the rule */
interface Snapshot {
  readonly bars: number;
  readonly maxHp: number;
  /** The bars a wild boss of it gets on the wave, written out from BattleScene.getEncounterBossSegments */
  readonly wildBars: number;
}

/**
 * The bars a wild boss of `p` gets on `wave`, the engine's count written out (getEncounterBossSegments with forceBoss):
 * 2, +1 from level 100, +1 for a base stat total of 670 or more, +1 every 250 waves
 */
const wildBossBars = (p: EnemyPokemon, wave: number): number =>
  2 + (p.level >= 100 ? 1 : 0) + (p.species.baseTotal >= 670 ? 1 : 0) + Math.floor(wave / 250);

const snapshot = (p: EnemyPokemon, wave: number): Snapshot => ({
  bars: p.bossSegments ?? 0,
  maxHp: p.getMaxHp(),
  wildBars: wildBossBars(p, wave),
});

/** The bars of `role` from its wild-boss bars `wild`, as the user's rule states them: B / round(0.7 B) / round(0.4 B) */
function roleBars(role: EndlessBossBarRole, wild: number): number {
  const share = { ace: 10, subAce: 7, member: 4 }[role];
  return Math.max(1, Math.round((wild * share) / 10));
}

/** The bars `role` should end with on `wave` from `own` (0 = no boss bars) and its wild-boss bars */
function expectedBars(role: EndlessBossBarRole, wave: number, own: number, wild: number): number {
  if (wave <= 200) {
    return own;
  }
  const bars = Math.max(own || 1, roleBars(role, wild));
  return bars >= 2 ? bars : own;
}

/** The roles of a single trainer's party of `size`, first to last */
const singleRoles = (size: number): EndlessBossBarRole[] =>
  Array.from({ length: size }, (_, i) => {
    const fromEnd = size - 1 - i;
    if (fromEnd === 0) {
      return "ace";
    }
    return fromEnd <= 2 ? "subAce" : "member";
  });

describe("Local fork: Endless boss-trainer boss bars and HP correction (08 명세 5번, 보정 B)", () => {
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

  /** Starts a run in `mode` on `wave` the way the title screen would, and plays to the first command */
  async function startRun(mode: GameModes, wave: number, seed = "boss-bars"): Promise<void> {
    game.override.startingWave(wave).seed(seed);
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

  /** A wild run to stand on while trainer battles are built by hand */
  async function startQuietRun(mode: GameModes, wave: number): Promise<void> {
    game.override.disableTrainerWaves();
    await startRun(mode, wave);
  }

  /** Builds `type`'s battle on `wave` as `BattleScene.newBattle` + `EncounterPhase` do (no items), before the rule */
  function buildTrainerBattle(type: TrainerType, wave: number, variant = TrainerVariant.DEFAULT, seed = "bars") {
    const { scene } = game;
    scene.setSeed(seed);
    scene.resetSeed(wave);
    const trainer = new Trainer(type, variant);
    const battle = new Battle(scene.gameMode, {
      waveIndex: wave,
      battleType: BattleType.TRAINER,
      trainer,
      double: variant === TrainerVariant.DOUBLE,
    });
    scene.currentBattle = battle;
    for (let e = 0; e < (battle.enemyLevels?.length ?? 0); e++) {
      battle.enemyParty[e] = trainer.genPartyMember(e);
    }
    rollTrainerBattleForm(battle.enemyParty);
    // A trainer's Pokémon gets its IVs after its first stats (EnemyPokemon's constructor) and the game works its stats
    // out again when its items come; here that is done before the "before" snapshot, so the HP is compared like for like
    for (const p of battle.enemyParty) {
      p.calculateStats();
    }
    return { trainer, battle, party: battle.enemyParty };
  }

  function cleanUp({ trainer, battle }: { trainer: Trainer; battle: Battle }): void {
    for (const p of battle.enemyParty) {
      p.destroy();
    }
    trainer.destroy();
  }

  /**
   * Checks one member against the rule: its bars, the stored bars, the HP correction (exact, from its max HP before)
   * and the passive; `applied` is whether the battle is one the rule covers
   */
  function expectMember(p: EnemyPokemon, before: Snapshot, bars: number, applied: boolean, label: string): void {
    if (!applied || bars < 2) {
      expect([p.bossSegments ?? 0, p.forkBossHpBars, p.getMaxHp()], label).toEqual([
        before.bars,
        undefined,
        before.maxHp,
      ]);
      return;
    }
    expect(p.bossSegments, label).toBe(bars);
    expect(p.bossSegmentIndex, label).toBe(bars - 1);
    expect(p.forkBossHpBars, label).toBe(bars);
    expect(p.getMaxHp(), label).toBe(Math.floor(before.maxHp * (1 + 0.25 * (bars - 1))));
    expect(p.hp, label).toBe(p.getMaxHp());
    expect(p.isBoss(), label).toBe(true);
    // A boss has its passive on, except on the Endless Eternatus waves (every 250th: Pokemon.hasPassive), where no trainer
    // stands in play (wave 1000 is built here by hand only for the bar numbers)
    const { gameMode, currentBattle } = game.scene;
    const eternatusWave =
      gameMode.isEndlessMinorBoss(currentBattle.waveIndex) || gameMode.isEndlessMajorBoss(currentBattle.waveIndex);
    expect(p.hasPassive(), label).toBe(!eternatusWave);
  }

  it("states the rule's numbers: bars by position from the end, proportional to the wild boss bars, HP per bar", () => {
    expect(ENDLESS_BOSS_BARS_AFTER_WAVE).toBe(200);
    expect(ENDLESS_BOSS_SUB_ACE_COUNT).toBe(2);
    expect(ENDLESS_BOSS_HP_PER_EXTRA_BAR).toBe(0.25);
    expect(ENDLESS_BOSS_MIN_BARS).toBe(1);
    expect(ENDLESS_BOSS_BAR_TENTHS).toEqual({ ace: 10, subAce: 7, member: 4 });
    // Single party of 6: the last is the ace, the two before it sub-aces
    expect([0, 1, 2, 3, 4, 5].map(i => getEndlessBossBarRole(getEndlessBossBarPosition(i, 6, false)))).toEqual(
      singleRoles(6),
    );
    // A pair's party of 6 (even indexes the trainer's, odd the partner's): each half has its own ace
    expect([0, 1, 2, 3, 4, 5].map(i => getEndlessBossBarRole(getEndlessBossBarPosition(i, 6, true)))).toEqual([
      "subAce",
      "subAce",
      "subAce",
      "subAce",
      "ace",
      "ace",
    ]);
    expect([0, 1, 2, 3, 4].map(i => getEndlessBossBarRole(getEndlessBossBarPosition(i, 5, true)))).toEqual([
      "subAce",
      "subAce",
      "subAce",
      "ace",
      "ace",
    ]);
    // [member, sub-ace, ace] from the wild boss bars B: round(0.4 B), round(0.7 B), B, never under 1
    const bars = (wild: number) => (["member", "subAce", "ace"] as const).map(r => getEndlessBossBarsForRole(r, wild));
    expect(bars(1)).toEqual([1, 1, 1]);
    expect(bars(2)).toEqual([1, 1, 2]);
    expect(bars(3)).toEqual([1, 2, 3]);
    expect(bars(4)).toEqual([2, 3, 4]);
    // x.5 rounds up, exactly (45 x 0.7 is 31.499... in floating point)
    expect(bars(5)).toEqual([2, 4, 5]);
    expect(bars(45)).toEqual([18, 32, 45]);
    // Wave 5850: 26, or 27 for a base stat total of 670 or more
    expect(bars(26)).toEqual([10, 18, 26]);
    expect(bars(27)).toEqual([11, 19, 27]);
    for (let wild = 1; wild <= 60; wild++) {
      expect(bars(wild)).toEqual([roleBars("member", wild), roleBars("subAce", wild), roleBars("ace", wild)]);
    }
    // 보정 B: 1 + 0.25 x (bars - 1), nothing under 2 bars
    expect([undefined, 0, 1, 2, 3, 4, 10, 11, 18, 19, 26, 27].map(getEndlessBossHpMultiplier)).toEqual([
      1, 1, 1, 1.25, 1.5, 1.75, 3.25, 3.5, 5.25, 5.5, 7.25, 7.5,
    ]);
  });

  it("B is the engine's wild boss bar count: 2, +1 from level 100, +1 for BST 670+, +1 every 250 waves, never 0", async () => {
    await startQuietRun(GameModes.ENDLESS, 201);
    const { scene } = game;
    const rhyperior = speciesDataRegistry.getSpecies(SpeciesId.RHYPERIOR); // BST 535
    const rayquaza = speciesDataRegistry.getSpecies(SpeciesId.RAYQUAZA); // BST 680
    expect([rhyperior.baseTotal < 670, rayquaza.baseTotal >= 670]).toEqual([true, true]);
    const segs = (wave: number, level: number, species = rhyperior) =>
      scene.getEncounterBossSegments(wave, level, species, true);
    // Steps on the 250-multiples (each of them an Endless Eternatus wave, so no trainer battle stands on one)
    expect([201, 249, 250, 251, 499, 500].map(w => segs(w, 300))).toEqual([3, 3, 4, 4, 4, 5]);
    expect([segs(ENDLESS_FINAL_WAVE, 300), segs(ENDLESS_FINAL_WAVE, 300, rayquaza)]).toEqual([26, 27]);
    expect(segs(ENDLESS_FINAL_WAVE, 99)).toBe(25);
    // Forced (the trainer path), it is never 0, whatever the wave, so a trainer member always has a B of 2 or more
    for (let w = 201; w <= ENDLESS_FINAL_WAVE; w += 37) {
      expect(segs(w, 50), `wave ${w}`).toBeGreaterThanOrEqual(2);
    }
    // getEndlessWildBossBars reads the member's own level and species
    const built = buildTrainerBattle(TrainerType.ROCKET_BOSS_GIOVANNI_2, ENDLESS_FINAL_WAVE);
    for (const p of built.party) {
      expect(getEndlessWildBossBars(p, ENDLESS_FINAL_WAVE), p.name).toBe(wildBossBars(p, ENDLESS_FINAL_WAVE));
      expect(getEndlessWildBossBars(p, ENDLESS_FINAL_WAVE), p.name).toBe(
        scene.getEncounterBossSegments(ENDLESS_FINAL_WAVE, p.level, p.species, true),
      );
    }
    expect(getEndlessBossBarPlan(built.party, ENDLESS_FINAL_WAVE, false).map(e => e.wildBars)).toEqual(
      built.party.map(p => wildBossBars(p, ENDLESS_FINAL_WAVE)),
    );
    cleanUp(built);
  });

  it.each([
    { type: TrainerType.BROCK, what: "a gym leader" },
    { type: TrainerType.VOLO, what: "a fork named trainer" },
    { type: TrainerType.ROCKET_BOSS_GIOVANNI_2, what: "a 5850 final trainer" },
  ])("gives $what's party its bars and exact HP on waves 150 (none), 201, 1000 and 5850", async ({ type }) => {
    await startQuietRun(GameModes.ENDLESS, 201);
    expect(trainerConfigs[type].isBoss).toBe(true);
    for (const wave of WAVES) {
      const built = buildTrainerBattle(type, wave);
      const { battle, party } = built;
      const before = party.map(p => snapshot(p, wave));
      expect(isEndlessBossBarBattle(battle)).toBe(wave > 200);
      applyEndlessTrainerBossBars(battle);
      const roles = singleRoles(party.length);
      const ends = party.map((p, i) => {
        const bars = expectedBars(roles[i], wave, before[i].bars, before[i].wildBars);
        expectMember(p, before[i], bars, wave > 200, `${TrainerType[type]} wave ${wave} member ${i} (${roles[i]})`);
        return p.bossSegments ?? 0;
      });
      process.stdout.write(
        `[boss-bars] ${TrainerType[type]} wave ${wave}: levels ${JSON.stringify(party.map(p => p.level))}, wild B ${JSON.stringify(before.map(b => b.wildBars))}, bars ${JSON.stringify(before.map(b => b.bars))} -> ${JSON.stringify(ends)}, max HP ${JSON.stringify(before.map(b => b.maxHp))} -> ${JSON.stringify(party.map(p => p.getMaxHp()))}\n`,
      );
      if (wave === ENDLESS_FINAL_WAVE) {
        // Every member is past level 100, so B is 26, or 27 for BST 670+; the ace has all of it
        expect(
          before.every(b => b.wildBars === 26 || b.wildBars === 27),
          JSON.stringify(before),
        ).toBe(true);
        expect(ends.at(-1)).toBe(before.at(-1)!.wildBars);
      }
      if (wave <= 200) {
        expect(party.every(p => p.forkBossHpBars == null)).toBe(true);
      }
      // Applying again changes nothing (the stored bars, not the HP, are the source)
      const after = party.map(p => snapshot(p, wave));
      applyEndlessTrainerBossBars(battle);
      expect(party.map(p => snapshot(p, wave))).toEqual(after);
      cleanUp(built);
    }
  });

  it("keeps a member's own bars when the config gives more than the rule (evil leader's 2 bars at wave 201)", async () => {
    await startQuietRun(GameModes.ENDLESS, 201);
    const built = buildTrainerBattle(TrainerType.ROCKET_BOSS_GIOVANNI_2, 201);
    const before = built.party.map(p => snapshot(p, 201));
    // Its first member (Rhyperior, BST 535) has the config's 2 bars; the rule gives a front member round(3 x 0.4) = 1
    expect(built.party[0].species.speciesId).toBe(SpeciesId.RHYPERIOR);
    expect([before[0].bars, before[0].wildBars, roleBars("member", before[0].wildBars)]).toEqual([2, 3, 1]);
    applyEndlessTrainerBossBars(built.battle);
    const first = built.party[0];
    expect([first.bossSegments, first.forkBossHpBars, first.getMaxHp()]).toEqual([
      2,
      2,
      Math.floor(before[0].maxHp * 1.25),
    ]);
    cleanUp(built);
  });

  it("gives each partner of a pair (Tate & Liza) its own ace and sub-aces", async () => {
    await startQuietRun(GameModes.ENDLESS, 201);
    const built = buildTrainerBattle(TrainerType.TATE, ENDLESS_FINAL_WAVE, TrainerVariant.DOUBLE);
    const { party } = built;
    expect(built.trainer.isDouble()).toBe(true);
    const before = party.map(p => snapshot(p, ENDLESS_FINAL_WAVE));
    applyEndlessTrainerBossBars(built.battle);
    party.forEach((p, i) => {
      const role = getEndlessBossBarRole(Math.floor((party.length - 1 - i) / 2));
      const bars = expectedBars(role, ENDLESS_FINAL_WAVE, before[i].bars, before[i].wildBars);
      expectMember(p, before[i], bars, true, `TATE member ${i} (${role})`);
    });
    // The last two are the two aces, each with its own wild boss bars (26, or 27 for BST 670+)
    expect(party.slice(-2).map(p => p.bossSegments)).toEqual(before.slice(-2).map(b => b.wildBars));
    expect(
      party.slice(-2).every(p => p.bossSegments === 26 || p.bossSegments === 27),
      JSON.stringify(before),
    ).toBe(true);
    cleanUp(built);
  });

  it("leaves non-boss trainers, Mystery Encounter battles, other modes and the health-segment override alone", async () => {
    await startQuietRun(GameModes.ENDLESS, 201);
    const unchanged = (built: ReturnType<typeof buildTrainerBattle>, label: string) => {
      const before = built.party.map(p => snapshot(p, built.battle.waveIndex));
      applyEndlessTrainerBossBars(built.battle);
      expect(
        built.party.map(p => snapshot(p, built.battle.waveIndex)),
        label,
      ).toEqual(before);
      expect(
        built.party.every(p => p.forkBossHpBars == null),
        label,
      ).toBe(true);
      cleanUp(built);
    };

    // A trainer that is no boss
    const ace = buildTrainerBattle(TrainerType.ACE_TRAINER, ENDLESS_FINAL_WAVE);
    expect(isEndlessBossBarBattle(ace.battle)).toBe(false);
    unchanged(ace, "ACE_TRAINER");

    // A Mystery Encounter's trainer battle
    const me = buildTrainerBattle(TrainerType.CYNTHIA, ENDLESS_FINAL_WAVE);
    me.battle.battleType = BattleType.MYSTERY_ENCOUNTER;
    expect(isEndlessBossBarBattle(me.battle)).toBe(false);
    unchanged(me, "Mystery Encounter");

    // Other modes
    for (const mode of [GameModes.CLASSIC, GameModes.CHALLENGE, GameModes.DAILY]) {
      game.scene.gameMode = getGameMode(mode);
      const other = buildTrainerBattle(TrainerType.CYNTHIA, 201);
      expect(isEndlessBossBarBattle(other.battle), GameModes[mode]).toBe(false);
      unchanged(other, GameModes[mode]);
    }

    // Spliced Endless is in
    game.scene.gameMode = getGameMode(GameModes.SPLICED_ENDLESS);
    const spliced = buildTrainerBattle(TrainerType.CYNTHIA, 201);
    expect(isEndlessBossBarBattle(spliced.battle)).toBe(true);
    cleanUp(spliced);

    // A test's health-segment override keeps the bars to itself
    game.scene.gameMode = getGameMode(GameModes.ENDLESS);
    game.override.enemyHealthSegments(1);
    const overridden = buildTrainerBattle(TrainerType.CYNTHIA, 201);
    expect(isEndlessBossBarBattle(overridden.battle)).toBe(false);
    unchanged(overridden, "override");
  });

  it("leaves wild Endless battles alone, bosses included", async () => {
    game.override.disableTrainerWaves();
    await startRun(GameModes.ENDLESS, 1010);
    const battle = game.scene.currentBattle;
    expect(battle.battleType).toBe(BattleType.WILD);
    expect(isEndlessBossBarBattle(battle)).toBe(false);
    const [wild] = game.scene.getEnemyParty();
    expect(wild.isBoss()).toBe(true);
    expect(wild.forkBossHpBars).toBeUndefined();
    // A wild boss keeps the engine's own count, the B the trainer rule is proportional to
    expect(wild.bossSegments).toBe(game.scene.getEncounterBossSegments(1010, wild.level, wild.species, true));
    // The correction reads only the stored bars, which a wild boss never has
    expect(applyEndlessBossHpCorrection(wild, 1000)).toBe(1000);
    const maxHp = wild.getMaxHp();
    wild.calculateStats();
    expect(wild.getMaxHp()).toBe(maxHp);
  });

  it("a real gym-leader battle has no bars on wave 150 and gets them on wave 201 (EncounterPhase)", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.BROCK, trainerVariant: TrainerVariant.DEFAULT });
    await startRun(GameModes.ENDLESS, 150);
    expect(game.scene.currentBattle.trainer?.config.trainerType).toBe(TrainerType.BROCK);
    expect(game.scene.getEnemyParty().every(p => p.forkBossHpBars == null)).toBe(true);
    // Brock's own config gives no member bars
    expect(game.scene.getEnemyParty().every(p => !p.isBoss())).toBe(true);
  });

  it("a real wave 201 gym-leader battle: ace B (3, 4 for BST 670+), the two before it round(0.7 B), the rest round(0.4 B)", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.BROCK, trainerVariant: TrainerVariant.DEFAULT });
    await startRun(GameModes.ENDLESS, 201);
    const party = game.scene.getEnemyParty();
    const roles = singleRoles(party.length);
    party.forEach((p, i) => {
      const wild = wildBossBars(p, 201);
      expect(p.level, `${i} ${roles[i]}`).toBeGreaterThanOrEqual(100);
      expect(wild === 3 || wild === 4, `${i} ${roles[i]}`).toBe(true);
      // Brock's own config gives no bars, so a member under 2 has none
      const raw = roleBars(roles[i], wild);
      const bars = raw >= 2 ? raw : 0;
      expect(p.bossSegments ?? 0, `${i} ${roles[i]}`).toBe(bars);
      expect(p.forkBossHpBars, `${i} ${roles[i]}`).toBe(bars || undefined);
      expectExactCorrection(p);
    });
    // The ace has 3 bars (4 with BST 670+), the two before it 2 (3)
    expect(party.at(-1)!.bossSegments).toBeGreaterThanOrEqual(3);
    expect(party.slice(-3, -1).every(p => p.bossSegments >= 2)).toBe(true);
  });

  /** The max HP with the stored bars is the max HP without them x (1 + 0.25 x (bars - 1)), rounded down, items included */
  function expectExactCorrection(p: EnemyPokemon): void {
    const bars = p.forkBossHpBars;
    const withBars = p.getMaxHp();
    p.forkBossHpBars = undefined;
    p.calculateStats();
    const without = p.getMaxHp();
    p.forkBossHpBars = bars;
    p.calculateStats();
    expect(p.getMaxHp()).toBe(withBars);
    expect(withBars).toBe(Math.floor(without * getEndlessBossHpMultiplier(bars)));
    expect(p.hp).toBe(withBars);
  }

  it("the real wave 5850 final trainer: bars proportional to its members' 26 / 27 wild bars, exact HP with items", async () => {
    await startRun(GameModes.ENDLESS, ENDLESS_FINAL_WAVE);
    const battle = game.scene.currentBattle;
    expect(ENDLESS_FINAL_TRAINER_POOL).toContain(battle.trainer!.config.trainerType);
    const party = game.scene.getEnemyParty();
    const roles = singleRoles(party.length);
    process.stdout.write(
      `[boss-bars] real 5850 ${TrainerType[battle.trainer!.config.trainerType]}: ${party.map(p => `${p.name} BST ${p.species.baseTotal} Lv${p.level} ${p.bossSegments} bars x${getEndlessBossHpMultiplier(p.forkBossHpBars)} ${p.getMaxHp()} HP`).join(" / ")}\n`,
    );
    expect(party.map(p => p.bossSegments)).toEqual(FINAL_TRAINER_BARS);
    expect(party.map(p => p.forkBossHpBars)).toEqual(FINAL_TRAINER_BARS);
    expect(party.map((p, i) => roleBars(roles[i], wildBossBars(p, ENDLESS_FINAL_WAVE)))).toEqual(FINAL_TRAINER_BARS);
    for (const p of party) {
      expect(p.hasPassive()).toBe(true);
      expect(p.bossSegmentIndex).toBe(p.bossSegments - 1);
      expectExactCorrection(p);
    }
  });

  it("a session save and reload keeps the bars and the corrected max and current HP", async () => {
    await startRun(GameModes.ENDLESS, ENDLESS_FINAL_WAVE);
    const before = game.scene.getEnemyParty().map(p => ({
      id: p.id,
      bars: p.bossSegments,
      stored: p.forkBossHpBars,
      hp: p.hp,
      maxHp: p.getMaxHp(),
    }));
    expect(before.map(b => b.stored)).toEqual(FINAL_TRAINER_BARS);

    // The saved data carries the stored bars only where they are set
    const saved = new PokemonData(JSON.parse(JSON.stringify(new PokemonData(game.scene.getEnemyParty()[5]))));
    expect(saved.forkBossHpBars).toBe(FINAL_TRAINER_BARS[5]);
    expect("forkBossHpBars" in JSON.parse(JSON.stringify(new PokemonData(game.scene.getPlayerParty()[0])))).toBe(false);

    const { gameData } = game.scene;
    const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
    game.reload["sessionData"] = gameData.parseSessionData(json);
    await game.reload.reloadSession();
    const loaded = game.scene.getEnemyParty();
    const after = loaded.map(p => ({
      id: p.id,
      bars: p.bossSegments,
      stored: p.forkBossHpBars,
      hp: p.hp,
      maxHp: p.getMaxHp(),
    }));
    expect(after).toEqual(before);
    for (const p of loaded) {
      p.calculateStats();
      expectExactCorrection(p);
    }
    expect(loaded.map(p => p.getMaxHp())).toEqual(before.map(b => b.maxHp));
  });
});
