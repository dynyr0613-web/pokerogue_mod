import type { BattleScene } from "#app/battle-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { type PermanentStat, Stat } from "#enums/stat";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { FORGED_STEEL, ForgedSteelModifier, getForgedSteelTenths } from "#modifiers/custom-held-items";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import type { ModifierType, ModifierTypeGenerator } from "#modifiers/modifier-type";
import * as EncounterDialogueUtils from "#mystery-encounters/encounter-dialogue-utils";
import * as EncounterPhaseUtils from "#mystery-encounters/encounter-phase-utils";
import { generateModifierType } from "#mystery-encounters/encounter-phase-utils";
import { allMysteryEncounters, mysteryEncountersByBiome } from "#mystery-encounters/mystery-encounter-biomes";
import {
  canForgePokemon,
  forgePokemon,
  getForgedSteelCount,
  isForgedPokemon,
  isForgeEligibleSteelPokemon,
  isFullyForgedPokemon,
  rollTinkatonForgeRewards,
  TINKATON_FORGE_REWARD_TIERS,
  TINKATON_FORGE_SPAR_EXP_MULTIPLIER,
  TINKATON_FORGE_SPAR_MOVES,
  TinkatonForgeEncounter,
} from "#mystery-encounters/tinkaton-forge-encounter";
import { TitlePhase } from "#phases/title-phase";
import { GameManager } from "#test/framework/game-manager";
import { TextInterceptor } from "#test/framework/text-interceptor";
import { runMysteryEncounterToEnd, runSelectMysteryEncounterOption } from "#test/utils/encounter-test-utils";
import { MessageUiHandler } from "#ui/message-ui-handler";
import { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import type { MysteryEncounterUiHandler } from "#ui/mystery-encounter-ui-handler";
import { PartyUiHandler, type PokemonSelectFilter } from "#ui/party-ui-handler";
import i18next from "i18next";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const namespace = "mysteryEncounters/tinkatonForge";
/** Skarmory 65/80/140/40/70/70: HP 65 x 1.1 = 71.5 shows the rounding down */
const defaultParty = [SpeciesId.SKARMORY, SpeciesId.LAPRAS, SpeciesId.MAGNEMITE];
const defaultBiome = BiomeId.CAVE;
const defaultWave = 45;
const FORGE_BIOMES: readonly BiomeId[] = [
  BiomeId.MOUNTAIN,
  BiomeId.CAVE,
  BiomeId.VOLCANO,
  BiomeId.FACTORY,
  BiomeId.CONSTRUCTION_SITE,
];
/** A level that makes Tinkaton's EXP a whole number: 253 * 35 / 5 + 1 = 1772 */
const SPAR_LEVEL = 35;
const koFiles = import.meta.glob("../../../locales/ko/**/*.json", { eager: true, import: "default" });
/** Local fork (2026-11-12): the English texts of the forge and the item, read straight from the files */
const enFiles = import.meta.glob(
  ["../../../locales/en/mystery-encounters/tinkaton-forge-dialogue.json", "../../../locales/en/modifier-type.json"],
  { eager: true, import: "default" },
);

/**
 * Local fork (2026-11-08), the user's design: the ULTRA-tier "두드리짱의 대장간" (Tinkaton's Forge). Option 1 is a
 * reward screen of one Rogue and three Ultra items, option 2 forges a Steel type (x1.1 HP/Def/SpDef base stats as
 * the first step of the base-stat calculation), option 3 is a spar with a +1 Attack Tinkaton for 3x its EXP.
 * Local fork (2026-11-12): option 2 takes any type, up to five pieces of Forged Steel, +10% per piece added up (the
 * user: "저희 단조강철의 개수 제한을 5개로 풀고, 강철타입이 아니어도 쓸 수 있게 하는것도 좋을 것 같네요").
 * Local fork (2026-11-13): up to ten pieces since the 3rd balance patch (09 명세 3-2: "`5개 ×1.5`, `10개 ×2.0`").
 * Local fork (2026-11-13): 10 명세 3번, option 2 forges a Steel type only again (a fusion's types counted, fainted or
 * not) and gives two pieces a forge, cut at ten (0 -> 2 -> 4 -> 6 -> 8 -> 10; nine -> ten). A non-Steel Pokémon
 * forged in the any-type days keeps its pieces and their boost but gets no more.
 */
describe("Custom mystery encounter - Tinkaton's Forge (TINKATON_FORGE)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let scene: BattleScene;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    // Put the Korean text straight into i18next instead of loading it over `fetch`: every GameManager replaces the
    // global `fetch` with a mock that can't serve locale files, and in the full suite (`isolate: false`) an earlier
    // test file has already done so before this one starts
    const { loadPath } = i18next.options.backend as { loadPath: (lng: string, ns: string[]) => string };
    for (const ns of i18next.options.ns as readonly string[]) {
      const file = /locales\/ko\/(.+?\.json)/.exec(loadPath("ko", [ns]))?.[1];
      const json = file ? koFiles[`../../../locales/ko/${file}`] : undefined;
      if (json) {
        i18next.addResourceBundle("ko", ns, json, true, true);
      }
    }
    expect(i18next.hasResourceBundle("ko", namespace)).toBe(true);
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    scene = game.scene;
    game.override
      .mysteryEncounterChance(100)
      .startingWave(defaultWave)
      .startingBiome(defaultBiome)
      .disableTrainerWaves();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function startEncounter(party = defaultParty): Promise<PlayerPokemon[]> {
    await game.runToMysteryEncounter(MysteryEncounterType.TINKATON_FORGE, party);
    scene.modifiers = [];
    await scene.updateModifiers(true);
    return scene.getPlayerParty();
  }

  /** The species' (and a fusion partner's) base stats before anything is applied */
  const speciesBase = (id: SpeciesId): number[] => speciesDataRegistry.getSpecies(id).baseStats.slice(0);
  /** `stats` with `pieces` of Forged Steel: HP/Def/SpDef x(10 + pieces) / 10 in whole numbers, rounded down once */
  const forged = (stats: readonly number[], pieces = 1): number[] =>
    stats.map((v, s) => (FORGED_STEEL.stats.includes(s as PermanentStat) ? Math.floor((v * (10 + pieces)) / 10) : v));

  function giveHeld(pokemon: Pokemon, type: ModifierType, count: number): PokemonHeldItemModifier {
    const modifier = type.newModifier(pokemon) as PokemonHeldItemModifier;
    scene.addModifier(modifier, true, false, false, true);
    const held = pokemon.getHeldItems().find(m => m.match(modifier))!;
    held.stackCount = count;
    pokemon.calculateStats();
    return held;
  }
  /** A generator with its id set, as `generateModifierType` gives it (saves need the id) */
  function generated(id: "IV_CANDY" | "BASE_STAT_BOOSTER", stat: PermanentStat): ModifierType {
    const gen = modifierTypes[id]() as ModifierTypeGenerator;
    gen.id = id;
    return gen.generateType([], [stat])!;
  }

  const forgedSteelOf = (pokemon: Pokemon) =>
    pokemon.getHeldItems().filter((m): m is ForgedSteelModifier => m instanceof ForgedSteelModifier);

  /**
   * Local fork (2026-11-13): sets the pieces of Forged Steel `pokemon` holds to `count`, whatever its type (as a save
   * from the any-type days, 2026-11-12 to the 10 명세, can hold them), with its stats recalculated; 0 takes them away
   */
  function setForged(pokemon: Pokemon, count: number): void {
    for (const steel of forgedSteelOf(pokemon)) {
      scene.removeModifier(steel);
    }
    if (count > 0) {
      giveHeld(pokemon, generateModifierType(modifierTypes.FORGED_STEEL)!, count);
    }
    pokemon.calculateStats();
  }

  /** Local fork (2026-11-13): forges `pokemon` `times` times; each forge adds what is expected (two, one at nine) */
  function forgeTimes(pokemon: PlayerPokemon, times: number): void {
    for (let i = 0; i < times; i++) {
      const before = getForgedSteelCount(pokemon);
      expect(forgePokemon(pokemon)).toBe(Math.min(FORGED_STEEL.stacksPerForge, FORGED_STEEL.maxHeld - before));
    }
  }

  describe("registration", () => {
    it("is an ULTRA-tier encounter after the other new one in the enum, with three options, its sprite and its text", async () => {
      await startEncounter();

      expect(MysteryEncounterType.DARK_MYSTERIOUS_CHEST).toBe(MysteryEncounterType.DARK_GLOBAL_TRADE_SYSTEM + 1);
      expect(MysteryEncounterType.TINKATON_FORGE).toBe(MysteryEncounterType.DARK_MYSTERIOUS_CHEST + 1);
      expect(allMysteryEncounters[MysteryEncounterType.TINKATON_FORGE]).toBe(TinkatonForgeEncounter);
      expect(TinkatonForgeEncounter.encounterTier).toBe(MysteryEncounterTier.ULTRA);
      expect(TinkatonForgeEncounter.options).toHaveLength(3);
      expect(TinkatonForgeEncounter.requirements).toHaveLength(1); // the wave range only, no party requirement
      const [sprite] = TinkatonForgeEncounter.spriteConfigs;
      expect(sprite.spriteKey).toBe("tinkaton_forge");
      expect(sprite.fileRoot).toBe("mystery-encounters");
      expect(sprite.hasShadow).toBe(true);
      expect(i18next.t(`${namespace}:title`)).toBe("Tinkaton's Forge");
      expect(i18next.t(`${namespace}:option.1.label`)).toBe("Ask it to forge some gear");
      expect(i18next.t(`${namespace}:option.2.label`)).toBe("Forge the steel");
      expect(i18next.t(`${namespace}:option.3.label`)).toBe("A friendly spar with Tinkaton!");
      expect(scene.currentBattle.mysteryEncounter?.encounterType).toBe(MysteryEncounterType.TINKATON_FORGE);
      expect(i18next.t("modifierType:ModifierType.FORGED_STEEL.name")).toBe("Forged Steel");
    });

    it("spawns in the mountain, cave, volcano, factory and construction site, and nowhere else", () => {
      for (const biome of FORGE_BIOMES) {
        expect(mysteryEncountersByBiome.get(biome), `biome ${BiomeId[biome]}`).toContain(
          MysteryEncounterType.TINKATON_FORGE,
        );
      }
      for (const [biome, encounters] of mysteryEncountersByBiome) {
        if (!FORGE_BIOMES.includes(biome)) {
          expect(encounters, `biome ${BiomeId[biome]}`).not.toContain(MysteryEncounterType.TINKATON_FORGE);
        }
      }
      // the biomes keep their own encounters
      expect(mysteryEncountersByBiome.get(BiomeId.CAVE)).toContain(MysteryEncounterType.THE_STRONG_STUFF);
      expect(mysteryEncountersByBiome.get(BiomeId.VOLCANO)).toContain(MysteryEncounterType.FIERY_FALLOUT);
    });
  });

  describe("option 1 - ask for gear", () => {
    it("shows a reward screen of four different items, one Rogue then three Ultra, with no reroll", async () => {
      await startEncounter();
      await runMysteryEncounterToEnd(game, 1);
      await game.phaseInterceptor.to("SelectModifierPhase", false);
      expect(game).toBeAtPhase("SelectModifierPhase");
      await game.phaseInterceptor.to("SelectModifierPhase");

      expect(scene.ui.mode).toBe(UiMode.MODIFIER_SELECT);
      const handler = scene.ui.handlers.find(h => h instanceof ModifierSelectUiHandler) as ModifierSelectUiHandler;
      const types = handler.options.map(o => o.modifierTypeOption.type);
      expect(types).toHaveLength(4);
      expect(types.map(t => t.tier)).toEqual([
        ModifierTier.ROGUE,
        ModifierTier.ULTRA,
        ModifierTier.ULTRA,
        ModifierTier.ULTRA,
      ]);
      expect(new Set(types.map(t => t.name)).size).toBe(4);
      expect(handler["rerollCost"]).toBe(-1);
      expect(game.textInterceptor.logs.some(l => l.includes("Tinkaton happily swung its hammer!"))).toBe(true);
    });

    it("rolls four different items in the order Rogue, Ultra, Ultra, Ultra whatever the seed", async () => {
      await startEncounter();
      expect(TINKATON_FORGE_REWARD_TIERS).toEqual([
        ModifierTier.ROGUE,
        ModifierTier.ULTRA,
        ModifierTier.ULTRA,
        ModifierTier.ULTRA,
      ]);
      for (let i = 0; i < 40; i++) {
        scene.setSeed(`tinkaton-forge-${i}`);
        scene.resetSeed(1);
        const offers = rollTinkatonForgeRewards();
        expect(offers.map(o => o.type.tier)).toEqual([...TINKATON_FORGE_REWARD_TIERS]);
        expect(new Set(offers.map(o => o.type.name)).size).toBe(4);
      }
    });
  });

  describe("option 2 - forge the steel", () => {
    // Local fork (2026-11-12): any type until the 10 명세; until 2026-11-12 a Steel type not forged yet
    // Local fork (2026-11-13): 10 명세 3번, a Steel type with fewer than ten pieces again
    it("needs a Steel-type party member holding fewer than ten pieces", async () => {
      const [lapras, abra] = await startEncounter([SpeciesId.LAPRAS, SpeciesId.ABRA]);
      const option = TinkatonForgeEncounter.options[1];
      expect(lapras.isOfType(PokemonType.STEEL) || abra.isOfType(PokemonType.STEEL)).toBe(false);
      expect(isForgeEligibleSteelPokemon(lapras) || isForgeEligibleSteelPokemon(abra)).toBe(false);
      expect(canForgePokemon(lapras)).toBe(false);
      expect(canForgePokemon(abra)).toBe(false);
      expect(option.meetsRequirements()).toBe(false); // no Steel type at all
      expect(TinkatonForgeEncounter.options[0].meetsRequirements()).toBe(true);
      expect(TinkatonForgeEncounter.options[2].meetsRequirements()).toBe(true);
    });

    it("is enabled by one Steel type with fewer than ten pieces and disabled once every Steel type holds ten", async () => {
      const [skarmory, lapras, magnemite] = await startEncounter();
      const option = TinkatonForgeEncounter.options[1];
      expect(isForgeEligibleSteelPokemon(skarmory)).toBe(true); // Steel/Flying
      expect(isForgeEligibleSteelPokemon(magnemite)).toBe(true); // Electric/Steel
      expect(isForgeEligibleSteelPokemon(lapras)).toBe(false);
      expect(option.meetsRequirements()).toBe(true);

      forgeTimes(skarmory, 4);
      expect(getForgedSteelCount(skarmory)).toBe(8);
      expect(canForgePokemon(skarmory)).toBe(true); // eight pieces: two more still fit
      forgeTimes(skarmory, 1);
      expect(isFullyForgedPokemon(skarmory)).toBe(true);
      expect(canForgePokemon(skarmory)).toBe(false);
      expect(option.meetsRequirements()).toBe(true); // Magnemite can still be forged

      setForged(magnemite, 9);
      expect(canForgePokemon(magnemite)).toBe(true); // nine pieces: a tenth is still offered
      expect(option.meetsRequirements()).toBe(true);
      forgeTimes(magnemite, 1);
      expect(getForgedSteelCount(magnemite)).toBe(10);
      expect(canForgePokemon(magnemite)).toBe(false);
      // every Steel type holds ten; Lapras, not a Steel type, doesn't count with none
      expect(getForgedSteelCount(lapras)).toBe(0);
      expect(option.meetsRequirements()).toBe(false);
    });

    // 10 명세 3번: "합체 포켓몬은 합체 후 현재 타입 기준, 기절 여부 무관"
    it("counts a fusion's types and a fainted Steel type, not a Tera type, Soak or Forest's Curse", async () => {
      const [skarmory, lapras, magnemite] = await startEncounter();
      // Lapras (Water/Ice) fused with Klink (Steel): Water/Steel
      lapras.fusionSpecies = speciesDataRegistry.getSpecies(SpeciesId.KLINK);
      lapras.fusionFormIndex = 0;
      lapras.fusionAbilityIndex = 0;
      lapras.calculateStats();
      expect(lapras.getTypes()).toEqual([PokemonType.WATER, PokemonType.STEEL]);
      expect(canForgePokemon(lapras)).toBe(true);
      expect(forgePokemon(lapras)).toBe(2);
      expect(getForgedSteelCount(lapras)).toBe(2);

      // a fainted Steel type can be forged too
      magnemite.hp = 0;
      expect(magnemite.isFainted()).toBe(true);
      expect(canForgePokemon(magnemite)).toBe(true);
      expect(forgePokemon(magnemite)).toBe(2);
      expect(magnemite.hp).toBe(0);

      // only its own types: a Water Tera type, Soak's Water and Forest's Curse's Grass change nothing
      skarmory.teraType = PokemonType.WATER;
      skarmory.isTerastallized = true;
      skarmory.summonData.types = [PokemonType.WATER];
      skarmory.summonData.addedType = PokemonType.GRASS;
      expect(skarmory.isOfType(PokemonType.STEEL)).toBe(false);
      expect(canForgePokemon(skarmory)).toBe(true);
      // and the other way: unfused, Lapras with a Steel Tera type and Steel added on top is still no Steel type
      lapras.fusionSpecies = null;
      lapras.calculateStats();
      lapras.teraType = PokemonType.STEEL;
      lapras.isTerastallized = true;
      lapras.summonData.addedType = PokemonType.STEEL;
      expect(lapras.isOfType(PokemonType.STEEL)).toBe(true);
      expect(isForgeEligibleSteelPokemon(lapras)).toBe(false);
      expect(forgePokemon(lapras)).toBe(0);
      expect(getForgedSteelCount(lapras)).toBe(2); // the two from its fused days stay
    });

    it("forges the chosen Pokémon for good, raises its HP by the max HP gained, and ends with no reward screen", async () => {
      // Local fork (2026-11-08), review fix: at the default level 5 the +6 base HP is worth 0 or 1 max HP depending
      // on the random IV (0 for 10 of the 32 IVs), so this failed about a third of the time; at level 50 it is +6
      game.override.startingLevel(50);
      const [skarmory, lapras, magnemite] = await startEncounter();
      const maxBefore = skarmory.getMaxHp();
      expect(maxBefore).toBe(Math.floor(((2 * 65 + skarmory.ivs[Stat.HP]) * 50) / 100) + 50 + 10);
      skarmory.hp = maxBefore - 10;
      const leave = vi.spyOn(EncounterPhaseUtils, "leaveEncounterWithoutBattle");

      await runMysteryEncounterToEnd(game, 2, { pokemonNo: 1 });

      // Local fork (2026-11-13): 10 명세 3번, two pieces in one forge, one stack
      expect(forgedSteelOf(skarmory)).toHaveLength(1);
      expect(forgedSteelOf(skarmory)[0].getStackCount()).toBe(2);
      expect(forgedSteelOf(skarmory)[0].isTransferable).toBe(false);
      expect(forgedSteelOf(skarmory)[0].type.id).toBe("FORGED_STEEL");
      expect(isForgedPokemon(lapras) || isForgedPokemon(magnemite)).toBe(false);
      // two pieces, x1.2: HP 65 -> 78, Def 140 -> 168, SpDef 70 -> 84
      expect(skarmory.calculateBaseStats()).toEqual([78, 80, 168, 40, 84, 70]);
      expect(skarmory.getMaxHp()).toBe(maxBefore + 13);
      expect(skarmory.hp).toBe(skarmory.getMaxHp() - 10);

      expect(leave).toHaveBeenCalledTimes(1);
      expect(leave.mock.calls[0][0] ?? false).toBe(false);
      expect(scene.currentBattle.mysteryEncounter?.doEncounterRewards).toBeUndefined();
      expect(scene.phaseManager.hasPhaseOfType("SelectModifierPhase")).toBe(false);
      const logs = game.textInterceptor.logs;
      expect(logs.some(l => l.includes("Tinkaton gave Skarmory a mighty pounding!"))).toBe(true);
      expect(logs.some(l => l.includes("Skarmory's body became even sturdier!"))).toBe(true);
    });

    // Local fork (2026-11-13): 10 명세 3번, a Steel type only again (it was any type from 2026-11-12)
    it("does not forge a Pokémon that is not a Steel type", async () => {
      const [skarmory, lapras, magnemite] = await startEncounter();
      expect(lapras.isOfType(PokemonType.STEEL)).toBe(false);
      const balls = [...Object.values(scene.pokeballCounts)];

      expect(forgePokemon(lapras)).toBe(0);

      expect(forgedSteelOf(lapras)).toHaveLength(0);
      expect(isForgedPokemon(skarmory) || isForgedPokemon(magnemite)).toBe(false);
      expect(lapras.calculateBaseStats()).toEqual(speciesBase(SpeciesId.LAPRAS));
      // no stack-full fallback either
      expect(Object.values(scene.pokeballCounts)).toEqual(balls);
      expect(scene.phaseManager.hasPhaseOfType("MessagePhase")).toBe(false);
    });

    // Local fork (2026-11-13): save compatibility with the any-type days (2026-11-12 to the 10 명세)
    it("lets a non-Steel Pokémon forged under the old rule keep its pieces and their boost, but gives it no more", async () => {
      const [, lapras] = await startEncounter();
      setForged(lapras, 3);
      // Lapras 130/85/80/85/95/60, three pieces x1.3: 169, 104, 123.5 -> 123
      expect(lapras.calculateBaseStats()).toEqual([169, 85, 104, 85, 123, 60]);
      expect(canForgePokemon(lapras)).toBe(false);

      expect(forgePokemon(lapras)).toBe(0);

      expect(getForgedSteelCount(lapras)).toBe(3);
      expect(lapras.calculateBaseStats()).toEqual([169, 85, 104, 85, 123, 60]);
    });

    it("adds two pieces to the ones the picked Pokémon holds, and only the tenth to one holding nine", async () => {
      const [skarmory] = await startEncounter();
      setForged(skarmory, 9);
      expect(TinkatonForgeEncounter.options[1].meetsRequirements()).toBe(true);

      await runMysteryEncounterToEnd(game, 2, { pokemonNo: 1 });

      expect(forgedSteelOf(skarmory)).toHaveLength(1);
      expect(getForgedSteelCount(skarmory)).toBe(10);
      // ten pieces, x2.0: Skarmory 65/80/140/40/70/70 -> 130/80/280/40/140/70
      expect(skarmory.calculateBaseStats()).toEqual([130, 80, 280, 40, 140, 70]);
      expect(isFullyForgedPokemon(skarmory)).toBe(true);
    });

    it("forges a Steel type full in five visits: 0 -> 2 -> 4 -> 6 -> 8 -> 10", async () => {
      const [skarmory] = await startEncounter();
      expect(FORGED_STEEL.stacksPerForge).toBe(2);
      const counts = [getForgedSteelCount(skarmory)];
      const recalcs = vi.spyOn(skarmory, "calculateStats");
      for (let visit = 1; visit <= 5; visit++) {
        recalcs.mockClear();
        expect(forgePokemon(skarmory)).toBe(2);
        expect(recalcs).toHaveBeenCalledTimes(1); // both pieces in one go: the stats are recalculated once
        counts.push(getForgedSteelCount(skarmory));
      }
      expect(counts).toEqual([0, 2, 4, 6, 8, 10]);
      expect(forgedSteelOf(skarmory)).toHaveLength(1);
      expect(forgePokemon(skarmory)).toBe(0); // a sixth visit gives nothing
      expect(getForgedSteelCount(skarmory)).toBe(10);
    });

    it("turns away a non-Steel Pokémon (even one holding pieces) and a full Steel one with their reasons", async () => {
      const [skarmory, lapras, magnemite] = await startEncounter();
      setForged(magnemite, 10);
      setForged(lapras, 4); // forged in the any-type days
      const select = vi.spyOn(EncounterPhaseUtils, "selectPokemonForOption");

      await runMysteryEncounterToEnd(game, 2, { pokemonNo: 1 });

      const filter = select.mock.calls[0][2] as PokemonSelectFilter;
      expect(filter(lapras)).toBe("Only Steel-type Pokémon can be forged!");
      expect(filter(magnemite)).toBe("That Pokémon already holds the most Forged Steel it can (10)!");
      expect(filter(skarmory)).toBeNull(); // two pieces, from this pick
      expect(getForgedSteelCount(skarmory)).toBe(2);
      expect(getForgedSteelCount(magnemite)).toBe(10);
      expect(getForgedSteelCount(lapras)).toBe(4);
      // a full non-Steel one is turned away for not being a Steel type
      setForged(lapras, 10);
      expect(filter(lapras)).toBe("Only Steel-type Pokémon can be forged!");
    });

    it("keeps the party screen open with the reason after a wrong pick; cancelling goes back to the options", async () => {
      const [skarmory, lapras] = await startEncounter();
      // Local fork (2026-11-13): 10 명세 3번, Lapras is not a Steel type
      const partyTexts: string[] = [];
      const origShowText = MessageUiHandler.prototype.showText;
      vi.spyOn(MessageUiHandler.prototype, "showText").mockImplementation(function (
        this: MessageUiHandler,
        text: string,
        ...rest: any[]
      ) {
        if (this instanceof PartyUiHandler) {
          partyTexts.push(text);
        }
        return (origShowText as any).call(this, text, ...rest);
      });

      await runSelectMysteryEncounterOption(game, 2, { pokemonNo: 2 });

      await vi.waitFor(() => expect(partyTexts).toContain("Only Steel-type Pokémon can be forged!"));
      expect(scene.ui.mode).toBe(UiMode.PARTY);
      expect(getForgedSteelCount(lapras)).toBe(0);

      const party = scene.ui.getHandler<PartyUiHandler>();
      await vi.waitFor(() => expect(party.processInput(Button.ACTION)).toBe(true)); // closes the message
      await vi.waitFor(() => expect(party.processInput(Button.CANCEL)).toBe(true)); // leaves the party screen
      await vi.waitFor(() => expect(scene.ui.mode).toBe(UiMode.MYSTERY_ENCOUNTER));
      expect(game).toBeAtPhase("MysteryEncounterPhase");
      expect(isForgedPokemon(skarmory)).toBe(false);
      expect(getForgedSteelCount(lapras)).toBe(0);
    });

    it("multiplies HP, Def and SpDef base stats by 1.1 with one piece, rounded down, and nothing else", async () => {
      const [skarmory, lapras, magnemite] = await startEncounter();
      for (const [pokemon, id] of [
        [skarmory, SpeciesId.SKARMORY],
        [magnemite, SpeciesId.MAGNEMITE],
      ] as const) {
        expect(pokemon.calculateBaseStats()).toEqual(speciesBase(id));
        setForged(pokemon, 1); // Local fork (2026-11-13): a forge gives two since the 10 명세; one piece set directly
        expect(pokemon.calculateBaseStats()).toEqual(forged(speciesBase(id)));
      }
      expect(skarmory.calculateBaseStats()).toEqual([71, 80, 154, 40, 77, 70]);
      // Magnemite 25/35/70/95/55/45: 27.5 -> 27, 77, 60.5 -> 60
      expect(magnemite.calculateBaseStats()).toEqual([27, 35, 77, 95, 60, 45]);
      expect(lapras.calculateBaseStats()).toEqual(speciesBase(SpeciesId.LAPRAS));
    });

    // Local fork (2026-11-12): base x (10 + n) / 10 with n pieces, rounded down once (up to ten since the 09 patch)
    it("adds 10% per piece, x1.1 up to x2.0, rounded down once (not 1.1 to the nth)", async () => {
      const [skarmory] = await startEncounter();
      const hp = [skarmory.calculateBaseStats()[Stat.HP]];
      for (let pieces = 1; pieces <= FORGED_STEEL.maxHeld; pieces++) {
        setForged(skarmory, pieces); // Local fork (2026-11-13): every count, not just the even ones a forge reaches
        expect(skarmory.calculateBaseStats()).toEqual(forged(speciesBase(SpeciesId.SKARMORY), pieces));
        hp.push(skarmory.calculateBaseStats()[Stat.HP]);
      }
      // HP 65: 71.5, 78, 84.5, 91, 97.5, 104, 110.5, 117, 123.5, 130; 1.1 to the nth would give 71, 78, 85, 93, 102...
      expect(hp).toEqual([65, 71, 78, 84, 91, 97, 104, 110, 117, 123, 130]);
      // ten pieces, x2.0: Def 140 -> 280, SpDef 70 -> 140, HP 65 -> 130
      expect(skarmory.calculateBaseStats()).toEqual([130, 80, 280, 40, 140, 70]);
    });

    it("multiplies in whole numbers: five pieces make base 80 exactly 120, four make 175 exactly 245, ten double", async () => {
      const [skarmory] = await startEncounter();
      const steel = generateModifierType(modifierTypes.FORGED_STEEL)!.newModifier(skarmory) as ForgedSteelModifier;
      const applied = (pieces: number, value: number): number[] => {
        steel.stackCount = pieces;
        const stats = [value, value, value, value, value, value];
        steel.apply(skarmory, stats);
        return stats;
      };
      expect(applied(5, 80)).toEqual([120, 80, 120, 80, 120, 80]);
      expect(applied(5, 81)).toEqual([121, 81, 121, 81, 121, 81]); // 121.5, rounded down once
      expect(Math.floor(175 * 1.4)).toBe(244); // 244.99999999999997 in floating point
      expect(applied(4, 175)).toEqual([245, 175, 245, 175, 245, 175]);
      expect(applied(1, 65)).toEqual([71, 65, 71, 65, 71, 65]);
      // Local fork (2026-11-13): ten pieces (the 09 patch's cap) make exactly x2.0
      expect(applied(10, 80)).toEqual([160, 80, 160, 80, 160, 80]);
      expect(applied(10, 81)).toEqual([162, 81, 162, 81, 162, 81]);
      expect(applied(10, 108)).toEqual([216, 108, 216, 108, 216, 108]); // Mega Garchomp's base HP
      expect(applied(9, 75)).toEqual([142, 75, 142, 75, 142, 75]); // 142.5, rounded down once
    });

    it("comes before Shuckle Juice", async () => {
      const [skarmory] = await startEncounter();
      const juice = generateModifierType(modifierTypes.MYSTERY_ENCOUNTER_SHUCKLE_JUICE, [10])!;
      giveHeld(skarmory, juice, 1);
      // Juice alone: +5 HP, +10 to the others
      expect(skarmory.calculateBaseStats()).toEqual([70, 90, 150, 50, 80, 80]);
      setForged(skarmory, 1);
      // forged first (71, 154, 77), then the juice; juice first would give 77, 165, 88
      expect(skarmory.calculateBaseStats()).toEqual([76, 90, 164, 50, 87, 80]);
    });

    it("comes before vitamins and IV Candies", async () => {
      const [skarmory] = await startEncounter();
      skarmory.ivs = [31, 31, 31, 31, 31, 31];
      giveHeld(skarmory, generated("BASE_STAT_BOOSTER", Stat.HP), 4);
      giveHeld(skarmory, generated("IV_CANDY", Stat.HP), 5);
      // Local fork (2026-11-13): the HP vitamin is +10% again since the 09 patch (it was +15% for a while: 135 and
      // 146), and a player's Health Candy stays +6% ("사탕은 hp만 6%"). 65 x1.4 = 91, x1.3 = 118.3 -> 118
      expect(skarmory.calculateBaseStats()[Stat.HP]).toBe(118);
      setForged(skarmory, 1);
      // 71 (forged) x1.4 = 99.4 -> 99, x1.3 = 128.7 -> 128; forging after the vitamins would give 130 (91 x1.1 = 100,
      // x1.3), after the candies 129 (118 x1.1)
      expect(skarmory.calculateBaseStats()[Stat.HP]).toBe(128);
    });

    it("applies to both species of a fusion before they are averaged", async () => {
      const [, lapras] = await startEncounter();
      lapras.fusionSpecies = speciesDataRegistry.getSpecies(SpeciesId.KLINK);
      lapras.fusionFormIndex = 0;
      lapras.fusionAbilityIndex = 0;
      const head = speciesBase(SpeciesId.LAPRAS);
      const tail = speciesBase(SpeciesId.KLINK);
      const average = (a: number[], b: number[]) => a.map((v, s) => Math.ceil((v + b[s]) / 2));
      expect(lapras.calculateBaseStats()).toEqual(average(head, tail));

      setForged(lapras, 1);
      expect(lapras.calculateBaseStats()).toEqual(average(forged(head), forged(tail)));
      // Lapras 130/85/80/85/95/60 -> 143/85/88/85/104/60, Klink 40/55/70/45/60/30 -> 44/55/77/45/66/30
      expect(lapras.calculateBaseStats()).toEqual([94, 70, 83, 65, 85, 45]);

      // Local fork (2026-11-12): three pieces, x1.3 on both species before the average. Local fork (2026-11-13):
      // Lapras fused with Klink is Water/Steel, so the forge takes it: one forge adds two
      expect(forgePokemon(lapras)).toBe(2);
      expect(lapras.calculateBaseStats()).toEqual(average(forged(head, 3), forged(tail, 3)));
      // Lapras -> 169/85/104/85/123/60, Klink -> 52/55/91/45/78/30
      expect(lapras.calculateBaseStats()).toEqual([111, 70, 98, 65, 101, 45]);
    });

    it("stays with its holder when the species changes (evolution, form change, Mega)", async () => {
      const [, , magnemite] = await startEncounter();
      forgePokemon(magnemite);
      magnemite.species = speciesDataRegistry.getSpecies(SpeciesId.MAGNETON);
      magnemite.calculateStats();
      expect(forgedSteelOf(magnemite)).toHaveLength(1);
      expect(magnemite.calculateBaseStats()).toEqual(forged(speciesBase(SpeciesId.MAGNETON), 2));
    });

    // Local fork (2026-11-08), review: the Mega case named above had no check
    it("boosts a Mega form's base stats: Mega Steelix 75/125/230/55/95/30", async () => {
      const [steelix] = await startEncounter([SpeciesId.STEELIX]);
      expect(forgePokemon(steelix)).toBe(2); // Local fork (2026-11-13): two pieces a forge, x1.2
      steelix.formIndex = steelix.species.forms.findIndex(f => f.formKey === "mega");
      steelix.calculateStats();
      expect(forgedSteelOf(steelix)).toHaveLength(1);
      // 75/230/95 x1.2: 90, 276, 114
      expect(steelix.calculateBaseStats()).toEqual([90, 125, 276, 55, 114, 30]);
    });

    // Local fork (2026-11-12): one per Pokémon until then; five until the 09 patch
    it("holds at most ten pieces, in one stack; an eleventh is not given", async () => {
      const [skarmory] = await startEncounter();
      const balls = [...Object.values(scene.pokeballCounts)];
      expect(FORGED_STEEL.maxHeld).toBe(10);
      expect(FORGED_STEEL.stacksPerForge).toBe(2);
      expect(Object.isFrozen(FORGED_STEEL)).toBe(true);
      expect(Object.isFrozen(FORGED_STEEL.stats)).toBe(true);
      // Local fork (2026-11-13): 10 명세 3번, nine held: the forge adds only the tenth
      setForged(skarmory, 9);
      expect(forgePokemon(skarmory)).toBe(1);
      expect(getForgedSteelCount(skarmory)).toBe(10);
      // Local fork (2026-11-08), review fix: forgePokemon said false on success and true on a call past the cap,
      // which handed out the stack-full fallback (5 Poké Balls and a "stack full" message)
      expect(forgePokemon(skarmory)).toBe(0);
      expect(Object.values(scene.pokeballCounts)).toEqual(balls);
      expect(scene.phaseManager.hasPhaseOfType("MessagePhase")).toBe(false);
      expect(forgedSteelOf(skarmory)).toHaveLength(1);
      expect(forgedSteelOf(skarmory)[0].getStackCount()).toBe(10);
      expect(forgedSteelOf(skarmory)[0].getMaxStackCount()).toBe(10);
      expect(forgedSteelOf(skarmory)[0].getMaxHeldItemCount(skarmory)).toBe(10);
      expect(isFullyForgedPokemon(skarmory)).toBe(true);
      expect(canForgePokemon(skarmory)).toBe(false);
      expect(skarmory.calculateBaseStats()).toEqual([130, 80, 280, 40, 140, 70]);
    });

    // Local fork (2026-11-12): one piece is what every save from before then holds
    it.each([
      { pieces: 1, stats: [71, 80, 154, 40, 77, 70] },
      { pieces: 3, stats: [84, 80, 182, 40, 91, 70] },
      { pieces: 10, stats: [130, 80, 280, 40, 140, 70] }, // Local fork (2026-11-13): the 09 patch's cap
    ])(
      "keeps $pieces piece(s) of Forged Steel and the stats through a session save and load",
      async ({ pieces, stats }) => {
        game.override.mysteryEncounterChance(0);
        await game.classicMode.startBattle(SpeciesId.SKARMORY);
        const [skarmory] = scene.getPlayerParty();
        setForged(skarmory, pieces);
        const boosted = skarmory.calculateBaseStats();
        const maxHp = skarmory.getMaxHp();
        expect(boosted).toEqual(stats);

        const { gameData } = scene;
        const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) =>
          typeof v === "bigint" ? v.toString() : v,
        );
        const session = gameData.parseSessionData(json);
        const saved = session.modifiers.find(m => m.typeId === "FORGED_STEEL")!;
        expect(saved.className).toBe("ForgedSteelModifier");
        expect(saved.args).toEqual([skarmory.id]);
        expect(saved.stackCount).toBe(pieces);
        game.reload["sessionData"] = session;
        await game.reload.reloadSession();

        const [loaded] = game.scene.getPlayerParty();
        expect(forgedSteelOf(loaded)).toHaveLength(1);
        expect(forgedSteelOf(loaded)[0].type.id).toBe("FORGED_STEEL");
        expect(forgedSteelOf(loaded)[0].getStackCount()).toBe(pieces);
        expect(loaded.calculateBaseStats()).toEqual(boosted);
        expect(loaded.getMaxHp()).toBe(maxHp);
      },
    );
  });

  // Local fork (2026-11-12)
  describe("option 2 and item texts", () => {
    const koDialogue = koFiles["../../../locales/ko/mystery-encounters/tinkaton-forge-dialogue.json"] as any;
    const enDialogue = enFiles["../../../locales/en/mystery-encounters/tinkaton-forge-dialogue.json"] as any;
    const koItem = (koFiles["../../../locales/ko/modifier-type.json"] as any).ModifierType.FORGED_STEEL;
    const enItem = (enFiles["../../../locales/en/modifier-type.json"] as any).ModifierType.FORGED_STEEL;

    // Local fork (2026-11-13): 10 명세 3번, a Steel type only again, two pieces a forge
    it("ask for a Steel type again and give two pieces a forge", () => {
      for (const option of [koDialogue.option["2"], enDialogue.option["2"]]) {
        expect(option.notSteel).toBeTypeOf("string");
        expect(option.alreadyForged).toBeUndefined();
        expect(option.fullyForged).toBeTypeOf("string");
      }
      expect(koDialogue.option["2"].notSteel).toBe("강철 타입 포켓몬만 단조할 수 있다!");
      expect(enDialogue.option["2"].notSteel).toBe("Only Steel-type Pokémon can be forged!");
      const per = FORGED_STEEL.stacksPerForge;
      expect(koDialogue.option["2"].tooltip).toContain(`강철 타입 포켓몬에게 단조강철 ${per}개`);
      expect(enDialogue.option["2"].tooltip).toContain(`Steel type gets ${per} Forged Steel`);
      expect(koDialogue.option["2"].disabledTooltip).toContain("강철 타입");
      expect(enDialogue.option["2"].disabledTooltip).toContain("Steel type");
      // the item itself works on any holder (old saves): its text names no type
      expect(JSON.stringify([koItem, enItem])).not.toMatch(/강철 ?타입|Steel[- ]type/i);
      // nothing left of the any-type or one-piece wording
      const ko = JSON.stringify([koDialogue, koItem]);
      const en = JSON.stringify([enDialogue, enItem]);
      expect(ko).not.toMatch(/모든 포켓몬|단조를 마친/);
      expect(en).not.toMatch(/Every Pokémon|already been forged|one per|any type/i);
      // short enough for the tooltip box: at most three lines each
      for (const option of [koDialogue.option["2"], enDialogue.option["2"]]) {
        expect(option.tooltip.split("\n").length).toBeLessThanOrEqual(3);
        expect(option.disabledTooltip.split("\n").length).toBeLessThanOrEqual(3);
      }
    });

    // Local fork (2026-11-13): ten since the 09 patch; every number in the texts is checked against FORGED_STEEL
    it("give the cap of ten and the 10% per piece", () => {
      const max = FORGED_STEEL.maxHeld;
      expect(max).toBe(10);
      expect(koItem.description).toBe(
        "체력, 방어, 특수방어 종족치를 1개당 10%씩 올려준다(합연산, 1.1~2.0배, 최대 10개).",
      );
      expect(koItem.description).toContain("1개당 10%");
      expect(koItem.description).toContain(`최대 ${max}개`);
      expect(koItem.description).toContain(`~${(getForgedSteelTenths(max) / 10).toFixed(1)}배`);
      expect(koDialogue.option["2"].tooltip).toContain("1개당");
      expect(koDialogue.option["2"].tooltip).toContain("10%");
      expect(koDialogue.option["2"].tooltip).toContain(`최대 ${max}개`);
      expect(koDialogue.option["2"].disabledTooltip).toContain(`${max}개 미만인`); // Local fork (2026-11-13)
      expect(koDialogue.option["2"].fullyForged).toContain(`최대 ${max}개까지`);
      expect(enItem.description).toContain("10% per piece");
      expect(enItem.description).toContain(`x${(getForgedSteelTenths(max) / 10).toFixed(1)}, up to ${max})`);
      expect(enDialogue.option["2"].tooltip).toContain(`+10% per piece (up to ${max})`);
      expect(enDialogue.option["2"].disabledTooltip).toContain(`fewer than ${max} Forged Steel`);
      expect(enDialogue.option["2"].fullyForged).toContain(`(${max})!`);
      // nothing left over from the old cap of five
      expect(JSON.stringify([koItem, koDialogue.option["2"]])).not.toMatch(/최대 5개|1\.5배/);
      expect(JSON.stringify([enItem, enDialogue.option["2"]])).not.toMatch(/up to 5\b|holds 5 |\(5\)|x1\.5/);
    });
  });

  describe("option 3 - a friendly spar", () => {
    beforeEach(() => {
      // the wave-45 level cap is 38 and a Pokémon above it gets no EXP; level 60 takes 5316 EXP without levelling up
      game.override.battleStyle("single").startingLevel(60).levelCap(100).criticalHits(false);
    });

    it("sets up a wild Tinkaton at the wave's level with Mold Breaker and its four moves", async () => {
      await startEncounter();
      const encounter = scene.currentBattle.mysteryEncounter!;
      const config = encounter.enemyPartyConfigs[0];
      expect(config.pokemonConfigs).toHaveLength(1);
      const [tinkaton] = config.pokemonConfigs!;
      expect(tinkaton.species.speciesId).toBe(SpeciesId.TINKATON);
      expect(tinkaton.isBoss).toBe(false);
      expect(tinkaton.level).toBeUndefined();
      expect(config.levelAdditiveModifier).toBeUndefined();
      expect(tinkaton.moveSet).toEqual([
        MoveId.GIGATON_HAMMER,
        MoveId.PLAY_ROUGH,
        MoveId.BRICK_BREAK,
        MoveId.THUNDER_WAVE,
      ]);
      // implemented in full: no " (N)" (unimplemented) or " (P)" (partial) mark on the name
      expect(TINKATON_FORGE_SPAR_MOVES.every(m => !/\((N|P)\)$/.test(allMoves[m].name))).toBe(true);
      expect(encounter.catchAllowed).toBe(false);
      expect(TINKATON_FORGE_SPAR_EXP_MULTIPLIER).toBe(3);
    });

    it("starts the battle with Attack +1, not a boss, not catchable, at this wave's normal level", async () => {
      await startEncounter();
      const level = vi.spyOn(scene.currentBattle, "getLevelForWave").mockReturnValue(SPAR_LEVEL);

      await runMysteryEncounterToEnd(game, 3, undefined, true);

      expect(game).toBeAtPhase("CommandPhase");
      expect(level).toHaveBeenCalled();
      const enemies = scene.getEnemyField();
      expect(enemies).toHaveLength(1);
      const [tinkaton] = enemies;
      expect(tinkaton.species.speciesId).toBe(SpeciesId.TINKATON);
      expect(tinkaton.level).toBe(SPAR_LEVEL);
      expect(tinkaton.isBoss()).toBe(false);
      expect(tinkaton.getAbility().id).toBe(AbilityId.MOLD_BREAKER);
      expect(tinkaton.summonData.statStages).toEqual([1, 0, 0, 0, 0, 0, 0]);
      expect(tinkaton.getMoveset().map(m => m.moveId)).toEqual([...TINKATON_FORGE_SPAR_MOVES]);
      const encounter = scene.currentBattle.mysteryEncounter!;
      expect(encounter.encounterMode).toBe(MysteryEncounterMode.WILD_BATTLE);
      expect(encounter.catchAllowed).toBe(false);
      expect(encounter.expMultiplier).toBe(3);
      expect(game.textInterceptor.logs.some(l => l.includes("Tinkaton tightened its grip on its hammer!"))).toBe(true);
    });

    /** EXP that the lone `player` gets from the next faint of the enemy on the field */
    async function expFromKill(player: PlayerPokemon): Promise<number> {
      const before = player.exp;
      game.move.select(MoveId.SPLASH);
      await game.doKillOpponents();
      await game.phaseInterceptor.to("BattleEndPhase");
      return player.exp - before;
    }

    it("gives exactly 3x the EXP of a normal faint of the same Tinkaton, with no reward screen afterwards", async () => {
      game.override.moveset([MoveId.SPLASH]).ability(AbilityId.BALL_FETCH);
      const [skarmory] = await startEncounter([SpeciesId.SKARMORY]);
      skarmory.pokerus = false;
      vi.spyOn(scene.currentBattle, "getLevelForWave").mockReturnValue(SPAR_LEVEL);
      await runMysteryEncounterToEnd(game, 3, undefined, true);
      // runMysteryEncounterToEnd leaves its MysteryEncounterOptionSelectedPhase prompt queued when that phase shows
      // no text, and a queued prompt that neither matches nor expires holds back every later one (move.select's)
      (game.promptHandler as unknown as { prompts: unknown[] }).prompts.length = 0;
      const tinkaton = scene.getEnemyField()[0];
      const normal = (speciesDataRegistry.getSpecies(SpeciesId.TINKATON).getBaseExp() * SPAR_LEVEL) / 5 + 1;
      expect(normal).toBe(1772);
      expect(tinkaton.getExpValue()).toBe(normal);

      expect(await expFromKill(skarmory)).toBe(3 * normal);

      // what follows is the encounter's default for a won wild battle without custom rewards: no reward screen
      await game.phaseInterceptor.to("MysteryEncounterRewardsPhase");
      expect(scene.currentBattle.mysteryEncounter?.doEncounterRewards).toBeUndefined();
      expect(scene.phaseManager.hasPhaseOfType("SelectModifierPhase")).toBe(false);
    });

    it("comes back with the same 3x after a reload in the middle of the spar", async () => {
      await startEncounter();
      await runMysteryEncounterToEnd(game, 3, undefined, true);
      expect(scene.currentBattle.mysteryEncounter?.expMultiplier).toBe(3);

      // Sessions are saved at the start of a wave (EncounterPhase): reloading puts the player back on this
      // encounter's options, as ReloadHelper.reloadSession does up to its title-screen load
      const session = game.reload["sessionData"];
      expect(session.mysteryEncounterType).toBe(MysteryEncounterType.TINKATON_FORGE);
      const titlePhase = new TitlePhase();
      scene.phaseManager.clearPhaseQueue();
      vi.spyOn(scene.gameData, "getSession").mockReturnValue(Promise.resolve(session));
      scene.phaseManager.unshiftPhase(titlePhase);
      game.endPhase();
      scene.modifiers = [];
      (game.promptHandler as unknown as { prompts: unknown[] }).prompts.length = 0;
      await titlePhase["loadSaveSlot"](0);

      await runMysteryEncounterToEnd(game, 3, undefined, true);
      expect(game).toBeAtPhase("CommandPhase");
      const encounter = game.scene.currentBattle.mysteryEncounter!;
      expect(encounter.encounterType).toBe(MysteryEncounterType.TINKATON_FORGE);
      expect(encounter.expMultiplier).toBe(3);
      expect(game.scene.getEnemyField()[0].species.speciesId).toBe(SpeciesId.TINKATON);
    });

    it("(baseline) a normal wild Tinkaton of that level gives 1x", async () => {
      game.override
        .mysteryEncounterChance(0)
        .enemySpecies(SpeciesId.TINKATON)
        .enemyLevel(SPAR_LEVEL)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset(MoveId.SPLASH)
        .moveset([MoveId.SPLASH])
        .ability(AbilityId.BALL_FETCH);
      await game.classicMode.startBattle(SpeciesId.SKARMORY);
      scene.modifiers = [];
      await scene.updateModifiers(true);
      const [skarmory] = scene.getPlayerParty();
      skarmory.pokerus = false;
      expect(game.field.getEnemyPokemon().getExpValue()).toBe(1772);

      expect(await expFromKill(skarmory)).toBe(1772);
    });
  });

  /**
   * Every Korean text the encounter puts on screen, captured from the encounter screen (getEncounterText), the
   * message boxes (party screen included) and the test text log: no raw keys, no {{ }} or [[ ]] left.
   */
  describe("Korean text", () => {
    const captured: { flow: string; text: string }[] = [];
    let flow = "";
    const origGetEncounterText = EncounterDialogueUtils.getEncounterText;
    const origTiShowText = TextInterceptor.prototype.showText;
    const origBoxShowText = MessageUiHandler.prototype.showText;

    const relocalize = () => {
      for (const s of speciesDataRegistry.getAllSpecies()) {
        s.localize();
      }
      for (const m of allMoves) {
        m.localize();
      }
    };

    const record = (text: unknown) => {
      if (text != null && text !== "") {
        captured.push({ flow, text: String(text) });
      }
    };

    beforeAll(async () => {
      await i18next.changeLanguage("ko");
      relocalize();
    });

    afterAll(async () => {
      await i18next.changeLanguage("en");
      relocalize();
    });

    beforeEach(() => {
      vi.spyOn(EncounterDialogueUtils, "getEncounterText").mockImplementation((key?: string, style?: any) => {
        const result = origGetEncounterText(key, style);
        record(result);
        return result;
      });
      vi.spyOn(TextInterceptor.prototype, "showText").mockImplementation(function (this: TextInterceptor, text) {
        record(game.scene.ui.mode === UiMode.PARTY ? `[party] ${text}` : text);
        return origTiShowText.call(this, text);
      });
      vi.spyOn(MessageUiHandler.prototype, "showText").mockImplementation(function (
        this: MessageUiHandler,
        text: string,
        ...rest: any[]
      ) {
        record(this instanceof PartyUiHandler ? `[party] ${text}` : text);
        return (origBoxShowText as any).call(this, text, ...rest);
      });
    });

    /** Opens the option screen and hovers all three options so their tooltips are built */
    async function hoverOptions(): Promise<void> {
      game.onNextPrompt(
        "MysteryEncounterPhase",
        UiMode.MESSAGE,
        () => game.scene.ui.getHandler<MysteryEncounterUiHandler>().processInput(Button.ACTION),
        () => game.isCurrentPhase("MysteryEncounterOptionSelectedPhase", "CommandPhase", "TurnInitPhase"),
      );
      await game.phaseInterceptor.to("MysteryEncounterPhase");
      const handler = game.scene.ui.getHandler<MysteryEncounterUiHandler>();
      handler.unblockInput();
      handler.processInput(Button.RIGHT);
      handler.processInput(Button.LEFT);
      handler.processInput(Button.DOWN);
      handler.processInput(Button.UP);
    }

    const textsOf = (f: string) => captured.filter(c => c.flow === f).map(c => c.text);

    it("shows the user's strings on the encounter screen", async () => {
      flow = "screen";
      await startEncounter();
      await hoverOptions();
      const texts = textsOf(flow).join("\n");
      for (const expected of [
        "쾅! 쾅! 어디선가 망치 소리가 들려온다!",
        "두드리짱의 대장간",
        "두드리짱이 모루 위에서 무언가를 힘껏 두드리고 있다!\n무언가 부탁해 볼까요?",
        "어떻게 하시겠습니까?",
        "장비를 벼려 달라고 한다",
        "(+) 쓸만한 아이템",
        "강철을 단조한다",
        "(+) 강철 타입 포켓몬에게 단조강철 2개\n(+) 1개당 체력·방어·특수방어 종족치 +10% (최대 10개)",
        "두드리짱과의 즐거운 대련!",
        "(-) 두드리짱과의 전투\n(+) 경험치",
      ]) {
        expect(texts).toContain(expected);
      }
    });

    // Local fork (2026-11-12): it was "without a Steel type" until then, "every party member holds ten" after.
    // Local fork (2026-11-13): 10 명세 3번, no Steel type with fewer than ten again
    it("shows the disabled tooltip when no Steel type can take more", async () => {
      flow = "disabled";
      await startEncounter([SpeciesId.LAPRAS, SpeciesId.ABRA]);
      await hoverOptions();
      expect(textsOf(flow).join("\n")).toContain("(-) 단조강철이 10개 미만인\n강철 타입 포켓몬이 없다");
    });

    it("option 1: the hammering", async () => {
      flow = "gear";
      await startEncounter();
      await runMysteryEncounterToEnd(game, 1);
      const texts = textsOf(flow).join("\n");
      expect(texts).toContain("두드리짱이 신이 나서 망치를 휘둘렀다!$쓸만한 물건들이 완성됐다!");
    });

    it("option 2: prompt, wrong picks and the forging", async () => {
      flow = "forge";
      const [, lapras, magnemite] = await startEncounter();
      forgeTimes(magnemite, 5);
      const select = vi.spyOn(EncounterPhaseUtils, "selectPokemonForOption");
      await runMysteryEncounterToEnd(game, 2, { pokemonNo: 1 });
      const filter = select.mock.calls[0][2] as PokemonSelectFilter;
      expect(filter(lapras)).toBe("강철 타입 포켓몬만 단조할 수 있다!"); // Local fork (2026-11-13)
      expect(filter(magnemite)).toBe("단조강철을 이미 최대 10개까지 지닌 포켓몬이다!");
      const texts = textsOf(flow).join("\n");
      expect(texts).toContain("[party] 단조할 포켓몬을 선택하세요.");
      expect(texts).toContain("두드리짱이 무장조를 힘껏 두드렸다!$무장조의 몸이 더욱 단단해졌다!");
      expect(i18next.t("modifierType:ModifierType.FORGED_STEEL.name")).toBe("단조강철");
      expect(i18next.t("modifierType:ModifierType.FORGED_STEEL.description")).toBe(
        "체력, 방어, 특수방어 종족치를 1개당 10%씩 올려준다(합연산, 1.1~2.0배, 최대 10개).",
      );
    });

    it("option 3: the spar", async () => {
      flow = "spar";
      game.override.battleStyle("single");
      await startEncounter();
      await runMysteryEncounterToEnd(game, 3, undefined, true);
      const texts = textsOf(flow).join("\n");
      expect(texts).toContain("두드리짱이 망치를 고쳐 쥐었다!$즐거운 대련이 시작된다!");
    });

    it("leaves no raw key, {{ }} or [[ ]] in anything it showed", () => {
      expect(captured.length).toBeGreaterThan(20);
      for (const { flow: f, text } of captured) {
        expect(text, `${f}: ${text}`).not.toMatch(/\{\{|\}\}|\[\[|\]\]/);
        expect(text, `${f}: ${text}`).not.toContain("tinkatonForge");
        expect(text, `${f}: ${text}`).not.toContain("mysteryEncounters/");
      }
    });
  });
});
