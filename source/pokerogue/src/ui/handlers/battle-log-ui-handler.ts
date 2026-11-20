/*
 * Local fork (2026-11-20): the battle log screen (전투 기록), opened from the menu. Q6 of
 * docs/유저_요청_요소_목록_20261120.md (the official repository's request #2607: at a fast battle speed a miss or an HP
 * change goes by unread); the user: "Q6 - 실행".
 *
 * It shows the messages of the last waves (src/ui/utils/battle-log.ts, not saved), oldest at the top, with a heading
 * where each wave and each turn begins, and opens at the newest lines.
 * - Up / Down: one line. Left / Right: one page. A: to the newest lines, or from there to the oldest. B: back.
 * - The header names the wave and turn of the top line, so that a long log is not read blind.
 * - The touch panel (touch-choices.ts) gives the same moves as buttons.
 */

import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { BattleSceneEventType } from "#events/battle-scene";
import { type BattleLogLine, battleLog, buildBattleLogLines, getBattleLogPositionText } from "#ui/battle-log";
import { ScrollBar } from "#ui/scroll-bar";
import { addTextObject, getTextColor } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";
import i18next from "i18next";
import Phaser from "phaser";

/** How many lines the screen shows at once */
export const BATTLE_LOG_ROWS = 12;
/** The lines' font: the size of the ability bar's, smaller than the message box's so that more fit */
const LOG_FONT_SIZE = "72px";
/** From one line to the next, in screen pixels */
const ROW_PITCH = 12;
const HEADER_HEIGHT = 24;
/** The lines' left edge, and how far a message's later lines are set in */
const TEXT_X = 8;
const CONTINUED_INDENT = 6;
/**
 * The width a line may take, in the font's own units (6 to a screen pixel): from the left edge to the scroll bar, less
 * the set-in of a message's later lines
 */
export const BATTLE_LOG_LINE_WIDTH = (304 - TEXT_X - CONTINUED_INDENT) * 6;

export class BattleLogUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private headerText: Phaser.GameObjects.Text;
  /** The wave and turn of the top line */
  private positionText: Phaser.GameObjects.Text;
  private readonly rowTexts: Phaser.GameObjects.Text[] = [];
  private emptyText: Phaser.GameObjects.Text;
  /** Never shown: cuts the messages to the lines' width, in the lines' font */
  private measureText: Phaser.GameObjects.Text;
  private scrollBar: ScrollBar;

  private lines: BattleLogLine[] = [];
  /** The first line shown */
  private scroll = 0;

  setup(): void {
    const ui = this.getUi();
    const WIDTH = globalScene.scaledCanvas.width;
    const HEIGHT = globalScene.scaledCanvas.height;

    this.container = globalScene.add.container(1, -HEIGHT + 1);
    this.container.setInteractive(new Phaser.Geom.Rectangle(0, 0, WIDTH, HEIGHT), Phaser.Geom.Rectangle.Contains);

    const headerBg = addWindow(0, 0, WIDTH - 2, HEADER_HEIGHT);
    this.headerText = addTextObject(8, 4, "", TextStyle.HEADER_LABEL).setOrigin(0);
    this.positionText = addTextObject(WIDTH - 10, 8, "", TextStyle.WINDOW, { fontSize: "60px" }).setOrigin(1, 0);

    const listBg = addWindow(0, HEADER_HEIGHT, WIDTH - 2, HEIGHT - HEADER_HEIGHT - 2);
    const firstRowY = HEADER_HEIGHT + 5;
    for (let r = 0; r < BATTLE_LOG_ROWS; r++) {
      const y = firstRowY + r * ROW_PITCH;
      this.rowTexts.push(addTextObject(TEXT_X, y, "", TextStyle.WINDOW, { fontSize: LOG_FONT_SIZE }).setOrigin(0));
    }
    this.emptyText = addTextObject(listBg.width / 2, listBg.y + listBg.height / 2, "", TextStyle.WINDOW)
      .setOrigin(0.5)
      .setVisible(false);
    this.measureText = addTextObject(0, 0, "", TextStyle.WINDOW, {
      fontSize: LOG_FONT_SIZE,
      wordWrap: { width: BATTLE_LOG_LINE_WIDTH },
    })
      .setWordWrapWidth(BATTLE_LOG_LINE_WIDTH)
      .setVisible(false);
    this.scrollBar = new ScrollBar(listBg.width - 9, listBg.y + 6, 4, listBg.height - 12, BATTLE_LOG_ROWS);

    this.container.add([
      headerBg,
      this.headerText,
      this.positionText,
      listBg,
      ...this.rowTexts,
      this.emptyText,
      this.measureText,
      this.scrollBar,
    ]);
    ui.add(this.container);
    this.container.setVisible(false);

    // Which turn the messages belong to; the scene keeps its event target for its whole life
    const events = globalScene.eventTarget;
    events.addEventListener(BattleSceneEventType.ENCOUNTER_PHASE, () => battleLog.noteEncounter());
    events.addEventListener(BattleSceneEventType.TURN_INIT, () => battleLog.noteTurnInit());
    events.addEventListener(BattleSceneEventType.TURN_END, () => battleLog.noteTurnEnd());
  }

  show(args: any[]): boolean {
    super.show(args);

    this.headerText.setText(i18next.t("battleLog:title"));
    this.emptyText.setText(i18next.t("battleLog:empty"));
    this.lines = buildBattleLogLines(battleLog.getEntries(), text => this.wrap(text));
    this.scroll = this.maxScroll;
    this.scrollBar.setTotalRows(Math.max(this.lines.length, BATTLE_LOG_ROWS));
    this.render();

    this.container.setVisible(true);
    this.getUi().moveTo(this.container, this.getUi().length - 1);
    this.getUi().hideTooltip();
    return true;
  }

  /** Cut a message into the lines the screen can show, as the message box cuts its own */
  private wrap(text: string): string[] {
    return this.measureText.runWordWrap(text).split("\n");
  }

  /** The last line that can be the top one */
  private get maxScroll(): number {
    return Math.max(0, this.lines.length - BATTLE_LOG_ROWS);
  }

  /** Whether there are older lines above the shown ones (the touch panel reads it) */
  public canScrollUp(): boolean {
    return this.scroll > 0;
  }

  /** Whether there are newer lines below the shown ones (the touch panel reads it) */
  public canScrollDown(): boolean {
    return this.scroll < this.maxScroll;
  }

  /** @returns Whether the shown lines changed */
  private setScroll(scroll: number): boolean {
    const clamped = Math.max(0, Math.min(scroll, this.maxScroll));
    if (clamped === this.scroll) {
      return false;
    }
    this.scroll = clamped;
    this.render();
    return true;
  }

  private render(): void {
    this.rowTexts.forEach((row, r) => {
      const line = this.lines[this.scroll + r];
      if (!line) {
        row.setText("");
        return;
      }
      let style: TextStyle = TextStyle.WINDOW;
      if (line.kind === "wave") {
        style = TextStyle.STATS_LABEL;
      } else if (line.kind === "turn") {
        style = TextStyle.SUMMARY_BLUE;
      }
      row
        .setText(line.text)
        .setColor(getTextColor(style, false))
        .setShadowColor(getTextColor(style, true))
        .setX(TEXT_X + (line.continued ? CONTINUED_INDENT : 0));
    });
    this.emptyText.setVisible(this.lines.length === 0);
    const top = this.lines[this.scroll];
    this.positionText.setText(top ? getBattleLogPositionText(top) : "");
    this.scrollBar.setScrollCursor(this.scroll);
  }

  processInput(button: Button): boolean {
    let success = false;
    switch (button) {
      case Button.CANCEL:
        success = true;
        globalScene.ui.revertMode();
        break;
      case Button.UP:
        success = this.setScroll(this.scroll - 1);
        break;
      case Button.DOWN:
        success = this.setScroll(this.scroll + 1);
        break;
      case Button.LEFT:
        success = this.setScroll(this.scroll - BATTLE_LOG_ROWS);
        break;
      case Button.RIGHT:
        success = this.setScroll(this.scroll + BATTLE_LOG_ROWS);
        break;
      case Button.ACTION:
        success = this.setScroll(this.scroll < this.maxScroll ? this.maxScroll : 0);
        break;
    }
    if (success) {
      this.getUi().playSelect();
    }
    return success;
  }

  clear(): void {
    super.clear();
    this.container.setVisible(false);
    this.lines = [];
    this.scroll = 0;
  }
}
