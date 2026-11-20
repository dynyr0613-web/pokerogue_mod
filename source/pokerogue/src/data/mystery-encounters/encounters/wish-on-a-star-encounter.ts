/**
 * Local fork (2026-11-20): "별에게 소원을" (Wish on a Star, WISH_ON_A_STAR), item C2 of
 * docs/유저_요청_요소_목록_20261120.md (the user: "C2 - 실행"), from the official design proposal
 * https://github.com/pagefaultgames/pokerogue/issues/4477 ("Wish on a Star", Rogue tier, SPACE) and the ideas in its
 * comments. The idea doc's reading: wake the sleeping Jirachi with a song or a waking move and pick one wish (money,
 * one Pokémon's IVs, a party heal), bigger with Wish or Healing Wish; failing that, an angry Jirachi boss.
 * The structure follows the official Slumbering Snorlax (slumbering-snorlax-encounter.ts), another sleeping Pokémon.
 */
import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { allAbilities, allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { PERMANENT_STATS, type PermanentStat, Stat } from "#enums/stat";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import type { PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { queueEncounterMessage, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig, EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  generateModifierType,
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  selectPokemonForOption,
  setEncounterRewards,
  updatePlayerMoney,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { EncounterPokemonRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import type { OptionSelectItem, OptionSelectModeConfig } from "#types/ui-types";
import type { PokemonSelectFilter } from "#ui/party-ui-handler";
import { randSeedShuffle } from "#utils/common";
import { groupStatChange } from "#utils/stat-change";
import i18next from "i18next";

/** the i18n namespace for the encounter */
const namespace = "mysteryEncounters/wishOnAStar";

/** The proposal's "Song moves" */
export const WISH_ON_A_STAR_SONG_MOVES: readonly MoveId[] = [
  MoveId.SING,
  MoveId.RELIC_SONG,
  MoveId.PERISH_SONG,
  MoveId.TORCH_SONG,
];
/** The proposal's "Wakeup moves" */
export const WISH_ON_A_STAR_WAKE_UP_MOVES: readonly MoveId[] = [
  MoveId.UPROAR,
  MoveId.WAKE_UP_SLAP,
  MoveId.ELECTRIC_TERRAIN,
  MoveId.MISTY_TERRAIN,
];
/**
 * The sound moves a comment on the proposal adds to the wake-up list, since the proposal's few moves are rare (Bug Buzz
 * included: the comment leaves it to the designer, and the encounter is Rogue tier and Space only)
 */
export const WISH_ON_A_STAR_SOUND_MOVES: readonly MoveId[] = [
  MoveId.ROAR,
  MoveId.NOBLE_ROAR,
  MoveId.SCREECH,
  MoveId.METAL_SOUND,
  MoveId.BOOMBURST,
  MoveId.HYPER_VOICE,
  MoveId.CHATTER,
  MoveId.OVERDRIVE,
  MoveId.PSYCHIC_NOISE,
  MoveId.ROUND,
  MoveId.ALLURING_VOICE,
  MoveId.BUG_BUZZ,
  MoveId.CLANGING_SCALES,
  MoveId.DISARMING_VOICE,
  MoveId.ECHOED_VOICE,
  MoveId.EERIE_SPELL,
  MoveId.SPARKLING_ARIA,
];
/** Every move that wakes the Jirachi for option 1: songs first, then the wake-up moves, then the other sounds */
export const WISH_ON_A_STAR_WAKE_MOVES: readonly MoveId[] = [
  ...WISH_ON_A_STAR_SONG_MOVES,
  ...WISH_ON_A_STAR_WAKE_UP_MOVES,
  ...WISH_ON_A_STAR_SOUND_MOVES,
];
/**
 * Abilities that wake it as well, from the proposal's comments: the terrain setters next to the terrain moves
 * ("abilities like Electric Surge") and Punk Rock next to the sound moves
 */
export const WISH_ON_A_STAR_WAKE_ABILITIES: readonly AbilityId[] = [
  AbilityId.ELECTRIC_SURGE,
  AbilityId.MISTY_SURGE,
  AbilityId.PUNK_ROCK,
];
/** The proposal's "Wish moves" (희망사항 / 치유소원): a party member that knows one makes every wish bigger */
export const WISH_ON_A_STAR_WISH_MOVES: readonly MoveId[] = [MoveId.WISH, MoveId.HEALING_WISH];

/** Wish for wealth: this many times the wave's money (the proposal leaves the amount open) */
export const WISH_ON_A_STAR_WEALTH_MULTIPLIER = 10;
/** Wish for wealth with a wish move: the proposal's "more gold" */
export const WISH_ON_A_STAR_WEALTH_BONUS_MULTIPLIER = 20;
/** Wish for power: how many of the Pokémon's stats get IV Candies (the proposal's "2 permanent IV boosts") */
export const WISH_ON_A_STAR_POWER_STATS = 2;
/** Wish for power with a wish move (the proposal's "4 permanent IV boosts") */
export const WISH_ON_A_STAR_POWER_BONUS_STATS = 4;

/** Option 2: the angry Jirachi's moves (all implemented): its signature move and three of its usual attacks */
export const WISH_ON_A_STAR_BOSS_MOVES: readonly MoveId[] = [
  MoveId.DOOM_DESIRE,
  MoveId.IRON_HEAD,
  MoveId.PSYCHIC,
  MoveId.FIRE_PUNCH,
];
/** Option 2: the angry Jirachi's "stat boosts" (the proposal): +1 to each of these as it comes out */
export const WISH_ON_A_STAR_ANGRY_STATS = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD] as const;
/** Option 2, won: one item of each of these tiers, then ordinary rewards */
export const WISH_ON_A_STAR_WIN_TIERS: readonly ModifierTier[] = [ModifierTier.ROGUE];

/** The three wishes of option 1 */
export enum JirachiWish {
  WEALTH,
  POWER,
  HEALTH,
}

/** The locale key of each wish, under `wish.` */
const WISH_KEYS: Record<JirachiWish, string> = {
  [JirachiWish.WEALTH]: "wealth",
  [JirachiWish.POWER]: "power",
  [JirachiWish.HEALTH]: "health",
};

/** What option 1's menu leaves in `encounter.misc` */
export interface WishOnAStarMisc {
  wish: JirachiWish;
  /** The Pokémon that gets the IV Candies (the power wish only) */
  pokemon?: PlayerPokemon;
}

/**
 * The name of what wakes the Jirachi in `pokemon`: its first move of {@linkcode WISH_ON_A_STAR_WAKE_MOVES} in moveset
 * order, else its first ability of {@linkcode WISH_ON_A_STAR_WAKE_ABILITIES} (a passive counts); `null` when it has none
 */
export function getWishOnAStarWakeSound(pokemon: PlayerPokemon): string | null {
  const move = pokemon.moveset.find(m => m?.moveId != null && WISH_ON_A_STAR_WAKE_MOVES.includes(m.moveId));
  if (move) {
    return move.getName();
  }
  const ability = WISH_ON_A_STAR_WAKE_ABILITIES.find(a => pokemon.hasAbility(a, false));
  return ability == null ? null : allAbilities[ability].name;
}

/**
 * Option 1's requirement: a party member able to battle that knows a waking move or has a waking ability. Its token
 * `wakeSound` (as `option1PrimaryWakeSound`) names that move or ability, so the text needs no move/ability split.
 */
export class WishOnAStarWakeRequirement extends EncounterPokemonRequirement {
  constructor() {
    super();
    this.minNumberOfPokemon = 1;
    this.invertQuery = false;
  }

  override meetsRequirement(): boolean {
    return this.queryParty(globalScene.getPlayerParty()).length >= this.minNumberOfPokemon;
  }

  override queryParty(partyPokemon: PlayerPokemon[]): PlayerPokemon[] {
    return partyPokemon.filter(p => p.isAllowedInBattle() && getWishOnAStarWakeSound(p) != null);
  }

  override getDialogueToken(pokemon?: PlayerPokemon): [string, string] {
    return ["wakeSound", (pokemon && getWishOnAStarWakeSound(pokemon)) ?? ""];
  }
}

/** The first party member able to battle that knows Wish or Healing Wish, with that move; `null` without one */
export function getWishOnAStarWishMoveHolder(): { pokemon: PlayerPokemon; move: MoveId } | null {
  for (const pokemon of globalScene.getPlayerParty()) {
    if (!pokemon.isAllowedInBattle()) {
      continue;
    }
    const move = pokemon.moveset.find(m => m?.moveId != null && WISH_ON_A_STAR_WISH_MOVES.includes(m.moveId));
    if (move) {
      return { pokemon, move: move.moveId };
    }
  }
  return null;
}

/** The money of the wealth wish on this wave: x10 the wave's money, x20 with a wish move */
export function getWishOnAStarWealthMoney(bonus: boolean): number {
  return globalScene.getWaveMoneyAmount(
    bonus ? WISH_ON_A_STAR_WEALTH_BONUS_MULTIPLIER : WISH_ON_A_STAR_WEALTH_MULTIPLIER,
  );
}

/** The IV Candy of `stat` as a held item of `pokemon` (one candy) */
function newIvCandy(pokemon: PlayerPokemon, stat: PermanentStat): PokemonHeldItemModifier {
  const type = generateModifierType(modifierTypes.IV_CANDY, [stat]) as PokemonHeldItemModifierType;
  return type.newModifier(pokemon) as PokemonHeldItemModifier;
}

/** How many IV Candies of `stat` `pokemon` holds */
export function getWishOnAStarCandiesHeld(pokemon: PlayerPokemon, stat: PermanentStat): number {
  const candy = newIvCandy(pokemon, stat);
  return (
    pokemon
      .getHeldItems()
      .find(m => m.match(candy))
      ?.getStackCount() ?? 0
  );
}

/**
 * How many more IV Candies of `stat` `pokemon` can take: the fork's IV Candy rule, up to its IV in that stat
 * (`IvCandyModifier.getMaxHeldItemCount`)
 */
export function getWishOnAStarCandyRoom(pokemon: PlayerPokemon, stat: PermanentStat): number {
  const candy = newIvCandy(pokemon, stat);
  return Math.max(candy.getMaxStackCount() - getWishOnAStarCandiesHeld(pokemon, stat), 0);
}

/** Whether `pokemon` can take an IV Candy of any stat */
export function canTakeWishOnAStarCandy(pokemon: PlayerPokemon): boolean {
  return PERMANENT_STATS.some(stat => getWishOnAStarCandyRoom(pokemon, stat) > 0);
}

/**
 * The candies one stat gets from the power wish, by how many it already holds: the official Training Session's IV
 * steps (+10 at 10 or less, +5 at 20 or less, +3 above; the proposal's comment asks for that formula) counted in IV
 * Candies, the fork's way of raising a stat by its IV. Cut to the room left under the IV by the caller.
 */
export function getWishOnAStarCandyStep(held: number): number {
  if (held <= 10) {
    return 10;
  }
  return held <= 20 ? 5 : 3;
}

/** One stat's gift of the power wish */
export interface WishOnAStarCandyGift {
  readonly stat: PermanentStat;
  readonly count: number;
}

/**
 * The power wish's candies for `pokemon` (seeded RNG): `statCount` random stats among those with room (fewer when
 * fewer have room), each {@linkcode getWishOnAStarCandyStep} candies cut to its room, in stat order
 */
export function rollWishOnAStarCandies(pokemon: PlayerPokemon, statCount: number): WishOnAStarCandyGift[] {
  const open = PERMANENT_STATS.filter(stat => getWishOnAStarCandyRoom(pokemon, stat) > 0);
  return randSeedShuffle([...open])
    .slice(0, statCount)
    .sort((a, b) => a - b)
    .map(stat => ({
      stat,
      count: Math.min(
        getWishOnAStarCandyStep(getWishOnAStarCandiesHeld(pokemon, stat)),
        getWishOnAStarCandyRoom(pokemon, stat),
      ),
    }));
}

/** Gives `pokemon` the candies of `gifts`, one message per stat */
async function giveWishOnAStarCandies(pokemon: PlayerPokemon, gifts: readonly WishOnAStarCandyGift[]): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.setDialogueToken("selectedPokemon", pokemon.getNameToRender());
  for (const { stat, count } of gifts) {
    const candy = newIvCandy(pokemon, stat);
    candy.stackCount = count;
    globalScene.addModifier(candy, false, false, false, true);
    encounter.setDialogueToken("itemName", candy.type.name);
    encounter.setDialogueToken("count", count.toString());
    await showEncounterText(`${namespace}:wish.power.received`);
  }
  await globalScene.updateModifiers(true);
}

/**
 * Option 1's menu after the Jirachi wakes: wealth, power (then the Pokémon; left out while nobody can take a candy),
 * health, cancel. Resolves `true` with the pick in `encounter.misc` ({@linkcode WishOnAStarMisc}); cancel goes back to
 * the encounter's options, and backing out of the party screen back to this menu.
 */
function selectJirachiWish(): Promise<boolean> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const modeToSetOnExit = globalScene.ui.mode;
  const bonus = getWishOnAStarWishMoveHolder() != null;
  // Plain "₽3,700": the hover text shows in the battle message window, which draws no @[MONEY]{} colour codes (the
  // `money` formatter's output showed raw there, seen in the game 11-20)
  encounter.setDialogueToken("wealthMoney", i18next.t("common:money", { amount: getWishOnAStarWealthMoney(bonus) }));
  encounter.setDialogueToken(
    "powerStats",
    (bonus ? WISH_ON_A_STAR_POWER_BONUS_STATS : WISH_ON_A_STAR_POWER_STATS).toString(),
  );
  encounter.setDialogueToken("healingCharm", generateModifierType(modifierTypes.HEALING_CHARM)?.name ?? "");

  return new Promise<boolean>(resolve => {
    const choose = (misc: WishOnAStarMisc): void => {
      encounter.misc = misc;
      resolve(true);
    };

    const wishOption = (wish: JirachiWish, handler: () => void): OptionSelectItem => {
      const key = WISH_KEYS[wish];
      const tooltip = wish === JirachiWish.HEALTH && bonus ? "tooltipBonus" : "tooltip";
      return {
        label: i18next.t(`${namespace}:wish.${key}.label`),
        handler: () => {
          handler();
          return true;
        },
        onHover: () => {
          showEncounterText(`${namespace}:wish.${key}.${tooltip}`, 0, 0, false);
        },
      };
    };

    // The wake-up text waits for a press the first time: the menu's hover texts replace whatever is shown
    let woken = false;
    const openMenu = (): void => {
      const options: OptionSelectItem[] = [wishOption(JirachiWish.WEALTH, () => choose({ wish: JirachiWish.WEALTH }))];
      if (globalScene.getPlayerParty().some(p => canTakeWishOnAStarCandy(p))) {
        options.push(wishOption(JirachiWish.POWER, () => choosePokemon()));
      }
      options.push(wishOption(JirachiWish.HEALTH, () => choose({ wish: JirachiWish.HEALTH })));
      options.push({
        label: i18next.t("menu:cancel"),
        handler: () => {
          globalScene.ui.clearText();
          globalScene.ui.setMode(modeToSetOnExit);
          resolve(false);
          return true;
        },
        onHover: () => {
          showEncounterText(i18next.t("mysteryEncounterMessages:cancelOption"), 0, 0, false);
        },
      });
      // A handler returns true right after this starts, and the old menu is cleared before the new one opens
      globalScene.ui.setMode(UiMode.MESSAGE).then(async () => {
        if (!woken) {
          woken = true;
          await showEncounterText(`${namespace}:wishPrompt`);
        }
        const config: OptionSelectModeConfig = { options, maxOptions: 7, yOffset: 48 };
        globalScene.ui.setModeWithoutClear(UiMode.OPTION_SELECT, config);
      });
    };

    // From the message mode, so the party screen goes back to it (not to the cleared option menu)
    const choosePokemon = (): void => {
      const filter: PokemonSelectFilter = pokemon =>
        canTakeWishOnAStarCandy(pokemon)
          ? null
          : i18next.t(`${namespace}:wish.power.full`, { pokemonName: pokemon.getNameToRender() });
      globalScene.ui.setMode(UiMode.MESSAGE).then(() =>
        selectPokemonForOption(
          pokemon => {
            encounter.misc = { wish: JirachiWish.POWER, pokemon } satisfies WishOnAStarMisc;
          },
          undefined,
          filter,
        ).then(selected => {
          if (selected) {
            resolve(true);
          } else {
            openMenu();
          }
        }),
      );
    };

    openMenu();
  });
}

/**
 * Option 1 after the menu: the picked wish, bigger with a wish move ({@linkcode getWishOnAStarWishMoveHolder}).
 * - wealth: x10 the wave's money (x20);
 * - power: IV Candies in 2 (4) random stats of the picked Pokémon ({@linkcode rollWishOnAStarCandies});
 * - health: the whole party healed, and a Healing Charm with a wish move (the fork's stack-full stand-in when full).
 */
export async function grantJirachiWish(misc: WishOnAStarMisc): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const holder = getWishOnAStarWishMoveHolder();
  const bonus = holder != null;
  // rolled before the first message, while the option's seed offset still holds
  const gifts =
    misc.wish === JirachiWish.POWER && misc.pokemon
      ? rollWishOnAStarCandies(misc.pokemon, bonus ? WISH_ON_A_STAR_POWER_BONUS_STATS : WISH_ON_A_STAR_POWER_STATS)
      : [];
  if (holder) {
    encounter.setDialogueToken("wishPokemon", holder.pokemon.getNameToRender());
    encounter.setDialogueToken("wishMove", allMoves[holder.move].name);
    await showEncounterText(`${namespace}:wish.bonus`);
  }

  switch (misc.wish) {
    case JirachiWish.WEALTH: {
      const money = getWishOnAStarWealthMoney(bonus);
      updatePlayerMoney(money, true, false);
      encounter.setDialogueToken("wealthMoney", i18next.t("common:money", { amount: money }));
      await showEncounterText(`${namespace}:wish.wealth.result`);
      break;
    }
    case JirachiWish.POWER:
      if (misc.pokemon) {
        await giveWishOnAStarCandies(misc.pokemon, gifts);
      }
      break;
    case JirachiWish.HEALTH:
      // The official Slumbering Snorlax's rest: these run after this phase, in this order (the option phase queues
      // Jirachi's sleep text after them)
      globalScene.phaseManager.unshiftNew("PartyHealPhase", true);
      queueEncounterMessage(`${namespace}:wish.health.result`);
      if (bonus) {
        globalScene.phaseManager.unshiftNew("ModifierRewardPhase", modifierTypes.HEALING_CHARM);
      }
      break;
  }
}

/**
 * Option 2's boss: an angry Jirachi, shiny locked (the intro shows an ordinary one, as the official Slumbering Snorlax
 * locks its boss), one boss segment more than usual like the fork's other Rogue bosses, the official level bonus;
 * +1 to every stat as it comes out (the proposal's "ANGRY Jirachi with stat boosts"). Its held items are the ordinary
 * random ones.
 */
function getWishOnAStarBossConfig(): EnemyPartyConfig {
  const pokemonConfig: EnemyPokemonConfig = {
    species: speciesDataRegistry.getSpecies(SpeciesId.JIRACHI),
    isBoss: true,
    shiny: false,
    bossSegmentModifier: 1,
    moveSet: [...WISH_ON_A_STAR_BOSS_MOVES],
    tags: [BattlerTagType.MYSTERY_ENCOUNTER_POST_SUMMON],
    mysteryEncounterBattleEffects: (pokemon: Pokemon) => {
      queueEncounterMessage(`${namespace}:option.2.statBoost`);
      globalScene.phaseManager.unshiftNew("StatStageChangePhase", {
        battlerIndex: pokemon.getBattlerIndex(),
        changes: groupStatChange(WISH_ON_A_STAR_ANGRY_STATS, 1),
        sourcePokemon: pokemon,
      });
    },
  };
  return {
    levelAdditiveModifier: 0.5,
    pokemonConfigs: [pokemonConfig],
  };
}

/**
 * "별에게 소원을" (WISH_ON_A_STAR), local fork (2026-11-20): a Jirachi asleep in the depths of space.
 * 1. Sing it awake (a party member able to battle knows a song, a wake-up move or a sound move, or has Electric Surge,
 *    Misty Surge or Punk Rock): pick a wish (wealth, power, health); a Pokémon that knows Wish or Healing Wish makes it
 *    bigger. Then the Jirachi falls asleep again.
 * 2. Shake it awake: a boss battle against an angry Jirachi with +1 to every stat; it can be caught. Won: a Rogue item,
 *    then ordinary rewards.
 * 3. Leave.
 * ROGUE tier, the usual encounter waves (no last wave in Endless), in Space only.
 */
export const WishOnAStarEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.WISH_ON_A_STAR,
)
  .withEncounterTier(MysteryEncounterTier.ROGUE)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withCatchAllowed(true)
  .withHideWildIntroMessage(true)
  .withFleeAllowed(false)
  .withIntroSpriteConfigs([
    {
      // the existing Jirachi art, held still while it sleeps
      species: SpeciesId.JIRACHI,
      spriteKey: "",
      fileRoot: "",
      hasShadow: true,
      disableAnimation: true,
      scale: 1.25,
      y: -4,
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
    encounter.enemyPartyConfigs = [getWishOnAStarBossConfig()];
    encounter.setDialogueToken("wishMoveName", allMoves[MoveId.WISH].name);
    encounter.setDialogueToken("healingWishMoveName", allMoves[MoveId.HEALING_WISH].name);
    return true;
  })
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_SPECIAL)
      .withPrimaryPokemonRequirement(new WishOnAStarWakeRequirement())
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
      .withPreOptionPhase(async (): Promise<boolean> => selectJirachiWish())
      .withOptionPhase(async () => {
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        const misc = encounter.misc as WishOnAStarMisc;
        await grantJirachiWish(misc);
        if (misc.wish === JirachiWish.HEALTH) {
          // Review (2026-11-20): the heal, its text and the Healing Charm are queued phases that run after this one, so
          // Jirachi falls asleep after them too (shown here, it fell asleep before its light healed the party)
          queueEncounterMessage(`${namespace}:option.1.sleep`);
        } else {
          await showEncounterText(`${namespace}:option.1.sleep`);
        }
        // nothing else: no reward screen and no shop, as Slumbering Snorlax's rest
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
        // The intro is already hidden (auto-hide); the official Slumbering Snorlax's battle start
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        setEncounterRewards({ guaranteedModifierTiers: [...WISH_ON_A_STAR_WIN_TIERS], fillRemaining: true });
        await initBattleWithEnemyConfig(encounter.enemyPartyConfigs[0]);
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
        // Leave: nothing gained and no shop, as the fork's other encounters leave
        leaveEncounterWithoutBattle();
      })
      .build(),
  )
  .build();
