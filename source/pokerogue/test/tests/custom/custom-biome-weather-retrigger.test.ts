// Local fork (2026-11-14): weather-setting abilities re-fire when the biome changes. Upstream's
// PostBiomeChangeWeatherChangeAbAttr.canApply was inverted (it needed the current weather to be immutable), so they
// never did. The rule now matches PostSummonWeatherChangeAbAttr.
import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { getGameMode } from "#app/game-mode";
import { AbilityId } from "#enums/ability-id";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { WeatherType } from "#enums/weather-type";
import { Arena } from "#field/arena";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Weather abilities on a biome change", () => {
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
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyHasPassiveAbility(false)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .hasPassiveAbility(false)
      .moveset([MoveId.SPLASH])
      .mysteryEncounterChance(0);
  });

  /** Puts a biome-style weather (no user, so no duration) in place, as `Arena.setBiomeWeather` does. */
  function setBiomeWeather(weather: WeatherType): void {
    game.scene.arena.trySetWeather(WeatherType.NONE);
    game.scene.arena.trySetWeather(weather);
  }

  function fireBiomeChange(): void {
    applyAbAttrs("PostBiomeChangeAbAttr", { pokemon: game.field.getPlayerPokemon() });
  }

  it.each([
    { ability: AbilityId.DROUGHT, weather: WeatherType.SUNNY },
    { ability: AbilityId.DRIZZLE, weather: WeatherType.RAIN },
    { ability: AbilityId.SAND_STREAM, weather: WeatherType.SANDSTORM },
    { ability: AbilityId.SNOW_WARNING, weather: WeatherType.SNOW },
    { ability: AbilityId.FULL_BLOOM, weather: WeatherType.SUNNY },
    { ability: AbilityId.SOLAR_PULSE, weather: WeatherType.SUNNY },
    { ability: AbilityId.SAND_TEMPEST, weather: WeatherType.SANDSTORM },
    { ability: AbilityId.IRON_SAND, weather: WeatherType.SANDSTORM },
    { ability: AbilityId.COLD_SNAP, weather: WeatherType.SNOW },
  ])("$ability replaces the new biome's weather with its own for 5 turns", async ({ ability, weather }) => {
    game.override.ability(ability);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    setBiomeWeather(weather === WeatherType.FOG ? WeatherType.RAIN : WeatherType.FOG);

    fireBiomeChange();

    expect(game).toHaveWeather(weather);
    expect(game.scene.arena.weather?.turnsLeft).toBe(5);
  });

  it("works as a passive", async () => {
    game.override.passiveAbility(AbilityId.DROUGHT).hasPassiveAbility(true);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    setBiomeWeather(WeatherType.RAIN);

    fireBiomeChange();

    expect(game).toHaveWeather(WeatherType.SUNNY);
    expect(game.scene.arena.weather?.turnsLeft).toBe(5);
  });

  it("leaves the biome's weather alone when it is already the same weather", async () => {
    game.override.ability(AbilityId.DROUGHT);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    setBiomeWeather(WeatherType.SUNNY);
    const showAbility = vi.spyOn(game.scene.phaseManager, "unshiftNew");

    fireBiomeChange();

    expect(game).toHaveWeather(WeatherType.SUNNY);
    expect(game.scene.arena.weather?.turnsLeft).toBe(0);
    expect(showAbility.mock.calls.some(([phase]) => phase === "ShowAbilityPhase")).toBe(false);
  });

  it("cannot replace primal weather, but another primal weather can", async () => {
    game.override.ability(AbilityId.DROUGHT);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    setBiomeWeather(WeatherType.HEAVY_RAIN);

    fireBiomeChange();
    expect(game).toHaveWeather(WeatherType.HEAVY_RAIN);

    game.field.mockAbility(game.field.getPlayerPokemon(), AbilityId.DESOLATE_LAND);
    fireBiomeChange();
    expect(game).toHaveWeather(WeatherType.HARSH_SUN);
  });

  it("re-fires in a real Endless biome change (wave 85 to 86)", async () => {
    game.override.ability(AbilityId.DRIZZLE).startingWave(85);
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.ENDLESS);
      game.scene.offsetGym = false;
      const starters = generateStarters(game.scene, [SpeciesId.FEEBAS]);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    await game.phaseInterceptor.to("EncounterPhase");
    game.removeEnemyHeldItems();
    await game.phaseInterceptor.to("CommandPhase", false);
    expect(game).toHaveWeather(WeatherType.RAIN);

    // The new biome rolls sun; Drizzle must turn it back into rain once the player's Pokémon arrives there
    vi.spyOn(Arena.prototype, "setBiomeWeather").mockImplementation(function (this: Arena) {
      this.trySetWeather(WeatherType.SUNNY);
    });
    game.move.select(MoveId.SPLASH);
    await game.doKillOpponents();
    await game.toNextWave();

    expect(game.scene.currentBattle.waveIndex).toBe(86);
    expect(game.phaseInterceptor.phaseLog).toContain("NewBiomeEncounterPhase");
    expect(game).toHaveWeather(WeatherType.RAIN);
  });
});
