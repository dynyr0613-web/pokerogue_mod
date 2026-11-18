import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { UiMode } from "#enums/ui-mode";
import { FieldPhase } from "#phases/field-phase";
import i18next from "i18next";

export class LevelCapPhase extends FieldPhase {
  public readonly phaseName = "LevelCapPhase";
  start(): void {
    super.start();

    globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
      // Sound loaded into game as is
      audioManager.playSound("se/level_up_fanfare");
      const levelCap = globalScene.getMaxExpLevel();
      globalScene.ui.showText(
        // Local fork (2026-11-18): Endless lifts the cap at wave 1000 ("1000웨이브 이후는 레벨캡은 그냥 풉시다"), so the
        // message says it is gone instead of "raised to 9007199254740991"
        levelCap >= Number.MAX_SAFE_INTEGER
          ? i18next.t("battle:levelCapLifted")
          : i18next.t("battle:levelCapUp", {
              levelCap,
            }),
        null,
        () => this.end(),
        null,
        true,
      );
      this.executeForAll(pokemon => pokemon.updateInfo(true));
    });
  }
}
