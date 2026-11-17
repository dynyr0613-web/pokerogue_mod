/**
 * Consumable items added by this local fork (2026-11-05).
 *
 * Kept outside `modifier.ts` like `custom-held-items.ts`. Consumables are used the moment they are picked and
 * never saved, so they need no entry in `customModifierClasses`.
 */

import { globalScene } from "#app/global-scene";
import { FRIENDSHIP_GAIN_FROM_RARE_CANDY } from "#balance/starters";
import { allMoves } from "#data/data-lists"; // Local fork (2026-11-11): Master TM
import { getLevelTotalExp } from "#data/exp";
import { ChallengeType } from "#enums/challenge-type"; // Local fork (2026-11-11): Master TM (challenge move bans)
import { LearnMoveType } from "#enums/learn-move-type"; // Local fork (2026-11-11): Master TM
import { MoveId } from "#enums/move-id"; // Local fork (2026-11-11): Master TM
import { PokemonType } from "#enums/pokemon-type"; // Local fork (2026-11-11): Master TM
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { ConsumablePokemonModifier, LevelIncrementBoosterModifier } from "#modifiers/modifier";
import type { ModifierType } from "#modifiers/modifier-type"; // Local fork (2026-11-11): Master TM
import { isZMaxOnlyMove } from "#moves/zmax-data"; // Local fork (2026-11-16): Z-Moves and Max Moves
import { applyChallenges } from "#utils/challenge-utils"; // Local fork (2026-11-11): Master TM (challenge move bans)
import { BooleanHolder, NumberHolder } from "#utils/common";
import i18next from "i18next"; // Local fork (2026-11-11): Master TM (move names for sorting)

/** Candy Pile (사탕더미) = this many Rare Candies on the chosen Pokémon... (the user, 2026-11-05) */
export const CANDY_PILE_RARE_CANDIES = 5;
/** ...then this many Rarer Candies, which reach every party member (the chosen one too) */
export const CANDY_PILE_RARER_CANDIES = 2;

/**
 * Local fork (2026-11-12): how many times one Candy Pile counts the Candy Jars (사탕단지), per Pokémon. A balance
 * tester, relayed by the user: "사탕더미가 직접 쓰는 개체에겐 사탕단지 효과 두배, 나머지는 한번만 적용되는 식으로
 * 해보자더라구요". Before this the chosen Pokémon counted them once too.
 */
export const CANDY_PILE_JAR_COUNTS = Object.freeze({
  /** the chosen Pokémon: twice, so 7 + 2 x jars levels */
  target: 2,
  /** every other party member: once, so 2 + jars levels */
  party: 1,
});

/**
 * Local fork (2026-11-08): the extra levels Candy Jars (사탕단지) add right now, 1 per jar. A real Rare Candy gets
 * this on top of its 1 level; a Candy Pile gets it a fixed number of times per pile, not per candy
 * (see {@linkcode CANDY_PILE_JAR_COUNTS} and {@linkcode candyPileLevels}).
 */
export function candyJarBonus(): number {
  const levels = new NumberHolder(0);
  globalScene.applyModifiers(LevelIncrementBoosterModifier, true, levels);
  return levels.value;
}

/**
 * Local fork (2026-11-08): the levels one Candy Pile gives right now. The user chose option (가) of the patch memo:
 * Candy Jars count per pile, not once per candy (with 30 jars: 37 instead of 217).
 *
 * Local fork (2026-11-12): "사탕더미가 직접 쓰는 개체에겐 사탕단지 효과 두배, 나머지는 한번만": the chosen Pokémon
 * gains 7 + 2 x jars and every other party member 2 + jars (with 30 jars: 67 and 32).
 */
export function candyPileLevels(): { target: number; party: number } {
  const { target, party } = candyPileJarLevels();
  return {
    target: CANDY_PILE_RARE_CANDIES + CANDY_PILE_RARER_CANDIES + target,
    party: CANDY_PILE_RARER_CANDIES + party,
  };
}

/**
 * Local fork (2026-11-12): the Candy Jar levels one Candy Pile adds on top of its candies right now, for the chosen
 * Pokémon (jars x {@linkcode CANDY_PILE_JAR_COUNTS.target}) and for each other member (jars x `party`).
 */
export function candyPileJarLevels(): { target: number; party: number } {
  const jars = candyJarBonus();
  return {
    target: jars * CANDY_PILE_JAR_COUNTS.target,
    party: jars * CANDY_PILE_JAR_COUNTS.party,
  };
}

/**
 * What one Rare Candy does to the Pokémon itself (see `PokemonLevelIncrementModifier.apply`): `levels` levels,
 * exp set to the new level's total while under the exp level cap, and Rare Candy friendship. The caller queues
 * the level-up phase.
 */
export function feedCandy(pokemon: PlayerPokemon, levels: number): void {
  pokemon.level += levels;
  if (pokemon.level <= globalScene.getMaxExpLevel(true)) {
    pokemon.exp = getLevelTotalExp(pokemon.level, pokemon.species.growthRate);
  }
  pokemon.addFriendship(FRIENDSHIP_GAIN_FROM_RARE_CANDY, true);
}

/**
 * Candy Pile (사탕더미), ROGUE tier: 5 Rare Candies on the chosen Pokémon, then 2 Rarer Candies on the whole party
 * (fainted members too), in one pick. The candies are fed one by one by `CandyPilePhase`, so evolutions and
 * level-up moves happen exactly as with the separate items.
 *
 * Local fork (2026-11-08): Candy Jars count per pile, not per candy (the user's option (가)): each candy gives 1
 * level, and the jar bonus rides on the chosen Pokémon's first Rare Candy and on every other member's first Rarer
 * Candy.
 *
 * Local fork (2026-11-12): the chosen Pokémon's jar bonus is doubled ("직접 쓰는 개체에겐 사탕단지 효과 두배,
 * 나머지는 한번만"), see {@linkcode CANDY_PILE_JAR_COUNTS}.
 */
export class CandyPileModifier extends ConsumablePokemonModifier {
  override apply(target: PlayerPokemon): boolean {
    const jarLevels = candyPileJarLevels(); // Local fork (2026-11-12): 2 x jars for the chosen one, jars for the rest
    globalScene.phaseManager.unshiftNew(
      "CandyPilePhase",
      target.id,
      CANDY_PILE_RARE_CANDIES,
      CANDY_PILE_RARER_CANDIES,
      jarLevels.target,
      jarLevels.party,
    );
    return true;
  }
}

// #region Master TM

/**
 * Local fork (2026-11-11): 마스터 기술머신 (Master TM), MASTER tier. The user: "마스터 기술머신(마스터, 형태는 검은색
 * 기술머신, 로그볼과 비슷한 색조합, 선택 후 소모됨, 선택한 포켓몬에게 "어느 기술이던지" 가르칠 수 있음, 노가드 + 일격기
 * 조합도 가능(어차피 일격기는 보스에게 맞지 않으니까))".
 *
 * "Any move" is every move the game implements, other Pokémon's signature moves and one-hit KO moves included; no
 * move is banned for balance (`OneHitKOAttr` already never knocks out a boss). Left out are only the moves that
 * cannot work as a learned move: these two (the empty move slot and Struggle, which a Pokémon only uses when it has
 * nothing else), every move marked `.unimplemented()` and the moves the Pokémon already knows.
 * Local fork (2026-11-16): Z-Moves and Max Moves. The Z / Max / G-Max registry entries are implemented now (they back
 * converted move slots), so `isMasterTmMove` leaves them out by `isZMaxOnlyMove` instead.
 */
export const MASTER_TM_EXCLUDED_MOVES: ReadonlySet<MoveId> = new Set([MoveId.NONE, MoveId.STRUGGLE]);

/**
 * Local fork (2026-11-11): the Master TM's weight in the MASTER reward pool, below the one-per-Pokémon MASTER items (8:
 * Choice items, Ultimate Gene, Master Punching Glove), because a used-up Master TM can roll again and again with no cap,
 * while each of those leaves the pool once a party member holds one.
 * Local fork (2026-11-12): 6 -> 2 (the user: "마스터 기술머신의 가중치 하락").
 */
export const MASTER_TM_POOL_WEIGHT = 2;

/** Local fork (2026-11-11): the 18 types the Master TM picker lists, in the game's type order (no ??? or Stellar) */
export const MASTER_TM_TYPES: readonly PokemonType[] = [
  PokemonType.NORMAL,
  PokemonType.FIGHTING,
  PokemonType.FLYING,
  PokemonType.POISON,
  PokemonType.GROUND,
  PokemonType.ROCK,
  PokemonType.BUG,
  PokemonType.GHOST,
  PokemonType.STEEL,
  PokemonType.FIRE,
  PokemonType.WATER,
  PokemonType.GRASS,
  PokemonType.ELECTRIC,
  PokemonType.PSYCHIC,
  PokemonType.ICE,
  PokemonType.DRAGON,
  PokemonType.DARK,
  PokemonType.FAIRY,
];

/**
 * Local fork (2026-11-11): whether the Master TM can teach `moveId` at all (implemented, not NONE or Struggle).
 * After review: also not a move the run's challenges forbid the player to use (`ChallengeType.POKEMON_MOVE`, the check
 * `PokemonMove.isUsable` makes; Hardcore bans Revival Blessing), so the item is never spent on a move that could never be
 * used. Nothing else is filtered: "어느 기술이던지" passes over TM compatibility and egg-move rules on purpose.
 */
export function isMasterTmMove(moveId: MoveId): boolean {
  const move = allMoves[moveId];
  // Local fork (2026-11-16): Z-Moves and Max Moves. Never a Z / Max / G-Max id (only converted slots use them)
  if (!move || move.isUnimplemented || MASTER_TM_EXCLUDED_MOVES.has(moveId) || isZMaxOnlyMove(moveId)) {
    return false;
  }
  const usable = new BooleanHolder(true);
  applyChallenges(ChallengeType.POKEMON_MOVE, moveId, usable);
  return usable.value;
}

/** The moves `pokemon` knows: its own moveset and, while transformed, the copied one (LearnMovePhase checks that) */
function getKnownMoveIds(pokemon: Pokemon): Set<MoveId> {
  const known = new Set<MoveId>();
  for (const move of [...pokemon.moveset, ...pokemon.getMoveset()]) {
    if (move) {
      known.add(move.moveId);
    }
  }
  return known;
}

/** Local fork (2026-11-11): every move the Master TM can teach `pokemon` now, in move id order */
export function getMasterTmMoves(pokemon: Pokemon): MoveId[] {
  const known = getKnownMoveIds(pokemon);
  return allMoves.filter(m => isMasterTmMove(m.id) && !known.has(m.id)).map(m => m.id);
}

/** Local fork (2026-11-11): whether the Master TM can teach `pokemon` anything (its reward screen filter) */
export function hasMasterTmMove(pokemon: Pokemon): boolean {
  const known = getKnownMoveIds(pokemon);
  return allMoves.some(m => isMasterTmMove(m.id) && !known.has(m.id));
}

/**
 * Local fork (2026-11-11): the moves the Master TM can teach `pokemon`, by type (their own type, as the TMs and the
 * move list show it), each list sorted by name in the game's language (가나다 order in Korean). Types with no move
 * left are absent.
 */
export function getMasterTmMovesByType(pokemon: Pokemon): Map<PokemonType, MoveId[]> {
  const collator = new Intl.Collator(i18next.language || undefined);
  const byType = new Map<PokemonType, MoveId[]>();
  for (const moveId of getMasterTmMoves(pokemon)) {
    const type = allMoves[moveId].type;
    const list = byType.get(type);
    if (list) {
      list.push(moveId);
    } else {
      byType.set(type, [moveId]);
    }
  }
  for (const list of byType.values()) {
    list.sort((a, b) => collator.compare(allMoves[a].name, allMoves[b].name) || a - b);
  }
  return byType;
}

/**
 * Local fork (2026-11-11): the Master TM's effect, made once the player has chosen the Pokémon and the move. It goes
 * through the TM's own learn flow (`LearnMovePhase` with {@linkcode LearnMoveType.TM}): with four moves the game asks
 * which one to forget, the move joins the Pokémon's used TMs (so a Memory Mushroom can bring it back later), and the
 * copy of the reward screen queued for a cancelled lesson is dropped once the move is learned. Stopping the lesson
 * at the forget prompt returns to that reward screen with nothing used, as with a TM.
 */
export class MasterTmModifier extends ConsumablePokemonModifier {
  public readonly moveId: MoveId;

  constructor(type: ModifierType, pokemonId: number, moveId: MoveId) {
    super(type, pokemonId);
    this.moveId = moveId;
  }

  override shouldApply(playerPokemon?: PlayerPokemon, ...args: unknown[]): boolean {
    return super.shouldApply(playerPokemon, ...args) && isMasterTmMove(this.moveId);
  }

  override apply(playerPokemon: PlayerPokemon): boolean {
    globalScene.phaseManager.unshiftNew(
      "LearnMovePhase",
      globalScene.getPlayerParty().indexOf(playerPokemon),
      this.moveId,
      LearnMoveType.TM,
    );
    return true;
  }
}

// #endregion Master TM
