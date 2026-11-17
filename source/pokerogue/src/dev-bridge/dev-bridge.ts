/*
 * Dev Bridge (game half). Local development only: `main.ts` starts it when `VITE_DEV_BRIDGE=1`
 * and the dev server runs `plugins/vite/dev-bridge-plugin.ts`.
 *
 * The game polls the dev server for JavaScript commands, runs them in the page with the
 * helpers below in scope (`screen()`, `state()`, `keys("ACTION DOWN")`, `shot()`, `fast()`,
 * `unlockStarter()`, `newGame()`, `startRun()` ...) and posts the results back. Game messages,
 * UI mode and phase changes and console errors go to the bridge log. `Bridge/bridge.sh` is the
 * shell side.
 */

import { getGameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import { settings } from "#app/global-settings-manager";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { activeOverrides } from "#app/overrides";
import { Tutorial } from "#app/tutorial";
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
import { Nature } from "#enums/nature";
import { Passive } from "#enums/passive";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { UiMode } from "#enums/ui-mode";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import type { Starter } from "#types/save-data";
import { MessageUiHandler } from "#ui/message-ui-handler";
import { getEnumValues } from "#utils/enums";

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

/** Strip BBCode and PokeRogue's text codes so a message fits on one log line */
function clean(text: string): string {
  return text
    .replace(/\[\/?[a-z]+(=[^\]]*)?\]/gi, "")
    .replace(/@[a-z]\{[^}]*\}/g, "")
    .replace(/\$/g, " / ")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

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

// #region lookups

function enumByName<E extends Record<string, string | number>>(enumType: E, name: string, what: string): E[keyof E] {
  const key = name
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_") as keyof E;
  const value = enumType[key];
  if (typeof value !== "number") {
    throw new Error(`unknown ${what}: ${name}`);
  }
  return value as E[keyof E];
}

/** The member name for an enum value; also works for the const-object enums that have no reverse mapping */
function nameOf(enumObject: Record<string, string | number>, value: number | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const direct = enumObject[value as unknown as string];
  if (typeof direct === "string") {
    return direct;
  }
  const entry = Object.entries(enumObject).find(([, v]) => v === value);
  return entry ? entry[0] : String(value);
}

/** Accepts a SpeciesId, an enum key ("CHARMANDER") or a displayed name ("파이리") */
function resolveSpecies(species: number | string): SpeciesId {
  if (typeof species === "number") {
    return species as SpeciesId;
  }
  const key = species
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  const byKey = (SpeciesId as Record<string, string | number>)[key];
  if (typeof byKey === "number") {
    return byKey as SpeciesId;
  }
  const wanted = species.trim();
  for (const id of getEnumValues(SpeciesId)) {
    if (speciesDataRegistry.getSpecies(id).getName() === wanted) {
      return id;
    }
  }
  throw new Error(`unknown species: ${species}`);
}

function resolveMove(move: number | string): MoveId {
  return typeof move === "number" ? (move as MoveId) : enumByName(MoveId, move, "move");
}

function resolveNature(nature: number | string | undefined): Nature {
  if (nature == null) {
    return Nature.HARDY;
  }
  return typeof nature === "number" ? (nature as Nature) : enumByName(Nature, nature, "nature");
}

// #endregion lookups

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

/** Save a screenshot to Bridge/shots/<name>.png and return its path */
async function shot(name?: string): Promise<string> {
  const response = await post("shot", { name, dataUrl: await snapshot() });
  return response.path ?? response.error;
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

function buildStarter(spec: StarterSpec): Starter {
  return {
    speciesId: resolveSpecies(spec.species),
    shiny: !!spec.shiny,
    variant: 0,
    formIndex: spec.form ?? 0,
    female: false,
    abilityIndex: spec.ability ?? 0,
    passive: spec.passive ?? true,
    customPassiveSpecies: (spec.custom ?? []).map(resolveSpecies),
    nature: resolveNature(spec.nature),
    moveset: spec.moves ? (spec.moves.map(resolveMove) as unknown as Starter["moveset"]) : undefined,
    pokerus: false,
    nickname: spec.nickname,
    teraType: undefined,
    ivs: [31, 31, 31, 31, 31, 31],
  };
}

/**
 * From the title screen, start a run straight into the first battle, skipping the starter select,
 * e.g. `startRun({ mode: "CLASSIC", starters: [{ species: "CHARMANDER", custom: ["CHARMELEON"] }] })`.
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
  new SelectStarterPhase().initBattle(starters);
  return `${GameModes[modeId]} run with ${starters.map(s => SpeciesId[s.speciesId]).join(", ")}`;
}

/** In the command menu, pick a move by index (and a target in doubles) through the real UI handlers */
async function useMove(moveIndex: number, targetIndex?: number): Promise<string> {
  const ui = globalScene.ui;
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

/** Change `activeOverrides` for the rest of the session, e.g. `override({ STARTING_WAVE_OVERRIDE: 85 })` */
function override(patch: Record<string, unknown>): Record<string, unknown> {
  const applied: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in activeOverrides)) {
      throw new Error(`unknown override: ${key}`);
    }
    (activeOverrides as any)[key] = value;
    applied[key] = value;
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
    "useMove(index, target?)          pick a move in the command menu",
    'wait("CommandPhase" | "mode:OPTION_SELECT" | "js expr", timeoutMs)',
    "settle(quietMs)                  wait until nothing changes",
    'shot("name") / live(ms)          screenshots into Bridge/shots and Bridge/live.png',
    "fast() / skipTutorials()         speed settings, no tutorials",
    'unlockStarter("CHARMANDER", {passive, abilities, candies, cost}) / unlockStarters([...])',
    'setPassiveChoice("CHARMANDER", ["CHARMELEON", "CHARIZARD"])',
    'newGame("CLASSIC")               from the title: open the starter select',
    "startRun({mode, starters: [{species, ability, form, nature, passive, custom, moves}]})",
    "override({STARTING_WAVE_OVERRIDE: 85})",
    "saveSystem() / reload()",
  ];
}

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
  override,
  saveSystem: () => globalScene.gameData.saveSystem(),
  reload: () => {
    setTimeout(() => window.location.reload(), 200);
    return "reloading";
  },
  help,
};

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
  setInterval(tickStatus, STATUS_MS);
  log("[S] bridge started in the game; window.devBridge is the same API");
  pollLoop();
}
