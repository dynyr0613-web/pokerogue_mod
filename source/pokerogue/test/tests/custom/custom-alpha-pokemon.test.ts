// Local fork (2026-11-17): alpha Pokémon (우두머리), alpha-pokemon.ts. The user: "우두머리: 야생 포켓몬이 확률적으로
// 능력치가 1~20% 증가된 채 나오며, 스프라이트 크기가 10% 증가 / 우두머리인 상태로 진화 / 메가진화 / 다이맥스 활성/비활성
// 시에도 우두머리 상태 유지 / 황금 우두머리 증표 획득 조건: 능력치 증가율이 20%인 우두머리 포켓몬을 알 바우처로 뽑기 /
// 포획 / 포켓몬 선택 창에서 우두머리 on/off 가능, 능력치 증가율은 획득한 해당 포켓몬의 우두머리중 가장 높은 값으로 고정".
import { speciesDataRegistry } from "#app/global-species-data-registry";
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
import { EGG_MASTER_BALL_RATE, Egg } from "#data/egg";
import { Gender } from "#data/gender";
import { BiomeId } from "#enums/biome-id";
import { Challenges } from "#enums/challenges";
import { DexAttr } from "#enums/dex-attr";
import { EggSourceType } from "#enums/egg-source-types";
import { EggTier } from "#enums/egg-type";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Nature } from "#enums/nature";
import { PokeballType } from "#enums/pokeball";
import { PokemonMark } from "#enums/pokemon-mark";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { PERMANENT_STATS, Stat } from "#enums/stat";
import { TrainerSlot } from "#enums/trainer-slot";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import { EnemyPokemon } from "#field/pokemon";
import * as MysteryEncounters from "#mystery-encounters/mystery-encounter-biomes";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { achvs } from "#system/achv";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import type { Starter, StarterMoveset } from "#types/save-data";
import type { StarterSpeciesId } from "#types/starter-species-id";
import type { BattleInfo } from "#ui/battle-info";
import type { StarterSelectUiHandler } from "#ui/starter-select-ui-handler";
import { getStarterData } from "#ui/starter-select-ui-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

  it("hatches about 1 Pokémon in 100 in a Master Ball, with the Master Ball Mark", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    expect(EGG_MASTER_BALL_RATE).toBe(100);
    let inMasterBall = 0;
    const total = 800;
    for (let i = 0; i < total; i++) {
      const hatched = new Egg({
        tier: EggTier.COMMON,
        species: SpeciesId.MAGIKARP,
        id: 1073751824 + i,
      }).generatePlayerPokemon();
      // The ball and the mark come together
      expect(hatched.hasMark(PokemonMark.MASTER_BALL_MARK)).toBe(hatched.pokeball === PokeballType.MASTER_BALL);
      if (hatched.pokeball === PokeballType.MASTER_BALL) {
        inMasterBall++;
      }
      hatched.destroy();
    }
    // 8 expected
    expect(inMasterBall).toBeGreaterThan(0);
    expect(inMasterBall).toBeLessThan(24);
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

  // Local fork (2026-11-17), review: getRootSpeciesId() walks Pikachu on to Pichu, so the Pikachu starter (a starter of
  // its own) never got an alpha, and the two every-species alpha achievements could never be completed
  it("credits an alpha of the Pikachu line to both the Pichu and the Pikachu starter", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const { starterData } = game.scene.gameData;
    // Made directly: the enemy species override would turn a wild Pokémon into a Magikarp
    const wild = new EnemyPokemon(speciesDataRegistry.getSpecies(SpeciesId.PIKACHU), 50, TrainerSlot.NONE, false);
    wild.setAlphaBoost(12);
    const caught = wild.addToParty(PokeballType.POKEBALL)!;
    await game.scene.gameData.setPokemonCaught(caught, true, false, false);
    expect(starterData[SpeciesId.PIKACHU].alphaBoost).toBe(12);
    expect(starterData[SpeciesId.PICHU].alphaBoost).toBe(12);

    /** Only the species and the boost are read */
    const alphaOf = (speciesId: SpeciesId, boost: number) =>
      ({ alphaBoost: boost, species: speciesDataRegistry.getSpecies(speciesId) }) as unknown as Pokemon;
    starterData[SpeciesId.PIKACHU].alphaBoost = undefined;
    starterData[SpeciesId.PICHU].alphaBoost = undefined;
    // A Pichu is only the Pichu starter's, an evolved one both starters'
    expect(registerAlpha(alphaOf(SpeciesId.PICHU, 5))).toBe(true);
    expect(starterData[SpeciesId.PICHU].alphaBoost).toBe(5);
    expect(starterData[SpeciesId.PIKACHU].alphaBoost).toBeUndefined();
    expect(registerAlpha(alphaOf(SpeciesId.RAICHU, 7))).toBe(true);
    expect(starterData[SpeciesId.PICHU].alphaBoost).toBe(7);
    expect(starterData[SpeciesId.PIKACHU].alphaBoost).toBe(7);
    expect(registerAlpha(alphaOf(SpeciesId.ALOLA_RAICHU, 6))).toBe(false);

    // An alpha of every starter species, each of its own species: the every-species achievements can be completed
    const starters = speciesDataRegistry.getAllStarters();
    for (const id of starters) {
      starterData[id].alphaBoost = undefined;
    }
    for (const id of starters) {
      registerAlpha(alphaOf(id, ALPHA_MAX_BOOST));
    }
    expect(starters.filter(id => starterData[id].alphaBoost !== ALPHA_MAX_BOOST)).toEqual([]);
    expect(achvs.ALPHA_MARKS_ALL_SPECIES.validate()).toBe(true);
    expect(achvs.GOLDEN_ALPHA_MARKS_ALL_SPECIES.validate()).toBe(true);
    for (const id of starters) {
      starterData[id].alphaBoost = undefined;
    }
  });

  // Local fork (2026-11-17), review: the name was not shortened for the alpha badge, so with a long name (a nickname, or
  // a shiny or fused one) the badge covered "Lv"
  it("shortens a long name enough for the alpha badge to stay clear of Lv", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const pokemon = game.field.getPlayerPokemon();
    pokemon.gender = Gender.MALE;
    const info = pokemon.getBattleInfo() as BattleInfo;
    const limit = (level: number, boost: number): number => {
      pokemon.level = level;
      pokemon.alphaBoost = boost;
      return info["getNameWidthLimit"](pokemon);
    };
    // Measured from the battle info font (12px): "♂" is 4.5px wide. In the player's box the name starts at -115 and
    // "Lv" (8px wide) ends at -41 + 5.5, moving 8px left per level digit past the third. The badge's icon is drawn
    // 4px after the name's icons and is visible to 8.1px past that (36 of its 40px at 0.225).
    const genderWidth = 4.5;
    for (const level of [5, 50, 100, 999, 1000, 54321]) {
      const lvLeft = -41 + 5.5 - 8 + 115 - 8 * Math.max(level.toString().length - 3, 0);
      const badgeRight = limit(level, 7) + genderWidth + 1 + 4 + 36 * 0.225;
      expect(badgeRight, `level ${level}`).toBeLessThanOrEqual(lvLeft);
    }
    // An ordinary Pokémon's name keeps all its room
    expect([5, 50, 100, 1000].map(level => limit(level, 0))).toEqual([70, 62, 54, 46]);
    // An alpha's name is not shortened more than it needs: from 3 digits on only by 2px
    expect([5, 50, 100, 1000].map(level => limit(level, ALPHA_MAX_BOOST))).toEqual([52, 52, 52, 44]);
  });

  /**
   * Build a starter the way the starter select does (`StarterSelectUiHandler.addToParty`, which reads the starter's data
   * through the challenges) and start the run with it
   * @param speciesId - The starter
   * @param prepare - Called on the title screen before the starter is built, to set up the save
   * @returns The starter and what the challenges' copy of its data held when it was built
   */
  async function startFromStarterSelect(
    speciesId: StarterSpeciesId,
    prepare: () => void,
  ): Promise<{ starter: Starter; copyBoost: number; copyPartnerMark: boolean }> {
    await game.runToTitle();
    let result: { starter: Starter; copyBoost: number; copyPartnerMark: boolean } | undefined;
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      if (game.challengeMode.challenges.length > 0) {
        game.scene.gameMode.challenges = game.challengeMode.challenges;
      }
      prepare();
      const copy = getStarterData(speciesId).starterDataEntry;
      const handler = game.scene.ui.handlers[UiMode.STARTER_SELECT] as StarterSelectUiHandler;
      handler["starterPreferences"] ??= {};
      // As if the cursor were on it (the instructions shown after adding read it)
      handler["lastStarterId"] = speciesId;
      const dexAttr = DexAttr.NON_SHINY | DexAttr.MALE | DexAttr.DEFAULT_VARIANT | DexAttr.DEFAULT_FORM;
      const moveset: StarterMoveset = [MoveId.TACKLE, MoveId.GROWL];
      handler["addToParty"](
        speciesId,
        dexAttr,
        0,
        Nature.HARDY,
        moveset,
        speciesDataRegistry.getSpecies(speciesId).type1,
      );
      const starter = handler["partyStarters"].at(-1)!;
      result = { starter, copyBoost: getStarterAlphaBoost(copy), copyPartnerMark: !!copy.partnerMark };
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle([starter]);
    });
    await game.phaseInterceptor.to("EncounterPhase");
    return result!;
  }

  const setUpAlphaStarter = () => {
    const entry = game.scene.gameData.starterData[SpeciesId.BULBASAUR];
    entry.alphaBoost = ALPHA_MAX_BOOST;
    entry.alphaEnabled = true;
    entry.partnerMark = true;
  };

  it("takes a starter switched on as an alpha, and its Partner Mark, into the run", async () => {
    const { starter, copyBoost } = await startFromStarterSelect(SpeciesId.BULBASAUR, setUpAlphaStarter);
    expect(copyBoost).toBe(ALPHA_MAX_BOOST);
    expect(starter.alphaBoost).toBe(ALPHA_MAX_BOOST);
    expect(starter.partnerMark).toBe(true);
    const pokemon = game.scene.getPlayerParty()[0];
    expect(pokemon.alphaBoost).toBe(ALPHA_MAX_BOOST);
    expect(pokemon.marks).toEqual(
      expect.arrayContaining([
        PokemonMark.ALPHA_MARK,
        PokemonMark.JUMBO_MARK,
        PokemonMark.GOLDEN_ALPHA_MARK,
        PokemonMark.PARTNER_MARK,
      ]),
    );
  });

  // Local fork (2026-11-17), review: Fresh Start removes every other permanent upgrade of a starter, but the alpha's +1
  // to 20% to every stat and the Partner Mark came along, and the alpha option was still offered
  it("leaves the alpha and the Partner Mark out of a Fresh Start run, and keeps them in the save", async () => {
    game.challengeMode.addChallenge(Challenges.FRESH_START, 1, 1);
    const { starter, copyBoost, copyPartnerMark } = await startFromStarterSelect(
      SpeciesId.BULBASAUR,
      setUpAlphaStarter,
    );
    // The challenges' copy of the starter's data, which the alpha option of the starter menu reads too
    expect(copyBoost).toBe(0);
    expect(copyPartnerMark).toBe(false);
    expect(starter.alphaBoost).toBe(0);
    expect(starter.partnerMark).toBe(false);
    const pokemon = game.scene.getPlayerParty()[0];
    expect(pokemon.alphaBoost).toBe(0);
    for (const mark of [
      PokemonMark.ALPHA_MARK,
      PokemonMark.JUMBO_MARK,
      PokemonMark.GOLDEN_ALPHA_MARK,
      PokemonMark.PARTNER_MARK,
    ]) {
      expect(pokemon.marks, PokemonMark[mark]).not.toContain(mark);
    }
    // The save keeps them for runs without the challenge
    const entry = game.scene.gameData.starterData[SpeciesId.BULBASAUR];
    expect(entry.alphaBoost).toBe(ALPHA_MAX_BOOST);
    expect(entry.alphaEnabled).toBe(true);
    expect(entry.partnerMark).toBe(true);
  });
});

// Local fork (2026-11-17), review: Dancing Lessons makes its Oricorio as a wild Pokémon and then fights it as a boss, so
// about 1 time in 50 the boss was an alpha (and as often a mini one), though bosses are never either
describe("Local fork - alpha Pokémon: Dancing Lessons", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.mysteryEncounterChance(100).startingWave(45).startingBiome(BiomeId.PLAINS).disableTrainerWaves();
    vi.spyOn(MysteryEncounters, "mysteryEncountersByBiome", "get").mockReturnValue(
      new Map<BiomeId, MysteryEncounterType[]>([[BiomeId.PLAINS, [MysteryEncounterType.DANCING_LESSONS]]]),
    );
  });

  it("never makes the boss Oricorio an alpha or a mini one", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.DANCING_LESSONS, [SpeciesId.LAPRAS]);
    const encounter = game.scene.currentBattle.mysteryEncounter!;
    const sizeMarks = [
      PokemonMark.ALPHA_MARK,
      PokemonMark.JUMBO_MARK,
      PokemonMark.GOLDEN_ALPHA_MARK,
      PokemonMark.MINI_MARK,
    ];
    // Each new Oricorio has its own rolls (about 1 in 25 is an alpha or a mini one)
    for (let i = 0; i < 150; i++) {
      encounter.onInit!();
      // Let the new Oricorio's sprite load before the next one sends it off the field
      await Promise.all(encounter.loadAssets);
      const config = encounter.enemyPartyConfigs[0].pokemonConfigs![0];
      expect(config.isBoss).toBe(true);
      const data = config.dataSource as PokemonData;
      expect(data.species).toBe(SpeciesId.ORICORIO);
      expect(normalizeAlphaBoost(data.alphaBoost), `try ${i}`).toBe(0);
      expect(
        (data.marks ?? []).filter(m => sizeMarks.includes(m)),
        `try ${i}`,
      ).toEqual([]);
    }
  });
});
