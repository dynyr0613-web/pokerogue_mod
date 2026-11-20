// Local fork (2026-11-19): Pursuit (따라가때리기) (the user: "e2 구현"). When a Pokémon switches out as its turn command,
// every opposing Pokémon that chose Pursuit this turn and has not moved yet hits it before it leaves, at double power,
// and does not move again later in the turn (main series, Generation IV on: in a Double Battle any adjacent foe that
// switches is caught, whichever target was chosen). `SwitchSummonPhase` calls `queuePursuitBeforeSwitch` and goes back
// in the queue behind the Pursuit; the move's power attribute asks `isPursuitIntercept`.
// Local fork (2026-11-20): as in the main series, Generations IV-VII (the user: "따라가때리기 - 본가 그대로"):
// - A Pokémon leaving through its own switching move (U-turn, Volt Switch, Flip Turn, Parting Shot, Chilly Reception:
//   `ForceSwitchOutAttr` with `SwitchType.SWITCH`) is caught too, after its move and before it goes
//   (`ForceSwitchOutAttr.apply` hands the switch to `SwitchPhase` / `SwitchSummonPhase` with the `"check"` stage).
//   Teleport would be too, but it moves last (priority -6), after any Pursuit.
//   Baton Pass and Shed Tail are not caught (main series; Pokémon Showdown's `skipPursuit`), nor a forced switch (Roar,
//   Whirlwind, Dragon Tail, Circle Throw), nor Wimp Out / Emergency Exit, nor a wild Pokémon fleeing.
// - Against a Pokémon it catches, Pursuit never misses (`isPursuitIntercept`, Pursuit's accuracy attribute) and the
//   switcher's Destiny Bond is gone first (it has already started leaving), so it takes nobody down with it.
// This module imports nothing from the move or phase modules at run time, so move.ts can import it.

import { globalScene } from "#app/global-scene";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { MovePhaseTimingModifier } from "#enums/move-phase-timing-modifier";
import type { Pokemon } from "#field/pokemon";
import type { MoveEndPhase } from "#phases/move-end-phase";
import type { MovePhase } from "#phases/move-phase";

/** A Pursuit moved in front of a switching target: whom it hits, and when */
interface PursuitIntercept {
  readonly targetId: number;
  readonly waveIndex: number;
  readonly turn: number;
}

/** Pursuit users (by Pokémon id) whose queued Pursuit was moved in front of a switching foe */
const intercepts = new Map<number, PursuitIntercept>();

/**
 * @returns Whether `user`'s Pursuit is hitting `target` as it switches out this turn (Pursuit's power is then doubled)
 */
export function isPursuitIntercept(user: Pokemon, target: Pokemon): boolean {
  const entry = intercepts.get(user.id);
  const battle = globalScene.currentBattle;
  return (
    entry != null
    && battle != null
    && entry.targetId === target.id
    && entry.waveIndex === battle.waveIndex
    && entry.turn === battle.turn
  );
}

/**
 * Local fork (2026-11-19), E2 review: whether a Pursuit is catching `pokemon` as it switches out this turn (main series:
 * it is "being called back"). Wimp Out / Emergency Exit do not activate then, since it is already leaving; before this
 * the Pursuit hit queued a second switch on top of the chosen one, which could even send the Wimp Out user back in.
 */
export function isPursuitSwitcher(pokemon: Pokemon): boolean {
  const battle = globalScene.currentBattle;
  if (battle == null) {
    return false;
  }
  for (const entry of intercepts.values()) {
    if (entry.targetId === pokemon.id && entry.waveIndex === battle.waveIndex && entry.turn === battle.turn) {
      return true;
    }
  }
  return false;
}

/** Forget every Pursuit interception (the switch it went before has come round) */
export function clearPursuitIntercepts(): void {
  intercepts.clear();
}

/** @returns Whether `phase` is a not-yet-run Pursuit of a foe of `switcher` that is still on the field */
function isPendingPursuit(phase: MovePhase, switcher: Pokemon): boolean {
  return (
    phase.move.getMove().id === MoveId.PURSUIT && phase.pokemon.isActive(true) && phase.pokemon.isOpponent(switcher)
  );
}

/**
 * Local fork (2026-11-20): whether a foe of `switcher` chose Pursuit this turn and has not moved yet (so `switcher`'s
 * switching move must leave its switch to the `"check"` stage, see {@linkcode queuePursuitBeforeSwitch})
 */
export function hasPendingPursuit(switcher: Pokemon): boolean {
  return switcher.isActive(true) && globalScene.phaseManager.getMovePhase(p => isPendingPursuit(p, switcher)) != null;
}

/**
 * Move every opposing Pursuit still waiting this turn in front of `switcher`'s switch: each such `MovePhase` leaves its
 * place in the move order, targets `switcher` and is queued to run next (its dynamic marker goes with it). The caller
 * puts the switch back in the queue right after.
 * @param switcher - The Pokémon about to switch out as its turn command (or, since 2026-11-20, through its own
 * switching move)
 * @returns Whether any Pursuit was moved (the caller must then not switch yet)
 */
export function queuePursuitBeforeSwitch(switcher: Pokemon): boolean {
  if (!switcher.isActive(true)) {
    return false;
  }

  const phaseManager = globalScene.phaseManager;
  const pursuers: MovePhase[] = [];
  let phase = phaseManager.getMovePhase(p => isPendingPursuit(p, switcher));
  while (phase != null) {
    pursuers.push(phase);
    phase = phaseManager.getMovePhase(p => !pursuers.includes(p) && isPendingPursuit(p, switcher));
  }
  if (pursuers.length === 0) {
    return false;
  }

  // Local fork (2026-11-20): the switcher has already started leaving, so its Destiny Bond (used last turn) no longer
  // holds: a Pursuit that knocks it out is not taken down with it (main series; Pokémon Showdown removes it in
  // Pursuit's `onFoeBeforeSwitchOut`)
  switcher.removeTag(BattlerTagType.DESTINY_BOND);

  // Local fork (2026-11-20): a switching move (U-turn ...) finishes first. Its switch was deferred to run before the
  // move's own `MoveEndPhase`; that phase now comes to the front, so the Pursuit (queued after the first `MoveEndPhase`
  // in the queue) runs right after it, and the switch the caller puts back comes after the Pursuit. The innermost one is
  // taken, for a switching move called by another move (Metronome ...)
  let switchMoveEnd: MoveEndPhase | undefined;
  phaseManager.hasPhaseOfType("MoveEndPhase", p => {
    if (p.getPokemon() === switcher) {
      switchMoveEnd = p;
    }
    return false;
  });
  if (switchMoveEnd != null) {
    const moveEnd = switchMoveEnd;
    phaseManager.tryRemovePhase("MoveEndPhase", p => p === moveEnd);
    phaseManager.unshiftPhase(moveEnd);
  }

  const battle = globalScene.currentBattle;
  for (const pursuit of pursuers) {
    // Take it out of the move order along with one move marker, then queue it again (with a fresh marker) to go first
    phaseManager.tryRemovePhase("MovePhase", p => p === pursuit);
    phaseManager.tryRemovePhase("DynamicPhaseMarker", marker => marker.phaseType === "MovePhase");
    pursuit.timingModifier = MovePhaseTimingModifier.FIRST;
    pursuit.targets.splice(0, pursuit.targets.length, switcher.getBattlerIndex());
    intercepts.set(pursuit.pokemon.id, { targetId: switcher.id, waveIndex: battle.waveIndex, turn: battle.turn });
    // Local fork (2026-11-19), E2 review: a pursuer that Terastallizes this turn does so before its Pursuit (main
    // series); its `TeraPhase`, queued behind the switches, would otherwise come only after the Pursuit
    if (phaseManager.tryRemovePhase("TeraPhase", p => p.pokemon === pursuit.pokemon)) {
      phaseManager.unshiftNew("TeraPhase", pursuit.pokemon);
    }
    phaseManager.unshiftPhase(pursuit);
  }
  return true;
}
