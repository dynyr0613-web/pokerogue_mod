import { getGameMode } from "#app/game-mode";
import {
  BASE_TIER_COUNTS,
  ENDLESS_HELD_ITEM_CAPS,
  ENDLESS_TIER_ANCHORS,
  getEndlessTierCounts,
  PLAYER_HELD_ITEM_CAPS,
  tierFromRoll,
} from "#balance/endless-balance";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { BerryType } from "#enums/berry-type";
import { GameModes } from "#enums/game-modes";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import * as Modifier from "#modifiers/modifier";
import { BerryModifier, type ContactHeldItemTransferChanceModifier } from "#modifiers/modifier";
import {
  AddVoucherModifierType,
  getPlayerModifierTypeOptions,
  type ModifierOverride,
  regenerateModifierPoolThresholds,
} from "#modifiers/modifier-type";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import { getModifierPoolForType } from "#utils/modifier-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** The base game's tier thresholds as they were written before the band table (modifier-type.ts) */
function legacyTier(tierValue: number): ModifierTier {
  if (tierValue > 255) {
    return ModifierTier.COMMON;
  }
  if (tierValue > 60) {
    return ModifierTier.GREAT;
  }
  if (tierValue > 12) {
    return ModifierTier.ULTRA;
  }
  if (tierValue) {
    return ModifierTier.ROGUE;
  }
  return ModifierTier.MASTER;
}

function heldItem(pokemon: Pokemon, id: string) {
  const item = pokemon.getHeldItems().find(m => m.type.id === id);
  expect(item, `${pokemon.name} should hold ${id}`).toBeDefined();
  return item!;
}

function berry(pokemon: Pokemon, berryType: BerryType): BerryModifier | undefined {
  return pokemon.getHeldItems().find(m => m instanceof BerryModifier && m.berryType === berryType) as
    | BerryModifier
    | undefined;
}

function berryCount(pokemon: Pokemon, berryType: BerryType): number {
  return berry(pokemon, berryType)?.getStackCount() ?? 0;
}

const SIX_ITEMS: ModifierOverride[] = [
  { name: "BERRY", type: BerryType.SITRUS, count: 1 },
  { name: "BERRY", type: BerryType.LIECHI, count: 1 },
  { name: "LEFTOVERS", count: 1 },
  { name: "SHELL_BELL", count: 1 },
  { name: "GRIP_CLAW", count: 1 },
  { name: "MULTI_LENS", count: 1 },
  { name: "QUICK_CLAW", count: 1 },
];

describe("Custom - Endless item caps, theft rolls and tier bands", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.UNNERVE)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(100)
      .ability(AbilityId.UNNERVE)
      .moveset([MoveId.TACKLE, MoveId.SPLASH])
      .startingLevel(50);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Start a run in a non-Classic mode the way the title screen would and stop at the first command */
  async function startRunInMode(mode: GameModes, species: SpeciesId[]): Promise<void> {
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(mode);
      game.scene.offsetGym = false;
      const starters = generateStarters(game.scene, species);
      const selectStarterPhase = new SelectStarterPhase();
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      selectStarterPhase.initBattle(starters);
    });
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    await game.phaseInterceptor.to("CommandPhase", false);
  }

  describe("tier curve", () => {
    it("reproduces the base game's thresholds with the base counts", () => {
      for (let tierValue = 0; tierValue < 1024; tierValue++) {
        expect(tierFromRoll(tierValue, BASE_TIER_COUNTS), `roll ${tierValue}`).toBe(legacyTier(tierValue));
      }
    });

    it("hits every anchor wave exactly and starts from the base game", () => {
      expect(getEndlessTierCounts(0)).toEqual(BASE_TIER_COUNTS);
      expect(getEndlessTierCounts(1)).toEqual(BASE_TIER_COUNTS);
      for (const anchor of ENDLESS_TIER_ANCHORS) {
        expect(
          anchor.counts.reduce((a, b) => a + b, 0),
          `anchor ${anchor.wave}`,
        ).toBe(1024);
        expect(getEndlessTierCounts(anchor.wave), `wave ${anchor.wave}`).toEqual(anchor.counts);
      }
      // Between anchors the odds move in a straight line: wave 650 is halfway from 300 to 1000
      // (Local fork (2026-11-13): anchors at 0 / 300 / 1000 / 2200 since 08 명세 3번, were 0 / 200 / 500 / 1000)
      expect(getEndlessTierCounts(650)).toEqual([642, 251, 91, 36, 4]);
    });

    it("keeps raising the rarer tiers past wave 2200 and levels off", () => {
      // Local fork (2026-11-13): last anchor 2200 and tail 1800 (08 명세 3번); was 1000 / 1000 with the limit
      // 107/484/231/178/24
      expect(getEndlessTierCounts(3000)).toEqual([338, 383, 173, 115, 15]);
      expect(getEndlessTierCounts(4000)).toEqual([273, 412, 189, 132, 18]);
      expect(getEndlessTierCounts(5850)).toEqual([217, 436, 203, 148, 20]);
      expect(getEndlessTierCounts(100_000)).toEqual([186, 449, 211, 157, 21]);
    });

    it("sums to 1024 at every wave and never lowers a 'this tier or rarer' chance", () => {
      let previous = [0, 0, 0, 0];
      const problems: string[] = [];
      for (let wave = 0; wave <= 20_000; wave++) {
        const counts = getEndlessTierCounts(wave);
        const [, great, ultra, rogue, master] = counts;
        const rarer = [master, master + rogue, master + rogue + ultra, master + rogue + ultra + great];
        if (counts.reduce((a, b) => a + b, 0) !== 1024 || counts.some(c => c < 0)) {
          problems.push(`wave ${wave}: ${counts}`);
        }
        if (rarer.some((r, i) => r < previous[i])) {
          problems.push(`wave ${wave}: ${rarer} after ${previous}`);
        }
        previous = rarer;
      }
      expect(problems).toEqual([]);
    });
  });

  describe("Poké Ball rewards at the 99 cap", () => {
    const balls = [
      { id: "POKEBALL", type: PokeballType.POKEBALL, tier: ModifierTier.COMMON },
      { id: "GREAT_BALL", type: PokeballType.GREAT_BALL, tier: ModifierTier.GREAT },
      { id: "ULTRA_BALL", type: PokeballType.ULTRA_BALL, tier: ModifierTier.ULTRA },
      { id: "ROGUE_BALL", type: PokeballType.ROGUE_BALL, tier: ModifierTier.ROGUE },
      { id: "MASTER_BALL", type: PokeballType.MASTER_BALL, tier: ModifierTier.MASTER },
    ] as const;

    it.each([GameModes.ENDLESS, GameModes.SPLICED_ENDLESS])(
      "%s stops offering a ball type once the player holds 99, like Classic",
      async mode => {
        await startRunInMode(mode, [SpeciesId.FEEBAS]);
        const party = game.scene.getPlayerParty();
        const pool = getModifierPoolForType(ModifierPoolType.PLAYER);
        for (const { id, type, tier } of balls) {
          const entry = pool[tier].find(w => w.modifierType.id === id)!;
          expect(entry).toBeDefined();
          const weight = entry.weight as WeightedModifierTypeWeightFunc;
          game.scene.pokeballCounts[type] = 98;
          expect(weight(party, 0)).toBe(entry.maxWeight);
          game.scene.pokeballCounts[type] = 99;
          expect(weight(party, 0)).toBe(0);
        }
      },
    );
  });

  describe("held item caps", () => {
    it("keeps the base caps in Classic", async () => {
      game.override.startingHeldItems(SIX_ITEMS);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const player = game.field.getPlayerPokemon();

      expect(berry(player, BerryType.SITRUS)!.getMaxStackCount()).toBe(2);
      expect(berry(player, BerryType.LIECHI)!.getMaxStackCount()).toBe(3);
      expect(heldItem(player, "LEFTOVERS").getMaxStackCount()).toBe(4);
      expect(heldItem(player, "SHELL_BELL").getMaxStackCount()).toBe(4);
      expect(heldItem(player, "GRIP_CLAW").getMaxStackCount()).toBe(5);
      // Multi Lens is raised for the player in every mode since 2026-11-05 (PLAYER_HELD_ITEM_CAPS)
      expect(heldItem(player, "MULTI_LENS").getMaxStackCount()).toBe(PLAYER_HELD_ITEM_CAPS.MULTI_LENS);
      expect(heldItem(player, "QUICK_CLAW").getMaxStackCount()).toBe(3);
    });

    it("raises the caps for the player's Pokémon in Endless but not for enemies", async () => {
      game.override.startingHeldItems(SIX_ITEMS).enemyHeldItems([
        { name: "GRIP_CLAW", count: 1 },
        { name: "BERRY", type: BerryType.SITRUS, count: 1 },
      ]);
      await startRunInMode(GameModes.ENDLESS, [SpeciesId.FEEBAS]);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(game.scene.gameMode.isEndless).toBe(true);
      expect(berry(player, BerryType.SITRUS)!.getMaxStackCount()).toBe(ENDLESS_HELD_ITEM_CAPS.BERRY);
      expect(berry(player, BerryType.LIECHI)!.getMaxStackCount()).toBe(ENDLESS_HELD_ITEM_CAPS.BERRY);
      expect(heldItem(player, "LEFTOVERS").getMaxStackCount()).toBe(ENDLESS_HELD_ITEM_CAPS.LEFTOVERS);
      expect(heldItem(player, "SHELL_BELL").getMaxStackCount()).toBe(ENDLESS_HELD_ITEM_CAPS.SHELL_BELL);
      expect(heldItem(player, "GRIP_CLAW").getMaxStackCount()).toBe(ENDLESS_HELD_ITEM_CAPS.GRIP_CLAW);
      expect(heldItem(player, "MULTI_LENS").getMaxStackCount()).toBe(PLAYER_HELD_ITEM_CAPS.MULTI_LENS);
      expect(heldItem(player, "QUICK_CLAW").getMaxStackCount()).toBe(ENDLESS_HELD_ITEM_CAPS.QUICK_CLAW);

      expect(heldItem(enemy, "GRIP_CLAW").getMaxStackCount()).toBe(5);
      expect(berry(enemy, BerryType.SITRUS)!.getMaxStackCount()).toBe(2);
    });

    it("lets a player Pokémon in Endless stack a berry past the Classic cap", async () => {
      game.override.startingHeldItems([{ name: "BERRY", type: BerryType.SITRUS, count: 2 }]);
      await startRunInMode(GameModes.ENDLESS, [SpeciesId.FEEBAS]);
      const player = game.field.getPlayerPokemon();
      const sitrus = berry(player, BerryType.SITRUS)!;

      const extra = sitrus.clone();
      extra.stackCount = 1;
      // addModifier only reports success for form change items, so check the stack instead
      game.scene.addModifier(extra, true, false, false, true);
      expect(berryCount(player, BerryType.SITRUS)).toBe(3);
    });

    it("still refuses a berry past the base cap in Classic", async () => {
      game.override.startingHeldItems([{ name: "BERRY", type: BerryType.SITRUS, count: 2 }]);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const player = game.field.getPlayerPokemon();
      const sitrus = berry(player, BerryType.SITRUS)!;

      const extra = sitrus.clone();
      extra.stackCount = 1;
      game.scene.addModifier(extra, true, false, false, true);
      expect(berryCount(player, BerryType.SITRUS)).toBe(2);
    });

    it("stops a berry stack at 20 in Endless: 20 refuses one more, 19 takes one", async () => {
      // 99 until 2026-11-06, then 20 (the user's request)
      expect(ENDLESS_HELD_ITEM_CAPS.BERRY).toBe(20);
      game.override.startingHeldItems([{ name: "BERRY", type: BerryType.SITRUS, count: 20 }]);
      await startRunInMode(GameModes.ENDLESS, [SpeciesId.FEEBAS]);
      const player = game.field.getPlayerPokemon();
      const sitrus = berry(player, BerryType.SITRUS)!;
      expect(sitrus.getStackCount()).toBe(20);
      expect(sitrus.getMaxStackCount()).toBe(20);

      const addOne = () => {
        const extra = sitrus.clone();
        extra.stackCount = 1;
        game.scene.addModifier(extra, true, false, false, true);
      };

      expect(game.scene.hasRoomForHeldItem(sitrus, player)).toBe(false);
      addOne();
      expect(berryCount(player, BerryType.SITRUS)).toBe(20);

      sitrus.stackCount = 19;
      expect(game.scene.hasRoomForHeldItem(sitrus, player)).toBe(true);
      addOne();
      expect(berryCount(player, BerryType.SITRUS)).toBe(20);

      addOne();
      expect(berryCount(player, BerryType.SITRUS)).toBe(20);
      // Still one stack: the refused berry did not turn into a second Sitrus entry
      expect(player.getHeldItems().filter(m => m instanceof BerryModifier)).toEqual([sitrus]);
    });

    it("keeps 6 Leftovers and an over-cap 50 Sitrus through the Endless session save and load", async () => {
      game.override.startingHeldItems([
        { name: "LEFTOVERS", count: ENDLESS_HELD_ITEM_CAPS.LEFTOVERS },
        { name: "BERRY", type: BerryType.SITRUS, count: 50 },
      ]);
      await startRunInMode(GameModes.ENDLESS, [SpeciesId.FEEBAS]);
      const player = game.field.getPlayerPokemon();
      expect(heldItem(player, "LEFTOVERS").getStackCount()).toBe(6);
      expect(berryCount(player, BerryType.SITRUS)).toBe(50);

      // Serialize the session the way the save does and parse it back the way the load does
      const { gameData } = game.scene;
      const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
      const session = gameData.parseSessionData(json);
      expect(session.gameMode).toBe(GameModes.ENDLESS);
      const savedLeftovers = session.modifiers.find(m => m.typeId === "LEFTOVERS")!;
      const savedSitrus = session.modifiers.find(
        m => m.typeId === "BERRY" && m.typePregenArgs?.[0] === BerryType.SITRUS,
      )!;
      expect(savedLeftovers.stackCount).toBe(6);
      expect(savedSitrus.stackCount).toBe(50);

      // Load it like "Continue" on the title screen: GameData.loadSession -> initSessionFromData, which
      // rebuilds every modifier with `toModifier(Modifier[className])` and its stack clamp
      game.reload["sessionData"] = session;
      await game.reload.reloadSession();

      expect(game.scene.gameMode.isEndless).toBe(true);
      const reloaded = game.field.getPlayerPokemon();
      expect(reloaded).not.toBe(player);
      expect(reloaded.id).toBe(player.id);
      expect(heldItem(reloaded, "LEFTOVERS").getStackCount()).toBe(6);
      expect(heldItem(reloaded, "LEFTOVERS").getMaxStackCount()).toBe(ENDLESS_HELD_ITEM_CAPS.LEFTOVERS);
      expect(berryCount(reloaded, BerryType.SITRUS)).toBe(50);
      expect(berry(reloaded, BerryType.SITRUS)!.getMaxStackCount()).toBe(ENDLESS_HELD_ITEM_CAPS.BERRY);

      // The load clamp is still active: the same saved stacks rebuilt outside Endless fall to the base caps
      game.scene.gameMode = getGameMode(GameModes.CLASSIC);
      expect(savedLeftovers.toModifier(Modifier[savedLeftovers.className])!.stackCount).toBe(4);
      expect(savedSitrus.toModifier(Modifier[savedSitrus.className])!.stackCount).toBe(2);
    });

    // Local fork (2026-11-13): 10 명세 1번, the player's cap is 3 (4 until then): "4연타 (75% + 25% + 25% + 25% = 총합 ×1.50)"
    it("gives 3 Multi Lenses (the player's cap) 4 hits: 0.75x first, then 0.25x per lens", async () => {
      game.override.startingHeldItems([{ name: "MULTI_LENS", count: PLAYER_HELD_ITEM_CAPS.MULTI_LENS }]);
      await startRunInMode(GameModes.ENDLESS, [SpeciesId.MAGIKARP]);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      expect(heldItem(player, "MULTI_LENS").getStackCount()).toBe(3);

      // Same measurement as the upstream Multi Lens test: a fixed base damage of 100 per strike
      const spy = vi.spyOn(enemy, "getAttackDamage");
      vi.spyOn(enemy, "getBaseDamage").mockReturnValue(100);

      game.move.select(MoveId.TACKLE);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
      await game.phaseInterceptor.to("MoveEndPhase", false);

      expect(player.turnData.hitCount).toBe(4);
      // Fork (2026-11-05): the first hit stays at 0.75x, then one 0.25x strike per lens
      const damageResults = spy.mock.results.map(result => result.value?.damage);
      expect(damageResults).toEqual([75, 25, 25, 25]);
    });

    // Local fork (2026-11-13): 10 명세 1번, "기존 세이브 호환: 이미 4개를 든 세이브를 불러올 경우": the load clamp of
    // `ModifierData.toModifier` brings a saved stack of 4 down to the new cap like any other over-cap held item (only the
    // player's berries in Endless keep theirs); the lens itself also counts at most 3 for the player
    // (PokemonMultiHitModifier.getEffectiveStackCount, custom-items-1105.test.ts)
    it("loads an older save's 4 Multi Lenses as 3", async () => {
      game.override.startingHeldItems([{ name: "MULTI_LENS", count: 4 }]);
      await startRunInMode(GameModes.ENDLESS, [SpeciesId.MAGIKARP]);
      const player = game.field.getPlayerPokemon();
      expect(heldItem(player, "MULTI_LENS").getStackCount()).toBe(4);

      const { gameData } = game.scene;
      const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
      const session = gameData.parseSessionData(json);
      expect(session.modifiers.find(m => m.typeId === "MULTI_LENS")!.stackCount).toBe(4);

      game.reload["sessionData"] = session;
      await game.reload.reloadSession();

      const reloaded = game.field.getPlayerPokemon();
      expect(reloaded.id).toBe(player.id);
      expect(heldItem(reloaded, "MULTI_LENS").getStackCount()).toBe(PLAYER_HELD_ITEM_CAPS.MULTI_LENS);
    });
  });

  describe("steal rolls skip items the thief cannot receive", () => {
    it("Grip Claw takes the other item when the holder's berry is already at the cap", async () => {
      game.override
        .startingHeldItems([
          { name: "GRIP_CLAW", count: 1 },
          { name: "BERRY", type: BerryType.SITRUS, count: 2 },
        ])
        .enemyHeldItems([
          { name: "BERRY", type: BerryType.SITRUS, count: 2 },
          { name: "BERRY", type: BerryType.LUM, count: 1 },
        ]);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const gripClaw = heldItem(player, "GRIP_CLAW") as ContactHeldItemTransferChanceModifier;
      vi.spyOn(gripClaw, "chance", "get").mockReturnValue(100);

      expect(berryCount(player, BerryType.SITRUS)).toBe(2);
      expect(berryCount(player, BerryType.LUM)).toBe(0);

      // The steal roll lists the target's items in this order (same `findModifiers` filter order), and
      // every roll of the holder is pinned to its lowest value: without the receivable filter the roll
      // would land on index 0, the Sitrus the holder already has at the cap, and steal nothing
      expect(enemy.getHeldItems().map(m => (m as BerryModifier).berryType)).toEqual([BerryType.SITRUS, BerryType.LUM]);
      vi.spyOn(player, "randBattleSeedInt").mockImplementation((_range: number, min = 0) => min);

      game.move.select(MoveId.TACKLE);
      await game.phaseInterceptor.to("BerryPhase", false);

      expect(berryCount(player, BerryType.LUM)).toBe(1);
      expect(berryCount(player, BerryType.SITRUS)).toBe(2);
      expect(berryCount(enemy, BerryType.LUM)).toBe(0);
      expect(berryCount(enemy, BerryType.SITRUS)).toBe(2);
    });

    it("Thief passes over a higher-tier item the user cannot hold and takes the next one", async () => {
      game.override
        .moveset([MoveId.THIEF])
        .startingHeldItems([{ name: "LEFTOVERS", count: 4 }])
        .enemyHeldItems([
          { name: "LEFTOVERS", count: 1 },
          { name: "BERRY", type: BerryType.LUM, count: 1 },
        ]);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      expect(heldItem(player, "LEFTOVERS").getStackCount()).toBe(4);

      // Thief's 30% steal chance reads randSeedFloat (Phaser.Math.RND.frac)
      vi.spyOn(Phaser.Math.RND, "frac").mockReturnValue(0);

      game.move.select(MoveId.THIEF);
      await game.phaseInterceptor.to("BerryPhase", false);

      expect(berryCount(player, BerryType.LUM)).toBe(1);
      expect(heldItem(player, "LEFTOVERS").getStackCount()).toBe(4);
      expect(heldItem(enemy, "LEFTOVERS").getStackCount()).toBe(1);
      expect(berryCount(enemy, BerryType.LUM)).toBe(0);
    });

    it("Pickup takes loot the holder can receive instead of a berry it has at the cap", async () => {
      game.override
        .ability(AbilityId.PICKUP)
        .startingHeldItems([{ name: "BERRY", type: BerryType.LUM, count: 2 }])
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyLevel(1)
        .enemyHeldItems([
          { name: "BERRY", type: BerryType.LUM, count: 1 },
          { name: "BERRY", type: BerryType.SITRUS, count: 1 },
        ])
        .startingLevel(100);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const player = game.field.getPlayerPokemon();
      expect(berryCount(player, BerryType.LUM)).toBe(2);

      // Pin the loot pick (randSeedItem -> Phaser.Math.RND.pick) to the capped Lum whenever it is on
      // offer, so the pick only lands on the Sitrus if the Lum was filtered out beforehand
      const pick = Phaser.Math.RND.pick.bind(Phaser.Math.RND);
      vi.spyOn(Phaser.Math.RND, "pick").mockImplementation(items => {
        const lum = Array.from(items).find(item => item instanceof BerryModifier && item.berryType === BerryType.LUM);
        return lum ?? pick(items);
      });

      game.move.use(MoveId.AERIAL_ACE);
      await game.toNextWave();

      expect(player.summonData.abilitiesApplied).toContain(AbilityId.PICKUP);
      expect(berryCount(player, BerryType.SITRUS)).toBe(1);
      expect(berryCount(player, BerryType.LUM)).toBe(2);
    });

    it("an enemy's Grip Claw stops at the enemy's base cap even against the player's Endless stack", async () => {
      game.override
        .enemyLevel(1)
        .enemyMoveset(MoveId.TACKLE)
        .startingHeldItems([{ name: "BERRY", type: BerryType.SITRUS, count: 10 }])
        .enemyHeldItems([
          { name: "GRIP_CLAW", count: 1 },
          { name: "BERRY", type: BerryType.SITRUS, count: 1 },
        ]);
      await startRunInMode(GameModes.ENDLESS, [SpeciesId.FEEBAS]);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const gripClaw = heldItem(enemy, "GRIP_CLAW") as ContactHeldItemTransferChanceModifier;
      vi.spyOn(gripClaw, "chance", "get").mockReturnValue(100);

      expect(berryCount(player, BerryType.SITRUS)).toBe(10);
      expect(berry(player, BerryType.SITRUS)!.getMaxStackCount()).toBe(ENDLESS_HELD_ITEM_CAPS.BERRY);
      expect(berryCount(enemy, BerryType.SITRUS)).toBe(1);
      expect(berry(enemy, BerryType.SITRUS)!.getMaxStackCount()).toBe(2);

      // Turn 1: the enemy still has room for one Sitrus and takes it
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(berryCount(enemy, BerryType.SITRUS)).toBe(2);
      expect(berryCount(player, BerryType.SITRUS)).toBe(9);
      const hpAfterFirstHit = player.hp;
      expect(hpAfterFirstHit).toBeLessThan(player.getMaxHp());

      // Turn 2: the claw hits again, but the enemy is at its base cap of 2, so nothing moves
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(player.hp, "the enemy's Tackle connected again").toBeLessThan(hpAfterFirstHit);
      expect(berryCount(enemy, BerryType.SITRUS)).toBe(2);
      expect(berryCount(player, BerryType.SITRUS)).toBe(9);
    });
  });

  describe("Endless reward tiers", () => {
    function sampleRareShare(calls: number): number {
      const party = game.scene.getPlayerParty();
      regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0);
      let rare = 0;
      let total = 0;
      for (let i = 0; i < calls; i++) {
        for (const option of getPlayerModifierTypeOptions(3, party)) {
          total++;
          if (option.type.tier !== undefined && option.type.tier >= ModifierTier.ULTRA) {
            rare++;
          }
        }
      }
      return rare / total;
    }

    /**
     * Pins the seeded rolls of one reward option by call order: call 1 is the 1024 tier roll and gets
     * `tierValue`, call 2 is the luck roll (range 128 at luck 0, only when `tierValue` is not 0) and
     * never upgrades, and every later call is an in-tier pick taking `inTier[i]` ("min" = first item
     * of the tier, "max" = last item) in order, then "min". Returns the list of calls made.
     */
    function pinRolls(tierValue: number, inTier: ("min" | "max")[]): [number, number][] {
      const calls: [number, number][] = [];
      let inTierCalls = 0;
      vi.spyOn(Phaser.Math.RND, "integerInRange").mockImplementation((min: number, max: number) => {
        calls.push([min, max]);
        if (calls.length === 1) {
          expect([min, max], "first call is the tier roll").toEqual([0, 1023]);
          return tierValue;
        }
        if (calls.length === 2 && tierValue !== 0) {
          expect([min, max], "second call is the luck roll").toEqual([0, 127]);
          return 127;
        }
        const pick = inTier[inTierCalls++] ?? "min";
        return pick === "max" ? max : min;
      });
      return calls;
    }

    function oneOption() {
      const party = game.scene.getPlayerParty();
      const [option] = getPlayerModifierTypeOptions(1, party);
      return option;
    }

    it("uses the base tier early and the curve tier deep in Endless for the same roll", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      await startRunInMode(GameModes.ENDLESS, [SpeciesId.FEEBAS]);
      const party = game.scene.getPlayerParty();

      // roll 300: COMMON at wave 50 (267 rolls are GREAT or rarer there), GREAT at wave 1000 (443)
      // (Local fork (2026-11-13): 272 and 601 before the 08 명세 3번 curve)
      game.scene.currentBattle.waveIndex = 50;
      regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0);
      pinRolls(300, ["min"]);
      expect(oneOption().type.tier).toBe(ModifierTier.COMMON);
      vi.restoreAllMocks();

      game.scene.currentBattle.waveIndex = 1000;
      regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0);
      const calls = pinRolls(300, ["min"]);
      const deep = oneOption();
      expect(deep.type.tier).toBe(ModifierTier.GREAT);
      expect(deep.type).not.toBeInstanceOf(AddVoucherModifierType);
      // COMMON can never give a voucher, so no base-table probe: tier roll, luck roll, one pick
      expect(calls).toHaveLength(3);
    });

    it("re-picks when the band tier lands on an egg voucher the base odds did not give", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      await startRunInMode(GameModes.ENDLESS, [SpeciesId.FEEBAS]);
      const party = game.scene.getPlayerParty();
      game.scene.currentBattle.waveIndex = 1000;
      regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0);

      // roll 20: ULTRA with the base counts (no voucher there, so no probe), ROGUE on the curve at wave 1000
      // (6 MASTER, 49 ROGUE); the band pick "max" lands on VOUCHER_PLUS (last ROGUE entry), which must be re-rolled
      const calls = pinRolls(20, ["max", "min"]);
      const option = oneOption();
      expect(option.type).not.toBeInstanceOf(AddVoucherModifierType);
      expect(option.type.tier).toBe(ModifierTier.ROGUE);
      expect(option.type.id).toBe("ROGUE_BALL");
      expect(option.vouchersSettled).toBe(true);
      expect(calls).toHaveLength(4);
    });

    it("leaves Classic's reward rolls untouched at any wave", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const party = game.scene.getPlayerParty();
      game.scene.currentBattle.waveIndex = 1000;
      regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0);

      for (const [roll, tier] of [
        [300, ModifierTier.COMMON],
        [100, ModifierTier.GREAT],
        [20, ModifierTier.ULTRA],
        [5, ModifierTier.ROGUE],
      ] as const) {
        const calls = pinRolls(roll, ["min"]);
        const option = oneOption();
        expect(option.type.tier, `roll ${roll}`).toBe(tier);
        expect(option.vouchersSettled).toBe(false);
        expect(calls, `roll ${roll}`).toHaveLength(3);
        vi.mocked(Phaser.Math.RND.integerInRange).mockRestore();
      }
    });

    it("keeps an egg voucher that the base odds would have given, even when the band tier differs", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      await startRunInMode(GameModes.ENDLESS, [SpeciesId.FEEBAS]);
      const party = game.scene.getPlayerParty();
      game.scene.currentBattle.waveIndex = 1000;
      regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0);

      // roll 100: GREAT with the base counts, ULTRA on the curve at wave 1000 (ROGUE before the 08 명세 3번 curve); the
      // base pick lands on the last GREAT entry, which is the egg voucher
      pinRolls(100, ["max"]);
      const option = oneOption();
      expect(option.type).toBeInstanceOf(AddVoucherModifierType);
      expect(option.type.tier).toBe(ModifierTier.GREAT);
    });

    it("keeps the base odds' egg voucher at wave 3000 too", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      await startRunInMode(GameModes.ENDLESS, [SpeciesId.FEEBAS]);
      const party = game.scene.getPlayerParty();
      game.scene.currentBattle.waveIndex = 3000;
      regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0);

      // roll 100: GREAT with the base counts, ROGUE on the curve at wave 3000 (15 MASTER, 115 ROGUE since 08 명세 3번)
      pinRolls(100, ["max"]);
      const option = oneOption();
      expect(option.type).toBeInstanceOf(AddVoucherModifierType);
      expect(option.type.tier).toBe(ModifierTier.GREAT);
    });

    it("hands out clearly more rare tiers at wave 2200 than at wave 50", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      await startRunInMode(GameModes.ENDLESS, [SpeciesId.FEEBAS]);

      // base odds: ULTRA+ROGUE+MASTER = 61/1024 ≈ 6%; the last anchor: 255/1024 ≈ 25% (Local fork (2026-11-13): that
      // anchor moved from wave 1000 to 2200 with 08 명세 3번, so the deep sample moved with it)
      game.scene.currentBattle.waveIndex = 50;
      expect(sampleRareShare(300)).toBeLessThan(0.11);
      game.scene.currentBattle.waveIndex = 2200;
      expect(sampleRareShare(300)).toBeGreaterThan(0.13);
    }, 120_000);
  });
});
