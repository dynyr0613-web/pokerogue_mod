import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { LIFE_ORB_MIN_HP_LEFT, LifeOrbModifier } from "#modifiers/custom-held-items";
import { GameManager } from "#test/framework/game-manager";
import { toDmgValue } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Local fork (2026-11-13): 08 명세 2번, "생명의구슬 반동 대미지 HP 1 하한 보장". The Life Orb's turn-end cost (10/15/20% of
 * max HP for 1/2/3 orbs) never takes its holder below 1 HP, for the player's and the enemy's holders alike. Before, a
 * Pokémon left at 1 HP by Sturdy or a Focus Band fainted to it before Leftovers healed (and an indirect faint never
 * triggers the Reviver Seed).
 */
describe("Custom - Life Orb cost leaves at least 1 HP (08 명세 2번)", () => {
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
      .enemyHasPassiveAbility(false)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .hasPassiveAbility(false)
      .moveset([MoveId.TACKLE, MoveId.SPLASH]);
  });

  function orbCost(pokemon: Pokemon, ratio: number): number {
    return toDmgValue(pokemon.getMaxHp() * ratio);
  }

  it("keeps 1 HP as the floor", () => {
    expect(LIFE_ORB_MIN_HP_LEFT).toBe(1);
  });

  it("costs nothing to a holder at 1 HP, which keeps attacking", async () => {
    game.override.startingHeldItems([{ name: "LIFE_ORB", count: 3 }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const snorlax = game.field.getPlayerPokemon();
    snorlax.hp = 1;

    game.move.select(MoveId.TACKLE);
    await game.toNextTurn();

    expect(game.field.getEnemyPokemon().isFullHp()).toBe(false);
    expect(snorlax.isFainted()).toBe(false);
    expect(snorlax.hp).toBe(1);
    // the damage boost is still there
    expect(
      snorlax
        .getHeldItems()
        .find(m => m instanceof LifeOrbModifier)!
        .getDamageMultiplier(),
    ).toBeCloseTo(1.9, 10);

    game.move.select(MoveId.TACKLE);
    await game.toNextTurn();
    expect(snorlax.hp).toBe(1);
  });

  it.each([
    { count: 1, ratio: 0.1 },
    { count: 2, ratio: 0.15 },
    { count: 3, ratio: 0.2 },
  ])(
    "cuts the cost ($ratio of max HP, $count orbs) to leave 1 HP; the full cost is paid when it leaves 1 or more",
    async ({ count, ratio }) => {
      game.override.startingHeldItems([{ name: "LIFE_ORB", count }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();
      const cost = orbCost(snorlax, ratio);
      expect(cost).toBeGreaterThan(2);

      // exactly the cost: one short of a faint, so 1 HP is left
      snorlax.hp = cost;
      game.move.select(MoveId.TACKLE);
      await game.toNextTurn();
      expect(snorlax.hp).toBe(1);

      // the cost plus one: paid in full, 1 HP left as before
      snorlax.hp = cost + 1;
      game.move.select(MoveId.TACKLE);
      await game.toNextTurn();
      expect(snorlax.hp).toBe(1);

      // well above the cost: unchanged
      snorlax.hp = cost + 10;
      game.move.select(MoveId.TACKLE);
      await game.toNextTurn();
      expect(snorlax.hp).toBe(10);
    },
  );

  it("works the same for an enemy holder", async () => {
    game.override.enemyHeldItems([{ name: "LIFE_ORB", count: 3 }]).enemyMoveset(MoveId.TACKLE);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const shuckle = game.field.getEnemyPokemon();
    shuckle.hp = 2;

    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();

    expect(game.field.getPlayerPokemon().isFullHp()).toBe(false);
    expect(shuckle.isFainted()).toBe(false);
    expect(shuckle.hp).toBe(1);
  });

  it("a holder Sturdy left at 1 HP survives its own attack's Life Orb cost (the 5850 Focus Band case)", async () => {
    // A level 5 Snorlax with Sturdy is knocked to 1 HP by a level 100 Mewtwo first, then attacks
    game.override
      .startingLevel(5)
      .ability(AbilityId.STURDY)
      .startingHeldItems([{ name: "LIFE_ORB", count: 3 }])
      .enemySpecies(SpeciesId.MEWTWO)
      .enemyMoveset(MoveId.TACKLE);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const snorlax = game.field.getPlayerPokemon();

    game.move.select(MoveId.TACKLE);
    await game.toNextTurn();

    // Snorlax's own Tackle landed after Sturdy kept it at 1 HP
    expect(game.field.getEnemyPokemon().isFullHp()).toBe(false);
    expect(snorlax.isFainted()).toBe(false);
    expect(snorlax.hp).toBe(1);
  });

  it("Leftovers still heals afterwards (the cost is skipped at 1 HP, the heal is not)", async () => {
    game.override.startingHeldItems([{ name: "LIFE_ORB", count: 3 }, { name: "LEFTOVERS" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const snorlax = game.field.getPlayerPokemon();
    snorlax.hp = 1;

    game.move.select(MoveId.TACKLE);
    await game.toNextTurn();

    expect(snorlax.hp).toBe(1 + toDmgValue(snorlax.getMaxHp() / 16));
  });
});
