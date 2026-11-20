/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { speciesDataRegistry } from "#app/global-species-data-registry";
import { allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { Button } from "#enums/buttons";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { ShopCursorTarget } from "#enums/shop-cursor-target";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import { getCustomModifierClass, getVestMoveDeniedText } from "#modifiers/custom-held-items";
import * as Modifier from "#modifiers/modifier";
import { DynamaxCandyModifierType, type ModifierTypeGenerator, ZCrystalModifierType } from "#modifiers/modifier-type";
import {
  getConversionBlockReason,
  getDynamaxCandyWeight,
  getZCrystalCandidates,
  getZRingWeight,
  hasZRing,
  MoveConversionModifier,
  Z_TYPE_CRYSTAL_ICONS,
  Z_TYPE_CRYSTAL_TYPES,
  ZMAX_REWARD_RULES,
  ZRingModifier,
} from "#modifiers/zmax-items";
import { getConversionResult, getTransformedMove, type MoveTransform } from "#moves/move-transform";
import { PokemonMove } from "#moves/pokemon-move";
import { EXCLUSIVE_Z } from "#moves/zmax-data";
import { GameManager } from "#test/framework/game-manager";
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import type { ConfirmUiHandler } from "#ui/confirm-ui-handler";
import { getItemIconScale, ITEM_ICON_SOURCE_SIZE, POKESPRITE_ITEM_ICONS } from "#ui/item-icon-scale";
import type { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import { getMoveConversionLabel } from "#ui/move-conversion-picker";
import type { OptionSelectUiHandler } from "#ui/option-select-ui-handler";
import { PartyUiHandler } from "#ui/party-ui-handler";
import { getModifierPoolForType } from "#utils/modifier-utils";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const koFiles = import.meta.glob("../../../locales/ko/**/*.json", { eager: true, import: "default" });

/** RGBA pixels of a PNG (row by row, 4 bytes a pixel; fully transparent pixels made 0,0,0,0) */
interface PngImage {
  width: number;
  height: number;
  rgba: Uint8Array;
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

/** Undoes the per-row filters of a PNG's inflated image data */
function unfilterPng(raw: Uint8Array, stride: number, height: number, bpp: number): Uint8Array {
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
  return rows;
}

/**
 * Local fork (2026-11-16): decodes the PNGs the item icons use (no decoder in the repository): non-interlaced, 8-bit
 * RGBA (`items.png`) or 1/2/4/8-bit palette with tRNS (the loose copies in `assets/images/items/`)
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
  const rows = unfilterPng(
    inflateSync(Buffer.concat(chunks.get("IDAT")!)),
    stride,
    height,
    Math.max(1, bitsPerPixel / 8),
  );
  /** One pixel's RGBA: straight from the row, or its palette entry */
  const pixel = (x: number, y: number): ArrayLike<number> => {
    if (rgbaFile) {
      return rows.subarray(y * stride + x * 4, y * stride + x * 4 + 4);
    }
    const bit = x * depth;
    const index = (rows[y * stride + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    return [...palette!.subarray(index * 3, index * 3 + 3), index < alphas.length ? alphas[index] : 255];
  };
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = pixel(x, y);
      // fully transparent pixels made plain
      rgba.set(value[3] === 0 ? [0, 0, 0, 0] : value, (y * width + x) * 4);
    }
  }
  return { width, height, rgba };
}

/** A `w` x `h` piece of an image at (`x`, `y`) */
function cropPng(image: PngImage, x: number, y: number, w: number, h: number): PngImage {
  const rgba = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row++) {
    const start = ((y + row) * image.width + x) * 4;
    rgba.set(image.rgba.subarray(start, start + w * 4), row * w * 4);
  }
  return { width: w, height: h, rgba };
}

/** The box of an image's opaque pixels (alpha 128 or more), as `[x, y, width, height]` */
function opaqueBox(image: PngImage): [number, number, number, number] {
  let [x0, y0, x1, y1] = [image.width, image.height, -1, -1];
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.rgba[(y * image.width + x) * 4 + 3] >= 128) {
        [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      }
    }
  }
  return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

/**
 * Local fork (2026-11-16): the rewards of the Z-Moves and Max Moves: Z링, 다이사탕 and the Z crystals. The user:
 * "다이맥스한 포켓몬이 있을 경우 다이사탕(하이퍼)이 보상 테이블에서 나올 수 있음 / 다이사탕 사용 시 원하는 기술을 다이 기술로
 * 바꿈 / 해당 포켓몬의 전용기는 거다이 기술로 바꿈 (멜메탈: 불릿펀치 -> 다이스틸, 더블펀처 -> 거다이융격)" and "z링 보유 시 +
 * 해당 타입 기술 보유 포켓몬이 있는 경우(거다이맥스 기술 제외) Z 크리스탈이 보상 테이블에 등록됨 / z 크리스탈 사용 시 해당
 * 타입 기술을 z기술로 변환 / 전용 z 크리스탈은 해당 타입의 기술을 전용 z기술로 변환".
 */
describe("Custom items - Z-Ring, Dynamax Candy, Z crystals (Z링 / 다이사탕 / Z크리스탈)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  /** UI waits: the reward screen animates for over a second, the party screen fades in */
  const WAIT = { timeout: 15_000, interval: 10 };

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingLevel(100)
      .startingWave(3)
      .disableTrainerWaves()
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(5)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .hasPassiveAbility(false)
      .moveset([MoveId.SPLASH]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const ui = () => game.scene.ui;
  const rewardHandler = () => ui().handlers[UiMode.MODIFIER_SELECT] as ModifierSelectUiHandler;
  const partyHandler = () => ui().handlers[UiMode.PARTY] as PartyUiHandler;
  const optionHandler = () => ui().handlers[UiMode.OPTION_SELECT] as OptionSelectUiHandler;
  const confirmHandler = () => ui().handlers[UiMode.CONFIRM] as ConfirmUiHandler;
  const optionLabels = () => (optionHandler()["options"] as { label: string }[]).map(o => o.label);
  const optionIndex = () => optionHandler().getCursor() + optionHandler()["scrollCursor"];
  const cancelLabel = () => i18next.t("menu:cancel");

  function poolEntry(tier: ModifierTier, id: string) {
    return getModifierPoolForType(ModifierPoolType.PLAYER)[tier].find(w => w.modifierType.id === id);
  }

  /** Win the wave (the active Pokémon uses its first move) and wait on the reward screen (reward 0 is `id`) */
  async function toRewardScreen(id: string): Promise<void> {
    game.move.select(game.field.getPlayerPokemon().moveset[0].moveId);
    await game.doKillOpponents();
    await game.phaseInterceptor.to("SelectModifierPhase");
    await vi.waitFor(() => {
      expect(ui().mode).toBe(UiMode.MODIFIER_SELECT);
      expect(rewardHandler()["awaitingActionInput"]).toBe(true);
    }, WAIT);
    expect(rewardHandler().options[0].modifierTypeOption.type.id).toBe(id);
  }

  /** Pick reward 0 and wait for the party screen */
  async function pickReward(): Promise<void> {
    const rewards = rewardHandler();
    rewards.setRowCursor(ShopCursorTarget.REWARDS);
    rewards.setCursor(0);
    expect(rewards.processInput(Button.ACTION)).toBe(true);
    await waitForParty();
  }

  async function waitForParty(): Promise<void> {
    await vi.waitFor(() => {
      expect(ui().mode).toBe(UiMode.PARTY);
      expect(partyHandler().active).toBe(true);
    }, WAIT);
  }

  /** On the party screen: party slot `slot`, then "Use" */
  function useOn(slot: number): void {
    const party = partyHandler();
    party.setCursor(slot);
    party.processInput(Button.ACTION); // the Pokémon's options
    party.processInput(Button.ACTION); // Use
  }

  async function waitForList(labels: string[]): Promise<void> {
    await vi.waitFor(() => {
      expect(ui().mode).toBe(UiMode.OPTION_SELECT);
      expect(optionHandler().active).toBe(true);
      expect(optionLabels()).toEqual(labels);
    }, WAIT);
  }

  async function waitForConfirm(): Promise<void> {
    await vi.waitFor(() => {
      expect(ui().mode).toBe(UiMode.CONFIRM);
      expect(confirmHandler().active).toBe(true);
    }, WAIT);
  }

  /** Moves the list cursor to option `index` (down, wrapping) and presses A */
  function choose(index: number): void {
    const handler = optionHandler();
    for (let n = 0; n < optionLabels().length && optionIndex() !== index; n++) {
      handler.processInput(Button.DOWN);
    }
    expect(optionIndex()).toBe(index);
    handler.processInput(Button.ACTION);
  }

  /** The label the picker shows for move `index` of `pokemon` with `result` ("<now> → <result>") */
  function label(pokemon: Pokemon, index: number, result: MoveTransform): string {
    return getMoveConversionLabel(pokemon.moveset[index], result);
  }

  function setGmaxForm(pokemon: Pokemon): void {
    pokemon.formIndex = pokemon.species.forms.findIndex(f => f.formKey === SpeciesFormKey.GIGANTAMAX);
    expect(pokemon.isMax()).toBe(true);
  }

  function noConversionItemUsed(): void {
    expect(game.scene.modifiers.some(m => m instanceof MoveConversionModifier)).toBe(false);
    for (const p of game.scene.getPlayerParty()) {
      expect(
        p.moveset.every(m => m.transform === undefined),
        p.name,
      ).toBe(true);
    }
  }

  it("has its icons (32x32 frames), Korean / English text, rules and pool entries", () => {
    const atlas = JSON.parse(readFileSync("./assets/images/items.json", "utf8")).textures[0].frames as {
      filename: string;
      sourceSize: { w: number; h: number };
      trimmed: boolean;
    }[];
    const icons = [
      "z_ring",
      "dynamax_candy",
      ...Z_TYPE_CRYSTAL_TYPES.map(t => Z_TYPE_CRYSTAL_ICONS[t]!),
      ...EXCLUSIVE_Z.map(info => info.icon),
    ];
    expect(new Set(icons).size).toBe(2 + 18 + 16);
    for (const icon of icons) {
      const frame = atlas.find(f => f.filename === icon);
      expect(frame?.sourceSize, icon).toEqual({ w: 32, h: 32 });
      expect(frame?.trimmed, icon).toBe(false);
    }
    // Necrozma's form change item keeps its own frame; the reward crystal has a new one
    expect(atlas.filter(f => f.filename === "ultranecrozium_z")).toHaveLength(1);

    expect(modifierTypes.Z_RING().iconImage).toBe("z_ring");
    expect(modifierTypes.DYNAMAX_CANDY().iconImage).toBe("dynamax_candy");
    expect(new ZCrystalModifierType(PokemonType.FIRE).iconImage).toBe("firium_z");
    expect(new ZCrystalModifierType("PIKANIUM_Z").iconImage).toBe("pikanium_z");

    const ko = JSON.parse(readFileSync("./locales/ko/modifier-type.json", "utf8"));
    const en = JSON.parse(readFileSync("./locales/en/modifier-type.json", "utf8"));
    expect(ko.ModifierType.Z_RING.name).toBe("Z링");
    expect(en.ModifierType.Z_RING.name).toBe("Z-Ring");
    expect(ko.ModifierType.DYNAMAX_CANDY.name).toBe("다이사탕");
    expect(en.ModifierType.DYNAMAX_CANDY.name).toBe("Dynamax Candy");
    expect(ko.ModifierType.Z_CRYSTAL.name).toBe("{{typeName}}Z");
    for (const text of [ko, en]) {
      for (const id of ["Z_RING", "DYNAMAX_CANDY", "Z_CRYSTAL"]) {
        expect(text.ModifierType[id].description, id).toBeTruthy();
      }
      for (const id of ["DYNAMAX_CANDY", "Z_CRYSTAL"]) {
        expect(text.ModifierType[id].chooseMove && text.ModifierType[id].confirm, id).toBeTruthy();
      }
      // Local fork (2026-11-20): + `sketch` (F1 Q8) and `noZPower` (F1 Q9); the candy's party-screen text (F1 Q1) is
      // `notDynamaxed` beside the reasons, which are the move picker's
      expect([...Object.keys(text.ModifierType.DYNAMAX_CANDY.reason)].sort()).toEqual([
        "cannot",
        "converted",
        "maxMove",
        "sketch",
      ]);
      expect([...Object.keys(text.ModifierType.Z_CRYSTAL.reason)].sort()).toEqual(
        ["cannot", "gmax", "maxMove", "noZPower", "sketch", "wrongSpecies", "wrongType", "zMove"].sort(),
      );
      expect(text.ModifierType.DYNAMAX_CANDY.notDynamaxed).toBeTruthy();
      expect([...Object.keys(text.ZCrystal)].sort()).toEqual(EXCLUSIVE_Z.map(info => info.key).sort());
    }
    expect(Object.keys(en.ModifierType.Z_CRYSTAL.typeCrystal)).toEqual(Z_TYPE_CRYSTAL_TYPES.map(t => PokemonType[t]));
    expect(ko.ZCrystal.PIKANIUM_Z).toBe("피카츄Z");
    expect(ko.ZCrystal.ULTRANECROZIUM_Z_CRYSTAL).toBe("울트라네크로Z 결정");
    expect(en.ZCrystal.PIKANIUM_Z).toBe("Pikanium Z");

    // the numbers (design_spec section 7b) and the pool entries
    expect(Object.isFrozen(ZMAX_REWARD_RULES)).toBe(true);
    expect(ZMAX_REWARD_RULES.dynamaxCandy.weight).toBe(6);
    expect(ZMAX_REWARD_RULES.zCrystal).toEqual({ weight: 8, typeCap: 3, exclusiveMultiplier: 3 });
    expect([1, 50, 51, 150, 151, 5000].map(getZRingWeight)).toEqual([9, 9, 18, 27, 36, 36]);
    expect(poolEntry(ModifierTier.ROGUE, "Z_RING")?.maxWeight).toBe(36);
    expect(poolEntry(ModifierTier.ULTRA, "DYNAMAX_CANDY")?.maxWeight).toBe(6);
    expect(poolEntry(ModifierTier.ULTRA, "Z_CRYSTAL")?.maxWeight).toBe(8);
    expect(getCustomModifierClass("ZRingModifier")).toBe(ZRingModifier);
  });

  // Local fork (2026-11-16): the icons were Cobblemon: Mega Showdown's 16x16 textures scaled 2x, from the user's
  // Cobbleverse modpack (tools/port_zmax_1116/make_cobbleverse_icons.py), drawn smaller (boxes 28x28, 32x32 and 32x18).
  // Local fork (2026-11-18): PokéSprite's 32x32 originals now (tools/port/install_pokesprite_icons.py; the user: "아이콘
  // 화풍은 포케스프라이트로 통일"), drawn at 1: z-ring.png, dynamax-candy.png and z-crystals/<name>-z--bag.png, whose type
  // crystals are 24x13 and whose spiky exclusive crystals (Kommo-o, Lycanroc, Mimikyu, the Necrozma three) are 28x13
  it("has PokéSprite's icons in the atlas and as loose copies, drawn at 1", () => {
    const atlas = JSON.parse(readFileSync("./assets/images/items.json", "utf8")).textures[0].frames as {
      filename: string;
      frame: { x: number; y: number; w: number; h: number };
    }[];
    const sheet = decodePng(readFileSync("./assets/images/items.png"));
    const spiky = new Set([
      "kommonium_z",
      "lycanium_z",
      "mimikium_z",
      "solganium_z",
      "lunalium_z",
      "ultranecrozium_z_crystal",
    ]);
    const icons: [icon: string, box: [number, number, number, number]][] = [
      ["z_ring", [6, 6, 22, 22]],
      ["dynamax_candy", [6, 6, 20, 21]],
      ...[...Z_TYPE_CRYSTAL_TYPES.map(t => Z_TYPE_CRYSTAL_ICONS[t]!), ...EXCLUSIVE_Z.map(info => info.icon)].map(
        icon =>
          [icon, spiky.has(icon) ? [2, 9, 28, 13] : [4, 10, 24, 13]] as [string, [number, number, number, number]],
      ),
    ];
    expect(icons).toHaveLength(2 + 18 + 16);
    for (const [icon, box] of icons) {
      const { x, y, w, h } = atlas.find(f => f.filename === icon)!.frame;
      expect([w, h], icon).toEqual([ITEM_ICON_SOURCE_SIZE, ITEM_ICON_SOURCE_SIZE]);
      const frame = cropPng(sheet, x, y, w, h);
      expect(opaqueBox(frame), icon).toEqual(box);
      // hard alpha, like the fork's other icons
      expect(
        frame.rgba.filter((v, i) => i % 4 === 3 && v !== 0 && v !== 255),
        icon,
      ).toHaveLength(0);
      const loose = decodePng(readFileSync(`./assets/images/items/${icon}.png`));
      expect([loose.width, loose.height], icon).toEqual([w, h]);
      expect(Buffer.from(loose.rgba).equals(Buffer.from(frame.rgba)), `${icon}: loose copy = atlas frame`).toBe(true);
      expect(getItemIconScale(icon), icon).toBe(1);
      expect(POKESPRITE_ITEM_ICONS.has(icon), icon).toBe(true);
    }
    // the official crystal of Necrozma's form change keeps PokeRogue's own pixels (trimmed 30x15) and scale
    const necrozma = atlas.find(f => f.filename === "ultranecrozium_z")!.frame;
    expect([necrozma.w, necrozma.h]).toEqual([30, 15]);
    expect(getItemIconScale("ultranecrozium_z")).toBe(1);
  });

  it("names the crystals 노말Z / 불꽃Z ... and 피카츄Z ... in Korean, Firium Z ... in English", async () => {
    expect(new ZCrystalModifierType(PokemonType.FIRE).name).toBe("Firium Z");
    expect(new ZCrystalModifierType(PokemonType.NORMAL).name).toBe("Normalium Z");
    expect(new ZCrystalModifierType("ULTRANECROZIUM_Z_CRYSTAL").name).toBe("Ultranecrozium Z Crystal");
    // Korean text straight into i18next (as custom-dark-strong-stuff.test.ts does): the test backend serves English only
    const { loadPath } = i18next.options.backend as { loadPath: (lng: string, ns: string[]) => string };
    for (const ns of i18next.options.ns as readonly string[]) {
      const file = /locales\/ko\/(.+?\.json)/.exec(loadPath("ko", [ns]))?.[1];
      const json = file ? koFiles[`../../../locales/ko/${file}`] : undefined;
      if (json) {
        i18next.addResourceBundle("ko", ns, json, true, true);
      }
    }
    await i18next.changeLanguage("ko");
    try {
      for (const s of speciesDataRegistry.getAllSpecies()) {
        s.localize();
      }
      for (const m of allMoves) {
        m.localize();
      }
      expect(new ZCrystalModifierType(PokemonType.NORMAL).name).toBe("노말Z");
      expect(new ZCrystalModifierType(PokemonType.FIRE).name).toBe("불꽃Z");
      expect(new ZCrystalModifierType(PokemonType.FAIRY).name).toBe("페어리Z");
      expect(new ZCrystalModifierType("PIKANIUM_Z").name).toBe("피카츄Z");
      expect(new ZCrystalModifierType("KOMMONIUM_Z").name).toBe("짜랑고우거Z");
      for (const type of [
        new ZCrystalModifierType(PokemonType.ELECTRIC),
        new ZCrystalModifierType("TAPUNIUM_Z"),
        new DynamaxCandyModifierType("modifierType:ModifierType.DYNAMAX_CANDY", "dynamax_candy"),
        modifierTypes.Z_RING(),
      ]) {
        const description = type.getDescription();
        expect(description, type.name).toBeTruthy();
        expect(description, type.name).not.toMatch(/\{\{|\[\[|modifierType:/);
      }
      expect(new ZCrystalModifierType(PokemonType.ELECTRIC).getDescription()).toContain(
        allMoves[MoveId.GIGAVOLT_HAVOC__PHYSICAL].name,
      );
    } finally {
      await i18next.changeLanguage("en");
      for (const s of speciesDataRegistry.getAllSpecies()) {
        s.localize();
      }
      for (const m of allMoves) {
        m.localize();
      }
    }
  });

  // Local fork (2026-11-20), F1 Q1 (the user: "다이맥스한 포켓몬만 센다"): only a Dynamaxed Pokémon's own moves count
  it("offers the Dynamax Candy only while a Dynamaxed party member has a move it can take", async () => {
    await game.classicMode.startBattle(SpeciesId.MELMETAL, SpeciesId.PIKACHU);
    const party = game.scene.getPlayerParty();
    const [melmetal, pikachu] = party;
    game.move.changeMoveset(melmetal, [MoveId.BULLET_PUNCH, MoveId.DOUBLE_IRON_BASH]);
    game.move.changeMoveset(pikachu, [MoveId.THUNDERBOLT]);
    const weight = poolEntry(ModifierTier.ULTRA, "DYNAMAX_CANDY")!.weight as WeightedModifierTypeWeightFunc;

    // nobody Dynamaxed
    expect(getDynamaxCandyWeight(party)).toBe(0);
    expect(weight(party, 0)).toBe(0);

    // Melmetal in its G-Max form: offered for its own moves
    setGmaxForm(melmetal);
    expect(weight(party, 0)).toBe(ZMAX_REWARD_RULES.dynamaxCandy.weight);

    // every move of Melmetal, the only Dynamaxed one, already a Max Move: no longer offered, though Pikachu's
    // Thunderbolt could take it (before 11-20 it still was)
    melmetal.moveset[0].transform = { kind: "max", moveId: MoveId.MAX_STEELSPIKE };
    melmetal.moveset[1].transform = { kind: "gmax", moveId: MoveId.G_MAX_MELTDOWN };
    expect(weight(party, 0)).toBe(0);
    expect(pikachu.moveset[0].transform).toBeUndefined();
  });

  it("offers Z crystals only with the Z-Ring and an eligible move, and draws only eligible crystals", async () => {
    await game.classicMode.startBattle(SpeciesId.PIKACHU, SpeciesId.SNORLAX);
    const party = game.scene.getPlayerParty();
    const [pikachu, snorlax] = party;
    game.move.changeMoveset(pikachu, [MoveId.THUNDERBOLT, MoveId.THUNDER, MoveId.SPARK, MoveId.SPLASH]);
    game.move.changeMoveset(snorlax, [MoveId.BODY_SLAM]);
    const weight = poolEntry(ModifierTier.ULTRA, "Z_CRYSTAL")!.weight as WeightedModifierTypeWeightFunc;
    const generator = modifierTypes.Z_CRYSTAL() as ModifierTypeGenerator;

    // no Z-Ring: never offered, and the generator gives nothing
    expect(hasZRing()).toBe(false);
    expect(weight(party, 0)).toBe(0);
    expect(generator.generateType(party)).toBeNull();
    // a fixed crystal (encounters, overrides, tests) still works
    expect((generator.generateType(party, [PokemonType.FIRE]) as ZCrystalModifierType).crystal).toBe(PokemonType.FIRE);
    expect((generator.generateType(party, ["MEWNIUM_Z"]) as ZCrystalModifierType).crystal).toBe("MEWNIUM_Z");

    game.scene.addModifier(modifierTypes.Z_RING().withIdFromFunc(modifierTypes.Z_RING).newModifier()!);
    expect(hasZRing()).toBe(true);
    expect(weight(party, 0)).toBe(ZMAX_REWARD_RULES.zCrystal.weight);

    // Electric: 3 moves, capped at 3; Normal: Splash (a Z status move) + Body Slam = 2; Pikanium Z: 3 Electric moves x 3
    // (Splash is Normal, so it does not count for Pikanium Z); Snorlium Z: Body Slam x 3
    expect(Object.fromEntries(getZCrystalCandidates(party))).toEqual({
      [PokemonType.ELECTRIC]: 3,
      [PokemonType.NORMAL]: 2,
      PIKANIUM_Z: 9,
      SNORLIUM_Z: 3,
    });
    const drawn = new Set<unknown>();
    for (let i = 0; i < 60; i++) {
      const type = generator.generateType(party) as ZCrystalModifierType;
      expect(type).toBeInstanceOf(ZCrystalModifierType);
      expect(type.group).toBe("z_crystal");
      drawn.add(type.crystal);
    }
    expect([...drawn].every(c => getZCrystalCandidates(party).has(c as PokemonType | string))).toBe(true);
    expect(drawn.size).toBeGreaterThan(1);

    // G-Max Moves never take a crystal ("거다이맥스 기술 제외"); a Max Move takes its type's crystal (Z다이)
    pikachu.moveset[0].transform = { kind: "gmax", moveId: MoveId.G_MAX_VOLT_CRASH };
    pikachu.moveset[1].transform = { kind: "max", moveId: MoveId.MAX_LIGHTNING };
    expect(getConversionBlockReason(pikachu, pikachu.moveset[0], { kind: "zType", type: PokemonType.ELECTRIC })).toBe(
      "gmax",
    );
    expect(Object.fromEntries(getZCrystalCandidates(party))).toEqual({
      [PokemonType.ELECTRIC]: 2,
      [PokemonType.NORMAL]: 2,
      PIKANIUM_Z: 3,
      SNORLIUM_Z: 3,
    });

    // nothing eligible anywhere: weight 0 and no crystal
    for (const p of party) {
      for (const slot of p.moveset) {
        slot.transform = { kind: "zMax", moveId: MoveId.MAX_STRIKE };
      }
    }
    expect(getZCrystalCandidates(party).size).toBe(0);
    expect(weight(party, 0)).toBe(0);
    expect(generator.generateType(party)).toBeNull();
  });

  it("saves the Z-Ring with the session, one at most", async () => {
    game.override.startingModifier([{ name: "Z_RING" }]);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    expect(hasZRing()).toBe(true);
    const ring = game.scene.getModifiers(ZRingModifier)[0];
    expect(ring.getMaxStackCount()).toBe(1);
    const { gameData } = game.scene;
    const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
    const saved = gameData.parseSessionData(json).modifiers.find(m => m.typeId === "Z_RING")!;
    expect(saved.className).toBe("ZRingModifier");
    // biome-ignore lint/performance/noDynamicNamespaceImportAccess: the session loader looks classes up by name here
    expect(saved.toModifier(Modifier[saved.className])).toBeInstanceOf(ZRingModifier);
  });

  it("type crystal: reward -> party -> the moves as 'now → result' -> yes converts the chosen move and is used up", async () => {
    game.override.itemRewards([{ name: "Z_CRYSTAL", type: PokemonType.ELECTRIC }]);
    await game.classicMode.startBattle(SpeciesId.PIKACHU, SpeciesId.SNORLAX);
    const pikachu = game.field.getPlayerPokemon();
    game.move.changeMoveset(pikachu, [MoveId.SPLASH, MoveId.THUNDERBOLT]);
    const item = { kind: "zType", type: PokemonType.ELECTRIC } as const;
    const result = getConversionResult(pikachu, pikachu.moveset[1], item)!;
    expect(result).toEqual({ kind: "z", moveId: MoveId.GIGAVOLT_HAVOC__SPECIAL });

    await toRewardScreen("Z_CRYSTAL");
    await pickReward();
    const shown = vi.spyOn(partyHandler(), "showText");
    useOn(0);

    // Splash (Normal) is greyed and says why; the cursor starts on Thunderbolt
    const labels = [pikachu.moveset[0].getName(), label(pikachu, 1, result), cancelLabel()];
    await waitForList(labels);
    expect(labels[1]).toBe(`${allMoves[MoveId.THUNDERBOLT].name} → ${allMoves[MoveId.GIGAVOLT_HAVOC__SPECIAL].name}`);
    expect(optionIndex()).toBe(1);
    const wrongType = i18next.t("modifierType:ModifierType.Z_CRYSTAL.reason.wrongType", {
      typeName: i18next.t("pokemonInfo:type.electric"),
    });
    choose(0);
    expect(shown).toHaveBeenCalledWith(wrongType, 0);
    expect(ui().mode).toBe(UiMode.OPTION_SELECT);
    noConversionItemUsed();

    choose(1);
    await waitForConfirm();
    noConversionItemUsed(); // nothing is used before yes
    confirmHandler().processInput(Button.ACTION); // yes
    await vi.waitFor(() => expect(pikachu.moveset[1].transform).toEqual(result), WAIT);
    expect(pikachu.moveset[0].transform).toBeUndefined();
    expect(pikachu.moveset[1].moveId).toBe(MoveId.THUNDERBOLT);
    expect(pikachu.moveset[1].getMove()).toBe(getTransformedMove(MoveId.THUNDERBOLT, result));
    await vi.waitFor(() => expect(game.isCurrentPhase("SelectModifierPhase")).toBe(false), WAIT);
    expect(game.scene.phaseManager.hasPhaseOfType("SelectModifierPhase")).toBe(false);
    const saved = game.scene.gameData.getSessionSaveData().party[0];
    expect(saved.moveset[1].transform).toEqual(result);
  });

  it("Dynamax Candy on Melmetal: 불릿펀치 -> 다이스틸, 더블펀처 -> 거다이융격; yes converts the chosen one", async () => {
    game.override.itemRewards([{ name: "DYNAMAX_CANDY" }]);
    await game.classicMode.startBattle(SpeciesId.MELMETAL);
    const melmetal = game.field.getPlayerPokemon();
    game.move.changeMoveset(melmetal, [
      MoveId.BULLET_PUNCH,
      MoveId.DOUBLE_IRON_BASH,
      MoveId.SWORDS_DANCE,
      MoveId.PROTECT,
    ]);
    const results = melmetal.moveset.map(slot => getConversionResult(melmetal, slot, { kind: "candy" })!);
    expect(results).toEqual([
      { kind: "max", moveId: MoveId.MAX_STEELSPIKE },
      { kind: "gmax", moveId: MoveId.G_MAX_MELTDOWN },
      { kind: "max", moveId: MoveId.MAX_SWORDS_DANCE },
      { kind: "max", moveId: MoveId.MAX_GUARD },
    ]);
    // Local fork (2026-11-20), F1 Q1: only a Dynamaxed Pokémon takes the candy on the party screen
    setGmaxForm(melmetal);

    await toRewardScreen("DYNAMAX_CANDY");
    await pickReward();
    useOn(0);
    const labels = [...results.map((r, i) => label(melmetal, i, r)), cancelLabel()];
    await waitForList(labels);
    choose(1);
    await waitForConfirm();
    confirmHandler().processInput(Button.ACTION); // yes
    await vi.waitFor(() => expect(melmetal.moveset[1].transform).toEqual(results[1]), WAIT);
    expect(melmetal.moveset.filter(m => m.transform)).toHaveLength(1);
  });

  it("steps back one level at a time; cancelling the party screen returns to the rewards with nothing used", async () => {
    game.override.itemRewards([{ name: "Z_CRYSTAL", type: PokemonType.NORMAL }]);
    await game.classicMode.startBattle(SpeciesId.PIKACHU, SpeciesId.SNORLAX);
    const [pikachu, snorlax] = game.scene.getPlayerParty();
    game.move.changeMoveset(pikachu, [MoveId.THUNDERBOLT]);
    game.move.changeMoveset(snorlax, [MoveId.BODY_SLAM, MoveId.SWORDS_DANCE]);
    const item = { kind: "zType", type: PokemonType.NORMAL } as const;
    const results = snorlax.moveset.map(slot => getConversionResult(snorlax, slot, item)!);
    expect(results).toEqual([
      { kind: "z", moveId: MoveId.BREAKNECK_BLITZ__PHYSICAL },
      { kind: "z", moveId: MoveId.SWORDS_DANCE },
    ]);

    // Pikachu has no Normal move: the party screen refuses it ("no effect"); the move filter checks type and state only
    const crystal = new ZCrystalModifierType(PokemonType.NORMAL);
    expect(crystal.selectFilter!(pikachu)).toBe(PartyUiHandler.NoEffectMessage);
    expect(crystal.selectFilter!(snorlax)).toBeNull();
    expect(crystal.moveSelectFilter!(pikachu.moveset[0])).toBe(PartyUiHandler.NoEffectMessage);
    expect(crystal.moveSelectFilter!(snorlax.moveset[1])).toBeNull();

    await toRewardScreen("Z_CRYSTAL");
    await pickReward();

    // Snorlax -> Swords Dance -> no -> back on Swords Dance -> back to the party, on Snorlax
    useOn(1);
    const labels = [label(snorlax, 0, results[0]), label(snorlax, 1, results[1]), cancelLabel()];
    await waitForList(labels);
    choose(1);
    await waitForConfirm();
    confirmHandler().processInput(Button.CANCEL); // no
    await waitForList(labels);
    expect(optionIndex()).toBe(1);
    optionHandler().processInput(Button.CANCEL);
    await waitForParty();
    expect(partyHandler().getCursor()).toBe(1);

    // out of the party screen: the same rewards, nothing converted
    partyHandler().processInput(Button.CANCEL);
    await vi.waitFor(() => {
      expect(ui().mode).toBe(UiMode.MODIFIER_SELECT);
      expect(rewardHandler()["awaitingActionInput"]).toBe(true);
    }, WAIT);
    expect(game.isCurrentPhase("SelectModifierPhase")).toBe(true);
    expect(rewardHandler().options[0].modifierTypeOption.type.id).toBe("Z_CRYSTAL");
    noConversionItemUsed();
  });

  it("vests judge a converted slot by the move it became (다이월 from 명상: allowed; 다이검무, Z튀어오르기: not)", async () => {
    game.override.startingHeldItems([{ name: "ASSAULT_VEST" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const snorlax = game.field.getPlayerPokemon();
    game.move.changeMoveset(snorlax, [MoveId.CALM_MIND, MoveId.SWORDS_DANCE, MoveId.SPLASH, MoveId.PROTECT]);
    const [calmMind, swordsDance, splash] = snorlax.moveset;

    expect(getVestMoveDeniedText(snorlax, MoveId.CALM_MIND)).toBeTruthy();
    expect(getVestMoveDeniedText(snorlax, MoveId.SWORDS_DANCE)).toBeTruthy();
    expect(getVestMoveDeniedText(snorlax, MoveId.SPLASH)).toBeUndefined();

    calmMind.transform = { kind: "max", moveId: MoveId.MAX_GUARD };
    swordsDance.transform = { kind: "max", moveId: MoveId.MAX_SWORDS_DANCE };
    splash.transform = { kind: "z", moveId: MoveId.SPLASH }; // Z-Power: Attack +3
    expect(getVestMoveDeniedText(snorlax, MoveId.CALM_MIND)).toBeUndefined();
    expect(getVestMoveDeniedText(snorlax, MoveId.SWORDS_DANCE)).toBeTruthy();
    expect(getVestMoveDeniedText(snorlax, MoveId.SPLASH)).toBeTruthy();
    expect(snorlax.isMoveSelectable(MoveId.CALM_MIND)[0]).toBe(true);
    expect(snorlax.isMoveSelectable(MoveId.SWORDS_DANCE)[0]).toBe(false);
    // a called move is judged as itself when the caller passes the move used
    expect(getVestMoveDeniedText(snorlax, MoveId.CALM_MIND, new PokemonMove(MoveId.CALM_MIND))).toBeTruthy();
  });
});
