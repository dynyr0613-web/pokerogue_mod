import { modifierTypes } from "#data/data-lists";
import { Button } from "#enums/buttons";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { UiMode } from "#enums/ui-mode";
import { MysteryEncounterIntroVisuals } from "#field/mystery-encounter-intro";
import { PokemonHeldItemModifier } from "#modifiers/modifier";
import { IvCandyModifierType, type ModifierTypeGenerator, ZCrystalModifierType } from "#modifiers/modifier-type";
import { Z_TYPE_CRYSTAL_ICONS, Z_TYPE_CRYSTAL_TYPES } from "#modifiers/zmax-items";
import { EXCLUSIVE_Z } from "#moves/zmax-data";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { GameManager } from "#test/framework/game-manager";
import {
  DYNAMAX_CANDY_ICON_SCALE,
  FORK_CANDY_ICON_SCALE,
  FORK_CANDY_ICONS,
  getItemIconCentringOffset,
  getItemIconScale,
  ITEM_ICON_SCALES,
  ITEM_ICON_SOURCE_SIZE,
  IV_CANDY_ICON_SCALE,
  REWARD_ITEM_ICON_SCALE,
  SUMMARY_ITEM_ICON_SCALE,
  Z_CRYSTAL_ICON_SCALE,
  Z_CRYSTAL_ICONS,
  Z_RING_ICON_SCALE,
} from "#ui/item-icon-scale";
import type { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import { SummaryUiMode } from "#ui/summary-ui-handler";
import { readFileSync } from "node:fs";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** Scale and position of a sprite made by the test harness (a MockSprite keeps a real Phaser sprite inside) */
function spriteState(sprite: unknown): { scale: number; x: number; y: number } {
  const inner = (sprite as { phaserSprite: Phaser.GameObjects.Sprite }).phaserSprite;
  return { scale: inner.scaleX, x: inner.x, y: inner.y };
}

/** The `items` atlas sprites inside an icon container, in the order they were added */
function itemSprites(container: Phaser.GameObjects.Container): unknown[] {
  return container.getAll().filter(o => (o as { texture?: { key?: string } }).texture?.key === "items");
}

// Local fork (2026-11-08): item icons 10% smaller on the reward/shop and summary screens, the fork's candies another
// 10% wherever item icons are drawn (docs/다음_패치_메모.md §4)
describe("Custom - item icon draw scale", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingWave(1)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH])
      .disableTrainerWaves();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("scales Candy Pile by 0.9 and the IV candies by 0.75 (2026-11-11)", () => {
    expect(FORK_CANDY_ICON_SCALE).toBe(0.9);
    expect(IV_CANDY_ICON_SCALE).toBe(0.75);
    expect(REWARD_ITEM_ICON_SCALE).toBe(0.9);
    expect(SUMMARY_ITEM_ICON_SCALE).toBe(0.9);
    for (const icon of FORK_CANDY_ICONS) {
      expect(getItemIconScale(icon), icon).toBe(icon === "candy_pile" ? 0.9 : 0.75);
    }
    for (const icon of ["leftovers", "rare_candy", "rarer_candy", "candy_jar", "sitrus_berry", "life_orb", "candy"]) {
      expect(getItemIconScale(icon), icon).toBe(1);
    }
    expect(getItemIconScale(undefined)).toBe(1);
    expect(getItemIconScale(null)).toBe(1);
  });

  // Local fork (2026-11-11): the user: "펀치글러브 0.7, 목스프레이 0.6, 프리즘 0.9, 개체값사탕 0.75로 합시다"
  it("scales the glove, Throat Spray and Prism icons as the user chose", () => {
    expect(getItemIconScale("punching_glove")).toBe(0.7);
    expect(getItemIconScale("master_punching_glove")).toBe(0.7);
    expect(getItemIconScale("throat_spray")).toBe(0.6);
    // Local fork (2026-11-13): "저희 클리어참도 0.7배로 해둡시다 크기"
    expect(getItemIconScale("clear_amulet")).toBe(0.7);
    expect(getItemIconScale("prism")).toBe(0.9);
    for (const key of ["PUNCHING_GLOVE", "MASTER_PUNCHING_GLOVE", "THROAT_SPRAY", "PRISM"] as const) {
      const icon = modifierTypes[key]().iconImage;
      expect(ITEM_ICON_SCALES.has(icon), `${key} ${icon}`).toBe(true);
    }
    const atlas = JSON.parse(readFileSync("assets/images/items.json", "utf-8"));
    const frames: { filename: string; sourceSize: { w: number; h: number } }[] = atlas.textures[0].frames;
    for (const icon of ITEM_ICON_SCALES.keys()) {
      const frame = frames.find(f => f.filename === icon);
      expect(frame, icon).toBeDefined();
      expect(frame!.sourceSize).toEqual({ w: ITEM_ICON_SOURCE_SIZE, h: ITEM_ICON_SOURCE_SIZE });
    }
  });

  // Local fork (2026-11-16): the Z-Moves and Max Moves rewards' icons are Cobblemon: Mega Showdown's textures scaled 2x;
  // the user: "아이콘은 언제나처럼 코블버스 쪽에서 빼오면 됩니다 / 거기에 다이사탕이랑 z링, z 크리스탈들 도트 이미지가 다
  // 있어요 / 이미지가 크지 않도록 배율 조절도 해주세요" (measurements in item-icon-scale.ts)
  it("draws Z링 at 0.7, 다이사탕 at 0.65 and every Z crystal at 0.8, Necrozma's own crystal at 1", () => {
    expect(Z_CRYSTAL_ICON_SCALE).toBe(0.8);
    expect(Z_RING_ICON_SCALE).toBe(0.7);
    expect(DYNAMAX_CANDY_ICON_SCALE).toBe(0.65);
    expect(Object.isFrozen(Z_CRYSTAL_ICONS)).toBe(true);
    expect(Z_CRYSTAL_ICONS).toHaveLength(18 + 16);
    expect(new Set(Z_CRYSTAL_ICONS)).toEqual(
      new Set([...Z_TYPE_CRYSTAL_TYPES.map(t => Z_TYPE_CRYSTAL_ICONS[t]), ...EXCLUSIVE_Z.map(info => info.icon)]),
    );
    for (const icon of Z_CRYSTAL_ICONS) {
      expect(getItemIconScale(icon), icon).toBe(0.8);
    }
    expect(getItemIconScale(modifierTypes.Z_RING().iconImage)).toBe(0.7);
    expect(getItemIconScale(modifierTypes.DYNAMAX_CANDY().iconImage)).toBe(0.65);
    for (const crystal of [...Z_TYPE_CRYSTAL_TYPES, ...EXCLUSIVE_Z.map(info => info.key)]) {
      expect(getItemIconScale(new ZCrystalModifierType(crystal).iconImage), String(crystal)).toBe(0.8);
    }
    // Necrozma's form change item keeps PokeRogue's own icon at its own size; so do the official band and bracelet
    for (const icon of ["ultranecrozium_z", "dynamax_band", "mega_bracelet", "rare_candy"]) {
      expect(getItemIconScale(icon), icon).toBe(1);
    }
  });

  it("lists exactly the six IV candies and Candy Pile, all 32x32 frames in the items atlas", () => {
    const expected = new Set([...Object.values(IvCandyModifierType.items), modifierTypes.CANDY_PILE().iconImage]);
    expect(new Set(FORK_CANDY_ICONS)).toEqual(expected);
    expect(FORK_CANDY_ICONS.size).toBe(7);

    const atlas = JSON.parse(readFileSync("assets/images/items.json", "utf-8"));
    const frames: { filename: string; sourceSize: { w: number; h: number } }[] = atlas.textures[0].frames;
    for (const icon of FORK_CANDY_ICONS) {
      const frame = frames.find(f => f.filename === icon);
      expect(frame, icon).toBeDefined();
      expect(frame!.sourceSize).toEqual({ w: ITEM_ICON_SOURCE_SIZE, h: ITEM_ICON_SOURCE_SIZE });
    }
  });

  it("keeps icons centred: the shift for a left-anchored sprite, none for a centred one", () => {
    expect(getItemIconCentringOffset(0, 1, 0.9)).toBeCloseTo(1.6);
    expect(getItemIconCentringOffset(0, 0.5, 0.45)).toBeCloseTo(0.8);
    expect(getItemIconCentringOffset(0, 1, 1)).toBe(0);
    expect(getItemIconCentringOffset(0.5, 1, 0.81)).toBe(0);
    // centre of the 32-wide box at origin 0 stays at 16
    const s = 0.81;
    expect(getItemIconCentringOffset(0, 1, s) + (ITEM_ICON_SOURCE_SIZE * s) / 2).toBeCloseTo(16);
  });

  it("draws the reward and shop icons at 0.9, candies at 0.81, in the fork's two-row layout too", async () => {
    game.override
      .startingModifier([{ name: "GOLDEN_POKEBALL", count: 9 }])
      .itemRewards([{ name: "CANDY_PILE" }, { name: "LEFTOVERS" }]);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    game.move.use(MoveId.SPLASH);
    await game.doKillOpponents();

    let checked = false;
    game.onNextPrompt(
      "SelectModifierPhase",
      UiMode.MODIFIER_SELECT,
      () => {
        const handler = game.scene.ui.getHandler() as ModifierSelectUiHandler;
        const options = handler.options;
        expect(options).toHaveLength(12);
        // the two-row layout's option scale is unchanged; the icon sprite carries the new scale
        expect(options.every(o => o.scale === 0.4)).toBe(true);
        expect(options[0].modifierTypeOption.type.iconImage).toBe("candy_pile");
        expect(spriteState(options[0]["item"]).scale).toBeCloseTo(0.81);
        expect(options[1].modifierTypeOption.type.iconImage).toBe("leftovers");
        expect(spriteState(options[1]["item"]).scale).toBeCloseTo(0.9);
        for (const option of options) {
          const item = spriteState(option["item"]);
          expect(item.scale).toBeCloseTo(0.9 * getItemIconScale(option.modifierTypeOption.type.iconImage));
          expect([item.x, item.y]).toEqual([0, 0]);
        }

        const shop = handler.shopOptionsRows.flat();
        expect(shop.length).toBeGreaterThan(0);
        for (const option of shop) {
          expect(spriteState(option["item"]).scale).toBeCloseTo(
            0.9 * getItemIconScale(option.modifierTypeOption.type.iconImage),
          );
        }
        checked = true;
        handler.processInput(Button.CANCEL);
      },
      () => game.isCurrentPhase("CommandPhase") || game.isCurrentPhase("NewBattlePhase"),
      true,
    );
    game.onNextPrompt(
      "SelectModifierPhase",
      UiMode.CONFIRM,
      () => (game.scene.ui.getHandler() as ModifierSelectUiHandler).processInput(Button.ACTION),
      () => game.isCurrentPhase("CommandPhase") || game.isCurrentPhase("NewBattlePhase"),
    );
    await game.phaseInterceptor.to("TurnInitPhase");
    expect(checked).toBe(true);
  });

  it("draws held IV candies at 0.75 in the modifier bar and the summary, centred where they were", async () => {
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    const pokemon = game.field.getPlayerPokemon();
    const gen = modifierTypes.IV_CANDY() as ModifierTypeGenerator;
    gen.id = "IV_CANDY";
    const candy = gen.generateType([], [Stat.ATK])!.newModifier(pokemon) as PokemonHeldItemModifier;
    const leftovers = modifierTypes
      .LEFTOVERS()
      .withIdFromFunc(modifierTypes.LEFTOVERS)
      .newModifier(pokemon) as PokemonHeldItemModifier;
    expect(candy.type.iconImage).toBe("mighty_candy");

    // modifier bar (held item at 0.5, left edge at 16)
    const [barCandy] = itemSprites(candy.getIcon(false));
    expect(spriteState(barCandy).scale).toBeCloseTo(0.375);
    expect(spriteState(barCandy).x).toBeCloseTo(18);
    const [barLeftovers] = itemSprites(leftovers.getIcon(false));
    expect(spriteState(barLeftovers).scale).toBe(0.5);
    expect(spriteState(barLeftovers).x).toBe(16);

    // summary icons (the container is scaled 0.5 by the held item; the sprite gets 0.9 and the candy factor)
    const summaryCandy = candy.getIcon(true, SUMMARY_ITEM_ICON_SCALE);
    const [candySprite] = itemSprites(summaryCandy);
    expect(spriteState(candySprite).scale).toBeCloseTo(0.675);
    expect(spriteState(candySprite).x).toBeCloseTo(getItemIconCentringOffset(0, 1, 0.675));
    expect(spriteState(candySprite).y).toBe(12);
    const [leftoversSprite] = itemSprites(leftovers.getIcon(true, SUMMARY_ITEM_ICON_SCALE));
    expect(spriteState(leftoversSprite).scale).toBeCloseTo(0.9);
    expect(spriteState(leftoversSprite).x).toBeCloseTo(1.6);
    // without the summary factor (run history uses getIcon(true)) only the candy factor applies
    const [plainLeftovers] = itemSprites(leftovers.getIcon(true));
    expect([spriteState(plainLeftovers).scale, spriteState(plainLeftovers).x]).toEqual([1, 0]);
  });

  it("the summary screen asks held items for 0.9 icons", async () => {
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    const pokemon = game.field.getPlayerPokemon();
    const gen = modifierTypes.IV_CANDY() as ModifierTypeGenerator;
    gen.id = "IV_CANDY";
    game.scene.addModifier(gen.generateType([], [Stat.SPD])!.newModifier(pokemon)!, true, false, false, true);
    game.scene.addModifier(
      modifierTypes.LEFTOVERS().withIdFromFunc(modifierTypes.LEFTOVERS).newModifier(pokemon)!,
      true,
      false,
      false,
      true,
    );
    expect(pokemon.getHeldItems().map(m => m.type.iconImage)).toEqual(
      expect.arrayContaining(["quick_candy", "leftovers"]),
    );

    const getIcon = vi.spyOn(PokemonHeldItemModifier.prototype, "getIcon");
    await game.scene.ui.setModeWithoutClear(UiMode.SUMMARY, pokemon, SummaryUiMode.DEFAULT, 1 /* Page.STATS */);
    const summaryCalls = getIcon.mock.calls.filter(args => args[0] === true);
    expect(summaryCalls.length).toBeGreaterThanOrEqual(2);
    expect(summaryCalls.every(args => args[1] === SUMMARY_ITEM_ICON_SCALE)).toBe(true);

    const drawn = getIcon.mock.results
      .filter((_r, i) => getIcon.mock.calls[i][0] === true)
      .map(r => itemSprites(r.value as Phaser.GameObjects.Container)[0]);
    const scales = drawn.map(s => spriteState(s).scale).sort();
    expect(scales[0]).toBeCloseTo(0.675);
    expect(scales.at(-1)).toBeCloseTo(0.9);
  });

  it("draws a candy encounter-intro item sprite 10% smaller (Fight or Flight can show Candy Pile)", async () => {
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    const config = { fileRoot: "items", hasShadow: false, x: 35, y: -5, scale: 0.75, isItem: true };
    const visuals = new MysteryEncounterIntroVisuals({
      spriteConfigs: [
        { ...config, spriteKey: "candy_pile" },
        { ...config, spriteKey: "leftovers" },
      ],
    } as unknown as MysteryEncounter);
    // each config adds a sprite and a tint sprite
    const sprites = visuals.getAll().filter(o => (o as { texture?: { key?: string } }).texture?.key === "items");
    expect(sprites).toHaveLength(4);
    expect(sprites.map(s => spriteState(s).scale).map(v => Math.round(v * 1000) / 1000)).toEqual([
      0.675, 0.675, 0.75, 0.75,
    ]);
    visuals.destroy();
  });
});
