import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { EnemyPersistentModifier } from "#modifiers/modifier";
import { getEnemyBuffModifierForWave, regenerateModifierPoolThresholds } from "#modifiers/modifier-type";

export class AddEnemyBuffModifierPhase extends Phase {
  public readonly phaseName = "AddEnemyBuffModifierPhase";
  start() {
    super.start();

    const waveIndex = globalScene.currentBattle.waveIndex;
    const tier = waveIndex % 1000 ? (waveIndex % 250 ? ModifierTier.COMMON : ModifierTier.GREAT) : ModifierTier.ULTRA;

    regenerateModifierPoolThresholds(globalScene.getEnemyParty(), ModifierPoolType.ENEMY_BUFF);

    const count = Math.ceil(waveIndex / 250);
    for (let i = 0; i < count; i++) {
      const modifier = getEnemyBuffModifierForWave(
        tier,
        globalScene.findModifiers(m => m instanceof EnemyPersistentModifier, false),
      );
      // Local fork (2026-11-13): no token left to draw once every one is at its cap (getEnemyBuffModifierForWave)
      if (modifier == null) {
        break;
      }
      globalScene.addEnemyModifier(modifier, true, true);
    }
    globalScene.updateModifiers(false, true);
    this.end();
  }
}
