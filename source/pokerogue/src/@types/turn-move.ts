import type { BattlerIndex } from "#enums/battler-index";
import type { MoveId } from "#enums/move-id";
import type { MoveResult } from "#enums/move-result";
import type { MoveStyle } from "#enums/move-style";
import type { MoveUseMode } from "#enums/move-use-mode";
import type { PokemonType } from "#enums/pokemon-type";

/** A record of a move having been used. */
export interface TurnMove {
  /**
   * The move used. Local fork (2026-11-16): for a converted move slot (Max / G-Max / Z move, see
   * `src/data/moves/move-transform.ts`) this stays the slot's ORIGINAL move, so Encore, Disable, Torment, Choice locks
   * and Copycat keep working on the slot and copy the base move, as in the main games.
   */
  move: MoveId;
  targets: BattlerIndex[];
  useMode: MoveUseMode;
  result?: MoveResult | undefined;
  /**
   * Local fork (2026-11-16): the id of the Max / G-Max / Z move the slot behaved as, when it differs from
   * {@linkcode move} (a converted slot); `undefined` otherwise. Readers that need the move's own properties (the
   * Protect chain counts Max Guard made from Tail Whip) use `derivedMoveId ?? move`. Saved with the move history;
   * older saves simply lack it.
   */
  derivedMoveId?: MoveId | undefined;
  /**
   * Local fork (2026-11-19): the type the move was used as, when it differs from that move's own type (Weather Ball in
   * rain, Hidden Power, Normalize / Pixilate, Electrify, Ion Deluge ...; set by `MoveEffectPhase`); `undefined`
   * otherwise. Conversion 2 reads it (the user: "e2 구현"). Saved with the move history; older saves simply lack it.
   */
  moveType?: PokemonType | undefined;
  /**
   * Local fork (2026-11-20): S1 move styles. Only on the attack turn a two-turn move queues after its charging turn
   * (`MoveChargePhase`), so that turn keeps the style the player chose (강공 / 속공); `undefined` everywhere else (중공).
   * Saved with the move queue; older saves simply lack it.
   */
  moveStyle?: MoveStyle | undefined;
}
