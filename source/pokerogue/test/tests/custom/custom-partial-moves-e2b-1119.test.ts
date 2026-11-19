// Local fork (2026-11-19): 1.2.0 item E2, part B (the user: "e2 구현"). Four partial moves now work fully:
// - Sky Drop (프리폴): two turns, the user carries the target, which cannot act or switch; fails on 200 kg or more, a
//   substitute, an ally, a protected or semi-invulnerable target; Flying types take no damage from the drop.
// - Dragon Darts (드래곤애로): smart targeting in double battles.
// - Conversion 2 (텍스처2): the type the target's last move was actually used as; fails when no type qualifies.
// - Tera Blast / Tera Starstorm (테라버스트 / 테라클러스터): the physical/special choice counts stat stages only (no
//   abilities, items or field effects); Tera Starstorm changes only for Terapagos, spreads for an enemy Terapagos too.
import { getPokemonNameWithAffix } from "#app/messages";
import { activeOverrides } from "#app/overrides";
import { SkyDropCarrierTag } from "#data/battler-tags";
import { allMoves } from "#data/data-lists";
import { Status } from "#data/status-effect";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { Command } from "#enums/command";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { UiMode } from "#enums/ui-mode";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import type { Trainer } from "#field/trainer";
import { getMoveTargets } from "#moves/move-utils";
import type { CommandPhase } from "#phases/command-phase";
import { GameManager } from "#test/framework/game-manager";
import i18next from "i18next";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Partial moves made whole, E2 part B (2026-11-19)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(100)
      .ability(AbilityId.BALL_FETCH)
      .hasPassiveAbility(false)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyHasPassiveAbility(false)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH);
  });

  /** How many times `pokemon` was struck by `move` this turn */
  function strikesBy(pokemon: Pokemon, move: MoveId): number {
    return pokemon.turnData.attacksReceived.filter(a => a.move === move).length;
  }

  it("none of the four moves is marked partial any more", () => {
    for (const move of [MoveId.SKY_DROP, MoveId.DRAGON_DARTS, MoveId.CONVERSION_2, MoveId.TERA_STARSTORM]) {
      expect(allMoves[move].name).not.toContain("(P)");
    }
  });

  describe("Sky Drop", () => {
    it("carries the target for a turn (it cannot move or switch), then drops it", async () => {
      game.override.enemyMoveset(MoveId.TACKLE);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.move.use(MoveId.SKY_DROP);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
      await game.toEndOfTurn();

      expect(player).toHaveUsedMove({ move: MoveId.SKY_DROP, result: MoveResult.OTHER });
      expect(player.getTag(BattlerTagType.FLYING)).toBeInstanceOf(SkyDropCarrierTag);
      expect(enemy).toHaveBattlerTag(BattlerTagType.SKY_DROP);
      expect(enemy.getTag(BattlerTagType.SKY_DROP)?.sourceId).toBe(player.id);
      expect(enemy.visible).toBe(false);
      expect(enemy.isTrapped()).toBe(true);
      // The carried Pokémon's Tackle was cancelled
      expect(player).toHaveFullHp();
      expect(enemy).toHaveFullHp();
      expect(game.textInterceptor.logs).toContain(
        i18next.t("battlerTags:skyDropCannotMove", { pokemonNameWithAffix: getPokemonNameWithAffix(enemy) }),
      );

      // Turn 2: the carried Pokémon is faster, but still cannot move; then it is dropped
      game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER]);
      await game.toEndOfTurn();

      expect(player).toHaveFullHp();
      expect(player).toHaveUsedMove({ move: MoveId.SKY_DROP, result: MoveResult.SUCCESS });
      expect(enemy).not.toHaveFullHp();
      expect(player).not.toHaveBattlerTag(BattlerTagType.FLYING);
      expect(enemy).not.toHaveBattlerTag(BattlerTagType.SKY_DROP);
      expect(enemy.isTrapped()).toBe(false);
      expect(game.textInterceptor.logs).not.toContain(
        i18next.t("battlerTags:skyDropFreed", { pokemonNameWithAffix: getPokemonNameWithAffix(enemy) }),
      );
    });

    it("lets a slower target act normally on the turn it is dropped", async () => {
      game.override.enemyMoveset(MoveId.TACKLE);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.move.use(MoveId.SKY_DROP);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
      await game.toNextTurn();
      await game.toEndOfTurn();

      expect(enemy).not.toHaveFullHp();
      expect(enemy).toHaveUsedMove({ move: MoveId.TACKLE, result: MoveResult.SUCCESS });
      expect(player).not.toHaveFullHp();
    });

    it("keeps a carried Ghost type from switching out", async () => {
      game.override.enemySpecies(SpeciesId.GASTLY);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const enemy = game.field.getEnemyPokemon();
      expect(enemy.isTrapped()).toBe(false);

      game.move.use(MoveId.SKY_DROP);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
      await game.toEndOfTurn();

      expect(enemy.isTrapped()).toBe(true);
    });

    it("does no damage to a Flying-type target, which is still carried and dropped", async () => {
      game.override.enemySpecies(SpeciesId.PIDGEY);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.move.use(MoveId.SKY_DROP);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
      await game.toNextTurn();
      expect(enemy).toHaveBattlerTag(BattlerTagType.SKY_DROP);

      await game.toEndOfTurn();
      expect(enemy).toHaveFullHp();
      expect(enemy).not.toHaveBattlerTag(BattlerTagType.SKY_DROP);
      expect(player).not.toHaveBattlerTag(BattlerTagType.FLYING);
    });

    it("fails on a target of 200 kg or more, with the 'too heavy' message", async () => {
      game.override.enemySpecies(SpeciesId.SNORLAX);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      expect(enemy.getWeight()).toBeGreaterThanOrEqual(200);

      game.move.use(MoveId.SKY_DROP);
      await game.toEndOfTurn();

      expect(player).toHaveUsedMove({ move: MoveId.SKY_DROP, result: MoveResult.FAIL });
      expect(player).not.toHaveBattlerTag(BattlerTagType.FLYING);
      expect(player.getMoveQueue()).toHaveLength(0);
      expect(enemy).not.toHaveBattlerTag(BattlerTagType.SKY_DROP);
      expect(game.textInterceptor.logs).toContain(
        i18next.t("moveTriggers:skyDropTooHeavy", { targetName: getPokemonNameWithAffix(enemy) }),
      );
    });

    it("is stopped by Protect on the first turn", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.move.use(MoveId.SKY_DROP);
      await game.move.forceEnemyMove(MoveId.PROTECT);
      await game.toEndOfTurn();

      expect(player).toHaveUsedMove({ move: MoveId.SKY_DROP, result: MoveResult.FAIL });
      expect(player).not.toHaveBattlerTag(BattlerTagType.FLYING);
      expect(enemy).not.toHaveBattlerTag(BattlerTagType.SKY_DROP);
      expect(game.textInterceptor.logs).toContain(
        i18next.t("battlerTags:protectedLapse", { pokemonNameWithAffix: getPokemonNameWithAffix(enemy) }),
      );
    });

    it("misses a target that is already semi-invulnerable", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.move.use(MoveId.SKY_DROP);
      await game.move.forceEnemyMove(MoveId.DIG);
      game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER]);
      await game.toEndOfTurn();

      expect(player).toHaveUsedMove({ move: MoveId.SKY_DROP, result: MoveResult.FAIL });
      expect(enemy).not.toHaveBattlerTag(BattlerTagType.SKY_DROP);
      expect(game.textInterceptor.logs).toContain(
        i18next.t("battle:attackMissed", { pokemonNameWithAffix: getPokemonNameWithAffix(enemy) }),
      );
    });

    it("fails on the user's own ally", async () => {
      game.override.battleStyle("double");
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
      const [feebas, magikarp] = game.scene.getPlayerField();

      game.move.use(MoveId.SKY_DROP, BattlerIndex.PLAYER, BattlerIndex.PLAYER_2);
      game.move.use(MoveId.SPLASH, BattlerIndex.PLAYER_2);
      await game.toEndOfTurn();

      expect(feebas).toHaveUsedMove({ move: MoveId.SKY_DROP, result: MoveResult.FAIL });
      expect(magikarp).not.toHaveBattlerTag(BattlerTagType.SKY_DROP);
    });

    it.each([
      { name: "Gust reaches it (double damage)", move: MoveId.GUST, hits: true },
      { name: "Tackle misses it", move: MoveId.TACKLE, hits: false },
    ])("the carried target is up in the air like a Fly user: $name", async ({ move, hits }) => {
      game.override.battleStyle("double");
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
      const enemy = game.scene.getEnemyField()[0];

      game.move.use(MoveId.SKY_DROP, BattlerIndex.PLAYER, BattlerIndex.ENEMY);
      game.move.use(move, BattlerIndex.PLAYER_2, BattlerIndex.ENEMY);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.PLAYER_2, BattlerIndex.ENEMY, BattlerIndex.ENEMY_2]);
      await game.toEndOfTurn();

      expect(enemy).toHaveBattlerTag(BattlerTagType.SKY_DROP);
      expect(enemy.isFullHp()).toBe(!hits);
    });

    it("takes Follow Me away from the carried Pokémon", async () => {
      game.override.battleStyle("double");
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
      const [enemy1, enemy2] = game.scene.getEnemyField();

      game.move.use(MoveId.SKY_DROP, BattlerIndex.PLAYER, BattlerIndex.ENEMY);
      game.move.use(MoveId.TACKLE, BattlerIndex.PLAYER_2, BattlerIndex.ENEMY_2);
      await game.move.forceEnemyMove(MoveId.FOLLOW_ME);
      await game.move.forceEnemyMove(MoveId.SPLASH);
      game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER, BattlerIndex.PLAYER_2, BattlerIndex.ENEMY_2]);
      await game.toEndOfTurn();

      expect(enemy1).toHaveBattlerTag(BattlerTagType.SKY_DROP);
      expect(enemy1).not.toHaveBattlerTag(BattlerTagType.CENTER_OF_ATTENTION);
      expect(enemy2).not.toHaveFullHp();
    });

    it("frees the carried Pokémon when the carrier cannot attack on the second turn (full paralysis)", async () => {
      game.override.enemyMoveset(MoveId.TACKLE);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.move.use(MoveId.SKY_DROP);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
      await game.toNextTurn();
      expect(enemy).toHaveBattlerTag(BattlerTagType.SKY_DROP);

      player.status = new Status(StatusEffect.PARALYSIS);
      vi.spyOn(activeOverrides, "STATUS_ACTIVATION_OVERRIDE", "get").mockReturnValue(true);
      await game.toEndOfTurn();

      expect(player).not.toHaveBattlerTag(BattlerTagType.FLYING);
      expect(enemy).not.toHaveBattlerTag(BattlerTagType.SKY_DROP);
      expect(enemy).toHaveFullHp();
      expect(enemy).toHaveUsedMove({ move: MoveId.TACKLE, result: MoveResult.SUCCESS });
      expect(game.textInterceptor.logs).toContain(
        i18next.t("battlerTags:skyDropFreed", { pokemonNameWithAffix: getPokemonNameWithAffix(enemy) }),
      );
    });

    it("fails on a Dynamaxed target (this fork's choice)", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      vi.spyOn(enemy, "isDynamaxed").mockReturnValue(true);

      game.move.use(MoveId.SKY_DROP);
      await game.toEndOfTurn();

      expect(player).toHaveUsedMove({ move: MoveId.SKY_DROP, result: MoveResult.FAIL });
      expect(enemy).not.toHaveBattlerTag(BattlerTagType.SKY_DROP);
    });

    // Review (2026-11-19): `CommandPhase.handleTrap` showed nothing for a trap with no `TrappedTag`, so trying to run
    // left the game in an empty message box that took no input
    it("tells the player a carried Pokémon cannot flee and goes back to the command menu", async () => {
      game.override.enemyMoveset(MoveId.SKY_DROP);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.move.use(MoveId.SPLASH);
      game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER]);
      await game.toNextTurn();
      expect(player).toHaveBattlerTag(BattlerTagType.SKY_DROP);

      const commandPhase = game.scene.phaseManager.getCurrentPhase() as CommandPhase;
      expect(commandPhase.handleCommand(Command.RUN, 0)).toBe(false);
      expect(game.textInterceptor.logs).toContain(
        i18next.t("battle:noEscapePokemon", {
          pokemonName: getPokemonNameWithAffix(enemy),
          moveName: allMoves[MoveId.SKY_DROP].name,
          escapeVerb: i18next.t("battle:escapeVerbFlee"),
        }),
      );
      await vi.waitFor(() => expect(game.scene.ui.mode).toBe(UiMode.COMMAND));
    });

    it("frees the carried Pokémon when the carrier faints, and it can then move", async () => {
      game.override.battleStyle("double");
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
      const [feebas] = game.scene.getPlayerField();
      const [carrier, enemy2] = game.scene.getEnemyField();
      carrier.hp = 1;

      game.move.use(MoveId.TACKLE, BattlerIndex.PLAYER, BattlerIndex.ENEMY_2);
      game.move.use(MoveId.GUST, BattlerIndex.PLAYER_2, BattlerIndex.ENEMY);
      await game.move.forceEnemyMove(MoveId.SKY_DROP, BattlerIndex.PLAYER);
      await game.move.forceEnemyMove(MoveId.SPLASH);
      game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER_2, BattlerIndex.PLAYER, BattlerIndex.ENEMY_2]);
      await game.toEndOfTurn();

      expect(carrier.isFainted()).toBe(true);
      expect(feebas).not.toHaveBattlerTag(BattlerTagType.SKY_DROP);
      expect(feebas).toHaveUsedMove({ move: MoveId.TACKLE, result: MoveResult.SUCCESS });
      expect(enemy2).not.toHaveFullHp();
      expect(game.textInterceptor.logs).toContain(
        i18next.t("battlerTags:skyDropFreed", { pokemonNameWithAffix: getPokemonNameWithAffix(feebas) }),
      );
    });
  });

  describe("Dragon Darts", () => {
    beforeEach(() => {
      game.override.battleStyle("double").enemySpecies(SpeciesId.SNORLAX);
    });

    it("strikes each opponent once in a double battle", async () => {
      await game.classicMode.startBattle(SpeciesId.DRAGAPULT, SpeciesId.MAGIKARP);
      const [enemy1, enemy2] = game.scene.getEnemyField();

      game.move.use(MoveId.DRAGON_DARTS, BattlerIndex.PLAYER, BattlerIndex.ENEMY_2);
      game.move.use(MoveId.SPLASH, BattlerIndex.PLAYER_2);
      await game.toEndOfTurn();

      expect(strikesBy(enemy1, MoveId.DRAGON_DARTS)).toBe(1);
      expect(strikesBy(enemy2, MoveId.DRAGON_DARTS)).toBe(1);
      expect(game.field.getPlayerPokemon()).toHaveUsedMove({ move: MoveId.DRAGON_DARTS, result: MoveResult.SUCCESS });
    });

    it("strikes the other opponent twice when the chosen one protects itself", async () => {
      await game.classicMode.startBattle(SpeciesId.DRAGAPULT, SpeciesId.MAGIKARP);
      const [enemy1, enemy2] = game.scene.getEnemyField();

      game.move.use(MoveId.DRAGON_DARTS, BattlerIndex.PLAYER, BattlerIndex.ENEMY);
      game.move.use(MoveId.SPLASH, BattlerIndex.PLAYER_2);
      await game.move.forceEnemyMove(MoveId.PROTECT);
      await game.move.forceEnemyMove(MoveId.SPLASH);
      await game.toEndOfTurn();

      expect(enemy1).toHaveFullHp();
      expect(strikesBy(enemy1, MoveId.DRAGON_DARTS)).toBe(0);
      expect(strikesBy(enemy2, MoveId.DRAGON_DARTS)).toBe(2);
    });

    it("strikes the other opponent twice when the chosen one is immune (Fairy)", async () => {
      await game.classicMode.startBattle(SpeciesId.DRAGAPULT, SpeciesId.MAGIKARP);
      const [enemy1, enemy2] = game.scene.getEnemyField();
      enemy2.summonData.types = [PokemonType.FAIRY];

      game.move.use(MoveId.DRAGON_DARTS, BattlerIndex.PLAYER, BattlerIndex.ENEMY_2);
      game.move.use(MoveId.SPLASH, BattlerIndex.PLAYER_2);
      await game.toEndOfTurn();

      expect(enemy2).toHaveFullHp();
      expect(strikesBy(enemy1, MoveId.DRAGON_DARTS)).toBe(2);
    });

    it("strikes the other opponent twice when it misses the chosen one", async () => {
      await game.classicMode.startBattle(SpeciesId.DRAGAPULT, SpeciesId.MAGIKARP);
      const [enemy1, enemy2] = game.scene.getEnemyField();

      game.move.use(MoveId.DRAGON_DARTS, BattlerIndex.PLAYER, BattlerIndex.ENEMY);
      game.move.use(MoveId.SPLASH, BattlerIndex.PLAYER_2);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.PLAYER_2, BattlerIndex.ENEMY, BattlerIndex.ENEMY_2]);
      // The first hit check of the move is the one against the chosen target (left enemy, first in field order)
      await game.move.forceMiss(true);
      await game.toEndOfTurn();

      expect(enemy1).toHaveFullHp();
      expect(strikesBy(enemy2, MoveId.DRAGON_DARTS)).toBe(2);
    });

    it("still strikes the ally of a chosen target the first strike knocked out", async () => {
      await game.classicMode.startBattle(SpeciesId.DRAGAPULT, SpeciesId.MAGIKARP);
      const [enemy1, enemy2] = game.scene.getEnemyField();
      enemy1.hp = 1;

      game.move.use(MoveId.DRAGON_DARTS, BattlerIndex.PLAYER, BattlerIndex.ENEMY);
      game.move.use(MoveId.SPLASH, BattlerIndex.PLAYER_2);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.PLAYER_2, BattlerIndex.ENEMY, BattlerIndex.ENEMY_2]);
      await game.toEndOfTurn();

      expect(enemy1.isFainted()).toBe(true);
      expect(strikesBy(enemy2, MoveId.DRAGON_DARTS)).toBe(1);
    });

    it("strikes the user's own ally twice when aimed at it", async () => {
      await game.classicMode.startBattle(SpeciesId.DRAGAPULT, SpeciesId.SNORLAX);
      const ally = game.scene.getPlayerField()[1];
      const [enemy1, enemy2] = game.scene.getEnemyField();

      game.move.use(MoveId.DRAGON_DARTS, BattlerIndex.PLAYER, BattlerIndex.PLAYER_2);
      game.move.use(MoveId.SPLASH, BattlerIndex.PLAYER_2);
      await game.toEndOfTurn();

      expect(strikesBy(ally, MoveId.DRAGON_DARTS)).toBe(2);
      expect(enemy1).toHaveFullHp();
      expect(enemy2).toHaveFullHp();
    });

    it("strikes a lone target twice in a single battle", async () => {
      game.override.battleStyle("single");
      await game.classicMode.startBattle(SpeciesId.DRAGAPULT);
      const enemy = game.field.getEnemyPokemon();

      game.move.use(MoveId.DRAGON_DARTS);
      await game.toEndOfTurn();

      expect(strikesBy(enemy, MoveId.DRAGON_DARTS)).toBe(2);
    });
  });

  describe("Conversion 2", () => {
    it("reads the type Weather Ball was used as (rain: Water)", async () => {
      game.override.weather(WeatherType.RAIN);
      await game.classicMode.startBattle(SpeciesId.PORYGON2);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.move.use(MoveId.CONVERSION_2);
      await game.move.forceEnemyMove(MoveId.WEATHER_BALL);
      game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER]);
      await game.toEndOfTurn();

      expect(enemy.getLastXMoves(1)[0].moveType).toBe(PokemonType.WATER);
      expect(player).toHaveUsedMove({ move: MoveId.CONVERSION_2, result: MoveResult.SUCCESS });
      expect(player).toHaveTypes([PokemonType.WATER, PokemonType.GRASS, PokemonType.DRAGON], { mode: "oneOf" });
      expect(player.getTypes()).toHaveLength(1);
    });

    it("reads the type a move was changed to by an ability (Normalize Water Gun: Normal)", async () => {
      game.override.enemyAbility(AbilityId.NORMALIZE);
      await game.classicMode.startBattle(SpeciesId.PORYGON2);
      const player = game.field.getPlayerPokemon();

      game.move.use(MoveId.CONVERSION_2);
      await game.move.forceEnemyMove(MoveId.WATER_GUN);
      game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER]);
      await game.toEndOfTurn();

      expect(player).toHaveTypes([PokemonType.ROCK, PokemonType.STEEL, PokemonType.GHOST], { mode: "oneOf" });
      expect(player.getTypes()).toHaveLength(1);
    });

    it("keeps no type in the history for a move used as its own type", async () => {
      await game.classicMode.startBattle(SpeciesId.PORYGON2);
      const enemy = game.field.getEnemyPokemon();

      game.move.use(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.TACKLE);
      await game.toEndOfTurn();

      expect(enemy.getLastXMoves(1)[0].move).toBe(MoveId.TACKLE);
      expect(enemy.getLastXMoves(1)[0]).not.toHaveProperty("moveType");
    });

    it("fails after a typeless move (Struggle)", async () => {
      await game.classicMode.startBattle(SpeciesId.PORYGON2);
      const player = game.field.getPlayerPokemon();

      game.move.use(MoveId.CONVERSION_2);
      await game.move.forceEnemyMove(MoveId.STRUGGLE);
      game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER]);
      await game.toEndOfTurn();

      expect(player).toHaveUsedMove({ move: MoveId.CONVERSION_2, result: MoveResult.FAIL });
      expect(player).toHaveTypes(PokemonType.NORMAL);
    });

    it("fails when the user already has every type resisting the move (Klefki vs Dragon Pulse)", async () => {
      await game.classicMode.startBattle(SpeciesId.KLEFKI);
      const player = game.field.getPlayerPokemon();

      game.move.use(MoveId.CONVERSION_2);
      await game.move.forceEnemyMove(MoveId.DRAGON_PULSE);
      game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER]);
      await game.toEndOfTurn();

      expect(player).toHaveUsedMove({ move: MoveId.CONVERSION_2, result: MoveResult.FAIL });
      expect(player).toHaveTypes([PokemonType.STEEL, PokemonType.FAIRY]);
    });
  });

  describe("Tera Blast / Tera Starstorm category", () => {
    /** Set `pokemon`'s Attack and Sp. Atk */
    function setAttackStats(pokemon: Pokemon, atk: number, spAtk: number): void {
      pokemon.setStat(Stat.ATK, atk);
      pokemon.setStat(Stat.SPATK, spAtk);
    }

    function categoryOf(user: Pokemon, move: MoveId): MoveCategory {
      return user.getMoveCategory(game.field.getEnemyPokemon(), allMoves[move]);
    }

    it("counts stat stages", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const player = game.field.getPlayerPokemon();
      game.field.forceTera(player, PokemonType.WATER);
      setAttackStats(player, 100, 120);

      expect(categoryOf(player, MoveId.TERA_BLAST)).toBe(MoveCategory.SPECIAL);
      player.setStatStage(Stat.ATK, 2);
      expect(categoryOf(player, MoveId.TERA_BLAST)).toBe(MoveCategory.PHYSICAL);
      // Tera Starstorm changes only for Terapagos
      expect(categoryOf(player, MoveId.TERA_STARSTORM)).toBe(MoveCategory.SPECIAL);
      player.setStatStage(Stat.SPATK, 2);
      expect(categoryOf(player, MoveId.TERA_BLAST)).toBe(MoveCategory.SPECIAL);
    });

    it("stays special for a Pokémon that is not Terastallized", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const player = game.field.getPlayerPokemon();
      setAttackStats(player, 200, 100);

      expect(categoryOf(player, MoveId.TERA_BLAST)).toBe(MoveCategory.SPECIAL);
    });

    it.each([
      { name: "Slow Start (halves its Attack)", ability: AbilityId.SLOW_START, enemyAbility: AbilityId.BALL_FETCH },
      { name: "an opposing Tablets of Ruin", ability: AbilityId.BALL_FETCH, enemyAbility: AbilityId.TABLETS_OF_RUIN },
    ])("ignores $name", async ({ ability, enemyAbility }) => {
      game.override.ability(ability).enemyAbility(enemyAbility);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const player = game.field.getPlayerPokemon();
      game.field.forceTera(player, PokemonType.WATER);
      setAttackStats(player, 150, 120);
      // The ability does lower the effective Attack below the Sp. Atk
      expect(player.getEffectiveStat(Stat.ATK, { opponent: game.field.getEnemyPokemon() })).toBeLessThan(120);

      expect(categoryOf(player, MoveId.TERA_BLAST)).toBe(MoveCategory.PHYSICAL);
      expect(categoryOf(player, MoveId.TERA_STARSTORM)).toBe(MoveCategory.SPECIAL); // not Terapagos
    });

    it("ignores Huge Power", async () => {
      game.override.ability(AbilityId.HUGE_POWER);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const player = game.field.getPlayerPokemon();
      game.field.forceTera(player, PokemonType.WATER);
      setAttackStats(player, 100, 150);

      expect(categoryOf(player, MoveId.TERA_BLAST)).toBe(MoveCategory.SPECIAL);
    });

    it("Tera Starstorm turns physical only for Terapagos", async () => {
      await game.classicMode.startBattle(SpeciesId.TERAPAGOS);
      const terapagos = game.field.getPlayerPokemon();
      terapagos.isTerastallized = true; // its Stellar Form
      setAttackStats(terapagos, 100, 120);
      terapagos.setStatStage(Stat.ATK, 1);

      expect(categoryOf(terapagos, MoveId.TERA_STARSTORM)).toBe(MoveCategory.PHYSICAL);
      expect(terapagos.getMoveType(allMoves[MoveId.TERA_STARSTORM])).toBe(PokemonType.STELLAR);
    });
  });

  describe("Tera Starstorm targets", () => {
    beforeEach(() => {
      game.override.battleStyle("double").enemySpecies(SpeciesId.TERAPAGOS);
    });

    it("hits both opponents when used by a Terastallized Terapagos", async () => {
      game.override.enemySpecies(SpeciesId.SNORLAX);
      await game.classicMode.startBattle(SpeciesId.TERAPAGOS, SpeciesId.MAGIKARP);
      const terapagos = game.field.getPlayerPokemon();
      terapagos.isTerastallized = true; // its Stellar Form

      game.move.use(MoveId.TERA_STARSTORM, BattlerIndex.PLAYER);
      game.move.use(MoveId.SPLASH, BattlerIndex.PLAYER_2);
      await game.toEndOfTurn();

      for (const enemy of game.scene.getEnemyField()) {
        expect(strikesBy(enemy, MoveId.TERA_STARSTORM)).toBe(1);
      }
    });

    it("an enemy Terapagos spreads it when it Terastallizes this turn, not when the player does", async () => {
      await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.MAGIKARP);
      const battle = game.scene.currentBattle;
      const enemy = game.scene.getEnemyField()[0];
      enemy.isTerastallized = false;
      const spreads = () => getMoveTargets(enemy, MoveId.TERA_STARSTORM).multiple;

      expect(spreads()).toBe(false);
      // The player's Tera command in the same field slot is not the enemy's (upstream read it by field index)
      battle.preTurnCommands[BattlerIndex.PLAYER] = { command: Command.TERA };
      expect(spreads()).toBe(false);
      battle.preTurnCommands[BattlerIndex.ENEMY] = { command: Command.TERA };
      expect(spreads()).toBe(true);
      battle.preTurnCommands[BattlerIndex.ENEMY] = null;

      // An enemy trainer decides to Terastallize after picking its move: its `shouldTera` counts as well
      const realTrainer = battle.trainer;
      battle.trainer = { shouldTera: () => true } as unknown as Trainer;
      try {
        expect(spreads()).toBe(true);
      } finally {
        battle.trainer = realTrainer;
      }
    });
  });
});
