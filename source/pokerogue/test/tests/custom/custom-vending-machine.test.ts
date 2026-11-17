import type { BattleScene } from "#app/battle-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { allMoves, modifierTypes } from "#data/data-lists";
import { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { ModifierTypeOption } from "#modifiers/modifier-type";
import * as ModifierTypeModule from "#modifiers/modifier-type";
import { PokemonNatureChangeModifierType } from "#modifiers/modifier-type";
import { computeRerollCost, LOCKED_REROLL_TIER_VALUES } from "#modifiers/reroll-cost";
import * as EncounterDialogueUtils from "#mystery-encounters/encounter-dialogue-utils";
import * as EncounterPhaseUtils from "#mystery-encounters/encounter-phase-utils";
import { generateModifierType } from "#mystery-encounters/encounter-phase-utils";
import {
  allMysteryEncounters,
  CIVILIZATION_ENCOUNTER_BIOMES,
  mysteryEncountersByBiome,
} from "#mystery-encounters/mystery-encounter-biomes";
import { WaveRangeRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import {
  getVendingMachinePrice,
  getVendingMachineStock,
  rollVendingMachineReward,
  VENDING_MACHINE_PRICE_MULTIPLIER,
  VENDING_MACHINE_TIERS,
  VendingMachineEncounter,
  VendingMachineRequirement,
} from "#mystery-encounters/vending-machine-encounter";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { GameManager } from "#test/framework/game-manager";
import { TextInterceptor } from "#test/framework/text-interceptor";
import { runMysteryEncounterToEnd } from "#test/utils/encounter-test-utils";
import { MessageUiHandler } from "#ui/message-ui-handler";
import { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import type { MysteryEncounterUiHandler } from "#ui/mystery-encounter-ui-handler";
import i18next from "i18next";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const namespace = "mysteryEncounters/vendingMachine";
const defaultParty = [SpeciesId.LAPRAS, SpeciesId.GENGAR, SpeciesId.ABRA];
const defaultBiome = BiomeId.TOWN;
const defaultWave = 45;
const koFiles = import.meta.glob("../../../locales/ko/**/*.json", { eager: true, import: "default" });

/** Every reward tier except `tier` */
const allTiersBut = (tier: ModifierTier): Set<ModifierTier> =>
  new Set(
    [ModifierTier.COMMON, ModifierTier.GREAT, ModifierTier.ULTRA, ModifierTier.ROGUE, ModifierTier.MASTER].filter(
      t => t !== tier,
    ),
  );

/**
 * Local fork, the user's design of 2026-11-08 ("자판기!"): the GREAT-tier Vending Machine (VENDING_MACHINE). Options
 * 1-3 pay twice the Lock Capsule reroll price of a one-item reward screen of the tier ("보상으로 나오는 등급이 1개
 * 있을때의 리롤 가격 × 2") for one random Ultra / Rogue / Master item; option 4 finds a Relic Gold's worth of coins.
 */
describe("Custom mystery encounter - Vending Machine (VENDING_MACHINE)", () => {
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
      .disableTrainerWaves();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function startEncounter(party = defaultParty): Promise<void> {
    await game.runToMysteryEncounter(MysteryEncounterType.VENDING_MACHINE, party);
    scene.modifiers = [];
    await scene.updateModifiers(true);
  }

  /** Runs from the end of the option to the reward screen and returns its handler */
  async function toRewardScreen(): Promise<ModifierSelectUiHandler> {
    await game.phaseInterceptor.to("SelectModifierPhase");
    expect(scene.ui.mode).toBe(UiMode.MODIFIER_SELECT);
    return scene.ui.handlers.find(h => h instanceof ModifierSelectUiHandler) as ModifierSelectUiHandler;
  }

  const optionsOf = (handler: ModifierSelectUiHandler): ModifierTypeOption[] =>
    handler.options.map(o => o.modifierTypeOption);

  const newSludge = () => generateModifierType(modifierTypes.MYSTERY_ENCOUNTER_BLACK_SLUDGE, [2.5])!.newModifier()!;

  /** The real `SelectModifierPhase.getRerollCost(true)` of an ordinary reward screen holding only `option` */
  function lockedRerollCostOf(option: ModifierTypeOption): number {
    const phase = new SelectModifierPhase();
    (phase as unknown as { typeOptions: ModifierTypeOption[] }).typeOptions = [option];
    return phase.getRerollCost(true);
  }

  describe("registration", () => {
    it("is a GREAT-tier encounter after Tinkaton's Forge with four options, its sprite and its text", async () => {
      await startEncounter();

      expect(MysteryEncounterType.VENDING_MACHINE).toBe(MysteryEncounterType.TINKATON_FORGE + 1);
      expect(allMysteryEncounters[MysteryEncounterType.VENDING_MACHINE]).toBe(VendingMachineEncounter);
      expect(VendingMachineEncounter.encounterTier).toBe(MysteryEncounterTier.GREAT);
      // no party requirement: only the usual wave range
      expect(VendingMachineEncounter.requirements).toHaveLength(1);
      expect(VendingMachineEncounter.requirements[0]).toBeInstanceOf(WaveRangeRequirement);
      expect(VendingMachineEncounter.options).toHaveLength(4);
      expect(VendingMachineEncounter.options.map(o => o.optionMode)).toEqual([
        MysteryEncounterOptionMode.DISABLED_OR_DEFAULT,
        MysteryEncounterOptionMode.DISABLED_OR_DEFAULT,
        MysteryEncounterOptionMode.DISABLED_OR_DEFAULT,
        MysteryEncounterOptionMode.DEFAULT,
      ]);
      for (const option of VendingMachineEncounter.options.slice(0, 3)) {
        expect(option.requirements).toHaveLength(1);
        expect(option.requirements[0]).toBeInstanceOf(VendingMachineRequirement);
      }
      expect(VendingMachineEncounter.options[3].requirements).toHaveLength(0);
      expect(VENDING_MACHINE_TIERS).toEqual([ModifierTier.ULTRA, ModifierTier.ROGUE, ModifierTier.MASTER]);
      expect(VendingMachineEncounter.spriteConfigs.map(c => [c.spriteKey, c.fileRoot, c.hasShadow])).toEqual([
        ["vending_machine", "mystery-encounters", true],
      ]);
      expect(i18next.t(`${namespace}:title`)).toBe("Vending Machine");
      expect(i18next.t(`${namespace}:option.4.label`)).toBe("Search under the machine");
      expect(scene.currentBattle.mysteryEncounter?.encounterType).toBe(MysteryEncounterType.VENDING_MACHINE);
    });

    it("spawns in exactly the civilization biomes", () => {
      const expected = new Set<BiomeId>(CIVILIZATION_ENCOUNTER_BIOMES);
      expect(expected.size).toBeGreaterThan(10);
      for (const [biome, encounters] of mysteryEncountersByBiome) {
        if (expected.has(biome)) {
          expect(encounters, `biome ${BiomeId[biome]}`).toContain(MysteryEncounterType.VENDING_MACHINE);
        } else {
          expect(encounters, `biome ${BiomeId[biome]}`).not.toContain(MysteryEncounterType.VENDING_MACHINE);
        }
      }
      // the civilization biomes keep their other encounters
      expect(mysteryEncountersByBiome.get(BiomeId.TOWN)).toContain(MysteryEncounterType.GLOBAL_TRADE_SYSTEM);
    });
  });

  describe("prices", () => {
    it("are twice the real locked reroll price of a one-item screen of the tier, at any wave, Black Sludge or not", async () => {
      await startEncounter();
      const check = (wave: number, tier: ModifierTier, sludge: boolean) => {
        scene.currentBattle.waveIndex = wave;
        const option = rollVendingMachineReward(tier)!;
        expect(option.type.tier).toBe(tier);
        const reroll = lockedRerollCostOf(option);
        const label = `wave ${wave}, ${ModifierTier[tier]}, sludge ${sludge}`;
        expect(getVendingMachinePrice(tier), label).toBe(VENDING_MACHINE_PRICE_MULTIPLIER * reroll);
        // and the user's numbers: ceil(wave / 10) x the tier's lock value (300 / 750 / 2000), Black Sludge x2.5
        const base = Math.ceil(wave / 10) * LOCKED_REROLL_TIER_VALUES[tier];
        expect(reroll, label).toBe(sludge ? Math.floor(base * 2.5) : base);
      };
      const waves = [15, 95, 1000];
      for (const sludge of [false, true]) {
        if (sludge) {
          scene.addModifier(newSludge(), false, false, false, true);
        }
        for (const wave of waves) {
          VENDING_MACHINE_TIERS.forEach(tier => check(wave, tier, sludge));
        }
      }
      // spot check, Black Sludge still held: 2 x floor(10 x value x 2.5)
      scene.currentBattle.waveIndex = 95;
      expect(VENDING_MACHINE_TIERS.map(getVendingMachinePrice)).toEqual([15000, 37500, 100000]);
    });

    it("spot values without Black Sludge: wave 15 and wave 1000", async () => {
      await startEncounter();
      scene.currentBattle.waveIndex = 15;
      expect(VENDING_MACHINE_TIERS.map(getVendingMachinePrice)).toEqual([1200, 3000, 8000]);
      scene.currentBattle.waveIndex = 1000;
      expect(VENDING_MACHINE_TIERS.map(getVendingMachinePrice)).toEqual([60000, 150000, 400000]);
    });

    it("are settled when the encounter is set up and shown as the tooltip tokens", async () => {
      await startEncounter();
      const encounter = scene.currentBattle.mysteryEncounter!;
      const stock = getVendingMachineStock()!;
      expect(stock).toBe(encounter.misc);
      expect(stock.prices).toEqual(VENDING_MACHINE_TIERS.map(getVendingMachinePrice));
      expect(stock.prices).toEqual([
        2 * 5 * 300, // wave 45: ceil(4.5) = 5
        2 * 5 * 750,
        2 * 5 * 2000,
      ]);
      expect(stock.inStock).toEqual([true, true, true]);
      expect(encounter.dialogueTokens.option1Money).toBe("3000");
      expect(encounter.dialogueTokens.option2Money).toBe("7500");
      expect(encounter.dialogueTokens.option3Money).toBe("20000");

      // set up again with Black Sludge: every price x2.5
      scene.addModifier(newSludge(), false, false, false, true);
      encounter.onInit!();
      encounter.populateDialogueTokensFromRequirements();
      expect(getVendingMachineStock()!.prices).toEqual([7500, 18750, 50000]);
      expect(encounter.dialogueTokens.option3Money).toBe("50000");
    });

    it("keep getRerollCost's own behaviour: unlocked, rerolled, custom multiplier, no reroll", async () => {
      await startEncounter();
      scene.currentBattle.waveIndex = 45;
      const option = rollVendingMachineReward(ModifierTier.ROGUE)!;
      const phase = (rerollCount: number, multiplier?: number) => {
        const p = new SelectModifierPhase(
          rerollCount,
          undefined,
          multiplier === undefined ? undefined : { rerollMultiplier: multiplier },
        );
        (p as unknown as { typeOptions: ModifierTypeOption[] }).typeOptions = [option, option];
        return p;
      };
      expect(phase(0).getRerollCost(false)).toBe(5 * 250);
      expect(phase(0).getRerollCost(true)).toBe(5 * 1500);
      expect(phase(2).getRerollCost(true)).toBe(5 * 1500 * 4);
      expect(phase(1, 3).getRerollCost(false)).toBe(5 * 250 * 2 * 3);
      expect(phase(0, -1).getRerollCost(true)).toBe(-1);
      expect(computeRerollCost(null, 0, 1)).toBe(5 * 250);
    });
  });

  describe("options 1-3 - pay", () => {
    it("are disabled without the money, and open again with exactly the price", async () => {
      await startEncounter();
      const { prices } = getVendingMachineStock()!;
      const [ultra, rogue, master, search] = VendingMachineEncounter.options;
      for (const [slot, option] of [ultra, rogue, master].entries()) {
        scene.money = prices[slot] - 1;
        expect(option.meetsRequirements(), `option ${slot + 1}`).toBe(false);
        scene.money = prices[slot];
        expect(option.meetsRequirements(), `option ${slot + 1}`).toBe(true);
      }
      scene.money = 0;
      expect(search.meetsRequirements()).toBe(true);
    });

    it("are disabled while their tier is sold out (nothing of it to give right now), whatever the money", async () => {
      vi.spyOn(ModifierTypeModule, "getAvailablePlayerRewardTiers").mockReturnValue(allTiersBut(ModifierTier.MASTER));
      await startEncounter();
      expect(getVendingMachineStock()!.inStock).toEqual([true, true, false]);
      scene.money = Number.MAX_SAFE_INTEGER;
      const [ultra, rogue, master] = VendingMachineEncounter.options;
      expect(ultra.meetsRequirements()).toBe(true);
      expect(rogue.meetsRequirements()).toBe(true);
      expect(master.meetsRequirements()).toBe(false);

      vi.spyOn(ModifierTypeModule, "getAvailablePlayerRewardTiers").mockReturnValue(allTiersBut(ModifierTier.ULTRA));
      scene.currentBattle.mysteryEncounter!.onInit!();
      expect(getVendingMachineStock()!.inStock).toEqual([false, true, true]);
      expect(ultra.meetsRequirements()).toBe(false);
      expect(master.meetsRequirements()).toBe(true);
    });

    it.each([
      [1, ModifierTier.ULTRA],
      [2, ModifierTier.ROGUE],
      [3, ModifierTier.MASTER],
    ])(
      "option %i takes exactly its price and shows exactly one %s item, no reroll, no fill",
      async (optionNo, tier) => {
        await startEncounter();
        const price = getVendingMachineStock()!.prices[optionNo - 1];
        expect(price).toBe(getVendingMachinePrice(tier));
        scene.money = price + 123;
        const battle = vi.spyOn(EncounterPhaseUtils, "initBattleWithEnemyConfig");
        const leave = vi.spyOn(EncounterPhaseUtils, "leaveEncounterWithoutBattle");

        await runMysteryEncounterToEnd(game, optionNo);

        expect(scene.money).toBe(123);
        expect(battle).not.toHaveBeenCalled();
        expect(leave).toHaveBeenCalledTimes(1);
        expect(leave.mock.calls[0][0] ?? false).toBe(false);
        const handler = await toRewardScreen();
        const options = optionsOf(handler);
        expect(options).toHaveLength(1);
        expect(options[0].type.tier).toBe(tier);
        expect(options[0].upgradeCount).toBe(0);
        expect((handler as any).rerollCost).toBe(-1);
        expect(game.textInterceptor.logs.some(l => l.includes(`You paid ₽${price.toLocaleString("en-US")}`))).toBe(
          true,
        );
        expect(game.textInterceptor.logs.some(l => l.includes("Clunk! Something came out!"))).toBe(true);
      },
    );
  });

  describe("reward rolls", () => {
    it("give one item of the tier, whatever the seed", async () => {
      await startEncounter();
      for (let i = 0; i < 25; i++) {
        scene.setSeed(`vending-machine-${i}`);
        scene.resetSeed(1);
        for (const tier of VENDING_MACHINE_TIERS) {
          const option = rollVendingMachineReward(tier);
          expect(option?.type.tier, `seed ${i}`).toBe(tier);
          expect(option?.upgradeCount).toBe(0);
        }
      }
    });

    it("count only the mint they hand out as offered, not the rolls they throw away", async () => {
      await startEncounter();
      // every roll is a mint (an Ultra item): a Rogue purchase throws 50 of them away before settling for the last
      game.override.itemRewards([{ name: "MINT" }]);
      for (const tier of [ModifierTier.ULTRA, ModifierTier.ROGUE]) {
        scene.forkOfferedMintNatures.clear();
        const option = rollVendingMachineReward(tier)!;
        expect(option.type).toBeInstanceOf(PokemonNatureChangeModifierType);
        const nature = (option.type as PokemonNatureChangeModifierType).getNature();
        expect([...scene.forkOfferedMintNatures], ModifierTier[tier]).toEqual([nature]);
      }
    });

    it("on the real reward screen, record only the mint that is shown", async () => {
      await startEncounter();
      game.override.itemRewards([{ name: "MINT" }]);
      // the reward roll makes a mint; the screen itself must show it as rolled, so the test override (which also
      // rewrites the screen's options) is switched off when the screen starts
      const startScreen = SelectModifierPhase.prototype.start;
      vi.spyOn(SelectModifierPhase.prototype, "start").mockImplementation(function (this: SelectModifierPhase) {
        game.override.itemRewards([]);
        return startScreen.call(this);
      });
      scene.forkOfferedMintNatures.clear();
      scene.money = getVendingMachineStock()!.prices[0];
      await runMysteryEncounterToEnd(game, 1);
      const [option] = optionsOf(await toRewardScreen());
      expect(option.type).toBeInstanceOf(PokemonNatureChangeModifierType);
      expect([...scene.forkOfferedMintNatures]).toEqual([(option.type as PokemonNatureChangeModifierType).getNature()]);
    });
  });

  describe("option 4 - search under the machine", () => {
    it("finds one Relic Gold (the wave's money x10), with no shop and no reward screen", async () => {
      await startEncounter();
      const leave = vi.spyOn(EncounterPhaseUtils, "leaveEncounterWithoutBattle");
      const newPhase = vi.spyOn(scene.phaseManager, "unshiftNew");
      scene.money = 50;

      await runMysteryEncounterToEnd(game, 4);

      expect(scene.money - 50).toBe(scene.getWaveMoneyAmount(10));
      expect(leave).toHaveBeenCalledTimes(1);
      expect(leave.mock.calls[0][0] ?? false).toBe(false);
      expect(scene.currentBattle.mysteryEncounter!.doEncounterRewards).toBeUndefined();
      expect(newPhase.mock.calls.some(([name]) => name === "SelectModifierPhase")).toBe(false);
      expect(game.textInterceptor.logs.some(l => l.includes("You search under the machine..."))).toBe(true);
      expect(game.textInterceptor.logs.some(l => l.includes("You received ₽"))).toBe(true);
    });
  });

  /**
   * Every Korean text the encounter puts on screen, captured from the encounter screen (getEncounterText), the
   * message boxes and the test text log: the user's strings, no raw keys, no {{ }} or [[ ]] left.
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

    /** Tooltips and labels come styled: keep only the words */
    const stripBBCode = (text: string) => text.replace(/\[\/?(?:color|shadow)(?:=[^\]]*)?\]/gi, "");

    const record = (text: unknown) => {
      if (text != null && text !== "") {
        captured.push({ flow, text: stripBBCode(String(text)) });
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
        record(text);
        return origTiShowText.call(this, text);
      });
      vi.spyOn(MessageUiHandler.prototype, "showText").mockImplementation(function (
        this: MessageUiHandler,
        text: string,
        ...rest: any[]
      ) {
        record(text);
        return (origBoxShowText as any).call(this, text, ...rest);
      });
    });

    /** Opens the option screen and hovers all four options (0 -> 1 -> 3 -> 2 -> 0) so their tooltips are built */
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
      handler.processInput(Button.DOWN);
      handler.processInput(Button.LEFT);
      handler.processInput(Button.UP);
    }

    const textsOf = (f: string) => captured.filter(c => c.flow === f).map(c => c.text);

    it("shows the user's strings on the encounter screen, prices included", async () => {
      flow = "screen";
      await startEncounter();
      scene.money = getVendingMachineStock()!.prices[2] * 2;
      await hoverOptions();
      const texts = textsOf(flow).join("\n");
      for (const expected of [
        "자판기가 서 있다!",
        "자판기",
        "자판기입니다. 돈을 넣으면 아이템이 나오죠!",
        "어떻게 하시겠습니까?",
        "약간의 돈을 낸다",
        "많은 돈을 낸다",
        "터무니없이 많은 돈을 낸다",
        "자판기 밑을 뒤져본다",
        "(-) ₽3,000\n(+) 쓸만한 아이템",
        "(-) ₽7,500\n(+) 엄청난 아이템",
        "(-) ₽20,000\n(+) 최고의 아이템",
        "(+) 동전",
      ]) {
        expect(texts).toContain(expected);
      }
      expect(texts).not.toContain("품절");
    });

    it("shows the disabled tooltip without the money", async () => {
      flow = "poor";
      await startEncounter();
      scene.money = 0;
      await hoverOptions();
      const texts = textsOf(flow).filter(t => t === "(-) 돈이 부족하거나\n품절이다");
      expect(texts.length).toBeGreaterThanOrEqual(3);
    });

    it("shows the disabled tooltip on a sold-out tier even with the money", async () => {
      flow = "soldOut";
      vi.spyOn(ModifierTypeModule, "getAvailablePlayerRewardTiers").mockReturnValue(allTiersBut(ModifierTier.MASTER));
      await startEncounter();
      scene.money = Number.MAX_SAFE_INTEGER;
      await hoverOptions();
      const texts = textsOf(flow);
      expect(texts).toContain("(-) 돈이 부족하거나\n품절이다");
      expect(texts).toContain("(-) ₽3,000\n(+) 쓸만한 아이템");
      expect(texts).not.toContain("(-) ₽20,000\n(+) 최고의 아이템");
    });

    it("option 1: paying", async () => {
      flow = "pay";
      await startEncounter();
      scene.money = getVendingMachineStock()!.prices[0];
      await runMysteryEncounterToEnd(game, 1);
      const texts = textsOf(flow).join("\n");
      expect(texts).toMatch(/₽3,000[을를] 지불했다\./);
      expect(texts).toContain("덜컹! 무언가가 나왔다!");
    });

    it("option 4: searching", async () => {
      flow = "search";
      await startEncounter();
      await runMysteryEncounterToEnd(game, 4);
      const texts = textsOf(flow).join("\n");
      expect(texts).toContain("자판기 밑을 뒤져 보니...");
      expect(texts).toContain("떨어진 동전이 잔뜩 있었다!");
      expect(texts).toMatch(/₽[\d,]+[을를] 받았다!/);
    });

    it("leaves no raw key, {{ }} or [[ ]] in anything it showed", () => {
      expect(captured.length).toBeGreaterThan(20);
      for (const { flow: f, text } of captured) {
        expect(text, `${f}: ${text}`).not.toMatch(/\{\{|\}\}|\[\[|\]\]/);
        expect(text, `${f}: ${text}`).not.toContain("vendingMachine");
        expect(text, `${f}: ${text}`).not.toContain("mysteryEncounters/");
      }
    });
  });
});
