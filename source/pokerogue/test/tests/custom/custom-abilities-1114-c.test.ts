// Local fork (2026-11-14): passive rebalance. Tests for batch C of the new custom abilities
// (src/data/abilities/custom-abilities-1114-c.ts; spec in tools/drive/passive_adjust_1114/impl_batches.json).
import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import { toDmgValue } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Custom abilities 2026-11-14, batch C", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    // Both sides get a harmless passive by default, so species passives from the sheet never interfere
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyPassiveAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .passiveAbility(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH, MoveId.TACKLE]);
  });

  /** Base power of `move` used by the player's active Pokémon against the enemy's, with all ability boosts. */
  function power(move: MoveId): number {
    return allMoves[move].calculateBattlePower(game.field.getPlayerPokemon(), game.field.getEnemyPokemon(), true);
  }

  describe("Headstrong (막무가내)", () => {
    it("multiplies recoil-move power by 1.2 and leaves other moves alone", async () => {
      game.override.ability(AbilityId.HEADSTRONG);
      await game.classicMode.startBattle(SpeciesId.BOUFFALANT);

      expect(power(MoveId.DOUBLE_EDGE)).toBeCloseTo(144);
      expect(power(MoveId.HEAD_SMASH)).toBeCloseTo(180);
      expect(power(MoveId.HEAD_CHARGE)).toBeCloseTo(144);
      expect(power(MoveId.TACKLE)).toBe(40);
    });

    it.each([
      { name: "Double-Edge", move: MoveId.DOUBLE_EDGE },
      { name: "Head Smash", move: MoveId.HEAD_SMASH },
    ])("takes no recoil from $name as a passive", async ({ move }) => {
      game.override.passiveAbility(AbilityId.HEADSTRONG).moveset([move]).enemyLevel(100);
      vi.spyOn(allMoves[move], "accuracy", "get").mockReturnValue(100);
      await game.classicMode.startBattle(SpeciesId.BOUFFALANT);
      const player = game.field.getPlayerPokemon();

      game.move.select(move);
      await game.toNextTurn();

      expect(game.field.getEnemyPokemon()).not.toHaveFullHp();
      expect(player).toHaveFullHp();
    });

    it("takes recoil from Double-Edge without the ability", async () => {
      game.override.moveset([MoveId.DOUBLE_EDGE]).enemyLevel(100);
      await game.classicMode.startBattle(SpeciesId.BOUFFALANT);

      game.move.select(MoveId.DOUBLE_EDGE);
      await game.toNextTurn();

      expect(game.field.getPlayerPokemon()).not.toHaveFullHp();
    });

    it("applies the x1.2 only once on a Reckless Bouffalant, and still blocks the recoil", async () => {
      game.override
        .ability(AbilityId.RECKLESS)
        .passiveAbility(AbilityId.HEADSTRONG)
        .moveset([MoveId.HEAD_CHARGE])
        .enemyLevel(100);
      await game.classicMode.startBattle(SpeciesId.BOUFFALANT);
      const player = game.field.getPlayerPokemon();

      expect(power(MoveId.HEAD_CHARGE)).toBeCloseTo(144);

      game.move.select(MoveId.HEAD_CHARGE);
      await game.toNextTurn();

      expect(game.field.getEnemyPokemon()).not.toHaveFullHp();
      expect(player).toHaveFullHp();
    });

    it("still takes crash damage when High Jump Kick fails", async () => {
      game.override.ability(AbilityId.HEADSTRONG).moveset([MoveId.HIGH_JUMP_KICK]).enemySpecies(SpeciesId.GASTLY);
      await game.classicMode.startBattle(SpeciesId.BOUFFALANT);
      const player = game.field.getPlayerPokemon();

      game.move.select(MoveId.HIGH_JUMP_KICK);
      await game.toNextTurn();

      expect(player).toHaveTakenDamage(player.getMaxHp() / 2);
    });

    it("still pays Chloroblast's HP cost", async () => {
      game.override.ability(AbilityId.HEADSTRONG).moveset([MoveId.CHLOROBLAST]).enemyLevel(100);
      vi.spyOn(allMoves[MoveId.CHLOROBLAST], "accuracy", "get").mockReturnValue(100);
      await game.classicMode.startBattle(SpeciesId.BOUFFALANT);
      const player = game.field.getPlayerPokemon();

      game.move.select(MoveId.CHLOROBLAST);
      await game.toNextTurn();

      expect(game.field.getEnemyPokemon()).not.toHaveFullHp();
      expect(player).toHaveTakenDamage(toDmgValue(player.getMaxHp() * 0.5));
    });
  });

  describe("Full Bloom (만개)", () => {
    it("sets sun on entry and doubles Speed in it, as a passive", async () => {
      game.override.passiveAbility(AbilityId.FULL_BLOOM);
      await game.classicMode.startBattle(SpeciesId.LURANTIS);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(game).toHaveWeather(WeatherType.SUNNY);
      expect(player).toHaveEffectiveStat(Stat.SPD, player.stats[Stat.SPD] * 2);
      expect(enemy).toHaveEffectiveStat(Stat.SPD, enemy.stats[Stat.SPD]);
    });

    it("loses the Speed boost once rain replaces the sun", async () => {
      game.override.passiveAbility(AbilityId.FULL_BLOOM).enemyMoveset(MoveId.RAIN_DANCE);
      await game.classicMode.startBattle(SpeciesId.LURANTIS);
      const player = game.field.getPlayerPokemon();

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(game).toHaveWeather(WeatherType.RAIN);
      expect(player).toHaveEffectiveStat(Stat.SPD, player.stats[Stat.SPD]);
    });

    it("turns a Flower Gift Cherrim into its Sunshine Form", async () => {
      game.override.ability(AbilityId.FLOWER_GIFT).passiveAbility(AbilityId.FULL_BLOOM);
      await game.classicMode.startBattle(SpeciesId.CHERRIM);

      expect(game).toHaveWeather(WeatherType.SUNNY);
      expect(game.field.getPlayerPokemon().formIndex).toBe(1);
    });

    it("doubles Speed only once with a regular Chlorophyll", async () => {
      game.override.ability(AbilityId.CHLOROPHYLL).passiveAbility(AbilityId.FULL_BLOOM);
      await game.classicMode.startBattle(SpeciesId.LURANTIS);
      const player = game.field.getPlayerPokemon();

      expect(game).toHaveWeather(WeatherType.SUNNY);
      expect(player).toHaveEffectiveStat(Stat.SPD, player.stats[Stat.SPD] * 2);
    });
  });

  describe("Sand Sprint (모래질주)", () => {
    it("in sandstorm: Speed x2, Rock / Ground / Steel x1.3 and no sandstorm damage, as a passive", async () => {
      game.override.passiveAbility(AbilityId.SAND_SPRINT).weather(WeatherType.SANDSTORM);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();

      expect(player).toHaveEffectiveStat(Stat.SPD, player.stats[Stat.SPD] * 2);
      expect(power(MoveId.ROCK_SLIDE)).toBeCloseTo(75 * 1.3);
      expect(power(MoveId.EARTHQUAKE)).toBeCloseTo(100 * 1.3);
      expect(power(MoveId.IRON_HEAD)).toBeCloseTo(80 * 1.3);
      expect(power(MoveId.TACKLE)).toBe(40);

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(player).toHaveFullHp();
      expect(game.field.getEnemyPokemon()).not.toHaveFullHp();
    });

    it("does not summon sandstorm and does nothing without it", async () => {
      game.override.passiveAbility(AbilityId.SAND_SPRINT);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();

      expect(game).toHaveWeather(WeatherType.NONE);
      expect(player).toHaveEffectiveStat(Stat.SPD, player.stats[Stat.SPD]);
      expect(power(MoveId.ROCK_SLIDE)).toBe(75);
    });

    it("on a Sand Force Gigalith: Rock x1.3 only once, Speed x2", async () => {
      game.override.ability(AbilityId.SAND_FORCE).passiveAbility(AbilityId.SAND_SPRINT).weather(WeatherType.SANDSTORM);
      await game.classicMode.startBattle(SpeciesId.GIGALITH);
      const player = game.field.getPlayerPokemon();

      expect(power(MoveId.ROCK_SLIDE)).toBeCloseTo(75 * 1.3);
      expect(player).toHaveEffectiveStat(Stat.SPD, player.stats[Stat.SPD] * 2);

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(player).toHaveFullHp();
    });

    it("on a Sand Rush holder: Speed x2 only once, Rock x1.3 still applies", async () => {
      game.override.ability(AbilityId.SAND_RUSH).passiveAbility(AbilityId.SAND_SPRINT).weather(WeatherType.SANDSTORM);
      await game.classicMode.startBattle(SpeciesId.EXCADRILL);
      const player = game.field.getPlayerPokemon();

      expect(player).toHaveEffectiveStat(Stat.SPD, player.stats[Stat.SPD] * 2);
      expect(power(MoveId.ROCK_SLIDE)).toBeCloseTo(75 * 1.3);
    });
  });

  describe("Lookout (망보기)", () => {
    it("lowers the foe's Attack by 1 on entry, as a passive", async () => {
      game.override.passiveAbility(AbilityId.LOOKOUT);
      await game.classicMode.startBattle(SpeciesId.MIGHTYENA);

      expect(game.field.getEnemyPokemon()).toHaveStatStage(Stat.ATK, -1);
      expect(game.field.getPlayerPokemon()).toHaveStatStage(Stat.ATK, 0);
    });

    it("counts as Intimidate: Inner Focus blocks it", async () => {
      game.override.passiveAbility(AbilityId.LOOKOUT).enemyAbility(AbilityId.INNER_FOCUS);
      await game.classicMode.startBattle(SpeciesId.MIGHTYENA);

      expect(game.field.getEnemyPokemon()).toHaveStatStage(Stat.ATK, 0);
    });

    it("counts as Intimidate: Guard Dog turns it into Attack +1", async () => {
      game.override.passiveAbility(AbilityId.LOOKOUT).enemyAbility(AbilityId.GUARD_DOG);
      await game.classicMode.startBattle(SpeciesId.MIGHTYENA);

      expect(game.field.getEnemyPokemon()).toHaveStatStage(Stat.ATK, 1);
    });

    it("doubles power against a target that switched in this turn, and only then", async () => {
      game.override.passiveAbility(AbilityId.LOOKOUT);
      await game.classicMode.startBattle(SpeciesId.MIGHTYENA);
      const enemy = game.field.getEnemyPokemon();

      expect(power(MoveId.TACKLE)).toBe(40);
      enemy.turnData.switchedInThisTurn = true;
      expect(power(MoveId.TACKLE)).toBe(80);
      expect(power(MoveId.CRUNCH)).toBe(160);
    });
  });

  describe("Thundercloud (번개구름)", () => {
    it("multiplies Electric moves by 1.3 and leaves others alone, as a passive", async () => {
      game.override.passiveAbility(AbilityId.THUNDERCLOUD);
      await game.classicMode.startBattle(SpeciesId.THUNDURUS);

      expect(power(MoveId.THUNDERBOLT)).toBeCloseTo(90 * 1.3);
      expect(power(MoveId.TACKLE)).toBe(40);
    });

    it("becomes Charged when hit by a wind move, doubling its next Electric move", async () => {
      game.override.passiveAbility(AbilityId.THUNDERCLOUD).enemyMoveset(MoveId.PETAL_BLIZZARD);
      await game.classicMode.startBattle(SpeciesId.THUNDURUS);
      const player = game.field.getPlayerPokemon();

      expect(player).not.toHaveBattlerTag(BattlerTagType.CHARGED);

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(player).not.toHaveFullHp();
      expect(player).toHaveBattlerTag(BattlerTagType.CHARGED);
      expect(power(MoveId.THUNDERBOLT)).toBeCloseTo(90 * 1.3 * 2);
    });

    it("does not become Charged from a non-wind hit", async () => {
      game.override.passiveAbility(AbilityId.THUNDERCLOUD).enemyMoveset(MoveId.TACKLE);
      await game.classicMode.startBattle(SpeciesId.THUNDURUS);
      const player = game.field.getPlayerPokemon();

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(player).not.toHaveFullHp();
      expect(player).not.toHaveBattlerTag(BattlerTagType.CHARGED);
    });

    // Uses THUNDERCLOUD beside WIND_POWER in TailwindTag.onAdd (src/data/arena-tag.ts)
    it("becomes Charged when Tailwind starts on its own side", async () => {
      game.override.passiveAbility(AbilityId.THUNDERCLOUD).moveset([MoveId.TAILWIND]);
      await game.classicMode.startBattle(SpeciesId.THUNDURUS);
      const player = game.field.getPlayerPokemon();

      game.move.select(MoveId.TAILWIND);
      await game.phaseInterceptor.to("TurnEndPhase");

      expect(player).toHaveBattlerTag(BattlerTagType.CHARGED);
      expect(game.field.getEnemyPokemon()).not.toHaveBattlerTag(BattlerTagType.CHARGED);
    });
  });

  describe("Rock Fangs (바위송곳니)", () => {
    it("multiplies Rock moves and biting moves by 1.5, as a passive", async () => {
      game.override.passiveAbility(AbilityId.ROCK_FANGS);
      await game.classicMode.startBattle(SpeciesId.LYCANROC);

      expect(power(MoveId.ROCK_SLIDE)).toBeCloseTo(75 * 1.5);
      expect(power(MoveId.CRUNCH)).toBeCloseTo(80 * 1.5);
      expect(power(MoveId.FIRE_FANG)).toBeCloseTo(65 * 1.5);
      expect(power(MoveId.TACKLE)).toBe(40);
    });

    it.each([
      { name: "Stone Edge (Rock)", move: MoveId.STONE_EDGE, mult: 1.5 },
      { name: "Crunch (biting)", move: MoveId.CRUNCH, mult: 1.5 },
      { name: "Tackle (neither)", move: MoveId.TACKLE, mult: 1 },
    ])("multiplies $name damage by $mult", async ({ move, mult }) => {
      await game.classicMode.startBattle(SpeciesId.LYCANROC);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      const before = enemy.getAttackDamage({ source: player, move: allMoves[move], simulated: true }).damage;
      game.override.ability(AbilityId.ROCK_FANGS);
      const after = enemy.getAttackDamage({ source: player, move: allMoves[move], simulated: true }).damage;

      expect(before).toBeGreaterThan(0);
      if (mult === 1) {
        expect(after).toBe(before);
      } else {
        expect(after / before).toBeCloseTo(mult, 1);
      }
    });
  });

  describe("Shock Barbs (전기가시)", () => {
    beforeEach(() => {
      game.override.passiveAbility(AbilityId.SHOCK_BARBS).enemySpecies(SpeciesId.RATTATA).enemyMoveset(MoveId.TACKLE);
    });

    it("hurts a contact attacker by 1/8 of its max HP and paralyses it on a successful roll", async () => {
      await game.classicMode.startBattle(SpeciesId.PINCURCHIN);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      vi.spyOn(player, "randBattleSeedInt").mockReturnValue(0);

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(player).not.toHaveFullHp();
      expect(enemy).toHaveTakenDamage(enemy.getMaxHp() / 8);
      expect(enemy).toHaveStatusEffect(StatusEffect.PARALYSIS);
    });

    it("still hurts the attacker when the paralysis roll fails", async () => {
      await game.classicMode.startBattle(SpeciesId.PINCURCHIN);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      vi.spyOn(player, "randBattleSeedInt").mockReturnValue(99);

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(enemy).toHaveTakenDamage(enemy.getMaxHp() / 8);
      expect(enemy).toHaveStatusEffect(StatusEffect.NONE);
    });

    it("works when the hit makes the holder faint", async () => {
      await game.classicMode.startBattle(SpeciesId.PINCURCHIN, SpeciesId.MAGIKARP);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      player.hp = 1;
      vi.spyOn(player, "randBattleSeedInt").mockReturnValue(0);

      game.move.select(MoveId.SPLASH);
      await game.phaseInterceptor.to("TurnEndPhase");

      expect(player).toHaveFainted();
      expect(enemy).toHaveTakenDamage(enemy.getMaxHp() / 8);
      expect(enemy).toHaveStatusEffect(StatusEffect.PARALYSIS);
    });

    it("cannot paralyse an Electric-type attacker, but still hurts it", async () => {
      game.override.enemySpecies(SpeciesId.PIKACHU);
      await game.classicMode.startBattle(SpeciesId.PINCURCHIN);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      vi.spyOn(player, "randBattleSeedInt").mockReturnValue(0);

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(enemy).toHaveTakenDamage(enemy.getMaxHp() / 8);
      expect(enemy).toHaveStatusEffect(StatusEffect.NONE);
    });

    it("cannot hurt a Magic Guard attacker, but still paralyses it", async () => {
      game.override.enemyAbility(AbilityId.MAGIC_GUARD);
      await game.classicMode.startBattle(SpeciesId.PINCURCHIN);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      vi.spyOn(player, "randBattleSeedInt").mockReturnValue(0);

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(enemy).toHaveFullHp();
      expect(enemy).toHaveStatusEffect(StatusEffect.PARALYSIS);
    });

    it("does nothing against a non-contact attack", async () => {
      game.override.enemyMoveset(MoveId.SWIFT);
      await game.classicMode.startBattle(SpeciesId.PINCURCHIN);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      vi.spyOn(player, "randBattleSeedInt").mockReturnValue(0);

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(player).not.toHaveFullHp();
      expect(enemy).toHaveFullHp();
      expect(enemy).toHaveStatusEffect(StatusEffect.NONE);
    });
  });

  describe("Sand Tempest (모래폭풍)", () => {
    it("sets sandstorm on entry, boosts Rock / Ground / Steel by 1.3 in it and blocks sand damage, as a passive", async () => {
      game.override.passiveAbility(AbilityId.SAND_TEMPEST);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();

      expect(game).toHaveWeather(WeatherType.SANDSTORM);
      expect(power(MoveId.ROCK_SLIDE)).toBeCloseTo(75 * 1.3);
      expect(power(MoveId.EARTHQUAKE)).toBeCloseTo(100 * 1.3);
      expect(power(MoveId.IRON_HEAD)).toBeCloseTo(80 * 1.3);
      expect(power(MoveId.TACKLE)).toBe(40);

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(player).toHaveFullHp();
      expect(game.field.getEnemyPokemon()).not.toHaveFullHp();
    });

    it("applies the x1.3 only once with a regular Sand Force", async () => {
      game.override.ability(AbilityId.SAND_FORCE).passiveAbility(AbilityId.SAND_TEMPEST);
      await game.classicMode.startBattle(SpeciesId.SANDACONDA);

      expect(game).toHaveWeather(WeatherType.SANDSTORM);
      expect(power(MoveId.EARTHQUAKE)).toBeCloseTo(100 * 1.3);
    });

    it("loses the boost once rain replaces the sandstorm", async () => {
      game.override.passiveAbility(AbilityId.SAND_TEMPEST).enemyMoveset(MoveId.RAIN_DANCE);
      await game.classicMode.startBattle(SpeciesId.SANDACONDA);

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(game).toHaveWeather(WeatherType.RAIN);
      expect(power(MoveId.EARTHQUAKE)).toBe(100);
    });
  });

  describe("Hunting Instinct (사냥본능)", () => {
    it("multiplies biting moves by 1.5 and leaves others alone, as a passive", async () => {
      game.override.passiveAbility(AbilityId.HUNTING_INSTINCT);
      await game.classicMode.startBattle(SpeciesId.MABOSSTIFF);

      expect(power(MoveId.CRUNCH)).toBeCloseTo(120);
      expect(power(MoveId.PSYCHIC_FANGS)).toBeCloseTo(85 * 1.5);
      expect(power(MoveId.TACKLE)).toBe(40);
    });

    it("raises Attack by 1 after knocking out a foe", async () => {
      game.override
        .passiveAbility(AbilityId.HUNTING_INSTINCT)
        .moveset([MoveId.CRUNCH])
        .startingLevel(100)
        .enemyLevel(1)
        .enemySpecies(SpeciesId.RATTATA);
      await game.classicMode.startBattle(SpeciesId.MABOSSTIFF, SpeciesId.MABOSSTIFF);
      const player = game.field.getPlayerPokemon();

      game.move.select(MoveId.CRUNCH);
      await game.phaseInterceptor.to("VictoryPhase");

      expect(player).toHaveStatStage(Stat.ATK, 1);
    });

    it("raises Attack by 1 only once with a regular Moxie", async () => {
      game.override
        .ability(AbilityId.MOXIE)
        .passiveAbility(AbilityId.HUNTING_INSTINCT)
        .moveset([MoveId.CRUNCH])
        .startingLevel(100)
        .enemyLevel(1)
        .enemySpecies(SpeciesId.RATTATA);
      await game.classicMode.startBattle(SpeciesId.MABOSSTIFF, SpeciesId.MABOSSTIFF);
      const player = game.field.getPlayerPokemon();

      game.move.select(MoveId.CRUNCH);
      await game.phaseInterceptor.to("VictoryPhase");

      expect(player).toHaveStatStage(Stat.ATK, 1);
    });

    it("applies the x1.5 only once with a regular Strong Jaw", async () => {
      game.override.ability(AbilityId.STRONG_JAW).passiveAbility(AbilityId.HUNTING_INSTINCT);
      await game.classicMode.startBattle(SpeciesId.MABOSSTIFF);

      expect(power(MoveId.CRUNCH)).toBeCloseTo(120);
    });
  });

  describe("Rampage (폭주)", () => {
    it("while burned: Attack x1.5 and no burn halving, as a passive", async () => {
      game.override.passiveAbility(AbilityId.RAMPAGE).statusEffect(StatusEffect.BURN);
      await game.classicMode.startBattle(SpeciesId.REVAVROOM);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const tackle = allMoves[MoveId.TACKLE];

      expect(player).toHaveStatusEffect(StatusEffect.BURN);
      expect(player).toHaveEffectiveStat(Stat.ATK, Math.floor(player.stats[Stat.ATK] * 1.5));
      const rampage = enemy.getAttackDamage({ source: player, move: tackle, simulated: true }).damage;

      // Healthy and therefore without any Rampage effect: the plain damage
      player.resetStatus(false, false, false, false);
      expect(player).toHaveEffectiveStat(Stat.ATK, player.stats[Stat.ATK]);
      const plain = enemy.getAttackDamage({ source: player, move: tackle, simulated: true }).damage;

      expect(rampage / plain).toBeCloseTo(1.5, 1);
    });

    it("while paralysed: Speed x1.5 with no paralysis halving", async () => {
      game.override.passiveAbility(AbilityId.RAMPAGE).statusEffect(StatusEffect.PARALYSIS);
      await game.classicMode.startBattle(SpeciesId.REVAVROOM);
      const player = game.field.getPlayerPokemon();

      expect(player).toHaveEffectiveStat(Stat.SPD, Math.floor(player.stats[Stat.SPD] * 1.5));
      expect(player).toHaveEffectiveStat(Stat.ATK, Math.floor(player.stats[Stat.ATK] * 1.5));
    });

    it("halves Speed while paralysed without the ability", async () => {
      game.override.statusEffect(StatusEffect.PARALYSIS);
      await game.classicMode.startBattle(SpeciesId.REVAVROOM);
      const player = game.field.getPlayerPokemon();

      expect(player).toHaveEffectiveStat(Stat.SPD, Math.floor(player.stats[Stat.SPD] / 2));
    });

    it("while poisoned: Attack and Speed x1.5", async () => {
      game.override.passiveAbility(AbilityId.RAMPAGE).statusEffect(StatusEffect.POISON);
      await game.classicMode.startBattle(SpeciesId.REVAVROOM);
      const player = game.field.getPlayerPokemon();

      expect(player).toHaveEffectiveStat(Stat.ATK, Math.floor(player.stats[Stat.ATK] * 1.5));
      expect(player).toHaveEffectiveStat(Stat.SPD, Math.floor(player.stats[Stat.SPD] * 1.5));
    });

    it("does nothing without a status condition", async () => {
      game.override.passiveAbility(AbilityId.RAMPAGE);
      await game.classicMode.startBattle(SpeciesId.REVAVROOM);
      const player = game.field.getPlayerPokemon();

      expect(player).toHaveEffectiveStat(Stat.ATK, player.stats[Stat.ATK]);
      expect(player).toHaveEffectiveStat(Stat.SPD, player.stats[Stat.SPD]);
    });

    it("applies each multiplier once with a regular Guts or Quick Feet", async () => {
      game.override.ability(AbilityId.GUTS).passiveAbility(AbilityId.RAMPAGE).statusEffect(StatusEffect.PARALYSIS);
      await game.classicMode.startBattle(SpeciesId.REVAVROOM);
      const player = game.field.getPlayerPokemon();

      expect(player).toHaveEffectiveStat(Stat.ATK, Math.floor(player.stats[Stat.ATK] * 1.5));
      expect(player).toHaveEffectiveStat(Stat.SPD, Math.floor(player.stats[Stat.SPD] * 1.5));

      game.override.ability(AbilityId.QUICK_FEET);
      expect(player).toHaveEffectiveStat(Stat.ATK, Math.floor(player.stats[Stat.ATK] * 1.5));
      expect(player).toHaveEffectiveStat(Stat.SPD, Math.floor(player.stats[Stat.SPD] * 1.5));
    });
  });

  describe("Toughness (맷집)", () => {
    beforeEach(() => {
      game.override.passiveAbility(AbilityId.TOUGHNESS).enemySpecies(SpeciesId.RATTATA);
    });

    it.each([
      { name: "a physical hit (Tackle)", move: MoveId.TACKLE, def: 1, spdef: 0 },
      { name: "a special hit (Water Gun)", move: MoveId.WATER_GUN, def: 0, spdef: 1 },
      { name: "Psyshock (special, hits Defense)", move: MoveId.PSYSHOCK, def: 0, spdef: 1 },
      { name: "Photon Geyser used as a physical move", move: MoveId.PHOTON_GEYSER, def: 1, spdef: 0 },
      { name: "each hit of Double Kick", move: MoveId.DOUBLE_KICK, def: 2, spdef: 0 },
    ] as const)("after $name: Def +$def, Sp. Def +$spdef", async ({ move, def, spdef }) => {
      game.override.enemyMoveset(move);
      vi.spyOn(allMoves[move], "accuracy", "get").mockReturnValue(100);
      await game.classicMode.startBattle(SpeciesId.THROH);
      const player = game.field.getPlayerPokemon();

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(player).not.toHaveFullHp();
      expect(player).toHaveStatStage(Stat.DEF, def);
      expect(player).toHaveStatStage(Stat.SPDEF, spdef);
    });

    // Local fork (2026-11-14): passive rebalance, after review. Shell Side Arm breaks an exact physical/special forecast
    // tie with a battle RNG roll; Toughness must follow the category the damage step used, and raise exactly one stat.
    it("follows the category the damage step used when Shell Side Arm breaks an exact tie", async () => {
      game.override.enemyMoveset(MoveId.SHELL_SIDE_ARM);
      await game.classicMode.startBattle(SpeciesId.THROH);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      // An exact tie in every forecast; the real damage step's category is recorded
      const realGetBaseDamage = player.getBaseDamage.bind(player);
      const damageCategories: MoveCategory[] = [];
      vi.spyOn(player, "getBaseDamage").mockImplementation(params => {
        if (params.categoryForecast) {
          return 100;
        }
        if (params.move.id === MoveId.SHELL_SIDE_ARM && params.simulated === false) {
          damageCategories.push(params.moveCategory);
        }
        return realGetBaseDamage(params);
      });
      // Every tie-break roll alternates (0 = physical, 1 = special), so a roll made again after the hit would pick the
      // other category than the roll just before it
      const realRandBattleSeedInt = enemy.randBattleSeedInt.bind(enemy);
      let rolls = 0;
      vi.spyOn(enemy, "randBattleSeedInt").mockImplementation((range, min) =>
        range === 2 ? rolls++ % 2 : realRandBattleSeedInt(range, min),
      );

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(player).not.toHaveFullHp();
      expect(damageCategories).toHaveLength(1);
      const physical = damageCategories[0] === MoveCategory.PHYSICAL;
      expect(player).toHaveStatStage(Stat.DEF, physical ? 1 : 0);
      expect(player).toHaveStatStage(Stat.SPDEF, physical ? 0 : 1);
    });

    it("does not react to a status move", async () => {
      game.override.enemyMoveset(MoveId.GROWL);
      await game.classicMode.startBattle(SpeciesId.THROH);
      const player = game.field.getPlayerPokemon();

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(player).toHaveStatStage(Stat.ATK, -1);
      expect(player).toHaveStatStage(Stat.DEF, 0);
      expect(player).toHaveStatStage(Stat.SPDEF, 0);
    });

    it("does not react to a hit on its substitute", async () => {
      game.override.enemyMoveset(MoveId.TACKLE).moveset([MoveId.SUBSTITUTE]);
      await game.classicMode.startBattle(SpeciesId.THROH);
      const player = game.field.getPlayerPokemon();

      game.move.select(MoveId.SUBSTITUTE);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
      await game.toNextTurn();

      expect(player).toHaveStatStage(Stat.DEF, 0);
      expect(player).toHaveStatStage(Stat.SPDEF, 0);
    });
  });
});
