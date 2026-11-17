import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
// Local fork (2026-11-14): custom moves. Grassy Terrain or the Garden
import { hasGrassyEffect } from "#data/arena-tag";
import { applyRaidTurnEnd } from "#data/endless-raid";
import { TerrainType } from "#data/terrain";
import { BattlerTagLapseType } from "#enums/battler-tag-lapse-type";
import { WeatherType } from "#enums/weather-type";
import { TurnEndEvent } from "#events/battle-scene";
import type { Pokemon } from "#field/pokemon";
// Local fork (2026-11-09): Radioactive Waste
import { LifeOrbModifier, RadioactiveWasteModifier } from "#modifiers/custom-held-items";
import {
  EnemyStatusEffectHealChanceModifier,
  EnemyTurnHealModifier,
  TurnHealModifier,
  TurnHeldItemTransferModifier,
  TurnStatusEffectModifier,
} from "#modifiers/modifier";
import { FieldPhase } from "#phases/field-phase";
import { toDmgValue } from "#utils/common";
import i18next from "i18next";

export class TurnEndPhase extends FieldPhase {
  public readonly phaseName = "TurnEndPhase";
  public upcomingInterlude = false;

  start() {
    super.start();

    globalScene.currentBattle.incrementTurn();
    globalScene.eventTarget.dispatchEvent(new TurnEndEvent(globalScene.currentBattle.turn));
    globalScene.phaseManager.dynamicQueueManager.clearLastTurnOrder();

    globalScene.phaseManager.hideAbilityBar();

    const handlePokemon = (pokemon: Pokemon) => {
      if (!pokemon.switchOutStatus) {
        // Fork: Life Orb (생명의구슬) costs HP after a turn with an attacking move. It comes first, so Leftovers
        // (which skips a Pokemon at full HP) and other turn-end healing can restore it the same turn (the user, 2026-11-05)
        globalScene.applyModifiers(LifeOrbModifier, pokemon.isPlayer(), pokemon);

        pokemon.lapseTags(BattlerTagLapseType.TURN_END);

        globalScene.applyModifiers(TurnHealModifier, pokemon.isPlayer(), pokemon);
        // Local fork (2026-11-09): Radioactive Waste (방사성폐기물) heals a Poison-type holder by 1/8, as Leftovers heals
        globalScene.applyModifiers(RadioactiveWasteModifier, pokemon.isPlayer(), pokemon, "heal");

        // Local fork (2026-11-14): custom moves. Grassy Terrain or a Garden (정원) on its side heals a grounded
        // Pokémon 1/16, once even when both are up (`hasGrassyEffect`)
        if (hasGrassyEffect(pokemon)) {
          globalScene.phaseManager.unshiftNew(
            "PokemonHealPhase",
            pokemon.getBattlerIndex(),
            toDmgValue(pokemon.getMaxHp() / 16),
            {
              message: i18next.t("battle:turnEndHpRestore", {
                pokemonName: getPokemonNameWithAffix(pokemon),
              }),
            },
          );
        }

        if (!pokemon.isPlayer()) {
          globalScene.applyModifiers(EnemyTurnHealModifier, false, pokemon);
          globalScene.applyModifier(EnemyStatusEffectHealChanceModifier, false, pokemon);
        }

        applyAbAttrs("PostTurnAbAttr", { pokemon });
        // Local fork (2026-11-17): the raid boss shakes off its status and answers its HP thresholds (endless-raid.ts)
        applyRaidTurnEnd(pokemon);
      }

      globalScene.applyModifiers(TurnStatusEffectModifier, pokemon.isPlayer(), pokemon);
      // Local fork (2026-11-09): Radioactive Waste poisons any other holder, as the Toxic Orb does (after the orbs, so an
      // orb held next to it still gives its own status)
      globalScene.applyModifiers(RadioactiveWasteModifier, pokemon.isPlayer(), pokemon, "poison");
      globalScene.applyModifiers(TurnHeldItemTransferModifier, pokemon.isPlayer(), pokemon);

      pokemon.summonData.turnCount++;
      pokemon.summonData.waveTurnCount++;
    };

    if (!this.upcomingInterlude) {
      this.executeForAll(handlePokemon);

      globalScene.arena.lapseTags();
    }

    if (globalScene.arena.weather && !globalScene.arena.weather.lapse()) {
      globalScene.arena.trySetWeather(WeatherType.NONE);
      globalScene.arena.triggerWeatherBasedFormChangesToNormal();
    }

    if (globalScene.arena.terrain && !globalScene.arena.terrain.lapse()) {
      globalScene.arena.trySetTerrain(TerrainType.NONE);
    }

    this.end();
  }
}
