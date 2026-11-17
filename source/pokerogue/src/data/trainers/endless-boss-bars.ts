/*
 * Local fork (2026-11-13): boss HP bars (shields) for the Endless boss trainers past battle wave 200, with their max HP
 * raised to match (08 명세 5번, "5850웨이브 최종 트레이너 보스 HP바(실드) 적용 및 관통 제한"). At wave 5850 the final
 * trainer's members were knocked out in one turn 94% of the time (07_5850_에이스_실험.md): three of six had two bars, and
 * a Multi Lens hit breaks bars by log2 of its overkill, so the bars only split the same HP into thinner slices. (Local
 * fork (2026-11-13): log base 2.4 since 10 명세 2번, `BOSS_SEGMENT_OVERFLOW` in src/utils/damage.ts.)
 * - Who: every Pokémon of a standard Endless / Spliced Endless TRAINER battle (not a Mystery Encounter battle) whose
 *   trainer config `isBoss` (gym leaders, champions, evil-team bosses, the fork's named and late boss trainers, the final
 *   wave's trainers of endless-final-trainer.ts), from battle wave {@linkcode ENDLESS_BOSS_BARS_AFTER_WAVE} + 1 on (the
 *   same "past battle wave 200" gate as the late boss trainers and the fixed trainer fusions). Waves 1-200, wild battles,
 *   Mystery Encounters and every other mode are unchanged.
 * - Bars, by position counted from the end of the trainer's party (the ace is the last member; in a double battle of a
 *   pair, each partner's own half, as `Trainer.genPartyMember` deals the members out). Local fork (2026-11-13, later the
 *   same day): the 08 spec's fixed formulas (2 + floor(wave / 700) / 2 + floor(wave / 1100) / 1 + floor(wave / 1800),
 *   10 / 7 / 4 at wave 5850) gave way to the user's "보스 체력바가 제가알기로 5850웨이브 기준 27개인가 되던걸로
 *   기억하는데, 보스 체력바는 그냥 그 웨이브에서 보스가 지니는 보스 체력바 수랑 비례하게 합시다": B = the bars a wild
 *   boss of that very Pokémon (its species and level) gets on the wave ({@linkcode getEndlessWildBossBars}, the engine's
 *   `BattleScene.getEncounterBossSegments`: 2, +1 from level 100, +1 for a base stat total of 670 or more,
 *   +1 every 250 waves; wave 5850: 26, or 27 for BST 670+). The ace gets B, the
 *   {@linkcode ENDLESS_BOSS_SUB_ACE_COUNT} members before it round(B x 0.7), every other member round(B x 0.4), never
 *   under 1 ({@linkcode ENDLESS_BOSS_BAR_TENTHS}, the 08 spec's 10 : 7 : 4); a member keeps the bars its config already
 *   gives when those are more. Wave 5850: 26 / 18 / 10 (27 / 19 / 11 for BST 670+). One bar is an ordinary HP bar.
 * - HP (명세 5번 2항, 보정 B; the user chose it over 보정 A, the cap on bars broken per hit: "보스의 원턴킬 방지로는 보스
 *   실드 파괴 갯수 제한보단 2번째인 hp 보정이 더 좋아보이네요"): a member of such a battle with 2 or more bars gets max HP
 *   x (1 + 0.25 x (bars - 1)), in `Pokemon.calculateStats` after the HP belts, from the bar count stored on it
 *   (`EnemyPokemon.forkBossHpBars`, saved with the session), so the current HP, the HP bar and a reloaded wave agree.
 *   Wave 5850 (bars proportional to the wild boss's, above): ace x7.25, the two before it x5.25, the others x3.25
 *   (x7.5 / x5.5 / x3.5 for BST 670+).
 * - Hook: `EncounterPhase.start` (encounter-phase.ts), right after the trainer's party and its battle form are made,
 *   before anything is shown, marked seen or given items. A reloaded wave keeps the saved bars and HP.
 * - Side effects (boss Pokémon rules the engine already has): every member with bars has its passive on, is immune to
 *   one-hit KO moves, Destiny Bond, Perish Song and the moves that fail on bosses, and counts as a boss for the battle
 *   score; its moveset is not made again (no draw moves), and its held items are as before (a boss trainer's members
 *   already roll at the boss tier).
 */

import type { Battle } from "#app/battle";
import { globalScene } from "#app/global-scene";
import { activeOverrides } from "#app/overrides";
import { BattleType } from "#enums/battle-type";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";
import { FORK_LATE_BOSS_TRAINER_AFTER_WAVE } from "#trainers/named-trainers";

/** Local fork (2026-11-13): the last battle wave without the Endless boss-trainer bars (past it, Endless only) */
export const ENDLESS_BOSS_BARS_AFTER_WAVE = FORK_LATE_BOSS_TRAINER_AFTER_WAVE;

/** Local fork (2026-11-13): a member's place in its trainer's party for the bars, counted from the end */
export type EndlessBossBarRole = "ace" | "subAce" | "member";

/** Local fork (2026-11-13): how many members before the ace count as sub-aces (부에이스) */
export const ENDLESS_BOSS_SUB_ACE_COUNT = 2;

/**
 * Local fork (2026-11-13): each role's bars as tenths of the bars a wild boss of the same Pokémon gets on the wave
 * ("보스 체력바는 그냥 그 웨이브에서 보스가 지니는 보스 체력바 수랑 비례하게 합시다"): the ace all of them, the sub-aces 0.7,
 * the other members 0.4 (the 08 spec's 10 : 7 : 4 at wave 5850). Kept in whole tenths so `B x 7 / 10` rounds exactly
 * (`45 * 0.7` is 31.499... in floating point).
 */
export const ENDLESS_BOSS_BAR_TENTHS: Readonly<Record<EndlessBossBarRole, number>> = Object.freeze({
  ace: 10,
  subAce: 7,
  member: 4,
});

/** Local fork (2026-11-13): the denominator of {@linkcode ENDLESS_BOSS_BAR_TENTHS} */
const TENTHS = 10;

/** Local fork (2026-11-13): the fewest bars the proportional rule gives a member (1 = an ordinary HP bar) */
export const ENDLESS_BOSS_MIN_BARS = 1;

/** Local fork (2026-11-13): the max HP each bar past the first adds, as a share of the max HP (08 명세 5번 보정 B) */
export const ENDLESS_BOSS_HP_PER_EXTRA_BAR = 0.25;

/** Local fork (2026-11-13): the fewest bars that count as boss bars (one bar is an ordinary HP bar) */
const MIN_BOSS_BARS = 2;

/**
 * Local fork (2026-11-13): how many members of the same trainer come after party member `index`
 * @param index - The party index
 * @param partySize - The size of the whole enemy party
 * @param splitPair - Whether the party is a pair's, dealt out in turn (even indexes to the trainer, odd to the partner)
 */
export function getEndlessBossBarPosition(index: number, partySize: number, splitPair: boolean): number {
  const after = partySize - 1 - index;
  return splitPair ? Math.floor(after / 2) : after;
}

/** Local fork (2026-11-13): the role of a member with `positionFromEnd` members of its trainer after it */
export function getEndlessBossBarRole(positionFromEnd: number): EndlessBossBarRole {
  if (positionFromEnd <= 0) {
    return "ace";
  }
  return positionFromEnd <= ENDLESS_BOSS_SUB_ACE_COUNT ? "subAce" : "member";
}

/**
 * Local fork (2026-11-13): the bars a WILD boss of `pokemon` (its species and level) gets on battle wave `waveIndex`:
 * the engine's own count, `BattleScene.getEncounterBossSegments(..., forceBoss = true)` (as `EnemyPokemon.setBoss`
 * uses it), which draws no random number and is never 0 there. The test health-segment override never reaches this
 * ({@linkcode isEndlessBossBarBattle}).
 */
export function getEndlessWildBossBars(pokemon: Pokemon, waveIndex: number): number {
  return globalScene.getEncounterBossSegments(waveIndex, pokemon.level, pokemon.species, true);
}

/**
 * Local fork (2026-11-13): the bars the proportional rule gives `role` when a wild boss of the same Pokémon would have
 * `wildBossBars` on the wave: round(B x 1 / 0.7 / 0.4), never under {@linkcode ENDLESS_BOSS_MIN_BARS}
 */
export function getEndlessBossBarsForRole(role: EndlessBossBarRole, wildBossBars: number): number {
  return Math.max(ENDLESS_BOSS_MIN_BARS, Math.round((wildBossBars * ENDLESS_BOSS_BAR_TENTHS[role]) / TENTHS));
}

/** Local fork (2026-11-13): the max HP multiplier for `bars` boss bars, 1 under 2 bars (08 명세 5번 보정 B) */
export function getEndlessBossHpMultiplier(bars: number | undefined): number {
  if (bars == null || bars < MIN_BOSS_BARS) {
    return 1;
  }
  return 1 + ENDLESS_BOSS_HP_PER_EXTRA_BAR * (bars - 1);
}

/**
 * Local fork (2026-11-13): `maxHp` with the boss-trainer HP correction of `pokemon`'s stored bars
 * (`EnemyPokemon.forkBossHpBars`), rounded down; unchanged for every other Pokémon. Called by `Pokemon.calculateStats`.
 */
export function applyEndlessBossHpCorrection(pokemon: Pokemon, maxHp: number): number {
  if (!pokemon.isEnemy()) {
    return maxHp;
  }
  const multiplier = getEndlessBossHpMultiplier((pokemon as EnemyPokemon).forkBossHpBars);
  return multiplier === 1 ? maxHp : Math.floor(maxHp * multiplier);
}

/**
 * Local fork (2026-11-13): whether `battle` gets the boss-trainer bars: a standard trainer battle of Endless / Spliced
 * Endless past battle wave {@linkcode ENDLESS_BOSS_BARS_AFTER_WAVE} whose trainer config is a boss's. A test's enemy
 * health-segment override leaves the bars to the override.
 */
export function isEndlessBossBarBattle(battle: Battle): boolean {
  return (
    battle.battleType === BattleType.TRAINER
    && !!battle.trainer?.config.isBoss
    && !!globalScene.gameMode.isEndless
    && battle.waveIndex > ENDLESS_BOSS_BARS_AFTER_WAVE
    && !(activeOverrides.ENEMY_HEALTH_SEGMENTS_OVERRIDE > 0)
  );
}

/**
 * Local fork (2026-11-13): the bars each member of `party` ends up with on battle wave `waveIndex`: the larger of the
 * proportional rule for its role (from its own wild-boss bars `wildBars`) and the bars it already has (0 bars counts
 * as one ordinary bar)
 * @param party - The trainer's whole party, in order
 * @param waveIndex - The battle wave
 * @param splitPair - Whether the party is a pair's ({@linkcode getEndlessBossBarPosition})
 */
export function getEndlessBossBarPlan(
  party: readonly EnemyPokemon[],
  waveIndex: number,
  splitPair: boolean,
): { role: EndlessBossBarRole; wildBars: number; bars: number }[] {
  return party.map((p, index) => {
    const role = getEndlessBossBarRole(getEndlessBossBarPosition(index, party.length, splitPair));
    const own = p.isBoss() ? p.bossSegments : 1;
    const wildBars = getEndlessWildBossBars(p, waveIndex);
    return { role, wildBars, bars: Math.max(own, getEndlessBossBarsForRole(role, wildBars)) };
  });
}

/**
 * Local fork (2026-11-13): gives the members of `battle`'s trainer party their boss bars and the HP correction
 * (08 명세 5번, 보정 B), when {@linkcode isEndlessBossBarBattle}; nothing otherwise. Draws no random number.
 */
export function applyEndlessTrainerBossBars(battle: Battle): void {
  if (!isEndlessBossBarBattle(battle)) {
    return;
  }
  const party = battle.enemyParty;
  const plan = getEndlessBossBarPlan(party, battle.waveIndex, !!battle.trainer?.isDouble());
  party.forEach((p, index) => {
    const { bars } = plan[index];
    if (bars < MIN_BOSS_BARS) {
      return;
    }
    if (p.bossSegments !== bars) {
      p.setBoss(true, bars);
      p.initBattleInfo();
    }
    p.forkBossHpBars = bars;
    // The current HP follows the higher max HP (calculateStats), so a fresh member starts at full HP
    p.calculateStats();
  });
}
