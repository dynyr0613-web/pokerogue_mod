import type { ArenaTag, ArenaTagTypeMap } from "#data/arena-tag";
import type { NonSerializableArenaTagType, SerializableArenaTagType } from "#types/arena-tags";

/**
 * Enum representing all different types of {@linkcode ArenaTag}s.
 * @privateRemarks
 * ⚠️ When modifying the fields in this enum, ensure that:
 * - The entry is added to / removed from {@linkcode ArenaTagTypeMap}
 * - The tag is added to / removed from {@linkcode NonSerializableArenaTagType} or {@linkcode SerializableArenaTagType}
 */
export enum ArenaTagType {
  NONE = "NONE",
  MUD_SPORT = "MUD_SPORT",
  WATER_SPORT = "WATER_SPORT",
  SPIKES = "SPIKES",
  TOXIC_SPIKES = "TOXIC_SPIKES",
  MIST = "MIST",
  STEALTH_ROCK = "STEALTH_ROCK",
  STICKY_WEB = "STICKY_WEB",
  TRICK_ROOM = "TRICK_ROOM",
  GRAVITY = "GRAVITY",
  REFLECT = "REFLECT",
  LIGHT_SCREEN = "LIGHT_SCREEN",
  AURORA_VEIL = "AURORA_VEIL",
  QUICK_GUARD = "QUICK_GUARD",
  WIDE_GUARD = "WIDE_GUARD",
  MAT_BLOCK = "MAT_BLOCK",
  CRAFTY_SHIELD = "CRAFTY_SHIELD",
  TAILWIND = "TAILWIND",
  HAPPY_HOUR = "HAPPY_HOUR",
  SAFEGUARD = "SAFEGUARD",
  NO_CRIT = "NO_CRIT",
  IMPRISON = "IMPRISON",
  ION_DELUGE = "ION_DELUGE",
  FIRE_GRASS_PLEDGE = "FIRE_GRASS_PLEDGE",
  WATER_FIRE_PLEDGE = "WATER_FIRE_PLEDGE",
  GRASS_WATER_PLEDGE = "GRASS_WATER_PLEDGE",
  FAIRY_LOCK = "FAIRY_LOCK",
  NEUTRALIZING_GAS = "NEUTRALIZING_GAS",
  PENDING_HEAL = "PENDING_HEAL",
  /**
   * Local fork (2026-11-14): custom moves. Garden (정원): Grassy Terrain's direct effects on one side only.
   * A string enum, so saves keep it by name (an older build loads it as a `NoneTag`).
   */
  GARDEN = "GARDEN",
  /**
   * Local fork (2026-11-16): Z-Moves and Max Moves. The 4-turn G-Max fields on the target's side: at each turn end every
   * Pokémon there that is not of the move's type loses 1/6 of its max HP (G-Max Wildfire / Vine Lash / Cannonade /
   * Volcalith: Fire / Grass / Water / Rock).
   */
  G_MAX_WILDFIRE = "G_MAX_WILDFIRE",
  G_MAX_VINE_LASH = "G_MAX_VINE_LASH",
  G_MAX_CANNONADE = "G_MAX_CANNONADE",
  G_MAX_VOLCALITH = "G_MAX_VOLCALITH",
  /** Local fork (2026-11-16): G-Max Steelsurge (거다이강철진): a Steel-type Stealth Rock */
  G_MAX_STEELSURGE = "G_MAX_STEELSURGE",
  /**
   * Local fork (2026-11-19): Wonder Room (원더룸, 1.2.0 D6; the user: "d6 실행"): for 5 turns every Pokémon's Defense and
   * Sp. Def are swapped. Appended at the end; a string enum, so saves keep it by name.
   */
  WONDER_ROOM = "WONDER_ROOM",
}
