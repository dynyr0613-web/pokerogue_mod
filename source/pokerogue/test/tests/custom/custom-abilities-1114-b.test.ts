// Local fork (2026-11-14): passive rebalance. Tests for batch B of the new custom abilities
// (src/data/abilities/custom-abilities-1114-b.ts; spec: tools/drive/passive_adjust_1114/impl_batches.json).
import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerIndex } from "#enums/battler-index";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import { toDmgValue } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Custom abilities 2026-11-14 (batch B)", () => {
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
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyHasPassiveAbility(false)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .hasPassiveAbility(false)
      .moveset([MoveId.SPLASH, MoveId.TACKLE, MoveId.SWIFT]);
  });

  /** Gives the player `passive` as a passive ability (regular ability `main`, Ball Fetch by default). */
  function withPassive(passive: AbilityId, main: AbilityId = AbilityId.BALL_FETCH): void {
    game.override.ability(main).passiveAbility(passive).hasPassiveAbility(true);
  }

  /** Simulated damage of `move` used by `attacker` against `defender` (no random roll, no crit). */
  function damageOf(defender: Pokemon, attacker: Pokemon, move: MoveId): number {
    return defender.getAttackDamage({ source: attacker, move: allMoves[move], simulated: true }).damage;
  }

  describe("Venom Hunt", () => {
    it("poisons the target of a contact move when the 30% roll succeeds", async () => {
      game.override.ability(AbilityId.VENOM_HUNT);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      vi.spyOn(game.field.getPlayerPokemon(), "randBattleSeedInt").mockReturnValue(29);

      game.move.use(MoveId.TACKLE);
      await game.toEndOfTurn();

      expect(game.field.getEnemyPokemon()).toHaveStatusEffect(StatusEffect.POISON);
    });

    it("does not poison when the roll fails, nor with a non-contact move", async () => {
      game.override.ability(AbilityId.VENOM_HUNT);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const roll = vi.spyOn(player, "randBattleSeedInt").mockReturnValue(30);

      game.move.use(MoveId.TACKLE);
      await game.toNextTurn();
      expect(enemy).not.toHaveFullHp();
      expect(enemy).toHaveStatusEffect(StatusEffect.NONE);

      roll.mockReturnValue(0);
      game.move.use(MoveId.SWIFT);
      await game.toEndOfTurn();
      expect(enemy).toHaveStatusEffect(StatusEffect.NONE);
    });

    it("crits a target it has poisoned from the next hit on, not on the poisoning hit", async () => {
      game.override.ability(AbilityId.VENOM_HUNT);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const enemy = game.field.getEnemyPokemon();
      vi.spyOn(game.field.getPlayerPokemon(), "randBattleSeedInt").mockReturnValue(0);
      const critResult = vi.spyOn(enemy, "getCriticalHitResult");

      game.move.use(MoveId.TACKLE);
      await game.toNextTurn();
      expect(enemy).toHaveStatusEffect(StatusEffect.POISON);
      expect(critResult).toHaveLastReturnedWith(false);

      game.move.use(MoveId.TACKLE);
      await game.toEndOfTurn();
      expect(critResult).toHaveLastReturnedWith(true);
    });

    it("always crits a badly poisoned target unless Battle Armor blocks it", async () => {
      game.override.ability(AbilityId.VENOM_HUNT).enemyStatusEffect(StatusEffect.TOXIC);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const tackle = allMoves[MoveId.TACKLE];

      expect(enemy.getCriticalHitResult(player, tackle)).toBe(true);
      game.override.enemyAbility(AbilityId.BATTLE_ARMOR);
      expect(enemy.getCriticalHitResult(player, tackle)).toBe(false);
      game.override.enemyAbility(AbilityId.BALL_FETCH).ability(AbilityId.BALL_FETCH);
      expect(enemy.getCriticalHitResult(player, tackle)).toBe(false);
    });

    it("does not poison a Poison-type target", async () => {
      game.override.ability(AbilityId.VENOM_HUNT).enemySpecies(SpeciesId.MUK);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      vi.spyOn(game.field.getPlayerPokemon(), "randBattleSeedInt").mockReturnValue(0);

      game.move.use(MoveId.TACKLE);
      await game.toEndOfTurn();

      expect(game.field.getEnemyPokemon()).toHaveStatusEffect(StatusEffect.NONE);
    });

    it("works as a passive", async () => {
      withPassive(AbilityId.VENOM_HUNT);
      game.override.enemyStatusEffect(StatusEffect.POISON);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);

      expect(
        game.field.getEnemyPokemon().getCriticalHitResult(game.field.getPlayerPokemon(), allMoves[MoveId.TACKLE]),
      ).toBe(true);
    });
  });

  describe("Flame Fur", () => {
    it("halves physical damage taken and leaves special damage alone", async () => {
      game.override.ability(AbilityId.FLAME_FUR);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      const physical = damageOf(player, enemy, MoveId.TACKLE);
      const special = damageOf(player, enemy, MoveId.SWIFT);
      game.override.ability(AbilityId.BALL_FETCH);
      const plainPhysical = damageOf(player, enemy, MoveId.TACKLE);
      const plainSpecial = damageOf(player, enemy, MoveId.SWIFT);

      expect(physical / plainPhysical).toBeCloseTo(0.5, 1);
      expect(special).toBe(plainSpecial);
    });

    it("loses the halving while a Mold Breaker attacker's move is in progress", async () => {
      game.override.ability(AbilityId.FLAME_FUR).enemyAbility(AbilityId.MOLD_BREAKER);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const halved = damageOf(player, enemy, MoveId.TACKLE);

      game.move.use(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.TACKLE);
      game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER]);
      await game.phaseInterceptor.to("MoveEffectPhase", false);

      expect(game.scene.arena.ignoreAbilities).toBe(true);
      const ignored = damageOf(player, enemy, MoveId.TACKLE);
      game.override.ability(AbilityId.BALL_FETCH);
      const plain = damageOf(player, enemy, MoveId.TACKLE);

      expect(ignored).toBe(plain);
      expect(halved / plain).toBeCloseTo(0.5, 1);
    });

    it("burns a contact attacker on a successful 30% roll, even a Mold Breaker one", async () => {
      game.override.ability(AbilityId.FLAME_FUR).enemyAbility(AbilityId.MOLD_BREAKER);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      vi.spyOn(game.field.getPlayerPokemon(), "randBattleSeedInt").mockReturnValue(29);

      game.move.use(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.TACKLE);
      await game.toEndOfTurn();

      expect(game.field.getPlayerPokemon()).not.toHaveFullHp();
      expect(game.field.getEnemyPokemon()).toHaveStatusEffect(StatusEffect.BURN);
    });

    it("does not burn after a non-contact move or a failed roll", async () => {
      game.override.ability(AbilityId.FLAME_FUR);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const enemy = game.field.getEnemyPokemon();
      const roll = vi.spyOn(game.field.getPlayerPokemon(), "randBattleSeedInt").mockReturnValue(0);

      game.move.use(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.SWIFT);
      await game.toNextTurn();
      expect(enemy).toHaveStatusEffect(StatusEffect.NONE);

      roll.mockReturnValue(30);
      game.move.use(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.TACKLE);
      await game.toEndOfTurn();
      expect(enemy).toHaveStatusEffect(StatusEffect.NONE);
    });

    it("halves physical damage as a passive", async () => {
      withPassive(AbilityId.FLAME_FUR);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      const halved = damageOf(player, enemy, MoveId.TACKLE);
      game.override.hasPassiveAbility(false);
      const plain = damageOf(player, enemy, MoveId.TACKLE);

      expect(halved / plain).toBeCloseTo(0.5, 1);
    });
  });

  describe("Vocal Sac", () => {
    it("turns sound moves into Water moves with x1.3 power and leaves other moves alone", async () => {
      game.override.ability(AbilityId.VOCAL_SAC);
      await game.classicMode.startBattle(SpeciesId.POLITOED);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(player.getMoveType(allMoves[MoveId.HYPER_VOICE])).toBe(PokemonType.WATER);
      expect(allMoves[MoveId.HYPER_VOICE].calculateBattlePower(player, enemy, true)).toBeCloseTo(90 * 1.3);
      expect(player.getMoveType(allMoves[MoveId.TACKLE])).toBe(PokemonType.NORMAL);
      expect(allMoves[MoveId.TACKLE].calculateBattlePower(player, enemy, true)).toBe(40);
    });

    it("halves sound damage taken, except while a Mold Breaker effect ignores it", async () => {
      game.override.ability(AbilityId.VOCAL_SAC);
      await game.classicMode.startBattle(SpeciesId.POLITOED);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      const halved = damageOf(player, enemy, MoveId.HYPER_VOICE);
      const tackle = damageOf(player, enemy, MoveId.TACKLE);
      game.scene.arena.setIgnoreAbilities(true, enemy.getBattlerIndex());
      const ignored = damageOf(player, enemy, MoveId.HYPER_VOICE);
      game.scene.arena.setIgnoreAbilities(false);
      game.override.ability(AbilityId.BALL_FETCH);
      const plain = damageOf(player, enemy, MoveId.HYPER_VOICE);

      expect(halved / plain).toBeCloseTo(0.5, 1);
      expect(ignored).toBe(plain);
      expect(damageOf(player, enemy, MoveId.TACKLE)).toBe(tackle);
    });

    it("works as a passive", async () => {
      withPassive(AbilityId.VOCAL_SAC);
      await game.classicMode.startBattle(SpeciesId.POLITOED);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(player.getMoveType(allMoves[MoveId.HYPER_VOICE])).toBe(PokemonType.WATER);
      expect(allMoves[MoveId.HYPER_VOICE].calculateBattlePower(player, enemy, true)).toBeCloseTo(90 * 1.3);
    });
  });

  describe("Iron Sand", () => {
    it("sets a sandstorm on entry", async () => {
      game.override.ability(AbilityId.IRON_SAND);
      await game.classicMode.startBattle(SpeciesId.STEELIX);

      expect(game).toHaveWeather(WeatherType.SANDSTORM);
      expect(game.field.getPlayerPokemon()).toHaveAbilityApplied(AbilityId.IRON_SAND);
    });

    it("cuts super-effective damage to x0.75, not neutral damage, and Mold Breaker ignores it", async () => {
      game.override.ability(AbilityId.IRON_SAND);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      const reduced = damageOf(player, enemy, MoveId.BRICK_BREAK);
      const neutral = damageOf(player, enemy, MoveId.TACKLE);
      game.scene.arena.setIgnoreAbilities(true, enemy.getBattlerIndex());
      const ignored = damageOf(player, enemy, MoveId.BRICK_BREAK);
      game.scene.arena.setIgnoreAbilities(false);
      game.override.ability(AbilityId.BALL_FETCH);
      const plain = damageOf(player, enemy, MoveId.BRICK_BREAK);

      expect(reduced / plain).toBeCloseTo(0.75, 1);
      expect(reduced).toBeLessThan(plain);
      expect(ignored).toBe(plain);
      expect(damageOf(player, enemy, MoveId.TACKLE)).toBe(neutral);
    });

    it("works as a passive", async () => {
      withPassive(AbilityId.IRON_SAND);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(game).toHaveWeather(WeatherType.SANDSTORM);
      const reduced = damageOf(player, enemy, MoveId.BRICK_BREAK);
      game.override.hasPassiveAbility(false);
      expect(reduced / damageOf(player, enemy, MoveId.BRICK_BREAK)).toBeCloseTo(0.75, 1);
    });
  });

  describe("Dream Weaver", () => {
    it("multiplies accuracy by 1.3, except for Dark Void and one-hit KO moves", async () => {
      game.override.ability(AbilityId.DREAM_WEAVER);
      await game.classicMode.startBattle(SpeciesId.HYPNO);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(player.getAccuracyMultiplier(enemy, allMoves[MoveId.HYPNOSIS])).toBeCloseTo(1.3);
      expect(player.getAccuracyMultiplier(enemy, allMoves[MoveId.DARK_VOID])).toBe(1);
      expect(player.getAccuracyMultiplier(enemy, allMoves[MoveId.SHEER_COLD])).toBe(1);
      game.override.ability(AbilityId.BALL_FETCH);
      expect(player.getAccuracyMultiplier(enemy, allMoves[MoveId.HYPNOSIS])).toBe(1);
    });

    it("lands Hypnosis on a roll of 77 (78% accuracy), which misses without the ability", async () => {
      game.override.ability(AbilityId.DREAM_WEAVER).moveset([MoveId.HYPNOSIS]);
      await game.classicMode.startBattle(SpeciesId.HYPNO);
      vi.spyOn(game.field.getPlayerPokemon(), "randBattleSeedInt").mockReturnValue(77);

      game.move.use(MoveId.HYPNOSIS);
      await game.toEndOfTurn();

      expect(game.field.getEnemyPokemon()).toHaveStatusEffect(StatusEffect.SLEEP);
    });

    it("misses Hypnosis on a roll of 77 without the ability", async () => {
      game.override.moveset([MoveId.HYPNOSIS]);
      await game.classicMode.startBattle(SpeciesId.HYPNO);
      vi.spyOn(game.field.getPlayerPokemon(), "randBattleSeedInt").mockReturnValue(77);

      game.move.use(MoveId.HYPNOSIS);
      await game.toEndOfTurn();

      expect(game.field.getEnemyPokemon()).toHaveStatusEffect(StatusEffect.NONE);
    });

    it("takes 1/8 max HP from a sleeping foe at the end of each turn", async () => {
      game.override.ability(AbilityId.DREAM_WEAVER).enemyStatusEffect(StatusEffect.SLEEP);
      await game.classicMode.startBattle(SpeciesId.HYPNO);
      const enemy = game.field.getEnemyPokemon();

      game.move.use(MoveId.SPLASH);
      await game.toNextTurn();
      expect(enemy).toHaveTakenDamage(enemy.getMaxHp() / 8);

      game.move.use(MoveId.SPLASH);
      await game.toNextTurn();
      expect(enemy).toHaveTakenDamage(2 * toDmgValue(enemy.getMaxHp() / 8), false);
    });

    it("does not hurt an awake foe or a sleeping foe with Magic Guard", async () => {
      game.override.ability(AbilityId.DREAM_WEAVER);
      await game.classicMode.startBattle(SpeciesId.HYPNO);
      const enemy = game.field.getEnemyPokemon();

      game.move.use(MoveId.SPLASH);
      await game.toNextTurn();
      expect(enemy).toHaveFullHp();

      enemy.doSetStatus(StatusEffect.SLEEP, 5);
      game.override.enemyAbility(AbilityId.MAGIC_GUARD);
      game.move.use(MoveId.SPLASH);
      await game.toNextTurn();
      expect(enemy).toHaveStatusEffect(StatusEffect.SLEEP);
      expect(enemy).toHaveFullHp();
    });

    it("checks Magic Guard on each sleeping foe in a double battle", async () => {
      game.override.battleStyle("double").enemyStatusEffect(StatusEffect.SLEEP);
      await game.classicMode.startBattle(SpeciesId.HYPNO, SpeciesId.SNORLAX);
      game.field.getPlayerPokemon().summonData.ability = AbilityId.DREAM_WEAVER;
      const [guarded, open] = game.scene.getEnemyField();
      guarded.summonData.ability = AbilityId.MAGIC_GUARD;

      game.move.select(MoveId.SPLASH);
      game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
      await game.toNextTurn();

      expect(open).toHaveStatusEffect(StatusEffect.SLEEP);
      expect(open).toHaveTakenDamage(open.getMaxHp() / 8);
      expect(guarded).toHaveStatusEffect(StatusEffect.SLEEP);
      expect(guarded).toHaveFullHp();
    });

    it("applies the accuracy boost once when the regular ability is Compound Eyes", async () => {
      withPassive(AbilityId.DREAM_WEAVER, AbilityId.COMPOUND_EYES);
      await game.classicMode.startBattle(SpeciesId.HYPNO);
      const player = game.field.getPlayerPokemon();

      expect(player.getAccuracyMultiplier(game.field.getEnemyPokemon(), allMoves[MoveId.HYPNOSIS])).toBeCloseTo(1.3);
    });

    it("hurts a sleeping foe once per turn when the regular ability is Bad Dreams", async () => {
      withPassive(AbilityId.DREAM_WEAVER, AbilityId.BAD_DREAMS);
      game.override.enemyStatusEffect(StatusEffect.SLEEP);
      await game.classicMode.startBattle(SpeciesId.HYPNO);
      const enemy = game.field.getEnemyPokemon();

      game.move.use(MoveId.SPLASH);
      await game.toNextTurn();

      expect(enemy).toHaveTakenDamage(enemy.getMaxHp() / 8);
    });

    it("works as a passive", async () => {
      withPassive(AbilityId.DREAM_WEAVER);
      game.override.enemyStatusEffect(StatusEffect.SLEEP);
      await game.classicMode.startBattle(SpeciesId.HYPNO);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(player.getAccuracyMultiplier(enemy, allMoves[MoveId.HYPNOSIS])).toBeCloseTo(1.3);
      game.move.use(MoveId.SPLASH);
      await game.toNextTurn();
      expect(enemy).toHaveTakenDamage(enemy.getMaxHp() / 8);
    });
  });

  describe("Solar Pulse", () => {
    it("sets sun on entry and multiplies both Atk and Sp. Atk by 4/3 in it, with no recoil", async () => {
      game.override.ability(AbilityId.SOLAR_PULSE);
      await game.classicMode.startBattle(SpeciesId.EXEGGUTOR);
      const player = game.field.getPlayerPokemon();

      expect(game).toHaveWeather(WeatherType.SUNNY);
      expect(player.getEffectiveStat(Stat.ATK)).toBe(Math.floor((player.stats[Stat.ATK] * 4) / 3));
      expect(player.getEffectiveStat(Stat.SPATK)).toBe(Math.floor((player.stats[Stat.SPATK] * 4) / 3));

      game.move.use(MoveId.SPLASH);
      await game.toNextTurn();
      expect(player).toHaveFullHp();
    });

    it("gives no boost under Air Lock", async () => {
      game.override.ability(AbilityId.SOLAR_PULSE).enemyAbility(AbilityId.AIR_LOCK);
      await game.classicMode.startBattle(SpeciesId.EXEGGUTOR);
      const player = game.field.getPlayerPokemon();

      expect(player.getEffectiveStat(Stat.ATK)).toBe(player.stats[Stat.ATK]);
      expect(player.getEffectiveStat(Stat.SPATK)).toBe(player.stats[Stat.SPATK]);
    });

    it("loses the boost once the sun is replaced", async () => {
      game.override.ability(AbilityId.SOLAR_PULSE).enemyMoveset(MoveId.RAIN_DANCE);
      await game.classicMode.startBattle(SpeciesId.EXEGGUTOR);
      const player = game.field.getPlayerPokemon();

      game.move.use(MoveId.SPLASH);
      await game.toNextTurn();

      expect(game).toHaveWeather(WeatherType.RAIN);
      expect(player.getEffectiveStat(Stat.ATK)).toBe(player.stats[Stat.ATK]);
      expect(player.getEffectiveStat(Stat.SPATK)).toBe(player.stats[Stat.SPATK]);
    });

    it("works as a passive", async () => {
      withPassive(AbilityId.SOLAR_PULSE);
      await game.classicMode.startBattle(SpeciesId.EXEGGUTOR);
      const player = game.field.getPlayerPokemon();

      expect(game).toHaveWeather(WeatherType.SUNNY);
      expect(player.getEffectiveStat(Stat.ATK)).toBe(Math.floor((player.stats[Stat.ATK] * 4) / 3));
      expect(player.getEffectiveStat(Stat.SPATK)).toBe(Math.floor((player.stats[Stat.SPATK] * 4) / 3));
    });
  });

  describe("Cold Snap", () => {
    it("sets snow on entry and doubles Speed in it", async () => {
      game.override.ability(AbilityId.COLD_SNAP);
      await game.classicMode.startBattle(SpeciesId.GLACEON);
      const player = game.field.getPlayerPokemon();

      expect(game).toHaveWeather(WeatherType.SNOW);
      expect(player.getEffectiveStat(Stat.SPD)).toBe(player.stats[Stat.SPD] * 2);
    });

    it("gives no Speed boost under Air Lock or once the snow is gone", async () => {
      game.override.ability(AbilityId.COLD_SNAP).enemyAbility(AbilityId.AIR_LOCK);
      await game.classicMode.startBattle(SpeciesId.GLACEON);
      const player = game.field.getPlayerPokemon();

      expect(player.getEffectiveStat(Stat.SPD)).toBe(player.stats[Stat.SPD]);
      game.override.enemyAbility(AbilityId.BALL_FETCH);
      expect(player.getEffectiveStat(Stat.SPD)).toBe(player.stats[Stat.SPD] * 2);
      game.scene.arena.trySetWeather(WeatherType.NONE);
      expect(player.getEffectiveStat(Stat.SPD)).toBe(player.stats[Stat.SPD]);
    });

    it("works as a passive", async () => {
      withPassive(AbilityId.COLD_SNAP);
      await game.classicMode.startBattle(SpeciesId.GLACEON);
      const player = game.field.getPlayerPokemon();

      expect(game).toHaveWeather(WeatherType.SNOW);
      expect(player.getEffectiveStat(Stat.SPD)).toBe(player.stats[Stat.SPD] * 2);
    });
  });

  describe("Iron Legs", () => {
    it("boosts kicking moves by 20% and leaves other moves alone", async () => {
      game.override.ability(AbilityId.IRON_LEGS);
      await game.classicMode.startBattle(SpeciesId.HITMONLEE);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(allMoves[MoveId.HIGH_JUMP_KICK].calculateBattlePower(player, enemy, true)).toBe(130 * 1.2);
      expect(allMoves[MoveId.TACKLE].calculateBattlePower(player, enemy, true)).toBe(40);
    });

    it("lands High Jump Kick and Tackle on a Ghost type", async () => {
      game.override.ability(AbilityId.IRON_LEGS).enemySpecies(SpeciesId.DUSKULL).moveset([MoveId.HIGH_JUMP_KICK]);
      vi.spyOn(allMoves[MoveId.HIGH_JUMP_KICK], "accuracy", "get").mockReturnValue(100);
      await game.classicMode.startBattle(SpeciesId.HITMONLEE);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(enemy.getMoveEffectiveness(player, allMoves[MoveId.TACKLE])).toBe(1);
      expect(enemy.getMoveEffectiveness(player, allMoves[MoveId.HIGH_JUMP_KICK])).toBe(1);

      game.move.use(MoveId.HIGH_JUMP_KICK);
      await game.toEndOfTurn();

      expect(enemy.hp).toBeLessThan(enemy.getMaxHp());
      expect(player).toHaveFullHp();
    });

    it("leaves Ghost types immune without the ability", async () => {
      game.override.enemySpecies(SpeciesId.DUSKULL);
      await game.classicMode.startBattle(SpeciesId.HITMONLEE);

      const enemy = game.field.getEnemyPokemon();
      expect(enemy.getMoveEffectiveness(game.field.getPlayerPokemon(), allMoves[MoveId.HIGH_JUMP_KICK])).toBe(0);
    });

    it("blocks Intimidate", async () => {
      game.override.ability(AbilityId.IRON_LEGS).enemyAbility(AbilityId.INTIMIDATE);
      await game.classicMode.startBattle(SpeciesId.HITMONLEE);
      const player = game.field.getPlayerPokemon();

      expect(player).toHaveStatStage(Stat.ATK, 0);
      expect(player).toHaveAbilityApplied(AbilityId.IRON_LEGS);
    });

    it("applies the kick boost once when the regular ability is Footwork", async () => {
      withPassive(AbilityId.IRON_LEGS, AbilityId.FOOTWORK);
      await game.classicMode.startBattle(SpeciesId.HITMONLEE);
      const player = game.field.getPlayerPokemon();

      expect(allMoves[MoveId.HIGH_JUMP_KICK].calculateBattlePower(player, game.field.getEnemyPokemon(), true)).toBe(
        130 * 1.2,
      );
    });

    it("lets Scrappy block Intimidate alone when the regular ability is Scrappy", async () => {
      withPassive(AbilityId.IRON_LEGS, AbilityId.SCRAPPY);
      game.override.enemyAbility(AbilityId.INTIMIDATE);
      await game.classicMode.startBattle(SpeciesId.HITMONLEE);
      const player = game.field.getPlayerPokemon();

      expect(player).toHaveStatStage(Stat.ATK, 0);
      expect(player).toHaveAbilityApplied(AbilityId.SCRAPPY);
      expect(player).not.toHaveAbilityApplied(AbilityId.IRON_LEGS);
      expect(allMoves[MoveId.HIGH_JUMP_KICK].calculateBattlePower(player, game.field.getEnemyPokemon(), true)).toBe(
        130 * 1.2,
      );
    });

    it("works as a passive", async () => {
      withPassive(AbilityId.IRON_LEGS);
      game.override.enemySpecies(SpeciesId.DUSKULL).enemyAbility(AbilityId.INTIMIDATE);
      await game.classicMode.startBattle(SpeciesId.HITMONLEE);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(player).toHaveStatStage(Stat.ATK, 0);
      expect(enemy.getMoveEffectiveness(player, allMoves[MoveId.HIGH_JUMP_KICK])).toBe(1);
      expect(allMoves[MoveId.HIGH_JUMP_KICK].calculateBattlePower(player, enemy, true)).toBe(130 * 1.2);
    });
  });

  describe("Gas Leak", () => {
    it("lays Toxic Spikes on the attacker's side after each physical hit, up to 2 layers", async () => {
      game.override.ability(AbilityId.GAS_LEAK);
      await game.classicMode.startBattle(SpeciesId.WEEZING);

      for (const layers of [1, 2, 2]) {
        game.move.use(MoveId.SPLASH);
        await game.move.forceEnemyMove(MoveId.TACKLE);
        await game.toNextTurn();
        expect(game).toHaveArenaTag({ tagType: ArenaTagType.TOXIC_SPIKES, side: ArenaTagSide.ENEMY, layers });
      }
      expect(game).not.toHaveArenaTag(ArenaTagType.TOXIC_SPIKES, ArenaTagSide.PLAYER);
    });

    it("lays nothing after a special hit", async () => {
      game.override.ability(AbilityId.GAS_LEAK);
      await game.classicMode.startBattle(SpeciesId.WEEZING);

      game.move.use(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.SWIFT);
      await game.toEndOfTurn();

      expect(game.field.getPlayerPokemon()).not.toHaveFullHp();
      expect(game).not.toHaveArenaTag(ArenaTagType.TOXIC_SPIKES);
    });

    it("deals 1/4 of the attacker's max HP when a contact move knocks it out", async () => {
      game.override.enemyAbility(AbilityId.GAS_LEAK).enemyLevel(1);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.move.use(MoveId.TACKLE);
      await game.toEndOfTurn();

      expect(enemy).toHaveFainted();
      expect(player).toHaveTakenDamage(player.getMaxHp() / 4);
    });

    it("deals nothing with Damp on the field", async () => {
      game.override.enemyAbility(AbilityId.GAS_LEAK).enemyLevel(1).ability(AbilityId.DAMP);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);

      game.move.use(MoveId.TACKLE);
      await game.toEndOfTurn();

      expect(game.field.getPlayerPokemon()).toHaveFullHp();
    });

    it("deals nothing when a non-contact move knocks it out", async () => {
      game.override.enemyAbility(AbilityId.GAS_LEAK).enemyLevel(1);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);

      game.move.use(MoveId.SWIFT);
      await game.toEndOfTurn();

      expect(game.field.getPlayerPokemon()).toHaveFullHp();
    });

    it("works as a passive", async () => {
      withPassive(AbilityId.GAS_LEAK);
      await game.classicMode.startBattle(SpeciesId.WEEZING);

      game.move.use(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.TACKLE);
      await game.toEndOfTurn();

      expect(game).toHaveArenaTag({ tagType: ArenaTagType.TOXIC_SPIKES, side: ArenaTagSide.ENEMY, layers: 1 });
    });
  });

  describe("Farsight", () => {
    it("multiplies accuracy by 1.3 (not one-hit KO moves) and doubles not very effective damage", async () => {
      game.override.ability(AbilityId.FARSIGHT).enemySpecies(SpeciesId.GEODUDE);
      await game.classicMode.startBattle(SpeciesId.NOCTOWL);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(player.getAccuracyMultiplier(enemy, allMoves[MoveId.HYPNOSIS])).toBeCloseTo(1.3);
      expect(player.getAccuracyMultiplier(enemy, allMoves[MoveId.SHEER_COLD])).toBe(1);
      const resisted = damageOf(enemy, player, MoveId.TACKLE);
      const neutral = damageOf(enemy, player, MoveId.EXTRASENSORY);
      game.override.ability(AbilityId.BALL_FETCH);

      expect(resisted / damageOf(enemy, player, MoveId.TACKLE)).toBeCloseTo(2, 1);
      expect(damageOf(enemy, player, MoveId.EXTRASENSORY)).toBe(neutral);
      expect(player.getAccuracyMultiplier(enemy, allMoves[MoveId.HYPNOSIS])).toBe(1);
    });

    it("doubles (not quadruples) not very effective damage on a Tinted Lens Noctowl", async () => {
      withPassive(AbilityId.FARSIGHT, AbilityId.TINTED_LENS);
      game.override.enemySpecies(SpeciesId.GEODUDE);
      await game.classicMode.startBattle(SpeciesId.NOCTOWL);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      const both = damageOf(enemy, player, MoveId.TACKLE);
      expect(player.getAccuracyMultiplier(enemy, allMoves[MoveId.HYPNOSIS])).toBeCloseTo(1.3);
      game.override.hasPassiveAbility(false);
      const tintedLensOnly = damageOf(enemy, player, MoveId.TACKLE);
      game.override.ability(AbilityId.BALL_FETCH);
      const plain = damageOf(enemy, player, MoveId.TACKLE);

      expect(both).toBe(tintedLensOnly);
      expect(both / plain).toBeCloseTo(2, 1);
    });

    it("applies the accuracy boost once when the regular ability is Compound Eyes", async () => {
      withPassive(AbilityId.FARSIGHT, AbilityId.COMPOUND_EYES);
      game.override.enemySpecies(SpeciesId.GEODUDE);
      await game.classicMode.startBattle(SpeciesId.NOCTOWL);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(player.getAccuracyMultiplier(enemy, allMoves[MoveId.HYPNOSIS])).toBeCloseTo(1.3);
      const boosted = damageOf(enemy, player, MoveId.TACKLE);
      game.override.hasPassiveAbility(false);
      expect(boosted / damageOf(enemy, player, MoveId.TACKLE)).toBeCloseTo(2, 1);
    });

    it("works as a passive", async () => {
      withPassive(AbilityId.FARSIGHT);
      game.override.enemySpecies(SpeciesId.GEODUDE);
      await game.classicMode.startBattle(SpeciesId.NOCTOWL);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(player.getAccuracyMultiplier(enemy, allMoves[MoveId.HYPNOSIS])).toBeCloseTo(1.3);
      const boosted = damageOf(enemy, player, MoveId.TACKLE);
      game.override.hasPassiveAbility(false);
      expect(boosted / damageOf(enemy, player, MoveId.TACKLE)).toBeCloseTo(2, 1);
    });
  });

  describe("Thorn Armor", () => {
    it("hurts a contact attacker by 1/8 of its max HP and raises Def by 1", async () => {
      game.override.ability(AbilityId.THORN_ARMOR);
      await game.classicMode.startBattle(SpeciesId.CACTURNE);
      const enemy = game.field.getEnemyPokemon();

      game.move.use(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.TACKLE);
      await game.toEndOfTurn();

      expect(enemy).toHaveTakenDamage(enemy.getMaxHp() / 8);
      expect(game.field.getPlayerPokemon()).toHaveStatStage(Stat.DEF, 1);
    });

    it("raises Def but deals no damage after a non-contact hit, and ignores status moves", async () => {
      game.override.ability(AbilityId.THORN_ARMOR);
      await game.classicMode.startBattle(SpeciesId.CACTURNE);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.move.use(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.SWIFT);
      await game.toNextTurn();
      expect(enemy).toHaveFullHp();
      expect(player).toHaveStatStage(Stat.DEF, 1);

      game.move.use(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.GROWL);
      await game.toEndOfTurn();
      expect(player).toHaveStatStage(Stat.ATK, -1);
      expect(player).toHaveStatStage(Stat.DEF, 1);
    });

    it("triggers on every hit of a multi-hit contact move", async () => {
      game.override.ability(AbilityId.THORN_ARMOR);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const enemy = game.field.getEnemyPokemon();

      game.move.use(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.DOUBLE_KICK);
      await game.toEndOfTurn();

      expect(enemy).toHaveTakenDamage(2 * toDmgValue(enemy.getMaxHp() / 8), false);
      expect(game.field.getPlayerPokemon()).toHaveStatStage(Stat.DEF, 2);
    });

    it("still hurts the attacker when the holder is knocked out", async () => {
      game.override.enemyAbility(AbilityId.THORN_ARMOR).enemyLevel(1);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.move.use(MoveId.TACKLE);
      await game.toEndOfTurn();

      expect(enemy).toHaveFainted();
      expect(player).toHaveTakenDamage(player.getMaxHp() / 8);
    });

    it("stacks its contact damage with a regular Rough Skin", async () => {
      withPassive(AbilityId.THORN_ARMOR, AbilityId.ROUGH_SKIN);
      await game.classicMode.startBattle(SpeciesId.CACTURNE);
      const enemy = game.field.getEnemyPokemon();

      game.move.use(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.TACKLE);
      await game.toEndOfTurn();

      expect(enemy).toHaveTakenDamage(2 * toDmgValue(enemy.getMaxHp() / 8), false);
      expect(game.field.getPlayerPokemon()).toHaveStatStage(Stat.DEF, 1);
    });

    it("works as a passive", async () => {
      withPassive(AbilityId.THORN_ARMOR);
      await game.classicMode.startBattle(SpeciesId.CACTURNE);
      const enemy = game.field.getEnemyPokemon();

      game.move.use(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.TACKLE);
      await game.toEndOfTurn();

      expect(enemy).toHaveTakenDamage(enemy.getMaxHp() / 8);
      expect(game.field.getPlayerPokemon()).toHaveStatStage(Stat.DEF, 1);
    });
  });
});
