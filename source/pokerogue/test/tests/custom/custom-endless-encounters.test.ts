import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { ENDLESS_HELD_ITEM_CAPS } from "#balance/endless-balance";
import { modifierTypes } from "#data/data-lists";
import { BerryType } from "#enums/berry-type";
import { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { GameModes } from "#enums/game-modes";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { BerryModifier, type PokemonHeldItemModifier } from "#modifiers/modifier";
import type {
  BerryModifierType,
  ModifierType,
  ModifierTypeKeys,
  PokemonHeldItemModifierType,
} from "#modifiers/modifier-type";
import { generateModifierType } from "#mystery-encounters/encounter-phase-utils";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { runMysteryEncounterToEnd } from "#test/utils/encounter-test-utils";
import { generateStarters } from "#test/utils/game-manager-utils";
import type { BattleMessageUiHandler } from "#ui/battle-message-ui-handler";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const defaultParty = [SpeciesId.LAPRAS, SpeciesId.GENGAR, SpeciesId.ABRA];
const defaultWave = 45;

/** Clowning Around's Rogue pool as the base game writes it (every mode but Endless keeps it) */
const BASE_ROGUE_POOL: Record<string, number> = {
  LEFTOVERS: 4,
  SHELL_BELL: 4,
  SOUL_DEW: 10,
  SCOPE_LENS: 1,
  BATON: 1,
  FOCUS_BAND: 5,
  KINGS_ROCK: 3,
  GRIP_CLAW: 5,
};

/** The pool a player's Pokémon gets in Classic: Scope Lens stacks to 3 in every mode since 2026-11-05 */
const CLASSIC_ROGUE_POOL: Record<string, number> = { ...BASE_ROGUE_POOL, SCOPE_LENS: 3 };

/** The same pool with the holder's Endless caps (Leftovers 6, Shell Bell 8, Grip Claw 7) */
const ENDLESS_ROGUE_POOL: Record<string, number> = { ...CLASSIC_ROGUE_POOL, LEFTOVERS: 6, SHELL_BELL: 8, GRIP_CLAW: 7 };

/** Clowning Around's berry pool as the base game writes it (28 berries; Salac is 2 there although its cap is 3) */
const BASE_BERRY_POOL: Partial<Record<BerryType, number>> = {
  [BerryType.APICOT]: 3,
  [BerryType.ENIGMA]: 2,
  [BerryType.GANLON]: 3,
  [BerryType.LANSAT]: 3,
  [BerryType.LEPPA]: 2,
  [BerryType.LIECHI]: 3,
  [BerryType.LUM]: 2,
  [BerryType.PETAYA]: 3,
  [BerryType.SALAC]: 2,
  [BerryType.SITRUS]: 2,
  [BerryType.STARF]: 3,
};

function berryType(berry: BerryType): BerryModifierType {
  return generateModifierType(modifierTypes.BERRY, [berry]) as BerryModifierType;
}

function itemType(id: string): PokemonHeldItemModifierType {
  return generateModifierType(
    modifierTypes[id as ModifierTypeKeys] as () => ModifierType,
  ) as PokemonHeldItemModifierType;
}

/** Gives `pokemon` a stack of `count`, past its cap if need be (as the upstream encounter tests do) */
function giveItem(scene: BattleScene, pokemon: Pokemon, count: number, type: PokemonHeldItemModifierType): void {
  const itemMod = type.newModifier(pokemon) as PokemonHeldItemModifier;
  itemMod.stackCount = count;
  scene.addModifier(itemMod, true, false, false, true);
}

function berriesOf(pokemon: Pokemon): Map<BerryType, number> {
  const berries = new Map<BerryType, number>();
  for (const m of pokemon.getHeldItems()) {
    if (m instanceof BerryModifier) {
      berries.set(m.berryType, (berries.get(m.berryType) ?? 0) + m.stackCount);
    }
  }
  return berries;
}

function total(counts: Map<unknown, number>): number {
  return [...counts.values()].reduce((a, b) => a + b, 0);
}

describe("Custom Endless - Mystery Encounters with raised held-item caps", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .mysteryEncounterChance(100)
      .startingWave(defaultWave)
      .startingBiome(BiomeId.CAVE)
      .disableTrainerWaves();
  });

  /**
   * Start a run in `mode` the way the title screen would (like `runToMysteryEncounter`, which is Classic only) and
   * stop once `encounterType` has started. `setup` runs right after the party exists, before the encounter's `onInit`.
   */
  async function runToEncounter(
    mode: GameModes,
    encounterType: MysteryEncounterType,
    setup?: (party: PlayerPokemon[]) => void,
  ): Promise<void> {
    game.override.mysteryEncounter(encounterType);
    await game.runToTitle();

    game.onNextPrompt(
      "TitlePhase",
      UiMode.TITLE,
      () => {
        game.scene.gameMode = getGameMode(mode);
        const starters = generateStarters(game.scene, defaultParty);
        const selectStarterPhase = new SelectStarterPhase();
        game.scene.phaseManager.pushNew("EncounterPhase", false);
        selectStarterPhase.initBattle(starters);
        setup?.(game.scene.getPlayerParty());
      },
      () => game.isCurrentPhase("EncounterPhase"),
    );

    game.onNextPrompt(
      "EncounterPhase",
      UiMode.MESSAGE,
      () => {
        const handler = game.scene.ui.getHandler() as BattleMessageUiHandler;
        handler.processInput(Button.ACTION);
      },
      () => game.isCurrentPhase("MysteryEncounterPhase"),
      true,
    );

    await game.phaseInterceptor.to("EncounterPhase");
    expect(game.scene.gameMode.modeId).toBe(mode);
    expect(game.scene.currentBattle?.mysteryEncounter?.encounterType).toBe(encounterType);
  }

  describe("Clowning Around option 2 (item swap)", () => {
    function giveBerries(scene: BattleScene, pokemon: Pokemon, berries: [BerryType, number][]): void {
      scene.modifiers = [];
      for (const [berry, count] of berries) {
        giveItem(scene, pokemon, count, berryType(berry));
      }
      scene.updateModifiers(true);
    }

    function rogueItemsOf(pokemon: Pokemon): Map<string, number> {
      const items = new Map<string, number>();
      for (const m of pokemon.getHeldItems()) {
        if (m.type.id in BASE_ROGUE_POOL) {
          items.set(m.type.id, (items.get(m.type.id) ?? 0) + m.stackCount);
        }
      }
      return items;
    }

    it("returns every berry it took in Endless: 40 Sitrus + 30 Liechi in (over the 20 cap, like an old save), 70 out", async () => {
      await runToEncounter(GameModes.ENDLESS, MysteryEncounterType.CLOWNING_AROUND);
      const [lead, ...others] = game.scene.getPlayerParty();
      giveBerries(game.scene, lead, [
        [BerryType.SITRUS, 40],
        [BerryType.LIECHI, 30],
      ]);

      await runMysteryEncounterToEnd(game, 2);

      const berries = berriesOf(lead);
      expect(total(berries)).toBe(70);
      for (const m of lead.getHeldItems()) {
        expect(m.stackCount).toBeLessThanOrEqual(m.getMaxStackCount());
      }
      expect(Math.max(...berries.values())).toBeLessThanOrEqual(ENDLESS_HELD_ITEM_CAPS.BERRY);
      for (const pokemon of others) {
        expect(berriesOf(pokemon).size).toBe(0);
      }
    });

    it("can hand back a full Endless berry pouch: 11 types x cap in, the cap of every type out", async () => {
      // The berry cap is 20 since 2026-11-06 (99 before)
      const cap = ENDLESS_HELD_ITEM_CAPS.BERRY;
      await runToEncounter(GameModes.ENDLESS, MysteryEncounterType.CLOWNING_AROUND);
      const lead = game.field.getPlayerPokemon();
      const allBerries = Object.keys(BASE_BERRY_POOL).map(b => Number(b) as BerryType);
      giveBerries(
        game.scene,
        lead,
        allBerries.map(b => [b, cap] as [BerryType, number]),
      );

      await runMysteryEncounterToEnd(game, 2);

      // 11 x cap berries exhaust the Endless pool exactly, so every type is back at its cap
      const berries = berriesOf(lead);
      expect(total(berries)).toBe(allBerries.length * cap);
      for (const b of allBerries) {
        expect(berries.get(b)).toBe(cap);
      }
    });

    it("keeps the base game's berry pool in Classic: 70 berries forced in, the 28-berry pool out", async () => {
      await runToEncounter(GameModes.CLASSIC, MysteryEncounterType.CLOWNING_AROUND);
      const lead = game.field.getPlayerPokemon();
      giveBerries(game.scene, lead, [
        [BerryType.SITRUS, 40],
        [BerryType.LIECHI, 30],
      ]);

      await runMysteryEncounterToEnd(game, 2);

      // More berries than the pool holds exhaust it, so the result is exactly the base pool (Salac 2 included)
      const berries = berriesOf(lead);
      expect(total(berries)).toBe(28);
      expect(Object.fromEntries(berries)).toEqual(BASE_BERRY_POOL);
    });

    it("returns a legal Classic hand unchanged in size", async () => {
      await runToEncounter(GameModes.CLASSIC, MysteryEncounterType.CLOWNING_AROUND);
      const lead = game.field.getPlayerPokemon();
      giveBerries(game.scene, lead, [
        [BerryType.SITRUS, 2],
        [BerryType.LIECHI, 3],
        [BerryType.GANLON, 3],
      ]);

      await runMysteryEncounterToEnd(game, 2);

      const berries = berriesOf(lead);
      expect(total(berries)).toBe(8);
      for (const [b, count] of berries) {
        expect(count).toBeLessThanOrEqual(BASE_BERRY_POOL[b]!);
      }
    });

    it.each([
      { name: "Endless", mode: GameModes.ENDLESS, pool: ENDLESS_ROGUE_POOL, expected: 43 },
      { name: "Classic", mode: GameModes.CLASSIC, pool: CLASSIC_ROGUE_POOL, expected: 35 },
    ])("swaps 43 Rogue items for the holder's pool in $name ($expected back)", async ({ mode, pool, expected }) => {
      await runToEncounter(mode, MysteryEncounterType.CLOWNING_AROUND);
      const { scene } = game;
      const lead = game.field.getPlayerPokemon();
      scene.modifiers = [];
      // Endless caps: 6 Leftovers, 8 Shell Bells and 7 Grip Claws, plus the uncapped Rogue items at their caps
      for (const [id, count] of Object.entries(ENDLESS_ROGUE_POOL)) {
        giveItem(scene, lead, count, itemType(id));
      }
      scene.updateModifiers(true);
      expect(total(rogueItemsOf(lead))).toBe(43);

      await runMysteryEncounterToEnd(game, 2);

      // 43 items exhaust either pool, so the result is exactly the holder's pool
      const items = rogueItemsOf(lead);
      expect(total(items)).toBe(expected);
      expect(Object.fromEntries(items)).toEqual(pool);
    });
  });

  describe("Absolute Avarice with large Endless berry stacks", () => {
    /**
     * Lead 20 Sitrus + 20 Liechi + 10 Ganlon, second 20 Lum + 10 Starf, third 5 Petaya (forced past caps in
     * Classic). These were 99/99/50 and 99/30 while the Endless berry cap was 99 (before 2026-11-06).
     */
    const stolen: [BerryType, number][][] = [
      [
        [BerryType.SITRUS, 20],
        [BerryType.LIECHI, 20],
        [BerryType.GANLON, 10],
      ],
      [
        [BerryType.LUM, 20],
        [BerryType.STARF, 10],
      ],
      [[BerryType.PETAYA, 5]],
    ];

    function giveStolenBerries(party: PlayerPokemon[]): void {
      party.forEach((pokemon, i) => {
        for (const [berry, count] of stolen[i] ?? []) {
          giveItem(game.scene, pokemon, count, berryType(berry));
        }
      });
    }

    it("puts one config per berry type on the Greedent, clamped to the enemy's base caps", async () => {
      await runToEncounter(GameModes.ENDLESS, MysteryEncounterType.ABSOLUTE_AVARICE, giveStolenBerries);

      // Every berry was taken from the party
      expect(game.scene.findModifiers(m => m instanceof BerryModifier)).toHaveLength(0);

      const configs =
        game.scene.currentBattle.mysteryEncounter!.enemyPartyConfigs[0].pokemonConfigs![0].modifierConfigs!;
      const greedentBerries = configs.map(c => [(c.modifier as BerryModifierType).getPregenArgs()[0], c.stackCount]);
      // Same types, order and counts the old one-config-per-berry loop ended up with
      expect(greedentBerries).toEqual([
        [BerryType.SITRUS, 2],
        [BerryType.LIECHI, 3],
        [BerryType.GANLON, 3],
        [BerryType.LUM, 2],
        [BerryType.STARF, 3],
        [BerryType.PETAYA, 3],
      ]);
    });

    it("starts the Greedent fight holding at most its base caps", async () => {
      await runToEncounter(GameModes.ENDLESS, MysteryEncounterType.ABSOLUTE_AVARICE, giveStolenBerries);
      await runMysteryEncounterToEnd(game, 1, undefined, true);

      const greedent = game.field.getEnemyPokemon();
      expect(greedent.species.speciesId).toBe(SpeciesId.GREEDENT);
      const berries = berriesOf(greedent);
      // 16 berries, minus the one Stuff Cheeks ate before the first turn
      expect(total(berries)).toBeGreaterThanOrEqual(15);
      expect(total(berries)).toBeLessThanOrEqual(16);
      for (const m of greedent.getHeldItems()) {
        expect(m.stackCount).toBeLessThanOrEqual(m.getMaxStackCount());
      }
    });

    it("option 2 returns 2/5 of each Pokemon's own berries, one stack per type, with one shuffle each", async () => {
      await runToEncounter(GameModes.ENDLESS, MysteryEncounterType.ABSOLUTE_AVARICE, giveStolenBerries);
      const party = game.scene.getPlayerParty();
      const addModifierSpy = vi.spyOn(game.scene, "addModifier");
      const shuffleSpy = vi.spyOn(Phaser.Math.RND, "shuffle");

      await runMysteryEncounterToEnd(game, 2);

      // 50 -> 20, 30 -> 12, 5 -> 2
      const expectedCounts = [20, 12, 2];
      party.forEach((pokemon, i) => {
        const berries = berriesOf(pokemon);
        expect(total(berries)).toBe(expectedCounts[i]);
        const own = new Map(stolen[i]);
        for (const [b, count] of berries) {
          expect(own.has(b), `${pokemon.name} only gets its own berries back`).toBe(true);
          expect(count).toBeLessThanOrEqual(own.get(b)!);
        }
      });
      expect(party.reduce((n, p) => n + total(berriesOf(p)), 0)).toBe(34);

      // One stack per returned type instead of one add (and one modifier update) per berry
      const berryAdds = addModifierSpy.mock.calls.filter(([m]) => m instanceof BerryModifier);
      expect(berryAdds.length).toBe(party.reduce((n, p) => n + berriesOf(p).size, 0));
      expect(berryAdds.length).toBeLessThanOrEqual(6);
      // One shuffle per Pokemon with berries instead of one per returned berry
      expect(shuffleSpy).toHaveBeenCalledTimes(3);
    });

    it("keeps the base game's reshuffle per returned berry in Classic", async () => {
      await runToEncounter(GameModes.CLASSIC, MysteryEncounterType.ABSOLUTE_AVARICE, party => {
        giveItem(game.scene, party[0], 2, berryType(BerryType.SITRUS));
        giveItem(game.scene, party[0], 3, berryType(BerryType.GANLON));
        giveItem(game.scene, party[0], 3, berryType(BerryType.APICOT));
      });
      const configs =
        game.scene.currentBattle.mysteryEncounter!.enemyPartyConfigs[0].pokemonConfigs![0].modifierConfigs!;
      expect(configs.map(c => c.stackCount)).toEqual([2, 3, 3]);
      const shuffleSpy = vi.spyOn(Phaser.Math.RND, "shuffle");

      await runMysteryEncounterToEnd(game, 2);

      // 8 stolen -> 3 returned, each drawn after a fresh shuffle as before
      expect(total(berriesOf(game.field.getPlayerPokemon()))).toBe(3);
      expect(shuffleSpy).toHaveBeenCalledTimes(3);
    });
  });
});
