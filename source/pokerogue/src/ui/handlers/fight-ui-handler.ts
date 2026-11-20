import type { InfoToggle } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { settings } from "#app/global-settings-manager";
import { getTypeDamageMultiplierColor } from "#data/type";
import { BattleType } from "#enums/battle-type";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { MoveCategory } from "#enums/move-category";
import { MoveStyle } from "#enums/move-style";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokemonType } from "#enums/pokemon-type";
import { TextStyle } from "#enums/text-style";
import { TypeHints } from "#enums/type-hints";
import { UiMode } from "#enums/ui-mode";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
// Local fork (2026-11-20): held-item moves (1.2.0 D5)
import {
  getFlingEntry,
  getHeldItemChoiceLabel,
  getHeldItemChoicePower,
  getHeldItemKey,
  getHeldItemMoveKind,
  getHeldItemMoveOptions,
  getNaturalGiftEntry,
  type HeldItemMoveKind,
} from "#moves/held-item-moves";
// Local fork (2026-11-20): S1 move styles
import {
  getMoveStylePowerMultiplier,
  isMoveStyleOffered,
  MOVE_STYLE_DEFAULT,
  MOVE_STYLE_MENU_ORDER,
} from "#moves/move-style";
import { getMoveTargets } from "#moves/move-utils";
import type { PokemonMove } from "#moves/pokemon-move";
import type { CommandPhase } from "#phases/command-phase";
import type { OptionSelectItem } from "#types/ui-types";
import { MoveInfoOverlay } from "#ui/move-info-overlay";
import { addTextObject, getTextColor } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { fixedInt, getLocalizedSpriteKey, padInt } from "#utils/common";
import i18next from "i18next";

/** Local fork (2026-11-20): S1 move styles. The label of each style in the style choice (fight-ui-handler.json) */
const MOVE_STYLE_LABEL_KEYS: Readonly<Record<MoveStyle, string>> = Object.freeze({
  [MoveStyle.STRONG]: "fightUiHandler:moveStyleStrong",
  [MoveStyle.NORMAL]: "fightUiHandler:moveStyleNormal",
  [MoveStyle.AGILE]: "fightUiHandler:moveStyleAgile",
});

export class FightUiHandler extends UiHandler implements InfoToggle {
  public static readonly MOVES_CONTAINER_NAME = "moves";

  private movesContainer: Phaser.GameObjects.Container;
  private moveInfoContainer: Phaser.GameObjects.Container;
  private typeIcon: Phaser.GameObjects.Sprite;
  private ppLabel: Phaser.GameObjects.Text;
  private ppText: Phaser.GameObjects.Text;
  private powerLabel: Phaser.GameObjects.Text;
  private powerText: Phaser.GameObjects.Text;
  private accuracyLabel: Phaser.GameObjects.Text;
  private accuracyText: Phaser.GameObjects.Text;
  private cursorObj: Phaser.GameObjects.Image | null;
  private moveCategoryIcon: Phaser.GameObjects.Sprite;
  private moveInfoOverlay: MoveInfoOverlay;

  protected fieldIndex = 0;
  protected fromCommand: Command = Command.FIGHT;
  protected cursor2 = 0;
  /**
   * Local fork (2026-11-20): held-item moves. Which small choice over the fight menu is open: the held item (Trick,
   * Switcheroo, Fling, Natural Gift) or the S1 style; `null` when none (the Dev Bridge reads it)
   */
  public openChoice: "heldItem" | "moveStyle" | null = null;
  /** Local fork (2026-11-20): held-item moves. The keys of the items the last item choice listed, in order */
  public heldItemChoiceKeys: readonly string[] = [];

  /**
   * Set the visibility of the objects in the move info container.
   */
  private setInfoVis(visibility: boolean): void {
    this.moveInfoContainer.iterate((o: Phaser.GameObjects.Components.Visible) => o.setVisible(visibility));
  }

  setup() {
    const ui = this.getUi();

    this.movesContainer = globalScene.add.container(18, -38.7).setName(FightUiHandler.MOVES_CONTAINER_NAME);
    ui.add(this.movesContainer);

    this.moveInfoContainer = globalScene.add.container(1, 0).setName("move-info");
    ui.add(this.moveInfoContainer);

    this.typeIcon = globalScene.add
      .sprite(globalScene.scaledCanvas.width - 57, -36, getLocalizedSpriteKey("types"), "unknown")
      .setVisible(false);

    this.moveCategoryIcon = globalScene.add
      .sprite(globalScene.scaledCanvas.width - 25, -36, "categories", "physical")
      .setVisible(false);

    this.ppLabel = addTextObject(globalScene.scaledCanvas.width - 70, -26, "PP", TextStyle.MOVE_INFO_CONTENT)
      .setOrigin(0.0, 0.5)
      .setVisible(false)
      .setText(i18next.t("fightUiHandler:pp"));

    this.ppText = addTextObject(globalScene.scaledCanvas.width - 12, -26, "--/--", TextStyle.MOVE_INFO_CONTENT)
      .setOrigin(1, 0.5)
      .setVisible(false);

    this.powerLabel = addTextObject(globalScene.scaledCanvas.width - 70, -18, "POWER", TextStyle.MOVE_INFO_CONTENT)
      .setOrigin(0.0, 0.5)
      .setVisible(false)
      .setText(i18next.t("fightUiHandler:power"));

    this.powerText = addTextObject(globalScene.scaledCanvas.width - 12, -18, "---", TextStyle.MOVE_INFO_CONTENT)
      .setOrigin(1, 0.5)
      .setVisible(false);

    this.accuracyLabel = addTextObject(globalScene.scaledCanvas.width - 70, -10, "ACC", TextStyle.MOVE_INFO_CONTENT)
      .setOrigin(0.0, 0.5)
      .setVisible(false)
      .setText(i18next.t("fightUiHandler:accuracy"));

    this.accuracyText = addTextObject(globalScene.scaledCanvas.width - 12, -10, "---", TextStyle.MOVE_INFO_CONTENT)
      .setOrigin(1, 0.5)
      .setVisible(false);

    this.moveInfoContainer.add([
      this.typeIcon,
      this.moveCategoryIcon,
      this.ppLabel,
      this.ppText,
      this.powerLabel,
      this.powerText,
      this.accuracyLabel,
      this.accuracyText,
    ]);

    // prepare move overlay
    this.moveInfoOverlay = new MoveInfoOverlay({
      delayVisibility: true,
      onSide: true,
      right: true,
      x: 0,
      y: -MoveInfoOverlay.getHeight(true),
      width: globalScene.scaledCanvas.width + 4,
      hideEffectBox: true,
      hideBg: true,
    });
    ui.add(this.moveInfoOverlay);
    // register the overlay to receive toggle events
    globalScene.addInfoToggle(this.moveInfoOverlay, this);
  }

  override show(args: [number?, Command?]): boolean {
    super.show(args);

    this.fieldIndex = args[0] ?? 0;
    this.fromCommand = args[1] ?? Command.FIGHT;

    const messageHandler = this.getUi().getMessageHandler();
    messageHandler.bg.setVisible(false);
    messageHandler.commandWindow.setVisible(false);
    messageHandler.movesWindowContainer.setVisible(true);
    const pokemon = (globalScene.phaseManager.getCurrentPhase() as CommandPhase).getPokemon();
    if (pokemon.summonData.turnCount <= 1) {
      this.setCursor(0);
    } else {
      this.setCursor(this.fieldIndex ? this.cursor2 : this.cursor);
    }
    this.displayMoves();
    this.toggleInfo(false); // in case cancel was pressed while info toggle is active
    this.active = true;
    return true;
  }

  /**
   * Process the player inputting the selected {@linkcode Button}.
   * @param button - The {@linkcode Button} being pressed
   * @returns Whether the input was successful (ie did anything).
   */
  processInput(button: Button): boolean {
    const ui = this.getUi();
    let success = false;
    const cursor = this.getCursor();

    switch (button) {
      case Button.ACTION:
        // Local fork (2026-11-20): held-item moves. Trick / Switcheroo / Fling / Natural Gift ask for the held item
        // first (then the style, for Fling and Natural Gift)
        if (this.tryShowHeldItemChoice(cursor)) {
          success = true;
          break;
        }
        // Local fork (2026-11-20): S1 move styles. A damaging move asks 강공 / 중공 / 속공 before it is chosen
        if (this.tryShowMoveStyleChoice(cursor)) {
          success = true;
          break;
        }
        if (
          (globalScene.phaseManager.getCurrentPhase() as CommandPhase).handleCommand(
            this.fromCommand,
            cursor,
            MoveUseMode.NORMAL,
          )
        ) {
          success = true;
        } else {
          ui.playError();
        }
        break;
      case Button.CANCEL: {
        // Cannot back out of fight menu if skipToFightInput is enabled
        const { battleType, mysteryEncounter } = globalScene.currentBattle;
        if (battleType !== BattleType.MYSTERY_ENCOUNTER || !mysteryEncounter?.skipToFightInput) {
          ui.setMode(UiMode.COMMAND, this.fieldIndex);
          success = true;
        }
        break;
      }
      case Button.UP:
        if (cursor >= 2) {
          success = this.setCursor(cursor - 2);
        }
        break;
      case Button.DOWN:
        if (cursor < 2) {
          success = this.setCursor(cursor + 2);
        }
        break;
      case Button.LEFT:
        if (cursor % 2 === 1) {
          success = this.setCursor(cursor - 1);
        }
        break;
      case Button.RIGHT:
        if (cursor % 2 === 0) {
          success = this.setCursor(cursor + 1);
        }
        break;
    }

    if (success) {
      ui.playSelect();
    }

    return success;
  }

  /**
   * Local fork (2026-11-20): S1 move styles (the user: "기술 선택 후 강공(위력 1.5배 ... 선공기일 경우 우선도 -1에 위력
   * 2배), 중공(그대로), 속공(위력 0.8배, 우선도 +1)"). For a usable move that takes a style (`isMoveStyleOffered`), and
   * while the setting "기술 스타일 선택" is on, show the small choice 강공 / 중공 / 속공 / 취소 over the fight menu, the
   * cursor on 중공. The highlighted style's power shows in the move info; a style chooses the move in it, 취소 (or
   * cancel) goes back to the move list.
   * @param cursor - The chosen move slot
   * @param heldItemKey - Local fork (2026-11-20): held-item moves. The held item already chosen for this move (Fling,
   *   Natural Gift): it goes into the command with the style, its power shows, and cancel goes back to the item choice
   * @returns Whether the choice was shown (else the move is chosen as before)
   */
  private tryShowMoveStyleChoice(cursor: number, heldItemKey?: string): boolean {
    if (!settings.general.moveStyleChoice) {
      return false;
    }
    const phase = globalScene.phaseManager.getCurrentPhase() as CommandPhase;
    const pokemon = phase.getPokemon();
    const slot = pokemon.getMoveset()[cursor];
    // An unusable move goes the usual way (its message, or Struggle)
    if (slot == null || !pokemon.trySelectMove(cursor)[0] || !isMoveStyleOffered(pokemon, slot)) {
      return false;
    }
    // Local fork (2026-11-20): held-item moves. Fling / Natural Gift have the chosen item's power
    const basePower = heldItemKey == null ? undefined : getHeldItemChoicePower(pokemon, slot.moveId, heldItemKey);

    const ui = this.getUi();
    const fromCommand = this.fromCommand;
    const options: OptionSelectItem[] = MOVE_STYLE_MENU_ORDER.map(style => ({
      label: i18next.t(MOVE_STYLE_LABEL_KEYS[style]),
      handler: () => {
        this.openChoice = null;
        ui.revertMode();
        if (!phase.handleCommand(fromCommand, cursor, MoveUseMode.NORMAL, undefined, style, heldItemKey)) {
          ui.playError();
        }
        return true;
      },
      onHover: () => this.showMoveStylePower(slot, style, basePower),
    }));
    options.push({
      label: i18next.t("menu:cancel"),
      // Local fork (2026-11-20): held-item moves. After an item choice, cancel goes back to it (one step back); the
      // menu stays open for that, since this handler opens it again itself
      keepOpen: heldItemKey != null,
      handler: () => {
        this.openChoice = null;
        ui.revertMode();
        if (heldItemKey == null || !this.tryShowHeldItemChoice(cursor, heldItemKey)) {
          this.showMoveStylePower(slot, MoveStyle.NORMAL);
        }
        return true;
      },
      onHover: () => this.showMoveStylePower(slot, MoveStyle.NORMAL, basePower),
    });

    this.openChoice = "moveStyle";
    ui.setOverlayMode(UiMode.OPTION_SELECT, {
      options,
      initialCursor: MOVE_STYLE_MENU_ORDER.indexOf(MOVE_STYLE_DEFAULT),
      // The option menus' usual 48 plus 2 px (the user, 11-20: "Hp는 가려도 괜찮고 ... 원래 위치에서 한두픽셀만 올리죠")
      yOffset: 50,
    });
    return true;
  }

  /**
   * Local fork (2026-11-20): S1 move styles. Show `slot`'s power in `style` in the move info
   * @param basePower - Local fork (2026-11-20): held-item moves. The power before the style (Fling / Natural Gift with
   *   the chosen item); the move's own power when left out
   */
  private showMoveStylePower(slot: PokemonMove, style: MoveStyle, basePower?: number): void {
    const move = slot.getMove();
    const power = basePower ?? move.power;
    this.powerText.setText(power >= 0 ? `${Math.floor(power * getMoveStylePowerMultiplier(style, move))}` : "---");
  }

  /**
   * Local fork (2026-11-20): held-item moves (1.2.0 D5; the user: "자연의은혜(나무열매 선택, 위력과 타입 표시 ...),
   * 트릭/바꿔치기(주는 템은 선택 ...), 내던지기(도구 선택)"). For a usable Trick / Switcheroo / Fling / Natural Gift
   * slot whose user holds an item it can use, list those items over the fight menu (with their icons; Fling lines show
   * the power, Natural Gift lines the type and power, which the move info also shows for the highlighted line), then
   * 취소. An item goes on to the S1 style choice when the move takes one (Fling, Natural Gift), else chooses the move;
   * 취소 (or cancel) goes back to the move list. Trick with nothing to give is chosen at once (it only takes).
   * @param cursor - The chosen move slot
   * @param initialKey - The item the cursor starts on (coming back from the style choice)
   * @returns Whether the choice was shown
   */
  private tryShowHeldItemChoice(cursor: number, initialKey?: string): boolean {
    const phase = globalScene.phaseManager.getCurrentPhase() as CommandPhase;
    const pokemon = phase.getPokemon();
    const slot = pokemon.getMoveset()[cursor];
    const kind = slot == null ? undefined : getHeldItemMoveKind(slot.moveId);
    // An unusable move goes the usual way (its message, or Struggle); a Z / Max slot has no item to choose
    if (slot == null || kind == null || slot.transform != null || !pokemon.trySelectMove(cursor)[0]) {
      return false;
    }
    // In a single battle the target is known, so Trick lists only what it can take
    const targets = getMoveTargets(pokemon, slot.getMove()).targets;
    const target = targets.length === 1 ? globalScene.getField()[targets[0]] : undefined;
    const items = getHeldItemMoveOptions(pokemon, slot.moveId, target?.isActive(true) ? target : undefined);
    if (items.length === 0) {
      return false;
    }

    const ui = this.getUi();
    const fromCommand = this.fromCommand;
    const options: OptionSelectItem[] = items.map(item => {
      const key = getHeldItemKey(item);
      return {
        label: getHeldItemChoiceLabel(item, kind),
        iconsConfig: [{ name: "items", frame: item.getIconFrame(), scale: 0.5 }],
        // The handler may open the style choice in this same menu, so the menu must not close itself afterwards
        keepOpen: true,
        handler: () => {
          this.openChoice = null;
          ui.revertMode();
          if (!this.tryShowMoveStyleChoice(cursor, key)) {
            this.showHeldItemMoveInfo(slot, kind);
            if (!phase.handleCommand(fromCommand, cursor, MoveUseMode.NORMAL, undefined, undefined, key)) {
              ui.playError();
            }
          }
          return true;
        },
        onHover: () => this.showHeldItemMoveInfo(slot, kind, item),
      };
    });
    options.push({
      label: i18next.t("menu:cancel"),
      handler: () => {
        this.openChoice = null;
        ui.revertMode();
        this.showHeldItemMoveInfo(slot, kind);
        return true;
      },
      onHover: () => this.showHeldItemMoveInfo(slot, kind),
    });

    const initial = initialKey == null ? 0 : items.findIndex(i => getHeldItemKey(i) === initialKey);
    this.openChoice = "heldItem";
    this.heldItemChoiceKeys = items.map(i => getHeldItemKey(i));
    ui.setOverlayMode(UiMode.OPTION_SELECT, {
      options,
      initialCursor: Math.max(initial, 0),
      maxOptions: 6,
      yOffset: 50, // where the S1 style choice opens
    });
    return true;
  }

  /**
   * Local fork (2026-11-20): held-item moves. Show in the move info the type and power `slot`'s move has with `item`
   * (Natural Gift: the berry's type and power; Fling: the item's power); the move's own without an item
   */
  private showHeldItemMoveInfo(slot: PokemonMove, kind: HeldItemMoveKind, item?: PokemonHeldItemModifier): void {
    const move = slot.getMove();
    const pokemon = (globalScene.phaseManager.getCurrentPhase() as CommandPhase).getPokemon();
    let type = pokemon.getMoveType(move);
    let power = move.power;
    if (item != null && kind === "berry") {
      const entry = getNaturalGiftEntry(item);
      type = entry?.type ?? type;
      power = entry?.power ?? power;
    } else if (item != null && kind === "throw") {
      power = getFlingEntry(item).power;
    }
    this.typeIcon.setTexture(getLocalizedSpriteKey("types"), PokemonType[type].toLowerCase());
    this.powerText.setText(power >= 0 ? `${power}` : "---");
  }

  /**
   * Adjust the visibility of move names and the cursor icon when the info overlay is toggled
   * @param visible - The visibility of the info overlay; the move names and cursor's visibility will be set to the opposite
   */
  toggleInfo(visible: boolean): void {
    // The info overlay will already fade in, so we should hide the move name text and cursor immediately
    // rather than adjusting alpha via a tween.
    if (visible) {
      this.movesContainer.setVisible(false).setAlpha(0);
      this.cursorObj?.setVisible(false).setAlpha(0);
      return;
    }
    globalScene.tweens.add({
      targets: [this.movesContainer, this.cursorObj],
      duration: fixedInt(125),
      ease: "Sine.easeInOut",
      alpha: 1,
    });
    this.movesContainer.setVisible(true);
    this.cursorObj?.setVisible(true);
  }

  isActive(): boolean {
    return this.active;
  }

  getCursor(): number {
    return this.fieldIndex ? this.cursor2 : this.cursor;
  }

  /** @returns TextStyle according to percentage of PP remaining */
  private static ppRatioToColor(ppRatio: number): TextStyle {
    if (ppRatio > 0.25 && ppRatio <= 0.5) {
      return TextStyle.MOVE_PP_HALF_FULL;
    }
    if (ppRatio > 0 && ppRatio <= 0.25) {
      return TextStyle.MOVE_PP_NEAR_EMPTY;
    }
    if (ppRatio === 0) {
      return TextStyle.MOVE_PP_EMPTY;
    }
    return TextStyle.MOVE_PP_FULL; // default to full if ppRatio is invalid
  }

  /**
   * Populate the move info overlay with the information of the move at the given cursor index
   * @param cursor - The cursor position to set the move info for
   */
  private setMoveInfo(cursor: number): void {
    const pokemon = (globalScene.phaseManager.getCurrentPhase() as CommandPhase).getPokemon();
    const moveset = pokemon.getMoveset();

    const hasMove = cursor < moveset.length;
    this.setInfoVis(hasMove);

    if (!hasMove) {
      return;
    }

    const pokemonMove = moveset[cursor];
    const moveType = pokemon.getMoveType(pokemonMove.getMove());
    const textureKey = getLocalizedSpriteKey("types");
    this.typeIcon.setTexture(textureKey, PokemonType[moveType].toLowerCase()).setScale(0.8);

    const moveCategory = pokemonMove.getMove().category;
    this.moveCategoryIcon.setTexture("categories", MoveCategory[moveCategory].toLowerCase()).setScale(1.0);
    const power = pokemonMove.getMove().power;
    const accuracy = pokemonMove.getMove().accuracy;
    const maxPP = pokemonMove.getMovePp();
    const pp = maxPP - pokemonMove.ppUsed;

    const ppLeftStr = padInt(pp, 2, "  ");
    const ppMaxStr = padInt(maxPP, 2, "  ");
    this.ppText.setText(`${ppLeftStr}/${ppMaxStr}`);
    this.powerText.setText(`${power >= 0 ? power : "---"}`);
    this.accuracyText.setText(`${accuracy >= 0 ? accuracy : "---"}`);

    const ppColorStyle = FightUiHandler.ppRatioToColor(pp / maxPP);

    // Changes the text color and shadow according to the determined TextStyle
    this.ppText.setColor(getTextColor(ppColorStyle, false)).setShadowColor(getTextColor(ppColorStyle, true));
    this.moveInfoOverlay.show(pokemonMove.getMove());

    pokemon.getOpponents().forEach(opponent => {
      (opponent as EnemyPokemon).updateEffectiveness(this.getEffectivenessText(pokemon, opponent, pokemonMove));
    });
  }

  setCursor(cursor: number): boolean {
    const ui = this.getUi();

    this.moveInfoOverlay.clear();
    const changed = this.getCursor() !== cursor;
    if (changed) {
      if (this.fieldIndex) {
        this.cursor2 = cursor;
      } else {
        this.cursor = cursor;
      }
    }

    this.setMoveInfo(cursor);

    if (!this.cursorObj) {
      const isTera = this.fromCommand === Command.TERA;
      this.cursorObj = globalScene.add.image(0, 0, isTera ? "cursor_tera" : "cursor");
      this.cursorObj.setScale(isTera ? 0.7 : 1);
      ui.add(this.cursorObj);
    }

    this.cursorObj.setPosition(13 + (cursor % 2 === 1 ? 114 : 0), -31 + (cursor >= 2 ? 15 : 0));

    return changed;
  }

  /**
   * Gets multiplier text for a pokemon's move against a specific opponent
   */
  private getEffectivenessText(pokemon: Pokemon, opponent: Pokemon, pokemonMove: PokemonMove): string | undefined {
    const effectiveness = opponent.getMoveEffectiveness(
      pokemon,
      pokemonMove.getMove(),
      !opponent.waveData.abilityRevealed,
      undefined,
      undefined,
      true,
    );
    if (pokemonMove.getMove().category === MoveCategory.STATUS) {
      if (effectiveness === 0) {
        return i18next.t("fightUiHandler:effectiveness000");
      }
      return i18next.t("fightUiHandler:effectiveness100");
    }

    return i18next.t("fightUiHandler:effectivenessMultiplier", { effectiveness });
  }

  displayMoves() {
    const pokemon = (globalScene.phaseManager.getCurrentPhase() as CommandPhase).getPokemon();
    const moveset = pokemon.getMoveset();

    for (let moveIndex = 0; moveIndex < 4; moveIndex++) {
      const moveText = addTextObject(
        moveIndex % 2 === 0 ? 0 : 114,
        moveIndex < 2 ? 0 : 16,
        "-",
        TextStyle.WINDOW,
      ).setName("text-empty-move");

      if (moveIndex < moveset.length) {
        const pokemonMove = moveset[moveIndex]!; // TODO is the bang correct?
        moveText
          .setText(pokemonMove.getName())
          .setName(pokemonMove.getName())
          .setColor(this.getMoveColor(pokemon, pokemonMove) ?? moveText.style.color);
      }

      this.movesContainer.add(moveText);
    }
  }

  /**
   * Returns a specific move's color based on its type effectiveness against opponents
   * If there are multiple opponents, the highest effectiveness' color is returned
   * @returns A color or undefined if the default color should be used
   */
  private getMoveColor(pokemon: Pokemon, pokemonMove: PokemonMove): string | undefined {
    if (settings.display.typeHintsMode === TypeHints.OFF) {
      return;
    }

    const opponents = pokemon.getOpponents();
    if (opponents.length <= 0) {
      return;
    }

    const moveColors = opponents
      .map(opponent =>
        opponent.getMoveEffectiveness(
          pokemon,
          pokemonMove.getMove(),
          !opponent.waveData.abilityRevealed,
          undefined,
          undefined,
          true,
        ),
      )
      .sort((a, b) => b - a)
      .map(effectiveness => {
        if (pokemonMove.getMove().category === MoveCategory.STATUS && effectiveness !== 0) {
          // biome-ignore lint/complexity/noUselessUndefined: intentional
          return undefined;
        }
        return getTypeDamageMultiplierColor(
          effectiveness ?? 0,
          "offense",
          settings.display.typeHintsMode === TypeHints.HIGH_CONTRAST,
        );
      });

    return moveColors[0];
  }

  clear() {
    super.clear();
    const messageHandler = this.getUi().getMessageHandler();
    this.clearMoves();
    this.setInfoVis(false);
    this.moveInfoOverlay.clear();
    messageHandler.bg.setVisible(true);
    this.eraseCursor();
    this.active = false;
  }

  clearMoves() {
    this.movesContainer.removeAll(true);

    const opponents = (globalScene.phaseManager.getCurrentPhase() as CommandPhase).getPokemon().getOpponents();
    opponents.forEach(opponent => {
      (opponent as EnemyPokemon).updateEffectiveness();
    });
  }

  eraseCursor() {
    if (this.cursorObj) {
      this.cursorObj.destroy();
    }
    this.cursorObj = null;
  }
}
