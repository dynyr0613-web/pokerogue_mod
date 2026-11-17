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
  /** The Once-in-a-Lifetime Ribbon (천재일우리본): 1 Hyper GTS Wonder Trade Pokémon in 10 comes with it */
  ONCE_IN_A_LIFETIME_RIBBON = 9,
  /** The Best Friends Ribbon (절친리본): bought for a starter with its candies, after the Partner Mark */
  BEST_FRIENDS_RIBBON = 10,
  /** The Effort Ribbon (노력리본): a Pokémon that has all six stat effort ribbons below */
  EFFORT_RIBBON = 11,
  // #region The stat effort ribbons, this fork's own: the stat's EVs at their cap
  HP_EFFORT_RIBBON = 12,
  ATK_EFFORT_RIBBON = 13,
  DEF_EFFORT_RIBBON = 14,
  SPATK_EFFORT_RIBBON = 15,
  SPDEF_EFFORT_RIBBON = 16,
  SPD_EFFORT_RIBBON = 17,
  // #endregion
  /** The Footprint Ribbon (발자국리본): a Pokémon that reaches level 200 */
  FOOTPRINT_RIBBON = 18,
  /** The Grand Footprint Ribbon (큰발자국리본), this fork's own: a Pokémon that reaches level 100,000 in Endless */
  GRAND_FOOTPRINT_RIBBON = 19,
  /** The Endless Master Ribbon (엔드리스마스터리본), after the Tower Master Ribbon: the party that clears Endless */
  ENDLESS_MASTER_RIBBON = 20,
  // #region Local fork (2026-11-18): hidden ribbons (the user: "새 히든 증표•리본"); see `COMPLETION_EXEMPT_MARKS`
  // The Gen 4 Battle Tower's ability ribbons (어빌리티리본 ...) as Endless milestones: the party that clears Endless
  // (or Spliced Endless) wave 500, 1000, 2000, 3000, 4000 and 5000 (`ENDLESS_MILESTONE_RIBBONS`)
  ABILITY_RIBBON = 21,
  GREAT_ABILITY_RIBBON = 22,
  DOUBLE_ABILITY_RIBBON = 23,
  MULTI_ABILITY_RIBBON = 24,
  PAIR_ABILITY_RIBBON = 25,
  WORLD_ABILITY_RIBBON = 26,
  /** The Hisui Ribbon (히스이리본): the party that beats a named trainer from Hisui (`TRAINER_RIBBONS`) */
  HISUI_RIBBON = 27,
  /**
   * The Master Rank Ribbon (마스터랭크리본): the party that beats a named trainer once the player has beaten all 11
   * of them (`awardMasterRankRibbon`)
   */
  MASTER_RANK_RIBBON = 28,
  // #endregion
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
  /** The Jumbo Mark (커다란증표): every alpha, with its Alpha Mark */
  JUMBO_MARK = 202,
  // #endregion

  /** The Mini Mark (조그만증표): a wild Pokémon met 10% smaller (alpha-pokemon.ts) */
  MINI_MARK = 203,
  /** The Partner Mark (파트너의증표): bought for a starter with its candies (starter select) */
  PARTNER_MARK = 204,
  /**
   * The Mightiest Mark (최강의증표): the boss of the raid on wave 5849 of Endless carries it, and keeps it when it is
   * caught (endless-raid.ts). A hidden mark of the mark Pokédex.
   */
  MIGHTIEST_MARK = 205,
  // #region Shiny marks, this fork's own: a shiny Pokémon that is caught or hatched gets its tier's
  SHINY_MARK = 206,
  RARE_SHINY_MARK = 207,
  EPIC_SHINY_MARK = 208,
  // #endregion

  // #region This fork's own marks for what a starter line has achieved (pokemon-marks.ts, `getAchievedLineMarks`)
  /** The Egg Move Mark (알기술의증표): every egg move of the line unlocked */
  EGG_MOVES_MARK = 209,
  /** The Perfect IV Mark (최고개체의증표): the line's best IVs are 31 in all six stats */
  PERFECT_IV_MARK = 210,
  /**
   * The Master Ball Mark (마스터볼의증표): a Pokémon caught in a Master Ball carries it; a Pokémon of a line that is
   * never met in the wild gets it when it is obtained
   */
  MASTER_BALL_MARK = 211,
  // #endregion

  // #region Local fork (2026-11-18): hidden marks of the main series (the user: "새 히든 증표•리본")
  /**
   * The Destiny Mark (운명의증표): a wild Pokémon whose National Pokédex number is the wave's (in Endless past wave
   * 1025 also the wave's last three digits) carries it (`isDestinyWave`)
   */
  DESTINY_MARK = 212,
  /** The Gourmand Mark (미식가의증표): a Pokémon that has eaten all six IV Candies up to its cap */
  GOURMAND_MARK = 213,
  /** The Itemfinder Mark (습득의증표): a player's Pokémon whose Pickup picks up an item */
  ITEMFINDER_MARK = 214,
  // #endregion

  /**
   * The Eternatus Mark (무한다이노의증표), this fork's own hidden mark. No Pokémon carries it and it is not in the
   * ordinary list (`orderedPokemonMarks`): it is the player's, for catching every Pokémon and then Eternatus, and
   * only shows in the mark Pokédex once it is earned, as one more than the total (`hasEternatusMark`).
   */
  ETERNATUS_MARK = 300,
}
