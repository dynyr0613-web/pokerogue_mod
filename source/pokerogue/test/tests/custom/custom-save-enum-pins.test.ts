// Local fork (2026-11-19): save-compatibility pins for 1.2.0 (docs/1.2.0_후보_20261119.md, B4). Saves store these
// enum values as plain numbers (movesets, `customPokemonData` abilities, marks, the session's encounter and trainer,
// form-change items in held-item args, form indices in `PokemonData.formIndex` and the Pokédex form bits, the passive
// bits of `passiveAttr`), so a 1.1.0 save only loads right while each fork member keeps its number.
//
// APPEND ONLY, NEVER INSERT: saves store these numbers. A new fork member goes after the last one of its block (and
// may be added here); changing a number below breaks every save that holds it.
//
// Not in this table, because saves keep them by name: modifier type ids ("FORGED_STEEL" ...), achievement ids, arena
// and battler tag types (string enums) and the Z/Max conversion kinds ("max", "gmax" ...). The 1.1.0 save fixture test
// (custom-save-fixture-1.1.0.test.ts) loads a real save with them. Order checks that already exist elsewhere stay there:
// custom-zmax-registry, custom-moves-1114-scaffold, custom-named-trainers and the encounter tests.

import { speciesDataRegistry } from "#app/global-species-data-registry";
import { AbilityId } from "#enums/ability-id";
import { FormChangeItem } from "#enums/form-change-item";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Passive } from "#enums/passive";
import { PokemonMark } from "#enums/pokemon-mark";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { describe, expect, it } from "vitest";

/** One enum's fork members and the numbers saves hold for them */
interface PinnedEnum {
  readonly enumObject: Record<string, string | number>;
  readonly pins: Readonly<Record<string, number>>;
  /**
   * Whether the block is numbered implicitly (each member = the previous + 1), so an insertion would shift every member
   * after it: then any member that is not pinned must lie outside the pinned range (appended after it, or upstream's
   * before it). `false` for enums whose members all carry explicit numbers with gaps for later additions.
   */
  readonly contiguousBlock: boolean;
}

const PINNED_ENUMS: Readonly<Record<string, PinnedEnum>> = {
  MoveId: {
    enumObject: MoveId,
    contiguousBlock: true,
    pins: {
      // 2026-11-14: custom moves, right after upstream's NIHIL_LIGHT (920)
      SUBLIMATION: 921,
      GARDENING: 922,
      ICEBREAKER: 923,
      BLINDSIDE: 924,
      // 2026-11-16: the 33 G-Max moves and 다이검무
      G_MAX_WILDFIRE: 925,
      G_MAX_BEFUDDLE: 926,
      G_MAX_VOLT_CRASH: 927,
      G_MAX_GOLD_RUSH: 928,
      G_MAX_CHI_STRIKE: 929,
      G_MAX_TERROR: 930,
      G_MAX_RESONANCE: 931,
      G_MAX_CUDDLE: 932,
      G_MAX_REPLENISH: 933,
      G_MAX_MALODOR: 934,
      G_MAX_STONESURGE: 935,
      G_MAX_WIND_RAGE: 936,
      G_MAX_STUN_SHOCK: 937,
      G_MAX_FINALE: 938,
      G_MAX_DEPLETION: 939,
      G_MAX_GRAVITAS: 940,
      G_MAX_VOLCALITH: 941,
      G_MAX_SANDBLAST: 942,
      G_MAX_SNOOZE: 943,
      G_MAX_TARTNESS: 944,
      G_MAX_SWEETNESS: 945,
      G_MAX_SMITE: 946,
      G_MAX_STEELSURGE: 947,
      G_MAX_MELTDOWN: 948,
      G_MAX_FOAM_BURST: 949,
      G_MAX_CENTIFERNO: 950,
      G_MAX_VINE_LASH: 951,
      G_MAX_CANNONADE: 952,
      G_MAX_DRUM_SOLO: 953,
      G_MAX_FIREBALL: 954,
      G_MAX_HYDROSNIPE: 955,
      G_MAX_ONE_BLOW: 956,
      G_MAX_RAPID_FLOW: 957,
      MAX_SWORDS_DANCE: 958,
    },
  },
  AbilityId: {
    enumObject: AbilityId,
    contiguousBlock: true,
    pins: {
      // Custom abilities, right after upstream's AURA_GUARD (319)
      STEEL_BODY: 320,
      FORTITUDE: 321,
      DEADEYE: 322,
      GALE_HERALD: 323,
      POLAR_LIGHT: 324,
      FOOTWORK: 325,
      SCORCH: 326,
      TURBO_ENGINE: 327,
      GOLDEN_PULSE: 328,
      OVERAWE: 329,
      LAST_STAND: 330,
      LIGHT_THIEF: 331,
      BLADE_DANCE: 332,
      IRON_FORTRESS: 333,
      SHRAPNEL: 334,
      WAR_MACHINE: 335,
      FROSTFIRE: 336,
      HILT_CANNON: 337,
      MIND_BLADE: 338,
      // 2026-11-14: passive rebalance, batches A-D
      FROST_FUR: 339,
      CAT_BURGLAR: 340,
      SUNBATHE: 341,
      SHOCK_ABSORBER: 342,
      BEAM_CANNON: 343,
      GLOW_VEIL: 344,
      HAND_TO_HAND: 345,
      FLAMEWORKER: 346,
      AURA_MASTER: 347,
      TOXIC_SPRAY: 348,
      CURRENT_HERALD: 349,
      HIGH_SPIRITS: 350,
      VENOM_HUNT: 351,
      FLAME_FUR: 352,
      VOCAL_SAC: 353,
      IRON_SAND: 354,
      DREAM_WEAVER: 355,
      SOLAR_PULSE: 356,
      COLD_SNAP: 357,
      IRON_LEGS: 358,
      GAS_LEAK: 359,
      FARSIGHT: 360,
      THORN_ARMOR: 361,
      HEADSTRONG: 362,
      FULL_BLOOM: 363,
      SAND_SPRINT: 364,
      LOOKOUT: 365,
      THUNDERCLOUD: 366,
      ROCK_FANGS: 367,
      SHOCK_BARBS: 368,
      SAND_TEMPEST: 369,
      HUNTING_INSTINCT: 370,
      RAMPAGE: 371,
      TOUGHNESS: 372,
      PLUSH_BODY: 373,
      VIGOR: 374,
      ALL_OUT_PITCH: 375,
      MUD_ARMOR: 376,
      POWER_CHEER: 377,
      CHIME_VOICE: 378,
      SPACE_WARP: 379,
      CANNONEER: 380,
      CLEARING_GUST: 381,
      // 2026-11-14: custom moves' abilities
      GARDENER: 382,
      TURNABOUT: 383,
      // 2026-11-19: 1.2.0 D12, the passive sheet's extra abilities
      ARCHMAGE: 384,
      WICKED_SCHEME: 385,
      GRIT: 386,
    },
  },
  MysteryEncounterType: {
    enumObject: MysteryEncounterType,
    contiguousBlock: true,
    pins: {
      // Right after upstream's THE_EXPERT_POKEMON_BREEDER (30)
      HYPER_GLOBAL_TRADE_SYSTEM: 31,
      SUPER_GLOBAL_TRADE_SYSTEM: 32,
      DARK_GLOBAL_TRADE_SYSTEM: 33,
      DARK_MYSTERIOUS_CHEST: 34,
      TINKATON_FORGE: 35,
      VENDING_MACHINE: 36,
      DARK_STRONG_STUFF: 37,
      ALPHA_ENCOUNTER: 38,
      // 2026-11-19: 1.2.0 D7, "고철 속 보물"
      SCRAP_TREASURE: 39,
      // 2026-11-20: 1.2.0 C2, "별에게 소원을"
      WISH_ON_A_STAR: 40,
    },
  },
  TrainerType: {
    enumObject: TrainerType,
    contiguousBlock: true,
    pins: {
      // 2026-11-11: the named boss trainers, from 400 (upstream ends at RIVAL_6 = 380)
      VOLO: 400,
      IRIDA: 401,
      ADAMAN: 402,
      KAMADO: 403,
      SONIA: 404,
      HOP: 405,
      PEONY: 406,
      SADA: 407,
      TURO: 408,
      CARMINE: 409,
      BRIAR: 410,
    },
  },
  FormChangeItem: {
    enumObject: FormChangeItem,
    contiguousBlock: true,
    pins: {
      // The custom Mega Stones, 140-149 (upstream's next block starts at SHARP_METEORITE = 150)
      CHARIZARDITE_Z: 140,
      BAXCALIBRITE_Z: 141,
      GALLADITE_Z: 142,
      MELMETALITE: 143,
      ARCHALUDONITE: 144,
    },
  },
  PokemonMark: {
    enumObject: PokemonMark,
    // Explicit numbers in blocks with room at each block's end (ribbons < 100, marks 100+, alpha marks 200+ ...)
    contiguousBlock: false,
    pins: {
      CHAMPION_RIBBON: 1,
      HOENN_CHAMPION_RIBBON: 2,
      SINNOH_CHAMPION_RIBBON: 3,
      KALOS_CHAMPION_RIBBON: 4,
      ALOLA_CHAMPION_RIBBON: 5,
      GALAR_CHAMPION_RIBBON: 6,
      PALDEA_CHAMPION_RIBBON: 7,
      LEGEND_RIBBON: 8,
      ONCE_IN_A_LIFETIME_RIBBON: 9,
      BEST_FRIENDS_RIBBON: 10,
      EFFORT_RIBBON: 11,
      HP_EFFORT_RIBBON: 12,
      ATK_EFFORT_RIBBON: 13,
      DEF_EFFORT_RIBBON: 14,
      SPATK_EFFORT_RIBBON: 15,
      SPDEF_EFFORT_RIBBON: 16,
      SPD_EFFORT_RIBBON: 17,
      FOOTPRINT_RIBBON: 18,
      GRAND_FOOTPRINT_RIBBON: 19,
      ENDLESS_MASTER_RIBBON: 20,
      ABILITY_RIBBON: 21,
      GREAT_ABILITY_RIBBON: 22,
      DOUBLE_ABILITY_RIBBON: 23,
      MULTI_ABILITY_RIBBON: 24,
      PAIR_ABILITY_RIBBON: 25,
      WORLD_ABILITY_RIBBON: 26,
      HISUI_RIBBON: 27,
      MASTER_RANK_RIBBON: 28,
      LUNCHTIME_MARK: 100,
      SLEEPY_TIME_MARK: 101,
      DUSK_MARK: 102,
      DAWN_MARK: 103,
      RAINY_MARK: 104,
      STORMY_MARK: 105,
      SNOWY_MARK: 106,
      BLIZZARD_MARK: 107,
      DRY_MARK: 108,
      SANDSTORM_MARK: 109,
      MISTY_MARK: 110,
      UNCOMMON_MARK: 111,
      RARE_MARK: 112,
      ROWDY_MARK: 113,
      ABSENT_MINDED_MARK: 114,
      JITTERY_MARK: 115,
      EXCITED_MARK: 116,
      CHARISMATIC_MARK: 117,
      CALMNESS_MARK: 118,
      INTENSE_MARK: 119,
      ZONED_OUT_MARK: 120,
      JOYFUL_MARK: 121,
      ANGRY_MARK: 122,
      SMILEY_MARK: 123,
      TEARY_MARK: 124,
      UPBEAT_MARK: 125,
      PEEVED_MARK: 126,
      INTELLECTUAL_MARK: 127,
      FEROCIOUS_MARK: 128,
      CRAFTY_MARK: 129,
      SCOWLING_MARK: 130,
      KINDLY_MARK: 131,
      FLUSTERED_MARK: 132,
      PUMPED_UP_MARK: 133,
      ZERO_ENERGY_MARK: 134,
      PRIDEFUL_MARK: 135,
      UNSURE_MARK: 136,
      HUMBLE_MARK: 137,
      THORNY_MARK: 138,
      VIGOR_MARK: 139,
      SLUMP_MARK: 140,
      ALPHA_MARK: 200,
      GOLDEN_ALPHA_MARK: 201,
      JUMBO_MARK: 202,
      MINI_MARK: 203,
      PARTNER_MARK: 204,
      MIGHTIEST_MARK: 205,
      SHINY_MARK: 206,
      RARE_SHINY_MARK: 207,
      EPIC_SHINY_MARK: 208,
      EGG_MOVES_MARK: 209,
      PERFECT_IV_MARK: 210,
      MASTER_BALL_MARK: 211,
      DESTINY_MARK: 212,
      GOURMAND_MARK: 213,
      ITEMFINDER_MARK: 214,
      ETERNATUS_MARK: 300,
    },
  },
  Passive: {
    enumObject: Passive,
    // Bit flags of `StarterDataEntry.passiveAttr`; CUSTOM is the fork's legacy bit, converted on load
    contiguousBlock: false,
    pins: {
      UNLOCKED: 1,
      ENABLED: 2,
      CUSTOM: 4,
    },
  },
};

/**
 * The fork's own forms and their indices in `species.forms` (saved as `PokemonData.formIndex` and as the Pokédex's
 * form bits). Archaludon had no forms upstream, so its base form 0 is the fork's too. New forms go after these.
 */
const PINNED_FORMS: readonly (readonly [SpeciesId, string, number])[] = [
  [SpeciesId.CHARIZARD, "mega-z", 4],
  [SpeciesId.GALLADE, "mega-z", 2],
  [SpeciesId.BAXCALIBUR, "mega-z", 2],
  [SpeciesId.MELMETAL, "mega", 2],
  [SpeciesId.ARCHALUDON, "", 0],
  [SpeciesId.ARCHALUDON, "mega", 1],
];

/** The numeric members of a TS enum, name -> value */
function numericMembers(enumObject: Record<string, string | number>): [string, number][] {
  return Object.entries(enumObject).filter((entry): entry is [string, number] => typeof entry[1] === "number");
}

describe("Local fork - save-compatibility pins (append only, never insert: saves store these numbers)", () => {
  describe.each(Object.entries(PINNED_ENUMS))("%s", (_name, { enumObject, pins, contiguousBlock }) => {
    it("keeps every pinned fork member at its saved number, with no other member on it", () => {
      for (const [member, value] of Object.entries(pins)) {
        expect(enumObject[member], member).toBe(value);
        // The reverse mapping: no later member was given the same number
        expect(enumObject[value], `${value}`).toBe(member);
      }
    });

    it("has no two members sharing a number", () => {
      const values = numericMembers(enumObject).map(([, value]) => value);
      expect(new Set(values).size).toBe(values.length);
    });

    if (contiguousBlock) {
      it("has no unpinned member inside the pinned block (new ones are appended after it)", () => {
        const pinnedValues = Object.values(pins);
        const first = Math.min(...pinnedValues);
        const last = Math.max(...pinnedValues);
        const inserted = numericMembers(enumObject).filter(
          ([member, value]) => value >= first && value <= last && !Object.hasOwn(pins, member),
        );
        expect(inserted).toEqual([]);
      });
    }
  });

  it.each(
    PINNED_FORMS.map(([speciesId, formKey, index]) => ({ name: SpeciesId[speciesId], speciesId, formKey, index })),
  )("keeps $name's form '$formKey' at index $index", ({ speciesId, formKey, index }) => {
    expect(speciesDataRegistry.getSpecies(speciesId).forms[index]?.formKey).toBe(formKey);
  });
});
