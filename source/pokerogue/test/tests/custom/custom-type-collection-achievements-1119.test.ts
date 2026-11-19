// Local fork (2026-11-19), new achievements for 1.2.0. The user: "새 업적으로 각 타입에 해당하는 포켓몬 수집을
// 넣어둡시다".
// - One Pokédex collection per type (TypeCollectionAchv, 18): every species whose default form has the type as its
//   first or second type caught, regional ones included and Eternatus left out, as the other collections ask.
// - Checked like the other Pokédex collections (dexCollectionAchvs): with a catch, a hatch, an evolution or a form,
//   and as a run starts. Named "<타입>타입 수집가", with the types' Tera Shards for icons.

import { speciesDataRegistry } from "#app/global-species-data-registry";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { PokemonType, type RegularPokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { TitlePhase } from "#phases/title-phase";
import { achvs, dexCollectionAchvs, getSpeciesOfType, TypeCollectionAchv } from "#system/achv";
import { GameManager } from "#test/framework/game-manager";
import { getAppRootDir } from "#test/utils/sprite-utils";
import fs from "node:fs";
import path from "node:path";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** The 18 types, in their order */
const TYPES: RegularPokemonType[] = [
  PokemonType.NORMAL,
  PokemonType.FIGHTING,
  PokemonType.FLYING,
  PokemonType.POISON,
  PokemonType.GROUND,
  PokemonType.ROCK,
  PokemonType.BUG,
  PokemonType.GHOST,
  PokemonType.STEEL,
  PokemonType.FIRE,
  PokemonType.WATER,
  PokemonType.GRASS,
  PokemonType.ELECTRIC,
  PokemonType.PSYCHIC,
  PokemonType.ICE,
  PokemonType.DRAGON,
  PokemonType.DARK,
  PokemonType.FAIRY,
];

const typeAchvs = (): TypeCollectionAchv[] =>
  Object.values(achvs).filter((a): a is TypeCollectionAchv => a instanceof TypeCollectionAchv);

const readJson = (...parts: string[]) => JSON.parse(fs.readFileSync(path.join(getAppRootDir(), ...parts), "utf8"));

describe("Local fork - type collection achievements (타입 수집가)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  const unlocked = (achv: { id: string }): boolean => Object.hasOwn(game.scene.gameData.achvUnlocks, achv.id);

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(100)
      .enemyLevel(5);
  });

  it("has one per type, in the order of the types, right before the last achievement", () => {
    const list = typeAchvs();
    expect(list.map(a => a.type)).toEqual(TYPES);
    expect(list.map(a => a.id)).toEqual(TYPES.map(t => `TYPE_COLLECTOR_${PokemonType[t]}`));
    // Checked wherever the other Pokédex collections are
    for (const achv of list) {
      expect(dexCollectionAchvs).toContain(achv);
    }
    const keys = Object.keys(achvs);
    expect(keys.at(-1)).toBe("THE_END");
    expect(keys.slice(-19, -1)).toEqual(list.map(a => a.id));
    // The ones before are where they were
    expect(keys.at(-20)).toBe("ALL_LEGENDARY");
  });

  it("uses each type's Tera Shard for its icon, scores like the other full collections and is not hidden", () => {
    const atlas = readJson("assets", "images", "items.json");
    const frames = new Set<string>(atlas.textures[0].frames.map((f: { filename: string }) => f.filename));
    for (const achv of typeAchvs()) {
      expect(achv.iconImage).toBe(`${PokemonType[achv.type].toLowerCase()}_tera_shard`);
      expect(frames.has(achv.iconImage), achv.iconImage).toBe(true);
      expect(achv.iconAtlas).toBe("items");
      expect(achv.score).toBe(achvs.ALL_MYTHICAL.score);
      expect(achv.secret).toBeFalsy();
    }
  });

  it("has a name and a description in Korean and English", () => {
    const ko = readJson("locales", "ko", "achv.json");
    const en = readJson("locales", "en", "achv.json");
    const koTypes = readJson("locales", "ko", "pokemon-info.json").type;
    const enTypes = readJson("locales", "en", "pokemon-info.json").type;
    for (const achv of typeAchvs()) {
      const typeKey = PokemonType[achv.type].toLowerCase();
      const key = achv.localizationKey;
      expect(key).toBe(`typeCollector${enTypes[typeKey]}`);
      expect(ko[key].name).toBe(`${koTypes[typeKey]}타입 수집가`);
      expect(ko[key].name_female).toBe(ko[key].name);
      expect(en[key].name).toBe(`${enTypes[typeKey]}-type Collector`);
      expect(en[key].name_female).toBe(en[key].name);
      expect(ko[key].description).toContain(`${koTypes[typeKey]}타입 포켓몬 {{amount}}종을 모두 수집`);
      expect(en[key].description).toContain(`Collect all {{amount}} ${enTypes[typeKey]}-type Pokémon`);
      // Eternatus is only named where it would count
      const eternatusOut = achv.type === PokemonType.POISON || achv.type === PokemonType.DRAGON;
      expect(ko[key].description.includes("무한다이노를 뺀"), key).toBe(eternatusOut);
      expect(en[key].description.includes("but Eternatus"), key).toBe(eternatusOut);
      // The achievement bar and the achievements screen wrap only at spaces (custom-dex-achievements-1118)
      const koText = String(ko[key].description).replace("{{amount}}", String(achv.getGoals().length));
      for (const word of koText.split(" ")) {
        expect(word.length, `${key}: ${word}`).toBeLessThanOrEqual(16);
      }
      expect(koText.length, key).toBeLessThanOrEqual(52);
      expect(achv.description).not.toContain("{{");
    }
  });

  it("asks for every species whose default form has the type, regional ones included, and for no other", () => {
    const goalsOf = (type: RegularPokemonType) =>
      typeAchvs()
        .find(a => a.type === type)!
        .getGoals();
    // Dual types count for both
    expect(goalsOf(PokemonType.FIRE)).toContain(SpeciesId.CHARIZARD);
    expect(goalsOf(PokemonType.FLYING)).toContain(SpeciesId.CHARIZARD);
    expect(goalsOf(PokemonType.NORMAL)).toContain(SpeciesId.JIGGLYPUFF);
    expect(goalsOf(PokemonType.FAIRY)).toContain(SpeciesId.JIGGLYPUFF);
    // Regional forms are their own species, with their own types
    expect(goalsOf(PokemonType.ICE)).toContain(SpeciesId.ALOLA_VULPIX);
    expect(goalsOf(PokemonType.FIRE)).toContain(SpeciesId.VULPIX);
    expect(goalsOf(PokemonType.FIRE)).not.toContain(SpeciesId.ALOLA_VULPIX);
    expect(goalsOf(PokemonType.GHOST)).toContain(SpeciesId.ALOLA_MAROWAK);
    expect(goalsOf(PokemonType.PSYCHIC)).toContain(SpeciesId.ALOLA_RAICHU);
    // Only the default form's types: Rotom is Electric/Ghost, Arceus and Silvally Normal, Oricorio Fire/Flying
    expect(goalsOf(PokemonType.ELECTRIC)).toContain(SpeciesId.ROTOM);
    expect(goalsOf(PokemonType.GHOST)).toContain(SpeciesId.ROTOM);
    expect(goalsOf(PokemonType.FIRE)).not.toContain(SpeciesId.ROTOM);
    expect(goalsOf(PokemonType.NORMAL)).toEqual(expect.arrayContaining([SpeciesId.ARCEUS, SpeciesId.SILVALLY]));
    expect(goalsOf(PokemonType.DRAGON)).not.toContain(SpeciesId.ARCEUS);
    expect(goalsOf(PokemonType.FIRE)).toContain(SpeciesId.ORICORIO);
    expect(goalsOf(PokemonType.ELECTRIC)).not.toContain(SpeciesId.ORICORIO);
    // Legendary and Mythical Pokémon too, but not Eternatus (as for 전설의 포켓몬 수집가)
    expect(goalsOf(PokemonType.FIRE)).toEqual(expect.arrayContaining([SpeciesId.HO_OH, SpeciesId.VICTINI]));
    expect(goalsOf(PokemonType.POISON)).not.toContain(SpeciesId.ETERNATUS);
    expect(goalsOf(PokemonType.DRAGON)).not.toContain(SpeciesId.ETERNATUS);
    expect(goalsOf(PokemonType.DRAGON)).toContain(SpeciesId.RAYQUAZA);

    const all = speciesDataRegistry.getAllSpecies();
    let expectedTotal = 0;
    for (const species of all) {
      if (species.speciesId === SpeciesId.ETERNATUS) {
        continue;
      }
      const form = species.forms[0] ?? species;
      const types = [form.type1, form.type2].filter(t => t != null);
      expectedTotal += new Set(types).size;
      // Every other species is asked for by the collection of each of its types, by no other
      for (const type of TYPES) {
        expect(
          getSpeciesOfType(type).includes(species.speciesId),
          `${PokemonType[type]} ${SpeciesId[species.speciesId]}`,
        ).toBe(types.includes(type));
      }
    }
    let total = 0;
    for (const achv of typeAchvs()) {
      const goals = achv.getGoals();
      expect(goals.length, achv.id).toBeGreaterThan(40);
      expect(new Set(goals).size, achv.id).toBe(goals.length);
      for (const goal of goals) {
        // Species, not forms, and each one a starter or evolving from one so eggs can give it
        expect(typeof goal, achv.id).toBe("number");
        const species = speciesDataRegistry.getSpecies(goal as SpeciesId);
        expect(
          speciesDataRegistry.isStarter(species.getRootSpeciesId()),
          `${achv.id} ${SpeciesId[goal as SpeciesId]}`,
        ).toBe(true);
      }
      total += goals.length;
    }
    expect(total).toBe(expectedTotal);
  });

  it("unlocks a type once the Pokédex has every Pokémon of it, checked with the next catch", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const { gameData } = game.scene;
    for (const achv of typeAchvs()) {
      delete gameData.achvUnlocks[achv.id];
    }
    const ice = achvs.TYPE_COLLECTOR_ICE.getGoals().filter(id => id !== SpeciesId.ALOLA_VULPIX) as SpeciesId[];
    for (const id of ice) {
      gameData.dexData[id].caughtAttr = 1n;
    }
    gameData.dexData[SpeciesId.ALOLA_VULPIX].caughtAttr = 0n;
    // Ordinary Vulpix does not stand in for the Alolan one
    gameData.dexData[SpeciesId.VULPIX].caughtAttr = 1n;
    expect(achvs.TYPE_COLLECTOR_ICE.validate()).toBe(false);

    // Catching the last one, a regional form, through the Pokédex
    const last = game.scene.addPlayerPokemon(speciesDataRegistry.getSpecies(SpeciesId.ALOLA_VULPIX), 50);
    await gameData.setPokemonCaught(last, true, false, false);
    expect(unlocked(achvs.TYPE_COLLECTOR_ICE)).toBe(true);
    expect(unlocked(achvs.TYPE_COLLECTOR_FIRE)).toBe(false);
  });

  it("unlocks the ones an older save already meets when a run starts (TitlePhase.end)", async () => {
    await game.runToTitle();
    const { gameData, phaseManager } = game.scene;
    for (const achv of typeAchvs()) {
      delete gameData.achvUnlocks[achv.id];
    }
    // Fairy first: the Dark and Fairy ones (Grimmsnarl) are then caught again with the Dark ones
    for (const id of achvs.TYPE_COLLECTOR_FAIRY.getGoals() as SpeciesId[]) {
      gameData.dexData[id].caughtAttr = 0n;
    }
    for (const id of achvs.TYPE_COLLECTOR_DARK.getGoals() as SpeciesId[]) {
      gameData.dexData[id].caughtAttr = 1n;
    }
    // Only the end of the title screen, without starting the phases it queues
    vi.spyOn(phaseManager, "pushNew").mockReturnValue(undefined as never);
    vi.spyOn(phaseManager, "shiftPhase").mockReturnValue(undefined as never);
    const title = new TitlePhase();
    title.gameMode = GameModes.CLASSIC;
    title.end();
    vi.restoreAllMocks();
    expect(unlocked(achvs.TYPE_COLLECTOR_DARK)).toBe(true);
    expect(unlocked(achvs.TYPE_COLLECTOR_FAIRY)).toBe(false);
  });
});
