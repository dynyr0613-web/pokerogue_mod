import { globalScene } from "#app/global-scene";
import { settings } from "#app/global-settings-manager";
import { Button } from "#enums/buttons";
import { getStatKey, PERMANENT_STATS } from "#enums/stat";
import { TextStyle } from "#enums/text-style";
import { recordBattleMessage } from "#ui/battle-log";
import { MessageUiHandler } from "#ui/message-ui-handler";
import { addBBCodeTextObject, addTextObject, getTextColor } from "#ui/text";
import { addWindow } from "#ui/ui-theme";
import i18next from "i18next";
import type BBCodeText from "phaser4-rex-plugins/plugins/bbcodetext";

/**
 * Local fork (2026-11-20): Q8, after each IV the scanner shows that is higher than the player's record for the species
 * (the dex IVs, which IV Candies raise too); the user: "내 개체보다 높은 개체값을 (+)로 표시"
 */
export const IV_SCANNER_BETTER_MARK = " (+)";

/** Local fork (2026-11-20): Q8, the least space between the stat names and the values of the stats window */
const LEVEL_UP_STATS_MIN_GAP = 4;

export class BattleMessageUiHandler extends MessageUiHandler {
  private levelUpStatsContainer: Phaser.GameObjects.Container;
  private levelUpStatsIncrContent: Phaser.GameObjects.Text;
  private levelUpStatsValuesContent: BBCodeText;
  /** Local fork (2026-11-20): Q8, the stat names and window, widened to the left when the values need the room */
  private levelUpStatsLabelsContent: Phaser.GameObjects.Text;
  private levelUpStatsBg: Phaser.GameObjects.NineSlice;
  private levelUpStatsLabelsX: number;
  private levelUpStatsBgWidth: number;

  public bg: Phaser.GameObjects.Sprite;
  public commandWindow: Phaser.GameObjects.NineSlice;
  public movesWindowContainer: Phaser.GameObjects.Container;
  /** Local fork (2026-11-20): Q6, the speaker of the dialogue line being shown, for the battle log */
  private battleLogSpeaker: string | undefined;

  setup(): void {
    const ui = this.getUi();

    this.textTimer = null;
    this.textCallbackTimer = null;

    this.bg = globalScene.add.sprite(0, 0, "bg", settings.display.uiWindowStyle);
    this.bg.setName("sprite-battle-msg-bg");
    this.bg.setOrigin(0, 1);
    ui.add(this.bg);

    this.commandWindow = addWindow(202, 0, 118, 48);
    this.commandWindow.setName("window-command");
    this.commandWindow.setOrigin(0, 1);
    this.commandWindow.setVisible(false);
    ui.add(this.commandWindow);

    this.movesWindowContainer = globalScene.add.container(0, 0);
    this.movesWindowContainer.setName("moves-bg");
    this.movesWindowContainer.setVisible(false);

    const movesWindow = addWindow(0, 0, 243, 48);
    movesWindow.setName("moves-window");
    movesWindow.setOrigin(0, 1);

    const moveDetailsWindow = addWindow(240, 0, 80, 48, false, false, -1, 132);
    moveDetailsWindow.setName("move-details-window");
    moveDetailsWindow.setOrigin(0, 1);

    this.movesWindowContainer.add([movesWindow, moveDetailsWindow]);
    ui.add(this.movesWindowContainer);

    const messageContainer = globalScene.add.container(12, -39);
    ui.add(messageContainer);

    this.message = addTextObject(0, 0, "", TextStyle.MESSAGE, {
      maxLines: 2,
      wordWrap: {
        width: this.wordWrapWidth,
      },
    });
    messageContainer.add(this.message);

    this.initNameBox(messageContainer);
    this.initPromptSprite(messageContainer);

    const levelUpStatsContainer = globalScene.add.container(0, 0);
    levelUpStatsContainer.setVisible(false);
    ui.add(levelUpStatsContainer);

    this.levelUpStatsContainer = levelUpStatsContainer;

    const levelUpStatsLabelsContent = addTextObject(globalScene.scaledCanvas.width - 73, -94, "", TextStyle.WINDOW, {
      maxLines: 6,
    });
    let levelUpStatsLabelText = "";

    for (const s of PERMANENT_STATS) {
      levelUpStatsLabelText += `${i18next.t(getStatKey(s))}\n`;
    }
    levelUpStatsLabelsContent.text = levelUpStatsLabelText;
    levelUpStatsLabelsContent.x -= levelUpStatsLabelsContent.displayWidth;

    const levelUpStatsBg = addWindow(
      globalScene.scaledCanvas.width,
      -100,
      80 + levelUpStatsLabelsContent.displayWidth,
      100,
    );
    levelUpStatsBg.setOrigin(1, 0);
    levelUpStatsContainer.add(levelUpStatsBg);

    levelUpStatsContainer.add(levelUpStatsLabelsContent);

    // Local fork (2026-11-20): Q8, kept to widen the window for the IV scanner's "(+)" (`fitLevelUpStatsWindow`)
    this.levelUpStatsLabelsContent = levelUpStatsLabelsContent;
    this.levelUpStatsBg = levelUpStatsBg;
    this.levelUpStatsLabelsX = levelUpStatsLabelsContent.x;
    this.levelUpStatsBgWidth = levelUpStatsBg.width;

    const levelUpStatsIncrContent = addTextObject(
      globalScene.scaledCanvas.width - 50,
      -94,
      "+\n+\n+\n+\n+\n+",
      TextStyle.WINDOW,
      { maxLines: 6 },
    );
    levelUpStatsContainer.add(levelUpStatsIncrContent);

    this.levelUpStatsIncrContent = levelUpStatsIncrContent;

    const levelUpStatsValuesContent = addBBCodeTextObject(
      globalScene.scaledCanvas.width - 7,
      -94,
      "",
      TextStyle.WINDOW,
      { maxLines: 6, lineSpacing: 5 },
    );
    levelUpStatsValuesContent.setOrigin(1, 0);
    levelUpStatsValuesContent.setAlign("right");
    levelUpStatsContainer.add(levelUpStatsValuesContent);

    this.levelUpStatsValuesContent = levelUpStatsValuesContent;
  }

  show(args: any[]): boolean {
    super.show(args);

    this.commandWindow.setVisible(false);
    this.movesWindowContainer.setVisible(false);
    this.message.setWordWrapWidth(this.wordWrapWidth);

    return true;
  }

  processInput(button: Button): boolean {
    const ui = this.getUi();
    if (this.awaitingActionInput && (button === Button.CANCEL || button === Button.ACTION) && this.onActionInput) {
      ui.playSelect();
      const originalOnActionInput = this.onActionInput;
      this.onActionInput = null;
      originalOnActionInput();
      return true;
    }

    return false;
  }

  clear() {
    super.clear();
  }

  showText(
    text: string,
    delay?: number | null,
    callback?: (() => void) | null,
    callbackDelay?: number | null,
    prompt?: boolean | null,
    promptDelay?: number | null,
  ) {
    // Local fork (2026-11-20): Q6, the battle log keeps every battle message this box shows (the one place they are
    // shown), with the speaker of a dialogue line (src/ui/utils/battle-log.ts)
    recordBattleMessage(text, this.battleLogSpeaker);
    this.hideNameText();
    super.showText(text, delay, callback, callbackDelay, prompt, promptDelay);
  }

  showDialogue(
    text: string,
    name?: string,
    delay?: number | null,
    callback?: () => void,
    callbackDelay?: number,
    prompt?: boolean,
    promptDelay?: number,
  ) {
    // Local fork (2026-11-20): Q6, the dialogue goes through showText above, which logs it with this speaker
    this.battleLogSpeaker = name;
    try {
      super.showDialogue(text, name, delay, callback, callbackDelay, prompt, promptDelay);
    } finally {
      this.battleLogSpeaker = undefined;
    }
  }

  promptLevelUpStats(partyMemberIndex: number, prevStats: number[], showTotals: boolean): Promise<void> {
    return new Promise(resolve => {
      if (!settings.display.showStatsOnLevelUp) {
        return resolve();
      }
      const newStats = globalScene.getPlayerParty()[partyMemberIndex].stats;
      let levelUpStatsValuesText = "";
      for (const s of PERMANENT_STATS) {
        levelUpStatsValuesText += `${showTotals ? newStats[s] : newStats[s] - prevStats[s]}\n`;
      }
      this.levelUpStatsValuesContent.text = levelUpStatsValuesText;
      this.fitLevelUpStatsWindow(); // Local fork (2026-11-20): Q8, back to its own width after the IV scanner
      this.levelUpStatsIncrContent.setVisible(!showTotals);
      this.levelUpStatsContainer.setVisible(true);
      this.awaitingActionInput = true;
      this.onActionInput = () => {
        if (!showTotals) {
          return this.promptLevelUpStats(partyMemberIndex, [], true).then(() => resolve());
        }
        this.levelUpStatsContainer.setVisible(false);
        resolve();
      };
    });
  }

  promptIvs(pokemonId: number, ivs: number[]): Promise<void> {
    return new Promise(resolve => {
      globalScene.executeWithSeedOffset(() => {
        let levelUpStatsValuesText = "";
        for (const s of PERMANENT_STATS) {
          levelUpStatsValuesText += `${this.getIvDescriptor(ivs[s], s, pokemonId)}\n`;
        }
        this.levelUpStatsValuesContent.text = levelUpStatsValuesText;
        this.fitLevelUpStatsWindow(); // Local fork (2026-11-20): Q8, room for "(+)"
        this.levelUpStatsIncrContent.setVisible(false);
        this.levelUpStatsContainer.setVisible(true);
        this.awaitingActionInput = true;
        this.onActionInput = () => {
          this.levelUpStatsContainer.setVisible(false);
          resolve();
        };
      }, pokemonId);
    });
  }

  /**
   * Local fork (2026-11-20): Q8, the stats window at its own width, widened to the left (stat names with it) when the
   * values, such as the IV scanner's words with "(+)", would come closer than {@linkcode LEVEL_UP_STATS_MIN_GAP} to the
   * stat names
   */
  private fitLevelUpStatsWindow(): void {
    const labels = this.levelUpStatsLabelsContent;
    const bg = this.levelUpStatsBg;
    labels.setX(this.levelUpStatsLabelsX);
    bg.setSize(this.levelUpStatsBgWidth, bg.height);
    const values = this.levelUpStatsValuesContent;
    const valuesLeft = values.x - values.displayWidth;
    const shortfall = labels.x + labels.displayWidth + LEVEL_UP_STATS_MIN_GAP - valuesLeft;
    if (shortfall > 0) {
      labels.setX(labels.x - shortfall);
      bg.setSize(this.levelUpStatsBgWidth + shortfall, bg.height);
    }
  }

  getIvDescriptor(value: number, typeIv: number, pokemonId: number): string {
    const starterSpecies = globalScene.getPokemonById(pokemonId)!.species.getRootSpeciesId(); // we are using getRootSpeciesId() here because we want to check against the baby form, not the mid form if it exists
    const starterIvs: number[] = globalScene.gameData.dexData[starterSpecies].ivs;

    // Function to wrap text in color based on comparison
    const coloredText = (text: string, isBetter: boolean, ivValue) => {
      let textStyle: TextStyle;
      if (isBetter) {
        if (ivValue === 31) {
          textStyle = TextStyle.PERFECT_IV;
        } else {
          textStyle = TextStyle.SUMMARY_GREEN;
        }
      } else {
        textStyle = TextStyle.WINDOW;
      }
      const color = getTextColor(textStyle, false);
      // Local fork (2026-11-20): Q8, "(+)" after an IV higher than the player's record, besides the colour (the user:
      // "내 개체보다 높은 개체값을 (+)로 표시")
      const mark = isBetter ? IV_SCANNER_BETTER_MARK : "";
      return `[color=${color}][shadow=${getTextColor(textStyle, true)}]${text}${mark}[/shadow][/color]`;
    };

    if (value > 30) {
      return coloredText(i18next.t("battleMessageUiHandler:ivBest"), value > starterIvs[typeIv], value);
    }
    if (value === 30) {
      return coloredText(i18next.t("battleMessageUiHandler:ivFantastic"), value > starterIvs[typeIv], value);
    }
    if (value > 20) {
      return coloredText(i18next.t("battleMessageUiHandler:ivVeryGood"), value > starterIvs[typeIv], value);
    }
    if (value > 10) {
      return coloredText(i18next.t("battleMessageUiHandler:ivPrettyGood"), value > starterIvs[typeIv], value);
    }
    if (value > 0) {
      return coloredText(i18next.t("battleMessageUiHandler:ivDecent"), value > starterIvs[typeIv], value);
    }

    return coloredText(i18next.t("battleMessageUiHandler:ivNoGood"), value > starterIvs[typeIv], value);
  }
}
