import { allMoves } from "#data/data-lists";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/** The five stats raised by Last Stand and War Machine. */
const FIVE_STATS = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD] as const;

describe("Custom abilities 2", () => {
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
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.RATTATA)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH, MoveId.TACKLE, MoveId.DRAGON_PULSE, MoveId.ICE_BEAM]);
  });

  describe("Golden Pulse", () => {
    beforeEach(() => {
      game.override.ability(AbilityId.GOLDEN_PULSE);
    });

    it("sets Electric Terrain on entry and multiplies Atk by 4/3 while it is up", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const feebas = game.field.getPlayerPokemon();

      expect(game.scene.arena.terrainType).toBe(TerrainType.ELECTRIC);
      expect(feebas).toHaveAbilityApplied(AbilityId.GOLDEN_PULSE);

      const baseAtk = feebas.getStat(Stat.ATK, false);
      expect(feebas.getEffectiveStat(Stat.ATK)).toBe(Math.floor((baseAtk * 4) / 3));
      // only Atk is boosted
      expect(feebas.getEffectiveStat(Stat.SPATK)).toBe(feebas.getStat(Stat.SPATK, false));
    });

    it("gives no Atk boost once the terrain is gone", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const feebas = game.field.getPlayerPokemon();

      const boosted = feebas.getEffectiveStat(Stat.ATK);
      game.scene.arena.trySetTerrain(TerrainType.NONE, true);
      expect(game.scene.arena.terrainType).toBe(TerrainType.NONE);

      const baseAtk = feebas.getStat(Stat.ATK, false);
      expect(feebas.getEffectiveStat(Stat.ATK)).toBe(baseAtk);
      expect(boosted).toBeGreaterThan(baseAtk);
    });
  });

  describe("Last Stand", () => {
    beforeEach(() => {
      game.override.ability(AbilityId.LAST_STAND);
    });

    it("raises Attack, Defense and Sp. Def on entry and traps itself", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
      const feebas = game.field.getPlayerPokemon();

      expect(feebas).toHaveAbilityApplied(AbilityId.LAST_STAND);
      expect(feebas).toHaveStatStage(Stat.ATK, 1);
      expect(feebas).toHaveStatStage(Stat.DEF, 1);
      expect(feebas).toHaveStatStage(Stat.SPDEF, 1);
      expect(feebas).toHaveStatStage(Stat.SPATK, 0);
      expect(feebas).toHaveStatStage(Stat.SPD, 0);
      expect(feebas.isTrapped()).toBe(true);
      expect(feebas.canSwitch()).toBe(false);
    });

    it("traps the opponent like Shadow Tag", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
      expect(game.field.getEnemyPokemon().isTrapped()).toBe(true);
    });

    it("traps a Shadow Tag opponent too, but not one with Run Away", async () => {
      game.override.enemyAbility(AbilityId.SHADOW_TAG);
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
      const enemy = game.field.getEnemyPokemon();
      expect(enemy.isTrapped()).toBe(true);
      game.field.mockAbility(enemy, AbilityId.RUN_AWAY);
      expect(enemy.isTrapped()).toBe(false);
    });

    it("can't select self-switching moves, but can select others", async () => {
      game.override.moveset([MoveId.U_TURN, MoveId.SHED_TAIL, MoveId.BATON_PASS, MoveId.TACKLE]);
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
      const feebas = game.field.getPlayerPokemon();
      for (const move of [MoveId.U_TURN, MoveId.SHED_TAIL, MoveId.BATON_PASS]) {
        const [selectable, msg] = feebas.isMoveSelectable(move);
        expect(selectable).toBe(false);
        expect(msg).toContain("Last Stand");
      }
      expect(feebas.isMoveSelectable(MoveId.TACKLE)[0]).toBe(true);
      expect(feebas.isMoveSelectable(MoveId.ROAR)[0]).toBe(true);
    });

    it("does not trap a Ghost-type opponent", async () => {
      game.override.enemySpecies(SpeciesId.GASTLY);
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
      expect(game.field.getEnemyPokemon().isTrapped()).toBe(false);
    });
  });
  describe("Blade Dance", () => {
    beforeEach(() => {
      game.override.ability(AbilityId.BLADE_DANCE);
    });

    it("raises Atk by 2 on entry and nothing else", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const feebas = game.field.getPlayerPokemon();

      expect(feebas).toHaveAbilityApplied(AbilityId.BLADE_DANCE);
      expect(feebas).toHaveStatStage(Stat.ATK, 2);
      expect(feebas).toHaveStatStage(Stat.DEF, 0);
      expect(feebas).toHaveStatStage(Stat.SPATK, 0);
      expect(feebas).toHaveStatStage(Stat.SPD, 0);
    });

    it("does not trigger again in the same wave, but does again once a new wave has started", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
      const [feebas, magikarp] = game.scene.getPlayerParty();
      expect(feebas).toHaveStatStage(Stat.ATK, 2);

      // out...
      game.doSwitchPokemon(1);
      await game.toNextTurn();
      expect(game.field.getPlayerPokemon()).toBe(magikarp);
      // (Magikarp's own first entry this wave)
      expect(magikarp).toHaveStatStage(Stat.ATK, 2);

      // ...and back in: stages were reset on the switch and the ability stays silent
      game.doSwitchPokemon(1);
      await game.toNextTurn();
      expect(game.field.getPlayerPokemon()).toBe(feebas);
      expect(feebas).toHaveStatStage(Stat.ATK, 0);

      // next wave: the once-per-wave lock is cleared
      game.move.use(MoveId.SPLASH);
      await game.doKillOpponents();
      await game.toNextWave();

      expect(game.field.getPlayerPokemon()).toBe(feebas);
      expect(feebas).not.toHaveAbilityApplied(AbilityId.BLADE_DANCE);
      // staying on the field is not a new entry
      expect(feebas).toHaveStatStage(Stat.ATK, 0);

      game.doSwitchPokemon(1);
      await game.toNextTurn();
      game.doSwitchPokemon(1);
      await game.toNextTurn();

      expect(game.field.getPlayerPokemon()).toBe(feebas);
      expect(feebas).toHaveAbilityApplied(AbilityId.BLADE_DANCE);
      expect(feebas).toHaveStatStage(Stat.ATK, 2);
    });
  });

  describe("Iron Fortress", () => {
    beforeEach(() => {
      game.override.ability(AbilityId.IRON_FORTRESS);
    });

    it("raises Def by 2 on entry and nothing else", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const feebas = game.field.getPlayerPokemon();

      expect(feebas).toHaveAbilityApplied(AbilityId.IRON_FORTRESS);
      expect(feebas).toHaveStatStage(Stat.DEF, 2);
      expect(feebas).toHaveStatStage(Stat.ATK, 0);
      expect(feebas).toHaveStatStage(Stat.SPDEF, 0);
    });

    it("does not trigger again after switching out and back in during the same wave", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
      const feebas = game.field.getPlayerPokemon();
      expect(feebas).toHaveStatStage(Stat.DEF, 2);

      game.doSwitchPokemon(1);
      await game.toNextTurn();
      game.doSwitchPokemon(1);
      await game.toNextTurn();

      expect(game.field.getPlayerPokemon()).toBe(feebas);
      expect(feebas).toHaveStatStage(Stat.DEF, 0);
    });
  });

  describe("Shrapnel", () => {
    beforeEach(() => {
      game.override.ability(AbilityId.SHRAPNEL);
    });

    it("lays Stealth Rock on the attacker's side after a physical hit, one layer only", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX);

      expect(game).not.toHaveArenaTag(ArenaTagType.STEALTH_ROCK);

      game.move.use(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.TACKLE);
      await game.toNextTurn();

      expect(game).toHaveArenaTag(ArenaTagType.STEALTH_ROCK, ArenaTagSide.ENEMY);
      expect(game).not.toHaveArenaTag(ArenaTagType.STEALTH_ROCK, ArenaTagSide.PLAYER);
      expect(game).toHaveArenaTag({ tagType: ArenaTagType.STEALTH_ROCK, side: ArenaTagSide.ENEMY, layers: 1 });

      // a second physical hit does not stack another layer
      game.move.use(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.TACKLE);
      await game.toEndOfTurn();

      expect(game).toHaveArenaTag({ tagType: ArenaTagType.STEALTH_ROCK, side: ArenaTagSide.ENEMY, layers: 1 });
    });

    it("does nothing after a special hit", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();

      game.move.use(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.SWIFT);
      await game.toEndOfTurn();

      expect(snorlax.hp).toBeLessThan(snorlax.getMaxHp());
      expect(game).not.toHaveArenaTag(ArenaTagType.STEALTH_ROCK);
      expect(snorlax).not.toHaveAbilityApplied(AbilityId.SHRAPNEL);
    });
  });

  describe("Hilt Cannon", () => {
    it.each([
      { name: "Dragon Pulse (pulse move)", move: MoveId.DRAGON_PULSE, mult: 1.5 },
      { name: "Ice Beam (BEAM move)", move: MoveId.ICE_BEAM, mult: 1.5 },
      { name: "Tackle (neither)", move: MoveId.TACKLE, mult: 1 },
    ])("multiplies $name damage by $mult", async ({ move, mult }) => {
      await game.classicMode.startBattle(SpeciesId.MEWTWO);
      const mewtwo = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      const before = enemy.getAttackDamage({ source: mewtwo, move: allMoves[move], simulated: true }).damage;
      game.override.ability(AbilityId.HILT_CANNON);
      const after = enemy.getAttackDamage({ source: mewtwo, move: allMoves[move], simulated: true }).damage;

      expect(before).toBeGreaterThan(0);
      if (mult === 1) {
        expect(after).toBe(before);
      } else {
        expect(after / before).toBeCloseTo(mult, 1);
        expect(after).toBeGreaterThan(before);
      }
    });
  });

  describe("War Machine", () => {
    beforeEach(() => {
      game.override.ability(AbilityId.WAR_MACHINE);
    });

    it("raises all five stats by 1 on entry", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const feebas = game.field.getPlayerPokemon();

      expect(feebas).toHaveAbilityApplied(AbilityId.WAR_MACHINE);
      for (const stat of FIVE_STATS) {
        expect(feebas).toHaveStatStage(stat, 1);
      }
      expect(feebas).toHaveStatStage(Stat.ACC, 0);
      expect(feebas).toHaveStatStage(Stat.EVA, 0);
    });

    it("does not trigger again after switching out and back in during the same wave", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
      const feebas = game.field.getPlayerPokemon();
      expect(feebas).toHaveStatStage(Stat.ATK, 1);

      game.doSwitchPokemon(1);
      await game.toNextTurn();
      game.doSwitchPokemon(1);
      await game.toNextTurn();

      expect(game.field.getPlayerPokemon()).toBe(feebas);
      for (const stat of FIVE_STATS) {
        expect(feebas).toHaveStatStage(stat, 0);
      }
    });
  });
});
