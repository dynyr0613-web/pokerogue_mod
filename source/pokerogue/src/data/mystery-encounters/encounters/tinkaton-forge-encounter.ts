import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { modifierTypes } from "#data/data-lists";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { FORGED_STEEL, ForgedSteelModifier } from "#modifiers/custom-held-items";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import type { ModifierTypeOption, PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { getPlayerModifierTypeOptions, regenerateModifierPoolThresholds } from "#modifiers/modifier-type";
import { getEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  generateModifierType,
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  selectPokemonForOption,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { EncounterSceneRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { groupStatChange } from "#utils/stat-change";

// Local fork (2026-11-08): the whole file is new (Tinkaton's Forge, see TinkatonForgeEncounter below)

/** the i18n namespace for the encounter */
const namespace = "mysteryEncounters/tinkatonForge";

/**
 * Option 1's reward screen, in order: one random Rogue-tier item and three random Ultra-tier items, all different
 * (the user: "무작위 로그볼 1개 + 하이퍼볼 3개 가 보상 테이블에 확정적으로 나옴").
 */
export const TINKATON_FORGE_REWARD_TIERS: readonly ModifierTier[] = [
  ModifierTier.ROGUE,
  ModifierTier.ULTRA,
  ModifierTier.ULTRA,
  ModifierTier.ULTRA,
];
/** Rolls per reward slot before that slot is given up (a tier with fewer different items than slots) */
const TINKATON_FORGE_MAX_ROLLS_PER_SLOT = 40;

/** Option 3: Tinkaton's moves (all implemented; none of them takes items away) */
export const TINKATON_FORGE_SPAR_MOVES: readonly MoveId[] = [
  MoveId.GIGATON_HAMMER,
  MoveId.PLAY_ROUGH,
  MoveId.BRICK_BREAK,
  MoveId.THUNDER_WAVE,
];
/** Option 3: the spar's EXP is this many times what the Tinkaton would normally give (the user: "3배") */
export const TINKATON_FORGE_SPAR_EXP_MULTIPLIER = 3;

/**
 * One reward per entry of {@linkcode TINKATON_FORGE_REWARD_TIERS}, rolled one at a time like the Super GTS's
 * (`rollSuperGtsRewards`), so no two of the four share a name: a plain `guaranteedModifierTiers` screen can show the
 * same item twice, since its duplicate check treats every item without a group as one group. A slot that can't find
 * a new item in {@linkcode TINKATON_FORGE_MAX_ROLLS_PER_SLOT} rolls is left out.
 */
export function rollTinkatonForgeRewards(): ModifierTypeOption[] {
  const party = globalScene.getPlayerParty();
  regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0);
  const offers: ModifierTypeOption[] = [];
  for (const tier of TINKATON_FORGE_REWARD_TIERS) {
    for (let roll = 0; roll < TINKATON_FORGE_MAX_ROLLS_PER_SLOT; roll++) {
      const [offer] = getPlayerModifierTypeOptions(1, party, [], {
        guaranteedModifierTiers: [tier],
        allowLuckUpgrades: false,
      });
      if (offer && !offers.some(o => o.type.name === offer.type.name)) {
        offers.push(offer);
        break;
      }
    }
  }
  return offers;
}

/** Local fork (2026-11-12): the pieces of Forged Steel `pokemon` holds (0 to {@linkcode FORGED_STEEL.maxHeld}) */
export function getForgedSteelCount(pokemon: Pokemon): number {
  const steel = pokemon.getHeldItems().find(m => m instanceof ForgedSteelModifier);
  return steel?.getStackCount() ?? 0;
}

/** Whether `pokemon` holds at least one piece of Forged Steel */
export function isForgedPokemon(pokemon: Pokemon): boolean {
  return getForgedSteelCount(pokemon) > 0;
}

/** Local fork (2026-11-12): whether `pokemon` already holds the most Forged Steel it can */
export function isFullyForgedPokemon(pokemon: Pokemon): boolean {
  return getForgedSteelCount(pokemon) >= FORGED_STEEL.maxHeld;
}

/**
 * Local fork (2026-11-13): whether `pokemon` is a Steel type for the forge (10 명세 3번: "강철 타입
 * (`PokemonType.STEEL`)을 가진 포켓몬(합체 포켓몬은 합체 후 현재 타입 기준, 기절 여부 무관)"). Its own types: a fusion's
 * types (the head's first type and the type the tail adds) and types changed for good by other encounters count; a
 * Tera type, Soak, Transform, Forest's Curse and the like don't. Fainted or not doesn't matter.
 * Local fork (2026-11-18): no longer who can be forged (any type can again) but who gets
 * {@linkcode FORGED_STEEL.stacksPerForge} (two) pieces a forge instead of {@linkcode FORGED_STEEL.stacksPerForgeNonSteel}
 * (one), the user: "강철은 두개, 강철 아닌놈들은 하나".
 */
export function isForgeEligibleSteelPokemon(pokemon: Pokemon): boolean {
  return pokemon
    .getTypes({ includeTeraType: false, bypassSummonData: true, ignoreThirdType: true })
    .includes(PokemonType.STEEL);
}

/**
 * Local fork (2026-11-18): the pieces one forge gives `pokemon` before the cap: two for a Steel type
 * ({@linkcode isForgeEligibleSteelPokemon}), one for any other type (the user: "강철은 두개, 강철 아닌놈들은 하나")
 */
export function getForgeStacksPerVisit(pokemon: Pokemon): number {
  return isForgeEligibleSteelPokemon(pokemon) ? FORGED_STEEL.stacksPerForge : FORGED_STEEL.stacksPerForgeNonSteel;
}

/**
 * Local fork (2026-11-18): the pieces forging `pokemon` now would add: {@linkcode getForgeStacksPerVisit}, cut to what
 * still fits under {@linkcode FORGED_STEEL.maxHeld} (a Steel type holding nine gets one), 0 when it is full
 */
export function getForgeStacksToAdd(pokemon: Pokemon): number {
  return Math.max(0, Math.min(getForgeStacksPerVisit(pokemon), FORGED_STEEL.maxHeld - getForgedSteelCount(pokemon)));
}

/**
 * Whether Tinkaton can forge `pokemon`. Local fork (2026-11-18): any type with fewer than
 * {@linkcode FORGED_STEEL.maxHeld} pieces (10 결과 8장 5번, the user: "단조강철을 받는 이벤트에서 강철은 두개, 강철
 * 아닌놈들은 하나이게 하자고 했던 것 같네요"); the type only sets how many it gets ({@linkcode getForgeStacksPerVisit}).
 * From 2026-11-13 until this day a Steel type only (10 명세 3번: "강철 타입 포켓몬만 단조할 수 있게 되돌리는 대신 1회당
 * `2개`씩 지급"); from 2026-11-12 any type, one piece a forge (the user: "저희 단조강철의 개수 제한을 5개로 풀고,
 * 강철타입이 아니어도 쓸 수 있게 하는것도 좋을 것 같네요"); before that a Steel type without a piece. A non-Steel
 * Pokémon forged in the any-type days kept its pieces through the Steel-only days and can now take more.
 */
export function canForgePokemon(pokemon: Pokemon): boolean {
  return !isFullyForgedPokemon(pokemon);
}

/**
 * Option 2's condition: a party member Tinkaton can still forge. It was the user's "파티 내에 강철 타입 하나 이상"
 * (plus not forged yet) until 2026-11-12, then any party member with fewer than {@linkcode FORGED_STEEL.maxHeld}
 * pieces (five until the 09 patch, ten since). Local fork (2026-11-13): a Steel type with fewer than ten again (10 명세
 * 3번: "파티에 조건을 만족하는 강철 타입 포켓몬이 한 마리도 없으면 2번 선택지는 비활성화된다"). Local fork
 * (2026-11-18): any party member with fewer than ten again, whatever its type ("강철 아닌놈들은 하나"); the option is
 * off only when every party member holds ten.
 */
export class ForgeablePokemonRequirement extends EncounterSceneRequirement {
  override meetsRequirement(): boolean {
    return globalScene.getPlayerParty().some(p => canForgePokemon(p));
  }

  override getDialogueToken(): [string, string] {
    const forgeable = globalScene.getPlayerParty().find(p => canForgePokemon(p));
    return ["forgeablePokemon", forgeable?.getNameToRender() ?? ""];
  }
}

/**
 * Forges `pokemon`. Local fork (2026-11-13): 10 명세 3번, gives it {@linkcode FORGED_STEEL.stacksPerForge} (two) more
 * pieces of Forged Steel, or what still fits under {@linkcode FORGED_STEEL.maxHeld} ("`Math.min(FORGED_STEEL.
 * stacksPerForge, FORGED_STEEL.maxHeld - currentStacks)`": nine held get one), and returns how many it added; 0 when it
 * can't be forged ({@linkcode canForgePokemon}: full). The pieces go in as one modifier added once,
 * so its stats are recalculated once and its HP rises by the max HP it gained, as with one piece before.
 * Local fork (2026-11-18): any type again; a Steel type gets two, any other type one ({@linkcode getForgeStacksToAdd},
 * the user: "강철은 두개, 강철 아닌놈들은 하나"). Until this day a non-Steel Pokémon got nothing (0).
 * Local fork (2026-11-08), review fix: a Pokémon that can't take the pieces gets nothing: `addModifier` would hand out
 * its stack-full fallback (5 Poké Balls and a "stack full" message), and its return value is `false` for any added
 * held item, so it can't be passed on as the result. Local fork (2026-11-12): new pieces join the ones held (one
 * modifier, its stack count up), up to {@linkcode FORGED_STEEL.maxHeld} (ten since the 09 patch); one piece a forge
 * until 2026-11-13, when this returned whether it was forged.
 */
export function forgePokemon(pokemon: PlayerPokemon): number {
  if (!canForgePokemon(pokemon)) {
    return 0;
  }
  const before = getForgedSteelCount(pokemon);
  const toAdd = getForgeStacksToAdd(pokemon); // Local fork (2026-11-18): two for a Steel type, one for the others
  if (toAdd <= 0) {
    return 0;
  }
  const type = generateModifierType(modifierTypes.FORGED_STEEL) as PokemonHeldItemModifierType;
  const modifier = type.newModifier(pokemon) as PokemonHeldItemModifier;
  // all the pieces in one stack: it fits (before + toAdd <= maxHeld), so the stack-full fallback can't trigger
  modifier.stackCount = toAdd;
  globalScene.addModifier(modifier, false, false, false, true);
  return getForgedSteelCount(pokemon) - before;
}

/**
 * Local fork (2026-11-08): Tinkaton's Forge (두드리짱의 대장간, TINKATON_FORGE), the user's design: a Tinkaton
 * pounding away at an anvil.
 * 1. Ask it to forge some gear: a reward screen of one Rogue-tier and three Ultra-tier items, all different, pick one.
 * 2. Forge the steel (needs a party member with fewer than ten pieces): the chosen Pokémon gets two more pieces of
 *    Forged Steel if it is a Steel type (one if it holds nine), one if not, +10% HP/Def/SpDef base stats per piece for
 *    good (x1.1 to x2.0).
 *    No reward screen. Local fork (2026-11-12): any type, up to five pieces; until then a Steel type only, one piece.
 *    Local fork (2026-11-13): up to ten pieces since the 3rd balance patch (09 명세 3-2: "단조강철 10개 미만인
 *    파티원"); since the 4th (10 명세 3번) a Steel type only again, two pieces a forge (0 -> 2 -> ... -> 10).
 *    Local fork (2026-11-18): any party member with fewer than ten pieces again; a Steel type gets two a forge, any
 *    other type one (the user: "강철은 두개, 강철 아닌놈들은 하나"). Only a full Pokémon is turned away.
 * 3. A friendly spar: a wild, uncatchable Tinkaton at this wave's level with +1 Attack; it gives 3x its EXP.
 * ULTRA tier, in the mountain, cave, volcano, factory and construction site.
 */
export const TinkatonForgeEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.TINKATON_FORGE,
)
  .withEncounterTier(MysteryEncounterTier.ULTRA)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  // Tinkaton stays on screen while it hammers (options 1 and 2); option 3 slides it out before the battle
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    {
      // an anvil with Tinkaton beside it, one baked frame (made by the sprite session)
      spriteKey: "tinkaton_forge",
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
    // Option 3's Tinkaton: no level given, so it gets this wave's normal wild level
    const config: EnemyPartyConfig = {
      pokemonConfigs: [
        {
          species: speciesDataRegistry.getSpecies(SpeciesId.TINKATON),
          isBoss: false,
          // Mold Breaker: never its hidden Pickpocket, which would take a held item for good in a friendly spar
          abilityIndex: 0,
          moveSet: [...TINKATON_FORGE_SPAR_MOVES],
          tags: [BattlerTagType.MYSTERY_ENCOUNTER_POST_SUMMON],
          mysteryEncounterBattleEffects: (pokemon: Pokemon) => {
            // the user: "공 1랭업"
            globalScene.phaseManager.unshiftNew("StatStageChangePhase", {
              battlerIndex: pokemon.getBattlerIndex(),
              changes: groupStatChange([Stat.ATK], 1),
              sourcePokemon: pokemon,
            });
          },
        },
      ],
    };
    encounter.enemyPartyConfigs = [config];
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
        // pick one of the four, no extra slots; a reroll would only show the same four again for money
        setEncounterRewards({
          guaranteedModifierTypeOptions: rollTinkatonForgeRewards(),
          fillRemaining: false,
          rerollMultiplier: -1,
        });
        leaveEncounterWithoutBattle();
      })
      .build(),
  )
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
      .withSceneRequirement(new ForgeablePokemonRequirement())
      .withDialogue({
        buttonLabel: `${namespace}:option.2.label`,
        buttonTooltip: `${namespace}:option.2.tooltip`,
        disabledButtonTooltip: `${namespace}:option.2.disabledTooltip`,
        selected: [
          {
            text: `${namespace}:option.2.selected`,
          },
        ],
      })
      .withPreOptionPhase(async (): Promise<boolean> => {
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        const onPokemonSelected = (pokemon: PlayerPokemon) => {
          encounter.setDialogueToken("forgedPokemon", pokemon.getNameToRender());
          // Local fork (2026-11-18): the selected text says how many pieces it gets (2 for a Steel type, 1 for the
          // others, 1 for a Steel type holding nine); set here, as the text is shown before the option phase forges
          encounter.setDialogueToken("forgedCount", String(getForgeStacksToAdd(pokemon)));
          encounter.misc = { forgedPokemon: pokemon };
        };
        // a Pokémon that can't be forged stays on the party screen with the reason. Local fork (2026-11-12): any
        // type could be picked; only one already holding FORGED_STEEL.maxHeld pieces (ten since the 09 patch) was
        // turned away. Local fork (2026-11-13): 10 명세 3번, a non-Steel one is turned away first (notSteel, even
        // if it holds pieces from the any-type days), then a full Steel one (fullyForged). Local fork (2026-11-18):
        // any type again ("강철 아닌놈들은 하나"), so only a full one is turned away; the notSteel text is gone
        const selectableFilter = (pokemon: PlayerPokemon): string | null => {
          if (!canForgePokemon(pokemon)) {
            return getEncounterText(`${namespace}:option.2.fullyForged`) ?? null;
          }
          return null;
        };
        const selection = selectPokemonForOption(onPokemonSelected, undefined, selectableFilter);
        // The party screen opens at once from the encounter screen: its message box asks for the Pokémon to forge
        if (globalScene.ui.mode === UiMode.PARTY) {
          globalScene.ui.showText(getEncounterText(`${namespace}:option.2.prompt`) ?? "", 0);
        }
        return selection;
      })
      .withOptionPhase(async () => {
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        forgePokemon(encounter.misc.forgedPokemon);
        // the user: no battle, no reward screen and no shop
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
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        // The spar's only foe is the Tinkaton, so the encounter's EXP multiplier (applied by
        // BattleScene.applyPartyExp to EXP earned in an encounter battle) triples exactly its EXP. A reload restarts
        // the encounter from its options (sessions are saved at the start of a wave), and picking this sets it again.
        encounter.expMultiplier = TINKATON_FORGE_SPAR_EXP_MULTIPLIER;
        await transitionMysteryEncounterIntroVisuals(true, true, 500);
        await initBattleWithEnemyConfig(encounter.enemyPartyConfigs[0]);
      })
      .build(),
  )
  .build();
