import { allAbilities } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { ENEMY_CUSTOM_PASSIVE_ODDS, enemyRollsCustomPassive } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/** The first id at or after `start` whose roll is `wanted` */
function idWithRoll(wanted: boolean, start = 1): number {
  let id = start;
  while (enemyRollsCustomPassive(id) !== wanted) {
    id++;
  }
  return id;
}

/**
 * Enemies use our table's passive 1 time in 8 (the user's request, 2026-11-05); it only matters while the enemy
 * has a passive (bosses, some encounters).
 */
describe("Custom - enemies use our passive 1 time in 8", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.GARCHOMP)
      .enemyMoveset(MoveId.SPLASH)
      .enemyHasPassiveAbility(true)
      .moveset(MoveId.SPLASH);
  });

  it("rolls about 1 in 8 over many ids", () => {
    expect(ENEMY_CUSTOM_PASSIVE_ODDS).toBe(8);
    let hits = 0;
    const n = 80000;
    for (let i = 0; i < n; i++) {
      // spread the sample over the whole 32-bit range like randSeedInt(2^32) ids
      if (enemyRollsCustomPassive((i * 53687) >>> 0)) {
        hits++;
      }
    }
    expect(hits / n).toBeGreaterThan(0.115);
    expect(hits / n).toBeLessThan(0.135);
  });

  it("gives a Garchomp with a passive our one (Moxie) when its id rolls, else the base one", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const garchomp = game.field.getEnemyPokemon();
    expect(garchomp.hasPassive()).toBe(true);
    const base = garchomp.species.getPassiveAbility(garchomp.formIndex);
    expect(base).not.toBe(AbilityId.MOXIE);

    garchomp.id = idWithRoll(true);
    expect(garchomp.usesCustomPassive()).toBe(true);
    expect(garchomp.getPassiveAbility()).toBe(allAbilities[AbilityId.MOXIE]);

    garchomp.id = idWithRoll(false);
    expect(garchomp.usesCustomPassive()).toBe(false);
    expect(garchomp.getPassiveAbility()).toBe(allAbilities[base]);
  });

  it("keeps the answer through a session save, since the id is saved", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const garchomp = game.field.getEnemyPokemon();
    garchomp.id = idWithRoll(true, 1000);

    const { gameData } = game.scene;
    const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
    const saved = gameData.parseSessionData(json).enemyParty[0];
    expect(saved.id).toBe(garchomp.id);
    expect(enemyRollsCustomPassive(saved.id)).toBe(true);
  });

  it("leaves the player's Pokemon on their own per-species choice", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const player = game.field.getPlayerPokemon();
    player.id = idWithRoll(true);
    player.customPassiveSpecies = [];
    expect(player.usesCustomPassive()).toBe(false);
    player.customPassiveSpecies = [SpeciesId.GARCHOMP];
    expect(player.usesCustomPassive()).toBe(true);
  });
});
