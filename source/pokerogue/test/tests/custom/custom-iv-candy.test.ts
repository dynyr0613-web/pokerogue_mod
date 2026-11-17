import { getGameMode } from "#app/game-mode";
import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { GameModes } from "#enums/game-modes";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { PERMANENT_STATS, type PermanentStat, Stat } from "#enums/stat";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import { IV_CANDY_PERCENT_PER_STACK, IvCandyModifier } from "#modifiers/custom-held-items";
import { BaseStatModifier, type PokemonHeldItemModifier } from "#modifiers/modifier";
import {
  getOfferableIvCandyStats,
  IvCandyModifierType,
  type ModifierType,
  type ModifierTypeGenerator,
} from "#modifiers/modifier-type";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import { getModifierPoolForType } from "#utils/modifier-utils";
import { readFileSync } from "node:fs";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local fork, the user's request of 2026-11-06: "일반 등급 보상에 개체값사탕을 넣어두죠 ... 영양 드링크랑 같은 작용을
 * 하되 개당 3%". Icons and names are Cobblemon's six IV candies (MPL-2.0, CREDITS.md).
 */
describe("Custom - IV Candy (COMMON vitamin, 3% per candy)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH])
      .startingLevel(50);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function startEndless(species: SpeciesId[]): Promise<void> {
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.ENDLESS);
      game.scene.offsetGym = false;
      const starters = generateStarters(game.scene, species);
      const selectStarterPhase = new SelectStarterPhase();
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      selectStarterPhase.initBattle(starters);
    });
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    await game.phaseInterceptor.to("CommandPhase", false);
  }

  /** A generator with its id set, as the reward pool and `generateModifierType` give it (saves need the id) */
  function generator(id: "IV_CANDY" | "BASE_STAT_BOOSTER"): ModifierTypeGenerator {
    const gen = modifierTypes[id]() as ModifierTypeGenerator;
    gen.id = id;
    return gen;
  }
  const candyGenerator = () => generator("IV_CANDY");
  const candyType = (stat: PermanentStat) => candyGenerator().generateType([], [stat]) as IvCandyModifierType;
  const vitaminType = (stat: PermanentStat) => generator("BASE_STAT_BOOSTER").generateType([], [stat])!;

  /** Gives `pokemon` `count` of the held item made by `type`, past any cap, and returns the stack */
  function give(pokemon: Pokemon, type: ModifierType, count: number): PokemonHeldItemModifier {
    const mod = type.newModifier(pokemon) as PokemonHeldItemModifier;
    game.scene.addModifier(mod, true, false, false, true);
    const held = pokemon.getHeldItems().find(m => m.match(mod))!;
    held.stackCount = count;
    pokemon.calculateStats();
    return held;
  }

  function candyPoolEntries() {
    const pool = getModifierPoolForType(ModifierPoolType.PLAYER);
    return Object.entries(pool).flatMap(([tier, entries]) =>
      entries.filter(w => w.modifierType.id === "IV_CANDY").map(w => ({ tier: Number(tier), entry: w })),
    );
  }

  /** The base stats before any held item touches them (what vitamins and candies scale) */
  function rawBaseStats(pokemon: Pokemon): number[] {
    return pokemon.getSpeciesForm(true).baseStats.slice(0);
  }

  it("sits in the player's COMMON pool only, weight 3", async () => {
    await startEndless([SpeciesId.FEEBAS]);
    const entries = candyPoolEntries();
    expect(entries.map(e => e.tier)).toEqual([ModifierTier.COMMON]);
    const { entry } = entries[0];
    expect(entry.maxWeight).toBe(3);
    expect((entry.weight as WeightedModifierTypeWeightFunc)(game.scene.getPlayerParty(), 0)).toBe(3);
    for (const poolType of [ModifierPoolType.WILD, ModifierPoolType.TRAINER]) {
      const other = Object.values(getModifierPoolForType(poolType)).flat();
      expect(other.some(w => w.modifierType.id === "IV_CANDY")).toBe(false);
    }
  });

  it("raises one base stat by 3% per candy, multiplied on top of the vitamins", async () => {
    await startEndless([SpeciesId.FEEBAS]);
    const [feebas] = game.scene.getPlayerParty();
    feebas.ivs = [31, 31, 31, 31, 31, 31];
    const raw = rawBaseStats(feebas);

    give(feebas, candyType(Stat.SPATK), 10);
    let stats = feebas.calculateBaseStats();
    expect(stats[Stat.SPATK]).toBe(raw[Stat.SPATK] + Math.floor(raw[Stat.SPATK] * 0.3));
    for (const s of PERMANENT_STATS.filter(s => s !== Stat.SPATK)) {
      expect(stats[s], `stat ${s}`).toBe(raw[s]);
    }

    give(feebas, vitaminType(Stat.SPATK), 10);
    stats = feebas.calculateBaseStats();
    // 10 vitamins (x2), then 10 candies multiply that by 1.3: x2.6 (the user: "곱연산"), not 2 + 0.3 = x2.3
    const withVitamins = Math.floor(raw[Stat.SPATK] * 2);
    expect(stats[Stat.SPATK]).toBe(Math.floor((withVitamins * 130) / 100));
    expect(stats[Stat.SPATK]).toBeGreaterThan(withVitamins + Math.floor(raw[Stat.SPATK] * 0.3));
    expect(IV_CANDY_PERCENT_PER_STACK).toBe(3);
  });

  it.each([
    [90, 10, 27],
    [60, 15, 27],
    [120, 25, 90],
    [77, 1, 2],
  ])(
    "multiplies by exactly 1 + 3%% per candy, rounded down (base %i, %i candies: +%i)",
    async (base, stacks, bonus) => {
      await startEndless([SpeciesId.FEEBAS]);
      const [feebas] = game.scene.getPlayerParty();
      const candy = candyType(Stat.ATK).newModifier(feebas) as IvCandyModifier;
      candy.stackCount = stacks;
      const stats = [base, base, base, base, base, base];
      candy.apply(feebas, stats);
      expect(stats[Stat.ATK]).toBe(base + bonus);
    },
  );

  it("keeps its own stack per stat, apart from the vitamins, up to the holder's IV, and cannot be moved", async () => {
    await startEndless([SpeciesId.FEEBAS, SpeciesId.MAGIKARP]);
    const [feebas] = game.scene.getPlayerParty();
    feebas.ivs = [31, 12, 31, 31, 31, 0];

    const atk = give(feebas, candyType(Stat.ATK), 1) as IvCandyModifier;
    give(feebas, candyType(Stat.DEF), 1);
    give(feebas, vitaminType(Stat.ATK), 1);
    const held = feebas.getHeldItems();
    expect(held.filter(m => m instanceof IvCandyModifier)).toHaveLength(2);
    expect(held.filter(m => m instanceof BaseStatModifier)).toHaveLength(1);
    expect(atk.isTransferable).toBe(false);
    expect(atk.getMaxHeldItemCount(feebas)).toBe(12);
    expect(candyType(Stat.SPD).newModifier(feebas)!.getMaxHeldItemCount(feebas)).toBe(0);

    atk.stackCount = 12;
    game.scene.addModifier(candyType(Stat.ATK).newModifier(feebas)!, true, false, false, true);
    expect(atk.getStackCount()).toBe(12);
  });

  it("leaves out a candy every party member is full of, and weighs 0 once all six are", async () => {
    await startEndless([SpeciesId.FEEBAS, SpeciesId.MAGIKARP]);
    const party = game.scene.getPlayerParty();
    const [a, b] = party;
    a.ivs = [2, 2, 2, 2, 2, 2];
    b.ivs = [1, 1, 1, 1, 1, 0];
    const weight = candyPoolEntries()[0].entry.weight as WeightedModifierTypeWeightFunc;

    expect(getOfferableIvCandyStats(party)).toEqual([...PERMANENT_STATS]);
    // one member full of Attack candies: the other can still take one, so Attack stays
    give(a, candyType(Stat.ATK), 2);
    expect(getOfferableIvCandyStats(party)).toContain(Stat.ATK);
    give(b, candyType(Stat.ATK), 1);
    expect(getOfferableIvCandyStats(party)).not.toContain(Stat.ATK);

    // Speed: b's IV is 0, so only a counts
    give(a, candyType(Stat.SPD), 2);
    expect(getOfferableIvCandyStats(party)).toEqual([Stat.HP, Stat.DEF, Stat.SPATK, Stat.SPDEF]);
    for (let i = 0; i < 30; i++) {
      const stat = (candyGenerator().generateType(party) as IvCandyModifierType).getStat();
      expect([Stat.HP, Stat.DEF, Stat.SPATK, Stat.SPDEF]).toContain(stat);
    }

    for (const s of [Stat.HP, Stat.DEF, Stat.SPATK, Stat.SPDEF] as const) {
      give(a, candyType(s), 2);
      give(b, candyType(s), 1);
    }
    expect(getOfferableIvCandyStats(party)).toEqual([]);
    expect(candyGenerator().generateType(party)).toBeNull();
    expect(weight(party, 0)).toBe(0);

    // a named candy (encounter, override) and an enemy party are not filtered
    expect((candyGenerator().generateType(party, [Stat.ATK]) as IvCandyModifierType).getStat()).toBe(Stat.ATK);
    expect(candyGenerator().generateType([game.field.getEnemyPokemon()])).not.toBeNull();
  });

  it("shows Cobblemon's names and icons and says 3%", async () => {
    await startEndless([SpeciesId.FEEBAS]);
    const atlas = JSON.parse(readFileSync("assets/images/items.json", "utf-8"));
    const frames = new Set(atlas.textures[0].frames.map((f: { filename: string }) => f.filename));
    for (const stat of PERMANENT_STATS) {
      const type = candyType(stat);
      expect(frames.has(type.iconImage), type.iconImage).toBe(true);
      expect(type.iconImage).toBe(IvCandyModifierType.items[stat]);
      expect(type.name).toBe(i18next.t(`modifierType:IvCandyItem.${type.iconImage}`));
      expect(type.name).not.toContain("IvCandyItem");
    }
    expect(candyType(Stat.HP).name).toBe("Health Candy");
    expect(candyType(Stat.SPD).name).toBe("Quick Candy");
    expect(candyType(Stat.ATK).getDescription()).toContain("3%");
  });

  it("keeps the candies, their stat and their boost through a session save and load", async () => {
    await startEndless([SpeciesId.FEEBAS]);
    const [feebas] = game.scene.getPlayerParty();
    feebas.ivs = [31, 31, 31, 31, 31, 31];
    give(feebas, candyType(Stat.SPDEF), 7);
    const boosted = feebas.calculateBaseStats()[Stat.SPDEF];
    expect(boosted).toBeGreaterThan(rawBaseStats(feebas)[Stat.SPDEF]);

    const { gameData } = game.scene;
    const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
    const session = gameData.parseSessionData(json);
    game.reload["sessionData"] = session;
    await game.reload.reloadSession();

    const [loaded] = game.scene.getPlayerParty();
    const candies = loaded.getHeldItems().filter((m): m is IvCandyModifier => m instanceof IvCandyModifier);
    expect(candies).toHaveLength(1);
    expect(candies[0].getStat()).toBe(Stat.SPDEF);
    expect(candies[0].getStackCount()).toBe(7);
    expect(candies[0].type.id).toBe("IV_CANDY");
    expect(loaded.calculateBaseStats()[Stat.SPDEF]).toBe(boosted);
  });
});
