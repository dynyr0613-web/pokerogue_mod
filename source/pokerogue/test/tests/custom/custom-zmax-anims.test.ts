/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { AnimConfig, initMoveAnim, loadMoveAnimAssets, MoveAnim, moveAnims } from "#data/battle-anims";
import { allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { AnimFocus, AnimFrameTarget } from "#enums/move-anims-common";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { ZCrystalModifierType } from "#modifiers/modifier-type";
import {
  CFRU_MAX_ANIM_MOVES,
  GMAX_ANIM_ALIASES,
  getAnimMoveId,
  getTransformedMove,
  ZMAX_OWN_ANIM_MOVES,
} from "#moves/move-transform";
import { ZMAX_ONLY_MOVES } from "#moves/zmax-data";
import { GameManager } from "#test/framework/game-manager";
import { toKebabCase } from "#utils/strings";
import { existsSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local fork (2026-11-18): Z / exclusive Z battle animations converted from the user's Essentials project (Pokémon
 * Reborn's PRAS animations, `D:/PokeRogueDev/tools/port/essentials_anims.py`). The user: "Z-다이 전용 전투
 * 에니메이션은 아마 자료가 에센셜용으로 꽤 많이 있을거라 그걸 얻어오면 되고". Checked here: every listed move's file parses
 * into an `AnimConfig` whose sheet, backgrounds and sounds are in the game's assets (no 404 when it loads) and whose
 * backgrounds all become visible (review fix: Tectonic Rage's were dropped by the converter's list-order read), the list
 * matches the files, `getAnimMoveId` picks a converted move's own animation and the old fallbacks for the others, and
 * a battle with a Z move and a Max move plays them. The test harness serves Tackle for every animation fetch and
 * turns move animations off, so the files themselves are read from disk here.
 * Local fork (2026-11-19): plus the Max / G-Max / Max Guard animations rebuilt from Complete FireRed Upgrade (Skeli and
 * the CFRU team, `tools/port/cfru_max`; the user: "CFRU 받아서 만들기"): 38 own files, 14 G-Max moves on CFRU's aliases.
 * Local fork (2026-11-19, item E1): plus 다이검무 / Z다이검무's own file, Swords Dance's motion with its sword recoloured
 * Dynamax red and drawn x1.5 (the user: "e1 칼춤 모션 색깔 / 크기 변경으로 제작").
 */

/** The animation file of `id`, as `initMoveAnim` names it */
function animPath(id: MoveId): string {
  return `assets/battle-anims/${toKebabCase(MoveId[id])}.json`;
}

/** The animation objects in a file (one, or [player's, opponent's]) */
function readAnims(id: MoveId): unknown[] {
  const data: unknown = JSON.parse(readFileSync(animPath(id), "utf8"));
  return Array.isArray(data) ? data : [data];
}

/** A PNG's width and height from its header */
function pngSize(path: string): [width: number, height: number] {
  const head = readFileSync(path);
  return [head.readUInt32BE(16), head.readUInt32BE(20)];
}

/**
 * Every cel has a known target and focus and finite coordinates, and every graphic cel's frame is in the sheet as
 * `loadSpritesheet(graphic, "battle_anims", 96)` slices it
 */
function checkCels(config: AnimConfig): void {
  const sheet = `assets/images/battle_anims/${config.graphic}.png`;
  expect(existsSync(sheet), sheet).toBe(true);
  const [w, h] = pngSize(sheet);
  const frameCount = Math.floor(w / 96) * Math.floor(h / 96);
  const targets = [AnimFrameTarget.USER, AnimFrameTarget.TARGET, AnimFrameTarget.GRAPHIC];
  const focuses = [AnimFocus.TARGET, AnimFocus.USER, AnimFocus.USER_TARGET, AnimFocus.SCREEN];
  for (const cel of config.frames.flat()) {
    expect(targets).toContain(cel.target);
    expect(focuses).toContain(cel.focus);
    expect(Number.isFinite(cel.x) && Number.isFinite(cel.y)).toBe(true);
    if (cel.target === AnimFrameTarget.GRAPHIC) {
      expect(cel.graphicFrame, `${config.graphic} frame ${cel.graphicFrame}`).toBeLessThan(frameCount);
    }
  }
}

/** The backgrounds and sounds the animation loads are in the assets (nothing to 404) */
function checkResources(config: AnimConfig): void {
  for (const bg of config.getBackgroundResourceNames()) {
    expect(existsSync(`assets/images/battle_anims/${bg}.png`), bg).toBe(true);
  }
  for (const sound of config.getSoundResourceNames()) {
    expect(existsSync(`assets/audio/battle_anims/${sound}`), sound).toBe(true);
  }
  for (const [frameIndex, events] of config.frameTimedEvents) {
    expect(frameIndex).toBeGreaterThanOrEqual(0);
    expect(events.length).toBeGreaterThan(0);
  }
}

/** A timed background event's fields (the classes are not exported; an update leaves unset fields undefined) */
type BgEventFields = { resourceName: string; bgX?: number; bgY?: number; opacity?: number };

/** The background events of `config` in play order: [frame, event type, fields] */
function backgroundEvents(config: AnimConfig): [frame: number, type: string, fields: BgEventFields][] {
  return [...config.frameTimedEvents]
    .sort(([a], [b]) => a - b)
    .flatMap(([frame, events]) =>
      events
        .filter(e => e.getEventType() !== "AnimTimedSoundEvent")
        .map(e => {
          const { resourceName, bgX, bgY, opacity } = e as unknown as BgEventFields;
          return [frame, e.getEventType(), { resourceName, bgX, bgY, opacity }] as [number, string, BgEventFields];
        }),
    );
}

/**
 * The backgrounds of `config` that are never seen: added with opacity 0 and not raised by an update before the next
 * background replaces them or the animation ends
 */
function hiddenBackgrounds(config: AnimConfig): string[] {
  const hidden: string[] = [];
  let current: { name: string; seen: boolean } | null = null;
  const close = () => {
    if (current && !current.seen) {
      hidden.push(current.name);
    }
  };
  for (const [, type, fields] of backgroundEvents(config)) {
    if (type === "AnimTimedAddBgEvent") {
      close();
      current = fields.resourceName ? { name: fields.resourceName, seen: (fields.opacity ?? 0) > 0 } : null;
    } else if (current && type === "AnimTimedUpdateBgEvent" && (fields.opacity ?? 0) > 0) {
      current.seen = true;
    }
  }
  close();
  return hidden;
}

/** A cel of an animation file as stored (only the fields the 다이검무 checks read are typed) */
type CelSource = {
  x: number;
  y: number;
  zoomX: number;
  zoomY: number;
  target: number;
  focus: number;
  graphicFrame: number;
};

/** An animation file's object as stored */
type AnimSource = {
  id: number;
  graphic: string;
  frames: CelSource[][];
  frameTimedEvents: unknown;
  position: number;
  hue: number;
};

/** Local fork (2026-11-19, item E1): Swords Dance's sheet and 다이검무's recoloured copy of its sword */
const SWORDS_DANCE_SHEET = "PRAS- Swords Dance + Signal Beam";
const MAX_SWORDS_DANCE_SHEET = "PRAS- Swords Dance (Max)";
/**
 * The point (from the user's sprite centre) 다이검무's swords are spread x1.5 around: where Swords Dance's four swords
 * close in at the end, about a Dynamaxed (x1.5) user's body centre
 */
const SWORDS_PIVOT = [0, -21] as const;

/** PNG filter type 4's predictor */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  return pb <= pc ? b : c;
}

/** A PNG's chunks by type */
function pngChunks(file: Buffer): Map<string, Buffer[]> {
  const chunks = new Map<string, Buffer[]>();
  for (let pos = 8; pos < file.length; ) {
    const length = file.readUInt32BE(pos);
    const type = file.toString("latin1", pos + 4, pos + 8);
    chunks.set(type, [...(chunks.get(type) ?? []), file.subarray(pos + 8, pos + 8 + length)]);
    pos += 12 + length;
  }
  return chunks;
}

/** A PNG's filtered scanlines undone: `height` rows of `stride` bytes, `bpp` bytes a pixel (at least 1) */
function unfilterRows(raw: Uint8Array, stride: number, height: number, bpp: number): Uint8Array {
  const rows = new Uint8Array(stride * height);
  const byteAt = (y: number, i: number): number => (y >= 0 && i >= 0 ? rows[y * stride + i] : 0);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const [a, b, c] = [byteAt(y, i - bpp), byteAt(y - 1, i), byteAt(y - 1, i - bpp)];
      const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
      rows[y * stride + i] = (raw[y * (stride + 1) + 1 + i] + predictor) & 0xff;
    }
  }
  return rows;
}

/**
 * The colours of a non-interlaced 1/2/4/8-bit palette PNG's top left `size` x `size` pixels, row by row: "r,g,b", or
 * `null` where transparent (no PNG decoder in the repository; as in custom-pokesprite-icons.test.ts)
 */
function paletteColours(file: Buffer, size: number): (string | null)[] {
  const chunks = pngChunks(file);
  const header = chunks.get("IHDR")![0];
  const [width, depth] = [header.readUInt32BE(0), header[8]];
  expect([header[9], header[12]], "a palette PNG, not interlaced").toEqual([3, 0]);
  const palette = chunks.get("PLTE")![0];
  const alphas = chunks.get("tRNS")?.[0] ?? Buffer.alloc(0);
  const stride = Math.ceil((width * depth) / 8);
  const raw = inflateSync(Buffer.concat(chunks.get("IDAT")!));
  const rows = unfilterRows(raw, stride, header.readUInt32BE(4), Math.max(1, depth / 8));
  const out: (string | null)[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const bit = x * depth;
      const index = (rows[y * stride + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
      const transparent = index < alphas.length && alphas[index] === 0;
      out.push(transparent ? null : [...palette.subarray(index * 3, index * 3 + 3)].join(","));
    }
  }
  return out;
}

/** Upstream's own exclusive Z animations (there before 2026-11-18; the converter leaves them alone) */
const UPSTREAM_EXCLUSIVE_Z = [
  MoveId.CATASTROPIKA,
  MoveId.SINISTER_ARROW_RAID,
  MoveId.OCEANIC_OPERETTA,
  MoveId.PULVERIZING_PANCAKE,
  MoveId.EXTREME_EVOBOOST,
  MoveId.LIGHT_THAT_BURNS_THE_SKY,
];

describe("Z / Max battle animations 2026-11-18", () => {
  describe("files", () => {
    it("lists exactly the Z / Max / G-Max moves that have an animation file", () => {
      for (const id of ZMAX_ONLY_MOVES) {
        expect(existsSync(animPath(id)), `${MoveId[id]}: ${animPath(id)}`).toBe(ZMAX_OWN_ANIM_MOVES.has(id));
      }
      for (const id of ZMAX_OWN_ANIM_MOVES) {
        expect(ZMAX_ONLY_MOVES.has(id), MoveId[id]).toBe(true);
      }
      // 18 types x physical / special + 16 exclusive Z moves (all but 10,000,000 Volt Thunderbolt) + the 38 CFRU ones
      // + 다이검무 (2026-11-19, item E1)
      expect(CFRU_MAX_ANIM_MOVES.length).toBe(38);
      expect(ZMAX_OWN_ANIM_MOVES.size).toBe(52 + 38 + 1);
    });

    it("has a file for every Max move, Max Guard and 19 G-Max moves, and none for 10,000,000 Volt Thunderbolt", () => {
      const maxMoves = [...ZMAX_ONLY_MOVES].filter(
        id => MoveId[id].startsWith("MAX_") && id !== MoveId.MAX_SWORDS_DANCE,
      );
      expect(maxMoves.length).toBe(19);
      for (const id of maxMoves) {
        expect(existsSync(animPath(id)), MoveId[id]).toBe(true);
      }
      const gmaxMoves = [...ZMAX_ONLY_MOVES].filter(id => MoveId[id].startsWith("G_MAX_"));
      expect(gmaxMoves.length).toBe(33);
      for (const id of gmaxMoves) {
        // own file or one of CFRU's 14 aliases, never both
        expect(existsSync(animPath(id)), MoveId[id]).toBe(!GMAX_ANIM_ALIASES.has(id));
      }
      expect(GMAX_ANIM_ALIASES.size).toBe(14);
      // Local fork (2026-11-19, item E1): 다이검무 has its own file now
      expect(existsSync(animPath(MoveId.MAX_SWORDS_DANCE))).toBe(true);
      expect(existsSync(animPath(MoveId.TEN_MILLION_VOLT_THUNDERBOLT))).toBe(false);
    });

    it("gives every G-Max alias a target whose file exists", () => {
      for (const [gmax, target] of GMAX_ANIM_ALIASES) {
        expect(existsSync(animPath(target)), `${MoveId[gmax]} -> ${MoveId[target]}`).toBe(true);
        expect(GMAX_ANIM_ALIASES.has(target), MoveId[target]).toBe(false);
      }
    });

    it.each(CFRU_MAX_ANIM_MOVES.map(id => [MoveId[id], id] as const))(
      "%s (CFRU) is one object for both sides, 40-75 frames, battlers in every frame, sheet named CFRU-",
      (_name, id) => {
        const anims = readAnims(id);
        expect(anims.length).toBe(1);
        const config = new AnimConfig(anims[0]);
        expect(config.graphic.startsWith("CFRU- ")).toBe(true);
        expect(config.frames.length).toBeGreaterThanOrEqual(40);
        expect(config.frames.length).toBeLessThanOrEqual(75);
        for (const frame of config.frames) {
          const user = frame.filter(cel => cel.target === AnimFrameTarget.USER);
          const target = frame.filter(cel => cel.target === AnimFrameTarget.TARGET);
          expect(user.length).toBe(1);
          expect(target.length).toBe(1);
          expect(user[0].locked && target[0].locked).toBe(true);
          expect(frame.filter(cel => cel.target === AnimFrameTarget.GRAPHIC).length).toBeLessThanOrEqual(24);
          for (const cel of frame) {
            // the engine adds tone[3] raw as a grey mix factor; the CFRU files keep it at 0
            expect(cel.tone[3]).toBe(0);
          }
        }
        if (id === MoveId.MAX_GUARD) {
          // a self move: USER_TARGET would collapse onto the user, so its graphics follow the user
          for (const cel of config.frames.flat().filter(c => c.target === AnimFrameTarget.GRAPHIC)) {
            expect(cel.focus).toBe(AnimFocus.USER);
          }
        }
      },
    );

    it.each([...ZMAX_OWN_ANIM_MOVES].map(id => [MoveId[id], id] as const))(
      "%s parses into an AnimConfig whose sheet, backgrounds and sounds are in the assets",
      (_name, id) => {
        const anims = readAnims(id);
        expect(anims.length === 1 || anims.length === 2).toBe(true);
        for (const source of anims) {
          const config = new AnimConfig(source);
          expect(config.frames.length).toBeGreaterThan(10);
          expect(config.graphic).toBeTruthy();
          checkCels(config);
          checkResources(config);
        }
      },
    );

    it.each([...ZMAX_OWN_ANIM_MOVES].map(id => [MoveId[id], id] as const))(
      "%s shows every background it adds (an invisible one is raised later)",
      (_name, id) => {
        for (const source of readAnims(id)) {
          expect(hiddenBackgrounds(new AnimConfig(source))).toEqual([]);
        }
      },
    );

    // Review fix (2026-11-18): Essentials lists Tectonic Rage's background updates before the background itself and
    // plays them by frame; the converter read them in list order and dropped all four, so the background never showed
    it("plays Tectonic Rage's background: set at 21, faded in, scrolled and faded out after it", () => {
      for (const id of [MoveId.TECTONIC_RAGE__PHYSICAL, MoveId.TECTONIC_RAGE__SPECIAL]) {
        const [source] = readAnims(id);
        expect(backgroundEvents(new AnimConfig(source))).toEqual([
          [21, "AnimTimedAddBgEvent", { resourceName: "PRAS- Tectonic Rage BG", bgX: 0, bgY: 0, opacity: 0 }],
          [22, "AnimTimedUpdateBgEvent", { resourceName: "", opacity: 255 }],
          [26, "AnimTimedUpdateBgEvent", { resourceName: "", bgY: -500 }],
          [49, "AnimTimedUpdateBgEvent", { resourceName: "", bgY: -364 }],
          [74, "AnimTimedUpdateBgEvent", { resourceName: "", opacity: 0 }],
        ]);
      }
    });

    it("keeps upstream's six exclusive Z animations", () => {
      for (const id of UPSTREAM_EXCLUSIVE_Z) {
        expect(ZMAX_OWN_ANIM_MOVES.has(id)).toBe(true);
        expect(readFileSync(animPath(id), "utf8")).toContain('"id"');
      }
    });

    // Local fork (2026-11-19, item E1): 다이검무's own animation, Swords Dance's motion with the swords recoloured
    // Dynamax red and drawn x1.5 (the user: "e1 칼춤 모션 색깔 / 크기 변경으로 제작")
    it("다이검무 is Swords Dance's motion with the swords x1.5 around where they close in, same timing and sounds", () => {
      const [swordsDance] = readAnims(MoveId.SWORDS_DANCE) as AnimSource[];
      const anims = readAnims(MoveId.MAX_SWORDS_DANCE) as AnimSource[];
      expect(anims.length).toBe(1);
      const [maxSwordsDance] = anims;
      expect(maxSwordsDance.id).toBe(MoveId.MAX_SWORDS_DANCE);
      expect(maxSwordsDance.graphic).toBe(MAX_SWORDS_DANCE_SHEET);
      expect(maxSwordsDance.frameTimedEvents).toEqual(swordsDance.frameTimedEvents);
      expect([maxSwordsDance.position, maxSwordsDance.hue]).toEqual([swordsDance.position, swordsDance.hue]);
      expect(maxSwordsDance.frames.length).toBe(swordsDance.frames.length);
      let swords = 0;
      swordsDance.frames.forEach((frame, i) => {
        expect(maxSwordsDance.frames[i].length).toBe(frame.length);
        frame.forEach((cel, j) => {
          if (cel.target !== AnimFrameTarget.GRAPHIC) {
            // the user / target cels stay as they are
            expect(maxSwordsDance.frames[i][j], `frame ${i} cel ${j}`).toEqual(cel);
            return;
          }
          swords++;
          expect(cel.focus).toBe(AnimFocus.USER);
          expect(maxSwordsDance.frames[i][j], `frame ${i} cel ${j}`).toEqual({
            ...cel,
            x: SWORDS_PIVOT[0] + (cel.x - SWORDS_PIVOT[0]) * 1.5,
            y: SWORDS_PIVOT[1] + (cel.y - SWORDS_PIVOT[1]) * 1.5,
            zoomX: cel.zoomX * 1.5,
            zoomY: cel.zoomY * 1.5,
          });
        });
      });
      // four swords in each of the 20 frames that show them
      expect(swords).toBe(80);
    });

    it("다이검무's sheet is Swords Dance's sword with its two colours swapped for Dynamax red / magenta", () => {
      const sheetPath = `assets/images/battle_anims/${MAX_SWORDS_DANCE_SHEET}.png`;
      // one 96x96 frame: the only one Swords Dance uses
      expect(pngSize(sheetPath)).toEqual([96, 96]);
      for (const cel of (readAnims(MoveId.SWORDS_DANCE) as AnimSource[])[0].frames.flat()) {
        expect(cel.graphicFrame).toBe(0);
      }
      const from = paletteColours(readFileSync(`assets/images/battle_anims/${SWORDS_DANCE_SHEET}.png`), 96);
      const to = paletteColours(readFileSync(sheetPath), 96);
      // the same opaque pixels (the sword's shape), each of its two colours turned into one other colour everywhere
      expect(to.map(c => c == null)).toEqual(from.map(c => c == null));
      expect(from.filter(c => c != null).length).toBeGreaterThan(500);
      const table = new Map<string, Set<string>>();
      from.forEach((c, i) => {
        if (c != null) {
          table.set(c, (table.get(c) ?? new Set<string>()).add(to[i]!));
        }
      });
      expect([...table.values()].map(set => set.size)).toEqual([1, 1]);
      for (const [colour, [swapped]] of table) {
        const [r, g, b] = swapped.split(",").map(Number);
        expect(r > 180 && r > g + 100 && r > b + 50, `${colour} -> ${swapped} is red / magenta`).toBe(true);
      }
      // the shading stays: the lighter blue becomes the lighter red (review, 2026-11-19)
      const brightness = (rgb: string): number => rgb.split(",").reduce((sum, v) => sum + Number(v), 0);
      const [[lightFrom, [lightTo]], [darkFrom, [darkTo]]] = [...table].sort(
        ([a], [b]) => brightness(b) - brightness(a),
      );
      expect(brightness(lightFrom)).toBeGreaterThan(brightness(darkFrom));
      expect(brightness(lightTo), `${lightTo} lighter than ${darkTo}`).toBeGreaterThan(brightness(darkTo));
    });
  });

  describe("getAnimMoveId", () => {
    it("plays a Z move's own animation, physical and special", () => {
      expect(
        getAnimMoveId(getTransformedMove(MoveId.THUNDERBOLT, { kind: "z", moveId: MoveId.GIGAVOLT_HAVOC__SPECIAL })),
      ).toBe(MoveId.GIGAVOLT_HAVOC__SPECIAL);
      expect(
        getAnimMoveId(getTransformedMove(MoveId.TACKLE, { kind: "z", moveId: MoveId.BREAKNECK_BLITZ__PHYSICAL })),
      ).toBe(MoveId.BREAKNECK_BLITZ__PHYSICAL);
    });

    it("plays an exclusive Z move's own animation, or the base move's for 10,000,000 Volt Thunderbolt", () => {
      expect(
        getAnimMoveId(getTransformedMove(MoveId.MOONBLAST, { kind: "zExclusive", moveId: MoveId.GUARDIAN_OF_ALOLA })),
      ).toBe(MoveId.GUARDIAN_OF_ALOLA);
      expect(
        getAnimMoveId(
          getTransformedMove(MoveId.SHADOW_BALL, { kind: "zExclusive", moveId: MoveId.CLANGOROUS_SOULBLAZE }),
        ),
      ).toBe(MoveId.CLANGOROUS_SOULBLAZE);
      expect(
        getAnimMoveId(
          getTransformedMove(MoveId.THUNDERBOLT, { kind: "zExclusive", moveId: MoveId.TEN_MILLION_VOLT_THUNDERBOLT }),
        ),
      ).toBe(MoveId.THUNDERBOLT);
    });

    it("plays the CFRU files for Max / G-Max / Z다이 / Max Guard, its own for 다이검무 and the fallback for Z status moves", () => {
      expect(getAnimMoveId(getTransformedMove(MoveId.EMBER, { kind: "max", moveId: MoveId.MAX_FLARE }))).toBe(
        MoveId.MAX_FLARE,
      );
      expect(
        getAnimMoveId(getTransformedMove(MoveId.DOUBLE_IRON_BASH, { kind: "gmax", moveId: MoveId.G_MAX_MELTDOWN })),
      ).toBe(MoveId.G_MAX_MELTDOWN);
      // CFRU's aliases: G-Max Centiferno plays Max Flare's, G-Max Fireball plays Pyro Ball's
      expect(
        getAnimMoveId(getTransformedMove(MoveId.FIRE_SPIN, { kind: "gmax", moveId: MoveId.G_MAX_CENTIFERNO })),
      ).toBe(MoveId.MAX_FLARE);
      expect(getAnimMoveId(getTransformedMove(MoveId.EMBER, { kind: "gmax", moveId: MoveId.G_MAX_FIREBALL }))).toBe(
        MoveId.PYRO_BALL,
      );
      // Z다이 attack: a copy of the Max move, so the Max move's file
      expect(getAnimMoveId(getTransformedMove(MoveId.EMBER, { kind: "zMax", moveId: MoveId.MAX_FLARE }))).toBe(
        MoveId.MAX_FLARE,
      );
      expect(getAnimMoveId(getTransformedMove(MoveId.TAIL_WHIP, { kind: "max", moveId: MoveId.MAX_GUARD }))).toBe(
        MoveId.MAX_GUARD,
      );
      expect(getAnimMoveId(getTransformedMove(MoveId.TAIL_WHIP, { kind: "zMax", moveId: MoveId.MAX_GUARD }))).toBe(
        MoveId.MAX_GUARD,
      );
      // Local fork (2026-11-19, item E1): 다이검무 and Z다이검무 (same id) play max-swords-dance.json
      expect(
        getAnimMoveId(getTransformedMove(MoveId.SWORDS_DANCE, { kind: "max", moveId: MoveId.MAX_SWORDS_DANCE })),
      ).toBe(MoveId.MAX_SWORDS_DANCE);
      expect(
        getAnimMoveId(getTransformedMove(MoveId.SWORDS_DANCE, { kind: "zMax", moveId: MoveId.MAX_SWORDS_DANCE })),
      ).toBe(MoveId.MAX_SWORDS_DANCE);
      expect(getAnimMoveId(getTransformedMove(MoveId.SWORDS_DANCE, { kind: "z", moveId: MoveId.SWORDS_DANCE }))).toBe(
        MoveId.SWORDS_DANCE,
      );
      expect(getAnimMoveId(allMoves[MoveId.FLAMETHROWER])).toBe(MoveId.FLAMETHROWER);
    });

    it("never names a file that is not there for a Z / Max registry entry used outside a slot", () => {
      expect(getAnimMoveId(allMoves[MoveId.CATASTROPIKA])).toBe(MoveId.CATASTROPIKA);
      expect(getAnimMoveId(allMoves[MoveId.MAX_FLARE])).toBe(MoveId.MAX_FLARE);
      expect(getAnimMoveId(allMoves[MoveId.G_MAX_WILDFIRE])).toBe(MoveId.G_MAX_WILDFIRE);
      expect(getAnimMoveId(allMoves[MoveId.G_MAX_BEFUDDLE])).toBe(MoveId.MAX_FLUTTERBY);
      expect(getAnimMoveId(allMoves[MoveId.MAX_GUARD])).toBe(MoveId.MAX_GUARD);
      expect(getAnimMoveId(allMoves[MoveId.MAX_SWORDS_DANCE])).toBe(MoveId.MAX_SWORDS_DANCE);
      for (const id of ZMAX_ONLY_MOVES) {
        const animId = getAnimMoveId(allMoves[id]);
        expect(ZMAX_ONLY_MOVES.has(animId) ? existsSync(animPath(animId)) : true, MoveId[id]).toBe(true);
        if (MoveId[id].startsWith("MAX_") || MoveId[id].startsWith("G_MAX_")) {
          // a Max / G-Max move never falls back to Tackle any more (다이검무 has its own file since 2026-11-19)
          expect(existsSync(animPath(animId)), `${MoveId[id]} -> ${MoveId[animId]}`).toBe(true);
        }
      }
    });
  });

  describe("in battle", () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      game = new GameManager(phaserGame);
      game.override
        .battleStyle("single")
        .criticalHits(false)
        .startingLevel(50)
        .enemyLevel(100)
        .enemySpecies(SpeciesId.SNORLAX)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset(MoveId.SPLASH)
        .ability(AbilityId.BALL_FETCH)
        .hasPassiveAbility(false)
        .enemyHasPassiveAbility(false);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("a Z move plays its own animation and a Max move its CFRU one", async () => {
      await game.classicMode.startBattle(SpeciesId.RAICHU);
      const raichu = game.field.getPlayerPokemon();
      game.move.changeMoveset(raichu, [MoveId.THUNDERBOLT, MoveId.EMBER]);
      expect(game.scene.addModifier(new ZCrystalModifierType(PokemonType.ELECTRIC).newModifier(raichu, 0)!)).toBe(true);
      expect(game.scene.addModifier(modifierTypes.DYNAMAX_CANDY().newModifier(raichu, 1)!)).toBe(true);
      const [zSlot, maxSlot] = raichu.moveset;
      expect(zSlot.getMove().id).toBe(MoveId.GIGAVOLT_HAVOC__SPECIAL);
      expect(maxSlot.getMove().id).toBe(MoveId.MAX_FLARE);

      // What the summon and the conversion load (the harness serves Tackle's file for every animation)
      const animIds = raichu.getMoveset().map(m => getAnimMoveId(m.getMove()));
      expect(animIds).toEqual([MoveId.GIGAVOLT_HAVOC__SPECIAL, MoveId.MAX_FLARE]);
      await Promise.all(animIds.map(id => initMoveAnim(id)));
      await loadMoveAnimAssets(animIds);
      for (const id of animIds) {
        expect(moveAnims.get(id)).toBeInstanceOf(AnimConfig);
      }

      const play = vi.spyOn(MoveAnim.prototype, "play");
      const enemy = game.field.getEnemyPokemon();

      game.move.select(MoveId.THUNDERBOLT);
      await game.toNextTurn();
      expect(enemy.hp).toBeLessThan(enemy.getMaxHp());
      const hpAfterZ = enemy.hp;

      game.move.select(MoveId.EMBER);
      await game.toNextTurn();
      expect(enemy.hp).toBeLessThan(hpAfterZ);

      const played = play.mock.contexts.map(anim => (anim as MoveAnim).move);
      expect(played).toContain(MoveId.GIGAVOLT_HAVOC__SPECIAL);
      expect(played).toContain(MoveId.MAX_FLARE);
      expect(played).not.toContain(MoveId.EMBER);
    });

    // Local fork (2026-11-19, item E1)
    it("다이검무 plays its own animation, not Swords Dance's", async () => {
      await game.classicMode.startBattle(SpeciesId.RAICHU);
      const raichu = game.field.getPlayerPokemon();
      game.move.changeMoveset(raichu, [MoveId.SWORDS_DANCE]);
      expect(game.scene.addModifier(modifierTypes.DYNAMAX_CANDY().newModifier(raichu, 0)!)).toBe(true);
      expect(raichu.moveset[0].getMove().id).toBe(MoveId.MAX_SWORDS_DANCE);
      expect(getAnimMoveId(raichu.moveset[0].getMove())).toBe(MoveId.MAX_SWORDS_DANCE);

      const play = vi.spyOn(MoveAnim.prototype, "play");
      game.move.select(MoveId.SWORDS_DANCE);
      await game.toNextTurn();
      expect(raichu.getStatStage(Stat.ATK)).toBe(3);

      const played = play.mock.contexts.map(anim => (anim as MoveAnim).move);
      expect(played).toContain(MoveId.MAX_SWORDS_DANCE);
      expect(played).not.toContain(MoveId.SWORDS_DANCE);
    });
  });
});
