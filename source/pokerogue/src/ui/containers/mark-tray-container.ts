/*
 * Local fork (2026-11-17): the tray of one Pokémon's marks (증표) and memorial ribbons (리본) on the Pokédex page
 * opened from the party, after `RibbonTray` (the species' challenge ribbons). See pokemon-marks.ts.
 */

import { globalScene } from "#app/global-scene";
import { getMarkDescription, getMarkKey, getMarkName, MARKS_ATLAS_KEY, orderedPokemonMarks } from "#data/pokemon-marks";
import { Button } from "#enums/buttons";
import { PokemonMark } from "#enums/pokemon-mark";
import type { Pokemon } from "#field/pokemon";
import type { MessageUiHandler } from "#ui/message-ui-handler";
import { addWindow } from "#ui/ui-theme";
import i18next from "i18next";
import Phaser from "phaser";

/** The icons are 40 px squares shown at half size */
const ICON_SCALE = 0.5;
const ICON_PITCH_X = 21;
const ICON_PITCH_Y = 21;

export class MarkTray extends Phaser.GameObjects.Container {
  private trayBg: Phaser.GameObjects.NineSlice;
  private marks: PokemonMark[] = [];
  private trayIcons: Phaser.GameObjects.Image[] = [];
  private trayCursorObj: Phaser.GameObjects.Image;
  private trayCursor = 0;
  /** The shown Pokémon's alpha boost (alpha-pokemon.ts), 0 for none */
  private alphaBoost = 0;

  private readonly handler: MessageUiHandler;

  private readonly maxColumns = 5;

  constructor(handler: MessageUiHandler, x: number, y: number) {
    super(globalScene, x, y);
    this.handler = handler;

    this.trayBg = addWindow(0, 0, 0, 0).setOrigin(0);
    this.add(this.trayBg);

    this.trayCursorObj = globalScene.add.image(0, 0, "select_cursor").setOrigin(0);
    this.add(this.trayCursorObj);
  }

  /**
   * The marks and ribbons of a Pokémon in the tray's order: ribbons first, then marks.
   * @param pokemon - The Pokémon
   */
  public static getDisplayedMarks(pokemon: Pokemon): PokemonMark[] {
    return orderedPokemonMarks.filter(mark => pokemon.marks.includes(mark));
  }

  public processInput(button: Button): boolean {
    const count = this.trayIcons.length;
    const columns = this.maxColumns;
    const cursor = this.trayCursor;
    switch (button) {
      case Button.UP:
        return this.setTrayCursor(cursor >= columns ? cursor - columns : cursor);
      case Button.DOWN:
        return this.setTrayCursor(cursor + columns < count ? cursor + columns : cursor);
      case Button.LEFT:
        return this.setTrayCursor(cursor === 0 ? count - 1 : cursor - 1);
      case Button.RIGHT:
        return this.setTrayCursor(cursor === count - 1 ? 0 : cursor + 1);
    }
    return false;
  }

  private setTrayCursor(cursor: number): boolean {
    cursor = Phaser.Math.Clamp(cursor, 0, Math.max(this.trayIcons.length - 1, 0));
    const changed = this.trayCursor !== cursor;
    this.trayCursor = cursor;

    this.trayCursorObj.setPosition(
      6 + (cursor % this.maxColumns) * ICON_PITCH_X,
      5 + Math.floor(cursor / this.maxColumns) * ICON_PITCH_Y,
    );

    const mark = this.marks[cursor];
    if (mark !== undefined) {
      // An alpha's marks also say how much its stats are raised
      const isAlphaMark = mark === PokemonMark.ALPHA_MARK || mark === PokemonMark.GOLDEN_ALPHA_MARK;
      const boost =
        isAlphaMark && this.alphaBoost > 0
          ? ` ${i18next.t("pokemonMarks:alphaBoost", { boost: this.alphaBoost })}`
          : "";
      this.handler.showText(`${getMarkName(mark)}${boost}\n${getMarkDescription(mark)}`);
    }

    return changed;
  }

  /**
   * Show the tray for a Pokémon.
   * @param pokemon - The Pokémon whose marks and ribbons to show
   * @returns Whether the tray opened; `false` if the Pokémon has none
   */
  public open(pokemon: Pokemon): boolean {
    this.close();
    this.marks = MarkTray.getDisplayedMarks(pokemon);
    this.alphaBoost = pokemon.alphaBoost;
    if (this.marks.length === 0) {
      return false;
    }

    this.marks.forEach((mark, index) => {
      const icon = globalScene.add
        .image(
          16 + (index % this.maxColumns) * ICON_PITCH_X,
          15 + Math.floor(index / this.maxColumns) * ICON_PITCH_Y,
          MARKS_ATLAS_KEY,
          getMarkKey(mark),
        )
        .setScale(ICON_SCALE);
      this.add(icon);
      this.trayIcons.push(icon);
    });
    this.bringToTop(this.trayCursorObj);

    const rows = Math.ceil(this.marks.length / this.maxColumns);
    const columns = Math.min(this.marks.length, this.maxColumns);
    this.trayBg.setSize(11 + columns * ICON_PITCH_X, 9 + rows * ICON_PITCH_Y);

    this.setVisible(true);
    this.trayCursor = -1;
    this.setTrayCursor(0);

    return true;
  }

  public close(): void {
    for (const icon of this.trayIcons) {
      this.remove(icon, true);
    }
    this.trayIcons = [];
    this.marks = [];
    this.setVisible(false);
  }
}
