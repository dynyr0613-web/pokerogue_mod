import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { settings } from "#app/global-settings-manager";
import { modifierTypes } from "#data/data-lists";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import type { PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { getEncounterText, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import {
  generateModifierType,
  leaveEncounterWithoutBattle,
  selectPokemonForOption,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { PartySizeRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { randSeedItem } from "#utils/common";

/** the i18n namespace for the encounter */
const namespace = "mysteryEncounters/darkGlobalTradeSystem";

/** One held-item reward of the "GTS?" */
export interface DarkGtsReward {
  /** Key of `modifierTypes` */
  readonly id: "MINI_BLACK_HOLE" | "MYSTERY_ENCOUNTER_MACHO_BRACE" | "PRISM" | "MULTI_LENS" | "GOLDEN_EGG";
  /** How many the receiver gets (fewer if its stack can't take them all) */
  readonly count: number;
}

/** Option 1: one of these, picked uniformly among those somebody can still hold, for the sent Pokémon */
export const DARK_GTS_SEND_REWARDS: readonly DarkGtsReward[] = [
  { id: "MINI_BLACK_HOLE", count: 1 },
  { id: "MYSTERY_ENCOUNTER_MACHO_BRACE", count: 1 },
  { id: "PRISM", count: 2 },
  { id: "MULTI_LENS", count: 2 },
];

/** Option 2: what a party member is found holding after walking away */
export const DARK_GTS_LEAVE_REWARD: DarkGtsReward = { id: "GOLDEN_EGG", count: 1 };

/** The item type of `reward`, with its id and tier set */
export function getDarkGtsRewardType(reward: DarkGtsReward): PokemonHeldItemModifierType {
  return generateModifierType(modifierTypes[reward.id]) as PokemonHeldItemModifierType;
}

/** How many more of `type` `pokemon` can hold before its stack is full */
export function getDarkGtsRoom(pokemon: PlayerPokemon, type: PokemonHeldItemModifierType): number {
  const modifier = type.newModifier(pokemon) as PokemonHeldItemModifier;
  const held = pokemon.getHeldItems().find(m => m.match(modifier));
  return Math.max(modifier.getMaxStackCount() - (held?.getStackCount() ?? 0), 0);
}

/** A reward, who gets it, and how many of it fit */
export interface DarkGtsRewardPick {
  readonly reward: DarkGtsReward;
  readonly type: PokemonHeldItemModifierType;
  readonly receiver: PlayerPokemon;
  /** How many of `reward.count` the receiver takes; 0 when no reward fitted anybody */
  readonly given: number;
}

/**
 * Picks one of `rewards` and its receiver among `candidates` (seeded RNG):
 * - only rewards that at least one candidate can still take 1 of are offered, uniformly;
 * - the receiver is picked uniformly among the candidates that can take the full count, else among those that can
 *   take at least 1, and gets as many as fit;
 * - when no reward fits anybody, any reward goes to any candidate with `given` 0 and the caller hands out the
 *   fork's stack-full stand-in instead (see {@linkcode giveDarkGtsReward}).
 *
 * `null` only without candidates, which the options rule out (option 1 needs two Pokémon, the party is never empty).
 */
export function pickDarkGtsReward(
  rewards: readonly DarkGtsReward[],
  candidates: readonly PlayerPokemon[],
): DarkGtsRewardPick | null {
  if (candidates.length === 0 || rewards.length === 0) {
    return null;
  }
  const options = rewards.map(option => {
    const optionType = getDarkGtsRewardType(option);
    const optionRooms = candidates.map(member => ({ member, room: getDarkGtsRoom(member, optionType) }));
    return { reward: option, type: optionType, rooms: optionRooms };
  });
  const offerable = options.filter(o => o.rooms.some(r => r.room >= 1));
  if (offerable.length === 0) {
    const fallback = randSeedItem(options);
    return { reward: fallback.reward, type: fallback.type, receiver: randSeedItem(candidates), given: 0 };
  }
  const { reward, type, rooms } = randSeedItem(offerable);
  const takesAll = rooms.filter(r => r.room >= reward.count);
  const receiver = randSeedItem(takesAll.length > 0 ? takesAll : rooms.filter(r => r.room >= 1));
  return { reward, type, receiver: receiver.member, given: Math.min(receiver.room, reward.count) };
}

/**
 * Hands out `pick` and says so: `textKey` (or `countTextKey` for more than one) names the receiver, the item and
 * the count. When nothing fitted, gives what a full stack turns into, like every other held-item reward of the
 * fork (its tier's Poké Balls, or nothing when those are full too; `BattleScene.getStackFullFallback`), with its
 * message.
 */
export async function giveDarkGtsReward(
  pick: DarkGtsRewardPick | null,
  textKey: string,
  countTextKey: string = textKey,
): Promise<void> {
  if (!pick) {
    return;
  }
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const modifier = pick.type.newModifier(pick.receiver) as PokemonHeldItemModifier;
  if (pick.given <= 0) {
    const { message, fallback } = globalScene.getStackFullFallback(modifier);
    if (fallback) {
      globalScene.addModifier(fallback.newModifier(), false, false, false, true);
    }
    await showEncounterText(message, null, undefined, true);
    return;
  }

  modifier.stackCount = pick.given;
  globalScene.addModifier(modifier, false, false, false, true);
  encounter.setDialogueToken("receiver", pick.receiver.getNameToRender());
  encounter.setDialogueToken("itemName", pick.type.name);
  encounter.setDialogueToken("count", pick.given.toString());
  await showEncounterText(pick.given > 1 ? countTextKey : textKey);
}

/** Removes `pokemon` and its held items from the party for good */
async function sendIntoDarkGts(pokemon: PlayerPokemon): Promise<void> {
  const index = globalScene.getPlayerParty().indexOf(pokemon);
  if (index < 0) {
    return;
  }
  await globalScene.removePartyMemberModifiers(index);
  globalScene.removePokemonFromPlayerParty(pokemon);
}

/**
 * "GTS?" (DARK_GLOBAL_TRADE_SYSTEM), local fork (the user, 2026-11-08): a pitch-black GTS terminal.
 * 1. Send one Pokémon (gone for good, with its held items; nothing comes back for it). Another party member gets one
 *    of Mini Black Hole, Macho Brace (교정깁스), 2 Prisms or 2 Multi Lenses.
 * 2. Walk away: a party member is found holding a Golden Egg.
 * ROGUE tier, in the GTS's civilization biomes plus Space, the End and the Abyss. In Endless, the wave before an
 * Eternatus is rarely forced into this encounter in the End (`isDarkGtsEndWave`, dark-gts-spawn.ts).
 */
export const DarkGlobalTradeSystemEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.DARK_GLOBAL_TRADE_SYSTEM,
)
  .withEncounterTier(MysteryEncounterTier.ROGUE)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    {
      // pitch-black GTS terminal, laid out like the GTS's (tools/port/make_dark_gts_sprite.py)
      spriteKey: "dark_global_trade_system",
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
    encounter.misc = {
      bgmKey: settings.musicPreferenceAllGens ? "mystery_encounter_gen_6_gts" : "mystery_encounter_gen_5_gts",
    };
    return true;
  })
  .withOnVisualsStart(() => {
    audioManager.playBgm(globalScene.currentBattle.mysteryEncounter!.misc.bgmKey, true);
    return true;
  })
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
      .withSceneRequirement(new PartySizeRequirement([2, 6], true)) // Requires 2 valid party members, like the GTS
      .withDialogue({
        buttonLabel: `${namespace}:option.1.label`,
        buttonTooltip: `${namespace}:option.1.tooltip`,
        disabledButtonTooltip: `${namespace}:option.1.disabledTooltip`,
      })
      .withPreOptionPhase(async (): Promise<boolean> => {
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        const onPokemonSelected = (pokemon: PlayerPokemon) => {
          encounter.setDialogueToken("sentPokemon", pokemon.getNameToRender());
          encounter.misc.sentPokemon = pokemon;
        };
        // the GTS's Wonder Trade pick: the party screen, any party member
        const selection = selectPokemonForOption(onPokemonSelected);
        // The party screen opens at once from the encounter screen: its message box asks for the Pokémon to send
        if (globalScene.ui.mode === UiMode.PARTY) {
          globalScene.ui.showText(getEncounterText(`${namespace}:option.1.prompt`) ?? "", 0);
        }
        return selection;
      })
      .withOptionPhase(async () => {
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        const sentPokemon: PlayerPokemon = encounter.misc.sentPokemon;
        await sendIntoDarkGts(sentPokemon);

        const pick = pickDarkGtsReward(DARK_GTS_SEND_REWARDS, globalScene.getPlayerParty());
        await showEncounterText(`${namespace}:sent`);
        await giveDarkGtsReward(pick, `${namespace}:received`, `${namespace}:receivedCount`);

        leaveEncounterWithoutBattle(true);
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
        const pick = pickDarkGtsReward([DARK_GTS_LEAVE_REWARD], globalScene.getPlayerParty());
        await giveDarkGtsReward(pick, `${namespace}:option.2.received`);
        // the user: no battle and no reward screen, the run just goes on
        leaveEncounterWithoutBattle();
      })
      .build(),
  )
  .build();
