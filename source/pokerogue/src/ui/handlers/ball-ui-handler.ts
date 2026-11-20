import { globalScene } from "#app/global-scene";
import { formatCaptureChance, getBallCaptureChance } from "#data/capture-chance"; // Local fork (2026-11-20)
import { getPokeballAtlasKey, getPokeballName } from "#data/pokeball";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import type { CommandPhase } from "#phases/command-phase";
import { addTextObject, getTextStyleOptions } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";
import { fixedInt } from "#utils/common";
import i18next from "i18next";

/** Local fork (2026-11-20): the space between the ball counts and the capture chances (Q3) */
const CHANCE_GAP = 6;

export class BallUiHandler extends UiHandler {
  private pokeballSelectContainer: Phaser.GameObjects.Container;
  private pokeballSelectBg: Phaser.GameObjects.NineSlice;
  private optionsText: Phaser.GameObjects.Text;
  private cancelText: Phaser.GameObjects.Text;
  private countsText: Phaser.GameObjects.Text;
  /**
   * Local fork (2026-11-20): Q3, each ball's chance to catch the foe now, right of its count, always shown (the user:
   * "실행" to "볼 고를 때 포획 확률 표시"); "—" where the ball cannot be thrown (capture-chance.ts)
   */
  private chanceText: Phaser.GameObjects.Text;
  /** Local fork (2026-11-20): Q3, the chance text of each ball type as last shown (the touch panel reads it) */
  public chanceLabels: Record<number, string> = {};
  private readonly pokeballImages: Phaser.GameObjects.Image[] = [];

  private cursorObj: Phaser.GameObjects.Image | null;
  private pokeballWiggleTween: Phaser.Tweens.TweenChain | null = null;

  private scale = 0.1666666667;

  setup() {
    const ui = this.getUi();

    this.scale = getTextStyleOptions(TextStyle.WINDOW).scale;

    let optionsTextContent = "";

    for (let pb = 0; pb < Object.keys(globalScene.pokeballCounts).length; pb++) {
      optionsTextContent += `${pb > 0 ? "\n" : ""}${getPokeballName(pb)}`;
    }
    const pokeballCounts = Object.values(globalScene.pokeballCounts);
    this.optionsText = addTextObject(0, 0, optionsTextContent, TextStyle.WINDOW, { maxLines: 6 });
    this.cancelText = addTextObject(0, 0, i18next.t("commandUiHandler:ballCancel"), TextStyle.WINDOW);
    this.countsText = addTextObject(0, 0, pokeballCounts.map(count => `×${count}`).join("\n"), TextStyle.WINDOW, {
      align: "right",
      maxLines: pokeballCounts.length,
    });
    // Local fork (2026-11-20): Q3, filled in on `show`
    const noChances = pokeballCounts.map(() => formatCaptureChance(null)).join("\n");
    this.chanceText = addTextObject(0, 0, noChances, TextStyle.WINDOW, {
      align: "right",
      maxLines: pokeballCounts.length,
    });
    this.pokeballSelectContainer = globalScene.add
      .container(0, -49) //
      .setVisible(false);
    ui.add(this.pokeballSelectContainer);

    this.pokeballSelectBg = addWindow(0, 0, 0, 32 + 480 * this.scale) //
      .setOrigin(0, 1);
    for (let pb = 0; pb < Object.keys(globalScene.pokeballCounts).length; pb++) {
      const ballImage = globalScene.add
        .image(0, 0, "pb", getPokeballAtlasKey(pb))
        .setScale(this.scale * 6)
        .setPositionRelative(this.pokeballSelectBg, 24, 7 + (48 + pb * 96) * this.scale);
      this.pokeballImages.push(ballImage);
    }
    this.optionsText
      .setOrigin(0)
      .setPositionRelative(this.pokeballSelectBg, 36, 9)
      .setLineSpacing(this.scale * 72);

    this.cancelText.setPositionRelative(this.pokeballSelectBg, 18, 9 + this.optionsText.displayHeight);

    this.countsText
      .setPositionRelative(this.pokeballSelectBg, 0, 9) //
      .setLineSpacing(this.scale * 72);
    this.chanceText
      .setPositionRelative(this.pokeballSelectBg, 0, 9) //
      .setLineSpacing(this.scale * 72);

    this.pokeballSelectContainer.add([
      this.pokeballSelectBg,
      ...this.pokeballImages,
      this.optionsText,
      this.cancelText,
      this.countsText,
      this.chanceText,
    ]);
    this.updateLayout();

    this.setCursor(0);
  }

  show(args: any[]): boolean {
    super.show(args);

    this.updateChances(); // Local fork (2026-11-20): Q3; `updateCounts` lays the window out
    this.updateCounts();
    this.pokeballSelectContainer.setVisible(true);
    this.setCursor(this.cursor);

    return true;
  }

  processInput(button: Button): boolean {
    const ui = this.getUi();

    let success = false;

    const pokeballTypeCount = Object.keys(globalScene.pokeballCounts).length;

    if (button === Button.ACTION || button === Button.CANCEL) {
      const commandPhase = globalScene.phaseManager.getCurrentPhase() as CommandPhase;
      success = true;
      if (button === Button.ACTION && this.cursor < pokeballTypeCount) {
        if (globalScene.pokeballCounts[this.cursor]) {
          if (commandPhase.handleCommand(Command.BALL, this.cursor)) {
            globalScene.ui.setMode(UiMode.COMMAND, commandPhase.getFieldIndex());
            globalScene.ui.setMode(UiMode.MESSAGE);
            success = true;
          }
        } else {
          ui.playError();
        }
      } else {
        ui.setMode(UiMode.COMMAND, commandPhase.getFieldIndex());
        success = true;
      }
    } else {
      switch (button) {
        case Button.UP:
          success = this.setCursor(this.cursor ? this.cursor - 1 : pokeballTypeCount);
          break;
        case Button.DOWN:
          success = this.setCursor(this.cursor < pokeballTypeCount ? this.cursor + 1 : 0);
          break;
      }
    }

    if (success) {
      ui.playSelect();
    }

    return success;
  }

  updateCounts() {
    this.countsText.setText(
      Object.values(globalScene.pokeballCounts)
        .map(c => `×${c}`)
        .join("\n"),
    );
    this.updateLayout();
  }

  /**
   * Local fork (2026-11-20): Q3, each ball's chance to catch the single foe now, by the capture's own math
   * (capture-chance.ts); "—" when the ball cannot be thrown or there is no single foe
   */
  updateChances() {
    const labels: Record<number, string> = {};
    for (const pb of Object.keys(globalScene.pokeballCounts).map(Number)) {
      labels[pb] = formatCaptureChance(getBallCaptureChance(pb));
    }
    this.chanceLabels = labels;
    this.chanceText.setText(Object.values(labels).join("\n"));
  }

  private updateLayout() {
    // Local fork (2026-11-20): Q3, room for the capture chances right of the counts
    const contentWidth = Math.max(
      64,
      this.optionsText.displayWidth + 4 + this.countsText.displayWidth + CHANCE_GAP + this.chanceText.displayWidth,
      this.cancelText.displayWidth,
    );
    this.pokeballSelectBg.setSize(50 + contentWidth, 32 + 480 * this.scale);
    this.pokeballSelectContainer.setX(globalScene.scaledCanvas.width - 51 - contentWidth);
    this.countsText.setPositionRelative(this.pokeballSelectBg, 36 + this.optionsText.displayWidth + 4, 9);
    this.chanceText.setPositionRelative(
      this.pokeballSelectBg,
      36 + this.optionsText.displayWidth + 4 + this.countsText.displayWidth + CHANCE_GAP,
      9,
    );
  }

  setCursor(cursor: number): boolean {
    this.stopPokeballWiggle();
    const ret = super.setCursor(cursor);

    if (!this.cursorObj) {
      this.cursorObj = globalScene.add.image(0, 0, "cursor");
      this.pokeballSelectContainer.add(this.cursorObj);
    }

    this.cursorObj
      .setScale(this.scale * 6)
      .setPositionRelative(this.pokeballSelectBg, 12, 15 + (6 + this.cursor * 96) * this.scale);

    if (this.active && this.cursor < this.pokeballImages.length) {
      this.startPokeballWiggle(this.pokeballImages[this.cursor]);
    }

    return ret;
  }

  private startPokeballWiggle(pokeball: Phaser.GameObjects.Image) {
    this.pokeballWiggleTween = globalScene.tweens.chain({
      targets: pokeball,
      loop: -1,
      loopDelay: fixedInt(1000),
      // Note: Phaser's default type for this is incorrect
      onStop: (chain: Phaser.Tweens.TweenChain, originalX: number) => {
        (chain.currentTween.targets[0] as Phaser.GameObjects.Image)?.setX(originalX).setAngle(0);
      },
      onStopParams: [pokeball.x],
      tweens: [
        {
          x: "+=4",
          angle: 27.5,
          duration: fixedInt(150),
          ease: "Cubic.easeOut",
          yoyo: true,
        },
        {
          x: "-=4",
          angle: -27.5,
          duration: fixedInt(150),
          delay: fixedInt(250),
          ease: "Cubic.easeOut",
          yoyo: true,
        },
      ],
    });
  }

  private stopPokeballWiggle() {
    this.pokeballWiggleTween?.stop().destroy();
    this.pokeballWiggleTween = null;
  }

  clear() {
    super.clear();
    this.stopPokeballWiggle();
    this.pokeballSelectContainer.setVisible(false);
    this.eraseCursor();
  }

  eraseCursor() {
    if (this.cursorObj) {
      this.cursorObj.destroy();
    }
    this.cursorObj = null;
  }
}
