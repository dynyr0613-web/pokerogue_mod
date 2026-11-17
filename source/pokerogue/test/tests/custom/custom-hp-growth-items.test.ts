import { speciesDataRegistry } from "#app/global-species-data-registry";
import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { PERMANENT_STATS, type PermanentStat, Stat } from "#enums/stat";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import {
  gainEvsFromItems,
  getHeldEvItem,
  getIvCandyDescription,
  getIvCandyPercent,
  IV_CANDY_HP_PERCENT_PER_STACK,
  IV_CANDY_PERCENT_PER_STACK,
  type IvCandyModifier,
} from "#modifiers/custom-held-items";
import { addEvs, EV_RULES, type EvItemId, getEvCap, normalizeEvs } from "#modifiers/ev-items";
import {
  type BaseStatModifier,
  getVitaminPercent,
  type PokemonHeldItemModifier,
  VITAMIN_HP_PERCENT_PER_STACK,
  VITAMIN_PERCENT_PER_STACK,
} from "#modifiers/modifier";
import {
  itemPoolChecks,
  type ModifierType,
  type ModifierTypeGenerator,
  type PokemonHeldItemModifierType,
} from "#modifiers/modifier-type";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import { MockContainer } from "#test/mocks/mocks-container/mock-container";
import { SummaryUiMode } from "#ui/summary-ui-handler";
import { getTextStyleOptions } from "#ui/text";
import { readFileSync } from "node:fs";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local fork (2026-11-13): HP-only buffs to the three permanent growth items. The user: "영양제가 hp만 15%, 사탕은 hp만
 * 6%, 노력치 아이템도 hp만 상한을 두배로 올려보죠." The Health Candy (기력의사탕) adds 6% instead of 3% and HP's EV cap is
 * 504 (252 x 2) instead of 252; the other five stats keep 3% / 252, and the caps of the vitamins and candies (the IV)
 * are unchanged. The 3rd balance patch (09 명세 2-2) took the HP vitamin (맥스업) back from 15% to 10% (enemies use the
 * same vitamin modifier, and every enemy's HP had grown x1.37 with it) and limits the 6% Health Candy to the player's
 * side: an enemy's Health Candy (copy encounters, Dark Deal) is 3% like the other candies.
 */
describe("Custom - HP-only buffs to the vitamins, IV Candies and EV items", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  /** Gyarados' base stats: HP 95, Atk 125, Def 79, SpA 60, SpD 100, Spe 81 */
  const GYARADOS = [95, 125, 79, 60, 100, 81];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .battleType(BattleType.WILD)
      .mysteryEncounterChance(0)
      .startingLevel(100)
      .enemyLevel(20)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyHasPassiveAbility(false)
      .ability(AbilityId.BALL_FETCH)
      .hasPassiveAbility(false)
      .nature(Nature.HARDY)
      .playerIVs(31)
      .moveset([MoveId.SPLASH]);
  });

  afterEach(() => {
    itemPoolChecks.clear();
    vi.restoreAllMocks();
  });

  /** A generator with its id set, as the reward pool gives it */
  function generator(id: "IV_CANDY" | "BASE_STAT_BOOSTER"): ModifierTypeGenerator {
    const gen = modifierTypes[id]() as ModifierTypeGenerator;
    gen.id = id;
    return gen;
  }
  const vitaminType = (stat: PermanentStat) => generator("BASE_STAT_BOOSTER").generateType([], [stat])!;
  const candyType = (stat: PermanentStat) => generator("IV_CANDY").generateType([], [stat])!;

  function plainType(id: EvItemId | "WEIGHT_BAND" | "CHAMPION_BELT"): PokemonHeldItemModifierType {
    return modifierTypes[id]().withIdFromFunc(modifierTypes[id]) as PokemonHeldItemModifierType;
  }

  /** Gives `pokemon` `count` of the held item made by `type` (past any cap) and recalculates its stats */
  function give(pokemon: Pokemon, type: ModifierType, count: number): PokemonHeldItemModifier {
    const mod = type.newModifier(pokemon) as PokemonHeldItemModifier;
    game.scene.addModifier(mod, true, false, false, true);
    const held = pokemon.getHeldItems().find(m => m.match(mod))!;
    held.stackCount = count;
    pokemon.calculateStats();
    return held;
  }

  /** The main series' stat formula in whole numbers (neutral nature), `base` already grown by the items */
  function statOf(base: number, iv: number, ev: number, level: number, hp: boolean): number {
    const core = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100);
    return hp ? core + level + 10 : core + 5;
  }

  /** What the vitamin of `stat` makes of `base` with `stacks` stacks, through the real modifier */
  function applyVitamin(pokemon: Pokemon, stat: PermanentStat, base: number, stacks: number): number {
    const vitamin = vitaminType(stat).newModifier(pokemon) as BaseStatModifier;
    vitamin.stackCount = stacks;
    const stats = [base, base, base, base, base, base];
    vitamin.apply(pokemon, stats);
    return stats[stat];
  }

  /** What the IV Candy of `stat` makes of `base` with `stacks` candies, through the real modifier */
  function applyCandy(pokemon: Pokemon, stat: PermanentStat, base: number, stacks: number): number {
    const candy = candyType(stat).newModifier(pokemon) as IvCandyModifier;
    candy.stackCount = stacks;
    const stats = [base, base, base, base, base, base];
    candy.apply(pokemon, stats);
    return stats[stat];
  }

  it("keep the numbers in named constants: vitamins 10 / 10, candies 6 / 3 (enemies 3), EV caps 504 / 252", () => {
    expect([VITAMIN_HP_PERCENT_PER_STACK, VITAMIN_PERCENT_PER_STACK]).toEqual([10, 10]);
    expect(PERMANENT_STATS.map(getVitaminPercent)).toEqual([10, 10, 10, 10, 10, 10]);
    expect([IV_CANDY_HP_PERCENT_PER_STACK, IV_CANDY_PERCENT_PER_STACK]).toEqual([6, 3]);
    expect(PERMANENT_STATS.map(s => getIvCandyPercent(s))).toEqual([6, 3, 3, 3, 3, 3]);
    expect(PERMANENT_STATS.map(s => getIvCandyPercent(s, true))).toEqual([6, 3, 3, 3, 3, 3]);
    expect(PERMANENT_STATS.map(s => getIvCandyPercent(s, false))).toEqual([3, 3, 3, 3, 3, 3]);
    expect([EV_RULES.maxPerStat, EV_RULES.hpCapMultiplier]).toEqual([252, 2]);
    expect(PERMANENT_STATS.map(getEvCap)).toEqual([504, 252, 252, 252, 252, 252]);
  });

  it("every vitamin, HP included, is upstream's x(1 + 0.1n) again, bit for bit (09 patch)", async () => {
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    const gyarados = game.field.getPlayerPokemon();
    // base, stacks, result: 108 x 4.1 = 442.8; 95 x 4.1 = 389.5; 77 x 1.3 = 100.1; 100 x 4.1 is 409.99999999999994 in
    // floating point and upstream has 409, as before the HP vitamin's 15% (it was 610, 536, 115, 225, 111, 240 then)
    for (const [base, stacks, result] of [
      [108, 31, 442],
      [95, 31, 389],
      [100, 31, 409],
      [100, 1, 110],
      [90, 10, 180],
      [77, 3, 100],
      [60, 20, 180],
    ]) {
      expect(applyVitamin(gyarados, Stat.HP, base, stacks), `HP ${base} x${stacks}`).toBe(result);
    }
    // all six: bit for bit upstream's expression, for every base 1-255 and stack 0-31
    for (const stat of PERMANENT_STATS) {
      for (let base = 1; base <= 255; base += 2) {
        for (let stacks = 0; stacks <= 31; stacks++) {
          expect(applyVitamin(gyarados, stat, base, stacks)).toBe(Math.floor(base * (1 + stacks * 0.1)));
        }
      }
    }
    // the cap is still the IV
    gyarados.ivs = [20, 31, 31, 31, 31, 31];
    expect((vitaminType(Stat.HP).newModifier(gyarados) as BaseStatModifier).getMaxHeldItemCount(gyarados)).toBe(20);
  });

  it("the Health Candy multiplies by exactly 1 + 6% per candy after the vitamins; the others stay 3%", async () => {
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    const gyarados = game.field.getPlayerPokemon();
    // 442 x 2.86 = 1264.12; 95 x 2.86 = 271.7; 100 x 1.06 = 106; 90 x 1.6 = 144
    for (const [base, stacks, result] of [
      [442, 31, 1264],
      [95, 31, 271],
      [100, 1, 106],
      [90, 10, 144],
    ]) {
      expect(applyCandy(gyarados, Stat.HP, base, stacks), `HP ${base} x${stacks}`).toBe(result);
    }
    for (const stat of PERMANENT_STATS.filter(s => s !== Stat.HP)) {
      expect(applyCandy(gyarados, stat, 90, 10)).toBe(117);
      expect(applyCandy(gyarados, stat, 120, 25)).toBe(210);
    }
    gyarados.ivs = [12, 31, 31, 31, 31, 31];
    expect((candyType(Stat.HP).newModifier(gyarados) as IvCandyModifier).getMaxHeldItemCount(gyarados)).toBe(12);
  });

  it("give the exact max HP with 31 HP vitamins, 31 Health Candies, 504 HP EVs and all three; Attack unchanged", async () => {
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    const gyarados = game.field.getPlayerPokemon();
    expect(gyarados.getNature()).toBe(Nature.HARDY);
    expect(gyarados.getMaxHp()).toBe(statOf(95, 31, 0, 100, true)); // 331

    const vitamin = give(gyarados, vitaminType(Stat.HP), 31);
    expect(gyarados.calculateBaseStats()[Stat.HP]).toBe(389); // 95 x 4.1 (536 and 1213 with the 15% HP vitamin)
    expect(gyarados.getMaxHp()).toBe(919);
    vitamin.stackCount = 0;

    give(gyarados, candyType(Stat.HP), 31);
    expect(gyarados.calculateBaseStats()[Stat.HP]).toBe(271);
    expect(gyarados.getMaxHp()).toBe(683); // was 507 (95 x 1.93 = 183)

    gyarados.evs = [504, 0, 0, 0, 0, 0];
    gyarados.calculateStats();
    expect(gyarados.getMaxHp()).toBe(statOf(271, 31, 504, 100, true)); // 683 + 126
    expect(gyarados.getMaxHp()).toBe(809);

    vitamin.stackCount = 31;
    gyarados.calculateStats();
    // 95 x 4.1 = 389, x 2.86 = 1112 (rounded down at each step); (2224 + 31 + 126) + 110
    expect(gyarados.calculateBaseStats()[Stat.HP]).toBe(1112);
    expect(gyarados.getMaxHp()).toBe(2491);

    // Attack with the same 31 / 31 / 252: 125 x 4.1 = 512, x 1.93 = 988; (1976 + 31 + 63) + 5, as before the change
    give(gyarados, vitaminType(Stat.ATK), 31);
    give(gyarados, candyType(Stat.ATK), 31);
    gyarados.evs = [504, 252, 0, 0, 0, 0];
    gyarados.calculateStats();
    expect(gyarados.calculateBaseStats()[Stat.ATK]).toBe(988);
    expect(gyarados.getStat(Stat.ATK, false)).toBe(2075);
    for (const stat of [Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD] as const) {
      expect(gyarados.getStat(stat, false), Stat[stat]).toBe(statOf(GYARADOS[stat], 31, 0, 100, false));
    }
  });

  // Local fork (2026-11-13): 09 명세 2-2; an enemy's HP vitamins were +15% and its Health Candies +6% until then
  it("make an enemy's HP vitamins +10% like the player's and its Health Candies +3%, not 6%", async () => {
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    const enemy = game.field.getEnemyPokemon();
    game.scene.clearEnemyHeldItemModifiers(enemy); // no random wild item in the way
    enemy.ivs = [31, 31, 31, 31, 31, 31];
    const raw = enemy.getSpeciesForm(true).baseStats[Stat.HP]; // Magikarp: 20
    for (const type of [vitaminType(Stat.HP), vitaminType(Stat.ATK), candyType(Stat.HP), candyType(Stat.ATK)]) {
      await game.scene.addEnemyModifier(type.newModifier(enemy) as PokemonHeldItemModifier, true, true);
    }
    expect(enemy.getHeldItems()).toHaveLength(4);
    for (const m of enemy.getHeldItems()) {
      m.stackCount = 31;
    }
    const stats = enemy.calculateBaseStats();
    // 20 x 4.1 = 82, x 1.93 = 158.26 (a player's 6% would give 234)
    expect(stats[Stat.HP]).toBe(Math.floor((Math.floor(raw * (1 + 31 * 0.1)) * 193) / 100));
    expect(stats[Stat.HP]).toBe(158);
    // Attack: 10 x 4.1 = 41, x 1.93 = 79, as for the player
    const rawAtk = enemy.getSpeciesForm(true).baseStats[Stat.ATK];
    expect(stats[Stat.ATK]).toBe(Math.floor((Math.floor(rawAtk * (1 + 31 * 0.1)) * 193) / 100));

    // the same candies through the modifier itself: 3% on the enemy, 6% on the player's Gyarados
    const player = game.field.getPlayerPokemon();
    expect(applyCandy(enemy, Stat.HP, 442, 31)).toBe(853);
    expect(applyCandy(player, Stat.HP, 442, 31)).toBe(1264);
    expect(applyCandy(enemy, Stat.HP, 100, 1)).toBe(103);
    expect(applyCandy(enemy, Stat.ATK, 100, 1)).toBe(applyCandy(player, Stat.ATK, 100, 1));
    // the item's text shows the player's 6%
    expect(candyType(Stat.HP).getDescription()).toContain("6%");
  });

  it("give a copy of the player's Pokémon on the enemy side (Training Session, ???) the enemy's 3% Health Candy", async () => {
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    const gyarados = game.field.getPlayerPokemon();
    give(gyarados, vitaminType(Stat.HP), 31);
    give(gyarados, candyType(Stat.HP), 31);
    expect(gyarados.calculateBaseStats()[Stat.HP]).toBe(1112); // 389 x 2.86

    // the enemy copy holds clones of the same items, as getEnemyConfig in the Training Session builds it
    const enemy = game.field.getEnemyPokemon();
    game.scene.clearEnemyHeldItemModifiers(enemy);
    enemy.species = gyarados.species;
    enemy.formIndex = gyarados.formIndex;
    enemy.ivs = gyarados.ivs.slice();
    for (const m of gyarados.getHeldItems()) {
      const copy = m.clone() as PokemonHeldItemModifier;
      copy.pokemonId = enemy.id;
      await game.scene.addEnemyModifier(copy, true, true);
    }
    expect(enemy.getHeldItems().map(m => m.getStackCount())).toEqual([31, 31]);
    expect(enemy.calculateBaseStats()[Stat.HP]).toBe(750); // 389 x 1.93
    expect(gyarados.calculateBaseStats()[Stat.HP]).toBe(1112);
  });

  // Local fork (2026-11-13), round-3 review: the modifier bars' tooltips read the held candy, so an enemy's Health Candy
  // says 3% (it said the player's 6%, the type's text, after the 09 patch split the two)
  it("show the holder's percent in the modifier bars' tooltips: 3% on an enemy's Health Candy, 6% on the player's", async () => {
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    game.scene.clearEnemyHeldItemModifiers(enemy);
    player.ivs = [31, 31, 31, 31, 31, 31];
    enemy.ivs = [31, 31, 31, 31, 31, 31];
    const playerCandy = give(player, candyType(Stat.HP), 5) as IvCandyModifier;
    const enemyCandy = candyType(Stat.HP).newModifier(enemy) as IvCandyModifier;
    await game.scene.addEnemyModifier(enemyCandy, true, true);
    const enemyAtkCandy = candyType(Stat.ATK).newModifier(enemy) as IvCandyModifier;
    await game.scene.addEnemyModifier(enemyAtkCandy, true, true);
    const enemyHpText = getIvCandyDescription(Stat.HP, false);
    const playerHpText = getIvCandyDescription(Stat.HP, true);
    expect(enemyHpText).toContain("3%");
    expect(playerHpText).toContain("6%");
    expect(enemyCandy.getTooltipDescription()).toBe(enemyHpText);
    expect(playerCandy.getTooltipDescription()).toBe(playerHpText);
    expect(enemyAtkCandy.getTooltipDescription()).toBe(candyType(Stat.ATK).getDescription()); // 3% either way
    // the type's own text (reward screen, party) stays the player's
    expect(candyType(Stat.HP).getDescription()).toBe(playerHpText);
    // any other item: its type's text, as before
    const vitamin = give(player, vitaminType(Stat.HP), 3);
    expect(vitamin.getTooltipDescription()).toBe(vitamin.type.getDescription());

    // hovering each icon of the real bars (the test scene's containers drop their listeners, so catch them as the bar
    // adds them)
    const tooltips = (enemySide: boolean): string[] => {
      const hovers: (() => void)[] = [];
      const onSpy = vi.spyOn(MockContainer.prototype, "on").mockImplementation(function (
        this: MockContainer,
        event: string,
        callback: () => void,
      ) {
        if (event === "pointerover") {
          hovers.push(callback);
        }
        return this;
      });
      game.scene.updateModifiers(!enemySide, true);
      onSpy.mockRestore();
      const shown: string[] = [];
      const tipSpy = vi.spyOn(game.scene.ui, "showTooltip").mockImplementation((_title, content) => {
        shown.push(content);
      });
      for (const hover of hovers) {
        hover();
      }
      tipSpy.mockRestore();
      return shown;
    };
    const enemyTips = tooltips(true);
    expect(enemyTips).toContain(enemyHpText);
    expect(enemyTips).not.toContain(playerHpText);
    expect(tooltips(false)).toContain(playerHpText);
  });

  it("raise HP EVs up to 504 and the others up to 252 through the items; no total cap", async () => {
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    const gyarados = game.field.getPlayerPokemon();
    for (const id of ["POWER_WEIGHT", "POWER_BRACER", "POWER_BELT"] as const) {
      game.scene.addModifier(plainType(id).newModifier(gyarados), false, false, false, true);
      expect(getHeldEvItem(gyarados, id)?.getStackCount(), id).toBe(1);
    }
    let gains = 0;
    while (gainEvsFromItems(gyarados)) {
      gains++;
      if (gains === 252) {
        expect(gyarados.evs).toEqual([252, 252, 252, 0, 0, 0]);
      }
    }
    expect(gains).toBe(504);
    expect(gyarados.evs).toEqual([504, 252, 252, 0, 0, 0]);
    expect(gyarados.getMaxHp()).toBe(statOf(95, 31, 504, 100, true)); // 457 (394 at 252)
    expect(gyarados.getMaxHp()).toBe(457);
    expect(gyarados.getStat(Stat.ATK, false)).toBe(statOf(125, 31, 252, 100, false));

    // the helpers on their own
    const evs = [502, 250, 0, 0, 0, 0];
    expect(addEvs(evs, Stat.HP, 5)).toBe(true);
    expect(addEvs(evs, Stat.HP, 1)).toBe(false);
    expect(addEvs(evs, Stat.ATK, 5)).toBe(true);
    expect(addEvs(evs, Stat.ATK, 1)).toBe(false);
    expect(evs).toEqual([504, 252, 0, 0, 0, 0]);
    expect(normalizeEvs([999, 999, 300, 253, 504, "504"])).toEqual([504, 252, 252, 252, 252, 252]);
    expect(normalizeEvs([503.9, -1, 0, 0, 0, 0])).toEqual([503, 0, 0, 0, 0, 0]);
  });

  it("keep 504 HP EVs through a session save and load; old saves (no EVs, or 252) load as they were", async () => {
    await game.classicMode.startBattle(SpeciesId.GYARADOS, SpeciesId.MAGIKARP);
    const [gyarados] = game.scene.getPlayerParty();
    gyarados.evs = [504, 252, 4, 0, 0, 7];
    gyarados.calculateStats();
    gyarados.hp = gyarados.getMaxHp();
    const stats = gyarados.stats.slice();
    expect(stats[Stat.HP]).toBe(statOf(95, 31, 504, 100, true));

    const { gameData } = game.scene;
    const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
    const session = gameData.parseSessionData(json);
    expect(session.party[0].evs).toEqual([504, 252, 4, 0, 0, 7]);
    expect("evs" in session.party[1]).toBe(false);

    // a broken or edited save is held to the caps: HP 504, the others 252
    const edited = new PokemonData(JSON.parse(JSON.stringify({ ...session.party[0], evs: [700, 300, 0, 0, 0, 0] })));
    expect(edited.evs).toEqual([504, 252, 0, 0, 0, 0]);
    // an old save from before this change (HP at most 252) loads unchanged; one from before EVs has none
    const old = new PokemonData(JSON.parse(JSON.stringify({ ...session.party[0], evs: [252, 252, 0, 0, 0, 0] })));
    expect(old.evs).toEqual([252, 252, 0, 0, 0, 0]);
    const older = new PokemonData(JSON.parse(JSON.stringify({ ...session.party[0], evs: undefined })));
    expect(older.evs).toBeUndefined();

    game.reload["sessionData"] = session;
    await game.reload.reloadSession();
    const [loaded, loadedKarp] = game.scene.getPlayerParty();
    expect(loaded.evs).toEqual([504, 252, 4, 0, 0, 7]);
    expect(loaded.stats).toEqual(stats);
    expect(loadedKarp.evs).toEqual([0, 0, 0, 0, 0, 0]);
  });

  /** Opens the summary's stats page for `pokemon` and returns the EV view's labels' colours and values, per stat */
  async function evView(pokemon: Pokemon): Promise<{ gold: boolean[]; values: unknown[] }> {
    const texts = vi.spyOn(game.scene.add, "text");
    await game.scene.ui.setModeWithoutClear(UiMode.SUMMARY, pokemon, SummaryUiMode.DEFAULT, 1 /* Page.STATS */);
    const summary = game.scene.ui.getHandler() as unknown as { evContainer: { list: unknown[] } };
    const callOf = new Map<unknown, unknown[]>(texts.mock.results.map((r, i) => [r.value, texts.mock.calls[i]]));
    const calls = summary.evContainer.list.map(o => callOf.get(o)!);
    expect(calls).toHaveLength(12);
    const goldColor = getTextStyleOptions(TextStyle.SUMMARY_STATS_GOLD).styleOptions.color;
    const plainColor = getTextStyleOptions(TextStyle.SUMMARY_STATS).styleOptions.color;
    expect(goldColor).not.toBe(plainColor);
    const labels = calls.filter((_, i) => i % 2 === 0);
    return {
      gold: labels.map(c => (c[3] as { color?: unknown }).color === goldColor),
      values: calls.filter((_, i) => i % 2 === 1).map(c => c[2]),
    };
  }

  it("show HP's label in gold on the summary's EV view only at 504; the others at 252", async () => {
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    const gyarados = game.field.getPlayerPokemon();
    gyarados.evs = [504, 252, 251, 0, 0, 0];
    const { gold, values } = await evView(gyarados);
    expect(gold).toEqual([true, true, false, false, false, false]);
    expect(values).toEqual(["504", "252", "251", "0", "0", "0"]);
  });

  it("does not show HP in gold at 252 any more", async () => {
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    const gyarados = game.field.getPlayerPokemon();
    gyarados.evs = [252, 0, 0, 0, 0, 252];
    const { gold, values } = await evView(gyarados);
    expect(gold).toEqual([false, false, false, false, false, true]);
    expect(values).toEqual(["252", "0", "0", "0", "0", "252"]);
  });

  it("say 10% / 6% / 504 for the HP items and 10% / 3% / 252 for the others, in English and Korean", async () => {
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    // Local fork (2026-11-13): HP Up says 10% again since the 09 patch (15% until then)
    expect(vitaminType(Stat.HP).getDescription()).toContain("10%");
    expect(vitaminType(Stat.HP).getDescription()).not.toContain("15%");
    expect(candyType(Stat.HP).getDescription()).toContain("6%");
    for (const stat of PERMANENT_STATS.filter(s => s !== Stat.HP)) {
      expect(vitaminType(stat).getDescription(), Stat[stat]).toContain("10%");
      expect(candyType(stat).getDescription(), Stat[stat]).toContain("3%");
    }
    for (const lang of ["ko", "en"]) {
      const file = JSON.parse(readFileSync(`./locales/${lang}/modifier-type.json`, "utf8")).ModifierType;
      expect(file.BaseStatBoosterModifierType.description, lang).toContain("{{percent}}%");
      expect(file.IvCandyModifierType.description, lang).toContain("{{percent}}%");
      const cap = lang === "ko" ? (n: number) => `(최대 ${n},` : (n: number) => `(up to ${n};`;
      expect(file.POWER_WEIGHT.description, lang).toContain(cap(504));
      for (const id of ["POWER_BRACER", "POWER_BELT", "POWER_LENS", "POWER_BAND", "POWER_ANKLET"]) {
        expect(file[id].description, `${lang} ${id}`).toContain(cap(252));
      }
    }
  });

  it("the 5850 ace: an IV-31 Mega Garchomp at level 320,222 with all its HP growth and belts: x1.47 the max HP of before", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const ace = game.field.getPlayerPokemon();
    ace.formIndex = speciesDataRegistry
      .getSpecies(SpeciesId.GARCHOMP)
      .forms.findIndex(f => f.formKey === SpeciesFormKey.MEGA);
    expect(ace.getSpeciesForm(true).baseStats[Stat.HP]).toBe(108);
    ace.level = 320_222;
    ace.ivs = [31, 31, 31, 31, 31, 31];
    ace.evs = [504, 252, 252, 252, 252, 252];
    give(ace, vitaminType(Stat.HP), 31);
    give(ace, candyType(Stat.HP), 31);
    give(ace, plainType("WEIGHT_BAND"), 3);
    give(ace, plainType("CHAMPION_BELT"), 1);

    // Local fork (2026-11-13): 09 patch (HP vitamin 10%, the player's Health Candy 6%, HP EVs 504): 108 x 4.1 = 442,
    // x 2.86 = 1264; floor((2528 + 31 + 126) x 3202.22) = 8,597,960, + 320,232 = 8,918,192; the belts +75%:
    // 15,606,836 (with the 15% HP vitamin it was 610, 1744 and 20,986,565). 09 명세 2-3 says about 15.46M: it is 15.61M
    expect(ace.calculateBaseStats()[Stat.HP]).toBe(1264);
    expect(ace.getMaxHp()).toBe(15_606_836);

    // before (10% / 3% / 252): 108 x 4.1 = 442, x 1.93 = 853; floor((1706 + 31 + 63) x 3202.22) = 5,763,996,
    // + 320,232 = 6,084,228; +75%: 10,647,399
    const oldBase = Math.floor((Math.floor(108 * (1 + 31 * 0.1)) * 193) / 100);
    expect(oldBase).toBe(853);
    const oldMax = Math.floor(((2 * oldBase + 31 + 63) * 320_222) / 100) + 320_222 + 10;
    expect(Math.floor((oldMax * 175) / 100)).toBe(10_647_399);
    expect(ace.getMaxHp() / 10_647_399).toBeCloseTo(1.466, 3); // 09 명세 2-3 says x1.45

    // 09 명세 2-3's other line, the Health Candy at 3% with 504 HP EVs: 853; floor((1706 + 31 + 126) x 3202.22) =
    // 5,965,735, + 320,232 = 6,285,967; +75%: 11,000,442 (the spec says about 11.05M)
    const at3 = Math.floor(((2 * oldBase + 31 + 126) * 320_222) / 100) + 320_222 + 10;
    expect(Math.floor((at3 * 175) / 100)).toBe(11_000_442);
  });

  it("the 5850 ace with ten Forged Steel: base HP 108 doubled first, then the vitamins and candies", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const ace = game.field.getPlayerPokemon();
    ace.formIndex = speciesDataRegistry
      .getSpecies(SpeciesId.GARCHOMP)
      .forms.findIndex(f => f.formKey === SpeciesFormKey.MEGA);
    ace.level = 320_222;
    ace.ivs = [31, 31, 31, 31, 31, 31];
    ace.evs = [504, 252, 252, 252, 252, 252];
    give(ace, vitaminType(Stat.HP), 31);
    give(ace, candyType(Stat.HP), 31);
    give(ace, plainType("WEIGHT_BAND"), 3);
    give(ace, plainType("CHAMPION_BELT"), 1);
    give(ace, modifierTypes.FORGED_STEEL().withIdFromFunc(modifierTypes.FORGED_STEEL), 10);
    // 108 x 2.0 = 216 (Forged Steel, the first step), x 4.1 = 885, x 2.86 = 2531;
    // floor((5062 + 31 + 126) x 3202.22) + 320,232 = 17,032,618; +75%: 29,807,081 (x1.91 the 15,606,836 without it)
    expect(ace.calculateBaseStats()[Stat.HP]).toBe(2531);
    expect(ace.getMaxHp()).toBe(29_807_081);
  });
});
