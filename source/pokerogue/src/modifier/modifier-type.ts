import { TYPE_BOOST_ITEM_BOOST_PERCENT } from "#app/constants";
import { timedEventManager } from "#app/global-event-manager";
import { globalScene } from "#app/global-scene";
import { settings } from "#app/global-settings-manager";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { getPokemonNameWithAffix } from "#app/messages";
import { activeOverrides } from "#app/overrides";
import {
  BASE_TIER_COUNTS,
  currentWave,
  getEndlessTierCounts,
  tierFromRoll,
  usesEndlessTierBands,
} from "#balance/endless-balance";
import { getEnemyTrainerTierCounts } from "#balance/enemy-trainer-buffs"; // Local fork (2026-11-12)
// Local fork (2026-11-12): the fork items wait for the first Classic clear
import { FORK_UNLOCK, isForkContentUnlocked, isForkFormChangeItemLocked } from "#balance/fork-unlock";
import { EvolutionItem } from "#balance/pokemon-evolutions";
import { getTmNumber, tmPoolTiers } from "#balance/tm-pool-tiers";
import { getBerryEffectDescription, getBerryName } from "#data/berry";
import { getDailyEventSeedLuck } from "#data/daily-run";
import { allMoves, modifierTypes } from "#data/data-lists";
import { SpeciesFormChangeItemTrigger } from "#data/form-change-triggers";
import { getNatureName, getNatureStatMultiplier } from "#data/nature";
import { getPokeballCatchMultiplier, getPokeballName } from "#data/pokeball";
import { SpeciesFormChangeCondition } from "#data/pokemon-forms";
import { getStatusEffectDescriptor } from "#data/status-effect";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BerryType } from "#enums/berry-type";
import { ChallengeType } from "#enums/challenge-type";
import { FormChangeItem } from "#enums/form-change-item";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { PokeballType } from "#enums/pokeball";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import type { PermanentStat, TempBattleStat } from "#enums/stat";
import { getStatKey, PERMANENT_STATS, Stat, TEMP_BATTLE_STATS } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { VoucherType } from "#enums/voucher-type";
import type { EnemyPokemon, PlayerPokemon, Pokemon } from "#field/pokemon";
// Local fork (2026-11-08): candyPileLevels replaces the per-candy constants here
// Local fork (2026-11-11): the Master TM (hasMasterTmMove, MasterTmModifier)
import { CandyPileModifier, candyPileLevels, hasMasterTmMove, MasterTmModifier } from "#modifiers/custom-consumables";
import {
  AssaultVestModifier,
  BoosterEnergyModifier, // Local fork (2026-11-11)
  BulletproofVestModifier,
  CHOICE_ITEM_STATS,
  ChampionBeltModifier, // Local fork (2026-11-12)
  ChoiceArmorModifier, // Local fork (2026-11-09)
  ChoiceItemModifier,
  ClearAmuletModifier, // Local fork (2026-11-11)
  DischargedCoilModifier, // Local fork (2026-11-10)
  EVOLUTION_CRYSTAL_STATS, // Local fork (2026-11-09)
  EvItemModifier, // Local fork (2026-11-12)
  EvolutionCrystalModifier, // Local fork (2026-11-09)
  ExpertBeltModifier, // Local fork (2026-11-11)
  FlameCauldronModifier, // Local fork (2026-11-09)
  FlameFurnaceModifier, // Local fork (2026-11-10)
  ForgedSteelModifier,
  FourLeafCloverLeafModifier, // Local fork (2026-11-11)
  FourLeafCloverModifier, // Local fork (2026-11-11)
  FuelModifier, // Local fork (2026-11-11)
  GoldenFourLeafCloverModifier, // Local fork (2026-11-11)
  getIvCandyDescription, // Local fork (2026-11-13): 6% for a player's HP, 3% for the others and for enemies
  getPartyCloverLuck, // Local fork (2026-11-11)
  holdsDischargedCoil, // Local fork (2026-11-10)
  IvCandyModifier,
  LifeOrbModifier,
  LoadedDiceModifier, // Local fork (2026-11-11)
  MAX_PARTY_LUCK, // Local fork (2026-11-11)
  MasterPunchingGloveModifier, // Local fork (2026-11-11)
  MetronomeModifier, // Local fork (2026-11-11)
  MuscleBandModifier, // Local fork (2026-11-11)
  PowerHerbModifier, // Local fork (2026-11-11)
  PrecisionLensModifier, // Local fork (2026-11-11)
  PrismModifier,
  PunchingGloveModifier, // Local fork (2026-11-11)
  RadioactiveWasteModifier, // Local fork (2026-11-09)
  SeedPouchModifier, // Local fork (2026-11-11)
  SuperconductingCoilModifier, // Local fork (2026-11-10)
  ThroatSprayModifier, // Local fork (2026-11-11)
  ToxicDistillateModifier, // Local fork (2026-11-10)
  ToxicDistillerModifier, // Local fork (2026-11-10)
  TrainingShacklesModifier, // Local fork (2026-11-09)
  UltimateGeneModifier, // Local fork (2026-11-09)
  WeightBandModifier, // Local fork (2026-11-12)
  WiseGlassesModifier, // Local fork (2026-11-11)
} from "#modifiers/custom-held-items";
import { EV_RULES, type EvItemId } from "#modifiers/ev-items"; // Local fork (2026-11-12): the EV items
import {
  AddPokeballModifier,
  AddVoucherModifier,
  AttackTypeBoosterModifier,
  BaseStatModifier,
  BerryModifier,
  BoostBugSpawnModifier,
  BypassSpeedChanceModifier,
  ContactHeldItemTransferChanceModifier,
  CritBoosterModifier,
  CriticalCatchChanceBoosterModifier,
  DamageMoneyRewardModifier,
  DoubleBattleChanceBoosterModifier,
  EnemyAttackStatusEffectChanceModifier,
  EnemyDamageBoosterModifier,
  EnemyDamageReducerModifier,
  EnemyEndureChanceModifier,
  EnemyFusionChanceModifier,
  type EnemyPersistentModifier,
  EnemyStatusEffectHealChanceModifier,
  EnemyTurnHealModifier,
  EvolutionItemModifier,
  EvolutionStatBoosterModifier,
  EvoTrackerModifier,
  ExpBalanceModifier,
  ExpBoosterModifier,
  ExpShareModifier,
  ExtraModifierModifier,
  FieldEffectModifier,
  FlinchChanceModifier,
  FusePokemonModifier,
  GigantamaxAccessModifier,
  GuardTokenModifier, // Local fork (2026-11-13): 방호 토큰
  getVitaminPercent, // Local fork (2026-11-13): 10% for all six since the 09 patch (HP was 15% for a while)
  HealingBoosterModifier,
  HealShopCostModifier,
  HiddenAbilityRateBoosterModifier,
  HitHealModifier,
  IvScannerModifier,
  LevelIncrementBoosterModifier,
  LockModifierTiersModifier,
  MapModifier,
  MegaEvolutionAccessModifier,
  type Modifier,
  MoneyInterestModifier,
  MoneyMultiplierModifier,
  MoneyRewardModifier,
  MultipleParticipantExpBonusModifier,
  type PersistentModifier,
  PITCH_BLACK_SHUCKLE_JUICE_VALUE,
  PiercingTokenModifier, // Local fork (2026-11-12): 관통 토큰
  PokemonAllMovePpRestoreModifier,
  PokemonBaseStatFlatModifier,
  PokemonBaseStatTotalModifier,
  PokemonExpBoosterModifier,
  PokemonFormChangeItemModifier,
  PokemonFriendshipBoosterModifier,
  PokemonHeldItemModifier,
  PokemonHpRestoreModifier,
  PokemonIncrementingStatModifier,
  PokemonInstantReviveModifier,
  PokemonLevelIncrementModifier,
  PokemonMoveAccuracyBoosterModifier,
  PokemonMultiHitModifier,
  PokemonNatureChangeModifier,
  PokemonNatureWeightModifier,
  PokemonPpRestoreModifier,
  PokemonPpUpModifier,
  PokemonStatusHealModifier,
  PreserveBerryModifier,
  RememberMoveModifier,
  ResetNegativeStatStageModifier,
  ShinyRateBoosterModifier,
  SpeciesCritBoosterModifier,
  SpeciesStatBoosterModifier,
  SurviveDamageModifier,
  SwitchEffectTransferModifier,
  TempCritBoosterModifier,
  TempExtraModifierModifier,
  TempStatStageBoosterModifier,
  TerastallizeAccessModifier,
  TerastallizeModifier,
  TmModifier,
  TurnHealModifier,
  TurnHeldItemTransferModifier,
  TurnStatusEffectModifier,
} from "#modifiers/modifier";
import type { PokemonMove } from "#moves/pokemon-move";
import { getVoucherTypeIcon, getVoucherTypeName } from "#system/voucher";
import type { ModifierTypeFunc, WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import type { ObjectValues } from "#types/type-helpers";
import type { PokemonMoveSelectFilter, PokemonSelectFilter } from "#ui/party-ui-handler";
import { PartyUiHandler } from "#ui/party-ui-handler";
import { getModifierTierTextTint } from "#ui/text";
import { applyChallenges } from "#utils/challenge-utils";
import { BooleanHolder, formatMoney, NumberHolder, randSeedInt, randSeedItem } from "#utils/common";
import { getEnumKeys, getEnumValues } from "#utils/enums";
import { getPokemonTypeLocaleKey } from "#utils/i18n";
import { getModifierPoolForType, getModifierType } from "#utils/modifier-utils";
import i18next from "i18next";
import Phaser from "phaser";

const outputModifierData = false;
const useMaxWeightForOutput = false;

type NewModifierFunc = (type: ModifierType, args: any[]) => Modifier;

export class ModifierType {
  public id: string;
  public localeKey: string;
  public iconImage: string;
  public group: string;
  public soundName: string;
  public tier: ModifierTier;
  protected newModifierFunc: NewModifierFunc | null;

  /**
   * Checks if the modifier type is of a specific type
   * @param modifierType - The type to check against
   * @returns Whether the modifier type is of the specified type
   */
  public is<K extends ModifierTypeString>(modifierType: K): this is ModifierTypeInstanceMap[K] {
    const targetType = ModifierTypeConstructorMap[modifierType];
    if (!targetType) {
      return false;
    }
    return this instanceof targetType;
  }

  constructor(
    localeKey: string | null,
    iconImage: string | null,
    newModifierFunc: NewModifierFunc | null,
    group?: string,
    soundName?: string,
  ) {
    this.localeKey = localeKey!; // TODO: is this bang correct?
    this.iconImage = iconImage!; // TODO: is this bang correct?
    this.group = group!; // TODO: is this bang correct?
    this.soundName = soundName ?? "se/restore";
    this.newModifierFunc = newModifierFunc;
  }

  get name(): string {
    return i18next.t(`${this.localeKey}.name` as any);
  }

  getDescription(): string {
    return i18next.t(`${this.localeKey}.description` as any);
  }

  setTier(tier: ModifierTier): void {
    this.tier = tier;
  }

  getOrInferTier(poolType: ModifierPoolType = ModifierPoolType.PLAYER): ModifierTier | null {
    if (this.tier) {
      return this.tier;
    }
    if (!this.id) {
      return null;
    }
    let poolTypes: ModifierPoolType[];
    switch (poolType) {
      case ModifierPoolType.PLAYER:
        poolTypes = [poolType, ModifierPoolType.TRAINER, ModifierPoolType.WILD];
        break;
      case ModifierPoolType.WILD:
        poolTypes = [poolType, ModifierPoolType.PLAYER, ModifierPoolType.TRAINER];
        break;
      case ModifierPoolType.TRAINER:
        poolTypes = [poolType, ModifierPoolType.PLAYER, ModifierPoolType.WILD];
        break;
      default:
        poolTypes = [poolType];
        break;
    }
    // Try multiple pool types in case of stolen items
    for (const type of poolTypes) {
      const pool = getModifierPoolForType(type);
      for (const tier of getEnumValues(ModifierTier)) {
        if (!Object.hasOwn(pool, tier)) {
          continue;
        }
        if (pool[tier].find(m => (m as WeightedModifierType).modifierType.id === this.id)) {
          return (this.tier = tier);
        }
      }
    }
    return null;
  }

  /**
   * Populates item id for ModifierType instance
   * @param func
   */
  withIdFromFunc(func: ModifierTypeFunc): ModifierType {
    this.id = Object.keys(modifierTypeInitObj).find(k => modifierTypeInitObj[k] === func)!; // TODO: is this bang correct?
    return this;
  }

  /**
   * Populates item tier for ModifierType instance
   * Tier is a necessary field for items that appear in player shop (determines the Pokeball visual they use)
   * To find the tier, this function performs a reverse lookup of the item type in modifier pools
   * It checks the weight of the item and will use the first tier for which the weight is greater than 0
   * This is to allow items to be in multiple item pools depending on the conditions, for example for events
   * If all tiers have a weight of 0 for the item, the first tier where the item was found is used
   * @param poolType Default 'ModifierPoolType.PLAYER'. Which pool to lookup item tier from
   * @param party optional. Needed to check the weight of modifiers with conditional weight (see {@linkcode WeightedModifierTypeWeightFunc})
   *  if not provided or empty, the weight check will be ignored
   * @param rerollCount Default `0`. Used to check the weight of modifiers with conditional weight (see {@linkcode WeightedModifierTypeWeightFunc})
   */
  withTierFromPool(
    poolType: ModifierPoolType = ModifierPoolType.PLAYER,
    party?: PlayerPokemon[],
    rerollCount = 0,
  ): ModifierType {
    let defaultTier: undefined | ModifierTier;
    for (const tier of Object.values(getModifierPoolForType(poolType))) {
      for (const modifier of tier) {
        if (this.id === modifier.modifierType.id) {
          let weight: number;
          if (modifier.weight instanceof Function) {
            weight = party ? modifier.weight(party, rerollCount) : 0;
          } else {
            weight = modifier.weight;
          }
          if (weight > 0) {
            this.tier = modifier.modifierType.tier;
            return this;
          }
          if (defaultTier == null) {
            // If weight is 0, keep track of the first tier where the item was found
            defaultTier = modifier.modifierType.tier;
          }
        }
      }
    }

    // Didn't find a pool with weight > 0, fallback to first tier where the item was found, if any
    if (defaultTier) {
      this.tier = defaultTier;
    }

    return this;
  }

  newModifier(...args: any[]): Modifier | null {
    // biome-ignore lint/complexity/useOptionalChain: Changing to optional would coerce null return into undefined
    return this.newModifierFunc && this.newModifierFunc(this, args);
  }
}

type ModifierTypeGeneratorFunc = (party: readonly Pokemon[], pregenArgs?: any[]) => ModifierType | null;

export class ModifierTypeGenerator extends ModifierType {
  private genTypeFunc: ModifierTypeGeneratorFunc;

  constructor(genTypeFunc: ModifierTypeGeneratorFunc) {
    super(null, null, null);
    this.genTypeFunc = genTypeFunc;
  }

  generateType(party: readonly Pokemon[], pregenArgs?: any[]) {
    const ret = this.genTypeFunc(party, pregenArgs);
    if (ret) {
      ret.id = this.id;
      ret.setTier(this.tier);
    }
    return ret;
  }
}

export interface GeneratedPersistentModifierType {
  getPregenArgs(): any[];
}

export class AddPokeballModifierType extends ModifierType {
  private pokeballType: PokeballType;
  private count: number;

  constructor(iconImage: string, pokeballType: PokeballType, count: number) {
    super("", iconImage, (_type, _args) => new AddPokeballModifier(this, pokeballType, count), "pb", "se/pb_bounce_1");
    this.pokeballType = pokeballType;
    this.count = count;
  }

  getPokeballType(): PokeballType {
    return this.pokeballType;
  }

  get name(): string {
    return i18next.t("modifierType:ModifierType.AddPokeballModifierType.name", {
      modifierCount: this.count,
      pokeballName: getPokeballName(this.pokeballType),
    });
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.AddPokeballModifierType.description", {
      modifierCount: this.count,
      pokeballName: getPokeballName(this.pokeballType),
      catchRate:
        getPokeballCatchMultiplier(this.pokeballType) > -1
          ? `${getPokeballCatchMultiplier(this.pokeballType)}x`
          : "100%",
      pokeballAmount: `${globalScene.pokeballCounts[this.pokeballType]}`,
    });
  }
}

export class AddVoucherModifierType extends ModifierType {
  private voucherType: VoucherType;
  private count: number;

  constructor(voucherType: VoucherType, count: number) {
    super(
      "",
      getVoucherTypeIcon(voucherType),
      (_type, _args) => new AddVoucherModifier(this, voucherType, count),
      "voucher",
    );
    this.count = count;
    this.voucherType = voucherType;
  }

  get name(): string {
    return i18next.t("modifierType:ModifierType.AddVoucherModifierType.name", {
      modifierCount: this.count,
      voucherTypeName: getVoucherTypeName(this.voucherType),
    });
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.AddVoucherModifierType.description", {
      modifierCount: this.count,
      voucherTypeName: getVoucherTypeName(this.voucherType),
    });
  }
}

export class PokemonModifierType extends ModifierType {
  public selectFilter: PokemonSelectFilter | undefined;

  constructor(
    localeKey: string,
    iconImage: string,
    newModifierFunc: NewModifierFunc,
    selectFilter?: PokemonSelectFilter,
    group?: string,
    soundName?: string,
  ) {
    super(localeKey, iconImage, newModifierFunc, group, soundName);

    this.selectFilter = selectFilter;
  }
}

export class PokemonHeldItemModifierType extends PokemonModifierType {
  constructor(
    localeKey: string,
    iconImage: string,
    newModifierFunc: NewModifierFunc,
    group?: string,
    soundName?: string,
  ) {
    super(
      localeKey,
      iconImage,
      newModifierFunc,
      (pokemon: PlayerPokemon) => {
        const dummyModifier = this.newModifier(pokemon);
        const matchingModifier = globalScene.findModifier(
          m => m instanceof PokemonHeldItemModifier && m.pokemonId === pokemon.id && m.matchType(dummyModifier),
        ) as PokemonHeldItemModifier;
        const maxStackCount = dummyModifier.getMaxStackCount();
        if (!maxStackCount) {
          return i18next.t("modifierType:ModifierType.PokemonHeldItemModifierType.extra.inoperable", {
            pokemonName: getPokemonNameWithAffix(pokemon),
          });
        }
        // Local fork: `>=`, a stack kept above a lowered cap (berries, 99 -> 20) is full too
        if (matchingModifier && matchingModifier.stackCount >= maxStackCount) {
          return i18next.t("modifierType:ModifierType.PokemonHeldItemModifierType.extra.tooMany", {
            pokemonName: getPokemonNameWithAffix(pokemon),
          });
        }
        return null;
      },
      group,
      soundName,
    );
  }

  newModifier(...args: any[]): PokemonHeldItemModifier {
    return super.newModifier(...args) as PokemonHeldItemModifier;
  }
}

export class TerastallizeModifierType extends PokemonModifierType {
  private teraType: PokemonType;

  constructor(teraType: PokemonType) {
    super(
      "",
      `${PokemonType[teraType].toLowerCase()}_tera_shard`,
      (type, args) => new TerastallizeModifier(type as TerastallizeModifierType, (args[0] as Pokemon).id, teraType),
      (pokemon: PlayerPokemon) => {
        if (
          [pokemon.species.speciesId, pokemon.fusionSpecies?.speciesId].filter(
            s => s === SpeciesId.TERAPAGOS || s === SpeciesId.OGERPON || s === SpeciesId.SHEDINJA,
          ).length > 0
        ) {
          return PartyUiHandler.NoEffectMessage;
        }
        return null;
      },
      "tera_shard",
    );

    this.teraType = teraType;
  }

  get name(): string {
    return i18next.t("modifierType:ModifierType.TerastallizeModifierType.name", {
      teraType: i18next.t(getPokemonTypeLocaleKey(this.teraType)),
    });
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.TerastallizeModifierType.description", {
      teraType: i18next.t(getPokemonTypeLocaleKey(this.teraType)),
    });
  }

  getPregenArgs(): any[] {
    return [this.teraType];
  }
}

export class PokemonHpRestoreModifierType extends PokemonModifierType {
  protected restorePoints: number;
  protected restorePercent: number;
  protected healStatus: boolean;

  constructor(
    localeKey: string,
    iconImage: string,
    restorePoints: number,
    restorePercent: number,
    healStatus = false,
    newModifierFunc?: NewModifierFunc,
    selectFilter?: PokemonSelectFilter,
    group?: string,
  ) {
    super(
      localeKey,
      iconImage,
      newModifierFunc
        || ((_type, args) =>
          new PokemonHpRestoreModifier(
            this,
            (args[0] as PlayerPokemon).id,
            this.restorePoints,
            this.restorePercent,
            this.healStatus,
            false,
          )),
      selectFilter
        || ((pokemon: PlayerPokemon) => {
          if (
            !pokemon.hp
            || (pokemon.isFullHp()
              && (!this.healStatus || (!pokemon.status && !pokemon.getTag(BattlerTagType.CONFUSED))))
          ) {
            return PartyUiHandler.NoEffectMessage;
          }
          return null;
        }),
      group || "potion",
    );

    this.restorePoints = restorePoints;
    this.restorePercent = restorePercent;
    this.healStatus = healStatus;
  }

  getDescription(): string {
    return this.restorePoints
      ? i18next.t("modifierType:ModifierType.PokemonHpRestoreModifierType.description", {
          restorePoints: this.restorePoints,
          restorePercent: this.restorePercent,
        })
      : this.healStatus
        ? i18next.t("modifierType:ModifierType.PokemonHpRestoreModifierType.extra.fullyWithStatus")
        : i18next.t("modifierType:ModifierType.PokemonHpRestoreModifierType.extra.fully");
  }
}

export class PokemonReviveModifierType extends PokemonHpRestoreModifierType {
  constructor(localeKey: string, iconImage: string, restorePercent: number) {
    super(
      localeKey,
      iconImage,
      0,
      restorePercent,
      false,
      (_type, args) =>
        new PokemonHpRestoreModifier(this, (args[0] as PlayerPokemon).id, 0, this.restorePercent, false, true),
      (pokemon: PlayerPokemon) => {
        if (!pokemon.isFainted()) {
          return PartyUiHandler.NoEffectMessage;
        }
        return null;
      },
      "revive",
    );

    this.selectFilter = (pokemon: PlayerPokemon) => {
      const selectStatus = new BooleanHolder(pokemon.hp !== 0);
      applyChallenges(ChallengeType.PREVENT_REVIVE, selectStatus);
      if (selectStatus.value) {
        return PartyUiHandler.NoEffectMessage;
      }
      return null;
    };
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.PokemonReviveModifierType.description", {
      restorePercent: this.restorePercent,
    });
  }
}

export class PokemonStatusHealModifierType extends PokemonModifierType {
  constructor(localeKey: string, iconImage: string) {
    super(
      localeKey,
      iconImage,
      (_type, args) => new PokemonStatusHealModifier(this, (args[0] as PlayerPokemon).id),
      (pokemon: PlayerPokemon) => {
        if (!pokemon.hp || (!pokemon.status && !pokemon.getTag(BattlerTagType.CONFUSED))) {
          return PartyUiHandler.NoEffectMessage;
        }
        return null;
      },
    );
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.PokemonStatusHealModifierType.description");
  }
}

export abstract class PokemonMoveModifierType extends PokemonModifierType {
  public moveSelectFilter: PokemonMoveSelectFilter | undefined;

  constructor(
    localeKey: string,
    iconImage: string,
    newModifierFunc: NewModifierFunc,
    selectFilter?: PokemonSelectFilter,
    moveSelectFilter?: PokemonMoveSelectFilter,
    group?: string,
  ) {
    super(localeKey, iconImage, newModifierFunc, selectFilter, group);

    this.moveSelectFilter = moveSelectFilter;
  }
}

export class PokemonPpRestoreModifierType extends PokemonMoveModifierType {
  protected restorePoints: number;

  constructor(localeKey: string, iconImage: string, restorePoints: number) {
    super(
      localeKey,
      iconImage,
      (_type, args) =>
        new PokemonPpRestoreModifier(this, (args[0] as PlayerPokemon).id, args[1] as number, this.restorePoints),
      (_pokemon: PlayerPokemon) => {
        return null;
      },
      (pokemonMove: PokemonMove) => {
        if (!pokemonMove.ppUsed) {
          return PartyUiHandler.NoEffectMessage;
        }
        return null;
      },
      "ether",
    );

    this.restorePoints = restorePoints;
  }

  getDescription(): string {
    return this.restorePoints > -1
      ? i18next.t("modifierType:ModifierType.PokemonPpRestoreModifierType.description", {
          restorePoints: this.restorePoints,
        })
      : i18next.t("modifierType:ModifierType.PokemonPpRestoreModifierType.extra.fully");
  }
}

export class PokemonAllMovePpRestoreModifierType extends PokemonModifierType {
  protected restorePoints: number;

  constructor(localeKey: string, iconImage: string, restorePoints: number) {
    super(
      localeKey,
      iconImage,
      (_type, args) => new PokemonAllMovePpRestoreModifier(this, (args[0] as PlayerPokemon).id, this.restorePoints),
      (pokemon: PlayerPokemon) => {
        if (pokemon.getMoveset().filter(m => m.ppUsed).length === 0) {
          return PartyUiHandler.NoEffectMessage;
        }
        return null;
      },
      "elixir",
    );

    this.restorePoints = restorePoints;
  }

  getDescription(): string {
    return this.restorePoints > -1
      ? i18next.t("modifierType:ModifierType.PokemonAllMovePpRestoreModifierType.description", {
          restorePoints: this.restorePoints,
        })
      : i18next.t("modifierType:ModifierType.PokemonAllMovePpRestoreModifierType.extra.fully");
  }
}

export class PokemonPpUpModifierType extends PokemonMoveModifierType {
  protected upPoints: number;

  constructor(localeKey: string, iconImage: string, upPoints: number) {
    super(
      localeKey,
      iconImage,
      (_type, args) => new PokemonPpUpModifier(this, (args[0] as PlayerPokemon).id, args[1] as number, this.upPoints),
      (_pokemon: PlayerPokemon) => {
        return null;
      },
      (pokemonMove: PokemonMove) => {
        if (pokemonMove.getMove().pp < 5 || pokemonMove.ppUp >= 3 || pokemonMove.maxPpOverride) {
          return PartyUiHandler.NoEffectMessage;
        }
        return null;
      },
      "ppUp",
    );

    this.upPoints = upPoints;
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.PokemonPpUpModifierType.description", { upPoints: this.upPoints });
  }
}

export class PokemonNatureChangeModifierType extends PokemonModifierType {
  protected nature: Nature;

  constructor(nature: Nature) {
    super(
      "",
      `mint_${
        getEnumKeys(Stat)
          .find(s => getNatureStatMultiplier(nature, Stat[s]) > 1)
          ?.toLowerCase() || "neutral"
      }`,
      (_type, args) => new PokemonNatureChangeModifier(this, (args[0] as PlayerPokemon).id, this.nature),
      (pokemon: PlayerPokemon) => {
        if (pokemon.getNature() === this.nature) {
          return PartyUiHandler.NoEffectMessage;
        }
        return null;
      },
      "mint",
    );

    this.nature = nature;
  }

  getNature(): Nature {
    return this.nature;
  }

  get name(): string {
    return i18next.t("modifierType:ModifierType.PokemonNatureChangeModifierType.name", {
      natureName: getNatureName(this.nature),
    });
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.PokemonNatureChangeModifierType.description", {
      natureName: getNatureName(this.nature, true, true, true),
    });
  }
}

export class RememberMoveModifierType extends PokemonModifierType {
  constructor(localeKey: string, iconImage: string, group?: string) {
    super(
      localeKey,
      iconImage,
      (type, args) => new RememberMoveModifier(type, (args[0] as PlayerPokemon).id, args[1] as number),
      (pokemon: PlayerPokemon) => {
        if (pokemon.getLearnableLevelMoves().length === 0) {
          return PartyUiHandler.NoEffectMessage;
        }
        return null;
      },
      group,
    );
  }
}

export class DoubleBattleChanceBoosterModifierType extends ModifierType {
  private maxBattles: number;

  constructor(localeKey: string, iconImage: string, maxBattles: number) {
    super(localeKey, iconImage, (_type, _args) => new DoubleBattleChanceBoosterModifier(this, maxBattles), "lure");

    this.maxBattles = maxBattles;
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.DoubleBattleChanceBoosterModifierType.description", {
      battleCount: this.maxBattles,
    });
  }
}

export class TempStatStageBoosterModifierType extends ModifierType implements GeneratedPersistentModifierType {
  private stat: TempBattleStat;
  private nameKey: string;
  private quantityKey: string;

  constructor(stat: TempBattleStat) {
    const nameKey = TempStatStageBoosterModifierTypeGenerator.items[stat];
    super("", nameKey, (_type, _args) => new TempStatStageBoosterModifier(this, this.stat, 5));

    this.stat = stat;
    this.nameKey = nameKey;
    this.quantityKey = stat === Stat.ACC ? "stage" : "percentage";
  }

  get name(): string {
    return i18next.t(`modifierType:TempStatStageBoosterItem.${this.nameKey}`);
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.TempStatStageBoosterModifierType.description", {
      stat: i18next.t(getStatKey(this.stat)),
      amount: i18next.t(`modifierType:ModifierType.TempStatStageBoosterModifierType.extra.${this.quantityKey}`),
    });
  }

  getPregenArgs(): any[] {
    return [this.stat];
  }
}

export class BerryModifierType extends PokemonHeldItemModifierType implements GeneratedPersistentModifierType {
  private berryType: BerryType;

  constructor(berryType: BerryType) {
    super(
      "",
      `${BerryType[berryType].toLowerCase()}_berry`,
      (type, args) => new BerryModifier(type, (args[0] as Pokemon).id, berryType),
      "berry",
    );

    this.berryType = berryType;
    this.id = "BERRY"; // needed to prevent harvest item deletion; remove after modifier rework
  }

  get name(): string {
    return getBerryName(this.berryType);
  }

  getDescription(): string {
    return getBerryEffectDescription(this.berryType);
  }

  getPregenArgs(): any[] {
    return [this.berryType];
  }
}

enum AttackTypeBoosterItem {
  SILK_SCARF,
  BLACK_BELT,
  SHARP_BEAK,
  POISON_BARB,
  SOFT_SAND,
  HARD_STONE,
  SILVER_POWDER,
  SPELL_TAG,
  METAL_COAT,
  CHARCOAL,
  MYSTIC_WATER,
  MIRACLE_SEED,
  MAGNET,
  TWISTED_SPOON,
  NEVER_MELT_ICE,
  DRAGON_FANG,
  BLACK_GLASSES,
  FAIRY_FEATHER,
}

export class AttackTypeBoosterModifierType
  extends PokemonHeldItemModifierType
  implements GeneratedPersistentModifierType
{
  public moveType: PokemonType;
  public boostPercent: number;

  constructor(moveType: PokemonType, boostPercent: number) {
    super(
      "",
      `${AttackTypeBoosterItem[moveType]?.toLowerCase()}`,
      (_type, args) => new AttackTypeBoosterModifier(this, (args[0] as Pokemon).id, moveType, boostPercent),
    );

    this.moveType = moveType;
    this.boostPercent = boostPercent;
  }

  get name(): string {
    return i18next.t(`modifierType:AttackTypeBoosterItem.${AttackTypeBoosterItem[this.moveType]?.toLowerCase()}`);
  }

  getDescription(): string {
    // TODO: Need getTypeName?
    return i18next.t("modifierType:ModifierType.AttackTypeBoosterModifierType.description", {
      moveType: i18next.t(getPokemonTypeLocaleKey(this.moveType)),
    });
  }

  getPregenArgs(): any[] {
    return [this.moveType];
  }
}

export type SpeciesStatBoosterItem = keyof typeof SpeciesStatBoosterModifierTypeGenerator.items;

/** Modifier type for {@linkcode SpeciesStatBoosterModifier} */
export class SpeciesStatBoosterModifierType
  extends PokemonHeldItemModifierType
  implements GeneratedPersistentModifierType
{
  public key: SpeciesStatBoosterItem;

  constructor(key: SpeciesStatBoosterItem) {
    const item = SpeciesStatBoosterModifierTypeGenerator.items[key];
    super(
      `modifierType:SpeciesBoosterItem.${key}`,
      key.toLowerCase(),
      (type, args) =>
        new SpeciesStatBoosterModifier(type, (args[0] as Pokemon).id, item.stats, item.multiplier, item.species),
    );

    this.key = key;
  }

  getPregenArgs(): any[] {
    return [this.key];
  }
}

export class PokemonLevelIncrementModifierType extends PokemonModifierType {
  constructor(localeKey: string, iconImage: string) {
    super(
      localeKey,
      iconImage,
      (_type, args) => new PokemonLevelIncrementModifier(this, (args[0] as PlayerPokemon).id),
      (_pokemon: PlayerPokemon) => null,
    );
  }

  getDescription(): string {
    let levels = 1;
    const hasCandyJar = globalScene.modifiers.find(modifier => modifier instanceof LevelIncrementBoosterModifier);
    if (hasCandyJar) {
      levels += hasCandyJar.stackCount;
    }
    return i18next.t("modifierType:ModifierType.PokemonLevelIncrementModifierType.description", { levels });
  }
}

export class AllPokemonLevelIncrementModifierType extends ModifierType {
  constructor(localeKey: string, iconImage: string) {
    super(localeKey, iconImage, (_type, _args) => new PokemonLevelIncrementModifier(this, -1));
  }

  getDescription(): string {
    let levels = 1;
    const hasCandyJar = globalScene.modifiers.find(modifier => modifier instanceof LevelIncrementBoosterModifier);
    if (hasCandyJar) {
      levels += hasCandyJar.stackCount;
    }
    return i18next.t("modifierType:ModifierType.AllPokemonLevelIncrementModifierType.description", { levels });
  }
}

/**
 * Local fork (2026-11-05): Candy Pile (사탕더미) = 5 Rare Candies on the chosen Pokémon + 2 Rarer Candies.
 * Local fork (2026-11-08): Candy Jars count once per pile, not once per candy.
 */
export class CandyPileModifierType extends PokemonModifierType {
  constructor(localeKey: string, iconImage: string) {
    super(
      localeKey,
      iconImage,
      (_type, args) => new CandyPileModifier(this, (args[0] as PlayerPokemon).id),
      (_pokemon: PlayerPokemon) => null,
    );
  }

  getDescription(): string {
    // Local fork (2026-11-08): Candy Jars count per pile, not per candy, see `candyPileLevels`. Local fork (2026-11-12):
    // twice for the chosen Pokémon, once for the rest (7 + 2 x jars / 2 + jars; "직접 쓰는 개체에겐 사탕단지 효과 두배")
    const levels = candyPileLevels();
    return i18next.t("modifierType:ModifierType.CANDY_PILE.description", {
      targetLevels: levels.target,
      partyLevels: levels.party,
    });
  }
}

export class BaseStatBoosterModifierType
  extends PokemonHeldItemModifierType
  implements GeneratedPersistentModifierType
{
  private stat: PermanentStat;
  private key: string;

  constructor(stat: PermanentStat) {
    const key = BaseStatBoosterModifierTypeGenerator.items[stat];
    super("", key, (_type, args) => new BaseStatModifier(this, (args[0] as Pokemon).id, this.stat));

    this.stat = stat;
    this.key = key;
  }

  get name(): string {
    return i18next.t(`modifierType:BaseStatBoosterItem.${this.key}`);
  }

  getDescription(): string {
    // Local fork (2026-11-13): the percent comes from the code (getVitaminPercent: 10 for all six since the 09 patch,
    // HP was 15 for a while)
    return i18next.t("modifierType:ModifierType.BaseStatBoosterModifierType.description", {
      stat: i18next.t(getStatKey(this.stat)),
      percent: getVitaminPercent(this.stat),
    });
  }

  getPregenArgs(): any[] {
    return [this.stat];
  }
}

/**
 * Local fork (2026-11-06): IV Candy (개체값사탕), the COMMON-tier little brother of the vitamins: 3% of one base
 * stat per candy, up to the holder's IV in it (see {@linkcode IvCandyModifier}). The six icons and names are
 * Cobblemon's IV candies (MPL-2.0, see CREDITS.md).
 */
export class IvCandyModifierType extends PokemonHeldItemModifierType implements GeneratedPersistentModifierType {
  /** Icon frame and locale key per stat (Cobblemon's item names) */
  public static readonly items: Record<PermanentStat, string> = {
    [Stat.HP]: "health_candy",
    [Stat.ATK]: "mighty_candy",
    [Stat.DEF]: "tough_candy",
    [Stat.SPATK]: "smart_candy",
    [Stat.SPDEF]: "courage_candy",
    [Stat.SPD]: "quick_candy",
  };

  private readonly stat: PermanentStat;

  constructor(stat: PermanentStat) {
    super(
      "",
      IvCandyModifierType.items[stat],
      (_type, args) => new IvCandyModifier(this, (args[0] as Pokemon).id, this.stat),
    );
    this.stat = stat;
  }

  get name(): string {
    return i18next.t(`modifierType:IvCandyItem.${IvCandyModifierType.items[this.stat]}`);
  }

  getDescription(): string {
    // Local fork (2026-11-13): 6 for HP, 3 for the others; the player's value (an enemy's Health Candy is 3%, 09 명세
    // 2-2), since the reward screen and the party's items are where this text is read. The enemy modifier bar's
    // tooltip asks the held candy instead (IvCandyModifier.getTooltipDescription), which gives its holder's percent
    return getIvCandyDescription(this.stat);
  }

  /** The stat this candy raises */
  getStat(): PermanentStat {
    return this.stat;
  }

  getPregenArgs(): any[] {
    return [this.stat];
  }
}

/**
 * Local fork (2026-11-06): the stats whose IV Candy at least one of the player's Pokémon can still take (it holds
 * fewer of that candy than its IV in the stat), in stat order. A candy every party member is full of is useless
 * (candies cannot be moved), so the reward roll leaves it out, and with none left the IV Candy weighs 0.
 */
export function getOfferableIvCandyStats(party: readonly Pokemon[]): PermanentStat[] {
  const players = party.filter(p => p.isPlayer());
  return PERMANENT_STATS.filter(stat =>
    players.some(p => {
      const held = globalScene.findModifier(
        m => m instanceof IvCandyModifier && m.pokemonId === p.id && m.getStat() === stat,
        true,
      ) as IvCandyModifier | undefined;
      return (held?.getStackCount() ?? 0) < p.ivs[stat];
    }),
  );
}

/**
 * Shuckle Juice item
 */
export class PokemonBaseStatTotalModifierType
  extends PokemonHeldItemModifierType
  implements GeneratedPersistentModifierType
{
  // Local fork (2026-11-08): any value; 30 is the Pitch-Black Shuckle Juice, with its own name, text and icon
  private readonly statModifier: number;

  constructor(statModifier: number) {
    super(
      `modifierType:ModifierType.${PokemonBaseStatTotalModifierType.getLocaleId(statModifier)}`,
      PokemonBaseStatTotalModifierType.getIconId(statModifier),
      (_type, args) => new PokemonBaseStatTotalModifier(this, (args[0] as Pokemon).id, statModifier),
    );
    this.statModifier = statModifier;
  }

  /**
   * Local fork (2026-11-08): the items-atlas icon of a juice of `statModifier` (a helper instead of a nested ternary,
   * which biome flags): berry_juice_dark for the Pitch-Black juice (30), else the official good / bad one
   */
  private static getIconId(statModifier: number): string {
    if (statModifier === PITCH_BLACK_SHUCKLE_JUICE_VALUE) {
      return "berry_juice_dark";
    }
    return statModifier > 0 ? "berry_juice_good" : "berry_juice_bad";
  }

  /**
   * Local fork (2026-11-08): the locale entry of a juice of `statModifier`: the Pitch-Black juice (30), else the
   * official sweet (any other gain, 10) or bitter (a loss, -15) one
   */
  private static getLocaleId(statModifier: number): string {
    if (statModifier === PITCH_BLACK_SHUCKLE_JUICE_VALUE) {
      return "MYSTERY_ENCOUNTER_SHUCKLE_JUICE_DARK";
    }
    return statModifier > 0 ? "MYSTERY_ENCOUNTER_SHUCKLE_JUICE_GOOD" : "MYSTERY_ENCOUNTER_SHUCKLE_JUICE_BAD";
  }

  override getDescription(): string {
    return i18next.t(
      `modifierType:ModifierType.${PokemonBaseStatTotalModifierType.getLocaleId(this.statModifier)}.description`,
    );
  }

  public getPregenArgs(): any[] {
    return [this.statModifier];
  }
}

class AllPokemonFullHpRestoreModifierType extends ModifierType {
  private descriptionKey: string;

  constructor(localeKey: string, iconImage: string, descriptionKey?: string, newModifierFunc?: NewModifierFunc) {
    super(
      localeKey,
      iconImage,
      newModifierFunc || ((_type, _args) => new PokemonHpRestoreModifier(this, -1, 0, 100, false)),
    );

    this.descriptionKey = descriptionKey!; // TODO: is this bang correct?
  }

  getDescription(): string {
    return i18next.t(
      `${this.descriptionKey || "modifierType:ModifierType.AllPokemonFullHpRestoreModifierType"}.description` as any,
    );
  }
}

class AllPokemonFullReviveModifierType extends AllPokemonFullHpRestoreModifierType {
  constructor(localeKey: string, iconImage: string) {
    super(
      localeKey,
      iconImage,
      "modifierType:ModifierType.AllPokemonFullReviveModifierType",
      (_type, _args) => new PokemonHpRestoreModifier(this, -1, 0, 100, false, true),
    );
    this.group = "revive";
  }
}

export class MoneyRewardModifierType extends ModifierType {
  private moneyMultiplier: number;
  private moneyMultiplierDescriptorKey: string;

  constructor(localeKey: string, iconImage: string, moneyMultiplier: number, moneyMultiplierDescriptorKey: string) {
    super(localeKey, iconImage, (_type, _args) => new MoneyRewardModifier(this, moneyMultiplier), "money", "se/buy");

    this.moneyMultiplier = moneyMultiplier;
    this.moneyMultiplierDescriptorKey = moneyMultiplierDescriptorKey;
  }

  getDescription(): string {
    const moneyAmount = new NumberHolder(globalScene.getWaveMoneyAmount(this.moneyMultiplier));
    globalScene.applyModifiers(MoneyMultiplierModifier, true, moneyAmount);
    const formattedMoney = formatMoney(settings.display.moneyFormat, moneyAmount.value);

    return i18next.t("modifierType:ModifierType.MoneyRewardModifierType.description", {
      moneyMultiplier: i18next.t(this.moneyMultiplierDescriptorKey as any),
      moneyAmount: formattedMoney,
    });
  }
}

export class ExpBoosterModifierType extends ModifierType {
  private boostPercent: number;

  constructor(localeKey: string, iconImage: string, boostPercent: number) {
    super(localeKey, iconImage, () => new ExpBoosterModifier(this, boostPercent));

    this.boostPercent = boostPercent;
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.ExpBoosterModifierType.description", {
      boostPercent: this.boostPercent,
    });
  }
}

export class PokemonExpBoosterModifierType extends PokemonHeldItemModifierType {
  private boostPercent: number;

  constructor(localeKey: string, iconImage: string, boostPercent: number) {
    super(
      localeKey,
      iconImage,
      (_type, args) => new PokemonExpBoosterModifier(this, (args[0] as Pokemon).id, boostPercent),
    );

    this.boostPercent = boostPercent;
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.PokemonExpBoosterModifierType.description", {
      boostPercent: this.boostPercent,
    });
  }
}

export class PokemonFriendshipBoosterModifierType extends PokemonHeldItemModifierType {
  constructor(localeKey: string, iconImage: string) {
    super(localeKey, iconImage, (_type, args) => new PokemonFriendshipBoosterModifier(this, (args[0] as Pokemon).id));
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.PokemonFriendshipBoosterModifierType.description");
  }
}

export class PokemonMoveAccuracyBoosterModifierType extends PokemonHeldItemModifierType {
  private amount: number;

  constructor(localeKey: string, iconImage: string, amount: number, group?: string, soundName?: string) {
    super(
      localeKey,
      iconImage,
      (_type, args) => new PokemonMoveAccuracyBoosterModifier(this, (args[0] as Pokemon).id, amount),
      group,
      soundName,
    );

    this.amount = amount;
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.PokemonMoveAccuracyBoosterModifierType.description", {
      accuracyAmount: this.amount,
    });
  }
}

export class PokemonMultiHitModifierType extends PokemonHeldItemModifierType {
  constructor(localeKey: string, iconImage: string) {
    super(
      localeKey,
      iconImage,
      (type, args) => new PokemonMultiHitModifier(type as PokemonMultiHitModifierType, (args[0] as Pokemon).id),
    );
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.PokemonMultiHitModifierType.description");
  }
}

export class TmModifierType extends PokemonModifierType {
  public moveId: MoveId;

  constructor(moveId: MoveId) {
    super(
      "",
      `tm_${PokemonType[allMoves[moveId].type].toLowerCase()}`,
      (_type, args) => new TmModifier(this, (args[0] as PlayerPokemon).id),
      (pokemon: PlayerPokemon) => {
        if (!pokemon.isTmCompatible(moveId, true)) {
          return PartyUiHandler.NoEffectMessage;
        }
        return null;
      },
      "tm",
    );

    this.moveId = moveId;
  }

  get name(): string {
    return i18next.t("modifierType:ModifierType.TmModifierType.name", {
      moveId: getTmNumber(this.moveId),
      moveName: allMoves[this.moveId].name,
    });
  }

  getDescription(): string {
    return i18next.t(
      settings.display.enableMoveInfo
        ? "modifierType:ModifierType.TmModifierTypeWithInfo.description"
        : "modifierType:ModifierType.TmModifierType.description",
      { moveName: allMoves[this.moveId].name },
    );
  }
}

/**
 * Local fork (2026-11-11): 마스터 기술머신 (Master TM), MASTER tier, icon "master_tm" (a black TM in the Rogue Ball's
 * colours). The user: "마스터 기술머신(마스터, 형태는 검은색 기술머신, 로그볼과 비슷한 색조합, 선택 후 소모됨, 선택한
 * 포켓몬에게 "어느 기술이던지" 가르칠 수 있음, 노가드 + 일격기 조합도 가능(어차피 일격기는 보스에게 맞지 않으니까))".
 *
 * Picking it opens the party screen; after the Pokémon, `SelectModifierPhase` opens the move picker
 * (`#ui/master-tm-picker`: a type, then a move of that type) and makes the modifier with
 * `newModifier(pokemon, moveId)`. Not a {@linkcode TmModifierType}: it has no move of its own, so the party screen
 * uses the plain "use" mode. A Pokémon that already knows every move it could learn cannot take it.
 */
export class MasterTmModifierType extends PokemonModifierType {
  constructor(localeKey: string, iconImage: string) {
    super(
      localeKey,
      iconImage,
      (_type, args) => new MasterTmModifier(this, (args[0] as PlayerPokemon).id, args[1] as MoveId),
      (pokemon: PlayerPokemon) => (hasMasterTmMove(pokemon) ? null : PartyUiHandler.NoEffectMessage),
    );
  }
}

export class EvolutionItemModifierType extends PokemonModifierType implements GeneratedPersistentModifierType {
  public evolutionItem: EvolutionItem;

  constructor(evolutionItem: EvolutionItem) {
    super(
      "",
      EvolutionItem[evolutionItem].toLowerCase(),
      (_type, args) => new EvolutionItemModifier(this, (args[0] as PlayerPokemon).id),
      (pokemon: PlayerPokemon) =>
        pokemon.isEvolutionItemCompatible(this.evolutionItem) ? null : PartyUiHandler.NoEffectMessage,
    );

    this.evolutionItem = evolutionItem;
  }

  get name(): string {
    return i18next.t(`modifierType:EvolutionItem.${EvolutionItem[this.evolutionItem]}`);
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.EvolutionItemModifierType.description");
  }

  getPregenArgs(): any[] {
    return [this.evolutionItem];
  }
}

/**
 * Class that represents form changing items
 */
export class FormChangeItemModifierType extends PokemonModifierType implements GeneratedPersistentModifierType {
  public formChangeItem: FormChangeItem;

  constructor(formChangeItem: FormChangeItem) {
    super(
      "",
      FormChangeItem[formChangeItem].toLowerCase(),
      (_type, args) => new PokemonFormChangeItemModifier(this, (args[0] as PlayerPokemon).id, formChangeItem, true),
      (pokemon: PlayerPokemon) =>
        pokemon.isFormChangeItemCompatible(this.formChangeItem) ? null : PartyUiHandler.NoEffectMessage,
    );

    this.formChangeItem = formChangeItem;
  }

  get name(): string {
    return i18next.t(`modifierType:FormChangeItem.${FormChangeItem[this.formChangeItem]}`);
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.FormChangeItemModifierType.description");
  }

  getPregenArgs(): any[] {
    return [this.formChangeItem];
  }
}

export class FusePokemonModifierType extends PokemonModifierType {
  constructor(localeKey: string, iconImage: string) {
    super(
      localeKey,
      iconImage,
      (_type, args) => new FusePokemonModifier(this, (args[0] as PlayerPokemon).id, (args[1] as PlayerPokemon).id),
      (pokemon: PlayerPokemon) => {
        const selectStatus = new BooleanHolder(pokemon.isFusion());
        applyChallenges(ChallengeType.POKEMON_FUSION, pokemon, selectStatus);
        if (selectStatus.value) {
          return PartyUiHandler.NoEffectMessage;
        }
        return null;
      },
    );
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.FusePokemonModifierType.description");
  }
}

class AttackTypeBoosterModifierTypeGenerator extends ModifierTypeGenerator {
  constructor() {
    super((party: readonly Pokemon[], pregenArgs?: any[]) => {
      if (pregenArgs && pregenArgs.length === 1 && pregenArgs[0] in PokemonType) {
        return new AttackTypeBoosterModifierType(pregenArgs[0] as PokemonType, TYPE_BOOST_ITEM_BOOST_PERCENT);
      }

      const attackMoveTypeWeights = new Map<PokemonType, number>();
      let totalWeight = 0;
      for (const p of party) {
        if (!p.isAllowedInChallenge()) {
          continue;
        }
        for (const pokemonMove of p.getMoveset()) {
          const move = pokemonMove.getMove();
          if (!move.is("AttackMove")) {
            continue;
          }
          // Account for variable type changing moves
          // Get a variable type attribute of the move
          const variableTypeAttr = move.getAttrs("VariableMoveTypeAttr")[0];
          let types: PokemonType[];
          if (variableTypeAttr) {
            types = variableTypeAttr.getTypesForItemSpawn(p, move);
          } else {
            types = p.getMoveTypeForItemSpawn(move);
          }
          for (const type of types) {
            const currentWeight = attackMoveTypeWeights.get(type) ?? 0;
            if (currentWeight < 3) {
              attackMoveTypeWeights.set(type, currentWeight + 1);
              totalWeight++;
            }
          }
        }
      }

      // Local fork (2026-11-06, doc §6-7): no booster of a type that one of the player's Pokémon holds at the cap
      for (const type of getFullAttackTypeBoosterTypes(party)) {
        const typeWeight = attackMoveTypeWeights.get(type);
        if (typeWeight) {
          attackMoveTypeWeights.delete(type);
          totalWeight -= typeWeight;
        }
      }

      if (attackMoveTypeWeights.size === 0) {
        return null;
      }

      const randInt = randSeedInt(totalWeight);
      let weight = 0;

      for (const [type, typeWeight] of attackMoveTypeWeights.entries()) {
        if (randInt < weight + typeWeight) {
          return new AttackTypeBoosterModifierType(type, TYPE_BOOST_ITEM_BOOST_PERCENT);
        }
        weight += typeWeight;
      }

      return null;
    });
  }
}

class BaseStatBoosterModifierTypeGenerator extends ModifierTypeGenerator {
  public static readonly items: Record<PermanentStat, string> = {
    [Stat.HP]: "hp_up",
    [Stat.ATK]: "protein",
    [Stat.DEF]: "iron",
    [Stat.SPATK]: "calcium",
    [Stat.SPDEF]: "zinc",
    [Stat.SPD]: "carbos",
  };

  constructor() {
    super((_party: readonly Pokemon[], pregenArgs?: any[]) => {
      if (pregenArgs) {
        return new BaseStatBoosterModifierType(pregenArgs[0]);
      }
      const randStat: PermanentStat = randSeedInt(Stat.SPD + 1);
      return new BaseStatBoosterModifierType(randStat);
    });
  }
}

class TempStatStageBoosterModifierTypeGenerator extends ModifierTypeGenerator {
  public static readonly items: Record<TempBattleStat, string> = {
    [Stat.ATK]: "x_attack",
    [Stat.DEF]: "x_defense",
    [Stat.SPATK]: "x_sp_atk",
    [Stat.SPDEF]: "x_sp_def",
    [Stat.SPD]: "x_speed",
    [Stat.ACC]: "x_accuracy",
  };

  constructor() {
    super((_party: readonly Pokemon[], pregenArgs?: any[]) => {
      if (pregenArgs && pregenArgs.length === 1 && TEMP_BATTLE_STATS.includes(pregenArgs[0])) {
        return new TempStatStageBoosterModifierType(pregenArgs[0]);
      }
      const randStat: TempBattleStat = randSeedInt(Stat.ACC, Stat.ATK);
      return new TempStatStageBoosterModifierType(randStat);
    });
  }
}

/**
 * Modifier type generator for {@linkcode SpeciesStatBoosterModifierType}, which
 * encapsulates the logic for weighting the most useful held item from
 * the current list of {@linkcode items}.
 */
class SpeciesStatBoosterModifierTypeGenerator extends ModifierTypeGenerator {
  /** Object comprised of the currently available species-based stat boosting held items */
  public static readonly items = {
    LIGHT_BALL: {
      stats: [Stat.ATK, Stat.SPATK],
      multiplier: 2,
      species: [SpeciesId.PIKACHU],
      rare: true,
    },
    THICK_CLUB: {
      stats: [Stat.ATK],
      multiplier: 2,
      species: [SpeciesId.CUBONE, SpeciesId.MAROWAK, SpeciesId.ALOLA_MAROWAK],
      rare: true,
    },
    METAL_POWDER: {
      stats: [Stat.DEF],
      multiplier: 2,
      species: [SpeciesId.DITTO],
      rare: true,
    },
    QUICK_POWDER: {
      stats: [Stat.SPD],
      multiplier: 2,
      species: [SpeciesId.DITTO],
      rare: true,
    },
    DEEP_SEA_SCALE: {
      stats: [Stat.SPDEF],
      multiplier: 2,
      species: [SpeciesId.CLAMPERL],
      rare: false,
    },
    DEEP_SEA_TOOTH: {
      stats: [Stat.SPATK],
      multiplier: 2,
      species: [SpeciesId.CLAMPERL],
      rare: false,
    },
  };

  constructor(rare: boolean) {
    super((party: readonly Pokemon[], pregenArgs?: any[]) => {
      const items = SpeciesStatBoosterModifierTypeGenerator.items;
      if (pregenArgs && pregenArgs.length === 1 && pregenArgs[0] in items) {
        return new SpeciesStatBoosterModifierType(pregenArgs[0] as SpeciesStatBoosterItem);
      }

      // Get a pool of items based on the rarity.
      const keys: SpeciesStatBoosterItem[] = [];
      const values: ObjectValues<typeof items>[] = [];
      const weights: number[] = [];
      for (const [key, val] of Object.entries(SpeciesStatBoosterModifierTypeGenerator.items)) {
        if (val.rare !== rare) {
          continue;
        }
        values.push(val);
        keys.push(key);
        weights.push(0);
      }

      for (const p of party) {
        const speciesId = p.getSpeciesForm(true).speciesId;
        const fusionSpeciesId = p.isFusion() ? p.getFusionSpeciesForm(true).speciesId : null;
        // TODO: Use commented boolean when Fling is implemented
        const hasFling = false; /* p.getMoveset(true).some(m => m.moveId === MoveId.FLING) */

        for (const i in values) {
          const checkedSpecies = values[i].species;
          const checkedStats = values[i].stats;

          // Local fork (2026-11-10): the Light Ball (전기구슬) entry, which a Discharged Coil holder calls (below). A
          // Superconducting Coil counted as a Light Ball here at first; now a Pikachu holding one calls it like any Pikachu
          // (the user: "불꽃화로를 든 근성/열폭주 포켓몬, 맹독증류액을 지닌 독폭주/포이즌힐 포켓몬, 초전도코일을 지닌 피카츄 전부 화염/맹독/전기 구슬이 나오도록 하죠")
          const isLightBallEntry = keys[i] === "LIGHT_BALL";

          // If party member already has the item being weighted currently, skip to the next item
          const hasItem = p
            .getHeldItems()
            .some(
              m =>
                m instanceof SpeciesStatBoosterModifier
                && (m as SpeciesStatBoosterModifier).contains(checkedSpecies[0], checkedStats[0]),
            );

          if (!hasItem) {
            if (checkedSpecies.includes(speciesId) || (!!fusionSpeciesId && checkedSpecies.includes(fusionSpeciesId))) {
              // Add weight if party member has a matching species or, if applicable, a matching fusion species
              weights[i]++;
            } else if (isLightBallEntry && holdsDischargedCoil(p)) {
              // Local fork (2026-11-10): a Discharged Coil (방전코일) holder calls the Light Ball whatever its species, as
              // a Flame Cauldron holder calls the Flame Orb (the user: "전기구슬 얻으면 변하고")
              weights[i]++;
            } else if (checkedSpecies.includes(SpeciesId.PIKACHU) && hasFling) {
              // Add weight to Light Ball if party member has Fling
              weights[i]++;
            }
          }
        }
      }

      // Local fork (2026-11-06, doc §6-7): no species item that one of the player's Pokémon holds at the cap, even if
      // another party member could use one
      for (const i in values) {
        if (
          playerPartyHoldsFull(
            party,
            m => m instanceof SpeciesStatBoosterModifier && m.contains(values[i].species[0], values[i].stats[0]),
          )
        ) {
          weights[i] = 0;
        }
      }

      let totalWeight = 0;
      for (const weight of weights) {
        totalWeight += weight;
      }

      if (totalWeight !== 0) {
        const randInt = randSeedInt(totalWeight, 1);
        let weight = 0;

        for (const i in weights) {
          if (weights[i] !== 0) {
            const curWeight = weight + weights[i];
            if (randInt <= weight + weights[i]) {
              return new SpeciesStatBoosterModifierType(keys[i] as SpeciesStatBoosterItem);
            }
            weight = curWeight;
          }
        }
      }

      return null;
    });
  }
}

class TmModifierTypeGenerator extends ModifierTypeGenerator {
  constructor(tier: ModifierTier) {
    super((party: readonly Pokemon[], pregenArgs?: any[]) => {
      if (pregenArgs && pregenArgs.length === 1 && pregenArgs[0] in MoveId) {
        return new TmModifierType(pregenArgs[0] as MoveId);
      }
      const partyMemberCompatibleTms = party.map(p => (p as PlayerPokemon).getCompatibleTms(true, true, true));
      const tierUniqueCompatibleTms = partyMemberCompatibleTms
        .flat()
        .filter(tm => tmPoolTiers[tm] === tier)
        .filter(tm => !allMoves[tm].isUnimplemented)
        .filter((tm, i, array) => array.indexOf(tm) === i);
      if (tierUniqueCompatibleTms.length === 0) {
        return null;
      }
      // TODO: should this use `randSeedItem`?
      const randTmIndex = randSeedInt(tierUniqueCompatibleTms.length);
      return new TmModifierType(tierUniqueCompatibleTms[randTmIndex]);
    });
  }
}

class EvolutionItemModifierTypeGenerator extends ModifierTypeGenerator {
  constructor(rare: boolean) {
    super((party: readonly Pokemon[], pregenArgs?: any[]) => {
      if (pregenArgs && pregenArgs.length === 1 && pregenArgs[0] in EvolutionItem) {
        return new EvolutionItemModifierType(pregenArgs[0] as EvolutionItem);
      }

      const evolutionItemPool = [
        party
          .filter(
            p =>
              speciesDataRegistry.hasEvolutions(p.species.speciesId)
              && (!p.pauseEvolutions
                || p.species.speciesId === SpeciesId.SLOWPOKE
                || p.species.speciesId === SpeciesId.EEVEE
                || p.species.speciesId === SpeciesId.KIRLIA
                || p.species.speciesId === SpeciesId.SNORUNT),
          )
          .flatMap(p => {
            const evolutions = speciesDataRegistry.getEvolutions(p.species.speciesId);
            return evolutions.filter(e => e.isValidItemEvolution(p));
          }),
        party
          .filter(
            p =>
              p.isFusion()
              && p.fusionSpecies
              && speciesDataRegistry.hasEvolutions(p.fusionSpecies.speciesId)
              && (!p.pauseEvolutions
                || p.fusionSpecies.speciesId === SpeciesId.SLOWPOKE
                || p.fusionSpecies.speciesId === SpeciesId.EEVEE
                || p.fusionSpecies.speciesId === SpeciesId.KIRLIA
                || p.fusionSpecies.speciesId === SpeciesId.SNORUNT),
          )
          .flatMap(p => {
            const evolutions = speciesDataRegistry.getEvolutions(p.fusionSpecies!.speciesId);
            return evolutions.filter(e => e.isValidItemEvolution(p, true));
          }),
      ]
        .flat()
        .flatMap(e => e.item)
        .filter(i => !!i && i > 50 === rare);

      if (evolutionItemPool.length === 0) {
        return null;
      }

      // TODO: should this use `randSeedItem`?
      return new EvolutionItemModifierType(evolutionItemPool[randSeedInt(evolutionItemPool.length)]!); // TODO: is the bang correct?
    });
  }
}

export class FormChangeItemModifierTypeGenerator extends ModifierTypeGenerator {
  constructor(isRareFormChangeItem: boolean) {
    super((party: readonly Pokemon[], pregenArgs?: any[]) => {
      if (pregenArgs && pregenArgs.length === 1 && pregenArgs[0] in FormChangeItem) {
        return new FormChangeItemModifierType(pregenArgs[0] as FormChangeItem);
      }

      const formChangeItemPool = [
        ...new Set(
          party
            .filter(p => speciesDataRegistry.hasFormChanges(p.species.speciesId))
            .flatMap(p => {
              const formChanges = speciesDataRegistry.getFormChanges(p.species.speciesId);
              let formChangeItemTriggers = formChanges
                .filter(
                  fc =>
                    ((fc.formKey.indexOf(SpeciesFormKey.MEGA) === -1
                      && fc.formKey.indexOf(SpeciesFormKey.PRIMAL) === -1)
                      || globalScene.getModifiers(MegaEvolutionAccessModifier).length > 0)
                    && ((fc.formKey.indexOf(SpeciesFormKey.GIGANTAMAX) === -1
                      && fc.formKey.indexOf(SpeciesFormKey.ETERNAMAX) === -1)
                      || globalScene.getModifiers(GigantamaxAccessModifier).length > 0)
                    && (fc.conditions.length === 0
                      || fc.conditions.filter(cond => cond instanceof SpeciesFormChangeCondition && cond.predicate(p))
                        .length > 0)
                    && fc.preFormKey === p.getFormKey(),
                )
                .map(fc => fc.findTrigger(SpeciesFormChangeItemTrigger) as SpeciesFormChangeItemTrigger)
                .filter(
                  t =>
                    t?.active
                    && !globalScene.findModifier(
                      m =>
                        m instanceof PokemonFormChangeItemModifier
                        && m.pokemonId === p.id
                        && m.formChangeItem === t.item,
                    ),
                );

              if (p.species.speciesId === SpeciesId.NECROZMA) {
                // technically we could use a simplified version and check for formChanges.length > 3, but in case any code changes later, this might break...
                let foundULTRA_Z = false;
                let foundN_LUNA = false;
                let foundN_SOLAR = false;
                formChangeItemTriggers.forEach((fc, _i) => {
                  console.log("Checking ", fc.item);
                  switch (fc.item) {
                    case FormChangeItem.ULTRANECROZIUM_Z:
                      foundULTRA_Z = true;
                      break;
                    case FormChangeItem.N_LUNARIZER:
                      foundN_LUNA = true;
                      break;
                    case FormChangeItem.N_SOLARIZER:
                      foundN_SOLAR = true;
                      break;
                  }
                });
                if (foundULTRA_Z && foundN_LUNA && foundN_SOLAR) {
                  // all three items are present -> user hasn't acquired any of the N_*ARIZERs -> block ULTRANECROZIUM_Z acquisition.
                  formChangeItemTriggers = formChangeItemTriggers.filter(
                    fc => fc.item !== FormChangeItem.ULTRANECROZIUM_Z,
                  );
                } else {
                  console.log("DID NOT FIND ");
                }
              }
              return formChangeItemTriggers;
            }),
        ),
      ]
        .flat()
        .flatMap(fc => fc.item)
        .filter(i => (i && i < 150) === isRareFormChangeItem)
        // Local fork (2026-11-12): our own Mega Stones only after the first Classic clear (fork-unlock.ts; the user:
        // "저희 대부분의 커스텀 아이템과 커스텀 패시브는 클래식 클리어 후 해금으로 하죠")
        .filter(i => !isForkFormChangeItemLocked(i));
      // convert it into a set to remove duplicate values, which can appear when the same species with a potential form change is in the party.

      if (formChangeItemPool.length === 0) {
        return null;
      }

      // TODO: should this use `randSeedItem`?
      return new FormChangeItemModifierType(formChangeItemPool[randSeedInt(formChangeItemPool.length)]);
    });
  }
}

export class ContactHeldItemTransferChanceModifierType extends PokemonHeldItemModifierType {
  private chancePercent: number;

  constructor(localeKey: string, iconImage: string, chancePercent: number, group?: string, soundName?: string) {
    super(
      localeKey,
      iconImage,
      (type, args) => new ContactHeldItemTransferChanceModifier(type, (args[0] as Pokemon).id, chancePercent),
      group,
      soundName,
    );

    this.chancePercent = chancePercent;
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.ContactHeldItemTransferChanceModifierType.description", {
      chancePercent: this.chancePercent,
    });
  }
}

export class TurnHeldItemTransferModifierType extends PokemonHeldItemModifierType {
  constructor(localeKey: string, iconImage: string, group?: string, soundName?: string) {
    super(
      localeKey,
      iconImage,
      (type, args) => new TurnHeldItemTransferModifier(type, (args[0] as Pokemon).id),
      group,
      soundName,
    );
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.TurnHeldItemTransferModifierType.description");
  }
}

export class EnemyAttackStatusEffectChanceModifierType extends ModifierType {
  private chancePercent: number;
  private effect: StatusEffect;

  constructor(localeKey: string, iconImage: string, chancePercent: number, effect: StatusEffect, stackCount?: number) {
    super(
      localeKey,
      iconImage,
      (type, _args) => new EnemyAttackStatusEffectChanceModifier(type, effect, chancePercent, stackCount),
      "enemy_status_chance",
    );

    this.chancePercent = chancePercent;
    this.effect = effect;
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.EnemyAttackStatusEffectChanceModifierType.description", {
      chancePercent: this.chancePercent,
      statusEffect: getStatusEffectDescriptor(this.effect),
    });
  }
}

export class EnemyEndureChanceModifierType extends ModifierType {
  private chancePercent: number;

  constructor(localeKey: string, iconImage: string, chancePercent: number) {
    super(localeKey, iconImage, (type, _args) => new EnemyEndureChanceModifier(type, chancePercent), "enemy_endure");

    this.chancePercent = chancePercent;
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.EnemyEndureChanceModifierType.description", {
      chancePercent: this.chancePercent,
    });
  }
}

export class WeightedModifierType {
  public modifierType: ModifierType;
  public weight: number | WeightedModifierTypeWeightFunc;
  public maxWeight: number | WeightedModifierTypeWeightFunc;

  constructor(
    modifierTypeFunc: ModifierTypeFunc,
    weight: number | WeightedModifierTypeWeightFunc,
    maxWeight?: number | WeightedModifierTypeWeightFunc,
  ) {
    this.modifierType = modifierTypeFunc();
    this.modifierType.id = Object.keys(modifierTypeInitObj).find(k => modifierTypeInitObj[k] === modifierTypeFunc)!; // TODO: is this bang correct?
    this.weight = weight;
    this.maxWeight = maxWeight || (weight instanceof Function ? 0 : weight);
  }

  setTier(tier: ModifierTier) {
    this.modifierType.setTier(tier);
  }
}

type BaseModifierOverride = {
  name: Exclude<ModifierTypeKeys, GeneratorModifierOverride["name"]>;
  count?: number;
};

/** Type for modifiers and held items that are constructed via {@linkcode ModifierTypeGenerator}. */
export type GeneratorModifierOverride = {
  count?: number;
} & (
  | {
      name: keyof Pick<typeof modifierTypeInitObj, "SPECIES_STAT_BOOSTER" | "RARE_SPECIES_STAT_BOOSTER">;
      type?: SpeciesStatBoosterItem;
    }
  | {
      name: keyof Pick<typeof modifierTypeInitObj, "TEMP_STAT_STAGE_BOOSTER">;
      type?: TempBattleStat;
    }
  | {
      name: keyof Pick<typeof modifierTypeInitObj, "BASE_STAT_BOOSTER" | "IV_CANDY">;
      type?: Stat;
    }
  | {
      name: keyof Pick<typeof modifierTypeInitObj, "MINT">;
      type?: Nature;
    }
  | {
      name: keyof Pick<typeof modifierTypeInitObj, "ATTACK_TYPE_BOOSTER" | "TERA_SHARD">;
      type?: PokemonType;
    }
  | {
      name: keyof Pick<typeof modifierTypeInitObj, "BERRY">;
      type?: BerryType;
    }
  | {
      name: keyof Pick<typeof modifierTypeInitObj, "EVOLUTION_ITEM" | "RARE_EVOLUTION_ITEM">;
      type?: EvolutionItem;
    }
  | {
      name: keyof Pick<typeof modifierTypeInitObj, "FORM_CHANGE_ITEM" | "RARE_FORM_CHANGE_ITEM">;
      type?: FormChangeItem;
    }
  | {
      name: keyof Pick<typeof modifierTypeInitObj, "TM_COMMON" | "TM_GREAT" | "TM_ULTRA">;
      type?: MoveId;
    }
);

/** Type used to construct modifiers and held items for overriding purposes. */
export type ModifierOverride = GeneratorModifierOverride | BaseModifierOverride;

export type ModifierTypeKeys = keyof typeof modifierTypeInitObj;

/**
 * Berry types that at least one of the player's Pokémon in `party` holds at (or, from an older save, above) its
 * stack cap. Local fork, the user's rule from 2026-11-06: such a berry is not offered as a reward at all, even if
 * other Pokémon could still hold it. Enemy parties (enemy held items) are never filtered.
 */
/**
 * Local fork (2026-11-06): whether one of the player's Pokémon in `party` holds a held item picked by `matches` at or
 * above its cap. An enemy party never counts.
 */
export function playerPartyHoldsFull(
  party: readonly Pokemon[],
  matches: (item: PokemonHeldItemModifier) => boolean,
): boolean {
  return party.some(
    p => p.isPlayer() && p.getHeldItems().some(i => matches(i) && i.getStackCount() >= i.getMaxHeldItemCount(p)),
  );
}

/** Local fork (2026-11-06): the move types whose booster one of the player's Pokémon in `party` holds at the cap */
export function getFullAttackTypeBoosterTypes(party: readonly Pokemon[]): Set<PokemonType> {
  const full = new Set<PokemonType>();
  for (const p of party) {
    if (!p.isPlayer()) {
      continue;
    }
    for (const item of p.getHeldItems()) {
      if (item instanceof AttackTypeBoosterModifier && item.getStackCount() >= item.getMaxHeldItemCount(p)) {
        full.add(item.moveType);
      }
    }
  }
  return full;
}

export function getFullBerryTypes(party: readonly Pokemon[]): Set<BerryType> {
  const full = new Set<BerryType>();
  const players = party.filter(p => p.isPlayer());
  if (players.length === 0) {
    return full;
  }
  for (const berry of globalScene.getModifiers(BerryModifier, true)) {
    const holder = players.find(p => p.id === berry.pokemonId);
    if (holder && berry.getStackCount() >= berry.getMaxHeldItemCount(holder)) {
      full.add(berry.berryType);
    }
  }
  return full;
}

/**
 * Local fork (2026-11-08): the berry types the `BERRY` reward generator can still offer to `party`, in `BerryType`
 * order: every type minus {@linkcode getFullBerryTypes}. Empty exactly when that generator returns `null`. Mystery
 * encounters that give berries use it (the user: "보상 테이블에 열매가 더 안나올경우 열매주는 미스터리 조우도 안나오게").
 */
export function getOfferableBerryTypes(party: readonly Pokemon[]): BerryType[] {
  const full = getFullBerryTypes(party);
  return getEnumValues(BerryType).filter(b => !full.has(b));
}

/**
 * Picks a reward berry with the same odds as the `BERRY` generator (Sitrus, Lum and Leppa 1/6 each, the other
 * eight 1/16 each) among the types not in `excluded`, renormalised. `null` when every type is excluded, which
 * makes the reward roll pick another item.
 */
function pickBerryExcluding(berryTypes: BerryType[], excluded: ReadonlySet<BerryType>): BerryModifierType | null {
  const common = [BerryType.SITRUS, BerryType.LUM, BerryType.LEPPA];
  const weighted = berryTypes
    .filter(b => !excluded.has(b))
    .map(b => ({ berry: b, weight: common.includes(b) ? 16 : 6 }));
  const total = weighted.reduce((sum, w) => sum + w.weight, 0);
  if (total === 0) {
    return null;
  }
  let roll = randSeedInt(total);
  for (const w of weighted) {
    if (roll < w.weight) {
      return new BerryModifierType(w.berry);
    }
    roll -= w.weight;
  }
  return null;
}

/**
 * Local fork (2026-11-12): the modifier type of one of the six EV items (파워웨이트 … 파워앵클릿): a plain held item type
 * (one per Pokémon through its modifier's cap), its locale key `modifierType:ModifierType.<id>` and its icon from
 * {@linkcode EV_RULES}.items
 * @param id - The item's modifier type id
 */
function evItemType(id: EvItemId): PokemonHeldItemModifierType {
  const { stat, icon } = EV_RULES.items[id];
  return new PokemonHeldItemModifierType(
    `modifierType:ModifierType.${id}`,
    icon,
    (type, args) => new EvItemModifier(type, (args[0] as Pokemon).id, stat),
  );
}

const modifierTypeInitObj = Object.freeze({
  POKEBALL: () => new AddPokeballModifierType("pb", PokeballType.POKEBALL, 5),
  GREAT_BALL: () => new AddPokeballModifierType("gb", PokeballType.GREAT_BALL, 5),
  ULTRA_BALL: () => new AddPokeballModifierType("ub", PokeballType.ULTRA_BALL, 5),
  ROGUE_BALL: () => new AddPokeballModifierType("rb", PokeballType.ROGUE_BALL, 5),
  MASTER_BALL: () => new AddPokeballModifierType("mb", PokeballType.MASTER_BALL, 1),

  RARE_CANDY: () => new PokemonLevelIncrementModifierType("modifierType:ModifierType.RARE_CANDY", "rare_candy"),
  RARER_CANDY: () => new AllPokemonLevelIncrementModifierType("modifierType:ModifierType.RARER_CANDY", "rarer_candy"),
  // Local fork (2026-11-05): ROGUE-tier Candy Pile; icon made by the image session (tools/port/install_candy_pile_icon.py)
  CANDY_PILE: () => new CandyPileModifierType("modifierType:ModifierType.CANDY_PILE", "candy_pile"),

  EVOLUTION_ITEM: () => new EvolutionItemModifierTypeGenerator(false),
  RARE_EVOLUTION_ITEM: () => new EvolutionItemModifierTypeGenerator(true),
  FORM_CHANGE_ITEM: () => new FormChangeItemModifierTypeGenerator(false),
  RARE_FORM_CHANGE_ITEM: () => new FormChangeItemModifierTypeGenerator(true),

  EVOLUTION_TRACKER_GIMMIGHOUL: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.EVOLUTION_TRACKER_GIMMIGHOUL",
      "relic_gold",
      (type, args) =>
        new EvoTrackerModifier(type, (args[0] as Pokemon).id, SpeciesId.GIMMIGHOUL, 10, (args[1] as number) ?? 1),
    ),

  MEGA_BRACELET: () =>
    new ModifierType(
      "modifierType:ModifierType.MEGA_BRACELET",
      "mega_bracelet",
      (type, _args) => new MegaEvolutionAccessModifier(type),
    ),
  DYNAMAX_BAND: () =>
    new ModifierType(
      "modifierType:ModifierType.DYNAMAX_BAND",
      "dynamax_band",
      (type, _args) => new GigantamaxAccessModifier(type),
    ),
  TERA_ORB: () =>
    new ModifierType(
      "modifierType:ModifierType.TERA_ORB",
      "tera_orb",
      (type, _args) => new TerastallizeAccessModifier(type),
    ),

  MAP: () => new ModifierType("modifierType:ModifierType.MAP", "map", (type, _args) => new MapModifier(type)),

  POTION: () => new PokemonHpRestoreModifierType("modifierType:ModifierType.POTION", "potion", 20, 10),
  SUPER_POTION: () =>
    new PokemonHpRestoreModifierType("modifierType:ModifierType.SUPER_POTION", "super_potion", 50, 25),
  HYPER_POTION: () =>
    new PokemonHpRestoreModifierType("modifierType:ModifierType.HYPER_POTION", "hyper_potion", 200, 50),
  MAX_POTION: () => new PokemonHpRestoreModifierType("modifierType:ModifierType.MAX_POTION", "max_potion", 0, 100),
  FULL_RESTORE: () =>
    new PokemonHpRestoreModifierType("modifierType:ModifierType.FULL_RESTORE", "full_restore", 0, 100, true),

  REVIVE: () => new PokemonReviveModifierType("modifierType:ModifierType.REVIVE", "revive", 50),
  MAX_REVIVE: () => new PokemonReviveModifierType("modifierType:ModifierType.MAX_REVIVE", "max_revive", 100),

  FULL_HEAL: () => new PokemonStatusHealModifierType("modifierType:ModifierType.FULL_HEAL", "full_heal"),

  SACRED_ASH: () => new AllPokemonFullReviveModifierType("modifierType:ModifierType.SACRED_ASH", "sacred_ash"),

  REVIVER_SEED: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.REVIVER_SEED",
      "reviver_seed",
      (type, args) => new PokemonInstantReviveModifier(type, (args[0] as Pokemon).id),
    ),
  WHITE_HERB: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.WHITE_HERB",
      "white_herb",
      (type, args) => new ResetNegativeStatStageModifier(type, (args[0] as Pokemon).id),
    ),

  ETHER: () => new PokemonPpRestoreModifierType("modifierType:ModifierType.ETHER", "ether", 10),
  MAX_ETHER: () => new PokemonPpRestoreModifierType("modifierType:ModifierType.MAX_ETHER", "max_ether", -1),

  ELIXIR: () => new PokemonAllMovePpRestoreModifierType("modifierType:ModifierType.ELIXIR", "elixir", 10),
  MAX_ELIXIR: () => new PokemonAllMovePpRestoreModifierType("modifierType:ModifierType.MAX_ELIXIR", "max_elixir", -1),

  PP_UP: () => new PokemonPpUpModifierType("modifierType:ModifierType.PP_UP", "pp_up", 1),
  PP_MAX: () => new PokemonPpUpModifierType("modifierType:ModifierType.PP_MAX", "pp_max", 3),

  /*REPEL: () => new DoubleBattleChanceBoosterModifierType('Repel', 5),
  SUPER_REPEL: () => new DoubleBattleChanceBoosterModifierType('Super Repel', 10),
  MAX_REPEL: () => new DoubleBattleChanceBoosterModifierType('Max Repel', 25),*/

  LURE: () => new DoubleBattleChanceBoosterModifierType("modifierType:ModifierType.LURE", "lure", 10),
  SUPER_LURE: () => new DoubleBattleChanceBoosterModifierType("modifierType:ModifierType.SUPER_LURE", "super_lure", 15),
  MAX_LURE: () => new DoubleBattleChanceBoosterModifierType("modifierType:ModifierType.MAX_LURE", "max_lure", 30),

  SPECIES_STAT_BOOSTER: () => new SpeciesStatBoosterModifierTypeGenerator(false),
  RARE_SPECIES_STAT_BOOSTER: () => new SpeciesStatBoosterModifierTypeGenerator(true),

  TEMP_STAT_STAGE_BOOSTER: () => new TempStatStageBoosterModifierTypeGenerator(),

  DIRE_HIT: () =>
    new (class extends ModifierType {
      getDescription(): string {
        return i18next.t("modifierType:ModifierType.TempStatStageBoosterModifierType.description", {
          stat: i18next.t("modifierType:ModifierType.DIRE_HIT.extra.raises"),
          amount: i18next.t("modifierType:ModifierType.TempStatStageBoosterModifierType.extra.stage"),
        });
      }
    })("modifierType:ModifierType.DIRE_HIT", "dire_hit", (type, _args) => new TempCritBoosterModifier(type, 5)),

  BASE_STAT_BOOSTER: () => new BaseStatBoosterModifierTypeGenerator(),

  // Local fork (2026-11-06): COMMON-tier IV Candy, 3% of one base stat per candy (IvCandyModifierType)
  IV_CANDY: () =>
    new ModifierTypeGenerator((party: readonly Pokemon[], pregenArgs?: any[]) => {
      if (pregenArgs && pregenArgs.length === 1 && (PERMANENT_STATS as readonly number[]).includes(pregenArgs[0])) {
        return new IvCandyModifierType(pregenArgs[0] as PermanentStat);
      }
      const stats = party.some(p => p.isPlayer()) ? getOfferableIvCandyStats(party) : [...PERMANENT_STATS];
      if (stats.length === 0) {
        return null;
      }
      return new IvCandyModifierType(randSeedItem(stats));
    }),

  ATTACK_TYPE_BOOSTER: () => new AttackTypeBoosterModifierTypeGenerator(),

  MINT: () =>
    new ModifierTypeGenerator((party: readonly Pokemon[], pregenArgs?: any[]) => {
      if (pregenArgs && pregenArgs.length === 1 && pregenArgs[0] in Nature) {
        return new PokemonNatureChangeModifierType(pregenArgs[0] as Nature);
      }
      // Local fork (2026-11-06): no mint of a nature that has been on the party or has been offered before this run;
      // none left makes the reward roll pick another item
      const natures = party.some(p => p.isPlayer()) ? globalScene.getOfferableMintNatures() : getEnumValues(Nature);
      if (natures.length === 0) {
        return null;
      }
      return new PokemonNatureChangeModifierType(randSeedItem(natures));
    }),

  MYSTICAL_ROCK: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.MYSTICAL_ROCK",
      "mystical_rock",
      (type, args) => new FieldEffectModifier(type, (args[0] as Pokemon).id),
    ),

  TERA_SHARD: () =>
    new ModifierTypeGenerator((party: readonly Pokemon[], pregenArgs?: any[]) => {
      if (pregenArgs && pregenArgs.length === 1 && pregenArgs[0] in PokemonType) {
        return new TerastallizeModifierType(pregenArgs[0] as PokemonType);
      }
      if (globalScene.getModifiers(TerastallizeAccessModifier).length === 0) {
        return null;
      }
      const teraTypes: PokemonType[] = [];
      for (const p of party) {
        if (
          !(p.hasSpecies(SpeciesId.TERAPAGOS) || p.hasSpecies(SpeciesId.OGERPON) || p.hasSpecies(SpeciesId.SHEDINJA))
        ) {
          teraTypes.push(p.teraType);
        }
      }
      let excludedType = PokemonType.UNKNOWN;
      if (teraTypes.length > 0 && teraTypes.filter(t => t === teraTypes[0]).length === teraTypes.length) {
        excludedType = teraTypes[0];
      }
      let shardType = randSeedInt(64) ? (randSeedInt(18) as PokemonType) : PokemonType.STELLAR;
      while (shardType === excludedType) {
        shardType = randSeedInt(64) ? (randSeedInt(18) as PokemonType) : PokemonType.STELLAR;
      }
      return new TerastallizeModifierType(shardType);
    }),

  BERRY: () =>
    new ModifierTypeGenerator((party: readonly Pokemon[], pregenArgs?: any[]) => {
      if (pregenArgs && pregenArgs.length === 1 && pregenArgs[0] in BerryType) {
        return new BerryModifierType(pregenArgs[0] as BerryType);
      }
      const berryTypes = getEnumValues(BerryType);
      // Local fork (2026-11-06): a berry is not offered while even one of the player's Pokémon holds its maximum
      const fullBerries = getFullBerryTypes(party);
      if (fullBerries.size > 0) {
        return pickBerryExcluding(berryTypes, fullBerries);
      }
      let randBerryType: BerryType;
      const rand = randSeedInt(12);
      if (rand < 2) {
        randBerryType = BerryType.SITRUS;
      } else if (rand < 4) {
        randBerryType = BerryType.LUM;
      } else if (rand < 6) {
        randBerryType = BerryType.LEPPA;
      } else {
        randBerryType = berryTypes[randSeedInt(berryTypes.length - 3) + 2];
      }
      return new BerryModifierType(randBerryType);
    }),

  TM_COMMON: () => new TmModifierTypeGenerator(ModifierTier.COMMON),
  TM_GREAT: () => new TmModifierTypeGenerator(ModifierTier.GREAT),
  TM_ULTRA: () => new TmModifierTypeGenerator(ModifierTier.ULTRA),
  // Local fork (2026-11-11): MASTER-tier Master TM (마스터 기술머신): teaches the chosen Pokémon any implemented move
  // (custom-consumables.ts, master-tm-picker.ts); icon "master_tm"
  MASTER_TM: () => new MasterTmModifierType("modifierType:ModifierType.MASTER_TM", "master_tm"),

  MEMORY_MUSHROOM: () => new RememberMoveModifierType("modifierType:ModifierType.MEMORY_MUSHROOM", "big_mushroom"),

  EXP_SHARE: () =>
    new ModifierType("modifierType:ModifierType.EXP_SHARE", "exp_share", (type, _args) => new ExpShareModifier(type)),
  EXP_BALANCE: () =>
    new ModifierType(
      "modifierType:ModifierType.EXP_BALANCE",
      "exp_balance",
      (type, _args) => new ExpBalanceModifier(type),
    ),

  OVAL_CHARM: () =>
    new ModifierType(
      "modifierType:ModifierType.OVAL_CHARM",
      "oval_charm",
      (type, _args) => new MultipleParticipantExpBonusModifier(type),
    ),

  EXP_CHARM: () => new ExpBoosterModifierType("modifierType:ModifierType.EXP_CHARM", "exp_charm", 25),
  SUPER_EXP_CHARM: () => new ExpBoosterModifierType("modifierType:ModifierType.SUPER_EXP_CHARM", "super_exp_charm", 60),
  GOLDEN_EXP_CHARM: () =>
    new ExpBoosterModifierType("modifierType:ModifierType.GOLDEN_EXP_CHARM", "golden_exp_charm", 100),

  LUCKY_EGG: () => new PokemonExpBoosterModifierType("modifierType:ModifierType.LUCKY_EGG", "lucky_egg", 40),
  GOLDEN_EGG: () => new PokemonExpBoosterModifierType("modifierType:ModifierType.GOLDEN_EGG", "golden_egg", 100),

  SOOTHE_BELL: () => new PokemonFriendshipBoosterModifierType("modifierType:ModifierType.SOOTHE_BELL", "soothe_bell"),

  SCOPE_LENS: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.SCOPE_LENS",
      "scope_lens",
      (type, args) => new CritBoosterModifier(type, (args[0] as Pokemon).id, 1),
    ),
  LEEK: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.LEEK",
      "leek",
      (type, args) =>
        new SpeciesCritBoosterModifier(type, (args[0] as Pokemon).id, 2, [
          SpeciesId.FARFETCHD,
          SpeciesId.GALAR_FARFETCHD,
          SpeciesId.SIRFETCHD,
        ]),
    ),

  EVIOLITE: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.EVIOLITE",
      "eviolite",
      (type, args) => new EvolutionStatBoosterModifier(type, (args[0] as Pokemon).id, [Stat.DEF, Stat.SPDEF], 1.5),
    ),

  // Local fork (2026-11-09): ULTRA-tier Red / Blue Evolution Crystal (붉은진화의수정 / 푸른진화의수정), the Eviolite's
  // Attack / Sp. Atk x1.5 versions, separate items from it and from each other (custom-held-items.ts); icons
  // "red_evolution_crystal" / "blue_evolution_crystal"
  RED_EVOLUTION_CRYSTAL: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.RED_EVOLUTION_CRYSTAL",
      "red_evolution_crystal",
      (type, args) =>
        new EvolutionCrystalModifier(type, (args[0] as Pokemon).id, EVOLUTION_CRYSTAL_STATS.RED_EVOLUTION_CRYSTAL),
    ),

  BLUE_EVOLUTION_CRYSTAL: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.BLUE_EVOLUTION_CRYSTAL",
      "blue_evolution_crystal",
      (type, args) =>
        new EvolutionCrystalModifier(type, (args[0] as Pokemon).id, EVOLUTION_CRYSTAL_STATS.BLUE_EVOLUTION_CRYSTAL),
    ),

  // Local fork (2026-11-02): MASTER-tier vests, Sp. Def ×1.5 / Def ×1.5
  ASSAULT_VEST: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.ASSAULT_VEST",
      "assault_vest",
      (type, args) => new AssaultVestModifier(type, (args[0] as Pokemon).id),
    ),

  BULLETPROOF_VEST: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.BULLETPROOF_VEST",
      "bulletproof_vest",
      (type, args) => new BulletproofVestModifier(type, (args[0] as Pokemon).id),
    ),

  // Local fork (2026-11-09): MASTER-tier Choice items, Atk / Spd / SpAtk x1.5 and a move lock until the holder leaves
  // the field (custom-held-items.ts); Choice Band's icon is drawn by tools/port/install_choice_band_icon.py
  CHOICE_BAND: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.CHOICE_BAND",
      "choice_band",
      (type, args) => new ChoiceItemModifier(type, (args[0] as Pokemon).id, CHOICE_ITEM_STATS.CHOICE_BAND),
    ),

  CHOICE_SCARF: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.CHOICE_SCARF",
      "choice_scarf",
      (type, args) => new ChoiceItemModifier(type, (args[0] as Pokemon).id, CHOICE_ITEM_STATS.CHOICE_SCARF),
    ),

  CHOICE_SPECS: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.CHOICE_SPECS",
      "choice_specs",
      (type, args) => new ChoiceItemModifier(type, (args[0] as Pokemon).id, CHOICE_ITEM_STATS.CHOICE_SPECS),
    ),

  // Local fork (2026-11-09): MASTER-tier Choice Armor (구애갑옷), Def and SpDef x1.3 and the Choice move lock
  // (custom-held-items.ts); icon "choice_armor": the Malicious / Auspicious Armor (저주받은갑옷 / 축복받은갑옷) shape in white
  CHOICE_ARMOR: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.CHOICE_ARMOR",
      "choice_armor",
      (type, args) => new ChoiceArmorModifier(type, (args[0] as Pokemon).id),
    ),

  // Local fork (2026-11-05): ROGUE-tier Life Orb, up to 3 (custom-held-items.ts)
  LIFE_ORB: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.LIFE_ORB",
      "life_orb",
      (type, args) => new LifeOrbModifier(type, (args[0] as Pokemon).id),
    ),

  // Local fork (2026-11-05): MASTER-tier Prism. Local fork (2026-11-09): its own icon "prism", made from the user's
  // picture (tools/port/install_user_item_icons.py); it borrowed Prism Scale's before
  PRISM: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.PRISM",
      "prism",
      (type, args) => new PrismModifier(type, (args[0] as Pokemon).id),
    ),

  // Local fork (2026-11-09): ROGUE-tier Training Shackles (트레이닝족쇄), up to 2: Speed x1/2 and the other stats but HP
  // x1.1, or with two Speed x1/3 and x2.2 (custom-held-items.ts, SHACKLES_GENE_CAULDRON); icon "training_shackles"
  TRAINING_SHACKLES: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.TRAINING_SHACKLES",
      "training_shackles",
      (type, args) => new TrainingShacklesModifier(type, (args[0] as Pokemon).id),
    ),

  // Local fork (2026-11-09): MASTER-tier Ultimate Gene (궁극유전자), one per Pokémon: every stat but HP x1.2, x1.4 on
  // Mewtwo in any form (custom-held-items.ts); icon "ultimate_gene"
  ULTIMATE_GENE: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.ULTIMATE_GENE",
      "ultimate_gene",
      (type, args) => new UltimateGeneModifier(type, (args[0] as Pokemon).id),
    ),

  // Local fork (2026-11-09, reworked 2026-11-10): ROGUE-tier Flame Cauldron (화염가마솥), one per Pokémon, no effect of
  // its own: a Flame Orb on its holder turns it into a Flame Furnace (custom-held-items.ts); icon "flame_cauldron"
  FLAME_CAULDRON: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.FLAME_CAULDRON",
      "flame_cauldron",
      (type, args) => new FlameCauldronModifier(type, (args[0] as Pokemon).id),
    ),

  // Local fork (2026-11-10): Flame Furnace (불꽃화로), what a Flame Cauldron becomes: Atk and SpAtk x1.3; MASTER tier but
  // in no reward pool, so the tier is set here; icon "flame_cauldron_lit" (the flaming pot)
  FLAME_FURNACE: () => {
    const type = new PokemonHeldItemModifierType(
      "modifierType:ModifierType.FLAME_FURNACE",
      "flame_cauldron_lit",
      (type, args) => new FlameFurnaceModifier(type, (args[0] as Pokemon).id),
    );
    type.setTier(ModifierTier.MASTER);
    return type;
  },

  // Local fork (2026-11-10): ROGUE-tier Toxic Distiller (맹독증류기), the Flame Cauldron's twin for the Toxic Orb: one
  // per Pokémon, no effect of its own; a Toxic Orb on its holder turns it into a Toxic Distillate (custom-held-items.ts);
  // icon "toxic_distiller" (the empty flask)
  TOXIC_DISTILLER: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.TOXIC_DISTILLER",
      "toxic_distiller",
      (type, args) => new ToxicDistillerModifier(type, (args[0] as Pokemon).id),
    ),

  // Local fork (2026-11-10): Toxic Distillate (맹독증류액), what a Toxic Distiller becomes: Def and SpDef x1.3; MASTER
  // tier but in no reward pool, so the tier is set here, as for the Flame Furnace; icon "toxic_distillate" (the purple
  // flask)
  TOXIC_DISTILLATE: () => {
    const type = new PokemonHeldItemModifierType(
      "modifierType:ModifierType.TOXIC_DISTILLATE",
      "toxic_distillate",
      (type, args) => new ToxicDistillateModifier(type, (args[0] as Pokemon).id),
    );
    type.setTier(ModifierTier.MASTER);
    return type;
  },

  // Local fork (2026-11-10): ROGUE-tier Discharged Coil (방전코일), the cauldron's and distiller's twin for the Light Ball
  // (전기구슬): one per Pokémon, no effect of its own; a Light Ball on its holder turns it into a Superconducting Coil
  // (custom-held-items.ts); icon "discharged_coil" (the user's grey coil)
  DISCHARGED_COIL: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.DISCHARGED_COIL",
      "discharged_coil",
      (type, args) => new DischargedCoilModifier(type, (args[0] as Pokemon).id),
    ),

  // Local fork (2026-11-10): Superconducting Coil (초전도코일), what a Discharged Coil becomes: Speed x1.4, x1.8 for the
  // Pikachu line; MASTER tier but in no reward pool, so the tier is set here, as for the Flame Furnace; icon
  // "superconducting_coil" (the user's glowing gold coil)
  SUPERCONDUCTING_COIL: () => {
    const type = new PokemonHeldItemModifierType(
      "modifierType:ModifierType.SUPERCONDUCTING_COIL",
      "superconducting_coil",
      (type, args) => new SuperconductingCoilModifier(type, (args[0] as Pokemon).id),
    );
    type.setTier(ModifierTier.MASTER);
    return type;
  },

  // Local fork (2026-11-09): ROGUE-tier Radioactive Waste (방사성폐기물), one per Pokémon: at the end of each turn a
  // Poison-type holder heals 1/8 of its max HP and any other holder is poisoned (custom-held-items.ts); icon
  // "radioactive_waste"
  RADIOACTIVE_WASTE: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.RADIOACTIVE_WASTE",
      "radioactive_waste",
      (type, args) => new RadioactiveWasteModifier(type, (args[0] as Pokemon).id),
    ),

  // Local fork (2026-11-11): ULTRA-tier Punching Glove (펀치글러브), one per Pokémon: punching moves x1.1 and no contact
  // for the target's side (custom-held-items.ts, contact-gloves.ts); icon "punching_glove" (a plain boxing glove)
  PUNCHING_GLOVE: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.PUNCHING_GLOVE",
      "punching_glove",
      (type, args) => new PunchingGloveModifier(type, (args[0] as Pokemon).id),
    ),

  // Local fork (2026-11-11): MASTER-tier Master Punching Glove (마스터 펀치글러브), one per Pokémon: contact moves x1.2,
  // no contact for the target's side, and Unseen Fist (1/4 through protection, Pokémon Champions' rule); icon
  // "master_punching_glove" (the glove in black with the Rogue Ball's colours)
  MASTER_PUNCHING_GLOVE: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.MASTER_PUNCHING_GLOVE",
      "master_punching_glove",
      (type, args) => new MasterPunchingGloveModifier(type, (args[0] as Pokemon).id),
    ),

  // Local fork (2026-11-11): seven held items (the user: "로그 등급에 파워풀허브도 넣어두죠 … 『 정밀렌즈 』 넣어두죠"); their
  // rules and numbers are in battle-held-items.ts, their classes in custom-held-items.ts
  // ROGUE-tier Power Herb (파워풀허브), up to 2, not used up: skips a charging turn once per herb per battle; the upstream
  // icon "power_herb"
  POWER_HERB: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.POWER_HERB",
      "power_herb",
      (type, args) => new PowerHerbModifier(type, (args[0] as Pokemon).id),
    ),

  // ULTRA-tier Metronome (메트로놈), up to 3: +10/15/20% power per consecutive use, at most 5 steps; icon "metronome"
  METRONOME: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.METRONOME",
      "metronome",
      (type, args) => new MetronomeModifier(type, (args[0] as Pokemon).id),
    ),

  // ROGUE-tier Loaded Dice (속임수주사위), one per Pokémon, the main-series item; icon "loaded_dice"
  LOADED_DICE: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.LOADED_DICE",
      "loaded_dice",
      (type, args) => new LoadedDiceModifier(type, (args[0] as Pokemon).id),
    ),

  // ROGUE-tier Seed Pouch (씨앗주머니), one per Pokémon: a Grass-type holder seeds the opposing field; icon "seed_pouch"
  // (the Berry Pouch recoloured green and seed brown, tools/port_new_items_1111b/make_icons.py)
  SEED_POUCH: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.SEED_POUCH",
      "seed_pouch",
      (type, args) => new SeedPouchModifier(type, (args[0] as Pokemon).id),
    ),

  // ULTRA-tier Fuel (연료), up to 3: a Fire-type holder's Atk and SpAtk x1.1/1.2/1.3; icon "fuel" (a red oil drum with
  // oil, drawn as a simple prop on the Radioactive Waste drum's shape)
  FUEL: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.FUEL",
      "fuel",
      (type, args) => new FuelModifier(type, (args[0] as Pokemon).id),
    ),

  // ROGUE-tier Expert Belt (달인의띠), one per Pokémon: super-effective hits x1.2; the upstream icon "expert_belt"
  EXPERT_BELT: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.EXPERT_BELT",
      "expert_belt",
      (type, args) => new ExpertBeltModifier(type, (args[0] as Pokemon).id),
    ),

  // ROGUE-tier Precision Lens (정밀렌즈), up to 2: critical hits x1.7/x1.8 instead of x1.5; icon "precision_lens" (the
  // Scope Lens recoloured)
  PRECISION_LENS: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.PRECISION_LENS",
      "precision_lens",
      (type, args) => new PrecisionLensModifier(type, (args[0] as Pokemon).id),
    ),

  // Local fork (2026-11-11): the third batch (the user: "클리어참 / 부스트에너지 추가해두죠 … 목스프레이(…)도 넣어둡시다 …
  // 힘의머리띠 / 박식안경도 하이퍼 등급으로 넣어두죠"), one per Pokémon each; rules in battle-held-items.ts
  // ROGUE-tier Clear Amulet (클리어참): other Pokémon cannot lower the holder's stats; icon "clear_amulet" (Cobblemon's
  // texture scaled 2x, tools/port_new_items_1111c/make_icons.py)
  CLEAR_AMULET: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.CLEAR_AMULET",
      "clear_amulet",
      (type, args) => new ClearAmuletModifier(type, (args[0] as Pokemon).id),
    ),

  // ROGUE-tier Booster Energy (부스트에너지), not used up: the highest stat x1.2, x1.5 for a Paradox Pokémon; the upstream
  // icon "booster_energy"
  BOOSTER_ENERGY: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.BOOSTER_ENERGY",
      "booster_energy",
      (type, args) => new BoosterEnergyModifier(type, (args[0] as Pokemon).id),
    ),

  // ULTRA-tier Throat Spray (목스프레이), not used up: once per battle, Sp. Atk +1 after a sound move; icon "throat_spray"
  // (Cobblemon's texture scaled 2x)
  THROAT_SPRAY: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.THROAT_SPRAY",
      "throat_spray",
      (type, args) => new ThroatSprayModifier(type, (args[0] as Pokemon).id),
    ),

  // ULTRA-tier Muscle Band (힘의머리띠): physical moves x1.1; the upstream icon "muscle_band"
  MUSCLE_BAND: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.MUSCLE_BAND",
      "muscle_band",
      (type, args) => new MuscleBandModifier(type, (args[0] as Pokemon).id),
    ),

  // ULTRA-tier Wise Glasses (박식안경): special moves x1.1; the upstream icon "wise_glasses"
  WISE_GLASSES: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.WISE_GLASSES",
      "wise_glasses",
      (type, args) => new WiseGlassesModifier(type, (args[0] as Pokemon).id),
    ),

  // Local fork (2026-11-12): the user, from the bulk-item shortlist: "파워웨이트만 넣죠, 하이퍼(10%), 마스터(45%) 하나씩,
  // 하이퍼는 최대 3개로. 이미지는 제가 만들어올게요", then "여기 파워웨이트랑 챔피언벨트 이미지입니다" and, since 파워웨이트
  // is the mainline HP EV item, "헬스벨트", then "이름 중량벤드로 바꿔두죠, hp 아이템 이름을" (written 중량밴드, the usual spelling of 밴드) for the hyper one. Numbers in HP_BELTS (custom-held-items.ts); never moved or
  // stolen. ULTRA-tier Weight Band (중량밴드), up to 3: max HP +10% per piece; icon "weight_band", the user's own
  // 32x32 art (tools/port_new_items_1112/user_weight_band.png)
  WEIGHT_BAND: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.WEIGHT_BAND",
      "weight_band",
      (type, args) => new WeightBandModifier(type, (args[0] as Pokemon).id),
    ),

  // MASTER-tier Champion Belt (챔피언벨트), one per Pokémon: max HP +45%, added to the Weight Bands'; icon
  // "champion_belt", the user's own art (sent as an exact 8x upscale, brought back to its 32x32 pixel grid:
  // tools/port_new_items_1112/user_champion_belt.png)
  CHAMPION_BELT: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.CHAMPION_BELT",
      "champion_belt",
      (type, args) => new ChampionBeltModifier(type, (args[0] as Pokemon).id),
    ),

  // Local fork (2026-11-12): the six EV items (the user: "노력치 아이템도 추가해보죠 / 종류별로 전부 로그등급으로 …
  // 해당 노력치 +1, 최대 노력치는 252"), ROGUE, one per Pokémon and one per party (EV_RULES, ev-items.ts): a participant
  // holder gets +1 EV in the item's stat per defeated enemy (gainEvsFromItems). Main-series names, no Speed halving;
  // icons are Cobblemon 1.7.3's textures of the same names, scaled 2x (tools/port_new_items_1112/make_ev_item_icons.py)
  POWER_WEIGHT: () => evItemType("POWER_WEIGHT"),
  POWER_BRACER: () => evItemType("POWER_BRACER"),
  POWER_BELT: () => evItemType("POWER_BELT"),
  POWER_LENS: () => evItemType("POWER_LENS"),
  POWER_BAND: () => evItemType("POWER_BAND"),
  POWER_ANKLET: () => evItemType("POWER_ANKLET"),

  // Local fork (2026-11-08): Forged Steel from Tinkaton's Forge (HP/Def/SpDef base stats +10% per piece, up to 5 since
  // 2026-11-12, up to 10 since the 09 patch); in no reward pool
  FORGED_STEEL: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.FORGED_STEEL",
      "forged_steel",
      (type, args) => new ForgedSteelModifier(type, (args[0] as Pokemon).id),
    ),

  SOUL_DEW: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.SOUL_DEW",
      "soul_dew",
      (type, args) => new PokemonNatureWeightModifier(type, (args[0] as Pokemon).id),
    ),

  NUGGET: () =>
    new MoneyRewardModifierType(
      "modifierType:ModifierType.NUGGET",
      "nugget",
      1,
      "modifierType:ModifierType.MoneyRewardModifierType.extra.small",
    ),
  BIG_NUGGET: () =>
    new MoneyRewardModifierType(
      "modifierType:ModifierType.BIG_NUGGET",
      "big_nugget",
      2.5,
      "modifierType:ModifierType.MoneyRewardModifierType.extra.moderate",
    ),
  RELIC_GOLD: () =>
    new MoneyRewardModifierType(
      "modifierType:ModifierType.RELIC_GOLD",
      "relic_gold",
      10,
      "modifierType:ModifierType.MoneyRewardModifierType.extra.large",
    ),

  AMULET_COIN: () =>
    new ModifierType(
      "modifierType:ModifierType.AMULET_COIN",
      "amulet_coin",
      (type, _args) => new MoneyMultiplierModifier(type),
    ),
  GOLDEN_PUNCH: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.GOLDEN_PUNCH",
      "golden_punch",
      (type, args) => new DamageMoneyRewardModifier(type, (args[0] as Pokemon).id),
    ),
  COIN_CASE: () =>
    new ModifierType(
      "modifierType:ModifierType.COIN_CASE",
      "coin_case",
      (type, _args) => new MoneyInterestModifier(type),
    ),

  LOCK_CAPSULE: () =>
    new ModifierType(
      "modifierType:ModifierType.LOCK_CAPSULE",
      "lock_capsule",
      (type, _args) => new LockModifierTiersModifier(type),
    ),

  GRIP_CLAW: () =>
    new ContactHeldItemTransferChanceModifierType("modifierType:ModifierType.GRIP_CLAW", "grip_claw", 10),
  WIDE_LENS: () => new PokemonMoveAccuracyBoosterModifierType("modifierType:ModifierType.WIDE_LENS", "wide_lens", 5),

  MULTI_LENS: () => new PokemonMultiHitModifierType("modifierType:ModifierType.MULTI_LENS", "zoom_lens"),

  HEALING_CHARM: () =>
    new ModifierType(
      "modifierType:ModifierType.HEALING_CHARM",
      "healing_charm",
      (type, _args) => new HealingBoosterModifier(type, 1.1),
    ),
  CANDY_JAR: () =>
    new ModifierType(
      "modifierType:ModifierType.CANDY_JAR",
      "candy_jar",
      (type, _args) => new LevelIncrementBoosterModifier(type),
    ),

  BERRY_POUCH: () =>
    new ModifierType(
      "modifierType:ModifierType.BERRY_POUCH",
      "berry_pouch",
      (type, _args) => new PreserveBerryModifier(type),
    ),

  FOCUS_BAND: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.FOCUS_BAND",
      "focus_band",
      (type, args) => new SurviveDamageModifier(type, (args[0] as Pokemon).id),
    ),

  QUICK_CLAW: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.QUICK_CLAW",
      "quick_claw",
      (type, args) => new BypassSpeedChanceModifier(type, (args[0] as Pokemon).id),
    ),

  KINGS_ROCK: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.KINGS_ROCK",
      "kings_rock",
      (type, args) => new FlinchChanceModifier(type, (args[0] as Pokemon).id),
    ),

  LEFTOVERS: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.LEFTOVERS",
      "leftovers",
      (type, args) => new TurnHealModifier(type, (args[0] as Pokemon).id),
    ),
  SHELL_BELL: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.SHELL_BELL",
      "shell_bell",
      (type, args) => new HitHealModifier(type, (args[0] as Pokemon).id),
    ),

  TOXIC_ORB: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.TOXIC_ORB",
      "toxic_orb",
      (type, args) => new TurnStatusEffectModifier(type, (args[0] as Pokemon).id),
    ),
  FLAME_ORB: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.FLAME_ORB",
      "flame_orb",
      (type, args) => new TurnStatusEffectModifier(type, (args[0] as Pokemon).id),
    ),

  BATON: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.BATON",
      "baton",
      (type, args) => new SwitchEffectTransferModifier(type, (args[0] as Pokemon).id),
    ),

  SHINY_CHARM: () =>
    new ModifierType(
      "modifierType:ModifierType.SHINY_CHARM",
      "shiny_charm",
      (type, _args) => new ShinyRateBoosterModifier(type),
    ),
  ABILITY_CHARM: () =>
    new ModifierType(
      "modifierType:ModifierType.ABILITY_CHARM",
      "ability_charm",
      (type, _args) => new HiddenAbilityRateBoosterModifier(type),
    ),
  CATCHING_CHARM: () =>
    new ModifierType(
      "modifierType:ModifierType.CATCHING_CHARM",
      "catching_charm",
      (type, _args) => new CriticalCatchChanceBoosterModifier(type),
    ),

  IV_SCANNER: () =>
    new ModifierType("modifierType:ModifierType.IV_SCANNER", "scanner", (type, _args) => new IvScannerModifier(type)),

  DNA_SPLICERS: () => new FusePokemonModifierType("modifierType:ModifierType.DNA_SPLICERS", "dna_splicers"),

  MINI_BLACK_HOLE: () =>
    new TurnHeldItemTransferModifierType("modifierType:ModifierType.MINI_BLACK_HOLE", "mini_black_hole"),

  VOUCHER: () => new AddVoucherModifierType(VoucherType.REGULAR, 1),
  VOUCHER_PLUS: () => new AddVoucherModifierType(VoucherType.PLUS, 1),
  VOUCHER_PREMIUM: () => new AddVoucherModifierType(VoucherType.PREMIUM, 1),

  // Local fork (2026-11-11): the luck clovers, party items like the Golden Poké Ball (custom-held-items.ts): 네잎클로버 잎
  // (GREAT, up to 4, luck +1 with all 4), 네잎클로버 (ULTRA, up to 3, +1 each), 황금 네잎클로버 (ROGUE, up to 2, +3 each)
  FOUR_LEAF_CLOVER_LEAF: () =>
    new ModifierType(
      "modifierType:ModifierType.FOUR_LEAF_CLOVER_LEAF",
      "four_leaf_clover_leaf",
      (type, _args) => new FourLeafCloverLeafModifier(type),
    ),
  FOUR_LEAF_CLOVER: () =>
    new ModifierType(
      "modifierType:ModifierType.FOUR_LEAF_CLOVER",
      "four_leaf_clover",
      (type, _args) => new FourLeafCloverModifier(type),
    ),
  GOLDEN_FOUR_LEAF_CLOVER: () =>
    new ModifierType(
      "modifierType:ModifierType.GOLDEN_FOUR_LEAF_CLOVER",
      "golden_four_leaf_clover",
      (type, _args) => new GoldenFourLeafCloverModifier(type),
    ),
  // Local fork (2026-11-12): 관통 토큰 (Piercing Token), a party item (ROGUE, up to 10) against the enemy's 보호 토큰
  // (enemy-damage-tokens.ts). The user: "곱연산으로 계산된 수치에 합연산으로 빼는(… 이 아이템이 3개 있어서 3%데미지는
  // 보장된다던가) 파티 아이템"
  PIERCING_TOKEN: () =>
    new ModifierType(
      "modifierType:ModifierType.PIERCING_TOKEN",
      "piercing_token",
      (type, _args) => new PiercingTokenModifier(type),
    ),
  // Local fork (2026-11-13): 방호 토큰 (Guard Token), a party item (GREAT, up to 65) against the enemy's 대미지 토큰
  // (enemy-damage-tokens.ts). 09 명세 4번: "1개당 아군이 받는 피해 0.5%씩 곱연산 감소 (× 0.995^n)"
  GUARD_TOKEN: () =>
    new ModifierType(
      "modifierType:ModifierType.GUARD_TOKEN",
      "guard_token",
      (type, _args) => new GuardTokenModifier(type),
    ),

  GOLDEN_POKEBALL: () =>
    new ModifierType(
      "modifierType:ModifierType.GOLDEN_POKEBALL",
      "pb_gold",
      (type, _args) => new ExtraModifierModifier(type),
      undefined,
      "se/pb_bounce_1",
    ),
  SILVER_POKEBALL: () =>
    new ModifierType(
      "modifierType:ModifierType.SILVER_POKEBALL",
      "pb_silver",
      (type, _args) => new TempExtraModifierModifier(type, 100),
      undefined,
      "se/pb_bounce_1",
    ),

  ENEMY_DAMAGE_BOOSTER: () =>
    new ModifierType(
      "modifierType:ModifierType.ENEMY_DAMAGE_BOOSTER",
      "wl_item_drop",
      (type, _args) => new EnemyDamageBoosterModifier(type, 5),
    ),
  ENEMY_DAMAGE_REDUCTION: () =>
    new ModifierType(
      "modifierType:ModifierType.ENEMY_DAMAGE_REDUCTION",
      "wl_guard_spec",
      (type, _args) => new EnemyDamageReducerModifier(type, 2.5),
    ),
  //ENEMY_SUPER_EFFECT_BOOSTER: () => new ModifierType('Type Advantage Token', 'Increases damage of super effective attacks by 30%', (type, _args) => new EnemySuperEffectiveDamageBoosterModifier(type, 30), 'wl_custom_super_effective'),
  ENEMY_HEAL: () =>
    new ModifierType(
      "modifierType:ModifierType.ENEMY_HEAL",
      "wl_potion",
      (type, _args) => new EnemyTurnHealModifier(type, 2, 10),
    ),
  ENEMY_ATTACK_POISON_CHANCE: () =>
    new EnemyAttackStatusEffectChanceModifierType(
      "modifierType:ModifierType.ENEMY_ATTACK_POISON_CHANCE",
      "wl_antidote",
      5,
      StatusEffect.POISON,
      10,
    ),
  ENEMY_ATTACK_PARALYZE_CHANCE: () =>
    new EnemyAttackStatusEffectChanceModifierType(
      "modifierType:ModifierType.ENEMY_ATTACK_PARALYZE_CHANCE",
      "wl_paralyze_heal",
      2.5,
      StatusEffect.PARALYSIS,
      10,
    ),
  ENEMY_ATTACK_BURN_CHANCE: () =>
    new EnemyAttackStatusEffectChanceModifierType(
      "modifierType:ModifierType.ENEMY_ATTACK_BURN_CHANCE",
      "wl_burn_heal",
      5,
      StatusEffect.BURN,
      10,
    ),
  ENEMY_STATUS_EFFECT_HEAL_CHANCE: () =>
    new ModifierType(
      "modifierType:ModifierType.ENEMY_STATUS_EFFECT_HEAL_CHANCE",
      "wl_full_heal",
      (type, _args) => new EnemyStatusEffectHealChanceModifier(type, 2.5, 10),
    ),
  ENEMY_ENDURE_CHANCE: () =>
    new EnemyEndureChanceModifierType("modifierType:ModifierType.ENEMY_ENDURE_CHANCE", "wl_reset_urge", 2),
  ENEMY_FUSED_CHANCE: () =>
    new ModifierType(
      "modifierType:ModifierType.ENEMY_FUSED_CHANCE",
      "wl_custom_spliced",
      (type, _args) => new EnemyFusionChanceModifier(type, 1),
    ),

  MYSTERY_ENCOUNTER_SHUCKLE_JUICE: () =>
    new ModifierTypeGenerator((_party: readonly Pokemon[], pregenArgs?: any[]) => {
      if (pregenArgs) {
        // Local fork (2026-11-08): any value (10 sweet, -15 bitter, 30 Pitch-Black)
        return new PokemonBaseStatTotalModifierType(pregenArgs[0] as number);
      }
      return new PokemonBaseStatTotalModifierType(10);
    }),
  MYSTERY_ENCOUNTER_OLD_GATEAU: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.MYSTERY_ENCOUNTER_OLD_GATEAU",
      "old_gateau",
      (type, args) => new PokemonBaseStatFlatModifier(type, (args[0] as Pokemon).id),
    ),
  MYSTERY_ENCOUNTER_BLACK_SLUDGE: () =>
    new ModifierTypeGenerator((_party: readonly Pokemon[], pregenArgs?: any[]) => {
      if (pregenArgs) {
        return new ModifierType(
          "modifierType:ModifierType.MYSTERY_ENCOUNTER_BLACK_SLUDGE",
          "black_sludge",
          (type, _args) => new HealShopCostModifier(type, pregenArgs[0] as number),
        );
      }
      return new ModifierType(
        "modifierType:ModifierType.MYSTERY_ENCOUNTER_BLACK_SLUDGE",
        "black_sludge",
        (type, _args) => new HealShopCostModifier(type, 2.5),
      );
    }),
  MYSTERY_ENCOUNTER_MACHO_BRACE: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.MYSTERY_ENCOUNTER_MACHO_BRACE",
      "macho_brace",
      (type, args) => new PokemonIncrementingStatModifier(type, (args[0] as Pokemon).id),
    ),
  MYSTERY_ENCOUNTER_GOLDEN_BUG_NET: () =>
    new ModifierType(
      "modifierType:ModifierType.MYSTERY_ENCOUNTER_GOLDEN_BUG_NET",
      "golden_net",
      (type, _args) => new BoostBugSpawnModifier(type),
    ),
});

/**
 * The initial set of modifier types, used to generate the modifier pool.
 */
export type ModifierTypes = typeof modifierTypeInitObj;

export interface ModifierPool {
  [tier: string]: WeightedModifierType[];
}

let modifierPoolThresholds = {};
let ignoredPoolIndexes = {};

let dailyStarterModifierPoolThresholds = {};
// biome-ignore lint/correctness/noUnusedVariables: TODO explain why this is marked as OK
let ignoredDailyStarterPoolIndexes = {};

let enemyModifierPoolThresholds = {};
// biome-ignore lint/correctness/noUnusedVariables: TODO explain why this is marked as OK
let enemyIgnoredPoolIndexes = {};

let enemyBuffModifierPoolThresholds = {};
// biome-ignore lint/correctness/noUnusedVariables: TODO explain why this is marked as OK
let enemyBuffIgnoredPoolIndexes = {};

/**
 * Tier odds for the debug table; in Endless the player's pool uses the wave curve (local fork). Local fork
 * (2026-11-12), review fix: the TRAINER pool shows its own table (enemy-trainer-buffs.ts), as its roll uses
 */
function getTierWeights(poolType: ModifierPoolType): number[] {
  let counts: readonly number[] = BASE_TIER_COUNTS;
  if (poolType === ModifierPoolType.PLAYER && usesEndlessTierBands()) {
    counts = getEndlessTierCounts(currentWave());
  } else if (poolType === ModifierPoolType.TRAINER) {
    counts = getEnemyTrainerTierCounts(currentWave(), !!globalScene?.gameMode?.isEndless);
  }
  return counts.map(c => c / 1024);
}

/** Whether the rolled thresholds of `tier` contain an egg voucher with a non-zero weight (local fork) */
function tierHasVoucher(thresholds: object, pool: object, tier: ModifierTier): boolean {
  const indexes = Object.values(thresholds[tier] ?? {}) as number[];
  return indexes.some(i => pool[tier]?.[i]?.modifierType instanceof AddVoucherModifierType);
}
/**
 * Allows a unit test to check if an item exists in the Modifier Pool. \
 * Checks the pool directly, rather than attempting to reroll for the item.
 */
export const itemPoolChecks: Map<ModifierTypeKeys, boolean | undefined> = new Map();

/**
 * Local fork (2026-11-07): the player reward tiers that have at least one item with weight for `party` right now
 * (the thresholds are regenerated first, as a reward screen does). A tier missing here would fall back to the tier
 * below in {@linkcode getNewModifierTypeOption}; the Super GTS uses this to offer only trades it can pay.
 */
export function getAvailablePlayerRewardTiers(party: readonly Pokemon[]): Set<ModifierTier> {
  regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0);
  const available = new Set<ModifierTier>();
  for (const [tier, tierThresholds] of Object.entries(modifierPoolThresholds as Record<string, object | undefined>)) {
    if (Object.keys(tierThresholds ?? {}).length > 0) {
      available.add(Number(tier) as ModifierTier);
    }
  }
  return available;
}

export function regenerateModifierPoolThresholds(
  party: readonly Pokemon[],
  poolType: ModifierPoolType,
  rerollCount = 0,
) {
  const pool = getModifierPoolForType(poolType);
  itemPoolChecks.forEach((_v, k) => {
    itemPoolChecks.set(k, false);
  });

  // this is bad but the file is being removed anyways in modifier rework
  const ignoredIndexes: any = {};
  const modifierTableData: any = {};
  // Local fork (2026-11-12): before the first Classic clear the fork items get no weight (fork-unlock.ts; the user:
  // "저희 대부분의 커스텀 아이템과 커스텀 패시브는 클래식 클리어 후 해금으로 하죠")
  const forkLocked = !isForkContentUnlocked();
  const thresholds = Object.fromEntries(
    new Map(
      Object.keys(pool).map(tStr => {
        const t = Number.parseInt(tStr) as ModifierTier;
        ignoredIndexes[t] = [];
        const thresholds = new Map();
        const tierModifierIds: string[] = [];
        let tierMaxWeight = 0;
        let i = 0;
        pool[t].reduce((total: number, modifierType: WeightedModifierType) => {
          const weightedModifierType = modifierType as WeightedModifierType;
          const existingModifiers = globalScene.findModifiers(
            m => m.type.id === weightedModifierType.modifierType.id,
            poolType === ModifierPoolType.PLAYER,
          );
          // Local fork (2026-11-12): a locked fork item weighs 0, without running its generator or weight function
          const lockedForkItem = forkLocked && FORK_UNLOCK.gatedItems.has(weightedModifierType.modifierType.id);
          const itemModifierType = lockedForkItem
            ? null
            : weightedModifierType.modifierType instanceof ModifierTypeGenerator
              ? weightedModifierType.modifierType.generateType(party)
              : weightedModifierType.modifierType;
          const weight = lockedForkItem
            ? 0
            : existingModifiers.length === 0
                || itemModifierType instanceof PokemonHeldItemModifierType
                || itemModifierType instanceof FormChangeItemModifierType
                || existingModifiers.find(m => m.stackCount < m.getMaxStackCount(true))
              ? weightedModifierType.weight instanceof Function
                ? // biome-ignore lint/complexity/noBannedTypes: TODO: refactor to not use Function type
                  (weightedModifierType.weight as Function)(party, rerollCount)
                : (weightedModifierType.weight as number)
              : 0;
          if (weightedModifierType.maxWeight) {
            const modifierId = weightedModifierType.modifierType.id;
            tierModifierIds.push(modifierId);
            const outputWeight = useMaxWeightForOutput ? weightedModifierType.maxWeight : weight;
            modifierTableData[modifierId] = {
              weight: outputWeight,
              tier: t,
              tierPercent: 0,
              totalPercent: 0,
            };
            tierMaxWeight += outputWeight;
          }
          if (weight) {
            total += weight;
          } else {
            ignoredIndexes[t].push(i++);
            return total;
          }
          if (itemPoolChecks.has(modifierType.modifierType.id as ModifierTypeKeys)) {
            itemPoolChecks.set(modifierType.modifierType.id as ModifierTypeKeys, true);
          }
          thresholds.set(total, i++);
          return total;
        }, 0);
        for (const id of tierModifierIds) {
          modifierTableData[id].tierPercent = Math.floor((modifierTableData[id].weight / tierMaxWeight) * 10000) / 100;
        }
        return [t, Object.fromEntries(thresholds)];
      }),
    ),
  );
  const tierWeights = getTierWeights(poolType);
  for (const id of Object.keys(modifierTableData)) {
    modifierTableData[id].totalPercent =
      Math.floor(modifierTableData[id].tierPercent * tierWeights[modifierTableData[id].tier] * 100) / 100;
    modifierTableData[id].tier = ModifierTier[modifierTableData[id].tier];
  }
  if (outputModifierData) {
    console.table(modifierTableData);
  }
  switch (poolType) {
    case ModifierPoolType.PLAYER:
      modifierPoolThresholds = thresholds;
      ignoredPoolIndexes = ignoredIndexes;
      break;
    case ModifierPoolType.WILD:
    case ModifierPoolType.TRAINER:
      enemyModifierPoolThresholds = thresholds;
      enemyIgnoredPoolIndexes = ignoredIndexes;
      break;
    case ModifierPoolType.ENEMY_BUFF:
      enemyBuffModifierPoolThresholds = thresholds;
      enemyBuffIgnoredPoolIndexes = ignoredIndexes;
      break;
    case ModifierPoolType.DAILY_STARTER:
      dailyStarterModifierPoolThresholds = thresholds;
      ignoredDailyStarterPoolIndexes = ignoredIndexes;
      break;
  }
}

export interface CustomModifierSettings {
  /** If specified, will override the next X items to be the specified tier. These can upgrade with luck. */
  guaranteedModifierTiers?: ModifierTier[];
  /** If specified, will override the first X items to be specific modifier options (these should be pre-genned). */
  guaranteedModifierTypeOptions?: ModifierTypeOption[];
  /** If specified, will override the next X items to be auto-generated from specific modifier functions (these don't have to be pre-genned). */
  guaranteedModifierTypeFuncs?: ModifierTypeFunc[];
  /**
   * If set to `true`, will fill the remainder of shop items that were not overridden by the 3 options above, up to the `count` param value.
   * @example
   * ```ts
   * count = 4;
   * customModifierSettings = { guaranteedModifierTiers: [ModifierTier.GREAT], fillRemaining: true };
   * ```
   * The first item in the shop will be `GREAT` tier, and the remaining `3` items will be generated normally.
   *
   * If `fillRemaining: false` in the same scenario, only 1 `GREAT` tier item will appear in the shop (regardless of the value of `count`).
   * @defaultValue `false`
   */
  fillRemaining?: boolean;
  /** If specified, can adjust the amount of money required for a shop reroll. If set to a negative value, the shop will not allow rerolls at all. */
  rerollMultiplier?: number | undefined;
  /**
   * If `false`, will prevent set item tiers from upgrading via luck.
   * @defaultValue `true`
   */
  allowLuckUpgrades?: boolean;
}

export function getModifierTypeFuncById(id: string): ModifierTypeFunc {
  return modifierTypeInitObj[id];
}

/**
 * Generates modifier options for a {@linkcode SelectModifierPhase}
 * @param count - Determines the number of items to generate
 * @param party - Party is required for generating proper modifier pools
 * @param modifierTiers - (Optional) If specified, rolls items in the specified tiers. Commonly used for tier-locking with Lock Capsule.
 * @param customModifierSettings - See {@linkcode CustomModifierSettings}
 */
export function getPlayerModifierTypeOptions(
  count: number,
  party: PlayerPokemon[],
  modifierTiers?: ModifierTier[],
  customModifierSettings?: CustomModifierSettings,
): ModifierTypeOption[] {
  const options: ModifierTypeOption[] = [];
  const retryCount = Math.min(count * 5, 50);
  if (customModifierSettings) {
    // Guaranteed mod options first
    if (
      customModifierSettings?.guaranteedModifierTypeOptions
      && customModifierSettings.guaranteedModifierTypeOptions.length > 0
    ) {
      options.push(...customModifierSettings.guaranteedModifierTypeOptions!);
    }

    // Guaranteed mod functions second
    if (
      customModifierSettings.guaranteedModifierTypeFuncs
      && customModifierSettings.guaranteedModifierTypeFuncs.length > 0
    ) {
      customModifierSettings.guaranteedModifierTypeFuncs!.forEach((mod, _i) => {
        const modifierId = Object.keys(modifierTypeInitObj).find(k => modifierTypeInitObj[k] === mod) as string;
        let guaranteedMod: ModifierType = modifierTypeInitObj[modifierId]?.();

        // Populates item id and tier
        guaranteedMod = guaranteedMod
          .withIdFromFunc(modifierTypeInitObj[modifierId])
          .withTierFromPool(ModifierPoolType.PLAYER, party);

        const modType =
          guaranteedMod instanceof ModifierTypeGenerator ? guaranteedMod.generateType(party) : guaranteedMod;
        if (modType) {
          const option = new ModifierTypeOption(modType, 0);
          options.push(option);
          // Local fork: the next mint of the same list (Weird Dream gives four) must pick another nature
          recordOfferedMint(option);
        }
      });
    }

    // Guaranteed tiers third
    if (customModifierSettings.guaranteedModifierTiers && customModifierSettings.guaranteedModifierTiers.length > 0) {
      const allowLuckUpgrades = customModifierSettings.allowLuckUpgrades ?? true;
      for (const tier of customModifierSettings.guaranteedModifierTiers) {
        options.push(getModifierTypeOptionWithRetry(options, retryCount, party, tier, allowLuckUpgrades));
      }
    }

    // Fill remaining
    if (options.length < count && customModifierSettings.fillRemaining) {
      while (options.length < count) {
        options.push(getModifierTypeOptionWithRetry(options, retryCount, party, undefined));
      }
    }
  } else {
    for (let i = 0; i < count; i++) {
      const tier = modifierTiers && modifierTiers.length > i ? modifierTiers[i] : undefined;
      options.push(getModifierTypeOptionWithRetry(options, retryCount, party, tier));
    }
  }

  overridePlayerModifierTypeOptions(options, party);

  // Local fork (2026-11-06): a mint shown once (reward screen, reroll, an encounter's item) is not offered again
  for (const option of options) {
    recordOfferedMint(option);
  }

  return options;
}

/** Local fork (2026-11-06): adds the nature of a mint option to `BattleScene.forkOfferedMintNatures` */
function recordOfferedMint(option: ModifierTypeOption | null | undefined): void {
  if (option?.type instanceof PokemonNatureChangeModifierType) {
    globalScene.forkOfferedMintNatures.add(option.type.getNature());
  }
}

/**
 * Local fork (2026-11-13): whether two reward types share a group for a reward screen's duplicate check (08 명세 3번:
 * "group이 비어 있지 않을 때만 group 중복 검사 수행"). Only a non-empty group counts. Almost every growth item (held items,
 * vitamins, IV candies, type boosters, charms, the fork items) has no group, and `undefined === undefined` used to make
 * them one group, so a screen showed at most one of them and re-rolled its other slots into balls, nuggets, TMs and the
 * like (07_5850_에이스_실험.md 2-2절). Grouped items (balls, potions, berries, TMs, PP items, ...) work as before.
 */
export function isSameRewardGroup(a: ModifierType | null | undefined, b: ModifierType | null | undefined): boolean {
  return !!a?.group && !!b?.group && a.group === b.group;
}

/**
 * Will generate a {@linkcode ModifierType} from the {@linkcode ModifierPoolType.PLAYER} pool, attempting to retry duplicated items up to retryCount
 * @param existingOptions Currently generated options
 * @param retryCount How many times to retry before allowing a dupe item
 * @param party Current player party, used to calculate items in the pool
 * @param tier If specified will generate item of tier
 * @param allowLuckUpgrades `true` to allow items to upgrade tiers (the little animation that plays and is affected by luck)
 */
function getModifierTypeOptionWithRetry(
  existingOptions: ModifierTypeOption[],
  retryCount: number,
  party: PlayerPokemon[],
  tier?: ModifierTier,
  allowLuckUpgrades?: boolean,
): ModifierTypeOption {
  allowLuckUpgrades = allowLuckUpgrades ?? true;
  let candidate = getNewModifierTypeOption(party, ModifierPoolType.PLAYER, tier, undefined, 0, allowLuckUpgrades);
  const candidateValidity = new BooleanHolder(true);
  applyChallenges(ChallengeType.WAVE_REWARD, candidate, candidateValidity);
  let r = 0;
  while (
    (existingOptions.length > 0
      && ++r < retryCount
      // Local fork (2026-11-13): a duplicate is the same item (same name, as before) or the same NON-EMPTY group
      // (isSameRewardGroup, 08 명세 3번); a missing candidate is still re-rolled (it used to match every group-less option)
      && (!candidate
        || existingOptions.some(
          o => o.type.name === candidate?.type.name || isSameRewardGroup(o.type, candidate?.type),
        )))
    || !candidateValidity.value
  ) {
    candidate = getNewModifierTypeOption(
      party,
      ModifierPoolType.PLAYER,
      candidate?.type.tier ?? tier,
      candidate?.upgradeCount,
      0,
      allowLuckUpgrades,
      candidate?.vouchersSettled ?? false,
    );
    applyChallenges(ChallengeType.WAVE_REWARD, candidate, candidateValidity);
  }
  // Local fork: a later slot of the same screen must not show this mint's nature again
  recordOfferedMint(candidate);
  return candidate!;
}

/**
 * Replaces the {@linkcode ModifierType} of the entries within {@linkcode options} with any
 * {@linkcode ModifierOverride} entries listed in {@linkcode activeOverrides.ITEM_REWARD_OVERRIDE}
 * up to the smallest amount of entries between {@linkcode options} and the override array.
 * @param options Array of naturally rolled {@linkcode ModifierTypeOption}s
 * @param party Array of the player's current party
 */
export function overridePlayerModifierTypeOptions(options: ModifierTypeOption[], party: PlayerPokemon[]) {
  const minLength = Math.min(options.length, activeOverrides.ITEM_REWARD_OVERRIDE.length);
  for (let i = 0; i < minLength; i++) {
    const override: ModifierOverride = activeOverrides.ITEM_REWARD_OVERRIDE[i];
    const modifierFunc = modifierTypeInitObj[override.name];
    let modifierType: ModifierType | null = modifierFunc();

    if (modifierType instanceof ModifierTypeGenerator) {
      const pregenArgs = "type" in override && override.type !== null ? [override.type] : undefined;
      modifierType = modifierType.generateType(party, pregenArgs);
    }

    if (modifierType) {
      options[i].type = modifierType.withIdFromFunc(modifierFunc).withTierFromPool(ModifierPoolType.PLAYER, party);
    }
  }
}

export function getPlayerShopModifierTypeOptionsForWave(waveIndex: number, baseCost: number): ModifierTypeOption[] {
  if (!(waveIndex % 10)) {
    return [];
  }

  const options = [
    [
      new ModifierTypeOption(modifierTypeInitObj.POTION(), 0, baseCost * 0.2),
      new ModifierTypeOption(modifierTypeInitObj.ETHER(), 0, baseCost * 0.4),
      new ModifierTypeOption(modifierTypeInitObj.REVIVE(), 0, baseCost * 2),
    ],
    [
      new ModifierTypeOption(modifierTypeInitObj.SUPER_POTION(), 0, baseCost * 0.45),
      new ModifierTypeOption(modifierTypeInitObj.FULL_HEAL(), 0, baseCost),
    ],
    [
      new ModifierTypeOption(modifierTypeInitObj.ELIXIR(), 0, baseCost),
      new ModifierTypeOption(modifierTypeInitObj.MAX_ETHER(), 0, baseCost),
    ],
    [
      new ModifierTypeOption(modifierTypeInitObj.HYPER_POTION(), 0, baseCost * 0.8),
      new ModifierTypeOption(modifierTypeInitObj.MAX_REVIVE(), 0, baseCost * 2.75),
      new ModifierTypeOption(modifierTypeInitObj.MEMORY_MUSHROOM(), 0, baseCost * 4),
    ],
    [
      new ModifierTypeOption(modifierTypeInitObj.MAX_POTION(), 0, baseCost * 1.5),
      new ModifierTypeOption(modifierTypeInitObj.MAX_ELIXIR(), 0, baseCost * 2.5),
    ],
    [new ModifierTypeOption(modifierTypeInitObj.FULL_RESTORE(), 0, baseCost * 2.25)],
    [new ModifierTypeOption(modifierTypeInitObj.SACRED_ASH(), 0, baseCost * 10)],
  ];

  return options
    .slice(0, Math.ceil(Math.max(waveIndex + 10, 0) / 30))
    .flat()
    .filter(shopItem => {
      const status = new BooleanHolder(true);
      applyChallenges(ChallengeType.SHOP_ITEM, shopItem, status);
      return status.value;
    });
}

export function getEnemyBuffModifierForWave(
  tier: ModifierTier,
  enemyModifiers: PersistentModifier[],
): EnemyPersistentModifier | null {
  let tierStackCount: number;
  switch (tier) {
    case ModifierTier.ULTRA:
      tierStackCount = 5;
      break;
    case ModifierTier.GREAT:
      tierStackCount = 3;
      break;
    default:
      tierStackCount = 1;
      break;
  }

  const retryCount = 50;
  let candidate = getNewModifierTypeOption([], ModifierPoolType.ENEMY_BUFF, tier);
  let r = 0;
  let matchingModifier: PersistentModifier | undefined;
  while (
    ++r < retryCount
    && (matchingModifier = enemyModifiers.find(m => m.type.id === candidate?.type?.id))
    && matchingModifier.getMaxStackCount() < matchingModifier.stackCount + (r < 10 ? tierStackCount : 1)
  ) {
    candidate = getNewModifierTypeOption([], ModifierPoolType.ENEMY_BUFF, tier);
  }

  // Local fork (2026-11-13): once every token is at its cap (all of them by about Endless wave 5750-5800), the pool has
  // no weight left and no candidate comes back; the draw used to throw here ("Cannot set properties of undefined") and
  // break the run on the next 50-wave victory. Nothing is drawn instead (AddEnemyBuffModifierPhase skips it).
  if (candidate?.type == null) {
    return null;
  }
  const modifier = candidate.type.newModifier() as EnemyPersistentModifier;
  modifier.stackCount = tierStackCount;

  return modifier;
}

export function getEnemyModifierTypesForWave(
  waveIndex: number,
  count: number,
  party: EnemyPokemon[],
  poolType: ModifierPoolType.WILD | ModifierPoolType.TRAINER,
  upgradeChance = 0,
): PokemonHeldItemModifierType[] {
  const ret = new Array(count)
    .fill(0)
    .map(
      () =>
        getNewModifierTypeOption(party, poolType, undefined, upgradeChance && !randSeedInt(upgradeChance) ? 1 : 0)
          ?.type as PokemonHeldItemModifierType,
    );
  if (!(waveIndex % 1000)) {
    ret.push(getModifierType(modifierTypeInitObj.MINI_BLACK_HOLE) as PokemonHeldItemModifierType);
  }
  return ret;
}

export function getDailyRunStarterModifiers(party: PlayerPokemon[]): PokemonHeldItemModifier[] {
  const ret: PokemonHeldItemModifier[] = [];
  for (const p of party) {
    for (let m = 0; m < 3; m++) {
      const tierValue = randSeedInt(64);

      let tier: ModifierTier;
      if (tierValue > 25) {
        tier = ModifierTier.COMMON;
      } else if (tierValue > 12) {
        tier = ModifierTier.GREAT;
      } else if (tierValue > 4) {
        tier = ModifierTier.ULTRA;
      } else if (tierValue) {
        tier = ModifierTier.ROGUE;
      } else {
        tier = ModifierTier.MASTER;
      }

      const modifier = getNewModifierTypeOption(party, ModifierPoolType.DAILY_STARTER, tier)?.type?.newModifier(
        p,
      ) as PokemonHeldItemModifier;
      ret.push(modifier);
    }
  }

  return ret;
}

/**
 * Generates a ModifierType from the specified pool
 * @param party party of the trainer using the item
 * @param poolType PLAYER/WILD/TRAINER
 * @param tier If specified, will override the initial tier of an item (can still upgrade with luck)
 * @param upgradeCount If defined, means that this is a new ModifierType being generated to override another via luck upgrade. Used for recursive logic
 * @param retryCount Max allowed tries before the next tier down is checked for a valid ModifierType
 * @param allowLuckUpgrades Default true. If false, will not allow ModifierType to randomly upgrade to next tier
 */
function getNewModifierTypeOption(
  party: Pokemon[],
  poolType: ModifierPoolType,
  tier?: ModifierTier,
  upgradeCount?: number,
  retryCount = 0,
  allowLuckUpgrades = true,
  excludeVouchers = false,
): ModifierTypeOption | null {
  const player = !poolType;
  const pool = getModifierPoolForType(poolType);
  let thresholds: object;
  switch (poolType) {
    case ModifierPoolType.PLAYER:
      thresholds = modifierPoolThresholds;
      break;
    case ModifierPoolType.WILD:
      thresholds = enemyModifierPoolThresholds;
      break;
    case ModifierPoolType.TRAINER:
      thresholds = enemyModifierPoolThresholds;
      break;
    case ModifierPoolType.ENEMY_BUFF:
      thresholds = enemyBuffModifierPoolThresholds;
      break;
    case ModifierPoolType.DAILY_STARTER:
      thresholds = dailyStarterModifierPoolThresholds;
      break;
  }
  if (tier === undefined) {
    const tierValue = randSeedInt(1024);
    if (!upgradeCount) {
      upgradeCount = 0;
    }
    if (player && tierValue && allowLuckUpgrades) {
      const partyLuckValue = getPartyLuckValue(party);
      const upgradeOdds = Math.floor(128 / ((partyLuckValue + 4) / 4));
      let upgraded = false;
      do {
        upgraded = randSeedInt(upgradeOdds) < 4;
        if (upgraded) {
          upgradeCount++;
        }
      } while (upgraded);
    }

    // Local fork (2026-11-12): the TRAINER pool (trainer battles only) reads the same roll with its own table, more
    // 로그 / 마스터 and, in Endless, rising with the wave (enemy-trainer-buffs.ts; the user: "타입 강화 효과 도구보단 다른
    // 아이템을 가질 확률을 올려보고"); every other pool keeps the base table here
    tier = tierFromRoll(
      tierValue,
      poolType === ModifierPoolType.TRAINER
        ? getEnemyTrainerTierCounts(currentWave(), !!globalScene?.gameMode?.isEndless)
        : BASE_TIER_COUNTS,
    );

    // Local fork: in Endless the player's rewards follow a wave curve (getEndlessTierCounts), while egg vouchers keep
    // the base game's odds. When the band moves this roll to another tier, the roll is first resolved
    // with the base table (only if that tier can give a voucher at all); a voucher pick is returned
    // as is, otherwise the band tier is used and vouchers are left out of the re-pick.
    if (player && usesEndlessTierBands()) {
      const bandTier = tierFromRoll(tierValue, getEndlessTierCounts(currentWave()));
      if (bandTier !== tier) {
        let baseTier = tier + upgradeCount;
        let baseUpgradeCount = upgradeCount;
        while (baseTier && (!Object.hasOwn(pool, baseTier) || pool[baseTier].length === 0)) {
          baseTier--;
          if (baseUpgradeCount) {
            baseUpgradeCount--;
          }
        }
        if (tierHasVoucher(thresholds, pool, baseTier)) {
          const baseOption = getNewModifierTypeOption(
            party,
            poolType,
            baseTier,
            baseUpgradeCount,
            retryCount,
            allowLuckUpgrades,
          );
          if (baseOption?.type instanceof AddVoucherModifierType) {
            return baseOption;
          }
        }
        tier = bandTier;
        excludeVouchers = true;
      }
    }

    tier += upgradeCount;
    while (tier && (!Object.hasOwn(pool, tier) || pool[tier].length === 0)) {
      tier--;
      if (upgradeCount) {
        upgradeCount--;
      }
    }
  } else if (upgradeCount === undefined && player) {
    upgradeCount = 0;
    if (tier < ModifierTier.MASTER && allowLuckUpgrades) {
      const partyLuckValue = getPartyLuckValue(party);
      const upgradeOdds = Math.floor(128 / ((partyLuckValue + 4) / 4));
      while (Object.hasOwn(pool, tier + upgradeCount + 1) && pool[tier + upgradeCount + 1].length > 0) {
        if (randSeedInt(upgradeOdds) < 4) {
          upgradeCount++;
        } else {
          break;
        }
      }
      tier += upgradeCount;
    }
  } else if (retryCount >= 100 && tier) {
    retryCount = 0;
    tier--;
  }

  // Local fork (2026-11-06): a tier whose every item is filtered out (MASTER can empty once the balls, charms and
  // held items everyone holds at the cap are gone) falls back to the next tier down instead of yielding nothing
  while (tier > ModifierTier.COMMON && Object.keys(thresholds[tier] ?? {}).length === 0) {
    tier--;
    if (upgradeCount) {
      upgradeCount--;
    }
  }

  const tierThresholds = Object.keys(thresholds[tier]);
  const totalWeight = Number.parseInt(tierThresholds.at(-1)!);
  const value = randSeedInt(totalWeight);
  let index: number | undefined;
  for (const t of tierThresholds) {
    const threshold = Number.parseInt(t);
    if (value < threshold) {
      index = thresholds[tier][threshold];
      break;
    }
  }

  if (index === undefined) {
    return null;
  }

  if (player) {
    console.log(index, ignoredPoolIndexes[tier].filter(i => i <= index).length, ignoredPoolIndexes[tier]);
  }
  let modifierType: ModifierType | null = pool[tier][index].modifierType;
  if (modifierType instanceof ModifierTypeGenerator) {
    modifierType = (modifierType as ModifierTypeGenerator).generateType(party);
    if (modifierType === null) {
      if (player) {
        console.log(ModifierTier[tier], upgradeCount);
      }
      return getNewModifierTypeOption(
        party,
        poolType,
        tier,
        upgradeCount,
        ++retryCount,
        allowLuckUpgrades,
        excludeVouchers,
      );
    }
  }

  if (excludeVouchers && modifierType instanceof AddVoucherModifierType) {
    // Local fork: vouchers were already settled with the base odds (see the Endless band branch above)
    return getNewModifierTypeOption(party, poolType, tier, upgradeCount, ++retryCount, allowLuckUpgrades, true);
  }

  console.log(modifierType, player ? "" : "(enemy)");

  const option = new ModifierTypeOption(modifierType as ModifierType, upgradeCount!); // TODO: is this bang correct?
  option.vouchersSettled = excludeVouchers;
  return option;
}

export function getDefaultModifierTypeForTier(tier: ModifierTier): ModifierType {
  const modifierPool = getModifierPoolForType(ModifierPoolType.PLAYER);
  let modifierType: ModifierType | WeightedModifierType = modifierPool[tier || ModifierTier.COMMON][0];
  if (modifierType instanceof WeightedModifierType) {
    modifierType = (modifierType as WeightedModifierType).modifierType;
  }
  return modifierType;
}

export class ModifierTypeOption {
  public type: ModifierType;
  public upgradeCount: number;
  public cost: number;
  /**
   * Local fork: `true` when this option came from the Endless band re-pick, whose egg voucher chance
   * was already settled with the base odds; a duplicate re-roll of it must leave vouchers out too.
   */
  public vouchersSettled = false;

  constructor(type: ModifierType, upgradeCount: number, cost = 0) {
    this.type = type;
    this.upgradeCount = upgradeCount;
    this.cost = Math.min(Math.round(cost), Number.MAX_SAFE_INTEGER);
  }
}

/**
 * Calculates the team's luck value.
 * @param party The player's party.
 * @returns A number between 0 and 14 based on the party's total luck value, or a random number between 0 and 14 if the player is in Daily Run mode.
 * Local fork (2026-11-11): plus the luck of the player's clovers (네잎클로버 잎 / 네잎클로버 / 황금 네잎클로버,
 * {@linkcode getPartyCloverLuck}), the sum still capped at {@linkcode MAX_PARTY_LUCK} (14, SSS) in every mode, the Daily
 * run's seeded luck included. Every luck reader goes through here: the luck shown on the reward screen, the reward tier
 * upgrade rolls, wild species rarity and the encounters that read luck.
 */
export function getPartyLuckValue(party: readonly Pokemon[]): number {
  // Local fork (2026-11-11): the user: "네잎클로버 잎(슈퍼, 4개 모으면 행운 +1 …)", "네잎클로버(하이퍼, 행운 +1 …)",
  // "황금 네잎클로버(로그, 행운+3, 최대 2개)"
  const cloverLuck = getPartyCloverLuck();
  if (globalScene.gameMode.isDaily) {
    const DailyLuck = new NumberHolder(0);
    globalScene.executeWithSeedOffset(
      () => {
        const eventLuck = getDailyEventSeedLuck();
        if (eventLuck != null) {
          DailyLuck.value = eventLuck;
          return;
        }

        DailyLuck.value = randSeedInt(15); // Random number between 0 and 14
      },
      0,
      globalScene.seed,
    );
    // Local fork (2026-11-11): the clovers on top of the seeded luck, capped at 14
    return Math.min(DailyLuck.value + cloverLuck, MAX_PARTY_LUCK);
  }

  const eventSpecies = timedEventManager.getEventLuckBoostedSpecies();
  const luck = Phaser.Math.Clamp(
    party
      .map(p => (p.isAllowedInBattle() ? p.getLuck() + (eventSpecies.includes(p.species.speciesId) ? 1 : 0) : 0))
      .reduce((total: number, value: number) => (total += value), 0),
    0,
    14,
  );
  // Local fork (2026-11-11): the clovers on top of the shiny luck and the event boost, the sum capped at 14
  return Math.min(timedEventManager.getEventLuckBoost() + (luck ?? 0) + cloverLuck, MAX_PARTY_LUCK);
}

export function getLuckString(luckValue: number): string {
  return ["D", "C", "C+", "B-", "B", "B+", "A-", "A", "A+", "A++", "S", "S+", "SS", "SS+", "SSS"][luckValue];
}

export function getLuckTextTint(luckValue: number): number {
  let modifierTier: ModifierTier;
  if (luckValue > 11) {
    modifierTier = ModifierTier.LUXURY;
  } else if (luckValue > 9) {
    modifierTier = ModifierTier.MASTER;
  } else if (luckValue > 5) {
    modifierTier = ModifierTier.ROGUE;
  } else if (luckValue > 2) {
    modifierTier = ModifierTier.ULTRA;
  } else if (luckValue) {
    modifierTier = ModifierTier.GREAT;
  } else {
    modifierTier = ModifierTier.COMMON;
  }
  return getModifierTierTextTint(modifierTier);
}

export function initModifierTypes() {
  Object.assign(modifierTypes, modifierTypeInitObj);
}

// TODO: If necessary, add the rest of the modifier types here.
// For now, doing the minimal work until the modifier rework lands.
const ModifierTypeConstructorMap = Object.freeze({
  ModifierTypeGenerator,
  PokemonHeldItemModifierType,
});

/**
 * Map of of modifier type strings to their constructor type
 */
export type ModifierTypeConstructorMap = typeof ModifierTypeConstructorMap;

/**
 * Map of modifier type strings to their instance type
 */
export type ModifierTypeInstanceMap = {
  [K in keyof ModifierTypeConstructorMap]: InstanceType<ModifierTypeConstructorMap[K]>;
};

export type ModifierTypeString = keyof ModifierTypeConstructorMap;
