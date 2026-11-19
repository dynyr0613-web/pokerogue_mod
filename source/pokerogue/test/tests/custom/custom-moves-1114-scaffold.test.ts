// Local fork (2026-11-14): custom moves. Checks the scaffold of the four custom moves (승화 / 정원가꾸기 / 쇄빙참 /
// 뒤통수치기), the two abilities (정원사 / 전세역전) and the Garden (정원) tag: enum position after NIHIL_LIGHT (relative
// checks, no hard-coded ids), `allMoves` indexing, the numbers from tools/drive/custom_moves_1114/design_spec.json, the
// ko and en locale texts and the reused battle animations. Effects and learnsets: custom-moves-1114.test.ts.

import { allAbilities, allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import { PokemonType } from "#enums/pokemon-type";
import { toCamelCase, toKebabCase } from "#utils/strings";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The custom moves in enum order, with their numbers from design_spec.json */
const MOVES = [
  {
    id: MoveId.SUBLIMATION,
    type: PokemonType.FIRE,
    category: MoveCategory.SPECIAL,
    power: 80,
    accuracy: 100,
    pp: 15,
    target: MoveTarget.NEAR_OTHER,
    contact: false,
    slicing: false,
    anim: "steam-eruption",
    ko: "승화",
    en: "Sublimation",
  },
  {
    id: MoveId.GARDENING,
    type: PokemonType.GRASS,
    category: MoveCategory.STATUS,
    power: -1,
    accuracy: -1,
    pp: 10,
    target: MoveTarget.USER_SIDE,
    contact: false,
    slicing: false,
    anim: "grassy-terrain",
    ko: "정원가꾸기",
    en: "Gardening",
  },
  {
    id: MoveId.ICEBREAKER,
    type: PokemonType.ICE,
    category: MoveCategory.PHYSICAL,
    power: 70,
    accuracy: 100,
    pp: 10,
    target: MoveTarget.NEAR_OTHER,
    contact: true,
    slicing: true,
    anim: "aqua-cutter",
    ko: "쇄빙참",
    en: "Icebreaker",
  },
  {
    id: MoveId.BLINDSIDE,
    type: PokemonType.DARK,
    category: MoveCategory.PHYSICAL,
    power: 70,
    accuracy: 100,
    pp: 20,
    target: MoveTarget.NEAR_OTHER,
    contact: true,
    slicing: false,
    anim: "sucker-punch",
    ko: "뒤통수치기",
    en: "Blindside",
  },
] as const;

const ABILITIES = [
  { id: AbilityId.GARDENER, ko: "정원사", en: "Gardener" },
  { id: AbilityId.TURNABOUT, ko: "전세역전", en: "Turnabout" },
] as const;

/** `arenaTag` keys of the Garden; the side-less pair is for a BOTH-side tag (tests only) */
const GARDEN_TAG_KEYS = [
  "gardenOnAdd",
  "gardenOnAddPlayer",
  "gardenOnAddEnemy",
  "gardenOnRemove",
  "gardenOnRemovePlayer",
  "gardenOnRemoveEnemy",
] as const;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8"));
}

describe("Custom moves 2026-11-14 scaffold", () => {
  // Local fork (2026-11-16): Z-Moves and Max Moves. The 33 G-Max moves and 다이검무 were appended after Blindside
  // (ids 925-958), so Blindside is no longer the last id; the Z/Max block ends at MAX_SWORDS_DANCE
  it("appends the four moves right after Nihil Light, followed only by the Z/Max block", () => {
    MOVES.forEach(({ id }, index) => {
      expect(id, MoveId[id]).toBe(MoveId.NIHIL_LIGHT + 1 + index);
    });
    expect(MoveId.G_MAX_WILDFIRE).toBe(MoveId.BLINDSIDE + 1);
    expect(MoveId[MoveId.MAX_SWORDS_DANCE + 1]).toBeUndefined();
  });

  it("registers every move at the index of its id", () => {
    expect(allMoves.length).toBe(MoveId.MAX_SWORDS_DANCE + 1);
    expect(allMoves.every((move, index) => move.id === index)).toBe(true);
  });

  it.each(MOVES)("registers $en with the spec's type, category, numbers, target and flags", move => {
    const registered = allMoves[move.id];
    expect(registered.type).toBe(move.type);
    expect(registered.category).toBe(move.category);
    expect(registered.power).toBe(move.power);
    expect(registered.accuracy).toBe(move.accuracy);
    expect(registered.pp).toBe(move.pp);
    expect(registered.priority).toBe(0);
    expect(registered.chance).toBe(-1);
    expect(registered.generation).toBe(9);
    expect(registered.moveTarget).toBe(move.target);
    expect(registered.hasFlag(MoveFlags.MAKES_CONTACT)).toBe(move.contact);
    expect(registered.hasFlag(MoveFlags.SLICING_MOVE)).toBe(move.slicing);
  });

  it.each(["ko", "en"] as const)("has a %s name and effect for each move", lang => {
    const locale = readJson<Record<string, { name?: string; effect?: string }>>(`locales/${lang}/move.json`);
    for (const move of MOVES) {
      const entry = locale[toCamelCase(MoveId[move.id])];
      expect(entry?.name, MoveId[move.id]).toBe(move[lang]);
      expect(entry?.effect, MoveId[move.id]).toBeTruthy();
    }
  });

  // Tests load the en locale. Stage 2 dropped the placeholders' `.unimplemented()`, so no " (N)" is appended any more
  it("resolves each move name at run time", () => {
    for (const move of MOVES) {
      expect(allMoves[move.id].name, MoveId[move.id]).toBe(move.en);
    }
  });

  // Local fork (2026-11-19): 1.2.0 D12 (the user: "d12 실행") appended Archmage / Wicked Scheme / Grit after Turnabout,
  // so Turnabout is no longer the last member; the end of the enum is pinned in custom-abilities-1114-scaffold.test.ts
  it("appends Gardener and Turnabout right after Clearing Gust, followed only by later custom abilities", () => {
    expect(AbilityId.GARDENER).toBe(AbilityId.CLEARING_GUST + 1);
    expect(AbilityId.TURNABOUT).toBe(AbilityId.CLEARING_GUST + 2);
    expect(AbilityId[AbilityId.TURNABOUT + 1]).toBe("ARCHMAGE");
    expect(allAbilities[AbilityId.GARDENER].id).toBe(AbilityId.GARDENER);
    expect(allAbilities[AbilityId.TURNABOUT].id).toBe(AbilityId.TURNABOUT);
  });

  it.each(["ko", "en"] as const)("has a %s name and description for each ability", lang => {
    const locale = readJson<Record<string, { name?: string; description?: string }>>(`locales/${lang}/ability.json`);
    for (const ability of ABILITIES) {
      const entry = locale[toCamelCase(AbilityId[ability.id])];
      expect(entry?.name, AbilityId[ability.id]).toBe(ability[lang]);
      expect(entry?.description, AbilityId[ability.id]).toBeTruthy();
    }
  });

  it("resolves each ability name and description at run time", () => {
    for (const ability of ABILITIES) {
      expect(allAbilities[ability.id].name).toBe(ability.en);
      expect(allAbilities[ability.id].description).toBeTruthy();
    }
  });

  it.each(["ko", "en"] as const)("has the %s Garden messages and field flyout name", lang => {
    const tags = readJson<Record<string, string>>(`locales/${lang}/arena-tag.json`);
    for (const key of GARDEN_TAG_KEYS) {
      expect(tags[key], key).toBeTruthy();
    }
    const flyout = readJson<Record<string, string>>(`locales/${lang}/arena-flyout.json`);
    expect(flyout[toCamelCase(ArenaTagType.GARDEN)]).toBe(lang === "ko" ? "정원" : "Garden");
  });

  // Tests replace every battle animation with Tackle's, so only the files are checked here
  it.each(MOVES)("has a battle animation file for $en (a copy of $anim)", ({ id, anim }) => {
    const path = `assets/battle-anims/${toKebabCase(MoveId[id])}.json`;
    expect(existsSync(path), path).toBe(true);
    const copied = readJson<unknown>(path);
    expect(copied).toEqual(readJson<unknown>(`assets/battle-anims/${anim}.json`));
  });
});
