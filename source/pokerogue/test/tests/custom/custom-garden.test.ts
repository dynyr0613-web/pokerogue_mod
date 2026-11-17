// Local fork (2026-11-14): custom moves. Tests of the Garden (정원, `ArenaTagType.GARDEN`;
// tools/drive/custom_moves_1114/design_spec.json "effects"): Grassy Terrain's three direct effects (Grass moves x1.3,
// the end-of-turn 1/16 heal, Earthquake / Bulldoze / Magnitude halved) for the grounded Pokémon on one side only,
// once even under real Grassy Terrain; cleared from both sides by Defog, Steel Roller and Ice Spinner; swapped by
// Court Change; kept in a session save. The Garden is laid directly here: the move Gardening (정원가꾸기) is tested in
// custom-moves-1114.test.ts, and the ability Gardener (정원사) in custom-gardener.test.ts.
import { getPokemonNameWithAffix } from "#app/messages";
import { allMoves } from "#data/data-lists";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { ArenaData } from "#system/arena-data";
import { GameManager } from "#test/framework/game-manager";
import { toDmgValue } from "#utils/common";
import i18next from "i18next";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Custom field effect - Garden", () => {
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
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.STURDY)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH, MoveId.ENERGY_BALL]);
  });

  /** Lays a Garden on `side`, as Gardening / Gardener would (no source move) */
  function plantGarden(side: ArenaTagSide.PLAYER | ArenaTagSide.ENEMY, turns = 5, sourceId = 0): void {
    game.scene.arena.addTag(ArenaTagType.GARDEN, turns, undefined, sourceId, side);
  }

  /** Damages `pokemon` to half HP, so a 1/16 heal shows in full */
  function halveHp(pokemon: Pokemon): number {
    pokemon.hp = Math.floor(pokemon.getMaxHp() / 2);
    return pokemon.hp;
  }

  describe("the tag", () => {
    it("lies on one side only, lasts 5 turns counting down, and shows its start and end messages", async () => {
      await game.classicMode.startBattle(SpeciesId.BLISSEY);

      plantGarden(ArenaTagSide.PLAYER);
      expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.PLAYER, turnCount: 5 });
      expect(game).not.toHaveArenaTag(ArenaTagType.GARDEN, ArenaTagSide.ENEMY);

      for (let left = 4; left >= 1; left--) {
        game.move.select(MoveId.SPLASH);
        await game.toNextTurn();
        expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.PLAYER, turnCount: left });
      }
      expect(game).toHaveShownMessage(i18next.t("arenaTag:gardenOnAddPlayer"));
      expect(game).not.toHaveShownMessage(i18next.t("arenaTag:gardenOnRemovePlayer"));

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(game).not.toHaveArenaTag(ArenaTagType.GARDEN);
      expect(game).toHaveShownMessage(i18next.t("arenaTag:gardenOnRemovePlayer"));
    });

    it("uses the enemy-side messages on the enemy's side", async () => {
      await game.classicMode.startBattle(SpeciesId.BLISSEY);

      plantGarden(ArenaTagSide.ENEMY, 1);
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(game).toHaveShownMessage(i18next.t("arenaTag:gardenOnAddEnemy"));
      expect(game).toHaveShownMessage(i18next.t("arenaTag:gardenOnRemoveEnemy"));
    });

    it("stays when the Pokémon on its side switch out", async () => {
      await game.classicMode.startBattle(SpeciesId.BLISSEY, SpeciesId.CHANSEY);

      plantGarden(ArenaTagSide.PLAYER);
      game.doSwitchPokemon(1);
      await game.toNextTurn();

      expect(game.field.getPlayerPokemon().species.speciesId).toBe(SpeciesId.CHANSEY);
      expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.PLAYER, turnCount: 4 });
    });

    it("can lie on both sides at once, each for its own side", async () => {
      await game.classicMode.startBattle(SpeciesId.BLISSEY);

      plantGarden(ArenaTagSide.PLAYER, 5);
      plantGarden(ArenaTagSide.ENEMY, 3);

      expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.PLAYER, turnCount: 5 });
      expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.ENEMY, turnCount: 3 });
    });
  });

  describe("Grass moves x1.3", () => {
    it("boosts a grounded Pokémon on the Garden's side only", async () => {
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const energyBall = allMoves[MoveId.ENERGY_BALL];

      expect(energyBall.calculateBattlePower(player, enemy)).toBe(90);
      plantGarden(ArenaTagSide.PLAYER);

      expect(energyBall.calculateBattlePower(player, enemy)).toBeCloseTo(90 * 1.3);
      // The enemy's side has no Garden
      expect(energyBall.calculateBattlePower(enemy, player)).toBe(90);
      // Other types are untouched
      expect(allMoves[MoveId.TACKLE].calculateBattlePower(player, enemy)).toBe(40);
    });

    it("does not boost a Flying-type on the Garden's side", async () => {
      await game.classicMode.startBattle(SpeciesId.PIDGEOT);
      const player = game.field.getPlayerPokemon();

      plantGarden(ArenaTagSide.PLAYER);

      expect(player.isGrounded()).toBe(false);
      expect(allMoves[MoveId.ENERGY_BALL].calculateBattlePower(player, game.field.getEnemyPokemon())).toBe(90);
    });

    it("does not boost a Levitate holder on the Garden's side", async () => {
      game.override.passiveAbility(AbilityId.LEVITATE);
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const player = game.field.getPlayerPokemon();

      plantGarden(ArenaTagSide.PLAYER);

      expect(player.isGrounded()).toBe(false);
      expect(allMoves[MoveId.ENERGY_BALL].calculateBattlePower(player, game.field.getEnemyPokemon())).toBe(90);
    });

    it("boosts once, not twice, under Grassy Terrain", async () => {
      game.override.startingTerrain(TerrainType.GRASSY);
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const energyBall = allMoves[MoveId.ENERGY_BALL];

      expect(energyBall.calculateBattlePower(player, enemy)).toBeCloseTo(90 * 1.3);
      plantGarden(ArenaTagSide.PLAYER);
      expect(energyBall.calculateBattlePower(player, enemy)).toBeCloseTo(90 * 1.3);
    });

    it("keeps Electric Terrain's boost next to it", async () => {
      game.override.startingTerrain(TerrainType.ELECTRIC);
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      plantGarden(ArenaTagSide.PLAYER);

      expect(allMoves[MoveId.THUNDERBOLT].calculateBattlePower(player, enemy)).toBeCloseTo(90 * 1.3);
      expect(allMoves[MoveId.ENERGY_BALL].calculateBattlePower(player, enemy)).toBeCloseTo(90 * 1.3);
      expect(game).toHaveTerrain(TerrainType.ELECTRIC);
    });

    it("still boosts after Grassy Terrain ends first", async () => {
      game.override.startingTerrain(TerrainType.GRASSY);
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const player = game.field.getPlayerPokemon();

      plantGarden(ArenaTagSide.PLAYER);
      game.scene.arena.trySetTerrain(TerrainType.NONE, true);

      expect(game).toHaveTerrain(TerrainType.NONE);
      expect(game).toHaveArenaTag(ArenaTagType.GARDEN, ArenaTagSide.PLAYER);
      expect(allMoves[MoveId.ENERGY_BALL].calculateBattlePower(player, game.field.getEnemyPokemon())).toBeCloseTo(
        90 * 1.3,
      );
    });
  });

  describe("end-of-turn heal", () => {
    it("heals a grounded Pokémon on the Garden's side by 1/16, with Grassy Terrain's message", async () => {
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const playerHp = halveHp(player);
      const enemyHp = halveHp(enemy);

      plantGarden(ArenaTagSide.PLAYER);
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(player.hp).toBe(playerHp + toDmgValue(player.getMaxHp() / 16));
      expect(enemy.hp).toBe(enemyHp);
      expect(game).toHaveShownMessage(
        i18next.t("battle:turnEndHpRestore", { pokemonName: getPokemonNameWithAffix(player) }),
      );
    });

    it("heals the enemy on its own Garden", async () => {
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const playerHp = halveHp(player);
      const enemyHp = halveHp(enemy);

      plantGarden(ArenaTagSide.ENEMY);
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(enemy.hp).toBe(enemyHp + toDmgValue(enemy.getMaxHp() / 16));
      expect(player.hp).toBe(playerHp);
    });

    it("does not heal a Flying-type", async () => {
      await game.classicMode.startBattle(SpeciesId.PIDGEOT);
      const player = game.field.getPlayerPokemon();
      const hp = halveHp(player);

      plantGarden(ArenaTagSide.PLAYER);
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(player.hp).toBe(hp);
    });

    it("does not heal under Heal Block", async () => {
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const player = game.field.getPlayerPokemon();
      const hp = halveHp(player);
      player.addTag(BattlerTagType.HEAL_BLOCK, 5);

      plantGarden(ArenaTagSide.PLAYER);
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(player.hp).toBe(hp);
    });

    it("heals once, not twice, under Grassy Terrain", async () => {
      game.override.startingTerrain(TerrainType.GRASSY);
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const player = game.field.getPlayerPokemon();
      const hp = halveHp(player);

      plantGarden(ArenaTagSide.PLAYER);
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(player.hp).toBe(hp + toDmgValue(player.getMaxHp() / 16));
    });

    it("heals a boss through the same path as Grassy Terrain (same HP and health bar segment)", async () => {
      game.override.enemyHealthSegments(3).startingTerrain(TerrainType.GRASSY);
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const enemy = game.field.getEnemyPokemon();
      expect(enemy.isBoss()).toBe(true);
      // Just under the first segment boundary, so a 1/16 heal crosses it
      const startHp = Math.ceil((enemy.getMaxHp() * 2) / 3) - 5;

      enemy.hp = startHp;
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      const grassy = { hp: enemy.hp, segment: enemy.bossSegmentIndex };
      expect(grassy.hp).toBeGreaterThan(startHp);

      game.scene.arena.trySetTerrain(TerrainType.NONE, true);
      plantGarden(ArenaTagSide.ENEMY);
      enemy.hp = startHp;
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect({ hp: enemy.hp, segment: enemy.bossSegmentIndex }).toEqual(grassy);
    });
  });

  describe("Earthquake, Bulldoze and Magnitude x0.5", () => {
    it("halves them against a grounded Pokémon on the Garden's side only", async () => {
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const magnitude = allMoves[MoveId.MAGNITUDE];
      // Magnitude's roll is seeded by the turn, so it is the same within this test
      const magnitudePower = magnitude.calculateBattlePower(enemy, player);

      plantGarden(ArenaTagSide.PLAYER);

      expect(allMoves[MoveId.EARTHQUAKE].calculateBattlePower(enemy, player)).toBe(50);
      expect(allMoves[MoveId.BULLDOZE].calculateBattlePower(enemy, player)).toBe(30);
      expect(magnitude.calculateBattlePower(enemy, player)).toBe(magnitudePower / 2);
      // Against the enemy's side (no Garden) they stay as they are
      expect(allMoves[MoveId.EARTHQUAKE].calculateBattlePower(player, enemy)).toBe(100);
      expect(allMoves[MoveId.BULLDOZE].calculateBattlePower(player, enemy)).toBe(60);
    });

    it("halves an ally's Earthquake against its partner on the Garden's side too", async () => {
      game.override.battleStyle("double");
      await game.classicMode.startBattle(SpeciesId.BLISSEY, SpeciesId.CHANSEY);
      const [blissey, chansey] = game.scene.getPlayerField();
      const [enemy] = game.scene.getEnemyField();

      plantGarden(ArenaTagSide.PLAYER);

      expect(allMoves[MoveId.EARTHQUAKE].calculateBattlePower(blissey, chansey)).toBe(50);
      expect(allMoves[MoveId.EARTHQUAKE].calculateBattlePower(blissey, enemy)).toBe(100);
    });

    it("halves once, not twice, under Grassy Terrain", async () => {
      game.override.startingTerrain(TerrainType.GRASSY);
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      plantGarden(ArenaTagSide.PLAYER);

      expect(allMoves[MoveId.EARTHQUAKE].calculateBattlePower(enemy, player)).toBe(50);
    });
  });

  describe("is not a terrain", () => {
    it("gives Grassy Glide no priority, Terrain Pulse no type change, Grass Pelt no Defense", async () => {
      game.override.ability(AbilityId.GRASS_PELT);
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const player = game.field.getPlayerPokemon();
      const defense = player.getEffectiveStat(Stat.DEF);

      plantGarden(ArenaTagSide.PLAYER);

      expect(allMoves[MoveId.GRASSY_GLIDE].getPriority(player)).toBe(0);
      expect(player.getMoveType(allMoves[MoveId.TERRAIN_PULSE])).toBe(PokemonType.NORMAL);
      expect(player.getEffectiveStat(Stat.DEF)).toBe(defense);
      expect(game).toHaveTerrain(TerrainType.NONE);
    });

    it("(control) Grassy Terrain itself gives all three", async () => {
      game.override.ability(AbilityId.GRASS_PELT).startingTerrain(TerrainType.GRASSY);
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const player = game.field.getPlayerPokemon();

      expect(allMoves[MoveId.GRASSY_GLIDE].getPriority(player)).toBe(1);
      expect(player.getMoveType(allMoves[MoveId.TERRAIN_PULSE])).toBe(PokemonType.GRASS);
    });
  });

  describe("removal", () => {
    it("Defog clears the Garden on both sides, the user's included, with both end messages", async () => {
      await game.classicMode.startBattle(SpeciesId.BLISSEY);

      plantGarden(ArenaTagSide.PLAYER);
      plantGarden(ArenaTagSide.ENEMY);
      game.move.use(MoveId.DEFOG);
      await game.toEndOfTurn();

      expect(game).not.toHaveArenaTag(ArenaTagType.GARDEN);
      expect(game).toHaveShownMessage(i18next.t("arenaTag:gardenOnRemovePlayer"));
      expect(game).toHaveShownMessage(i18next.t("arenaTag:gardenOnRemoveEnemy"));
    });

    it("Steel Roller succeeds with only a Garden up (no terrain) and clears both sides", async () => {
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      plantGarden(ArenaTagSide.PLAYER);
      plantGarden(ArenaTagSide.ENEMY);
      game.move.use(MoveId.STEEL_ROLLER);
      await game.toEndOfTurn();

      expect(player).toHaveUsedMove({ move: MoveId.STEEL_ROLLER, result: MoveResult.SUCCESS });
      expect(enemy).not.toHaveFullHp();
      expect(game).not.toHaveArenaTag(ArenaTagType.GARDEN);
    });

    it("Steel Roller succeeds with a Garden on the user's side only", async () => {
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const player = game.field.getPlayerPokemon();

      plantGarden(ArenaTagSide.PLAYER);
      game.move.use(MoveId.STEEL_ROLLER);
      await game.toEndOfTurn();

      expect(player).toHaveUsedMove({ move: MoveId.STEEL_ROLLER, result: MoveResult.SUCCESS });
      expect(game).not.toHaveArenaTag(ArenaTagType.GARDEN);
    });

    it("(control) Steel Roller still fails with neither a terrain nor a Garden", async () => {
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const player = game.field.getPlayerPokemon();

      game.move.use(MoveId.STEEL_ROLLER);
      await game.toEndOfTurn();

      expect(player).toHaveUsedMove({ move: MoveId.STEEL_ROLLER, result: MoveResult.FAIL });
      expect(game.field.getEnemyPokemon()).toHaveFullHp();
    });

    it("Ice Spinner clears the Garden on both sides", async () => {
      await game.classicMode.startBattle(SpeciesId.BLISSEY);

      plantGarden(ArenaTagSide.PLAYER);
      plantGarden(ArenaTagSide.ENEMY);
      game.move.use(MoveId.ICE_SPINNER);
      await game.toEndOfTurn();

      expect(game).not.toHaveArenaTag(ArenaTagType.GARDEN);
    });

    it.each([
      { name: "Brick Break", move: MoveId.BRICK_BREAK },
      { name: "Psychic Fangs", move: MoveId.PSYCHIC_FANGS },
    ])("$name breaks screens but leaves the Garden", async ({ move }) => {
      await game.classicMode.startBattle(SpeciesId.BLISSEY);

      plantGarden(ArenaTagSide.ENEMY);
      game.scene.arena.addTag(ArenaTagType.REFLECT, 5, MoveId.REFLECT, 0, ArenaTagSide.ENEMY);
      game.move.use(move);
      await game.toEndOfTurn();

      expect(game).not.toHaveArenaTag(ArenaTagType.REFLECT, ArenaTagSide.ENEMY);
      expect(game).toHaveArenaTag(ArenaTagType.GARDEN, ArenaTagSide.ENEMY);
    });
  });

  describe("swap and save", () => {
    it("Court Change moves the Garden across with its remaining turns", async () => {
      await game.classicMode.startBattle(SpeciesId.BLISSEY);

      plantGarden(ArenaTagSide.PLAYER, 3);
      game.move.use(MoveId.COURT_CHANGE);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
      await game.toNextTurn();

      // 3 turns left, one counted down at the end of the turn, now on the enemy's side
      expect(game).not.toHaveArenaTag(ArenaTagType.GARDEN, ArenaTagSide.PLAYER);
      expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.ENEMY, turnCount: 2 });
      // Quietly: no start message for the moved Garden
      expect(game).not.toHaveShownMessage(i18next.t("arenaTag:gardenOnAddEnemy"));
    });

    it("is kept in the session save with its side and remaining turns", async () => {
      await game.classicMode.startBattle(SpeciesId.BLISSEY);

      plantGarden(ArenaTagSide.ENEMY, 4);

      const { gameData } = game.scene;
      const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
      const arena = gameData.parseSessionData(json).arena;
      expect(arena).toBeInstanceOf(ArenaData);
      const garden = arena.tags.find(t => t.tagType === ArenaTagType.GARDEN);
      expect(garden?.side).toBe(ArenaTagSide.ENEMY);
      expect(garden?.turnCount).toBe(4);
      expect(garden?.maxDuration).toBe(4);
    });

    it("has a field flyout name", () => {
      expect(i18next.t("arenaFlyout:garden")).toBe("Garden");
    });
  });
});
