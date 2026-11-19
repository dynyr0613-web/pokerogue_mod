// Local fork (2026-11-19): the user's small decisions for 1.2.0 (docs/1.2.0_후보_20261119.md):
// - A4 Soul Dew: "마음의물방울은 하락 성격만 곱연산으로 처리하도록" (raised stat 1.1 + 0.1 x stacks, lowered 0.9 x 0.9^stacks);
// - A3 edition version in saves: "a3는 경고 후 열지 못하도록" (a newer edition's save is refused, nothing saved over it);
// - C7 ① Endless Lock Capsule after wave 150 ("c7 - 1 지급"), C7 ⑤ DNA Splicers weight 12 in Endless ("c7 - 5 가중치 12");
// - C11 (3) a caught enemy's Health Candy counts 6% on the player's side ("3번은 적용");
// - C8 the Admin menu entry only for a real admin role ("admin 수정 필요").

import { getSessionDataLocalStorageKey, loggedInUser, updateUserInfo } from "#app/account";
import { getGameMode } from "#app/game-mode";
import { EDITION_VERSION, isNewerEditionVersion } from "#constants/edition-version";
import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { GameDataType } from "#enums/game-data-type";
import { GameModes } from "#enums/game-modes";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import { IvCandyModifier } from "#modifiers/custom-held-items";
import { ENDLESS_DNA_SPLICERS_WEIGHT } from "#modifiers/init-modifier-pools";
import {
  LockModifierTiersModifier,
  type PokemonHeldItemModifier,
  type PokemonNatureWeightModifier,
} from "#modifiers/modifier";
import type { ModifierType, ModifierTypeGenerator, PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { LoginPhase } from "#phases/login-phase";
import type { ModifierRewardPhase } from "#phases/modifier-reward-phase";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { TitlePhase } from "#phases/title-phase";
import { ENDLESS_LOCK_CAPSULE_WAVE } from "#phases/victory-phase";
import { GameData, getNewerImportEditionVersion } from "#system/game-data";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import { isAdminMenuShown } from "#ui/menu-ui-handler";
import { NumberHolder } from "#utils/common";
import { getModifierPoolForType } from "#utils/modifier-utils";
import { readFileSync } from "node:fs";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Local fork - small decisions of 2026-11-19", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  /** localStorage values a test overwrote, put back afterwards (tests share one worker: vitest `isolate: false`) */
  const savedStorage = new Map<string, string | null>();

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .battleType(BattleType.WILD)
      .mysteryEncounterChance(0)
      .startingLevel(100)
      .enemyLevel(20)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyHasPassiveAbility(false)
      .ability(AbilityId.BALL_FETCH)
      .hasPassiveAbility(false)
      .playerIVs(31)
      .moveset([MoveId.SPLASH]);
  });

  afterEach(() => {
    // The refusal is static (it outlives a new GameData), so it must not leak into the next test or file
    GameData.refusedEditionVersion = undefined;
    for (const [key, value] of savedStorage) {
      if (value === null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, value);
      }
    }
    savedStorage.clear();
    vi.restoreAllMocks();
  });

  function setStorage(key: string, value: string): void {
    if (!savedStorage.has(key)) {
      savedStorage.set(key, localStorage.getItem(key));
    }
    localStorage.setItem(key, value);
  }

  async function startEndless(species: SpeciesId[]): Promise<void> {
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.ENDLESS);
      game.scene.offsetGym = false;
      const starters = generateStarters(game.scene, species);
      const selectStarterPhase = new SelectStarterPhase();
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      selectStarterPhase.initBattle(starters);
    });
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    await game.phaseInterceptor.to("CommandPhase", false);
  }

  /**
   * The refusal's warning is a modal that cannot be closed, shown again a second later if something else took the
   * screen. The scene outlives the test, so the modal would stall the next test: the UI calls are recorded, not run.
   * @returns The spy on `ui.setMode`
   */
  function noLateWarning() {
    vi.spyOn(game.scene.time, "delayedCall").mockReturnValue(undefined as never);
    return vi.spyOn(game.scene.ui, "setMode").mockResolvedValue();
  }

  function plainType(id: "SOUL_DEW"): PokemonHeldItemModifierType {
    return modifierTypes[id]().withIdFromFunc(modifierTypes[id]) as PokemonHeldItemModifierType;
  }

  /** A Health Candy type (IV Candy of HP), its generator's id set as the reward pool gives it */
  function healthCandyType(): ModifierType {
    const gen = modifierTypes.IV_CANDY() as ModifierTypeGenerator;
    gen.id = "IV_CANDY";
    return gen.generateType([], [Stat.HP])!;
  }

  /** Gives the player's `pokemon` `count` of the held item made by `type` (past any cap) and recalculates its stats */
  function give(pokemon: Pokemon, type: ModifierType, count: number): PokemonHeldItemModifier {
    const mod = type.newModifier(pokemon) as PokemonHeldItemModifier;
    game.scene.addModifier(mod, true, false, false, true);
    const held = pokemon.getHeldItems().find(m => m.match(mod))!;
    held.stackCount = count;
    pokemon.calculateStats();
    return held;
  }

  /** `saveSystem`'s replacer: big attribute flags as numbers when they fit, as strings otherwise */
  function systemReplacer(_k: string, v: unknown): unknown {
    if (typeof v !== "bigint") {
      return v;
    }
    return v <= 0x80000000 ? Number(v) : v.toString();
  }

  /** The current system save as a string, with another trainer id and the given edition version (none: field left out) */
  function systemSaveStr(editionVersion: string | undefined, trainerId: number): string {
    const { editionVersion: _current, ...data } = game.scene.gameData.getSystemSaveData();
    return JSON.stringify(
      editionVersion === undefined ? { ...data, trainerId } : { ...data, trainerId, editionVersion },
      systemReplacer,
    );
  }

  describe("A4 - Soul Dew", () => {
    it("adds 0.1 per dew to the raised stat and multiplies the lowered one by 0.9 per dew (never 0)", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const feebas = game.field.getPlayerPokemon();
      const apply = (start: number, stacks: number): { value: number; applied: boolean } => {
        const dew = plainType("SOUL_DEW").newModifier(feebas) as PokemonNatureWeightModifier;
        dew.stackCount = stacks;
        const holder = new NumberHolder(start);
        const applied = dew.apply(feebas, holder);
        return { value: holder.value, applied };
      };
      // raised: unchanged additive rule
      expect(apply(1.1, 1).value).toBeCloseTo(1.2, 10);
      expect(apply(1.1, 10).value).toBeCloseTo(2.1, 10);
      // lowered: 0.9 x 0.9^stacks
      expect(apply(0.9, 1).value).toBeCloseTo(0.81, 10);
      expect(apply(0.9, 8).value).toBeCloseTo(0.9 ** 9, 10);
      expect(apply(0.9, 9).value).toBeCloseTo(0.9 ** 10, 10); // 0 before the change
      expect(apply(0.9, 10).value).toBeCloseTo(0.3138, 4); // -0.1 before the change
      expect(apply(0.9, 10).value).toBeGreaterThan(0);
      // neutral natures stay untouched
      expect(apply(1, 10)).toEqual({ value: 1, applied: false });
    });

    it("gives a player's Pokémon with 10 dews x2.1 on the raised stat and x0.31 on the lowered one, not 1", async () => {
      game.override.nature(Nature.HARDY);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const feebas = game.field.getPlayerPokemon();
      give(feebas, plainType("SOUL_DEW"), 10);
      // a neutral nature: the dews change nothing, these are the plain stats
      feebas.setNature(Nature.HARDY);
      const atk = feebas.getStat(Stat.ATK, false);
      const def = feebas.getStat(Stat.DEF, false);
      // Bold: +Defense, -Attack
      feebas.setNature(Nature.BOLD);
      expect(feebas.getStat(Stat.DEF, false)).toBe(Math.ceil(def * (1.1 + 0.1 * 10)));
      expect(feebas.getStat(Stat.ATK, false)).toBe(Math.floor(atk * (0.9 * 0.9 ** 10)));
      expect(feebas.getStat(Stat.ATK, false)).toBeGreaterThan(1);
    });

    it("works the same on an enemy's Soul Dews", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const enemy = game.field.getEnemyPokemon();
      game.scene.clearEnemyHeldItemModifiers(enemy);
      enemy.setNature(Nature.HARDY);
      const atk = enemy.getStat(Stat.ATK, false);
      await game.scene.addEnemyModifier(
        plainType("SOUL_DEW").newModifier(enemy) as PokemonHeldItemModifier,
        true,
        true,
      );
      enemy.getHeldItems()[0].stackCount = 10;
      enemy.setNature(Nature.BOLD);
      expect(enemy.getStat(Stat.ATK, false)).toBe(Math.max(Math.floor(atk * (0.9 * 0.9 ** 10)), 1));
    });

    it("says so in both languages", () => {
      const ko = JSON.parse(readFileSync("./locales/ko/modifier-type.json", "utf8")).ModifierType.SOUL_DEW.description;
      const en = JSON.parse(readFileSync("./locales/en/modifier-type.json", "utf8")).ModifierType.SOUL_DEW.description;
      expect(ko).toContain("곱연산");
      expect(ko).toContain("합연산");
      expect(en).toContain("multiplied by 0.9");
    });
  });

  describe("A3 - the edition version in saves", () => {
    it("compares edition versions number by number; a save without one is never newer", () => {
      expect(isNewerEditionVersion(undefined)).toBe(false);
      expect(isNewerEditionVersion(null)).toBe(false);
      expect(isNewerEditionVersion(EDITION_VERSION)).toBe(false);
      expect(isNewerEditionVersion("1.2.0", "1.2.0")).toBe(false);
      expect(isNewerEditionVersion("1.1.0", "1.2.0")).toBe(false);
      expect(isNewerEditionVersion("1.2", "1.2.0")).toBe(false);
      expect(isNewerEditionVersion("1.3.0", "1.2.0")).toBe(true);
      expect(isNewerEditionVersion("1.10.0", "1.9.0")).toBe(true);
      expect(isNewerEditionVersion("2.0.0", "1.99.99")).toBe(true);
      expect(isNewerEditionVersion("1.2.0.1", "1.2.0")).toBe(true);
      // something this build cannot read is refused rather than saved over...
      expect(isNewerEditionVersion("1.3.0-beta", "1.2.0")).toBe(true);
      expect(isNewerEditionVersion(5, "1.2.0")).toBe(true);
      // ...but a malformed build version never locks every save out
      expect(isNewerEditionVersion("1.3.0", "1.2.0-beta")).toBe(false);
    });

    it("writes this build's edition version into the system and session saves", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      expect(game.scene.gameData.getSystemSaveData().editionVersion).toBe(EDITION_VERSION);
      expect(game.scene.gameData.getSessionSaveData().editionVersion).toBe(EDITION_VERSION);
    });

    it("loads a save without the field (1.1.0) or from this or an older edition as before", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const { gameData } = game.scene;
      const trainerId = gameData.trainerId;
      expect(await gameData["initSystem"](systemSaveStr(undefined, trainerId + 1))).toBe(true);
      expect(gameData.trainerId).toBe(trainerId + 1);
      expect(await gameData["initSystem"](systemSaveStr("1.0.0", trainerId + 2))).toBe(true);
      expect(await gameData["initSystem"](systemSaveStr(EDITION_VERSION, trainerId + 3))).toBe(true);
      expect(gameData.trainerId).toBe(trainerId + 3);
      expect(gameData.blockedByNewerEdition).toBe(false);
    });

    it("refuses a newer edition's system save with the warning, and nothing is saved or deleted after it", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const { gameData } = game.scene;
      const systemKey = `data_${loggedInUser?.username}`;
      const sessionKey = getSessionDataLocalStorageKey(0);
      setStorage(systemKey, "newer system save");
      setStorage(sessionKey, "newer session save");
      const trainerId = gameData.trainerId;
      const setMode = noLateWarning();

      expect(await gameData["initSystem"](systemSaveStr("9.0.0", trainerId + 1))).toBe(false);
      expect(gameData.trainerId).toBe(trainerId);
      expect(gameData.blockedByNewerEdition).toBe(true);
      expect(GameData.refusedEditionVersion).toBe("9.0.0");
      const message = i18next.t("gameData:newerEditionSave", { version: "9.0.0" });
      expect(message).toContain("9.0.0");
      expect(setMode).toHaveBeenCalledWith(UiMode.ALERT_MODAL, message);

      expect(await gameData.saveSystem()).toBe(false);
      // (GameManager's ReloadHelper replaces saveAll on the instance: the real one is called here)
      expect(await GameData.prototype.saveAll.call(gameData, true)).toBe(false);
      expect(await gameData.deleteSession(0)).toBe(false);
      expect(await gameData.tryClearSession(0)).toEqual([false, false]);
      expect(await gameData.renameSession(0, "new name")).toBe(false);
      expect(localStorage.getItem(systemKey)).toBe("newer system save");
      expect(localStorage.getItem(sessionKey)).toBe("newer session save");
    });

    it("keeps the login phase on the warning instead of going on to the title screen", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const loadSystem = vi.spyOn(game.scene.gameData, "loadSystem").mockResolvedValue(false);
      // the phase's loading screen is not under test (it stalls the test harness mid-battle)
      vi.spyOn(game.scene.ui, "setMode").mockResolvedValue();

      // control: an ordinary failed load (no save yet) goes on, as before
      let phase = new LoginPhase();
      let end = vi.spyOn(phase, "end").mockResolvedValue();
      await phase.start();
      expect(end).toHaveBeenCalledOnce();

      loadSystem.mockImplementation(async () => {
        GameData.refusedEditionVersion = "9.0.0";
        return false;
      });
      phase = new LoginPhase();
      end = vi.spyOn(phase, "end").mockResolvedValue();
      await phase.start();
      expect(end).not.toHaveBeenCalled();
    });

    it("does not load a newer edition's session and does not start a new run instead", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const { gameData } = game.scene;
      const session = { ...gameData.getSessionSaveData(), editionVersion: "9.0.0" };
      vi.spyOn(gameData, "getSession").mockResolvedValue(session);
      noLateWarning();
      const initSession = vi.spyOn(
        GameData.prototype as unknown as { initSessionFromData: () => Promise<void> },
        "initSessionFromData",
      );
      expect(await gameData.renameSession(0, "new name")).toBe(false);
      expect(gameData.blockedByNewerEdition).toBe(false);

      expect(await gameData.loadSession(0)).toBe(false);
      expect(initSession).not.toHaveBeenCalled();
      expect(GameData.refusedEditionVersion).toBe("9.0.0");

      // "Continue" on the title screen stays on the warning
      GameData.refusedEditionVersion = undefined;
      const title = new TitlePhase();
      const end = vi.spyOn(title, "end").mockImplementation(() => {});
      await title["loadSaveSlot"](0);
      expect(end).not.toHaveBeenCalled();
      expect(gameData.blockedByNewerEdition).toBe(true);
    });

    it("refuses a newer edition's system or session file in Import Data", () => {
      const newer = JSON.stringify({ editionVersion: "9.0.0" });
      expect(getNewerImportEditionVersion(GameDataType.SYSTEM, newer)).toBe("9.0.0");
      expect(getNewerImportEditionVersion(GameDataType.SESSION, newer)).toBe("9.0.0");
      expect(
        getNewerImportEditionVersion(GameDataType.SYSTEM, JSON.stringify({ editionVersion: EDITION_VERSION })),
      ).toBeUndefined();
      expect(
        getNewerImportEditionVersion(GameDataType.SESSION, JSON.stringify({ seed: "1.1.0 save" })),
      ).toBeUndefined();
      expect(getNewerImportEditionVersion(GameDataType.SYSTEM, "not json")).toBeUndefined();
      expect(getNewerImportEditionVersion(GameDataType.SETTINGS, newer)).toBeUndefined();
      // and the import path uses it before anything is written
      const source = readFileSync("./src/system/game-data.ts", "utf8");
      expect(source).toContain("const newerEdition = getNewerImportEditionVersion(dataType, dataStr);");
    });

    it("has the warning in both languages", () => {
      for (const lang of ["ko", "en"]) {
        const text: string = JSON.parse(readFileSync(`./locales/${lang}/game-data.json`, "utf8")).newerEditionSave;
        expect(text, lang).toContain("{{version}}");
        // the save stores only the version number, so the text must not call the newer edition a beta
        expect(text, lang).not.toMatch(/베타|beta/i);
      }
    });
  });

  describe("C7 - Endless rewards", () => {
    /** The pushNew calls that give a Lock Capsule */
    function lockCapsuleRewards(pushNew: ReturnType<typeof vi.spyOn>): number {
      return pushNew.mock.calls.filter(
        ([name, reward]) => name === "ModifierRewardPhase" && reward === modifierTypes.LOCK_CAPSULE,
      ).length;
    }

    it("① Endless gives the Lock Capsule after clearing wave 150", async () => {
      expect(ENDLESS_LOCK_CAPSULE_WAVE).toBe(150);
      game.override.startingWave(150);
      await startEndless([SpeciesId.FEEBAS]);
      expect(game.scene.findModifier(m => m instanceof LockModifierTiersModifier)).toBeUndefined();
      const pushNew = vi.spyOn(game.scene.phaseManager, "pushNew");

      game.move.select(MoveId.SPLASH);
      await game.doKillOpponents();
      await game.phaseInterceptor.to("VictoryPhase");
      expect(lockCapsuleRewards(pushNew)).toBe(1);
      // the first reward after the battle, before the wave's other rewards and the next shop
      await game.phaseInterceptor.to("ModifierRewardPhase", false);
      const reward = game.scene.phaseManager.getCurrentPhase() as ModifierRewardPhase;
      expect(reward["modifierType"].id).toBe("LOCK_CAPSULE");
      expect(reward["modifierType"].newModifier()).toBeInstanceOf(LockModifierTiersModifier);
    });

    it.each([
      ["Endless wave 149", GameModes.ENDLESS, 149, false],
      ["Endless wave 150 with a Lock Capsule already held", GameModes.ENDLESS, 150, true],
      ["Classic wave 150", GameModes.CLASSIC, 150, false],
    ])("① gives none on %s", async (_name, mode, wave, held) => {
      game.override.startingWave(wave);
      if (mode === GameModes.ENDLESS) {
        await startEndless([SpeciesId.FEEBAS]);
      } else {
        await game.classicMode.startBattle(SpeciesId.FEEBAS);
      }
      if (held) {
        await game.scene.addModifier(modifierTypes.LOCK_CAPSULE().newModifier());
        expect(game.scene.findModifier(m => m instanceof LockModifierTiersModifier)).toBeDefined();
      }
      const pushNew = vi.spyOn(game.scene.phaseManager, "pushNew");

      game.move.select(MoveId.SPLASH);
      await game.doKillOpponents();
      await game.phaseInterceptor.to("VictoryPhase");
      expect(lockCapsuleRewards(pushNew)).toBe(0);
    });

    it("⑤ weighs the DNA Splicers 12 in Endless and 24 elsewhere", async () => {
      await startEndless([SpeciesId.FEEBAS, SpeciesId.MAGIKARP]);
      const entry = getModifierPoolForType(ModifierPoolType.PLAYER)[ModifierTier.MASTER].find(
        w => w.modifierType.id === "DNA_SPLICERS",
      )!;
      const weight = () => (entry.weight as WeightedModifierTypeWeightFunc)(game.scene.getPlayerParty(), 0);
      expect(ENDLESS_DNA_SPLICERS_WEIGHT).toBe(12);
      expect(weight()).toBe(12);
      game.scene.gameMode = getGameMode(GameModes.CLASSIC);
      expect(weight()).toBe(24);
      expect(entry.maxWeight).toBe(24);
      // one unfused Pokémon: none, as before
      game.scene.gameMode = getGameMode(GameModes.ENDLESS);
      expect((entry.weight as WeightedModifierTypeWeightFunc)(game.scene.getPlayerParty().slice(0, 1), 0)).toBe(0);
    });
  });

  describe("C11 (3) - a caught enemy's Health Candy", () => {
    it("counts 3% while it is the enemy's and 6% once it is the player's", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const enemy = game.field.getEnemyPokemon();
      game.scene.clearEnemyHeldItemModifiers(enemy);
      enemy.ivs = [31, 31, 31, 31, 31, 31];
      const raw = enemy.getSpeciesForm(true).baseStats[Stat.HP]; // Magikarp: 20
      await game.scene.addEnemyModifier(healthCandyType().newModifier(enemy) as PokemonHeldItemModifier, true, true);
      enemy.getHeldItems()[0].stackCount = 10;
      expect(enemy.calculateBaseStats()[Stat.HP]).toBe(Math.floor((raw * 130) / 100));

      game.scene.pokeballCounts[PokeballType.MASTER_BALL] = 1;
      game.doThrowPokeball(PokeballType.MASTER_BALL);
      await game.toEndOfTurn();

      const party = game.scene.getPlayerParty();
      expect(party).toHaveLength(2);
      const caught = party[1];
      expect(caught.species.speciesId).toBe(SpeciesId.MAGIKARP);
      const candy = caught.getHeldItems().find(m => m instanceof IvCandyModifier);
      expect(candy?.getStackCount()).toBe(10);
      expect(caught.calculateBaseStats()[Stat.HP]).toBe(Math.floor((raw * 160) / 100));
    });
  });

  describe("C8 - the Admin menu entry", () => {
    it("shows only for a real admin role, not because login is bypassed", async () => {
      await updateUserInfo(); // login bypassed (as in the app): the guest account
      expect(loggedInUser?.hasAdminRole).toBe(false);
      expect(isAdminMenuShown()).toBe(false);
      loggedInUser!.hasAdminRole = true;
      try {
        expect(isAdminMenuShown()).toBe(true);
      } finally {
        loggedInUser!.hasAdminRole = false;
      }
      const source = readFileSync("./src/ui/handlers/menu-ui-handler.ts", "utf8");
      expect(source).not.toContain("bypassLogin || loggedInUser?.hasAdminRole");
      expect(source).toContain("if (isAdminMenuShown()) {");
    });
  });
});
