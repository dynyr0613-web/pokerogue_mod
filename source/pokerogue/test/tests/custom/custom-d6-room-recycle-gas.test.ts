// Local fork (2026-11-19): 1.2.0 D6 (the user: "d6 실행"). Tests of the three moves that were unimplemented:
// Wonder Room (원더룸: 5 turns, plain Defense / Sp. Def swapped, ended by using it again), Recycle (리사이클: the last
// berry eaten this battle comes back, from Harvest's list) and Corrosive Gas (부식가스: Knock Off's item removal on
// everyone around the user, never on the player's party). Also their enemy AI scores and their place in the TM tiers.

import { __INTERNAL_TEST_EXPORTS } from "#app/ai/ai-moveset-gen";
import { getPokemonNameWithAffix } from "#app/messages";
import { tmPoolTiers } from "#balance/tm-pool-tiers";
import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerIndex } from "#enums/battler-index";
import { BerryType } from "#enums/berry-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { BerryModifier, type PokemonHeldItemModifier } from "#modifiers/modifier";
import { BerryModifierType } from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import { readFileSync } from "node:fs";
import i18next from "i18next";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Local fork - 1.2.0 D6: Wonder Room, Recycle, Corrosive Gas", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(100)
      .ability(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH, MoveId.WONDER_ROOM, MoveId.RECYCLE, MoveId.CORROSIVE_GAS]);
  });

  it("are implemented and stay in the TM tiers (일반)", () => {
    for (const moveId of [MoveId.WONDER_ROOM, MoveId.RECYCLE, MoveId.CORROSIVE_GAS]) {
      expect(allMoves[moveId].isUnimplemented).toBe(false);
      expect(tmPoolTiers[moveId]).toBe(ModifierTier.COMMON);
    }
  });

  describe("Wonder Room", () => {
    it("lasts 5 turns counting the turn of use, with its start and end messages", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const feebas = game.field.getPlayerPokemon();

      game.move.select(MoveId.WONDER_ROOM);
      await game.toNextTurn();

      expect(game).toHaveArenaTag({
        tagType: ArenaTagType.WONDER_ROOM,
        side: ArenaTagSide.BOTH,
        sourceId: feebas.id,
        sourceMove: MoveId.WONDER_ROOM,
        turnCount: 4,
      });
      expect(game).toHaveShownMessage(i18next.t("arenaTag:wonderRoomOnAdd"));
      expect(game).not.toHaveShownMessage(i18next.t("arenaTag:wonderRoomOnRemove"));

      for (let turn = 0; turn < 3; turn++) {
        game.move.select(MoveId.SPLASH);
        await game.toNextTurn();
        expect(game).toHaveArenaTag(ArenaTagType.WONDER_ROOM);
      }
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(game).not.toHaveArenaTag(ArenaTagType.WONDER_ROOM);
      expect(game).toHaveShownMessage(i18next.t("arenaTag:wonderRoomOnRemove"));
    });

    it("ends when it is used again while up", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);

      game.move.select(MoveId.WONDER_ROOM);
      await game.toNextTurn();
      expect(game).toHaveArenaTag(ArenaTagType.WONDER_ROOM);

      game.move.select(MoveId.WONDER_ROOM);
      await game.toNextTurn();
      expect(game).not.toHaveArenaTag(ArenaTagType.WONDER_ROOM);
      expect(game).toHaveShownMessage(i18next.t("arenaTag:wonderRoomOnRemove"));
    });

    // Review fix (2026-11-19): the arena flyout names a tag by `arenaFlyout:<camelCase tag type>`; without the key it
    // showed the raw "arenaFlyout:wonderRoom"
    it("is named in the arena flyout, in both locales", () => {
      expect(i18next.t("arenaFlyout:wonderRoom")).toBe("Wonder Room");
      const ko = JSON.parse(readFileSync("./locales/ko/arena-flyout.json", "utf8"));
      expect(ko.wonderRoom).toBe("원더룸");
    });

    it("swaps the plain Defense and Sp. Def, leaving the stat stages with their own stat", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const karp = game.field.getEnemyPokemon();
      karp.setStat(Stat.DEF, 400);
      karp.setStat(Stat.SPDEF, 100);
      karp.setStatStage(Stat.DEF, 2);

      expect(karp.getEffectiveStat(Stat.DEF)).toBe(800);
      expect(karp.getEffectiveStat(Stat.SPDEF)).toBe(100);

      game.scene.arena.addTag(ArenaTagType.WONDER_ROOM, 5, MoveId.WONDER_ROOM, karp.id);

      expect(karp.getEffectiveStat(Stat.DEF)).toBe(200); // Sp. Def 100 with the Defense +2
      expect(karp.getEffectiveStat(Stat.SPDEF)).toBe(400);
      // The summary's plain stats are untouched
      expect(karp.getStat(Stat.DEF)).toBe(400);
      expect(karp.getStat(Stat.SPDEF)).toBe(100);
      // Speed and the attacking stats are not part of it
      expect(karp.getEffectiveStat(Stat.ATK)).toBe(karp.getStat(Stat.ATK));
    });

    it("applies to the damage of physical moves and Psyshock", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const feebas = game.field.getPlayerPokemon();
      const karp = game.field.getEnemyPokemon();
      const damage = (moveId: MoveId) =>
        karp.getAttackDamage({ source: feebas, move: allMoves[moveId], simulated: true }).damage;

      karp.setStat(Stat.DEF, 400);
      karp.setStat(Stat.SPDEF, 100);
      const tackleNoRoom = damage(MoveId.TACKLE);
      const psyshockNoRoom = damage(MoveId.PSYSHOCK);

      game.scene.arena.addTag(ArenaTagType.WONDER_ROOM, 5, MoveId.WONDER_ROOM, feebas.id);
      const tackleRoom = damage(MoveId.TACKLE);
      const psyshockRoom = damage(MoveId.PSYSHOCK);
      expect(tackleRoom).toBeGreaterThan(tackleNoRoom);
      expect(psyshockRoom).toBeGreaterThan(psyshockNoRoom);

      // The same numbers as a target whose plain Defense and Sp. Def really are the other way round
      game.scene.arena.removeTagOnSide(ArenaTagType.WONDER_ROOM, ArenaTagSide.BOTH);
      expect(game).not.toHaveArenaTag(ArenaTagType.WONDER_ROOM);
      karp.setStat(Stat.DEF, 100);
      karp.setStat(Stat.SPDEF, 400);
      expect(damage(MoveId.TACKLE)).toBe(tackleRoom);
      expect(damage(MoveId.PSYSHOCK)).toBe(psyshockRoom);
    });

    it("gets the enemy AI's neutral score, as Trick Room does", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const feebas = game.field.getPlayerPokemon();
      const karp = game.field.getEnemyPokemon();
      const wonderRoom = allMoves[MoveId.WONDER_ROOM];
      const trickRoom = allMoves[MoveId.TRICK_ROOM];

      expect(wonderRoom.applyConditions(karp, feebas, -1)).toBe(true);
      expect(wonderRoom.getUserBenefitScore(karp, feebas, wonderRoom)).toBe(
        trickRoom.getUserBenefitScore(karp, feebas, trickRoom),
      );
      expect(wonderRoom.getTargetBenefitScore(karp, feebas, wonderRoom)).toBe(
        trickRoom.getTargetBenefitScore(karp, feebas, trickRoom),
      );
    });
  });

  describe("Recycle", () => {
    const berriesOf = (pokemon: Pokemon) =>
      game.scene
        .getModifiers(BerryModifier, pokemon.isPlayer())
        .filter(b => b.pokemonId === pokemon.id)
        .map(b => ({ type: b.berryType, count: b.getStackCount() }));

    it("gives back a berry eaten this battle, once", async () => {
      game.override
        .startingHeldItems([{ name: "BERRY", type: BerryType.LUM, count: 1 }])
        .statusActivation(false)
        .enemyMoveset([MoveId.SPLASH, MoveId.NUZZLE]);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const feebas = game.field.getPlayerPokemon();

      // The Lum Berry is eaten against Nuzzle's paralysis
      game.move.select(MoveId.SPLASH);
      await game.move.selectEnemyMove(MoveId.NUZZLE);
      await game.toNextTurn();
      expect(berriesOf(feebas)).toEqual([]);
      expect(feebas.battleData.berriesEaten).toEqual([BerryType.LUM]);

      game.move.select(MoveId.RECYCLE);
      await game.move.selectEnemyMove(MoveId.SPLASH);
      await game.toNextTurn();

      expect(feebas).toHaveUsedMove({ move: MoveId.RECYCLE, result: MoveResult.SUCCESS });
      expect(berriesOf(feebas)).toEqual([{ type: BerryType.LUM, count: 1 }]);
      expect(feebas.battleData.berriesEaten).toEqual([]);
      expect(game).toHaveShownMessage(
        i18next.t("moveTriggers:recycledItem", {
          pokemonName: getPokemonNameWithAffix(feebas),
          itemName: new BerryModifierType(BerryType.LUM).name,
        }),
      );

      // Nothing left to give back: it fails
      game.move.select(MoveId.RECYCLE);
      await game.move.selectEnemyMove(MoveId.SPLASH);
      await game.toNextTurn();
      expect(feebas).toHaveUsedMove({ move: MoveId.RECYCLE, result: MoveResult.FAIL });
      expect(berriesOf(feebas)).toEqual([{ type: BerryType.LUM, count: 1 }]);
    });

    it("gives back the last eaten berry first, passing over one at its cap", async () => {
      game.override.startingHeldItems([{ name: "BERRY", type: BerryType.SITRUS, count: 2 }]);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const feebas = game.field.getPlayerPokemon();
      feebas.battleData.berriesEaten = [BerryType.LUM, BerryType.LEPPA, BerryType.SITRUS];

      // Sitrus (eaten last) is at its cap of 2: Leppa, eaten before it, comes back
      game.move.select(MoveId.RECYCLE);
      await game.toNextTurn();
      expect(berriesOf(feebas)).toEqual(
        expect.arrayContaining([
          { type: BerryType.SITRUS, count: 2 },
          { type: BerryType.LEPPA, count: 1 },
        ]),
      );
      expect(feebas.battleData.berriesEaten).toEqual([BerryType.LUM, BerryType.SITRUS]);
    });

    it("fails with nothing eaten, and the enemy AI scores it by that", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const feebas = game.field.getPlayerPokemon();
      const karp = game.field.getEnemyPokemon();
      const recycle = allMoves[MoveId.RECYCLE];

      expect(recycle.applyConditions(karp, feebas, -1)).toBe(false); // the AI's -20

      game.move.select(MoveId.RECYCLE);
      await game.toNextTurn();
      expect(feebas).toHaveUsedMove({ move: MoveId.RECYCLE, result: MoveResult.FAIL });
      expect(berriesOf(feebas)).toEqual([]);

      karp.battleData.berriesEaten = [BerryType.SITRUS];
      expect(recycle.applyConditions(karp, feebas, -1)).toBe(true);
      expect(recycle.getUserBenefitScore(karp, feebas, recycle)).toBeGreaterThan(0);
    });

    it("works for an enemy too", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const karp = game.field.getEnemyPokemon();
      karp.battleData.berriesEaten = [BerryType.SITRUS];

      game.move.select(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.RECYCLE);
      await game.toNextTurn();

      expect(karp).toHaveUsedMove({ move: MoveId.RECYCLE, result: MoveResult.SUCCESS });
      expect(berriesOf(karp)).toEqual([{ type: BerryType.SITRUS, count: 1 }]);
      expect(karp.battleData.berriesEaten).toEqual([]);
    });
  });

  describe("Corrosive Gas", () => {
    const transferableCount = (pokemon: Pokemon) =>
      pokemon
        .getHeldItems()
        .filter((i: PokemonHeldItemModifier) => i.isTransferable)
        .reduce((sum, i) => sum + i.getStackCount(), 0);

    it("takes one held item from the enemy, with its message", async () => {
      game.override.enemyHeldItems([{ name: "LEFTOVERS", count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const feebas = game.field.getPlayerPokemon();
      const karp = game.field.getEnemyPokemon();
      const leftovers = karp.getHeldItems().find(i => i.isTransferable)!;
      const itemName = leftovers.type.name;
      expect(transferableCount(karp)).toBe(1);

      game.move.select(MoveId.CORROSIVE_GAS);
      await game.toNextTurn();

      expect(feebas).toHaveUsedMove({ move: MoveId.CORROSIVE_GAS, result: MoveResult.SUCCESS });
      expect(transferableCount(karp)).toBe(0);
      expect(game).toHaveShownMessage(
        i18next.t("moveTriggers:corrosiveGasItem", {
          pokemonName: getPokemonNameWithAffix(feebas),
          targetName: getPokemonNameWithAffix(karp),
          itemName,
        }),
      );
    });

    it("never takes the player's items, as Knock Off: an enemy's gas fails", async () => {
      game.override.startingHeldItems([{ name: "LEFTOVERS", count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const feebas = game.field.getPlayerPokemon();
      const karp = game.field.getEnemyPokemon();

      game.move.select(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.CORROSIVE_GAS);
      await game.toNextTurn();

      expect(karp).toHaveUsedMove({ move: MoveId.CORROSIVE_GAS, result: MoveResult.FAIL });
      expect(transferableCount(feebas)).toBe(1);
    });

    it("is stopped by Sticky Hold", async () => {
      game.override.enemyHeldItems([{ name: "LEFTOVERS", count: 1 }]).enemyAbility(AbilityId.STICKY_HOLD);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const karp = game.field.getEnemyPokemon();

      game.move.select(MoveId.CORROSIVE_GAS);
      await game.toNextTurn();

      expect(transferableCount(karp)).toBe(1);
    });

    it("fails when nobody around holds an item", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const feebas = game.field.getPlayerPokemon();

      game.move.select(MoveId.CORROSIVE_GAS);
      await game.toNextTurn();

      expect(feebas).toHaveUsedMove({ move: MoveId.CORROSIVE_GAS, result: MoveResult.FAIL });
    });

    it("in doubles reaches both enemies but not the player's partner", async () => {
      game.override
        .battleStyle("double")
        .startingHeldItems([{ name: "LEFTOVERS", count: 1 }])
        .enemyHeldItems([{ name: "LEFTOVERS", count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MILOTIC);
      // Only the first party member gets the override's item: Milotic uses the gas next to its Feebas partner
      const [feebas, milotic] = game.scene.getPlayerField();
      const enemies = game.scene.getEnemyField();
      expect(enemies.map(transferableCount)).toEqual([1, 1]);
      expect(transferableCount(feebas)).toBe(1);

      game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER);
      game.move.select(MoveId.CORROSIVE_GAS, BattlerIndex.PLAYER_2);
      await game.toNextTurn();

      expect(milotic).toHaveUsedMove({ move: MoveId.CORROSIVE_GAS, result: MoveResult.SUCCESS });
      expect(enemies.map(transferableCount)).toEqual([0, 0]);
      expect(transferableCount(feebas)).toBe(1);
    });

    it("gets -20 from the enemy AI against the player's party, and a positive score from the player's side", async () => {
      game.override
        .startingHeldItems([{ name: "LEFTOVERS", count: 1 }])
        .enemyHeldItems([{ name: "LEFTOVERS", count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const feebas = game.field.getPlayerPokemon();
      const karp = game.field.getEnemyPokemon();
      const gas = allMoves[MoveId.CORROSIVE_GAS];

      // An enemy user: nothing of the player's can be taken
      expect(gas.getUserBenefitScore(karp, feebas, gas) + gas.getTargetBenefitScore(karp, feebas, gas) * -1).toBe(-20);
      // A player user against an enemy holding an item (the AI's sign for an opposing target)
      expect(gas.getUserBenefitScore(feebas, karp, gas) - gas.getTargetBenefitScore(feebas, karp, gas)).toBe(5);
    });

    it("stays out of enemy movesets (wild or trainer), as while it was unimplemented, but not out of the player's", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const feebas = game.field.getPlayerPokemon();
      const karp = game.field.getEnemyPokemon();
      const { filterMovePool } = __INTERNAL_TEST_EXPORTS;
      const pool = () =>
        new Map<MoveId, number>([
          [MoveId.CORROSIVE_GAS, 10],
          [MoveId.WONDER_ROOM, 10],
          [MoveId.RECYCLE, 10],
          [MoveId.TACKLE, 10],
        ]);

      for (const hasTrainer of [false, true]) {
        const enemyPool = pool();
        filterMovePool(enemyPool, false, hasTrainer, karp, false);
        expect(enemyPool.has(MoveId.CORROSIVE_GAS)).toBe(false);
        expect(enemyPool.has(MoveId.WONDER_ROOM)).toBe(true);
        expect(enemyPool.has(MoveId.RECYCLE)).toBe(true);
      }
      const playerPool = pool();
      filterMovePool(playerPool, false, false, feebas, false);
      expect(playerPool.has(MoveId.CORROSIVE_GAS)).toBe(true);
    });
  });
});
