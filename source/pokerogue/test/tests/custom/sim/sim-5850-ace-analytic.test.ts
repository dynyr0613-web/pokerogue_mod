// Local fork (2026-11-13) — simulation harness, skipped by the normal suite (run with FORK_SIM=1).
// An INDEPENDENT, formula-level estimate of whether a fully grown player ace can sweep the final Endless trainer at wave
// 5850 (ENDLESS_FINAL_TRAINER_POOL, endless-final-trainer.ts), to cross-check the battle simulation. No battle engine
// turn is run: every number comes from the game's own stat and damage code, called directly.
// - The ace: a real PlayerPokemon of the species / form (or fusion, fields set as `PlayerPokemon.fuse` sets them), level
//   set past the EXP cap (Candy Piles), IVs / EVs / nature (custom nature, as a Mint gives) / passive set, and every
//   capped growth item given at its player cap (`getMaxHeldItemCount` checked), then `calculateStats`.
// - The enemies: the five pool trainers built the way `sim-5850-trainer-candidates.test.ts` builds them (new Trainer +
//   new Battle + genPartyMember + rollTrainerBattleForm + generateEnemyModifiers; Local fork (2026-11-13): then
//   applyEndlessTrainerBossBars as EncounterPhase does, 08 명세 5번 bars + 보정 B HP), plus the old wild END boss, with every
//   enemy buff token at its wave-5850 cap and 10 Piercing Tokens + 5 Healing Charms on the player's side.
// - One hit each way: `Pokemon.getAttackDamage` (simulated) per move, with the Multi Lens hit split (75% + 3 x 25% since
//   10 명세 1번 (2026-11-13; 4 x 25% before), PLAYER_HELD_ITEM_CAPS.MULTI_LENS, set through `turnData` as
//   `MoveEffectPhase` would), always-crit from 3 Scope Lenses, and with / without the Protection
//   Token for R. Accuracy from `Move.calculateBattleAccuracy` x `getAccuracyMultiplier` (Wide Lens included).
// - Then a small Monte Carlo of the turn arithmetic only (no phases): order (speed, priority, Quick Claw 50% vs the
//   enemy's), the ace's hits through the boss-bar clamp (`calculateBossSegmentDamage`), Endure Token 20% once, Focus Band
//   10%/stack per lethal hit, Sturdy (from the full-HP damage call), the enemy's Heal Token 20% + Leftovers + Shell
//   Bell + Life Orb loss, King's Rock flinches per hit, the status tokens (Burn / Poison / Paralysis), the ace's Life Orb
//   loss, Leftovers x1.5, Shell Bell x1.5 (Healing Charm), Focus Band, Reviver Seed, Metronome steps, Beast Boost,
//   Dragon Ascent's self drops, the Choice lock (switch out and back in when locked into an immune move).
//
// Env: FORK_SIM=1 to run; FORK_SIM_ACES=A1,A3 to restrict; FORK_SIM_SEEDS=a,b (default s5850-a,s5850-b);
// FORK_SIM_MC=<runs per ace variant x party> (default 400); FORK_SIM_OUT=<dir> writes one JSON per ace.
import { Battle } from "#app/battle";
import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { PLAYER_HELD_ITEM_CAPS } from "#balance/endless-balance";
import { allMoves, modifierTypes } from "#data/data-lists";
import { rollTrainerBattleForm, rollWildBattleForm } from "#data/enemy-battle-forms";
import { Gender } from "#data/gender";
import { CustomPokemonData } from "#data/pokemon-data";
import { Weather } from "#data/weather";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { MultiHitType } from "#enums/multi-hit-type";
import { Nature } from "#enums/nature";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { PERMANENT_STATS, Stat } from "#enums/stat";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { UiMode } from "#enums/ui-mode";
import { WeatherType } from "#enums/weather-type";
import type { EnemyPokemon, PlayerPokemon, Pokemon } from "#field/pokemon";
import { Trainer } from "#field/trainer";
import { getEvCap } from "#modifiers/ev-items"; // Local fork (2026-11-13): HP's EV cap 504
import {
  EnemyDamageReducerModifier,
  type EnemyPersistentModifier,
  type PersistentModifier,
  PokemonHeldItemModifier,
} from "#modifiers/modifier";
import {
  type ModifierType,
  type ModifierTypeGenerator,
  regenerateModifierPoolThresholds,
} from "#modifiers/modifier-type";
import type { Move } from "#moves/move";
import { PokemonMove } from "#moves/pokemon-move";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import { applyEndlessTrainerBossBars } from "#trainers/endless-boss-bars";
import { ENDLESS_FINAL_TRAINER_POOL } from "#trainers/endless-final-trainer";
import { calculateBossSegmentDamage } from "#utils/damage";
import fs from "node:fs";
import path from "node:path";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const WAVE = 5850;
/**
 * The player's EXP level cap at wave 5850 (`getMaxExpLevel`, measured in sim-wave5850-enemy-side).
 * Local fork (2026-11-13): 69,222 -> 320,222, 08 명세 4번 adds S(5850) = 251,000 (endless-level-scaling.ts)
 */
const LEVEL_CAP = 320_222;
const SEEDS = (process.env.FORK_SIM_SEEDS ?? "s5850-a,s5850-b").split(",").filter(s => s.length > 0);
const MC_RUNS = Number(process.env.FORK_SIM_MC ?? 400);
const ONLY_ACES = process.env.FORK_SIM_ACES?.split(",").filter(s => s.length > 0);
const OUT_DIR = process.env.FORK_SIM_OUT;
const TURN_CAP = 300;
/** Atk, Def, SpA, SpD, Spe */
const BATTLE_STATS = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD] as const;

/** Every enemy buff token at its wave-5850 cap (sim-wave5850-enemy-side: 100% of runs) */
const TOKEN_CAP_AT_5850 = {
  ENEMY_DAMAGE_BOOSTER: 999,
  ENEMY_DAMAGE_REDUCTION: 999,
  ENEMY_HEAL: 10,
  ENEMY_STATUS_EFFECT_HEAL_CHANCE: 10,
  ENEMY_ENDURE_CHANCE: 10,
  ENEMY_ATTACK_POISON_CHANCE: 10,
  ENEMY_ATTACK_PARALYZE_CHANCE: 10,
  ENEMY_ATTACK_BURN_CHANCE: 10,
  ENEMY_FUSED_CHANCE: 10,
} as const;

// #region Aces and builds

type Category = "physical" | "special";

interface AceSpec {
  key: string;
  label: string;
  species: SpeciesId;
  formKey: string;
  fusion?: { species: SpeciesId; formKey: string };
  /** The best nature for Soul Dew x10 (the lowered stat drops to 1, so one attacking category is chosen) */
  nature: Nature;
  category: Category;
  moves: MoveId[];
  boosters: [PokemonType, PokemonType];
  /** Expert: use the fork's custom passive (else PokeRogue's) */
  expertCustomPassive: boolean;
  /** Stat stages the ace always has on entry (Intrepid Sword) */
  entryStages?: Partial<Record<Stat, number>>;
}

const ACES: readonly AceSpec[] = [
  {
    key: "A1",
    label: "Mega Garchomp",
    species: SpeciesId.GARCHOMP,
    formKey: "mega",
    nature: Nature.ADAMANT,
    category: "physical",
    moves: [MoveId.PRECIPICE_BLADES, MoveId.DRAGON_HAMMER, MoveId.STONE_EDGE, MoveId.IRON_HEAD],
    boosters: [PokemonType.GROUND, PokemonType.DRAGON],
    // Sand Stream (custom) + Sand Force: x1.3 Ground/Rock/Steel and 1/16 chip; PokeRogue's is Mold Breaker
    expertCustomPassive: true,
  },
  {
    key: "A2",
    label: "Mega Rayquaza",
    species: SpeciesId.RAYQUAZA,
    formKey: "mega",
    nature: Nature.ADAMANT,
    category: "physical",
    moves: [MoveId.DRAGON_ASCENT, MoveId.DRAGON_HAMMER, MoveId.PRECIPICE_BLADES, MoveId.EXTREME_SPEED],
    boosters: [PokemonType.FLYING, PokemonType.DRAGON],
    // Adaptability (custom) vs Unnerve
    expertCustomPassive: true,
  },
  {
    key: "A3",
    label: "Mega Latios",
    species: SpeciesId.LATIOS,
    formKey: "mega",
    nature: Nature.MODEST,
    category: "special",
    moves: [MoveId.DYNAMAX_CANNON, MoveId.PSYSTRIKE, MoveId.AURA_SPHERE, MoveId.FLAMETHROWER],
    boosters: [PokemonType.DRAGON, PokemonType.PSYCHIC],
    // Adaptability (custom) vs Neuroforce
    expertCustomPassive: true,
  },
  {
    key: "A4",
    label: "Hoopa Unbound",
    species: SpeciesId.HOOPA,
    formKey: "unbound",
    nature: Nature.MODEST,
    category: "special",
    moves: [MoveId.PSYSTRIKE, MoveId.FIERY_WRATH, MoveId.AURA_SPHERE, MoveId.SLUDGE_BOMB],
    boosters: [PokemonType.PSYCHIC, PokemonType.DARK],
    // Infiltrator (custom) vs Opportunist: neither adds damage
    expertCustomPassive: true,
  },
  {
    key: "A5",
    label: "Kartana",
    species: SpeciesId.KARTANA,
    formKey: "",
    nature: Nature.ADAMANT,
    category: "physical",
    moves: [MoveId.POWER_WHIP, MoveId.LEAF_BLADE, MoveId.BEHEMOTH_BLADE, MoveId.SACRED_SWORD],
    boosters: [PokemonType.GRASS, PokemonType.STEEL],
    // Sharpness (custom, slicing x1.5) vs Technician
    expertCustomPassive: true,
  },
  {
    key: "A6",
    label: "Flutter Mane",
    species: SpeciesId.FLUTTER_MANE,
    formKey: "",
    nature: Nature.MODEST,
    category: "special",
    moves: [MoveId.ASTRAL_BARRAGE, MoveId.MOONBLAST, MoveId.FLAMETHROWER, MoveId.THUNDERBOLT],
    boosters: [PokemonType.GHOST, PokemonType.FAIRY],
    // Beast Boost (custom) vs Dazzling
    expertCustomPassive: true,
  },
  {
    key: "A7",
    label: "Fusion Mega Rayquaza / Zacian-Crowned",
    species: SpeciesId.RAYQUAZA,
    formKey: "mega",
    fusion: { species: SpeciesId.ZACIAN, formKey: "crowned" },
    nature: Nature.ADAMANT,
    category: "physical",
    moves: [MoveId.BEHEMOTH_BLADE, MoveId.DRAGON_HAMMER, MoveId.PRECIPICE_BLADES, MoveId.SACRED_SWORD],
    boosters: [PokemonType.STEEL, PokemonType.DRAGON],
    // Head passive: Rayquaza Mega's custom Adaptability; ability from the tail: Intrepid Sword (+1 Atk on entry)
    expertCustomPassive: true,
    entryStages: { [Stat.ATK]: 1 },
  },
];

interface Variant {
  id: string;
  tier: "novice" | "expert";
  levelMult: number;
  bp: boolean;
}

const VARIANTS: readonly Variant[] = [
  { id: "NOV-L1", tier: "novice", levelMult: 1, bp: false },
  { id: "NOV-L3", tier: "novice", levelMult: 3, bp: false },
  { id: "EXP-L1", tier: "expert", levelMult: 1, bp: false },
  { id: "EXP-L3", tier: "expert", levelMult: 3, bp: false },
  { id: "EXP-L10", tier: "expert", levelMult: 10, bp: false },
  { id: "BP-L1", tier: "expert", levelMult: 1, bp: true },
  { id: "BP-L3", tier: "expert", levelMult: 3, bp: true },
];
/** Variants also run against the old wild END boss */
const WILD_VARIANTS = new Set(["NOV-L1", "EXP-L1"]);

type HeldKey =
  | "ULTIMATE_GENE"
  | "CHOICE_BAND"
  | "CHOICE_SPECS"
  | "CHOICE_SCARF"
  | "CHOICE_ARMOR"
  | "MULTI_LENS"
  | "ASSAULT_VEST"
  | "BULLETPROOF_VEST"
  | "CHAMPION_BELT"
  | "WEIGHT_BAND"
  | "LIFE_ORB"
  | "EXPERT_BELT"
  | "SCOPE_LENS"
  | "PRECISION_LENS"
  | "LEFTOVERS"
  | "SHELL_BELL"
  | "FOCUS_BAND"
  | "QUICK_CLAW"
  | "WIDE_LENS"
  | "KINGS_ROCK"
  | "METRONOME"
  | "CLEAR_AMULET"
  | "BOOSTER_ENERGY"
  | "SOUL_DEW"
  | "MUSCLE_BAND"
  | "WISE_GLASSES"
  | "FLAME_FURNACE"
  | "TOXIC_DISTILLATE"
  | "SUPERCONDUCTING_COIL"
  | "REVIVER_SEED"
  | "TRAINING_SHACKLES";

const COMMON_HELD: readonly [HeldKey, number][] = [
  ["ULTIMATE_GENE", 1],
  ["CHOICE_BAND", 1],
  ["CHOICE_SPECS", 1],
  ["CHOICE_SCARF", 1],
  ["CHOICE_ARMOR", 1],
  ["MULTI_LENS", PLAYER_HELD_ITEM_CAPS.MULTI_LENS], // Local fork (2026-11-13): 10 명세 1번, 3 (4 before)
  ["ASSAULT_VEST", 3],
  ["BULLETPROOF_VEST", 3],
  ["CHAMPION_BELT", 1],
  ["WEIGHT_BAND", 3],
  ["LIFE_ORB", 3],
  ["EXPERT_BELT", 1],
  ["SCOPE_LENS", 3],
  ["PRECISION_LENS", 2],
  ["LEFTOVERS", 6],
  ["SHELL_BELL", 8],
  ["FOCUS_BAND", 5],
  ["QUICK_CLAW", 5],
  ["WIDE_LENS", 3],
  ["KINGS_ROCK", 3],
  ["METRONOME", 3],
  ["CLEAR_AMULET", 1],
  ["BOOSTER_ENERGY", 1],
  ["SOUL_DEW", 10],
  ["FLAME_FURNACE", 1],
  ["TOXIC_DISTILLATE", 1],
  ["SUPERCONDUCTING_COIL", 1],
  ["REVIVER_SEED", 1],
];

/** A small seeded PRNG (mulberry32) */
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

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

/** The novice ace's IVs: uniform 0..31 per stat, seeded by the ace key (the same for its L1 and L3 runs) */
function noviceIvs(aceKey: string): number[] {
  const rand = mulberry32(hashString(`novice-ivs-${aceKey}`));
  return PERMANENT_STATS.map(() => Math.floor(rand() * 32));
}

// #endregion Aces and builds

// #region Records

interface AceMoveRow {
  move: string;
  type: string;
  physical: boolean;
  priority: number;
  acc: number;
  lens: boolean;
  /** Damage of one hit after every token (Protection 999 + Piercing 10): first hit at full HP / not full, extra hit */
  firstFull: number;
  firstNf: number;
  extra: number;
  /** One hit without Multi Lens and without the Protection Token (R's numerator) */
  rawSingle: number;
  /** One hit without Multi Lens, with the tokens */
  tokSingle: number;
  effectiveness: number;
  /** King's Rock applies (not a FlinchAttr move) */
  kingsRock: boolean;
  /** Own flinch chance of the move (Fiery Wrath) */
  ownFlinch: number;
  selfDefDrop: boolean;
}

interface EnemyMoveRow {
  move: string;
  type: string;
  physical: boolean;
  priority: number;
  acc: number;
  hits: number;
  dmg: number;
  dmgCrit: number;
  pCrit: number;
  expected: number;
}

interface MemberCalc {
  slot: number;
  name: string;
  types: string[];
  ability: string;
  passive: string | null;
  level: number;
  bars: number;
  maxHp: number;
  stats: number[];
  spe: number;
  items: Record<string, number>;
  sturdy: boolean;
  unaware: boolean;
  blockCrit: boolean;
  traps: boolean;
  sandImmune: boolean;
  weather: string;
  /** The ace's moves against this member, with the ace's normal stages / with its stages lost (BP or Reviver) */
  aceMoves: AceMoveRow[];
  aceMovesLost: AceMoveRow[];
  aceSpe: number;
  aceSpeLost: number;
  enemyMoves: EnemyMoveRow[];
  best: EnemyMoveRow | null;
  /** Boss-boost weights (wild) */
  statWeights: number[];
}

interface McResult {
  runs: number;
  swept: number;
  fainted: number;
  stalled: number;
  meanKOs: number;
  meanTurns: number;
  meanSwitches: number;
  meanHitsTaken: number;
  meanFocusBandSaves: number;
  reviverUsed: number;
  /** per member: P(reached), mean turns spent, P(the ace fell while facing it), mean hits taken from it, mean enemy FB + Endure saves */
  perMember: { reached: number; turns: number; aceFell: number; hitsTaken: number; saves: number; koTurn1: number }[];
}

// #endregion Records

// #region Monte Carlo of the turn arithmetic

type AceStatus = "none" | "burn" | "poison" | "paralysis";

/** P(ace) of each status token on one enemy hit with all three at 50/50/25%, in shuffled order (first success sticks) */
const STATUS_ODDS = { burn: 1 / 3, poison: 1 / 3, paralysis: 0.875 / 6 };

interface AceSim {
  maxHp: number;
  category: Category;
  types: PokemonType[];
  levitate: boolean;
  ghost: boolean;
  qc: number;
  fb: number;
  kr: number;
  lifeOrbLoss: number;
  leftovers: number;
  shellBellStacks: number;
  healMult: number;
  beastBoost: boolean;
  baseAtkStage: number;
  bp: boolean;
  sandSetter: boolean;
}

function simulateParty(ace: AceSim, members: MemberCalc[], wild: boolean, rand: () => number): McResult {
  const per = members.map(() => ({ reached: 0, turns: 0, aceFell: 0, hitsTaken: 0, saves: 0, koTurn1: 0 }));
  let swept = 0;
  let fainted = 0;
  let stalled = 0;
  let kosSum = 0;
  let turnsSum = 0;
  let switchesSum = 0;
  let hitsSum = 0;
  let fbSum = 0;
  let reviverSum = 0;
  const burnImmune = ace.types.includes(PokemonType.FIRE);
  const poisonImmune = ace.types.includes(PokemonType.POISON) || ace.types.includes(PokemonType.STEEL);
  const paraImmune = ace.types.includes(PokemonType.ELECTRIC);

  for (let run = 0; run < MC_RUNS; run++) {
    let aceHp = ace.maxHp;
    let status = "none" as AceStatus;
    let lock = -1;
    let metronome = 0;
    let defDrops = 0;
    let boost = 0;
    let stagesLost = false;
    let reviver = true;
    let turns = 0;
    let kos = 0;
    let switches = 0;
    let hitsTaken = 0;
    let fbSaves = 0;
    let outcome: "swept" | "fainted" | "stalled" = "swept";

    /** Lethal damage to the ace: Focus Band, then Reviver Seed; returns false when the ace is out */
    const hurtAce = (dmg: number): boolean => {
      if (dmg < aceHp) {
        aceHp -= dmg;
        return true;
      }
      if (rand() < ace.fb / 10) {
        aceHp = 1;
        fbSaves++;
        return true;
      }
      if (reviver) {
        reviver = false;
        aceHp = Math.floor(ace.maxHp / 2);
        status = "none";
        lock = -1;
        metronome = 0;
        defDrops = 0;
        boost = 0;
        stagesLost = true;
        return true;
      }
      aceHp = 0;
      return false;
    };

    // The current foe's state the helpers below read (set at the start of each member)
    let cur: MemberCalc = members[0];
    let foeAtkStage = 0;
    let foeSpeStage = 0;
    let foeDefStage = 0;

    const rollEnemyHit = (): number => {
      const b = cur.best;
      if (!b || (b.acc < 1 && rand() >= b.acc)) {
        return 0;
      }
      let dmg = rand() < b.pCrit ? b.dmgCrit : b.dmg;
      dmg *= b.hits;
      if (foeAtkStage > 0) {
        dmg *= (2 + foeAtkStage) / 2;
      }
      if (defDrops > 0 && !cur.unaware) {
        dmg *= (2 + defDrops) / 2;
      }
      return Math.floor(dmg);
    };

    const rollStatus = (): void => {
      if (status !== "none") {
        return;
      }
      const r = rand();
      if (r < STATUS_ODDS.burn) {
        if (!burnImmune) {
          status = "burn";
        }
      } else if (r < STATUS_ODDS.burn + STATUS_ODDS.poison) {
        if (!poisonImmune) {
          status = "poison";
        }
      } else if (r < STATUS_ODDS.burn + STATUS_ODDS.poison + STATUS_ODDS.paralysis && !paraImmune) {
        status = "paralysis";
      }
    };

    /** Turn end for the ace: Life Orb loss, Leftovers x Healing Charm, burn / poison */
    const aceTurnEnd = (attacked: boolean): boolean => {
      // Local fork (2026-11-13): 08 명세 2번, the Life Orb cost always leaves 1 HP (LIFE_ORB_MIN_HP_LEFT), so it is
      // never lethal and a holder at 1 HP pays nothing
      if (attacked && ace.lifeOrbLoss > 0 && aceHp > 1) {
        aceHp -= Math.min(Math.floor(ace.maxHp * ace.lifeOrbLoss), aceHp - 1);
      }
      aceHp = Math.min(ace.maxHp, aceHp + Math.floor(Math.floor(ace.maxHp / 16) * ace.leftovers * ace.healMult));
      if (status === "burn" && !hurtAce(Math.floor(ace.maxHp / 16))) {
        return false;
      }
      if (status === "poison" && !hurtAce(Math.floor(ace.maxHp / 8))) {
        return false;
      }
      return true;
    };

    memberLoop: for (let mi = 0; mi < members.length; mi++) {
      const m = members[mi];
      per[mi].reached++;
      let hp = m.maxHp;
      let segIndex = m.bars > 0 ? m.bars - 1 : 0;
      const segHp = m.bars > 0 ? m.maxHp / m.bars : m.maxHp;
      let endureUsed = false;
      cur = m;
      foeAtkStage = 0;
      foeSpeStage = 0;
      foeDefStage = 0;
      let turnsHere = 0;
      // Wild boss: the bars' stat boosts (+1, the last and second-to-last +2), weighted by the stat values
      const bossBoost = (amount: number) => {
        for (let a = 0; a < amount; a++) {
          const w = m.statWeights;
          const total = w.reduce((x, y) => x + y, 0);
          let r = rand() * total;
          let pick = 0;
          for (let i = 0; i < w.length; i++) {
            if (r < w[i]) {
              pick = i;
              break;
            }
            r -= w[i];
          }
          // 0 Atk, 1 Def, 2 SpA, 3 SpD, 4 Spe; the best move's attacking stat is the one that matters
          if ((pick === 0 && m.best?.physical) || (pick === 2 && m.best && !m.best.physical)) {
            foeAtkStage = Math.min(6, foeAtkStage + 1);
          } else if (pick === 4) {
            foeSpeStage = Math.min(6, foeSpeStage + 1);
          } else if ((pick === 1 && ace.category === "physical") || (pick === 3 && ace.category === "special")) {
            foeDefStage = Math.min(6, foeDefStage + 1);
          }
        }
      };

      while (true) {
        if (turns >= TURN_CAP) {
          outcome = "stalled";
          break memberLoop;
        }
        const rows = stagesLost ? m.aceMovesLost : m.aceMoves;
        const turnValue = (r: AceMoveRow) =>
          r.acc * (r.firstNf + (r.lens ? PLAYER_HELD_ITEM_CAPS.MULTI_LENS * r.extra : 0));
        if (lock >= 0 && rows[lock].effectiveness === 0) {
          // Choice-locked into a move this foe is immune to: a support comes in (takes a hit), then the ace comes back
          // in and takes one hit on entry; stages, Metronome, the lock and Dragon Ascent's drops are reset
          if (m.traps) {
            outcome = "stalled";
            break memberLoop;
          }
          switches++;
          turns += 2;
          turnsHere += 2;
          lock = -1;
          metronome = 0;
          defDrops = 0;
          stagesLost = true;
          const enemyHit = rollEnemyHit();
          hitsTaken++;
          per[mi].hitsTaken++;
          if (!hurtAce(enemyHit)) {
            outcome = "fainted";
            per[mi].aceFell++;
            per[mi].turns += turnsHere;
            break memberLoop;
          }
          rollStatus();
          continue;
        }
        if (lock < 0) {
          let best = -1;
          let bestValue = 0;
          rows.forEach((r, i) => {
            const v = turnValue(r);
            if (v > bestValue) {
              bestValue = v;
              best = i;
            }
          });
          if (best < 0) {
            // Nothing this ace has can damage this foe
            outcome = "stalled";
            break memberLoop;
          }
          lock = best;
        }
        const row = rows[lock];
        turns++;
        turnsHere++;

        // Turn order
        const enemyPrio = m.best?.priority ?? 0;
        let aceFirst: boolean;
        if (row.priority === enemyPrio) {
          const aBypass = rand() < ace.qc / 10;
          const eBypass = rand() < (m.items.QUICK_CLAW ?? 0) / 10;
          if (aBypass === eBypass) {
            const aSpe = (stagesLost ? m.aceSpeLost : m.aceSpe) * (status === "paralysis" ? 0.5 : 1);
            const eSpe = m.spe * ((2 + foeSpeStage) / 2);
            aceFirst = aSpe === eSpe ? rand() < 0.5 : aSpe > eSpe;
          } else {
            aceFirst = aBypass;
          }
        } else {
          aceFirst = row.priority > enemyPrio;
        }

        let aceAttacked = false;
        let enemyAttacked = false;
        let enemyFlinched = false;
        let aceFlinched = false;
        let koed = false;

        const aceAct = () => {
          if (aceFlinched || (status === "paralysis" && rand() < 0.25)) {
            metronome = 0;
            return;
          }
          aceAttacked = true;
          if (row.acc < 1 && rand() >= row.acc) {
            metronome = 0;
            return;
          }
          let mult = 1 + 0.2 * Math.min(metronome, 5);
          if (row.physical && status === "burn") {
            mult *= 0.5;
          }
          const statStage = Math.min(6, (stagesLost ? 0 : ace.baseAtkStage) + boost);
          const baseStage = stagesLost ? 0 : ace.baseAtkStage;
          if (!m.unaware && statStage !== baseStage) {
            mult *= (2 + statStage) / (2 + baseStage);
          }
          if (foeDefStage > 0 && m.blockCrit) {
            mult *= 2 / (2 + foeDefStage);
          }
          const hits = row.lens ? 1 + PLAYER_HELD_ITEM_CAPS.MULTI_LENS : 1;
          let dealtTotal = 0;
          let flinch = false;
          for (let h = 0; h < hits; h++) {
            let base = row.extra;
            if (h === 0) {
              base = hp === m.maxHp ? row.firstFull : row.firstNf;
            }
            let dmg = Math.max(1, Math.floor(base * mult));
            let cleared = segIndex + 1;
            if (m.bars > 1 && segIndex > 0) {
              [dmg, cleared] = calculateBossSegmentDamage(dmg, hp, segHp, 0, segIndex);
            }
            if (dmg >= hp) {
              // Lethal: Endure Token (20%, once), then Focus Band (10% per stack)
              if (!endureUsed && rand() < 0.2) {
                endureUsed = true;
                dmg = hp - 1;
                per[mi].saves++;
              } else if (rand() < (m.items.FOCUS_BAND ?? 0) / 10) {
                dmg = hp - 1;
                per[mi].saves++;
              }
            }
            hp -= dmg;
            dealtTotal += dmg;
            if (m.bars > 1 && cleared <= segIndex) {
              const broken = segIndex - Math.max(0, cleared - 1);
              segIndex = Math.max(0, cleared - 1);
              if (wild) {
                for (let b = 0; b < broken; b++) {
                  const remaining = segIndex + (broken - b - 1);
                  bossBoost(remaining <= 1 ? 2 : 1);
                }
              }
            }
            if (hp <= 0) {
              koed = true;
              break;
            }
            if (row.kingsRock && rand() < (ace.kr * 10) / 100) {
              flinch = true;
            }
            if (row.ownFlinch > 0 && rand() < row.ownFlinch) {
              flinch = true;
            }
          }
          enemyFlinched = flinch;
          // Shell Bell x Healing Charm, on the damage actually dealt
          const heal = Math.floor(((dealtTotal * ace.shellBellStacks) / 8) * ace.healMult);
          aceHp = Math.min(ace.maxHp, aceHp + heal);
          metronome++;
          if (row.selfDefDrop) {
            defDrops = Math.min(6, defDrops + 1);
          }
        };

        const enemyAct = (): boolean => {
          if (enemyFlinched) {
            return true;
          }
          enemyAttacked = true;
          const dmg = rollEnemyHit();
          if (dmg <= 0) {
            return true;
          }
          hitsTaken++;
          per[mi].hitsTaken++;
          const before = aceHp;
          if (!hurtAce(dmg)) {
            return false;
          }
          rollStatus();
          // The enemy's Shell Bell on the damage it dealt
          const dealt = Math.max(0, Math.min(dmg, before));
          hp = Math.min(m.maxHp, hp + Math.floor((dealt * (m.items.SHELL_BELL ?? 0)) / 8));
          // The ace flinches from the enemy's King's Rock only when it has not moved yet
          if (!aceAttacked && m.items.KINGS_ROCK) {
            aceFlinched =
              rand() < 1 - (1 - (m.items.KINGS_ROCK * 10) / 100) ** Math.max(1, Math.round(m.best?.hits ?? 1));
          }
          return true;
        };

        if (aceFirst) {
          aceAct();
          if (!koed && !enemyAct()) {
            outcome = "fainted";
            per[mi].aceFell++;
            per[mi].turns += turnsHere;
            break memberLoop;
          }
        } else {
          if (!enemyAct()) {
            outcome = "fainted";
            per[mi].aceFell++;
            per[mi].turns += turnsHere;
            break memberLoop;
          }
          aceAct();
        }

        if (koed) {
          kos++;
          if (turnsHere === 1) {
            per[mi].koTurn1++;
          }
          if (ace.beastBoost) {
            boost++;
          }
          per[mi].turns += turnsHere;
          // Turn end for the ace still applies before the next member comes in
          if (!aceTurnEnd(aceAttacked)) {
            outcome = "fainted";
            per[mi].aceFell++;
            break memberLoop;
          }
          continue memberLoop;
        }

        // Turn end: the enemy (Heal Token 20% + Leftovers, Life Orb, sand chip), then the ace
        // Local fork (2026-11-13): 08 명세 2번, the enemy's Life Orb cost also always leaves 1 HP
        if (enemyAttacked && m.items.LIFE_ORB && hp > 1) {
          hp -= Math.min(Math.floor(m.maxHp * [0.1, 0.15, 0.2][Math.min(3, m.items.LIFE_ORB) - 1]), hp - 1);
        }
        if (ace.sandSetter && m.weather === "SANDSTORM" && !m.sandImmune) {
          hp -= Math.floor(m.maxHp / 16);
        }
        if (hp <= 0) {
          if (rand() < (m.items.FOCUS_BAND ?? 0) / 10) {
            hp = 1;
          } else {
            kos++;
            per[mi].turns += turnsHere;
            if (!aceTurnEnd(aceAttacked)) {
              outcome = "fainted";
              per[mi].aceFell++;
              break memberLoop;
            }
            continue memberLoop;
          }
        }
        if (hp < m.maxHp) {
          hp = Math.min(m.maxHp, hp + Math.floor(m.maxHp * 0.2) + Math.floor(m.maxHp / 16) * (m.items.LEFTOVERS ?? 0));
        }
        if (!aceTurnEnd(aceAttacked)) {
          outcome = "fainted";
          per[mi].aceFell++;
          per[mi].turns += turnsHere;
          break memberLoop;
        }
      }
    }

    if (outcome === "swept") {
      swept++;
    } else if (outcome === "fainted") {
      fainted++;
    } else {
      stalled++;
    }
    kosSum += kos;
    turnsSum += turns;
    switchesSum += switches;
    hitsSum += hitsTaken;
    fbSum += fbSaves;
    reviverSum += reviver ? 0 : 1;
  }
  const n = MC_RUNS;
  return {
    runs: n,
    swept: swept / n,
    fainted: fainted / n,
    stalled: stalled / n,
    meanKOs: kosSum / n,
    meanTurns: turnsSum / n,
    meanSwitches: switchesSum / n,
    meanHitsTaken: hitsSum / n,
    meanFocusBandSaves: fbSum / n,
    reviverUsed: reviverSum / n,
    perMember: per.map(p => ({
      reached: p.reached / n,
      turns: p.reached > 0 ? p.turns / p.reached : 0,
      aceFell: p.reached > 0 ? p.aceFell / p.reached : 0,
      hitsTaken: p.reached > 0 ? p.hitsTaken / p.reached : 0,
      saves: p.reached > 0 ? p.saves / p.reached : 0,
      koTurn1: p.reached > 0 ? p.koTurn1 / p.reached : 0,
    })),
  };
}

// #endregion Monte Carlo of the turn arithmetic

const WEATHER_ABILITIES: Partial<Record<AbilityId, WeatherType>> = {
  [AbilityId.DROUGHT]: WeatherType.SUNNY,
  [AbilityId.ORICHALCUM_PULSE]: WeatherType.SUNNY,
  [AbilityId.DRIZZLE]: WeatherType.RAIN,
  [AbilityId.SAND_STREAM]: WeatherType.SANDSTORM,
  [AbilityId.SNOW_WARNING]: WeatherType.SNOW,
  [AbilityId.DESOLATE_LAND]: WeatherType.HARSH_SUN,
  [AbilityId.PRIMORDIAL_SEA]: WeatherType.HEAVY_RAIN,
  [AbilityId.DELTA_STREAM]: WeatherType.STRONG_WINDS,
};
const STRONG_WEATHERS = new Set([WeatherType.HARSH_SUN, WeatherType.HEAVY_RAIN, WeatherType.STRONG_WINDS]);

function weatherSetBy(p: Pokemon): WeatherType | null {
  const own = WEATHER_ABILITIES[p.getAbility().id];
  if (own != null) {
    return own;
  }
  return p.hasPassive() ? (WEATHER_ABILITIES[p.getPassiveAbility().id] ?? null) : null;
}

function expectedHits(move: Move, user: Pokemon): number {
  const attr = move.getAttrs("MultiHitAttr")[0];
  if (!attr) {
    return user.hasAbility(AbilityId.PARENTAL_BOND) && move.canBeMultiStrikeEnhanced(user) ? 1.25 : 1;
  }
  switch (attr.getMultiHitType()) {
    case MultiHitType.TWO:
      return 2;
    case MultiHitType.THREE:
      return 3;
    case MultiHitType.TEN:
      return 10;
    case MultiHitType.TWO_TO_FIVE:
      return user.hasAbility(AbilityId.SKILL_LINK) ? 5 : 3.1;
    default:
      return 1;
  }
}

describe.skipIf(!process.env.FORK_SIM)("Sim - analytic ace vs the final Endless trainer (wave 5850)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  const savedLog = console.log;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").mysteryEncounterChance(0).forkContentUnlocked(true).startingBiome(BiomeId.END);
  });

  afterEach(() => {
    console.log = savedLog;
    vi.restoreAllMocks();
  });

  const print = (line = "") => process.stdout.write(`${line}\n`);

  async function startRun(starter: SpeciesId, seed: string): Promise<void> {
    game.override.startingWave(WAVE).disableTrainerWaves();
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.ENDLESS);
      game.scene.offsetGym = false;
      const starters = generateStarters(game.scene, [starter]);
      game.scene.setSeed(seed);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    await game.phaseInterceptor.to("CommandPhase", false);
  }

  const enemyModifierList = (): EnemyPersistentModifier[] =>
    (game.scene as unknown as { enemyModifiers: EnemyPersistentModifier[] }).enemyModifiers;

  let reducer: EnemyPersistentModifier | null = null;

  async function setAllTokens(): Promise<void> {
    for (const [id, stacks] of Object.entries(TOKEN_CAP_AT_5850) as [keyof typeof TOKEN_CAP_AT_5850, number][]) {
      const token = modifierTypes[id]().withIdFromFunc(modifierTypes[id]).newModifier() as EnemyPersistentModifier;
      await game.scene.addEnemyModifier(token, true, true);
      token.stackCount = stacks;
    }
    reducer = enemyModifierList().find(m => m instanceof EnemyDamageReducerModifier) ?? null;
  }

  function setProtection(on: boolean): void {
    const list = enemyModifierList();
    const idx = reducer ? list.indexOf(reducer) : -1;
    if (on && idx < 0 && reducer) {
      list.push(reducer);
    } else if (!on && idx >= 0) {
      list.splice(idx, 1);
    }
  }

  function givePartyItem(key: "PIERCING_TOKEN" | "HEALING_CHARM", stacks: number): void {
    const mod = modifierTypes[key]().withIdFromFunc(modifierTypes[key]).newModifier() as PersistentModifier | null;
    if (mod) {
      game.scene.addModifier(mod, true);
      mod.stackCount = stacks;
    }
  }

  const caps: string[] = [];

  /** Gives `pokemon` `count` of `type`; the stack is capped at the item's own player cap (reported) */
  function give(pokemon: Pokemon, type: ModifierType, count: number, label: string): void {
    const mod = type.newModifier(pokemon) as PokemonHeldItemModifier | null;
    if (!mod) {
      caps.push(`${label}: no modifier`);
      return;
    }
    game.scene.addModifier(mod, true, false, false, true);
    const held = pokemon.getHeldItems().find(m => m.matchType(mod));
    if (!held) {
      caps.push(`${label}: not held`);
      return;
    }
    const cap = held.getMaxHeldItemCount(pokemon);
    if (count > cap) {
      caps.push(`${label}: wanted ${count}, cap ${cap}`);
    }
    held.stackCount = Math.min(count, cap);
  }

  function heldKey(pokemon: Pokemon, key: string): number {
    return pokemon
      .getHeldItems()
      .filter(m => m.type.id === key)
      .reduce((a, m) => a + m.stackCount, 0);
  }

  function formIndexOf(species: SpeciesId, formKey: string): number {
    const sp = speciesDataRegistry.getSpecies(species);
    const idx = sp.forms.findIndex(f => f.formKey === formKey);
    return Math.max(0, idx);
  }

  /** Builds the ace for `variant` on the field Pokémon */
  function configureAce(ace: PlayerPokemon, spec: AceSpec, variant: Variant, stagesOn: boolean): number[] {
    const { scene } = game;
    for (const held of scene.findModifiers(m => m instanceof PokemonHeldItemModifier && m.pokemonId === ace.id, true)) {
      scene.removeModifier(held);
    }
    ace.formIndex = formIndexOf(spec.species, spec.formKey);
    if (spec.fusion) {
      ace.fusionSpecies = speciesDataRegistry.getSpecies(spec.fusion.species);
      ace.fusionFormIndex = formIndexOf(spec.fusion.species, spec.fusion.formKey);
      ace.fusionAbilityIndex = 0;
      ace.fusionShiny = false;
      ace.fusionVariant = 0;
      ace.fusionGender = Gender.GENDERLESS;
      ace.fusionLuck = 0;
      ace.fusionCustomPokemonData = new CustomPokemonData();
    }
    const ivs = variant.tier === "novice" ? noviceIvs(spec.key) : [31, 31, 31, 31, 31, 31];
    ace.ivs = [...ivs];
    // Local fork (2026-11-13): every EV at its cap, HP 504 since "노력치 아이템도 hp만 상한을 두배로" (was all 252)
    ace.evs = PERMANENT_STATS.map(s => getEvCap(s));
    ace.level = LEVEL_CAP * variant.levelMult;
    ace.abilityIndex = 0;
    ace.passive = variant.tier === "expert";
    ace.customPassiveSpecies = variant.tier === "expert" && spec.expertCustomPassive ? [spec.species] : [];
    ace.setCustomNature(spec.nature);
    ace.status = null;

    const party = scene.getPlayerParty();
    for (const stat of PERMANENT_STATS) {
      const vit = (modifierTypes.BASE_STAT_BOOSTER() as ModifierTypeGenerator).generateType(party, [stat]);
      give(ace, vit!, ivs[stat], `vitamin ${Stat[stat]}`);
      const candy = (modifierTypes.IV_CANDY() as ModifierTypeGenerator).generateType(party, [stat]);
      give(ace, candy!, ivs[stat], `IV candy ${Stat[stat]}`);
    }
    for (const [key, count] of COMMON_HELD) {
      give(ace, modifierTypes[key]().withIdFromFunc(modifierTypes[key]), count, key);
    }
    give(
      ace,
      modifierTypes[spec.category === "physical" ? "MUSCLE_BAND" : "WISE_GLASSES"]().withIdFromFunc(
        modifierTypes[spec.category === "physical" ? "MUSCLE_BAND" : "WISE_GLASSES"],
      ),
      99,
      spec.category === "physical" ? "MUSCLE_BAND" : "WISE_GLASSES",
    );
    for (const type of spec.boosters) {
      const booster = (modifierTypes.ATTACK_TYPE_BOOSTER() as ModifierTypeGenerator).generateType(party, [type]);
      give(ace, booster!, 99, `booster ${PokemonType[type]}`);
    }
    if (variant.tier === "novice") {
      give(ace, modifierTypes.TRAINING_SHACKLES().withIdFromFunc(modifierTypes.TRAINING_SHACKLES), 2, "SHACKLES");
    }
    ace.moveset = spec.moves.map(id => new PokemonMove(id));
    ace.calculateStats();
    ace.hp = ace.getMaxHp();
    setStages(ace, spec, variant, stagesOn);
    return ivs;
  }

  /**
   * The ace's stat stages: its entry stages (Intrepid Sword) always; with `bpOn`, the Baton Pass chain's +6 Atk / SpA /
   * Spe on top (lost after a switch or the Reviver Seed)
   */
  function setStages(ace: PlayerPokemon, spec: AceSpec, variant: Variant, bpOn: boolean): void {
    for (const s of [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD, Stat.ACC, Stat.EVA] as const) {
      ace.setStatStage(s, 0);
    }
    for (const [s, v] of Object.entries(spec.entryStages ?? {})) {
      ace.setStatStage(Number(s) as Stat.ATK, v);
    }
    if (bpOn && variant.bp) {
      ace.setStatStage(Stat.ATK, 6);
      ace.setStatStage(Stat.SPATK, 6);
      ace.setStatStage(Stat.SPD, 6);
    }
  }

  function setTurnHits(p: Pokemon, hitCount: number, hitsLeft: number): void {
    p.turnData.hitCount = hitCount;
    p.turnData.hitsLeft = hitsLeft;
  }

  /** The ace's move against `target` (simulated damage calls) */
  function aceMoveRow(ace: PlayerPokemon, target: EnemyPokemon, moveId: MoveId): AceMoveRow {
    const move = allMoves[moveId];
    const lensStacks = heldKey(ace, "MULTI_LENS");
    const lens = lensStacks > 0 && move.canBeMultiStrikeEnhanced(ace);
    const hitCount = lens ? lensStacks + 1 : 1;
    const blockCrit = target.hasAbilityWithAttr("BlockCritAbAttr");
    const critStage = target.getCritStage(ace, move);
    const isCritical = !blockCrit && critStage >= 3;
    const maxHp = target.getMaxHp();
    const calc = (full: boolean, hitsLeft: number, tokens: boolean) => {
      target.hp = full ? maxHp : maxHp - 1;
      setTurnHits(ace, hitCount, hitsLeft);
      setProtection(tokens);
      const r = target.getAttackDamage({ source: ace, move, simulated: true, isCritical });
      return r.damage;
    };
    const firstFull = calc(true, hitCount, true);
    const firstNf = calc(false, hitCount, true);
    const extra = lens ? calc(false, hitCount - 1, true) : 0;
    // One hit as if no lens applied: hitsLeft 0 makes the lens see an "other" extra hit (no multiplier)
    const tokSingle = lens ? calc(false, 0, true) : firstNf;
    const rawSingle = lens ? calc(false, 0, false) : calc(false, hitCount, false);
    setProtection(true);
    setTurnHits(ace, 0, -1);
    target.hp = maxHp;
    let acc = move.calculateBattleAccuracy(ace, target, true);
    acc = acc === -1 ? 1 : Math.min(1, (acc * ace.getAccuracyMultiplier(target, move)) / 100);
    const flinchAttr = move.getAttrs("FlinchAttr")[0] as unknown as { chance?: number } | undefined;
    return {
      move: MoveId[moveId],
      type: PokemonType[move.type],
      physical: move.category === MoveCategory.PHYSICAL,
      priority: move.priority,
      acc,
      lens,
      firstFull,
      firstNf,
      extra,
      rawSingle,
      tokSingle,
      effectiveness: target.getMoveEffectiveness(ace, move, false, true),
      kingsRock: !flinchAttr,
      ownFlinch: flinchAttr && move.chance > 0 ? move.chance / 100 : 0,
      selfDefDrop: moveId === MoveId.DRAGON_ASCENT || moveId === MoveId.HYPERSPACE_FURY,
    };
  }

  /** The enemy's attacking moves against the ace (Damage Tokens on) */
  function enemyMoveRows(enemy: EnemyPokemon, ace: PlayerPokemon): EnemyMoveRow[] {
    const rows: EnemyMoveRow[] = [];
    const lensStacks = heldKey(enemy, "MULTI_LENS");
    for (const pm of enemy.getMoveset()) {
      const move = pm.getMove();
      if (move.category === MoveCategory.STATUS) {
        continue;
      }
      const lens = lensStacks > 0 && move.canBeMultiStrikeEnhanced(enemy);
      const hitCount = lens ? lensStacks + 1 : 1;
      const calc = (crit: boolean, hitsLeft: number) => {
        setTurnHits(enemy, hitCount, hitsLeft);
        ace.hp = ace.getMaxHp();
        return ace.getAttackDamage({ source: enemy, move, simulated: true, isCritical: crit }).damage;
      };
      let dmg = calc(false, hitCount);
      let dmgCrit = calc(true, hitCount);
      if (lens) {
        dmg += lensStacks * calc(false, hitCount - 1);
        dmgCrit += lensStacks * calc(true, hitCount - 1);
      }
      setTurnHits(enemy, 0, -1);
      const stage = Math.min(3, Math.max(0, ace.getCritStage(enemy, move)));
      const pCrit = ace.hasAbilityWithAttr("BlockCritAbAttr") ? 0 : [1 / 24, 1 / 8, 1 / 2, 1][stage];
      let acc = move.calculateBattleAccuracy(enemy, ace, true);
      acc = acc === -1 ? 1 : Math.min(1, (acc * enemy.getAccuracyMultiplier(ace, move)) / 100);
      const hits = expectedHits(move, enemy);
      rows.push({
        move: MoveId[move.id],
        type: PokemonType[move.type],
        physical: move.category === MoveCategory.PHYSICAL,
        priority: move.priority,
        acc,
        hits,
        dmg,
        dmgCrit,
        pCrit,
        expected: acc * hits * ((1 - pCrit) * dmg + pCrit * dmgCrit),
      });
    }
    return rows;
  }

  function memberItems(p: Pokemon): Record<string, number> {
    const out: Record<string, number> = {};
    for (const key of [
      "LEFTOVERS",
      "SHELL_BELL",
      "FOCUS_BAND",
      "QUICK_CLAW",
      "KINGS_ROCK",
      "LIFE_ORB",
      "SCOPE_LENS",
      "MULTI_LENS",
      "WIDE_LENS",
      "CHOICE_SCARF",
      "TRAINING_SHACKLES",
    ]) {
      const n = heldKey(p, key);
      if (n > 0) {
        out[key] = n;
      }
    }
    return out;
  }

  function nameOf(p: Pokemon): string {
    const head = `${SpeciesId[p.species.speciesId]}${p.getFormKey() ? `-${p.getFormKey()}` : ""}`;
    if (p.isFusion() && p.fusionSpecies) {
      return `${head}+${SpeciesId[p.fusionSpecies.speciesId]}${p.getFusionFormKey() ? `-${p.getFusionFormKey()}` : ""}`;
    }
    return head;
  }

  interface BuiltParty {
    label: string;
    trainer: string;
    seed: string;
    wild: boolean;
    members: EnemyPokemon[];
    battle: Battle;
  }

  async function buildTrainerParty(type: TrainerType, seed: string): Promise<BuiltParty> {
    const { scene } = game;
    scene.setSeed(seed);
    scene.resetSeed(WAVE);
    const trainer = new Trainer(type, TrainerVariant.DEFAULT);
    const battle = new Battle(scene.gameMode, {
      waveIndex: WAVE,
      battleType: BattleType.TRAINER,
      trainer,
      double: false,
    });
    scene.currentBattle = battle;
    for (let e = 0; e < (battle.enemyLevels?.length ?? 0); e++) {
      battle.enemyParty[e] = trainer.genPartyMember(e);
    }
    rollTrainerBattleForm(battle.enemyParty);
    // Local fork (2026-11-13): the boss bars and their HP correction (08 명세 5번 보정 B), right after the battle form
    // as in EncounterPhase.start, so the members' bossSegments and getMaxHp() below are the game's
    applyEndlessTrainerBossBars(battle);
    regenerateModifierPoolThresholds(scene.getEnemyField(), ModifierPoolType.TRAINER);
    await scene.generateEnemyModifiers();
    return {
      label: `${TrainerType[type]} ${seed}`,
      trainer: TrainerType[type],
      seed,
      wild: false,
      members: [...battle.enemyParty],
      battle,
    };
  }

  async function buildWildBoss(seed: string): Promise<BuiltParty> {
    const { scene } = game;
    scene.setSeed(seed);
    scene.resetSeed(WAVE);
    const battle = new Battle(scene.gameMode, { waveIndex: WAVE, battleType: BattleType.WILD, double: false });
    scene.currentBattle = battle;
    const level = battle.enemyLevels?.[0] ?? 1;
    const species = scene.randomSpecies(WAVE, level, true);
    const boss = !!scene.getEncounterBossSegments(WAVE, level, species);
    battle.enemyParty[0] = scene.addEnemyPokemon(species, level, TrainerSlot.NONE, boss, true);
    rollWildBattleForm(battle.enemyParty[0]);
    regenerateModifierPoolThresholds(scene.getEnemyField(), ModifierPoolType.WILD);
    await scene.generateEnemyModifiers();
    return {
      label: `WILD ${seed}`,
      trainer: "WILD_END_BOSS",
      seed,
      wild: true,
      members: [...battle.enemyParty],
      battle,
    };
  }

  /** The arena weather for one matchup: the foe's own weather on entry unless the ace's is a strong one */
  function weatherFor(aceWeather: WeatherType | null, foe: EnemyPokemon): WeatherType {
    const foeWeather = weatherSetBy(foe);
    if (aceWeather != null && STRONG_WEATHERS.has(aceWeather)) {
      return aceWeather;
    }
    return foeWeather ?? aceWeather ?? WeatherType.NONE;
  }

  function setWeather(w: WeatherType): void {
    game.scene.arena.weather = w === WeatherType.NONE ? null : new Weather(w, 5);
  }

  const acesToRun = ACES.filter(a => !ONLY_ACES || ONLY_ACES.includes(a.key));

  it.each(acesToRun.map(a => ({ key: a.key, label: a.label })))(
    "$key $label: stats, one hit each way and the turn arithmetic against the pool at wave 5850",
    async ({ key }) => {
      const spec = ACES.find(a => a.key === key)!;
      await startRun(spec.species, `ace-${key}`);
      console.log = () => {};
      const { scene } = game;
      const ace = game.field.getPlayerPokemon();
      scene.clearEnemyHeldItemModifiers();
      await setAllTokens();
      givePartyItem("PIERCING_TOKEN", 10);
      givePartyItem("HEALING_CHARM", 5);

      // Parties: every pool trainer x seeds, plus the old wild boss. Each party is built right before it is used:
      // `updateModifiers` drops held items whose holder is not in the current battle, so a party's items only last
      // while its battle is current.
      const partySpecs: { type: TrainerType | null; seed: string }[] = [
        ...ENDLESS_FINAL_TRAINER_POOL.flatMap(type => SEEDS.map(seed => ({ type, seed }))),
        ...SEEDS.map(seed => ({ type: null, seed })),
      ];
      const variantOut = VARIANTS.map(variant => ({
        variant,
        stats: null as Record<string, unknown> | null,
        capNotes: [] as string[],
        aceSim: null as AceSim | null,
        parties: [] as unknown[],
      }));
      for (const ps of partySpecs) {
        scene.clearEnemyHeldItemModifiers();
        const party = ps.type == null ? await buildWildBoss(ps.seed) : await buildTrainerParty(ps.type, ps.seed);
        for (const [variantIndex, variant] of VARIANTS.entries()) {
          if (party.wild && !WILD_VARIANTS.has(variant.id)) {
            continue;
          }
          caps.length = 0;
          const ivs = configureAce(ace, spec, variant, true);
          const aceWeather =
            variant.tier === "expert" ? weatherSetBy(ace) : (WEATHER_ABILITIES[ace.getAbility().id] ?? null);
          const stats = {
            maxHp: ace.getMaxHp(),
            statsRaw: [...ace.stats],
            effective: BATTLE_STATS.map(s => ace.getEffectiveStat(s)),
            ability: AbilityId[ace.getAbility().id],
            passive: ace.hasPassive() ? AbilityId[ace.getPassiveAbility().id] : null,
            types: ace.getTypes().map(t => PokemonType[t]),
            held: ace
              .getHeldItems()
              .map(m => `${m.type.id ?? m.type.name}x${m.stackCount}`)
              .join(", "),
            ivs,
            nature: Nature[ace.getNature()],
            level: ace.level,
            weather: aceWeather == null ? "NONE" : WeatherType[aceWeather],
          };
          const capNotes = [...caps];
          const aceSim: AceSim = {
            maxHp: ace.getMaxHp(),
            category: spec.category,
            types: ace.getTypes(),
            levitate: ace.hasAbility(AbilityId.LEVITATE),
            ghost: ace.isOfType(PokemonType.GHOST),
            qc: heldKey(ace, "QUICK_CLAW"),
            fb: heldKey(ace, "FOCUS_BAND"),
            kr: heldKey(ace, "KINGS_ROCK"),
            lifeOrbLoss: [0, 0.1, 0.15, 0.2][Math.min(3, heldKey(ace, "LIFE_ORB"))],
            leftovers: heldKey(ace, "LEFTOVERS"),
            shellBellStacks: heldKey(ace, "SHELL_BELL"),
            healMult: 1 + 0.1 * 5,
            beastBoost: ace.hasAbility(AbilityId.BEAST_BOOST),
            baseAtkStage: variant.bp ? 6 : (spec.entryStages?.[Stat.ATK] ?? 0),
            bp: variant.bp,
            sandSetter: aceWeather === WeatherType.SANDSTORM,
          };

          const members: MemberCalc[] = [];
          for (const [slot, foe] of party.members.entries()) {
            const w = weatherFor(aceWeather, foe);
            setWeather(w);
            setStages(ace, spec, variant, true);
            ace.hp = ace.getMaxHp();
            const aceMoves = spec.moves.map(id => aceMoveRow(ace, foe, id));
            const enemyMoves = enemyMoveRows(foe, ace);
            const aceSpe = ace.getEffectiveStat(Stat.SPD);
            let aceMovesLost = aceMoves;
            let aceSpeLost = aceSpe;
            if (variant.bp) {
              setStages(ace, spec, variant, false);
              aceMovesLost = spec.moves.map(id => aceMoveRow(ace, foe, id));
              aceSpeLost = ace.getEffectiveStat(Stat.SPD);
              setStages(ace, spec, variant, true);
            }
            const best = enemyMoves.reduce<EnemyMoveRow | null>(
              (b, r) => (b == null || r.expected > b.expected ? r : b),
              null,
            );
            const foeTypes = foe.getTypes();
            members.push({
              slot,
              name: nameOf(foe),
              types: foeTypes.map(t => PokemonType[t]),
              ability: AbilityId[foe.getAbility().id],
              passive: foe.hasPassive() ? AbilityId[foe.getPassiveAbility().id] : null,
              level: foe.level,
              bars: foe.isBoss() ? foe.bossSegments : 0,
              maxHp: foe.getMaxHp(),
              stats: [...foe.stats],
              spe: foe.getEffectiveStat(Stat.SPD),
              items: memberItems(foe),
              sturdy: foe.hasAbility(AbilityId.STURDY),
              unaware: foe.hasAbility(AbilityId.UNAWARE),
              blockCrit: foe.hasAbilityWithAttr("BlockCritAbAttr"),
              traps:
                (foe.hasAbility(AbilityId.SHADOW_TAG) && !aceSim.ghost)
                || (foe.hasAbility(AbilityId.ARENA_TRAP)
                  && !aceSim.levitate
                  && !aceSim.types.includes(PokemonType.FLYING)
                  && !aceSim.ghost)
                || (foe.hasAbility(AbilityId.MAGNET_PULL) && aceSim.types.includes(PokemonType.STEEL)),
              sandImmune:
                foeTypes.some(t => t === PokemonType.ROCK || t === PokemonType.GROUND || t === PokemonType.STEEL)
                || foe.hasAbility(AbilityId.OVERCOAT)
                || foe.hasAbility(AbilityId.MAGIC_GUARD)
                || foe.hasAbility(AbilityId.SAND_VEIL)
                || foe.hasAbility(AbilityId.SAND_RUSH)
                || foe.hasAbility(AbilityId.SAND_FORCE),
              weather: WeatherType[w],
              aceMoves,
              aceMovesLost,
              aceSpe,
              aceSpeLost,
              enemyMoves,
              best,
              statWeights: BATTLE_STATS.map(s => foe.getStat(s, false)),
            });
          }
          setWeather(WeatherType.NONE);
          const rand = mulberry32(hashString(`${spec.key}-${variant.id}-${party.label}`));
          const mc = simulateParty(aceSim, members, party.wild, rand);
          const vo = variantOut[variantIndex];
          vo.stats ??= stats;
          vo.aceSim ??= aceSim;
          vo.capNotes = capNotes;
          vo.parties.push({
            party: party.label,
            trainer: party.trainer,
            seed: party.seed,
            wild: party.wild,
            members,
            mc,
          });
          print(
            `${spec.key} ${variant.id} ${party.label}: swept ${(mc.swept * 100).toFixed(0)}% fainted ${(mc.fainted * 100).toFixed(0)}% stalled ${(mc.stalled * 100).toFixed(0)}% KOs ${mc.meanKOs.toFixed(2)} turns ${mc.meanTurns.toFixed(1)} hits ${mc.meanHitsTaken.toFixed(2)} switches ${mc.meanSwitches.toFixed(2)}`,
          );
        }
        for (const p of party.members) {
          p.destroy();
        }
      }
      for (const vo of variantOut) {
        print(`${spec.key} ${vo.variant.id} stats: ${JSON.stringify(vo.stats)} caps ${vo.capNotes.join("; ") || "ok"}`);
      }
      const out = { ace: spec, variants: variantOut };
      if (OUT_DIR) {
        fs.mkdirSync(OUT_DIR, { recursive: true });
        fs.writeFileSync(path.join(OUT_DIR, `ace-${key}.json`), JSON.stringify(out));
        print(`wrote ${path.join(OUT_DIR, `ace-${key}.json`)}`);
      }
      expect(ace.getMaxHp()).toBeGreaterThan(0);
    },
    3_600_000,
  );
});
