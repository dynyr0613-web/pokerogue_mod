/**
 * Local fork (2026-11-19): "고철 속 보물" (Treasure in the Scrap, SCRAP_TREASURE), item D7 of docs/1.2.0_후보_20261119.md,
 * built from docs/미스터리조우_아이디어_20261108.md section 4 (the user: "d7 실행 / 싸워 이기면 파티원이 사용 가능한 변화
 * 아이템이 나오도록, 고철을 뒤지는 선택지도 나오도록"). A ROGUE-tier take on the official Trash to Treasure
 * (trash-to-treasure-encounter.ts, whose silhouette intro and G-Max boss set-up it copies) with a G-Max Melmetal.
 */
import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { modifierTypes } from "#data/data-lists";
import { BattlerIndex } from "#enums/battler-index";
import { FormChangeItem } from "#enums/form-change-item";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import type { MysteryEncounterSpriteConfig } from "#field/mystery-encounter-intro";
import type { PlayerPokemon } from "#field/pokemon";
import { MegaEvolutionAccessModifier, PokemonFormChangeItemModifier } from "#modifiers/modifier";
import type { CustomModifierSettings, ModifierTypeOption } from "#modifiers/modifier-type";
import { PokemonMove } from "#moves/pokemon-move";
import {
  type DarkGtsReward,
  giveDarkGtsReward,
  pickDarkGtsReward,
} from "#mystery-encounters/dark-global-trade-system-encounter";
import { getDarkChestRewardCount, rollDarkChestRewards } from "#mystery-encounters/dark-mysterious-chest-encounter";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig, EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  generateModifierTypeOption,
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  loadCustomMovesForEncounter,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import { getHighestLevelPlayerPokemon } from "#mystery-encounters/encounter-pokemon-utils";
import type { EncounterStartOfBattleEffect, MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { randSeedInt } from "#utils/common";

/** the i18n namespace for the encounter */
const namespace = "mysteryEncounters/scrapTreasure";

/** The official Trash to Treasure's wait between its dig sounds */
const SOUND_EFFECT_WAIT_TIME = 700;

/** Option 1: the G-Max Melmetal's moves (all implemented), as the idea doc lists them */
export const SCRAP_TREASURE_BOSS_MOVES: readonly MoveId[] = [
  MoveId.DOUBLE_IRON_BASH,
  MoveId.HEAVY_SLAM,
  MoveId.THUNDER_PUNCH,
  MoveId.ACID_ARMOR,
];
/** Option 1: what the Melmetal uses before turn 1: Acid Armor on itself, then Metal Sound on the player's side */
export const SCRAP_TREASURE_OPENING_MOVES: readonly MoveId[] = [MoveId.ACID_ARMOR, MoveId.METAL_SOUND];
/**
 * Option 1, won: after the form-change item (or, when nobody can use one, a Rogue item in its place), one item of each
 * of these tiers, then ordinary rewards up to an ordinary screen's size; all different (the idea doc: "로그·울트라 +
 * 채움")
 */
export const SCRAP_TREASURE_WIN_TIERS: readonly ModifierTier[] = [ModifierTier.ROGUE, ModifierTier.ULTRA];

/** Option 2: the chance in 100 that the dig finds a vest; otherwise the scrap collapses (the idea doc: 60% / 40%) */
export const SCRAP_TREASURE_DIG_FIND_CHANCE = 60;
/** Option 2: the vests the dig can find (돌격조끼 / 방탄조끼), one, picked among those somebody can still hold */
export const SCRAP_TREASURE_DIG_REWARDS: readonly DarkGtsReward[] = [
  { id: "ASSAULT_VEST", count: 1 },
  { id: "BULLETPROOF_VEST", count: 1 },
];

/** Option 2's roll (0 to 99, seeded); an object so tests can force it, as `enemyDynamaxDice` */
export const scrapTreasureDice = {
  rollDig: (): number => randSeedInt(100),
};

/**
 * The intro: the existing 809-gigantamax art as a dark silhouette of a scrap heap, the way the official Trash to
 * Treasure shows its Garbodor (tint 0.4, scale 1.5)
 */
function getScrapTreasureSpriteConfigs(): MysteryEncounterSpriteConfig[] {
  return [
    {
      spriteKey: SpeciesId.MELMETAL.toString() + "-gigantamax",
      fileRoot: "pokemon",
      hasShadow: false,
      disableAnimation: true,
      scale: 1.5,
      y: 8,
      tint: 0.4,
    },
  ];
}

/**
 * Option 1's boss: G-Max Melmetal (form 1), shiny locked for the silhouette, one boss segment more than usual; the
 * official Trash to Treasure's level bonus and no switching. Its held items are the ordinary random ones.
 */
function getScrapTreasureBossConfig(): EnemyPartyConfig {
  const pokemonConfig: EnemyPokemonConfig = {
    species: speciesDataRegistry.getSpecies(SpeciesId.MELMETAL),
    isBoss: true,
    shiny: false, // Shiny lock because of the custom intro sprite
    formIndex: 1, // G-Max
    bossSegmentModifier: 1, // +1 segment from normal
    moveSet: [...SCRAP_TREASURE_BOSS_MOVES],
  };
  return {
    levelAdditiveModifier: 0.5,
    pokemonConfigs: [pokemonConfig],
    disableSwitch: true,
  };
}

/** Option 1's opening, before turn 1: Acid Armor on the Melmetal, Metal Sound on the player's side */
export function getScrapTreasureOpeningEffects(): EncounterStartOfBattleEffect[] {
  return SCRAP_TREASURE_OPENING_MOVES.map(move => ({
    sourceBattlerIndex: BattlerIndex.ENEMY,
    targets: move === MoveId.METAL_SOUND ? [BattlerIndex.PLAYER] : [BattlerIndex.ENEMY],
    move: new PokemonMove(move),
    useMode: MoveUseMode.IGNORE_PP,
  }));
}

/**
 * Whether a party member could use the Melmetalite right now: the Mega Bracelet, a Melmetal in its base form, and not
 * holding one already. Checked here since naming the item skips the form-change generator's own checks (the idea doc).
 * The fork's content gate does not apply: an encounter's own reward is never gated (fork-unlock.ts).
 */
export function canUseScrapMelmetalite(): boolean {
  if (globalScene.getModifiers(MegaEvolutionAccessModifier).length === 0) {
    return false;
  }
  return globalScene
    .getPlayerParty()
    .some(
      p =>
        p.isFormChangeItemCompatible(FormChangeItem.MELMETALITE)
        && !p
          .getHeldItems()
          .some(m => m instanceof PokemonFormChangeItemModifier && m.formChangeItem === FormChangeItem.MELMETALITE),
    );
}

/**
 * Option 1, won: the guaranteed form-change item, one a party member can use (the user: "파티원이 사용 가능한 변화
 * 아이템"). The Melmetalite when a party member can use it (the idea doc's first pick, {@linkcode canUseScrapMelmetalite});
 * else the reward pools' own generators, which only offer items the party can use (Mega Stones and Primal orbs with the
 * Mega Bracelet, Max Mushrooms with the Dynamax Band, the fork's own Mega Stones once unlocked): first the rare
 * form-change items, then the ordinary ones. `null` when nobody can use any.
 */
export function getScrapTreasureFormChangeReward(): ModifierTypeOption | null {
  if (canUseScrapMelmetalite()) {
    return generateModifierTypeOption(modifierTypes.RARE_FORM_CHANGE_ITEM, [FormChangeItem.MELMETALITE]);
  }
  return (
    generateModifierTypeOption(modifierTypes.RARE_FORM_CHANGE_ITEM)
    ?? generateModifierTypeOption(modifierTypes.FORM_CHANGE_ITEM)
  );
}

/**
 * Option 1's reward screen, rolled when it comes up: the form-change item ({@linkcode getScrapTreasureFormChangeReward};
 * a Rogue item when nobody can use one), one item of each of {@linkcode SCRAP_TREASURE_WIN_TIERS}, then ordinary rewards
 * up to an ordinary screen's size (Golden / Silver Poké Balls included); all different (the Mysterious Chest?'s rolls).
 */
export function rollScrapTreasureRewards(): ModifierTypeOption[] {
  const formChange = getScrapTreasureFormChangeReward();
  const tiers = formChange ? SCRAP_TREASURE_WIN_TIERS : [ModifierTier.ROGUE, ...SCRAP_TREASURE_WIN_TIERS];
  return rollDarkChestRewards(tiers, getDarkChestRewardCount(), formChange ? [formChange] : []);
}

/**
 * Option 2, the collapse: the highest-level party member able to battle faints (ties: the one nearer the front), as
 * the official Mysterious Chest's trap picks it. No message is queued (`koPlayerPokemon` queues one, which leaving the
 * encounter would clear); the collapse text names it instead.
 */
export function collapseScrapOnto(): PlayerPokemon {
  const victim = getHighestLevelPlayerPokemon(true, false);
  victim.hp = 0;
  victim.doSetStatus(StatusEffect.FAINT);
  victim.updateInfo();
  return victim;
}

/** The official Trash to Treasure's dig sounds, without its sludge splash */
function doScrapDig(): void {
  audioManager.playSound("battle_anims/PRSFX- Dig2");
  globalScene.time.delayedCall(SOUND_EFFECT_WAIT_TIME, () => {
    audioManager.playSound("battle_anims/PRSFX- Dig2");
  });
  globalScene.time.delayedCall(SOUND_EFFECT_WAIT_TIME * 2, () => {
    audioManager.playSound("battle_anims/PRSFX- Dig2");
  });
}

/**
 * "고철 속 보물" (SCRAP_TREASURE), local fork (2026-11-19): a huge scrap heap that seems to move.
 * 1. Find out what the heap is: a boss battle against G-Max Melmetal (Double Iron Bash / Heavy Slam / Thunder Punch /
 *    Acid Armor; Acid Armor and Metal Sound before turn 1). Won: a form-change item a party member can use (a Rogue
 *    item when nobody can use one), a Rogue and an Ultra item, then ordinary rewards.
 * 2. Dig through the heap: 60% a random party member with room gets an Assault Vest or a Bulletproof Vest; 40% the
 *    scrap collapses and the highest-level party member faints, nothing gained. Ends with the healing shop.
 * 3. Leave.
 * ROGUE tier, in the Factory, the Construction Site, the Laboratory and the Power Plant; in Endless, waves 809, 1809, ...
 * also become it 81 times in 1000 (special-spawns.ts).
 */
export const ScrapTreasureEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.SCRAP_TREASURE,
)
  .withEncounterTier(MysteryEncounterTier.ROGUE)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  // The official Trash to Treasure's party size; the collapse knocks one out, so two are left. No once-per-run limit:
  // the fork lets every encounter repeat (the idea doc: the vest can be farmed in Endless, hence ROGUE)
  .withScenePartySizeRequirement(3)
  .withFleeAllowed(false)
  .withIntroSpriteConfigs(getScrapTreasureSpriteConfigs())
  .withAutoHideIntroVisuals(false)
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
    encounter.enemyPartyConfigs = [getScrapTreasureBossConfig()];

    // the opening moves (Acid Armor is also in its moveset)
    loadCustomMovesForEncounter([...SCRAP_TREASURE_OPENING_MOVES]);
    globalScene.loadSe("PRSFX- Dig2", "battle_anims", "PRSFX- Dig2.wav");

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
      .withOptionPhase(async () => {
        // The heap stands up: battle the G-Max Melmetal (the official's zoom-out for a G-Max boss)
        globalScene.setFieldScale(0.75);
        await showEncounterText(`${namespace}:option.1.selected2`);
        await transitionMysteryEncounterIntroVisuals();

        const encounter = globalScene.currentBattle.mysteryEncounter!;
        // rolled when the reward screen comes up, with the party as it is after the battle
        const rewards: CustomModifierSettings = { fillRemaining: false };
        setEncounterRewards(rewards, undefined, () => {
          rewards.guaranteedModifierTypeOptions = rollScrapTreasureRewards();
        });
        encounter.startOfBattleEffects.push(...getScrapTreasureOpeningEffects());
        await initBattleWithEnemyConfig(encounter.enemyPartyConfigs[0]);
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
      .withPreOptionPhase(async () => {
        doScrapDig();
      })
      .withOptionPhase(async () => {
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        const found = scrapTreasureDice.rollDig() < SCRAP_TREASURE_DIG_FIND_CHANCE;
        await transitionMysteryEncounterIntroVisuals();
        if (found) {
          // a vest somebody can still hold, for a random one of them; when nobody can, the fork's stack-full stand-in
          const pick = pickDarkGtsReward(SCRAP_TREASURE_DIG_REWARDS, globalScene.getPlayerParty());
          audioManager.playSound("se/item_fanfare");
          await showEncounterText(`${namespace}:option.2.found`);
          await giveDarkGtsReward(pick, `${namespace}:option.2.received`);
        } else {
          const victim = collapseScrapOnto();
          encounter.setDialogueToken("faintedPokemon", victim.getNameToRender());
          await showEncounterText(`${namespace}:option.2.collapse`);
        }
        // the healing shop either way (the idea doc: "회복 상점으로 끝납니다")
        leaveEncounterWithoutBattle(true);
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
