/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Local fork (2026-11-16): the move picker of the Dynamax Candy (다이사탕) and the Z crystals (Z크리스탈). The user:
 * "다이사탕 사용 시 원하는 기술을 다이 기술로 바꿈 / 해당 포켓몬의 전용기는 거다이 기술로 바꿈" and "z 크리스탈 사용 시 해당
 * 타입 기술을 z기술로 변환 / 전용 z 크리스탈은 해당 타입의 기술을 전용 z기술로 변환".
 *
 * The conversion is permanent, so the item asks like the Master TM does (master-tm-picker.ts), with the game's own
 * option list (`UiMode.OPTION_SELECT`) over the party screen after the Pokémon:
 * 1. the Pokémon's moves as "<now> → <result>" (e.g. "불릿펀치 → 다이스틸", "더블펀처 → 거다이융격"), while the move info
 *    box shows the RESULT move under the cursor (type, category, power, accuracy, PP, effect). A move the item cannot
 *    convert is greyed and keeps its plain name; with the cursor on it the message box says why, and choosing it plays
 *    the error sound;
 * 2. a yes / no question.
 *
 * Back steps back one level: "no" returns to the list (on that move), and the list's Cancel (or B) returns to the
 * party screen through `onBack`. Keyboard, gamepad and the touch panel (`src/touch-choices.ts`, which mirrors any
 * option list and yes / no) all work the same way. Nothing is used until "yes": the caller then makes the modifier,
 * see `SelectModifierPhase.openMoveConversionMenu`.
 */

import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import {
  type ConversionBlockReason,
  getConversionBlockReason,
  getSlotConversion,
  getZCrystalType,
} from "#modifiers/zmax-items";
import type { Move } from "#moves/move";
import { type ConversionItem, getTransformedMove, type MoveTransform } from "#moves/move-transform";
import type { PokemonMove } from "#moves/pokemon-move";
import type { OptionSelectItem, OptionSelectModeConfig } from "#types/ui-types";
import { MoveInfoOverlay } from "#ui/move-info-overlay";
import type { PartyUiHandler } from "#ui/party-ui-handler";
import { getPokemonTypeLocaleKey } from "#utils/i18n";
import i18next from "i18next";

/** The party screen's message box is 30 px high (plus the 1 px screen edge the windows keep), as for the Master TM */
const LIST_Y_OFFSET = 32;

/** Local fork (2026-11-16): one move of the picker's list */
export interface MoveConversionEntry {
  /** The index in the Pokémon's own moveset */
  readonly moveIndex: number;
  readonly slot: PokemonMove;
  /** What the item makes of the slot, or `null` when it cannot be used there */
  readonly result: MoveTransform | null;
  /** Why it cannot be used there (`null` when it can) */
  readonly reason: ConversionBlockReason | null;
}

export interface MoveConversionPickerCallbacks {
  /** The player said yes to converting move `moveIndex`. The picker is gone and the party screen is the current mode. */
  readonly onConvert: (moveIndex: number) => void;
  /** The player backed out of the list. The picker is gone; the caller reopens the party screen. */
  readonly onBack: () => void;
}

/**
 * Local fork (2026-11-16): the list label of a move the item can convert, "<now> → <result>" (e.g. "칼춤 → 다이검무",
 * "다이너클 → Z다이너클")
 */
export function getMoveConversionLabel(slot: PokemonMove, result: MoveTransform): string {
  return `${slot.getName()} → ${getTransformedMove(slot.moveId, result).name}`;
}

/**
 * Local fork (2026-11-16): the text that says why the item with locale key `localeKey` cannot convert a move of
 * `pokemon` (`<localeKey>.reason.<reason>`)
 */
export function getMoveConversionReasonText(
  localeKey: string,
  reason: ConversionBlockReason,
  pokemon: PlayerPokemon,
  item: ConversionItem,
): string {
  const typeName =
    item.kind === "candy"
      ? ""
      : i18next.t(getPokemonTypeLocaleKey(item.kind === "zType" ? item.type : getZCrystalType(item.key)));
  return i18next.t(`${localeKey}.reason.${reason}`, {
    pokemonName: getPokemonNameWithAffix(pokemon, false),
    typeName,
  });
}

/**
 * Local fork (2026-11-16): one run of the Dynamax Candy's / a Z crystal's move -> yes / no picker for one Pokémon, opened
 * from the party screen's select callback (the party screen stays visible under the list).
 */
export class MoveConversionPicker {
  private readonly pokemon: PlayerPokemon;
  private readonly partyHandler: PartyUiHandler;
  private readonly item: ConversionItem;
  /** The item's locale key (`modifierType:ModifierType.DYNAMAX_CANDY` / `.Z_CRYSTAL`), where the picker's text lives */
  private readonly localeKey: string;
  private readonly callbacks: MoveConversionPickerCallbacks;
  /** The Pokémon's moves and what the item makes of each, worked out once when the picker opens */
  private readonly entries: MoveConversionEntry[];
  /** The move info box, made on the first result shown and destroyed when the picker closes */
  private moveInfo: MoveInfoOverlay | null = null;

  constructor(
    pokemon: PlayerPokemon,
    partyHandler: PartyUiHandler,
    item: ConversionItem,
    localeKey: string,
    callbacks: MoveConversionPickerCallbacks,
  ) {
    this.pokemon = pokemon;
    this.partyHandler = partyHandler;
    this.item = item;
    this.localeKey = localeKey;
    this.callbacks = callbacks;
    this.entries = pokemon.moveset.flatMap((slot, moveIndex) => {
      if (!slot) {
        return [];
      }
      const result = getSlotConversion(pokemon, moveIndex, item);
      const reason = result ? null : getConversionBlockReason(pokemon, slot, item);
      return [{ moveIndex, slot, result, reason }];
    });
  }

  /** The moves the list shows, in moveset order (for tests) */
  getEntries(): readonly MoveConversionEntry[] {
    return this.entries;
  }

  /** Opens the move list. Call it from the party screen's select callback. */
  open(): Promise<void> {
    return this.showMoves();
  }

  private get pokemonName(): string {
    return getPokemonNameWithAffix(this.pokemon, false);
  }

  /** The text of the prompt above the list */
  private get prompt(): string {
    return i18next.t(`${this.localeKey}.chooseMove`, { pokemonName: this.pokemonName });
  }

  /** Step 1: the moves. Back returns to the party screen. */
  private async showMoves(fromIndex?: number): Promise<void> {
    const options: OptionSelectItem[] = this.entries.map(entry => this.toOption(entry));
    options.push({
      label: i18next.t("menu:cancel"),
      onHover: () => {
        this.hideMoveInfo();
        this.partyHandler.showText(this.prompt, 0);
      },
      handler: () => {
        this.close();
        this.callbacks.onBack();
        return true;
      },
    });
    const firstEligible = this.entries.findIndex(e => e.result !== null);
    const cursor = fromIndex ?? (firstEligible > 0 ? firstEligible : undefined);
    await this.returnToParty();
    this.partyHandler.showText(this.prompt, 0);
    const config: OptionSelectModeConfig = {
      options,
      yOffset: LIST_Y_OFFSET,
      ...(cursor === undefined ? {} : { initialCursor: cursor }),
    };
    await globalScene.ui.setModeWithoutClear(UiMode.OPTION_SELECT, config);
  }

  private toOption(entry: MoveConversionEntry): OptionSelectItem {
    const { result, reason, slot } = entry;
    if (!result) {
      const reasonText = getMoveConversionReasonText(this.localeKey, reason ?? "cannot", this.pokemon, this.item);
      return {
        label: slot.getName(),
        color: TextStyle.SHADOW_TEXT,
        keepOpen: true,
        onHover: () => {
          this.hideMoveInfo();
          this.partyHandler.showText(reasonText, 0);
        },
        handler: () => {
          this.hideMoveInfo();
          this.partyHandler.showText(reasonText, 0);
          return false;
        },
      };
    }
    const resultMove = getTransformedMove(slot.moveId, result);
    return {
      label: getMoveConversionLabel(slot, result),
      keepOpen: true,
      onHover: () => {
        this.showMoveInfo(resultMove);
        this.partyHandler.showText(this.prompt, 0);
      },
      handler: () => {
        this.confirm(entry, resultMove);
        return true;
      },
    };
  }

  /** Step 2: yes converts the move, no returns to the list on it. The result's move info stays up meanwhile. */
  private async confirm(entry: MoveConversionEntry, resultMove: Move): Promise<void> {
    await this.returnToParty();
    this.showMoveInfo(resultMove);
    this.partyHandler.showText(
      i18next.t(`${this.localeKey}.confirm`, {
        pokemonName: this.pokemonName,
        moveName: entry.slot.getName(),
        resultName: resultMove.name,
      }),
      0,
    );
    await globalScene.ui.setModeWithoutClear(UiMode.CONFIRM, {
      yesHandler: () => {
        this.close();
        this.returnToParty().then(() => this.callbacks.onConvert(entry.moveIndex));
      },
      noHandler: () => {
        this.showMoves(this.entries.indexOf(entry));
      },
    });
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

  private showMoveInfo(move: Move): void {
    if (!this.moveInfo) {
      // top left, above the party screen's message box; the list takes the right side
      this.moveInfo = new MoveInfoOverlay({
        top: true,
        x: 1,
        y: 1 - globalScene.scaledCanvas.height,
        width: globalScene.scaledCanvas.width / 2 - 30,
      });
      globalScene.ui.add(this.moveInfo);
    }
    this.moveInfo.show(move);
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
