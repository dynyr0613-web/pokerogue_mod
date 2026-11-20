import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { PokemonIconAnimMode } from "#enums/pokemon-icon-anim-mode";
import { TextStyle } from "#enums/text-style";
import { MessageUiHandler } from "#ui/message-ui-handler";
import { PokemonIconAnimHelper } from "#ui/pokemon-icon-anim-helper";
import { addTextObject } from "#ui/text";
import { addWindow } from "#ui/ui-theme";
import i18next from "i18next";

/** The rows of Egg icons on one page of the egg list */
const EGG_LIST_ROWS = 9;
/** The columns of Egg icons on one page of the egg list */
const EGG_LIST_COLUMNS = 11;
/** Local fork (2026-11-20): the Eggs on one page of the egg list, its 9 rows of 11 */
export const EGG_LIST_PAGE_SIZE = EGG_LIST_ROWS * EGG_LIST_COLUMNS;

/** Local fork (2026-11-20): where the cursor of the egg list is */
export interface EggListPosition {
  /** The page, from 0 */
  readonly page: number;
  /** The slot on the page, from 0, row by row */
  readonly cursor: number;
}

/**
 * Local fork (2026-11-20): the pages the egg list has for `total` Eggs, at least 1
 * @param total - The Eggs the player holds
 */
export function getEggListPageCount(total: number): number {
  return Math.max(1, Math.ceil(total / EGG_LIST_PAGE_SIZE));
}

/**
 * Local fork (2026-11-20): the egg list in pages of 99 instead of one scrolling grid, now that up to 999 Eggs fit
 * (the user: "알 목록 창에서 옆으로 넘기기 가 가능하게 하죠, 1/99 페이지 이런 식으로 보이도록").
 * UP and DOWN move within the page and wrap around it, as the grid did. LEFT on the first column goes to the previous
 * page and RIGHT on the last column (or on the page's last Egg) to the next one, keeping the row (the last column going
 * left, the first going right, or the page's last Egg if that slot is empty); the first and last pages wrap around.
 * @param button - The button pressed
 * @param from - Where the cursor is
 * @param total - The Eggs the player holds
 * @returns Where the cursor goes (`from` itself for other buttons or no Eggs)
 */
export function moveEggListCursor(button: Button, from: EggListPosition, total: number): EggListPosition {
  if (total <= 0) {
    return from;
  }
  const pages = getEggListPageCount(total);
  const eggsOnPage = (pageIndex: number) => Math.min(EGG_LIST_PAGE_SIZE, total - pageIndex * EGG_LIST_PAGE_SIZE);
  const { page, cursor } = from;
  const count = eggsOnPage(page);
  const rows = Math.ceil(count / EGG_LIST_COLUMNS);
  const row = Math.floor(cursor / EGG_LIST_COLUMNS);
  const column = cursor % EGG_LIST_COLUMNS;
  switch (button) {
    case Button.UP: {
      if (row > 0) {
        return { page, cursor: cursor - EGG_LIST_COLUMNS };
      }
      // Wrap around to the bottom row of the page, or the row above it if this column is empty there
      let target = cursor + (rows - 1) * EGG_LIST_COLUMNS;
      if (target >= count) {
        target -= EGG_LIST_COLUMNS;
      }
      return { page, cursor: target };
    }
    case Button.DOWN:
      if (row < rows - 1) {
        return { page, cursor: Math.min(cursor + EGG_LIST_COLUMNS, count - 1) };
      }
      // Wrap around to the top row of the page
      return { page, cursor: column };
    case Button.LEFT: {
      if (column > 0) {
        return { page, cursor: cursor - 1 };
      }
      const previous = (page - 1 + pages) % pages;
      return {
        page: previous,
        cursor: Math.min(row * EGG_LIST_COLUMNS + EGG_LIST_COLUMNS - 1, eggsOnPage(previous) - 1),
      };
    }
    case Button.RIGHT: {
      if (column < EGG_LIST_COLUMNS - 1 && cursor + 1 < count) {
        return { page, cursor: cursor + 1 };
      }
      const next = (page + 1) % pages;
      return { page: next, cursor: Math.min(row * EGG_LIST_COLUMNS, eggsOnPage(next) - 1) };
    }
  }
  return from;
}

export class EggListUiHandler extends MessageUiHandler {
  private readonly ROWS = EGG_LIST_ROWS;
  private readonly COLUMNS = EGG_LIST_COLUMNS;

  private eggListContainer: Phaser.GameObjects.Container;
  private eggListIconContainer: Phaser.GameObjects.Container;
  private eggIcons: Phaser.GameObjects.Sprite[];
  private eggSprite: Phaser.GameObjects.Sprite;
  private eggNameText: Phaser.GameObjects.Text;
  private eggDateText: Phaser.GameObjects.Text;
  private eggHatchWavesText: Phaser.GameObjects.Text;
  private eggGachaInfoText: Phaser.GameObjects.Text;
  private eggListMessageBoxContainer: Phaser.GameObjects.Container;
  /** Local fork (2026-11-20): "1/11 페이지", the page shown and the pages there are */
  private pageText: Phaser.GameObjects.Text;

  private cursorObj: Phaser.GameObjects.Image;
  /** Local fork (2026-11-20): the page shown, from 0 (it replaces the scrolling of the grid) */
  private page = 0;

  private iconAnimHandler: PokemonIconAnimHelper;

  setup() {
    const ui = this.getUi();

    this.eggListContainer = globalScene.add.container(0, -globalScene.scaledCanvas.height).setVisible(false);
    ui.add(this.eggListContainer);

    const bgColor = globalScene.add
      .rectangle(0, 0, globalScene.scaledCanvas.width, globalScene.scaledCanvas.height, 0x006860)
      .setOrigin(0);

    const eggListBg = globalScene.add.image(0, 0, "egg_list_bg").setOrigin(0);

    this.iconAnimHandler = new PokemonIconAnimHelper();

    this.eggNameText = addTextObject(8, 68, "", TextStyle.SUMMARY).setOrigin(0);

    this.eggDateText = addTextObject(8, 91, "", TextStyle.EGG_LIST);

    this.eggHatchWavesText = addTextObject(8, 108, "", TextStyle.EGG_LIST).setWordWrapWidth(540);

    this.eggGachaInfoText = addTextObject(8, 152, "", TextStyle.EGG_LIST).setWordWrapWidth(540);

    // Local fork (2026-11-20): the page indicator, at the top right of the Egg picture on the left, above the Egg
    // (the icons fill their window, and the scroll bar it replaces was too narrow for text)
    this.pageText = addTextObject(103, 8, "", TextStyle.EGG_LIST).setOrigin(1, 0);

    this.eggListIconContainer = globalScene.add.container(113, 5);

    this.cursorObj = globalScene.add.image(0, 0, "select_cursor").setOrigin(0);

    this.eggSprite = globalScene.add.sprite(54, 37, "egg");

    this.eggListMessageBoxContainer = globalScene.add.container(0, globalScene.scaledCanvas.height).setVisible(false);

    const eggListMessageBox = addWindow(1, -1, 318, 28).setOrigin(0, 1);
    this.eggListMessageBoxContainer.add(eggListMessageBox);

    // Message isn't used, but is expected to exist as this subclasses MessageUiHandler
    this.message = addTextObject(8, -8, "", TextStyle.WINDOW, { maxLines: 1 }).setActive(false).setVisible(false);

    this.cursor = -1;

    this.eggListContainer.add([
      bgColor,
      eggListBg,
      addWindow(1, 85, 106, 22),
      addWindow(1, 102, 106, 50, true),
      addWindow(1, 147, 106, 32, true),
      addWindow(107, 1, 212, 178),
      this.eggNameText,
      this.eggDateText,
      this.eggHatchWavesText,
      this.eggGachaInfoText,
      this.pageText,
      this.eggListIconContainer,
      this.cursorObj,
      this.eggSprite,
    ]);
  }

  override show(args: any[]): boolean {
    super.show(args);

    this.initEggIcons();

    this.getUi().bringToTop(this.eggListContainer);

    this.eggListContainer.setVisible(true);

    this.page = 0;

    this.updateEggIcons();
    this.setCursor(0);

    return true;
  }

  /**
   * Create the grid of egg icons to display
   */
  private initEggIcons() {
    this.eggIcons = [];
    for (let i = 0; i < Math.min(this.ROWS * this.COLUMNS, globalScene.gameData.eggs.length); i++) {
      const x = (i % this.COLUMNS) * 18;
      const y = Math.floor(i / this.COLUMNS) * 18;
      const icon = globalScene.add
        .sprite(x - 2, y + 2, "egg_icons")
        .setScale(0.5)
        .setOrigin(0);
      this.eggListIconContainer.add(icon);
      this.eggIcons.push(icon);
    }
  }

  /**
   * Show the egg icons of the current page, and the page indicator
   */
  private updateEggIcons() {
    const indexOffset = this.page * EGG_LIST_PAGE_SIZE;
    const eggsToShow = Math.min(this.eggIcons.length, globalScene.gameData.eggs.length - indexOffset);
    this.eggIcons.forEach((icon, i) => {
      if (i !== this.cursor) {
        this.iconAnimHandler.addOrUpdate(icon, PokemonIconAnimMode.NONE);
      }
      if (i < eggsToShow) {
        const egg = globalScene.gameData.eggs[i + indexOffset];
        icon.setFrame(egg.getKey()).setVisible(true);
      } else {
        icon.setVisible(false);
      }
    });
    this.pageText.setText(
      i18next.t("egg:listPage", {
        page: this.page + 1,
        pages: getEggListPageCount(globalScene.gameData.eggs.length),
      }),
    );
  }

  /**
   * Update the information panel with the information of the given egg
   * @param index which egg in the list to display the info for
   */
  private setEggDetails(index: number): void {
    const egg = globalScene.gameData.eggs[index];
    this.eggSprite.setFrame(`egg_${egg.getKey()}`);
    this.eggNameText.setText(`${i18next.t("egg:egg")} (${egg.getEggDescriptor()})`);
    this.eggDateText.setText(
      new Date(egg.timestamp).toLocaleString(undefined, {
        weekday: "short",
        year: "numeric",
        month: "2-digit",
        day: "numeric",
      }),
    );
    this.eggHatchWavesText.setText(egg.getEggHatchWavesMessage());
    this.eggGachaInfoText.setText(egg.getEggTypeDescriptor());
  }

  /** Local fork (2026-11-20): the page shown, from 0 */
  getPage(): number {
    return this.page;
  }

  /**
   * Local fork (2026-11-20): move the cursor to `position`, showing its page
   * @returns Whether the page or the cursor changed
   */
  private setPosition({ page, cursor }: EggListPosition): boolean {
    const pageChanged = page !== this.page;
    if (pageChanged) {
      this.page = page;
      this.updateEggIcons();
    }
    const cursorChanged = this.setCursor(cursor);
    if (pageChanged && !cursorChanged) {
      // Another Egg in the same slot
      this.setEggDetails(page * EGG_LIST_PAGE_SIZE + cursor);
    }
    return pageChanged || cursorChanged;
  }

  processInput(button: Button): boolean {
    const ui = this.getUi();

    let success = false;

    if (button === Button.CANCEL) {
      ui.revertMode();
      success = true;
    } else {
      success = this.setPosition(
        moveEggListCursor(button, { page: this.page, cursor: this.cursor }, globalScene.gameData.eggs.length),
      );
    }

    if (success) {
      ui.playSelect();
    }

    return success;
  }

  setCursor(cursor: number): boolean {
    let changed = false;

    const lastCursor = this.cursor;

    changed = super.setCursor(cursor);

    if (changed) {
      const icon = this.eggIcons[cursor];
      this.cursorObj.setPositionRelative(icon, 114, 5);

      if (lastCursor > -1) {
        this.iconAnimHandler.addOrUpdate(this.eggIcons[lastCursor], PokemonIconAnimMode.NONE);
      }
      this.iconAnimHandler.addOrUpdate(icon, PokemonIconAnimMode.ACTIVE);

      this.setEggDetails(cursor + this.page * EGG_LIST_PAGE_SIZE);
    }

    return changed;
  }

  clear(): void {
    super.clear();
    this.page = 0;
    this.cursor = -1;
    this.eggListContainer.setVisible(false);
    this.iconAnimHandler.removeAll();
    this.eggListIconContainer.removeAll(true);
    this.eggIcons = [];
  }
}
