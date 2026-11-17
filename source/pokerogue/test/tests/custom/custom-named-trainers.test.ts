import { Battle } from "#app/battle";
import { getGameMode } from "#app/game-mode";
import { allBiomes } from "#data/data-lists";
import { enemyBattleFormDice, getSignatureOnlyFormItem, SIGNATURE_BATTLE_FORMS } from "#data/enemy-battle-forms";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { BiomePoolTier } from "#enums/biome-pool-tier";
import { FormChangeItem } from "#enums/form-change-item";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { UiMode } from "#enums/ui-mode";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";
import { Trainer } from "#field/trainer";
import { PokemonFormChangeItemModifier } from "#modifiers/modifier";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import {
  canDrawTrainerOnWave,
  FORK_NAMED_TRAINER_LEGEND_WAVE,
  FORK_NAMED_TRAINER_MIN_WAVES,
  FORK_NAMED_TRAINER_TYPES,
  filterTrainerPoolForWave,
  getTrainerVictorySeedOffset,
  isForkLateBossTrainer,
} from "#trainers/named-trainers";
import { type TrainerConfig, trainerConfigs } from "#trainers/trainer-config";
import { trainerPartyTemplates } from "#trainers/trainer-party-template";
import { getEnumValues } from "#utils/enums";
import { willTerastallize } from "#utils/pokemon-utils";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

/** Local fork (2026-11-11): each new trainer's data, as the workflow's sprite, lore and dialogue research gave it */
interface Expected {
  readonly key: string;
  readonly ko: string;
  readonly en: string;
  readonly title: string;
  readonly bgm: string;
  /** The root species of its ace before the legend wave, and its legendary ace (if any) from it */
  readonly ace: SpeciesId;
  readonly legend?: readonly SpeciesId[];
  /** The biomes whose BOSS trainer tier holds it */
  readonly biomes: readonly BiomeId[];
  /** SHA-256 of the downloaded Showdown sprite (tools/port_named_trainers/CREDITS_showdown.md) and its opaque box */
  readonly sha256: string;
  readonly box: readonly [number, number, number, number];
}

const EXPECTED: Readonly<Record<number, Expected>> = {
  [TrainerType.VOLO]: {
    key: "volo",
    ko: "월로",
    en: "Volo",
    title: "pokemonWielder",
    bgm: "battle_legendary_origin_forme",
    ace: SpeciesId.GIBLE,
    legend: [SpeciesId.GIRATINA],
    biomes: [BiomeId.TEMPLE, BiomeId.RUINS],
    sha256: "aa17265f0c54c6886f8124ef2bf44135c768e3e96296bc5131b4e669339af20a",
    box: [15, 0, 69, 80],
  },
  [TrainerType.IRIDA]: {
    key: "irida",
    ko: "주혜",
    en: "Irida",
    title: "pearlClanLeader",
    bgm: "battle_sinnoh_gym",
    ace: SpeciesId.EEVEE,
    biomes: [BiomeId.ICE_CAVE, BiomeId.SNOWY_FOREST],
    sha256: "e088fd5bd584ab83da80cffaf7c616f6540e37382f15b7e4c376f59b104a73c6",
    box: [17, 2, 62, 78],
  },
  [TrainerType.ADAMAN]: {
    key: "adaman",
    ko: "찬석",
    en: "Adaman",
    title: "diamondClanLeader",
    bgm: "battle_sinnoh_gym",
    ace: SpeciesId.EEVEE,
    biomes: [BiomeId.SWAMP, BiomeId.LAKE],
    sha256: "cbb5c2e1e445cc824b0c682c7b846fc91f93d0ae691038d0372780a6e8ae35b2",
    box: [26, 0, 63, 79],
  },
  [TrainerType.KAMADO]: {
    key: "kamado",
    ko: "전목",
    en: "Kamado",
    title: "galaxyTeamCommander",
    bgm: "battle_galactic_boss",
    ace: SpeciesId.MUNCHLAX,
    biomes: [BiomeId.MOUNTAIN, BiomeId.BEACH],
    sha256: "734771d46cc6663cdd58ce4652ecae5650738a80eabf7298c7b586e3dc99f4b6",
    box: [14, 2, 67, 79],
  },
  [TrainerType.SONIA]: {
    key: "sonia",
    ko: "소니아",
    en: "Sonia",
    title: "professor",
    bgm: "battle_macro_grunt",
    ace: SpeciesId.YAMPER,
    biomes: [BiomeId.RUINS, BiomeId.PLAINS],
    sha256: "069f4dd4d5eeccdf8a71e9507c56d0a876b24c470e03cee970386659d0b6fefa",
    box: [23, 0, 64, 80],
  },
  [TrainerType.HOP]: {
    key: "hop",
    ko: "호브",
    en: "Hop",
    title: "pokemonTrainer",
    bgm: "battle_galar_gym",
    ace: SpeciesId.GROOKEY, // or Scorbunny / Sobble: checked through the line below
    legend: [SpeciesId.ZACIAN, SpeciesId.ZAMAZENTA],
    biomes: [BiomeId.PLAINS, BiomeId.METROPOLIS],
    sha256: "ee0f354518dcf4889a05742f13ae823c392afeb1a2d99ae7339f2a08115680f3",
    box: [16, 10, 63, 78],
  },
  [TrainerType.PEONY]: {
    key: "peony",
    ko: "피오니",
    en: "Peony",
    title: "formerGymLeader",
    bgm: "battle_galar_elite",
    ace: SpeciesId.CUFANT,
    biomes: [BiomeId.ICE_CAVE, BiomeId.FACTORY],
    sha256: "7c246c926aebbab02477c72b27b8577b02837b0dce6b8d551c522098cb2e34b2",
    box: [21, 1, 60, 80],
  },
  [TrainerType.SADA]: {
    key: "sada",
    ko: "올림",
    en: "Sada",
    title: "professor",
    bgm: "battle_legendary_kor_mir",
    ace: SpeciesId.ROARING_MOON,
    legend: [SpeciesId.KORAIDON],
    biomes: [BiomeId.ABYSS, BiomeId.JUNGLE],
    sha256: "da633b1eba793396f441d6bdf935365d7689e4d64d203e44ee5d758a6da1e23c",
    box: [21, 3, 59, 79],
  },
  [TrainerType.TURO]: {
    key: "turo",
    ko: "투로",
    en: "Turo",
    title: "professor",
    bgm: "battle_legendary_kor_mir",
    ace: SpeciesId.IRON_VALIANT,
    legend: [SpeciesId.MIRAIDON],
    biomes: [BiomeId.LABORATORY, BiomeId.POWER_PLANT],
    sha256: "201ad081305986e3bcdc153e4cbf7b728828168cbadc051aa1365472fbb35289",
    box: [23, 2, 57, 79],
  },
  [TrainerType.CARMINE]: {
    key: "carmine",
    ko: "시유",
    en: "Carmine",
    title: "leagueClub",
    bgm: "battle_bb_elite",
    ace: SpeciesId.POLTCHAGEIST,
    biomes: [BiomeId.FOREST, BiomeId.MOUNTAIN],
    sha256: "7e19b72108259160862f0fa6f6c5fe804b9ad9b4fbb10cccd688d6abca29c53a",
    box: [22, 5, 54, 79],
  },
  [TrainerType.BRIAR]: {
    key: "briar",
    ko: "브라이어",
    en: "Briar",
    title: "instructor",
    bgm: "battle_legendary_terapagos",
    ace: SpeciesId.GLIMMET,
    legend: [SpeciesId.TERAPAGOS],
    biomes: [BiomeId.CAVE, BiomeId.ISLAND],
    sha256: "fa83f80c0cc8d382d927c375772761fa72af115361059c298ef74827559d4bf6",
    box: [28, 5, 51, 79],
  },
};

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

/**
 * Local fork (2026-11-11): the fork's named trainers (named-trainers.ts): 월로, 주혜, 찬석, 전목, 소니아, 호브, 피오니, 올림,
 * 투로, 시유, 브라이어, boss trainers of the biome pools with their original teams, voices and Showdown sprites. The user:
 * "인터넷에서 에셋을 찾아보죠. 에센셜에 쓸 수 있는 네임드 트레이너 도트 이미지/대사 에셋들을" and "네, 추가해주세요.
 * 대사는 최대한 원작 느낌을 살릴 수 있도록 하죠."; Volo's ace from "월로(게임 내에 있다면)-오리진 기라티나". Lean on purpose.
 */
describe("Custom named trainers - Volo, Irida, Adaman, Kamado, Sonia, Hop, Peony, Sada, Turo, Carmine, Briar", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logSpy: MockInstance | undefined;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH])
      .mysteryEncounterChance(0);
  });

  afterEach(() => {
    logSpy?.mockRestore();
    logSpy = undefined;
    vi.restoreAllMocks();
  });

  /** A quiet Classic wild run on `wave` to build trainer battles by hand on (as custom-endless-trainers does) */
  async function startQuietRun(wave: number): Promise<void> {
    game.override.disableTrainerWaves().startingWave(wave);
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.CLASSIC);
      game.scene.offsetGym = false;
      const starters = generateStarters(game.scene, [SpeciesId.FEEBAS]);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    await game.phaseInterceptor.to("EncounterPhase");
    await game.phaseInterceptor.to("CommandPhase", false);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  }

  /**
   * Builds `type`'s battle on `wave` as `BattleScene.newBattle` does and rolls its party as `EncounterPhase` does;
   * review fix: or, with a config `override` and a `levelAdditive`, as a Mystery Encounter's trainer battle does
   * (`initBattleWithEnemyConfig`: the config's clone, its levels raised by the encounter's additive)
   */
  function buildParty(
    type: TrainerType,
    wave: number,
    seed: string,
    override?: TrainerConfig,
    levelAdditive = 0,
  ): { party: EnemyPokemon[]; trainer: Trainer; cleanUp: () => void } {
    const { scene } = game;
    // As in `newBattle`, the battle is made while the current one is the wave before (the gym template reads it)
    scene.currentBattle.waveIndex = wave - 1;
    scene.setSeed(seed);
    scene.resetSeed(wave);
    const trainer = new Trainer(type, TrainerVariant.DEFAULT, undefined, undefined, undefined, override);
    const battle = new Battle(scene.gameMode, {
      waveIndex: wave,
      battleType: BattleType.TRAINER,
      trainer,
      double: false,
    });
    scene.currentBattle = battle;
    battle.enemyLevels = battle.enemyLevels?.map(level => level + levelAdditive);
    for (let e = 0; e < (battle.enemyLevels?.length ?? 0); e++) {
      battle.enemyParty[e] = trainer.genPartyMember(e);
    }
    return {
      party: battle.enemyParty,
      trainer,
      cleanUp: () => {
        for (const p of battle.enemyParty) {
          p.destroy();
        }
        trainer.destroy();
      },
    };
  }

  const formItemsOf = (pokemon: Pokemon) =>
    game.scene.findModifiers(
      m => m instanceof PokemonFormChangeItemModifier && m.pokemonId === pokemon.id,
      false,
    ) as PokemonFormChangeItemModifier[];

  it("appends the trainer types after RIVAL_6 with explicit values from 400, one each", () => {
    expect(FORK_NAMED_TRAINER_TYPES).toEqual([400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410]);
    expect(FORK_NAMED_TRAINER_TYPES.map(t => TrainerType[t])).toEqual([
      "VOLO",
      "IRIDA",
      "ADAMAN",
      "KAMADO",
      "SONIA",
      "HOP",
      "PEONY",
      "SADA",
      "TURO",
      "CARMINE",
      "BRIAR",
    ]);
    const values = getEnumValues(TrainerType) as number[];
    expect(new Set(values).size).toBe(values.length);
    // Every older member keeps its number below the fork's range; the old last member is still RIVAL_6 = 380
    expect(Math.max(...values.filter(v => !FORK_NAMED_TRAINER_TYPES.includes(v)))).toBe(TrainerType.RIVAL_6);
    expect(TrainerType.RIVAL_6).toBe(380);
    expect(Object.keys(EXPECTED).map(Number)).toEqual([...FORK_NAMED_TRAINER_TYPES]);
  });

  it("gives each a boss config with its name, title, music, dialogue keys and six party slots", () => {
    const en = {
      names: readJson("./locales/en/trainer-names.json"),
      titles: readJson("./locales/en/trainer-titles.json"),
      dialogue: readJson("./locales/en/dialogue.json"),
    };
    const ko = {
      names: readJson("./locales/ko/trainer-names.json"),
      titles: readJson("./locales/ko/trainer-titles.json"),
      dialogue: readJson("./locales/ko/dialogue.json"),
    };
    const lookup = (dialogue: Record<string, any>, key: string): unknown =>
      key
        .replace(/^dialogue:/, "")
        .split(".")
        .reduce((node, part) => node?.[part], dialogue);
    for (const type of FORK_NAMED_TRAINER_TYPES) {
      const e = EXPECTED[type];
      const config = trainerConfigs[type];
      expect(config.trainerType).toBe(type);
      expect(config.getSpriteKey()).toBe(e.key);
      expect([config.isBoss, config.hasStaticParty, config.hasVoucher]).toEqual([true, true, true]);
      expect(
        Object.keys(config.partyMemberFuncs)
          .map(Number)
          .sort((a, b) => a - b),
      ).toEqual([-6, -5, -4, -3, -2, -1]);
      expect([config.battleBgm, config.mixedBattleBgm]).toEqual([e.bgm, e.bgm]);
      for (const bgm of [config.battleBgm, config.victoryBgm]) {
        expect(existsSync(`./assets/audio/bgm/${bgm}.mp3`), bgm).toBe(true);
      }
      // Name and title in both languages (the English ones are what the config holds in tests)
      expect([en.names[e.key], ko.names[e.key]]).toEqual([e.en, e.ko]);
      expect(typeof en.titles[e.title]).toBe("string");
      expect(typeof ko.titles[e.title]).toBe("string");
      expect(config.name).toBe(e.en);
      expect(config.title).toBe(en.titles[e.title]);
      // Three encounter and victory lines and two defeat lines, every key resolving in Korean and English
      expect([config.encounterMessages.length, config.victoryMessages.length, config.defeatMessages.length]).toEqual([
        3, 3, 2,
      ]);
      for (const key of [...config.encounterMessages, ...config.victoryMessages, ...config.defeatMessages]) {
        expect(key.startsWith(`dialogue:${e.key}.`), key).toBe(true);
        for (const lang of [en, ko]) {
          const line: unknown = lookup(lang.dialogue, key);
          expect(typeof line === "string" && line.length > 0, key).toBe(true);
        }
        expect(i18next.t(key)).toBe(lookup(en.dialogue, key));
      }
    }
    // The Korean voice samples the workflow asked for: Volo's merchant mask, then his true colours; Sada's glitch
    expect(lookup(ko.dialogue, "volo.encounter.3")).toContain("기라티나, 모조리 부숴 버려라!");
    expect(lookup(ko.dialogue, "sada.victory.3")).toBe("오ㄹ류 발생… 낙원 방ㅇ어 프로그ㄹ램을… 정지합ㄴ니다…");
    // Review fix: the reworded lines (Irida's one Sinnoh ruling space, Volo's mask slipping on his second loss line)
    expect(lookup(ko.dialogue, "irida.encounter.3")).toContain("신오님이 다스리시는 건 공간이라는 거");
    expect(lookup(ko.dialogue, "volo.victory.2")).toContain("…어째서지? 아르세우스여, 어째서 나를 보지 않는가!");
  });

  it("ships each Showdown sprite byte for byte, with a one-frame atlas cropped to its opaque box", () => {
    const sample = readJson("./assets/images/trainer/rival_m.json");
    for (const type of FORK_NAMED_TRAINER_TYPES) {
      const { key, sha256, box } = EXPECTED[type];
      const png = readFileSync(`./assets/images/trainer/${key}.png`);
      expect(createHash("sha256").update(png).digest("hex"), key).toBe(sha256);
      const atlas = readJson(`./assets/images/trainer/${key}.json`);
      // The same layout as the stock one-frame atlases (rival_m), which the trainer loader already shows
      expect([...Object.keys(atlas.textures[0])].sort()).toEqual([...Object.keys(sample.textures[0])].sort());
      expect(atlas.textures).toHaveLength(1);
      expect(atlas.textures[0].image).toBe(`${key}.png`);
      expect(atlas.textures[0].size).toEqual({ w: 80, h: 80 });
      const [x0, y0, x1, y1] = box;
      const w = x1 - x0;
      const h = y1 - y0;
      expect(atlas.textures[0].frames).toEqual([
        {
          filename: "0001.png",
          rotated: false,
          trimmed: false,
          sourceSize: { w, h },
          spriteSourceSize: { x: 0, y: 0, w, h },
          frame: { x: x0, y: y0, w, h },
        },
      ]);
    }
  });

  it("puts each in the BOSS tier of its biomes, at most two new names in a biome and never more than its leaders", () => {
    for (const type of FORK_NAMED_TRAINER_TYPES) {
      const holders = [...allBiomes.values()]
        .filter(b => b.trainerPool[BiomePoolTier.BOSS].includes(type))
        .map(b => b.biomeId);
      expect(holders.sort(), TrainerType[type]).toEqual([...EXPECTED[type].biomes].sort());
      // In the BOSS tier only
      for (const biome of allBiomes.values()) {
        for (const tier of getEnumValues(BiomePoolTier).filter(t => t !== BiomePoolTier.BOSS)) {
          expect(biome.trainerPool[tier].includes(type)).toBe(false);
        }
      }
    }
    for (const biome of allBiomes.values()) {
      const boss = biome.trainerPool[BiomePoolTier.BOSS];
      const named = boss.filter(t => FORK_NAMED_TRAINER_TYPES.includes(t));
      // Local fork (2026-11-12): the late boss trainers (Endless past wave 200 only) are not the biome's leaders
      const leaders = boss.filter(t => !FORK_NAMED_TRAINER_TYPES.includes(t) && !isForkLateBossTrainer(t));
      expect(named.length, BiomeId[biome.biomeId]).toBeLessThanOrEqual(2);
      expect(named.length, BiomeId[biome.biomeId]).toBeLessThanOrEqual(leaders.length);
    }
  });

  it("keeps Volo, Sada and Turo out of a biome's draw before wave 110; the others come from the first gym wave", async () => {
    await startQuietRun(30);
    expect(FORK_NAMED_TRAINER_LEGEND_WAVE).toBe(110);
    expect(FORK_NAMED_TRAINER_MIN_WAVES).toEqual({
      [TrainerType.VOLO]: 110,
      [TrainerType.SADA]: 110,
      [TrainerType.TURO]: 110,
    });
    const temple = allBiomes.get(BiomeId.TEMPLE).trainerPool[BiomePoolTier.BOSS];
    expect(filterTrainerPoolForWave(temple, 80)).toEqual([TrainerType.FANTINA]);
    expect(filterTrainerPoolForWave(temple, 110)).toEqual([TrainerType.FANTINA, TrainerType.VOLO]);
    // A tier without a gated trainer is the same array, so its draw is the same as before
    const ruins = allBiomes.get(BiomeId.RUINS).trainerPool[BiomePoolTier.BOSS];
    expect(filterTrainerPoolForWave(allBiomes.get(BiomeId.PLAINS).trainerPool[BiomePoolTier.BOSS], 20)).toBe(
      allBiomes.get(BiomeId.PLAINS).trainerPool[BiomePoolTier.BOSS],
    );
    expect(filterTrainerPoolForWave(ruins, 50)).not.toContain(TrainerType.VOLO);
    expect(filterTrainerPoolForWave(ruins, 50)).toContain(TrainerType.SONIA);
    expect(canDrawTrainerOnWave(TrainerType.HOP, 20)).toBe(true);

    // The arena's boss draw in the Abyss (Marnie, Sada): only Marnie before wave 110, both from it
    game.scene.newArena(BiomeId.ABYSS);
    const draws = (wave: number) => {
      const drawn = new Set<TrainerType>();
      for (let s = 0; s < 40; s++) {
        game.scene.setSeed(`abyss-${s}`);
        game.scene.resetSeed(wave);
        drawn.add(game.scene.arena.randomTrainerType(wave, true));
      }
      return [...drawn].sort();
    };
    expect(draws(80)).toEqual([TrainerType.MARNIE]);
    expect(draws(110)).toEqual([TrainerType.MARNIE, TrainerType.SADA].sort());
  });

  it("scales each party to the wave like a gym leader's, the ace last with two boss bars, a legend from wave 110", async () => {
    await startQuietRun(30);
    // Classic gym party sizes: 2 on wave 20, 4 on 50, 5 on 80, 6 from 110
    const sizes: Record<number, number> = { 20: 2, 50: 4, 80: 5, 110: 6, 140: 6 };
    for (const type of FORK_NAMED_TRAINER_TYPES) {
      for (const wave of [20, 50, 80, 110, 140]) {
        for (const seed of ["a", "b"]) {
          const { party, cleanUp } = buildParty(type, wave, `${EXPECTED[type].key}-${seed}`);
          const label = `${TrainerType[type]} wave ${wave} seed ${seed}`;
          expect(party, label).toHaveLength(sizes[wave]);
          checkParty(type, wave, party, label);
          cleanUp();
        }
      }
    }
  }, 300_000);

  /** One generated party of {@linkcode FORK_NAMED_TRAINER_TYPES}' scaling test */
  function checkParty(type: TrainerType, wave: number, party: readonly EnemyPokemon[], label: string): void {
    const e = EXPECTED[type];
    const rootOf = (p: EnemyPokemon) => p.species.getRootSpeciesId();
    const aceRoots = e.ace === SpeciesId.GROOKEY ? [SpeciesId.GROOKEY, SpeciesId.SCORBUNNY, SpeciesId.SOBBLE] : [e.ace];
    expect(
      party.every(p => p.trainerSlot === TrainerSlot.TRAINER && p.hasTrainer()),
      label,
    ).toBe(true);
    const ace = party.at(-1)!;
    expect([ace.isBoss(), ace.bossSegments], label).toEqual([true, 2]);
    expect(
      party.slice(0, -1).some(p => p.isBoss()),
      label,
    ).toBe(false);
    const withLegend = e.legend != null && wave >= FORK_NAMED_TRAINER_LEGEND_WAVE;
    // With its legend, the old ace is the co-ace
    expect(aceRoots, label).toContain(rootOf(withLegend ? party.at(-2)! : ace));
    expect(withLegend ? e.legend : [ace.species.speciesId], label).toContain(ace.species.speciesId);
    // The clan leaders field their Eeveelution ace from the first wave, as their originals do (Glaceon at Lv17)
    const keptAces: Partial<Record<number, SpeciesId>> = {
      [TrainerType.IRIDA]: SpeciesId.GLACEON,
      [TrainerType.ADAMAN]: SpeciesId.LEAFEON,
    };
    expect(ace.species.speciesId, label).toBe(keptAces[type] ?? ace.species.speciesId);
    // No species twice (Eeveelutions share a root, so the species, not the line)
    expect(new Set(party.map(p => p.species.speciesId)).size, label).toBe(party.length);
  }

  it("gives Volo's ace Giratina its Origin Forme holding the Griseous Core, with no roll, kept through a reload", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.VOLO, trainerVariant: TrainerVariant.DEFAULT })
      .startingWave(110);
    game.override.removeEnemyStartingItems = false;
    const dice = vi.spyOn(enemyBattleFormDice, "roll");
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const trainer = game.scene.currentBattle.trainer!;
    expect(trainer.config.trainerType).toBe(TrainerType.VOLO);
    expect(trainer.getName(TrainerSlot.NONE, true)).toBe("Pokémon Wielder Volo");
    expect(SIGNATURE_BATTLE_FORMS[TrainerType.VOLO]?.forms).toEqual([
      { formKey: SpeciesFormKey.ORIGIN, item: FormChangeItem.GRISEOUS_CORE },
    ]);
    const party = game.scene.getEnemyParty();
    expect(party).toHaveLength(6);
    const giratina = party[5];
    expect([giratina.species.speciesId, giratina.getFormKey(), giratina.isBoss()]).toEqual([
      SpeciesId.GIRATINA,
      SpeciesFormKey.ORIGIN,
      true,
    ]);
    // His config already fields the Origin Forme: no battle-form roll at all, and no other member transformed
    expect(dice).not.toHaveBeenCalled();
    expect(party.filter(p => p.isMega() || p.isMax())).toEqual([]);
    expect(formItemsOf(giratina).map(m => [m.formChangeItem, m.active, m.isTransferable])).toEqual([
      [FormChangeItem.GRISEOUS_CORE, true, false],
    ]);
    // Only a signature trainer's own Pokémon in that form gets the item
    expect(getSignatureOnlyFormItem(giratina)).toBe(FormChangeItem.GRISEOUS_CORE);
    expect(getSignatureOnlyFormItem(party[0])).toBeNull();

    // A save and reload keeps trainer type 400, the form and the item
    const { gameData } = game.scene;
    const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
    game.reload["sessionData"] = gameData.parseSessionData(json);
    await game.reload.reloadSession();
    expect(game.scene.currentBattle.trainer?.config.trainerType).toBe(TrainerType.VOLO);
    const reloaded = game.scene.getEnemyParty()[5];
    expect([reloaded.species.speciesId, reloaded.getFormKey()]).toEqual([SpeciesId.GIRATINA, SpeciesFormKey.ORIGIN]);
    expect(formItemsOf(reloaded).map(m => m.formChangeItem)).toEqual([FormChangeItem.GRISEOUS_CORE]);
  });

  it("puts Origin Giratina in place of Volo's ace when his roll hits before wave 110 (an override's battle)", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.VOLO, trainerVariant: TrainerVariant.DEFAULT })
      .startingWave(100);
    game.override.removeEnemyStartingItems = false;
    const dice = vi.spyOn(enemyBattleFormDice, "roll").mockReturnValue(0);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    // Wave 100: a full gym party (the run's first battle sizes it with no battle before it, so a wave whose template is
    // the full one either way), before the legend wave, so no Giratina of his own
    const party = game.scene.getEnemyParty();
    expect(party).toHaveLength(6);
    // The battle roll (boss chance), then the form (one option)
    expect(dice.mock.calls).toEqual([[100], [1]]);
    const giratina = party[5];
    expect([giratina.species.speciesId, giratina.getFormKey(), giratina.bossSegments]).toEqual([
      SpeciesId.GIRATINA,
      SpeciesFormKey.ORIGIN,
      2,
    ]);
    expect(party.some(p => p.species.getRootSpeciesId() === SpeciesId.GIBLE)).toBe(false);
    expect(formItemsOf(giratina).map(m => [m.formChangeItem, m.active, m.isTransferable])).toEqual([
      [FormChangeItem.GRISEOUS_CORE, true, false],
    ]);
  });

  it("Terastallizes Carmine's Sinistcha into Grass and Briar's ace (Terapagos: Stellar), as their originals", async () => {
    await startQuietRun(30);
    for (const [type, species, teraType] of [
      [TrainerType.CARMINE, SpeciesId.SINISTCHA, PokemonType.GRASS],
      [TrainerType.BRIAR, SpeciesId.TERAPAGOS, PokemonType.STELLAR],
    ] as const) {
      const { party, trainer, cleanUp } = buildParty(type, 110, TrainerType[type]);
      const ace = party[5];
      trainer.genAI(party);
      expect([ace.species.speciesId, ace.getTeraType()]).toEqual([species, teraType]);
      expect(trainer.config.trainerAI.instantTeras).toEqual([5]);
      cleanUp();
    }
  });

  // Review fix: the ace's Tera was pushed into the config's shared TrainerAI on every battle (setRandomTeraModifiers), so
  // meeting the same trainer again with another party size Terastallized one more non-ace member each time
  it("Terastallizes only Carmine's and Briar's ace in each battle, from the first wave, however often they are met", async () => {
    await startQuietRun(30);
    for (const type of [TrainerType.CARMINE, TrainerType.BRIAR]) {
      // Set once on the config, nothing pushed by genAI
      expect(trainerConfigs[type].genAIFuncs).toEqual([]);
      for (const wave of [20, 80, 110, 50, 20, 140]) {
        const { party, trainer, cleanUp } = buildParty(type, wave, `${TrainerType[type]}-${wave}`);
        const label = `${TrainerType[type]} wave ${wave}`;
        // Known while the party is made (the ace's moveset and battle-form roll see it), the same after genAI
        expect(party.map(p => willTerastallize(p)), label).toEqual(party.map((_, i) => i === party.length - 1));
        for (let again = 0; again < 2; again++) {
          trainer.genAI(party);
          expect(trainer.config.trainerAI.instantTeras, label).toEqual([party.length - 1]);
        }
        expect(trainer.shouldTera(party.at(-1)!), label).toBe(true);
        expect(
          party.slice(0, -1).some(p => trainer.shouldTera(p)),
          label,
        ).toBe(false);
        cleanUp();
      }
    }
    // Only in its own battle: a gym leader's battle sees none of Carmine's
    const { cleanUp } = buildParty(TrainerType.BROCK, 20, "brock");
    expect(trainerConfigs[TrainerType.CARMINE].trainerAI.instantTeras).toEqual([]);
    cleanUp();
  });

  // Review fix: on a low wave every Eeveelution slot but the kept ace became an Eevee (two on Classic wave 30 with the
  // gyms offset, three in Mysterious Challengers' six-member party from wave 10)
  it("never fields two Eevees for Irida or Adaman: an Eeveelution after an Eevee keeps its stage", async () => {
    await startQuietRun(30);
    /** No species twice, and one Eevee at most (none once every Eeveelution is above its level) */
    const expectOneEevee = (party: readonly EnemyPokemon[], label: string, eevees: number) => {
      expect(new Set(party.map(p => p.species.speciesId)).size, label).toBe(party.length);
      expect(party.filter(p => p.species.speciesId === SpeciesId.EEVEE), label).toHaveLength(eevees);
    };
    for (const [type, eeveelutions] of [
      [TrainerType.IRIDA, [SpeciesId.FLAREON, SpeciesId.ESPEON, SpeciesId.GLACEON]],
      [TrainerType.ADAMAN, [SpeciesId.VAPOREON, SpeciesId.UMBREON, SpeciesId.LEAFEON]],
    ] as const) {
      // Classic wave 30 (gyms offset): Lv20 / 22 / 22, below the Eeveelutions' level, so the first one is an Eevee and
      // the next keeps its stage
      for (const seed of ["a", "b", "c"]) {
        const { party, cleanUp } = buildParty(type, 30, `${TrainerType[type]}-30-${seed}`);
        const label = `${TrainerType[type]} wave 30 seed ${seed}`;
        expect(party.map(p => p.species.speciesId), label).toEqual([SpeciesId.EEVEE, eeveelutions[1], eeveelutions[2]]);
        expectOneEevee(party, label, 1);
        cleanUp();
      }
      // Mysterious Challengers' brutal option: the boss config's clone with the Elite Four template, levels raised (by
      // wave 30 with the encounter's additive every Eeveelution is above its level, so no Eevee is left)
      for (const [wave, eevees] of [
        [10, 1],
        [20, 1],
        [30, 0],
      ] as const) {
        const brutal = trainerConfigs[type].clone();
        brutal.setPartyTemplates(trainerPartyTemplates.ELITE_FOUR);
        // @ts-expect-error: as mysterious-challengers-encounter.ts does, to drop the gym template
        brutal.partyTemplateFunc = null;
        // The encounter's level additive (levelAdditiveModifier 1.5)
        const additive = Math.round((wave / 10) * 1.5);
        const { party, cleanUp } = buildParty(type, wave, `${TrainerType[type]}-me-${wave}`, brutal, additive);
        const label = `${TrainerType[type]} brutal wave ${wave}`;
        expect(party, label).toHaveLength(6);
        expectOneEevee(party, label, eevees);
        expect(party.at(-1)!.species.speciesId, label).toBe(eeveelutions[2]);
        cleanUp();
      }
    }
  });

  // Review fix: Mysterious Challengers draws the encounter line on the encounter's own seed offset and the victory line
  // was drawn on the wave's, so Volo could open as the merchant and close as the Pokémon Wielder
  it("draws a named trainer's victory line on its encounter line's seed offset, in a Mystery Encounter too", async () => {
    await startQuietRun(30);
    const meOffset = 115 * 1000 + 512;
    const asEncounter = () => {
      const battle = game.scene.currentBattle;
      battle.battleType = BattleType.MYSTERY_ENCOUNTER;
      battle.mysteryEncounter = { getSeedOffset: () => meOffset } as unknown as NonNullable<
        typeof battle.mysteryEncounter
      >;
    };
    const volo = buildParty(TrainerType.VOLO, 115, "volo");
    expect(getTrainerVictorySeedOffset()).toBe(115);
    asEncounter();
    expect(getTrainerVictorySeedOffset()).toBe(meOffset);
    volo.cleanUp();
    // Every other trainer keeps the wave's, as before
    const brock = buildParty(TrainerType.BROCK, 115, "brock");
    asEncounter();
    expect(getTrainerVictorySeedOffset()).toBe(115);
    brock.cleanUp();
  });
});
