/**
 * Local fork (2026-11-12): EVs (노력치) and the six EV items. The user: "노력치 아이템도 추가해보죠 / 종류별로 전부
 * 로그등급으로, 그 아이템을 지닌 포켓몬이 전투에 관여하여서 경험치를 얻었을 경우(첫 턴에 등장 후 교체만 해도 됨, 학습장치로
 * 경험치를 얻는건 제외), 해당 노력치 +1, 최대 노력치는 252. / 노력치 총합 제한은 없고, 각 노력치 아이템은 파티당 하나만
 * 나온다는 제한만 둡시다, 즉 방어/체력/공격/특수방어를 전부 252까지 올리는 것도 가능하단거죠 / 이러면 능력치 계산식에
 * 노력치를 둬야하긴 하겠네요".
 *
 * - PokeRogue has no EVs. Every Pokémon now has six (`Pokemon.evs`, in `PERMANENT_STATS` order), 0 to
 *   {@linkcode EV_RULES}.maxPerStat each (HP 0 to 504 since 2026-11-13: {@linkcode getEvCap}, "노력치 아이템도 hp만 상한을
 *   두배로") and no total cap (the main series' 510 does not apply). They are saved with the
 *   session (`PokemonData.evs`, written only when one is above 0, so other saves are unchanged; saves without them load
 *   as all 0) and stay with the Pokémon through evolution, form changes, Mega Evolution and Terastallization (all change
 *   the Pokémon in place). A fusion keeps the head's EVs; the tail's are dropped with the rest of its own data (IVs,
 *   nature, level), as `PlayerPokemon.fuse` already does. Unfusing keeps the head's. Shedinja gets a copy of Nincada's,
 *   as in the main series. The Weird Dream (이상한 꿈) turns each party member into a new Pokémon that keeps its IVs,
 *   luck, Pokérus, passive and held items; it keeps its EVs too (`postProcessTransformedPokemon`). Enemies always have
 *   0, except a Pokémon an encounter copies from the player's party with its data (Training Session, the Weird Dream's
 *   "future self" team), which gets the copy's EVs the way it gets its IVs.
 * - The stat formula adds the main series' floor(EV / 4) next to the IV (`Pokemon.calculateStats`).
 * - The items (all ROGUE, one per Pokémon, moved between the player's Pokémon like any plain held item, never taken by
 *   an enemy: `BattleScene.canTakeHeldItem`): whenever the game credits a party
 *   member as a participant for an enemy's EXP (`BattleScene.applyPartyExp` with `pokemonDefeated`, the same step that
 *   gives friendship and Macho Brace stacks), each EV item it holds adds {@linkcode EV_RULES}.gainPerEnemy to its stat.
 *   See {@linkcode gainEvsFromItems} (custom-held-items.ts) for who counts.
 */

import { type PermanentStat, Stat } from "#enums/stat";

/** Local fork (2026-11-12): one EV item's row in {@linkcode EV_RULES}.items */
export interface EvItemRow {
  /** The stat whose EVs it raises */
  readonly stat: PermanentStat;
  /** Its frame in the `items` atlas (Cobblemon's texture of the same name) */
  readonly icon: string;
}

/**
 * Local fork (2026-11-12): every number of the EVs and the EV items, in one place.
 * - `maxPerStat`: the most EVs one stat can have ("최대 노력치는 252"); there is no total cap ("노력치 총합 제한은 없고");
 * - `hpCapMultiplier`: Local fork (2026-11-13): HP's cap is `maxPerStat` times this, 504 (the user: "영양제가 hp만 15%,
 *   사탕은 hp만 6%, 노력치 아이템도 hp만 상한을 두배로 올려보죠."); see {@linkcode getEvCap};
 * - `evsPerStatPoint`: the stat formula adds floor(EV / 4), as in the main series (252 EVs = +63 at level 100; HP's
 *   504 = +126);
 * - `gainPerEnemy`: EVs an item adds for each enemy whose EXP its holder is credited for ("해당 노력치 +1");
 * - `maxHeld`: how many of one item one Pokémon can hold;
 * - `poolWeight`: the weight of each item in the player's ROGUE pool while no party member holds that item (0 while one
 *   does: "각 노력치 아이템은 파티당 하나만 나온다");
 * - `items`: the six items by modifier type id, with the main-series names 파워웨이트 / 파워리스트 / 파워벨트 / 파워렌즈 /
 *   파워밴드 / 파워앵클릿 (no Speed halving).
 */
export const EV_RULES = Object.freeze({
  maxPerStat: 252,
  hpCapMultiplier: 2,
  evsPerStatPoint: 4,
  gainPerEnemy: 1,
  maxHeld: 1,
  poolWeight: 2,
  items: Object.freeze({
    POWER_WEIGHT: Object.freeze({ stat: Stat.HP, icon: "power_weight" }) as EvItemRow,
    POWER_BRACER: Object.freeze({ stat: Stat.ATK, icon: "power_bracer" }) as EvItemRow,
    POWER_BELT: Object.freeze({ stat: Stat.DEF, icon: "power_belt" }) as EvItemRow,
    POWER_LENS: Object.freeze({ stat: Stat.SPATK, icon: "power_lens" }) as EvItemRow,
    POWER_BAND: Object.freeze({ stat: Stat.SPDEF, icon: "power_band" }) as EvItemRow,
    POWER_ANKLET: Object.freeze({ stat: Stat.SPD, icon: "power_anklet" }) as EvItemRow,
  }),
});

/** Local fork (2026-11-12): the modifier type ids of the six EV items */
export type EvItemId = keyof typeof EV_RULES.items;

/** Local fork (2026-11-12): the six EV item ids, in stat order */
export const EV_ITEM_IDS: readonly EvItemId[] = Object.freeze(Object.keys(EV_RULES.items) as EvItemId[]);

/** Local fork (2026-11-12): the EVs of a Pokémon that has none (every new Pokémon, every enemy) */
export function emptyEvs(): number[] {
  return [0, 0, 0, 0, 0, 0];
}

/**
 * Local fork (2026-11-13): the most EVs `stat` can have: 504 for HP ({@linkcode EV_RULES}.maxPerStat x
 * `hpCapMultiplier`; the user: "노력치 아이템도 hp만 상한을 두배로 올려보죠."), 252 for the other five. Every reader of
 * the cap goes through this: {@linkcode normalizeEvs} (save load, copies), {@linkcode addEvs} (the EV items) and the
 * summary's EV view (gold at the cap)
 * @param stat - The stat, in `PERMANENT_STATS` order
 */
export function getEvCap(stat: PermanentStat): number {
  return stat === Stat.HP ? EV_RULES.maxPerStat * EV_RULES.hpCapMultiplier : EV_RULES.maxPerStat;
}

/**
 * Local fork (2026-11-12): six EVs read from save data or another Pokémon, as a new array: each a whole number from 0 to
 * its stat's cap ({@linkcode getEvCap}: 504 for HP since 2026-11-13, 252 for the others); anything missing or broken
 * (saves from before EVs) is 0
 * @param source - The `evs` of a `PokemonData`, a save's JSON or another Pokémon
 */
export function normalizeEvs(source: unknown): number[] {
  const evs = emptyEvs();
  if (!Array.isArray(source)) {
    return evs;
  }
  for (let s = 0; s < evs.length; s++) {
    const value = Number(source[s]);
    // Local fork (2026-11-13): per-stat cap, so a saved HP above 252 (up to 504) survives the load
    evs[s] = Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 0), getEvCap(s as PermanentStat)) : 0;
  }
  return evs;
}

/** Local fork (2026-11-12): whether any of `evs` is above 0 (a save writes `evs` only then) */
export function hasAnyEvs(evs: readonly number[] | undefined): boolean {
  return !!evs?.some(ev => ev > 0);
}

/** Local fork (2026-11-12): the stat points `ev` EVs add in the stat formula: floor(EV / 4) */
export function getEvStatPoints(ev: number | undefined): number {
  return Math.floor((ev ?? 0) / EV_RULES.evsPerStatPoint);
}

/**
 * Local fork (2026-11-12): adds `amount` EVs to `stat`, up to its cap ({@linkcode getEvCap}: 504 for HP since
 * 2026-11-13, 252 for the others)
 * @param evs - The Pokémon's EVs; changed in place
 * @returns Whether the value changed (`false` at the cap)
 */
export function addEvs(evs: number[], stat: PermanentStat, amount: number): boolean {
  const before = evs[stat] ?? 0;
  const after = Math.min(before + amount, getEvCap(stat));
  evs[stat] = after;
  return after !== before;
}
