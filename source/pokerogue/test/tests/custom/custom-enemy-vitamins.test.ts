import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { ENEMY_VITAMINS, getEnemyVitaminStack, sizeEnemyVitamin } from "#modifiers/enemy-custom-items";
import { BaseStatModifier, type PokemonHeldItemModifier } from "#modifiers/modifier";
import type { ModifierTypeGenerator } from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Local fork (2026-11-11): an enemy's vitamin (영양제) roll gives several at once (the user: "적이 지니는 영양제 개수도
 * 대폭 버프하죠"): 3, one more every 100 difficulty waves, capped by the stat's IV.
 */
describe("Custom - enemy vitamins come several at a time", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  const newVitamin = (pokemon: Pokemon, stat: Stat) => {
    const gen = modifierTypes.BASE_STAT_BOOSTER() as ModifierTypeGenerator;
    gen.id = "BASE_STAT_BOOSTER";
    return gen.generateType([], [stat])!.newModifier(pokemon) as PokemonHeldItemModifier;
  };

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH]);
  });

  it("gives 3, one more every 100 waves", () => {
    expect(ENEMY_VITAMINS).toEqual({ baseStack: 3, extraEveryWaves: 100 });
    expect([1, 50, 99, 100, 199, 200, 500, 1000, 5000].map(getEnemyVitaminStack)).toEqual([
      3, 3, 3, 4, 4, 5, 8, 13, 53,
    ]);
  });

  it("sizes a rolled vitamin, keeping the holder within the stat's IV", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const enemy = game.field.getEnemyPokemon();
    enemy.ivs[Stat.ATK] = 7;
    enemy.ivs[Stat.SPD] = 31;
    const list = game.scene["enemyModifiers"];

    const first = newVitamin(enemy, Stat.ATK);
    expect(first).toBeInstanceOf(BaseStatModifier);
    expect(sizeEnemyVitamin(first, list, 250)).toBe(true);
    expect(first.stackCount).toBe(5);
    expect(first.add(list, false)).toBe(true);

    const second = newVitamin(enemy, Stat.ATK);
    expect(sizeEnemyVitamin(second, list, 250)).toBe(true);
    expect(second.stackCount).toBe(2); // 7 - 5
    expect(second.add(list, false)).toBe(true);
    expect(enemy.getHeldItems().find(m => m.matchType(first))!.stackCount).toBe(7);

    const third = newVitamin(enemy, Stat.ATK);
    expect(sizeEnemyVitamin(third, list, 250)).toBe(false);

    // another stat has its own room
    const speed = newVitamin(enemy, Stat.SPD);
    expect(sizeEnemyVitamin(speed, list, 1000)).toBe(true);
    expect(speed.stackCount).toBe(13);
  });
});
