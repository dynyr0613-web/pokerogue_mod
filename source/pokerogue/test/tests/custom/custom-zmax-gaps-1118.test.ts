// Local fork (2026-11-18): the rare Z / Max gaps of docs/Z다이_기술_20261116.md §4 (the user: "작은 정리부터 하도록
// 하죠"). A converted slot (Max / G-Max / Z move, move-transform.ts) counts as the move it became where the move's
// own properties matter:
// - Throat Chop no longer stops a Max move made from a sound move; Heal Block no longer stops Max Guard made from a
//   healing move (restrictions that name a move — Disable, Encore, Torment, Choice locks — stay slot-based);
// - Z다이검무 has its own description (+4), not 다이검무's (+3);
// - the battle remembers the move a converted slot was used as (`Battle.lastMoveUsedAs`), so a Max move made from
//   U-turn is not a switching move for SwitchSummonPhase's turn make-up, and Max Guard made from Baton Pass is not
//   Baton Pass for the party screen.

import { allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import type { PlayerPokemon } from "#field/pokemon";
import { ZCrystalModifierType } from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import i18next from "i18next";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Z / Max gaps 2026-11-18: a converted slot's own properties", () => {
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

  async function startMelmetal(moves: MoveId[]): Promise<PlayerPokemon> {
    await game.classicMode.startBattle(SpeciesId.MELMETAL);
    const melmetal = game.field.getPlayerPokemon();
    game.move.changeMoveset(melmetal, moves);
    return melmetal;
  }

  /** Use a 다이사탕 on move `moveIndex` of `pokemon`, as the reward screen does after "yes" */
  function useCandy(pokemon: PlayerPokemon, moveIndex: number): boolean {
    return game.scene.addModifier(modifierTypes.DYNAMAX_CANDY().newModifier(pokemon, moveIndex)!);
  }

  it("Throat Chop stops a sound move but not the Max move made from one", async () => {
    const melmetal = await startMelmetal([MoveId.HYPER_VOICE, MoveId.SNARL, MoveId.TACKLE]);
    melmetal.addTag(BattlerTagType.THROAT_CHOPPED);
    expect(melmetal.isMoveSelectable(MoveId.HYPER_VOICE)[0]).toBe(false);
    expect(melmetal.isMoveSelectable(MoveId.SNARL)[0]).toBe(false);

    expect(useCandy(melmetal, 0)).toBe(true);
    expect(melmetal.moveset[0].transform?.kind).toBe("max");
    expect(melmetal.isMoveSelectable(MoveId.HYPER_VOICE)).toEqual([true, ""]);
    // The other sound move is still stopped, a plain move never was
    expect(melmetal.isMoveSelectable(MoveId.SNARL)[0]).toBe(false);
    expect(melmetal.isMoveSelectable(MoveId.TACKLE)[0]).toBe(true);

    // And it is used, not cancelled before it moves
    game.move.select(MoveId.HYPER_VOICE);
    await game.toNextTurn();
    expect(melmetal).toHaveUsedMove({ move: MoveId.HYPER_VOICE, derivedMoveId: melmetal.moveset[0].transform!.moveId });
  });

  it("a called move is the plain move: Sleep Talk calling a converted sound slot is still stopped by Throat Chop", async () => {
    // Review 2026-11-18: the pre-move check judges the move being used, not the user's slot of the same id
    game.override.statusEffect(StatusEffect.SLEEP);
    const melmetal = await startMelmetal([MoveId.HYPER_VOICE, MoveId.SLEEP_TALK]);
    expect(useCandy(melmetal, 0)).toBe(true);
    melmetal.addTag(BattlerTagType.THROAT_CHOPPED);
    game.move.select(MoveId.SLEEP_TALK);
    await game.toNextTurn();
    // Sleep Talk ran and called Hyper Voice (its only other move), which Throat Chop cancelled
    const history = melmetal.getMoveHistory().map(m => m.move);
    expect(history).toContain(MoveId.SLEEP_TALK);
    expect(game.field.getEnemyPokemon().isFullHp()).toBe(true);
  });

  it("Heal Block stops a healing move but not Max Guard made from one", async () => {
    const melmetal = await startMelmetal([MoveId.RECOVER, MoveId.ROOST, MoveId.TACKLE]);
    melmetal.addTag(BattlerTagType.HEAL_BLOCK, 5);
    expect(melmetal.isMoveSelectable(MoveId.RECOVER)[0]).toBe(false);

    expect(useCandy(melmetal, 0)).toBe(true);
    expect(melmetal.moveset[0].transform).toEqual({ kind: "max", moveId: MoveId.MAX_GUARD });
    expect(melmetal.isMoveSelectable(MoveId.RECOVER)).toEqual([true, ""]);
    expect(melmetal.isMoveSelectable(MoveId.ROOST)[0]).toBe(false);
  });

  it("restrictions that name a move stay on the slot (Disable)", async () => {
    const melmetal = await startMelmetal([MoveId.HYPER_VOICE, MoveId.TACKLE]);
    expect(useCandy(melmetal, 0)).toBe(true);
    game.move.select(MoveId.HYPER_VOICE);
    await game.toNextTurn();
    melmetal.addTag(BattlerTagType.DISABLED, 4, MoveId.DISABLE, game.field.getEnemyPokemon().id);
    expect(melmetal.isMoveSelectable(MoveId.HYPER_VOICE)[0]).toBe(false);
  });

  it("describes Z다이검무 with its own +4, not 다이검무's +3", async () => {
    const melmetal = await startMelmetal([MoveId.SWORDS_DANCE, MoveId.TACKLE]);
    expect(useCandy(melmetal, 0)).toBe(true);
    const maxSwordsDance = melmetal.moveset[0].getMove().effect;
    expect(game.scene.addModifier(new ZCrystalModifierType(PokemonType.NORMAL).newModifier(melmetal, 0)!)).toBe(true);
    expect(melmetal.moveset[0].transform).toEqual({ kind: "zMax", moveId: MoveId.MAX_SWORDS_DANCE });
    const effect = melmetal.moveset[0].getMove().effect;
    expect(effect).toBe(i18next.t("battle:zMaxSwordsDanceEffect"));
    expect(effect).not.toBe(maxSwordsDance);
    expect(effect).toContain("four");
  });

  it("Max Guard made from Baton Pass is recorded as Max Guard, which passes nothing (party screen check)", async () => {
    game.override.enemySpecies(SpeciesId.REGIELEKI);
    const melmetal = await startMelmetal([MoveId.BATON_PASS, MoveId.TACKLE]);
    expect(useCandy(melmetal, 0)).toBe(true);
    expect(melmetal.moveset[0].transform).toEqual({ kind: "max", moveId: MoveId.MAX_GUARD });
    game.move.select(MoveId.BATON_PASS);
    await game.toNextTurn();
    const last = melmetal.getLastXMoves(1)[0];
    expect(last.move).toBe(MoveId.BATON_PASS);
    expect(last.derivedMoveId).toBe(MoveId.MAX_GUARD);
    // What PartyUiHandler.isBatonPassMove reads
    expect(allMoves[last.derivedMoveId ?? last.move].getAttrs("ForceSwitchOutAttr")[0]?.isBatonPass()).toBeFalsy();
    expect(allMoves[MoveId.BATON_PASS].getAttrs("ForceSwitchOutAttr")[0]?.isBatonPass()).toBe(true);
    expect(game.field.getPlayerPokemon()).toBe(melmetal);
  });

  it("remembers the move a converted slot was used as: a Max move made from U-turn is not a switching move", async () => {
    // The foe moves first, so the player's move is the battle's last one at the turn's end
    game.override.enemySpecies(SpeciesId.REGIELEKI);
    const melmetal = await startMelmetal([MoveId.U_TURN, MoveId.TACKLE]);
    expect(useCandy(melmetal, 0)).toBe(true);
    expect(melmetal.moveset[0].transform).toEqual({ kind: "max", moveId: MoveId.MAX_FLUTTERBY });

    game.move.select(MoveId.U_TURN);
    await game.toNextTurn();
    const battle = game.scene.currentBattle;
    // Copycat still copies the slot's own move; the switch check reads the move it was used as
    expect(battle.lastMove).toBe(MoveId.U_TURN);
    expect(battle.lastMoveUsedAs).toBe(MoveId.MAX_FLUTTERBY);
    // It did not switch out
    expect(game.field.getPlayerPokemon()).toBe(melmetal);

    // A plain move clears it
    game.move.select(MoveId.TACKLE);
    await game.toNextTurn();
    expect(battle.lastMove).toBe(MoveId.TACKLE);
    expect(battle.lastMoveUsedAs).toBeUndefined();
  });
});
