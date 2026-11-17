/*
 * Local fork (2026-11-18): the fork's item icons are PokéSprite's 32x32 originals (https://github.com/msikma/pokesprite,
 * the art PokeRogue's own item icons come from), installed by tools/port/install_pokesprite_icons.py. The user:
 * "아이콘은 전부 수정하고" / "아이콘 화풍은 포케스프라이트로 통일". The Bulletproof Vest is the new Assault Vest recoloured
 * grey, and the four custom Mega Stones are palette swaps of PokeRogue's own 14x14 stones (no official art exists).
 */

import { modifierTypes } from "#data/data-lists";
import { IvCandyModifierType } from "#modifiers/modifier-type";
import {
  EV_ITEM_ICONS,
  getItemIconScale,
  ITEM_ICON_SCALES,
  ITEM_ICON_SOURCE_SIZE,
  IV_CANDY_ICONS,
  POKESPRITE_ITEM_ICONS,
  Z_CRYSTAL_ICONS,
} from "#ui/item-icon-scale";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

/** RGBA pixels of a PNG (row by row, 4 bytes a pixel; fully transparent pixels made 0,0,0,0) */
interface PngImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

interface AtlasFrame {
  filename: string;
  trimmed: boolean;
  sourceSize: { w: number; h: number };
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  frame: { x: number; y: number; w: number; h: number };
}

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

/**
 * Decodes the PNGs the item icons use (no decoder in the repository; as in custom-zmax-rewards.test.ts): non-interlaced,
 * 8-bit RGBA (`items.png`) or 1/2/4/8-bit palette with tRNS (the loose copies in `assets/images/items/`)
 */
function decodePng(file: Buffer): PngImage {
  const chunks = new Map<string, Buffer[]>();
  for (let pos = 8; pos < file.length; ) {
    const length = file.readUInt32BE(pos);
    const type = file.toString("latin1", pos + 4, pos + 8);
    chunks.set(type, [...(chunks.get(type) ?? []), file.subarray(pos + 8, pos + 8 + length)]);
    pos += 12 + length;
  }
  const header = chunks.get("IHDR")![0];
  const [width, height, depth, colourType] = [header.readUInt32BE(0), header.readUInt32BE(4), header[8], header[9]];
  expect(header[12], "interlaced PNG").toBe(0);
  const palette = chunks.get("PLTE")?.[0];
  const alphas = chunks.get("tRNS")?.[0] ?? Buffer.alloc(0);
  const rgbaFile = colourType === 6 && depth === 8;
  expect(rgbaFile || (colourType === 3 && palette != null), `PNG colour type ${colourType}, depth ${depth}`).toBe(true);
  const bitsPerPixel = rgbaFile ? 32 : depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel / 8);
  const raw = inflateSync(Buffer.concat(chunks.get("IDAT")!));
  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? rows[y * stride + i - bpp] : 0;
      const b = y > 0 ? rows[(y - 1) * stride + i] : 0;
      const c = i >= bpp && y > 0 ? rows[(y - 1) * stride + i - bpp] : 0;
      const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
      rows[y * stride + i] = (raw[y * (stride + 1) + 1 + i] + predictor) & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value: ArrayLike<number>;
      if (rgbaFile) {
        value = rows.subarray(y * stride + x * 4, y * stride + x * 4 + 4);
      } else {
        const bit = x * depth;
        const index = (rows[y * stride + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
        value = [...palette!.subarray(index * 3, index * 3 + 3), index < alphas.length ? alphas[index] : 255];
      }
      rgba.set(value[3] === 0 ? [0, 0, 0, 0] : value, (y * width + x) * 4);
    }
  }
  return { width, height, rgba };
}

const atlas = JSON.parse(readFileSync("./assets/images/items.json", "utf8")).textures[0].frames as AtlasFrame[];
const sheet = decodePng(readFileSync("./assets/images/items.png"));

/** An atlas frame on its untrimmed 32x32 source box, as the game draws it */
function frameImage(name: string): PngImage {
  const f = atlas.find(a => a.filename === name);
  expect(f, name).toBeDefined();
  const { frame, spriteSourceSize: offset, sourceSize } = f!;
  const rgba = new Uint8Array(sourceSize.w * sourceSize.h * 4);
  for (let row = 0; row < frame.h; row++) {
    const start = ((frame.y + row) * sheet.width + frame.x) * 4;
    rgba.set(sheet.rgba.subarray(start, start + frame.w * 4), ((offset.y + row) * sourceSize.w + offset.x) * 4);
  }
  return { width: sourceSize.w, height: sourceSize.h, rgba };
}

/** The box of an image's opaque pixels, as `[x, y, width, height]` */
function opaqueBox(image: PngImage): [number, number, number, number] {
  let [x0, y0, x1, y1] = [image.width, image.height, -1, -1];
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.rgba[(y * image.width + x) * 4 + 3] !== 0) {
        [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      }
    }
  }
  return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

/** "r,g,b" of each pixel (`null` where transparent) */
function colours(image: PngImage): (string | null)[] {
  const out: (string | null)[] = [];
  for (let i = 0; i < image.rgba.length; i += 4) {
    out.push(image.rgba[i + 3] === 0 ? null : `${image.rgba[i]},${image.rgba[i + 1]},${image.rgba[i + 2]}`);
  }
  return out;
}

/**
 * Checks that `recoloured` is `base` with its colours swapped: the same opaque pixels, and every colour of `base`
 * turned into one colour everywhere
 * @returns The colour table found
 */
function expectPaletteSwap(base: PngImage, recoloured: PngImage, what: string): Map<string, string> {
  const [from, to] = [colours(base), colours(recoloured)];
  const table = new Map<string, string>();
  expect(
    to.map(c => c == null),
    `${what}: same opaque pixels`,
  ).toEqual(from.map(c => c == null));
  from.forEach((c, i) => {
    if (c != null) {
      expect(table.get(c) ?? to[i], `${what}: ${c} maps to one colour`).toBe(to[i]);
      table.set(c, to[i]!);
    }
  });
  return table;
}

describe("Custom - PokéSprite item icons (2026-11-18)", () => {
  it("lists the IV candies, EV items, held items, Z-Moves items and Mark Charm by their modifier types' icons", () => {
    const candies = Object.values(IvCandyModifierType.items);
    const keys = [
      "THROAT_SPRAY",
      "ASSAULT_VEST",
      "BULLETPROOF_VEST",
      "LIFE_ORB",
      "CHOICE_BAND",
      "Z_RING",
      "DYNAMAX_CANDY",
      "MARK_CHARM",
    ] as const;
    const expected = new Set([
      ...candies,
      ...EV_ITEM_ICONS,
      ...keys.map(key => modifierTypes[key]().iconImage),
      ...Z_CRYSTAL_ICONS,
    ]);
    expect(POKESPRITE_ITEM_ICONS).toEqual(expected);
    expect(POKESPRITE_ITEM_ICONS.size).toBe(6 + 6 + 8 + 34);
    expect(IV_CANDY_ICONS).toEqual(candies);
  });

  // Local fork (2026-11-18): but the IV candies, an 11x11 drawing, at 1.5 (their 11-11 size)
  it("draws every PokéSprite icon at 1 (the IV candies at 1.5) from an untrimmed 32x32 frame with a loose copy", () => {
    for (const icon of POKESPRITE_ITEM_ICONS) {
      const candy = IV_CANDY_ICONS.includes(icon);
      expect(ITEM_ICON_SCALES.has(icon), icon).toBe(candy);
      expect(getItemIconScale(icon), icon).toBe(candy ? 1.5 : 1);
      const f = atlas.find(a => a.filename === icon)!;
      expect(f, icon).toBeDefined();
      expect([f.trimmed, f.sourceSize, f.frame.w, f.frame.h], icon).toEqual([
        false,
        { w: ITEM_ICON_SOURCE_SIZE, h: ITEM_ICON_SOURCE_SIZE },
        ITEM_ICON_SOURCE_SIZE,
        ITEM_ICON_SOURCE_SIZE,
      ]);
      const image = frameImage(icon);
      // hard alpha, like PokéSprite's sprites and the rest of the atlas
      expect(
        image.rgba.filter((v, i) => i % 4 === 3 && v !== 0 && v !== 255),
        icon,
      ).toHaveLength(0);
      const loose = decodePng(readFileSync(`./assets/images/items/${icon}.png`));
      expect(Buffer.from(loose.rgba).equals(Buffer.from(image.rgba)), `${icon}: loose copy = atlas frame`).toBe(true);
    }
  });

  it("has PokéSprite's pixels where its sprites have them (not the 2x / halved art from before)", () => {
    // [x, y, width, height] of the opaque pixels in each PokéSprite original
    const boxes: Record<string, [number, number, number, number]> = {
      ...Object.fromEntries(IV_CANDY_ICONS.map(icon => [icon, [11, 11, 11, 11]])),
      ...Object.fromEntries(EV_ITEM_ICONS.map(icon => [icon, icon === "power_lens" ? [5, 5, 22, 22] : [5, 6, 22, 21]])),
      throat_spray: [6, 5, 18, 21],
      assault_vest: [5, 7, 21, 18],
      bulletproof_vest: [5, 7, 21, 18],
      life_orb: [8, 8, 16, 16],
      choice_band: [5, 5, 22, 22],
      z_ring: [6, 6, 22, 22],
      dynamax_candy: [6, 6, 20, 21],
      mark_charm: [6, 4, 19, 24],
    };
    for (const [icon, box] of Object.entries(boxes)) {
      expect(opaqueBox(frameImage(icon)), icon).toEqual(box);
    }
    // the outline every PokéSprite item shares
    for (const icon of ["health_candy", "power_weight", "assault_vest", "life_orb", "z_ring"]) {
      expect(colours(frameImage(icon)), icon).toContain("32,32,32");
    }
  });

  it("makes the Bulletproof Vest from the Assault Vest by turning its reds grey", () => {
    const table = expectPaletteSwap(frameImage("assault_vest"), frameImage("bulletproof_vest"), "bulletproof_vest");
    // the outline and the dark grey stay; the four reds become greys
    expect(table.get("32,32,32")).toBe("32,32,32");
    expect(table.get("65,65,65")).toBe("65,65,65");
    expect(Object.fromEntries([...table].filter(([from]) => from !== "32,32,32" && from !== "65,65,65"))).toEqual({
      "205,82,82": "150,152,158",
      "180,57,65": "118,120,126",
      "148,49,57": "88,90,96",
      "98,74,82": "84,84,90",
    });
  });

  it("draws the custom Mega Stones as palette swaps of PokeRogue's own 14x14 stones, framed like them", () => {
    const stones = [
      ["charizardite_z", "charizardite_x"],
      ["galladite_z", "galladite"],
      ["baxcalibrite_z", "baxcalibrite"],
      ["archaludonite", "garchompite"],
    ] as const;
    for (const [stone, base] of stones) {
      const [f, b] = [atlas.find(a => a.filename === stone)!, atlas.find(a => a.filename === base)!];
      // trimmed 16x16 frames at (8, 8) of the 32x32 box, as the official stones (the old icons were 18x18 at (7, 7))
      for (const frame of [f, b]) {
        expect(
          [frame.trimmed, frame.sourceSize, frame.spriteSourceSize, frame.frame.w, frame.frame.h],
          frame.filename,
        ).toEqual([true, { w: 32, h: 32 }, { x: 8, y: 8, w: 16, h: 16 }, 16, 16]);
      }
      const [image, baseImage] = [frameImage(stone), frameImage(base)];
      expect(opaqueBox(image), stone).toEqual([9, 9, 14, 14]);
      const table = expectPaletteSwap(baseImage, image, stone);
      expect(table.get("32,32,32"), `${stone}: outline kept`).toBe("32,32,32");
      expect(colours(image), `${stone}: not the base's colours`).not.toEqual(colours(baseImage));
      expect(getItemIconScale(stone), stone).toBe(1);
      const loose = decodePng(readFileSync(`./assets/images/items/${stone}.png`));
      expect(Buffer.from(loose.rgba).equals(Buffer.from(image.rgba)), `${stone}: loose copy = atlas frame`).toBe(true);
    }
  });
});
