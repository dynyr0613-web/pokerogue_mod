import { FULL_RULE_HELD_ITEM_IDS } from "#balance/endless-balance";
import { allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import {
  applySeedPouchOnEntry,
  BATTLE_HELD_ITEMS,
  type BattleHeldItemId,
  getCriticalHitMultiplier,
  getMetronomePowerPercent,
  getMetronomeSteps,
  getPowerHerbUsesLeft,
  isPowerHerbMove,
} from "#modifiers/battle-held-items";
import {
  ExpertBeltModifier,
  FuelModifier,
  getCustomModifierClass,
  LoadedDiceModifier,
  MetronomeModifier,
  PowerHerbModifier,
  PrecisionLensModifier,
  SeedPouchModifier,
} from "#modifiers/custom-held-items";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import * as Modifier from "#modifiers/modifier";
import type { PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import type { MoveEffectPhase } from "#phases/move-effect-phase";
import { MovePhase } from "#phases/move-phase";
import { GameManager } from "#test/framework/game-manager";
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import { NumberHolder, toDmgValue } from "#utils/common";
import { getModifierPoolForType } from "#utils/modifier-utils";
import { readFileSync } from "node:fs";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local fork (2026-11-11): 파워풀허브 / 메트로놈 / 속임수주사위 / 씨앗주머니 / 연료 / 달인의띠 / 정밀렌즈. The user: "로그 등급에
 * 파워풀허브도 넣어두죠, 전투당 개수만큼 발동할 수 있고, 최대 2개까지 / 메트로놈도 넣어두죠, 하이퍼 등급, 최대 3개, 증가치는
 * 10/15/20%로 / 속임수주사위도 로그 등급으로 넣어두죠 / 씨앗주머니(…)도 넣어둡시다, 풀타입 포켓몬이 지닐 시 씨뿌리기 효과와
 * 동일한 효과를 내도록(풀타입 없으면 애초에 안나오도록), 로그 등급으로, 최대 1개 / 연료(…)도 넣어두죠, 하이퍼 등급으로,
 * 불타입이 지니면 공특공 1.1배. 최대 3개에 연료끼리는 합연산. / 저희 달인의띠 넣어뒀나요? 없다면 로그 등급으로, 최대 1개로
 * 넣어두죠 / 초점렌즈 색깔을 좀 바꿔서 로그 등급으로 『 정밀렌즈 』 넣어두죠, … 1/2개일때 1.7/1.8배의 데미지가 들어가겠네요".
 */
describe("Custom items - Power Herb, Metronome, Loaded Dice, Seed Pouch, Fuel, Expert Belt, Precision Lens", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  const ITEMS = [
    // id, class, icon, ko name, tier, pool weight, max held, new icon (drawn for the fork)
    ["POWER_HERB", PowerHerbModifier, "power_herb", "파워풀허브", ModifierTier.ROGUE, 4, 2, false],
    ["METRONOME", MetronomeModifier, "metronome", "메트로놈", ModifierTier.ULTRA, 4, 3, false],
    ["LOADED_DICE", LoadedDiceModifier, "loaded_dice", "속임수주사위", ModifierTier.ROGUE, 4, 1, false],
    ["SEED_POUCH", SeedPouchModifier, "seed_pouch", "씨앗주머니", ModifierTier.ROGUE, 4, 1, true],
    ["FUEL", FuelModifier, "fuel", "연료", ModifierTier.ULTRA, 6, 3, true],
    ["EXPERT_BELT", ExpertBeltModifier, "expert_belt", "달인의띠", ModifierTier.ROGUE, 4, 1, false],
    ["PRECISION_LENS", PrecisionLensModifier, "precision_lens", "정밀렌즈", ModifierTier.ROGUE, 3, 2, true],
  ] as const;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyHasPassiveAbility(false)
      .ability(AbilityId.BALL_FETCH)
      .hasPassiveAbility(false)
      .shiny(false)
      .moveset([MoveId.TACKLE, MoveId.MACH_PUNCH, MoveId.SOLAR_BEAM, MoveId.SPLASH]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function poolEntry(tier: ModifierTier, id: string) {
    return getModifierPoolForType(ModifierPoolType.PLAYER)[tier].find(w => w.modifierType.id === id);
  }

  function weightOf(tier: ModifierTier, id: string, party: Pokemon[]): number {
    return (poolEntry(tier, id)!.weight as WeightedModifierTypeWeightFunc)(party, 0);
  }

  /** Gives the player's `pokemon` `count` of the item and returns its stack */
  function give(pokemon: Pokemon, id: BattleHeldItemId, count = 1): PokemonHeldItemModifier {
    const type = modifierTypes[id]().withIdFromFunc(modifierTypes[id]) as PokemonHeldItemModifierType;
    const mod = type.newModifier(pokemon) as PokemonHeldItemModifier;
    mod.stackCount = count;
    game.scene.addModifier(mod, true, false, false, true);
    return pokemon.getHeldItems().find(m => m.type.id === id)!;
  }

  it("have icons, Korean / English text, save classes, pool entries at their tiers and the full-item rule", () => {
    const atlas = JSON.parse(readFileSync("./assets/images/items.json", "utf8")).textures[0].frames as {
      filename: string;
      sourceSize: { w: number; h: number };
      trimmed: boolean;
    }[];
    const ko = JSON.parse(readFileSync("./locales/ko/modifier-type.json", "utf8")).ModifierType;
    const en = JSON.parse(readFileSync("./locales/en/modifier-type.json", "utf8")).ModifierType;
    for (const [id, cls, icon, koName, tier, weight, maxHeld, drawn] of ITEMS) {
      expect(modifierTypes[id]().iconImage).toBe(icon);
      const frame = atlas.find(f => f.filename === icon);
      expect(frame?.sourceSize, icon).toEqual({ w: 32, h: 32 });
      if (drawn) {
        expect(frame?.trimmed, icon).toBe(false);
      }
      expect(ko[id]?.name, id).toBe(koName);
      expect(ko[id]?.description, id).toBeTruthy();
      expect(en[id]?.name && en[id]?.description, id).toBeTruthy();
      expect(getCustomModifierClass(cls.name)).toBe(cls);
      expect(poolEntry(tier, id)?.maxWeight, id).toBe(weight);
      expect(BATTLE_HELD_ITEMS[id].maxHeld, id).toBe(maxHeld);
      expect(BATTLE_HELD_ITEMS[id].poolWeight, id).toBe(weight);
      expect(FULL_RULE_HELD_ITEM_IDS.has(id), id).toBe(true);
    }
    const koMessages = JSON.parse(readFileSync("./locales/ko/modifier.json", "utf8"));
    expect(koMessages.powerHerbApply && koMessages.seedPouchApply).toBeTruthy();
  });

  it("survive the session save with their stacks, capped per kind", async () => {
    game.override.startingHeldItems(ITEMS.map(([id, , , , , , maxHeld]) => ({ name: id, count: maxHeld })));
    await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
    const user = game.field.getPlayerPokemon();
    const { gameData } = game.scene;
    const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
    const session = gameData.parseSessionData(json);
    for (const [id, cls, , , , , maxHeld] of ITEMS) {
      const saved = session.modifiers.find(m => m.typeId === id)!;
      expect(saved.className, id).toBe(cls.name);
      // biome-ignore lint/performance/noDynamicNamespaceImportAccess: the session loader looks classes up by name here
      const restored = saved.toModifier(Modifier[saved.className]) as PokemonHeldItemModifier;
      expect(restored).toBeInstanceOf(cls);
      expect(restored.stackCount, id).toBe(maxHeld);
      expect(restored.getMaxHeldItemCount(user), id).toBe(maxHeld);
    }
  });

  describe("Power Herb", () => {
    it("covers every two-turn move but Sky Drop", () => {
      for (const move of [MoveId.SOLAR_BEAM, MoveId.FLY, MoveId.DIG, MoveId.METEOR_BEAM, MoveId.GEOMANCY]) {
        expect(isPowerHerbMove(allMoves[move]), MoveId[move]).toBe(true);
      }
      expect(isPowerHerbMove(allMoves[MoveId.SKY_DROP])).toBe(false);
      expect(isPowerHerbMove(allMoves[MoveId.TACKLE])).toBe(false);
    });

    it("skips the charging turn once per herb each battle, is not used up, and resets with the wave", async () => {
      game.override.startingHeldItems([{ name: "POWER_HERB", count: 2 }]);
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      const user = game.field.getPlayerPokemon();
      const target = game.field.getEnemyPokemon();
      expect(getPowerHerbUsesLeft(user)).toBe(2);

      let hp = target.hp;
      for (const usesLeft of [1, 0]) {
        game.move.select(MoveId.SOLAR_BEAM);
        await game.toNextTurn();
        expect(target.hp, `${usesLeft} left`).toBeLessThan(hp); // it attacked on the turn it was selected
        expect(getPowerHerbUsesLeft(user)).toBe(usesLeft);
        hp = target.hp;
      }

      // no use left: the third Solar Beam charges
      game.move.select(MoveId.SOLAR_BEAM);
      await game.toNextTurn();
      expect(target.hp).toBe(hp);
      expect(user.getTag(BattlerTagType.CHARGING)).toBeDefined();
      expect(user.getHeldItems().find(m => m instanceof PowerHerbModifier)?.stackCount).toBe(2);

      user.resetWaveData(); // what every new wave does (EncounterPhase / NextEncounterPhase)
      expect(getPowerHerbUsesLeft(user)).toBe(2);
    });

    it("Fly hits on the turn it is used and leaves its user out of the sky", async () => {
      game.override.moveset([MoveId.FLY, MoveId.SPLASH]).startingHeldItems([{ name: "POWER_HERB" }]);
      await game.classicMode.startBattle(SpeciesId.PIDGEOT);
      const user = game.field.getPlayerPokemon();
      const target = game.field.getEnemyPokemon();
      game.move.select(MoveId.FLY);
      await game.move.forceHit(); // Fly's 95% accuracy
      await game.toNextTurn();
      expect(target.isFullHp()).toBe(false);
      expect(user.getTag(BattlerTagType.FLYING)).toBeUndefined();
      expect(user.getTag(BattlerTagType.CHARGING)).toBeUndefined();
      expect(getPowerHerbUsesLeft(user)).toBe(0);
    });

    it("spends no use when the move is instant anyway (Solar Beam in sun)", async () => {
      game.override.weather(WeatherType.SUNNY).startingHeldItems([{ name: "POWER_HERB" }]);
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      const user = game.field.getPlayerPokemon();
      const target = game.field.getEnemyPokemon();
      game.move.select(MoveId.SOLAR_BEAM);
      await game.toNextTurn();
      expect(target.isFullHp()).toBe(false);
      expect(user.waveData.powerHerbUses).toBe(0);
      expect(getPowerHerbUsesLeft(user)).toBe(1);
    });

    // Local fork (2026-11-11), after review: the attack half used to run the first failure check a second time
    it("the attack half is the same move use: Truant, confusion and paralysis are checked once", async () => {
      game.override
        .startingHeldItems([{ name: "POWER_HERB" }])
        .ability(AbilityId.TRUANT)
        .statusEffect(StatusEffect.PARALYSIS)
        .statusActivation(false)
        .confusionActivation(false);
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      const user = game.field.getPlayerPokemon();
      const target = game.field.getEnemyPokemon();
      user.addTag(BattlerTagType.CONFUSED, 10, MoveId.CONFUSE_RAY);
      const confusion = user.getTag(BattlerTagType.CONFUSED)!;
      const checkPara = vi.spyOn(MovePhase.prototype as unknown as { checkPara(): boolean }, "checkPara");

      game.move.select(MoveId.SOLAR_BEAM);
      await game.toNextTurn();
      expect(target.isFullHp()).toBe(false); // Truant did not stop the attack half
      expect(confusion.turnCount).toBe(9); // ticked once
      expect(checkPara.mock.contexts.filter(phase => (phase as MovePhase).pokemon === user)).toHaveLength(1);
      expect(user.getTag(BattlerTagType.CHARGING)).toBeUndefined();
      expect(user.getMoveset()[2].ppUsed).toBe(1);
      expect(getPowerHerbUsesLeft(user)).toBe(0);
    });
  });

  describe("Metronome", () => {
    it("+10/15/20% per consecutive step for 1/2/3 held, at most 5 steps; reset by another move, a failure or a miss", async () => {
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      const user = game.field.getPlayerPokemon();
      const target = game.field.getEnemyPokemon();
      const tackle = allMoves[MoveId.TACKLE];
      // the newest entry is the use in progress (MoveEffectPhase records it before the damage)
      const setHistory = (...entries: [MoveId, MoveResult][]) => {
        user.summonData.moveHistory = entries.map(([move, result]) => ({
          move,
          targets: [BattlerIndex.ENEMY],
          result,
          useMode: MoveUseMode.NORMAL,
        }));
      };
      const ok = (move: MoveId = MoveId.TACKLE): [MoveId, MoveResult] => [move, MoveResult.SUCCESS];

      setHistory(...Array.from({ length: 8 }, () => ok()));
      expect(getMetronomeSteps(user, tackle)).toBe(5);
      expect(getMetronomePowerPercent(user, tackle)).toBe(100); // none held
      const metronome = give(user, "METRONOME");
      for (const [held, percent, power] of [
        [1, 150, 60],
        [2, 175, 70],
        [3, 200, 80],
      ]) {
        metronome.stackCount = held;
        expect(getMetronomePowerPercent(user, tackle), `${held} held`).toBe(percent);
        expect(tackle.calculateBattlePower(user, target, true)).toBe(power);
      }

      metronome.stackCount = 2;
      setHistory(ok(), ok(), ok());
      expect(tackle.calculateBattlePower(user, target, true)).toBe(52); // 40 * 130 / 100, exact

      setHistory(ok(), ok(MoveId.SPLASH), ok());
      expect(getMetronomeSteps(user, tackle)).toBe(0);
      setHistory(ok(), [MoveId.TACKLE, MoveResult.FAIL], ok());
      expect(getMetronomeSteps(user, tackle)).toBe(0);
      setHistory(ok(), [MoveId.TACKLE, MoveResult.MISS], ok());
      expect(getMetronomeSteps(user, tackle)).toBe(0);
      // a charging turn of the same move neither counts nor breaks the run
      const charge: [MoveId, MoveResult] = [MoveId.SOLAR_BEAM, MoveResult.OTHER];
      setHistory(charge, ok(MoveId.SOLAR_BEAM), charge, ok(MoveId.SOLAR_BEAM));
      expect(getMetronomeSteps(user, allMoves[MoveId.SOLAR_BEAM])).toBe(1);
    });

    it("raises a move's power turn after turn in battle and starts over after another move", async () => {
      game.override.startingHeldItems([{ name: "METRONOME" }]);
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      const spy = vi.spyOn(allMoves[MoveId.TACKLE], "calculateBattlePower");
      const lastHitPower = () => spy.mock.results[spy.mock.calls.findLastIndex(c => c[2] === false)].value;
      const powers: number[] = [];
      for (const move of [MoveId.TACKLE, MoveId.TACKLE, MoveId.TACKLE, MoveId.SPLASH, MoveId.TACKLE]) {
        game.move.select(move);
        await game.toNextTurn();
        if (move === MoveId.TACKLE) {
          powers.push(lastHitPower());
        }
      }
      expect(powers).toEqual([40, 44, 48, 40]);
    });

    // Local fork (2026-11-11), after review: wild waves keep the history of a Pokémon that stays out
    it("starts over every battle (wave), even for a Pokémon that stays on the field", async () => {
      game.override
        .battleType(BattleType.WILD)
        .startingWave(3)
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyLevel(1)
        .startingHeldItems([{ name: "METRONOME", count: 3 }]);
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      const user = game.field.getPlayerPokemon();
      const spy = vi.spyOn(allMoves[MoveId.TACKLE], "calculateBattlePower");
      const lastHitPower = () => spy.mock.results[spy.mock.calls.findLastIndex(c => c[2] === false)].value;

      game.move.select(MoveId.TACKLE);
      await game.toNextWave();
      expect(lastHitPower()).toBe(40);
      expect(game.scene.currentBattle.waveIndex).toBe(4);
      expect(user.getLastXMoves(1)[0]?.move).toBe(MoveId.TACKLE); // still in the history

      game.move.select(MoveId.TACKLE);
      await game.toNextWave();
      expect(lastHitPower()).toBe(40); // not 48: the Tackle of wave 3 does not count
    });

    it("a move-calling move that worked (Nature Power ...) is passed over, so the move it calls builds a run", async () => {
      game.override.moveset([MoveId.NATURE_POWER]).startingHeldItems([{ name: "METRONOME" }]);
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      const user = game.field.getPlayerPokemon();
      game.move.select(MoveId.NATURE_POWER);
      await game.toNextTurn();
      const called = allMoves[user.getLastXMoves(1)[0].move];
      expect(called.id).not.toBe(MoveId.NATURE_POWER);
      expect(user.getLastXMoves(2)[1]).toMatchObject({ move: MoveId.NATURE_POWER, result: MoveResult.SUCCESS });

      const spy = vi.spyOn(called, "calculateBattlePower");
      game.move.select(MoveId.NATURE_POWER);
      await game.toNextTurn();
      const hit = spy.mock.calls.findLastIndex(c => c[2] === false);
      expect(spy.mock.results[hit].value).toBe((called.power * 110) / 100);

      // a move-calling move that failed still ends the run
      const tackle = allMoves[MoveId.TACKLE];
      user.summonData.moveHistory = [MoveId.TACKLE, MoveId.NATURE_POWER, MoveId.TACKLE].map((move, i) => ({
        move,
        targets: [BattlerIndex.ENEMY],
        result: i === 1 ? MoveResult.FAIL : MoveResult.SUCCESS,
        useMode: MoveUseMode.NORMAL,
      }));
      expect(getMetronomeSteps(user, tackle)).toBe(0);
    });
  });

  describe("Loaded Dice", () => {
    it("2-5-hit moves hit 4 or 5 times, half each; Skill Link still makes 5; Population Bomb hits 4-10", async () => {
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      const user = game.field.getPlayerPokemon();
      const target = game.field.getEnemyPokemon();
      const bulletSeed = allMoves[MoveId.BULLET_SEED].getAttrs("MultiHitAttr")[0];
      const populationBomb = allMoves[MoveId.POPULATION_BOMB].getAttrs("MultiHitAttr")[0];
      const roll = vi.spyOn(user, "randBattleSeedInt");
      const tally = (attr: typeof bulletSeed, rolls: number) => {
        const seen: Record<number, number> = {};
        for (let r = 0; r < rolls; r++) {
          roll.mockReturnValue(r);
          const hits = attr.getHitCount(user, target);
          seen[hits] = (seen[hits] ?? 0) + 1;
        }
        return seen;
      };

      expect(tally(bulletSeed, 20)).toEqual({ 2: 7, 3: 7, 4: 3, 5: 3 });
      expect(tally(populationBomb, 7)).toEqual({ 10: 7 });
      give(user, "LOADED_DICE");
      expect(tally(bulletSeed, 20)).toEqual({ 4: 10, 5: 10 });
      expect(tally(populationBomb, 7)).toEqual({ 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1 });
      game.field.mockAbility(user, AbilityId.SKILL_LINK);
      expect(tally(bulletSeed, 20)).toEqual({ 5: 20 });
      expect(tally(populationBomb, 7)).toEqual({ 10: 7 });
    });

    it.each([
      { dice: false, hits: 1 },
      { dice: true, hits: 3 },
    ])("Triple Kick checks accuracy on every hit, or once with the dice (dice: $dice)", async ({ dice, hits }) => {
      game.override.moveset([MoveId.TRIPLE_KICK]);
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      const user = game.field.getPlayerPokemon();
      const target = game.field.getEnemyPokemon();
      if (dice) {
        give(user, "LOADED_DICE");
      }
      game.move.select(MoveId.TRIPLE_KICK);
      await game.phaseInterceptor.to("MoveEffectPhase", false);
      const phase = game.scene.phaseManager.getCurrentPhase() as MoveEffectPhase;
      // the first hit lands, every later accuracy check would miss
      vi.spyOn(phase.move, "calculateBattleAccuracy").mockReturnValueOnce(-1).mockReturnValue(0);
      await game.phaseInterceptor.to("MoveEndPhase");
      expect(target.summonData.hitCount).toBe(hits);
    });

    // Local fork (2026-11-11), after review: a fainted Pokémon's ability cannot apply, but it still has Skill Link
    it("is offered for a 2-5-hit move user without Skill Link, fainted or not", async () => {
      game.override.moveset([MoveId.BULLET_SEED]);
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      const user = game.field.getPlayerPokemon();
      expect(weightOf(ModifierTier.ROGUE, "LOADED_DICE", [user])).toBe(4);
      game.field.mockAbility(user, AbilityId.SKILL_LINK);
      expect(weightOf(ModifierTier.ROGUE, "LOADED_DICE", [user])).toBe(0);
      user.hp = 0;
      expect(weightOf(ModifierTier.ROGUE, "LOADED_DICE", [user])).toBe(0);
    });
  });

  describe("Seed Pouch", () => {
    it("a Grass-type holder seeds the foe at the start of a battle with the real Leech Seed", async () => {
      game.override.startingHeldItems([{ name: "SEED_POUCH" }]);
      await game.classicMode.startBattle(SpeciesId.BULBASAUR);
      const user = game.field.getPlayerPokemon();
      const target = game.field.getEnemyPokemon();
      expect(target.getTag(BattlerTagType.SEEDED)?.sourceId).toBe(user.id);

      // the drain is Leech Seed's own: 1/8 of the foe's max HP at the end of the turn
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(target.getMaxHp() - target.hp).toBe(toDmgValue(target.getMaxHp() / 8));
    });

    it.each([
      { name: "a non-Grass holder", player: SpeciesId.SNORLAX, enemy: SpeciesId.MAGIKARP },
      { name: "a Grass-type foe", player: SpeciesId.BULBASAUR, enemy: SpeciesId.TANGELA },
    ])("does nothing for $name", async ({ player, enemy }) => {
      game.override.enemySpecies(enemy).startingHeldItems([{ name: "SEED_POUCH" }]);
      await game.classicMode.startBattle(player);
      expect(game.field.getEnemyPokemon().getTag(BattlerTagType.SEEDED)).toBeUndefined();
    });

    it("seeds the foes when the holder comes in; is offered only while a Grass type has none", async () => {
      await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.BULBASAUR);
      const party = [...game.scene.getPlayerParty()]; // the switch reorders the party itself
      const [magikarp, bulbasaur] = party;
      const target = game.field.getEnemyPokemon();
      expect(weightOf(ModifierTier.ROGUE, "SEED_POUCH", [magikarp])).toBe(0); // no Grass type
      expect(weightOf(ModifierTier.ROGUE, "SEED_POUCH", party)).toBe(4);
      give(magikarp, "SEED_POUCH"); // a Magikarp holding one does nothing
      give(bulbasaur, "SEED_POUCH");
      expect(weightOf(ModifierTier.ROGUE, "SEED_POUCH", party)).toBe(0);
      expect(target.getTag(BattlerTagType.SEEDED)).toBeUndefined();

      game.doSwitchPokemon(1);
      await game.toNextTurn();
      expect(target.getTag(BattlerTagType.SEEDED)?.sourceId).toBe(bulbasaur.id);
    });

    it("an enemy holder seeds each Pokémon that comes in against it", async () => {
      game.override.enemySpecies(SpeciesId.TANGELA).enemyHeldItems([{ name: "SEED_POUCH" }]);
      await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.FEEBAS);
      const [magikarp, feebas] = game.scene.getPlayerParty();
      const enemy = game.field.getEnemyPokemon();
      expect(magikarp.getTag(BattlerTagType.SEEDED)?.sourceId).toBe(enemy.id);

      game.doSwitchPokemon(1);
      await game.toNextTurn();
      expect(magikarp.getTag(BattlerTagType.SEEDED)).toBeUndefined(); // switching out removed it
      expect(feebas.getTag(BattlerTagType.SEEDED)?.sourceId).toBe(enemy.id);
    });

    // Local fork (2026-11-11), after review: as if the holder had used Leech Seed
    it.each([
      { name: "Magic Bounce (it would bounce back to the Grass holder)", ability: AbilityId.MAGIC_BOUNCE },
      { name: "Good as Gold", ability: AbilityId.GOOD_AS_GOLD },
      { name: "Sap Sipper", ability: AbilityId.SAP_SIPPER },
    ])("does not seed a foe with $name", async ({ ability }) => {
      game.override.enemyAbility(ability).startingHeldItems([{ name: "SEED_POUCH" }]);
      await game.classicMode.startBattle(SpeciesId.BULBASAUR);
      const target = game.field.getEnemyPokemon();
      expect(target.getTag(BattlerTagType.SEEDED)).toBeUndefined();
      expect(target.getStatStage(Stat.ATK)).toBe(0); // the item is no move: Sap Sipper does not raise Attack
    });

    it("does not seed a foe out of reach (Fly / Dig ..., Protect, Magic Coat) when the holder comes in", async () => {
      game.override.startingHeldItems([{ name: "SEED_POUCH" }]);
      await game.classicMode.startBattle(SpeciesId.BULBASAUR);
      const user = game.field.getPlayerPokemon();
      const target = game.field.getEnemyPokemon();
      const outOfReach = [
        BattlerTagType.FLYING,
        BattlerTagType.UNDERGROUND,
        BattlerTagType.PROTECTED,
        BattlerTagType.MAGIC_COAT,
      ] as const;
      for (const tag of outOfReach) {
        target.removeTag(BattlerTagType.SEEDED);
        target.addTag(tag, 1, MoveId.NONE, target.id);
        applySeedPouchOnEntry(user);
        expect(target.getTag(BattlerTagType.SEEDED), tag).toBeUndefined();
        target.removeTag(tag);
        applySeedPouchOnEntry(user);
        expect(target.getTag(BattlerTagType.SEEDED)?.sourceId, tag).toBe(user.id);
      }
      // No Guard makes Leech Seed reach a Pokémon in the sky
      target.removeTag(BattlerTagType.SEEDED);
      target.addTag(BattlerTagType.FLYING, 1, MoveId.FLY, target.id);
      game.field.mockAbility(user, AbilityId.NO_GUARD);
      applySeedPouchOnEntry(user);
      expect(target.getTag(BattlerTagType.SEEDED)?.sourceId).toBe(user.id);
    });

    // Local fork (2026-11-11), after review: the reward screen still shows battle-only type changes
    it("is offered by the party's own types, not by a type change from battle", async () => {
      await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.BULBASAUR);
      const [magikarp, bulbasaur] = game.scene.getPlayerParty();
      magikarp.summonData.types = [PokemonType.GRASS]; // Protean / Libero after Grass Knot
      expect(weightOf(ModifierTier.ROGUE, "SEED_POUCH", [magikarp])).toBe(0);
      magikarp.summonData.types = [];
      magikarp.summonData.addedType = PokemonType.GRASS; // Forest's Curse
      expect(weightOf(ModifierTier.ROGUE, "SEED_POUCH", [magikarp])).toBe(0);
      bulbasaur.summonData.types = [PokemonType.WATER]; // Soak
      expect(weightOf(ModifierTier.ROGUE, "SEED_POUCH", [magikarp, bulbasaur])).toBe(4);
    });
  });

  describe("Fuel", () => {
    it("Fire types only: Attack and Sp. Atk x1.1 / 1.2 / 1.3, added up; offered while a Fire type has fewer than 3", async () => {
      await game.classicMode.startBattle(SpeciesId.CHARMANDER, SpeciesId.SQUIRTLE);
      const [charmander, squirtle] = game.scene.getPlayerParty();
      const boosted = (p: Pokemon, stat: Stat) => {
        const value = new NumberHolder(100);
        game.scene.applyModifiers(Modifier.StatBoosterModifier, true, p, stat, value);
        return value.value;
      };
      expect(weightOf(ModifierTier.ULTRA, "FUEL", [squirtle])).toBe(0);
      expect(weightOf(ModifierTier.ULTRA, "FUEL", [charmander, squirtle])).toBe(6);

      const fuel = give(charmander, "FUEL");
      give(squirtle, "FUEL");
      for (const [count, value] of [
        [1, 110],
        [2, 120],
        [3, 130],
      ]) {
        fuel.stackCount = count;
        expect(boosted(charmander, Stat.ATK), `${count}`).toBe(value);
        expect(boosted(charmander, Stat.SPATK), `${count}`).toBe(value);
        expect(boosted(charmander, Stat.DEF)).toBe(100);
        expect(boosted(squirtle, Stat.ATK)).toBe(100); // not a Fire type
      }
      expect(weightOf(ModifierTier.ULTRA, "FUEL", [charmander, squirtle])).toBe(0); // the Fire type holds 3

      game.field.forceTera(charmander, PokemonType.WATER); // Terastallized out of Fire
      expect(boosted(charmander, Stat.ATK)).toBe(100);

      // Local fork (2026-11-11), after review: the reward pool asks the Pokémon's own types, not a battle-only change
      fuel.stackCount = 2;
      expect(weightOf(ModifierTier.ULTRA, "FUEL", [charmander])).toBe(6); // still a Fire type under the Tera
      charmander.summonData.types = [PokemonType.WATER]; // Soak / Burn Up
      expect(weightOf(ModifierTier.ULTRA, "FUEL", [charmander])).toBe(6);
      squirtle.summonData.types = [PokemonType.FIRE]; // Protean after a Fire move
      expect(weightOf(ModifierTier.ULTRA, "FUEL", [squirtle])).toBe(0);
    });
  });

  describe("Expert Belt and Precision Lens", () => {
    it("Expert Belt: x1.2 on super-effective hits only", async () => {
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      const user = game.field.getPlayerPokemon();
      const target = game.field.getEnemyPokemon();
      const damage = (move: MoveId) =>
        target.getAttackDamage({ source: user, move: allMoves[move], simulated: true }).damage;
      const punch = damage(MoveId.MACH_PUNCH); // Fighting into Snorlax: super effective
      const tackle = damage(MoveId.TACKLE);
      give(user, "EXPERT_BELT");
      expect(damage(MoveId.MACH_PUNCH)).toBe(toDmgValue((punch * 12) / 10));
      expect(damage(MoveId.TACKLE)).toBe(tackle);
    });

    it("Precision Lens: critical hits x1.7 / x1.8 instead of x1.5, Sniper's x1.5 on top; no crit-rate change", async () => {
      game.override.moveset([MoveId.DOUBLE_EDGE]);
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      const user = game.field.getPlayerPokemon();
      const target = game.field.getEnemyPokemon();
      const damage = (isCritical: boolean) =>
        target.getAttackDamage({ source: user, move: allMoves[MoveId.DOUBLE_EDGE], isCritical, simulated: true })
          .damage;
      /** a crit with `mult` lies between floor(base * mult) and floor((base + 1) * mult), base being the non-crit */
      const expectCrit = (mult: number) => {
        const base = damage(false);
        const crit = damage(true);
        expect(crit, `x${mult}`).toBeGreaterThanOrEqual(Math.floor(base * mult));
        expect(crit, `x${mult}`).toBeLessThanOrEqual(Math.floor((base + 1) * mult));
      };

      expect(getCriticalHitMultiplier(user)).toBe(1.5);
      expectCrit(1.5);
      const lens = give(user, "PRECISION_LENS");
      expect(lens).not.toBeInstanceOf(Modifier.CritBoosterModifier);
      expect(getCriticalHitMultiplier(user)).toBe(1.7);
      expectCrit(1.7);
      lens.stackCount = 2;
      expect(getCriticalHitMultiplier(user)).toBe(1.8);
      expectCrit(1.8);

      lens.stackCount = 1;
      game.field.mockAbility(user, AbilityId.SNIPER);
      expectCrit(1.7 * 1.5);
    });
  });
});
