/*
 * Dev Bridge (local development only): `advance()` through messages, `scenario()` from any state to a ready battle or
 * encounter in one call, and `nextWave()`. Local fork (2026-11-21), for Claude setting up a situation quickly (the
 * user: "원하는 세팅을 빠르게 만드는데 사용할 도구"). Reaching a ready game used to take many calls: waiting for the title,
 * overrides lost in a reload, settings left by an earlier `fast()`, pressing B past "switch?".
 *
 * A scenario that has to reload the page keeps its spec in sessionStorage; the reloaded page's bridge picks it up as
 * soon as it starts, waits for the title and runs it, and `scenarioResult(token)` hands over the result.
 */

import { lastMessageSeq, look } from "#app/dev-bridge/bridge-look";
import {
  normalizeScenarioSpec,
  parseUntil,
  type ScenarioSpec,
  scenarioOverrides,
  type UntilSpec,
} from "#app/dev-bridge/bridge-pure";
import { resolveFormIndex, resolveMove, resolveNature, resolveSpecies } from "#app/dev-bridge/bridge-resolve";
import {
  addEggs,
  applySettings,
  checkItemSpec,
  faint,
  giveItem,
  openMenu,
  setLevel,
} from "#app/dev-bridge/bridge-setup";
import { globalScene } from "#app/global-scene";
import { activeOverrides } from "#app/overrides";
import { Button } from "#enums/buttons";
import { UiMode } from "#enums/ui-mode";

/** What the scenario tools use from the rest of the bridge */
export interface ScenarioDeps {
  keys(sequence: string, gapMs?: number): Promise<string>;
  useMove(moveIndex: number, targetIndex?: number, style?: any, item?: number | string): Promise<string>;
  startRun(spec: { mode?: string | number; starters: any[] }): string;
  override(patch: Record<string, unknown>): Record<string, unknown>;
  /** What `override` would set, checked but not applied */
  resolveOverrides(patch: Record<string, unknown>): Record<string, unknown>;
  encounter(type: number | string | null): string;
  /** Check a Mystery Encounter name or id (throws for an unknown one) */
  resolveEncounter(type: number | string): unknown;
  skipTutorials(): unknown;
  evalCommand(code: string): Promise<unknown>;
  log(...lines: string[]): void;
}

let deps: ScenarioDeps;

export function initScenarioTools(d: ScenarioDeps): void {
  deps = d;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function modeName(): string {
  return globalScene?.ui ? (UiMode[globalScene.ui.mode] ?? String(globalScene.ui.mode)) : "-";
}

function phaseName(): string {
  return globalScene?.phaseManager?.getCurrentPhase()?.phaseName ?? "-";
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

// #region overrides baseline

let overrideBaseline: string | null = null;

/** Remember the overrides the page started with (called once when the bridge starts) */
export function snapshotOverrides(): void {
  overrideBaseline ??= JSON.stringify(activeOverrides);
}

/** Put every override back to what the page started with */
export function resetOverrides(): number {
  if (overrideBaseline == null) {
    return 0;
  }
  const base = JSON.parse(overrideBaseline) as Record<string, unknown>;
  let changed = 0;
  for (const [key, value] of Object.entries(base)) {
    const current = (activeOverrides as Record<string, unknown>)[key];
    if (JSON.stringify(current) !== JSON.stringify(value)) {
      try {
        Object.defineProperty(activeOverrides, key, { value, configurable: true, enumerable: true, writable: true });
        changed++;
      } catch {
        // A test's spy owns it; leave it
      }
    }
  }
  return changed;
}

// #endregion overrides baseline

// #region phase log

/** Every phase that became current, newest last (installed on first use) */
const phaseLog: string[] = [];
let phaseLogTotal = 0;
let phaseHookOn: object | null = null;

/** Watch the phase manager's current phase, so that `advance` sees phases that start and end between two looks */
function hookPhases(): void {
  const pm: any = globalScene?.phaseManager;
  if (!pm || phaseHookOn === pm) {
    return;
  }
  phaseHookOn = pm;
  let current = pm.currentPhase;
  Object.defineProperty(pm, "currentPhase", {
    configurable: true,
    enumerable: true,
    get: () => current,
    set: (phase: any) => {
      current = phase;
      if (phase?.phaseName) {
        phaseLog.push(phase.phaseName);
        phaseLogTotal++;
        if (phaseLog.length > 400) {
          phaseLog.shift();
        }
      }
    },
  });
}

/** The phases that became current after the first `since` (a `phaseLogTotal`) */
function phasesSince(since: number): string[] {
  const missing = phaseLogTotal - since;
  return missing <= 0 ? [] : phaseLog.slice(Math.max(0, phaseLog.length - missing));
}

// #endregion phase log

// #region advance

/** Modes where the A button only moves the story on (no choice is made) */
const PRESS_MODES = new Set([UiMode.MESSAGE, UiMode.EVOLUTION_SCENE, UiMode.EGG_HATCH_SCENE]);

type Step = "press" | "no" | "wait" | "decide";

/** What `advance` does now: press A on a waiting message, answer "no" to "switch?", wait, or stop for a decision */
export function nextAdvanceStep(): Step {
  const ui = globalScene.ui;
  const mode = ui.mode;
  if (PRESS_MODES.has(mode)) {
    const h: any = ui.getHandler();
    return h?.awaitingActionInput && h.onActionInput ? "press" : "wait";
  }
  if (mode === UiMode.CONFIRM && phaseName() === "CheckSwitchPhase") {
    return "no";
  }
  if (mode === UiMode.LOADING) {
    return "wait";
  }
  return "decide";
}

/** Choose "no" in the open yes / no window */
export function answerNo(): void {
  const h: any = globalScene.ui.getHandler();
  h.setCursor(1);
  h.processInput(Button.ACTION);
}

function reached(target: UntilSpec, phaseStart: number): boolean {
  if (target.kind === "mode") {
    return modeName() === target.value;
  }
  if (target.kind === "phase") {
    return phaseName() === target.value || phasesSince(phaseStart).includes(target.value);
  }
  return false;
}

export interface AdvanceResult {
  readonly presses: number;
  readonly noes: number;
  readonly ms: number;
  /** "reached X", "decision at MODE", "idle", "timeout", "max presses" */
  readonly reason: string;
  readonly ok: boolean;
}

/**
 * Press A through messages and answer "no" to "switch?" until `until` ("input": the first screen that needs a
 * decision; a UI mode; a phase), a decision blocks the way, nothing changes for `idleMs`, or `timeoutMs` passes.
 */
export async function advanceCore(
  until?: string,
  maxPresses = 60,
  timeoutMs = 60_000,
  idleMs = 12_000,
): Promise<AdvanceResult> {
  const target = parseUntil(until);
  hookPhases();
  const phaseStart = phaseLogTotal;
  const start = performance.now();
  let presses = 0;
  let noes = 0;
  let decideSince = 0;
  let signature = "";
  let lastChange = start;
  const done = (reason: string, ok: boolean): AdvanceResult => ({
    presses,
    noes,
    ms: performance.now() - start,
    reason,
    ok,
  });
  while (true) {
    const now = performance.now();
    if (reached(target, phaseStart)) {
      return done(`reached ${target.value}`, true);
    }
    const step = nextAdvanceStep();
    if (step === "decide") {
      // A decision only counts once it stays for two polls (some windows flash by during transitions)
      if (decideSince === 0) {
        decideSince = now;
      } else if (now - decideSince >= 120) {
        const where = `decision at ${modeName()} (${phaseName()})`;
        return done(target.kind === "input" ? where : `${where} before ${target.value}`, target.kind === "input");
      }
    } else {
      decideSince = 0;
    }
    if (step === "press") {
      if (presses >= maxPresses) {
        return done(`max presses (${maxPresses})`, false);
      }
      presses++;
      await deps.keys("ACTION", 60);
    } else if (step === "no") {
      noes++;
      answerNo();
      await sleep(150);
    } else {
      await sleep(50);
    }
    const mh: any = globalScene.ui.getMessageHandler();
    const sig = `${modeName()}|${phaseName()}|${lastMessageSeq()}|${mh?.message?.text?.length ?? 0}|${phaseLogTotal}`;
    if (sig !== signature) {
      signature = sig;
      lastChange = performance.now();
    } else if (performance.now() - lastChange > idleMs) {
      return done(`idle ${seconds(idleMs)} at ${modeName()} (${phaseName()})`, false);
    }
    if (performance.now() - start > timeoutMs) {
      return done(`timeout at ${modeName()} (${phaseName()})`, false);
    }
  }
}

function advanceLine(r: AdvanceResult): string {
  return `advance: ${r.presses} A, ${r.noes} no, ${seconds(r.ms)}, ${r.reason}`;
}

/** `advanceCore`, then `look()` */
export async function advance(until?: string, maxPresses = 60, timeoutMs = 60_000): Promise<string> {
  const r = await advanceCore(until, maxPresses, timeoutMs);
  return `${advanceLine(r)}\n${look()}`;
}

// #endregion advance

// #region next wave

/** Skip the reward screen: cancel, then "yes" to "skip?" */
async function skipRewards(): Promise<void> {
  const ui = globalScene.ui;
  (ui.getHandler() as any).processInput(Button.CANCEL);
  for (let i = 0; i < 40 && ui.mode !== UiMode.CONFIRM; i++) {
    const h: any = ui.getHandler();
    if (ui.mode === UiMode.MESSAGE && h.awaitingActionInput && h.onActionInput) {
      await deps.keys("ACTION", 60);
    }
    await sleep(50);
  }
  if (ui.mode === UiMode.CONFIRM) {
    const h: any = ui.getHandler();
    h.setCursor(0);
    h.processInput(Button.ACTION);
    await sleep(200);
  }
}

/**
 * End the wave and go to the next one: in the command menu every foe faints (each player Pokémon on the field then uses
 * its first move, which lets the faint play), the rewards are skipped, and it stops at the next decision.
 */
export async function nextWave(): Promise<string> {
  const ui = globalScene.ui;
  const startWave = globalScene.currentBattle?.waveIndex;
  if (startWave == null) {
    throw new Error("no battle");
  }
  if (ui.mode === UiMode.MYSTERY_ENCOUNTER) {
    throw new Error("in a Mystery Encounter: pick an option instead");
  }
  const lines: string[] = [];
  if (ui.mode === UiMode.COMMAND) {
    lines.push(faint("enemy"));
    for (let i = 0; i < 2 && ui.mode === UiMode.COMMAND; i++) {
      await deps.useMove(0);
      await sleep(150);
    }
  }
  for (let round = 0; round < 3; round++) {
    const r = await advanceCore("MODIFIER_SELECT", 80, 60_000);
    lines.push(advanceLine(r));
    if (ui.mode === UiMode.MODIFIER_SELECT) {
      await skipRewards();
      break;
    }
    if ((globalScene.currentBattle?.waveIndex ?? startWave) !== startWave || !r.ok) {
      break;
    }
  }
  const r = await advanceCore("input", 80, 60_000);
  lines.push(advanceLine(r));
  return `${lines.join("\n")}\n${look()}`;
}

// #endregion next wave

// #region scenario

const PENDING_KEY = "devBridge.pendingScenario";
/** How old a stored scenario may be when the reloaded page finds it */
const PENDING_MAX_AGE_MS = 5 * 60_000;

interface ScenarioState {
  done: boolean;
  text?: string;
  error?: string;
}

const scenarioStates = new Map<string, ScenarioState>();

function atTitle(): boolean {
  return phaseName() === "TitlePhase" && globalScene?.ui?.mode === UiMode.TITLE;
}

async function waitForTitle(timeoutMs: number): Promise<void> {
  const start = performance.now();
  while (!atTitle()) {
    if (performance.now() - start > timeoutMs) {
      throw new Error(`the title did not come within ${seconds(timeoutMs)} (now ${modeName()} / ${phaseName()})`);
    }
    await sleep(100);
  }
  await sleep(300);
}

/** Map a scenario starter to what `startRun` takes, with the form key turned into its index */
function starterForRun(s: ScenarioSpec["starters"][number]): Record<string, unknown> {
  const speciesId = resolveSpecies(s.species);
  return {
    species: speciesId,
    ...(s.form == null ? {} : { form: resolveFormIndex(speciesId, s.form) }),
    ...(s.moves ? { moves: [...s.moves] } : {}),
    ...(s.ability == null ? {} : { ability: s.ability }),
    ...(s.passive == null ? {} : { passive: s.passive }),
    ...(s.custom ? { custom: [...s.custom] } : {}),
    ...(s.nature == null ? {} : { nature: s.nature }),
    ...(s.shiny == null ? {} : { shiny: s.shiny }),
    ...(s.nickname == null ? {} : { nickname: s.nickname }),
  };
}

/** Run a checked scenario from the title screen; the result is a summary line and `look()` */
async function runAtTitle(spec: ScenarioSpec, note: string): Promise<string> {
  const start = performance.now();
  const lines: string[] = [];
  const reset = spec.keepOverrides ? 0 : resetOverrides();
  // Settings: tutorials off unless asked for, then what the spec says
  const settingsPatch = { tutorials: false, ...spec.settings };
  const settingsNow = applySettings(settingsPatch, () => deps.skipTutorials());
  // Overrides, with the enemy's form key turned into its index
  const patch = scenarioOverrides(spec);
  if (spec.enemy?.form != null) {
    if (spec.enemy.species == null) {
      throw new Error("enemy.form needs enemy.species");
    }
    const enemyId = resolveSpecies(spec.enemy.species);
    patch.ENEMY_FORM_OVERRIDES = {
      ...(patch.ENEMY_FORM_OVERRIDES as object),
      [enemyId]: resolveFormIndex(enemyId, spec.enemy.form),
    };
  }
  deps.override(patch);
  deps.encounter(spec.encounter ?? null);
  const run = deps.startRun({ mode: spec.mode, starters: spec.starters.map(starterForRun) });
  lines.push(`start: ${run}`);
  // Each starter's own level and held items, given now (the party exists already) like the item overrides are
  for (const [i, s] of spec.starters.entries()) {
    if (s.level != null) {
      await setLevel(i, s.level);
    }
    for (const item of s.items ?? []) {
      lines.push(await giveItem(i, item));
    }
  }
  const stopAt = spec.stopAt ?? "input";
  // The first battle loads its sprites and move animations first: a longer quiet spell is still not stuck
  let r = await advanceCore(stopAt, 80, 120_000, 40_000);
  lines.push(advanceLine(r));
  // The enemy's held items, once it exists
  if (spec.enemy?.items?.length) {
    const enemies = globalScene.currentBattle ? globalScene.getEnemyField().filter(p => p?.isOnField()) : [];
    if (enemies.length === 0) {
      lines.push("(no enemy on the field: enemy.items not given)");
    }
    for (const [i] of enemies.entries()) {
      for (const item of spec.enemy.items) {
        lines.push(await giveItem(i === 0 ? "enemy" : "enemy2", item));
      }
    }
  }
  for (let t = 0; t < (spec.turns ?? 0); t++) {
    for (let i = 0; i < 2 && globalScene.ui.mode === UiMode.COMMAND; i++) {
      await deps.useMove(0);
      await sleep(150);
    }
    r = await advanceCore("input", 80, 60_000);
    lines.push(`turn ${t + 1}: ${advanceLine(r)}`);
  }
  if (spec.eggs) {
    lines.push(addEggs(spec.eggs, {}, resolveSpecies));
  }
  if (spec.open) {
    lines.push(`open: ${await openMenu(spec.open)}`);
  }
  if (spec.js) {
    const out = await deps.evalCommand(spec.js);
    lines.push(`js: ${typeof out === "string" ? out : JSON.stringify(out)}`);
  }
  const head = `scenario ready in ${seconds(performance.now() - start)}${note} · overrides reset ${reset} · ${settingsNow}`;
  deps.log(`[S] ${head}`);
  return `${head}\n${lines.join("\n")}\n${look()}`;
}

/**
 * From any state to a ready battle or encounter: back to the title (a page reload unless already there, or with
 * `restart: "soft"` the game's own reset), overrides reset to the page's, settings, an optional forced encounter, the
 * run started with the starters (form key or index, moves, level, held items ...), then messages and "switch?" passed
 * until the first decision (or `stopAt`); then `turns`, `eggs`, `open`, `js`. Returns the summary and `look()`;
 * when the page has to reload, `{ reloading: true, token }` instead: `scenarioResult(token)` on the new page gives
 * the result (the CLI waits for it).
 */
/**
 * Check every name in a scenario (species, forms, moves, natures, items, the encounter, the overrides' values)
 * without changing anything. Review fix (2026-11-21): only species and forms were checked before the reload, so a
 * mistyped move or biome cost a reload and failed on the new page.
 */
export function checkScenarioNames(spec: ScenarioSpec): void {
  for (const s of spec.starters) {
    resolveFormIndex(resolveSpecies(s.species), s.form);
    s.moves?.forEach(m => resolveMove(m));
    s.custom?.forEach(c => resolveSpecies(c));
    if (s.nature != null) {
      resolveNature(s.nature);
    }
    s.items?.forEach(checkItemSpec);
  }
  if (spec.enemy?.form != null && spec.enemy.species == null) {
    throw new Error("enemy.form needs enemy.species");
  }
  if (spec.enemy?.species != null) {
    resolveFormIndex(resolveSpecies(spec.enemy.species), spec.enemy.form);
  }
  spec.enemy?.items?.forEach(checkItemSpec);
  if (spec.encounter != null) {
    deps.resolveEncounter(spec.encounter);
  }
  // The enemy's moves, ability, nature, the biome, weather ... as `override()` reads them
  deps.resolveOverrides(scenarioOverrides(spec));
}

export async function scenario(raw: unknown): Promise<string | { reloading: true; token: string }> {
  const spec = normalizeScenarioSpec(raw);
  // Names are checked before anything changes, so a typo costs no reload
  checkScenarioNames(spec);
  if (!atTitle()) {
    if (spec.restart === "soft") {
      resetOverrides();
      globalScene.reset(true);
      try {
        await waitForTitle(25_000);
        return await runAtTitle(spec, " (soft restart)");
      } catch (err) {
        deps.log(
          `[E] soft restart did not reach the title (${err instanceof Error ? err.message : String(err)}); reloading`,
        );
      }
    }
    const token = Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ token, spec, at: Date.now() }));
    deps.log(`[S] scenario ${token}: reloading the page, then it runs at the title`);
    setTimeout(() => window.location.reload(), 150);
    return { reloading: true, token };
  }
  return runAtTitle(spec, "");
}

/** On a fresh page: run the scenario a reload was made for, if any (called once when the bridge starts) */
export function resumePendingScenario(): void {
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    return;
  }
  if (!stored) {
    return;
  }
  const { token, spec, at } = JSON.parse(stored) as { token: string; spec: ScenarioSpec; at: number };
  if (Date.now() - at > PENDING_MAX_AGE_MS) {
    deps.log(`[S] scenario ${token} is too old; not run`);
    return;
  }
  const state: ScenarioState = { done: false };
  scenarioStates.set(token, state);
  (async () => {
    try {
      await waitForTitle(180_000);
      state.text = await runAtTitle(spec, " (after a reload)");
    } catch (err) {
      state.error = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
      deps.log(`[E] scenario ${token}: ${state.error.split("\n")[0]}`);
    } finally {
      state.done = true;
    }
  })();
}

/** The result of the scenario that reloaded the page; waits for it */
export async function scenarioResult(token: string, timeoutMs = 170_000): Promise<string> {
  const state = scenarioStates.get(token);
  if (!state) {
    throw new Error(`no scenario ${token} on this page (still the old page?)`);
  }
  const start = performance.now();
  while (!state.done) {
    if (performance.now() - start > timeoutMs) {
      throw new Error(
        `scenario ${token} still running after ${seconds(timeoutMs)} (now ${modeName()} / ${phaseName()})`,
      );
    }
    await sleep(100);
  }
  if (state.error) {
    throw new Error(state.error);
  }
  return state.text ?? "";
}

/** Scenarios this page is running after a reload */
export function pendingScenarios(): string[] {
  return [...scenarioStates.entries()].filter(([, s]) => !s.done).map(([t]) => t);
}

// #endregion scenario
