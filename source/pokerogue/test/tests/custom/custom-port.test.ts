import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { getCustomPassive } from "#balance/custom-passives";
import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattleType } from "#enums/battle-type";
import { FormChangeItem } from "#enums/form-change-item";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Passive } from "#enums/passive";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { FormChangeItemModifierType } from "#modifiers/modifier-type";
import { SeenEncounterData } from "#mystery-encounters/mystery-encounter-save-data";
import { GameData } from "#system/game-data";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Custom port", () => {
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
      .moveset([MoveId.SPLASH, MoveId.FLAMETHROWER, MoveId.ICE_BEAM, MoveId.PSYCHO_CUT, MoveId.SACRED_SWORD]);
  });

  describe("passive choice", () => {
    it("uses our table only when the Pokemon is set to it", async () => {
      await game.classicMode.startBattle(SpeciesId.CHARIZARD);
      const charizard = game.field.getPlayerPokemon();
      const ours = getCustomPassive(SpeciesId.CHARIZARD, "");

      expect(ours).toBe(AbilityId.FLASH_FIRE);
      expect(charizard.getPassiveAbility().id).toBe(AbilityId.BATTLE_BOND);

      charizard.customPassiveSpecies = [SpeciesId.CHARIZARD];
      expect(charizard.usesCustomPassive()).toBe(true);
      expect(charizard.getPassiveAbility().id).toBe(AbilityId.FLASH_FIRE);

      // The choice is per species: a list naming only other stages leaves this one on the base game's passive
      charizard.customPassiveSpecies = [SpeciesId.CHARMANDER, SpeciesId.CHARMELEON];
      expect(charizard.usesCustomPassive()).toBe(false);
      expect(charizard.getPassiveAbility().id).toBe(AbilityId.BATTLE_BOND);
    });

    it("keeps the Mega's own row when Mega Evolving", () => {
      expect(getCustomPassive(SpeciesId.CHARIZARD, SpeciesFormKey.MEGA_Y)).toBe(AbilityId.SOLAR_POWER);
      expect(getCustomPassive(SpeciesId.CHARIZARD, SpeciesFormKey.MEGA_Z)).toBe(AbilityId.SLUSH_RUSH);
    });

    it("inherits a family's passive on an evolution with no row", () => {
      expect(getCustomPassive(SpeciesId.CHARMELEON, "")).toBe(AbilityId.FLASH_FIRE);
    });

    // Local fork (2026-11-14): passive rebalance. PokeRogue's split-off Battle Bond Greninja is GRENINJA form 1 / 2
    // in Essentials, which the sheet's FROAKIE row covers (gen_custom_passives.py SPLIT_FORM_SPECIES)
    it("gives Battle Bond Greninja (both forms) the Froakie row, like Greninja", () => {
      expect(getCustomPassive(SpeciesId.FROAKIE, "")).toBe(AbilityId.TECHNICIAN);
      expect(getCustomPassive(SpeciesId.GRENINJA, "")).toBe(AbilityId.TECHNICIAN);
      expect(getCustomPassive(SpeciesId.BATTLE_BOND_GRENINJA, "battle-bond")).toBe(AbilityId.TECHNICIAN);
      expect(getCustomPassive(SpeciesId.BATTLE_BOND_GRENINJA, "ash")).toBe(AbilityId.TECHNICIAN);
      // Mega Greninja keeps its own row
      expect(getCustomPassive(SpeciesId.GRENINJA, SpeciesFormKey.MEGA)).toBe(AbilityId.ADAPTABILITY);
    });

    it("saves the per-species list with the Pokemon and widens an old whole-line flag to the chain", async () => {
      await game.classicMode.startBattle(SpeciesId.CHARIZARD);
      const charizard = game.field.getPlayerPokemon();
      charizard.customPassiveSpecies = [SpeciesId.CHARMELEON, SpeciesId.CHARIZARD];
      expect(new PokemonData(charizard).customPassiveSpecies).toEqual([SpeciesId.CHARMELEON, SpeciesId.CHARIZARD]);

      // A save from before the per-species choice carried one flag for the whole line
      const legacy = JSON.parse(JSON.stringify(new PokemonData(charizard)));
      delete legacy.customPassiveSpecies;
      legacy.species = SpeciesId.CHARMANDER;
      legacy.usesCustomPassive = true;
      expect(new PokemonData(legacy).customPassiveSpecies).toEqual([
        SpeciesId.CHARMANDER,
        SpeciesId.CHARMELEON,
        SpeciesId.CHARIZARD,
      ]);
      legacy.usesCustomPassive = false;
      expect(new PokemonData(legacy).customPassiveSpecies).toEqual([]);
    });

    it("hands the choice on to a Pokemon that replaces another one", async () => {
      await game.classicMode.startBattle(SpeciesId.CHARIZARD);
      const charizard = game.field.getPlayerPokemon();
      const bulbasaur = game.scene.addPlayerPokemon(speciesDataRegistry.getSpecies(SpeciesId.BULBASAUR), 5, 0, 0);

      // A replaced Pokemon on the base passive passes its list along untouched, so the new species stays base
      charizard.customPassiveSpecies = [SpeciesId.CHARMANDER];
      bulbasaur.inheritPassiveChoice(charizard);
      expect(bulbasaur.customPassiveSpecies).toEqual([SpeciesId.CHARMANDER]);
      expect(bulbasaur.usesCustomPassive()).toBe(false);

      // One on our table sets the new species and everything it evolves into to our table as well
      charizard.customPassiveSpecies = [SpeciesId.CHARIZARD];
      bulbasaur.inheritPassiveChoice(charizard);
      expect(bulbasaur.customPassiveSpecies).toEqual([
        SpeciesId.CHARIZARD,
        SpeciesId.BULBASAUR,
        SpeciesId.IVYSAUR,
        SpeciesId.VENUSAUR,
      ]);
      expect(bulbasaur.usesCustomPassive()).toBe(true);
    });

    it("converts a starter's old whole-line flag into the per-species list on load", async () => {
      await game.classicMode.startBattle(SpeciesId.CHARIZARD);
      const { gameData } = game.scene;
      gameData.starterData[SpeciesId.CHARMANDER].passiveAttr = Passive.UNLOCKED | Passive.ENABLED | Passive.CUSTOM;
      gameData.starterData[SpeciesId.BULBASAUR].customPassiveSpecies = [SpeciesId.VENUSAUR];

      const json = JSON.stringify(gameData.getSystemSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
      const parsed = GameData.parseSystemData(json);
      gameData["initParsedSystem"](parsed);

      const charmander = gameData.starterData[SpeciesId.CHARMANDER];
      expect(charmander.customPassiveSpecies).toEqual([
        SpeciesId.CHARMANDER,
        SpeciesId.CHARMELEON,
        SpeciesId.CHARIZARD,
      ]);
      expect(charmander.passiveAttr).toBe(Passive.UNLOCKED | Passive.ENABLED);
      expect(gameData.starterData[SpeciesId.BULBASAUR].customPassiveSpecies).toEqual([SpeciesId.VENUSAUR]);
    });
  });

  describe("custom Megas", () => {
    it.each([
      [SpeciesId.CHARIZARD, FormChangeItem.CHARIZARDITE_Z, "mega-z", AbilityId.FROSTFIRE, 149],
      [SpeciesId.GALLADE, FormChangeItem.GALLADITE_Z, "mega-z", AbilityId.MIND_BLADE, 150],
      [SpeciesId.MELMETAL, FormChangeItem.MELMETALITE, "mega", AbilityId.IRON_FIST, 80],
      [SpeciesId.BAXCALIBUR, FormChangeItem.BAXCALIBRITE_Z, "mega-z", AbilityId.HILT_CANNON, 150],
      [SpeciesId.ARCHALUDON, FormChangeItem.ARCHALUDONITE, "mega", AbilityId.STEEL_BODY, 150],
    ])("%s Mega Evolves with its stone", async (species, item, formKey, ability, spatk) => {
      game.override.ability(AbilityId.NONE);
      await game.classicMode.startBattle(species);
      const pokemon = game.field.getPlayerPokemon();

      const stone = new FormChangeItemModifierType(item).newModifier(pokemon);
      await game.scene.addModifier(stone, false, true);
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(pokemon.getFormKey()).toBe(formKey);
      const form = pokemon.getSpeciesForm();
      expect(form.ability1).toBe(ability);
      expect(form.baseStats[Stat.SPATK]).toBe(spatk);
    });
  });

  describe("custom abilities", () => {
    it("War Machine raises every stat once per battle", async () => {
      game.override.ability(AbilityId.WAR_MACHINE);
      await game.classicMode.startBattle(SpeciesId.MEWTWO, SpeciesId.FEEBAS);
      const mewtwo = game.field.getPlayerPokemon();
      for (const stat of [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD] as const) {
        expect(mewtwo).toHaveStatStage(stat, 1);
      }
    });

    it("Gale Herald sets Tailwind on the user's side", async () => {
      game.override.ability(AbilityId.GALE_HERALD);
      await game.classicMode.startBattle(SpeciesId.PIDGEOT);
      expect(game.scene.arena.getTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER)).toBeDefined();
    });

    it("Overawe lowers the foe's Sp. Atk", async () => {
      game.override.ability(AbilityId.OVERAWE);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      expect(game.field.getEnemyPokemon()).toHaveStatStage(Stat.SPATK, -1);
    });

    it("Light Thief takes the foe's raised stages", async () => {
      game.override.ability(AbilityId.BALL_FETCH);
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.NECROZMA);
      const enemy = game.field.getEnemyPokemon();
      enemy.setStatStage(Stat.ATK, 3);
      game.scene.getPlayerParty()[1].summonData.ability = AbilityId.LIGHT_THIEF;
      game.override.ability(AbilityId.LIGHT_THIEF);

      game.doSwitchPokemon(1);
      await game.toNextTurn();

      expect(enemy).toHaveStatStage(Stat.ATK, 0);
      expect(game.field.getPlayerPokemon()).toHaveStatStage(Stat.ATK, 3);
    });

    it("Frostfire turns Fire moves into Ice", async () => {
      game.override.ability(AbilityId.FROSTFIRE);
      await game.classicMode.startBattle(SpeciesId.CHARIZARD);
      const charizard = game.field.getPlayerPokemon();
      expect(charizard.getMoveType(allMoves[MoveId.FLAMETHROWER])).toBe(allMoves[MoveId.ICE_BEAM].type);
    });

    it("Mind Blade computes slicing moves from Sp. Atk", async () => {
      await game.classicMode.startBattle(SpeciesId.GALLADE);
      const gallade = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      gallade.stats[Stat.ATK] = 50;
      gallade.stats[Stat.SPATK] = 300;
      const move = allMoves[MoveId.SACRED_SWORD];

      const before = enemy.getAttackDamage({ source: gallade, move, simulated: true }).damage;
      game.override.ability(AbilityId.MIND_BLADE);
      const after = enemy.getAttackDamage({ source: gallade, move, simulated: true }).damage;

      expect(after).toBeGreaterThan(before * 3);
    });
  });

  describe("Endless and encounters", () => {
    it.each([GameModes.ENDLESS, GameModes.SPLICED_ENDLESS])("mode %s has trainers and encounters", mode => {
      const gameMode = getGameMode(mode);
      expect(gameMode.hasTrainers).toBe(true);
      expect(gameMode.hasMysteryEncounters).toBe(true);
      const [low, high] = gameMode.getMysteryEncounterLegalWaves();
      expect(low).toBe(10);
      expect(high).toBeGreaterThan(100000);
    });

    it("keeps Endless bosses wild on a gym wave, and other gym waves trainers", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const endless = getGameMode(GameModes.ENDLESS);
      game.scene.offsetGym = false;
      expect(endless.isWaveTrainer(50)).toBe(false);
      expect(endless.isWaveTrainer(80)).toBe(true);
    });

    it("draws varied encounters far past Classic's last wave", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const { scene } = game;
      scene.gameMode = getGameMode(GameModes.ENDLESS);
      scene.currentBattle.waveIndex = 505;
      expect(scene.isMysteryEncounterValidForWave(BattleType.WILD, 505)).toBe(true);
      const types = new Set<MysteryEncounterType>();
      for (let i = 0; i < 150; i++) {
        types.add(scene.getMysteryEncounter().encounterType);
      }
      expect(types.size).toBeGreaterThan(3);
    });

    it("allows the same encounter straight after itself in Classic", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const { scene } = game;
      const seen = scene.mysteryEncounterSaveData.encounteredEvents;
      const first = scene.getMysteryEncounter().encounterType;
      for (let i = 0; i < 40; i++) {
        seen.push(new SeenEncounterData(first, MysteryEncounterTier.COMMON, i));
      }
      let again = false;
      for (let i = 0; i < 300 && !again; i++) {
        again = scene.getMysteryEncounter().encounterType === first;
      }
      expect(again).toBe(true);
      expect(MysteryEncounterType[first]).toBeDefined();
    });
  });
});
