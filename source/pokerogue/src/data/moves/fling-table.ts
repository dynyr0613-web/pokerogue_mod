/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Local fork (2026-11-20): Fling's (내던지기) power and effect for every held item of the fork, D5 of 1.2.0. The user:
 * "내던지기(도구 선택), 내던지기용 xlsx표도 제작".
 *
 * - Keys are the held item's modifier type id (`LEFTOVERS`, `CHOICE_BAND` ...), with the generated item after a colon
 *   for the generated types (`BERRY:SITRUS`, `ATTACK_TYPE_BOOSTER:FIRE`, `SPECIES_STAT_BOOSTER:LIGHT_BALL`; the rare
 *   and the common species booster share one key). A generated item without its own row uses its type id's row, and an
 *   item the table does not know yet uses {@linkcode FLING_DEFAULT_ENTRY} (`getHeldItemKey` / `getFlingEntry` in
 *   held-item-moves.ts).
 * - Mainline items take their Bulbapedia Fling power (`source: "mainline"`). Fork items get a default by kind
 *   (`source: "fork"`): the power of the mainline item they are modelled on (named in the note); a vessel holding an
 *   orb throws like that orb; anything else 30, the commonest mainline power.
 * - `throwable: false` marks items that cannot be thrown: everything the fork does not let move between Pokémon (form
 *   change items, vitamins, IV candies, the HP belts, Forged Steel, the mystery-encounter items). An item that is not
 *   transferable is never thrown, whatever its row says.
 *
 * The rows between the markers are written by tools/fling/fling_table.py, which also makes the table
 * docs/내던지기_위력표_20261120.xlsx from them and can read an edited xlsx back into this block (see the script header).
 * Keep one row per line in this exact shape so the script can read it.
 */

/** What a thrown item does to the target besides the damage (only on a hit) */
export type FlingEffect = "burn" | "toxic" | "poison" | "paralysis" | "flinch" | "whiteHerb" | "berry";

/** One row of {@linkcode FLING_TABLE} */
export interface FlingEntry {
  /** Fling's power with this item */
  readonly power: number;
  /** The extra effect on the target, if any */
  readonly effect?: FlingEffect;
  /** `false` when the item cannot be thrown at all (default `true`) */
  readonly throwable?: boolean;
  /** Where the power comes from: the main series, or the fork's default by kind */
  readonly source: "mainline" | "fork";
  /** A note for the xlsx (Korean) */
  readonly note?: string;
}

/** The row an item without its own row (a new fork item) uses */
export const FLING_DEFAULT_ENTRY: FlingEntry = Object.freeze({
  power: 30,
  source: "fork",
  note: "표에 없는 도구의 기본값",
});

/** Fling's power and effect by held item key */
// biome-ignore format: one row per line between the markers, the shape tools/fling/fling_table.py reads and writes
export const FLING_TABLE: Readonly<Record<string, FlingEntry>> = Object.freeze({
  // <fling-table:begin> (written by tools/fling/fling_table.py)
  WHITE_HERB: { power: 10, effect: "whiteHerb", source: "mainline" },
  REVIVER_SEED: { power: 10, source: "fork", note: "본가 씨앗류(일렉트릭시드 등) 10" },
  "SPECIES_STAT_BOOSTER:LIGHT_BALL": { power: 30, effect: "paralysis", source: "mainline" },
  "SPECIES_STAT_BOOSTER:THICK_CLUB": { power: 90, source: "mainline" },
  "SPECIES_STAT_BOOSTER:METAL_POWDER": { power: 10, source: "mainline" },
  "SPECIES_STAT_BOOSTER:QUICK_POWDER": { power: 10, source: "mainline" },
  "SPECIES_STAT_BOOSTER:DEEP_SEA_SCALE": { power: 30, source: "mainline" },
  "SPECIES_STAT_BOOSTER:DEEP_SEA_TOOTH": { power: 90, source: "mainline" },
  SPECIES_STAT_BOOSTER: { power: 30, source: "fork", note: "표에 없는 종족 전용 도구의 기본값" },
  "ATTACK_TYPE_BOOSTER:NORMAL": { power: 10, source: "mainline" },
  "ATTACK_TYPE_BOOSTER:FIGHTING": { power: 30, source: "mainline" },
  "ATTACK_TYPE_BOOSTER:FLYING": { power: 50, source: "mainline" },
  "ATTACK_TYPE_BOOSTER:POISON": { power: 70, effect: "poison", source: "mainline" },
  "ATTACK_TYPE_BOOSTER:GROUND": { power: 10, source: "mainline" },
  "ATTACK_TYPE_BOOSTER:ROCK": { power: 100, source: "mainline" },
  "ATTACK_TYPE_BOOSTER:BUG": { power: 10, source: "mainline" },
  "ATTACK_TYPE_BOOSTER:GHOST": { power: 30, source: "mainline" },
  "ATTACK_TYPE_BOOSTER:STEEL": { power: 30, source: "mainline" },
  "ATTACK_TYPE_BOOSTER:FIRE": { power: 30, source: "mainline" },
  "ATTACK_TYPE_BOOSTER:WATER": { power: 30, source: "mainline" },
  "ATTACK_TYPE_BOOSTER:GRASS": { power: 30, source: "mainline" },
  "ATTACK_TYPE_BOOSTER:ELECTRIC": { power: 30, source: "mainline" },
  "ATTACK_TYPE_BOOSTER:PSYCHIC": { power: 30, source: "mainline" },
  "ATTACK_TYPE_BOOSTER:ICE": { power: 30, source: "mainline" },
  "ATTACK_TYPE_BOOSTER:DRAGON": { power: 70, source: "mainline" },
  "ATTACK_TYPE_BOOSTER:DARK": { power: 30, source: "mainline" },
  "ATTACK_TYPE_BOOSTER:FAIRY": { power: 10, source: "mainline" },
  ATTACK_TYPE_BOOSTER: { power: 30, source: "fork", note: "표에 없는 타입 강화 도구의 기본값" },
  "BERRY:SITRUS": { power: 10, effect: "berry", source: "mainline" },
  "BERRY:LUM": { power: 10, effect: "berry", source: "mainline" },
  "BERRY:ENIGMA": { power: 10, effect: "berry", source: "mainline" },
  "BERRY:LIECHI": { power: 10, effect: "berry", source: "mainline" },
  "BERRY:GANLON": { power: 10, effect: "berry", source: "mainline" },
  "BERRY:PETAYA": { power: 10, effect: "berry", source: "mainline" },
  "BERRY:APICOT": { power: 10, effect: "berry", source: "mainline" },
  "BERRY:SALAC": { power: 10, effect: "berry", source: "mainline" },
  "BERRY:LANSAT": { power: 10, effect: "berry", source: "mainline" },
  "BERRY:STARF": { power: 10, effect: "berry", source: "mainline" },
  "BERRY:LEPPA": { power: 10, effect: "berry", source: "mainline" },
  BERRY: { power: 10, effect: "berry", source: "mainline", note: "표에 없는 나무열매의 기본값" },
  MYSTICAL_ROCK: { power: 60, source: "fork", note: "본가 날씨 바위·그라운드코트 60" },
  LUCKY_EGG: { power: 30, source: "mainline" },
  GOLDEN_EGG: { power: 30, source: "fork", note: "행복의알 30" },
  SOOTHE_BELL: { power: 10, source: "mainline" },
  SCOPE_LENS: { power: 30, source: "mainline" },
  LEEK: { power: 60, source: "mainline" },
  EVIOLITE: { power: 40, source: "mainline" },
  RED_EVOLUTION_CRYSTAL: { power: 40, source: "fork", note: "진화의휘석 40" },
  BLUE_EVOLUTION_CRYSTAL: { power: 40, source: "fork", note: "진화의휘석 40" },
  ASSAULT_VEST: { power: 80, source: "mainline" },
  BULLETPROOF_VEST: { power: 80, source: "fork", note: "돌격조끼 80" },
  CHOICE_BAND: { power: 10, source: "mainline" },
  CHOICE_SCARF: { power: 10, source: "mainline" },
  CHOICE_SPECS: { power: 10, source: "mainline" },
  CHOICE_ARMOR: { power: 10, source: "fork", note: "구애 도구 10" },
  LIFE_ORB: { power: 30, source: "mainline" },
  PRISM: { power: 30, source: "fork", note: "기본값" },
  TRAINING_SHACKLES: { power: 130, source: "fork", note: "검은철구 130 (스피드를 깎는 무거운 도구)" },
  ULTIMATE_GENE: { power: 30, source: "fork", note: "기본값" },
  FLAME_CAULDRON: { power: 30, source: "fork", note: "빈 그릇: 구슬 30, 효과 없음" },
  FLAME_FURNACE: { power: 30, effect: "burn", source: "fork", note: "화염구슬이 든 화로: 화염구슬과 같음" },
  TOXIC_DISTILLER: { power: 30, source: "fork", note: "빈 그릇: 구슬 30, 효과 없음" },
  TOXIC_DISTILLATE: { power: 30, effect: "toxic", source: "fork", note: "맹독구슬이 든 증류액: 맹독구슬과 같음" },
  DISCHARGED_COIL: { power: 30, source: "fork", note: "빈 그릇: 구슬 30, 효과 없음" },
  SUPERCONDUCTING_COIL: { power: 30, effect: "paralysis", source: "fork", note: "전기구슬이 든 코일: 전기구슬과 같음" },
  RADIOACTIVE_WASTE: { power: 30, effect: "poison", source: "fork", note: "검은진흙 30, 지니면 독이 되는 도구라 독" },
  PUNCHING_GLOVE: { power: 30, source: "mainline" },
  MASTER_PUNCHING_GLOVE: { power: 30, source: "fork", note: "펀치글러브 30" },
  POWER_HERB: { power: 10, source: "mainline" },
  METRONOME: { power: 30, source: "mainline" },
  LOADED_DICE: { power: 30, source: "mainline" },
  SEED_POUCH: { power: 10, source: "fork", note: "본가 씨앗류 10" },
  FUEL: { power: 30, source: "fork", note: "기본값" },
  EXPERT_BELT: { power: 10, source: "mainline" },
  PRECISION_LENS: { power: 30, source: "fork", note: "초점렌즈 30" },
  CLEAR_AMULET: { power: 30, source: "mainline" },
  BOOSTER_ENERGY: { power: 30, source: "mainline" },
  THROAT_SPRAY: { power: 30, source: "mainline" },
  MUSCLE_BAND: { power: 10, source: "mainline" },
  WISE_GLASSES: { power: 10, source: "mainline" },
  POWER_WEIGHT: { power: 70, source: "mainline" },
  POWER_BRACER: { power: 70, source: "mainline" },
  POWER_BELT: { power: 70, source: "mainline" },
  POWER_LENS: { power: 70, source: "mainline" },
  POWER_BAND: { power: 70, source: "mainline" },
  POWER_ANKLET: { power: 70, source: "mainline" },
  SOUL_DEW: { power: 30, source: "mainline" },
  GOLDEN_PUNCH: { power: 30, source: "fork", note: "펀치글러브 30" },
  GRIP_CLAW: { power: 90, source: "mainline" },
  WIDE_LENS: { power: 10, source: "mainline" },
  MULTI_LENS: { power: 10, source: "fork", note: "줌렌즈 10" },
  FOCUS_BAND: { power: 10, source: "mainline" },
  QUICK_CLAW: { power: 80, source: "mainline" },
  KINGS_ROCK: { power: 30, effect: "flinch", source: "mainline" },
  LEFTOVERS: { power: 10, source: "mainline" },
  SHELL_BELL: { power: 30, source: "mainline" },
  TOXIC_ORB: { power: 30, effect: "toxic", source: "mainline" },
  FLAME_ORB: { power: 30, effect: "burn", source: "mainline" },
  BATON: { power: 30, source: "fork", note: "기본값" },
  MINI_BLACK_HOLE: { power: 30, source: "fork", note: "기본값" },
  BASE_STAT_BOOSTER: { power: 30, throwable: false, source: "mainline", note: "영양제 6종: 이 게임에서는 옮길 수 없음" },
  IV_CANDY: { power: 0, throwable: false, source: "fork", note: "개체값 사탕 6종: 옮길 수 없음" },
  WEIGHT_BAND: { power: 0, throwable: false, source: "fork", note: "옮길 수 없음" },
  CHAMPION_BELT: { power: 0, throwable: false, source: "fork", note: "옮길 수 없음" },
  FORGED_STEEL: { power: 0, throwable: false, source: "fork", note: "옮길 수 없음" },
  EVOLUTION_TRACKER_GIMMIGHOUL: { power: 0, throwable: false, source: "fork", note: "옮길 수 없음" },
  FORM_CHANGE_ITEM: { power: 0, throwable: false, source: "mainline", note: "메가스톤 등 폼체인지 도구 전부: 옮길 수 없음" },
  RARE_FORM_CHANGE_ITEM: { power: 0, throwable: false, source: "mainline", note: "플레이트·메모리 등 폼체인지 도구 전부: 옮길 수 없음" },
  MYSTERY_ENCOUNTER_SHUCKLE_JUICE: { power: 0, throwable: false, source: "fork", note: "이상한 만남 도구: 옮길 수 없음" },
  MYSTERY_ENCOUNTER_OLD_GATEAU: { power: 0, throwable: false, source: "fork", note: "이상한 만남 도구: 옮길 수 없음" },
  MYSTERY_ENCOUNTER_MACHO_BRACE: { power: 60, throwable: false, source: "mainline", note: "이상한 만남 도구: 옮길 수 없음" },
  // <fling-table:end>
});
