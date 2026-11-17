// Local fork (2026-11-17): alpha Pokémon (우두머리), alpha-pokemon.ts. The user: "우두머리: 야생 포켓몬이 확률적으로
// 능력치가 1~20% 증가된 채 나오며, 스프라이트 크기가 10% 증가 / 우두머리인 상태로 진화 / 메가진화 / 다이맥스 활성/비활성
// 시에도 우두머리 상태 유지 / 황금 우두머리 증표 획득 조건: 능력치 증가율이 20%인 우두머리 포켓몬을 알 바우처로 뽑기 /
// 포획 / 포켓몬 선택 창에서 우두머리 on/off 가능, 능력치 증가율은 획득한 해당 포켓몬의 우두머리중 가장 높은 값으로 고정".
import {
  ALPHA_MAX_BOOST,
  ALPHA_RATE,
  ALPHA_SPRITE_SCALE,
  getStarterAlphaBoost,
  MINI_SPRITE_SCALE,
  normalizeAlphaBoost,
  registerAlpha,
  rollAlphaBoost,
} from "#data/alpha-pokemon";
import { Egg } from "#data/egg";
import { EggSourceType } from "#enums/egg-source-types";
import { EggTier } from "#enums/egg-type";
import { MoveId } from "#enums/move-id";
import { PokeballType } from "#enums/pokeball";
import { PokemonMark } from "#enums/pokemon-mark";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { PERMANENT_STATS, Stat } from "#enums/stat";
import { TrainerSlot } from "#enums/trainer-slot";
import { EnemyPokemon } from "#field/pokemon";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Local fork - alpha Pokémon", () => {
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
      .enemyLevel(50);
  });

  it("cleans boosts read from data", () => {
    expect(normalizeAlphaBoost(undefined)).toBe(0);
    expect(normalizeAlphaBoost("20")).toBe(0);
    expect(normalizeAlphaBoost(Number.NaN)).toBe(0);
    expect(normalizeAlphaBoost(-3)).toBe(0);
    expect(normalizeAlphaBoost(7.9)).toBe(7);
    expect(normalizeAlphaBoost(99)).toBe(ALPHA_MAX_BOOST);
  });

  it("rolls an alpha 1 time in 50, with every boost from 1 to 20", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const rolls = 40000;
    const counts = new Array<number>(ALPHA_MAX_BOOST + 1).fill(0);
    for (let i = 0; i < rolls; i++) {
      game.scene.executeWithSeedOffset(
        () => {
          counts[rollAlphaBoost()]++;
        },
        i,
        "alpha-test",
      );
    }
    const alphas = rolls - counts[0];
    expect(alphas / rolls).toBeGreaterThan(0.8 / ALPHA_RATE);
    expect(alphas / rolls).toBeLessThan(1.2 / ALPHA_RATE);
    for (let boost = 1; boost <= ALPHA_MAX_BOOST; boost++) {
      expect(counts[boost], `boost ${boost}`).toBeGreaterThan(0);
    }
  });

  it("raises every stat by the boost, grows the sprite 10% and gives the Alpha Mark", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const pokemon = game.field.getPlayerPokemon();
    const before = PERMANENT_STATS.map(s => pokemon.getStat(s, false));
    const scale = pokemon.getSpriteScale();
    expect(pokemon.isAlpha()).toBe(false);

    pokemon.setAlphaBoost(10);

    expect(pokemon.isAlpha()).toBe(true);
    PERMANENT_STATS.forEach((s, i) => {
      expect(pokemon.getStat(s, false), Stat[s]).toBe(Math.floor(before[i] * 1.1));
    });
    expect(pokemon.getSpriteScale()).toBeCloseTo(scale * ALPHA_SPRITE_SCALE);
    expect(pokemon.marks).toEqual([PokemonMark.ALPHA_MARK, PokemonMark.JUMBO_MARK]);

    // The full boost is a golden alpha
    pokemon.setAlphaBoost(ALPHA_MAX_BOOST);
    PERMANENT_STATS.forEach((s, i) => {
      expect(pokemon.getStat(s, false), Stat[s]).toBe(Math.floor(before[i] * 1.2));
    });
    expect(pokemon.marks).toEqual([PokemonMark.ALPHA_MARK, PokemonMark.JUMBO_MARK, PokemonMark.GOLDEN_ALPHA_MARK]);

    // Back to an ordinary Pokémon: the stats and the size return, the marks stay
    pokemon.setAlphaBoost(0);
    expect(PERMANENT_STATS.map(s => pokemon.getStat(s, false))).toEqual(before);
    expect(pokemon.getSpriteScale()).toBeCloseTo(scale);
    expect(pokemon.marks).toHaveLength(3);
  });

  it("stays an alpha through evolution and Mega Evolution", async () => {
    await game.classicMode.startBattle(SpeciesId.CHARMELEON);
    const pokemon = game.field.getPlayerPokemon();
    pokemon.setAlphaBoost(15);

    const evolution = pokemon.getEvolution();
    expect(evolution).not.toBeNull();
    await pokemon.evolve(evolution, pokemon.species);
    expect(pokemon.species.speciesId).toBe(SpeciesId.CHARIZARD);
    expect(pokemon.alphaBoost).toBe(15);

    // The evolved stats carry the boost: the same Pokémon without it is weaker by exactly that much
    const boosted = PERMANENT_STATS.map(s => pokemon.getStat(s, false));
    pokemon.alphaBoost = 0;
    pokemon.calculateStats();
    const plain = PERMANENT_STATS.map(s => pokemon.getStat(s, false));
    pokemon.alphaBoost = 15;
    pokemon.calculateStats();
    expect(boosted).toEqual(plain.map(v => Math.floor(v * 1.15)));

    const megaIndex = pokemon.species.forms.findIndex(f => f.formKey === SpeciesFormKey.MEGA_X);
    expect(megaIndex).toBeGreaterThan(-1);
    pokemon.formIndex = megaIndex;
    pokemon.calculateStats();
    pokemon.updateScale();
    expect(pokemon.alphaBoost).toBe(15);
    expect(pokemon.getSpriteScale()).toBeCloseTo(ALPHA_SPRITE_SCALE);
    pokemon.alphaBoost = 0;
    pokemon.calculateStats();
    const plainMega = PERMANENT_STATS.map(s => pokemon.getStat(s, false));
    pokemon.alphaBoost = 15;
    pokemon.calculateStats();
    expect(PERMANENT_STATS.map(s => pokemon.getStat(s, false))).toEqual(plainMega.map(v => Math.floor(v * 1.15)));
  });

  it("is 10% larger as a Gigantamax too", async () => {
    await game.classicMode.startBattle(SpeciesId.CHARIZARD);
    const pokemon = game.field.getPlayerPokemon();
    const gmaxIndex = pokemon.species.forms.findIndex(f => f.formKey === SpeciesFormKey.GIGANTAMAX);
    expect(gmaxIndex).toBeGreaterThan(-1);
    pokemon.formIndex = gmaxIndex;
    expect(pokemon.getSpriteScale()).toBeCloseTo(1.5);
    pokemon.setAlphaBoost(5);
    expect(pokemon.getSpriteScale()).toBeCloseTo(1.5 * ALPHA_SPRITE_SCALE);
  });

  it("is saved with the Pokémon, and leaves an ordinary Pokémon's save data unchanged", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const pokemon = game.field.getPlayerPokemon();
    expect("alphaBoost" in new PokemonData(pokemon)).toBe(false);

    pokemon.setAlphaBoost(ALPHA_MAX_BOOST);
    const stats = pokemon.stats.slice();
    const saved = JSON.parse(JSON.stringify(new PokemonData(pokemon)));
    expect(saved.alphaBoost).toBe(ALPHA_MAX_BOOST);

    const reloaded = new PokemonData(saved).toPokemon();
    expect(reloaded.alphaBoost).toBe(ALPHA_MAX_BOOST);
    expect(reloaded.marks).toEqual([PokemonMark.ALPHA_MARK, PokemonMark.JUMBO_MARK, PokemonMark.GOLDEN_ALPHA_MARK]);
    reloaded.calculateStats();
    expect(reloaded.stats).toEqual(stats);
    reloaded.destroy();
  });

  it("stays an alpha when caught, and records the line's best boost for the starter", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const entry = game.scene.gameData.starterData[SpeciesId.MAGIKARP];
    expect(entry.alphaBoost).toBeUndefined();
    expect(getStarterAlphaBoost(entry)).toBe(0);

    const wild = game.field.getEnemyPokemon();
    wild.setAlphaBoost(12);
    const caught = wild.addToParty(PokeballType.POKEBALL)!;
    expect(caught.alphaBoost).toBe(12);
    expect(caught.hasMark(PokemonMark.ALPHA_MARK)).toBe(true);
    expect(caught.hasMark(PokemonMark.GOLDEN_ALPHA_MARK)).toBe(false);

    await game.scene.gameData.setPokemonCaught(caught, true, false, false);
    expect(entry.alphaBoost).toBe(12);

    // A weaker alpha does not lower it, a stronger one raises it
    caught.alphaBoost = 4;
    expect(registerAlpha(caught)).toBe(false);
    expect(entry.alphaBoost).toBe(12);
    caught.alphaBoost = 20;
    expect(registerAlpha(caught)).toBe(true);
    expect(entry.alphaBoost).toBe(20);

    // The starter only takes it while it is switched on
    expect(getStarterAlphaBoost(entry)).toBe(0);
    entry.alphaEnabled = true;
    expect(getStarterAlphaBoost(entry)).toBe(20);
  });

  it("leaves trainers' Pokémon and bosses ordinary", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const species = game.field.getEnemyPokemon().species;
    for (let i = 0; i < 300; i++) {
      game.scene.currentBattle.waveIndex = 1000 + i;
      const boss = new EnemyPokemon(species, 50, TrainerSlot.NONE, true);
      const trainers = new EnemyPokemon(species, 50, TrainerSlot.TRAINER, false);
      expect(boss.alphaBoost).toBe(0);
      expect(trainers.alphaBoost).toBe(0);
      boss.destroy();
      trainers.destroy();
    }
  });

  it("makes about 1 wild Pokémon in 50 an alpha", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const species = game.field.getEnemyPokemon().species;
    let alphas = 0;
    const total = 1500;
    for (let i = 0; i < total; i++) {
      game.scene.currentBattle.waveIndex = 2000 + i;
      const wild = game.scene.addEnemyPokemon(species, 50, 0, false);
      if (wild.isAlpha()) {
        alphas++;
        expect(wild.alphaBoost).toBeGreaterThanOrEqual(1);
        expect(wild.alphaBoost).toBeLessThanOrEqual(ALPHA_MAX_BOOST);
        expect(wild.hasMark(PokemonMark.ALPHA_MARK)).toBe(true);
        expect(wild.hasMark(PokemonMark.GOLDEN_ALPHA_MARK)).toBe(wild.alphaBoost === ALPHA_MAX_BOOST);
      }
      wild.destroy();
    }
    expect(alphas).toBeGreaterThan(10);
    expect(alphas).toBeLessThan(60);
  });

  it("can hatch an alpha from an egg", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    let alphas = 0;
    const total = 600;
    for (let i = 0; i < total; i++) {
      const hatched = new Egg({
        tier: EggTier.COMMON,
        species: SpeciesId.MAGIKARP,
        id: 1073741824 + i,
      }).generatePlayerPokemon();
      if (hatched.isAlpha()) {
        alphas++;
        expect(hatched.hasMark(PokemonMark.ALPHA_MARK)).toBe(true);
      }
      hatched.destroy();
    }
    expect(alphas).toBeGreaterThan(2);
    expect(alphas).toBeLessThan(30);
  });

  it("can hatch an alpha from an egg bought with candy", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    let alphas = 0;
    const total = 600;
    for (let i = 0; i < total; i++) {
      const hatched = new Egg({
        species: SpeciesId.MAGIKARP,
        sourceType: EggSourceType.SAME_SPECIES_EGG,
        id: 1073741824 + 5000 + i,
      }).generatePlayerPokemon();
      expect(hatched.species.speciesId).toBe(SpeciesId.MAGIKARP);
      if (hatched.isAlpha()) {
        alphas++;
        expect(hatched.hasMark(PokemonMark.ALPHA_MARK)).toBe(true);
        expect(hatched.hasMark(PokemonMark.GOLDEN_ALPHA_MARK)).toBe(hatched.alphaBoost === ALPHA_MAX_BOOST);
      }
      hatched.destroy();
    }
    expect(alphas).toBeGreaterThan(2);
    expect(alphas).toBeLessThan(30);
  });

  it("meets about 1 wild Pokémon in 50 as a mini one: 10% smaller, with the Mini Mark, never an alpha", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const species = game.field.getEnemyPokemon().species;
    let minis = 0;
    const total = 500;
    for (let i = 0; i < total; i++) {
      game.scene.currentBattle.waveIndex = 5000 + i;
      const wild = game.scene.addEnemyPokemon(species, 50, 0, false);
      if (wild.hasMark(PokemonMark.MINI_MARK)) {
        minis++;
        expect(wild.isAlpha()).toBe(false);
        expect(wild.hasMark(PokemonMark.JUMBO_MARK)).toBe(false);
        expect(wild.getSpriteScale()).toBeCloseTo(MINI_SPRITE_SCALE);
      } else if (wild.isAlpha()) {
        expect(wild.hasMark(PokemonMark.JUMBO_MARK)).toBe(true);
        expect(wild.getSpriteScale()).toBeCloseTo(ALPHA_SPRITE_SCALE);
      } else {
        expect(wild.getSpriteScale()).toBeCloseTo(1);
      }
      wild.destroy();
    }
    expect(minis).toBeGreaterThan(2);
    expect(minis).toBeLessThan(25);
  });

  it("keeps a mini Pokémon small when it is caught, with its stats unchanged", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const wild = game.field.getEnemyPokemon();
    wild.alphaBoost = 0;
    wild.marks = [];
    const stats = wild.stats.slice();
    wild.addMark(PokemonMark.MINI_MARK);
    wild.calculateStats();
    expect(wild.stats).toEqual(stats);

    const caught = wild.addToParty(PokeballType.POKEBALL)!;
    expect(caught.marks).toEqual([PokemonMark.MINI_MARK]);
    expect(caught.getSpriteScale()).toBeCloseTo(MINI_SPRITE_SCALE);
  });
});
