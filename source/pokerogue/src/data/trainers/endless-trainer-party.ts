/*
 * Local fork (2026-11-08), the user: "얘네가 사용하는 포켓몬이랑 포켓몬 개수도 좀 만져둬야" (high Endless waves still had
 * trainers with one or two Pokémon). Standard Endless / Spliced Endless trainer battles fill the party template up to
 * a minimum size that grows with the wave. Only trainers of a plain trainer battle are filled (see `Battle`); Mystery
 * Encounter trainers keep their designed teams.
 */

import { speciesDataRegistry } from "#app/global-species-data-registry";
import { NON_LEGEND_PARADOX_POKEMON, NON_LEGEND_ULTRA_BEASTS } from "#balance/special-species-groups";
import type { PokemonSpecies } from "#data/pokemon-species";
import type { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import type { Pokemon } from "#field/pokemon";
import type { TrainerConfig } from "#trainers/trainer-config";
import { TrainerPartyCompoundTemplate, TrainerPartyTemplate } from "#trainers/trainer-party-template";
import type { ArenaPokemonPools } from "#types/biomes";

/** Local fork (2026-11-08): the first Endless wave whose trainers get the minimum party size. */
export const ENDLESS_TRAINER_FILL_START_WAVE = 100;

/** Local fork (2026-11-08): a trainer side never has more than this many Pokémon (pair trainers share it). */
export const MAX_TRAINER_PARTY_SIZE = 6;

/**
 * Local fork (2026-11-08): the smallest party a standard Endless trainer has on `waveIndex`:
 * `min(6, 2 + floor(wave / 100))` from wave 100 (100: 3, 200: 4, 300: 5, 400+: 6), no minimum before.
 * A pair (double) trainer counts the party the two share.
 * @param waveIndex - The wave of the battle
 * @returns The minimum size, `0` before wave 100
 */
export function getEndlessTrainerMinPartySize(waveIndex: number): number {
  if (waveIndex < ENDLESS_TRAINER_FILL_START_WAVE) {
    return 0;
  }
  return Math.min(MAX_TRAINER_PARTY_SIZE, 2 + Math.floor(waveIndex / 100));
}

/**
 * Local fork (2026-11-08), review fix: the slot function an extra member (`index` past the trainer's own template of
 * `ownSize`) reuses when every one of the trainer's own slots comes from a slot function (`partyMemberFuncs[0]` to
 * `[ownSize - 1]`). Twins, Young Couple and Mysterious Sisters keep their species pools only there; without this their
 * extras went through the generic path, which rolls any species of the whole dex. Extras go through the slots in turn,
 * so each trainer of a pair keeps its own pool and trainer slot.
 * @param partyMemberFuncs - The trainer config's slot functions
 * @param ownSize - The size of the trainer's own template
 * @param index - The party index being generated
 * @returns The slot function's index, or `undefined` when the slot keeps the normal path
 */
export function getEndlessFillSlotFuncIndex(
  partyMemberFuncs: Readonly<Record<number, unknown>>,
  ownSize: number,
  index: number,
): number | undefined {
  if (ownSize <= 0 || index < ownSize) {
    return undefined;
  }
  for (let i = 0; i < ownSize; i++) {
    if (!Object.hasOwn(partyMemberFuncs, i)) {
      return undefined;
    }
  }
  return index % ownSize;
}

/**
 * Local fork (2026-11-08), review fix: the seed group of member `index` for a trainer whose members share one seed
 * (`useSameSeedForAllMembers`: Twins, Young Couple, Mysterious Sisters). The trainer's own slots keep group 0 as before;
 * each extra gets its own group (its index). With one shared seed every extra repeated the first members' rolls, and
 * Pokémon rolled from the same seed also get the same id (held items are matched by id).
 * @param ownSize - The size of the trainer's own template (`0` outside an Endless fill)
 * @param index - The party index being generated
 * @returns The group, used where the seed offset would use the index
 */
export function getEndlessFillSeedGroup(ownSize: number, index: number): number {
  return ownSize <= 0 || index < ownSize ? 0 : index;
}

/** Filled templates by base template and size, so each one is built once and keeps its identity. */
const filledTemplates = new WeakMap<TrainerPartyTemplate, Map<number, TrainerPartyTemplate>>();

/**
 * Local fork (2026-11-08): `template` filled up to {@linkcode getEndlessTrainerMinPartySize} for `waveIndex`; a template
 * that is already that large is returned as is. The extra members use the strength and evolution threshold kind of the
 * template's first slot and go in before its last part, so the template's ace (its last slot, where trainers' negative
 * party member functions point) stays last. They are rolled by `Trainer.genPartyMember` like the others: same species
 * pools, own seed offsets, levels from `getPartyLevels`.
 * @param template - The trainer's own party template
 * @param waveIndex - The wave of the battle
 * @returns The template to use
 */
export function fillEndlessTrainerPartyTemplate(
  template: TrainerPartyTemplate,
  waveIndex: number,
): TrainerPartyTemplate {
  const minSize = getEndlessTrainerMinPartySize(waveIndex);
  if (template.size >= minSize) {
    return template;
  }

  let bySize = filledTemplates.get(template);
  if (!bySize) {
    bySize = new Map();
    filledTemplates.set(template, bySize);
  }
  const cached = bySize.get(minSize);
  if (cached) {
    return cached;
  }

  const extra = new TrainerPartyTemplate(
    minSize - template.size,
    template.getStrength(0),
    false,
    false,
    template.getEvoThresholdKind(0),
  );
  let filled: TrainerPartyTemplate;
  if (template instanceof TrainerPartyCompoundTemplate) {
    const parts = [...template.templates];
    parts.splice(parts.length - 1, 0, extra);
    filled = new TrainerPartyCompoundTemplate(...parts);
  } else {
    filled = new TrainerPartyCompoundTemplate(template, extra);
  }
  bySize.set(minSize, filled);
  return filled;
}

/**
 * Local fork (2026-11-08): the extra members of `template` filled up to `filled` (see
 * {@linkcode fillEndlessTrainerPartyTemplate}): they start after every part but the last of a compound template, after
 * the whole template otherwise.
 * @param template - The trainer's own party template
 * @param filled - The template the battle uses
 * @returns The first party index of the extras and how many there are (`0` when nothing was added)
 */
export function getEndlessFillExtraRange(
  template: TrainerPartyTemplate,
  filled: TrainerPartyTemplate,
): { start: number; count: number } {
  const count = filled.size - template.size;
  if (count <= 0) {
    return { start: template.size, count: 0 };
  }
  const lastPart = template instanceof TrainerPartyCompoundTemplate ? template.templates.at(-1) : undefined;
  return { start: template.size - (lastPart?.size ?? 0), count };
}

/*
 * Local fork (2026-11-08), the user: "트레이너들이 기존에 쓰던 엔트리에서 추가되는 엔트리들은 어느정도의 종족값 이상을 가진게
 * '적어도 하나' 정도가 되게 해주세요, 트레이너들이 각자의 개성을 유지하는 엔트리를 짜면서도 강력한 개체를 하나정도 가지고 있도록".
 * Among the extras of an Endless fill at least one is strong; `Trainer.genPartyMember` re-rolls one extra when none is.
 */

/**
 * Local fork (2026-11-08): the base stat total an Endless extra needs to count as the strong one (Gyarados, Kingdra,
 * Snorlax and Milotic 540, Arcanine 555, pseudo-legendaries 600).
 */
export const STRONG_EXTRA_MIN_BST = 540;

/** Local fork (2026-11-08): how many times the strong extra is re-rolled from its own source before a direct pick. */
export const STRONG_EXTRA_SOURCE_REROLLS = 10;

/** Local fork (2026-11-08): how many species one direct pick list tries for the strong extra. */
export const STRONG_EXTRA_DIRECT_PICKS = 10;

/**
 * Local fork (2026-11-08): whether `species` may be the strong extra: no legendary, sub-legendary (Ultra Beasts
 * included), mythical or Paradox species.
 */
export function isStrongExtraSpeciesAllowed(species: PokemonSpecies): boolean {
  return (
    !species.legendary
    && !species.subLegendary
    && !species.mythical
    && !NON_LEGEND_PARADOX_POKEMON.includes(species.speciesId)
    && !NON_LEGEND_ULTRA_BEASTS.includes(species.speciesId)
  );
}

/**
 * Local fork (2026-11-08): whether `species` (its base form) can be the strong extra: allowed
 * ({@linkcode isStrongExtraSpeciesAllowed}) with a base stat total of at least {@linkcode STRONG_EXTRA_MIN_BST}.
 * Local fork (2026-11-09): `legendsAllowed` (the elite trainers' rule, {@linkcode isEndlessEliteLegendBattle}) lets the
 * legend group (legendary, sub-legendary, mythical, Ultra Beast, Paradox) count too.
 */
export function isStrongExtraSpecies(species: PokemonSpecies, legendsAllowed = false): boolean {
  return (legendsAllowed || isStrongExtraSpeciesAllowed(species)) && species.getBaseStatTotal() >= STRONG_EXTRA_MIN_BST;
}

/**
 * Local fork (2026-11-08): whether an extra counts as the strong one: an allowed species
 * ({@linkcode isStrongExtraSpeciesAllowed}) whose form, as generated, has a base stat total of at least
 * {@linkcode STRONG_EXTRA_MIN_BST}. A fusion counts its head, the species the trainer picked.
 * Local fork (2026-11-09): with `legendsAllowed` (the elite trainers' rule) a legend-group species counts too.
 */
export function isStrongEndlessExtra(pokemon: Pokemon, legendsAllowed = false): boolean {
  return (
    (legendsAllowed || isStrongExtraSpeciesAllowed(pokemon.species))
    && pokemon.getSpeciesForm(true).getBaseStatTotal() >= STRONG_EXTRA_MIN_BST
  );
}

/** Local fork (2026-11-09): the strong species lists without (`false`) and with (`true`) the legend group, built once. */
const strongExtraSpecies = new Map<boolean, readonly SpeciesId[]>();

/**
 * Local fork (2026-11-08): every species a direct pick may give the strong extra: catchable, allowed for trainers and as
 * the strong extra, base stat total of at least {@linkcode STRONG_EXTRA_MIN_BST}. Built once, in dex order.
 * Local fork (2026-11-09): with `legendsAllowed` (the elite trainers' rule) the legend group is in too: the catchable
 * legendaries, sub-legendaries (Ultra Beasts included) and mythicals, and the Paradox species, which `isCatchable`
 * keeps out of the random dex roll (the END biome pools have them). The other species `isCatchable` blocks (Mew,
 * Celebi, Jirachi, Deoxys, Phione, Manaphy, Arceus, Victini, Meltan, Melmetal, Eternatus, Pecharunt) stay out.
 */
export function getStrongExtraSpecies(legendsAllowed = false): readonly SpeciesId[] {
  let strong = strongExtraSpecies.get(legendsAllowed);
  if (!strong) {
    strong = speciesDataRegistry
      .getAllSpecies()
      .filter(
        s =>
          (s.isCatchable() || (legendsAllowed && NON_LEGEND_PARADOX_POKEMON.includes(s.speciesId)))
          && !s.isTrainerForbidden()
          && isStrongExtraSpecies(s, legendsAllowed),
      )
      .map(s => s.speciesId);
    strongExtraSpecies.set(legendsAllowed, strong);
  }
  return strong;
}

/**
 * Local fork (2026-11-08): the strong species ({@linkcode getStrongExtraSpecies}) in the lines of `speciesIds`: each
 * species and everything it can evolve into.
 * Local fork (2026-11-09): `legendsAllowed` reads the list with the legend group.
 */
export function getStrongExtraLines(speciesIds: Iterable<SpeciesId>, legendsAllowed = false): SpeciesId[] {
  const strong = new Set(getStrongExtraSpecies(legendsAllowed));
  const lines = new Set<SpeciesId>();
  for (const speciesId of speciesIds) {
    for (const s of [speciesId, ...speciesDataRegistry.getEvolutionChain(speciesId)]) {
      if (strong.has(s)) {
        lines.add(s);
      }
    }
  }
  return [...lines];
}

const trainerStrongPools = new WeakMap<TrainerConfig, readonly SpeciesId[]>();

/**
 * Local fork (2026-11-08): the strong species a trainer's own pool can give a member of the generic path: the lines of
 * its species pools (each tier's plain entries, as `Trainer.genNewPartyMemberSpecies` rolls them), or without pools the
 * lines of the species its filter lets `BattleScene.randomSpecies` roll (it rolls their first stage).
 * @param config - The trainer's config
 * @returns The species, in a fixed order; empty when the pool can never give a strong member
 */
export function getTrainerStrongExtraPool(config: TrainerConfig): readonly SpeciesId[] {
  let pool = trainerStrongPools.get(config);
  if (!pool) {
    const rolled: SpeciesId[] = config.speciesPools
      ? Object.values(config.speciesPools).flatMap(tier => tier.filter((s): s is SpeciesId => typeof s === "number"))
      : speciesDataRegistry
          .getAllSpecies()
          .filter(s => s.isCatchable() && config.speciesFilter(s))
          .map(s => s.getRootSpeciesId());
    pool = getStrongExtraLines(rolled);
    trainerStrongPools.set(config, pool);
  }
  return pool;
}

/*
 * Local fork (2026-11-09), the user: "원래도 엘리트 트레이너였던 녀석들은 어느정도 웨이브 지나면 전설 허용룰로 하죠" (trainers
 * that were already elite trainers play under a "legendaries allowed" rule past a certain wave). Their own templates
 * field six from about wave 80, so the strong-extra rule above never reached them. From
 * {@linkcode ENDLESS_ELITE_LEGEND_WAVE} on, a standard Endless / Spliced Endless battle of one of
 * {@linkcode ENDLESS_ELITE_TRAINER_TYPES} makes sure the whole party has one strong member, legend group allowed
 * (`Trainer.rollStrongEndlessExtra` with `legends`).
 */

/**
 * Local fork (2026-11-09): the trainer classes that play under the elite "legendaries allowed" rule: the ones called
 * 엘리트 트레이너 / 엘리트 콤비 (Ace Trainer and Snow Ace Trainer, both genders and their Ace Duo pairs).
 */
export const ENDLESS_ELITE_TRAINER_TYPES: readonly TrainerType[] = [
  TrainerType.ACE_TRAINER,
  TrainerType.SNOW_ACE_TRAINER,
];

/** Local fork (2026-11-09): the first Endless wave on which the elite trainers' "legendaries allowed" rule applies. */
export const ENDLESS_ELITE_LEGEND_WAVE = 300;

/**
 * Local fork (2026-11-09): whether a trainer of `trainerType` in a standard Endless trainer battle on `fillWave` (the
 * trainer's `forkEndlessFillWave`, `undefined` outside such battles) plays under the elite "legendaries allowed" rule.
 */
export function isEndlessEliteLegendBattle(trainerType: TrainerType, fillWave: number | undefined): boolean {
  return fillWave != null && fillWave >= ENDLESS_ELITE_LEGEND_WAVE && ENDLESS_ELITE_TRAINER_TYPES.includes(trainerType);
}

const poolStrongSpecies = new WeakMap<ArenaPokemonPools, readonly SpeciesId[]>();

/**
 * Local fork (2026-11-09): the strong species, legend group allowed ({@linkcode getStrongExtraLines}), in the lines of
 * every species of an arena's current pools: every tier, the boss tiers (where biome legendaries live) included.
 * @param pools - The arena's pools for the current time of day (`Arena.getForkPokemonPools`)
 * @returns The species, in pool order
 */
export function getStrongPoolSpecies(pools: ArenaPokemonPools): readonly SpeciesId[] {
  let strong = poolStrongSpecies.get(pools);
  if (!strong) {
    strong = getStrongExtraLines(Object.values(pools).flat(), true);
    poolStrongSpecies.set(pools, strong);
  }
  return strong;
}
