import type { BattleScene } from "#app/battle-scene";
import { modifierTypes } from "#data/data-lists";
import { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import type { ModifierType } from "#modifiers/modifier-type";
import * as ModifierTypeModule from "#modifiers/modifier-type";
import { generateModifierType } from "#mystery-encounters/encounter-phase-utils";
import * as MysteryEncounters from "#mystery-encounters/mystery-encounter-biomes";
import { allMysteryEncounters, CIVILIZATION_ENCOUNTER_BIOMES } from "#mystery-encounters/mystery-encounter-biomes";
import {
  getSuperGtsRewardTier,
  getSuperGtsStacks,
  getSuperGtsTradeTiers,
  rollSuperGtsRewards,
  SUPER_GTS_TRADES,
  SuperGlobalTradeSystemEncounter,
  SuperGtsItemRequirement,
  SuperGtsSelection,
} from "#mystery-encounters/super-global-trade-system-encounter";
import { GameManager } from "#test/framework/game-manager";
import { runSelectMysteryEncounterOption } from "#test/utils/encounter-test-utils";
import { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import type { MysteryEncounterUiHandler } from "#ui/mystery-encounter-ui-handler";
import type { OptionSelectUiHandler } from "#ui/option-select-ui-handler";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const namespace = "mysteryEncounters/superGlobalTradeSystem";
const defaultParty = [SpeciesId.LAPRAS, SpeciesId.GENGAR, SpeciesId.ABRA];
const defaultBiome = BiomeId.CAVE;
const defaultWave = 45;
const [FIVE, TEN] = SUPER_GTS_TRADES;

/**
 * Local fork, the user's request of 2026-11-07: "쓸모없는 템 교환용으로 미스터리 조우를 하나 만들어두죠 ... 지금
 * 지니고 있는 특정 등급 아이템을 5개 / 10개 교환해서 1단계 / 2단계 높은 아이템을 받는건데 ... 5개 희생시 3개중 하나,
 * 10개 희생시 5개중 하나 ... 슈퍼 - gts라고 이름 붙이고".
 */
describe("Custom mystery encounter - Super GTS (슈퍼 GTS)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let scene: BattleScene;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    scene = game.scene;
    game.override
      .mysteryEncounterChance(100)
      .startingWave(defaultWave)
      .startingBiome(defaultBiome)
      .disableTrainerWaves();

    const biomeMap = new Map<BiomeId, MysteryEncounterType[]>([
      [BiomeId.VOLCANO, [MysteryEncounterType.MYSTERIOUS_CHALLENGERS]],
    ]);
    CIVILIZATION_ENCOUNTER_BIOMES.forEach(biome => {
      biomeMap.set(biome, [MysteryEncounterType.SUPER_GLOBAL_TRADE_SYSTEM]);
    });
    vi.spyOn(MysteryEncounters, "mysteryEncountersByBiome", "get").mockReturnValue(biomeMap);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const typeBooster = (type: PokemonType) =>
    generateModifierType(modifierTypes.ATTACK_TYPE_BOOSTER, [type]) as ModifierType;

  function giveItem(pokemon: Pokemon, type: ModifierType, stacks: number): PokemonHeldItemModifier {
    const modifier = type.newModifier(pokemon) as PokemonHeldItemModifier;
    modifier.stackCount = stacks;
    scene.addModifier(modifier, true, false, false, true);
    return pokemon.getHeldItems().find(m => m.match(modifier))!;
  }

  /** The user's case: Silk Scarf ×6, Spell Tag ×1 and Fairy Feather ×1 on one Pokémon, all Ultra tier */
  async function startWithTypeBoosters(): Promise<{
    scarf: PokemonHeldItemModifier;
    tag: PokemonHeldItemModifier;
    feather: PokemonHeldItemModifier;
  }> {
    await game.runToMysteryEncounter(MysteryEncounterType.SUPER_GLOBAL_TRADE_SYSTEM, defaultParty);
    scene.modifiers = [];
    const [lapras] = scene.getPlayerParty();
    const scarf = giveItem(lapras, typeBooster(PokemonType.NORMAL), 6);
    const tag = giveItem(lapras, typeBooster(PokemonType.GHOST), 1);
    const feather = giveItem(lapras, typeBooster(PokemonType.FAIRY), 1);
    await scene.updateModifiers(true);
    return { scarf, tag, feather };
  }

  const optionHandler = () => scene.ui.handlers[UiMode.OPTION_SELECT] as OptionSelectUiHandler;
  const optionLabels = () => ((optionHandler() as any).config.options as { label: string }[]).map(o => o.label);

  /** Waits for the next option menu, then picks the entry whose label contains `text` */
  async function pick(text: string): Promise<void> {
    const handler = optionHandler();
    await vi.waitFor(() => {
      expect(scene.ui.mode).toBe(UiMode.OPTION_SELECT);
      expect(optionLabels().some(l => l.includes(text))).toBe(true);
    });
    const index = optionLabels().findIndex(l => l.includes(text));
    for (let i = 0; i < index; i++) {
      handler.processInput(Button.DOWN);
    }
    handler.processInput(Button.ACTION);
  }

  /** Clicks through the trade messages and runs to the reward screen */
  async function finishTrade(): Promise<ModifierSelectUiHandler> {
    game.onNextPrompt(
      "MysteryEncounterOptionSelectedPhase",
      UiMode.MESSAGE,
      () => {
        game.scene.ui.getHandler<MysteryEncounterUiHandler>().processInput(Button.ACTION);
      },
      () => game.isCurrentPhase("MysteryEncounterRewardsPhase"),
    );
    await game.phaseInterceptor.to("MysteryEncounterRewardsPhase");
    await game.phaseInterceptor.to("SelectModifierPhase");
    expect(scene.ui.mode).toBe(UiMode.MODIFIER_SELECT);
    return scene.ui.handlers.find(h => h instanceof ModifierSelectUiHandler) as ModifierSelectUiHandler;
  }

  it("is a GREAT-tier encounter of the GTS's biomes, with three options and its own text", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.SUPER_GLOBAL_TRADE_SYSTEM, defaultParty);

    expect(allMysteryEncounters[MysteryEncounterType.SUPER_GLOBAL_TRADE_SYSTEM]).toBe(SuperGlobalTradeSystemEncounter);
    expect(SuperGlobalTradeSystemEncounter.encounterTier).toBe(MysteryEncounterTier.GREAT);
    expect(SuperGlobalTradeSystemEncounter.options.length).toBe(3);
    expect(i18next.t(`${namespace}:title`)).toBe("The Super GTS");
    expect(SuperGlobalTradeSystemEncounter.spriteConfigs[0].spriteKey).toBe("super_global_trade_system");
    expect(scene.currentBattle.mysteryEncounter?.encounterType).toBe(MysteryEncounterType.SUPER_GLOBAL_TRADE_SYSTEM);
  });

  it("uses the user's numbers: 5 for 1 of 3 a tier up, 10 for 1 of 5 two tiers up, never above Master", () => {
    expect(FIVE).toEqual({ count: 5, tierStep: 1, choices: 3 });
    expect(TEN).toEqual({ count: 10, tierStep: 2, choices: 5 });
    expect(getSuperGtsRewardTier(ModifierTier.COMMON, FIVE)).toBe(ModifierTier.GREAT);
    expect(getSuperGtsRewardTier(ModifierTier.ROGUE, FIVE)).toBe(ModifierTier.MASTER);
    expect(getSuperGtsRewardTier(ModifierTier.ULTRA, TEN)).toBe(ModifierTier.MASTER);
    expect(getSuperGtsRewardTier(ModifierTier.ROGUE, TEN)).toBeNull();
  });

  it("counts items one by one across stacks and party members, per tier, and leaves out Master and fixed items", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.SUPER_GLOBAL_TRADE_SYSTEM, defaultParty);
    scene.modifiers = [];
    const [lapras, gengar] = scene.getPlayerParty();
    giveItem(lapras, typeBooster(PokemonType.NORMAL), 3);
    giveItem(gengar, typeBooster(PokemonType.GHOST), 2);
    expect(getSuperGtsTradeTiers(FIVE)).toEqual([{ tier: ModifierTier.ULTRA, total: 5 }]);
    expect(getSuperGtsTradeTiers(TEN)).toEqual([]);
    expect(new SuperGtsItemRequirement(FIVE).meetsRequirement()).toBe(true);
    expect(new SuperGtsItemRequirement(TEN).meetsRequirement()).toBe(false);

    // Master-tier items (Multi Lens) and untransferable ones (vitamins) are never counted
    giveItem(lapras, generateModifierType(modifierTypes.MULTI_LENS)!, 4);
    giveItem(gengar, generateModifierType(modifierTypes.BASE_STAT_BOOSTER, [0])!, 9);
    const stacks = getSuperGtsStacks();
    expect(stacks.map(s => s.tier).sort()).toEqual([ModifierTier.ULTRA, ModifierTier.ULTRA]);

    // Rogue items can go 5 at a time (to Master) but not 10 at a time
    giveItem(lapras, generateModifierType(modifierTypes.SOUL_DEW)!, 3);
    giveItem(gengar, generateModifierType(modifierTypes.SOUL_DEW)!, 3);
    giveItem(gengar, generateModifierType(modifierTypes.LEFTOVERS)!, 4);
    expect(getSuperGtsTradeTiers(FIVE).map(t => t.tier)).toEqual([ModifierTier.ULTRA, ModifierTier.ROGUE]);
    expect(getSuperGtsTradeTiers(TEN)).toEqual([]);
  });

  it("picks as many of a stack as are still needed, so small stacks picked first spare a big one", async () => {
    const { scarf, tag, feather } = await startWithTypeBoosters();
    const selection = new SuperGtsSelection(FIVE, ModifierTier.ULTRA);
    const stackOf = (m: PokemonHeldItemModifier) => selection.stacks().find(s => s.modifier === m)!;

    expect(selection.pick(stackOf(tag))).toBe(1);
    expect(selection.pick(stackOf(feather))).toBe(1);
    expect(selection.remaining).toBe(3);
    expect(selection.pick(stackOf(scarf))).toBe(3);
    expect(selection.done).toBe(true);
    expect(selection.stacks().map(s => s.modifier)).toEqual([scarf]);
    expect(selection.available(stackOf(scarf))).toBe(3);

    selection.takeItems();
    expect(scarf.stackCount).toBe(3);
    expect(scene.modifiers).not.toContain(tag);
    expect(scene.modifiers).not.toContain(feather);
  });

  it("option 1: sends 5 chosen Ultra items and shows 3 Rogue items to pick from", async () => {
    const { scarf, tag, feather } = await startWithTypeBoosters();
    await runSelectMysteryEncounterOption(game, 1);

    await pick(i18next.t(`${namespace}:tier.2`));
    await vi.waitFor(() => expect(optionLabels().some(l => l.includes("×6"))).toBe(true));
    await pick(tag.type.name);
    await pick(feather.type.name);
    await pick(scarf.type.name);

    const handler = await finishTrade();
    expect(handler.options).toHaveLength(3);
    for (const option of handler.options) {
      expect(option.modifierTypeOption.type.tier).toBe(ModifierTier.ROGUE);
    }
    expect(scarf.stackCount).toBe(3);
    expect(scene.modifiers).not.toContain(tag);
    expect(scene.modifiers).not.toContain(feather);
  });

  it("option 2: sends 10 Ultra items and shows 5 Master items to pick from", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.SUPER_GLOBAL_TRADE_SYSTEM, defaultParty);
    scene.modifiers = [];
    const [lapras, gengar] = scene.getPlayerParty();
    const scarf = giveItem(lapras, typeBooster(PokemonType.NORMAL), 6);
    const tag = giveItem(gengar, typeBooster(PokemonType.GHOST), 4);
    await scene.updateModifiers(true);
    await runSelectMysteryEncounterOption(game, 2);

    await pick(i18next.t(`${namespace}:tier.2`));
    await pick(scarf.type.name);
    await pick(tag.type.name);

    const handler = await finishTrade();
    expect(handler.options).toHaveLength(5);
    for (const option of handler.options) {
      expect(option.modifierTypeOption.type.tier).toBe(ModifierTier.MASTER);
    }
    // five different items, and no reroll (a reroll would drop the trade's tier and count)
    expect(new Set(handler.options.map(o => o.modifierTypeOption.type.name)).size).toBe(5);
    expect((handler as any).rerollCost).toBe(-1);
    expect(scene.modifiers).not.toContain(scarf);
    expect(scene.modifiers).not.toContain(tag);
  });

  it("rolls reward screens without repeats (a plain tier screen of five Master items usually had one)", async () => {
    await startWithTypeBoosters();
    for (let i = 0; i < 20; i++) {
      scene.setSeed(`super-gts-${i}`);
      const offers = rollSuperGtsRewards(ModifierTier.MASTER, 5);
      expect(offers).toHaveLength(5);
      expect(new Set(offers.map(o => o.type.name)).size).toBe(5);
      expect(offers.every(o => o.type.tier === ModifierTier.MASTER)).toBe(true);
    }
  });

  it("only offers a trade whose reward tier has items right now (no Rogue items for a Master trade)", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.SUPER_GLOBAL_TRADE_SYSTEM, defaultParty);
    scene.modifiers = [];
    const [lapras, gengar] = scene.getPlayerParty();
    giveItem(lapras, typeBooster(PokemonType.NORMAL), 6);
    giveItem(gengar, typeBooster(PokemonType.GHOST), 4);
    giveItem(lapras, generateModifierType(modifierTypes.SOUL_DEW)!, 5);
    expect(new SuperGtsItemRequirement(TEN, true).meetsRequirement()).toBe(true);

    const noMaster = new Set([ModifierTier.COMMON, ModifierTier.GREAT, ModifierTier.ULTRA, ModifierTier.ROGUE]);
    vi.spyOn(ModifierTypeModule, "getAvailablePlayerRewardTiers").mockReturnValue(noMaster);
    // Ultra x10 and Rogue x5 both pay in Master: neither is offered, Ultra x5 (to Rogue) still is
    expect(new SuperGtsItemRequirement(TEN, true).meetsRequirement()).toBe(false);
    expect(getSuperGtsTradeTiers(FIVE, getSuperGtsStacks(), noMaster).map(t => t.tier)).toEqual([ModifierTier.ULTRA]);
    expect(new SuperGtsItemRequirement(FIVE, true).meetsRequirement()).toBe(true);
    // the spawn check does not look at the reward pool
    expect(new SuperGtsItemRequirement(TEN).meetsRequirement()).toBe(true);
  });

  it("splits a long list of sent items into lines of two and pages of two lines", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.SUPER_GLOBAL_TRADE_SYSTEM, defaultParty);
    scene.modifiers = [];
    const [lapras] = scene.getPlayerParty();
    for (const type of [
      PokemonType.NORMAL,
      PokemonType.GHOST,
      PokemonType.FAIRY,
      PokemonType.WATER,
      PokemonType.FIRE,
    ]) {
      giveItem(lapras, typeBooster(type), 1);
    }
    const selection = new SuperGtsSelection(FIVE, ModifierTier.ULTRA);
    for (const stack of selection.stacks()) {
      selection.pick(stack);
    }
    const pages = selection.summary().split("$");
    expect(pages).toHaveLength(2);
    expect(pages[0].split("\n")).toHaveLength(2);
    expect(pages[0].split("\n")[0].split(", ")).toHaveLength(2);
    expect(pages[1].split("\n")).toEqual([expect.stringContaining("×1")]);
  });

  it("option 2 is disabled with fewer than 10 items of one tier", async () => {
    await startWithTypeBoosters();
    expect(SuperGlobalTradeSystemEncounter.options[0].meetsRequirements()).toBe(true);
    expect(SuperGlobalTradeSystemEncounter.options[1].meetsRequirements()).toBe(false);
  });

  it("'start over' clears the picks, and cancel goes back without sending anything", async () => {
    const { scarf, tag } = await startWithTypeBoosters();
    await runSelectMysteryEncounterOption(game, 1);

    await pick(i18next.t(`${namespace}:tier.2`));
    await pick(tag.type.name);
    await pick(i18next.t(`${namespace}:pickAgain`));
    await pick(i18next.t(`${namespace}:tier.2`));
    // the Spell Tag is offered again after starting over
    await vi.waitFor(() => expect(optionLabels().some(l => l.includes(tag.type.name))).toBe(true));
    await pick(i18next.t("menu:cancel"));

    await vi.waitFor(() => expect(scene.ui.mode).toBe(UiMode.MYSTERY_ENCOUNTER));
    expect(scarf.stackCount).toBe(6);
    expect(tag.stackCount).toBe(1);
    expect(scene.modifiers).toContain(tag);
  });
});
