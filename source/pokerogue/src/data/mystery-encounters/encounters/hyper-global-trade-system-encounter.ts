import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { settings } from "#app/global-settings-manager";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { Gender, getGenderSymbol } from "#data/gender";
import { getNatureName } from "#data/nature";
import type { PokemonSpecies } from "#data/pokemon-species";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import type { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { EnemyPokemon } from "#field/pokemon";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import { PokemonFormChangeItemModifier, SpeciesStatBoosterModifier } from "#modifiers/modifier";
import type { ModifierTypeOption } from "#modifiers/modifier-type";
import { getPlayerModifierTypeOptions, regenerateModifierPoolThresholds } from "#modifiers/modifier-type";
import { PokemonMove } from "#moves/pokemon-move";
import { getEncounterText, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import {
  getRandomEncounterPokemon,
  leaveEncounterWithoutBattle,
  selectPokemonForOption,
  setEncounterRewards,
} from "#mystery-encounters/encounter-phase-utils";
import { addPokemonDataToDexAndValidateAchievements } from "#mystery-encounters/encounter-pokemon-utils";
import {
  doPokemonTradeSequence,
  EXCLUDED_TRADE_SPECIES,
  generateRandomTraderName,
  hideTradeBackground,
  MAX_WONDER_TRADE_SHINY_CHANCE,
  showTradeBackground,
  WONDER_TRADE_HIDDEN_ABILITY_CHANCE,
  WONDER_TRADE_SHINY_CHANCE,
} from "#mystery-encounters/global-trade-system-encounter";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { PartySizeRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { PokemonData } from "#system/pokemon-data";
import type { OptionSelectItem } from "#types/ui-types";
import { randInt, randSeedInt, randSeedItem } from "#utils/common";
import i18next from "i18next";

/** the i18n namespace for the encounter */
const namespace = "mysteryEncounters/hyperGlobalTradeSystem";

/** Trade offers reach this far above the offered Pokémon's base stat total (and never below it, if possible) */
export const HYPER_TRADE_BST_RANGE = 100;
/** Fewest species a trade-offer pool may have before its lower bound is widened (10 at a time) */
export const HYPER_TRADE_MIN_POOL = 5;
/** Wonder Trade: percent chance to receive a legendary, mythical or Paradox Pokémon */
export const HYPER_WONDER_TRADE_SPECIAL_CHANCE = 25;
/** Item trade: the received item is this many tiers above the sent one (capped at Master) */
export const HYPER_ITEM_TRADE_TIER_STEP = 2;
/** Item trade: never handed out, besides TMs */
export const HYPER_ITEM_TRADE_EXCLUDED_IDS: readonly string[] = ["RARE_CANDY", "RARER_CANDY", "CANDY_PILE"];
/** Item trade: rolls before an excluded reward is accepted anyway (only an item-reward debug override gets there) */
const HYPER_ITEM_TRADE_MAX_ROLLS = 100;
/**
 * Never handed out by either Pokémon trade. Eternatus is the final boss: its boss moveset (Eternabeam...) ignores
 * level, and Dark Deal and Weird Dream keep it out too.
 */
export const HYPER_TRADE_EXCLUDED_SPECIES: readonly SpeciesId[] = [SpeciesId.ETERNATUS];
/** Trade offers: species tried before an offer whose rolled form misses the window is kept anyway */
const HYPER_TRADE_OFFER_ATTEMPTS = 30;

/** Legendary, sub-legendary, mythical or Paradox: the species the normal GTS never trades away */
export function isHyperSpecialSpecies(species: PokemonSpecies): boolean {
  return (
    species.legendary || species.subLegendary || species.mythical || EXCLUDED_TRADE_SPECIES.includes(species.speciesId)
  );
}

/**
 * Hyper GTS (하이퍼 GTS), local fork (the user, 2026-11-05): the GTS at ULTRA tier with better trades.
 * 1. Trade offers: three per party member, each with a base stat total from the member's own up to +100
 *    (legendary members too); legendary, mythical and Paradox species can be offered.
 * 2. Wonder Trade: a legendary, mythical or Paradox Pokémon {@linkcode HYPER_WONDER_TRADE_SPECIAL_CHANCE}% of the
 *    time; anything else always comes shiny, with the usual variant odds.
 * 3. Item trade: a random item two tiers up (Rogue gives Master). Master-tier items can't be sent; TMs, Rare
 *    Candy, Rarer Candy and Candy Pile are never given.
 * Everything else (biomes, waves, party requirements, trade animation, held items moving over) is as in the GTS.
 */
export const HyperGlobalTradeSystemEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.HYPER_GLOBAL_TRADE_SYSTEM,
)
  .withEncounterTier(MysteryEncounterTier.ULTRA)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    {
      spriteKey: "hyper_global_trade_system", // golden terminal by the image session (tools/port/install_hyper_gts_sprite.py)
      fileRoot: "mystery-encounters",
      hasShadow: true,
      disableAnimation: true,
      x: 3,
      y: 5,
      yShadow: 1,
    },
  ])
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
  ])
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    const bgmKey = settings.musicPreferenceAllGens ? "mystery_encounter_gen_6_gts" : "mystery_encounter_gen_5_gts";
    encounter.misc = {
      tradeOptionsMap: getHyperTradeOptions(),
      bgmKey,
    };
    return true;
  })
  .withOnVisualsStart(() => {
    audioManager.playBgm(globalScene.currentBattle.mysteryEncounter!.misc.bgmKey, true);
    return true;
  })
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
      .withSceneRequirement(new PartySizeRequirement([2, 6], true)) // Requires 2 valid party members
      .withHasDexProgress(true)
      .withDialogue({
        buttonLabel: `${namespace}:option.1.label`,
        buttonTooltip: `${namespace}:option.1.tooltip`,
        secondOptionPrompt: `${namespace}:option.1.tradeOptionsPrompt`,
      })
      .withPreOptionPhase(async (): Promise<boolean> => {
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        const onPokemonSelected = (pokemon: PlayerPokemon) => {
          const tradeOptionsMap: Map<number, EnemyPokemon[]> = encounter.misc.tradeOptionsMap;
          const tradeOptions = tradeOptionsMap.get(pokemon.id);
          if (!tradeOptions) {
            return [];
          }

          return tradeOptions.map((tradePokemon: EnemyPokemon) => {
            const option: OptionSelectItem = {
              label: tradePokemon.getNameToRender(),
              handler: () => {
                encounter.setDialogueToken("tradedPokemon", pokemon.getNameToRender());
                encounter.setDialogueToken("received", tradePokemon.getNameToRender());
                encounter.misc.tradedPokemon = pokemon;
                encounter.misc.receivedPokemon = tradePokemon;
                return true;
              },
              onHover: () => {
                // the localized form name, and none for a base form (its raw data name is English, e.g. "Normal")
                const formName = tradePokemon.species.forms?.[tradePokemon.formIndex]?.formKey
                  ? tradePokemon.species.getFormNameToDisplay(tradePokemon.formIndex)
                  : null;
                const line1 = `${i18next.t("pokemonInfoContainer:ability")} ${tradePokemon.getAbility().name}${
                  tradePokemon.getGender() === Gender.GENDERLESS
                    ? ""
                    : `     |     ${i18next.t("pokemonInfoContainer:gender")} ${getGenderSymbol(tradePokemon.getGender())}`
                }`;
                const line2 =
                  i18next.t("pokemonInfoContainer:nature")
                  + " "
                  + getNatureName(tradePokemon.getNature())
                  + (formName ? `     |     ${i18next.t("pokemonInfoContainer:form")} ${formName}` : "");
                showEncounterText(`${line1}\n${line2}`, 0, 0, false);
              },
            };
            return option;
          });
        };

        return selectPokemonForOption(onPokemonSelected);
      })
      .withOptionPhase(async () => {
        await doHyperPokemonTrade();
      })
      .build(),
  )
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
      .withSceneRequirement(new PartySizeRequirement([2, 6], true)) // Requires 2 valid party members
      .withHasDexProgress(true)
      .withDialogue({
        buttonLabel: `${namespace}:option.2.label`,
        buttonTooltip: `${namespace}:option.2.tooltip`,
      })
      .withPreOptionPhase(async (): Promise<boolean> => {
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        const onPokemonSelected = (pokemon: PlayerPokemon) => {
          const tradePokemon = generateHyperWonderTradePokemon(pokemon.level);
          encounter.setDialogueToken("tradedPokemon", pokemon.getNameToRender());
          encounter.setDialogueToken("received", tradePokemon.getNameToRender());
          encounter.misc.tradedPokemon = pokemon;
          encounter.misc.receivedPokemon = tradePokemon;
        };

        return selectPokemonForOption(onPokemonSelected);
      })
      .withOptionPhase(async () => {
        await doHyperPokemonTrade();
      })
      .build(),
  )
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.3.label`,
        buttonTooltip: `${namespace}:option.3.tooltip`,
        secondOptionPrompt: `${namespace}:option.3.tradeOptionsPrompt`,
      })
      .withPreOptionPhase(async (): Promise<boolean> => {
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        const onPokemonSelected = (pokemon: PlayerPokemon) => {
          return getHyperTradableItems(pokemon).map((modifier: PokemonHeldItemModifier) => {
            const option: OptionSelectItem = {
              label: modifier.type.name,
              handler: () => {
                encounter.setDialogueToken("chosenItem", modifier.type.name);
                encounter.misc.chosenModifier = modifier;
                encounter.misc.chosenPokemon = pokemon;
                return true;
              },
            };
            return option;
          });
        };

        const selectableFilter = (pokemon: Pokemon) => {
          if (getHyperTradableItems(pokemon).length === 0) {
            return getEncounterText(`${namespace}:option.3.invalidSelection`) ?? null;
          }
          return null;
        };

        return selectPokemonForOption(onPokemonSelected, undefined, selectableFilter);
      })
      .withOptionPhase(async () => {
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        const modifier = encounter.misc.chosenModifier as PokemonHeldItemModifier;
        const party = globalScene.getPlayerParty();
        const chosenPokemon: PlayerPokemon = encounter.misc.chosenPokemon;

        const tier = getHyperItemTradeRewardTier(getTradedItemTier(modifier));

        regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0);
        const roll = (): ModifierTypeOption =>
          getPlayerModifierTypeOptions(1, party, [], {
            guaranteedModifierTiers: [tier],
            allowLuckUpgrades: false,
          })[0];
        let item = roll();
        for (let rolls = 1; isExcludedHyperItemReward(item.type.id) && rolls < HYPER_ITEM_TRADE_MAX_ROLLS; rolls++) {
          item = roll();
        }

        encounter.setDialogueToken("itemName", item.type.name);
        setEncounterRewards({
          guaranteedModifierTypeOptions: [item],
          fillRemaining: false,
        });

        chosenPokemon.loseHeldItem(modifier, false);
        await globalScene.updateModifiers(true, true);

        const traderName = generateRandomTraderName();
        encounter.setDialogueToken("tradeTrainerName", traderName.trim());
        await showEncounterText(`${namespace}:itemTradeSelected`);
        leaveEncounterWithoutBattle();
      })
      .build(),
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.4.label`,
      buttonTooltip: `${namespace}:option.4.tooltip`,
      selected: [
        {
          text: `${namespace}:option.4.selected`,
        },
      ],
    },
    async () => {
      // Leave encounter with no rewards or exp
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();

/** The trade itself, as in the GTS: the chosen party member leaves, the received Pokémon joins with its held items. */
async function doHyperPokemonTrade(): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const tradedPokemon: PlayerPokemon = encounter.misc.tradedPokemon;
  const receivedPokemonData: EnemyPokemon = encounter.misc.receivedPokemon;
  const modifiers = tradedPokemon
    .getHeldItems()
    .filter(m => !(m instanceof PokemonFormChangeItemModifier) && !(m instanceof SpeciesStatBoosterModifier));

  const traderName = generateRandomTraderName();
  encounter.setDialogueToken("tradeTrainerName", traderName.trim());

  globalScene.removePokemonFromPlayerParty(tradedPokemon, false);

  receivedPokemonData.passive = tradedPokemon.passive;
  receivedPokemonData.inheritPassiveChoice(tradedPokemon);
  // Pokeball to Ultra ball, randomly
  receivedPokemonData.pokeball = randInt(4) as PokeballType;
  const dataSource = new PokemonData(receivedPokemonData);
  const newPlayerPokemon = globalScene.addPlayerPokemon(
    receivedPokemonData.species,
    receivedPokemonData.level,
    dataSource.abilityIndex,
    dataSource.formIndex,
    dataSource.gender,
    dataSource.shiny,
    dataSource.variant,
    dataSource.ivs,
    dataSource.nature,
    dataSource,
  );
  globalScene.getPlayerParty().push(newPlayerPokemon);
  await newPlayerPokemon.loadAssets();

  for (const mod of modifiers) {
    mod.pokemonId = newPlayerPokemon.id;
    globalScene.addModifier(mod, true, false, false, true);
  }

  await showTradeBackground();
  await doPokemonTradeSequence(tradedPokemon, newPlayerPokemon);
  await showEncounterText(`${namespace}:tradeReceived`, null, 0, true, 4000);
  audioManager.playBgm(encounter.misc.bgmKey);
  await addPokemonDataToDexAndValidateAchievements(newPlayerPokemon);
  await hideTradeBackground();
  tradedPokemon.destroy();

  leaveEncounterWithoutBattle(true);
}

/** Three offers per party member, no species repeated across the party or the offers. */
export function getHyperTradeOptions(): Map<number, EnemyPokemon[]> {
  const tradeOptionsMap = new Map<number, EnemyPokemon[]>();
  const alreadyUsedSpecies: PokemonSpecies[] = globalScene.getPlayerParty().map(p => p.species);

  for (const pokemon of globalScene.getPlayerParty()) {
    const originalBst = pokemon.getSpeciesForm().getBaseStatTotal();
    const tradeOptions: EnemyPokemon[] = [];
    for (let i = 0; i < 3; i++) {
      const offer = generateHyperTradeOffer(alreadyUsedSpecies, originalBst, pokemon.level);
      alreadyUsedSpecies.push(offer.species);
      tradeOptions.push(offer);
    }
    tradeOptionsMap.set(pokemon.id, tradeOptions);
  }

  return tradeOptionsMap;
}

/** Every species the Hyper GTS may hand out, minus `exclude` and {@linkcode HYPER_TRADE_EXCLUDED_SPECIES}. */
export function getHyperTradeableSpecies(exclude: readonly PokemonSpecies[] = []): PokemonSpecies[] {
  return speciesDataRegistry
    .getAllSpecies()
    .filter(s => !exclude.includes(s) && !HYPER_TRADE_EXCLUDED_SPECIES.includes(s.speciesId));
}

/**
 * The offer pool for a Pokémon with `originalBst`: species whose base stat total is from `originalBst` to
 * `originalBst` + {@linkcode HYPER_TRADE_BST_RANGE}, any kind (legendaries, mythicals and Paradoxes included), not in
 * `alreadyUsedSpecies`. When fewer than {@linkcode HYPER_TRADE_MIN_POOL} species fit (the very strongest Pokémon),
 * the lower bound drops 10 at a time; the upper bound never rises.
 */
export function getHyperTradePool(
  alreadyUsedSpecies: readonly PokemonSpecies[],
  originalBst: number,
): { pool: PokemonSpecies[]; bstMin: number; bstCap: number } {
  const candidates = getHyperTradeableSpecies(alreadyUsedSpecies);
  const bstCap = originalBst + HYPER_TRADE_BST_RANGE;
  let bstMin = originalBst;
  const inWindow = () => candidates.filter(s => s.getBaseStatTotal() >= bstMin && s.getBaseStatTotal() <= bstCap);
  let pool = inWindow();
  while (pool.length < HYPER_TRADE_MIN_POOL && bstMin > 0) {
    bstMin -= 10;
    pool = inWindow();
  }
  return { pool, bstMin, bstCap };
}

/** One species from {@linkcode getHyperTradePool}. */
export function generateHyperTradeOption(
  alreadyUsedSpecies: readonly PokemonSpecies[],
  originalBst: number,
): PokemonSpecies {
  return randSeedItem(getHyperTradePool(alreadyUsedSpecies, originalBst).pool);
}

/**
 * One trade offer at `level`. The window is checked on the form the new Pokémon actually rolls (Rotom, Pikachu,
 * Eevee, Zygarde... get a random form whose base stats differ from the species'); a species whose roll misses is
 * set aside and another one picked.
 */
export function generateHyperTradeOffer(
  alreadyUsedSpecies: readonly PokemonSpecies[],
  originalBst: number,
  level: number,
): EnemyPokemon {
  const rejected: PokemonSpecies[] = [];
  let offer: EnemyPokemon | undefined;
  for (let attempt = 0; attempt < HYPER_TRADE_OFFER_ATTEMPTS; attempt++) {
    const { pool, bstMin, bstCap } = getHyperTradePool([...alreadyUsedSpecies, ...rejected], originalBst);
    if (pool.length === 0) {
      break;
    }
    offer = new EnemyPokemon(randSeedItem(pool), level, TrainerSlot.NONE, false);
    const formBst = offer.getSpeciesForm().getBaseStatTotal();
    if (formBst >= bstMin && formBst <= bstCap) {
      return offer;
    }
    rejected.push(offer.species);
  }
  return (
    offer ?? new EnemyPokemon(generateHyperTradeOption(alreadyUsedSpecies, originalBst), level, TrainerSlot.NONE, false)
  );
}

/**
 * The Wonder Trade species: legendary, mythical or Paradox {@linkcode HYPER_WONDER_TRADE_SPECIAL_CHANCE}% of the
 * time, otherwise any other species; never one already in the party.
 */
export function generateHyperWonderTradeSpecies(): PokemonSpecies {
  const party = globalScene.getPlayerParty().map(p => p.species);
  const special = randSeedInt(100) < HYPER_WONDER_TRADE_SPECIAL_CHANCE;
  const pool = getHyperTradeableSpecies(party).filter(s => isHyperSpecialSpecies(s) === special);
  return randSeedItem(pool);
}

/**
 * The Wonder Trade Pokémon at `level`. Shiny and hidden-ability rolls are the GTS's; a Pokémon that is not
 * legendary, mythical or Paradox is then made shiny for sure, its variant rolled the usual way. Like the GTS, a
 * Pokémon that ends up neither shiny nor with its hidden ability gets one of its common egg moves.
 * Event species are not forced in here (the GTS always takes one while an event lists any), so the odds above hold.
 */
export function generateHyperWonderTradePokemon(level: number): EnemyPokemon {
  const species = generateHyperWonderTradeSpecies();
  const tradePokemon = getRandomEncounterPokemon({
    level,
    speciesFunction: () => species,
    isBoss: false,
    eventChance: 0,
    shinyRerolls: 1,
    hiddenRerolls: 1,
    hiddenAbilityChance: WONDER_TRADE_HIDDEN_ABILITY_CHANCE,
    shinyChance: WONDER_TRADE_SHINY_CHANCE,
    maxShinyChance: MAX_WONDER_TRADE_SHINY_CHANCE,
    speciesFilter: s => !globalScene.getPlayerParty().some(p => p.species === s),
  });

  if (!isHyperSpecialSpecies(tradePokemon.species)) {
    // A threshold of 65536 always hits; the variant is then rolled by generateShinyVariant as for any shiny
    tradePokemon.trySetShinySeed(65536, false);
  }

  if (!tradePokemon.shiny && (!tradePokemon.species.abilityHidden || tradePokemon.abilityIndex < 2)) {
    const eggMoves = tradePokemon.getEggMoves();
    if (eggMoves) {
      // Cannot gen the rare egg move, only 1 of the first 3 common moves
      const eggMove = eggMoves[randSeedInt(3)];
      if (!tradePokemon.moveset.some(m => m.moveId === eggMove)) {
        if (tradePokemon.moveset.length < 4) {
          tradePokemon.moveset.push(new PokemonMove(eggMove));
        } else {
          tradePokemon.moveset[randSeedInt(4)] = new PokemonMove(eggMove);
        }
      }
    }
  }

  return tradePokemon;
}

/**
 * The reward-pool tier of a held item, as the GTS reads it (eggs and White Herb are not in the pool). It only reads:
 * `withTierFromPool` writes the tier onto the item's type, which other copies of the item (a trainer's) share, so
 * the type's own tier is put back.
 */
export function getTradedItemTier(modifier: PokemonHeldItemModifier): ModifierTier {
  const ownTier = modifier.type.tier;
  const type = modifier.type.withTierFromPool(ModifierPoolType.PLAYER, globalScene.getPlayerParty());
  let tier = type.tier ?? ModifierTier.GREAT;
  modifier.type.tier = ownTier;
  if (type.id === "WHITE_HERB") {
    tier = ModifierTier.GREAT;
  } else if (type.id === "LUCKY_EGG") {
    tier = ModifierTier.ULTRA;
  } else if (type.id === "GOLDEN_EGG") {
    tier = ModifierTier.ROGUE;
  }
  return tier;
}

/** Two tiers up, Master at most (so Rogue gives Master). */
export function getHyperItemTradeRewardTier(sentTier: ModifierTier): ModifierTier {
  return Math.min(sentTier + HYPER_ITEM_TRADE_TIER_STEP, ModifierTier.MASTER) as ModifierTier;
}

/** Transferable held items below Master tier: the ones the Hyper GTS takes. */
export function getHyperTradableItems(pokemon: Pokemon): PokemonHeldItemModifier[] {
  return pokemon.getHeldItems().filter(it => it.isTransferable && getTradedItemTier(it) < ModifierTier.MASTER);
}

/**
 * TMs and the candies are never handed out by the item trade. Local fork (2026-11-11): the Master TM (마스터 기술머신,
 * id MASTER_TM, in the Master pool since 2026-11-11) is a TM too, but its id has no "TM_", so it is named here.
 */
export function isExcludedHyperItemReward(typeId: string): boolean {
  return typeId.includes("TM_") || typeId === "MASTER_TM" || HYPER_ITEM_TRADE_EXCLUDED_IDS.includes(typeId);
}
