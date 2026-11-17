// Local fork (2026-11-14): passive rebalance. Tests for batch A of the new custom abilities
// (src/data/abilities/custom-abilities-1114-a.ts). Every ability here is a renamed copy of an existing one, so each
// block checks the copied effect, the base's ignorable / not-ignorable flag where it has one, and that it also works
// as a passive.
import { allAbilities, allMoves } from "#data/data-lists";
import { getWeatherMultiplierForMove } from "#data/weather";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import { Arena } from "#field/arena";
import type { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Custom abilities 2026-11-14 batch A", () => {
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
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH, MoveId.TACKLE, MoveId.ICE_BEAM, MoveId.FLAMETHROWER]);
  });

  /** Simulated damage `target` takes from `source`'s `move` (no random roll, no crit). */
  function damage(target: Pokemon, source: Pokemon, move: MoveId): number {
    return target.getAttackDamage({ source, move: allMoves[move], simulated: true }).damage;
  }

  /** Base power of `move` used by `user` on `target`, after ability and item boosts. */
  function power(move: MoveId, user: Pokemon, target: Pokemon): number {
    return allMoves[move].calculateBattlePower(user, target, true);
  }

  describe("Frost Fur (Ice Scales clone)", () => {
    it("halves damage from special moves and leaves physical moves alone", async () => {
      await game.classicMode.startBattle(SpeciesId.ALOLA_NINETALES);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      const plainSpecial = damage(player, enemy, MoveId.FLAMETHROWER);
      const plainPhysical = damage(player, enemy, MoveId.TACKLE);
      game.override.ability(AbilityId.FROST_FUR);
      const furSpecial = damage(player, enemy, MoveId.FLAMETHROWER);
      const furPhysical = damage(player, enemy, MoveId.TACKLE);

      expect(plainSpecial).toBeGreaterThan(0);
      expect(furSpecial / plainSpecial).toBeCloseTo(0.5, 1);
      expect(furPhysical).toBe(plainPhysical);
    });

    it("is ignored while the attacker's Mold Breaker is active", async () => {
      game.override.ability(AbilityId.FROST_FUR);
      await game.classicMode.startBattle(SpeciesId.ALOLA_NINETALES);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      const halved = damage(player, enemy, MoveId.FLAMETHROWER);
      game.scene.arena.setIgnoreAbilities(true, BattlerIndex.ENEMY);
      const ignored = damage(player, enemy, MoveId.FLAMETHROWER);
      game.scene.arena.setIgnoreAbilities(false);

      expect(ignored / halved).toBeCloseTo(2, 1);
    });

    it("works as a passive", async () => {
      game.override.passiveAbility(AbilityId.FROST_FUR);
      await game.classicMode.startBattle(SpeciesId.ALOLA_NINETALES);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      const withPassive = damage(player, enemy, MoveId.FLAMETHROWER);
      game.override.hasPassiveAbility(false);
      const without = damage(player, enemy, MoveId.FLAMETHROWER);

      expect(withPassive / without).toBeCloseTo(0.5, 1);
    });
  });

  describe("Cat Burglar (Magician clone)", () => {
    it("steals the target's held item after hitting it", async () => {
      game.override.ability(AbilityId.CAT_BURGLAR).enemyHeldItems([{ name: "LEFTOVERS" }]);
      await game.classicMode.startBattle(SpeciesId.MEOWTH);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      expect(enemy.getHeldItems()).toHaveLength(1);
      expect(player.getHeldItems()).toHaveLength(0);

      game.move.select(MoveId.TACKLE);
      await game.phaseInterceptor.to("BerryPhase");

      expect(enemy.getHeldItems()).toHaveLength(0);
      expect(player.getHeldItems()).toHaveLength(1);
    });

    it("steals nothing with a status move", async () => {
      game.override.ability(AbilityId.CAT_BURGLAR).enemyHeldItems([{ name: "LEFTOVERS" }]);
      await game.classicMode.startBattle(SpeciesId.MEOWTH);

      game.move.select(MoveId.SPLASH);
      await game.phaseInterceptor.to("BerryPhase");

      expect(game.field.getEnemyPokemon().getHeldItems()).toHaveLength(1);
      expect(game.field.getPlayerPokemon().getHeldItems()).toHaveLength(0);
    });

    it("works as a passive", async () => {
      game.override.passiveAbility(AbilityId.CAT_BURGLAR).enemyHeldItems([{ name: "LEFTOVERS" }]);
      await game.classicMode.startBattle(SpeciesId.MEOWTH);

      game.move.select(MoveId.TACKLE);
      await game.phaseInterceptor.to("BerryPhase");

      expect(game.field.getEnemyPokemon().getHeldItems()).toHaveLength(0);
      expect(game.field.getPlayerPokemon().getHeldItems()).toHaveLength(1);
    });
  });

  describe("Sunbathe (Mega Sol clone)", () => {
    beforeEach(() => {
      game.override.weather(WeatherType.RAIN).moveset([MoveId.SOLAR_BEAM, MoveId.SOLAR_BLADE, MoveId.SPLASH]);
    });

    it.each([
      { name: "Solar Beam", move: MoveId.SOLAR_BEAM },
      { name: "Solar Blade", move: MoveId.SOLAR_BLADE },
    ])("uses $name in rain without charging, and the real weather stays rain", async ({ move }) => {
      game.override.ability(AbilityId.SUNBATHE);
      await game.classicMode.startBattle(SpeciesId.LEAFEON);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.move.select(move);
      await game.phaseInterceptor.to("TurnEndPhase");

      expect(player).not.toHaveBattlerTag(BattlerTagType.CHARGING);
      expect(player.getLastXMoves(1)[0].result).toBe(MoveResult.SUCCESS);
      expect(enemy).not.toHaveFullHp();
      expect(game).toHaveWeather(WeatherType.RAIN);
    });

    it("charges Solar Beam in rain without the ability", async () => {
      await game.classicMode.startBattle(SpeciesId.LEAFEON);

      game.move.select(MoveId.SOLAR_BEAM);
      await game.phaseInterceptor.to("TurnEndPhase");

      expect(game.field.getPlayerPokemon()).toHaveBattlerTag(BattlerTagType.CHARGING);
      expect(game.field.getEnemyPokemon()).toHaveFullHp();
    });

    it("treats its own moves as in sun: Water x0.5, Fire x1.5", async () => {
      game.override.ability(AbilityId.SUNBATHE);
      await game.classicMode.startBattle(SpeciesId.LEAFEON);
      const player = game.field.getPlayerPokemon();

      expect(getWeatherMultiplierForMove(player, allMoves[MoveId.WATER_GUN])).toBe(0.5);
      expect(getWeatherMultiplierForMove(player, allMoves[MoveId.EMBER])).toBe(1.5);
    });

    it("does not change the foe's moves", async () => {
      game.override.ability(AbilityId.SUNBATHE);
      await game.classicMode.startBattle(SpeciesId.LEAFEON);
      const enemy = game.field.getEnemyPokemon();

      expect(getWeatherMultiplierForMove(enemy, allMoves[MoveId.WATER_GUN])).toBe(1.5);
    });

    it("does not activate Chlorophyll, since the real weather is unchanged", async () => {
      game.override.ability(AbilityId.CHLOROPHYLL).passiveAbility(AbilityId.SUNBATHE);
      await game.classicMode.startBattle(SpeciesId.LEAFEON);
      const player = game.field.getPlayerPokemon();

      expect(player.getEffectiveStat(Stat.SPD)).toBe(player.getStat(Stat.SPD));
    });

    it("works as a passive", async () => {
      game.override.passiveAbility(AbilityId.SUNBATHE);
      await game.classicMode.startBattle(SpeciesId.LEAFEON);
      const player = game.field.getPlayerPokemon();

      expect(getWeatherMultiplierForMove(player, allMoves[MoveId.WATER_GUN])).toBe(0.5);

      game.move.select(MoveId.SOLAR_BEAM);
      await game.phaseInterceptor.to("TurnEndPhase");

      expect(player).not.toHaveBattlerTag(BattlerTagType.CHARGING);
      expect(game.field.getEnemyPokemon()).not.toHaveFullHp();
    });
  });

  describe("Shock Absorber (Shadow Shield clone)", () => {
    it("halves damage at full HP only", async () => {
      await game.classicMode.startBattle(SpeciesId.WOBBUFFET);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      const plain = damage(player, enemy, MoveId.TACKLE);
      game.override.ability(AbilityId.SHOCK_ABSORBER);
      const shielded = damage(player, enemy, MoveId.TACKLE);
      player.hp = player.getMaxHp() - 1;
      const notFull = damage(player, enemy, MoveId.TACKLE);

      expect(plain).toBeGreaterThan(0);
      expect(shielded / plain).toBeCloseTo(0.5, 1);
      expect(notFull).toBe(plain);
    });

    it("is not ignored by the attacker's Mold Breaker", async () => {
      game.override.ability(AbilityId.SHOCK_ABSORBER);
      await game.classicMode.startBattle(SpeciesId.WOBBUFFET);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      const shielded = damage(player, enemy, MoveId.TACKLE);
      game.scene.arena.setIgnoreAbilities(true, BattlerIndex.ENEMY);
      const underMoldBreaker = damage(player, enemy, MoveId.TACKLE);
      game.scene.arena.setIgnoreAbilities(false);

      expect(underMoldBreaker).toBe(shielded);
    });

    it("keeps working when a Mold Breaker foe really attacks", async () => {
      game.override.ability(AbilityId.SHOCK_ABSORBER).enemyAbility(AbilityId.MOLD_BREAKER).enemyMoveset(MoveId.TACKLE);
      await game.classicMode.startBattle(SpeciesId.WOBBUFFET);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const multiplier = vi.spyOn(
        allAbilities[AbilityId.SHOCK_ABSORBER].getAttrs("ReceivedMoveDamageMultiplierAbAttr")[0],
        "apply",
      );

      game.move.select(MoveId.SPLASH);
      await game.phaseInterceptor.to("BerryPhase");

      expect(player).not.toHaveFullHp();
      expect(enemy.hasAbility(AbilityId.MOLD_BREAKER)).toBe(true);
      expect(multiplier).toHaveBeenCalled();
    });

    it("works as a passive", async () => {
      game.override.passiveAbility(AbilityId.SHOCK_ABSORBER);
      await game.classicMode.startBattle(SpeciesId.WOBBUFFET);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      const withPassive = damage(player, enemy, MoveId.TACKLE);
      game.override.hasPassiveAbility(false);
      const without = damage(player, enemy, MoveId.TACKLE);

      expect(withPassive / without).toBeCloseTo(0.5, 1);
    });
  });

  describe("Beam Cannon (Hilt Cannon clone)", () => {
    it("multiplies pulse moves and moves ending in BEAM by 1.5, and nothing else", async () => {
      game.override.ability(AbilityId.BEAM_CANNON);
      await game.classicMode.startBattle(SpeciesId.OCTILLERY);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(power(MoveId.ICE_BEAM, player, enemy)).toBe(90 * 1.5);
      expect(power(MoveId.BUBBLE_BEAM, player, enemy)).toBe(65 * 1.5);
      expect(power(MoveId.HYPER_BEAM, player, enemy)).toBe(150 * 1.5);
      expect(power(MoveId.WATER_PULSE, player, enemy)).toBe(60 * 1.5);
      expect(power(MoveId.AURA_SPHERE, player, enemy)).toBe(80 * 1.5);
      // Octazooka is a ball / bomb move, not a pulse or beam move
      expect(power(MoveId.OCTAZOOKA, player, enemy)).toBe(65);
      expect(power(MoveId.TACKLE, player, enemy)).toBe(40);
    });

    it("does not boost Heal Pulse's healing", async () => {
      game.override.ability(AbilityId.BEAM_CANNON).enemySpecies(SpeciesId.CHANSEY);
      await game.classicMode.startBattle(SpeciesId.OCTILLERY);
      const enemy = game.field.getEnemyPokemon();
      enemy.hp = 1;

      game.move.use(MoveId.HEAL_PULSE);
      await game.toEndOfTurn();

      expect(enemy).toHaveHp(enemy.getMaxHp() / 2 + 1, { rounding: "half up" });
    });

    it("works as a passive", async () => {
      game.override.passiveAbility(AbilityId.BEAM_CANNON);
      await game.classicMode.startBattle(SpeciesId.OCTILLERY);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(power(MoveId.ICE_BEAM, player, enemy)).toBe(90 * 1.5);
      expect(power(MoveId.DARK_PULSE, player, enemy)).toBe(80 * 1.5);
    });
  });

  describe("Glow Veil (Polar Light clone)", () => {
    it("puts Aurora Veil on the user's side for 5 turns on entry, whatever the weather", async () => {
      game.override.ability(AbilityId.GLOW_VEIL);
      await game.classicMode.startBattle(SpeciesId.VOLBEAT);

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
      game.override.ability(AbilityId.GLOW_VEIL);
      await game.classicMode.startBattle(SpeciesId.VOLBEAT, SpeciesId.ILLUMISE);

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(game.scene.arena.getTagOnSide(ArenaTagType.AURORA_VEIL, ArenaTagSide.PLAYER)?.turnCount).toBe(3);

      game.doSwitchPokemon(1);
      await game.toNextTurn();

      expect(game.field.getPlayerPokemon().species.speciesId).toBe(SpeciesId.ILLUMISE);
      expect(game.scene.arena.getTagOnSide(ArenaTagType.AURORA_VEIL, ArenaTagSide.PLAYER)?.turnCount).toBe(2);
    });

    it("sets the veil only once when the holder also has Polar Light", async () => {
      const addTag = vi.spyOn(Arena.prototype, "addTag");
      game.override.ability(AbilityId.POLAR_LIGHT).passiveAbility(AbilityId.GLOW_VEIL);
      await game.classicMode.startBattle(SpeciesId.VOLBEAT);

      const veilAdds = addTag.mock.calls.filter(([tagType]) => tagType === ArenaTagType.AURORA_VEIL);
      expect(veilAdds).toHaveLength(1);
      expect(game.scene.arena.getTagOnSide(ArenaTagType.AURORA_VEIL, ArenaTagSide.PLAYER)?.turnCount).toBe(5);
    });

    it("works as a passive", async () => {
      game.override.passiveAbility(AbilityId.GLOW_VEIL);
      await game.classicMode.startBattle(SpeciesId.VOLBEAT);

      expect(game).toHaveArenaTag(ArenaTagType.AURORA_VEIL, ArenaTagSide.PLAYER);
      expect(game.scene.arena.getTagOnSide(ArenaTagType.AURORA_VEIL, ArenaTagSide.PLAYER)?.turnCount).toBe(5);
    });
  });

  describe("Hand-to-Hand (Tough Claws clone)", () => {
    it("multiplies contact moves by 1.3 and leaves non-contact moves alone", async () => {
      game.override.ability(AbilityId.HAND_TO_HAND);
      await game.classicMode.startBattle(SpeciesId.VICTINI);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(power(MoveId.TACKLE, player, enemy)).toBe(40 * 1.3);
      expect(power(MoveId.V_CREATE, player, enemy)).toBe(180 * 1.3);
      expect(power(MoveId.ICE_BEAM, player, enemy)).toBe(90);
      expect(power(MoveId.FLAMETHROWER, player, enemy)).toBe(90);
    });

    it("keeps its bonus with the fork's Punching Glove, like Tough Claws", async () => {
      game.override.ability(AbilityId.HAND_TO_HAND).startingHeldItems([{ name: "PUNCHING_GLOVE" }]);
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(power(MoveId.MACH_PUNCH, player, enemy)).toBeCloseTo(40 * 1.3 * 1.1, 8);
    });

    it("works as a passive", async () => {
      game.override.passiveAbility(AbilityId.HAND_TO_HAND);
      await game.classicMode.startBattle(SpeciesId.VICTINI);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(power(MoveId.TACKLE, player, enemy)).toBe(40 * 1.3);
      expect(power(MoveId.ICE_BEAM, player, enemy)).toBe(90);
    });
  });

  describe("Flameworker (Fire Mane clone)", () => {
    it("multiplies Fire-type moves by 1.5 and nothing else", async () => {
      game.override.ability(AbilityId.FLAMEWORKER);
      await game.classicMode.startBattle(SpeciesId.HEATRAN);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(power(MoveId.FLAMETHROWER, player, enemy)).toBe(90 * 1.5);
      expect(power(MoveId.ICE_BEAM, player, enemy)).toBe(90);
      expect(power(MoveId.TACKLE, player, enemy)).toBe(40);
    });

    it("judges the move's type after it changes (Weather Ball in sun)", async () => {
      game.override.ability(AbilityId.FLAMEWORKER).weather(WeatherType.SUNNY);
      await game.classicMode.startBattle(SpeciesId.HEATRAN);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(power(MoveId.WEATHER_BALL, player, enemy)).toBe(100 * 1.5);
    });

    it("works as a passive", async () => {
      game.override.passiveAbility(AbilityId.FLAMEWORKER);
      await game.classicMode.startBattle(SpeciesId.HEATRAN);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(power(MoveId.FLAMETHROWER, player, enemy)).toBe(90 * 1.5);
      expect(power(MoveId.TACKLE, player, enemy)).toBe(40);
    });
  });

  describe("Aura Master (Mega Launcher clone)", () => {
    it("multiplies pulse moves by 1.5 (Aura Sphere 80 -> 120) and nothing else", async () => {
      game.override.ability(AbilityId.AURA_MASTER);
      await game.classicMode.startBattle(SpeciesId.LUCARIO);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(power(MoveId.AURA_SPHERE, player, enemy)).toBe(120);
      expect(power(MoveId.DRAGON_PULSE, player, enemy)).toBe(85 * 1.5);
      expect(power(MoveId.ICE_BEAM, player, enemy)).toBe(90);
      expect(power(MoveId.TACKLE, player, enemy)).toBe(40);
    });

    it("makes Heal Pulse restore 3/4 of the target's max HP", async () => {
      game.override.ability(AbilityId.AURA_MASTER).enemySpecies(SpeciesId.CHANSEY);
      await game.classicMode.startBattle(SpeciesId.LUCARIO);
      const enemy = game.field.getEnemyPokemon();
      enemy.hp = 1;

      game.move.use(MoveId.HEAL_PULSE);
      await game.toEndOfTurn();

      expect(enemy).toHaveHp((enemy.getMaxHp() * 3) / 4 + 1, { rounding: "half up" });
    });

    it("works as a passive (power and healing)", async () => {
      game.override.passiveAbility(AbilityId.AURA_MASTER).enemySpecies(SpeciesId.CHANSEY);
      await game.classicMode.startBattle(SpeciesId.LUCARIO);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      expect(power(MoveId.AURA_SPHERE, player, enemy)).toBe(120);

      enemy.hp = 1;
      game.move.use(MoveId.HEAL_PULSE);
      await game.toEndOfTurn();

      expect(enemy).toHaveHp((enemy.getMaxHp() * 3) / 4 + 1, { rounding: "half up" });
    });
  });

  describe("Toxic Spray (Toxic Chain clone)", () => {
    it("badly poisons the target when the 30% roll succeeds, with a non-contact move too", async () => {
      game.override.ability(AbilityId.TOXIC_SPRAY);
      await game.classicMode.startBattle(SpeciesId.SKUNTANK);
      const player = game.field.getPlayerPokemon();
      vi.spyOn(player, "randBattleSeedInt").mockReturnValue(0);

      // Water Gun: special, no contact and no secondary effect of its own (the forced roll would freeze with Ice Beam)
      game.move.use(MoveId.WATER_GUN);
      await game.phaseInterceptor.to("BerryPhase");

      expect(game.field.getEnemyPokemon()).toHaveStatusEffect(StatusEffect.TOXIC);
    });

    it("does nothing when the roll fails", async () => {
      game.override.ability(AbilityId.TOXIC_SPRAY);
      await game.classicMode.startBattle(SpeciesId.SKUNTANK);
      const player = game.field.getPlayerPokemon();
      // 30 is the first value that fails `roll < 30`
      vi.spyOn(player, "randBattleSeedInt").mockImplementation(range => (range === 100 ? 30 : 0));

      game.move.select(MoveId.TACKLE);
      await game.phaseInterceptor.to("BerryPhase");

      expect(game.field.getEnemyPokemon()).toHaveStatusEffect(StatusEffect.NONE);
    });

    it("can't badly poison a Steel-type target", async () => {
      game.override.ability(AbilityId.TOXIC_SPRAY).enemySpecies(SpeciesId.REGISTEEL);
      await game.classicMode.startBattle(SpeciesId.SKUNTANK);
      const player = game.field.getPlayerPokemon();
      vi.spyOn(player, "randBattleSeedInt").mockReturnValue(0);

      game.move.select(MoveId.TACKLE);
      await game.phaseInterceptor.to("BerryPhase");

      expect(game.field.getEnemyPokemon()).toHaveStatusEffect(StatusEffect.NONE);
    });

    it("does nothing with a status move", async () => {
      game.override.ability(AbilityId.TOXIC_SPRAY);
      await game.classicMode.startBattle(SpeciesId.SKUNTANK);
      const player = game.field.getPlayerPokemon();
      vi.spyOn(player, "randBattleSeedInt").mockReturnValue(0);

      game.move.select(MoveId.SPLASH);
      await game.phaseInterceptor.to("BerryPhase");

      expect(game.field.getEnemyPokemon()).toHaveStatusEffect(StatusEffect.NONE);
    });

    it("works as a passive", async () => {
      game.override.passiveAbility(AbilityId.TOXIC_SPRAY);
      await game.classicMode.startBattle(SpeciesId.SKUNTANK);
      const player = game.field.getPlayerPokemon();
      vi.spyOn(player, "randBattleSeedInt").mockReturnValue(0);

      game.move.select(MoveId.TACKLE);
      await game.phaseInterceptor.to("BerryPhase");

      expect(game.field.getEnemyPokemon()).toHaveStatusEffect(StatusEffect.TOXIC);
    });
  });

  describe("Current Herald (Gale Herald clone)", () => {
    it("sets Tailwind on the user's side for 4 turns on entry", async () => {
      game.override.ability(AbilityId.CURRENT_HERALD);
      await game.classicMode.startBattle(SpeciesId.BASCULIN);

      expect(game).toHaveArenaTag(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER);
      expect(game).not.toHaveArenaTag(ArenaTagType.TAILWIND, ArenaTagSide.ENEMY);
      expect(game.scene.arena.getTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER)?.turnCount).toBe(4);

      for (let turn = 1; turn <= 3; turn++) {
        game.move.select(MoveId.SPLASH);
        await game.toNextTurn();
        expect(game).toHaveArenaTag(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER);
      }

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(game).not.toHaveArenaTag(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER);
    });

    it("does not refresh a Tailwind that is already up", async () => {
      game.override.ability(AbilityId.CURRENT_HERALD);
      await game.classicMode.startBattle(SpeciesId.BASCULIN, SpeciesId.BASCULEGION);

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(game.scene.arena.getTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER)?.turnCount).toBe(3);

      game.doSwitchPokemon(1);
      await game.toNextTurn();

      expect(game.field.getPlayerPokemon().species.speciesId).toBe(SpeciesId.BASCULEGION);
      expect(game.scene.arena.getTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER)?.turnCount).toBe(2);
    });

    it("charges a Wind Power holder, as Tailwind does", async () => {
      game.override.ability(AbilityId.WIND_POWER).passiveAbility(AbilityId.CURRENT_HERALD);
      await game.classicMode.startBattle(SpeciesId.BASCULIN);

      expect(game).toHaveArenaTag(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER);
      expect(game.field.getPlayerPokemon()).toHaveBattlerTag(BattlerTagType.CHARGED);
    });

    it("raises a Wind Rider holder's Attack by 1, as Tailwind does", async () => {
      game.override.ability(AbilityId.WIND_RIDER).passiveAbility(AbilityId.CURRENT_HERALD);
      await game.classicMode.startBattle(SpeciesId.BASCULIN);

      expect(game).toHaveArenaTag(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER);
      expect(game.field.getPlayerPokemon()).toHaveStatStage(Stat.ATK, 1);
    });

    it("starts Tailwind only once when the holder also has Gale Herald", async () => {
      const addTag = vi.spyOn(Arena.prototype, "addTag");
      game.override.ability(AbilityId.GALE_HERALD).passiveAbility(AbilityId.CURRENT_HERALD);
      await game.classicMode.startBattle(SpeciesId.BASCULIN);

      const tailwindAdds = addTag.mock.calls.filter(([tagType]) => tagType === ArenaTagType.TAILWIND);
      expect(tailwindAdds).toHaveLength(1);
      expect(game.scene.arena.getTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER)?.turnCount).toBe(4);
    });

    it("works as a passive", async () => {
      game.override.passiveAbility(AbilityId.CURRENT_HERALD);
      await game.classicMode.startBattle(SpeciesId.BASCULIN);

      expect(game).toHaveArenaTag(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER);
    });
  });

  describe("High Spirits (Beast Boost clone)", () => {
    it("raises the highest stat by 1 after knocking out a target", async () => {
      game.override.ability(AbilityId.HIGH_SPIRITS);
      await game.classicMode.startBattle(SpeciesId.QUAQUAVAL);
      const player = game.field.getPlayerPokemon();
      // Highest stat other than HP is Def
      vi.spyOn(player, "stats", "get").mockReturnValue([10000, 100, 1000, 200, 100, 100]);
      game.field.getEnemyPokemon().hp = 1;

      game.move.select(MoveId.TACKLE);
      await game.phaseInterceptor.to("VictoryPhase");

      expect(player).toHaveStatStage(Stat.DEF, 1);
      expect(player).toHaveStatStage(Stat.ATK, 0);
    });

    it("breaks ties in the order Atk > Def > Sp. Atk > Sp. Def > Speed", async () => {
      game.override.ability(AbilityId.HIGH_SPIRITS);
      await game.classicMode.startBattle(SpeciesId.QUAQUAVAL);
      const player = game.field.getPlayerPokemon();
      vi.spyOn(player, "stats", "get").mockReturnValue([10000, 1, 1, 100, 100, 100]);
      game.field.getEnemyPokemon().hp = 1;

      game.move.select(MoveId.TACKLE);
      await game.phaseInterceptor.to("VictoryPhase");

      expect(player).toHaveStatStage(Stat.SPATK, 1);
      expect(player).toHaveStatStage(Stat.SPDEF, 0);
      expect(player).toHaveStatStage(Stat.SPD, 0);
    });

    it("does nothing when the target survives", async () => {
      game.override.ability(AbilityId.HIGH_SPIRITS);
      await game.classicMode.startBattle(SpeciesId.QUAQUAVAL);
      const player = game.field.getPlayerPokemon();
      vi.spyOn(player, "stats", "get").mockReturnValue([10000, 100, 1000, 200, 100, 100]);

      game.move.select(MoveId.TACKLE);
      await game.toNextTurn();

      expect(game.field.getEnemyPokemon().isFainted()).toBe(false);
      expect(player).toHaveStatStage(Stat.DEF, 0);
    });

    it("triggers together with Moxie, and works as a passive", async () => {
      game.override.ability(AbilityId.MOXIE).passiveAbility(AbilityId.HIGH_SPIRITS);
      await game.classicMode.startBattle(SpeciesId.QUAQUAVAL);
      const player = game.field.getPlayerPokemon();
      vi.spyOn(player, "stats", "get").mockReturnValue([10000, 100, 1000, 200, 100, 100]);
      game.field.getEnemyPokemon().hp = 1;

      game.move.select(MoveId.TACKLE);
      await game.phaseInterceptor.to("VictoryPhase");

      expect(player).toHaveStatStage(Stat.ATK, 1);
      expect(player).toHaveStatStage(Stat.DEF, 1);
    });
  });
});
