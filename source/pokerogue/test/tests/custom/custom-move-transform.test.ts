// Local fork (2026-11-16): Z-Moves and Max Moves, the per-slot conversion core (src/data/moves/move-transform.ts) and
// the battle pipeline around it (tools/drive/zmax_1116/design_spec.md sections 1-4, 7b, 8). The user: "다이사탕 사용
// 시 원하는 기술을 다이 기술로 바꿈 / 해당 포켓몬의 전용기는 거다이 기술로 바꿈 (멜메탈: 불릿펀치 -> 다이스틸, 더블펀처 ->
// 거다이융격)", "z + 다이기술: Z다이너클, Z다이스틸 같은 이름이 되며, 위력 200 고정, 방어/판별 등의 효과를 뚫고 1/2 데미지".
// Checked here: the derived move of each kind, the eligibility table, the G-Max rule, saving, move history (base id +
// derivedMoveId), PP, targets, protection piercing, Max Guard and the Protect chain, Z-Power, and the enemy AI.

import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { getPokemonNameWithAffix } from "#app/messages";
import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { AiType } from "#enums/ai-type";
import { BattlerIndex } from "#enums/battler-index";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { MoveTarget } from "#enums/move-target";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { EnemyPokemon, PlayerPokemon, Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import {
  type ConversionItem,
  canSlotTakeItem,
  getAnimMoveId,
  getBaseMoveId,
  getConversionResult,
  getGmaxMoveInfo,
  getTransformedMove,
  isTransformedMove,
  MOVE_TRANSFORM_RULES,
  type MoveTransform,
} from "#moves/move-transform";
import { getMoveTargets } from "#moves/move-utils";
import { PokemonMove } from "#moves/pokemon-move";
import { getMaxMovePower, getZMovePower } from "#moves/zmax-data";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import { toDmgValue } from "#utils/common";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const CANDY: ConversionItem = { kind: "candy" };
const zCrystal = (type: PokemonType): ConversionItem => ({ kind: "zType", type });

/** A minimal stand-in for a Pokémon: the conversion rules only read its species and form keys */
function fakePokemon(speciesId: SpeciesId, formKey = "", fusion?: [SpeciesId, string]): Pokemon {
  return {
    species: speciesDataRegistry.getSpecies(speciesId),
    getFormKey: () => formKey,
    fusionSpecies: fusion ? speciesDataRegistry.getSpecies(fusion[0]) : null,
    getFusionFormKey: () => (fusion ? fusion[1] : null),
  } as unknown as Pokemon;
}

/** A slot of `moveId`, converted by `transform` if given */
function slot(moveId: MoveId, transform?: MoveTransform): PokemonMove {
  return new PokemonMove(moveId, 0, 0, undefined, transform);
}

describe("Z / Max move conversion (2026-11-16)", () => {
  describe("derived moves", () => {
    it("Bullet Punch -> Max Steelspike: Max power 90, base category / type / PP, never misses, one target, no contact", () => {
      const move = getTransformedMove(MoveId.BULLET_PUNCH, { kind: "max", moveId: MoveId.MAX_STEELSPIKE });
      const base = allMoves[MoveId.BULLET_PUNCH];
      expect(move.id).toBe(MoveId.MAX_STEELSPIKE);
      expect(move.power).toBe(90);
      expect(move.power).toBe(getMaxMovePower(MoveId.BULLET_PUNCH));
      expect(move.category).toBe(MoveCategory.PHYSICAL);
      expect(move.type).toBe(PokemonType.STEEL);
      expect(move.pp).toBe(base.pp);
      expect(move.accuracy).toBe(-1);
      expect(move.priority).toBe(0);
      expect(move.moveTarget).toBe(MoveTarget.NEAR_ENEMY);
      expect(move.hasFlag(MoveFlags.MAKES_CONTACT)).toBe(false);
      expect(move.isUnimplemented).toBe(false);
      expect(move.name).not.toContain("(N)");
      expect(move.name).toBe(allMoves[MoveId.MAX_STEELSPIKE].name.replace(" (N)", ""));
      const pierce = move.getAttrs("ProtectPierceAttr");
      expect(pierce).toHaveLength(1);
      expect(pierce[0].multiplier).toBe(MOVE_TRANSFORM_RULES.plainProtectPierce);
      expect(pierce[0].ignoresMaxGuard).toBe(false);
    });

    it("a special base keeps its category (Flash Cannon -> special Max Steelspike)", () => {
      const move = getTransformedMove(MoveId.FLASH_CANNON, { kind: "max", moveId: MoveId.MAX_STEELSPIKE });
      expect(move.category).toBe(MoveCategory.SPECIAL);
      expect(move.power).toBe(getMaxMovePower(MoveId.FLASH_CANNON));
    });

    it("never changes the registry entry it copies", () => {
      const registry = allMoves[MoveId.MAX_ROCKFALL];
      const before = { attrs: registry.attrs.length, power: registry.power, pp: registry.pp, name: registry.name };
      const zMax = getTransformedMove(MoveId.ROCK_SLIDE, { kind: "zMax", moveId: MoveId.MAX_ROCKFALL });
      expect(zMax.attrs).not.toBe(registry.attrs);
      expect({ attrs: registry.attrs.length, power: registry.power, pp: registry.pp, name: registry.name }).toEqual(
        before,
      );
    });

    it("Double Iron Bash -> G-Max Meltdown: power 140, PP of Double Iron Bash, single hit", () => {
      const move = getTransformedMove(MoveId.DOUBLE_IRON_BASH, { kind: "gmax", moveId: MoveId.G_MAX_MELTDOWN });
      expect(move.id).toBe(MoveId.G_MAX_MELTDOWN);
      expect(move.power).toBe(140);
      expect(move.pp).toBe(allMoves[MoveId.DOUBLE_IRON_BASH].pp);
      expect(move.hasAttr("MultiHitAttr")).toBe(false);
      expect(move.hasFlag(MoveFlags.MAKES_CONTACT)).toBe(false);
    });

    it("G-Max Drum Solo is 160 whatever the base move", () => {
      const move = getTransformedMove(MoveId.RAZOR_LEAF, { kind: "gmax", moveId: MoveId.G_MAX_DRUM_SOLO });
      expect(move.power).toBe(160);
    });

    it("a type Z move takes the Z power of the base move", () => {
      const move = getTransformedMove(MoveId.FLAMETHROWER, {
        kind: "z",
        moveId: MoveId.INFERNO_OVERDRIVE__SPECIAL,
      });
      expect(move.power).toBe(getZMovePower(MoveId.FLAMETHROWER));
      expect(move.category).toBe(MoveCategory.SPECIAL);
      expect(move.pp).toBe(allMoves[MoveId.FLAMETHROWER].pp);
      expect(move.accuracy).toBe(-1);
    });

    it("Z다이 attack: power 200, through every protection incl. Max Guard for 1/2, named Z-<Max move>", () => {
      const move = getTransformedMove(MoveId.CLOSE_COMBAT, { kind: "zMax", moveId: MoveId.MAX_KNUCKLE });
      expect(move.power).toBe(MOVE_TRANSFORM_RULES.zMaxPower);
      expect(move.category).toBe(MoveCategory.PHYSICAL);
      const pierce = move.getAttrs("ProtectPierceAttr");
      expect(pierce).toHaveLength(1);
      expect(pierce[0].multiplier).toBe(0.5);
      expect(pierce[0].ignoresMaxGuard).toBe(true);
      expect(move.name).toBe(i18next.t("battle:zMaxMoveName", { moveName: allMoves[MoveId.MAX_KNUCKLE].name }));
    });

    it("Z status move: the base move (same id, target, priority, PP) plus its Z-Power, named Z-<move>", () => {
      const move = getTransformedMove(MoveId.SWORDS_DANCE, { kind: "z", moveId: MoveId.SWORDS_DANCE });
      const base = allMoves[MoveId.SWORDS_DANCE];
      expect(move).not.toBe(base);
      expect(move.id).toBe(MoveId.SWORDS_DANCE);
      expect(move.moveTarget).toBe(base.moveTarget);
      expect(move.priority).toBe(base.priority);
      expect(move.pp).toBe(base.pp);
      expect(move.hasAttr("ZPowerAttr")).toBe(true);
      expect(base.hasAttr("ZPowerAttr")).toBe(false);
      expect(move.name).toBe(i18next.t("battle:zMoveStatusName", { moveName: base.name }));
      expect(isTransformedMove(move)).toBe(true);
      expect(getBaseMoveId(move)).toBe(MoveId.SWORDS_DANCE);
    });

    it("Max Guard from Tail Whip: priority +4, PP of Tail Whip; Z다이월 adds the Z-Power", () => {
      const maxGuard = getTransformedMove(MoveId.TAIL_WHIP, { kind: "max", moveId: MoveId.MAX_GUARD });
      expect(maxGuard.priority).toBe(4);
      expect(maxGuard.pp).toBe(allMoves[MoveId.TAIL_WHIP].pp);
      expect(maxGuard.hasAttr("ProtectAttr")).toBe(true);
      expect(maxGuard.hasAttr("ZPowerAttr")).toBe(false);
      const zMaxGuard = getTransformedMove(MoveId.TAIL_WHIP, { kind: "zMax", moveId: MoveId.MAX_GUARD });
      expect(zMaxGuard.hasAttr("ZPowerAttr")).toBe(true);
      expect(zMaxGuard.name).toBe(i18next.t("battle:zMaxMoveName", { moveName: allMoves[MoveId.MAX_GUARD].name }));
    });

    it("다이검무 is Atk +3, Z다이검무 Atk +4 (the registry entry stays +3)", () => {
      const maxSd = getTransformedMove(MoveId.SWORDS_DANCE, { kind: "max", moveId: MoveId.MAX_SWORDS_DANCE });
      const zMaxSd = getTransformedMove(MoveId.SWORDS_DANCE, { kind: "zMax", moveId: MoveId.MAX_SWORDS_DANCE });
      const stagesOf = (move: Move) => move.getAttrs("StatStageChangeAttr").map(a => a.stages);
      expect(stagesOf(maxSd)).toEqual([3]);
      expect(stagesOf(zMaxSd)).toEqual([MOVE_TRANSFORM_RULES.zMaxSwordsDanceStages]);
      expect(stagesOf(allMoves[MoveId.MAX_SWORDS_DANCE])).toEqual([3]);
      expect(maxSd.pp).toBe(allMoves[MoveId.SWORDS_DANCE].pp);
      expect(zMaxSd.hasAttr("ZPowerAttr")).toBe(false);
    });

    it("is cached: the same object for the same base move and conversion", () => {
      const t: MoveTransform = { kind: "max", moveId: MoveId.MAX_FLARE };
      expect(getTransformedMove(MoveId.EMBER, t)).toBe(getTransformedMove(MoveId.EMBER, { ...t }));
      expect(getTransformedMove(MoveId.EMBER, t)).not.toBe(getTransformedMove(MoveId.FLAMETHROWER, t));
      expect(slot(MoveId.EMBER, t).getMove()).toBe(slot(MoveId.EMBER, t).getMove());
    });

    // Local fork (2026-11-18): Z and exclusive Z moves play their own animations now (Essentials' PRAS ones), Guardian
    // of Alola included; custom-zmax-anims.test.ts checks the rest
    // Local fork (2026-11-19): Max moves and Max Guard play their own CFRU animations now, and 다이검무 / Z다이검무 its
    // own recoloured x1.5 Swords Dance (item E1)
    it("plays the own animation of Max moves, Max Guard, 다이검무 and Z moves", () => {
      expect(getAnimMoveId(slot(MoveId.EMBER, { kind: "max", moveId: MoveId.MAX_FLARE }).getMove())).toBe(
        MoveId.MAX_FLARE,
      );
      expect(getAnimMoveId(slot(MoveId.TAIL_WHIP, { kind: "max", moveId: MoveId.MAX_GUARD }).getMove())).toBe(
        MoveId.MAX_GUARD,
      );
      expect(
        getAnimMoveId(slot(MoveId.SWORDS_DANCE, { kind: "zMax", moveId: MoveId.MAX_SWORDS_DANCE }).getMove()),
      ).toBe(MoveId.MAX_SWORDS_DANCE);
      expect(
        getAnimMoveId(slot(MoveId.THUNDERBOLT, { kind: "zExclusive", moveId: MoveId.CATASTROPIKA }).getMove()),
      ).toBe(MoveId.CATASTROPIKA);
      expect(
        getAnimMoveId(slot(MoveId.MOONBLAST, { kind: "zExclusive", moveId: MoveId.GUARDIAN_OF_ALOLA }).getMove()),
      ).toBe(MoveId.GUARDIAN_OF_ALOLA);
      expect(getAnimMoveId(allMoves[MoveId.TACKLE])).toBe(MoveId.TACKLE);
    });
  });

  describe("eligibility (design section 3) and the G-Max rule (section 4)", () => {
    let melmetal: Pokemon;
    beforeAll(() => {
      melmetal = fakePokemon(SpeciesId.MELMETAL);
    });

    it("Melmetal: Bullet Punch -> 다이스틸, Double Iron Bash (signature) -> 거다이융격, status -> Max Guard", () => {
      expect(getConversionResult(melmetal, slot(MoveId.BULLET_PUNCH), CANDY)).toEqual({
        kind: "max",
        moveId: MoveId.MAX_STEELSPIKE,
      });
      expect(getConversionResult(melmetal, slot(MoveId.DOUBLE_IRON_BASH), CANDY)).toEqual({
        kind: "gmax",
        moveId: MoveId.G_MAX_MELTDOWN,
      });
      expect(getConversionResult(melmetal, slot(MoveId.ACID_ARMOR), CANDY)).toEqual({
        kind: "max",
        moveId: MoveId.MAX_GUARD,
      });
      expect(getConversionResult(melmetal, slot(MoveId.SWORDS_DANCE), CANDY)).toEqual({
        kind: "max",
        moveId: MoveId.MAX_SWORDS_DANCE,
      });
    });

    it("a G-Max species without a signature move converts moves of its G-Max type (Charizard)", () => {
      const charizard = fakePokemon(SpeciesId.CHARIZARD);
      expect(getConversionResult(charizard, slot(MoveId.FLAMETHROWER), CANDY)?.moveId).toBe(MoveId.G_MAX_WILDFIRE);
      expect(getConversionResult(charizard, slot(MoveId.AIR_SLASH), CANDY)?.moveId).toBe(MoveId.MAX_AIRSTREAM);
      // Status moves never become G-Max moves
      expect(getConversionResult(charizard, slot(MoveId.WILL_O_WISP), CANDY)?.moveId).toBe(MoveId.MAX_GUARD);
    });

    it("Grimmsnarl's signature False Surrender -> 거다이수마; its other Dark attacks -> 다이아크 (review fix)", () => {
      const grimmsnarl = fakePokemon(SpeciesId.GRIMMSNARL);
      expect(getConversionResult(grimmsnarl, slot(MoveId.FALSE_SURRENDER), CANDY)).toEqual({
        kind: "gmax",
        moveId: MoveId.G_MAX_SNOOZE,
      });
      expect(getConversionResult(grimmsnarl, slot(MoveId.SUCKER_PUNCH), CANDY)).toEqual({
        kind: "max",
        moveId: MoveId.MAX_DARKNESS,
      });
      expect(getConversionResult(grimmsnarl, slot(MoveId.SPIRIT_BREAK), CANDY)?.moveId).toBe(MoveId.MAX_STARFALL);
      // Eevee [decided]: no signature (Veevee Volley is only the partner / gigantamax forms'), every Normal attack
      expect(getConversionResult(fakePokemon(SpeciesId.EEVEE), slot(MoveId.TACKLE), CANDY)?.moveId).toBe(
        MoveId.G_MAX_CUDDLE,
      );
    });

    it("G-Max is species-level (any form), from the fusion tail too; Urshifu by style", () => {
      expect(getGmaxMoveInfo(fakePokemon(SpeciesId.MELMETAL, "mega"))?.move).toBe(MoveId.G_MAX_MELTDOWN);
      expect(getGmaxMoveInfo(fakePokemon(SpeciesId.SNORLAX, "", [SpeciesId.CHARIZARD, ""]))?.move).toBe(
        MoveId.G_MAX_REPLENISH,
      );
      expect(getGmaxMoveInfo(fakePokemon(SpeciesId.PIDGEY, "", [SpeciesId.CHARIZARD, ""]))?.move).toBe(
        MoveId.G_MAX_WILDFIRE,
      );
      expect(getGmaxMoveInfo(fakePokemon(SpeciesId.URSHIFU, "rapid-strike"))?.move).toBe(MoveId.G_MAX_RAPID_FLOW);
      expect(getGmaxMoveInfo(fakePokemon(SpeciesId.URSHIFU, "single-strike"))?.move).toBe(MoveId.G_MAX_ONE_BLOW);
      expect(getGmaxMoveInfo(fakePokemon(SpeciesId.ETERNATUS, "eternamax"))).toBeNull();
      expect(getGmaxMoveInfo(fakePokemon(SpeciesId.PIDGEY))).toBeNull();
    });

    it("type Z crystal: plain move of its type -> Z move / Z status; Max move -> Z다이; wrong type -> no", () => {
      expect(getConversionResult(melmetal, slot(MoveId.BULLET_PUNCH), zCrystal(PokemonType.STEEL))).toEqual({
        kind: "z",
        moveId: MoveId.CORKSCREW_CRASH__PHYSICAL,
      });
      expect(getConversionResult(melmetal, slot(MoveId.FLASH_CANNON), zCrystal(PokemonType.STEEL))?.moveId).toBe(
        MoveId.CORKSCREW_CRASH__SPECIAL,
      );
      expect(getConversionResult(melmetal, slot(MoveId.SWORDS_DANCE), zCrystal(PokemonType.NORMAL))).toEqual({
        kind: "z",
        moveId: MoveId.SWORDS_DANCE,
      });
      expect(
        getConversionResult(
          melmetal,
          slot(MoveId.BULLET_PUNCH, { kind: "max", moveId: MoveId.MAX_STEELSPIKE }),
          zCrystal(PokemonType.STEEL),
        ),
      ).toEqual({ kind: "zMax", moveId: MoveId.MAX_STEELSPIKE });
      // Max Guard from Tail Whip counts as Normal (the base move's type)
      expect(
        getConversionResult(
          melmetal,
          slot(MoveId.TAIL_WHIP, { kind: "max", moveId: MoveId.MAX_GUARD }),
          zCrystal(PokemonType.NORMAL),
        ),
      ).toEqual({ kind: "zMax", moveId: MoveId.MAX_GUARD });
      expect(getConversionResult(melmetal, slot(MoveId.BULLET_PUNCH), zCrystal(PokemonType.FIRE))).toBeNull();
    });

    it("다이사탕 on a Z move gives the Z다이 move (never G-Max)", () => {
      expect(
        getConversionResult(
          melmetal,
          slot(MoveId.DOUBLE_IRON_BASH, { kind: "z", moveId: MoveId.CORKSCREW_CRASH__PHYSICAL }),
          CANDY,
        ),
      ).toEqual({ kind: "zMax", moveId: MoveId.MAX_STEELSPIKE });
      expect(
        getConversionResult(melmetal, slot(MoveId.SWORDS_DANCE, { kind: "z", moveId: MoveId.SWORDS_DANCE }), CANDY),
      ).toEqual({ kind: "zMax", moveId: MoveId.MAX_SWORDS_DANCE });
    });

    it("finished slots take nothing; Struggle / NONE never", () => {
      const items: ConversionItem[] = [CANDY, zCrystal(PokemonType.STEEL), { kind: "zExclusive", key: "PIKANIUM_Z" }];
      const finished: PokemonMove[] = [
        slot(MoveId.DOUBLE_IRON_BASH, { kind: "gmax", moveId: MoveId.G_MAX_MELTDOWN }),
        slot(MoveId.BULLET_PUNCH, { kind: "zMax", moveId: MoveId.MAX_STEELSPIKE }),
        slot(MoveId.THUNDERBOLT, { kind: "zExclusive", moveId: MoveId.CATASTROPIKA }),
        slot(MoveId.STRUGGLE),
        slot(MoveId.NONE),
      ];
      for (const s of finished) {
        for (const item of items) {
          expect(canSlotTakeItem(s, item), `${MoveId[s.moveId]} ${s.transform?.kind} ${item.kind}`).toBe(false);
        }
      }
      // A Max move takes no candy, a Z move no crystal
      // Local fork (2026-11-20), F1 Q2 (the user: "전용 z를 쓸수 있거나 거다이 포켓몬인 경우 허용"): a Max attack now takes
      // the candy when it gives the G-Max move (Melmetal's Double Iron Bash), and nothing else (Bullet Punch); Max Guard
      // never (custom-zmax-slots-1120.test.ts has the rest)
      expect(
        getConversionResult(melmetal, slot(MoveId.BULLET_PUNCH, { kind: "max", moveId: MoveId.MAX_STEELSPIKE }), CANDY),
      ).toBeNull();
      expect(
        getConversionResult(
          melmetal,
          slot(MoveId.DOUBLE_IRON_BASH, { kind: "max", moveId: MoveId.MAX_STEELSPIKE }),
          CANDY,
        ),
      ).toEqual({ kind: "gmax", moveId: MoveId.G_MAX_MELTDOWN });
      expect(canSlotTakeItem(slot(MoveId.ACID_ARMOR, { kind: "max", moveId: MoveId.MAX_GUARD }), CANDY)).toBe(false);
      expect(
        canSlotTakeItem(
          slot(MoveId.BULLET_PUNCH, { kind: "z", moveId: MoveId.CORKSCREW_CRASH__PHYSICAL }),
          zCrystal(PokemonType.STEEL),
        ),
      ).toBe(false);
    });

    it("exclusive crystal: right species and type, status moves of the type too (review fix)", () => {
      const pikanium: ConversionItem = { kind: "zExclusive", key: "PIKANIUM_Z" };
      expect(getConversionResult(fakePokemon(SpeciesId.PIKACHU), slot(MoveId.THUNDERBOLT), pikanium)).toEqual({
        kind: "zExclusive",
        moveId: MoveId.CATASTROPIKA,
      });
      expect(getConversionResult(fakePokemon(SpeciesId.RAICHU), slot(MoveId.THUNDERBOLT), pikanium)).toBeNull();
      // "전용 z 크리스탈은 해당 타입의 기술을 전용 z기술로 변환": a status move of the type is a move of the type
      expect(getConversionResult(fakePokemon(SpeciesId.PIKACHU), slot(MoveId.THUNDER_WAVE), pikanium)).toEqual({
        kind: "zExclusive",
        moveId: MoveId.CATASTROPIKA,
      });
      const kommonium: ConversionItem = { kind: "zExclusive", key: "KOMMONIUM_Z" };
      expect(getConversionResult(fakePokemon(SpeciesId.KOMMO_O), slot(MoveId.CLANGOROUS_SOUL), kommonium)).toEqual({
        kind: "zExclusive",
        moveId: MoveId.CLANGOROUS_SOULBLAZE,
      });
      // The derived move from a status base is the exclusive Z attack with its own category and power
      const soulblaze = getTransformedMove(MoveId.CLANGOROUS_SOUL, {
        kind: "zExclusive",
        moveId: MoveId.CLANGOROUS_SOULBLAZE,
      });
      expect(soulblaze.category).toBe(allMoves[MoveId.CLANGOROUS_SOULBLAZE].category);
      expect(soulblaze.power).toBe(allMoves[MoveId.CLANGOROUS_SOULBLAZE].power);
      expect(soulblaze.pp).toBe(allMoves[MoveId.CLANGOROUS_SOUL].pp);
      expect(getConversionResult(fakePokemon(SpeciesId.PIKACHU), slot(MoveId.QUICK_ATTACK), pikanium)).toBeNull();
      // A fusion tail counts
      expect(
        getConversionResult(fakePokemon(SpeciesId.PIDGEY, "", [SpeciesId.PIKACHU, ""]), slot(MoveId.SPARK), pikanium)
          ?.moveId,
      ).toBe(MoveId.CATASTROPIKA);
    });
  });

  describe("PokemonMove data", () => {
    it("serializes as plain data, and loadMove deep-copies the conversion", () => {
      const source = slot(MoveId.BULLET_PUNCH, { kind: "max", moveId: MoveId.MAX_STEELSPIKE });
      source.ppUsed = 3;
      source.ppUp = 2;
      const json = JSON.parse(JSON.stringify(source));
      expect(json).toEqual({
        moveId: MoveId.BULLET_PUNCH,
        ppUsed: 3,
        ppUp: 2,
        transform: { kind: "max", moveId: MoveId.MAX_STEELSPIKE },
      });
      const loaded = PokemonMove.loadMove(json);
      expect(loaded.transform).toEqual(source.transform);
      expect(loaded.getMove()).toBe(source.getMove());
      const copy = PokemonMove.loadMove(source);
      expect(copy.transform).not.toBe(source.transform);
      // An unconverted slot has no `transform` key at all
      expect(Object.keys(JSON.parse(JSON.stringify(slot(MoveId.TACKLE))))).not.toContain("transform");
    });

    it("drops a broken saved conversion instead of breaking the slot", () => {
      const loaded = PokemonMove.loadMove({ moveId: MoveId.TACKLE, ppUsed: 0, ppUp: 0, transform: { kind: "nope" } });
      expect(loaded.transform).toBeUndefined();
      expect(loaded.getMove()).toBe(allMoves[MoveId.TACKLE]);
      const badId = PokemonMove.loadMove({ moveId: MoveId.TACKLE, transform: { kind: "max", moveId: 999_999 } });
      expect(badId.transform).toBeUndefined();
    });

    it("PP stays the base move's, PP Ups included", () => {
      const s = slot(MoveId.DOUBLE_IRON_BASH, { kind: "gmax", moveId: MoveId.G_MAX_MELTDOWN });
      s.ppUp = 3;
      const plain = new PokemonMove(MoveId.DOUBLE_IRON_BASH, 0, 3);
      expect(s.getMovePp()).toBe(plain.getMovePp());
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
        .startingLevel(100)
        .enemyLevel(100)
        .enemySpecies(SpeciesId.SNORLAX)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset(MoveId.SPLASH)
        .ability(AbilityId.BALL_FETCH);
    });

    /**
     * Start a single battle with Melmetal knowing `moves` (set after the start: the moveset override rebuilds its
     * slots on every read, which would drop a conversion)
     */
    async function startMelmetal(
      moves: MoveId[] = [MoveId.BULLET_PUNCH, MoveId.DOUBLE_IRON_BASH, MoveId.TAIL_WHIP, MoveId.SWORDS_DANCE],
    ): Promise<PlayerPokemon> {
      await game.classicMode.startBattle(SpeciesId.MELMETAL);
      const player = game.field.getPlayerPokemon();
      game.move.changeMoveset(player, moves);
      return player;
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** Convert the player's slot holding `moveId` */
    function convert(pokemon: Pokemon, moveId: MoveId, transform: MoveTransform): PokemonMove {
      const target = pokemon.getMoveset().find(m => m.moveId === moveId)!;
      target.transform = transform;
      return target;
    }

    /** `target`'s damage from `source`'s `move` as the forecast sees it (max roll, no protection in between) */
    function forecast(source: Pokemon, target: Pokemon, move: PokemonMove): number {
      return target.getAttackDamage({ source, move: move.getMove(), simulated: true }).damage;
    }

    it("records the base id + derivedMoveId in history, spends the base PP, keeps lastMove / attacksReceived base", async () => {
      const player = await startMelmetal();
      const enemy = game.field.getEnemyPokemon();
      const bulletPunch = convert(player, MoveId.BULLET_PUNCH, { kind: "max", moveId: MoveId.MAX_STEELSPIKE });

      game.move.select(MoveId.BULLET_PUNCH);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
      await game.phaseInterceptor.to("MoveEndPhase");

      expect(player).toHaveUsedMove({
        move: MoveId.BULLET_PUNCH,
        derivedMoveId: MoveId.MAX_STEELSPIKE,
        result: MoveResult.SUCCESS,
      });
      expect(bulletPunch.ppUsed).toBe(1);
      expect(bulletPunch.getMovePp()).toBe(allMoves[MoveId.BULLET_PUNCH].pp);
      expect(globalScene.currentBattle.lastMove).toBe(MoveId.BULLET_PUNCH);
      expect(enemy.turnData.attacksReceived[0]?.move).toBe(MoveId.BULLET_PUNCH);
      expect(enemy.hp).toBeLessThan(enemy.getMaxHp());
    });

    it("saves the conversion through PokemonData, and Shedinja's copied moveset keeps it", async () => {
      const player = await startMelmetal();
      convert(player, MoveId.DOUBLE_IRON_BASH, { kind: "gmax", moveId: MoveId.G_MAX_MELTDOWN });

      const saved = JSON.parse(JSON.stringify(new PokemonData(player)));
      const restored = new PokemonData(saved);
      const restoredSlot = restored.moveset.find(m => m.moveId === MoveId.DOUBLE_IRON_BASH)!;
      expect(restoredSlot.transform).toEqual({ kind: "gmax", moveId: MoveId.G_MAX_MELTDOWN });
      expect(restoredSlot.getMove().id).toBe(MoveId.G_MAX_MELTDOWN);
      expect(restoredSlot.getMove().power).toBe(140);

      const copied = player.copyMoveset().find(m => m.moveId === MoveId.DOUBLE_IRON_BASH)!;
      expect(copied.transform).toEqual({ kind: "gmax", moveId: MoveId.G_MAX_MELTDOWN });
      expect(copied.transform).not.toBe(player.moveset[1].transform);
    });

    it("Max Guard made from Tail Whip counts for the Protect chain", async () => {
      const player = await startMelmetal([MoveId.TAIL_WHIP, MoveId.PROTECT]);
      convert(player, MoveId.TAIL_WHIP, { kind: "max", moveId: MoveId.MAX_GUARD });
      // Any roll for a chained protection fails
      vi.spyOn(player, "randBattleSeedInt").mockReturnValue(1);

      game.move.select(MoveId.TAIL_WHIP);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
      await game.toNextTurn();
      expect(player).toHaveUsedMove({
        move: MoveId.TAIL_WHIP,
        derivedMoveId: MoveId.MAX_GUARD,
        result: MoveResult.SUCCESS,
      });

      game.move.select(MoveId.PROTECT);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
      await game.toNextTurn();
      expect(player).toHaveUsedMove({ move: MoveId.PROTECT, result: MoveResult.FAIL });
    });

    it("a plain Max move goes through Protect for 1/4, with a message", async () => {
      const player = await startMelmetal();
      const enemy = game.field.getEnemyPokemon();
      const move = convert(player, MoveId.BULLET_PUNCH, { kind: "max", moveId: MoveId.MAX_STEELSPIKE });
      const full = forecast(player, enemy, move);
      vi.spyOn(enemy, "randBattleSeedIntRange").mockReturnValue(100);

      game.move.select(MoveId.BULLET_PUNCH);
      await game.move.forceEnemyMove(MoveId.PROTECT);
      await game.toEndOfTurn();

      expect(enemy.getMaxHp() - enemy.hp).toBe(toDmgValue(full * MOVE_TRANSFORM_RULES.plainProtectPierce));
      expect(game).toHaveShownMessage(
        i18next.t("battle:protectPierced", { pokemonNameWithAffix: getPokemonNameWithAffix(enemy) }),
      );
    });

    it("Max Guard stops a plain Max move, a Z다이 move goes through it for 1/2", async () => {
      const player = await startMelmetal();
      const enemy = game.field.getEnemyPokemon();
      convert(player, MoveId.BULLET_PUNCH, { kind: "max", moveId: MoveId.MAX_STEELSPIKE });
      const zMax = convert(player, MoveId.DOUBLE_IRON_BASH, { kind: "zMax", moveId: MoveId.MAX_STEELSPIKE });
      vi.spyOn(enemy, "randBattleSeedIntRange").mockReturnValue(100);

      game.move.select(MoveId.BULLET_PUNCH);
      await game.move.forceEnemyMove(MoveId.MAX_GUARD);
      await game.toNextTurn();
      expect(enemy).toHaveFullHp();

      // The enemy's chained Max Guard always succeeds here
      vi.spyOn(enemy, "randBattleSeedInt").mockReturnValue(0);
      const full = forecast(player, enemy, zMax);
      game.move.select(MoveId.DOUBLE_IRON_BASH);
      await game.move.forceEnemyMove(MoveId.MAX_GUARD);
      await game.toEndOfTurn();
      expect(enemy.getMaxHp() - enemy.hp).toBe(toDmgValue(full * MOVE_TRANSFORM_RULES.zMaxProtectPierce));
    });

    it("Feint does not get through Max Guard", async () => {
      await startMelmetal([MoveId.FEINT]);
      const enemy = game.field.getEnemyPokemon();

      game.move.select(MoveId.FEINT);
      await game.move.forceEnemyMove(MoveId.MAX_GUARD);
      await game.toEndOfTurn();
      expect(enemy).toHaveFullHp();
    });

    it("Z칼춤 resets lowered stats before the +2 (Z-Power after the move text); Z다이검무 gives +4", async () => {
      const player = await startMelmetal();
      convert(player, MoveId.SWORDS_DANCE, { kind: "z", moveId: MoveId.SWORDS_DANCE });
      player.setStatStage(Stat.ATK, -2);

      game.move.select(MoveId.SWORDS_DANCE);
      await game.toNextTurn();
      expect(player).toHaveStatStage(Stat.ATK, 2);

      convert(player, MoveId.SWORDS_DANCE, { kind: "zMax", moveId: MoveId.MAX_SWORDS_DANCE });
      player.setStatStage(Stat.ATK, 0);
      game.move.select(MoveId.SWORDS_DANCE);
      await game.toNextTurn();
      expect(player).toHaveStatStage(Stat.ATK, 4);
    });

    it("Earthquake made Max Quake hits one target (doubles), not the partner", async () => {
      game.override.battleStyle("double");
      await game.classicMode.startBattle(SpeciesId.MELMETAL, SpeciesId.SHUCKLE);
      const [player, partner] = game.scene.getPlayerField();
      game.move.changeMoveset(player, [MoveId.EARTHQUAKE]);
      game.move.changeMoveset(partner, [MoveId.SPLASH]);
      const [enemy1, enemy2] = game.scene.getEnemyField();
      const quake = convert(player, MoveId.EARTHQUAKE, { kind: "max", moveId: MoveId.MAX_QUAKE });
      expect(getMoveTargets(player, quake.getMove()).multiple).toBe(false);

      game.move.select(MoveId.EARTHQUAKE, BattlerIndex.PLAYER, BattlerIndex.ENEMY_2);
      game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
      await game.toEndOfTurn();

      expect(enemy2.hp).toBeLessThan(enemy2.getMaxHp());
      expect(enemy1).toHaveFullHp();
      expect(partner).toHaveFullHp();
    });

    it("an enemy with a converted slot (Training Session copy) picks moves without crashing", async () => {
      await startMelmetal();
      const enemy = game.field.getEnemyPokemon() as EnemyPokemon;
      game.move.changeMoveset(enemy, [MoveId.BULLET_PUNCH, MoveId.SPLASH]);
      convert(enemy, MoveId.BULLET_PUNCH, { kind: "max", moveId: MoveId.MAX_STEELSPIKE });
      enemy.aiType = AiType.SMART;

      const next = enemy.getNextMove();
      expect([MoveId.BULLET_PUNCH, MoveId.SPLASH]).toContain(next.move);
      expect(next.targets.length).toBeGreaterThan(0);

      game.move.select(MoveId.TAIL_WHIP);
      await game.toNextTurn();
      expect(enemy.getLastXMoves(1)[0]).toBeDefined();
    });
  });
});
