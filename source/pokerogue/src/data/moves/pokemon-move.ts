/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { allMoves } from "#data/data-lists";
import { ChallengeType } from "#enums/challenge-type";
import { MoveId } from "#enums/move-id";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
// Local fork (2026-11-16): Z / Max moves (per-slot conversion)
import type { MoveTransform, MoveTransformKind } from "#moves/move-transform";
import { applyChallenges } from "#utils/challenge-utils";
import { BooleanHolder, toDmgValue } from "#utils/common";
import i18next from "i18next";

/** Local fork (2026-11-16): Z / Max moves. The kinds a slot's conversion can have (a saved one with any other is dropped) */
export const MOVE_TRANSFORM_KINDS: readonly MoveTransformKind[] = Object.freeze([
  "max",
  "gmax",
  "z",
  "zExclusive",
  "zMax",
]);

/**
 * Local fork (2026-11-16): Z / Max moves. Builds a converted slot's derived move (`getTransformedMove`). It is handed
 * in by move-transform.ts when that module loads ({@linkcode setTransformedMoveResolver}) instead of being imported:
 * move-transform.ts imports the move classes (move.ts), and move.ts imports this module (dependency inversion, no
 * import cycle).
 */
let transformedMoveResolver: ((baseId: MoveId, transform: MoveTransform) => Move) | undefined;

/**
 * Local fork (2026-11-16): Z / Max moves. Called once by move-transform.ts (see {@linkcode transformedMoveResolver})
 * @param resolver - Returns the derived move of `baseId` converted by `transform` (cached there)
 */
export function setTransformedMoveResolver(resolver: (baseId: MoveId, transform: MoveTransform) => Move): void {
  transformedMoveResolver = resolver;
}

/**
 * Local fork (2026-11-16): Z / Max moves. A checked copy of a saved conversion: `undefined` unless it is an object with
 * a known kind and a move id that exists in `allMoves`, so an edited or broken save never breaks the slot.
 * @param source - The saved value
 */
export function loadMoveTransform(source: unknown): MoveTransform | undefined {
  if (source == null || typeof source !== "object") {
    return;
  }
  const { kind, moveId } = source as Partial<MoveTransform>;
  if (
    typeof kind !== "string"
    || !(MOVE_TRANSFORM_KINDS as readonly string[]).includes(kind)
    || typeof moveId !== "number"
    || allMoves[moveId] === undefined
  ) {
    return;
  }
  return { kind: kind as MoveTransformKind, moveId };
}

/**
 * Wrapper class for the {@linkcode Move} class for Pokemon to interact with.
 * These are the moves assigned to a {@linkcode Pokemon} object.
 * It links to {@linkcode Move} class via the move ID.
 * Compared to {@linkcode Move}, this class also tracks things like
 * PP Ups received, PP used, etc.
 * @see {@linkcode isUsable} - checks if move is restricted, out of PP, or not implemented.
 * @see {@linkcode getMove} - returns {@linkcode Move} object by looking it up via ID.
 * @see {@linkcode usePp} - removes a point of PP from the move.
 * @see {@linkcode getMovePp} - returns amount of PP a move currently has.
 * @see {@linkcode getPpRatio} - returns the current PP amount / max PP amount.
 * @see {@linkcode getName} - returns name of {@linkcode Move}.
 */
export class PokemonMove {
  public moveId: MoveId;
  // TODO: Consider making this readonly outside the class (since we provide functions to alter it already)
  public ppUsed: number;
  public ppUp: number;

  /**
   * If defined and nonzero, overrides the maximum PP of the move (e.g., due to move being copied by Transform).
   * This also nullifies all effects of `ppUp`.
   */
  public maxPpOverride?: number | undefined;

  /**
   * Local fork (2026-11-16): what this slot was permanently converted into (다이사탕 / Z 크리스탈), or `undefined`.
   * `moveId` stays the original move; {@linkcode getMove} returns the derived Max / G-Max / Z move (move-transform.ts).
   * Plain data, saved with the slot; the derived move is cached in move-transform.ts, never on this object.
   */
  public transform?: MoveTransform | undefined;

  constructor(moveId: MoveId, ppUsed = 0, ppUp = 0, maxPpOverride?: number, transform?: MoveTransform) {
    this.moveId = moveId;
    this.ppUsed = ppUsed;
    this.ppUp = ppUp;
    this.maxPpOverride = maxPpOverride;
    // Local fork (2026-11-16): Z / Max moves. Only set when present, so an unconverted slot serializes as before
    if (transform) {
      this.transform = { kind: transform.kind, moveId: transform.moveId };
    }
  }

  /**
   * Checks whether this move can be performed by a Pokemon, without consideration for the move's targets.
   * The move is unusable if it is out of PP, restricted by an effect, or unimplemented.
   *
   * @param pokemon - The {@linkcode Pokemon} attempting to use this move
   * @param ignorePp - Whether to ignore checking if the move is out of PP; default `false`
   * @param forSelection - Whether this is being checked for move selection; default `false`
   * @returns A tuple containing a boolean indicating whether the move can be selected, and a string with the reason if it cannot
   */
  public isUsable(pokemon: Pokemon, ignorePp = false, forSelection = false): [usable: boolean, preventionText: string] {
    const move = this.getMove();
    const moveName = move.name;

    // TODO: Add Sky Drop's 1 turn stall
    if (this.moveId === MoveId.NONE || move.isUnimplemented) {
      return [false, i18next.t("battle:moveNotImplemented", { moveName: moveName.replace(" (N)", "") })];
    }

    if (!ignorePp && this.isOutOfPp()) {
      return [false, i18next.t("battle:moveNoPp", { moveName: move.name })];
    }

    if (forSelection) {
      const result = pokemon.isMoveSelectable(this.moveId);
      if (!result[0]) {
        return result;
      }
    }

    const usability = new BooleanHolder(true);
    if (pokemon.isPlayer() && applyChallenges(ChallengeType.POKEMON_MOVE, this.moveId, usability) && !usability.value) {
      return [false, i18next.t("battle:moveCannotUseChallenge", { moveName: move.name })];
    }

    return [true, ""];
  }

  getMove(): Move {
    // Local fork (2026-11-16): Z / Max moves. A converted slot behaves as its derived move (cached per conversion)
    if (this.transform) {
      if (transformedMoveResolver) {
        return transformedMoveResolver(this.moveId, this.transform);
      }
      console.warn("PokemonMove.getMove: move-transform.ts is not loaded; using the base move");
    }
    return allMoves[this.moveId];
  }

  /**
   * Consume up to `count` PP from this move (up to its maximum PP).
   * @param count - (Default `1`) The amount of PP to use
   */
  public usePp(count = 1): void {
    this.ppUsed = Math.min(this.ppUsed + count, this.getMovePp());
  }

  // TODO: Rename to `getMaxPP`; the current name is obscure and frankly stupid
  getMovePp(): number {
    // Local fork (2026-11-16): Z / Max moves. Always the original move's PP (a converted slot keeps its PP and PP Ups)
    const basePp = allMoves[this.moveId].pp;
    return this.maxPpOverride || basePp + this.ppUp * toDmgValue(basePp / 5);
  }

  getPpRatio(): number {
    return 1 - this.ppUsed / this.getMovePp();
  }

  /**
   * @returns Whether this move is out of PP.
   */
  // TODO: Replace checks comparing `getPpRatio` with 0 to use this instead
  public isOutOfPp(): boolean {
    return this.getMovePp() !== -1 && this.ppUsed >= this.getMovePp();
  }

  getName(): string {
    return this.getMove().name;
  }

  /**
   * Copies an existing move or creates a valid {@linkcode PokemonMove} object from json representing one
   * @param source The data for the move to copy; can be a {@linkcode PokemonMove} or JSON object representing one
   * @returns A valid {@linkcode PokemonMove} object
   */
  static loadMove(source: PokemonMove | any): PokemonMove {
    // Local fork (2026-11-16): Z / Max moves. The conversion is copied (a new object, never shared with `source`) and
    // checked, so a bad saved value drops the conversion instead of breaking the slot
    return new PokemonMove(
      source.moveId,
      source.ppUsed,
      source.ppUp,
      source.maxPpOverride,
      loadMoveTransform(source.transform),
    );
  }
}
