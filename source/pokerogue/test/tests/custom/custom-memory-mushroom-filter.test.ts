import { allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { LearnMoveType } from "#enums/learn-move-type";
import { LearnableMoveSource } from "#enums/learnable-move-source";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { PlayerPokemon } from "#field/pokemon";
import type { RememberMoveModifier } from "#modifiers/modifier";
import type { RememberMoveModifierType } from "#modifiers/modifier-type";
import { isZMaxOnlyMove } from "#moves/zmax-data";
import { GameManager } from "#test/framework/game-manager";
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import { PartyUiHandler } from "#ui/party-ui-handler";
import { getModifierPoolForType } from "#utils/modifier-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local fork (2026-11-19): 1.2.0 item A1. `Pokemon.getLearnableLevelMoves()` (the Memory Mushroom's list, its reward
 * eligibility and `RememberMoveModifier`'s index) left in unimplemented "(N)" moves such as Trick and Bide; picking one
 * ended LearnMovePhase without a word. They are now left out, with Z / Max / G-Max ids, as the TM generator and the
 * Master TM already do.
 */
describe("Local fork - Memory Mushroom list without unimplemented moves (2026-11-19)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(1)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A Memory Mushroom type as the reward screen makes it */
  function memoryMushroom(): RememberMoveModifierType {
    return modifierTypes.MEMORY_MUSHROOM().withIdFromFunc(modifierTypes.MEMORY_MUSHROOM) as RememberMoveModifierType;
  }

  /** Every level move `pokemon` has from level 1, unfiltered (what `getLearnableLevelMoves` starts from) */
  function allLevelMoves(pokemon: PlayerPokemon): MoveId[] {
    return pokemon
      .getLevelMoves({
        startingLevel: 1,
        includeEvolutionMoves: true,
        includePrevolutionMoves: true,
        includeRelearnerMoves: true,
      })
      .map(([, m]) => m);
  }

  /** The Memory Mushroom's pool weight function (it reads the player's party from the scene) */
  function memoryMushroomWeight(): WeightedModifierTypeWeightFunc {
    const pool = getModifierPoolForType(ModifierPoolType.PLAYER);
    const entry = Object.values(ModifierTier)
      .filter((t): t is ModifierTier => typeof t === "number")
      .map(t => pool[t]?.find(w => w.modifierType.id === "MEMORY_MUSHROOM"))
      .find(w => w != null);
    expect(entry).toBeDefined();
    return entry!.weight as WeightedModifierTypeWeightFunc;
  }

  it("Kadabra no longer lists Trick, Machop no longer lists Bide; every entry is implemented and not a Z / Max move", async () => {
    await game.classicMode.startBattle(SpeciesId.KADABRA, SpeciesId.MACHOP);
    const [kadabra, machop] = game.scene.getPlayerParty();

    expect(allMoves[MoveId.TRICK].isUnimplemented).toBe(true);
    expect(allMoves[MoveId.BIDE].isUnimplemented).toBe(true);
    // the species data still has them (level 46 / level 5)...
    expect(allLevelMoves(kadabra)).toContain(MoveId.TRICK);
    expect(allLevelMoves(machop)).toContain(MoveId.BIDE);

    // ...but the relearn list does not, and keeps the implemented moves around them
    const kadabraMoves = kadabra.getLearnableLevelMoves().map(([, m]) => m);
    expect(kadabraMoves).not.toContain(MoveId.TRICK);
    expect(kadabraMoves).toContain(MoveId.CALM_MIND);
    expect(kadabraMoves).toContain(MoveId.FUTURE_SIGHT);
    const machopMoves = machop.getLearnableLevelMoves().map(([, m]) => m);
    expect(machopMoves).not.toContain(MoveId.BIDE);
    expect(machopMoves).toContain(MoveId.KARATE_CHOP);

    for (const pokemon of [kadabra, machop]) {
      for (const [, moveId] of pokemon.getLearnableLevelMoves()) {
        expect(allMoves[moveId].isUnimplemented, MoveId[moveId]).toBe(false);
        expect(isZMaxOnlyMove(moveId), MoveId[moveId]).toBe(false);
      }
    }
  });

  it("leaves out unimplemented and Z / Max ids among used TMs too, and keeps the rest", async () => {
    await game.classicMode.startBattle(SpeciesId.KADABRA);
    const kadabra = game.field.getPlayerPokemon();
    expect(isZMaxOnlyMove(MoveId.MAX_FLARE)).toBe(true);
    kadabra.usedTMs.push(MoveId.THUNDERBOLT, MoveId.MAX_FLARE, MoveId.TRICK);

    const learnable = kadabra.getLearnableLevelMoves();
    expect(learnable.find(([, m]) => m === MoveId.THUNDERBOLT)?.[2]).toBe(LearnableMoveSource.TM);
    expect(learnable.some(([, m]) => m === MoveId.MAX_FLARE)).toBe(false);
    expect(learnable.some(([, m]) => m === MoveId.TRICK)).toBe(false);
  });

  it("the Memory Mushroom's index still picks the move shown at that position", async () => {
    await game.classicMode.startBattle(SpeciesId.KADABRA);
    const kadabra = game.field.getPlayerPokemon();
    const learnable = kadabra.getLearnableLevelMoves();
    const unshift = vi.spyOn(game.scene.phaseManager, "unshiftNew");

    // Calm Mind (level 48) comes after Trick (level 46) in the species data, so its index used to be one higher
    for (const moveId of [MoveId.CALM_MIND, MoveId.FUTURE_SIGHT, learnable[0][1], learnable.at(-1)![1]]) {
      const index = learnable.findIndex(([, m]) => m === moveId);
      expect(index, MoveId[moveId]).toBeGreaterThanOrEqual(0);
      const modifier = memoryMushroom().newModifier(kadabra, index) as RememberMoveModifier;
      expect(modifier.levelMoveIndex).toBe(index);
      unshift.mockClear();
      modifier.apply(kadabra);
      expect(unshift).toHaveBeenCalledWith("LearnMovePhase", 0, moveId, LearnMoveType.MEMORY, undefined);
    }
  });

  it("a Pokémon whose only relearnable move is unimplemented cannot take the Memory Mushroom, and the reward is left out", async () => {
    await game.classicMode.startBattle(SpeciesId.MACHOP);
    const machop = game.field.getPlayerPokemon();
    // Level 5 Machop knowing its three earlier moves: Bide (level 5) is the only one left
    machop.level = 5;
    game.move.changeMoveset(machop, [MoveId.LEER, MoveId.LOW_KICK, MoveId.FOCUS_ENERGY]);
    // (private) no egg moves, whatever the test save has unlocked
    vi.spyOn(machop as unknown as { getUnlockedEggMoves(): MoveId[] }, "getUnlockedEggMoves").mockReturnValue([]);
    machop.usedTMs = [];
    const known = new Set(machop.moveset.map(m => m.moveId));
    expect(allLevelMoves(machop).filter(m => !known.has(m))).toEqual([MoveId.BIDE]);

    expect(machop.getLearnableLevelMoves()).toEqual([]);
    const type = memoryMushroom();
    expect(type.selectFilter?.(machop)).toBe(PartyUiHandler.NoEffectMessage);
    expect(memoryMushroomWeight()([machop], 0)).toBe(0);

    // one implemented move to relearn makes it eligible again
    game.move.changeMoveset(machop, [MoveId.LEER, MoveId.LOW_KICK]);
    expect(machop.getLearnableLevelMoves().map(([, m]) => m)).toEqual([MoveId.FOCUS_ENERGY]);
    expect(type.selectFilter?.(machop)).toBeNull();
    expect(memoryMushroomWeight()([machop], 0)).toBeGreaterThan(0);
  });
});
