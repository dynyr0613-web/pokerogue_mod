// Local fork (2026-11-18): the "우두머리!" mystery encounter (ALPHA_ENCOUNTER, alpha-encounter.ts). The user: "우두머리!
// 라는 이름의 우두머리 조우 미스터리 조우를 넣어두고 … 1. 우두머리와 싸운다 2. 도망친다 로 하고 미스터리 조우 설명은 나중에
// 넣는걸로".
import type { BattleScene } from "#app/battle-scene";
import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { ALPHA_MAX_BOOST, ALPHA_SPRITE_SCALE, forceWildAlpha, normalizeAlphaBoost } from "#data/alpha-pokemon";
import type { PokemonSpecies } from "#data/pokemon-species";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { BiomePoolTier } from "#enums/biome-pool-tier";
import { Button } from "#enums/buttons";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PokeballType } from "#enums/pokeball";
import { PokemonMark } from "#enums/pokemon-mark";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { UiMode } from "#enums/ui-mode";
import { EnemyPokemon } from "#field/pokemon";
import type { CustomModifierSettings } from "#modifiers/modifier-type";
import { ALPHA_LEGEND_REROLLS, AlphaEncounter } from "#mystery-encounters/alpha-encounter";
import * as EncounterPhaseUtils from "#mystery-encounters/encounter-phase-utils";
import { allMysteryEncounters, mysteryEncountersByBiome } from "#mystery-encounters/mystery-encounter-biomes";
import { WaveRangeRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import type { SelectModifierPhase } from "#phases/select-modifier-phase";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import type { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import { runMysteryEncounterToEnd, skipBattleRunMysteryEncounterRewardsPhase } from "#test/utils/encounter-test-utils";
import { generateStarters } from "#test/utils/game-manager-utils";
import type { BattleMessageUiHandler } from "#ui/battle-message-ui-handler";
import { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import { getEnumValues } from "#utils/enums";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const namespace = "mysteryEncounters/alphaEncounter";
const defaultParty = [SpeciesId.LAPRAS, SpeciesId.GENGAR, SpeciesId.ABRA];
const defaultBiome = BiomeId.CAVE;
const defaultWave = 45;
const enFiles = import.meta.glob("../../../locales/en/mystery-encounters/alpha-encounter-dialogue.json", {
  eager: true,
  import: "default",
});
const koFiles = import.meta.glob("../../../locales/ko/mystery-encounters/alpha-encounter-dialogue.json", {
  eager: true,
  import: "default",
});
const enJson = Object.values(enFiles)[0] as Record<string, unknown> | undefined;
const koJson = Object.values(koFiles)[0] as Record<string, unknown> | undefined;

/** Whether a species is legendary, sub-legendary or mythical (arena.ts's "legend-like") */
function isLegendLike(species: PokemonSpecies): boolean {
  return species.legendary || species.subLegendary || species.mythical;
}

/** Every text of a locale file, by its dotted key */
function flatten(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value != null && typeof value === "object") {
      Object.assign(out, flatten(value as Record<string, unknown>, path));
    } else {
      out[path] = String(value);
    }
  }
  return out;
}

describe("Custom mystery encounter - 우두머리! (ALPHA_ENCOUNTER)", { timeout: 60_000 }, () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let scene: BattleScene;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    // Korean text straight into i18next (the test fetch mock serves English only)
    expect(koJson).toBeDefined();
    i18next.addResourceBundle("ko", namespace, koJson, true, true);
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
      .enemyPassiveAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The data of the alpha the encounter set up */
  const alphaConfig = () => scene.currentBattle.mysteryEncounter!.enemyPartyConfigs[0].pokemonConfigs![0];
  const alphaData = () => alphaConfig().dataSource as PokemonData;

  /** Runs to the reward screen's phase; returns its custom settings, then the screen's handler once it is up */
  async function toRewardScreen(): Promise<{
    settings: CustomModifierSettings | undefined;
    handler: ModifierSelectUiHandler;
  }> {
    await game.phaseInterceptor.to("SelectModifierPhase", false);
    expect(game).toBeAtPhase("SelectModifierPhase");
    const phase = scene.phaseManager.getCurrentPhase() as SelectModifierPhase;
    const settings = (phase as unknown as { customModifierSettings?: CustomModifierSettings }).customModifierSettings;
    await game.phaseInterceptor.to("SelectModifierPhase");
    expect(scene.ui.mode).toBe(UiMode.MODIFIER_SELECT);
    const handler = scene.ui.handlers.find(h => h instanceof ModifierSelectUiHandler) as ModifierSelectUiHandler;
    return { settings, handler };
  }

  describe("registration", () => {
    it("is appended last to the enum, GREAT tier, with the usual waves and no other requirement", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.ALPHA_ENCOUNTER, defaultParty);

      expect(MysteryEncounterType.ALPHA_ENCOUNTER).toBe(MysteryEncounterType.DARK_STRONG_STUFF + 1);
      expect(Math.max(...getEnumValues(MysteryEncounterType))).toBe(MysteryEncounterType.ALPHA_ENCOUNTER);
      expect(allMysteryEncounters[MysteryEncounterType.ALPHA_ENCOUNTER]).toBe(AlphaEncounter);
      expect(AlphaEncounter.encounterType).toBe(MysteryEncounterType.ALPHA_ENCOUNTER);
      expect(AlphaEncounter.encounterTier).toBe(MysteryEncounterTier.GREAT);
      expect(AlphaEncounter.requirements).toHaveLength(1);
      expect(AlphaEncounter.requirements[0]).toBeInstanceOf(WaveRangeRequirement);
      expect((AlphaEncounter.requirements[0] as WaveRangeRequirement).waveRange).toEqual(
        CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES,
      );
      expect(AlphaEncounter.catchAllowed).toBe(true);
      expect(AlphaEncounter.fleeAllowed).toBe(false);
      expect(scene.currentBattle.mysteryEncounter?.encounterType).toBe(MysteryEncounterType.ALPHA_ENCOUNTER);
    });

    it("has exactly two options, fight and run away, with their texts", () => {
      expect(AlphaEncounter.dialogue.intro).toStrictEqual([{ text: `${namespace}:intro` }]);
      expect(AlphaEncounter.dialogue.encounterOptionsDialogue?.title).toBe(`${namespace}:title`);
      expect(AlphaEncounter.dialogue.encounterOptionsDialogue?.description).toBe(`${namespace}:description`);
      expect(AlphaEncounter.dialogue.encounterOptionsDialogue?.query).toBe(`${namespace}:query`);
      expect(AlphaEncounter.options).toHaveLength(2);
      AlphaEncounter.options.forEach((option, i) => {
        expect(option.optionMode, `option ${i + 1}`).toBe(MysteryEncounterOptionMode.DEFAULT);
        expect(option.requirements, `option ${i + 1}`).toHaveLength(0);
        expect(option.dialogue).toStrictEqual({
          buttonLabel: `${namespace}:option.${i + 1}.label`,
          buttonTooltip: `${namespace}:option.${i + 1}.tooltip`,
          selected: [{ text: `${namespace}:option.${i + 1}.selected` }],
        });
      });
    });

    it("can appear in every biome, beside the biome's other encounters", () => {
      const biomes = Object.values(BiomeId);
      expect(biomes.length).toBeGreaterThan(30);
      for (const biome of biomes) {
        expect(mysteryEncountersByBiome.get(biome), `biome ${biome}`).toContain(MysteryEncounterType.ALPHA_ENCOUNTER);
      }
      expect(mysteryEncountersByBiome.get(BiomeId.CAVE)).toContain(MysteryEncounterType.FIGHT_OR_FLIGHT);
      expect(mysteryEncountersByBiome.get(BiomeId.TOWN)).toContain(MysteryEncounterType.VENDING_MACHINE);
    });
  });

  describe("texts", () => {
    it("have the same keys in English and Korean, with the labels the user chose", () => {
      expect(enJson).toBeDefined();
      const en = flatten(enJson!);
      const ko = flatten(koJson!);
      const keys = [
        "intro",
        "title",
        "description",
        "query",
        "option.1.label",
        "option.1.tooltip",
        "option.1.selected",
        "option.2.label",
        "option.2.tooltip",
        "option.2.selected",
      ];
      expect(new Set(Object.keys(en))).toEqual(new Set(keys));
      expect(new Set(Object.keys(ko))).toEqual(new Set(keys));
      for (const key of keys) {
        expect(en[key], `en ${key}`).not.toBe("");
        expect(ko[key], `ko ${key}`).not.toBe("");
      }

      expect(i18next.t(`${namespace}:title`)).toBe("Alpha!");
      expect(i18next.t(`${namespace}:option.1.label`)).toBe("Fight the alpha");
      expect(i18next.t(`${namespace}:option.2.label`)).toBe("Run away");
      expect(i18next.t(`${namespace}:title`, { lng: "ko" })).toBe("우두머리!");
      expect(i18next.t(`${namespace}:option.1.label`, { lng: "ko" })).toBe("우두머리와 싸운다");
      expect(i18next.t(`${namespace}:option.2.label`, { lng: "ko" })).toBe("도망친다");
    });

    it("are clearly temporary where the user will write them", () => {
      expect(i18next.t(`${namespace}:description`)).toBe("(Description to be added)");
      expect(i18next.t(`${namespace}:description`, { lng: "ko" })).toBe("(설명은 나중에 추가 예정)");
      expect(i18next.t(`${namespace}:query`)).toBe("What will you do?");
      expect(i18next.t(`${namespace}:query`, { lng: "ko" })).toBe("어떻게 할까?");
      expect(i18next.t(`${namespace}:option.1.tooltip`, { lng: "ko" })).toBe("(+) 우두머리 포켓몬과 싸운다");
      expect(i18next.t(`${namespace}:option.2.tooltip`, { lng: "ko" })).toBe("(-) 싸우지 않고 지나간다");
    });

    it("put the Korean particles after the Pokémon's name the game's way", () => {
      const ko = (key: string, enemyPokemon: string) => i18next.t(`${namespace}:${key}`, { lng: "ko", enemyPokemon });
      expect(ko("intro", "피카츄")).toBe("우두머리 피카츄가 나타났다!");
      expect(ko("intro", "리자몽")).toBe("우두머리 리자몽이 나타났다!");
      expect(ko("option.1.selected", "피카츄")).toBe("우두머리 피카츄와 맞서 싸운다!");
      expect(ko("option.1.selected", "리자몽")).toBe("우두머리 리자몽과 맞서 싸운다!");
      expect(ko("option.2.selected", "피카츄")).toBe("피카츄를 피해 조용히 지나갔다.");
      expect(ko("option.2.selected", "리자몽")).toBe("리자몽을 피해 조용히 지나갔다.");
    });
  });

  describe("set-up", () => {
    it("always rolls an alpha of the biome's wild pool at the wave's wild level, never a boss", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.ALPHA_ENCOUNTER, defaultParty);
      const encounter = scene.currentBattle.mysteryEncounter!;
      const randomSpecies = vi.spyOn(scene.arena, "randomSpecies");
      const boosts = new Set<number>();

      for (let i = 0; i < 60; i++) {
        randomSpecies.mockClear();
        encounter.onInit!();
        // Let the new Pokémon's sprite load before the next one sends it off the field
        await Promise.all(encounter.loadAssets);
        const config = alphaConfig();
        const data = alphaData();
        const label = `try ${i}`;

        // the draw of an ordinary wild wave (encounter-phase.ts): the arena's pool for the wave and level. The last
        // draw the encounter made (attempt 0; arena.ts's own redraws count up from 1) is the alpha, and an earlier one
        // is only redrawn for being legend-like
        expect(randomSpecies, label).toHaveBeenCalled();
        expect(randomSpecies.mock.calls[0].slice(0, 3), label).toEqual([defaultWave, config.level, 0]);
        const draws = randomSpecies.mock.calls.flatMap((call, k) => (call[2] === 0 ? [k] : []));
        expect(randomSpecies.mock.results[draws.at(-1)!].value, label).toBe(config.species);
        for (const k of draws.slice(0, -1)) {
          expect(isLegendLike(randomSpecies.mock.results[k].value), label).toBe(true);
        }
        expect(isLegendLike(config.species), label).toBe(false);
        expect(data.species, label).toBe(config.species.speciesId);
        expect(data.level, label).toBe(config.level);

        expect(config.isBoss, label).toBe(false);
        const boost = normalizeAlphaBoost(data.alphaBoost);
        expect(boost, label).toBeGreaterThanOrEqual(1);
        expect(boost, label).toBeLessThanOrEqual(ALPHA_MAX_BOOST);
        boosts.add(boost);
        const marks = data.marks ?? [];
        expect(marks, label).toContain(PokemonMark.ALPHA_MARK);
        expect(marks, label).toContain(PokemonMark.JUMBO_MARK);
        expect(marks, label).not.toContain(PokemonMark.MINI_MARK);
        expect(marks.includes(PokemonMark.GOLDEN_ALPHA_MARK), label).toBe(boost === ALPHA_MAX_BOOST);

        // the intro shows it 10% larger
        expect(encounter.spriteConfigs, label).toHaveLength(1);
        expect(encounter.spriteConfigs[0].isPokemon, label).toBe(true);
        expect(encounter.spriteConfigs[0].scale, label).toBe(ALPHA_SPRITE_SCALE);
        expect(encounter.dialogueTokens.enemyPokemon, label).toBe(encounter.misc.alpha.getNameToRender());
        expect(encounter.misc.alpha.species, label).toBe(config.species);
      }
      // the usual roll: any boost from 1 to 20
      expect(boosts.size).toBeGreaterThan(8);
    });

    it("forceWildAlpha keeps an alpha's boost and drops a Mini Mark", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.ALPHA_ENCOUNTER, defaultParty);
      const mini = new EnemyPokemon(alphaConfig().species, 20, TrainerSlot.NONE, false);
      mini.setAlphaBoost(0);
      mini.marks = [PokemonMark.MINI_MARK];
      forceWildAlpha(mini);
      expect(mini.isAlpha()).toBe(true);
      expect(mini.hasMark(PokemonMark.MINI_MARK)).toBe(false);
      expect(mini.hasMark(PokemonMark.ALPHA_MARK)).toBe(true);
      expect(mini.getSpriteScale()).toBeCloseTo(ALPHA_SPRITE_SCALE);

      const alpha = new EnemyPokemon(alphaConfig().species, 20, TrainerSlot.NONE, false);
      alpha.setAlphaBoost(7);
      forceWildAlpha(alpha);
      expect(alpha.alphaBoost).toBe(7);
      mini.destroy();
      alpha.destroy();
    });
  });

  // Local fork (2026-11-18): the game never meets a legendary, sub-legendary or mythical Pokémon as a catchable one-bar
  // wild one (an ordinary wild wave makes it a boss, and a boss is never an alpha), so the alpha is never one
  describe("never legendary, sub-legendary or mythical", () => {
    /** Runs the encounter's set-up again, with its sprite loaded */
    async function reInit(): Promise<void> {
      const encounter = scene.currentBattle.mysteryEncounter!;
      encounter.onInit!();
      await Promise.all(encounter.loadAssets);
    }

    /** The alpha is the wild one the encounter promises: no legend-like, no boss, an alpha */
    function expectOrdinaryAlpha(label: string): void {
      const config = alphaConfig();
      expect(isLegendLike(config.species), `${label}: ${config.species.name}`).toBe(false);
      expect(config.isBoss, label).toBe(false);
      expect(normalizeAlphaBoost(alphaData().alphaBoost), label).toBeGreaterThanOrEqual(1);
      expect(alphaData().marks ?? [], label).toContain(PokemonMark.ALPHA_MARK);
    }

    it("draws again on a legend-like draw and keeps the first draw that is not one", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.ALPHA_ENCOUNTER, defaultParty);
      const legends = [SpeciesId.UXIE, SpeciesId.BATTLE_BOND_GRENINJA, SpeciesId.BLOODMOON_URSALUNA, SpeciesId.MEW].map(
        id => speciesDataRegistry.getSpecies(id),
      );
      expect(legends.every(isLegendLike)).toBe(true);
      const randomSpecies = vi.spyOn(scene, "randomSpecies");
      for (const legend of legends) {
        randomSpecies.mockReturnValueOnce(legend);
      }

      await reInit();

      const config = alphaConfig();
      expect(randomSpecies).toHaveBeenCalledTimes(legends.length + 1);
      for (const call of randomSpecies.mock.calls) {
        expect(call).toEqual([defaultWave, config.level, true]);
      }
      expect(config.species).toBe(randomSpecies.mock.results[legends.length].value);
      expectOrdinaryAlpha("after 4 legend-likes");
    });

    it("draws again on an Ultra Rare legend (Uxie in the Cave) at a wave where the arena keeps it", async () => {
      // From wave 80 arena.ts no longer redraws a legend-like (checkLegendBST), so the Ultra Rare draw stands
      const wave = 105;
      game.override.startingWave(wave);
      await game.runToMysteryEncounter(MysteryEncounterType.ALPHA_ENCOUNTER, defaultParty);
      const arena = scene.arena as unknown as { generateNonBossBiomeTier: (tierValue: number) => BiomePoolTier };
      vi.spyOn(arena, "generateNonBossBiomeTier").mockReturnValueOnce(BiomePoolTier.ULTRA_RARE);
      const randomSpecies = vi.spyOn(scene.arena, "randomSpecies");

      await reInit();

      expect(randomSpecies.mock.calls[0].slice(0, 3)).toEqual([wave, alphaConfig().level, 0]);
      expect(randomSpecies.mock.results[0].value.speciesId).toBe(SpeciesId.UXIE);
      expect(randomSpecies.mock.calls.length).toBeGreaterThan(1);
      expect(alphaConfig().species.speciesId).not.toBe(SpeciesId.UXIE);
      expectOrdinaryAlpha("after an Ultra Rare Uxie");
    });

    it("falls back to a species of the biome that is not one when every draw is one", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.ALPHA_ENCOUNTER, defaultParty);
      const randomSpecies = vi
        .spyOn(scene, "randomSpecies")
        .mockReturnValue(speciesDataRegistry.getSpecies(SpeciesId.TERAPAGOS));

      await reInit();

      expect(randomSpecies).toHaveBeenCalledTimes(1 + ALPHA_LEGEND_REROLLS);
      expectOrdinaryAlpha("fallback");
      const caveLines = new Set(
        Object.values(scene.arena.getForkPokemonPools())
          .flat()
          .map(id => speciesDataRegistry.getSpecies(id).getRootSpeciesId()),
      );
      expect(caveLines.has(alphaConfig().species.getRootSpeciesId())).toBe(true);
    });

    it("never gives one on an Endless wave past 250 that rolls a random boss (the boss pools)", async () => {
      game.override.startingWave(1002);
      game.override.mysteryEncounter(MysteryEncounterType.ALPHA_ENCOUNTER);
      await game.runToTitle();
      game.onNextPrompt(
        "TitlePhase",
        UiMode.TITLE,
        () => {
          scene.gameMode = getGameMode(GameModes.ENDLESS);
          const starters = generateStarters(scene, defaultParty);
          const selectStarterPhase = new SelectStarterPhase();
          scene.phaseManager.pushNew("EncounterPhase", false);
          selectStarterPhase.initBattle(starters);
        },
        () => game.isCurrentPhase("EncounterPhase"),
      );
      game.onNextPrompt(
        "EncounterPhase",
        UiMode.MESSAGE,
        () => (scene.ui.getHandler() as BattleMessageUiHandler).processInput(Button.ACTION),
        () => game.isCurrentPhase("MysteryEncounterPhase"),
        true,
      );
      await game.phaseInterceptor.to("EncounterPhase");
      expect(scene.gameMode.modeId).toBe(GameModes.ENDLESS);
      expect(scene.currentBattle.mysteryEncounter?.encounterType).toBe(MysteryEncounterType.ALPHA_ENCOUNTER);

      // The first wave from 1002 that can have an encounter and rolls a random boss (up to 30% of waves there)
      let wave = 1002;
      while (
        !scene.isMysteryEncounterValidForWave(BattleType.WILD, wave)
        || scene.getEncounterBossSegments(wave, 100) === 0
      ) {
        wave++;
        expect(wave).toBeLessThan(1500);
      }
      scene.currentBattle.waveIndex = wave;
      const randomSpecies = vi.spyOn(scene.arena, "randomSpecies");

      let legendDraws = 0;
      for (let i = 0; i < 100; i++) {
        randomSpecies.mockClear();
        await reInit();
        legendDraws += randomSpecies.mock.calls.filter(
          (call, k) => call[2] === 0 && isLegendLike(randomSpecies.mock.results[k].value),
        ).length;
        expectOrdinaryAlpha(`wave ${wave}, try ${i}`);
      }
      // the boss pools did give legend-likes (Uxie, Terapagos), and each was drawn again
      expect(legendDraws).toBeGreaterThan(0);
    });
  });

  describe("option 1 - fight the alpha", () => {
    it("starts a wild battle against exactly that one alpha, not a boss", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.ALPHA_ENCOUNTER, defaultParty);
      const config = alphaConfig();
      const boost = normalizeAlphaBoost(alphaData().alphaBoost);

      await runMysteryEncounterToEnd(game, 1, undefined, true);

      expect(game).toBeAtPhase("CommandPhase");
      expect(scene.currentBattle.mysteryEncounter?.encounterMode).toBe(MysteryEncounterMode.WILD_BATTLE);
      expect(scene.getEnemyParty()).toHaveLength(1);
      const enemy = scene.getEnemyField()[0];
      expect(enemy.species).toBe(config.species);
      expect(enemy.level).toBe(config.level);
      expect(enemy.isBoss()).toBe(false);
      expect(enemy.isAlpha()).toBe(true);
      expect(enemy.alphaBoost).toBe(boost);
      expect(enemy.alphaBoost).toBeGreaterThanOrEqual(1);
      expect(enemy.alphaBoost).toBeLessThanOrEqual(ALPHA_MAX_BOOST);
      expect(enemy.hasMark(PokemonMark.ALPHA_MARK)).toBe(true);
      expect(enemy.hasMark(PokemonMark.JUMBO_MARK)).toBe(true);
      expect(enemy.getSpriteScale()).toBeCloseTo(ALPHA_SPRITE_SCALE);
    });

    it("gives the ordinary wild reward screen after a win, with no guaranteed item", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.ALPHA_ENCOUNTER, defaultParty);
      scene.modifiers = [];
      await scene.updateModifiers(true);
      await runMysteryEncounterToEnd(game, 1, undefined, true);
      await skipBattleRunMysteryEncounterRewardsPhase(game);

      const { settings, handler } = await toRewardScreen();
      // the plain SelectModifierPhase an ordinary wild wave queues: three items, Lock Capsule and rerolls as usual
      expect(settings).toBeUndefined();
      expect(handler.options).toHaveLength(3);
    });

    it("can be caught: the alpha joins the party, its line records the boost, and the reward screen follows", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.ALPHA_ENCOUNTER, defaultParty);
      scene.modifiers = [];
      await scene.updateModifiers(true);
      const boost = normalizeAlphaBoost(alphaData().alphaBoost);
      const starterId = alphaConfig().species.getRootSpeciesId();
      scene.gameData.starterData[starterId].alphaBoost = undefined;

      await runMysteryEncounterToEnd(game, 1, undefined, true);
      // runMysteryEncounterToEnd can leave its option prompt queued, which would hold back the ball's prompts (as in
      // custom-dark-strong-stuff.test.ts)
      (game.promptHandler as unknown as { prompts: unknown[] }).prompts.length = 0;
      scene.pokeballCounts[PokeballType.MASTER_BALL] = 1;
      game.doThrowPokeball(PokeballType.MASTER_BALL);
      const { settings, handler } = await toRewardScreen();

      const party = scene.getPlayerParty();
      expect(party).toHaveLength(defaultParty.length + 1);
      const caught = party.at(-1)!;
      expect(caught.isAlpha()).toBe(true);
      expect(caught.alphaBoost).toBe(boost);
      expect(caught.hasMark(PokemonMark.ALPHA_MARK)).toBe(true);
      expect(scene.gameData.starterData[starterId].alphaBoost).toBe(boost);
      expect(settings).toBeUndefined();
      expect(handler.options).toHaveLength(3);
    });
  });

  describe("option 2 - run away", () => {
    it("leaves without a battle, the way the other encounters' leave options do", async () => {
      const leaveSpy = vi.spyOn(EncounterPhaseUtils, "leaveEncounterWithoutBattle");
      const battleSpy = vi.spyOn(EncounterPhaseUtils, "initBattleWithEnemyConfig");
      await game.runToMysteryEncounter(MysteryEncounterType.ALPHA_ENCOUNTER, defaultParty);

      await runMysteryEncounterToEnd(game, 2);

      expect(leaveSpy).toHaveBeenCalledWith(true);
      expect(battleSpy).not.toHaveBeenCalled();
      expect(scene.currentBattle.mysteryEncounter?.encounterMode).toBe(MysteryEncounterMode.NO_BATTLE);
      expect(scene.getEnemyParty()).toHaveLength(0);
      // the empty shop screen after leaving, as Fight or Flight's "Leave"
      const { handler } = await toRewardScreen();
      expect(handler.options).toHaveLength(0);
    });
  });
});
