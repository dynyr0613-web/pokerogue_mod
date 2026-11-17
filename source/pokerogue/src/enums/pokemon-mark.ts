/**
 * Local fork (2026-11-17): the main series' marks (증표) and memorial ribbons (리본) a single Pokémon can carry.
 *
 * The numbers are written to save data (`PokemonData.marks`), so they must never change; add new ones at the end of
 * their block. Ribbons are below 100, marks from 100 up. Not to be confused with `RibbonData`, the per-species
 * challenge ribbons of the Pokédex ("클리어 여부").
 */
export enum PokemonMark {
  // #region Ribbons, given to the whole party for beating a champion (see `TRAINER_RIBBONS`)
  /** The Gen 3 Champion Ribbon (FireRed / LeafGreen): Blue */
  CHAMPION_RIBBON = 1,
  /** Omega Ruby / Alpha Sapphire: Steven, Wallace */
  HOENN_CHAMPION_RIBBON = 2,
  /** Cynthia */
  SINNOH_CHAMPION_RIBBON = 3,
  /** Diantha */
  KALOS_CHAMPION_RIBBON = 4,
  /** Kukui, Hau */
  ALOLA_CHAMPION_RIBBON = 5,
  /** Leon, Mustard */
  GALAR_CHAMPION_RIBBON = 6,
  /** Geeta, Nemona, Kieran */
  PALDEA_CHAMPION_RIBBON = 7,
  /** HeartGold / SoulSilver: Red */
  LEGEND_RIBBON = 8,
  // #endregion

  // #region Marks a wild Pokémon may be met with (see `rollWildMark`)
  LUNCHTIME_MARK = 100,
  SLEEPY_TIME_MARK = 101,
  DUSK_MARK = 102,
  DAWN_MARK = 103,
  RAINY_MARK = 104,
  STORMY_MARK = 105,
  SNOWY_MARK = 106,
  BLIZZARD_MARK = 107,
  DRY_MARK = 108,
  SANDSTORM_MARK = 109,
  MISTY_MARK = 110,
  UNCOMMON_MARK = 111,
  RARE_MARK = 112,
  ROWDY_MARK = 113,
  ABSENT_MINDED_MARK = 114,
  JITTERY_MARK = 115,
  EXCITED_MARK = 116,
  CHARISMATIC_MARK = 117,
  CALMNESS_MARK = 118,
  INTENSE_MARK = 119,
  ZONED_OUT_MARK = 120,
  JOYFUL_MARK = 121,
  ANGRY_MARK = 122,
  SMILEY_MARK = 123,
  TEARY_MARK = 124,
  UPBEAT_MARK = 125,
  PEEVED_MARK = 126,
  INTELLECTUAL_MARK = 127,
  FEROCIOUS_MARK = 128,
  CRAFTY_MARK = 129,
  SCOWLING_MARK = 130,
  KINDLY_MARK = 131,
  FLUSTERED_MARK = 132,
  PUMPED_UP_MARK = 133,
  ZERO_ENERGY_MARK = 134,
  PRIDEFUL_MARK = 135,
  UNSURE_MARK = 136,
  HUMBLE_MARK = 137,
  THORNY_MARK = 138,
  VIGOR_MARK = 139,
  SLUMP_MARK = 140,
  // #endregion

  // #region Alpha marks, carried by alpha Pokémon (alpha-pokemon.ts)
  /** The Alpha Mark (우두머리의증표): every alpha */
  ALPHA_MARK = 200,
  /** The Golden Alpha Mark (황금우두머리의증표), this fork's own: an alpha with the full 20% boost */
  GOLDEN_ALPHA_MARK = 201,
  // #endregion
}
