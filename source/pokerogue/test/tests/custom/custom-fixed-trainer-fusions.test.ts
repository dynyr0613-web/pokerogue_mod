// Local fork (2026-11-12): fixed trainer fusions past wave 200 (enemy-battle-forms.ts, LATE_SIGNATURE_BATTLE_FORMS). The
// user: "합체를 좀 고정해보죠 / 난천(메한카 + 메한카z) 라던가. / 비주기(메가뮤츠x+메가뮤츠y)라던가."
import { Battle } from "#app/battle";
import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { speciesEggMoves } from "#balance/egg-moves";
import { allBiomes, modifierTypes } from "#data/data-lists";
import {
  enemyBattleFormDice,
  getActiveLateSignature,
  getBattleFormItem,
  getSignatureBattleForm,
  getSignatureOnlyFormItem,
  isBattleFormKey,
  isSignatureOnlyForm,
  LATE_SIGNATURE_BATTLE_FORMS,
  rollTrainerBattleForm,
} from "#data/enemy-battle-forms";
import { SpeciesFormChangeItemTrigger } from "#data/form-change-triggers";
import { Gender } from "#data/gender";
import type { PokemonSpeciesForm } from "#data/pokemon-species";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BiomePoolTier } from "#enums/biome-pool-tier";
import { FormChangeItem } from "#enums/form-change-item";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { PERMANENT_STATS } from "#enums/stat";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { UiMode } from "#enums/ui-mode";
import type { EnemyPokemon } from "#field/pokemon";
import { Trainer } from "#field/trainer";
import {
  EnemyFusionChanceModifier,
  type EnemyPersistentModifier,
  PokemonFormChangeItemModifier,
} from "#modifiers/modifier";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import { getAppRootDir } from "#test/utils/sprite-utils";
import { trainerConfigs } from "#trainers/trainer-config";
import type { StarterSpeciesId } from "#types/starter-species-id";
import type { BooleanHolder } from "#utils/common";
import { getEnumValues } from "#utils/enums";
import { getFusedSpeciesName } from "#utils/pokemon-utils";
import fs from "node:fs";
import path from "node:path";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** One entry of the roster, as the user's request and the design list it */
interface RosterEntry {
  readonly label: string;
  readonly trainers: readonly TrainerType[];
  readonly head: SpeciesId;
  readonly headForm: SpeciesFormKey;
  readonly item: FormChangeItem;
  readonly tail: SpeciesId;
  readonly tailForm: SpeciesFormKey;
}

const ROSTER: readonly RosterEntry[] = [
  // From the user
  {
    label: "Cynthia",
    trainers: [TrainerType.CYNTHIA],
    head: SpeciesId.GARCHOMP,
    headForm: SpeciesFormKey.MEGA,
    item: FormChangeItem.GARCHOMPITE,
    tail: SpeciesId.GARCHOMP,
    tailForm: SpeciesFormKey.MEGA_Z,
  },
  {
    label: "Giovanni",
    trainers: [TrainerType.GIOVANNI, TrainerType.ROCKET_BOSS_GIOVANNI_1, TrainerType.ROCKET_BOSS_GIOVANNI_2],
    head: SpeciesId.MEWTWO,
    headForm: SpeciesFormKey.MEGA_X,
    item: FormChangeItem.MEWTWONITE_X,
    tail: SpeciesId.MEWTWO,
    tailForm: SpeciesFormKey.MEGA_Y,
  },
  // In the same spirit
  {
    label: "Maxie",
    trainers: [TrainerType.MAXIE, TrainerType.MAXIE_2],
    head: SpeciesId.GROUDON,
    headForm: SpeciesFormKey.PRIMAL,
    item: FormChangeItem.RED_ORB,
    tail: SpeciesId.CAMERUPT,
    tailForm: SpeciesFormKey.MEGA,
  },
  {
    label: "Archie",
    trainers: [TrainerType.ARCHIE, TrainerType.ARCHIE_2],
    head: SpeciesId.KYOGRE,
    headForm: SpeciesFormKey.PRIMAL,
    item: FormChangeItem.BLUE_ORB,
    tail: SpeciesId.SHARPEDO,
    tailForm: SpeciesFormKey.MEGA,
  },
  {
    label: "Leon",
    trainers: [TrainerType.LEON],
    head: SpeciesId.CHARIZARD,
    headForm: SpeciesFormKey.GIGANTAMAX,
    item: FormChangeItem.MAX_MUSHROOMS,
    tail: SpeciesId.CHARIZARD,
    tailForm: SpeciesFormKey.MEGA_X,
  },
  {
    label: "Steven",
    trainers: [TrainerType.STEVEN],
    head: SpeciesId.METAGROSS,
    headForm: SpeciesFormKey.MEGA,
    item: FormChangeItem.METAGROSSITE,
    tail: SpeciesId.AGGRON,
    tailForm: SpeciesFormKey.MEGA,
  },
  {
    label: "Diantha",
    trainers: [TrainerType.DIANTHA],
    head: SpeciesId.GARDEVOIR,
    headForm: SpeciesFormKey.MEGA,
    item: FormChangeItem.GARDEVOIRITE,
    tail: SpeciesId.GALLADE,
    tailForm: SpeciesFormKey.MEGA,
  },
  {
    label: "Lysandre",
    trainers: [TrainerType.LYSANDRE, TrainerType.LYSANDRE_2],
    head: SpeciesId.GYARADOS,
    headForm: SpeciesFormKey.MEGA,
    item: FormChangeItem.GYARADOSITE,
    tail: SpeciesId.PYROAR,
    tailForm: SpeciesFormKey.MEGA,
  },
  {
    label: "Lance",
    trainers: [TrainerType.LANCE, TrainerType.LANCE_CHAMPION],
    head: SpeciesId.DRAGONITE,
    headForm: SpeciesFormKey.MEGA,
    item: FormChangeItem.DRAGONINITE,
    tail: SpeciesId.AERODACTYL,
    tailForm: SpeciesFormKey.MEGA,
  },
  {
    label: "Blue",
    trainers: [TrainerType.BLUE],
    head: SpeciesId.PIDGEOT,
    headForm: SpeciesFormKey.MEGA,
    item: FormChangeItem.PIDGEOTITE,
    tail: SpeciesId.ALAKAZAM,
    tailForm: SpeciesFormKey.MEGA,
  },
  {
    label: "Raihan",
    trainers: [TrainerType.RAIHAN, TrainerType.RAIHAN_ELITE],
    head: SpeciesId.ARCHALUDON,
    headForm: SpeciesFormKey.MEGA,
    item: FormChangeItem.ARCHALUDONITE,
    tail: SpeciesId.DURALUDON,
    tailForm: SpeciesFormKey.GIGANTAMAX,
  },
  {
    label: "Rose",
    trainers: [TrainerType.ROSE, TrainerType.ROSE_2],
    head: SpeciesId.COPPERAJAH,
    headForm: SpeciesFormKey.GIGANTAMAX,
    item: FormChangeItem.MAX_MUSHROOMS,
    tail: SpeciesId.MELMETAL,
    tailForm: SpeciesFormKey.MEGA,
  },
  {
    label: "Volo",
    trainers: [TrainerType.VOLO],
    head: SpeciesId.GIRATINA,
    headForm: SpeciesFormKey.ORIGIN,
    item: FormChangeItem.GRISEOUS_CORE,
    tail: SpeciesId.LUCARIO,
    tailForm: SpeciesFormKey.MEGA,
  },
  {
    label: "Cyrus",
    trainers: [TrainerType.CYRUS, TrainerType.CYRUS_2],
    head: SpeciesId.DIALGA,
    headForm: SpeciesFormKey.ORIGIN,
    item: FormChangeItem.ADAMANT_CRYSTAL,
    tail: SpeciesId.PALKIA,
    tailForm: SpeciesFormKey.ORIGIN,
  },
];

/** Every trainer type of the roster, with its entry */
const ROSTER_TRAINERS = ROSTER.flatMap(entry => entry.trainers.map(type => ({ type, name: TrainerType[type], entry })));

/** A battle wave past 200 (not a multiple of 50 or 10, so no special wave), and the last wave before the rule */
const LATE_WAVE = 251;
const LAST_WAVE_BEFORE = 200;

const IMAGES = path.join(getAppRootDir(), "assets", "images");
const koFiles = import.meta.glob("../../../locales/ko/**/*.json", { eager: true, import: "default" });

/** The png/json pair `BattleScene.loadPokemonAtlas` fetches for a sprite key (as custom-mega-fusion.test.ts checks) */
function missingFiles(...keys: string[]): string[] {
  return keys
    .flatMap(key => {
      const atlasPath = key.replace(/^pkmn__/, "").replace(/__/g, "/");
      const dir = /_[1-3]$/.test(atlasPath) ? path.join(IMAGES, "pokemon", "variant") : path.join(IMAGES, "pokemon");
      return [".png", ".json"].map(ext => path.join(dir, atlasPath + ext));
    })
    .filter(f => !fs.existsSync(f))
    .map(f => path.relative(IMAGES, f).replace(/\\/g, "/"));
}

const formIndexOf = (species: SpeciesId, formKey: string) =>
  speciesDataRegistry.getSpecies(species).forms.findIndex(f => f.formKey === formKey);
const formOf = (species: SpeciesId, formKey: string): PokemonSpeciesForm =>
  speciesDataRegistry.getSpecies(species).forms[formIndexOf(species, formKey)];

/** The fusion's types by the codebase's rule: the head's first type, then the tail's second (else first) type */
function fusedTypes(head: PokemonSpeciesForm, tail: PokemonSpeciesForm): PokemonType[] {
  let second = head.type2;
  if (tail.type2 != null && tail.type2 !== head.type1) {
    second = tail.type2;
  } else if (tail.type1 !== head.type1) {
    second = tail.type1;
  }
  return second == null ? [head.type1] : [head.type1, second];
}

/** Every move the fused Pokémon could have learnt: level moves of both, TMs of both (base and fused form), egg moves */
function legalMoves(p: EnemyPokemon): Set<MoveId> {
  const legal = new Set<MoveId>(
    p
      .getLevelMoves({
        startingLevel: 1,
        includeEvolutionMoves: true,
        includePrevolutionMoves: true,
        includeRelearnerMoves: true,
      })
      .map(m => m[1]),
  );
  const addSpecies = (speciesId: SpeciesId, formKey: string) => {
    const species = speciesDataRegistry.getSpecies(speciesId);
    for (const key of new Set(["", formKey])) {
      for (const tm of species.getTms(key)) {
        legal.add(tm);
      }
    }
    for (const move of speciesEggMoves[species.getRootSpeciesId() as StarterSpeciesId] ?? []) {
      legal.add(move);
    }
  };
  addSpecies(p.species.speciesId, p.getFormKey());
  if (p.fusionSpecies) {
    addSpecies(p.fusionSpecies.speciesId, p.getFusionFormKey() ?? "");
  }
  return legal;
}

/** Prints what a test saw (the console is muted while parties are built) */
function observe(label: string, data: object): void {
  process.stdout.write(`[fixed-fusion] ${label} ${JSON.stringify(data)}\n`);
}

/** A party member, as plain data */
function summarize(p: EnemyPokemon) {
  return {
    species: SpeciesId[p.species.speciesId],
    formIndex: p.formIndex,
    fusion: p.fusionSpecies ? SpeciesId[p.fusionSpecies.speciesId] : null,
    fusionFormIndex: p.fusionFormIndex,
    fusionAbilityIndex: p.fusionAbilityIndex,
    fusionGender: p.fusionGender,
    fusionShiny: p.fusionShiny,
    id: p.id,
    level: p.level,
    abilityIndex: p.abilityIndex,
    moves: p.getMoveset().map(m => MoveId[m.moveId]),
    teraType: p.teraType,
    stats: [...p.stats],
    hp: p.hp,
    name: p.name,
    trainerSlot: p.trainerSlot,
  };
}

describe("Custom - fixed trainer fusions past wave 200", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    // No enemy ability or moveset override: the fused Pokémon's own ability and moves are checked
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

  /** Starts a run in `mode` on `wave` the way the title screen would, and plays to the first command */
  async function startRun(mode: GameModes, wave: number): Promise<void> {
    game.override.startingWave(wave);
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(mode);
      game.scene.offsetGym = false;
      const starters = generateStarters(game.scene, [SpeciesId.FEEBAS]);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    await game.phaseInterceptor.to("CommandPhase", false);
  }

  /** A wild run to stand on while trainer battles are built by hand, generation logs muted */
  async function startQuietRun(mode: GameModes, wave: number): Promise<void> {
    game.override.disableTrainerWaves();
    await startRun(mode, wave);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  }

  /** Builds `type`'s battle on `wave` as `BattleScene.newBattle` does and rolls its party as `EncounterPhase` does */
  function buildTrainerBattle(type: TrainerType, wave: number, seed: string) {
    const { scene } = game;
    scene.setSeed(seed);
    scene.resetSeed(wave);
    const trainer = new Trainer(type, TrainerVariant.DEFAULT);
    const config = trainerConfigs[type];
    const battle = new Battle(scene.gameMode, {
      waveIndex: wave,
      battleType: BattleType.TRAINER,
      trainer,
      double: config.doubleOnly,
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

  /**
   * Every check of a fixed fusion's head against its roster entry; `inBattle`: in a real battle, where the trainer's
   * items (Endless vitamins...) change its base stats
   */
  function expectFixedFusion(
    head: EnemyPokemon | null,
    entry: RosterEntry,
    label: string,
    inBattle = false,
  ): asserts head {
    expect(head, label).not.toBeNull();
    const h = head!;
    expect([SpeciesId[h.species.speciesId], h.getFormKey()], label).toEqual([SpeciesId[entry.head], entry.headForm]);
    expect(h.trainerSlot, label).toBe(TrainerSlot.TRAINER);
    // The item it holds for its form (BattleScene.generateEnemyModifiers gives it: newEnemyBattleFormItem)
    expect(getBattleFormItem(h) ?? getSignatureOnlyFormItem(h), label).toBe(entry.item);
    // The tail, in its form, never shiny
    expect(h.fusionSpecies?.speciesId, label).toBe(entry.tail);
    expect(h.fusionFormIndex, label).toBe(formIndexOf(entry.tail, entry.tailForm));
    expect(h.getFusionFormKey(), label).toBe(entry.tailForm);
    expect([h.fusionShiny, h.fusionVariant, h.fusionLuck], label).toEqual([false, 0, 0]);
    // Its gender from the head's (seeded) id and the tail's ratio, as `generateFusionSpecies` does
    const { malePercent } = speciesDataRegistry.getSpecies(entry.tail);
    let gender = Gender.GENDERLESS;
    if (malePercent != null) {
      gender = (h.id % 256) * 0.390625 < malePercent ? Gender.MALE : Gender.FEMALE;
    }
    expect(h.fusionGender, label).toBe(gender);
    // The fusion rules: the head's first type and the tail's second, the tail's ability
    const headForm = formOf(entry.head, entry.headForm);
    const tailForm = formOf(entry.tail, entry.tailForm);
    expect(h.getTypes(), label).toEqual(fusedTypes(headForm, tailForm));
    expect(h.getAbility().id, label).toBe(tailForm.getAbility(h.fusionAbilityIndex));
    if (isBattleFormKey(entry.tailForm) && entry.tailForm !== SpeciesFormKey.GIGANTAMAX) {
      // A Mega / Primal tail has one ability, whatever the slot. Local fork: except where 1.2.0 D12 put the passive
      // sheet's extra ability on a Mega (the user: "d12 실행"): slot 1 for Mega Camerupt, Gallade and Alakazam, the
      // hidden slot for Mega Mewtwo Y and Sharpedo (2026-11-20, the user: "숨겨진 칸으로"). Slot 0 is always the Mega's own.
      const extraSlot = [1, 2].find(i => tailForm.getAbility(i) !== tailForm.getAbility(0));
      const expectedSlot = h.fusionAbilityIndex === extraSlot ? extraSlot : 0;
      expect(h.getAbility().id, label).toBe(tailForm.getAbility(expectedSlot));
    }
    // Stats of the fused forms, at full HP
    if (!inBattle) {
      expect(h.calculateBaseStats(), label).toEqual(
        PERMANENT_STATS.map(s => Math.ceil((headForm.baseStats[s] + tailForm.baseStats[s]) / 2)),
      );
    }
    const stats = [...h.stats];
    h.calculateStats();
    expect(h.stats, label).toEqual(stats);
    expect(h.hp, label).toBe(h.getMaxHp());
    // Four different moves it could learn, and a Tera type of its own types
    const moves = h.getMoveset().map(m => m.moveId);
    const legal = legalMoves(h);
    expect(moves, label).toHaveLength(4);
    expect(new Set(moves).size, label).toBe(4);
    expect(
      moves.filter(m => !legal.has(m)).map(m => MoveId[m]),
      label,
    ).toEqual([]);
    expect(h.getTypes({ includeTeraType: false, bypassSummonData: true, ignoreThirdType: true }), label).toContain(
      h.teraType,
    );
    // Its name: the head's own for one species with itself, else the usual blend
    expect(h.name, label).toBe(
      entry.head === entry.tail
        ? h.species.getName(h.formIndex)
        : getFusedSpeciesName(h.species.getName(h.formIndex), h.fusionSpecies!.getName(h.fusionFormIndex)),
    );
  }

  /** The sprite files the head and its tail load, for both genders of each, front and back */
  function missingSprites(h: EnemyPokemon): string[] {
    const { gender, fusionGender } = h;
    const keys = new Set<string>();
    for (const g of [Gender.MALE, Gender.FEMALE]) {
      h.gender = g;
      h.fusionGender = g;
      keys.add(h.getBattleSpriteKey(false));
      keys.add(h.getBattleSpriteKey(true));
      keys.add(h.getFusionBattleSpriteKey(false));
      keys.add(h.getFusionBattleSpriteKey(true));
    }
    h.gender = gender;
    h.fusionGender = fusionGender;
    return missingFiles(...keys);
  }

  it("keeps the roster in one frozen table, each head a signature form with its item and each tail a form of the game", () => {
    expect(Object.isFrozen(LATE_SIGNATURE_BATTLE_FORMS)).toBe(true);
    const summary = Object.fromEntries(
      Object.entries(LATE_SIGNATURE_BATTLE_FORMS).map(([type, late]) => {
        expect(Object.isFrozen(late)).toBe(true);
        expect(Object.isFrozen(late.fusion)).toBe(true);
        expect(late.afterWave).toBe(200);
        // One head form, no choice
        expect(late.signature.forms).toHaveLength(1);
        const [{ formKey, item }] = late.signature.forms;
        // Reached from the species' own form through an active item trigger of that item
        const ownFormKey = speciesDataRegistry.getSpecies(late.signature.species).forms[0]?.formKey ?? "";
        const trigger = speciesDataRegistry
          .getFormChanges(late.signature.species)
          .find(fc => fc.formKey === formKey && fc.preFormKey === ownFormKey)
          ?.findTrigger(SpeciesFormChangeItemTrigger) as SpeciesFormChangeItemTrigger | undefined;
        expect([trigger?.item, trigger?.active], TrainerType[Number(type)]).toEqual([item, true]);
        const tail = late.fusion!;
        expect(formIndexOf(tail.species, tail.formKey), TrainerType[Number(type)]).toBeGreaterThan(0);
        return [
          TrainerType[Number(type)],
          [SpeciesId[late.signature.species], formKey, FormChangeItem[item], SpeciesId[tail.species], tail.formKey],
        ];
      }),
    );
    expect(summary).toEqual(
      Object.fromEntries(
        ROSTER_TRAINERS.map(({ name, entry }) => [
          name,
          [SpeciesId[entry.head], entry.headForm, FormChangeItem[entry.item], SpeciesId[entry.tail], entry.tailForm],
        ]),
      ),
    );
    // Korrina stays on Mega Lucario only, and the others the design leaves out have no late signature
    for (const type of [TrainerType.KORRINA, TrainerType.SABRINA, TrainerType.PEONY, TrainerType.RED]) {
      expect(LATE_SIGNATURE_BATTLE_FORMS[type], TrainerType[type]).toBeUndefined();
      expect(getActiveLateSignature(type, 1000), TrainerType[type]).toBeUndefined();
    }
    expect(getSignatureBattleForm(TrainerType.KORRINA, 1000)?.forms.map(f => f.formKey)).toEqual([SpeciesFormKey.MEGA]);
    // Origin Giratina and Origin Dialga are signature-only forms (no battle form: no roll or reward hands them out)
    expect(isSignatureOnlyForm(SpeciesFormKey.ORIGIN)).toBe(true);
    // Only past wave 200
    for (const { type, name } of ROSTER_TRAINERS) {
      expect(getActiveLateSignature(type, LAST_WAVE_BEFORE), name).toBeUndefined();
      expect(getActiveLateSignature(type, LAST_WAVE_BEFORE + 1), name).toBeDefined();
    }
    // Cyrus has no signature before then
    expect(getSignatureBattleForm(TrainerType.CYRUS, LAST_WAVE_BEFORE)).toBeUndefined();
    expect(getSignatureBattleForm(TrainerType.CYRUS_2, LAST_WAVE_BEFORE)).toBeUndefined();
  });

  it.each(ROSTER_TRAINERS)(
    "always fields $name's fixed fusion in Endless past wave 200, leaving the other members alone",
    async ({ type, name, entry }) => {
      await startQuietRun(GameModes.ENDLESS, LATE_WAVE);
      const dice = vi.spyOn(enemyBattleFormDice, "roll");
      const problems: string[] = [];
      for (const seed of ["fixed-a", "fixed-b"]) {
        const label = `${name} (${seed})`;
        const built = buildTrainerBattle(type, LATE_WAVE, seed);
        const before = built.party.map(summarize);
        const head = rollTrainerBattleForm(built.party);
        expectFixedFusion(head, entry, label);
        const index = built.party.indexOf(head);
        expect(index, label).toBeGreaterThanOrEqual(0);
        // Exactly one Pokémon of the head species in the head form; nothing else changed
        expect(
          built.party.filter(p => p.species.speciesId === entry.head && p.getFormKey() === entry.headForm),
          label,
        ).toEqual([head]);
        expect(
          built.party.map(summarize).filter((_, i) => i !== index),
          label,
        ).toEqual(before.filter((_, i) => i !== index));
        // A save keeps it as it is, with no new roll
        const json = JSON.stringify(new PokemonData(head), (_k, v) => (typeof v === "bigint" ? v.toString() : v));
        const loaded = new PokemonData(JSON.parse(json)).toPokemon(BattleType.TRAINER, index) as EnemyPokemon;
        expect(summarize(loaded), label).toEqual(summarize(head));
        expect(loaded.getTypes(), label).toEqual(head.getTypes());
        expect(loaded.getAbility().id, label).toBe(head.getAbility().id);
        expect(loaded.getFusionBattleSpriteKey(false), label).toBe(head.getFusionBattleSpriteKey(false));
        loaded.destroy();
        problems.push(...missingSprites(head).map(f => `${label}: missing ${f}`));
        observe(`${label} slot ${index}`, {
          name: head.name,
          types: head.getTypes().map(t => PokemonType[t]),
          ability: AbilityId[head.getAbility().id],
          moves: head.getMoveset().map(m => MoveId[m.moveId]),
        });
        cleanUp(built);
      }
      expect(problems).toEqual([]);
      // No roll: no battle roll, no choice of form
      expect(dice).not.toHaveBeenCalled();
    },
    120_000,
  );

  it.each([
    { mode: GameModes.ENDLESS, name: "Endless", wave: LAST_WAVE_BEFORE },
    { mode: GameModes.CLASSIC, name: "Classic", wave: 190 },
  ])(
    "leaves $name wave $wave as before: Cynthia's Mega Garchomp Z, Giovanni's Mega Mewtwo X or Y, no fusion",
    async ({ mode, name, wave }) => {
      await startQuietRun(mode, wave);
      const label = `${name} wave ${wave}`;
      // The battle roll hits; then the form choice is forced
      let choice = 0;
      const dice = vi
        .spyOn(enemyBattleFormDice, "roll")
        .mockImplementation(range => (range === 100 ? 0 : choice % range));

      const cynthia = buildTrainerBattle(TrainerType.CYNTHIA, wave, "before");
      const garchomp = rollTrainerBattleForm(cynthia.party);
      expect([garchomp?.species.speciesId, garchomp?.getFormKey()], label).toEqual([
        SpeciesId.GARCHOMP,
        SpeciesFormKey.MEGA_Z,
      ]);
      expect(garchomp?.isFusion(), label).toBe(false);
      // Her config's Mega Garchomp only switches to Mega Z: no battle roll, as before
      expect(dice, label).not.toHaveBeenCalledWith(100);
      cleanUp(cynthia);

      const forms: string[] = [];
      for (choice = 0; choice < 2; choice++) {
        dice.mockClear();
        const giovanni = buildTrainerBattle(TrainerType.ROCKET_BOSS_GIOVANNI_2, wave, "before");
        const mewtwo = rollTrainerBattleForm(giovanni.party);
        expect(mewtwo?.species.speciesId, label).toBe(SpeciesId.MEWTWO);
        expect(mewtwo?.isFusion(), label).toBe(false);
        // The battle roll, then the choice between Mega X and Mega Y
        expect(dice.mock.calls, label).toEqual([[100], [2]]);
        forms.push(mewtwo!.getFormKey());
        cleanUp(giovanni);
      }
      expect(forms, label).toEqual([SpeciesFormKey.MEGA_X, SpeciesFormKey.MEGA_Y]);

      // Cyrus, a signature trainer only past 200, has his ordinary boss roll and no Origin Dialga or Palkia tail
      const cyrus = buildTrainerBattle(TrainerType.CYRUS_2, wave, "before");
      const cyrusIds = cyrus.party.map(p => p.id);
      rollTrainerBattleForm(cyrus.party);
      expect(
        cyrus.party.some(p => p.fusionSpecies?.speciesId === SpeciesId.PALKIA),
        label,
      ).toBe(false);
      expect(
        cyrus.party.filter(p => p.getFormKey() === SpeciesFormKey.ORIGIN),
        label,
      ).toEqual([]);
      expect(
        cyrus.party.map(p => p.id),
        label,
      ).toEqual(cyrusIds);
      cleanUp(cyrus);
    },
    120_000,
  );

  it("overwrites the fusion of a spliced head (Spliced Endless)", async () => {
    // Every member comes fused, Cynthia's Garchomp included
    await startQuietRun(GameModes.SPLICED_ENDLESS, LATE_WAVE);
    const spliced = buildTrainerBattle(TrainerType.CYNTHIA, LATE_WAVE, "spliced");
    expect(spliced.party.every(p => p.isFusion())).toBe(true);
    expectFixedFusion(rollTrainerBattleForm(spliced.party), ROSTER[0], "Spliced Endless Cynthia");
    cleanUp(spliced);
  }, 120_000);

  it("overwrites the fusion the fusion token gave the head, an existing member or a new one", async () => {
    // The fusion token, forced to fuse every member
    await startQuietRun(GameModes.ENDLESS, LATE_WAVE);
    await game.scene.addEnemyModifier(
      modifierTypes.ENEMY_FUSED_CHANCE().newModifier() as EnemyPersistentModifier,
      true,
      true,
    );
    vi.spyOn(EnemyFusionChanceModifier.prototype, "apply").mockImplementation((isFusion: BooleanHolder) => {
      isFusion.value = true;
      return true;
    });
    const giovanniEntry = ROSTER[1];
    const token = buildTrainerBattle(TrainerType.ROCKET_BOSS_GIOVANNI_2, LATE_WAVE, "token");
    expect(token.party.every(p => p.isFusion())).toBe(true);
    const tokenHead = rollTrainerBattleForm(token.party);
    expectFixedFusion(tokenHead, giovanniEntry, "token-fused Giovanni");
    cleanUp(token);
    // A head put in by the fixed fusion (no Groudon in Maxie's first party) drops the fusion the token gave it too
    const maxie = buildTrainerBattle(TrainerType.MAXIE, LATE_WAVE, "token");
    expect(maxie.party.some(p => p.species.speciesId === SpeciesId.GROUDON)).toBe(false);
    expectFixedFusion(rollTrainerBattleForm(maxie.party), ROSTER[2], "token-fused Maxie");
    cleanUp(maxie);
  }, 120_000);

  it("fields Cynthia's fused Mega Garchomp in a real Endless battle, holding Garchompite, the same after a reload", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.CYNTHIA, trainerVariant: TrainerVariant.DEFAULT });
    await startRun(GameModes.ENDLESS, LATE_WAVE);

    const { currentBattle } = game.scene;
    expect(currentBattle.trainer?.config.trainerType).toBe(TrainerType.CYNTHIA);
    const party = game.scene.getEnemyParty();
    const head = party.find(p => p.isFusion() && p.fusionSpecies?.speciesId === SpeciesId.GARCHOMP)!;
    expectFixedFusion(head, ROSTER[0], "Cynthia in battle", true);
    expect(head.name).toBe("Mega Garchomp");
    expect(head.getNameToRender({ prependFormName: false })).toBe("Garchomp");
    const items = game.scene.findModifiers(
      m => m instanceof PokemonFormChangeItemModifier && m.pokemonId === head.id,
      false,
    ) as PokemonFormChangeItemModifier[];
    expect(items.map(m => [m.formChangeItem, m.active, m.isTransferable])).toEqual([
      [FormChangeItem.GARCHOMPITE, true, false],
    ]);
    expect(missingSprites(head)).toEqual([]);
    // Stats are left out: a reload works out every member's stats again with the trainer's items, fused or not
    const lasting = (p: EnemyPokemon) => {
      const { stats: _stats, hp: _hp, ...rest } = summarize(p);
      return { ...rest, types: p.getTypes(), ability: p.getAbility().id, formKey: p.getFormKey() };
    };
    const before = party.map(lasting);

    // Serialize the session the way the save does and parse it back the way the load does
    const { gameData } = game.scene;
    const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
    game.reload["sessionData"] = gameData.parseSessionData(json);
    await game.reload.reloadSession();

    expect(game.scene.currentBattle.waveIndex).toBe(LATE_WAVE);
    expect(game.scene.getEnemyParty().map(lasting)).toEqual(before);
    const reloaded = game.scene.getEnemyParty().find(p => p.id === head.id)!;
    expectFixedFusion(reloaded, ROSTER[0], "Cynthia after a reload", true);
  }, 120_000);

  it("can be met past wave 200 through a biome pool: one trainer type of every roster entry", () => {
    // Local fork (2026-11-12), review finding: Endless has no fixed battles and draws its trainers from the biome
    // trainer pools only (Arena.randomTrainerType); the champions, Elite Four and evil-team bosses come from Classic /
    // Challenge fixed battles, all on wave 200 or before. Giovanni (gym), Raihan (gym) and Volo were in biome pools;
    // one version of every other entry is now a boss trainer of one biome past wave 200 in Endless (named-trainers.ts,
    // FORK_LATE_BOSS_TRAINER_BIOMES; custom-late-boss-trainers.test.ts).
    for (const mode of [GameModes.ENDLESS, GameModes.SPLICED_ENDLESS]) {
      expect(Object.keys(getGameMode(mode).battleConfig), GameModes[mode]).toEqual([]);
    }
    expect(Math.max(...Object.keys(getGameMode(GameModes.CLASSIC).battleConfig).map(Number))).toBeLessThan(200);
    const inBiomePools = new Set<TrainerType>();
    for (const biome of allBiomes.values()) {
      for (const tier of getEnumValues(BiomePoolTier)) {
        for (const type of biome.trainerPool[tier]) {
          inBiomePools.add(type);
        }
      }
    }
    expect(
      Object.fromEntries(
        ROSTER.map(entry => [entry.label, entry.trainers.filter(t => inBiomePools.has(t)).map(t => TrainerType[t])]),
      ),
    ).toEqual({
      Cynthia: ["CYNTHIA"],
      Giovanni: ["GIOVANNI"],
      Maxie: ["MAXIE_2"],
      Archie: ["ARCHIE_2"],
      Leon: ["LEON"],
      Steven: ["STEVEN"],
      Diantha: ["DIANTHA"],
      Lysandre: ["LYSANDRE_2"],
      Lance: ["LANCE_CHAMPION"],
      Blue: ["BLUE"],
      Raihan: ["RAIHAN"],
      Rose: ["ROSE_2"],
      Volo: ["VOLO"],
      Cyrus: ["CYRUS_2"],
    });
  });

  it("draws a fused head at its own form's scale: G-Max heads big, Raihan's Mega Archaludon (G-Max tail) not", async () => {
    // Local fork (2026-11-12), review fix: the G-Max scale (1.5x, and the field zooms out for it) follows the head's
    // form, whose sprite is drawn; a G-Max tail gives its colours only. `isMax()` still counts the tail.
    await startQuietRun(GameModes.ENDLESS, LATE_WAVE);
    const seen: Record<string, [number, number, boolean]> = {};
    for (const type of [TrainerType.RAIHAN, TrainerType.RAIHAN_ELITE, TrainerType.LEON, TrainerType.ROSE_2]) {
      const built = buildTrainerBattle(type, LATE_WAVE, "scale");
      const head = rollTrainerBattleForm(built.party)!;
      seen[TrainerType[type]] = [head.getSpriteScale(), head.scaleX, head.isMax()];
      cleanUp(built);
    }
    expect(seen).toEqual({
      RAIHAN: [1, 1, true],
      RAIHAN_ELITE: [1, 1, true],
      LEON: [1.5, 1.5, true],
      ROSE_2: [1.5, 1.5, true],
    });
  });

  it("names a fusion of one species with itself as its head, in English and Korean", async () => {
    await startQuietRun(GameModes.ENDLESS, LATE_WAVE);
    const cynthia = buildTrainerBattle(TrainerType.CYNTHIA, LATE_WAVE, "names");
    const garchomp = rollTrainerBattleForm(cynthia.party)!;
    const giovanni = buildTrainerBattle(TrainerType.GIOVANNI, LATE_WAVE, "names");
    const mewtwo = rollTrainerBattleForm(giovanni.party)!;
    const maxie = buildTrainerBattle(TrainerType.MAXIE_2, LATE_WAVE, "names");
    const groudon = rollTrainerBattleForm(maxie.party)!;

    expect([garchomp.name, mewtwo.name]).toEqual(["Mega Garchomp", "Mega Mewtwo X"]);
    expect([garchomp, mewtwo].map(p => p.getNameToRender({ prependFormName: false }))).toEqual(["Garchomp", "Mewtwo"]);
    // What the name blend would have made of them
    expect(getFusedSpeciesName("Mega Mewtwo X", "Mega Mewtwo Y")).toBe("Mega Mewtwowtwo Y");
    // Two species still blend as before
    expect(groudon.name).toBe(getFusedSpeciesName("Primal Groudon", "Mega Camerupt"));

    // Korean text straight into i18next (as custom-dark-chest.test.ts does: the test fetch serves English only)
    const { loadPath } = i18next.options.backend as { loadPath: (lng: string, ns: string[]) => string };
    for (const ns of i18next.options.ns as readonly string[]) {
      const file = /locales\/ko\/(.+?\.json)/.exec(loadPath("ko", [ns]))?.[1];
      const json = file ? koFiles[`../../../locales/ko/${file}`] : undefined;
      if (json) {
        i18next.addResourceBundle("ko", ns, json, true, true);
      }
    }
    const relocalize = () => {
      for (const s of speciesDataRegistry.getAllSpecies()) {
        s.localize();
      }
      for (const p of [garchomp, mewtwo, groudon]) {
        p.generateName();
      }
    };
    await i18next.changeLanguage("ko");
    try {
      relocalize();
      expect([garchomp.name, mewtwo.name]).toEqual(["메가한카리아스", "메가뮤츠X"]);
      expect([garchomp, mewtwo].map(p => p.getNameToRender({ prependFormName: false }))).toEqual([
        "한카리아스",
        "뮤츠",
      ]);
      expect(getFusedSpeciesName("메가뮤츠X", "메가뮤츠Y")).toBe("메가뮤츠X메가뮤츠Y");
    } finally {
      await i18next.changeLanguage("en");
      relocalize();
    }
    expect(garchomp.name).toBe("Mega Garchomp");
    for (const built of [cynthia, giovanni, maxie]) {
      cleanUp(built);
    }
  });
});
