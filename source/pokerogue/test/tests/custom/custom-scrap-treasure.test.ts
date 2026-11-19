import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { FormChangeItem } from "#enums/form-change-item";
import { GameModes } from "#enums/game-modes";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { AssaultVestModifier, BulletproofVestModifier } from "#modifiers/custom-held-items";
import { MegaEvolutionAccessModifier, type PokemonHeldItemModifier } from "#modifiers/modifier";
import { FormChangeItemModifierType, type ModifierTypeOption } from "#modifiers/modifier-type";
import * as EncounterDialogueUtils from "#mystery-encounters/encounter-dialogue-utils";
import * as EncounterPhaseUtils from "#mystery-encounters/encounter-phase-utils";
import { generateModifierType } from "#mystery-encounters/encounter-phase-utils";
import { allMysteryEncounters, mysteryEncountersByBiome } from "#mystery-encounters/mystery-encounter-biomes";
import { PartySizeRequirement, WaveRangeRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import {
  canUseScrapMelmetalite,
  getScrapTreasureFormChangeReward,
  getScrapTreasureOpeningEffects,
  rollScrapTreasureRewards,
  SCRAP_TREASURE_BOSS_MOVES,
  SCRAP_TREASURE_DIG_FIND_CHANCE,
  SCRAP_TREASURE_DIG_REWARDS,
  SCRAP_TREASURE_OPENING_MOVES,
  SCRAP_TREASURE_WIN_TIERS,
  ScrapTreasureEncounter,
  scrapTreasureDice,
} from "#mystery-encounters/scrap-treasure-encounter";
import {
  getDarkChestSeedOffset,
  getForcedSpecialEncounter,
  getScrapTreasureSeedOffset,
  getScrapTreasureWaveChance,
  isScrapTreasureWave,
  SCRAP_TREASURE_SPAWN_CHANCE,
  SPECIAL_ENCOUNTER_SPAWNS,
} from "#mystery-encounters/special-spawns";
import { MovePhase } from "#phases/move-phase";
import { GameManager } from "#test/framework/game-manager";
import { TextInterceptor } from "#test/framework/text-interceptor";
import { runMysteryEncounterToEnd, skipBattleRunMysteryEncounterRewardsPhase } from "#test/utils/encounter-test-utils";
import { MessageUiHandler } from "#ui/message-ui-handler";
import { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import type { MysteryEncounterUiHandler } from "#ui/mystery-encounter-ui-handler";
import { getEnumValues } from "#utils/enums";
import i18next from "i18next";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const namespace = "mysteryEncounters/scrapTreasure";
const defaultParty = [SpeciesId.LAPRAS, SpeciesId.GENGAR, SpeciesId.ABRA];
const defaultBiome = BiomeId.FACTORY;
const defaultWave = 45;
const SCRAP_TREASURE_BIOMES: readonly BiomeId[] = [
  BiomeId.FACTORY,
  BiomeId.CONSTRUCTION_SITE,
  BiomeId.LABORATORY,
  BiomeId.POWER_PLANT,
];
const koFiles = import.meta.glob("../../../locales/ko/**/*.json", { eager: true, import: "default" });
const dialogueFiles = import.meta.glob("../../../locales/*/mystery-encounters/scrap-treasure-dialogue.json", {
  eager: true,
  import: "default",
});

/**
 * Local fork (2026-11-19), item D7 of docs/1.2.0_후보_20261119.md: the ROGUE-tier "고철 속 보물" (Treasure in the
 * Scrap, SCRAP_TREASURE), from docs/미스터리조우_아이디어_20261108.md section 4 with the user's change (the user: "d7
 * 실행 / 싸워 이기면 파티원이 사용 가능한 변화 아이템이 나오도록, 고철을 뒤지는 선택지도 나오도록"). Option 1 is a
 * G-Max Melmetal boss (Acid Armor and Metal Sound before turn 1) that rewards a form-change item a party member can use
 * (a Rogue item when nobody can), a Rogue and an Ultra item; option 2 finds a vest 60% / faints the highest-level
 * party member 40%; option 3 leaves. In Endless, waves 809, 1809, ... are forced into it 81 times in 1000.
 */
describe("Custom mystery encounter - Treasure in the Scrap (SCRAP_TREASURE)", () => {
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
    await game.runToMysteryEncounter(MysteryEncounterType.SCRAP_TREASURE, party);
    scene.modifiers = [];
    await scene.updateModifiers(true);
    return scene.getPlayerParty();
  }

  const giveMegaBracelet = () => {
    scene.addModifier(generateModifierType(modifierTypes.MEGA_BRACELET)!.newModifier(), true);
  };
  const vestsOf = (pokemon: PlayerPokemon): PokemonHeldItemModifier[] =>
    pokemon.getHeldItems().filter(m => m instanceof AssaultVestModifier || m instanceof BulletproofVestModifier);
  /** Fills `pokemon`'s stacks of both vests to the player's cap (3 each, PLAYER_HELD_ITEM_CAPS) */
  const fillVests = (pokemon: PlayerPokemon) => {
    for (const id of ["ASSAULT_VEST", "BULLETPROOF_VEST"] as const) {
      const vest = generateModifierType(modifierTypes[id])!.newModifier(pokemon) as PokemonHeldItemModifier;
      vest.stackCount = vest.getMaxStackCount();
      expect(vest.stackCount).toBe(3);
      scene.addModifier(vest, true);
    }
  };
  const vestStacks = (pokemon: PlayerPokemon) => vestsOf(pokemon).reduce((n, v) => n + v.getStackCount(), 0);
  const ballTotal = () => Object.values(scene.pokeballCounts).reduce((a, b) => a + b, 0);
  const logsInclude = (text: string) => game.textInterceptor.logs.some(l => l.includes(text));
  const formItemOf = (option: ModifierTypeOption | null | undefined): FormChangeItem | undefined =>
    option?.type instanceof FormChangeItemModifierType ? option.type.formChangeItem : undefined;

  describe("registration", () => {
    it("is a ROGUE-tier encounter appended last to the enum, with three options, its silhouette and its text", async () => {
      await startEncounter();

      expect(MysteryEncounterType.SCRAP_TREASURE).toBeGreaterThan(MysteryEncounterType.ALPHA_ENCOUNTER);
      expect(Math.max(...getEnumValues(MysteryEncounterType))).toBeGreaterThanOrEqual(
        MysteryEncounterType.SCRAP_TREASURE,
      );
      expect(allMysteryEncounters[MysteryEncounterType.SCRAP_TREASURE]).toBe(ScrapTreasureEncounter);
      expect(ScrapTreasureEncounter.encounterTier).toBe(MysteryEncounterTier.ROGUE);
      expect(ScrapTreasureEncounter.options).toHaveLength(3);
      expect(ScrapTreasureEncounter.options.map(o => o.optionMode)).toEqual([
        MysteryEncounterOptionMode.DEFAULT,
        MysteryEncounterOptionMode.DEFAULT,
        MysteryEncounterOptionMode.DEFAULT,
      ]);
      // the usual waves and the official Trash to Treasure's party of 3
      const [waveRange, partySize] = ScrapTreasureEncounter.requirements;
      expect(ScrapTreasureEncounter.requirements).toHaveLength(2);
      expect(waveRange).toBeInstanceOf(WaveRangeRequirement);
      expect(partySize).toBeInstanceOf(PartySizeRequirement);
      expect((partySize as PartySizeRequirement).partySizeRange).toEqual([3, 6]);
      expect(ScrapTreasureEncounter.autoHideIntroVisuals).toBe(false);
      expect(ScrapTreasureEncounter.fleeAllowed).toBe(false);
      expect(ScrapTreasureEncounter.dialogue.intro).toStrictEqual([{ text: `${namespace}:intro` }]);
      expect(ScrapTreasureEncounter.dialogue.encounterOptionsDialogue?.title).toBe(`${namespace}:title`);
      expect(ScrapTreasureEncounter.dialogue.encounterOptionsDialogue?.description).toBe(`${namespace}:description`);
      expect(ScrapTreasureEncounter.dialogue.encounterOptionsDialogue?.query).toBe(`${namespace}:query`);

      // the existing G-Max Melmetal art as a silhouette, the way the official shows its Garbodor
      expect(ScrapTreasureEncounter.spriteConfigs).toHaveLength(1);
      expect(ScrapTreasureEncounter.spriteConfigs[0]).toMatchObject({
        spriteKey: "809-gigantamax",
        fileRoot: "pokemon",
        hasShadow: false,
        disableAnimation: true,
        scale: 1.5,
        tint: 0.4,
      });

      expect(i18next.t(`${namespace}:title`)).toBe("Treasure in the Scrap");
      expect(i18next.t(`${namespace}:option.1.tooltip`)).toBe("(-) A very hard battle\n(+) Special Rewards");
      expect(scene.currentBattle.mysteryEncounter?.encounterType).toBe(MysteryEncounterType.SCRAP_TREASURE);
    });

    it("spawns in the Factory, the Construction Site, the Laboratory and the Power Plant, and nowhere else", () => {
      for (const biome of SCRAP_TREASURE_BIOMES) {
        expect(mysteryEncountersByBiome.get(biome), `biome ${BiomeId[biome]}`).toContain(
          MysteryEncounterType.SCRAP_TREASURE,
        );
      }
      for (const [biome, encounters] of mysteryEncountersByBiome) {
        if (!SCRAP_TREASURE_BIOMES.includes(biome)) {
          expect(encounters, `biome ${BiomeId[biome]}`).not.toContain(MysteryEncounterType.SCRAP_TREASURE);
        }
      }
      // the biomes keep their own encounters
      expect(mysteryEncountersByBiome.get(BiomeId.FACTORY)).toContain(MysteryEncounterType.TINKATON_FORGE);
      expect(mysteryEncountersByBiome.get(BiomeId.CONSTRUCTION_SITE)).toContain(MysteryEncounterType.TINKATON_FORGE);
      expect(mysteryEncountersByBiome.get(BiomeId.FACTORY)).toContain(MysteryEncounterType.TRASH_TO_TREASURE);
    });

    it("sets up a shiny-locked G-Max Melmetal boss with one more segment, its four moves and its opening", async () => {
      const loadMoves = vi.spyOn(EncounterPhaseUtils, "loadCustomMovesForEncounter");
      await startEncounter();
      const encounter = scene.currentBattle.mysteryEncounter!;
      expect(encounter.enemyPartyConfigs).toHaveLength(1);
      const [config] = encounter.enemyPartyConfigs;
      expect(config.levelAdditiveModifier).toBe(0.5);
      expect(config.disableSwitch).toBe(true);
      expect(config.pokemonConfigs).toHaveLength(1);
      const [boss] = config.pokemonConfigs!;
      expect(boss).toMatchObject({ isBoss: true, shiny: false, formIndex: 1, bossSegmentModifier: 1 });
      expect(boss.species.speciesId).toBe(SpeciesId.MELMETAL);
      expect(speciesDataRegistry.getSpecies(SpeciesId.MELMETAL).forms[1].formKey).toBe(SpeciesFormKey.GIGANTAMAX);
      expect(boss.moveSet).toEqual([
        MoveId.DOUBLE_IRON_BASH,
        MoveId.HEAVY_SLAM,
        MoveId.THUNDER_PUNCH,
        MoveId.ACID_ARMOR,
      ]);
      expect(loadMoves).toHaveBeenCalledWith([MoveId.ACID_ARMOR, MoveId.METAL_SOUND]);
      for (const move of [...SCRAP_TREASURE_BOSS_MOVES, ...SCRAP_TREASURE_OPENING_MOVES]) {
        expect(allMoves[move].isUnimplemented, MoveId[move]).toBe(false);
      }

      const effects = getScrapTreasureOpeningEffects();
      expect(effects.map(e => e.move.moveId)).toEqual([MoveId.ACID_ARMOR, MoveId.METAL_SOUND]);
      expect(effects.map(e => e.targets)).toEqual([[BattlerIndex.ENEMY], [BattlerIndex.PLAYER]]);
      for (const e of effects) {
        expect(e.sourceBattlerIndex).toBe(BattlerIndex.ENEMY);
        expect(e.useMode).toBe(MoveUseMode.IGNORE_PP);
      }
    });
  });

  describe("option 1 - find out what the heap is", () => {
    it("starts a battle against G-Max Melmetal, which uses Acid Armor and Metal Sound before turn 1", async () => {
      const phaseSpy = vi.spyOn(scene.phaseManager, "pushPhase");
      await startEncounter();
      await runMysteryEncounterToEnd(game, 1, undefined, true);

      const enemyField = scene.getEnemyField();
      expect(game).toBeAtPhase("CommandPhase");
      expect(enemyField).toHaveLength(1);
      const [melmetal] = enemyField;
      expect(melmetal.species.speciesId).toBe(SpeciesId.MELMETAL);
      expect(melmetal.getFormKey()).toBe(SpeciesFormKey.GIGANTAMAX);
      expect(melmetal.isBoss()).toBe(true);
      expect(melmetal.shiny).toBe(false);
      expect(melmetal.moveset.map(m => m.moveId)).toEqual([...SCRAP_TREASURE_BOSS_MOVES]);

      const movePhases = phaseSpy.mock.calls.map(c => c[0]).filter((p): p is MovePhase => p instanceof MovePhase);
      expect(movePhases.map(p => p.move.moveId)).toEqual([MoveId.ACID_ARMOR, MoveId.METAL_SOUND]);
      for (const p of movePhases) {
        expect(p.pokemon).toBe(melmetal);
      }
      // Acid Armor on itself, Metal Sound on the player's side
      expect(movePhases.map(p => p.targets)).toEqual([[BattlerIndex.ENEMY], [BattlerIndex.PLAYER]]);
    });

    it("rewards the Melmetalite to a party with a Melmetal and the Mega Bracelet, then a Rogue and an Ultra item", async () => {
      await startEncounter([SpeciesId.MELMETAL, SpeciesId.GENGAR, SpeciesId.ABRA]);
      giveMegaBracelet();
      await runMysteryEncounterToEnd(game, 1, undefined, true);
      await skipBattleRunMysteryEncounterRewardsPhase(game);
      await game.phaseInterceptor.to("SelectModifierPhase", false);
      expect(game).toBeAtPhase("SelectModifierPhase");
      await game.phaseInterceptor.to("SelectModifierPhase");

      expect(scene.ui.mode).toBe(UiMode.MODIFIER_SELECT);
      const handler = scene.ui.handlers.find(h => h instanceof ModifierSelectUiHandler) as ModifierSelectUiHandler;
      const options = handler.options.map(o => o.modifierTypeOption);
      expect(options).toHaveLength(3);
      expect(formItemOf(options[0])).toBe(FormChangeItem.MELMETALITE);
      expect(options[0].type.tier).toBe(ModifierTier.ROGUE);
      expect(options[1].type.tier).toBe(ModifierTier.ROGUE);
      expect(options[2].type.tier).toBe(ModifierTier.ULTRA);
      expect(new Set(options.map(o => o.type.name)).size).toBe(3);
      expect((handler as any).rerollCost).toBeGreaterThan(0);
    });

    it("gives a form-change item only a party member can use: Mega Stones with the bracelet, else the ordinary ones", async () => {
      const [lapras, gengar, abra] = await startEncounter();
      expect(scene.getModifiers(MegaEvolutionAccessModifier)).toHaveLength(0);
      // nobody can use one without the bracelet or the Dynamax Band (Lapras and Gengar only have G-Max / Mega forms)
      for (let i = 0; i < 10; i++) {
        scene.setSeed(`scrap-none-${i}`);
        scene.resetSeed(1);
        expect(getScrapTreasureFormChangeReward()).toBeNull();
      }

      // with the bracelet: Gengar's Mega Stone, the only one this party can use
      giveMegaBracelet();
      for (let i = 0; i < 10; i++) {
        scene.setSeed(`scrap-mega-${i}`);
        scene.resetSeed(1);
        const reward = getScrapTreasureFormChangeReward();
        expect(formItemOf(reward)).toBe(FormChangeItem.GENGARITE);
        expect(reward!.type.tier).toBe(ModifierTier.ROGUE);
        expect([lapras, gengar, abra].filter(p => p.isFormChangeItemCompatible(FormChangeItem.GENGARITE))).toEqual([
          gengar,
        ]);
      }
    });

    it("falls back to the ordinary form-change items (a Genesect's Drive) when no rare one fits", async () => {
      const [genesect] = await startEncounter([SpeciesId.GENESECT, SpeciesId.LAPRAS, SpeciesId.ABRA]);
      const drives = [
        FormChangeItem.SHOCK_DRIVE,
        FormChangeItem.BURN_DRIVE,
        FormChangeItem.CHILL_DRIVE,
        FormChangeItem.DOUSE_DRIVE,
      ];
      for (let i = 0; i < 10; i++) {
        scene.setSeed(`scrap-drive-${i}`);
        scene.resetSeed(1);
        const reward = getScrapTreasureFormChangeReward();
        const item = formItemOf(reward);
        expect(drives, `seed ${i}: ${item}`).toContain(item);
        expect(genesect.isFormChangeItemCompatible(item!)).toBe(true);
        expect(reward!.type.tier).toBe(ModifierTier.ULTRA);
      }
    });

    it("only names the Melmetalite with the bracelet and while the Melmetal holds none", async () => {
      const [melmetal] = await startEncounter([SpeciesId.MELMETAL, SpeciesId.LAPRAS, SpeciesId.ABRA]);
      // a Melmetal without the bracelet: no Melmetalite, and nothing else this party can use
      expect(canUseScrapMelmetalite()).toBe(false);
      expect(getScrapTreasureFormChangeReward()).toBeNull();
      giveMegaBracelet();
      expect(canUseScrapMelmetalite()).toBe(true);
      expect(formItemOf(getScrapTreasureFormChangeReward())).toBe(FormChangeItem.MELMETALITE);
      // once it holds one, not again
      const melmetalite = generateModifierType(modifierTypes.RARE_FORM_CHANGE_ITEM, [FormChangeItem.MELMETALITE])!;
      scene.addModifier(melmetalite.newModifier(melmetal), true);
      expect(canUseScrapMelmetalite()).toBe(false);
      expect(formItemOf(getScrapTreasureFormChangeReward())).not.toBe(FormChangeItem.MELMETALITE);
    });

    it("puts a Rogue item in the form-change item's place when nobody can use one, all different, Golden Balls filled", async () => {
      await startEncounter();
      expect(SCRAP_TREASURE_WIN_TIERS).toEqual([ModifierTier.ROGUE, ModifierTier.ULTRA]);
      const names = (options: ModifierTypeOption[]) => options.map(o => o.type.name);
      for (let i = 0; i < 20; i++) {
        scene.setSeed(`scrap-rewards-${i}`);
        scene.resetSeed(1);
        const options = rollScrapTreasureRewards();
        expect(options, `seed ${i}`).toHaveLength(3);
        expect(options.map(o => o.type.tier)).toEqual([ModifierTier.ROGUE, ModifierTier.ROGUE, ModifierTier.ULTRA]);
        expect(options.every(o => o.upgradeCount === 0)).toBe(true);
        expect(new Set(names(options)).size, `seed ${i}: ${names(options)}`).toBe(3);
      }
      scene.addModifier(generateModifierType(modifierTypes.GOLDEN_POKEBALL)!.newModifier(), true);
      const four = rollScrapTreasureRewards();
      expect(four).toHaveLength(4);
      expect(new Set(names(four)).size).toBe(4);
    });
  });

  describe("option 2 - dig through the heap", () => {
    it("finds a vest on a roll under 60: one party member gets an Assault or a Bulletproof Vest, then the shop", async () => {
      const party = await startEncounter();
      expect(SCRAP_TREASURE_DIG_FIND_CHANCE).toBe(60);
      expect(SCRAP_TREASURE_DIG_REWARDS.map(r => r.id)).toEqual(["ASSAULT_VEST", "BULLETPROOF_VEST"]);
      vi.spyOn(scrapTreasureDice, "rollDig").mockReturnValue(SCRAP_TREASURE_DIG_FIND_CHANCE - 1);
      const leave = vi.spyOn(EncounterPhaseUtils, "leaveEncounterWithoutBattle");

      await runMysteryEncounterToEnd(game, 2);

      expect(game).toBeAtPhase("SelectModifierPhase");
      const vests = party.flatMap(p => vestsOf(p));
      expect(vests).toHaveLength(1);
      expect(vests[0].getStackCount()).toBe(1);
      expect(party.filter(p => p.isFainted())).toHaveLength(0);
      expect(leave).toHaveBeenCalledWith(true);
      expect(logsInclude("You found something")).toBe(true);
      expect(logsInclude(`received\n${vests[0].type.name}!`)).toBe(true);
    });

    it("gives the vest to a party member with room", async () => {
      const [lapras, gengar, abra] = await startEncounter();
      fillVests(lapras);
      fillVests(gengar);
      vi.spyOn(scrapTreasureDice, "rollDig").mockReturnValue(0);

      await runMysteryEncounterToEnd(game, 2);

      expect(vestStacks(lapras)).toBe(6);
      expect(vestStacks(gengar)).toBe(6);
      expect(vestStacks(abra)).toBe(1);
    });

    it("hands out the stack-full stand-in when everyone already holds both vests", async () => {
      const party = await startEncounter();
      for (const p of party) {
        fillVests(p);
      }
      const balls = ballTotal();
      vi.spyOn(scrapTreasureDice, "rollDig").mockReturnValue(0);

      await runMysteryEncounterToEnd(game, 2);

      expect(party.map(p => vestStacks(p))).toEqual([6, 6, 6]);
      expect(ballTotal()).toBeGreaterThan(balls);
      expect(party.filter(p => p.isFainted())).toHaveLength(0);
    });

    it("collapses on a roll of 60 or more: the highest-level party member able to battle faints, nothing gained", async () => {
      const [lapras, gengar, abra] = await startEncounter();
      lapras.level = 50;
      gengar.level = 70;
      abra.level = 60;
      vi.spyOn(scrapTreasureDice, "rollDig").mockReturnValue(SCRAP_TREASURE_DIG_FIND_CHANCE);
      const leave = vi.spyOn(EncounterPhaseUtils, "leaveEncounterWithoutBattle");

      await runMysteryEncounterToEnd(game, 2);

      expect(game).toBeAtPhase("SelectModifierPhase");
      expect(gengar.isFainted()).toBe(true);
      expect(gengar.hp).toBe(0);
      expect(gengar.status?.effect).toBe(StatusEffect.FAINT);
      expect(lapras.isFainted()).toBe(false);
      expect(abra.isFainted()).toBe(false);
      expect([lapras, gengar, abra].flatMap(p => vestsOf(p))).toHaveLength(0);
      expect(leave).toHaveBeenCalledWith(true);
      expect(logsInclude("The scrap heap caved in!")).toBe(true);
      expect(logsInclude("Gengar was buried")).toBe(true);
    });

    it("never picks a fainted Pokémon for the collapse", async () => {
      const [lapras, gengar, abra] = await startEncounter([
        SpeciesId.LAPRAS,
        SpeciesId.GENGAR,
        SpeciesId.ABRA,
        SpeciesId.MAGIKARP,
      ]);
      lapras.level = 50;
      gengar.level = 90;
      gengar.hp = 0;
      gengar.doSetStatus(StatusEffect.FAINT);
      abra.level = 70;
      vi.spyOn(scrapTreasureDice, "rollDig").mockReturnValue(99);

      await runMysteryEncounterToEnd(game, 2);

      expect(abra.isFainted()).toBe(true);
      expect(lapras.isFainted()).toBe(false);
    });
  });

  describe("option 3 - leave", () => {
    it("leaves with nothing: no item, no faint, no reward screen or shop", async () => {
      const party = await startEncounter();
      const dig = vi.spyOn(scrapTreasureDice, "rollDig");
      const leave = vi.spyOn(EncounterPhaseUtils, "leaveEncounterWithoutBattle");
      const newPhase = vi.spyOn(scene.phaseManager, "unshiftNew");

      await runMysteryEncounterToEnd(game, 3);

      expect(dig).not.toHaveBeenCalled();
      expect(leave).toHaveBeenCalledTimes(1);
      expect(leave.mock.calls[0][0] ?? false).toBe(false);
      expect(scene.currentBattle.mysteryEncounter!.doEncounterRewards).toBeUndefined();
      expect(newPhase.mock.calls.some(([name]) => name === "SelectModifierPhase")).toBe(false);
      expect(party.flatMap(p => p.getHeldItems())).toHaveLength(0);
      expect(party.filter(p => p.isFainted())).toHaveLength(0);
    });
  });

  describe("forced Endless spawn on waves 809, 1809, ...", () => {
    const setMode = (mode: GameModes) => {
      scene.gameMode = getGameMode(mode);
    };

    /** A session seed whose roll on `wave` comes out as `hit` */
    function findSeed(hit: boolean, wave = 809): string {
      for (let i = 0; i < 2000; i++) {
        const seed = `scrap-spawn-${i}`;
        scene.setSeed(seed);
        if (isScrapTreasureWave(wave) === hit) {
          return seed;
        }
      }
      throw new Error(`no seed with ${hit} on wave ${wave}`);
    }

    it("rolls 81/1000 on waves % 1000 === 809 of Endless and Spliced Endless", () => {
      expect(SCRAP_TREASURE_SPAWN_CHANCE).toBe(81);
      for (const mode of [GameModes.ENDLESS, GameModes.SPLICED_ENDLESS]) {
        setMode(mode);
        for (const wave of [809, 1809, 2809, 5809, 10809]) {
          expect(getScrapTreasureWaveChance(wave), `wave ${wave}`).toBe(81 / 1000);
        }
        for (const wave of [80, 808, 810, 777, 1000, 1080, 8090, 249]) {
          expect(getScrapTreasureWaveChance(wave), `wave ${wave}`).toBe(0);
        }
      }
    });

    it("never happens outside Endless", () => {
      for (const mode of [GameModes.CLASSIC, GameModes.CHALLENGE, GameModes.DAILY]) {
        setMode(mode);
        expect(getScrapTreasureWaveChance(809)).toBe(0);
        for (let i = 0; i < 100; i++) {
          scene.setSeed(`scrap-mode-${i}`);
          expect(isScrapTreasureWave(809)).toBe(false);
        }
      }
    });

    it("gives the same answer for the same seed and wave, about 81 times in 1000, without touching the running RNG", () => {
      setMode(GameModes.ENDLESS);
      let hits = 0;
      const trials = 3000;
      for (let i = 0; i < trials; i++) {
        scene.setSeed(`scrap-roll-${i}`);
        const state = Phaser.Math.RND.state();
        const first = isScrapTreasureWave(809);
        expect(Phaser.Math.RND.state()).toBe(state);
        expect(isScrapTreasureWave(809)).toBe(first);
        hits += Number(first);
      }
      // expected 243
      expect(hits).toBeGreaterThan(170);
      expect(hits).toBeLessThan(320);
    });

    it("rolls on its own seed offset (3 modulo 8), which never meets the other rolls", () => {
      setMode(GameModes.ENDLESS);
      const offsets = vi.spyOn(scene, "executeWithSeedOffset");
      isScrapTreasureWave(1809);
      expect(offsets).toHaveBeenCalledWith(expect.any(Function), getScrapTreasureSeedOffset(1809));
      expect(getScrapTreasureSeedOffset(1809)).toBe(1809 * 3000 + 811);

      // offsets give the same seed exactly when they are equal modulo 65536: compare against every residue the
      // encounter roll (3000a), the GTS? roll (3000a + 1500), the encounter pick (16a) and the chest (3000w + 777) use
      const residues = (offset: (a: number) => number): Set<number> => {
        const set = new Set<number>();
        for (let a = 0; a < 65536; a++) {
          set.add(offset(a) % 65536);
        }
        return set;
      };
      const others = [
        residues(a => a * 3000),
        residues(a => a * 3000 + 1500),
        residues(a => a * 16),
        residues(a => getDarkChestSeedOffset(a)),
      ];
      for (let k = 0; k <= 300; k++) {
        const offset = getScrapTreasureSeedOffset(809 + 1000 * k);
        expect(offset % 8).toBe(3);
        for (const other of others) {
          expect(other.has(offset % 65536), `wave ${809 + 1000 * k}`).toBe(false);
        }
      }
    });

    it("forces its wave into the encounter, after the GTS? and the chest, only with 3 Pokémon able to battle", async () => {
      game.override.mysteryEncounterChance(0);
      await game.classicMode.startBattle(SpeciesId.LAPRAS, SpeciesId.GENGAR, SpeciesId.ABRA);
      setMode(GameModes.ENDLESS);
      const isWaveMysteryEncounter = (type: BattleType, wave: number): boolean =>
        (scene as any).isWaveMysteryEncounter(type, wave);

      expect(SPECIAL_ENCOUNTER_SPAWNS.map(s => s.type)).toEqual([
        MysteryEncounterType.DARK_GLOBAL_TRADE_SYSTEM,
        MysteryEncounterType.DARK_MYSTERIOUS_CHEST,
        MysteryEncounterType.SCRAP_TREASURE,
      ]);
      scene.setSeed(findSeed(true));
      expect(getForcedSpecialEncounter(809)).toBe(MysteryEncounterType.SCRAP_TREASURE);
      expect(isWaveMysteryEncounter(BattleType.TRAINER, 809)).toBe(true);
      expect(isWaveMysteryEncounter(BattleType.WILD, 809)).toBe(true);
      scene.currentBattle.waveIndex = 809;
      expect(scene.getMysteryEncounter().encounterType).toBe(MysteryEncounterType.SCRAP_TREASURE);
      // a saved wave keeps its own encounter, and the biome stays
      expect(scene.getMysteryEncounter(MysteryEncounterType.TRASH_TO_TREASURE).encounterType).toBe(
        MysteryEncounterType.TRASH_TO_TREASURE,
      );
      expect(scene.isNewBiome()).toBe(false);

      // with two Pokémon able to battle the wave stays ordinary
      scene.getPlayerParty()[2].hp = 0;
      expect(getForcedSpecialEncounter(809)).toBeNull();
      scene.getPlayerParty()[2].hp = 1;
      expect(getForcedSpecialEncounter(809)).toBe(MysteryEncounterType.SCRAP_TREASURE);

      // a seed that misses leaves the wave to the normal rolls
      scene.setSeed(findSeed(false));
      expect(getForcedSpecialEncounter(809)).toBeNull();
    });
  });

  describe("text", () => {
    it("has the same keys in Korean and English, and the user's tooltips", () => {
      const ko = dialogueFiles["../../../locales/ko/mystery-encounters/scrap-treasure-dialogue.json"] as any;
      const en = dialogueFiles["../../../locales/en/mystery-encounters/scrap-treasure-dialogue.json"] as any;
      const keys = (obj: any, prefix = ""): string[] =>
        Object.entries(obj).flatMap(([k, v]) =>
          v != null && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
        );
      expect(keys(ko).sort()).toEqual(keys(en).sort());
      expect(ko.title).toBe("고철 속 보물");
      expect(ko.option["1"].label).toBe("고철 더미의 정체를 밝힌다");
      expect(ko.option["1"].tooltip).toBe("(-) 매우 어려운 배틀\n(+) 특별한 보상");
      expect(ko.option["2"].label).toBe("고철 더미를 뒤진다");
      expect(ko.option["2"].tooltip).toBe("(-) ???\n(+) 조끼?");
    });

    /**
     * Every Korean text the encounter puts on screen, captured from the encounter screen (getEncounterText), the
     * message boxes and the test text log: no raw keys, no {{ }} or [[ ]] left.
     */
    describe("in Korean", () => {
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

      const textsOf = (f: string) =>
        captured
          .filter(c => c.flow === f)
          .map(c => c.text)
          .join("\n");

      it("shows the screen's strings", async () => {
        flow = "screen";
        await startEncounter();
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
        const texts = textsOf(flow);
        for (const expected of [
          "거대한 고철 더미가 길을 막고 있다…\n방금 움직인 것 같은데?",
          "고철 속 보물",
          "어떻게 하시겠습니까?",
          "고철 더미의 정체를 밝힌다",
          "(-) 매우 어려운 배틀\n(+) 특별한 보상",
          "고철 더미를 뒤진다",
          "(-) ???\n(+) 조끼?",
          "떠난다",
        ]) {
          expect(texts).toContain(expected);
        }
      });

      it("option 2: the find and the vest", async () => {
        flow = "found";
        const [lapras, gengar] = await startEncounter();
        fillVests(lapras);
        fillVests(gengar);
        vi.spyOn(scrapTreasureDice, "rollDig").mockReturnValue(0);
        await runMysteryEncounterToEnd(game, 2);
        const texts = textsOf(flow);
        expect(texts).toContain("고철 더미 속에서\n무언가를 찾아냈다!");
        expect(texts).toMatch(/캐이시는\n(돌격조끼|방탄조끼)를 얻었다!/);
      });

      it("option 2: the collapse", async () => {
        flow = "collapse";
        const [lapras, gengar, abra] = await startEncounter();
        lapras.level = 10;
        gengar.level = 30;
        abra.level = 20;
        vi.spyOn(scrapTreasureDice, "rollDig").mockReturnValue(99);
        await runMysteryEncounterToEnd(game, 2);
        expect(textsOf(flow)).toContain(
          "와르르! 고철 더미가 무너져 내렸다!$팬텀이 고철에 깔려\n쓰러지고 말았다…$아무것도 얻지 못했다…",
        );
      });

      it("leaves no raw key, {{ }} or [[ ]] in anything it showed", () => {
        expect(captured.length).toBeGreaterThan(10);
        for (const { flow: f, text } of captured) {
          expect(text, `${f}: ${text}`).not.toMatch(/\{\{|\}\}|\[\[|\]\]/);
          expect(text, `${f}: ${text}`).not.toContain("scrapTreasure");
          expect(text, `${f}: ${text}`).not.toContain("mysteryEncounters/");
        }
      });
    });
  });
});
