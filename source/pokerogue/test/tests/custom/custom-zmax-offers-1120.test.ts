/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { speciesDataRegistry } from "#app/global-species-data-registry";
import { allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { Button } from "#enums/buttons";
import { FormChangeItem } from "#enums/form-change-item";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { ShopCursorTarget } from "#enums/shop-cursor-target";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import {
  canGigantamaxWithMushrooms,
  getRareFormChangeSlotWeight,
  hasGmaxMemberWithoutMushrooms,
  MAX_MUSHROOM_OFFER_RULES,
} from "#modifiers/max-mushroom-offer";
import type { PokemonFormChangeItemModifier } from "#modifiers/modifier";
import {
  type DynamaxCandyModifierType,
  type FormChangeItemModifierType,
  getFormChangeItemPool,
  type ModifierTypeGenerator,
} from "#modifiers/modifier-type";
import {
  getConversionBlockReason,
  getConversionPartyBlock,
  getDynamaxCandyWeight,
  getZCrystalCandidates,
  getZCrystalWeight,
  ZMAX_REWARD_RULES,
} from "#modifiers/zmax-items";
import { type ConversionItem, getConversionResult } from "#moves/move-transform";
import { isZPowerlessStatusMove } from "#moves/zmax-data";
import { generateModifierType } from "#mystery-encounters/encounter-phase-utils";
import { GameManager } from "#test/framework/game-manager";
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import type { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import { PartyUiHandler } from "#ui/party-ui-handler";
import { getModifierPoolForType } from "#utils/modifier-utils";
import { readFileSync } from "node:fs";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const CANDY: ConversionItem = { kind: "candy" };

/**
 * Local fork (2026-11-20): the F1 decisions about what the Z/Max rewards offer (Z다이_경계점검_20261120.md):
 * - Q1 "다이맥스한 포켓몬만 센다": the Dynamax Candy counts and serves only Dynamaxed Pokémon;
 * - Q5 "거다이가 있을 경우 24, 없을 경우 4": Max Mushrooms weigh 24 while a Pokémon that can Gigantamax waits for them;
 * - Q6 "추천대로": before the first Classic clear, Max Mushrooms only for a G-Max species, as in the original game;
 * - Q9 "뺀다": the six status moves without Z-Power take no Z crystal and give the crystals no weight;
 * - F1-42 "전용 z기술을 한 칸이라도 가질 경우 해당 전용 z의 크리스탈 드롭 안함 (전용 z가 여러개일 경우에는 그 전용 z에
 *   해당하는 z기술만 막는다)".
 */
describe("Local fork - F1 Z/Max reward offers (2026-11-20)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  const WAIT = { timeout: 15_000, interval: 10 };

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingLevel(100)
      .startingWave(3)
      .disableTrainerWaves()
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(5)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .hasPassiveAbility(false)
      .moveset([MoveId.SPLASH]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function poolEntry(tier: ModifierTier, id: string) {
    return getModifierPoolForType(ModifierPoolType.PLAYER)[tier].find(w => w.modifierType.id === id);
  }

  /** Give `pokemon` the form-change item `item` as the reward screen does (active) */
  function give(pokemon: Pokemon, item: FormChangeItem): PokemonFormChangeItemModifier {
    const type = generateModifierType(modifierTypes.RARE_FORM_CHANGE_ITEM, [item]) as FormChangeItemModifierType;
    const modifier = type.newModifier(pokemon) as PokemonFormChangeItemModifier;
    game.scene.addModifier(modifier);
    return modifier;
  }

  /** Remove the Mega Bracelet and the Dynamax Band, then add the ones asked for */
  function setKeyItems({ band = false, bracelet = false }: { band?: boolean; bracelet?: boolean }): void {
    for (const keyItem of game.scene.findModifiers(
      m => m.is("GigantamaxAccessModifier") || m.is("MegaEvolutionAccessModifier"),
    )) {
      game.scene.removeModifier(keyItem);
    }
    if (band) {
      game.scene.addModifier(modifierTypes.DYNAMAX_BAND().newModifier()!);
    }
    if (bracelet) {
      game.scene.addModifier(modifierTypes.MEGA_BRACELET().newModifier()!);
    }
  }

  function setGmaxForm(pokemon: Pokemon): void {
    pokemon.formIndex = pokemon.species.forms.findIndex(f => f.formKey === SpeciesFormKey.GIGANTAMAX);
    expect(pokemon.isMax()).toBe(true);
  }

  /** How often each item comes out of the rare form change generator in `draws` draws */
  function drawCounts(party: Pokemon[], draws: number): Map<FormChangeItem, number> {
    const generator = modifierTypes.RARE_FORM_CHANGE_ITEM() as ModifierTypeGenerator;
    const counts = new Map<FormChangeItem, number>();
    for (let i = 0; i < draws; i++) {
      const item = (generator.generateType(party) as FormChangeItemModifierType).formChangeItem;
      counts.set(item, (counts.get(item) ?? 0) + 1);
    }
    return counts;
  }

  describe("Q1: the Dynamax Candy counts and serves only Dynamaxed Pokémon", () => {
    it("is offered for a Dynamaxed Pokémon's own moves only, and refuses the others on the party screen", async () => {
      await game.classicMode.startBattle(SpeciesId.MILOTIC, SpeciesId.PIKACHU);
      const party = game.scene.getPlayerParty();
      const [milotic, pikachu] = party;
      game.move.changeMoveset(milotic, [MoveId.SURF]);
      game.move.changeMoveset(pikachu, [MoveId.THUNDERBOLT]);
      const candy = modifierTypes.DYNAMAX_CANDY() as DynamaxCandyModifierType;
      const notDynamaxed = i18next.t("modifierType:ModifierType.DYNAMAX_CANDY.notDynamaxed");
      expect(notDynamaxed).not.toBe(PartyUiHandler.NoEffectMessage);

      // nobody Dynamaxed: not offered, and the party screen says why
      expect(getDynamaxCandyWeight(party)).toBe(0);
      expect(getConversionPartyBlock(milotic, CANDY)).toBe("notDynamaxed");
      expect(candy.selectFilter!(milotic)).toBe(notDynamaxed);
      expect(candy.selectFilter!(pikachu)).toBe(notDynamaxed);

      // Milotic in the Dynamax state (Max Mushrooms switched on): offered, for Milotic only
      const mushrooms = give(milotic, FormChangeItem.MAX_MUSHROOMS);
      expect(milotic.isDynamaxed()).toBe(true);
      expect(getDynamaxCandyWeight(party)).toBe(ZMAX_REWARD_RULES.dynamaxCandy.weight);
      expect(candy.selectFilter!(milotic)).toBeNull();
      expect(candy.selectFilter!(pikachu)).toBe(notDynamaxed);

      // Milotic's only move converted: no longer offered, though Pikachu's Thunderbolt could take it
      milotic.moveset[0].transform = { kind: "max", moveId: MoveId.MAX_GEYSER };
      expect(getConversionResult(pikachu, pikachu.moveset[0], CANDY)).not.toBeNull();
      expect(getDynamaxCandyWeight(party)).toBe(0);
      expect(candy.selectFilter!(milotic)).toBe(PartyUiHandler.NoEffectMessage);

      // the mushrooms switched off: not Dynamaxed any more
      milotic.moveset[0].transform = undefined;
      mushrooms.active = false;
      expect(milotic.isDynamaxed()).toBe(false);
      expect(getDynamaxCandyWeight(party)).toBe(0);
      expect(candy.selectFilter!(milotic)).toBe(notDynamaxed);

      // a G-Max form counts as well
      setGmaxForm(pikachu);
      expect(getDynamaxCandyWeight(party)).toBe(ZMAX_REWARD_RULES.dynamaxCandy.weight);
      expect(candy.selectFilter!(pikachu)).toBeNull();
    });

    it("the party screen shows the reason for a Pokémon that is not Dynamaxed and opens no move list", async () => {
      game.override.itemRewards([{ name: "DYNAMAX_CANDY" }]);
      await game.classicMode.startBattle(SpeciesId.MILOTIC, SpeciesId.PIKACHU);
      const [milotic, pikachu] = game.scene.getPlayerParty();
      game.move.changeMoveset(milotic, [MoveId.SURF]);
      game.move.changeMoveset(pikachu, [MoveId.THUNDERBOLT]);
      give(milotic, FormChangeItem.MAX_MUSHROOMS);

      game.move.select(MoveId.SURF);
      await game.doKillOpponents();
      await game.phaseInterceptor.to("SelectModifierPhase");
      const rewards = game.scene.ui.handlers[UiMode.MODIFIER_SELECT] as ModifierSelectUiHandler;
      await vi.waitFor(() => {
        expect(game.scene.ui.mode).toBe(UiMode.MODIFIER_SELECT);
        expect(rewards["awaitingActionInput"]).toBe(true);
      }, WAIT);
      expect(rewards.options[0].modifierTypeOption.type.id).toBe("DYNAMAX_CANDY");
      rewards.setRowCursor(ShopCursorTarget.REWARDS);
      rewards.setCursor(0);
      expect(rewards.processInput(Button.ACTION)).toBe(true);
      const party = game.scene.ui.handlers[UiMode.PARTY] as PartyUiHandler;
      await vi.waitFor(() => {
        expect(game.scene.ui.mode).toBe(UiMode.PARTY);
        expect(party.active).toBe(true);
      }, WAIT);

      const showText = vi.spyOn(party, "showText");
      party.setCursor(1);
      party.processInput(Button.ACTION); // Pikachu's options
      party.processInput(Button.ACTION); // Use
      expect(showText).toHaveBeenCalledWith(
        i18next.t("modifierType:ModifierType.DYNAMAX_CANDY.notDynamaxed"),
        undefined,
        expect.any(Function),
        undefined,
        true,
      );
      expect(game.scene.ui.mode).toBe(UiMode.PARTY);
      expect(pikachu.moveset[0].transform).toBeUndefined();
    });

    it("has the reason and the condition in both locales", () => {
      const ko = JSON.parse(readFileSync("./locales/ko/modifier-type.json", "utf8")).ModifierType;
      const en = JSON.parse(readFileSync("./locales/en/modifier-type.json", "utf8")).ModifierType;
      expect(ko.DYNAMAX_CANDY.notDynamaxed).toBe("다이맥스한 포켓몬에게만 쓸 수 있다.");
      expect(en.DYNAMAX_CANDY.notDynamaxed).toBe("Only a Dynamaxed Pokémon can use it.");
      expect(ko.DYNAMAX_CANDY.description).toMatch(/^다이맥스한 포켓몬의 기술 하나를/);
      expect(en.DYNAMAX_CANDY.description).toMatch(/^Permanently turns one of a Dynamaxed Pokémon’s moves/);
    });
  });

  describe("Q5 / Q6: Max Mushrooms in the rare form change reward", () => {
    it("Q5: the slot weighs 24 for them while a Pokémon that can Gigantamax holds none, else 4", async () => {
      game.override.startingWave(161);
      await game.classicMode.startBattle(SpeciesId.MILOTIC, SpeciesId.CHARIZARD);
      const party = game.scene.getPlayerParty();
      const [milotic, charizard] = party;
      const weight = poolEntry(ModifierTier.ROGUE, "RARE_FORM_CHANGE_ITEM")!.weight as WeightedModifierTypeWeightFunc;
      expect(poolEntry(ModifierTier.ROGUE, "RARE_FORM_CHANGE_ITEM")!.maxWeight).toBe(24);
      expect([1, 50, 51, 100, 101, 150, 151, 5000].map(getRareFormChangeSlotWeight)).toEqual([
        6, 6, 12, 12, 18, 18, 24, 24,
      ]);
      expect(MAX_MUSHROOM_OFFER_RULES.withoutGmaxWeight).toBe(4);
      expect(canGigantamaxWithMushrooms(charizard)).toBe(true);
      expect(canGigantamaxWithMushrooms(milotic)).toBe(false);

      // without the Dynamax Band nothing changes: the wave weight
      setKeyItems({});
      expect(getFormChangeItemPool(party, true)).toEqual([]);
      expect(weight(party, 0)).toBe(24);

      // Charizard (a G-Max species) holds none: 24
      setKeyItems({ band: true });
      expect(getFormChangeItemPool(party, true)).toEqual([FormChangeItem.MAX_MUSHROOMS]);
      expect(hasGmaxMemberWithoutMushrooms(party)).toBe(true);
      expect(weight(party, 0)).toBe(24);

      // Charizard holds them: only Milotic's "any Pokémon" Dynamax is left: 4
      give(charizard, FormChangeItem.MAX_MUSHROOMS);
      expect(hasGmaxMemberWithoutMushrooms(party)).toBe(false);
      expect(getFormChangeItemPool(party, true)).toEqual([FormChangeItem.MAX_MUSHROOMS]);
      expect(weight(party, 0)).toBe(4);

      // waves 101-150: 18 with a G-Max species waiting, still 4 without
      game.scene.currentBattle.waveIndex = 120;
      expect(weight(party, 0)).toBe(4);
      game.scene.removeModifier(charizard.getHeldItems().find(m => m.is("PokemonFormChangeItemModifier"))!);
      expect(weight(party, 0)).toBe(18);
    });

    it("Q5: beside other rare form change items the slot keeps its weight and the mushrooms' share drops to 4 of it", async () => {
      game.override.startingWave(161);
      await game.classicMode.startBattle(SpeciesId.MILOTIC, SpeciesId.GARCHOMP);
      const party = game.scene.getPlayerParty();
      const weight = poolEntry(ModifierTier.ROGUE, "RARE_FORM_CHANGE_ITEM")!.weight as WeightedModifierTypeWeightFunc;
      setKeyItems({ band: true, bracelet: true });
      const pool = getFormChangeItemPool(party, true);
      expect(pool).toContain(FormChangeItem.GARCHOMPITE);
      expect(pool).toContain(FormChangeItem.MAX_MUSHROOMS);
      expect(hasGmaxMemberWithoutMushrooms(party)).toBe(false);
      expect(weight(party, 0)).toBe(24);

      // even draws would give the mushrooms 1/n; now 4/24 = 1/6
      const draws = 1200;
      const counts = drawCounts(party, draws);
      const mushrooms = counts.get(FormChangeItem.MAX_MUSHROOMS) ?? 0;
      expect(mushrooms).toBeGreaterThan(draws / 6 - 60);
      expect(mushrooms).toBeLessThan(draws / 6 + 60);
      expect([...counts.keys()].every(item => pool.includes(item))).toBe(true);
    });

    it("Q5: with a G-Max species waiting the draw stays even, as before", async () => {
      game.override.startingWave(161);
      await game.classicMode.startBattle(SpeciesId.MILOTIC, SpeciesId.GARCHOMP, SpeciesId.VENUSAUR);
      const party = game.scene.getPlayerParty();
      setKeyItems({ band: true, bracelet: true });
      const pool = getFormChangeItemPool(party, true);
      expect(pool).toContain(FormChangeItem.MAX_MUSHROOMS);
      expect(hasGmaxMemberWithoutMushrooms(party)).toBe(true);
      const draws = 1200;
      const mushrooms = drawCounts(party, draws).get(FormChangeItem.MAX_MUSHROOMS) ?? 0;
      const even = (draws * pool.filter(item => item === FormChangeItem.MAX_MUSHROOMS).length) / pool.length;
      expect(mushrooms).toBeGreaterThan(even - 90);
      expect(mushrooms).toBeLessThan(even + 90);
    });

    it("Q6: before the first Classic clear only a G-Max species gets them, as when the event gives the Band at wave 115", async () => {
      game.override.forkContentUnlocked(false);
      await game.classicMode.startBattle(SpeciesId.MILOTIC, SpeciesId.CHARIZARD);
      const party = game.scene.getPlayerParty();
      const [milotic, charizard] = party;
      const generator = modifierTypes.RARE_FORM_CHANGE_ITEM() as ModifierTypeGenerator;
      // the live upstream event ("Item Update waiting room", F1-41) hands the Band out at Classic wave 115
      setKeyItems({ band: true });

      // Charizard's own entry only; the party screen gives them to Charizard only
      expect(getFormChangeItemPool(party, true)).toEqual([FormChangeItem.MAX_MUSHROOMS]);
      const type = generateModifierType(modifierTypes.RARE_FORM_CHANGE_ITEM, [
        FormChangeItem.MAX_MUSHROOMS,
      ]) as FormChangeItemModifierType;
      expect(milotic.isFormChangeItemCompatible(FormChangeItem.MAX_MUSHROOMS)).toBe(false);
      expect(charizard.isFormChangeItemCompatible(FormChangeItem.MAX_MUSHROOMS)).toBe(true);
      expect(type.selectFilter!(milotic)).toBe(PartyUiHandler.NoEffectMessage);
      expect(type.selectFilter!(charizard)).toBeNull();
      expect(type.getDescription()).toBe(
        i18next.t("modifierType:ModifierType.FormChangeItemModifierType.maxMushroomsLockedDescription"),
      );

      // Charizard holds them: nothing more before the clear (Milotic gets none)
      give(charizard, FormChangeItem.MAX_MUSHROOMS);
      expect(getFormChangeItemPool(party, true)).toEqual([]);
      expect(generator.generateType(party)).toBeNull();

      // mushrooms on a species without a G-Max form anyway (one that evolved holding them): no Dynamax state
      give(milotic, FormChangeItem.MAX_MUSHROOMS);
      expect(milotic.hasDynamaxState()).toBe(false);
      expect(milotic.isDynamaxed()).toBe(false);

      // unlocked: all of it as before
      game.override.forkContentUnlocked(true);
      expect(milotic.hasDynamaxState()).toBe(true);
      expect(type.getDescription()).toBe(
        i18next.t("modifierType:ModifierType.FormChangeItemModifierType.maxMushroomsDescription"),
      );
      game.scene.removeModifier(milotic.getHeldItems().find(m => m.is("PokemonFormChangeItemModifier"))!);
      expect(milotic.isFormChangeItemCompatible(FormChangeItem.MAX_MUSHROOMS)).toBe(true);
      expect(getFormChangeItemPool(party, true)).toEqual([FormChangeItem.MAX_MUSHROOMS]);
    });

    it("Q6: the locked text in both locales", () => {
      for (const lang of ["ko", "en"]) {
        const text = JSON.parse(readFileSync(`./locales/${lang}/modifier-type.json`, "utf8")).ModifierType
          .FormChangeItemModifierType;
        expect(text.maxMushroomsLockedDescription, lang).toBeTruthy();
        expect(text.maxMushroomsLockedDescription).not.toBe(text.maxMushroomsDescription);
      }
    });
  });

  describe("Q9: status moves without Z-Power take no Z crystal", () => {
    const POWERLESS = [
      MoveId.METRONOME,
      MoveId.NATURE_POWER,
      MoveId.ASSIST,
      MoveId.HEALING_WISH,
      MoveId.LUNAR_DANCE,
      MoveId.REVIVAL_BLESSING,
    ];

    it("are exactly 손가락흔들기, 자연의힘, 조수, 치유소원, 초승달춤, 회생의기도", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const found = allMoves.filter(m => !!m && isZPowerlessStatusMove(m.id)).map(m => m.id);
      expect([...found].sort((a, b) => a - b)).toEqual([...POWERLESS].sort((a, b) => a - b));
    });

    it("no crystal converts them (the picker says why), the candy still does, and they give no weight", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const party = game.scene.getPlayerParty();
      const snorlax = party[0];
      const snorlium: ConversionItem = { kind: "zExclusive", key: "SNORLIUM_Z" };
      for (const moveId of POWERLESS) {
        game.move.changeMoveset(snorlax, [moveId]);
        const slot = snorlax.moveset[0];
        const typeCrystal: ConversionItem = { kind: "zType", type: allMoves[moveId].type };
        expect(getConversionResult(snorlax, slot, typeCrystal), MoveId[moveId]).toBeNull();
        expect(getConversionBlockReason(snorlax, slot, typeCrystal), MoveId[moveId]).toBe("noZPower");
        expect(getConversionResult(snorlax, slot, CANDY), MoveId[moveId]).toEqual({
          kind: "max",
          moveId: MoveId.MAX_GUARD,
        });
        if (allMoves[moveId].type === PokemonType.NORMAL) {
          expect(getConversionResult(snorlax, slot, snorlium), MoveId[moveId]).toBeNull();
          expect(getConversionBlockReason(snorlax, slot, snorlium), MoveId[moveId]).toBe("noZPower");
        }
      }

      // Splash (Z-Power: Attack +3) and Body Slam still count; Metronome and Assist do not
      game.move.changeMoveset(snorlax, [MoveId.METRONOME, MoveId.ASSIST, MoveId.SPLASH, MoveId.BODY_SLAM]);
      expect(Object.fromEntries(getZCrystalCandidates(party))).toEqual({
        [PokemonType.NORMAL]: 2,
        SNORLIUM_Z: 6,
      });
      // only powerless moves: no crystal at all, even with the Z-Ring
      game.move.changeMoveset(snorlax, [MoveId.METRONOME, MoveId.ASSIST]);
      game.scene.addModifier(modifierTypes.Z_RING().withIdFromFunc(modifierTypes.Z_RING).newModifier()!);
      expect(getZCrystalCandidates(party).size).toBe(0);
      expect(getZCrystalWeight(party)).toBe(0);

      // made a Max Guard first, Metronome still takes the Normal crystal (Z다이)
      snorlax.moveset[0].transform = { kind: "max", moveId: MoveId.MAX_GUARD };
      expect(getConversionResult(snorlax, snorlax.moveset[0], { kind: "zType", type: PokemonType.NORMAL })).toEqual({
        kind: "zMax",
        moveId: MoveId.MAX_GUARD,
      });
      expect(Object.fromEntries(getZCrystalCandidates(party))).toEqual({ [PokemonType.NORMAL]: 1 });
    });

    it("says so in both locales", () => {
      const ko = JSON.parse(readFileSync("./locales/ko/modifier-type.json", "utf8")).ModifierType.Z_CRYSTAL;
      const en = JSON.parse(readFileSync("./locales/en/modifier-type.json", "utf8")).ModifierType.Z_CRYSTAL;
      expect(ko.reason.noZPower).toBe("Z파워가 없는 기술이다.");
      expect(en.reason.noZPower).toBe("This move has no Z-Power effect.");
      expect(ko.description).toContain("Z파워가 없는 변화 기술");
      expect(ko.exclusiveDescription).toContain("Z파워가 없는 변화 기술");
      expect(en.description).toContain("without a Z-Power effect");
      expect(en.exclusiveDescription).toContain("without a Z-Power effect");
    });
  });

  describe("F1-42: no exclusive crystal for a Pokémon that already has its exclusive Z-Move", () => {
    it("drops that crystal only, per Pokémon; the type crystal and a fusion's other exclusive crystal stay", async () => {
      await game.classicMode.startBattle(SpeciesId.PIKACHU, SpeciesId.PIKACHU);
      const party = game.scene.getPlayerParty();
      const [first, second] = party;
      game.move.changeMoveset(first, [MoveId.VOLT_TACKLE, MoveId.THUNDERBOLT, MoveId.THUNDER, MoveId.THUNDER_WAVE]);
      game.move.changeMoveset(second, [MoveId.THUNDERBOLT]);
      expect(getZCrystalCandidates(party).get("PIKANIUM_Z")).toBe(5 * ZMAX_REWARD_RULES.zCrystal.exclusiveMultiplier);

      // one slot of the first Pikachu is Catastropika: it adds nothing to Pikanium Z any more, the second still does
      first.moveset[0].transform = { kind: "zExclusive", moveId: MoveId.CATASTROPIKA };
      expect(Object.fromEntries(getZCrystalCandidates(party))).toEqual({
        [PokemonType.ELECTRIC]: 3,
        PIKANIUM_Z: ZMAX_REWARD_RULES.zCrystal.exclusiveMultiplier,
      });
      // both have it: no Pikanium Z; Electricium Z still for the first one's three moves
      second.moveset[0].transform = { kind: "zExclusive", moveId: MoveId.CATASTROPIKA };
      expect(Object.fromEntries(getZCrystalCandidates(party))).toEqual({ [PokemonType.ELECTRIC]: 3 });
      // the crystal itself can still be used (only the drop is blocked)
      expect(getConversionResult(first, first.moveset[1], { kind: "zExclusive", key: "PIKANIUM_Z" })).toEqual({
        kind: "zExclusive",
        moveId: MoveId.CATASTROPIKA,
      });

      // a Pikachu fused with Decidueye: Catastropika blocks Pikanium Z only, Decidium Z stays until its own Z-Move
      game.move.changeMoveset(second, [MoveId.VOLT_TACKLE, MoveId.THUNDERBOLT, MoveId.SHADOW_BALL]);
      second.fusionSpecies = speciesDataRegistry.getSpecies(SpeciesId.DECIDUEYE);
      second.fusionFormIndex = 0;
      second.moveset[0].transform = { kind: "zExclusive", moveId: MoveId.CATASTROPIKA };
      first.moveset.forEach(slot => {
        slot.transform = { kind: "zMax", moveId: MoveId.MAX_LIGHTNING };
      });
      expect(Object.fromEntries(getZCrystalCandidates(party))).toEqual({
        [PokemonType.ELECTRIC]: 1,
        [PokemonType.GHOST]: 1,
        DECIDIUM_Z: ZMAX_REWARD_RULES.zCrystal.exclusiveMultiplier,
      });
      second.moveset[2].transform = { kind: "zExclusive", moveId: MoveId.SINISTER_ARROW_RAID };
      expect(Object.fromEntries(getZCrystalCandidates(party))).toEqual({ [PokemonType.ELECTRIC]: 1 });
      second.fusionSpecies = null;
    });
  });
});
