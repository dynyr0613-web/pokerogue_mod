// Local fork (2026-11-20): Q11, "전부 뽑기" in the egg gacha (the user: "실행"; the official request #5768): all the
// vouchers of the chosen kind, pulled as the menu would one pull at a time (for regular vouchers the 10-pull, then
// single pulls) while the Eggs fit under the limit of 99, in batches of up to 25 Eggs with a summary each

import { Tutorial } from "#app/tutorial";
import type { Egg } from "#data/egg";
import { Button } from "#enums/buttons";
import { EggTier } from "#enums/egg-type";
import { UiMode } from "#enums/ui-mode";
import { VoucherType } from "#enums/voucher-type";
import { getVoucherTypeName } from "#system/voucher";
import { GameManager } from "#test/framework/game-manager";
import { EggGachaUiHandler, PULL_ALL_BATCH_EGGS } from "#ui/egg-gacha-ui-handler";
import type { OptionSelectUiHandler } from "#ui/option-select-ui-handler";
import { getEnumValues } from "#utils/enums";
import { readFileSync } from "node:fs";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const WAIT = { timeout: 15_000, interval: 10 };

/** The Eggs one voucher of each kind gives on its menu row */
const EGGS_PER_VOUCHER: Record<VoucherType, number> = {
  [VoucherType.REGULAR]: 1,
  [VoucherType.PLUS]: 5,
  [VoucherType.PREMIUM]: 10,
  [VoucherType.GOLDEN]: 25,
};

describe("Local fork - Q11, 전부 뽑기 in the egg gacha (2026-11-20)", () => {
  describe("the plan", () => {
    const plan = EggGachaUiHandler.planPullAll;

    it("pulls regular vouchers by 10 first, then one by one, in batches of up to 25 Eggs", () => {
      expect(plan(VoucherType.REGULAR, 37, 99)).toEqual({
        batches: [
          { vouchers: 20, pulls: [10, 10] },
          { vouchers: 17, pulls: [10, 1, 1, 1, 1, 1, 1, 1] },
        ],
        vouchersLeft: 0,
      });
      expect(plan(VoucherType.PLUS, 12, 99)).toEqual({
        batches: [
          { vouchers: 5, pulls: [5, 5, 5, 5, 5] },
          { vouchers: 5, pulls: [5, 5, 5, 5, 5] },
          { vouchers: 2, pulls: [5, 5] },
        ],
        vouchersLeft: 0,
      });
    });

    it("stops at the Egg limit, leaving the vouchers that would not fit", () => {
      expect(plan(VoucherType.REGULAR, 37, 15)).toEqual({
        batches: [{ vouchers: 15, pulls: [10, 1, 1, 1, 1, 1] }],
        vouchersLeft: 22,
      });
      expect(plan(VoucherType.PREMIUM, 3, 25)).toEqual({
        batches: [{ vouchers: 2, pulls: [10, 10] }],
        vouchersLeft: 1,
      });
      expect(plan(VoucherType.GOLDEN, 2, 30)).toEqual({ batches: [{ vouchers: 1, pulls: [25] }], vouchersLeft: 1 });
      expect(plan(VoucherType.GOLDEN, 2, 24)).toEqual({ batches: [], vouchersLeft: 2 });
      expect(plan(VoucherType.REGULAR, 0, 99)).toEqual({ batches: [], vouchersLeft: 0 });
    });

    /** Checks the plan for `vouchers` vouchers of `type` and room for `room` Eggs */
    function checkPlan(type: VoucherType, vouchers: number, room: number): void {
      const { batches, vouchersLeft } = plan(type, vouchers, room);
      const batchEggs = batches.map(b => b.pulls.reduce((e, p) => e + p, 0));
      const used = batches.reduce((n, b) => n + b.vouchers, 0);
      const eggs = batchEggs.reduce((n, e) => n + e, 0);
      expect(used + vouchersLeft).toBe(vouchers);
      expect(eggs).toBe(used * EGGS_PER_VOUCHER[type]);
      expect(eggs).toBeLessThanOrEqual(room);
      // Nothing more fits: no voucher left, or not enough room for its smallest pull
      expect(vouchersLeft === 0 || room - eggs < EGGS_PER_VOUCHER[type]).toBe(true);
      expect(batchEggs.every(e => e <= PULL_ALL_BATCH_EGGS)).toBe(true);
    }

    it("never goes over the room or 25 Eggs a batch, and gives each voucher its menu row's Eggs", () => {
      for (const type of getEnumValues(VoucherType)) {
        for (let vouchers = 0; vouchers <= 60; vouchers += 7) {
          for (let room = 0; room <= 99; room += 11) {
            checkPlan(type, vouchers, room);
          }
        }
      }
    });
  });

  describe("on the gacha screen", () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(async () => {
      game = new GameManager(phaserGame);
      await game.runToTitle();
      game.scene.gameData.saveTutorialFlag(Tutorial.EGG_GACHA, true);
      game.scene.gameData.eggs.splice(0);
      for (const type of getEnumValues(VoucherType)) {
        game.scene.gameData.voucherCounts[type] = 0;
      }
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    const ui = () => game.scene.ui;
    const optionHandler = () => ui().handlers[UiMode.OPTION_SELECT] as OptionSelectUiHandler;
    const optionLabels = () => (optionHandler()["options"] as { label: string }[]).map(o => o.label);
    const vouchers = () => game.scene.gameData.voucherCounts;

    /** Opens the gacha, with its pulls recorded instead of played */
    async function openGacha(): Promise<{ handler: EggGachaUiHandler; pulls: (readonly number[] | undefined)[] }> {
      await ui().setOverlayMode(UiMode.EGG_GACHA);
      const handler = ui().getHandler() as EggGachaUiHandler;
      expect(handler).toBeInstanceOf(EggGachaUiHandler);
      await vi.waitFor(() => expect(handler["transitioning"]).toBe(false), WAIT);
      const pulls: (readonly number[] | undefined)[] = [];
      vi.spyOn(handler, "pull").mockImplementation(async (_count, batch) => {
        pulls.push(batch);
      });
      return { handler, pulls };
    }

    /** "전부 뽑기", then the voucher in row `index` of the list (checked to be `labels`) */
    async function pullAll(handler: EggGachaUiHandler, labels: string[], index: number): Promise<void> {
      handler.setCursor(5);
      expect(handler.processInput(Button.ACTION)).toBe(true);
      await vi.waitFor(() => {
        expect(ui().mode).toBe(UiMode.OPTION_SELECT);
        expect(optionLabels()).toEqual(labels);
      }, WAIT);
      for (let n = 0; n < index; n++) {
        optionHandler().processInput(Button.DOWN);
      }
      optionHandler().processInput(Button.ACTION);
    }

    /** The messages the gacha shows as errors (each one shown for 1.5 s, too short to poll in the test clock) */
    const spyErrors = (handler: EggGachaUiHandler) => vi.spyOn(handler, "showError");

    const label = (type: VoucherType) => `${getVoucherTypeName(type)} x${vouchers()[type]}`;

    it("has the row above Cancel, the cursor going down to Cancel and no further", async () => {
      const { handler } = await openGacha();
      handler.setCursor(4);
      handler.processInput(Button.DOWN);
      expect(handler.getCursor()).toBe(5);
      handler.processInput(Button.DOWN);
      expect(handler.getCursor()).toBe(6);
      handler.processInput(Button.DOWN);
      expect(handler.getCursor()).toBe(6);
      // Cancel still closes the gacha
      expect(handler.processInput(Button.ACTION)).toBe(true);
      await vi.waitFor(() => expect(ui().mode).toBe(UiMode.TITLE), WAIT);
    });

    it("lists the vouchers the player has, and pulls the chosen ones batch after batch", async () => {
      vouchers()[VoucherType.REGULAR] = 13;
      vouchers()[VoucherType.PREMIUM] = 3;
      const { handler, pulls } = await openGacha();

      await pullAll(handler, [label(VoucherType.REGULAR), label(VoucherType.PREMIUM), i18next.t("menu:cancel")], 1);
      await vi.waitFor(() => expect(pulls).toHaveLength(1), WAIT);
      expect(ui().mode).toBe(UiMode.EGG_GACHA);
      expect(pulls[0]).toEqual([10, 10]);
      expect(vouchers()[VoucherType.PREMIUM]).toBe(1);
      expect(vouchers()[VoucherType.REGULAR]).toBe(13);

      // Closing the summary starts the next batch
      handler.hideSummary();
      await vi.waitFor(() => expect(pulls).toHaveLength(2), WAIT);
      expect(pulls[1]).toEqual([10]);
      expect(vouchers()[VoucherType.PREMIUM]).toBe(0);
      handler.hideSummary();
      await vi.waitFor(() => expect(handler["transitioning"]).toBe(false), WAIT);
      expect(pulls).toHaveLength(2);

      // The regular vouchers: one 10-pull and 3 single pulls, one batch
      await pullAll(handler, [label(VoucherType.REGULAR), i18next.t("menu:cancel")], 0);
      await vi.waitFor(() => expect(pulls).toHaveLength(3), WAIT);
      expect(pulls[2]).toEqual([10, 1, 1, 1]);
      expect(vouchers()[VoucherType.REGULAR]).toBe(0);
    });

    it("stops at the Egg limit and says how many vouchers are left", async () => {
      game.scene.gameData.eggs.push(...Array.from({ length: 79 }, () => ({}) as Egg));
      vouchers()[VoucherType.REGULAR] = 37;
      const { handler, pulls } = await openGacha();

      await pullAll(handler, [label(VoucherType.REGULAR), i18next.t("menu:cancel")], 0);
      await vi.waitFor(() => expect(pulls).toHaveLength(1), WAIT);
      expect(pulls[0]).toEqual([10, 10]);
      expect(vouchers()[VoucherType.REGULAR]).toBe(17);
      const errors = spyErrors(handler);
      handler.hideSummary();
      const notice = i18next.t("egg:pullAllStoppedAtLimit", { amount: 17 });
      await vi.waitFor(() => expect(errors).toHaveBeenCalledWith(notice), WAIT);
      expect(pulls).toHaveLength(1);
    });

    it("pulls nothing with no room or no vouchers", async () => {
      game.scene.gameData.eggs.push(...Array.from({ length: 90 }, () => ({}) as Egg));
      vouchers()[VoucherType.PREMIUM] = 2;
      const { handler, pulls } = await openGacha();
      const errors = spyErrors(handler);
      await pullAll(handler, [label(VoucherType.PREMIUM), i18next.t("menu:cancel")], 0);
      await vi.waitFor(() => expect(errors).toHaveBeenCalledWith(i18next.t("egg:tooManyEggs")), WAIT);
      expect(pulls).toHaveLength(0);
      expect(vouchers()[VoucherType.PREMIUM]).toBe(2);

      vouchers()[VoucherType.PREMIUM] = 0;
      handler.setCursor(5);
      expect(handler.processInput(Button.ACTION)).toBe(true); // the error sound: handled
      expect(errors).toHaveBeenLastCalledWith(i18next.t("egg:noVouchers"));
      expect(ui().mode).toBe(UiMode.EGG_GACHA);
    });

    it("makes each pull of a batch on its own, the 10-pull with its guaranteed Rare Egg", async () => {
      await ui().setOverlayMode(UiMode.EGG_GACHA);
      const handler = ui().getHandler() as EggGachaUiHandler;
      vi.spyOn(handler as unknown as { doPullAnim: () => Promise<void> }, "doPullAnim").mockResolvedValue();
      vi.spyOn(handler, "showSummary").mockImplementation(() => {});
      vi.spyOn(game.scene.gameData, "saveSystem").mockResolvedValue(true);

      await handler.pull(0, [10, 1, 1]);
      const eggs = game.scene.gameData.eggs;
      expect(eggs).toHaveLength(12);
      expect(eggs.slice(0, 10).some(egg => egg.tier >= EggTier.RARE)).toBe(true);
    });
  });

  it("has the new texts in Korean and English", () => {
    for (const lang of ["ko", "en"]) {
      const json = JSON.parse(readFileSync(`./locales/${lang}/egg.json`, "utf8")) as Record<string, string>;
      for (const key of ["pullAll", "pullAllChooseVoucher", "pullAllStoppedAtLimit"]) {
        expect(json[key], `${lang} ${key}`).toBeTruthy();
      }
      expect(json.pullAllStoppedAtLimit).toContain("{{amount}}");
    }
  });
});
