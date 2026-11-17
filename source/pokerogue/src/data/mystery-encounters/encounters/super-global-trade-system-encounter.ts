import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { settings } from "#app/global-settings-manager";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import type { ModifierTypeOption } from "#modifiers/modifier-type";
import {
  getAvailablePlayerRewardTiers,
  getPlayerModifierTypeOptions,
  regenerateModifierPoolThresholds,
} from "#modifiers/modifier-type";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import { leaveEncounterWithoutBattle, setEncounterRewards } from "#mystery-encounters/encounter-phase-utils";
import { generateRandomTraderName } from "#mystery-encounters/global-trade-system-encounter";
import { getTradedItemTier } from "#mystery-encounters/hyper-global-trade-system-encounter";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { EncounterSceneRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import type { OptionSelectItem, OptionSelectModeConfig } from "#types/ui-types";
import i18next from "i18next";

/** the i18n namespace for the encounter */
const namespace = "mysteryEncounters/superGlobalTradeSystem";

/** One way to trade at the Super GTS */
export interface SuperGtsTrade {
  /** Held items sent, all of one reward tier */
  readonly count: number;
  /** How many tiers above the sent items the offered rewards are */
  readonly tierStep: number;
  /** Rewards shown on the reward screen; the player takes one */
  readonly choices: number;
}

/**
 * The user's numbers (2026-11-07): 5 items of one tier for one of 3 rewards a tier higher, 10 items for one of 5
 * rewards two tiers higher.
 */
export const SUPER_GTS_TRADES: readonly [SuperGtsTrade, SuperGtsTrade] = [
  { count: 5, tierStep: 1, choices: 3 },
  { count: 10, tierStep: 2, choices: 5 },
];
/** Rolls for the reward screen before it settles for fewer, all different, offers */
const SUPER_GTS_MAX_ROLLS = 60;

/** One held-item stack the Super GTS can take */
export interface SuperGtsStack {
  readonly pokemon: PlayerPokemon;
  readonly modifier: PokemonHeldItemModifier;
  /** Reward-pool tier, read like the GTS and the Hyper GTS do ({@linkcode getTradedItemTier}) */
  readonly tier: ModifierTier;
}

/** Transferable held items of the player's party below Master tier, one entry per stack. */
export function getSuperGtsStacks(): SuperGtsStack[] {
  const stacks: SuperGtsStack[] = [];
  for (const pokemon of globalScene.getPlayerParty()) {
    for (const modifier of pokemon.getHeldItems()) {
      if (!modifier.isTransferable) {
        continue;
      }
      const tier = getTradedItemTier(modifier);
      if (tier < ModifierTier.MASTER) {
        stacks.push({ pokemon, modifier, tier });
      }
    }
  }
  return stacks;
}

/** The tier of the rewards for items of `sentTier`, or `null` when it would be above Master. */
export function getSuperGtsRewardTier(sentTier: ModifierTier, trade: SuperGtsTrade): ModifierTier | null {
  const tier = sentTier + trade.tierStep;
  return tier <= ModifierTier.MASTER ? (tier as ModifierTier) : null;
}

/**
 * The tiers `trade` can be done with: the party holds at least `trade.count` items of that tier (stacks counted item
 * by item, across the party) and the reward tier is not above Master. With `rewardTiers` (see
 * {@linkcode getAvailablePlayerRewardTiers}), the reward tier must also have items to give right now: with every
 * Master item capped or filtered out, a trade into Master would quietly pay in Rogue items. Lowest tier first.
 */
export function getSuperGtsTradeTiers(
  trade: SuperGtsTrade,
  stacks: readonly SuperGtsStack[] = getSuperGtsStacks(),
  rewardTiers?: ReadonlySet<ModifierTier>,
): { tier: ModifierTier; total: number }[] {
  const totals = new Map<ModifierTier, number>();
  for (const stack of stacks) {
    totals.set(stack.tier, (totals.get(stack.tier) ?? 0) + stack.modifier.getStackCount());
  }
  return [...totals.entries()]
    .filter(([tier, total]) => {
      const rewardTier = getSuperGtsRewardTier(tier, trade);
      return total >= trade.count && rewardTier !== null && (rewardTiers?.has(rewardTier) ?? true);
    })
    .sort(([a], [b]) => a - b)
    .map(([tier, total]) => ({ tier, total }));
}

/**
 * Met while `trade` can be done with some tier (see {@linkcode getSuperGtsTradeTiers}). With `checkRewardPool` the
 * reward tier must have items right now; the encounter's own spawn check leaves that out, since regenerating the
 * reward thresholds rolls the item generators.
 */
export class SuperGtsItemRequirement extends EncounterSceneRequirement {
  private readonly trade: SuperGtsTrade;
  private readonly checkRewardPool: boolean;

  constructor(trade: SuperGtsTrade, checkRewardPool = false) {
    super();
    this.trade = trade;
    this.checkRewardPool = checkRewardPool;
  }

  override meetsRequirement(): boolean {
    const stacks = getSuperGtsStacks();
    if (getSuperGtsTradeTiers(this.trade, stacks).length === 0) {
      return false;
    }
    if (!this.checkRewardPool) {
      return true;
    }
    const rewardTiers = getAvailablePlayerRewardTiers(globalScene.getPlayerParty());
    return getSuperGtsTradeTiers(this.trade, stacks, rewardTiers).length > 0;
  }

  override getDialogueToken(): [string, string] {
    return ["itemCount", this.trade.count.toString()];
  }
}

/** Items picked from one stack */
export interface SuperGtsPick {
  readonly stack: SuperGtsStack;
  count: number;
}

/**
 * The items chosen for one trade, all of `tier`. Picking a stack takes as many of it as are still needed, so a
 * player who wants only part of a big stack picks the smaller stacks first.
 */
export class SuperGtsSelection {
  readonly trade: SuperGtsTrade;
  readonly tier: ModifierTier;
  readonly picks: SuperGtsPick[] = [];

  constructor(trade: SuperGtsTrade, tier: ModifierTier) {
    this.trade = trade;
    this.tier = tier;
  }

  /** Items still to pick */
  get remaining(): number {
    return this.trade.count - this.picks.reduce((sum, p) => sum + p.count, 0);
  }

  get done(): boolean {
    return this.remaining === 0;
  }

  /** Items of `stack` not picked yet */
  available(stack: SuperGtsStack): number {
    const picked = this.picks.find(p => p.stack.modifier === stack.modifier)?.count ?? 0;
    return stack.modifier.getStackCount() - picked;
  }

  /** The party's stacks of this tier that still have items to give */
  stacks(): SuperGtsStack[] {
    return getSuperGtsStacks().filter(s => s.tier === this.tier && this.available(s) > 0);
  }

  /** Takes as many of `stack` as are still needed; returns how many */
  pick(stack: SuperGtsStack): number {
    const count = Math.min(this.available(stack), this.remaining);
    if (count <= 0) {
      return 0;
    }
    const existing = this.picks.find(p => p.stack.modifier === stack.modifier);
    if (existing) {
      existing.count += count;
    } else {
      this.picks.push({ stack, count });
    }
    return count;
  }

  /** Items picked so far */
  get picked(): number {
    return this.trade.count - this.remaining;
  }

  /**
   * "Silk Scarf ×3, Spell Tag ×1" and "Fairy Feather ×1" on the next line: two picks per line and two lines per
   * message page, pages split with `$`, so a list of many stacks never runs past the two-line message box.
   */
  summary(): string {
    const entries = this.picks.map(p => `${p.stack.modifier.type.name} ×${p.count}`);
    const lines: string[] = [];
    for (let i = 0; i < entries.length; i += 2) {
      lines.push(entries.slice(i, i + 2).join(", "));
    }
    const pages: string[] = [];
    for (let i = 0; i < lines.length; i += 2) {
      pages.push(lines.slice(i, i + 2).join("\n"));
    }
    return pages.join("$");
  }

  /** Removes the picked items from their holders (not a battle loss, so no Unburden/Cud Chew triggers) */
  takeItems(): void {
    for (const pick of this.picks) {
      for (let i = 0; i < pick.count; i++) {
        pick.stack.pokemon.loseHeldItem(pick.stack.modifier, false);
      }
    }
  }
}

/** The tier's ball name, e.g. "하이퍼볼" */
function getTierName(tier: ModifierTier): string {
  return i18next.t(`${namespace}:tier.${tier}`);
}

/**
 * The item choice for `trade`: first the tier, then stacks until `trade.count` items are picked. Cancel at any step
 * goes back to the encounter's options; "pick again" restarts from the tier. Resolves `true` with the selection in
 * `encounter.misc.selection`.
 */
function selectSuperGtsItems(trade: SuperGtsTrade): Promise<boolean> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const modeToSetOnExit = globalScene.ui.mode;

  return new Promise<boolean>(resolve => {
    const cancelOption: OptionSelectItem = {
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
    };

    // A handler returns true right after this starts, and the old menu is cleared before the new one opens
    const openMenu = (promptKey: string, options: OptionSelectItem[]): void => {
      globalScene.ui.setMode(UiMode.MESSAGE).then(async () => {
        await showEncounterText(promptKey, null, 0, false);
        const config: OptionSelectModeConfig = { options: [...options, cancelOption], maxOptions: 7, yOffset: 48 };
        globalScene.ui.setModeWithoutClear(UiMode.OPTION_SELECT, config);
      });
    };

    const chooseTier = (): void => {
      const rewardTiers = getAvailablePlayerRewardTiers(globalScene.getPlayerParty());
      const tiers = getSuperGtsTradeTiers(trade, getSuperGtsStacks(), rewardTiers);
      const options = tiers.map(({ tier, total }): OptionSelectItem => {
        const rewardTier = getSuperGtsRewardTier(tier, trade)!;
        return {
          label: i18next.t(`${namespace}:tierOption`, {
            tier: getTierName(tier),
            count: total,
            target: getTierName(rewardTier),
          }),
          handler: () => {
            chooseItems(new SuperGtsSelection(trade, tier));
            return true;
          },
        };
      });
      encounter.setDialogueToken("itemCount", trade.count.toString());
      openMenu(`${namespace}:tierPrompt`, options);
    };

    const chooseItems = (selection: SuperGtsSelection): void => {
      encounter.setDialogueToken("tier", getTierName(selection.tier));
      encounter.setDialogueToken("remaining", selection.remaining.toString());
      encounter.setDialogueToken("picked", selection.picked.toString());
      const options = selection.stacks().map(
        (stack): OptionSelectItem => ({
          label: `${stack.pokemon.getNameToRender()}: ${stack.modifier.type.name} ×${selection.available(stack)}`,
          handler: () => {
            selection.pick(stack);
            if (selection.done) {
              finish(selection);
            } else {
              chooseItems(selection);
            }
            return true;
          },
        }),
      );
      options.push({
        label: i18next.t(`${namespace}:pickAgain`),
        handler: () => {
          chooseTier();
          return true;
        },
      });
      openMenu(selection.picks.length > 0 ? `${namespace}:itemPromptWithPicks` : `${namespace}:itemPrompt`, options);
    };

    const finish = (selection: SuperGtsSelection): void => {
      const rewardTier = getSuperGtsRewardTier(selection.tier, selection.trade)!;
      encounter.misc.selection = selection;
      encounter.setDialogueToken("sentItems", selection.summary());
      encounter.setDialogueToken("rewardTier", getTierName(rewardTier));
      resolve(true);
    };

    chooseTier();
  });
}

/**
 * Up to `choices` different rewards of `tier` (by name), rolled one at a time like the Hyper GTS's item trade. A plain
 * `guaranteedModifierTiers` screen repeats items: its duplicate check treats every item without a group as the same
 * group, so most Master screens of five showed a Master Ball or a Premium Voucher twice. Settles for fewer offers
 * only if {@linkcode SUPER_GTS_MAX_ROLLS} rolls can't find more different ones.
 */
export function rollSuperGtsRewards(tier: ModifierTier, choices: number): ModifierTypeOption[] {
  const party = globalScene.getPlayerParty();
  regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0);
  const offers: ModifierTypeOption[] = [];
  for (let roll = 0; offers.length < choices && roll < SUPER_GTS_MAX_ROLLS; roll++) {
    const [offer] = getPlayerModifierTypeOptions(1, party, [], {
      guaranteedModifierTiers: [tier],
      allowLuckUpgrades: false,
    });
    if (offer && !offers.some(o => o.type.name === offer.type.name)) {
      offers.push(offer);
    }
  }
  return offers;
}

/**
 * Sends the picked items and sets up the reward screen: `trade.choices` different rewards of the reward tier, take
 * one. Rerolls are off on that screen: a reroll builds an ordinary reward screen and would drop the trade's tier and
 * count (A Trainer's Test turns them off the same way).
 */
async function doSuperGtsTrade(): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const selection: SuperGtsSelection = encounter.misc.selection;
  const rewardTier = getSuperGtsRewardTier(selection.tier, selection.trade)!;

  selection.takeItems();
  await globalScene.updateModifiers(true, true);

  // the message names the number actually rolled: a nearly empty reward tier can give fewer than `trade.choices`
  const offers = rollSuperGtsRewards(rewardTier, selection.trade.choices);
  encounter.setDialogueToken("choices", offers.length.toString());
  setEncounterRewards({
    guaranteedModifierTypeOptions: offers,
    fillRemaining: false,
    rerollMultiplier: -1,
  });

  const traderName = generateRandomTraderName();
  encounter.setDialogueToken("tradeTrainerName", traderName.trim());
  await showEncounterText(`${namespace}:itemTradeSelected`);
  leaveEncounterWithoutBattle();
}

/**
 * Super GTS (슈퍼 GTS), local fork (the user, 2026-11-07): a way to get rid of held items nobody needs (spare type
 * boosters and the like), which until now only the GTS and the Hyper GTS took, one at a time.
 * 1. Send 5 held items of one tier: pick one of 3 rewards a tier higher.
 * 2. Send 10 held items of one tier: pick one of 5 rewards two tiers higher (so Ultra at most may be sent).
 * The items may come from several Pokémon and several stacks; Master-tier and untransferable items can't be sent.
 * The rewards come on a reward screen like a Mysterious Challengers prize: all different, no luck upgrades, no
 * reroll. A trade is only offered while its reward tier has items to give.
 * Spawns in the GTS's biomes, at GREAT tier, only while 5 items of one tier could be sent.
 */
export const SuperGlobalTradeSystemEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.SUPER_GLOBAL_TRADE_SYSTEM,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withSceneRequirement(new SuperGtsItemRequirement(SUPER_GTS_TRADES[0]))
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    {
      // GTS pedestal with a GTS-patterned Substitute doll (tools/port/make_super_gts_sprite.py)
      spriteKey: "super_global_trade_system",
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
      .withSceneRequirement(new SuperGtsItemRequirement(SUPER_GTS_TRADES[0], true))
      .withDialogue({
        buttonLabel: `${namespace}:option.1.label`,
        buttonTooltip: `${namespace}:option.1.tooltip`,
        disabledButtonTooltip: `${namespace}:option.1.disabledTooltip`,
      })
      .withPreOptionPhase(() => selectSuperGtsItems(SUPER_GTS_TRADES[0]))
      .withOptionPhase(doSuperGtsTrade)
      .build(),
  )
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
      .withSceneRequirement(new SuperGtsItemRequirement(SUPER_GTS_TRADES[1], true))
      .withDialogue({
        buttonLabel: `${namespace}:option.2.label`,
        buttonTooltip: `${namespace}:option.2.tooltip`,
        disabledButtonTooltip: `${namespace}:option.2.disabledTooltip`,
      })
      .withPreOptionPhase(() => selectSuperGtsItems(SUPER_GTS_TRADES[1]))
      .withOptionPhase(doSuperGtsTrade)
      .build(),
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.3.label`,
      buttonTooltip: `${namespace}:option.3.tooltip`,
      selected: [
        {
          text: `${namespace}:option.3.selected`,
        },
      ],
    },
    async () => {
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
