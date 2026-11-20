/*
 * Dev Bridge (local development only): setup helpers that change a run in progress, each answering with one line.
 * Local fork (2026-11-21), for Claude setting up a situation quickly (the user: "원하는 세팅을 빠르게 만드는데 사용할
 * 도구"): HP, fainting, healing, held items through the same creation path as the item overrides, status, weather,
 * terrain, level, moves (their animations loaded), test eggs, opening a window, and the saved settings.
 */

import {
  enumValue,
  type ItemSpec,
  nameOf,
  parseGameSpeed,
  parseHpValue,
  parseItemSpec,
  parseTarget,
  type SettingsPatch,
} from "#app/dev-bridge/bridge-pure";
import { resolveMove } from "#app/dev-bridge/bridge-resolve";
import { globalScene } from "#app/global-scene";
import { settings } from "#app/global-settings-manager";
import { activeOverrides } from "#app/overrides";
import { EvolutionItem } from "#balance/pokemon-evolutions";
import { modifierTypes } from "#data/data-lists";
import { Egg } from "#data/egg";
import { getLevelTotalExp } from "#data/exp";
import { getStatusEffectDescriptor } from "#data/status-effect";
import { TerrainType } from "#data/terrain";
import { BattleStyle } from "#enums/battle-style";
import { BerryType } from "#enums/berry-type";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { EggSourceType } from "#enums/egg-source-types";
import { EggTier } from "#enums/egg-type";
import { ExpGainsSpeed } from "#enums/exp-gains-speed";
import { FormChangeItem } from "#enums/form-change-item";
import { HitResult } from "#enums/hit-result";
import { HpBarSpeed } from "#enums/hp-bar-speed";
import { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { PartyUiMode } from "#enums/party-ui-mode";
import { PokemonType } from "#enums/pokemon-type";
import type { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { UiMode } from "#enums/ui-mode";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { PokemonHeldItemModifier } from "#modifiers/modifier";
import { getHeldItemKey } from "#moves/held-item-moves";
import { getAnimMoveId } from "#moves/move-transform";
import { PokemonMove } from "#moves/pokemon-move";
import { loadMoveAnimations } from "#sprites/pokemon-asset-loader";
import { getEnumValues } from "#utils/enums";

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function modeName(): string {
  return UiMode[globalScene.ui.mode] ?? String(globalScene.ui.mode);
}

// #region targets

/** The Pokémon a target names (see `parseTarget`) */
export function resolvePokemon(target: unknown): Pokemon {
  const ref = parseTarget(target);
  let pokemon: Pokemon | undefined;
  if (ref.side === "player") {
    pokemon = ref.party ? globalScene.getPlayerParty()[ref.index] : globalScene.getPlayerField()[ref.index];
  } else {
    pokemon = ref.party ? globalScene.getEnemyParty()[ref.index] : globalScene.getEnemyField()[ref.index];
  }
  if (!pokemon) {
    throw new Error(`no Pokémon at ${String(target)}`);
  }
  return pokemon;
}

/** "P1 리자몽" / "E1 해피너스" / "#3 피카츄" for a result line */
export function pokemonLabel(p: Pokemon): string {
  const name = (p as any).getNameToRender?.() ?? p.name;
  if (p.isOnField()) {
    return `${p.isPlayer() ? "P" : "E"}${p.getFieldIndex() + 1} ${name}`;
  }
  const party = p.isPlayer() ? globalScene.getPlayerParty() : globalScene.getEnemyParty();
  return `${p.isPlayer() ? "#" : "e#"}${(party as Pokemon[]).indexOf(p)} ${name}`;
}

function hpLine(p: Pokemon): string {
  return `${pokemonLabel(p)} HP ${p.hp}/${p.getMaxHp()}${p.status?.effect ? ` ${getStatusEffectDescriptor(p.status.effect)}` : ""}`;
}

// #endregion targets

// #region HP, status, level, moves

/** Set HP: a number, "full", "50%" ("1" for one HP). 0 is `faint` */
export async function setHp(target: unknown, value: unknown): Promise<string> {
  const p = resolvePokemon(target);
  const hp = parseHpValue(value, p.getMaxHp());
  if (hp === 0) {
    return faint(target);
  }
  p.hp = hp;
  await p.updateInfo(true);
  return hpLine(p);
}

/**
 * Faint a Pokémon the way indirect damage does: its HP drops to 0 and a faint is queued, which plays when the current
 * phase ends (in the command menu: once a command is chosen). "enemy" faints every enemy on the field.
 */
export function faint(target: unknown = "enemy"): string {
  const list: Pokemon[] =
    String(target).toLowerCase() === "enemy" || String(target).toLowerCase() === "enemies"
      ? globalScene.getEnemyField().filter(p => p?.isOnField() && !p.isFainted())
      : [resolvePokemon(target)];
  if (list.length === 0) {
    throw new Error("nothing to faint");
  }
  for (const p of list) {
    p.damageAndUpdate(p.hp, { result: HitResult.INDIRECT, ignoreSegments: true });
  }
  return `${list.map(pokemonLabel).join(", ")} HP 0; faints when ${globalScene.phaseManager.getCurrentPhase()?.phaseName ?? "this phase"} ends`;
}

/** Full HP, no status, full PP: "party" (default), "all" (enemies too) or one target */
export async function heal(which: unknown = "party"): Promise<string> {
  const key = String(which).toLowerCase();
  let list: Pokemon[];
  if (key === "party") {
    list = globalScene.getPlayerParty();
  } else if (key === "all") {
    list = [...globalScene.getPlayerParty(), ...(globalScene.currentBattle ? globalScene.getEnemyParty() : [])];
  } else {
    list = [resolvePokemon(which)];
  }
  for (const p of list) {
    p.hp = p.getMaxHp();
    p.resetStatus(true, true, false, false);
    for (const move of p.getMoveset()) {
      move.ppUsed = 0;
    }
    await p.updateInfo(true);
  }
  return `healed ${list.length}: ${list.map(pokemonLabel).join(", ")}`;
}

/** Korean descriptor ("화상") or enum name ("BURN", "burn"); "none" clears */
function resolveStatus(name: unknown): StatusEffect {
  const text = String(name).trim();
  if (/^(none|clear|ok|-)$/i.test(text)) {
    return StatusEffect.NONE;
  }
  for (const effect of getEnumValues(StatusEffect)) {
    if (effect !== StatusEffect.NONE && getStatusEffectDescriptor(effect) === text) {
      return effect;
    }
  }
  return enumValue(StatusEffect, text, "status");
}

/** Set a non-volatile status ("BURN", "화상", "SLEEP", "none"); no immunity check */
export async function setStatus(target: unknown, name: unknown, sleepTurns?: number): Promise<string> {
  const p = resolvePokemon(target);
  const effect = resolveStatus(name);
  if (effect === StatusEffect.NONE) {
    p.resetStatus(false, false, false, false);
  } else if (effect === StatusEffect.FAINT) {
    return faint(target);
  } else {
    p.doSetStatus(effect, sleepTurns ?? (effect === StatusEffect.SLEEP ? 3 : 0));
  }
  await p.updateInfo(true);
  return hpLine(p);
}

/** Set the level (HP keeps its share), with the matching experience */
export async function setLevel(target: unknown, level: number): Promise<string> {
  const p = resolvePokemon(target);
  if (!Number.isInteger(level) || level < 1) {
    throw new Error("level must be a whole number from 1");
  }
  const ratio = p.getMaxHp() > 0 ? p.hp / p.getMaxHp() : 1;
  p.level = level;
  p.exp = getLevelTotalExp(level, p.species.growthRate);
  p.calculateStats();
  if (p.hp > 0) {
    p.hp = Math.max(1, Math.round(p.getMaxHp() * ratio));
  }
  await p.updateInfo(true);
  return `${pokemonLabel(p)} Lv${p.level} HP ${p.hp}/${p.getMaxHp()}`;
}

/** Start loading the moves' animations (and their flame colour copies) for a Pokémon */
export function loadMovesAnims(p: Pokemon): Promise<void> {
  return loadMoveAnimations(
    p.getMoveset().map(m => getAnimMoveId(m.getMove())),
    p,
  ).then(() => {
    if (!globalScene.load.isLoading()) {
      globalScene.load.start();
    }
  });
}

/** Replace the moves (up to four, by name or id), with full PP, and load their animations */
export async function setMoves(target: unknown, moves: readonly (string | number)[]): Promise<string> {
  const p = resolvePokemon(target);
  const list = (Array.isArray(moves) ? moves : [moves]).slice(0, 4).map(m => new PokemonMove(resolveMove(m)));
  if (list.length === 0) {
    throw new Error("give 1 to 4 moves");
  }
  // A moveset override would put its moves back on every read (`getMoveset`): it gives way, and the line says so
  const overrideKey = p.isPlayer() ? "MOVESET_OVERRIDE" : "ENEMY_MOVESET_OVERRIDE";
  let note = "";
  const current = activeOverrides[overrideKey];
  if (Array.isArray(current) ? current.length > 0 : current != null) {
    try {
      (activeOverrides as Record<string, unknown>)[overrideKey] = [];
    } catch {
      Object.defineProperty(activeOverrides, overrideKey, {
        value: [],
        configurable: true,
        enumerable: true,
        writable: true,
      });
    }
    note = ` (${overrideKey} cleared)`;
  }
  p.moveset = list;
  if (p.summonData?.moveset) {
    p.summonData.moveset = list.map(m => new PokemonMove(m.moveId));
  }
  await loadMovesAnims(p);
  return `${pokemonLabel(p)} moves ${p
    .getMoveset()
    .map(m => MoveId[m.moveId])
    .join(", ")}${note}`;
}

// #endregion HP, status, level, moves

// #region held items

/** The enum a generated item type's argument comes from */
const GENERATOR_ARGS: Record<string, Record<string, string | number>> = {
  BERRY: BerryType,
  ATTACK_TYPE_BOOSTER: PokemonType,
  TERA_SHARD: PokemonType,
  BASE_STAT_BOOSTER: Stat,
  TEMP_STAT_STAGE_BOOSTER: Stat,
  MINT: Nature,
  FORM_CHANGE_ITEM: FormChangeItem,
  RARE_FORM_CHANGE_ITEM: FormChangeItem,
  EVOLUTION_ITEM: EvolutionItem as unknown as Record<string, string | number>,
  RARE_EVOLUTION_ITEM: EvolutionItem as unknown as Record<string, string | number>,
  TM_COMMON: MoveId,
  TM_GREAT: MoveId,
  TM_ULTRA: MoveId,
};

let itemNames: Map<string, string> | null = null;

/** The modifier type key for a key or a shown (Korean) item name of a type that is not generated */
function resolveItemKey(name: string): string {
  if (typeof (modifierTypes as any)[name] === "function") {
    return name;
  }
  if (!itemNames) {
    itemNames = new Map();
    for (const [key, func] of Object.entries(modifierTypes as Record<string, () => any>)) {
      try {
        const type = func();
        if (type && !type.is?.("ModifierTypeGenerator")) {
          itemNames.set(type.name, key);
        }
      } catch {
        // Some types need a run; they are found by key
      }
    }
  }
  const byName = itemNames.get(name) ?? itemNames.get(name.replace(/_/g, " "));
  if (!byName) {
    throw new Error(`unknown item "${name}" (a modifier type key such as LEFTOVERS, BERRY:SITRUS, or its shown name)`);
  }
  return byName;
}

/**
 * Check an item's names (the modifier type key or shown name, and a generated type's argument) without making it.
 * Review fix (2026-11-21): `scenario()` checks its items with it before it reloads the page.
 */
export function checkItemSpec(spec: ItemSpec): void {
  const key = resolveItemKey(spec.name);
  const enumType = GENERATOR_ARGS[key];
  if (spec.type != null && enumType) {
    enumValue(enumType, spec.type, `${key} type`);
  }
}

/** Make the held item `spec` for `pokemon` the way `overrideHeldItems` (the item overrides) does */
export function createHeldItem(pokemon: Pokemon, spec: ItemSpec): PokemonHeldItemModifier {
  const key = resolveItemKey(spec.name);
  const func = (modifierTypes as Record<string, () => any>)[key];
  let type = func();
  if (type.is("ModifierTypeGenerator")) {
    let arg: unknown;
    if (spec.type != null) {
      const enumType = GENERATOR_ARGS[key];
      arg = enumType ? enumValue(enumType, spec.type, `${key} type`) : spec.type;
    }
    type = type.generateType(globalScene.getPlayerParty(), arg == null ? undefined : [arg]);
    if (!type) {
      throw new Error(
        `${key} made no item${spec.type == null ? " (give a type, e.g. BERRY:SITRUS)" : ` for ${spec.type}`}`,
      );
    }
  }
  const modifier = type.withIdFromFunc(func).newModifier(pokemon);
  if (!(modifier instanceof PokemonHeldItemModifier)) {
    throw new Error(`${key} is not a held item`);
  }
  modifier.pokemonId = pokemon.id;
  modifier.stackCount = spec.count;
  return modifier;
}

/**
 * Give a held item mid-run: `giveItem("player", "LEFTOVERS")`, `giveItem("enemy", "BERRY:SITRUS x2")`,
 * `giveItem(0, "BERRY", {type: "LIECHI", count: 3})`
 */
export async function giveItem(
  target: unknown,
  item: string | ItemSpec,
  opts: { type?: string | number; count?: number } = {},
): Promise<string> {
  const p = resolvePokemon(target);
  const parsed = parseItemSpec(item);
  const spec: ItemSpec = {
    name: parsed.name,
    count: opts.count ?? parsed.count,
    ...((opts.type ?? parsed.type) == null ? {} : { type: (opts.type ?? parsed.type) as string | number }),
  };
  const modifier = createHeldItem(p, spec);
  let added = true;
  if (p.isPlayer()) {
    added = globalScene.addModifier(modifier, false, false, false, true);
  } else {
    await globalScene.addEnemyModifier(modifier, false, true);
  }
  const held = p.getHeldItems().find(m => getHeldItemKey(m) === getHeldItemKey(modifier));
  // Local fork (2026-11-21): say "at its cap" when it already holds the item (e.g. given by an override before)
  const why = held != null && !added ? "already at its cap: " : "could not take ";
  return `${pokemonLabel(p)} ${added ? "+" : why}${modifier.type.name}[${getHeldItemKey(modifier)}] (now x${held?.getStackCount() ?? 0})`;
}

/** Take held items away: by key ("BERRY:SITRUS", "LEFTOVERS", "BERRY" for every berry) or shown name; none = all */
export function takeItem(target: unknown, name?: string, count?: number): string {
  const p = resolvePokemon(target);
  const wanted = name == null ? null : parseItemSpec(name);
  const items = p.getHeldItems().filter(m => {
    if (!wanted) {
      return true;
    }
    const key = getHeldItemKey(m);
    const full = wanted.type == null ? wanted.name : `${wanted.name}:${String(wanted.type).toUpperCase()}`;
    return key === full || key.split(":")[0] === full || m.type.name === name;
  });
  if (items.length === 0) {
    throw new Error(`${pokemonLabel(p)} holds no ${name ?? "item"}`);
  }
  const taken: string[] = [];
  for (const m of items) {
    const n = Math.min(count ?? m.getStackCount(), m.getStackCount());
    if (n >= m.getStackCount()) {
      globalScene.removeModifier(m, !p.isPlayer());
    } else {
      m.stackCount -= n;
    }
    taken.push(`${m.type.name}[${getHeldItemKey(m)}]x${n}`);
  }
  globalScene.updateModifiers(p.isPlayer(), true);
  return `${pokemonLabel(p)} -${taken.join(", ")}`;
}

// #endregion held items

// #region field

/** Set the weather ("SUNNY", "RAIN", "none"); `turns` 0 or none lasts */
export function setWeather(name: unknown, turns?: number): string {
  const type = /^(none|clear)$/i.test(String(name))
    ? WeatherType.NONE
    : enumValue(WeatherType, String(name), "weather");
  const arena = globalScene.arena;
  const ok = arena.trySetWeather(type);
  if (ok && arena.weather && turns != null) {
    arena.weather.turnsLeft = turns;
    (arena.weather as { maxDuration: number }).maxDuration = turns;
  }
  const now = arena.weather ? `${WeatherType[arena.weather.weatherType]}(${arena.weather.turnsLeft || "∞"})` : "none";
  return `${ok ? "weather" : "weather unchanged"}: ${now}`;
}

/** Set the terrain ("ELECTRIC", "GRASSY", "MISTY", "PSYCHIC", "none") */
export function setTerrain(name: unknown, turns?: number): string {
  const type = /^(none|clear)$/i.test(String(name))
    ? TerrainType.NONE
    : enumValue(TerrainType, String(name), "terrain");
  const arena = globalScene.arena;
  const ok = arena.trySetTerrain(type, true);
  if (ok && arena.terrain && turns != null) {
    arena.terrain.turnsLeft = turns;
    (arena.terrain as { maxDuration: number }).maxDuration = turns;
  }
  const now = arena.terrain ? `${TerrainType[arena.terrain.terrainType]}(${arena.terrain.turnsLeft || "∞"})` : "none";
  return `${ok ? "terrain" : "terrain unchanged"}: ${now}`;
}

// #endregion field

// #region eggs

export interface EggOptions {
  /** COMMON / RARE / EPIC / LEGENDARY (default COMMON) */
  readonly tier?: string | number;
  readonly species?: string | number;
  readonly shiny?: boolean;
  readonly hatchWaves?: number;
  /** Remove the eggs held before (in memory; saved when the game next saves) */
  readonly replace?: boolean;
}

/** Add test eggs to the egg list (the egg cap is not checked) */
export function addEggs(
  count: number,
  opts: EggOptions = {},
  resolveSpeciesFn?: (s: string | number) => SpeciesId,
): string {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error("give a number of eggs");
  }
  const eggs = globalScene.gameData.eggs;
  if (opts.replace) {
    eggs.length = 0;
  }
  const tier = opts.tier == null ? EggTier.COMMON : enumValue(EggTier, opts.tier, "egg tier");
  const species = opts.species == null || !resolveSpeciesFn ? undefined : resolveSpeciesFn(opts.species);
  for (let i = 0; i < count; i++) {
    new Egg({
      sourceType: EggSourceType.GACHA_MOVE,
      tier,
      ...(species == null ? {} : { species }),
      ...(opts.shiny == null ? {} : { isShiny: opts.shiny }),
      ...(opts.hatchWaves == null ? {} : { hatchWaves: opts.hatchWaves }),
    }).addEggToGameData();
  }
  return `eggs: ${eggs.length} (+${count} ${EggTier[tier]})`;
}

// #endregion eggs

// #region windows

/** Windows the main menu opens over itself */
const OVER_MENU = new Set([
  UiMode.BATTLE_LOG,
  UiMode.MARK_DEX,
  UiMode.ACHIEVEMENTS,
  UiMode.GAME_STATS,
  UiMode.SETTINGS_GENERAL,
]);
/** Windows the main menu opens in its place */
const INSTEAD_OF_MENU = new Set([UiMode.EGG_LIST, UiMode.EGG_GACHA, UiMode.POKEDEX]);

async function fromCommand(command: Command): Promise<void> {
  if (globalScene.ui.mode !== UiMode.COMMAND) {
    throw new Error(`the command menu is not open (${modeName()})`);
  }
  const handler: any = globalScene.ui.getHandler();
  handler.setCursor(command);
  handler.processInput(Button.ACTION);
  await sleep(200);
}

/**
 * Open a window the way the game does: FIGHT / BALL / PARTY (from the command menu; PARTY elsewhere opens the party
 * check), STYLE:n / MOVE:n (the fight menu, then move n chosen, which opens its item or style choice), MENU, and
 * what the menu opens (EGG_LIST, EGG_GACHA, POKEDEX, BATTLE_LOG, MARK_DEX, ACHIEVEMENTS, GAME_STATS, SETTINGS_GENERAL).
 */
export async function openMenu(name: string, arg?: number | string): Promise<string> {
  const ui = globalScene.ui;
  let [key, inner] = String(name).trim().toUpperCase().split(":");
  if (arg != null && inner == null) {
    inner = String(arg);
  }
  switch (key) {
    case "FIGHT":
      await fromCommand(Command.FIGHT);
      if (inner != null) {
        (ui.getHandler() as any).setCursor(Number(inner));
      }
      break;
    case "STYLE":
    case "MOVE": {
      if (ui.mode !== UiMode.FIGHT) {
        await fromCommand(Command.FIGHT);
      }
      const fight: any = ui.getHandler();
      fight.setCursor(Number(inner ?? 0));
      fight.processInput(Button.ACTION);
      await sleep(200);
      break;
    }
    case "BALL":
      await fromCommand(Command.BALL);
      break;
    case "PARTY":
    case "POKEMON":
      if (ui.mode === UiMode.COMMAND) {
        await fromCommand(Command.POKEMON);
      } else {
        await ui.setOverlayMode(UiMode.PARTY, PartyUiMode.CHECK, -1, () => ui.revertMode());
      }
      break;
    case "MENU":
      if (ui.mode !== UiMode.MENU) {
        await ui.setOverlayMode(UiMode.MENU);
      }
      break;
    default: {
      const mode = (UiMode as Record<string, string | number>)[key];
      if (typeof mode !== "number") {
        throw new Error(`unknown window ${name}`);
      }
      if (mode === UiMode.EGG_LIST && globalScene.gameData.eggs.length === 0) {
        throw new Error("no eggs: addEggs(n) first");
      }
      if (OVER_MENU.has(mode) || INSTEAD_OF_MENU.has(mode)) {
        if (ui.mode !== UiMode.MENU) {
          await ui.setOverlayMode(UiMode.MENU);
          await sleep(100);
        }
        if (INSTEAD_OF_MENU.has(mode)) {
          await ui.revertMode();
        }
      }
      await ui.setOverlayMode(mode as UiMode);
    }
  }
  await sleep(250);
  return `${key}${inner == null ? "" : `:${inner}`} -> ${modeName()}`;
}

// #endregion windows

// #region settings

const HP_BAR_SPEEDS: Record<string, number> = { default: 0, fast: 1, faster: 2, skip: 3 };

function namedNumber(value: unknown, names: Record<string, number>, what: string): number {
  if (typeof value === "number") {
    return value;
  }
  const n = names[String(value).toLowerCase()];
  if (n == null) {
    throw new Error(`unknown ${what} "${String(value)}" (${Object.keys(names).join(", ")})`);
  }
  return n;
}

/** The saved settings that matter for checks, in one line */
export function settingsLine(): string {
  const g = settings.general;
  const d = settings.display;
  return [
    `speed ${g.gameSpeed}${g.gameSpeed === 3 ? " (normal)" : ""}`,
    `hpBar ${nameOf(HpBarSpeed, g.hpBarSpeed)}`,
    `exp ${nameOf(ExpGainsSpeed as any, g.expGainsSpeed)}`,
    `anims ${d.enableMoveAnimations ? "on" : "off"}`,
    `tutorials ${g.enableTutorials ? "on" : "off"}`,
    `moveStyle ${g.moveStyleChoice ? "on" : "off"}`,
    `battleStyle ${nameOf(BattleStyle as any, g.battleStyle)}`,
  ].join(" · ");
}

/**
 * Read or change the saved settings through the settings manager (saved like the settings screen does):
 * `settings()` reads; `settings("normal")` = speed 3, bars and EXP at default speed, animations on;
 * `settings({speed: "turbo", anims: false, tutorials: false, hpBar: "skip", expSpeed: "skip", moveStyle: true,
 * battleStyle: "set", typeHintsMode: 1})` (any other saved key by name).
 * @param skipTutorials - Marks every tutorial as seen when `tutorials: false`
 */
export function applySettings(patch?: SettingsPatch | "normal" | null, skipTutorials?: () => unknown): string {
  if (patch == null) {
    return settingsLine();
  }
  const p: SettingsPatch =
    patch === "normal" ? { speed: "normal", hpBar: "default", expSpeed: "default", anims: true } : patch;
  for (const [key, value] of Object.entries(p)) {
    switch (key) {
      case "speed":
        settings.update("general", "gameSpeed", parseGameSpeed(value));
        break;
      case "anims":
        settings.update("display", "enableMoveAnimations", !!value);
        break;
      case "tutorials":
        settings.update("general", "enableTutorials", !!value);
        if (!value) {
          skipTutorials?.();
        }
        break;
      case "hpBar":
        settings.update("general", "hpBarSpeed", namedNumber(value, HP_BAR_SPEEDS, "hpBar"));
        break;
      case "expSpeed":
        settings.update("general", "expGainsSpeed", namedNumber(value, HP_BAR_SPEEDS, "expSpeed"));
        break;
      case "moveStyle":
        settings.update("general", "moveStyleChoice", !!value);
        break;
      case "battleStyle":
        settings.update("general", "battleStyle", namedNumber(value, { switch: 0, set: 1 }, "battleStyle"));
        break;
      default: {
        const category = (["general", "display", "audio"] as const).find(
          c => (settings as any)[c] && key in (settings as any)[c],
        );
        if (!category) {
          throw new Error(`unknown setting "${key}"`);
        }
        settings.update(category, key as never, value);
      }
    }
  }
  return settingsLine();
}

// #endregion settings
