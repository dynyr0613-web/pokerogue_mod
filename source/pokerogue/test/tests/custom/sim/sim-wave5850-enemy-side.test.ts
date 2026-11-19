// Local fork (2026-11-13) — simulation harness, skipped by the normal suite (run with FORK_SIM=1).
// The enemy's side at Endless wave 5850 (the last Endless wave, battle-end-phase.ts): the enemy buff tokens the run has
// collected through wave 5800 (AddEnemyBuffModifierPhase after every 50-wave victory), the levels and boss bars there,
// the wild 5850 boss as the game rolls it today, and what the tokens do to one hit each way. For the user's plan
// ("5850웨이브에 트레이너를 등장시키는, 엘리트 트레이너 중에서도 가장 강한 몇만 엄선해서 등장시키는 특수 규칙을 만들도록 하죠,
// 기존 패러독스 보스는 5850에서 나오기엔 좀 약해서") and the ace experiment that follows it.
//
// - Tokens, real code: `regenerateModifierPoolThresholds(ENEMY_BUFF)` + `getEnemyBuffModifierForWave` +
//   `BattleScene.addEnemyModifier`, in AddEnemyBuffModifierPhase's order, wave 50..LAST_TOKEN_WAVE.
// - Tokens, script port: the same rules (pool weights, the 49 retries, the caps, the stack per draw, a draw lost when
//   its stack does not fit) in plain JS, many more runs; the test prints both side by side.
// - Levels / bars: `BattleScene.getMaxExpLevel`, `Battle.getLevelForWave` (new Battle), `Trainer.getPartyLevels` (via
//   new Battle), `BattleScene.getEncounterBossSegments`. Local fork (2026-11-18): the cap is read as
//   `BattleScene.getWaveLevelCap` (the enforced cap is lifted from wave 1000), and the player stands at 1.0636 x that
//   level so the two-sided level follow (endless-level-scaling.ts, option 다: f = max(0.8, 0.9637 x (P / C) ^ 0.6), 1 at
//   1.0636 x C) leaves the enemy levels on the normal curve (f = 1).
// - The wild 5850 boss: a real Endless run started on wave 5850 in the END biome, up to the first command.
// - One hit: `Pokemon.getAttackDamage` (simulated) with and without the tokens.
//
// Env: FORK_SIM=1 to run; FORK_SIM_OUT=<file.json> to write the raw numbers; FORK_SIM_REAL_RUNS (default 300);
// FORK_SIM_PORT_RUNS (default 100000); FORK_SIM_WILD_SEEDS=a,b,c (default 4 seeds).
import { Battle } from "#app/battle";
import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
// Local fork (2026-11-18): 1.0636 x the wave's expected level C, so the two-sided level follow gives f = 1 in the level
// table
import { ENDLESS_PLAYER_LEVEL_FOLLOW_NEUTRAL_RATIO, getNaturalMaxExpLevel } from "#balance/endless-level-scaling";
import { allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { UiMode } from "#enums/ui-mode";
import type { EnemyPokemon, PlayerPokemon } from "#field/pokemon";
import { Trainer } from "#field/trainer";
import {
  EnemyDamageBoosterModifier,
  EnemyDamageReducerModifier,
  EnemyPersistentModifier,
  type PersistentModifier,
  PiercingTokenModifier,
} from "#modifiers/modifier";
import { getEnemyBuffModifierForWave, regenerateModifierPoolThresholds } from "#modifiers/modifier-type";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import { BOSS_SEGMENT_OVERFLOW, calculateBossSegmentDamage } from "#utils/damage";
import fs from "node:fs";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const WAVE = 5850;
/** The 5850 battle is fought with the tokens of the victories through wave 5800 */
const LAST_TOKEN_WAVE = 5800;
const REAL_RUNS = Number(process.env.FORK_SIM_REAL_RUNS ?? 300);
const PORT_RUNS = Number(process.env.FORK_SIM_PORT_RUNS ?? 100_000);
const WILD_SEEDS = (process.env.FORK_SIM_WILD_SEEDS ?? "w5850-a,w5850-b,w5850-c,w5850-d")
  .split(",")
  .filter(s => s.length > 0);
/** Waves at which the token state is also reported (after that wave's draws) */
const SNAPSHOT_WAVES = [1000, 2000, 3000, 4000, 5000, LAST_TOKEN_WAVE] as const;

/** Every enemy buff token id, in the order of the report */
const TOKEN_IDS = [
  "ENEMY_DAMAGE_BOOSTER",
  "ENEMY_DAMAGE_REDUCTION",
  "ENEMY_HEAL",
  "ENEMY_STATUS_EFFECT_HEAL_CHANCE",
  "ENEMY_ENDURE_CHANCE",
  "ENEMY_ATTACK_POISON_CHANCE",
  "ENEMY_ATTACK_PARALYZE_CHANCE",
  "ENEMY_ATTACK_BURN_CHANCE",
  "ENEMY_FUSED_CHANCE",
] as const;
type TokenId = (typeof TOKEN_IDS)[number];
type TokenCounts = Record<TokenId, number>;

const out: Record<string, unknown> = {};

/** Writes a line to the real stdout (console.log is muted while the game generates) */
function print(line = ""): void {
  process.stdout.write(`${line}\n`);
}

// #region Token script port

/**
 * The enemy buff pool (init-modifier-pools.ts `initEnemyBuffModifierPool`): weights in the COMMON / GREAT / ULTRA tier,
 * and the cap (`getMaxStackCount`, modifier.ts) at battle wave `w`
 */
const PORT_SPECS: readonly { id: TokenId; weights: readonly [number, number, number]; cap: (w: number) => number }[] = [
  { id: "ENEMY_DAMAGE_BOOSTER", weights: [9, 5, 10], cap: () => 999 },
  { id: "ENEMY_DAMAGE_REDUCTION", weights: [9, 5, 10], cap: w => (w < 2000 ? 99 : 999) },
  { id: "ENEMY_ATTACK_POISON_CHANCE", weights: [3, 0, 0], cap: () => 10 },
  { id: "ENEMY_ATTACK_PARALYZE_CHANCE", weights: [3, 0, 0], cap: () => 10 },
  { id: "ENEMY_ATTACK_BURN_CHANCE", weights: [3, 0, 0], cap: () => 10 },
  { id: "ENEMY_STATUS_EFFECT_HEAL_CHANCE", weights: [9, 5, 10], cap: () => 10 },
  { id: "ENEMY_ENDURE_CHANCE", weights: [4, 5, 10], cap: () => 10 },
  { id: "ENEMY_FUSED_CHANCE", weights: [1, 1, 5], cap: () => 10 },
  { id: "ENEMY_HEAL", weights: [0, 0, 10], cap: () => 10 },
];

/** A small seeded PRNG (mulberry32) for the port */
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

interface PortRun {
  snapshots: Map<number, number[]>;
  lostDraws: number;
  /** The first wave at which a tier had no weight left at all (the real code then throws), else 0 */
  emptyPoolWave: number;
  /** The first wave after whose draws each token (PORT_SPECS order) is at its cap of `lastWave`, else 0 */
  capWave: number[];
}

/**
 * One run of the port: wave 50..lastWave, AddEnemyBuffModifierPhase's draws (getEnemyBuffModifierForWave)
 * @returns the stacks per PORT_SPECS index (-1 = never drawn) at the snapshot waves
 */
function portRun(rand: () => number, lastWave: number, snapshotWaves: readonly number[]): PortRun {
  const stacks = PORT_SPECS.map(() => -1);
  const capWave = PORT_SPECS.map(() => 0);
  const snapshots = new Map<number, number[]>();
  let lostDraws = 0;
  let emptyPoolWave = 0;
  for (let w = 50; w <= lastWave; w += 50) {
    const tierIdx = w % 1000 ? (w % 250 ? 0 : 1) : 2;
    const tierStack = [1, 3, 5][tierIdx];
    // regenerateModifierPoolThresholds: weight 0 for a token whose stack is at its cap when the wave starts
    let weights = PORT_SPECS.map((s, i) => (stacks[i] < 0 || stacks[i] < s.cap(w) ? s.weights[tierIdx] : 0));
    let total = weights.reduce((a, b) => a + b, 0);
    // getNewModifierTypeOption: an empty tier falls one tier down (never below COMMON)
    let usedTier = tierIdx;
    while (total === 0 && usedTier > 0) {
      usedTier--;
      weights = PORT_SPECS.map((s, i) => (stacks[i] < 0 || stacks[i] < s.cap(w) ? s.weights[usedTier] : 0));
      total = weights.reduce((a, b) => a + b, 0);
    }
    if (total === 0) {
      emptyPoolWave ||= w;
      continue;
    }
    const draw = (): number => {
      let v = Math.floor(rand() * total);
      for (let i = 0; i < weights.length; i++) {
        if (v < weights[i]) {
          return i;
        }
        v -= weights[i];
      }
      return weights.length - 1;
    };
    const count = Math.ceil(w / 250);
    for (let c = 0; c < count; c++) {
      let cand = draw();
      let r = 0;
      while (++r < 50) {
        const s = stacks[cand];
        if (s < 0) {
          break;
        }
        const need = r < 10 ? tierStack : 1;
        if (!(PORT_SPECS[cand].cap(w) < s + need)) {
          break;
        }
        cand = draw();
      }
      // modifier.stackCount = tierStackCount; PersistentModifier.add -> incrementStack (all or nothing)
      if (stacks[cand] < 0) {
        stacks[cand] = tierStack;
      } else if (stacks[cand] + tierStack <= PORT_SPECS[cand].cap(w)) {
        stacks[cand] += tierStack;
      } else {
        lostDraws++;
      }
    }
    for (let i = 0; i < stacks.length; i++) {
      if (!capWave[i] && stacks[i] >= PORT_SPECS[i].cap(lastWave)) {
        capWave[i] = w;
      }
    }
    if (snapshotWaves.includes(w)) {
      snapshots.set(
        w,
        stacks.map(s => Math.max(0, s)),
      );
    }
  }
  return { snapshots, lostDraws, emptyPoolWave, capWave };
}

// #endregion Token script port

// #region Stats helpers

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) {
    return Number.NaN;
  }
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1) + 0.5)));
  return sorted[idx];
}

interface Summary {
  mean: number;
  sd: number;
  p10: number;
  p50: number;
  p90: number;
  min: number;
  max: number;
  atCap: number;
}

function summarize(values: number[], cap: number): Summary {
  const sorted = [...values].sort((a, b) => a - b);
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  return {
    mean,
    sd,
    p10: quantile(sorted, 0.1),
    p50: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    min: sorted[0],
    max: sorted[n - 1],
    atCap: values.filter(v => v >= cap).length / n,
  };
}

const fmt = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : String(v));

// #endregion Stats helpers

describe.skipIf(!process.env.FORK_SIM)("Sim - the enemy's side at Endless wave 5850", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  const savedLog = console.log;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .hasPassiveAbility(false)
      .moveset([MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.SPLASH])
      .mysteryEncounterChance(0)
      .forkContentUnlocked(true);
  });

  afterEach(() => {
    console.log = savedLog;
    vi.restoreAllMocks();
    if (process.env.FORK_SIM_OUT) {
      fs.writeFileSync(process.env.FORK_SIM_OUT, JSON.stringify(out, null, 1));
    }
  });

  /** Starts an Endless run on `wave` in `biome` the way the title screen would, and plays to the first command */
  async function startRun(
    wave: number,
    biome: BiomeId,
    starter: SpeciesId,
    level: number,
    seed?: string,
  ): Promise<void> {
    game.override.startingWave(wave).startingLevel(level);
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.ENDLESS);
      game.scene.offsetGym = false;
      game.scene.newArena(biome);
      const starters = generateStarters(game.scene, [starter]);
      // generateStarters sets the seed to "test" (game-manager-utils.ts), so a run's own seed goes in after it
      if (seed) {
        game.scene.setSeed(seed);
      }
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    await game.phaseInterceptor.to("CommandPhase", false);
  }

  const mute = () => {
    console.log = () => {};
  };

  /** The scene's enemy modifier list (private in BattleScene) */
  const enemyModifierList = (): PersistentModifier[] =>
    (game.scene as unknown as { enemyModifiers: PersistentModifier[] }).enemyModifiers;

  function removeEnemyTokens(): void {
    const list = enemyModifierList();
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i] instanceof EnemyPersistentModifier) {
        list.splice(i, 1);
      }
    }
  }

  function readTokens(): TokenCounts {
    const counts = Object.fromEntries(TOKEN_IDS.map(id => [id, 0])) as TokenCounts;
    for (const m of game.scene.findModifiers(m => m instanceof EnemyPersistentModifier, false)) {
      const id = m.type.id as TokenId;
      if (id in counts) {
        counts[id] += m.getStackCount();
      }
    }
    return counts;
  }

  /**
   * One run of the real token code: AddEnemyBuffModifierPhase.start for every 50-wave victory 50..lastWave
   * @returns the token stacks after each snapshot wave
   */
  function realTokenRun(seed: string, lastWave: number): Map<number, TokenCounts> {
    const { scene } = game;
    const battle = scene.currentBattle;
    const keepWave = battle.waveIndex;
    removeEnemyTokens();
    Phaser.Math.RND.sow([seed]);
    const snapshots = new Map<number, TokenCounts>();
    for (let w = 50; w <= lastWave; w += 50) {
      battle.waveIndex = w;
      const tier = w % 1000 ? (w % 250 ? ModifierTier.COMMON : ModifierTier.GREAT) : ModifierTier.ULTRA;
      regenerateModifierPoolThresholds(scene.getEnemyParty(), ModifierPoolType.ENEMY_BUFF);
      const count = Math.ceil(w / 250);
      for (let i = 0; i < count; i++) {
        // addEnemyModifier does its work synchronously inside the Promise executor (AddEnemyBuffModifierPhase does not
        // wait for it either)
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
      if ((SNAPSHOT_WAVES as readonly number[]).includes(w)) {
        snapshots.set(w, readTokens());
      }
    }
    battle.waveIndex = keepWave;
    return snapshots;
  }

  const TOKEN_CAP_AT_5850: TokenCounts = {
    ENEMY_DAMAGE_BOOSTER: 999,
    ENEMY_DAMAGE_REDUCTION: 999,
    ENEMY_HEAL: 10,
    ENEMY_STATUS_EFFECT_HEAL_CHANCE: 10,
    ENEMY_ENDURE_CHANCE: 10,
    ENEMY_ATTACK_POISON_CHANCE: 10,
    ENEMY_ATTACK_PARALYZE_CHANCE: 10,
    ENEMY_ATTACK_BURN_CHANCE: 10,
    ENEMY_FUSED_CHANCE: 10,
  };

  it("collects the enemy buff tokens through wave 5800: real code vs the script port", async () => {
    game.override.disableTrainerWaves();
    await startRun(WAVE, BiomeId.END, SpeciesId.GARCHOMP, 100);
    mute();

    // Real code
    const t0 = Date.now();
    const real: TokenCounts[] = [];
    const realSnap = new Map<number, TokenCounts[]>();
    for (let run = 0; run < REAL_RUNS; run++) {
      const snaps = realTokenRun(`tok-${run}`, LAST_TOKEN_WAVE);
      for (const [w, c] of snaps) {
        realSnap.set(w, [...(realSnap.get(w) ?? []), c]);
      }
      real.push(snaps.get(LAST_TOKEN_WAVE)!);
    }
    const realMs = Date.now() - t0;

    // Port
    const t1 = Date.now();
    const rand = mulberry32(5850);
    const port: number[][] = [];
    const portSnap = new Map<number, number[][]>();
    let lost = 0;
    let emptyRuns = 0;
    const emptyWaves: number[] = [];
    const capWaveRuns: number[][] = [];
    for (let run = 0; run < PORT_RUNS; run++) {
      const r = portRun(rand, LAST_TOKEN_WAVE, SNAPSHOT_WAVES);
      lost += r.lostDraws;
      capWaveRuns.push(r.capWave);
      if (r.emptyPoolWave) {
        emptyRuns++;
        emptyWaves.push(r.emptyPoolWave);
      }
      for (const [w, s] of r.snapshots) {
        const list = portSnap.get(w) ?? [];
        list.push(s);
        portSnap.set(w, list);
      }
      port.push(r.snapshots.get(LAST_TOKEN_WAVE)!);
    }
    const portMs = Date.now() - t1;

    const portIndex = (id: TokenId) => PORT_SPECS.findIndex(s => s.id === id);
    const table: Record<string, { real: Summary; port: Summary }> = {};
    print("");
    print(`== Enemy buff tokens after the wave-${LAST_TOKEN_WAVE} victory (what the wave-${WAVE} battle has) ==`);
    print(`real code: ${REAL_RUNS} runs in ${realMs} ms; port: ${PORT_RUNS} runs in ${portMs} ms`);
    print("token | real mean (p10-p50-p90) P(cap) | port mean +-sd (p10-p50-p90) [min..max] P(cap)");
    for (const id of TOKEN_IDS) {
      const cap = TOKEN_CAP_AT_5850[id];
      const rs = summarize(
        real.map(c => c[id]),
        cap,
      );
      const ps = summarize(
        port.map(s => s[portIndex(id)]),
        cap,
      );
      table[id] = { real: rs, port: ps };
      print(
        `${id} | ${fmt(rs.mean)} (${rs.p10}-${rs.p50}-${rs.p90}) ${fmt(rs.atCap * 100, 1)}% | ${fmt(ps.mean)} +-${fmt(ps.sd)} (${ps.p10}-${ps.p50}-${ps.p90}) [${ps.min}..${ps.max}] ${fmt(ps.atCap * 100, 2)}%`,
      );
    }
    print(
      `port: draws lost to a full stack per run ${fmt(lost / PORT_RUNS)}; runs whose pool ran empty by wave ${LAST_TOKEN_WAVE}: ${emptyRuns} (${fmt((emptyRuns / PORT_RUNS) * 100, 3)}%)${emptyWaves.length > 0 ? `, first waves ${emptyWaves.slice(0, 10).join(",")}` : ""}`,
    );
    // Damage / Protection both at 999 -> every token capped -> the real code has no candidate
    const bothCapped = port.filter(
      s => s[portIndex("ENEMY_DAMAGE_BOOSTER")] >= 999 && s[portIndex("ENEMY_DAMAGE_REDUCTION")] >= 999,
    ).length;
    print(
      `port: Damage and Protection both at 999 by wave ${LAST_TOKEN_WAVE}: ${fmt((bothCapped / PORT_RUNS) * 100, 3)}%`,
    );
    // The wave each token reaches its wave-5800 cap (999 for Damage / Protection, 10 for the rest)
    const capWaves: Record<string, Summary> = {};
    for (const id of TOKEN_IDS) {
      const waves = capWaveRuns.map(c => c[portIndex(id)]).filter(w => w > 0);
      const s = summarize(waves, Number.POSITIVE_INFINITY);
      capWaves[id] = s;
      print(
        `port: ${id} reaches ${TOKEN_CAP_AT_5850[id]} by wave ${LAST_TOKEN_WAVE} in ${fmt((waves.length / PORT_RUNS) * 100, 2)}% of runs; first wave mean ${fmt(s.mean, 0)} (p10 ${s.p10}, p50 ${s.p50}, p90 ${s.p90}, min ${s.min}, max ${s.max})`,
      );
    }
    out.capWaves = capWaves;

    print("");
    print("== Snapshots (port mean / real mean): Damage, Protection, Heal, Endure, Fused ==");
    const snapOut: Record<
      number,
      Record<string, { real: number; port: number; portP10: number; portP90: number }>
    > = {};
    for (const w of SNAPSHOT_WAVES) {
      const pl = portSnap.get(w) ?? [];
      const rl = realSnap.get(w) ?? [];
      const row: Record<string, { real: number; port: number; portP10: number; portP90: number }> = {};
      for (const id of TOKEN_IDS) {
        const pv = pl.map(s => s[portIndex(id)]).sort((a, b) => a - b);
        const rv = rl.map(c => c[id]);
        row[id] = {
          real: rv.reduce((a, b) => a + b, 0) / Math.max(1, rv.length),
          port: pv.reduce((a, b) => a + b, 0) / Math.max(1, pv.length),
          portP10: quantile(pv, 0.1),
          portP90: quantile(pv, 0.9),
        };
      }
      snapOut[w] = row;
      const cell = (id: TokenId) =>
        `${fmt(row[id].port, 1)}/${fmt(row[id].real, 1)} (${row[id].portP10}-${row[id].portP90})`;
      print(
        `wave ${w}: dmg ${cell("ENEMY_DAMAGE_BOOSTER")}, prot ${cell("ENEMY_DAMAGE_REDUCTION")}, heal ${cell("ENEMY_HEAL")}, endure ${cell("ENEMY_ENDURE_CHANCE")}, fused ${cell("ENEMY_FUSED_CHANCE")}, cure ${cell("ENEMY_STATUS_EFFECT_HEAL_CHANCE")}, psn ${cell("ENEMY_ATTACK_POISON_CHANCE")}, par ${cell("ENEMY_ATTACK_PARALYZE_CHANCE")}, brn ${cell("ENEMY_ATTACK_BURN_CHANCE")}`,
      );
    }
    out.tokens = { realRuns: REAL_RUNS, portRuns: PORT_RUNS, table, snapshots: snapOut, lostPerRun: lost / PORT_RUNS };

    // The real code with every token at its cap: no candidate is left, so the draw throws (the port's "empty pool")
    removeEnemyTokens();
    game.scene.currentBattle.waveIndex = LAST_TOKEN_WAVE;
    for (const id of TOKEN_IDS) {
      const type = modifierTypes[id]().withIdFromFunc(modifierTypes[id]);
      const token = type.newModifier() as EnemyPersistentModifier;
      await game.scene.addEnemyModifier(token, true, true);
      token.stackCount = TOKEN_CAP_AT_5850[id];
    }
    regenerateModifierPoolThresholds(game.scene.getEnemyParty(), ModifierPoolType.ENEMY_BUFF);
    let threw = "";
    try {
      getEnemyBuffModifierForWave(
        ModifierTier.COMMON,
        game.scene.findModifiers(m => m instanceof EnemyPersistentModifier, false),
      );
    } catch (e) {
      threw = String(e);
    }
    print(`all tokens capped, real getEnemyBuffModifierForWave: ${threw || "no error"}`);
    out.allCappedDraw = threw || "no error";
    game.scene.currentBattle.waveIndex = WAVE;

    // Sanity: the real code and the port agree on the means of the two big tokens (within 5 standard errors)
    for (const id of ["ENEMY_DAMAGE_BOOSTER", "ENEMY_DAMAGE_REDUCTION"] as const) {
      const se = table[id].port.sd / Math.sqrt(REAL_RUNS);
      expect(Math.abs(table[id].real.mean - table[id].port.mean)).toBeLessThan(5 * se + 0.5);
    }
  }, 1_800_000);

  it("reads the levels and boss bars at wave 5850", async () => {
    game.override.disableTrainerWaves();
    // Local fork (2026-11-18): the player stands at 1.0636 x the wave's expected level C (340,577 for C = 320,222), not
    // at level 100. Enemy levels follow the player both ways from wave 1000 ("초보에게는 조금더 낮고, 고수에게는 좀더
    // 높은 레벨의 상대가 나오도록"), and a level-100 party now gets the 0.8 floor; option 다 (f = max(0.8, 0.9637 x
    // (P / C) ^ 0.6)) gives 0.9637 at C and 1 at 1.0636 x C (a whole level there moves no rounded enemy level), so this
    // table is the normal level curve, as it was under the 3차 rule (f = 1 for any P up to C)
    await startRun(
      WAVE,
      BiomeId.END,
      SpeciesId.GARCHOMP,
      Math.round(
        getNaturalMaxExpLevel(getGameMode(GameModes.ENDLESS), WAVE) * ENDLESS_PLAYER_LEVEL_FOLLOW_NEUTRAL_RATIO,
      ),
    );
    mute();
    const { scene } = game;

    // Local fork (2026-11-18): the cap formula C; the enforced cap (getMaxExpLevel) is lifted from Endless wave 1000
    // ("1000웨이브 이후는 레벨캡은 그냥 풉시다") and would print Number.MAX_SAFE_INTEGER
    const maxExpLevel = scene.getWaveLevelCap();
    const enforcedCap = scene.getMaxExpLevel();
    // Wild boss level: many fresh Battles on 5850 (getLevelForWave, random offset)
    const wildLevels: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const b = new Battle(scene.gameMode, { waveIndex: WAVE, battleType: BattleType.WILD, double: false });
      wildLevels.push(b.enemyLevels![0]);
    }
    wildLevels.sort((a, b) => a - b);
    const keepBattle = scene.currentBattle;

    // Trainer party levels (new Battle runs Trainer.getPartyLevels with the Endless fill)
    const trainerLevels: Record<string, { levels: number[]; members: unknown[] }> = {};
    for (const type of [
      TrainerType.ACE_TRAINER,
      TrainerType.CYNTHIA,
      TrainerType.LEON,
      TrainerType.RED,
      TrainerType.VOLO,
      TrainerType.CLAIR,
    ]) {
      scene.setSeed(`lv-${type}`);
      scene.resetSeed(WAVE);
      const trainer = new Trainer(type, TrainerVariant.DEFAULT);
      const battle = new Battle(scene.gameMode, {
        waveIndex: WAVE,
        battleType: BattleType.TRAINER,
        trainer,
        double: trainer.isDouble(),
      });
      scene.currentBattle = battle;
      const levels = [...(battle.enemyLevels ?? [])];
      const members: unknown[] = [];
      for (let e = 0; e < levels.length; e++) {
        const p = trainer.genPartyMember(e);
        battle.enemyParty[e] = p;
        members.push({
          species: SpeciesId[p.species.speciesId],
          level: p.level,
          bossSegments: p.bossSegments,
          maxHp: p.getMaxHp(),
        });
      }
      trainerLevels[TrainerType[type]] = { levels, members };
      for (const p of battle.enemyParty) {
        p?.destroy();
      }
      trainer.destroy();
    }
    scene.currentBattle = keepBattle;

    // Boss bars: getEncounterBossSegments for the END pool and a 670+ species
    const segs: Record<string, number> = {};
    for (const id of [
      SpeciesId.GREAT_TUSK,
      SpeciesId.ROARING_MOON,
      SpeciesId.IRON_CROWN,
      SpeciesId.ETERNATUS,
      SpeciesId.ARCEUS,
      SpeciesId.GARCHOMP,
    ]) {
      const sp = speciesDataRegistry.getSpecies(id);
      segs[`${SpeciesId[id]} (BST ${sp.baseTotal})`] = scene.getEncounterBossSegments(WAVE, 69_218, sp);
    }
    segs["forceBoss, no species (setBoss default)"] = scene.getEncounterBossSegments(WAVE, 69_218, undefined, true);

    print("");
    print(`== Levels and bars at wave ${WAVE} ==`);
    print(
      `player level cap formula getWaveLevelCap (C): ${maxExpLevel}; enforced getMaxExpLevel: ${enforcedCap >= Number.MAX_SAFE_INTEGER ? "none (lifted from wave 1000)" : enforcedCap}; player level ${scene.getPlayerParty()[0].level}`,
    );
    print(
      `wild boss level (2000 Battles): min ${wildLevels[0]} p10 ${quantile(wildLevels, 0.1)} median ${quantile(wildLevels, 0.5)} p90 ${quantile(wildLevels, 0.9)} max ${wildLevels.at(-1)}`,
    );
    for (const [name, v] of Object.entries(trainerLevels)) {
      print(`${name}: levels ${v.levels.join(", ")}`);
      print(`   ${JSON.stringify(v.members)}`);
    }
    print(`boss bars: ${JSON.stringify(segs)}`);
    out.levels = {
      maxExpLevel,
      wild: { min: wildLevels[0], p50: quantile(wildLevels, 0.5), max: wildLevels.at(-1) },
      trainerLevels,
      segs,
    };
    expect(maxExpLevel).toBeGreaterThan(0);
  }, 600_000);

  /**
   * Turns to knock out one enemy of `bars` boss bars (0 = no bars) that takes `dealtFrac` of its max HP per hit after
   * the tokens, `hitsPerTurn` hits a turn, and heals `healFrac` of its max HP at every turn end (Heal Token 20%,
   * + Leftovers): `calculateBossSegmentDamage` (utils/damage.ts) and EnemyPokemon.damage's bar bookkeeping; no Endure
   * Token / Focus Band
   * @returns the turns, or Infinity past 300
   */
  function turnsToKo(bars: number, dealtFrac: number, healFrac: number, hitsPerTurn = 1): number {
    const maxHp = 1_000_000;
    const dealt = Math.max(1, Math.floor(dealtFrac * maxHp));
    let hp = maxHp;
    let index = bars > 0 ? bars - 1 : 0;
    const segHp = bars > 0 ? maxHp / bars : maxHp;
    for (let turn = 1; turn <= 300; turn++) {
      for (let h = 0; h < hitsPerTurn; h++) {
        let damage = dealt;
        let cleared = index + 1;
        if (bars > 0) {
          [damage, cleared] = calculateBossSegmentDamage(dealt, hp, segHp, 0, index);
        }
        damage = Math.min(damage, hp);
        hp -= damage;
        if (hp <= 0) {
          return turn;
        }
        if (bars > 0 && cleared <= index) {
          index = Math.max(0, cleared - 1);
        }
      }
      hp = Math.min(maxHp, hp + Math.floor(healFrac * maxHp));
    }
    return Number.POSITIVE_INFINITY;
  }

  it("works out the turns to a knockout through the boss bars and the Heal Token", () => {
    const fracs = [0.05, 0.1, 0.2, 0.21, 0.25, 0.3, 0.4, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10, 20, 50, 100];
    const rows: Record<string, Record<string, number>> = {};
    print("");
    print("== Turns to KO (one hit a turn; dealt = fraction of max HP after the tokens) ==");
    print(`dealt/maxHp: ${fracs.join(" | ")}`);
    for (const [label, bars, heal] of [
      ["wild 26 bars, Heal Token 20%", 26, 0.2],
      ["wild 26 bars, no heal", 26, 0],
      ["trainer ace 2 bars, Heal Token 20%", 2, 0.2],
      ["trainer ace 2 bars, Heal 20% + Leftovers x4 (45%)", 2, 0.45],
      ["trainer member no bars, Heal 20%", 0, 0.2],
      ["trainer member no bars, Heal 20% + Leftovers x4", 0, 0.45],
    ] as const) {
      const row: Record<string, number> = {};
      for (const f of fracs) {
        row[String(f)] = turnsToKo(bars, f, heal);
      }
      rows[label] = row;
      print(`${label}: ${fracs.map(f => row[String(f)]).join(" | ")}`);
    }
    // Segments one hit breaks from full HP (26 bars), by dealt / segment HP.
    // Local fork (2026-11-13): 10 명세 2번, probed just under and just over each k-bar step, 1 + base^(k-1) bars' worth
    // (the full bar + the overflow; base = BOSS_SEGMENT_OVERFLOW.logBase, 2.4 since the 4th balance patch: 3.4 / 6.76 /
    // 14.82 / 34.18 / 80.63 / 192.1 / 459.6, where base 2 gave 3 / 5 / 9 / 17 / 33 / 65 / 129)
    const steps = Array.from({ length: 7 }, (_, i) => 1 + BOSS_SEGMENT_OVERFLOW.logBase ** (i + 1));
    const probes = [
      0.99,
      1,
      ...steps.flatMap(t => [Math.floor(t * 100) / 100 - 0.01, Math.ceil(t * 100) / 100 + 0.01]),
    ];
    const segRows: string[] = [];
    for (const mult of probes) {
      const segHp = 1_000_000 / 26;
      const [dmg, cleared] = calculateBossSegmentDamage(Math.floor(mult * segHp), 1_000_000, segHp, 0, 25);
      segRows.push(
        `${fmt(mult)} seg -> breaks ${Math.max(0, 25 - cleared + 1)} (takes ${fmt((dmg / segHp) * 100, 0)}% of a seg)`,
      );
    }
    print(`one hit from full HP, 26 bars: ${segRows.join("; ")}`);
    out.turnsToKo = rows;
    expect(turnsToKo(0, 1, 0.2)).toBe(1);
  });

  /** One enemy, as the report lists it */
  function describeEnemy(p: EnemyPokemon) {
    const items: Record<string, number> = {};
    for (const m of p.getHeldItems()) {
      items[m.type.id] = (items[m.type.id] ?? 0) + m.getStackCount();
    }
    return {
      species: SpeciesId[p.species.speciesId],
      fusion: p.fusionSpecies ? SpeciesId[p.fusionSpecies.speciesId] : null,
      form: p.getFormKey(),
      level: p.level,
      bossSegments: p.bossSegments,
      maxHp: p.getMaxHp(),
      stats: [...p.stats],
      ability: p.getAbility().name,
      passive: p.hasPassive() ? p.getPassiveAbility().name : null,
      moves: p.getMoveset().map(m => m.getName()),
      items,
    };
  }

  /** The hit `source` -> `target` with `move` (simulated, no crit, no random spread) */
  const hit = (source: PlayerPokemon | EnemyPokemon, target: PlayerPokemon | EnemyPokemon, moveId: MoveId) =>
    target.getAttackDamage({ source, move: allMoves[moveId], simulated: true }).damage;

  async function setEnemyToken(id: "ENEMY_DAMAGE_BOOSTER" | "ENEMY_DAMAGE_REDUCTION", stacks: number): Promise<void> {
    const list = enemyModifierList();
    for (let i = list.length - 1; i >= 0; i--) {
      if (
        (id === "ENEMY_DAMAGE_BOOSTER" && list[i] instanceof EnemyDamageBoosterModifier)
        || (id === "ENEMY_DAMAGE_REDUCTION" && list[i] instanceof EnemyDamageReducerModifier)
      ) {
        list.splice(i, 1);
      }
    }
    if (stacks > 0) {
      const token = modifierTypes[id]().withIdFromFunc(modifierTypes[id]).newModifier() as EnemyPersistentModifier;
      await game.scene.addEnemyModifier(token, true, true);
      token.stackCount = stacks;
    }
  }

  function setPiercing(stacks: number): void {
    const held = game.scene.findModifier(m => m instanceof PiercingTokenModifier, true);
    if (held) {
      game.scene.removeModifier(held);
    }
    if (stacks > 0) {
      const token = modifierTypes
        .PIERCING_TOKEN()
        .withIdFromFunc(modifierTypes.PIERCING_TOKEN)
        .newModifier() as PiercingTokenModifier;
      token.stackCount = stacks;
      game.scene.addModifier(token, true);
    }
  }

  it.each(WILD_SEEDS)(
    "rolls the wild wave-5850 boss in the END biome (seed %s) and its hits with tokens",
    async seed => {
      game.override.disableTrainerWaves();
      // The player: a level-cap Garchomp without items (a reference point, not an ace)
      // Local fork (2026-11-13): 69,222 -> 320,222, the cap with 08 명세 4번's S(5850) = 251,000 (endless-level-scaling.ts)
      await startRun(WAVE, BiomeId.END, SpeciesId.GARCHOMP, 320_222, seed);
      mute();
      const { scene } = game;
      expect(scene.currentBattle.waveIndex).toBe(WAVE);
      expect(scene.currentBattle.battleType).toBe(BattleType.WILD);
      const enemy = game.field.getEnemyPokemon();
      const player = game.field.getPlayerPokemon();
      const info = describeEnemy(enemy);

      // Player -> enemy, Earthquake / Dragon Claw, no tokens, then Protection n with 0 / 10 Piercing Tokens
      const rows: Record<string, unknown>[] = [];
      for (const moveId of [MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW, MoveId.SEISMIC_TOSS]) {
        const row: Record<string, unknown> = { move: MoveId[moveId] };
        for (const [prot, pierce] of [
          [0, 0],
          [99, 0],
          [500, 0],
          [990, 0],
          [999, 0],
          [990, 10],
          [999, 10],
        ] as const) {
          await setEnemyToken("ENEMY_DAMAGE_REDUCTION", prot);
          setPiercing(pierce);
          const d = hit(player, enemy, moveId);
          row[`prot${prot}/pierce${pierce}`] = d;
          row[`prot${prot}/pierce${pierce} %maxHp`] = Number(((d / enemy.getMaxHp()) * 100).toPrecision(4));
        }
        rows.push(row);
      }
      await setEnemyToken("ENEMY_DAMAGE_REDUCTION", 0);
      setPiercing(0);

      // Enemy -> player: its strongest attacking move, with 0 / 990 / 999 Damage Tokens
      const enemyMoves = enemy
        .getMoveset()
        .map(m => m.getMove())
        .filter(m => m.category !== MoveCategory.STATUS);
      const enemyHits: Record<string, unknown>[] = [];
      for (const move of enemyMoves) {
        const r: Record<string, unknown> = { move: move.name };
        for (const n of [0, 990, 999]) {
          await setEnemyToken("ENEMY_DAMAGE_BOOSTER", n);
          const d = hit(enemy, player, move.id);
          r[`dmg${n}`] = d;
          r[`dmg${n} %playerMaxHp`] = Number(((d / player.getMaxHp()) * 100).toPrecision(4));
        }
        enemyHits.push(r);
      }
      await setEnemyToken("ENEMY_DAMAGE_BOOSTER", 0);

      print("");
      print(`== Wild wave-${WAVE} boss, seed ${seed} (scene seed ${scene.seed}, wave seed ${scene.waveSeed}) ==`);
      print(JSON.stringify(info));
      print(`player: GARCHOMP lv ${player.level}, maxHp ${player.getMaxHp()}, stats ${JSON.stringify(player.stats)}`);
      for (const r of rows) {
        print(`player -> boss ${JSON.stringify(r)}`);
      }
      for (const r of enemyHits) {
        print(`boss -> player ${JSON.stringify(r)}`);
      }
      const wild = (out.wild as Record<string, unknown>) ?? {};
      wild[seed] = { enemy: info, playerMaxHp: player.getMaxHp(), playerToBoss: rows, bossToPlayer: enemyHits };
      out.wild = wild;
    },
    600_000,
  );
});
