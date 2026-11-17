import type { BattlerIndex } from "#enums/battler-index";
import type { MoveId } from "#enums/move-id";
import type { DamageResult } from "#types/damage-result";

export interface AttackMoveResult {
  move: MoveId;
  /**
   * Local fork (2026-11-16): Z / Max moves. The Max / G-Max / Z move a converted slot was used as (`move` stays the
   * slot's original move, like move history's `TurnMove.derivedMoveId`); absent for an ordinary move
   */
  derivedMoveId?: MoveId;
  result: DamageResult;
  damage: number;
  critical: boolean;
  sourceId: number;
  sourceBattlerIndex: BattlerIndex;
}
