// Local fork (2026-11-18): the mark screens after the seeded self-test (selftest-seeded-4):
// 1. the battle info box: the worn mark's title is shown whole or not at all ("1000웨이브를 돌파한" became "1000." and
//    "카리스마의" pushed Zigzagoon down to "지그제구."), and the name, its gender symbol and the alpha badge stay clear of "Lv"
// 3. the mark Pokédex's header counts the listed marks over their total and the hidden ones apart ("종류 77/69")
// 4. its icons fill up over their own drawing, with no minimum (stray bright lines under some icons)
// 5. the Pokédex page's mark tray counts the same way ("증표 12/69" for 7 listed and 5 hidden marks)
// 6. the Pokédex page's IV key hint reads like the others (": 성별")

import { Gender } from "#data/gender";
import {
  COMPLETION_EXEMPT_MARKS,
  countListedAndHiddenMarks,
  getMarkCountText,
  LISTED_POKEMON_MARKS,
  orderedPokemonMarks,
} from "#data/pokemon-marks";
import { MoveId } from "#enums/move-id";
import { PokemonMark } from "#enums/pokemon-mark";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import { MockContainer } from "#test/mocks/mocks-container/mock-container";
import { getAppRootDir } from "#test/utils/sprite-utils";
import type { BattleInfo } from "#ui/battle-info";
import { ALPHA_BADGE_ROOM, fitTitleAndName, TITLE_GAP } from "#ui/battle-info";
import type { MarkDexUiHandler } from "#ui/mark-dex-ui-handler";
import { getMarkDexTotalText, getMarkFillRows } from "#ui/mark-dex-ui-handler";
import type { MarkTray } from "#ui/mark-tray-container";
import fs from "node:fs";
import path from "node:path";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The battle info's letters as the emerald font draws them (pokemon-emerald-pro.ttf, 1024 units to the em): a Hangul
 * syllable 704 units, a digit 384, "." and a space 192, Latin letters taken as 384 here
 * @param size - The font's size in px (the name 12, the title 52 / 6)
 */
const letterUnits = (ch: string): number => {
  if (/[가-힣]/.test(ch)) {
    return 704;
  }
  return /[. ]/.test(ch) ? 192 : 384;
};
const fontWidth =
  (size: number) =>
  (text: string): number =>
    [...text].reduce((w, ch) => w + letterUnits(ch), 0) * (size / 1024);
const measureName = fontWidth(12);
const measureTitle = fontWidth(52 / 6);

describe("Local fork - the mark screens of 2026-11-18", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    // The test scene's images have no tint mode; the mark screens set one on every icon
    const mock = MockContainer.prototype as unknown as { setTintMode?: () => unknown };
    mock.setTintMode ??= function (this: unknown) {
      return this;
    };
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(5)
      .enemyLevel(2);
  });

  describe("1. the title in the battle info box", () => {
    it("shows a title that fits whole, with the whole name", () => {
      // The self-test's enemy: "카리스마의 버섯꼬", in the 64 px of a level-2 Pokémon with a gender
      const result = fitTitleAndName("카리스마의", "버섯꼬", 64, measureTitle, measureName);
      expect(result.title).toBe("카리스마의");
      expect(result.name).toBe("버섯꼬");
      expect(result.titleWidth).toBeCloseTo(measureTitle("카리스마의") + TITLE_GAP);
      expect(result.titleWidth + result.nameWidth).toBeLessThanOrEqual(64);
    });

    it("drops a title that does not fit, and shows the name as the game would, never a cut title", () => {
      // "지그제구." with "카리스마의" before it: now Zigzagoon keeps its whole name and the title goes
      expect(fitTitleAndName("카리스마의", "지그제구리", 64, measureTitle, measureName)).toMatchObject({
        title: "",
        name: "지그제구리",
        titleWidth: 0,
      });
      // "1000." before an alpha's name: the title goes, the name stays
      expect(fitTitleAndName("1000웨이브를 돌파한", "이상해씨", 48, measureTitle, measureName)).toMatchObject({
        title: "",
        name: "이상해씨",
      });
      // A name too long even without a title is shortened as the game always did
      const long = fitTitleAndName("카리스마의", "Crabominable", 40, measureTitle, measureName);
      expect(long.title).toBe("");
      expect(long.name.endsWith(".")).toBe(true);
      expect(long.nameWidth).toBeLessThanOrEqual(40);
      expect(long).toEqual(fitTitleAndName("", "Crabominable", 40, measureTitle, measureName));
    });

    it("never cuts a title, at any width", () => {
      const titles = ["카리스마의", "1000웨이브를 돌파한", "the Charismatic", "기술의 달인"];
      const names = ["버섯꼬", "지그제구리", "이상해씨", "Zigzagoon", "Crabominable"];
      for (let allowance = 0; allowance <= 120; allowance += 0.5) {
        for (const title of titles) {
          for (const name of names) {
            const result = fitTitleAndName(title, name, allowance, measureTitle, measureName);
            if (result.title) {
              expect(result.title).toBe(title);
              expect(result.name).toBe(name);
              expect(result.titleWidth + result.nameWidth).toBeLessThanOrEqual(allowance);
            } else {
              expect(result).toEqual(fitTitleAndName("", name, allowance, measureTitle, measureName));
            }
          }
        }
      }
    });

    it("keeps the name, its gender symbol, icons and the alpha badge clear of Lv in both boxes", async () => {
      await game.classicMode.startBattle(SpeciesId.BULBASAUR);
      for (const pokemon of [game.field.getPlayerPokemon(), game.field.getEnemyPokemon()]) {
        pokemon.gender = Gender.MALE;
        const info = pokemon.getBattleInfo() as BattleInfo;
        const nameLeft: number = info["nameTextBaseX"];
        const lvBase: number = info["baseLvContainerX"];
        for (const level of [2, 9, 10, 99, 100, 999, 1000, 54321]) {
          for (const shiny of [false, true]) {
            for (const boost of [0, 20]) {
              pokemon.level = level;
              pokemon.shiny = shiny;
              pokemon.alphaBoost = boost;
              const limit: number = info["getNameWidthLimit"](pokemon);
              // "Lv" starts 2.5 px left of the level container, which moves 8 px left per digit past the third; the
              // gender symbol is 4.5 px, a shiny icon 7 px after 1 px, the alpha badge 1 + 2 * 3.75 + 7.25 px
              const lvLeft = lvBase - 2.5 - 8 * Math.max(level.toString().length - 3, 0);
              const right = nameLeft + limit + 4.5 + (shiny ? 1 + 7 : 0) + (boost > 0 ? 1 + 2 * 3.75 + 7.25 : 0);
              expect(
                right,
                `${pokemon.isPlayer() ? "player" : "enemy"} level ${level} shiny ${shiny} boost ${boost}`,
              ).toBeLessThanOrEqual(lvLeft - 1);
            }
          }
        }
        pokemon.shiny = false;
        pokemon.alphaBoost = 0;
      }
      // The badge's room covers its number of two digits and the crown
      expect(ALPHA_BADGE_ROOM).toBeGreaterThanOrEqual(1 + 2 * 3.75 + 7.25);
    });
  });

  describe("3. and 4. the mark Pokédex", () => {
    it("counts the listed marks over their total and the hidden ones apart", () => {
      expect(LISTED_POKEMON_MARKS).toHaveLength(orderedPokemonMarks.length - COMPLETION_EXEMPT_MARKS.length);
      expect(getMarkDexTotalText(61, 69, 8, 16, 3, 570)).toBe("Kinds 61/69 · Hidden 8/16   Pokémon 3/570");
      // Before any hidden mark is obtained they stay out of it
      expect(getMarkDexTotalText(61, 69, 0, 16, 3, 570)).toBe("Kinds 61/69   Pokémon 3/570");
    });

    it("shows the counts of the save in its header, the Eternatus Mark among the hidden ones", async () => {
      await game.runToTitle();
      const { starterData } = game.scene.gameData;
      starterData[SpeciesId.BULBASAUR].marks = [
        PokemonMark.CHAMPION_RIBBON,
        PokemonMark.RARE_MARK,
        PokemonMark.MIGHTIEST_MARK,
        PokemonMark.DESTINY_MARK,
      ];
      starterData[SpeciesId.CHARMANDER].marks = [PokemonMark.CHAMPION_RIBBON, PokemonMark.ONCE_IN_A_LIFETIME_RIBBON];
      const handler = game.scene.ui.handlers[UiMode.MARK_DEX] as MarkDexUiHandler;
      handler["readCollection"]();
      handler["updateMarkCells"]();
      handler["showMarkView"]();
      const hiddenCells: unknown[] = handler["hiddenCells"];
      expect(hiddenCells).toHaveLength(COMPLETION_EXEMPT_MARKS.length + 1);
      const lines: number = handler["countedIds"].length;
      expect(handler["totalText"].text).toBe(`Kinds 2/69 · Hidden 3/${hiddenCells.length}   Pokémon 2/${lines}`);
    });

    it("fills an icon over its own drawing, with no minimum", () => {
      // The Stormy Mark is drawn from row 3 to row 37 of its 40 px frame
      expect(getMarkFillRows(3, 38, 2, 570)).toEqual({ y: 38, rows: 0 });
      expect(getMarkFillRows(3, 38, 570, 570)).toEqual({ y: 3, rows: 35 });
      expect(getMarkFillRows(3, 38, 285, 570)).toEqual({ y: 20, rows: 18 });
      // Every icon: the same share lights the same part of its drawing, never past it, and nothing for a tiny share
      for (const [top, bottom] of [
        [1, 39],
        [3, 38],
        [11, 29],
        [0, 40],
      ]) {
        for (let count = 0; count <= 570; count += 7) {
          const { y, rows } = getMarkFillRows(top, bottom, count, 570);
          expect(y).toBeGreaterThanOrEqual(top);
          expect(y + rows).toBe(bottom);
          expect(rows).toBe(Math.round(((bottom - top) * count) / 570));
        }
        expect(getMarkFillRows(top, bottom, 1, 570).rows).toBe(0);
      }
    });

    it("leaves the bright part of an icon hidden when it lights nothing", async () => {
      await game.runToTitle();
      game.scene.gameData.starterData[SpeciesId.BULBASAUR].marks = [PokemonMark.STORMY_MARK];
      const handler = game.scene.ui.handlers[UiMode.MARK_DEX] as MarkDexUiHandler;
      handler["readCollection"]();
      handler["updateMarkCells"]();
      const cells: { mark: PokemonMark; obtained: boolean; filled: boolean }[] = handler["listedCells"];
      const stormy = cells.find(cell => cell.mark === PokemonMark.STORMY_MARK)!;
      expect(stormy.obtained).toBe(true);
      expect(stormy.filled).toBe(false);
    });
  });

  describe("5. the Pokédex page's mark tray", () => {
    const sevenAndFive: PokemonMark[] = [...LISTED_POKEMON_MARKS.slice(0, 7), ...COMPLETION_EXEMPT_MARKS.slice(0, 5)];

    it("counts the listed marks and the hidden ones apart", () => {
      expect(countListedAndHiddenMarks(sevenAndFive)).toEqual({ listed: 7, hidden: 5 });
      expect(getMarkCountText(sevenAndFive)).toBe("Marks 7/69 · Hidden 5");
      expect(getMarkCountText(LISTED_POKEMON_MARKS.slice(0, 7))).toBe("Marks 7/69");
      expect(getMarkCountText([])).toBe("Marks 0/69");
      // Every listed mark and every hidden one
      expect(getMarkCountText(orderedPokemonMarks)).toBe(`Marks 69/69 · Hidden ${COMPLETION_EXEMPT_MARKS.length}`);
    });

    it("shows it in the tray's header, on one line", async () => {
      await game.runToTitle();
      const tray = game.scene.ui.handlers[UiMode.POKEDEX_PAGE]["markContainer"] as MarkTray;
      tray.open({ owned: sevenAndFive, complete: false, alphaBoost: 0, equipped: null, setEquipped: () => {} });
      const header: string = tray["headerText"].text;
      expect(header).toBe("Marks 7/69 · Hidden 5");
      expect(header).not.toContain("\n");
    });

    it("words it the same way in Korean", () => {
      const ko = JSON.parse(
        fs.readFileSync(path.join(getAppRootDir(), "locales", "ko", "pokemon-marks.json"), "utf-8"),
      );
      expect(ko.count).toBe("증표 {{count}}/{{total}}");
      expect(ko.hiddenCount).toBe("히든 {{count}}");
      expect(ko.dex.kinds).toBe("종류 {{count}}/{{total}}");
      expect(ko.dex.hidden).toBe("히든 {{count}}/{{total}}");
    });
  });

  it("6. words the Pokédex page's IV key hint like the others", () => {
    for (const lang of ["ko", "en"]) {
      const hints = JSON.parse(
        fs.readFileSync(path.join(getAppRootDir(), "locales", lang, "pokedex-ui-handler.json"), "utf-8"),
      );
      for (const key of ["toggleIVs", "cycleGender", "candyUpgrade"]) {
        expect(hints[key], `${lang} ${key}`).toMatch(/^: \S/);
      }
    }
  });
});
