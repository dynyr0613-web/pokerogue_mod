/**
 * Local fork (2026-11-13) experiment harness, skipped unless FORK_SIM is set.
 *
 * The 5850 ace experiment: can one fully grown player ace sweep the final Endless wave (5850, now a single battle
 * against one of ENDLESS_FINAL_TRAINER_POOL, endless-final-trainer.ts)? Every battle is a real Endless run started on
 * wave 5850 in the END biome through the normal title -> EncounterPhase path, with the real generated enemy party
 * (items, fusions, forms) for the seed, the enemy buff tokens at their 5850 caps (added before the encounter, so the
 * wild baseline's fusion token acts too), and the real phase system turn after turn (this harness steps the phase
 * queue itself and answers the command / party prompts).
 *
 * The grid (fixed by the lead, see ACES / VARIANTS / OPPONENTS below):
 *   07 (2026-11-13): 7 aces x 7 variants (novice L1/L3, expert L1/L3/L10, expert+Baton Pass L1/L3) x 5 pool trainers
 *   x 2 seeds = 490, plus the old wild END Paradox boss (disableTrainerWaves) for every ace at novice L1 and expert L1
 *   x 2 seeds = 28.
 *   Local fork (2026-11-13), 08 명세 6번 re-run on the patched game (items 1-5 in src): the default variants are now the
 *   five level points NE / NC / EI / EC / EE (novice at its level estimate and at the EXP cap, expert at the
 *   intermediate estimate, at the EXP cap and at the expert estimate; levels in VARIANTS), run with
 *   FORK_SIM_SEEDS=s1..s10 x the 5 trainers. The ace build follows 08 명세 6번: ONE Choice item (Choice Band for a
 *   physical ace, Choice Specs for a special one; no Choice Scarf, no Choice Armor) and no Training Shackles for the
 *   novice. FORK_SIM_BUILD07=1 restores the 07 build (all four Choice items, the novice's Training Shackles x2).
 *   NOTE: the spec calls one Choice item the "in-game rule", but a player Pokémon can hold every Choice item at once
 *   (only enemies have a Choice cap, enemy-custom-items.ts); this follows the spec's build anyway.
 *   Local fork (2026-11-13), 09 re-run on the game with the level following (enemy levels x max(1, P / C) from wave
 *   4000; x max(1, P / C) ^ 0.5 since the 3rd balance patch, 09 명세 1번, which the recorded factor follows as it
 *   calls the game's own function), the proportional boss bars and the HP growth items: the user settled the Choice
 *   question, "플레이어에게는
 *   딱히 구애 아이템 제한을 넣지 않습니다", so the DEFAULT build holds all four Choice items again (Choice Band + Choice
 *   Specs + Choice Scarf + Choice Armor, for novice and expert alike, as the economy sim caps them all) and the novice
 *   still holds no Training Shackles (the 08 choice). FORK_SIM_BUILD08=1 gives the 08 build (one Choice item, no
 *   Shackles); FORK_SIM_BUILD07=1 the 07 one (four Choice items, the novice's Shackles x2). Same variants, aces,
 *   trainers, tokens and AI as the 08 run. The enemy levels now follow the ace (the highest party level), so every
 *   record also carries the follow factor the battle was made with (aceBuild.enemyLevelFollow).
 *   Local fork (2026-11-13), 10 re-run on the 3rd balance patch (09 명세: f = max(1, P / C) ^ 0.5, HP Up back to 10%,
 *   the enemy's HP IV Candy 3%, Forged Steel up to 10, the new Guard Token): the 09 build (four Choice items, no
 *   Shackles) plus this patch's player items at the economy sim's figures for wave 5850 (sim-5850-ace-economy, round
 *   3): the party holds 방호 토큰 (Guard Token) x65 (its cap; even a player who only picks it as filler has 65 by wave
 *   ~1000-1200) and the ace holds 단조강철 (Forged Steel) x2 (the median forge visits by wave 5850; nothing else gives
 *   it). FORK_SIM_GUARD / FORK_SIM_FORGED change the counts (ablations). HP Up 10% and the IV candies come from the
 *   game code as before. The build tag is "10" (the 09 build plus these two items; the counts are in every record).
 *   The hand check now reads Body Press's Defense and Foul Play's target Attack the way getBaseDamage does
 *   (VariableAtkAttr / VariableDefAttr), and its token step includes the Guard Tokens.
 *   Local fork (2026-11-13), 11 re-run on the 4th balance patch (10 명세: the player's Multi Lens cap 4 -> 3, the boss-bar
 *   overflow log base 2 -> 2.4, Tinkaton's Forge for a Steel type only with two pieces of Forged Steel a forge): the
 *   10 build with the ace's Multi Lenses at the player cap (PLAYER_HELD_ITEM_CAPS.MULTI_LENS, 3) and Forged Steel by
 *   type: a Steel-type ace (A5 Kartana Grass/Steel, A7 Mega Rayquaza + Zacian-Crowned Dragon/Steel; checked against the
 *   engine's types with the forge's own rule, isForgeEligibleSteelPokemon) holds 4 = 2 pieces a forge x the median 2
 *   forge visits by wave 5850 (round-3 economy sim, mean 2.30), the others none (the forge turns them away).
 *   FORK_SIM_FORGED=n still gives every ace n; FORK_SIM_LENS=n gives n lenses (above the cap, the cap is raised for the
 *   run, so the 4-lens ablation works); FORK_SIM_LOG_BASE=x sets BOSS_SEGMENT_OVERFLOW.logBase for the run (2 = the
 *   old rule). The build tag is "11"; FORK_SIM_FORGED set gives the old tags ("10", or "09" with no Guard Tokens and no
 *   Forged Steel). Every record carries the lens count, the log base and the Forged Steel pieces (`run`), every ace hit
 *   the enemy's bars before / after it and its strike number in the turn, and every enemy the turns the ace attacked
 *   it and the attacking turns it took to fall (`aceAttackTurns`, `turnsToKo`; the summary row has them for the main
 *   ace, the trainer's Pokémon with the most bars, with the bars broken per turn and per strike).
 *   A tag names the item build only: the 07-10 runs played with 4 lenses and log base 2, the 11 one with the game's 3 and
 *   2.4, so a run on other rules gets them appended, "@L<lenses>/<log base>" (FORK_SIM_FORGED=0 on this code: "10@L3/2.4";
 *   FORK_SIM_BUILD07=1 FORK_SIM_LENS=4 FORK_SIM_LOG_BASE=2: "07"; the 4-lens ablation: "11@L4/2.4"), and records of
 *   different rules never share a tag in a merged summary (records written before the 11 run have no `run`). Each
 *   enemy also says what took its last HP (`koBy`: the ace's hit, or "other": recoil, its own Life Orb, weather, a
 *   support's hit), and `koTurn` / `turnsToKo` count either.
 *
 * Player AI each turn: the usable move with the highest expected damage on the current target (simulated
 * `getAttackDamage` x accuracy); Choice-locked into a move that does 0 (immunity) -> switch to a support, then back
 * to the ace (counted); locked into a move with no PP left -> Struggle if that knocks the target out, else the same
 * switch (counted). No Tera, no items used in battle. The ace fainting (after its Reviver Seed) ends the battle (not
 * swept), 300 turns cap. Every ace move has PP Max (ppUp 3).
 *
 * The real battle RNG: GameManager's constructor makes `randBattleSeedInt` always roll its maximum (a test default that
 * would turn off Focus Band, the Endure Token, Quick Claw, crit rolls and the damage spread); this harness puts the
 * real one back for every battle. Same seed -> same battle (checked: two runs of the smoke set are identical).
 *
 * Instrumentation (prototype patches, restored after every test; no vi spies on the hot path): every real
 * `getAttackDamage` (damage after all tokens, the value right before the token step = "raw"), every `damage()` call
 * (dealt, Focus Band / Endure Token saves, boss-bar clamps), every heal (Leftovers / Shell Bell / Heal Token tagged by
 * the modifier that queued it), the status tokens, the move order of each turn.
 *
 * Env:
 *   FORK_SIM=1                      run at all
 *   FORK_SIM_ACES=A1,A5             aces (default all A1..A7)
 *   FORK_SIM_VARIANTS=NE,EC         variants (default the 08 re-run's NE NC EI EC EE; the 07 ones N1 N3 E1 E3 E10 B1
 *                                   B3 are multiples of LEVEL_CAP, which is now the patched 320,222)
 *   FORK_SIM_TRAINERS=GIOVANNI,WILD opponents: GIOVANNI ROSE LUSAMINE GHETSIS CYRUS WILD (default the 5 trainers + WILD)
 *                                   (WILD only runs for N1 and E1, as the grid says)
 *   FORK_SIM_SEEDS=s1,s2            seeds (default s1,s2)
 *   FORK_SIM_SHARD=i/n              every n-th battle of the selection starting at the i-th (parallel processes)
 *   FORK_SIM_LIMIT=n                run only the first n battles of the selection (smoke tests)
 *   FORK_SIM_OUT=<dir>              output directory (default <os tmp>/sim5850-ace-battle); one JSON per battle
 *                                   (<key>.json) + summary-<tag>.json for this process
 *   FORK_SIM_TAG=<tag>              summary file tag (default: pid)
 *   FORK_SIM_MAX_TURNS=300          turn cap
 *   FORK_SIM_BUILD07=1              the 07 build: all four Choice items, and the novice holds Training Shackles x2
 *   FORK_SIM_BUILD08=1              the 08 build: ONE Choice item (Band for a physical ace, Specs for a special one),
 *                                   no Shackles (the default, since the 09 re-run: all four Choice items, no Shackles)
 *   FORK_SIM_NOVICE_NO_SHACKLES=1   with FORK_SIM_BUILD07: the novice ace holds no Training Shackles (sensitivity run)
 *   FORK_SIM_GUARD=65               the party's Guard Tokens (default 65, the cap; 0 = none, the 09 run)
 *   FORK_SIM_FORGED=2               every ace's Forged Steel pieces (default since the 11 run: 4 for a Steel-type ace,
 *                                   0 for the others; the 10 run gave every ace 2; 0 = none, the 09 run; cap 10)
 *   FORK_SIM_LENS=3                 the ace's Multi Lenses (default the player cap, PLAYER_HELD_ITEM_CAPS.MULTI_LENS = 3
 *                                   since the 4th balance patch; above it the cap is raised for the run: 4 = the old cap)
 *   FORK_SIM_LOG_BASE=2.4           BOSS_SEGMENT_OVERFLOW.logBase for the run (default the game's, 2.4; 2 = the old rule)
 *   FORK_SIM_MOVES=A2:M1/M2/M3/M4   replace an ace's moveset, ";" between aces (sensitivity run)
 *   FORK_SIM_MERGE=1                only merge every <key>.json in FORK_SIM_OUT into summary-all.json + summary-all.txt
 */
import { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { PhaseManager } from "#app/phase-manager";
// Local fork (2026-11-13): 11 re-run, the player's Multi Lens cap (10 명세 1번), raised for the FORK_SIM_LENS ablation
import { PLAYER_HELD_ITEM_CAPS } from "#balance/endless-balance";
// Local fork (2026-11-13): 09 re-run, the level-following factor each battle was made with
import {
  getEndlessPlayerLevelFollowFactor,
  getHighestPlayerPartyLevel,
  getNaturalMaxExpLevel,
} from "#balance/endless-level-scaling";
import { allMoves, modifierTypes } from "#data/data-lists";
import { Gender } from "#data/gender";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { FormChangeItem } from "#enums/form-change-item";
import { GameModes } from "#enums/game-modes";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { Nature } from "#enums/nature";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { EFFECTIVE_STATS, PERMANENT_STATS, Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { TrainerType } from "#enums/trainer-type";
import { UiMode } from "#enums/ui-mode";
import { EnemyPokemon, type PlayerPokemon, Pokemon } from "#field/pokemon";
import { getCriticalHitMultiplier } from "#modifiers/battle-held-items";
import { FORGED_STEEL } from "#modifiers/custom-held-items"; // Local fork (2026-11-13): 11 re-run, pieces per forge
// Local fork (2026-11-13): 10 re-run, the Guard Tokens in the hand check's token step
import {
  getEnemyDamageBoostedValue,
  getGuardedDamageValue,
  getGuardTokenMultiplier,
  getPiercedReductionMultiplier,
} from "#modifiers/enemy-damage-tokens";
import { getEvCap } from "#modifiers/ev-items"; // Local fork (2026-11-13): HP's EV cap 504
import {
  BerryModifier,
  EnemyAttackStatusEffectChanceModifier,
  EnemyDamageBoosterModifier,
  EnemyDamageReducerModifier,
  EnemyEndureChanceModifier,
  EnemyPersistentModifier,
  EnemyTurnHealModifier,
  HitHealModifier,
  type PersistentModifier,
  PokemonHeldItemModifier,
  PokemonInstantReviveModifier,
  PokemonMultiHitModifier,
  SurviveDamageModifier,
  TurnHealModifier,
} from "#modifiers/modifier";
import { type ModifierType, ModifierTypeGenerator } from "#modifiers/modifier-type";
import { applyMoveAttrs } from "#moves/apply-attrs";
import { PokemonMove } from "#moves/pokemon-move";
// Local fork (2026-11-13): 11 re-run, the forge's Steel-type rule (10 명세 3번) for the ace's Forged Steel
import { isForgeEligibleSteelPokemon } from "#mystery-encounters/tinkaton-forge-encounter";
import type { CommandPhase } from "#phases/command-phase";
import type { MovePhase } from "#phases/move-phase";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import type { PhaseString } from "#types/phase-types";
import { NumberHolder } from "#utils/common";
import { BOSS_SEGMENT_OVERFLOW } from "#utils/damage"; // Local fork (2026-11-13): 11 re-run, FORK_SIM_LOG_BASE
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// #region Grid

const WAVE = 5850;
/**
 * The player's EXP level cap at wave 5850 (getMaxExpLevel, measured by sim-wave5850-enemy-side).
 * Local fork (2026-11-13): 69,222 -> 320,222, 08 명세 4번 adds S(5850) = 251,000 (endless-level-scaling.ts)
 */
const LEVEL_CAP = 320_222;
/**
 * Local fork (2026-11-13): 08 명세 6번 re-run, the ace's level at wave 5850 per player profile: the median "ace level
 * model at 5850" (wave EXP lifts the ace to getMaxExpLevel, Candy Pile / Rare Candy / Rarer Candy levels with the Candy
 * Jars held on top) of the economy re-measurement under the patched reward rules (08 명세 3번; sim-5850-ace-economy,
 * 20 runs per profile). The spec's own guesses were 180k-210k / 280k-320k / 400k-440k.
 */
const NOVICE_LEVEL_ESTIMATE = 384_256;
const INTERMEDIATE_LEVEL_ESTIMATE = 463_280;
const EXPERT_LEVEL_ESTIMATE = 521_337;
const MAX_TURNS = Number(process.env.FORK_SIM_MAX_TURNS ?? 300);

type AceId = "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "A7";
type Category = "physical" | "special" | "mixed";

interface AceDef {
  readonly id: AceId;
  readonly label: string;
  readonly species: SpeciesId;
  readonly formKey: string;
  /** A7: the tail (engine fusion fields, stats / types / ability by the engine's own rules) */
  readonly fusion?: { readonly species: SpeciesId; readonly formKey: string };
  readonly category: Category;
  /** The best nature (a Mint for the novice); Soul Dew x10 makes the boosted stat x2.1 and the lowered stat 1 */
  readonly nature: Nature;
  readonly moves: readonly MoveId[];
  /** The two type boosters x99 */
  readonly boosterTypes: readonly [PokemonType, PokemonType];
  /** Form items held (Mega Stone: also the Mega Bracelet) */
  readonly formItems: readonly FormChangeItem[];
  readonly mega: boolean;
  /**
   * Local fork (2026-11-13): 11 re-run, a Steel type by the forge's rule (isForgeEligibleSteelPokemon: its own types, a
   * fusion's counted), so Tinkaton's Forge can give it Forged Steel; buildAce checks it against the engine's types
   */
  readonly steelType: boolean;
  /** EXPERT's passive: our table's (custom-passives.ts) or PokeRogue's own, whichever is better here */
  readonly expertPassive: "custom" | "base";
  readonly note: string;
}

const ACES: Record<AceId, AceDef> = {
  A1: {
    id: "A1",
    label: "Mega Garchomp (메가한카리아스)",
    species: SpeciesId.GARCHOMP,
    formKey: "mega",
    category: "physical",
    nature: Nature.ADAMANT,
    moves: [MoveId.EARTHQUAKE, MoveId.DRAGON_HAMMER, MoveId.IRON_HEAD, MoveId.STONE_EDGE],
    boosterTypes: [PokemonType.GROUND, PokemonType.DRAGON],
    formItems: [FormChangeItem.GARCHOMPITE],
    mega: true,
    steelType: false,
    expertPassive: "base",
    note: "passive: PokeRogue's Mold Breaker (ignores Levitate / Unaware / Prism Armor / Multiscale / Filter) over our Sand Stream",
  },
  A2: {
    id: "A2",
    label: "Mega Rayquaza (메가레쿠쟈)",
    species: SpeciesId.RAYQUAZA,
    formKey: "mega",
    category: "mixed",
    nature: Nature.ADAMANT,
    moves: [MoveId.DRAGON_ASCENT, MoveId.DRAGON_HAMMER, MoveId.EARTHQUAKE, MoveId.EXTREME_SPEED],
    boosterTypes: [PokemonType.FLYING, PokemonType.DRAGON],
    formItems: [FormChangeItem.RAYQUAZITE],
    mega: true,
    steelType: false,
    expertPassive: "custom",
    note: "Mega via Rayquazite in this fork (not Dragon Ascent); physical set because Soul Dew x10 sets the lowered nature stat to 1; passive: our Adaptability over Unnerve",
  },
  A3: {
    id: "A3",
    label: "Mega Latios (메가라티오스)",
    species: SpeciesId.LATIOS,
    formKey: "mega",
    category: "special",
    nature: Nature.MODEST,
    moves: [MoveId.DRAGON_PULSE, MoveId.PSYSTRIKE, MoveId.AURA_SPHERE, MoveId.MOONBLAST],
    boosterTypes: [PokemonType.DRAGON, PokemonType.PSYCHIC],
    formItems: [FormChangeItem.LATIOSITE],
    mega: true,
    steelType: false,
    expertPassive: "custom",
    note: "passive: our Adaptability over Neuroforce",
  },
  A4: {
    id: "A4",
    label: "Hoopa Unbound (굴레를벗어난 후파)",
    species: SpeciesId.HOOPA,
    formKey: "unbound",
    category: "mixed",
    nature: Nature.MODEST,
    moves: [MoveId.PSYSTRIKE, MoveId.FIERY_WRATH, MoveId.AURA_SPHERE, MoveId.FLAMETHROWER],
    boosterTypes: [PokemonType.PSYCHIC, PokemonType.DARK],
    formItems: [FormChangeItem.PRISON_BOTTLE],
    mega: false,
    steelType: false,
    expertPassive: "custom",
    note: "special set (SpA 170 > Atk 160; Soul Dew x10 sets the lowered nature stat to 1); passive: our Infiltrator over Opportunist",
  },
  A5: {
    id: "A5",
    label: "Kartana (테카트론)",
    species: SpeciesId.KARTANA,
    formKey: "",
    category: "physical",
    nature: Nature.ADAMANT,
    moves: [MoveId.LEAF_BLADE, MoveId.BEHEMOTH_BLADE, MoveId.SACRED_SWORD, MoveId.STONE_EDGE],
    boosterTypes: [PokemonType.GRASS, PokemonType.STEEL],
    formItems: [],
    mega: false,
    steelType: true,
    expertPassive: "custom",
    note: "passive: our Sharpness (x1.5 on the three slicing moves) over Technician",
  },
  A6: {
    id: "A6",
    label: "Flutter Mane (날개치는머리)",
    species: SpeciesId.FLUTTER_MANE,
    formKey: "",
    category: "special",
    nature: Nature.MODEST,
    moves: [MoveId.MOONBLAST, MoveId.ASTRAL_BARRAGE, MoveId.MYSTICAL_FIRE, MoveId.THUNDERBOLT],
    boosterTypes: [PokemonType.FAIRY, PokemonType.GHOST],
    formItems: [],
    mega: false,
    steelType: false,
    expertPassive: "custom",
    note: "Booster Energy x1.5 (Paradox); passive: our Beast Boost over Dazzling",
  },
  A7: {
    id: "A7",
    label: "Fusion: Mega Rayquaza (head) + Zacian Crowned (tail)",
    species: SpeciesId.RAYQUAZA,
    formKey: "mega",
    fusion: { species: SpeciesId.ZACIAN, formKey: "crowned" },
    category: "mixed",
    nature: Nature.ADAMANT,
    moves: [MoveId.BEHEMOTH_BLADE, MoveId.DRAGON_HAMMER, MoveId.DRAGON_ASCENT, MoveId.EARTHQUAKE],
    boosterTypes: [PokemonType.STEEL, PokemonType.DRAGON],
    formItems: [FormChangeItem.RAYQUAZITE],
    mega: true,
    steelType: true,
    expertPassive: "custom",
    note: "tail crowned before the splice (Rusted Sword on an unfused Zacian, then DNA Splicers keep fusionFormIndex); passive from the head (our Adaptability)",
  },
};

type VariantId = "N1" | "N3" | "E1" | "E3" | "E10" | "B1" | "B3" | "NE" | "NC" | "EI" | "EC" | "EE";
interface VariantDef {
  readonly id: VariantId;
  readonly tier: "novice" | "expert";
  /** The ace's level (set directly) */
  readonly level: number;
  readonly batonPass: boolean;
}
const VARIANTS: Record<VariantId, VariantDef> = {
  N1: { id: "N1", tier: "novice", level: LEVEL_CAP, batonPass: false },
  N3: { id: "N3", tier: "novice", level: LEVEL_CAP * 3, batonPass: false },
  E1: { id: "E1", tier: "expert", level: LEVEL_CAP, batonPass: false },
  E3: { id: "E3", tier: "expert", level: LEVEL_CAP * 3, batonPass: false },
  E10: { id: "E10", tier: "expert", level: LEVEL_CAP * 10, batonPass: false },
  B1: { id: "B1", tier: "expert", level: LEVEL_CAP, batonPass: true },
  B3: { id: "B3", tier: "expert", level: LEVEL_CAP * 3, batonPass: true },
  // Local fork (2026-11-13): 08 명세 6번 re-run, the five level points (the novice / expert builds of the 07 grid)
  NE: { id: "NE", tier: "novice", level: NOVICE_LEVEL_ESTIMATE, batonPass: false },
  NC: { id: "NC", tier: "novice", level: LEVEL_CAP, batonPass: false },
  EI: { id: "EI", tier: "expert", level: INTERMEDIATE_LEVEL_ESTIMATE, batonPass: false },
  EC: { id: "EC", tier: "expert", level: LEVEL_CAP, batonPass: false },
  EE: { id: "EE", tier: "expert", level: EXPERT_LEVEL_ESTIMATE, batonPass: false },
};
/** Local fork (2026-11-13): the variants run when FORK_SIM_VARIANTS is not set (the 08 명세 6번 re-run) */
const DEFAULT_VARIANTS: readonly VariantId[] = ["NE", "NC", "EI", "EC", "EE"];
/** Local fork (2026-11-13): FORK_SIM_BUILD07=1 gives the ace the 07 build instead of the 08 명세 6번 one */
const BUILD07 = !!process.env.FORK_SIM_BUILD07;
/**
 * Local fork (2026-11-13): FORK_SIM_BUILD08=1 gives the ace the 08 명세 6번 build (one Choice item); the default since
 * the 09 re-run holds all four ("플레이어에게는 딱히 구애 아이템 제한을 넣지 않습니다")
 */
const BUILD08 = !!process.env.FORK_SIM_BUILD08 && !BUILD07;
/**
 * Local fork (2026-11-13): 10 re-run (3rd balance patch), the party's 방호 토큰 (Guard Token) count: the cap 65 by
 * default (the round-3 economy sim fills it by wave ~480-1200 for every pick policy that takes it at all);
 * FORK_SIM_GUARD=n for the ablations (0 = none, as in the 09 run). The old builds (FORK_SIM_BUILD07 / 08) hold none
 * unless FORK_SIM_GUARD says otherwise.
 */
const GUARD_TOKENS = Number(process.env.FORK_SIM_GUARD ?? (BUILD07 || BUILD08 ? 0 : 65));
/**
 * Local fork (2026-11-13): 10 re-run, the ace's 단조강철 (Forged Steel) pieces: 2 for every ace, the median forge visits
 * by wave 5850 in the round-3 economy sim (mean 2.30; one piece per visit then, nothing else gives it).
 * Local fork (2026-11-13): 11 re-run, the forge takes a Steel type only and gives two pieces a visit (10 명세 3번), so
 * by default a Steel-type ace holds {@linkcode FORGED_STEEL_PIECES_STEEL} and the others none
 * ({@linkcode forgedSteelPiecesFor}). FORK_SIM_FORGED=n gives every ace n (the ablations; 0 = none, as in the 09 run;
 * the item's own cap is 10); this is that override, `null` when not set.
 */
const FORGED_STEEL_OVERRIDE = process.env.FORK_SIM_FORGED == null ? null : Number(process.env.FORK_SIM_FORGED);
/** Local fork (2026-11-13): 11 re-run, the median forge visits by wave 5850 (round-3 economy sim; mean 2.30) */
const MEDIAN_FORGE_VISITS = 2;
/** Local fork (2026-11-13): 11 re-run, a Steel-type ace's Forged Steel: 2 pieces a forge x 2 visits = 4 */
const FORGED_STEEL_PIECES_STEEL = FORGED_STEEL.stacksPerForge * MEDIAN_FORGE_VISITS;
/** Local fork (2026-11-13): the Forged Steel pieces `def` holds in this run (none in the old builds unless set) */
function forgedSteelPiecesFor(def: AceDef): number {
  if (FORGED_STEEL_OVERRIDE != null) {
    return FORGED_STEEL_OVERRIDE;
  }
  if (BUILD07 || BUILD08) {
    return 0;
  }
  return def.steelType ? FORGED_STEEL_PIECES_STEEL : 0;
}
/** Local fork (2026-11-13): 11 re-run, the player's Multi Lens cap as the game sets it (3 since 10 명세 1번) */
const PLAYER_LENS_CAP: number = PLAYER_HELD_ITEM_CAPS.MULTI_LENS;
/**
 * Local fork (2026-11-13): 11 re-run, the ace's 멀티렌즈 (Multi Lens) count: the player cap by default (the 10 run and
 * every older one held 4, the cap then); FORK_SIM_LENS=n for the ablations. Above the cap, the cap is raised for the
 * run (beforeAll; afterAll puts it back), or the lenses past it would neither be given nor strike.
 */
const LENS_COUNT = Number(process.env.FORK_SIM_LENS ?? PLAYER_LENS_CAP);
/**
 * Local fork (2026-11-13): 11 re-run, FORK_SIM_LOG_BASE=x sets BOSS_SEGMENT_OVERFLOW.logBase for the run (the game's
 * 2.4 since 10 명세 2번; 2 = the old rule); `null` = the game's own
 */
const LOG_BASE_OVERRIDE = process.env.FORK_SIM_LOG_BASE == null ? null : Number(process.env.FORK_SIM_LOG_BASE);
/** Local fork (2026-11-13): 11 re-run, BOSS_SEGMENT_OVERFLOW.logBase during the run (FORK_SIM_LOG_BASE, else the game's) */
const RUN_LOG_BASE = LOG_BASE_OVERRIDE ?? BOSS_SEGMENT_OVERFLOW.logBase;
/**
 * Local fork (2026-11-13): 11 re-run, the Multi Lenses and overflow log base the runs tagged 07-10 played with (the
 * player's lens cap before 10 명세 1번, upstream's base before 10 명세 2번)
 */
const PRE_PATCH4_RULES = { lens: 4, logBase: 2 } as const;
/**
 * Local fork (2026-11-13): the build name written into every record: "11" = the 10 build with the 4th balance
 * patch's Multi Lenses (the cap) and Forged Steel by type; with FORK_SIM_FORGED set, the 10 run's names ("10" = the 09
 * build + Guard Tokens / Forged Steel, "09" with neither). The lens count and the log base are in every record (`run`).
 * The tag names the item build; a run whose lenses or log base are not the ones that build's own round played with
 * (07-10: {@linkcode PRE_PATCH4_RULES}; 11: the game's) gets them appended, e.g. "10@L3/2.4", so a merged summary never
 * puts records of different rules under one tag.
 */
function buildName(): string {
  let items: "07" | "08" | "09" | "10" | "11";
  if (BUILD07) {
    items = "07";
  } else if (BUILD08) {
    items = "08";
  } else if (FORGED_STEEL_OVERRIDE == null) {
    items = "11";
  } else {
    items = GUARD_TOKENS > 0 || FORGED_STEEL_OVERRIDE > 0 ? "10" : "09";
  }
  const own = items === "11" ? { lens: PLAYER_LENS_CAP, logBase: BOSS_SEGMENT_OVERFLOW.logBase } : PRE_PATCH4_RULES;
  return LENS_COUNT === own.lens && RUN_LOG_BASE === own.logBase ? items : `${items}@L${LENS_COUNT}/${RUN_LOG_BASE}`;
}
const BUILD_NAME = buildName();

type OpponentId = "GIOVANNI" | "ROSE" | "LUSAMINE" | "GHETSIS" | "CYRUS" | "WILD";
const OPPONENTS: Record<OpponentId, TrainerType | null> = {
  GIOVANNI: TrainerType.ROCKET_BOSS_GIOVANNI_2,
  ROSE: TrainerType.ROSE_2,
  LUSAMINE: TrainerType.LUSAMINE_2,
  GHETSIS: TrainerType.GHETSIS_2,
  CYRUS: TrainerType.CYRUS_2,
  WILD: null,
};
/** The wild baseline runs for these variants only */
const WILD_VARIANTS: readonly VariantId[] = ["N1", "E1"];

/** Supports: any species at the level cap, no items; only on the field when the ace has to switch out */
const SUPPORTS: readonly SpeciesId[] = [
  SpeciesId.SHUCKLE,
  SpeciesId.BLISSEY,
  SpeciesId.SNORLAX,
  SpeciesId.CHANSEY,
  SpeciesId.AUDINO,
];

/** Every enemy buff token at its wave-5850 cap (sim-wave5850-enemy-side: 100% of runs) */
const TOKEN_CAPS = {
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
type TokenId = keyof typeof TOKEN_CAPS;

interface BattleSpec {
  key: string;
  ace: AceId;
  variant: VariantId;
  opponent: OpponentId;
  seed: string;
}

function envList<T extends string>(name: string, all: readonly T[]): T[] {
  const raw = process.env[name];
  if (!raw) {
    return [...all];
  }
  return raw
    .split(",")
    .map(s => s.trim())
    .filter((s): s is T => (all as readonly string[]).includes(s));
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a simulation driver, kept in one piece
function buildGrid(): BattleSpec[] {
  const aces = envList("FORK_SIM_ACES", Object.keys(ACES) as AceId[]);
  const variants = process.env.FORK_SIM_VARIANTS
    ? envList("FORK_SIM_VARIANTS", Object.keys(VARIANTS) as VariantId[])
    : [...DEFAULT_VARIANTS];
  const opponents = envList("FORK_SIM_TRAINERS", Object.keys(OPPONENTS) as OpponentId[]);
  const seeds = (process.env.FORK_SIM_SEEDS ?? "s1,s2").split(",").filter(s => s.length > 0);
  const specs: BattleSpec[] = [];
  for (const ace of aces) {
    for (const variant of variants) {
      for (const opponent of opponents) {
        if (opponent === "WILD" && !WILD_VARIANTS.includes(variant)) {
          continue;
        }
        for (const seed of seeds) {
          specs.push({ key: `${ace}-${variant}-${opponent}-${seed}`, ace, variant, opponent, seed });
        }
      }
    }
  }
  // FORK_SIM_SHARD=i/n: every n-th battle from the i-th (even shards for parallel processes)
  const shard = /^(\d+)\/(\d+)$/.exec(process.env.FORK_SIM_SHARD ?? "");
  const sharded = shard ? specs.filter((_, k) => k % Number(shard[2]) === Number(shard[1])) : specs;
  const limit = Number(process.env.FORK_SIM_LIMIT ?? 0);
  return limit > 0 ? sharded.slice(0, limit) : sharded;
}

// #endregion Grid

// #region Records

interface ItemRec {
  item: string;
  want: number;
  got: number;
  cap?: number;
  note?: string;
}

interface AceHit {
  turn: number;
  move: string;
  /** Damage after every token (what getAttackDamage returned) */
  dmg: number;
  /** The value right before the token step (after Expert Belt / Life Orb) */
  raw: number | null;
  /** dmg / target max HP, % */
  pct: number;
  /** raw / target max HP (R) */
  R: number | null;
  /** Whether dmg equals the token formula applied to raw (else a defender ability changed it after the tokens) */
  tokenFormulaOk: boolean | null;
  crit: boolean;
  /** HP actually removed (boss bars, Focus Band, Endure Token, the last HP) */
  dealt: number;
  hpBefore: number;
  hpAfter: number;
  /**
   * Local fork (2026-11-13): 11 re-run, the enemy's bars left before and after the hit (bossSegmentIndex + 1 while it
   * stands, 0 once it falls; 1 / 0 for a non-boss): barsBefore - barsAfter = the bars this strike broke
   */
  barsBefore: number;
  barsAfter: number;
  /** Local fork (2026-11-13): 11 re-run, this hit's number among the ace's hits on this enemy in the turn (1 = first) */
  strike: number;
  saved?: string;
  barClamp?: boolean;
}

interface EnemyHit {
  turn: number;
  move: string;
  dmg: number;
  raw: number | null;
  tokenFormulaOk: boolean | null;
  /** dmg / ace max HP, % */
  pctAceMaxHp: number;
  crit: boolean;
  dealt: number;
  aceHpBefore: number;
  aceHpAfter: number;
  saved?: string;
}

interface HealRec {
  turn: number;
  label: string;
  amount: number;
  pctMaxHp: number;
}

interface EnemyRec {
  uid: number;
  slot: number;
  species: string;
  form: string;
  fusion: string | null;
  fusionForm: string | null;
  level: number;
  bars: number;
  /** Local fork (2026-11-13): the bar count the boss-trainer HP correction uses (EnemyPokemon.forkBossHpBars) */
  hpBars: number | null;
  maxHp: number;
  stats: number[];
  ability: string;
  passive: string | null;
  moves: string[];
  battleItems: Record<string, number>;
  heldStacks: number;
  /** Heal Token 20% + Leftovers 1/16 per stack, % of max HP per turn (before the missing-HP cap) */
  nominalHealPctPerTurn: number;
  faced: boolean;
  /** The turn it fell, to the ace's hit or anything else ({@linkcode EnemyRec.koBy}) */
  koTurn: number | null;
  /**
   * Local fork (2026-11-13): 11 re-run, what took its last HP: "ace" = the ace's hit, "other" = anything else (recoil,
   * its own Life Orb, weather, status, a support's hit); null = still standing (or a record written before it existed)
   */
  koBy: "ace" | "other" | null;
  aceHits: AceHit[];
  hitsToKo: number | null;
  /**
   * Local fork (2026-11-13): 11 re-run, the turns in which the ace's move came up against this enemy (an attacking
   * move; a miss, a flinch or full paralysis still spends the turn)
   */
  aceAttackTurns: number[];
  /** Local fork (2026-11-13): 11 re-run, the ace's attacking turns on this enemy up to its KO turn (null: not KO'd) */
  turnsToKo: number | null;
  hitsOnAce: EnemyHit[];
  heals: HealRec[];
  focusBandSaves: number;
  endureTokenSaves: number;
  otherDamage: { turn: number; amount: number; phase: string }[];
}

interface TurnRec {
  turn: number;
  enemyUid: number | null;
  enemy?: string | undefined;
  /** What the player commanded at the start of the turn */
  action: string;
  /** Move phases in order; "(x)" = the mover had fainted / left before its turn */
  order: string[];
  firstMover: string | null;
  /** Movers that flinched this turn */
  flinched: number;
  events: string[];
  /** After the turn's end (heals, status damage) */
  aceHp: number;
  aceHpPct: number;
  enemyHpPct: number | null;
  aceStatus: string | null;
}

interface BattleRec {
  key: string;
  ace: AceId;
  aceLabel: string;
  variant: VariantId;
  opponent: OpponentId;
  seed: string;
  trainer: string | null;
  result: "swept" | "aceFainted" | "stalled" | "error";
  error?: string;
  turns: number;
  kos: number;
  seconds: number;
  aceBuild: Record<string, unknown>;
  /** Local fork (2026-11-13): 11 re-run, the knobs of this run (also on a setup-error row) */
  run: RunParams;
  tokens: Record<string, number>;
  enemies: EnemyRec[];
  turnLog: TurnRec[];
  aceHeals: HealRec[];
  aceOtherDamage: { turn: number; amount: number; phase: string }[];
  aceStatuses: { turn: number; status: string }[];
  statusTokenProcs: { turn: number; effect: string }[];
  immunitySwitches: number;
  forcedOut: number;
  supportsFainted: number;
  revived: number;
  ppOutTurn: number | null;
  struggles: number;
  /** The formula-order check of the first ace hit and the first enemy hit on the ace */
  handCheck: { aceHit?: Breakdown; enemyHit?: Breakdown };
  /** Switch-outs to reset a Choice lock on a move with no PP left */
  ppSwitches: number;
}

/** Local fork (2026-11-13): 11 re-run, what every battle record says about the run's build and rules */
interface RunParams {
  build: string;
  /** The ace's Multi Lenses asked for (FORK_SIM_LENS, default the player cap) */
  multiLens: number;
  /** The player's Multi Lens cap during the run (raised when FORK_SIM_LENS is above the game's) */
  multiLensCap: number;
  /** BOSS_SEGMENT_OVERFLOW.logBase during the run */
  bossOverflowLogBase: number;
  /** The ace's Forged Steel pieces asked for */
  forgedSteel: number;
  guardTokens: number;
}

function runParams(def: AceDef): RunParams {
  return {
    build: BUILD_NAME,
    multiLens: LENS_COUNT,
    multiLensCap: PLAYER_HELD_ITEM_CAPS.MULTI_LENS,
    bossOverflowLogBase: BOSS_SEGMENT_OVERFLOW.logBase,
    forgedSteel: forgedSteelPiecesFor(def),
    guardTokens: GUARD_TOKENS,
  };
}

// #endregion Records

// #region Instrumentation

interface PendingHit {
  attacker: Pokemon;
  target: Pokemon;
  move: MoveId;
  dmg: number;
  raw: number | null;
  crit: boolean;
}

/** The live instrumentation state of the battle being run (null between battles) */
interface Ctx {
  rec: BattleRec;
  ace: PlayerPokemon;
  enemies: Map<number, EnemyRec>;
  turn: number;
  inRealDamageCalc: boolean;
  raw: number | null;
  /** getBaseDamage's result in the current real damage calculation */
  lastBase: number | null;
  pending: PendingHit | null;
  damageDepth: number;
  /** The damage the innermost `Pokemon.damage` was asked for (after the boss-bar clamp) */
  innerRequested: number;
  surviveFlag: boolean;
  /** The Pokémon the Endure Token just fired for (its tag is consumed by the next lethal damage) */
  endureTokenFor: number | null;
  healLabel: string | null;
  piercing: number;
  reduction: number;
  boosterStacks: number;
  /** Local fork (2026-11-13): 10 re-run, the party's Guard Tokens (read from the scene at the first command) */
  guardStacks: number;
}

let ctx: Ctx | null = null;
const restorers: (() => void)[] = [];

function patch<T extends object, K extends keyof T>(obj: T, key: K, make: (orig: T[K]) => T[K]): void {
  const had = Object.hasOwn(obj, key);
  const orig = obj[key];
  obj[key] = make(orig);
  restorers.push(() => {
    if (had) {
      obj[key] = orig;
    } else {
      delete obj[key];
    }
  });
}

const r4 = (x: number) => Number(x.toPrecision(4));

function moveName(id: MoveId): string {
  return MoveId[id] ?? String(id);
}

interface BreakdownInputs {
  move: string;
  category: string;
  level: number;
  power: number;
  atk: number;
  def: number;
  crit: number;
  multiLens: number;
  stab: number;
  effectiveness: number;
  burn: number;
  expertBelt: number;
  lifeOrb: number;
}

/**
 * The hand check of one hit, in the order of enemy5850.md section 6: base = (2L/5 + 2) x power x A / D / 50 + 2 (the
 * engine's getBaseDamage, compared with the same formula on the stats read just before), x multi-lens x crit x random
 * (0.85..1) x STAB x type x burn, floored; x Expert Belt; x Life Orb; then the tokens. `random` = what is left of raw
 * after the known multipliers: it must lie in [0.85, 1] when nothing else (weather, Sand Force, Sharpness, Tough Claws,
 * screens ...) acted.
 */
interface Breakdown extends BreakdownInputs {
  baseFormula: number;
  baseEngine: number;
  knownProduct: number;
  raw: number;
  impliedRandom: number;
  tokenFactor: number;
  afterTokens: number;
  tokenFormula: number;
}

function breakdownInputs(
  source: Pokemon,
  target: Pokemon,
  params: Parameters<Pokemon["getAttackDamage"]>[0],
): BreakdownInputs {
  const { move } = params;
  const isCritical = !!params.isCritical;
  const phys = move.category === MoveCategory.PHYSICAL;
  // Local fork (2026-11-13): 10 re-run, the attack and defense stats as getBaseDamage reads them: Mind Blade's Sp. Atk
  // for a slicing move, then the move's VariableAtkAttr (Body Press: the user's Defense; Foul Play: the target's
  // Attack) and VariableDefAttr (Psyshock and co.: the target's Defense). It used to read Attack for Body Press.
  const mindBlade =
    phys
    && !params.ignoreSourceAbility
    && move.hasFlag(MoveFlags.SLICING_MOVE)
    && source.hasAbility(AbilityId.MIND_BLADE);
  const atkParams = {
    opponent: target,
    ignoreOppAbility: !!params.ignoreSourceAbility,
    ignoreAbility: !!params.ignoreAbility,
    ignoreAllyAbility: !!params.ignoreAllyAbility,
    isCritical,
    simulated: true,
  };
  const atk = new NumberHolder(source.getEffectiveStat(phys && !mindBlade ? Stat.ATK : Stat.SPATK, atkParams));
  applyMoveAttrs("VariableAtkAttr", source, target, move, atk, atkParams);
  const def = new NumberHolder(
    target.getEffectiveStat(phys ? Stat.DEF : Stat.SPDEF, {
      opponent: source,
      move,
      ignoreAbility: !!params.ignoreAbility,
      ignoreOppAbility: !!params.ignoreSourceAbility,
      ignoreAllyAbility: !!params.ignoreSourceAllyAbility,
      isCritical,
      simulated: true,
      forDefend: true,
    }),
  );
  applyMoveAttrs("VariableDefAttr", source, target, move, def);
  const ml = new NumberHolder(1);
  globalScene.applyModifiers(PokemonMultiHitModifier, source.isPlayer(), source, move.id, null, ml);
  const effectiveness = params.effectiveness ?? target.getMoveEffectiveness(source, move, false, true);
  const held = (id: string) =>
    source
      .getHeldItems()
      .find(m => m.type.id === id)
      ?.getStackCount() ?? 0;
  return {
    move: moveName(move.id),
    category: MoveCategory[move.category],
    level: source.level,
    power: move.calculateBattlePower(source, target, true, move.category),
    atk: atk.value,
    def: def.value,
    crit: isCritical ? getCriticalHitMultiplier(source) : 1,
    multiLens: ml.value,
    stab: target.calculateStabMultiplier(source, move, false, true),
    effectiveness,
    burn: phys && source.status?.effect === StatusEffect.BURN ? 0.5 : 1,
    expertBelt: effectiveness >= 2 && held("EXPERT_BELT") > 0 ? 1.2 : 1,
    lifeOrb: 1 + 0.3 * held("LIFE_ORB"),
  };
}

function finishBreakdown(
  pre: BreakdownInputs,
  baseEngine: number,
  raw: number,
  dmg: number,
  source: Pokemon,
): Breakdown {
  const baseFormula = (((2 * pre.level) / 5 + 2) * pre.power * (pre.atk / pre.def)) / 50 + 2;
  const knownProduct =
    pre.multiLens * pre.crit * pre.stab * pre.effectiveness * pre.burn * pre.expertBelt * pre.lifeOrb;
  // Local fork (2026-11-13): 10 re-run, an enemy's hit on the ace also carries the party's Guard Tokens (0.995^m)
  const tokenFactor = source.isPlayer()
    ? getPiercedReductionMultiplier(ctx?.reduction ?? 1, ctx?.piercing ?? 0)
    : (1 + 0.035 * (ctx?.boosterStacks ?? 0)) * getGuardTokenMultiplier(ctx?.guardStacks ?? 0);
  return {
    ...pre,
    baseFormula: Math.round(baseFormula * 100) / 100,
    baseEngine: Math.round(baseEngine * 100) / 100,
    knownProduct: r4(knownProduct),
    raw,
    impliedRandom: r4(raw / (baseEngine * knownProduct)),
    tokenFactor,
    afterTokens: dmg,
    tokenFormula: tokenFormula(source, raw),
  };
}

/**
 * The token step of `getAttackDamage` (enemy-damage-tokens.ts) on `raw`, for the hand check. An enemy attacker is only
 * checked on hits on the ace (the player's), so its step is the Damage Tokens and, since the 3rd balance patch, the
 * party's Guard Tokens in one floor (Local fork 2026-11-13, 10 re-run; the old Damage Token step without one).
 */
function tokenFormula(attacker: Pokemon, raw: number): number {
  if (!ctx) {
    return raw;
  }
  if (attacker.isPlayer()) {
    const m = getPiercedReductionMultiplier(ctx.reduction, ctx.piercing);
    return m < 1 ? Math.max(Math.floor(raw * m), 1) : raw;
  }
  if (ctx.guardStacks > 0) {
    return getGuardedDamageValue(raw, [ctx.boosterStacks], ctx.guardStacks);
  }
  return getEnemyDamageBoostedValue(raw, ctx.boosterStacks);
}

/** A real (not simulated) damage calculation: the damage after the tokens, the value the token step saw, the hand check */
function realAttackDamage(
  target: Pokemon,
  orig: Pokemon["getAttackDamage"],
  params: Parameters<Pokemon["getAttackDamage"]>[0],
): ReturnType<Pokemon["getAttackDamage"]> {
  if (!ctx || params.simulated !== false) {
    return orig.call(target, params);
  }
  const c = ctx;
  // The hand check: the first ace -> enemy and the first enemy -> ace hit of the battle, inputs read just before
  let side: "aceHit" | "enemyHit" | null = null;
  if (params.source === c.ace) {
    side = "aceHit";
  } else if (target === c.ace && !params.source.isPlayer()) {
    side = "enemyHit";
  }
  const pre = side && !c.rec.handCheck[side] ? breakdownInputs(params.source, target, params) : null;
  c.inRealDamageCalc = true;
  c.raw = null;
  c.lastBase = null;
  let res: ReturnType<Pokemon["getAttackDamage"]>;
  try {
    res = orig.call(target, params);
  } finally {
    c.inRealDamageCalc = false;
  }
  if (res.damage <= 0) {
    return res;
  }
  if (side && pre && c.raw != null && c.lastBase != null) {
    c.rec.handCheck[side] = finishBreakdown(pre, c.lastBase, c.raw, res.damage, params.source);
  }
  c.pending = {
    attacker: params.source,
    target,
    move: params.move.id,
    dmg: res.damage,
    raw: c.raw,
    crit: !!params.isCritical,
  };
  return res;
}

function installPatches(): void {
  patch(
    Pokemon.prototype,
    "getAttackDamage",
    orig =>
      function (this: Pokemon, params: Parameters<Pokemon["getAttackDamage"]>[0]) {
        return realAttackDamage(this, orig, params);
      } as Pokemon["getAttackDamage"],
  );
  patch(
    Pokemon.prototype,
    "getBaseDamage",
    orig =>
      function (this: Pokemon, ...args: Parameters<Pokemon["getBaseDamage"]>) {
        const base = orig.apply(this, args);
        if (ctx?.inRealDamageCalc && ctx.lastBase == null) {
          ctx.lastBase = base;
        }
        return base;
      },
  );
  const captureRaw = (orig: (...args: unknown[]) => boolean) =>
    function (this: unknown, ...args: unknown[]): boolean {
      const holder = args[0] as { value?: unknown } | undefined;
      if (ctx?.inRealDamageCalc && ctx.raw == null && typeof holder?.value === "number") {
        ctx.raw = holder.value;
      }
      return orig.apply(this, args);
    };
  patch(
    EnemyDamageReducerModifier.prototype,
    "shouldApply",
    orig => captureRaw(orig as (...args: unknown[]) => boolean) as typeof orig,
  );
  patch(
    EnemyDamageBoosterModifier.prototype,
    "shouldApply",
    orig => captureRaw(orig as (...args: unknown[]) => boolean) as typeof orig,
  );

  // HP loss: pair it with the pending attack hit, or log it as other damage
  const damageWrapper = (orig: Pokemon["damage"]) =>
    function (this: Pokemon, damage: number, ...rest: unknown[]): number {
      if (!ctx) {
        return (orig as (...a: unknown[]) => number).call(this, damage, ...rest);
      }
      const c = ctx;
      c.damageDepth++;
      const hpBefore = this.hp;
      const barsBefore = barsLeft(this); // Local fork (2026-11-13): 11 re-run
      const hadEndureToken = !!this.getTag(BattlerTagType.ENDURE_TOKEN);
      if (c.damageDepth === 1) {
        c.surviveFlag = false;
      }
      // EnemyPokemon.damage clamps at the boss bars, then calls Pokemon.damage (depth 2) with what is left
      c.innerRequested = damage;
      let ret: number;
      try {
        ret = (orig as (...a: unknown[]) => number).call(this, damage, ...rest);
      } finally {
        c.damageDepth--;
      }
      if (c.damageDepth === 0) {
        onDamage(this, damage, c.innerRequested, hpBefore, this.hp, hadEndureToken, barsBefore);
      }
      return ret;
    } as Pokemon["damage"];
  patch(Pokemon.prototype, "damage", damageWrapper);
  patch(EnemyPokemon.prototype, "damage", damageWrapper);

  patch(
    SurviveDamageModifier.prototype,
    "apply",
    orig =>
      function (this: SurviveDamageModifier, ...args: Parameters<SurviveDamageModifier["apply"]>) {
        const ok = orig.apply(this, args);
        if (ok && ctx) {
          ctx.surviveFlag = true;
        }
        return ok;
      },
  );

  // Heals: tag the heal phase with the modifier that queued it
  const healTag = <M extends { apply: (...a: never[]) => boolean }>(proto: M, label: string) =>
    patch(
      proto as unknown as { apply: (...a: unknown[]) => boolean },
      "apply",
      orig =>
        function (this: unknown, ...args: unknown[]) {
          if (!ctx) {
            return orig.apply(this, args);
          }
          const keep = ctx.healLabel;
          ctx.healLabel = label;
          try {
            return orig.apply(this, args);
          } finally {
            if (ctx) {
              ctx.healLabel = keep;
            }
          }
        },
    );
  healTag(TurnHealModifier.prototype, "leftovers");
  healTag(HitHealModifier.prototype, "shellBell");
  healTag(EnemyTurnHealModifier.prototype, "healToken");
  healTag(BerryModifier.prototype, "berry");
  patch(
    PhaseManager.prototype,
    "create",
    orig =>
      function (this: PhaseManager, ...args: unknown[]) {
        const phase = (orig as (...a: unknown[]) => unknown).apply(this, args);
        if (ctx && args[0] === "PokemonHealPhase") {
          (phase as { __simLabel?: string }).__simLabel = ctx.healLabel ?? "other";
        }
        return phase;
      } as typeof orig,
  );
  patch(
    Pokemon.prototype,
    "heal",
    orig =>
      function (this: Pokemon, amount: number) {
        const healed = orig.call(this, amount);
        if (ctx && healed > 0) {
          const phase = globalScene.phaseManager.getCurrentPhase() as unknown as {
            phaseName: string;
            __simLabel?: string;
          };
          const label = phase.__simLabel ?? `direct:${phase.phaseName}`;
          onHeal(this, label, healed);
        }
        return healed;
      },
  );

  patch(
    EnemyAttackStatusEffectChanceModifier.prototype,
    "apply",
    orig =>
      function (
        this: EnemyAttackStatusEffectChanceModifier,
        ...args: Parameters<EnemyAttackStatusEffectChanceModifier["apply"]>
      ) {
        const ok = orig.apply(this, args);
        if (ok && ctx) {
          ctx.rec.statusTokenProcs.push({ turn: ctx.turn, effect: StatusEffect[this.effect] });
        }
        return ok;
      },
  );
  patch(
    EnemyEndureChanceModifier.prototype,
    "apply",
    orig =>
      function (this: EnemyEndureChanceModifier, ...args: Parameters<EnemyEndureChanceModifier["apply"]>) {
        const ok = orig.apply(this, args);
        if (ok && ctx) {
          ctx.endureTokenFor = args[0].id;
        }
        return ok;
      },
  );
  patch(
    PokemonInstantReviveModifier.prototype,
    "apply",
    orig =>
      function (this: PokemonInstantReviveModifier, ...args: Parameters<PokemonInstantReviveModifier["apply"]>) {
        if (!ctx) {
          return orig.apply(this, args);
        }
        const keep = ctx.healLabel;
        ctx.healLabel = "reviverSeed";
        let ok: boolean;
        try {
          ok = orig.apply(this, args);
        } finally {
          if (ctx) {
            ctx.healLabel = keep;
          }
        }
        if (ok && ctx && args[0] === ctx.ace) {
          ctx.rec.revived++;
        }
        return ok;
      },
  );
}

/**
 * Local fork (2026-11-13): 11 re-run, the bars `p` has left: a boss's bossSegmentIndex + 1 while it stands (the bar it
 * is on included), 1 for a standing non-boss, 0 once its HP is gone
 */
function barsLeft(p: Pokemon): number {
  if (p.hp <= 0) {
    return 0;
  }
  return p instanceof EnemyPokemon && p.isBoss() ? p.bossSegmentIndex + 1 : 1;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a simulation driver, kept in one piece
function onDamage(
  target: Pokemon,
  requested: number,
  afterBars: number,
  hpBefore: number,
  hpAfter: number,
  hadEndureToken: boolean,
  barsBefore: number,
): void {
  if (!ctx) {
    return;
  }
  const c = ctx;
  const dealt = hpBefore - hpAfter;
  const pending = c.pending && c.pending.target === target ? c.pending : null;
  /** The boss bars took part of the hit away (calculateBossSegmentDamage) */
  const barClamp = afterBars < requested;
  let saved: string | undefined;
  if (afterBars >= hpBefore && hpBefore > 0 && hpAfter > 0) {
    if (c.surviveFlag) {
      saved = "focusBand";
    } else if (c.endureTokenFor === target.id || hadEndureToken) {
      saved = "endureToken";
    } else {
      saved = "other(endure/sturdy)";
    }
  }
  if (c.endureTokenFor === target.id) {
    c.endureTokenFor = null;
  }
  if (!pending) {
    const entry = { turn: c.turn, amount: dealt, phase: globalScene.phaseManager.getCurrentPhase().phaseName };
    if (target === c.ace) {
      c.rec.aceOtherDamage.push(entry);
    } else {
      const e = c.enemies.get(target.id);
      e?.otherDamage.push(entry);
      // Local fork (2026-11-13): 11 re-run, recoil, its own Life Orb, weather or status can take an enemy's last HP too
      if (e) {
        markKo(e, c.turn, hpAfter, "other");
      }
    }
    return;
  }
  c.pending = null;
  const { attacker } = pending;
  if (attacker === c.ace && !target.isPlayer()) {
    const e = c.enemies.get(target.id);
    if (!e) {
      return;
    }
    const maxHp = target.getMaxHp();
    e.faced = true;
    e.aceHits.push({
      turn: c.turn,
      move: moveName(pending.move),
      dmg: pending.dmg,
      raw: pending.raw,
      pct: r4((pending.dmg / maxHp) * 100),
      R: pending.raw == null ? null : r4(pending.raw / maxHp),
      tokenFormulaOk: pending.raw == null ? null : tokenFormula(attacker, pending.raw) === pending.dmg,
      crit: pending.crit,
      dealt,
      hpBefore,
      hpAfter,
      barsBefore,
      barsAfter: barsLeft(target),
      strike: e.aceHits.filter(h => h.turn === c.turn).length + 1,
      ...(saved ? { saved } : {}),
      ...(barClamp ? { barClamp } : {}),
    });
    if (saved === "focusBand") {
      e.focusBandSaves++;
    } else if (saved === "endureToken") {
      e.endureTokenSaves++;
    }
    markKo(e, c.turn, hpAfter, "ace");
  } else if (target === c.ace && !attacker.isPlayer()) {
    const e = c.enemies.get(attacker.id);
    const maxHp = target.getMaxHp();
    const hit: EnemyHit = {
      turn: c.turn,
      move: moveName(pending.move),
      dmg: pending.dmg,
      raw: pending.raw,
      tokenFormulaOk: pending.raw == null ? null : tokenFormula(attacker, pending.raw) === pending.dmg,
      pctAceMaxHp: r4((pending.dmg / maxHp) * 100),
      crit: pending.crit,
      dealt,
      aceHpBefore: hpBefore,
      aceHpAfter: hpAfter,
      ...(saved ? { saved } : {}),
    };
    if (e) {
      e.faced = true;
      e.hitsOnAce.push(hit);
    }
  } else if (!target.isPlayer()) {
    // Local fork (2026-11-13): 11 re-run, a hit on an enemy by someone else than the ace (a support)
    const e = c.enemies.get(target.id);
    if (e) {
      markKo(e, c.turn, hpAfter, "other");
    }
  }
}

/**
 * Local fork (2026-11-13): 11 re-run, books an enemy's fall the first time its HP reaches 0, whatever took the last HP
 * (`by`), so `koTurn` / `turnsToKo` agree with `rec.kos`; `hitsToKo` = the ace's hits on it up to then
 */
function markKo(e: EnemyRec, turn: number, hpAfter: number, by: "ace" | "other"): void {
  if (hpAfter <= 0 && e.koTurn == null) {
    e.koTurn = turn;
    e.koBy = by;
    e.hitsToKo = e.aceHits.length;
  }
}

function onHeal(pokemon: Pokemon, label: string, amount: number): void {
  if (!ctx) {
    return;
  }
  const rec: HealRec = { turn: ctx.turn, label, amount, pctMaxHp: r4((amount / pokemon.getMaxHp()) * 100) };
  if (pokemon === ctx.ace) {
    ctx.rec.aceHeals.push(rec);
  } else {
    ctx.enemies.get(pokemon.id)?.heals.push(rec);
  }
}

// #endregion Instrumentation

// #region Helpers

/** Writes a line to the real stdout (console.log is muted) */
function print(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

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

/** FORK_SIM_MOVES=A2:DRAGON_HAMMER/EARTHQUAKE/IRON_HEAD/EXTREME_SPEED;A7:...: an ace's moveset for a sensitivity run */
function movesFor(def: AceDef): readonly MoveId[] {
  for (const part of (process.env.FORK_SIM_MOVES ?? "").split(";")) {
    const [aceId, list] = part.split(":");
    if (aceId === def.id && list) {
      return list.split("/").map(name => {
        const id = MoveId[name as keyof typeof MoveId];
        if (id === undefined) {
          throw new Error(`FORK_SIM_MOVES: unknown move ${name}`);
        }
        return id;
      });
    }
  }
  return def.moves;
}

/**
 * Local fork (2026-11-13): the category the ace attacks with, for its one Choice item (08 명세 6번 1항). A "mixed" ace
 * (A2, A4, A7) attacks with the stat its nature raises: Soul Dew x10 sets the lowered stat to 1.
 */
function attackCategory(def: AceDef): "physical" | "special" {
  if (def.category !== "mixed") {
    return def.category;
  }
  return def.nature === Nature.MODEST ? "special" : "physical";
}

/** The novice's caught ace: IVs uniform 0..31 per stat, from the ace and the seed (same for every opponent) */
function noviceIvs(ace: AceId, seed: string): number[] {
  const rand = mulberry32(hashSeed(`novice-ivs-${ace}-${seed}`));
  return PERMANENT_STATS.map(() => Math.floor(rand() * 32));
}

function formIndexOf(species: SpeciesId, formKey: string): number {
  const sp = speciesDataRegistry.getSpecies(species);
  const i = sp.forms.findIndex(f => f.formKey === formKey);
  if (formKey && i < 0) {
    throw new Error(`${SpeciesId[species]} has no form "${formKey}"`);
  }
  return Math.max(0, i);
}

function typeOf(key: keyof typeof modifierTypes, pregen?: unknown[]): ModifierType | null {
  const fn = modifierTypes[key];
  const t = fn().withIdFromFunc(fn);
  if (t instanceof ModifierTypeGenerator) {
    return t.generateType(globalScene.getPlayerParty(), pregen);
  }
  return t;
}

/** Gives `pokemon` `want` of the held item made by `type` (stack set directly, then capped by the item's own cap) */
function giveHeld(pokemon: Pokemon, type: ModifierType | null, want: number, label: string, out: ItemRec[]): void {
  if (want <= 0) {
    out.push({ item: label, want, got: 0, note: "nothing to give (cap 0)" });
    return;
  }
  if (!type) {
    out.push({ item: label, want, got: 0, note: "no modifier type" });
    return;
  }
  const mod = type.newModifier(pokemon) as PokemonHeldItemModifier | null;
  if (!mod) {
    out.push({ item: label, want, got: 0, note: "newModifier gave null" });
    return;
  }
  const added = globalScene.addModifier(mod, true, false, false, true);
  const held = globalScene.findModifier(
    m => m instanceof PokemonHeldItemModifier && m.pokemonId === pokemon.id && m.matchType(mod),
    true,
  ) as PokemonHeldItemModifier | undefined;
  if (!held) {
    out.push({ item: label, want, got: 0, note: `not held after addModifier (${added})` });
    return;
  }
  const cap = held.getMaxStackCount();
  held.stackCount = Math.min(want, cap);
  out.push({ item: label, want, got: held.stackCount, cap, ...(held.stackCount < want ? { note: "capped" } : {}) });
}

function giveParty(key: keyof typeof modifierTypes, want: number, out: ItemRec[]): void {
  const type = typeOf(key);
  const mod = type?.newModifier() as PersistentModifier | null | undefined;
  if (!mod) {
    out.push({ item: key, want, got: 0, note: "no modifier" });
    return;
  }
  globalScene.addModifier(mod, true, false, false, true);
  const held = globalScene.findModifier(m => m.type.id === key, true) as PersistentModifier | undefined;
  if (!held) {
    out.push({ item: key, want, got: 0, note: "not held" });
    return;
  }
  const cap = held.getMaxStackCount();
  held.stackCount = Math.min(want, cap);
  out.push({ item: key, want, got: held.stackCount, cap });
}

function heldSummary(p: Pokemon): Record<string, number> {
  const items: Record<string, number> = {};
  for (const m of p.getHeldItems()) {
    const k =
      m.type.id === "BASE_STAT_BOOSTER" || m.type.id === "IV_CANDY" || m.type.id === "ATTACK_TYPE_BOOSTER"
        ? `${m.type.id}:${m.type.name}`
        : m.type.id;
    items[k] = (items[k] ?? 0) + m.getStackCount();
  }
  return items;
}

/** Held items of an enemy that matter in battle (vitamins / berries / type boosters summed) */
function enemyBattleItems(p: Pokemon): { items: Record<string, number>; total: number } {
  const items: Record<string, number> = {};
  let total = 0;
  for (const m of p.getHeldItems()) {
    const n = m.getStackCount();
    total += n;
    const id = m.type.id;
    const sums: Record<string, string> = { BERRY: "BERRY(sum)", ATTACK_TYPE_BOOSTER: "TYPE_BOOSTER(sum)" };
    const k = sums[id] ?? id;
    items[k] = (items[k] ?? 0) + n;
  }
  return { items, total };
}

// #endregion Helpers

describe.skipIf(!process.env.FORK_SIM)("Sim - the 5850 ace battle", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  const outDir = process.env.FORK_SIM_OUT ?? join(tmpdir(), "sim5850-ace-battle");
  const tag = process.env.FORK_SIM_TAG ?? String(process.pid);
  const summary: Record<string, unknown>[] = [];
  const savedConsole = { log: console.log, warn: console.warn, info: console.info, debug: console.debug };
  /** The real battle RNG (GameManager's constructor makes every randBattleSeedInt roll its maximum) */
  const realRandBattleSeedInt = function (this: BattleScene, range: number, min = 0): number {
    return this.currentBattle?.randSeedInt(range, min);
  };

  /** Local fork (2026-11-13): 11 re-run, the game's own values, put back in afterAll */
  const gameLogBase = BOSS_SEGMENT_OVERFLOW.logBase;
  const gameLensCap = PLAYER_HELD_ITEM_CAPS.MULTI_LENS;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    mkdirSync(outDir, { recursive: true });
    // Local fork (2026-11-13): 11 re-run, the counts must be whole numbers (a NaN would get past giveHeld's `want <= 0`
    // and leave a NaN stack, so the run would write garbage rows instead of failing)
    for (const [name, value] of [
      ["FORK_SIM_LENS", LENS_COUNT],
      ["FORK_SIM_GUARD", GUARD_TOKENS],
      ["FORK_SIM_FORGED", FORGED_STEEL_OVERRIDE ?? 0],
    ] as const) {
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(`${name} must be a whole number of 0 or more, not ${process.env[name]}`);
      }
    }
    // Local fork (2026-11-13): 11 re-run, FORK_SIM_LOG_BASE / FORK_SIM_LENS change the game's rules for this run only
    if (LOG_BASE_OVERRIDE != null) {
      if (!(LOG_BASE_OVERRIDE > 1)) {
        throw new Error(`FORK_SIM_LOG_BASE must be a number above 1, not ${process.env.FORK_SIM_LOG_BASE}`);
      }
      BOSS_SEGMENT_OVERFLOW.logBase = LOG_BASE_OVERRIDE;
    }
    if (LENS_COUNT > gameLensCap) {
      (PLAYER_HELD_ITEM_CAPS as { MULTI_LENS: number }).MULTI_LENS = LENS_COUNT;
    }
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    BattleScene.prototype.randBattleSeedInt = realRandBattleSeedInt;
    game.override.mysteryEncounterChance(0).battleStyle("single").forkContentUnlocked(true);
  });

  afterEach(() => {
    ctx = null;
    while (restorers.length > 0) {
      restorers.pop()!();
    }
    console.log = savedConsole.log;
    console.warn = savedConsole.warn;
    console.info = savedConsole.info;
    console.debug = savedConsole.debug;
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  afterAll(() => {
    // Local fork (2026-11-13): 11 re-run, the module is shared with other test files (isolate: false)
    BOSS_SEGMENT_OVERFLOW.logBase = gameLogBase;
    (PLAYER_HELD_ITEM_CAPS as { MULTI_LENS: number }).MULTI_LENS = gameLensCap;
    if (summary.length > 0) {
      writeFileSync(join(outDir, `summary-${tag}.json`), JSON.stringify(summary, null, 1));
    }
  });

  const mute = () => {
    console.log = () => {};
    console.warn = () => {};
    console.info = () => {};
    console.debug = () => {};
  };

  // #region Setup

  /** The ace's build: species / form / fusion, IVs, nature, passive, level, EVs, moves, then every item */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a simulation driver, kept in one piece
  function buildAce(ace: PlayerPokemon, def: AceDef, v: VariantDef, ivs: number[], items: ItemRec[]): void {
    const scene = globalScene;
    if (def.fusion) {
      const tail = speciesDataRegistry.getSpecies(def.fusion.species);
      ace.fusionSpecies = tail;
      ace.fusionFormIndex = formIndexOf(def.fusion.species, def.fusion.formKey);
      ace.fusionAbilityIndex = 0;
      ace.fusionShiny = false;
      ace.fusionVariant = 0;
      ace.fusionGender = Gender.GENDERLESS;
      ace.fusionLuck = 0;
      ace.generateName();
    }
    ace.level = v.level;
    ace.ivs = ivs.slice();
    // Local fork (2026-11-13): every EV at its cap, HP 504 since "노력치 아이템도 hp만 상한을 두배로" (was all 252)
    ace.evs = PERMANENT_STATS.map(s => getEvCap(s));
    ace.luck = 0;
    ace.shiny = false;
    ace.passive = v.tier === "expert";
    ace.customPassiveSpecies = v.tier === "expert" && def.expertPassive === "custom" ? [def.species] : [];
    ace.moveset = movesFor(def).map(m => new PokemonMove(m, 0, 3));

    // Base-stat growth: vitamins and IV Candies at their cap (= that stat's IV), Soul Dew x10
    for (const s of PERMANENT_STATS) {
      giveHeld(ace, typeOf("BASE_STAT_BOOSTER", [s]), ace.ivs[s], `VITAMIN_${Stat[s]}`, items);
      giveHeld(ace, typeOf("IV_CANDY", [s]), ace.ivs[s], `IV_CANDY_${Stat[s]}`, items);
    }
    // Local fork (2026-11-13): 09 re-run, all four Choice items again (Band, Specs, Scarf, Armor; the 07 build held
    // them too), "플레이어에게는 딱히 구애 아이템 제한을 넣지 않습니다". Only the 08 build (FORK_SIM_BUILD08, 08 명세 6번
    // 1항) holds one: Choice Band for a physical ace, Choice Specs for a special one.
    const choiceItems: [keyof typeof modifierTypes, number][] = BUILD08
      ? [[attackCategory(def) === "physical" ? "CHOICE_BAND" : "CHOICE_SPECS", 1]]
      : [
          ["CHOICE_BAND", 1],
          ["CHOICE_SPECS", 1],
          ["CHOICE_SCARF", 1],
          ["CHOICE_ARMOR", 1],
        ];
    const held: [keyof typeof modifierTypes, number][] = [
      ["SOUL_DEW", 10],
      ["ULTIMATE_GENE", 1],
      ...choiceItems,
      // Local fork (2026-11-13): 11 re-run, the player cap (3 since 10 명세 1번; 4 before) or FORK_SIM_LENS
      ["MULTI_LENS", LENS_COUNT],
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
      ["FLAME_FURNACE", 1],
      ["TOXIC_DISTILLATE", 1],
      ["SUPERCONDUCTING_COIL", 1],
      ["REVIVER_SEED", 1],
    ];
    if (def.category !== "special") {
      held.push(["MUSCLE_BAND", 99]);
    }
    if (def.category !== "physical") {
      held.push(["WISE_GLASSES", 99]);
    }
    // Local fork (2026-11-13): 08 명세 6번 2항, the novice holds no Training Shackles (kept in the 09 re-run's default);
    // only the 07 build (FORK_SIM_BUILD07) gives it Training Shackles x2 (Spe x1/3), unless FORK_SIM_NOVICE_NO_SHACKLES=1
    if (v.tier === "novice" && BUILD07 && !process.env.FORK_SIM_NOVICE_NO_SHACKLES) {
      held.push(["TRAINING_SHACKLES", 2]);
    }
    // Local fork (2026-11-13): 10 re-run, the 3rd balance patch's Forged Steel (HP / Def / SpDef base stats x(10 + n) /
    // 10, applied first in calculateBaseStats). Local fork (2026-11-13): 11 re-run, 4 pieces on a Steel-type ace and
    // none on the others (10 명세 3번), or FORK_SIM_FORGED on every ace; the static flag must match the forge's rule
    if (isForgeEligibleSteelPokemon(ace) !== def.steelType) {
      throw new Error(
        `${def.id}: steelType ${def.steelType}, but the forge's rule says ${isForgeEligibleSteelPokemon(ace)} `
          + `(types ${ace.getTypes({ includeTeraType: false, bypassSummonData: true, ignoreThirdType: true }).map(t => PokemonType[t])})`,
      );
    }
    const forgedPieces = forgedSteelPiecesFor(def);
    if (forgedPieces > 0) {
      held.push(["FORGED_STEEL", forgedPieces]);
    }
    for (const [key, n] of held) {
      giveHeld(ace, typeOf(key), n, key, items);
    }
    for (const t of def.boosterTypes) {
      giveHeld(ace, typeOf("ATTACK_TYPE_BOOSTER", [t]), 99, `TYPE_BOOSTER_${PokemonType[t]}`, items);
    }
    if (def.mega) {
      giveParty("MEGA_BRACELET", 1, items);
    }
    for (const f of def.formItems) {
      giveHeld(ace, typeOf("FORM_CHANGE_ITEM", [f]), 1, `FORM_${FormChangeItem[f]}`, items);
    }
    giveParty("PIERCING_TOKEN", 10, items);
    giveParty("HEALING_CHARM", 5, items);
    // Local fork (2026-11-13): 10 re-run, the 3rd balance patch's Guard Tokens (enemy hits on the party x0.995^m),
    // FORK_SIM_GUARD of them (default 65, the cap)
    if (GUARD_TOKENS > 0) {
      giveParty("GUARD_TOKEN", GUARD_TOKENS, items);
    }
    scene.updateModifiers(true, true);
    ace.calculateStats();
    ace.hp = ace.getMaxHp();
  }

  /** Adds every enemy buff token at its 5850 cap (before the encounter, like a real run that reached 5850) */
  function addTokens(): void {
    for (const id of Object.keys(TOKEN_CAPS) as TokenId[]) {
      const token = modifierTypes[id]().withIdFromFunc(modifierTypes[id]).newModifier() as EnemyPersistentModifier;
      // addEnemyModifier does its work synchronously inside the Promise executor
      globalScene.addEnemyModifier(token, true, true).catch(() => {});
      token.stackCount = TOKEN_CAPS[id];
    }
  }

  function readTokens(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const token of globalScene.findModifiers(m => m instanceof EnemyPersistentModifier, false)) {
      out[token.type.id] = (out[token.type.id] ?? 0) + (token as PersistentModifier).getStackCount();
    }
    return out;
  }

  // #endregion Setup

  // #region Stepping

  /** Runs one phase through the interceptor's state machine (resolves once the phase has ended) */
  async function step(phase: { start(): void; phaseName: string }): Promise<void> {
    const ic = game.phaseInterceptor as unknown as { state: string };
    ic.state = "running";
    phase.start();
    if (ic.state === "idling") {
      return;
    }
    await vi.waitUntil(() => ic.state === "idling", { interval: 1, timeout: 60_000 });
  }

  function clearPrompts(): void {
    (game.promptHandler as unknown as { prompts: unknown[] }).prompts.length = 0;
  }

  function queueFight(cursor: number): void {
    game.onNextPrompt("CommandPhase", UiMode.COMMAND, () => {
      game.scene.ui
        .setMode(UiMode.FIGHT, (game.scene.phaseManager.getCurrentPhase() as CommandPhase).getFieldIndex())
        .catch(() => {});
    });
    game.onNextPrompt("CommandPhase", UiMode.FIGHT, () => {
      (game.scene.phaseManager.getCurrentPhase() as CommandPhase).handleCommand(
        Command.FIGHT,
        cursor,
        MoveUseMode.NORMAL,
      );
    });
  }

  /** Expected damage of `move` from `user` on `target`: simulated getAttackDamage x accuracy */
  function expectedDamage(user: Pokemon, target: Pokemon, moveId: MoveId): number {
    const move = allMoves[moveId];
    if (move.category === MoveCategory.STATUS) {
      return 0;
    }
    // Mold Breaker (A1's expert passive) only acts through arena.ignoreAbilities, which MovePhase sets for the real
    // move; a simulated getAttackDamage outside it would read Levitate as an immunity to Earthquake, so set it here
    const moldBreaker = move.doesFlagEffectApply({ flag: MoveFlags.IGNORE_ABILITIES, user });
    if (moldBreaker) {
      globalScene.arena.setIgnoreAbilities(true, user.getBattlerIndex());
    }
    const dmg = target.getAttackDamage({ source: user, move, simulated: true }).damage;
    if (moldBreaker) {
      globalScene.arena.setIgnoreAbilities(false);
    }
    const acc = move.calculateBattleAccuracy(user, target, true);
    return dmg * (acc < 0 ? 1 : Math.min(1, acc / 100));
  }

  // #endregion Stepping

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a simulation driver, kept in one piece
  async function runBattle(spec: BattleSpec): Promise<BattleRec> {
    const t0 = Date.now();
    const def = ACES[spec.ace];
    const v = VARIANTS[spec.variant];
    const trainerType = OPPONENTS[spec.opponent];
    const seed = `ace5850-${spec.seed}`;
    const ivs = v.tier === "novice" ? noviceIvs(spec.ace, spec.seed) : PERMANENT_STATS.map(() => 31);
    const items: ItemRec[] = [];

    if (trainerType == null) {
      game.override.disableTrainerWaves();
    } else {
      // the override's type lists the random-pool trainers only; the final pool's evil-team bosses work the same way
      game.override.randomTrainer({ trainerType } as Parameters<typeof game.override.randomTrainer>[0]);
    }
    game.override.startingWave(WAVE).seed(seed);
    mute();
    await game.runToTitle();
    let setupError: unknown = null;
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      try {
        const scene = game.scene;
        scene.gameMode = getGameMode(GameModes.ENDLESS);
        scene.offsetGym = false;
        scene.newArena(BiomeId.END);
        const starters = generateStarters(scene, [def.species, ...SUPPORTS]);
        // generateStarters sets the seed to "test": the run's own seed goes in after it
        scene.setSeed(seed);
        const s0 = starters[0];
        s0.formIndex = formIndexOf(def.species, def.formKey);
        s0.ivs = ivs.slice();
        s0.nature = def.nature;
        s0.abilityIndex = 0;
        s0.passive = v.tier === "expert";
        s0.customPassiveSpecies = v.tier === "expert" && def.expertPassive === "custom" ? [def.species] : [];
        s0.shiny = false;
        s0.variant = 0;
        for (const s of starters.slice(1)) {
          s.shiny = false;
          s.variant = 0;
          s.passive = false;
          s.formIndex = 0;
        }
        scene.phaseManager.pushNew("EncounterPhase", false);
        new SelectStarterPhase().initBattle(starters);
        const party = scene.getPlayerParty();
        for (const p of party.slice(1)) {
          p.level = LEVEL_CAP;
          p.luck = 0;
          p.calculateStats();
          p.hp = p.getMaxHp();
        }
        buildAce(party[0], def, v, ivs, items);
        addTokens();
      } catch (e) {
        setupError = e;
      }
    });
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    await game.phaseInterceptor.to("CommandPhase", false);
    if (setupError) {
      throw setupError;
    }
    // The interceptor must not stop on our own CommandPhases from here on
    (game.phaseInterceptor as unknown as { target: PhaseString }).target = "LoginPhase";

    const scene = game.scene;
    const battle = scene.currentBattle;
    const party = scene.getPlayerParty();
    const ace = party[0];
    expect(battle.waveIndex).toBe(WAVE);
    expect(battle.battleType).toBe(trainerType == null ? BattleType.WILD : BattleType.TRAINER);
    if (trainerType != null) {
      expect(battle.trainer?.config.trainerType).toBe(trainerType);
    }

    // Tokens: the ones added before the encounter must still be there at their caps
    let tokens = readTokens();
    for (const id of Object.keys(TOKEN_CAPS) as TokenId[]) {
      if (tokens[id] !== TOKEN_CAPS[id]) {
        throw new Error(`token ${id} is ${tokens[id]} at the first command, not ${TOKEN_CAPS[id]}`);
      }
    }

    const rec: BattleRec = {
      key: spec.key,
      ace: spec.ace,
      aceLabel: def.label,
      variant: spec.variant,
      opponent: spec.opponent,
      seed: spec.seed,
      trainer: battle.trainer ? TrainerType[battle.trainer.config.trainerType] : null,
      result: "error",
      turns: 0,
      kos: 0,
      seconds: 0,
      aceBuild: {},
      run: runParams(def),
      tokens,
      enemies: [],
      turnLog: [],
      aceHeals: [],
      aceOtherDamage: [],
      aceStatuses: [],
      statusTokenProcs: [],
      immunitySwitches: 0,
      forcedOut: 0,
      supportsFainted: 0,
      revived: 0,
      ppOutTurn: null,
      struggles: 0,
      ppSwitches: 0,
      handCheck: {},
    };

    const enemies = new Map<number, EnemyRec>();
    battle.enemyParty.forEach((p, slot) => {
      const { items: battleItems, total } = enemyBattleItems(p);
      enemies.set(p.id, {
        uid: p.id,
        slot,
        species: SpeciesId[p.species.speciesId],
        form: p.getFormKey(),
        fusion: p.fusionSpecies ? SpeciesId[p.fusionSpecies.speciesId] : null,
        fusionForm: p.fusionSpecies ? (p.fusionSpecies.forms[p.fusionFormIndex]?.formKey ?? "") : null,
        level: p.level,
        bars: (p as EnemyPokemon).bossSegments ?? 0,
        hpBars: (p as EnemyPokemon).forkBossHpBars ?? null, // Local fork (2026-11-13): 09 re-run
        maxHp: p.getMaxHp(),
        stats: [...p.stats],
        ability: p.getAbility().name,
        passive: p.hasPassive() ? p.getPassiveAbility().name : null,
        moves: p.getMoveset().map(m => moveName(m.moveId)),
        battleItems,
        heldStacks: total,
        nominalHealPctPerTurn: r4(
          TOKEN_CAPS.ENEMY_HEAL * 2
            + ((battleItems.LEFTOVERS ?? 0) * Math.max(1, Math.floor(p.getMaxHp() / 16)) * 100) / p.getMaxHp(),
        ),
        faced: false,
        koTurn: null,
        koBy: null, // Local fork (2026-11-13): 11 re-run
        aceHits: [],
        hitsToKo: null,
        aceAttackTurns: [],
        turnsToKo: null,
        hitsOnAce: [],
        heals: [],
        focusBandSaves: 0,
        endureTokenSaves: 0,
        otherDamage: [],
      });
    });
    rec.enemies = [...enemies.values()];

    // Baton Pass chain before the ace enters (upper bound; Unaware ignores it)
    if (v.batonPass) {
      ace.setStatStage(Stat.ATK, 6);
      ace.setStatStage(Stat.SPATK, 6);
      ace.setStatStage(Stat.SPD, 6);
    }

    const effective: Record<string, number> = {};
    for (const s of EFFECTIVE_STATS) {
      effective[Stat[s]] = ace.getEffectiveStat(s);
    }
    rec.aceBuild = {
      species: SpeciesId[ace.species.speciesId],
      form: ace.getFormKey(),
      fusion: ace.fusionSpecies ? SpeciesId[ace.fusionSpecies.speciesId] : null,
      fusionForm: ace.fusionSpecies ? (ace.fusionSpecies.forms[ace.fusionFormIndex]?.formKey ?? "") : null,
      types: ace.getTypes().map(t => PokemonType[t]),
      level: ace.level,
      ivs: [...ace.ivs],
      evs: [...ace.evs],
      nature: Nature[ace.getNature()],
      ability: ace.getAbility().name,
      passive: ace.hasPassive() ? ace.getPassiveAbility().name : null,
      moves: ace.getMoveset().map(m => `${moveName(m.moveId)} (${m.getMovePp()} PP)`),
      stats: {
        HP: ace.stats[0],
        ATK: ace.stats[1],
        DEF: ace.stats[2],
        SPATK: ace.stats[3],
        SPDEF: ace.stats[4],
        SPD: ace.stats[5],
      },
      maxHp: ace.getMaxHp(),
      effectiveStatsAtStart: effective,
      statStages: v.batonPass ? "+6 Atk / +6 SpA / +6 Spe" : "none",
      // Local fork (2026-11-13): 09 re-run, the level following ("적의 에이스 포켓몬이 플레이어의 가장 높은 레벨의
      // 포켓몬의 레벨에 비례하도록"): P, C and f = max(1, P / C) ^ 0.5 (α = 1 before the 3rd balance patch) for this party
      // on this wave (the party is unchanged since the Battle constructor rolled the levels)
      enemyLevelFollow: {
        highestPlayerLevel: getHighestPlayerPartyLevel(),
        cap: getNaturalMaxExpLevel(scene.gameMode, WAVE),
        factor: getEndlessPlayerLevelFollowFactor(scene.gameMode, WAVE, getHighestPlayerPartyLevel()),
      },
      build: BUILD_NAME,
      // Local fork (2026-11-13): 10 re-run, what the build asked for (the held / party counts are below)
      guardTokensWanted: GUARD_TOKENS,
      forgedSteelWanted: forgedSteelPiecesFor(def), // Local fork (2026-11-13): 11 re-run, per ace
      multiLensWanted: LENS_COUNT, // Local fork (2026-11-13): 11 re-run
      bossOverflowLogBase: BOSS_SEGMENT_OVERFLOW.logBase, // Local fork (2026-11-13): 11 re-run
      held: heldSummary(ace),
      itemsGiven: items,
      itemDeviations: items.filter(i => i.got < i.want),
      partyItems: Object.fromEntries(
        scene
          .findModifiers(m => !(m instanceof PokemonHeldItemModifier), true)
          .map(m => [m.type.id, (m as PersistentModifier).getStackCount()]),
      ),
    };

    const reducer = scene.findModifier(m => m instanceof EnemyDamageReducerModifier, false) as
      | EnemyDamageReducerModifier
      | undefined;
    ctx = {
      rec,
      ace,
      enemies,
      turn: 0,
      inRealDamageCalc: false,
      raw: null,
      lastBase: null,
      pending: null,
      damageDepth: 0,
      innerRequested: 0,
      surviveFlag: false,
      endureTokenFor: null,
      healLabel: null,
      piercing: TOKEN_CAPS.ENEMY_DAMAGE_REDUCTION > 0 ? 10 : 0,
      reduction: reducer?.getDamageMultiplier() ?? 1,
      boosterStacks: TOKEN_CAPS.ENEMY_DAMAGE_BOOSTER,
      guardStacks:
        (scene.findModifier(m => m.type.id === "GUARD_TOKEN", true) as PersistentModifier | undefined)?.getStackCount()
        ?? 0,
    };
    const c = ctx;
    c.piercing =
      (scene.findModifier(m => m.type.id === "PIERCING_TOKEN", true) as PersistentModifier | undefined)?.getStackCount()
      ?? 0;

    // #region The battle loop
    const pm = scene.phaseManager;
    const endPhases = new Set<string>([
      "BattleEndPhase",
      "TrainerVictoryPhase",
      "GameOverPhase",
      "NewBattlePhase",
      "SelectModifierPhase",
      "EncounterPhase",
    ]);
    const faintCheckPhases = new Set<string>(["SwitchPhase", "CommandPhase", "TurnInitPhase", "TurnEndPhase"]);
    let turnOrder: string[] = [];
    let turnEvents: string[] = [];
    let currentAction = "";
    let turnEnemy: EnemyPokemon | null = null;
    let lastStatus: StatusEffect | undefined = ace.status?.effect;

    /** Closes the turn `c.turn` (HP read after its turn-end heals and status damage) */
    const closeTurn = () => {
      if (c.turn <= 0) {
        return;
      }
      const enemy = turnEnemy;
      rec.turnLog.push({
        turn: c.turn,
        enemyUid: enemy?.id ?? null,
        enemy: enemy ? enemies.get(enemy.id)?.species : undefined,
        action: currentAction,
        order: turnOrder,
        firstMover: turnOrder.find(o => !o.endsWith("(x)"))?.split(":")[0] ?? null,
        flinched: turnOrder.filter(o => o.endsWith("(flinch)")).length,
        events: turnEvents,
        aceHp: ace.hp,
        aceHpPct: r4((ace.hp / ace.getMaxHp()) * 100),
        enemyHpPct: enemy ? r4((enemy.hp / enemy.getMaxHp()) * 100) : null,
        aceStatus: ace.status ? StatusEffect[ace.status.effect] : null,
      });
      turnOrder = [];
      turnEvents = [];
    };

    try {
      for (let guard = 0; guard < 1_000_000; guard++) {
        const phase = pm.getCurrentPhase();
        const name = phase.phaseName;
        // statuses on the ace
        const st = ace.status?.effect;
        if (st !== lastStatus) {
          if (st != null && st !== StatusEffect.NONE) {
            rec.aceStatuses.push({ turn: c.turn, status: StatusEffect[st] });
          }
          lastStatus = st;
        }
        if (endPhases.has(name)) {
          closeTurn();
          if (battle.enemyParty.every(p => p.isFainted())) {
            rec.result = "swept";
          } else if (ace.isFainted()) {
            rec.result = "aceFainted";
          } else {
            rec.result = "error";
            rec.error = `battle ended in ${name} without a sweep`;
          }
          break;
        }
        if (ace.isFainted() && faintCheckPhases.has(name)) {
          closeTurn();
          rec.result = "aceFainted";
          break;
        }
        if (name === "CommandPhase") {
          const prevAction = currentAction;
          if (battle.turn !== c.turn) {
            closeTurn();
            c.turn = battle.turn;
          }
          if (c.turn > MAX_TURNS) {
            rec.result = "stalled";
            break;
          }
          clearPrompts();
          const active = scene.getPlayerField()[0];
          const enemy = scene.getEnemyField().find(p => p.isActive(true));
          turnEnemy = enemy ?? null;
          if (enemy) {
            const e = enemies.get(enemy.id);
            if (e) {
              e.faced = true;
            }
          }
          if (active === ace) {
            if (ace.getMoveQueue().length > 0) {
              currentAction = "queued";
            } else {
              const moveset = ace.getMoveset();
              const opts = moveset.map((pm2, i) => ({
                i,
                id: pm2.moveId,
                usable: pm2.isUsable(ace, false, true)[0],
                exp: enemy ? expectedDamage(ace, enemy, pm2.moveId) : 0,
              }));
              const usable = opts.filter(o => o.usable);
              const lock = ace.getTag(BattlerTagType.CHOICE_LOCK) as { isInForce(p: Pokemon): boolean } | undefined;
              const locked = !!lock?.isInForce(ace);
              const supportIdx = party.findIndex((p, i) => i > 0 && p !== ace && !p.isFainted());
              if (usable.length === 0) {
                const lockedOutOfPp = locked && moveset.some(m => m.isOutOfPp());
                if (rec.ppOutTurn == null && (lockedOutOfPp || moveset.every(m => m.isOutOfPp()))) {
                  rec.ppOutTurn = c.turn;
                }
                // Locked into a move with no PP left: Struggle when it knocks the target out, else switch out to
                // reset the lock and come back (like the immunity switch)
                const struggleExp = enemy ? expectedDamage(ace, enemy, MoveId.STRUGGLE) : 0;
                if (lockedOutOfPp && enemy && struggleExp < enemy.hp && supportIdx > 0 && !ace.isTrapped()) {
                  rec.ppSwitches++;
                  currentAction = "switch-out (locked move out of PP)";
                  game.doSwitchPokemon(supportIdx);
                } else {
                  rec.struggles++;
                  currentAction = "struggle";
                  queueFight(0);
                }
              } else {
                const best = usable.reduce((a, b) => (b.exp > a.exp ? b : a));
                if (best.exp <= 0 && enemy && locked && supportIdx > 0 && !ace.isTrapped()) {
                  rec.immunitySwitches++;
                  currentAction = `switch-out (locked ${moveName(best.id)} does 0)`;
                  game.doSwitchPokemon(supportIdx);
                } else {
                  currentAction = `${moveName(best.id)}${locked ? " (locked)" : ""}`;
                  queueFight(best.i);
                }
              }
            }
          } else {
            const aceIdx = party.indexOf(ace);
            // off the field without our switch-out (Roar, Dragon Tail, Red Card, Eject Button ...)
            if (!ace.isFainted() && !prevAction.startsWith("switch-out") && prevAction !== "support attacks") {
              rec.forcedOut++;
              turnEvents.push("ace was forced out");
            }
            if (!ace.isFainted() && aceIdx > 0 && !active.isTrapped()) {
              currentAction = "switch-in ace";
              game.doSwitchPokemon(aceIdx);
            } else {
              currentAction = "support attacks";
              const i = active.getMoveset().findIndex(m => m.isUsable(active, false, true)[0]);
              queueFight(Math.max(0, i));
            }
          }
        } else if (name === "SwitchPhase") {
          clearPrompts();
          rec.supportsFainted = party.filter(p => p !== ace && p.isFainted()).length;
          const aceIdx = party.indexOf(ace);
          const slot = !ace.isFainted() && aceIdx > 0 ? aceIdx : party.findIndex((p, i) => i > 0 && !p.isFainted());
          turnEvents.push(
            `party prompt: sent out ${party[slot] === ace ? "the ace" : SpeciesId[party[slot].species.speciesId]}`,
          );
          game.doSelectPartyPokemon(slot, "SwitchPhase");
        } else if (name === "SelectTargetPhase") {
          game.onNextPrompt("SelectTargetPhase", UiMode.TARGET_SELECT, () => {
            const handler = game.scene.ui.getHandler() as unknown as {
              setCursor(i: number): void;
              processInput(b: number): void;
            };
            handler.setCursor(BattlerIndex.ENEMY);
            handler.processInput(Button.ACTION);
          });
        } else if (name === "MovePhase") {
          const mp = phase as unknown as MovePhase;
          let who = mp.pokemon.isPlayer() ? "support" : "enemy";
          if (mp.pokemon === ace) {
            who = "ace";
          }
          // (x): the mover had fainted or left the field before its turn came; (flinch): King's Rock / flinch move
          const gone = mp.pokemon.isFainted() || !mp.pokemon.isOnField();
          const flinch = !gone && !!mp.pokemon.getTag(BattlerTagType.FLINCHED);
          let mark = flinch ? "(flinch)" : "";
          if (gone) {
            mark = "(x)";
          }
          turnOrder.push(`${who}:${moveName(mp.move.moveId)}${mark}`);
          // Local fork (2026-11-13): 11 re-run, a turn the ace spends attacking the enemy on the field (misses, flinches
          // and full paralysis included), for the attacking turns an enemy takes to fall
          if (who === "ace" && !gone && allMoves[mp.move.moveId].category !== MoveCategory.STATUS) {
            const foe = scene.getEnemyField().find(p => p.isActive(true)) ?? turnEnemy;
            const e = foe ? enemies.get(foe.id) : undefined;
            if (e && !e.aceAttackTurns.includes(c.turn)) {
              e.aceAttackTurns.push(c.turn);
            }
          }
        }
        await step(phase);
      }
    } catch (e) {
      rec.result = "error";
      rec.error = `${String(e)} (phase ${pm.getCurrentPhase()?.phaseName}, ui mode ${UiMode[scene.ui.mode]})`;
    }
    // #endregion The battle loop

    rec.turns = Math.max(0, c.turn);
    rec.kos = battle.enemyParty.filter(p => p.isFainted()).length;
    // Local fork (2026-11-13): 11 re-run, the ace's attacking turns each enemy it knocked out took
    for (const e of enemies.values()) {
      const ko = e.koTurn;
      e.turnsToKo = ko == null ? null : e.aceAttackTurns.filter(t => t <= ko).length;
    }
    rec.supportsFainted = party.filter(p => p !== ace && p.isFainted()).length;
    tokens = readTokens();
    rec.tokens = tokens;
    rec.seconds = (Date.now() - t0) / 1000;
    ctx = null;
    return rec;
  }

  if (process.env.FORK_SIM_MERGE) {
    it("merges the per-battle JSON files", () => {
      const files = readdirSync(outDir).filter(f => /^A\d-.*\.json$/.test(f));
      const rows = files.map(f => JSON.parse(readFileSync(join(outDir, f), "utf8")) as BattleRec).map(compact);
      writeFileSync(join(outDir, "summary-all.json"), JSON.stringify(rows, null, 1));
      writeFileSync(join(outDir, "summary-all.txt"), rows.map(r => JSON.stringify(r)).join("\n"));
      print(`merged ${rows.length} battles into ${join(outDir, "summary-all.json")}`);
      expect(rows.length).toBeGreaterThan(0);
    });
    return;
  }

  const grid = buildGrid();
  it.each(grid)(
    "$key",
    async spec => {
      installPatches();
      const t0 = Date.now();
      let rec: BattleRec;
      try {
        rec = await runBattle(spec);
      } catch (e) {
        // a setup failure (the run did not reach the first command, a token or battle check failed): one error row
        ctx = null;
        rec = {
          key: spec.key,
          ace: spec.ace,
          aceLabel: ACES[spec.ace].label,
          variant: spec.variant,
          opponent: spec.opponent,
          seed: spec.seed,
          trainer: null,
          result: "error",
          error: `setup: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
          turns: 0,
          kos: 0,
          seconds: (Date.now() - t0) / 1000,
          aceBuild: {},
          run: runParams(ACES[spec.ace]),
          tokens: {},
          enemies: [],
          turnLog: [],
          aceHeals: [],
          aceOtherDamage: [],
          aceStatuses: [],
          statusTokenProcs: [],
          immunitySwitches: 0,
          forcedOut: 0,
          supportsFainted: 0,
          revived: 0,
          ppOutTurn: null,
          struggles: 0,
          ppSwitches: 0,
          handCheck: {},
        };
      }
      writeFileSync(join(outDir, `${spec.key}.json`), JSON.stringify(rec, null, 1));
      const row = {
        ...compact(rec),
        heapMb: Math.round(process.memoryUsage().heapUsed / 2 ** 20),
        rssMb: Math.round(process.memoryUsage().rss / 2 ** 20),
      };
      summary.push(row);
      print(JSON.stringify(row));
      expect(["swept", "aceFainted", "stalled", "error"]).toContain(rec.result);
    },
    3_600_000,
  );
});

/** One summary row per battle */
function compact(rec: BattleRec): Record<string, unknown> {
  const faced = rec.enemies.filter(e => e.faced);
  const firstAceHit = faced.flatMap(e => e.aceHits.map(h => ({ e, h })))[0];
  const firstEnemyHit = faced.flatMap(e => e.hitsOnAce)[0];
  const stats = rec.aceBuild.stats as Record<string, number> | undefined;
  // Local fork (2026-11-13): 11 re-run, the main ace: the trainer's Pokémon with the most bars (the later slot on a tie)
  const main = rec.enemies.reduce<EnemyRec | null>((a, e) => (a == null || e.bars >= a.bars ? e : a), null);
  return {
    key: rec.key,
    trainer: rec.trainer,
    run: rec.run, // Local fork (2026-11-13): 11 re-run
    result: rec.result,
    error: rec.error,
    turns: rec.turns,
    kos: rec.kos,
    seconds: rec.seconds,
    aceStats: stats ? [stats.HP, stats.ATK, stats.DEF, stats.SPATK, stats.SPDEF, stats.SPD] : null,
    aceMaxHp: rec.aceBuild.maxHp,
    immunitySwitches: rec.immunitySwitches,
    forcedOut: rec.forcedOut,
    revived: rec.revived,
    struggles: rec.struggles,
    ppSwitches: rec.ppSwitches,
    ppOutTurn: rec.ppOutTurn,
    aceFirstTurns: rec.turnLog.filter(t => t.firstMover === "ace").length,
    flinches: rec.turnLog.reduce((a, t) => a + (t.flinched ?? 0), 0),
    aceStatuses: rec.aceStatuses.map(s => `${s.turn}:${s.status}`),
    aceMinHpPct: rec.turnLog.length > 0 ? Math.min(...rec.turnLog.map(t => t.aceHpPct)) : null,
    enemies: rec.enemies.map(e => ({
      sp: `${e.species}${e.form ? `-${e.form}` : ""}${e.fusion ? `/${e.fusion}${e.fusionForm ? `-${e.fusionForm}` : ""}` : ""}`,
      bars: e.bars,
      maxHp: e.maxHp,
      ko: e.koTurn,
      koBy: e.koBy ?? null, // Local fork (2026-11-13): 11 re-run (missing in older records)
      hits: e.aceHits.length,
      firstPct: e.aceHits[0]?.pct ?? null,
      firstR: e.aceHits[0]?.R ?? null,
      medPct: median(e.aceHits.map(h => h.pct)),
      medR: median(e.aceHits.map(h => h.R ?? Number.NaN).filter(x => !Number.isNaN(x))),
      nomHealPct: e.nominalHealPctPerTurn,
      healedPct: r4Safe(e.heals.reduce((a, h) => a + h.pctMaxHp, 0)),
      fb: e.focusBandSaves,
      et: e.endureTokenSaves,
      hitsOnAce: e.hitsOnAce.length,
      maxHitOnAcePct: e.hitsOnAce.length > 0 ? Math.max(...e.hitsOnAce.map(h => h.pctAceMaxHp)) : null,
      // Local fork (2026-11-13): 11 re-run, the attacking turns to its KO and the bars broken on each of them
      tko: e.turnsToKo,
      barsT: barsPerAttackTurn(e),
    })),
    // Local fork (2026-11-13): 11 re-run, the main ace's fall: attacking turns, bars broken per turn and per strike
    mainAce: main
      ? {
          slot: main.slot,
          sp: main.species,
          bars: main.bars,
          ko: main.koTurn,
          koBy: main.koBy ?? null,
          tko: main.turnsToKo,
          attackTurns: attackTurnsOf(main).length,
          barsT: barsPerAttackTurn(main),
          barsS: main.aceHits.map(h => h.barsBefore - h.barsAfter),
          strikesT: attackTurnsOf(main).map(t => main.aceHits.filter(h => h.turn === t).length),
        }
      : null,
    firstAceHit: firstAceHit ? { on: firstAceHit.e.species, ...firstAceHit.h } : null,
    firstEnemyHit: firstEnemyHit ?? null,
  };
}

/**
 * Local fork (2026-11-13): 11 re-run, the bars the ace broke on `e` in each of its attacking turns on it, in order (0 for
 * a turn it missed, flinched or was fully paralysed)
 */
function barsPerAttackTurn(e: EnemyRec): number[] {
  return attackTurnsOf(e).map(t =>
    e.aceHits.filter(h => h.turn === t).reduce((a, h) => a + (h.barsBefore - h.barsAfter), 0),
  );
}

/**
 * Local fork (2026-11-13): 11 re-run, `e.aceAttackTurns`, or none for a record written before it existed
 * (FORK_SIM_MERGE over an older output directory)
 */
function attackTurnsOf(e: EnemyRec): number[] {
  return (e.aceAttackTurns as number[] | undefined) ?? [];
}

function median(xs: number[]): number | null {
  if (xs.length === 0) {
    return null;
  }
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

function r4Safe(x: number): number {
  return Number.isFinite(x) ? Number(x.toPrecision(4)) : x;
}
