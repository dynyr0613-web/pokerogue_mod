/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Local fork (2026-11-20): the F1 decisions about converted move slots (docs/Z다이_경계점검_20261120.md, Q2 Q3 Q7 Q8).
// The user's answers:
// - Q2 "전용 z를 쓸수 있거나 거다이 포켓몬인 경우 허용": an exclusive crystal upgrades a type Z-Move of its type on its
//   species, 다이사탕 upgrades a Max attack to the G-Max move the G-Max rule gives that slot; reward weights follow.
// - Q3 "잊을 때 경고": forgetting a converted slot (LearnMovePhase, the summary's "기술 잊기") warns and asks yes / no.
// - Q7 "그대로 가져온다": DNA Splicers bring the tail's converted slots into the fused Pokémon.
// - Q8 "막는다": Sketch takes neither 다이사탕 nor a Z crystal, greyed with a reason.
// Q4 "지금처럼" (no downgrade on evolution / unfusion) is unchanged and checked by custom-move-transform.test.ts.

import { speciesDataRegistry } from "#app/global-species-data-registry";
import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { Button } from "#enums/buttons";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { type FusePokemonModifierType, ZCrystalModifierType } from "#modifiers/modifier-type";
import {
  DYNAMAX_CANDY_ITEM,
  getConversionBlockReason,
  getSlotConversion,
  getZCrystalCandidates,
  MoveConversionModifier,
} from "#modifiers/zmax-items";
import {
  type ConversionItem,
  canSlotTakeItem,
  getConversionResult,
  getConvertedMoveForgetWarning,
  type MoveTransform,
} from "#moves/move-transform";
import { PokemonMove } from "#moves/pokemon-move";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import type { ConfirmUiHandler } from "#ui/confirm-ui-handler";
import type { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import { getMoveConversionReasonText, MoveConversionPicker } from "#ui/move-conversion-picker";
import type { OptionSelectUiHandler } from "#ui/option-select-ui-handler";
import type { PartyUiHandler } from "#ui/party-ui-handler";
import { type SummaryUiHandler, SummaryUiMode } from "#ui/summary-ui-handler";
import { getModifierPoolForType, getModifierType } from "#utils/modifier-utils";
import { readFileSync } from "node:fs";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const CANDY: ConversionItem = DYNAMAX_CANDY_ITEM;
const PIKANIUM: ConversionItem = { kind: "zExclusive", key: "PIKANIUM_Z" };
const zCrystal = (type: PokemonType): ConversionItem => ({ kind: "zType", type });
const CANDY_KEY = "modifierType:ModifierType.DYNAMAX_CANDY";
const CRYSTAL_KEY = "modifierType:ModifierType.Z_CRYSTAL";

/** UI waits: the reward screen animates for over a second */
const WAIT = { timeout: 15_000, interval: 10 };

/** A slot of `moveId`, converted by `transform` if given */
function slot(moveId: MoveId, transform?: MoveTransform): PokemonMove {
  return new PokemonMove(moveId, 0, 0, undefined, transform);
}

/** A minimal stand-in for a Pokémon: the conversion rules only read its species and form keys */
function fakePokemon(speciesId: SpeciesId, fusion?: SpeciesId): Pokemon {
  return {
    species: speciesDataRegistry.getSpecies(speciesId),
    getFormKey: () => "",
    fusionSpecies: fusion === undefined ? null : speciesDataRegistry.getSpecies(fusion),
    getFusionFormKey: () => (fusion === undefined ? null : ""),
  } as unknown as Pokemon;
}

/** Sets `pokemon`'s moves to `moves`, converting the ones given a conversion */
function setMoves(game: GameManager, pokemon: Pokemon, moves: [MoveId, MoveTransform?][]): void {
  game.move.changeMoveset(
    pokemon,
    moves.map(([id]) => id),
  );
  moves.forEach(([, t], i) => {
    if (t) {
      pokemon.moveset[i].transform = { ...t };
    }
  });
}

describe("Z / Max slots: F1 Q2 / Q3 / Q7 / Q8 (2026-11-20)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const ui = () => game.scene.ui;
  const confirmHandler = () => ui().handlers[UiMode.CONFIRM] as ConfirmUiHandler;
  const optionHandler = () => ui().handlers[UiMode.OPTION_SELECT] as OptionSelectUiHandler;
  const summaryHandler = () => ui().handlers[UiMode.SUMMARY] as SummaryUiHandler;
  const rewardHandler = () => ui().handlers[UiMode.MODIFIER_SELECT] as ModifierSelectUiHandler;

  describe("rules and rewards", () => {
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

    it("Q8: Sketch takes no item; greyed in the picker with its reason; no reward weight from it", async () => {
      await game.classicMode.startBattle(SpeciesId.SMEARGLE);
      const smeargle = game.field.getPlayerPokemon();
      game.move.changeMoveset(smeargle, [MoveId.SKETCH, MoveId.TACKLE]);
      const [sketch] = smeargle.moveset;

      for (const item of [CANDY, zCrystal(PokemonType.NORMAL), { kind: "zExclusive", key: "SNORLIUM_Z" } as const]) {
        expect(canSlotTakeItem(sketch, item), item.kind).toBe(false);
        expect(getSlotConversion(smeargle, 0, item), item.kind).toBeNull();
        expect(getConversionBlockReason(smeargle, sketch, item), item.kind).toBe("sketch");
      }
      // an old save's converted Sketch takes nothing more either
      expect(canSlotTakeItem(slot(MoveId.SKETCH, { kind: "z", moveId: MoveId.SKETCH }), CANDY)).toBe(false);
      // Tackle still can
      expect(getSlotConversion(smeargle, 1, CANDY)).toEqual({ kind: "max", moveId: MoveId.MAX_STRIKE });

      // the Normal crystal counts Tackle only
      expect(getZCrystalCandidates([smeargle]).get(PokemonType.NORMAL)).toBe(1);
      game.move.changeMoveset(smeargle, [MoveId.SKETCH]);
      expect(getZCrystalCandidates([smeargle]).size).toBe(0);

      // the picker greys Sketch and says why, for both items
      game.move.changeMoveset(smeargle, [MoveId.SKETCH, MoveId.TACKLE]);
      const party = ui().handlers[UiMode.PARTY] as PartyUiHandler;
      const callbacks = { onConvert: () => {}, onBack: () => {} };
      for (const [item, key] of [
        [CANDY, CANDY_KEY],
        [zCrystal(PokemonType.NORMAL), CRYSTAL_KEY],
      ] as const) {
        const entries = new MoveConversionPicker(smeargle, party, item, key, callbacks).getEntries();
        expect(entries.map(e => [e.result !== null, e.reason])).toEqual([
          [false, "sketch"],
          [true, null],
        ]);
        expect(getMoveConversionReasonText(key, "sketch", smeargle, item)).toBe("It cannot be used on Sketch.");
      }
    });

    it("Q2: an exclusive crystal upgrades a type Z-Move of its type on its species only", async () => {
      await game.classicMode.startBattle(SpeciesId.PIKACHU, SpeciesId.RAICHU);
      const [pikachu, raichu] = game.scene.getPlayerParty();
      const gigavolt: MoveTransform = { kind: "z", moveId: MoveId.GIGAVOLT_HAVOC__SPECIAL };
      const breakneck: MoveTransform = { kind: "z", moveId: MoveId.BREAKNECK_BLITZ__PHYSICAL };
      setMoves(game, pikachu, [
        [MoveId.THUNDERBOLT, gigavolt],
        [MoveId.THUNDER, gigavolt],
        [MoveId.QUICK_ATTACK, breakneck],
        [MoveId.THUNDER_WAVE],
      ]);
      setMoves(game, raichu, [[MoveId.THUNDERBOLT, gigavolt]]);

      const catastropika = { kind: "zExclusive", moveId: MoveId.CATASTROPIKA };
      expect(getSlotConversion(pikachu, 0, PIKANIUM)).toEqual(catastropika);
      expect(getSlotConversion(pikachu, 3, PIKANIUM)).toEqual(catastropika); // a plain move, as before
      // a Z-Move of another type, the type crystal again, another species: no
      expect(getSlotConversion(pikachu, 2, PIKANIUM)).toBeNull();
      expect(getConversionBlockReason(pikachu, pikachu.moveset[2], PIKANIUM)).toBe("wrongType");
      expect(getSlotConversion(pikachu, 0, zCrystal(PokemonType.ELECTRIC))).toBeNull();
      expect(getConversionBlockReason(pikachu, pikachu.moveset[0], zCrystal(PokemonType.ELECTRIC))).toBe("zMove");
      expect(getSlotConversion(raichu, 0, PIKANIUM)).toBeNull();
      expect(getConversionBlockReason(raichu, raichu.moveset[0], PIKANIUM)).toBe("wrongSpecies");
      // an exclusive Z-Move or a Z-Max Move is never upgraded
      expect(
        canSlotTakeItem(slot(MoveId.THUNDERBOLT, { kind: "zExclusive", moveId: MoveId.CATASTROPIKA }), PIKANIUM),
      ).toBe(false);
      expect(canSlotTakeItem(slot(MoveId.THUNDERBOLT, { kind: "zMax", moveId: MoveId.MAX_LIGHTNING }), PIKANIUM)).toBe(
        false,
      );
      // a fusion tail counts, as for a plain move
      expect(
        getConversionResult(
          fakePokemon(SpeciesId.RAICHU, SpeciesId.PIKACHU),
          slot(MoveId.THUNDERBOLT, gigavolt),
          PIKANIUM,
        ),
      ).toEqual(catastropika);

      // the reward weights follow: Pikanium Z counts both Electric Z-Moves and Thunder Wave (3 each); the Electric type
      // crystal only Thunder Wave
      const weights = Object.fromEntries(getZCrystalCandidates([pikachu]));
      expect(weights.PIKANIUM_Z).toBe(9);
      expect(weights[PokemonType.ELECTRIC]).toBe(1);

      // used for real: the slot becomes the exclusive Z-Move
      const modifier = new ZCrystalModifierType("PIKANIUM_Z").newModifier(pikachu, 0) as MoveConversionModifier;
      expect(modifier).toBeInstanceOf(MoveConversionModifier);
      expect(modifier.shouldApply(pikachu)).toBe(true);
      expect(modifier.apply(pikachu)).toBe(true);
      expect(pikachu.moveset[0].transform).toEqual(catastropika);
      expect(pikachu.moveset[0].moveId).toBe(MoveId.THUNDERBOLT);
    });

    it("Q2: 다이사탕 upgrades a Max attack to the G-Max move its G-Max rule gives, and nothing else", async () => {
      await game.classicMode.startBattle(SpeciesId.MELMETAL, SpeciesId.CHARIZARD);
      const [melmetal, charizard] = game.scene.getPlayerParty();
      const steelspike: MoveTransform = { kind: "max", moveId: MoveId.MAX_STEELSPIKE };
      setMoves(game, melmetal, [
        [MoveId.BULLET_PUNCH, steelspike],
        [MoveId.DOUBLE_IRON_BASH, steelspike],
        [MoveId.ACID_ARMOR, { kind: "max", moveId: MoveId.MAX_GUARD }],
        [MoveId.SWORDS_DANCE, { kind: "max", moveId: MoveId.MAX_SWORDS_DANCE }],
      ]);
      setMoves(game, charizard, [
        [MoveId.FLAMETHROWER, { kind: "max", moveId: MoveId.MAX_FLARE }],
        [MoveId.AIR_SLASH, { kind: "max", moveId: MoveId.MAX_AIRSTREAM }],
      ]);

      // Melmetal's signature Double Iron Bash -> 거다이융격; Bullet Punch, Max Guard and 다이검무 stay
      expect(melmetal.moveset.map((_, i) => getSlotConversion(melmetal, i, CANDY))).toEqual([
        null,
        { kind: "gmax", moveId: MoveId.G_MAX_MELTDOWN },
        null,
        null,
      ]);
      expect(getConversionBlockReason(melmetal, melmetal.moveset[0], CANDY)).toBe("maxMove");
      expect(getConversionBlockReason(melmetal, melmetal.moveset[2], CANDY)).toBe("maxMove");
      // Charizard (no signature): its Fire Max Move -> 거다이옥염, the Flying one stays
      expect(getSlotConversion(charizard, 0, CANDY)).toEqual({ kind: "gmax", moveId: MoveId.G_MAX_WILDFIRE });
      expect(getSlotConversion(charizard, 1, CANDY)).toBeNull();
      // a Pokémon that cannot Gigantamax has nothing to upgrade
      expect(
        getConversionResult(
          fakePokemon(SpeciesId.RAICHU),
          slot(MoveId.THUNDERBOLT, { kind: "max", moveId: MoveId.MAX_LIGHTNING }),
          CANDY,
        ),
      ).toBeNull();

      // the candy's weight follows: Melmetal in its G-Max form with only the Double Iron Bash upgrade left (Charizard's
      // moves finished, so it counts for nothing whichever party members the candy counts)
      charizard.moveset[0].transform = { kind: "gmax", moveId: MoveId.G_MAX_WILDFIRE };
      expect(getSlotConversion(charizard, 0, CANDY)).toBeNull();
      const party = game.scene.getPlayerParty();
      melmetal.formIndex = melmetal.species.forms.findIndex(f => f.formKey === SpeciesFormKey.GIGANTAMAX);
      expect(melmetal.isDynamaxed()).toBe(true);
      const weight = getModifierPoolForType(ModifierPoolType.PLAYER)[ModifierTier.ULTRA].find(
        w => w.modifierType.id === "DYNAMAX_CANDY",
      )!.weight as WeightedModifierTypeWeightFunc;
      expect(weight(party, 0)).toBeGreaterThan(0);
      melmetal.moveset[1].transform = { kind: "gmax", moveId: MoveId.G_MAX_MELTDOWN };
      expect(weight(party, 0)).toBe(0);
    });

    it("Q3: the warning names what the slot became; none for a plain slot; Korean and English text", () => {
      expect(getConvertedMoveForgetWarning(slot(MoveId.TACKLE))).toBeNull();
      expect(getConvertedMoveForgetWarning(undefined)).toBeNull();
      const maxSlot = slot(MoveId.THUNDERBOLT, { kind: "max", moveId: MoveId.MAX_LIGHTNING });
      expect(getConvertedMoveForgetWarning(maxSlot)).toBe(
        `${maxSlot.getName()} was made a Max Move. Forgetting it loses the conversion.`,
      );
      // Review fix (2026-11-20): no fixed line break in English, so the message window wraps it within its two lines;
      // "Menacing Moonraze Maelstrom was made an exclusive Z-Move." alone is wider than one line there
      expect(i18next.t("battle:convertedMoveForgetWarning")).not.toContain("\n");
      expect(
        getConvertedMoveForgetWarning(slot(MoveId.THUNDERBOLT, { kind: "zExclusive", moveId: MoveId.CATASTROPIKA })),
      ).toContain("an exclusive Z-Move");
      for (const lang of ["ko", "en"]) {
        const battle = JSON.parse(readFileSync(`./locales/${lang}/battle.json`, "utf8"));
        expect(battle.convertedMoveForgetWarning, lang).toBeTruthy();
        expect(battle.convertedMoveForgetConfirm, lang).toBeTruthy();
        expect([...Object.keys(battle.convertedMoveKind)].sort(), lang).toEqual([
          "gmax",
          "max",
          "z",
          "zExclusive",
          "zMax",
        ]);
        const items = JSON.parse(readFileSync(`./locales/${lang}/modifier-type.json`, "utf8")).ModifierType;
        expect(items.DYNAMAX_CANDY.reason.sketch, lang).toBeTruthy();
        expect(items.Z_CRYSTAL.reason.sketch, lang).toBeTruthy();
      }
    });

    it("Q3: the summary's 기술 잊기 on a converted slot shows the warning while yes / no is up", async () => {
      await game.classicMode.startBattle(SpeciesId.PIKACHU);
      const pikachu = game.field.getPlayerPokemon();
      setMoves(game, pikachu, [
        [MoveId.SPLASH],
        [MoveId.THUNDERBOLT, { kind: "max", moveId: MoveId.MAX_LIGHTNING }],
        [MoveId.QUICK_ATTACK],
      ]);
      const warning = getConvertedMoveForgetWarning(pikachu.moveset[1])!;

      game.move.select(MoveId.SPLASH);
      await game.doKillOpponents();
      await game.phaseInterceptor.to("SelectModifierPhase");
      await vi.waitFor(() => {
        expect(ui().mode).toBe(UiMode.MODIFIER_SELECT);
        expect(rewardHandler()["awaitingActionInput"]).toBe(true);
      }, WAIT);

      // the summary's moves page (as the party screen opens it), move list on
      await ui().setModeWithoutClear(UiMode.SUMMARY, pikachu, SummaryUiMode.DEFAULT, 2);
      const summary = summaryHandler();
      summary.processInput(Button.ACTION);

      /** Moves the cursor to `index`, opens 기술 잊기 and waits for its yes / no */
      async function forget(index: number): Promise<void> {
        summary.setCursor(index);
        summary.processInput(Button.ACTION);
        await vi.waitFor(() => expect(ui().mode).toBe(UiMode.OPTION_SELECT), WAIT);
        const options = optionHandler()["options"] as { label: string; handler: () => boolean }[];
        options.find(o => o.label === i18next.t("pokemonSummary:deleteMove"))!.handler();
        await vi.waitFor(() => {
          expect(ui().mode).toBe(UiMode.CONFIRM);
          expect(confirmHandler().active).toBe(true);
        }, WAIT);
        confirmHandler()["unblockInput"]();
      }

      // a plain move: no warning, the window where it always was
      await forget(2);
      expect(summary.getMoveDescriptionText()).toBe(pikachu.moveset[2].getMove().effect);
      expect(confirmHandler()["config"]?.yOffset).toBe(48);
      confirmHandler().processInput(Button.CANCEL); // no
      await vi.waitFor(() => expect(ui().mode).toBe(UiMode.SUMMARY), WAIT);

      // the converted slot: the warning, the window above it; no keeps the move and shows its description again
      await forget(1);
      expect(summary.getMoveDescriptionText()).toBe(warning);
      expect(confirmHandler()["config"]?.yOffset).toBe(60);
      confirmHandler().processInput(Button.CANCEL); // no
      await vi.waitFor(() => expect(ui().mode).toBe(UiMode.SUMMARY), WAIT);
      expect(pikachu.moveset.map(m => m.moveId)).toEqual([MoveId.SPLASH, MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK]);
      expect(summary.getMoveDescriptionText()).toBe(pikachu.moveset[1].getMove().effect);

      // yes forgets it
      await forget(1);
      confirmHandler().processInput(Button.ACTION); // yes
      await vi.waitFor(() => expect(ui().mode).toBe(UiMode.SUMMARY), WAIT);
      expect(pikachu.moveset.map(m => m.moveId)).toEqual([MoveId.SPLASH, MoveId.QUICK_ATTACK]);
    });
  });

  describe("Q3: LearnMovePhase asks before a converted slot is forgotten", () => {
    beforeEach(() => {
      game = new GameManager(phaserGame);
      game.override.xpMultiplier(50).enemyMoveset(MoveId.SPLASH);
    });

    const vineWhipMax: MoveTransform = { kind: "max", moveId: MoveId.MAX_OVERGROWTH };

    /** Bulbasaur with Vine Whip made 다이그래스 wins and levels up; the LearnMovePhase is next */
    async function levelUpWithConvertedSlot(): Promise<PlayerPokemon> {
      await game.classicMode.startBattle(SpeciesId.BULBASAUR);
      const bulbasaur = game.field.getPlayerPokemon();
      setMoves(game, bulbasaur, [[MoveId.SPLASH], [MoveId.ABSORB], [MoveId.ACID], [MoveId.VINE_WHIP, vineWhipMax]]);
      game.move.select(MoveId.SPLASH);
      await game.doKillOpponents();
      return bulbasaur;
    }

    it("no returns to the move choice and the converted slot stays", async () => {
      const bulbasaur = await levelUpWithConvertedSlot();
      const shown = vi.spyOn(game.scene.ui, "showText");
      const warning = getConvertedMoveForgetWarning(bulbasaur.moveset[3])!;

      game.onNextPrompt("LearnMovePhase", UiMode.CONFIRM, () => {
        game.scene.ui.processInput(Button.ACTION); // forget a move? yes
      });
      game.onNextPrompt("LearnMovePhase", UiMode.SUMMARY, () => {
        game.scene.ui.setCursor(3); // the Max Move
        game.scene.ui.processInput(Button.ACTION);
      });
      game.onNextPrompt("LearnMovePhase", UiMode.CONFIRM, () => {
        game.scene.ui.processInput(Button.CANCEL); // forget it anyway? no
      });
      game.onNextPrompt("LearnMovePhase", UiMode.SUMMARY, () => {
        game.scene.ui.setCursor(1); // Absorb instead
        game.scene.ui.processInput(Button.ACTION);
      });
      await game.phaseInterceptor.to("LearnMovePhase");
      const [levelReq, levelMoveId] = bulbasaur.getLevelMoves({ startingLevel: 5 })[0];
      expect(bulbasaur.level).toBeGreaterThanOrEqual(levelReq);

      expect(shown.mock.calls.map(c => c[0])).toContain(warning);
      expect(bulbasaur.moveset.map(m => m.moveId)).toEqual([MoveId.SPLASH, levelMoveId, MoveId.ACID, MoveId.VINE_WHIP]);
      expect(bulbasaur.moveset[3].transform).toEqual(vineWhipMax);
    });

    it("yes forgets it, conversion and all", async () => {
      const bulbasaur = await levelUpWithConvertedSlot();

      game.onNextPrompt("LearnMovePhase", UiMode.CONFIRM, () => {
        game.scene.ui.processInput(Button.ACTION);
      });
      game.onNextPrompt("LearnMovePhase", UiMode.SUMMARY, () => {
        game.scene.ui.setCursor(3);
        game.scene.ui.processInput(Button.ACTION);
      });
      game.onNextPrompt("LearnMovePhase", UiMode.CONFIRM, () => {
        game.scene.ui.processInput(Button.ACTION); // yes
      });
      await game.phaseInterceptor.to("LearnMovePhase");
      const [levelReq, levelMoveId] = bulbasaur.getLevelMoves({ startingLevel: 5 })[0];
      expect(bulbasaur.level).toBeGreaterThanOrEqual(levelReq);

      expect(bulbasaur.moveset.map(m => m.moveId)).toEqual([MoveId.SPLASH, MoveId.ABSORB, MoveId.ACID, levelMoveId]);
      expect(bulbasaur.moveset[3].transform).toBeUndefined();
    });
  });

  describe("Q7: DNA Splicers bring the tail's converted slots", () => {
    beforeEach(() => {
      game = new GameManager(phaserGame);
      game.override
        .criticalHits(false)
        .battleStyle("single")
        .battleType(BattleType.WILD)
        .startingLevel(100)
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyLevel(5)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset(MoveId.SPLASH);
    });

    it("the fused Pokémon learns the tail's moves with their conversions; a plain known move takes the tail's", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU);
      const [snorlax, pikachu] = game.scene.getPlayerParty();
      const breakneck: MoveTransform = { kind: "z", moveId: MoveId.BREAKNECK_BLITZ__PHYSICAL };
      const maxLightning: MoveTransform = { kind: "max", moveId: MoveId.MAX_LIGHTNING };
      setMoves(game, snorlax, [
        [MoveId.SPLASH],
        [MoveId.TACKLE],
        [MoveId.BODY_SLAM, { kind: "max", moveId: MoveId.MAX_STRIKE }],
      ]);
      setMoves(game, pikachu, [
        [MoveId.TACKLE, breakneck],
        [MoveId.THUNDERBOLT, maxLightning],
        [MoveId.BODY_SLAM, breakneck],
      ]);

      const splicers = getModifierType(modifierTypes.DNA_SPLICERS) as FusePokemonModifierType;
      expect(game.scene.addModifier(splicers.newModifier(snorlax, pikachu))).toBe(true);
      expect(snorlax.isFusion()).toBe(true);
      // the queued LearnMovePhases run in the next turn
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      const byMove = (id: MoveId) => snorlax.moveset.find(m => m.moveId === id);
      expect(snorlax.moveset).toHaveLength(4);
      // Thunderbolt is new: learned as 다이썬더
      expect(byMove(MoveId.THUNDERBOLT)?.transform).toEqual(maxLightning);
      expect(byMove(MoveId.THUNDERBOLT)?.getMove().id).toBe(MoveId.MAX_LIGHTNING);
      // Tackle was known plain: it takes the tail's 울트라대시어택
      expect(byMove(MoveId.TACKLE)?.transform).toEqual(breakneck);
      // Body Slam was converted by the head already: the head's stays
      expect(byMove(MoveId.BODY_SLAM)?.transform).toEqual({ kind: "max", moveId: MoveId.MAX_STRIKE });
      // saved with the session
      expect(new PokemonData(snorlax).moveset.find(m => m.moveId === MoveId.THUNDERBOLT)?.transform).toEqual(
        maxLightning,
      );
    });
  });
});
