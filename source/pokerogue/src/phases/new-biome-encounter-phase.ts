import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { EncounterPhase } from "#phases/encounter-phase";

export class NewBiomeEncounterPhase extends EncounterPhase {
  public readonly phaseName = "NewBiomeEncounterPhase";

  protected override doEncounter(): void {
    audioManager.playBgm(undefined, true);

    // Reset all battle and wave data, perform form changes, etc.
    // We do this because new biomes are considered "arena transitions" akin to MEs and trainer battles
    for (const pokemon of globalScene.getPlayerParty()) {
      if (pokemon) {
        // Local fork (2026-11-20), review fix: the battle data was already reset for this battle when the last one
        // ended (`BattleScene.doPostBattleCleanup`), and `EncounterPhase.start` has since made (and saved) this battle's
        // Illusion (일루전) pick, so keep that pick through this second reset (the user: "일루전은 전투 시작할 때
        // 모방할 아군을 지정해서 아군들이 죽어도 모방하도록"). Without it a holder lost its pick on every new biome: a
        // bench holder picked again on entry, a lead that re-entered could change its look, and a reload disagreed.
        const { illusionAllyId } = pokemon.battleData;
        pokemon.resetBattleAndWaveData();
        pokemon.battleData.illusionAllyId = illusionAllyId;
        if (pokemon.isOnField()) {
          applyAbAttrs("PostBiomeChangeAbAttr", { pokemon });
        }
      }
    }

    const enemyField = globalScene.getEnemyField();
    const moveTargets: any[] = [globalScene.arenaEnemy, enemyField];
    // Endless rolls trainers on X6 waves, which start here instead of in NextEncounterPhase
    if (globalScene.currentBattle?.trainer) {
      moveTargets.push(globalScene.currentBattle.trainer);
    }
    const mysteryEncounter = globalScene.currentBattle?.mysteryEncounter?.introVisuals;
    if (mysteryEncounter) {
      moveTargets.push(mysteryEncounter);
    }

    globalScene.tweens.add({
      targets: moveTargets.flat(),
      x: "+=300",
      duration: 2000,
      onComplete: () => {
        if (globalScene.currentBattle.isClassicFinalBoss) {
          this.displayFinalBossDialogue();
        } else {
          this.doEncounterCommon();
        }
      },
    });
  }
}
