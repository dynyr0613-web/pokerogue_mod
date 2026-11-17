import type { BattleScene } from "#app/battle-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { modifierTypes } from "#data/data-lists";
import { BiomeId } from "#enums/biome-id";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { EnemyPokemon } from "#field/pokemon";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import * as ModifierTypeModule from "#modifiers/modifier-type";
import { generateModifierType, generateModifierTypeOption } from "#mystery-encounters/encounter-phase-utils";
import {
  generateHyperTradeOffer,
  generateHyperTradeOption,
  generateHyperWonderTradePokemon,
  getHyperItemTradeRewardTier,
  getHyperTradableItems,
  getHyperTradeableSpecies,
  getHyperTradePool,
  getTradedItemTier,
  HYPER_TRADE_BST_RANGE,
  HyperGlobalTradeSystemEncounter,
  isExcludedHyperItemReward,
  isHyperSpecialSpecies,
} from "#mystery-encounters/hyper-global-trade-system-encounter";
import * as MysteryEncounters from "#mystery-encounters/mystery-encounter-biomes";
import { allMysteryEncounters, CIVILIZATION_ENCOUNTER_BIOMES } from "#mystery-encounters/mystery-encounter-biomes";
import { GameManager } from "#test/framework/game-manager";
import { runMysteryEncounterToEnd } from "#test/utils/encounter-test-utils";
import { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const namespace = "mysteryEncounters/hyperGlobalTradeSystem";
const defaultParty = [SpeciesId.LAPRAS, SpeciesId.GENGAR, SpeciesId.ABRA];
const defaultBiome = BiomeId.CAVE;
const defaultWave = 45;

describe("Custom mystery encounter - Hyper GTS (하이퍼 GTS)", () => {
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
      .startingWave(defaultWave)
      .startingBiome(defaultBiome)
      .disableTrainerWaves();

    const biomeMap = new Map<BiomeId, MysteryEncounterType[]>([
      [BiomeId.VOLCANO, [MysteryEncounterType.MYSTERIOUS_CHALLENGERS]],
    ]);
    CIVILIZATION_ENCOUNTER_BIOMES.forEach(biome => {
      biomeMap.set(biome, [MysteryEncounterType.HYPER_GLOBAL_TRADE_SYSTEM]);
    });
    vi.spyOn(MysteryEncounters, "mysteryEncountersByBiome", "get").mockReturnValue(biomeMap);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function giveItem(type: ModifierTypeModule.ModifierType, stacks = 1): PokemonHeldItemModifier {
    const modifier = type.newModifier(game.field.getPlayerPokemon()) as PokemonHeldItemModifier;
    modifier.stackCount = stacks;
    scene.addModifier(modifier, true, false, false, true);
    return modifier;
  }

  it("is an ULTRA-tier encounter of the civilization biomes, with the GTS's four options and its own text", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.HYPER_GLOBAL_TRADE_SYSTEM, defaultParty);

    expect(allMysteryEncounters[MysteryEncounterType.HYPER_GLOBAL_TRADE_SYSTEM]).toBe(HyperGlobalTradeSystemEncounter);
    expect(HyperGlobalTradeSystemEncounter.encounterTier).toBe(MysteryEncounterTier.ULTRA);
    expect(HyperGlobalTradeSystemEncounter.options.length).toBe(4);
    expect(HyperGlobalTradeSystemEncounter.dialogue.encounterOptionsDialogue?.title).toBe(`${namespace}:title`);
    expect(i18next.t(`${namespace}:title`)).toBe("The Hyper GTS");
    expect(scene.currentBattle.mysteryEncounter?.encounterType).toBe(MysteryEncounterType.HYPER_GLOBAL_TRADE_SYSTEM);
  });

  describe("Option 1 - trade offers", () => {
    it("offers 3 species per party member, each from its base stat total up to +100, none repeated", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.HYPER_GLOBAL_TRADE_SYSTEM, defaultParty);
      const map: Map<number, EnemyPokemon[]> = scene.currentBattle.mysteryEncounter!.misc.tradeOptionsMap;

      const seen = new Set<SpeciesId>(defaultParty);
      for (const member of scene.getPlayerParty()) {
        const bst = member.getSpeciesForm().getBaseStatTotal();
        const offers = map.get(member.id)!;
        expect(offers).toHaveLength(3);
        for (const offer of offers) {
          const offerBst = offer.getSpeciesForm().getBaseStatTotal(); // the form it rolled, not form 0
          expect(offerBst).toBeGreaterThanOrEqual(bst);
          expect(offerBst).toBeLessThanOrEqual(bst + HYPER_TRADE_BST_RANGE);
          expect(seen.has(offer.species.speciesId)).toBe(false);
          seen.add(offer.species.speciesId);
          expect(offer.level).toBe(member.level);
        }
      }
    });

    it("can offer legendary, mythical and Paradox species, and still finds offers above the strongest Pokémon", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.HYPER_GLOBAL_TRADE_SYSTEM, defaultParty);

      const picks = Array.from({ length: 150 }, () => generateHyperTradeOption([], 600));
      expect(picks.some(isHyperSpecialSpecies)).toBe(true);
      expect(picks.every(s => s.getBaseStatTotal() >= 600 && s.getBaseStatTotal() <= 700)).toBe(true);
      expect(picks.some(s => EXCLUDED_PARADOX.includes(s.speciesId) || s.legendary || s.mythical)).toBe(true);

      // Arceus (720): almost nothing is stronger, so the floor drops, but the cap stays at +100
      const arceus = speciesDataRegistry.getSpecies(SpeciesId.ARCEUS);
      const top = Array.from({ length: 30 }, () => generateHyperTradeOption([arceus], 720));
      expect(top.every(s => s !== arceus && s.getBaseStatTotal() <= 820)).toBe(true);
    });

    it("checks the window on the form the offer actually rolls (Rotom's appliance forms are 520)", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.HYPER_GLOBAL_TRADE_SYSTEM, defaultParty);
      // Only Rotom (440, forms 520) and Butterfree (395) left: a 395-495 window must never give an appliance Rotom
      const keep = [SpeciesId.ROTOM, SpeciesId.BUTTERFREE];
      const others = speciesDataRegistry.getAllSpecies().filter(s => !keep.includes(s.speciesId));
      for (let i = 0; i < 40; i++) {
        const formBst = generateHyperTradeOffer(others, 395, 30).getSpeciesForm().getBaseStatTotal();
        expect(formBst).toBeGreaterThanOrEqual(395);
        expect(formBst).toBeLessThanOrEqual(495);
      }
    });

    it("never hands out Eternatus (final boss)", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.HYPER_GLOBAL_TRADE_SYSTEM, defaultParty);
      expect(getHyperTradeableSpecies().some(s => s.speciesId === SpeciesId.ETERNATUS)).toBe(false);
      expect(getHyperTradePool([], 690).pool.some(s => s.speciesId === SpeciesId.ETERNATUS)).toBe(false);
      expect(getHyperTradePool([], 690).pool.some(s => s.speciesId === SpeciesId.MEWTWO)).toBe(true);
    });

    it("trades the chosen member for the chosen offer", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.HYPER_GLOBAL_TRADE_SYSTEM, defaultParty);
      const member = scene.getPlayerParty()[1];
      const offer = (scene.currentBattle.mysteryEncounter!.misc.tradeOptionsMap as Map<number, EnemyPokemon[]>).get(
        member.id,
      )![1];

      await runMysteryEncounterToEnd(game, 1, { pokemonNo: 2, optionNo: 2 });

      expect(scene.getPlayerParty().at(-1)?.species).toBe(offer.species);
      expect(scene.getPlayerParty().some(p => p.species.speciesId === SpeciesId.GENGAR)).toBe(false);
    });
  });

  describe("Option 2 - Wonder Trade", () => {
    it("gives a legendary, mythical or Paradox about 1 time in 4, and anything else always shiny", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.HYPER_GLOBAL_TRADE_SYSTEM, defaultParty);

      const received = Array.from({ length: 120 }, () => generateHyperWonderTradePokemon(30));
      const special = received.filter(p => isHyperSpecialSpecies(p.species));
      expect(special.length).toBeGreaterThan(10);
      expect(special.length).toBeLessThan(55);
      for (const p of received) {
        expect(defaultParty).not.toContain(p.species.speciesId);
        expect(p.level).toBe(30);
        if (!isHyperSpecialSpecies(p.species)) {
          expect(p.shiny).toBe(true);
          expect([0, 1, 2]).toContain(p.variant);
          expect(p.luck).toBe(p.variant + 1);
        }
      }
      // the variant is still rolled: not every shiny is the same tier
      expect(new Set(received.filter(p => p.shiny).map(p => p.variant)).size).toBeGreaterThan(1);
    });

    it("trades a party member for the Wonder Trade Pokémon", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.HYPER_GLOBAL_TRADE_SYSTEM, defaultParty);

      await runMysteryEncounterToEnd(game, 2, { pokemonNo: 1 });

      const receivedPokemon = scene.getPlayerParty().at(-1)!;
      expect(defaultParty).not.toContain(receivedPokemon.species.speciesId);
      expect(receivedPokemon.shiny || isHyperSpecialSpecies(receivedPokemon.species)).toBe(true);
    });
  });

  describe("Option 3 - Trade an Item", () => {
    it("moves items two tiers up, Rogue to Master", () => {
      expect(getHyperItemTradeRewardTier(ModifierTier.COMMON)).toBe(ModifierTier.ULTRA);
      expect(getHyperItemTradeRewardTier(ModifierTier.GREAT)).toBe(ModifierTier.ROGUE);
      expect(getHyperItemTradeRewardTier(ModifierTier.ULTRA)).toBe(ModifierTier.MASTER);
      expect(getHyperItemTradeRewardTier(ModifierTier.ROGUE)).toBe(ModifierTier.MASTER);
    });

    // Local fork (2026-11-11): the Master TM (MASTER_TM) counts as a TM too
    it("never hands out TMs (the Master TM too), Rare Candy, Rarer Candy or Candy Pile", () => {
      for (const id of ["TM_COMMON", "TM_GREAT", "TM_ULTRA", "MASTER_TM", "RARE_CANDY", "RARER_CANDY", "CANDY_PILE"]) {
        expect(isExcludedHyperItemReward(id)).toBe(true);
      }
      expect(isExcludedHyperItemReward("LEFTOVERS")).toBe(false);
      expect(isExcludedHyperItemReward("MASTER_BALL")).toBe(false);
    });

    it("refuses Master-tier items", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.HYPER_GLOBAL_TRADE_SYSTEM, defaultParty);
      scene.modifiers = [];
      const vest = giveItem(generateModifierType(modifierTypes.ASSAULT_VEST)!);
      const lead = game.field.getPlayerPokemon();
      expect(getHyperTradableItems(lead)).toEqual([]);

      const soulDew = giveItem(generateModifierType(modifierTypes.SOUL_DEW)!);
      expect(getHyperTradableItems(lead)).toEqual([soulDew]);
      expect(getHyperTradableItems(lead)).not.toContain(vest);
    });

    it("reads an item's tier without changing the tier its type carries", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.HYPER_GLOBAL_TRADE_SYSTEM, defaultParty);
      scene.modifiers = [];
      const soulDew = giveItem(generateModifierType(modifierTypes.SOUL_DEW)!);
      soulDew.type.tier = ModifierTier.ULTRA; // as a trainer's copy of the type might carry

      expect(getTradedItemTier(soulDew)).toBe(ModifierTier.ROGUE);
      expect(soulDew.type.tier).toBe(ModifierTier.ULTRA);
    });

    it("gives a Rogue item for a Great one (Soothe Bell), skipping excluded rewards", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.HYPER_GLOBAL_TRADE_SYSTEM, defaultParty);
      scene.modifiers = [];
      giveItem(generateModifierType(modifierTypes.SOOTHE_BELL)!);
      await scene.updateModifiers(true);
      // The first roll is a Candy Pile: it has to be rolled again
      const pile = generateModifierTypeOption(modifierTypes.CANDY_PILE)!;
      const roll = vi.spyOn(ModifierTypeModule, "getPlayerModifierTypeOptions").mockReturnValueOnce([pile]);

      await runMysteryEncounterToEnd(game, 3, { pokemonNo: 1, optionNo: 1 });
      await game.phaseInterceptor.to("SelectModifierPhase");

      expect(roll.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(scene.ui.mode).toBe(UiMode.MODIFIER_SELECT);
      const handler = scene.ui.handlers.find(h => h instanceof ModifierSelectUiHandler) as ModifierSelectUiHandler;
      expect(handler.options).toHaveLength(1);
      const reward = handler.options[0].modifierTypeOption.type;
      expect(reward.tier).toBe(ModifierTier.ROGUE);
      expect(isExcludedHyperItemReward(reward.id)).toBe(false);
    });

    it("gives a Master item for a Rogue one (Soul Dew) and takes one stack", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.HYPER_GLOBAL_TRADE_SYSTEM, defaultParty);
      scene.modifiers = [];
      const soulDew = giveItem(generateModifierType(modifierTypes.SOUL_DEW)!, 2);
      await scene.updateModifiers(true);

      await runMysteryEncounterToEnd(game, 3, { pokemonNo: 1, optionNo: 1 });
      await game.phaseInterceptor.to("SelectModifierPhase");

      const handler = scene.ui.handlers.find(h => h instanceof ModifierSelectUiHandler) as ModifierSelectUiHandler;
      expect(handler.options[0].modifierTypeOption.type.tier).toBe(ModifierTier.MASTER);
      expect(soulDew.stackCount).toBe(1);
    });
  });
});

/** The GTS's Paradox list, re-read here so the test does not depend on the encounter's own helper */
const EXCLUDED_PARADOX = [
  SpeciesId.GREAT_TUSK,
  SpeciesId.SCREAM_TAIL,
  SpeciesId.BRUTE_BONNET,
  SpeciesId.FLUTTER_MANE,
  SpeciesId.SLITHER_WING,
  SpeciesId.SANDY_SHOCKS,
  SpeciesId.ROARING_MOON,
  SpeciesId.WALKING_WAKE,
  SpeciesId.GOUGING_FIRE,
  SpeciesId.RAGING_BOLT,
  SpeciesId.IRON_TREADS,
  SpeciesId.IRON_BUNDLE,
  SpeciesId.IRON_HANDS,
  SpeciesId.IRON_JUGULIS,
  SpeciesId.IRON_MOTH,
  SpeciesId.IRON_THORNS,
  SpeciesId.IRON_VALIANT,
  SpeciesId.IRON_LEAVES,
  SpeciesId.IRON_BOULDER,
  SpeciesId.IRON_CROWN,
];
