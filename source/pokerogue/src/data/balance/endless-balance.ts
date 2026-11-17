/**
 * Endless-only balance knobs of the local fork (the user's "엔드리스 제한 해제", 2026-11-02).
 *
 * Classic, Challenge and Daily keep the base game's values: every function here returns the base
 * value unless the current game mode is Endless or Spliced Endless, and the held-item caps only
 * apply to the player's Pokémon (enemies already scale through their tokens).
 */
import { globalScene } from "#app/global-scene";
import { ModifierTier } from "#enums/modifier-tier";
import type { Pokemon } from "#field/pokemon";

/** Held-item stack caps for the player's Pokémon in Endless; the base caps are in the comments. */
export const ENDLESS_HELD_ITEM_CAPS = {
  /**
   * Every berry type (base 2 for Lum, Leppa, Sitrus and Enigma, 3 for the rest). 99 until 2026-11-06, then 20
   * (the user's request). Stacks already above 20 are kept when a save loads (see `ModifierData.toModifier`) and
   * simply can't grow until they have been eaten down below 20.
   */
  BERRY: 20,
  /** 먹다남은음식, TurnHealModifier (base 4) */
  LEFTOVERS: 6,
  /** 조개껍질방울, HitHealModifier (base 4) */
  SHELL_BELL: 8,
  /** 끈기갈고리손톱, ContactHeldItemTransferChanceModifier (base 5) */
  GRIP_CLAW: 7,
  /** 선제공격손톱, BypassSpeedChanceModifier (base 3) */
  QUICK_CLAW: 5,
} as const;

export type EndlessCappedItem = keyof typeof ENDLESS_HELD_ITEM_CAPS;

/**
 * Held-item stack caps for the player's Pokémon in every mode (the user's request, 2026-11-05). Enemies keep
 * the base cap, so trainers can't stack Scope Lenses into guaranteed crits. Known and accepted, like the Endless
 * caps: encounters that copy the player's team onto enemies (Weird Dream, Training Session, Dark Deal) copy the
 * player's stacks too.
 */
export const PLAYER_HELD_ITEM_CAPS = {
  /** 초점렌즈, CritBoosterModifier (base 1); +1 crit stage per lens, so 3 always crit */
  SCOPE_LENS: 3,
  /**
   * 멀티렌즈, PokemonMultiHitModifier (base 2); the first hit stays at 75%, each lens adds a 25% hit. Local fork
   * (2026-11-13): 10 명세 1번, 4 -> 3 ("총 4연타: 첫 타 75% + 추가 3타 × 25% = 총합 ×1.50"). An older save's 4 lenses
   * are trimmed to 3 on load, like any over-cap held item (`ModifierData.toModifier`); for a stack that never went
   * through a save load (overrides, an encounter's copy), only 3 strike (`PokemonMultiHitModifier.getEffectiveStackCount`).
   */
  MULTI_LENS: 3,
  /** 돌격조끼 (fork item, base 1); +50% Sp. Def per vest, added up */
  ASSAULT_VEST: 3,
  /** 방탄조끼 (fork item, base 1); +50% Defense per vest, added up */
  BULLETPROOF_VEST: 3,
  /** 프리즘 (fork item, base 1); the partner takes 50/75/100% of each hit with 1/2/3 Prisms */
  PRISM: 3,
} as const;

export type PlayerCappedItem = keyof typeof PLAYER_HELD_ITEM_CAPS;

/**
 * The stack cap of a held item for `pokemon`: {@linkcode PLAYER_HELD_ITEM_CAPS} for the player's Pokémon in
 * every mode, otherwise `baseCap`.
 */
export function playerHeldItemCap(pokemon: Pokemon | undefined, baseCap: number, item: PlayerCappedItem): number {
  return pokemon?.isPlayer() ? Math.max(baseCap, PLAYER_HELD_ITEM_CAPS[item]) : baseCap;
}

/** Set by {@linkcode withEndlessCapMode} while a past run is shown (Run History) */
let capModeOverride: boolean | undefined;

/**
 * Evaluates `fn` with the held-item caps of the given mode instead of the current game mode, e.g. to
 * show a past Endless run's item counts from the title screen.
 */
export function withEndlessCapMode<T>(isEndless: boolean, fn: () => T): T {
  const previous = capModeOverride;
  capModeOverride = isEndless;
  try {
    return fn();
  } finally {
    capModeOverride = previous;
  }
}

function isEndlessPlayer(pokemon?: Pokemon): boolean {
  return !!pokemon?.isPlayer() && (capModeOverride ?? !!globalScene?.gameMode?.isEndless);
}

/**
 * The stack cap of a held item for `pokemon`: the Endless cap for the player's Pokémon in Endless,
 * otherwise `baseCap` (never lower than the base cap).
 */
export function endlessHeldItemCap(pokemon: Pokemon | undefined, baseCap: number, item: EndlessCappedItem): number {
  if (!isEndlessPlayer(pokemon)) {
    return baseCap;
  }
  return Math.max(baseCap, ENDLESS_HELD_ITEM_CAPS[item]);
}

/** Counts out of 1024 in the order COMMON, GREAT, ULTRA, ROGUE, MASTER */
export type TierCounts = readonly [number, number, number, number, number];

/** The base game's tier odds: 75.0% / 19.0% / 4.7% / 1.2% / 0.1% */
export const BASE_TIER_COUNTS: TierCounts = [768, 195, 48, 12, 1];

/**
 * Anchor points of the Endless reward tier curve for the player's reward pool: the odds the user chose at each
 * wave. The first anchor equals the base game; later ones move weight from COMMON to the rarer tiers. MASTER
 * grows slowly on purpose: the Endless MASTER pool is small (Shiny Charm, Healing Charm, Multi Lens, DNA
 * Splicers, Mini Black Hole, the vests and Prism; since 2026-11-09 the three Choice items too), and an emptied tier
 * falls back to ROGUE.
 *
 * 2026-11-06 (the user): COMMON at luck 0 is about 55% of all rewards at the third anchor and about 40% at the fourth
 * (COMMON count = target × 1024 / (1 - 4/128), since luck 0 still upgrades 1 roll in 32). The freed weight went
 * to GREAT, ULTRA and ROGUE in their old ratio; MASTER stays at 6 and 12.
 *
 * Until 2026-11-06 these were steps (each held until the next one). Since then the odds follow a curve through
 * them, see {@linkcode getEndlessTierWeights}.
 *
 * Local fork (2026-11-13): the anchor waves moved from 0 / 200 / 500 / 1000 to 0 / 300 / 1000 / 2200, each anchor
 * keeping its counts (08 명세 3번: "각 기준점의 가중치 배열은 유지하되 도달 웨이브만 확장"). The reward screen's duplicate check
 * no longer lumps every group-less item into one group (`isSameRewardGroup`), which made the ace's items come about
 * 25-50% sooner; the slower curve is meant to bring the "every capped item" wave to about 2,500-3,000.
 */
export const ENDLESS_TIER_ANCHORS: readonly { wave: number; counts: TierCounts }[] = [
  { wave: 0, counts: BASE_TIER_COUNTS },
  { wave: 300, counts: [704, 224, 72, 22, 2] },
  { wave: 1000, counts: [581, 277, 111, 49, 6] },
  { wave: 2200, counts: [423, 346, 151, 92, 12] },
];

/**
 * Past the last anchor, the waves it takes the curve to close about 63% (1 - 1/e) of the remaining gap to its
 * limit. Local fork (2026-11-13): 1800, was 1000 (08 명세 3번). The limit is `last + slope × tail` with the slope of the
 * 1000-2200 stretch, so it is now 186/449/211/157/21 (COMMON about 18%, MASTER about 2.1%), not the old
 * 107/484/231/178/24 (which needed tail = 2 × the last stretch; this is 1.5 ×). Wave 3000 is about 338/383/173/115/15,
 * wave 4000 about 273/412/189/132/18 and wave 5850 about 217/436/203/148/20.
 */
export const ENDLESS_TIER_TAIL_WAVES = 1800;

/**
 * The real-valued tier counts (out of 1024, COMMON..MASTER) at `wave` in Endless (the user's request, 2026-11-06:
 * "함수처럼 만들어서 더 웨이브가 올라가도 자연스럽게 상위 등급 비율이 올라가도록").
 * - Between two anchors: a straight line, so each anchor wave gets exactly the odds chosen for it.
 * - Past the last anchor: each tier keeps the slope of the last stretch at the joint and levels off toward a
 *   limit, `limit + (last - limit) * e^(-(wave - last wave) / tail)`, with `limit = last + slope * tail`. The
 *   slopes add up to zero, so the counts still sum to 1024 and the rarer tiers only grow.
 */
export function getEndlessTierWeights(wave: number): number[] {
  const anchors = ENDLESS_TIER_ANCHORS;
  if (wave <= anchors[0].wave) {
    return [...anchors[0].counts];
  }
  for (let i = 1; i < anchors.length; i++) {
    const to = anchors[i];
    if (wave <= to.wave) {
      const from = anchors[i - 1];
      const t = (wave - from.wave) / (to.wave - from.wave);
      return from.counts.map((c, k) => c + (to.counts[k] - c) * t);
    }
  }
  const last = anchors.at(-1)!;
  const prev = anchors.at(-2)!;
  const decay = Math.exp(-(wave - last.wave) / ENDLESS_TIER_TAIL_WAVES);
  return last.counts.map((c, k) => {
    const slope = (c - prev.counts[k]) / (last.wave - prev.wave);
    const limit = c + slope * ENDLESS_TIER_TAIL_WAVES;
    return limit + (c - limit) * decay;
  });
}

/**
 * Whole tier counts for {@linkcode tierFromRoll} at `wave` in Endless. The running totals from MASTER upward
 * ("this tier or rarer") are rounded, not each tier, so every one of those chances only grows with the wave and
 * the anchor waves reproduce their counts exactly.
 */
export function getEndlessTierCounts(wave: number): TierCounts {
  const [, great, ultra, rogue, master] = getEndlessTierWeights(wave);
  const m = Math.round(master);
  const r = Math.round(master + rogue);
  const u = Math.round(master + rogue + ultra);
  const g = Math.round(master + rogue + ultra + great);
  return [1024 - g, g - u, u - r, r - m, m];
}

/**
 * Maps a roll in `[0, 1024)` to a tier with the given counts. Like the base game, the low rolls are
 * the rare tiers: roll 0 is MASTER with the base counts.
 */
export function tierFromRoll(tierValue: number, counts: TierCounts): ModifierTier {
  const [, great, ultra, rogue, master] = counts;
  if (tierValue < master) {
    return ModifierTier.MASTER;
  }
  if (tierValue < master + rogue) {
    return ModifierTier.ROGUE;
  }
  if (tierValue < master + rogue + ultra) {
    return ModifierTier.ULTRA;
  }
  if (tierValue < master + rogue + ultra + great) {
    return ModifierTier.GREAT;
  }
  return ModifierTier.COMMON;
}

/** `true` when the player's reward tier roll should use the Endless band table */
export function usesEndlessTierBands(): boolean {
  return !!globalScene?.gameMode?.isEndless;
}

/** The current wave, or 0 before the first battle exists (e.g. while starting a run) */
export function currentWave(): number {
  return globalScene?.currentBattle?.waveIndex ?? 0;
}

/**
 * Held items that rewards leave out while even one of the player's Pokémon holds the cap, in every mode (the user's
 * requests of 2026-11-06: berries first, then the Wide Lens, then "배턴, 부활의씨앗 등도"; doc §6-7). These are the
 * plain held items of the player's reward pool. The same list, with {@linkcode FULL_RULE_GENERATED_ITEM_IDS},
 * decides what the player's steal rolls skip.
 */
export const FULL_RULE_HELD_ITEM_IDS: ReadonlySet<string> = new Set([
  // GREAT
  "SOOTHE_BELL",
  // ULTRA
  "REVIVER_SEED",
  "QUICK_CLAW",
  "GOLDEN_PUNCH",
  "LEEK",
  "EVIOLITE",
  "RED_EVOLUTION_CRYSTAL", // Local fork (2026-11-09)
  "BLUE_EVOLUTION_CRYSTAL", // Local fork (2026-11-09)
  "TOXIC_ORB",
  "FLAME_ORB",
  "MYSTICAL_ROCK",
  "WIDE_LENS",
  "PUNCHING_GLOVE", // Local fork (2026-11-11): one per Pokémon
  "METRONOME", // Local fork (2026-11-11): up to 3
  "FUEL", // Local fork (2026-11-11): up to 3
  "THROAT_SPRAY", // Local fork (2026-11-11): one per Pokémon
  "MUSCLE_BAND", // Local fork (2026-11-11): up to 99 like the type boosters
  "WISE_GLASSES", // Local fork (2026-11-11): up to 99 like the type boosters
  "WEIGHT_BAND", // Local fork (2026-11-12): up to 3
  // ROGUE
  "BATON",
  "LEFTOVERS",
  "SHELL_BELL",
  "GRIP_CLAW",
  "SCOPE_LENS",
  "SOUL_DEW",
  "FOCUS_BAND",
  "KINGS_ROCK",
  "LIFE_ORB",
  "TRAINING_SHACKLES", // Local fork (2026-11-09): up to 2
  "FLAME_CAULDRON", // Local fork (2026-11-09)
  "RADIOACTIVE_WASTE", // Local fork (2026-11-09)
  "TOXIC_DISTILLER", // Local fork (2026-11-10)
  "DISCHARGED_COIL", // Local fork (2026-11-10)
  "POWER_HERB", // Local fork (2026-11-11): up to 2
  "LOADED_DICE", // Local fork (2026-11-11): one per Pokémon
  "SEED_POUCH", // Local fork (2026-11-11): one per Pokémon
  "EXPERT_BELT", // Local fork (2026-11-11): one per Pokémon
  "PRECISION_LENS", // Local fork (2026-11-11): up to 2
  "CLEAR_AMULET", // Local fork (2026-11-11): one per Pokémon
  "BOOSTER_ENERGY", // Local fork (2026-11-11): one per Pokémon
  // Local fork (2026-11-12): the six EV items, one per Pokémon (their own weight already leaves each out while anyone
  // in the party holds it)
  "POWER_WEIGHT",
  "POWER_BRACER",
  "POWER_BELT",
  "POWER_LENS",
  "POWER_BAND",
  "POWER_ANKLET",
  // MASTER
  "MULTI_LENS",
  "MINI_BLACK_HOLE",
  "ASSAULT_VEST",
  "BULLETPROOF_VEST",
  "PRISM",
  // Local fork (2026-11-09): one per Pokémon, so one holder is enough to leave each out
  "CHOICE_BAND",
  "CHOICE_SCARF",
  "CHOICE_SPECS",
  "CHOICE_ARMOR", // Local fork (2026-11-09)
  "ULTIMATE_GENE", // Local fork (2026-11-09)
  "MASTER_PUNCHING_GLOVE", // Local fork (2026-11-11): one per Pokémon
  "CHAMPION_BELT", // Local fork (2026-11-12): one per Pokémon
]);

/**
 * Generated held items under the same rule, one kind at a time (a berry type, a move type, a species item): their
 * generators leave out only the kinds someone holds at the cap.
 */
export const FULL_RULE_GENERATED_ITEM_IDS: ReadonlySet<string> = new Set([
  "BERRY",
  "ATTACK_TYPE_BOOSTER",
  "SPECIES_STAT_BOOSTER",
  "RARE_SPECIES_STAT_BOOSTER",
]);

/**
 * Local fork (2026-11-10): held items that count as another one for the full-item rule. A Flame Furnace (불꽃화로) is a
 * Flame Cauldron that swallowed a Flame Orb, so a party holding one gets no more cauldrons (the user's bug report:
 * "불꽃화로가 있는데 화염가마솥이 나옴"). Local fork (2026-11-10): the same for a Toxic Distillate (맹독증류액) and the Toxic
 * Distiller (맹독증류기).
 */
const FULL_RULE_ALSO_COUNTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  FLAME_CAULDRON: Object.freeze(["FLAME_FURNACE"]),
  TOXIC_DISTILLER: Object.freeze(["TOXIC_DISTILLATE"]), // Local fork (2026-11-10)
  DISCHARGED_COIL: Object.freeze(["SUPERCONDUCTING_COIL"]), // Local fork (2026-11-10)
  // Local fork (2026-11-11): a Master Punching Glove holder is full for plain gloves too (it is never given one), so
  // holding the better glove leaves the plain one out like holding a plain one does (the same case as the user's
  // "불꽃화로가 있는데 화염가마솥이 나옴")
  PUNCHING_GLOVE: Object.freeze(["MASTER_PUNCHING_GLOVE"]),
});

/**
 * Whether one of the player's Pokémon in `party` holds the held item with type id `typeId` at or above its cap
 * (Local fork (2026-11-10): or an item {@linkcode FULL_RULE_ALSO_COUNTS} counts as it)
 */
export function partyHoldsMax(party: readonly Pokemon[], typeId: string): boolean {
  const ids = [typeId, ...(FULL_RULE_ALSO_COUNTS[typeId] ?? [])];
  return party.some(
    p =>
      p.isPlayer()
      && p.getHeldItems().some(i => ids.includes(i.type.id) && i.getStackCount() >= i.getMaxHeldItemCount(p)),
  );
}
