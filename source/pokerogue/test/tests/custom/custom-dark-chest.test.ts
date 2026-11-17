import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { GameModes } from "#enums/game-modes";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { BATTLE_STATS, Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import type { ModifierTypeOption } from "#modifiers/modifier-type";
import { PokemonNatureChangeModifierType } from "#modifiers/modifier-type";
import * as DarkGtsSpawn from "#mystery-encounters/dark-gts-spawn";
import {
  DARK_CHEST_COIN_PRICE_MULTIPLIER,
  DARK_CHEST_COIN_TIERS,
  DARK_CHEST_TRAP_PENALTY,
  DARK_CHEST_TRAP_PERCENT,
  DARK_CHEST_TRAP_WIN_TIERS,
  DARK_CHEST_TREASURE_TIERS,
  DarkMysteriousChestEncounter,
  getDarkChestCoinPrice,
  getDarkChestRewardCount,
  getDarkChestTrapLead,
  rollDarkChestRewards,
} from "#mystery-encounters/dark-mysterious-chest-encounter";
import * as EncounterDialogueUtils from "#mystery-encounters/encounter-dialogue-utils";
import * as EncounterPhaseUtils from "#mystery-encounters/encounter-phase-utils";
import { generateModifierType } from "#mystery-encounters/encounter-phase-utils";
import { allMysteryEncounters, mysteryEncountersByBiome } from "#mystery-encounters/mystery-encounter-biomes";
import {
  MoneyRequirement,
  PartySizeRequirement,
  WaveRangeRequirement,
} from "#mystery-encounters/mystery-encounter-requirements";
import {
  DARK_CHEST_SPAWN_CHANCE,
  getDarkChestSeedOffset,
  getDarkChestWaveChance,
  getForcedSpecialEncounter,
  isDarkChestWave,
  SPECIAL_ENCOUNTER_SPAWNS,
} from "#mystery-encounters/special-spawns";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { TextInterceptor } from "#test/framework/text-interceptor";
import { runMysteryEncounterToEnd, skipBattleRunMysteryEncounterRewardsPhase } from "#test/utils/encounter-test-utils";
import { generateStarters } from "#test/utils/game-manager-utils";
import { MessageUiHandler } from "#ui/message-ui-handler";
import { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import type { MysteryEncounterUiHandler } from "#ui/mystery-encounter-ui-handler";
import * as Utils from "#utils/common";
import i18next from "i18next";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const namespace = "mysteryEncounters/darkMysteriousChest";
const defaultParty = [SpeciesId.LAPRAS, SpeciesId.GENGAR, SpeciesId.ABRA];
const defaultBiome = BiomeId.CAVE;
const defaultWave = 45;
const koFiles = import.meta.glob("../../../locales/ko/**/*.json", { eager: true, import: "default" });

/**
 * Local fork, the user's design of 2026-11-08: the ROGUE-tier "Mysterious Chest?" (DARK_MYSTERIOUS_CHEST). Option 1
 * is a 40% Gholdengo trap (since 2026-11-12 no KO: the lead loses half its HP and fights at -1 in every stat; catchable
 * boss, a Rogue item for winning) or 60% one of Master + 2 Rogue items;
 * option 2 pays the wave's money x10 for one of 2 Rogue + 1 Ultra items; option 3 leaves with a Relic Gold. In
 * Endless, waves 777, 1777, ... are forced into it 77 times in 1000 (special-spawns.ts).
 */
describe("Custom mystery encounter - Mysterious Chest? (DARK_MYSTERIOUS_CHEST)", () => {
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
    await game.runToMysteryEncounter(MysteryEncounterType.DARK_MYSTERIOUS_CHEST, party);
    scene.modifiers = [];
    await scene.updateModifiers(true);
    return scene.getPlayerParty();
  }

  /**
   * Makes option 1's chest roll (`randSeedInt(100)` in its pre-option phase) come out as `roll`; every other call
   * draws as usual. The tests check `misc.roll` afterwards, so a different call taking it would show.
   */
  function forceChestRoll(roll: number): void {
    const original = Utils.randSeedInt;
    let armed = true;
    vi.spyOn(Utils, "randSeedInt").mockImplementation((range: number, min = 0) => {
      if (armed && range === 100 && min === 0) {
        armed = false;
        return roll;
      }
      return original(range, min);
    });
  }

  /** Runs from the end of the option to the reward screen and returns its handler */
  async function toRewardScreen(): Promise<ModifierSelectUiHandler> {
    await game.phaseInterceptor.to("SelectModifierPhase");
    expect(scene.ui.mode).toBe(UiMode.MODIFIER_SELECT);
    return scene.ui.handlers.find(h => h instanceof ModifierSelectUiHandler) as ModifierSelectUiHandler;
  }

  const optionsOf = (handler: ModifierSelectUiHandler): ModifierTypeOption[] =>
    handler.options.map(o => o.modifierTypeOption);
  const namesOf = (options: ModifierTypeOption[]) => options.map(o => o.type.name);
  const tiersOf = (options: ModifierTypeOption[]) => options.map(o => o.type.tier);
  const faintedOf = () => scene.getPlayerParty().filter(p => p.isFainted());
  /** The HP the trap leaves: half the max HP taken (rounded down), never below 1 */
  const hpAfterTrap = (p: PlayerPokemon, hpBefore: number) =>
    Math.max(1, hpBefore - Math.floor((p.getMaxHp() * DARK_CHEST_TRAP_PENALTY.hpLossPercent) / 100));
  /** Every battle stat stage of `p`, in BATTLE_STATS order */
  const stagesOf = (p: PlayerPokemon) => BATTLE_STATS.map(s => p.getStatStage(s));
  /** -1 Attack, Defense, Sp. Atk, Sp. Def and Speed; accuracy and evasion untouched */
  const trapStages = BATTLE_STATS.map(s =>
    [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD].includes(s) ? -1 : 0,
  );

  describe("registration", () => {
    it("is a ROGUE-tier encounter after the GTS? with three options, both chest sprites and its text", async () => {
      await startEncounter();

      expect(MysteryEncounterType.DARK_MYSTERIOUS_CHEST).toBe(MysteryEncounterType.DARK_GLOBAL_TRADE_SYSTEM + 1);
      expect(allMysteryEncounters[MysteryEncounterType.DARK_MYSTERIOUS_CHEST]).toBe(DarkMysteriousChestEncounter);
      expect(DarkMysteriousChestEncounter.encounterTier).toBe(MysteryEncounterTier.ROGUE);
      expect(DarkMysteriousChestEncounter.options).toHaveLength(3);
      expect(DarkMysteriousChestEncounter.catchAllowed).toBe(true);
      expect(DarkMysteriousChestEncounter.spriteConfigs.map(c => [c.spriteKey, c.fileRoot])).toEqual([
        ["dark_mysterious_chest_blue", "mystery-encounters"],
        ["dark_mysterious_chest_red", "mystery-encounters"],
      ]);
      // the official chest's requirements: its wave range and 2 Pokémon able to battle
      const [waveRange, partySize] = DarkMysteriousChestEncounter.requirements;
      expect(DarkMysteriousChestEncounter.requirements).toHaveLength(2);
      expect(waveRange).toBeInstanceOf(WaveRangeRequirement);
      expect(partySize).toBeInstanceOf(PartySizeRequirement);
      expect((partySize as PartySizeRequirement).partySizeRange).toEqual([2, 6]);
      expect((partySize as PartySizeRequirement).excludeDisallowedPokemon).toBe(true);
      expect(DarkMysteriousChestEncounter.options.map(o => o.optionMode)).toEqual([
        MysteryEncounterOptionMode.DEFAULT,
        MysteryEncounterOptionMode.DISABLED_OR_DEFAULT,
        MysteryEncounterOptionMode.DEFAULT,
      ]);
      expect(i18next.t(`${namespace}:title`)).toBe("Mysterious Chest?");
      expect(i18next.t(`${namespace}:option.3.label`)).toBe("A bad feeling... Leave");
      expect(scene.currentBattle.mysteryEncounter?.encounterType).toBe(MysteryEncounterType.DARK_MYSTERIOUS_CHEST);
    });

    it("spawns in the Ruins, the Temple, the Graveyard and the Abyss, and nowhere else", () => {
      const expected = new Set<BiomeId>([BiomeId.RUINS, BiomeId.TEMPLE, BiomeId.GRAVEYARD, BiomeId.ABYSS]);
      for (const biome of expected) {
        expect(mysteryEncountersByBiome.get(biome), `biome ${BiomeId[biome]}`).toContain(
          MysteryEncounterType.DARK_MYSTERIOUS_CHEST,
        );
      }
      for (const [biome, encounters] of mysteryEncountersByBiome) {
        if (!expected.has(biome)) {
          expect(encounters, `biome ${BiomeId[biome]}`).not.toContain(MysteryEncounterType.DARK_MYSTERIOUS_CHEST);
        }
      }
      // the biomes keep their own encounters
      expect(mysteryEncountersByBiome.get(BiomeId.ABYSS)).toContain(MysteryEncounterType.DARK_GLOBAL_TRADE_SYSTEM);
      expect(mysteryEncountersByBiome.get(BiomeId.RUINS)).toContain(MysteryEncounterType.DANCING_LESSONS);
    });

    it("sets up a Gholdengo boss with the official trap's level rule, one more boss segment and its four moves", async () => {
      await startEncounter();
      const encounter = scene.currentBattle.mysteryEncounter!;
      expect(encounter.enemyPartyConfigs).toHaveLength(1);
      const [config] = encounter.enemyPartyConfigs;
      expect(config.levelAdditiveModifier).toBe(0.5);
      expect(config.disableSwitch).toBe(true);
      expect(config.pokemonConfigs).toHaveLength(1);
      const [gholdengo] = config.pokemonConfigs!;
      expect(gholdengo.species.speciesId).toBe(SpeciesId.GHOLDENGO);
      expect(gholdengo.isBoss).toBe(true);
      expect(gholdengo.bossSegmentModifier).toBe(1);
      expect(gholdengo.moveSet).toEqual([MoveId.MAKE_IT_RAIN, MoveId.NASTY_PLOT, MoveId.SHADOW_BALL, MoveId.THIEF]);
      // every move is implemented, none only partly
      for (const move of gholdengo.moveSet!) {
        expect(allMoves[move].isUnimplemented, MoveId[move]).toBe(false);
        expect(allMoves[move].name, MoveId[move]).not.toMatch(/\((N|P)\)/);
      }
      expect(encounter.dialogueTokens.gholdengoName).toBe("Gholdengo");
    });
  });

  describe("option 1 - open the chest", () => {
    it("rolls the trap below 40 and the treasure from 40 up", () => {
      expect(DARK_CHEST_TRAP_PERCENT).toBe(40);
      expect(DARK_CHEST_TREASURE_TIERS).toEqual([ModifierTier.MASTER, ModifierTier.ROGUE, ModifierTier.ROGUE]);
      expect(DARK_CHEST_TRAP_WIN_TIERS).toEqual([ModifierTier.ROGUE]);
    });

    // Local fork (2026-11-12), the user: "선봉 포켓몬이 hp를 50%를 깎이고, 올랭크 -1인채 전투하는걸로 하죠, 즉사보단."
    it("trap price: the lead loses 50% of its max HP and fights at -1 Attack, Defense, Sp. Atk, Sp. Def and Speed", () => {
      expect(DARK_CHEST_TRAP_PENALTY).toEqual({
        hpLossPercent: 50,
        statStages: -1,
        stats: [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD],
      });
      expect(Object.isFrozen(DARK_CHEST_TRAP_PENALTY)).toBe(true);
      expect(Object.isFrozen(DARK_CHEST_TRAP_PENALTY.stats)).toBe(true);
    });

    it("trap: nobody faints, the lead (not the highest level) loses half its HP and starts the battle at -1, the chest turns red, the catchable Gholdengo battle starts", async () => {
      const [lapras, gengar, abra] = await startEncounter();
      gengar.level = lapras.level + 5;
      for (const p of [lapras, gengar, abra]) {
        p.calculateStats();
        p.hp = p.getMaxHp();
      }
      expect(getDarkChestTrapLead()).toBe(lapras);
      forceChestRoll(DARK_CHEST_TRAP_PERCENT - 1);
      const encounter = scene.currentBattle.mysteryEncounter!;
      const redChest = vi.spyOn(encounter.introVisuals!.getSpriteAtIndex(1)[0], "setAlpha");
      const chestConfigs = encounter.introVisuals!.spriteConfigs;

      await runMysteryEncounterToEnd(game, 1, undefined, true);

      expect(encounter.misc.roll).toBe(DARK_CHEST_TRAP_PERCENT - 1);
      expect(faintedOf()).toHaveLength(0);
      expect(lapras.hp).toBe(hpAfterTrap(lapras, lapras.getMaxHp()));
      expect(lapras.hp).toBe(Math.ceil(lapras.getMaxHp() / 2));
      expect(gengar.hp).toBe(gengar.getMaxHp());
      expect(abra.hp).toBe(abra.getMaxHp());
      // the lead is the one on the field, already at -1 in the five stats before turn 1
      expect(scene.getPlayerField()).toEqual([lapras]);
      expect(stagesOf(lapras)).toEqual(trapStages);
      expect(stagesOf(gengar).every(s => s === 0)).toBe(true);
      expect(game.phaseInterceptor.phaseLog).toContain("StatStageChangePhase");
      // the red chest was shown over the black one, and the chest opened
      expect(redChest).toHaveBeenCalledWith(1);
      expect(chestConfigs.map(c => c.disableAnimation)).toEqual([false, false]);

      const enemies = scene.getEnemyField();
      expect(enemies).toHaveLength(1);
      const [boss] = enemies;
      expect(boss.species.speciesId).toBe(SpeciesId.GHOLDENGO);
      expect(boss.isBoss()).toBe(true);
      expect(boss.bossSegments).toBe(
        scene.getEncounterBossSegments(scene.currentBattle.waveIndex, boss.level, boss.species, true) + 1,
      );
      expect(boss.moveset.map(m => m.moveId)).toEqual([
        MoveId.MAKE_IT_RAIN,
        MoveId.NASTY_PLOT,
        MoveId.SHADOW_BALL,
        MoveId.THIEF,
      ]);
      expect(encounter.catchAllowed).toBe(true);
      expect(game).toBeAtPhase("CommandPhase");
      expect(game.textInterceptor.logs.some(l => l.includes("It's a trap!"))).toBe(true);
      expect(game.textInterceptor.logs.some(l => l.includes("Gholdengo leaps out") && l.includes("Lapras"))).toBe(true);
      expect(game.textInterceptor.logs.some(l => l.includes("Lapras lost half of its HP!"))).toBe(true);
      expect(game.textInterceptor.logs.some(l => l.includes("lowered by one stage"))).toBe(true);
    });

    it("trap: leaves a lead at 1 HP when it has half its max HP or less, never fainting it", async () => {
      const [lapras] = await startEncounter();
      lapras.hp = Math.min(3, Math.floor(lapras.getMaxHp() / 2));
      forceChestRoll(0);

      await runMysteryEncounterToEnd(game, 1, undefined, true);

      expect(lapras.hp).toBe(1);
      expect(faintedOf()).toHaveLength(0);
      expect(scene.getPlayerField()).toEqual([lapras]);
      expect(stagesOf(lapras)).toEqual(trapStages);
      expect(game).toBeAtPhase("CommandPhase");
    });

    it("trap: the lead is the first party member able to battle, as the battle sends it out", async () => {
      const [lapras, gengar, abra] = await startEncounter();
      lapras.hp = 0;
      lapras.doSetStatus(StatusEffect.FAINT);
      gengar.hp = gengar.getMaxHp();
      expect(getDarkChestTrapLead()).toBe(gengar);
      forceChestRoll(0);

      await runMysteryEncounterToEnd(game, 1, undefined, true);

      expect(scene.getPlayerField()).toEqual([gengar]);
      expect(gengar.hp).toBe(hpAfterTrap(gengar, gengar.getMaxHp()));
      expect(stagesOf(gengar)).toEqual(trapStages);
      expect(abra.hp).toBe(abra.getMaxHp());
      expect(stagesOf(abra).every(s => s === 0)).toBe(true);
      // the one already fainted stays the only one fainted
      expect(faintedOf()).toEqual([lapras]);
    });

    it("trap: drops the stats once, only for the lead (a later entry or another Pokémon gets nothing)", async () => {
      const [lapras, gengar] = await startEncounter();
      forceChestRoll(0);
      await runMysteryEncounterToEnd(game, 1, undefined, true);
      const encounter = scene.currentBattle.mysteryEncounter!;
      expect(encounter.misc.trapLeadId).toBe(lapras.id);
      expect(encounter.misc.trapStatsDropped).toBe(true);

      const newPhase = vi.spyOn(scene.phaseManager, "unshiftNew");
      encounter.onPostSummon!(lapras);
      encounter.onPostSummon!(gengar);
      expect(newPhase.mock.calls.some(([name]) => name === "StatStageChangePhase")).toBe(false);
    });

    // A plain self-inflicted drop: nothing blocks, reflects or changes it, and nothing answers it (review: Defiant /
    // Competitive skip self-inflicted drops, so the lead really fights at -1)
    it.each([
      ["Contrary", AbilityId.CONTRARY],
      ["Simple", AbilityId.SIMPLE],
      ["Clear Body", AbilityId.CLEAR_BODY],
      ["Mirror Armor", AbilityId.MIRROR_ARMOR],
      ["Defiant", AbilityId.DEFIANT],
      ["Competitive", AbilityId.COMPETITIVE],
    ])("trap: a lead with %s still starts at -1 in the five stats", async (_name, ability) => {
      game.override.ability(ability).hasPassiveAbility(false);
      const [lapras] = await startEncounter();
      forceChestRoll(0);

      await runMysteryEncounterToEnd(game, 1, undefined, true);

      expect(lapras.getAbility().id).toBe(ability);
      expect(stagesOf(lapras)).toEqual(trapStages);
      // Mirror Armor sent nothing back
      const [boss] = scene.getEnemyField();
      expect(boss.getStatStages().every(s => s === 0)).toBe(true);
    });

    it("trap won: a Rogue item first, then the rest of an ordinary reward screen, all different, rerolls as usual", async () => {
      await startEncounter();
      forceChestRoll(0);
      await runMysteryEncounterToEnd(game, 1, undefined, true);
      expect(scene.currentBattle.mysteryEncounter!.misc.roll).toBe(0);

      await skipBattleRunMysteryEncounterRewardsPhase(game);
      await game.phaseInterceptor.to("SelectModifierPhase", false);
      const handler = await toRewardScreen();
      const options = optionsOf(handler);
      expect(options).toHaveLength(3);
      expect(options[0].type.tier).toBe(ModifierTier.ROGUE);
      expect(new Set(namesOf(options)).size).toBe(3);
      expect((handler as any).rerollCost).toBeGreaterThan(0);
    });

    it("treasure: exactly a Master and two Rogue items, all different, no reroll, no battle and nobody hurt", async () => {
      await startEncounter();
      forceChestRoll(DARK_CHEST_TRAP_PERCENT);
      const encounter = scene.currentBattle.mysteryEncounter!;
      const redChest = vi.spyOn(encounter.introVisuals!.getSpriteAtIndex(1)[0], "setAlpha");
      const battle = vi.spyOn(EncounterPhaseUtils, "initBattleWithEnemyConfig");

      await runMysteryEncounterToEnd(game, 1);

      expect(encounter.misc.roll).toBe(DARK_CHEST_TRAP_PERCENT);
      expect(faintedOf()).toHaveLength(0);
      expect(battle).not.toHaveBeenCalled();
      // the black chest opened, the red one stayed hidden
      expect(redChest).not.toHaveBeenCalledWith(1);
      expect(encounter.introVisuals!.spriteConfigs[0].disableAnimation).toBe(false);
      const handler = await toRewardScreen();
      const options = optionsOf(handler);
      expect(tiersOf(options)).toEqual([ModifierTier.MASTER, ModifierTier.ROGUE, ModifierTier.ROGUE]);
      expect(new Set(namesOf(options)).size).toBe(3);
      expect((handler as any).rerollCost).toBe(-1);
      expect(game.textInterceptor.logs.some(l => l.includes("The chest is full of treasure!"))).toBe(true);
    });
  });

  describe("reward rolls", () => {
    it("never repeat an item and keep their tiers, whatever the seed", async () => {
      await startEncounter();
      for (let i = 0; i < 25; i++) {
        scene.setSeed(`dark-chest-rewards-${i}`);
        scene.resetSeed(1);
        for (const tiers of [DARK_CHEST_TREASURE_TIERS, DARK_CHEST_COIN_TIERS]) {
          const options = rollDarkChestRewards(tiers);
          expect(tiersOf(options), `seed ${i}`).toEqual(tiers);
          expect(new Set(namesOf(options)).size, `seed ${i}: ${namesOf(options)}`).toBe(3);
          expect(options.every(o => o.upgradeCount === 0)).toBe(true);
        }
        const won = rollDarkChestRewards(DARK_CHEST_TRAP_WIN_TIERS, 3);
        expect(won[0].type.tier).toBe(ModifierTier.ROGUE);
        expect(new Set(namesOf(won)).size, `seed ${i}: ${namesOf(won)}`).toBe(3);
      }
    });

    it("fill the trap reward screen to an ordinary screen's size, Golden Poké Balls included", async () => {
      await startEncounter();
      expect(getDarkChestRewardCount()).toBe(3);
      scene.addModifier(generateModifierType(modifierTypes.GOLDEN_POKEBALL)!.newModifier(), true);
      expect(getDarkChestRewardCount()).toBe(4);
      const won = rollDarkChestRewards(DARK_CHEST_TRAP_WIN_TIERS, getDarkChestRewardCount());
      expect(won).toHaveLength(4);
      expect(new Set(namesOf(won)).size).toBe(4);
    });

    // Local fork (2026-11-08), review fix: every roll returns its mint as offered (the fork's mint rule), so a roll
    // thrown away as a second item of the "mint" group used up a nature that was never shown (23 of 25 at once here)
    it("count only the mints they show as offered, not the rolls they throw away", async () => {
      await startEncounter();
      scene.forkOfferedMintNatures.clear();
      // every roll is a mint: after the first, the next 50 tries per slot are thrown away for repeating its group
      game.override.itemRewards([{ name: "MINT" }]);
      const won = rollDarkChestRewards(DARK_CHEST_TRAP_WIN_TIERS, 3);
      const shown = won
        .filter(o => o.type instanceof PokemonNatureChangeModifierType)
        .map(o => (o.type as PokemonNatureChangeModifierType).getNature());
      expect(shown.length).toBeGreaterThan(0);
      expect([...scene.forkOfferedMintNatures].sort((a, b) => a - b)).toEqual([...shown].sort((a, b) => a - b));
    });
  });

  describe("option 2 - throw coins in", () => {
    it("costs the wave's money amount x10, shown in its tooltip token", async () => {
      await startEncounter();
      const cost = scene.getWaveMoneyAmount(10);
      expect(DARK_CHEST_COIN_PRICE_MULTIPLIER).toBe(10);
      expect(getDarkChestCoinPrice()).toBe(cost);
      const [requirement] = DarkMysteriousChestEncounter.options[1].requirements;
      expect(requirement).toBeInstanceOf(MoneyRequirement);
      expect((requirement as MoneyRequirement).scalingMultiplier).toBe(10);
      expect(scene.currentBattle.mysteryEncounter!.dialogueTokens.option2Money).toBe(cost.toString());
    });

    it("is disabled without the money, while the other options stay open", async () => {
      await startEncounter();
      const cost = getDarkChestCoinPrice();
      const [open, coins, leave] = DarkMysteriousChestEncounter.options;
      scene.money = cost - 10;
      expect(coins.meetsRequirements()).toBe(false);
      expect(open.meetsRequirements()).toBe(true);
      expect(leave.meetsRequirements()).toBe(true);
      scene.money = cost;
      expect(coins.meetsRequirements()).toBe(true);
    });

    it("takes the money and gives a pick of two Rogue items and an Ultra item, all different, with no trap", async () => {
      await startEncounter();
      const cost = getDarkChestCoinPrice();
      scene.money = cost + 123;
      const battle = vi.spyOn(EncounterPhaseUtils, "initBattleWithEnemyConfig");

      await runMysteryEncounterToEnd(game, 2);

      expect(scene.money).toBe(123);
      expect(battle).not.toHaveBeenCalled();
      expect(faintedOf()).toHaveLength(0);
      const handler = await toRewardScreen();
      const options = optionsOf(handler);
      expect(tiersOf(options)).toEqual([ModifierTier.ROGUE, ModifierTier.ROGUE, ModifierTier.ULTRA]);
      expect(new Set(namesOf(options)).size).toBe(3);
      expect((handler as any).rerollCost).toBe(-1);
      expect(game.textInterceptor.logs.some(l => l.includes("You throw in the coins"))).toBe(true);
    });
  });

  describe("option 3 - leave", () => {
    it("finds one Relic Gold (the wave's money x10), with no shop and no reward screen", async () => {
      await startEncounter();
      const leave = vi.spyOn(EncounterPhaseUtils, "leaveEncounterWithoutBattle");
      const newPhase = vi.spyOn(scene.phaseManager, "unshiftNew");
      const before = scene.money;

      await runMysteryEncounterToEnd(game, 3);

      expect(scene.money - before).toBe(scene.getWaveMoneyAmount(10));
      expect(leave).toHaveBeenCalledTimes(1);
      expect(leave.mock.calls[0][0] ?? false).toBe(false);
      expect(scene.currentBattle.mysteryEncounter!.doEncounterRewards).toBeUndefined();
      expect(newPhase.mock.calls.some(([name]) => name === "SelectModifierPhase")).toBe(false);
      expect(faintedOf()).toHaveLength(0);
      expect(game.textInterceptor.logs.some(l => l.includes("Relic Gold"))).toBe(true);
      expect(game.textInterceptor.logs.some(l => l.includes("You received ₽"))).toBe(true);
    });
  });

  describe("forced Endless spawn on waves 777, 1777, ...", () => {
    const setMode = (mode: GameModes) => {
      scene.gameMode = getGameMode(mode);
    };

    /** A session seed whose roll on `wave` comes out as `hit` */
    function findSeed(hit: boolean, wave = 777): string {
      for (let i = 0; i < 2000; i++) {
        const seed = `dark-chest-spawn-${i}`;
        scene.setSeed(seed);
        if (isDarkChestWave(wave) === hit) {
          return seed;
        }
      }
      throw new Error(`no seed with ${hit} on wave ${wave}`);
    }

    it("rolls 77/1000 on waves % 1000 === 777 of Endless and Spliced Endless", () => {
      expect(DARK_CHEST_SPAWN_CHANCE).toBe(77);
      for (const mode of [GameModes.ENDLESS, GameModes.SPLICED_ENDLESS]) {
        setMode(mode);
        for (const wave of [777, 1777, 2777, 7777, 10777]) {
          expect(getDarkChestWaveChance(wave), `wave ${wave}`).toBe(77 / 1000);
        }
        for (const wave of [77, 776, 778, 1000, 1077, 1277, 249, 999, 7770]) {
          expect(getDarkChestWaveChance(wave), `wave ${wave}`).toBe(0);
        }
      }
    });

    it("never happens outside Endless", () => {
      for (const mode of [GameModes.CLASSIC, GameModes.CHALLENGE, GameModes.DAILY]) {
        setMode(mode);
        for (const wave of [777, 1777]) {
          expect(getDarkChestWaveChance(wave)).toBe(0);
        }
        for (let i = 0; i < 200; i++) {
          scene.setSeed(`dark-chest-mode-${i}`);
          expect(isDarkChestWave(777)).toBe(false);
        }
      }
    });

    it("gives the same answer for the same seed and wave, about 77 times in 1000, without touching the running RNG", () => {
      setMode(GameModes.ENDLESS);
      let hits = 0;
      const trials = 3000;
      for (let i = 0; i < trials; i++) {
        scene.setSeed(`dark-chest-roll-${i}`);
        const state = Phaser.Math.RND.state();
        const first = isDarkChestWave(777);
        expect(Phaser.Math.RND.state()).toBe(state);
        expect(isDarkChestWave(777)).toBe(first);
        hits += Number(first);
      }
      // expected 231
      expect(hits).toBeGreaterThan(160);
      expect(hits).toBeLessThan(310);
    });

    it("rolls on its own seed offset, which never meets the encounter roll, the GTS? roll or the encounter pick", () => {
      setMode(GameModes.ENDLESS);
      const offsets = vi.spyOn(scene, "executeWithSeedOffset");
      isDarkChestWave(1777);
      expect(offsets).toHaveBeenCalledWith(expect.any(Function), getDarkChestSeedOffset(1777));
      expect(getDarkChestSeedOffset(1777)).toBe(1777 * 3000 + 777);

      // Offsets give the same seed exactly when they are equal modulo 65536 (char codes wrap there), so compare
      // residues against every residue each other roll can ever use
      const residues = (offset: (a: number) => number): Set<number> => {
        const set = new Set<number>();
        for (let a = 0; a < 65536; a++) {
          set.add(offset(a) % 65536);
        }
        return set;
      };
      const encounterRoll = residues(a => a * 3000);
      const gtsRoll = residues(a => a * 3000 + 1500);
      const encounterPick = residues(a => a * 16);
      const seed = "AbCdEfGhIjKlMnOpQrStUvWx";
      for (let k = 0; k <= 300; k++) {
        const wave = 777 + 1000 * k;
        const offset = getDarkChestSeedOffset(wave);
        expect(offset % 8).toBe(1);
        const residue = offset % 65536;
        expect(encounterRoll.has(residue), `wave ${wave}`).toBe(false);
        expect(gtsRoll.has(residue), `wave ${wave}`).toBe(false);
        expect(encounterPick.has(residue), `wave ${wave}`).toBe(false);
        // and the shifted seeds themselves differ, wrap included
        const shifted = Utils.shiftCharCodes(seed, offset);
        for (const other of [wave * 3000, wave * 3000 + 1500, wave * 16, (wave - 1) * 3000 + 1500]) {
          expect(shifted).not.toBe(Utils.shiftCharCodes(seed, other));
        }
      }
    });

    it("forces its wave into the encounter in the current biome, whatever the roll, the spacing or a trainer wave say", async () => {
      game.override.mysteryEncounterChance(0);
      await game.classicMode.startBattle(SpeciesId.LAPRAS, SpeciesId.GENGAR);
      setMode(GameModes.ENDLESS);
      const isWaveMysteryEncounter = (type: BattleType, wave: number): boolean =>
        (scene as any).isWaveMysteryEncounter(type, wave);

      scene.setSeed(findSeed(true));
      expect(getForcedSpecialEncounter(777)).toBe(MysteryEncounterType.DARK_MYSTERIOUS_CHEST);
      expect(isWaveMysteryEncounter(BattleType.TRAINER, 777)).toBe(true);
      expect(isWaveMysteryEncounter(BattleType.WILD, 777)).toBe(true);
      expect(isWaveMysteryEncounter(BattleType.WILD, 776)).toBe(false);

      scene.currentBattle.waveIndex = 777;
      expect(scene.getMysteryEncounter().encounterType).toBe(MysteryEncounterType.DARK_MYSTERIOUS_CHEST);
      // a saved wave keeps its own encounter
      expect(scene.getMysteryEncounter(MysteryEncounterType.MYSTERIOUS_CHEST).encounterType).toBe(
        MysteryEncounterType.MYSTERIOUS_CHEST,
      );
      // no biome change around it
      expect(scene.isNewBiome()).toBe(false);
      scene.currentBattle.waveIndex = 776;
      expect(scene.isNewBiome()).toBe(false);

      // the chest's party requirement: with one Pokémon able to battle the wave stays ordinary
      scene.getPlayerParty()[1].hp = 0;
      expect(getForcedSpecialEncounter(777)).toBeNull();
      expect(isWaveMysteryEncounter(BattleType.TRAINER, 777)).toBe(false);
      scene.getPlayerParty()[1].hp = 1;

      // a seed that misses leaves the wave to the normal rolls
      scene.setSeed(findSeed(false));
      expect(getForcedSpecialEncounter(777)).toBeNull();
      expect(isWaveMysteryEncounter(BattleType.TRAINER, 777)).toBe(false);
    });

    it("keeps the GTS? first in the table, and the GTS? keeps its own rule", async () => {
      game.override.mysteryEncounterChance(0);
      await game.classicMode.startBattle(SpeciesId.LAPRAS, SpeciesId.GENGAR);
      setMode(GameModes.ENDLESS);
      expect(SPECIAL_ENCOUNTER_SPAWNS.map(s => s.type)).toEqual([
        MysteryEncounterType.DARK_GLOBAL_TRADE_SYSTEM,
        MysteryEncounterType.DARK_MYSTERIOUS_CHEST,
      ]);
      scene.setSeed(findSeed(true));
      const gts = vi.spyOn(DarkGtsSpawn, "isDarkGtsEndWave").mockImplementation(wave => wave === 249 || wave === 777);
      expect(getForcedSpecialEncounter(249)).toBe(MysteryEncounterType.DARK_GLOBAL_TRADE_SYSTEM);
      expect(getForcedSpecialEncounter(777)).toBe(MysteryEncounterType.DARK_GLOBAL_TRADE_SYSTEM);
      gts.mockReturnValue(false);
      expect(getForcedSpecialEncounter(249)).toBeNull();
      expect(getForcedSpecialEncounter(777)).toBe(MysteryEncounterType.DARK_MYSTERIOUS_CHEST);
    });

    it("in a run, turns wave 777 into the chest without leaving the biome", async () => {
      game.override
        .startingWave(776)
        .startingBiome(BiomeId.PLAINS)
        .mysteryEncounterChance(0)
        .xpMultiplier(0)
        .criticalHits(false)
        .battleStyle("single")
        .enemyMoveset(MoveId.SPLASH)
        .ability(AbilityId.BALL_FETCH)
        .moveset([MoveId.SPLASH]);
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
      expect(game.scene.currentBattle.waveIndex).toBe(776);
      expect(game.scene.arena.biomeId).toBe(BiomeId.PLAINS);
      game.scene.setSeed(findSeed(true));
      game.phaseInterceptor.clearLogs();

      game.move.select(MoveId.SPLASH);
      await game.doKillOpponents();
      game.doSelectModifier();
      game.onNextPrompt(
        "NextEncounterPhase",
        UiMode.MESSAGE,
        () => game.scene.ui.getHandler<MysteryEncounterUiHandler>().processInput(Button.ACTION),
        () => game.isCurrentPhase("MysteryEncounterPhase"),
        true,
      );
      await game.phaseInterceptor.to("MysteryEncounterPhase", false);

      const battle = game.scene.currentBattle;
      expect(battle.waveIndex).toBe(777);
      expect(game.scene.arena.biomeId).toBe(BiomeId.PLAINS);
      expect(battle.battleType).toBe(BattleType.MYSTERY_ENCOUNTER);
      expect(battle.mysteryEncounter?.encounterType).toBe(MysteryEncounterType.DARK_MYSTERIOUS_CHEST);
      expect(game.phaseInterceptor.phaseLog).toContain("NextEncounterPhase");
      expect(game.phaseInterceptor.phaseLog).not.toContain("SelectBiomePhase");
    });
  });

  /**
   * Every Korean text the encounter puts on screen, captured from the encounter screen (getEncounterText), the
   * message boxes and the test text log: no raw keys, no {{ }} or [[ ]] left.
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
      scene.money = getDarkChestCoinPrice() * 2;
      await hoverOptions();
      const texts = textsOf(flow).join("\n");
      for (const expected of [
        "이건…",
        "새까만 상자?",
        "수수께끼 상자?",
        "새까만 상자가 놓여 있다... 안에서 짤랑거리는 소리가 난다?",
        "어떻게 하시겠습니까?",
        "상자를 연다...",
        "상자에 동전을 던져 넣는다",
        "불길한 느낌이 든다, 떠난다",
        "(-) ???",
        "(+) ???",
        " 지불",
      ]) {
        expect(texts).toContain(expected);
      }
    });

    it("shows the disabled tooltip without the money", async () => {
      flow = "disabled";
      await startEncounter();
      scene.money = 0;
      await hoverOptions();
      expect(textsOf(flow).join("\n")).toContain("(-) 돈이 부족하다");
    });

    it("option 1: the trap", async () => {
      flow = "trap";
      const [lapras, gengar] = await startEncounter();
      gengar.level = lapras.level + 5;
      forceChestRoll(0);
      await runMysteryEncounterToEnd(game, 1, undefined, true);
      const texts = textsOf(flow).join("\n");
      expect(texts).toContain("새까만 상자의 뚜껑을\n천천히 들어 올렸다...");
      expect(texts).toContain("함정이다!");
      // the lead (Lapras), not the higher-level Gengar
      expect(texts).toContain("상자 속에서 타부자고가 튀어나와\n라프라스를 덮쳤다!");
      expect(texts).toContain("라프라스의 체력이 절반이나 깎였다!");
      expect(texts).toContain("게다가 모든 능력치가 한 단계씩\n떨어진 채로 싸워야 한다!");
      expect(texts).not.toContain("쓰러뜨렸다");
    });

    it("option 1: the treasure", async () => {
      flow = "treasure";
      await startEncounter();
      forceChestRoll(99);
      await runMysteryEncounterToEnd(game, 1);
      expect(textsOf(flow).join("\n")).toContain("상자 안에는 보물이 가득했다!");
    });

    it("option 2: the coins", async () => {
      flow = "coins";
      await startEncounter();
      scene.money = getDarkChestCoinPrice();
      await runMysteryEncounterToEnd(game, 2);
      const texts = textsOf(flow).join("\n");
      expect(texts).toMatch(/₽[\d,]+을 지불했다\./);
      expect(texts).toContain("동전을 던져 넣자\n상자가 조용히 열렸다...");
    });

    it("option 3: leaving", async () => {
      flow = "leave";
      await startEncounter();
      await runMysteryEncounterToEnd(game, 3);
      const texts = textsOf(flow).join("\n");
      expect(texts).toContain("불길한 느낌이 들어\n서둘러 자리를 떠났다...");
      expect(texts).toContain("...어라? 발밑에\n고대의금화가 떨어져 있다!");
      expect(texts).toMatch(/₽[\d,]+[을를] 받았다!/);
    });

    it("leaves no raw key, {{ }} or [[ ]] in anything it showed", () => {
      expect(captured.length).toBeGreaterThan(20);
      for (const { flow: f, text } of captured) {
        expect(text, `${f}: ${text}`).not.toMatch(/\{\{|\}\}|\[\[|\]\]/);
        expect(text, `${f}: ${text}`).not.toContain("darkMysteriousChest");
        expect(text, `${f}: ${text}`).not.toContain("mysteryEncounters/");
      }
    });
  });
});
