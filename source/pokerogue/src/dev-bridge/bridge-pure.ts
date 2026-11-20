/*
 * Dev Bridge tools (local development only), the parts without the game: spec and argument parsing, crop and
 * contact-sheet geometry, pixel comparison and the text layout of `look()`. Local fork (2026-11-21): the tools are for
 * Claude driving the game through `Bridge/bridge.sh` (the user: "당신이 화면 정보를 보다 쉽게 읽고 원하는 세팅을 빠르게
 * 만드는데 사용할 도구"), so everything here aims at few round trips and short, plain text.
 *
 * Nothing here touches the game, so the unit tests (test/tests/custom/custom-dev-bridge-tools-1121.test.ts) use it as is.
 */

// #region text and enums

/** Strip BBCode and PokeRogue's text codes so a message fits on one line */
export function clean(text: string): string {
  return text
    .replace(/\[\/?[a-z]+(=[^\]]*)?\]/gi, "")
    .replace(/@[a-z]\{[^}]*\}/g, "")
    .replace(/\$/g, " / ")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

/** The member of an enum a name stands for ("mega x" and "Mega-X" both find MEGA_X); throws for an unknown name */
export function enumByName<E extends Record<string, string | number>>(
  enumType: E,
  name: string,
  what: string,
): E[keyof E] {
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
export function nameOf(enumObject: Record<string, string | number>, value: number | null | undefined): string | null {
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

/** An enum value from a number (kept) or a member name */
export function enumValue<E extends Record<string, string | number>>(
  enumType: E,
  value: string | number,
  what: string,
): E[keyof E] {
  if (typeof value === "number") {
    if (nameOf(enumType, value) === String(value)) {
      throw new Error(`unknown ${what}: ${value}`);
    }
    return value as E[keyof E];
  }
  if (/^-?\d+$/.test(value.trim())) {
    return enumValue(enumType, Number(value), what);
  }
  return enumByName(enumType, value, what);
}

// #endregion text and enums

// #region screen geometry

/** The game screen in game pixels (the canvas is 6 times that) */
export const GAME_WIDTH = 320;
export const GAME_HEIGHT = 180;

/** A rectangle in game pixels: x, y, width, height */
export type Rect = readonly [x: number, y: number, w: number, h: number];

/**
 * The named crops of `shot()` / `burst()`, in game pixels. The field is everything above the message box; the enemy
 * stands at (236, 84) and the player at (106, 148), both bottom-centred; the option windows open at the bottom right.
 */
export const CROP_REGIONS: Readonly<Record<string, Rect>> = Object.freeze({
  full: [0, 0, GAME_WIDTH, GAME_HEIGHT],
  field: [0, 0, GAME_WIDTH, 132],
  enemy: [150, 0, 170, 104],
  player: [6, 34, 204, 106],
  message: [0, 132, GAME_WIDTH, 48],
  menu: [168, 56, 152, 124],
  top: [0, 0, GAME_WIDTH, 90],
  bottom: [0, 90, GAME_WIDTH, 90],
});

/**
 * The rectangle a crop names, clamped to the screen: a name from {@linkcode CROP_REGIONS}, `[x, y, w, h]` in game
 * pixels, or "x,y,w,h". No crop is the whole screen.
 */
export function resolveCrop(crop?: string | readonly number[] | null): Rect {
  if (crop == null || crop === "") {
    return CROP_REGIONS.full;
  }
  let raw: readonly number[];
  if (typeof crop === "string") {
    const named = CROP_REGIONS[crop.trim().toLowerCase()];
    if (named) {
      return named;
    }
    raw = crop.split(/[\s,]+/).map(Number);
    if (raw.length !== 4 || raw.some(n => !Number.isFinite(n))) {
      throw new Error(`unknown crop "${crop}" (names: ${Object.keys(CROP_REGIONS).join(", ")}, or x,y,w,h)`);
    }
  } else {
    raw = crop;
  }
  if (raw.length !== 4 || raw.some(n => typeof n !== "number" || !Number.isFinite(n))) {
    throw new Error("a crop rectangle is [x, y, w, h] in game pixels (320x180)");
  }
  const x = Math.max(0, Math.min(GAME_WIDTH - 1, Math.round(raw[0])));
  const y = Math.max(0, Math.min(GAME_HEIGHT - 1, Math.round(raw[1])));
  const w = Math.max(1, Math.min(GAME_WIDTH - x, Math.round(raw[2])));
  const h = Math.max(1, Math.min(GAME_HEIGHT - y, Math.round(raw[3])));
  return [x, y, w, h];
}

/** The rectangle in canvas pixels, for a canvas `canvasWidth` wide (1920 for the 320-wide game) */
export function cropToCanvas(rect: Rect, canvasWidth: number, canvasHeight: number): Rect {
  const sx = canvasWidth / GAME_WIDTH;
  const sy = canvasHeight / GAME_HEIGHT;
  return [Math.round(rect[0] * sx), Math.round(rect[1] * sy), Math.round(rect[2] * sx), Math.round(rect[3] * sy)];
}

/** How many times a crop is enlarged on a contact sheet when not given: small crops twice, others once */
export function defaultTileScale(rect: Rect): number {
  return rect[2] <= 170 && rect[3] <= 120 ? 2 : 1;
}

export interface SheetCell {
  /** The tile's top-left corner on the sheet */
  readonly x: number;
  readonly y: number;
  /** Where the label strip under the tile starts */
  readonly labelY: number;
}

export interface SheetLayout {
  readonly columns: number;
  readonly rows: number;
  readonly width: number;
  readonly height: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly labelHeight: number;
  readonly cells: readonly SheetCell[];
}

/** The widest a contact sheet gets when the columns are not given */
export const SHEET_MAX_WIDTH = 1680;
export const SHEET_GAP = 2;
export const SHEET_LABEL_HEIGHT = 11;

/**
 * Lay out `count` tiles of `tileWidth` x `tileHeight` in a grid, each with a label strip under it.
 * @param columns - Tiles per row; by default as many as fit in {@linkcode SHEET_MAX_WIDTH} (at most 10)
 */
export function layoutSheet(count: number, tileWidth: number, tileHeight: number, columns?: number): SheetLayout {
  const n = Math.max(0, Math.floor(count));
  const fit = Math.max(1, Math.min(10, Math.floor((SHEET_MAX_WIDTH + SHEET_GAP) / (tileWidth + SHEET_GAP))));
  const cols = Math.max(1, Math.min(Math.max(n, 1), Math.floor(columns ?? fit)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const cellW = tileWidth + SHEET_GAP;
  const cellH = tileHeight + SHEET_LABEL_HEIGHT + SHEET_GAP;
  const cells: SheetCell[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i % cols) * cellW;
    const y = Math.floor(i / cols) * cellH;
    cells.push({ x, y, labelY: y + tileHeight });
  }
  return {
    columns: cols,
    rows,
    width: cols * cellW - SHEET_GAP,
    height: rows * cellH - SHEET_GAP,
    tileWidth,
    tileHeight,
    labelHeight: SHEET_LABEL_HEIGHT,
    cells,
  };
}

/**
 * The share of pixels (0-100) whose colour differs between two RGBA buffers of the same size by more than `tolerance`
 * in some channel. Buffers of different sizes count as all changed.
 */
export function changedPercent(a: ArrayLike<number>, b: ArrayLike<number>, tolerance = 24): number {
  if (a.length !== b.length || a.length === 0) {
    return 100;
  }
  let changed = 0;
  const pixels = a.length >> 2;
  for (let p = 0; p < a.length; p += 4) {
    if (
      Math.abs(a[p] - b[p]) > tolerance
      || Math.abs(a[p + 1] - b[p + 1]) > tolerance
      || Math.abs(a[p + 2] - b[p + 2]) > tolerance
    ) {
      changed++;
    }
  }
  return (changed / pixels) * 100;
}

/** "12.3" for a percentage, "0" for none, "<0.1" for a trace */
export function formatPercent(value: number): string {
  if (value <= 0) {
    return "0";
  }
  if (value < 0.1) {
    return "<0.1";
  }
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1);
}

// #endregion screen geometry

// #region burst options

export interface BurstOptions {
  /** Frames to capture (1-150; default 30) */
  readonly count: number;
  /** Milliseconds between frames (at least 16; default 100) */
  readonly intervalMs: number;
  readonly crop: Rect;
  readonly cropName: string;
  /** Tiles per row on the sheet */
  readonly columns?: number;
  /** How many times each tile is enlarged */
  readonly scale: number;
  /** Keep only frames that changed from the last kept one by at least `threshold` percent */
  readonly changedOnly: boolean;
  readonly threshold: number;
  /**
   * When capturing starts: "now", or "anim" (the next battle animation; the default when the action is a move) with
   * `waitMs` to wait for it
   */
  readonly startOn: "now" | "anim";
  readonly waitMs: number;
  /** What to do when the burst starts: a move through the fight menu, or JavaScript */
  readonly action?: BurstAction;
}

export interface BurstAction {
  /** The move slot to use (0-3) through the fight menu */
  readonly move?: number;
  readonly target?: number;
  readonly style?: string;
  readonly item?: number | string;
  /** JavaScript run with the bridge helpers in scope */
  readonly js?: string;
}

const BURST_KEYS = new Set([
  "count",
  "intervalMs",
  "interval",
  "crop",
  "columns",
  "scale",
  "changedOnly",
  "changed",
  "threshold",
  "startOn",
  "waitMs",
  "action",
  "move",
  "target",
  "style",
  "item",
  "js",
]);

/** Check and complete the options of `burst()`; a move or JS can be given flat (`{move: 0}`) or as `action` */
export function normalizeBurstOptions(raw: Record<string, unknown> = {}): BurstOptions {
  for (const key of Object.keys(raw)) {
    if (!BURST_KEYS.has(key)) {
      throw new Error(`unknown burst option "${key}" (${[...BURST_KEYS].join(", ")})`);
    }
  }
  const num = (value: unknown, fallback: number, min: number, max: number, what: string): number => {
    if (value == null) {
      return fallback;
    }
    const n = Number(value);
    if (!Number.isFinite(n)) {
      throw new Error(`${what} must be a number`);
    }
    return Math.max(min, Math.min(max, Math.round(n)));
  };
  const crop = resolveCrop(raw.crop as string | number[] | undefined);
  const cropName = typeof raw.crop === "string" && CROP_REGIONS[raw.crop.toLowerCase()] ? raw.crop.toLowerCase() : "";
  const flatAction =
    raw.move != null || raw.js != null
      ? { move: raw.move, target: raw.target, style: raw.style, item: raw.item, js: raw.js }
      : undefined;
  const actionRaw = (raw.action ?? flatAction) as Record<string, unknown> | string | undefined;
  let action: BurstAction | undefined;
  if (typeof actionRaw === "string") {
    action = { js: actionRaw };
  } else if (actionRaw && typeof actionRaw === "object") {
    const move = actionRaw.move == null ? undefined : num(actionRaw.move, 0, 0, 3, "action.move");
    action = {
      ...(move == null ? {} : { move }),
      ...(actionRaw.target == null ? {} : { target: Number(actionRaw.target) }),
      ...(actionRaw.style == null ? {} : { style: String(actionRaw.style) }),
      ...(actionRaw.item == null ? {} : { item: actionRaw.item as number | string }),
      ...(actionRaw.js == null ? {} : { js: String(actionRaw.js) }),
    };
  }
  const defaultStart = action?.move == null ? "now" : "anim";
  const startOn = raw.startOn == null ? defaultStart : String(raw.startOn);
  if (startOn !== "now" && startOn !== "anim") {
    throw new Error('startOn is "now" or "anim"');
  }
  const scale = num(raw.scale, defaultTileScale(crop), 1, 4, "scale");
  // Review fix (2026-11-21): a threshold that is not a number kept only the first frame
  const threshold = raw.threshold == null ? 1 : Number(raw.threshold);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new Error("threshold is a percentage from 0 to 100");
  }
  return {
    count: num(raw.count, 30, 1, 150, "count"),
    intervalMs: num(raw.intervalMs ?? raw.interval, 100, 16, 5000, "intervalMs"),
    crop,
    cropName,
    ...(raw.columns == null ? {} : { columns: num(raw.columns, 4, 1, 20, "columns") }),
    scale,
    changedOnly: !!(raw.changedOnly ?? raw.changed),
    threshold,
    startOn,
    waitMs: num(raw.waitMs, 15_000, 0, 60_000, "waitMs"),
    ...(action ? { action } : {}),
  };
}

// #endregion burst options

// #region targets and values

export interface TargetRef {
  readonly side: "player" | "enemy";
  /** A field slot (0, 1) or, with `party`, a party index */
  readonly index: number;
  /** Whether `index` is a party index rather than a field slot */
  readonly party: boolean;
}

/**
 * Where a helper acts: "player" / "player2" / "enemy" / "enemy2" (field slots), a number (the player's party index),
 * "party:N" / "enemy:N" (party indexes).
 */
export function parseTarget(target: unknown): TargetRef {
  if (typeof target === "number" && Number.isInteger(target) && target >= 0) {
    return { side: "player", index: target, party: true };
  }
  const text = String(target ?? "player")
    .trim()
    .toLowerCase();
  if (/^\d+$/.test(text)) {
    return { side: "player", index: Number(text), party: true };
  }
  let m = /^(player|p|ally)([12])?$/.exec(text);
  if (m) {
    return { side: "player", index: m[2] === "2" ? 1 : 0, party: false };
  }
  m = /^(enemy|e|foe)([12])?$/.exec(text);
  if (m) {
    return { side: "enemy", index: m[2] === "2" ? 1 : 0, party: false };
  }
  m = /^(party|enemy)[:#](\d+)$/.exec(text);
  if (m) {
    return { side: m[1] === "party" ? "player" : "enemy", index: Number(m[2]), party: true };
  }
  throw new Error(
    `unknown target "${String(target)}" (player, player2, enemy, enemy2, a party index, party:N, enemy:N)`,
  );
}

/** The HP `value` asks for, out of `maxHp`: a number, "full" / "max", "50%" (at least 1 when above 0%) */
export function parseHpValue(value: unknown, maxHp: number): number {
  const clamp = (n: number) => Math.max(0, Math.min(maxHp, Math.round(n)));
  if (typeof value === "number") {
    return clamp(value);
  }
  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  if (text === "full" || text === "max") {
    return maxHp;
  }
  const pct = /^(\d+(?:\.\d+)?)%$/.exec(text);
  if (pct) {
    const p = Number(pct[1]);
    return p <= 0 ? 0 : Math.max(1, clamp((maxHp * p) / 100));
  }
  if (/^\d+$/.test(text)) {
    return clamp(Number(text));
  }
  throw new Error(`unknown HP value "${String(value)}" (a number, "full", "50%")`);
}

export interface ItemSpec {
  /** The modifier type name, e.g. "LEFTOVERS", "BERRY" */
  readonly name: string;
  /** For generated types: the berry, type, stat, nature ... by name or number */
  readonly type?: string | number;
  readonly count: number;
}

/**
 * A held item: "LEFTOVERS", "BERRY:LIECHI", "BERRY:LIECHI x3" / "*3", "BERRY(3)" (a generated type by number), or
 * `{ name, type?, count? }`.
 */
export function parseItemSpec(item: unknown): ItemSpec {
  if (item && typeof item === "object") {
    const o = item as Record<string, unknown>;
    if (typeof o.name !== "string" || !o.name.trim()) {
      throw new Error(`an item needs a name: ${JSON.stringify(item)}`);
    }
    const inner = parseItemSpec(o.name);
    const count = o.count == null ? inner.count : Number(o.count);
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(`item count must be 1 or more: ${JSON.stringify(item)}`);
    }
    const type = o.type ?? inner.type;
    return { name: inner.name, ...(type == null ? {} : { type: type as string | number }), count };
  }
  if (typeof item !== "string" || !item.trim()) {
    throw new Error(`unknown item ${JSON.stringify(item)}`);
  }
  let text = item.trim();
  let count = 1;
  const countMatch = /\s*(?:[x×*])\s*(\d+)$/i.exec(text);
  if (countMatch) {
    count = Number(countMatch[1]);
    text = text.slice(0, countMatch.index).trim();
  }
  let type: string | number | undefined;
  const paren = /^([^()]+)\((\w+)\)$/.exec(text);
  const colon = text.indexOf(":");
  let name = text;
  if (paren) {
    name = paren[1].trim();
    type = /^\d+$/.test(paren[2]) ? Number(paren[2]) : paren[2];
  } else if (colon > 0) {
    name = text.slice(0, colon).trim();
    const t = text.slice(colon + 1).trim();
    type = /^\d+$/.test(t) ? Number(t) : t;
  }
  if (count < 1) {
    throw new Error(`item count must be 1 or more: ${item}`);
  }
  return { name: name.toUpperCase().replace(/[\s-]+/g, "_"), ...(type == null ? {} : { type }), count };
}

/**
 * The saved game speed a name or number asks for: slow 2, normal 3, fast 4, turbo / max 5 (the `GameSpeed` values;
 * review fix 2026-11-21: 1 and fractions are refused, no setting has them)
 */
export function parseGameSpeed(speed: unknown): number {
  const named: Record<string, number> = { slow: 2, normal: 3, fast: 4, turbo: 5, max: 5 };
  const valid = (n: number) => Number.isInteger(n) && n >= 2 && n <= 5;
  if (typeof speed === "number" && valid(speed)) {
    return speed;
  }
  const text = String(speed).trim().toLowerCase().replace(/x$/, "");
  if (named[text] != null) {
    return named[text];
  }
  const n = Number(text);
  if (text !== "" && valid(n)) {
    return n;
  }
  throw new Error(`unknown game speed "${String(speed)}" (slow, normal = 3, fast, turbo = 5)`);
}

/** What `advance()` / `scenario({stopAt})` stop at */
export interface UntilSpec {
  /** "input": the first screen that needs a decision; "mode": that UI mode; "phase": that phase starts */
  readonly kind: "input" | "mode" | "phase";
  readonly value: string;
}

/** "input" (default), a UI mode name ("COMMAND", "mode:PARTY") or a phase name ("TurnEndPhase") */
export function parseUntil(until: unknown): UntilSpec {
  if (until == null || until === "" || until === "input") {
    return { kind: "input", value: "input" };
  }
  const text = String(until).trim();
  if (/^phase:/i.test(text) || /Phase$/.test(text)) {
    return { kind: "phase", value: text.replace(/^phase:/i, "") };
  }
  return {
    kind: "mode",
    value: text
      .replace(/^mode:/i, "")
      .toUpperCase()
      .replace(/[\s-]+/g, "_"),
  };
}

// #endregion targets and values

// #region scenario spec

export interface ScenarioStarterSpec {
  readonly species: string | number;
  /** Form key ("mega-x") or index */
  readonly form?: string | number;
  readonly level?: number;
  readonly moves?: readonly (string | number)[];
  readonly items?: readonly ItemSpec[];
  /** Ability slot 0-2 */
  readonly ability?: number;
  readonly passive?: boolean;
  /** Species of the line that use our passive table */
  readonly custom?: readonly (string | number)[];
  readonly nature?: string | number;
  readonly shiny?: boolean;
  readonly nickname?: string;
}

export interface ScenarioEnemySpec {
  readonly species?: string | number;
  readonly form?: string | number;
  readonly level?: number;
  readonly moves?: readonly (string | number)[];
  readonly items?: readonly ItemSpec[];
  readonly ability?: string | number;
  readonly passive?: string | number;
  /** true: a boss with 2 bars; a number: that many bars; false: no boss */
  readonly boss?: boolean | number;
  readonly shiny?: boolean;
  readonly nature?: string | number;
}

export interface SettingsPatch {
  /** slow / normal (3) / fast / turbo (5) */
  readonly speed?: string | number;
  /** Move animations */
  readonly anims?: boolean;
  /** false: tutorials off and all marked as seen */
  readonly tutorials?: boolean;
  /** default / fast / faster / skip */
  readonly hpBar?: string | number;
  readonly expSpeed?: string | number;
  /** The 강공 / 중공 / 속공 choice (S1 move styles) */
  readonly moveStyle?: boolean;
  /** "switch" asks "switch?" at each new battle, "set" does not */
  readonly battleStyle?: string | number;
  /** Any other saved setting by its key, e.g. { typeHintsMode: 1 } */
  readonly [key: string]: unknown;
}

export interface ScenarioSpec {
  readonly mode: string;
  readonly starters: readonly ScenarioStarterSpec[];
  /** Every starter's level (each starter's own `level` wins) */
  readonly level?: number;
  readonly enemy?: ScenarioEnemySpec;
  readonly biome?: string | number;
  /** DAWN / DAY / DUSK / NIGHT */
  readonly timeOfDay?: string;
  readonly wave?: number;
  /** "wild" / "trainer", optionally with "single" / "double" ("trainer double") */
  readonly battleType?: string;
  /** A Mystery Encounter for the first wave */
  readonly encounter?: string | number;
  readonly weather?: string | number;
  readonly terrain?: string | number;
  readonly money?: number;
  /** Raw overrides applied last */
  readonly overrides?: Readonly<Record<string, unknown>>;
  readonly settings?: SettingsPatch;
  /** Where the scenario stops (default "input": the first decision, COMMAND or the encounter's options) */
  readonly stopAt?: string;
  /** Test eggs to add */
  readonly eggs?: number;
  /** Turns to play with each player Pokémon's first move before stopping */
  readonly turns?: number;
  /** A window to open at the end: BALL, FIGHT, PARTY, MENU, EGG_LIST, BATTLE_LOG, STYLE:0, ... */
  readonly open?: string;
  /** JavaScript run at the end with the bridge helpers in scope */
  readonly js?: string;
  /** How to get back to the title when not there: "reload" (default) or "soft" (the game's own reset) */
  readonly restart?: "reload" | "soft";
  /** Keep the session's other overrides instead of starting from the defaults */
  readonly keepOverrides?: boolean;
}

const SCENARIO_KEYS = new Set([
  "mode",
  "starters",
  "level",
  "enemy",
  "biome",
  "timeOfDay",
  "time",
  "wave",
  "battleType",
  "encounter",
  "weather",
  "terrain",
  "money",
  "overrides",
  "settings",
  "stopAt",
  "eggs",
  "turns",
  "open",
  "js",
  "restart",
  "keepOverrides",
  // ignored: preset bookkeeping
  "desc",
  "base",
]);
const STARTER_KEYS = new Set([
  "species",
  "form",
  "level",
  "moves",
  "items",
  "ability",
  "passive",
  "custom",
  "nature",
  "shiny",
  "nickname",
]);
const ENEMY_KEYS = new Set([
  "species",
  "form",
  "level",
  "moves",
  "items",
  "ability",
  "passive",
  "boss",
  "shiny",
  "nature",
]);

function checkKeys(obj: Record<string, unknown>, allowed: Set<string>, what: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new Error(
        `unknown ${what} key "${key}" (${[...allowed].filter(k => k !== "desc" && k !== "base").join(", ")})`,
      );
    }
  }
}

function optionalLevel(value: unknown, what: string): number | undefined {
  if (value == null) {
    return undefined;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 10_000) {
    throw new Error(`${what} must be a whole number from 1`);
  }
  return n;
}

function listOf(value: unknown, what: string): (string | number)[] | undefined {
  if (value == null) {
    return undefined;
  }
  const list = Array.isArray(value) ? value : [value];
  for (const v of list) {
    if (typeof v !== "string" && typeof v !== "number") {
      throw new Error(`${what} takes names or ids`);
    }
  }
  return list as (string | number)[];
}

function itemsOf(value: unknown): ItemSpec[] | undefined {
  if (value == null) {
    return undefined;
  }
  return (Array.isArray(value) ? value : [value]).map(parseItemSpec);
}

/** A starter: `{ species, ... }` or the short "CHARIZARD:mega-x" / "CHARIZARD" */
function normalizeStarter(raw: unknown, index: number): ScenarioStarterSpec {
  if (typeof raw === "string" || typeof raw === "number") {
    if (typeof raw === "number") {
      return { species: raw };
    }
    const colon = raw.indexOf(":");
    return colon > 0
      ? { species: raw.slice(0, colon).trim(), form: formValue(raw.slice(colon + 1)) }
      : { species: raw.trim() };
  }
  if (!raw || typeof raw !== "object") {
    throw new Error(`starter ${index} must be a species name or an object`);
  }
  const o = raw as Record<string, unknown>;
  checkKeys(o, STARTER_KEYS, `starter ${index}`);
  if (typeof o.species !== "string" && typeof o.species !== "number") {
    throw new Error(`starter ${index} needs a species`);
  }
  const moves = listOf(o.moves, `starter ${index} moves`);
  if (moves && moves.length > 4) {
    throw new Error(`starter ${index} has more than 4 moves`);
  }
  const level = optionalLevel(o.level, `starter ${index} level`);
  const items = itemsOf(o.items);
  const custom = listOf(o.custom, `starter ${index} custom`);
  return {
    species: o.species,
    ...(o.form == null ? {} : { form: formValue(o.form) }),
    ...(level == null ? {} : { level }),
    ...(moves ? { moves } : {}),
    ...(items ? { items } : {}),
    ...(o.ability == null ? {} : { ability: Number(o.ability) }),
    ...(o.passive == null ? {} : { passive: !!o.passive }),
    ...(custom ? { custom } : {}),
    ...(o.nature == null ? {} : { nature: o.nature as string | number }),
    ...(o.shiny == null ? {} : { shiny: !!o.shiny }),
    ...(o.nickname == null ? {} : { nickname: String(o.nickname) }),
  };
}

function formValue(form: unknown): string | number {
  if (typeof form === "number") {
    return form;
  }
  const text = String(form).trim();
  return /^\d+$/.test(text) ? Number(text) : text;
}

function normalizeEnemy(raw: unknown): ScenarioEnemySpec {
  if (typeof raw === "string" || typeof raw === "number") {
    return normalizeEnemy({ species: raw });
  }
  if (!raw || typeof raw !== "object") {
    throw new Error("enemy must be a species name or an object");
  }
  const o = raw as Record<string, unknown>;
  checkKeys(o, ENEMY_KEYS, "enemy");
  let species = o.species as string | number | undefined;
  let form = o.form == null ? undefined : formValue(o.form);
  if (typeof species === "string" && species.includes(":") && form == null) {
    const [s, f] = species.split(":");
    species = s.trim();
    form = formValue(f);
  }
  const moves = listOf(o.moves, "enemy moves");
  if (moves && moves.length > 4) {
    throw new Error("the enemy has more than 4 moves");
  }
  const level = optionalLevel(o.level, "enemy level");
  const items = itemsOf(o.items);
  let boss: boolean | number | undefined;
  if (typeof o.boss === "number") {
    if (!Number.isInteger(o.boss) || o.boss < 1) {
      throw new Error("enemy boss bars must be 1 or more");
    }
    boss = o.boss;
  } else if (o.boss != null) {
    boss = !!o.boss;
  }
  return {
    ...(species == null ? {} : { species }),
    ...(form == null ? {} : { form }),
    ...(level == null ? {} : { level }),
    ...(moves ? { moves } : {}),
    ...(items ? { items } : {}),
    ...(o.ability == null ? {} : { ability: o.ability as string | number }),
    ...(o.passive == null ? {} : { passive: o.passive as string | number }),
    ...(boss == null ? {} : { boss }),
    ...(o.shiny == null ? {} : { shiny: !!o.shiny }),
    ...(o.nature == null ? {} : { nature: o.nature as string | number }),
  };
}

/** Check a scenario spec (from a preset or JSON) and fill in the defaults; names stay names until the game reads them */
export function normalizeScenarioSpec(raw: unknown): ScenarioSpec {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("a scenario is a JSON object");
  }
  const o = raw as Record<string, unknown>;
  checkKeys(o, SCENARIO_KEYS, "scenario");
  const startersRaw: unknown[] = Array.isArray(o.starters) ? o.starters : [o.starters].filter(s => s != null);
  if (startersRaw.length === 0) {
    throw new Error("a scenario needs starters (1 to 6)");
  }
  if (startersRaw.length > 6) {
    throw new Error("at most 6 starters");
  }
  const starters = startersRaw.map(normalizeStarter);
  const level = optionalLevel(o.level, "level");
  const wave = o.wave == null ? undefined : Number(o.wave);
  if (wave != null && (!Number.isInteger(wave) || wave < 1)) {
    throw new Error("wave must be a whole number from 1");
  }
  const timeOfDay = (o.timeOfDay ?? o.time) as string | undefined;
  if (timeOfDay != null && !/^(dawn|day|dusk|night)$/i.test(String(timeOfDay))) {
    throw new Error("timeOfDay is DAWN, DAY, DUSK or NIGHT");
  }
  if (o.battleType != null) {
    for (const token of String(o.battleType)
      .toLowerCase()
      .split(/[\s+,/]+/)) {
      if (!["wild", "trainer", "single", "double", ""].includes(token)) {
        throw new Error(`battleType takes wild / trainer and single / double, not "${token}"`);
      }
    }
  }
  const eggs = o.eggs == null ? undefined : Number(o.eggs);
  if (eggs != null && (!Number.isInteger(eggs) || eggs < 0 || eggs > 999)) {
    throw new Error("eggs must be 0 to 999");
  }
  const turns = o.turns == null ? undefined : Number(o.turns);
  if (turns != null && (!Number.isInteger(turns) || turns < 0 || turns > 50)) {
    throw new Error("turns must be 0 to 50");
  }
  if (o.restart != null && o.restart !== "reload" && o.restart !== "soft") {
    throw new Error('restart is "reload" or "soft"');
  }
  if (o.overrides != null && (typeof o.overrides !== "object" || Array.isArray(o.overrides))) {
    throw new Error("overrides is an object of override names and values");
  }
  if (o.settings != null && (typeof o.settings !== "object" || Array.isArray(o.settings))) {
    throw new Error("settings is an object, e.g. {speed: 'normal', anims: true}");
  }
  if (o.stopAt != null) {
    parseUntil(o.stopAt);
  }
  return {
    mode: o.mode == null ? "CLASSIC" : String(o.mode).toUpperCase(),
    starters,
    ...(level == null ? {} : { level }),
    ...(o.enemy == null ? {} : { enemy: normalizeEnemy(o.enemy) }),
    ...(o.biome == null ? {} : { biome: o.biome as string | number }),
    ...(timeOfDay == null ? {} : { timeOfDay: String(timeOfDay).toUpperCase() }),
    ...(wave == null ? {} : { wave }),
    ...(o.battleType == null ? {} : { battleType: String(o.battleType).toLowerCase() }),
    ...(o.encounter == null ? {} : { encounter: o.encounter as string | number }),
    ...(o.weather == null ? {} : { weather: o.weather as string | number }),
    ...(o.terrain == null ? {} : { terrain: o.terrain as string | number }),
    ...(o.money == null ? {} : { money: Number(o.money) }),
    ...(o.overrides == null ? {} : { overrides: o.overrides as Record<string, unknown> }),
    ...(o.settings == null ? {} : { settings: o.settings as SettingsPatch }),
    ...(o.stopAt == null ? {} : { stopAt: String(o.stopAt) }),
    ...(eggs == null ? {} : { eggs }),
    ...(turns == null ? {} : { turns }),
    ...(o.open == null ? {} : { open: String(o.open) }),
    ...(o.js == null ? {} : { js: String(o.js) }),
    ...(o.restart == null ? {} : { restart: o.restart as "reload" | "soft" }),
    ...(o.keepOverrides == null ? {} : { keepOverrides: !!o.keepOverrides }),
  };
}

/**
 * The overrides a scenario sets, by name, with names left for `override()` to resolve (enemy form indexes and held
 * items are done in the game). Raw `overrides` come last and win.
 */
export function scenarioOverrides(spec: ScenarioSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (spec.wave != null) {
    out.STARTING_WAVE_OVERRIDE = spec.wave;
  }
  if (spec.biome != null) {
    out.STARTING_BIOME_OVERRIDE = spec.biome;
  }
  if (spec.timeOfDay != null) {
    out.TIME_OF_DAY_OVERRIDE = spec.timeOfDay;
  }
  if (spec.level != null) {
    out.STARTING_LEVEL_OVERRIDE = spec.level;
  }
  if (spec.money != null) {
    out.STARTING_MONEY_OVERRIDE = spec.money;
  }
  if (spec.weather != null) {
    out.WEATHER_OVERRIDE = spec.weather;
  }
  if (spec.terrain != null) {
    out.STARTING_TERRAIN_OVERRIDE = spec.terrain;
  }
  // One Pokémon a side unless asked: a 3-starter party otherwise rolls doubles now and then
  const tokens = (spec.battleType ?? "").split(/[\s+,/]+/);
  out.FIELD_SIZE_OVERRIDE = tokens.includes("double") ? "double" : "single";
  if (tokens.includes("wild")) {
    out.BATTLE_TYPE_OVERRIDE = "WILD";
  } else if (tokens.includes("trainer")) {
    out.BATTLE_TYPE_OVERRIDE = "TRAINER";
  }
  const enemy = spec.enemy;
  if (enemy) {
    if (enemy.species != null) {
      out.ENEMY_SPECIES_OVERRIDE = enemy.species;
    }
    if (enemy.level != null) {
      out.ENEMY_LEVEL_OVERRIDE = enemy.level;
    }
    if (enemy.moves != null) {
      out.ENEMY_MOVESET_OVERRIDE = [...enemy.moves];
    }
    if (enemy.ability != null) {
      out.ENEMY_ABILITY_OVERRIDE = enemy.ability;
    }
    if (enemy.passive != null) {
      out.ENEMY_PASSIVE_ABILITY_OVERRIDE = enemy.passive;
    }
    if (enemy.boss != null) {
      // true: a boss with 2 bars; false: 1 bar (no boss); a number: that many
      out.ENEMY_HEALTH_SEGMENTS_OVERRIDE = typeof enemy.boss === "number" ? enemy.boss : Number(enemy.boss) + 1;
    }
    if (enemy.shiny != null) {
      out.ENEMY_SHINY_OVERRIDE = enemy.shiny;
    }
    if (enemy.nature != null) {
      out.ENEMY_NATURE_OVERRIDE = enemy.nature;
    }
  }
  return { ...out, ...spec.overrides };
}

/**
 * The spec of preset `id` from a presets file: an entry may name a `base` preset whose keys it changes (`enemy`,
 * `settings` and `overrides` are merged one level deep); `desc` and `base` are dropped. The CLI (Bridge/bridge.py)
 * does the same before it sends a preset.
 */
export function resolvePreset(
  presets: Record<string, unknown>,
  id: string,
  seen: string[] = [],
): Record<string, unknown> {
  const entry = presets[id];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(
      `no preset "${id}" (${Object.keys(presets)
        .filter(k => !k.startsWith("_"))
        .join(", ")})`,
    );
  }
  if (seen.includes(id)) {
    throw new Error(`preset loop: ${[...seen, id].join(" -> ")}`);
  }
  const own = entry as Record<string, unknown>;
  const base = typeof own.base === "string" ? resolvePreset(presets, own.base, [...seen, id]) : {};
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(own)) {
    if (key === "desc" || key === "base") {
      continue;
    }
    const prev = merged[key];
    const nested = ["enemy", "settings", "overrides"].includes(key);
    merged[key] =
      nested && prev && typeof prev === "object" && value && typeof value === "object"
        ? { ...(prev as object), ...(value as object) }
        : value;
  }
  return merged;
}

// #endregion scenario spec

// #region look formatting

/** One Pokémon as `look()` shows it */
export interface LookPokemon {
  /** "P1", "P2" on the player's field, "E1", "E2" on the enemy's, "#3" for the bench */
  readonly slot: string;
  readonly name: string;
  /** Species key, e.g. "CHARIZARD" */
  readonly key: string;
  readonly form?: string;
  readonly level: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly status?: string;
  readonly ability?: string;
  readonly passive?: string;
  readonly passiveOn?: boolean;
  readonly items?: readonly string[];
  readonly stages?: string;
  readonly tags?: readonly string[];
  readonly fusion?: string;
  readonly moves?: readonly string[];
}

export interface LookWindow {
  /** The window, e.g. "FIGHT", "OPTION_SELECT (held item for 트릭)" */
  readonly title: string;
  readonly lines: readonly string[];
}

/** Everything `look()` reports, before it becomes text */
export interface LookView {
  /** Header facts in order, e.g. ["COMMAND", "CommandPhase", "wave 1", ...] */
  readonly header: readonly string[];
  readonly field: readonly LookPokemon[];
  readonly bench?: readonly LookPokemon[];
  /** Weather, terrain, arena tags */
  readonly arena?: readonly string[];
  readonly windows: readonly LookWindow[];
  /** Messages shown since the last look / keys */
  readonly messages?: readonly string[];
  /** Problems while reading (one section failing does not stop the rest) */
  readonly notes?: readonly string[];
}

function hpText(p: LookPokemon): string {
  const pct = p.maxHp > 0 ? Math.round((p.hp / p.maxHp) * 1000) / 10 : 0;
  return `HP ${p.hp}/${p.maxHp} (${pct}%)`;
}

/** One line for a Pokémon: slot, name [KEY form], level, HP, status, ability, passive, items, stages, tags */
export function formatPokemonLine(p: LookPokemon, short = false): string {
  const id = p.form ? `${p.key} ${p.form}` : p.key;
  const parts = [`${p.slot} ${p.name}[${id}] Lv${p.level} ${hpText(p)}${p.status ? ` ${p.status}` : ""}`];
  if (short) {
    if (p.items?.length) {
      parts.push(`도구 ${p.items.join(", ")}`);
    }
    return parts.join(" · ");
  }
  if (p.ability) {
    parts.push(`특성 ${p.ability}`);
  }
  if (p.passive) {
    parts.push(`패시브 ${p.passive}(${p.passiveOn ? "on" : "off"})`);
  }
  if (p.items?.length) {
    parts.push(`도구 ${p.items.join(", ")}`);
  }
  if (p.stages) {
    parts.push(`랭크 ${p.stages}`);
  }
  if (p.tags?.length) {
    parts.push(p.tags.join(" "));
  }
  if (p.fusion) {
    parts.push(`퓨전 ${p.fusion}`);
  }
  if (p.moves?.length) {
    parts.push(`기술 ${p.moves.join(" / ")}`);
  }
  return parts.join(" · ");
}

/** The text of `look()`: header, the field, the arena, each open window, new messages; one line per item */
export function formatLook(view: LookView): string {
  const lines: string[] = [view.header.join(" · ")];
  for (const p of view.field) {
    lines.push(formatPokemonLine(p));
  }
  if (view.bench?.length) {
    lines.push(
      `bench: ${view.bench.map(p => `${p.slot} ${p.name} Lv${p.level} ${p.hp}/${p.maxHp}${p.status ? ` ${p.status}` : ""}`).join(" | ")}`,
    );
  }
  if (view.arena?.length) {
    lines.push(`field: ${view.arena.join(" · ")}`);
  }
  for (const w of view.windows) {
    lines.push(`== ${w.title} ==`);
    lines.push(...w.lines);
  }
  if (view.messages?.length) {
    lines.push("== messages ==");
    lines.push(...view.messages);
  }
  if (view.notes?.length) {
    lines.push(...view.notes.map(n => `(note: ${n})`));
  }
  return lines.join("\n");
}

/** Option lines: "> 2 label" for the cursor, "  3 label (disabled)" */
export function formatOptions(
  labels: readonly string[],
  cursor: number,
  disabled: readonly boolean[] = [],
  extra: readonly (string | undefined)[] = [],
): string[] {
  return labels.map(
    (label, i) =>
      `${i === cursor ? ">" : " "} ${i} ${label}${disabled[i] ? " (disabled)" : ""}${extra[i] ? ` ${extra[i]}` : ""}`,
  );
}

/** Short Korean names of the battle stats in `statStages` order (Atk, Def, SpA, SpD, Spe, Acc, Eva) */
export const STAGE_LABELS = Object.freeze(["공격", "방어", "특공", "특방", "스피드", "명중", "회피"]);

/** "공격+2 스피드-1", or "" when every stage is 0 */
export function formatStages(stages: readonly number[] | null | undefined): string {
  if (!stages) {
    return "";
  }
  return stages
    .map((v, i) => (v ? `${STAGE_LABELS[i] ?? `#${i}`}${v > 0 ? "+" : ""}${v}` : ""))
    .filter(Boolean)
    .join(" ");
}

// #endregion look formatting
