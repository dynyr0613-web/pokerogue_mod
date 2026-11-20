// Local fork (2026-11-20): up to 999 Eggs, and the egg list in pages of 99 (the user: "알 최대 갯수를 늘리고 알 목록 창에서
// 옆으로 넘기기 가 가능하게 하죠, 1/99 페이지 이런 식으로 보이도록"; the main session chose 999). The gacha (each pull and
// "전부 뽑기") and the candy Eggs check the shared cap; LEFT and RIGHT go across the pages of the egg list, which shows
// "1/11 페이지"; many Eggs hatching on one wave fill the hatch summary, which scrolls; the save stays small.

import { settings } from "#app/global-settings-manager";
import { Tutorial } from "#app/tutorial";
import { EGG_LIMIT } from "#constants/egg-limit";
import { Egg } from "#data/egg";
import { AbilityId } from "#enums/ability-id";
import { Button } from "#enums/buttons";
import { EggSkipPreference } from "#enums/egg-skip-preference";
import { EggSourceType } from "#enums/egg-source-types";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { VoucherType } from "#enums/voucher-type";
import { getVoucherTypeName } from "#system/voucher";
import { GameManager } from "#test/framework/game-manager";
import { EggGachaUiHandler } from "#ui/egg-gacha-ui-handler";
import {
  EGG_LIST_PAGE_SIZE,
  type EggListPosition,
  EggListUiHandler,
  getEggListPageCount,
  moveEggListCursor,
} from "#ui/egg-list-ui-handler";
import type { EggSummaryUiHandler } from "#ui/egg-summary-ui-handler";
import type { OptionSelectUiHandler } from "#ui/option-select-ui-handler";
import { encrypt } from "#utils/data";
import { getEnumValues } from "#utils/enums";
import { readFileSync } from "node:fs";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const WAIT = { timeout: 15_000, interval: 10 };

/** `count` Eggs of Bulbasaur and Charmander, in turn */
function makeEggs(count: number): Egg[] {
  return Array.from(
    { length: count },
    (_, i) =>
      new Egg({
        id: i + 1,
        species: i % 2 === 0 ? SpeciesId.BULBASAUR : SpeciesId.CHARMANDER,
        hatchWaves: 1,
        sourceType: EggSourceType.GACHA_MOVE,
      }),
  );
}

describe("Local fork - 999 Eggs and the egg list pages (2026-11-20)", () => {
  describe("the egg list pages", () => {
    const at = (page: number, cursor: number): EggListPosition => ({ page, cursor });
    const move = moveEggListCursor;

    it("has 99 Eggs a page, and at least one page", () => {
      expect(EGG_LIST_PAGE_SIZE).toBe(99);
      expect([0, 1, 99, 100, 198, 199, 250, 999].map(getEggListPageCount)).toEqual([1, 1, 1, 2, 2, 3, 3, 11]);
    });

    it("goes to the next page with RIGHT on the last column, and back with LEFT on the first, keeping the row", () => {
      // 250 Eggs: pages of 99, 99 and 52
      expect(move(Button.RIGHT, at(0, 10), 250)).toEqual(at(1, 0));
      expect(move(Button.RIGHT, at(0, 32), 250)).toEqual(at(1, 22));
      expect(move(Button.LEFT, at(1, 22), 250)).toEqual(at(0, 32));
      expect(move(Button.LEFT, at(1, 0), 250)).toEqual(at(0, 10));
      expect(move(Button.RIGHT, at(1, 32), 250)).toEqual(at(2, 22));
      // Within a row, as before
      expect(move(Button.RIGHT, at(0, 5), 250)).toEqual(at(0, 6));
      expect(move(Button.LEFT, at(0, 6), 250)).toEqual(at(0, 5));
    });

    it("wraps around from the first page to the last and back", () => {
      expect(move(Button.LEFT, at(0, 0), 250)).toEqual(at(2, 10));
      expect(move(Button.RIGHT, at(2, 10), 250)).toEqual(at(0, 0));
      // 999 Eggs: 10 full pages and an eleventh of 9
      expect(move(Button.LEFT, at(0, 0), 999)).toEqual(at(10, 8));
      expect(move(Button.RIGHT, at(10, 8), 999)).toEqual(at(0, 0));
      expect(move(Button.LEFT, at(9, 11), 999)).toEqual(at(8, 21));
      expect(move(Button.RIGHT, at(9, 21), 999)).toEqual(at(10, 8));
    });

    it("takes the last Egg when the slot is empty on a short last page", () => {
      // The third page has 52 Eggs: rows 0 to 4, the last Egg at 51 (row 4, column 7)
      expect(move(Button.LEFT, at(0, 88), 250)).toEqual(at(2, 51));
      expect(move(Button.RIGHT, at(1, 87), 250)).toEqual(at(2, 51));
      // RIGHT on the last Egg of a short page goes on to the next page, same row
      expect(move(Button.RIGHT, at(2, 51), 250)).toEqual(at(0, 44));
      // 129 Eggs: the second page has 30 (rows 0 to 2)
      expect(move(Button.RIGHT, at(0, 54), 129)).toEqual(at(1, 29));
      expect(move(Button.LEFT, at(0, 99 - 11), 129)).toEqual(at(1, 29));
    });

    it("moves UP and DOWN within the page, wrapping around it", () => {
      expect(move(Button.DOWN, at(0, 90), 250)).toEqual(at(0, 2));
      expect(move(Button.UP, at(0, 2), 250)).toEqual(at(0, 90));
      expect(move(Button.DOWN, at(1, 5), 250)).toEqual(at(1, 16));
      // The short third page: the last row has 8 Eggs (44 to 51)
      expect(move(Button.DOWN, at(2, 40), 250)).toEqual(at(2, 51));
      expect(move(Button.DOWN, at(2, 41), 250)).toEqual(at(2, 51));
      expect(move(Button.UP, at(2, 9), 250)).toEqual(at(2, 42));
      expect(move(Button.UP, at(2, 7), 250)).toEqual(at(2, 51));
      expect(move(Button.DOWN, at(2, 51), 250)).toEqual(at(2, 7));
    });

    it("works as the old grid with one page", () => {
      expect(move(Button.LEFT, at(0, 0), 30)).toEqual(at(0, 10));
      expect(move(Button.RIGHT, at(0, 10), 30)).toEqual(at(0, 0));
      expect(move(Button.LEFT, at(0, 22), 30)).toEqual(at(0, 29));
      expect(move(Button.RIGHT, at(0, 29), 30)).toEqual(at(0, 22));
      for (const button of [Button.UP, Button.DOWN, Button.LEFT, Button.RIGHT]) {
        expect(move(button, at(0, 0), 1)).toEqual(at(0, 0));
      }
      expect(move(Button.ACTION, at(0, 3), 30)).toEqual(at(0, 3));
    });

    // Local fork (2026-11-20, review): every move lands on an Egg, UP and DOWN keep the page, and every Egg is reached
    it("always lands on an Egg and reaches every Egg, whatever the count", () => {
      const buttons = [Button.UP, Button.DOWN, Button.LEFT, Button.RIGHT];
      for (let total = 1; total <= 450; total++) {
        const pages = getEggListPageCount(total);
        const onPage = (page: number) => Math.min(EGG_LIST_PAGE_SIZE, total - page * EGG_LIST_PAGE_SIZE);
        for (let page = 0; page < pages; page++) {
          for (let cursor = 0; cursor < onPage(page); cursor++) {
            for (const button of buttons) {
              const to = move(button, at(page, cursor), total);
              const label = `${total} Eggs, ${page}:${cursor}, ${Button[button]}`;
              expect(to.page >= 0 && to.page < pages && to.cursor >= 0 && to.cursor < onPage(to.page), label).toBe(
                true,
              );
              if (button === Button.UP || button === Button.DOWN) {
                expect(to.page, label).toBe(page);
              }
            }
          }
        }
      }
      for (const total of [1, 50, 99, 100, 129, 250, EGG_LIMIT, EGG_LIMIT + 6]) {
        const seen = new Set<string>();
        const queue = [at(0, 0)];
        while (queue.length > 0) {
          const position = queue.pop() as EggListPosition;
          const key = `${position.page}:${position.cursor}`;
          if (!seen.has(key)) {
            seen.add(key);
            queue.push(...buttons.map(button => move(button, position, total)));
          }
        }
        expect(seen.size, `${total} Eggs`).toBe(total);
      }
    });
  });

  describe("on screen", () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(async () => {
      game = new GameManager(phaserGame);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    describe("the egg list", () => {
      beforeEach(async () => {
        await game.runToTitle();
      });

      /** Opens the egg list with `count` Eggs, recording the Eggs whose details are shown */
      async function openList(count: number) {
        game.scene.gameData.eggs = makeEggs(count);
        const handler = game.scene.ui.handlers[UiMode.EGG_LIST] as EggListUiHandler;
        expect(handler).toBeInstanceOf(EggListUiHandler);
        const details = vi.spyOn(handler as unknown as { setEggDetails(index: number): void }, "setEggDetails");
        await game.scene.ui.setOverlayMode(UiMode.EGG_LIST);
        expect(game.scene.ui.getHandler()).toBe(handler);
        const pageText = () => (handler["pageText"] as unknown as { text: string }).text;
        const visibleIcons = () =>
          handler["eggIcons"].filter(
            icon => (icon as unknown as { phaserSprite: { visible: boolean } }).phaserSprite.visible,
          ).length;
        const shownEgg = () => details.mock.lastCall?.[0];
        return { handler, pageText, visibleIcons, shownEgg };
      }

      const pageLabel = (page: number, pages: number) => i18next.t("egg:listPage", { page, pages });

      it("shows the page and turns the pages with LEFT and RIGHT, the details following the cursor", async () => {
        const { handler, pageText, visibleIcons, shownEgg } = await openList(250);
        expect(pageText()).toBe(pageLabel(1, 3));
        expect(handler.getPage()).toBe(0);
        expect(visibleIcons()).toBe(99);
        expect(shownEgg()).toBe(0);

        // LEFT on the first column: the last page, same row, last column
        expect(handler.processInput(Button.LEFT)).toBe(true);
        expect(handler.getPage()).toBe(2);
        expect(handler.getCursor()).toBe(10);
        expect(pageText()).toBe(pageLabel(3, 3));
        expect(visibleIcons()).toBe(52);
        expect(shownEgg()).toBe(2 * 99 + 10);

        // RIGHT on the last column: back to the first page
        expect(handler.processInput(Button.RIGHT)).toBe(true);
        expect(handler.getPage()).toBe(0);
        expect(handler.getCursor()).toBe(0);
        expect(pageText()).toBe(pageLabel(1, 3));
        expect(visibleIcons()).toBe(99);
        expect(shownEgg()).toBe(0);

        // Across to the second page along the top row
        for (let n = 0; n < 11; n++) {
          handler.processInput(Button.RIGHT);
        }
        expect(handler.getPage()).toBe(1);
        expect(handler.getCursor()).toBe(0);
        expect(pageText()).toBe(pageLabel(2, 3));
        expect(shownEgg()).toBe(99);
      });

      it("shows the details of the Egg in the same slot of another page", async () => {
        // 100 Eggs: the second page has one, in slot 0, which LEFT and RIGHT reach from slot 0 of the first
        const { handler, pageText, visibleIcons, shownEgg } = await openList(100);
        expect(handler.processInput(Button.LEFT)).toBe(true);
        expect(handler.getPage()).toBe(1);
        expect(handler.getCursor()).toBe(0);
        expect(shownEgg()).toBe(99);
        expect(visibleIcons()).toBe(1);
        expect(pageText()).toBe(pageLabel(2, 2));
        expect(handler.processInput(Button.RIGHT)).toBe(true);
        expect(handler.getPage()).toBe(0);
        expect(shownEgg()).toBe(0);
      });

      it("shows 1/1 with one page, and starts on the first page when opened again", async () => {
        const { handler, pageText } = await openList(30);
        expect(pageText()).toBe(pageLabel(1, 1));
        handler.processInput(Button.CANCEL);
        await vi.waitFor(() => expect(game.scene.ui.mode).toBe(UiMode.TITLE), WAIT);

        const again = await openList(EGG_LIMIT);
        expect(again.pageText()).toBe(pageLabel(1, 11));
        again.handler.processInput(Button.LEFT);
        expect(again.handler.getPage()).toBe(10);
        expect(again.pageText()).toBe(pageLabel(11, 11));
        // The eleventh page has the last 9 Eggs (999 = 10 x 99 + 9): the slot of the last column is empty
        expect(again.visibleIcons()).toBe(9);
        expect(again.handler.getCursor()).toBe(8);
        expect(again.shownEgg()).toBe(EGG_LIMIT - 1);
        again.handler.processInput(Button.CANCEL);
        await vi.waitFor(() => expect(game.scene.ui.mode).toBe(UiMode.TITLE), WAIT);
        const third = await openList(150);
        expect(third.handler.getPage()).toBe(0);
        expect(third.pageText()).toBe(pageLabel(1, 2));
      });
    });

    describe("the gacha", () => {
      const ui = () => game.scene.ui;
      const vouchers = () => game.scene.gameData.voucherCounts;
      const optionHandler = () => ui().handlers[UiMode.OPTION_SELECT] as OptionSelectUiHandler;

      beforeEach(async () => {
        await game.runToTitle();
        game.scene.gameData.saveTutorialFlag(Tutorial.EGG_GACHA, true);
        for (const type of getEnumValues(VoucherType)) {
          vouchers()[type] = 0;
        }
      });

      /** Opens the gacha holding `eggs` Eggs, its pulls recorded instead of played */
      async function openGacha(eggs: number) {
        game.scene.gameData.eggs = Array.from({ length: eggs }, () => ({}) as Egg);
        await ui().setOverlayMode(UiMode.EGG_GACHA);
        const handler = ui().getHandler() as EggGachaUiHandler;
        expect(handler).toBeInstanceOf(EggGachaUiHandler);
        await vi.waitFor(() => expect(handler["transitioning"]).toBe(false), WAIT);
        const pulls: (number | readonly number[])[] = [];
        vi.spyOn(handler, "pull").mockImplementation(async (count = 0, batch) => {
          pulls.push(batch ?? count);
        });
        const errors = vi.spyOn(handler, "showError");
        return { handler, pulls, errors };
      }

      it("lets a pull fill the Eggs up to 999, and no further", async () => {
        vouchers()[VoucherType.REGULAR] = 20;
        const { handler, pulls, errors } = await openGacha(EGG_LIMIT - 10);
        handler.setCursor(1); // the 10-pull
        expect(handler.processInput(Button.ACTION)).toBe(true);
        expect(pulls).toEqual([10]);
        expect(vouchers()[VoucherType.REGULAR]).toBe(10);

        game.scene.gameData.eggs.push(...Array.from({ length: 10 }, () => ({}) as Egg));
        handler.setCursor(0); // a single pull
        handler.processInput(Button.ACTION);
        expect(errors).toHaveBeenLastCalledWith(i18next.t("egg:tooManyEggs"));
        expect(pulls).toEqual([10]);
        expect(vouchers()[VoucherType.REGULAR]).toBe(10);
      });

      it("stops a pull-all at 999 Eggs and names the limit", async () => {
        vouchers()[VoucherType.REGULAR] = 37;
        const { handler, pulls, errors } = await openGacha(EGG_LIMIT - 20);
        handler.setCursor(5);
        expect(handler.processInput(Button.ACTION)).toBe(true);
        await vi.waitFor(() => {
          expect(ui().mode).toBe(UiMode.OPTION_SELECT);
          expect((optionHandler()["options"] as { label: string }[]).map(o => o.label)).toEqual([
            `${getVoucherTypeName(VoucherType.REGULAR)} x37`,
            i18next.t("menu:cancel"),
          ]);
        }, WAIT);
        optionHandler().processInput(Button.ACTION);
        await vi.waitFor(() => expect(pulls).toHaveLength(1), WAIT);
        expect(pulls[0]).toEqual([10, 10]);
        expect(vouchers()[VoucherType.REGULAR]).toBe(17);
        handler.hideSummary();
        const notice = i18next.t("egg:pullAllStoppedAtLimit", { amount: 17, limit: EGG_LIMIT });
        expect(notice).toContain("999");
        await vi.waitFor(() => expect(errors).toHaveBeenCalledWith(notice), WAIT);
        expect(pulls).toHaveLength(1);
      });

      it("pulls nothing at 999 Eggs", async () => {
        vouchers()[VoucherType.GOLDEN] = 1;
        const { handler, pulls, errors } = await openGacha(EGG_LIMIT);
        handler.setCursor(5);
        expect(handler.processInput(Button.ACTION)).toBe(true);
        expect(errors).toHaveBeenLastCalledWith(i18next.t("egg:tooManyEggs"));
        expect(ui().mode).toBe(UiMode.EGG_GACHA);
        expect(pulls).toHaveLength(0);
      });
    });

    describe("a big hatch", () => {
      beforeEach(() => {
        game.override
          .moveset([MoveId.FISSURE, MoveId.SPLASH])
          .ability(AbilityId.NO_GUARD)
          .startingLevel(200)
          .enemySpecies(SpeciesId.MAGIKARP)
          .battleStyle("single");
      });

      it("hatches 320 Eggs on one wave into a summary that scrolls to the last of them", async () => {
        settings.update("general", "eggSkipPreference", EggSkipPreference.ALWAYS);
        await game.classicMode.startBattle(SpeciesId.ABRA);
        game.scene.gameData.eggs = makeEggs(320);

        game.move.select(MoveId.FISSURE);
        let checked = false;
        game.onNextPrompt("EggSummaryPhase", UiMode.EGG_HATCH_SUMMARY, async () => {
          const handler = game.scene.ui.getHandler() as EggSummaryUiHandler;
          const hatched = handler["eggHatchData"];
          expect(hatched).toHaveLength(320);
          // One screen of icons (9 rows of 11), the rest reached by scrolling
          expect(handler["pokemonContainers"].length).toBeLessThanOrEqual(99);
          const shown = vi.spyOn(handler["infoContainer"], "showHatchInfo");
          handler.processInput(Button.UP); // wraps around to the bottom row: the last Pokémon
          expect(handler["scrollGridHandler"].getItemOffset()).toBe((Math.ceil(320 / 11) - 9) * 11);
          expect(shown).toHaveBeenLastCalledWith(hatched[319]);
          checked = true;
          await vi.waitUntil(() => !handler["blockExit"]);
          game.scene.ui.processInput(Button.CANCEL);
        });
        await game.phaseInterceptor.to("SelectModifierPhase");
        await vi.waitUntil(() => game.scene.ui.mode === UiMode.MODIFIER_SELECT);

        expect(checked).toBe(true);
        expect(game.scene.gameData.eggs).toHaveLength(0);
        expect(game).toBeAtPhase("SelectModifierPhase");
      }, 120_000);
    });

    describe("the save", () => {
      it("holds 999 Eggs well under the browser's storage limit", async () => {
        await game.runToTitle();
        const gameData = game.scene.gameData;
        gameData.eggs = Array.from({ length: EGG_LIMIT }, () => new Egg({ sourceType: EggSourceType.GACHA_MOVE }));
        // As saveSystem() turns it into JSON
        const toJson = () =>
          JSON.stringify(gameData.getSystemSaveData(), (_k, v) => {
            if (typeof v !== "bigint") {
              return v;
            }
            return v <= 0x80000000 ? Number(v) : v.toString();
          });
        const json = toJson();
        gameData.eggs = [];
        const emptyJson = toJson();
        // As saveSystem() stores it: the app (no login) keeps btoa(encodeURIComponent(json)), the web AES
        const sizes = {
          json: json.length,
          app: encrypt(json, true).length,
          web: encrypt(json, false).length,
          emptyApp: encrypt(emptyJson, true).length,
        };
        if (process.env.EGG_SAVE_SIZE_REPORT) {
          process.stdout.write(`egg save sizes: ${JSON.stringify(sizes)}\n`);
        }
        // 999 Eggs add well under 0.5 MB to the stored save (localStorage holds about 5 MB per origin)
        expect(sizes.app - sizes.emptyApp).toBeLessThan(500_000);
        expect(sizes.app).toBeLessThan(2_000_000);
      });
    });
  });

  describe("the shared cap", () => {
    it("is 999, checked by the gacha and the candy Eggs of the starter select and the Pokédex", () => {
      expect(EGG_LIMIT).toBe(999);
      for (const file of ["egg-gacha-ui-handler", "starter-select-ui-handler", "pokedex-page-ui-handler"]) {
        const source = readFileSync(`./src/ui/handlers/${file}.ts`, "utf8");
        expect(source, file).toContain('import { EGG_LIMIT } from "#constants/egg-limit";');
        expect(source, file).not.toMatch(/eggs\.length\s*(\+\s*\w+\s*)?>=?\s*99\b/);
        expect(source, file).not.toMatch(/EGG_LIMIT\s*=\s*99\b/);
      }
      for (const file of ["starter-select-ui-handler", "pokedex-page-ui-handler"]) {
        const source = readFileSync(`./src/ui/handlers/${file}.ts`, "utf8");
        expect(source, file).toContain("eggs.length >= EGG_LIMIT && !activeOverrides.UNLIMITED_EGG_COUNT_OVERRIDE");
      }
    });

    it("has the texts in Korean and English", () => {
      for (const lang of ["ko", "en"]) {
        const json = JSON.parse(readFileSync(`./locales/${lang}/egg.json`, "utf8")) as Record<string, string>;
        expect(json.pullAllStoppedAtLimit, lang).toContain("{{limit}}");
        expect(json.pullAllStoppedAtLimit, lang).not.toContain("99");
        expect(json.listPage, lang).toContain("{{page}}/{{pages}}");
      }
      const ko = JSON.parse(readFileSync("./locales/ko/egg.json", "utf8")) as Record<string, string>;
      expect(ko.listPage).toBe("{{page}}/{{pages}} 페이지");
    });
  });
});
