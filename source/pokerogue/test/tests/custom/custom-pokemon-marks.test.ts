// Local fork (2026-11-17): marks (증표) and memorial ribbons (리본), pokemon-marks.ts. The user: "수집 요소: 본가에 있는
// 증표랑 리본 / 획득 가능한것만 구현합시다, 증표는 그냥 확률상으로 하고, 리본은 게임 파일 내에 존재하는 트레이너들에
// 해당하는 것들만 넣어두죠, 우두머리의 증표는 구현만 하고 획득 경로는 따로 코딩하겠습니다".

import { getPartnerMarkCandyCount } from "#balance/starters";
import {
  awardTrainerRibbon,
  getMarkKey,
  getPokemonTitle,
  getShinyMark,
  getTitledName,
  isRibbon,
  normalizeMarks,
  orderedPokemonMarks,
  rollWildMark,
  TRAINER_RIBBONS,
  WILD_MARKS,
} from "#data/pokemon-marks";
import { BattleType } from "#enums/battle-type";
import { Button } from "#enums/buttons";
import { MoveId } from "#enums/move-id";
import { PokeballType } from "#enums/pokeball";
import { PokemonMark } from "#enums/pokemon-mark";
import { SpeciesId } from "#enums/species-id";
import { TimeOfDay } from "#enums/time-of-day";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { UiMode } from "#enums/ui-mode";
import { WeatherType } from "#enums/weather-type";
import { EnemyPokemon } from "#field/pokemon";
import {
  generateHyperWonderTradePokemon,
  ONCE_IN_A_LIFETIME_RIBBON_RATE,
} from "#mystery-encounters/hyper-global-trade-system-encounter";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import { getAppRootDir } from "#test/utils/sprite-utils";
import type { EnemyBattleInfo } from "#ui/enemy-battle-info";
import type { PokedexPageUiHandler } from "#ui/pokedex-page-ui-handler";
import { getEnumValues } from "#utils/enums";
import fs from "node:fs";
import path from "node:path";
import i18next from "i18next";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
    expect([...orderedPokemonMarks].sort((a, b) => a - b)).toEqual(getEnumValues(PokemonMark).sort((a, b) => a - b));

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
    // The eight champions' ribbons and the Once-in-a-Lifetime Ribbon of the Hyper GTS
    expect(ribbons).toHaveLength(9);
    expect(new Set(Object.values(TRAINER_RIBBONS))).toEqual(
      new Set(ribbons.filter(r => r !== PokemonMark.ONCE_IN_A_LIFETIME_RIBBON)),
    );
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

  it("gives a wild Pokémon at most one wild mark next to its size's", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const species = game.field.getEnemyPokemon().species;
    const sizeMarks = [
      PokemonMark.ALPHA_MARK,
      PokemonMark.GOLDEN_ALPHA_MARK,
      PokemonMark.JUMBO_MARK,
      PokemonMark.MINI_MARK,
    ];
    for (let i = 0; i < 150; i++) {
      game.scene.currentBattle.waveIndex = 9000 + i;
      const wild = game.scene.addEnemyPokemon(species, 50, 0, false);
      const wildMarks = wild.marks.filter(m => WILD_MARKS.includes(m));
      expect(wildMarks.length).toBeLessThanOrEqual(1);
      expect(wild.marks.every(m => WILD_MARKS.includes(m) || sizeMarks.includes(m))).toBe(true);
      wild.destroy();
    }
  });

  it("titles a Pokémon by its marks: the wild mark first, then its size", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const pokemon = game.field.getPlayerPokemon();
    expect(getPokemonTitle(pokemon)).toBe("");
    expect(getTitledName(pokemon, "Feebas")).toBe("Feebas");

    pokemon.marks = [PokemonMark.JUMBO_MARK, PokemonMark.SHINY_MARK, PokemonMark.CHAMPION_RIBBON];
    expect(getPokemonTitle(pokemon)).toBe("");

    pokemon.marks = [PokemonMark.ALPHA_MARK, PokemonMark.JUMBO_MARK];
    expect(getPokemonTitle(pokemon)).toBe(i18next.t("pokemonMarks:alphaMark.title"));
    pokemon.marks.push(PokemonMark.GOLDEN_ALPHA_MARK);
    expect(getPokemonTitle(pokemon)).toBe(i18next.t("pokemonMarks:goldenAlphaMark.title"));
    pokemon.marks.push(PokemonMark.ROWDY_MARK);
    expect(getPokemonTitle(pokemon)).toBe(i18next.t("pokemonMarks:rowdyMark.title"));
    expect(getTitledName(pokemon, "Feebas")).toBe(
      i18next.t("pokemonMarks:titledName", { title: getPokemonTitle(pokemon), name: "Feebas" }),
    );

    pokemon.marks = [PokemonMark.MINI_MARK];
    expect(getPokemonTitle(pokemon)).toBe(i18next.t("pokemonMarks:miniMark.title"));
    pokemon.marks = [];
  });

  it("has a title in both languages for every mark that gives one", () => {
    const root = getAppRootDir();
    const titled = [
      ...WILD_MARKS,
      PokemonMark.MINI_MARK,
      PokemonMark.ALPHA_MARK,
      PokemonMark.GOLDEN_ALPHA_MARK,
      PokemonMark.MIGHTIEST_MARK,
      PokemonMark.ONCE_IN_A_LIFETIME_RIBBON,
      PokemonMark.PARTNER_MARK,
    ];
    for (const lang of ["en", "ko"]) {
      const texts = JSON.parse(fs.readFileSync(path.join(root, "locales", lang, "pokemon-marks.json"), "utf8"));
      expect(texts.titledName).toContain("{{title}}");
      for (const mark of titled) {
        expect(texts[getMarkKey(mark)]?.title, `${lang} title of ${getMarkKey(mark)}`).toBeTruthy();
      }
    }
  });

  it("gives a caught shiny Pokémon its tier's shiny mark", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    expect(getShinyMark(0)).toBe(PokemonMark.SHINY_MARK);
    expect(getShinyMark(1)).toBe(PokemonMark.RARE_SHINY_MARK);
    expect(getShinyMark(2)).toBe(PokemonMark.EPIC_SHINY_MARK);

    const wild = game.field.getEnemyPokemon();
    wild.alphaBoost = 0;
    wild.marks = [];
    await game.scene.gameData.setPokemonCaught(wild, true, false, false);
    expect(wild.marks).toEqual([]);

    wild.shiny = true;
    wild.variant = 2;
    await game.scene.gameData.setPokemonCaught(wild, true, false, false);
    expect(wild.marks).toEqual([PokemonMark.EPIC_SHINY_MARK]);
    // The mark is in place before the Pokémon joins the party, so the caught Pokémon has it
    expect(wild.addToParty(PokeballType.POKEBALL)!.marks).toEqual([PokemonMark.EPIC_SHINY_MARK]);
  });

  it("gives 1 Hyper GTS Wonder Trade Pokémon in 10 the Once-in-a-Lifetime Ribbon", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    expect(ONCE_IN_A_LIFETIME_RIBBON_RATE).toBe(10);
    let ribbons = 0;
    const total = 400;
    for (let i = 0; i < total; i++) {
      game.scene.executeWithSeedOffset(
        () => {
          const traded = generateHyperWonderTradePokemon(20);
          if (traded.hasMark(PokemonMark.ONCE_IN_A_LIFETIME_RIBBON)) {
            ribbons++;
          }
          traded.destroy();
        },
        i,
        "once-test",
      );
    }
    expect(ribbons).toBeGreaterThan(total * 0.05);
    expect(ribbons).toBeLessThan(total * 0.17);
  });

  it("prices the Partner Mark like the starter's passive", () => {
    expect(getPartnerMarkCandyCount(1)).toBe(40);
    expect(getPartnerMarkCandyCount(3)).toBe(35);
    expect(getPartnerMarkCandyCount(10)).toBe(10);
  });

  it("rolls each Pokémon of one wave on its own (GTS offers, the Safari Zone, the salesman)", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const species = game.field.getEnemyPokemon().species;
    // Same wave, same place in the enemy party: only the Pokémon differ
    let marked = 0;
    let alphas = 0;
    const total = 400;
    for (let i = 0; i < total; i++) {
      const wild = new EnemyPokemon(species, 20, TrainerSlot.NONE, false);
      if (wild.marks.some(m => WILD_MARKS.includes(m))) {
        marked++;
      }
      if (wild.isAlpha()) {
        alphas++;
      }
      wild.destroy();
    }
    // Before, all of them shared one roll: every one marked or none
    expect(marked).toBeGreaterThan(5);
    expect(marked).toBeLessThan(80);
    expect(alphas).toBeGreaterThan(0);
    expect(alphas).toBeLessThan(40);
  });

  // Local fork (2026-11-17), review: a boss's box moves the name and the icons next to it 48px left, but not the mark
  // icons, which stayed behind on top of the boss HP label and the start of the HP bar
  it("moves a wild boss's mark icons with its name", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const species = game.field.getEnemyPokemon().species;
    /** Where the mark's icon ends up in the Pokémon's box */
    const markIconX = (boss: boolean): number => {
      const pokemon = new EnemyPokemon(species, 20, TrainerSlot.NONE, boss);
      pokemon.marks = [PokemonMark.RARE_MARK];
      pokemon.init();
      const info = pokemon.getBattleInfo() as EnemyBattleInfo;
      expect(info["boss"]).toBe(boss);
      const icon = info["markIcons"][0];
      expect(icon.visible).toBe(true);
      const x = icon.x;
      pokemon.destroy();
      return x;
    };
    expect(markIconX(true) - markIconX(false)).toBe(-48);
  });

  // Local fork (2026-11-17), review: the Pokédex page opened from the party lost its marks' option after going to
  // another species (an evolution, or the next one in the Pokédex) and back
  it("shows a party Pokémon's marks again when its Pokédex page comes back from another species", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const feebas = game.field.getPlayerPokemon();
    feebas.addMark(PokemonMark.RARE_MARK);
    await game.scene.ui.setOverlayMode(
      UiMode.POKEDEX_PAGE,
      feebas.species,
      {},
      undefined,
      undefined,
      undefined,
      feebas,
    );
    const page = game.scene.ui.getHandler() as PokedexPageUiHandler;
    expect(page["markPokemon"]).toBe(feebas);

    // On to the next species in the Pokédex: not this Pokémon's, so no marks there
    page.processInput(Button.RIGHT);
    await vi.waitFor(() => expect(page["species"].speciesId).toBe(SpeciesId.MILOTIC));
    expect(page["markPokemon"]).toBeNull();

    // Back to its own species: the marks' option is there again
    page.processInput(Button.CANCEL);
    await vi.waitFor(() => expect(page["species"].speciesId).toBe(SpeciesId.FEEBAS));
    expect(page["markPokemon"]).toBe(feebas);
  });
});
