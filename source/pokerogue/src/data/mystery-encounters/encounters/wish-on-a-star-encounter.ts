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
import { commonAnims } from "#data/battle-anims";
import { allAbilities, allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ModifierTier } from "#enums/modifier-tier";
import { AnimFrameTarget, CommonAnim } from "#enums/move-anims-common";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { PERMANENT_STATS, type PermanentStat, Stat } from "#enums/stat";
import { UiMode } from "#enums/ui-mode";
import type { MysteryEncounterIntroVisuals } from "#field/mystery-encounter-intro";
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
import { getFrameMs, randSeedShuffle } from "#utils/common";
import { groupStatChange } from "#utils/stat-change";
import i18next from "i18next";
import type Phaser from "phaser";

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

/*
 * Local fork (2026-11-20): the intro's sleeping and awake looks. The user: "조우 화면에서 지라치 자는 스프라이트 있으면
 * 그거 넣어두고, 깨우면 깬 모습이 보이게 바꿔두고". No sleeping Jirachi sprite existed in the art the fork may use
 * (searched 11-20: the fork's assets, upstream pokerogue-assets, Essentials, PokéSprite, PKHeX, CFRU, Cobblemon), so the
 * user drew one ("지라치 스프라이트를 이 세션에 올리면 제가 수정해올게요"): PokéRogue's Jirachi frame "0005.png" with its eyes
 * closed, 54x47 like every source frame of Jirachi's atlas. Asleep, the intro shows that sprite with the "z" letters of
 * the sleep status animation (CommonAnim.SLEEP on "PRAS- Status", the same frames and offsets a sleeping Pokémon gets in
 * battle) rising over it in a loop. Awake, the Pokémon sprite shows instead, its idle animation plays and the letters
 * stop. Its brightness stays: the intro text finds it shining.
 *
 * The sleeping sprite is a second intro sprite (`WISH_ON_A_STAR_SLEEP_SPRITE_KEY`), shown in turn with the Pokémon one,
 * rather than a texture swapped onto the Pokémon sprite: the intro loads it with its own assets (`loadAtlas` from
 * `mystery-encounters`, before the field slides in), places it by the same code with the same scale and offsets, and
 * `initSprite` resets nothing of it. Phaser sizes a sprite by its frame's source size and draws a trimmed frame at its
 * trim offset, so both share one 54x47 box with the same origin (bottom middle): the sleeping Jirachi stands pixel for
 * pixel where the Pokémon sprite does.
 * Review (2026-11-20): its atlas frame is trimmed exactly as Jirachi's "0005.png" (54x42 from y 5 of the 54x47 box; the
 * rows above are empty in both), not the whole image: the shadow (render-nodes/sprite.ts) is as wide as the frame's
 * width minus half of (source height - frame height), so an untrimmed frame drew it 54 wide asleep and 51.5 awake.
 */

/** The intro sprite of the sleeping Jirachi (the user's drawing): `assets/images/mystery-encounters/<key>.png / .json` */
export const WISH_ON_A_STAR_SLEEP_SPRITE_KEY = "wish_on_a_star_jirachi_sleep";
/** The scale of both intro sprites (the Pokémon one and the sleeping one) */
const WISH_ON_A_STAR_INTRO_SCALE = 1.25;
/** The y offset of both intro sprites */
const WISH_ON_A_STAR_INTRO_Y = -4;
/**
 * Where Jirachi's idle animation starts as it wakes: the index of "0005.png", the frame the sleeping sprite was drawn on,
 * among the animation's frames ("0001.png" … "0128.png" in order, as the intro makes them), so waking only opens its
 * eyes (from its first frame, about a pixel lower, the body dropped as it woke)
 */
export const WISH_ON_A_STAR_WAKE_START_FRAME = 4;

/** Empty steps after each play of the sleep animation's letters, so they rise in calm puffs (a step is 3 frames) */
export const WISH_ON_A_STAR_SLEEP_REST_STEPS = 10;

/**
 * Review (2026-11-20): field pixels from the top of the screen to the middle of the highest letter. The intro stands
 * higher than a battler (y 76, feet at 72) and draws Jirachi 1.25x, so from its middle the animation's highest big Z
 * (40 up, its glyph 5 above its own middle) went past the top of the screen (its top at y -2.4); 6 keeps a pixel clear.
 */
export const WISH_ON_A_STAR_SLEEP_TOP_ROOM = 6;

/** One letter of a sleep step: offset from the middle of the Jirachi sprite, frame of the graphic, opacity */
export interface WishOnAStarSleepLetter {
  readonly x: number;
  readonly y: number;
  readonly frame: number;
  readonly alpha: number;
}

/**
 * Where the letters' middle goes inside the intro (y): the middle of the Jirachi sprite as in battle, lowered only as
 * far as needed for the highest letter of `steps` to stay on the screen with the intro at `visualsY`.
 */
export function getWishOnAStarSleepLettersY(
  spriteMiddleY: number,
  visualsY: number,
  steps: readonly (readonly WishOnAStarSleepLetter[])[],
): number {
  const highest = Math.min(0, ...steps.flat().map(letter => letter.y));
  return Math.max(spriteMiddleY, WISH_ON_A_STAR_SLEEP_TOP_ROOM - highest - visualsY);
}

/** The letters over one intro, kept to stop them when Jirachi wakes and to restart them if it sleeps again */
export interface WishOnAStarSleepEffect {
  readonly letters: Phaser.GameObjects.Container;
  readonly sprites: readonly Phaser.GameObjects.Sprite[];
  counter: Phaser.Tweens.Tween | undefined;
}

const sleepEffects = new WeakMap<MysteryEncounterIntroVisuals, WishOnAStarSleepEffect>();

/**
 * The steps of the letters over the sleeping Jirachi: each frame of the sleep status animation (its graphic's visible
 * letters, placed from the Pokémon's middle as in battle), then {@linkcode WISH_ON_A_STAR_SLEEP_REST_STEPS} empty
 * ones. Empty while the animation is not loaded.
 */
export function getWishOnAStarSleepSteps(): WishOnAStarSleepLetter[][] {
  const anim = commonAnims.get(CommonAnim.SLEEP);
  if (!anim?.graphic || anim.frames.length === 0) {
    return [];
  }
  const steps = anim.frames.map(frame =>
    frame
      .filter(f => f.target === AnimFrameTarget.GRAPHIC && f.visible)
      .map(f => ({ x: f.x, y: f.y, frame: f.graphicFrame, alpha: f.opacity / 255 })),
  );
  return [...steps, ...Array.from({ length: WISH_ON_A_STAR_SLEEP_REST_STEPS }, () => [])];
}

/** The letters shown over `visuals`, once they have started */
export function getWishOnAStarSleepEffect(visuals: MysteryEncounterIntroVisuals): WishOnAStarSleepEffect | undefined {
  return sleepEffects.get(visuals);
}

/** Whether `visuals` show Jirachi asleep: held still, its animation disabled */
export function isWishOnAStarIntroAsleep(visuals: MysteryEncounterIntroVisuals): boolean {
  return visuals.spriteConfigs[0]?.disableAnimation === true;
}

/**
 * Shows the Pokémon sprite of `visuals` (`awake`) or the sleeping one in its place, hiding the other with its tint
 * sprite (only one Jirachi, one shadow). Without the sleeping sprite the Pokémon one always shows.
 */
function showWishOnAStarIntroLook(visuals: MysteryEncounterIntroVisuals, awake: boolean): void {
  const sleepIndex = visuals.spriteConfigs.findIndex(c => c.spriteKey === WISH_ON_A_STAR_SLEEP_SPRITE_KEY);
  const [jirachi, jirachiTint] = visuals.getSpriteAtIndex(0);
  jirachi.setVisible(awake || sleepIndex < 0);
  if (sleepIndex < 0) {
    return;
  }
  const [sleeping, sleepingTint] = visuals.getSpriteAtIndex(sleepIndex);
  sleeping.setVisible(!awake);
  (awake ? sleepingTint : jirachiTint).setVisible(false);
}

/** Shows the letters of one step and hides the sprites it doesn't use */
function showSleepStep(effect: WishOnAStarSleepEffect, step: readonly WishOnAStarSleepLetter[]): void {
  effect.sprites.forEach((sprite, i) => {
    const letter = step[i];
    if (letter) {
      sprite.setFrame(letter.frame).setPosition(letter.x, letter.y).setAlpha(letter.alpha).setVisible(true);
    } else {
      sprite.setVisible(false);
    }
  });
}

/** Stops the letters over `visuals` and hides them */
function stopSleepEffect(visuals: MysteryEncounterIntroVisuals): void {
  const effect = sleepEffects.get(visuals);
  if (!effect) {
    return;
  }
  effect.counter?.remove();
  effect.counter = undefined;
  effect.letters.setVisible(false);
}

/**
 * Starts the letters over the sleeping Jirachi of `visuals`, looping by a counter tween as the battle animations
 * step (3 frames a step); nothing while the animation or its graphic is not loaded. They stop with the intro.
 */
function startSleepEffect(visuals: MysteryEncounterIntroVisuals): void {
  const anim = commonAnims.get(CommonAnim.SLEEP);
  const steps = getWishOnAStarSleepSteps();
  if (!anim || steps.length === 0 || !globalScene.textures.exists(anim.graphic)) {
    return;
  }
  let effect = sleepEffects.get(visuals);
  if (effect) {
    stopSleepEffect(visuals);
  } else {
    // in front of Jirachi, from the middle of its sprite (origin at its feet; the sleeping sprite shares its box), kept
    // below the top of the screen
    const [jirachi] = visuals.getSpriteAtIndex(0);
    const middle = jirachi.y - (jirachi.displayHeight || 0) / 2;
    const letters = globalScene.add.container(jirachi.x, getWishOnAStarSleepLettersY(middle, visuals.y, steps));
    const sprites = Array.from({ length: Math.max(...steps.map(s => s.length)) }, () =>
      globalScene.addFieldSprite(0, 0, anim.graphic, 0).setVisible(false),
    );
    letters.add(sprites);
    visuals.add(letters);
    effect = { letters, sprites, counter: undefined };
    sleepEffects.set(visuals, effect);
  }
  const running = effect;
  let index = 0;
  running.letters.setVisible(true);
  showSleepStep(running, steps[0]);
  running.counter = globalScene.tweens.addCounter({
    duration: getFrameMs(3),
    repeat: -1,
    onRepeat: () => {
      // destroyed with the intro (option 3 leaves Jirachi asleep)
      if (!running.letters.active) {
        running.counter?.remove();
        running.counter = undefined;
        return;
      }
      index = (index + 1) % steps.length;
      showSleepStep(running, steps[index]);
    },
  });
}

/**
 * Wakes the intro's Jirachi (`awake`: the Pokémon sprite shows in place of the sleeping one, its idle animation plays,
 * the letters stop) or puts it back to sleep (the Pokémon sprite stopped on its first frame and hidden, the sleeping
 * sprite and the letters again). Option 1 wakes it as the wish menu opens (its cancel puts it back to sleep), option 2
 * as it is picked; option 3 leaves it asleep. Nothing without the intro or when it is already so.
 */
export function setWishOnAStarIntroAwake(awake: boolean): void {
  const visuals = globalScene.currentBattle.mysteryEncounter?.introVisuals;
  if (!visuals || isWishOnAStarIntroAsleep(visuals) === !awake) {
    return;
  }
  visuals.spriteConfigs[0].disableAnimation = !awake;
  if (awake) {
    stopSleepEffect(visuals);
    showWishOnAStarIntroLook(visuals, true);
    visuals.playAnim();
  } else {
    for (const sprite of visuals.getSpriteAtIndex(0)) {
      sprite.anims.stop();
    }
    visuals.initSprite();
    showWishOnAStarIntroLook(visuals, false);
    startSleepEffect(visuals);
  }
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
          // Local fork (2026-11-20): back to the options, so asleep again (option 3 leaves it sleeping)
          setWishOnAStarIntroAwake(false);
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
          // Local fork (2026-11-20): the song wakes it ("깨우면 깬 모습이 보이게"): it moves from the wake-up text on
          setWishOnAStarIntroAwake(true);
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
 * The intro shows it asleep (the user's sleeping sprite, the sleep letters over it) and awake after options 1 and 2
 * (the Pokémon sprite, moving).
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
      // the existing Jirachi art, hidden while it sleeps (the sleeping sprite below stands in, with the sleep letters,
      // `startSleepEffect`); shown with its idle animation looping once it wakes (`setWishOnAStarIntroAwake`)
      species: SpeciesId.JIRACHI,
      spriteKey: "",
      fileRoot: "",
      hasShadow: true,
      disableAnimation: true,
      repeat: true,
      startFrame: WISH_ON_A_STAR_WAKE_START_FRAME,
      hidden: true,
      scale: WISH_ON_A_STAR_INTRO_SCALE,
      y: WISH_ON_A_STAR_INTRO_Y,
    },
    {
      // Local fork (2026-11-20): the user's sleeping Jirachi, one frame with the same 54x47 box and trim as Jirachi's
      // "0005.png", with the same scale and offset (no x: both sit at the intro's x 0), so it and its shadow stand
      // exactly where the Pokémon sprite's do; shown while asleep
      spriteKey: WISH_ON_A_STAR_SLEEP_SPRITE_KEY,
      fileRoot: "mystery-encounters",
      hasShadow: true,
      disableAnimation: true,
      scale: WISH_ON_A_STAR_INTRO_SCALE,
      y: WISH_ON_A_STAR_INTRO_Y,
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
  .withOnVisualsStart(() => {
    // Local fork (2026-11-20): asleep once the field has slid in (the intro isn't shiny: no sparkles to keep)
    const visuals = globalScene.currentBattle.mysteryEncounter?.introVisuals;
    if (visuals && isWishOnAStarIntroAsleep(visuals)) {
      startSleepEffect(visuals);
    }
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
      .withPreOptionPhase(async () => {
        // Local fork (2026-11-20): shaken awake as it is picked, so it moves through the option's text before the
        // intro hides and the battle starts
        setWishOnAStarIntroAwake(true);
        return true;
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
