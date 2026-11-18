/**
 * Local fork (2026-11-18): "우두머리!" (Alpha!, ALPHA_ENCOUNTER), the user's request: "우두머리! 라는 이름의 우두머리 조우
 * 미스터리 조우를 넣어두고 … 1. 우두머리와 싸운다 2. 도망친다 로 하고 미스터리 조우 설명은 나중에 넣는걸로". An alpha
 * Pokémon (alpha-pokemon.ts) of the biome blocks the way.
 *
 * Local fork (2026-11-18): the user: "우두머리 조우에서 전설/환상이 매우 낮은 확률로 나올 수는 있도록 하고, 검은색 실루엣이
 * 보이도록 하죠." 1 time in {@linkcode ALPHA_LEGEND_ONE_IN} the alpha is a legend-like Pokémon of the biome
 * ({@linkcode drawLegendAlphaSpecies}), and the intro shows the Pokémon as a black silhouette, so its texts no longer
 * name it before the battle.
 */
import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { ALPHA_SPRITE_SCALE, forceWildAlpha } from "#data/alpha-pokemon";
import type { PokemonSpecies } from "#data/pokemon-species";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import type { EnemyPartyConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  getRandomEncounterPokemon,
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
} from "#mystery-encounters/encounter-phase-utils";
import { getEncounterPokemonLevelForWave, getSpriteKeysFromPokemon } from "#mystery-encounters/encounter-pokemon-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { PokemonData } from "#system/pokemon-data";
import { randSeedInt, randSeedItem } from "#utils/common";

/** i18n namespace for the encounter */
const namespace = "mysteryEncounters/alphaEncounter";

/**
 * How many times the alpha's draw is redone when it comes out legendary, sub-legendary or mythical, as arena.ts redoes
 * a legend-like draw of the wrong level up to 10 times (`checkLegendBST`)
 */
export const ALPHA_LEGEND_REROLLS = 10;

/**
 * Local fork (2026-11-18): the user: "우두머리 조우에서 전설/환상이 매우 낮은 확률로 나올 수는 있도록 하고". The alpha is a
 * legend-like Pokémon of the biome 1 time in this many ({@linkcode drawLegendAlphaSpecies}). "전설/환상" (legendary /
 * mythical) is taken as every legend-like: sub-legendaries count with legendaries and mythicals.
 */
export const ALPHA_LEGEND_ONE_IN = 100;

/**
 * Whether a species is legendary, sub-legendary or mythical (arena.ts's "legend-like"): an ordinary wild wave makes such
 * a Pokémon a boss (`getEncounterBossSegments`), and bosses are never alphas (alpha-pokemon.ts)
 */
function isLegendLike(species: PokemonSpecies): boolean {
  return species.legendary || species.subLegendary || species.mythical;
}

/**
 * Whether the game lets a legend-like species appear in the wild by this wave, as arena.ts's `checkLegendBST` decides
 * for an ordinary wild wave: one with a base stat total of 660 or more from adjusted wave 80, any other from 55
 * @param species - A legend-like species
 * @param adjustedWave - The wave adjusted for Daily Mode (`gameMode.getWaveForDifficulty(wave, true)`)
 */
function isLegendAllowedByWave(species: PokemonSpecies, adjustedWave: number): boolean {
  return species.baseTotal >= 660 ? adjustedWave >= 80 : adjustedWave >= 55;
}

/**
 * Local fork (2026-11-18): the species of the alpha when the 1-in-{@linkcode ALPHA_LEGEND_ONE_IN} roll comes up. The user:
 * "우두머리 조우에서 전설/환상이 매우 낮은 확률로 나올 수는 있도록 하고" (legendary, sub-legendary and mythical alike). Any
 * legend-like species of the current biome's own pools (every tier, boss tiers included, for the wave's time of day),
 * each equally likely, that the game's usual wave gate allows (`checkLegendBST`: a base stat total of 660 or more only
 * from adjusted wave 80, any other from 55), levelled as a wild one. Should levelling turn it into one the gate does not
 * allow yet (Cosmog into Solgaleo before wave 80, say), the one from the pool is kept.
 * @param waveIndex - The wave
 * @param level - The alpha's level
 * @returns The species, or `undefined` if the biome has no legend-like species the wave allows
 */
function drawLegendAlphaSpecies(waveIndex: number, level: number): PokemonSpecies | undefined {
  const adjustedWave = globalScene.gameMode.getWaveForDifficulty(waveIndex, true);
  const candidates = [...new Set(Object.values(globalScene.arena.getForkPokemonPools()).flat())]
    .map(id => speciesDataRegistry.getSpecies(id))
    .filter(s => isLegendLike(s) && isLegendAllowedByWave(s, adjustedWave));
  if (candidates.length === 0) {
    return;
  }

  const base = randSeedItem(candidates);
  const levelled = speciesDataRegistry.getSpecies(
    base.getWildSpeciesForLevel(level, true, false, globalScene.gameMode),
  );
  return isLegendLike(levelled) && isLegendAllowedByWave(levelled, adjustedWave) ? levelled : base;
}

/**
 * Local fork (2026-11-18): the species of the alpha when the 1-in-{@linkcode ALPHA_LEGEND_ONE_IN} roll does not give a
 * legend-like one ({@linkcode drawLegendAlphaSpecies}), so a legend-like alpha comes from that roll alone. The one an
 * ordinary wild wave would draw (encounter-phase.ts): the biome's pool for the wave and level, never a timed event's
 * Pokémon. A legend-like one is drawn again, up to {@linkcode ALPHA_LEGEND_REROLLS} times: the game never meets a
 * legendary, sub-legendary or mythical Pokémon as a catchable one-bar wild one (it is always a boss there, and a boss is
 * never an alpha), and this alpha is not a boss.
 * That also covers Endless waves past 250 that roll a random boss, where the draw comes from the biome's boss pools and
 * legend-likes come up more often. Should every draw be one, a species of the biome's pools that is not one is picked
 * and levelled as a wild one, and failing that any catchable species that is not one.
 * @param waveIndex - The wave
 * @param level - The alpha's level
 */
function drawAlphaSpecies(waveIndex: number, level: number): PokemonSpecies {
  let species = globalScene.randomSpecies(waveIndex, level, true);
  for (let reroll = 0; reroll < ALPHA_LEGEND_REROLLS && isLegendLike(species); reroll++) {
    species = globalScene.randomSpecies(waveIndex, level, true);
  }
  if (!isLegendLike(species)) {
    return species;
  }

  const biomeSpecies = Object.values(globalScene.arena.getForkPokemonPools())
    .flat()
    .map(id => speciesDataRegistry.getSpecies(id))
    .filter(s => !isLegendLike(s));
  const base =
    biomeSpecies.length > 0
      ? randSeedItem(biomeSpecies)
      : globalScene.randomSpecies(waveIndex, level, false, s => !isLegendLike(s));
  const levelled = speciesDataRegistry.getSpecies(
    base.getWildSpeciesForLevel(level, true, false, globalScene.gameMode),
  );
  return isLegendLike(levelled) ? base : levelled;
}

/**
 * The reward screen of an ordinary wild wave after the battle (won or caught): the plain `SelectModifierPhase` that
 * victory-phase.ts queues, with the usual item count, rerolls and Lock Capsule, and no guaranteed item.
 * (`setEncounterRewards({ fillRemaining: true })`, which other battle encounters use, gives the same items but rerolls
 * past the Lock Capsule's tier lock.)
 */
function setOrdinaryWildRewards(): void {
  globalScene.currentBattle.mysteryEncounter!.doEncounterRewards = () => {
    globalScene.phaseManager.unshiftNew("SelectModifierPhase");
    return true;
  };
}

/**
 * 우두머리! (Alpha!), local fork (the user, 2026-11-18). The description, query, tooltips and messages are placeholders
 * until the user writes them ("미스터리 조우 설명은 나중에 넣는걸로").
 * The intro shows the Pokémon as a black silhouette (the user: "검은색 실루엣이 보이도록 하죠"), and no text names it
 * before the battle.
 * 1. 우두머리와 싸운다 (Fight the alpha): a wild battle against one Pokémon of the biome's wild pool, picked and levelled
 *    as an ordinary wild wave picks it but never legendary, sub-legendary or mythical ({@linkcode drawAlphaSpecies}),
 *    except 1 time in {@linkcode ALPHA_LEGEND_ONE_IN}, when it is a legend-like one of the biome
 *    ({@linkcode drawLegendAlphaSpecies}). Always an alpha with the usual boost roll (1-20%) and its marks
 *    ({@linkcode forceWildAlpha}). Not a boss, even a legend-like one, so it can be caught like any wild Pokémon, and
 *    catching it records its boost for its line as usual (`registerAlpha`). Won or caught, the ordinary wild reward
 *    screen follows.
 * 2. 도망친다 (Run away): leave without a battle, as the other encounters' leave options do.
 * GREAT tier, in every biome (wild Pokémon live in all of them), the usual encounter waves, no party requirement.
 */
export const AlphaEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ALPHA_ENCOUNTER,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withCatchAllowed(true)
  .withHideWildIntroMessage(true)
  .withFleeAllowed(false)
  .withIntroSpriteConfigs([]) // Set in onInit()
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
  ])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    const { waveIndex } = globalScene.currentBattle;

    // The wave's wild level, and the species an ordinary wild wave would draw (encounter-phase.ts): the biome's pool,
    // never a timed event's Pokémon, and never a legend-like one (drawAlphaSpecies)
    const level = getEncounterPokemonLevelForWave();
    // Local fork (2026-11-18): the user: "우두머리 조우에서 전설/환상이 매우 낮은 확률로 나올 수는 있도록 하고". 1 time in
    // ALPHA_LEGEND_ONE_IN, a legend-like one of the biome instead (drawLegendAlphaSpecies), if the biome has one the
    // wave allows; still not a boss
    const legendSpecies = randSeedInt(ALPHA_LEGEND_ONE_IN) === 0 ? drawLegendAlphaSpecies(waveIndex, level) : undefined;
    const alpha = getRandomEncounterPokemon({
      level,
      isBoss: false,
      eventChance: 0,
      speciesFunction: () => legendSpecies ?? drawAlphaSpecies(waveIndex, level),
    });
    forceWildAlpha(alpha);
    // Local fork (2026-11-18): no dialogue token with the Pokémon's name: the intro only shows its silhouette, and the
    // texts do not name it before the battle
    encounter.misc = { alpha, legendLike: legendSpecies != null };

    const config: EnemyPartyConfig = {
      pokemonConfigs: [
        {
          level,
          species: alpha.species,
          // The data carries the boost and the marks into the battle
          dataSource: new PokemonData(alpha),
          isBoss: false,
        },
      ],
    };
    encounter.enemyPartyConfigs = [config];

    const { spriteKey, fileRoot } = getSpriteKeysFromPokemon(alpha);
    encounter.spriteConfigs = [
      {
        spriteKey,
        fileRoot,
        hasShadow: true,
        x: -5,
        repeat: true,
        isPokemon: true,
        isShiny: alpha.shiny,
        variant: alpha.variant,
        // 10% larger, as an alpha is drawn in battle
        scale: ALPHA_SPRITE_SCALE,
        // Local fork (2026-11-18): the user: "검은색 실루엣이 보이도록 하죠". Drawn fully black, as Mysterious
        // Challengers draws its trainers (the tint sprite gets the same 10% scale, mystery-encounter-intro.ts)
        tint: 1,
      },
    ];

    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.1.label`,
      buttonTooltip: `${namespace}:option.1.tooltip`,
      selected: [
        {
          text: `${namespace}:option.1.selected`,
        },
      ],
    },
    async () => {
      // Fight the alpha
      setOrdinaryWildRewards();
      await initBattleWithEnemyConfig(globalScene.currentBattle.mysteryEncounter!.enemyPartyConfigs[0]);
    },
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      selected: [
        {
          text: `${namespace}:option.2.selected`,
        },
      ],
    },
    async () => {
      // Run away: no battle, no rewards or EXP (the empty shop screen, as Fight or Flight's "Leave")
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
