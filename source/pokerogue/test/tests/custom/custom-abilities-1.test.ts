import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Custom abilities 1", () => {
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
      .enemySpecies(SpeciesId.RATTATA)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH, MoveId.TACKLE, MoveId.SLASH, MoveId.SWORDS_DANCE]);
  });

  describe("Steel Body", () => {
    it("ignores the foe's Attack boosts when taking damage", async () => {
      game.override.ability(AbilityId.STEEL_BODY);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const tackle = allMoves[MoveId.TACKLE];

      enemy.setStatStage(Stat.ATK, 6);
      const ignored = player.getAttackDamage({ source: enemy, move: tackle, simulated: true }).damage;

      game.override.ability(AbilityId.BALL_FETCH);
      const boosted = player.getAttackDamage({ source: enemy, move: tackle, simulated: true }).damage;
      enemy.setStatStage(Stat.ATK, 0);
      const neutral = player.getAttackDamage({ source: enemy, move: tackle, simulated: true }).damage;

      expect(ignored).toBe(neutral);
      expect(boosted).toBeGreaterThan(ignored);
    });

    it("is immune to Thunder Wave from a foe", async () => {
      game.override.ability(AbilityId.STEEL_BODY).enemyMoveset(MoveId.THUNDER_WAVE);
      vi.spyOn(allMoves[MoveId.THUNDER_WAVE], "accuracy", "get").mockReturnValue(100);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(game.field.getPlayerPokemon()).toHaveStatusEffect(StatusEffect.NONE);
    });

    it("is paralysed by Thunder Wave without the ability", async () => {
      game.override.enemyMoveset(MoveId.THUNDER_WAVE);
      vi.spyOn(allMoves[MoveId.THUNDER_WAVE], "accuracy", "get").mockReturnValue(100);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(game.field.getPlayerPokemon()).toHaveStatusEffect(StatusEffect.PARALYSIS);
    });

    it("still allows its own status moves and the foe's side-targeted hazards", async () => {
      game.override.ability(AbilityId.STEEL_BODY).enemyMoveset(MoveId.STEALTH_ROCK);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);

      game.move.select(MoveId.SWORDS_DANCE);
      await game.toNextTurn();

      expect(game.field.getPlayerPokemon()).toHaveStatStage(Stat.ATK, 2);
      expect(game).toHaveArenaTag(ArenaTagType.STEALTH_ROCK, ArenaTagSide.PLAYER);
    });
  });

  describe("Fortitude", () => {
    it("raises Sp. Def by 1 after taking a damaging hit", async () => {
      game.override.ability(AbilityId.FORTITUDE).enemyMoveset(MoveId.TACKLE);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      const player = game.field.getPlayerPokemon();
      expect(player).not.toHaveFullHp();
      expect(player).toHaveStatStage(Stat.SPDEF, 1);
      expect(player).toHaveStatStage(Stat.DEF, 0);
    });

    it("does not trigger on a status move", async () => {
      game.override.ability(AbilityId.FORTITUDE).enemyMoveset(MoveId.GROWL);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      const player = game.field.getPlayerPokemon();
      expect(player).toHaveStatStage(Stat.ATK, -1);
      expect(player).toHaveStatStage(Stat.SPDEF, 0);
    });

    it("does nothing without the ability", async () => {
      game.override.enemyMoveset(MoveId.TACKLE);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(game.field.getPlayerPokemon()).toHaveStatStage(Stat.SPDEF, 0);
    });
  });

  describe("Deadeye", () => {
    it("adds 2 crit stages to the user's moves", async () => {
      game.override.ability(AbilityId.DEADEYE);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const enemy = game.field.getEnemyPokemon();
      const critSpy = vi.spyOn(enemy, "getCritStage");

      game.move.select(MoveId.TACKLE);
      await game.phaseInterceptor.to("BerryPhase");

      expect(critSpy).toHaveReturnedWith(2);
    });

    it("guarantees a crit with a high-crit move even when crit rolls fail", async () => {
      game.override.ability(AbilityId.DEADEYE);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const enemy = game.field.getEnemyPokemon();
      const critSpy = vi.spyOn(enemy, "getCritStage");
      const critResult = vi.spyOn(enemy, "getCriticalHitResult");

      game.move.select(MoveId.SLASH);
      await game.phaseInterceptor.to("BerryPhase");

      expect(critSpy).toHaveReturnedWith(3);
      expect(critResult).toHaveReturnedWith(true);
    });

    it("leaves the crit stage alone without the ability", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const enemy = game.field.getEnemyPokemon();
      const critSpy = vi.spyOn(enemy, "getCritStage");
      const critResult = vi.spyOn(enemy, "getCriticalHitResult");

      game.move.select(MoveId.SLASH);
      await game.phaseInterceptor.to("BerryPhase");

      expect(critSpy).toHaveReturnedWith(1);
      expect(critResult).not.toHaveReturnedWith(true);
    });
  });

  describe("Polar Light", () => {
    it("puts Aurora Veil on the user's side for 5 turns on entry", async () => {
      game.override.ability(AbilityId.POLAR_LIGHT);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);

      expect(game).toHaveArenaTag(ArenaTagType.AURORA_VEIL, ArenaTagSide.PLAYER);
      expect(game).not.toHaveArenaTag(ArenaTagType.AURORA_VEIL, ArenaTagSide.ENEMY);
      expect(game.scene.arena.getTagOnSide(ArenaTagType.AURORA_VEIL, ArenaTagSide.PLAYER)?.turnCount).toBe(5);

      for (let turn = 1; turn <= 4; turn++) {
        game.move.select(MoveId.SPLASH);
        await game.toNextTurn();
        expect(game).toHaveArenaTag(ArenaTagType.AURORA_VEIL, ArenaTagSide.PLAYER);
      }

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(game).not.toHaveArenaTag(ArenaTagType.AURORA_VEIL, ArenaTagSide.PLAYER);
    });

    it("does not refresh a veil that is already up", async () => {
      game.override.ability(AbilityId.POLAR_LIGHT);
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(game.scene.arena.getTagOnSide(ArenaTagType.AURORA_VEIL, ArenaTagSide.PLAYER)?.turnCount).toBe(3);

      game.doSwitchPokemon(1);
      await game.toNextTurn();

      expect(game.field.getPlayerPokemon().species.speciesId).toBe(SpeciesId.FEEBAS);
      expect(game.scene.arena.getTagOnSide(ArenaTagType.AURORA_VEIL, ArenaTagSide.PLAYER)?.turnCount).toBe(2);
    });

    it("sets nothing without the ability", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX);

      expect(game).not.toHaveArenaTag(ArenaTagType.AURORA_VEIL, ArenaTagSide.PLAYER);
      expect(game).not.toHaveArenaTag(ArenaTagType.AURORA_VEIL, ArenaTagSide.ENEMY);
    });
  });

  describe("Footwork", () => {
    it("boosts kicking moves by 20%", async () => {
      game.override.ability(AbilityId.FOOTWORK);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(allMoves[MoveId.MEGA_KICK].calculateBattlePower(player, enemy, true)).toBe(120 * 1.2);
      expect(allMoves[MoveId.PYRO_BALL].calculateBattlePower(player, enemy, true)).toBe(120 * 1.2);
    });

    it("leaves non-kicking moves at normal power", async () => {
      game.override.ability(AbilityId.FOOTWORK);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(allMoves[MoveId.TACKLE].calculateBattlePower(player, enemy, true)).toBe(40);
    });

    it("deals more Mega Kick damage than without the ability, and the same Tackle damage", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const megaKick = allMoves[MoveId.MEGA_KICK];
      const tackle = allMoves[MoveId.TACKLE];

      const plainKick = enemy.getAttackDamage({ source: player, move: megaKick, simulated: true }).damage;
      const plainTackle = enemy.getAttackDamage({ source: player, move: tackle, simulated: true }).damage;
      expect(megaKick.calculateBattlePower(player, enemy, true)).toBe(120);

      game.override.ability(AbilityId.FOOTWORK);
      const boostedKick = enemy.getAttackDamage({ source: player, move: megaKick, simulated: true }).damage;
      const boostedTackle = enemy.getAttackDamage({ source: player, move: tackle, simulated: true }).damage;

      expect(boostedKick).toBeGreaterThan(plainKick);
      expect(boostedTackle).toBe(plainTackle);
    });
  });

  describe("Scorch", () => {
    it("multiplies Attack by 1.5 in sun and leaves Sp. Atk alone", async () => {
      game.override.ability(AbilityId.SCORCH).weather(WeatherType.SUNNY);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();

      expect(game).toHaveWeather(WeatherType.SUNNY);
      expect(player.getEffectiveStat(Stat.ATK)).toBe(Math.floor(player.stats[Stat.ATK] * 1.5));
      expect(player.getEffectiveStat(Stat.SPATK)).toBe(player.stats[Stat.SPATK]);
    });

    it("loses 1/8 max HP at the end of each turn in sun", async () => {
      game.override.ability(AbilityId.SCORCH).weather(WeatherType.SUNNY);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(player).toHaveTakenDamage(player.getMaxHp() / 8);
    });

    it("does nothing without sun", async () => {
      game.override.ability(AbilityId.SCORCH);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();

      expect(game).toHaveWeather(WeatherType.NONE);
      expect(player.getEffectiveStat(Stat.ATK)).toBe(player.stats[Stat.ATK]);

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(player).toHaveFullHp();
    });
  });

  describe("Turbo Engine", () => {
    it("sets sun on entry and multiplies Sp. Atk by 4/3 in it", async () => {
      game.override.ability(AbilityId.TURBO_ENGINE);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();

      expect(game).toHaveWeather(WeatherType.SUNNY);
      expect(player.getEffectiveStat(Stat.SPATK)).toBe(Math.floor((player.stats[Stat.SPATK] * 4) / 3));
      expect(player.getEffectiveStat(Stat.ATK)).toBe(player.stats[Stat.ATK]);
    });

    it("loses the Sp. Atk boost once the sun is replaced", async () => {
      game.override.ability(AbilityId.TURBO_ENGINE).enemyMoveset(MoveId.RAIN_DANCE);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(game).toHaveWeather(WeatherType.RAIN);
      expect(player.getEffectiveStat(Stat.SPATK)).toBe(player.stats[Stat.SPATK]);
    });

    it("sets no weather without the ability", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();

      expect(game).toHaveWeather(WeatherType.NONE);
      expect(player.getEffectiveStat(Stat.SPATK)).toBe(player.stats[Stat.SPATK]);
    });
  });
});
