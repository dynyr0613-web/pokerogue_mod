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
import { ZCrystalModifierType } from "#modifiers/modifier-type";
import { getAnimMoveId, getTransformedMove, ZMAX_OWN_ANIM_MOVES } from "#moves/move-transform";
import { ZMAX_ONLY_MOVES } from "#moves/zmax-data";
import { GameManager } from "#test/framework/game-manager";
import { toKebabCase } from "#utils/strings";
import { existsSync, readFileSync } from "node:fs";
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
      // 18 types x physical / special + 16 exclusive Z moves (all but 10,000,000 Volt Thunderbolt)
      expect(ZMAX_OWN_ANIM_MOVES.size).toBe(52);
    });

    it("has no Max / G-Max / Max Guard / 10,000,000 Volt Thunderbolt animation (not in the Essentials data)", () => {
      for (const id of [
        MoveId.MAX_FLARE,
        MoveId.MAX_STEELSPIKE,
        MoveId.MAX_GUARD,
        MoveId.MAX_SWORDS_DANCE,
        MoveId.G_MAX_WILDFIRE,
        MoveId.G_MAX_MELTDOWN,
        MoveId.TEN_MILLION_VOLT_THUNDERBOLT,
      ]) {
        expect(existsSync(animPath(id)), MoveId[id]).toBe(false);
      }
    });

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

    it("keeps the fallbacks for Max / G-Max / Z다이 / Max Guard / 다이검무 and Z status moves", () => {
      expect(getAnimMoveId(getTransformedMove(MoveId.EMBER, { kind: "max", moveId: MoveId.MAX_FLARE }))).toBe(
        MoveId.EMBER,
      );
      expect(
        getAnimMoveId(getTransformedMove(MoveId.DOUBLE_IRON_BASH, { kind: "gmax", moveId: MoveId.G_MAX_MELTDOWN })),
      ).toBe(MoveId.DOUBLE_IRON_BASH);
      // Z다이 attack: a copy of the Max move, so the base move's until a Max animation exists
      expect(getAnimMoveId(getTransformedMove(MoveId.EMBER, { kind: "zMax", moveId: MoveId.MAX_FLARE }))).toBe(
        MoveId.EMBER,
      );
      expect(getAnimMoveId(getTransformedMove(MoveId.TAIL_WHIP, { kind: "max", moveId: MoveId.MAX_GUARD }))).toBe(
        MoveId.PROTECT,
      );
      expect(getAnimMoveId(getTransformedMove(MoveId.TAIL_WHIP, { kind: "zMax", moveId: MoveId.MAX_GUARD }))).toBe(
        MoveId.PROTECT,
      );
      expect(
        getAnimMoveId(getTransformedMove(MoveId.SWORDS_DANCE, { kind: "zMax", moveId: MoveId.MAX_SWORDS_DANCE })),
      ).toBe(MoveId.SWORDS_DANCE);
      expect(getAnimMoveId(getTransformedMove(MoveId.SWORDS_DANCE, { kind: "z", moveId: MoveId.SWORDS_DANCE }))).toBe(
        MoveId.SWORDS_DANCE,
      );
      expect(getAnimMoveId(allMoves[MoveId.FLAMETHROWER])).toBe(MoveId.FLAMETHROWER);
    });

    it("never names a file that is not there for a Z / Max registry entry used outside a slot", () => {
      expect(getAnimMoveId(allMoves[MoveId.CATASTROPIKA])).toBe(MoveId.CATASTROPIKA);
      expect(getAnimMoveId(allMoves[MoveId.MAX_FLARE])).toBe(MoveId.TACKLE);
      expect(getAnimMoveId(allMoves[MoveId.G_MAX_WILDFIRE])).toBe(MoveId.TACKLE);
      expect(getAnimMoveId(allMoves[MoveId.MAX_GUARD])).toBe(MoveId.PROTECT);
      for (const id of ZMAX_ONLY_MOVES) {
        const animId = getAnimMoveId(allMoves[id]);
        expect(ZMAX_ONLY_MOVES.has(animId) ? existsSync(animPath(animId)) : true, MoveId[id]).toBe(true);
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

    it("a Z move plays its own animation and a Max move its base move's", async () => {
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
      expect(animIds).toEqual([MoveId.GIGAVOLT_HAVOC__SPECIAL, MoveId.EMBER]);
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
      expect(played).toContain(MoveId.EMBER);
      expect(played).not.toContain(MoveId.MAX_FLARE);
    });
  });
});
