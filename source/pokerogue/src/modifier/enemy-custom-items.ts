/**
 * Local fork (2026-11-10): enemy trainer Pokémon and wild bosses can come holding one of the fork's own held items
 * (the user: "보스와 트레이너에 추가하고").
 *
 * - Who: every Pokémon of a trainer battle, and a wild boss (`isBoss()`) in a wild battle. Ordinary wild Pokémon never
 *   get one. Mystery-encounter battles are left alone (their encounters choose their own items), and so is the Classic
 *   final boss (`generateEnemyModifiers` returns before any item is rolled for it).
 * - How often: one roll per eligible Pokémon, at the percent chance in {@linkcode ENEMY_CUSTOM_ITEMS}.chance (an
 *   ordinary trainer's Pokémon; a boss trainer's: gym leader, Elite Four, champion, evil-team boss...; a wild boss).
 *   A Pokémon that wins the roll gets ONE item, picked by weight among the candidates it can use
 *   ({@linkcode getEnemyCustomItemCandidates}: the minimum difficulty wave, the usability check, nothing it already
 *   holds). A Pokémon that is not eligible, or has no candidate, rolls nothing, so the seeded sequence is unchanged for
 *   it.
 * - Endless (Local fork 2026-11-10; the user: "커스텀 아이템이 나올 확률 + 최대 갯수는 엔드리스일 때 라운드가 점점 진행하며 확률을 높여보죠"): the chance
 *   rises with the wave and a Pokémon gets several slots, each rolled at that chance
 *   ({@linkcode ENEMY_CUSTOM_ITEMS}.endless, {@linkcode getEnemyCustomItemScaledChance},
 *   {@linkcode getEnemyCustomItemSlots}); the items in one Pokémon's slots are all different. Classic and the other
 *   modes keep one slot at the base chance.
 * - Trainer battles (Local fork 2026-11-12; the user: "트레이너전에서 커스텀 아이템 개수 하락"): a trainer's Pokémon rolls
 *   with its own, lower numbers ({@linkcode ENEMY_CUSTOM_ITEMS}.chance trainer / bossTrainer and .endless.trainer: a
 *   lower base chance, a slower and lower Endless rise, fewer slots); a wild boss keeps the numbers it had
 *   (.endless.wildBoss). Expected items per Pokémon in Endless (chance x slots), ordinary trainer: wave 300 0.38 (was
 *   0.60), 600 0.84 (1.80), 1000 1.60 (3.90), 1500 2.20 (5.40), 1700+ 2.40; boss trainer: 600 1.14 (2.40), 1000 2.00
 *   (4.80), 1500+ 2.40 (5.40).
 * - Choice cap (Local fork 2026-11-12; the user: "커스텀 아이템은 구애시리즈는 웬만해선 한개, 높은 웨이브에서만 객체당 두개
 *   가능. 합체형 아이템은 이전 기준 따르기"): one enemy Pokémon gets at most 1 Choice item (구애머리띠 / 구애안경 /
 *   구애스카프 / 구애갑옷), 2 from difficulty wave 1000 on ({@linkcode getEnemyChoiceItemLimit}); once it has that many,
 *   its later slots pick among the other items. The vessel items keep the earlier rule.
 * - Not offered: the empty vessels (Flame Cauldron 화염가마솥, Toxic Distiller 맹독증류기, Discharged Coil 방전코일) do
 *   nothing without their orb, and enemies never get the orbs; Forged Steel is an encounter reward that cannot be moved.
 *   Radioactive Waste goes only to a Poison type that stays Poison through its trainer's Tera, if any; the Evolution
 *   Crystals only in a run where the player can be offered them (the Eviolite's gate: not in Fresh Start, not before the
 *   Eviolite is unlocked, except in the Daily run).
 * - Unlock (Local fork 2026-11-12; the user: "저희 대부분의 커스텀 아이템과 커스텀 패시브는 클래식 클리어 후 해금으로
 *   하죠"): before the first Classic clear no enemy rolls any of these ({@linkcode rollEnemyCustomItems} returns at once,
 *   without a roll; `isForkContentUnlocked`, fork-unlock.ts).
 * - Hook: `BattleScene.generateEnemyModifiers` (battle-scene.ts), in the per-Pokémon branch that rolls random items,
 *   after upstream's roll; the item goes in through `addEnemyModifier`, so caps and `matchType` hold as for any item.
 *   The trainer and wild reward pools and their thresholds are unchanged.
 * - The items stay transferable, like every other enemy item: Grip Claw, Thief / Covet, Pickpocket, Magician... can take
 *   them (the full-item rule still applies to the player's thieves, `BattleScene.canTakeHeldItem`), and a caught wild
 *   boss brings its item along, as upstream does for every item an enemy holds (attempt-capture-phase.ts).
 *
 * Every tunable number is in {@linkcode ENEMY_CUSTOM_ITEMS}. Tests force the rolls through
 * {@linkcode enemyCustomItemDice} or call the pure {@linkcode pickEnemyCustomItem}.
 */

import { globalScene } from "#app/global-scene";
// Local fork (2026-11-12): no fork items before the first Classic clear
import { isForkContentUnlocked } from "#balance/fork-unlock";
import { modifierTypes } from "#data/data-lists";
import { BattleType } from "#enums/battle-type";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import {
  areEvolutionCrystalsAvailable,
  canEvolutionCrystalBoost,
  isRadioactiveWasteHealer,
} from "#modifiers/custom-held-items";
import type { PersistentModifier, PokemonHeldItemModifier } from "#modifiers/modifier";
import { randSeedInt } from "#utils/common";
import { isTeraBlockedForm, willTerastallize } from "#utils/pokemon-utils";

/**
 * Local fork (2026-11-11): vitamins (영양제, `BaseStatModifier`) that an enemy gets from its random items come several at
 * a time (the user: "적이 지니는 영양제 개수도 대폭 버프하죠"): {@linkcode baseStack} of them, one more every
 * {@linkcode extraEveryWaves} difficulty waves, still capped by the stat's IV like any vitamin
 * (`BattleScene.generateEnemyModifiers`, {@linkcode getEnemyVitaminStack}). Before, each roll gave one (+10%).
 */
export const ENEMY_VITAMINS = Object.freeze({
  baseStack: 3,
  extraEveryWaves: 100,
});

/**
 * Local fork (2026-11-11): how many of one vitamin an enemy gets per vitamin roll at `difficultyWave`
 * (wave 1-99: 3, 100-199: 4, 500: 8, 1000: 13; the stat's IV caps the total)
 */
export function getEnemyVitaminStack(difficultyWave: number): number {
  return ENEMY_VITAMINS.baseStack + Math.floor(Math.max(0, difficultyWave) / ENEMY_VITAMINS.extraEveryWaves);
}

/**
 * Local fork (2026-11-11): sets the stack of a vitamin an enemy just rolled to {@linkcode getEnemyVitaminStack}, or less
 * so its holder stays within the stat's IV cap with what it already holds.
 * @param vitamin - The new vitamin (`BaseStatModifier`), not yet added
 * @param enemyModifiers - The enemy's modifier list it will be added to
 * @param difficultyWave - The wave used for difficulty
 * @returns Whether there is room for at least one (`false`: skip it, as upstream's capped add would)
 */
export function sizeEnemyVitamin(
  vitamin: PokemonHeldItemModifier,
  enemyModifiers: readonly PersistentModifier[],
  difficultyWave: number,
): boolean {
  const held = enemyModifiers.find(m => m.match(vitamin));
  const room = vitamin.getMaxStackCount() - (held?.stackCount ?? 0);
  if (room <= 0) {
    return false;
  }
  vitamin.stackCount = Math.min(getEnemyVitaminStack(difficultyWave), room);
  return true;
}

/** Local fork (2026-11-10): the fork items an enemy trainer Pokémon or a wild boss can hold (modifier type ids) */
export type EnemyCustomItemId =
  | "LIFE_ORB"
  | "TRAINING_SHACKLES"
  | "RADIOACTIVE_WASTE"
  | "RED_EVOLUTION_CRYSTAL"
  | "BLUE_EVOLUTION_CRYSTAL"
  | "CHOICE_BAND"
  | "CHOICE_SPECS"
  | "CHOICE_SCARF"
  | "CHOICE_ARMOR"
  | "ASSAULT_VEST"
  | "BULLETPROOF_VEST"
  | "PRISM"
  | "ULTIMATE_GENE"
  | "FLAME_FURNACE"
  | "TOXIC_DISTILLATE"
  | "SUPERCONDUCTING_COIL";

/**
 * Local fork (2026-11-10): what a candidate needs of the Pokémon (or the battle) to be offered:
 * - `"poisonType"`: Radioactive Waste (방사성폐기물) would heal it ({@linkcode isRadioactiveWasteHealer}), not poison it,
 *   and still will after any Terastallization its trainer may give it ({@linkcode staysPoisonThroughTera});
 * - `"canEvolve"`: an Evolution Crystal would boost it ({@linkcode canEvolutionCrystalBoost}, the player pool's check),
 *   in a run where the player can be offered one too ({@linkcode areEvolutionCrystalsAvailable}: the Eviolite's gate);
 * - `"physical"`: its Attack base stat is at least its Sp. Atk base stat (Choice Band);
 * - `"special"`: its Sp. Atk base stat is higher than its Attack base stat (Choice Specs);
 * - `"doubleBattle"`: the battle is a double battle (Prism only splashes onto a partner).
 */
export type EnemyCustomItemRequirement = "poisonType" | "canEvolve" | "physical" | "special" | "doubleBattle";

/** Local fork (2026-11-10): one entry of {@linkcode ENEMY_CUSTOM_ITEMS}.candidates */
export interface EnemyCustomItemCandidate {
  /** The modifier type id */
  readonly id: EnemyCustomItemId;
  /** The weight among the candidates the Pokémon can use */
  readonly weight: number;
  /** The first difficulty wave (`gameMode.getWaveForDifficulty`) at which it is offered */
  readonly minWave: number;
  /** What it needs of the Pokémon or the battle, if anything ({@linkcode EnemyCustomItemRequirement}) */
  readonly requires?: EnemyCustomItemRequirement;
}

/**
 * Local fork (2026-11-12): which row of {@linkcode ENEMY_CUSTOM_ITEMS}.endless an eligible Pokémon rolls with: the
 * Pokémon of a trainer battle (ordinary or boss trainer) or a wild boss
 */
export type EnemyCustomItemBattleKind = "trainer" | "wildBoss";

/** Local fork (2026-11-12): one row of {@linkcode ENEMY_CUSTOM_ITEMS}.endless */
export interface EnemyCustomItemEndlessRule {
  /** The chance rises by `chanceStep` percentage points every this many waves */
  readonly chanceEveryWaves: number;
  readonly chanceStep: number;
  /** The highest the chance gets (percent) */
  readonly maxChance: number;
  /** One more slot every this many waves */
  readonly slotEveryWaves: number;
  /** The most slots one Pokémon gets */
  readonly maxSlots: number;
}

/**
 * Local fork (2026-11-10): every number of the fork items on enemy trainer Pokémon and wild bosses, in one place.
 * - `chance`: the percent chance (0-100) per eligible Pokémon to hold one fork item: `trainer` for an ordinary
 *   trainer's Pokémon, `bossTrainer` for a boss trainer's (`trainer.config.isBoss`), `wildBoss` for a wild boss
 *   (Local fork 2026-11-12: trainer 15 -> 10, boss trainer 30 -> 20; the user: "트레이너전에서 커스텀 아이템 개수 하락";
 *   the wild boss keeps 30);
 * - `candidates`: the items, in roll order, with their weight, minimum difficulty wave and requirement;
 * - `endless` (Local fork 2026-11-10): in Endless, the chance rises by `chanceStep` percentage points every
 *   `chanceEveryWaves` waves, up to `maxChance`, and a Pokémon gets one more slot every `slotEveryWaves` waves, up to
 *   `maxSlots`. Local fork (2026-11-12): one row per {@linkcode EnemyCustomItemBattleKind}: `wildBoss` keeps the old
 *   numbers (+5 per 100 waves up to 90%, a slot per 200 waves up to 6; wave 600: 60%, 4 slots), `trainer` is the
 *   trainer battles' own (+3 per 100 waves up to 60%, a slot per 300 waves up to 4; wave 600: an ordinary trainer's
 *   Pokémon 28%, a boss trainer's 38%, 3 slots);
 * - `choiceLimit` (Local fork 2026-11-12): how many Choice items (`ids`: 구애머리띠 / 구애안경 / 구애스카프 / 구애갑옷) one
 *   enemy Pokémon can hold: `max`, and `highWaveMax` from difficulty wave `highWave` on
 *   ({@linkcode getEnemyChoiceItemLimit}).
 */
export const ENEMY_CUSTOM_ITEMS = Object.freeze({
  // Local fork (2026-11-12): trainer 15 -> 10, bossTrainer 30 -> 20 (the user: "트레이너전에서 커스텀 아이템 개수 하락")
  chance: Object.freeze({
    trainer: 10,
    bossTrainer: 20,
    wildBoss: 30,
  }),
  endless: Object.freeze({
    // The wild bosses keep the numbers every eligible Pokémon had before 2026-11-12
    wildBoss: Object.freeze<EnemyCustomItemEndlessRule>({
      chanceEveryWaves: 100,
      chanceStep: 5,
      maxChance: 90,
      slotEveryWaves: 200,
      maxSlots: 6,
    }),
    // Local fork (2026-11-12): the trainer battles' own (before: the wild boss row), the user: "트레이너전에서 커스텀
    // 아이템 개수 하락"
    trainer: Object.freeze<EnemyCustomItemEndlessRule>({
      chanceEveryWaves: 100,
      chanceStep: 3,
      maxChance: 60,
      slotEveryWaves: 300,
      maxSlots: 4,
    }),
  }),
  // Local fork (2026-11-12): the user: "커스텀 아이템은 구애시리즈는 웬만해선 한개, 높은 웨이브에서만 객체당 두개 가능.
  // 합체형 아이템은 이전 기준 따르기". The vessel items (불꽃화로 / 맹독증류액 / 초전도코일) keep their old rule.
  choiceLimit: Object.freeze({
    ids: Object.freeze<readonly EnemyCustomItemId[]>(["CHOICE_BAND", "CHOICE_SPECS", "CHOICE_SCARF", "CHOICE_ARMOR"]),
    max: 1,
    highWave: 1000,
    highWaveMax: 2,
  }),
  candidates: Object.freeze<readonly EnemyCustomItemCandidate[]>([
    Object.freeze({ id: "LIFE_ORB", weight: 3, minWave: 40 }),
    Object.freeze({ id: "TRAINING_SHACKLES", weight: 2, minWave: 40 }),
    Object.freeze({ id: "RADIOACTIVE_WASTE", weight: 2, minWave: 40, requires: "poisonType" }),
    Object.freeze({ id: "RED_EVOLUTION_CRYSTAL", weight: 2, minWave: 20, requires: "canEvolve" }),
    Object.freeze({ id: "BLUE_EVOLUTION_CRYSTAL", weight: 2, minWave: 20, requires: "canEvolve" }),
    Object.freeze({ id: "CHOICE_BAND", weight: 1, minWave: 70, requires: "physical" }),
    Object.freeze({ id: "CHOICE_SPECS", weight: 1, minWave: 70, requires: "special" }),
    Object.freeze({ id: "CHOICE_SCARF", weight: 1, minWave: 70 }),
    Object.freeze({ id: "CHOICE_ARMOR", weight: 1, minWave: 70 }),
    Object.freeze({ id: "ASSAULT_VEST", weight: 1, minWave: 70 }),
    Object.freeze({ id: "BULLETPROOF_VEST", weight: 1, minWave: 70 }),
    Object.freeze({ id: "PRISM", weight: 1, minWave: 70, requires: "doubleBattle" }),
    Object.freeze({ id: "ULTIMATE_GENE", weight: 1, minWave: 70 }),
    Object.freeze({ id: "FLAME_FURNACE", weight: 1, minWave: 70 }),
    Object.freeze({ id: "TOXIC_DISTILLATE", weight: 1, minWave: 70 }),
    Object.freeze({ id: "SUPERCONDUCTING_COIL", weight: 1, minWave: 70 }),
  ]),
});

/** Local fork (2026-11-10): whether the Pokémon's Attack base stat is at least its Sp. Atk base stat */
function isPhysicalAttacker(pokemon: Pokemon): boolean {
  // The current form's base stats (a fusion's averaged), the numbers `calculateStats` starts from: read fresh, so a form
  // a trainer slot set after the stats were computed (a Mega...) counts
  const baseStats = pokemon.calculateBaseStats();
  return baseStats[Stat.ATK] >= baseStats[Stat.SPATK];
}

/**
 * Local fork (2026-11-10), review fix: whether `pokemon` stays a Poison type through any Terastallization its trainer
 * may give it in this battle, so Radioactive Waste keeps healing it instead of poisoning it. Items are rolled before
 * `Trainer.genAI` picks the random instant-Tera Pokémon (gym leaders, the Elite Four: `setRandomTeraModifiers`, the only
 * `genAIFuncs`), so which one it picks is unknown here and every Pokémon of such a trainer counts as a candidate:
 * - an instant-Tera Pokémon already known (`willTerastallize`: a rival's starter, a champion's slot...) takes its own Tera
 *   type;
 * - a trainer with random Tera picks (`genAIFuncs`) may give any Pokémon its specialty type (else the Pokémon's own);
 * - a Poison or Stellar Tera type keeps it Poison for the Waste (Stellar keeps the original types);
 * - a wild Pokémon, the player's, or one in a form that cannot Terastallize (`isTeraBlockedForm`: Mega, Gigantamax...)
 *   never changes type this way.
 */
function staysPoisonThroughTera(pokemon: Pokemon): boolean {
  const { trainer } = globalScene.currentBattle;
  if (!trainer || pokemon.isPlayer() || !pokemon.hasTrainer() || isTeraBlockedForm(pokemon)) {
    return true;
  }
  const { config } = trainer;
  const teraTypes: PokemonType[] = [];
  if (willTerastallize(pokemon)) {
    teraTypes.push(pokemon.teraType);
  }
  if (config.genAIFuncs.length > 0) {
    teraTypes.push(config.hasSpecialtyType() ? config.specialtyType : pokemon.teraType);
  }
  return teraTypes.every(type => type === PokemonType.POISON || type === PokemonType.STELLAR);
}

/** Local fork (2026-11-10): the check behind each {@linkcode EnemyCustomItemRequirement} */
const REQUIREMENT_CHECKS: Readonly<Record<EnemyCustomItemRequirement, (pokemon: Pokemon, double: boolean) => boolean>> =
  Object.freeze({
    // Local fork (2026-11-10), review fix: and still Poison after its trainer's Tera, if any (staysPoisonThroughTera)
    poisonType: pokemon => isRadioactiveWasteHealer(pokemon) && staysPoisonThroughTera(pokemon),
    // Local fork (2026-11-10), review fix: only where the player can get crystals too (Fresh Start, Eviolite lock)
    canEvolve: pokemon => areEvolutionCrystalsAvailable() && canEvolutionCrystalBoost(pokemon),
    physical: pokemon => isPhysicalAttacker(pokemon),
    special: pokemon => !isPhysicalAttacker(pokemon),
    doubleBattle: (_pokemon, double) => double,
  });

/**
 * Local fork (2026-11-10): a new fork held item of type `id` for `pokemon`, its type carrying its tier in the player's
 * reward pool (the Flame Furnace, Toxic Distillate and Superconducting Coil, in no pool, keep their own MASTER tier),
 * as upstream's enemy items carry their pool's tier.
 */
export function newEnemyCustomItem(id: EnemyCustomItemId, pokemon: Pokemon): PokemonHeldItemModifier {
  const typeFunc = modifierTypes[id];
  const type = typeFunc().withIdFromFunc(typeFunc).withTierFromPool(ModifierPoolType.PLAYER);
  return type.newModifier(pokemon) as PokemonHeldItemModifier;
}

/**
 * Local fork (2026-11-12): which numbers `pokemon` rolls with in the current battle: `"trainer"` for any Pokémon of a
 * trainer battle, `"wildBoss"` for a wild boss in a wild battle, `null` (no roll) for an ordinary wild Pokémon and in
 * mystery-encounter battles.
 */
export function getEnemyCustomItemBattleKind(pokemon: Pokemon): EnemyCustomItemBattleKind | null {
  const { battleType, trainer } = globalScene.currentBattle;
  if (battleType === BattleType.TRAINER && trainer) {
    return "trainer";
  }
  if (battleType === BattleType.WILD && pokemon.isBoss()) {
    return "wildBoss";
  }
  return null;
}

/**
 * Local fork (2026-11-10): the percent chance that `pokemon` comes holding a fork item in the current battle
 * ({@linkcode ENEMY_CUSTOM_ITEMS}.chance): any Pokémon of a trainer battle (more for a boss trainer's), a wild boss in a
 * wild battle; 0 for an ordinary wild Pokémon and in mystery-encounter battles.
 */
export function getEnemyCustomItemChance(pokemon: Pokemon): number {
  const { chance } = ENEMY_CUSTOM_ITEMS;
  switch (getEnemyCustomItemBattleKind(pokemon)) {
    case "trainer":
      return globalScene.currentBattle.trainer?.config.isBoss ? chance.bossTrainer : chance.trainer;
    case "wildBoss":
      return chance.wildBoss;
    default:
      return 0;
  }
}

/** Local fork (2026-11-12): whether the modifier type id `id` is one of the Choice items of {@linkcode ENEMY_CUSTOM_ITEMS} */
function isEnemyChoiceItemId(id: string): boolean {
  return (ENEMY_CUSTOM_ITEMS.choiceLimit.ids as readonly string[]).includes(id);
}

/**
 * Local fork (2026-11-12): how many Choice items (구애머리띠 / 구애안경 / 구애스카프 / 구애갑옷) one enemy Pokémon can hold
 * at `difficultyWave` ({@linkcode ENEMY_CUSTOM_ITEMS}.choiceLimit): 1, and 2 from difficulty wave 1000 on. The user:
 * "커스텀 아이템은 구애시리즈는 웬만해선 한개, 높은 웨이브에서만 객체당 두개 가능".
 * @param difficultyWave - The wave for difficulty (`gameMode.getWaveForDifficulty`)
 */
export function getEnemyChoiceItemLimit(difficultyWave: number): number {
  const { max, highWave, highWaveMax } = ENEMY_CUSTOM_ITEMS.choiceLimit;
  return difficultyWave >= highWave ? highWaveMax : max;
}

/**
 * Local fork (2026-11-10): the candidates of {@linkcode ENEMY_CUSTOM_ITEMS} that `pokemon` can be given, in table order:
 * offered from `difficultyWave` on, its requirement met, and not matching (`matchType`) an item it already holds.
 * Local fork (2026-11-12): and no Choice item once it holds (or was just picked) as many Choice items as
 * {@linkcode getEnemyChoiceItemLimit} allows; the other candidates, the vessel items among them, are unchanged.
 * @param pokemon - The Pokémon that would hold the item
 * @param difficultyWave - The wave for difficulty (`gameMode.getWaveForDifficulty`)
 * @param double - Whether the battle is a double battle
 * @param alsoHeld - Items already picked for it but not added yet (Local fork 2026-11-10: the Endless slots)
 */
export function getEnemyCustomItemCandidates(
  pokemon: Pokemon,
  difficultyWave: number,
  double: boolean,
  alsoHeld: readonly PokemonHeldItemModifier[] = [],
): EnemyCustomItemCandidate[] {
  const held = [...pokemon.getHeldItems(), ...alsoHeld];
  // Local fork (2026-11-12): the Choice cap ("구애시리즈는 웬만해선 한개, 높은 웨이브에서만 객체당 두개 가능")
  const choiceFull = held.filter(h => isEnemyChoiceItemId(h.type.id)).length >= getEnemyChoiceItemLimit(difficultyWave);
  return ENEMY_CUSTOM_ITEMS.candidates.filter(candidate => {
    if (difficultyWave < candidate.minWave) {
      return false;
    }
    if (choiceFull && isEnemyChoiceItemId(candidate.id)) {
      return false;
    }
    if (candidate.requires && !REQUIREMENT_CHECKS[candidate.requires](pokemon, double)) {
      return false;
    }
    if (held.length === 0) {
      return true;
    }
    const typeFunc = modifierTypes[candidate.id];
    const item = typeFunc().withIdFromFunc(typeFunc).newModifier(pokemon) as PokemonHeldItemModifier;
    return !held.some(h => item.matchType(h));
  });
}

/**
 * Local fork (2026-11-10): the pure pick, given the two rolls.
 * @param chance - The percent chance ({@linkcode getEnemyCustomItemChance})
 * @param candidates - What the Pokémon can be given ({@linkcode getEnemyCustomItemCandidates})
 * @param chanceRoll - A roll in [0, 100): the Pokémon gets an item when it is below `chance`
 * @param weightRoll - A roll in [0, total weight of `candidates`): picks the candidate by weight, in order
 * @returns The id of the item to give, or `null` when the chance roll fails or there is no candidate
 */
export function pickEnemyCustomItem(
  chance: number,
  candidates: readonly EnemyCustomItemCandidate[],
  chanceRoll: number,
  weightRoll: number,
): EnemyCustomItemId | null {
  if (candidates.length === 0 || chanceRoll >= chance) {
    return null;
  }
  let rest = weightRoll;
  for (const candidate of candidates) {
    if (rest < candidate.weight) {
      return candidate.id;
    }
    rest -= candidate.weight;
  }
  return candidates.at(-1)!.id;
}

/**
 * Local fork (2026-11-10): the seeded roller for both rolls of {@linkcode rollEnemyCustomItem} (`roll(range)` returns an
 * integer in [0, range)). A test hook: tests stub `roll` with `vi.spyOn(enemyCustomItemDice, "roll")` to force an
 * outcome; game code never replaces it. Kept apart from {@linkcode ENEMY_CUSTOM_ITEMS}, which stays frozen.
 */
export const enemyCustomItemDice = {
  roll: (range: number): number => randSeedInt(range),
};

/**
 * Local fork (2026-11-10): the chance after the Endless rise ({@linkcode ENEMY_CUSTOM_ITEMS}.endless): unchanged outside
 * Endless or when `baseChance` is 0; in Endless `baseChance` plus `chanceStep` every `chanceEveryWaves` waves, up to
 * `maxChance` (never below `baseChance`). The user: "커스텀 아이템이 나올 확률 + 최대 갯수는 엔드리스일 때 라운드가 점점 진행하며 확률을 높여보죠".
 * Local fork (2026-11-12): with the row of `kind` (a trainer battle's are lower: "트레이너전에서 커스텀 아이템 개수 하락").
 * @param baseChance - The percent chance before the rise ({@linkcode getEnemyCustomItemChance})
 * @param wave - The wave for difficulty
 * @param endless - Whether the run is an Endless run (`gameMode.isEndless`)
 * @param kind - Whose numbers ({@linkcode getEnemyCustomItemBattleKind})
 */
export function getEnemyCustomItemScaledChance(
  baseChance: number,
  wave: number,
  endless: boolean,
  kind: EnemyCustomItemBattleKind,
): number {
  if (!endless || baseChance <= 0) {
    return baseChance;
  }
  const { chanceEveryWaves, chanceStep, maxChance } = ENEMY_CUSTOM_ITEMS.endless[kind];
  return Math.max(baseChance, Math.min(maxChance, baseChance + Math.floor(wave / chanceEveryWaves) * chanceStep));
}

/**
 * Local fork (2026-11-10): how many fork items one enemy Pokémon can get: 1, and in Endless one more every
 * `slotEveryWaves` waves, up to `maxSlots` ({@linkcode ENEMY_CUSTOM_ITEMS}.endless).
 * Local fork (2026-11-12): with the row of `kind` (a trainer battle's: one more every 300 waves, up to 4).
 * @param wave - The wave for difficulty
 * @param endless - Whether the run is an Endless run (`gameMode.isEndless`)
 * @param kind - Whose numbers ({@linkcode getEnemyCustomItemBattleKind})
 */
export function getEnemyCustomItemSlots(wave: number, endless: boolean, kind: EnemyCustomItemBattleKind): number {
  if (!endless) {
    return 1;
  }
  const { slotEveryWaves, maxSlots } = ENEMY_CUSTOM_ITEMS.endless[kind];
  return Math.max(1, Math.min(maxSlots, 1 + Math.floor(wave / slotEveryWaves)));
}

/**
 * Local fork (2026-11-10): rolls which fork items `pokemon` comes holding; called once per enemy Pokémon by
 * `BattleScene.generateEnemyModifiers`. One slot (several in Endless, {@linkcode getEnemyCustomItemSlots}), each rolled
 * at the chance ({@linkcode getEnemyCustomItemScaledChance}); every slot picks among the candidates left, so no item
 * comes twice, and no Choice item past {@linkcode getEnemyChoiceItemLimit} (Local fork 2026-11-12). Nothing is rolled
 * when its chance is 0 or it has no candidate left.
 * @param pokemon - The enemy Pokémon
 * @param difficultyWave - The wave for difficulty (`gameMode.getWaveForDifficulty`)
 * @returns The new items for `pokemon` (not yet added), possibly none
 */
export function rollEnemyCustomItems(pokemon: Pokemon, difficultyWave: number): PokemonHeldItemModifier[] {
  // Local fork (2026-11-12): nothing, and no roll, before the first Classic clear (fork-unlock.ts; the user: "저희
  // 대부분의 커스텀 아이템과 커스텀 패시브는 클래식 클리어 후 해금으로 하죠")
  if (!isForkContentUnlocked()) {
    return [];
  }
  // Local fork (2026-11-12): a trainer's Pokémon and a wild boss roll with their own numbers ("트레이너전에서 커스텀
  // 아이템 개수 하락")
  const kind = getEnemyCustomItemBattleKind(pokemon);
  const baseChance = getEnemyCustomItemChance(pokemon);
  if (!kind || baseChance <= 0) {
    return [];
  }
  const endless = globalScene.gameMode.isEndless;
  const chance = getEnemyCustomItemScaledChance(baseChance, difficultyWave, endless, kind);
  const slots = getEnemyCustomItemSlots(difficultyWave, endless, kind);
  const picked: PokemonHeldItemModifier[] = [];
  for (let slot = 0; slot < slots; slot++) {
    const candidates = getEnemyCustomItemCandidates(pokemon, difficultyWave, globalScene.currentBattle.double, picked);
    if (candidates.length === 0) {
      break;
    }
    const chanceRoll = enemyCustomItemDice.roll(100);
    if (chanceRoll >= chance) {
      continue;
    }
    const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
    const id = pickEnemyCustomItem(chance, candidates, chanceRoll, enemyCustomItemDice.roll(totalWeight));
    if (id) {
      picked.push(newEnemyCustomItem(id, pokemon));
    }
  }
  return picked;
}
