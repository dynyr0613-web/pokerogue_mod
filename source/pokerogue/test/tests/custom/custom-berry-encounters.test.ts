import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { modifierTypes } from "#data/data-lists";
import { BerryType } from "#enums/berry-type";
import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import { BerryModifier } from "#modifiers/modifier";
import {
  type BerryModifierType,
  BerryModifierType as BerryModifierTypeClass,
  getFullBerryTypes,
  getOfferableBerryTypes,
  type ModifierTypeGenerator,
  type ModifierTypeOption,
} from "#modifiers/modifier-type";
import { BerriesAboundEncounter } from "#mystery-encounters/berries-abound-encounter";
import * as EncounterPhaseUtils from "#mystery-encounters/encounter-phase-utils";
import { generateModifierType } from "#mystery-encounters/encounter-phase-utils";
import * as MysteryEncounters from "#mystery-encounters/mystery-encounter-biomes";
import { BerriesOfferableRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { runMysteryEncounterToEnd, skipBattleRunMysteryEncounterRewardsPhase } from "#test/utils/encounter-test-utils";
import { generateStarters } from "#test/utils/game-manager-utils";
import { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import * as Utils from "#utils/common";
import { getEnumValues } from "#utils/enums";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const defaultParty = [SpeciesId.PYUKUMUKU, SpeciesId.MAGIKARP, SpeciesId.PIKACHU];
const defaultBiome = BiomeId.CAVE;
const defaultWave = 45; // Berries Abound gives 4 berries here
const ALL_BERRIES = getEnumValues(BerryType);

/**
 * Local fork, the user's note of 2026-11-08: "보상 테이블에 열매가 더 안나올경우 열매주는 미스터리 조우도 안나오게".
 * The BERRY reward generator leaves out every berry type that even one of the player's Pokémon holds at its cap and
 * returns nothing once all are out (2026-11-06). The berry-giving encounters follow the same rule now:
 * - 나무열매 풍년 (Berries Abound), whose every reward is berries, leaves the encounter pool while no berry can be
 *   offered (BerriesOfferableRequirement), and its berries (reward screen and gifts) are only offerable types;
 * - 어릿광대의 장난 (Clowning Around) option 2 re-rolls a Pokémon's berries into offerable types first;
 * - 쓰레기 속 보물 (Trash to Treasure)'s Garbodor keeps unfiltered berries (an enemy's items never were filtered),
 *   which also fixes the battle crashing on a null item when every type was full.
 */
describe("Custom - berry-giving mystery encounters follow the full-berry reward rule", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let scene: BattleScene;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    scene = game.scene;
    game.override
      .mysteryEncounterChance(100)
      .mysteryEncounterTier(MysteryEncounterTier.COMMON)
      .startingWave(defaultWave)
      .startingBiome(defaultBiome)
      .disableTrainerWaves()
      .startingModifier([])
      .startingHeldItems([]);
    useEncounterPool([MysteryEncounterType.BERRIES_ABOUND]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function useEncounterPool(types: MysteryEncounterType[]): void {
    vi.spyOn(MysteryEncounters, "mysteryEncountersByBiome", "get").mockReturnValue(
      new Map<BiomeId, MysteryEncounterType[]>([[defaultBiome, types]]),
    );
  }

  function berry(pokemon: Pokemon, berryType: BerryType): BerryModifier | undefined {
    return pokemon.getHeldItems().find(m => m instanceof BerryModifier && m.berryType === berryType) as
      | BerryModifier
      | undefined;
  }

  /** Sets `pokemon`'s stack of `berryType` to `count`, even above the cap like an old save */
  function setBerries(pokemon: Pokemon, berryType: BerryType, count: number): BerryModifier {
    let mod = berry(pokemon, berryType);
    if (!mod) {
      const type = generateModifierType(modifierTypes.BERRY, [berryType]) as BerryModifierType;
      mod = type.newModifier(pokemon) as BerryModifier;
      mod.stackCount = count;
      scene.addModifier(mod, true, false, false, true);
      mod = berry(pokemon, berryType)!;
    }
    mod.stackCount = count;
    return mod;
  }

  /** Fills `pokemon`'s stacks of `types` up to its cap (Classic 2/3, Endless 20 for the player) */
  function fillBerries(pokemon: Pokemon, types: readonly BerryType[]): void {
    for (const berryType of types) {
      const mod = setBerries(pokemon, berryType, 1);
      mod.stackCount = mod.getMaxStackCount();
    }
  }

  const berryCount = (pokemon: Pokemon) =>
    pokemon
      .getHeldItems()
      .filter(m => m instanceof BerryModifier)
      .reduce((sum, m) => sum + m.stackCount, 0);

  /** The starting held items that put every berry type except `free` at (or above) the Classic cap on the lead */
  function leadHoldsFullBerriesExcept(...free: BerryType[]): void {
    game.override.startingHeldItems(
      ALL_BERRIES.filter(b => !free.includes(b)).map(b => ({ name: "BERRY", type: b, count: 3 })),
    );
  }

  async function startEndless(species: SpeciesId[]): Promise<void> {
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.ENDLESS);
      const starters = generateStarters(game.scene, species);
      const selectStarterPhase = new SelectStarterPhase();
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      selectStarterPhase.initBattle(starters);
    });
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    await game.phaseInterceptor.to("CommandPhase", false);
  }

  /**
   * Local fork (2026-11-08), review: a copy of the reward-screen berries as Berries Abound rolled them when the option
   * was picked (the array itself is the one the screen reads, so it is copied at that moment)
   */
  function captureRolledShopBerries(): ModifierTypeOption[] {
    const rolled: ModifierTypeOption[] = [];
    const setEncounterRewards = EncounterPhaseUtils.setEncounterRewards;
    vi.spyOn(EncounterPhaseUtils, "setEncounterRewards").mockImplementation((shop, eggs, preRewards) => {
      rolled.push(...(shop?.guaranteedModifierTypeOptions ?? []));
      setEncounterRewards(shop, eggs, preRewards);
    });
    return rolled;
  }

  /** The berry types on the reward screen that is open now */
  function shownBerryTypes(): BerryType[] {
    const handler = scene.ui.handlers.find(h => h instanceof ModifierSelectUiHandler) as ModifierSelectUiHandler;
    return handler.options.map(o => (o.modifierTypeOption.type as BerryModifierType).getPregenArgs()[0]);
  }

  describe("the rule shared with the BERRY reward generator", () => {
    it("offers every type minus the full ones, and nothing exactly when the generator returns null", async () => {
      game.override.mysteryEncounterChance(0);
      await startEndless([SpeciesId.FEEBAS, SpeciesId.MAGIKARP]);
      const [first, second] = scene.getPlayerParty();
      const party = scene.getPlayerParty();
      const generator = modifierTypes.BERRY() as ModifierTypeGenerator;

      // Nothing full: every type in BerryType order (the encounters then draw exactly as before)
      expect(getOfferableBerryTypes(party)).toEqual(ALL_BERRIES);
      expect(new BerriesOfferableRequirement().meetsRequirement()).toBe(true);

      // The user's case: stacks above 20 from an older save count as full
      setBerries(first, BerryType.LEPPA, 47);
      setBerries(first, BerryType.SITRUS, 32);
      setBerries(second, BerryType.LUM, 20);
      setBerries(second, BerryType.STARF, 19);
      const expected = ALL_BERRIES.filter(b => ![BerryType.LEPPA, BerryType.SITRUS, BerryType.LUM].includes(b));
      expect(getOfferableBerryTypes(party)).toEqual(expected);
      for (let i = 0; i < 40; i++) {
        const type = generator.generateType(party) as BerryModifierType;
        expect(expected).toContain(type.getPregenArgs()[0]);
      }

      // Every type at 20 on one Pokémon: nothing offerable, the generator gives null and the requirement fails
      fillBerries(first, ALL_BERRIES);
      expect(getFullBerryTypes(party).size).toBe(ALL_BERRIES.length);
      expect(getOfferableBerryTypes(party)).toEqual([]);
      expect(generator.generateType(party)).toBeNull();
      expect(new BerriesOfferableRequirement().meetsRequirement()).toBe(false);

      // One eaten below the cap: that type alone
      berry(first, BerryType.ENIGMA)!.stackCount = 19;
      expect(getOfferableBerryTypes(party)).toEqual([BerryType.ENIGMA]);
      expect((generator.generateType(party) as BerryModifierType).getPregenArgs()).toEqual([BerryType.ENIGMA]);
      expect(new BerriesOfferableRequirement().meetsRequirement()).toBe(true);
    });
  });

  describe("나무열매 풍년 (Berries Abound)", () => {
    it("spawns as before when no berry is full", async () => {
      await game.runToMysteryEncounter(undefined, defaultParty);
      expect(scene.currentBattle.mysteryEncounter?.encounterType).toBe(MysteryEncounterType.BERRIES_ABOUND);
    });

    it("is left out of the encounter pool when a party member holds every berry type at the cap", async () => {
      leadHoldsFullBerriesExcept();
      await game.runToMysteryEncounter(undefined, defaultParty);

      expect(getOfferableBerryTypes(scene.getPlayerParty())).toEqual([]);
      expect(BerriesAboundEncounter.meetsRequirements()).toBe(false);
      // Berries Abound was the biome's only encounter, so the game falls back to Mysterious Challengers
      expect(scene.currentBattle.mysteryEncounter?.encounterType).toBe(MysteryEncounterType.MYSTERIOUS_CHALLENGERS);
    });

    it("spawns again when a single berry type is free", async () => {
      leadHoldsFullBerriesExcept(BerryType.SALAC);
      await game.runToMysteryEncounter(undefined, defaultParty);

      expect(getOfferableBerryTypes(scene.getPlayerParty())).toEqual([BerryType.SALAC]);
      expect(scene.currentBattle.mysteryEncounter?.encounterType).toBe(MysteryEncounterType.BERRIES_ABOUND);
    });

    it("is not picked over another encounter of its tier while no berry can be offered", async () => {
      useEncounterPool([MysteryEncounterType.BERRIES_ABOUND, MysteryEncounterType.DEPARTMENT_STORE_SALE]);
      leadHoldsFullBerriesExcept();
      await game.runToMysteryEncounter(undefined, defaultParty);
      expect(scene.currentBattle.mysteryEncounter?.encounterType).toBe(MysteryEncounterType.DEPARTMENT_STORE_SALE);
    });

    it("gives and shows only the berry types that are still offerable", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.BERRIES_ABOUND, defaultParty);
      const [lead, second] = scene.getPlayerParty();
      // Everything full on the second Pokémon except Sitrus and Lum (Classic cap 2 each)
      fillBerries(
        second,
        ALL_BERRIES.filter(b => b !== BerryType.SITRUS && b !== BerryType.LUM),
      );
      const secondBefore = berryCount(second);
      expect(scene.currentBattle.mysteryEncounter!.misc.numBerries).toBe(4);
      const rolled = captureRolledShopBerries();

      await runMysteryEncounterToEnd(game, 1, undefined, true);
      await skipBattleRunMysteryEncounterRewardsPhase(game);
      await game.phaseInterceptor.to("SelectModifierPhase");

      // The reward screen's five berries, rolled when the option was picked: only the two free types
      expect(rolled.length).toBe(5);
      for (const option of rolled) {
        const type = option.type as BerryModifierType;
        expect(type).toBeInstanceOf(BerryModifierTypeClass);
        expect([BerryType.SITRUS, BerryType.LUM]).toContain(type.getPregenArgs()[0]);
      }
      // Local fork (2026-11-08), review: the gifts below filled both before the screen opened, so it shows none
      const handler = scene.ui.handlers.find(h => h instanceof ModifierSelectUiHandler) as ModifierSelectUiHandler;
      expect(getOfferableBerryTypes(scene.getPlayerParty())).toEqual([]);
      expect(handler.options.length).toBe(0);

      // The four gifts: exactly the two free types up to the cap, none lost, nothing for the full Pokémon
      expect(berry(lead, BerryType.SITRUS)?.stackCount).toBe(2);
      expect(berry(lead, BerryType.LUM)?.stackCount).toBe(2);
      expect(berryCount(lead)).toBe(4);
      expect(berryCount(second)).toBe(secondBefore);
    });

    it("turns gifts into the stack-full fallback once the last free type fills up", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.BERRIES_ABOUND, defaultParty);
      const [lead, second] = scene.getPlayerParty();
      fillBerries(
        second,
        ALL_BERRIES.filter(b => b !== BerryType.SITRUS),
      );
      const ballsBefore = scene.pokeballCounts[PokeballType.POKEBALL];

      await runMysteryEncounterToEnd(game, 1, undefined, true);
      await skipBattleRunMysteryEncounterRewardsPhase(game);
      await game.phaseInterceptor.to("SelectModifierPhase");

      // Two Sitrus fill the last type; the other two berries become 5 Poké Balls each (the Common tier fallback)
      expect(berry(lead, BerryType.SITRUS)?.stackCount).toBe(2);
      expect(berryCount(lead)).toBe(2);
      expect(scene.pokeballCounts[PokeballType.POKEBALL]).toBe(ballsBefore + 10);
    });

    it("draws the gifts from every type in the base order when nothing is full (unchanged RNG use)", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.BERRIES_ABOUND, defaultParty);
      const drawSpy = vi.spyOn(Utils, "randSeedItem");

      await runMysteryEncounterToEnd(game, 1, undefined, true);
      await skipBattleRunMysteryEncounterRewardsPhase(game);
      await game.phaseInterceptor.to("SelectModifierPhase");

      const berryDraws = drawSpy.mock.calls.filter(
        ([items]) =>
          Array.isArray(items)
          && items.length === ALL_BERRIES.length
          && items.every(i => ALL_BERRIES.includes(i as BerryType)),
      );
      expect(berryDraws.length).toBe(4);
      for (const [items] of berryDraws) {
        expect(items).toEqual(ALL_BERRIES);
      }
      expect(scene.getPlayerParty().reduce((sum, p) => sum + berryCount(p), 0)).toBe(4);
    });

    // Local fork (2026-11-08), review: the reward screen opens after the gifts, so a type they fill is rolled again
    it("rolls a reward-screen berry again when the gifts fill its type (Endless, race option)", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.BERRIES_ABOUND, defaultParty);
      scene.gameMode = getGameMode(GameModes.ENDLESS);
      const encounter = scene.currentBattle.mysteryEncounter!;
      encounter.misc.enemySpeed = 1; // the race is won: 4 berries, given to the fastest Pokémon first
      const fastest: Pokemon = encounter.misc.fastestPokemon;
      const other = scene.getPlayerParty().find(p => p !== fastest)!;
      for (const berryType of ALL_BERRIES.filter(b => b !== BerryType.SITRUS && b !== BerryType.STARF)) {
        setBerries(other, berryType, 20);
      }
      setBerries(fastest, BerryType.SITRUS, 19);
      expect(getOfferableBerryTypes(scene.getPlayerParty())).toEqual([BerryType.SITRUS, BerryType.STARF]);
      // The first gift is a Sitrus Berry, which fills that type
      const randSeedItem = Utils.randSeedItem;
      vi.spyOn(Utils, "randSeedItem").mockImplementation((items: ArrayLike<unknown>) => {
        const list = Array.from(items);
        return list.includes(BerryType.SITRUS) && list.every(i => ALL_BERRIES.includes(i as BerryType))
          ? BerryType.SITRUS
          : randSeedItem(items);
      });
      const rolled = captureRolledShopBerries();

      await runMysteryEncounterToEnd(game, 2);
      await game.phaseInterceptor.to("SelectModifierPhase");

      expect(rolled.length).toBe(5);
      expect(berry(fastest, BerryType.SITRUS)?.stackCount).toBe(20);
      expect(berry(fastest, BerryType.STARF)?.stackCount).toBe(3);
      expect(getOfferableBerryTypes(scene.getPlayerParty())).toEqual([BerryType.STARF]);
      expect(shownBerryTypes()).toEqual([
        BerryType.STARF,
        BerryType.STARF,
        BerryType.STARF,
        BerryType.STARF,
        BerryType.STARF,
      ]);
    });

    it("shows the reward-screen berries exactly as rolled while the gifts fill no type", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.BERRIES_ABOUND, defaultParty);
      scene.gameMode = getGameMode(GameModes.ENDLESS); // cap 20: four gifts can't fill a type
      const rolled = captureRolledShopBerries();

      await runMysteryEncounterToEnd(game, 1, undefined, true);
      await skipBattleRunMysteryEncounterRewardsPhase(game);
      await game.phaseInterceptor.to("SelectModifierPhase");

      expect(getFullBerryTypes(scene.getPlayerParty()).size).toBe(0);
      const handler = scene.ui.handlers.find(h => h instanceof ModifierSelectUiHandler) as ModifierSelectUiHandler;
      expect(rolled.length).toBe(5);
      expect(handler.options.map(o => o.modifierTypeOption)).toEqual(rolled);
      handler.options.forEach((o, i) => expect(o.modifierTypeOption).toBe(rolled[i]));
    });
  });

  describe("어릿광대의 장난 (Clowning Around) option 2", () => {
    beforeEach(() => {
      useEncounterPool([MysteryEncounterType.CLOWNING_AROUND]);
      game.override.mysteryEncounterTier(MysteryEncounterTier.ULTRA);
    });

    it("re-rolls the Pokémon's berries into offerable types first and keeps the count", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.CLOWNING_AROUND, defaultParty);
      const [lead, second] = scene.getPlayerParty();
      scene.modifiers = [];
      // The lead (most items) holds 6 berries; the second Pokémon is full of everything except Sitrus and Lum
      setBerries(lead, BerryType.STARF, 3);
      setBerries(lead, BerryType.APICOT, 2);
      setBerries(lead, BerryType.SITRUS, 1);
      fillBerries(
        second,
        ALL_BERRIES.filter(b => b !== BerryType.SITRUS && b !== BerryType.LUM),
      );
      const secondBefore = berryCount(second);
      await scene.updateModifiers(true);

      await runMysteryEncounterToEnd(game, 2);

      // Sitrus and Lum come first, up to the lead's cap (2 each); the last two can only be full types
      expect(berry(lead, BerryType.SITRUS)?.stackCount).toBe(2);
      expect(berry(lead, BerryType.LUM)?.stackCount).toBe(2);
      expect(berryCount(lead)).toBe(6);
      expect(berryCount(second)).toBe(secondBefore);
    });

    it("gives only offerable types while they have room", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.CLOWNING_AROUND, defaultParty);
      const [lead, second] = scene.getPlayerParty();
      scene.modifiers = [];
      setBerries(lead, BerryType.STARF, 3);
      fillBerries(
        second,
        ALL_BERRIES.filter(b => b !== BerryType.SITRUS && b !== BerryType.LUM),
      );
      await scene.updateModifiers(true);

      await runMysteryEncounterToEnd(game, 2);

      const leadBerries = lead.getHeldItems().filter(m => m instanceof BerryModifier) as BerryModifier[];
      expect(leadBerries.every(m => m.berryType === BerryType.SITRUS || m.berryType === BerryType.LUM)).toBe(true);
      expect(berryCount(lead)).toBe(3);
    });
  });

  describe("쓰레기 속 보물 (Trash to Treasure)", () => {
    beforeEach(() => {
      useEncounterPool([MysteryEncounterType.TRASH_TO_TREASURE]);
      game.override.mysteryEncounterTier(MysteryEncounterTier.ULTRA);
    });

    it("still gives the Garbodor four berries and starts the battle when every type is full", async () => {
      leadHoldsFullBerriesExcept();
      await game.runToMysteryEncounter(MysteryEncounterType.TRASH_TO_TREASURE, defaultParty);
      expect(getOfferableBerryTypes(scene.getPlayerParty())).toEqual([]);

      const configs = scene.currentBattle.mysteryEncounter!.enemyPartyConfigs[0].pokemonConfigs![0].modifierConfigs!;
      const berryConfigs = configs.slice(0, 4);
      for (const config of berryConfigs) {
        expect(config.modifier).toBeInstanceOf(BerryModifierTypeClass);
        expect((config.modifier as BerryModifierType).id).toBe("BERRY");
      }

      await runMysteryEncounterToEnd(game, 1, undefined, true);
      expect(game).toBeAtPhase("CommandPhase");
      const garbodor = scene.getEnemyField()[0];
      expect(garbodor.species.speciesId).toBe(SpeciesId.GARBODOR);
      expect(garbodor.getHeldItems().some(m => m instanceof BerryModifier)).toBe(true);
    });
  });
});
