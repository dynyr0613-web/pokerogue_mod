/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Local fork (2026-11-16): Z-Moves and Max Moves as a permanent conversion of one move slot. The user:
 * - "다이사탕 사용 시 원하는 기술을 다이 기술로 바꿈 / 해당 포켓몬의 전용기는 거다이 기술로 바꿈 (멜메탈: 불릿펀치 ->
 *   다이스틸, 더블펀처 -> 거다이융격) / 전용기가 없는 거다이 포켓몬은 그냥 거다이맥스 기술의 타입 기술이 거다이 기술로 바뀜"
 * - "z 크리스탈 사용 시 해당 타입 기술을 z기술로 변환 / 전용 z 크리스탈은 해당 타입의 기술을 전용 z기술로 변환"
 * - "거다이 / 전용 z는 적용되지 않음 / z 변화기 + 다이 기술: Z다이월로 이름이 바뀌고 z 변화기의 효과를 받으며 다이월
 *   시전 / 예외 Z다이검무: 공격 랭크 4업 / z + 다이기술: Z다이너클, Z다이스틸 같은 이름이 되며, 위력 200 고정, 방어/판별
 *   등의 효과를 뚫고 1/2 데미지"
 *
 * Design: tools/drive/zmax_1116/design_spec.md (sections 1-4, 7b, 8). A slot keeps its ORIGINAL move id
 * (`PokemonMove.moveId`); `PokemonMove.transform` says what it became, and `PokemonMove.getMove()` returns the derived
 * {@linkcode Move} built here ({@linkcode getTransformedMove}, one cached object per base move + conversion). The derived
 * move is a copy of the registry entry of the Max / G-Max / Z move (`allMoves[transform.moveId]`, which holds its
 * effect), with the slot's numbers: power from the base move's Max / Z power, the base move's category and PP, never
 * missing, priority 0, one target, no contact, and a {@linkcode ProtectPierceAttr} (1/4 through protection, Z다이 1/2
 * also through Max Guard). A Z status move is the base move itself plus its Z-Power ({@linkcode ZPowerAttr}).
 *
 * Which item a slot can take ({@linkcode canSlotTakeItem}, {@linkcode getConversionResult}) follows the table in
 * section 3 of the design; the G-Max rule is section 4 / 7b ({@linkcode getGmaxMoveInfo}).
 */

import { allMoves } from "#data/data-lists";
import type { PokemonSpecies } from "#data/pokemon-species";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import type { PokemonType } from "#enums/pokemon-type";
import { SpeciesFormKey } from "#enums/species-form-key";
import type { Pokemon } from "#field/pokemon";
// The move classes are imported at run time (the attrs a derived move adds). Nothing move.ts imports may import this
// module back (noImportCycles): pokemon.ts, the phases and the UI use it, pokemon-move.ts only through the hook below.
import { type Move, type MoveAttr, ProtectPierceAttr, ZPowerAttr } from "#moves/move";
// Local fork (2026-11-16): `PokemonMove.getMove()` asks this module for derived moves through this hook (it cannot
// import this module: this one imports move.ts, which imports pokemon-move.ts)
import { type PokemonMove, setTransformedMoveResolver } from "#moves/pokemon-move";
import {
  EXCLUSIVE_Z,
  type ExclusiveZInfo,
  GMAX_MOVES,
  type GmaxMoveInfo,
  getMaxMovePower,
  getZMovePower,
  getZStatusEffect,
  isZMaxOnlyMove,
  isZPowerlessStatusMove,
  MAX_MOVE_BY_TYPE,
  Z_MOVE_BY_TYPE,
  ZMAX_RULES,
} from "#moves/zmax-data";
import i18next from "i18next";

/**
 * What a slot was converted into:
 * - `max`: 다이사탕 on a plain move (Max move, Max Guard for a status move, 다이검무 for Swords Dance);
 * - `gmax`: 다이사탕 on a plain attack of a Pokémon that can Gigantamax, by the G-Max rule;
 * - `z`: a type Z crystal on a plain move (Z move, or the base status move with its Z-Power);
 * - `zExclusive`: an exclusive Z crystal on a plain move of its type (status moves too), on the right species;
 * - `zMax`: a type Z crystal on a Max move, or 다이사탕 on a Z move (Z다이너클, Z다이월, Z다이검무).
 */
export type MoveTransformKind = "max" | "gmax" | "z" | "zExclusive" | "zMax";

/** A slot's conversion (saved with the slot as plain data) */
export interface MoveTransform {
  kind: MoveTransformKind;
  /** The move the slot behaves as (the base move's own id for a Z status move) */
  moveId: MoveId;
}

/** The item being used on a slot: 다이사탕, a type Z crystal, or an exclusive Z crystal (`EXCLUSIVE_Z[].key`) */
export type ConversionItem =
  | { kind: "candy" }
  | { kind: "zType"; type: PokemonType }
  | { kind: "zExclusive"; key: string };

/**
 * Local fork (2026-11-16): the numbers of converted moves (design sections 2 and 7b), read from `ZMAX_RULES`
 * (zmax-data.ts) so each number has one source
 */
export const MOVE_TRANSFORM_RULES = Object.freeze({
  /** A plain Max / G-Max / Z / exclusive Z attack goes through a protection for this share of its damage (main games) */
  plainProtectPierce: ZMAX_RULES.protectPierceMultiplier,
  /** The user: "z + 다이기술: Z다이너클, Z다이스틸 같은 이름이 되며, 위력 200 고정, 방어/판별 등의 효과를 뚫고 1/2 데미지" */
  zMaxPower: ZMAX_RULES.zMaxPower,
  zMaxProtectPierce: ZMAX_RULES.zMaxProtectPierceMultiplier,
  /** The user: "예외 Z다이검무: 공격 랭크 4업" (다이검무 itself is +3, in its registry entry) */
  zMaxSwordsDanceStages: ZMAX_RULES.zMaxSwordsDanceStages,
});

/**
 * Local fork (2026-11-19): the Max moves, Max Guard and G-Max moves whose animation files were rebuilt from the Complete
 * FireRed Upgrade scripts (Skeli and the CFRU team) by `D:/PokeRogueDev/tools/port/cfru_max/maxanim.py` (one spec per
 * move in `tools/port/cfru_max/specs`). CFRU gives these 38 their own animation (33 own bodies, 5 recolours of a Max
 * body); the other 14 G-Max moves reuse another animation there, see {@linkcode GMAX_ANIM_ALIASES}. A Z다이 slot keeps
 * its Max move's id, so a Z다이 attack / Z다이월 plays the Max move's file.
 */
export const CFRU_MAX_ANIM_MOVES: readonly MoveId[] = Object.freeze([
  MoveId.MAX_GUARD,
  MoveId.MAX_STRIKE,
  MoveId.MAX_KNUCKLE,
  MoveId.MAX_AIRSTREAM,
  MoveId.MAX_OOZE,
  MoveId.MAX_QUAKE,
  MoveId.MAX_ROCKFALL,
  MoveId.MAX_FLUTTERBY,
  MoveId.MAX_PHANTASM,
  MoveId.MAX_STEELSPIKE,
  MoveId.MAX_FLARE,
  MoveId.MAX_GEYSER,
  MoveId.MAX_OVERGROWTH,
  MoveId.MAX_LIGHTNING,
  MoveId.MAX_MINDSTORM,
  MoveId.MAX_HAILSTORM,
  MoveId.MAX_WYRMWIND,
  MoveId.MAX_DARKNESS,
  MoveId.MAX_STARFALL,
  MoveId.G_MAX_WILDFIRE,
  MoveId.G_MAX_GOLD_RUSH,
  MoveId.G_MAX_TERROR,
  MoveId.G_MAX_RESONANCE,
  MoveId.G_MAX_CUDDLE,
  MoveId.G_MAX_REPLENISH,
  MoveId.G_MAX_MALODOR,
  MoveId.G_MAX_STUN_SHOCK,
  MoveId.G_MAX_DEPLETION,
  MoveId.G_MAX_GRAVITAS,
  MoveId.G_MAX_SANDBLAST,
  MoveId.G_MAX_SNOOZE,
  MoveId.G_MAX_TARTNESS,
  MoveId.G_MAX_SMITE,
  MoveId.G_MAX_STEELSURGE,
  MoveId.G_MAX_MELTDOWN,
  MoveId.G_MAX_FOAM_BURST,
  MoveId.G_MAX_VINE_LASH,
  MoveId.G_MAX_CANNONADE,
]);

/**
 * Local fork (2026-11-19): the G-Max moves that CFRU animates with another move's script (a pure `goto`): ten with a
 * Max move's (or G-Max Tartness's), four with a regular move's that upstream PokeRogue already has.
 */
export const GMAX_ANIM_ALIASES: ReadonlyMap<MoveId, MoveId> = new Map([
  [MoveId.G_MAX_BEFUDDLE, MoveId.MAX_FLUTTERBY],
  [MoveId.G_MAX_VOLT_CRASH, MoveId.MAX_LIGHTNING],
  [MoveId.G_MAX_CHI_STRIKE, MoveId.MAX_KNUCKLE],
  [MoveId.G_MAX_STONESURGE, MoveId.MAX_GEYSER],
  [MoveId.G_MAX_WIND_RAGE, MoveId.MAX_AIRSTREAM],
  [MoveId.G_MAX_FINALE, MoveId.MAX_STARFALL],
  [MoveId.G_MAX_VOLCALITH, MoveId.MAX_ROCKFALL],
  [MoveId.G_MAX_SWEETNESS, MoveId.G_MAX_TARTNESS],
  [MoveId.G_MAX_CENTIFERNO, MoveId.MAX_FLARE],
  [MoveId.G_MAX_ONE_BLOW, MoveId.MAX_DARKNESS],
  [MoveId.G_MAX_DRUM_SOLO, MoveId.DRUM_BEATING],
  [MoveId.G_MAX_FIREBALL, MoveId.PYRO_BALL],
  [MoveId.G_MAX_HYDROSNIPE, MoveId.SNIPE_SHOT],
  [MoveId.G_MAX_RAPID_FLOW, MoveId.AQUA_JET],
]);

/**
 * Local fork (2026-11-18): the Z / exclusive Z / Max / G-Max moves that have their own animation file in
 * `assets/battle-anims` (the user: "Z-다이 전용 전투 에니메이션은 아마 자료가 에센셜용으로 꽤 많이 있을거라 그걸 얻어오면
 * 되고"). Upstream had six exclusive Z ones (Catastropika ... Light That Burns the Sky); the others were converted from
 * the Pokémon Reborn (PRAS) animations in the user's Essentials v21.1 project by
 * `D:/PokeRogueDev/tools/port/essentials_anims.py`. 10,000,000 Volt Thunderbolt, every Max and G-Max move and Max Guard
 * have no animation there (Essentials' "Max Moves" section is empty), so they keep the fallbacks of
 * {@linkcode getAnimMoveId}. A test checks this list against the files.
 * Local fork (2026-11-19): plus the Max / G-Max / Max Guard animations rebuilt from Complete FireRed Upgrade (Skeli and
 * the CFRU team; the user: "CFRU 받아서 만들기"): {@linkcode CFRU_MAX_ANIM_MOVES}.
 * Local fork (2026-11-19): plus 다이검무 (Z다이검무 keeps its id, so it plays it too): Swords Dance's animation with its
 * swords recoloured Dynamax red and drawn x1.5 (the user: "e1 칼춤 모션 색깔 / 크기 변경으로 제작").
 */
export const ZMAX_OWN_ANIM_MOVES: ReadonlySet<MoveId> = new Set([
  // Z moves (one Essentials animation for both MoveIds of a type)
  MoveId.BREAKNECK_BLITZ__PHYSICAL,
  MoveId.BREAKNECK_BLITZ__SPECIAL,
  MoveId.ALL_OUT_PUMMELING__PHYSICAL,
  MoveId.ALL_OUT_PUMMELING__SPECIAL,
  MoveId.SUPERSONIC_SKYSTRIKE__PHYSICAL,
  MoveId.SUPERSONIC_SKYSTRIKE__SPECIAL,
  MoveId.ACID_DOWNPOUR__PHYSICAL,
  MoveId.ACID_DOWNPOUR__SPECIAL,
  MoveId.TECTONIC_RAGE__PHYSICAL,
  MoveId.TECTONIC_RAGE__SPECIAL,
  MoveId.CONTINENTAL_CRUSH__PHYSICAL,
  MoveId.CONTINENTAL_CRUSH__SPECIAL,
  MoveId.SAVAGE_SPIN_OUT__PHYSICAL,
  MoveId.SAVAGE_SPIN_OUT__SPECIAL,
  MoveId.NEVER_ENDING_NIGHTMARE__PHYSICAL,
  MoveId.NEVER_ENDING_NIGHTMARE__SPECIAL,
  MoveId.CORKSCREW_CRASH__PHYSICAL,
  MoveId.CORKSCREW_CRASH__SPECIAL,
  MoveId.INFERNO_OVERDRIVE__PHYSICAL,
  MoveId.INFERNO_OVERDRIVE__SPECIAL,
  MoveId.HYDRO_VORTEX__PHYSICAL,
  MoveId.HYDRO_VORTEX__SPECIAL,
  MoveId.BLOOM_DOOM__PHYSICAL,
  MoveId.BLOOM_DOOM__SPECIAL,
  MoveId.GIGAVOLT_HAVOC__PHYSICAL,
  MoveId.GIGAVOLT_HAVOC__SPECIAL,
  MoveId.SHATTERED_PSYCHE__PHYSICAL,
  MoveId.SHATTERED_PSYCHE__SPECIAL,
  MoveId.SUBZERO_SLAMMER__PHYSICAL,
  MoveId.SUBZERO_SLAMMER__SPECIAL,
  MoveId.DEVASTATING_DRAKE__PHYSICAL,
  MoveId.DEVASTATING_DRAKE__SPECIAL,
  MoveId.BLACK_HOLE_ECLIPSE__PHYSICAL,
  MoveId.BLACK_HOLE_ECLIPSE__SPECIAL,
  MoveId.TWINKLE_TACKLE__PHYSICAL,
  MoveId.TWINKLE_TACKLE__SPECIAL,
  // Exclusive Z moves (upstream's six first)
  MoveId.CATASTROPIKA,
  MoveId.SINISTER_ARROW_RAID,
  MoveId.OCEANIC_OPERETTA,
  MoveId.PULVERIZING_PANCAKE,
  MoveId.EXTREME_EVOBOOST,
  MoveId.LIGHT_THAT_BURNS_THE_SKY,
  MoveId.MALICIOUS_MOONSAULT,
  MoveId.GUARDIAN_OF_ALOLA,
  MoveId.SOUL_STEALING_7_STAR_STRIKE,
  MoveId.STOKED_SPARKSURFER,
  MoveId.GENESIS_SUPERNOVA,
  MoveId.SEARING_SUNRAZE_SMASH,
  MoveId.MENACING_MOONRAZE_MAELSTROM,
  MoveId.LETS_SNUGGLE_FOREVER,
  MoveId.SPLINTERED_STORMSHARDS,
  MoveId.CLANGOROUS_SOULBLAZE,
  // Local fork (2026-11-19): the CFRU Max / G-Max / Max Guard animations
  ...CFRU_MAX_ANIM_MOVES,
  // Local fork (2026-11-19): 다이검무 / Z다이검무, Swords Dance's motion in Dynamax red at x1.5 (max-swords-dance.json)
  MoveId.MAX_SWORDS_DANCE,
]);

/** The Gigantamax form keys (Eternamax is not one: Eternatus has no G-Max move) */
const GMAX_FORM_KEYS: readonly string[] = Object.freeze([
  SpeciesFormKey.GIGANTAMAX,
  SpeciesFormKey.GIGANTAMAX_SINGLE,
  SpeciesFormKey.GIGANTAMAX_RAPID,
]);

/**
 * The parts of {@linkcode Move} a derived copy rewrites. Most are TS-private on `Move` (ordinary properties at run
 * time), which is why the copy goes through this view instead of the public builders (`makesContact(false)` would XOR
 * contact back on).
 */
interface MoveInternals {
  name: string;
  effect: string;
  power: number;
  accuracy: number;
  pp: number;
  priority: number;
  moveTarget: MoveTarget;
  attrs: MoveAttr[];
  _category: MoveCategory;
  flags: number;
  conditions: unknown[];
  conditionsSeq2: unknown[];
  conditionsSeq3: unknown[];
  restrictions: unknown[];
  nameAppend: string;
  isUnimplemented: boolean;
}

/** What a derived move was made from */
interface DerivedInfo {
  readonly baseId: MoveId;
  readonly transform: Readonly<MoveTransform>;
}

/**
 * Derived moves by `${language}:${baseId}:${kind}:${moveId}` (one object each: Pledge moves compare Move objects). The
 * language is part of the key because a derived move's name is built once (a language switch builds new ones).
 */
const derivedCache = new Map<string, Move>();
/** The base move and conversion of every derived move */
const derivedInfo = new WeakMap<Move, DerivedInfo>();

function internals(move: Move): MoveInternals {
  return move as unknown as MoveInternals;
}

/** A shallow copy of `src` with its own attr / condition / restriction lists (the attrs themselves are shared) */
function cloneMove(src: Move): Move {
  const copy = Object.create(Object.getPrototypeOf(src)) as Move;
  Object.assign(copy, src);
  const from = internals(src);
  const to = internals(copy);
  to.attrs = from.attrs.slice();
  to.conditions = from.conditions.slice();
  to.conditionsSeq2 = from.conditionsSeq2.slice();
  to.conditionsSeq3 = from.conditionsSeq3.slice();
  to.restrictions = from.restrictions.slice();
  return copy;
}

/** Remove the " (N)" an unimplemented registry entry carries */
function stripUnimplemented(text: string): string {
  return text.replaceAll(" (N)", "");
}

/** Add `baseId`'s Z-Power (Showdown `zMove` effect, or the fork's proposal) to `move`, if it has one */
function addZPower(move: Move, baseId: MoveId): void {
  const zEffect = getZStatusEffect(baseId);
  if (zEffect) {
    move.addAttr(new ZPowerAttr(zEffect));
  }
}

/** The G-Max move info for a G-Max move id, or `undefined` */
function findGmaxInfoByMove(moveId: MoveId): GmaxMoveInfo | undefined {
  return Object.values(GMAX_MOVES).find(info => info.move === moveId);
}

/** The power of an attacking derived move */
function getDerivedPower(baseId: MoveId, t: MoveTransform, src: Move): number {
  switch (t.kind) {
    case "max":
      return getMaxMovePower(baseId);
    case "gmax":
      return findGmaxInfoByMove(t.moveId)?.fixedPower ?? getMaxMovePower(baseId);
    case "z":
      return getZMovePower(baseId);
    case "zMax":
      return MOVE_TRANSFORM_RULES.zMaxPower;
    default:
      // Exclusive Z moves keep their main-game power (registry entry)
      return src.power;
  }
}

/**
 * Finish a derived status move copied from its registry entry (Max Guard, 다이검무, Extreme Evoboost): a Z다이 one is
 * named "Z" + the Max move and gets the base move's Z-Power (Z다이월), or Atk +4 instead of +3 (Z다이검무, no other
 * bonus).
 */
function finishStatusMove(move: Move, baseId: MoveId, t: MoveTransform, srcName: string): void {
  const w = internals(move);
  if (t.kind !== "zMax") {
    w.name = srcName;
    return;
  }
  if (t.moveId === MoveId.MAX_SWORDS_DANCE) {
    w.attrs = w.attrs.map(attr => {
      if (!attr.is("StatStageChangeAttr") || !attr.selfTarget) {
        return attr;
      }
      const stronger = Object.assign(Object.create(Object.getPrototypeOf(attr)), attr);
      stronger.stages = MOVE_TRANSFORM_RULES.zMaxSwordsDanceStages;
      return stronger;
    });
    // Local fork (2026-11-18): its own description, which says +4 (다이검무's says +3)
    move.effect = i18next.t("battle:zMaxSwordsDanceEffect");
  } else {
    addZPower(move, baseId);
  }
  w.name = i18next.t("battle:zMaxMoveName", { moveName: srcName });
}

/**
 * Finish a derived attack copied from its registry entry (Max / G-Max / Z / exclusive Z / Z다이): the base move's
 * category (exclusive Z moves keep theirs), its Max / Z power, never missing, priority 0, one target, no contact, and
 * the protection piercing (1/4; Z다이 1/2 through Max Guard too).
 */
function finishAttackMove(move: Move, base: Move, t: MoveTransform, src: Move, srcName: string): void {
  const w = internals(move);
  if (t.kind !== "zExclusive" && base.category !== MoveCategory.STATUS) {
    w._category = base.category;
  }
  w.power = getDerivedPower(base.id, t, src);
  w.accuracy = -1;
  w.priority = 0;
  w.moveTarget = MoveTarget.NEAR_ENEMY;
  w.flags &= ~MoveFlags.MAKES_CONTACT;
  if (t.kind === "zMax") {
    w.attrs = w.attrs.filter(attr => !attr.is("ProtectPierceAttr"));
    move.addAttr(new ProtectPierceAttr(MOVE_TRANSFORM_RULES.zMaxProtectPierce, true));
    w.name = i18next.t("battle:zMaxMoveName", { moveName: srcName });
    return;
  }
  if (!move.hasAttr("ProtectPierceAttr")) {
    move.addAttr(new ProtectPierceAttr(MOVE_TRANSFORM_RULES.plainProtectPierce, false));
  }
  w.name = srcName;
}

/**
 * Build the derived move of `baseId` converted by `t`, or `null` if a needed registry entry is missing.
 * @see {@linkcode getTransformedMove}
 */
function buildTransformedMove(baseId: MoveId, t: MoveTransform): Move | null {
  const base = allMoves[baseId];
  const isZStatus = t.kind === "z" && t.moveId === baseId;
  const src = isZStatus ? base : allMoves[t.moveId];
  if (!base || !src) {
    return null;
  }

  const move = cloneMove(src);
  const w = internals(move);
  w.isUnimplemented = false;
  w.nameAppend = stripUnimplemented(w.nameAppend);
  w.effect = stripUnimplemented(src.effect);
  // "Converted moves ... spend the base move's PP (PP Ups kept)"
  w.pp = base.pp;
  const srcName = stripUnimplemented(src.name);

  if (isZStatus) {
    // Z status move: the base move with its Z-Power first, named "Z" + the base move (Z칼춤)
    addZPower(move, baseId);
    w.name = i18next.t("battle:zMoveStatusName", { moveName: srcName });
  } else if (src.category === MoveCategory.STATUS) {
    finishStatusMove(move, baseId, t, srcName);
  } else {
    finishAttackMove(move, base, t, src, srcName);
  }
  return move;
}

/**
 * The move a slot of `baseId` behaves as under the conversion `t` (cached: the same object every time for the same
 * base move and conversion). If a registry entry is missing, the base move is returned (and not cached).
 * @param baseId - The slot's original move
 * @param t - The slot's conversion
 */
export function getTransformedMove(baseId: MoveId, t: MoveTransform): Move {
  const key = `${i18next.language}:${baseId}:${t.kind}:${t.moveId}`;
  const cached = derivedCache.get(key);
  if (cached) {
    return cached;
  }
  const built = buildTransformedMove(baseId, t);
  if (!built) {
    console.warn(`getTransformedMove: no registry entry for ${MoveId[baseId]} -> ${t.kind} ${MoveId[t.moveId]}`);
    return allMoves[baseId];
  }
  derivedCache.set(key, built);
  derivedInfo.set(built, Object.freeze({ baseId, transform: Object.freeze({ kind: t.kind, moveId: t.moveId }) }));
  return built;
}

/** @returns Whether `move` is the derived move of a converted slot */
export function isTransformedMove(move: Move): boolean {
  return derivedInfo.has(move);
}

/** @returns The slot's original move id for a derived move, else `move.id` (what move history records) */
export function getBaseMoveId(move: Move): MoveId {
  return derivedInfo.get(move)?.baseId ?? move.id;
}

/** @returns The conversion a derived move was built from, or `undefined` for any other move */
export function getMoveTransform(move: Move): Readonly<MoveTransform> | undefined {
  return derivedInfo.get(move)?.transform;
}

/**
 * The move id whose battle animation `move` plays.
 * Local fork (2026-11-18): a Z / exclusive Z / Max / G-Max move plays its own animation when `assets/battle-anims`
 * has one ({@linkcode ZMAX_OWN_ANIM_MOVES}: every Z move and every exclusive Z move but 10,000,000 Volt Thunderbolt);
 * a Z다이 attack is a copy of its Max move, so it plays that Max move's once there is one. Otherwise: Protect for Max
 * Guard / Z다이월, Swords Dance for 다이검무 / Z다이검무, the base move's for Max / G-Max / Z다이 attacks (no Max
 * animations yet), the base move for a Z status move; `move.id` for every other move. A Z / Max / G-Max registry
 * entry used outside a converted slot (no base move known) and without its own file plays Tackle, the default
 * `initMoveAnim` would fall back to, without fetching a file that is not there (the offline app counts 404s).
 * Local fork (2026-11-19): every Max move, Max Guard and 19 G-Max moves now have their own file (CFRU, see
 * {@linkcode CFRU_MAX_ANIM_MOVES}), and the other 14 G-Max moves play the animation CFRU gives them
 * ({@linkcode GMAX_ANIM_ALIASES}); so only 다이검무 / Z다이검무 (Swords Dance), 10,000,000 Volt Thunderbolt and Z status
 * moves still use the fallbacks below.
 * Local fork (2026-11-19): 다이검무 / Z다이검무 have their own file too now (Swords Dance's motion recoloured and x1.5;
 * the user: "e1 칼춤 모션 색깔 / 크기 변경으로 제작"), so their Swords Dance fallback is gone: only 10,000,000 Volt
 * Thunderbolt and Z status moves are left.
 */
export function getAnimMoveId(move: Move): MoveId {
  if (ZMAX_OWN_ANIM_MOVES.has(move.id)) {
    return move.id;
  }
  const alias = GMAX_ANIM_ALIASES.get(move.id);
  if (alias !== undefined) {
    return alias;
  }
  if (move.id === MoveId.MAX_GUARD) {
    return MoveId.PROTECT;
  }
  const baseId = derivedInfo.get(move)?.baseId;
  if (baseId !== undefined) {
    return baseId;
  }
  return isZMaxOnlyMove(move.id) ? MoveId.TACKLE : move.id;
}

/**
 * The move `pokemon` uses for `moveId`: its slot's derived move if a slot holds `moveId` (Transform's / Mimic's
 * moveset included), else `allMoves[moveId]`.
 */
export function getSlotMove(pokemon: Pokemon, moveId: MoveId): Move {
  return (
    pokemon
      .getMoveset()
      .find(m => m.moveId === moveId)
      ?.getMove() ?? allMoves[moveId]
  );
}

/**
 * The move a history record stands for: `user`'s slot of `baseId` when it was used converted (`derivedMoveId`), so
 * its own properties count (a contact attack made a Max move does not make contact any more), else
 * `allMoves[derivedMoveId ?? baseId]`.
 */
export function getRecordedMove(user: Pokemon | undefined, baseId: MoveId, derivedMoveId?: MoveId): Move {
  if (derivedMoveId === undefined || derivedMoveId === baseId) {
    return allMoves[baseId];
  }
  const slotMove = user?.getMoveset().find(m => m.moveId === baseId && m.transform?.moveId === derivedMoveId);
  return slotMove?.getMove() ?? allMoves[derivedMoveId] ?? allMoves[baseId];
}

/** @returns Whether `id` can be a slot's base move at all (not NONE / Struggle / a Max or Z move itself) */
function isConvertibleBase(id: MoveId): boolean {
  return (
    id !== MoveId.NONE
    && id !== MoveId.STRUGGLE
    && !isZMaxOnlyMove(id)
    && !!allMoves[id]
    && !allMoves[id].isUnimplemented
  );
}

/**
 * Whether `slot` can take `item`, from the slot's state and its base move's type only (design section 3); the species
 * rules (G-Max, exclusive crystals) are in {@linkcode getConversionResult}.
 *
 * | slot | 다이사탕 | type Z crystal (T) | exclusive Z crystal (T) |
 * |---|---|---|---|
 * | plain | yes | base type T | base type T |
 * | max: Max attack | G-Max upgrade only | base type T | no |
 * | max: Max Guard, 다이검무 | no | base type T | no |
 * | gmax, zExclusive, zMax | no | no | no |
 * | z | yes (Z다이) | no | base type T (upgrade) |
 * | Sketch, any state | no | no | no |
 * | plain status move without Z-Power (F1 Q9) | yes | no | no |
 *
 * Local fork (2026-11-16), review fix: an exclusive crystal converts any move of its type, status moves included (the
 * user: "전용 z 크리스탈은 해당 타입의 기술을 전용 z기술로 변환", the same "해당 타입 기술" a type crystal reads as
 * every move of the type), so Kommo-o's Clangorous Soul + Kommonium Z gives Clangorous Soulblaze.
 *
 * Local fork (2026-11-20), F1 Q2 (the user: "전용 z를 쓸수 있거나 거다이 포켓몬인 경우 허용"): a slot converted early
 * can be upgraded by an item: an exclusive crystal turns a type Z-Move of its type into the exclusive Z-Move (the
 * species check is {@linkcode getConversionResult}'s), and 다이사탕 turns a Max attack into the G-Max move when the
 * Pokémon's G-Max rule gives one for that slot (else nothing: {@linkcode getCandyResult}). Nothing is ever downgraded
 * (Q4 "지금처럼").
 * Local fork (2026-11-20), F1 Q8 (the user: "막는다"): Sketch takes no item. Z스케치 was gone after one use (the slot
 * becomes the sketched move) and 다이사탕 made Sketch a Max Guard for good.
 */
export function canSlotTakeItem(slot: PokemonMove, item: ConversionItem): boolean {
  if (!isConvertibleBase(slot.moveId) || slot.moveId === MoveId.SKETCH) {
    return false;
  }
  const base = allMoves[slot.moveId];
  const state = slot.transform?.kind ?? "plain";
  if (item.kind === "candy") {
    // A Max attack only for the G-Max upgrade (Q2); Max Guard and 다이검무 never become G-Max moves
    return state === "plain" || state === "z" || (state === "max" && base.category !== MoveCategory.STATUS);
  }
  // Local fork (2026-11-20), F1 Q9 (the user: "뺀다"): a plain status move without Z-Power takes no crystal, type or
  // exclusive (a type crystal only renamed it); made a Max Guard first, it still takes its type's crystal (Z다이)
  if (state === "plain" && isZPowerlessStatusMove(slot.moveId)) {
    return false;
  }
  if (item.kind === "zType") {
    return (state === "plain" || state === "max") && base.type === item.type;
  }
  const info = getExclusiveZInfo(item.key);
  // A type Z-Move of the crystal's type can be upgraded (Q2)
  return (state === "plain" || state === "z") && !!info && base.type === info.type;
}

/** The exclusive crystal with this key */
function getExclusiveZInfo(key: string): ExclusiveZInfo | undefined {
  return EXCLUSIVE_Z.find(info => info.key === key);
}

/** The Max move slot of a status move: 다이검무 for Swords Dance (the user: "칼춤의 다이기술"), else Max Guard */
function getMaxStatusMove(baseId: MoveId): MoveId {
  return baseId === MoveId.SWORDS_DANCE ? MoveId.MAX_SWORDS_DANCE : MoveId.MAX_GUARD;
}

/**
 * What `slot` of `pokemon` becomes with `item`, or `null` if it cannot take it (design sections 3 and 4).
 * - 다이사탕 on a plain status move: Max Guard (다이검무 for Swords Dance); on a plain attack: the G-Max move when the
 *   G-Max rule picks it, else the Max move of the base type; on a Z move: the Z다이 move (G-Max never).
 * - Type crystal on a plain status move: the Z status move (base id); on a plain attack: the type's Z move by the base
 *   category; on a Max move (Max Guard and 다이검무 too): the Z다이 move.
 * - Exclusive crystal: the exclusive Z move, if `pokemon` is (or is fused with) its species.
 * Local fork (2026-11-20), F1 Q2 upgrades: 다이사탕 on a Max attack gives the G-Max move when the G-Max rule picks the
 * slot, else `null`; an exclusive crystal on a type Z-Move of its type gives the exclusive Z move (same species rule).
 */
export function getConversionResult(pokemon: Pokemon, slot: PokemonMove, item: ConversionItem): MoveTransform | null {
  if (!canSlotTakeItem(slot, item)) {
    return null;
  }
  switch (item.kind) {
    case "candy":
      return getCandyResult(pokemon, slot);
    case "zType":
      return getZCrystalResult(slot);
    default: {
      const info = getExclusiveZInfo(item.key);
      if (!info || !isExclusiveZEligibleSpecies(pokemon, item.key)) {
        return null;
      }
      return { kind: "zExclusive", moveId: info.zMove };
    }
  }
}

/**
 * 다이사탕 on a slot that can take it (plain or Z; a Max attack only for the G-Max upgrade, local fork 2026-11-20, F1
 * Q2: "거다이 포켓몬인 경우 허용")
 */
function getCandyResult(pokemon: Pokemon, slot: PokemonMove): MoveTransform | null {
  const base = allMoves[slot.moveId];
  const fromZ = slot.transform?.kind === "z";
  const fromMax = slot.transform?.kind === "max";
  if (base.category === MoveCategory.STATUS) {
    return fromMax ? null : { kind: fromZ ? "zMax" : "max", moveId: getMaxStatusMove(slot.moveId) };
  }
  const maxMove = MAX_MOVE_BY_TYPE[base.type];
  if (maxMove === undefined) {
    return null;
  }
  if (fromZ) {
    return { kind: "zMax", moveId: maxMove };
  }
  const gmax = getGmaxMoveInfo(pokemon);
  if (gmax && (gmax.signature === undefined ? base.type === gmax.type : slot.moveId === gmax.signature)) {
    return { kind: "gmax", moveId: gmax.move };
  }
  // A Max attack has nothing to become but its G-Max move
  return fromMax ? null : { kind: "max", moveId: maxMove };
}

/** A type Z crystal on a slot that can take it (plain or Max) */
function getZCrystalResult(slot: PokemonMove): MoveTransform | null {
  if (slot.transform?.kind === "max") {
    // A Max move, Max Guard or 다이검무 becomes its Z다이 version (same id)
    return { kind: "zMax", moveId: slot.transform.moveId };
  }
  const base = allMoves[slot.moveId];
  if (base.category === MoveCategory.STATUS) {
    return { kind: "z", moveId: slot.moveId };
  }
  const zMoves = Z_MOVE_BY_TYPE[base.type];
  if (!zMoves) {
    return null;
  }
  return { kind: "z", moveId: base.category === MoveCategory.SPECIAL ? zMoves.special : zMoves.physical };
}

/** Whether `species` in form `formKey` matches one of the exclusive crystal's species entries */
function matchesExclusiveSpecies(
  info: ExclusiveZInfo,
  species: PokemonSpecies | null,
  formKey: string | null,
): boolean {
  if (!species) {
    return false;
  }
  return info.species.some(
    s => s.speciesId === species.speciesId && (s.formKeys === undefined || s.formKeys.includes(formKey ?? "")),
  );
}

/** Whether `pokemon` (its head species, or its fusion tail) can use the exclusive crystal `key` */
export function isExclusiveZEligibleSpecies(pokemon: Pokemon, key: string): boolean {
  const info = getExclusiveZInfo(key);
  if (!info) {
    return false;
  }
  return (
    matchesExclusiveSpecies(info, pokemon.species, pokemon.getFormKey())
    || matchesExclusiveSpecies(info, pokemon.fusionSpecies, pokemon.getFusionFormKey())
  );
}

/**
 * The G-Max move of `species` if it has a Gigantamax form (species-level, design 7b: a Mega Melmetal still gets
 * 거다이융격); Urshifu picks single / rapid by its current style.
 */
function getSpeciesGmaxInfo(species: PokemonSpecies | null, formKey: string | null): GmaxMoveInfo | null {
  if (!species) {
    return null;
  }
  const gmaxKeys = species.forms.map(f => f.formKey).filter(k => GMAX_FORM_KEYS.includes(k));
  if (gmaxKeys.length === 0) {
    return null;
  }
  const isRapid = (formKey ?? "").includes("rapid");
  const gmaxKey = gmaxKeys.find(k => k.includes("rapid") === isRapid) ?? gmaxKeys[0];
  return GMAX_MOVES[`${species.speciesId}:${gmaxKey}`] ?? null;
}

/**
 * The G-Max move info that applies to `pokemon`: its head species' if that species can Gigantamax, else its fusion
 * tail's; `null` if neither can.
 */
export function getGmaxMoveInfo(pokemon: Pokemon): GmaxMoveInfo | null {
  return (
    getSpeciesGmaxInfo(pokemon.species, pokemon.getFormKey())
    ?? getSpeciesGmaxInfo(pokemon.fusionSpecies, pokemon.getFusionFormKey())
  );
}

/**
 * Local fork (2026-11-20), F1 Q3 (the user: "잊을 때 경고"): the warning shown before a converted slot is forgotten,
 * e.g. "다이썬더는 다이 기술로 바뀌어 있다! 잊으면 변환도 사라진다." (a forgotten conversion is gone for good: a
 * Memory Mushroom teaches the plain move back), or `null` for a plain slot. The forget flows ask yes / no after it:
 * LearnMovePhase (level-up, TM, Memory Mushroom, egg moves, encounters, a splice's tail moves) and the summary's
 * "기술 잊기".
 */
export function getConvertedMoveForgetWarning(slot: PokemonMove | undefined): string | null {
  if (!slot?.transform) {
    return null;
  }
  return i18next.t("battle:convertedMoveForgetWarning", {
    moveName: slot.getName(),
    kindName: i18next.t(`battle:convertedMoveKind.${slot.transform.kind}`),
  });
}

// Local fork (2026-11-16): hand the derived-move builder to `PokemonMove.getMove()` (see the import above)
setTransformedMoveResolver(getTransformedMove);
