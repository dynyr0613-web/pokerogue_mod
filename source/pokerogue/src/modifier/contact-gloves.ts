/**
 * Local fork (2026-11-11): the battle rules of the Punching Glove (펀치글러브) and the Master Punching Glove (마스터
 * 펀치글러브). The user: "펀치글러브(하이퍼, 주먹류 기술 데미지 1.1배 + 비접촉(단단한발톱의 보너스는 받는데 킬가르도가 쓰는
 * 킹실드의 공격 랭크하락 효과는 안받도록 코드를 잘 짜봐요), 최대 1개)" and "마스터 펀치글러브(마스터, … 모든 접촉기에게
 * 비접촉 판정 추가(펀치글러브와 비슷) + 1.2배 위력 + 보이지않는주먹 효과(포챔스 기준))".
 *
 * The contact split: a covered move still makes contact for everything that works FOR its user (Tough Claws, Poison
 * Touch, Unseen Fist's protection bypass, …), but not for anything the TARGET's side does because it was touched (its
 * ability, its protection move, a tag on it). Those callers pass `targetSide: true` to `Move.doesFlagEffectApply`, which
 * asks {@linkcode hidesContactFromTarget}; every other contact check is left as it was.
 *
 * This module imports nothing from the modifier or move modules at run time: `Move.doesFlagEffectApply` and
 * `Pokemon.getAttackDamage` call it, and the glove classes (custom-held-items.ts) carry the
 * {@linkcode ContactGloveItem.contactGlove} marker so no `instanceof` is needed here (the Choice lock's tag avoids those
 * imports the same way).
 */

import { MoveFlags } from "#enums/move-flags";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { type NumberHolder, toDmgValue } from "#utils/common";

/** Which glove a holder has: `"plain"` (펀치글러브) or `"master"` (마스터 펀치글러브) */
export type ContactGloveKind = "plain" | "master";

/**
 * Local fork (2026-11-11): every number of the two gloves.
 * - `maxHeld`: how many one Pokémon can hold (the user: "최대 1개");
 * - `poolWeight`: the player's reward pool weight (ULTRA / MASTER) while some party member could use it
 *   (init-modifier-pools.ts);
 * - `powerTenths`: the covered moves' power in tenths (11 = x1.1), applied as `power * tenths / 10` like the fork's
 *   other exact multipliers;
 * - the Master glove's `protectDamageMultiplier`: a contact move that goes through a protection move deals 1/4
 *   (Pokémon Champions' Unseen Fist, as the fork's own Unseen Fist does).
 */
export const CONTACT_GLOVES = Object.freeze({
  PUNCHING_GLOVE: Object.freeze({ kind: "plain" as ContactGloveKind, maxHeld: 1, poolWeight: 6, powerTenths: 11 }),
  MASTER_PUNCHING_GLOVE: Object.freeze({
    kind: "master" as ContactGloveKind,
    maxHeld: 1,
    poolWeight: 8,
    powerTenths: 12,
    protectDamageMultiplier: 0.25,
  }),
});

/** Local fork (2026-11-11): the marker a glove's modifier carries (see `PunchingGloveModifier` in custom-held-items.ts) */
export interface ContactGloveItem {
  readonly contactGlove: ContactGloveKind;
}

/**
 * Local fork (2026-11-11): the glove that acts for `pokemon`: the Master glove when it holds one (it supersedes the plain
 * one, the user: the two do not stack), else the plain glove, else `undefined`. Player and enemy holders alike.
 */
export function getContactGlove(pokemon: Pokemon): ContactGloveKind | undefined {
  let kind: ContactGloveKind | undefined;
  for (const item of pokemon.getHeldItems()) {
    const glove = (item as Partial<ContactGloveItem>).contactGlove;
    if (glove === "master") {
      return "master";
    }
    if (glove === "plain") {
      kind = "plain";
    }
  }
  return kind;
}

/**
 * Local fork (2026-11-11): whether a glove of `kind` covers `move`: the plain glove covers punching moves (the flag Iron
 * Fist uses); the Master glove covers every contact move, and punching moves too so it is never less than the plain one.
 * Local fork (2026-11-19): `user` / `target` let the Master glove cover Shell Side Arm when it is physical for this use
 * (`Move.hasContactFlag`); without them it is left out, as before.
 */
export function isGloveMove(kind: ContactGloveKind, move: Move, user?: Pokemon, target?: Pokemon | null): boolean {
  if (kind === "master") {
    return move.hasContactFlag(user, target) || move.hasFlag(MoveFlags.PUNCHING_MOVE);
  }
  return move.hasFlag(MoveFlags.PUNCHING_MOVE);
}

/**
 * Local fork (2026-11-11): whether `user`'s glove keeps `move`'s contact from the target's side (asked by
 * `Move.doesFlagEffectApply` with `targetSide: true`): King's Shield, Spiky Shield, Baneful Bunker, Obstruct, Silk Trap,
 * Burning Bulwark, Rough Skin / Iron Barbs, Static / Flame Body / Poison Point / Effect Spore / Cute Charm, Gooey /
 * Tangling Hair, Mummy / Wandering Spirit / Lingering Aroma, Perish Body, Pickpocket, Fluffy, Aftermath, Beak Blast …
 * then do nothing.
 */
export function hidesContactFromTarget(user: Pokemon, move: Move, target?: Pokemon | null): boolean {
  const kind = getContactGlove(user);
  return kind != null && isGloveMove(kind, move, user, target);
}

/** Local fork (2026-11-11): the power multiplier `user`'s glove gives `move`, in tenths (10 = none) */
export function getContactGlovePowerTenths(user: Pokemon, move: Move, target?: Pokemon | null): number {
  const kind = getContactGlove(user);
  if (kind == null || !isGloveMove(kind, move, user, target)) {
    return 10;
  }
  return kind === "master"
    ? CONTACT_GLOVES.MASTER_PUNCHING_GLOVE.powerTenths
    : CONTACT_GLOVES.PUNCHING_GLOVE.powerTenths;
}

/**
 * Local fork (2026-11-11): multiply `power` by `user`'s glove (x1.1 plain / x1.2 Master), as `Move.calculateBattlePower`
 * applies the type-boosting items; `power * tenths / 10` keeps a whole power exact (75 becomes 82.5, not 82.50000000000001)
 */
export function applyContactGlovePower(user: Pokemon, move: Move, power: NumberHolder, target?: Pokemon | null): void {
  const tenths = getContactGlovePowerTenths(user, move, target);
  if (tenths !== 10) {
    power.value = (power.value * tenths) / 10;
  }
}

/**
 * Local fork (2026-11-11): whether `user`'s Master glove lets `move` through protection moves (Unseen Fist's rule): the
 * move makes contact as far as the user's side is concerned (Long Reach takes that away, as it does for Unseen Fist).
 *
 * Local fork (2026-11-11), after review: never for a one-hit KO move (Guillotine, Horn Drill). "1/4 of a knockout" has
 * no meaning, and its result skips the damage formula, so a gloved Guillotine (with No Guard, which the Master TM makes
 * easy) used to knock a protected target out at full effect. Protection stops those moves as usual.
 */
export function masterGloveIgnoresProtect(user: Pokemon, move: Move, target?: Pokemon | null): boolean {
  return (
    getContactGlove(user) === "master"
    && !move.hasAttr("OneHitKOAttr")
    // Local fork (2026-11-19): the target only finds Shell Side Arm's category for this use (no substitute check)
    && move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user, categoryTarget: target })
  );
}

/**
 * Local fork (2026-11-11): the protection standing between an attack and its target, for the Master glove's 1/4
 * (`Pokemon.getProtectionInTheWay` fills it in).
 */
export interface ProtectionInTheWay {
  /** A protection tag on the target (Protect, Detect, King's Shield, …): what Unseen Fist's own 1/4 looks for */
  readonly protectTag: boolean;
  /** Its side's Quick Guard / Wide Guard / Mat Block that would stop this move (the glove gets through those too) */
  readonly conditionalTag: boolean;
}

/**
 * Local fork (2026-11-11): the Master glove's Champions-style Unseen Fist damage: a hit that went through a protection
 * move because of the glove deals 1/4. `Pokemon.getAttackDamage` calls it right after the attacker's
 * `MoveDamageBoostAbAttr`, and on its fixed-damage path (Seismic Toss, Super Fang, Endeavor, Counter …) before that
 * path returns.
 *
 * After review, not applied:
 * - to a move that gets through protection by itself (`MoveFlags.IGNORE_PROTECT`: Hyper Drill, Mighty Cleave, Phantom
 *   Force, Shadow Force …): the glove did nothing for it, so it must not make it weaker;
 * - when the attacker's own Unseen Fist (or Piercing Drill) already quartered the hit into a protection tag, so the 1/4
 *   never applies twice.
 *
 * Quick Guard, Wide Guard and Mat Block count as protection too (the glove's bypass covers them, so the 1/4 must).
 * @param user - The attacker
 * @param move - The move
 * @param getProtection - Looks up the protection in front of the target; called only when the glove could act
 * @param abilityQuartersProtectTag - Whether the attacker's `IgnoreProtectOnContactAbAttr` ability is active and its
 *   own 1/4 (`MoveDamageBoostAbAttr`, a protection tag on the target) applied to `damage`; `false` on the fixed-damage
 *   path, which skips abilities
 * @param damage - The damage so far, changed in place
 * @param target - Local fork (2026-11-19): the Pokemon hit, so Shell Side Arm counts when it is physical for this use
 */
export function applyMasterGloveProtectDamage(
  user: Pokemon,
  move: Move,
  getProtection: () => ProtectionInTheWay,
  abilityQuartersProtectTag: boolean,
  damage: NumberHolder,
  target?: Pokemon | null,
): void {
  if (move.hasFlag(MoveFlags.IGNORE_PROTECT) || !masterGloveIgnoresProtect(user, move, target)) {
    return;
  }
  const { protectTag, conditionalTag } = getProtection();
  if ((!protectTag && !conditionalTag) || (protectTag && abilityQuartersProtectTag)) {
    return;
  }
  damage.value = toDmgValue(damage.value * CONTACT_GLOVES.MASTER_PUNCHING_GLOVE.protectDamageMultiplier);
}
