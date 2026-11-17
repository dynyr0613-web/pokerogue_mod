import { getGameMode } from "#app/game-mode";
import * as TrainerBuffs from "#balance/enemy-trainer-buffs";
import {
  ENEMY_TRAINER_BUFFS,
  getEnemyTrainerItemChance,
  getEnemyTrainerTierCounts,
} from "#balance/enemy-trainer-buffs";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { GameModes } from "#enums/game-modes";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import type { EnemyPokemon } from "#field/pokemon";
import * as ModifierTypeModule from "#modifiers/modifier-type";
import {
  AttackTypeBoosterModifierType,
  getEnemyModifierTypesForWave,
  regenerateModifierPoolThresholds,
  type WeightedModifierType,
} from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import * as Utils from "#utils/common";
import { getModifierPoolForType } from "#utils/modifier-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local fork (2026-11-12): trainer Pokémon hold more ordinary held items, more of them 로그 / 마스터, no Grip Claw or
 * Lucky Egg (enemy-trainer-buffs.ts; the user: "끈기갈고리손톱 제외하고, 커스텀 아이템도 제외하고 도구 확률과 개수를
 * 올려보죠", "타입 강화 효과 도구보단 다른 아이템을 가질 확률을 올려보고"). Wild and mystery-encounter battles unchanged.
 */
describe("Custom - trainer Pokémon hold more battle items", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingWave(75)
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH])
      .mysteryEncounterChance(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Forces the seeded rolls: the tier roll (out of 1024) gives `tierValue`, the upgrade rolls (1 in 32 / 16) never
   * upgrade, and every other roll gives `other` (0: every item try succeeds and each pick takes the first entry;
   * "last": every try fails)
   */
  const forceRolls = (tierValue: number, other: 0 | "last" = 0) =>
    vi.spyOn(Utils, "randSeedInt").mockImplementation((range: number, min = 0) => {
      if (range === 1024) {
        return min + tierValue;
      }
      if (range === 32 || range === 16 || other === "last") {
        return min + range - 1;
      }
      return min;
    });

  const startTrainerBattle = async (trainerType: Exclude<TrainerType, TrainerType.UNKNOWN>) => {
    game.override.battleType(BattleType.TRAINER).randomTrainer({ trainerType, trainerVariant: TrainerVariant.DEFAULT });
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    game.scene.clearEnemyHeldItemModifiers();
  };

  /** The [count, pool type] and result of every `getEnemyModifierTypesForWave` call during `generateEnemyModifiers` */
  const generate = async () => {
    const spy = vi.spyOn(ModifierTypeModule, "getEnemyModifierTypesForWave");
    game.scene.clearEnemyHeldItemModifiers();
    await game.scene.generateEnemyModifiers();
    const calls = spy.mock.calls.map((args, i) => ({
      count: args[1],
      poolType: args[3],
      types: spy.mock.results[i].value as ModifierTypeModule.PokemonHeldItemModifierType[],
    }));
    spy.mockRestore();
    return calls;
  };

  it("keeps its numbers in one frozen table", () => {
    expect(Object.isFrozen(ENEMY_TRAINER_BUFFS)).toBe(true);
    expect(Object.isFrozen(ENEMY_TRAINER_BUFFS.items.chanceDenominator.endless)).toBe(true);
    expect(Object.isFrozen(ENEMY_TRAINER_BUFFS.items.tierCounts.classic)).toBe(true);
    expect(Object.isFrozen(ENEMY_TRAINER_BUFFS.items.trainerPoolWeights)).toBe(true);
    expect(ENEMY_TRAINER_BUFFS).toEqual({
      items: {
        chanceDenominator: {
          classic: { ordinary: 12, elite: 9, boss: 6 },
          endless: { ordinary: 9, elite: 6, boss: 4 },
        },
        tierCounts: {
          classic: [720, 176, 72, 48, 8],
          endlessTop: [600, 160, 96, 136, 32],
          endlessFromWave: 100,
          endlessToWave: 1000,
        },
        trainerPoolWeights: { GRIP_CLAW: 0, LUCKY_EGG: 0 },
      },
      // Local fork (2026-11-12): the Endless trainers' extra fusion roll (custom-enemy-trainer-fusion.test.ts)
      fusion: {
        ordinary: { minWave: 100, chance: 3, everyWaves: 100, step: 3, max: 30 },
        elite: { minWave: 100, chance: 5, everyWaves: 100, step: 4, max: 40 },
        boss: { minWave: 100, chance: 2, everyWaves: 100, step: 2, max: 20 },
      },
    });
  });

  it("gives each trainer tier its own chance per mode", () => {
    const tiers = ["ordinary", "elite", "boss"] as const;
    expect(tiers.map(t => getEnemyTrainerItemChance(t, false))).toEqual([12, 9, 6]);
    expect(tiers.map(t => getEnemyTrainerItemChance(t, true))).toEqual([9, 6, 4]);
  });

  it("moves the trainer tier table with the Endless wave, always out of 1024", () => {
    const waves = [50, 100, 300, 600, 1000, 2000];
    const endless = waves.map(w => getEnemyTrainerTierCounts(w, true));
    expect(endless).toEqual([
      [720, 176, 72, 48, 8],
      [720, 176, 72, 48, 8],
      [693, 173, 77, 68, 13],
      [653, 167, 86, 97, 21],
      [600, 160, 96, 136, 32],
      [600, 160, 96, 136, 32],
    ]);
    // Classic and the other modes never move
    expect(waves.map(w => getEnemyTrainerTierCounts(w, false))).toEqual(waves.map(() => [720, 176, 72, 48, 8]));
    for (let w = 0; w <= 2000; w += 7) {
      const counts = getEnemyTrainerTierCounts(w, true);
      expect(
        counts.reduce((a, b) => a + b, 0),
        `wave ${w}`,
      ).toBe(1024);
      const next = getEnemyTrainerTierCounts(w + 7, true);
      // "this tier or rarer" never shrinks
      for (let k = 1; k < 5; k++) {
        const rarer = (c: readonly number[]) => c.slice(k).reduce((a, b) => a + b, 0);
        expect(rarer(next), `wave ${w}, tier ${k}`).toBeGreaterThanOrEqual(rarer(counts));
      }
    }
  });

  it("a trainer's Pokémon tries at its tier's chance and rolls tiers from the trainer table, Classic and Endless", async () => {
    await startTrainerBattle(TrainerType.FISHERMAN);
    const chance = vi.spyOn(TrainerBuffs, "getEnemyTrainerItemChance");
    const wildChance = vi.spyOn(game.scene.gameMode, "getEnemyModifierChance");

    // Classic wave 75: 8 tries, all forced to succeed; roll 30 is 로그 in the trainer table (하이퍼 in the base one)
    forceRolls(30);
    const classic = await generate();
    expect(classic.length).toBe(game.scene.getEnemyParty().length);
    expect(chance).toHaveBeenCalledWith("ordinary", false);
    expect(chance.mock.results.every(r => r.value === 12)).toBe(true);
    expect(wildChance).not.toHaveBeenCalled();
    for (const call of classic) {
      expect(call.poolType).toBe(ModifierPoolType.TRAINER);
      expect(call.count).toBe(8);
      expect(call.types.map(t => t.id)).toEqual(new Array(8).fill("FOCUS_BAND"));
    }

    // Endless wave 595: 60 tries at 1 in 9; roll 100 is 로그 there (21-117), 하이퍼 in the Classic trainer table
    game.scene.gameMode = getGameMode(GameModes.ENDLESS);
    game.scene.currentBattle.waveIndex = 595;
    chance.mockClear();
    forceRolls(100);
    const endless = await generate();
    expect(chance).toHaveBeenCalledWith("ordinary", true);
    expect(chance.mock.results.every(r => r.value === 9)).toBe(true);
    for (const call of endless) {
      expect(call.count).toBe(60);
      expect(call.types.every(t => t.id === "FOCUS_BAND")).toBe(true);
    }

    // Review: a mystery-encounter battle that has a trainer (battle type MYSTERY_ENCOUNTER) keeps upstream's chance
    // and the wild pool
    game.scene.currentBattle.battleType = BattleType.MYSTERY_ENCOUNTER;
    expect(game.scene.currentBattle.trainer).toBeTruthy();
    chance.mockClear();
    const meChance = vi.spyOn(game.scene.gameMode, "getEnemyModifierChance");
    const me = await generate();
    expect(chance).not.toHaveBeenCalled();
    expect(meChance).toHaveBeenCalledWith(false);
    expect(me.length).toBeGreaterThan(0);
    for (const call of me) {
      expect(call.poolType).toBe(ModifierPoolType.WILD);
      expect(call.count).toBe(60);
    }
  });

  it("an elite trainer tries at the elite chance; a boss-bar Pokémon counts as boss and keeps its minimum", async () => {
    await startTrainerBattle(TrainerType.ACE_TRAINER);
    const chance = vi.spyOn(TrainerBuffs, "getEnemyTrainerItemChance");
    forceRolls(1023, "last");
    const elite = await generate();
    expect(chance).toHaveBeenCalledWith("elite", false);
    expect(chance.mock.results.every(r => r.value === 9)).toBe(true);
    // Every try failed: an elite gets nothing
    expect(elite.every(c => c.count === 0)).toBe(true);

    chance.mockClear();
    for (const enemy of game.scene.getEnemyParty()) {
      vi.spyOn(enemy as EnemyPokemon, "isBoss").mockReturnValue(true);
    }
    const boss = await generate();
    expect(chance).toHaveBeenCalledWith("boss", false);
    expect(chance).not.toHaveBeenCalledWith("elite", false);
    // floor(8 / 2), all 일반 with roll 1023
    expect(boss.every(c => c.count === 4)).toBe(true);
  });

  it("wild and mystery-encounter battles keep upstream's chance and the base tier table", async () => {
    // A damaging move, so the type booster generator has a type to give
    game.override.battleType(BattleType.WILD).enemyHealthSegments(1).enemyMoveset(MoveId.TACKLE);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const chance = vi.spyOn(TrainerBuffs, "getEnemyTrainerItemChance");
    const wildChance = vi.spyOn(game.scene.gameMode, "getEnemyModifierChance");
    forceRolls(30);
    const wild = await generate();
    expect(chance).not.toHaveBeenCalled();
    expect(wildChance).toHaveBeenCalledWith(false);
    expect(wild).toHaveLength(1);
    expect(wild[0].poolType).toBe(ModifierPoolType.WILD);
    expect(wild[0].count).toBe(8);
    // Roll 30 is 하이퍼 in the base table: the wild type boosters
    expect(wild[0].types.every(t => t instanceof AttackTypeBoosterModifierType)).toBe(true);

    // A mystery-encounter battle (even with a trainer) rolls like a wild one
    game.scene.currentBattle.battleType = BattleType.MYSTERY_ENCOUNTER;
    const me = await generate();
    expect(chance).not.toHaveBeenCalled();
    expect(me[0].poolType).toBe(ModifierPoolType.WILD);
  });

  it("the trainer pool gives no Grip Claw or Lucky Egg; every other 로그 / 마스터 item can come", async () => {
    await startTrainerBattle(TrainerType.FISHERMAN);
    const rogue = getModifierPoolForType(ModifierPoolType.TRAINER)[ModifierTier.ROGUE] as WeightedModifierType[];
    const weight = (id: string) => rogue.find(m => m.modifierType.id === id)?.weight;
    expect([weight("GRIP_CLAW"), weight("LUCKY_EGG"), weight("FOCUS_BAND")]).toEqual([0, 0, 2]);
    // The wild pool keeps its Lucky Egg
    const wildRogue = getModifierPoolForType(ModifierPoolType.WILD)[ModifierTier.ROGUE] as WeightedModifierType[];
    expect(wildRogue.find(m => m.modifierType.id === "LUCKY_EGG")?.weight).toBe(4);

    const enemy = game.field.getEnemyPokemon();
    regenerateModifierPoolThresholds(game.scene.getEnemyField(), ModifierPoolType.TRAINER);
    const seen = new Set<string>();
    // Roll 0 is 마스터, 30 is 로그 (Classic trainer table); the pick inside the tier walks every entry
    for (const tierValue of [0, 30]) {
      for (let pick = 0; pick < 8; pick++) {
        vi.spyOn(Utils, "randSeedInt").mockImplementation((range: number, min = 0) =>
          range === 1024 ? min + tierValue : min + (pick % range),
        );
        for (const type of getEnemyModifierTypesForWave(75, 1, [enemy], ModifierPoolType.TRAINER)) {
          seen.add(type.id);
        }
      }
    }
    expect([...seen].sort()).toEqual(
      ["FOCUS_BAND", "KINGS_ROCK", "LEFTOVERS", "QUICK_CLAW", "SCOPE_LENS", "SHELL_BELL", "WIDE_LENS"].sort(),
    );
  });
});
