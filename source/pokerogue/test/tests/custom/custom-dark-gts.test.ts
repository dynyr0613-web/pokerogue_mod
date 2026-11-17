import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { PLAYER_HELD_ITEM_CAPS } from "#balance/endless-balance";
import { allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import type { ModifierType, PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import {
  DARK_GTS_LEAVE_REWARD,
  DARK_GTS_SEND_REWARDS,
  DarkGlobalTradeSystemEncounter,
  getDarkGtsRewardType,
  getDarkGtsRoom,
  pickDarkGtsReward,
} from "#mystery-encounters/dark-global-trade-system-encounter";
import * as DarkGtsSpawn from "#mystery-encounters/dark-gts-spawn";
import { getDarkGtsEndWaveChance, isDarkGtsEndWave } from "#mystery-encounters/dark-gts-spawn";
import * as EncounterDialogueUtils from "#mystery-encounters/encounter-dialogue-utils";
import * as EncounterPhaseUtils from "#mystery-encounters/encounter-phase-utils";
import { generateModifierType } from "#mystery-encounters/encounter-phase-utils";
import {
  allMysteryEncounters,
  CIVILIZATION_ENCOUNTER_BIOMES,
  mysteryEncountersByBiome,
} from "#mystery-encounters/mystery-encounter-biomes";
import { SeenEncounterData } from "#mystery-encounters/mystery-encounter-save-data";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { TextInterceptor } from "#test/framework/text-interceptor";
import { runMysteryEncounterToEnd } from "#test/utils/encounter-test-utils";
import { generateStarters } from "#test/utils/game-manager-utils";
import { MessageUiHandler } from "#ui/message-ui-handler";
import type { MysteryEncounterUiHandler } from "#ui/mystery-encounter-ui-handler";
import { PartyUiHandler } from "#ui/party-ui-handler";
import i18next from "i18next";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const namespace = "mysteryEncounters/darkGlobalTradeSystem";
const defaultParty = [SpeciesId.LAPRAS, SpeciesId.GENGAR, SpeciesId.ABRA];
const defaultBiome = BiomeId.CAVE;
const defaultWave = 45;
const SEND_IDS = ["MINI_BLACK_HOLE", "MYSTERY_ENCOUNTER_MACHO_BRACE", "PRISM", "MULTI_LENS"];
/**
 * Stack caps of the player's Pokémon: Mini Black Hole 1, Macho Brace 50, Prism 3, Multi Lens 3 (Local fork
 * (2026-11-13): 10 명세 1번, 4 before), Golden Egg 99
 */
const CAPS: Record<string, number> = {
  MINI_BLACK_HOLE: 1,
  MYSTERY_ENCOUNTER_MACHO_BRACE: 50,
  PRISM: 3,
  MULTI_LENS: PLAYER_HELD_ITEM_CAPS.MULTI_LENS,
  GOLDEN_EGG: 99,
};
const koFiles = import.meta.glob("../../../locales/ko/**/*.json", { eager: true, import: "default" });

/**
 * Local fork, the user's request of 2026-11-08: a ROGUE-tier "GTS?" encounter. Option 1 sends a Pokémon away for
 * one of Mini Black Hole, Macho Brace, Prism x2 or Multi Lens x2 on another member; option 2 leaves and finds a Golden
 * Egg. In Endless the wave before an Eternatus is rarely moved into the End and turned into this encounter.
 */
describe("Custom mystery encounter - GTS? (DARK_GLOBAL_TRADE_SYSTEM)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let scene: BattleScene;

  beforeAll(async () => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    // Put the Korean text for the "Korean text" tests straight into i18next instead of loading it over `fetch`: every
    // GameManager replaces the global `fetch` with a mock that can't serve locale files, and in the full suite
    // (`isolate: false`) an earlier test file has already done so before this one starts
    const { loadPath } = i18next.options.backend as { loadPath: (lng: string, ns: string[]) => string };
    for (const ns of i18next.options.ns as readonly string[]) {
      const file = /locales\/ko\/(.+?\.json)/.exec(loadPath("ko", [ns]))?.[1];
      const json = file ? koFiles[`../../../locales/ko/${file}`] : undefined;
      if (json) {
        i18next.addResourceBundle("ko", ns, json, true, true);
      }
    }
    expect(i18next.hasResourceBundle("ko", namespace)).toBe(true);
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    scene = game.scene;
    game.override
      .mysteryEncounterChance(100)
      .startingWave(defaultWave)
      .startingBiome(defaultBiome)
      .disableTrainerWaves();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const itemType = (id: string) =>
    generateModifierType(
      modifierTypes[id as keyof typeof modifierTypes] as () => ModifierType,
    ) as PokemonHeldItemModifierType;

  function giveItem(pokemon: Pokemon, id: string, stacks: number): PokemonHeldItemModifier {
    const modifier = itemType(id).newModifier(pokemon) as PokemonHeldItemModifier;
    modifier.stackCount = stacks;
    scene.addModifier(modifier, true, false, false, true);
    return pokemon.getHeldItems().find(m => m.match(modifier))!;
  }

  /** `{ itemId: stacks }` of what `pokemon` holds */
  function heldOf(pokemon: Pokemon): Record<string, number> {
    const held: Record<string, number> = {};
    for (const m of pokemon.getHeldItems()) {
      held[m.type.id] = (held[m.type.id] ?? 0) + m.getStackCount();
    }
    return held;
  }

  /** Fills the stacks of the items `ids` on every one of `members` to their caps */
  function fillAll(members: Pokemon[], ids: string[]): void {
    for (const member of members) {
      for (const id of ids) {
        giveItem(member, id, CAPS[id]);
      }
    }
  }

  async function startEncounter(party = defaultParty): Promise<PlayerPokemon[]> {
    await game.runToMysteryEncounter(MysteryEncounterType.DARK_GLOBAL_TRADE_SYSTEM, party);
    scene.modifiers = [];
    await scene.updateModifiers(true);
    return scene.getPlayerParty();
  }

  const ballTotal = () => Object.values(scene.pokeballCounts).reduce((a, b) => a + b, 0);

  describe("registration", () => {
    it("is a ROGUE-tier encounter appended to the enum, with two options, its sprite and its text", async () => {
      await startEncounter();

      // Local fork (2026-11-08): later fork encounters are appended after it, the "Mysterious Chest?" first
      expect(MysteryEncounterType.DARK_MYSTERIOUS_CHEST).toBe(MysteryEncounterType.DARK_GLOBAL_TRADE_SYSTEM + 1);
      expect(MysteryEncounterType.DARK_GLOBAL_TRADE_SYSTEM).toBe(MysteryEncounterType.SUPER_GLOBAL_TRADE_SYSTEM + 1);
      expect(allMysteryEncounters[MysteryEncounterType.DARK_GLOBAL_TRADE_SYSTEM]).toBe(DarkGlobalTradeSystemEncounter);
      expect(DarkGlobalTradeSystemEncounter.encounterTier).toBe(MysteryEncounterTier.ROGUE);
      expect(DarkGlobalTradeSystemEncounter.options).toHaveLength(2);
      expect(DarkGlobalTradeSystemEncounter.spriteConfigs[0].spriteKey).toBe("dark_global_trade_system");
      expect(DarkGlobalTradeSystemEncounter.spriteConfigs[0].fileRoot).toBe("mystery-encounters");
      expect(DarkGlobalTradeSystemEncounter.requirements.length).toBe(1); // the wave range only
      expect(i18next.t(`${namespace}:title`)).toBe("GTS?");
      expect(i18next.t(`${namespace}:option.1.label`)).toBe("Touch the GTS...");
      expect(scene.currentBattle.mysteryEncounter?.encounterType).toBe(MysteryEncounterType.DARK_GLOBAL_TRADE_SYSTEM);
    });

    it("names its message jingle by the sound key the game loads it under", () => {
      // SceneBase.loadSe caches sound effects as "se/<key>"; a bare @s{item_fanfare} is never found and stays silent
      for (const lng of ["en", "ko"]) {
        const sent = i18next.t(`${namespace}:sent`, { lng });
        expect(sent, lng).toContain("@s{se/item_fanfare}");
        for (const [, key] of sent.matchAll(/@s\{(.*?)\}/g)) {
          expect(key, lng).toMatch(/^se\//);
        }
      }
    });

    it("spawns in every civilization biome plus Space, the End and the Abyss, and nowhere else", () => {
      const expected = new Set<BiomeId>([...CIVILIZATION_ENCOUNTER_BIOMES, BiomeId.SPACE, BiomeId.END, BiomeId.ABYSS]);
      for (const biome of expected) {
        expect(mysteryEncountersByBiome.get(biome), `biome ${BiomeId[biome]}`).toContain(
          MysteryEncounterType.DARK_GLOBAL_TRADE_SYSTEM,
        );
      }
      for (const [biome, encounters] of mysteryEncountersByBiome) {
        if (!expected.has(biome)) {
          expect(encounters, `biome ${BiomeId[biome]}`).not.toContain(MysteryEncounterType.DARK_GLOBAL_TRADE_SYSTEM);
        }
      }
      // Space keeps its own encounter
      expect(mysteryEncountersByBiome.get(BiomeId.SPACE)).toContain(MysteryEncounterType.THE_EXPERT_POKEMON_BREEDER);
    });
  });

  describe("option 1 - send a Pokémon", () => {
    it("takes the chosen Pokémon and its items for good and gives one of the four rewards to another member", async () => {
      const [lapras, gengar, abra] = await startEncounter();
      giveItem(gengar, "LEFTOVERS", 2);
      giveItem(gengar, "SOUL_DEW", 1);
      giveItem(lapras, "LEFTOVERS", 1);
      await scene.updateModifiers(true);
      const gengarId = gengar.id;
      const before = [heldOf(lapras), heldOf(abra)];

      await runMysteryEncounterToEnd(game, 1, { pokemonNo: 2 });

      const party = scene.getPlayerParty();
      expect(party).toEqual([lapras, abra]);
      expect(party.some(p => p.species.speciesId === SpeciesId.GENGAR)).toBe(false);
      expect(scene.modifiers.some(m => (m as PokemonHeldItemModifier).pokemonId === gengarId)).toBe(false);

      // exactly one new stack on exactly one of the others, of one of the four rewards with its count
      const gained: { id: string; count: number }[] = [];
      [lapras, abra].forEach((member, i) => {
        for (const [id, count] of Object.entries(heldOf(member))) {
          const diff = count - (before[i][id] ?? 0);
          if (diff !== 0) {
            gained.push({ id, count: diff });
          }
        }
      });
      expect(gained).toHaveLength(1);
      const reward = DARK_GTS_SEND_REWARDS.find(r => r.id === gained[0].id);
      expect(reward).toBeDefined();
      expect(gained[0].count).toBe(reward!.count);
      expect(game.textInterceptor.logs.some(l => l.includes("was pulled") && l.includes("Gengar"))).toBe(true);
    });

    it("offers the four rewards evenly with their counts: Mini Black Hole x1, Macho Brace x1, Prism x2, Multi Lens x2", async () => {
      const [lapras, , abra] = await startEncounter();
      expect(DARK_GTS_SEND_REWARDS.map(r => [r.id, r.count])).toEqual([
        ["MINI_BLACK_HOLE", 1],
        ["MYSTERY_ENCOUNTER_MACHO_BRACE", 1],
        ["PRISM", 2],
        ["MULTI_LENS", 2],
      ]);
      const seen = new Map<string, number>();
      for (let i = 0; i < 200; i++) {
        scene.setSeed(`dark-gts-${i}`);
        scene.resetSeed(1);
        const pick = pickDarkGtsReward(DARK_GTS_SEND_REWARDS, [lapras, abra])!;
        expect(pick.given).toBe(pick.reward.count);
        expect([lapras, abra]).toContain(pick.receiver);
        expect(pick.type.id).toBe(pick.reward.id);
        seen.set(pick.reward.id, (seen.get(pick.reward.id) ?? 0) + 1);
      }
      expect([...seen.keys()].sort()).toEqual([...SEND_IDS].sort());
      for (const count of seen.values()) {
        expect(count).toBeGreaterThan(25);
      }
    });

    it("reads each member's room from its stack and cap", async () => {
      const [lapras] = await startEncounter();
      expect(getDarkGtsRoom(lapras, itemType("PRISM"))).toBe(3);
      giveItem(lapras, "PRISM", 2);
      expect(getDarkGtsRoom(lapras, itemType("PRISM"))).toBe(1);
      expect(getDarkGtsRoom(lapras, itemType("MULTI_LENS"))).toBe(PLAYER_HELD_ITEM_CAPS.MULTI_LENS);
      expect(getDarkGtsRoom(lapras, itemType("MINI_BLACK_HOLE"))).toBe(1);
      expect(getDarkGtsRoom(lapras, getDarkGtsRewardType(DARK_GTS_LEAVE_REWARD))).toBe(99);
      giveItem(lapras, "MYSTERY_ENCOUNTER_MACHO_BRACE", 50);
      expect(getDarkGtsRoom(lapras, itemType("MYSTERY_ENCOUNTER_MACHO_BRACE"))).toBe(0);
    });

    it("never offers a reward nobody can hold, and prefers a receiver that takes the full count", async () => {
      const [lapras, , abra] = await startEncounter();
      // nobody can take a Mini Black Hole or a Macho Brace; only Lapras has room for 2 Prisms, Abra for 1
      fillAll([lapras, abra], ["MINI_BLACK_HOLE", "MYSTERY_ENCOUNTER_MACHO_BRACE", "MULTI_LENS"]);
      giveItem(abra, "PRISM", 2);
      for (let i = 0; i < 40; i++) {
        scene.setSeed(`dark-gts-full-${i}`);
        scene.resetSeed(1);
        const pick = pickDarkGtsReward(DARK_GTS_SEND_REWARDS, [lapras, abra])!;
        expect(pick.reward.id).toBe("PRISM");
        expect(pick.receiver).toBe(lapras);
        expect(pick.given).toBe(2);
      }

      // nobody can take 2 any more: the one with room for 1 gets 1
      giveItem(lapras, "PRISM", 2);
      const pick = pickDarkGtsReward(DARK_GTS_SEND_REWARDS, [lapras, abra])!;
      expect(pick.reward.id).toBe("PRISM");
      expect(pick.given).toBe(1);
    });

    it("gives as many as fit when nobody has room for the whole reward", async () => {
      const [lapras, gengar, abra] = await startEncounter();
      fillAll([lapras, abra], ["MINI_BLACK_HOLE", "MYSTERY_ENCOUNTER_MACHO_BRACE", "PRISM"]);
      giveItem(lapras, "MULTI_LENS", CAPS.MULTI_LENS);
      giveItem(abra, "MULTI_LENS", CAPS.MULTI_LENS - 1);
      await scene.updateModifiers(true);

      await runMysteryEncounterToEnd(game, 1, { pokemonNo: 2 });

      expect(scene.getPlayerParty()).not.toContain(gengar);
      expect(heldOf(abra).MULTI_LENS).toBe(CAPS.MULTI_LENS);
      expect(heldOf(lapras).MULTI_LENS).toBe(CAPS.MULTI_LENS);
      // one Multi Lens: the message for a single item
      expect(game.textInterceptor.logs.some(l => l.includes("Abra received") && l.includes("Multi Lens!"))).toBe(true);
    });

    it("with every reward stack full, still takes the Pokémon and hands out the stack-full stand-in with its message", async () => {
      const [lapras, gengar, abra] = await startEncounter();
      fillAll([lapras, abra], SEND_IDS);
      await scene.updateModifiers(true);
      const heldBefore = [heldOf(lapras), heldOf(abra)];
      const ballsBefore = ballTotal();

      await runMysteryEncounterToEnd(game, 1, { pokemonNo: 2 });

      expect(scene.getPlayerParty()).not.toContain(gengar);
      expect([heldOf(lapras), heldOf(abra)]).toEqual(heldBefore);
      // Master-tier rewards turn into a Master Ball, the Macho Brace (no tier) into Poké Balls
      expect(ballTotal()).toBeGreaterThan(ballsBefore);
      expect(game.textInterceptor.logs.some(l => l.includes("is full"))).toBe(true);
    });

    it("is disabled with only one Pokémon able to battle, while leaving stays open", async () => {
      const [, gengar] = await startEncounter([SpeciesId.LAPRAS, SpeciesId.GENGAR]);
      expect(DarkGlobalTradeSystemEncounter.options[0].meetsRequirements()).toBe(true);
      gengar.hp = 0;
      expect(gengar.isAllowedInBattle()).toBe(false);
      expect(DarkGlobalTradeSystemEncounter.options[0].meetsRequirements()).toBe(false);
      expect(DarkGlobalTradeSystemEncounter.options[1].meetsRequirements()).toBe(true);
    });
  });

  describe("option 2 - leave", () => {
    it("leaves a Golden Egg with a party member, with no battle and no reward screen", async () => {
      const party = await startEncounter();
      const leave = vi.spyOn(EncounterPhaseUtils, "leaveEncounterWithoutBattle");

      await runMysteryEncounterToEnd(game, 2);

      expect(scene.getPlayerParty()).toHaveLength(3);
      const holders = party.filter(p => heldOf(p).GOLDEN_EGG === 1);
      expect(holders).toHaveLength(1);
      expect(party.flatMap(p => p.getHeldItems())).toHaveLength(1);
      expect(leave).toHaveBeenCalledTimes(1);
      expect(leave.mock.calls[0][0] ?? false).toBe(false);
      expect(game.textInterceptor.logs.some(l => l.includes("Golden Egg"))).toBe(true);
    });

    it("gives the egg to a member that still has room", async () => {
      const [lapras, gengar, abra] = await startEncounter();
      giveItem(lapras, "GOLDEN_EGG", 99);
      giveItem(abra, "GOLDEN_EGG", 99);
      await scene.updateModifiers(true);

      await runMysteryEncounterToEnd(game, 2);

      expect(heldOf(gengar).GOLDEN_EGG).toBe(1);
      expect(heldOf(lapras).GOLDEN_EGG).toBe(99);
      expect(heldOf(abra).GOLDEN_EGG).toBe(99);
    });

    it("with every egg stack full, hands out Poké Balls instead and says so", async () => {
      const party = await startEncounter();
      fillAll(party, ["GOLDEN_EGG"]);
      await scene.updateModifiers(true);
      const pokeBalls = scene.pokeballCounts[PokeballType.POKEBALL];

      await runMysteryEncounterToEnd(game, 2);

      expect(party.every(p => heldOf(p).GOLDEN_EGG === 99)).toBe(true);
      expect(scene.pokeballCounts[PokeballType.POKEBALL]).toBeGreaterThan(pokeBalls);
      expect(game.textInterceptor.logs.some(l => l.includes("The stack for Golden Egg is full"))).toBe(true);
    });
  });

  describe("forced Endless spawn before an Eternatus", () => {
    const setMode = (mode: GameModes) => {
      scene.gameMode = getGameMode(mode);
    };

    it("rolls 1/200 on waves 249, 499, 749, ... and 1/100 on waves 999, 1999, ...", () => {
      for (const mode of [GameModes.ENDLESS, GameModes.SPLICED_ENDLESS]) {
        setMode(mode);
        for (const wave of [249, 499, 749, 1249, 1749, 2249]) {
          expect(getDarkGtsEndWaveChance(wave), `wave ${wave}`).toBe(1 / 200);
        }
        for (const wave of [999, 1999, 2999]) {
          expect(getDarkGtsEndWaveChance(wave), `wave ${wave}`).toBe(1 / 100);
        }
        for (const wave of [248, 250, 251, 49, 199, 500, 1000, 998]) {
          expect(getDarkGtsEndWaveChance(wave), `wave ${wave}`).toBe(0);
        }
      }
    });

    it("never happens outside Endless", () => {
      for (const mode of [GameModes.CLASSIC, GameModes.CHALLENGE, GameModes.DAILY]) {
        setMode(mode);
        for (const wave of [249, 499, 999, 1999]) {
          expect(getDarkGtsEndWaveChance(wave)).toBe(0);
        }
        for (let i = 0; i < 300; i++) {
          scene.setSeed(`dark-gts-mode-${i}`);
          expect(isDarkGtsEndWave(249)).toBe(false);
          expect(isDarkGtsEndWave(999)).toBe(false);
        }
      }
    });

    it("gives the same answer for the same seed and wave, and comes up about as often as it should", () => {
      setMode(GameModes.ENDLESS);
      let hits249 = 0;
      let hits999 = 0;
      const trials = 6000;
      for (let i = 0; i < trials; i++) {
        scene.setSeed(`dark-gts-roll-${i}`);
        const first = isDarkGtsEndWave(249);
        // asked again (end of the previous wave, the wave itself, after a reload): same answer
        expect(isDarkGtsEndWave(249)).toBe(first);
        hits249 += Number(first);
        hits999 += Number(isDarkGtsEndWave(999));
        expect(isDarkGtsEndWave(250)).toBe(false);
      }
      // expected 30 and 60 hits
      expect(hits249).toBeGreaterThan(10);
      expect(hits249).toBeLessThan(60);
      expect(hits999).toBeGreaterThan(30);
      expect(hits999).toBeLessThan(100);
    });

    it("turns its wave into the encounter whatever the roll, the spacing or a trainer wave say", async () => {
      game.override.mysteryEncounterChance(0);
      await game.classicMode.startBattle(SpeciesId.LAPRAS);
      setMode(GameModes.ENDLESS);
      const stub = vi.spyOn(DarkGtsSpawn, "isDarkGtsEndWave").mockImplementation(wave => wave === 249);
      scene.mysteryEncounterSaveData.encounteredEvents.push(
        new SeenEncounterData(MysteryEncounterType.MYSTERIOUS_CHEST, MysteryEncounterTier.COMMON, 248),
      );
      const isWaveMysteryEncounter = (type: BattleType, wave: number): boolean =>
        (scene as any).isWaveMysteryEncounter(type, wave);

      expect(isWaveMysteryEncounter(BattleType.TRAINER, 249)).toBe(true);
      expect(isWaveMysteryEncounter(BattleType.WILD, 249)).toBe(true);
      expect(isWaveMysteryEncounter(BattleType.WILD, 248)).toBe(false);

      scene.currentBattle.waveIndex = 249;
      expect(scene.getMysteryEncounter().encounterType).toBe(MysteryEncounterType.DARK_GLOBAL_TRADE_SYSTEM);
      // a saved wave keeps its own encounter
      expect(scene.getMysteryEncounter(MysteryEncounterType.MYSTERIOUS_CHEST).encounterType).toBe(
        MysteryEncounterType.MYSTERIOUS_CHEST,
      );
      // the wave before it ends its biome; 249 still does as usual, other waves don't
      scene.currentBattle.waveIndex = 248;
      expect(scene.isNewBiome()).toBe(true);
      stub.mockReturnValue(false);
      expect(scene.isNewBiome()).toBe(false);
      scene.currentBattle.waveIndex = 249;
      expect(scene.isNewBiome()).toBe(true);
    });

    describe("in a run", () => {
      beforeEach(() => {
        game.override
          .startingWave(248)
          .startingBiome(BiomeId.PLAINS)
          .mysteryEncounterChance(0)
          .xpMultiplier(0) // no level-ups (and move prompts) from a wave-248 kill
          .criticalHits(false)
          .battleStyle("single")
          .enemyAbility(AbilityId.BALL_FETCH)
          .enemyMoveset(MoveId.SPLASH)
          .ability(AbilityId.BALL_FETCH)
          .moveset([MoveId.SPLASH]);
      });

      /** Starts an Endless run on wave 248 the way the title screen would, to the first `CommandPhase` */
      async function runToEndlessCommand(): Promise<void> {
        await game.runToTitle();
        game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
          game.scene.gameMode = getGameMode(GameModes.ENDLESS);
          game.scene.offsetGym = false;
          const starters = generateStarters(game.scene, [SpeciesId.LAPRAS, SpeciesId.GENGAR]);
          game.scene.phaseManager.pushNew("EncounterPhase", false);
          new SelectStarterPhase().initBattle(starters);
        });
        vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
        await game.phaseInterceptor.to("EncounterPhase");
        game.removeEnemyHeldItems();
        await game.phaseInterceptor.to("CommandPhase", false);
        expect(game.scene.currentBattle.waveIndex).toBe(248);
        expect(game.scene.arena.biomeId).toBe(BiomeId.PLAINS);
      }

      it("ends wave 248 into the End and makes wave 249 the encounter when the roll hits", async () => {
        vi.spyOn(DarkGtsSpawn, "isDarkGtsEndWave").mockImplementation(wave => wave === 249);
        await runToEndlessCommand();
        game.phaseInterceptor.clearLogs();

        game.move.select(MoveId.SPLASH);
        await game.doKillOpponents();
        game.doSelectModifier();
        game.onNextPrompt(
          "NewBiomeEncounterPhase",
          UiMode.MESSAGE,
          () => game.scene.ui.getHandler<MysteryEncounterUiHandler>().processInput(Button.ACTION),
          () => game.isCurrentPhase("MysteryEncounterPhase"),
          true,
        );
        await game.phaseInterceptor.to("MysteryEncounterPhase", false);

        const battle = game.scene.currentBattle;
        expect(battle.waveIndex).toBe(249);
        expect(game.scene.arena.biomeId).toBe(BiomeId.END);
        expect(battle.battleType).toBe(BattleType.MYSTERY_ENCOUNTER);
        expect(battle.mysteryEncounter?.encounterType).toBe(MysteryEncounterType.DARK_GLOBAL_TRADE_SYSTEM);
        expect(game.phaseInterceptor.phaseLog).toContain("SelectBiomePhase");
        expect(game.phaseInterceptor.phaseLog).toContain("NewBiomeEncounterPhase");

        // leaving: wave 250 (Eternatus) stays in the End, and the End's textures on screen are not cleared
        const clear = vi.spyOn(game.scene, "clearBiomeAssets");
        await runMysteryEncounterToEnd(game, 2);
        await game.phaseInterceptor.to("SwitchBiomePhase");
        expect(game.scene.arena.biomeId).toBe(BiomeId.END);
        expect(clear).not.toHaveBeenCalledWith(BiomeId.END);
      });

      it("keeps wave 249 in the old biome when the roll misses", async () => {
        vi.spyOn(DarkGtsSpawn, "isDarkGtsEndWave").mockReturnValue(false);
        await runToEndlessCommand();
        game.phaseInterceptor.clearLogs();

        game.move.select(MoveId.SPLASH);
        await game.doKillOpponents();
        await game.toNextWave();

        const battle = game.scene.currentBattle;
        expect(battle.waveIndex).toBe(249);
        expect(game.scene.arena.biomeId).toBe(BiomeId.PLAINS);
        expect(battle.battleType).toBe(BattleType.WILD);
        expect(game.phaseInterceptor.phaseLog).not.toContain("SelectBiomePhase");
        expect(game.phaseInterceptor.phaseLog).toContain("NextEncounterPhase");
      });
    });
  });

  /**
   * Every Korean text the encounter puts on screen, captured from the encounter screen (getEncounterText), the
   * message boxes (party screen included) and the test text log: no raw keys, no {{ }} or [[ ]] left.
   */
  describe("Korean text", () => {
    const captured: { flow: string; text: string }[] = [];
    let flow = "";
    const origGetEncounterText = EncounterDialogueUtils.getEncounterText;
    const origTiShowText = TextInterceptor.prototype.showText;
    const origBoxShowText = MessageUiHandler.prototype.showText;

    const relocalize = () => {
      for (const s of speciesDataRegistry.getAllSpecies()) {
        s.localize();
      }
      for (const m of allMoves) {
        m.localize();
      }
    };

    const record = (text: unknown) => {
      if (text != null && text !== "") {
        captured.push({ flow, text: String(text) });
      }
    };

    beforeAll(async () => {
      // the Korean resources were put into i18next at the top of the file
      await i18next.changeLanguage("ko");
      relocalize();
    });

    afterAll(async () => {
      await i18next.changeLanguage("en");
      relocalize();
    });

    beforeEach(() => {
      vi.spyOn(EncounterDialogueUtils, "getEncounterText").mockImplementation((key?: string, style?: any) => {
        const result = origGetEncounterText(key, style);
        record(result);
        return result;
      });
      // UI.showText lands here in tests (MockText); in the game it goes to the open screen's message box
      vi.spyOn(TextInterceptor.prototype, "showText").mockImplementation(function (this: TextInterceptor, text) {
        record(game.scene.ui.mode === UiMode.PARTY ? `[party] ${text}` : text);
        return origTiShowText.call(this, text);
      });
      vi.spyOn(MessageUiHandler.prototype, "showText").mockImplementation(function (
        this: MessageUiHandler,
        text: string,
        ...rest: any[]
      ) {
        record(this instanceof PartyUiHandler ? `[party] ${text}` : text);
        return (origBoxShowText as any).call(this, text, ...rest);
      });
    });

    /** Opens the option screen and hovers both options so their tooltips are built */
    async function hoverOptions(): Promise<void> {
      game.onNextPrompt(
        "MysteryEncounterPhase",
        UiMode.MESSAGE,
        () => game.scene.ui.getHandler<MysteryEncounterUiHandler>().processInput(Button.ACTION),
        () => game.isCurrentPhase("MysteryEncounterOptionSelectedPhase", "CommandPhase", "TurnInitPhase"),
      );
      await game.phaseInterceptor.to("MysteryEncounterPhase");
      const handler = game.scene.ui.getHandler<MysteryEncounterUiHandler>();
      handler.unblockInput();
      handler.processInput(Button.RIGHT);
      handler.processInput(Button.LEFT);
    }

    const textsOf = (f: string) => captured.filter(c => c.flow === f).map(c => c.text);

    it("shows the user's strings on the encounter screen", async () => {
      flow = "screen";
      await startEncounter();
      await hoverOptions();
      const texts = textsOf(flow).join("\n");
      for (const expected of [
        "새까만 GTS 단말기가 있다...?",
        "GTS?",
        "무언가 힘이 느껴지는 GTS입니다.. GTS가 맞겠죠?",
        "어떻게 하시겠습니까?",
        "GTS에 손을 가져다댄다...",
        "불길한 느낌이 든다, 떠난다",
        "한 마리의 포켓몬",
      ]) {
        expect(texts).toContain(expected);
      }
    });

    it("shows the disabled tooltip with one Pokémon able to battle", async () => {
      flow = "disabled";
      const [, gengar] = await startEncounter([SpeciesId.LAPRAS, SpeciesId.GENGAR]);
      gengar.hp = 0;
      await hoverOptions();
      expect(textsOf(flow).join("\n")).toContain("싸울 수 있는 포켓몬이");
    });

    it("option 1: prompt, sending and the reward", async () => {
      flow = "send";
      const [lapras, , abra] = await startEncounter();
      // only the x2 rewards are left, so the count message shows
      fillAll([lapras, abra], ["MINI_BLACK_HOLE", "MYSTERY_ENCOUNTER_MACHO_BRACE"]);
      await scene.updateModifiers(true);
      await runMysteryEncounterToEnd(game, 1, { pokemonNo: 2 });
      const texts = textsOf(flow).join("\n");
      expect(texts).toContain("[party] GTS에 보낼 포켓몬을 선택하세요.");
      expect(texts).toContain("GTS 속으로 빨려 들어갔다...");
      expect(texts).toContain("GTS에서 무언가가 흘러나왔다!");
      expect(texts).toMatch(/2개를 얻었다!/);
    });

    it("option 1: a single reward", async () => {
      flow = "send-single";
      const [lapras, , abra] = await startEncounter();
      fillAll([lapras, abra], ["PRISM", "MULTI_LENS", "MYSTERY_ENCOUNTER_MACHO_BRACE"]);
      await scene.updateModifiers(true);
      await runMysteryEncounterToEnd(game, 1, { pokemonNo: 2 });
      expect(textsOf(flow).join("\n")).toContain("미니 블랙홀을 얻었다!");
    });

    it("option 1: every stack full", async () => {
      flow = "send-full";
      const [lapras, , abra] = await startEncounter();
      fillAll([lapras, abra], SEND_IDS);
      await scene.updateModifiers(true);
      await runMysteryEncounterToEnd(game, 1, { pokemonNo: 2 });
      expect(textsOf(flow).join("\n")).toContain("소지 한도에 도달했습니다");
    });

    it("option 2: leaving", async () => {
      flow = "leave";
      await startEncounter();
      await runMysteryEncounterToEnd(game, 2);
      const texts = textsOf(flow).join("\n");
      expect(texts).toContain("불길한 느낌이 들어");
      expect(texts).toContain("...어라?");
      expect(texts).toContain("황금의알을 지니고 있다!");
    });

    it("option 2: leaving with every egg stack full", async () => {
      flow = "leave-full";
      const party = await startEncounter();
      fillAll(party, ["GOLDEN_EGG"]);
      await scene.updateModifiers(true);
      await runMysteryEncounterToEnd(game, 2);
      expect(textsOf(flow).join("\n")).toContain("황금의알의 소지 한도에 도달했습니다");
    });

    it("leaves no raw key, {{ }} or [[ ]] in anything it showed", () => {
      expect(captured.length).toBeGreaterThan(20);
      for (const { flow: f, text } of captured) {
        expect(text, `${f}: ${text}`).not.toMatch(/\{\{|\}\}|\[\[|\]\]/);
        expect(text, `${f}: ${text}`).not.toContain("darkGlobalTradeSystem");
        expect(text, `${f}: ${text}`).not.toContain("mysteryEncounters/");
      }
    });
  });
});
