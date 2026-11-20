// Local fork (2026-11-20): developer settings (the user: "개발용 설정을 약간 손보자"; docs/1.2.0_후보_개정_20261120.md 7).
// (a) A run started in another biome through STARTING_BIOME_OVERRIDE loads that biome's art before its first battle;
// without the override nothing changes. (b) The Dev Bridge's startRun() gives starters without "moves" the starter
// select's moves (they used to have none and could only Struggle) and sets given "moves" as they are. (c) Why the
// Mystery Encounter override did not turn Classic wave 112 into an encounter (it is the evil team grunt's fixed
// battle), and the bridge's encounter() that makes the next new wave the chosen encounter, one wave only.

import { devBridgeApi } from "#app/dev-bridge/dev-bridge";
import { getGameMode } from "#app/game-mode";
import { activeOverrides } from "#app/overrides";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { WeatherType } from "#enums/weather-type";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import type { MessageUiHandler } from "#ui/message-ui-handler";
import { getStarterMoves } from "#ui/starter-select-ui-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Developer settings (1.2.0)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single");
  });

  afterEach(() => {
    devBridgeApi.encounter(null);
  });

  /** From the title, start a Classic run the way the starter select does and stop before its first EncounterPhase */
  async function startClassicRun(): Promise<void> {
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.CLASSIC);
      const starters = generateStarters(game.scene, [SpeciesId.CHARMANDER]);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    await game.phaseInterceptor.to("EncounterPhase", false);
  }

  describe("(a) starting biome override", () => {
    it("loads the biome's background and bases before the first battle", async () => {
      vi.spyOn(activeOverrides, "STARTING_BIOME_OVERRIDE", "get").mockReturnValue(BiomeId.FACTORY);
      game.override.startingBiome(BiomeId.FACTORY);
      const scene = game.scene;
      const order: string[] = [];
      const loadBiomeAssets = scene.loadBiomeAssets.bind(scene);
      const loadSpy = vi.spyOn(scene, "loadBiomeAssets").mockImplementation(async (biome: BiomeId) => {
        await loadBiomeAssets(biome);
        order.push(`loaded ${biome}`);
      });
      const newBattle = scene.newBattle.bind(scene);
      vi.spyOn(scene, "newBattle").mockImplementation((...args) => {
        order.push("newBattle");
        return newBattle(...args);
      });
      const requested: string[] = [];
      vi.spyOn(scene.load, "image").mockImplementation((key: any) => {
        requested.push(String(key));
        return scene.load;
      });

      await startClassicRun();

      expect(loadSpy).toHaveBeenCalledWith(BiomeId.FACTORY);
      expect(requested).toEqual(expect.arrayContaining(["factory_bg", "factory_a", "factory_b"]));
      expect(order.indexOf(`loaded ${BiomeId.FACTORY}`)).toBeGreaterThanOrEqual(0);
      expect(order.indexOf(`loaded ${BiomeId.FACTORY}`)).toBeLessThan(order.indexOf("newBattle"));
      expect(scene.arena.biomeId).toBe(BiomeId.FACTORY);
    });

    it("loads nothing extra without the override (a normal run starts as before)", async () => {
      game.override.startingBiome(BiomeId.FACTORY);
      const loadSpy = vi.spyOn(game.scene, "loadBiomeAssets");

      await startClassicRun();

      expect(loadSpy).not.toHaveBeenCalled();
      expect(game.scene.currentBattle.waveIndex).toBe(1);
    });
  });

  describe("(b) Dev Bridge startRun moves", () => {
    it("gives starters the starter select's moves, sets given moves as they are, and generates them for an evolved form", async () => {
      await game.runToTitle();
      let result = "";
      game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
        result = devBridgeApi.startRun({
          mode: "CLASSIC",
          starters: [
            { species: "CHARMANDER" },
            { species: "BULBASAUR", moves: ["THUNDERBOLT", "SURF"] },
            { species: "CHARMELEON" },
          ],
        });
      });
      await game.phaseInterceptor.to("EncounterPhase", false);

      const [charmander, bulbasaur, charmeleon] = game.scene.getPlayerParty();
      const charmanderMoves = charmander.moveset.map(m => m.moveId);
      expect(charmanderMoves.length).toBeGreaterThan(0);
      expect(charmanderMoves).toEqual(getStarterMoves(SpeciesId.CHARMANDER, 0).slice(0, 4));
      expect(charmanderMoves).toContain(MoveId.SCRATCH);
      expect(bulbasaur.moveset.map(m => m.moveId)).toEqual([MoveId.THUNDERBOLT, MoveId.SURF]);
      expect(charmeleon.species.speciesId).toBe(SpeciesId.CHARMELEON);
      expect(charmeleon.moveset.length).toBeGreaterThan(0);
      expect(result).toContain("SCRATCH");
    });

    it("uses the moveset saved in the starter select, without moves it no longer allows, filled up like there", async () => {
      await game.runToTitle();
      const starterMoves = getStarterMoves(SpeciesId.CHARMANDER, 0);
      const kept = starterMoves.at(-1)!;
      game.scene.gameData.starterData[SpeciesId.CHARMANDER].moveset = [MoveId.SURF, kept];
      game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
        devBridgeApi.startRun({ mode: "CLASSIC", starters: [{ species: "CHARMANDER" }] });
      });
      await game.phaseInterceptor.to("EncounterPhase", false);

      const moves = game.scene.getPlayerParty()[0].moveset.map(m => m.moveId);
      expect(moves).toEqual([kept, ...starterMoves.filter(m => m !== kept)].slice(0, 4));
      expect(moves).not.toContain(MoveId.SURF);
    });
  });

  describe("(c) Mystery Encounter override and encounter()", () => {
    it("the override never turns Classic wave 112 into an encounter: it is the evil team grunt's fixed battle", async () => {
      game.override
        .startingWave(112)
        .mysteryEncounter(MysteryEncounterType.DEPARTMENT_STORE_SALE)
        .mysteryEncounterChance(100);

      await startClassicRun();

      expect(game.scene.gameMode.isFixedBattle(112)).toBe(true);
      expect(game.scene.currentBattle.battleType).toBe(BattleType.TRAINER);
    });

    it("encounter() makes the next new wave the chosen encounter, even a fixed battle, then puts everything back", async () => {
      game.override.startingWave(112);
      const battleTypeOverride = Object.getOwnPropertyDescriptor(activeOverrides, "BATTLE_TYPE_OVERRIDE");
      await game.runToTitle();
      expect(devBridgeApi.encounter("DEPARTMENT_STORE_SALE")).toContain("DEPARTMENT_STORE_SALE");
      game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
        game.scene.gameMode = getGameMode(GameModes.CLASSIC);
        const starters = generateStarters(game.scene, [SpeciesId.CHARMANDER]);
        game.scene.phaseManager.pushNew("EncounterPhase", false);
        new SelectStarterPhase().initBattle(starters);
      });
      game.onNextPrompt(
        "EncounterPhase",
        UiMode.MESSAGE,
        () => (game.scene.ui.getHandler() as MessageUiHandler).processInput(Button.ACTION),
        () => game.isCurrentPhase("MysteryEncounterPhase"),
        true,
      );
      await game.phaseInterceptor.to("EncounterPhase");

      const battle = game.scene.currentBattle;
      expect(battle.waveIndex).toBe(112);
      expect(battle.battleType).toBe(BattleType.MYSTERY_ENCOUNTER);
      expect(battle.trainer).toBeNull();
      expect(battle.mysteryEncounter?.encounterType).toBe(MysteryEncounterType.DEPARTMENT_STORE_SALE);
      // One wave only, and nothing left patched
      expect(game.scene.gameMode.isFixedBattle(112)).toBe(true);
      expect(Object.hasOwn(game.scene.gameMode, "isFixedBattle")).toBe(false);
      expect(Object.hasOwn(game.scene, "isWaveMysteryEncounter")).toBe(false);
      expect(Object.getOwnPropertyDescriptor(activeOverrides, "BATTLE_TYPE_OVERRIDE")).toEqual(battleTypeOverride);
      expect(activeOverrides.BATTLE_TYPE_OVERRIDE).toBeNull();
    });

    it("encounter(null) cancels, and an unknown encounter is refused", async () => {
      game.override.startingWave(112);
      await game.runToTitle();
      devBridgeApi.encounter("DEPARTMENT_STORE_SALE");
      expect(devBridgeApi.encounter(null)).toBe("no forced encounter");
      expect(() => devBridgeApi.encounter("NOT_AN_ENCOUNTER")).toThrow();
      game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
        game.scene.gameMode = getGameMode(GameModes.CLASSIC);
        const starters = generateStarters(game.scene, [SpeciesId.CHARMANDER]);
        game.scene.phaseManager.pushNew("EncounterPhase", false);
        new SelectStarterPhase().initBattle(starters);
      });
      await game.phaseInterceptor.to("EncounterPhase", false);

      expect(game.scene.currentBattle.battleType).toBe(BattleType.TRAINER);
    });

    it("override() takes the enum overrides by name", () => {
      const before = {
        STARTING_BIOME_OVERRIDE: activeOverrides.STARTING_BIOME_OVERRIDE,
        MYSTERY_ENCOUNTER_OVERRIDE: activeOverrides.MYSTERY_ENCOUNTER_OVERRIDE,
        ENEMY_SPECIES_OVERRIDE: activeOverrides.ENEMY_SPECIES_OVERRIDE,
        ENEMY_ABILITY_OVERRIDE: activeOverrides.ENEMY_ABILITY_OVERRIDE,
        WEATHER_OVERRIDE: activeOverrides.WEATHER_OVERRIDE,
        MOVESET_OVERRIDE: activeOverrides.MOVESET_OVERRIDE,
        ENEMY_MOVESET_OVERRIDE: activeOverrides.ENEMY_MOVESET_OVERRIDE,
      };
      try {
        expect(
          devBridgeApi.override({
            STARTING_BIOME_OVERRIDE: "FACTORY",
            MYSTERY_ENCOUNTER_OVERRIDE: "SHADY_VITAMIN_DEALER",
            ENEMY_SPECIES_OVERRIDE: "PIKACHU",
            ENEMY_ABILITY_OVERRIDE: "INTIMIDATE",
            WEATHER_OVERRIDE: "RAIN",
            MOVESET_OVERRIDE: ["SURF", "THUNDERBOLT"],
            ENEMY_MOVESET_OVERRIDE: "SPLASH",
          }),
        ).toEqual({
          STARTING_BIOME_OVERRIDE: BiomeId.FACTORY,
          MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType.SHADY_VITAMIN_DEALER,
          ENEMY_SPECIES_OVERRIDE: SpeciesId.PIKACHU,
          ENEMY_ABILITY_OVERRIDE: AbilityId.INTIMIDATE,
          WEATHER_OVERRIDE: WeatherType.RAIN,
          MOVESET_OVERRIDE: [MoveId.SURF, MoveId.THUNDERBOLT],
          ENEMY_MOVESET_OVERRIDE: MoveId.SPLASH,
        });
        expect(activeOverrides.STARTING_BIOME_OVERRIDE).toBe(BiomeId.FACTORY);
        expect(() => devBridgeApi.override({ STARTING_BIOME_OVERRIDE: "NOWHERE" })).toThrow();
        // A name for a number override without names is refused instead of being stored and matching nothing
        expect(() => devBridgeApi.override({ ENEMY_LEVEL_OVERRIDE: "50" })).toThrow();
      } finally {
        devBridgeApi.override(before);
      }
    });
  });
});
