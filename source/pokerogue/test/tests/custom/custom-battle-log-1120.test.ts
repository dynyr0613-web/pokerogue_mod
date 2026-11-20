// Local fork (2026-11-20): the battle log, Q6 of docs/유저_요청_요소_목록_20261120.md (the user: "Q6 - 실행"):
// - every battle message the message box shows goes into a ring buffer of the last BATTLE_LOG_SIZE messages, with its
//   wave and turn (the turn's leftovers after the counter went up still count for the turn that ended); not saved;
// - the command prompt, the shop's descriptions (other modes) and anything outside a run are left out;
// - the menu has a "전투 기록" entry that opens a list screen: Up / Down a line, Left / Right a page, A to the newest
//   lines or back to the oldest, B back to the menu; the touch panel has the same moves as buttons.

import { TouchChoicePanel } from "#app/touch-choices";
import { Button } from "#enums/buttons";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import { TextInterceptor } from "#test/framework/text-interceptor";
import {
  BATTLE_LOG_SIZE,
  BattleLog,
  type BattleLogEntry,
  battleLog,
  buildBattleLogLines,
  cleanBattleLogText,
  getBattleLogPositionText,
  recordBattleMessage,
  shouldRecordBattleMessage,
} from "#ui/battle-log";
import { BATTLE_LOG_LINE_WIDTH, BATTLE_LOG_ROWS, type BattleLogUiHandler } from "#ui/battle-log-ui-handler";
import type { MenuUiHandler } from "#ui/menu-ui-handler";
import { readFileSync } from "node:fs";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const entry = (wave: number, turn: number, text: string, speaker?: string): BattleLogEntry => ({
  wave,
  turn,
  text,
  speaker,
});

/** One message to a line, as the screen's own wrapping does for short ones */
const oneLine = (text: string) => [text];

describe("Local fork - the battle log (Q6, 2026-11-20)", () => {
  describe("the ring buffer", () => {
    it("keeps the last messages in order, 300 of them in the run's log", () => {
      const log = new BattleLog(5);
      for (let i = 1; i <= 8; i++) {
        log.add(entry(1, 1, `m${i}`));
      }
      expect(log.size).toBe(5);
      expect(log.getEntries().map(e => e.text)).toEqual(["m4", "m5", "m6", "m7", "m8"]);

      expect(BATTLE_LOG_SIZE).toBe(300);
      expect(battleLog.capacity).toBe(BATTLE_LOG_SIZE);
    });

    it("starts over with another run's first message, not with the same run's", () => {
      const log = new BattleLog(10);
      log.add(entry(1, 1, "a"), "seed-a");
      log.add(entry(2, 1, "b"), "seed-a");
      log.add(entry(3, 1, "c"), null);
      expect(log.getEntries().map(e => e.text)).toEqual(["a", "b", "c"]);
      log.add(entry(1, 1, "new run"), "seed-b");
      expect(log.getEntries().map(e => e.text)).toEqual(["new run"]);
      log.clear();
      expect(log.size).toBe(0);
      expect(log.getEntries()).toEqual([]);
    });

    it("starts over when a run with the same seed begins again (the offline daily run), but not for a retried wave", () => {
      // Review (2026-11-20): every offline daily run of a day has the day's date as its seed
      const log = new BattleLog(10);
      log.add(entry(20, 3, "old daily run"), "daily-seed");
      log.add(entry(20, 1, "the same wave, retried"), "daily-seed");
      expect(log.getEntries().map(e => e.text)).toEqual(["old daily run", "the same wave, retried"]);
      log.add(entry(1, 0, "the day's run again"), "daily-seed");
      expect(log.getEntries().map(e => e.text)).toEqual(["the day's run again"]);
      // Full and wrapped around: the newest message's wave still decides
      const small = new BattleLog(3);
      for (let wave = 1; wave <= 5; wave++) {
        small.add(entry(wave, 1, `w${wave}`), "seed");
      }
      small.add(entry(5, 2, "w5 again"), "seed");
      expect(small.getEntries().map(e => e.text)).toEqual(["w4", "w5", "w5 again"]);
      small.add(entry(4, 1, "earlier wave"), "seed");
      expect(small.getEntries().map(e => e.text)).toEqual(["earlier wave"]);
    });

    it("counts a turn's leftovers for the turn that ended, and the encounter for no turn", () => {
      const log = new BattleLog();
      log.noteEncounter();
      expect(log.getLoggedTurn(1)).toBe(0);
      log.noteTurnInit();
      expect(log.getLoggedTurn(1)).toBe(1);
      log.noteTurnEnd();
      // The counter is already 2, the messages still belong to turn 1
      expect(log.getLoggedTurn(2)).toBe(1);
      log.noteTurnInit();
      expect(log.getLoggedTurn(2)).toBe(2);
    });
  });

  describe("the messages as the log keeps them", () => {
    it("drops the message box's codes and colour tags and puts the message on one line", () => {
      expect(cleanBattleLogText("@c{smile}Hello!@d{32} Ready?@s{se/pb_bounce_1}@f{100}")).toBe("Hello! Ready?");
      expect(cleanBattleLogText("효과가 굉장했다!\n상대는 쓰러졌다!")).toBe("효과가 굉장했다! 상대는 쓰러졌다!");
      expect(cleanBattleLogText("[color=#f8f8f8][shadow=#6b5a73]Text[/shadow][/color] @[MONEY]{₽100}")).toBe(
        "Text ₽100",
      );
      expect(cleanBattleLogText("  \n ")).toBe("");
    });

    it("puts a heading where a wave or a turn begins, and a retried wave gets its heading again", () => {
      const lines = buildBattleLogLines(
        [
          entry(5, 0, "A wild Rattata appeared!"),
          entry(5, 1, "Pikachu used Tackle!"),
          entry(5, 1, "It's super effective!"),
          entry(5, 2, "Rattata fainted!"),
          entry(6, 0, "Hi!", "Youngster"),
          entry(6, 1, "Go!"),
          entry(6, 1, "Again!"),
          // the same wave, from its start again
          entry(6, 0, "Retry"),
        ],
        oneLine,
      );
      expect(lines.map(l => `${l.kind}:${l.text}`)).toEqual([
        "wave:Wave 5",
        "message:A wild Rattata appeared!",
        "turn:Turn 1",
        "message:Pikachu used Tackle!",
        "message:It's super effective!",
        "turn:Turn 2",
        "message:Rattata fainted!",
        "wave:Wave 6",
        "message:Youngster: Hi!",
        "turn:Turn 1",
        "message:Go!",
        "message:Again!",
        "wave:Wave 6",
        "message:Retry",
      ]);
      expect(getBattleLogPositionText(lines[3])).toBe("Wave 5 · Turn 1");
      expect(getBattleLogPositionText(lines[1])).toBe("Wave 5");
    });

    it("sets a long message's later lines in", () => {
      const lines = buildBattleLogLines([entry(1, 1, "first second third")], text => text.split(" "));
      expect(lines.filter(l => l.kind === "message").map(l => [l.text, !!l.continued])).toEqual([
        ["first", false],
        ["second", true],
        ["third", true],
      ]);
    });

    it("has its words in both languages", () => {
      const ko = JSON.parse(readFileSync("locales/ko/battle-log.json", "utf-8"));
      const en = JSON.parse(readFileSync("locales/en/battle-log.json", "utf-8"));
      expect([...Object.keys(ko)].sort()).toEqual([...Object.keys(en)].sort());
      expect(ko.title).toBe("전투 기록");
      expect(ko.wave).toBe("웨이브 {{wave}}");
      expect(ko.turn).toBe("{{turn}}턴");
      expect(JSON.parse(readFileSync("locales/ko/menu-ui-handler.json", "utf-8")).battleLog).toBe("전투 기록");
      expect(JSON.parse(readFileSync("locales/en/menu-ui-handler.json", "utf-8")).battleLog).toBe("Battle Log");
    });
  });

  describe("in the game", () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      battleLog.clear();
      game = new GameManager(phaserGame);
      game.override
        .battleStyle("single")
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyMoveset(MoveId.SPLASH)
        .moveset(MoveId.SPLASH)
        .startingLevel(50)
        .enemyLevel(2);
    });

    afterEach(() => {
      battleLog.clear();
    });

    it("keeps what the battle message box shows in a battle, but not the command prompt", async () => {
      await game.classicMode.startBattle(SpeciesId.PIKACHU);
      const { ui } = game.scene;
      const messageHandler = ui.getMessageHandler();

      // The command menu showed "What will Pikachu do?" in the box: not a battle message
      expect(ui.mode).toBe(UiMode.COMMAND);
      expect(battleLog.size).toBe(0);
      messageHandler.showText("Not a battle message", 0);
      expect(battleLog.size).toBe(0);

      await ui.setMode(UiMode.MESSAGE);
      expect(shouldRecordBattleMessage()).toBe(true);
      messageHandler.showText("Pikachu used Splash!\nBut nothing happened!", 0);
      messageHandler.showDialogue("@c{smile}Hello there!", "Rival", 0);
      messageHandler.showText("", 0);
      messageHandler.showText("After the dialogue", 0);

      const wave = game.scene.currentBattle.waveIndex;
      expect(battleLog.getEntries()).toEqual([
        { wave, turn: 1, speaker: undefined, text: "Pikachu used Splash! But nothing happened!" },
        { wave, turn: 1, speaker: "Rival", text: "Hello there!" },
        { wave, turn: 1, speaker: undefined, text: "After the dialogue" },
      ]);
    });

    it("keeps a real battle's messages with their wave and turn, along the game's own path to the box", async () => {
      // Review (2026-11-20): the test UI hands every message to the text log instead of a box (mock-text.ts replaces
      // UI.showText and UI.showDialogue); hand them on to the box the game's UI.showText picks (the screen's own box,
      // else the battle message box), so the path from the battle's phases through the modes to the log runs
      const origShowText = TextInterceptor.prototype.showText;
      const origShowDialogue = TextInterceptor.prototype.showDialogue;
      vi.spyOn(TextInterceptor.prototype, "showText").mockImplementation(function (this: TextInterceptor, text) {
        game.scene.ui.getCurrentMessageHandler().showText(text, 0);
        origShowText.call(this, text);
      });
      vi.spyOn(TextInterceptor.prototype, "showDialogue").mockImplementation(function (
        this: TextInterceptor,
        text,
        name,
      ) {
        game.scene.ui.getCurrentMessageHandler().showDialogue(text, name, 0);
        origShowDialogue.call(this, text, name);
      });

      await game.classicMode.startBattle(SpeciesId.PIKACHU);
      const wave = game.scene.currentBattle.waveIndex;
      // The encounter's messages, before the first command: the wave's, no turn's
      const intro = battleLog.getEntries();
      expect(intro.length).toBeGreaterThan(0);
      expect(intro.every(e => e.wave === wave && e.turn === 0)).toBe(true);
      // ... and not the command prompt shown after them
      expect(intro.map(e => e.text)).not.toContain(
        cleanBattleLogText(i18next.t("commandUiHandler:actionMessage", { pokemonName: "Pikachu" })),
      );

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      const turn1 = battleLog.getEntries().slice(intro.length);
      expect(turn1.length).toBeGreaterThan(0);
      expect(turn1.every(e => e.wave === wave && e.turn === 1)).toBe(true);
      // Both sides' Splash and its "nothing happened"
      expect(turn1.filter(e => e.text.includes("Splash"))).toHaveLength(2);
      expect(turn1.filter(e => e.text === cleanBattleLogText(i18next.t("moveTriggers:splash")))).toHaveLength(2);

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      const turn2 = battleLog.getEntries().slice(intro.length + turn1.length);
      expect(turn2.filter(e => e.text.includes("Splash"))).toHaveLength(2);
      expect(turn2.every(e => e.turn === 2)).toBe(true);
    });

    it("keeps nothing outside a run", async () => {
      await game.runToTitle();
      await game.scene.ui.setMode(UiMode.MESSAGE);
      expect(shouldRecordBattleMessage()).toBe(false);
      expect(recordBattleMessage("Title screen text")).toBe(false);
      expect(battleLog.size).toBe(0);
    });

    it("follows the battle's turns from its own events", async () => {
      await game.classicMode.runToSummon(SpeciesId.PIKACHU);
      const battle = game.scene.currentBattle;
      // After the encounter, before the first command
      expect(battleLog.getLoggedTurn(battle.turn)).toBe(0);
      await game.phaseInterceptor.to("CommandPhase");
      expect(battleLog.getLoggedTurn(battle.turn)).toBe(1);

      game.move.select(MoveId.SPLASH);
      await game.phaseInterceptor.to("TurnEndPhase");
      expect(battle.turn).toBe(2);
      expect(battleLog.getLoggedTurn(battle.turn)).toBe(1);

      await game.toNextTurn();
      expect(battleLog.getLoggedTurn(battle.turn)).toBe(2);
    });

    describe("the screen", () => {
      const fill = (count: number) => {
        for (let i = 1; i <= count; i++) {
          battleLog.add(entry(7, Math.ceil(i / 5), `Message ${i}`));
        }
      };

      /** Open the menu, then its "Battle Log" entry, as the player does */
      const openFromMenu = async (): Promise<BattleLogUiHandler> => {
        const { ui } = game.scene;
        await ui.setOverlayMode(UiMode.MENU);
        const menu = ui.getHandler<MenuUiHandler>();
        const options = menu["getMenuOptionsConfig"]().options;
        const labels = options.map(o => o.label);
        const index = labels.indexOf(i18next.t("menuUiHandler:battleLog"));
        // With the other fork screens, right after the mark Pokédex
        expect(index).toBe(labels.indexOf(i18next.t("menuUiHandler:markDex")) + 1);
        // Review (2026-11-20): Save and Quit moved down one with it, to the 11th entry in a battle; the offline app's
        // self-test (offline-app/main.js, "seeded-save-quit") walks Down to it by this number
        expect(labels.indexOf(i18next.t("menuUiHandler:saveAndQuit"))).toBe(10);
        options[index].handler();
        expect(ui.mode).toBe(UiMode.BATTLE_LOG);
        return ui.getHandler<BattleLogUiHandler>();
      };

      /** The test text objects keep no visibility: watch what the screen sets on its "nothing yet" line */
      const spyOnEmptyText = () => {
        const handler = game.scene.ui.handlers[UiMode.BATTLE_LOG] as BattleLogUiHandler;
        return vi.spyOn(handler["emptyText"], "setVisible");
      };

      beforeEach(async () => {
        await game.classicMode.startBattle(SpeciesId.PIKACHU);
      });

      it("opens from the menu at the newest lines, with the top line's wave and turn in the header", async () => {
        fill(30);
        const emptyShown = spyOnEmptyText();
        const handler = await openFromMenu();
        const lines = handler["lines"];
        // 30 messages, the wave's heading and 6 turn headings
        expect(lines).toHaveLength(37);
        expect(handler["scroll"]).toBe(lines.length - BATTLE_LOG_ROWS);
        const rows = handler["rowTexts"].map(row => row.text);
        expect(rows).toHaveLength(BATTLE_LOG_ROWS);
        expect(rows.at(-1)).toBe("Message 30");
        expect(handler["positionText"].text).toBe(getBattleLogPositionText(lines[handler["scroll"]]));
        expect(emptyShown.mock.lastCall?.[0]).toBe(false);
      });

      it("scrolls a line with Up / Down, a page with Left / Right, and jumps with A", async () => {
        fill(30);
        const handler = await openFromMenu();
        const { ui } = game.scene;
        const bottom = handler["scroll"];

        expect(ui.processInput(Button.DOWN)).toBe(false);
        expect(handler.canScrollDown()).toBe(false);
        expect(ui.processInput(Button.UP)).toBe(true);
        expect(handler["scroll"]).toBe(bottom - 1);
        expect(ui.processInput(Button.DOWN)).toBe(true);
        expect(handler["scroll"]).toBe(bottom);

        expect(ui.processInput(Button.LEFT)).toBe(true);
        expect(handler["scroll"]).toBe(bottom - BATTLE_LOG_ROWS);
        expect(ui.processInput(Button.LEFT)).toBe(true);
        expect(handler["scroll"]).toBe(Math.max(0, bottom - 2 * BATTLE_LOG_ROWS));
        expect(ui.processInput(Button.RIGHT)).toBe(true);
        expect(ui.processInput(Button.RIGHT)).toBe(true);
        expect(handler["scroll"]).toBe(bottom);

        // A: from the newest lines to the oldest, and back
        expect(ui.processInput(Button.ACTION)).toBe(true);
        expect(handler["scroll"]).toBe(0);
        expect(handler.canScrollUp()).toBe(false);
        expect(handler["rowTexts"][0].text).toBe("Wave 7");
        expect(handler["positionText"].text).toBe("Wave 7 · Turn 1");
        expect(ui.processInput(Button.UP)).toBe(false);
        expect(ui.processInput(Button.ACTION)).toBe(true);
        expect(handler["scroll"]).toBe(bottom);

        // B: back to the menu
        expect(ui.processInput(Button.CANCEL)).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(ui.mode).toBe(UiMode.MENU);
      });

      it("says so when there is nothing yet", async () => {
        const emptyShown = spyOnEmptyText();
        const handler = await openFromMenu();
        const { ui } = game.scene;
        expect(handler["lines"]).toHaveLength(0);
        expect(emptyShown.mock.lastCall?.[0]).toBe(true);
        expect(handler["emptyText"].text).toBe(i18next.t("battleLog:empty"));
        expect(handler["rowTexts"].every(row => row.text === "")).toBe(true);
        for (const button of [Button.UP, Button.DOWN, Button.LEFT, Button.RIGHT, Button.ACTION]) {
          expect(ui.processInput(button)).toBe(false);
        }
      });

      it("cuts a long message to the screen's width", async () => {
        const word = "abcdefghij";
        // The test text objects take 2 units a letter; a little more than one line's worth
        const count = Math.ceil(BATTLE_LOG_LINE_WIDTH / 2 / (word.length + 1)) + 5;
        battleLog.add(entry(3, 1, new Array(count).fill(word).join(" ")));
        const handler = await openFromMenu();
        const messages = handler["lines"].filter(line => line.kind === "message");
        expect(messages).toHaveLength(2);
        expect(messages[1].continued).toBe(true);
        expect(messages.map(line => line.text).join(" ")).toBe(new Array(count).fill(word).join(" "));
      });

      it("gives the touch panel buttons for a page and a line up and down, and back", async () => {
        fill(30);
        const handler = await openFromMenu();
        const { ui } = game.scene;
        const panel = Object.create(TouchChoicePanel.prototype) as TouchChoicePanel;
        (panel as unknown as { press: (button: Button) => void }).press = button => ui.processInput(button);

        const model = panel["build"]();
        expect(model?.id).toBe("BATTLE_LOG");
        const byKey = Object.fromEntries((model?.choices ?? []).map(choice => [choice.key, choice]));
        expect(Object.keys(byKey)).toEqual(["pageUp", "pageDown", "lineUp", "lineDown", "back"]);
        expect(byKey.pageUp.label).toBe(i18next.t("battleLog:pageUp"));
        // At the newest lines: nothing below
        expect(byKey.pageDown.disabled).toBe(true);
        expect(byKey.lineDown.disabled).toBe(true);
        expect(byKey.lineUp.disabled).toBe(false);

        const bottom = handler["scroll"];
        byKey.lineUp.run();
        expect(handler["scroll"]).toBe(bottom - 1);
        byKey.pageUp.run();
        expect(handler["scroll"]).toBe(bottom - 1 - BATTLE_LOG_ROWS);
        byKey.back.run();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(ui.mode).toBe(UiMode.MENU);
      });
    });
  });
});
