/*
 * Local fork (2026-11-17): the tray of one Pokémon's marks (증표) and memorial ribbons (리본) on the Pokédex page
 * opened from the party, after `RibbonTray` (the species' challenge ribbons). See pokemon-marks.ts.
 *
 * It lists every mark and ribbon there is; the ones the Pokémon does not carry are greyed out (the user: "포켓몬 도감의
 * 증표 화면에서 증표를 얻지 않은것까지 표시하고, 얻지 않은것은 회색 혹은 반투명으로 표시").
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

/** The icons are 40 px squares shown at 11 px, ten to a row, so the whole list fits beside the menu */
const ICON_SCALE = 0.275;
const ICON_PITCH = 12;
const COLUMNS = 10;
/** A mark the Pokémon does not carry: grey and see-through */
const MISSING_TINT = 0x8a8a96;
const MISSING_ALPHA = 0.5;

export class MarkTray extends Phaser.GameObjects.Container {
  private trayBg: Phaser.GameObjects.NineSlice;
  private trayIcons: Phaser.GameObjects.Image[] = [];
  private trayCursorObj: Phaser.GameObjects.Image;
  private trayCursor = 0;
  /** The shown Pokémon's marks and alpha boost (alpha-pokemon.ts) */
  private owned: readonly PokemonMark[] = [];
  private alphaBoost = 0;

  private readonly handler: MessageUiHandler;

  constructor(handler: MessageUiHandler, x: number, y: number) {
    super(globalScene, x, y);
    this.handler = handler;

    this.trayBg = addWindow(0, 0, 0, 0).setOrigin(0);
    this.add(this.trayBg);

    // The cursor frame is made for 16 px icons
    this.trayCursorObj = globalScene.add.image(0, 0, "select_cursor").setOrigin(0).setScale(0.75);
    this.add(this.trayCursorObj);
  }

  public processInput(button: Button): boolean {
    const count = this.trayIcons.length;
    const cursor = this.trayCursor;
    switch (button) {
      case Button.UP:
        return this.setTrayCursor(cursor >= COLUMNS ? cursor - COLUMNS : cursor);
      case Button.DOWN:
        return this.setTrayCursor(cursor + COLUMNS < count ? cursor + COLUMNS : cursor);
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
      3.5 + (cursor % COLUMNS) * ICON_PITCH,
      3.5 + Math.floor(cursor / COLUMNS) * ICON_PITCH,
    );

    const mark = orderedPokemonMarks[cursor];
    if (mark !== undefined) {
      // An alpha's marks also say how much its stats are raised; a mark it does not carry says so
      const isAlphaMark = mark === PokemonMark.ALPHA_MARK || mark === PokemonMark.GOLDEN_ALPHA_MARK;
      const owned = this.owned.includes(mark);
      const note = owned
        ? isAlphaMark && this.alphaBoost > 0
          ? ` ${i18next.t("pokemonMarks:alphaBoost", { boost: this.alphaBoost })}`
          : ""
        : ` ${i18next.t("pokemonMarks:notObtained")}`;
      this.handler.showText(`${getMarkName(mark)}${note}\n${getMarkDescription(mark)}`);
    }

    return changed;
  }

  /**
   * Show the tray for a Pokémon, the cursor on the first mark it carries.
   * @param pokemon - The Pokémon whose marks and ribbons to show
   */
  public open(pokemon: Pokemon): void {
    this.close();
    this.owned = pokemon.marks.slice();
    this.alphaBoost = pokemon.alphaBoost;

    orderedPokemonMarks.forEach((mark, index) => {
      const icon = globalScene.add
        .image(
          10 + (index % COLUMNS) * ICON_PITCH,
          10 + Math.floor(index / COLUMNS) * ICON_PITCH,
          MARKS_ATLAS_KEY,
          getMarkKey(mark),
        )
        .setScale(ICON_SCALE);
      if (!this.owned.includes(mark)) {
        icon.setTint(MISSING_TINT).setTintMode(Phaser.TintModes.FILL).setAlpha(MISSING_ALPHA);
      }
      this.add(icon);
      this.trayIcons.push(icon);
    });
    this.bringToTop(this.trayCursorObj);

    const rows = Math.ceil(orderedPokemonMarks.length / COLUMNS);
    this.trayBg.setSize(8 + COLUMNS * ICON_PITCH, 8 + rows * ICON_PITCH);

    this.setVisible(true);
    this.trayCursor = -1;
    this.setTrayCursor(
      Math.max(
        orderedPokemonMarks.findIndex(m => this.owned.includes(m)),
        0,
      ),
    );
  }

  public close(): void {
    for (const icon of this.trayIcons) {
      this.remove(icon, true);
    }
    this.trayIcons = [];
    this.owned = [];
    this.setVisible(false);
  }
}
