import { modifierTypes } from "#data/data-lists";
import { getLevelTotalExp } from "#data/exp";
import { AbilityId } from "#enums/ability-id";
import { Button } from "#enums/buttons";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { ShopCursorTarget } from "#enums/shop-cursor-target";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { CANDY_PILE_JAR_COUNTS, candyPileJarLevels, candyPileLevels } from "#modifiers/custom-consumables";
import { LearnMovePhase } from "#phases/learn-move-phase";
import { GameManager } from "#test/framework/game-manager";
import { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import { PartyUiHandler } from "#ui/party-ui-handler";
import { getModifierPoolForType } from "#utils/modifier-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Custom consumables - Candy Pile (사탕더미)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  /** [species at that moment, move] for every move a level-up or evolution offered */
  let offered: [SpeciesId, MoveId][];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingLevel(20)
      .startingWave(1)
      .itemRewards([{ name: "CANDY_PILE" }])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(1)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH]);
    // Record offered moves instead of opening the learn-move menus
    offered = [];
    vi.spyOn(LearnMovePhase.prototype, "start").mockImplementation(function (this: LearnMovePhase) {
      offered.push([this.getPokemon().species.speciesId, (this as unknown as { moveId: MoveId }).moveId]);
      this.end();
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function addCandyJars(count: number): void {
    for (let i = 0; i < count; i++) {
      game.scene.addModifier(modifierTypes.CANDY_JAR().withIdFromFunc(modifierTypes.CANDY_JAR).newModifier()!);
    }
  }

  /**
   * Win the wave, take the Candy Pile from the reward screen, give it to party slot `slot` and run every phase it
   * queues. Returns each party member's level and friendship just before the pick.
   */
  async function pickPileFor(slot: number): Promise<{ level: number; friendship: number }[]> {
    let before: { level: number; friendship: number }[] = [];
    game.move.select(MoveId.SPLASH);
    await game.doKillOpponents();
    await game.phaseInterceptor.to("SelectModifierPhase", false);
    // wait for the reward screen to take input (its tutorial check is async)
    game.onNextPrompt(
      "SelectModifierPhase",
      UiMode.MODIFIER_SELECT,
      () => {
        before = game.scene.getPlayerParty().map(p => ({ level: p.level, friendship: p.friendship }));
        const handler = game.scene.ui.getHandler() as ModifierSelectUiHandler;
        expect(handler).toBeInstanceOf(ModifierSelectUiHandler);
        handler.setRowCursor(ShopCursorTarget.REWARDS);
        handler.setCursor(0);
        handler.processInput(Button.ACTION);
      },
      undefined,
      true,
    );
    game.onNextPrompt("SelectModifierPhase", UiMode.PARTY, () => {
      const handler = game.scene.ui.getHandler() as PartyUiHandler;
      expect(handler).toBeInstanceOf(PartyUiHandler);
      handler.setCursor(slot);
      handler.processInput(Button.ACTION); // open its options
      handler.processInput(Button.ACTION); // Apply
    });
    await game.phaseInterceptor.to("NewBattlePhase", false);
    return before;
  }

  function setLevel(pokemon: PlayerPokemon, level: number): void {
    pokemon.level = level;
    pokemon.exp = getLevelTotalExp(level, pokemon.species.growthRate);
  }

  // Local fork (2026-11-08): Candy Jars count per pile, not per candy (the user's option (가)).
  // Local fork (2026-11-12): "직접 쓰는 개체에겐 사탕단지 효과 두배, 나머지는 한번만": 7 + 2 x jars and 2 + jars
  it("gives the chosen Pokémon 7 levels plus the Candy Jars twice and the rest 2 plus the jars once, with friendship per candy", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.LAPRAS, SpeciesId.TAUROS);
    const party = game.scene.getPlayerParty();
    addCandyJars(2);
    for (const p of party) {
      p.friendship = 0;
    }

    const before = await pickPileFor(2);

    // 2 jars: 7 + 2 x 2 and 2 + 2 levels; Rare Candy friendship is still 6 per candy (7 and 2 candies)
    expect(party.map((p, i) => p.level - before[i].level)).toEqual([4, 4, 11]);
    expect(party.map((p, i) => p.friendship - before[i].friendship)).toEqual([12, 12, 42]);
    for (const p of party) {
      expect(p.exp).toBe(getLevelTotalExp(p.level, p.species.growthRate));
    }
  });

  it("goes through every evolution on the way, offering moves from the species at each point (Caterpie -> Butterfree)", async () => {
    game.override.startingLevel(5);
    await game.classicMode.startBattle(SpeciesId.CATERPIE);
    const caterpie = game.scene.getPlayerParty()[0];
    expect(caterpie.level).toBe(5);

    await pickPileFor(0);

    // Rare Candies: 6, 7 (Metapod), 8, 9, 10 (Butterfree); Rarer Candies: 11 (Confusion), 12
    expect(caterpie.species.speciesId).toBe(SpeciesId.BUTTERFREE);
    expect(caterpie.level).toBe(12);
    expect(offered).toContainEqual([SpeciesId.BUTTERFREE, MoveId.CONFUSION]);
    expect(offered).not.toContainEqual([SpeciesId.CATERPIE, MoveId.BUG_BITE]);
  });

  // Local fork (2026-11-08): was +28 (4 levels per candy) before the jars counted per pile.
  // Local fork (2026-11-12): +27 with the chosen Pokémon's jars doubled (was +10 with them counted once)
  it("adds the Candy Jars twice, on the first Rare Candy, and still evolves on the way (Charmander L14 with 3 jars -> Charmeleon L27)", async () => {
    game.override.startingLevel(14);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const charmander = game.scene.getPlayerParty()[0];
    addCandyJars(3);

    await pickPileFor(0);

    // First Rare Candy 1 + 2 x 3 jars: 21 (Charmeleon); then 1 each: 22-25, Rarer Candies 26, 27
    expect(charmander.level).toBe(27);
    expect(charmander.species.speciesId).toBe(SpeciesId.CHARMELEON);
  });

  // Local fork (2026-11-08): 30 jars used to give 217 levels to the chosen Pokémon and 62 to the rest.
  // Local fork (2026-11-12): now 67 (7 + 2 x 30) and 32 (2 + 30); 37 and 32 while the jars counted once for all
  it("with 30 Candy Jars gives the chosen Pokémon 67 levels and the rest 32, evolving twice in the long jumps", async () => {
    game.override.startingLevel(5);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER, SpeciesId.CATERPIE, SpeciesId.SNORLAX);
    addCandyJars(30);

    await pickPileFor(0);

    // Charmander: first Rare Candy 1 + 2 x 30 jars: 66 (Charmeleon), 67 (Charizard), 68-70, Rarer 71, 72.
    // Caterpie: first Rarer Candy 1 + 30 jars: 36 (Metapod), second 37 (Butterfree).
    const party = game.scene.getPlayerParty();
    expect(party.map(p => [p.species.speciesId, p.level])).toEqual([
      [SpeciesId.CHARIZARD, 72],
      [SpeciesId.BUTTERFREE, 37],
      [SpeciesId.SNORLAX, 37],
    ]);
  });

  it("lets the Rarer Candies evolve the other party members too (Caterpie L8 -> Butterfree L10)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.CATERPIE);
    const [snorlax, caterpie] = game.scene.getPlayerParty();
    setLevel(caterpie, 8);

    const before = await pickPileFor(0);

    expect(snorlax.level - before[0].level).toBe(7);
    expect(caterpie.level).toBe(10);
    expect(caterpie.species.speciesId).toBe(SpeciesId.BUTTERFREE);
  });

  it("gives a Shedinja that appears partway the Rarer Candies still to come", async () => {
    game.override.startingLevel(15);
    await game.classicMode.startBattle(SpeciesId.NINCADA, SpeciesId.SNORLAX);

    await pickPileFor(0);

    // Rare Candies: Nincada 16-20, evolving into Ninjask + Shedinja at 20; both Rarer Candies then reach all three
    const party = game.scene.getPlayerParty();
    expect(party.map(p => [p.species.speciesId, p.level])).toEqual([
      [SpeciesId.NINJASK, 22],
      [SpeciesId.SNORLAX, 17],
      [SpeciesId.SHEDINJA, 22],
    ]);
  });

  // Local fork (2026-11-08): the jar bonus of the other members rides on the first Rarer round
  // Local fork (2026-11-12): a Shedinja that appears partway is not the chosen Pokémon, so it gets the jars once
  it("gives a Shedinja that appears partway the Candy Jar bonus once, with its first Rarer Candy", async () => {
    game.override.startingLevel(15);
    await game.classicMode.startBattle(SpeciesId.NINCADA, SpeciesId.SNORLAX);
    addCandyJars(2);

    await pickPileFor(0);

    // Rare Candies: Nincada 20 (1 + 2 x 2 jars; Ninjask + Shedinja at 20), 21, 22, 23, 24; Rarer: +1, +1.
    // Snorlax and the new Shedinja: first Rarer Candy 1 + 2 jars, second 1.
    const party = game.scene.getPlayerParty();
    expect(party.map(p => [p.species.speciesId, p.level])).toEqual([
      [SpeciesId.NINJASK, 26],
      [SpeciesId.SNORLAX, 19],
      [SpeciesId.SHEDINJA, 24],
    ]);
  });

  it("also levels fainted party members, like Rarer Candy", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.LAPRAS);
    const party = game.scene.getPlayerParty();
    party[1].hp = 0;

    const before = await pickPileFor(0);

    expect(party.map((p, i) => p.level - before[i].level)).toEqual([7, 2]);
  });

  // Local fork (2026-11-08): the description counts the Candy Jars per pile and says so.
  // Local fork (2026-11-12): twice for the chosen Pokémon, once for the rest
  it("describes the levels with the Candy Jars counted twice for the chosen Pokémon and once for the rest", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const type = modifierTypes.CANDY_PILE().withIdFromFunc(modifierTypes.CANDY_PILE);
    expect(type.name).toBe("Candy Pile");
    expect(type.getDescription()).toBe(
      "Uses 5 Rare Candies and 2 Rarer Candies at once, with Candy Jars counted twice for the chosen Pokémon and once for the rest: the chosen Pokémon gains 7 levels and the rest of the party 2.",
    );
    addCandyJars(1);
    expect(type.getDescription()).toContain("gains 9 levels and the rest of the party 3.");
    addCandyJars(29);
    expect(type.getDescription()).toContain("gains 67 levels and the rest of the party 32.");
  });

  // Local fork (2026-11-12): the jar counts live in one frozen table
  it("keeps the Candy Jar counts in one frozen table: 2 for the chosen Pokémon, 1 for the rest", async () => {
    expect(CANDY_PILE_JAR_COUNTS).toEqual({ target: 2, party: 1 });
    expect(Object.isFrozen(CANDY_PILE_JAR_COUNTS)).toBe(true);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    expect(candyPileJarLevels()).toEqual({ target: 0, party: 0 });
    expect(candyPileLevels()).toEqual({ target: 7, party: 2 });
    addCandyJars(5);
    expect(candyPileJarLevels()).toEqual({ target: 10, party: 5 });
    expect(candyPileLevels()).toEqual({ target: 17, party: 7 });
  });

  it("sits in the ROGUE tier of the player pool at weight 4, and nowhere else", () => {
    const pool = getModifierPoolForType(ModifierPoolType.PLAYER);
    const rogue = pool[ModifierTier.ROGUE].find(w => w.modifierType.id === "CANDY_PILE");
    expect(rogue).toBeDefined();
    expect(rogue!.weight).toBe(4);
    expect(rogue!.modifierType.tier).toBe(ModifierTier.ROGUE);
    for (const tier of [ModifierTier.COMMON, ModifierTier.GREAT, ModifierTier.ULTRA, ModifierTier.MASTER]) {
      expect(pool[tier].some(w => w.modifierType.id === "CANDY_PILE")).toBe(false);
    }
  });
});
