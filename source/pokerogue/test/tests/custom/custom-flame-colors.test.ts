/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { settings } from "#app/global-settings-manager";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { AnimConfig, BattleAnim, initMoveAnim, MoveAnim, moveAnims, queueFlameAnimAssets } from "#data/battle-anims";
import { allMoves, modifierTypes } from "#data/data-lists";
import {
  FLAME_COLOR_TABLE,
  FLAME_COLORS,
  FLAME_RECOLOR_GRAPHICS,
  type FlameColor,
  getFlameGraphicKey,
  getMoveFlameGraphicKey,
  getPokemonFlameColor,
  getSpeciesFlameColor,
} from "#data/flame-anim-colors";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { loadMoveAnimations } from "#sprites/pokemon-asset-loader";
import { GameManager } from "#test/framework/game-manager";
import { toKebabCase } from "#utils/strings";
import { existsSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local fork (2026-11-20), items V1 + V2 and the user's V4 note: Fire moves of Mega Charizard X (blue), Mega Charizard Y
 * (white), the Litwick line, Hisuian Typhlosion, Ceruledge (purple) and Alolan Marowak (green) draw their flame sheets
 * in that colour. The user: "V1 실행", "V2 - 실행", "V4 - x, 메가리자몽 y가 쓰는 불 기술 정도만 흰색 변환".
 * Checked here: the table, the colour copies on disk (same size and alpha, only the flame colours changed), the key a
 * move animation draws with (actual type Fire only, a fusion's head, a transformed Pokémon's copied form), the loads
 * (queued with the Pokémon's assets, or before a move plays), and a battle passing the used type to the animation.
 * The test harness serves Tackle's file for every animation fetch, so the animations are read from disk here.
 */

const SHEETS = "assets/images/battle_anims";

/** The animation objects in `move`'s file, or [] when it has none */
function readAnimSources(move: MoveId): Record<string, unknown>[] {
  const path = `assets/battle-anims/${toKebabCase(MoveId[move])}.json`;
  if (!existsSync(path)) {
    return [];
  }
  const data: unknown = JSON.parse(readFileSync(path, "utf8"));
  return (Array.isArray(data) ? data : [data]) as Record<string, unknown>[];
}

/** Puts `move`'s real animation (from disk) in `moveAnims`, as `initMoveAnim` would outside the harness */
function setRealAnim(move: MoveId): void {
  const [player, opponent] = readAnimSources(move).map(source => new AnimConfig(source));
  moveAnims.set(move, opponent ? [player, opponent] : player);
}

// #region PNG reading

function pngChunks(file: Buffer): Map<string, Buffer[]> {
  const chunks = new Map<string, Buffer[]>();
  let offset = 8;
  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString("latin1", offset + 4, offset + 8);
    chunks.set(type, [...(chunks.get(type) ?? []), file.subarray(offset + 8, offset + 8 + length)]);
    offset += 12 + length;
  }
  return chunks;
}

function unfilter(raw: Buffer, stride: number, height: number, bpp: number): Uint8Array {
  const out = new Uint8Array(stride * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const a = x >= bpp ? out[i - bpp] : 0;
      const b = y > 0 ? out[i - stride] : 0;
      const c = x >= bpp && y > 0 ? out[i - stride - bpp] : 0;
      const v = raw[p++];
      let r: number;
      switch (filter) {
        case 0:
          r = v;
          break;
        case 1:
          r = v + a;
          break;
        case 2:
          r = v + b;
          break;
        case 3:
          r = v + ((a + b) >> 1);
          break;
        case 4: {
          const pp = a + b - c;
          const [pa, pb, pc] = [Math.abs(pp - a), Math.abs(pp - b), Math.abs(pp - c)];
          r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          throw new Error(`filter ${filter}`);
      }
      out[i] = r & 255;
    }
  }
  return out;
}

/** A PNG's pixels as RGBA (palette PNGs of 1-8 bits and 8-bit RGB / RGBA, not interlaced) */
function readPng(path: string): { width: number; height: number; rgba: Uint8Array } {
  const chunks = pngChunks(readFileSync(path));
  const header = chunks.get("IHDR")![0];
  const [width, height, depth, colorType, interlace] = [
    header.readUInt32BE(0),
    header.readUInt32BE(4),
    header[8],
    header[9],
    header[12],
  ];
  expect(interlace, path).toBe(0);
  const channels = colorType === 3 ? 1 : colorType === 2 ? 3 : colorType === 6 ? 4 : Number.NaN;
  expect(Number.isNaN(channels), `${path}: colour type ${colorType}`).toBe(false);
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const rows = unfilter(inflateSync(Buffer.concat(chunks.get("IDAT")!)), stride, height, Math.max(1, bitsPerPixel / 8));
  const palette = chunks.get("PLTE")?.[0];
  const alphas = chunks.get("tRNS")?.[0] ?? Buffer.alloc(0);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === 3) {
        const bit = x * depth;
        const index = (rows[y * stride + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
        rgba.set([...palette!.subarray(index * 3, index * 3 + 3), index < alphas.length ? alphas[index] : 255], o);
      } else {
        const s = y * stride + x * channels;
        rgba.set([rows[s], rows[s + 1], rows[s + 2], channels === 4 ? rows[s + 3] : 255], o);
      }
    }
  }
  return { width, height, rgba };
}

/** [hue in degrees, saturation, value] of 0-255 RGB */
function hsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    if (h < 0) {
      h += 360;
    }
  }
  return [h, max === 0 ? 0 : d / max, max / 255];
}

const luma = (r: number, g: number, b: number): number => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

/**
 * The recolour script's test for a flame colour (hue 330..75, saturation >= 0.2, value >= 0.05): "edge" within a
 * hair of its limits, where float rounding may side either way
 */
function flameClass(r: number, g: number, b: number): "flame" | "other" | "edge" {
  const [h, s, v] = hsv(r, g, b);
  const inside = s >= 0.2 && v >= 0.05 && (h <= 75 || h >= 330);
  const nearLimit =
    Math.abs(s - 0.2) < 0.005 || Math.abs(v - 0.05) < 0.005 || Math.abs(h - 75) < 0.5 || Math.abs(h - 330) < 0.5;
  return nearLimit ? "edge" : inside ? "flame" : "other";
}

/** The hues a colour's flames must have (where saturated enough to have a hue) */
const HUE_RANGES: Record<Exclude<FlameColor, "white">, [number, number]> = {
  blue: [180, 245],
  purple: [260, 310],
  green: [70, 145],
};

// #endregion PNG reading

describe("Flame colours of Fire moves 2026-11-20 (V1 / V2)", () => {
  describe("the table", () => {
    it("gives Mega Charizard X blue, Mega Charizard Y white and other Charizard forms nothing", () => {
      expect(getSpeciesFlameColor(SpeciesId.CHARIZARD, SpeciesFormKey.MEGA_X)).toBe("blue");
      expect(getSpeciesFlameColor(SpeciesId.CHARIZARD, SpeciesFormKey.MEGA_Y)).toBe("white");
      expect(getSpeciesFlameColor(SpeciesId.CHARIZARD, "")).toBeUndefined();
      expect(getSpeciesFlameColor(SpeciesId.CHARIZARD, SpeciesFormKey.MEGA_Z)).toBeUndefined();
      expect(getSpeciesFlameColor(SpeciesId.CHARIZARD, SpeciesFormKey.GIGANTAMAX)).toBeUndefined();
    });

    it("gives the Litwick line, Hisuian Typhlosion and Ceruledge purple and Alolan Marowak green, not their kin", () => {
      for (const species of [
        SpeciesId.LITWICK,
        SpeciesId.LAMPENT,
        SpeciesId.CHANDELURE,
        SpeciesId.HISUI_TYPHLOSION,
        SpeciesId.CERULEDGE,
      ]) {
        expect(getSpeciesFlameColor(species, ""), SpeciesId[species]).toBe("purple");
      }
      expect(getSpeciesFlameColor(SpeciesId.ALOLA_MAROWAK, "")).toBe("green");
      for (const species of [SpeciesId.TYPHLOSION, SpeciesId.MAROWAK, SpeciesId.ARMAROUGE, SpeciesId.CHARCADET]) {
        expect(getSpeciesFlameColor(species, ""), SpeciesId[species]).toBeUndefined();
      }
    });

    it("names real species and forms, once each, with colours that have copies", () => {
      const seen = new Set<string>();
      for (const row of FLAME_COLOR_TABLE) {
        const key = `${SpeciesId[row.species]}:${row.formKey ?? "*"}`;
        expect(seen.has(key), key).toBe(false);
        seen.add(key);
        expect(FLAME_COLORS).toContain(row.color);
        const species = speciesDataRegistry.getSpecies(row.species);
        expect(species, key).toBeDefined();
        if (row.formKey !== undefined) {
          expect(
            species.forms.map(f => f.formKey),
            key,
          ).toContain(row.formKey);
        }
      }
      expect(FLAME_COLOR_TABLE.length).toBe(8);
    });
  });

  describe("the sheet copies", () => {
    /** The sheets drawn by the animation files of Fire moves (Z / Max ones included) */
    const fireSheets = new Map<string, MoveId[]>();
    beforeAll(() => {
      for (const move of allMoves) {
        if (move?.type !== PokemonType.FIRE) {
          continue;
        }
        for (const source of readAnimSources(move.id)) {
          const graphic = source.graphic as string;
          fireSheets.set(graphic, [...(fireSheets.get(graphic) ?? []), move.id]);
        }
      }
    });

    it("copies only sheets that Fire moves draw, among them the one 25+ Fire moves share", () => {
      for (const sheet of FLAME_RECOLOR_GRAPHICS) {
        expect(fireSheets.has(sheet), sheet).toBe(true);
      }
      const fireUsers = new Set(fireSheets.get("PRAS- Fire"));
      expect(fireUsers.size).toBeGreaterThanOrEqual(25);
      for (const move of [
        MoveId.FLAMETHROWER,
        MoveId.FIRE_BLAST,
        MoveId.FLARE_BLITZ,
        MoveId.INFERNO_OVERDRIVE__SPECIAL,
      ]) {
        expect(fireUsers.has(move), MoveId[move]).toBe(true);
      }
      expect(fireSheets.get("CFRU- Max Flare")).toEqual([MoveId.MAX_FLARE]);
      expect(fireSheets.get("CFRU- G-Max Wildfire")).toEqual([MoveId.G_MAX_WILDFIRE]);
      expect(FLAME_RECOLOR_GRAPHICS.size).toBe(11);
    });

    it("has a copy of every sheet in every colour: same size and alpha, only the flame colours changed", () => {
      for (const sheet of FLAME_RECOLOR_GRAPHICS) {
        const original = readPng(`${SHEETS}/${sheet}.png`);
        for (const color of FLAME_COLORS) {
          const path = `${SHEETS}/${getFlameGraphicKey(sheet, color)}.png`;
          expect(existsSync(path), path).toBe(true);
          const copy = readPng(path);
          expect([copy.width, copy.height], path).toEqual([original.width, original.height]);
          let flamePixels = 0;
          let changed = 0;
          let hued = 0;
          let inRange = 0;
          for (let o = 0; o < original.rgba.length; o += 4) {
            const [r, g, b, a] = original.rgba.subarray(o, o + 4);
            const [r2, g2, b2, a2] = copy.rgba.subarray(o, o + 4);
            if (a !== a2) {
              throw new Error(`${path}: alpha changed at pixel ${o / 4}`);
            }
            const kind = flameClass(r, g, b);
            if (a === 0 || kind === "edge") {
              continue;
            }
            if (kind === "other") {
              if (r !== r2 || g !== g2 || b !== b2) {
                throw new Error(`${path}: non-flame colour ${[r, g, b]} changed at pixel ${o / 4}`);
              }
              continue;
            }
            flamePixels++;
            changed += r !== r2 || g !== g2 || b !== b2 ? 1 : 0;
            const [h2, s2] = hsv(r2, g2, b2);
            if (color === "white") {
              expect(s2, `${path}: ${[r2, g2, b2]} is white / grey`).toBeLessThanOrEqual(0.15);
              expect(luma(r2, g2, b2) + 1 / 255, `${path}: lighter than ${[r, g, b]}`).toBeGreaterThanOrEqual(
                luma(r, g, b),
              );
            } else if (s2 >= 0.2) {
              hued++;
              const [lo, hi] = HUE_RANGES[color];
              inRange += h2 >= lo && h2 <= hi ? 1 : 0;
            }
          }
          expect(flamePixels, path).toBeGreaterThan(50);
          expect(changed, path).toBe(flamePixels);
          if (color !== "white") {
            expect(inRange / hued, `${path}: share of ${color} hues`).toBeGreaterThan(0.98);
          }
        }
      }
    });
  });

  describe("in battle", () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;
    const touched: MoveId[] = [];
    const formIndex = (species: SpeciesId, formKey: string): number =>
      speciesDataRegistry.getSpecies(species).forms.findIndex(f => f.formKey === formKey);

    /**
     * Sets `moveIds`' real animations, dropped after the test, and lets `MoveAnim.getAnim` read them (the harness stubs
     * it to an empty animation; this is upstream's body). Waits for the harness's own load of each first, which would
     * otherwise land on top (`populateMoveAnim` pairs a late load with what is there).
     */
    const useRealAnims = async (...moveIds: MoveId[]) => {
      await Promise.all(moveIds.map(id => initMoveAnim(id)));
      for (const id of moveIds) {
        touched.push(id);
        setRealAnim(id);
      }
      vi.spyOn(MoveAnim.prototype, "getAnim").mockImplementation(function (this: MoveAnim) {
        const anims = moveAnims.get(this.move);
        return (anims instanceof AnimConfig ? anims : anims?.[this.user?.isPlayer() ? 0 : 1]) as AnimConfig;
      });
    };

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
        .enemyHasPassiveAbility(false)
        .starterForms({ [SpeciesId.CHARIZARD]: formIndex(SpeciesId.CHARIZARD, SpeciesFormKey.MEGA_X) });
    });

    afterEach(() => {
      vi.restoreAllMocks();
      for (const id of touched.splice(0)) {
        moveAnims.delete(id);
      }
      settings.update("display", "enableMoveAnimations", false);
    });

    it("swaps a Fire move's flame sheet for the user's colour, and nothing else", async () => {
      await game.classicMode.startBattle(SpeciesId.CHARIZARD, SpeciesId.CHANDELURE);
      const [megaX, chandelure] = game.scene.getPlayerParty();
      expect(megaX.getFormKey()).toBe(SpeciesFormKey.MEGA_X);
      expect(getPokemonFlameColor(megaX)).toBe("blue");
      expect(getPokemonFlameColor(chandelure)).toBe("purple");

      expect(getMoveFlameGraphicKey("PRAS- Fire", megaX, PokemonType.FIRE)).toBe("PRAS- Fire (blue)");
      expect(getMoveFlameGraphicKey("PRAS- Fire", chandelure, PokemonType.FIRE)).toBe("PRAS- Fire (purple)");
      expect(getMoveFlameGraphicKey("CFRU- Max Flare", megaX, PokemonType.FIRE)).toBe("CFRU- Max Flare (blue)");
      // Outrage draws "PRAS- Fire" too, but it is a Dragon move
      expect(getMoveFlameGraphicKey("PRAS- Fire", megaX, PokemonType.DRAGON)).toBeUndefined();
      // Heat Wave's sheet is not flames: no copy
      expect(getMoveFlameGraphicKey("fly copy", megaX, PokemonType.FIRE)).toBeUndefined();
      // a Fire move of a Pokémon not in the table
      const enemy = game.field.getEnemyPokemon();
      expect(getMoveFlameGraphicKey("PRAS- Fire", enemy, PokemonType.FIRE)).toBeUndefined();
      expect(getMoveFlameGraphicKey(undefined, megaX, PokemonType.FIRE)).toBeUndefined();
      expect(getMoveFlameGraphicKey("PRAS- Fire", megaX, undefined)).toBeUndefined();
    });

    it("reads a fusion's head, a transformed Pokémon's copied form and an Illusion's disguise", async () => {
      game.override.starterForms({});
      await game.classicMode.startBattle(SpeciesId.CHARIZARD, SpeciesId.PIKACHU);
      const [charizard, pikachu] = game.scene.getPlayerParty();
      const megaX = formIndex(SpeciesId.CHARIZARD, SpeciesFormKey.MEGA_X);
      const megaY = formIndex(SpeciesId.CHARIZARD, SpeciesFormKey.MEGA_Y);

      // Mega Charizard Y as the head, Pikachu as the tail: white
      charizard.formIndex = megaY;
      charizard.fusionSpecies = speciesDataRegistry.getSpecies(SpeciesId.PIKACHU);
      charizard.fusionFormIndex = 0;
      expect(getPokemonFlameColor(charizard)).toBe("white");
      expect(getMoveFlameGraphicKey("PRAS- Fire", charizard, PokemonType.FIRE)).toBe("PRAS- Fire (white)");

      // Pikachu as the head, Mega Charizard X as the tail: nothing
      pikachu.fusionSpecies = speciesDataRegistry.getSpecies(SpeciesId.CHARIZARD);
      pikachu.fusionFormIndex = megaX;
      expect(getPokemonFlameColor(pikachu)).toBeUndefined();

      // transformed into Mega Charizard X: blue while it lasts
      pikachu.fusionSpecies = null;
      pikachu.summonData.speciesForm = speciesDataRegistry.getSpecies(SpeciesId.CHARIZARD).forms[megaX];
      expect(getPokemonFlameColor(pikachu)).toBe("blue");
      pikachu.summonData.speciesForm = null;
      expect(getPokemonFlameColor(pikachu)).toBeUndefined();

      // under Illusion the flames follow the disguise: Pikachu as Chandelure is purple, Mega Charizard Y as Pikachu orange
      const disguise = (species: SpeciesId) => ({ species, formIndex: 0 }) as never; // the fields getSpeciesForm reads
      pikachu.summonData.illusion = disguise(SpeciesId.CHANDELURE);
      expect(getPokemonFlameColor(pikachu)).toBe("purple");
      charizard.summonData.illusion = disguise(SpeciesId.PIKACHU);
      expect(getPokemonFlameColor(charizard)).toBeUndefined();
      pikachu.summonData.illusion = null;
      charizard.summonData.illusion = null;
    });

    it("draws a move animation with the copy only when it is loaded and the used type is Fire", async () => {
      await game.classicMode.startBattle(SpeciesId.CHARIZARD);
      const megaX = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      await useRealAnims(MoveId.FLAMETHROWER, MoveId.OUTRAGE);

      const flamethrower = new MoveAnim(MoveId.FLAMETHROWER, megaX, enemy.getBattlerIndex()).withMoveType(
        PokemonType.FIRE,
      );
      const config = flamethrower.getAnim();
      expect(config.graphic).toBe("PRAS- Fire");
      expect(flamethrower.getFlameGraphicKey()).toBe("PRAS- Fire (blue)");

      const exists = vi.spyOn(globalScene.textures, "exists");
      exists.mockReturnValue(true);
      expect(flamethrower["getGraphicKey"](config)).toBe("PRAS- Fire (blue)");
      // the copy failed to load: the original sheet
      exists.mockReturnValue(false);
      expect(flamethrower["getGraphicKey"](config)).toBe("PRAS- Fire");

      exists.mockReturnValue(true);
      // a Fire move used as another type (Normalize, Electrify...) and a type-less MoveAnim keep the original
      const asNormal = new MoveAnim(MoveId.FLAMETHROWER, megaX, enemy.getBattlerIndex()).withMoveType(
        PokemonType.NORMAL,
      );
      expect(asNormal["getGraphicKey"](config)).toBe("PRAS- Fire");
      const untyped = new MoveAnim(MoveId.FLAMETHROWER, megaX, enemy.getBattlerIndex());
      expect(untyped.getFlameGraphicKey()).toBeUndefined();
      // Outrage shares the sheet; as a Dragon move it stays orange, made Fire it turns blue
      const outrage = new MoveAnim(MoveId.OUTRAGE, megaX, enemy.getBattlerIndex());
      expect(outrage.withMoveType(PokemonType.DRAGON).getFlameGraphicKey()).toBeUndefined();
      expect(outrage.withMoveType(PokemonType.FIRE).getFlameGraphicKey()).toBe("PRAS- Fire (blue)");
      // the enemy's Fire move: no colour
      const enemyFlamethrower = new MoveAnim(MoveId.FLAMETHROWER, enemy, megaX.getBattlerIndex()).withMoveType(
        PokemonType.FIRE,
      );
      expect(enemyFlamethrower.getFlameGraphicKey()).toBeUndefined();
    });

    it("loads a missing copy before the animation plays, and plays at once when it is there", async () => {
      await game.classicMode.startBattle(SpeciesId.CHARIZARD);
      const megaX = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      await useRealAnims(MoveId.FLAMETHROWER);
      settings.update("display", "enableMoveAnimations", true);

      const basePlay = vi.spyOn(BattleAnim.prototype, "play").mockImplementation((_sub, callback) => callback?.());
      const loadSheet = vi.spyOn(globalScene, "loadSpritesheet");
      const exists = vi.spyOn(globalScene.textures, "exists").mockReturnValue(false);

      const done = vi.fn();
      new MoveAnim(MoveId.FLAMETHROWER, megaX, enemy.getBattlerIndex())
        .withMoveType(PokemonType.FIRE)
        .play(false, done);
      // not played yet: the copy loads first
      expect(basePlay).not.toHaveBeenCalled();
      expect(loadSheet).toHaveBeenCalledWith("PRAS- Fire (blue)", "battle_anims", 96);
      await vi.waitFor(() => expect(done).toHaveBeenCalledOnce());
      expect(basePlay).toHaveBeenCalledOnce();

      // loaded: no load, played at once
      loadSheet.mockClear();
      basePlay.mockClear();
      exists.mockReturnValue(true);
      const done2 = vi.fn();
      new MoveAnim(MoveId.FLAMETHROWER, megaX, enemy.getBattlerIndex())
        .withMoveType(PokemonType.FIRE)
        .play(false, done2);
      expect(loadSheet).not.toHaveBeenCalled();
      expect(done2).toHaveBeenCalledOnce();

      // move animations off: nothing loads
      exists.mockReturnValue(false);
      settings.update("display", "enableMoveAnimations", false);
      const done3 = vi.fn();
      new MoveAnim(MoveId.FLAMETHROWER, megaX, enemy.getBattlerIndex())
        .withMoveType(PokemonType.FIRE)
        .play(false, done3);
      expect(loadSheet).not.toHaveBeenCalled();
      expect(done3).toHaveBeenCalledOnce();
    });

    it("queues the copies of a Pokémon's Fire moves with its assets", async () => {
      await game.classicMode.startBattle(SpeciesId.CHARIZARD);
      const megaX = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      await useRealAnims(MoveId.FLAMETHROWER, MoveId.FIRE_PUNCH, MoveId.OUTRAGE, MoveId.MAX_FLARE, MoveId.HEAT_WAVE);
      vi.spyOn(globalScene.textures, "exists").mockReturnValue(false);
      const loadSheet = vi.spyOn(globalScene, "loadSpritesheet");

      const queued = (moveIds: MoveId[], user: Pokemon): string[] => {
        loadSheet.mockClear();
        queueFlameAnimAssets(moveIds, user);
        return loadSheet.mock.calls.map(([key]) => key);
      };
      expect(queued([MoveId.FLAMETHROWER, MoveId.FIRE_PUNCH, MoveId.MAX_FLARE, MoveId.HEAT_WAVE], megaX)).toEqual([
        "PRAS- Fire (blue)",
        "PRAS- Elemental Punch (blue)",
        "CFRU- Max Flare (blue)",
      ]);
      // a Dragon move on the same sheet, and a Pokémon not in the table: nothing
      expect(queued([MoveId.OUTRAGE], megaX)).toEqual([]);
      expect(queued([MoveId.FLAMETHROWER], enemy)).toEqual([]);

      // through `loadMoveAnimations`, as `Pokemon.loadAssets` calls it
      loadSheet.mockClear();
      await loadMoveAnimations([MoveId.FLAMETHROWER], megaX);
      expect(loadSheet.mock.calls.map(([key]) => key)).toContain("PRAS- Fire (blue)");
      loadSheet.mockClear();
      await loadMoveAnimations([MoveId.FLAMETHROWER]);
      expect(loadSheet.mock.calls.map(([key]) => key)).not.toContain("PRAS- Fire (blue)");

      // and through `Pokemon.loadAssets` itself, which a Mega Evolution / form change, Transform and Illusion call
      // (review 2026-11-20: nothing checked that it passes the Pokémon). The copies count as not loaded yet; every
      // other texture is what the scene really has.
      vi.mocked(globalScene.textures.exists).mockRestore();
      const realExists = globalScene.textures.exists.bind(globalScene.textures);
      vi.spyOn(globalScene.textures, "exists").mockImplementation(key => !key.endsWith(")") && realExists(key));
      game.move.changeMoveset(megaX, [MoveId.FLAMETHROWER, MoveId.OUTRAGE]);
      loadSheet.mockClear();
      await megaX.loadAssets();
      const loadedKeys = loadSheet.mock.calls.map(([key]) => key);
      expect(loadedKeys).toContain("PRAS- Fire (blue)");
      expect(loadedKeys.filter(key => key.endsWith(")"))).toEqual(["PRAS- Fire (blue)"]);
    });

    it("passes the used type to the animation: a Fire move and a G-Max Wildfire of Mega Charizard X", async () => {
      await game.classicMode.startBattle(SpeciesId.CHARIZARD);
      const megaX = game.field.getPlayerPokemon();
      game.move.changeMoveset(megaX, [MoveId.FLAMETHROWER, MoveId.DRAGON_CLAW, MoveId.EMBER]);
      // a Dynamax Candy gives any Charizard's Fire slot G-Max Wildfire, whose own sheet has copies
      expect(game.scene.addModifier(modifierTypes.DYNAMAX_CANDY().newModifier(megaX, 2)!)).toBe(true);
      expect(megaX.moveset[2].getMove().id).toBe(MoveId.G_MAX_WILDFIRE);
      expect(getMoveFlameGraphicKey("CFRU- G-Max Wildfire", megaX, megaX.getMoveType(megaX.moveset[2].getMove()))).toBe(
        "CFRU- G-Max Wildfire (blue)",
      );
      const play = vi.spyOn(MoveAnim.prototype, "play");

      game.move.select(MoveId.FLAMETHROWER);
      await game.toNextTurn();
      game.move.select(MoveId.DRAGON_CLAW);
      await game.toNextTurn();
      game.move.select(MoveId.EMBER);
      await game.toNextTurn();

      const played = play.mock.contexts.map(anim => [(anim as MoveAnim).move, (anim as MoveAnim).moveType]);
      expect(played).toContainEqual([MoveId.FLAMETHROWER, PokemonType.FIRE]);
      expect(played).toContainEqual([MoveId.DRAGON_CLAW, PokemonType.DRAGON]);
      expect(played).toContainEqual([MoveId.G_MAX_WILDFIRE, PokemonType.FIRE]);
    });
  });
});
