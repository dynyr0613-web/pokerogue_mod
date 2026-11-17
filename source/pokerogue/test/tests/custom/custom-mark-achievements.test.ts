// Local fork (2026-11-17): achievements for collecting marks and ribbons (achv.ts, GameData.registerMarks). The user:
// "증표를 수집 요소로 넣었으니까 업적에도 증표 수집 관련을 넣어둡시다 / 10개의 우두머리 증표 수집, 100개의 우두머리 증표
// 수집, 모든 포켓몬의 우두머리 증표 수집 등등".
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { ALPHA_MAX_BOOST } from "#data/alpha-pokemon";
import { awardTrainerRibbon, getMarkKey, TRAINER_RIBBONS, WILD_MARKS } from "#data/pokemon-marks";
import { MoveId } from "#enums/move-id";
import { PokeballType } from "#enums/pokeball";
import { PokemonMark } from "#enums/pokemon-mark";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { ALL_KINDS_MARKS, achvs, markCollectionAchvs } from "#system/achv";
import { GameManager } from "#test/framework/game-manager";
import { getAppRootDir } from "#test/utils/sprite-utils";
import fs from "node:fs";
import path from "node:path";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Local fork - mark collection achievements", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  const unlocked = (achv: { id: string }): boolean => Object.hasOwn(game.scene.gameData.achvUnlocks, achv.id);

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").enemySpecies(SpeciesId.MAGIKARP).enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MILOTIC);
    game.scene.gameData.markCounts = {};
    for (const achv of markCollectionAchvs) {
      delete game.scene.gameData.achvUnlocks[achv.id];
    }
  });

  it("has a name, a description and a mark icon for each, in both languages", () => {
    expect(markCollectionAchvs).toHaveLength(11);
    const root = getAppRootDir();
    const atlas = JSON.parse(fs.readFileSync(path.join(root, "assets", "images", "marks", "marks.json"), "utf8"));
    const frames = new Set<string>(atlas.textures[0].frames.map((f: { filename: string }) => f.filename));
    for (const lang of ["en", "ko"]) {
      const texts = JSON.parse(fs.readFileSync(path.join(root, "locales", lang, "achv.json"), "utf8"));
      for (const achv of markCollectionAchvs) {
        expect(texts[achv.localizationKey]?.name, `${lang} ${achv.localizationKey}`).toBeTruthy();
        expect(texts[achv.localizationKey]?.description, `${lang} ${achv.localizationKey}`).toBeTruthy();
        expect(achv.iconAtlas).toBe("marks");
        expect(frames.has(achv.iconImage), achv.iconImage).toBe(true);
      }
    }
    // The other achievements still take their icon from the items
    expect(achvs.CLASSIC_VICTORY.iconAtlas).toBe("items");
  });

  // Local fork (2026-11-17), review: the 10 / 100 marks texts said any mark counts, but only the 41 wild marks do (the
  // alpha, size, shiny and Partner marks are 증표 too); and "이로치" is not the game's word ("색이 다른")
  it("says in its texts which marks count", () => {
    const root = getAppRootDir();
    const ko = JSON.parse(fs.readFileSync(path.join(root, "locales", "ko", "achv.json"), "utf8"));
    const en = JSON.parse(fs.readFileSync(path.join(root, "locales", "en", "achv.json"), "utf8"));
    for (const key of ["marks10", "marks100"]) {
      expect(ko[key].description).toContain("일반 증표");
      expect(en[key].description).toContain("wild mark");
    }
    // The same name as in the every-kind achievement's text
    expect(ko.marksAllKinds.description).toContain("일반 증표 41종");
    expect(ko.marksAllKinds.description).not.toContain("이로치");
    for (const name of ["커다란", "조그만", "파트너의증표", "빛나는", "찬란한", "눈부신증표"]) {
      expect(ko.marksAllKinds.description).toContain(name);
    }
  });

  it("counts a caught Pokémon's marks and unlocks the 10 Alpha Marks achievement on the tenth", async () => {
    const { gameData } = game.scene;
    for (let i = 1; i <= 10; i++) {
      expect(unlocked(achvs.ALPHA_MARKS_10)).toBe(false);
      const wild = game.field.getEnemyPokemon();
      wild.alphaBoost = 0;
      wild.marks = [];
      wild.setAlphaBoost(5);
      const caught = wild.addToParty(PokeballType.POKEBALL)!;
      await gameData.setPokemonCaught(caught, true, false, false);
      expect(gameData.markCounts[PokemonMark.ALPHA_MARK]).toBe(i);
      game.scene.getPlayerParty().pop();
    }
    expect(unlocked(achvs.ALPHA_MARKS_10)).toBe(true);
    expect(unlocked(achvs.ALPHA_MARKS_100)).toBe(false);
    expect(unlocked(achvs.GOLDEN_ALPHA_MARK)).toBe(false);
    expect(unlocked(achvs.MARKS_10)).toBe(false);

    gameData.markCounts[PokemonMark.ALPHA_MARK] = 99;
    gameData.registerMarks([PokemonMark.ALPHA_MARK, PokemonMark.GOLDEN_ALPHA_MARK]);
    expect(unlocked(achvs.ALPHA_MARKS_100)).toBe(true);
    expect(unlocked(achvs.GOLDEN_ALPHA_MARK)).toBe(true);
    expect(unlocked(achvs.GOLDEN_ALPHA_MARKS_10)).toBe(false);
    gameData.markCounts[PokemonMark.GOLDEN_ALPHA_MARK] = 9;
    gameData.registerMarks([PokemonMark.GOLDEN_ALPHA_MARK]);
    expect(unlocked(achvs.GOLDEN_ALPHA_MARKS_10)).toBe(true);
  });

  it("does not count a Pokémon that is only registered, not caught", async () => {
    const pokemon = game.field.getPlayerPokemon();
    pokemon.setAlphaBoost(ALPHA_MAX_BOOST);
    await game.scene.gameData.setPokemonCaught(pokemon, false, false, false);
    expect(game.scene.gameData.markCounts).toEqual({});
  });

  it("unlocks the wild mark achievements by number and by kind", () => {
    const { gameData } = game.scene;
    const wildMarks = WILD_MARKS;
    expect(wildMarks).toHaveLength(41);

    // Alpha marks and ribbons are not wild marks
    gameData.markCounts[PokemonMark.ALPHA_MARK] = 500;
    gameData.registerMarks(new Array(9).fill(PokemonMark.RARE_MARK));
    expect(unlocked(achvs.MARKS_10)).toBe(false);
    gameData.registerMarks([PokemonMark.DAWN_MARK]);
    expect(unlocked(achvs.MARKS_10)).toBe(true);
    expect(unlocked(achvs.MARKS_100)).toBe(false);

    gameData.registerMarks(new Array(90).fill(PokemonMark.UNCOMMON_MARK));
    expect(unlocked(achvs.MARKS_100)).toBe(true);
    expect(unlocked(achvs.MARKS_ALL_KINDS)).toBe(false);

    // Every kind: the 41 wild marks and the Jumbo, Mini, Partner and three shiny marks
    expect(ALL_KINDS_MARKS).toHaveLength(47);
    gameData.registerMarks(wildMarks);
    expect(unlocked(achvs.MARKS_ALL_KINDS)).toBe(false);
    const others = ALL_KINDS_MARKS.filter(m => !wildMarks.includes(m));
    expect(others).toEqual([
      PokemonMark.JUMBO_MARK,
      PokemonMark.MINI_MARK,
      PokemonMark.PARTNER_MARK,
      PokemonMark.SHINY_MARK,
      PokemonMark.RARE_SHINY_MARK,
      PokemonMark.EPIC_SHINY_MARK,
    ]);
    gameData.registerMarks(others.slice(1));
    expect(unlocked(achvs.MARKS_ALL_KINDS)).toBe(false);
    gameData.registerMarks([others[0]]);
    expect(unlocked(achvs.MARKS_ALL_KINDS)).toBe(true);
  });

  it("unlocks the every-species achievements once every starter line has its alpha", () => {
    const { gameData } = game.scene;
    const starters = speciesDataRegistry.getAllStarters();
    for (const id of starters) {
      gameData.starterData[id].alphaBoost = 3;
    }
    gameData.starterData[starters[0]].alphaBoost = undefined;
    gameData.registerMarks([PokemonMark.ALPHA_MARK]);
    expect(unlocked(achvs.ALPHA_MARKS_ALL_SPECIES)).toBe(false);

    gameData.starterData[starters[0]].alphaBoost = 1;
    gameData.registerMarks([PokemonMark.ALPHA_MARK]);
    expect(unlocked(achvs.ALPHA_MARKS_ALL_SPECIES)).toBe(true);
    expect(unlocked(achvs.GOLDEN_ALPHA_MARKS_ALL_SPECIES)).toBe(false);

    for (const id of starters) {
      gameData.starterData[id].alphaBoost = ALPHA_MAX_BOOST;
    }
    gameData.registerMarks([PokemonMark.GOLDEN_ALPHA_MARK]);
    expect(unlocked(achvs.GOLDEN_ALPHA_MARKS_ALL_SPECIES)).toBe(true);
    for (const id of starters) {
      gameData.starterData[id].alphaBoost = undefined;
    }
  });

  it("counts awarded ribbons and unlocks the ribbon achievements", () => {
    const { gameData } = game.scene;
    expect(awardTrainerRibbon(TrainerType.CYNTHIA)).toBe(PokemonMark.SINNOH_CHAMPION_RIBBON);
    // One for each of the two party members
    expect(gameData.markCounts[PokemonMark.SINNOH_CHAMPION_RIBBON]).toBe(2);
    expect(unlocked(achvs.MEMORIAL_RIBBON)).toBe(true);
    expect(unlocked(achvs.MEMORIAL_RIBBONS_ALL_KINDS)).toBe(false);
    // The same ribbon again gives nothing new
    awardTrainerRibbon(TrainerType.CYNTHIA);
    expect(gameData.markCounts[PokemonMark.SINNOH_CHAMPION_RIBBON]).toBe(2);

    for (const type of Object.keys(TRAINER_RIBBONS).map(Number)) {
      awardTrainerRibbon(type);
    }
    expect(unlocked(achvs.MEMORIAL_RIBBONS_ALL_KINDS)).toBe(true);
  });

  it("saves the collection with the system data", () => {
    const { gameData } = game.scene;
    gameData.registerMarks([PokemonMark.RARE_MARK, PokemonMark.RARE_MARK, PokemonMark.ALPHA_MARK]);
    const saved = JSON.parse(JSON.stringify(gameData.getSystemSaveData().markCounts));
    expect(saved).toEqual({ [PokemonMark.RARE_MARK]: 2, [PokemonMark.ALPHA_MARK]: 1 });
    expect(getMarkKey(PokemonMark.RARE_MARK)).toBe("rareMark");
  });
});
