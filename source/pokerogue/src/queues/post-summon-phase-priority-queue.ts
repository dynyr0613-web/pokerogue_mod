import { globalScene } from "#app/global-scene";
import type { Pokemon } from "#field/pokemon";
import { PostSummonActivateAbilityPhase } from "#phases/post-summon-activate-ability-phase";
import type { PostSummonPhase } from "#phases/post-summon-phase";
import { DynamicPhasePriorityQueue } from "#queues/pokemon-phase-priority-queue";
import { sortInSpeedOrder } from "#utils/speed-order";

/**
 * Priority Queue for {@linkcode PostSummonPhase} and {@linkcode PostSummonActivateAbilityPhase}
 *
 * Orders phases first by ability priority, then by the {@linkcode Pokemon}'s effective speed
 */
export class PostSummonPhasePriorityQueue extends DynamicPhasePriorityQueue<PostSummonPhase> {
  protected override reorder(): void {
    this.queue = sortInSpeedOrder(this.queue);
    this.queue.sort((phaseA, phaseB) => phaseB.getPriority() - phaseA.getPriority());
  }

  public override push(phase: PostSummonPhase): void {
    super.push(phase);
    this.queueAbilityPhase(phase);
  }

  /**
   * Queues all necessary {@linkcode PostSummonActivateAbilityPhase}s for each pushed {@linkcode PostSummonPhase}
   * @param phase - The {@linkcode PostSummonPhase} that was pushed onto the queue
   */
  private queueAbilityPhase(phase: PostSummonPhase): void {
    if (phase instanceof PostSummonActivateAbilityPhase) {
      return;
    }

    const phasePokemon = phase.getPokemon();

    // Local fork (2026-11-14): custom moves. The same Pokémon's phases keep the order they are queued in (see
    // `sortInSpeedOrder`), normally the ability before the passive; `passiveActsFirstOnSummon` turns that around
    const slots = phasePokemon.getAbilityPriorities().map((priority, idx) => ({ priority, passive: idx !== 0 }));
    if (passiveActsFirstOnSummon(phasePokemon)) {
      slots.reverse();
    }
    for (const { priority, passive } of slots) {
      const activateAbilityPhase = new PostSummonActivateAbilityPhase(
        phasePokemon.getBattlerIndex(),
        priority,
        passive,
      );
      globalScene.phaseManager.unshiftPhase(activateAbilityPhase);
    }
  }
}

/**
 * Local fork (2026-11-14): custom moves. Whether a Pokémon's passive acts before its own ability on entry: a Turnabout
 * (전세역전) passive swaps before a Gardener (정원사) ability plants its new Garden, so that Garden stays on its own side
 * (tools/drive/custom_moves_1114/design_spec.md 3-1: "같은 포켓몬이 전세역전도 가지고 있으면 전세역전을 먼저 처리한 뒤
 * 정원을 가꿉니다"; Essentials' Gardener handler runs the holder's Turnabout first the same way). The other way round
 * (Turnabout ability, Gardener passive) already acts in that order. Both have post-summon priority 0, so Pokémon
 * entering together still act in speed order.
 * @param pokemon - The Pokémon entering the field
 * @returns Whether its passive's {@linkcode PostSummonActivateAbilityPhase} goes before its ability's
 */
function passiveActsFirstOnSummon(pokemon: Pokemon): boolean {
  return (
    pokemon.hasPassive()
    && pokemon.getAbility().hasAttr("PostSummonAddGardenAbAttr")
    && pokemon.getPassiveAbility().hasAttr("PostSummonSwapArenaTagsAbAttr")
  );
}
