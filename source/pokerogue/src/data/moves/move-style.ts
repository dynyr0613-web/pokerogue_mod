/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Local fork (2026-11-20): move styles, S1 of 1.2.0. The user: "기술 선택 후 강공(위력 1.5배, 추가효과 변경 x, 선공기일
 * 경우 우선도 -1에 위력 2배), 중공(그대로), 속공(위력 0.8배, 우선도 +1) / 변화기에 해당 x, 드래곤테일 해당 x,
 * 속이기/만나자마자/기선제압 같은 경우는 가능".
 *
 * How it runs:
 * - After the player picks a damaging move, the fight menu asks 강공 / 중공 / 속공 (`FightUiHandler`; the setting
 *   "기술 스타일 선택" turns the question off). The answer goes into the turn command (`TurnCommand.moveStyle`,
 *   `CommandPhase.handleCommand`), and `TurnStartPhase` hands it to that command's `MovePhase` only (`MovePhase.moveStyle`).
 * - The move order reads it from the queued phase (`MovePhasePriorityQueue` passes it to `Move.getPriority`); Upper Hand
 *   reads it from the turn command ({@linkcode getCommandedMoveStyle}).
 * - From its `MovePhase` until its `MoveEndPhase` the move use is "in flight" (`PokemonTurnData.moveStyleUse`), and
 *   `Move.getPriority` (Psychic Terrain, Quick Guard, Dazzling ...) and `Move.calculateBattlePower` (every hit of a
 *   multi-hit move) read it there ({@linkcode getActiveMoveStyle}). Encore changing the move, Instruct, Dancer and
 *   every called or copied move are other `MovePhase`s, so they are 중공.
 * - The attack turn of a two-turn move (Solar Beam, Fly ...) keeps the style of its charging turn (`MoveChargePhase`
 *   puts it in the queued move, `TurnMove.moveStyle`); the later turns of Outrage, Rollout ... are 중공.
 * - Enemies never use a style; PP use is unchanged.
 */

import { globalScene } from "#app/global-scene";
import { Command } from "#enums/command";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { MoveStyle } from "#enums/move-style";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import type { PokemonMove } from "#moves/pokemon-move";
import { isZMaxOnlyMove } from "#moves/zmax-data";

/** What a style does to a move */
export interface MoveStyleRule {
  /** Added to the move's priority (relative: Quick Attack +1 becomes 0 in 강공) */
  readonly priorityShift: number;
  /** The move's power is multiplied by this */
  readonly powerMultiplier: number;
  /** The power multiplier instead, for a move whose own priority is above 0 (Quick Attack, Fake Out ...) */
  readonly priorityMovePowerMultiplier: number;
}

/**
 * The numbers of each style, in one place. 강공: priority -1, power x1.5, x2 for a move whose own priority is above 0;
 * 속공: priority +1, power x0.8; 중공: nothing. Secondary effects (chances included) are never changed.
 */
export const MOVE_STYLE_RULES: Readonly<Record<MoveStyle, MoveStyleRule>> = Object.freeze({
  [MoveStyle.NORMAL]: Object.freeze({ priorityShift: 0, powerMultiplier: 1, priorityMovePowerMultiplier: 1 }),
  [MoveStyle.STRONG]: Object.freeze({ priorityShift: -1, powerMultiplier: 1.5, priorityMovePowerMultiplier: 2 }),
  [MoveStyle.AGILE]: Object.freeze({ priorityShift: 1, powerMultiplier: 0.8, priorityMovePowerMultiplier: 0.8 }),
});

/** The styles in the order the menu lists them */
export const MOVE_STYLE_MENU_ORDER: readonly MoveStyle[] = Object.freeze([
  MoveStyle.STRONG,
  MoveStyle.NORMAL,
  MoveStyle.AGILE,
]);

/** The style the menu's cursor starts on */
export const MOVE_STYLE_DEFAULT: MoveStyle = MoveStyle.NORMAL;

/**
 * Damaging moves that never get a style: Dragon Tail (the user: "드래곤테일 해당 x") and Circle Throw, the other
 * priority -6 attack that forces the target out
 */
export const MOVE_STYLE_EXCLUDED_MOVES: ReadonlySet<MoveId> = new Set([MoveId.DRAGON_TAIL, MoveId.CIRCLE_THROW]);

/**
 * Whether attacks whose damage does not come from their power get no style: fixed or HP-based damage (Seismic Toss,
 * Night Shade, Super Fang, Endeavor, Final Gambit, Counter, Mirror Coat ...) and one-hit KO moves. A power change does
 * nothing to them, so 속공 would only make them sooner.
 */
export const MOVE_STYLE_SKIPS_FIXED_DAMAGE = true;

/**
 * Whether the player is asked for a style when choosing this move slot: a player's damaging move that is not a Z-Move,
 * Max or G-Max move (a converted slot), Struggle, one of {@linkcode MOVE_STYLE_EXCLUDED_MOVES}, a delayed attack or
 * (with {@linkcode MOVE_STYLE_SKIPS_FIXED_DAMAGE}) a fixed-damage or one-hit KO move. Fake Out, First Impression, Upper
 * Hand and multi-hit moves are offered.
 *
 * Delayed attacks (Future Sight, Doom Desire; added after review, 2026-11-20) hit two turns later, long after the use's
 * `MoveEndPhase`, so the style's power never reaches the hit: the menu would show 강공 power the hit does not have,
 * and 속공 would only make the setup sooner.
 * @param pokemon - The Pokémon choosing the move
 * @param slot - The chosen move slot
 */
export function isMoveStyleOffered(pokemon: Pokemon, slot: PokemonMove | undefined): boolean {
  if (slot == null || !pokemon.isPlayer() || slot.transform != null) {
    return false;
  }
  const move = slot.getMove();
  if (
    move == null
    || move.category === MoveCategory.STATUS
    || move.id === MoveId.NONE
    || move.id === MoveId.STRUGGLE
    || MOVE_STYLE_EXCLUDED_MOVES.has(move.id)
    || isZMaxOnlyMove(move.id)
    || move.hasAttr("DelayedAttackAttr")
  ) {
    return false;
  }
  return !(MOVE_STYLE_SKIPS_FIXED_DAMAGE && (move.hasAttr("FixedDamageAttr") || move.hasAttr("OneHitKOAttr")));
}

/** @returns The priority change of `style` */
export function getMoveStylePriorityShift(style: MoveStyle | undefined): number {
  return MOVE_STYLE_RULES[style ?? MoveStyle.NORMAL]?.priorityShift ?? 0;
}

/**
 * @returns The power multiplier of `style` for `move`; a move counts as a priority move by its own priority (abilities
 * such as Gale Wings and Triage do not make it one)
 */
export function getMoveStylePowerMultiplier(style: MoveStyle | undefined, move: Move): number {
  const rule = MOVE_STYLE_RULES[style ?? MoveStyle.NORMAL];
  if (rule == null) {
    return 1;
  }
  return move.priority > 0 ? rule.priorityMovePowerMultiplier : rule.powerMultiplier;
}

/**
 * The style of `pokemon`'s move use in flight (from its `MovePhase` to its `MoveEndPhase`), when that use is `move`;
 * 중공 otherwise (no use in flight, another move, an enemy).
 */
export function getActiveMoveStyle(pokemon: Pokemon, move: Move): MoveStyle {
  const use = pokemon.turnData?.moveStyleUse;
  return use != null && use.move === move.id ? use.style : MoveStyle.NORMAL;
}

/** Mark the start of `pokemon`'s move use of `moveId` in `style` (`MovePhase.start`) */
export function startMoveStyleUse(pokemon: Pokemon, moveId: MoveId, style: MoveStyle): void {
  pokemon.turnData.moveStyleUse = style === MoveStyle.NORMAL ? undefined : { move: moveId, style };
}

/** Mark the end of `pokemon`'s move use (`MoveEndPhase`) */
export function endMoveStyleUse(pokemon: Pokemon): void {
  pokemon.turnData.moveStyleUse = undefined;
}

/**
 * The style `pokemon`'s turn command chose for `moveId`, before that move is used (Upper Hand checks the target's
 * chosen move this way); 중공 when the command is not that move.
 */
export function getCommandedMoveStyle(pokemon: Pokemon, moveId: MoveId): MoveStyle {
  const command = globalScene.currentBattle?.turnCommands[pokemon.getBattlerIndex()];
  if (command?.command !== Command.FIGHT || command.move?.move !== moveId) {
    return MoveStyle.NORMAL;
  }
  return command.moveStyle ?? MoveStyle.NORMAL;
}
