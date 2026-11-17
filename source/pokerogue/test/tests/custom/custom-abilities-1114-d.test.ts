// Local fork (2026-11-14): passive rebalance. Tests of batch D (custom-abilities-1114-d.ts).
import { getAllOutPitchMoveDeniedText } from "#abilities/custom-ability-helpers";
import { __INTERNAL_TEST_EXPORTS } from "#app/ai/ai-moveset-gen";
import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import { readFileSync } from "node:fs";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Custom abilities 2026-11-14, batch D", () => {
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
      .moveset([MoveId.SPLASH, MoveId.TACKLE, MoveId.SWORDS_DANCE, MoveId.FLAMETHROWER]);
  });

  afterEach(() => {
    game.scene?.arena?.setIgnoreAbilities(false);
  });

  /** Damage `move` from `source` would deal to `target` (simulated, so no random roll). */
  function damageOf(target: Pokemon, source: Pokemon, move: MoveId): number {
    return target.getAttackDamage({ source, move: allMoves[move], simulated: true }).damage;
  }

  describe("Plush Body", () => {
    it.each([
      { name: "Tackle (contact)", move: MoveId.TACKLE, mult: 0.5 },
      { name: "Fire Punch (contact, Fire: no Fluffy weakness)", move: MoveId.FIRE_PUNCH, mult: 0.5 },
      { name: "Flamethrower (no contact)", move: MoveId.FLAMETHROWER, mult: 1 },
      { name: "Swift (no contact)", move: MoveId.SWIFT, mult: 1 },
    ])("multiplies $name damage taken by $mult", async ({ move, mult }) => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      const before = damageOf(player, enemy, move);
      game.override.ability(AbilityId.PLUSH_BODY);
      const after = damageOf(player, enemy, move);

      expect(before).toBeGreaterThan(0);
      if (mult === 1) {
        expect(after).toBe(before);
      } else {
        expect(after / before).toBeCloseTo(mult, 1);
      }
    });

    it("works as a passive too", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      const before = damageOf(player, enemy, MoveId.TACKLE);
      game.override.passiveAbility(AbilityId.PLUSH_BODY);
      expect(damageOf(player, enemy, MoveId.TACKLE) / before).toBeCloseTo(0.5, 1);
    });

    it("is ignored by Mold Breaker (ignorable)", async () => {
      game.override.ability(AbilityId.PLUSH_BODY);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      const halved = damageOf(player, enemy, MoveId.TACKLE);
      game.scene.arena.setIgnoreAbilities(true, enemy.getBattlerIndex());
      const ignored = damageOf(player, enemy, MoveId.TACKLE);

      expect(ignored / halved).toBeCloseTo(2, 1);
    });

    it("does not react to a punch from an attacker wearing a Punching Glove (target-side contact)", async () => {
      game.override.enemyHeldItems([{ name: "PUNCHING_GLOVE" }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      const punchBefore = damageOf(player, enemy, MoveId.FIRE_PUNCH);
      const tackleBefore = damageOf(player, enemy, MoveId.TACKLE);
      game.override.ability(AbilityId.PLUSH_BODY);

      expect(damageOf(player, enemy, MoveId.FIRE_PUNCH)).toBe(punchBefore);
      expect(damageOf(player, enemy, MoveId.TACKLE) / tackleBefore).toBeCloseTo(0.5, 1);
    });
  });

  describe("Vigor", () => {
    it("multiplies Attack by 1.5 without Hustle's accuracy drop", async () => {
      await game.classicMode.startBattle(SpeciesId.GOLDEEN);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const tackle = allMoves[MoveId.TACKLE];

      const atk = player.getEffectiveStat(Stat.ATK);
      const spAtk = player.getEffectiveStat(Stat.SPATK);
      game.override.ability(AbilityId.VIGOR);

      expect(Math.abs(player.getEffectiveStat(Stat.ATK) - atk * 1.5)).toBeLessThanOrEqual(1);
      expect(player.getEffectiveStat(Stat.SPATK)).toBe(spAtk);
      expect(player.getAccuracyMultiplier(enemy, tackle)).toBe(1);

      game.override.ability(AbilityId.HUSTLE);
      expect(player.getAccuracyMultiplier(enemy, tackle)).toBeCloseTo(0.8);
    });

    it("works as a passive and raises physical damage by about 1.5", async () => {
      await game.classicMode.startBattle(SpeciesId.GOLDEEN);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      const before = damageOf(enemy, player, MoveId.TACKLE);
      const special = damageOf(enemy, player, MoveId.FLAMETHROWER);
      game.override.passiveAbility(AbilityId.VIGOR);

      expect(damageOf(enemy, player, MoveId.TACKLE) / before).toBeCloseTo(1.5, 1);
      expect(damageOf(enemy, player, MoveId.FLAMETHROWER)).toBe(special);
    });
  });

  describe("All-Out Pitch", () => {
    it("multiplies Attack by 1.5 without the accuracy drop", async () => {
      await game.classicMode.startBattle(SpeciesId.PIKIPEK);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      const atk = player.getEffectiveStat(Stat.ATK);
      game.override.ability(AbilityId.ALL_OUT_PITCH);

      expect(Math.abs(player.getEffectiveStat(Stat.ATK) - atk * 1.5)).toBeLessThanOrEqual(1);
      expect(player.getAccuracyMultiplier(enemy, allMoves[MoveId.TACKLE])).toBe(1);
    });

    it("denies status moves (like Taunt) but not physical or special moves, as an ability or a passive", async () => {
      await game.classicMode.startBattle(SpeciesId.PIKIPEK);
      const player = game.field.getPlayerPokemon();

      expect(getAllOutPitchMoveDeniedText(player, MoveId.SWORDS_DANCE)).toBeUndefined();

      game.override.ability(AbilityId.ALL_OUT_PITCH);
      const denied = getAllOutPitchMoveDeniedText(player, MoveId.SWORDS_DANCE);
      expect(denied).toBeTypeOf("string");
      expect(denied).not.toBe("");
      expect(getAllOutPitchMoveDeniedText(player, MoveId.ROOST)).toBeTypeOf("string");
      expect(getAllOutPitchMoveDeniedText(player, MoveId.TACKLE)).toBeUndefined();
      expect(getAllOutPitchMoveDeniedText(player, MoveId.FLAMETHROWER)).toBeUndefined();

      game.override.ability(AbilityId.BALL_FETCH).passiveAbility(AbilityId.ALL_OUT_PITCH);
      expect(getAllOutPitchMoveDeniedText(player, MoveId.SWORDS_DANCE)).toBeTypeOf("string");
    });

    // Local fork (2026-11-14): passive rebalance. `Pokemon.isMoveSelectable` and `MovePhase` ask the helper
    it("can't select status moves in the fight menu, as an ability or a passive", async () => {
      game.override.ability(AbilityId.ALL_OUT_PITCH);
      await game.classicMode.startBattle(SpeciesId.PIKIPEK);
      const player = game.field.getPlayerPokemon();

      const denied = getAllOutPitchMoveDeniedText(player, MoveId.SWORDS_DANCE);
      expect(player.isMoveSelectable(MoveId.SWORDS_DANCE)).toEqual([false, denied]);
      // The fight menu goes through `trySelectMove`, the AI and Struggle through `isUsable(…, forSelection)`
      const sdIndex = player.getMoveset().findIndex(m => m.moveId === MoveId.SWORDS_DANCE);
      expect(player.trySelectMove(sdIndex)[0]).toBe(false);
      expect(player.getMoveset()[sdIndex].isUsable(player, false, true)[0]).toBe(false);
      expect(player.isMoveSelectable(MoveId.TACKLE)).toEqual([true, ""]);
      expect(player.isMoveSelectable(MoveId.FLAMETHROWER)).toEqual([true, ""]);

      game.override.ability(AbilityId.BALL_FETCH).passiveAbility(AbilityId.ALL_OUT_PITCH);
      expect(player.isMoveSelectable(MoveId.SWORDS_DANCE)[0]).toBe(false);
      game.override.passiveAbility(AbilityId.BALL_FETCH);
      expect(player.isMoveSelectable(MoveId.SWORDS_DANCE)).toEqual([true, ""]);
    });

    it("makes an enemy holder pick its damaging move instead of a status move", async () => {
      game.override.enemyAbility(AbilityId.ALL_OUT_PITCH).enemyMoveset([MoveId.SWORDS_DANCE, MoveId.TACKLE]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      for (let turn = 0; turn < 3; turn++) {
        game.move.select(MoveId.SPLASH);
        await game.toNextTurn();
      }

      expect(enemy).toHaveStatStage(Stat.ATK, 0);
      expect(enemy.getLastXMoves(3).map(m => m.move)).toEqual([MoveId.TACKLE, MoveId.TACKLE, MoveId.TACKLE]);
      expect(player).not.toHaveFullHp();
    });

    it("keeps status moves out of the moveset generated for a trainer's or boss's holder", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const enemy = game.field.getEnemyPokemon();
      const { filterMovePool } = __INTERNAL_TEST_EXPORTS;
      const makePool = () =>
        new Map<MoveId, number>([
          [MoveId.SWORDS_DANCE, 1],
          [MoveId.BULK_UP, 1],
          [MoveId.BODY_SLAM, 1],
        ]);

      const control = makePool();
      filterMovePool(control, true, false, enemy, false);
      expect([...control.keys()]).toEqual([MoveId.SWORDS_DANCE, MoveId.BULK_UP, MoveId.BODY_SLAM]);

      game.override.enemyAbility(AbilityId.ALL_OUT_PITCH);
      const pool = makePool();
      filterMovePool(pool, true, false, enemy, false);
      expect([...pool.keys()]).toEqual([MoveId.BODY_SLAM]);
    });

    it("makes a status move used anyway fail, with its own text", async () => {
      game.override.enemyAbility(AbilityId.ALL_OUT_PITCH);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const enemy = game.field.getEnemyPokemon();
      const denied = getAllOutPitchMoveDeniedText(enemy, MoveId.SWORDS_DANCE);

      game.move.select(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.SWORDS_DANCE);
      await game.toEndOfTurn();

      expect(enemy).toHaveStatStage(Stat.ATK, 0);
      expect(game.textInterceptor.logs).toContain(denied);
    });

    it("lifts the restriction while the ability is suppressed", async () => {
      game.override.ability(AbilityId.ALL_OUT_PITCH);
      await game.classicMode.startBattle(SpeciesId.PIKIPEK);
      const player = game.field.getPlayerPokemon();

      player.summonData.abilitySuppressed = true;
      expect(getAllOutPitchMoveDeniedText(player, MoveId.SWORDS_DANCE)).toBeUndefined();
    });

    it("uses its own message key, which both locales have", async () => {
      game.override.ability(AbilityId.ALL_OUT_PITCH);
      await game.classicMode.startBattle(SpeciesId.PIKIPEK);
      const player = game.field.getPlayerPokemon();
      const tSpy = vi.spyOn(i18next, "t");

      getAllOutPitchMoveDeniedText(player, MoveId.SWORDS_DANCE);
      const key = tSpy.mock.calls.at(-1)?.[0];
      expect(key).toBe("battle:allOutPitchNoStatusMove");
      tSpy.mockRestore();

      const battle = (lang: string) => JSON.parse(readFileSync(`./locales/${lang}/battle.json`, "utf8"));
      expect(battle("ko").allOutPitchNoStatusMove).toBe(
        "{{pokemonNameWithAffix}}[[는]] {{abilityName}} 때문에\n변화 기술을 쓸 수 없다!",
      );
      expect(battle("en").allOutPitchNoStatusMove).toBe(
        "{{pokemonNameWithAffix}} can't use status moves\nbecause of its {{abilityName}}!",
      );
    });
  });

  describe("Mud Armor", () => {
    beforeEach(() => {
      game.override.enemyMoveset(MoveId.WATER_GUN);
    });

    it("takes no damage from a Water move and raises Defense by 2", async () => {
      game.override.ability(AbilityId.MUD_ARMOR);
      await game.classicMode.startBattle(SpeciesId.MUDBRAY);
      const player = game.field.getPlayerPokemon();

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(player).toHaveFullHp();
      expect(player).toHaveStatStage(Stat.DEF, 2);
    });

    it("works as a passive too", async () => {
      game.override.passiveAbility(AbilityId.MUD_ARMOR);
      await game.classicMode.startBattle(SpeciesId.MUDBRAY);
      const player = game.field.getPlayerPokemon();

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(player).toHaveFullHp();
      expect(player).toHaveStatStage(Stat.DEF, 2);
    });

    it("is ignored by Mold Breaker: damage taken, no Defense boost", async () => {
      game.override.ability(AbilityId.MUD_ARMOR).enemyAbility(AbilityId.MOLD_BREAKER);
      await game.classicMode.startBattle(SpeciesId.MUDBRAY);
      const player = game.field.getPlayerPokemon();

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(player).not.toHaveFullHp();
      expect(player).toHaveStatStage(Stat.DEF, 0);
    });

    it("does nothing against non-Water moves", async () => {
      game.override.ability(AbilityId.MUD_ARMOR).enemyMoveset(MoveId.TACKLE);
      await game.classicMode.startBattle(SpeciesId.MUDBRAY);
      const player = game.field.getPlayerPokemon();

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(player).not.toHaveFullHp();
      expect(player).toHaveStatStage(Stat.DEF, 0);
    });
  });

  describe("Power Cheer", () => {
    it("boosts the user's own special moves x1.3 in a single battle, not physical ones", async () => {
      await game.classicMode.startBattle(SpeciesId.PLUSLE);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.override.ability(AbilityId.POWER_CHEER);
      expect(allMoves[MoveId.FLAMETHROWER].calculateBattlePower(player, enemy, true)).toBeCloseTo(90 * 1.3);
      expect(allMoves[MoveId.TACKLE].calculateBattlePower(player, enemy, true)).toBe(40);
      expect(allMoves[MoveId.SWORDS_DANCE].calculateBattlePower(player, enemy, true)).toBe(-1);

      game.override.ability(AbilityId.BALL_FETCH).passiveAbility(AbilityId.POWER_CHEER);
      expect(allMoves[MoveId.FLAMETHROWER].calculateBattlePower(player, enemy, true)).toBeCloseTo(90 * 1.3);
    });

    it("boosts an ally's special moves x1.3 in a double battle", async () => {
      game.override.battleStyle("double").ability(AbilityId.POWER_CHEER);
      await game.classicMode.startBattle(SpeciesId.PLUSLE, SpeciesId.MINUN);
      const [plusle, minun] = game.scene.getPlayerField();
      const enemy = game.field.getEnemyPokemon();
      game.field.mockAbility(minun, AbilityId.BALL_FETCH);

      // Minun (no ability) gets Plusle's x1.3; Plusle gets only its own x1.3
      expect(allMoves[MoveId.FLAMETHROWER].calculateBattlePower(minun, enemy, true)).toBeCloseTo(90 * 1.3);
      expect(allMoves[MoveId.TACKLE].calculateBattlePower(minun, enemy, true)).toBe(40);
      expect(allMoves[MoveId.FLAMETHROWER].calculateBattlePower(plusle, enemy, true)).toBeCloseTo(90 * 1.3);
    });

    it("multiplies with an ally's Power Cheer or Battery (1.3 x 1.3)", async () => {
      game.override.battleStyle("double").ability(AbilityId.POWER_CHEER);
      await game.classicMode.startBattle(SpeciesId.PLUSLE, SpeciesId.MINUN);
      const [plusle, minun] = game.scene.getPlayerField();
      const enemy = game.field.getEnemyPokemon();

      expect(allMoves[MoveId.FLAMETHROWER].calculateBattlePower(plusle, enemy, true)).toBeCloseTo(90 * 1.3 * 1.3);

      game.field.mockAbility(minun, AbilityId.BATTERY);
      expect(allMoves[MoveId.FLAMETHROWER].calculateBattlePower(plusle, enemy, true)).toBeCloseTo(90 * 1.3 * 1.3);
    });
  });

  describe("Chime Voice", () => {
    it("turns sound moves Psychic with x1.3 power; other moves keep their type and power", async () => {
      game.override.ability(AbilityId.CHIME_VOICE);
      await game.classicMode.startBattle(SpeciesId.CHIMECHO);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(player.getMoveType(allMoves[MoveId.HYPER_VOICE])).toBe(PokemonType.PSYCHIC);
      expect(player.getMoveType(allMoves[MoveId.BOOMBURST])).toBe(PokemonType.PSYCHIC);
      expect(allMoves[MoveId.HYPER_VOICE].calculateBattlePower(player, enemy, true)).toBeCloseTo(117);
      expect(allMoves[MoveId.BOOMBURST].calculateBattlePower(player, enemy, true)).toBeCloseTo(182);
      expect(player.getMoveType(allMoves[MoveId.TACKLE])).toBe(PokemonType.NORMAL);
      expect(allMoves[MoveId.TACKLE].calculateBattlePower(player, enemy, true)).toBe(40);
    });

    it("works as a passive too", async () => {
      game.override.passiveAbility(AbilityId.CHIME_VOICE);
      await game.classicMode.startBattle(SpeciesId.CHIMECHO);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(player.getMoveType(allMoves[MoveId.HYPER_VOICE])).toBe(PokemonType.PSYCHIC);
      expect(allMoves[MoveId.HYPER_VOICE].calculateBattlePower(player, enemy, true)).toBeCloseTo(117);
    });

    it("lets Normal sound moves hit Ghost types, but Dark types become immune", async () => {
      game.override.ability(AbilityId.CHIME_VOICE).enemySpecies(SpeciesId.GENGAR);
      await game.classicMode.startBattle(SpeciesId.CHIMECHO);
      const player = game.field.getPlayerPokemon();
      const gengar = game.field.getEnemyPokemon();

      // Psychic into Ghost/Poison: x2
      expect(gengar.getMoveEffectiveness(player, allMoves[MoveId.HYPER_VOICE])).toBe(2);
      game.field.mockAbility(player, AbilityId.BALL_FETCH);
      expect(gengar.getMoveEffectiveness(player, allMoves[MoveId.HYPER_VOICE])).toBe(0);
    });

    it("halves sound damage taken; only that part is ignored by Mold Breaker", async () => {
      await game.classicMode.startBattle(SpeciesId.CHIMECHO);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      const before = damageOf(player, enemy, MoveId.HYPER_VOICE);
      const tackleBefore = damageOf(player, enemy, MoveId.TACKLE);
      game.override.ability(AbilityId.CHIME_VOICE);
      expect(damageOf(player, enemy, MoveId.HYPER_VOICE) / before).toBeCloseTo(0.5, 1);
      expect(damageOf(player, enemy, MoveId.TACKLE)).toBe(tackleBefore);

      game.scene.arena.setIgnoreAbilities(true, enemy.getBattlerIndex());
      expect(damageOf(player, enemy, MoveId.HYPER_VOICE)).toBe(before);
      // The holder's own sound moves stay Psychic (that part is not ignorable)
      expect(player.getMoveType(allMoves[MoveId.HYPER_VOICE])).toBe(PokemonType.PSYCHIC);
    });

    it("still halves sound damage when the holder itself is the Mold Breaker side", async () => {
      game.override.ability(AbilityId.CHIME_VOICE);
      await game.classicMode.startBattle(SpeciesId.CHIMECHO);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      const halved = damageOf(player, enemy, MoveId.HYPER_VOICE);
      game.scene.arena.setIgnoreAbilities(true, player.getBattlerIndex());
      expect(damageOf(player, enemy, MoveId.HYPER_VOICE)).toBe(halved);
    });
  });

  describe("Space Warp", () => {
    it("sets up a 5-turn Trick Room on entry", async () => {
      game.override.ability(AbilityId.SPACE_WARP);
      await game.classicMode.startBattle(SpeciesId.REUNICLUS);
      const player = game.field.getPlayerPokemon();

      expect(player).toHaveAbilityApplied(AbilityId.SPACE_WARP);
      expect(game).toHaveArenaTag({
        tagType: ArenaTagType.TRICK_ROOM,
        side: ArenaTagSide.BOTH,
        sourceId: player.id,
        turnCount: 5,
      });

      for (let turn = 1; turn <= 4; turn++) {
        game.move.select(MoveId.SPLASH);
        await game.toNextTurn();
      }
      expect(game.scene.arena.getTag(ArenaTagType.TRICK_ROOM)?.turnCount).toBe(1);

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(game).not.toHaveArenaTag(ArenaTagType.TRICK_ROOM);
    });

    it("works as a passive too", async () => {
      game.override.passiveAbility(AbilityId.SPACE_WARP);
      await game.classicMode.startBattle(SpeciesId.REUNICLUS);

      expect(game).toHaveArenaTag(ArenaTagType.TRICK_ROOM);
    });

    it("lets the slower Pokémon move first", async () => {
      game.override.ability(AbilityId.SPACE_WARP).enemyMoveset(MoveId.TACKLE);
      await game.classicMode.startBattle(SpeciesId.REUNICLUS);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      player.setStat(Stat.SPD, 1);
      enemy.setStat(Stat.SPD, 500);

      expect(game.field.getSpeedOrder(false, false)).toEqual([player, enemy]);

      game.move.select(MoveId.TACKLE);
      await game.phaseInterceptor.to("MoveEndPhase");

      expect(player.getMoveHistory()).toHaveLength(1);
      expect(enemy.getMoveHistory()).toHaveLength(0);
    });

    it("does nothing while Trick Room is already up: two holders entering together leave it on", async () => {
      game.override.ability(AbilityId.SPACE_WARP).enemyAbility(AbilityId.SPACE_WARP);
      await game.classicMode.startBattle(SpeciesId.REUNICLUS);

      expect(game).toHaveArenaTag(ArenaTagType.TRICK_ROOM);
      expect(game.scene.arena.getTag(ArenaTagType.TRICK_ROOM)?.turnCount).toBe(5);
    });

    it("neither lifts nor refreshes a Trick Room that is up when it switches in", async () => {
      game.override.ability(AbilityId.SPACE_WARP);
      await game.classicMode.startBattle(SpeciesId.REUNICLUS, SpeciesId.DUSKNOIR);

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(game.scene.arena.getTag(ArenaTagType.TRICK_ROOM)?.turnCount).toBe(4);

      game.doSwitchPokemon(1);
      await game.toNextTurn();

      expect(game.field.getPlayerPokemon().species.speciesId).toBe(SpeciesId.DUSKNOIR);
      expect(game).toHaveArenaTag(ArenaTagType.TRICK_ROOM);
      expect(game.scene.arena.getTag(ArenaTagType.TRICK_ROOM)?.turnCount).toBe(3);
    });
  });

  describe("Cannoneer", () => {
    it.each([
      { name: "Sludge Bomb", move: MoveId.SLUDGE_BOMB, power: 90 * 1.3 },
      { name: "Focus Blast", move: MoveId.FOCUS_BLAST, power: 120 * 1.3 },
      { name: "Electro Ball", move: MoveId.ELECTRO_BALL, power: undefined },
      { name: "Syrup Bomb (Bulletproof list)", move: MoveId.SYRUP_BOMB, power: 60 * 1.3 },
      { name: "Flamethrower (not a ball or bomb)", move: MoveId.FLAMETHROWER, power: 90 },
    ])("gives $name its power", async ({ move, power }) => {
      await game.classicMode.startBattle(SpeciesId.RAICHU);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      const before = allMoves[move].calculateBattlePower(player, enemy, true);
      game.override.ability(AbilityId.CANNONEER);
      const after = allMoves[move].calculateBattlePower(player, enemy, true);

      if (power === undefined) {
        expect(after).toBeCloseTo(before * 1.3);
      } else {
        expect(after).toBeCloseTo(power);
      }
    });

    it("raises Sludge Bomb damage by about 1.3, also as a passive", async () => {
      await game.classicMode.startBattle(SpeciesId.RAICHU);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      const before = damageOf(enemy, player, MoveId.SLUDGE_BOMB);
      game.override.passiveAbility(AbilityId.CANNONEER);
      expect(damageOf(enemy, player, MoveId.SLUDGE_BOMB) / before).toBeCloseTo(1.3, 1);
    });
  });
});
