import { globalScene } from "#app/global-scene";
import { PartyUiMode } from "#enums/party-ui-mode";
import { SwitchType } from "#enums/switch-type";
import { UiMode } from "#enums/ui-mode";
import { clearPursuitIntercepts, queuePursuitBeforeSwitch } from "#moves/custom-pursuit"; // Local fork (2026-11-20)
import { BattlePhase } from "#phases/battle-phase";
import { PartyOption, PartyUiHandler } from "#ui/party-ui-handler";

/**
 * Opens the party selector UI and transitions into a {@linkcode SwitchSummonPhase}
 * for the player (if a switch would be valid for the current battle state).
 */
export class SwitchPhase extends BattlePhase {
  public readonly phaseName = "SwitchPhase";
  protected readonly fieldIndex: number;
  private readonly switchType: SwitchType;
  private readonly isModal: boolean;
  private readonly doReturn: boolean;
  /**
   * Local fork (2026-11-20): Pursuit (따라가때리기) (the user: "따라가때리기 - 본가 그대로"). `"check"` for the switch of
   * the player's switching move (U-turn, Volt Switch ...; `ForceSwitchOutAttr`) while a foe's Pursuit waits: the
   * Pokémon is still on the field, and the Pursuit hits it first (custom-pursuit.ts); `"resume"` for that switch put
   * back in the queue behind the Pursuit; `"none"` for every other switch.
   */
  private readonly pursuitStage: "check" | "resume" | "none";

  /**
   * Creates a new SwitchPhase
   * @param switchType {@linkcode SwitchType} The type of switch logic this phase implements
   * @param fieldIndex Field index to switch out
   * @param isModal Indicates if the switch should be forced (true) or is
   * optional (false).
   * @param doReturn Indicates if the party member on the field should be
   * recalled to ball or has already left the field. Passed to {@linkcode SwitchSummonPhase},
   * and is (ostensibly) only set to `false` from `FaintPhase`.
   * @param pursuitStage - Local fork (2026-11-20): see {@linkcode SwitchPhase.pursuitStage}; default `"none"`
   */
  constructor(
    switchType: SwitchType,
    fieldIndex: number,
    isModal: boolean,
    doReturn: boolean,
    pursuitStage: "check" | "resume" | "none" = "none",
  ) {
    super();

    this.switchType = switchType;
    this.fieldIndex = fieldIndex;
    this.isModal = isModal;
    this.doReturn = doReturn;
    this.pursuitStage = pursuitStage;
  }

  start() {
    super.start();

    // Local fork (2026-11-20): Pursuit. A foe that chose Pursuit this turn and has not moved yet hits the Pokémon before
    // it leaves: its move goes first and this switch comes back right after it. Knocked out by it, the Pokémon does not
    // switch and is replaced like any fainted Pokémon (FaintPhase); otherwise it leaves the field now, as the switching
    // move does when no Pursuit waits (`ForceSwitchOutAttr.apply`)
    if (this.pursuitStage !== "none") {
      const pokemon = globalScene.getPlayerParty()[this.fieldIndex];
      if (this.pursuitStage === "check" && pokemon != null && queuePursuitBeforeSwitch(pokemon)) {
        globalScene.phaseManager.unshiftNew(
          "SwitchPhase",
          this.switchType,
          this.fieldIndex,
          this.isModal,
          this.doReturn,
          "resume",
        );
        return super.end();
      }
      clearPursuitIntercepts();
      if (!pokemon?.isActive(true)) {
        return super.end();
      }
      pokemon.leaveField(this.switchType === SwitchType.SWITCH);
    }

    // Skip modal switch if impossible (no remaining party members that aren't already in battle)
    if (this.isModal && globalScene.getPokemonAllowedInBattle().every(p => p.isOnField())) {
      return super.end();
    }

    /**
     * Skip if the fainted party member has been revived already. doReturn is
     * only passed as `false` from FaintPhase (as opposed to other usages such
     * as ForceSwitchOutAttr or CheckSwitchPhase), so we only want to check this
     * if the mon should have already been returned but is still alive and well
     * on the field. see also; battle.test.ts
     */
    // TODO: If a Phasing move kills its own user, when does said user appear on field?
    // Is it after the user faints
    if (this.isModal && !this.doReturn && !globalScene.getPlayerParty()[this.fieldIndex].isFainted()) {
      return super.end();
    }

    // Check if there is any space still in field
    if (this.isModal && globalScene.getPlayerField(true).length > globalScene.currentBattle.getBattlerCount()) {
      return super.end();
    }

    // Override field index to 0 in case of double battle where 2/3 remaining legal party members fainted at once
    const fieldIndex =
      globalScene.currentBattle.getBattlerCount() === 1 || globalScene.getPokemonAllowedInBattle().length > 1
        ? this.fieldIndex
        : 0;

    globalScene.ui.setMode(
      UiMode.PARTY,
      this.isModal ? PartyUiMode.FAINT_SWITCH : PartyUiMode.POST_BATTLE_SWITCH,
      fieldIndex,
      (slotIndex: number, option: PartyOption) => {
        if (slotIndex >= globalScene.currentBattle.getBattlerCount() && slotIndex < 6) {
          const switchType = option === PartyOption.PASS_BATON ? SwitchType.BATON_PASS : this.switchType;
          // Local fork (2026-11-20): a switching move's switch that waited for a Pursuit tells the summon so (moveSwitch)
          globalScene.phaseManager.unshiftNew(
            "SwitchSummonPhase",
            switchType,
            fieldIndex,
            slotIndex,
            this.doReturn,
            true,
            "none",
            this.pursuitStage !== "none",
          );
        }
        globalScene.ui.setMode(UiMode.MESSAGE).then(() => super.end());
      },
      PartyUiHandler.FilterNonFainted,
    );
  }
}
