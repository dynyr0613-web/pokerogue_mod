import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { EnemyPokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import { BOSS_SEGMENT_OVERFLOW, calculateBossSegmentDamage } from "#utils/damage";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Local fork (2026-11-13): 10 명세 2번, "보스 체력바 초과 대미지 로그 밑수 `2.0 → 2.4` 변경", in every game mode.
 * A hit that gets through a boss's current bar with `leftover` damage to spare breaks
 * `1 + floor(log_2.4(leftover / S))` bars (S = max HP / bars), so breaking k bars at once needs `S x 2.4^(k-1)` of
 * leftover instead of upstream's `S x 2^(k-1)`. The aim (spec 2-2): the 5850 ace of 27 bars loses about 70% of them
 * (18-21 bars) to a turn of four neutral hits instead of all 27.
 */

/** The fork's log base, pinned here so a change to the constant has to change this test too */
const FORK_LOG_BASE = 2.4;

/** Upstream's log base, which the battle sim's ablation puts back */
const UPSTREAM_LOG_BASE = 2;

/**
 * Bars broken by one hit of `damage` on a boss at `currentHp` with bars of `segmentHp`, the way EnemyPokemon.damage
 * books it: from bar index `segmentIndex` down to `clearedIndex - 1`
 */
function barsBroken(damage: number, currentHp: number, segmentHp: number, minSegmentIndex = 0): number {
  const segmentIndex = Math.ceil(currentHp / segmentHp) - 1;
  const [, clearedIndex] = calculateBossSegmentDamage(damage, currentHp, segmentHp, minSegmentIndex, segmentIndex);
  return Math.max(segmentIndex + 1 - clearedIndex, 0);
}

describe("Custom - boss bar overflow log base 2.4 (10 명세 2번)", () => {
  afterEach(() => {
    // The ablation tests below set the base back to 2; vitest runs with `isolate: false`, so always put it back
    BOSS_SEGMENT_OVERFLOW.logBase = FORK_LOG_BASE;
  });

  it("uses 2.4 as the overflow log base", () => {
    expect(BOSS_SEGMENT_OVERFLOW.logBase).toBe(FORK_LOG_BASE);
  });

  describe("the spec's table: k bars at once need S x 2.4^(k-1) of leftover", () => {
    // S = 15625 = 5^6 makes every threshold S x 2.4^(k-1) = 12^(k-1) x 5^(7-k) an exact integer up to k = 7, so the
    // exact thresholds are reachable with whole damage and must not be lost to floating point
    const segmentHp = 15_625;
    const bars = 30;
    const fullHp = segmentHp * bars;
    /** S x 2.4^(k-1) as an exact integer; the spec's table: 1.00 / 2.40 / 5.76 / 13.82 / 33.18 / 79.63 / 191.10 S */
    const threshold = (k: number): number => 12 ** (k - 1) * 5 ** (7 - k);

    it("has the spec's thresholds", () => {
      const table = [1, 2.4, 5.76, 13.824, 33.1776, 79.626_24, 191.102_976];
      for (let k = 1; k <= 7; k++) {
        expect(threshold(k) / segmentHp, `k ${k}`).toBeCloseTo(table[k - 1], 9);
        expect(threshold(k), `k ${k}`).toBeCloseTo(segmentHp * FORK_LOG_BASE ** (k - 1), 6);
      }
    });

    it.each([1, 2, 3, 4, 5, 6, 7])("leftover of exactly S x 2.4^(%i-1) breaks that many bars", k => {
      const leftover = threshold(k);
      // The current bar is full, so the hit needs S to get through it and the leftover on top
      const damage = segmentHp + leftover;
      expect(barsBroken(damage, fullHp, segmentHp)).toBe(k);

      const [adjusted, clearedIndex] = calculateBossSegmentDamage(damage, fullHp, segmentHp);
      expect(clearedIndex).toBe(bars - k);
      expect(adjusted).toBe(segmentHp * k);
    });

    it.each([2, 3, 4, 5, 6, 7])("1 HP less than S x 2.4^(%i-1) of leftover breaks one bar fewer", k => {
      const damage = segmentHp + threshold(k) - 1;
      expect(barsBroken(damage, fullHp, segmentHp)).toBe(k - 1);
    });

    it("matches 2.4^(k-1) for any bar size, also when the threshold is not a whole number", () => {
      for (const segHp of [100, 777, 1_040_000]) {
        const hp = segHp * 27;
        for (let k = 2; k <= 7; k++) {
          const need = segHp * FORK_LOG_BASE ** (k - 1);
          expect(barsBroken(segHp + need, hp, segHp), `S ${segHp} k ${k}`).toBe(k);
          expect(barsBroken(segHp + need * 0.999_999, hp, segHp), `S ${segHp} k ${k} - ε`).toBe(k - 1);
        }
      }
    });

    it("breaks fewer bars than base 2 did for the same leftover from 2 bars up", () => {
      // 8 S of leftover: base 2 broke 1 + 3 = 4 bars, base 2.4 breaks 1 + floor(2.38) = 3
      expect(barsBroken(segmentHp * 9, fullHp, segmentHp)).toBe(3);
      BOSS_SEGMENT_OVERFLOW.logBase = UPSTREAM_LOG_BASE;
      expect(barsBroken(segmentHp * 9, fullHp, segmentHp)).toBe(4);
    });
  });

  describe("the battle sim's ablation: logBase set back to 2", () => {
    beforeEach(() => {
      BOSS_SEGMENT_OVERFLOW.logBase = UPSTREAM_LOG_BASE;
    });

    it("breaks k bars with exactly S x 2^(k-1) of leftover and k-1 with 1 HP less, as upstream", () => {
      const segmentHp = 100;
      const fullHp = segmentHp * 30;
      for (let k = 1; k <= 8; k++) {
        const leftover = segmentHp * 2 ** (k - 1);
        expect(barsBroken(segmentHp + leftover, fullHp, segmentHp), `k ${k}`).toBe(k);
        if (k > 1) {
          expect(barsBroken(segmentHp + leftover - 1, fullHp, segmentHp), `k ${k} - 1 HP`).toBe(k - 1);
        }
      }
    });

    it("gives upstream's numbers for upstream's own example (850 damage, 800 HP in 8 bars)", () => {
      expect(calculateBossSegmentDamage(850, 800, 100)).toEqual([300, 5]);
    });

    it("takes effect while set (put back to 2.4 after each test, checked in the next block)", () => {
      expect(BOSS_SEGMENT_OVERFLOW.logBase).toBe(UPSTREAM_LOG_BASE);
    });
  });

  describe("clamps kept from upstream", () => {
    it("is back on 2.4 after the ablation tests", () => {
      expect(BOSS_SEGMENT_OVERFLOW.logBase).toBe(FORK_LOG_BASE);
    });

    it("never bypasses past minSegmentIndex (the Classic final boss keeps its last bar)", () => {
      // 5 bars of 100 HP, full: a hit of any size clears down to bar index 1 at most, i.e. 100 HP left
      expect(calculateBossSegmentDamage(1e9, 500, 100, 1)).toEqual([400, 1]);
      expect(calculateBossSegmentDamage(1e9, 500, 100, 1, 4)).toEqual([400, 1]);
      // Without the floor the same hit takes every bar
      expect(calculateBossSegmentDamage(1e9, 500, 100)).toEqual([500, 0]);
      // Below the clamp the 2.4 rule decides: 5.76 S of leftover breaks 3 bars (cleared index 2)
      expect(calculateBossSegmentDamage(100 + 576, 500, 100, 1)).toEqual([300, 2]);
      // 13.83 S breaks 4 bars, which the floor still allows (1 bar left)
      expect(calculateBossSegmentDamage(100 + 1383, 500, 100, 1)).toEqual([400, 1]);
      // 33.18 S would break all 5, the floor keeps the last one; without it the hit takes every bar
      expect(calculateBossSegmentDamage(100 + 3318, 500, 100, 1)).toEqual([400, 1]);
      expect(calculateBossSegmentDamage(100 + 3318, 500, 100)).toEqual([500, 0]);
    });

    it("keeps the small-hit cases: no bar, exactly one bar, the last bar", () => {
      // Not through the current bar: original damage, nothing broken
      expect(calculateBossSegmentDamage(30, 250, 100)).toEqual([30, 3]);
      // Exactly to the bar's end: that bar breaks
      expect(calculateBossSegmentDamage(100, 500, 100)).toEqual([100, 4]);
      // Through the bar with less than 2.4 S to spare: one bar, damage stops at its end
      expect(calculateBossSegmentDamage(100 + 239, 500, 100)).toEqual([100, 4]);
      expect(calculateBossSegmentDamage(100 + 240, 500, 100)).toEqual([200, 3]);
      // On the last bar there is nothing to clamp
      expect(calculateBossSegmentDamage(5000, 100, 100)).toEqual([5000, 1]);
    });
  });

  describe("spec 2-2: the 5850 ace of 27 bars (S ≈ 1.04M HP)", () => {
    const segmentHp = 1_040_000;
    const bars = 27;
    const fullHp = segmentHp * bars;

    /** One hit of `multiplier` x S on a boss at `hp`; returns the HP after it and the bars it broke */
    function hit(hp: number, multiplier: number): { hp: number; broken: number } {
      const segmentIndex = Math.ceil(hp / segmentHp) - 1;
      const [adjusted, clearedIndex] = calculateBossSegmentDamage(
        Math.floor(multiplier * segmentHp),
        hp,
        segmentHp,
        0,
        segmentIndex,
      );
      return { hp: hp - adjusted, broken: segmentIndex + 1 - clearedIndex };
    }

    it.each([82, 90, 100, 106])("a neutral first hit of %i S breaks 6 bars", m => {
      expect(hit(fullHp, m)).toEqual({ hp: segmentHp * 21, broken: 6 });
    });

    it.each([
      [27, 4],
      [30, 4],
      [34.2, 5],
      [35, 5],
    ])("a neutral follow-up of %d S breaks %i bars", (m, broken) => {
      // After the first hit the boss sits at the top of a full bar (21 left)
      expect(hit(segmentHp * 21, m).broken).toBe(broken);
    });

    it("counts the follow-up's leftover after the bar it lands on: 33 S breaks 4 bars, 5 from 34.18 S", () => {
      // The spec's table puts 33-35 S at 5 bars; the engine measures the leftover past the current (full) bar, so a
      // follow-up needs S + 33.18 S = 34.18 S for 5
      expect(hit(segmentHp * 21, 33).broken).toBe(4);
      expect(hit(segmentHp * 21, 34.17).broken).toBe(4);
      expect(hit(segmentHp * 21, 34.18).broken).toBe(5);
    });

    it("a turn of four neutral hits (75% then 3 x 25%) breaks 18-21 of the 27 bars", () => {
      for (const [first, followUp, expected] of [
        [82, 27, 18],
        [106, 35, 21],
      ] as const) {
        let state = hit(fullHp, first);
        let total = state.broken;
        for (let i = 0; i < 3; i++) {
          state = hit(state.hp, followUp);
          total += state.broken;
        }
        expect(total, `${first} S then 3 x ${followUp} S`).toBe(expected);
        expect(state.hp, `${first} S then 3 x ${followUp} S`).toBe(segmentHp * (bars - expected));
      }
    });

    it("a weak-spot or high-power first hit of 210 S breaks 7 bars", () => {
      expect(hit(fullHp, 210)).toEqual({ hp: segmentHp * 20, broken: 7 });
    });

    /** The bars four strikes of a Multi Lens x3 turn (75% then 3 x 25% of `full` S) break, strike by strike */
    function lensTurn(full: number): { strikes: number[]; total: number; hpLeft: number } {
      let state = hit(fullHp, full * 0.75);
      const strikes = [state.broken];
      for (let i = 0; i < 3; i++) {
        state = hit(state.hp, full * 0.25);
        strikes.push(state.broken);
      }
      return { strikes, total: strikes.reduce((a, b) => a + b, 0), hpLeft: state.hp };
    }

    it("the spec's weak-spot / low-bulk turn (210 S, then 3 x 70-80 S) breaks 22 of the 27 bars, not all", () => {
      // Spec 2-2 counts 7 + 6 x 3 = 25-27 bars ("원턴킬") here, but follow-ups of 70-80 S break 5 bars each (6 only
      // from 80.63 S, 79.63 S past the full bar they land on), so the turn leaves 5 bars for the next one
      for (const followUp of [70, 80]) {
        let state = hit(fullHp, 210);
        const strikes = [state.broken];
        for (let i = 0; i < 3; i++) {
          state = hit(state.hp, followUp);
          strikes.push(state.broken);
        }
        expect(strikes, `210 S then 3 x ${followUp} S`).toEqual([7, 5, 5, 5]);
        expect(state.hp, `210 S then 3 x ${followUp} S`).toBe(segmentHp * 5);
      }
      // The same as a whole-move figure: 280 S at 100% (210 / 70)
      expect(lensTurn(280)).toEqual({ strikes: [7, 5, 5, 5], total: 22, hpLeft: segmentHp * 5 });
    });

    it("four strikes clear a fresh 27-bar ace only from about 768 S at 100% (each 25% strike >= 192.1 S)", () => {
      // 768 S: 576 S then 3 x 192 S, one short of 191.1 S past each full bar -> 8 + 6 x 3 = 26
      expect(lensTurn(768)).toEqual({ strikes: [8, 6, 6, 6], total: 26, hpLeft: segmentHp });
      // 769 S: 192.25 S strikes break 7 each, the last takes the 5 left
      expect(lensTurn(769)).toEqual({ strikes: [8, 7, 7, 5], total: 27, hpLeft: 0 });
    });

    it("base 2 (before the patch) took 7-8 bars with the same first hits", () => {
      BOSS_SEGMENT_OVERFLOW.logBase = UPSTREAM_LOG_BASE;
      expect(hit(fullHp, 82).broken).toBe(7);
      expect(hit(fullHp, 106).broken).toBe(7);
      expect(hit(fullHp, 210).broken).toBe(8);
    });
  });
});

describe("Custom - boss bar overflow log base 2.4 in battle (10 명세 2번)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("double")
      .battleType(BattleType.WILD)
      .criticalHits(false)
      .enemySpecies(SpeciesId.RATTATA)
      .enemyMoveset(MoveId.SPLASH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyHealthSegments(6)
      .startingLevel(100)
      .ability(AbilityId.BALL_FETCH);
  });

  afterEach(() => {
    BOSS_SEGMENT_OVERFLOW.logBase = FORK_LOG_BASE;
  });

  /** Gives a boss 600 max HP so each of its 6 bars is 100 HP */
  function setBars(boss: EnemyPokemon): void {
    boss.setStat(Stat.HP, 600);
    boss.hp = boss.getMaxHp();
    expect(boss.isBoss()).toBe(true);
    expect(boss.bossSegments).toBe(6);
    expect(boss.bossSegmentIndex).toBe(5);
  }

  it("a wild boss loses 3 bars to a hit with 5.76 bars' worth to spare and 2 to 1 HP less (Classic)", async () => {
    await game.classicMode.startBattle(SpeciesId.MEWTWO);
    const [boss1, boss2] = game.scene.getEnemyParty();
    setBars(boss1);
    setBars(boss2);

    // 100 to get through the full bar + 5.76 x 100 = 2.4^2 bars' worth: 3 bars, the damage stops at their end
    boss1.damageAndUpdate(100 + 576);
    expect(boss1.bossSegmentIndex).toBe(2);
    expect(boss1).toHaveTakenDamage(300);

    boss2.damageAndUpdate(100 + 575);
    expect(boss2.bossSegmentIndex).toBe(3);
    expect(boss2).toHaveTakenDamage(200);
  });

  it("the same hit broke 4 bars with base 2 (8 bars' worth to spare)", async () => {
    await game.classicMode.startBattle(SpeciesId.MEWTWO);
    const [boss1, boss2] = game.scene.getEnemyParty();
    setBars(boss1);
    setBars(boss2);

    // 2.4: 1 + floor(log_2.4(8)) = 3 bars
    boss1.damageAndUpdate(100 + 800);
    expect(boss1.bossSegmentIndex).toBe(2);
    expect(boss1).toHaveTakenDamage(300);

    BOSS_SEGMENT_OVERFLOW.logBase = UPSTREAM_LOG_BASE;
    boss2.damageAndUpdate(100 + 800);
    expect(boss2.bossSegmentIndex).toBe(1);
    expect(boss2).toHaveTakenDamage(400);
  });
});
