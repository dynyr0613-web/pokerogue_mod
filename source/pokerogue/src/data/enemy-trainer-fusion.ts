/**
 * Local fork (2026-11-12): more fused Pokémon in Endless trainer battles, (C) of docs/트레이너_배틀도구_합체_강화_계획.md
 * (the user, approving the plan: "합체 포켓몬도 추천안대로 넣어두고").
 *
 * - Who: the Pokémon of a TRAINER battle in Endless (`gameMode.isEndless`). Not Classic, Challenge or Daily, not wild
 *   Pokémon, not mystery-encounter battles (their battle type is MYSTERY_ENCOUNTER), not a reloaded party.
 * - What: the fusion token (`EnemyFusionChanceModifier`, 1% a stack) is rolled in the Pokémon's constructor as before;
 *   when it did not fuse the Pokémon, one more roll at the trainer tier's chance ({@linkcode getEnemyTrainerFusionChance}:
 *   `ENEMY_TRAINER_BUFFS.fusion`, by difficulty wave, `getBattleFormChanceAt`'s curve) fuses it the same way
 *   (`generateFusionSpecies`, the Endless trainer tail evolving fully), right there, so its moves, Tera type and its
 *   trainer config's post-processing are made for the fused Pokémon as usual. A Pokémon already fused (Spliced Endless,
 *   where every Pokémon is, or the token) draws no die.
 * - Never from this roll (no die drawn either):
 *   1. a member from one of the trainer's own config slots (`setPartyMemberFunc`: gym leaders' and the fork's named
 *      trainers' fixed members, signature pools...) or from a named pair's signature pools (Tate & Liza);
 *   2. the signature species of the trainer's battle form, its own and its late one (`SIGNATURE_BATTLE_FORMS`,
 *      `LATE_SIGNATURE_BATTLE_FORMS`), the whole evolution line;
 *   3. a member a strong-member rule counts: an Endless extra (the members the fill added) whose head species passes the
 *      strong bar (`isStrongEndlessExtra`), and under the elite trainers' "legendaries allowed" rule any of their free
 *      members passing that rule's bar (legend group included); a fusion would average its base stats with the tail's;
 *   4. every species with a battle form (Mega / G-Max / Primal), decided for the species ({@linkcode speciesHasBattleForm})
 *      as the Pokémon has no moves yet, so the battle-form roll keeps its candidates (a fusion can take no battle form).
 * - Where: the constructor has no trainer slot yet (`hasTrainer()` is false while it runs), so `Trainer.genPartyMember`
 *   says what member it is building ({@linkcode getEndlessTrainerFusionMember}) for as long as it builds it
 *   ({@linkcode withEndlessTrainerFusionMember}); a Pokémon made outside that (a signature Pokémon put in afterwards, a
 *   wild one) rolls nothing. The die is drawn in the member's own seeded sequence, so the strong extra's re-rolls and the
 *   look-ahead at the later members draw the same as when those members are really made.
 *
 * The numbers are in `ENEMY_TRAINER_BUFFS.fusion` (enemy-trainer-buffs.ts); tests force the roll through
 * `enemyTrainerBuffDice`.
 */

import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { ENEMY_TRAINER_BUFFS, enemyTrainerBuffDice } from "#balance/enemy-trainer-buffs";
import {
  getBattleFormChanceAt,
  getTrainerBattleFormTier,
  LATE_SIGNATURE_BATTLE_FORMS,
  SIGNATURE_BATTLE_FORMS,
  speciesHasBattleForm,
  type TrainerBattleFormTier,
} from "#data/enemy-battle-forms";
import { BattleType } from "#enums/battle-type";
import type { SpeciesId } from "#enums/species-id";
import type { TrainerType } from "#enums/trainer-type";
import type { Pokemon } from "#field/pokemon";
import type { Trainer } from "#field/trainer";
import { isStrongEndlessExtra } from "#trainers/endless-trainer-party";
import type { TrainerConfig } from "#trainers/trainer-config";

/**
 * Local fork (2026-11-12): the strong-member rule that covers a member: `extra`, an Endless extra under the strong-extra
 * rule; `elite`, a free member under the elite trainers' "legendaries allowed" rule
 */
export type EndlessTrainerFusionStrongRule = "extra" | "elite";

/** Local fork (2026-11-12): what `Trainer.genPartyMember` is building, for the fusion roll of its Pokémon */
export interface EndlessTrainerFusionMember {
  /** The trainer's tier (`getTrainerBattleFormTier`) */
  readonly tier: TrainerBattleFormTier;
  /** The battle's difficulty wave */
  readonly difficultyWave: number;
  /** Whether the member comes from one of the trainer's own config slots or a named pair's signature pools */
  readonly fixedSlot: boolean;
  /** The strong-member rule that covers the member, if any */
  readonly strongRule: EndlessTrainerFusionStrongRule | undefined;
  /** The root species of the trainer's signature species ({@linkcode getTrainerSignatureRoots}) */
  readonly signatureRoots: readonly SpeciesId[];
}

/** Local fork (2026-11-12): the member being built ({@linkcode withEndlessTrainerFusionMember}), if any */
let currentMember: EndlessTrainerFusionMember | undefined;

/**
 * Local fork (2026-11-12): the percent chance (0-100) of the extra fusion roll for a Pokémon of a trainer of `tier` on
 * difficulty wave `difficultyWave` (`ENEMY_TRAINER_BUFFS.fusion`)
 */
export function getEnemyTrainerFusionChance(tier: TrainerBattleFormTier, difficultyWave: number): number {
  return getBattleFormChanceAt(ENEMY_TRAINER_BUFFS.fusion[tier], difficultyWave);
}

/**
 * Local fork (2026-11-12): the root species of the signature species of a trainer config and of its named partner
 * (`trainerTypeDouble`): its own signature (`SIGNATURE_BATTLE_FORMS`) and its late one (`LATE_SIGNATURE_BATTLE_FORMS`,
 * whatever the wave), so the whole line is left alone (Gible to Garchomp for Cynthia, Duraludon and Archaludon for Raihan)
 */
export function getTrainerSignatureRoots(config: TrainerConfig): SpeciesId[] {
  const types: TrainerType[] = [config.trainerType];
  if (config.trainerTypeDouble != null) {
    types.push(config.trainerTypeDouble);
  }
  const roots = new Set<SpeciesId>();
  for (const type of types) {
    for (const signature of [SIGNATURE_BATTLE_FORMS[type], LATE_SIGNATURE_BATTLE_FORMS[type]?.signature]) {
      if (signature) {
        roots.add(speciesDataRegistry.getSpecies(signature.species).getRootSpeciesId());
      }
    }
  }
  return [...roots];
}

/**
 * Local fork (2026-11-12): what the fusion roll needs to know about a member `trainer` is about to build, or `undefined`
 * when the current battle is not that trainer's Endless TRAINER battle (Classic and the other modes, mystery-encounter
 * battles), where nothing is rolled
 * @param trainer - The trainer building the member
 * @param slot - Whether the member comes from a config slot (or a named pair's pools), and its strong-member rule
 */
export function getEndlessTrainerFusionMember(
  trainer: Trainer,
  slot: { fixedSlot: boolean; strongRule: EndlessTrainerFusionStrongRule | undefined },
): EndlessTrainerFusionMember | undefined {
  const battle = globalScene.currentBattle;
  if (!globalScene.gameMode.isEndless || battle?.battleType !== BattleType.TRAINER || battle.trainer !== trainer) {
    return undefined;
  }
  return {
    tier: getTrainerBattleFormTier(trainer.config),
    difficultyWave: globalScene.gameMode.getWaveForDifficulty(battle.waveIndex),
    fixedSlot: slot.fixedSlot,
    strongRule: slot.strongRule,
    signatureRoots: getTrainerSignatureRoots(trainer.config),
  };
}

/**
 * Local fork (2026-11-12): runs `build` with `member` as the member being built (`undefined`: none), then puts back the
 * one before, so the look-ahead at later members inside a member's build keeps each its own
 * @returns What `build` returns
 */
export function withEndlessTrainerFusionMember<T>(member: EndlessTrainerFusionMember | undefined, build: () => T): T {
  const outer = currentMember;
  currentMember = member;
  try {
    return build();
  } finally {
    currentMember = outer;
  }
}

/**
 * Local fork (2026-11-12): whether `pokemon`, built as `member`, is left out of the fusion roll (see the file comment):
 * a config slot, a signature species' line, a member a strong-member rule counts, a species with a battle form
 */
export function isExcludedFromEndlessTrainerFusion(pokemon: Pokemon, member: EndlessTrainerFusionMember): boolean {
  const { species } = pokemon;
  return (
    member.fixedSlot
    || member.signatureRoots.includes(species.getRootSpeciesId())
    || (member.strongRule != null && isStrongEndlessExtra(pokemon, member.strongRule === "elite"))
    || speciesHasBattleForm(species.speciesId)
  );
}

/**
 * Local fork (2026-11-12): the extra fusion roll of an Endless trainer's Pokémon, from the `Pokemon` constructor right
 * after the fusion token's roll, only when the token did not fuse it. Draws its die (`enemyTrainerBuffDice`) only for an
 * enemy being built as a member of the current Endless trainer battle ({@linkcode withEndlessTrainerFusionMember}),
 * not fused yet, with a chance above 0 and not left out ({@linkcode isExcludedFromEndlessTrainerFusion}).
 * @returns Whether it fuses
 */
export function rollEndlessTrainerFusion(pokemon: Pokemon): boolean {
  const member = currentMember;
  const battle = globalScene.currentBattle;
  if (
    member == null
    || !pokemon.isEnemy()
    || pokemon.isFusion()
    || !globalScene.gameMode.isEndless
    || battle?.battleType !== BattleType.TRAINER
  ) {
    return false;
  }
  const chance = getEnemyTrainerFusionChance(member.tier, member.difficultyWave);
  if (chance <= 0 || isExcludedFromEndlessTrainerFusion(pokemon, member)) {
    return false;
  }
  return enemyTrainerBuffDice.roll(100) < chance;
}
