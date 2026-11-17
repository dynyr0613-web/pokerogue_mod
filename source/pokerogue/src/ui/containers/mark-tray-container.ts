/*
 * Local fork (2026-11-17): the tray of one Pokémon's marks (증표) and memorial ribbons (리본) on the Pokédex page
 * opened from the party, after `RibbonTray` (the species' challenge ribbons). See pokemon-marks.ts.
 *
 * It lists every mark and ribbon there is; the ones the Pokémon does not carry are greyed out (the user: "포켓몬 도감의
 * 증표 화면에서 증표를 얻지 않은것까지 표시하고, 얻지 않은것은 회색 혹은 반투명으로 표시").
 *
 * The same tray shows a starter line's collected marks on the Pokédex page opened anywhere else. Either way the
 * action button on a mark that is there wears it (its title goes before the name) or takes it off again, and the
 * header counts the marks: "증표 n/70" (the user: "증표 볼때 장착 가능하게", "포켓몬별 증표 n/50몇개").
 *
 * A mark that is not there is shown in one of two ways (the user: "아무 포켓몬도 획득한 적 없는 증표는 회색, 다른
 * 포켓몬은 얻은 적 있지만 이 포켓몬에게는 없는 증표는 어두운 색으로 해두고 설명도 다르게"): one the player has never
 * obtained on any Pokémon is a grey shape named "???" with "아직 획득한 적 없는 증표" for a description; one obtained
 * on another Pokémon is dark, with its name, "(미획득)" and its own description.
 */

import { globalScene } from "#app/global-scene";
import {
  COMPLETION_EXEMPT_MARKS,
  getMarkDescription,
  getMarkKey,
  getMarkName,
  hasEverObtainedMark,
  MARKS_ATLAS_KEY,
  orderedPokemonMarks,
} from "#data/pokemon-marks";
import { Button } from "#enums/buttons";
import { PokemonMark } from "#enums/pokemon-mark";
import { TextStyle } from "#enums/text-style";
import type { MessageUiHandler } from "#ui/message-ui-handler";
import { addTextObject } from "#ui/text";
import { addWindow } from "#ui/ui-theme";
import i18next from "i18next";
import Phaser from "phaser";

/** The icons are 40 px squares shown at 11 px, ten to a row, so the whole list fits beside the menu */
const ICON_SCALE = 0.275;
const ICON_PITCH = 12;
const COLUMNS = 10;
/** A mark the player has never obtained on any Pokémon: a grey, see-through shape */
const MISSING_TINT = 0x8a8a96;
const MISSING_ALPHA = 0.5;
/** A mark obtained on another Pokémon but not there: darkened */
const DARK_TINT = 0x4a4a58;
/** The header line with the count, above the icons */
const HEADER_HEIGHT = 9;

/**
 * Local fork (2026-11-18): the tray's height, with every mark and ribbon in rows of ten. With the hidden marks and
 * ribbons of 2026-11-18 there are 84: nine rows, 125 px from the top of the Pokédex page, above the two-line message
 * box (42 px at the bottom of the 180 px screen) that describes the mark under the cursor; up to 90 still fit
 * (custom-hidden-marks-1118.test.ts checks it).
 */
export function getMarkTrayHeight(): number {
  return HEADER_HEIGHT + 8 + Math.ceil(orderedPokemonMarks.length / COLUMNS) * ICON_PITCH;
}
/** The frame around the worn mark */
const EQUIPPED_TINT = 0xf8d030;

/** The golden outline of the marks of a complete collection, and how far it stands out, in px */
const GOLD_TINT = 0xf8d030;
const OUTLINE_OFFSETS: readonly [number, number][] = [
  [-0.5, 0],
  [0.5, 0],
  [0, -0.5],
  [0, 0.5],
];

/**
 * Local fork (2026-11-17): the golden outline of a mark icon (the user: "한 포켓몬의 도감을 전부 채울경우 모든 증표/리본
 * 테두리에 금색"): four golden copies of the icon, each half a pixel to one side, to put under it.
 * The same outline goes around the icon of a Pokémon whose line has collected everything (starter select, the mark
 * Pokédex: "도감을 완성한 포켓몬 금테두리").
 * @param icon - The mark's icon, or a Pokémon's
 * @returns The copies, not yet added to anything
 */
export function createMarkOutline(icon: Phaser.GameObjects.Image): Phaser.GameObjects.Image[] {
  return OUTLINE_OFFSETS.map(([dx, dy]) =>
    globalScene.add
      .image(icon.x + dx, icon.y + dy, icon.texture.key, icon.frame.name)
      .setOrigin(icon.originX, icon.originY)
      .setScale(icon.scaleX, icon.scaleY)
      .setTint(GOLD_TINT)
      .setTintMode(Phaser.TintModes.FILL),
  );
}

/** Whose marks the tray shows, and what wearing one does */
export interface MarkTraySource {
  /** The marks that are there (a Pokémon's, or a starter line's collection) */
  readonly owned: readonly PokemonMark[];
  /**
   * Whether the collection is complete (`isMarkCollectionComplete`): its marks then get a golden outline. For a party
   * Pokémon this is its starter line's collection, the same as on the Pokédex page of the species.
   */
  readonly complete: boolean;
  /** The alpha boost to quote with the alpha marks, 0 for none */
  readonly alphaBoost: number;
  /** The worn mark, `null` for none */
  equipped: PokemonMark | null;
  /** Wear the mark, or none with `null` */
  setEquipped(mark: PokemonMark | null): void;
}

export class MarkTray extends Phaser.GameObjects.Container {
  private trayBg: Phaser.GameObjects.NineSlice;
  private trayIcons: Phaser.GameObjects.Image[] = [];
  private trayOutlines: Phaser.GameObjects.Image[] = [];
  private trayCursorObj: Phaser.GameObjects.Image;
  private trayCursor = 0;
  private headerText: Phaser.GameObjects.Text;
  private equippedFrame: Phaser.GameObjects.Image;
  private source: MarkTraySource | null = null;

  private readonly handler: MessageUiHandler;

  constructor(handler: MessageUiHandler, x: number, y: number) {
    super(globalScene, x, y);
    this.handler = handler;

    this.trayBg = addWindow(0, 0, 0, 0).setOrigin(0);
    this.add(this.trayBg);

    // The cursor frame is made for 16 px icons
    this.trayCursorObj = globalScene.add.image(0, 0, "select_cursor").setOrigin(0).setScale(0.75);
    this.add(this.trayCursorObj);

    this.equippedFrame = globalScene.add.image(0, 0, "select_cursor").setOrigin(0).setScale(0.75).setVisible(false);
    this.add(this.equippedFrame);

    this.headerText = addTextObject(6, 3, "", TextStyle.WINDOW, { fontSize: "44px" }).setOrigin(0);
    this.add(this.headerText);
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
      case Button.ACTION:
        return this.toggleEquipped();
    }
    return false;
  }

  /** Wear the mark under the cursor, or take it off if it is the worn one; only a mark that is there */
  private toggleEquipped(): boolean {
    const mark = orderedPokemonMarks[this.trayCursor];
    if (!this.source || mark === undefined || !this.source.owned.includes(mark)) {
      return false;
    }
    const equipped = this.source.equipped === mark ? null : mark;
    this.source.setEquipped(equipped);
    this.source.equipped = equipped;
    this.updateEquippedFrame();
    this.setTrayCursor(this.trayCursor);
    return true;
  }

  private getIconPosition(index: number): [x: number, y: number] {
    return [3.5 + (index % COLUMNS) * ICON_PITCH, HEADER_HEIGHT + 3.5 + Math.floor(index / COLUMNS) * ICON_PITCH];
  }

  private updateEquippedFrame(): void {
    const index = this.source?.equipped == null ? -1 : orderedPokemonMarks.indexOf(this.source.equipped);
    this.equippedFrame.setVisible(index >= 0);
    if (index >= 0) {
      this.equippedFrame.setTint(EQUIPPED_TINT).setTintMode(Phaser.TintModes.FILL);
      this.equippedFrame.setPosition(...this.getIconPosition(index));
    }
  }

  private setTrayCursor(cursor: number): boolean {
    cursor = Phaser.Math.Clamp(cursor, 0, Math.max(this.trayIcons.length - 1, 0));
    const changed = this.trayCursor !== cursor;
    this.trayCursor = cursor;

    this.trayCursorObj.setPosition(...this.getIconPosition(cursor));

    const mark = orderedPokemonMarks[cursor];
    if (mark !== undefined && this.source) {
      // An alpha's marks also say how much its stats are raised; a mark that is not there says so, the worn one too
      const isAlphaMark = mark === PokemonMark.ALPHA_MARK || mark === PokemonMark.GOLDEN_ALPHA_MARK;
      const owned = this.source.owned.includes(mark);
      if (!owned && !hasEverObtainedMark(mark)) {
        this.handler.showText(`${i18next.t("pokemonMarks:unknownName")}\n${i18next.t("pokemonMarks:neverObtained")}`);
        return changed;
      }
      const note = owned
        ? this.source.equipped === mark
          ? ` ${i18next.t("pokemonMarks:equipped")}`
          : isAlphaMark && this.source.alphaBoost > 0
            ? ` ${i18next.t("pokemonMarks:alphaBoost", { boost: this.source.alphaBoost })}`
            : ""
        : ` ${i18next.t("pokemonMarks:notObtained")}`;
      this.handler.showText(`${getMarkName(mark)}${note}\n${getMarkDescription(mark)}`);
    }

    return changed;
  }

  /**
   * Show the tray, the cursor on the worn mark or else the first mark that is there.
   * @param source - Whose marks and ribbons to show
   */
  public open(source: MarkTraySource): void {
    this.close();
    this.source = source;

    orderedPokemonMarks.forEach((mark, index) => {
      const [x, y] = this.getIconPosition(index);
      const icon = globalScene.add.image(x + 6.5, y + 6.5, MARKS_ATLAS_KEY, getMarkKey(mark)).setScale(ICON_SCALE);
      if (!source.owned.includes(mark)) {
        if (hasEverObtainedMark(mark)) {
          icon.setTint(DARK_TINT).setTintMode(Phaser.TintModes.MULTIPLY);
        } else {
          icon.setTint(MISSING_TINT).setTintMode(Phaser.TintModes.FILL).setAlpha(MISSING_ALPHA);
        }
      }
      if (source.complete && source.owned.includes(mark)) {
        const outline = createMarkOutline(icon);
        this.add(outline);
        this.trayOutlines.push(...outline);
      }
      this.add(icon);
      this.trayIcons.push(icon);
    });
    this.bringToTop(this.equippedFrame);
    this.bringToTop(this.trayCursorObj);

    this.trayBg.setSize(8 + COLUMNS * ICON_PITCH, getMarkTrayHeight());
    this.headerText.setText(
      i18next.t("pokemonMarks:count", {
        count: orderedPokemonMarks.filter(m => source.owned.includes(m)).length,
        // The hidden marks count past the total, as in the mark Pokédex
        total: orderedPokemonMarks.filter(m => !COMPLETION_EXEMPT_MARKS.includes(m)).length,
      }),
    );
    this.updateEquippedFrame();

    this.setVisible(true);
    this.trayCursor = -1;
    const start = source.equipped ?? orderedPokemonMarks.find(m => source.owned.includes(m));
    this.setTrayCursor(Math.max(start === undefined ? 0 : orderedPokemonMarks.indexOf(start), 0));
  }

  public close(): void {
    for (const icon of this.trayIcons) {
      this.remove(icon, true);
    }
    for (const outline of this.trayOutlines) {
      this.remove(outline, true);
    }
    this.trayIcons = [];
    this.trayOutlines = [];
    this.source = null;
    this.setVisible(false);
  }
}
