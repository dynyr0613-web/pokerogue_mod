import { globalScene } from "#app/global-scene";
import { settings } from "#app/global-settings-manager";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { NON_LEGEND_PARADOX_POKEMON, NON_LEGEND_ULTRA_BEASTS } from "#balance/special-species-groups";
import { ALPHA_MAX_BOOST, normalizeAlphaBoost } from "#data/alpha-pokemon";
import type { Challenge } from "#data/challenge";
import {
  FlipStatChallenge,
  FreshStartChallenge,
  InverseBattleChallenge,
  PassivesChallenge,
  SingleGenerationChallenge,
  SingleTypeChallenge,
} from "#data/challenge";
import {
  COMPLETION_EXEMPT_MARKS,
  getCollectedMarks,
  getMarkKey,
  hasEternatusMark,
  hasEverObtainedMark,
  isMarkCollectionComplete,
  MARKS_ATLAS_KEY,
  TRAINER_RIBBONS,
  WILD_MARKS,
} from "#data/pokemon-marks";
import { Challenges } from "#enums/challenges";
import { PlayerGender } from "#enums/player-gender";
import { PokemonMark } from "#enums/pokemon-mark";
import { PokemonType, type RegularPokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { getShortenedStatKey, Stat } from "#enums/stat";
import type { Modifier } from "#modifiers/modifier";
import { TurnHeldItemTransferModifier } from "#modifiers/modifier";
import type { ConditionFn } from "#types/common";
import { isNuzlockeChallenge } from "#utils/challenge-utils";
import type { NumberHolder } from "#utils/common";
import type { ValueHolder } from "#utils/value-holder";
import i18next from "i18next";

export enum AchvTier {
  COMMON,
  GREAT,
  ULTRA,
  ROGUE,
  MASTER,
}

function getGenderStr(): string {
  const genderIndex = settings.general.playerGender;
  const genderStr = PlayerGender[genderIndex].toLowerCase();
  return genderStr;
}

/** Local fork (2026-11-17): how many times the mark or ribbon has been collected (`GameData.markCounts`) */
function getMarkCount(mark: PokemonMark): number {
  return globalScene.gameData.markCounts[mark] ?? 0;
}

/**
 * Local fork (2026-11-17): the ribbons the champions give (the ribbon achievements). Local fork (2026-11-18): but for
 * the hidden ones, the named trainers' Hisui Ribbon: no collection asks for a hidden mark.
 */
const CHAMPION_RIBBONS: readonly PokemonMark[] = [...new Set(Object.values(TRAINER_RIBBONS))].filter(
  m => !COMPLETION_EXEMPT_MARKS.includes(m),
);

/**
 * Local fork (2026-11-17): the marks the "every kind" achievement asks for: the 41 wild marks and the Jumbo, Mini,
 * Partner and shiny marks (the user: "증표 도감 완성에는 파트너, 조그만, 이로치 3종, 커다란도 넣어두고"), but for the
 * epic shiny mark since it became a hidden mark: no collection asks for a hidden mark.
 */
export const ALL_KINDS_MARKS: readonly PokemonMark[] = [
  ...WILD_MARKS,
  PokemonMark.JUMBO_MARK,
  PokemonMark.MINI_MARK,
  PokemonMark.PARTNER_MARK,
  PokemonMark.SHINY_MARK,
  PokemonMark.RARE_SHINY_MARK,
];

/**
 * Local fork (2026-11-18): the hidden marks the last achievement asks for: all but the Itemfinder Mark, which only a
 * Pokémon with Pickup can earn (the user: "습득의 증표는 픽업 특성이 있는 포켓몬만 획득 가능하니 그것도 제외해야 할
 * 것 같고")
 */
export const THE_END_MARKS: readonly PokemonMark[] = COMPLETION_EXEMPT_MARKS.filter(
  m => m !== PokemonMark.ITEMFINDER_MARK,
);

/** Local fork (2026-11-17): the wild marks collected so far, counting every one */
function countWildMarks(): number {
  return WILD_MARKS.reduce((sum, mark) => sum + getMarkCount(mark), 0);
}

export class Achv {
  public localizationKey: string;
  public id: string;
  public iconImage: string;
  public score: number;

  /**
   * Local fork (2026-11-17): the atlas {@linkcode iconImage} is a frame of, and the scale it is drawn at next to an
   * `items` icon (32 px); the mark achievements use the marks' 40 px icons ({@linkcode setIconAtlas})
   */
  public iconAtlas = "items";
  public iconScale = 1;

  public secret: boolean;
  public hasParent: boolean;
  public parentId: string;

  protected conditionFunc?: ConditionFn;

  constructor(localizationKey: string, iconImage: string, score: number, conditionFunc?: ConditionFn) {
    this.iconImage = iconImage;
    this.score = score;
    if (conditionFunc != null) {
      this.conditionFunc = conditionFunc;
    }
    this.localizationKey = localizationKey;
  }

  public get name(): string {
    // Localization key is used to get the name of the achievement
    return i18next.t(`achv:${this.localizationKey}.name`, { context: getGenderStr() });
  }

  public get description(): string {
    return i18next.t(`achv:${this.localizationKey}.description`, { context: getGenderStr() });
  }

  getIconImage(): string {
    return this.iconImage;
  }

  /** Local fork (2026-11-17): take the icon from another atlas than `items` */
  setIconAtlas(atlas: string, scale: number): this {
    this.iconAtlas = atlas;
    this.iconScale = scale;
    return this;
  }

  setSecret(hasParent?: boolean): this {
    this.secret = true;
    this.hasParent = !!hasParent;
    return this;
  }

  validate(args?: any[]): boolean {
    return !this.conditionFunc || this.conditionFunc(args);
  }

  getTier(): AchvTier {
    if (this.score >= 100) {
      return AchvTier.MASTER;
    }
    if (this.score >= 75) {
      return AchvTier.ROGUE;
    }
    if (this.score >= 50) {
      return AchvTier.ULTRA;
    }
    if (this.score >= 25) {
      return AchvTier.GREAT;
    }
    return AchvTier.COMMON;
  }
}

export class MoneyAchv extends Achv {
  private readonly moneyAmount: number;

  constructor(localizationKey: string, moneyAmount: number, iconImage: string, score: number) {
    super(localizationKey, iconImage, score, () => globalScene.money >= this.moneyAmount);
    this.moneyAmount = moneyAmount;
  }

  public override get description(): string {
    return i18next.t("achv:moneyAchv.description", {
      context: getGenderStr(),
      moneyAmount: this.moneyAmount.toLocaleString("en-US"),
    });
  }
}

export class RibbonAchv extends Achv {
  private readonly ribbonAmount: number;

  constructor(localizationKey: string, ribbonAmount: number, iconImage: string, score: number) {
    super(localizationKey, iconImage, score, () => globalScene.gameData.gameStats.ribbonsOwned >= this.ribbonAmount);
    this.ribbonAmount = ribbonAmount;
  }

  public override get description(): string {
    return i18next.t("achv:ribbonAchv.description", {
      context: getGenderStr(),
      ribbonAmount: this.ribbonAmount.toLocaleString("en-US"),
    });
  }
}

/**
 * Local fork (2026-11-17): an achievement for collecting marks and ribbons (pokemon-marks.ts), checked against the
 * collection in the system save (`GameData.markCounts`, the alphas per starter line). Its icon is a mark's.
 */
export class MarkCollectionAchv extends Achv {
  private readonly amount: number | undefined;

  /**
   * @param localizationKey - The key in `achv.json`; the description takes `{{amount}}`
   * @param mark - The mark whose icon it shows
   * @param score - The achievement's score
   * @param conditionFunc - Whether the collection has reached the goal
   * @param amount - The number the description names, if it names one
   */
  constructor(
    localizationKey: string,
    mark: PokemonMark,
    score: number,
    conditionFunc: () => boolean,
    amount?: number,
  ) {
    super(localizationKey, getMarkKey(mark), score, conditionFunc);
    this.amount = amount;
    // The marks' icons are 40 px, the items' 32 px
    this.setIconAtlas(MARKS_ATLAS_KEY, 0.8);
  }

  public override get description(): string {
    return i18next.t(`achv:${this.localizationKey}.description`, {
      context: getGenderStr(),
      amount: this.amount?.toLocaleString("en-US"),
    });
  }
}

/**
 * Local fork (2026-11-18): one thing a Pokédex collection achievement asks for: a species caught (or hatched), or a
 * form of it recorded as caught. A form a player's Pokémon takes in battle (a Mega Evolution, a Primal Reversion,
 * Necrozma's fusions) is recorded so (`PlayerPokemon.changeForm` → `GameData.setPokemonCaught`).
 */
export type DexGoal = SpeciesId | { readonly speciesId: SpeciesId; readonly formKey: string };

/** Local fork (2026-11-18): whether the Pokédex has the goal ({@linkcode DexGoal}) */
export function isDexGoalMet(goal: DexGoal): boolean {
  const speciesId = typeof goal === "number" ? goal : goal.speciesId;
  const caughtAttr = globalScene.gameData.dexData[speciesId]?.caughtAttr ?? 0n;
  if (typeof goal === "number") {
    return caughtAttr > 0n;
  }
  const formIndex = speciesDataRegistry.getSpecies(speciesId).forms.findIndex(f => f.formKey === goal.formKey);
  return formIndex >= 0 && (caughtAttr & globalScene.gameData.getFormAttr(formIndex)) > 0n;
}

/**
 * Local fork (2026-11-18): an achievement for a group of Pokémon all collected, or forms all taken, read from the
 * Pokédex (the user: "업적이나 좀 추가해둡시다 / "고대의 거인들"(레지시리즈 전부 모으기) ... 이외에도 환상 전부 수집,
 * 준전설 전부 수집 등등"). Checked whenever the Pokédex records a catch, a hatch, an evolution or a form
 * (`GameData.setPokemonCaught`), so an older save gets the ones it already has with the next of those.
 */
export class DexCollectionAchv extends Achv {
  /** The goals, read when checked: the groups by flag need the species data loaded */
  public readonly getGoals: () => readonly DexGoal[];

  /**
   * @param localizationKey - The key in `achv.json`; the description may take `{{amount}}`, the number of goals
   * @param iconImage - The `items` atlas frame of its icon
   * @param score - The achievement's score
   * @param goals - The species or forms it asks for, all of them
   */
  constructor(localizationKey: string, iconImage: string, score: number, goals: () => readonly DexGoal[]) {
    super(localizationKey, iconImage, score, () => goals().every(isDexGoalMet));
    this.getGoals = goals;
  }

  public override get description(): string {
    return i18next.t(`achv:${this.localizationKey}.description`, {
      context: getGenderStr(),
      amount: this.getGoals().length,
    });
  }
}

/** Local fork (2026-11-18): every species with the flag ({@linkcode DexCollectionAchv}), regional ones included */
function getSpeciesWith(flag: "legendary" | "subLegendary" | "mythical"): SpeciesId[] {
  return speciesDataRegistry
    .getAllSpecies()
    .filter(s => s[flag])
    .map(s => s.speciesId);
}

/**
 * Local fork (2026-11-19): every species whose default form (form 0) has the type as its first or second type,
 * regional ones included, the same ones the other collections can ask for: every species is a starter or evolves from
 * one, and Eternatus is left out, which can only be caught once every other Pokémon is (as for ALL_LEGENDARY)
 */
export function getSpeciesOfType(type: RegularPokemonType): SpeciesId[] {
  return speciesDataRegistry
    .getAllSpecies()
    .filter(s => {
      const form = s.forms[0] ?? s;
      return s.speciesId !== SpeciesId.ETERNATUS && (form.type1 === type || form.type2 === type);
    })
    .map(s => s.speciesId);
}

/**
 * Local fork (2026-11-19): a collection per type (the user: "새 업적으로 각 타입에 해당하는 포켓몬 수집을
 * 넣어둡시다"): every species of the type ({@linkcode getSpeciesOfType}) caught, checked like the other Pokédex
 * collections ({@linkcode DexCollectionAchv})
 */
export class TypeCollectionAchv extends DexCollectionAchv {
  public readonly type: RegularPokemonType;

  constructor(localizationKey: string, type: RegularPokemonType, iconImage: string, score: number) {
    super(localizationKey, iconImage, score, () => getSpeciesOfType(type));
    this.type = type;
  }
}

export class DamageAchv extends Achv {
  private readonly damageAmount: number;
  // intentionally overwriting base property
  declare protected readonly conditionFunc: ConditionFn<[number | NumberHolder]>;

  constructor(localizationKey: string, damageAmount: number, iconImage: string, score: number) {
    super(localizationKey, iconImage, score);
    this.conditionFunc = (args: [NumberHolder | number]) =>
      (typeof args[0] === "number" ? args[0] : args[0].value) >= this.damageAmount;
    this.damageAmount = damageAmount;
  }

  public override get description(): string {
    return i18next.t("achv:damageAchv.description", {
      context: getGenderStr(),
      damageAmount: this.damageAmount.toLocaleString("en-US"),
    });
  }
}

export class HealAchv extends Achv {
  private readonly healAmount: number;
  declare protected readonly conditionFunc: ConditionFn<[number | NumberHolder]>;

  constructor(localizationKey: string, healAmount: number, iconImage: string, score: number) {
    super(localizationKey, iconImage, score);
    this.conditionFunc = (args: [number | NumberHolder]) =>
      (typeof args[0] === "number" ? args[0] : args[0].value) >= this.healAmount;
    this.healAmount = healAmount;
  }

  public override get description(): string {
    return i18next.t("achv:healAchv.description", {
      context: getGenderStr(),
      healAmount: this.healAmount.toLocaleString("en-US"),
      HP: i18next.t(getShortenedStatKey(Stat.HP)),
    });
  }
}

export class LevelAchv extends Achv {
  private readonly level: number;

  constructor(localizationKey: string, level: number, iconImage: string, score: number) {
    super(
      localizationKey,
      iconImage,
      score,
      (args: [ValueHolder<number> | number, ...any[]]) =>
        (typeof args[0] === "number" ? args[0] : args[0].value) >= this.level,
    );
    this.level = level;
  }

  public get description(): string {
    return i18next.t("achv:levelAchv.description", {
      context: getGenderStr(),
      level: this.level,
    });
  }
}

export class ModifierAchv extends Achv {
  constructor(
    localizationKey: string,
    iconImage: string,
    score: number,
    modifierFunc: (modifier: Modifier) => boolean,
  ) {
    super(localizationKey, iconImage, score, (args: any[]) => modifierFunc(args[0] as Modifier));
  }
}

export class ChallengeAchv extends Achv {
  constructor(
    localizationKey: string,
    iconImage: string,
    score: number,
    challengeFunc: (challenge: Challenge) => boolean,
  ) {
    super(localizationKey, iconImage, score, (args: any[]) => challengeFunc(args[0] as Challenge));
  }
}

export class MonoTypeChallengeAchv extends ChallengeAchv {
  private readonly type: RegularPokemonType;

  constructor(
    localizationKey: string,
    type: RegularPokemonType,
    iconImage: string,
    score: number,
    challengeFunc: (challenge: Challenge) => boolean,
  ) {
    super(localizationKey, iconImage, score, (challenge: Challenge) => challengeFunc(challenge));
    this.type = type;
  }

  public get description(): string {
    const typeKey = PokemonType[this.type].toLowerCase();
    return i18next.t("achv:monoType.description", {
      context: getGenderStr(),
      type: i18next.t(`pokemonInfo:type.${typeKey}`),
    });
  }
}

// TODO: Find a better way to block achievements for certain challenges
/** Returns `true` if the inverse or flip stat challenges are active */
const inverseAndFlipStatAchievementsBlock = () =>
  globalScene.gameMode.challenges.some(
    c => [Challenges.INVERSE_BATTLE, Challenges.FLIP_STAT].includes(c.id) && c.value > 0,
  );

/** Returns `true` if the passives challenge on `all` is active */
const passivesChallengeAchievementsBlock = () =>
  globalScene.gameMode.challenges.some(c => c.id === Challenges.PASSIVES && c.value === 2);

const randomizerChallengesAchvBlock = () =>
  globalScene.gameMode.challenges.some(
    c => [Challenges.MOVESET_RANDOMIZER, Challenges.ABILITY_RANDOMIZER].includes(c.id) && c.value > 0,
  );

export const achvs = {
  CLASSIC_VICTORY: new Achv(
    "classicVictory",
    "classic_ribbon_default",
    250,
    () => globalScene.gameData.gameStats.sessionsWon === 0,
  ),
  _10_RIBBONS: new RibbonAchv("10Ribbons", 10, "common_ribbon", 50),
  _25_RIBBONS: new RibbonAchv("25Ribbons", 25, "great_ribbon", 75),
  _50_RIBBONS: new RibbonAchv("50Ribbons", 50, "ultra_ribbon", 100),
  _75_RIBBONS: new RibbonAchv("75Ribbons", 75, "rogue_ribbon", 125),
  _100_RIBBONS: new RibbonAchv("100Ribbons", 100, "master_ribbon", 150),
  _10K_MONEY: new MoneyAchv("10KMoney", 10000, "nugget", 25),
  _100K_MONEY: new MoneyAchv("100KMoney", 100000, "big_nugget", 25).setSecret(true),
  _1M_MONEY: new MoneyAchv("1MMoney", 1000000, "relic_gold", 50).setSecret(true),
  _10M_MONEY: new MoneyAchv("10MMoney", 10000000, "coin_case", 50).setSecret(true),
  _250_DMG: new DamageAchv("250Dmg", 250, "lucky_punch", 25),
  _1000_DMG: new DamageAchv("1000Dmg", 1000, "lucky_punch_great", 25).setSecret(true),
  _2500_DMG: new DamageAchv("2500Dmg", 2500, "lucky_punch_ultra", 50).setSecret(true),
  _10000_DMG: new DamageAchv("10000Dmg", 10000, "lucky_punch_master", 50).setSecret(true),
  _250_HEAL: new HealAchv("250Heal", 250, "potion", 25),
  _1000_HEAL: new HealAchv("1000Heal", 1000, "super_potion", 25).setSecret(true),
  _2500_HEAL: new HealAchv("2500Heal", 2500, "hyper_potion", 50).setSecret(true),
  _10000_HEAL: new HealAchv("10000Heal", 10000, "max_potion", 50).setSecret(true),
  LV_100: new LevelAchv("lv100", 100, "rare_candy", 25).setSecret(),
  LV_250: new LevelAchv("lv250", 250, "rarer_candy", 25).setSecret(true),
  LV_1000: new LevelAchv("lv1000", 1000, "candy_jar", 50).setSecret(true),
  TRANSFER_MAX_STAT_STAGE: new Achv("transferMaxStatStage", "baton", 25),
  MAX_FRIENDSHIP: new Achv("maxFriendship", "ribbon_friendship", 25),
  MEGA_EVOLVE: new Achv("megaEvolve", "mega_bracelet", 50),
  GIGANTAMAX: new Achv("gigantamax", "dynamax_band", 50),
  TERASTALLIZE: new Achv("terastallize", "tera_orb", 25),
  STELLAR_TERASTALLIZE: new Achv("stellarTerastallize", "stellar_tera_shard", 25).setSecret(true),
  SPLICE: new Achv("splice", "dna_splicers", 50),
  MINI_BLACK_HOLE: new ModifierAchv(
    "miniBlackHole",
    "mini_black_hole",
    25,
    modifier => modifier instanceof TurnHeldItemTransferModifier,
  ).setSecret(),
  HIDDEN_ABILITY: new Achv("hiddenAbility", "ability_charm", 25),
  PERFECT_IVS: new Achv("perfectIvs", "blunder_policy", 25),
  SEE_SHINY: new Achv("seeShiny", "pb_gold", 50),
  SHINY_PARTY: new Achv("shinyParty", "shiny_charm", 50).setSecret(true),
  CATCH_SUB_LEGENDARY: new Achv("catchSubLegendary", "rb", 50).setSecret(),
  CATCH_MYTHICAL: new Achv("catchMythical", "strange_ball", 75).setSecret(),
  CATCH_LEGENDARY: new Achv("catchLegendary", "mb", 100).setSecret(),
  HATCH_SUB_LEGENDARY: new Achv("hatchSubLegendary", "epic_egg", 50).setSecret(),
  HATCH_MYTHICAL: new Achv("hatchMythical", "manaphy_egg", 50).setSecret(),
  HATCH_LEGENDARY: new Achv("hatchLegendary", "legendary_egg", 100).setSecret(),
  HATCH_SHINY: new Achv("hatchShiny", "rogue_egg", 100).setSecret(),
  DAILY_VICTORY: new Achv("dailyVictory", "calendar", 100),
  FRESH_START: new ChallengeAchv(
    "freshStart",
    "fresh_start_ribbon",
    100,
    c =>
      c instanceof FreshStartChallenge
      && c.value === 1
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  NUZLOCKE: new ChallengeAchv(
    "nuzlocke",
    "leaf_stone",
    100,
    () => isNuzlockeChallenge() && !inverseAndFlipStatAchievementsBlock() && !passivesChallengeAchievementsBlock(),
  ),
  INVERSE_BATTLE: new ChallengeAchv(
    "inverseBattle",
    "inverse_ribbon",
    100,
    c => c instanceof InverseBattleChallenge && c.value > 0 && !randomizerChallengesAchvBlock(),
  ),
  FLIP_STATS: new ChallengeAchv(
    "flipStats",
    "flip_stats_ribbon",
    100,
    c => c instanceof FlipStatChallenge && c.value > 0 && !randomizerChallengesAchvBlock(),
  ),
  MONO_GEN_ONE_VICTORY: new ChallengeAchv(
    "monoGenOne",
    "ribbon_gen1",
    100,
    c =>
      c instanceof SingleGenerationChallenge
      && c.value === 1
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  MONO_GEN_TWO_VICTORY: new ChallengeAchv(
    "monoGenTwo",
    "ribbon_gen2",
    100,
    c =>
      c instanceof SingleGenerationChallenge
      && c.value === 2
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  MONO_GEN_THREE_VICTORY: new ChallengeAchv(
    "monoGenThree",
    "ribbon_gen3",
    100,
    c =>
      c instanceof SingleGenerationChallenge
      && c.value === 3
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  MONO_GEN_FOUR_VICTORY: new ChallengeAchv(
    "monoGenFour",
    "ribbon_gen4",
    100,
    c =>
      c instanceof SingleGenerationChallenge
      && c.value === 4
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  MONO_GEN_FIVE_VICTORY: new ChallengeAchv(
    "monoGenFive",
    "ribbon_gen5",
    100,
    c =>
      c instanceof SingleGenerationChallenge
      && c.value === 5
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  MONO_GEN_SIX_VICTORY: new ChallengeAchv(
    "monoGenSix",
    "ribbon_gen6",
    100,
    c =>
      c instanceof SingleGenerationChallenge
      && c.value === 6
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  MONO_GEN_SEVEN_VICTORY: new ChallengeAchv(
    "monoGenSeven",
    "ribbon_gen7",
    100,
    c =>
      c instanceof SingleGenerationChallenge
      && c.value === 7
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  MONO_GEN_EIGHT_VICTORY: new ChallengeAchv(
    "monoGenEight",
    "ribbon_gen8",
    100,
    c =>
      c instanceof SingleGenerationChallenge
      && c.value === 8
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  MONO_GEN_NINE_VICTORY: new ChallengeAchv(
    "monoGenNine",
    "ribbon_gen9",
    100,
    c =>
      c instanceof SingleGenerationChallenge
      && c.value === 9
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  MONO_NORMAL: new MonoTypeChallengeAchv(
    "monoNormal",
    PokemonType.NORMAL,
    "ribbon_normal",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 1
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  MONO_FIGHTING: new MonoTypeChallengeAchv(
    "monoFighting",
    PokemonType.FIGHTING,
    "ribbon_fighting",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 2
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  MONO_FLYING: new MonoTypeChallengeAchv(
    "monoFlying",
    PokemonType.FLYING,
    "ribbon_flying",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 3
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  MONO_POISON: new MonoTypeChallengeAchv(
    "monoPoison",
    PokemonType.POISON,
    "ribbon_poison",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 4
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  MONO_GROUND: new MonoTypeChallengeAchv(
    "monoGround",
    PokemonType.GROUND,
    "ribbon_ground",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 5
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  MONO_ROCK: new MonoTypeChallengeAchv(
    "monoRock",
    PokemonType.ROCK,
    "ribbon_rock",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 6
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  MONO_BUG: new MonoTypeChallengeAchv(
    "monoBug",
    PokemonType.BUG,
    "ribbon_bug",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 7
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  MONO_GHOST: new MonoTypeChallengeAchv(
    "monoGhost",
    PokemonType.GHOST,
    "ribbon_ghost",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 8
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  MONO_STEEL: new MonoTypeChallengeAchv(
    "monoSteel",
    PokemonType.STEEL,
    "ribbon_steel",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 9
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  MONO_FIRE: new MonoTypeChallengeAchv(
    "monoFire",
    PokemonType.FIRE,
    "ribbon_fire",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 10
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  MONO_WATER: new MonoTypeChallengeAchv(
    "monoWater",
    PokemonType.WATER,
    "ribbon_water",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 11
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  MONO_GRASS: new MonoTypeChallengeAchv(
    "monoGrass",
    PokemonType.GRASS,
    "ribbon_grass",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 12
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  MONO_ELECTRIC: new MonoTypeChallengeAchv(
    "monoElectric",
    PokemonType.ELECTRIC,
    "ribbon_electric",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 13
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  MONO_PSYCHIC: new MonoTypeChallengeAchv(
    "monoPsychic",
    PokemonType.PSYCHIC,
    "ribbon_psychic",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 14
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  MONO_ICE: new MonoTypeChallengeAchv(
    "monoIce",
    PokemonType.ICE,
    "ribbon_ice",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 15
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  MONO_DRAGON: new MonoTypeChallengeAchv(
    "monoDragon",
    PokemonType.DRAGON,
    "ribbon_dragon",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 16
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  MONO_DARK: new MonoTypeChallengeAchv(
    "monoDark",
    PokemonType.DARK,
    "ribbon_dark",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 17
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  MONO_FAIRY: new MonoTypeChallengeAchv(
    "monoFairy",
    PokemonType.FAIRY,
    "ribbon_fairy",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 18
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  PASSIVES_CHALLENGE: new ChallengeAchv(
    "passives",
    "ability_capsule",
    100,
    c =>
      c instanceof PassivesChallenge
      && c.value > 0
      && !inverseAndFlipStatAchievementsBlock()
      && !randomizerChallengesAchvBlock(),
  ),
  UNEVOLVED_CLASSIC_VICTORY: new Achv("unevolvedClassicVictory", "eviolite", 50, () =>
    globalScene.getPlayerParty().some(p => speciesDataRegistry.hasEvolutions(p.getSpeciesForm(true).speciesId)),
  ),
  FLIP_INVERSE: new ChallengeAchv(
    "flipInverse",
    "inverse",
    50,
    ch =>
      ch instanceof FlipStatChallenge
      && ch.value > 0
      && globalScene.gameMode.challenges.some(c => c.id === Challenges.INVERSE_BATTLE && c.value > 0)
      && !randomizerChallengesAchvBlock(),
  ).setSecret(),
  BREEDERS_IN_SPACE: new Achv("breedersInSpace", "moon_stone", 50).setSecret(),
  // Local fork (2026-11-17): collecting marks and ribbons (the user: "증표를 수집 요소로 넣었으니까 업적에도 증표 수집
  // 관련을 넣어둡시다 / 10개의 우두머리 증표 수집, 100개의 우두머리 증표 수집, 모든 포켓몬의 우두머리 증표 수집 등등").
  // Counted when a Pokémon with the mark is caught or hatched, and when a ribbon is awarded (GameData.registerMarks).
  // New achievements go at the end: a secret one's parent is the entry before it.
  MARKS_10: new MarkCollectionAchv("marks10", PokemonMark.UNCOMMON_MARK, 25, () => countWildMarks() >= 10, 10),
  MARKS_100: new MarkCollectionAchv("marks100", PokemonMark.RARE_MARK, 75, () => countWildMarks() >= 100, 100),
  MARKS_ALL_KINDS: new MarkCollectionAchv("marksAllKinds", PokemonMark.CHARISMATIC_MARK, 100, () =>
    ALL_KINDS_MARKS.every(m => getMarkCount(m) > 0),
  ),
  ALPHA_MARKS_10: new MarkCollectionAchv(
    "alphaMarks10",
    PokemonMark.ALPHA_MARK,
    50,
    () => getMarkCount(PokemonMark.ALPHA_MARK) >= 10,
    10,
  ),
  ALPHA_MARKS_100: new MarkCollectionAchv(
    "alphaMarks100",
    PokemonMark.ALPHA_MARK,
    75,
    () => getMarkCount(PokemonMark.ALPHA_MARK) >= 100,
    100,
  ),
  ALPHA_MARKS_ALL_SPECIES: new MarkCollectionAchv("alphaMarksAllSpecies", PokemonMark.ALPHA_MARK, 150, () =>
    speciesDataRegistry
      .getAllStarters()
      .every(s => normalizeAlphaBoost(globalScene.gameData.starterData[s]?.alphaBoost) > 0),
  ),
  GOLDEN_ALPHA_MARK: new MarkCollectionAchv(
    "goldenAlphaMark",
    PokemonMark.GOLDEN_ALPHA_MARK,
    75,
    () => getMarkCount(PokemonMark.GOLDEN_ALPHA_MARK) >= 1,
  ),
  GOLDEN_ALPHA_MARKS_10: new MarkCollectionAchv(
    "goldenAlphaMarks10",
    PokemonMark.GOLDEN_ALPHA_MARK,
    100,
    () => getMarkCount(PokemonMark.GOLDEN_ALPHA_MARK) >= 10,
    10,
  ),
  GOLDEN_ALPHA_MARKS_ALL_SPECIES: new MarkCollectionAchv(
    "goldenAlphaMarksAllSpecies",
    PokemonMark.GOLDEN_ALPHA_MARK,
    150,
    () =>
      speciesDataRegistry
        .getAllStarters()
        .every(s => normalizeAlphaBoost(globalScene.gameData.starterData[s]?.alphaBoost) >= ALPHA_MAX_BOOST),
  ).setSecret(),
  MEMORIAL_RIBBON: new MarkCollectionAchv("memorialRibbon", PokemonMark.CHAMPION_RIBBON, 25, () =>
    CHAMPION_RIBBONS.some(m => getMarkCount(m) > 0),
  ),
  MEMORIAL_RIBBONS_ALL_KINDS: new MarkCollectionAchv("memorialRibbonsAllKinds", PokemonMark.LEGEND_RIBBON, 100, () =>
    CHAMPION_RIBBONS.every(m => getMarkCount(m) > 0),
  ),
  // Local fork (2026-11-17): the collection per Pokémon, the earned ribbons and the hidden marks
  MARK_DEX_ONE: new MarkCollectionAchv("markDexOne", PokemonMark.PARTNER_MARK, 150, () =>
    Object.values(globalScene.gameData.starterData).some(entry => isMarkCollectionComplete(getCollectedMarks(entry))),
  ),
  EFFORT_RIBBON: new MarkCollectionAchv(
    "effortRibbon",
    PokemonMark.EFFORT_RIBBON,
    50,
    () => getMarkCount(PokemonMark.EFFORT_RIBBON) > 0,
  ),
  HIDDEN_MARK: new MarkCollectionAchv(
    "hiddenMark",
    PokemonMark.ONCE_IN_A_LIFETIME_RIBBON,
    75,
    () => COMPLETION_EXEMPT_MARKS.some(m => getMarkCount(m) > 0) || hasEternatusMark(),
  ),
  MIGHTIEST_MARK: new MarkCollectionAchv(
    "mightiestMark",
    PokemonMark.MIGHTIEST_MARK,
    150,
    () => getMarkCount(PokemonMark.MIGHTIEST_MARK) > 0,
  ),
  ETERNATUS_MARK: new MarkCollectionAchv("eternatusMark", PokemonMark.ETERNATUS_MARK, 150, () => hasEternatusMark()),
  // Local fork (2026-11-18): Pokédex collections (the user: "업적이나 좀 추가해둡시다"), before the last one
  ANCIENT_GIANTS: new DexCollectionAchv("ancientGiants", "hard_stone", 50, () => [
    SpeciesId.REGIROCK,
    SpeciesId.REGICE,
    SpeciesId.REGISTEEL,
    SpeciesId.REGIGIGAS,
    SpeciesId.REGIELEKI,
    SpeciesId.REGIDRAGO,
  ]),
  DAWN_AND_DUSK: new DexCollectionAchv("dawnAndDusk", "n_solarizer", 50, () => [
    { speciesId: SpeciesId.NECROZMA, formKey: "dusk-mane" },
    { speciesId: SpeciesId.NECROZMA, formKey: "dawn-wings" },
  ]),
  TIME_SPACE_ANTIMATTER: new DexCollectionAchv("timeSpaceAntimatter", "griseous_core", 50, () => [
    SpeciesId.DIALGA,
    SpeciesId.PALKIA,
    SpeciesId.GIRATINA,
  ]),
  SEA_AND_LAND: new DexCollectionAchv("seaAndLand", "blue_orb", 50, () => [
    { speciesId: SpeciesId.KYOGRE, formKey: "primal" },
    { speciesId: SpeciesId.GROUDON, formKey: "primal" },
  ]),
  SKY_DRAGON: new DexCollectionAchv("skyDragon", "rayquazite", 50, () => [
    { speciesId: SpeciesId.RAYQUAZA, formKey: "mega" },
  ]),
  ULTRA_BEASTS: new DexCollectionAchv("ultraBeasts", "ub", 75, () => NON_LEGEND_ULTRA_BEASTS),
  PAST_AND_FUTURE: new DexCollectionAchv("pastAndFuture", "booster_energy", 75, () => [
    ...NON_LEGEND_PARADOX_POKEMON,
    SpeciesId.KORAIDON,
    SpeciesId.MIRAIDON,
  ]),
  LIFE_AND_DEATH: new DexCollectionAchv("lifeAndDeath", "life_orb", 50, () => [SpeciesId.XERNEAS, SpeciesId.YVELTAL]),
  RUINOUS_BEASTS: new DexCollectionAchv("ruinousBeasts", "dread_plate", 50, () => [
    SpeciesId.WO_CHIEN,
    SpeciesId.CHIEN_PAO,
    SpeciesId.TING_LU,
    SpeciesId.CHI_YU,
  ]),
  LEGENDARY_BIRDS: new DexCollectionAchv("legendaryBirds", "sharp_beak", 25, () => [
    SpeciesId.ARTICUNO,
    SpeciesId.ZAPDOS,
    SpeciesId.MOLTRES,
  ]),
  LEGENDARY_BEASTS: new DexCollectionAchv("legendaryBeasts", "sacred_ash", 25, () => [
    SpeciesId.RAIKOU,
    SpeciesId.ENTEI,
    SpeciesId.SUICUNE,
  ]),
  LAKE_GUARDIANS: new DexCollectionAchv("lakeGuardians", "mind_plate", 25, () => [
    SpeciesId.UXIE,
    SpeciesId.MESPRIT,
    SpeciesId.AZELF,
  ]),
  SWORDS_OF_JUSTICE: new DexCollectionAchv("swordsOfJustice", "fist_plate", 50, () => [
    SpeciesId.COBALION,
    SpeciesId.TERRAKION,
    SpeciesId.VIRIZION,
    SpeciesId.KELDEO,
  ]),
  GUARDIAN_DEITIES: new DexCollectionAchv("guardianDeities", "tapunium_z", 50, () => [
    SpeciesId.TAPU_KOKO,
    SpeciesId.TAPU_LELE,
    SpeciesId.TAPU_BULU,
    SpeciesId.TAPU_FINI,
  ]),
  TRUTH_AND_IDEALS: new DexCollectionAchv("truthAndIdeals", "light_stone", 25, () => [
    SpeciesId.RESHIRAM,
    SpeciesId.ZEKROM,
  ]),
  SWORD_AND_SHIELD: new DexCollectionAchv("swordAndShield", "rusted_sword", 25, () => [
    SpeciesId.ZACIAN,
    SpeciesId.ZAMAZENTA,
  ]),
  ALL_MYTHICAL: new DexCollectionAchv("allMythical", "golden_mystic_ticket", 100, () => getSpeciesWith("mythical")),
  ALL_SUB_LEGENDARY: new DexCollectionAchv("allSubLegendary", "soul_dew", 100, () => getSpeciesWith("subLegendary")),
  // Eternatus is left out: it can only be caught once every other Pokémon is (its own achievement, ETERNATUS_MARK)
  ALL_LEGENDARY: new DexCollectionAchv("allLegendary", "legend_plate", 100, () =>
    getSpeciesWith("legendary").filter(id => id !== SpeciesId.ETERNATUS),
  ),
  // Local fork (2026-11-19): a collection per type (the user: "새 업적으로 각 타입에 해당하는 포켓몬 수집을
  // 넣어둡시다"), in the order of the types, before the last one; the icons are the types' Tera Shards
  TYPE_COLLECTOR_NORMAL: new TypeCollectionAchv("typeCollectorNormal", PokemonType.NORMAL, "normal_tera_shard", 100),
  TYPE_COLLECTOR_FIGHTING: new TypeCollectionAchv(
    "typeCollectorFighting",
    PokemonType.FIGHTING,
    "fighting_tera_shard",
    100,
  ),
  TYPE_COLLECTOR_FLYING: new TypeCollectionAchv("typeCollectorFlying", PokemonType.FLYING, "flying_tera_shard", 100),
  TYPE_COLLECTOR_POISON: new TypeCollectionAchv("typeCollectorPoison", PokemonType.POISON, "poison_tera_shard", 100),
  TYPE_COLLECTOR_GROUND: new TypeCollectionAchv("typeCollectorGround", PokemonType.GROUND, "ground_tera_shard", 100),
  TYPE_COLLECTOR_ROCK: new TypeCollectionAchv("typeCollectorRock", PokemonType.ROCK, "rock_tera_shard", 100),
  TYPE_COLLECTOR_BUG: new TypeCollectionAchv("typeCollectorBug", PokemonType.BUG, "bug_tera_shard", 100),
  TYPE_COLLECTOR_GHOST: new TypeCollectionAchv("typeCollectorGhost", PokemonType.GHOST, "ghost_tera_shard", 100),
  TYPE_COLLECTOR_STEEL: new TypeCollectionAchv("typeCollectorSteel", PokemonType.STEEL, "steel_tera_shard", 100),
  TYPE_COLLECTOR_FIRE: new TypeCollectionAchv("typeCollectorFire", PokemonType.FIRE, "fire_tera_shard", 100),
  TYPE_COLLECTOR_WATER: new TypeCollectionAchv("typeCollectorWater", PokemonType.WATER, "water_tera_shard", 100),
  TYPE_COLLECTOR_GRASS: new TypeCollectionAchv("typeCollectorGrass", PokemonType.GRASS, "grass_tera_shard", 100),
  TYPE_COLLECTOR_ELECTRIC: new TypeCollectionAchv(
    "typeCollectorElectric",
    PokemonType.ELECTRIC,
    "electric_tera_shard",
    100,
  ),
  TYPE_COLLECTOR_PSYCHIC: new TypeCollectionAchv(
    "typeCollectorPsychic",
    PokemonType.PSYCHIC,
    "psychic_tera_shard",
    100,
  ),
  TYPE_COLLECTOR_ICE: new TypeCollectionAchv("typeCollectorIce", PokemonType.ICE, "ice_tera_shard", 100),
  TYPE_COLLECTOR_DRAGON: new TypeCollectionAchv("typeCollectorDragon", PokemonType.DRAGON, "dragon_tera_shard", 100),
  TYPE_COLLECTOR_DARK: new TypeCollectionAchv("typeCollectorDark", PokemonType.DARK, "dark_tera_shard", 100),
  TYPE_COLLECTOR_FAIRY: new TypeCollectionAchv("typeCollectorFairy", PokemonType.FAIRY, "fairy_tera_shard", 100),
  // Local fork (2026-11-17): the last one, hidden without a hint (the user: "숨겨진 업적(힌트도 안뜸)으로 히든 증표 +
  // 모든 업적 달성 시 완주 라던가 끝"): every hidden mark obtained and every other achievement unlocked. Checked
  // whenever another achievement unlocks (BattleScene.validateAchv). Keep it the last entry.
  THE_END: new MarkCollectionAchv(
    "theEnd",
    PokemonMark.ENDLESS_MASTER_RIBBON,
    200,
    (): boolean =>
      hasEternatusMark()
      && THE_END_MARKS.every(m => hasEverObtainedMark(m))
      && Object.keys(achvs).every(id => id === "THE_END" || Object.hasOwn(globalScene.gameData.achvUnlocks, id)),
  ).setSecret(),
};

/** Local fork (2026-11-18): the Pokédex collection achievements, checked when the Pokédex records something */
export const dexCollectionAchvs: readonly DexCollectionAchv[] = Object.values(achvs).filter(
  a => a instanceof DexCollectionAchv,
);

/** Local fork (2026-11-17): the achievements for collecting marks and ribbons, in the order they are checked */
export const markCollectionAchvs: readonly MarkCollectionAchv[] = Object.values(achvs).filter(
  a => a instanceof MarkCollectionAchv,
);

export function initAchievements() {
  const achvKeys = Object.keys(achvs);
  achvKeys.forEach((a, i) => {
    achvs[a].id = a;
    if (achvs[a].hasParent) {
      achvs[a].parentId = achvKeys[i - 1];
    }
  });
}
