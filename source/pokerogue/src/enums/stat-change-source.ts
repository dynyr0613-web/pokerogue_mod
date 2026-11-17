import type { ValueOf } from "type-fest";

export const StatChangeSource = {
  STICKY_WEB: 1,
  MIRROR_ARMOR: 2,
  OPPORTUNIST: 3,
  /** Local fork (2026-11-11), after review: Octolock's drops every turn (Clear Amulet blocks them without its message) */
  OCTOLOCK: 4,
} as const;

export type StatChangeSource = ValueOf<typeof StatChangeSource>;
