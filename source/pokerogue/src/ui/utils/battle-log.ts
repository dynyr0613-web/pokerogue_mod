/*
 * Local fork (2026-11-20): the battle log (전투 기록), Q6 of docs/유저_요청_요소_목록_20261120.md (the official
 * repository's request #2607: at a fast battle speed a miss or an HP change goes by unread); the user: "Q6 - 실행".
 *
 * Every message the battle message box shows during a run (BattleMessageUiHandler.showText, the one place they are
 * shown) is kept here with its wave and turn, the last BATTLE_LOG_SIZE of them, and read back from the menu's
 * "전투 기록" screen (battle-log-ui-handler.ts). Not saved: a reload starts it empty, and a new run clears it.
 */

import { globalScene } from "#app/global-scene";
import { UiMode } from "#enums/ui-mode";
import i18next from "i18next";

/** How many messages the log keeps: about the last 10 to 20 waves of an ordinary run */
export const BATTLE_LOG_SIZE = 300;

/** One message of the log */
export interface BattleLogEntry {
  /** The wave it was shown in */
  wave: number;
  /** The turn it belongs to; 0 before the wave's first command (the encounter, a mystery encounter's talk) */
  turn: number;
  /** Who says it, for a dialogue line */
  speaker?: string | undefined;
  /** The message as the box shows it, without the box's own codes and on one line */
  text: string;
}

/** One line of the log screen: a wave's or a turn's heading, or (part of) a message */
export interface BattleLogLine {
  kind: "wave" | "turn" | "message";
  text: string;
  wave: number;
  turn: number;
  /** A message's second and later lines, set in a little */
  continued?: boolean;
}

/**
 * Where the battle stands for the messages: before the wave's first command, in a turn, or after a turn's end (its
 * leftovers, weather and the like come after the turn counter has already gone up)
 */
type TurnState = "intro" | "turn" | "turnEnd";

/** The last {@linkcode capacity} messages, oldest first; a ring buffer */
export class BattleLog {
  public readonly capacity: number;
  private readonly slots: (BattleLogEntry | undefined)[];
  /** Where the next message goes */
  private next = 0;
  private count = 0;
  /** The run the messages belong to (its seed); another run's first message clears the log */
  private runKey: string | null = null;
  private turnState: TurnState = "intro";

  constructor(capacity = BATTLE_LOG_SIZE) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.slots = new Array(this.capacity);
  }

  /** How many messages the log holds */
  public get size(): number {
    return this.count;
  }

  /**
   * Add a message, dropping the oldest one when the log is full
   * @param runKey - The run it belongs to; a different run than the log's clears the log first
   */
  public add(entry: BattleLogEntry, runKey: string | null = null): void {
    if (runKey !== null && this.runKey !== null && runKey !== this.runKey) {
      this.clear();
    } else if (this.count > 0 && entry.wave < this.newestWave()) {
      // Review (2026-11-20): a run never goes back a wave (a retried wave keeps its number), so an earlier wave is
      // another run with the same seed: every offline daily run of a day has the day's date as its seed
      this.clear();
    }
    if (runKey !== null) {
      this.runKey = runKey;
    }
    this.slots[this.next] = entry;
    this.next = (this.next + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }

  /** The wave of the newest message; only while the log holds one */
  private newestWave(): number {
    return (this.slots[(this.next - 1 + this.capacity) % this.capacity] as BattleLogEntry).wave;
  }

  /** The messages, oldest first */
  public getEntries(): BattleLogEntry[] {
    const start = (this.next - this.count + this.capacity) % this.capacity;
    return Array.from({ length: this.count }, (_, i) => this.slots[(start + i) % this.capacity] as BattleLogEntry);
  }

  public clear(): void {
    this.slots.fill(undefined);
    this.next = 0;
    this.count = 0;
    this.runKey = null;
  }

  /** A new wave's encounter: its messages come before its first turn */
  public noteEncounter(): void {
    this.turnState = "intro";
  }

  /** A turn has begun (the turn counter already names it) */
  public noteTurnInit(): void {
    this.turnState = "turn";
  }

  /** A turn has ended: the counter has gone up, but what follows still belongs to the turn that ended */
  public noteTurnEnd(): void {
    this.turnState = "turnEnd";
  }

  /**
   * @param battleTurn - The battle's turn counter now
   * @returns The turn a message shown now belongs to
   */
  public getLoggedTurn(battleTurn: number): number {
    switch (this.turnState) {
      case "intro":
        return 0;
      case "turnEnd":
        return Math.max(0, battleTurn - 1);
      default:
        return battleTurn;
    }
  }
}

/** The run's battle log */
export const battleLog = new BattleLog();

/**
 * A message as the log keeps it: without the message box's own codes (`@c{}` expressions, `@d{}` pauses, `@s{}`
 * sounds, `@f{}` fades), styled text and colour tags, and on one line
 */
export function cleanBattleLogText(text: string): string {
  return text
    .replace(/@[cdsf]\{.*?\}/g, "")
    .replace(/@\[[^\]]*\]\{([^}]*)\}/g, "$1")
    .replace(/\[\/?(?:color|shadow)(?:=[^\]]*)?\]/gi, "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim();
}

/**
 * Whether a message the battle message box shows now goes into the log: only during a run and while the box itself
 * is the screen (the `MESSAGE` mode). The box also shows the command prompt and the shop's descriptions, in their own
 * modes; those are not battle messages.
 */
export function shouldRecordBattleMessage(): boolean {
  return !!globalScene?.currentBattle && globalScene.ui?.mode === UiMode.MESSAGE;
}

/**
 * Add a message the battle message box shows to the log, if it is a battle message (see
 * {@linkcode shouldRecordBattleMessage}); empty ones (the box being cleared) are left out
 * @param text - The message
 * @param speaker - Who says it, for a dialogue line
 * @returns Whether it was added
 */
export function recordBattleMessage(text: string, speaker?: string): boolean {
  if (!shouldRecordBattleMessage()) {
    return false;
  }
  const clean = cleanBattleLogText(text ?? "");
  if (!clean) {
    return false;
  }
  const battle = globalScene.currentBattle;
  const name = speaker ? cleanBattleLogText(speaker) : "";
  battleLog.add(
    {
      wave: battle.waveIndex,
      turn: battleLog.getLoggedTurn(battle.turn),
      speaker: name || undefined,
      text: clean,
    },
    globalScene.seed ?? null,
  );
  return true;
}

/** A wave's heading, "웨이브 12" */
export function getBattleLogWaveText(wave: number): string {
  return i18next.t("battleLog:wave", { wave });
}

/** A turn's heading, "3턴" */
export function getBattleLogTurnText(turn: number): string {
  return i18next.t("battleLog:turn", { turn });
}

/** Where a line of the log stands, for the screen's header: "웨이브 12 · 3턴", or the wave alone before its first turn */
export function getBattleLogPositionText(line: Pick<BattleLogLine, "wave" | "turn">): string {
  const wave = getBattleLogWaveText(line.wave);
  return line.turn > 0 ? `${wave} · ${getBattleLogTurnText(line.turn)}` : wave;
}

/**
 * The log's lines for the screen: a heading where a wave begins (or the same wave again, retried), a heading where a
 * turn begins, and each message cut to the screen's width
 * @param entries - The messages, oldest first
 * @param wrap - Cuts a message into the lines the screen can show
 */
export function buildBattleLogLines(
  entries: readonly BattleLogEntry[],
  wrap: (text: string) => string[],
): BattleLogLine[] {
  const lines: BattleLogLine[] = [];
  let previous: BattleLogEntry | undefined;
  for (const entry of entries) {
    const { wave, turn } = entry;
    const newWave = !previous || wave !== previous.wave || turn < previous.turn;
    if (newWave) {
      lines.push({ kind: "wave", text: getBattleLogWaveText(wave), wave, turn });
    }
    if (turn > 0 && (newWave || turn !== previous?.turn)) {
      lines.push({ kind: "turn", text: getBattleLogTurnText(turn), wave, turn });
    }
    // The speaker before a dialogue line, as the name box shows it above the message
    const text = entry.speaker ? `${entry.speaker}: ${entry.text}` : entry.text;
    const parts = wrap(text)
      .map(part => part.trimEnd())
      .filter(part => part.length > 0);
    parts.forEach((part, index) => {
      lines.push({ kind: "message", text: part, wave, turn, continued: index > 0 });
    });
    previous = entry;
  }
  return lines;
}
