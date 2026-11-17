import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { getCustomPassive } from "#balance/custom-passives";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { FormChangeItem } from "#enums/form-change-item";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import type { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { enemyRollsCustomPassive } from "#field/pokemon";
import { FormChangeItemModifierType } from "#modifiers/modifier-type";
import { mysteryEncountersByBiome } from "#mystery-encounters/mystery-encounter-biomes";
import { SeenEncounterData } from "#mystery-encounters/mystery-encounter-save-data";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import type { BattleMessageUiHandler } from "#ui/battle-message-ui-handler";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** The first id at or after `start` whose enemy custom-passive roll is `wanted` */
function idWithRoll(wanted: boolean, start = 1): number {
  let id = start;
  while (enemyRollsCustomPassive(id) !== wanted) {
    id++;
  }
  return id;
}

describe("Custom Endless and persistence", () => {
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
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH]);
  });

  /**
   * Start a new run in a non-Classic mode the way the title screen would, with no gym offset,
   * and stop once the first wave's `EncounterPhase` has started.
   */
  async function runToEncounter(mode: GameModes, species: SpeciesId[], dismissEncounterMessage = false): Promise<void> {
    await game.runToTitle();

    // Prompts are checked head first, so the title prompt must be queued before any later one
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(mode);
      game.scene.offsetGym = false;
      const starters = generateStarters(game.scene, species);
      const selectStarterPhase = new SelectStarterPhase();
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      selectStarterPhase.initBattle(starters);
    });

    if (dismissEncounterMessage) {
      // A Mystery Encounter's intro message waits for the player; press through it
      game.onNextPrompt(
        "EncounterPhase",
        UiMode.MESSAGE,
        () => {
          const handler = game.scene.ui.getHandler() as BattleMessageUiHandler;
          handler.processInput(Button.ACTION);
        },
        () => game.isCurrentPhase("MysteryEncounterPhase"),
        true,
      );
    }

    // Treat every battle entry dialogue as already seen
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);

    await game.phaseInterceptor.to("EncounterPhase");
  }

  /** {@linkcode runToEncounter}, then play through to the first `CommandPhase`. */
  async function runToCommand(mode: GameModes, species: SpeciesId[]): Promise<void> {
    await runToEncounter(mode, species);
    game.removeEnemyHeldItems();
    await game.phaseInterceptor.to("CommandPhase", false);
  }

  describe("Endless battles", () => {
    it.each([GameModes.ENDLESS, GameModes.SPLICED_ENDLESS])("%s wave 80 is a trainer battle", async mode => {
      game.override.startingWave(80);
      await runToCommand(mode, [SpeciesId.FEEBAS]);

      const { currentBattle, gameMode } = game.scene;
      expect(gameMode.modeId).toBe(mode);
      expect(game.scene.offsetGym).toBe(false);
      expect(currentBattle.waveIndex).toBe(80);
      expect(currentBattle.battleType).toBe(BattleType.TRAINER);
      expect(currentBattle.trainer).toBeDefined();
      expect(currentBattle.isBattleMysteryEncounter()).toBe(false);
      expect(game.scene.getEnemyParty().length).toBeGreaterThan(0);
    });

    it("Endless wave 50 is a wild boss, not a trainer", async () => {
      game.override.startingWave(50);
      await runToCommand(GameModes.ENDLESS, [SpeciesId.FEEBAS]);

      const { currentBattle, gameMode } = game.scene;
      expect(game.scene.offsetGym).toBe(false);
      expect(gameMode.isEndlessBoss(50)).toBe(true);
      expect(gameMode.isWaveTrainer(50)).toBe(false);
      expect(currentBattle.waveIndex).toBe(50);
      expect(currentBattle.battleType).toBe(BattleType.WILD);
      expect(currentBattle.trainer).toBeNull();
      expect(game.field.getEnemyPokemon().isBoss()).toBe(true);
    });

    it.each([GameModes.ENDLESS, GameModes.SPLICED_ENDLESS])("%s wave 505 can be a Mystery Encounter", async mode => {
      game.override.startingWave(505).startingBiome(BiomeId.GRASS).mysteryEncounterChance(100).disableTrainerWaves();

      await runToEncounter(mode, [SpeciesId.FEEBAS], true);

      const { currentBattle } = game.scene;
      expect(currentBattle.waveIndex).toBe(505);
      expect(game.scene.isMysteryEncounterValidForWave(BattleType.WILD, 505)).toBe(true);
      expect(currentBattle.battleType).toBe(BattleType.MYSTERY_ENCOUNTER);
      expect(currentBattle.mysteryEncounter).toBeDefined();

      await game.phaseInterceptor.to("MysteryEncounterPhase", false);
      expect(game).toBeAtPhase("MysteryEncounterPhase");
    });
  });

  describe("Mystery Encounter repeats", () => {
    it("can draw the same encounter again on the very next eligible wave in Classic", async () => {
      game.override.startingBiome(BiomeId.GRASS).startingWave(15).battleType(BattleType.WILD);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const { scene } = game;
      const biomeEncounters = mysteryEncountersByBiome.get(BiomeId.GRASS) ?? [];
      expect(biomeEncounters.length).toBeGreaterThan(5);

      const first = scene.getMysteryEncounter();
      expect(biomeEncounters).toContain(first.encounterType);
      scene.mysteryEncounterSaveData.encounteredEvents.push(
        new SeenEncounterData(first.encounterType, first.encounterTier, 15),
      );

      // Encounters may spawn again from 3 waves after the last one
      scene.currentBattle.waveIndex = 19;
      expect(scene.isMysteryEncounterValidForWave(BattleType.WILD, 19)).toBe(true);

      // Keep drawing with the seeded RNG: the last encounter must still be in the pool, alongside others
      const drawn = new Set<MysteryEncounterType>();
      for (let i = 0; i < 60; i++) {
        drawn.add(scene.getMysteryEncounter().encounterType);
      }

      expect(drawn).toContain(first.encounterType);
      expect(drawn.size).toBeGreaterThan(1);
    });
  });

  describe("custom passive persistence", () => {
    it("carries the starter menu's choice into the run", async () => {
      await game.runToTitle();
      game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
        game.scene.gameMode = getGameMode(GameModes.CLASSIC);
        const starters = generateStarters(game.scene, [SpeciesId.CHARIZARD, SpeciesId.FEEBAS]);
        starters[0].customPassiveSpecies = [SpeciesId.CHARIZARD];
        const selectStarterPhase = new SelectStarterPhase();
        game.scene.phaseManager.pushNew("EncounterPhase", false);
        selectStarterPhase.initBattle(starters);
      });
      await game.phaseInterceptor.to("EncounterPhase");

      const [charizard, feebas] = game.scene.getPlayerParty();
      expect(charizard.species.speciesId).toBe(SpeciesId.CHARIZARD);
      expect(charizard.usesCustomPassive()).toBe(true);
      expect(charizard.getPassiveAbility().id).toBe(AbilityId.FLASH_FIRE);
      expect(feebas.usesCustomPassive()).toBe(false);
      expect(feebas.getPassiveAbility().id).toBe(feebas.species.getPassiveAbility(feebas.formIndex));
    });

    it("survives PokemonData -> toPokemon and the session JSON round trip", async () => {
      await game.classicMode.startBattle(SpeciesId.CHARIZARD);
      const charizard = game.field.getPlayerPokemon();
      charizard.customPassiveSpecies = [SpeciesId.CHARIZARD];

      const direct = new PokemonData(charizard).toPokemon();
      expect(direct.usesCustomPassive()).toBe(true);
      expect(direct.getPassiveAbility().id).toBe(AbilityId.FLASH_FIRE);

      const { gameData } = game.scene;
      const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
      const restored = gameData.parseSessionData(json).party[0].toPokemon();
      expect(restored.species.speciesId).toBe(SpeciesId.CHARIZARD);
      expect(restored.customPassiveSpecies).toEqual([SpeciesId.CHARIZARD]);
      expect(restored.usesCustomPassive()).toBe(true);
      expect(restored.getPassiveAbility().id).toBe(AbilityId.FLASH_FIRE);

      charizard.customPassiveSpecies = [];
      const control = new PokemonData(JSON.parse(JSON.stringify(new PokemonData(charizard)))).toPokemon();
      expect(control.usesCustomPassive()).toBe(false);
      expect(control.getPassiveAbility().id).toBe(AbilityId.BATTLE_BOND);
    });

    it("applies the choice stage by stage through evolution, including Nincada's split into Shedinja", async () => {
      await game.classicMode.runToSummon(SpeciesId.CHARMANDER, SpeciesId.NINCADA);
      const [charmander, nincada] = game.scene.getPlayerParty();
      // Charmander itself stays on the base passive; only its evolution is set to our table
      charmander.customPassiveSpecies = [SpeciesId.CHARMELEON];
      // Nincada and Shedinja use our table, Ninjask does not
      nincada.customPassiveSpecies = [SpeciesId.NINCADA, SpeciesId.SHEDINJA];
      nincada.metBiome = -1;

      expect(charmander.usesCustomPassive()).toBe(false);
      expect(charmander.getPassiveAbility().id).toBe(charmander.species.getPassiveAbility(charmander.formIndex));
      expect(nincada.usesCustomPassive()).toBe(true);

      await charmander.evolve(speciesDataRegistry.getEvolutions(SpeciesId.CHARMANDER)[0], charmander.getSpeciesForm());
      expect(charmander.species.speciesId).toBe(SpeciesId.CHARMELEON);
      expect(charmander.customPassiveSpecies).toEqual([SpeciesId.CHARMELEON]);
      expect(charmander.usesCustomPassive()).toBe(true);
      expect(charmander.getPassiveAbility().id).toBe(getCustomPassive(SpeciesId.CHARMELEON, ""));

      await nincada.evolve(speciesDataRegistry.getEvolutions(SpeciesId.NINCADA)[0], nincada.getSpeciesForm());
      expect(nincada.species.speciesId).toBe(SpeciesId.NINJASK);
      expect(nincada.usesCustomPassive()).toBe(false);
      expect(nincada.getPassiveAbility().id).toBe(nincada.species.getPassiveAbility(nincada.formIndex));
      const shedinja = game.scene.getPlayerParty().find(p => p.species.speciesId === SpeciesId.SHEDINJA);
      expect(shedinja).toBeDefined();
      expect(shedinja!.customPassiveSpecies).toEqual([SpeciesId.NINCADA, SpeciesId.SHEDINJA]);
      expect(shedinja!.usesCustomPassive()).toBe(true);
      expect(shedinja!.getPassiveAbility().id).toBe(getCustomPassive(SpeciesId.SHEDINJA, ""));
    });

    // Since 2026-11-05 an enemy uses the table 1 time in 8, decided by its id (enemyRollsCustomPassive);
    // it never reads a player's per-species list. Ids are pinned to non-rolling ones here.
    it("never applies the player's list to an enemy; an enemy only uses the table on its own id roll", async () => {
      game.override.enemySpecies(SpeciesId.CHARIZARD);
      await game.classicMode.startBattle(SpeciesId.CHARIZARD);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      player.customPassiveSpecies = [SpeciesId.CHARIZARD];
      enemy.id = idWithRoll(false);
      player.id = idWithRoll(false, enemy.id + 1);

      expect(getCustomPassive(SpeciesId.CHARIZARD, "")).toBe(AbilityId.FLASH_FIRE);
      expect(player.getPassiveAbility().id).toBe(AbilityId.FLASH_FIRE);
      expect(enemy.species.speciesId).toBe(SpeciesId.CHARIZARD);
      expect(enemy.usesCustomPassive()).toBe(false);
      expect(enemy.getPassiveAbility().id).toBe(enemy.species.getPassiveAbility(enemy.formIndex));
      expect(enemy.getPassiveAbility().id).not.toBe(AbilityId.FLASH_FIRE);

      // An enemy rebuilt from its save data stays on the base game's passive too
      const rebuilt = new PokemonData(enemy).toPokemon();
      expect(rebuilt.isEnemy()).toBe(true);
      expect(rebuilt.usesCustomPassive()).toBe(false);
      expect(rebuilt.getPassiveAbility().id).not.toBe(AbilityId.FLASH_FIRE);

      // A boss copied from the player's own data (Training Session, Weird Dream) carries the list but never reads it
      const copy = new PokemonData(player);
      copy.player = false;
      const mirrored = copy.toPokemon();
      expect(mirrored.isEnemy()).toBe(true);
      expect(mirrored.customPassiveSpecies).toEqual([SpeciesId.CHARIZARD]);
      expect(mirrored.usesCustomPassive()).toBe(false);
      expect(mirrored.getPassiveAbility().id).not.toBe(AbilityId.FLASH_FIRE);

      // ...and an enemy whose id rolls uses the table
      enemy.id = idWithRoll(true);
      expect(enemy.usesCustomPassive()).toBe(true);
      expect(enemy.getPassiveAbility().id).toBe(AbilityId.FLASH_FIRE);
    });

    it("reports Slush Rush for a custom-passive Charizard after Mega Evolving with Charizardite Z", async () => {
      expect(getCustomPassive(SpeciesId.CHARIZARD, "mega-z")).toBe(AbilityId.SLUSH_RUSH);

      await game.classicMode.startBattle(SpeciesId.CHARIZARD);
      const charizard = game.field.getPlayerPokemon();
      charizard.customPassiveSpecies = [SpeciesId.CHARIZARD];
      expect(charizard.getPassiveAbility().id).toBe(AbilityId.FLASH_FIRE);

      const stone = new FormChangeItemModifierType(FormChangeItem.CHARIZARDITE_Z).newModifier(charizard);
      await game.scene.addModifier(stone, false, true);
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(charizard.getFormKey()).toBe(SpeciesFormKey.MEGA_Z);
      expect(charizard.getPassiveAbility().id).toBe(AbilityId.SLUSH_RUSH);

      // Our Mega forms carry their designed passive as the base passive too (they have no base-game passive of
      // their own), so clearing the choice changes nothing for the Mega; only the plain stage falls back.
      charizard.customPassiveSpecies = [];
      expect(charizard.getPassiveAbility().id).toBe(charizard.species.getPassiveAbility(charizard.formIndex));
      expect(charizard.getPassiveAbility().id).toBe(AbilityId.SLUSH_RUSH);
      expect(charizard.species.getPassiveAbility(0)).not.toBe(AbilityId.SLUSH_RUSH);
    });
  });
});
