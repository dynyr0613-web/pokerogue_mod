import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { settings } from "#app/global-settings-manager";
import { getPokemonNameWithAffix } from "#app/messages";
import { activeOverrides } from "#app/overrides";
import { initMoveAnim, loadMoveAnimAssets } from "#data/battle-anims";
import { allMoves } from "#data/data-lists";
import { SpeciesFormChangeMoveLearnedTrigger } from "#data/form-change-triggers";
import { LearnMoveType } from "#enums/learn-move-type";
import { MoveId } from "#enums/move-id";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
// Local fork (2026-11-20): F1 Q3 (the forget warning) and Q7 (a splice's tail brings its converted slots)
import {
  getAnimMoveId,
  getConvertedMoveForgetWarning,
  getTransformedMove,
  type MoveTransform,
} from "#moves/move-transform";
import { isZMaxOnlyMove } from "#moves/zmax-data"; // Local fork (2026-11-16): Z / Max moves
import { PlayerPartyMemberPokemonPhase } from "#phases/player-party-member-pokemon-phase";
import type { ConfirmModeConfig } from "#types/ui-types";
import { EvolutionSceneUiHandler } from "#ui/evolution-scene-ui-handler";
import { SummaryUiMode } from "#ui/summary-ui-handler";
import i18next from "i18next";

export class LearnMovePhase extends PlayerPartyMemberPokemonPhase {
  public readonly phaseName = "LearnMovePhase";

  private readonly moveId: MoveId;
  private messageMode: UiMode;
  private readonly learnMoveType: LearnMoveType;
  private readonly cost: number;
  /**
   * Local fork (2026-11-20), F1 Q7 (the user: "그대로 가져온다"): the conversion the new slot gets, for a DNA Splicers
   * tail's converted move (`PlayerPokemon.fuse`); `undefined` for every other way of learning a move
   */
  private readonly transform: MoveTransform | undefined;

  constructor(
    partyMemberIndex: number,
    moveId: MoveId,
    learnMoveType: LearnMoveType = LearnMoveType.LEARN_MOVE,
    cost = -1,
    transform?: MoveTransform,
  ) {
    super(partyMemberIndex);

    this.moveId = moveId;
    this.learnMoveType = learnMoveType;
    this.cost = cost;
    this.transform = transform ? { kind: transform.kind, moveId: transform.moveId } : undefined;
  }

  public override start(): void {
    super.start();

    const pokemon = this.getPokemon();
    const baseMove = allMoves[this.moveId];
    const currentMoveset = pokemon.getMoveset();

    // Local fork (2026-11-16): Z / Max moves: their registry entries are implemented now, but a Max / G-Max / Z move is
    // never learned as a move of its own (only a slot conversion makes one)
    if (baseMove.isUnimplemented || isZMaxOnlyMove(this.moveId)) {
      this.end();
      return;
    }

    const hasMoveAlready = currentMoveset.some(m => m.moveId === baseMove.id) && this.moveId !== MoveId.SKETCH;
    if (hasMoveAlready) {
      // Local fork (2026-11-20), F1 Q7: a splice's tail move the head already knows plain lends that slot its
      // conversion (silently, as an already known move always ended here); a slot the head converted itself stays
      this.carryTransformToKnownSlot(pokemon);
      this.end();
      return;
    }

    // Local fork (2026-11-20), F1 Q7: a converted tail move is shown (prompts, the summary) as what it became
    const move = this.transform ? getTransformedMove(this.moveId, this.transform) : baseMove;

    this.messageMode =
      globalScene.ui.getHandler() instanceof EvolutionSceneUiHandler ? UiMode.EVOLUTION_SCENE : UiMode.MESSAGE;
    globalScene.ui.setMode(this.messageMode);
    if (currentMoveset.length < 4) {
      this.learnMove(currentMoveset.length, move, pokemon);
    } else {
      this.replaceMoveCheck(move, pokemon);
    }
  }

  /**
   * Local fork (2026-11-20), F1 Q7: gives {@linkcode transform} to `pokemon`'s own plain slot of {@linkcode moveId}, if
   * there is one (the head already knew the tail's converted move)
   */
  private carryTransformToKnownSlot(pokemon: Pokemon): void {
    if (!this.transform) {
      return;
    }
    const slot = pokemon.moveset.find(m => m?.moveId === this.moveId);
    if (slot && !slot.transform) {
      slot.transform = { kind: this.transform.kind, moveId: this.transform.moveId };
      this.loadMoveAnim();
    }
  }

  /** Loads the battle animation of the new slot: its converted move's for a carried conversion (local fork) */
  private loadMoveAnim(): void {
    const animMoveId = this.transform ? getAnimMoveId(getTransformedMove(this.moveId, this.transform)) : this.moveId;
    initMoveAnim(animMoveId).then(() => {
      loadMoveAnimAssets([animMoveId], true);
    });
  }

  /**
   * This displays a chain of messages (listed below) and asks if the user wishes to forget a move.
   *
   * > [Pokemon] wants to learn the move [MoveName] \
   * > However, [Pokemon] already knows four moves. \
   * > Should a move be forgotten and replaced with [MoveName]? --> `UiMode.CONFIRM` -> Yes: Go to `this.forgetMoveProcess()`, No: Go to `this.rejectMoveAndEnd()`
   * @param move - The Move to be learned
   * @param Pokemon - The Pokemon learning the move
   */
  private async replaceMoveCheck(move: Move, pokemon: Pokemon): Promise<void> {
    const { ui } = globalScene;
    const pokemonName = getPokemonNameWithAffix(pokemon);
    const moveName = move.name;

    const learnMovePrompt = i18next.t("battle:learnMovePrompt", { pokemonName, moveName });
    const moveLimitReached = i18next.t("battle:learnMoveLimitReached", { pokemonName });
    const shouldReplaceQ = i18next.t("battle:learnMoveReplaceQuestion", { moveName });

    const preQText = [learnMovePrompt, moveLimitReached].join("$");

    await ui.showTextPromise(preQText);
    await ui.showTextPromise(shouldReplaceQ, undefined, false);

    const options: ConfirmModeConfig = {
      yesHandler: () => this.forgetMoveProcess(move, pokemon),
      noHandler: () => {
        ui.setMode(this.messageMode);
        this.rejectMoveAndEnd(move, pokemon);
      },
    };
    await ui.setModeWithoutClear(UiMode.CONFIRM, options);
  }

  /**
   * This facilitates the process in which an old move is chosen to be forgotten.
   *
   * > Which move should be forgotten?
   *
   * The game then goes `Mode.SUMMARY` to select a move to be forgotten. \
   * If a player does not select a move or chooses the new move (`moveIndex === 4`), the game goes to `this.rejectMoveAndEnd()`. \
   * If an old move is selected, the function then passes the `moveIndex` to `this.learnMove()`
   * @param move - The Move to be learned
   * @param Pokemon - The Pokemon learning the move
   */
  private async forgetMoveProcess(move: Move, pokemon: Pokemon): Promise<void> {
    globalScene.ui.setMode(this.messageMode);
    await globalScene.ui.showTextPromise(i18next.t("battle:learnMoveForgetQuestion"), undefined, true);
    await globalScene.ui.setModeWithoutClear(
      UiMode.SUMMARY,
      pokemon,
      SummaryUiMode.LEARN_MOVE,
      move,
      (moveIndex: number) => {
        if (moveIndex === 4) {
          globalScene.ui.setMode(this.messageMode).then(() => this.rejectMoveAndEnd(move, pokemon));
          return;
        }
        const forgetSuccessText = i18next.t("battle:learnMoveForgetSuccess", {
          pokemonName: getPokemonNameWithAffix(pokemon),
          moveName: pokemon.moveset[moveIndex]!.getName(),
        });
        const fullText = [i18next.t("battle:countdownPoof"), forgetSuccessText, i18next.t("battle:learnMoveAnd")].join(
          "$",
        );
        // Local fork (2026-11-20), F1 Q3 (the user: "잊을 때 경고"): a converted slot asks once more
        const warning = getConvertedMoveForgetWarning(pokemon.moveset[moveIndex]);
        if (warning) {
          globalScene.ui
            .setMode(this.messageMode)
            .then(() => this.confirmForgetConverted(moveIndex, warning, move, pokemon, fullText));
          return;
        }
        globalScene.ui.setMode(this.messageMode).then(() => this.learnMove(moveIndex, move, pokemon, fullText));
      },
    );
  }

  /**
   * Local fork (2026-11-20), F1 Q3 (the user: "잊을 때 경고"): the player chose to forget a converted slot (Z / Max /
   * G-Max / Z다이). Says that the conversion goes with it, then asks: yes forgets it as before, no returns to the move
   * choice.
   *
   * > [Move] was made a [Z-Move / Max Move ...]! Forgetting it loses the conversion. \
   * > Forget [Move] anyway? --> `UiMode.CONFIRM` -> Yes: `this.learnMove()`, No: `this.forgetMoveProcess()`
   * @param moveIndex - The slot chosen to be forgotten
   * @param warning - {@linkcode getConvertedMoveForgetWarning}'s text for that slot
   * @param move - The Move to be learned
   * @param pokemon - The Pokemon learning the move
   * @param forgetText - The "Poof! ... forgot ... And..." text `learnMove` shows on yes
   */
  private async confirmForgetConverted(
    moveIndex: number,
    warning: string,
    move: Move,
    pokemon: Pokemon,
    forgetText: string,
  ): Promise<void> {
    const { ui } = globalScene;
    await ui.showTextPromise(warning);
    await ui.showTextPromise(
      i18next.t("battle:convertedMoveForgetConfirm", { moveName: pokemon.moveset[moveIndex]!.getName() }),
      undefined,
      false,
    );
    const options: ConfirmModeConfig = {
      yesHandler: () => {
        ui.setMode(this.messageMode).then(() => this.learnMove(moveIndex, move, pokemon, forgetText));
      },
      noHandler: () => {
        this.forgetMoveProcess(move, pokemon);
      },
    };
    await ui.setModeWithoutClear(UiMode.CONFIRM, options);
  }

  /**
   * This asks the player if they wish to end the current move learning process.
   *
   * > "Stop trying to teach [MoveName]?"" --> `UiMode.CONFIRM` --> Yes: "[Pokemon] did not learn the move [MoveName]", No: `this.replaceMoveCheck()`
   *
   * If the player wishes to not teach the Pokemon the move, it displays a message and ends the phase. \
   * If the player reconsiders, it repeats the process for a Pokemon with a full moveset once again.
   * @param move - The Move to be learned
   * @param Pokemon - The Pokemon learning the move
   */
  private async rejectMoveAndEnd(move: Move, pokemon: Pokemon): Promise<void> {
    const { ui } = globalScene;

    const pokemonName = getPokemonNameWithAffix(pokemon);
    const moveName = move.name;

    if (!settings.general.levelMoveConfirmation) {
      await ui.setMode(this.messageMode);
      await ui.showTextPromise(i18next.t("battle:learnMoveNotLearned", { pokemonName, moveName }), undefined, true);
      this.end();
      return;
    }

    await ui.showTextPromise(i18next.t("battle:learnMoveStopTeaching", { moveName }), undefined, false);

    const options: ConfirmModeConfig = {
      yesHandler: () => {
        ui.setMode(this.messageMode);
        ui.showTextPromise(i18next.t("battle:learnMoveNotLearned", { pokemonName, moveName }), undefined, true) //
          .then(() => this.end());
      },
      noHandler: () => {
        ui.setMode(this.messageMode);
        this.replaceMoveCheck(move, pokemon);
      },
    };

    await ui.setModeWithoutClear(UiMode.CONFIRM, options);
  }

  /**
   * This teaches the Pokemon the new move and ends the phase. \
   * When a Pokemon forgets a move and learns a new one, its 'Learn Move' message is significantly longer.
   *
   * Pokemon with a `moveset.length < 4`
   * > [Pokemon] learned [MoveName]
   *
   * Pokemon with a `moveset.length > 4`
   * > 1... 2... and 3... and Poof! \
   * > [Pokemon] forgot how to use [MoveName] \
   * > And... \
   * > [Pokemon] learned [MoveName]!
   * @param move - The Move to be learned
   * @param Pokemon - The Pokemon learning the move
   */
  private async learnMove(index: number, move: Move, pokemon: Pokemon, textMessage?: string): Promise<void> {
    if (this.learnMoveType === LearnMoveType.TM) {
      if (!pokemon.usedTMs.includes(this.moveId)) {
        pokemon.usedTMs.push(this.moveId);
      }
      globalScene.phaseManager.tryRemovePhase("SelectModifierPhase");
    } else if (this.learnMoveType === LearnMoveType.MEMORY) {
      if (this.cost === -1) {
        globalScene.phaseManager.tryRemovePhase("SelectModifierPhase");
      } else {
        if (!activeOverrides.WAIVE_ROLL_FEE_OVERRIDE) {
          globalScene.money -= this.cost;
          globalScene.updateMoneyText();
          globalScene.animateMoneyChanged(false);
        }
        audioManager.playSound("se/buy");
      }
    }
    pokemon.setMove(index, this.moveId);
    // Local fork (2026-11-20), F1 Q7: a splice's tail move keeps its conversion (`setMove` makes a plain slot object,
    // shared with `summonData.moveset`)
    const newSlot = pokemon.moveset[index];
    if (this.transform && newSlot) {
      newSlot.transform = { kind: this.transform.kind, moveId: this.transform.moveId };
    }
    this.loadMoveAnim();
    globalScene.ui.setMode(this.messageMode);
    const learnMoveText = i18next.t("battle:learnMove", {
      pokemonName: getPokemonNameWithAffix(pokemon),
      moveName: move.name,
    });
    if (textMessage) {
      await globalScene.ui.showTextPromise(textMessage);
    }
    audioManager.playSound("se/level_up_fanfare"); // Sound loaded into game as is
    globalScene.ui.showText(
      learnMoveText,
      null,
      () => {
        globalScene.triggerPokemonFormChange(pokemon, SpeciesFormChangeMoveLearnedTrigger, true);
        this.end();
      },
      this.messageMode === UiMode.EVOLUTION_SCENE ? 1000 : undefined,
      true,
    );
  }
}
