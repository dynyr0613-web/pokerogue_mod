/*
 * Local fork (2026-11-17): the mark Pokédex (증표도감), opened from the menu. The user: "전체 증표 n/n이랑 포켓몬별 증표
 * n/50몇개도 표시해보죠 / 증표 도감에 들어가면 ... 없는건 회색, 있는건 기본적으로 어두운 색으로 해두고, 전체 포켓몬 중
 * 증표가 있는 포켓몬만큼 밝게 차오르게".
 *
 * - The first view lists every mark and ribbon. One no starter line has collected is grey; the others are dark and
 *   fill up bright from the bottom by the share of the starter lines that have collected it. A mark no line has is
 *   also named "???" (the user: "그쪽도 ???으로 가리도록"), and one every line has gets a golden outline, so that all
 *   of them have it once everything is collected ("증표 도감에서 모든 포켓몬의 증표를 전부 모을 경우에도 테두리 금색").
 * - The action button on a mark opens the second view: every starter line's icon, bright if the line has that mark
 *   and grey if not, outlined in gold if the line has collected everything, with the line's own count ("증표 n/70") under the cursor.
 *
 * - The hidden marks are not in the list: the Once-in-a-Lifetime Ribbon, the Mightiest Mark and the player's own
 *   Eternatus Mark (`hasEternatusMark`). Once every listed mark has been obtained the list can be scrolled down past
 *   its last row, and there they stand apart in the middle (the user: "무한다이노의 증표 위치는 스크롤을 해서 아래로
 *   내리면 중앙정도 되는 위치에 조금 떨어져있게 하죠, 다른 증표들을 전부 모으면 스크롤이 가능해지게" and "히든 증표
 *   ... 최강의 증표나 천재일우의 증표 정도"): grey and nameless until obtained, and each one counts past the total,
 *   "종류 71/68" ("도감 다 채우면 예를들어 52/51 이런 식으로 하나 더 있는듯하게"). They do not count for anything's
 *   golden outline. The Eternatus Mark gets its own outline when Eternatus' line has every listed mark ("무한다이노로
 *   다른 증표를 모두 모으면 무한다이노의 증표에도 황금색이 붙게").
 * - "Every Pokémon" for the marks' shares and outlines leaves Eternatus out ("모든 포켓몬의 기준은 무한다이노는
 *   빼고"); it is still listed in the second view.
 * - Local fork (2026-11-18): with the new hidden marks and ribbons ("새 히든 증표•리본") the page below holds fifteen of
 *   them, so they stand eight to a row (the marks and trainers' ribbons, then the Endless ribbons), and the Eternatus
 *   Mark alone in the middle of a row below them, a little apart and larger. Up and down move between the rows (up
 *   from the first goes back to the list), left and right go through them all.
 *
 * The data is each starter line's collection (`StarterDataEntry.marks`, pokemon-marks.ts).
 */

import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import {
  COMPLETION_EXEMPT_MARKS,
  getCollectedMarks,
  getMarkDescription,
  getMarkKey,
  getMarkName,
  hasEternatusMark,
  hasEverObtainedMark,
  isMarkCollectionComplete,
  MARKS_ATLAS_KEY,
  orderedPokemonMarks,
} from "#data/pokemon-marks";
import { Button } from "#enums/buttons";
import { PokemonMark } from "#enums/pokemon-mark";
import { SpeciesId } from "#enums/species-id";
import { TextStyle } from "#enums/text-style";
import { createMarkOutline } from "#ui/mark-tray-container";
import { MessageUiHandler } from "#ui/message-ui-handler";
import { ScrollBar } from "#ui/scroll-bar";
import { addTextObject } from "#ui/text";
import { addWindow } from "#ui/ui-theme";
import i18next from "i18next";
import Phaser from "phaser";

/** The mark icons are 40 px squares shown at 18 px, fourteen to a row */
const MARK_SIZE = 40;
const MARK_SCALE = 0.45;
const MARK_COLS = 14;
const MARK_PITCH = 20;
/**
 * Local fork (2026-11-18): the hidden marks stand apart, a little larger (24 px), eight to a row; the Eternatus Mark
 * larger still (28 px, the size all of them had while they were five) on a row of its own, a little further down
 */
const HIDDEN_MARK_SCALE = 0.6;
const HIDDEN_MARK_COLS = 8;
const HIDDEN_MARK_PITCH_X = 32;
const HIDDEN_MARK_PITCH_Y = 30;
const ETERNATUS_MARK_SCALE = 0.7;
const ETERNATUS_MARK_GAP = 8;

/** The listed marks: all but the hidden ones */
const LISTED_MARKS: readonly PokemonMark[] = orderedPokemonMarks.filter(m => !COMPLETION_EXEMPT_MARKS.includes(m));
/**
 * Local fork (2026-11-18): the rows of the page below the list: the hidden marks in their order, eight to a row, and
 * the Eternatus Mark on its own
 */
export const HIDDEN_PAGE_ROWS: readonly (readonly PokemonMark[])[] = [
  ...Array.from({ length: Math.ceil(COMPLETION_EXEMPT_MARKS.length / HIDDEN_MARK_COLS) }, (_, row) =>
    COMPLETION_EXEMPT_MARKS.slice(row * HIDDEN_MARK_COLS, (row + 1) * HIDDEN_MARK_COLS),
  ),
  [PokemonMark.ETERNATUS_MARK],
];

/** One mark of the first view: its dark base, the bright part that fills up over it, and its golden outline */
interface MarkCell {
  mark: PokemonMark;
  base: Phaser.GameObjects.Image;
  fill: Phaser.GameObjects.Image;
  /** Made the first time it is needed */
  outline: Phaser.GameObjects.Image[];
  obtained: boolean;
  golden: boolean;
  /** Local fork (2026-11-18): its row on its page (the hidden page's cursor moves by rows), and its icon's scale */
  row: number;
  scale: number;
}
/** The Pokémon icons are shown at half size (20 x 15), fifteen to a row and six rows at a time */
const SPECIES_COLS = 15;
const SPECIES_ROWS = 6;
const SPECIES_PITCH_X = 20;
const SPECIES_PITCH_Y = 17;

/** A mark nobody has, or a Pokémon without the mark: grey and see-through */
const MISSING_TINT = 0x8a8a96;
const MISSING_ALPHA = 0.5;
/** The part of a collected mark that has not filled up yet */
const DARK_TINT = 0x4a4a58;

export class MarkDexUiHandler extends MessageUiHandler {
  private mainContainer: Phaser.GameObjects.Container;
  private headerText: Phaser.GameObjects.Text;
  private totalText: Phaser.GameObjects.Text;

  private markContainer: Phaser.GameObjects.Container;
  /** The listed marks, then the hidden ones of the page below */
  private listedCells: MarkCell[] = [];
  private hiddenCells: MarkCell[] = [];
  /** Whether every listed mark has been obtained, so that the list scrolls down to the hidden marks */
  private canScrollToHidden = false;
  /** Whether the first view is scrolled down to the hidden marks */
  private onHiddenPage = false;
  private hiddenCursor = 0;
  /** The arrow that says the list goes on, below it or above the hidden marks */
  private scrollHint: Phaser.GameObjects.Text;

  private speciesContainer: Phaser.GameObjects.Container;
  private speciesIcons: Phaser.GameObjects.Sprite[] = [];
  /** The golden outlines of the shown Pokémon whose lines have collected everything */
  private speciesOutlines: Phaser.GameObjects.Image[] = [];
  private scrollBar: ScrollBar;

  private cursorObj: Phaser.GameObjects.Image;

  /** The starter lines, in Pokédex order, and what each has collected */
  private starterIds: SpeciesId[] = [];
  private collected = new Map<SpeciesId, readonly PokemonMark[]>();
  /** The starter lines the shares are counted over: all but Eternatus */
  private countedIds: SpeciesId[] = [];
  /** How many of them have each mark */
  private speciesCounts = new Map<PokemonMark, number>();

  /** The mark whose Pokémon the second view shows; `null` in the first view */
  private openMark: PokemonMark | null = null;
  private markCursor = 0;
  private speciesCursor = 0;
  private speciesScroll = 0;

  setup(): void {
    const ui = this.getUi();
    const WIDTH = globalScene.scaledCanvas.width;
    const HEIGHT = globalScene.scaledCanvas.height;

    this.mainContainer = globalScene.add.container(1, -HEIGHT + 1);
    this.mainContainer.setInteractive(new Phaser.Geom.Rectangle(0, 0, WIDTH, HEIGHT), Phaser.Geom.Rectangle.Contains);

    const headerBg = addWindow(0, 0, WIDTH - 2, 24);
    this.headerText = addTextObject(8, 4, "", TextStyle.HEADER_LABEL).setOrigin(0);
    this.totalText = addTextObject(WIDTH - 10, 8, "", TextStyle.WINDOW, { fontSize: "60px" }).setOrigin(1, 0);

    const descriptionBg = addWindow(0, HEIGHT - 44, WIDTH - 2, 42);
    const gridBg = addWindow(0, headerBg.height, WIDTH - 2, HEIGHT - headerBg.height - 44).setOrigin(0);

    const descriptionText = addTextObject(8, descriptionBg.y + 4, "", TextStyle.WINDOW, { maxLines: 2 })
      .setWordWrapWidth(1870)
      .setOrigin(0);
    this.message = descriptionText;

    // The first view: every listed mark, and the hidden ones in the middle of the page below
    const markRows = Math.ceil(LISTED_MARKS.length / MARK_COLS);
    this.markContainer = globalScene.add.container(
      (WIDTH - 2 - MARK_COLS * MARK_PITCH) / 2,
      gridBg.y + (gridBg.height - markRows * MARK_PITCH) / 2,
    );
    const addCell = (mark: PokemonMark, x: number, y: number, scale: number, row: number): MarkCell => {
      const base = globalScene.add.image(x, y, MARKS_ATLAS_KEY, getMarkKey(mark)).setScale(scale);
      const fill = globalScene.add.image(x, y, MARKS_ATLAS_KEY, getMarkKey(mark)).setScale(scale);
      this.markContainer.add([base, fill]);
      return { mark, base, fill, outline: [], obtained: false, golden: false, row, scale };
    };
    this.listedCells = LISTED_MARKS.map((mark, index) =>
      addCell(
        mark,
        (index % MARK_COLS) * MARK_PITCH + MARK_PITCH / 2,
        Math.floor(index / MARK_COLS) * MARK_PITCH + MARK_PITCH / 2,
        MARK_SCALE,
        Math.floor(index / MARK_COLS),
      ),
    );
    // Local fork (2026-11-18): the hidden marks' rows, each centred, and the Eternatus Mark's row a little apart; all
    // of it in the middle of where the list stands
    const markRowCount = HIDDEN_PAGE_ROWS.length - 1;
    const eternatusSize = MARK_SIZE * ETERNATUS_MARK_SCALE;
    const hiddenHeight = markRowCount * HIDDEN_MARK_PITCH_Y + ETERNATUS_MARK_GAP + eternatusSize;
    const hiddenTop = (markRows * MARK_PITCH - hiddenHeight) / 2;
    this.hiddenCells = HIDDEN_PAGE_ROWS.flatMap((marks, row) =>
      marks.map((mark, index) => {
        const isEternatusRow = row === markRowCount;
        return addCell(
          mark,
          (MARK_COLS * MARK_PITCH) / 2 + (index - (marks.length - 1) / 2) * HIDDEN_MARK_PITCH_X,
          isEternatusRow
            ? hiddenTop + markRowCount * HIDDEN_MARK_PITCH_Y + ETERNATUS_MARK_GAP + eternatusSize / 2
            : hiddenTop + row * HIDDEN_MARK_PITCH_Y + HIDDEN_MARK_PITCH_Y / 2,
          isEternatusRow ? ETERNATUS_MARK_SCALE : HIDDEN_MARK_SCALE,
          row,
        );
      }),
    );
    this.scrollHint = addTextObject(gridBg.width / 2, 0, "", TextStyle.WINDOW, { fontSize: "40px" })
      .setOrigin(0.5, 0)
      .setVisible(false);

    // The second view: every starter line, a few rows at a time
    this.speciesContainer = globalScene.add.container(
      (WIDTH - 2 - 8 - SPECIES_COLS * SPECIES_PITCH_X) / 2,
      gridBg.y + (gridBg.height - SPECIES_ROWS * SPECIES_PITCH_Y) / 2,
    );
    for (let i = 0; i < SPECIES_COLS * SPECIES_ROWS; i++) {
      const icon = globalScene.add
        .sprite((i % SPECIES_COLS) * SPECIES_PITCH_X, Math.floor(i / SPECIES_COLS) * SPECIES_PITCH_Y, "pokemon_icons_0")
        .setScale(0.5)
        .setOrigin(0);
      this.speciesIcons.push(icon);
      this.speciesContainer.add(icon);
    }
    this.scrollBar = new ScrollBar(gridBg.width - 9, gridBg.y + 6, 4, gridBg.height - 12, SPECIES_ROWS);

    this.cursorObj = globalScene.add.image(0, 0, "select_cursor").setOrigin(0);

    this.mainContainer.add([
      headerBg,
      this.headerText,
      this.totalText,
      gridBg,
      this.markContainer,
      this.speciesContainer,
      this.scrollBar,
      this.scrollHint,
      this.cursorObj,
      descriptionBg,
      descriptionText,
    ]);
    ui.add(this.mainContainer);
    this.mainContainer.setVisible(false);
  }

  show(args: any[]): boolean {
    super.show(args);

    this.readCollection();
    this.openMark = null;
    this.markCursor = 0;
    this.hiddenCursor = 0;
    this.onHiddenPage = false;
    this.updateMarkCells();
    this.showMarkView();

    this.mainContainer.setVisible(true);
    this.getUi().moveTo(this.mainContainer, this.getUi().length - 1);
    this.getUi().hideTooltip();
    return true;
  }

  /** Read every starter line's collection from the save */
  private readCollection(): void {
    const { starterData } = globalScene.gameData;
    // Local fork (2026-11-17): a line is its root species' entry, where its marks are collected; Pikachu, a starter of
    // its own with Pichu as its root, is part of Pichu's line here (GameData.registerMarks)
    this.starterIds = Object.keys(starterData)
      .map(Number)
      .filter(id => speciesDataRegistry.getSpecies(id) && !speciesDataRegistry.hasPrevolution(id))
      .sort((a, b) => a - b);
    // "Every Pokémon" leaves Eternatus out: its own collection is for the Eternatus Mark's outline
    this.countedIds = this.starterIds.filter(id => id !== SpeciesId.ETERNATUS);
    this.collected.clear();
    this.speciesCounts.clear();
    for (const id of this.starterIds) {
      const marks = getCollectedMarks(starterData[id]);
      this.collected.set(id, marks);
      if (id === SpeciesId.ETERNATUS) {
        continue;
      }
      for (const mark of marks) {
        this.speciesCounts.set(mark, (this.speciesCounts.get(mark) ?? 0) + 1);
      }
    }
  }

  /** Grey, dark or partly bright, by how many starter lines have each mark; golden once all of them do */
  private updateMarkCells(): void {
    const total = Math.max(this.countedIds.length, 1);
    for (const cell of [...this.listedCells, ...this.hiddenCells]) {
      // The Eternatus Mark is the player's: all or nothing, and golden by Eternatus' own collection
      const isPlayerMark = cell.mark === PokemonMark.ETERNATUS_MARK;
      const count = isPlayerMark ? (hasEternatusMark() ? total : 0) : (this.speciesCounts.get(cell.mark) ?? 0);
      // Local fork (2026-11-17): or obtained before the lines kept their own collections (markCounts only), as the
      // Pokédex page's mark list counts it
      cell.obtained = count > 0 || (!isPlayerMark && hasEverObtainedMark(cell.mark));
      cell.golden = isPlayerMark
        ? cell.obtained && isMarkCollectionComplete(this.collected.get(SpeciesId.ETERNATUS) ?? [])
        : count >= total;
      // The outline is made the first time it is needed, and goes under the icon
      if (cell.golden && cell.outline.length === 0) {
        cell.outline = createMarkOutline(cell.base);
        this.markContainer.addAt(cell.outline, this.markContainer.getIndex(cell.base));
      }
      if (!cell.obtained) {
        cell.base.setTint(MISSING_TINT).setTintMode(Phaser.TintModes.FILL).setAlpha(MISSING_ALPHA);
        continue;
      }
      cell.base.setTint(DARK_TINT).setTintMode(Phaser.TintModes.MULTIPLY).setAlpha(1);
      // At least one screen pixel of it shows, however few have the mark
      const filled = Phaser.Math.Clamp(Math.ceil((MARK_SIZE * count) / total), 3, MARK_SIZE);
      cell.fill.setCrop(0, MARK_SIZE - filled, MARK_SIZE, filled);
    }
    this.canScrollToHidden = this.listedCells.every(cell => cell.obtained);
  }

  /** Whether any counted starter line has the mark (or the player, the Eternatus Mark); otherwise it is nameless */
  private isObtained(mark: PokemonMark): boolean {
    return [...this.listedCells, ...this.hiddenCells].find(cell => cell.mark === mark)?.obtained ?? false;
  }

  private showMarkView(): void {
    this.openMark = null;
    this.markContainer.setVisible(true);
    this.speciesContainer.setVisible(false);
    this.scrollBar.setVisible(false);
    this.headerText.setText(i18next.t("pokemonMarks:dex.title"));
    // The hidden marks count past the total
    const kinds = [...this.listedCells, ...this.hiddenCells].filter(cell => cell.obtained).length;
    const species = this.countedIds.filter(id => (this.collected.get(id)?.length ?? 0) > 0).length;
    this.totalText.setText(
      `${i18next.t("pokemonMarks:dex.kinds", { count: kinds, total: LISTED_MARKS.length })}   ${i18next.t(
        "pokemonMarks:dex.species",
        { count: species, total: this.countedIds.length },
      )}`,
    );
    this.setHiddenPage(this.onHiddenPage && this.canScrollToHidden);
  }

  /**
   * Scroll the first view between the list and the page below it, where the hidden marks stand.
   * @param hidden - Whether to show the hidden marks' page
   */
  private setHiddenPage(hidden: boolean): void {
    this.onHiddenPage = hidden;
    const showCells = (cells: MarkCell[], visible: boolean): void => {
      for (const cell of cells) {
        cell.base.setVisible(visible);
        cell.fill.setVisible(visible && cell.obtained);
        for (const outline of cell.outline) {
          outline.setVisible(visible && cell.golden);
        }
      }
    };
    showCells(this.listedCells, !hidden);
    showCells(this.hiddenCells, hidden);
    const listHeight = Math.ceil(LISTED_MARKS.length / MARK_COLS) * MARK_PITCH;
    this.scrollHint
      .setVisible(this.canScrollToHidden)
      .setText(hidden ? "▲" : "▼")
      .setY(this.markContainer.y + (hidden ? -5 : listHeight - 1));
    if (hidden) {
      this.setHiddenCursor(this.hiddenCursor);
    } else {
      this.cursorObj.setScale(1.125);
      this.setMarkCursor(this.markCursor);
    }
  }

  private setHiddenCursor(cursor: number): boolean {
    const changed = cursor !== this.hiddenCursor;
    this.hiddenCursor = cursor;
    const cell = this.hiddenCells[cursor];
    // Local fork (2026-11-18): the cell's own size (the Eternatus Mark is larger)
    const size = MARK_SIZE * cell.scale;
    this.cursorObj
      .setScale((size + 4) / 16)
      .setPosition(
        this.markContainer.x + cell.base.x - size / 2 - 2,
        this.markContainer.y + cell.base.y - size / 2 - 2,
      );
    this.showMarkText(cell);
    return changed;
  }

  /** The text under the cursor: a mark nobody has is nameless; the player's own mark has no count */
  private showMarkText(cell: MarkCell): void {
    if (!cell.obtained) {
      this.showText(`${i18next.t("pokemonMarks:unknownName")}\n${i18next.t("pokemonMarks:neverObtained")}`);
    } else if (cell.mark === PokemonMark.ETERNATUS_MARK) {
      this.showText(`${getMarkName(cell.mark)}\n${getMarkDescription(cell.mark)}`);
    } else {
      this.showText(
        `${i18next.t("pokemonMarks:dex.markSpecies", {
          name: getMarkName(cell.mark),
          count: this.speciesCounts.get(cell.mark) ?? 0,
          total: this.countedIds.length,
        })}\n${getMarkDescription(cell.mark)}`,
      );
    }
  }

  /**
   * Local fork (2026-11-18): the hidden mark in the next row up or down nearest to the one under the cursor
   * @param direction - -1 for up, 1 for down
   * @returns Its index, or `null` past the first or last row
   */
  private getHiddenCursorInRow(direction: -1 | 1): number | null {
    const current = this.hiddenCells[this.hiddenCursor];
    let best: number | null = null;
    for (const [index, cell] of this.hiddenCells.entries()) {
      if (
        cell.row === current.row + direction
        && (best === null
          || Math.abs(cell.base.x - current.base.x) < Math.abs(this.hiddenCells[best].base.x - current.base.x))
      ) {
        best = index;
      }
    }
    return best;
  }

  private setMarkCursor(cursor: number): boolean {
    const changed = cursor !== this.markCursor;
    this.markCursor = cursor;
    this.cursorObj.setPosition(
      this.markContainer.x + (cursor % MARK_COLS) * MARK_PITCH + 1,
      this.markContainer.y + Math.floor(cursor / MARK_COLS) * MARK_PITCH + 1,
    );
    this.showMarkText(this.listedCells[cursor]);
    return changed;
  }

  private showSpeciesView(mark: PokemonMark): void {
    this.openMark = mark;
    this.markContainer.setVisible(false);
    // Local fork (2026-11-17): the list's ▲/▼ is not this view's (showMarkView brings it back)
    this.scrollHint.setVisible(false);
    this.speciesContainer.setVisible(true);
    this.scrollBar.setVisible(true);
    this.scrollBar.setTotalRows(Math.ceil(this.starterIds.length / SPECIES_COLS));
    this.headerText.setText(this.isObtained(mark) ? getMarkName(mark) : i18next.t("pokemonMarks:unknownName"));
    this.totalText.setText(
      i18next.t("pokemonMarks:dex.species", {
        count: this.speciesCounts.get(mark) ?? 0,
        total: this.countedIds.length,
      }),
    );
    this.cursorObj.setScale(1.125, 0.9375);
    this.speciesScroll = -1;
    this.speciesCursor = 0;
    this.setSpeciesScroll(0);
    this.setSpeciesCursor(0);
  }

  private setSpeciesScroll(scroll: number): void {
    if (scroll === this.speciesScroll || this.openMark === null) {
      return;
    }
    this.speciesScroll = scroll;
    this.scrollBar.setScrollCursor(scroll);
    const mark = this.openMark;
    for (const outline of this.speciesOutlines) {
      this.speciesContainer.remove(outline, true);
    }
    this.speciesOutlines = [];
    this.speciesIcons.forEach((icon, i) => {
      const id = this.starterIds[scroll * SPECIES_COLS + i];
      const species = id === undefined ? null : speciesDataRegistry.getSpecies(id);
      icon.setVisible(!!species);
      if (!species) {
        return;
      }
      icon.setTexture(species.getIconAtlasKey()).setFrame(species.getIconId(false));
      if (this.collected.get(id)?.includes(mark)) {
        icon.clearTint().setAlpha(1);
      } else {
        // Local fork (2026-11-17): opaque over a golden outline, which would shine through a faded grey icon
        const complete = isMarkCollectionComplete(this.collected.get(id) ?? []);
        icon
          .setTint(MISSING_TINT)
          .setTintMode(Phaser.TintModes.FILL)
          .setAlpha(complete ? 1 : MISSING_ALPHA);
      }
      // A line that has collected everything but the hidden marks is outlined in gold
      if (isMarkCollectionComplete(this.collected.get(id) ?? [])) {
        const outline = createMarkOutline(icon);
        this.speciesContainer.addAt(outline, this.speciesContainer.getIndex(icon));
        this.speciesOutlines.push(...outline);
      }
    });
  }

  private setSpeciesCursor(cursor: number): boolean {
    const last = this.starterIds.length - 1 - this.speciesScroll * SPECIES_COLS;
    cursor = Phaser.Math.Clamp(cursor, 0, Math.min(last, SPECIES_COLS * SPECIES_ROWS - 1));
    const changed = cursor !== this.speciesCursor;
    this.speciesCursor = cursor;
    this.cursorObj.setPosition(
      this.speciesContainer.x + (cursor % SPECIES_COLS) * SPECIES_PITCH_X + 1,
      this.speciesContainer.y + Math.floor(cursor / SPECIES_COLS) * SPECIES_PITCH_Y,
    );
    const id = this.starterIds[this.speciesScroll * SPECIES_COLS + cursor];
    const species = id === undefined ? null : speciesDataRegistry.getSpecies(id);
    if (species) {
      const caught = !!globalScene.gameData.dexData[id]?.caughtAttr;
      this.showText(
        i18next.t("pokemonMarks:dex.speciesMarks", {
          name: caught ? species.name : i18next.t("pokemonMarks:dex.unknownSpecies"),
          // The hidden marks count past the total here too
          count: this.collected.get(id)?.length ?? 0,
          total: LISTED_MARKS.length,
        }),
      );
    }
    return changed;
  }

  /** Move the cursor of the second view by whole rows, scrolling at the edges and wrapping around */
  private moveSpeciesRow(direction: -1 | 1): boolean {
    const totalRows = Math.ceil(this.starterIds.length / SPECIES_COLS);
    const maxScroll = Math.max(totalRows - SPECIES_ROWS, 0);
    const column = this.speciesCursor % SPECIES_COLS;
    const row = Math.floor(this.speciesCursor / SPECIES_COLS) + direction;
    let scroll = this.speciesScroll;
    let newRow = row;
    if (row < 0) {
      scroll = scroll > 0 ? scroll - 1 : maxScroll;
      newRow = scroll === this.speciesScroll - 1 ? 0 : Math.min(SPECIES_ROWS, totalRows) - 1;
    } else if (row >= SPECIES_ROWS || (scroll + row) * SPECIES_COLS > this.starterIds.length - 1) {
      scroll = scroll < maxScroll && row >= SPECIES_ROWS ? scroll + 1 : 0;
      newRow = scroll === this.speciesScroll + 1 ? SPECIES_ROWS - 1 : 0;
    }
    const before = this.speciesScroll;
    this.setSpeciesScroll(scroll);
    const moved = this.setSpeciesCursor(newRow * SPECIES_COLS + column);
    return moved || before !== this.speciesScroll;
  }

  processInput(button: Button): boolean {
    let success = false;

    if (this.openMark === null && this.onHiddenPage) {
      // The hidden marks' page: back up to the list, or out. The Eternatus Mark is the player's: nothing to open
      const count = this.hiddenCells.length;
      const cursor = this.hiddenCursor;
      switch (button) {
        case Button.ACTION:
          if (this.hiddenCells[cursor].mark !== PokemonMark.ETERNATUS_MARK) {
            this.showSpeciesView(this.hiddenCells[cursor].mark);
            success = true;
          }
          break;
        case Button.CANCEL:
          success = true;
          globalScene.ui.revertMode();
          break;
        case Button.UP: {
          // Local fork (2026-11-18): up a row, and from the first back up to the list
          const above = this.getHiddenCursorInRow(-1);
          success = true;
          if (above === null) {
            this.setHiddenPage(false);
          } else {
            this.setHiddenCursor(above);
          }
          break;
        }
        case Button.DOWN: {
          const below = this.getHiddenCursorInRow(1);
          success = below !== null && this.setHiddenCursor(below);
          break;
        }
        case Button.LEFT:
          success = this.setHiddenCursor(cursor === 0 ? count - 1 : cursor - 1);
          break;
        case Button.RIGHT:
          success = this.setHiddenCursor(cursor === count - 1 ? 0 : cursor + 1);
          break;
      }
    } else if (this.openMark === null) {
      const count = this.listedCells.length;
      const cursor = this.markCursor;
      switch (button) {
        case Button.ACTION:
          this.showSpeciesView(this.listedCells[cursor].mark);
          success = true;
          break;
        case Button.CANCEL:
          success = true;
          globalScene.ui.revertMode();
          break;
        case Button.UP:
          success = this.setMarkCursor(cursor >= MARK_COLS ? cursor - MARK_COLS : cursor);
          break;
        case Button.DOWN:
          if (cursor + MARK_COLS < count) {
            success = this.setMarkCursor(cursor + MARK_COLS);
          } else if (this.canScrollToHidden) {
            // Past the last row, once every listed mark has been obtained
            success = true;
            this.setHiddenPage(true);
          }
          break;
        case Button.LEFT:
          success = this.setMarkCursor(cursor === 0 ? count - 1 : cursor - 1);
          break;
        case Button.RIGHT:
          success = this.setMarkCursor(cursor === count - 1 ? 0 : cursor + 1);
          break;
      }
    } else {
      switch (button) {
        case Button.CANCEL:
          success = true;
          this.showMarkView();
          break;
        case Button.UP:
          success = this.moveSpeciesRow(-1);
          break;
        case Button.DOWN:
          success = this.moveSpeciesRow(1);
          break;
        case Button.LEFT:
          success = this.setSpeciesCursor(
            this.speciesCursor % SPECIES_COLS === 0 ? this.speciesCursor + SPECIES_COLS - 1 : this.speciesCursor - 1,
          );
          break;
        case Button.RIGHT:
          success = this.setSpeciesCursor(
            (this.speciesCursor + 1) % SPECIES_COLS === 0
              ? this.speciesCursor - SPECIES_COLS + 1
              : this.speciesCursor + 1,
          );
          break;
      }
    }

    if (success) {
      this.getUi().playSelect();
    }
    return success;
  }

  clear(): void {
    super.clear();
    this.mainContainer.setVisible(false);
  }
}
