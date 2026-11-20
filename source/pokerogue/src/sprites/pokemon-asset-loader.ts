import { initMoveAnim, loadMoveAnimAssets, queueFlameAnimAssets } from "#data/battle-anims";
import type { MoveId } from "#enums/move-id";
import type { Pokemon } from "#field/pokemon";

/**
 * Asynchronously load the animations and assets for the provided moves.
 * @param moveIds - An array of move IDs to load assets for.
 * @param user - Local fork (2026-11-20, items V1 / V2): the Pokémon that uses them; its flame colour copies are queued
 *   too (`queueFlameAnimAssets`)
 */
export async function loadMoveAnimations(moveIds: MoveId[], user?: Pokemon): Promise<void> {
  await Promise.allSettled(moveIds.map(m => initMoveAnim(m)));
  await loadMoveAnimAssets(moveIds);
  if (user) {
    queueFlameAnimAssets(moveIds, user);
  }
}
