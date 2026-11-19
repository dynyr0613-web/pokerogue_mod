/**
 * Local fork (2026-11-13) experiment harness, skipped unless FORK_SIM is set:
 *   FORK_SIM=1 npx vitest run test/tests/custom/sim/sim-5850-ace-economy.test.ts
 *
 * Monte Carlo of how fast an ace-focused player caps the ace's growth items in Endless, wave 1 to 5850, with the REAL
 * reward code: every non-multiple-of-10 wave runs the same calls as `SelectModifierPhase` (`resetSeed(wave)`,
 * `regenerateModifierPoolThresholds(party, PLAYER, rerollCount)`, 3 + Golden Poké Ball slots,
 * `getPlayerModifierTypeOptions`, rerolls at `computeRerollCost`), the pick is applied with `newModifier(...)` +
 * `addModifier` like the UI does, so the dynamic weights, caps and "stops appearing once one Pokémon holds the cap"
 * rules act by themselves. Multiples of 10 give the fixed rewards of `VictoryPhase` (Exp. Share, Exp. Charms, Golden
 * Poké Balls up to wave 450) and, every 50 waves, the enemy buff tokens of `AddEnemyBuffModifierPhase` (so the Piercing
 * Token's "enemy has a Protection Token" condition is real). Battles are skipped (every wave is won).
 *
 * Approximations: mystery encounter waves are treated as ordinary reward screens; the shop is ignored; consumables
 * (candies, Candy Pile, TMs, potions...) are counted, not applied; lures / X items / Dire Hit are counted as used up
 * (they would lapse after a few battles); party HP and PP stay full (no potion-type fillers in the COMMON / GREAT
 * pools); money comes from a simple trainer model (gym waves + 1/8 of the eligible waves, 2.5x / 1.4x wave money, Amulet
 * Coin applied), Honey Gather (0.2x wave money per battle, experts) and Nugget picks; EVs grow by 1 per wild wave and by
 * the trainer's party size on trainer waves; Pickup, the Lock Capsule and item transfers are not modelled.
 *
 * Local fork (2026-11-13), for the 08 명세 3번 measurement: the policy takes the Candy Jar (party cap 99, the prerequisite
 * of Candy Pile levels), and every Candy Pile / Rare Candy / Rarer Candy pick is counted as levels on the ace with
 * J = Candy Jars held at that moment (7 + 2J via the real `candyPileLevels`, 1 + J, 1 + J). Rare and Rarer Candies are
 * neutral picks (after the money while rerolls are still wanted, before it afterwards). `aceLevel` models the ace's
 * level: every wave EXP lifts it to the EXP level cap (`getMaxExpLevel`) if it is below, candies add on top. The reward
 * screen's duplicate check is fixed in the game since 08 명세 3번, so FORK_SIM_GROUP_FIX changes nothing any more.
 * Local fork (2026-11-18): from Endless wave 1000 the cap is lifted ("1000웨이브 이후는 레벨캡은 그냥 풉시다") and
 * `getMaxExpLevel` gives Number.MAX_SAFE_INTEGER, so the model reads the wave's cap formula instead
 * (`getWaveLevelCap`, the expected level C): wave EXP still lifts the ace to C, and past C it adds about nothing
 * (about 240 kills a level at C on wave 1000, about 17,800 at wave 5850; 11_레벨_따라가기_양방향.md 4-3).
 *
 * Local fork (2026-11-13), 09 명세 4번 (3차): the new GREAT party item 방호 토큰 (`GUARD_TOKEN`, up to 65, weight 4 while
 * the enemy side holds a Damage Token) joins the ace policy (FORK_SIM_GUARD, default "after-vitamins": right after the
 * five vitamins, before the Clover Leaf; the player keeps rerolling for it like for the 99-stack items until it is
 * full). "off" is the policy before (it is taken only by an off-policy pick; the 09 run's baseline), "nopool" also
 * takes its pool weight away (the reward pools as they were before the 3rd patch). Every reward slot is counted by
 * tier per wave bucket, and the GREAT pool's total weight and the token's weight are logged at the snapshot waves
 * (RNG state saved and restored around it), to check the spec's "슈퍼 칸의 약 9.8%(전체 보상 칸의 약 2.5~3.3%)".
 *
 * Speed (same results): i18next.t and the `name` getters of the modifier types are memoized, `getHeldItems` and
 * `getCompatibleTms` cached (`installCaches`), and the call history of the test framework's override spies is cleared
 * every 100 waves (it would otherwise grow by ~0.1 MB per screen and run the heap out at ~30k screens). An expert run
 * to 5850 (~35k screens with rerolls) takes ~3-4 min, a novice run ~1 min.
 *
 * Env:
 *   FORK_SIM_PROFILES  comma list of novice,intermediate,expert9,expert14 (default all four)
 *   FORK_SIM_RUNS      runs per profile (default 20); FORK_SIM_RUN_OFFSET first seed index (parallel processes)
 *   FORK_SIM_MAX_WAVE  last wave (default 5850)
 *   FORK_SIM_OUT       directory for the JSON + text output (default: the OS temp dir)
 *   FORK_SIM_MERGE=1   summarize the JSON files already in FORK_SIM_OUT (per profile) instead of running
 *   FORK_SIM_REROLL_CAP_EXPERT  override the experts' rerolls per screen (default 10)
 *   FORK_SIM_GUARD     after-vitamins (default) | first (top of the GREAT picks) | last (filler) | off | nopool
 *   FORK_SIM_ZMAX=take also take the Z-Ring, Max Mushrooms and the Mark Charm (added after this policy; ZMAX_TAKE)
 *   FORK_SIM_DEBUG / FORK_SIM_MEMLOG / FORK_SIM_CPUPROF=<file> / FORK_SIM_HEAPPROF=<file>  diagnostics
 */
import { getGameMode } from "#app/game-mode";
import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BerryType } from "#enums/berry-type";
import { FormChangeItem } from "#enums/form-change-item";
import { GameModes } from "#enums/game-modes";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { type PermanentStat, Stat } from "#enums/stat";
import { UiMode } from "#enums/ui-mode";
import { Unlockables } from "#enums/unlockables";
import { PlayerPokemon, type Pokemon, Pokemon as PokemonClass } from "#field/pokemon";
import { candyJarBonus, candyPileLevels } from "#modifiers/custom-consumables";
import { EvItemModifier } from "#modifiers/custom-held-items";
// Local fork (2026-11-13): 방호 토큰 (09 명세 4번)
import { enemyHoldsDamageToken, GUARD_TOKEN_RULES } from "#modifiers/enemy-damage-tokens";
import { getEvCap } from "#modifiers/ev-items"; // Local fork (2026-11-13): HP's EV cap 504
import {
  EnemyPersistentModifier,
  ExtraModifierModifier,
  LapsingPersistentModifier,
  MoneyMultiplierModifier,
  PersistentModifier,
  PokemonFormChangeItemModifier,
  PokemonHeldItemModifier,
  TempExtraModifierModifier,
} from "#modifiers/modifier";
import * as ModifierTypeModule from "#modifiers/modifier-type";
import {
  AttackTypeBoosterModifierType,
  BaseStatBoosterModifierType,
  BerryModifierType,
  FormChangeItemModifierType,
  type GeneratedPersistentModifierType,
  getEnemyBuffModifierForWave,
  getPartyLuckValue,
  getPlayerModifierTypeOptions,
  IvCandyModifierType,
  type ModifierType,
  ModifierTypeGenerator,
  type ModifierTypeOption,
  PokemonHeldItemModifierType,
  PokemonModifierType,
  regenerateModifierPoolThresholds,
  SpeciesStatBoosterModifierType,
  type WeightedModifierType,
} from "#modifiers/modifier-type";
import { computeRerollCost } from "#modifiers/reroll-cost";
import { PokemonMove } from "#moves/pokemon-move";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import type { Variant } from "#sprites/variant";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import { NumberHolder } from "#utils/common";
import { getModifierPoolForType } from "#utils/modifier-utils";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { Session } from "node:inspector";
import { tmpdir } from "node:os";
import { join } from "node:path";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------------------------------------------------
// Profiles

type ProfileName = "novice" | "intermediate" | "expert9" | "expert14";

interface Profile {
  readonly name: ProfileName;
  /** Shiny luck of the party (6 members), before clovers */
  readonly shinyLuck: readonly number[];
  /** Chance that the final pick of a screen is a uniformly random option instead of the policy's best */
  readonly mistakeRate: number;
  /** Most rerolls per screen (only on a screen with nothing useful for the ace, and only if the money is there) */
  readonly rerollCap: number;
  /** Chance that the player rerolls at all on a screen with nothing useful */
  readonly rerollChance: number;
  /** A Honey Gather support: 0.2x wave money after every battle */
  readonly honeyGather: boolean;
  /** Takes the Dynamax Band (36 ROGUE weight) right after the ROGUE ace items, to clean the pool */
  readonly poolCleaning: boolean;
}

const EXPERT_REROLL_CAP = Number(process.env.FORK_SIM_REROLL_CAP_EXPERT ?? 10);

const PROFILES: Record<ProfileName, Profile> = {
  novice: {
    name: "novice",
    shinyLuck: [0, 0, 0, 0, 0, 0],
    mistakeRate: 0.3,
    rerollCap: 1,
    rerollChance: 0.1,
    honeyGather: false,
    poolCleaning: false,
  },
  intermediate: {
    name: "intermediate",
    shinyLuck: [2, 2, 0, 0, 0, 0],
    mistakeRate: 0.1,
    rerollCap: 3,
    rerollChance: 1,
    honeyGather: false,
    poolCleaning: false,
  },
  expert9: {
    name: "expert9",
    shinyLuck: [2, 2, 2, 1, 1, 1],
    mistakeRate: 0,
    rerollCap: EXPERT_REROLL_CAP,
    rerollChance: 1,
    honeyGather: true,
    poolCleaning: true,
  },
  expert14: {
    name: "expert14",
    shinyLuck: [3, 3, 2, 2, 2, 2],
    mistakeRate: 0,
    rerollCap: EXPERT_REROLL_CAP,
    rerollChance: 1,
    honeyGather: true,
    poolCleaning: true,
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// The ace policy: an ordered preference, rarest tier first, damage before bulk before the rest. Keys are `itemKey`s.

/** The ace: Garchomp (pseudo-legendary with a Mega), physical, IVs 31 */
const ACE_SPECIES = SpeciesId.GARCHOMP;
const ACE_MOVES = [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.SCALE_SHOT, MoveId.FIRE_FANG];
const ACE_STONE_KEY = `FORM_${FormChangeItem[FormChangeItem.GARCHOMPITE]}`;
/** Supports: Baton Pass, Pickup, Wish/heal, screens, Spore; no attacking move but Extreme Speed */
const SUPPORTS: readonly { species: SpeciesId; moves: MoveId[] }[] = [
  { species: SpeciesId.NINJASK, moves: [MoveId.BATON_PASS, MoveId.SWORDS_DANCE, MoveId.PROTECT, MoveId.SUBSTITUTE] },
  { species: SpeciesId.LINOONE, moves: [MoveId.EXTREME_SPEED, MoveId.BELLY_DRUM, MoveId.PROTECT, MoveId.REST] },
  { species: SpeciesId.BLISSEY, moves: [MoveId.SOFT_BOILED, MoveId.WISH, MoveId.PROTECT, MoveId.HEAL_BELL] },
  { species: SpeciesId.KLEFKI, moves: [MoveId.SPIKES, MoveId.THUNDER_WAVE, MoveId.REFLECT, MoveId.LIGHT_SCREEN] },
  { species: SpeciesId.SMEARGLE, moves: [MoveId.SPORE, MoveId.STICKY_WEB, MoveId.SPIKES, MoveId.BATON_PASS] },
];

const PARTY_NATURES = [Nature.ADAMANT, Nature.JOLLY, Nature.JOLLY, Nature.BOLD, Nature.CALM, Nature.TIMID];

/** Party items (not held) the ace policy takes */
const PARTY_ITEM_KEYS = new Set([
  "MEGA_BRACELET",
  "GOLDEN_FOUR_LEAF_CLOVER",
  "FOUR_LEAF_CLOVER",
  "FOUR_LEAF_CLOVER_LEAF",
  "PIERCING_TOKEN",
  "AMULET_COIN",
  "DYNAMAX_BAND",
  // Local fork (2026-11-13): 사탕단지 (party cap 99), the prerequisite of Candy Pile levels (08 명세 3번 measurement)
  "CANDY_JAR",
  // Local fork (2026-11-13): 방호 토큰 (party cap 65, 09 명세 4번); in the priority only when FORK_SIM_GUARD takes it
  "GUARD_TOKEN",
  // Local fork (2026-11-19): Z링 (a key item like the Dynamax Band); in the priority only with FORK_SIM_ZMAX=take
  "Z_RING",
]);

/**
 * Local fork (2026-11-13): where the policy takes the 방호 토큰 (GREAT, party item, 09 명세 4번): "after-vitamins" (the
 * default: a vitamin adds ~2% of a stat to the ace, a token 0.5% less damage to everyone), "first" (before the vitamins),
 * "last" (after the IV candies, and only as filler: a screen with nothing better is still rerolled while growth items
 * are left), "off" (not at all, only by an off-policy pick: the policy before the 3rd patch) or "nopool" ("off", and its
 * pool weight is 0 as before the 3rd patch)
 */
type GuardMode = "after-vitamins" | "first" | "last" | "off" | "nopool";
const GUARD_MODE = (process.env.FORK_SIM_GUARD ?? "after-vitamins") as GuardMode;
/** Whether the player keeps rerolling until the 방호 토큰 is full too (it joins LAST_CAPS) */
const GUARD_KEEPS_REROLLING = GUARD_MODE === "after-vitamins" || GUARD_MODE === "first";
/**
 * Local fork (2026-11-19), 1.2.0 re-run (C4): FORK_SIM_ZMAX=take makes the player take the reward entries added after
 * this policy was written (11-13) that otherwise stay in the pools for the whole run: the Z링 (Z-Ring, ROGUE, a key
 * item up to weight 36, gone once owned, like the Dynamax Band), the 다이버섯 (Max Mushrooms, offered by the 24-weight
 * ROGUE rare form-change entry while the player has the Dynamax Band and a party member holds none, 11-18) and the
 * 증표부적 (Mark Charm, MASTER 14, 11-17). Experts take the first two in their pool cleaning (after the Dynamax Band),
 * everyone takes all three as neutral picks (the Z-Ring and Max Mushrooms after the Dynamax Band, the Mark Charm after
 * the Shiny Charm); Max Mushrooms go to the first member without them, the ace first. Without it (the default) the
 * policy is the 11-13 one: in a 1.2.0 expert run the Z-Ring alone was a third of the ROGUE slots and Candy Piles came
 * up about 600 times instead of ~1,800.
 */
const ZMAX_TAKE = process.env.FORK_SIM_ZMAX === "take";
/** Local fork (2026-11-19): the reward key of Max Mushrooms (`itemKey` of its form-change item type) */
const MAX_MUSHROOMS_KEY = `FORM_${FormChangeItem[FormChangeItem.MAX_MUSHROOMS]}`;
/** Consumables the ace policy takes (counted, not applied) */
const ACE_CONSUMABLE_KEYS = new Set(["CANDY_PILE"]);
/**
 * Local fork (2026-11-13): candies whose levels go to the ace (counted, not applied), with J = Candy Jars held at the
 * pick: Candy Pile 7 + 2J (the real `candyPileLevels().target`), Rare Candy 1 + J, Rarer Candy 1 + J (every member)
 */
const CANDY_LEVEL_KEYS = new Set(["CANDY_PILE", "RARE_CANDY", "RARER_CANDY"]);
/** Pool cleaning (experts): held items that go to a support (one copy takes them out of the pool for good) */
const SUPPORT_KEYS = new Set(["BATON", "THROAT_SPRAY"]);

function acePriority(profile: Profile): string[] {
  return [
    // the ace's Mega
    "MEGA_BRACELET",
    ACE_STONE_KEY,
    // its second Mega Stone (Mega Garchomp Z): one pick, then the 24-weight ROGUE form-change entry has nothing left
    `FORM_${FormChangeItem[FormChangeItem.GARCHOMPITE_Z]}`,
    // MASTER
    "ULTIMATE_GENE",
    "MINI_BLACK_HOLE",
    "CHOICE_BAND",
    "MULTI_LENS",
    "BULLETPROOF_VEST",
    "ASSAULT_VEST",
    "CHAMPION_BELT",
    "CHOICE_ARMOR",
    "MASTER_PUNCHING_GLOVE",
    "CHOICE_SCARF",
    "PRISM",
    // ROGUE
    "GOLDEN_FOUR_LEAF_CLOVER",
    "LIFE_ORB",
    "TRAINING_SHACKLES",
    "EXPERT_BELT",
    "SCOPE_LENS",
    "PRECISION_LENS",
    "LEFTOVERS",
    "SHELL_BELL",
    "POWER_BRACER",
    "POWER_WEIGHT",
    "POWER_BELT",
    "POWER_BAND",
    "POWER_ANKLET",
    "BOOSTER_ENERGY",
    "CLEAR_AMULET",
    "FLAME_CAULDRON",
    "TOXIC_DISTILLER",
    "DISCHARGED_COIL",
    "LOADED_DICE",
    "PIERCING_TOKEN",
    "SOUL_DEW",
    "FOCUS_BAND",
    "KINGS_ROCK",
    // experts clean the pool: one copy of each item the ace has no use for leaves the pool for good (full rule)
    ...(profile.poolCleaning ? ["DYNAMAX_BAND", "CHOICE_SPECS", "POWER_LENS", "BATON", "THROAT_SPRAY"] : []),
    // Local fork (2026-11-19): FORK_SIM_ZMAX=take, the Z-Ring (36) and the Max Mushrooms entry (24) leave the pool too
    ...(profile.poolCleaning && ZMAX_TAKE ? ["Z_RING", MAX_MUSHROOMS_KEY] : []),
    // ULTRA
    "FOUR_LEAF_CLOVER",
    "WEIGHT_BAND",
    "MUSCLE_BAND",
    "TYPE_BOOSTER_GROUND",
    "TYPE_BOOSTER_DRAGON",
    "METRONOME",
    "FLAME_ORB",
    "TOXIC_ORB",
    "SPECIES_LIGHT_BALL",
    "QUICK_CLAW",
    "WIDE_LENS",
    "REVIVER_SEED",
    "AMULET_COIN",
    // Local fork (2026-11-13): every Candy Jar adds 2 levels to each later Candy Pile on the ace (party cap 99)
    "CANDY_JAR",
    // GREAT
    ...(GUARD_MODE === "first" ? ["GUARD_TOKEN"] : []),
    "VITAMIN_ATK",
    "VITAMIN_HP",
    "VITAMIN_DEF",
    "VITAMIN_SPDEF",
    "VITAMIN_SPD",
    // Local fork (2026-11-13): 방호 토큰 (FORK_SIM_GUARD)
    ...(GUARD_MODE === "after-vitamins" ? ["GUARD_TOKEN"] : []),
    "FOUR_LEAF_CLOVER_LEAF",
    // COMMON
    "IV_CANDY_ATK",
    "IV_CANDY_HP",
    "IV_CANDY_DEF",
    "IV_CANDY_SPDEF",
    "IV_CANDY_SPD",
    // Local fork (2026-11-13): 방호 토큰 as filler (FORK_SIM_GUARD=last)
    ...(GUARD_MODE === "last" ? ["GUARD_TOKEN"] : []),
    // filler: levels past the EXP cap (+7 + 2 x jars to the ace), taken only when nothing above is on the screen and
    // the player does not reroll
    "CANDY_PILE",
  ];
}

/** Taken without rerolling only when no reroll is left (a screen with only these counts as "nothing useful") */
const FILLER_KEYS = new Set(["CANDY_PILE", ...(GUARD_MODE === "last" ? ["GUARD_TOKEN"] : [])]);
/** The growth items that cap last (99 / 31 stacks); with all of them capped the player stops rerolling */
const LAST_CAPS = [
  "MUSCLE_BAND",
  "TYPE_BOOSTER_GROUND",
  "TYPE_BOOSTER_DRAGON",
  ...["HP", "ATK", "DEF", "SPDEF", "SPD"].flatMap(s => [`VITAMIN_${s}`, `IV_CANDY_${s}`]),
  // Local fork (2026-11-13): the 방호 토큰 (65) too while the policy takes it: rerolls go on until it is full as well
  ...(GUARD_KEEPS_REROLLING ? ["GUARD_TOKEN"] : []),
];

/** Taken only when nothing on the screen is for the ace (money first, then party items that leave the pool when full) */
const NEUTRAL_PRIORITY = [
  "RELIC_GOLD",
  "BIG_NUGGET",
  "NUGGET",
  // Local fork (2026-11-13): candies for the ace's levels; ahead of the money once the player has stopped rerolling
  // (NEUTRAL_CANDIES_FIRST), after it while money still buys rerolls. The Candy Jar moved to the ace priority.
  "RARER_CANDY",
  "RARE_CANDY",
  "DYNAMAX_BAND",
  // Local fork (2026-11-19): FORK_SIM_ZMAX=take (see ZMAX_TAKE)
  ...(ZMAX_TAKE ? ["Z_RING", MAX_MUSHROOMS_KEY] : []),
  "TERA_ORB",
  "EXP_SHARE",
  "IV_SCANNER",
  "LOCK_CAPSULE",
  "BERRY_POUCH",
  "CATCHING_CHARM",
  "ABILITY_CHARM",
  "SHINY_CHARM",
  ...(ZMAX_TAKE ? ["MARK_CHARM"] : []), // Local fork (2026-11-19): FORK_SIM_ZMAX=take
  "HEALING_CHARM",
  "SUPER_EXP_CHARM",
  "EXP_CHARM",
  "BATON",
  "SOOTHE_BELL",
  "GOLDEN_PUNCH",
];
const MONEY_ITEMS: Record<string, number> = { NUGGET: 1, BIG_NUGGET: 2.5, RELIC_GOLD: 10 };
/** Local fork (2026-11-13): the neutral order once rerolls are over (money buys nothing more): candies first */
const NEUTRAL_CANDIES_FIRST = ["RARER_CANDY", "RARE_CANDY", ...NEUTRAL_PRIORITY.filter(k => !k.endsWith("_CANDY"))];

/** Bumped whenever the scene's modifiers may change (see `installCaches`) */
let modifierVersion = 0;
/** Size of the i18next memo (memory log) */
let memoSize = () => 0;
/** The inspector session of FORK_SIM_HEAPPROF */
let heapSession: Session | undefined;

// Local fork (2026-11-13): 1500 / 2500 / 4000 / 5000 added for the 08 명세 3번 measurement (cap waves 2,500-3,000)
// Local fork (2026-11-13): 100 / 300 added for the GREAT pool's weight early on (09 명세 4-4 3항)
const SNAP_WAVES = [100, 300, 500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 5850];
// Local fork (2026-11-13): finer early buckets for the tier shares (09 명세 4-4 3항: 300 / 1000 / 2200)
const BUCKETS = [100, 300, 500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 5850];

// ---------------------------------------------------------------------------------------------------------------------
// Helpers

/** Deterministic PRNG for the player's own choices (keeps the game's seeded RNG untouched) */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pregen(type: ModifierType): unknown {
  return (type as unknown as GeneratedPersistentModifierType).getPregenArgs()[0];
}

/** A stable name for a reward option or a held item's type */
function itemKey(type: ModifierType): string {
  if (type instanceof BaseStatBoosterModifierType) {
    return `VITAMIN_${Stat[pregen(type) as PermanentStat]}`;
  }
  if (type instanceof IvCandyModifierType) {
    return `IV_CANDY_${Stat[pregen(type) as PermanentStat]}`;
  }
  if (type instanceof AttackTypeBoosterModifierType) {
    return `TYPE_BOOSTER_${PokemonType[type.moveType]}`;
  }
  if (type instanceof BerryModifierType) {
    return `BERRY_${BerryType[pregen(type) as BerryType]}`;
  }
  if (type instanceof SpeciesStatBoosterModifierType) {
    return `SPECIES_${type.key}`;
  }
  if (type instanceof FormChangeItemModifierType) {
    return `FORM_${FormChangeItem[type.formChangeItem]}`;
  }
  return type.id ?? "UNKNOWN";
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return Number.NaN;
  }
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) {
    return Number.NaN;
  }
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const EV_ITEM_STAT: Record<string, PermanentStat> = {
  POWER_WEIGHT: Stat.HP,
  POWER_BRACER: Stat.ATK,
  POWER_BELT: Stat.DEF,
  POWER_LENS: Stat.SPATK,
  POWER_BAND: Stat.SPDEF,
  POWER_ANKLET: Stat.SPD,
};

// ---------------------------------------------------------------------------------------------------------------------
// Per-run state

interface RunResult {
  profile: ProfileName;
  run: number;
  /** First wave (entering it, i.e. after the previous wave's reward) at which the ace / party held the item at its cap */
  capWave: Record<string, number>;
  /** Wave at which an EV of the ace reached its cap (252; HP 504 since 2026-11-13) */
  evCapWave: Record<string, number>;
  /** Ace held stacks + party item stacks + EVs + misc at each snapshot wave */
  snapshots: Record<number, Record<string, number>>;
  /** Times each key was shown on a screen, per wave bucket, and the last wave it was shown */
  offered: Record<string, number[]>;
  lastOffered: Record<string, number>;
  /** Times each key was picked, and for whom */
  picked: Record<string, number>;
  screens: number;
  rerolls: number;
  mistakes: number;
  emptyScreens: number;
  finalMoney: number;
  /** ms spent in regenerateModifierPoolThresholds / getPlayerModifierTypeOptions */
  msRegen: number;
  msOptions: number;
  /** Local fork (2026-11-13): levels the ace got from candy picks by the last wave (see CANDY_LEVEL_KEYS) */
  candyLevels: number;
  /** Local fork (2026-11-13): the ace's level at the last wave, EXP assumed to catch up to the EXP level cap each wave */
  aceLevel: number;
  /** Local fork (2026-11-13): reward slots shown (rerolls included) per tier (COMMON..MASTER) per wave bucket */
  slotsByTier: number[][];
  /** Local fork (2026-11-13): first reward screen at which the enemy side held a Damage Token (방호 토큰 can appear) */
  guardOpenWave: number;
  /** Local fork (2026-11-13): the GREAT pool's weight per entry id at each snapshot wave */
  greatWeights: Record<number, Record<string, number>>;
}

describe.skipIf(!process.env.FORK_SIM)("Sim - 5850 ace economy (real reward generator)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function startEndless(): Promise<void> {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.ROUGH_SKIN)
      .hasPassiveAbility(false)
      .startingLevel(100)
      .mysteryEncounterChance(0);
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.ENDLESS);
      game.scene.offsetGym = false;
      game.scene.gameData.unlocks[Unlockables.ENDLESS_MODE] = true;
      game.scene.gameData.unlocks[Unlockables.MINI_BLACK_HOLE] = true;
      const starters = generateStarters(game.scene, [ACE_SPECIES, ...SUPPORTS.map(s => s.species)]);
      const selectStarterPhase = new SelectStarterPhase();
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      selectStarterPhase.initBattle(starters);
    });
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    await game.phaseInterceptor.to("CommandPhase", false);
  }

  function simulateRun(profile: Profile, run: number, maxWave: number): RunResult {
    const scene = game.scene;
    const rng = mulberry32(0x5eed + run * 7919 + profile.name.length * 104729);
    const party = scene.getPlayerParty();
    const ace = party[0];
    const supports = party.slice(1);

    // --- reset the run
    scene.modifiers.length = 0;
    modifierVersion++;
    scene.clearEnemyModifiers();
    scene.forkOfferedMintNatures.clear();
    scene.forkSeenNatures.clear();
    scene.setSeed(`ace-econ-${profile.name}-${run}`);
    ace.formIndex = 0; // a previous run's Garchompite may have left it Mega
    ace.moveset = ACE_MOVES.map(m => new PokemonMove(m));
    SUPPORTS.forEach((s, i) => {
      supports[i].moveset = s.moves.map(m => new PokemonMove(m));
    });
    party.forEach((p, i) => {
      // fixed natures and IVs, so a run does not depend on the random starters of the process (mints, IV candies)
      p.nature = PARTY_NATURES[i];
      p.ivs = [31, 31, 31, 31, 31, 31];
      const luck = profile.shinyLuck[i] ?? 0;
      p.luck = luck;
      p.shiny = luck > 0;
      p.variant = (luck > 0 ? luck - 1 : 0) as Variant;
      p.hp = p.getMaxHp();
    });

    const priority = acePriority(profile);
    const rank = new Map(priority.map((k, i) => [k, i]));
    const neutralRank = new Map(NEUTRAL_PRIORITY.map((k, i) => [k, i]));
    const lateNeutralRank = new Map(NEUTRAL_CANDIES_FIRST.map((k, i) => [k, i]));

    const res: RunResult = {
      profile: profile.name,
      run,
      capWave: {},
      evCapWave: {},
      snapshots: {},
      offered: {},
      lastOffered: {},
      picked: {},
      screens: 0,
      rerolls: 0,
      mistakes: 0,
      emptyScreens: 0,
      finalMoney: 0,
      msRegen: 0,
      msOptions: 0,
      candyLevels: 0,
      aceLevel: 0,
      slotsByTier: [0, 1, 2, 3, 4].map(() => new Array(BUCKETS.length).fill(0)),
      guardOpenWave: 0,
      greatWeights: {},
    };
    let money = 1000;
    const evs: Record<string, number> = {};
    let candyPiles = 0;
    // Local fork (2026-11-13): the ace's candy levels and modelled level (battles are skipped: every wave the ace's EXP
    // is assumed to reach the EXP level cap if it is below it; candies add on top, past the cap too)
    let rareCandies = 0;
    let rarerCandies = 0;
    let candyLevels = 0;
    let aceLevel = ace.level;

    const wave = () => scene.currentBattle.waveIndex;
    const add = (mod: PersistentModifier | null | undefined): boolean =>
      !!mod && scene.addModifier(mod, true, false, false, true);
    const typeOf = (key: keyof typeof modifierTypes) => modifierTypes[key]().withIdFromFunc(modifierTypes[key]);

    const aceStack = (mod: PokemonHeldItemModifier): PokemonHeldItemModifier | undefined =>
      scene.findModifier(
        m => m instanceof PokemonHeldItemModifier && m.pokemonId === ace.id && m.matchType(mod),
        true,
      ) as PokemonHeldItemModifier | undefined;
    const partyItem = (id: string): PersistentModifier | undefined =>
      scene.findModifier(m => !(m instanceof PokemonHeldItemModifier) && m.type.id === id, true) as
        | PersistentModifier
        | undefined;
    const moneyMult = (amount: number): number => {
      const h = new NumberHolder(amount);
      scene.applyModifiers(MoneyMultiplierModifier, true, h);
      return h.value;
    };

    /** Records the cap waves of everything the ace and the party hold */
    const recordCaps = () => {
      const w = wave();
      for (const m of scene.modifiers) {
        if (m instanceof PokemonHeldItemModifier && m.pokemonId !== ace.id) {
          continue;
        }
        const key = itemKey(m.type);
        if (res.capWave[key] === undefined && m.stackCount >= m.getMaxStackCount()) {
          res.capWave[key] = w;
        }
      }
    };

    /**
     * Local fork (2026-11-19): FORK_SIM_ZMAX=take, the member the next Max Mushrooms go to: the first without them, the
     * ace first (the rare form-change entry offers them while any member has none)
     */
    const mushroomTaker = (): Pokemon | undefined =>
      [ace, ...supports].find(
        p =>
          !p
            .getHeldItems()
            .some(m => m instanceof PokemonFormChangeItemModifier && m.formChangeItem === FormChangeItem.MAX_MUSHROOMS),
      );

    /** Whether the option is useful to the ace right now, and how (null: not for the ace) */
    const aceUse = (opt: ModifierTypeOption): "ace" | "party" | "consumable" | "support" | null => {
      const type = opt.type;
      const key = itemKey(type);
      if (!rank.has(key)) {
        return null;
      }
      // Local fork (2026-11-19): FORK_SIM_ZMAX=take (experts' pool cleaning): Max Mushrooms while a member has none
      if (key === MAX_MUSHROOMS_KEY) {
        return mushroomTaker() ? "support" : null;
      }
      if (PARTY_ITEM_KEYS.has(key)) {
        const held = partyItem(type.id);
        return !held || held.stackCount < held.getMaxStackCount() ? "party" : null;
      }
      if (SUPPORT_KEYS.has(key) && type instanceof PokemonHeldItemModifierType) {
        return supports.some(sp => {
          const mod = type.newModifier(sp) as PokemonHeldItemModifier | null;
          return !!mod && scene.hasRoomForHeldItem(mod, sp);
        })
          ? "support"
          : null;
      }
      if (ACE_CONSUMABLE_KEYS.has(key)) {
        return "consumable";
      }
      // orbs only feed the ace's own vessel
      if (key === "FLAME_ORB" || key === "TOXIC_ORB" || key === "SPECIES_LIGHT_BALL") {
        const vessel =
          key === "FLAME_ORB" ? "FLAME_CAULDRON" : key === "TOXIC_ORB" ? "TOXIC_DISTILLER" : "DISCHARGED_COIL";
        const holds = ace.getHeldItems().some(m => m.type.id === vessel);
        if (!holds) {
          return null;
        }
      }
      if (type instanceof PokemonHeldItemModifierType || type instanceof FormChangeItemModifierType) {
        const mod = (type as PokemonModifierType).newModifier(ace) as PokemonHeldItemModifier | null;
        if (!mod) {
          return null;
        }
        if (type instanceof FormChangeItemModifierType) {
          return aceStack(mod) ? null : "ace";
        }
        return scene.hasRoomForHeldItem(mod, ace) ? "ace" : null;
      }
      return null;
    };

    /** Applies `opt` the way the reward screen would: to the ace, the party, a support, or as money */
    const applyPick = (opt: ModifierTypeOption, use: ReturnType<typeof aceUse>): void => {
      const type = opt.type;
      const key = itemKey(type);
      res.picked[key] = (res.picked[key] ?? 0) + 1;
      // Local fork (2026-11-13): every candy pick (policy, neutral or off-policy) goes to the ace, J = jars held now
      if (CANDY_LEVEL_KEYS.has(key)) {
        const levels = key === "CANDY_PILE" ? candyPileLevels().target : 1 + candyJarBonus();
        candyLevels += levels;
        aceLevel += levels;
        if (key === "CANDY_PILE") {
          candyPiles++;
        } else if (key === "RARE_CANDY") {
          rareCandies++;
        } else {
          rarerCandies++;
        }
        return;
      }
      // Local fork (2026-11-19): FORK_SIM_ZMAX=take, Max Mushrooms (policy or neutral pick) for the first member without
      // them; without the switch a pick of them changes nothing tracked, as before
      if (ZMAX_TAKE && key === MAX_MUSHROOMS_KEY && type instanceof FormChangeItemModifierType) {
        const taker = mushroomTaker();
        if (taker) {
          add(type.newModifier(taker) as PersistentModifier);
        }
        return;
      }
      if (use === "ace") {
        add((type as PokemonModifierType).newModifier(ace) as PersistentModifier);
        return;
      }
      if (use === "party") {
        add(type.newModifier() as PersistentModifier);
        return;
      }
      if (use === "consumable") {
        return;
      }
      if (MONEY_ITEMS[key] !== undefined) {
        money += moneyMult(scene.getWaveMoneyAmount(MONEY_ITEMS[key]));
        return;
      }
      if (type instanceof PokemonHeldItemModifierType) {
        // an item for another member: the first support with room (round robin from a random start)
        const start = Math.floor(rng() * supports.length);
        for (let i = 0; i < supports.length; i++) {
          const s = supports[(start + i) % supports.length];
          const mod = type.newModifier(s) as PokemonHeldItemModifier | null;
          if (mod && scene.hasRoomForHeldItem(mod, s)) {
            add(mod);
            return;
          }
        }
        return;
      }
      if (!(type instanceof PokemonModifierType)) {
        const mod = type.newModifier();
        // Lures, X items and Dire Hit lapse after a few battles in the game, but no battle runs here: adding them
        // would keep them (and their pool weight 0 "while active") forever, so they count as used up
        if (mod instanceof PersistentModifier && !(mod instanceof LapsingPersistentModifier)) {
          const held = partyItem(type.id);
          if (!held || held.stackCount < held.getMaxStackCount()) {
            add(mod);
          }
        }
      }
      // other consumables (balls, potions, TMs, candies, mints, evolution items...) change nothing tracked here
    };

    const neutralPick = (options: ModifierTypeOption[], candiesFirst: boolean): ModifierTypeOption | null => {
      let best: ModifierTypeOption | null = null;
      let bestRank = Number.POSITIVE_INFINITY;
      for (const opt of options) {
        const r = (candiesFirst ? lateNeutralRank : neutralRank).get(itemKey(opt.type));
        if (r === undefined || r >= bestRank) {
          continue;
        }
        if (!(opt.type instanceof PokemonModifierType)) {
          const held = partyItem(opt.type.id);
          if (held && held.stackCount >= held.getMaxStackCount()) {
            continue;
          }
        }
        best = opt;
        bestRank = r;
      }
      return best;
    };

    const rewardCount = (): number => {
      const h = new NumberHolder(3);
      scene.applyModifiers(ExtraModifierModifier, true, h);
      scene.applyModifiers(TempExtraModifierModifier, true, h);
      return h.value;
    };

    const bucketOf = (w: number): number => {
      const b = BUCKETS.findIndex(x => w <= x);
      return b < 0 ? BUCKETS.length - 1 : b;
    };

    const rewardScreen = (): void => {
      const w = wave();
      res.screens++;
      if (!res.guardOpenWave && enemyHoldsDamageToken()) {
        res.guardOpenWave = w;
      }
      scene.resetSeed(w);
      const count = rewardCount();
      let rerollCount = 0;
      let t0 = performance.now();
      regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0);
      let t1 = performance.now();
      let options = getPlayerModifierTypeOptions(count, party);
      res.msRegen += t1 - t0;
      res.msOptions += performance.now() - t1;
      const willReroll = rng() < profile.rerollChance;
      for (;;) {
        const b = bucketOf(w);
        for (const opt of options) {
          const key = itemKey(opt.type);
          (res.offered[key] ??= new Array(BUCKETS.length).fill(0))[b]++;
          res.lastOffered[key] = w;
          // Local fork (2026-11-13): the slot's tier (the pool tier its type came from)
          const tier = opt.type.tier;
          if (tier >= ModifierTier.COMMON && tier <= ModifierTier.MASTER) {
            res.slotsByTier[tier][b]++;
          }
        }
        // best option for the ace
        let best: ModifierTypeOption | null = null;
        let bestUse: ReturnType<typeof aceUse> = null;
        let bestRank = Number.POSITIVE_INFINITY;
        for (const opt of options) {
          const r = rank.get(itemKey(opt.type));
          if (r === undefined || r >= bestRank) {
            continue;
          }
          const use = aceUse(opt);
          if (use) {
            best = opt;
            bestUse = use;
            bestRank = r;
          }
        }
        const onlyFiller = !best || FILLER_KEYS.has(itemKey(best.type));
        // once the long-stack items are capped only filler is left: no more rerolls for it
        const growthLeft = LAST_CAPS.some(k => res.capWave[k] === undefined);
        if (onlyFiller && growthLeft && willReroll && rerollCount < profile.rerollCap) {
          const cost = computeRerollCost(null, rerollCount, 1);
          if (money >= cost) {
            money -= cost;
            rerollCount++;
            res.rerolls++;
            t0 = performance.now();
            regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, rerollCount);
            t1 = performance.now();
            options = getPlayerModifierTypeOptions(count, party);
            res.msRegen += t1 - t0;
            res.msOptions += performance.now() - t1;
            continue;
          }
        }
        if (profile.mistakeRate > 0 && rng() < profile.mistakeRate) {
          const opt = options[Math.floor(rng() * options.length)];
          if (opt !== best) {
            res.mistakes++;
          }
          applyPick(opt, aceUse(opt));
          return;
        }
        if (best) {
          applyPick(best, bestUse);
          return;
        }
        res.emptyScreens++;
        const neutral = neutralPick(options, !growthLeft);
        if (neutral) {
          applyPick(neutral, null);
        }
        return;
      }
    };

    const fixedRewards = (): void => {
      const w = wave();
      const give = (key: keyof typeof modifierTypes) => {
        const type = typeOf(key);
        const held = partyItem(type.id);
        if (!held || held.stackCount < held.getMaxStackCount()) {
          add(type.newModifier() as PersistentModifier);
        }
      };
      if (w === 10) {
        give("EXP_SHARE");
      }
      if (w <= 750 && (w <= 500 || w % 30 === 10)) {
        give(w % 30 !== 10 || w > 250 ? "EXP_CHARM" : "SUPER_EXP_CHARM");
      }
      if (w <= 450 && !(w % 50)) {
        give("GOLDEN_POKEBALL");
      }
      if (!(w % 50)) {
        // AddEnemyBuffModifierPhase
        const tier = w % 1000 ? (w % 250 ? ModifierTier.COMMON : ModifierTier.GREAT) : ModifierTier.ULTRA;
        regenerateModifierPoolThresholds(scene.getEnemyParty(), ModifierPoolType.ENEMY_BUFF);
        const n = Math.ceil(w / 250);
        for (let i = 0; i < n; i++) {
          const token = getEnemyBuffModifierForWave(
            tier,
            scene.findModifiers(m => m instanceof EnemyPersistentModifier, false),
          );
          // Every token at its cap: nothing left to draw (AddEnemyBuffModifierPhase, since 2026-11-13)
          if (token == null) {
            break;
          }
          void scene.addEnemyModifier(token, true, true);
        }
      }
    };

    /** Money and EVs of winning wave `w` */
    const battleIncome = (): void => {
      const w = wave();
      const gym = w % 30 === 20 && w % 50 !== 0;
      const last = w % 10;
      const nearGym = [-2, -1, 1, 2].some(d => (w + d) % 30 === 20 && (w + d) % 50 !== 0);
      const randomTrainer = !gym && last !== 0 && last !== 1 && !nearGym && rng() < 1 / 8;
      let enemies = 1;
      if (gym || randomTrainer) {
        money += moneyMult(scene.getWaveMoneyAmount(gym ? 2.5 : 1.4));
        enemies = gym ? (w > 110 ? 6 : 4) : Math.min(6, Math.max(2, 2 + Math.floor(w / 100)));
      }
      if (profile.honeyGather) {
        money += moneyMult(scene.getWaveMoneyAmount(0.2));
      }
      for (const m of ace.getHeldItems()) {
        if (m instanceof EvItemModifier) {
          const key = m.type.id;
          const before = evs[key] ?? 0;
          // Local fork (2026-11-13): the stat's own cap, HP 504 ("노력치 아이템도 hp만 상한을 두배로"; was 252 for all)
          const cap = getEvCap(EV_ITEM_STAT[key]);
          if (before < cap) {
            evs[key] = Math.min(cap, before + enemies);
            if (evs[key] >= cap) {
              res.evCapWave[`EV_${Stat[EV_ITEM_STAT[key]]}`] = w;
            }
          }
        }
      }
    };

    const snapshot = (w: number): void => {
      const snap: Record<string, number> = {};
      for (const m of ace.getHeldItems()) {
        const key = itemKey(m.type);
        snap[key] = (snap[key] ?? 0) + m.stackCount;
      }
      for (const m of scene.modifiers) {
        if (!(m instanceof PokemonHeldItemModifier)) {
          snap[`party:${m.type.id}`] = m.stackCount;
        }
      }
      for (const [k, v] of Object.entries(evs)) {
        snap[`EV_${Stat[EV_ITEM_STAT[k]]}`] = v;
      }
      snap["luck"] = getPartyLuckValue(party);
      snap["candyPiles"] = candyPiles;
      // Local fork (2026-11-13)
      snap["rareCandies"] = rareCandies;
      snap["rarerCandies"] = rarerCandies;
      snap["candyLevels"] = candyLevels;
      snap["aceLevel"] = aceLevel;
      // Local fork (2026-11-18): the cap formula C, which stays a number where the cap is lifted (Endless wave 1000+)
      snap["expCap"] = scene.getWaveLevelCap();
      snap["rerollsSoFar"] = res.rerolls;
      snap["log10Money"] = Math.log10(Math.max(1, money));
      snap["rewardSlots"] = rewardCount();
      // Local fork (2026-11-13): the GREAT pool's total weight and the 방호 토큰's weight right now (09 명세 4-4 3항)
      const great = tierWeights(ModifierTier.GREAT);
      snap["greatWeight"] = great.total;
      snap["guardWeight"] = great.weights["GUARD_TOKEN"] ?? 0;
      res.greatWeights[w] = great.weights;
      res.snapshots[w] = snap;
    };

    /**
     * Local fork (2026-11-13): the weight of every entry of the player pool's `tier` for the party right now, with the
     * rule of `regenerateModifierPoolThresholds` (a party item at its cap weighs 0; a held item keeps its weight). The
     * generators draw from the seeded RNG, so its state is put back afterwards (the run stays the same).
     */
    const tierWeights = (tier: ModifierTier): { total: number; weights: Record<string, number> } => {
      const rndState = Phaser.Math.RND.state();
      const weights: Record<string, number> = {};
      let total = 0;
      try {
        for (const entry of getModifierPoolForType(ModifierPoolType.PLAYER)[tier] as WeightedModifierType[]) {
          const id = entry.modifierType.id;
          const existing = scene.findModifiers(m => m.type.id === id, true);
          const type =
            entry.modifierType instanceof ModifierTypeGenerator
              ? entry.modifierType.generateType(party)
              : entry.modifierType;
          const open =
            existing.length === 0
            || type instanceof PokemonHeldItemModifierType
            || type instanceof FormChangeItemModifierType
            || existing.some(m => m.stackCount < m.getMaxStackCount(true));
          let weight = 0;
          if (open) {
            weight = typeof entry.weight === "function" ? entry.weight(party, 0) : entry.weight;
          }
          weights[id] = (weights[id] ?? 0) + weight;
          total += weight;
        }
      } finally {
        Phaser.Math.RND.state(rndState);
      }
      return { total, weights };
    };

    for (let w = 1; w <= maxWave; w++) {
      scene.currentBattle.waveIndex = w;
      // Local fork (2026-11-13): EXP lifts the ace to the cap of this wave when it is below it
      // Local fork (2026-11-18): to the cap formula C (`getWaveLevelCap`); from wave 1000 `getMaxExpLevel` is
      // Number.MAX_SAFE_INTEGER (the lifted cap) and would put the model ace there
      aceLevel = Math.max(aceLevel, scene.getWaveLevelCap());
      if (SNAP_WAVES.includes(w)) {
        snapshot(w);
      }
      if (w === maxWave) {
        break; // the last wave's win ends the run
      }
      battleIncome();
      if (w % 10) {
        rewardScreen();
      } else {
        fixedRewards();
      }
      recordCaps();
      if (!(w % 100)) {
        // nothing here runs phases; drop whatever messages a pick queued
        scene.phaseManager.clearPhaseQueue();
        // The test overrides (ability, passive, level...) are getter spies read on every roll; their call history
        // would grow by ~0.1 MB per screen. Clear it (implementations stay)
        vi.clearAllMocks();
        if (process.env.FORK_SIM_MEMLOG && !(w % 500)) {
          (globalThis as { gc?: () => void }).gc?.();
          process.stdout.write(
            `[mem] wave ${w}: heap ${(process.memoryUsage().heapUsed / 2 ** 20).toFixed(0)} MB, rerolls ${res.rerolls}, `
              + `modifiers ${scene.modifiers.length}, i18n memo ${memoSize()}\n`,
          );
        }
        // FORK_SIM_HEAPPROF=<file>: sampling heap profile of what is allocated from wave 500 and still alive at 1300
        const heapProf = process.env.FORK_SIM_HEAPPROF;
        if (heapProf && (w === 500 || w === 1300)) {
          const session = new Session();
          session.connect();
          if (w === 500) {
            heapSession = session;
            session.post("HeapProfiler.enable", () => {});
            session.post("HeapProfiler.startSampling", { samplingInterval: 4096 }, () => {});
          } else if (heapSession) {
            (globalThis as { gc?: () => void }).gc?.();
            heapSession.post("HeapProfiler.stopSampling", (err, result) => {
              if (!err) {
                writeFileSync(heapProf, JSON.stringify((result as { profile: object }).profile));
              }
            });
          }
        }
      }
    }
    if (!SNAP_WAVES.includes(maxWave)) {
      snapshot(maxWave);
    }
    res.finalMoney = money;
    res.candyLevels = candyLevels;
    res.aceLevel = aceLevel;
    return res;
  }

  it(
    "simulates the reward screens of Endless runs to wave 5850",
    async () => {
      // A plain no-op, not a spy: the reward roll logs every pick, and a spy would keep millions of calls in memory
      const savedLog = console.log;
      const savedDebug = console.debug;
      console.log = () => {};
      console.debug = () => {};
      // Memoized i18next.t for plain keys (same language all along, so the same strings): the reward roll compares
      // item names (`ModifierType.name` getters call i18next.t) on every duplicate retry, ~2700 calls per screen
      // The `name` getters of the modifier types are also cached per instance (an instance never changes what it
      // names; a TM's name looks its TM number up every time), restored afterwards
      const nameCache = new WeakMap<object, string>();
      const restoreNames: (() => void)[] = [];
      for (const cls of process.env.FORK_SIM_NO_NAMECACHE ? [] : Object.values(ModifierTypeModule)) {
        if (typeof cls !== "function" || !cls.prototype) {
          continue;
        }
        const desc = Object.getOwnPropertyDescriptor(cls.prototype, "name");
        if (!desc?.get) {
          continue;
        }
        const getter = desc.get;
        Object.defineProperty(cls.prototype, "name", {
          ...desc,
          get(this: object) {
            let n = nameCache.get(this);
            if (n === undefined) {
              n = getter.call(this) as string;
              nameCache.set(this, n);
            }
            return n;
          },
        });
        restoreNames.push(() => Object.defineProperty(cls.prototype, "name", desc));
      }
      const i18n = i18next as unknown as { t: (...a: unknown[]) => unknown };
      const savedT = i18n.t;
      const memo = new Map<string, unknown>();
      memoSize = () => memo.size;
      i18n.t = (...a: unknown[]) => {
        let key: string | undefined;
        if (typeof a[0] === "string") {
          if (a.length === 1) {
            key = a[0];
          } else if (a.length === 2 && a[1] && typeof a[1] === "object") {
            const vals = Object.entries(a[1] as Record<string, unknown>);
            if (vals.every(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v))) {
              key = `${a[0]}|${vals.map(([k, v]) => `${k}=${String(v)}`).join("|")}`;
            }
          }
        }
        if (key === undefined || process.env.FORK_SIM_NO_MEMO) {
          return savedT.apply(i18next, a);
        }
        if (!memo.has(key)) {
          memo.set(key, savedT.apply(i18next, a));
        }
        return memo.get(key);
      };
      // FORK_SIM_CPUPROF=<file>: a V8 CPU profile of the runs (vitest's forked worker drops --cpu-prof on exit)
      const cpuProf = process.env.FORK_SIM_CPUPROF;
      const session = cpuProf ? new Session() : undefined;
      const post = (method: string, params?: object) =>
        new Promise<unknown>((resolve, reject) =>
          session!.post(method, params ?? {}, (err, result) => (err ? reject(err) : resolve(result))),
        );
      if (session) {
        session.connect();
        await post("Profiler.enable");
        await post("Profiler.start");
      }
      try {
        await runAll();
      } finally {
        if (session && cpuProf) {
          const { profile } = (await post("Profiler.stop")) as { profile: object };
          writeFileSync(cpuProf, JSON.stringify(profile));
          session.disconnect();
        }
        console.log = savedLog;
        console.debug = savedDebug;
        i18n.t = savedT;
        for (const restore of restoreNames) {
          restore();
        }
      }
    },
    24 * 3600 * 1000,
  );

  /**
   * Speed only, same results: `Pokemon.getHeldItems` (read by many weight functions on every roll) is cached until the
   * modifiers change (every add / remove / clear in this harness goes through the wrapped scene methods, or bumps
   * `modifierVersion` itself), and `PlayerPokemon.getCompatibleTms` (the TM generators, on every roll) per Pokémon,
   * form, moveset and level. Both are restored afterwards.
   */
  function installCaches(afterRunHooks: (() => void)[]): void {
    const scene = game.scene;
    const bump = <A extends unknown[], R>(fn: (...a: A) => R) =>
      function (this: unknown, ...a: A): R {
        modifierVersion++;
        try {
          return fn.apply(this, a);
        } finally {
          modifierVersion++;
        }
      };
    const s = scene as unknown as Record<string, (...a: unknown[]) => unknown>;
    const wrapped = ["addModifier", "removeModifier", "addEnemyModifier", "clearEnemyModifiers"] as const;
    const saved = wrapped.map(k => s[k]);
    wrapped.forEach((k, i) => {
      s[k] = bump(saved[i].bind(scene));
    });

    const heldCache = new WeakMap<object, { v: number; items: PokemonHeldItemModifier[] }>();
    const proto = PokemonClass.prototype;
    const origHeld = proto.getHeldItems;
    proto.getHeldItems = function (this: Pokemon): PokemonHeldItemModifier[] {
      const hit = heldCache.get(this);
      if (hit && hit.v === modifierVersion) {
        return hit.items.slice();
      }
      const items = origHeld.call(this);
      heldCache.set(this, { v: modifierVersion, items: items.slice() });
      return items;
    };

    const tmCache = new WeakMap<object, Map<string, MoveId[]>>();
    const pproto = PlayerPokemon.prototype;
    const origTms = pproto.getCompatibleTms;
    pproto.getCompatibleTms = function (this: PlayerPokemon, ...a: Parameters<PlayerPokemon["getCompatibleTms"]>) {
      const key = `${a.join(",")}|${this.species.speciesId}|${this.getFormKey()}|${this.fusionSpecies?.speciesId}|${this.level}|${this.usedTMs.length}|${this.moveset.map(m => m.moveId).join(",")}`;
      let map = tmCache.get(this);
      if (!map) {
        map = new Map();
        tmCache.set(this, map);
      }
      let tms = map.get(key);
      if (!tms) {
        tms = origTms.apply(this, a);
        map.set(key, tms);
      }
      return tms.slice();
    };

    afterRunHooks.push(() => {
      wrapped.forEach((k, i) => {
        s[k] = saved[i];
      });
      proto.getHeldItems = origHeld;
      pproto.getCompatibleTms = origTms;
    });
  }

  /**
   * FORK_SIM_GROUP_FIX (a what-if, not the game): the reward screen's duplicate check
   * (`getModifierTypeOptionWithRetry`, `o.type.group === candidate.type.group`) treats every type without a `group`
   * (almost every held item, vitamins, IV candies, charms, fork items...) as one group, so after the first such item a
   * slot retries up to min(slots x 5, 50) - 1 times for a grouped item (balls, nuggets, TMs, PP items...). This gives each
   * ungrouped type a group of its own (its item key), as if the check compared names only for them.
   */
  function installGroupFix(afterRunHooks: (() => void)[]): void {
    const pool = getModifierPoolForType(ModifierPoolType.PLAYER);
    const patched: ModifierType[] = [];
    for (const entries of Object.values(pool)) {
      for (const e of entries as { modifierType: ModifierType }[]) {
        if (e.modifierType.group === undefined && !(e.modifierType instanceof ModifierTypeGenerator)) {
          e.modifierType.group = `own:${e.modifierType.id}`;
          patched.push(e.modifierType);
        }
      }
    }
    const proto = ModifierTypeGenerator.prototype;
    const orig = proto.generateType;
    proto.generateType = function (this: ModifierTypeGenerator, p: readonly Pokemon[], args?: unknown[]) {
      const r = orig.call(this, p, args);
      if (r && r.group === undefined) {
        r.group = `own:${itemKey(r)}`;
      }
      return r;
    };
    afterRunHooks.push(() => {
      proto.generateType = orig;
      for (const t of patched) {
        (t as { group: string | undefined }).group = undefined;
      }
    });
  }

  async function runAll(): Promise<void> {
    const afterRunHooks: (() => void)[] = [];
    {
      if (!process.env.FORK_SIM_MERGE) {
        await startEndless();
        if (!process.env.FORK_SIM_NO_CACHES) {
          installCaches(afterRunHooks);
        }
        if (process.env.FORK_SIM_GROUP_FIX) {
          installGroupFix(afterRunHooks);
        }
        // Local fork (2026-11-13): FORK_SIM_GUARD=nopool, the reward pools as before the 3rd patch (no 방호 토큰)
        if (GUARD_MODE === "nopool") {
          const great = getModifierPoolForType(ModifierPoolType.PLAYER)[ModifierTier.GREAT] as WeightedModifierType[];
          const entry = great.find(e => e.modifierType.id === "GUARD_TOKEN");
          expect(entry).toBeDefined();
          const savedWeight = entry!.weight;
          entry!.weight = 0;
          afterRunHooks.push(() => {
            entry!.weight = savedWeight;
          });
        }
      }
      if (process.env.FORK_SIM_DEBUG && !process.env.FORK_SIM_MERGE) {
        const party = game.scene.getPlayerParty();
        game.scene.getPlayerParty()[0].moveset = ACE_MOVES.map(m => new PokemonMove(m));
        SUPPORTS.forEach((s, i) => {
          party[i + 1].moveset = s.moves.map(m => new PokemonMove(m));
        });
        const tally: Record<string, number> = {};
        for (let i = 0; i < 2000; i++) {
          const t = modifierTypes.ATTACK_TYPE_BOOSTER().generateType(party);
          const k = t ? itemKey(t) : "null";
          tally[k] = (tally[k] ?? 0) + 1;
        }
        // the `group` of every PLAYER pool entry (the reward screen's duplicate check compares names and groups)
        const pool = getModifierPoolForType(ModifierPoolType.PLAYER);
        for (const [tier, entries] of Object.entries(pool)) {
          const rows = (entries as { modifierType: ModifierType }[]).map(e => {
            const t =
              e.modifierType instanceof ModifierTypeGenerator ? e.modifierType.generateType(party) : e.modifierType;
            return `${e.modifierType.id}:${t ? String(t.group) : "-"}`;
          });
          process.stdout.write(`[debug] groups ${ModifierTier[Number(tier)]}: ${rows.join(" ")}\n`);
        }
        // time spent per generator id
        const genTime: Record<string, [number, number]> = {};
        const proto = ModifierTypeGenerator.prototype;
        const orig = proto.generateType;
        proto.generateType = function (this: ModifierTypeGenerator, p: readonly Pokemon[], args?: unknown[]) {
          const t = performance.now();
          const r = orig.call(this, p, args);
          const e = (genTime[this.id] ??= [0, 0]);
          e[0] += performance.now() - t;
          e[1]++;
          return r;
        };
        const i18n = i18next as unknown as { t: (...a: unknown[]) => unknown };
        const origT = i18n.t;
        let tMs = 0;
        let tCalls = 0;
        i18n.t = (...a: unknown[]) => {
          const t = performance.now();
          const r = origT.apply(i18next, a);
          tMs += performance.now() - t;
          tCalls++;
          return r;
        };
        afterRunHooks.push(() => {
          i18n.t = origT;
          process.stdout.write(`[debug] i18next.t: ${tMs.toFixed(0)} ms / ${tCalls} calls\n`);
          proto.generateType = orig;
          const rows = [...Object.entries(genTime)]
            .sort((a, b) => b[1][0] - a[1][0])
            .slice(0, 15)
            .map(([k, [ms, c]]) => `${k}: ${ms.toFixed(0)} ms / ${c} calls`);
          process.stdout.write(`[debug] generator time:\n  ${rows.join("\n  ")}\n`);
        });
        process.stdout.write(
          `[debug] type boosters: ${JSON.stringify(tally)}; ace moves ${party[0]
            .getMoveset()
            .map(m => `${MoveId[m.moveId]}:${PokemonType[m.getMove().type]}`)
            .join(",")}\n`,
        );
      }
      const names = (process.env.FORK_SIM_PROFILES ?? "novice,intermediate,expert9,expert14")
        .split(",")
        .map(s => s.trim()) as ProfileName[];
      const runs = Number(process.env.FORK_SIM_RUNS ?? 20);
      const offset = Number(process.env.FORK_SIM_RUN_OFFSET ?? 0);
      const maxWave = Number(process.env.FORK_SIM_MAX_WAVE ?? 5850);
      const outDir = process.env.FORK_SIM_OUT ?? tmpdir();
      mkdirSync(outDir, { recursive: true });

      for (const name of names) {
        const profile = PROFILES[name];
        expect(profile).toBeDefined();
        // FORK_SIM_MERGE: summarize the JSON files of earlier (parallel) processes instead of running
        if (process.env.FORK_SIM_MERGE) {
          const files = readdirSync(outDir).filter(
            f => f.startsWith(`ace-econ-${name}-`) && f.endsWith(`-w${maxWave}.json`),
          );
          const results: RunResult[] = [];
          let wall = 0;
          for (const f of files) {
            const data = JSON.parse(readFileSync(join(outDir, f), "utf8")) as { wall: number; results: RunResult[] };
            results.push(...data.results);
            wall += data.wall;
          }
          const summary = summarize(profile, results, maxWave, wall);
          writeFileSync(join(outDir, `ace-econ-${name}-merged-w${maxWave}.txt`), summary);
          process.stdout.write(`(merged ${files.length} files)\n${summary}`);
          continue;
        }
        const results: RunResult[] = [];
        const t0 = Date.now();
        for (let r = offset; r < offset + runs; r++) {
          const t = Date.now();
          results.push(simulateRun(profile, r, maxWave));
          const last = results.at(-1)!;
          process.stdout.write(
            `[ace-econ] ${name} run ${r + 1 - offset}/${runs} (seed ${r}): ${((Date.now() - t) / 1000).toFixed(1)} s, `
              + `rerolls ${last.rerolls}, regen ${(last.msRegen / 1000).toFixed(1)} s, options ${(last.msOptions / 1000).toFixed(1)} s\n`,
          );
        }
        const wall = (Date.now() - t0) / 1000;
        const summary = summarize(profile, results, maxWave, wall);
        const tag = `${name}-s${offset}-r${runs}-w${maxWave}`;
        writeFileSync(join(outDir, `ace-econ-${tag}.json`), JSON.stringify({ profile, wall, results }, null, 0));
        writeFileSync(join(outDir, `ace-econ-${tag}.txt`), summary);
        process.stdout.write(summary);
        expect(results.length).toBe(runs);
      }
      for (const hook of afterRunHooks) {
        hook();
      }
    }
  }

  /** Text summary: cap waves (median / p10 / p90), loadouts at the snapshot waves, items that stop being offered */
  function summarize(profile: Profile, results: RunResult[], maxWave: number, wall: number): string {
    const lines: string[] = [];
    const n = results.length;
    lines.push(
      `=== ${profile.name}: ${n} runs to wave ${maxWave}, wall ${wall.toFixed(0)} s (${(wall / n).toFixed(1)} s/run) ===`,
    );
    lines.push(
      `screens/run ${median(results.map(r => r.screens))}, rerolls/run median ${median(results.map(r => r.rerolls))}, `
        + `mistakes/run ${median(results.map(r => r.mistakes))}, screens with nothing for the ace (after rerolls) median ${median(results.map(r => r.emptyScreens))}`,
    );
    const priority = acePriority(profile);
    const keys = new Set<string>([...priority, "FLAME_FURNACE", "TOXIC_DISTILLATE", "SUPERCONDUCTING_COIL"]);
    for (const r of results) {
      for (const k of Object.keys(r.capWave)) {
        keys.add(k);
      }
    }
    const final = maxWave;
    lines.push("item | capped runs | cap wave median / p10 / p90 | ace count at end median (p10-p90)");
    for (const key of keys) {
      const caps = results.map(r => r.capWave[key] ?? Number.POSITIVE_INFINITY).sort((a, b) => a - b);
      const capped = caps.filter(Number.isFinite).length;
      const counts = results
        .map(r => r.snapshots[final]?.[key] ?? r.snapshots[final]?.[`party:${key}`] ?? 0)
        .sort((a, b) => a - b);
      if (capped === 0 && counts.at(-1) === 0 && !priority.includes(key)) {
        continue;
      }
      const fmt = (v: number) => (Number.isFinite(v) ? String(v) : "never");
      lines.push(
        `${key} | ${capped}/${n} | ${fmt(percentile(caps, 50))} / ${fmt(percentile(caps, 10))} / ${fmt(percentile(caps, 90))} | ${median(counts)} (${percentile(counts, 10)}-${percentile(counts, 90)})`,
      );
    }
    const evKeys = new Set<string>();
    for (const r of results) {
      for (const k of Object.keys(r.evCapWave)) {
        evKeys.add(k);
      }
    }
    for (const key of evKeys) {
      const caps = results.map(r => r.evCapWave[key] ?? Number.POSITIVE_INFINITY).sort((a, b) => a - b);
      const fmt = (v: number) => (Number.isFinite(v) ? String(v) : "never");
      // Local fork (2026-11-13): the stat's own cap (HP 504)
      const cap = getEvCap(key === "EV_HP" ? Stat.HP : Stat.ATK);
      lines.push(
        `${key}=${cap} | ${caps.filter(Number.isFinite).length}/${n} | ${fmt(percentile(caps, 50))} / ${fmt(percentile(caps, 10))} / ${fmt(percentile(caps, 90))} |`,
      );
    }
    for (const w of [...SNAP_WAVES.filter(x => x <= maxWave)]) {
      const all = new Set<string>();
      for (const r of results) {
        for (const k of Object.keys(r.snapshots[w] ?? {})) {
          all.add(k);
        }
      }
      const parts: string[] = [];
      for (const k of [...all].sort()) {
        const med = median(results.map(r => r.snapshots[w]?.[k] ?? 0));
        if (med) {
          parts.push(`${k}=${Number.isInteger(med) ? med : med.toFixed(1)}`);
        }
      }
      lines.push(`loadout@${w} (median): ${parts.join(", ")}`);
    }
    // Local fork (2026-11-13): 방호 토큰 (09 명세 4번): mode, cap wave, when it opens, tier shares and its share of slots
    {
      const fmt = (v: number) => (Number.isFinite(v) ? String(v) : "never");
      const caps = results.map(r => r.capWave["GUARD_TOKEN"] ?? Number.POSITIVE_INFINITY).sort((a, b) => a - b);
      const opens = results.map(r => r.guardOpenWave || Number.POSITIVE_INFINITY).sort((a, b) => a - b);
      lines.push(
        `GUARD_TOKEN (FORK_SIM_GUARD=${GUARD_MODE}, max ${GUARD_TOKEN_RULES.maxStacks}): full ${caps.filter(Number.isFinite).length}/${n}, `
          + `full wave median / p10 / p90 ${fmt(percentile(caps, 50))} / ${fmt(percentile(caps, 10))} / ${fmt(percentile(caps, 90))}; `
          + `first screen with a Damage Token on the enemy side median ${fmt(percentile(opens, 50))} (p90 ${fmt(percentile(opens, 90))})`,
      );
      const stacksAt = SNAP_WAVES.filter(x => x <= maxWave).map(
        w => `@${w} ${median(results.map(r => r.snapshots[w]?.["party:GUARD_TOKEN"] ?? 0))}`,
      );
      lines.push(`  GUARD_TOKEN stacks (median): ${stacksAt.join(", ")}`);
      const weightsAt = SNAP_WAVES.filter(x => x <= maxWave).map(
        w =>
          `@${w} ${median(results.map(r => r.snapshots[w]?.["greatWeight"] ?? 0))}/${median(results.map(r => r.snapshots[w]?.["guardWeight"] ?? 0))}`,
      );
      lines.push(`  GREAT pool weight total / GUARD_TOKEN weight (median): ${weightsAt.join(", ")}`);
      lines.push("  slots per bucket: all | tier shares C/G/U/R/M % | GUARD_TOKEN % of GREAT slots | % of all slots");
      BUCKETS.forEach((b, i) => {
        const tiers = [0, 1, 2, 3, 4].map(t => results.reduce((s, r) => s + (r.slotsByTier?.[t]?.[i] ?? 0), 0));
        const all = tiers.reduce((s, v) => s + v, 0);
        const guard = results.reduce((s, r) => s + (r.offered["GUARD_TOKEN"]?.[i] ?? 0), 0);
        const pct = (v: number, d: number) => (d > 0 ? ((100 * v) / d).toFixed(2) : "-");
        lines.push(
          `  <=${b}: ${(all / n).toFixed(0)}/run | ${tiers.map(v => pct(v, all)).join(" / ")} | ${pct(guard, tiers[1])} | ${pct(guard, all)}`,
        );
      });
    }
    // offers per bucket (mean per run) for the ace keys
    lines.push(`offers per run by wave bucket (<=${BUCKETS.join(", <=")}), last wave offered (median):`);
    for (const key of priority) {
      const per = BUCKETS.map((_b, i) => results.reduce((s, r) => s + (r.offered[key]?.[i] ?? 0), 0) / n);
      const last = median(results.map(r => r.lastOffered[key] ?? 0));
      lines.push(`  ${key}: ${per.map(v => v.toFixed(1)).join(" / ")} | last ${last}`);
    }
    lines.push("");
    return `${lines.join("\n")}\n`;
  }
});
