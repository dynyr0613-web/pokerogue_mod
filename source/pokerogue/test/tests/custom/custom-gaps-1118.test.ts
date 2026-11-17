/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { MoveTypeChangeAbAttrParams } from "#abilities/ab-attrs";
import { anyTypeMoveConversionCondition, normalTypeMoveConversionCondition } from "#abilities/custom-ability-helpers";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { syncAlphaLineBoosts } from "#data/alpha-pokemon";
import { allAbilities, allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BiomeId } from "#enums/biome-id";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { ZCrystalModifierType } from "#modifiers/modifier-type";
import type { PokemonMove } from "#moves/pokemon-move";
import { GMAX_MOVES, MAX_MOVE_BY_TYPE, ZMAX_ONLY_MOVES } from "#moves/zmax-data";
import * as MysteryEncounters from "#mystery-encounters/mystery-encounter-biomes";
import { GameManager } from "#test/framework/game-manager";
import { runMysteryEncounterToEnd } from "#test/utils/encounter-test-utils";
import type { StarterData } from "#types/save-data";
import { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import { NumberHolder } from "#utils/common";
import { toCamelCase } from "#utils/strings";
import { readFileSync } from "node:fs";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Abilities with a `MoveTypeChangeAbAttr` that this part could not reach: Frostfire (init-abilities.ts, outside this
 * part's files) still checks `move.type === FIRE` alone. Remove it from here once its two conditions also ask
 * `anyTypeMoveConversionCondition`.
 */
const NOT_YET_COVERED: ReadonlySet<AbilityId> = new Set<AbilityId>(); // Frostfire covered too since 11-18

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8"));
}

/**
 * Local fork (2026-11-18): the known gaps of the Z / Max moves and the alphas (docs/다음_작업_후보_20261118.md, the user:
 * "버그성 빈틈도 다 수정"):
 * 1. type-changing abilities (Normalize, the -ate abilities, Liquid Voice, Vocal Sac, Chime Voice) leave Z / Max moves
 *    their own type (custom-ability-helpers.ts, anyTypeMoveConversionCondition);
 * 2. the Max / G-Max move descriptions follow the fork's rules (locales/{ko,en}/move.json);
 * 3. the Bug-Type Superfan's 6-Bug reward has the Z-Ring too (bug-type-superfan-encounter.ts);
 * 4. an older save's alpha records of the Pichu / Pikachu line reach both starters (alpha-pokemon.ts,
 *    syncAlphaLineBoosts).
 */
describe("Local fork (2026-11-18): known gaps", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .hasPassiveAbility(false)
      .enemyHasPassiveAbility(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Use a 다이사탕 on move `moveIndex` of `pokemon`, as the reward screen does after "yes" */
  function useCandy(pokemon: PlayerPokemon, moveIndex: number): boolean {
    return game.scene.addModifier(modifierTypes.DYNAMAX_CANDY().newModifier(pokemon, moveIndex)!);
  }

  /** Use a type Z crystal on move `moveIndex` of `pokemon` */
  function useCrystal(pokemon: PlayerPokemon, moveIndex: number, type: PokemonType): boolean {
    return game.scene.addModifier(new ZCrystalModifierType(type).newModifier(pokemon, moveIndex)!);
  }

  /** `target`'s damage from `source`'s `move` as the forecast sees it */
  function forecast(source: Pokemon, target: Pokemon, move: PokemonMove): number {
    return target.getAttackDamage({ source, move: move.getMove(), simulated: true }).damage;
  }

  describe("1. type-changing abilities and Z / Max moves", () => {
    it("no ability that changes a move's type re-types a Z / Max move (the -ates, Normalize, the sound ones)", async () => {
      await game.classicMode.startBattle(SpeciesId.SYLVEON);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      const typeChangers = allAbilities.filter(a => a.hasAttr("MoveTypeChangeAbAttr"));
      // the list this checks is the one the fix had in mind
      expect(typeChangers.map(a => a.id)).toEqual(
        expect.arrayContaining([
          AbilityId.NORMALIZE,
          AbilityId.REFRIGERATE,
          AbilityId.PIXILATE,
          AbilityId.AERILATE,
          AbilityId.GALVANIZE,
          AbilityId.DRAGONIZE,
          AbilityId.LIQUID_VOICE,
          AbilityId.VOCAL_SAC,
          AbilityId.CHIME_VOICE,
        ]),
      );
      for (const ability of typeChangers.filter(a => !NOT_YET_COVERED.has(a.id))) {
        for (const id of ZMAX_ONLY_MOVES) {
          const move = allMoves[id];
          for (const attr of ability.getAttrs("MoveTypeChangeAbAttr")) {
            const params: MoveTypeChangeAbAttrParams = {
              pokemon: player,
              opponent: enemy,
              move,
              simulated: true,
              passive: false,
              moveType: new NumberHolder(move.type),
            };
            expect(attr.canApply(params), `${AbilityId[ability.id]} on ${MoveId[id]}`).toBe(false);
          }
        }
      }
      // the shared conditions themselves
      for (const id of ZMAX_ONLY_MOVES) {
        expect(anyTypeMoveConversionCondition(player, enemy, allMoves[id]), MoveId[id]).toBe(false);
        expect(normalTypeMoveConversionCondition(player, enemy, allMoves[id]), MoveId[id]).toBe(false);
      }
      // plain moves are converted as before
      expect(normalTypeMoveConversionCondition(player, enemy, allMoves[MoveId.HYPER_VOICE])).toBe(true);
      expect(anyTypeMoveConversionCondition(player, enemy, allMoves[MoveId.EMBER])).toBe(true);
    });

    it("Pixilate: Hyper Voice turns Fairy, its Max Strike and a Normal Z-Move stay Normal, without the 1.2x", async () => {
      game.override.ability(AbilityId.PIXILATE);
      await game.classicMode.startBattle(SpeciesId.SYLVEON);
      const sylveon = game.field.getPlayerPokemon();
      const snorlax = game.field.getEnemyPokemon();
      game.move.changeMoveset(sylveon, [MoveId.HYPER_VOICE, MoveId.TACKLE, MoveId.QUICK_ATTACK]);
      const [hyperVoice, tackle, quickAttack] = sylveon.moveset;

      expect(sylveon.getMoveType(hyperVoice.getMove())).toBe(PokemonType.FAIRY);
      expect(useCandy(sylveon, 0)).toBe(true);
      expect(hyperVoice.transform).toEqual({ kind: "max", moveId: MoveId.MAX_STRIKE });
      expect(sylveon.getMoveType(hyperVoice.getMove())).toBe(PokemonType.NORMAL);
      expect(useCrystal(sylveon, 1, PokemonType.NORMAL)).toBe(true);
      expect(tackle.getMove().id).toBe(MoveId.BREAKNECK_BLITZ__PHYSICAL);
      expect(sylveon.getMoveType(tackle.getMove())).toBe(PokemonType.NORMAL);
      // the plain Quick Attack is still converted
      expect(sylveon.getMoveType(quickAttack.getMove())).toBe(PokemonType.FAIRY);

      // the forecasts against Snorlax: the Max / Z moves are the same as without Pixilate, Quick Attack is not
      const withPixilate = [hyperVoice, tackle, quickAttack].map(m => forecast(sylveon, snorlax, m));
      game.field.mockAbility(sylveon, AbilityId.BALL_FETCH);
      const without = [hyperVoice, tackle, quickAttack].map(m => forecast(sylveon, snorlax, m));
      expect(withPixilate[0]).toBe(without[0]);
      expect(withPixilate[1]).toBe(without[1]);
      expect(withPixilate[2]).toBeGreaterThan(without[2]);
    });

    it("Pixilate: the Max Strike does not touch a Ghost (a Fairy one would have)", async () => {
      game.override.ability(AbilityId.PIXILATE).enemySpecies(SpeciesId.GENGAR);
      await game.classicMode.startBattle(SpeciesId.SYLVEON);
      const sylveon = game.field.getPlayerPokemon();
      const gengar = game.field.getEnemyPokemon();
      game.move.changeMoveset(sylveon, [MoveId.HYPER_VOICE]);
      expect(useCandy(sylveon, 0)).toBe(true);

      game.move.select(MoveId.HYPER_VOICE);
      await game.toEndOfTurn();
      expect(sylveon).toHaveUsedMove({ move: MoveId.HYPER_VOICE, derivedMoveId: MoveId.MAX_STRIKE });
      expect(gengar.hp).toBe(gengar.getMaxHp());
    });

    it("Normalize: Ember turns Normal, its Max Flare stays Fire; a Z status move (Z도깨비불) follows its base move", async () => {
      game.override.ability(AbilityId.NORMALIZE);
      await game.classicMode.startBattle(SpeciesId.SKITTY);
      const skitty = game.field.getPlayerPokemon();
      game.move.changeMoveset(skitty, [MoveId.EMBER, MoveId.WILL_O_WISP]);
      const [ember, willOWisp] = skitty.moveset;

      expect(skitty.getMoveType(ember.getMove())).toBe(PokemonType.NORMAL);
      expect(useCandy(skitty, 0)).toBe(true);
      expect(ember.getMove().id).toBe(MoveId.MAX_FLARE);
      expect(skitty.getMoveType(ember.getMove())).toBe(PokemonType.FIRE);

      expect(useCrystal(skitty, 1, PokemonType.FIRE)).toBe(true);
      expect(willOWisp.transform).toEqual({ kind: "z", moveId: MoveId.WILL_O_WISP });
      expect(skitty.getMoveType(willOWisp.getMove())).toBe(PokemonType.NORMAL);
    });

    it("Liquid Voice: Hyper Voice turns Water, its Max Strike stays Normal", async () => {
      game.override.ability(AbilityId.LIQUID_VOICE);
      await game.classicMode.startBattle(SpeciesId.PRIMARINA);
      const primarina = game.field.getPlayerPokemon();
      game.move.changeMoveset(primarina, [MoveId.HYPER_VOICE]);
      const [hyperVoice] = primarina.moveset;

      expect(primarina.getMoveType(hyperVoice.getMove())).toBe(PokemonType.WATER);
      expect(useCandy(primarina, 0)).toBe(true);
      expect(primarina.getMoveType(hyperVoice.getMove())).toBe(PokemonType.NORMAL);
    });
  });

  describe("2. Max / G-Max move descriptions", () => {
    const locales = {
      ko: readJson<Record<string, { effect: string }>>("locales/ko/move.json"),
      en: readJson<Record<string, { effect: string }>>("locales/en/move.json"),
    };
    const maxMoves = [...new Set(Object.values(MAX_MOVE_BY_TYPE))];
    const gmaxMoves = [...new Set(Object.values(GMAX_MOVES).map(info => info.move))];
    const effect = (lang: "ko" | "en", id: MoveId) => locales[lang][toCamelCase(MoveId[id])].effect;
    /** Max / G-Max moves whose stat drop goes to every foe */
    const lowersFoes = (id: MoveId) =>
      allMoves[id].getAttrs("MaxMoveStatStageChangeAttr").some(attr => attr.side === "foes" && attr.stages < 0);

    it("no longer say a Dynamaxed / Gigantamaxed Pokémon uses them (converted moves are used without Dynamaxing)", () => {
      expect(maxMoves).toHaveLength(18);
      expect(gmaxMoves).toHaveLength(33);
      for (const id of [...maxMoves, ...gmaxMoves]) {
        expect(effect("ko", id), MoveId[id]).not.toContain("다이맥스한");
        expect(effect("en", id), MoveId[id]).not.toMatch(/Dynamax Pokémon use|that Gigantamax [A-Z]/);
      }
      for (const id of maxMoves) {
        expect(effect("ko", id), MoveId[id]).toMatch(/^다이맥스의 힘으로 날리는 \S+타입의 공격\. /);
        expect(effect("en", id), MoveId[id]).toMatch(/^This is an? \S+-type attack powered by Dynamax energy\. /);
      }
      for (const id of gmaxMoves) {
        expect(effect("ko", id), MoveId[id]).toMatch(/^거다이맥스할 수 있는 \S+ 사용하는 \S+타입 공격\. /);
        expect(effect("en", id), MoveId[id]).toMatch(/^An? \S+-type attack that Gigantamax-capable \S+ use\. /);
      }
      expect(effect("ko", MoveId.G_MAX_WILDFIRE)).toMatch(/^거다이맥스할 수 있는 리자몽이 사용하는 불꽃타입 공격\./);
    });

    it("the stat drops of Max Strike, Flutterby, Phantasm, Wyrmwind and Darkness name every foe", () => {
      const foeDrops = maxMoves.filter(lowersFoes);
      expect(foeDrops.sort((a, b) => a - b)).toEqual(
        [MoveId.MAX_FLUTTERBY, MoveId.MAX_STRIKE, MoveId.MAX_PHANTASM, MoveId.MAX_WYRMWIND, MoveId.MAX_DARKNESS].sort(
          (a, b) => a - b,
        ),
      );
      for (const id of foeDrops) {
        expect(effect("ko", id), MoveId[id]).toContain(" 상대 전체의 ");
        expect(effect("en", id), MoveId[id]).toMatch(/This lowers opposing Pokémon’s .+ stats\.$/);
        expect(effect("en", id), MoveId[id]).not.toContain("the target’s");
      }
      expect(effect("ko", MoveId.MAX_STRIKE)).toBe(
        "다이맥스의 힘으로 날리는 노말타입의 공격. 상대 전체의 스피드를 떨어뜨린다.",
      );
      // the two G-Max ones too (their English already said "opponents")
      for (const id of gmaxMoves.filter(lowersFoes)) {
        expect(effect("ko", id), MoveId[id]).toContain(" 상대 전체의 ");
      }
    });
  });

  describe("3. Bug-Type Superfan: the Z-Ring", () => {
    const sixBugs = [
      SpeciesId.BUTTERFREE,
      SpeciesId.BEEDRILL,
      SpeciesId.GALVANTULA,
      SpeciesId.VOLCARONA,
      SpeciesId.ANORITH,
      SpeciesId.GENESECT,
    ];

    beforeEach(() => {
      game.override.mysteryEncounterChance(100).startingWave(24).startingBiome(BiomeId.CAVE).disableTrainerWaves();
      vi.spyOn(MysteryEncounters, "mysteryEncountersByBiome", "get").mockReturnValue(
        new Map<BiomeId, MysteryEncounterType[]>([[BiomeId.CAVE, [MysteryEncounterType.BUG_TYPE_SUPERFAN]]]),
      );
    });

    /** The reward ids of the 6-Bug option ("show your Bug types") */
    async function sixBugRewards(): Promise<string[]> {
      await game.runToMysteryEncounter(MysteryEncounterType.BUG_TYPE_SUPERFAN, sixBugs);
      await runMysteryEncounterToEnd(game, 2);
      await game.phaseInterceptor.to("SelectModifierPhase");
      expect(game.scene.ui.mode).toBe(UiMode.MODIFIER_SELECT);
      const handler = game.scene.ui.handlers.find(h => h instanceof ModifierSelectUiHandler) as ModifierSelectUiHandler;
      return handler.options.map(o => o.modifierTypeOption.type.id);
    }

    it("offers the Z-Ring next to the Mega Bracelet and the Dynamax Band", async () => {
      const ids = await sixBugRewards();
      expect(ids.slice(0, 4)).toEqual(["MASTER_BALL", "MEGA_BRACELET", "DYNAMAX_BAND", "Z_RING"]);
    });

    it("not when the player already has it", async () => {
      game.override.startingModifier([{ name: "Z_RING" }]);
      const ids = await sixBugRewards();
      expect(ids).not.toContain("Z_RING");
      expect(ids).toContain("DYNAMAX_BAND");
    });

    it("not before the fork content is unlocked (Z_RING is a gated item)", async () => {
      game.override.forkContentUnlocked(false);
      const ids = await sixBugRewards();
      expect(ids).not.toContain("Z_RING");
      expect(ids.slice(0, 3)).toEqual(["MASTER_BALL", "MEGA_BRACELET", "DYNAMAX_BAND"]);
    });
  });

  describe("4. alpha records of an older save (Pichu / Pikachu)", () => {
    /** A save's starter data with only these entries */
    function starterData(entries: Partial<Record<SpeciesId, { alphaBoost?: number; alphaEnabled?: boolean }>>) {
      return entries as unknown as StarterData;
    }

    it("gives both starters the larger boost, keeps each one's switch, and changes nothing the second time", () => {
      // before 11-17 an alpha Raichu was recorded for Pichu only
      const data = starterData({
        [SpeciesId.PICHU]: { alphaBoost: 14, alphaEnabled: true },
        [SpeciesId.PIKACHU]: { alphaEnabled: false },
        [SpeciesId.BULBASAUR]: { alphaBoost: 7 },
      });
      expect(syncAlphaLineBoosts(data)).toEqual([SpeciesId.PIKACHU]);
      expect(data[SpeciesId.PICHU]).toEqual({ alphaBoost: 14, alphaEnabled: true });
      expect(data[SpeciesId.PIKACHU]).toEqual({ alphaBoost: 14, alphaEnabled: false });
      expect(data[SpeciesId.BULBASAUR]).toEqual({ alphaBoost: 7 });
      expect(syncAlphaLineBoosts(data)).toEqual([]);
      expect(data[SpeciesId.PIKACHU].alphaBoost).toBe(14);
    });

    it("works both ways, and adds nothing to a line without an alpha", () => {
      const data = starterData({
        [SpeciesId.PICHU]: { alphaBoost: 4 },
        [SpeciesId.PIKACHU]: { alphaBoost: 9 },
      });
      expect(syncAlphaLineBoosts(data)).toEqual([SpeciesId.PICHU]);
      expect(data[SpeciesId.PICHU].alphaBoost).toBe(9);

      const none = starterData({ [SpeciesId.PICHU]: { alphaBoost: 0 }, [SpeciesId.PIKACHU]: {} });
      expect(syncAlphaLineBoosts(none)).toEqual([]);
      expect(none[SpeciesId.PIKACHU]).toEqual({});
      // a save without one of the entries
      expect(syncAlphaLineBoosts(starterData({ [SpeciesId.PIKACHU]: { alphaBoost: 3 } }))).toEqual([]);
    });

    it("pairs every root with the starter of its later stage, Pichu / Pikachu among them", () => {
      const pairs = new Set<string>();
      for (const species of speciesDataRegistry.getAllSpecies()) {
        const rootId = species.getRootSpeciesId();
        const starterId = species.getRootSpeciesId(true);
        if (rootId !== starterId) {
          pairs.add(`${SpeciesId[rootId]}>${SpeciesId[starterId]}`);
        }
      }
      expect(pairs).toContain("PICHU>PIKACHU");
      // every pair is evened out
      const data: Record<number, { alphaBoost?: number }> = {};
      for (const pair of pairs) {
        const [root, starter] = pair.split(">").map(name => SpeciesId[name as keyof typeof SpeciesId]);
        data[root] = { alphaBoost: 11 };
        data[starter] = {};
      }
      syncAlphaLineBoosts(data as unknown as StarterData);
      for (const pair of pairs) {
        const starter = SpeciesId[pair.split(">")[1] as keyof typeof SpeciesId];
        expect(data[starter].alphaBoost, pair).toBe(11);
      }
    });
  });
});
