/**
 * Local fork (2026-11-13) experiment harness, skipped unless FORK_SIM is set (`FORK_SIM=1 npx vitest run <this file>`).
 *
 * Measures the supply side of growing one "ace" Pokémon in Endless (the user's 5850-wave ace experiment):
 * - final reward tier odds (Endless curve + luck upgrades) at chosen waves and luck values;
 * - the EXP level cap, the wave money and when it passes Number.MAX_SAFE_INTEGER (the money cap);
 * - reroll prices (plain and Lock Capsule tier lock) and how many rerolls a full bank buys;
 * - a Monte Carlo of the Lock Capsule ratchet (locked tiers keep their luck upgrades between rerolls);
 * - the player's pool weights for an ace party with nothing held, and with the ace holding every
 *   "full rule" held item at its cap (what is still offered once the ace is maxed);
 * - the stat an IV 15 vs IV 31 ace reaches with vitamins + IV Candies at their IV caps.
 * Prints tables to the console; the only assertions are sanity checks.
 */
import { getGameMode } from "#app/game-mode";
import { FULL_RULE_HELD_ITEM_IDS, getEndlessTierCounts } from "#balance/endless-balance";
import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { GameModes } from "#enums/game-modes";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { SpeciesId } from "#enums/species-id";
import { PERMANENT_STATS, Stat } from "#enums/stat";
import { UiMode } from "#enums/ui-mode";
import { Unlockables } from "#enums/unlockables";
import type { Pokemon } from "#field/pokemon";
import type { EnemyPersistentModifier, PersistentModifier, PokemonHeldItemModifier } from "#modifiers/modifier";
import {
  FormChangeItemModifierType,
  type ModifierType,
  ModifierTypeGenerator,
  PokemonHeldItemModifierType,
  type WeightedModifierType,
} from "#modifiers/modifier-type";
import { computeRerollCost } from "#modifiers/reroll-cost";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import { getModifierPoolForType } from "#utils/modifier-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TIER_NAMES = ["COMMON", "GREAT", "ULTRA", "ROGUE", "MASTER"] as const;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/** The per-step luck upgrade chance of a reward slot (modifier-type.ts getNewModifierTypeOption) */
function upgradeChance(luck: number): number {
  const upgradeOdds = Math.floor(128 / ((luck + 4) / 4));
  return 4 / upgradeOdds;
}

/** Final tier odds of one unlocked Endless reward slot at `wave` with party luck `luck` (vouchers ignored) */
function finalTierOdds(wave: number, luck: number): number[] {
  const counts = getEndlessTierCounts(wave);
  const p = upgradeChance(luck);
  const out = [0, 0, 0, 0, 0];
  counts.forEach((count, tier) => {
    const base = count / 1024;
    for (let j = tier; j < ModifierTier.MASTER; j++) {
      out[j] += base * p ** (j - tier) * (1 - p);
    }
    out[ModifierTier.MASTER] += base * p ** (ModifierTier.MASTER - tier);
  });
  return out;
}

function pct(x: number, digits = 2): string {
  return `${(x * 100).toFixed(digits)}%`;
}

function sampleTier(odds: number[]): number {
  let r = Math.random();
  for (let t = 0; t < odds.length; t++) {
    r -= odds[t];
    if (r < 0) {
      return t;
    }
  }
  return ModifierTier.MASTER;
}

function geometricUpgrades(p: number): number {
  let k = 0;
  while (Math.random() < p) {
    k++;
  }
  return k;
}

describe.skipIf(!process.env.FORK_SIM)("Sim - ace growth supply in Endless", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.PSYSTRIKE, MoveId.AURA_SPHERE, MoveId.DRAIN_PUNCH, MoveId.ICE_BEAM])
      .startingLevel(100);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function startEndless(species: SpeciesId[]): Promise<void> {
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.ENDLESS);
      game.scene.offsetGym = false;
      game.scene.gameData.unlocks[Unlockables.ENDLESS_MODE] = true;
      const starters = generateStarters(game.scene, species);
      const selectStarterPhase = new SelectStarterPhase();
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      selectStarterPhase.initBattle(starters);
    });
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    await game.phaseInterceptor.to("CommandPhase", false);
    game.scene.gameData.unlocks[Unlockables.ENDLESS_MODE] = true;
  }

  function setWave(wave: number): void {
    game.scene.currentBattle.waveIndex = wave;
  }

  /** Gives `pokemon` `count` of the held item made by `type` (stack set directly) */
  function give(pokemon: Pokemon, type: ModifierType, count: number): PokemonHeldItemModifier | undefined {
    const mod = type.newModifier(pokemon) as PokemonHeldItemModifier | null;
    if (!mod) {
      return;
    }
    game.scene.addModifier(mod, true, false, false, true);
    const held = pokemon.getHeldItems().find(m => m.matchType(mod));
    if (held) {
      held.stackCount = count;
    }
    return held;
  }

  /**
   * The weight each player pool entry gets now, as regenerateModifierPoolThresholds computes it (fork content
   * unlocked), plus whether a generator has anything to give this party
   */
  function poolWeights(): { tier: number; id: string; weight: number; generatorEmpty: boolean }[] {
    const party = game.scene.getPlayerParty();
    const pool = getModifierPoolForType(ModifierPoolType.PLAYER);
    const rows: { tier: number; id: string; weight: number; generatorEmpty: boolean }[] = [];
    for (const tier of [0, 1, 2, 3, 4]) {
      for (const entry of pool[tier] as WeightedModifierType[]) {
        const mt = entry.modifierType;
        const existing = game.scene.findModifiers(m => m.type.id === mt.id, true) as PersistentModifier[];
        const generated = mt instanceof ModifierTypeGenerator ? mt.generateType(party) : mt;
        const ok =
          existing.length === 0
          || generated instanceof PokemonHeldItemModifierType
          || generated instanceof FormChangeItemModifierType
          || existing.some(m => m.stackCount < m.getMaxStackCount(true));
        const weight = ok ? (typeof entry.weight === "function" ? entry.weight(party, 0) : entry.weight) : 0;
        rows.push({
          tier,
          id: mt.id,
          weight,
          generatorEmpty: mt instanceof ModifierTypeGenerator && generated == null,
        });
      }
    }
    return rows;
  }

  function printPool(label: string): Map<string, { tier: number; weight: number }> {
    const rows = poolWeights();
    const lines: string[] = [`=== Pool weights: ${label}`];
    const map = new Map<string, { tier: number; weight: number }>();
    for (const tier of [0, 1, 2, 3, 4]) {
      const tierRows = rows.filter(r => r.tier === tier);
      const effective = tierRows.filter(r => r.weight > 0 && !r.generatorEmpty);
      const sum = effective.reduce((s, r) => s + r.weight, 0);
      lines.push(`${TIER_NAMES[tier]} effective sum ${sum}: ${effective.map(r => `${r.id} ${r.weight}`).join(", ")}`);
      const zero = tierRows.filter(r => r.weight === 0 || r.generatorEmpty).map(r => r.id);
      lines.push(`  ${TIER_NAMES[tier]} zero/empty: ${zero.join(", ")}`);
      for (const r of effective) {
        map.set(r.id, { tier, weight: r.weight / sum });
      }
    }
    process.stdout.write(`${lines.join("\n")}\n`);
    return map;
  }

  it("prints tier odds, level cap, money, reroll and pool numbers", async () => {
    // Ace Mewtwo + supports: Ninjask (Baton Pass / Speed Boost), Zigzagoon (Pickup), Combee (Honey Gather),
    // Chansey, Smeargle
    await startEndless([
      SpeciesId.MEWTWO,
      SpeciesId.NINJASK,
      SpeciesId.ZIGZAGOON,
      SpeciesId.COMBEE,
      SpeciesId.CHANSEY,
      SpeciesId.SMEARGLE,
    ]);
    const out: string[] = [];

    // 1. Final tier odds
    out.push("=== Final reward tier odds per slot (Endless curve + luck upgrade), COMMON/GREAT/ULTRA/ROGUE/MASTER");
    for (const wave of [1000, 2000, 3000, 4000, 5000, 5850]) {
      out.push(`wave ${wave} counts ${getEndlessTierCounts(wave).join("/")}`);
      for (const luck of [0, 4, 9, 14]) {
        const odds = finalTierOdds(wave, luck);
        const roguePlus = odds[3] + odds[4];
        out.push(
          `  luck ${luck} (step ${pct(upgradeChance(luck))}): ${odds.map(o => pct(o)).join(" / ")}`
            + ` | 12 slots: >=1 MASTER ${pct(1 - (1 - odds[4]) ** 12, 1)}, >=1 ROGUE+ ${pct(1 - (1 - roguePlus) ** 12, 1)}`,
        );
      }
    }

    // 2. Level cap
    out.push("=== getMaxExpLevel");
    for (const wave of [200, 500, 1000, 2000, 3000, 4000, 5000, 5800, 5849, 5850]) {
      setWave(wave);
      out.push(`wave ${wave}: ${game.scene.getMaxExpLevel()}`);
    }

    // 3. Money
    out.push("=== getWaveMoneyAmount(1) and the money cap (Number.MAX_SAFE_INTEGER)");
    for (const wave of [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 5000, 5850]) {
      setWave(wave);
      out.push(`wave ${wave}: x1 ${game.scene.getWaveMoneyAmount(1).toExponential(3)}`);
    }
    const firstWave = (mult: number) => {
      for (let w = 1; w <= 5850; w++) {
        setWave(w);
        if (game.scene.getWaveMoneyAmount(mult) >= MAX_SAFE) {
          return w;
        }
      }
      return -1;
    };
    out.push(
      `first wave with wave money >= MAX_SAFE: x10 (champion) ${firstWave(10)}, x2.5 (gym/Big Nugget) ${firstWave(2.5)}, `
        + `x1 (trainer/Nugget) ${firstWave(1)}, x0.2 (Honey Gather / Pay Day) ${firstWave(0.2)}`,
    );

    // 4. Rerolls
    out.push("=== Reroll prices (no Black Sludge) and rerolls a bank of MAX_SAFE buys on one screen");
    for (const wave of [1000, 2000, 3000, 5850]) {
      setWave(wave);
      const lockedMaster = new Array(12).fill(ModifierTier.MASTER);
      const lockedCommon = new Array(12).fill(ModifierTier.COMMON);
      const affordable = (locked: ModifierTier[] | null, bank: number) => {
        let spent = 0;
        let n = 0;
        while (spent + computeRerollCost(locked, n, 1) <= bank) {
          spent += computeRerollCost(locked, n, 1);
          n++;
        }
        return n;
      };
      setWave(wave);
      const waveMoney = game.scene.getWaveMoneyAmount(1);
      out.push(
        `wave ${wave}: plain 1st ${computeRerollCost(null, 0, 1)}, locked 12xMASTER 1st ${computeRerollCost(lockedMaster, 0, 1)}, `
          + `locked 12xCOMMON 1st ${computeRerollCost(lockedCommon, 0, 1)}; bank MAX_SAFE buys plain ${affordable(null, MAX_SAFE)}, `
          + `locked-master ${affordable(lockedMaster, MAX_SAFE)}; bank = 1x wave money (${waveMoney.toExponential(2)}) buys plain `
          + `${affordable(null, Math.min(waveMoney, MAX_SAFE))}, locked-master ${affordable(lockedMaster, Math.min(waveMoney, MAX_SAFE))}`,
      );
    }

    // 5. Lock Capsule ratchet Monte Carlo (12 slots locked from the first roll, bank MAX_SAFE)
    out.push(
      "=== Lock Capsule ratchet: 12 locked slots, rerolls until the bank (MAX_SAFE) runs out, 2000 screens each",
    );
    for (const wave of [3000, 5850]) {
      setWave(wave);
      for (const luck of [0, 4, 9, 14]) {
        const odds = finalTierOdds(wave, luck);
        const p = upgradeChance(luck);
        let screensWithMaster = 0;
        let totalMasterOffers = 0;
        let totalRerolls = 0;
        let firstMasterRerollSum = 0;
        let firstMasterCount = 0;
        let allMasterCount = 0;
        const screens = 2000;
        for (let s = 0; s < screens; s++) {
          let tiers = Array.from({ length: 12 }, () => sampleTier(odds));
          let bank = MAX_SAFE;
          let n = 0;
          let firstMaster = tiers.includes(ModifierTier.MASTER) ? 0 : -1;
          totalMasterOffers += tiers.filter(t => t === ModifierTier.MASTER).length;
          for (;;) {
            const cost = computeRerollCost(tiers, n, 1);
            if (cost > bank) {
              break;
            }
            bank -= cost;
            n++;
            tiers = tiers.map(t =>
              t >= ModifierTier.MASTER ? t : Math.min(t + geometricUpgrades(p), ModifierTier.MASTER),
            );
            const masters = tiers.filter(t => t === ModifierTier.MASTER).length;
            totalMasterOffers += masters;
            if (firstMaster < 0 && masters > 0) {
              firstMaster = n;
            }
          }
          totalRerolls += n;
          if (firstMaster >= 0) {
            screensWithMaster++;
            firstMasterRerollSum += firstMaster;
            firstMasterCount++;
          }
          if (tiers.every(t => t === ModifierTier.MASTER)) {
            allMasterCount++;
          }
        }
        out.push(
          `wave ${wave} luck ${luck}: rerolls/screen ${(totalRerolls / screens).toFixed(1)}, screens with a MASTER `
            + `${pct(screensWithMaster / screens, 1)} (first after ${(firstMasterRerollSum / Math.max(firstMasterCount, 1)).toFixed(1)} `
            + `rerolls), all 12 MASTER at the end ${pct(allMasterCount / screens, 1)}, MASTER options seen/screen `
            + `${(totalMasterOffers / screens).toFixed(1)}`,
        );
      }
    }
    process.stdout.write(`${out.join("\n")}\n`);

    // 6. Pool weights at wave 5850, enemy side holding a Protection Token
    setWave(5850);
    const token = modifierTypes.ENEMY_DAMAGE_REDUCTION().newModifier() as EnemyPersistentModifier;
    await game.scene.addEnemyModifier(token, true);
    const fresh = printPool("wave 5850, nothing held, enemy has Protection Tokens");
    const perSlot: string[] = ["=== Per-slot odds of chosen items at wave 5850 (fresh party), luck 0 / 14"];
    const odds0 = finalTierOdds(5850, 0);
    const odds14 = finalTierOdds(5850, 14);
    for (const id of [
      "BASE_STAT_BOOSTER",
      "IV_CANDY",
      "RARE_CANDY",
      "ATTACK_TYPE_BOOSTER",
      "WISE_GLASSES",
      "WEIGHT_BAND",
      "LEFTOVERS",
      "SHELL_BELL",
      "LIFE_ORB",
      "EXPERT_BELT",
      "BOOSTER_ENERGY",
      "POWER_LENS",
      "CANDY_PILE",
      "PIERCING_TOKEN",
      "GOLDEN_FOUR_LEAF_CLOVER",
      "ASSAULT_VEST",
      "CHOICE_SPECS",
      "ULTIMATE_GENE",
      "CHAMPION_BELT",
      "MASTER_TM",
      "MULTI_LENS",
    ]) {
      const row = fresh.get(id);
      if (!row) {
        perSlot.push(`${id}: not offered`);
        continue;
      }
      perSlot.push(
        `${id} (${TIER_NAMES[row.tier]}, ${pct(row.weight, 1)} of tier): ${pct(odds0[row.tier] * row.weight, 3)} / `
          + `${pct(odds14[row.tier] * row.weight, 3)} per slot; 12 slots >=1: ${pct(1 - (1 - odds0[row.tier] * row.weight) ** 12, 1)} / `
          + `${pct(1 - (1 - odds14[row.tier] * row.weight) ** 12, 1)}`,
      );
    }
    process.stdout.write(`${perSlot.join("\n")}\n`);

    // 7. The ace holds every full-rule held item at its cap
    const ace = game.scene.getPlayerParty()[0];
    // The pool's own entries carry the type id the full-item rule reads (a fresh `modifierTypes[id]()` has none)
    const playerPool = getModifierPoolForType(ModifierPoolType.PLAYER);
    for (const id of FULL_RULE_HELD_ITEM_IDS) {
      const type = Object.values(playerPool)
        .flat()
        .find(w => w.modifierType.id === id)?.modifierType;
      if (!type || type instanceof ModifierTypeGenerator) {
        continue;
      }
      const held = give(ace, type, 1);
      if (held) {
        held.stackCount = held.getMaxHeldItemCount(ace);
      }
    }
    const heldSummary = ace
      .getHeldItems()
      .map(m => `${m.type.id}x${m.stackCount}`)
      .join(", ");
    process.stdout.write(`=== Ace holds: ${heldSummary}\n`);
    printPool("wave 5850, ace holds every full-rule item at cap");
    expect(ace.getHeldItems().length).toBeGreaterThan(30);
  });

  it("measures vitamins + IV Candies at their IV caps, IV 15 vs IV 31 (Mewtwo, level 100)", async () => {
    await startEndless([SpeciesId.MEWTWO, SpeciesId.MEWTWO]);
    const [low, high] = game.scene.getPlayerParty();
    low.ivs = [15, 15, 15, 15, 15, 15];
    high.ivs = [31, 31, 31, 31, 31, 31];
    const out: string[] = ["=== Mewtwo L100 stats: none / vitamins at cap / vitamins + IV Candies at cap"];
    for (const mon of [low, high]) {
      mon.setCustomNature(Nature.HARDY);
      mon.calculateStats();
      const before = PERMANENT_STATS.map(s => mon.getStat(s));
      const party = game.scene.getPlayerParty();
      for (const stat of PERMANENT_STATS) {
        const vit = (modifierTypes.BASE_STAT_BOOSTER() as ModifierTypeGenerator).generateType(party, [stat]);
        give(mon, vit!, mon.ivs[stat]);
      }
      mon.calculateStats();
      const withVitamins = PERMANENT_STATS.map(s => mon.getStat(s));
      for (const stat of PERMANENT_STATS) {
        const candy = (modifierTypes.IV_CANDY() as ModifierTypeGenerator).generateType(party, [stat]);
        give(mon, candy!, mon.ivs[stat]);
      }
      mon.calculateStats();
      const withCandies = PERMANENT_STATS.map(s => mon.getStat(s));
      out.push(
        `IV ${mon.ivs[0]}: ${before.join("/")} -> ${withVitamins.join("/")} -> ${withCandies.join("/")} `
          + `(ATK x${(withCandies[Stat.ATK] / before[Stat.ATK]).toFixed(2)}, SPATK x${(withCandies[Stat.SPATK] / before[Stat.SPATK]).toFixed(2)})`,
      );
    }
    process.stdout.write(`${out.join("\n")}\n`);
    expect(high.getStat(Stat.SPATK)).toBeGreaterThan(low.getStat(Stat.SPATK));
  });
});
