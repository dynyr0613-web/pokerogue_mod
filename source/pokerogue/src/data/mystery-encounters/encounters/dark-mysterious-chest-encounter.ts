/**
 * Local fork (2026-11-08): "Mysterious Chest?" (DARK_MYSTERIOUS_CHEST), the user's ROGUE-tier pitch-black twist on
 * the official Mysterious Chest (mysterious-chest-encounter.ts, whose structure, chest animation and trap flow it
 * mirrors).
 */
import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { modifierTypes } from "#data/data-lists";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import type { Nature } from "#enums/nature";
import { SpeciesId } from "#enums/species-id";
import { type BattleStat, Stat } from "#enums/stat";
import type { PlayerPokemon } from "#field/pokemon";
import { ExtraModifierModifier, TempExtraModifierModifier } from "#modifiers/modifier";
import type { CustomModifierSettings, ModifierTypeOption } from "#modifiers/modifier-type";
import {
  getPlayerModifierTypeOptions,
  isSameRewardGroup,
  regenerateModifierPoolThresholds,
} from "#modifiers/modifier-type";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  generateModifierType,
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
  updatePlayerMoney,
} from "#mystery-encounters/encounter-phase-utils";
import { applyDamageToPokemon } from "#mystery-encounters/encounter-pokemon-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { NumberHolder, randSeedInt, toDmgValue } from "#utils/common";
import { groupStatChange } from "#utils/stat-change";
import i18next from "i18next";

/** i18n namespace for encounter */
const namespace = "mysteryEncounters/darkMysteriousChest";

/** The trap roll is out of this many */
const RAND_LENGTH = 100;
/** Option 1: 40% the chest is a trap (Gholdengo), else treasure */
export const DARK_CHEST_TRAP_PERCENT = 40;
/** Option 1, treasure: one of exactly these three, all different */
export const DARK_CHEST_TREASURE_TIERS: readonly ModifierTier[] = [
  ModifierTier.MASTER,
  ModifierTier.ROGUE,
  ModifierTier.ROGUE,
];
/** Option 1, trap won: these first, then the rest of an ordinary reward screen, all different */
export const DARK_CHEST_TRAP_WIN_TIERS: readonly ModifierTier[] = [ModifierTier.ROGUE];
/** Option 2: one of exactly these three, all different */
export const DARK_CHEST_COIN_TIERS: readonly ModifierTier[] = [
  ModifierTier.ROGUE,
  ModifierTier.ROGUE,
  ModifierTier.ULTRA,
];
/** Option 2 costs the wave's money amount times this (the helper the official price-scaled encounters use) */
export const DARK_CHEST_COIN_PRICE_MULTIPLIER = 10;
/** Tries per reward slot before giving up on finding an item not on the screen yet */
const DARK_CHEST_MAX_ROLLS = 50;

/**
 * Local fork (2026-11-12): the trap's price, instead of a KO (the user: "수수께끼 상자?의 40% 보스 모으령 이벤트는,
 * 선봉 포켓몬이 hp를 50%를 깎이고, 올랭크 -1인채 전투하는걸로 하죠, 즉사보단."). The lead (the party member sent out
 * first in the Gholdengo battle) loses `hpLossPercent` of its max HP, never below 1 HP, and enters the battle with
 * `statStages` on each of `stats`.
 */
export const DARK_CHEST_TRAP_PENALTY: Readonly<{
  hpLossPercent: number;
  statStages: number;
  stats: readonly BattleStat[];
}> = Object.freeze({
  hpLossPercent: 50,
  statStages: -1,
  stats: Object.freeze([Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD]) as readonly BattleStat[],
});

/** Option 2's price on this wave; the same number as the option's `MoneyRequirement` and its tooltip token */
export function getDarkChestCoinPrice(): number {
  return globalScene.getWaveMoneyAmount(DARK_CHEST_COIN_PRICE_MULTIPLIER);
}

/** How many rewards an ordinary reward screen shows right now: 3, plus Golden / Silver Poké Balls */
export function getDarkChestRewardCount(): number {
  const count = new NumberHolder(3);
  globalScene.applyModifiers(ExtraModifierModifier, true, count);
  globalScene.applyModifiers(TempExtraModifierModifier, true, count);
  return count.value;
}

/**
 * Local fork (2026-11-08): puts `BattleScene.forkOfferedMintNatures` back to `before` in place (a thrown-away reward
 * roll must not use up a mint nature that was never shown). Exported for the Vending Machine's one-item rolls.
 */
export function restoreOfferedMints(before: ReadonlySet<Nature>): void {
  const offered = globalScene.forkOfferedMintNatures;
  for (const nature of [...offered]) {
    if (!before.has(nature)) {
      offered.delete(nature);
    }
  }
}

/**
 * Rolls reward options one at a time so they all differ by name (a plain `guaranteedModifierTiers` screen gives up
 * after a few re-rolls and can then show the same item twice): one of each of `tiers` (no luck upgrades), then
 * ordinary rolls (tier from the pool, luck as usual) until there are `total` options. Like an ordinary screen, a
 * second item of a group already shown (two berries, two TMs) is only taken when {@linkcode DARK_CHEST_MAX_ROLLS}
 * tries found nothing else; a slot that finds no new item in twice that many is left out.
 * Local fork (2026-11-13): the group test is the reward screen's `isSameRewardGroup` (08 명세 3번), so only a non-empty
 * group counts; group-less items (held items, vitamins, type boosters...) only have to differ by name.
 * Local fork (2026-11-08): `preset` options (the Strong Stuff?'s Soul Dew) come first, count toward `total` and are
 * never rolled again.
 */
export function rollDarkChestRewards(
  tiers: readonly ModifierTier[],
  total = tiers.length,
  preset: readonly ModifierTypeOption[] = [],
): ModifierTypeOption[] {
  const party = globalScene.getPlayerParty();
  regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0);
  const offers: ModifierTypeOption[] = [...preset];
  const rollOne = (generate: () => ModifierTypeOption | undefined): void => {
    for (let roll = 0; roll < DARK_CHEST_MAX_ROLLS * 2; roll++) {
      // Local fork (2026-11-08): `getPlayerModifierTypeOptions` records every mint it returns as offered (the mint
      // rule), so a roll thrown away below gives its nature back; an ordinary screen also records only what it shows
      const offeredMints = new Set(globalScene.forkOfferedMintNatures);
      const offer = generate();
      if (!offer || offers.some(o => o.type.name === offer.type.name)) {
        restoreOfferedMints(offeredMints);
        continue;
      }
      if (roll < DARK_CHEST_MAX_ROLLS && offers.some(o => isSameRewardGroup(o.type, offer.type))) {
        restoreOfferedMints(offeredMints);
        continue;
      }
      offers.push(offer);
      return;
    }
  };

  for (const tier of tiers) {
    rollOne(
      () =>
        getPlayerModifierTypeOptions(1, party, [], { guaranteedModifierTiers: [tier], allowLuckUpgrades: false })[0],
    );
  }
  for (let slot = preset.length + tiers.length; slot < total; slot++) {
    rollOne(() => getPlayerModifierTypeOptions(1, party)[0]);
  }
  return offers;
}

/**
 * Sets the encounter's reward screen to `tiers` (all different), rolled when the reward screen comes up (the rewards
 * phase runs on the wave's own seed offset, so a reload rolls the same), plus ordinary rewards up to the usual count
 * when `fill` is set. Without `fill` the screen is exactly those items and cannot be rerolled (a reroll builds an
 * ordinary screen and would drop the tiers, like the Super GTS).
 */
function setDarkChestRewards(tiers: readonly ModifierTier[], fill: boolean): void {
  const rewards: CustomModifierSettings = fill
    ? { fillRemaining: false }
    : { fillRemaining: false, rerollMultiplier: -1 };
  setEncounterRewards(rewards, undefined, () => {
    rewards.guaranteedModifierTypeOptions = rollDarkChestRewards(
      tiers,
      fill ? getDarkChestRewardCount() : tiers.length,
    );
  });
}

/**
 * Local fork (2026-11-12): the party member the trap battle sends out first: the first one allowed in battle, as the
 * battle's own summon picks it (MysteryEncounterBattlePhase, SummonPhase); the boss config disables the switch prompt.
 */
export function getDarkChestTrapLead(): PlayerPokemon {
  return globalScene.getPokemonAllowedInBattle()[0];
}

/**
 * Local fork (2026-11-12): the trap's price ({@linkcode DARK_CHEST_TRAP_PENALTY}). The HP goes at once, through the
 * encounter helper that leaves an allowed Pokémon at 1 HP rather than fainting it. The stat stages drop when that
 * Pokémon first comes out in the battle (the encounter's PostSummonPhase hook, once): a plain self-inflicted change, so
 * Mist, Clear Body, Mirror Armor and the Clear Amulet do not stop it and Contrary / Simple do not change it. A White
 * Herb still clears it; Defiant / Competitive do not react (review fix: they skip self-inflicted drops, `selfTarget`).
 */
function applyDarkChestTrapPenalty(encounter: MysteryEncounter, lead: PlayerPokemon): void {
  const { hpLossPercent, statStages, stats } = DARK_CHEST_TRAP_PENALTY;
  applyDamageToPokemon(lead, toDmgValue((lead.getMaxHp() * hpLossPercent) / 100));
  encounter.misc.trapLeadId = lead.id;
  encounter.misc.trapStatsDropped = false;
  encounter.onPostSummon = pokemon => {
    if (encounter.misc.trapStatsDropped || pokemon.id !== encounter.misc.trapLeadId) {
      return;
    }
    encounter.misc.trapStatsDropped = true;
    globalScene.phaseManager.unshiftNew("StatStageChangePhase", {
      battlerIndex: pokemon.getBattlerIndex(),
      changes: groupStatChange(stats, statStages),
      sourcePokemon: pokemon,
      ignoreAbilities: true,
    });
  };
}

/** Opens the chest on screen (the official chest's animation), turning it red first when it is a trap */
function playDarkChestAnimation(trap: boolean): void {
  const introVisuals = globalScene.currentBattle.mysteryEncounter!.introVisuals!;
  if (trap) {
    // Chest is springing trap, change to red chest sprite
    const blackChestSprites = introVisuals.getSpriteAtIndex(0);
    const redChestSprites = introVisuals.getSpriteAtIndex(1);
    redChestSprites[0].setAlpha(1);
    blackChestSprites[0].setAlpha(0.001);
  }
  introVisuals.spriteConfigs[0].disableAnimation = false;
  introVisuals.spriteConfigs[1].disableAnimation = false;
  introVisuals.playAnim();
}

/**
 * "Mysterious Chest?" (DARK_MYSTERIOUS_CHEST), local fork (the user, 2026-11-08): a pitch-black chest.
 * 1. Open it: 40% a Gholdengo trap (since 2026-11-12 the lead loses half its max HP and fights with -1 Attack,
 *    Defense, Sp. Atk, Sp. Def and Speed, {@linkcode DARK_CHEST_TRAP_PENALTY}, where it used to be the highest-level
 *    Pokémon fainting; then a catchable Gholdengo boss; winning gives a guaranteed Rogue item on an otherwise ordinary
 *    reward screen), 60% one of a Master and two Rogue items.
 * 2. Throw in coins (the wave's money x10): one of two Rogue items and an Ultra item, no trap.
 * 3. Leave: one Relic Gold on the way out.
 * ROGUE tier, in the Ruins, Temple, Graveyard and Abyss; in Endless also forced on rare 777 waves (special-spawns.ts).
 */
export const DarkMysteriousChestEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.DARK_MYSTERIOUS_CHEST,
)
  .withEncounterTier(MysteryEncounterTier.ROGUE)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withScenePartySizeRequirement(2)
  .withAutoHideIntroVisuals(false)
  .withCatchAllowed(true)
  .withIntroSpriteConfigs([
    {
      // black and gold, frames laid out like mysterious_chest_blue
      spriteKey: "dark_mysterious_chest_blue",
      fileRoot: "mystery-encounters",
      hasShadow: true,
      y: 8,
      yShadow: 6,
      alpha: 1,
      disableAnimation: true, // Re-enabled after option select
    },
    {
      // black and crimson, the trap
      spriteKey: "dark_mysterious_chest_red",
      fileRoot: "mystery-encounters",
      hasShadow: false,
      y: 8,
      yShadow: 6,
      alpha: 0,
      disableAnimation: true, // Re-enabled after option select
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
    const gholdengo = speciesDataRegistry.getSpecies(SpeciesId.GHOLDENGO);

    // The official trap's boss rules, with one more boss segment
    const config: EnemyPartyConfig = {
      levelAdditiveModifier: 0.5,
      disableSwitch: true,
      pokemonConfigs: [
        {
          species: gholdengo,
          formIndex: 0,
          isBoss: true,
          bossSegmentModifier: 1,
          moveSet: [MoveId.MAKE_IT_RAIN, MoveId.NASTY_PLOT, MoveId.SHADOW_BALL, MoveId.THIEF],
        },
      ],
    };

    encounter.enemyPartyConfigs = [config];
    encounter.setDialogueToken("gholdengoName", gholdengo.getName());

    return true;
  })
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.1.label`,
        buttonTooltip: `${namespace}:option.1.tooltip`,
        selected: [
          {
            text: `${namespace}:option.1.selected`,
          },
        ],
      })
      .withPreOptionPhase(async () => {
        // Determine roll first, then play the animation (red chest on a trap)
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        const roll = randSeedInt(RAND_LENGTH);
        encounter.misc = {
          roll,
        };
        playDarkChestAnimation(roll < DARK_CHEST_TRAP_PERCENT);
      })
      .withOptionPhase(async () => {
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        if (encounter.misc.roll >= DARK_CHEST_TRAP_PERCENT) {
          // Treasure (60%): one of a Master and two Rogue items
          setDarkChestRewards(DARK_CHEST_TREASURE_TIERS, false);
          await showEncounterText(`${namespace}:option.1.treasure`);
          leaveEncounterWithoutBattle();
          return;
        }

        // Trap (40%). Local fork (2026-11-12), the user: "선봉 포켓몬이 hp를 50%를 깎이고, 올랭크 -1인채 전투하는걸로
        // 하죠, 즉사보단.": nobody faints (so no game over check); the lead loses half its HP now and its stats drop as
        // it comes out against Gholdengo
        const lead = getDarkChestTrapLead();
        applyDarkChestTrapPenalty(encounter, lead);

        encounter.setDialogueToken("trapPokemon", lead.getNameToRender());
        await showEncounterText(`${namespace}:option.1.trap`);

        await transitionMysteryEncounterIntroVisuals(true, true, 500);
        setDarkChestRewards(DARK_CHEST_TRAP_WIN_TIERS, true);
        await initBattleWithEnemyConfig(encounter.enemyPartyConfigs[0]);
      })
      .build(),
  )
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
      .withSceneMoneyRequirement(0, DARK_CHEST_COIN_PRICE_MULTIPLIER)
      .withDialogue({
        buttonLabel: `${namespace}:option.2.label`,
        buttonTooltip: `${namespace}:option.2.tooltip`,
        disabledButtonTooltip: `${namespace}:option.2.disabledTooltip`,
      })
      .withOptionPhase(async () => {
        const cost = getDarkChestCoinPrice();
        updatePlayerMoney(-cost, true, false);
        await showEncounterText(i18next.t("mysteryEncounterMessages:paidMoney", { amount: cost }));

        // No trap: the chest opens as it is
        playDarkChestAnimation(false);
        setDarkChestRewards(DARK_CHEST_COIN_TIERS, false);
        await showEncounterText(`${namespace}:option.2.coins`);
        leaveEncounterWithoutBattle();
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
        // One Relic Gold found on the way out (its money, Amulet Coins included), then on with the run: no shop and
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
