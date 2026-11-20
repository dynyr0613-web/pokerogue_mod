/*
 * Dev Bridge (local development only): `look()`, what is on screen and in the battle as short plain text, read from
 * the game's own objects (the UI handlers' state, the phase, the Pokémon) rather than from text positions.
 * Local fork (2026-11-21), for Claude driving the game (the user: "당신이 화면 정보를 보다 쉽게 읽고 원하는 세팅을 빠르게
 * 만드는데 사용할 도구"). Every section is read on its own: one that fails becomes a note and the rest still shows.
 */

import {
  clean,
  formatLook,
  formatOptions,
  formatStages,
  type LookPokemon,
  type LookView,
  type LookWindow,
  nameOf,
} from "#app/dev-bridge/bridge-pure";
import { globalScene } from "#app/global-scene";
import { settings } from "#app/global-settings-manager";
import { getPokeballName } from "#data/pokeball";
import { getStatusEffectDescriptor } from "#data/status-effect";
import { getTerrainName, TerrainType } from "#data/terrain";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveCategory } from "#enums/move-category";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PartyUiMode } from "#enums/party-ui-mode";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { TimeOfDay } from "#enums/time-of-day";
import { UiMode } from "#enums/ui-mode";
import { WeatherType } from "#enums/weather-type";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";
import { getHeldItemKey } from "#moves/held-item-moves";
import { getEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import { getEggListPageCount } from "#ui/egg-list-ui-handler";
import { getBiomeName } from "#utils/common";
import { getPokemonTypeLocaleKey } from "#utils/i18n";
import i18next from "i18next";

// #region messages

interface LoggedMessage {
  readonly seq: number;
  /** `performance.now()` when it was shown */
  readonly t: number;
  readonly text: string;
}

const MESSAGE_RING = 300;
const messageRing: LoggedMessage[] = [];
let messageSeq = 0;
/** The last message `look()` reported */
let lookCursor = 0;

/** Called by the bridge's message hook for every message the game shows */
export function recordMessage(text: string): void {
  messageRing.push({ seq: ++messageSeq, t: performance.now(), text: clean(text) });
  if (messageRing.length > MESSAGE_RING) {
    messageRing.shift();
  }
}

/** The number of the last message shown */
export function lastMessageSeq(): number {
  return messageSeq;
}

/** The messages shown after message number `seq` (with their times) */
export function messagesSince(seq: number): LoggedMessage[] {
  return messageRing.filter(m => m.seq > seq);
}

/** The last message shown, in full (the message box may still be typing it) */
export function lastMessageText(): string {
  return messageRing.at(-1)?.text ?? "";
}

/** Mark every message so far as reported (the bridge's `keys` prints them itself) */
export function markMessagesSeen(): void {
  lookCursor = messageSeq;
}

// #endregion messages

// #region names

const TIME_OF_DAY_KO: Record<string, string> = { DAWN: "새벽", DAY: "낮", DUSK: "해질녘", NIGHT: "밤" };
const TIER_KO: Record<string, string> = {
  COMMON: "일반",
  GREAT: "슈퍼",
  ULTRA: "하이퍼",
  ROGUE: "로그",
  MASTER: "마스터",
  LUXURY: "럭셔리",
};
const CATEGORY_KO: Record<string, string> = { PHYSICAL: "물리", SPECIAL: "특수", STATUS: "변화" };
const SIDE_KO: Record<number, string> = {
  [ArenaTagSide.BOTH]: "양쪽",
  [ArenaTagSide.PLAYER]: "아군",
  [ArenaTagSide.ENEMY]: "적",
};

function typeName(type: PokemonType): string {
  const key = PokemonType[type] ?? String(type);
  const ko = i18next.t(getPokemonTypeLocaleKey(type));
  return ko && !ko.includes(".") ? `${ko}[${key}]` : key;
}

function modeName(): string {
  return globalScene?.ui ? (UiMode[globalScene.ui.mode] ?? String(globalScene.ui.mode)) : "-";
}

function phaseName(): string {
  return globalScene?.phaseManager?.getCurrentPhase()?.phaseName ?? "-";
}

/** The visible texts under a game object, in display order, cleaned and without repeats */
export function visibleTexts(root: any, max = 60): string[] {
  const out: { x: number; y: number; text: string }[] = [];
  const walk = (obj: any, parentVisible: boolean) => {
    if (!obj) {
      return;
    }
    const visible = parentVisible && obj.visible !== false && (obj.alpha ?? 1) > 0.05;
    if (!visible) {
      return;
    }
    if (typeof obj.text === "string" && obj.text.trim()) {
      const m = typeof obj.getWorldTransformMatrix === "function" ? obj.getWorldTransformMatrix() : null;
      out.push({ x: m ? m.tx : 0, y: m ? m.ty : 0, text: clean(obj.text) });
    }
    if (Array.isArray(obj.list)) {
      for (const child of obj.list) {
        walk(child, visible);
      }
    }
  };
  walk(root, true);
  out.sort((a, b) => Math.round(a.y / 24) - Math.round(b.y / 24) || a.x - b.x);
  const seen = new Set<string>();
  const texts: string[] = [];
  for (const t of out) {
    if (t.text && !seen.has(t.text)) {
      seen.add(t.text);
      texts.push(t.text);
    }
  }
  return texts.slice(0, max);
}

/** The texts of a container's direct children, in the order they were added (visible or not) */
function childTexts(container: any): string[] {
  const list: any[] = Array.isArray(container?.list) ? container.list : [];
  return list.filter(o => typeof o?.text === "string").map(o => clean(o.text));
}

// #endregion names

// #region Pokémon

/** One Pokémon as `look()` shows it; `withMoves` adds its moves with PP */
export function lookPokemon(p: Pokemon, slot: string, withMoves = false): LookPokemon {
  const anyP = p as any;
  const tags: string[] = [];
  if (p.isShiny()) {
    tags.push("이로치");
  }
  if (anyP.isAlpha?.()) {
    tags.push("우두머리");
  }
  if (p.isBoss()) {
    const e = p as EnemyPokemon;
    tags.push(`보스(${e.bossSegmentIndex + 1}/${e.bossSegments}칸)`);
  }
  if (p.isMega()) {
    tags.push("메가");
  }
  if (anyP.isDynamaxed?.()) {
    tags.push("다이맥스");
  }
  if (p.isTerastallized) {
    tags.push(`테라 ${typeName(p.getTeraType())}`);
  }
  if (p.isOnField()) {
    for (const tag of p.summonData?.tags ?? []) {
      const turns = tag.turnCount > 0 && tag.turnCount < 50 ? `(${tag.turnCount})` : "";
      tags.push(`${BattlerTagType[tag.tagType] ?? tag.tagType}${turns}`);
    }
  }
  const items = p.getHeldItems().map(m => {
    const count = m.getStackCount();
    return `${m.type.name}[${getHeldItemKey(m)}]${count > 1 ? `x${count}` : ""}`;
  });
  let status: string | undefined;
  if (p.hp <= 0) {
    status = "기절";
  } else if (p.status?.effect) {
    status = getStatusEffectDescriptor(p.status.effect) || (nameOf(StatusEffect, p.status.effect) ?? undefined);
  }
  const passive = p.getPassiveAbility();
  const stages = p.isOnField() ? formatStages(p.summonData?.statStages) : "";
  return {
    slot,
    name: anyP.getNameToRender?.() ?? p.name,
    key: SpeciesId[p.species.speciesId] ?? String(p.species.speciesId),
    ...(p.getFormKey() ? { form: p.getFormKey() } : {}),
    level: p.level,
    hp: p.hp,
    maxHp: p.getMaxHp(),
    ...(status ? { status } : {}),
    ability: p.getAbility().name,
    ...(passive ? { passive: passive.name, passiveOn: p.hasPassive() } : {}),
    ...(items.length > 0 ? { items } : {}),
    ...(stages ? { stages } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(p.fusionSpecies
      ? { fusion: `${p.fusionSpecies.getName()}[${SpeciesId[p.fusionSpecies.speciesId] ?? p.fusionSpecies.speciesId}]` }
      : {}),
    ...(withMoves
      ? { moves: p.getMoveset().map(m => `${m.getName()} ${m.getMovePp() - m.ppUsed}/${m.getMovePp()}`) }
      : {}),
  };
}

// #endregion Pokémon

// #region header and arena

function battleKind(): string | null {
  const battle = globalScene.currentBattle;
  if (!battle) {
    return null;
  }
  const size = battle.double ? "더블" : "싱글";
  switch (battle.battleType) {
    case BattleType.WILD:
      return `야생 ${size}`;
    case BattleType.TRAINER:
      return `트레이너 ${size}${battle.trainer ? ` ${battle.trainer.getName()}` : ""}`;
    case BattleType.MYSTERY_ENCOUNTER: {
      const type = battle.mysteryEncounter?.encounterType ?? battle.mysteryEncounterType;
      return `이벤트 ${type == null ? "?" : (MysteryEncounterType[type] ?? type)}`;
    }
    default:
      return nameOf(BattleType, battle.battleType);
  }
}

function header(): string[] {
  const out: string[] = [modeName(), phaseName()];
  const battle = globalScene.currentBattle;
  const arena = globalScene.arena;
  if (globalScene.gameMode && battle) {
    out.push(`${nameOf(GameModes, globalScene.gameMode.modeId)} wave ${battle.waveIndex} turn ${battle.turn}`);
  } else {
    out.push("(no run)");
  }
  if (arena && battle) {
    out.push(`${getBiomeName(arena.biomeId)}[${nameOf(BiomeId, arena.biomeId)}]`);
    const tod = TimeOfDay[arena.getTimeOfDay()] ?? "?";
    out.push(`${TIME_OF_DAY_KO[tod] ?? tod}[${tod}]`);
  }
  const kind = battleKind();
  if (kind) {
    out.push(kind);
  }
  if (battle) {
    out.push(`₩${globalScene.money}`);
  }
  // The settings that change what a check sees, only when not the usual ones
  const flags: string[] = [];
  if (settings.general.gameSpeed !== 3) {
    flags.push(`speed ${settings.general.gameSpeed}`);
  }
  if (!settings.display.enableMoveAnimations) {
    flags.push("anims off");
  }
  if (flags.length > 0) {
    out.push(flags.join(" "));
  }
  return out;
}

function arenaLines(): string[] {
  const arena = globalScene.arena;
  if (!arena || !globalScene.currentBattle) {
    return [];
  }
  const out: string[] = [];
  if (arena.weather) {
    const left = arena.weather.turnsLeft > 0 ? `(${arena.weather.turnsLeft})` : "";
    out.push(`날씨 ${WeatherType[arena.weather.weatherType]}${left}`);
  }
  if (arena.terrain && arena.terrain.terrainType !== TerrainType.NONE) {
    const left = arena.terrain.turnsLeft > 0 ? `(${arena.terrain.turnsLeft})` : "";
    out.push(`필드 ${getTerrainName(arena.terrain.terrainType)}[${TerrainType[arena.terrain.terrainType]}]${left}`);
  }
  for (const tag of arena.tags) {
    const turns = tag.turnCount > 0 ? `(${tag.turnCount})` : "";
    out.push(`${ArenaTagType[tag.tagType] ?? tag.tagType}:${SIDE_KO[tag.side] ?? tag.side}${turns}`);
  }
  return out;
}

// #endregion header and arena

// #region windows

/** The text the battle message box shows, or "" when it is hidden or empty */
function messageBoxText(): string {
  const mh: any = globalScene.ui.getMessageHandler();
  if (!mh?.message?.visible) {
    return "";
  }
  return clean(mh.message.text ?? "");
}

function messageWindow(): LookWindow {
  const mh: any = globalScene.ui.getMessageHandler();
  const shown = clean(mh.message?.text ?? "");
  const full = lastMessageText();
  const typing = mh.isTextAnimationInProgress?.() ?? false;
  const text = typing && full.startsWith(shown.slice(0, 8)) ? full : shown;
  let state = "";
  if (mh.awaitingActionInput && mh.onActionInput) {
    state = "(waits for A)";
  } else if (typing) {
    state = "(typing)";
  } else if (mh.pendingPrompt) {
    state = "(prompt soon)";
  }
  return { title: "MESSAGE", lines: [`"${text}" ${state}`.trim()] };
}

function commandWindow(h: any): LookWindow {
  const labels = childTexts(h.commandsContainer);
  if (h.teraButton?.visible) {
    labels.push("테라스탈");
  }
  const lines = formatOptions(labels, h.getCursor());
  const msg = messageBoxText();
  return { title: "COMMAND", lines: msg ? [`msg: ${msg}`, ...lines] : lines };
}

function fightWindow(h: any): LookWindow {
  const phase: any = globalScene.phaseManager.getCurrentPhase();
  const pokemon: Pokemon | undefined = phase?.getPokemon?.();
  const lines: string[] = [];
  if (pokemon) {
    const moveset = pokemon.getMoveset();
    const cursor = h.getCursor();
    moveset.forEach((m, i) => {
      const move = m.getMove();
      const pp = m.getMovePp() - m.ppUsed;
      const selectable = pokemon.isMoveSelectable(m.moveId)[0] && pp > 0;
      const power = move.power >= 0 ? move.power : "-";
      const acc = move.accuracy >= 0 ? move.accuracy : "-";
      lines.push(
        `${i === cursor ? ">" : " "} ${i} ${m.getName()} PP ${pp}/${m.getMovePp()} ${typeName(pokemon.getMoveType(move))} ${CATEGORY_KO[MoveCategory[move.category]] ?? ""} 위력${power} 명중${acc}${selectable ? "" : " (disabled)"}`,
      );
    });
  }
  // What the move info box shows now (a style or item choice changes the type and power there)
  const shown = [
    h.typeIcon?.frame?.name ? `type ${String(h.typeIcon.frame.name).toUpperCase()}` : "",
    h.moveCategoryIcon?.frame?.name ? `cat ${String(h.moveCategoryIcon.frame.name).toUpperCase()}` : "",
    h.ppText?.text ? `PP ${clean(h.ppText.text).replace(/\s+/g, "")}` : "",
    h.powerText?.text ? `위력 ${clean(h.powerText.text)}` : "",
    h.accuracyText?.text ? `명중 ${clean(h.accuracyText.text)}` : "",
  ].filter(Boolean);
  if (shown.length > 0) {
    lines.push(`info: ${shown.join(" · ")}`);
  }
  const desc = h.moveInfoOverlay?.desc?.text;
  if (typeof desc === "string" && desc.trim()) {
    lines.push(`desc: ${clean(desc)}`);
  }
  return { title: "FIGHT", lines };
}

/** What an option window is for, when the bridge can tell */
function optionPurpose(mode: UiMode): string {
  const ui = globalScene.ui;
  const chain = ui.modeChain;
  if (chain.at(-1) === UiMode.FIGHT || chain.includes(UiMode.FIGHT)) {
    const fight: any = ui.handlers[UiMode.FIGHT];
    if (fight?.openChoice === "heldItem") {
      return "held item for the move";
    }
    if (fight?.openChoice === "moveStyle") {
      return "move style";
    }
  }
  const phase = phaseName();
  if (mode === UiMode.CONFIRM && phase === "CheckSwitchPhase") {
    return "switch? yes/no";
  }
  if (chain.length > 0) {
    return `over ${UiMode[chain.at(-1)!]}, ${phase}`;
  }
  return phase;
}

function optionWindow(h: any, mode: UiMode): LookWindow {
  const options: any[] = h.options ?? [];
  const scroll = h.scrollCursor ?? 0;
  const cursor = (h.cursor ?? 0) + scroll;
  const labels = options.map(o => clean(String(o.label ?? "")));
  const disabled = options.map(o => o.selectable === false);
  const lines = formatOptions(labels, cursor, disabled);
  const max = h.config?.maxOptions ?? h.maxOptions;
  if (typeof max === "number" && options.length > max) {
    lines.push(`(rows ${scroll}-${Math.min(options.length, scroll + max) - 1} of ${options.length} show)`);
  }
  const msg = messageBoxText();
  if (msg) {
    lines.unshift(`msg: ${msg}`);
  }
  return { title: `${UiMode[mode]} (${optionPurpose(mode)})`, lines };
}

function ballWindow(h: any): LookWindow {
  const counts: Record<number, number> = globalScene.pokeballCounts as any;
  const types = Object.keys(counts).map(Number);
  const labels = types.map(t => `${getPokeballName(t)} x${counts[t]} 포획 ${h.chanceLabels?.[t] ?? "?"}`);
  labels.push("취소");
  return { title: "BALL", lines: formatOptions(labels, h.cursor ?? 0) };
}

function targetWindow(h: any): LookWindow {
  const targets: BattlerIndex[] = h.targets ?? [];
  const cursor: number = h.cursor ?? -1;
  const highlighted: Pokemon[] = h.targetsHighlighted ?? [];
  const lines = globalScene.getField().map((p, i) => {
    if (!p) {
      return "";
    }
    const on = i === cursor || highlighted.includes(p) ? ">" : " ";
    const can = targets.includes(i) ? "" : " (not a target)";
    return `${on} ${BattlerIndex[i]} ${(p as any).getNameToRender?.() ?? p.name}${can}`;
  });
  return { title: "TARGET_SELECT", lines: lines.filter(Boolean) };
}

/**
 * Review fix (2026-11-21): the party screen's option labels in the order of its options (`optionsCursor` order). The
 * window adds them bottom-up (the last option first) and mixes in the Memory Mushroom's level prefixes, so they are
 * the `[shadow]` texts sorted top to bottom, not the container's order.
 */
export function partyOptionLabels(container: any): string[] {
  const list: any[] = Array.isArray(container?.list) ? container.list : [];
  return list
    .filter(o => typeof o?.text === "string" && o.text.startsWith("[shadow]"))
    .sort((a, b) => (a.y ?? 0) - (b.y ?? 0))
    .map(o => clean(o.text));
}

function partyWindow(h: any): LookWindow {
  const party = globalScene.getPlayerParty();
  const cursor: number = h.cursor ?? 0;
  const lines = party.map((p, i) => {
    const v = lookPokemon(p, `${i}`);
    const items = v.items?.length ? ` · 도구 ${v.items.join(", ")}` : "";
    return `${i === cursor && !h.optionsMode ? ">" : " "} ${i} ${v.name} Lv${v.level} HP ${v.hp}/${v.maxHp}${v.status ? ` ${v.status}` : ""}${items}`;
  });
  if (cursor === 6) {
    lines.push("> 취소");
  }
  if (h.optionsMode) {
    const labels = partyOptionLabels(h.optionsContainer);
    lines.push(`options for ${cursor}:`);
    lines.push(...formatOptions(labels, h.optionsCursor ?? 0));
  }
  const msg = clean(h.message?.text ?? "");
  if (msg) {
    lines.unshift(`msg: ${msg}`);
  }
  return { title: `PARTY (${nameOf(PartyUiMode, h.partyUiMode)})`, lines };
}

function rewardLabel(option: any): string {
  const o = option?.modifierTypeOption;
  if (!o?.type) {
    return "?";
  }
  const tierKey = ModifierTier[o.type.tier] ?? "";
  const tier = TIER_KO[tierKey] ?? tierKey;
  const up = o.upgradeCount ? ` +${o.upgradeCount}` : "";
  const cost = o.cost ? ` ₩${o.cost}` : "";
  return `${o.type.name}[${o.type.id}] ${tier}${up}${cost}`;
}

/**
 * Review fix (2026-11-21): the reward screen's row cursor of shop row `r` (`shopOptionsRows[r]`): the handler reads
 * row cursor n (2 and up) as `shopOptionsRows.at(-(n - 1))`, so the last shop row is row cursor 2
 */
export function shopRowCursor(r: number, shopRowCount: number): number {
  return shopRowCount - r + 1;
}

function modifierSelectWindow(h: any): LookWindow {
  const row: number = h.rowCursor ?? 0;
  const cursor: number = h.cursor ?? 0;
  const lines: string[] = [];
  const rewards: any[] = h.options ?? [];
  lines.push(
    `rewards: ${rewards.map((o, i) => `${row === 1 && cursor === i ? ">" : ""}${i} ${rewardLabel(o)}`).join(" | ")}`,
  );
  const shopRows: any[][] = h.shopOptionsRows ?? [];
  shopRows.forEach((shopRow: any[], r: number) => {
    // Review fix (2026-11-21): the handler reads row cursor n (2 and up) as `shopOptionsRows.at(-(n - 1))`
    const rowCursor = shopRowCursor(r, shopRows.length);
    lines.push(
      `shop ${r}: ${shopRow.map((o, i) => `${row === rowCursor && cursor === i ? ">" : ""}${i} ${rewardLabel(o)}`).join(" | ")}`,
    );
  });
  // Row 0: reroll, transfer items, check team, lock rarities (ModifierSelectUiHandler.setCursor)
  const buttons = ["다시뽑기", "아이템 이동", "팀 확인", "등급 고정"];
  lines.push(
    `buttons: ${buttons.map((b, i) => `${row === 0 && cursor === i ? ">" : ""}${b}`).join(" | ")} · reroll ₩${h.rerollCost ?? "?"}`,
  );
  const msg = messageBoxText();
  if (msg) {
    lines.push(`desc: ${msg}`);
  }
  return { title: `MODIFIER_SELECT (row ${row}, cursor ${cursor})`, lines };
}

/**
 * Review fix (2026-11-21): whether an encounter option cannot be picked. Only the DISABLED_OR_* modes block an option
 * whose requirements are unmet (MysteryEncounterUiHandler.processInput); a DEFAULT_OR_SPECIAL one is then still picked,
 * just without its special outcome.
 */
export function isMeOptionDisabled(option: { optionMode?: unknown } | undefined, meetsRequirements: boolean): boolean {
  if (meetsRequirements) {
    return false;
  }
  return (
    option?.optionMode === MysteryEncounterOptionMode.DISABLED_OR_DEFAULT
    || option?.optionMode === MysteryEncounterOptionMode.DISABLED_OR_SPECIAL
  );
}

function mysteryEncounterWindow(h: any): LookWindow {
  const encounter: any = globalScene.currentBattle?.mysteryEncounter;
  const lines: string[] = [];
  // The same texts the window shows (it builds them from these keys with the same tokens)
  const text = (key: unknown) => (typeof key === "string" ? clean(getEncounterText(key) ?? "") : "");
  const dialogue = encounter?.dialogue?.encounterOptionsDialogue;
  for (const [label, key] of [
    ["title", dialogue?.title],
    ["desc", dialogue?.description],
    ["query", dialogue?.query],
  ] as const) {
    const value = text(key);
    if (value) {
      lines.push(`${label}: ${value}`);
    }
  }
  const options: any[] = h.encounterOptions ?? [];
  const labels = childTexts(h.optionsContainer).map((label, i) => label || (i >= options.length ? "(파티 보기)" : ""));
  const meets: boolean[] = h.optionsMeetsReqs ?? [];
  const disabled = labels.map((_, i) => i < meets.length && isMeOptionDisabled(options[i], meets[i]));
  const cursor: number = h.getCursor?.() ?? h.cursor ?? 0;
  lines.push(...formatOptions(labels, cursor, disabled));
  let tip = visibleTexts(h.tooltipContainer).join(" ");
  const option = options[cursor];
  if (!tip && option?.dialogue) {
    const d = option.dialogue;
    tip = text(!meets[cursor] && d.disabledButtonTooltip ? d.disabledButtonTooltip : d.buttonTooltip);
  }
  if (tip) {
    lines.push(`tooltip: ${tip}`);
  }
  if (h.blockInput) {
    lines.push("(input blocked for a moment after it opens)");
  }
  const type = encounter?.encounterType;
  return { title: `MYSTERY_ENCOUNTER ${type == null ? "" : (MysteryEncounterType[type] ?? type)}`.trim(), lines };
}

function eggListWindow(h: any): LookWindow {
  const total = globalScene.gameData.eggs.length;
  const page: number = h.page ?? 0;
  const lines = [
    `eggs ${total} · page ${page + 1}/${getEggListPageCount(total)} (shows "${clean(h.pageText?.text ?? "")}") · cursor ${h.cursor ?? 0}`,
  ];
  const egg = [h.eggNameText, h.eggDateText, h.eggHatchWavesText, h.eggGachaInfoText]
    .map(t => clean(t?.text ?? ""))
    .filter(Boolean);
  if (egg.length > 0) {
    lines.push(`cursor egg: ${egg.join(" · ")}`);
  }
  return { title: "EGG_LIST", lines };
}

function battleLogWindow(h: any): LookWindow {
  const lines = [`${clean(h.headerText?.text ?? "")} · ${clean(h.positionText?.text ?? "")}`];
  const rows: any[] = h.rowTexts ?? [];
  for (const row of rows) {
    if (row?.visible !== false && row?.text?.trim()) {
      lines.push(`  ${clean(row.text)}`);
    }
  }
  if (h.emptyText?.visible) {
    lines.push(`  ${clean(h.emptyText.text ?? "")}`);
  }
  return { title: "BATTLE_LOG", lines };
}

function genericWindow(h: any, mode: UiMode): LookWindow {
  const name = h?.constructor?.name ?? "?";
  const lines = visibleTexts(globalScene.ui, 40);
  return { title: `${UiMode[mode] ?? mode} (${name}; visible texts)`, lines };
}

/** The window of the current UI mode, read by its own reader */
function mainWindow(h: any, mode: UiMode): LookWindow {
  switch (mode) {
    case UiMode.MESSAGE:
      return messageWindow();
    case UiMode.COMMAND:
      return commandWindow(h);
    case UiMode.FIGHT:
      return fightWindow(h);
    case UiMode.BALL:
      return ballWindow(h);
    case UiMode.TARGET_SELECT:
      return targetWindow(h);
    case UiMode.PARTY:
      return partyWindow(h);
    case UiMode.MODIFIER_SELECT:
      return modifierSelectWindow(h);
    case UiMode.MYSTERY_ENCOUNTER:
      return mysteryEncounterWindow(h);
    case UiMode.EGG_LIST:
      return eggListWindow(h);
    case UiMode.BATTLE_LOG:
      return battleLogWindow(h);
    default:
      if (
        Array.isArray(h?.options)
        && h.options.length > 0
        && h.options.every((o: any) => typeof o?.label === "string")
      ) {
        return optionWindow(h, mode);
      }
      return genericWindow(h, mode);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The open windows. Review fix (2026-11-21): a reader that fails leaves a note and the generic window (handler name
 * and visible texts) in its place, so some window always shows; the extra parts fail on their own.
 */
function activeWindows(notes: string[]): LookWindow[] {
  const ui = globalScene.ui;
  const mode = ui.mode;
  const h: any = ui.getHandler();
  const windows: LookWindow[] = [];
  try {
    windows.push(mainWindow(h, mode));
  } catch (err) {
    notes.push(`window ${UiMode[mode] ?? mode}: ${errorMessage(err)}`);
    windows.push(genericWindow(h, mode));
  }
  try {
    // An option window over the fight menu: the move info box below it shows the style's or item's power
    if (mode !== UiMode.FIGHT && ui.modeChain.at(-1) === UiMode.FIGHT) {
      const fight = fightWindow(ui.handlers[UiMode.FIGHT]);
      windows.push({
        title: "FIGHT (under it)",
        lines: fight.lines.filter(l => l.startsWith("info:") || l.startsWith(">")),
      });
    }
  } catch (err) {
    notes.push(`FIGHT (under it): ${errorMessage(err)}`);
  }
  try {
    const tooltip = ui.getTooltip();
    if (tooltip.visible && (tooltip.title || tooltip.content)) {
      windows.push({ title: "tooltip", lines: [`${clean(tooltip.title)}: ${clean(tooltip.content)}`] });
    }
  } catch (err) {
    notes.push(`tooltip: ${errorMessage(err)}`);
  }
  return windows;
}

// #endregion windows

export interface LookOptions {
  /** Include messages shown since the last look (default true; they are then marked as seen) */
  readonly messages?: boolean;
  /** Each field Pokémon's moves with PP */
  readonly moves?: boolean;
  /** The bench line (default true) */
  readonly bench?: boolean;
}

/** Build the view of `look()`, section by section */
export function buildLookView(options: LookOptions = {}): LookView {
  if (!globalScene?.ui) {
    return { header: ["(not loaded)"], field: [], windows: [] };
  }
  const notes: string[] = [];
  const attempt = <T>(what: string, fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch (err) {
      notes.push(`${what}: ${err instanceof Error ? err.message : String(err)}`);
      return fallback;
    }
  };
  const head = attempt("header", header, [modeName(), phaseName()]);
  const field: LookPokemon[] = [];
  const bench: LookPokemon[] = [];
  if (globalScene.currentBattle) {
    // One Pokémon that cannot be read becomes a note; the others still show
    const add = (list: LookPokemon[], p: Pokemon, slot: string, moves: boolean) =>
      attempt(slot, () => list.push(lookPokemon(p, slot, moves)), 0);
    globalScene.getPlayerField().forEach((p, i) => {
      if (p?.isOnField()) {
        add(field, p, `P${i + 1}`, !!options.moves);
      }
    });
    globalScene.getEnemyField().forEach((p, i) => {
      if (p?.isOnField()) {
        add(field, p, `E${i + 1}`, !!options.moves);
      }
    });
    if (options.bench !== false) {
      globalScene.getPlayerParty().forEach((p, i) => {
        if (!p.isOnField()) {
          add(bench, p, `#${i}`, false);
        }
      });
    }
  }
  const arena = attempt("arena", arenaLines, []);
  const windows = attempt("window", () => activeWindows(notes), []);
  // Without the messages they still count as seen (the CLI's `keys` has printed them from the log)
  const messages = options.messages === false ? [] : messagesSince(lookCursor).map(m => m.text);
  lookCursor = messageSeq;
  return {
    header: head,
    field,
    ...(bench.length > 0 ? { bench } : {}),
    ...(arena.length > 0 ? { arena } : {}),
    windows,
    ...(messages.length > 0 ? { messages } : {}),
    ...(notes.length > 0 ? { notes } : {}),
  };
}

/** What is on screen and in the battle, as short text (see the file comment) */
export function look(options: LookOptions = {}): string {
  return formatLook(buildLookView(options));
}
