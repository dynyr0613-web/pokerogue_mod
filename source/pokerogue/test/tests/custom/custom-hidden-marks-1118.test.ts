// Local fork (2026-11-18): the new hidden marks and ribbons (pokemon-marks.ts). The user: "새 히든 증표•리본".
// - Destiny Mark (운명의증표): since the second round, 1 in 100 caught or hatched (custom-dex-achievements-1118)
// - Gourmand Mark (미식가의증표): all six IV Candies eaten up to the cap
// - Itemfinder Mark (습득의증표): the first item Pickup picks up
// - the Gen 4 ability ribbons for clearing Endless wave 500 / 1000 / 2000 / 3000 / 4000 / 5000
// - Hisui Ribbon (히스이리본) for a named trainer from Hisui, Master Rank Ribbon (마스터랭크리본) once all 11 are beaten
// and the mark Pokédex's hidden page and the Pokédex page's mark tray that show them.

import { getGameMode } from "#app/game-mode";
import { modifierTypes } from "#data/data-lists";
import {
  awardEndlessMilestoneRibbon,
  awardItemfinderMark,
  awardMasterRankRibbon,
  awardProgressRibbons,
  awardTrainerRibbon,
  COMPLETION_EXEMPT_MARKS,
  ENDLESS_MILESTONE_RIBBONS,
  getEarnedProgressRibbons,
  getMarkKey,
  hasBeatenAllNamedTrainers,
  hasEatenAllIvCandies,
  isPokemonMark,
  isRibbon,
  orderedPokemonMarks,
  TRAINER_RIBBONS,
} from "#data/pokemon-marks";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BerryType } from "#enums/berry-type";
import { Button } from "#enums/buttons";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { PokemonMark } from "#enums/pokemon-mark";
import { SpeciesId } from "#enums/species-id";
import { PERMANENT_STATS, type PermanentStat, Stat } from "#enums/stat";
import { TrainerType } from "#enums/trainer-type";
import { UiMode } from "#enums/ui-mode";
import { IvCandyModifier } from "#modifiers/custom-held-items";
import type { ModifierTypeGenerator } from "#modifiers/modifier-type";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { achvs } from "#system/achv";
import { vouchers } from "#system/voucher";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import { getAppRootDir } from "#test/utils/sprite-utils";
import { FORK_NAMED_TRAINER_TYPES } from "#trainers/named-trainers";
import type { MarkDexUiHandler } from "#ui/mark-dex-ui-handler";
import { HIDDEN_PAGE_ROWS } from "#ui/mark-dex-ui-handler";
import { getMarkTrayHeight } from "#ui/mark-tray-container";
import fs from "node:fs";
import path from "node:path";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** The new hidden marks and ribbons, with their save numbers and their official names */
const NEW_MARKS: readonly [PokemonMark, number, string, string][] = [
  [PokemonMark.ABILITY_RIBBON, 21, "어빌리티리본", "Ability Ribbon"],
  [PokemonMark.GREAT_ABILITY_RIBBON, 22, "그레이트어빌리티리본", "Great Ability Ribbon"],
  [PokemonMark.DOUBLE_ABILITY_RIBBON, 23, "더블어빌리티리본", "Double Ability Ribbon"],
  [PokemonMark.MULTI_ABILITY_RIBBON, 24, "멀티어빌리티리본", "Multi Ability Ribbon"],
  [PokemonMark.PAIR_ABILITY_RIBBON, 25, "페어어빌리티리본", "Pair Ability Ribbon"],
  [PokemonMark.WORLD_ABILITY_RIBBON, 26, "월드어빌리티리본", "World Ability Ribbon"],
  [PokemonMark.HISUI_RIBBON, 27, "히스이리본", "Hisui Ribbon"],
  [PokemonMark.MASTER_RANK_RIBBON, 28, "마스터랭크리본", "Master Rank Ribbon"],
  [PokemonMark.DESTINY_MARK, 212, "운명의증표", "Destiny Mark"],
  [PokemonMark.GOURMAND_MARK, 213, "미식가의증표", "Gourmand Mark"],
  [PokemonMark.ITEMFINDER_MARK, 214, "습득의증표", "Itemfinder Mark"],
];

describe("Local fork - the hidden marks and ribbons of 2026-11-18", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Starts a run in `mode` on `wave` the way the title screen would, and plays to the first command */
  async function startRun(mode: GameModes, wave: number): Promise<void> {
    game.override.startingWave(wave).seed("hidden-marks").mysteryEncounterChance(0);
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(mode);
      game.scene.offsetGym = false;
      const starters = generateStarters(game.scene, [SpeciesId.GARCHOMP, SpeciesId.MILOTIC]);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await game.phaseInterceptor.to("CommandPhase", false);
  }

  const unlocked = (achv: { id: string }) => Object.hasOwn(game.scene.gameData.achvUnlocks, achv.id);

  it("keeps every old save number, and adds the new ones as hidden marks with names, titles and icons", () => {
    // The numbers are saved with each Pokémon: the old ones must not move
    expect(PokemonMark.ENDLESS_MASTER_RIBBON).toBe(20);
    expect(PokemonMark.MASTER_BALL_MARK).toBe(211);
    expect(PokemonMark.ETERNATUS_MARK).toBe(300);
    const root = getAppRootDir();
    const atlas = JSON.parse(fs.readFileSync(path.join(root, "assets", "images", "marks", "marks.json"), "utf8"));
    const frames = new Set<string>(atlas.textures[0].frames.map((f: { filename: string }) => f.filename));
    const texts = Object.fromEntries(
      ["ko", "en"].map(lang => [
        lang,
        JSON.parse(fs.readFileSync(path.join(root, "locales", lang, "pokemon-marks.json"), "utf8")),
      ]),
    );
    for (const [mark, value, koName, enName] of NEW_MARKS) {
      const key = getMarkKey(mark);
      expect(mark, key).toBe(value);
      expect(isPokemonMark(mark), key).toBe(true);
      expect(orderedPokemonMarks, key).toContain(mark);
      expect(COMPLETION_EXEMPT_MARKS, key).toContain(mark);
      expect(isRibbon(mark), key).toBe(value < 100);
      expect(frames.has(key), `icon of ${key}`).toBe(true);
      expect(texts.ko[key].name).toBe(koName);
      expect(texts.en[key].name).toBe(enName);
      for (const lang of ["ko", "en"]) {
        expect(texts[lang][key].description, `${lang} description of ${key}`).toBeTruthy();
        expect(texts[lang][key].title, `${lang} title of ${key}`).toBeTruthy();
      }
    }
    // The official titles of the main series where there is one
    expect(texts.ko.destinyMark.title).toBe("운명을 느끼는");
    expect(texts.ko.gourmandMark.title).toBe("미식가");
    expect(texts.ko.itemfinderMark.title).toBe("트레져헌터");
    expect(texts.ko.hisuiRibbon.title).toBe("먼 옛날의");
    expect(texts.ko.masterRankRibbon.title).toBe("랭크 마스터");
  });

  /** A generated IV Candy type with its id, as the reward pool gives it */
  function candyType(stat: PermanentStat) {
    const generator = modifierTypes.IV_CANDY() as ModifierTypeGenerator;
    generator.id = "IV_CANDY";
    return generator.generateType([], [stat])!;
  }

  it("gives the Gourmand Mark for all six IV Candies eaten up to the cap, once", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const pokemon = game.field.getPlayerPokemon();
    // No candy at all, even with nothing to take: not a gourmand
    pokemon.ivs = [0, 0, 0, 0, 0, 0];
    expect(hasEatenAllIvCandies(pokemon)).toBe(false);

    // A stat whose IV is 0 takes no candy and so is full
    pokemon.ivs = [2, 1, 1, 1, 1, 0];
    const eat = (stat: PermanentStat, count: number) => {
      const candy = new IvCandyModifier(candyType(stat), pokemon.id, stat, count);
      game.scene.addModifier(candy, true, false, false, true);
    };
    for (const stat of PERMANENT_STATS.filter(s => s !== Stat.SPD && s !== Stat.SPDEF)) {
      eat(stat, pokemon.ivs[stat]);
    }
    expect(hasEatenAllIvCandies(pokemon)).toBe(false);
    eat(Stat.SPDEF, 1);
    expect(hasEatenAllIvCandies(pokemon)).toBe(true);
    expect(getEarnedProgressRibbons(pokemon)).toContain(PokemonMark.GOURMAND_MARK);

    awardProgressRibbons();
    expect(pokemon.hasMark(PokemonMark.GOURMAND_MARK)).toBe(true);
    expect(game.scene.gameData.markCounts[PokemonMark.GOURMAND_MARK]).toBe(1);
    awardProgressRibbons();
    expect(game.scene.gameData.markCounts[PokemonMark.GOURMAND_MARK]).toBe(1);
    // A hidden mark: the hidden-mark achievement
    expect(unlocked(achvs.HIDDEN_MARK)).toBe(true);
  });

  it("gives the Itemfinder Mark the first time Pickup picks up an item, and only to the player's", async () => {
    game.override.ability(AbilityId.PICKUP).enemyHeldItems([{ name: "BERRY", type: BerryType.LUM }]);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    expect(awardItemfinderMark(enemy)).toBe(false);
    expect(enemy.hasMark(PokemonMark.ITEMFINDER_MARK)).toBe(false);

    game.move.use(MoveId.AERIAL_ACE);
    await game.toNextWave();
    expect(player.getHeldItems()).toHaveLength(1);
    expect(player.hasMark(PokemonMark.ITEMFINDER_MARK)).toBe(true);
    expect(game.scene.gameData.markCounts[PokemonMark.ITEMFINDER_MARK]).toBe(1);
    // Only the first time
    expect(awardItemfinderMark(player)).toBe(false);
    expect(game.scene.gameData.markCounts[PokemonMark.ITEMFINDER_MARK]).toBe(1);
  });

  it("gives the party the Endless milestone's ability ribbon in Endless and Spliced Endless only", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MILOTIC);
    const party = game.scene.getPlayerParty();
    expect(ENDLESS_MILESTONE_RIBBONS).toEqual({
      500: PokemonMark.ABILITY_RIBBON,
      1000: PokemonMark.GREAT_ABILITY_RIBBON,
      2000: PokemonMark.DOUBLE_ABILITY_RIBBON,
      3000: PokemonMark.MULTI_ABILITY_RIBBON,
      4000: PokemonMark.PAIR_ABILITY_RIBBON,
      5000: PokemonMark.WORLD_ABILITY_RIBBON,
    });
    expect(awardEndlessMilestoneRibbon(500)).toBeNull();

    game.scene.gameMode = getGameMode(GameModes.SPLICED_ENDLESS);
    expect(awardEndlessMilestoneRibbon(499)).toBeNull();
    expect(awardEndlessMilestoneRibbon(1000)).toBe(PokemonMark.GREAT_ABILITY_RIBBON);
    expect(party.every(p => p.hasMark(PokemonMark.GREAT_ABILITY_RIBBON))).toBe(true);
    // Nobody new to give it to
    expect(awardEndlessMilestoneRibbon(1000)).toBeNull();
    expect(game.scene.gameData.markCounts[PokemonMark.GREAT_ABILITY_RIBBON]).toBe(2);
  });

  it("awards the ability ribbon when Endless wave 500 is cleared", async () => {
    game.override.enemyHealthSegments(1);
    await startRun(GameModes.ENDLESS, 500);
    expect(game.scene.currentBattle.waveIndex).toBe(500);
    game.move.use(MoveId.SPLASH);
    await game.doKillOpponents();
    await game.phaseInterceptor.to("VictoryPhase");
    for (const pokemon of game.scene.getPlayerParty()) {
      expect(pokemon.hasMark(PokemonMark.ABILITY_RIBBON)).toBe(true);
    }
  });

  it("gives the Hisui Ribbon for a named trainer from Hisui, which no champion achievement asks for", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    for (const type of [TrainerType.VOLO, TrainerType.IRIDA, TrainerType.ADAMAN, TrainerType.KAMADO]) {
      expect(TRAINER_RIBBONS[type]).toBe(PokemonMark.HISUI_RIBBON);
    }
    for (const type of [TrainerType.SONIA, TrainerType.HOP, TrainerType.BRIAR]) {
      expect(TRAINER_RIBBONS[type]).toBeUndefined();
    }
    expect(awardTrainerRibbon(TrainerType.IRIDA)).toBe(PokemonMark.HISUI_RIBBON);
    expect(game.field.getPlayerPokemon().hasMark(PokemonMark.HISUI_RIBBON)).toBe(true);
    expect(unlocked(achvs.MEMORIAL_RIBBON)).toBe(false);
    expect(unlocked(achvs.HIDDEN_MARK)).toBe(true);
  });

  it("gives the Master Rank Ribbon only once every named trainer has been beaten, by their vouchers", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const { voucherUnlocks } = game.scene.gameData;
    // Each named trainer's first win is its voucher
    for (const type of FORK_NAMED_TRAINER_TYPES) {
      expect(Object.hasOwn(vouchers, TrainerType[type]), TrainerType[type]).toBe(true);
      delete voucherUnlocks[TrainerType[type]];
    }
    expect(FORK_NAMED_TRAINER_TYPES).toHaveLength(11);
    for (const type of FORK_NAMED_TRAINER_TYPES.slice(1)) {
      voucherUnlocks[TrainerType[type]] = 1;
    }
    expect(hasBeatenAllNamedTrainers()).toBe(false);
    expect(awardMasterRankRibbon(TrainerType.HOP)).toBe(false);

    voucherUnlocks[TrainerType[FORK_NAMED_TRAINER_TYPES[0]]] = 1;
    expect(hasBeatenAllNamedTrainers()).toBe(true);
    // Only for beating a named trainer
    expect(awardMasterRankRibbon(TrainerType.CYNTHIA)).toBe(false);
    expect(awardMasterRankRibbon(TrainerType.HOP)).toBe(true);
    expect(game.field.getPlayerPokemon().hasMark(PokemonMark.MASTER_RANK_RIBBON)).toBe(true);
    expect(awardMasterRankRibbon(TrainerType.HOP)).toBe(false);
  });

  it("awards the Hisui and Master Rank Ribbons when the last named trainer, Volo, is beaten in battle", async () => {
    game.override.battleType(BattleType.TRAINER).randomTrainer({ trainerType: TrainerType.VOLO });
    await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MILOTIC);
    expect(game.scene.currentBattle.trainer?.config.trainerType).toBe(TrainerType.VOLO);
    const { voucherUnlocks } = game.scene.gameData;
    for (const type of FORK_NAMED_TRAINER_TYPES) {
      if (type === TrainerType.VOLO) {
        delete voucherUnlocks[TrainerType[type]];
      } else {
        voucherUnlocks[TrainerType[type]] = 1;
      }
    }

    for (const benched of game.scene.getEnemyParty().slice(1)) {
      benched.hp = 0;
    }
    game.move.use(MoveId.SPLASH);
    await game.doKillOpponents();
    await game.phaseInterceptor.to("TrainerVictoryPhase");

    expect(Object.hasOwn(voucherUnlocks, "VOLO")).toBe(true);
    for (const pokemon of game.scene.getPlayerParty()) {
      expect(pokemon.hasMark(PokemonMark.HISUI_RIBBON)).toBe(true);
      expect(pokemon.hasMark(PokemonMark.MASTER_RANK_RIBBON)).toBe(true);
    }
  });

  it("lays the mark Pokédex's hidden page out in rows inside its window, the Eternatus Mark alone below", async () => {
    await game.runToTitle();
    const handler = game.scene.ui.handlers[UiMode.MARK_DEX] as MarkDexUiHandler;
    const cells: { mark: PokemonMark; base: Phaser.GameObjects.Image; row: number; scale: number }[] =
      handler["hiddenCells"];

    expect(HIDDEN_PAGE_ROWS.flat()).toEqual([...COMPLETION_EXEMPT_MARKS, PokemonMark.ETERNATUS_MARK]);
    expect(HIDDEN_PAGE_ROWS.at(-1)).toEqual([PokemonMark.ETERNATUS_MARK]);
    expect(cells.map(c => c.mark)).toEqual(HIDDEN_PAGE_ROWS.flat());

    // Inside the grid's window: the list's 14 columns of 20 px, and its rows with the window's margin above and below
    // them (the window is the 180 px screen less the 24 px header and the 44 px description), less 4 px at the top for
    // the arrow back up. The test scene's windows have no size, so the list's place is worked out here
    const listHeight = Math.ceil((orderedPokemonMarks.length - COMPLETION_EXEMPT_MARKS.length) / 14) * 20;
    const margin = (180 - 24 - 44 - listHeight) / 2;
    const boxes = cells.map(cell => {
      const size = 40 * cell.scale;
      const x = cell.base.x - size / 2;
      const y = cell.base.y - size / 2;
      return { x, y, right: x + size, bottom: y + size };
    });
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(14 * 20);
      expect(box.y).toBeGreaterThanOrEqual(-margin + 4);
      expect(box.bottom).toBeLessThanOrEqual(listHeight + margin);
    }
    // No two overlap
    boxes.forEach((a, i) => {
      for (const b of boxes.slice(i + 1)) {
        expect(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y).toBe(true);
      }
    });
    // The Eternatus Mark is in the middle, apart from the row above it
    const eternatus = cells.at(-1)!;
    expect(eternatus.base.x).toBeCloseTo(cells[0].base.x + (cells[7].base.x - cells[0].base.x) / 2);
    expect(boxes.at(-1)!.y - boxes.at(-2)!.bottom).toBeGreaterThanOrEqual(8);

    // Up and down move between rows; up from the first goes back to the list
    handler["setHiddenPage"](true);
    expect(handler["hiddenCursor"]).toBe(0);
    expect(handler.processInput(Button.DOWN)).toBe(true);
    expect(cells[handler["hiddenCursor"]].row).toBe(1);
    expect(handler.processInput(Button.DOWN)).toBe(true);
    expect(cells[handler["hiddenCursor"]].mark).toBe(PokemonMark.ETERNATUS_MARK);
    expect(handler.processInput(Button.DOWN)).toBe(false);
    expect(handler.processInput(Button.UP)).toBe(true);
    expect(cells[handler["hiddenCursor"]].row).toBe(1);
    expect(handler.processInput(Button.UP)).toBe(true);
    expect(cells[handler["hiddenCursor"]].row).toBe(0);
    expect(handler.processInput(Button.UP)).toBe(true);
    expect(handler["onHiddenPage"]).toBe(false);
  });

  it("fits the Pokédex page's mark tray above its message box", () => {
    // Nine rows of ten, above the two-line message box at the bottom of the 180 px screen
    expect(orderedPokemonMarks).toHaveLength(84);
    expect(getMarkTrayHeight()).toBeLessThanOrEqual(180 - 42 - 1);
  });
});
