import { allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { getCustomModifierClass, LifeOrbModifier } from "#modifiers/custom-held-items";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import { toDmgValue } from "#utils/common";
import { getModifierPoolForType } from "#utils/modifier-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Custom held items - Life Orb (생명의구슬)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    // Snorlax (speed 30) always moves before Shuckle (speed 5), which only uses Splash
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.SHUCKLE)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.TACKLE, MoveId.SPLASH, MoveId.SOLAR_BEAM]);
  });

  /** A fresh orb for `pokemon`, with its type id set the way `overrideHeldItems` and the reward pools do. */
  function newOrb(pokemon: Pokemon): PokemonHeldItemModifier {
    return modifierTypes
      .LIFE_ORB()
      .withIdFromFunc(modifierTypes.LIFE_ORB)
      .newModifier(pokemon) as PokemonHeldItemModifier;
  }

  function orbOf(pokemon: Pokemon): LifeOrbModifier | undefined {
    return pokemon.getHeldItems().find(m => m instanceof LifeOrbModifier);
  }

  it("adds 30% damage per orb (x1.3 / x1.6 / x1.9) and stacks up to 3", async () => {
    game.override.enemySpecies(SpeciesId.BLISSEY);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const snorlax = game.field.getPlayerPokemon();
    const blissey = game.field.getEnemyPokemon();
    const hit = () =>
      blissey.getAttackDamage({ source: snorlax, move: allMoves[MoveId.TACKLE], simulated: true }).damage;

    const base = hit();
    expect(base).toBeGreaterThan(20);
    for (const [stacks, mult] of [
      [1, 1.3],
      [2, 1.6],
      [3, 1.9],
    ] as const) {
      game.scene.addModifier(newOrb(snorlax), true);
      const orb = orbOf(snorlax)!;
      expect(orb.stackCount).toBe(stacks);
      expect(orb.getDamageMultiplier()).toBeCloseTo(mult, 10);
      expect(hit()).toBe(toDmgValue(base * orb.getDamageMultiplier()));
    }

    // a fourth one is refused
    game.scene.addModifier(newOrb(snorlax), true);
    expect(orbOf(snorlax)!.stackCount).toBe(3);
    expect(orbOf(snorlax)!.getMaxHeldItemCount(snorlax)).toBe(3);
  });

  it.each([
    { count: 1, ratio: 0.1 },
    { count: 2, ratio: 0.15 },
    { count: 3, ratio: 0.2 },
  ])("costs $ratio of max HP at the end of a turn with an attacking move ($count orbs)", async ({ count, ratio }) => {
    game.override.startingHeldItems([{ name: "LIFE_ORB", count }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const snorlax = game.field.getPlayerPokemon();
    expect(orbOf(snorlax)!.stackCount).toBe(count);

    game.move.select(MoveId.TACKLE);
    await game.toNextTurn();

    expect(game.field.getEnemyPokemon().hp).toBeLessThan(game.field.getEnemyPokemon().getMaxHp());
    expect(snorlax.getMaxHp() - snorlax.hp).toBe(toDmgValue(snorlax.getMaxHp() * ratio));
  });

  it("costs its HP before Leftovers, so Leftovers heals the same turn even from full HP", async () => {
    game.override.startingHeldItems([{ name: "LIFE_ORB" }, { name: "LEFTOVERS" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const snorlax = game.field.getPlayerPokemon();
    expect(snorlax.isFullHp()).toBe(true);

    game.move.select(MoveId.TACKLE);
    await game.toNextTurn();

    const max = snorlax.getMaxHp();
    expect(max - snorlax.hp).toBe(toDmgValue(max * 0.1) - toDmgValue(max / 16));
  });

  it("costs nothing on a turn with only a status move", async () => {
    game.override.startingHeldItems([{ name: "LIFE_ORB", count: 3 }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const snorlax = game.field.getPlayerPokemon();

    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();

    expect(snorlax.isFullHp()).toBe(true);
  });

  it("costs HP after a missed attack too (the move was used)", async () => {
    game.override.startingHeldItems([{ name: "LIFE_ORB" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const snorlax = game.field.getPlayerPokemon();

    game.move.select(MoveId.TACKLE);
    await game.move.forceMiss();
    await game.toNextTurn();

    expect(game.field.getEnemyPokemon().isFullHp()).toBe(true);
    expect(snorlax.getMaxHp() - snorlax.hp).toBe(toDmgValue(snorlax.getMaxHp() * 0.1));
  });

  it("costs nothing on the charging turn of a two-turn move, only on the turn it hits", async () => {
    game.override.startingHeldItems([{ name: "LIFE_ORB" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const snorlax = game.field.getPlayerPokemon();

    game.move.select(MoveId.SOLAR_BEAM);
    await game.toNextTurn();
    expect(snorlax.isFullHp()).toBe(true);

    await game.toNextTurn();
    expect(snorlax.getMaxHp() - snorlax.hp).toBe(toDmgValue(snorlax.getMaxHp() * 0.1));
  });

  it("is blocked by Magic Guard, which keeps the damage boost", async () => {
    game.override.ability(AbilityId.MAGIC_GUARD).startingHeldItems([{ name: "LIFE_ORB" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const snorlax = game.field.getPlayerPokemon();

    game.move.select(MoveId.TACKLE);
    await game.toNextTurn();

    expect(snorlax.isFullHp()).toBe(true);
    expect(orbOf(snorlax)!.getDamageMultiplier()).toBeCloseTo(1.3, 10);
  });

  it("works for an enemy holder", async () => {
    game.override.enemyHeldItems([{ name: "LIFE_ORB", count: 2 }]).enemyMoveset(MoveId.TACKLE);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const shuckle = game.field.getEnemyPokemon();

    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();

    expect(shuckle.getMaxHp() - shuckle.hp).toBe(toDmgValue(shuckle.getMaxHp() * 0.15));
  });

  it("is restored from a session save by class name", () => {
    expect(getCustomModifierClass("LifeOrbModifier")).toBe(LifeOrbModifier);
  });

  it("sits in the ROGUE tier of the player pool at weight 4 until one party member holds 3", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);
    const party = game.scene.getPlayerParty();
    const rogue = getModifierPoolForType(ModifierPoolType.PLAYER)[ModifierTier.ROGUE];
    const entry = rogue.find(w => w.modifierType.id === "LIFE_ORB")!;
    expect(entry).toBeDefined();
    expect(entry.modifierType.tier).toBe(ModifierTier.ROGUE);
    expect(entry.maxWeight).toBe(4);
    const weight = entry.weight as WeightedModifierTypeWeightFunc;

    expect(weight(party, 0)).toBe(4);
    for (let i = 0; i < 2; i++) {
      game.scene.addModifier(newOrb(party[0]), true);
    }
    expect(weight(party, 0)).toBe(4);
    game.scene.addModifier(newOrb(party[0]), true);
    expect(orbOf(party[0])!.stackCount).toBe(3);
    // Since 2026-11-06 one full holder is enough, though Feebas has none
    expect(orbOf(party[1])).toBeUndefined();
    expect(weight(party, 0)).toBe(0);
  });
});
