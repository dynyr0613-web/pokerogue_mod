import { getGameMode } from "#app/game-mode";
import {
  BASE_TIER_COUNTS,
  ENDLESS_TIER_ANCHORS,
  ENDLESS_TIER_TAIL_WAVES,
  getEndlessTierCounts,
} from "#balance/endless-balance";
import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { GameModes } from "#enums/game-modes";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import {
  getPlayerModifierTypeOptions,
  isSameRewardGroup,
  type ModifierType,
  ModifierTypeGenerator,
  type ModifierTypeOption,
  regenerateModifierPoolThresholds,
  type WeightedModifierType,
} from "#modifiers/modifier-type";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import { getModifierPoolForType } from "#utils/modifier-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local fork (2026-11-13), 08 명세 3번 (08_5850.md, from 07_5850_에이스_실험.md 2-2절):
 * 1. The reward screen's duplicate check compares groups only when both are non-empty. Every group-less item (held
 *    items, vitamins, IV candies, charms, fork items) used to count as one group, so a screen showed at most one.
 * 2. The Endless reward tier curve reaches each anchor later: 0 / 300 / 1000 / 2200 (was 0 / 200 / 500 / 1000), the
 *    tail after the last anchor 1800 waves (was 1000).
 */
describe("Custom - reward screen group check and Endless tier pacing (08 명세 3번)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH])
      .startingLevel(100)
      .forkContentUnlocked(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  describe("isSameRewardGroup", () => {
    const typed = (group: string | undefined) => ({ group }) as unknown as ModifierType;

    it("only matches two equal non-empty groups", () => {
      expect(isSameRewardGroup(typed("tm"), typed("tm"))).toBe(true);
      expect(isSameRewardGroup(typed("tm"), typed("pb"))).toBe(false);
      expect(isSameRewardGroup(typed(undefined), typed(undefined))).toBe(false);
      expect(isSameRewardGroup(typed(""), typed(""))).toBe(false);
      expect(isSameRewardGroup(typed(undefined), typed("tm"))).toBe(false);
      expect(isSameRewardGroup(typed("tm"), undefined)).toBe(false);
      expect(isSameRewardGroup(null, null)).toBe(false);
    });

    it("leaves the growth items without a group and keeps the base game's groups", () => {
      const group = (key: keyof typeof modifierTypes) => modifierTypes[key]().group;
      for (const key of ["LEFTOVERS", "SHELL_BELL", "MULTI_LENS", "CANDY_PILE", "CANDY_JAR", "RARE_CANDY"] as const) {
        expect(group(key), key).toBeFalsy();
      }
      expect(group("POKEBALL")).toBe("pb");
      expect(group("POTION")).toBe("potion");
      expect(group("SUPER_POTION")).toBe("potion");
      expect(group("LURE")).toBe("lure");
    });
  });

  describe("reward screen duplicate check", () => {
    /** Original tier arrays of the PLAYER pool replaced by `onlyInTier`, put back after each test */
    const savedTiers = new Map<ModifierTier, WeightedModifierType[]>();

    afterEach(() => {
      const pool = getModifierPoolForType(ModifierPoolType.PLAYER);
      for (const [tier, entries] of savedTiers) {
        pool[tier] = entries;
      }
      savedTiers.clear();
    });

    /** Leaves only `ids` (weight 1 each, in this order) in `tier` of the PLAYER pool and rebuilds the thresholds */
    function onlyInTier(tier: ModifierTier, ids: string[]): void {
      const pool = getModifierPoolForType(ModifierPoolType.PLAYER);
      savedTiers.set(tier, pool[tier]);
      pool[tier] = ids.map(id => {
        const entry = savedTiers.get(tier)!.find(w => w.modifierType.id === id);
        expect(entry, `${id} in tier ${ModifierTier[tier]}`).toBeDefined();
        return Object.assign(Object.create(Object.getPrototypeOf(entry)), entry, { weight: 1, maxWeight: 1 });
      });
      regenerateModifierPoolThresholds(game.scene.getPlayerParty(), ModifierPoolType.PLAYER, 0);
    }

    /**
     * Pins the in-tier picks: the n-th seeded roll gets `picks[n]` (weights are 1 each, so the value is the entry's
     * index), then 0. With guaranteed tiers and no luck upgrades, these are the only rolls. Returns the rolls made.
     */
    function pinPicks(picks: number[], entries: number): number[] {
      const made: number[] = [];
      vi.spyOn(Phaser.Math.RND, "integerInRange").mockImplementation((min: number, max: number) => {
        expect([min, max], "an in-tier pick").toEqual([0, entries - 1]);
        const value = picks[made.length] ?? 0;
        made.push(value);
        return value;
      });
      return made;
    }

    function twoSlots(tier: ModifierTier): ModifierTypeOption[] {
      return getPlayerModifierTypeOptions(2, game.scene.getPlayerParty(), undefined, {
        guaranteedModifierTiers: [tier, tier],
        allowLuckUpgrades: false,
      });
    }

    it("shows a second group-less item next to another one", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      await startEndless([SpeciesId.GARCHOMP]);
      onlyInTier(ModifierTier.ROGUE, ["LEFTOVERS", "SHELL_BELL"]);

      // slot 1: Leftovers; slot 2: Leftovers again (same item: re-rolled), then Shell Bell (taken). Before the fix the
      // Shell Bell counted as the same (empty) group too and the slot re-rolled until it gave up on a second Leftovers.
      const rolls = pinPicks([0, 0, 1], 2);
      const options = twoSlots(ModifierTier.ROGUE);
      expect(options.map(o => o.type.id)).toEqual(["LEFTOVERS", "SHELL_BELL"]);
      expect(rolls).toEqual([0, 0, 1]);
    });

    it("still re-rolls a second item of a non-empty group", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      await startEndless([SpeciesId.GARCHOMP]);
      onlyInTier(ModifierTier.COMMON, ["POTION", "SUPER_POTION", "LURE"]);

      // slot 1: Potion; slot 2: Super Potion (group "potion" again: re-rolled), then Lure (taken)
      const rolls = pinPicks([0, 1, 2], 3);
      const options = twoSlots(ModifierTier.COMMON);
      expect(options.map(o => o.type.id)).toEqual(["POTION", "LURE"]);
      expect(rolls).toEqual([0, 1, 2]);
    });

    it("lets a grouped item and a group-less item share a screen, as before", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      await startEndless([SpeciesId.GARCHOMP]);
      onlyInTier(ModifierTier.ROGUE, ["ROGUE_BALL", "LEFTOVERS"]);

      const rolls = pinPicks([0, 1], 2);
      expect(twoSlots(ModifierTier.ROGUE).map(o => o.type.id)).toEqual(["ROGUE_BALL", "LEFTOVERS"]);
      expect(rolls).toEqual([0, 1]);
    });

    /** The one group every group-less type gets while {@linkcode emulateOldGroupRule} is on */
    const SHARED = "__no_group__";
    const groupLess = (o: ModifierTypeOption) => !o.type.group || o.type.group === SHARED;

    /**
     * Puts every group-less reward type in one shared group, which is what `undefined === undefined` did before the
     * fix. Returns the function that undoes it.
     */
    function emulateOldGroupRule(): () => void {
      const generate = ModifierTypeGenerator.prototype.generateType;
      const spy = vi.spyOn(ModifierTypeGenerator.prototype, "generateType").mockImplementation(function (
        this: ModifierTypeGenerator,
        ...args
      ) {
        const type = generate.apply(this, args);
        if (type && !type.group) {
          type.group = SHARED;
        }
        return type;
      });
      const patched = Object.values(getModifierPoolForType(ModifierPoolType.PLAYER))
        .flatMap(entries => (entries as WeightedModifierType[]).map(e => e.modifierType))
        .filter(type => !type.group && !(type instanceof ModifierTypeGenerator));
      for (const type of patched) {
        type.group = SHARED;
      }
      return () => {
        for (const type of patched) {
          (type as { group: string | undefined }).group = undefined;
        }
        spy.mockRestore();
      };
    }

    /**
     * Rolls `screens` seeded 6-slot screens from wave 1001 on and counts the screens with 2+ group-less options and the
     * screens with two options of one non-empty group.
     */
    function rollDeepScreens(screens: number): { withSeveral: number; groupClashes: number } {
      const party = game.scene.getPlayerParty();
      game.scene.setSeed("reward-pacing-08-3");
      let withSeveral = 0;
      let groupClashes = 0;
      for (let w = 1001; w <= 1000 + screens; w++) {
        game.scene.currentBattle.waveIndex = w;
        game.scene.resetSeed(w);
        regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0);
        const options = getPlayerModifierTypeOptions(6, party);
        if (options.filter(groupLess).length >= 2) {
          withSeveral++;
        }
        const grouped = options.filter(o => !groupLess(o));
        if (grouped.some((o, i) => grouped.some((p, j) => j > i && isSameRewardGroup(o.type, p.type)))) {
          groupClashes++;
        }
      }
      return { withSeveral, groupClashes };
    }

    it("fills a deep Endless screen with several growth items instead of one", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      await startEndless([SpeciesId.GARCHOMP, SpeciesId.BLISSEY, SpeciesId.NINJASK]);
      const screens = 60;
      // the fixed rule first: the old-rule emulation patches types, and a generator could hand a patched one out again
      const after = rollDeepScreens(screens);
      const undo = emulateOldGroupRule();
      let before: ReturnType<typeof rollDeepScreens>;
      try {
        before = rollDeepScreens(screens);
      } finally {
        undo();
      }
      // Before the fix a screen showed a second group-less item only when every one of up to 29 re-rolls was group-less
      // too; now most 6-slot screens show several (held items, vitamins, IV candies, candies...). Measured with this
      // seed: 11 / 60 screens before, 60 / 60 after; two of one non-empty group 10 / 60 before (re-rolls ran out), 0 after
      expect(before.withSeveral / screens).toBeLessThan(0.3);
      expect(after.withSeveral / screens).toBeGreaterThan(0.8);
      // a second ball, TM, berry... still only when the re-rolls run out
      expect(after.groupClashes / screens).toBeLessThan(0.1);
    });
  });

  describe("Endless tier curve", () => {
    const SPEC_ANCHOR_WAVES = [0, 300, 1000, 2200];
    const SPEC_ANCHOR_COUNTS = [
      BASE_TIER_COUNTS,
      [704, 224, 72, 22, 2],
      [581, 277, 111, 49, 6],
      [423, 346, 151, 92, 12],
    ];

    it("moves the anchors to waves 0 / 300 / 1000 / 2200 with the same counts", () => {
      expect(ENDLESS_TIER_ANCHORS.map(a => a.wave)).toEqual(SPEC_ANCHOR_WAVES);
      expect(ENDLESS_TIER_ANCHORS.map(a => [...a.counts])).toEqual(SPEC_ANCHOR_COUNTS);
      SPEC_ANCHOR_WAVES.forEach((wave, i) => {
        expect(getEndlessTierCounts(wave), `wave ${wave}`).toEqual(SPEC_ANCHOR_COUNTS[i]);
      });
      // the old anchor waves now sit between anchors
      expect(getEndlessTierCounts(200)).toEqual([725, 215, 64, 18, 2]);
      expect(getEndlessTierCounts(500)).toEqual([669, 239, 83, 30, 3]);
    });

    it("closes the gap to the limit over 1800 waves past wave 2200", () => {
      expect(ENDLESS_TIER_TAIL_WAVES).toBe(1800);
      expect(getEndlessTierCounts(3000)).toEqual([338, 383, 173, 115, 15]);
      expect(getEndlessTierCounts(5850)).toEqual([217, 436, 203, 148, 20]);
      // limit = last anchor + slope of 1000-2200 x 1800 (COMMON about 18%, MASTER about 2.1%)
      expect(getEndlessTierCounts(1_000_000)).toEqual([186, 449, 211, 157, 21]);
    });
  });
});
