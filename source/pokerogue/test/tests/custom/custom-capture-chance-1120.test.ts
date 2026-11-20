/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { getGameMode } from "#app/game-mode";
import { timedEventManager } from "#app/global-event-manager";
import {
  type CaptureOdds,
  formatCaptureChance,
  getBallBlockKey,
  getCaptureOdds,
  getCaptureSuccessChance,
} from "#data/capture-chance";
import { ENDLESS_RAID_WAVE } from "#data/endless-raid";
import { getCriticalCaptureChance, getPokeballCatchMultiplier } from "#data/pokeball";
import { getStatusEffectCatchRateMultiplier, Status } from "#data/status-effect";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import type { BallUiHandler } from "#ui/ball-ui-handler";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local fork (2026-11-20): Q3, the capture chance in the ball menu (capture-chance.ts). The user: "실행" (to "볼 고를 때
 * 포획 확률 표시").
 */
describe("Local fork - the capture chance in the ball menu (2026-11-20)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  const BALLS = [
    PokeballType.POKEBALL,
    PokeballType.GREAT_BALL,
    PokeballType.ULTRA_BALL,
    PokeballType.ROGUE_BALL,
    PokeballType.MASTER_BALL,
  ];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .startingLevel(50)
      .enemyLevel(30)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The calculation `AttemptCapturePhase.start` had inline before it moved to capture-chance.ts (copied as it was) */
  function oldInlineOdds(pokemon: Pokemon, pokeballType: PokeballType) {
    const _3m = 3 * pokemon.getMaxHp();
    const _2h = 2 * pokemon.hp;
    const catchRate = pokemon.species.catchRate;
    const pokeballMultiplier = getPokeballCatchMultiplier(pokeballType);
    const statusMultiplier = pokemon.status ? getStatusEffectCatchRateMultiplier(pokemon.status.effect) : 1;
    const shinyMultiplier = pokemon.isShiny() ? timedEventManager.getShinyCatchMultiplier() : 1;
    const modifiedCatchRate = Math.round(
      (((_3m - _2h) * catchRate * pokeballMultiplier) / _3m) * statusMultiplier * shinyMultiplier,
    );
    const shakeProbability = Math.round(65536 / Math.pow(255 / modifiedCatchRate, 0.1875));
    const criticalCaptureChance = getCriticalCaptureChance(modifiedCatchRate);
    return {
      catchRate,
      pokeballMultiplier,
      statusMultiplier,
      shinyMultiplier,
      modifiedCatchRate,
      shakeProbability,
      criticalCaptureChance,
    };
  }

  /** Opens the ball menu from the command menu and returns its handler */
  async function openBallMenu(): Promise<BallUiHandler> {
    await game.scene.ui.setModeWithoutClear(UiMode.BALL);
    return game.scene.ui.getHandler() as BallUiHandler;
  }

  /** The chance text the ball menu should show for `pokemon`, by the capture's own math */
  function expectedLabel(pokemon: Pokemon, pokeballType: PokeballType): string {
    return formatCaptureChance(getCaptureSuccessChance(getCaptureOdds(pokemon, pokeballType)));
  }

  it("keeps the capture's numbers exactly as the phase worked them out before", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const enemy = game.field.getEnemyPokemon();
    const maxHp = enemy.getMaxHp();

    const hps = [maxHp, Math.ceil(maxHp / 2), Math.ceil(maxHp / 10), 1];
    const statuses = [null, StatusEffect.SLEEP, StatusEffect.PARALYSIS, StatusEffect.BURN];
    const cases = hps.flatMap(hp => statuses.flatMap(status => [false, true].map(shiny => ({ hp, status, shiny }))));
    const isShiny = vi.spyOn(enemy, "isShiny");
    for (const { hp, status, shiny } of cases) {
      enemy.hp = hp;
      enemy.status = status === null ? null : new Status(status);
      isShiny.mockReturnValue(shiny);
      for (const ball of BALLS) {
        expect(getCaptureOdds(enemy, ball), `hp ${hp} status ${status} shiny ${shiny}`).toEqual(
          oldInlineOdds(enemy, ball),
        );
      }
    }
  });

  it("follows the throw's checks: Master Ball, one shake check for a critical capture, three otherwise", () => {
    const odds = (o: Partial<CaptureOdds>): CaptureOdds => ({
      catchRate: 45,
      pokeballMultiplier: 1,
      statusMultiplier: 1,
      shinyMultiplier: 1,
      modifiedCatchRate: 100,
      shakeProbability: 32768,
      criticalCaptureChance: 0,
      ...o,
    });
    // The Master Ball's -1 makes the other numbers NaN / negative; it always catches
    expect(getCaptureSuccessChance(odds({ pokeballMultiplier: -1, shakeProbability: Number.NaN }))).toBe(1);
    // No critical capture: three shake checks at 1/2
    expect(getCaptureSuccessChance(odds({}))).toBeCloseTo(0.125, 10);
    // Half the throws critical: those need one check
    expect(getCaptureSuccessChance(odds({ criticalCaptureChance: 128 }))).toBeCloseTo(0.5 * 0.5 + 0.5 * 0.125, 10);
    // A modified catch rate of 255 or more passes the checks on its own
    expect(getCaptureSuccessChance(odds({ modifiedCatchRate: 255, shakeProbability: 65536 }))).toBe(1);
    // Rolls out of 256 / 65536: a threshold past the range is a sure pass, NaN never passes
    expect(getCaptureSuccessChance(odds({ criticalCaptureChance: 300, shakeProbability: 70000 }))).toBe(1);
    expect(getCaptureSuccessChance(odds({ modifiedCatchRate: -5, shakeProbability: Number.NaN }))).toBe(0);

    expect(formatCaptureChance(null)).toBe("—");
    expect(formatCaptureChance(1)).toBe("100%");
    expect(formatCaptureChance(0.996)).toBe("99%");
    expect(formatCaptureChance(0.3125)).toBe("31%");
    expect(formatCaptureChance(0.001)).toBe("1%");
    expect(formatCaptureChance(0)).toBe("0%");
  });

  /**
   * Throws a Poké Ball at the foe at half HP with its rolls out of 256 (critical capture) and 65536 (shake checks) set by
   * `critRoll` and `shakeRoll` (the n-th shake roll), and returns whether it was caught and how many shake rolls it took
   */
  async function throwWithRolls(critRoll: number, shakeRoll: (n: number, odds: CaptureOdds) => number) {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    // A dex big enough for critical captures (x2.5)
    vi.spyOn(game.scene.gameData, "getSpeciesCount").mockReturnValue(900);
    const enemy = game.field.getEnemyPokemon();
    enemy.hp = Math.ceil(enemy.getMaxHp() / 2);
    const odds = getCaptureOdds(enemy, PokeballType.POKEBALL);
    expect(odds.modifiedCatchRate).toBeLessThan(255);
    expect(odds.criticalCaptureChance).toBeGreaterThan(0);
    const original = enemy.randBattleSeedInt.bind(enemy);
    let shakeRolls = 0;
    vi.spyOn(enemy, "randBattleSeedInt").mockImplementation((range: number, min?: number) => {
      if (range === 256) {
        return critRoll;
      }
      if (range === 65536) {
        return shakeRoll(++shakeRolls, odds);
      }
      return original(range, min);
    });
    // The test tweens skip a counter's repeats; play the ball's shakes (one `onRepeat` each, until it is stopped) after
    // `addCounter` returns, as the phase's handlers need the counter they stop
    const { tweens } = game.scene;
    const addCounter = tweens.addCounter.bind(tweens);
    vi.spyOn(tweens, "addCounter").mockImplementation((config: any) => {
      if (!config.onRepeat || !(config.repeat > 0)) {
        return addCounter(config);
      }
      let stopped = false;
      const counter = {
        stop: () => {
          stopped = true;
          return counter;
        },
      };
      setTimeout(() => {
        for (let i = 0; i < config.repeat && !stopped; i++) {
          config.onRepeat();
        }
        if (!stopped) {
          config.onComplete?.();
        }
      });
      return counter as any;
    });
    const partyLength = game.scene.getPlayerParty().length;
    game.scene.pokeballCounts[PokeballType.POKEBALL] = 1;
    game.doThrowPokeball(PokeballType.POKEBALL);
    await game.toEndOfTurn();
    return { caught: game.scene.getPlayerParty().length === partyLength + 1, shakeRolls };
  }

  // The chance is (1 - c) * s^3 + c * s (c: critical share, s: shake share); these pin the throw's side of it
  it("matches the throw: without a critical capture, three shake checks against the same threshold", async () => {
    const passing = await throwWithRolls(255, (_n, odds) => odds.shakeProbability - 1);
    expect(passing).toEqual({ caught: true, shakeRolls: 3 });
  });

  it("matches the throw: without a critical capture, the third shake check can still miss", async () => {
    const missing = await throwWithRolls(255, (n, odds) => odds.shakeProbability - (n < 3 ? 1 : 0));
    expect(missing).toEqual({ caught: false, shakeRolls: 3 });
  });

  it("matches the throw: a critical capture takes one shake check, and can miss it", async () => {
    const missing = await throwWithRolls(0, (_n, odds) => odds.shakeProbability);
    expect(missing).toEqual({ caught: false, shakeRolls: 1 });
  });

  it("shows each ball's chance in a wild battle, from the foe's HP and status when the menu opens", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const enemy = game.field.getEnemyPokemon();

    let handler = await openBallMenu();
    for (const ball of BALLS) {
      expect(handler.chanceLabels[ball]).toBe(expectedLabel(enemy, ball));
      expect(getBallBlockKey(ball)).toBeNull();
    }
    expect(handler.chanceLabels[PokeballType.MASTER_BALL]).toBe("100%");
    const fullHpPokeBall = getCaptureSuccessChance(getCaptureOdds(enemy, PokeballType.POKEBALL));
    // The text shows the same lines, in the ball order
    expect((handler as any).chanceText.text).toBe(BALLS.map(ball => handler.chanceLabels[ball]).join("\n"));

    // Weakened and asleep: a better chance the next time the menu opens
    await game.scene.ui.setMode(UiMode.COMMAND, 0);
    enemy.hp = 1;
    enemy.status = new Status(StatusEffect.SLEEP);
    handler = await openBallMenu();
    const weakPokeBall = getCaptureSuccessChance(getCaptureOdds(enemy, PokeballType.POKEBALL));
    expect(weakPokeBall).toBeGreaterThan(fullHpPokeBall);
    for (const ball of BALLS) {
      expect(handler.chanceLabels[ball]).toBe(expectedLabel(enemy, ball));
    }
  });

  it("shows '—' for every ball in a trainer battle", async () => {
    game.override.battleType(BattleType.TRAINER);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const handler = await openBallMenu();
    for (const ball of BALLS) {
      expect(getBallBlockKey(ball)).toBe("battle:noPokeballTrainer");
      expect(handler.chanceLabels[ball]).toBe("—");
    }
  });

  it("shows '—' for every ball against two foes at once", async () => {
    game.override.battleStyle("double");
    await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP);

    const handler = await openBallMenu();
    for (const ball of BALLS) {
      expect(getBallBlockKey(ball)).toBe("battle:noPokeballMulti");
      expect(handler.chanceLabels[ball]).toBe("—");
    }
  });

  it("shows only the Master Ball against a boss with bars left, and the chance once the last bar is reached", async () => {
    game.override.enemyHealthSegments(3);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const boss = game.field.getEnemyPokemon();
    expect(boss.isBoss()).toBe(true);
    expect(boss.bossSegmentIndex).toBeGreaterThanOrEqual(1);

    let handler = await openBallMenu();
    for (const ball of BALLS.filter(b => b !== PokeballType.MASTER_BALL)) {
      expect(getBallBlockKey(ball)).toBe("battle:noPokeballStrong");
      expect(handler.chanceLabels[ball]).toBe("—");
    }
    expect(handler.chanceLabels[PokeballType.MASTER_BALL]).toBe("100%");

    // On its last bar every ball can be thrown again
    await game.scene.ui.setMode(UiMode.COMMAND, 0);
    boss.bossSegmentIndex = 0;
    boss.hp = Math.max(1, Math.floor(boss.getMaxHp() / 4));
    handler = await openBallMenu();
    for (const ball of BALLS) {
      expect(handler.chanceLabels[ball]).toBe(expectedLabel(boss, ball));
    }
  });

  it("treats the Endless raid's boss as any boss: its bars block all but the Master Ball, its raised HP counts", async () => {
    const seed = "raid";
    game.override.mysteryEncounterChance(100).startingWave(ENDLESS_RAID_WAVE).seed(seed);
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.ENDLESS);
      game.scene.offsetGym = false;
      const starters = generateStarters(game.scene, [SpeciesId.GARCHOMP, SpeciesId.MILOTIC]);
      game.scene.setSeed(seed);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await game.phaseInterceptor.to("CommandPhase", false);

    const boss = game.scene.getEnemyParty()[0];
    expect(game.scene.currentBattle.waveIndex).toBe(ENDLESS_RAID_WAVE);
    expect(boss.isBoss()).toBe(true);

    let handler = await openBallMenu();
    expect(handler.chanceLabels[PokeballType.POKEBALL]).toBe("—");
    expect(handler.chanceLabels[PokeballType.ROGUE_BALL]).toBe("—");
    expect(handler.chanceLabels[PokeballType.MASTER_BALL]).toBe("100%");

    await game.scene.ui.setMode(UiMode.COMMAND, 0);
    boss.bossSegmentIndex = 0;
    boss.hp = Math.max(1, Math.floor(boss.getMaxHp() / 10));
    handler = await openBallMenu();
    for (const ball of BALLS) {
      expect(handler.chanceLabels[ball]).toBe(expectedLabel(boss, ball));
    }
  });
});
