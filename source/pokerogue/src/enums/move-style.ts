import type { ObjectValues } from "#types/type-helpers";

/**
 * Local fork (2026-11-20): the style a player's Pokémon uses its chosen damaging move in (S1, the user: "기술 선택 후
 * 강공 ... 중공(그대로) ... 속공"). The numbers are in `src/data/moves/move-style.ts`. Values are append-only.
 */
export const MoveStyle = Object.freeze({
  /** 중공: the move as it is */
  NORMAL: 0,
  /** 강공: later and stronger */
  STRONG: 1,
  /** 속공: sooner and weaker */
  AGILE: 2,
});

export type MoveStyle = ObjectValues<typeof MoveStyle>;
