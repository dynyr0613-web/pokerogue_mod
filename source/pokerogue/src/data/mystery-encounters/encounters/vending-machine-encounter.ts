/**
 * Local fork (2026-11-08): "Vending Machine" (자판기, VENDING_MACHINE), the user's design: pay money for one random
 * Ultra, Rogue or Master item, or search under the machine for coins.
 */
import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import type { CustomModifierSettings, ModifierTypeOption } from "#modifiers/modifier-type";
import {
  getAvailablePlayerRewardTiers,
  getPlayerModifierTypeOptions,
  regenerateModifierPoolThresholds,
} from "#modifiers/modifier-type";
import { computeRerollCost } from "#modifiers/reroll-cost";
import { restoreOfferedMints } from "#mystery-encounters/dark-mysterious-chest-encounter";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import {
  generateModifierType,
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  updatePlayerMoney,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { EncounterSceneRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import i18next from "i18next";

/** i18n namespace for the encounter */
const namespace = "mysteryEncounters/vendingMachine";

/** What options 1, 2 and 3 sell: one random item of this tier each */
export const VENDING_MACHINE_TIERS: readonly [ModifierTier, ModifierTier, ModifierTier] = [
  ModifierTier.ULTRA,
  ModifierTier.ROGUE,
  ModifierTier.MASTER,
];
/** A price is this many times the reroll price of a reward screen holding one item of the tier, tiers locked */
export const VENDING_MACHINE_PRICE_MULTIPLIER = 2;
/** Rolls for an item of the bought tier before settling for any item (never happens while the tier is in stock) */
const VENDING_MACHINE_MAX_ROLLS = 50;

/**
 * The user's price rule (2026-11-08): twice what a reroll costs on this wave when the reward screen holds exactly one
 * item of `tier` and the Lock Capsule locks the tiers, before any reroll: 2 x ceil(wave / 10) x the tier's lock value
 * (Ultra 300, Rogue 750, Master 2000), Black Sludge included. The same {@linkcode computeRerollCost} the reward screen
 * uses, so the two can't drift apart.
 */
export function getVendingMachinePrice(tier: ModifierTier): number {
  return VENDING_MACHINE_PRICE_MULTIPLIER * computeRerollCost([tier], 0, 1);
}

/** What the machine settles when the encounter is set up (`encounter.misc`) */
export interface VendingMachineStock {
  /** Price of options 1-3, in order */
  readonly prices: readonly number[];
  /** Whether each of options 1-3 can be bought: its tier has an item to give right now ("품절" otherwise) */
  readonly inStock: readonly boolean[];
}

/** This wave's {@linkcode VendingMachineStock}, or `undefined` before the encounter is set up */
export function getVendingMachineStock(): VendingMachineStock | undefined {
  const encounter = globalScene.currentBattle?.mysteryEncounter;
  if (encounter?.encounterType !== MysteryEncounterType.VENDING_MACHINE) {
    return;
  }
  const stock = encounter.misc as VendingMachineStock | null | undefined;
  return stock?.prices ? stock : undefined;
}

/**
 * Option `slot` (0-2) can be bought: its tier is in stock and the player has its price. Its dialogue token is the
 * price ("option1Money" and so on, shown in the tooltips).
 */
export class VendingMachineRequirement extends EncounterSceneRequirement {
  private readonly slot: number;

  constructor(slot: number) {
    super();
    this.slot = slot;
  }

  override meetsRequirement(): boolean {
    const stock = getVendingMachineStock();
    return !!stock?.inStock[this.slot] && globalScene.money >= stock.prices[this.slot];
  }

  override getDialogueToken(): [string, string] {
    return ["money", (getVendingMachineStock()?.prices[this.slot] ?? 0).toString()];
  }
}

/**
 * One random item of `tier` (no luck upgrades). Rolled one at a time like the Mysterious Chest?: a roll thrown away
 * gives its mint nature back (the fork's mint rule records every rolled mint as offered). A roll of another tier is
 * only kept when {@linkcode VENDING_MACHINE_MAX_ROLLS} tries found none of `tier`, which can't happen while the tier
 * is in stock.
 */
export function rollVendingMachineReward(tier: ModifierTier): ModifierTypeOption | undefined {
  const party = globalScene.getPlayerParty();
  regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0);
  const roll = (): ModifierTypeOption | undefined =>
    getPlayerModifierTypeOptions(1, party, [], { guaranteedModifierTiers: [tier], allowLuckUpgrades: false })[0];
  for (let i = 0; i < VENDING_MACHINE_MAX_ROLLS; i++) {
    const offeredMints = new Set(globalScene.forkOfferedMintNatures);
    const offer = roll();
    if (offer?.type.tier === tier) {
      return offer;
    }
    restoreOfferedMints(offeredMints);
  }
  return roll() ?? undefined;
}

/**
 * Option `slot` (0-2): pays its price, then a reward screen with exactly one item of its tier, rolled when the reward
 * screen comes up (on the wave's own seed, so a reload rolls the same). No reroll: a reroll builds an ordinary screen.
 */
function buildBuyOption(slot: number): MysteryEncounterOption {
  const tier = VENDING_MACHINE_TIERS[slot];
  const option = slot + 1;
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
    .withSceneRequirement(new VendingMachineRequirement(slot))
    .withDialogue({
      buttonLabel: `${namespace}:option.${option}.label`,
      buttonTooltip: `${namespace}:option.${option}.tooltip`,
      disabledButtonTooltip: `${namespace}:option.${option}.disabledTooltip`,
    })
    .withOptionPhase(async () => {
      const price = getVendingMachineStock()!.prices[slot];
      // the usual money animation and purchase sound ("se/buy")
      updatePlayerMoney(-price, true, false);
      await showEncounterText(i18next.t("mysteryEncounterMessages:paidMoney", { amount: price }));

      const rewards: CustomModifierSettings = { fillRemaining: false, rerollMultiplier: -1 };
      setEncounterRewards(rewards, undefined, () => {
        const offer = rollVendingMachineReward(tier);
        rewards.guaranteedModifierTypeOptions = offer ? [offer] : [];
      });
      await showEncounterText(`${namespace}:dispensed`);
      leaveEncounterWithoutBattle();
    })
    .build();
}

/**
 * Vending Machine (자판기), local fork (the user, 2026-11-08): "자판기입니다. 돈을 넣으면 아이템이 나오죠!"
 * 1. Pay a little money: one random Ultra item.
 * 2. Pay a lot of money: one random Rogue item.
 * 3. Pay an absurd amount of money: one random Master item.
 * 4. Search under the machine: one Relic Gold's worth of money (the item itself, Amulet Coins included).
 * Prices: twice the Lock Capsule reroll price of a one-item reward screen of that tier ({@linkcode
 * getVendingMachinePrice}), settled when the encounter is set up. Options 1-3 need the money and an item of the tier
 * to give right now (sold out otherwise), so a Master purchase never pays out a Rogue item.
 * GREAT tier, in the civilization biomes (my choice: vending machines stand in towns), no party requirement.
 */
export const VendingMachineEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.VENDING_MACHINE,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    {
      // a red drink vending machine, one frame (50x76, made by the sprite session)
      spriteKey: "vending_machine",
      fileRoot: "mystery-encounters",
      hasShadow: true,
      disableAnimation: true,
      // where the GTS stands; its bottom row lands on the GTS's lowest drawn row
      x: 3,
      y: 4,
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
    const available = getAvailablePlayerRewardTiers(globalScene.getPlayerParty());
    const stock: VendingMachineStock = {
      prices: VENDING_MACHINE_TIERS.map(getVendingMachinePrice),
      inStock: VENDING_MACHINE_TIERS.map(tier => available.has(tier)),
    };
    encounter.misc = stock;
    return true;
  })
  .withOption(buildBuyOption(0))
  .withOption(buildBuyOption(1))
  .withOption(buildBuyOption(2))
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.4.label`,
        buttonTooltip: `${namespace}:option.4.tooltip`,
        selected: [
          {
            text: `${namespace}:option.4.selected`,
          },
        ],
      })
      .withOptionPhase(async () => {
        // One Relic Gold (its money, Amulet Coins included), exactly like leaving the Mysterious Chest?: no shop and
        // no reward screen
        const moneyBefore = globalScene.money;
        globalScene.addModifier(generateModifierType(modifierTypes.RELIC_GOLD)?.newModifier() ?? null, false, true);
        const gained = globalScene.money - moneyBefore;
        await showEncounterText(i18next.t("mysteryEncounterMessages:receiveMoney", { amount: gained }));
        leaveEncounterWithoutBattle();
      })
      .build(),
  )
  .build();
