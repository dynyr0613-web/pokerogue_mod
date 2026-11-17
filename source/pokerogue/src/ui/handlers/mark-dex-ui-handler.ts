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
 *   and grey if not, with the line's own count ("증표 n/70") under the cursor.
 *
 * - The hidden Eternatus Mark (`hasEternatusMark`) is not in the list until it is earned. Then it stands after the
 *   last mark and counts as one more than the total: "종류 71/70" (the user: "도감 다 채우면 예를들어 52/51 이런 식으로
 *   하나 더 있는듯하게 표시되도록").
 *
 * The data is each starter line's collection (`StarterDataEntry.marks`, pokemon-marks.ts).
 */

import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import {
  getCollectedMarks,
  getMarkDescription,
  getMarkKey,
  getMarkName,
  hasEternatusMark,
  MARKS_ATLAS_KEY,
  orderedPokemonMarks,
} from "#data/pokemon-marks";
import { Button } from "#enums/buttons";
import { PokemonMark } from "#enums/pokemon-mark";
import type { SpeciesId } from "#enums/species-id";
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
  /** Each mark's dark base and, over it, the bright part that fills up */
  private markBases: Phaser.GameObjects.Image[] = [];
  private markFills: Phaser.GameObjects.Image[] = [];
  /** Each mark's golden outline, shown once every starter line has the mark */
  private markOutlines: Phaser.GameObjects.Image[][] = [];
  /** The hidden Eternatus Mark, in a fifteenth column of the last row once it is earned */
  private hiddenIcon: Phaser.GameObjects.Image;
  private hasHiddenMark = false;
  /** Where the marks' grid starts without the hidden mark's column */
  private markContainerBaseX = 0;

  private speciesContainer: Phaser.GameObjects.Container;
  private speciesIcons: Phaser.GameObjects.Sprite[] = [];
  private scrollBar: ScrollBar;

  private cursorObj: Phaser.GameObjects.Image;

  /** The starter lines, in Pokédex order, and what each has collected */
  private starterIds: SpeciesId[] = [];
  private collected = new Map<SpeciesId, readonly PokemonMark[]>();
  /** How many starter lines have each mark */
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

    // The first view: every mark
    const markRows = Math.ceil(orderedPokemonMarks.length / MARK_COLS);
    this.markContainer = globalScene.add.container(
      (WIDTH - 2 - MARK_COLS * MARK_PITCH) / 2,
      gridBg.y + (gridBg.height - markRows * MARK_PITCH) / 2,
    );
    orderedPokemonMarks.forEach((mark, index) => {
      const x = (index % MARK_COLS) * MARK_PITCH + MARK_PITCH / 2;
      const y = Math.floor(index / MARK_COLS) * MARK_PITCH + MARK_PITCH / 2;
      const base = globalScene.add.image(x, y, MARKS_ATLAS_KEY, getMarkKey(mark)).setScale(MARK_SCALE);
      const fill = globalScene.add.image(x, y, MARKS_ATLAS_KEY, getMarkKey(mark)).setScale(MARK_SCALE);
      this.markBases.push(base);
      this.markFills.push(fill);
      this.markOutlines.push([]);
      this.markContainer.add([base, fill]);
    });
    this.markContainerBaseX = this.markContainer.x;
    this.hiddenIcon = globalScene.add
      .image(
        MARK_COLS * MARK_PITCH + MARK_PITCH / 2,
        (markRows - 1) * MARK_PITCH + MARK_PITCH / 2,
        MARKS_ATLAS_KEY,
        getMarkKey(PokemonMark.ETERNATUS_MARK),
      )
      .setScale(MARK_SCALE)
      .setVisible(false);
    this.markContainer.add(this.hiddenIcon);

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
    this.updateMarkIcons();
    this.showMarkView();

    this.mainContainer.setVisible(true);
    this.getUi().moveTo(this.mainContainer, this.getUi().length - 1);
    this.getUi().hideTooltip();
    return true;
  }

  /** Read every starter line's collection from the save */
  private readCollection(): void {
    const { starterData } = globalScene.gameData;
    this.starterIds = Object.keys(starterData)
      .map(Number)
      .filter(id => speciesDataRegistry.getSpecies(id))
      .sort((a, b) => a - b);
    this.collected.clear();
    this.speciesCounts.clear();
    for (const id of this.starterIds) {
      const marks = getCollectedMarks(starterData[id]);
      this.collected.set(id, marks);
      for (const mark of marks) {
        this.speciesCounts.set(mark, (this.speciesCounts.get(mark) ?? 0) + 1);
      }
    }
  }

  /** Grey, dark or partly bright, by how many starter lines have each mark */
  private updateMarkIcons(): void {
    const total = Math.max(this.starterIds.length, 1);
    // The hidden mark's column makes the grid one icon wider, so it moves half an icon left
    this.hasHiddenMark = hasEternatusMark();
    this.hiddenIcon.setVisible(this.hasHiddenMark);
    this.markContainer.setX(this.markContainerBaseX - (this.hasHiddenMark ? MARK_PITCH / 2 : 0));
    orderedPokemonMarks.forEach((mark, index) => {
      const count = this.speciesCounts.get(mark) ?? 0;
      const base = this.markBases[index];
      const fill = this.markFills[index];
      // The outline is made the first time it is needed, and goes under the icon
      if (count >= total && this.markOutlines[index].length === 0) {
        this.markOutlines[index] = createMarkOutline(base);
        this.markContainer.addAt(this.markOutlines[index], this.markContainer.getIndex(base));
      }
      for (const outline of this.markOutlines[index]) {
        outline.setVisible(count >= total);
      }
      if (count === 0) {
        base.setTint(MISSING_TINT).setTintMode(Phaser.TintModes.FILL).setAlpha(MISSING_ALPHA);
        fill.setVisible(false);
        return;
      }
      base.setTint(DARK_TINT).setTintMode(Phaser.TintModes.MULTIPLY).setAlpha(1);
      // At least one screen pixel of it shows, however few have the mark
      const filled = Phaser.Math.Clamp(Math.ceil((MARK_SIZE * count) / total), 3, MARK_SIZE);
      fill.setVisible(true).setCrop(0, MARK_SIZE - filled, MARK_SIZE, filled);
    });
  }

  /** Whether any starter line has the mark; one nobody has is grey and nameless */
  private isObtained(mark: PokemonMark): boolean {
    return (this.speciesCounts.get(mark) ?? 0) > 0;
  }

  private showMarkView(): void {
    this.openMark = null;
    this.markContainer.setVisible(true);
    this.speciesContainer.setVisible(false);
    this.scrollBar.setVisible(false);
    this.headerText.setText(i18next.t("pokemonMarks:dex.title"));
    const kinds =
      orderedPokemonMarks.filter(m => (this.speciesCounts.get(m) ?? 0) > 0).length + (this.hasHiddenMark ? 1 : 0);
    const species = this.starterIds.filter(id => (this.collected.get(id)?.length ?? 0) > 0).length;
    this.totalText.setText(
      `${i18next.t("pokemonMarks:dex.kinds", { count: kinds, total: orderedPokemonMarks.length })}   ${i18next.t(
        "pokemonMarks:dex.species",
        { count: species, total: this.starterIds.length },
      )}`,
    );
    this.cursorObj.setScale(1.125);
    this.setMarkCursor(this.markCursor);
  }

  private setMarkCursor(cursor: number): boolean {
    const changed = cursor !== this.markCursor;
    this.markCursor = cursor;
    // The hidden mark is the cursor's last stop, past the end of the last row
    if (cursor >= orderedPokemonMarks.length) {
      this.cursorObj.setPosition(
        this.markContainer.x + this.hiddenIcon.x - MARK_PITCH / 2 + 1,
        this.markContainer.y + this.hiddenIcon.y - MARK_PITCH / 2 + 1,
      );
      this.showText(`${getMarkName(PokemonMark.ETERNATUS_MARK)}\n${getMarkDescription(PokemonMark.ETERNATUS_MARK)}`);
      return changed;
    }
    this.cursorObj.setPosition(
      this.markContainer.x + (cursor % MARK_COLS) * MARK_PITCH + 1,
      this.markContainer.y + Math.floor(cursor / MARK_COLS) * MARK_PITCH + 1,
    );
    const mark = orderedPokemonMarks[cursor];
    if (!this.isObtained(mark)) {
      this.showText(`${i18next.t("pokemonMarks:unknownName")}\n${i18next.t("pokemonMarks:neverObtained")}`);
      return changed;
    }
    this.showText(
      `${i18next.t("pokemonMarks:dex.markSpecies", {
        name: getMarkName(mark),
        count: this.speciesCounts.get(mark) ?? 0,
        total: this.starterIds.length,
      })}\n${getMarkDescription(mark)}`,
    );
    return changed;
  }

  private showSpeciesView(mark: PokemonMark): void {
    this.openMark = mark;
    this.markContainer.setVisible(false);
    this.speciesContainer.setVisible(true);
    this.scrollBar.setVisible(true);
    this.scrollBar.setTotalRows(Math.ceil(this.starterIds.length / SPECIES_COLS));
    this.headerText.setText(this.isObtained(mark) ? getMarkName(mark) : i18next.t("pokemonMarks:unknownName"));
    this.totalText.setText(
      i18next.t("pokemonMarks:dex.species", {
        count: this.speciesCounts.get(mark) ?? 0,
        total: this.starterIds.length,
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
        icon.setTint(MISSING_TINT).setTintMode(Phaser.TintModes.FILL).setAlpha(MISSING_ALPHA);
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
          count: this.collected.get(id)?.length ?? 0,
          total: orderedPokemonMarks.length,
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

    if (this.openMark === null) {
      const count = orderedPokemonMarks.length + (this.hasHiddenMark ? 1 : 0);
      const cursor = this.markCursor;
      switch (button) {
        case Button.ACTION:
          // The hidden mark is the player's, not a Pokémon's: nothing to list
          if (cursor < orderedPokemonMarks.length) {
            this.showSpeciesView(orderedPokemonMarks[cursor]);
            success = true;
          }
          break;
        case Button.CANCEL:
          success = true;
          globalScene.ui.revertMode();
          break;
        case Button.UP:
          success = this.setMarkCursor(
            cursor >= orderedPokemonMarks.length
              ? orderedPokemonMarks.length - MARK_COLS - 1
              : cursor >= MARK_COLS
                ? cursor - MARK_COLS
                : cursor,
          );
          break;
        case Button.DOWN:
          success = this.setMarkCursor(cursor + MARK_COLS < orderedPokemonMarks.length ? cursor + MARK_COLS : cursor);
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
