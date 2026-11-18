import type { BattleScene } from "#app/battle-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { allMoves, modifierTypes } from "#data/data-lists";
import { CustomPokemonData } from "#data/pokemon-data";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BerryType } from "#enums/berry-type";
import { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { MovePhaseTimingModifier } from "#enums/move-phase-timing-modifier";
import { MoveUseMode } from "#enums/move-use-mode";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Nature } from "#enums/nature";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import {
  BerryModifier,
  PITCH_BLACK_SHUCKLE_JUICE_VALUE,
  PokemonBaseStatTotalModifier,
  type PokemonHeldItemModifier,
} from "#modifiers/modifier";
import type { ModifierTypeOption } from "#modifiers/modifier-type";
import { PokemonMove } from "#moves/pokemon-move";
import {
  BITTER_SHUCKLE_JUICE_VALUE,
  canDrinkShuckleJuice,
  DARK_STRONG_STUFF_FOLLOWER_BERRIES,
  DARK_STRONG_STUFF_FOLLOWER_COUNT,
  DARK_STRONG_STUFF_FOLLOWER_MOVES,
  DARK_STRONG_STUFF_OPENING_MOVES,
  DARK_STRONG_STUFF_WIN_TIERS,
  DarkStrongStuffEncounter,
  getDarkStrongStuffOpeningEffects,
  giveShuckleJuice,
  hasPitchBlackJuice,
  rollDarkShuckleVariant,
  rollDarkStrongStuffRewards,
  SWEET_SHUCKLE_JUICE_VALUE,
} from "#mystery-encounters/dark-strong-stuff-encounter";
import * as EncounterDialogueUtils from "#mystery-encounters/encounter-dialogue-utils";
import * as EncounterPhaseUtils from "#mystery-encounters/encounter-phase-utils";
import { generateModifierType } from "#mystery-encounters/encounter-phase-utils";
import { allMysteryEncounters, mysteryEncountersByBiome } from "#mystery-encounters/mystery-encounter-biomes";
import { PartySizeRequirement, WaveRangeRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { MovePhase } from "#phases/move-phase";
import { GameManager } from "#test/framework/game-manager";
import { TextInterceptor } from "#test/framework/text-interceptor";
import {
  runMysteryEncounterToEnd,
  runSelectMysteryEncounterOption,
  skipBattleRunMysteryEncounterRewardsPhase,
} from "#test/utils/encounter-test-utils";
import type { PhaseString } from "#types/phase-types";
import { MessageUiHandler } from "#ui/message-ui-handler";
import { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import type { MysteryEncounterUiHandler } from "#ui/mystery-encounter-ui-handler";
import { PartyUiHandler, type PokemonSelectFilter } from "#ui/party-ui-handler";
import { getEnumValues } from "#utils/enums";
import i18next from "i18next";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const namespace = "mysteryEncounters/darkStrongStuff";
/** Lapras 130/85/80/85/95/60, Gengar 60/65/60/130/75/110, Abra 25/20/15/105/55/90 */
const defaultParty = [SpeciesId.LAPRAS, SpeciesId.GENGAR, SpeciesId.ABRA];
const defaultBiome = BiomeId.CAVE;
const defaultWave = 45;
const DARK_STRONG_STUFF_BIOMES: readonly BiomeId[] = [BiomeId.CAVE, BiomeId.ABYSS, BiomeId.BADLANDS];
const koFiles = import.meta.glob("../../../locales/ko/**/*.json", { eager: true, import: "default" });

/**
 * Local fork (2026-11-08), the user's design: the ROGUE-tier "강력한 물질?" (The Strong Stuff?, DARK_STRONG_STUFF).
 * Option 1 gives the picked Pokémon the Pitch-Black Shuckle Juice (+30 base stats, +15 HP, one per Pokémon) and every
 * other party member the official bitter juice (-15); option 2 is a relay of six Shuckles: the shiny one uses Stealth
 * Rock, Trick Room and Psychic Terrain before turn 1 and falls, then five friends come out one at a time, each with a
 * free Power Trick (Soul Dew + a Rogue item + ordinary rewards); option 3 gives one random party member with room the
 * official sweet juice (+10).
 */
describe("Custom mystery encounter - The Strong Stuff? (DARK_STRONG_STUFF)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let scene: BattleScene;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    // Korean text straight into i18next: every GameManager replaces the global `fetch` with a mock that can't serve
    // locale files, and in the full suite (`isolate: false`) an earlier file has already done so
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
      .disableTrainerWaves()
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyPassiveAbility(AbilityId.BALL_FETCH);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function startEncounter(party = defaultParty): Promise<PlayerPokemon[]> {
    await game.runToMysteryEncounter(MysteryEncounterType.DARK_STRONG_STUFF, party);
    scene.modifiers = [];
    await scene.updateModifiers(true);
    return scene.getPlayerParty();
  }

  const speciesBase = (id: SpeciesId): number[] => speciesDataRegistry.getSpecies(id).baseStats.slice(0);
  /** What a Shuckle Juice of `value` does to base stats: HP gets half, rounded down; never below 1 */
  const juiced = (stats: readonly number[], value: number): number[] =>
    stats.map((v, i) => Math.max(i === 0 ? Math.floor(v + value / 2) : Math.floor(v + value), 1));
  const juicesOf = (pokemon: Pokemon, value?: number) =>
    pokemon
      .getHeldItems()
      .filter(
        (m): m is PokemonBaseStatTotalModifier =>
          m instanceof PokemonBaseStatTotalModifier && (value == null || m.statModifier === value),
      );
  const stackOf = (pokemon: Pokemon, value: number) => juicesOf(pokemon, value)[0]?.getStackCount() ?? 0;
  const logsInclude = (text: string) => game.textInterceptor.logs.some(l => l.includes(text));

  describe("registration", () => {
    it("is a ROGUE-tier encounter appended last to the enum, with three options, its sprites and its text", async () => {
      await startEncounter();

      expect(MysteryEncounterType.DARK_STRONG_STUFF).toBe(MysteryEncounterType.VENDING_MACHINE + 1);
      // Local fork (2026-11-18): "우두머리!" (ALPHA_ENCOUNTER) came after it; only later types follow it, so its id stays
      expect(getEnumValues(MysteryEncounterType).filter(t => t > MysteryEncounterType.DARK_STRONG_STUFF)).toEqual([
        MysteryEncounterType.ALPHA_ENCOUNTER,
      ]);
      expect(allMysteryEncounters[MysteryEncounterType.DARK_STRONG_STUFF]).toBe(DarkStrongStuffEncounter);
      expect(DarkStrongStuffEncounter.encounterTier).toBe(MysteryEncounterTier.ROGUE);
      expect(DarkStrongStuffEncounter.options).toHaveLength(3);
      expect(DarkStrongStuffEncounter.options.map(o => o.optionMode)).toEqual([
        MysteryEncounterOptionMode.DISABLED_OR_DEFAULT,
        MysteryEncounterOptionMode.DEFAULT,
        MysteryEncounterOptionMode.DEFAULT,
      ]);
      // the official's requirements: the normal wave range and a party of 3
      const [waveRange, partySize] = DarkStrongStuffEncounter.requirements;
      expect(DarkStrongStuffEncounter.requirements).toHaveLength(2);
      expect(waveRange).toBeInstanceOf(WaveRangeRequirement);
      expect(partySize).toBeInstanceOf(PartySizeRequirement);
      expect((partySize as PartySizeRequirement).partySizeRange).toEqual([3, 6]);
      expect(DarkStrongStuffEncounter.hideBattleIntroMessage).toBe(true);
      expect(DarkStrongStuffEncounter.autoHideIntroVisuals).toBe(false);
      expect(DarkStrongStuffEncounter.fleeAllowed).toBe(false);
      expect(DarkStrongStuffEncounter.dialogue.intro).toStrictEqual([{ text: `${namespace}:intro` }]);
      expect(DarkStrongStuffEncounter.dialogue.encounterOptionsDialogue?.title).toBe(`${namespace}:title`);

      // the official's two sprites: the pitch-black juice where it has berry_juice_good, and an always-shiny Shuckle
      const [juice, shuckle] = DarkStrongStuffEncounter.spriteConfigs;
      expect(juice).toMatchObject({ spriteKey: "berry_juice_dark", fileRoot: "items", isItem: true, scale: 1.25 });
      expect(shuckle).toMatchObject({ species: SpeciesId.SHUCKLE, isShiny: true, scale: 1.25 });

      expect(i18next.t(`${namespace}:title`)).toBe("The Strong Stuff?");
      expect(i18next.t(`${namespace}:option.1.label`)).toBe("Make one Pokémon drink it all…");
      expect(i18next.t(`${namespace}:option.3.label`)).toBe("A bad smell… Leave");
      expect(scene.currentBattle.mysteryEncounter?.encounterType).toBe(MysteryEncounterType.DARK_STRONG_STUFF);
      expect(scene.currentBattle.mysteryEncounter?.dialogueTokens.shuckleName).toBe("Shuckle");
    });

    it("spawns in the Cave, the Abyss and the Badlands, and nowhere else", () => {
      for (const biome of DARK_STRONG_STUFF_BIOMES) {
        expect(mysteryEncountersByBiome.get(biome), `biome ${BiomeId[biome]}`).toContain(
          MysteryEncounterType.DARK_STRONG_STUFF,
        );
      }
      for (const [biome, encounters] of mysteryEncountersByBiome) {
        if (!DARK_STRONG_STUFF_BIOMES.includes(biome)) {
          expect(encounters, `biome ${BiomeId[biome]}`).not.toContain(MysteryEncounterType.DARK_STRONG_STUFF);
        }
      }
      // the biomes keep their own encounters
      expect(mysteryEncountersByBiome.get(BiomeId.CAVE)).toContain(MysteryEncounterType.THE_STRONG_STUFF);
      expect(mysteryEncountersByBiome.get(BiomeId.CAVE)).toContain(MysteryEncounterType.TINKATON_FORGE);
      expect(mysteryEncountersByBiome.get(BiomeId.ABYSS)).toContain(MysteryEncounterType.DARK_MYSTERIOUS_CHEST);
      expect(mysteryEncountersByBiome.get(BiomeId.BADLANDS)).toContain(MysteryEncounterType.DANCING_LESSONS);
    });

    it("rolls the Shuckle's shiny variant with the ordinary odds, the same for the intro sprite and the battle", async () => {
      const loadMoves = vi.spyOn(EncounterPhaseUtils, "loadCustomMovesForEncounter");
      await startEncounter();
      const encounter = scene.currentBattle.mysteryEncounter!;
      const [lead] = encounter.enemyPartyConfigs[0].pokemonConfigs!;
      expect(lead.shiny).toBe(true);
      expect([0, 1, 2]).toContain(lead.variant);
      expect(encounter.spriteConfigs[1]).toMatchObject({ isShiny: true, variant: lead.variant });
      expect(encounter.introVisuals!.spriteConfigs[1]).toMatchObject({ isShiny: true, variant: lead.variant });
      expect(encounter.introVisuals!.spriteConfigs[0].spriteKey).toBe("berry_juice_dark");
      // the opening moves, and Power Trick for the friends' entry animation
      expect(loadMoves).toHaveBeenCalledWith([
        MoveId.STEALTH_ROCK,
        MoveId.TRICK_ROOM,
        MoveId.PSYCHIC_TERRAIN,
        MoveId.POWER_TRICK,
      ]);

      const counts = [0, 0, 0];
      for (let i = 0; i < 300; i++) {
        scene.setSeed(`dark-shuckle-${i}`);
        scene.resetSeed(1);
        counts[rollDarkShuckleVariant()]++;
      }
      // 6/10, 3/10, 1/10
      expect(counts[0]).toBeGreaterThan(counts[1]);
      expect(counts[1]).toBeGreaterThan(counts[2]);
      expect(counts[2]).toBeGreaterThan(0);
    });

    it("sets up six Shuckles in one single-battle party: the shiny lead and five ordinary friends, no bosses", async () => {
      await startEncounter();
      const encounter = scene.currentBattle.mysteryEncounter!;
      expect(encounter.enemyPartyConfigs).toHaveLength(1);
      const [config] = encounter.enemyPartyConfigs;
      expect(config.levelAdditiveModifier).toBe(1);
      expect(config.disableSwitch).toBe(true);
      expect(config.doubleBattle ?? false).toBe(false);
      expect(config.pokemonConfigs).toHaveLength(6);
      expect(DARK_STRONG_STUFF_FOLLOWER_COUNT).toBe(5);
      const [lead, ...followers] = config.pokemonConfigs!;
      // the lead: the shining Shuckle from the intro, its opening moves, nothing held, no juice boost any more
      expect(lead).toMatchObject({
        isBoss: false,
        shiny: true,
        nature: Nature.HARDY,
        customPokemonData: new CustomPokemonData({ spriteScale: 1.25 }),
        modifierConfigs: [],
      });
      expect(lead.bossSegments).toBeUndefined();
      expect(lead.tags).toBeUndefined();
      expect(lead.mysteryEncounterBattleEffects).toBeUndefined();
      expect(lead.moveSet).toEqual([MoveId.STEALTH_ROCK, MoveId.TRICK_ROOM, MoveId.PSYCHIC_TERRAIN]);
      // the friends: ordinary colours, Gyro Ball / Salt Cure / Stone Edge / Heal Order, a Sitrus and a Lum Berry each
      expect(followers).toHaveLength(5);
      for (const follower of followers) {
        expect(follower).toMatchObject({ isBoss: false, shiny: false, nature: Nature.HARDY });
        expect(follower.tags).toBeUndefined();
        expect(follower.customPokemonData).toBeUndefined();
        expect(follower.moveSet).toEqual([MoveId.GYRO_BALL, MoveId.SALT_CURE, MoveId.STONE_EDGE, MoveId.HEAL_ORDER]);
        expect(follower.modifierConfigs?.map(m => (m.modifier as any).berryType)).toEqual([
          BerryType.SITRUS,
          BerryType.LUM,
        ]);
      }
      expect(DARK_STRONG_STUFF_FOLLOWER_BERRIES).toEqual([BerryType.SITRUS, BerryType.LUM]);
      for (const p of config.pokemonConfigs!) {
        expect(p.species.speciesId).toBe(SpeciesId.SHUCKLE);
      }
      // still no Poké Balls in this encounter (the official default)
      expect(DarkStrongStuffEncounter.catchAllowed).toBe(false);
      // every move, the opening ones and Power Trick included, is implemented in full
      for (const move of [
        ...DARK_STRONG_STUFF_FOLLOWER_MOVES,
        ...DARK_STRONG_STUFF_OPENING_MOVES,
        MoveId.POWER_TRICK,
      ]) {
        expect(allMoves[move].isUnimplemented, MoveId[move]).toBe(false);
        expect(allMoves[move].name, MoveId[move]).not.toMatch(/\((N|P)\)/);
      }
    });

    it("keeps the opening in its listed order even though Trick Room has -7 priority", () => {
      const effects = getDarkStrongStuffOpeningEffects();
      expect(effects.map(e => e.move.moveId)).toEqual([MoveId.STEALTH_ROCK, MoveId.TRICK_ROOM, MoveId.PSYCHIC_TERRAIN]);
      expect(allMoves[MoveId.TRICK_ROOM].priority).toBe(-7);
      expect(effects.map(e => e.timingModifier)).toEqual([
        MovePhaseTimingModifier.FIRST,
        MovePhaseTimingModifier.NORMAL,
        MovePhaseTimingModifier.LAST,
      ]);
      expect(effects.map(e => e.targets)).toEqual([
        [BattlerIndex.PLAYER],
        [BattlerIndex.ENEMY, BattlerIndex.PLAYER],
        [BattlerIndex.ENEMY, BattlerIndex.PLAYER],
      ]);
      for (const e of effects) {
        expect(e.sourceBattlerIndex).toBe(BattlerIndex.ENEMY);
        expect(e.useMode).toBe(MoveUseMode.IGNORE_PP);
      }
    });
  });

  describe("juice items", () => {
    it("keeps the official sweet and bitter juices and adds the Pitch-Black one (30) with its own name, text and icon", async () => {
      const [lapras] = await startEncounter();
      const sweet = generateModifierType(modifierTypes.MYSTERY_ENCOUNTER_SHUCKLE_JUICE, [10])!;
      const bitter = generateModifierType(modifierTypes.MYSTERY_ENCOUNTER_SHUCKLE_JUICE, [-15])!;
      const dark = generateModifierType(modifierTypes.MYSTERY_ENCOUNTER_SHUCKLE_JUICE, [30])!;
      expect([sweet.name, sweet.iconImage]).toEqual(["Sweet Shuckle Juice", "berry_juice_good"]);
      expect([bitter.name, bitter.iconImage]).toEqual(["Foul Shuckle Juice", "berry_juice_bad"]);
      expect([dark.name, dark.iconImage]).toEqual(["Pitch-Black Shuckle Juice", "berry_juice_dark"]);
      expect(sweet.getDescription()).toBe("Increases all of the holder’s base stats. You were blessed by the Shuckle.");
      expect(bitter.getDescription()).toBe("Decreases all of the holder’s base stats. You were cursed by the Shuckle.");
      expect(dark.getDescription()).toContain("Greatly increases all of the holder’s base stats.");
      expect(dark.id).toBe("MYSTERY_ENCOUNTER_SHUCKLE_JUICE");
      expect(PITCH_BLACK_SHUCKLE_JUICE_VALUE).toBe(30);

      // caps: 2 for the official ones, 1 for the Pitch-Black juice
      const caps = [10, -15, 30].map(v => {
        const type = generateModifierType(modifierTypes.MYSTERY_ENCOUNTER_SHUCKLE_JUICE, [v])!;
        return (type.newModifier(lapras) as PokemonHeldItemModifier).getMaxStackCount();
      });
      expect(caps).toEqual([2, 2, 1]);
    });

    it("adds +30 to every base stat and +15 to HP, one per Pokémon", async () => {
      const [lapras] = await startEncounter();
      const balls = [...Object.values(scene.pokeballCounts)];
      expect(giveShuckleJuice(lapras, 30)).toBe(true);
      expect(lapras.calculateBaseStats()).toEqual([145, 115, 110, 115, 125, 90]);
      expect(juiced(speciesBase(SpeciesId.LAPRAS), 30)).toEqual([145, 115, 110, 115, 125, 90]);
      expect(hasPitchBlackJuice(lapras)).toBe(true);
      expect(canDrinkShuckleJuice(lapras, 30)).toBe(false);
      // a second one is refused, with no stack-full Poké Balls or message
      expect(giveShuckleJuice(lapras, 30)).toBe(false);
      expect(stackOf(lapras, 30)).toBe(1);
      expect(Object.values(scene.pokeballCounts)).toEqual(balls);
      expect(scene.phaseManager.hasPhaseOfType("MessagePhase")).toBe(false);
      expect(lapras.calculateBaseStats()).toEqual([145, 115, 110, 115, 125, 90]);
      const [held] = juicesOf(lapras, 30);
      expect(held.isTransferable).toBe(false);
      expect(held.getMaxStackCount()).toBe(1);
      expect(held.type.name).toBe("Pitch-Black Shuckle Juice");
      expect(held.type.iconImage).toBe("berry_juice_dark");
    });

    // Local fork (2026-11-08), review: matchType keeps the +30 apart from the official juices on the same Pokémon
    it("keeps the Pitch-Black juice a separate item from the sweet and bitter ones", async () => {
      const [lapras] = await startEncounter();
      expect(giveShuckleJuice(lapras, SWEET_SHUCKLE_JUICE_VALUE)).toBe(true);
      expect(giveShuckleJuice(lapras, PITCH_BLACK_SHUCKLE_JUICE_VALUE)).toBe(true);
      expect(giveShuckleJuice(lapras, BITTER_SHUCKLE_JUICE_VALUE)).toBe(true);
      // Local fork (2026-11-08): a second juice of a value it already holds would do nothing, so it isn't given
      expect(giveShuckleJuice(lapras, SWEET_SHUCKLE_JUICE_VALUE)).toBe(false);
      expect(juicesOf(lapras)).toHaveLength(3);
      expect([stackOf(lapras, 10), stackOf(lapras, 30), stackOf(lapras, -15)]).toEqual([1, 1, 1]);
      expect(
        juicesOf(lapras)
          .map(m => m.type.iconImage)
          .sort(),
      ).toEqual(["berry_juice_bad", "berry_juice_dark", "berry_juice_good"]);
      // +10 +30 -15; HP 130+5+15-7.5
      expect(lapras.calculateBaseStats()).toEqual([142, 110, 105, 110, 120, 85]);
    });

    it("keeps the Pitch-Black juice, its name, icon and stats through a session save and load", async () => {
      game.override.mysteryEncounterChance(0);
      await game.classicMode.startBattle(SpeciesId.LAPRAS);
      const [lapras] = scene.getPlayerParty();
      giveShuckleJuice(lapras, 30);
      giveShuckleJuice(lapras, -15);
      const boosted = lapras.calculateBaseStats();
      const maxHp = lapras.getMaxHp();
      // +30 then -15: HP 130 + 15 - 7.5 rounded down, the rest +15
      expect(boosted).toEqual([137, 100, 95, 100, 110, 75]);

      const { gameData } = scene;
      const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
      const session = gameData.parseSessionData(json);
      const saved = session.modifiers.filter(m => m.typeId === "MYSTERY_ENCOUNTER_SHUCKLE_JUICE");
      expect(saved).toHaveLength(2);
      const darkSave = saved.find(m => m.typePregenArgs?.[0] === 30)!;
      expect(darkSave.className).toBe("PokemonBaseStatTotalModifier");
      expect(darkSave.args).toEqual([lapras.id, 30]);
      expect(darkSave.stackCount).toBe(1);
      game.reload["sessionData"] = session;
      await game.reload.reloadSession();

      const [loaded] = game.scene.getPlayerParty();
      const [dark] = juicesOf(loaded, 30);
      expect(dark).toBeDefined();
      expect(dark.type.name).toBe("Pitch-Black Shuckle Juice");
      expect(dark.type.iconImage).toBe("berry_juice_dark");
      expect(dark.getMaxStackCount()).toBe(1);
      expect(juicesOf(loaded, -15)).toHaveLength(1);
      expect(loaded.calculateBaseStats()).toEqual(boosted);
      expect(loaded.getMaxHp()).toBe(maxHp);
    });
  });

  describe("option 1 - make one Pokémon drink it all", () => {
    it("gives the pick +30 (+15 HP) and everyone else -15 (-7.5 HP, rounded down), with no reward screen or shop", async () => {
      const [lapras, gengar, abra] = await startEncounter();
      const leave = vi.spyOn(EncounterPhaseUtils, "leaveEncounterWithoutBattle");
      const hide = vi.spyOn(EncounterPhaseUtils, "transitionMysteryEncounterIntroVisuals");

      await runMysteryEncounterToEnd(game, 1, { pokemonNo: 2 });

      expect(gengar.calculateBaseStats()).toEqual(juiced(speciesBase(SpeciesId.GENGAR), 30));
      expect(gengar.calculateBaseStats()).toEqual([75, 95, 90, 160, 105, 140]);
      expect(lapras.calculateBaseStats()).toEqual(juiced(speciesBase(SpeciesId.LAPRAS), -15));
      expect(lapras.calculateBaseStats()).toEqual([122, 70, 65, 70, 80, 45]);
      // Abra's Defense 15 - 15 stops at 1
      expect(abra.calculateBaseStats()).toEqual([17, 5, 1, 90, 40, 75]);
      expect(juicesOf(gengar)).toHaveLength(1);
      expect(stackOf(gengar, 30)).toBe(1);
      expect(juicesOf(gengar)[0].type.name).toBe("Pitch-Black Shuckle Juice");
      for (const other of [lapras, abra]) {
        expect(juicesOf(other)).toHaveLength(1);
        expect(stackOf(other, -15)).toBe(1);
      }
      expect(hide).toHaveBeenCalledWith(true, true, 500);

      expect(leave).toHaveBeenCalledTimes(1);
      expect(leave.mock.calls[0][0] ?? false).toBe(false);
      expect(scene.currentBattle.mysteryEncounter?.doEncounterRewards).toBeUndefined();
      expect(scene.phaseManager.hasPhaseOfType("SelectModifierPhase")).toBe(false);
      expect(logsInclude("Gengar gulped down the pitch-black")).toBe(true);
      expect(logsInclude("An incredible power surges")).toBe(true);
      expect(logsInclude("were each increased by 30!")).toBe(true);
      expect(logsInclude("But the awful smell left")).toBe(true);
      expect(logsInclude("each reduced by 15!")).toBe(true);
    });

    // Local fork (2026-11-08): a second bitter juice would change nothing (upstream's apply ignores the stack count)
    it("leaves Pokémon that already hold the bitter juice as they are, and weakens the rest", async () => {
      const [lapras, gengar, abra] = await startEncounter();
      expect(giveShuckleJuice(lapras, BITTER_SHUCKLE_JUICE_VALUE)).toBe(true);
      expect(giveShuckleJuice(lapras, BITTER_SHUCKLE_JUICE_VALUE)).toBe(false);
      expect(canDrinkShuckleJuice(lapras, BITTER_SHUCKLE_JUICE_VALUE)).toBe(false);
      const before = lapras.calculateBaseStats();
      const balls = [...Object.values(scene.pokeballCounts)];

      await runMysteryEncounterToEnd(game, 1, { pokemonNo: 2 });

      expect(stackOf(lapras, -15)).toBe(1);
      expect(lapras.calculateBaseStats()).toEqual(before);
      expect(stackOf(abra, -15)).toBe(1);
      expect(stackOf(gengar, 30)).toBe(1);
      expect(Object.values(scene.pokeballCounts)).toEqual(balls);
      expect(logsInclude("stack")).toBe(false);
      expect(logsInclude("But the awful smell left")).toBe(true); // Abra was weakened
    });

    it("shows no smell message when everyone else is already at the bitter juice's cap", async () => {
      const [lapras, gengar, abra] = await startEncounter();
      for (const p of [lapras, abra]) {
        giveShuckleJuice(p, BITTER_SHUCKLE_JUICE_VALUE);
        giveShuckleJuice(p, BITTER_SHUCKLE_JUICE_VALUE);
      }

      await runMysteryEncounterToEnd(game, 1, { pokemonNo: 2 });

      expect(stackOf(gengar, 30)).toBe(1);
      expect(logsInclude("An incredible power surges")).toBe(true);
      expect(logsInclude("But the awful smell left")).toBe(false);
    });

    it("only lets a Pokémon that has not had the Pitch-Black juice be picked", async () => {
      const [lapras, gengar, abra] = await startEncounter();
      giveShuckleJuice(abra, 30);
      const select = vi.spyOn(EncounterPhaseUtils, "selectPokemonForOption");

      await runMysteryEncounterToEnd(game, 1, { pokemonNo: 1 });

      const filter = select.mock.calls[0][2] as PokemonSelectFilter;
      expect(filter(abra)).toBe("That Pokémon already had the pitch-black juice!");
      expect(filter(gengar)).toBeNull();
      expect(filter(lapras)).toBe("That Pokémon already had the pitch-black juice!"); // had it by this pick
      // Abra keeps its one Pitch-Black juice and also gets a bitter one
      expect(stackOf(abra, 30)).toBe(1);
      expect(stackOf(abra, -15)).toBe(1);
    });

    it("keeps the party screen open with the reason after a wrong pick; cancelling goes back to the options", async () => {
      const [lapras, gengar] = await startEncounter();
      giveShuckleJuice(gengar, 30);
      const partyTexts: string[] = [];
      const origShowText = MessageUiHandler.prototype.showText;
      vi.spyOn(MessageUiHandler.prototype, "showText").mockImplementation(function (
        this: MessageUiHandler,
        text: string,
        ...rest: any[]
      ) {
        if (this instanceof PartyUiHandler) {
          partyTexts.push(text);
        }
        return (origShowText as any).call(this, text, ...rest);
      });

      await runSelectMysteryEncounterOption(game, 1, { pokemonNo: 2 });

      await vi.waitFor(() => expect(partyTexts).toContain("That Pokémon already had the pitch-black juice!"));
      // the prompt goes through `ui.showText`, which the test harness logs
      expect(logsInclude("Choose a Pokémon to drink the juice.")).toBe(true);
      expect(scene.ui.mode).toBe(UiMode.PARTY);

      const party = scene.ui.getHandler<PartyUiHandler>();
      await vi.waitFor(() => expect(party.processInput(Button.ACTION)).toBe(true)); // closes the message
      await vi.waitFor(() => expect(party.processInput(Button.CANCEL)).toBe(true)); // leaves the party screen
      await vi.waitFor(() => expect(scene.ui.mode).toBe(UiMode.MYSTERY_ENCOUNTER));
      expect(game).toBeAtPhase("MysteryEncounterPhase");
      expect(juicesOf(lapras)).toHaveLength(0);
      expect(stackOf(gengar, 30)).toBe(1);
      expect(juicesOf(gengar, -15)).toHaveLength(0);
    });

    it("is disabled once every party member has had the Pitch-Black juice", async () => {
      const [lapras, gengar, abra] = await startEncounter();
      const [drink, fight, leave] = DarkStrongStuffEncounter.options;
      expect(drink.meetsRequirements()).toBe(true);
      giveShuckleJuice(lapras, 30);
      giveShuckleJuice(gengar, 30);
      expect(drink.meetsRequirements()).toBe(true);
      giveShuckleJuice(abra, 30);
      expect(drink.meetsRequirements()).toBe(false);
      expect(fight.meetsRequirements()).toBe(true);
      expect(leave.meetsRequirements()).toBe(true);
      expect(i18next.t(`${namespace}:option.1.disabledTooltip`)).toBe(
        "(-) Everyone has already\nhad the pitch-black juice",
      );
    });
  });

  describe("option 2 - fight the Shuckles", () => {
    const logIndex = (text: string, from = 0) =>
      game.textInterceptor.logs.findIndex((l, i) => i >= from && l.replaceAll("\n", " ").includes(text));
    const countLogs = (text: string) =>
      game.textInterceptor.logs.filter(l => l.replaceAll("\n", " ").includes(text)).length;

    beforeEach(() => {
      // level 100: no EXP level-ups (their prompts) and the party survives the friends' hits
      game.override
        .battleStyle("single")
        .startingLevel(100)
        .moveset([MoveId.SPLASH, MoveId.TACKLE, MoveId.QUICK_ATTACK]);
    });

    /** Runs option 2 to the first command of turn 1 */
    async function startFight(): Promise<void> {
      await startEncounter();
      await runMysteryEncounterToEnd(game, 2, undefined, true);
      // runMysteryEncounterToEnd can leave its option prompt queued, which would hold back move.select's
      (game.promptHandler as unknown as { prompts: unknown[] }).prompts.length = 0;
    }

    it("opens with Stealth Rock, Trick Room and Psychic Terrain before turn 1, then the shiny Shuckle falls on its own", async () => {
      const used: { move: MoveId; user: Pokemon }[] = [];
      const origMoveStart = MovePhase.prototype.start;
      vi.spyOn(MovePhase.prototype, "start").mockImplementation(function (this: MovePhase) {
        used.push({ move: this.move.moveId, user: this.pokemon });
        return origMoveStart.call(this);
      });
      const exp = vi.spyOn(scene, "applyPartyExp");
      await startEncounter();
      const variant = scene.currentBattle.mysteryEncounter!.enemyPartyConfigs[0].pokemonConfigs![0].variant;
      game.phaseInterceptor.clearLogs();

      await runMysteryEncounterToEnd(game, 2, undefined, true);

      expect(game).toBeAtPhase("CommandPhase");
      const encounter = scene.currentBattle.mysteryEncounter!;
      expect(encounter.encounterMode).toBe(MysteryEncounterMode.BOSS_BATTLE);
      // a single battle: one Shuckle on the field, five more in the party
      expect(scene.currentBattle.double).toBe(false);
      const party = scene.getEnemyParty();
      expect(party).toHaveLength(6);
      expect(scene.getEnemyField()).toHaveLength(1);
      expect(party.every(p => p.species.speciesId === SpeciesId.SHUCKLE && !p.isBoss())).toBe(true);
      const lead = party.find(p => p.id === encounter.misc.leadId)!;
      expect(lead.isShiny()).toBe(true);
      expect(lead.variant).toBe(variant);
      expect(lead.getSpriteScale()).toBeGreaterThan(party.find(p => p !== lead)!.getSpriteScale());
      expect(lead.getHeldItems()).toHaveLength(0);
      expect(lead.isFainted()).toBe(true);
      expect(lead.isOnField()).toBe(false);

      // only its three opening moves before turn 1, in that order (the friend's Power Trick is no move)
      expect(used.map(u => u.move)).toEqual([MoveId.STEALTH_ROCK, MoveId.TRICK_ROOM, MoveId.PSYCHIC_TERRAIN]);
      expect(used.every(u => u.user === lead)).toBe(true);
      // the order on screen: three moves, its fall, the faint, the first friend, the friend's Power Trick
      const order = [
        "used Stealth Rock!",
        "used Trick Room!",
        "used Psychic Terrain!",
        "Shuckle poured out all its strength and fell in glory…!",
        "Shuckle fainted!",
        "A wild Shuckle appeared!",
        "switched its Attack and Defense!",
      ].map(text => logIndex(text));
      expect(
        order.every(i => i > -1),
        String(order),
      ).toBe(true);
      expect(order).toEqual([...order].sort((a, b) => a - b));
      // the phases: no command before the friend is out; the faint is an ordinary FaintPhase with its VictoryPhase
      const phases = game.phaseInterceptor.phaseLog;
      const at = (name: PhaseString, from = 0) => phases.indexOf(name, from);
      const fall = at("MysteryEncounterSelfFaintPhase");
      expect(at("MysteryEncounterBattleStartCleanupPhase")).toBeLessThan(fall);
      expect(fall).toBeLessThan(at("FaintPhase", fall));
      expect(at("FaintPhase", fall)).toBeLessThan(at("VictoryPhase", fall));
      expect(at("VictoryPhase", fall)).toBeLessThan(at("SwitchSummonPhase", fall));
      expect(at("SwitchSummonPhase", fall)).toBeLessThan(at("PostSummonPhase", fall));
      expect(at("CommandPhase")).toBeGreaterThan(at("PostSummonPhase", fall));
      // one TurnInitPhase gave no commands; the next one gives turn 1's to the player and the friend
      expect(phases.filter(p => p === "TurnInitPhase")).toHaveLength(2);
      expect(phases.filter(p => p === "CommandPhase")).toHaveLength(1);
      expect(phases.filter(p => p === "TurnStartPhase")).toHaveLength(0);
      expect(scene.phaseManager.hasPhaseOfType("EnemyCommandPhase")).toBe(true);
      // EXP for the party and a KO like any other; no damage to the player, and turn 1 hasn't been played
      expect(exp).toHaveBeenCalledTimes(1);
      expect(exp.mock.calls[0][0]).toBe(lead.getExpValue());
      expect(scene.currentBattle.enemyFaints).toBe(1);
      expect(scene.getPlayerParty().every(p => p.isFullHp())).toBe(true);
      expect(scene.currentBattle.turn).toBe(1);
      expect(scene.phaseManager.hasPhaseOfType("BattleEndPhase")).toBe(false);
      expect(scene.phaseManager.hasPhaseOfType("MysteryEncounterRewardsPhase")).toBe(false);
    });

    it("sends out the first friend in ordinary colours, with Power Trick already done and its moves", async () => {
      await startFight();
      const encounter = scene.currentBattle.mysteryEncounter!;
      const [follower] = scene.getEnemyField();
      expect(follower.id).toBe(encounter.misc.followerIds[0]);
      expect(encounter.misc.followerIds).toHaveLength(5);
      expect(follower.isShiny()).toBe(false);
      expect(follower.isBoss()).toBe(false);
      expect(follower.moveset).toEqual(DARK_STRONG_STUFF_FOLLOWER_MOVES.map(m => new PokemonMove(m)));
      const berry = (type: BerryType) =>
        follower
          .getHeldItems()
          .find(m => m instanceof BerryModifier && m.berryType === type)
          ?.getStackCount();
      expect(follower.getHeldItems()).toHaveLength(2);
      expect([BerryType.SITRUS, BerryType.LUM].map(berry)).toEqual([1, 1]);
      // Power Trick: its battle Attack is its own Defense stat (230 base) and the other way round
      expect(follower.getTag(BattlerTagType.POWER_TRICK)).toBeDefined();
      expect(follower.getStat(Stat.ATK, false)).toBe(follower.getStat(Stat.DEF));
      expect(follower.getStat(Stat.DEF, false)).toBe(follower.getStat(Stat.ATK));
      expect(follower.getStat(Stat.ATK, false)).toBeGreaterThan(follower.getStat(Stat.ATK) * 5);
      // no juice boost for the friends, and the free Power Trick used no move
      expect(follower.getStatStages()).toEqual([0, 0, 0, 0, 0, 0, 0]);
      expect(follower.getMoveHistory()).toHaveLength(0);
      expect(countLogs("used Power Trick!")).toBe(0);
      expect(countLogs("switched its Attack and Defense!")).toBe(1);
    });

    it("has Trick Room, Psychic Terrain and Stealth Rock up when the first friend acts in turn 1", async () => {
      await startFight();
      const [follower] = scene.getEnemyField();
      const player = scene.getPlayerPokemon()!;
      expect(scene.arena.getTag(ArenaTagType.TRICK_ROOM)).toBeDefined();
      expect(scene.arena.terrainType).toBe(TerrainType.PSYCHIC);
      expect(scene.arena.getTagOnSide(ArenaTagType.STEALTH_ROCK, ArenaTagSide.PLAYER)).toBeDefined();
      expect(scene.arena.getTagOnSide(ArenaTagType.STEALTH_ROCK, ArenaTagSide.ENEMY)).toBeUndefined();

      const order: Pokemon[] = [];
      const field: { trickRoom: boolean; terrain: TerrainType; rocks: boolean }[] = [];
      const origMoveStart = MovePhase.prototype.start;
      vi.spyOn(MovePhase.prototype, "start").mockImplementation(function (this: MovePhase) {
        order.push(this.pokemon);
        if (this.pokemon === follower) {
          field.push({
            trickRoom: !!scene.arena.getTag(ArenaTagType.TRICK_ROOM),
            terrain: scene.arena.terrainType,
            rocks: !!scene.arena.getTagOnSide(ArenaTagType.STEALTH_ROCK, ArenaTagSide.PLAYER),
          });
        }
        return origMoveStart.call(this);
      });
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      // under Trick Room the slow Shuckle moved first, with all three effects up
      expect(order).toEqual([follower, player]);
      expect(field).toEqual([{ trickRoom: true, terrain: TerrainType.PSYCHIC, rocks: true }]);
      // it acted normally in the same turn: one of its own moves, after the free Power Trick
      expect(follower.getMoveHistory()).toHaveLength(1);
      expect(DARK_STRONG_STUFF_FOLLOWER_MOVES).toContain(follower.getMoveHistory()[0].move);
      expect(follower.getTag(BattlerTagType.POWER_TRICK)).toBeDefined();

      // turn 2, Quick Attack: priority goes first, and Psychic Terrain blocks it against the grounded Shuckle
      order.length = 0;
      const hp = follower.hp;
      game.move.select(MoveId.QUICK_ATTACK);
      await game.toNextTurn();
      expect(order).toEqual([player, follower]);
      expect(follower.hp).toBeGreaterThanOrEqual(hp);
      expect(logsInclude("is protected by the Psychic Terrain!")).toBe(true);
    });

    it("gives every friend Power Trick for free as it comes out, and only all six down wins", async () => {
      game.override.enemyMoveset(MoveId.SPLASH);
      await startFight();
      const encounter = scene.currentBattle.mysteryEncounter!;
      const followerIds: number[] = encounter.misc.followerIds;
      const victory = vi.spyOn(EncounterPhaseUtils, "handleMysteryEncounterVictory");

      for (let k = 0; k < DARK_STRONG_STUFF_FOLLOWER_COUNT; k++) {
        const [current] = scene.getEnemyField();
        expect(current.id, `friend ${k + 1}`).toBe(followerIds[k]);
        expect(current.isShiny()).toBe(false);
        expect(current.getTag(BattlerTagType.POWER_TRICK), `friend ${k + 1}`).toBeDefined();
        expect(current.getStat(Stat.ATK, false)).toBe(current.getStat(Stat.DEF));
        expect(current.getStat(Stat.DEF, false)).toBe(current.getStat(Stat.ATK));
        expect(current.getMoveHistory()).toHaveLength(0);
        expect(countLogs("switched its Attack and Defense!")).toBe(k + 1);
        expect(scene.currentBattle.enemyFaints).toBe(k + 1);

        game.move.select(MoveId.TACKLE);
        if (k < DARK_STRONG_STUFF_FOLLOWER_COUNT - 1) {
          await game.toNextTurn();
          expect(current.isFainted()).toBe(true);
          expect(countLogs("A wild Shuckle appeared!")).toBe(k + 2);
          // the battle goes on while a friend is left
          expect(scene.phaseManager.hasPhaseOfType("MysteryEncounterRewardsPhase")).toBe(false);
          expect(scene.getEnemyField()).toHaveLength(1);
        }
      }

      // the sixth faint ends it: the reward screen comes up
      await game.phaseInterceptor.to("MysteryEncounterRewardsPhase", false);
      expect(scene.getEnemyParty().every(p => p.isFainted())).toBe(true);
      expect(scene.currentBattle.enemyFaints).toBe(6);
      expect(countLogs("A wild Shuckle appeared!")).toBe(5);
      expect(countLogs("switched its Attack and Defense!")).toBe(5);
      expect(victory).toHaveBeenCalledTimes(5);
      await game.phaseInterceptor.to("SelectModifierPhase");
      const handler = scene.ui.handlers.find(h => h instanceof ModifierSelectUiHandler) as ModifierSelectUiHandler;
      const options = handler.options.map(o => o.modifierTypeOption);
      expect(options[0].type.id).toBe("SOUL_DEW");
      expect(options[1].type.tier).toBe(ModifierTier.ROGUE);
    });

    it("sends Stealth Rock back off a player's Magic Bounce without stalling: the friends take it and still get Power Trick", async () => {
      game.override.ability(AbilityId.MAGIC_BOUNCE).enemyMoveset(MoveId.SPLASH);
      await startFight();
      const [follower] = scene.getEnemyField();
      expect(scene.arena.getTagOnSide(ArenaTagType.STEALTH_ROCK, ArenaTagSide.ENEMY)).toBeDefined();
      expect(scene.arena.getTagOnSide(ArenaTagType.STEALTH_ROCK, ArenaTagSide.PLAYER)).toBeUndefined();
      expect(scene.arena.getTag(ArenaTagType.TRICK_ROOM)).toBeDefined();
      expect(scene.arena.terrainType).toBe(TerrainType.PSYCHIC);
      expect(follower.hp).toBeLessThan(follower.getMaxHp());
      expect(follower.getTag(BattlerTagType.POWER_TRICK)).toBeDefined();
      expect(logIndex("bounced the Stealth Rock back!")).toBeLessThan(logIndex("poured out all its strength"));
    });

    it("keeps a friend in against Whirlwind and Dragon Tail; one that comes back in gets Power Trick exactly once", async () => {
      game.override.moveset([MoveId.WHIRLWIND, MoveId.DRAGON_TAIL]).enemyMoveset(MoveId.SPLASH);
      await startFight();
      const encounter = scene.currentBattle.mysteryEncounter!;
      const [first, second] = encounter.misc.followerIds.map((id: number) => scene.getPokemonById(id)!);
      expect(scene.getEnemyField()[0]).toBe(first);
      // no fleeing in this encounter, so nothing drags a friend out
      game.move.select(MoveId.WHIRLWIND);
      await game.toNextTurn();
      game.move.select(MoveId.DRAGON_TAIL);
      await game.toNextTurn();
      expect(scene.getEnemyField()[0]).toBe(first);
      expect(countLogs("switched its Attack and Defense!")).toBe(1);

      // should a friend ever leave and come back, its stats swap once per entry, never back
      encounter.fleeAllowed = true;
      vi.spyOn(scene.getPlayerPokemon()!, "randBattleSeedInt").mockReturnValue(0);
      const [atk, def] = [first.getStat(Stat.ATK), first.getStat(Stat.DEF)];
      game.move.select(MoveId.WHIRLWIND);
      await game.toNextTurn();
      expect(scene.getEnemyField()[0]).toBe(second);
      expect(second.getTag(BattlerTagType.POWER_TRICK)).toBeDefined();
      game.move.select(MoveId.WHIRLWIND);
      await game.toNextTurn();
      expect(scene.getEnemyField()[0]).toBe(first);
      expect(countLogs("switched its Attack and Defense!")).toBe(3);
      expect(first.getTag(BattlerTagType.POWER_TRICK)).toBeDefined();
      expect([first.getStat(Stat.ATK, false), first.getStat(Stat.DEF, false)]).toEqual([def, atk]);
    });

    it("rewards the Soul Dew, a Rogue item and ordinary rewards, all different, rerolling as usual", async () => {
      await startEncounter();
      await runMysteryEncounterToEnd(game, 2, undefined, true);
      await skipBattleRunMysteryEncounterRewardsPhase(game);
      await game.phaseInterceptor.to("SelectModifierPhase", false);
      expect(game).toBeAtPhase("SelectModifierPhase");
      await game.phaseInterceptor.to("SelectModifierPhase");

      expect(scene.ui.mode).toBe(UiMode.MODIFIER_SELECT);
      const handler = scene.ui.handlers.find(h => h instanceof ModifierSelectUiHandler) as ModifierSelectUiHandler;
      const options = handler.options.map(o => o.modifierTypeOption);
      expect(options).toHaveLength(3);
      expect(options[0].type.id).toBe("SOUL_DEW");
      expect(options[1].type.tier).toBe(ModifierTier.ROGUE);
      expect(new Set(options.map(o => o.type.name)).size).toBe(3);
      expect((handler as any).rerollCost).toBeGreaterThan(0);
    });

    it("rolls the Soul Dew first, then a Rogue item, never twice the same, filling Golden Poké Ball slots", async () => {
      await startEncounter();
      expect(DARK_STRONG_STUFF_WIN_TIERS).toEqual([ModifierTier.ROGUE]);
      const names = (options: ModifierTypeOption[]) => options.map(o => o.type.name);
      for (let i = 0; i < 25; i++) {
        scene.setSeed(`dark-strong-stuff-${i}`);
        scene.resetSeed(1);
        const options = rollDarkStrongStuffRewards();
        expect(options, `seed ${i}`).toHaveLength(3);
        expect(options[0].type.id).toBe("SOUL_DEW");
        expect(options[1].type.tier, `seed ${i}`).toBe(ModifierTier.ROGUE);
        expect(options[1].upgradeCount).toBe(0);
        expect(new Set(names(options)).size, `seed ${i}: ${names(options)}`).toBe(3);
      }
      scene.addModifier(generateModifierType(modifierTypes.GOLDEN_POKEBALL)!.newModifier(), true);
      const four = rollDarkStrongStuffRewards();
      expect(four).toHaveLength(4);
      expect(new Set(names(four)).size).toBe(4);
    });
  });

  describe("option 3 - a bad smell, leave", () => {
    it("gives the official sweet juice (+10, +5 HP) to a party member with room, with no reward screen or shop", async () => {
      const [lapras, gengar, abra] = await startEncounter();
      for (const p of [lapras, gengar]) {
        giveShuckleJuice(p, SWEET_SHUCKLE_JUICE_VALUE);
        giveShuckleJuice(p, SWEET_SHUCKLE_JUICE_VALUE);
      }
      const leave = vi.spyOn(EncounterPhaseUtils, "leaveEncounterWithoutBattle");

      await runMysteryEncounterToEnd(game, 3);

      // Abra was the only one without the sweet juice (a second one would do nothing)
      expect(stackOf(abra, 10)).toBe(1);
      expect(abra.calculateBaseStats()).toEqual([30, 30, 25, 115, 65, 100]);
      expect(stackOf(lapras, 10)).toBe(1);
      expect(stackOf(gengar, 10)).toBe(1);
      expect(juicesOf(abra)[0].type.name).toBe("Sweet Shuckle Juice");
      expect(leave).toHaveBeenCalledTimes(1);
      expect(leave.mock.calls[0][0] ?? false).toBe(false);
      expect(scene.currentBattle.mysteryEncounter?.doEncounterRewards).toBeUndefined();
      expect(scene.phaseManager.hasPhaseOfType("SelectModifierPhase")).toBe(false);
      expect(logsInclude("so you hurried away")).toBe(true);
      expect(logsInclude("Abra had secretly been")).toBe(true);
      expect(logsInclude("each increased by 10!")).toBe(true);
    });

    it("gives it to exactly one random party member", async () => {
      const party = await startEncounter();

      await runMysteryEncounterToEnd(game, 3);

      const sippers = party.filter(p => stackOf(p, 10) === 1);
      expect(sippers).toHaveLength(1);
      expect(party.filter(p => juicesOf(p).length > 0)).toEqual(sippers);
    });

    it("says nothing happened when nobody has room", async () => {
      const party = await startEncounter();
      for (const p of party) {
        giveShuckleJuice(p, SWEET_SHUCKLE_JUICE_VALUE);
        giveShuckleJuice(p, SWEET_SHUCKLE_JUICE_VALUE);
      }
      const balls = [...Object.values(scene.pokeballCounts)];

      await runMysteryEncounterToEnd(game, 3);

      expect(party.map(p => stackOf(p, 10))).toEqual([1, 1, 1]);
      expect(Object.values(scene.pokeballCounts)).toEqual(balls);
      expect(logsInclude("Nothing happened.")).toBe(true);
      expect(logsInclude("had secretly been")).toBe(false);
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

    /** Opens the option screen and hovers all three options so their tooltips are built */
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
      handler.processInput(Button.DOWN);
      handler.processInput(Button.UP);
    }

    const textsOf = (f: string) => captured.filter(c => c.flow === f).map(c => c.text);

    it("shows the user's strings on the encounter screen", async () => {
      flow = "screen";
      await startEncounter();
      await hoverOptions();
      const texts = textsOf(flow).join("\n");
      for (const expected of [
        "빛나는 단단지를 만났다!\n옆에 놓인 새까만 주스는…?",
        "강력한 물질?",
        "새까만 주스 옆에서 빛나는 단단지가 이쪽을 보고 있다…?",
        "어떻게 하시겠습니까?",
        "주스를 한 마리에게 몰아 먹인다…",
        "(-) 나머지 포켓몬 전원\n(+) ???",
        "단단지와 싸운다",
        "(-) 매우 어려운 배틀\n(+) ???",
        "불길한 냄새가 난다, 떠난다",
        "(-) ???\n(+) ???",
      ]) {
        expect(texts).toContain(expected);
      }
    });

    it("shows the disabled tooltip when everyone has had the Pitch-Black juice", async () => {
      flow = "disabled";
      const party = await startEncounter();
      for (const p of party) {
        giveShuckleJuice(p, 30);
      }
      await hoverOptions();
      expect(textsOf(flow).join("\n")).toContain("(-) 모두 이미 새까만\n주스를 마셨다");
    });

    it("option 1: prompt, wrong pick, the drinking and the smell", async () => {
      flow = "drink";
      const [, , abra] = await startEncounter();
      giveShuckleJuice(abra, 30);
      const select = vi.spyOn(EncounterPhaseUtils, "selectPokemonForOption");
      await runMysteryEncounterToEnd(game, 1, { pokemonNo: 2 });
      const filter = select.mock.calls[0][2] as PokemonSelectFilter;
      expect(filter(abra)).toBe("이미 새까만 주스를 마신 포켓몬이다!");
      const texts = textsOf(flow).join("\n");
      expect(texts).toContain("[party] 주스를 먹일 포켓몬을 선택하세요.");
      expect(texts).toContain("팬텀이 새까만 주스를\n한 방울도 남김없이 들이켰다…!");
      expect(texts).toContain("팬텀의 몸속에서\n엄청난 힘이 솟구친다!$팬텀의 모든 종족치가\n30만큼 증가했다!");
      expect(texts).toContain(
        "하지만 지독한 냄새를 맡은\n다른 포켓몬들은 기운이 쭉 빠져 버렸다…$다른 포켓몬들의 종족치가\n각각 15만큼 감소했다!",
      );
      expect(i18next.t("modifierType:ModifierType.MYSTERY_ENCOUNTER_SHUCKLE_JUICE_DARK.name")).toBe(
        "새까만 단단지 주스",
      );
      expect(i18next.t("modifierType:ModifierType.MYSTERY_ENCOUNTER_SHUCKLE_JUICE_DARK.description")).toMatch(
        /^지니고 있는 포켓몬의 모든 능력치가 크게 올라갑니다\. 단단지의 /,
      );
      // the official juices keep their names
      expect(i18next.t("modifierType:ModifierType.MYSTERY_ENCOUNTER_SHUCKLE_JUICE_GOOD.name")).toBe(
        "달콤한 단단지 주스",
      );
      expect(i18next.t("modifierType:ModifierType.MYSTERY_ENCOUNTER_SHUCKLE_JUICE_BAD.name")).toBe("쓴 단단지 주스");
    });

    it("option 2: the friends, the opening, the fall and the first friend's Power Trick", async () => {
      flow = "fight";
      game.override.battleStyle("single").startingLevel(100);
      await startEncounter();
      await runMysteryEncounterToEnd(game, 2, undefined, true);
      const texts = textsOf(flow);
      // where it was shown (the last capture: getEncounterText also logs the fall text when it is queued)
      const at = (text: string) => texts.findLastIndex(t => t.includes(text));
      const order = [
        "화가 난 단단지가\n새까만 주스를 들이켜고 덤벼들었다!$단단지가 동료들을 불러 모았다!",
        "야생 단단지의 스텔스록!",
        "야생 단단지의 트릭룸!",
        "야생 단단지의 사이코필드!",
        "단단지는 모든 힘을 쏟아붓고\n장렬히 쓰러졌다…!",
        "야생 단단지는 쓰러졌다!",
        "앗! 야생 단단지가\n튀어나왔다!",
        "야생 단단지는 공격과 방어를 바꿨다!",
      ].map(at);
      expect(
        order.every(i => i > -1),
        String(order),
      ).toBe(true);
      expect(order).toEqual([...order].sort((a, b) => a - b));
      // the old boss's juice boost is gone
      expect(texts.join("\n")).not.toContain("능력치가 올라갔다");
      expect(i18next.exists(`${namespace}:option.2.statBoost`)).toBe(false);
    });

    it("option 3: a Pokémon sipped the juice", async () => {
      flow = "sip";
      const [lapras, gengar] = await startEncounter();
      for (const p of [lapras, gengar]) {
        giveShuckleJuice(p, SWEET_SHUCKLE_JUICE_VALUE);
        giveShuckleJuice(p, SWEET_SHUCKLE_JUICE_VALUE);
      }
      await runMysteryEncounterToEnd(game, 3);
      const texts = textsOf(flow).join("\n");
      expect(texts).toContain("불길한 냄새가 나서\n서둘러 자리를 떠났다…$…어라?");
      expect(texts).toContain(
        "캐이시가 어느새 주스를\n몰래 홀짝이고 있었다!$의외로 달콤한 주스였다…!\n캐이시의 모든 종족치가 10만큼 증가했다!",
      );
    });

    it("option 3: nothing happened", async () => {
      flow = "nothing";
      const party = await startEncounter();
      for (const p of party) {
        giveShuckleJuice(p, SWEET_SHUCKLE_JUICE_VALUE);
        giveShuckleJuice(p, SWEET_SHUCKLE_JUICE_VALUE);
      }
      await runMysteryEncounterToEnd(game, 3);
      expect(textsOf(flow).join("\n")).toContain("…기분 탓이었나 보다.\n아무 일도 일어나지 않았다.");
    });

    it("leaves no raw key, {{ }} or [[ ]] in anything it showed", () => {
      expect(captured.length).toBeGreaterThan(20);
      for (const { flow: f, text } of captured) {
        expect(text, `${f}: ${text}`).not.toMatch(/\{\{|\}\}|\[\[|\]\]/);
        expect(text, `${f}: ${text}`).not.toContain("darkStrongStuff");
        expect(text, `${f}: ${text}`).not.toContain("mysteryEncounters/");
      }
    });
  });
});
