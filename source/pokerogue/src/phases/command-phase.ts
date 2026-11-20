import type { TurnCommand } from "#app/battle";
import { globalScene } from "#app/global-scene";
import { settings } from "#app/global-settings-manager";
import { getPokemonNameWithAffix } from "#app/messages";
import { TrappedTag } from "#data/battler-tags";
import { getBallFieldBlockKey, getBossBallBlockKey } from "#data/capture-chance"; // Local fork (2026-11-20)
import { allAbilities } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattleType } from "#enums/battle-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BiomeId } from "#enums/biome-id";
import { Command } from "#enums/command";
import { FieldPosition } from "#enums/field-position";
import { MoveId } from "#enums/move-id";
import { MoveStyle } from "#enums/move-style";
import { isIgnorePP, isVirtual, MoveUseMode } from "#enums/move-use-mode";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
// Local fork (2026-11-20): held-item moves (1.2.0 D5)
import { getHeldItemKey, getHeldItemMoveKind, getHeldItemMoveOptions } from "#moves/held-item-moves";
import { isMoveStyleOffered } from "#moves/move-style"; // Local fork (2026-11-20): S1 move styles
import { getSlotMove } from "#moves/move-transform"; // Local fork (2026-11-16): Z / Max moves
import { getMoveTargets } from "#moves/move-utils";
import { FieldPhase } from "#phases/field-phase";
import type { MoveTargetSet } from "#types/move-target-set";
import type { TurnMove } from "#types/turn-move";
import i18next from "i18next";

export class CommandPhase extends FieldPhase {
  public readonly phaseName = "CommandPhase";
  protected fieldIndex: number;

  /**
   * Whether the command phase is handling a switch command
   */
  private isSwitch = false;

  constructor(fieldIndex: number) {
    super();

    this.fieldIndex = fieldIndex;
  }

  /**
   * Resets the cursor to the position of {@linkcode Command.FIGHT} if any of the following are true
   * - The setting to remember the last action is not enabled
   * - This is the first turn of a mystery encounter, trainer battle, or the END biome
   * - The cursor is currently on the POKEMON command
   */
  private resetCursorIfNeeded(): void {
    const commandUiHandler = globalScene.ui.handlers[UiMode.COMMAND];
    if (!commandUiHandler) {
      return;
    }

    const { battleCursorMemory } = settings.general;
    const { arena, currentBattle } = globalScene;
    const { battleType, turn } = currentBattle;
    const { biomeId } = arena;

    /** If one of these conditions is true, we always reset the cursor to `Command.FIGHT` on the first turn */
    const cursorResetEvent =
      battleType === BattleType.MYSTERY_ENCOUNTER || battleType === BattleType.TRAINER || biomeId === BiomeId.END;
    const turnOneReset = turn === 1 && (!battleCursorMemory || cursorResetEvent);

    if (turnOneReset || commandUiHandler.getCursor() === Command.POKEMON) {
      commandUiHandler.setCursor(Command.FIGHT);
    }
  }

  /**
   * Submethod of {@linkcode start} that validates field index logic for nonzero field indices.
   * Must only be called if the field index is nonzero.
   */
  private handleFieldIndexLogic(): void {
    // If we somehow are attempting to check the right pokemon but there's only one pokemon out
    // Switch back to the center pokemon. This can happen rarely in double battles with mid turn switching
    // TODO: Prevent this from happening in the first place
    if (globalScene.getPlayerField().filter(p => p.isActive()).length === 1) {
      const activeIndex = globalScene.getPlayerField().findIndex(p => p.isActive());
      this.fieldIndex = activeIndex === -1 ? FieldPosition.CENTER : activeIndex;
      return;
    }

    const allyCommand = globalScene.currentBattle.turnCommands[this.fieldIndex - 1];
    if (allyCommand?.command === Command.BALL || allyCommand?.command === Command.RUN) {
      globalScene.currentBattle.turnCommands[this.fieldIndex] = {
        command: allyCommand?.command,
        skip: true,
      };
    }
  }

  /**
   * Submethod of {@linkcode start} that sets the turn command to skip if this pokemon
   * is commanding its ally via {@linkcode AbilityId.COMMANDER}.
   */
  private checkCommander(): void {
    // If the Pokemon has applied Commander's effects to its ally, skip this command
    if (
      globalScene.currentBattle?.double
      && this.getPokemon().getAlly()?.getTag(BattlerTagType.COMMANDED)?.getSourcePokemon() === this.getPokemon()
    ) {
      globalScene.currentBattle.turnCommands[this.fieldIndex] = {
        command: Command.FIGHT,
        move: { move: MoveId.NONE, targets: [], useMode: MoveUseMode.NORMAL },
        skip: true,
      };
    }
  }

  /**
   * Clear out all unusable moves in front of the currently acting pokemon's move queue.
   */
  // TODO: Refactor move queue handling to ensure that this method is not necessary.
  private clearUnusableMoves(): void {
    const playerPokemon = this.getPokemon();
    const moveQueue = playerPokemon.getMoveQueue();
    if (moveQueue.length === 0) {
      return;
    }

    let entriesToDelete = 0;
    const moveset = playerPokemon.getMoveset();
    for (const queuedMove of moveQueue) {
      const movesetQueuedMove = moveset.find(m => m.moveId === queuedMove.move);
      if (
        queuedMove.move !== MoveId.NONE
        && !isVirtual(queuedMove.useMode)
        && !(movesetQueuedMove?.isUsable(playerPokemon, isIgnorePP(queuedMove.useMode), true)?.[0] ?? false)
      ) {
        entriesToDelete++;
      } else {
        break;
      }
    }
    if (entriesToDelete) {
      moveQueue.splice(0, entriesToDelete);
    }
  }

  /**
   * Attempt to execute the first usable move in this Pokemon's move queue
   * @returns Whether a queued move was successfully set to be executed.
   */
  private tryExecuteQueuedMove(): boolean {
    this.clearUnusableMoves();
    const playerPokemon = globalScene.getPlayerField()[this.fieldIndex];
    const moveQueue = playerPokemon.getMoveQueue();

    if (moveQueue.length === 0) {
      return false;
    }

    const queuedMove = moveQueue[0];
    if (queuedMove.move === MoveId.NONE) {
      this.handleCommand(Command.FIGHT, -1);
      return true;
    }
    const moveIndex = playerPokemon.getMoveset().findIndex(m => m.moveId === queuedMove.move);
    if (!isVirtual(queuedMove.useMode) && moveIndex === -1) {
      globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
    } else {
      this.handleCommand(Command.FIGHT, moveIndex, queuedMove.useMode, queuedMove);
    }

    return true;
  }

  public override start(): void {
    super.start();

    globalScene.updateGameInfo();
    this.resetCursorIfNeeded();

    if (this.fieldIndex) {
      this.handleFieldIndexLogic();
    }

    this.checkCommander();

    if (globalScene.currentBattle.turnCommands[this.fieldIndex]?.skip) {
      this.end();
      return;
    }

    if (this.tryExecuteQueuedMove()) {
      return;
    }

    if (
      globalScene.currentBattle.isBattleMysteryEncounter()
      && globalScene.currentBattle.mysteryEncounter?.skipToFightInput
    ) {
      globalScene.ui.clearText();
      globalScene.ui.setMode(UiMode.FIGHT, this.fieldIndex);
    } else {
      globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
    }
  }

  /**
   * Submethod of {@linkcode handleFightCommand} responsible for queuing the provided error message when the move cannot be used
   * @param msg - The reason why the move cannot be used
   */
  private queueFightErrorMessage(msg: string): void {
    const ui = globalScene.ui;
    ui.setMode(UiMode.MESSAGE);
    ui.showText(
      msg,
      null,
      () => {
        ui.clearText();
        ui.setMode(UiMode.FIGHT, this.fieldIndex);
      },
      null,
      true,
    );
  }

  /**
   * Helper method for {@linkcode handleFightCommand} that returns the moveID for the phase
   * based on the move passed in or the cursor.
   *
   * Does not check if the move is usable or not, that should be handled by the caller.
   */
  private computeMoveId(playerPokemon: PlayerPokemon, cursor: number, move: TurnMove | undefined): MoveId {
    return move?.move ?? (cursor > -1 ? playerPokemon.getMoveset()[cursor]?.moveId : MoveId.NONE);
  }

  /**
   * Process the logic for executing a fight-related command
   *
   * @remarks
   * - Validates whether the move can be used, using struggle if not
   * - Constructs the turn command and inserts it into the battle's turn commands
   *
   * @param command - The command to handle (FIGHT or TERA)
   * @param cursor - The index that the cursor is placed on, or -1 if no move can be selected.
   * @param ignorePP - Whether to ignore PP when checking if the move can be used.
   * @param move - The move to force the command to use, if any.
   * @param moveStyle - Local fork (2026-11-20): S1 move styles. The style chosen in the fight menu, if any
   * @param heldItemKey - Local fork (2026-11-20): held-item moves. The held item chosen in the fight menu, if any
   */
  private handleFightCommand(
    command: Command.FIGHT | Command.TERA,
    cursor: number,
    useMode: MoveUseMode = MoveUseMode.NORMAL,
    move?: TurnMove,
    moveStyle?: MoveStyle,
    heldItemKey?: string,
  ): boolean {
    const playerPokemon = this.getPokemon();
    const ignorePP = isIgnorePP(useMode);
    const [canUse, reason] = cursor === -1 ? [true, ""] : playerPokemon.trySelectMove(cursor, ignorePP);

    // Ternary here ensures we don't compute struggle conditions unless necessary
    const useStruggle = canUse
      ? false
      : cursor > -1 && !playerPokemon.getMoveset().some(m => m.isUsable(playerPokemon, ignorePP, true)[0]);

    if (!canUse && !useStruggle) {
      this.queueFightErrorMessage(reason);
      return false;
    }

    const moveId = useStruggle ? MoveId.STRUGGLE : this.computeMoveId(playerPokemon, cursor, move);

    const turnCommand: TurnCommand = {
      command: Command.FIGHT,
      cursor,
      move: { move: moveId, targets: [], useMode },
      args: [useMode, move],
    };
    // Local fork (2026-11-20): S1 move styles (the user: "기술 선택 후 강공 ... 속공"). The style chosen in the fight menu,
    // or the one the charging turn of a two-turn move queued; recorded only for a move that takes a style
    const style = moveStyle ?? move?.moveStyle;
    if (
      style != null
      && style !== MoveStyle.NORMAL
      && !useStruggle
      && isMoveStyleOffered(
        playerPokemon,
        playerPokemon.getMoveset().find(m => m.moveId === moveId),
      )
    ) {
      turnCommand.moveStyle = style;
    }
    // Local fork (2026-11-20): held-item moves (the user: "트릭/바꿔치기(주는 템은 선택 ...), 내던지기(도구 선택),
    // 자연의은혜(나무열매 선택 ...)"). The item chosen in the fight menu, recorded only for that move while the item is
    // still usable (the move reads it, held-item-moves.ts)
    if (
      heldItemKey != null
      && !useStruggle
      && getHeldItemMoveKind(moveId) != null
      && getHeldItemMoveOptions(playerPokemon, moveId).some(i => getHeldItemKey(i) === heldItemKey)
    ) {
      turnCommand.heldItemKey = heldItemKey;
    }
    const preTurnCommand: TurnCommand = {
      command,
      targets: [this.fieldIndex],
      skip: command === Command.FIGHT,
    };

    const moveTargets: MoveTargetSet =
      // `move.targets` normally shouldn't be `null`,
      // that check is to guard against bugs that can cause it to become `null`
      // Local fork (2026-11-16): Z / Max moves. The targets of the slot's derived move (Earthquake made Max Quake
      // picks one target)
      move === undefined || move.targets == null
        ? getMoveTargets(playerPokemon, getSlotMove(playerPokemon, moveId))
        : {
            targets: move.targets,
            multiple: move.targets.length > 1,
          };

    if (moveId === MoveId.NONE) {
      turnCommand.targets = [this.fieldIndex];
    }

    console.log(
      "Move:",
      MoveId[moveId],
      "Move targets:",
      moveTargets,
      "\nPlayer Pokemon:",
      getPokemonNameWithAffix(playerPokemon),
    );

    if (moveTargets.targets.length > 1 && moveTargets.multiple) {
      globalScene.phaseManager.unshiftNew("SelectTargetPhase", this.fieldIndex);
    }

    if (turnCommand.move && (moveTargets.targets.length <= 1 || moveTargets.multiple)) {
      turnCommand.move.targets = moveTargets.targets;
    } else if (
      turnCommand.move
      && playerPokemon.getTag(BattlerTagType.CHARGING)
      && playerPokemon.getMoveQueue().length > 0
    ) {
      turnCommand.move.targets = playerPokemon.getMoveQueue()[0].targets;
    } else {
      globalScene.phaseManager.unshiftNew("SelectTargetPhase", this.fieldIndex);
    }

    globalScene.currentBattle.preTurnCommands[this.fieldIndex] = preTurnCommand;
    globalScene.currentBattle.turnCommands[this.fieldIndex] = turnCommand;

    return true;
  }

  /**
   * Set the mode in preparation to show the text, and then show the text.
   * Only works for parameterless i18next keys.
   * @param key - The i18next key for the text to show
   */
  private queueShowText(key: string): void {
    globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
    globalScene.ui.setMode(UiMode.MESSAGE);

    globalScene.ui.showText(
      i18next.t(key),
      null,
      () => {
        globalScene.ui.showText("", 0);
        globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
      },
      null,
      true,
    );
  }

  /**
   * Helper method for {@linkcode handleBallCommand} that checks if a pokeball can be thrown
   * and displays the appropriate error message.
   *
   * @remarks
   * The pokeball may not be thrown if any of the following are true:
   * - It is a trainer battle
   * - The player is in the {@linkcode BiomeId.END | End} biome and
   *   - it is not classic mode; or
   *   - the player has not caught the target before and the player is still missing more than one starter
   * - The player is in a mystery encounter that disallows catching the pokemon
   * @returns Whether a pokeball can be thrown
   */
  private checkCanUseBall(): boolean {
    // Local fork (2026-11-20): the rules moved unchanged to capture-chance.ts, which the ball menu's capture chance also
    // reads (Q3; the user: "실행" to "볼 고를 때 포획 확률 표시")
    const blockKey = getBallFieldBlockKey();
    if (blockKey) {
      this.queueShowText(blockKey);
      return false;
    }
    return true;
  }

  /**
   * Helper method for {@linkcode handleCommand} that handles the logic when the selected command is to use a pokeball.
   *
   * @param cursor - The index of the pokeball to use
   * @returns Whether the command was successfully initiated
   */
  private handleBallCommand(cursor: number): boolean {
    const targets = globalScene
      .getEnemyField()
      .filter(p => p.isActive(true))
      .map(p => p.getBattlerIndex());

    if (!this.checkCanUseBall()) {
      return false;
    }

    if (targets.length > 1) {
      this.queueShowText("battle:noPokeballMulti");
      return false;
    }

    const numBallTypes = 5;
    if (cursor < numBallTypes) {
      // Local fork (2026-11-20): the boss rule moved unchanged to capture-chance.ts, which the ball menu's capture chance
      // also reads (Q3)
      const bossBlockKey = getBossBallBlockKey(cursor);
      if (bossBlockKey) {
        this.queueShowText(bossBlockKey);
        return false;
      }

      globalScene.currentBattle.turnCommands[this.fieldIndex] = {
        command: Command.BALL,
        cursor,
      };
      globalScene.currentBattle.turnCommands[this.fieldIndex]!.targets = targets;
      if (this.fieldIndex) {
        globalScene.currentBattle.turnCommands[this.fieldIndex - 1]!.skip = true;
      }
      return true;
    }

    return false;
  }

  /**
   * Submethod of {@linkcode tryLeaveField} to handle the logic for effects that prevent the pokemon from leaving the field
   * due to trapping abilities or effects.
   *
   * This method queues the proper messages in the case of trapping abilities or effects.
   *
   * @returns Whether the pokemon is currently trapped
   */
  private handleTrap(): boolean {
    const playerPokemon = this.getPokemon();
    const trappedAbMessages: string[] = [];
    const isSwitch = this.isSwitch;
    if (!playerPokemon.isTrapped(trappedAbMessages)) {
      return false;
    }
    if (trappedAbMessages.length > 0) {
      if (isSwitch) {
        globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
          globalScene.ui.showText(
            trappedAbMessages[0],
            null,
            () => {
              globalScene.ui.showText("", 0);
              if (isSwitch) {
                globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
              }
            },
            null,
            true,
          );
        });
      }
    } else {
      const trapTag = playerPokemon.getTag(TrappedTag);
      const fairyLockTag = globalScene.arena.getTagOnSide(ArenaTagType.FAIRY_LOCK, ArenaTagSide.PLAYER);
      // Local fork (2026-11-19): Sky Drop (프리폴) traps the Pokémon it carries without a `TrappedTag` (`Pokemon.isTrapped`,
      // Ghost types included); without its own message, trying to flee left an empty message box that took no input
      // (the user: "e2 구현")
      const skyDropTag = playerPokemon.getTag(BattlerTagType.SKY_DROP);

      if (!isSwitch) {
        globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
        globalScene.ui.setMode(UiMode.MESSAGE);
      }
      if (skyDropTag) {
        this.showNoEscapeText(skyDropTag, false);
      } else if (trapTag) {
        this.showNoEscapeText(trapTag, false);
      } else if (fairyLockTag) {
        this.showNoEscapeText(fairyLockTag, false);
      } else if (playerPokemon.hasAbility(AbilityId.LAST_STAND)) {
        // Local fork (2026-11-20): Last Stand (결사항전) traps its own holder (`Pokemon.isTrapped`) with no tag and no
        // ability message, so Run left the same empty message box as Sky Drop did and Switch did nothing (the user:
        // "결사항전 관련 실행")
        this.showLastStandNoEscapeText(isSwitch);
      } else {
        // Local fork (2026-11-20): a trap with no message of its own goes back to the command menu instead of hanging
        globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
      }
    }

    return true;
  }

  /**
   * Local fork (2026-11-20): the usual can't-escape message for a holder trapped by its own Last Stand (결사항전), as
   * "<holder>'s Last Stand prevents fleeing/switching!", then back to the command menu, from Run or from Switch (the
   * user: "결사항전 관련 실행").
   * @param isSwitch - Whether the player tried to switch out (else to flee)
   */
  private showLastStandNoEscapeText(isSwitch: boolean): void {
    globalScene.ui.showText(
      i18next.t("battle:noEscapePokemon", {
        pokemonName: getPokemonNameWithAffix(this.getPokemon()),
        moveName: allAbilities[AbilityId.LAST_STAND].name,
        escapeVerb: i18next.t(isSwitch ? "battle:escapeVerbSwitch" : "battle:escapeVerbFlee"),
      }),
      null,
      () => {
        globalScene.ui.showText("", 0);
        globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
      },
      null,
      true,
    );
  }

  /**
   * Common helper method that attempts to have the pokemon leave the field.
   * Checks for trapping abilities and effects.
   *
   * @param cursor - The index of the option that the cursor is on
   * @returns Whether the pokemon is able to leave the field, indicating the command phase should end
   */
  private tryLeaveField(cursor?: number, isBatonSwitch = false): boolean {
    const currentBattle = globalScene.currentBattle;
    const playerPokemon = this.getPokemon();

    // A Pokemon under the Commander effect (Dondozo with Tatsugiri) cannot switch out or flee.
    const commandedTag = playerPokemon.getTag(BattlerTagType.COMMANDED);
    const isCommanded = commandedTag?.getSourcePokemon()?.isActive(true);

    if (isCommanded) {
      if (this.isSwitch) {
        globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
          globalScene.ui.showText(
            i18next.t("battle:noEscapeForce"),
            null,
            () => {
              globalScene.ui.showText("", 0);
              globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
            },
            null,
            true,
          );
        });
      }
      return false;
    }

    if (isBatonSwitch || !this.handleTrap()) {
      currentBattle.turnCommands[this.fieldIndex] = this.isSwitch
        ? {
            command: Command.POKEMON,
            cursor,
            args: [isBatonSwitch],
          }
        : {
            command: Command.RUN,
          };
      if (!this.isSwitch && this.fieldIndex) {
        currentBattle.turnCommands[this.fieldIndex - 1]!.skip = true;
      }
      return true;
    }

    return false;
  }

  /**
   * Helper method for {@linkcode handleCommand} that handles the logic when the selected command is RUN.
   *
   * @remarks
   * Checks if the player is allowed to flee, and if not, queues the appropriate message.
   *
   * The player cannot flee if:
   * - The player is in the {@linkcode BiomeId.END | End} biome
   * - The player is in a trainer battle
   * - The player is in a mystery encounter that disallows fleeing
   * - The player's pokemon is trapped by an ability or effect
   * @returns Whether the pokemon is able to leave the field, indicating the command phase should end
   */
  private handleRunCommand(): boolean {
    const { currentBattle, arena } = globalScene;
    const mysteryEncounterFleeAllowed = currentBattle.mysteryEncounter?.fleeAllowed ?? true;
    if (arena.biomeId === BiomeId.END || !mysteryEncounterFleeAllowed) {
      this.queueShowText("battle:noEscapeForce");
      return false;
    }
    if (
      currentBattle.battleType === BattleType.TRAINER
      || currentBattle.mysteryEncounter?.encounterMode === MysteryEncounterMode.TRAINER_BATTLE
    ) {
      this.queueShowText("battle:noEscapeTrainer");
      return false;
    }

    const success = this.tryLeaveField();

    return success;
  }

  /**
   * Show a message indicating that the pokemon cannot escape, and then return to the command phase.
   */
  private showNoEscapeText(tag: any, isSwitch: boolean): void {
    globalScene.ui.showText(
      i18next.t("battle:noEscapePokemon", {
        pokemonName:
          tag.sourceId && globalScene.getPokemonById(tag.sourceId)
            ? getPokemonNameWithAffix(globalScene.getPokemonById(tag.sourceId)!)
            : "",
        moveName: tag.getMoveName(),
        escapeVerb: i18next.t(isSwitch ? "battle:escapeVerbSwitch" : "battle:escapeVerbFlee"),
      }),
      null,
      () => {
        globalScene.ui.showText("", 0);
        if (!isSwitch) {
          globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
        }
      },
      null,
      true,
    );
  }

  // Overloads for handleCommand to provide a more specific signature for the different options
  /**
   * Process the command phase logic based on the selected command
   *
   * @param command - The kind of command to handle
   * @param cursor - The index of option that the cursor is on, or -1 if no option is selected
   * @param useMode - The mode to use for the move, if applicable. For switches, a boolean that specifies whether the switch is a Baton switch.
   * @param move - For {@linkcode Command.FIGHT}, the move to use
   * @returns Whether the command was successful
   */
  handleCommand(
    command: Command.FIGHT | Command.TERA,
    cursor: number,
    useMode?: MoveUseMode,
    move?: TurnMove,
    moveStyle?: MoveStyle,
    heldItemKey?: string,
  ): boolean;
  handleCommand(command: Command.POKEMON, cursor: number, useBaton: boolean): boolean;
  handleCommand(command: Command.BALL | Command.RUN, cursor: number): boolean;
  handleCommand(
    command: Command,
    cursor: number,
    useMode?: boolean | MoveUseMode,
    move?: TurnMove,
    moveStyle?: MoveStyle,
    heldItemKey?: string,
  ): boolean;

  /**
   * @param moveStyle - Local fork (2026-11-20): S1 move styles. For {@linkcode Command.FIGHT} / {@linkcode Command.TERA},
   *   the style the player chose in the fight menu (강공 / 중공 / 속공); left out for 중공
   * @param heldItemKey - Local fork (2026-11-20): held-item moves. For {@linkcode Command.FIGHT} /
   *   {@linkcode Command.TERA}, the held item the player chose for Trick / Switcheroo / Fling / Natural Gift
   */
  public handleCommand(
    command: Command,
    cursor: number,
    useMode: boolean | MoveUseMode = false,
    move?: TurnMove,
    moveStyle?: MoveStyle,
    heldItemKey?: string,
  ): boolean {
    let success = false;

    switch (command) {
      case Command.TERA:
      case Command.FIGHT:
        success = this.handleFightCommand(
          command,
          cursor,
          typeof useMode === "boolean" ? undefined : useMode,
          move,
          moveStyle,
          heldItemKey,
        );
        break;
      case Command.BALL:
        success = this.handleBallCommand(cursor);
        break;
      case Command.POKEMON:
        this.isSwitch = true;
        success = this.tryLeaveField(cursor, typeof useMode === "boolean" ? useMode : undefined);
        this.isSwitch = false;
        break;
      case Command.RUN:
        success = this.handleRunCommand();
    }

    if (success) {
      this.end();
    }

    return success;
  }

  cancel() {
    if (this.fieldIndex) {
      globalScene.phaseManager.unshiftNew("CommandPhase", 0);
      globalScene.phaseManager.unshiftNew("CommandPhase", 1);
      this.end();
    }
  }

  getFieldIndex(): number {
    return this.fieldIndex;
  }

  getPokemon(): PlayerPokemon {
    return globalScene.getPlayerField()[this.fieldIndex];
  }

  end() {
    globalScene.ui.setMode(UiMode.MESSAGE).then(() => super.end());
  }
}
