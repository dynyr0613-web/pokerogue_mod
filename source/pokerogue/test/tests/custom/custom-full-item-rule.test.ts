import { getGameMode } from "#app/game-mode";
import { FULL_RULE_HELD_ITEM_IDS, PLAYER_HELD_ITEM_CAPS, partyHoldsMax } from "#balance/endless-balance";
import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BerryType } from "#enums/berry-type";
import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PokeballType } from "#enums/pokeball";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import {
  type BerryModifier,
  HealShopCostModifier,
  type PokemonHeldItemModifier,
  SpeciesStatBoosterModifier,
} from "#modifiers/modifier";
import {
  type AttackTypeBoosterModifierType,
  getPlayerModifierTypeOptions,
  type ModifierType,
  type ModifierTypeGenerator,
  PokemonHeldItemModifierType,
  regenerateModifierPoolThresholds,
} from "#modifiers/modifier-type";
import * as EncounterDialogueUtils from "#mystery-encounters/encounter-dialogue-utils";
import { generateModifierType } from "#mystery-encounters/encounter-phase-utils";
import * as MysteryEncounters from "#mystery-encounters/mystery-encounter-biomes";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { runMysteryEncounterToEnd } from "#test/utils/encounter-test-utils";
import { generateStarters } from "#test/utils/game-manager-utils";
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import { getModifierPoolForType } from "#utils/modifier-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local fork, the user's requests of 2026-11-06 (doc §6-7):
 * - a held item of the player's reward pool is not offered while even one of the player's Pokémon holds it at its
 *   cap (berries and the Wide Lens had it first; now "배턴, 부활의씨앗 등도"), type boosters and species items per kind;
 * - the player's steal rolls skip those same items while anyone in the party holds them at the cap;
 * - a repeat Trash to Treasure dig says what it really gives (5 Poké Balls, or nothing once Poké Balls are full);
 * - a reward tier whose items are all filtered out falls back to the next tier down.
 */
describe("Custom - full held items left out of rewards and steals", () => {
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

  /** Gives `pokemon` `count` of the held item made by `type`, past any cap, and returns the stack */
  function give(pokemon: Pokemon, type: ModifierType, count: number): PokemonHeldItemModifier {
    const mod = type.newModifier(pokemon) as PokemonHeldItemModifier;
    game.scene.addModifier(mod, true, false, false, true);
    const held = pokemon.getHeldItems().find(m => m.matchType(mod))!;
    held.stackCount = count;
    return held;
  }

  function playerPoolEntry(id: string) {
    const pool = getModifierPoolForType(ModifierPoolType.PLAYER);
    for (const tier of Object.values(pool)) {
      const entry = tier.find(w => w.modifierType.id === id);
      if (entry) {
        return entry;
      }
    }
    return;
  }

  describe("rewards", () => {
    it("lists exactly the plain held items of the player's reward pool", () => {
      const pool = getModifierPoolForType(ModifierPoolType.PLAYER);
      const plainHeld = Object.values(pool)
        .flat()
        .filter(w => w.modifierType instanceof PokemonHeldItemModifierType)
        .map(w => w.modifierType.id);
      expect([...plainHeld].sort()).toEqual([...FULL_RULE_HELD_ITEM_IDS].sort());
    });

    it("gives every listed item weight 0 while one party member holds it at the cap", async () => {
      await startEndless([SpeciesId.FEEBAS, SpeciesId.MAGIKARP]);
      const party = game.scene.getPlayerParty();
      const [first, second] = party;
      // Items whose own rule offers them to this party without conditions (moves, abilities, species, unlocks)
      const unconditional = new Set([
        "SOOTHE_BELL",
        "REVIVER_SEED",
        "QUICK_CLAW",
        "GOLDEN_PUNCH",
        "WIDE_LENS",
        "BATON",
        "LEFTOVERS",
        "SHELL_BELL",
        "GRIP_CLAW",
        "SCOPE_LENS",
        "SOUL_DEW",
        "FOCUS_BAND",
        "KINGS_ROCK",
        "LIFE_ORB",
        "MULTI_LENS",
        "ASSAULT_VEST",
        "BULLETPROOF_VEST",
        "PRISM",
        // Local fork (2026-11-09)
        "CHOICE_BAND",
        "CHOICE_SCARF",
        "CHOICE_SPECS",
        "CHOICE_ARMOR",
        // Local fork (2026-11-09): Training Shackles, Flame Cauldron, Ultimate Gene
        "TRAINING_SHACKLES",
        "FLAME_CAULDRON",
        "ULTIMATE_GENE",
        "TOXIC_DISTILLER", // Local fork (2026-11-10)
        "DISCHARGED_COIL", // Local fork (2026-11-10)
        // Local fork (2026-11-11): Metronome, Expert Belt, Precision Lens (Power Herb, Loaded Dice, Seed Pouch and Fuel
        // depend on the party's moves or types)
        "METRONOME",
        "EXPERT_BELT",
        "PRECISION_LENS",
        // Local fork (2026-11-11): Clear Amulet, Booster Energy (Throat Spray, Muscle Band and Wise Glasses depend on
        // the party's moves)
        "CLEAR_AMULET",
        "BOOSTER_ENERGY",
        // Local fork (2026-11-12): Weight Band (offered while someone holds fewer than 3) and Champion Belt
        // (one per Pokémon, so at 0/1 the other party member has none)
        "WEIGHT_BAND",
        "CHAMPION_BELT",
        // Local fork (2026-11-12): the six EV items, one per Pokémon and one per party (at 0/1 nobody holds one)
        "POWER_WEIGHT",
        "POWER_BRACER",
        "POWER_BELT",
        "POWER_LENS",
        "POWER_BAND",
        "POWER_ANKLET",
      ]);
      for (const id of FULL_RULE_HELD_ITEM_IDS) {
        const entry = playerPoolEntry(id)!;
        const weight = entry.weight as WeightedModifierTypeWeightFunc;
        expect(weight, id).toBeInstanceOf(Function);
        const held = give(first, entry.modifierType, 1);
        const cap = held.getMaxHeldItemCount(first);
        held.stackCount = cap - 1;
        if (unconditional.has(id)) {
          expect(weight(party, 0), `${id} at ${cap - 1}/${cap}`).toBeGreaterThan(0);
        }
        held.stackCount = cap;
        expect(second.getHeldItems().some(m => m.type.id === id)).toBe(false);
        expect(weight(party, 0), `${id} at ${cap}/${cap}`).toBe(0);
        game.scene.removeModifier(held);
      }
    });

    // Local fork (2026-11-13): 10 명세 1번, "partyHoldsMax도 동일한 상한(3)을 참조하므로 파티 중 한 마리라도 3개를 들면 보상 풀과
    // 훔치기 후보에서 자동으로 제외된다" (the steal half is under "steals")
    it("drops the Multi Lens once one Pokémon holds 3 (the player's cap since 2026-11-13)", async () => {
      await startEndless([SpeciesId.FEEBAS, SpeciesId.MAGIKARP]);
      const party = game.scene.getPlayerParty();
      const entry = playerPoolEntry("MULTI_LENS")!;
      const weight = entry.weight as WeightedModifierTypeWeightFunc;
      const held = give(party[1], entry.modifierType, PLAYER_HELD_ITEM_CAPS.MULTI_LENS - 1);
      expect(held.getMaxHeldItemCount(party[1])).toBe(PLAYER_HELD_ITEM_CAPS.MULTI_LENS);
      expect(partyHoldsMax(party, "MULTI_LENS")).toBe(false);
      expect(weight(party, 0)).toBeGreaterThan(0);

      held.stackCount = PLAYER_HELD_ITEM_CAPS.MULTI_LENS;
      expect(partyHoldsMax(party, "MULTI_LENS")).toBe(true);
      expect(weight(party, 0)).toBe(0);
      // a stack of 4 from before the cap fell counts as full too
      held.stackCount = 4;
      expect(weight(party, 0)).toBe(0);
      game.scene.removeModifier(held);
      expect(weight(party, 0)).toBeGreaterThan(0);
    });

    it("drops the Baton and the Reviver Seed once one Pokémon holds one, though the other has none", async () => {
      await startEndless([SpeciesId.FEEBAS, SpeciesId.MAGIKARP]);
      const party = game.scene.getPlayerParty();
      for (const [id, base] of [
        ["BATON", 2],
        ["REVIVER_SEED", 4],
      ] as const) {
        const entry = playerPoolEntry(id)!;
        const weight = entry.weight as WeightedModifierTypeWeightFunc;
        expect(weight(party, 0)).toBe(base);
        const held = give(party[1], entry.modifierType, 1);
        expect(held.getMaxHeldItemCount(party[1])).toBe(1);
        expect(weight(party, 0)).toBe(0);
        game.scene.removeModifier(held);
        expect(weight(party, 0)).toBe(base);
      }
    });

    it("leaves out only the move type whose booster someone holds at the cap", async () => {
      game.override.moveset([MoveId.WATER_GUN, MoveId.TACKLE]);
      await startEndless([SpeciesId.FEEBAS, SpeciesId.MAGIKARP]);
      const party = game.scene.getPlayerParty();
      const generator = modifierTypes.ATTACK_TYPE_BOOSTER() as ModifierTypeGenerator;
      const roll = () => {
        const seen = new Set<PokemonType>();
        for (let i = 0; i < 200; i++) {
          seen.add((generator.generateType(party) as AttackTypeBoosterModifierType).moveType);
        }
        return seen;
      };
      expect([...roll()].sort()).toEqual([PokemonType.NORMAL, PokemonType.WATER].sort());

      const mysticWater = generator.generateType([], [PokemonType.WATER])!;
      const held = give(party[1], mysticWater, 98);
      expect(held.getMaxHeldItemCount(party[1])).toBe(99);
      expect(roll().has(PokemonType.WATER)).toBe(true);
      held.stackCount = 99;
      expect([...roll()]).toEqual([PokemonType.NORMAL]);
    });

    it("offers no Light Ball once one Pikachu holds it, though a second Pikachu could use one", async () => {
      await startEndless([SpeciesId.PIKACHU, SpeciesId.PIKACHU]);
      const party = game.scene.getPlayerParty();
      const generator = modifierTypes.RARE_SPECIES_STAT_BOOSTER() as ModifierTypeGenerator;
      const lightBall = generator.generateType(party)!;
      expect(lightBall.name).toBe(generator.generateType([], ["LIGHT_BALL"])!.name);

      give(party[0], lightBall, 1);
      expect(party[0].getHeldItems().some(m => m instanceof SpeciesStatBoosterModifier)).toBe(true);
      expect(generator.generateType(party)).toBeNull();
    });

    it("falls back to ROGUE when every MASTER item is filtered out", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      await startEndless([SpeciesId.FEEBAS]);
      const party = game.scene.getPlayerParty();
      const master = getModifierPoolForType(ModifierPoolType.PLAYER)[ModifierTier.MASTER];
      const saved = master.map(w => w.weight);
      try {
        for (const w of master) {
          w.weight = 0;
        }
        regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0);
        const [option] = getPlayerModifierTypeOptions(1, party, [ModifierTier.MASTER]);
        expect(option).toBeTruthy();
        expect(option.type.tier).toBe(ModifierTier.ROGUE);
      } finally {
        master.forEach((w, i) => {
          w.weight = saved[i];
        });
        regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0);
      }
    });
  });

  describe("steals", () => {
    it("skips an item another party member holds at the cap, for player thieves only", async () => {
      game.override.enemyHeldItems([
        { name: "LEFTOVERS", count: 1 },
        { name: "BERRY", type: BerryType.SITRUS, count: 1 },
        { name: "BERRY", type: BerryType.LUM, count: 1 },
      ]);
      await startEndless([SpeciesId.FEEBAS, SpeciesId.MAGIKARP]);
      const [thief, other] = game.scene.getPlayerParty();
      const enemy = game.field.getEnemyPokemon();
      const enemyItem = (id: string, berryType?: BerryType) =>
        enemy
          .getHeldItems()
          .find(m => m.type.id === id && (berryType === undefined || (m as BerryModifier).berryType === berryType))!;
      const leftovers = enemyItem("LEFTOVERS");
      const sitrus = enemyItem("BERRY", BerryType.SITRUS);
      const lum = enemyItem("BERRY", BerryType.LUM);

      for (const item of [leftovers, sitrus, lum]) {
        expect(game.scene.canTakeHeldItem(item, thief)).toBe(true);
      }
      give(other, leftovers.type, 6);
      give(other, sitrus.type, 20);
      // The thief itself still has room, but someone in the party is full
      expect(game.scene.hasRoomForHeldItem(leftovers, thief)).toBe(true);
      expect(game.scene.canTakeHeldItem(leftovers, thief)).toBe(false);
      expect(game.scene.canTakeHeldItem(sitrus, thief)).toBe(false);
      expect(game.scene.canTakeHeldItem(lum, thief)).toBe(true);

      // An enemy thief only needs room of its own: it holds 1 Leftovers of its base cap 4
      const otherLeftovers = other.getHeldItems().find(m => m.type.id === "LEFTOVERS")!;
      expect(game.scene.canTakeHeldItem(otherLeftovers, enemy)).toBe(true);
    });

    // Local fork (2026-11-13): 10 명세 1번, the Multi Lens is full at 3 for the steal rolls too
    it("skips an enemy's Multi Lens once another party member holds 3", async () => {
      game.override.enemyHeldItems([{ name: "MULTI_LENS", count: 1 }]);
      await startEndless([SpeciesId.FEEBAS, SpeciesId.MAGIKARP]);
      const [thief, other] = game.scene.getPlayerParty();
      const enemy = game.field.getEnemyPokemon();
      const lens = enemy.getHeldItems().find(m => m.type.id === "MULTI_LENS")!;
      expect(game.scene.canTakeHeldItem(lens, thief)).toBe(true);

      const held = give(other, lens.type, PLAYER_HELD_ITEM_CAPS.MULTI_LENS - 1);
      expect(game.scene.canTakeHeldItem(lens, thief)).toBe(true);
      held.stackCount = PLAYER_HELD_ITEM_CAPS.MULTI_LENS;
      // The thief itself still has room, but someone in the party is full
      expect(game.scene.hasRoomForHeldItem(lens, thief)).toBe(true);
      expect(game.scene.canTakeHeldItem(lens, thief)).toBe(false);
    });

    it("Thief takes the Lum Berry when a party member already holds the most Leftovers", async () => {
      game.override.moveset([MoveId.THIEF]).enemyHeldItems([
        { name: "LEFTOVERS", count: 1 },
        { name: "BERRY", type: BerryType.LUM, count: 1 },
      ]);
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
      const [thief, other] = game.scene.getPlayerParty();
      const enemy = game.field.getEnemyPokemon();
      give(other, enemy.getHeldItems().find(m => m.type.id === "LEFTOVERS")!.type, 4);
      expect(enemy.getHeldItems().map(m => m.type.id)).toEqual(["LEFTOVERS", "BERRY"]);

      vi.spyOn(Phaser.Math.RND, "frac").mockReturnValue(0);
      vi.spyOn(thief, "randBattleSeedInt").mockImplementation((_range: number, min = 0) => min);
      game.move.select(MoveId.THIEF);
      await game.phaseInterceptor.to("BerryPhase", false);

      expect(thief.getHeldItems().map(m => m.type.id)).toEqual(["BERRY"]);
      expect(enemy.getHeldItems().map(m => m.type.id)).toEqual(["LEFTOVERS"]);
    });
  });

  describe("Black Sludge from a repeat Trash to Treasure dig", () => {
    const party = [SpeciesId.LAPRAS, SpeciesId.GENGAR, SpeciesId.ABRA];

    beforeEach(() => {
      game.override.mysteryEncounterChance(100).startingWave(45).startingBiome(BiomeId.CAVE).disableTrainerWaves();
      vi.spyOn(MysteryEncounters, "mysteryEncountersByBiome", "get").mockReturnValue(
        new Map<BiomeId, MysteryEncounterType[]>([[BiomeId.CAVE, [MysteryEncounterType.TRASH_TO_TREASURE]]]),
      );
    });

    function sludges() {
      return game.scene.findModifiers(m => m instanceof HealShopCostModifier, true) as HealShopCostModifier[];
    }

    function newSludge() {
      return generateModifierType(modifierTypes.MYSTERY_ENCOUNTER_BLACK_SLUDGE, [2.5])!.newModifier()!;
    }

    async function dig(): Promise<string[]> {
      const texts = vi.spyOn(EncounterDialogueUtils, "showEncounterText");
      await runMysteryEncounterToEnd(game, 2);
      await game.phaseInterceptor.to("SelectModifierPhase");
      return texts.mock.calls.map(c => c[0]);
    }

    it("still gives Black Sludge on the first dig", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.TRASH_TO_TREASURE, party);
      const texts = await dig();
      expect(sludges().map(s => s.stackCount)).toEqual([1]);
      expect(texts).toContain("You received\nBlack Sludge!");
    });

    it("says the second one became 5 Poké Balls instead of claiming Black Sludge", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.TRASH_TO_TREASURE, party);
      game.scene.addModifier(newSludge(), false, false, false, true);
      const balls = game.scene.pokeballCounts[PokeballType.POKEBALL];
      const texts = await dig();
      expect(sludges().map(s => s.stackCount)).toEqual([1]);
      expect(game.scene.pokeballCounts[PokeballType.POKEBALL]).toBe(balls + 5);
      expect(texts).toContain("The stack for Black Sludge is full.\nYou will receive 5× Poké Ball instead.");
      expect(texts).not.toContain("You received\nBlack Sludge!");
    });

    it("gives nothing and says so when Poké Balls are already full", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.TRASH_TO_TREASURE, party);
      game.scene.addModifier(newSludge(), false, false, false, true);
      game.scene.pokeballCounts[PokeballType.POKEBALL] = 99;
      const texts = await dig();
      expect(game.scene.pokeballCounts[PokeballType.POKEBALL]).toBe(99);
      expect(texts).toContain(
        "The stack for Black Sludge is full.\nYour Poké Balls are full too, so you receive nothing.",
      );
    });

    it("makes any full-stack fallback skip full Poké Balls", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.TRASH_TO_TREASURE, party);
      game.scene.addModifier(newSludge(), false, false, false, true);
      game.scene.pokeballCounts[PokeballType.POKEBALL] = 99;
      const messages = vi.spyOn(game.scene.phaseManager, "queueMessage");
      expect(game.scene.addModifier(newSludge(), false, false, false, true)).toBe(false);
      expect(game.scene.pokeballCounts[PokeballType.POKEBALL]).toBe(99);
      expect(messages.mock.calls.map(c => c[0])).toEqual([
        "The stack for Black Sludge is full.\nYour Poké Balls are full too, so you receive nothing.",
      ]);
    });
  });
});
