// Local fork (2026-11-17): marks (증표) and memorial ribbons (리본), pokemon-marks.ts. The user: "수집 요소: 본가에 있는
// 증표랑 리본 / 획득 가능한것만 구현합시다, 증표는 그냥 확률상으로 하고, 리본은 게임 파일 내에 존재하는 트레이너들에
// 해당하는 것들만 넣어두죠, 우두머리의 증표는 구현만 하고 획득 경로는 따로 코딩하겠습니다".
import {
  awardTrainerRibbon,
  getMarkKey,
  isRibbon,
  normalizeMarks,
  orderedPokemonMarks,
  rollWildMark,
  TRAINER_RIBBONS,
} from "#data/pokemon-marks";
import { BattleType } from "#enums/battle-type";
import { MoveId } from "#enums/move-id";
import { PokeballType } from "#enums/pokeball";
import { PokemonMark } from "#enums/pokemon-mark";
import { SpeciesId } from "#enums/species-id";
import { TimeOfDay } from "#enums/time-of-day";
import { TrainerType } from "#enums/trainer-type";
import { WeatherType } from "#enums/weather-type";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import { getAppRootDir } from "#test/utils/sprite-utils";
import { getEnumValues } from "#utils/enums";
import fs from "node:fs";
import path from "node:path";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Local fork - marks and ribbons", () => {
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
      .startingLevel(100)
      .enemyLevel(5);
  });

  it("lists every mark exactly once, with a name, a description and an icon", () => {
    expect([...orderedPokemonMarks].sort((a, b) => a - b)).toEqual(
      getEnumValues(PokemonMark).sort((a, b) => a - b),
    );

    const root = getAppRootDir();
    const atlas = JSON.parse(fs.readFileSync(path.join(root, "assets", "images", "marks", "marks.json"), "utf8"));
    const frames = new Set<string>(atlas.textures[0].frames.map((f: { filename: string }) => f.filename));
    for (const lang of ["en", "ko"]) {
      const texts = JSON.parse(fs.readFileSync(path.join(root, "locales", lang, "pokemon-marks.json"), "utf8"));
      for (const mark of orderedPokemonMarks) {
        const key = getMarkKey(mark);
        expect(texts[key]?.name, `${lang} name of ${key}`).toBeTruthy();
        expect(texts[key]?.description, `${lang} description of ${key}`).toBeTruthy();
        expect(frames.has(key), `icon of ${key}`).toBe(true);
      }
    }
  });

  it("gives ribbons only for champions, and every ribbon has a champion", () => {
    const ribbons = orderedPokemonMarks.filter(isRibbon);
    expect(ribbons).toHaveLength(8);
    expect(new Set(Object.values(TRAINER_RIBBONS))).toEqual(new Set(ribbons));
    for (const type of Object.keys(TRAINER_RIBBONS).map(Number)) {
      expect(type).toBeGreaterThanOrEqual(TrainerType.BLUE);
      expect(type).toBeLessThanOrEqual(TrainerType.KIERAN);
    }
    // No Johto or Unova champion ribbon exists in the main series
    for (const type of [TrainerType.LANCE_CHAMPION, TrainerType.ALDER, TrainerType.IRIS]) {
      expect(TRAINER_RIBBONS[type]).toBeUndefined();
    }
    // The Alpha Mark has no source yet
    expect(isRibbon(PokemonMark.ALPHA_MARK)).toBe(false);
  });

  it("keeps only known marks, once each, when cleaning a list", () => {
    expect(normalizeMarks(undefined)).toEqual([]);
    expect(normalizeMarks("112")).toEqual([]);
    expect(
      normalizeMarks([PokemonMark.RARE_MARK, 9999, "x", PokemonMark.RARE_MARK, null, PokemonMark.LEGEND_RIBBON]),
    ).toEqual([PokemonMark.RARE_MARK, PokemonMark.LEGEND_RIBBON]);
  });

  it("rolls wild marks at about the main series' rate, and only ones the time and weather allow", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const rolls = 30000;
    const counts = new Map<PokemonMark, number>();
    const roll = (timeOfDay: TimeOfDay, weather: WeatherType): void => {
      for (let i = 0; i < rolls; i++) {
        game.scene.executeWithSeedOffset(
          () => {
            const mark = rollWildMark(timeOfDay, weather);
            if (mark !== null) {
              counts.set(mark, (counts.get(mark) ?? 0) + 1);
            }
          },
          i,
          "marks-test",
        );
      }
    };

    // Night, no weather: 1/1000 + 1/100 + 1/50 + 1/50 of the rest, about 5%
    roll(TimeOfDay.NIGHT, WeatherType.NONE);
    let total = [...counts.values()].reduce((a, b) => a + b, 0);
    expect(total / rolls).toBeGreaterThan(0.04);
    expect(total / rolls).toBeLessThan(0.06);
    for (const mark of counts.keys()) {
      expect(isRibbon(mark)).toBe(false);
      expect(mark).not.toBe(PokemonMark.ALPHA_MARK);
      expect(mark === PokemonMark.SLEEPY_TIME_MARK || mark >= PokemonMark.UNCOMMON_MARK, PokemonMark[mark]).toBe(true);
    }
    expect(counts.get(PokemonMark.SLEEPY_TIME_MARK)).toBeGreaterThan(0);
    expect(counts.get(PokemonMark.UNCOMMON_MARK)).toBeGreaterThan(0);

    // Dawn in the rain: the weather's mark joins in, about 7%
    counts.clear();
    roll(TimeOfDay.DAWN, WeatherType.RAIN);
    total = [...counts.values()].reduce((a, b) => a + b, 0);
    expect(total / rolls).toBeGreaterThan(0.06);
    expect(total / rolls).toBeLessThan(0.08);
    expect(counts.get(PokemonMark.RAINY_MARK)).toBeGreaterThan(0);
    expect(counts.get(PokemonMark.DAWN_MARK)).toBeGreaterThan(0);
    expect(counts.has(PokemonMark.SLEEPY_TIME_MARK)).toBe(false);
    expect(counts.has(PokemonMark.MISTY_MARK)).toBe(false);
  });

  it("gives a wild Pokémon at most one mark, and a trainer's none", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const wild = game.field.getEnemyPokemon();
    expect(wild.marks.length).toBeLessThanOrEqual(1);
    expect(wild.marks.every(m => !isRibbon(m))).toBe(true);
    // The starter is not a wild Pokémon
    expect(game.field.getPlayerPokemon().marks).toEqual([]);
  });

  it("saves marks with the Pokémon and leaves a Pokémon without marks' save data unchanged", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const player = game.field.getPlayerPokemon();

    expect("marks" in new PokemonData(player)).toBe(false);

    expect(player.addMark(PokemonMark.ROWDY_MARK)).toBe(true);
    expect(player.addMark(PokemonMark.ROWDY_MARK)).toBe(false);
    expect(player.addMark(PokemonMark.KALOS_CHAMPION_RIBBON)).toBe(true);
    expect(player.hasMark(PokemonMark.ROWDY_MARK)).toBe(true);

    const saved = JSON.parse(JSON.stringify(new PokemonData(player)));
    expect(saved.marks).toEqual([PokemonMark.ROWDY_MARK, PokemonMark.KALOS_CHAMPION_RIBBON]);

    const loaded = new PokemonData(saved);
    expect(loaded.marks).toEqual([PokemonMark.ROWDY_MARK, PokemonMark.KALOS_CHAMPION_RIBBON]);
    const reloaded = loaded.toPokemon();
    expect(reloaded.marks).toEqual([PokemonMark.ROWDY_MARK, PokemonMark.KALOS_CHAMPION_RIBBON]);
    reloaded.destroy();
  });

  it("keeps a wild Pokémon's mark when it is caught", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const wild = game.field.getEnemyPokemon();
    wild.marks = [PokemonMark.RARE_MARK];

    const caught = wild.addToParty(PokeballType.POKEBALL)!;
    expect(caught.isPlayer()).toBe(true);
    expect(caught.marks).toEqual([PokemonMark.RARE_MARK]);
    // A copy, not the enemy's own list
    expect(caught.marks).not.toBe(wild.marks);
  });

  it("gives the whole party the champion's ribbon once", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MILOTIC);
    const party = game.scene.getPlayerParty();

    expect(awardTrainerRibbon(TrainerType.YOUNGSTER)).toBeNull();
    expect(awardTrainerRibbon(TrainerType.LANCE_CHAMPION)).toBeNull();
    expect(party.every(p => p.marks.length === 0)).toBe(true);

    expect(awardTrainerRibbon(TrainerType.CYNTHIA)).toBe(PokemonMark.SINNOH_CHAMPION_RIBBON);
    expect(party.every(p => p.hasMark(PokemonMark.SINNOH_CHAMPION_RIBBON))).toBe(true);
    // Nobody new to give it to: no second message
    expect(awardTrainerRibbon(TrainerType.CYNTHIA)).toBeNull();
    expect(party.every(p => p.marks.length === 1)).toBe(true);
  });

  it("awards the ribbon when a champion is beaten in battle", async () => {
    game.override.battleType(BattleType.TRAINER).randomTrainer({ trainerType: TrainerType.DIANTHA });
    await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MILOTIC);
    expect(game.scene.currentBattle.trainer?.config.trainerType).toBe(TrainerType.DIANTHA);

    // Only the champion's lead is left standing, and it goes down this turn
    for (const benched of game.scene.getEnemyParty().slice(1)) {
      benched.hp = 0;
    }
    game.move.use(MoveId.SPLASH);
    await game.doKillOpponents();
    await game.phaseInterceptor.to("TrainerVictoryPhase");

    for (const pokemon of game.scene.getPlayerParty()) {
      expect(pokemon.marks).toEqual([PokemonMark.KALOS_CHAMPION_RIBBON]);
    }
  });
});
