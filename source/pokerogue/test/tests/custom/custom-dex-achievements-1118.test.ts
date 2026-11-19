// Local fork (2026-11-18), second round on the hidden marks and new achievements. The user:
// "운명의 포켓몬은 그냥 운으로 찾게 포획/알까기 시 1% 확률로 나오게 해두죠 / 습득의 증표는 픽업 특성이 있는 포켓몬만
// 획득 가능하니 그것도 제외해야 할 것 같고 / 업적이나 좀 추가해둡시다 / "고대의 거인들"(레지시리즈 전부 모으기) ...
// 이외에도 환상 전부 수집, 준전설 전부 수집 등등".
// - The Destiny Mark comes by luck, 1 in 100, with a Pokémon that is caught or hatched (rollDestinyMark), no more on
//   the wave of its Pokédex number.
// - The last achievement (완주) no longer asks for the Itemfinder Mark.
// - Pokédex collection achievements (DexCollectionAchv): groups caught, forms taken.

import { speciesDataRegistry } from "#app/global-species-data-registry";
import { NON_LEGEND_PARADOX_POKEMON, NON_LEGEND_ULTRA_BEASTS } from "#balance/special-species-groups";
import { COMPLETION_EXEMPT_MARKS, DESTINY_MARK_ONE_IN, rollDestinyMark } from "#data/pokemon-marks";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { PokeballType } from "#enums/pokeball";
import { PokemonMark } from "#enums/pokemon-mark";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { TitlePhase } from "#phases/title-phase";
import { achvs, type DexGoal, dexCollectionAchvs, isDexGoalMet, THE_END_MARKS } from "#system/achv";
import { GameManager } from "#test/framework/game-manager";
import { getAppRootDir } from "#test/utils/sprite-utils";
import fs from "node:fs";
import path from "node:path";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Local fork - Destiny Mark by luck, Itemfinder Mark out of 완주, Pokédex collection achievements", () => {
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

  /** The first Pokémon id from `start` that the Destiny roll favours for this Pokémon, found on a copy of its marks */
  function findDestinyId(pokemon: Pokemon, lucky: boolean, start = 1): number {
    const savedId = pokemon.id;
    const savedMarks = pokemon.marks.slice();
    for (let id = start; id < start + 5000; id++) {
      pokemon.id = id;
      pokemon.marks = savedMarks.filter(m => m !== PokemonMark.DESTINY_MARK);
      if (rollDestinyMark(pokemon) === lucky) {
        pokemon.id = savedId;
        pokemon.marks = savedMarks;
        return id;
      }
    }
    throw new Error("no id found");
  }

  it("gives the Destiny Mark to about 1 Pokémon in 100, the same answer for the same Pokémon", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    expect(DESTINY_MARK_ONE_IN).toBe(100);
    const probe = game.field.getEnemyPokemon();
    let hits = 0;
    const trials = 4000;
    for (let id = 1; id <= trials; id++) {
      probe.id = id;
      probe.marks = [];
      if (rollDestinyMark(probe)) {
        hits++;
        expect(probe.hasMark(PokemonMark.DESTINY_MARK)).toBe(true);
        // Rolled again it is the same, and one it already has is not given twice
        probe.marks = [];
        expect(rollDestinyMark(probe)).toBe(true);
        expect(rollDestinyMark(probe)).toBe(false);
      }
    }
    // 40 expected; a wide band so the seed never makes it flaky
    expect(hits).toBeGreaterThan(15);
    expect(hits).toBeLessThan(75);
  });

  it("no longer gives a wild Pokémon the Destiny Mark on the wave of its Pokédex number", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    // Magikarp is number 129
    game.scene.currentBattle.waveIndex = 129;
    const magikarp = speciesDataRegistry.getSpecies(SpeciesId.MAGIKARP);
    for (let i = 0; i < 50; i++) {
      const wild = game.scene.addEnemyPokemon(magikarp, 20, 0, false);
      expect(wild.hasMark(PokemonMark.DESTINY_MARK)).toBe(false);
      wild.destroy();
    }
  });

  it("rolls it when a Pokémon is caught with a ball", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const enemy = game.field.getEnemyPokemon();
    enemy.id = findDestinyId(enemy, true);
    enemy.marks = enemy.marks.filter(m => m !== PokemonMark.DESTINY_MARK);

    game.scene.pokeballCounts[PokeballType.MASTER_BALL] = 1;
    game.doThrowPokeball(PokeballType.MASTER_BALL);
    await game.toNextWave();

    const caught = game.scene.getPlayerParty().find(p => p.species.speciesId === SpeciesId.MAGIKARP);
    expect(caught).toBeDefined();
    expect(caught!.hasMark(PokemonMark.DESTINY_MARK)).toBe(true);
    expect(game.scene.gameData.markCounts[PokemonMark.DESTINY_MARK]).toBe(1);
  });

  it("rolls it when an egg hatches, but not for a Pokémon that is given", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const { gameData } = game.scene;
    const species = speciesDataRegistry.getSpecies(SpeciesId.EEVEE);

    const hatched = game.scene.addPlayerPokemon(species, 1);
    hatched.id = findDestinyId(hatched, true);
    hatched.marks = [];
    await gameData.setPokemonCaught(hatched, true, true, false);
    expect(hatched.hasMark(PokemonMark.DESTINY_MARK)).toBe(true);

    // A gift with the same lucky id: no roll
    const gift = game.scene.addPlayerPokemon(species, 1);
    gift.id = hatched.id;
    gift.marks = [];
    await gameData.setPokemonCaught(gift, true, false, false);
    expect(gift.hasMark(PokemonMark.DESTINY_MARK)).toBe(false);

    // An unlucky hatch gets nothing
    const unlucky = game.scene.addPlayerPokemon(species, 1);
    unlucky.id = findDestinyId(unlucky, false);
    unlucky.marks = [];
    await gameData.setPokemonCaught(unlucky, true, true, false);
    expect(unlucky.hasMark(PokemonMark.DESTINY_MARK)).toBe(false);
  });

  it("describes the Destiny Mark as luck", () => {
    const root = getAppRootDir();
    const ko = JSON.parse(fs.readFileSync(path.join(root, "locales", "ko", "pokemon-marks.json"), "utf8"));
    const en = JSON.parse(fs.readFileSync(path.join(root, "locales", "en", "pokemon-marks.json"), "utf8"));
    expect(ko.destinyMark.description).toContain("1%");
    expect(ko.destinyMark.description).not.toContain("웨이브");
    expect(en.destinyMark.description).toContain("1%");
    expect(en.destinyMark.description).not.toContain("wave");
    // Review: the English text overflowed the mark dex's second line; no longer than the old one (59 characters)
    expect(en.destinyMark.description.length).toBeLessThanOrEqual(59);
  });

  it("the last achievement asks for every hidden mark but the Itemfinder Mark", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    const { gameData } = game.scene;
    expect(THE_END_MARKS).not.toContain(PokemonMark.ITEMFINDER_MARK);
    expect(THE_END_MARKS).toHaveLength(COMPLETION_EXEMPT_MARKS.length - 1);
    // The Itemfinder Mark is still a hidden mark, shown on the hidden page
    expect(COMPLETION_EXEMPT_MARKS).toContain(PokemonMark.ITEMFINDER_MARK);

    const keys = Object.keys(achvs);
    for (const id of keys.filter(k => k !== "THE_END")) {
      gameData.achvUnlocks[id] = 1;
    }
    for (const id of Object.keys(gameData.starterData).map(Number)) {
      gameData.dexData[id as SpeciesId].caughtAttr = 1n;
    }
    gameData.dexData[SpeciesId.ETERNATUS].caughtAttr = 1n;
    gameData.markCounts = {};
    for (const mark of THE_END_MARKS) {
      gameData.markCounts[mark] = 1;
    }
    expect(gameData.markCounts[PokemonMark.ITEMFINDER_MARK]).toBeUndefined();
    expect(achvs.THE_END.validate()).toBe(true);
    // Any other hidden mark is still needed
    delete gameData.markCounts[PokemonMark.DESTINY_MARK];
    expect(achvs.THE_END.validate()).toBe(false);
    const ko = JSON.parse(fs.readFileSync(path.join(getAppRootDir(), "locales", "ko", "achv.json"), "utf8"));
    expect(ko.theEnd.description).toContain("습득의증표를 뺀");
  });

  it("has the asked-for collection achievements with names, descriptions and item icons, before the last one", () => {
    const root = getAppRootDir();
    const atlas = JSON.parse(fs.readFileSync(path.join(root, "assets", "images", "items.json"), "utf8"));
    const frames = new Set<string>(atlas.textures[0].frames.map((f: { filename: string }) => f.filename));
    const ko = JSON.parse(fs.readFileSync(path.join(root, "locales", "ko", "achv.json"), "utf8"));
    const en = JSON.parse(fs.readFileSync(path.join(root, "locales", "en", "achv.json"), "utf8"));
    const names = Object.fromEntries(dexCollectionAchvs.map(a => [a.localizationKey, ko[a.localizationKey]?.name]));
    expect(names).toMatchObject({
      ancientGiants: "고대의 거인들",
      dawnAndDusk: "새벽과 황혼",
      timeSpaceAntimatter: "시간과 공간, 그리고 반물질",
      seaAndLand: "탄생의 바다와 종말의 대지",
      skyDragon: "천상의 용",
      ultraBeasts: "울트라 비스트",
      pastAndFuture: "과거와 미래",
      lifeAndDeath: "생명과 죽음",
      ruinousBeasts: "재앙의 네 짐승",
    });
    // Local fork (2026-11-19): and the 18 type collections (custom-type-collection-achievements-1119.test.ts)
    expect(dexCollectionAchvs).toHaveLength(19 + 18);
    for (const achv of dexCollectionAchvs) {
      for (const [lang, texts] of [
        ["ko", ko],
        ["en", en],
      ] as const) {
        expect(texts[achv.localizationKey]?.name, `${lang} ${achv.localizationKey}`).toBeTruthy();
        expect(texts[achv.localizationKey]?.description, `${lang} ${achv.localizationKey}`).toBeTruthy();
      }
      // Review: the text boxes wrap only at spaces (Phaser's basic word wrap), so no run without a space may be wider
      // than the achievement bar's line (912 at 72 px, about 18 Korean characters), and the whole text must fit the
      // achievements screen's two lines (1870 at 96 px each, about 28 Korean characters)
      const koText = String(ko[achv.localizationKey].description).replace("{{amount}}", String(achv.getGoals().length));
      for (const word of koText.split(" ")) {
        expect(word.length, `${achv.localizationKey}: ${word}`).toBeLessThanOrEqual(16);
      }
      expect(koText.length, achv.localizationKey).toBeLessThanOrEqual(52);
      expect(achv.description).not.toContain("{{");
      expect(achv.iconAtlas).toBe("items");
      expect(frames.has(achv.iconImage), achv.iconImage).toBe(true);
      expect(achv.secret).toBeFalsy();
    }
    expect(Object.keys(achvs).at(-1)).toBe("THE_END");
  });

  it("asks for the right Pokémon, every one of them obtainable", () => {
    expect(achvs.ULTRA_BEASTS.getGoals()).toHaveLength(11);
    expect(NON_LEGEND_ULTRA_BEASTS).toHaveLength(11);
    expect(achvs.PAST_AND_FUTURE.getGoals()).toHaveLength(NON_LEGEND_PARADOX_POKEMON.length + 2);
    expect(achvs.PAST_AND_FUTURE.getGoals()).toHaveLength(22);
    expect(achvs.ANCIENT_GIANTS.getGoals()).toHaveLength(6);
    const legendary = achvs.ALL_LEGENDARY.getGoals();
    expect(legendary).not.toContain(SpeciesId.ETERNATUS);
    expect(legendary).toContain(SpeciesId.MEWTWO);
    expect(achvs.ALL_MYTHICAL.getGoals()).toContain(SpeciesId.PECHARUNT);
    expect(achvs.ALL_SUB_LEGENDARY.getGoals()).toContain(SpeciesId.GALAR_ARTICUNO);
    for (const achv of dexCollectionAchvs) {
      for (const goal of achv.getGoals()) {
        const speciesId = typeof goal === "number" ? goal : goal.speciesId;
        const species = speciesDataRegistry.getSpecies(speciesId);
        expect(species, `${achv.id} ${speciesId}`).toBeDefined();
        // Every Pokémon asked for is a starter or evolves from one, so eggs can give it
        expect(speciesDataRegistry.isStarter(species.getRootSpeciesId()), `${achv.id} ${SpeciesId[speciesId]}`).toBe(
          true,
        );
        if (typeof goal !== "number") {
          const formIndex = species.forms.findIndex(f => f.formKey === goal.formKey);
          expect(formIndex, `${achv.id} ${goal.formKey}`).toBeGreaterThan(0);
          // The Pokédex can record the form as caught
          expect(species.forms[formIndex].isUnobtainable, `${achv.id} ${goal.formKey}`).toBe(false);
          expect(species.getFullUnlocksData() & game.scene.gameData.getFormAttr(formIndex)).not.toBe(0n);
        }
      }
    }
  });

  it("unlocks a group once the Pokédex has every Pokémon of it, checked with the next catch", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const { gameData } = game.scene;
    for (const achv of dexCollectionAchvs) {
      delete gameData.achvUnlocks[achv.id];
    }
    const regis = achvs.ANCIENT_GIANTS.getGoals() as SpeciesId[];
    for (const id of regis) {
      gameData.dexData[id].caughtAttr = 0n;
    }
    for (const id of regis.slice(0, -1)) {
      gameData.dexData[id].caughtAttr = 1n;
    }
    expect(achvs.ANCIENT_GIANTS.validate()).toBe(false);
    // Catching the last one through the Pokédex
    const last = game.scene.addPlayerPokemon(speciesDataRegistry.getSpecies(regis.at(-1)!), 50);
    await gameData.setPokemonCaught(last, true, false, false);
    expect(isDexGoalMet(regis.at(-1)!)).toBe(true);
    expect(unlocked(achvs.ANCIENT_GIANTS)).toBe(true);
    expect(unlocked(achvs.LIFE_AND_DEATH)).toBe(false);
  });

  it("unlocks the ones an older save already meets when a run starts (TitlePhase.end)", async () => {
    await game.runToTitle();
    const { gameData, phaseManager } = game.scene;
    for (const achv of dexCollectionAchvs) {
      delete gameData.achvUnlocks[achv.id];
    }
    gameData.dexData[SpeciesId.XERNEAS].caughtAttr = 1n;
    gameData.dexData[SpeciesId.YVELTAL].caughtAttr = 1n;
    gameData.dexData[SpeciesId.REGIROCK].caughtAttr = 0n;
    // Only the end of the title screen, without starting the phases it queues
    vi.spyOn(phaseManager, "pushNew").mockReturnValue(undefined as never);
    vi.spyOn(phaseManager, "shiftPhase").mockReturnValue(undefined as never);
    const title = new TitlePhase();
    // As if Classic had been picked on the title screen
    title.gameMode = GameModes.CLASSIC;
    title.end();
    vi.restoreAllMocks();
    expect(unlocked(achvs.LIFE_AND_DEATH)).toBe(true);
    expect(unlocked(achvs.ANCIENT_GIANTS)).toBe(false);
  });

  it("unlocks a form achievement when a Pokémon of the player's takes the form", async () => {
    await game.classicMode.startBattle(SpeciesId.RAYQUAZA);
    const { gameData } = game.scene;
    delete gameData.achvUnlocks[achvs.SKY_DRAGON.id];
    const mega: DexGoal = { speciesId: SpeciesId.RAYQUAZA, formKey: "mega" };
    // The starter is caught, in its ordinary form only (a test save starts with an empty Pokédex)
    const species = speciesDataRegistry.getSpecies(SpeciesId.RAYQUAZA);
    gameData.dexData[SpeciesId.RAYQUAZA].caughtAttr = species.getFullUnlocksData() & ~gameData.getFormAttr(1);
    expect(isDexGoalMet(mega)).toBe(false);
    expect(achvs.SKY_DRAGON.validate()).toBe(false);

    const rayquaza = game.field.getPlayerPokemon();
    const formChange = speciesDataRegistry.getFormChanges(SpeciesId.RAYQUAZA).find(fc => fc.formKey === "mega")!;
    expect(formChange).toBeDefined();
    await rayquaza.changeForm(formChange);
    expect(rayquaza.getFormKey()).toBe("mega");
    expect(isDexGoalMet(mega)).toBe(true);
    expect(unlocked(achvs.SKY_DRAGON)).toBe(true);
  });

  it("asks for both of Necrozma's fusions and both Primal Reversions", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const { gameData } = game.scene;
    const necrozma = speciesDataRegistry.getSpecies(SpeciesId.NECROZMA);
    const dusk = necrozma.forms.findIndex(f => f.formKey === "dusk-mane");
    const dawn = necrozma.forms.findIndex(f => f.formKey === "dawn-wings");
    gameData.dexData[SpeciesId.NECROZMA].caughtAttr = 1n | gameData.getFormAttr(0) | gameData.getFormAttr(dusk);
    expect(achvs.DAWN_AND_DUSK.validate()).toBe(false);
    gameData.dexData[SpeciesId.NECROZMA].caughtAttr |= gameData.getFormAttr(dawn);
    expect(achvs.DAWN_AND_DUSK.validate()).toBe(true);

    gameData.dexData[SpeciesId.KYOGRE].caughtAttr = 1n | gameData.getFormAttr(0) | gameData.getFormAttr(1);
    gameData.dexData[SpeciesId.GROUDON].caughtAttr = 1n | gameData.getFormAttr(0);
    expect(achvs.SEA_AND_LAND.validate()).toBe(false);
    gameData.dexData[SpeciesId.GROUDON].caughtAttr |= gameData.getFormAttr(1);
    expect(achvs.SEA_AND_LAND.validate()).toBe(true);
  });
});
