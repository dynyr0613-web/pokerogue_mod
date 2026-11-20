// Local fork (2026-11-21): the Dev Bridge tools for Claude driving the game (the user: "당신이 화면 정보를 보다 쉽게 읽고
// 원하는 세팅을 빠르게 만드는데 사용할 도구"; docs/브리지_도구_20261121.md). The pure parts (spec and argument parsing,
// crop and contact-sheet geometry, pixel comparison, look's text layout, the presets file), then look() and the setup
// helpers on real battles of the test GameManager.

import {
  buildLookView,
  isMeOptionDisabled,
  look,
  partyOptionLabels,
  recordMessage,
  shopRowCursor,
} from "#app/dev-bridge/bridge-look";
import {
  CROP_REGIONS,
  changedPercent,
  clean,
  cropToCanvas,
  enumValue,
  formatLook,
  formatOptions,
  formatPokemonLine,
  formatStages,
  type LookView,
  layoutSheet,
  normalizeBurstOptions,
  normalizeScenarioSpec,
  parseGameSpeed,
  parseHpValue,
  parseItemSpec,
  parseTarget,
  parseUntil,
  resolveCrop,
  resolvePreset,
  scenarioOverrides,
} from "#app/dev-bridge/bridge-pure";
import { resolveFormIndex, resolveMove, resolveSpecies } from "#app/dev-bridge/bridge-resolve";
import { advanceCore, answerNo, checkScenarioNames, nextAdvanceStep } from "#app/dev-bridge/bridge-scenario";
import {
  addEggs,
  applySettings,
  createHeldItem,
  faint,
  giveItem,
  heal,
  openMenu,
  setHp,
  setLevel,
  setMoves,
  setStatus,
  setTerrain,
  setWeather,
  takeItem,
} from "#app/dev-bridge/bridge-setup";
import { devBridgeApi } from "#app/dev-bridge/dev-bridge";
import { settings } from "#app/global-settings-manager";
import { modifierTypes } from "#data/data-lists";
import { getStatusEffectDescriptor } from "#data/status-effect";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { BattleStyle } from "#enums/battle-style";
import { Button } from "#enums/buttons";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { UiMode } from "#enums/ui-mode";
import { WeatherType } from "#enums/weather-type";
import { getHeldItemKey } from "#moves/held-item-moves";
import { allMysteryEncounters } from "#mystery-encounters/mystery-encounter-biomes";
import { GameManager } from "#test/framework/game-manager";
import type { FightUiHandler } from "#ui/fight-ui-handler";
import type { MessageUiHandler } from "#ui/message-ui-handler";
import type { MysteryEncounterUiHandler } from "#ui/mystery-encounter-ui-handler";
import { PartyOption, type PartyUiHandler } from "#ui/party-ui-handler";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isAllowedBridgeRequest } from "../../../plugins/vite/dev-bridge-plugin";

const PRESETS_PATH = path.resolve(import.meta.dirname, "../../../../Bridge/presets.json");

describe("Dev Bridge tools (2026-11-21): pure parts", () => {
  describe("crops and the contact sheet", () => {
    it("names, rectangles and 'x,y,w,h' resolve and are clamped to the 320x180 screen", () => {
      expect(resolveCrop()).toEqual([0, 0, 320, 180]);
      expect(resolveCrop("field")).toEqual(CROP_REGIONS.field);
      expect(resolveCrop("ENEMY")).toEqual(CROP_REGIONS.enemy);
      expect(resolveCrop([10, 20, 30, 40])).toEqual([10, 20, 30, 40]);
      expect(resolveCrop("10, 20, 30, 40")).toEqual([10, 20, 30, 40]);
      expect(resolveCrop([300, 170, 100, 100])).toEqual([300, 170, 20, 10]);
      expect(resolveCrop([-5, -5, 1000, 1000])).toEqual([0, 0, 320, 180]);
      expect(() => resolveCrop("nowhere")).toThrow(/unknown crop/);
      expect(() => resolveCrop([1, 2, 3])).toThrow();
    });

    it("maps game pixels to the 1920x1080 canvas", () => {
      expect(cropToCanvas([0, 132, 320, 48], 1920, 1080)).toEqual([0, 792, 1920, 288]);
      expect(cropToCanvas([150, 0, 170, 104], 1920, 1080)).toEqual([900, 0, 1020, 624]);
    });

    it("lays tiles out in rows with a label strip under each, as many columns as fit by default", () => {
      const layout = layoutSheet(40, 320, 132);
      expect(layout.columns).toBe(5);
      expect(layout.rows).toBe(8);
      expect(layout.width).toBe(5 * 322 - 2);
      expect(layout.height).toBe(8 * (132 + layout.labelHeight + 2) - 2);
      expect(layout.cells[0]).toEqual({ x: 0, y: 0, labelY: 132 });
      expect(layout.cells[6]).toEqual({
        x: 322,
        y: 132 + layout.labelHeight + 2,
        labelY: 2 * 132 + layout.labelHeight + 2,
      });
      expect(layoutSheet(3, 320, 132).columns).toBe(3);
      expect(layoutSheet(10, 340, 208, 2)).toMatchObject({ columns: 2, rows: 5 });
      expect(layoutSheet(0, 100, 100)).toMatchObject({ columns: 1, rows: 1, cells: [] });
    });

    it("counts changed pixels past a tolerance", () => {
      const a = new Uint8ClampedArray([0, 0, 0, 255, 10, 10, 10, 255, 200, 0, 0, 255, 0, 0, 0, 255]);
      const b = new Uint8ClampedArray([0, 0, 0, 255, 20, 10, 10, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
      expect(changedPercent(a, a)).toBe(0);
      expect(changedPercent(a, b)).toBe(25);
      expect(changedPercent(a, b, 5)).toBe(50);
      expect(changedPercent(a, new Uint8ClampedArray(8))).toBe(100);
    });

    it("burst options: defaults, a move starts on its animation, unknown options are refused", () => {
      const plain = normalizeBurstOptions();
      expect(plain).toMatchObject({ count: 30, intervalMs: 100, scale: 1, changedOnly: false, startOn: "now" });
      expect(plain.action).toBeUndefined();
      const move = normalizeBurstOptions({ move: 1, style: "strong", crop: "enemy", changed: true });
      expect(move.action).toEqual({ move: 1, style: "strong" });
      expect(move.startOn).toBe("anim");
      expect(move.cropName).toBe("enemy");
      expect(move.scale).toBe(2); // a small crop is drawn twice as large
      expect(move.changedOnly).toBe(true);
      expect(normalizeBurstOptions({ action: "doSomething()" }).action).toEqual({ js: "doSomething()" });
      expect(normalizeBurstOptions({ count: 9999, intervalMs: 1 })).toMatchObject({ count: 150, intervalMs: 16 });
      expect(normalizeBurstOptions({ move: 0, startOn: "now" }).startOn).toBe("now");
      expect(() => normalizeBurstOptions({ cout: 3 })).toThrow(/unknown burst option "cout"/);
      expect(() => normalizeBurstOptions({ startOn: "later" })).toThrow();
    });
  });

  describe("arguments", () => {
    it("targets", () => {
      expect(parseTarget("player")).toEqual({ side: "player", index: 0, party: false });
      expect(parseTarget("player2")).toEqual({ side: "player", index: 1, party: false });
      expect(parseTarget("enemy")).toEqual({ side: "enemy", index: 0, party: false });
      expect(parseTarget("enemy2")).toEqual({ side: "enemy", index: 1, party: false });
      expect(parseTarget(3)).toEqual({ side: "player", index: 3, party: true });
      expect(parseTarget("2")).toEqual({ side: "player", index: 2, party: true });
      expect(parseTarget("enemy:1")).toEqual({ side: "enemy", index: 1, party: true });
      expect(() => parseTarget("someone")).toThrow(/unknown target/);
    });

    it("HP values", () => {
      expect(parseHpValue(120, 300)).toBe(120);
      expect(parseHpValue("1", 300)).toBe(1);
      expect(parseHpValue("full", 300)).toBe(300);
      expect(parseHpValue("50%", 301)).toBe(151);
      expect(parseHpValue("0.1%", 300)).toBe(1); // above 0% is at least 1 HP
      expect(parseHpValue("0%", 300)).toBe(0);
      expect(parseHpValue(999, 300)).toBe(300);
      expect(() => parseHpValue("half", 300)).toThrow();
    });

    it("held items in every written form", () => {
      expect(parseItemSpec("LEFTOVERS")).toEqual({ name: "LEFTOVERS", count: 1 });
      expect(parseItemSpec("kings rock")).toEqual({ name: "KINGS_ROCK", count: 1 });
      expect(parseItemSpec("BERRY:LIECHI")).toEqual({ name: "BERRY", type: "LIECHI", count: 1 });
      expect(parseItemSpec("BERRY:LIECHI x3")).toEqual({ name: "BERRY", type: "LIECHI", count: 3 });
      expect(parseItemSpec("BERRY:SITRUS*2")).toEqual({ name: "BERRY", type: "SITRUS", count: 2 });
      expect(parseItemSpec("BERRY(3)")).toEqual({ name: "BERRY", type: 3, count: 1 });
      expect(parseItemSpec({ name: "BERRY", type: "LUM", count: 2 })).toEqual({ name: "BERRY", type: "LUM", count: 2 });
      expect(parseItemSpec({ name: "BERRY:LUM x2" })).toEqual({ name: "BERRY", type: "LUM", count: 2 });
      expect(() => parseItemSpec({ type: "LUM" })).toThrow();
      expect(() => parseItemSpec("")).toThrow();
    });

    it("game speed, 'until' and enum values", () => {
      expect(parseGameSpeed("normal")).toBe(3);
      expect(parseGameSpeed("turbo")).toBe(5);
      expect(parseGameSpeed("4x")).toBe(4);
      expect(parseGameSpeed(2)).toBe(2);
      expect(() => parseGameSpeed("ludicrous")).toThrow();
      expect(parseUntil(undefined)).toEqual({ kind: "input", value: "input" });
      expect(parseUntil("command")).toEqual({ kind: "mode", value: "COMMAND" });
      expect(parseUntil("mode:modifier-select")).toEqual({ kind: "mode", value: "MODIFIER_SELECT" });
      expect(parseUntil("TurnEndPhase")).toEqual({ kind: "phase", value: "TurnEndPhase" });
      expect(enumValue(StatusEffect, "burn", "status")).toBe(StatusEffect.BURN);
      expect(enumValue(StatusEffect, String(StatusEffect.SLEEP), "status")).toBe(StatusEffect.SLEEP);
      expect(() => enumValue(StatusEffect, 999, "status")).toThrow();
      expect(clean("[color=#fff]A[/color]$B @s{se/x}\nC")).toBe("A / B C");
    });
  });

  describe("review fixes (2026-11-21)", () => {
    it("game speed takes only the saved values 2-5; a burst threshold must be a percentage", () => {
      expect(() => parseGameSpeed(1)).toThrow(/unknown game speed/);
      expect(() => parseGameSpeed("2.5")).toThrow(/unknown game speed/);
      expect(() => parseGameSpeed("")).toThrow(/unknown game speed/);
      expect(parseGameSpeed("5")).toBe(5);
      expect(normalizeBurstOptions({ changed: true, threshold: "3" }).threshold).toBe(3);
      expect(() => normalizeBurstOptions({ changed: true, threshold: "lots" })).toThrow(/threshold/);
      expect(() => normalizeBurstOptions({ threshold: 101 })).toThrow(/threshold/);
    });

    it("the reward screen's shop rows map to the row cursors the handler uses (the last shop row is row 2)", () => {
      // ModifierSelectUiHandler.setCursor: row cursor n (2 and up) shows shopOptionsRows.at(-(n - 1))
      const rows = ["upper", "lower"];
      for (let r = 0; r < rows.length; r++) {
        expect(rows.at(-(shopRowCursor(r, rows.length) - 1))).toBe(rows[r]);
      }
      expect(shopRowCursor(0, 1)).toBe(2);
      expect(shopRowCursor(0, 2)).toBe(3);
      expect(shopRowCursor(1, 2)).toBe(2);
    });

    it("an encounter option with unmet requirements is disabled only in a DISABLED_OR_* mode", () => {
      const mode = (optionMode: MysteryEncounterOptionMode) => ({ optionMode });
      expect(isMeOptionDisabled(mode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT), false)).toBe(true);
      expect(isMeOptionDisabled(mode(MysteryEncounterOptionMode.DISABLED_OR_SPECIAL), false)).toBe(true);
      expect(isMeOptionDisabled(mode(MysteryEncounterOptionMode.DEFAULT_OR_SPECIAL), false)).toBe(false);
      expect(isMeOptionDisabled(mode(MysteryEncounterOptionMode.DEFAULT), false)).toBe(false);
      expect(isMeOptionDisabled(mode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT), true)).toBe(false);
      expect(isMeOptionDisabled(undefined, false)).toBe(false);
    });

    it("party option labels come top to bottom, without the Memory Mushroom's level prefixes", () => {
      // The window adds its options bottom-up (the last option first) and the level prefixes as plain texts
      const container = {
        list: [
          { type: "NineSlice" },
          { text: "[shadow]Cancel[/shadow]", y: -22 },
          { text: "12", y: -30 },
          { text: "[shadow]Tackle[/shadow]", y: -38 },
          { text: "[shadow][color=#f00]Ember[/color][/shadow]", y: -54 },
        ],
      };
      expect(partyOptionLabels(container)).toEqual(["Ember", "Tackle", "Cancel"]);
      expect(partyOptionLabels(null)).toEqual([]);
    });

    it("the plugin answers the game's own page and bridge.sh, not other sites or rebinding host names", () => {
      // bridge.py: no Origin, no Sec-Fetch-Site
      expect(isAllowedBridgeRequest({ host: "localhost:8000" })).toBe(true);
      expect(isAllowedBridgeRequest({ host: "127.0.0.1:8000" })).toBe(true);
      expect(isAllowedBridgeRequest({ host: "[::1]:8000" })).toBe(true);
      // The game page: same origin
      expect(
        isAllowedBridgeRequest({
          host: "localhost:8000",
          origin: "http://localhost:8000",
          "sec-fetch-site": "same-origin",
        }),
      ).toBe(true);
      // Another site's page in the same browser (a "simple" POST needs no CORS permission)
      expect(
        isAllowedBridgeRequest({
          host: "localhost:8000",
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        }),
      ).toBe(false);
      expect(isAllowedBridgeRequest({ host: "localhost:8000", "sec-fetch-site": "cross-site" })).toBe(false);
      // A page on another local port (a preview proxy) is still this machine; an opaque origin is not
      expect(
        isAllowedBridgeRequest({
          host: "localhost:8000",
          origin: "http://127.0.0.1:3000",
          "sec-fetch-site": "same-site",
        }),
      ).toBe(true);
      expect(isAllowedBridgeRequest({ host: "localhost:8000", origin: "null" })).toBe(false);
      // DNS rebinding: the browser reaches 127.0.0.1 under the attacker's host name
      expect(isAllowedBridgeRequest({ host: "evil.example:8000", origin: "http://evil.example:8000" })).toBe(false);
      expect(isAllowedBridgeRequest({})).toBe(false);
    });
  });

  describe("scenario specs", () => {
    it("fills in, keeps names as names and refuses typos", () => {
      const spec = normalizeScenarioSpec({
        starters: ["CHARIZARD:mega-x", { species: "CHANDELURE", moves: "FLAMETHROWER", items: "BERRY:SITRUS x2" }],
        enemy: "BLISSEY",
        time: "day",
      });
      expect(spec.mode).toBe("CLASSIC");
      expect(spec.starters[0]).toEqual({ species: "CHARIZARD", form: "mega-x" });
      expect(spec.starters[1]).toEqual({
        species: "CHANDELURE",
        moves: ["FLAMETHROWER"],
        items: [{ name: "BERRY", type: "SITRUS", count: 2 }],
      });
      expect(spec.enemy).toEqual({ species: "BLISSEY" });
      expect(spec.timeOfDay).toBe("DAY");
      expect(normalizeScenarioSpec({ starters: ["X:2"] }).starters[0].form).toBe(2);
      expect(() => normalizeScenarioSpec({ starters: [] })).toThrow(/needs starters/);
      expect(() => normalizeScenarioSpec({ starters: ["A"], stater: 1 })).toThrow(/unknown scenario key "stater"/);
      expect(() => normalizeScenarioSpec({ starters: [{ species: "A", moves: ["1", "2", "3", "4", "5"] }] })).toThrow();
      expect(() => normalizeScenarioSpec({ starters: [{ species: "A", lvl: 3 }] })).toThrow(/unknown starter 0 key/);
      expect(() => normalizeScenarioSpec({ starters: ["A"], timeOfDay: "noon" })).toThrow();
      expect(() => normalizeScenarioSpec({ starters: ["A"], battleType: "raid" })).toThrow();
      expect(() => normalizeScenarioSpec({ starters: ["A"], eggs: 1000 })).toThrow();
    });

    it("turns into overrides: one Pokémon a side unless asked, boss bars, raw overrides last", () => {
      const overrides = scenarioOverrides(
        normalizeScenarioSpec({
          starters: ["PIKACHU"],
          level: 100,
          wave: 12,
          biome: "FACTORY",
          timeOfDay: "NIGHT",
          battleType: "trainer",
          enemy: { species: "BLISSEY", level: 50, moves: ["SPLASH"], boss: true, ability: "BALL_FETCH" },
          overrides: { STARTING_LEVEL_OVERRIDE: 7 },
        }),
      );
      expect(overrides).toEqual({
        STARTING_WAVE_OVERRIDE: 12,
        STARTING_BIOME_OVERRIDE: "FACTORY",
        TIME_OF_DAY_OVERRIDE: "NIGHT",
        STARTING_LEVEL_OVERRIDE: 7,
        FIELD_SIZE_OVERRIDE: "single",
        BATTLE_TYPE_OVERRIDE: "TRAINER",
        ENEMY_SPECIES_OVERRIDE: "BLISSEY",
        ENEMY_LEVEL_OVERRIDE: 50,
        ENEMY_MOVESET_OVERRIDE: ["SPLASH"],
        ENEMY_ABILITY_OVERRIDE: "BALL_FETCH",
        ENEMY_HEALTH_SEGMENTS_OVERRIDE: 2,
      });
      const doubles = scenarioOverrides(normalizeScenarioSpec({ starters: ["A"], battleType: "wild double" }));
      expect(doubles).toMatchObject({ FIELD_SIZE_OVERRIDE: "double", BATTLE_TYPE_OVERRIDE: "WILD" });
      const noBoss = scenarioOverrides(normalizeScenarioSpec({ starters: ["A"], enemy: { boss: false } }));
      expect(noBoss.ENEMY_HEALTH_SEGMENTS_OVERRIDE).toBe(1);
      expect(scenarioOverrides(normalizeScenarioSpec({ starters: ["A"], enemy: { boss: 4 } }))).toMatchObject({
        ENEMY_HEALTH_SEGMENTS_OVERRIDE: 4,
      });
    });

    it("presets: a base preset is merged one level deep, loops are refused", () => {
      const presets = {
        a: { desc: "a", starters: ["X"], enemy: { species: "Y", level: 5 }, settings: { speed: "normal" } },
        b: { base: "a", desc: "b", enemy: { level: 9 }, settings: { anims: true } },
        c: { base: "d" },
        d: { base: "c" },
      };
      expect(resolvePreset(presets, "b")).toEqual({
        starters: ["X"],
        enemy: { species: "Y", level: 9 },
        settings: { speed: "normal", anims: true },
      });
      expect(() => resolvePreset(presets, "c")).toThrow(/loop/);
      expect(() => resolvePreset(presets, "zz")).toThrow(/no preset/);
    });
  });

  describe("look's text", () => {
    it("one line per Pokémon and per option, sections only when there is something", () => {
      const view: LookView = {
        header: ["COMMAND", "CommandPhase", "CLASSIC wave 1 turn 1"],
        field: [
          {
            slot: "P1",
            name: "리자몽",
            key: "CHARIZARD",
            form: "mega-x",
            level: 100,
            hp: 150,
            maxHp: 300,
            status: "화상",
            ability: "맹화",
            passive: "선파워",
            passiveOn: true,
            items: ["목탄[CHARCOAL]x2"],
            stages: "공격+2",
            tags: ["메가"],
          },
        ],
        bench: [{ slot: "#1", name: "샹델라", key: "CHANDELURE", level: 100, hp: 0, maxHp: 260, status: "기절" }],
        arena: ["날씨 SUNNY(3)"],
        windows: [{ title: "COMMAND", lines: formatOptions(["싸운다", "볼"], 1, [false, true]) }],
        messages: ["야생 해피너스가 나타났다!"],
      };
      expect(formatLook(view).split("\n")).toEqual([
        "COMMAND · CommandPhase · CLASSIC wave 1 turn 1",
        "P1 리자몽[CHARIZARD mega-x] Lv100 HP 150/300 (50%) 화상 · 특성 맹화 · 패시브 선파워(on) · 도구 목탄[CHARCOAL]x2 · 랭크 공격+2 · 메가",
        "bench: #1 샹델라 Lv100 0/260 기절",
        "field: 날씨 SUNNY(3)",
        "== COMMAND ==",
        "  0 싸운다",
        "> 1 볼 (disabled)",
        "== messages ==",
        "야생 해피너스가 나타났다!",
      ]);
      expect(formatLook({ header: ["TITLE", "TitlePhase", "(no run)"], field: [], windows: [] })).toBe(
        "TITLE · TitlePhase · (no run)",
      );
      expect(formatPokemonLine({ slot: "E1", name: "꼬렛", key: "RATTATA", level: 2, hp: 1, maxHp: 12 }, true)).toBe(
        "E1 꼬렛[RATTATA] Lv2 HP 1/12 (8.3%)",
      );
      expect(formatStages([2, 0, 0, 0, -1, 0, 0])).toBe("공격+2 스피드-1");
      expect(formatStages([0, 0, 0, 0, 0, 0, 0])).toBe("");
    });
  });

  describe("the presets file (Bridge/presets.json)", () => {
    const presets: Record<string, unknown> | null = existsSync(PRESETS_PATH)
      ? JSON.parse(readFileSync(PRESETS_PATH, "utf8"))
      : null;

    it.runIf(presets != null)("has today's checks, and every preset is a valid spec whose names the game knows", () => {
      const ids = Object.keys(presets!).filter(k => !k.startsWith("_"));
      expect(ids).toEqual(
        expect.arrayContaining(["flame", "flame-z", "jirachi", "itemmoves", "ball", "style", "egglist", "battlelog"]),
      );
      for (const id of ids) {
        const spec = normalizeScenarioSpec(resolvePreset(presets!, id));
        for (const s of spec.starters) {
          const speciesId = resolveSpecies(s.species);
          expect(() => resolveFormIndex(speciesId, s.form), `${id} ${s.species} ${s.form}`).not.toThrow();
          for (const m of s.moves ?? []) {
            expect(() => resolveMove(m), `${id} ${m}`).not.toThrow();
          }
          for (const item of s.items ?? []) {
            expect(typeof (modifierTypes as any)[item.name], `${id} ${item.name}`).toBe("function");
          }
        }
        if (spec.enemy?.species != null) {
          resolveSpecies(spec.enemy.species);
        }
        for (const item of spec.enemy?.items ?? []) {
          expect(typeof (modifierTypes as any)[item.name], `${id} enemy ${item.name}`).toBe("function");
        }
        if (spec.encounter != null) {
          expect(allMysteryEncounters[enumValue(MysteryEncounterType, spec.encounter, "encounter")]).toBeDefined();
        }
      }
      const flameZ = normalizeScenarioSpec(resolvePreset(presets!, "flame-z"));
      expect(flameZ.starters).toEqual([{ species: "CHARIZARD", form: "mega-z", moves: ["FLAMETHROWER"] }]);
      expect(flameZ.enemy).toMatchObject({ species: "BLISSEY", level: 100, moves: ["SPLASH"] });
      expect(resolveFormIndex(SpeciesId.CHARIZARD, "mega-z")).toBeGreaterThan(0);
      expect(() => resolveFormIndex(SpeciesId.CHARIZARD, "mega-q")).toThrow(/forms:/);
    });
  });
});

describe("Dev Bridge tools (2026-11-21): on real battles", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .startingLevel(60)
      .enemySpecies(SpeciesId.BLISSEY)
      .enemyLevel(60)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TRICK, MoveId.EARTHQUAKE, MoveId.FLING, MoveId.SPLASH])
      .startingHeldItems([
        { name: "FLAME_ORB", count: 1 },
        { name: "BERRY", type: 3, count: 3 },
      ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("look() describes the command menu, both Pokémon with items, and the messages since the last look", async () => {
    await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
    recordMessage("[color=#fff]테스트 메시지[/color]");
    const text = look();
    const lines = text.split("\n");
    expect(lines[0]).toMatch(
      /^COMMAND · CommandPhase · CLASSIC wave \d+ turn 1 · .+\[[A-Z_]+\] · .+ · 야생 싱글 · ₩\d+/,
    );
    expect(text).toMatch(
      /P1 .+\[ALAKAZAM\] Lv60 HP (\d+)\/\1 \(100%\) · 특성 .+ · 도구 .+\[FLAME_ORB\], .+\[BERRY:LIECHI\]x3/,
    );
    expect(text).toMatch(/E1 .+\[BLISSEY\] Lv60 HP \d+\/\d+/);
    expect(text).toContain("== COMMAND ==");
    expect(lines.some(l => l.startsWith("> 0 "))).toBe(true);
    expect(text).toContain("== messages ==\n테스트 메시지");
    // Seen once: the next look leaves them out
    expect(look()).not.toContain("== messages ==");
    const view = buildLookView({ moves: true });
    expect(view.field[0].moves?.[0]).toMatch(/ \d+\/\d+$/);
  });

  it("look() reads the fight menu, the move info box, and the held-item choice over it with its purpose", async () => {
    await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
    await game.scene.ui.setMode(UiMode.FIGHT, 0);
    const fight = game.scene.ui.getHandler() as FightUiHandler;
    fight.setCursor(1);
    let text = look();
    expect(text).toContain("== FIGHT ==");
    expect(text).toMatch(/> 1 .+ PP \d+\/\d+ .+\[GROUND\] 물리 위력100 명중100/);
    // The type and category icons' frames are read too in the game (the test's sprites are mocks without frames)
    expect(text).toMatch(/info: (type GROUND · cat PHYSICAL · )?PP 10\/10 · 위력 100 · 명중 100/);
    expect(text).toMatch(/desc: .+/);

    fight.setCursor(0); // Trick asks for the item to give
    fight.processInput(Button.ACTION);
    expect(game.scene.ui.mode).toBe(UiMode.OPTION_SELECT);
    text = look();
    expect(text).toContain("== OPTION_SELECT (held item for the move) ==");
    expect(text).toMatch(/> 0 .+/);
    expect(text).toContain("== FIGHT (under it) ==");
    // Back to the command menu, so that the next test's scene reset finds no open fight menu
    await game.scene.ui.revertMode();
    await game.scene.ui.setMode(UiMode.COMMAND, 0);
  });

  it("look() names the style choice, the ball menu with catch chances, and the party screen", async () => {
    const before = settings.general.moveStyleChoice;
    settings.update("general", "moveStyleChoice", true);
    try {
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM, SpeciesId.PIKACHU);
      await devBridgeApi.openMenu("STYLE:1");
      expect(game.scene.ui.mode).toBe(UiMode.OPTION_SELECT);
      expect(look()).toContain("(move style)");
      await game.scene.ui.revertMode();
      await game.scene.ui.setMode(UiMode.COMMAND, 0);

      expect(await openMenu("BALL")).toBe("BALL -> BALL");
      expect(look()).toMatch(/== BALL ==\n> 0 .+ x\d+ 포획 /);
      await game.scene.ui.setMode(UiMode.COMMAND, 0);

      expect(await openMenu("PARTY")).toBe("PARTY -> PARTY");
      const party = look();
      expect(party).toContain("== PARTY (SWITCH) ==");
      expect(party).toMatch(/1 .+ Lv60 HP \d+\/\d+/);
      await game.scene.ui.setMode(UiMode.COMMAND, 0);
    } finally {
      settings.update("general", "moveStyleChoice", before);
    }
  });

  it("review fix: look() marks the party option under the cursor (the window adds them bottom-up)", async () => {
    await game.classicMode.startBattle(SpeciesId.ALAKAZAM, SpeciesId.PIKACHU);
    await openMenu("PARTY");
    const party = game.scene.ui.getHandler<PartyUiHandler>();
    party.setCursor(1);
    party.processInput(Button.ACTION);
    expect((party as any).optionsMode).toBe(true);
    const options: PartyOption[] = (party as any).options;
    expect(options[0]).toBe(PartyOption.SEND_OUT);
    expect(options.at(-1)).toBe(PartyOption.CANCEL);
    const lines = look().split("\n");
    const start = lines.indexOf("options for 1:");
    expect(start).toBeGreaterThan(0);
    // One line per option, the cursor on the first (the test's text mocks drop the labels themselves; their order is
    // checked by "party option labels come top to bottom" above)
    const optionLines = lines.slice(start + 1).filter(l => /^[> ] \d+ /.test(l) || /^[> ] \d+$/.test(l));
    expect(optionLines).toHaveLength(options.length);
    expect(optionLines[0]).toMatch(/^> 0\b/);
    expect(optionLines.at(-1)).toMatch(new RegExp(`^ {2}${options.length - 1}\\b`));
    party.processInput(Button.CANCEL);
    party.processInput(Button.CANCEL);
    await game.scene.ui.setMode(UiMode.COMMAND, 0);
  });

  it("review fix: a window reader that fails leaves a note and the generic window, never no window", async () => {
    await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
    await game.scene.ui.setMode(UiMode.FIGHT, 0);
    const phase: any = game.scene.phaseManager.getCurrentPhase();
    vi.spyOn(phase, "getPokemon").mockImplementation(() => {
      throw new Error("reader boom");
    });
    const text = look();
    expect(text).toMatch(/== FIGHT \(FightUiHandler; visible texts\) ==/);
    expect(text).toContain("(note: window FIGHT: reader boom)");
    // The field section reads the field, not the phase: it still shows
    expect(text).toMatch(/P1 .+\[ALAKAZAM\]/);
    vi.restoreAllMocks();
    await game.scene.ui.setMode(UiMode.COMMAND, 0);
  });

  it("review fix: scenario checks every name before it would reload (moves, natures, items, encounter, overrides)", async () => {
    const base = {
      starters: [{ species: "ALAKAZAM", moves: ["TRICK"], items: ["BERRY:LIECHI x3", "FLAME_ORB"], nature: "TIMID" }],
      enemy: { species: "BLISSEY", moves: ["SPLASH"], items: ["LEFTOVERS"], ability: "NATURAL_CURE" },
      biome: "FACTORY",
      encounter: "WISH_ON_A_STAR",
      timeOfDay: "DAY",
    };
    const check = (patch: Record<string, unknown>) => () =>
      checkScenarioNames(normalizeScenarioSpec({ ...base, ...patch }));
    expect(check({})).not.toThrow();
    const starter = (extra: Record<string, unknown>) => ({ starters: [{ ...base.starters[0], ...extra }] });
    expect(check(starter({ moves: ["TRIK"] }))).toThrow(/unknown move: TRIK/);
    expect(check(starter({ nature: "TIMIDD" }))).toThrow(/unknown nature/);
    expect(check(starter({ items: ["LEFTOVER"] }))).toThrow(/unknown item "LEFTOVER"/);
    expect(check(starter({ items: ["BERRY:LIECH"] }))).toThrow(/BERRY type/);
    expect(check({ enemy: { ...base.enemy, moves: ["SPLAS"] } })).toThrow(/unknown move: SPLAS/);
    expect(check({ enemy: { ...base.enemy, ability: "NATURAL_CUR" } })).toThrow(/ENEMY_ABILITY_OVERRIDE/);
    expect(check({ biome: "FACTORYY" })).toThrow(/STARTING_BIOME_OVERRIDE/);
    expect(check({ encounter: "WISH_ON_A_STA" })).toThrow(/mystery encounter/);
    expect(check({ overrides: { NOT_AN_OVERRIDE: 1 } })).toThrow(/unknown override: NOT_AN_OVERRIDE/);
    // So scenario() refuses a typo before it stores a spec or reloads the page
    const store = vi.spyOn(Storage.prototype, "setItem");
    await expect(devBridgeApi.scenario({ ...base, ...starter({ moves: ["TRIK"] }) })).rejects.toThrow(/unknown move/);
    expect(store).not.toHaveBeenCalled();
  });

  it("a Mega form starter (as scenario's form key gives it) is still in that form at the command menu", async () => {
    const megaX = resolveFormIndex(SpeciesId.CHARIZARD, "mega-x");
    game.override.starterForms({ [SpeciesId.CHARIZARD]: megaX }).moveset([MoveId.FLAMETHROWER]);
    await game.classicMode.startBattle(SpeciesId.CHARIZARD);
    const charizard = game.field.getPlayerPokemon();
    expect(charizard.getFormKey()).toBe("mega-x");
    expect(look()).toMatch(/P1 .+\[CHARIZARD mega-x\] .+메가/);
  });

  it("setup helpers change HP, status, level, moves, items, weather and terrain mid-battle", async () => {
    await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    expect(await setHp("enemy", "1")).toMatch(/^E1 .+ HP 1\//);
    expect(enemy.hp).toBe(1);
    expect(await setHp("player", "50%")).toContain(`HP ${Math.round(player.getMaxHp() / 2)}/`);
    // By the shown name (the test's locale is English) or the enum name
    const burned = getStatusEffectDescriptor(StatusEffect.BURN);
    expect(await setStatus("player", burned)).toContain(burned);
    expect(player.status?.effect).toBe(StatusEffect.BURN);
    await setStatus("player", "paralysis");
    expect(player.status?.effect).toBe(StatusEffect.PARALYSIS);
    await setStatus("player", "none");
    expect(player.status).toBeNull();
    await heal("all");
    expect(enemy.hp).toBe(enemy.getMaxHp());

    expect(await setLevel("player", 75)).toMatch(/Lv75/);
    expect(player.level).toBe(75);
    expect(player.hp).toBe(player.getMaxHp());

    // The moveset override of this test gives way (it would put its moves back on every read)
    expect(await setMoves("player", ["FLAMETHROWER", "SURF"])).toBe(
      "P1 Alakazam moves FLAMETHROWER, SURF (MOVESET_OVERRIDE cleared)",
    );
    expect(player.getMoveset().map(m => m.moveId)).toEqual([MoveId.FLAMETHROWER, MoveId.SURF]);
    expect(await setMoves("player", ["PSYCHIC"])).toBe("P1 Alakazam moves PSYCHIC");

    // Items through the item overrides' creation path, on either side
    expect(await giveItem("enemy", "LEFTOVERS")).toContain("[LEFTOVERS] (now x1)");
    expect(await giveItem("player", "BERRY:SITRUS x2")).toContain("[BERRY:SITRUS] (now x2)");
    // A full stack stays full, and the line tells the real count
    expect(await giveItem(0, "BERRY", { type: "LIECHI", count: 1 })).toContain("[BERRY:LIECHI] (now x3)");
    const keys = () => Object.fromEntries(player.getHeldItems().map(m => [getHeldItemKey(m), m.stackCount]));
    expect(keys()).toEqual({ FLAME_ORB: 1, "BERRY:LIECHI": 3, "BERRY:SITRUS": 2 });
    expect(enemy.getHeldItems().map(getHeldItemKey)).toEqual(["LEFTOVERS"]);
    expect(createHeldItem(player, { name: "KINGS_ROCK", count: 1 }).type.id).toBe("KINGS_ROCK");
    expect(() => createHeldItem(player, { name: "NOT_AN_ITEM", count: 1 })).toThrow(/unknown item/);
    expect(takeItem("player", "BERRY:LIECHI", 3)).toContain("x3");
    expect(takeItem("player", "BERRY")).toContain("BERRY:SITRUS");
    expect(keys()).toEqual({ FLAME_ORB: 1 });
    expect(() => takeItem("enemy", "BERRY")).toThrow(/holds no/);

    expect(setWeather("SUNNY", 3)).toBe("weather: SUNNY(3)");
    expect(game.scene.arena.weather?.weatherType).toBe(WeatherType.SUNNY);
    expect(setTerrain("electric")).toMatch(/^terrain: ELECTRIC/);
    expect(game.scene.arena.terrain?.terrainType).toBe(TerrainType.ELECTRIC);
    expect(look()).toMatch(/field: 날씨 SUNNY\(3\) · 필드 .+\[ELECTRIC\]/);
  });

  it("faint() takes the foe to 0 HP and its faint plays once the turn goes on", async () => {
    await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
    const enemy = game.field.getEnemyPokemon();
    expect(faint()).toMatch(/^E1 .+ HP 0; faints when CommandPhase ends/);
    expect(enemy.hp).toBe(0);
    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("FaintPhase");
    expect(enemy.isFainted()).toBe(true);
  });

  it("test eggs and the egg list window", async () => {
    await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
    const eggs = game.scene.gameData.eggs;
    const before = eggs.length;
    expect(addEggs(3, { tier: "RARE" })).toBe(`eggs: ${before + 3} (+3 RARE)`);
    expect(addEggs(2, { replace: true })).toBe("eggs: 2 (+2 COMMON)");
    expect(eggs).toHaveLength(2);
    eggs.length = 0;
    await expect(openMenu("EGG_LIST")).rejects.toThrow(/no eggs/);
  });

  it("settings() reads and changes the saved settings, 'normal' puts speed and animations back", () => {
    const saved = { ...settings.general };
    const anims = settings.display.enableMoveAnimations;
    try {
      expect(applySettings({ speed: "turbo", anims: false, hpBar: "skip" })).toMatch(
        /^speed 5 · hpBar SKIP · .+ · anims off/,
      );
      expect(settings.general.gameSpeed).toBe(5);
      expect(applySettings("normal")).toMatch(/^speed 3 \(normal\) · hpBar DEFAULT · exp DEFAULT · anims on/);
      expect(applySettings({ battleStyle: "set" })).toContain("battleStyle SET");
      expect(() => applySettings({ notASetting: 1 })).toThrow(/unknown setting/);
      expect(devBridgeApi.settings()).toBe(applySettings());
    } finally {
      settings.update("general", "gameSpeed", saved.gameSpeed);
      settings.update("general", "hpBarSpeed", saved.hpBarSpeed);
      settings.update("general", "expGainsSpeed", saved.expGainsSpeed);
      settings.update("general", "battleStyle", saved.battleStyle);
      settings.update("display", "enableMoveAnimations", anims);
    }
  });

  it("advance stops at a decision, and answers 'no' to 'switch?' at the start of a battle", async () => {
    const style = settings.general.battleStyle;
    settings.update("general", "battleStyle", BattleStyle.SWITCH);
    try {
      await game.classicMode.runToSummon(SpeciesId.ALAKAZAM, SpeciesId.PIKACHU);
      let step = "";
      game.onNextPrompt("CheckSwitchPhase", UiMode.CONFIRM, () => {
        step = nextAdvanceStep();
        answerNo();
      });
      await game.phaseInterceptor.to("CommandPhase");
      expect(step).toBe("no");
      expect(game.field.getPlayerPokemon().species.speciesId).toBe(SpeciesId.ALAKAZAM);
      expect(nextAdvanceStep()).toBe("decide");
      const r = await advanceCore();
      expect(r).toMatchObject({ ok: true, presses: 0, reason: "decision at COMMAND (CommandPhase)" });
      expect(await advanceCore("COMMAND")).toMatchObject({ ok: true, reason: "reached COMMAND" });
      expect(await advanceCore("MODIFIER_SELECT")).toMatchObject({
        ok: false,
        reason: "decision at COMMAND (CommandPhase) before MODIFIER_SELECT",
      });
    } finally {
      settings.update("general", "battleStyle", style);
    }
  });

  it("look() reads a Mystery Encounter's title, options and the cursor option's tooltip", async () => {
    game.override.mysteryEncounterChance(100).startingWave(12);
    await game.runToMysteryEncounter(MysteryEncounterType.DEPARTMENT_STORE_SALE, [SpeciesId.ALAKAZAM]);
    game.onNextPrompt(
      "MysteryEncounterPhase",
      UiMode.MESSAGE,
      () => game.scene.ui.getHandler<MessageUiHandler>().processInput(Button.ACTION),
      () => game.isCurrentPhase("MysteryEncounterOptionSelectedPhase", "CommandPhase", "TurnInitPhase"),
    );
    await game.phaseInterceptor.to("MysteryEncounterPhase");
    expect(game.scene.ui.mode).toBe(UiMode.MYSTERY_ENCOUNTER);
    const handler = game.scene.ui.getHandler<MysteryEncounterUiHandler>();
    handler.unblockInput();
    handler.setCursor(1);
    const text = look();
    expect(text).toContain("== MYSTERY_ENCOUNTER DEPARTMENT_STORE_SALE ==");
    expect(text).toMatch(/\ntitle: .+\ndesc: .+\nquery: .+\n/);
    expect(text).toMatch(/\n {2}0 .+\n> 1 .+\n {2}2 .+\n {2}3 .+\n {2}4 \(파티 보기\)\n/);
    expect(text).toMatch(/tooltip: .+/);
    expect(text).toContain("이벤트 DEPARTMENT_STORE_SALE");
  });
});
