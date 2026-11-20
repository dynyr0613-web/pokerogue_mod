/*
 * Dev Bridge (game half). Local development only: `main.ts` starts it when `VITE_DEV_BRIDGE=1`
 * and the dev server runs `plugins/vite/dev-bridge-plugin.ts`.
 *
 * The game polls the dev server for JavaScript commands, runs them in the page with the
 * helpers below in scope (`screen()`, `state()`, `keys("ACTION DOWN")`, `shot()`, `fast()`,
 * `unlockStarter()`, `newGame()`, `startRun()`, `encounter()` ...) and posts the results back. Game messages,
 * UI mode and phase changes and console errors go to the bridge log. `Bridge/bridge.sh` is the
 * shell side.
 *
 * Local fork (2026-11-21): tools for Claude driving the game (the user: "당신이 화면 정보를 보다 쉽게 읽고 원하는 세팅을
 * 빠르게 만드는데 사용할 도구"): `look()` (bridge-look.ts), `scenario()` / `advance()` / `nextWave()`
 * (bridge-scenario.ts), `burst()` and cropped `shot()` (bridge-burst.ts), the setup helpers (bridge-setup.ts), with
 * their pure parts in bridge-pure.ts. Docs: D:/PokeRogueDev/docs/브리지_도구_20261121.md.
 */

import type { Battle } from "#app/battle";
import { burst, cropShot, initBurstTools } from "#app/dev-bridge/bridge-burst";
import { buildLookView, look, recordMessage } from "#app/dev-bridge/bridge-look";
import { clean, enumByName, nameOf, type SettingsPatch } from "#app/dev-bridge/bridge-pure";
import { resolveMove, resolveNature, resolveSpecies } from "#app/dev-bridge/bridge-resolve";
import {
  advance,
  initScenarioTools,
  nextWave,
  pendingScenarios,
  resetOverrides,
  resumePendingScenario,
  scenario,
  scenarioResult,
  snapshotOverrides,
} from "#app/dev-bridge/bridge-scenario";
import {
  addEggs,
  applySettings,
  faint,
  giveItem,
  heal,
  loadMovesAnims,
  openMenu,
  setHp,
  setLevel,
  setMoves,
  setStatus,
  setTerrain,
  setWeather,
  takeItem,
} from "#app/dev-bridge/bridge-setup";
import { getGameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import { settings } from "#app/global-settings-manager";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { activeOverrides } from "#app/overrides";
import { Tutorial } from "#app/tutorial";
import { speciesEggMoves } from "#balance/egg-moves";
import { STARTING_WAVE } from "#balance/misc";
import { allAbilities } from "#data/data-lists";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { DexAttr } from "#enums/dex-attr";
import { ExpGainsSpeed } from "#enums/exp-gains-speed";
import { GameModes } from "#enums/game-modes";
import { GameSpeed } from "#enums/game-speed";
import { HpBarSpeed } from "#enums/hp-bar-speed";
import { MoveId } from "#enums/move-id";
import { MoveStyle } from "#enums/move-style";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Nature } from "#enums/nature";
import { Passive } from "#enums/passive";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { TimeOfDay } from "#enums/time-of-day";
import { UiMode } from "#enums/ui-mode";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { MOVE_STYLE_MENU_ORDER } from "#moves/move-style"; // Local fork (2026-11-20): S1 move styles
import { PokemonMove } from "#moves/pokemon-move";
import { allMysteryEncounters } from "#mystery-encounters/mystery-encounter-biomes";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import type { Starter, StarterMoveset } from "#types/save-data";
import type { StarterSpeciesId } from "#types/starter-species-id";
import { MessageUiHandler } from "#ui/message-ui-handler";
import { getStarterData, getStarterMoves } from "#ui/starter-select-ui-utils";

const POLL_MS = 150;
const STATUS_MS = 400;
const STATE_MS = 1000;
const LOG_FLUSH_MS = 100;

let game: Phaser.Game;
let started = false;
let keysQueued = 0;
let lastChangeAt = Date.now();
let lastMode: UiMode | null = null;
let lastPhase: string | null = null;
let lastStateJson = "";
let lastStateAt = 0;
let liveTimer: ReturnType<typeof setInterval> | null = null;
const logBuffer: string[] = [];
let logFlushScheduled = false;

// #region transport

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

async function post(route: string, body: unknown): Promise<any> {
  const res = await fetch(`/__bridge/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body, jsonReplacer),
  });
  return res.json();
}

/** Append lines to the bridge log (batched) */
function log(...lines: string[]): void {
  lastChangeAt = Date.now();
  logBuffer.push(...lines);
  if (logFlushScheduled) {
    return;
  }
  logFlushScheduled = true;
  setTimeout(() => {
    logFlushScheduled = false;
    const batch = logBuffer.splice(0);
    post("log", { lines: batch }).catch(() => undefined);
  }, LOG_FLUSH_MS);
}

function currentMode(): UiMode {
  return globalScene.ui.mode;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// #endregion transport

// #region text helpers

function phaseName(): string {
  return globalScene?.phaseManager?.getCurrentPhase()?.phaseName ?? "-";
}

function modeName(): string {
  return globalScene?.ui ? UiMode[globalScene.ui.mode] : "-";
}

function isPokemon(value: any): value is Pokemon {
  return !!value && typeof value === "object" && typeof value.getPassiveAbility === "function" && !!value.species;
}

/** Make a command result JSON-safe and short: Pokemon become summaries, game objects become their names */
function toPlain(value: any, depth = 4, seen = new WeakSet<object>()): unknown {
  if (value == null || typeof value !== "object") {
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (typeof value === "function") {
      return `[Function ${value.name || "anonymous"}]`;
    }
    return value;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  if (isPokemon(value)) {
    return describePokemon(value);
  }
  if (value instanceof Error) {
    return { error: value.name, message: value.message, stack: value.stack };
  }
  if (value instanceof Map) {
    return toPlain([...value.entries()], depth, seen);
  }
  if (value instanceof Set) {
    return toPlain([...value], depth, seen);
  }
  if (typeof value.type === "string" && typeof value.setVisible === "function") {
    return `[${value.type}${value.name ? ` ${value.name}` : ""}]`;
  }
  if (depth <= 0) {
    return `[${value.constructor?.name ?? "Object"}]`;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const items = value.slice(0, 200).map(v => toPlain(v, depth - 1, seen));
    if (value.length > 200) {
      items.push(`... ${value.length - 200} more`);
    }
    return items;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).slice(0, 100)) {
    out[key] = toPlain(value[key], depth - 1, seen);
  }
  return out;
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}\n${err.stack ?? ""}`;
  }
  return String(err);
}

// #endregion text helpers

// #region dumps

function describePokemon(p: Pokemon): Record<string, unknown> {
  const anyP = p as any;
  return {
    id: p.id,
    name: anyP.getNameToRender?.() ?? p.name,
    species: SpeciesId[p.species.speciesId],
    form: anyP.getFormKey?.() || "",
    fusion: p.fusionSpecies ? SpeciesId[p.fusionSpecies.speciesId] : null,
    level: p.level,
    hp: `${p.hp}/${p.getMaxHp()}`,
    status: p.status ? nameOf(StatusEffect, p.status.effect) : null,
    ability: p.getAbility().name,
    passive: p.hasPassive() ? p.getPassiveAbility().name : null,
    passiveSource: p.usesCustomPassive() ? "custom" : "base",
    customPassiveSpecies: p.customPassiveSpecies.map(s => SpeciesId[s]),
    moves: p.moveset.map(m => `${m.getMove().name} ${m.getMovePp() - m.ppUsed}/${m.getMovePp()}`),
    stats: p.stats,
    stages: p.summonData?.statStages ?? null,
    nature: nameOf(Nature, p.nature),
    ivs: p.ivs,
    shiny: p.shiny,
    items: p.getHeldItems().map(m => `${m.type.name}${m.getStackCount() > 1 ? ` x${m.getStackCount()}` : ""}`),
  };
}

function state(): Record<string, unknown> {
  if (!globalScene) {
    return { loaded: false };
  }
  const battle = globalScene.currentBattle;
  const arena = globalScene.arena;
  return {
    ui: modeName(),
    phase: phaseName(),
    gameMode: globalScene.gameMode ? nameOf(GameModes, globalScene.gameMode.modeId) : null,
    wave: battle?.waveIndex ?? null,
    biome: arena ? nameOf(BiomeId, arena.biomeId) : null,
    battleType: battle ? nameOf(BattleType, battle.battleType) : null,
    double: battle?.double ?? null,
    trainer: battle?.trainer ? (battle.trainer as any).getName?.() : null,
    turn: battle?.turn ?? null,
    weather: arena?.weather ? nameOf(WeatherType, arena.weather.weatherType) : null,
    terrain: arena?.terrain ? nameOf(TerrainType, arena.terrain.terrainType) : null,
    money: globalScene.money,
    party: globalScene.getPlayerParty().map(describePokemon),
    enemies: battle ? globalScene.getEnemyParty().map(describePokemon) : [],
  };
}

interface TextItem {
  x: number;
  y: number;
  text: string;
}

function collectTexts(obj: any, out: TextItem[], parentVisible: boolean): void {
  const visible = parentVisible && obj.visible !== false && (obj.alpha ?? 1) > 0.05;
  if (!visible) {
    return;
  }
  if (typeof obj.text === "string" && obj.text.trim() && typeof obj.getWorldTransformMatrix === "function") {
    const matrix = obj.getWorldTransformMatrix();
    out.push({ x: Math.round(matrix.tx), y: Math.round(matrix.ty), text: clean(obj.text) });
  }
  if (Array.isArray(obj.list)) {
    for (const child of obj.list) {
      collectTexts(child, out, visible);
    }
  }
}

/** What is on screen, as text: the UI mode, the open menu with its cursor, then every visible text by row */
function screen(): string {
  if (!globalScene?.ui) {
    return "(not loaded)";
  }
  const ui = globalScene.ui;
  const lines: string[] = [
    `mode=${modeName()} phase=${phaseName()} wave=${globalScene.currentBattle?.waveIndex ?? "-"}`,
  ];
  const handler: any = ui.getHandler();
  const options = handler?.options;
  if (Array.isArray(options) && options.length > 0) {
    const cursor = (handler.cursor ?? 0) + (handler.scrollCursor ?? 0);
    lines.push("--- menu ---");
    options.forEach((option: any, i: number) => {
      lines.push(`${i === cursor ? ">" : " "} ${clean(String(option.label ?? ""))}`);
    });
  }
  if (ui.mode === UiMode.STARTER_SELECT && handler) {
    const starter = handler.lastStarterId == null ? "-" : SpeciesId[handler.lastStarterId];
    const party = (handler.partyStarterIds ?? []).map((id: number) => SpeciesId[id]).join(",");
    lines.push(`starter=${starter} party=[${party}]`);
  }
  const texts: TextItem[] = [];
  for (const child of globalScene.children.list) {
    collectTexts(child, texts, true);
  }
  texts.sort((a, b) => Math.round(a.y / 4) - Math.round(b.y / 4) || a.x - b.x);
  lines.push("--- text ---");
  let row: TextItem[] = [];
  const flush = () => {
    if (row.length > 0) {
      const seenText = new Set<string>();
      const parts = row.filter(t => !seenText.has(t.text) && seenText.add(t.text)).map(t => t.text);
      lines.push(`${String(row[0].y).padStart(4)}: ${parts.join(" | ")}`);
      row = [];
    }
  };
  for (const item of texts) {
    if (row.length > 0 && Math.abs(item.y - row[0].y) > 4) {
      flush();
    }
    row.push(item);
  }
  flush();
  return lines.join("\n");
}

// #endregion dumps

// #region actions

const BUTTON_ALIASES: Record<string, Button> = {
  USE: Button.ACTION,
  A: Button.ACTION,
  OK: Button.ACTION,
  B: Button.CANCEL,
  BACK: Button.CANCEL,
  START: Button.MENU,
};

/**
 * Deliver button presses to the UI, e.g. `keys("ACTION DOWN*2 wait:500 CANCEL")`.
 * Names are {@linkcode Button} members (plus USE/A/OK/B/BACK/START); `*n` repeats; `wait:ms` pauses.
 */
async function keys(sequence: string, gapMs = 120): Promise<string> {
  const delivered: string[] = [];
  for (const token of sequence.trim().split(/\s+/).filter(Boolean)) {
    const waitMatch = /^wait:(\d+)$/i.exec(token);
    if (waitMatch) {
      await sleep(Number(waitMatch[1]));
      continue;
    }
    const [name, countStr] = token.split("*");
    const upper = name.toUpperCase();
    const button = BUTTON_ALIASES[upper] ?? (Button as Record<string, string | number>)[upper];
    if (typeof button !== "number") {
      throw new Error(`unknown button: ${name}`);
    }
    const count = countStr ? Number(countStr) : 1;
    for (let i = 0; i < count; i++) {
      keysQueued++;
      try {
        globalScene.ui.processInput(button);
      } finally {
        keysQueued--;
      }
      lastChangeAt = Date.now();
      delivered.push(Button[button]);
      await sleep(gapMs);
    }
  }
  return `${delivered.length} pressed: ${delivered.join(" ")} -> ${modeName()}`;
}

/**
 * Wait for a condition: a phase name ("CommandPhase"), "mode:OPTION_SELECT", a JS expression, or a function.
 * @returns the milliseconds waited
 */
async function wait(condition: string | (() => unknown), timeoutMs = 30_000, intervalMs = 100): Promise<number> {
  const start = Date.now();
  let test: () => unknown;
  if (typeof condition === "function") {
    test = condition;
  } else if (condition.startsWith("mode:")) {
    const mode = enumByName(UiMode, condition.slice(5), "ui mode");
    test = () => globalScene?.ui?.mode === mode;
  } else if (/^[A-Z]\w*Phase$/.test(condition)) {
    test = () => phaseName() === condition;
  } else {
    test = () => evalCommand(condition);
  }
  while (true) {
    if (await test()) {
      return Date.now() - start;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `timeout after ${timeoutMs} ms waiting for ${String(condition)} (now ${modeName()} / ${phaseName()})`,
      );
    }
    await sleep(intervalMs);
  }
}

/** Wait until no key is being delivered and nothing has changed for `quietMs` */
async function settle(quietMs = 700, timeoutMs = 30_000): Promise<number> {
  return wait(() => keysQueued === 0 && Date.now() - lastChangeAt >= quietMs, timeoutMs, 50);
}

function snapshot(): Promise<string> {
  return new Promise(resolve => {
    game.renderer.snapshot((image: any) => resolve(image.src as string));
  });
}

async function saveShot(name: string | undefined, dataUrl: string): Promise<string> {
  const response = await post("shot", { name, dataUrl });
  if (!response.path) {
    throw new Error(response.error ?? "the dev server did not save the shot");
  }
  return response.path;
}

/**
 * Save a screenshot to Bridge/shots/<name>.png and return its path.
 * Local fork (2026-11-21): `{crop, scale}` saves only a region ("field", "enemy", "player", "message", "menu", or
 * [x, y, w, h] in 320x180 game pixels), at game pixels times `scale` (default 1); without it, the full canvas as before.
 */
async function shot(name?: string, opts: { crop?: string | number[]; scale?: number } = {}): Promise<string> {
  if (opts.crop != null) {
    return saveShot(name, await cropShot(opts.crop, opts.scale ?? 1));
  }
  return saveShot(name, await snapshot());
}

/** Keep writing the screen to Bridge/live.png every `ms` (0 stops) */
function live(ms = 500): string {
  if (liveTimer) {
    clearInterval(liveTimer);
    liveTimer = null;
  }
  if (ms > 0) {
    liveTimer = setInterval(() => {
      snapshot()
        .then(dataUrl => post("live", { dataUrl }))
        .catch(() => undefined);
    }, ms);
    return `live every ${ms} ms`;
  }
  return "live off";
}

/** Fastest game speed, instant bars, no move animations, no tutorials or repeated dialogue */
function fast(): Record<string, unknown> {
  const max = (enumObject: object) =>
    Math.max(...Object.values(enumObject).filter((v): v is number => typeof v === "number"));
  settings.update("general", "gameSpeed", max(GameSpeed));
  settings.update("general", "hpBarSpeed", max(HpBarSpeed));
  settings.update("general", "expGainsSpeed", max(ExpGainsSpeed));
  settings.update("general", "enableTutorials", false);
  settings.update("general", "skipSeenDialogues", true);
  settings.update("general", "levelMoveConfirmation", false);
  settings.update("display", "enableMoveAnimations", false);
  return { general: settings.general, display: settings.display };
}

/** Mark every tutorial as seen, so none interrupts */
function skipTutorials(): string[] {
  const done: string[] = [];
  for (const tutorial of Object.values(Tutorial)) {
    globalScene.gameData.saveTutorialFlag(tutorial, true);
    done.push(tutorial);
  }
  return done;
}

interface UnlockOptions {
  /** Unlock and enable the passive (default true) */
  passive?: boolean;
  /** Ability bitmask to unlock (default 7: all three) */
  abilities?: number;
  /** Candy count to raise to */
  candies?: number;
  /** Cost reduction to raise to (0-2) */
  cost?: number;
  /** Perfect IVs in the dex (default true) */
  perfectIvs?: boolean;
}

/** Register a starter as caught with its abilities, passive and natures unlocked, then save */
async function unlockStarter(species: number | string, options: UnlockOptions = {}): Promise<Record<string, unknown>> {
  const { passive = true, abilities = 7, candies = 0, cost = 0, perfectIvs = true } = options;
  const speciesId = resolveSpecies(species);
  const root = speciesDataRegistry.getSpecies(speciesId).getRootSpeciesId();
  const gameData = globalScene.gameData;
  const starterData = gameData.starterData[root];
  const dexEntry = gameData.dexData[root];
  if (!starterData || !dexEntry) {
    throw new Error(`${SpeciesId[root]} is not a starter`);
  }
  starterData.abilityAttr |= abilities;
  if (passive) {
    starterData.passiveAttr |= Passive.UNLOCKED | Passive.ENABLED;
  }
  starterData.candyCount = Math.max(starterData.candyCount, candies);
  starterData.valueReduction = Math.max(starterData.valueReduction, cost);
  dexEntry.caughtAttr |=
    DexAttr.NON_SHINY | DexAttr.MALE | DexAttr.FEMALE | DexAttr.DEFAULT_VARIANT | DexAttr.DEFAULT_FORM;
  dexEntry.seenAttr |= dexEntry.caughtAttr;
  dexEntry.natureAttr = (1 << 25) - 1;
  dexEntry.caughtCount = Math.max(dexEntry.caughtCount, 1);
  dexEntry.seenCount = Math.max(dexEntry.seenCount, 1);
  if (perfectIvs) {
    dexEntry.ivs = [31, 31, 31, 31, 31, 31];
  }
  const saved = await gameData.saveSystem();
  return { species: SpeciesId[root], starterData: toPlain(starterData), saved };
}

async function unlockStarters(species: (number | string)[], options: UnlockOptions = {}): Promise<string[]> {
  const done: string[] = [];
  for (const s of species) {
    done.push(String((await unlockStarter(s, options)).species));
  }
  return done;
}

/** Set which species of a starter's line use our passive table, then save */
async function setPassiveChoice(
  starter: number | string,
  customSpecies: (number | string)[],
): Promise<Record<string, unknown>> {
  const root = speciesDataRegistry.getSpecies(resolveSpecies(starter)).getRootSpeciesId();
  const entry = globalScene.gameData.starterData[root];
  if (!entry) {
    throw new Error(`${SpeciesId[root]} is not a starter`);
  }
  entry.customPassiveSpecies = customSpecies.map(resolveSpecies);
  const saved = await globalScene.gameData.saveSystem();
  return { starter: SpeciesId[root], customPassiveSpecies: entry.customPassiveSpecies.map(s => SpeciesId[s]), saved };
}

/** Our table's passive and the base game's, with the abilities, for a species and form */
function speciesInfo(species: number | string, formIndex = 0): Record<string, unknown> {
  const data = speciesDataRegistry.getSpecies(resolveSpecies(species));
  const custom = data.getCustomPassiveAbility(formIndex);
  return {
    id: data.speciesId,
    key: SpeciesId[data.speciesId],
    name: data.getName(formIndex),
    forms: data.forms.map(f => f.formKey),
    abilities: [data.ability1, data.ability2, data.abilityHidden].map(a => allAbilities[a]?.name ?? AbilityId[a]),
    passiveBase: allAbilities[data.getPassiveAbility(formIndex)].name,
    passiveCustom: custom == null ? null : allAbilities[custom].name,
    evolutions: speciesDataRegistry.getEvolutionChain(data.speciesId).map(s => SpeciesId[s]),
  };
}

function requireTitle(): any {
  const phase: any = globalScene.phaseManager.getCurrentPhase();
  if (!phase?.is?.("TitlePhase")) {
    throw new Error(`not at the title screen (phase ${phaseName()}, mode ${modeName()})`);
  }
  return phase;
}

/** From the title screen, open the starter select for a new run (CLASSIC, ENDLESS, SPLICED_ENDLESS, CHALLENGE) */
function newGame(mode: string | number = "CLASSIC"): string {
  const phase = requireTitle();
  phase.gameMode = typeof mode === "number" ? mode : enumByName(GameModes, mode, "game mode");
  globalScene.ui.setMode(UiMode.MESSAGE);
  globalScene.ui.clearText();
  phase.end();
  return `new ${GameModes[phase.gameMode]} game: starter select opening`;
}

interface StarterSpec {
  species: number | string;
  ability?: number;
  form?: number;
  nature?: number | string;
  /** Enable the passive (default true) */
  passive?: boolean;
  /** Species of the line that use our passive table */
  custom?: (number | string)[];
  shiny?: boolean;
  moves?: (number | string)[];
  nickname?: string;
}

interface RunSpec {
  mode?: string | number;
  starters: StarterSpec[];
}

/**
 * The moves the starter select gives a starter (`StarterSelectUiHandler.populateStarterMoveset`): the moveset saved
 * for it (for that form) where still allowed, filled up from its starter and unlocked egg moves, else its first four
 * starter moves. Null for a species that is not a starter, such as an evolved form.
 */
function defaultStarterMoves(speciesId: SpeciesId, formIndex: number): MoveId[] | null {
  if (
    speciesDataRegistry.getSpecies(speciesId).getRootSpeciesId() !== speciesId
    || !globalScene.gameData.starterData[speciesId]
  ) {
    return null;
  }
  const starterId = speciesId as StarterSpeciesId;
  const { starterDataEntry } = getStarterData(starterId);
  const starterMoves = getStarterMoves(starterId, formIndex);
  const eggMoves = ((speciesEggMoves as Partial<Record<SpeciesId, readonly MoveId[]>>)[speciesId] ?? []).filter(
    (_, em) => starterDataEntry.eggMoves & (1 << em),
  );
  const available = [...starterMoves, ...eggMoves];
  const saved = starterDataEntry.moveset;
  let savedForForm: readonly MoveId[] | null = null;
  if (Array.isArray(saved)) {
    savedForForm = saved;
  } else if (saved) {
    savedForForm = saved[formIndex] ?? null;
  }
  const moves: MoveId[] = (savedForForm ?? starterMoves.slice(0, 4)).filter(m => available.includes(m));
  if (moves.length < 4) {
    moves.push(...available.filter(m => !moves.includes(m)).slice(0, 4 - moves.length));
  }
  return [...new Set(moves)];
}

function buildStarter(spec: StarterSpec): Starter {
  const speciesId = resolveSpecies(spec.species);
  const formIndex = spec.form ?? 0;
  // Local fork (2026-11-20), the user: "개발용 설정을 약간 손보자": without "moves" a starter gets the moves the starter
  // select would give it (it used to start with none and could only Struggle); "moves" are applied in `startRun`
  const defaultMoves = spec.moves ? null : defaultStarterMoves(speciesId, formIndex);
  return {
    speciesId,
    shiny: !!spec.shiny,
    variant: 0,
    formIndex,
    female: false,
    abilityIndex: spec.ability ?? 0,
    passive: spec.passive ?? true,
    customPassiveSpecies: (spec.custom ?? []).map(resolveSpecies),
    nature: resolveNature(spec.nature),
    moveset: defaultMoves?.length ? (defaultMoves as StarterMoveset) : undefined,
    pokerus: false,
    nickname: spec.nickname,
    teraType: undefined,
    ivs: [31, 31, 31, 31, 31, 31],
  };
}

/**
 * From the title screen, start a run straight into the first battle, skipping the starter select,
 * e.g. `startRun({ mode: "CLASSIC", starters: [{ species: "CHARMANDER", custom: ["CHARMELEON"] }] })`.
 * A starter without `moves` gets the starter select's moves (a species that is not a starter, such as an evolved
 * form, gets a generated level-up moveset); `moves` are set as given, up to four, without the starter-move check.
 */
function startRun(spec: RunSpec): string {
  requireTitle();
  const modeId = typeof spec.mode === "number" ? spec.mode : enumByName(GameModes, spec.mode ?? "CLASSIC", "game mode");
  const starters = spec.starters.map(buildStarter);
  globalScene.ui.setMode(UiMode.MESSAGE);
  globalScene.ui.clearText();
  globalScene.gameMode = getGameMode(modeId);
  globalScene.newArena(globalScene.gameMode.getStartingBiome());
  globalScene.phaseManager.pushNew("EncounterPhase", false);
  const party = globalScene.getPlayerParty();
  const firstNew = party.length;
  // Builds the party at once; the first battle starts after the sprites (and a starting-biome override's art) load
  new SelectStarterPhase().initBattle(starters);
  // Local fork (2026-11-20): the starters' moves, before that first battle exists
  spec.starters.forEach((starterSpec, i) => {
    const pokemon = party[firstNew + i];
    if (!pokemon) {
      return;
    }
    if (starterSpec.moves) {
      pokemon.moveset = starterSpec.moves.slice(0, 4).map(m => new PokemonMove(resolveMove(m)));
      // Local fork (2026-11-20): `initBattle` already queued the animations of the moves the starter had; load the
      // given moves' animations (and their flame colour copies) too, else they play nothing in the first battles
      // (2026-11-21: shared with `setMoves`, bridge-setup.ts)
      void loadMovesAnims(pokemon);
    } else if (pokemon.moveset.length === 0) {
      pokemon.generateAndPopulateMoveset();
    }
  });
  return `${GameModes[modeId]} run with ${party
    .slice(firstNew)
    .map(p => `${SpeciesId[p.species.speciesId]} [${p.moveset.map(m => MoveId[m.moveId]).join(", ")}]`)
    .join(", ")}`;
}

// #region forced encounter

/** The Mystery Encounter that `encounter()` makes the next new wave, or null */
let forcedEncounter: MysteryEncounterType | null = null;
let newBattleWrapped = false;

function resolveEncounter(type: number | string): MysteryEncounterType {
  const id = typeof type === "number" ? type : enumByName(MysteryEncounterType, type, "mystery encounter");
  if (!Object.hasOwn(allMysteryEncounters, id)) {
    throw new Error(`no such mystery encounter: ${type}`);
  }
  return id as MysteryEncounterType;
}

/**
 * Wrap `BattleScene.newBattle` once: while an encounter is forced, the next new wave (not a reloaded one) is made with
 * the wave's Mystery Encounter roll answered yes and, for that wave only, no Classic fixed battle, then gets the chosen
 * encounter type. Everything is put back right after, so later waves are made as usual.
 */
function wrapNewBattle(): void {
  if (newBattleWrapped) {
    return;
  }
  newBattleWrapped = true;
  const proto = Object.getPrototypeOf(globalScene);
  const original = proto.newBattle as (this: any, fromSession?: unknown) => Battle;
  proto.newBattle = function (this: any, fromSession?: unknown): Battle {
    const type = forcedEncounter;
    if (type == null || fromSession != null) {
      return original.call(this, fromSession);
    }
    forcedEncounter = null;
    const gameMode = this.gameMode;
    const { waveIndex } = this.getNewBattleProps() as { waveIndex: number };
    const replacedFixed: boolean = gameMode.isFixedBattle(waveIndex);
    const ownIsFixed = Object.getOwnPropertyDescriptor(gameMode, "isFixedBattle");
    const isFixedBattle = gameMode.isFixedBattle;
    const battleTypeOverride = Object.getOwnPropertyDescriptor(activeOverrides, "BATTLE_TYPE_OVERRIDE");
    const ownIsWaveMe = Object.getOwnPropertyDescriptor(this, "isWaveMysteryEncounter");
    gameMode.isFixedBattle = (wave: number) => wave !== waveIndex && isFixedBattle.call(gameMode, wave);
    this.isWaveMysteryEncounter = () => true;
    // A battle type override would skip the encounter roll
    Object.defineProperty(activeOverrides, "BATTLE_TYPE_OVERRIDE", {
      value: null,
      configurable: true,
      enumerable: true,
      writable: true,
    });
    let battle: Battle;
    try {
      battle = original.call(this, fromSession);
    } finally {
      if (ownIsWaveMe) {
        Object.defineProperty(this, "isWaveMysteryEncounter", ownIsWaveMe);
      } else {
        Reflect.deleteProperty(this, "isWaveMysteryEncounter");
      }
      if (ownIsFixed) {
        Object.defineProperty(gameMode, "isFixedBattle", ownIsFixed);
      } else {
        Reflect.deleteProperty(gameMode, "isFixedBattle");
      }
      if (battleTypeOverride) {
        Object.defineProperty(activeOverrides, "BATTLE_TYPE_OVERRIDE", battleTypeOverride);
      } else {
        Reflect.deleteProperty(activeOverrides, "BATTLE_TYPE_OVERRIDE");
      }
    }
    if (battle.battleType === BattleType.MYSTERY_ENCOUNTER) {
      battle.mysteryEncounterType = type;
      log(
        `[S] wave ${waveIndex} is the forced encounter ${MysteryEncounterType[type]}${replacedFixed ? " (in place of the fixed battle)" : ""}`,
      );
    } else {
      // Only the Endless final trainer wave and the raid wave before it are decided before the encounter roll
      log(`[E] wave ${waveIndex} could not be the forced encounter ${MysteryEncounterType[type]}`);
    }
    return battle;
  };
}

/**
 * Make the next new wave the chosen Mystery Encounter, whatever that wave would have been (a trainer wave, a Classic
 * fixed battle such as the evil team grunt on wave 112, a boss or X1 wave, a wave outside 10-180). One wave only.
 * Call it at the title before `startRun()` / `newGame()` for the first wave, or during a wave (the reward shop
 * included) for the next one; `encounter(null)` cancels. The encounter's own requirements are not checked.
 */
function encounter(type: number | string | null): string {
  if (type == null) {
    forcedEncounter = null;
    return "no forced encounter";
  }
  wrapNewBattle();
  forcedEncounter = resolveEncounter(type);
  const battle = globalScene.currentBattle;
  const nextWave = battle ? battle.waveIndex + 1 : (activeOverrides.STARTING_WAVE_OVERRIDE ?? STARTING_WAVE);
  const meOverride = activeOverrides.MYSTERY_ENCOUNTER_OVERRIDE;
  const note =
    meOverride != null && meOverride !== forcedEncounter
      ? ` (but MYSTERY_ENCOUNTER_OVERRIDE = ${MysteryEncounterType[meOverride]} still picks the type; set it to null)`
      : "";
  return `the next new wave (${nextWave} if it is not made yet) will be ${MysteryEncounterType[forcedEncounter]}${note}`;
}

// #endregion forced encounter

/** Local fork (2026-11-20): S1 move styles. The names `useMove` takes for a style */
const BRIDGE_MOVE_STYLES = Object.freeze({
  strong: MoveStyle.STRONG,
  normal: MoveStyle.NORMAL,
  agile: MoveStyle.AGILE,
});

/**
 * Local fork (2026-11-20): held-item moves. The line of the open item choice that `item` names: a line number, an item
 * key ("BERRY:SITRUS") or part of the shown name; the first line when left out, `-1` when nothing matches.
 */
function findHeldItemChoiceLine(fight: { heldItemChoiceKeys: readonly string[] }, item?: number | string): number {
  if (item == null) {
    return 0;
  }
  if (typeof item === "number") {
    return item;
  }
  const byKey = fight.heldItemChoiceKeys.indexOf(item);
  if (byKey >= 0) {
    return byKey;
  }
  const options: { label: string }[] = (globalScene.ui.getHandler() as any).options ?? [];
  const byName = options.findIndex(o => String(o.label).includes(item));
  if (byName < 0 || byName >= fight.heldItemChoiceKeys.length) {
    throw new Error(`no held item "${item}" in the choice (${fight.heldItemChoiceKeys.join(", ")})`);
  }
  return byName;
}

/**
 * In the command menu, pick a move by index (and a target in doubles) through the real UI handlers.
 * Local fork (2026-11-20): S1 move styles. When the fight menu asks 강공 / 중공 / 속공, `style` is picked there
 * ("normal", 중공, when left out).
 * Local fork (2026-11-20): held-item moves. When the fight menu asks for a held item (Trick, Switcheroo, Fling,
 * Natural Gift), `item` picks it: its line number in that list (from 0), or its key ("BERRY:SITRUS", "LEFTOVERS") or
 * part of its shown name; the first line when left out.
 */
async function useMove(
  moveIndex: number,
  targetIndex?: number,
  style: keyof typeof BRIDGE_MOVE_STYLES = "normal",
  item?: number | string,
): Promise<string> {
  const ui = globalScene.ui;
  // Local fork (2026-11-21): from the fight menu or a choice opened over it (style / held item), back out to the
  // command menu first (seen in the live check: "bridge.sh move" right after "bridge.sh menu FIGHT" failed)
  for (let i = 0; i < 4 && phaseName() === "CommandPhase" && currentMode() !== UiMode.COMMAND; i++) {
    ui.getHandler().processInput(Button.CANCEL);
    await sleep(150);
  }
  if (currentMode() !== UiMode.COMMAND) {
    throw new Error(`not in the command menu (mode ${modeName()}, phase ${phaseName()})`);
  }
  const command: any = ui.getHandler();
  command.setCursor(0);
  command.processInput(Button.ACTION);
  await sleep(150);
  if (currentMode() !== UiMode.FIGHT) {
    throw new Error(`fight menu did not open (mode ${modeName()})`);
  }
  const fight: any = ui.getHandler();
  fight.setCursor(moveIndex);
  fight.processInput(Button.ACTION);
  await sleep(150);
  // Local fork (2026-11-20): held-item moves. The item choice comes before the style choice
  if (currentMode() === UiMode.OPTION_SELECT && fight.openChoice === "heldItem") {
    const choice: any = ui.getHandler();
    const line = Math.max(findHeldItemChoiceLine(fight, item), 0);
    // A long list scrolls (6 lines show at once): scroll so the line shows, then put the cursor on it
    const scroll = Math.max(0, Math.min(line, choice.options.length - choice.maxOptions));
    choice.setScrollCursor(scroll);
    choice.setCursor(line - scroll);
    choice.processInput(Button.ACTION);
    await sleep(150);
  }
  if (currentMode() === UiMode.OPTION_SELECT) {
    const styleIndex = MOVE_STYLE_MENU_ORDER.indexOf(BRIDGE_MOVE_STYLES[style] ?? MoveStyle.NORMAL);
    const choice: any = ui.getHandler();
    choice.setCursor(Math.max(styleIndex, 0));
    choice.processInput(Button.ACTION);
    await sleep(150);
  }
  if (currentMode() === UiMode.TARGET_SELECT) {
    const target: any = ui.getHandler();
    if (targetIndex != null) {
      target.setCursor(targetIndex);
    }
    target.processInput(Button.ACTION);
    await sleep(100);
  }
  lastChangeAt = Date.now();
  return `move ${moveIndex} chosen -> ${modeName()} / ${phaseName()}`;
}

/** Overrides `override()` also takes by member name, e.g. `{ STARTING_BIOME_OVERRIDE: "FACTORY" }` */
const OVERRIDE_ENUMS: Record<string, Record<string, string | number>> = {
  STARTING_BIOME_OVERRIDE: BiomeId,
  BATTLE_TYPE_OVERRIDE: BattleType,
  MYSTERY_ENCOUNTER_OVERRIDE: MysteryEncounterType,
  MYSTERY_ENCOUNTER_TIER_OVERRIDE: MysteryEncounterTier,
  WEATHER_OVERRIDE: WeatherType,
  STARTING_TERRAIN_OVERRIDE: TerrainType,
  ABILITY_OVERRIDE: AbilityId,
  PASSIVE_ABILITY_OVERRIDE: AbilityId,
  ENEMY_ABILITY_OVERRIDE: AbilityId,
  ENEMY_PASSIVE_ABILITY_OVERRIDE: AbilityId,
  STATUS_OVERRIDE: StatusEffect,
  ENEMY_STATUS_OVERRIDE: StatusEffect,
  NATURE_OVERRIDE: Nature,
  ENEMY_NATURE_OVERRIDE: Nature,
  // Local fork (2026-11-21): for scenario({timeOfDay})
  TIME_OF_DAY_OVERRIDE: TimeOfDay,
};
/** Species overrides take what `startRun` takes: an id, a member name or the displayed name */
const SPECIES_OVERRIDES = new Set([
  "STARTER_SPECIES_OVERRIDE",
  "STARTER_FUSION_SPECIES_OVERRIDE",
  "ENEMY_SPECIES_OVERRIDE",
  "ENEMY_FUSION_SPECIES_OVERRIDE",
]);
/** Moveset overrides take one move or a list, each by id or member name */
const MOVESET_OVERRIDES = new Set(["MOVESET_OVERRIDE", "ENEMY_MOVESET_OVERRIDE"]);

/**
 * The values `override()` would set for a patch, checked but not applied (review fix 2026-11-21: `scenario()` checks
 * its overrides with it before it reloads the page)
 */
function resolveOverrides(patch: Record<string, unknown>): Record<string, unknown> {
  const applied: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(patch)) {
    if (!(key in activeOverrides)) {
      throw new Error(`unknown override: ${key}`);
    }
    applied[key] = overrideValue(key, raw);
  }
  return applied;
}

function overrideValue(key: string, raw: unknown): unknown {
  if (SPECIES_OVERRIDES.has(key) && typeof raw === "string") {
    return resolveSpecies(raw);
  }
  if (MOVESET_OVERRIDES.has(key) && (typeof raw === "string" || Array.isArray(raw))) {
    return Array.isArray(raw) ? raw.map(m => resolveMove(m as number | string)) : resolveMove(raw);
  }
  const enumType = OVERRIDE_ENUMS[key];
  if (typeof raw === "string" && enumType) {
    return enumByName(enumType, raw, key);
  }
  // Any other override that holds a number would keep a string as it is and match nothing
  if (typeof raw === "string" && typeof (activeOverrides as any)[key] === "number") {
    throw new Error(`${key} takes a number, not "${raw}"`);
  }
  return raw;
}

/**
 * Change `activeOverrides` for the rest of the session, e.g. `override({ STARTING_WAVE_OVERRIDE: 85 })`.
 * Local fork (2026-11-20, the user: "개발용 설정을 약간 손보자"): the enum overrides (biome, battle type, encounter,
 * encounter tier, species, ability, moveset, weather, terrain, status, nature) also take a member name ("FACTORY",
 * "SHADY_VITAMIN_DEALER"; species also the displayed name); before, a name was stored as it was and matched nothing.
 */
function override(patch: Record<string, unknown>): Record<string, unknown> {
  // Every value is checked first, so a refused one leaves the whole patch unapplied
  const applied = resolveOverrides(patch);
  for (const [key, value] of Object.entries(applied)) {
    (activeOverrides as any)[key] = value;
  }
  return applied;
}

function help(): string[] {
  return [
    "scene, game, overrides, enums.{SpeciesId,AbilityId,MoveId,Nature,PokemonType,Button,UiMode,GameModes}",
    "screen()                         what is on screen, as text",
    "state() / party() / enemies()    battle and party dump",
    "speciesInfo(species, form=0)     base and custom passive, abilities, evolutions",
    'keys("ACTION DOWN*2 wait:300")   press buttons (Button names, USE/A/OK/B/BACK/START, *n, wait:ms)',
    'useMove(index, target?, style?, item?)  pick a move in the command menu (style "strong" / "normal" / "agile"; item: line, key or name for Trick / Fling / Natural Gift)',
    'wait("CommandPhase" | "mode:OPTION_SELECT" | "js expr", timeoutMs)',
    "settle(quietMs)                  wait until nothing changes",
    'shot("name") / live(ms)          screenshots into Bridge/shots and Bridge/live.png',
    "fast() / skipTutorials()         speed settings, no tutorials",
    'unlockStarter("CHARMANDER", {passive, abilities, candies, cost}) / unlockStarters([...])',
    'setPassiveChoice("CHARMANDER", ["CHARMELEON", "CHARIZARD"])',
    'newGame("CLASSIC")               from the title: open the starter select',
    "startRun({mode, starters: [{species, ability, form, nature, passive, custom, moves}]})",
    "                                 no moves: the starter select's moves; moves: set as given (max 4)",
    'override({STARTING_WAVE_OVERRIDE: 85, STARTING_BIOME_OVERRIDE: "FACTORY"})',
    "                                 enum overrides also by name (biome, battle type, encounter, tier, species,",
    '                                 ability, weather, terrain, status, nature; MOVESET_OVERRIDE: ["SURF", ...])',
    "                                 STARTING_BIOME_OVERRIDE: the run's first battle loads that biome's art",
    'encounter("SHADY_VITAMIN_DEALER") the next new wave is that Mystery Encounter, whatever it would have been',
    "                                 (trainer wave, Classic fixed battle, boss, X1, outside 10-180); one wave;",
    "                                 at the title it is the first wave of startRun/newGame; encounter(null) cancels",
    "MYSTERY_ENCOUNTER_OVERRIDE only picks WHICH encounter a wave that rolls one gets. A wave rolls one only if it is",
    "  wild (no trainer wave), not a Classic fixed battle (e.g. 112 = evil team grunt), not a boss, not X1, and in",
    "  waves 10-180 (Classic); MYSTERY_ENCOUNTER_RATE_OVERRIDE is out of 256, not a percent (256 = every such wave)",
    "saveSystem() / reload()",
    "--- tools (2026-11-21; docs/브리지_도구_20261121.md) ---",
    "look({moves, bench, messages})   screen and battle as short text: header, field, arena, the open window, new messages",
    "scenario(spec)                   from any state to a ready battle/encounter (reloads unless at the title; then",
    "                                 scenarioResult(token)); spec: mode, starters [{species, form, level, moves, items,",
    "                                 ability, passive, custom, nature, shiny}], level, enemy {species, form, level, moves,",
    "                                 items, ability, passive, boss}, biome, timeOfDay, wave, battleType, encounter, weather,",
    "                                 terrain, money, overrides, settings, stopAt, turns, eggs, open, js, restart, keepOverrides",
    'advance(until="input", maxPresses) A through messages, "no" to switch?, until a decision / mode / phase',
    "nextWave()                       faint the foes, skip the rewards, stop at the next decision",
    "burst(name, {count, intervalMs, move, style, item, js, crop, scale, columns, changedOnly, threshold, startOn})",
    'shot(name, {crop: "field"|"enemy"|"player"|"message"|"menu"|[x,y,w,h], scale})',
    'setHp(t, 120|"full"|"50%") faint(t="enemy") heal("party"|"all"|t) setStatus(t, "BURN"|"none") setLevel(t, n)',
    'giveItem(t, "BERRY:SITRUS x2") takeItem(t, name?) setMoves(t, [..]) setWeather(n, turns?) setTerrain(n, turns?)',
    '  targets: "player" "player2" "enemy" "enemy2", party index, "enemy:N"',
    'addEggs(n, {tier, species, shiny, hatchWaves, replace}) openMenu("BALL"|"FIGHT"|"STYLE:0"|"PARTY"|"MENU"|"EGG_LIST"|"BATTLE_LOG"...)',
    'settings() / settings("normal") / settings({speed, anims, tutorials, hpBar, expSpeed, moveStyle, battleStyle, <key>})',
    "health() / resetOverrides() / forceEncounter(type)",
  ];
}

/** Local fork (2026-11-21): whether the page is loaded and running, for `bridge.sh ready` */
function health(): Record<string, unknown> {
  return {
    tools: BRIDGE_TOOLS_VERSION,
    loaded: !!globalScene?.ui,
    mode: modeName(),
    phase: phaseName(),
    frame: game?.loop?.frame ?? null,
    loop: loopSwitched ? "setTimeout" : "requestAnimationFrame",
    upMs: Math.round(performance.now()),
    pendingScenarios: pendingScenarios(),
  };
}

/** Local fork (2026-11-21): the version of the bridge tools; the CLI reloads a page that answers without it */
const BRIDGE_TOOLS_VERSION = 1;

// #endregion actions

// #region command runner

const api = {
  get scene() {
    return globalScene;
  },
  get game() {
    return game;
  },
  get overrides() {
    return activeOverrides;
  },
  enums: { SpeciesId, AbilityId, MoveId, Nature, PokemonType, Button, UiMode, GameModes },
  screen,
  state,
  party: () => globalScene.getPlayerParty().map(describePokemon),
  enemies: () => globalScene.getEnemyParty().map(describePokemon),
  describePokemon,
  speciesInfo,
  resolveSpecies,
  keys,
  useMove,
  wait,
  settle,
  sleep,
  shot,
  live,
  log: (...lines: unknown[]) => log(...lines.map(l => `[U] ${typeof l === "string" ? l : JSON.stringify(toPlain(l))}`)),
  fast,
  skipTutorials,
  unlockStarter,
  unlockStarters,
  setPassiveChoice,
  newGame,
  startRun,
  encounter,
  override,
  saveSystem: () => globalScene.gameData.saveSystem(),
  reload: () => {
    setTimeout(() => window.location.reload(), 200);
    return "reloading";
  },
  help,
  // Local fork (2026-11-21): the tools
  look,
  lookView: buildLookView,
  scenario,
  scenarioResult,
  advance,
  nextWave,
  burst,
  setHp,
  faint,
  heal,
  giveItem,
  takeItem,
  setStatus,
  setWeather,
  setTerrain,
  setLevel,
  setMoves,
  addEggs: (count: number, opts: Parameters<typeof addEggs>[1] = {}) => addEggs(count, opts, resolveSpecies),
  openMenu,
  settings: (patch?: SettingsPatch | "normal" | "fast" | null) => {
    if (patch === "fast") {
      fast();
      return applySettings();
    }
    return applySettings(patch, skipTutorials);
  },
  forceEncounter: (type: number | string | null) => encounter(type),
  resetOverrides,
  health,
};

/** The same helpers for the fork's tests (test/tests/custom/custom-dev-settings-1120.test.ts) */
export const devBridgeApi = api;

// Local fork (2026-11-21): the tools get the helpers they share with the rest of the bridge (here, not in
// `startDevBridge`, so that the tests have them too)
initScenarioTools({
  keys,
  useMove,
  startRun,
  override,
  resolveOverrides,
  encounter,
  resolveEncounter,
  skipTutorials,
  evalCommand,
  log,
});
initBurstTools({ game: () => game, saveShot, useMove, evalCommand });

type Runner = (bridge: typeof api, code: string) => Promise<unknown>;
const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (...args: string[]) => Runner;
// Sloppy-mode function on purpose: `with` puts the helpers in scope and the direct eval sees them by name
const runner = new AsyncFunction("bridge", "__code", "with (bridge) { return eval(__code); }");

async function evalCommand(code: string): Promise<unknown> {
  try {
    return await runner(api, code);
  } catch (err) {
    // Top-level await is not allowed in eval code; wrap the command as an async body
    if (err instanceof SyntaxError && /\bawait\b/.test(code)) {
      return await runner(api, `(async () => {\n${code}\n})()`);
    }
    throw err;
  }
}

async function runCommand(command: { id: number; js: string }): Promise<void> {
  try {
    const result = await evalCommand(command.js);
    await post("result", { id: command.id, ok: true, result: toPlain(result) });
  } catch (err) {
    await post("result", { id: command.id, ok: false, error: errorText(err) });
  }
}

async function pollLoop(): Promise<void> {
  while (true) {
    try {
      const res = await fetch("/__bridge/poll", { cache: "no-store" });
      const { commands } = await res.json();
      for (const command of commands ?? []) {
        // Not awaited: a waiting command must not block the next one
        runCommand(command);
      }
    } catch {
      // The dev server is restarting or gone; keep trying
    }
    await sleep(POLL_MS);
  }
}

// #endregion command runner

// #region reporting

function installHooks(): void {
  const proto = MessageUiHandler.prototype as any;
  const originalShowText = proto.showText;
  proto.showText = function (this: MessageUiHandler, text: string, ...rest: unknown[]) {
    if (typeof text === "string" && text.trim()) {
      log(`[M] ${clean(text)}`);
      recordMessage(text); // Local fork (2026-11-21): for look() and burst()
    }
    return originalShowText.call(this, text, ...rest);
  };

  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    log(`[E] ${args.map(a => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(" ")}`);
    originalError(...args);
  };
  window.addEventListener("error", event => log(`[E] ${event.message} (${event.filename}:${event.lineno})`));
  window.addEventListener("unhandledrejection", event => log(`[E] unhandled rejection: ${errorText(event.reason)}`));
}

let lastSeenFrame = -1;
let stalledTicks = 0;
let loopSwitched = false;

/**
 * The desktop app's browser pane never fires requestAnimationFrame while the Claude window is hidden or
 * covered, which freezes Phaser (even its asset loading). When the frame counter stops, restart the game
 * loop on setTimeout, which keeps running.
 */
function ensureGameLoopRuns(): void {
  if (loopSwitched || !game?.loop?.running) {
    return;
  }
  const frame = game.loop.frame;
  stalledTicks = frame === lastSeenFrame ? stalledTicks + 1 : 0;
  lastSeenFrame = frame;
  if (stalledTicks < 3) {
    return;
  }
  loopSwitched = true;
  const loop: any = game.loop;
  loop.sleep();
  loop.forceSetTimeOut = true;
  loop.wake(true);
  log("[S] requestAnimationFrame is not firing; the game loop now runs on setTimeout");
}

function tickStatus(): void {
  ensureGameLoopRuns();
  if (!globalScene?.ui) {
    return;
  }
  const mode = globalScene.ui.mode;
  const phase = phaseName();
  if (mode !== lastMode) {
    lastMode = mode;
    log(`[UI] ${UiMode[mode]}`);
  }
  if (phase !== lastPhase) {
    lastPhase = phase;
    log(`[P] ${phase}`);
  }
  post("status", {
    mode: UiMode[mode],
    phase,
    wave: globalScene.currentBattle?.waveIndex ?? null,
    keysQueued,
    quietMs: Date.now() - lastChangeAt,
  }).catch(() => undefined);

  if (globalScene.currentBattle && Date.now() - lastStateAt >= STATE_MS) {
    lastStateAt = Date.now();
    const json = JSON.stringify(state(), jsonReplacer);
    if (json !== lastStateJson) {
      lastStateJson = json;
      post("state", JSON.parse(json)).catch(() => undefined);
    }
  }
}

// #endregion reporting

/** Start polling the dev server for commands and reporting game state. Called once from `main.ts`. */
export function startDevBridge(phaserGame: Phaser.Game): void {
  if (started) {
    return;
  }
  started = true;
  game = phaserGame;
  (window as any).devBridge = api;
  installHooks();
  // Local fork (2026-11-21): the overrides `scenario()` goes back to
  snapshotOverrides();
  setInterval(tickStatus, STATUS_MS);
  log("[S] bridge started in the game; window.devBridge is the same API");
  // A scenario that reloaded the page runs now, once the title is up
  resumePendingScenario();
  pollLoop();
}
