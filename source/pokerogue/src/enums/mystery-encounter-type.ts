export enum MysteryEncounterType {
  MYSTERIOUS_CHALLENGERS,
  MYSTERIOUS_CHEST,
  DARK_DEAL,
  FIGHT_OR_FLIGHT,
  SLUMBERING_SNORLAX,
  TRAINING_SESSION,
  DEPARTMENT_STORE_SALE,
  SHADY_VITAMIN_DEALER,
  FIELD_TRIP,
  SAFARI_ZONE,
  LOST_AT_SEA,
  FIERY_FALLOUT,
  THE_STRONG_STUFF,
  THE_POKEMON_SALESMAN,
  AN_OFFER_YOU_CANT_REFUSE,
  DELIBIRDY,
  ABSOLUTE_AVARICE,
  A_TRAINERS_TEST,
  TRASH_TO_TREASURE,
  BERRIES_ABOUND,
  CLOWNING_AROUND,
  PART_TIMER,
  DANCING_LESSONS,
  WEIRD_DREAM,
  THE_WINSTRATE_CHALLENGE,
  TELEPORTING_HIJINKS,
  BUG_TYPE_SUPERFAN,
  FUN_AND_GAMES,
  UNCOMMON_BREED,
  GLOBAL_TRADE_SYSTEM,
  THE_EXPERT_POKEMON_BREEDER,
  /** Local fork (2026-11-05): ULTRA-tier GTS with better trades; appended last so saved ids stay put */
  HYPER_GLOBAL_TRADE_SYSTEM,
  /** Local fork (2026-11-07): GREAT-tier GTS that takes 5 or 10 held items of a tier for a pick of better ones */
  SUPER_GLOBAL_TRADE_SYSTEM,
  /** Local fork (2026-11-08): ROGUE-tier pitch-black "GTS?" that swallows a Pokémon for a rare held item */
  DARK_GLOBAL_TRADE_SYSTEM,
  /** Local fork (2026-11-08): ROGUE-tier pitch-black "Mysterious Chest?" (trap Gholdengo, Endless 777 spawn) */
  DARK_MYSTERIOUS_CHEST,
  /** Local fork (2026-11-08): ULTRA-tier Tinkaton's Forge (item pick, Steel forging, sparring for EXP) */
  TINKATON_FORGE,
  /** Local fork (2026-11-08): GREAT-tier Vending Machine (buy a random Ultra/Rogue/Master item for 2x the locked reroll price) */
  VENDING_MACHINE,
  /** Local fork (2026-11-08): ROGUE-tier "The Strong Stuff?" (pitch-black juice for one, shiny Power Trick Shuckle) */
  DARK_STRONG_STUFF,
  /** Local fork (2026-11-18): GREAT-tier "우두머리!" (Alpha!): fight a forced alpha of the biome's wild pool or run away; appended last so saved ids stay put */
  ALPHA_ENCOUNTER,
  /** Local fork (2026-11-19): ROGUE-tier "고철 속 보물" (Treasure in the Scrap): G-Max Melmetal boss or a dig for a vest; appended last so saved ids stay put */
  SCRAP_TREASURE,
  /** Local fork (2026-11-20): ROGUE-tier "별에게 소원을" (Wish on a Star, official proposal #4477): wake a sleeping Jirachi for a wish, or battle it angry; appended last so saved ids stay put */
  WISH_ON_A_STAR,
}
