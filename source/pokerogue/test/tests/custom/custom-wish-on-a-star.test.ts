import type { BattleScene } from "#app/battle-scene";
import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { allAbilities, allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { GameModes } from "#enums/game-modes";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { PERMANENT_STATS, type PermanentStat, Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { IvCandyModifier } from "#modifiers/custom-held-items";
import { HealingBoosterModifier, type PokemonHeldItemModifier } from "#modifiers/modifier";
import { PokemonMove } from "#moves/pokemon-move";
import * as EncounterDialogueUtils from "#mystery-encounters/encounter-dialogue-utils";
import * as EncounterPhaseUtils from "#mystery-encounters/encounter-phase-utils";
import { generateModifierType } from "#mystery-encounters/encounter-phase-utils";
import { allMysteryEncounters, mysteryEncountersByBiome } from "#mystery-encounters/mystery-encounter-biomes";
import { WaveRangeRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import {
  canTakeWishOnAStarCandy,
  getWishOnAStarCandiesHeld,
  getWishOnAStarCandyRoom,
  getWishOnAStarCandyStep,
  getWishOnAStarWakeSound,
  getWishOnAStarWealthMoney,
  getWishOnAStarWishMoveHolder,
  rollWishOnAStarCandies,
  WISH_ON_A_STAR_ANGRY_STATS,
  WISH_ON_A_STAR_BOSS_MOVES,
  WISH_ON_A_STAR_POWER_BONUS_STATS,
  WISH_ON_A_STAR_POWER_STATS,
  WISH_ON_A_STAR_SONG_MOVES,
  WISH_ON_A_STAR_SOUND_MOVES,
  WISH_ON_A_STAR_WAKE_ABILITIES,
  WISH_ON_A_STAR_WAKE_MOVES,
  WISH_ON_A_STAR_WAKE_UP_MOVES,
  WISH_ON_A_STAR_WEALTH_BONUS_MULTIPLIER,
  WISH_ON_A_STAR_WEALTH_MULTIPLIER,
  WISH_ON_A_STAR_WIN_TIERS,
  WISH_ON_A_STAR_WISH_MOVES,
  WishOnAStarEncounter,
  WishOnAStarWakeRequirement,
} from "#mystery-encounters/wish-on-a-star-encounter";
import type { PartyHealPhase } from "#phases/party-heal-phase";
import { GameManager } from "#test/framework/game-manager";
import { TextInterceptor } from "#test/framework/text-interceptor";
import {
  runMysteryEncounterToEnd,
  runSelectMysteryEncounterOption,
  skipBattleRunMysteryEncounterRewardsPhase,
} from "#test/utils/encounter-test-utils";
import { MessageUiHandler } from "#ui/message-ui-handler";
import { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import type { MysteryEncounterUiHandler } from "#ui/mystery-encounter-ui-handler";
import type { OptionSelectUiHandler } from "#ui/option-select-ui-handler";
import type { PartyUiHandler } from "#ui/party-ui-handler";
import { getEnumValues } from "#utils/enums";
import i18next from "i18next";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const namespace = "mysteryEncounters/wishOnAStar";
const defaultParty = [SpeciesId.LAPRAS, SpeciesId.GENGAR, SpeciesId.ABRA];
const defaultBiome = BiomeId.SPACE;
const defaultWave = 45;
const ALL_31: [number, number, number, number, number, number] = [31, 31, 31, 31, 31, 31];
const koFiles = import.meta.glob("../../../locales/ko/**/*.json", { eager: true, import: "default" });
const dialogueFiles = import.meta.glob("../../../locales/*/mystery-encounters/wish-on-a-star-dialogue.json", {
  eager: true,
  import: "default",
});

/**
 * Local fork (2026-11-20), item C2 of docs/유저_요청_요소_목록_20261120.md (the user: "C2 - 실행"): the ROGUE-tier
 * "별에게 소원을" (Wish on a Star, WISH_ON_A_STAR), from the official proposal pagefaultgames/pokerogue#4477. A sleeping
 * Jirachi in Space: option 1 (a song, a wake-up or sound move, or Electric Surge / Misty Surge / Punk Rock) picks a
 * wish of wealth (x10 the wave's money), power (IV Candies in 2 stats of one Pokémon, by the Training Session's steps
 * and up to the IV) or health (party heal); Wish or Healing Wish makes it x20 / 4 stats / + a Healing Charm. Option 2
 * battles an angry Jirachi boss (+1 to every stat, catchable); option 3 leaves.
 */
describe("Custom mystery encounter - Wish on a Star (WISH_ON_A_STAR)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let scene: BattleScene;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    // Korean text straight into i18next: every GameManager replaces the global `fetch` with a mock that can't serve
    // locale files, and in the full suite (`isolate: false`) an earlier file has already done so
    const { loadPath } = i18next.options.backend as { loadPath: (lng: string, ns: string[]) => string };
    for (const ns of i18next.options.ns as readonly string[]) {
      const file = /locales\/ko\/(.+?\.json)/.exec(loadPath("ko", [ns]))?.[1];
      const json = file ? koFiles[`../../../locales/ko/${file}`] : undefined;
      if (json) {
        i18next.addResourceBundle("ko", ns, json, true, true);
      }
    }
    expect(i18next.hasResourceBundle("ko", namespace)).toBe(true);
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    scene = game.scene;
    game.override
      .mysteryEncounterChance(100)
      .startingWave(defaultWave)
      .startingBiome(defaultBiome)
      .disableTrainerWaves()
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyPassiveAbility(AbilityId.BALL_FETCH);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Sets each party member's moves (Tackle for those not listed) */
  const teach = (party: readonly PlayerPokemon[], moves: readonly (readonly MoveId[])[]) => {
    party.forEach((p, i) => {
      p.moveset = (moves[i] ?? [MoveId.TACKLE]).map(m => new PokemonMove(m));
    });
  };

  /** Runs to the encounter; by default Lapras knows Sing and the others only Tackle */
  async function startEncounter(
    party = defaultParty,
    moves: readonly (readonly MoveId[])[] = [[MoveId.SING]],
  ): Promise<PlayerPokemon[]> {
    await game.runToMysteryEncounter(MysteryEncounterType.WISH_ON_A_STAR, party);
    scene.modifiers = [];
    await scene.updateModifiers(true);
    const members = scene.getPlayerParty();
    teach(members, moves);
    // the encounter phase filled the option tokens with the generated moves; again, as if the party had these
    scene.currentBattle.mysteryEncounter!.populateDialogueTokensFromRequirements();
    return members;
  }

  const optionHandler = () => scene.ui.handlers[UiMode.OPTION_SELECT] as OptionSelectUiHandler;
  const optionLabels = () => ((optionHandler() as any).config.options as { label: string }[]).map(o => o.label);
  const wishLabel = (key: string) => i18next.t(`${namespace}:wish.${key}.label`);

  /** Waits for the next option menu, then picks the entry whose label contains `text` */
  async function pick(text: string): Promise<void> {
    const handler = optionHandler();
    await vi.waitFor(() => {
      expect(scene.ui.mode).toBe(UiMode.OPTION_SELECT);
      expect(optionLabels().some(l => l.includes(text))).toBe(true);
    });
    const index = optionLabels().findIndex(l => l.includes(text));
    for (let i = 0; i < index; i++) {
      handler.processInput(Button.DOWN);
    }
    handler.processInput(Button.ACTION);
  }

  /** Picks the party slot `pokemonNo` (from 1) once the party screen opens */
  async function pickPokemon(partyShow: ReturnType<typeof vi.spyOn>, pokemonNo: number): Promise<void> {
    const partyHandler = scene.ui.handlers[UiMode.PARTY] as PartyUiHandler;
    await vi.waitFor(() => expect(partyShow).toHaveBeenCalled(), { timeout: 5000 });
    for (let i = 1; i < pokemonNo; i++) {
      partyHandler.processInput(Button.DOWN);
    }
    partyHandler.processInput(Button.ACTION); // the Pokémon's menu
    partyHandler.processInput(Button.ACTION); // "Select"
  }

  /** Option 1 with the wish `key` (and for power the party slot `pokemonNo`), run to the end of the encounter */
  async function makeWish(key: "wealth" | "power" | "health", pokemonNo?: number): Promise<void> {
    const partyShow = vi.spyOn(scene.ui.handlers[UiMode.PARTY] as PartyUiHandler, "show");
    await runSelectMysteryEncounterOption(game, 1);
    await pick(wishLabel(key));
    if (pokemonNo != null) {
      await pickPokemon(partyShow, pokemonNo);
    }
    game.onNextPrompt(
      "MysteryEncounterOptionSelectedPhase",
      UiMode.MESSAGE,
      () => {
        game.scene.ui.getHandler<MysteryEncounterUiHandler>().processInput(Button.ACTION);
      },
      () => game.isCurrentPhase("MysteryEncounterRewardsPhase"),
    );
    await game.phaseInterceptor.to("MysteryEncounterRewardsPhase");
  }

  const candiesOf = (pokemon: PlayerPokemon): IvCandyModifier[] =>
    pokemon.getHeldItems().filter((m): m is IvCandyModifier => m instanceof IvCandyModifier);
  const giveCandies = (pokemon: PlayerPokemon, stat: PermanentStat, count: number) => {
    const candy = generateModifierType(modifierTypes.IV_CANDY, [stat])!.newModifier(pokemon) as PokemonHeldItemModifier;
    candy.stackCount = count;
    scene.addModifier(candy, true);
  };
  const logsInclude = (text: string) => game.textInterceptor.logs.some(l => l.includes(text));
  /** Index of the first logged text that contains `text` (-1 when none) */
  const logIndex = (text: string) => game.textInterceptor.logs.findIndex(l => l.includes(text));

  describe("registration", () => {
    it("is a ROGUE-tier encounter appended last to the enum, with three options, the Jirachi art and its text", async () => {
      await startEncounter();

      expect(MysteryEncounterType.WISH_ON_A_STAR).toBe(MysteryEncounterType.SCRAP_TREASURE + 1);
      expect(Math.max(...getEnumValues(MysteryEncounterType))).toBeGreaterThanOrEqual(
        MysteryEncounterType.WISH_ON_A_STAR,
      );
      expect(allMysteryEncounters[MysteryEncounterType.WISH_ON_A_STAR]).toBe(WishOnAStarEncounter);
      expect(WishOnAStarEncounter.encounterTier).toBe(MysteryEncounterTier.ROGUE);
      expect(WishOnAStarEncounter.options).toHaveLength(3);
      expect(WishOnAStarEncounter.options.map(o => o.optionMode)).toEqual([
        MysteryEncounterOptionMode.DISABLED_OR_SPECIAL,
        MysteryEncounterOptionMode.DEFAULT,
        MysteryEncounterOptionMode.DEFAULT,
      ]);
      // the usual waves, nothing else
      expect(WishOnAStarEncounter.requirements).toHaveLength(1);
      const [waveRange] = WishOnAStarEncounter.requirements;
      expect(waveRange).toBeInstanceOf(WaveRangeRequirement);
      expect((waveRange as WaveRangeRequirement).waveRange).toEqual(CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES);
      expect(WishOnAStarEncounter.catchAllowed).toBe(true);
      expect(WishOnAStarEncounter.fleeAllowed).toBe(false);
      expect(WishOnAStarEncounter.hideBattleIntroMessage).toBe(true);
      expect(WishOnAStarEncounter.dialogue.intro).toStrictEqual([{ text: `${namespace}:intro` }]);
      expect(WishOnAStarEncounter.dialogue.encounterOptionsDialogue?.title).toBe(`${namespace}:title`);
      expect(WishOnAStarEncounter.dialogue.encounterOptionsDialogue?.description).toBe(`${namespace}:description`);
      expect(WishOnAStarEncounter.dialogue.encounterOptionsDialogue?.query).toBe(`${namespace}:query`);

      // the existing Jirachi sprite, held still while it sleeps
      expect(WishOnAStarEncounter.spriteConfigs).toHaveLength(1);
      expect(WishOnAStarEncounter.spriteConfigs[0]).toMatchObject({
        species: SpeciesId.JIRACHI,
        hasShadow: true,
        disableAnimation: true,
      });

      expect(i18next.t(`${namespace}:title`)).toBe("Wish on a Star");
      expect(scene.currentBattle.mysteryEncounter?.encounterType).toBe(MysteryEncounterType.WISH_ON_A_STAR);
    });

    it("spawns in Space only, next to the Space encounters", () => {
      expect(mysteryEncountersByBiome.get(BiomeId.SPACE)).toContain(MysteryEncounterType.WISH_ON_A_STAR);
      for (const [biome, encounters] of mysteryEncountersByBiome) {
        if (biome !== BiomeId.SPACE) {
          expect(encounters, `biome ${BiomeId[biome]}`).not.toContain(MysteryEncounterType.WISH_ON_A_STAR);
        }
      }
      expect(mysteryEncountersByBiome.get(BiomeId.SPACE)).toContain(MysteryEncounterType.THE_EXPERT_POKEMON_BREEDER);
      expect(mysteryEncountersByBiome.get(BiomeId.SPACE)).toContain(MysteryEncounterType.DARK_GLOBAL_TRADE_SYSTEM);
    });

    it("has no last wave in Endless (the fork's rule) and the usual ones in Classic", async () => {
      await startEncounter();
      const [waveRange] = WishOnAStarEncounter.requirements;
      scene.gameMode = getGameMode(GameModes.ENDLESS);
      for (const wave of [10, 180, 181, 1500, 5849]) {
        scene.currentBattle.waveIndex = wave;
        expect(waveRange.meetsRequirement(), `Endless wave ${wave}`).toBe(true);
      }
      scene.currentBattle.waveIndex = 9;
      expect(waveRange.meetsRequirement()).toBe(false);
      scene.gameMode = getGameMode(GameModes.CLASSIC);
      scene.currentBattle.waveIndex = 181;
      expect(waveRange.meetsRequirement()).toBe(false);
      scene.currentBattle.waveIndex = 180;
      expect(waveRange.meetsRequirement()).toBe(true);
    });

    it("sets up a shiny-locked Jirachi boss with one more segment, its four moves and +1 to every stat", async () => {
      await startEncounter();
      const encounter = scene.currentBattle.mysteryEncounter!;
      expect(encounter.enemyPartyConfigs).toHaveLength(1);
      const [config] = encounter.enemyPartyConfigs;
      expect(config.levelAdditiveModifier).toBe(0.5);
      expect(config.pokemonConfigs).toHaveLength(1);
      const [boss] = config.pokemonConfigs!;
      expect(boss).toMatchObject({ isBoss: true, shiny: false, bossSegmentModifier: 1 });
      expect(boss.species.speciesId).toBe(SpeciesId.JIRACHI);
      expect(boss.moveSet).toEqual([MoveId.DOOM_DESIRE, MoveId.IRON_HEAD, MoveId.PSYCHIC, MoveId.FIRE_PUNCH]);
      expect(boss.tags).toEqual([BattlerTagType.MYSTERY_ENCOUNTER_POST_SUMMON]);
      for (const move of WISH_ON_A_STAR_BOSS_MOVES) {
        expect(allMoves[move].isUnimplemented, MoveId[move]).toBe(false);
      }
      expect(WISH_ON_A_STAR_ANGRY_STATS).toEqual([Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD]);
    });
  });

  describe("option 1's requirement - a song, a sound or a waking move", () => {
    it("lists the proposal's songs, wake-up moves and wish moves, and the comments' sounds and abilities", () => {
      expect(WISH_ON_A_STAR_SONG_MOVES).toEqual([
        MoveId.SING,
        MoveId.RELIC_SONG,
        MoveId.PERISH_SONG,
        MoveId.TORCH_SONG,
      ]);
      expect(WISH_ON_A_STAR_WAKE_UP_MOVES).toEqual([
        MoveId.UPROAR,
        MoveId.WAKE_UP_SLAP,
        MoveId.ELECTRIC_TERRAIN,
        MoveId.MISTY_TERRAIN,
      ]);
      expect(WISH_ON_A_STAR_SOUND_MOVES).toHaveLength(17);
      expect(WISH_ON_A_STAR_WAKE_MOVES).toEqual([
        ...WISH_ON_A_STAR_SONG_MOVES,
        ...WISH_ON_A_STAR_WAKE_UP_MOVES,
        ...WISH_ON_A_STAR_SOUND_MOVES,
      ]);
      expect(new Set(WISH_ON_A_STAR_WAKE_MOVES).size).toBe(WISH_ON_A_STAR_WAKE_MOVES.length);
      expect(WISH_ON_A_STAR_WAKE_ABILITIES).toEqual([
        AbilityId.ELECTRIC_SURGE,
        AbilityId.MISTY_SURGE,
        AbilityId.PUNK_ROCK,
      ]);
      expect(WISH_ON_A_STAR_WISH_MOVES).toEqual([MoveId.WISH, MoveId.HEALING_WISH]);
    });

    it("is met by a party member able to battle that knows one, and names that move", async () => {
      const [lapras, gengar, abra] = await startEncounter(defaultParty, []);
      const option = WishOnAStarEncounter.options[0];
      expect(option.meetsRequirements()).toBe(false);
      expect(getWishOnAStarWakeSound(lapras)).toBeNull();

      teach([lapras, gengar, abra], [[], [MoveId.SHADOW_BALL, MoveId.HYPER_VOICE]]);
      expect(option.meetsRequirements()).toBe(true);
      expect(getWishOnAStarWakeSound(gengar)).toBe(allMoves[MoveId.HYPER_VOICE].name);
      expect(new WishOnAStarWakeRequirement().queryParty(scene.getPlayerParty())).toEqual([gengar]);

      // a fainted one can't sing
      gengar.hp = 0;
      gengar.doSetStatus(StatusEffect.FAINT);
      expect(option.meetsRequirements()).toBe(false);

      // every listed move works
      for (const move of WISH_ON_A_STAR_WAKE_MOVES) {
        teach([lapras], [[move]]);
        expect(option.meetsRequirements(), MoveId[move]).toBe(true);
      }
    });

    it("is met by Electric Surge, Misty Surge or Punk Rock too, named in its token", async () => {
      const [lapras] = await startEncounter(defaultParty, []);
      const option = WishOnAStarEncounter.options[0];
      for (const ability of WISH_ON_A_STAR_WAKE_ABILITIES) {
        const has = vi.spyOn(lapras, "hasAbility").mockImplementation(a => a === ability);
        expect(option.meetsRequirements(), AbilityId[ability]).toBe(true);
        expect(new WishOnAStarWakeRequirement().getDialogueToken(lapras)).toEqual([
          "wakeSound",
          allAbilities[ability].name,
        ]);
        has.mockRestore();
      }
      expect(option.meetsRequirements()).toBe(false);
    });

    it("fills option 1's tokens with the Pokémon and its move", async () => {
      await startEncounter();
      const encounter = scene.currentBattle.mysteryEncounter!;
      encounter.populateDialogueTokensFromRequirements();
      expect(encounter.dialogueTokens.option1PrimaryName).toBe(scene.getPlayerParty()[0].getNameToRender());
      expect(encounter.dialogueTokens.option1PrimaryWakeSound).toBe(allMoves[MoveId.SING].name);
      expect(i18next.t(`${namespace}:option.1.tooltip`, encounter.dialogueTokens)).toBe(
        "(+) Lapras’s Sing\n(+) Jirachi Grants a Wish",
      );
    });
  });

  describe("option 1 - wish for wealth", () => {
    it("gives x10 the wave's money, then Jirachi sleeps again: no reward screen or shop", async () => {
      await startEncounter();
      expect(WISH_ON_A_STAR_WEALTH_MULTIPLIER).toBe(10);
      const money = scene.money;
      const expected = scene.getWaveMoneyAmount(10);
      expect(getWishOnAStarWealthMoney(false)).toBe(expected);
      const leave = vi.spyOn(EncounterPhaseUtils, "leaveEncounterWithoutBattle");
      const newPhase = vi.spyOn(scene.phaseManager, "unshiftNew");

      await makeWish("wealth");

      expect(scene.money).toBe(money + expected);
      expect(leave).toHaveBeenCalledTimes(1);
      expect(leave.mock.calls[0][0] ?? false).toBe(false);
      expect(scene.currentBattle.mysteryEncounter!.doEncounterRewards).toBeUndefined();
      expect(newPhase.mock.calls.some(([name]) => name === "SelectModifierPhase")).toBe(false);
      expect(logsInclude("Money comes raining down")).toBe(true);
      expect(logsInclude("falls back into a deep sleep")).toBe(true);
      expect(logIndex("Money comes raining down")).toBeLessThan(logIndex("falls back into a deep sleep"));
      expect(logsInclude("shines along")).toBe(false);
    });

    it("gives x20 with a party member that knows Wish or Healing Wish (not a fainted one)", async () => {
      const [, , abra] = await startEncounter(defaultParty, [[MoveId.SING], [], [MoveId.HEALING_WISH]]);
      expect(WISH_ON_A_STAR_WEALTH_BONUS_MULTIPLIER).toBe(20);
      expect(getWishOnAStarWishMoveHolder()).toEqual({ pokemon: abra, move: MoveId.HEALING_WISH });
      const hp = abra.hp;
      abra.hp = 0;
      expect(getWishOnAStarWishMoveHolder()).toBeNull();
      abra.hp = hp;
      const money = scene.money;
      const expected = scene.getWaveMoneyAmount(20);
      expect(getWishOnAStarWealthMoney(true)).toBe(expected);

      await makeWish("wealth");

      expect(scene.money).toBe(money + expected);
      expect(logsInclude("Abra’s Healing Wish shines along!")).toBe(true);
    });
  });

  describe("option 1 - wish for power (IV Candies, the fork's rule)", () => {
    it("steps like the Training Session: 10 up to 10 held, 5 up to 20, 3 above", () => {
      expect([0, 5, 10, 11, 20, 21, 28, 30].map(getWishOnAStarCandyStep)).toEqual([10, 10, 10, 5, 5, 3, 3, 3]);
      expect(WISH_ON_A_STAR_POWER_STATS).toBe(2);
      expect(WISH_ON_A_STAR_POWER_BONUS_STATS).toBe(4);
    });

    it("rolls random stats with room, cut to the IV, in stat order", async () => {
      const [lapras] = await startEncounter();
      lapras.ivs = [31, 12, 31, 0, 31, 31];
      giveCandies(lapras, Stat.HP, 15);
      giveCandies(lapras, Stat.ATK, 5);
      giveCandies(lapras, Stat.DEF, 25);
      giveCandies(lapras, Stat.SPD, 31);
      expect(getWishOnAStarCandiesHeld(lapras, Stat.HP)).toBe(15);
      expect(getWishOnAStarCandyRoom(lapras, Stat.ATK)).toBe(7);
      expect(getWishOnAStarCandyRoom(lapras, Stat.SPATK)).toBe(0);
      expect(getWishOnAStarCandyRoom(lapras, Stat.SPD)).toBe(0);

      // HP 15 held: +5; Attack 5 held, IV 12: +10 cut to 7; Defense 25: +3; Sp. Def 0: +10; never Sp. Atk or Speed
      const byStat = new Map(rollWishOnAStarCandies(lapras, 6).map(g => [g.stat, g.count]));
      expect(byStat).toEqual(
        new Map<PermanentStat, number>([
          [Stat.HP, 5],
          [Stat.ATK, 7],
          [Stat.DEF, 3],
          [Stat.SPDEF, 10],
        ]),
      );
      for (let i = 0; i < 20; i++) {
        scene.setSeed(`wish-power-${i}`);
        scene.resetSeed(1);
        const gifts = rollWishOnAStarCandies(lapras, 2);
        expect(gifts, `seed ${i}`).toHaveLength(2);
        expect(gifts[0].stat).toBeLessThan(gifts[1].stat);
        for (const { stat, count } of gifts) {
          expect(byStat.get(stat), `seed ${i}: stat ${stat}`).toBe(count);
        }
      }

      // full: nothing to roll, and the party screen turns it away
      lapras.ivs = [0, 0, 0, 0, 0, 0];
      expect(rollWishOnAStarCandies(lapras, 4)).toEqual([]);
      expect(canTakeWishOnAStarCandy(lapras)).toBe(false);
    });

    it("gives the picked Pokémon IV Candies in 2 of its stats (10 each from none)", async () => {
      const [lapras, gengar, abra] = await startEncounter();
      for (const p of [lapras, gengar, abra]) {
        p.ivs = [...ALL_31];
      }

      await makeWish("power", 2);

      const candies = candiesOf(gengar);
      expect(candies).toHaveLength(2);
      expect(candies.map(c => c.getStackCount())).toEqual([10, 10]);
      expect(candiesOf(lapras)).toHaveLength(0);
      expect(candiesOf(abra)).toHaveLength(0);
      expect(candies.every(c => !c.isTransferable)).toBe(true);
      expect(logsInclude(`Gengar received\n10 ${candies[0].type.name}!`)).toBe(true);
      expect(logsInclude(`Gengar received\n10 ${candies[1].type.name}!`)).toBe(true);
    });

    it("gives 4 stats with a wish move", async () => {
      const [lapras, , abra] = await startEncounter(defaultParty, [[MoveId.SING], [], [MoveId.WISH]]);
      lapras.ivs = [...ALL_31];

      await makeWish("power", 1);

      const candies = candiesOf(lapras);
      expect(candies).toHaveLength(4);
      expect(candies.map(c => c.getStackCount())).toEqual([10, 10, 10, 10]);
      expect(new Set(candies.map(c => c.getStat())).size).toBe(4);
      expect(candiesOf(abra)).toHaveLength(0);
    });

    it("is left out of the menu while nobody can take a candy", async () => {
      const party = await startEncounter();
      for (const p of party) {
        p.ivs = [0, 0, 0, 0, 0, 0];
      }
      await runSelectMysteryEncounterOption(game, 1);
      await vi.waitFor(() => {
        expect(scene.ui.mode).toBe(UiMode.OPTION_SELECT);
        expect(optionLabels()).toContain(wishLabel("wealth"));
      });
      expect(optionLabels()).toEqual([wishLabel("wealth"), wishLabel("health"), i18next.t("menu:cancel")]);
      for (const stat of PERMANENT_STATS) {
        expect(getWishOnAStarCandyRoom(party[0], stat)).toBe(0);
      }
    });
  });

  describe("option 1 - wish for health", () => {
    it("heals the whole party, without a Healing Charm", async () => {
      const phaseSpy = vi.spyOn(scene.phaseManager, "unshiftPhase");
      const [lapras, gengar, abra] = await startEncounter();
      // Review (2026-11-20): really healed, not only queued
      gengar.hp = 1;
      abra.doSetStatus(StatusEffect.PARALYSIS);

      await makeWish("health");

      const heals = phaseSpy.mock.calls.flat().filter((p): p is PartyHealPhase => p.is("PartyHealPhase"));
      expect(heals).toHaveLength(1);
      expect(phaseSpy.mock.calls.flat().some(p => p.is("ModifierRewardPhase"))).toBe(false);
      expect(scene.findModifier(m => m instanceof HealingBoosterModifier)).toBeUndefined();
      for (const p of [lapras, gengar, abra]) {
        expect(p.hp, p.name).toBe(p.getMaxHp());
        expect(p.status?.effect ?? StatusEffect.NONE, p.name).toBe(StatusEffect.NONE);
      }
      expect(logsInclude("All your Pokémon are healed!")).toBe(true);
      // Jirachi falls asleep after its light heals the party (it used to say so before the heal)
      expect(logsInclude("falls back into a deep sleep")).toBe(true);
      expect(logIndex("All your Pokémon are healed!")).toBeLessThan(logIndex("falls back into a deep sleep"));
    });

    it("adds a Healing Charm with a wish move", async () => {
      await startEncounter(defaultParty, [[MoveId.SING], [MoveId.WISH]]);

      await makeWish("health");

      const charm = scene.findModifier(m => m instanceof HealingBoosterModifier) as HealingBoosterModifier;
      expect(charm).toBeDefined();
      expect(charm.getStackCount()).toBe(1);
      // the charm's message comes before Jirachi falls asleep
      const charmLog = logIndex(`You received\n${charm.type.name}!`);
      expect(charmLog).toBeGreaterThan(logIndex("All your Pokémon are healed!"));
      expect(charmLog).toBeLessThan(logIndex("falls back into a deep sleep"));
    });
  });

  describe("option 1 - the menu", () => {
    it("offers the three wishes and cancel; cancel goes back to the options without a wish", async () => {
      await startEncounter();
      const money = scene.money;
      await runSelectMysteryEncounterOption(game, 1);
      await vi.waitFor(() => expect(optionLabels()).toContain(wishLabel("power")));
      expect(optionLabels()).toEqual([
        wishLabel("wealth"),
        wishLabel("power"),
        wishLabel("health"),
        i18next.t("menu:cancel"),
      ]);
      await pick(i18next.t("menu:cancel"));
      await vi.waitFor(() => expect(scene.ui.mode).toBe(UiMode.MYSTERY_ENCOUNTER));
      expect(scene.money).toBe(money);
      expect(scene.currentBattle.mysteryEncounter!.misc).toBeFalsy();
    });

    it("backs out of the party screen to the wish menu, and a wish still works after it", async () => {
      // Review (2026-11-20): the power wish's party screen, cancelled
      const [lapras, gengar, abra] = await startEncounter();
      for (const p of [lapras, gengar, abra]) {
        p.ivs = [...ALL_31];
      }
      const partyHandler = scene.ui.handlers[UiMode.PARTY] as PartyUiHandler;
      const partyShow = vi.spyOn(partyHandler, "show");
      const money = scene.money;
      await runSelectMysteryEncounterOption(game, 1);
      await pick(wishLabel("power"));
      await vi.waitFor(() => expect(partyShow).toHaveBeenCalled(), { timeout: 5000 });
      expect(scene.ui.mode).toBe(UiMode.PARTY);
      partyHandler.processInput(Button.CANCEL);

      // the same menu again, without the wake-up text in between
      await vi.waitFor(() => {
        expect(scene.ui.mode).toBe(UiMode.OPTION_SELECT);
        expect(optionLabels()).toEqual([
          wishLabel("wealth"),
          wishLabel("power"),
          wishLabel("health"),
          i18next.t("menu:cancel"),
        ]);
      });
      expect(scene.currentBattle.mysteryEncounter!.misc).toBeFalsy();
      expect(scene.getPlayerParty().flatMap(p => candiesOf(p))).toHaveLength(0);

      await pick(wishLabel("wealth"));
      game.onNextPrompt(
        "MysteryEncounterOptionSelectedPhase",
        UiMode.MESSAGE,
        () => {
          game.scene.ui.getHandler<MysteryEncounterUiHandler>().processInput(Button.ACTION);
        },
        () => game.isCurrentPhase("MysteryEncounterRewardsPhase"),
      );
      await game.phaseInterceptor.to("MysteryEncounterRewardsPhase");
      expect(scene.money).toBe(money + getWishOnAStarWealthMoney(false));
      expect(scene.getPlayerParty().flatMap(p => candiesOf(p))).toHaveLength(0);
    });
  });

  describe("option 2 - shake it awake", () => {
    it("starts a battle against an angry Jirachi boss with +1 to every stat", async () => {
      await startEncounter(defaultParty, []);
      await runMysteryEncounterToEnd(game, 2, undefined, true);

      expect(game).toBeAtPhase("CommandPhase");
      const enemyField = scene.getEnemyField();
      expect(enemyField).toHaveLength(1);
      const [jirachi] = enemyField;
      expect(jirachi.species.speciesId).toBe(SpeciesId.JIRACHI);
      expect(jirachi.isBoss()).toBe(true);
      expect(jirachi.shiny).toBe(false);
      expect(jirachi.moveset.map(m => m.moveId)).toEqual([...WISH_ON_A_STAR_BOSS_MOVES]);
      for (const stat of WISH_ON_A_STAR_ANGRY_STATS) {
        expect(jirachi.getStatStage(stat), Stat[stat]).toBe(1);
      }
      expect(logsInclude("Jirachi is furious at being woken up!")).toBe(true);
    });

    it("rewards a Rogue item first when won", async () => {
      await startEncounter();
      expect(WISH_ON_A_STAR_WIN_TIERS).toEqual([ModifierTier.ROGUE]);
      await runMysteryEncounterToEnd(game, 2, undefined, true);
      await skipBattleRunMysteryEncounterRewardsPhase(game);
      await game.phaseInterceptor.to("SelectModifierPhase", false);
      expect(game).toBeAtPhase("SelectModifierPhase");
      await game.phaseInterceptor.to("SelectModifierPhase");

      expect(scene.ui.mode).toBe(UiMode.MODIFIER_SELECT);
      const handler = scene.ui.handlers.find(h => h instanceof ModifierSelectUiHandler) as ModifierSelectUiHandler;
      const options = handler.options.map(o => o.modifierTypeOption);
      expect(options.length).toBeGreaterThanOrEqual(3);
      expect(options[0].type.tier).toBeGreaterThanOrEqual(ModifierTier.ROGUE);
    });
  });

  describe("option 3 - leave", () => {
    it("leaves with nothing: no money, no item, no reward screen or shop", async () => {
      const party = await startEncounter();
      const money = scene.money;
      const leave = vi.spyOn(EncounterPhaseUtils, "leaveEncounterWithoutBattle");
      const newPhase = vi.spyOn(scene.phaseManager, "unshiftNew");

      await runMysteryEncounterToEnd(game, 3);

      expect(leave).toHaveBeenCalledTimes(1);
      expect(leave.mock.calls[0][0] ?? false).toBe(false);
      expect(scene.currentBattle.mysteryEncounter!.doEncounterRewards).toBeUndefined();
      expect(newPhase.mock.calls.some(([name]) => name === "SelectModifierPhase")).toBe(false);
      expect(scene.money).toBe(money);
      expect(party.flatMap(p => p.getHeldItems())).toHaveLength(0);
    });
  });

  describe("text", () => {
    it("has the same keys in Korean and English, and the user's title", () => {
      const ko = dialogueFiles["../../../locales/ko/mystery-encounters/wish-on-a-star-dialogue.json"] as any;
      const en = dialogueFiles["../../../locales/en/mystery-encounters/wish-on-a-star-dialogue.json"] as any;
      const keys = (obj: any, prefix = ""): string[] =>
        Object.entries(obj).flatMap(([k, v]) =>
          v != null && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
        );
      expect(keys(ko).sort()).toEqual(keys(en).sort());
      expect(ko.title).toBe("별에게 소원을");
      expect(ko.option["1"].label).toBe("노래로 깨운다");
      expect(ko.option["2"].label).toBe("억지로 깨운다");
      expect(ko.option["3"].label).toBe("떠난다");
    });

    /**
     * Every Korean text the encounter puts on screen, captured from the encounter screen (getEncounterText), the
     * message boxes and the test text log: no raw keys, no {{ }} or [[ ]] left.
     */
    describe("in Korean", () => {
      const captured: { flow: string; text: string }[] = [];
      let flow = "";
      const origGetEncounterText = EncounterDialogueUtils.getEncounterText;
      const origTiShowText = TextInterceptor.prototype.showText;
      const origBoxShowText = MessageUiHandler.prototype.showText;

      const relocalize = () => {
        for (const s of speciesDataRegistry.getAllSpecies()) {
          s.localize();
        }
        for (const m of allMoves) {
          m.localize();
        }
      };

      const record = (text: unknown) => {
        if (text != null && text !== "") {
          captured.push({ flow, text: String(text) });
        }
      };

      beforeAll(async () => {
        await i18next.changeLanguage("ko");
        relocalize();
      });

      afterAll(async () => {
        await i18next.changeLanguage("en");
        relocalize();
      });

      beforeEach(() => {
        vi.spyOn(EncounterDialogueUtils, "getEncounterText").mockImplementation((key?: string, style?: any) => {
          const result = origGetEncounterText(key, style);
          record(result);
          return result;
        });
        vi.spyOn(TextInterceptor.prototype, "showText").mockImplementation(function (this: TextInterceptor, text) {
          record(text);
          return origTiShowText.call(this, text);
        });
        vi.spyOn(MessageUiHandler.prototype, "showText").mockImplementation(function (
          this: MessageUiHandler,
          text: string,
          ...rest: any[]
        ) {
          record(text);
          return (origBoxShowText as any).call(this, text, ...rest);
        });
      });

      const textsOf = (f: string) =>
        captured
          .filter(c => c.flow === f)
          .map(c => c.text)
          .join("\n");

      it("shows the screen's strings", async () => {
        flow = "screen";
        await startEncounter();
        game.onNextPrompt(
          "MysteryEncounterPhase",
          UiMode.MESSAGE,
          () => game.scene.ui.getHandler<MysteryEncounterUiHandler>().processInput(Button.ACTION),
          () => game.isCurrentPhase("MysteryEncounterOptionSelectedPhase", "CommandPhase", "TurnInitPhase"),
        );
        await game.phaseInterceptor.to("MysteryEncounterPhase");
        const handler = game.scene.ui.getHandler<MysteryEncounterUiHandler>();
        handler.unblockInput();
        handler.processInput(Button.RIGHT);
        handler.processInput(Button.LEFT);
        handler.processInput(Button.DOWN);
        const texts = textsOf(flow);
        for (const expected of [
          "깊은 우주 한가운데에서\n빛나는 무언가를 발견했다.$고요한 소리가 울려 퍼진다…\n가까이 가 보니 잠든 지라치였다!",
          "별에게 소원을",
          "희망사항·치유소원 중 하나를 아는 포켓몬이 있으면 소원이 커집니다.",
          "어떻게 하시겠습니까?",
          "노래로 깨운다",
          "(+) 라프라스의 노래하기\n(+) 지라치가 소원을 들어줌",
          "억지로 깨운다",
          "(-) 화난 지라치와 어려운 배틀\n(+) 특별한 보상",
          "떠난다",
        ]) {
          expect(texts).toContain(expected);
        }
      });

      it("option 1: the wake-up, the menu's labels and its hover texts", async () => {
        flow = "menu";
        await startEncounter(defaultParty, [[MoveId.SING], [MoveId.WISH]]);
        await runSelectMysteryEncounterOption(game, 1);
        await vi.waitFor(() => expect(optionLabels()).toContain("힘을 빈다"));
        expect(optionLabels()).toEqual(["돈을 빈다", "힘을 빈다", "건강을 빈다", i18next.t("menu:cancel")]);
        const handler = optionHandler();
        for (let i = 0; i < 3; i++) {
          handler.processInput(Button.DOWN);
        }
        const texts = textsOf(flow);
        expect(texts).toContain("라프라스의 노래하기에\n지라치가 눈을 떴다! 어떤 소원을 빌까?");
        // Plain money: the battle message window draws no @[MONEY]{} colour codes (seen raw in the game 11-20)
        expect(texts).toMatch(/돈을 ₽[\d,]+만큼 받는다\./);
        expect(texts).not.toContain("@[");
        expect(texts).toContain("고른 포켓몬 하나가 능력 4가지의\n개체값사탕을 받는다.");
        expect(texts).toContain("파티 전원이 회복되고\n치유의부적을 받는다.");
        expect(texts).toContain("조우 선택지로 돌아가기");
        handler.processInput(Button.ACTION);
        await vi.waitFor(() => expect(scene.ui.mode).toBe(UiMode.MYSTERY_ENCOUNTER));
      });

      it("option 1: the bonus and the money", async () => {
        flow = "wealth";
        await startEncounter(defaultParty, [[MoveId.SING], [MoveId.WISH]]);
        await makeWish("wealth");
        const texts = textsOf(flow);
        expect(texts).toContain("팬텀의 희망사항이 함께 빛난다!\n소원이 더 크게 이루어진다!");
        expect(texts).toContain("하늘에서 돈이 비처럼 쏟아졌다!");
        expect(texts).toMatch(/₽[\d,]+만큼 받았다!/);
        expect(texts).not.toContain("@[");
        expect(texts).toContain("소원을 들어준 지라치는\n다시 깊은 잠에 빠졌다…");
      });

      it("option 1: the candies", async () => {
        flow = "power";
        const [lapras] = await startEncounter();
        lapras.ivs = [...ALL_31];
        await makeWish("power", 1);
        expect(textsOf(flow)).toMatch(/라프라스는\n(기력|힘|수비|지식|마음|속도)의사탕 10개를 얻었다!/);
      });

      it("option 1: the heal", async () => {
        flow = "health";
        await startEncounter();
        await makeWish("health");
        expect(textsOf(flow)).toContain("지라치의 빛이 파티를 감쌌다!\n모든 포켓몬이 회복되었다!");
      });

      it("option 2: the angry Jirachi", async () => {
        flow = "battle";
        await startEncounter();
        await runMysteryEncounterToEnd(game, 2, undefined, true);
        const texts = textsOf(flow);
        expect(texts).toContain("잠든 지라치를 마구 흔들어 깨웠다!$지라치가 잔뜩 화가 나서 눈을 떴다!");
        expect(texts).toContain("잠을 방해받은 지라치가 단단히 화났다!");
      });

      it("leaves no raw key, {{ }} or [[ ]] in anything it showed", () => {
        expect(captured.length).toBeGreaterThan(15);
        for (const { flow: f, text } of captured) {
          expect(text, `${f}: ${text}`).not.toMatch(/\{\{|\}\}|\[\[|\]\]/);
          expect(text, `${f}: ${text}`).not.toContain("wishOnAStar");
          expect(text, `${f}: ${text}`).not.toContain("mysteryEncounters/");
        }
      });
    });
  });
});
