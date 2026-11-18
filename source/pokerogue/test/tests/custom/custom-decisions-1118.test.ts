// Local fork (2026-11-18): the user's answers to the open questions of docs/커스텀_기술_20261114.md and
// docs/패시브_조정_20261114.md (listed in docs/다음_작업_후보_20261118.md). Last Stand's part is in
// custom-abilities-2.test.ts.
import { RELEARN_MOVE } from "#app/constants";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { getCustomPassive } from "#balance/custom-passives";
import { tmPoolTiers } from "#balance/tm-pool-tiers";
import { allMoves } from "#data/data-lists";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { LearnableMoveSource } from "#enums/learnable-move-source";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import { getStarterMoves } from "#ui/starter-select-ui-utils";
import { getModifierPoolForType } from "#utils/modifier-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("The user's answers of 2026-11-18", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    // Both sides get a harmless ability and no passive by default, so species passives from the sheet never interfere
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyHasPassiveAbility(false)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .hasPassiveAbility(false)
      .moveset([MoveId.SPLASH, MoveId.TACKLE]);
  });

  // The user, on the Mystical Rock (신비한바위) reward condition: "터보엔진, 금빛고동 추가"
  describe("Mystical Rock reward condition: Turbo Engine and Golden Pulse", () => {
    /** The Mystical Rock's reward weight for `party` (10 when it can appear, 0 when not). */
    function rockWeight(party: Pokemon[]): number {
      const entry = getModifierPoolForType(ModifierPoolType.PLAYER)[ModifierTier.ULTRA].find(
        w => w.modifierType.id === "MYSTICAL_ROCK",
      )!;
      expect(entry).toBeDefined();
      return (entry.weight as WeightedModifierTypeWeightFunc)(party, 0);
    }

    it("does not appear for a party with no weather or terrain ability or move", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      expect(rockWeight([game.field.getPlayerPokemon()])).toBe(0);
    });

    it.each([
      { name: "Turbo Engine", ability: AbilityId.TURBO_ENGINE },
      { name: "Golden Pulse", ability: AbilityId.GOLDEN_PULSE },
    ])("appears for a $name holder, as its ability or as its passive", async ({ ability }) => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const feebas = game.field.getPlayerPokemon();

      const abilityMock = game.field.mockAbility(feebas, ability);
      expect(rockWeight([feebas])).toBe(10);

      abilityMock.mockRestore();
      expect(rockWeight([feebas])).toBe(0);
      game.field.mockAbility(feebas, ability, true);
      vi.spyOn(feebas, "hasPassive").mockReturnValue(true);
      expect(rockWeight([feebas])).toBe(10);
    });

    it("lengthens the sun Turbo Engine sets, +2 turns per stack", async () => {
      game.override.ability(AbilityId.TURBO_ENGINE).startingHeldItems([{ name: "MYSTICAL_ROCK", count: 2 }]);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);

      expect(game).toHaveWeather(WeatherType.SUNNY);
      expect(game.scene.arena.weather?.turnsLeft).toBe(9);
    });

    it("lengthens the Electric Terrain Golden Pulse sets, +2 turns per stack", async () => {
      game.override.ability(AbilityId.GOLDEN_PULSE).startingHeldItems([{ name: "MYSTICAL_ROCK", count: 2 }]);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);

      expect(game).toHaveTerrain(TerrainType.ELECTRIC);
      expect(game.scene.arena.terrain?.turnsLeft).toBe(9);
    });
  });

  // The user, on Headstrong (막무가내) doing nothing for the Archen line: "기술머신 및 기억버섯 목록에 추가"
  describe("Archen line: Head Smash and Brave Bird for Headstrong", () => {
    const RECOIL_MOVES = [MoveId.HEAD_SMASH, MoveId.BRAVE_BIRD] as const;

    it("has Headstrong as its sheet passive, and both moves are recoil moves it boosts", () => {
      expect(getCustomPassive(SpeciesId.ARCHEN, "")).toBe(AbilityId.HEADSTRONG);
      expect(getCustomPassive(SpeciesId.ARCHEOPS, "")).toBe(AbilityId.HEADSTRONG);
      for (const move of RECOIL_MOVES) {
        expect(allMoves[move].hasFlag(MoveFlags.RECKLESS_MOVE), MoveId[move]).toBe(true);
      }
    });

    it.each([
      { name: "Archen", species: SpeciesId.ARCHEN },
      { name: "Archeops", species: SpeciesId.ARCHEOPS },
    ])("$name has both as Memory Mushroom (relearn) moves only", ({ species }) => {
      const levelMoves = speciesDataRegistry.getLevelMoves(species);
      for (const move of RECOIL_MOVES) {
        expect(
          levelMoves.filter(([, m]) => m === move),
          MoveId[move],
        ).toEqual([[RELEARN_MOVE, move]]);
      }
    });

    it.each([
      { name: "Archen", species: SpeciesId.ARCHEN, level: 20 },
      { name: "Archeops", species: SpeciesId.ARCHEOPS, level: 50 },
    ])(
      "$name can relearn both with the Memory Mushroom, but never learns them by level",
      async ({ species, level }) => {
        game.override.startingLevel(level);
        await game.classicMode.startBattle(species);
        const pokemon = game.field.getPlayerPokemon();

        const learnable = pokemon.getLearnableLevelMoves();
        for (const move of RECOIL_MOVES) {
          expect(learnable.find(([, m]) => m === move)?.[2], MoveId[move]).toBe(LearnableMoveSource.RELEARN);
          expect(
            pokemon.getLevelMoves({ startingLevel: 1, includePrevolutionMoves: true }).some(([, m]) => m === move),
            MoveId[move],
          ).toBe(false);
        }
        // the Memory Mushroom can be used on it
        game.move.changeMoveset(pokemon, [MoveId.SPLASH]);
        expect(pokemon.getLearnableLevelMoves().length).toBeGreaterThan(0);
      },
    );

    it("are not starter moves", () => {
      const starterMoves = getStarterMoves(SpeciesId.ARCHEN, 0);
      for (const move of RECOIL_MOVES) {
        expect(starterMoves, MoveId[move]).not.toContain(move);
      }
    });

    it("Brave Bird is a TM both can take; Head Smash has no TM in this game, so none was added", async () => {
      expect(tmPoolTiers[MoveId.BRAVE_BIRD]).toBe(ModifierTier.ULTRA);
      expect(tmPoolTiers[MoveId.HEAD_SMASH]).toBeUndefined();
      for (const species of [SpeciesId.ARCHEN, SpeciesId.ARCHEOPS]) {
        expect(speciesDataRegistry.getTms(species), SpeciesId[species]).toContain(MoveId.BRAVE_BIRD);
        expect(speciesDataRegistry.getTms(species), SpeciesId[species]).not.toContain(MoveId.HEAD_SMASH);
      }

      await game.classicMode.startBattle(SpeciesId.ARCHEN);
      const archen = game.field.getPlayerPokemon();
      expect(archen.isTmCompatible(MoveId.BRAVE_BIRD)).toBe(true);
      expect(archen.isTmCompatible(MoveId.HEAD_SMASH)).toBe(false);
      // Reward TMs skip moves the Memory Mushroom already teaches (upstream `getCompatibleTms` excludeLevelUp), so the
      // Archen line alone never puts the Brave Bird TM in the reward pool; one rolled for another member still works
      expect(archen.getCompatibleTms(true, true, true)).not.toContain(MoveId.BRAVE_BIRD);
    });

    it("Headstrong as a passive boosts both by 1.2 and blocks their recoil", async () => {
      game.override
        .passiveAbility(AbilityId.HEADSTRONG)
        .hasPassiveAbility(true)
        .moveset([...RECOIL_MOVES])
        .enemyLevel(100);
      vi.spyOn(allMoves[MoveId.HEAD_SMASH], "accuracy", "get").mockReturnValue(100);
      await game.classicMode.startBattle(SpeciesId.ARCHEOPS);
      const archeops = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(allMoves[MoveId.HEAD_SMASH].calculateBattlePower(archeops, enemy, true)).toBeCloseTo(180);
      expect(allMoves[MoveId.BRAVE_BIRD].calculateBattlePower(archeops, enemy, true)).toBeCloseTo(144);

      for (const move of RECOIL_MOVES) {
        game.move.select(move);
        await game.toNextTurn();
        expect(archeops, MoveId[move]).toHaveFullHp();
      }
      expect(enemy).not.toHaveFullHp();
    });
  });
});
