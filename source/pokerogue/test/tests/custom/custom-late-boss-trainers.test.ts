// Local fork (2026-11-12): late boss trainers (named-trainers.ts, FORK_LATE_BOSS_TRAINER_BIOMES). Endless has no fixed
// battles, so past battle wave 200 in Endless / Spliced Endless one version of each champion and evil-team boss with a
// fixed trainer fusion (enemy-battle-forms.ts, LATE_SIGNATURE_BATTLE_FORMS) is a boss trainer of one biome pool. The
// user: "합체를 좀 고정해보죠 / 난천(메한카 + 메한카z) 라던가. / 비주기(메가뮤츠x+메가뮤츠y)라던가." and "개조를 하는 주된
// 이유가 엔드리스에 있어서요".
import { Battle } from "#app/battle";
import { getGameMode } from "#app/game-mode";
import { timedEventManager } from "#app/global-event-manager";
import { getEndlessLevelBonus } from "#balance/endless-level-scaling";
import { allBiomes } from "#data/data-lists";
import { LATE_SIGNATURE_BATTLE_FORMS, rollTrainerBattleForm } from "#data/enemy-battle-forms";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { BiomePoolTier } from "#enums/biome-pool-tier";
import { FormChangeItem } from "#enums/form-change-item";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { UiMode } from "#enums/ui-mode";
import { VoucherType } from "#enums/voucher-type";
import { Trainer } from "#field/trainer";
import { PokemonFormChangeItemModifier } from "#modifiers/modifier";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { vouchers } from "#system/voucher";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import { getAppRootDir } from "#test/utils/sprite-utils";
import {
  canDrawTrainerOnWave,
  FORK_LATE_BOSS_TRAINER_AFTER_WAVE,
  FORK_LATE_BOSS_TRAINER_BIOMES,
  FORK_LATE_BOSS_TRAINER_REPEAT_VOUCHER_CAP,
  FORK_NAMED_TRAINER_TYPES,
  filterTrainerPoolForWave,
  getTrainerRepeatVoucherType,
  isForkLateBossTrainer,
} from "#trainers/named-trainers";
import { type TrainerConfig, trainerConfigs } from "#trainers/trainer-config";
import { trainerPartyTemplates } from "#trainers/trainer-party-template";
import type { TrainerPools } from "#types/biomes";
import { randSeedInt } from "#utils/common";
import { enumValueToKey, getEnumValues } from "#utils/enums";
import fs from "node:fs";
import path from "node:path";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

/** One late boss trainer, as the design lists it */
interface LateBoss {
  readonly type: TrainerType;
  readonly name: string;
  readonly biome: BiomeId;
  /** Its biome's BOSS trainer tier before it (what the tier still draws on wave 200 and before, and in other modes) */
  readonly before: readonly TrainerType[];
}

const lateBoss = (type: TrainerType, biome: BiomeId, before: TrainerType[]): LateBoss => ({
  type,
  name: TrainerType[type],
  biome,
  before,
});

const LATE_BOSSES: readonly LateBoss[] = [
  lateBoss(TrainerType.CYNTHIA, BiomeId.WASTELAND, [TrainerType.CLAIR, TrainerType.DRAYDEN, TrainerType.RAIHAN]),
  lateBoss(TrainerType.MAXIE_2, BiomeId.VOLCANO, [TrainerType.BLAINE, TrainerType.FLANNERY, TrainerType.KABU]),
  lateBoss(TrainerType.ARCHIE_2, BiomeId.SEABED, [TrainerType.JUAN]),
  lateBoss(TrainerType.LEON, BiomeId.METROPOLIS, [
    TrainerType.WHITNEY,
    TrainerType.NORMAN,
    TrainerType.IONO,
    TrainerType.LARRY,
    TrainerType.HOP,
  ]),
  lateBoss(TrainerType.STEVEN, BiomeId.CAVE, [
    TrainerType.BROCK,
    TrainerType.ROXANNE,
    TrainerType.ROARK,
    TrainerType.BRIAR,
  ]),
  lateBoss(TrainerType.DIANTHA, BiomeId.FAIRY_CAVE, [TrainerType.VALERIE, TrainerType.OPAL, TrainerType.BEDE]),
  lateBoss(TrainerType.LYSANDRE_2, BiomeId.CONSTRUCTION_SITE, [
    TrainerType.LT_SURGE,
    TrainerType.CHUCK,
    TrainerType.WATTSON,
  ]),
  lateBoss(TrainerType.LANCE_CHAMPION, BiomeId.LAKE, [TrainerType.CRASHER_WAKE, TrainerType.ADAMAN]),
  lateBoss(TrainerType.BLUE, BiomeId.GRASS, [TrainerType.ERIKA]),
  lateBoss(TrainerType.ROSE_2, BiomeId.FACTORY, [TrainerType.JASMINE, TrainerType.BYRON, TrainerType.PEONY]),
  lateBoss(TrainerType.CYRUS_2, BiomeId.SPACE, [TrainerType.OLYMPIA]),
];

const MODES = [
  GameModes.CLASSIC,
  GameModes.ENDLESS,
  GameModes.SPLICED_ENDLESS,
  GameModes.DAILY,
  GameModes.CHALLENGE,
] as const;
/** `BiomeId` is a plain object, with no reverse mapping */
const biomeName = (biome: BiomeId): string => enumValueToKey(BiomeId, biome);
const isEndlessMode = (mode: GameModes) => mode === GameModes.ENDLESS || mode === GameModes.SPLICED_ENDLESS;

/** A battle wave past 200 that is no gym wave (a plain draw), and the first gym wave of its block (a boss draw) */
const LATE_WAVE = 251;
const BOSS_WAVE = 260;

const ROOT = getAppRootDir();
const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
const lookup = (json: Record<string, unknown>, key: string): unknown =>
  key
    .replace(/^dialogue:/, "")
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], json);

/** Prints what a test saw (the console is muted while parties are built) */
function observe(label: string, data: object): void {
  process.stdout.write(`[late-boss] ${label} ${JSON.stringify(data)}\n`);
}

describe("Custom - late boss trainers in Endless biome pools past wave 200", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logSpy: MockInstance | undefined;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH])
      .mysteryEncounterChance(0);
  });

  afterEach(() => {
    logSpy?.mockRestore();
    logSpy = undefined;
    vi.restoreAllMocks();
  });

  /** Starts a run in `mode` on `wave` the way the title screen would (after `setUp`) and plays to the first command */
  async function startRun(mode: GameModes, wave: number, setUp?: () => void): Promise<void> {
    game.override.startingWave(wave);
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(mode);
      game.scene.offsetGym = false;
      const starters = generateStarters(game.scene, [SpeciesId.FEEBAS]);
      // After generateStarters, which sets the run seed to "test": a seed `setUp` picks must be the one the run uses
      // (review, 2026-11-12: before this, the Cynthia draw passed only because "test" happens to draw her)
      setUp?.();
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    await game.phaseInterceptor.to("CommandPhase", false);
  }

  /** A wild run to stand on while draws and trainer battles are made by hand, generation logs muted */
  async function startQuietRun(mode: GameModes, wave: number): Promise<void> {
    game.override.disableTrainerWaves();
    await startRun(mode, wave);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  }

  /** The arena's trainer draw on `wave` with `seed`, and the next seeded number after it (the RNG state it leaves) */
  function draw(seed: string, wave: number, isBoss: boolean): [TrainerType, number] {
    game.scene.setSeed(seed);
    game.scene.resetSeed(wave);
    const type = game.scene.arena.randomTrainerType(wave, isBoss);
    return [type, randSeedInt(1 << 30)];
  }

  /** Builds `type`'s battle on `wave` as `BattleScene.newBattle` does, with `config` in place of its own if given */
  function buildTrainerBattle(
    type: TrainerType,
    wave: number,
    seed: string,
    variant: TrainerVariant,
    config?: TrainerConfig,
  ) {
    const { scene } = game;
    scene.setSeed(seed);
    scene.resetSeed(wave);
    const trainer = new Trainer(type, variant, undefined, undefined, undefined, config);
    const battle = new Battle(scene.gameMode, {
      waveIndex: wave,
      battleType: BattleType.TRAINER,
      trainer,
      double: false,
    });
    scene.currentBattle = battle;
    for (let e = 0; e < (battle.enemyLevels?.length ?? 0); e++) {
      battle.enemyParty[e] = trainer.genPartyMember(e);
    }
    return { trainer, battle, party: battle.enemyParty };
  }

  function cleanUp({ trainer, battle }: { trainer: Trainer; battle: Battle }): void {
    for (const p of battle.enemyParty) {
      p.destroy();
    }
    trainer.destroy();
  }

  it("lists one version of each champion and evil-team boss last in one biome's BOSS tier, and nowhere else", () => {
    expect(Object.isFrozen(FORK_LATE_BOSS_TRAINER_BIOMES)).toBe(true);
    expect(FORK_LATE_BOSS_TRAINER_AFTER_WAVE).toBe(200);
    expect(
      Object.fromEntries(
        Object.entries(FORK_LATE_BOSS_TRAINER_BIOMES).map(([type, biome]) => [
          TrainerType[Number(type)],
          biomeName(biome),
        ]),
      ),
    ).toEqual(Object.fromEntries(LATE_BOSSES.map(l => [l.name, biomeName(l.biome)])));
    // One per biome
    expect(new Set(LATE_BOSSES.map(l => l.biome)).size).toBe(LATE_BOSSES.length);
    for (const { type, name, biome, before } of LATE_BOSSES) {
      expect(isForkLateBossTrainer(type), name).toBe(true);
      expect(FORK_NAMED_TRAINER_TYPES, name).not.toContain(type);
      // Its fixed fusion applies from the next wave on
      const late = LATE_SIGNATURE_BATTLE_FORMS[type];
      expect([late?.afterWave, late?.fusion != null], name).toEqual([FORK_LATE_BOSS_TRAINER_AFTER_WAVE, true]);
      // Last in its biome's BOSS tier, after the trainers the tier had; that tier had some, so whether a wave draws from
      // the boss tiers (`Arena.randomTrainerType` reads the BOSS tier's length) is as before
      const pools = allBiomes.get(biome).trainerPool;
      expect(before.length, name).toBeGreaterThan(0);
      expect(pools[BiomePoolTier.BOSS], name).toEqual([...before, type]);
      // The rarer boss tiers are empty, so every boss draw of the biome ends in the BOSS tier
      for (const tier of [BiomePoolTier.BOSS_RARE, BiomePoolTier.BOSS_SUPER_RARE, BiomePoolTier.BOSS_ULTRA_RARE]) {
        expect(pools[tier], `${name} ${BiomePoolTier[tier]}`).toEqual([]);
      }
      for (const other of allBiomes.values()) {
        for (const tier of getEnumValues(BiomePoolTier)) {
          if (other.biomeId !== biome || tier !== BiomePoolTier.BOSS) {
            expect(
              other.trainerPool[tier].includes(type),
              `${name} in ${biomeName(other.biomeId)} ${BiomePoolTier[tier]}`,
            ).toBe(false);
          }
        }
      }
      // Its sprite, and a line for each moment in both languages
      const config = trainerConfigs[type];
      for (const ext of [".png", ".json"]) {
        expect(fs.existsSync(path.join(ROOT, "assets/images/trainer", config.getSpriteKey(false) + ext)), name).toBe(
          true,
        );
      }
      const dialogues = [readJson("locales/en/dialogue.json"), readJson("locales/ko/dialogue.json")];
      for (const lines of [config.encounterMessages, config.victoryMessages, config.defeatMessages]) {
        expect(lines?.length, name).toBeGreaterThan(0);
        for (const key of lines) {
          for (const dialogue of dialogues) {
            const line = lookup(dialogue, key);
            expect(typeof line === "string" && line.length > 0, `${name} ${key}`).toBe(true);
          }
        }
      }
    }
  });

  it("lets a biome pool give them only past battle wave 200 in Endless and Spliced Endless", async () => {
    await startQuietRun(GameModes.ENDLESS, LATE_WAVE);
    for (const mode of MODES) {
      game.scene.gameMode = getGameMode(mode);
      for (const wave of [1, 20, 110, 190, 199, 200, 201, 251, 260, 1000, 2000]) {
        const allowed = isEndlessMode(mode) && wave > 200;
        for (const { type, name, biome, before } of LATE_BOSSES) {
          const label = `${name} ${GameModes[mode]} wave ${wave}`;
          expect(canDrawTrainerOnWave(type, wave), label).toBe(allowed);
          expect(filterTrainerPoolForWave(allBiomes.get(biome).trainerPool[BiomePoolTier.BOSS], wave), label).toEqual(
            allowed ? [...before, type] : before,
          );
        }
      }
      // The named trainers' own first wave is unchanged (Volo from difficulty wave 110)
      const voloFrom = Array.from({ length: 200 }, (_, w) => w + 1).find(w =>
        canDrawTrainerOnWave(TrainerType.VOLO, w),
      );
      expect(game.scene.gameMode.getWaveForDifficulty(voloFrom!), GameModes[mode]).toBeGreaterThanOrEqual(110);
      expect(game.scene.gameMode.getWaveForDifficulty(voloFrom! - 1), GameModes[mode]).toBeLessThan(110);
    }
  });

  it("draws the same trainer on the same seed as before on wave 200 and before, and in every other mode", async () => {
    await startQuietRun(GameModes.ENDLESS, LATE_WAVE);
    const seeds = Array.from({ length: 12 }, (_, s) => `late-boss-${s}`);
    const mismatches: string[] = [];
    let compared = 0;
    for (const { name, biome, before } of LATE_BOSSES) {
      const arena = game.scene.newArena(biome);
      const now = allBiomes.get(biome).trainerPool;
      const old: TrainerPools = { ...now, [BiomePoolTier.BOSS]: before };
      const setPools = (pools: TrainerPools) => {
        (arena as unknown as { trainerPool: TrainerPools }).trainerPool = pools;
      };
      for (const mode of MODES) {
        game.scene.gameMode = getGameMode(mode);
        // Other modes never reach these waves, but the rule must hold there too
        const waves = isEndlessMode(mode)
          ? [20, 25, 50, 110, 140, 170, 199, 200]
          : [20, 25, 50, 110, 170, 200, 260, 1010];
        for (const wave of waves) {
          for (const isBoss of [false, true]) {
            for (const seed of seeds) {
              setPools(now);
              const drawn = draw(seed, wave, isBoss);
              setPools(old);
              const drawnBefore = draw(seed, wave, isBoss);
              compared++;
              if (drawn[0] !== drawnBefore[0] || drawn[1] !== drawnBefore[1]) {
                mismatches.push(`${name} ${GameModes[mode]} wave ${wave} boss ${isBoss} ${seed}`);
              }
            }
          }
        }
      }
      // Past wave 200 in Endless the same comparison does tell them apart: the new trainer is drawn there
      game.scene.gameMode = getGameMode(GameModes.ENDLESS);
      let changed = 0;
      for (let s = 0; s < 60; s++) {
        setPools(now);
        const drawn = draw(`late-boss-past-${s}`, BOSS_WAVE, false);
        setPools(old);
        changed += drawn[0] === draw(`late-boss-past-${s}`, BOSS_WAVE, false)[0] ? 0 : 1;
      }
      setPools(now);
      expect(changed, name).toBeGreaterThan(0);
    }
    expect(mismatches).toEqual([]);
    expect(compared).toBe(LATE_BOSSES.length * (2 * 8 + 3 * 8) * 2 * seeds.length);
  }, 120_000);

  it("gives each 1 / (its BOSS tier's size) of its biome's boss trainer draws past wave 200, none of the others", async () => {
    await startQuietRun(GameModes.ENDLESS, LATE_WAVE);
    const runs = 600;
    const shares: Record<string, string> = {};
    for (const { type, name, biome, before } of LATE_BOSSES) {
      game.scene.newArena(biome);
      const expected = 1 / (before.length + 1);
      for (const mode of [GameModes.ENDLESS, GameModes.SPLICED_ENDLESS]) {
        game.scene.gameMode = getGameMode(mode);
        let hits = 0;
        for (let s = 0; s < runs; s++) {
          // Wave 260 is a gym wave: a boss draw, as the real battle makes it
          const [drawn] = draw(`share-${s}`, BOSS_WAVE, false);
          expect([...before, type], name).toContain(drawn);
          hits += drawn === type ? 1 : 0;
        }
        expect(Math.abs(hits / runs - expected), `${name} ${GameModes[mode]} ${hits}/${runs}`).toBeLessThan(0.06);
        if (mode === GameModes.ENDLESS) {
          shares[name] = `${biomeName(biome)} ${hits}/${runs}, 1/${before.length + 1}`;
        }
      }
      // A plain (no gym wave) draw past wave 200 never gives it: it is in the BOSS tier only
      game.scene.gameMode = getGameMode(GameModes.ENDLESS);
      for (let s = 0; s < 100; s++) {
        expect(draw(`plain-${s}`, LATE_WAVE, false)[0], name).not.toBe(type);
      }
    }
    observe("boss draw shares on Endless wave 260", shares);
  }, 120_000);

  it("never makes them a double battle or gives them a partner when a biome pool draws them", async () => {
    await startQuietRun(GameModes.ENDLESS, LATE_WAVE);
    const variants: Record<string, string[]> = {};
    for (const { type, name, biome } of LATE_BOSSES) {
      game.scene.newArena(biome);
      const seen = new Set<string>();
      for (let s = 0; s < 80; s++) {
        game.scene.setSeed(`partner-${s}`);
        game.scene.resetSeed(BOSS_WAVE);
        // The trainer `BattleScene.newBattle` makes for a trainer wave (pool draw, double roll, variant)
        const trainer: Trainer = game.scene["generateNewBattleTrainer"](BOSS_WAVE);
        if (trainer.config.trainerType === type) {
          expect([trainer.variant === TrainerVariant.DOUBLE, trainer.isDouble(), trainer.partnerName], name).toEqual([
            false,
            false,
            undefined,
          ]);
          seen.add(TrainerVariant[trainer.variant]);
        }
        trainer.destroy();
      }
      expect(seen.size, name).toBeGreaterThan(0);
      variants[name] = [...seen].sort();
    }
    // Blue's and Steven's named doubles (with Red, with Wallace) are their Classic battles'; a pool draw keeps them single
    expect(trainerConfigs[TrainerType.BLUE].trainerTypeDouble).toBe(TrainerType.RED);
    expect(trainerConfigs[TrainerType.STEVEN].trainerTypeDouble).toBe(TrainerType.WALLACE);
    observe("variants drawn", variants);
  }, 120_000);

  it.each(LATE_BOSSES)(
    "builds a sane party for $name from wave 201 to 2000, its fixed fusion in it",
    async ({ type, name }) => {
      await startQuietRun(GameModes.ENDLESS, LATE_WAVE);
      const config = trainerConfigs[type];
      const late = LATE_SIGNATURE_BATTLE_FORMS[type]!;
      const seen: Record<string, string> = {};
      for (const wave of [201, 260, 620, 1010, 1970]) {
        for (const variant of [TrainerVariant.DEFAULT, TrainerVariant.FEMALE]) {
          const label = `${name} wave ${wave} ${TrainerVariant[variant]}`;
          const built = buildTrainerBattle(type, wave, `${name}-${wave}-${variant}`, variant);
          const { trainer, battle, party } = built;
          // Six of its own (no Endless fill needed), every one at its slot's level for the wave
          expect(party, label).toHaveLength(6);
          const base = 1 + wave / 2 + (wave / 25) ** 2;
          // Local fork (2026-11-13): 08 명세 4번, past wave 500 every member also gets the Candy Jar term S(w) on top
          const endlessBonus = getEndlessLevelBonus(game.scene.gameMode, wave);
          for (const [i, p] of party.entries()) {
            expect(p.level, label).toBe(battle.enemyLevels?.[i]);
            expect(p.level, label).toBeGreaterThanOrEqual(Math.floor(base) + endlessBonus);
            expect(p.level, label).toBeLessThanOrEqual(Math.ceil(base * 1.25) + endlessBonus);
            expect(p.trainerSlot, label).toBe(TrainerSlot.TRAINER);
            expect(p.getMoveset().length, label).toBeGreaterThan(0);
            expect(p.hp, label).toBe(p.getMaxHp());
          }
          expect([trainer.isDouble(), trainer.partnerName], label).toEqual([false, undefined]);
          // Its own fixed fusion, the head in its form holding nothing new yet (the item comes with the enemy items)
          const head = rollTrainerBattleForm(party);
          expect(
            [
              head?.species.speciesId,
              head?.getFormKey(),
              head?.fusionSpecies?.speciesId,
              head?.getFusionFormKey(),
              head?.trainerSlot,
            ],
            label,
          ).toEqual([
            late.signature.species,
            late.signature.forms[0].formKey,
            late.fusion!.species,
            late.fusion!.formKey,
            TrainerSlot.TRAINER,
          ]);
          expect(party, label).toHaveLength(6);
          expect(party, label).toContain(head);
          // A name, a title, lines, and its money (a random battle's: the config's multiplier on the wave's amount)
          expect(trainer.getName(TrainerSlot.TRAINER).length, label).toBeGreaterThan(0);
          expect(config.title.length, label).toBeGreaterThan(0);
          for (const lines of [
            trainer.getEncounterMessages(),
            trainer.getVictoryMessages(),
            trainer.getDefeatMessages(),
          ]) {
            expect(lines?.length, label).toBeGreaterThan(0);
          }
          const money = game.scene.getWaveMoneyAmount(config.moneyMultiplier);
          expect(Number.isFinite(money) && money > 0, label).toBe(true);
          if (variant === TrainerVariant.DEFAULT) {
            seen[wave] = `${head?.name} Lv.${head?.level}, party Lv.${Math.min(...party.map(p => p.level))}-${Math.max(
              ...party.map(p => p.level),
            )}, money x${config.moneyMultiplier} = ${money}`;
          }
          cleanUp(built);
        }
      }

      // The Mysterious Challengers' brutal option draws from the same BOSS tier: its clone with the Elite Four template
      // (mysterious-challengers-encounter.ts) builds too. A Mystery Encounter battle rolls no battle form, so no fusion.
      const brutal = config.clone();
      brutal.title = config.title;
      brutal.setPartyTemplates(trainerPartyTemplates.ELITE_FOUR);
      // @ts-expect-error: as the encounter does, to drop the gym leaders' template function
      brutal.partyTemplateFunc = null;
      const challenger = buildTrainerBattle(type, 255, `${name}-brutal`, TrainerVariant.DEFAULT, brutal);
      expect(challenger.party, `${name} brutal`).toHaveLength(6);
      cleanUp(challenger);
      observe(name, seen);
    },
    120_000,
  );

  it("meets Cynthia in a real Endless battle drawn from the Wasteland pool, with Mega Garchomp + Mega Garchomp Z", async () => {
    // The real double roll, no field size override
    game.override.battleStyle(null);
    let seed = "";
    await startRun(GameModes.ENDLESS, BOSS_WAVE, () => {
      game.scene.newArena(BiomeId.WASTELAND);
      // A run seed on which the gym wave's draw gives her (a run's own seed is random)
      for (let s = 0; s < 200 && !seed; s++) {
        game.scene.setSeed(`cynthia-${s}`);
        game.scene.resetSeed(BOSS_WAVE);
        if (game.scene.arena.randomTrainerType(BOSS_WAVE) === TrainerType.CYNTHIA) {
          seed = `cynthia-${s}`;
        }
      }
      game.scene.setSeed(seed);
    });
    expect(seed).not.toBe("");

    const { currentBattle } = game.scene;
    expect(game.scene.arena.biomeId).toBe(BiomeId.WASTELAND);
    expect([currentBattle.waveIndex, currentBattle.battleType, currentBattle.double]).toEqual([
      BOSS_WAVE,
      BattleType.TRAINER,
      false,
    ]);
    expect(currentBattle.trainer?.config.trainerType).toBe(TrainerType.CYNTHIA);
    expect(currentBattle.trainer?.isDouble()).toBe(false);
    const party = game.scene.getEnemyParty();
    expect(party).toHaveLength(6);
    const heads = party.filter(p => p.species.speciesId === SpeciesId.GARCHOMP);
    expect(heads).toHaveLength(1);
    const [head] = heads;
    expect([head.getFormKey(), head.fusionSpecies?.speciesId, head.getFusionFormKey(), head.fusionShiny]).toEqual([
      SpeciesFormKey.MEGA,
      SpeciesId.GARCHOMP,
      SpeciesFormKey.MEGA_Z,
      false,
    ]);
    expect(head.name).toBe("Mega Garchomp");
    expect(head.isBoss()).toBe(true);
    const items = game.scene.findModifiers(
      m => m instanceof PokemonFormChangeItemModifier && m.pokemonId === head.id,
      false,
    ) as PokemonFormChangeItemModifier[];
    expect(items.map(m => [m.formChangeItem, m.active])).toEqual([[FormChangeItem.GARCHOMPITE, true]]);
    observe("real battle", {
      seed,
      party: party.map(p => `${p.name} Lv.${p.level}${p.isFusion() ? " (fused)" : ""}`),
    });
  }, 120_000);

  // Local fork (2026-11-12), review fix: a repeat win over a boss trainer whose voucher is unlocked pays
  // `[VOUCHER, VOUCHER, VOUCHER_PLUS, VOUCHER_PREMIUM][its voucher type]` (TrainerVictoryPhase). A champion's is PREMIUM,
  // an Egg Voucher Plus on every win, which a biome pool draw met again on every pass would have paid out over and over;
  // in Endless a late boss trainer pays what the gym leaders of its tier pay (named-trainers.ts,
  // getTrainerRepeatVoucherType).
  it("pays a repeat win over them in Endless as the gym leaders of their tier, and as before everywhere else", async () => {
    await startQuietRun(GameModes.ENDLESS, LATE_WAVE);
    expect(FORK_LATE_BOSS_TRAINER_REPEAT_VOUCHER_CAP).toBe(VoucherType.PLUS);
    const own = (type: TrainerType) => vouchers[TrainerType[type]]?.voucherType;
    const paid = (type: TrainerType) => getTrainerRepeatVoucherType(type, own(type)!);
    const champions = [
      TrainerType.CYNTHIA,
      TrainerType.LEON,
      TrainerType.STEVEN,
      TrainerType.DIANTHA,
      TrainerType.LANCE_CHAMPION,
      TrainerType.BLUE,
    ];
    for (const mode of MODES) {
      game.scene.gameMode = getGameMode(mode);
      for (const { type, name, before } of LATE_BOSSES) {
        const label = `${name} ${GameModes[mode]}`;
        // The champions' own voucher is PREMIUM (money x10), the evil-team bosses' PLUS (x2.5)
        expect(own(type), label).toBe(champions.includes(type) ? VoucherType.PREMIUM : VoucherType.PLUS);
        expect(paid(type), label).toBe(isEndlessMode(mode) ? VoucherType.PLUS : own(type));
        // The trainers it shares its tier with keep their own, a gym leader's
        for (const other of before) {
          expect([own(other), paid(other)], `${label}: ${TrainerType[other]}`).toEqual([
            VoucherType.PLUS,
            VoucherType.PLUS,
          ]);
        }
      }
      // Every other boss trainer is unchanged in every mode, champions among them
      for (const type of [TrainerType.IRIS, TrainerType.LANCE, TrainerType.RAIHAN, TrainerType.VOLO]) {
        expect(paid(type), `${TrainerType[type]} ${GameModes[mode]}`).toBe(own(type));
      }
    }
    expect(own(TrainerType.IRIS)).toBe(VoucherType.PREMIUM);
  });

  it.each([
    {
      label: "a repeat win in Endless (pool-drawn) an Egg Voucher",
      mode: GameModes.ENDLESS,
      unlocked: true,
      gained: { REGULAR: 1, PLUS: 0, PREMIUM: 0, GOLDEN: 0 },
    },
    {
      label: "the first win in Endless (pool-drawn) the voucher unlock, once per account, as before",
      mode: GameModes.ENDLESS,
      unlocked: false,
      gained: { REGULAR: 0, PLUS: 0, PREMIUM: 1, GOLDEN: 0 },
    },
    {
      label: "a repeat win in Classic an Egg Voucher Plus, as before",
      mode: GameModes.CLASSIC,
      unlocked: true,
      gained: { REGULAR: 0, PLUS: 1, PREMIUM: 0, GOLDEN: 0 },
    },
  ])(
    "gives for beating Cynthia in a real battle $label",
    async ({ mode, unlocked, gained }) => {
      vi.spyOn(timedEventManager, "getUpgradeUnlockedVouchers").mockReturnValue(false);
      const endless = mode === GameModes.ENDLESS;
      // Endless: the Wasteland gym wave's own pool draw; Classic (no pool gives her): the trainer override
      const wave = endless ? BOSS_WAVE : 151;
      if (!endless) {
        game.override
          .battleType(BattleType.TRAINER)
          .randomTrainer({ trainerType: TrainerType.CYNTHIA, trainerVariant: TrainerVariant.DEFAULT });
      }
      let seed = "";
      await startRun(mode, wave, () => {
        if (endless) {
          game.scene.newArena(BiomeId.WASTELAND);
          for (let s = 0; s < 200 && !seed; s++) {
            game.scene.setSeed(`cynthia-${s}`);
            game.scene.resetSeed(wave);
            if (game.scene.arena.randomTrainerType(wave) === TrainerType.CYNTHIA) {
              seed = `cynthia-${s}`;
            }
          }
          game.scene.setSeed(seed);
        }
      });
      const { currentBattle, gameData } = game.scene;
      expect([currentBattle.waveIndex, currentBattle.battleType, currentBattle.trainer?.config.trainerType]).toEqual([
        wave,
        BattleType.TRAINER,
        TrainerType.CYNTHIA,
      ]);
      expect(currentBattle.double).toBe(false);
      if (unlocked) {
        gameData.voucherUnlocks.CYNTHIA = 1;
      } else {
        delete gameData.voucherUnlocks.CYNTHIA;
      }
      const counts = () =>
        Object.fromEntries(getEnumValues(VoucherType).map(t => [VoucherType[t], gameData.voucherCounts[t] ?? 0]));
      const before = counts();

      // Win in one turn: the bench is down, the lead faints before it acts
      for (const p of game.scene.getEnemyParty().slice(1)) {
        p.hp = 0;
      }
      game.move.select(MoveId.SPLASH);
      await game.doKillOpponents();
      await game.phaseInterceptor.to("EggLapsePhase", false);

      const after = counts();
      expect(Object.fromEntries(Object.keys(after).map(k => [k, after[k] - before[k]]))).toEqual(gained);
      expect(gameData.voucherUnlocks.CYNTHIA).toBeDefined();
    },
    120_000,
  );
});
