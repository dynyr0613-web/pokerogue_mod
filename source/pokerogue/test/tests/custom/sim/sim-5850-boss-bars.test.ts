// Local fork (2026-11-13) — simulation harness, skipped by the normal suite (run with FORK_SIM=1).
// 08 명세 5번 (보정 B): each member's boss bars and max HP at wave 5850, before and after the Endless boss-trainer bars
// (endless-boss-bars.ts), for the five final trainers (endless-final-trainer.ts). Since the later 2026-11-13 change the
// bars are proportional to the member's own wild-boss bars B on the wave ("보스 체력바는 그냥 그 웨이브에서 보스가 지니는
// 보스 체력바 수랑 비례하게 합시다": ace B, the two before it round(0.7 B), the rest round(0.4 B)); a second case prints
// the bars and HP factors by role on waves 201 to 5850 for a generated boss trainer. Each party is built as
// sim-5850-trainer-candidates.test.ts builds it (`new Trainer` + `new Battle`, `genPartyMember`, `rollTrainerBattleForm`,
// then the held items: `regenerateModifierPoolThresholds` + `generateEnemyModifiers`, fusion token at its cap of 10, END
// biome); "before" is that party as it was until now, "after" the same party with `applyEndlessTrainerBossBars`. The
// rule draws no random number and a boss trainer's members already roll their items at the boss tier, so the two differ
// only by the rule.
//
// Env: FORK_SIM=1 to run; FORK_SIM_SEEDS=a,b,c (default 3 seeds); FORK_SIM_OUT=<file.json> to write the records.
import { Battle } from "#app/battle";
import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
// Local fork (2026-11-18): f = 1 below (the player at 1.0636 x C, option 다)
import { ENDLESS_PLAYER_LEVEL_FOLLOW_NEUTRAL_RATIO, getNaturalMaxExpLevel } from "#balance/endless-level-scaling";
import { modifierTypes } from "#data/data-lists";
import { rollTrainerBattleForm } from "#data/enemy-battle-forms";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { UiMode } from "#enums/ui-mode";
import type { EnemyPokemon } from "#field/pokemon";
import { Trainer } from "#field/trainer";
import type { EnemyPersistentModifier } from "#modifiers/modifier";
import { regenerateModifierPoolThresholds } from "#modifiers/modifier-type";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import {
  applyEndlessTrainerBossBars,
  type EndlessBossBarRole,
  getEndlessBossBarPlan,
  getEndlessBossBarsForRole,
  getEndlessBossHpMultiplier,
} from "#trainers/endless-boss-bars";
import { ENDLESS_FINAL_TRAINER_POOL, ENDLESS_FINAL_WAVE } from "#trainers/endless-final-trainer";
import fs from "node:fs";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const SEEDS = (process.env.FORK_SIM_SEEDS ?? "s5850-a,s5850-b,s5850-c").split(",").filter(s => s.length > 0);

/** The waves of the by-role table */
const TABLE_WAVES = [201, 500, 1000, 2000, 3000, 4000, 5000, ENDLESS_FINAL_WAVE] as const;

interface MemberRecord {
  readonly slot: number;
  readonly name: string;
  readonly role: EndlessBossBarRole;
  readonly bst: number;
  readonly level: number;
  /** The bars a wild boss of the member gets on the wave (B) */
  readonly wildBars: number;
  readonly barsBefore: number;
  readonly barsAfter: number;
  readonly maxHpBefore: number;
  readonly maxHpAfter: number;
  readonly hpFactor: number;
  readonly passiveBefore: boolean;
  readonly passiveAfter: boolean;
}

interface PartyRecord {
  readonly trainer: string;
  readonly seed: string;
  readonly members: MemberRecord[];
}

describe.skipIf(!process.env.FORK_SIM)("Sim: 5850 final trainers' boss bars and max HP before / after 보정 B", () => {
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
      .startingBiome(BiomeId.END)
      .disableTrainerWaves()
      .startingWave(ENDLESS_FINAL_WAVE);
  });

  afterEach(() => {
    logSpy?.mockRestore();
    logSpy = undefined;
    vi.restoreAllMocks();
  });

  async function buildParty(type: TrainerType, seed: string, wave: number = ENDLESS_FINAL_WAVE): Promise<PartyRecord> {
    const { scene } = game;
    scene.clearEnemyHeldItemModifiers();
    // Local fork (2026-11-18): enemy levels follow the player both ways from wave 1000 (endless-level-scaling.ts), and
    // the starter Feebas at its starting level would get the 0.8 floor. Option 다 (f = max(0.8, 0.9637 x (P / C) ^ 0.6))
    // gives 0.9637 at the wave's expected level C and 1 at 1.0636 x C (`ENDLESS_PLAYER_LEVEL_FOLLOW_NEUTRAL_RATIO`; a
    // whole level there moves no rounded enemy level), so the members come out on the normal level curve, as before (the
    // 3차 rule gave f = 1 for any player up to C)
    scene.getPlayerParty()[0].level = Math.round(
      getNaturalMaxExpLevel(scene.gameMode, wave) * ENDLESS_PLAYER_LEVEL_FOLLOW_NEUTRAL_RATIO,
    );
    scene.setSeed(seed);
    scene.resetSeed(wave);
    const trainer = new Trainer(type, TrainerVariant.DEFAULT);
    const battle = new Battle(scene.gameMode, {
      waveIndex: wave,
      battleType: BattleType.TRAINER,
      trainer,
      double: false,
    });
    scene.currentBattle = battle;
    for (let e = 0; e < (battle.enemyLevels?.length ?? 0); e++) {
      battle.enemyParty[e] = trainer.genPartyMember(e);
    }
    rollTrainerBattleForm(battle.enemyParty);
    regenerateModifierPoolThresholds(scene.getEnemyField(), ModifierPoolType.TRAINER);
    await scene.generateEnemyModifiers();
    const party: EnemyPokemon[] = battle.enemyParty;
    for (const p of party) {
      p.calculateStats();
    }
    const before = party.map(p => ({ bars: p.bossSegments ?? 0, maxHp: p.getMaxHp(), passive: p.hasPassive() }));
    const plan = getEndlessBossBarPlan(party, wave, false);
    applyEndlessTrainerBossBars(battle);
    const members = party.map((p, slot) => ({
      slot,
      name: p.name,
      role: plan[slot].role,
      bst: p.species.baseTotal,
      level: p.level,
      wildBars: plan[slot].wildBars,
      barsBefore: before[slot].bars,
      barsAfter: p.bossSegments ?? 0,
      maxHpBefore: before[slot].maxHp,
      maxHpAfter: p.getMaxHp(),
      hpFactor: Math.round((p.getMaxHp() / before[slot].maxHp) * 1000) / 1000,
      passiveBefore: before[slot].passive,
      passiveAfter: p.hasPassive(),
    }));
    for (const p of party) {
      p.destroy();
    }
    trainer.destroy();
    scene.clearEnemyHeldItemModifiers();
    return { trainer: TrainerType[type], seed, members };
  }

  /** Starts an Endless run on wave 5850 (END biome) with the fusion token at its cap, and silences the game's log */
  async function startRun(): Promise<void> {
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
    const token = modifierTypes.ENEMY_FUSED_CHANCE().newModifier() as EnemyPersistentModifier;
    token.stackCount = 10;
    await game.scene.addEnemyModifier(token, true, true);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  }

  /** The bars and HP factor the proportional rule gives `m` (its config's own bars when more), the HP rounded as recorded */
  function expectedOf(m: MemberRecord): { bars: number; hpFactor: number } {
    const bars = Math.max(m.barsBefore || 1, getEndlessBossBarsForRole(m.role, m.wildBars));
    return { bars, hpFactor: Math.round(getEndlessBossHpMultiplier(bars) * 1000) / 1000 };
  }

  /** One table row of a member of the 5850 records */
  function memberRow(r: PartyRecord, m: MemberRecord): string {
    const onOff = (on: boolean) => (on ? "on" : "off");
    const hp = (n: number) => n.toLocaleString("en-US");
    return `| ${r.trainer} | ${r.seed} | ${m.slot} | ${m.role} | ${m.name} | ${m.bst} | ${m.wildBars} | ${m.barsBefore} -> ${m.barsAfter} | ${hp(m.maxHpBefore)} -> ${hp(m.maxHpAfter)} | ${m.hpFactor} | ${onOff(m.passiveBefore)} -> ${onOff(m.passiveAfter)} |`;
  }

  it("records every final trainer's members at wave 5850", async () => {
    await startRun();
    const records: PartyRecord[] = [];
    for (const type of ENDLESS_FINAL_TRAINER_POOL) {
      for (const seed of SEEDS) {
        records.push(await buildParty(type, seed));
      }
    }
    const lines = [
      "| trainer | seed | slot | role | member | BST | wild B | bars before -> after | max HP before -> after | x | passive |",
    ];
    lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
    for (const r of records) {
      lines.push(...r.members.map(m => memberRow(r, m)));
    }
    process.stdout.write(`${lines.join("\n")}\n`);
    if (process.env.FORK_SIM_OUT) {
      fs.writeFileSync(process.env.FORK_SIM_OUT, JSON.stringify(records, null, 1));
    }
    for (const r of records) {
      // Every member is far past level 100: B is 26, or 27 for BST 670+
      expect(
        r.members.map(m => m.wildBars),
        `${r.trainer} ${r.seed}`,
      ).toEqual(r.members.map(m => (m.bst >= 670 ? 27 : 26)));
      expect(
        r.members.map(m => m.role),
        `${r.trainer} ${r.seed}`,
      ).toEqual(["member", "member", "member", "subAce", "subAce", "ace"]);
      expect(
        r.members.map(m => ({ bars: m.barsAfter, hpFactor: m.hpFactor })),
        `${r.trainer} ${r.seed}`,
      ).toEqual(r.members.map(expectedOf));
    }
  });

  it("prints the bars and HP factors by role on waves 201 to 5850 (B from each member's level and species)", async () => {
    await startRun();
    const { scene } = game;
    // B by the engine's count for a member past level 100, BST under 670 and 670+
    const low = speciesDataRegistry.getSpecies(SpeciesId.RHYPERIOR);
    const high = speciesDataRegistry.getSpecies(SpeciesId.RAYQUAZA);
    const roles: EndlessBossBarRole[] = ["member", "subAce", "ace"];
    const cell = (wild: number, role: EndlessBossBarRole) => {
      const bars = getEndlessBossBarsForRole(role, wild);
      return `${bars} (x${getEndlessBossHpMultiplier(bars)})`;
    };
    const lines = [
      "| wave | B (BST < 670 / 670+) | member | sub-ace | ace | member 670+ | sub-ace 670+ | ace 670+ |",
      "|---|---|---|---|---|---|---|---|",
    ];
    for (const wave of TABLE_WAVES) {
      const b = scene.getEncounterBossSegments(wave, 200, low, true);
      const bHigh = scene.getEncounterBossSegments(wave, 200, high, true);
      lines.push(
        `| ${wave} | ${b} / ${bHigh} | ${roles.map(r => cell(b, r)).join(" | ")} | ${roles.map(r => cell(bHigh, r)).join(" | ")} |`,
      );
    }
    // Generated parties (Cynthia, seed s5850-a) on each wave: levels, B, bars and HP factors as the game makes them
    const generated = ["| wave | levels | wild B | bars | HP x |", "|---|---|---|---|---|"];
    for (const wave of TABLE_WAVES) {
      const r = await buildParty(TrainerType.CYNTHIA, SEEDS[0], wave);
      generated.push(
        `| ${wave} | ${r.members.map(m => m.level).join(", ")} | ${r.members.map(m => m.wildBars).join(" / ")} | ${r.members.map(m => m.barsAfter).join(" / ")} | ${r.members.map(m => m.hpFactor).join(" / ")} |`,
      );
      for (const m of r.members) {
        const exp = expectedOf(m);
        expect(m.barsAfter, `${wave} ${m.name}`).toBe(exp.bars >= 2 ? exp.bars : m.barsBefore);
      }
    }
    process.stdout.write(`${lines.join("\n")}\n\n${generated.join("\n")}\n`);
  });
});
