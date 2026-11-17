import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { isOrbVesselItem } from "#modifiers/custom-held-items";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Local fork (2026-11-11): the player's steals (Grip Claw, Pickup, Thief, Covet, Magician, Pickpocket, Mini Black Hole;
 * all go through `BattleScene.canTakeHeldItem`) skip an orb vessel pair that anyone in the party already holds, before
 * or after it is filled. The user: "불꽃화로를 멜메탈이 지니고있는데 지그제구리가 픽업으로 주웠어요, 맹독증류기가 있는데 픽업으로
 * 맹독증류액도 주웠네요 … 합체형 아이템의 합체 전 / 후 아이템이 있을 경우 적에게서 합체 전/후 아이템을 못훔치게".
 */
describe("Custom held items - orb vessel pairs and the player's steals", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  type Name =
    | "FLAME_CAULDRON"
    | "FLAME_FURNACE"
    | "TOXIC_DISTILLER"
    | "TOXIC_DISTILLATE"
    | "DISCHARGED_COIL"
    | "SUPERCONDUCTING_COIL";
  const newItem = (name: Name, pokemon: Pokemon) =>
    modifierTypes[name]().withIdFromFunc(modifierTypes[name]).newModifier(pokemon) as PokemonHeldItemModifier;
  const give = (name: Name, pokemon: Pokemon) => {
    const item = newItem(name, pokemon);
    if (pokemon.isPlayer()) {
      game.scene.addModifier(item, true, false, false, true);
    } else {
      game.scene.addEnemyModifier(item, true);
    }
    return pokemon.getHeldItems().find(m => m.type.id === name)!;
  };

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(5)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH]);
  });

  it("knows the six vessel items and nothing else", () => {
    const pokemonId = 1;
    for (const name of [
      "FLAME_CAULDRON",
      "FLAME_FURNACE",
      "TOXIC_DISTILLER",
      "TOXIC_DISTILLATE",
      "DISCHARGED_COIL",
      "SUPERCONDUCTING_COIL",
    ] as const) {
      const item = modifierTypes[name]().withIdFromFunc(modifierTypes[name]).newModifier({ id: pokemonId } as Pokemon);
      expect(isOrbVesselItem(item!), name).toBe(true);
    }
    const leftovers = modifierTypes
      .LEFTOVERS()
      .withIdFromFunc(modifierTypes.LEFTOVERS)
      .newModifier({ id: pokemonId } as Pokemon);
    expect(isOrbVesselItem(leftovers!)).toBe(false);
  });

  it("a party member's Flame Furnace keeps another member from taking a furnace or a cauldron; other pairs stay free", async () => {
    await game.classicMode.startBattle(SpeciesId.MELMETAL, SpeciesId.ZIGZAGOON);
    const [melmetal, zigzagoon] = game.scene.getPlayerParty();
    const enemy = game.field.getEnemyPokemon();

    const enemyFurnace = give("FLAME_FURNACE", enemy);
    const enemyDistillate = give("TOXIC_DISTILLATE", enemy);
    const enemyCoil = give("SUPERCONDUCTING_COIL", enemy);
    // nobody holds a vessel yet: all can be taken
    expect(game.scene.canTakeHeldItem(enemyFurnace, zigzagoon)).toBe(true);
    expect(game.scene.canTakeHeldItem(enemyDistillate, zigzagoon)).toBe(true);
    expect(game.scene.canTakeHeldItem(enemyCoil, zigzagoon)).toBe(true);

    give("FLAME_FURNACE", melmetal);
    expect(game.scene.canTakeHeldItem(enemyFurnace, zigzagoon)).toBe(false);
    expect(game.scene.canTakeHeldItem(enemyFurnace, melmetal)).toBe(false);
    expect(game.scene.canTakeHeldItem(enemyDistillate, zigzagoon)).toBe(true);
    expect(game.scene.canTakeHeldItem(enemyCoil, zigzagoon)).toBe(true);
    // a transfer that is not a steal (the player's own items) is untouched by this rule
    expect(game.scene.hasRoomForHeldItem(enemyFurnace, zigzagoon)).toBe(true);
  });

  it("an unfilled vessel in the party blocks its filled form, and the filled form blocks the vessel", async () => {
    await game.classicMode.startBattle(SpeciesId.MELMETAL, SpeciesId.ZIGZAGOON);
    const [melmetal, zigzagoon] = game.scene.getPlayerParty();
    const enemy = game.field.getEnemyPokemon();

    give("TOXIC_DISTILLER", melmetal);
    const enemyDistillate = give("TOXIC_DISTILLATE", enemy);
    expect(game.scene.canTakeHeldItem(enemyDistillate, zigzagoon)).toBe(false);

    give("SUPERCONDUCTING_COIL", melmetal);
    const enemyCoil = give("DISCHARGED_COIL", enemy);
    expect(game.scene.canTakeHeldItem(enemyCoil, zigzagoon)).toBe(false);

    const enemyCauldron = give("FLAME_CAULDRON", enemy);
    expect(game.scene.canTakeHeldItem(enemyCauldron, zigzagoon)).toBe(true);
  });

  it("enemy thieves are not limited by it", async () => {
    await game.classicMode.startBattle(SpeciesId.MELMETAL, SpeciesId.ZIGZAGOON);
    const [melmetal] = game.scene.getPlayerParty();
    const enemy = game.field.getEnemyPokemon();
    const furnace = give("FLAME_FURNACE", melmetal);
    give("FLAME_CAULDRON", game.scene.getPlayerParty()[1]);
    expect(game.scene.canTakeHeldItem(furnace, enemy)).toBe(true);
  });
});
