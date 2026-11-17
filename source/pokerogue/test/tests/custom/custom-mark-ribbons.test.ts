// Local fork (2026-11-17): the ribbons earned by raising a Pokémon, the worn mark and each starter line's collection
// (pokemon-marks.ts). The user: "증표 볼때 장착 가능하게 하고, 그게 이름 옆에 붙도록 / 절친리본은 친밀도 사탕의 다음 단계
// 구매로 / 노력치는 노력치별로 색깔 다르게 해서 추가 / 발자국리본은 2버전 만들어보죠, 200레벨, 그리고 엔드리스에서
// 10만레벨 달성 시 하나 / 배틀타워는 엔드리스 클리어 증표처럼 하고 이름을 바꿔보죠 / 포켓몬별 증표 n/50몇개".

import { getBestFriendsRibbonCandyCount, getPartnerMarkCandyCount } from "#balance/starters";
import {
  awardPartyRibbon,
  awardProgressRibbons,
  COMPLETION_EXEMPT_MARKS,
  FOOTPRINT_LEVEL,
  GRAND_FOOTPRINT_LEVEL,
  getCollectedMarks,
  getEarnedProgressRibbons,
  getMarkTitle,
  getPokemonTitle,
  getStarterEquippedMark,
  hasEverObtainedMark,
  isMarkCollectionComplete,
  orderedPokemonMarks,
  STAT_EFFORT_RIBBONS,
} from "#data/pokemon-marks";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { PokemonMark } from "#enums/pokemon-mark";
import { SpeciesId } from "#enums/species-id";
import { PERMANENT_STATS, Stat } from "#enums/stat";
import { getEvCap } from "#modifiers/ev-items";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import i18next from "i18next";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Local fork - earned ribbons, the worn mark and the line's collection", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(50)
      .enemyLevel(5);
  });

  it("every mark has a name, a description and a title in both languages' files", () => {
    for (const mark of orderedPokemonMarks) {
      expect(getMarkTitle(mark), PokemonMark[mark]).not.toBe("");
    }
    expect(i18next.t("pokemonMarks:ribbonEarned", { pokemonName: "A", ribbonName: "B" })).toContain("B");
  });

  it("a stat's EVs at their cap earn that stat's effort ribbon, all six the Effort Ribbon", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    const pokemon = game.field.getPlayerPokemon();

    pokemon.evs[Stat.ATK] = getEvCap(Stat.ATK) - 1;
    pokemon.evs[Stat.HP] = getEvCap(Stat.ATK);
    expect(getEarnedProgressRibbons(pokemon)).toEqual([]);

    pokemon.evs[Stat.ATK] = getEvCap(Stat.ATK);
    expect(getEarnedProgressRibbons(pokemon)).toEqual([PokemonMark.ATK_EFFORT_RIBBON]);

    awardProgressRibbons();
    expect(pokemon.hasMark(PokemonMark.ATK_EFFORT_RIBBON)).toBe(true);
    expect(game.scene.gameData.markCounts[PokemonMark.ATK_EFFORT_RIBBON]).toBe(1);
    // Earned once
    awardProgressRibbons();
    expect(game.scene.gameData.markCounts[PokemonMark.ATK_EFFORT_RIBBON]).toBe(1);

    for (const stat of PERMANENT_STATS) {
      pokemon.evs[stat] = getEvCap(stat);
    }
    awardProgressRibbons();
    for (const ribbon of Object.values(STAT_EFFORT_RIBBONS)) {
      expect(pokemon.hasMark(ribbon)).toBe(true);
    }
    expect(pokemon.hasMark(PokemonMark.EFFORT_RIBBON)).toBe(true);
    // The line remembers them
    const collected = getCollectedMarks(game.scene.gameData.starterData[SpeciesId.BULBASAUR]);
    expect(collected).toContain(PokemonMark.EFFORT_RIBBON);
    expect(collected).toHaveLength(7);
  });

  it("level 200 earns the Footprint Ribbon, level 100,000 the Grand one in Endless only", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    const pokemon = game.field.getPlayerPokemon();

    pokemon.level = FOOTPRINT_LEVEL - 1;
    expect(getEarnedProgressRibbons(pokemon)).toEqual([]);
    pokemon.level = FOOTPRINT_LEVEL;
    expect(getEarnedProgressRibbons(pokemon)).toEqual([PokemonMark.FOOTPRINT_RIBBON]);

    pokemon.level = GRAND_FOOTPRINT_LEVEL;
    expect(getEarnedProgressRibbons(pokemon)).toEqual([PokemonMark.FOOTPRINT_RIBBON]);
    game.scene.gameMode = { ...game.scene.gameMode, isEndless: true, modeId: GameModes.ENDLESS } as any;
    Object.setPrototypeOf(game.scene.gameMode, Object.getPrototypeOf(game.scene.gameMode));
    expect(getEarnedProgressRibbons(pokemon)).toEqual([
      PokemonMark.FOOTPRINT_RIBBON,
      PokemonMark.GRAND_FOOTPRINT_RIBBON,
    ]);
  });

  it("the whole party gets a party ribbon once", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR, SpeciesId.CHARMANDER);
    expect(awardPartyRibbon(PokemonMark.ENDLESS_MASTER_RIBBON)).toBe(true);
    expect(game.scene.getPlayerParty().every(p => p.hasMark(PokemonMark.ENDLESS_MASTER_RIBBON))).toBe(true);
    expect(game.scene.gameData.markCounts[PokemonMark.ENDLESS_MASTER_RIBBON]).toBe(2);
    expect(awardPartyRibbon(PokemonMark.ENDLESS_MASTER_RIBBON)).toBe(false);
    expect(getCollectedMarks(game.scene.gameData.starterData[SpeciesId.CHARMANDER])).toEqual([
      PokemonMark.ENDLESS_MASTER_RIBBON,
    ]);
  });

  it("the worn mark gives the title, and is saved with the Pokémon", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    const pokemon = game.field.getPlayerPokemon();
    pokemon.marks = [PokemonMark.ROWDY_MARK, PokemonMark.CHAMPION_RIBBON];

    // Without a worn mark: the most telling one, as before
    expect(getPokemonTitle(pokemon)).toBe(getMarkTitle(PokemonMark.ROWDY_MARK));
    pokemon.equippedMark = PokemonMark.CHAMPION_RIBBON;
    expect(getPokemonTitle(pokemon)).toBe(getMarkTitle(PokemonMark.CHAMPION_RIBBON));
    // A mark it does not carry is not worn
    pokemon.equippedMark = PokemonMark.RARE_MARK;
    expect(getPokemonTitle(pokemon)).toBe(getMarkTitle(PokemonMark.ROWDY_MARK));

    pokemon.equippedMark = PokemonMark.CHAMPION_RIBBON;
    const data = JSON.parse(JSON.stringify(new PokemonData(pokemon)));
    expect(data.equippedMark).toBe(PokemonMark.CHAMPION_RIBBON);
    expect(new PokemonData(data).toPokemon().equippedMark).toBe(PokemonMark.CHAMPION_RIBBON);

    pokemon.equippedMark = null;
    expect("equippedMark" in JSON.parse(JSON.stringify(new PokemonData(pokemon)))).toBe(false);
  });

  it("a starter line's collection: marks registered for it, the two bought with candy, and the worn one", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    const { gameData } = game.scene;
    const entry = gameData.starterData[SpeciesId.BULBASAUR];
    expect(getCollectedMarks(entry)).toEqual([]);

    gameData.registerMarks([PokemonMark.RARE_MARK, PokemonMark.ALPHA_MARK], SpeciesId.BULBASAUR);
    gameData.registerMarks([PokemonMark.RARE_MARK], SpeciesId.BULBASAUR);
    entry.partnerMark = true;
    expect(getCollectedMarks(entry)).toEqual([PokemonMark.ALPHA_MARK, PokemonMark.PARTNER_MARK, PokemonMark.RARE_MARK]);
    expect(gameData.markCounts[PokemonMark.RARE_MARK]).toBe(2);

    entry.equippedMark = PokemonMark.RARE_MARK;
    expect(getStarterEquippedMark(entry)).toBe(PokemonMark.RARE_MARK);
    entry.equippedMark = PokemonMark.UNCOMMON_MARK;
    expect(getStarterEquippedMark(entry)).toBeNull();
  });

  it("tells a mark never obtained from one obtained on another Pokémon", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    const { gameData } = game.scene;
    expect(hasEverObtainedMark(PokemonMark.RARE_MARK)).toBe(false);
    gameData.registerMarks([PokemonMark.RARE_MARK], SpeciesId.CHARMANDER);
    expect(hasEverObtainedMark(PokemonMark.RARE_MARK)).toBe(true);
    expect(hasEverObtainedMark(PokemonMark.UNCOMMON_MARK)).toBe(false);
    // A Partner Mark bought before the collection was counted per line
    gameData.starterData[SpeciesId.SQUIRTLE].partnerMark = true;
    expect(hasEverObtainedMark(PokemonMark.PARTNER_MARK)).toBe(true);
  });

  it("a collection is complete with every mark but the Once-in-a-Lifetime Ribbon and the Mightiest Mark", () => {
    const needed = orderedPokemonMarks.filter(m => !COMPLETION_EXEMPT_MARKS.includes(m));
    expect(COMPLETION_EXEMPT_MARKS).toEqual([PokemonMark.ONCE_IN_A_LIFETIME_RIBBON, PokemonMark.MIGHTIEST_MARK]);
    expect(isMarkCollectionComplete(needed)).toBe(true);
    expect(isMarkCollectionComplete(needed.slice(1))).toBe(false);
    expect(isMarkCollectionComplete([])).toBe(false);
  });

  it("the Best Friends Ribbon costs twice the Partner Mark", () => {
    for (let cost = 1; cost <= 10; cost++) {
      expect(getBestFriendsRibbonCandyCount(cost)).toBe(getPartnerMarkCandyCount(cost) * 2);
    }
  });
});
