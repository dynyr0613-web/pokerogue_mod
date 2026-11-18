// Local fork (2026-11-13) — simulation harness, skipped by the normal suite (run with FORK_SIM=1).
// Which trainers are the strongest at Endless wave 5850 (the last Endless wave, battle-end-phase.ts)? Candidates for a
// curated "strongest at 5850" trainer pool (the user: "5850웨이브에 트레이너를 등장시키는, 엘리트 트레이너 중에서도 가장
// 강한 몇만 엄선해서 등장시키는 특수 규칙을 만들도록 하죠, 기존 패러독스 보스는 5850에서 나오기엔 좀 약해서").
//
// Each candidate's party is built the way a standard Endless trainer battle builds it: `new Trainer` + `new Battle`
// (the Endless fill, `forkEndlessFillWave`), `Trainer.genPartyMember` for every member (`EncounterPhase.start`), then
// `rollTrainerBattleForm` (battle forms, fixed fusions past wave 200), then `regenerateModifierPoolThresholds` +
// `BattleScene.generateEnemyModifiers` (trainer held items, vitamin bundles, fork items, form items). The run stands in
// the END biome (where wave 5850 is) with the fusion token at its cap (10 stacks: certain long before 5850).
//
// Env: FORK_SIM=1 to run; FORK_SIM_OUT=<file.json> to write the raw records; FORK_SIM_SEEDS=a,b,c (default 3 seeds);
// FORK_SIM_TRAINERS=CYNTHIA,LEON to restrict; FORK_SIM_NO_TOKEN=1 to leave the fusion token out.
import { Battle } from "#app/battle";
import { getGameMode } from "#app/game-mode";
// Local fork (2026-11-18): standAtExpectedLevel
import { ENDLESS_PLAYER_LEVEL_FOLLOW_NEUTRAL_RATIO, getNaturalMaxExpLevel } from "#balance/endless-level-scaling";
import { NON_LEGEND_PARADOX_POKEMON, NON_LEGEND_ULTRA_BEASTS } from "#balance/special-species-groups";
import { modifierTypes } from "#data/data-lists";
import { isBattleFormKey, rollTrainerBattleForm, rollWildBattleForm } from "#data/enemy-battle-forms";
import type { PokemonSpecies } from "#data/pokemon-species";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { PERMANENT_STATS, Stat } from "#enums/stat";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { UiMode } from "#enums/ui-mode";
import type { EnemyPokemon } from "#field/pokemon";
import { Trainer } from "#field/trainer";
import { ENEMY_CUSTOM_ITEMS } from "#modifiers/enemy-custom-items";
import {
  AttackTypeBoosterModifier,
  BaseStatModifier,
  BerryModifier,
  type EnemyPersistentModifier,
  PokemonFormChangeItemModifier,
  PokemonHeldItemModifier,
} from "#modifiers/modifier";
import { regenerateModifierPoolThresholds } from "#modifiers/modifier-type";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import { getAppRootDir } from "#test/utils/sprite-utils";
import { trainerConfigs } from "#trainers/trainer-config";
import { calculateBossSegmentDamage } from "#utils/damage";
import { willTerastallize } from "#utils/pokemon-utils";
import { toCamelCase } from "#utils/strings";
import fs from "node:fs";
import path from "node:path";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const WAVE = 5850;
const SEEDS = (process.env.FORK_SIM_SEEDS ?? "s5850-a,s5850-b,s5850-c").split(",").filter(s => s.length > 0);
const WITH_FUSION_TOKEN = !process.env.FORK_SIM_NO_TOKEN;

interface Candidate {
  readonly type: TrainerType;
  readonly group: "champion" | "evil boss" | "gym" | "fork named" | "elite";
}

const candidate = (group: Candidate["group"], ...types: TrainerType[]): Candidate[] =>
  types.map(type => ({ type, group }));

const ALL_CANDIDATES: readonly Candidate[] = [
  ...candidate(
    "champion",
    TrainerType.BLUE,
    TrainerType.RED,
    TrainerType.LANCE_CHAMPION,
    TrainerType.STEVEN,
    TrainerType.WALLACE,
    TrainerType.CYNTHIA,
    TrainerType.ALDER,
    TrainerType.IRIS,
    TrainerType.DIANTHA,
    TrainerType.KUKUI,
    TrainerType.HAU,
    TrainerType.LEON,
    TrainerType.MUSTARD,
    TrainerType.GEETA,
    TrainerType.NEMONA,
    TrainerType.KIERAN,
  ),
  ...candidate(
    "evil boss",
    TrainerType.ROCKET_BOSS_GIOVANNI_2,
    TrainerType.MAXIE_2,
    TrainerType.ARCHIE_2,
    TrainerType.CYRUS_2,
    TrainerType.GHETSIS_2,
    TrainerType.LYSANDRE_2,
    TrainerType.LUSAMINE_2,
    TrainerType.GUZMA_2,
    TrainerType.ROSE_2,
    TrainerType.PENNY_2,
  ),
  ...candidate("gym", TrainerType.GIOVANNI, TrainerType.RAIHAN),
  ...candidate(
    "fork named",
    TrainerType.VOLO,
    TrainerType.IRIDA,
    TrainerType.ADAMAN,
    TrainerType.KAMADO,
    TrainerType.SONIA,
    TrainerType.HOP,
    TrainerType.PEONY,
    TrainerType.SADA,
    TrainerType.TURO,
    TrainerType.CARMINE,
    TrainerType.BRIAR,
  ),
  ...candidate("elite", TrainerType.ACE_TRAINER),
];

const ONLY = process.env.FORK_SIM_TRAINERS?.split(",").filter(s => s.length > 0);
const CANDIDATES = ONLY ? ALL_CANDIDATES.filter(c => ONLY.includes(TrainerType[c.type])) : ALL_CANDIDATES;

const FORK_ITEM_IDS = new Set<string>(ENEMY_CUSTOM_ITEMS.candidates.map(c => c.id));

const koNames: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(getAppRootDir(), "locales", "ko", "pokemon.json"), "utf8"),
);
const koName = (speciesId: SpeciesId): string => koNames[toCamelCase(SpeciesId[speciesId])] ?? SpeciesId[speciesId];

/** legendary / sub-legendary / mythical / UB / Paradox (non-legend lists first: they are flagged sub-legendary) */
function legendClass(species: PokemonSpecies): string | null {
  if (NON_LEGEND_ULTRA_BEASTS.includes(species.speciesId)) {
    return "UB";
  }
  if (NON_LEGEND_PARADOX_POKEMON.includes(species.speciesId)) {
    return "paradox";
  }
  if (species.legendary) {
    return "legendary";
  }
  if (species.subLegendary) {
    return "sub-legendary";
  }
  if (species.mythical) {
    return "mythical";
  }
  return null;
}

interface MemberRecord {
  slot: number;
  species: string;
  ko: string;
  formKey: string;
  fusion: { species: string; ko: string; formKey: string } | null;
  /** The battle form key of the head (or of the tail, marked "tail:") */
  battleForm: string | null;
  legend: string[];
  types: string[];
  ability: string;
  passive: boolean;
  passiveAbility: string;
  level: number;
  bossSegments: number;
  /** Base stat total of the form / fusion as generated, before vitamins */
  rawBst: number;
  /** `calculateBaseStats()` total: with the vitamins */
  effBst: number;
  /** Average vitamin multiplier over the 6 stats (effective / raw base stat) */
  vitaminMult: number;
  /** Final stats (level, IVs, nature, vitamins, fusion) */
  stats: number[];
  statSum: number;
  tera: string;
  instantTera: boolean;
  items: {
    /** Number of different held items */
    kinds: number;
    /** Sum of stacks */
    stacks: number;
    vitaminStacks: number;
    berryStacks: number;
    typeBoosterStacks: number;
    battleItems: Record<string, number>;
    fork: string[];
    formItem: string | null;
  };
  moves: string[];
}

interface PartyRecord {
  trainer: string;
  group: string;
  seed: string;
  isBoss: boolean;
  moneyMultiplier: number;
  battleBgm: string;
  partySize: number;
  /** Wall time (ms) of party generation: members + battle form + items */
  msParty: number;
  msMembers: number;
  msItems: number;
  members: MemberRecord[];
}

/** Prints what the harness saw (the console is muted while parties are built) */
function observe(label: string, data: unknown): void {
  process.stdout.write(`[sim-5850] ${label} ${typeof data === "string" ? data : JSON.stringify(data)}\n`);
}

function summarizeMember(p: EnemyPokemon, slot: number, held: PokemonHeldItemModifier[]): MemberRecord {
  const head = p.getSpeciesForm(true);
  const raw = head.baseStats.slice(0);
  let fusion: MemberRecord["fusion"] = null;
  let battleForm: string | null = isBattleFormKey(p.getFormKey()) ? p.getFormKey() : null;
  const legend = [legendClass(p.species)].filter((l): l is string => l != null);
  if (p.isFusion() && p.fusionSpecies) {
    const tail = p.getFusionSpeciesForm(true);
    for (const s of PERMANENT_STATS) {
      raw[s] = Math.ceil((raw[s] + tail.baseStats[s]) / 2);
    }
    const tailKey = p.getFusionFormKey() ?? "";
    fusion = { species: SpeciesId[p.fusionSpecies.speciesId], ko: koName(p.fusionSpecies.speciesId), formKey: tailKey };
    if (battleForm == null && isBattleFormKey(tailKey)) {
      battleForm = `tail:${tailKey}`;
    }
    const tailLegend = legendClass(p.fusionSpecies);
    if (tailLegend) {
      legend.push(`tail:${tailLegend}`);
    }
  }
  const eff = p.calculateBaseStats();
  const rawBst = raw.reduce((a, b) => a + b, 0);
  const effBst = eff.reduce((a, b) => a + b, 0);
  const battleItems: Record<string, number> = {};
  const fork: string[] = [];
  let vitaminStacks = 0;
  let berryStacks = 0;
  let typeBoosterStacks = 0;
  let formItem: string | null = null;
  for (const m of held) {
    if (m instanceof BaseStatModifier) {
      vitaminStacks += m.stackCount;
    } else if (m instanceof BerryModifier) {
      berryStacks += m.stackCount;
    } else if (m instanceof AttackTypeBoosterModifier) {
      typeBoosterStacks += m.stackCount;
    } else if (m instanceof PokemonFormChangeItemModifier) {
      formItem = m.type.id;
    } else if (FORK_ITEM_IDS.has(m.type.id)) {
      fork.push(m.type.id);
    } else {
      battleItems[m.type.id] = (battleItems[m.type.id] ?? 0) + m.stackCount;
    }
  }
  const stats = [...p.stats];
  return {
    slot,
    species: SpeciesId[p.species.speciesId],
    ko: koName(p.species.speciesId),
    formKey: p.getFormKey(),
    fusion,
    battleForm,
    legend,
    types: p.getTypes().map(t => PokemonType[t]),
    ability: AbilityId[p.getAbility().id],
    passive: p.hasPassive(),
    passiveAbility: AbilityId[p.getPassiveAbility().id],
    level: p.level,
    bossSegments: p.isBoss() ? p.bossSegments : 0,
    rawBst,
    effBst,
    vitaminMult: Math.round((PERMANENT_STATS.reduce((a, s) => a + eff[s] / raw[s], 0) / 6) * 100) / 100,
    stats,
    statSum: stats.reduce((a, b) => a + b, 0),
    tera: PokemonType[p.teraType],
    instantTera: willTerastallize(p),
    items: {
      kinds: held.length,
      stacks: held.reduce((a, m) => a + m.stackCount, 0),
      vitaminStacks,
      berryStacks,
      typeBoosterStacks,
      battleItems,
      fork,
      formItem,
    },
    moves: p.getMoveset().map(m => MoveId[m.moveId]),
  };
}

/**
 * How many hits a Pokémon with `segments` health bars takes when every hit deals `damageFactor` × its max HP, by the
 * game's own segment rule (`calculateBossSegmentDamage`, utils/damage.ts: damage stops at a bar unless the overflow past
 * it is at least 2.4^k bars, which breaks k more). 0 or 1 bar: one hit. 2 bars: 2 hits at 1× (and 1.5×) max HP, 1 hit
 * from 1.7×. 26 bars (the wild End boss on wave 5850): 7 hits at 1×, 4 at 10×.
 * Local fork (2026-11-13): 10 명세 2번, the overflow log base 2 -> 2.4 (`BOSS_SEGMENT_OVERFLOW.logBase`); with base 2
 * it was 2^k bars, 1 hit from 1.5× on 2 bars, 6 hits at 1× and 3 at 10× on 26.
 */
export function hitsToKo(segments: number, damageFactor: number): number {
  if (segments <= 1) {
    return 1;
  }
  const maxHp = 1_000_000 * segments;
  const segmentHp = maxHp / segments;
  const damage = Math.round(maxHp * damageFactor);
  let hp = maxHp;
  let segmentIndex = segments - 1;
  let hits = 0;
  while (hp > 0 && hits < 1000) {
    hits++;
    const [dealt, cleared] =
      segmentIndex > 0 ? calculateBossSegmentDamage(damage, hp, segmentHp, 0, segmentIndex) : [damage, 1];
    hp -= dealt;
    segmentIndex = Math.min(segmentIndex, Math.max(0, cleared - 1));
  }
  return hits;
}

/**
 * The strength score of one party (documented in the report): per member
 * `statSum × hitsToKo(bars, 1×) × (1 + 0.10 × passive + 0.05 × forkItems)`, summed, / 1e6.
 * `statSum` (the six final stats) already carries level, IVs, nature, base stats of the form / fusion and vitamins;
 * the hits are what the health bars cost a sweeper whose hit just takes a member's max HP; a passive is a second
 * ability; each fork item a held-item multiplier. `hitsFactor` 0 gives the bar-neutral "power" score.
 */
export function partyScore(members: readonly MemberRecord[], hitsFactor = 1): number {
  return (
    members.reduce(
      (sum, m) =>
        sum
        + m.statSum
          * (hitsFactor > 0 ? hitsToKo(m.bossSegments, hitsFactor) : 1)
          * (1 + 0.1 * Number(m.passive) + 0.05 * m.items.fork.length),
      0,
    ) / 1e6
  );
}

describe.skipIf(!process.env.FORK_SIM)("Sim - strongest trainers at Endless wave 5850", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logSpy: MockInstance | undefined;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH])
      .mysteryEncounterChance(0)
      .startingBiome(BiomeId.END);
  });

  afterEach(() => {
    logSpy?.mockRestore();
    logSpy = undefined;
    vi.restoreAllMocks();
  });

  /** Starts an Endless run on `wave` the way the title screen would, and plays to the first command */
  async function startRun(wave: number): Promise<void> {
    game.override.startingWave(wave);
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.ENDLESS);
      game.scene.offsetGym = false;
      const starters = generateStarters(game.scene, [SpeciesId.FEEBAS]);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    await game.phaseInterceptor.to("CommandPhase", false);
  }

  /** The fusion token at its cap of 10 stacks (10% per Pokémon), as every run has it long before wave 5850 */
  async function addCappedFusionToken(): Promise<void> {
    const token = modifierTypes.ENEMY_FUSED_CHANCE().newModifier() as EnemyPersistentModifier;
    token.stackCount = 10;
    await game.scene.addEnemyModifier(token, true, true);
  }

  const heldBy = (p: EnemyPokemon): PokemonHeldItemModifier[] =>
    game.scene.findModifiers(
      m => m instanceof PokemonHeldItemModifier && m.pokemonId === p.id,
      false,
    ) as PokemonHeldItemModifier[];

  /**
   * Local fork (2026-11-18): puts the player's top level where the follow factor is 1, 1.0636 x the expected level C
   * of WAVE. Enemy levels follow the player both ways from wave 1000 (endless-level-scaling.ts, "초보에게는 조금더
   * 낮고, 고수에게는 좀더 높은 레벨의 상대가 나오도록"), and the starter Feebas at its starting level would get the 0.8
   * floor; option 다 (f = max(0.8, 0.9637 x (P / C) ^ 0.6)) gives 0.9637 at C and 1 at 1.0636 x C
   * (`ENDLESS_PLAYER_LEVEL_FOLLOW_NEUTRAL_RATIO`; a whole level there moves no rounded enemy level), so the parties come
   * out on the normal level curve, as before (the 3차 rule gave f = 1 for any player up to C)
   */
  function standAtExpectedLevel(): void {
    game.scene.getPlayerParty()[0].level = Math.round(
      getNaturalMaxExpLevel(game.scene.gameMode, WAVE) * ENDLESS_PLAYER_LEVEL_FOLLOW_NEUTRAL_RATIO,
    );
  }

  /** Builds `type`'s battle on WAVE as `BattleScene.newBattle` + `EncounterPhase` do, items included */
  async function buildParty(cand: Candidate, seed: string): Promise<PartyRecord> {
    const { scene } = game;
    const config = trainerConfigs[cand.type];
    scene.clearEnemyHeldItemModifiers();
    standAtExpectedLevel(); // Local fork (2026-11-18)
    scene.setSeed(seed);
    scene.resetSeed(WAVE);
    const t0 = performance.now();
    const trainer = new Trainer(cand.type, TrainerVariant.DEFAULT);
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
    const t1 = performance.now();
    regenerateModifierPoolThresholds(scene.getEnemyField(), ModifierPoolType.TRAINER);
    await scene.generateEnemyModifiers();
    const t2 = performance.now();
    const members = battle.enemyParty.map((p, i) => summarizeMember(p, i, heldBy(p)));
    const record: PartyRecord = {
      trainer: TrainerType[cand.type],
      group: cand.group,
      seed,
      isBoss: config.isBoss,
      moneyMultiplier: config.moneyMultiplier,
      battleBgm: config.battleBgm,
      partySize: battle.enemyParty.length,
      msParty: Math.round(t2 - t0),
      msMembers: Math.round(t1 - t0),
      msItems: Math.round(t2 - t1),
      members,
    };
    for (const p of battle.enemyParty) {
      p.destroy();
    }
    trainer.destroy();
    scene.clearEnemyHeldItemModifiers();
    return record;
  }

  /** The wild End boss wave 5850 has today, built as `EncounterPhase` builds a wild wave (items included) */
  async function buildWildBoss(seed: string): Promise<PartyRecord> {
    const { scene } = game;
    scene.clearEnemyHeldItemModifiers();
    standAtExpectedLevel(); // Local fork (2026-11-18)
    scene.setSeed(seed);
    scene.resetSeed(WAVE);
    const t0 = performance.now();
    const battle = new Battle(scene.gameMode, { waveIndex: WAVE, battleType: BattleType.WILD, double: false });
    scene.currentBattle = battle;
    const level = battle.enemyLevels?.[0] ?? 1;
    const species = scene.randomSpecies(WAVE, level, true);
    const boss = !!scene.getEncounterBossSegments(WAVE, level, species);
    battle.enemyParty[0] = scene.addEnemyPokemon(species, level, TrainerSlot.NONE, boss, true);
    rollWildBattleForm(battle.enemyParty[0]);
    const t1 = performance.now();
    regenerateModifierPoolThresholds(scene.getEnemyField(), ModifierPoolType.WILD);
    await scene.generateEnemyModifiers();
    const t2 = performance.now();
    const members = battle.enemyParty.map((p, i) => summarizeMember(p, i, heldBy(p)));
    const record: PartyRecord = {
      trainer: "WILD_END_BOSS",
      group: "wild (today)",
      seed,
      isBoss: true,
      moneyMultiplier: 0,
      battleBgm: battle.getBgmOverride() ?? scene.arena.bgm,
      partySize: 1,
      msParty: Math.round(t2 - t0),
      msMembers: Math.round(t1 - t0),
      msItems: Math.round(t2 - t1),
      members,
    };
    for (const p of battle.enemyParty) {
      p.destroy();
    }
    scene.clearEnemyHeldItemModifiers();
    return record;
  }

  // Local fork (2026-11-13): 10 명세 2번, the segment rule as the report reads it, checked on its own (it used to sit at
  // the end of the 30-minute build test below, so a change of the rule only showed after the whole build)
  it("hitsToKo reads the game's segment rule (overflow log base 2.4)", () => {
    expect([
      hitsToKo(0, 1),
      hitsToKo(2, 1),
      hitsToKo(2, 1.5),
      hitsToKo(2, 1.7),
      hitsToKo(26, 1),
      hitsToKo(26, 10),
    ]).toEqual([1, 2, 2, 1, 7, 4]);
  });

  it(`builds every candidate's party at wave ${WAVE} (${SEEDS.length} seeds) and ranks them`, async () => {
    game.override.disableTrainerWaves();
    await startRun(WAVE);
    if (WITH_FUSION_TOKEN) {
      await addCappedFusionToken();
    }
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(game.scene.arena.biomeId).toBe(BiomeId.END);
    expect(game.scene.gameMode.isEndless).toBe(true);

    const records: PartyRecord[] = [];
    const failures: string[] = [];
    for (const cand of CANDIDATES) {
      for (const seed of SEEDS) {
        try {
          records.push(await buildParty(cand, seed));
        } catch (e) {
          failures.push(`${TrainerType[cand.type]} ${seed}: ${(e as Error).stack ?? e}`);
        }
      }
    }

    // Today's wave 5850: a wild End boss (Paradox pool), for comparison
    for (const seed of SEEDS) {
      try {
        records.push(await buildWildBoss(seed));
      } catch (e) {
        failures.push(`WILD_END_BOSS ${seed}: ${(e as Error).stack ?? e}`);
      }
    }

    const rows: { name: string; group: string }[] = [
      ...CANDIDATES.map(c => ({ name: TrainerType[c.type], group: c.group })),
      { name: "WILD_END_BOSS", group: "wild (today)" },
    ];
    const ranking = rows
      .map(({ name, group }) => {
        const own = records.filter(r => r.trainer === name);
        const avg = (f: (r: PartyRecord) => number) =>
          own.length === 0 ? 0 : own.reduce((a, r) => a + f(r), 0) / own.length;
        return {
          trainer: name,
          group,
          score: Math.round(avg(r => partyScore(r.members)) * 100) / 100,
          power: Math.round(avg(r => partyScore(r.members, 0)) * 100) / 100,
          hits1x: Math.round(avg(r => r.members.reduce((a, m) => a + hitsToKo(m.bossSegments, 1), 0)) * 100) / 100,
          hits10x: Math.round(avg(r => r.members.reduce((a, m) => a + hitsToKo(m.bossSegments, 10), 0)) * 100) / 100,
          rawBst: Math.round(avg(r => r.members.reduce((a, m) => a + m.rawBst, 0))),
          statSumM: Math.round(avg(r => r.members.reduce((a, m) => a + m.statSum, 0)) / 1e4) / 100,
          legends: Math.round(avg(r => r.members.filter(m => m.legend.length > 0).length) * 100) / 100,
          forms: Math.round(avg(r => r.members.filter(m => m.battleForm != null).length) * 100) / 100,
          fusions: Math.round(avg(r => r.members.filter(m => m.fusion != null).length) * 100) / 100,
          bars: Math.round(avg(r => r.members.reduce((a, m) => a + Math.max(1, m.bossSegments), 0)) * 100) / 100,
          passives: Math.round(avg(r => r.members.filter(m => m.passive).length) * 100) / 100,
          fork: Math.round(avg(r => r.members.reduce((a, m) => a + m.items.fork.length, 0)) * 100) / 100,
          msParty: Math.round(avg(r => r.msParty)),
        };
      })
      .sort((a, b) => b.score - a.score);

    for (const r of ranking) {
      observe("rank", r);
    }
    for (const f of failures) {
      observe("FAILED", f);
    }
    const out = process.env.FORK_SIM_OUT;
    if (out) {
      fs.writeFileSync(
        out,
        JSON.stringify({ wave: WAVE, seeds: SEEDS, fusionToken: WITH_FUSION_TOKEN, ranking, records }, null, 1),
      );
      observe("wrote", out);
    }
    const times = records.map(r => r.msParty).sort((a, b) => a - b);
    observe("time ms (min / median / max)", [times[0], times[Math.floor(times.length / 2)], times.at(-1)]);
    expect(failures).toEqual([]);
    expect(records.length).toBe((CANDIDATES.length + 1) * SEEDS.length);
  }, 1_800_000);

  it("the real path (newBattle + EncounterPhase) builds the same kind of party at wave 5850, and how long it takes", async () => {
    // A real Endless trainer battle on wave 5850, forced through the battle type / trainer overrides
    const timings: Record<string, number> = { members: 0, items: 0 };
    const genMember = Trainer.prototype.genPartyMember;
    vi.spyOn(Trainer.prototype, "genPartyMember").mockImplementation(function (this: Trainer, index: number) {
      const t = performance.now();
      const ret = genMember.call(this, index);
      timings.members += performance.now() - t;
      return ret;
    });
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.CYNTHIA, trainerVariant: TrainerVariant.DEFAULT });
    game.override.startingWave(WAVE);
    await game.runToTitle();
    const genItems = game.scene.generateEnemyModifiers.bind(game.scene);
    vi.spyOn(game.scene, "generateEnemyModifiers").mockImplementation(configs => {
      const t = performance.now();
      const ret = genItems(configs);
      timings.items += performance.now() - t;
      return ret;
    });
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.ENDLESS);
      game.scene.offsetGym = false;
      const starters = generateStarters(game.scene, [SpeciesId.FEEBAS]);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await game.phaseInterceptor.to("CommandPhase", false);

    const battle = game.scene.currentBattle;
    expect(battle.waveIndex).toBe(WAVE);
    expect(battle.battleType).toBe(BattleType.TRAINER);
    expect(battle.trainer?.config.trainerType).toBe(TrainerType.CYNTHIA);
    expect(game.scene.arena.biomeId).toBe(BiomeId.END);
    const members = battle.enemyParty.map((p, i) => summarizeMember(p, i, heldBy(p)));
    observe("real-path CYNTHIA", {
      double: battle.double,
      biomeBgm: game.scene.arena.bgm,
      battleBgm: battle.getBgmOverride(),
      timingsMs: { members: Math.round(timings.members), items: Math.round(timings.items) },
      members: members.map(m => ({
        species: m.species,
        formKey: m.formKey,
        fusion: m.fusion,
        level: m.level,
        bars: m.bossSegments,
        rawBst: m.rawBst,
        vitaminMult: m.vitaminMult,
        stacks: m.items.stacks,
        fork: m.items.fork,
        battleItems: m.items.battleItems,
      })),
    });
    expect(members).toHaveLength(6);
    // Cynthia's fixed fusion past wave 200
    expect(members.some(m => m.species === "GARCHOMP" && m.fusion?.species === "GARCHOMP")).toBe(true);
    // Every member's vitamins at the cap (IV 31 from wave 310: x4.1). Local fork (2026-11-13): HP vitamins gave 15% a
    // stack for a while (x5.65 at 31, a six-stat average of about 4.36); 10% again since the 09 patch, x4.1 for all six
    expect(members.every(m => m.vitaminMult > 4)).toBe(true);
    // Stat check of one member against the six base stats
    expect(members[0].stats[Stat.HP]).toBeGreaterThan(0);
  }, 300_000);
});
