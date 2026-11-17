import { PLAYER_HELD_ITEM_CAPS } from "#balance/endless-balance";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Items - Multi Lens", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .moveset([MoveId.TACKLE, MoveId.TRAILBLAZE, MoveId.TACHYON_CUTTER, MoveId.FUTURE_SIGHT])
      .ability(AbilityId.BALL_FETCH)
      .passiveAbility(AbilityId.NO_GUARD)
      .startingHeldItems([{ name: "MULTI_LENS" }])
      .battleStyle("single")
      .criticalHits(false)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(99) // Check for proper rounding on Seismic Toss damage reduction
      .enemyLevel(99);
  });

  it.each([
    { stackCount: 1, firstHitDamage: 0.75 },
    // Fork (2026-11-05): the first hit stays at 0.75x however many lenses; Local fork (2026-11-13): 10 명세 1번, up to
    // 3 on the player's Pokemon (75/25/25/25, x1.50 in all; 4 until then)
    { stackCount: 2, firstHitDamage: 0.75 },
    { stackCount: PLAYER_HELD_ITEM_CAPS.MULTI_LENS, firstHitDamage: 0.75 },
  ])(
    "$stackCount count: should deal {$firstHitDamage}x damage on the first hit, then hit $stackCount times for 0.25x",
    async ({ stackCount, firstHitDamage }) => {
      game.override.startingHeldItems([{ name: "MULTI_LENS", count: stackCount }]);

      await game.classicMode.startBattle(SpeciesId.MAGIKARP);

      const enemyPokemon = game.field.getEnemyPokemon();
      const spy = vi.spyOn(enemyPokemon, "getAttackDamage");
      vi.spyOn(enemyPokemon, "getBaseDamage").mockReturnValue(100);

      game.move.select(MoveId.TACKLE);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);

      await game.phaseInterceptor.to("MoveEndPhase", false);
      const damageResults = spy.mock.results.map(result => result.value?.damage);

      expect(damageResults).toHaveLength(1 + stackCount);
      expect(damageResults[0]).toBe(firstHitDamage * 100);
      damageResults.slice(1).forEach(dmg => expect(dmg).toBe(25));
    },
  );

  it("should stack additively with Parental Bond", async () => {
    game.override.ability(AbilityId.PARENTAL_BOND);

    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const playerPokemon = game.field.getPlayerPokemon();

    game.move.select(MoveId.TACKLE);

    await game.phaseInterceptor.to("MoveEndPhase", false);
    expect(playerPokemon.turnData.hitCount).toBe(3);
  });

  it("should apply secondary effects on each hit", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const playerPokemon = game.field.getPlayerPokemon();

    game.move.select(MoveId.TRAILBLAZE);

    await game.phaseInterceptor.to("BerryPhase", false);
    expect(playerPokemon).toHaveStatStage(Stat.SPD, 2);
  });

  it("should not enhance multi-hit moves", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const playerPokemon = game.field.getPlayerPokemon();

    game.move.select(MoveId.TACHYON_CUTTER);

    await game.phaseInterceptor.to("BerryPhase", false);
    expect(playerPokemon.turnData.hitCount).toBe(2);
  });

  it("should enhance multi-target moves", async () => {
    game.override.battleStyle("double").moveset([MoveId.SWIFT, MoveId.SPLASH]);

    await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.FEEBAS);

    const magikarp = game.field.getPlayerPokemon();

    game.move.select(MoveId.SWIFT, 0);
    game.move.select(MoveId.SPLASH, 1);

    game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.PLAYER_2, BattlerIndex.ENEMY, BattlerIndex.ENEMY_2]);

    await game.phaseInterceptor.to("MoveEndPhase", false);

    expect(magikarp.turnData.hitCount).toBe(2);
  });

  it("should enhance fixed-damage moves while also applying damage reduction", async () => {
    game.override.startingHeldItems([{ name: "MULTI_LENS", count: 1 }]).moveset(MoveId.SEISMIC_TOSS);

    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const playerPokemon = game.field.getPlayerPokemon();
    const enemyPokemon = game.field.getEnemyPokemon();
    const spy = vi.spyOn(enemyPokemon, "getAttackDamage");

    game.move.select(MoveId.SEISMIC_TOSS);
    game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);

    await game.phaseInterceptor.to("MoveEndPhase", false);
    const damageResults = spy.mock.results.map(result => result.value?.damage);

    expect(damageResults).toHaveLength(2);
    expect(damageResults[0]).toBe(Math.floor(playerPokemon.level * 0.75));
    expect(damageResults[1]).toBe(Math.floor(playerPokemon.level * 0.25));
  });

  // Fork (2026-11-05): with the first hit fixed at 0.75x, n lenses deal (0.75 + 0.25n) of the move's damage,
  // so HP-cutting moves cut more than half from 2 lenses on (upstream kept the total at exactly 1x)
  it.each([
    { lensCount: 1, hpLeft: 0.5 },
    { lensCount: 2, hpLeft: 0.375 },
    // Local fork (2026-11-13): 10 명세 1번, the player's cap of 3 lenses: 1 - 0.5 x 1.5
    { lensCount: PLAYER_HELD_ITEM_CAPS.MULTI_LENS, hpLeft: 0.25 },
  ])("should cut (0.75 + 0.25n) of the HP-cutting damage with $lensCount lenses", async ({ lensCount, hpLeft }) => {
    game.override
      .startingHeldItems([{ name: "MULTI_LENS", count: lensCount }])
      .enemyLevel(1000)
      .enemySpecies(SpeciesId.BLISSEY); // allows for unrealistically high levels of accuracy
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const blissey = game.field.getEnemyPokemon();

    game.move.use(MoveId.SUPER_FANG);
    await game.toEndOfTurn();

    // `getHpRatio` rounds to 2 places, so compare the raw ratio
    expect(blissey.hp / blissey.getMaxHp()).toBeCloseTo(hpLeft, 3);
  });

  it("should cut 1.25x with 2 lenses, then Parental Bond halves the rest", async () => {
    game.override
      .startingHeldItems([{ name: "MULTI_LENS", count: 2 }])
      .ability(AbilityId.PARENTAL_BOND)
      .enemyLevel(1000)
      .enemySpecies(SpeciesId.BLISSEY); // allows for unrealistically high levels of accuracy

    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const blissey = game.field.getEnemyPokemon();

    game.move.use(MoveId.SUPER_FANG);
    await game.toEndOfTurn();

    // 1 - 0.5 x (0.75 + 0.25 + 0.25) = 0.375 left, then Parental Bond's strike halves it
    expect(blissey.hp / blissey.getMaxHp()).toBeCloseTo(0.1875, 3);
  });

  // Local fork (2026-11-13): 10 명세 1번 — the player's cap fell from 4 to 3; a 4th lens (an older stack) does not strike,
  // and Super Fang still finds Parental Bond's strike right after the 3 lens strikes
  it("should cut like 3 lenses with an older stack of 4, then Parental Bond halves the rest", async () => {
    game.override
      .startingHeldItems([{ name: "MULTI_LENS", count: 4 }])
      .ability(AbilityId.PARENTAL_BOND)
      .enemyLevel(1000)
      .enemySpecies(SpeciesId.BLISSEY); // allows for unrealistically high levels of accuracy

    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const feebas = game.field.getPlayerPokemon();
    const blissey = game.field.getEnemyPokemon();

    game.move.use(MoveId.SUPER_FANG);
    await game.toEndOfTurn();

    // 1 + 3 lenses + Parental Bond; 1 - 0.5 x (0.75 + 0.25 x 3) = 0.25 left, then Parental Bond's strike halves it
    expect(feebas.turnData.hitCount).toBe(1 + PLAYER_HELD_ITEM_CAPS.MULTI_LENS + 1);
    expect(blissey.hp / blissey.getMaxHp()).toBeCloseTo(0.125, 3);
  });

  it("should not allow Future Sight to hit infinitely many times if the user switches out", async () => {
    game.override.enemyLevel(1000);
    await game.classicMode.startBattle(SpeciesId.BULBASAUR, SpeciesId.CHARMANDER, SpeciesId.SQUIRTLE);

    const enemyPokemon = game.field.getEnemyPokemon();
    vi.spyOn(enemyPokemon, "damageAndUpdate");

    game.move.select(MoveId.FUTURE_SIGHT);
    await game.toNextTurn();

    game.doSwitchPokemon(1);
    await game.toNextTurn();

    game.doSwitchPokemon(2);
    await game.toNextTurn();

    // TODO: Update hit count to 1 once Future Sight is fixed to not activate held items if user is off the field
    expect(enemyPokemon.damageAndUpdate).toHaveBeenCalledTimes(2);
  });
});
