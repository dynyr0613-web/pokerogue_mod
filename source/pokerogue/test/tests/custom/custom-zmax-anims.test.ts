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
      // 18 types x physical / special + 16 exclusive Z moves (all but 10,000,000 Volt Thunderbolt) + the 38 CFRU ones
      expect(CFRU_MAX_ANIM_MOVES.length).toBe(38);
      expect(ZMAX_OWN_ANIM_MOVES.size).toBe(52 + 38);
    });

    it("has a file for every Max move, Max Guard and 19 G-Max moves, and none for 다이검무 / 10,000,000 Volt Thunderbolt", () => {
      const maxMoves = [...ZMAX_ONLY_MOVES].filter(id => MoveId[id].startsWith("MAX_") && id !== MoveId.MAX_SWORDS_DANCE);
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
      for (const id of [MoveId.MAX_SWORDS_DANCE, MoveId.TEN_MILLION_VOLT_THUNDERBOLT]) {
        expect(existsSync(animPath(id)), MoveId[id]).toBe(false);
      }
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

    it("plays the CFRU files for Max / G-Max / Z다이 / Max Guard and keeps the fallbacks for 다이검무 and Z status moves", () => {
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
      expect(getAnimMoveId(allMoves[MoveId.MAX_FLARE])).toBe(MoveId.MAX_FLARE);
      expect(getAnimMoveId(allMoves[MoveId.G_MAX_WILDFIRE])).toBe(MoveId.G_MAX_WILDFIRE);
      expect(getAnimMoveId(allMoves[MoveId.G_MAX_BEFUDDLE])).toBe(MoveId.MAX_FLUTTERBY);
      expect(getAnimMoveId(allMoves[MoveId.MAX_GUARD])).toBe(MoveId.MAX_GUARD);
      for (const id of ZMAX_ONLY_MOVES) {
        const animId = getAnimMoveId(allMoves[id]);
        expect(ZMAX_ONLY_MOVES.has(animId) ? existsSync(animPath(animId)) : true, MoveId[id]).toBe(true);
        if (MoveId[id].startsWith("MAX_") || MoveId[id].startsWith("G_MAX_")) {
          // a Max / G-Max move never falls back to Tackle any more, except 다이검무 (Swords Dance's)
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
  });
});
