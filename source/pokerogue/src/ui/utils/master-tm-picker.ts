/**
 * Local fork (2026-11-11): the move picker of the Master TM (마스터 기술머신). The user: "마스터 기술머신(마스터, 형태는
 * 검은색 기술머신, 로그볼과 비슷한 색조합, 선택 후 소모됨, 선택한 포켓몬에게 "어느 기술이던지" 가르칠 수 있음, 노가드 +
 * 일격기 조합도 가능(어차피 일격기는 보스에게 맞지 않으니까))".
 *
 * About 900 moves are too many for one list, so the picker asks in two steps with the game's own option list
 * (`UiMode.OPTION_SELECT`, the window encounters and the Pokédex use), shown over the party screen:
 * 1. the 18 types, each with its TM icon and how many moves it has left for this Pokémon;
 * 2. that type's moves in name order (가나다), each labelled with its category, power and accuracy, while the
 *    move info box (type, category, power, accuracy, PP, effect) shows the move under the cursor;
 * then a yes / no question, so a tap on a phone (one tap picks an option) can still be taken back.
 *
 * Left / right turn a page of a list (8 rows), since the Normal list alone has over 180 moves.
 *
 * Back always steps back one level: the move list returns to the types (on the type it came from), "no" returns to
 * the move list (on that move), and the type list returns to the party screen through `onBack`. Keyboard, gamepad
 * and the touch panel (`src/touch-choices.ts`, which mirrors any option list and yes / no) all work the same way.
 * Nothing is used until "yes": the caller then makes the modifier, see `SelectModifierPhase.openMasterTmMenu`.
 */

import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { allMoves } from "#data/data-lists";
import { MoveCategory } from "#enums/move-category";
import type { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { getMasterTmMovesByType, MASTER_TM_TYPES } from "#modifiers/custom-consumables";
import type { Move } from "#moves/move";
import type { OptionSelectItem, OptionSelectModeConfig } from "#types/ui-types";
import { MoveInfoOverlay } from "#ui/move-info-overlay";
import type { PartyUiHandler } from "#ui/party-ui-handler";
import { getPokemonTypeLocaleKey } from "#utils/i18n";
import i18next from "i18next";

const LOCALE = "modifierType:ModifierType.MASTER_TM";

/**
 * Rows the type and move lists show at once. The lists sit right above the party screen's one-line message box
 * ({@linkcode LIST_Y_OFFSET}), and 8 rows is what fits between it and the top of the screen.
 */
export const MASTER_TM_PICKER_ROWS = 8;
/** The party screen's message box is 30 px high (plus the 1 px screen edge the windows keep) */
const LIST_Y_OFFSET = 32;

export interface MasterTmPickerCallbacks {
  /** The player said yes to teaching `moveId`. The picker is gone and the party screen is the current mode. */
  readonly onTeach: (moveId: MoveId) => void;
  /** The player backed out of the type list. The picker is gone; the caller reopens the party screen. */
  readonly onBack: () => void;
}

/** Local fork (2026-11-11): the type list label, e.g. "불꽃 (63)" */
export function getMasterTmTypeLabel(type: PokemonType, moveCount: number): string {
  return `${i18next.t(getPokemonTypeLocaleKey(type))} (${moveCount})`;
}

/**
 * Local fork (2026-11-11): the move list label: name, then category, power (attacks only; "-" when it varies) and
 * accuracy (left out when the move never misses), e.g. "지진  물리 100 100%", "칼춤  변화", "절단  물리 250 30%"
 */
export function getMasterTmMoveLabel(move: Move): string {
  const info = [i18next.t(`${LOCALE}.category.${MoveCategory[move.category].toLowerCase()}`)];
  if (move.category !== MoveCategory.STATUS) {
    info.push(move.power > 0 ? `${move.power}` : "-");
  }
  if (move.accuracy > 0) {
    info.push(`${move.accuracy}%`);
  }
  return `${move.name}  ${info.join(" ")}`;
}

/**
 * Local fork (2026-11-11): one run of the Master TM's type -> move -> yes / no picker for one Pokémon, opened from the
 * party screen's select callback (the party screen stays visible under the lists).
 */
export class MasterTmPicker {
  private readonly pokemon: PlayerPokemon;
  private readonly partyHandler: PartyUiHandler;
  private readonly callbacks: MasterTmPickerCallbacks;
  /** The teachable moves by type, worked out once when the picker opens */
  private readonly movesByType: Map<PokemonType, MoveId[]>;
  /** The types with at least one move left, in type order */
  private readonly types: PokemonType[];
  /** The move info box, made on the first move shown and destroyed when the picker closes */
  private moveInfo: MoveInfoOverlay | null = null;

  constructor(pokemon: PlayerPokemon, partyHandler: PartyUiHandler, callbacks: MasterTmPickerCallbacks) {
    this.pokemon = pokemon;
    this.partyHandler = partyHandler;
    this.callbacks = callbacks;
    this.movesByType = getMasterTmMovesByType(pokemon);
    this.types = MASTER_TM_TYPES.filter(t => (this.movesByType.get(t)?.length ?? 0) > 0);
  }

  /** The types the type list offers, in order (for tests) */
  getTypes(): readonly PokemonType[] {
    return this.types;
  }

  /** The moves the move list of `type` offers, in order (for tests) */
  getMoves(type: PokemonType): readonly MoveId[] {
    return this.movesByType.get(type) ?? [];
  }

  /** Opens the type list. Call it from the party screen's select callback. */
  open(): Promise<void> {
    return this.showTypes();
  }

  private get pokemonName(): string {
    return getPokemonNameWithAffix(this.pokemon, false);
  }

  /** Step 1: the types. Back returns to the party screen. */
  private async showTypes(fromType?: PokemonType): Promise<void> {
    this.hideMoveInfo();
    const options: OptionSelectItem[] = this.types.map(type => ({
      label: getMasterTmTypeLabel(type, this.getMoves(type).length),
      iconsConfig: [{ name: "items", frame: `tm_${PokemonType[type].toLowerCase()}`, scale: 0.5 }],
      keepOpen: true,
      handler: () => {
        this.showMoves(type);
        return true;
      },
    }));
    options.push({
      label: i18next.t("menu:cancel"),
      handler: () => {
        this.close();
        this.callbacks.onBack();
        return true;
      },
    });
    await this.showList(
      i18next.t(`${LOCALE}.chooseType`),
      options,
      fromType === undefined ? undefined : this.types.indexOf(fromType),
    );
  }

  /** Step 2: the moves of `type`. Back returns to the types, on `type`. */
  private async showMoves(type: PokemonType, fromMove?: MoveId): Promise<void> {
    const moves = this.getMoves(type);
    const options: OptionSelectItem[] = moves.map(moveId => ({
      label: getMasterTmMoveLabel(allMoves[moveId]),
      keepOpen: true,
      onHover: () => this.showMoveInfo(moveId),
      handler: () => {
        this.confirm(type, moveId);
        return true;
      },
    }));
    options.push({
      label: i18next.t("menu:cancel"),
      keepOpen: true,
      onHover: () => this.hideMoveInfo(),
      handler: () => {
        this.showTypes(type);
        return true;
      },
    });
    await this.showList(
      i18next.t(`${LOCALE}.chooseMove`, { typeName: i18next.t(getPokemonTypeLocaleKey(type)) }),
      options,
      fromMove === undefined ? undefined : moves.indexOf(fromMove),
    );
  }

  /** Step 3: yes teaches `moveId`, no returns to the move list on it. The move info stays up meanwhile. */
  private async confirm(type: PokemonType, moveId: MoveId): Promise<void> {
    await this.returnToParty();
    this.showMoveInfo(moveId);
    this.partyHandler.showText(
      i18next.t(`${LOCALE}.confirmTeach`, { pokemonName: this.pokemonName, moveName: allMoves[moveId].name }),
      0,
    );
    await globalScene.ui.setModeWithoutClear(UiMode.CONFIRM, {
      yesHandler: () => {
        this.close();
        this.returnToParty().then(() => this.callbacks.onTeach(moveId));
      },
      noHandler: () => {
        this.showMoves(type, moveId);
      },
    });
  }

  /** Shows `prompt` in the party screen's message box and the option list above it */
  private async showList(prompt: string, options: OptionSelectItem[], initialCursor?: number): Promise<void> {
    await this.returnToParty();
    this.partyHandler.showText(prompt, 0);
    const config: OptionSelectModeConfig = {
      options,
      maxOptions: MASTER_TM_PICKER_ROWS,
      yOffset: LIST_Y_OFFSET,
      // left / right turn a page: the Normal list has over 180 moves
      pageWithLeftRight: true,
      ...(initialCursor === undefined ? {} : { initialCursor }),
    };
    await globalScene.ui.setModeWithoutClear(UiMode.OPTION_SELECT, config);
  }

  /**
   * Closes the current list or question and makes the party screen (still shown under it) the current mode again,
   * which `setModeWithoutClear` needs before the next list can open.
   */
  private async returnToParty(): Promise<void> {
    if (globalScene.ui.mode !== UiMode.PARTY) {
      await globalScene.ui.setMode(UiMode.PARTY);
    }
  }

  private showMoveInfo(moveId: MoveId): void {
    if (!this.moveInfo) {
      // top left, above the party screen's message box; the lists take the right side
      this.moveInfo = new MoveInfoOverlay({
        top: true,
        x: 1,
        y: 1 - globalScene.scaledCanvas.height,
        width: globalScene.scaledCanvas.width / 2 - 30,
      });
      globalScene.ui.add(this.moveInfo);
    }
    this.moveInfo.show(allMoves[moveId]);
  }

  private hideMoveInfo(): void {
    this.moveInfo?.clear();
  }

  /** Removes the move info box for good */
  private close(): void {
    this.moveInfo?.destroy();
    this.moveInfo = null;
  }
}
