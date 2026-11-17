// Local fork (2026-11-12): more fused Pokémon in Endless trainer battles (enemy-trainer-fusion.ts; the user, approving
// docs/트레이너_배틀도구_합체_강화_계획.md: "합체 포켓몬도 추천안대로 넣어두고")
import { Battle } from "#app/battle";
import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { ENEMY_TRAINER_BUFFS, enemyTrainerBuffDice } from "#balance/enemy-trainer-buffs";
import { NON_LEGEND_PARADOX_POKEMON, NON_LEGEND_ULTRA_BEASTS } from "#balance/special-species-groups";
import { modifierTypes } from "#data/data-lists";
import { speciesHasBattleForm } from "#data/enemy-battle-forms";
import * as FusionModule from "#data/enemy-trainer-fusion";
import {
  type EndlessTrainerFusionMember,
  getEndlessTrainerFusionMember,
  getEnemyTrainerFusionChance,
  withEndlessTrainerFusionMember,
} from "#data/enemy-trainer-fusion";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { UiMode } from "#enums/ui-mode";
import { type EnemyPokemon, Pokemon } from "#field/pokemon";
import { Trainer } from "#field/trainer";
import { EnemyFusionChanceModifier, type EnemyPersistentModifier } from "#modifiers/modifier";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import { getEndlessFillExtraRange, STRONG_EXTRA_MIN_BST } from "#trainers/endless-trainer-party";
import { trainerConfigs } from "#trainers/trainer-config";
import type { TrainerPartyTemplate } from "#trainers/trainer-party-template";
import type { BooleanHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** One generated party member, as plain data */
interface MemberSummary {
  species: SpeciesId;
  formIndex: number;
  level: number;
  fusion: SpeciesId | undefined;
  id: number;
  moves: MoveId[];
  teraType: number;
}

describe("Custom - Endless trainers' extra fusion roll", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH])
      .mysteryEncounterChance(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A wild run in `mode` on `wave` to stand on while trainer battles are built by hand, generation logs muted */
  async function startQuietRun(mode: GameModes, wave: number): Promise<void> {
    game.override.disableTrainerWaves().startingWave(wave);
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(mode);
      game.scene.offsetGym = false;
      const starters = generateStarters(game.scene, [SpeciesId.FEEBAS]);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    await game.phaseInterceptor.to("EncounterPhase");
    game.removeEnemyHeldItems();
    await game.phaseInterceptor.to("CommandPhase", false);
    vi.spyOn(console, "log").mockImplementation(() => {});
  }

  function summarize(p: EnemyPokemon): MemberSummary {
    return {
      species: p.species.speciesId,
      formIndex: p.formIndex,
      level: p.level,
      fusion: p.fusionSpecies?.speciesId,
      id: p.id,
      moves: p.getMoveset().map(m => m.moveId),
      teraType: p.teraType,
    };
  }

  /** The trainer's own template, before any Endless filling */
  function baseTemplate(trainer: Trainer): TrainerPartyTemplate {
    return trainer.config.partyTemplateFunc
      ? trainer.config.partyTemplateFunc()
      : trainer.config.partyTemplates[trainer.partyTemplateIndex];
  }

  /**
   * Builds a battle on `wave` like `BattleScene.newBattle` does (seed reset for the wave, trainer, `Battle`), then rolls
   * its party like `EncounterPhase` does (a mystery encounter's: like `initBattleWithEnemyConfig`, levels included)
   */
  function buildTrainerBattle(
    type: TrainerType,
    variant: TrainerVariant,
    wave: number,
    seed: string,
    options: {
      generate?: boolean;
      battleType?: BattleType.WILD | BattleType.TRAINER | BattleType.MYSTERY_ENCOUNTER;
    } = {},
  ) {
    const { scene } = game;
    scene.setSeed(seed);
    scene.resetSeed(wave);
    const trainer = new Trainer(type, variant);
    const config = trainerConfigs[type];
    const double = config.doubleOnly || (config.hasDouble && variant === TrainerVariant.DOUBLE);
    const battleType = options.battleType ?? BattleType.TRAINER;
    const battle = new Battle(scene.gameMode, { waveIndex: wave, battleType, trainer, double });
    if (battleType === BattleType.MYSTERY_ENCOUNTER) {
      battle.enemyLevels = trainer.getPartyLevels(wave);
    }
    scene.currentBattle = battle;
    if (options.generate !== false) {
      for (let e = 0; e < (battle.enemyLevels?.length ?? 0); e++) {
        battle.enemyParty[e] = trainer.genPartyMember(e);
      }
    }
    return { trainer, battle, party: battle.enemyParty, members: battle.enemyParty.map(summarize) };
  }

  function cleanUp({ trainer, battle }: { trainer: Trainer; battle: Battle }): void {
    for (const p of battle.enemyParty) {
      p.destroy();
    }
    trainer.destroy();
  }

  /** Whether party index `index` comes from one of the trainer's own slot functions (a config slot) */
  function isConfigSlot(trainer: Trainer, index: number): boolean {
    const funcs = trainer.config.partyMemberFuncs;
    const size = trainer.getPartyTemplate().size;
    return Object.hasOwn(funcs, index) || Object.hasOwn(funcs, index - size);
  }

  /** The strong-extra bar, read here from the species form as generated (the head of a fusion) */
  function isStrong(p: EnemyPokemon): boolean {
    const { species } = p;
    return (
      p.getSpeciesForm(true).getBaseStatTotal() >= STRONG_EXTRA_MIN_BST
      && !species.legendary
      && !species.subLegendary
      && !species.mythical
      && !NON_LEGEND_PARADOX_POKEMON.includes(species.speciesId)
      && !NON_LEGEND_ULTRA_BEASTS.includes(species.speciesId)
    );
  }

  /** The dice forced to always fuse (0) or never (99) */
  const forceDice = (value: 0 | 99) => vi.spyOn(enemyTrainerBuffDice, "roll").mockReturnValue(value);

  /** Builds `species` at `level` as a trainer's member described by `member` */
  const buildAs = (member: EndlessTrainerFusionMember | undefined, species: SpeciesId, level = 150) =>
    withEndlessTrainerFusionMember(member, () =>
      game.scene.addEnemyPokemon(speciesDataRegistry.getSpecies(species), level, TrainerSlot.TRAINER),
    );

  it("keeps its curve in ENEMY_TRAINER_BUFFS.fusion, per trainer tier", () => {
    expect(Object.isFrozen(ENEMY_TRAINER_BUFFS.fusion)).toBe(true);
    expect(Object.isFrozen(ENEMY_TRAINER_BUFFS.fusion.elite)).toBe(true);
    const waves = [99, 100, 300, 600, 1000, 2000];
    expect(waves.map(w => getEnemyTrainerFusionChance("ordinary", w))).toEqual([0, 3, 9, 18, 30, 30]);
    expect(waves.map(w => getEnemyTrainerFusionChance("elite", w))).toEqual([0, 5, 13, 25, 40, 40]);
    expect(waves.map(w => getEnemyTrainerFusionChance("boss", w))).toEqual([0, 2, 6, 12, 20, 20]);
    // Steps every 100 waves past 100: 199 is still the first step, 200 the second, 950 the ninth
    expect([199, 200, 599, 950].map(w => getEnemyTrainerFusionChance("ordinary", w))).toEqual([3, 6, 15, 27]);
  });

  it("forced to fuse, fuses an Endless ordinary trainer's members, moves and Tera made for the fusion", async () => {
    await startQuietRun(GameModes.ENDLESS, 350);
    const dice = forceDice(0);
    // The Pokémon whose moveset was made while it was fused already
    const original = Pokemon.prototype.generateAndPopulateMoveset;
    const fusedAtMoveset = new Set<Pokemon>();
    vi.spyOn(Pokemon.prototype, "generateAndPopulateMoveset").mockImplementation(function (this: Pokemon, ...args) {
      if (this.isFusion()) {
        fusedAtMoveset.add(this);
      }
      return original.apply(this, args);
    });
    let fused = 0;
    let strongExtras = 0;
    for (const [type, variant] of [
      [TrainerType.YOUNGSTER, TrainerVariant.DEFAULT],
      [TrainerType.BACKPACKER, TrainerVariant.DEFAULT],
      [TrainerType.FISHERMAN, TrainerVariant.DEFAULT],
    ] as const) {
      for (let s = 0; s < 4; s++) {
        const built = buildTrainerBattle(type, variant, 350, `always-${s}`);
        const range = getEndlessFillExtraRange(baseTemplate(built.trainer), built.trainer.getPartyTemplate());
        expect(built.party.length).toBeGreaterThanOrEqual(5);
        for (const [i, p] of built.party.entries()) {
          const label = `${TrainerType[type]} seed ${s} slot ${i}: ${SpeciesId[p.species.speciesId]}`;
          const strongExtra = i >= range.start && i < range.start + range.count && isStrong(p);
          const battleForm = speciesHasBattleForm(p.species.speciesId);
          strongExtras += strongExtra ? 1 : 0;
          expect(isConfigSlot(built.trainer, i), label).toBe(false);
          expect(p.isFusion(), label).toBe(!strongExtra && !battleForm);
          if (p.isFusion()) {
            fused++;
            // Its moveset was made for the fusion, and its Tera type is one of the fusion's types
            expect(fusedAtMoveset.has(p), label).toBe(true);
            expect(
              p.getTypes({ includeTeraType: false, bypassSummonData: true, ignoreThirdType: true }),
              label,
            ).toContain(p.teraType);
          }
        }
        cleanUp(built);
      }
    }
    expect(fused).toBeGreaterThan(30);
    expect(strongExtras).toBeGreaterThan(0);
    expect(dice).toHaveBeenCalledWith(100);
  }, 120_000);

  it("never rolls in Classic", async () => {
    // Classic wave 150 (difficulty 150 would be 3% in Endless)
    await startQuietRun(GameModes.CLASSIC, 150);
    const dice = forceDice(0);
    const classic = buildTrainerBattle(TrainerType.YOUNGSTER, TrainerVariant.DEFAULT, 150, "classic");
    expect(getEndlessTrainerFusionMember(classic.trainer, { fixedSlot: false, strongRule: undefined })).toBeUndefined();
    expect(classic.members.length).toBeGreaterThan(0);
    expect(classic.members.every(m => m.fusion == null)).toBe(true);
    expect(dice).not.toHaveBeenCalled();
    cleanUp(classic);
  });

  it("never rolls for wild Pokémon or in a mystery-encounter battle in Endless", async () => {
    // The wild battle the run stands on, a wild Pokémon made in it (even inside a member's build, the battle is no
    // trainer battle), and a mystery encounter's trainer battle
    const dice = forceDice(0);
    await startQuietRun(GameModes.ENDLESS, 350);
    expect(game.scene.currentBattle.battleType).toBe(BattleType.WILD);
    expect(game.scene.getEnemyPokemon()?.isFusion()).toBe(false);
    const wild = game.scene.addEnemyPokemon(speciesDataRegistry.getSpecies(SpeciesId.HAXORUS), 150, TrainerSlot.NONE);
    expect(wild.isFusion()).toBe(false);
    const leaked: EndlessTrainerFusionMember = {
      tier: "ordinary",
      difficultyWave: 350,
      fixedSlot: false,
      strongRule: undefined,
      signatureRoots: [],
    };
    expect(buildAs(leaked, SpeciesId.HAXORUS).isFusion()).toBe(false);
    expect(dice).not.toHaveBeenCalled();

    const me = buildTrainerBattle(TrainerType.YOUNGSTER, TrainerVariant.DEFAULT, 350, "me", {
      battleType: BattleType.MYSTERY_ENCOUNTER,
    });
    expect(me.members.length).toBeGreaterThan(0);
    expect(me.members.every(m => m.fusion == null)).toBe(true);
    expect(dice).not.toHaveBeenCalled();
    cleanUp(me);
  }, 120_000);

  it("draws no die in Spliced Endless, where every Pokémon is fused already", async () => {
    await startQuietRun(GameModes.SPLICED_ENDLESS, 350);
    const dice = forceDice(0);
    const built = buildTrainerBattle(TrainerType.YOUNGSTER, TrainerVariant.DEFAULT, 350, "spliced");
    expect(built.members.length).toBeGreaterThanOrEqual(5);
    expect(built.members.every(m => m.fusion != null)).toBe(true);
    expect(dice).not.toHaveBeenCalled();
    cleanUp(built);
  });

  it("never fuses a named trainer's config slots, and a gym leader's only outside them", async () => {
    await startQuietRun(GameModes.ENDLESS, 350);
    const dice = forceDice(0);
    // Hop: every member is one of his own config slots (setForkNamedTrainerParty)
    const hop = buildTrainerBattle(TrainerType.HOP, TrainerVariant.DEFAULT, 350, "hop");
    expect(hop.party.length).toBeGreaterThanOrEqual(5);
    for (const [i, p] of hop.party.entries()) {
      if (isConfigSlot(hop.trainer, i)) {
        expect(p.isFusion(), `Hop slot ${i}`).toBe(false);
      }
    }
    expect(hop.party.filter((_, i) => isConfigSlot(hop.trainer, i)).length).toBeGreaterThan(0);
    cleanUp(hop);

    // Brock: his signature slots stay, his type-filtered slots may fuse (boss tier, forced here)
    let configSlots = 0;
    let free = 0;
    for (let s = 0; s < 3; s++) {
      const brock = buildTrainerBattle(TrainerType.BROCK, TrainerVariant.DEFAULT, 350, `brock-${s}`);
      for (const [i, p] of brock.party.entries()) {
        const label = `Brock seed ${s} slot ${i}: ${SpeciesId[p.species.speciesId]}`;
        if (isConfigSlot(brock.trainer, i)) {
          configSlots++;
          expect(p.isFusion(), label).toBe(false);
        } else if (!speciesHasBattleForm(p.species.speciesId)) {
          free++;
          expect(p.isFusion(), label).toBe(true);
        }
      }
      cleanUp(brock);
    }
    expect(configSlots).toBeGreaterThan(0);
    expect(free).toBeGreaterThan(0);
    expect(dice).toHaveBeenCalled();
  }, 120_000);

  it("never fuses a signature species' line, a strong member or a species with a battle form", async () => {
    await startQuietRun(GameModes.ENDLESS, 350);
    const dice = forceDice(0);

    // Signature species: Cynthia's Garchomp line (Gabite has no battle form of its own), Volo's Giratina (Origin Forme
    // is no battle form); the same trainer's other species do fuse
    const cynthia = buildTrainerBattle(TrainerType.CYNTHIA, TrainerVariant.DEFAULT, 350, "sig", { generate: false });
    const cynthiaMember = getEndlessTrainerFusionMember(cynthia.trainer, { fixedSlot: false, strongRule: undefined });
    expect(cynthiaMember?.tier).toBe("boss");
    expect(cynthiaMember?.signatureRoots).toEqual([SpeciesId.GIBLE]);
    expect(speciesHasBattleForm(SpeciesId.GABITE)).toBe(false);
    expect(buildAs(cynthiaMember, SpeciesId.GABITE).isFusion()).toBe(false);
    expect(buildAs(cynthiaMember, SpeciesId.HAXORUS).isFusion()).toBe(true);
    cleanUp(cynthia);
    const volo = buildTrainerBattle(TrainerType.VOLO, TrainerVariant.DEFAULT, 350, "sig", { generate: false });
    const voloMember = getEndlessTrainerFusionMember(volo.trainer, { fixedSlot: false, strongRule: undefined });
    expect(speciesHasBattleForm(SpeciesId.GIRATINA)).toBe(false);
    expect(buildAs(voloMember, SpeciesId.GIRATINA).isFusion()).toBe(false);
    expect(buildAs(voloMember, SpeciesId.HAXORUS).isFusion()).toBe(true);
    cleanUp(volo);
    // Raihan's own (Duraludon) and late (Archaludon) signatures share one line
    expect(FusionModule.getTrainerSignatureRoots(trainerConfigs[TrainerType.RAIHAN])).toEqual([SpeciesId.DURALUDON]);

    // Strong members: an Endless extra past the bar stays (Hydreigon), the legend group only under the elite rule
    const youngster = buildTrainerBattle(TrainerType.YOUNGSTER, TrainerVariant.DEFAULT, 350, "strong", {
      generate: false,
    });
    const asExtra = getEndlessTrainerFusionMember(youngster.trainer, { fixedSlot: false, strongRule: "extra" });
    const asElite = getEndlessTrainerFusionMember(youngster.trainer, { fixedSlot: false, strongRule: "elite" });
    const asOther = getEndlessTrainerFusionMember(youngster.trainer, { fixedSlot: false, strongRule: undefined });
    expect(speciesHasBattleForm(SpeciesId.HYDREIGON)).toBe(false);
    expect(speciesHasBattleForm(SpeciesId.RESHIRAM)).toBe(false);
    expect(buildAs(asExtra, SpeciesId.HYDREIGON).isFusion()).toBe(false);
    expect(buildAs(asElite, SpeciesId.HYDREIGON).isFusion()).toBe(false);
    expect(buildAs(asOther, SpeciesId.HYDREIGON).isFusion()).toBe(true);
    expect(buildAs(asElite, SpeciesId.RESHIRAM).isFusion()).toBe(false);
    expect(buildAs(asExtra, SpeciesId.RESHIRAM).isFusion()).toBe(true);
    // Below the bar (Flygon 520; Haxorus, at 540, is on it), an extra fuses
    expect(speciesDataRegistry.getSpecies(SpeciesId.FLYGON).getBaseStatTotal()).toBeLessThan(STRONG_EXTRA_MIN_BST);
    expect(speciesHasBattleForm(SpeciesId.FLYGON)).toBe(false);
    expect(buildAs(asExtra, SpeciesId.FLYGON).isFusion()).toBe(true);
    expect(buildAs(asExtra, SpeciesId.HAXORUS).isFusion()).toBe(false);

    // Battle-form species, decided for the species: Rayquaza (its Mega needs Dragon Ascent), Charizard, Pikachu
    // (G-Max), Baxcalibur (our Mega Z), Venusaur; no die for them
    dice.mockClear();
    for (const species of [
      SpeciesId.RAYQUAZA,
      SpeciesId.CHARIZARD,
      SpeciesId.PIKACHU,
      SpeciesId.BAXCALIBUR,
      SpeciesId.VENUSAUR,
    ]) {
      expect(speciesHasBattleForm(species), SpeciesId[species]).toBe(true);
      expect(buildAs(asOther, species).isFusion(), SpeciesId[species]).toBe(false);
    }
    expect(dice).not.toHaveBeenCalled();
    // A config slot draws nothing either
    const asConfig = getEndlessTrainerFusionMember(youngster.trainer, { fixedSlot: true, strongRule: undefined });
    expect(buildAs(asConfig, SpeciesId.HAXORUS).isFusion()).toBe(false);
    expect(dice).not.toHaveBeenCalled();
    cleanUp(youngster);
  }, 120_000);

  it("forced never, leaves the fusion token's behaviour as it was", async () => {
    await startQuietRun(GameModes.ENDLESS, 350);
    const types = [TrainerType.YOUNGSTER, TrainerType.BACKPACKER] as const;

    // The party without the new roll at all (its function off) ...
    const off = vi.spyOn(FusionModule, "rollEndlessTrainerFusion").mockReturnValue(false);
    const before = types.map(type => {
      const built = buildTrainerBattle(type, TrainerVariant.DEFAULT, 350, "never");
      cleanUp(built);
      return built.members;
    });
    expect(off).toHaveBeenCalled();
    off.mockRestore();
    // ... is the very same party, ids included, with the roll forced to miss: the dice draws from no seeded sequence
    const dice = forceDice(99);
    const after = types.map(type => {
      const built = buildTrainerBattle(type, TrainerVariant.DEFAULT, 350, "never");
      cleanUp(built);
      return built.members;
    });
    expect(dice).toHaveBeenCalled();
    expect(after).toEqual(before);
    expect(after.flat().every(m => m.fusion == null)).toBe(true);

    // The token rolls first and as before: when it fuses (forced), the new roll draws nothing; when it misses, the new
    // roll still fuses (forced) whatever it may
    await game.scene.addEnemyModifier(
      modifierTypes.ENEMY_FUSED_CHANCE().newModifier() as EnemyPersistentModifier,
      true,
      true,
    );
    const token = vi
      .spyOn(EnemyFusionChanceModifier.prototype, "apply")
      .mockImplementation((isFusion: BooleanHolder) => {
        isFusion.value = true;
        return true;
      });
    dice.mockClear();
    const tokenFused = buildTrainerBattle(TrainerType.YOUNGSTER, TrainerVariant.DEFAULT, 350, "token");
    expect(token).toHaveBeenCalled();
    expect(tokenFused.members.every(m => m.fusion != null)).toBe(true);
    expect(dice).not.toHaveBeenCalled();
    cleanUp(tokenFused);

    token.mockImplementation(() => false);
    dice.mockReturnValue(0);
    const tokenMissed = buildTrainerBattle(TrainerType.YOUNGSTER, TrainerVariant.DEFAULT, 350, "token");
    expect(dice).toHaveBeenCalled();
    expect(tokenMissed.party.some(p => p.isFusion())).toBe(true);
    cleanUp(tokenMissed);
  }, 120_000);
});
