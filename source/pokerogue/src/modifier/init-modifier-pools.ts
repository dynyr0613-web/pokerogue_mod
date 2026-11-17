import { timedEventManager } from "#app/global-event-manager";
import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { FULL_RULE_HELD_ITEM_IDS, partyHoldsMax } from "#balance/endless-balance";
import { ENEMY_TRAINER_BUFFS } from "#balance/enemy-trainer-buffs"; // Local fork (2026-11-12): trainer pool weights
import { modifierTypes } from "#data/data-lists";
import { MAX_PER_TYPE_POKEBALLS } from "#data/pokeball";
import { AbilityId } from "#enums/ability-id";
import { BerryType } from "#enums/berry-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveFlags } from "#enums/move-flags"; // Local fork (2026-11-11): the gloves' weights
import { MoveId } from "#enums/move-id";
import { PokeballType } from "#enums/pokeball";
import { PokemonType } from "#enums/pokemon-type"; // Local fork (2026-11-11): Seed Pouch's weight
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { Unlockables } from "#enums/unlockables";
import type { Pokemon } from "#field/pokemon";
// Local fork (2026-11-11): Power Herb, Loaded Dice, Seed Pouch, Fuel (gated weights) and the other three items' weights
import {
  BATTLE_HELD_ITEMS,
  getBattleItemStack,
  isLoadedDiceMove,
  isOfOwnType, // Local fork (2026-11-11), after review: the Seed Pouch / Fuel gates read the Pokémon's own types
  isPowerHerbMove,
} from "#modifiers/battle-held-items";
// Local fork (2026-11-11): Punching Glove / Master Punching Glove
import { CONTACT_GLOVES, getContactGlove } from "#modifiers/contact-gloves";
// Local fork (2026-11-11): the Master TM's weight
import { hasMasterTmMove, MASTER_TM_POOL_WEIGHT } from "#modifiers/custom-consumables";
// Local fork (2026-11-09): Flame Cauldron, Training Shackles, Ultimate Gene, Radioactive Waste
import {
  areEvolutionCrystalsAvailable, // Local fork (2026-11-10): shared with enemy-custom-items.ts
  canEvolutionCrystalBoost, // Local fork (2026-11-10): shared with enemy-custom-items.ts
  getHpBeltCount, // Local fork (2026-11-12): Weight Band / Champion Belt
  HP_BELTS, // Local fork (2026-11-12): 중량밴드 / 챔피언벨트
  type HpBeltId, // Local fork (2026-11-12)
  holdsFlameCauldron,
  holdsRadioactiveWaste,
  holdsToxicDistiller, // Local fork (2026-11-10)
  isRadioactiveWasteHealer,
  LUCK_CLOVERS, // Local fork (2026-11-11)
  type LuckCloverId, // Local fork (2026-11-11)
  LuckCloverModifier, // Local fork (2026-11-11)
  MAX_PARTY_LUCK, // Local fork (2026-11-11)
  partyHoldsEvItem, // Local fork (2026-11-12): the EV items
  RADIOACTIVE_WASTE,
  SHACKLES_GENE_CAULDRON,
} from "#modifiers/custom-held-items";
// Local fork (2026-11-12): 관통 토큰 (Piercing Token)'s weight; 2026-11-13: 방호 토큰 (Guard Token)'s
import {
  ENEMY_DAMAGE_TOKEN_RULES,
  GUARD_TOKEN_RULES,
  getGuardTokenWeight,
  getPiercingTokenWeight,
} from "#modifiers/enemy-damage-tokens";
import { EV_ITEM_IDS, EV_RULES, type EvItemId } from "#modifiers/ev-items"; // Local fork (2026-11-12): the EV items
import {
  BerryModifier,
  DoubleBattleChanceBoosterModifier,
  SpeciesCritBoosterModifier,
  TurnStatusEffectModifier,
} from "#modifiers/modifier";
import {
  dailyStarterModifierPool,
  enemyBuffModifierPool,
  modifierPool,
  trainerModifierPool,
  wildModifierPool,
} from "#modifiers/modifier-pools";
import type { initModifierTypes } from "#modifiers/modifier-type";
// Local fork (2026-11-11): getPartyLuckValue for the luck clovers' weight
import { getOfferableIvCandyStats, getPartyLuckValue, WeightedModifierType } from "#modifiers/modifier-type";
import type { Move } from "#moves/move"; // Local fork (2026-11-11): knowsMove
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";

/**
 * Initialize the wild modifier pool
 */
function initWildModifierPool() {
  wildModifierPool[ModifierTier.COMMON] = [new WeightedModifierType(modifierTypes.BERRY, 1)].map(m => {
    m.setTier(ModifierTier.COMMON);
    return m;
  });
  wildModifierPool[ModifierTier.GREAT] = [new WeightedModifierType(modifierTypes.BASE_STAT_BOOSTER, 1)].map(m => {
    m.setTier(ModifierTier.GREAT);
    return m;
  });
  wildModifierPool[ModifierTier.ULTRA] = [
    new WeightedModifierType(modifierTypes.ATTACK_TYPE_BOOSTER, 10),
    new WeightedModifierType(modifierTypes.WHITE_HERB, 0),
  ].map(m => {
    m.setTier(ModifierTier.ULTRA);
    return m;
  });
  wildModifierPool[ModifierTier.ROGUE] = [new WeightedModifierType(modifierTypes.LUCKY_EGG, 4)].map(m => {
    m.setTier(ModifierTier.ROGUE);
    return m;
  });
  wildModifierPool[ModifierTier.MASTER] = [new WeightedModifierType(modifierTypes.GOLDEN_EGG, 1)].map(m => {
    m.setTier(ModifierTier.MASTER);
    return m;
  });
}

/**
 * Initialize the common modifier pool
 */
function initCommonModifierPool() {
  modifierPool[ModifierTier.COMMON] = [
    new WeightedModifierType(modifierTypes.POKEBALL, () => (hasMaximumBalls(PokeballType.POKEBALL) ? 0 : 6), 6),
    new WeightedModifierType(modifierTypes.RARE_CANDY, 2),
    new WeightedModifierType(
      modifierTypes.POTION,
      (party: Pokemon[]) => {
        const thresholdPartyMemberCount = Math.min(
          party.filter(p => p.getInverseHp() >= 10 && p.getHpRatio() <= 0.875 && !p.isFainted()).length,
          3,
        );
        return thresholdPartyMemberCount * 3;
      },
      9,
    ),
    new WeightedModifierType(
      modifierTypes.SUPER_POTION,
      (party: Pokemon[]) => {
        const thresholdPartyMemberCount = Math.min(
          party.filter(p => p.getInverseHp() >= 25 && p.getHpRatio() <= 0.75 && !p.isFainted()).length,
          3,
        );
        return thresholdPartyMemberCount;
      },
      3,
    ),
    new WeightedModifierType(
      modifierTypes.ETHER,
      (party: Pokemon[]) => {
        const thresholdPartyMemberCount = Math.min(
          party.filter(
            p =>
              p.hp
              && !p.getHeldItems().some(m => m instanceof BerryModifier && m.berryType === BerryType.LEPPA)
              && p
                .getMoveset()
                .filter(m => m.ppUsed && m.getMovePp() - m.ppUsed <= 5 && m.ppUsed > Math.floor(m.getMovePp() / 2))
                .length > 0,
          ).length,
          3,
        );
        return thresholdPartyMemberCount * 3;
      },
      9,
    ),
    new WeightedModifierType(
      modifierTypes.MAX_ETHER,
      (party: Pokemon[]) => {
        const thresholdPartyMemberCount = Math.min(
          party.filter(
            p =>
              p.hp
              && !p.getHeldItems().some(m => m instanceof BerryModifier && m.berryType === BerryType.LEPPA)
              && p
                .getMoveset()
                .filter(m => m.ppUsed && m.getMovePp() - m.ppUsed <= 5 && m.ppUsed > Math.floor(m.getMovePp() / 2))
                .length > 0,
          ).length,
          3,
        );
        return thresholdPartyMemberCount;
      },
      3,
    ),
    new WeightedModifierType(modifierTypes.LURE, lureWeightFunc(10, 2)),
    new WeightedModifierType(modifierTypes.TEMP_STAT_STAGE_BOOSTER, 4),
    new WeightedModifierType(modifierTypes.BERRY, 2),
    new WeightedModifierType(modifierTypes.TM_COMMON, 2),
    // Local fork (2026-11-06): IV Candy; 0 once every party member is full of all six (getOfferableIvCandyStats)
    new WeightedModifierType(
      modifierTypes.IV_CANDY,
      (party: Pokemon[]) => (party.some(p => p.isPlayer()) && getOfferableIvCandyStats(party).length === 0 ? 0 : 3),
      3,
    ),
  ].map(m => {
    m.setTier(ModifierTier.COMMON);
    return m;
  });
}

/**
 * Initialize the Great modifier pool
 */
function initGreatModifierPool() {
  modifierPool[ModifierTier.GREAT] = [
    new WeightedModifierType(modifierTypes.GREAT_BALL, () => (hasMaximumBalls(PokeballType.GREAT_BALL) ? 0 : 6), 6),
    new WeightedModifierType(modifierTypes.PP_UP, 2),
    new WeightedModifierType(
      modifierTypes.FULL_HEAL,
      (party: Pokemon[]) => {
        const statusEffectPartyMemberCount = Math.min(
          party.filter(
            p =>
              p.hp
              && !!p.status
              && !p.getHeldItems().some(i => {
                if (i instanceof TurnStatusEffectModifier) {
                  return (i as TurnStatusEffectModifier).getStatusEffect() === p.status?.effect;
                }
                return false;
              }),
          ).length,
          3,
        );
        return statusEffectPartyMemberCount * 6;
      },
      18,
    ),
    new WeightedModifierType(
      modifierTypes.REVIVE,
      (party: Pokemon[]) => {
        const faintedPartyMemberCount = Math.min(party.filter(p => p.isFainted()).length, 3);
        return faintedPartyMemberCount * 9;
      },
      27,
    ),
    new WeightedModifierType(
      modifierTypes.MAX_REVIVE,
      (party: Pokemon[]) => {
        const faintedPartyMemberCount = Math.min(party.filter(p => p.isFainted()).length, 3);
        return faintedPartyMemberCount * 3;
      },
      9,
    ),
    new WeightedModifierType(
      modifierTypes.SACRED_ASH,
      (party: Pokemon[]) => {
        return party.filter(p => p.isFainted()).length >= Math.ceil(party.length / 2) ? 1 : 0;
      },
      1,
    ),
    new WeightedModifierType(
      modifierTypes.HYPER_POTION,
      (party: Pokemon[]) => {
        const thresholdPartyMemberCount = Math.min(
          party.filter(p => p.getInverseHp() >= 100 && p.getHpRatio() <= 0.625 && !p.isFainted()).length,
          3,
        );
        return thresholdPartyMemberCount * 3;
      },
      9,
    ),
    new WeightedModifierType(
      modifierTypes.MAX_POTION,
      (party: Pokemon[]) => {
        const thresholdPartyMemberCount = Math.min(
          party.filter(p => p.getInverseHp() >= 100 && p.getHpRatio() <= 0.5 && !p.isFainted()).length,
          3,
        );
        return thresholdPartyMemberCount;
      },
      3,
    ),
    new WeightedModifierType(
      modifierTypes.FULL_RESTORE,
      (party: Pokemon[]) => {
        const statusEffectPartyMemberCount = Math.min(
          party.filter(
            p =>
              p.hp
              && !!p.status
              && !p.getHeldItems().some(i => {
                if (i instanceof TurnStatusEffectModifier) {
                  return (i as TurnStatusEffectModifier).getStatusEffect() === p.status?.effect;
                }
                return false;
              }),
          ).length,
          3,
        );
        const thresholdPartyMemberCount = Math.floor(
          (Math.min(party.filter(p => p.getInverseHp() >= 100 && p.getHpRatio() <= 0.5 && !p.isFainted()).length, 3)
            + statusEffectPartyMemberCount)
            / 2,
        );
        return thresholdPartyMemberCount;
      },
      3,
    ),
    new WeightedModifierType(
      modifierTypes.ELIXIR,
      (party: Pokemon[]) => {
        const thresholdPartyMemberCount = Math.min(
          party.filter(
            p =>
              p.hp
              && !p.getHeldItems().some(m => m instanceof BerryModifier && m.berryType === BerryType.LEPPA)
              && p
                .getMoveset()
                .filter(m => m.ppUsed && m.getMovePp() - m.ppUsed <= 5 && m.ppUsed > Math.floor(m.getMovePp() / 2))
                .length > 0,
          ).length,
          3,
        );
        return thresholdPartyMemberCount * 3;
      },
      9,
    ),
    new WeightedModifierType(
      modifierTypes.MAX_ELIXIR,
      (party: Pokemon[]) => {
        const thresholdPartyMemberCount = Math.min(
          party.filter(
            p =>
              p.hp
              && !p.getHeldItems().some(m => m instanceof BerryModifier && m.berryType === BerryType.LEPPA)
              && p
                .getMoveset()
                .filter(m => m.ppUsed && m.getMovePp() - m.ppUsed <= 5 && m.ppUsed > Math.floor(m.getMovePp() / 2))
                .length > 0,
          ).length,
          3,
        );
        return thresholdPartyMemberCount;
      },
      3,
    ),
    new WeightedModifierType(modifierTypes.DIRE_HIT, 4),
    new WeightedModifierType(modifierTypes.SUPER_LURE, lureWeightFunc(15, 4)),
    new WeightedModifierType(modifierTypes.NUGGET, skipInLastClassicWaveOrDefault(5)),
    new WeightedModifierType(modifierTypes.SPECIES_STAT_BOOSTER, 2),
    new WeightedModifierType(
      modifierTypes.EVOLUTION_ITEM,
      () => {
        return Math.min(Math.ceil(globalScene.currentBattle.waveIndex / 15), 8);
      },
      8,
    ),
    new WeightedModifierType(
      modifierTypes.MAP,
      () => (globalScene.gameMode.isClassic && globalScene.currentBattle.waveIndex < 180 ? 2 : 0),
      2,
    ),
    new WeightedModifierType(modifierTypes.SOOTHE_BELL, timedEventManager.isSootheBellBoosted() ? 3 : 2),
    // Local fork (2026-11-11): 네잎클로버 잎 (up to 4, luck +1 with all 4), weight 3 like the GREAT TMs and base stat
    // boosters; 0 at 4 leaves or once the party's luck is already 14 (luckCloverWeight)
    new WeightedModifierType(
      modifierTypes.FOUR_LEAF_CLOVER_LEAF,
      luckCloverWeight("FOUR_LEAF_CLOVER_LEAF"),
      LUCK_CLOVERS.FOUR_LEAF_CLOVER_LEAF.poolWeight,
    ),
    // Local fork (2026-11-13): 방호 토큰 (Guard Token, party item, up to 65) 4 in Endless while the enemy side holds a
    // 대미지 토큰 and the party has fewer than 65, else 0 (getGuardTokenWeight, enemy-damage-tokens.ts). 09 명세 4번:
    // "가중치 4, 조건: 적에게 대미지 토큰이 1개 이상 있고 … 아군의 방호 토큰이 최대 개수 미만일 때 (클래식·챌린지·데일리에서는
    // 가중치 0)"
    new WeightedModifierType(modifierTypes.GUARD_TOKEN, getGuardTokenWeight, GUARD_TOKEN_RULES.poolWeight),
    new WeightedModifierType(modifierTypes.TM_GREAT, 3),
    new WeightedModifierType(
      modifierTypes.MEMORY_MUSHROOM,
      () => {
        const party = globalScene.getPlayerParty();
        if (!party.some(p => p.getLearnableLevelMoves().length > 0)) {
          return 0;
        }

        const { waveIndex } = globalScene.currentBattle;
        const modeAdjustedWave = globalScene.gameMode.getWaveForDifficulty(waveIndex, true);
        return Math.min(1 + Math.floor(modeAdjustedWave / 30), 4);
      },
      4,
    ),
    new WeightedModifierType(modifierTypes.BASE_STAT_BOOSTER, 3),
    new WeightedModifierType(modifierTypes.TERA_SHARD, (party: Pokemon[]) =>
      party.filter(
        p =>
          !(p.hasSpecies(SpeciesId.TERAPAGOS) || p.hasSpecies(SpeciesId.OGERPON) || p.hasSpecies(SpeciesId.SHEDINJA)),
      ).length > 0
        ? 1
        : 0,
    ),
    new WeightedModifierType(
      modifierTypes.DNA_SPLICERS,
      (party: readonly Pokemon[]) => {
        if (party.filter(p => !p.fusionSpecies).length > 1) {
          if (globalScene.gameMode.isSplicedOnly) {
            return 4;
          }
          if (globalScene.gameMode.isClassic && timedEventManager.areFusionsBoosted()) {
            return 2;
          }
        }
        return 0;
      },
      4,
    ),
    new WeightedModifierType(
      modifierTypes.VOUCHER,
      (_party: readonly Pokemon[], rerollCount: number) =>
        globalScene.gameMode.isDaily ? 0 : Math.max(1 - rerollCount, 0),
      1,
    ),
  ].map(m => {
    m.setTier(ModifierTier.GREAT);
    return m;
  });
}

/**
 * Local fork (2026-11-09): the weight of an Evolution Crystal (붉은진화의수정 / 푸른진화의수정), the Eviolite's rule with
 * that crystal in place of the Eviolite: 10 while the Eviolite is unlocked (or in a Daily run; never in a Fresh Start
 * challenge) and some party member that is not Gigantamax'd can still evolve (its species or its fusion species) and
 * does not hold this crystal; 0 otherwise.
 * @param id - The crystal's modifier type id
 */
function evolutionCrystalWeight(
  id: "RED_EVOLUTION_CRYSTAL" | "BLUE_EVOLUTION_CRYSTAL",
): WeightedModifierTypeWeightFunc {
  return (party: Pokemon[]) => {
    // Local fork (2026-11-10), review fix: the gate is areEvolutionCrystalsAvailable (unchanged), shared with
    // enemy-custom-items.ts
    if (!areEvolutionCrystalsAvailable()) {
      return 0;
    }
    // Local fork (2026-11-10): the "can still evolve" part is canEvolutionCrystalBoost, shared with enemy-custom-items.ts
    return party.some(p => canEvolutionCrystalBoost(p) && !p.getHeldItems().some(i => i.type.id === id)) ? 10 : 0;
  };
}

/** Local fork (2026-11-10): whether `p` holds a Toxic Orb or a Flame Orb (upstream's "isHoldingOrb") */
function holdsStatusOrb(p: Pokemon): boolean {
  return p.getHeldItems().some(i => i.type.id === "FLAME_ORB" || i.type.id === "TOXIC_ORB");
}

/**
 * Local fork (2026-11-10): a Toxic Distiller (맹독증류기) holder needs the Toxic Orb, whatever its ability or moves, as a
 * Flame Cauldron holder needs the Flame Orb: it holds no orb and can be badly poisoned. Only the Toxic Orb's weight asks
 * this; Radioactive Waste ({@linkcode radioactiveWasteWeight}) does not.
 */
function wantsToxicOrbForDistiller(p: Pokemon): boolean {
  return holdsToxicDistiller(p) && !holdsStatusOrb(p) && p.canSetStatus(StatusEffect.TOXIC, true, true, null, true);
}

/**
 * Whether the Toxic Orb reward is offered for `p` (upstream's condition, used by the Toxic Orb's weight): it holds no
 * Toxic or Flame Orb and can be badly poisoned with Toxic Boost or Poison Heal, with Quick Feet / Guts / Marvel Scale /
 * Magic Guard but not Flare Boost, or with Facade / Psycho Shift.
 * Local fork (2026-11-09): moved out of the Toxic Orb's weight function, unchanged, so Radioactive Waste
 * ({@linkcode radioactiveWasteWeight}) can ask it too.
 * Local fork (2026-11-10): the distiller's own call for the orb is {@linkcode wantsToxicOrbForDistiller}, kept out of
 * here so Radioactive Waste does not follow it. A Toxic Distillate counted as an orb here at first; since 2026-11-10 its
 * holder is asked like anyone else, so a Toxic Boost / Poison Heal holder gets the Toxic Orb again
 * (the user: "불꽃화로를 든 근성/열폭주 포켓몬, 맹독증류액을 지닌 독폭주/포이즌힐 포켓몬, 초전도코일을 지닌 피카츄 전부 화염/맹독/전기 구슬이 나오도록 하죠").
 */
function wouldOfferToxicOrb(p: Pokemon): boolean {
  const isHoldingOrb = holdsStatusOrb(p);

  if (!isHoldingOrb) {
    const moveset = p
      .getMoveset(true)
      .filter(m => m != null)
      .map(m => m.moveId);
    const canSetStatus = p.canSetStatus(StatusEffect.TOXIC, true, true, null, true);

    // Moves that take advantage of obtaining the actual status effect
    const hasStatusMoves = [MoveId.FACADE, MoveId.PSYCHO_SHIFT].some(m => moveset.includes(m));
    // Moves that take advantage of being able to give the target a status orb
    // TODO: Take moves (Trick, Fling, Switcheroo) from comment when they are implemented
    const hasItemMoves = [
      /* MoveId.TRICK, MoveId.FLING, MoveId.SWITCHEROO */
    ].some(m => moveset.includes(m));

    if (canSetStatus) {
      // Abilities that take advantage of obtaining the actual status effect, separated based on specificity to the orb
      const hasGeneralAbility = [
        AbilityId.QUICK_FEET,
        AbilityId.GUTS,
        AbilityId.MARVEL_SCALE,
        AbilityId.MAGIC_GUARD,
      ].some(a => p.hasAbility(a, false, true));
      const hasSpecificAbility = [AbilityId.TOXIC_BOOST, AbilityId.POISON_HEAL].some(a => p.hasAbility(a, false, true));
      const hasOppositeAbility = [AbilityId.FLARE_BOOST].some(a => p.hasAbility(a, false, true));

      return hasSpecificAbility || (hasGeneralAbility && !hasOppositeAbility) || hasStatusMoves;
    }
    return hasItemMoves;
  }

  return false;
}

/**
 * Local fork (2026-11-09): the weight of Radioactive Waste (방사성폐기물), {@linkcode RADIOACTIVE_WASTE}.poolWeight while
 * some party member without one would want it, 0 otherwise. It wants it when it is a Poison type (the heal) or when the
 * Toxic Orb would be offered for it ({@linkcode wouldOfferToxicOrb}: Poison Heal, Toxic Boost, Guts..., Facade; the
 * poison). The full-item rule (applyFullHeldItemRule) also leaves it out while any party member holds one.
 * Poison type as the item itself sees it ({@linkcode isRadioactiveWasteHealer}: a Stellar Tera keeps its types).
 */
function radioactiveWasteWeight(party: Pokemon[]): number {
  return party.some(p => !holdsRadioactiveWaste(p) && (isRadioactiveWasteHealer(p) || wouldOfferToxicOrb(p)))
    ? RADIOACTIVE_WASTE.poolWeight
    : 0;
}

/**
 * Local fork (2026-11-11): the weight of a luck clover ({@linkcode LUCK_CLOVERS}): its pool weight, or 0 when it would
 * do nothing: the party already has the most it can (4 leaves / 3 clovers / 2 golden clovers), or the party's luck is
 * already {@linkcode MAX_PARTY_LUCK} (14) without it. Local fork (2026-11-11), after review: also 0 on the last Classic
 * reward screen (wave 199, {@linkcode skipInLastClassicWaveOrDefault}), like the Amulet Coin and the Golden Punch: only
 * the fixed final boss follows, so nothing would read the luck.
 * @param id - The clover's modifier type id
 */
function luckCloverWeight(id: LuckCloverId): WeightedModifierTypeWeightFunc {
  const lastClassicWave = skipInLastClassicWaveOrDefault(1);
  return (party: Pokemon[], rerollCount?: number) => {
    if (lastClassicWave(party, rerollCount ?? 0) === 0) {
      return 0;
    }
    const held = globalScene.findModifier(m => m instanceof LuckCloverModifier && m.cloverId === id, true);
    if (held && held.getStackCount() >= held.getMaxStackCount()) {
      return 0;
    }
    return getPartyLuckValue(party) >= MAX_PARTY_LUCK ? 0 : LUCK_CLOVERS[id].poolWeight;
  };
}

/** Local fork (2026-11-11): whether `p` knows a move with `flag` */
function knowsMoveWithFlag(p: Pokemon, flag: MoveFlags): boolean {
  return p.getMoveset().some(m => m?.getMove().hasFlag(flag));
}

/**
 * Local fork (2026-11-11): the Punching Glove's weight, {@linkcode CONTACT_GLOVES}.PUNCHING_GLOVE.poolWeight (6) while
 * some party member knows a punching move and holds neither glove (a Master glove holder is never offered one), 0
 * otherwise
 */
function punchingGloveWeight(party: Pokemon[]): number {
  return party.some(p => getContactGlove(p) == null && knowsMoveWithFlag(p, MoveFlags.PUNCHING_MOVE))
    ? CONTACT_GLOVES.PUNCHING_GLOVE.poolWeight
    : 0;
}

/**
 * Local fork (2026-11-11): the Master Punching Glove's weight, {@linkcode CONTACT_GLOVES}.MASTER_PUNCHING_GLOVE.poolWeight
 * (8) while some party member knows a contact move and holds no Master glove (a Punching Glove holder can upgrade), 0
 * otherwise
 */
function masterPunchingGloveWeight(party: Pokemon[]): number {
  return party.some(p => getContactGlove(p) !== "master" && knowsMoveWithFlag(p, MoveFlags.MAKES_CONTACT))
    ? CONTACT_GLOVES.MASTER_PUNCHING_GLOVE.poolWeight
    : 0;
}

/** Local fork (2026-11-11): whether `p` knows a move `test` accepts */
function knowsMove(p: Pokemon, test: (move: Move) => boolean): boolean {
  return p.getMoveset().some(m => m != null && test(m.getMove()));
}

/**
 * Local fork (2026-11-11): Power Herb's weight, {@linkcode BATTLE_HELD_ITEMS}.POWER_HERB.poolWeight (4) while some party
 * member knows a two-turn move it covers (Solar Beam, Fly, Meteor Beam …; not Sky Drop) and holds fewer than 2, 0
 * otherwise
 */
function powerHerbWeight(party: Pokemon[]): number {
  const { kind, maxHeld, poolWeight } = BATTLE_HELD_ITEMS.POWER_HERB;
  return party.some(p => getBattleItemStack(p, kind) < maxHeld && knowsMove(p, isPowerHerbMove)) ? poolWeight : 0;
}

/**
 * Local fork (2026-11-11): Loaded Dice's weight, {@linkcode BATTLE_HELD_ITEMS}.LOADED_DICE.poolWeight (4) while some
 * party member without dice and without Skill Link (which already does all the dice would) knows a 2-5-hit move or
 * Triple Kick / Triple Axel / Population Bomb, 0 otherwise. Local fork (2026-11-11), after review: Skill Link counts
 * for a fainted Pokémon too (`canApply` false: a fainted one's ability cannot apply, but it has it)
 */
function loadedDiceWeight(party: Pokemon[]): number {
  const { kind, poolWeight } = BATTLE_HELD_ITEMS.LOADED_DICE;
  return party.some(
    p =>
      getBattleItemStack(p, kind) === 0
      && !p.hasAbilityWithAttr("MaxMultiHitAbAttr", false)
      && knowsMove(p, isLoadedDiceMove),
  )
    ? poolWeight
    : 0;
}

/**
 * Local fork (2026-11-11): Seed Pouch's weight, {@linkcode BATTLE_HELD_ITEMS}.SEED_POUCH.poolWeight (4) while the party
 * has a Grass-type Pokémon that holds none (the user: "풀타입 없으면 애초에 안나오도록"), 0 otherwise.
 * Local fork (2026-11-11), after review: Grass by the Pokémon's own types ({@linkcode isOfOwnType}), so a battle-only
 * change still set on the reward screen (Protean into Grass, Forest's Curse, a Tera Type) neither opens nor shuts it
 */
function seedPouchWeight(party: Pokemon[]): number {
  const { kind, poolWeight } = BATTLE_HELD_ITEMS.SEED_POUCH;
  return party.some(p => getBattleItemStack(p, kind) === 0 && isOfOwnType(p, PokemonType.GRASS)) ? poolWeight : 0;
}

/**
 * Local fork (2026-11-11): Fuel's weight, {@linkcode BATTLE_HELD_ITEMS}.FUEL.poolWeight (6, like the Punching Glove)
 * while the party has a Fire-type Pokémon holding fewer than 3 (it does nothing for other types), 0 otherwise.
 * Local fork (2026-11-11), after review: Fire by the Pokémon's own types ({@linkcode isOfOwnType}; Burn Up, Soak or
 * a Tera Type still set on the reward screen do not shut it)
 */
function fuelWeight(party: Pokemon[]): number {
  const { kind, maxHeld, poolWeight } = BATTLE_HELD_ITEMS.FUEL;
  return party.some(p => getBattleItemStack(p, kind) < maxHeld && isOfOwnType(p, PokemonType.FIRE)) ? poolWeight : 0;
}

/**
 * Local fork (2026-11-11): Throat Spray's weight, {@linkcode BATTLE_HELD_ITEMS}.THROAT_SPRAY.poolWeight (6, like the other
 * gated ULTRA items) while some party member knows a sound move (`MoveFlags.SOUND_BASED`) and holds no spray, 0 otherwise
 */
function throatSprayWeight(party: Pokemon[]): number {
  const { kind, poolWeight } = BATTLE_HELD_ITEMS.THROAT_SPRAY;
  return party.some(p => getBattleItemStack(p, kind) === 0 && knowsMoveWithFlag(p, MoveFlags.SOUND_BASED))
    ? poolWeight
    : 0;
}

/**
 * Local fork (2026-11-11): the weight of Muscle Band (`"MUSCLE_BAND"`) or Wise Glasses (`"WISE_GLASSES"`): its pool weight
 * (4) while some party member knows a damaging move of its category (physical / special, the move's own category) and
 * holds fewer than the most it can hold (99 since 2026-11-11, like the type boosters), 0 otherwise
 * @param id - The item's modifier type id
 */
function categoryBandWeight(id: "MUSCLE_BAND" | "WISE_GLASSES"): WeightedModifierTypeWeightFunc {
  const { kind, category, poolWeight, maxHeld } = BATTLE_HELD_ITEMS[id];
  return (party: Pokemon[]) =>
    party.some(p => getBattleItemStack(p, kind) < maxHeld && knowsMove(p, move => move.category === category))
      ? poolWeight
      : 0;
}

/**
 * Local fork (2026-11-12): the weight of the Weight Band (`"WEIGHT_BAND"`, 중량밴드) or the Champion Belt
 * (`"CHAMPION_BELT"`, 챔피언벨트): its pool weight in {@linkcode HP_BELTS} (4 / 3) while some party member holds fewer
 * than its cap (3 / 1), 0 otherwise. Like every plain held item of the pool, the full-item rule
 * (applyFullHeldItemRule) also leaves it out while one party member holds the cap.
 * @param id - The belt's modifier type id
 */
function hpBeltWeight(id: HpBeltId): WeightedModifierTypeWeightFunc {
  const { maxHeld, poolWeight } = HP_BELTS[id];
  return (party: Pokemon[]) => (party.some(p => getHpBeltCount(p, id) < maxHeld) ? poolWeight : 0);
}

/**
 * Local fork (2026-11-12): the weight of an EV item (`"POWER_WEIGHT"` … `"POWER_ANKLET"`): {@linkcode EV_RULES}.poolWeight
 * (2) while no Pokémon of the party holds that item, 0 while one does (the user: "각 노력치 아이템은 파티당 하나만
 * 나온다는 제한만 둡시다"). One per Pokémon, so the full-item rule (applyFullHeldItemRule) says the same.
 * @param id - The item's modifier type id
 */
function evItemWeight(id: EvItemId): WeightedModifierTypeWeightFunc {
  return (party: Pokemon[]) => (partyHoldsEvItem(party, id) ? 0 : EV_RULES.poolWeight);
}

/**
 * Initialize the Ultra modifier pool
 */
function initUltraModifierPool() {
  modifierPool[ModifierTier.ULTRA] = [
    new WeightedModifierType(modifierTypes.ULTRA_BALL, () => (hasMaximumBalls(PokeballType.ULTRA_BALL) ? 0 : 15), 15),
    new WeightedModifierType(modifierTypes.MAX_LURE, lureWeightFunc(30, 4)),
    new WeightedModifierType(modifierTypes.BIG_NUGGET, skipInLastClassicWaveOrDefault(12)),
    new WeightedModifierType(modifierTypes.PP_MAX, 3),
    // Local fork (2026-11-06): 0 once every nature has been on the party or offered (see getOfferableMintNatures)
    new WeightedModifierType(
      modifierTypes.MINT,
      (party: Pokemon[]) =>
        party.some(p => p.isPlayer()) && globalScene.getOfferableMintNatures().length === 0 ? 0 : 4,
      4,
    ),
    new WeightedModifierType(
      modifierTypes.RARE_EVOLUTION_ITEM,
      () => Math.min(Math.ceil(globalScene.currentBattle.waveIndex / 15) * 4, 32),
      32,
    ),
    new WeightedModifierType(
      modifierTypes.FORM_CHANGE_ITEM,
      () => Math.min(Math.ceil(globalScene.currentBattle.waveIndex / 50), 4) * 6,
      24,
    ),
    new WeightedModifierType(modifierTypes.AMULET_COIN, skipInLastClassicWaveOrDefault(3)),
    // Local fork (2026-11-11): 네잎클로버 (up to 3, luck +1 each), weight 3 like the Amulet Coin; 0 at 3 or once the
    // party's luck is already 14 (luckCloverWeight)
    new WeightedModifierType(
      modifierTypes.FOUR_LEAF_CLOVER,
      luckCloverWeight("FOUR_LEAF_CLOVER"),
      LUCK_CLOVERS.FOUR_LEAF_CLOVER.poolWeight,
    ),
    new WeightedModifierType(modifierTypes.EVIOLITE, (party: Pokemon[]) => {
      const { gameMode, gameData } = globalScene;
      if (gameMode.isDaily || (!gameMode.isFreshStartChallenge() && gameData.isUnlocked(Unlockables.EVIOLITE))) {
        return party.some(p => {
          // Check if Pokemon's species (or fusion species, if applicable) can evolve or if they're G-Max'd
          if (
            !p.isMax()
            && (speciesDataRegistry.hasEvolutions(p.getSpeciesForm(true).speciesId)
              || (p.isFusion() && speciesDataRegistry.hasEvolutions(p.getFusionSpeciesForm(true).speciesId)))
          ) {
            // Check if Pokemon is already holding an Eviolite
            return !p.getHeldItems().some(i => i.type.id === "EVIOLITE");
          }
          return false;
        })
          ? 10
          : 0;
      }
      return 0;
    }),
    // Local fork (2026-11-09): Red / Blue Evolution Crystal (붉은진화의수정 / 푸른진화의수정), 10 each under the Eviolite's
    // condition; left out while one party member holds one (applyFullHeldItemRule)
    new WeightedModifierType(modifierTypes.RED_EVOLUTION_CRYSTAL, evolutionCrystalWeight("RED_EVOLUTION_CRYSTAL"), 10),
    new WeightedModifierType(
      modifierTypes.BLUE_EVOLUTION_CRYSTAL,
      evolutionCrystalWeight("BLUE_EVOLUTION_CRYSTAL"),
      10,
    ),
    new WeightedModifierType(modifierTypes.RARE_SPECIES_STAT_BOOSTER, 12),
    new WeightedModifierType(
      modifierTypes.LEEK,
      (party: Pokemon[]) => {
        const checkedSpecies = [SpeciesId.FARFETCHD, SpeciesId.GALAR_FARFETCHD, SpeciesId.SIRFETCHD];
        // If a party member doesn't already have a Leek and is one of the relevant species, Leek can appear
        return party.some(
          p =>
            !p.getHeldItems().some(i => i instanceof SpeciesCritBoosterModifier)
            && (checkedSpecies.includes(p.getSpeciesForm(true).speciesId)
              || (p.isFusion() && checkedSpecies.includes(p.getFusionSpeciesForm(true).speciesId))),
        )
          ? 12
          : 0;
      },
      12,
    ),
    // Local fork (2026-11-09): the per-Pokémon condition moved, unchanged, to wouldOfferToxicOrb, which Radioactive
    // Waste (radioactiveWasteWeight) asks too. Local fork (2026-11-10): a Toxic Distiller holder brings it as well
    // (wantsToxicOrbForDistiller, which Radioactive Waste does not ask)
    new WeightedModifierType(
      modifierTypes.TOXIC_ORB,
      (party: Pokemon[]) => (party.some(p => wouldOfferToxicOrb(p) || wantsToxicOrbForDistiller(p)) ? 10 : 0),
      10,
    ),
    new WeightedModifierType(
      modifierTypes.FLAME_ORB,
      (party: Pokemon[]) => {
        return party.some(p => {
          // Local fork (2026-11-10): a Flame Furnace (a cauldron that swallowed a Flame Orb) counted as an orb here at
          // first; now its holder is asked like anyone else, so a Guts / Flare Boost holder gets the Flame Orb again
          // (the user: "불꽃화로를 든 근성/열폭주 포켓몬, 맹독증류액을 지닌 독폭주/포이즌힐 포켓몬, 초전도코일을 지닌 피카츄 전부 화염/맹독/전기 구슬이 나오도록 하죠")
          const isHoldingOrb = p.getHeldItems().some(i => i.type.id === "FLAME_ORB" || i.type.id === "TOXIC_ORB");

          if (!isHoldingOrb) {
            const moveset = p
              .getMoveset(true)
              .filter(m => m != null)
              .map(m => m.moveId);
            const canSetStatus = p.canSetStatus(StatusEffect.BURN, true, true, null, true);

            // Moves that take advantage of obtaining the actual status effect
            const hasStatusMoves = [MoveId.FACADE, MoveId.PSYCHO_SHIFT].some(m => moveset.includes(m));
            // Moves that take advantage of being able to give the target a status orb
            // TODO: Take moves (Trick, Fling, Switcheroo) from comment when they are implemented
            const hasItemMoves = [
              /* MoveId.TRICK, MoveId.FLING, MoveId.SWITCHEROO */
            ].some(m => moveset.includes(m));

            if (canSetStatus) {
              // Abilities that take advantage of obtaining the actual status effect, separated based on specificity to the orb
              const hasGeneralAbility = [
                AbilityId.QUICK_FEET,
                AbilityId.GUTS,
                AbilityId.MARVEL_SCALE,
                AbilityId.MAGIC_GUARD,
              ].some(a => p.hasAbility(a, false, true));
              const hasSpecificAbility = [AbilityId.FLARE_BOOST].some(a => p.hasAbility(a, false, true));
              const hasOppositeAbility = [AbilityId.TOXIC_BOOST, AbilityId.POISON_HEAL].some(a =>
                p.hasAbility(a, false, true),
              );
              // Local fork (2026-11-09): a Flame Cauldron (화염가마솥) holder needs the burn, whatever its ability or
              // moves (the user: "화염구슬의 드롭 조건도 설정이 되었나요?"), so it counts like Flare Boost; only a cauldron
              // that has not swallowed an orb yet (a lit one is an orb, above)
              const wantsOrbForCauldron = holdsFlameCauldron(p);

              return (
                wantsOrbForCauldron
                || hasSpecificAbility
                || (hasGeneralAbility && !hasOppositeAbility)
                || hasStatusMoves
              );
            }
            return hasItemMoves;
          }

          return false;
        })
          ? 10
          : 0;
      },
      10,
    ),
    new WeightedModifierType(
      modifierTypes.MYSTICAL_ROCK,
      (party: Pokemon[]) => {
        return party.some(p => {
          let isHoldingMax = false;
          for (const i of p.getHeldItems()) {
            if (i.type.id === "MYSTICAL_ROCK") {
              isHoldingMax = i.getStackCount() === i.getMaxStackCount();
              break;
            }
          }

          if (!isHoldingMax) {
            const moveset = p.getMoveset(true).map(m => m.moveId);

            const hasAbility = [
              AbilityId.DROUGHT,
              AbilityId.ORICHALCUM_PULSE,
              AbilityId.DRIZZLE,
              AbilityId.SAND_STREAM,
              AbilityId.SAND_SPIT,
              AbilityId.SNOW_WARNING,
              AbilityId.ELECTRIC_SURGE,
              AbilityId.HADRON_ENGINE,
              AbilityId.PSYCHIC_SURGE,
              AbilityId.GRASSY_SURGE,
              AbilityId.SEED_SOWER,
              AbilityId.MISTY_SURGE,
            ].some(a => p.hasAbility(a, false, true));

            const hasMoves = [
              MoveId.SUNNY_DAY,
              MoveId.RAIN_DANCE,
              MoveId.SANDSTORM,
              MoveId.SNOWSCAPE,
              MoveId.HAIL,
              MoveId.CHILLY_RECEPTION,
              MoveId.ELECTRIC_TERRAIN,
              MoveId.PSYCHIC_TERRAIN,
              MoveId.GRASSY_TERRAIN,
              MoveId.MISTY_TERRAIN,
            ].some(m => moveset.includes(m));

            return hasAbility || hasMoves;
          }
          return false;
        })
          ? 10
          : 0;
      },
      10,
    ),
    new WeightedModifierType(modifierTypes.REVIVER_SEED, 4),
    new WeightedModifierType(modifierTypes.CANDY_JAR, skipInLastClassicWaveOrDefault(5)),
    new WeightedModifierType(modifierTypes.ATTACK_TYPE_BOOSTER, 9),
    new WeightedModifierType(modifierTypes.TM_ULTRA, 11),
    new WeightedModifierType(modifierTypes.RARER_CANDY, 4),
    new WeightedModifierType(modifierTypes.GOLDEN_PUNCH, skipInLastClassicWaveOrDefault(2)),
    new WeightedModifierType(modifierTypes.IV_SCANNER, skipInLastClassicWaveOrDefault(4)),
    new WeightedModifierType(modifierTypes.EXP_CHARM, skipInLastClassicWaveOrDefault(8)),
    new WeightedModifierType(modifierTypes.EXP_SHARE, skipInLastClassicWaveOrDefault(10)),
    new WeightedModifierType(
      modifierTypes.TERA_ORB,
      () =>
        globalScene.gameMode.isClassic
          ? 0
          : Math.min(Math.max(Math.floor(globalScene.currentBattle.waveIndex / 50) * 2, 1), 4),
      4,
    ),
    new WeightedModifierType(modifierTypes.QUICK_CLAW, 3),
    // Local fork (2026-11-06): left out while one party member holds 3, see applyFullHeldItemRule
    new WeightedModifierType(modifierTypes.WIDE_LENS, 7),
    // Local fork (2026-11-11): Punching Glove (펀치글러브, one per Pokémon), 6 while some party member knows a punching
    // move and holds no glove (punchingGloveWeight); left out while one party member holds one (applyFullHeldItemRule)
    new WeightedModifierType(
      modifierTypes.PUNCHING_GLOVE,
      punchingGloveWeight,
      CONTACT_GLOVES.PUNCHING_GLOVE.poolWeight,
    ),
    // Local fork (2026-11-11): Metronome (메트로놈, up to 3), 4 like the Reviver Seed, for anyone; Fuel (연료, up to 3), 6
    // like the Punching Glove while a Fire-type party member holds fewer than 3 (fuelWeight). Both left out while one
    // party member holds the cap (applyFullHeldItemRule)
    new WeightedModifierType(modifierTypes.METRONOME, BATTLE_HELD_ITEMS.METRONOME.poolWeight),
    new WeightedModifierType(modifierTypes.FUEL, fuelWeight, BATTLE_HELD_ITEMS.FUEL.poolWeight),
    // Local fork (2026-11-11): Throat Spray (목스프레이, one per Pokémon), 6 like the Punching Glove and Fuel while a party
    // member knows a sound move and holds none (throatSprayWeight); Muscle Band / Wise Glasses (힘의머리띠 / 박식안경, up to
    // 99 since 2026-11-11 like the type boosters), 4 like the Metronome while a party member with a physical / special move
    // holds fewer than 99 (categoryBandWeight; the user: "하이퍼 등급으로"). Left out while one party member is full
    // (applyFullHeldItemRule)
    new WeightedModifierType(modifierTypes.THROAT_SPRAY, throatSprayWeight, BATTLE_HELD_ITEMS.THROAT_SPRAY.poolWeight),
    new WeightedModifierType(
      modifierTypes.MUSCLE_BAND,
      categoryBandWeight("MUSCLE_BAND"),
      BATTLE_HELD_ITEMS.MUSCLE_BAND.poolWeight,
    ),
    new WeightedModifierType(
      modifierTypes.WISE_GLASSES,
      categoryBandWeight("WISE_GLASSES"),
      BATTLE_HELD_ITEMS.WISE_GLASSES.poolWeight,
    ),
    // Local fork (2026-11-12): Weight Band (중량밴드, up to 3, max HP +10% each), 4 like the Metronome while some party
    // member holds fewer than 3 (hpBeltWeight; the user: "하이퍼(10%) … 하이퍼는 최대 3개로"); left out while one
    // party member holds 3 (applyFullHeldItemRule)
    new WeightedModifierType(modifierTypes.WEIGHT_BAND, hpBeltWeight("WEIGHT_BAND"), HP_BELTS.WEIGHT_BAND.poolWeight),
  ].map(m => {
    m.setTier(ModifierTier.ULTRA);
    return m;
  });
}

function initRogueModifierPool() {
  modifierPool[ModifierTier.ROGUE] = [
    new WeightedModifierType(modifierTypes.ROGUE_BALL, () => (hasMaximumBalls(PokeballType.ROGUE_BALL) ? 0 : 16), 16),
    new WeightedModifierType(modifierTypes.RELIC_GOLD, skipInLastClassicWaveOrDefault(2)),
    new WeightedModifierType(modifierTypes.LEFTOVERS, 3),
    new WeightedModifierType(modifierTypes.SHELL_BELL, 3),
    new WeightedModifierType(modifierTypes.BERRY_POUCH, 4),
    new WeightedModifierType(modifierTypes.GRIP_CLAW, 5),
    new WeightedModifierType(modifierTypes.SCOPE_LENS, 4),
    // Local fork: Life Orb; since 2026-11-06 left out while one party member holds 3 (applyFullHeldItemRule)
    new WeightedModifierType(modifierTypes.LIFE_ORB, 4),
    // Local fork (2026-11-09): Training Shackles (트레이닝족쇄, up to 2) and Flame Cauldron (화염가마솥, one per Pokémon),
    // weights in SHACKLES_GENE_CAULDRON (4 each); left out while one party member holds the cap (applyFullHeldItemRule)
    new WeightedModifierType(modifierTypes.TRAINING_SHACKLES, SHACKLES_GENE_CAULDRON.TRAINING_SHACKLES.poolWeight),
    new WeightedModifierType(modifierTypes.FLAME_CAULDRON, SHACKLES_GENE_CAULDRON.FLAME_CAULDRON.poolWeight),
    // Local fork (2026-11-09): Radioactive Waste (방사성폐기물), one per Pokémon, 4 while some party member would want it
    // (radioactiveWasteWeight); left out while one party member holds one (applyFullHeldItemRule)
    new WeightedModifierType(modifierTypes.RADIOACTIVE_WASTE, radioactiveWasteWeight, RADIOACTIVE_WASTE.poolWeight),
    // Local fork (2026-11-10): Toxic Distiller (맹독증류기, one per Pokémon), weight 4 in SHACKLES_GENE_CAULDRON like the
    // cauldron; left out while one party member holds one or a Toxic Distillate (applyFullHeldItemRule)
    new WeightedModifierType(modifierTypes.TOXIC_DISTILLER, SHACKLES_GENE_CAULDRON.TOXIC_DISTILLER.poolWeight),
    // Local fork (2026-11-10): Discharged Coil (방전코일, one per Pokémon), weight 4 like the cauldron and distiller; its
    // holder calls the Light Ball (SpeciesStatBoosterModifierTypeGenerator); left out while one party member holds one
    // or a Superconducting Coil (applyFullHeldItemRule)
    new WeightedModifierType(modifierTypes.DISCHARGED_COIL, SHACKLES_GENE_CAULDRON.DISCHARGED_COIL.poolWeight),
    // Local fork (2026-11-11): Power Herb (파워풀허브, up to 2), Loaded Dice (속임수주사위) and Seed Pouch (씨앗주머니), 4 each
    // like the Scope Lens and Radioactive Waste, only while some party member could use them (powerHerbWeight,
    // loadedDiceWeight, seedPouchWeight: "풀타입 없으면 애초에 안나오도록"); Expert Belt (달인의띠) 4 for anyone; Precision Lens
    // (정밀렌즈, up to 2) 3, one below the Scope Lens since it only matters on a critical hit. All left out while one party
    // member holds the cap (applyFullHeldItemRule)
    new WeightedModifierType(modifierTypes.POWER_HERB, powerHerbWeight, BATTLE_HELD_ITEMS.POWER_HERB.poolWeight),
    new WeightedModifierType(modifierTypes.LOADED_DICE, loadedDiceWeight, BATTLE_HELD_ITEMS.LOADED_DICE.poolWeight),
    new WeightedModifierType(modifierTypes.SEED_POUCH, seedPouchWeight, BATTLE_HELD_ITEMS.SEED_POUCH.poolWeight),
    new WeightedModifierType(modifierTypes.EXPERT_BELT, BATTLE_HELD_ITEMS.EXPERT_BELT.poolWeight),
    new WeightedModifierType(modifierTypes.PRECISION_LENS, BATTLE_HELD_ITEMS.PRECISION_LENS.poolWeight),
    // Local fork (2026-11-11): Clear Amulet (클리어참, one per Pokémon) 3, like Leftovers and King's Rock, a defensive item
    // that only matters against drops; Booster Energy (부스트에너지, one per Pokémon) 4, like the Life Orb and the Expert
    // Belt, an always-on boost (the user: "클리어참은 효과 그대로 로그 등급, 부스트에너지(로그)"). Both for anyone, left out
    // while one party member holds one (applyFullHeldItemRule)
    new WeightedModifierType(modifierTypes.CLEAR_AMULET, BATTLE_HELD_ITEMS.CLEAR_AMULET.poolWeight),
    new WeightedModifierType(modifierTypes.BOOSTER_ENERGY, BATTLE_HELD_ITEMS.BOOSTER_ENERGY.poolWeight),
    // Local fork (2026-11-12): the six EV items (파워웨이트 / 파워리스트 / 파워벨트 / 파워렌즈 / 파워밴드 / 파워앵클릿; the user:
    // "종류별로 전부 로그등급으로"), 2 each like the Baton, so the six together roll about as often as two weight-6 items;
    // each 0 while a party member holds it (evItemWeight: "각 노력치 아이템은 파티당 하나만 나온다")
    ...EV_ITEM_IDS.map(id => new WeightedModifierType(modifierTypes[id], evItemWeight(id), EV_RULES.poolWeight)),
    // Local fork: Candy Pile (사탕더미) = 5 Rare Candies + 2 Rarer Candies (2026-11-05)
    new WeightedModifierType(modifierTypes.CANDY_PILE, 4),
    new WeightedModifierType(modifierTypes.BATON, 2),
    new WeightedModifierType(modifierTypes.SOUL_DEW, 7),
    new WeightedModifierType(modifierTypes.CATCHING_CHARM, () => (globalScene.gameMode.isClassic ? 0 : 4), 4),
    new WeightedModifierType(modifierTypes.ABILITY_CHARM, skipInClassicAfterWave(189, 6)),
    new WeightedModifierType(modifierTypes.FOCUS_BAND, 5),
    new WeightedModifierType(modifierTypes.KINGS_ROCK, 3),
    new WeightedModifierType(modifierTypes.LOCK_CAPSULE, () => (globalScene.gameMode.isClassic ? 0 : 3)),
    // Local fork (2026-11-11): 황금 네잎클로버 (up to 2, luck +3 each), weight 2 like the Baton: three clovers' worth in
    // one pick; 0 at 2 or once the party's luck is already 14 (luckCloverWeight)
    new WeightedModifierType(
      modifierTypes.GOLDEN_FOUR_LEAF_CLOVER,
      luckCloverWeight("GOLDEN_FOUR_LEAF_CLOVER"),
      LUCK_CLOVERS.GOLDEN_FOUR_LEAF_CLOVER.poolWeight,
    ),
    // Local fork (2026-11-12): 관통 토큰 (Piercing Token, party item, up to 10) 3 while the enemy side holds a 보호 토큰
    // and the party has fewer than 10, else 0 (getPiercingTokenWeight, enemy-damage-tokens.ts). The user: "적의 데미지
    // 증가 / 데미지 감소 / 토큰에 저항할만한 파티 아이템의 구현"
    new WeightedModifierType(
      modifierTypes.PIERCING_TOKEN,
      getPiercingTokenWeight,
      ENEMY_DAMAGE_TOKEN_RULES.piercingWeight,
    ),
    new WeightedModifierType(modifierTypes.SUPER_EXP_CHARM, skipInLastClassicWaveOrDefault(8)),
    new WeightedModifierType(
      modifierTypes.RARE_FORM_CHANGE_ITEM,
      () => Math.min(Math.ceil(globalScene.currentBattle.waveIndex / 50), 4) * 6,
      24,
    ),
    new WeightedModifierType(
      modifierTypes.MEGA_BRACELET,
      () => Math.min(Math.ceil(globalScene.currentBattle.waveIndex / 50), 4) * 9,
      36,
    ),
    new WeightedModifierType(
      modifierTypes.DYNAMAX_BAND,
      () => Math.min(Math.ceil(globalScene.currentBattle.waveIndex / 50), 4) * 9,
      36,
    ),
    new WeightedModifierType(
      modifierTypes.VOUCHER_PLUS,
      (_party: Pokemon[], rerollCount: number) => (globalScene.gameMode.isDaily ? 0 : Math.max(3 - rerollCount * 1, 0)),
      3,
    ),
  ].map(m => {
    m.setTier(ModifierTier.ROGUE);
    return m;
  });
}

/**
 * Local fork (2026-11-06, doc §6-7): every plain held item of the player's reward pool listed in
 * {@linkcode FULL_RULE_HELD_ITEM_IDS} gets weight 0 while even one of the player's Pokémon holds it at its cap,
 * even if another party member has room. Its own weight rule still applies otherwise. Berries, type boosters and
 * species items are filtered one kind at a time in their generators.
 */
function applyFullHeldItemRule(): void {
  for (const tierPool of Object.values(modifierPool)) {
    for (const entry of tierPool as WeightedModifierType[]) {
      const id = entry.modifierType.id;
      if (!FULL_RULE_HELD_ITEM_IDS.has(id)) {
        continue;
      }
      const baseWeight = entry.weight;
      entry.weight = (party: Pokemon[], rerollCount: number) => {
        if (partyHoldsMax(party, id)) {
          return 0;
        }
        return baseWeight instanceof Function ? baseWeight(party, rerollCount) : baseWeight;
      };
    }
  }
}

/**
 * Initialize the Master modifier pool
 */
function initMasterModifierPool() {
  modifierPool[ModifierTier.MASTER] = [
    new WeightedModifierType(modifierTypes.MASTER_BALL, () => (hasMaximumBalls(PokeballType.MASTER_BALL) ? 0 : 24), 24),
    new WeightedModifierType(modifierTypes.SHINY_CHARM, 14),
    new WeightedModifierType(modifierTypes.HEALING_CHARM, 18),
    new WeightedModifierType(modifierTypes.MULTI_LENS, 18),
    // Local fork: the vests and Prism; since 2026-11-06 each is left out while one party member holds 3
    // (applyFullHeldItemRule), where before they rolled until every party member held 3
    new WeightedModifierType(modifierTypes.ASSAULT_VEST, 12),
    new WeightedModifierType(modifierTypes.BULLETPROOF_VEST, 12),
    new WeightedModifierType(modifierTypes.PRISM, 12),
    // Local fork (2026-11-09): the Choice items, 8 each, one per Pokémon; left out while one party member holds one
    // (applyFullHeldItemRule)
    new WeightedModifierType(modifierTypes.CHOICE_BAND, 8),
    new WeightedModifierType(modifierTypes.CHOICE_SCARF, 8),
    new WeightedModifierType(modifierTypes.CHOICE_SPECS, 8),
    // Local fork (2026-11-09): Choice Armor (구애갑옷), 8 like the other Choice items, under the same rule
    new WeightedModifierType(modifierTypes.CHOICE_ARMOR, 8),
    // Local fork (2026-11-09): Ultimate Gene (궁극유전자), one per Pokémon, weight in SHACKLES_GENE_CAULDRON (8, like the
    // Choice items); left out while one party member holds one (applyFullHeldItemRule)
    new WeightedModifierType(modifierTypes.ULTIMATE_GENE, SHACKLES_GENE_CAULDRON.ULTIMATE_GENE.poolWeight),
    // Local fork (2026-11-11): Master Punching Glove (마스터 펀치글러브, one per Pokémon), 8 like the Choice items and the
    // Ultimate Gene, while some party member knows a contact move and holds no Master glove (masterPunchingGloveWeight);
    // left out while one party member holds one (applyFullHeldItemRule)
    new WeightedModifierType(
      modifierTypes.MASTER_PUNCHING_GLOVE,
      masterPunchingGloveWeight,
      CONTACT_GLOVES.MASTER_PUNCHING_GLOVE.poolWeight,
    ),
    // Local fork (2026-11-12): Champion Belt (챔피언벨트, one per Pokémon, max HP +45%), 3 while some party member
    // holds none (hpBeltWeight; the user: "마스터(45%) 하나씩"): below the 8s of the Choice items, the Ultimate
    // Gene and the Master glove; left out while one party member holds one (applyFullHeldItemRule)
    new WeightedModifierType(
      modifierTypes.CHAMPION_BELT,
      hpBeltWeight("CHAMPION_BELT"),
      HP_BELTS.CHAMPION_BELT.poolWeight,
    ),
    // Local fork (2026-11-11): Master TM (마스터 기술머신; the user: "마스터 기술머신(마스터, … 선택 후 소모됨 …)"), 2
    // (MASTER_TM_POOL_WEIGHT: below the one-per-Pokémon 8s, since it is used up and can roll again; Local fork
    // (2026-11-12): 6 -> 2, the user: "마스터 기술머신의 가중치 하락"), while some party member can still learn a move from it
    new WeightedModifierType(
      modifierTypes.MASTER_TM,
      (party: Pokemon[]) => (party.some(p => hasMasterTmMove(p)) ? MASTER_TM_POOL_WEIGHT : 0),
      MASTER_TM_POOL_WEIGHT,
    ),
    new WeightedModifierType(
      modifierTypes.VOUCHER_PREMIUM,
      (_party: Pokemon[], rerollCount: number) =>
        !globalScene.gameMode.isDaily && !globalScene.gameMode.isEndless && !globalScene.gameMode.isSplicedOnly
          ? Math.max(5 - rerollCount * 2, 0)
          : 0,
      5,
    ),
    new WeightedModifierType(
      modifierTypes.DNA_SPLICERS,
      (party: Pokemon[]) =>
        !(globalScene.gameMode.isClassic && timedEventManager.areFusionsBoosted())
        && !globalScene.gameMode.isSplicedOnly
        && party.filter(p => !p.fusionSpecies).length > 1
          ? 24
          : 0,
      24,
    ),
    new WeightedModifierType(
      modifierTypes.MINI_BLACK_HOLE,
      () =>
        globalScene.gameMode.isDaily
        || (!globalScene.gameMode.isFreshStartChallenge()
          && globalScene.gameData.isUnlocked(Unlockables.MINI_BLACK_HOLE))
          ? 1
          : 0,
      1,
    ),
  ].map(m => {
    m.setTier(ModifierTier.MASTER);
    return m;
  });
}

function initTrainerModifierPool() {
  trainerModifierPool[ModifierTier.COMMON] = [
    new WeightedModifierType(modifierTypes.BERRY, 8),
    new WeightedModifierType(modifierTypes.BASE_STAT_BOOSTER, 3),
  ].map(m => {
    m.setTier(ModifierTier.COMMON);
    return m;
  });
  trainerModifierPool[ModifierTier.GREAT] = [new WeightedModifierType(modifierTypes.BASE_STAT_BOOSTER, 3)].map(m => {
    m.setTier(ModifierTier.GREAT);
    return m;
  });
  trainerModifierPool[ModifierTier.ULTRA] = [
    new WeightedModifierType(modifierTypes.ATTACK_TYPE_BOOSTER, 10),
    new WeightedModifierType(modifierTypes.WHITE_HERB, 0),
  ].map(m => {
    m.setTier(ModifierTier.ULTRA);
    return m;
  });
  // Local fork (2026-11-12): no Grip Claw (the user: "끈기갈고리손톱 제외하고") and no Lucky Egg, useless on an enemy
  // (ENEMY_TRAINER_BUFFS.items.trainerPoolWeights; before 1 and 4). They stay listed at 0 so a held one keeps its tier
  trainerModifierPool[ModifierTier.ROGUE] = [
    new WeightedModifierType(modifierTypes.FOCUS_BAND, 2),
    new WeightedModifierType(modifierTypes.LUCKY_EGG, ENEMY_TRAINER_BUFFS.items.trainerPoolWeights.LUCKY_EGG),
    new WeightedModifierType(modifierTypes.QUICK_CLAW, 1),
    new WeightedModifierType(modifierTypes.GRIP_CLAW, ENEMY_TRAINER_BUFFS.items.trainerPoolWeights.GRIP_CLAW),
    new WeightedModifierType(modifierTypes.WIDE_LENS, 1),
  ].map(m => {
    m.setTier(ModifierTier.ROGUE);
    return m;
  });
  trainerModifierPool[ModifierTier.MASTER] = [
    new WeightedModifierType(modifierTypes.KINGS_ROCK, 1),
    new WeightedModifierType(modifierTypes.LEFTOVERS, 1),
    new WeightedModifierType(modifierTypes.SHELL_BELL, 1),
    new WeightedModifierType(modifierTypes.SCOPE_LENS, 1),
  ].map(m => {
    m.setTier(ModifierTier.MASTER);
    return m;
  });
}

/**
 * Initialize the enemy buff modifier pool
 */
function initEnemyBuffModifierPool() {
  enemyBuffModifierPool[ModifierTier.COMMON] = [
    new WeightedModifierType(modifierTypes.ENEMY_DAMAGE_BOOSTER, 9),
    new WeightedModifierType(modifierTypes.ENEMY_DAMAGE_REDUCTION, 9),
    new WeightedModifierType(modifierTypes.ENEMY_ATTACK_POISON_CHANCE, 3),
    new WeightedModifierType(modifierTypes.ENEMY_ATTACK_PARALYZE_CHANCE, 3),
    new WeightedModifierType(modifierTypes.ENEMY_ATTACK_BURN_CHANCE, 3),
    new WeightedModifierType(modifierTypes.ENEMY_STATUS_EFFECT_HEAL_CHANCE, 9),
    new WeightedModifierType(modifierTypes.ENEMY_ENDURE_CHANCE, 4),
    new WeightedModifierType(modifierTypes.ENEMY_FUSED_CHANCE, 1),
  ].map(m => {
    m.setTier(ModifierTier.COMMON);
    return m;
  });
  enemyBuffModifierPool[ModifierTier.GREAT] = [
    new WeightedModifierType(modifierTypes.ENEMY_DAMAGE_BOOSTER, 5),
    new WeightedModifierType(modifierTypes.ENEMY_DAMAGE_REDUCTION, 5),
    new WeightedModifierType(modifierTypes.ENEMY_STATUS_EFFECT_HEAL_CHANCE, 5),
    new WeightedModifierType(modifierTypes.ENEMY_ENDURE_CHANCE, 5),
    new WeightedModifierType(modifierTypes.ENEMY_FUSED_CHANCE, 1),
  ].map(m => {
    m.setTier(ModifierTier.GREAT);
    return m;
  });
  enemyBuffModifierPool[ModifierTier.ULTRA] = [
    new WeightedModifierType(modifierTypes.ENEMY_DAMAGE_BOOSTER, 10),
    new WeightedModifierType(modifierTypes.ENEMY_DAMAGE_REDUCTION, 10),
    new WeightedModifierType(modifierTypes.ENEMY_HEAL, 10),
    new WeightedModifierType(modifierTypes.ENEMY_STATUS_EFFECT_HEAL_CHANCE, 10),
    new WeightedModifierType(modifierTypes.ENEMY_ENDURE_CHANCE, 10),
    new WeightedModifierType(modifierTypes.ENEMY_FUSED_CHANCE, 5),
  ].map(m => {
    m.setTier(ModifierTier.ULTRA);
    return m;
  });
  enemyBuffModifierPool[ModifierTier.ROGUE] = [].map((m: WeightedModifierType) => {
    m.setTier(ModifierTier.ROGUE);
    return m;
  });
  enemyBuffModifierPool[ModifierTier.MASTER] = [].map((m: WeightedModifierType) => {
    m.setTier(ModifierTier.MASTER);
    return m;
  });
}

/**
 * Initialize the daily starter modifier pool
 */
function initDailyStarterModifierPool() {
  dailyStarterModifierPool[ModifierTier.COMMON] = [
    new WeightedModifierType(modifierTypes.BASE_STAT_BOOSTER, 1),
    new WeightedModifierType(modifierTypes.BERRY, 3),
  ].map(m => {
    m.setTier(ModifierTier.COMMON);
    return m;
  });
  dailyStarterModifierPool[ModifierTier.GREAT] = [new WeightedModifierType(modifierTypes.ATTACK_TYPE_BOOSTER, 5)].map(
    m => {
      m.setTier(ModifierTier.GREAT);
      return m;
    },
  );
  dailyStarterModifierPool[ModifierTier.ULTRA] = [
    new WeightedModifierType(modifierTypes.REVIVER_SEED, 4),
    new WeightedModifierType(modifierTypes.SOOTHE_BELL, 1),
    new WeightedModifierType(modifierTypes.SOUL_DEW, 1),
    new WeightedModifierType(modifierTypes.GOLDEN_PUNCH, 1),
  ].map(m => {
    m.setTier(ModifierTier.ULTRA);
    return m;
  });
  dailyStarterModifierPool[ModifierTier.ROGUE] = [
    new WeightedModifierType(modifierTypes.GRIP_CLAW, 5),
    new WeightedModifierType(modifierTypes.BATON, 2),
    new WeightedModifierType(modifierTypes.FOCUS_BAND, 5),
    new WeightedModifierType(modifierTypes.QUICK_CLAW, 3),
    new WeightedModifierType(modifierTypes.KINGS_ROCK, 3),
  ].map(m => {
    m.setTier(ModifierTier.ROGUE);
    return m;
  });
  dailyStarterModifierPool[ModifierTier.MASTER] = [
    new WeightedModifierType(modifierTypes.LEFTOVERS, 1),
    new WeightedModifierType(modifierTypes.SHELL_BELL, 1),
  ].map(m => {
    m.setTier(ModifierTier.MASTER);
    return m;
  });
}

/**
 * Initialize {@linkcode modifierPool} with the initial set of modifier types.
 * {@linkcode initModifierTypes} MUST be called before this function.
 */
export function initModifierPools() {
  // The modifier pools the player chooses from during modifier selection
  initCommonModifierPool();
  initGreatModifierPool();
  initUltraModifierPool();
  initRogueModifierPool();
  initMasterModifierPool();
  applyFullHeldItemRule();

  // Modifier pools for specific scenarios
  initWildModifierPool();
  initTrainerModifierPool();
  initEnemyBuffModifierPool();
  initDailyStarterModifierPool();
}

/**
 * High order function that returns a WeightedModifierTypeWeightFunc that will only be applied on
 * classic and skip an ModifierType if current wave is greater or equal to the one passed down
 * @param wave - Wave where we should stop showing the modifier
 * @param defaultWeight - ModifierType default weight
 * @returns A WeightedModifierTypeWeightFunc
 */
function skipInClassicAfterWave(wave: number, defaultWeight: number): WeightedModifierTypeWeightFunc {
  return () => {
    const gameMode = globalScene.gameMode;
    const currentWave = globalScene.currentBattle.waveIndex;
    return gameMode.isClassic && currentWave >= wave ? 0 : defaultWeight;
  };
}

/**
 * High order function that returns a WeightedModifierTypeWeightFunc that will only be applied on
 * classic and it will skip a ModifierType if it is the last wave pull.
 * @param defaultWeight ModifierType default weight
 * @returns A WeightedModifierTypeWeightFunc
 */
function skipInLastClassicWaveOrDefault(defaultWeight: number): WeightedModifierTypeWeightFunc {
  return skipInClassicAfterWave(199, defaultWeight);
}

/**
 * High order function that returns a WeightedModifierTypeWeightFunc to ensure Lures don't spawn on Classic 199
 * or if the lure still has over 60% of its duration left
 * @param maxBattles The max battles the lure type in question lasts. 10 for green, 15 for Super, 30 for Max
 * @param weight The desired weight for the lure when it does spawn
 * @returns A WeightedModifierTypeWeightFunc
 */
function lureWeightFunc(maxBattles: number, weight: number): WeightedModifierTypeWeightFunc {
  return () => {
    const lures = globalScene.getModifiers(DoubleBattleChanceBoosterModifier);
    return !(globalScene.gameMode.isClassic && globalScene.currentBattle.waveIndex === 199)
      && (lures.length === 0
        || lures.filter(m => m.getMaxBattles() === maxBattles && m.getBattleCount() >= maxBattles * 0.6).length === 0)
      ? weight
      : 0;
  };
}

/**
 * Used to check if the player has max of a given ball type.
 * Local fork: every mode, not only Classic. `AddPokeballModifier` caps the count at 99 in every mode, so in
 * Endless a full stack of balls used to keep being offered as a reward that gave nothing.
 * @param ballType The {@linkcode PokeballType} being checked
 * @returns boolean: true if the player has the maximum of a given ball type
 */
function hasMaximumBalls(ballType: PokeballType): boolean {
  return globalScene.pokeballCounts[ballType] >= MAX_PER_TYPE_POKEBALLS;
}
