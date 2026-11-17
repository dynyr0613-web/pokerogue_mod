/*
 * Fork: the touch choice panel (mobile UI step 3).
 *
 * In the portrait phone layout the space between the named button rows and the D-pad holds one big HTML button
 * per choice of the current menu: battle commands, moves, balls, targets, yes/no and other option lists, the
 * main menu, mystery encounter options, rewards / shop and the party. Tapping a button moves the game's own
 * cursor there and presses A through the same input path as the touch A button, so the game's checks, sounds
 * and error messages are unchanged.
 *
 * Choices whose description matters (rewards, shop items, reroll, mystery encounter options) take two taps: the
 * first moves the cursor so the game shows the description, the second (on the same button) confirms.
 *
 * The panel polls the UI every 150 ms and redraws only when what it would show changes. After a tap it stays
 * locked until the screen changes (or a short timeout), so a double tap can't pick twice.
 *
 * Handler internals are read through `any` on purpose: these are private fields of upstream UI handlers that
 * this fork does not otherwise touch (see docs/모바일_UI_계획.md, step 3).
 */
import { globalScene } from "#app/global-scene";
import { settings } from "#app/global-settings-manager";
import { getPokeballName } from "#data/pokeball";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { PartyUiMode } from "#enums/party-ui-mode";
import { UiMode } from "#enums/ui-mode";
import { formatMoney } from "#utils/common";
import { getModifierTierTextTint } from "#ui/text";
import { getPokemonTypeLocaleKey } from "#utils/i18n";
import i18next from "i18next";

/** One button of the panel. */
interface Choice {
  /** Stable id inside the current screen (used for the two-tap arming and redraw checks). */
  key: string;
  label: string;
  /** Second line (type and PP, cost, level and HP, ...). */
  sub?: string | undefined;
  subColor?: string | undefined;
  /** Text colour of the label (reward tier). */
  labelColor?: string | undefined;
  /** Greyed out; tapping plays the error sound (two-tap choices can still be armed to read the description). */
  disabled?: boolean;
  /** The game's cursor is on this choice. */
  selected?: boolean;
  /** Spans the whole row. */
  wide?: boolean;
  /** Two-tap choice: `select` moves the cursor (first tap), `run` confirms (second tap). */
  select?: () => void;
  /** Performs the choice; returns whether the game accepted the input. */
  run: () => boolean;
}

interface Model {
  /** Screen id (mode + sub-state); arming and locks reset when it changes. */
  id: string;
  columns: number;
  choices: Choice[];
  /** Smaller text for long lists. */
  dense?: boolean;
  /** How long a tap locks the panel when the screen doesn't visibly change (keepOpen menus, encounters). */
  lockMs?: number;
}

const POLL_MS = 150;
/** A signature no screen produces, so the next refresh always redraws (even when the panel becomes empty). */
const FORCE_REDRAW = "#force-redraw#";
const DEFAULT_LOCK_MS = 700;
/** A screen that appears right after a tap ignores taps this long, so the second tap of a double tap can't hit it. */
const NEW_SCREEN_LOCK_MS = 350;
/** Smallest button row; below this the panel scrolls instead of shrinking the rows further. */
const MIN_ROW_PX = 36;
/** Same query as the portrait block in index.css: phone-shaped portrait screens only (not tablets). */
export const PORTRAIT_PHONE_QUERY = "(orientation: portrait) and (pointer: coarse) and (max-aspect-ratio: 3/5)";
const TAP_VIBRATION_MS = 10;

/** Labels that the game has no key for, [Korean, English]. */
const OWN_LABELS = {
  back: ["뒤로", "Back"],
  continue: ["계속", "Continue"],
  confirmAll: ["결정", "Confirm"],
  skip: ["건너뛰기", "Skip"],
  tapAgain: ["한 번 더 누르면 결정", "Tap again to pick"],
  more: ["더 보기", "More"],
  foe: ["상대", "Foe"],
  ally: ["동료", "Ally"],
  self: ["자신", "Self"],
} as const;

function own(key: keyof typeof OWN_LABELS): string {
  const [ko, en] = OWN_LABELS[key];
  const language = i18next.resolvedLanguage ?? i18next.language ?? "en";
  return language.startsWith("ko") ? ko : en;
}

/** Strips the game's text markup ([color=..], [shadow], @[STYLE]{text}) from a label. */
function plain(text: unknown): string {
  return String(text ?? "")
    .replace(/@\[[^\]]*\]\{([^}]*)\}/g, "$1")
    .replace(/\[\/?[a-z]+(?:=[^\]]*)?\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The game's text colour for a reward tier (none for common, which is plain white). */
function tierColor(tier: number | undefined): string | undefined {
  if (!tier) {
    return undefined;
  }
  return `#${getModifierTierTextTint(tier).toString(16).padStart(6, "0")}`;
}

function typeName(type: number): string {
  return i18next.t(getPokemonTypeLocaleKey(type));
}

export class TouchChoicePanel {
  private readonly root: HTMLElement;
  private readonly touchControls: HTMLElement | null;
  private readonly portrait = window.matchMedia(PORTRAIT_PHONE_QUERY);
  private readonly press: (button: Button) => void;

  private model: Model | null = null;
  /** What was last drawn (content + armed + locked). */
  private signature = "";
  /** `${model.id}|${choice.key}` of the two-tap choice that was tapped once. */
  private armed = "";
  /** Content right after the last tap; the panel stays locked while it is unchanged (until lockUntil). */
  private lockContent = "";
  /** Screen id the lock belongs to; a different screen showing up gets a fresh short lock. */
  private lockId = "";
  private lockUntil = 0;
  /** Screen id last drawn, to reset the scroll position when a new screen opens. */
  private renderedId = "";

  /**
   * @param root - the `#touchChoices` element
   * @param press - sends a button press (down + up) through the touch input path
   */
  constructor(root: HTMLElement, press: (button: Button) => void) {
    this.root = root;
    this.press = press;
    this.touchControls = document.getElementById("touchControls");
    root.addEventListener("click", event => this.onClick(event));
    setInterval(() => this.refresh(), POLL_MS);
    // for the phone capture tool (D:/PokeRogueDev/tools/phonecap): what the panel sees
    (window as any).__touchChoices = this;
  }

  /** Debug snapshot of what the panel bases its buttons on (read by the phone capture tool). */
  public debugState(): Record<string, unknown> {
    const ui = globalScene?.ui as any;
    const handler = ui?.getHandler?.();
    return {
      mode: ui ? UiMode[ui.mode] : null,
      active: handler?.active ?? null,
      overlay: ui?.overlayActive ?? null,
      phase: globalScene?.phaseManager?.getCurrentPhase()?.phaseName ?? null,
      model: this.model?.id ?? null,
      locked: this.isLocked(),
    };
  }

  // ---- drawing ----

  private refresh(): void {
    let model: Model | null = null;
    try {
      const shown =
        this.portrait.matches
        && this.touchControls?.classList.contains("visible")
        // not while the controls are being moved (Settings > Move Touch Controls)
        && this.touchControls.dataset.configuring === undefined;
      model = shown ? this.build() : null;
    } catch {
      // a handler in an unexpected state: show nothing rather than break the game loop
      model = null;
    }
    const content = this.contentOf(model);
    this.updateLock(model, content);
    if (model?.id !== this.model?.id) {
      this.armed = "";
    }
    this.model = model;
    const locked = this.isLocked();
    const signature = model ? `${content}|${this.armed}|${locked}` : "";
    if (signature === this.signature) {
      return;
    }
    this.signature = signature;
    this.render(model, locked);
  }

  /**
   * Ends or moves the tap lock. The lock ends when the timeout passes or when the same screen changes (the game
   * reacted). While the panel is empty it keeps waiting. A different screen that appears gets a fresh short lock,
   * so a fast double tap can't pick on it too (e.g. FIGHT -> the next Pokémon's COMMAND in a double battle).
   */
  private updateLock(model: Model | null, content: string): void {
    if (!this.lockContent) {
      return;
    }
    const now = performance.now();
    if (now >= this.lockUntil) {
      this.lockContent = "";
      return;
    }
    if (content === this.lockContent) {
      return;
    }
    if (model && model.id !== this.lockId) {
      this.lockContent = content;
      this.lockId = model.id;
      this.lockUntil = now + NEW_SCREEN_LOCK_MS;
    } else if (model) {
      this.lockContent = "";
    } else {
      // the panel is empty for now: keep waiting for the next screen
      this.lockContent = content;
    }
  }

  /** Everything a model would draw, as one string. */
  private contentOf(model: Model | null): string {
    return model
      ? JSON.stringify([
          model.id,
          model.columns,
          model.dense,
          model.choices.map(c => [c.key, c.label, c.sub, c.subColor, c.labelColor, c.disabled, c.selected, c.wide]),
        ])
      : "none";
  }

  private render(model: Model | null, locked: boolean): void {
    const root = this.root;
    if (!model || model.choices.length === 0) {
      root.classList.add("hidden");
      root.replaceChildren();
      this.renderedId = "";
      return;
    }
    root.classList.remove("hidden");
    this.fitAbovePad();
    root.classList.toggle("dense", !!model.dense);
    root.classList.toggle("busy", locked);
    root.style.setProperty("--choice-columns", String(model.columns));
    const buttons = model.choices.map((choice, index) => {
      const button = document.createElement("div");
      button.className = "choice";
      button.dataset.index = String(index);
      const armed = this.armed === `${model.id}|${choice.key}`;
      button.classList.toggle("selected", !!choice.selected);
      button.classList.toggle("disabled", !!choice.disabled);
      button.classList.toggle("armed", armed);
      button.classList.toggle("wide", !!choice.wide);
      const label = document.createElement("span");
      label.className = "choice-label";
      label.textContent = choice.label;
      if (choice.labelColor) {
        label.style.color = choice.labelColor;
      }
      button.append(label);
      const subText = armed ? own("tapAgain") : choice.sub;
      if (subText) {
        const sub = document.createElement("span");
        sub.className = "choice-sub";
        sub.textContent = subText;
        if (choice.subColor && !armed) {
          sub.style.color = choice.subColor;
        }
        button.append(sub);
      }
      return button;
    });
    root.replaceChildren(...buttons);
    this.fitRows(model);
    if (model.id !== this.renderedId) {
      // a new screen starts at the top, or with the game's cursor in view
      this.renderedId = model.id;
      root.scrollTop = 0;
      root.querySelector<HTMLElement>(".choice.selected")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  /**
   * Keeps the panel above the D-pad and A/B, also after they were moved with "Move Touch Controls"
   * (saved positions are inline styles that the CSS can't see).
   */
  private fitAbovePad(): void {
    const root = this.root;
    const panelTop = root.getBoundingClientRect().top;
    const minHeight = 1.5 * MIN_ROW_PX;
    let lowestTop = Number.POSITIVE_INFINITY;
    for (const id of ["control-group-dpad", "control-group-action", "control-group-cancel"]) {
      const rect = document.getElementById(id)?.getBoundingClientRect();
      if (rect && rect.height > 0 && rect.top > panelTop + minHeight) {
        lowestTop = Math.min(lowestTop, rect.top);
      }
    }
    const bottom = Number.isFinite(lowestTop) ? `${Math.round(window.innerHeight - lowestTop + 8)}px` : "";
    if (root.style.bottom !== bottom) {
      root.style.bottom = bottom;
    }
  }

  /** Sizes the rows so the choices fit the panel (up to the CSS height), scrolling only below MIN_ROW_PX. */
  private fitRows(model: Model): void {
    const root = this.root;
    let rows = 0;
    let inRow = 0;
    for (const choice of model.choices) {
      if (choice.wide) {
        rows += inRow > 0 ? 2 : 1;
        inRow = 0;
      } else if (++inRow === model.columns) {
        rows++;
        inRow = 0;
      }
    }
    if (inRow > 0) {
      rows++;
    }
    const gap = Number.parseFloat(getComputedStyle(root).rowGap) || 0;
    const available = root.clientHeight;
    if (available < MIN_ROW_PX) {
      // no room at all (very short screen): no sliver of buttons to mis-tap
      root.classList.add("hidden");
      return;
    }
    const maxRow = window.innerWidth * (model.dense ? 0.115 : 0.13);
    const fitted = (available - gap * Math.max(0, rows - 1)) / Math.max(1, rows);
    const height = Math.max(MIN_ROW_PX, Math.min(maxRow, fitted));
    root.style.setProperty("--choice-row-height", `${Math.floor(height)}px`);
  }

  // ---- input ----

  private isLocked(): boolean {
    return !!this.lockContent && performance.now() < this.lockUntil;
  }

  private onClick(event: Event): void {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(".choice");
    const model = this.model;
    if (!target || !model || this.isLocked()) {
      return;
    }
    const choice = model.choices[Number(target.dataset.index)];
    if (!choice) {
      return;
    }
    event.preventDefault();
    const armedKey = `${model.id}|${choice.key}`;

    if (choice.select && this.armed !== armedKey) {
      // first tap of a two-tap choice: move the cursor so the game shows the description
      try {
        choice.select();
      } catch (e) {
        console.error("touch choice select failed", e);
        return;
      }
      globalScene.ui.playSelect();
      this.armed = armedKey;
      this.vibrate();
      this.signature = FORCE_REDRAW;
      this.refresh();
      return;
    }
    if (choice.disabled) {
      globalScene.ui.playError();
      return;
    }
    this.armed = "";
    let accepted = false;
    try {
      accepted = choice.run();
    } catch (e) {
      console.error("touch choice failed", e);
    }
    if (accepted) {
      this.vibrate();
    }
    // lock until the screen changes from what it is right after the tap (or the timeout ends),
    // so a double tap can't pick twice on screens that stay put while the game works
    let after: Model | null = null;
    try {
      after = this.build();
    } catch {
      after = null;
    }
    this.lockContent = this.contentOf(after);
    this.lockId = after?.id ?? model.id;
    // the long lock only when the tapped screen stayed (keepOpen menus, encounters); a new screen gets the short one
    const stayed = after?.id === model.id;
    this.lockUntil = performance.now() + (stayed ? (model.lockMs ?? DEFAULT_LOCK_MS) : NEW_SCREEN_LOCK_MS);
    this.signature = FORCE_REDRAW;
    this.refresh();
  }

  private vibrate(): void {
    if (settings.general.enableVibration && typeof navigator.vibrate === "function") {
      navigator.vibrate(TAP_VIBRATION_MS);
    }
  }

  /** Presses A (or another button) and reports whether the game is still able to take input afterwards. */
  private confirm(button: Button = Button.ACTION): boolean {
    this.press(button);
    return true;
  }

  // ---- screens ----

  private build(): Model | null {
    const ui = globalScene?.ui as any;
    if (!ui || ui.overlayActive) {
      return null;
    }
    const mode: UiMode = ui.mode;
    const handler = ui.getHandler() as any;
    if (!handler) {
      return null;
    }
    switch (mode) {
      case UiMode.MESSAGE:
        return this.buildMessage(handler);
      case UiMode.COMMAND:
        return this.buildCommand(handler);
      case UiMode.FIGHT:
        return this.buildFight(handler);
      case UiMode.BALL:
        return this.buildBall(handler);
      case UiMode.TARGET_SELECT:
        return this.buildTargets(handler);
      case UiMode.CONFIRM:
      case UiMode.OPTION_SELECT:
      case UiMode.MENU_OPTION_SELECT:
      case UiMode.MENU:
      case UiMode.TITLE:
        return this.buildOptions(handler, UiMode[mode]);
      case UiMode.MYSTERY_ENCOUNTER:
        return this.buildEncounter(handler);
      case UiMode.MODIFIER_SELECT:
        return this.buildRewards(handler);
      case UiMode.PARTY:
        return this.buildParty(handler);
      case UiMode.SAVE_SLOT:
        return this.buildSaveSlots(handler);
      default:
        return null;
    }
  }

  /** A single "continue" button for a message (or tutorial) that is waiting for A. */
  private continueModel(id: string, handler: any): Model | null {
    const waiting = !!(handler.awaitingActionInput && handler.onActionInput);
    if (!waiting && !handler.pendingPrompt) {
      return null;
    }
    return {
      id,
      columns: 1,
      choices: [{ key: "continue", label: own("continue"), wide: true, disabled: !waiting, run: () => this.confirm() }],
    };
  }

  private buildMessage(handler: any): Model | null {
    return this.continueModel("MESSAGE", handler);
  }

  private isCommandPhase(): boolean {
    return !!globalScene.phaseManager.getCurrentPhase()?.is("CommandPhase");
  }

  private buildCommand(h: any): Model | null {
    if (!h.active || !this.isCommandPhase()) {
      return null;
    }
    const cursor = h.getCursor();
    const command = (c: Command, label: string, wide = false): Choice => ({
      key: `c${c}`,
      label,
      wide,
      selected: cursor === c,
      run: () => {
        const previous = h.getCursor();
        h.setCursor(c);
        if (c === Command.TERA || previous === Command.TERA) {
          h.toggleTeraButton();
        }
        return this.confirm();
      },
    });
    const choices: Choice[] = [
      command(Command.FIGHT, i18next.t("commandUiHandler:fight")),
      command(Command.BALL, i18next.t("commandUiHandler:ball")),
      command(Command.POKEMON, i18next.t("commandUiHandler:pokemon")),
      command(Command.RUN, i18next.t("commandUiHandler:run")),
    ];
    if (h.canTera?.()) {
      const mon = globalScene.getField()[h.fieldIndex ?? 0];
      const tera = mon ? typeName(mon.getTeraType()) : "";
      choices.push(command(Command.TERA, i18next.t("fightUiHandler:teraHover", { type: tera }), true));
    }
    if ((h.fieldIndex ?? 0) > 0) {
      // back to the first Pokémon's command in a double battle
      choices.push({ key: "back", label: own("back"), wide: true, run: () => this.confirm(Button.CANCEL) });
    }
    return { id: `COMMAND${h.fieldIndex ?? 0}`, columns: 2, choices };
  }

  private buildFight(h: any): Model | null {
    const phase = globalScene.phaseManager.getCurrentPhase() as any;
    if (!h.active || !phase?.is("CommandPhase")) {
      return null;
    }
    const mon = phase.getPokemon?.() ?? globalScene.getPlayerField()[h.fieldIndex ?? 0];
    if (!mon) {
      return null;
    }
    const moves: any[] = mon.getMoveset();
    const usable = moves.map(m => !!m.isUsable(mon, false, true)?.[0]);
    // with nothing usable any pick becomes Struggle, so nothing is greyed out then
    const anyUsable = usable.some(Boolean);
    const cursor = h.getCursor();
    const choices: Choice[] = moves.map((m, i) => {
      const move = m.getMove();
      const max = m.getMovePp();
      const left = max - m.ppUsed;
      let color: string | undefined;
      try {
        color = h.getMoveColor?.(mon, m) ?? undefined;
      } catch {
        color = undefined;
      }
      return {
        key: `m${i}`,
        label: m.getName(),
        sub: `${typeName(mon.getMoveType(move))}  ${left}/${max}`,
        subColor: color,
        disabled: anyUsable && !usable[i],
        selected: cursor === i,
        run: () => {
          h.setCursor(i);
          return this.confirm();
        },
      };
    });
    const encounter = globalScene.currentBattle?.mysteryEncounter as any;
    if (!encounter?.skipToFightInput) {
      choices.push({ key: "back", label: own("back"), wide: true, run: () => this.confirm(Button.CANCEL) });
    }
    return { id: `FIGHT${h.fieldIndex ?? 0}`, columns: 2, choices };
  }

  private buildBall(h: any): Model | null {
    if (!h.active || !this.isCommandPhase()) {
      return null;
    }
    const counts = globalScene.pokeballCounts as Record<number, number>;
    const types = Object.keys(counts).map(Number);
    const cursor = h.getCursor();
    const choices: Choice[] = types.map(type => ({
      key: `b${type}`,
      label: getPokeballName(type),
      sub: `×${counts[type]}`,
      disabled: counts[type] <= 0,
      selected: cursor === type,
      run: () => {
        h.setCursor(type);
        return this.confirm();
      },
    }));
    choices.push({
      key: "cancel",
      label: i18next.t("commandUiHandler:ballCancel"),
      selected: cursor === types.length,
      run: () => this.confirm(Button.CANCEL),
    });
    return { id: "BALL", columns: 3, choices };
  }

  private buildTargets(h: any): Model | null {
    const targets: number[] = h.targets ?? [];
    if (!h.active || targets.length === 0) {
      return null;
    }
    const field = globalScene.getField();
    const nameOf = (t: number) => {
      const mon = field[t] as any;
      return mon ? plain(mon.getNameToRender?.() ?? mon.name) : "?";
    };
    const choices: Choice[] = [];
    if (h.isMultipleTargets) {
      choices.push({
        key: "all",
        label: own("confirmAll"),
        sub: targets.map(nameOf).join(" · "),
        wide: true,
        run: () => this.confirm(),
      });
    } else {
      const cursor = h.getCursor();
      for (const t of targets) {
        let side = own("ally");
        if (t >= 2) {
          side = own("foe");
        } else if (t === h.fieldIndex) {
          side = own("self");
        }
        choices.push({
          key: `t${t}`,
          label: nameOf(t),
          sub: side,
          selected: cursor === t,
          run: () => {
            h.setCursor(t);
            return this.confirm();
          },
        });
      }
    }
    choices.push({ key: "back", label: own("back"), wide: true, run: () => this.confirm(Button.CANCEL) });
    return { id: "TARGET_SELECT", columns: 2, choices };
  }

  /** CONFIRM, OPTION_SELECT, MENU_OPTION_SELECT, MENU and the title menu (all option-select handlers). */
  private buildOptions(h: any, modeName: string): Model | null {
    if (!h.active) {
      return null;
    }
    if (h.tutorialActive) {
      return this.continueModel(`${modeName}-tutorial`, h);
    }
    const options: any[] = h.options ?? [];
    if (options.length === 0) {
      return null;
    }
    const blocked = !!h.blockInput;
    const absolute = h.getCursor() + (h.scrollCursor ?? 0);
    const labels = options.map(o => plain(o.label));
    const choices: Choice[] = options.map((o, i) => ({
      key: `o${i}`,
      label: labels[i],
      disabled: blocked || o.selectable === false,
      selected: absolute === i,
      run: () => this.chooseOption(h, i),
    }));
    const longest = Math.max(...labels.map(l => l.length));
    let columns = 2;
    if (options.length > 6 && longest <= 7) {
      columns = 3;
    } else if (longest > 12) {
      columns = 1;
    }
    return {
      id: `${modeName}:${labels.join("|")}`,
      columns,
      dense: options.length > 6,
      // the main menu keeps itself open, and some entries type a warning before the next window opens
      lockMs: modeName === "MENU" ? 1500 : DEFAULT_LOCK_MS,
      choices,
    };
  }

  /** Moves an option-select cursor to option i (scrolling the list if needed) and presses A. */
  private chooseOption(h: any, i: number): boolean {
    const options: any[] = h.options ?? [];
    if (!h.active || h.blockInput || !options[i] || options[i].selectable === false) {
      return false;
    }
    const max: number = h.maxOptions ?? options.length;
    let scroll: number = h.scrollCursor ?? 0;
    if (options.length <= max) {
      scroll = 0;
    } else if (i < scroll) {
      scroll = i;
    } else if (i >= scroll + max) {
      scroll = i - max + 1;
    }
    if (scroll !== (h.scrollCursor ?? 0)) {
      h.setScrollCursor(scroll);
    }
    h.setCursor(i - scroll);
    // setCursor / setScrollCursor leave repeatInput set, which would fire the option twice
    h.repeatInput = false;
    return this.confirm();
  }

  private buildEncounter(h: any): Model | null {
    const options: any[] = h.encounterOptions ?? [];
    if (!h.active || options.length === 0) {
      return null;
    }
    const meets: boolean[] = h.optionsMeetsReqs ?? [];
    const cursor = h.getCursor();
    const choices: Choice[] = options.map((o, i) => {
      const shown = h.optionsContainer?.getAt?.(i)?.text;
      const disabled = !meets[i] && (o.optionMode === 1 || o.optionMode === 3);
      return {
        key: `e${i}`,
        label: plain(shown) || `${i + 1}`,
        disabled: disabled || !!h.blockInput,
        selected: cursor === i,
        select: () => {
          h.setCursor(i);
          h.displayOptionTooltip?.();
        },
        run: () => {
          h.setCursor(i);
          return this.confirm();
        },
      };
    });
    const viewParty = h.viewPartyIndex ?? options.length;
    choices.push({
      key: "party",
      label: i18next.t("mysteryEncounterMessages:viewPartyButton"),
      wide: true,
      selected: cursor === viewParty,
      run: () => {
        h.setCursor(viewParty);
        return this.confirm();
      },
    });
    return { id: "MYSTERY_ENCOUNTER", columns: 2, lockMs: 2000, choices };
  }

  private buildRewards(h: any): Model | null {
    if (!h.active) {
      return null;
    }
    if (h.tutorialActive) {
      return this.continueModel("MODIFIER_SELECT-tutorial", h);
    }
    if (!h.awaitingActionInput) {
      // the rewards are still dropping in
      return null;
    }
    const row: number = h.rowCursor ?? 1;
    const cursor = h.getCursor();
    const money = globalScene.money;
    const moneyText = (amount: number) => formatMoney(settings.display.moneyFormat, amount);
    // set the row directly: setRowCursor maps the old column onto the new row, which lands out of range from
    // "Lock rarities" (row 0, cursor 3) and throws; setCursor reads rowCursor and redraws everything itself
    const pick = (r: number, c: number) => {
      if (h.rowCursor !== r) {
        h.rowCursor = r;
        h.cursor = -1;
      }
      h.setCursor(c);
    };
    const choices: Choice[] = [];

    const rewards: any[] = h.options ?? [];
    rewards.forEach((o, i) => {
      choices.push({
        key: `r${i}`,
        label: plain(o.modifierTypeOption?.type?.name),
        labelColor: tierColor(o.modifierTypeOption?.type?.tier),
        selected: row === 1 && cursor === i,
        select: () => pick(1, i),
        run: () => {
          pick(1, i);
          return this.confirm();
        },
      });
    });
    if (rewards.length === 0 && h.continueButtonContainer?.visible) {
      choices.push({
        key: "continue",
        label: i18next.t("modifierSelectUiHandler:continueNextWaveButton"),
        wide: true,
        selected: row === 1,
        run: () => {
          pick(1, 0);
          return this.confirm();
        },
      });
    }

    // action buttons (row 0: 0 reroll, 1 manage items, 2 check team, 3 lock rarities)
    const rerollCost: number = h.rerollCost ?? -1;
    if (h.rerollButtonContainer?.visible) {
      choices.push({
        key: "reroll",
        label: i18next.t("modifierSelectUiHandler:reroll"),
        sub:
          rerollCost >= 0
            ? i18next.t("modifierSelectUiHandler:rerollCost", { formattedMoney: moneyText(rerollCost) })
            : "",
        disabled: rerollCost < 0 || money < rerollCost,
        selected: row === 0 && cursor === 0,
        select: () => pick(0, 0),
        run: () => {
          pick(0, 0);
          return this.confirm();
        },
      });
    }
    if (h.transferButtonContainer?.visible) {
      choices.push({
        key: "transfer",
        label: i18next.t("modifierSelectUiHandler:manageItems"),
        selected: row === 0 && cursor === 1,
        run: () => {
          pick(0, 1);
          return this.confirm();
        },
      });
    }
    if (h.checkButtonContainer?.visible) {
      choices.push({
        key: "check",
        label: i18next.t("modifierSelectUiHandler:checkTeam"),
        selected: row === 0 && cursor === 2,
        run: () => {
          pick(0, 2);
          return this.confirm();
        },
      });
    }
    if (h.lockRarityButtonContainer?.visible) {
      choices.push({
        key: "lock",
        label: plain(h.lockRarityButtonText?.text) || i18next.t("modifierSelectUiHandler:lockRarities"),
        disabled: rerollCost < 0,
        selected: row === 0 && cursor === 3,
        run: () => {
          pick(0, 3);
          return this.confirm();
        },
      });
    }
    if (rewards.length > 0) {
      // the game asks to confirm the skip
      choices.push({ key: "skip", label: own("skip"), run: () => this.confirm(Button.CANCEL) });
    }

    // shop: flat index j; row 0 holds the first 7 items, and rowCursor 2 is always the lowest shop row
    const shopRows: any[][] = h.shopOptionsRows ?? [];
    shopRows.flat().forEach((o, j) => {
      const rowIndex = j < 7 ? 0 : 1;
      const r = shopRows.length + 1 - rowIndex;
      const c = j - 7 * rowIndex;
      const cost: number = o.modifierTypeOption?.cost ?? 0;
      choices.push({
        key: `s${j}`,
        label: plain(o.modifierTypeOption?.type?.name),
        sub: i18next.t("modifierSelectUiHandler:itemCost", { formattedMoney: moneyText(cost) }),
        disabled: cost > money,
        selected: row === r && cursor === c,
        select: () => pick(r, c),
        run: () => {
          pick(r, c);
          return this.confirm();
        },
      });
    });

    return {
      id: `MODIFIER_SELECT:${rewards.length}:${shopRows.flat().length}`,
      columns: 3,
      dense: true,
      lockMs: 1200,
      choices,
    };
  }

  private buildParty(h: any): Model | null {
    if (!h.active) {
      return null;
    }
    if (h.awaitingActionInput) {
      return this.continueModel("PARTY-message", h);
    }
    if (h.pendingPrompt || h.blockInput || h.tutorialActive) {
      return null;
    }
    const ui = globalScene.ui;
    const partyMode: number = h.partyUiMode;

    if (!h.optionsMode) {
      const party = globalScene.getPlayerParty();
      const slots: any[] = h.partySlots ?? [];
      const cursor = h.getCursor();
      const choices: Choice[] = slots.map((slot, i) => {
        const mon = party[i] as any;
        const description = slot?.slotDescriptionLabel;
        // the game's own line (Able / Not able / Learned) when it shows one, otherwise level and HP
        let sub = mon ? `Lv.${mon.level}  ${mon.hp}/${mon.getMaxHp()}` : "";
        if (description?.visible && description.text) {
          sub = plain(description.text);
        }
        return {
          key: `p${i}`,
          label: mon ? plain(mon.getNameToRender({ useIllusion: false })) : `${i + 1}`,
          sub,
          selected: cursor === i,
          run: () => {
            ui.setCursor(i);
            return this.confirm();
          },
        };
      });
      if (
        (partyMode === PartyUiMode.MODIFIER_TRANSFER || partyMode === PartyUiMode.DISCARD)
        && !h.transferMode
        && slots.length > 0
      ) {
        choices.push({
          key: "toggle",
          label: i18next.t(
            partyMode === PartyUiMode.MODIFIER_TRANSFER ? "partyUiHandler:transfer" : "partyUiHandler:discard",
          ),
          selected: cursor === 7,
          run: () => {
            ui.setCursor(7);
            return this.confirm();
          },
        });
      }
      if (partyMode !== PartyUiMode.FAINT_SWITCH && partyMode !== PartyUiMode.REVIVAL_BLESSING) {
        choices.push({
          key: "cancel",
          label: i18next.t("partyUiHandler:cancelButton"),
          selected: cursor === 6,
          run: () => this.confirm(Button.CANCEL),
        });
      }
      // fainted members stay tappable: the game itself decides and says why it refuses
      return { id: `PARTY:${partyMode}:slots:${h.transferMode ? 1 : 0}`, columns: 2, choices };
    }

    // the option sub-menu of the chosen Pokémon
    const values: number[] = h.options ?? [];
    const texts: any[] = (h.optionsContainer?.list ?? []).filter((c: any) => typeof c?.getPlainText === "function");
    const labels = texts.map(c => plain(c.getPlainText())).reverse();
    if (values.length === 0 || labels.length !== values.length) {
      return null;
    }
    const SCROLL_UP = 1000;
    const SCROLL_DOWN = 1001;
    const cursor: number = h.optionsCursor ?? 0;
    const scrolling = !!h.optionsScroll;
    const choices: Choice[] = [];
    values.forEach((value, k) => {
      if (value === SCROLL_UP || value === SCROLL_DOWN) {
        choices.push({
          key: value === SCROLL_UP ? "up" : "down",
          label: `${value === SCROLL_UP ? "▲" : "▼"} ${own("more")}`,
          run: () => this.scrollPartyOptions(h, value === SCROLL_UP ? Button.UP : Button.DOWN),
        });
        return;
      }
      const isCancel = k === values.length - 1;
      choices.push({
        key: `v${value}:${k}`,
        label: labels[k],
        selected: cursor === k,
        wide: isCancel,
        run: () => {
          if (isCancel) {
            return this.confirm(Button.CANCEL);
          }
          if (scrolling) {
            // walk there with the D-pad so the list never rests on a scroll arrow
            const limit = 2 * (h.optionsScrollTotal ?? values.length) + 4;
            for (let n = 0; n < limit && h.options?.[h.optionsCursor] !== value; n++) {
              ui.processInput(Button.DOWN);
            }
            if (h.options?.[h.optionsCursor] !== value) {
              return false;
            }
          } else {
            ui.setCursor(k);
          }
          return this.confirm();
        },
      });
    });
    return {
      id: `PARTY:${partyMode}:options:${h.getCursor()}:${values.join(",")}`,
      columns: values.length > 5 ? 2 : 1,
      dense: values.length > 6,
      choices,
    };
  }

  /** The save slot list (new run, load). Moves with the D-pad, because the list scrolls with its own tweens. */
  private buildSaveSlots(h: any): Model | null {
    const slots: any[] = h.sessionSlots ?? [];
    if (!h.active || slots.length === 0 || h.pendingPrompt || h.awaitingActionInput) {
      return null;
    }
    const ui = globalScene.ui;
    const position = () => h.getCursor() + (h.scrollCursor ?? 0);
    const current = position();
    const choices: Choice[] = slots.map((slot, s) => {
      const data = slot.saveData;
      let sub = i18next.t("saveSlotSelectUiHandler:empty");
      if (slot.malformed) {
        sub = i18next.t("menu:failedToLoadSession");
      } else if (slot.hasData && data) {
        sub = `${i18next.t("saveSlotSelectUiHandler:wave")} ${data.waveIndex}`;
      }
      return {
        key: `slot${s}`,
        label: data?.name ? `${s + 1}. ${plain(data.name)}` : `${s + 1}`,
        sub,
        selected: current === s,
        run: () => {
          for (let n = 0; n < slots.length + 2 && position() !== s; n++) {
            ui.processInput(position() < s ? Button.DOWN : Button.UP);
          }
          return position() === s && this.confirm();
        },
      };
    });
    choices.push({ key: "cancel", label: i18next.t("menu:cancel"), run: () => this.confirm(Button.CANCEL) });
    return { id: "SAVE_SLOT", columns: 2, choices };
  }

  /** Scrolls the party option list one page by walking the cursor past the edge. */
  private scrollPartyOptions(h: any, button: Button): boolean {
    const ui = globalScene.ui;
    const start = h.optionsScrollCursor ?? 0;
    const limit = (h.options?.length ?? 10) + 2;
    for (let n = 0; n < limit && (h.optionsScrollCursor ?? 0) === start; n++) {
      ui.processInput(button);
    }
    return true;
  }
}
