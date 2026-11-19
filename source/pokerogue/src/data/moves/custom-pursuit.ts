// Local fork (2026-11-19): Pursuit (따라가때리기) (the user: "e2 구현"). When a Pokémon switches out as its turn command,
// every opposing Pokémon that chose Pursuit this turn and has not moved yet hits it before it leaves, at double power,
// and does not move again later in the turn (main series, Generation IV on: in a Double Battle any adjacent foe that
// switches is caught, whichever target was chosen). `SwitchSummonPhase` calls `queuePursuitBeforeSwitch` and goes back
// in the queue behind the Pursuit; the move's power attribute asks `isPursuitIntercept`.
// Not covered: a switch made by a move (U-turn, Volt Switch, Flip Turn, Parting Shot, Baton Pass ...) or forced (Roar,
// Red Card, Eject Button ...); only a switch chosen from the battle menu (or by an enemy trainer) is caught.
// This module imports nothing from the move or phase modules at run time, so move.ts can import it.

import { globalScene } from "#app/global-scene";
import { MoveId } from "#enums/move-id";
import { MovePhaseTimingModifier } from "#enums/move-phase-timing-modifier";
import type { Pokemon } from "#field/pokemon";
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
 * Move every opposing Pursuit still waiting this turn in front of `switcher`'s switch: each such `MovePhase` leaves its
 * place in the move order, targets `switcher` and is queued to run next (its dynamic marker goes with it). The caller
 * puts the switch back in the queue right after.
 * @param switcher - The Pokémon about to switch out as its turn command
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
