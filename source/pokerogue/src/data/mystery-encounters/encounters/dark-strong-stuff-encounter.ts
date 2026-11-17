/**
 * Local fork (2026-11-08): "The Strong Stuff?" (DARK_STRONG_STUFF), the user's ROGUE-tier pitch-black twist on the
 * official The Strong Stuff (the-strong-stuff-encounter.ts, whose structure, Shuckle and juice items it mirrors).
 */
import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { SHINY_EPIC_CHANCE, SHINY_VARIANT_CHANCE } from "#balance/rates";
import { MoveAnim } from "#data/battle-anims";
import { modifierTypes } from "#data/data-lists";
import { CustomPokemonData } from "#data/pokemon-data";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BerryType } from "#enums/berry-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { MovePhaseTimingModifier } from "#enums/move-phase-timing-modifier";
import { MoveUseMode } from "#enums/move-use-mode";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Nature } from "#enums/nature";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { MysteryEncounterSpriteConfig } from "#field/mystery-encounter-intro";
import type { EnemyPokemon, PlayerPokemon, Pokemon } from "#field/pokemon";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import { PITCH_BLACK_SHUCKLE_JUICE_VALUE, PokemonBaseStatTotalModifier } from "#modifiers/modifier";
import type { CustomModifierSettings, ModifierTypeOption, PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { PokemonMove } from "#moves/pokemon-move";
import { getDarkChestRewardCount, rollDarkChestRewards } from "#mystery-encounters/dark-mysterious-chest-encounter";
import { getEncounterText, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig, EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  generateModifierType,
  generateModifierTypeOption,
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  loadCustomMovesForEncounter,
  selectPokemonForOption,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { EncounterStartOfBattleEffect, MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { EncounterSceneRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import type { Variant } from "#sprites/variant";
import { randSeedInt, randSeedItem } from "#utils/common";

/** the i18n namespace for the encounter */
const namespace = "mysteryEncounters/darkStrongStuff";

/** The official sweet Shuckle Juice (달콤한 단단지 주스): +10 to every base stat, +5 HP; 2 per Pokémon */
export const SWEET_SHUCKLE_JUICE_VALUE = 10;
/** The official bitter Shuckle Juice (쓴 단단지 주스): -15 to every base stat, -7.5 HP (rounded down); 2 per Pokémon */
export const BITTER_SHUCKLE_JUICE_VALUE = -15;
/**
 * Option 2: what the shining Shuckle uses before turn 1, in this order (Psychic Terrain blocks priority moves against
 * grounded targets), before it falls; also its moveset
 */
export const DARK_STRONG_STUFF_OPENING_MOVES: readonly MoveId[] = [
  MoveId.STEALTH_ROCK,
  MoveId.TRICK_ROOM,
  MoveId.PSYCHIC_TERRAIN,
];
/** Option 2: the friends the shining Shuckle calls, sent out one at a time after it falls */
export const DARK_STRONG_STUFF_FOLLOWER_COUNT = 5;
/** Option 2: the friends' moves (all implemented); Power Trick takes effect on top each time one comes out */
export const DARK_STRONG_STUFF_FOLLOWER_MOVES: readonly MoveId[] = [
  MoveId.GYRO_BALL,
  MoveId.SALT_CURE,
  MoveId.STONE_EDGE,
  MoveId.HEAL_ORDER,
];
/**
 * Option 2: each friend's berries, from the old boss's set: Sitrus for HP and Lum against a burn (it would halve the
 * swapped Attack). Enigma and Apicot were sized for one 6-segment boss, five friends would multiply them, and Ganlon
 * raises the swapped Defense (its old 10-base Attack). The shining Shuckle holds nothing: it falls before it acts.
 */
export const DARK_STRONG_STUFF_FOLLOWER_BERRIES: readonly BerryType[] = [BerryType.SITRUS, BerryType.LUM];
/** Option 2, won: the Soul Dew, then one of these (no luck upgrade), then ordinary rewards; all different */
export const DARK_STRONG_STUFF_WIN_TIERS: readonly ModifierTier[] = [ModifierTier.ROGUE];

/**
 * The shining Shuckle's shiny variant, rolled once per wave in `onInit` (seeded with the wave) so the intro sprite and
 * the battle match: the ordinary shiny odds, 6/10 basic, 3/10 rare, 1/10 epic (`Pokemon.generateShinyVariant`).
 */
export function rollDarkShuckleVariant(): Variant {
  const rand = randSeedInt(10);
  if (rand >= SHINY_VARIANT_CHANCE) {
    return 0;
  }
  return rand >= SHINY_EPIC_CHANCE ? 1 : 2;
}

/** The official intro (Shuckle beside its juice) with the pitch-black juice and an always-shiny Shuckle */
function getDarkStrongStuffSpriteConfigs(variant: Variant): MysteryEncounterSpriteConfig[] {
  return [
    {
      spriteKey: "berry_juice_dark",
      fileRoot: "items",
      hasShadow: true,
      isItem: true,
      scale: 1.25,
      x: -15,
      y: 3,
      disableAnimation: true,
    },
    {
      species: SpeciesId.SHUCKLE,
      isShiny: true,
      variant,
      spriteKey: "",
      fileRoot: "",
      hasShadow: true,
      repeat: true,
      scale: 1.25,
      x: 20,
      y: 10,
      yShadow: 7,
    },
  ];
}

/** A new Shuckle Juice of `value` for `pokemon` (not added yet) */
function newShuckleJuice(pokemon: PlayerPokemon, value: number): PokemonHeldItemModifier | null {
  const type = generateModifierType(modifierTypes.MYSTERY_ENCOUNTER_SHUCKLE_JUICE, [value]) as
    | PokemonHeldItemModifierType
    | undefined;
  return (type?.newModifier(pokemon) as PokemonHeldItemModifier | undefined) ?? null;
}

/** Whether `pokemon` holds the Pitch-Black Shuckle Juice (one per Pokémon) */
export function hasPitchBlackJuice(pokemon: Pokemon): boolean {
  return pokemon
    .getHeldItems()
    .some(m => m instanceof PokemonBaseStatTotalModifier && m.statModifier === PITCH_BLACK_SHUCKLE_JUICE_VALUE);
}

/** Whether `pokemon` already holds a Shuckle Juice of `value` */
export function holdsShuckleJuice(pokemon: Pokemon, value: number): boolean {
  return pokemon.getHeldItems().some(m => m instanceof PokemonBaseStatTotalModifier && m.statModifier === value);
}

/**
 * Whether one more Shuckle Juice of `value` would change `pokemon`'s stats.
 * Local fork (2026-11-08): `PokemonBaseStatTotalModifier.apply` ignores the stack count, so a second juice of the same
 * value (official cap 2) does nothing; this encounter only hands a juice to a Pokémon that doesn't hold that value yet,
 * so its messages never announce a change that doesn't happen. The official juices themselves are unchanged.
 */
export function canDrinkShuckleJuice(pokemon: PlayerPokemon, value: number): boolean {
  if (holdsShuckleJuice(pokemon, value)) {
    return false;
  }
  const juice = newShuckleJuice(pokemon, value);
  return !!juice && globalScene.hasRoomForHeldItem(juice, pokemon);
}

/**
 * Gives `pokemon` one Shuckle Juice of `value` and recalculates its stats; returns whether it got one. A Pokémon at
 * the cap gets nothing: `addModifier` would hand out its stack-full fallback (Poké Balls and a "stack full" message)
 * instead, as the official `modifyPlayerPokemonBST` does.
 */
export function giveShuckleJuice(pokemon: PlayerPokemon, value: number): boolean {
  // Local fork (2026-11-08): a juice of a value it already holds would do nothing (see canDrinkShuckleJuice)
  if (!canDrinkShuckleJuice(pokemon, value)) {
    return false;
  }
  const juice = newShuckleJuice(pokemon, value);
  if (!juice) {
    return false;
  }
  globalScene.addModifier(juice, false, false, false, true);
  pokemon.calculateStats();
  return true;
}

/**
 * Option 1: `drinker` gets the Pitch-Black Shuckle Juice and every other party member the official bitter one (those
 * already at its cap stay as they are). Returns the Pokémon that were weakened.
 */
export function drinkPitchBlackJuice(drinker: PlayerPokemon): PlayerPokemon[] {
  giveShuckleJuice(drinker, PITCH_BLACK_SHUCKLE_JUICE_VALUE);
  return globalScene
    .getPlayerParty()
    .filter(p => p !== drinker)
    .filter(p => giveShuckleJuice(p, BITTER_SHUCKLE_JUICE_VALUE));
}

/** Option 1's condition: a party member that has not had the Pitch-Black juice yet */
export class PitchBlackJuiceDrinkerRequirement extends EncounterSceneRequirement {
  override meetsRequirement(): boolean {
    return globalScene.getPlayerParty().some(p => !hasPitchBlackJuice(p));
  }

  override getDialogueToken(): [string, string] {
    const drinker = globalScene.getPlayerParty().find(p => !hasPitchBlackJuice(p));
    return ["pitchBlackDrinker", drinker?.getNameToRender() ?? ""];
  }
}

/**
 * Option 2's reward screen: the Soul Dew (the official's reward), one Rogue-tier item and ordinary rewards up to an
 * ordinary screen's size (Golden / Silver Poké Balls included), all different (the Mysterious Chest?'s rolls).
 */
export function rollDarkStrongStuffRewards(): ModifierTypeOption[] {
  const soulDew = generateModifierTypeOption(modifierTypes.SOUL_DEW);
  return rollDarkChestRewards(DARK_STRONG_STUFF_WIN_TIERS, getDarkChestRewardCount(), soulDew ? [soulDew] : []);
}

/**
 * Option 2's six Shuckles, one on the field at a time (a single battle with five reserves, none a boss): the shining
 * one from the intro (same variant), then its five friends in ordinary colours.
 */
function getDarkShuckleRelayConfig(variant: Variant): EnemyPartyConfig {
  const shuckle = speciesDataRegistry.getSpecies(SpeciesId.SHUCKLE);
  const lead: EnemyPokemonConfig = {
    species: shuckle,
    isBoss: false,
    shiny: true,
    variant,
    customPokemonData: new CustomPokemonData({ spriteScale: 1.25 }),
    nature: Nature.HARDY,
    moveSet: [...DARK_STRONG_STUFF_OPENING_MOVES],
    // nothing to hold, and no random wild items either (an empty list still counts as its own items)
    modifierConfigs: [],
  };
  const followers = Array.from(
    { length: DARK_STRONG_STUFF_FOLLOWER_COUNT },
    (): EnemyPokemonConfig => ({
      species: shuckle,
      isBoss: false,
      shiny: false,
      nature: Nature.HARDY,
      moveSet: [...DARK_STRONG_STUFF_FOLLOWER_MOVES],
      modifierConfigs: DARK_STRONG_STUFF_FOLLOWER_BERRIES.map(berry => ({
        modifier: generateModifierType(modifierTypes.BERRY, [berry]) as PokemonHeldItemModifierType,
      })),
    }),
  );
  return {
    levelAdditiveModifier: 1,
    disableSwitch: true,
    pokemonConfigs: [lead, ...followers],
  };
}

/**
 * Option 2's opening, before turn 1: Stealth Rock, Trick Room, Psychic Terrain. Start-of-battle moves are sorted like
 * a turn's (timing, then priority), so the three timings keep the listed order (Trick Room's -7 would go last).
 */
export function getDarkStrongStuffOpeningEffects(): EncounterStartOfBattleEffect[] {
  const timings = [MovePhaseTimingModifier.FIRST, MovePhaseTimingModifier.NORMAL, MovePhaseTimingModifier.LAST];
  return DARK_STRONG_STUFF_OPENING_MOVES.map((move, i) => ({
    sourceBattlerIndex: BattlerIndex.ENEMY,
    // Stealth Rock goes on the player's side; Trick Room and Psychic Terrain take both sides, as the AI would target
    targets: move === MoveId.STEALTH_ROCK ? [BattlerIndex.PLAYER] : [BattlerIndex.ENEMY, BattlerIndex.PLAYER],
    move: new PokemonMove(move),
    useMode: MoveUseMode.IGNORE_PP,
    timingModifier: timings[i],
  }));
}

/**
 * Option 2: a friend's free Power Trick as it comes out (no move used, no turn spent): the Power Trick animation and the
 * usual "switched its Attack and Defense" message. Never swaps back.
 */
export function applyFreePowerTrick(pokemon: Pokemon): void {
  if (pokemon.isFainted() || pokemon.getTag(BattlerTagType.POWER_TRICK)) {
    return;
  }
  globalScene.phaseManager.unshiftNew(
    "MoveAnimPhase",
    new MoveAnim(MoveId.POWER_TRICK, pokemon, pokemon.getBattlerIndex()),
  );
  pokemon.addTag(BattlerTagType.POWER_TRICK, 0, MoveId.POWER_TRICK, pokemon.id);
}

/**
 * Option 2's relay, once the six Shuckles exist. The first TurnInitPhase only queues the opening moves and the shining
 * Shuckle's fall (an ordinary faint: EXP, then the first friend comes out) and gives no commands; the next one starts
 * turn 1 with that friend on the field. Every friend that comes out gets {@linkcode applyFreePowerTrick}.
 */
function startDarkShuckleRelay(encounter: MysteryEncounter): void {
  const [lead, ...followers] = globalScene.getEnemyParty() as EnemyPokemon[];
  const followerIds = followers.map(p => p.id);
  encounter.misc = { leadId: lead.id, followerIds, leadFallen: false };
  // with no boss the mode is WILD_BATTLE, which skips the battle music the old boss fight started; nothing else in a
  // wild encounter battle reads BOSS_BATTLE
  encounter.encounterMode = MysteryEncounterMode.BOSS_BATTLE;
  encounter.onTurnStart = () => {
    if (encounter.misc.leadFallen) {
      return false;
    }
    encounter.misc.leadFallen = true;
    globalScene.phaseManager.pushNew(
      "MysteryEncounterSelfFaintPhase",
      lead,
      getEncounterText(`${namespace}:option.2.fall`) ?? "",
    );
    return true;
  };
  encounter.onPostSummon = pokemon => {
    if (followerIds.includes(pokemon.id)) {
      applyFreePowerTrick(pokemon);
    }
  };
}

/**
 * "The Strong Stuff?" (DARK_STRONG_STUFF), local fork (the user, 2026-11-08): a shining Shuckle beside a pitch-black
 * juice.
 * 1. Make one Pokémon drink it all: the pick gets the Pitch-Black Shuckle Juice (+30 base stats, +15 HP, one per
 *    Pokémon), every other party member the official bitter juice (-15). No reward screen, no shop.
 * 2. Fight the Shuckle: it calls five friends. Before turn 1 it uses Stealth Rock, Trick Room and Psychic Terrain,
 *    then falls; its friends (Gyro Ball / Salt Cure / Stone Edge / Heal Order) come out one at a time, each with a free
 *    Power Trick. All six down: Soul Dew + a Rogue item + ordinary rewards on one screen.
 * 3. Leave: one random party member with room has secretly drunk the official sweet juice (+10).
 * ROGUE tier, in the Cave, the Abyss and the Badlands.
 */
export const DarkStrongStuffEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.DARK_STRONG_STUFF,
)
  .withEncounterTier(MysteryEncounterTier.ROGUE)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  // The official's party size. No once-per-run limit like the official's: the fork lets every encounter repeat, and
  // option 1 is once per Pokémon instead
  .withScenePartySizeRequirement(3)
  .withHideWildIntroMessage(true)
  .withAutoHideIntroVisuals(false)
  .withFleeAllowed(false)
  .withIntroSpriteConfigs(getDarkStrongStuffSpriteConfigs(0)) // the variant is rolled in onInit
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
  ])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    const variant = rollDarkShuckleVariant();
    encounter.spriteConfigs = getDarkStrongStuffSpriteConfigs(variant);

    // Six Shuckles, no boss. The old boss's juice boost (+1 Def / +1 SpDef on entry) is gone: the shining one pours
    // that strength into its opening and falls, and its friends never drank
    encounter.enemyPartyConfigs = [getDarkShuckleRelayConfig(variant)];

    // the opening moves, and Power Trick for the friends' entry animation (the official loads Gastro Acid and
    // Stealth Rock)
    loadCustomMovesForEncounter([...DARK_STRONG_STUFF_OPENING_MOVES, MoveId.POWER_TRICK]);

    encounter.setDialogueToken("shuckleName", speciesDataRegistry.getSpecies(SpeciesId.SHUCKLE).getName());

    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
      .withSceneRequirement(new PitchBlackJuiceDrinkerRequirement())
      .withDialogue({
        buttonLabel: `${namespace}:option.1.label`,
        buttonTooltip: `${namespace}:option.1.tooltip`,
        disabledButtonTooltip: `${namespace}:option.1.disabledTooltip`,
        selected: [
          {
            text: `${namespace}:option.1.selected`,
          },
        ],
      })
      .withPreOptionPhase(async (): Promise<boolean> => {
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        const onPokemonSelected = (pokemon: PlayerPokemon) => {
          encounter.setDialogueToken("juicePokemon", pokemon.getNameToRender());
          encounter.misc = { juicePokemon: pokemon };
        };
        // a Pokémon that already had it stays on the party screen with the reason (the forge's pattern)
        const selectableFilter = (pokemon: PlayerPokemon): string | null => {
          if (hasPitchBlackJuice(pokemon)) {
            return getEncounterText(`${namespace}:option.1.alreadyDrank`) ?? null;
          }
          return null;
        };
        const selection = selectPokemonForOption(onPokemonSelected, undefined, selectableFilter);
        // The party screen opens at once from the encounter screen: its message box asks for the Pokémon
        if (globalScene.ui.mode === UiMode.PARTY) {
          globalScene.ui.showText(getEncounterText(`${namespace}:option.1.prompt`) ?? "", 0);
        }
        return selection;
      })
      .withOptionPhase(async () => {
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        const drinker: PlayerPokemon = encounter.misc.juicePokemon;
        // the juice is gone and the Shuckle with it
        await transitionMysteryEncounterIntroVisuals(true, true, 500);

        const weakened = drinkPitchBlackJuice(drinker);
        encounter.setDialogueToken("increaseValue", PITCH_BLACK_SHUCKLE_JUICE_VALUE.toString());
        encounter.setDialogueToken("reductionValue", (-BITTER_SHUCKLE_JUICE_VALUE).toString());
        await showEncounterText(`${namespace}:option.1.power`);
        // nobody else weakened (all at the bitter juice's cap): no smell message
        if (weakened.length > 0) {
          await showEncounterText(`${namespace}:option.1.weakened`);
        }

        // the user: no reward screen and no shop
        leaveEncounterWithoutBattle();
      })
      .build(),
  )
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.2.label`,
        buttonTooltip: `${namespace}:option.2.tooltip`,
        selected: [
          {
            text: `${namespace}:option.2.selected`,
          },
        ],
      })
      .withOptionPhase(async () => {
        // Pick battle
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        // rolled when the reward screen comes up (the rewards phase runs on the wave's own seed offset)
        const rewards: CustomModifierSettings = { fillRemaining: false };
        setEncounterRewards(rewards, undefined, () => {
          rewards.guaranteedModifierTypeOptions = rollDarkStrongStuffRewards();
        });
        // Where the official queues Gastro Acid and Stealth Rock: Stealth Rock, Trick Room, Psychic Terrain
        encounter.startOfBattleEffects.push(...getDarkStrongStuffOpeningEffects());

        encounter.dialogue.outro = [];
        await transitionMysteryEncounterIntroVisuals(true, true, 500);
        await initBattleWithEnemyConfig(encounter.enemyPartyConfigs[0]);
        startDarkShuckleRelay(encounter);
      })
      .build(),
  )
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.3.label`,
        buttonTooltip: `${namespace}:option.3.tooltip`,
        selected: [
          {
            text: `${namespace}:option.3.selected`,
          },
        ],
      })
      .withOptionPhase(async () => {
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        // one random party member with room for the official sweet juice has secretly had some
        const candidates = globalScene.getPlayerParty().filter(p => canDrinkShuckleJuice(p, SWEET_SHUCKLE_JUICE_VALUE));
        if (candidates.length === 0) {
          await showEncounterText(`${namespace}:option.3.nothing`);
        } else {
          const sipper = randSeedItem(candidates);
          giveShuckleJuice(sipper, SWEET_SHUCKLE_JUICE_VALUE);
          encounter.setDialogueToken("juicePokemon", sipper.getNameToRender());
          encounter.setDialogueToken("increaseValue", SWEET_SHUCKLE_JUICE_VALUE.toString());
          await showEncounterText(`${namespace}:option.3.sipped`);
        }
        // no reward screen and no shop
        leaveEncounterWithoutBattle();
      })
      .build(),
  )
  .build();
