import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import { EntryHazardTag } from "#data/arena-tag";
import { MysteryEncounterPostSummonTag } from "#data/battler-tags";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { StatusEffect } from "#enums/status-effect";
import { applySeedPouchOnEntry } from "#modifiers/battle-held-items"; // Local fork (2026-11-11): Seed Pouch
import { PokemonPhase } from "#phases/pokemon-phase";

export class PostSummonPhase extends PokemonPhase {
  public readonly phaseName = "PostSummonPhase";

  start() {
    super.start();

    const pokemon = this.getPokemon();
    console.log("Ran PSP for:", pokemon.name);
    if (pokemon.status?.effect === StatusEffect.TOXIC) {
      pokemon.status.toxicTurnCount = 0;
    }

    globalScene.arena.applyTags(ArenaTagType.PENDING_HEAL, false, pokemon);

    globalScene.arena.applyTags(EntryHazardTag, false, pokemon);

    // Local fork (2026-11-11): Seed Pouch (씨앗주머니; the user: "풀타입 포켓몬이 지닐 시 씨뿌리기 효과와 동일한 효과를
    // 내도록"): a Grass-type holder coming in seeds the opposing field, and a newcomer facing one is seeded
    applySeedPouchOnEntry(pokemon);

    // If this is mystery encounter and has post summon phase tag, apply post summon effects
    if (
      globalScene.currentBattle.isBattleMysteryEncounter()
      && pokemon.findTags(t => t instanceof MysteryEncounterPostSummonTag).length > 0
    ) {
      pokemon.lapseTag(BattlerTagType.MYSTERY_ENCOUNTER_POST_SUMMON);
    }
    // Local fork (2026-11-08): the encounter's own hook for every Pokémon that enters (enemy reserves included)
    if (globalScene.currentBattle.isBattleMysteryEncounter()) {
      globalScene.currentBattle.mysteryEncounter?.onPostSummon?.(pokemon);
    }
    for (const p of pokemon.getAlliesGenerator()) {
      applyAbAttrs("CommanderAbAttr", { pokemon: p });
    }

    this.end();
  }

  public getPriority() {
    return 0;
  }
}
