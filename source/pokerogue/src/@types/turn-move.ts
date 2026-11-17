import type { BattlerIndex } from "#enums/battler-index";
import type { MoveId } from "#enums/move-id";
import type { MoveResult } from "#enums/move-result";
import type { MoveUseMode } from "#enums/move-use-mode";

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
}
