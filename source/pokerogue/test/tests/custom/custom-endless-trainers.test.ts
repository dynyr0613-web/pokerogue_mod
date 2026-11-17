// Local fork (2026-11-08): Endless trainers evolve fully and fill their party up as waves rise
import { ENDLESS_TRAINER_FULL_EVOLUTION_WAVE } from "#ai/ai-species-gen";
import { Battle } from "#app/battle";
import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { NON_LEGEND_PARADOX_POKEMON, NON_LEGEND_ULTRA_BEASTS } from "#balance/special-species-groups";
import { allBiomes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { BiomePoolTier } from "#enums/biome-pool-tier";
import { EvoLevelThresholdKind } from "#enums/evo-level-threshold-kind";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { PartyMemberStrength } from "#enums/party-member-strength";
import type { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { TimeOfDay } from "#enums/time-of-day";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { UiMode } from "#enums/ui-mode";
import type { EnemyPokemon } from "#field/pokemon";
import { Trainer } from "#field/trainer";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import {
  ENDLESS_ELITE_LEGEND_WAVE,
  ENDLESS_ELITE_TRAINER_TYPES,
  getEndlessFillExtraRange,
  getEndlessTrainerMinPartySize,
  getStrongExtraSpecies,
  getStrongPoolSpecies,
  getTrainerStrongExtraPool,
  isEndlessEliteLegendBattle,
  MAX_TRAINER_PARTY_SIZE,
  STRONG_EXTRA_MIN_BST,
} from "#trainers/endless-trainer-party";
import { getRandomPartyMemberFunc, trainerConfigs } from "#trainers/trainer-config";
import type { TrainerPartyTemplate } from "#trainers/trainer-party-template";
import type { ArenaPokemonPools } from "#types/biomes";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

/** One generated party member, as plain data. */
interface MemberSummary {
  species: SpeciesId;
  formIndex: number;
  level: number;
  fusion: SpeciesId | undefined;
  fusionFormIndex: number;
  trainerSlot: TrainerSlot;
  id: number;
  /** Evolutions the species (or the fusion tail) could still take, as "SPECIES -> EVOLUTION" */
  evolvable: string[];
  /** Base stat total of the species form it was generated as (the head of a fusion) */
  bst: number;
  /** Legendary, sub-legendary, mythical, Paradox or Ultra Beast */
  special: boolean;
  /** Types of that form */
  types: PokemonType[];
}

/**
 * Trainer types sampled for the evolution checks: fossil pools with Lileep / Anorith / Omanyte / Kabuto (Ruin Maniac,
 * Scientist, Scuba Diver, Magma Grunt, Roxanne's signature slot), a type-filtered random pool (Roughneck), Twins' baby
 * slots, Fisherman's one-member templates and Ace Trainer pairs.
 */
const EVOLUTION_SAMPLE: [TrainerType, TrainerVariant][] = [
  [TrainerType.RUIN_MANIAC, TrainerVariant.DEFAULT],
  [TrainerType.SCIENTIST, TrainerVariant.DEFAULT],
  [TrainerType.SCUBA_DIVER, TrainerVariant.DEFAULT],
  [TrainerType.MAGMA_GRUNT, TrainerVariant.DEFAULT],
  [TrainerType.ROXANNE, TrainerVariant.DEFAULT],
  [TrainerType.ROUGHNECK, TrainerVariant.DEFAULT],
  [TrainerType.TWINS, TrainerVariant.DOUBLE],
  [TrainerType.FISHERMAN, TrainerVariant.DEFAULT],
  [TrainerType.ACE_TRAINER, TrainerVariant.DOUBLE],
  [TrainerType.BREEDER, TrainerVariant.DEFAULT],
];

describe("Custom Endless trainers", () => {
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
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH])
      .mysteryEncounterChance(0);
  });

  afterEach(() => {
    logSpy?.mockRestore();
    logSpy = undefined;
  });

  /** Start a run in `mode` on `wave` the way the title screen would (no gym offset) and play to the first command. */
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
    await game.phaseInterceptor.to("EncounterPhase");
    game.removeEnemyHeldItems();
    await game.phaseInterceptor.to("CommandPhase", false);
  }

  /** A wild run to stand on while trainer battles are built by hand, with the noisy generation logs muted. */
  async function startQuietRun(mode: GameModes, wave: number): Promise<void> {
    game.override.disableTrainerWaves();
    await startRun(mode, wave);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  }

  /** Evolutions still open to `speciesId` in the form `formKey`. */
  function openEvolutions(speciesId: SpeciesId, formKey: string): string[] {
    return speciesDataRegistry
      .getEvolutions(speciesId)
      .filter(e => e.preFormKey == null || e.preFormKey === formKey)
      .map(e => `${SpeciesId[speciesId]} -> ${SpeciesId[e.speciesId]}`);
  }

  function summarize(p: EnemyPokemon): MemberSummary {
    const { species } = p;
    const form = p.getSpeciesForm(true);
    return {
      species: p.species.speciesId,
      formIndex: p.formIndex,
      level: p.level,
      fusion: p.fusionSpecies?.speciesId,
      fusionFormIndex: p.fusionFormIndex,
      trainerSlot: p.trainerSlot,
      id: p.id,
      evolvable: [
        ...openEvolutions(p.species.speciesId, p.getFormKey()),
        ...(p.fusionSpecies ? openEvolutions(p.fusionSpecies.speciesId, p.getFusionFormKey() ?? "") : []),
      ],
      bst: form.getBaseStatTotal(),
      special:
        species.legendary
        || species.subLegendary
        || species.mythical
        || NON_LEGEND_PARADOX_POKEMON.includes(species.speciesId)
        || NON_LEGEND_ULTRA_BEASTS.includes(species.speciesId),
      types: form.type2 == null ? [form.type1] : [form.type1, form.type2],
    };
  }

  /** The trainer's own template, before any Endless filling, as `getPartyLevels` would see it right now. */
  function baseTemplate(trainer: Trainer): TrainerPartyTemplate {
    return trainer.config.partyTemplateFunc
      ? trainer.config.partyTemplateFunc()
      : trainer.config.partyTemplates[trainer.partyTemplateIndex];
  }

  /**
   * Build a trainer battle on `wave` like `BattleScene.newBattle` does (seed reset for the wave, trainer, `Battle`),
   * then roll its party like `EncounterPhase` does.
   */
  function buildTrainerBattle(
    type: TrainerType,
    variant: TrainerVariant,
    wave: number,
    seed: string,
    options: { generate?: boolean; partyTemplateIndex?: number | undefined } = {},
  ) {
    const { scene } = game;
    scene.setSeed(seed);
    scene.resetSeed(wave);
    const trainer = new Trainer(type, variant, options.partyTemplateIndex);
    const config = trainerConfigs[type];
    const double = config.doubleOnly || (config.hasDouble && variant === TrainerVariant.DOUBLE);
    const base = baseTemplate(trainer);
    const battle = new Battle(scene.gameMode, { waveIndex: wave, battleType: BattleType.TRAINER, trainer, double });
    scene.currentBattle = battle;
    const members: MemberSummary[] = [];
    if (options.generate !== false) {
      for (let e = 0; e < (battle.enemyLevels?.length ?? 0); e++) {
        battle.enemyParty[e] = trainer.genPartyMember(e);
      }
      members.push(...battle.enemyParty.map(summarize));
    }
    return { trainer, battle, base, double, members };
  }

  function cleanUp({ trainer, battle }: { trainer: Trainer; battle: Battle }): void {
    for (const p of battle.enemyParty) {
      p.destroy();
    }
    trainer.destroy();
  }

  describe("evolution", () => {
    it.each([
      { mode: GameModes.ENDLESS, seeds: 4, sample: EVOLUTION_SAMPLE },
      { mode: GameModes.SPLICED_ENDLESS, seeds: 2, sample: EVOLUTION_SAMPLE.slice(0, 6) },
    ])(
      "$mode trainers at waves 300 and 560 field nothing that can still evolve",
      async ({ mode, seeds, sample }) => {
        await startQuietRun(mode, 300);
        const leftovers: string[] = [];
        let members = 0;
        let fusions = 0;
        for (const wave of [300, 560]) {
          for (const [type, variant] of sample) {
            for (let s = 0; s < seeds; s++) {
              const built = buildTrainerBattle(type, variant, wave, `evo-${s}`);
              for (const m of built.members) {
                members++;
                if (m.fusion != null) {
                  fusions++;
                }
                for (const left of m.evolvable) {
                  leftovers.push(`wave ${wave} ${TrainerType[type]} L${m.level}: ${left}`);
                }
              }
              cleanUp(built);
            }
          }
        }
        expect(leftovers).toEqual([]);
        expect(members).toBeGreaterThan(sample.length * seeds * 2 * 4);
        if (mode === GameModes.SPLICED_ENDLESS) {
          expect(fusions).toBe(members);
        }
      },
      300_000,
    );

    it("takes a level evolution at its level in Endless; Classic keeps the stock random delay", async () => {
      await startQuietRun(GameModes.CLASSIC, 60);
      const lileep = speciesDataRegistry.getSpecies(SpeciesId.LILEEP);
      // Lileep evolves at 40; a Normal trainer's random delay goes up to 44
      const roll = (seed: string) => {
        game.scene.setSeed(seed);
        game.scene.resetSeed(60);
        return lileep.getTrainerSpeciesForLevel(41, true, PartyMemberStrength.AVERAGE, EvoLevelThresholdKind.NORMAL);
      };
      const classic = buildTrainerBattle(TrainerType.RUIN_MANIAC, TrainerVariant.DEFAULT, 60, "c", { generate: false });
      const classicResults = new Set(Array.from({ length: 30 }, (_, s) => roll(`lileep-${s}`)));
      expect(classicResults).toEqual(new Set([SpeciesId.LILEEP, SpeciesId.CRADILY]));
      cleanUp(classic);

      game.scene.gameMode = getGameMode(GameModes.ENDLESS);
      const endless = buildTrainerBattle(TrainerType.RUIN_MANIAC, TrainerVariant.DEFAULT, 60, "e", { generate: false });
      const endlessResults = new Set(Array.from({ length: 30 }, (_, s) => roll(`lileep-${s}`)));
      expect(endlessResults).toEqual(new Set([SpeciesId.CRADILY]));
      // Below its level it still stays a Lileep, and an evolved species rolled too early still drops back
      game.scene.setSeed("low");
      expect(lileep.getTrainerSpeciesForLevel(39, true)).toBe(SpeciesId.LILEEP);
      expect(speciesDataRegistry.getSpecies(SpeciesId.CRADILY).getTrainerSpeciesForLevel(39, true)).toBe(
        SpeciesId.LILEEP,
      );
      cleanUp(endless);
    });

    it(`takes stone evolutions at any level from Endless wave ${ENDLESS_TRAINER_FULL_EVOLUTION_WAVE}`, async () => {
      await startQuietRun(GameModes.ENDLESS, ENDLESS_TRAINER_FULL_EVOLUTION_WAVE - 1);
      // Growlithe -> Arcanine needs a Fire Stone; trainers normally wait for level 35 (up to 38 with the delay)
      const growlithe = speciesDataRegistry.getSpecies(SpeciesId.GROWLITHE);
      const roll = (wave: number) => {
        const built = buildTrainerBattle(TrainerType.ACE_TRAINER, TrainerVariant.DEFAULT, wave, "stone", {
          generate: false,
        });
        const result = growlithe.getTrainerSpeciesForLevel(20, true);
        cleanUp(built);
        return result;
      };
      expect(roll(ENDLESS_TRAINER_FULL_EVOLUTION_WAVE - 1)).toBe(SpeciesId.GROWLITHE);
      expect(roll(ENDLESS_TRAINER_FULL_EVOLUTION_WAVE)).toBe(SpeciesId.ARCANINE);
      // An Arcanine rolled on that wave is kept even below the stock threshold
      const built = buildTrainerBattle(TrainerType.ACE_TRAINER, TrainerVariant.DEFAULT, 100, "stone", {
        generate: false,
      });
      expect(speciesDataRegistry.getSpecies(SpeciesId.ARCANINE).getTrainerSpeciesForLevel(20, true)).toBe(
        SpeciesId.ARCANINE,
      );
      cleanUp(built);

      // Wild Pokémon and Classic trainers keep the stock threshold
      game.scene.gameMode = getGameMode(GameModes.CLASSIC);
      expect(roll(ENDLESS_TRAINER_FULL_EVOLUTION_WAVE)).toBe(SpeciesId.GROWLITHE);
      game.scene.gameMode = getGameMode(GameModes.ENDLESS);
      game.scene.currentBattle.trainer = null;
      expect(growlithe.getSpeciesForLevel(20, true, false)).toBe(SpeciesId.GROWLITHE);
    });
  });

  describe("party size", () => {
    it("is at least min(6, 2 + floor(wave / 100)) from wave 100, counting both trainers of a pair", async () => {
      await startQuietRun(GameModes.ENDLESS, 99);
      expect([99, 100, 150, 200, 299, 300, 400, 560, 1000].map(getEndlessTrainerMinPartySize)).toEqual([
        0, 3, 3, 4, 4, 5, 6, 6, 6,
      ]);

      // Fisherman's templates: 2 weak (same) + 1 avg, 1 avg, 2 avg, 1 strong, 4 weak
      const fishermanSizes = [3, 1, 2, 1, 4];
      const cases: [TrainerType, TrainerVariant, number | undefined][] = [
        ...fishermanSizes.map((_, i): [TrainerType, TrainerVariant, number] => [
          TrainerType.FISHERMAN,
          TrainerVariant.DEFAULT,
          i,
        ]),
        [TrainerType.ACE_TRAINER, TrainerVariant.DOUBLE, undefined],
        [TrainerType.TWINS, TrainerVariant.DOUBLE, undefined],
        [TrainerType.BREEDER, TrainerVariant.DEFAULT, undefined],
      ];
      for (const wave of [99, 100, 200, 300, 400, 560]) {
        for (const [type, variant, partyTemplateIndex] of cases) {
          const built = buildTrainerBattle(type, variant, wave, `size-${wave}`, {
            generate: false,
            partyTemplateIndex,
          });
          const own = Math.max(built.base.size, built.double ? 2 : 1);
          const expected = Math.max(own, getEndlessTrainerMinPartySize(wave));
          const label = `${TrainerType[type]} #${built.trainer.partyTemplateIndex} wave ${wave}`;
          expect(built.battle.enemyLevels, label).toHaveLength(expected);
          expect(expected).toBeLessThanOrEqual(MAX_TRAINER_PARTY_SIZE);
          if (partyTemplateIndex != null) {
            expect(built.base.size, label).toBe(fishermanSizes[partyTemplateIndex]);
          }
          // A filled template keeps the trainer's ace in its last slot (both read with the new battle current)
          const filled = built.trainer.getPartyTemplate();
          const baseNow = baseTemplate(built.trainer);
          expect(filled.getStrength(filled.size - 1), label).toBe(baseNow.getStrength(baseNow.size - 1));
          cleanUp(built);
        }
      }
    });

    it("rolls the extra members from the trainer's own pools, evolved and levelled like the rest", async () => {
      await startQuietRun(GameModes.ENDLESS, 300);
      // Fisherman #3 is a single strong member; wave 412 fills it up to 6
      const built = buildTrainerBattle(TrainerType.FISHERMAN, TrainerVariant.DEFAULT, 412, "fill", {
        partyTemplateIndex: 3,
      });
      expect(built.base.size).toBe(1);
      expect(built.members).toHaveLength(6);
      expect(built.members.map(m => m.level)).toEqual(built.battle.enemyLevels);
      // The extras use the first slot's strength (Strong here), so they get the same level
      expect(new Set(built.members.map(m => m.level)).size).toBe(1);
      // All different evolution lines, all fully evolved, all from Fisherman's own pools
      const poolRoots = new Set(
        Object.values(trainerConfigs[TrainerType.FISHERMAN].speciesPools ?? {})
          .flat(2)
          .map(s => speciesDataRegistry.getSpecies(s).getRootSpeciesId()),
      );
      const lines = built.members.map(m => speciesDataRegistry.getSpecies(m.species).getRootSpeciesId());
      expect(new Set(lines).size).toBe(6);
      for (const root of lines) {
        expect(poolRoots.has(root), SpeciesId[root]).toBe(true);
      }
      for (const m of built.members) {
        expect(m.evolvable).toEqual([]);
        expect(m.trainerSlot).toBe(TrainerSlot.TRAINER);
      }
      cleanUp(built);

      // A pair shares the six: three each
      const pair = buildTrainerBattle(TrainerType.ACE_TRAINER, TrainerVariant.DOUBLE, 412, "pair");
      expect(pair.members).toHaveLength(6);
      expect(pair.members.filter(m => m.trainerSlot === TrainerSlot.TRAINER)).toHaveLength(3);
      expect(pair.members.filter(m => m.trainerSlot === TrainerSlot.TRAINER_PARTNER)).toHaveLength(3);
      cleanUp(pair);
    });

    it("leaves Classic trainer parties as they were", async () => {
      await startQuietRun(GameModes.CLASSIC, 150);
      for (let i = 0; i < 5; i++) {
        const built = buildTrainerBattle(TrainerType.FISHERMAN, TrainerVariant.DEFAULT, 150, "classic", {
          generate: i === 1,
          partyTemplateIndex: i,
        });
        expect(built.trainer.forkEndlessFillWave).toBeUndefined();
        expect(built.trainer.getPartyTemplate()).toBe(built.base);
        expect(built.battle.enemyLevels).toHaveLength(built.base.size);
        if (i === 1) {
          expect(built.members).toHaveLength(1);
        }
        cleanUp(built);
      }
    });

    // Local fork (2026-11-08), review fix: these pairs keep their species pools only in slot functions 0 and 1, so the
    // extras used to come from the whole dex (Twins with Infernape, Mysterious Sisters with Salamence)
    it.each([TrainerType.TWINS, TrainerType.YOUNG_COUPLE, TrainerType.MYSTERIOUS_SISTERS])(
      "gives the extras of %s from its own slot functions, without repeating a line",
      async type => {
        await startQuietRun(GameModes.ENDLESS, 300);
        const funcs = trainerConfigs[type].partyMemberFuncs;
        const originals = [funcs[0], funcs[1]];
        const fromFunc = new Map<EnemyPokemon, number>();
        for (const f of [0, 1]) {
          funcs[f] = (...args) => {
            const pokemon = originals[f](...args);
            fromFunc.set(pokemon, f);
            return pokemon;
          };
        }
        const lineOf = (s: SpeciesId) => [s, ...speciesDataRegistry.getPrevolutionChain(s)];
        try {
          for (let s = 0; s < 8; s++) {
            fromFunc.clear();
            const built = buildTrainerBattle(type, TrainerVariant.DOUBLE, 412, `pair-${s}`);
            expect(built.members).toHaveLength(6);
            const strongSlot = built.trainer.getEndlessStrongExtraIndex();
            built.members.forEach((m, i) => {
              const label = `${TrainerType[type]} seed ${s} slot ${i}`;
              // Even slots from the first trainer's function, odd slots from the partner's. Local fork (2026-11-08): the
              // last extra is a direct strong pick instead when the functions gave no strong extra
              const source = fromFunc.get(built.battle.enemyParty[i]);
              if (i === strongSlot && source == null) {
                expect(m.bst, label).toBeGreaterThanOrEqual(STRONG_EXTRA_MIN_BST);
              } else {
                expect(source, label).toBe(i % 2);
              }
              expect(m.trainerSlot).toBe(i % 2 ? TrainerSlot.TRAINER_PARTNER : TrainerSlot.TRAINER);
              expect(m.evolvable).toEqual([]);
              if (i >= 2) {
                for (const [j, other] of built.members.entries()) {
                  if (j !== i) {
                    // Held items are matched by id; the shared seed used to give extras the same id as other members
                    expect(m.id, `${label} vs ${j}`).not.toBe(other.id);
                  }
                }
                for (const earlier of built.members.slice(0, i)) {
                  expect(lineOf(m.species), label).not.toContain(earlier.species);
                  expect(lineOf(earlier.species), label).not.toContain(m.species);
                }
              }
            });
            cleanUp(built);

            // The trainers' own two members are the same as without the fill
            const unfilled = buildTrainerBattle(type, TrainerVariant.DOUBLE, 412, `pair-${s}`, { generate: false });
            unfilled.trainer.forkEndlessFillWave = undefined;
            unfilled.battle.enemyLevels = unfilled.trainer.getPartyLevels(412);
            const own = [0, 1].map(e => unfilled.trainer.genPartyMember(e));
            expect(own.map(p => p.species.speciesId)).toEqual(built.members.slice(0, 2).map(m => m.species));
            for (const p of own) {
              p.destroy();
            }
            cleanUp(unfilled);
          }
        } finally {
          funcs[0] = originals[0];
          funcs[1] = originals[1];
        }
      },
    );
  });

  // Local fork (2026-11-08), the user: at least one of the extras is strong while each trainer keeps its character
  describe("strong extra", () => {
    /**
     * Weak pools (Youngster, Twins' baby slot functions), Ruin Maniac's fossil pools, type specialists with pools or a
     * type filter (Fisherman: Water, Bug Catcher: Bug, Black Belt: Fighting) and a Youngster pair (one side each). `weak` marks
     * the ones whose extras are seldom strong on their own; `pool` the ones whose own pool is readable (not Twins' slot
     * functions).
     */
    const STRONG_SAMPLE = [
      { name: "Youngster", type: TrainerType.YOUNGSTER, variant: TrainerVariant.DEFAULT, weak: true, pool: true },
      { name: "Bug Catcher", type: TrainerType.BUG_CATCHER, variant: TrainerVariant.DEFAULT, weak: true, pool: true },
      { name: "Fisherman", type: TrainerType.FISHERMAN, variant: TrainerVariant.DEFAULT, weak: false, pool: true },
      { name: "Black Belt", type: TrainerType.BLACK_BELT, variant: TrainerVariant.DEFAULT, weak: true, pool: true },
      { name: "Ruin Maniac", type: TrainerType.RUIN_MANIAC, variant: TrainerVariant.DEFAULT, weak: false, pool: true },
      { name: "Twins", type: TrainerType.TWINS, variant: TrainerVariant.DOUBLE, weak: true, pool: false },
      { name: "Youngster pair", type: TrainerType.YOUNGSTER, variant: TrainerVariant.DOUBLE, weak: true, pool: true },
    ];
    const WAVES = [100, 300, 560];
    const SEEDS = 8;

    function isStrong(m: MemberSummary): boolean {
      return m.bst >= STRONG_EXTRA_MIN_BST && !m.special;
    }

    function lineOf(speciesId: SpeciesId): SpeciesId[] {
      return [speciesId, ...speciesDataRegistry.getPrevolutionChain(speciesId)];
    }

    function sameLine(a: SpeciesId, b: SpeciesId): boolean {
      return lineOf(a).includes(b) || lineOf(b).includes(a);
    }

    /** Every species the trainer's own pool can give: its pools' lines, else the lines its filter lets the dex roll. */
    function ownLines(type: TrainerType): Set<SpeciesId> {
      const config = trainerConfigs[type];
      const rolled = config.speciesPools
        ? Object.values(config.speciesPools).flat(2)
        : speciesDataRegistry
            .getAllSpecies()
            .filter(s => config.speciesFilter(s))
            .map(s => s.getRootSpeciesId());
      return new Set(rolled.flatMap(s => [s, ...speciesDataRegistry.getEvolutionChain(s)]));
    }

    /**
     * Build the same battle with the rule on and off (the strong-extra slot reported as none), with the extras' range
     * and the strong-extra slot read while the rule-on battle is current.
     */
    function buildBoth(type: TrainerType, variant: TrainerVariant, wave: number, seed: string) {
      const on = buildTrainerBattle(type, variant, wave, seed);
      const range = getEndlessFillExtraRange(baseTemplate(on.trainer), on.trainer.getPartyTemplate());
      const target = on.trainer.getEndlessStrongExtraIndex();
      cleanUp(on);
      const spy = vi.spyOn(Trainer.prototype, "getEndlessStrongExtraIndex").mockReturnValue(undefined);
      let off: ReturnType<typeof buildTrainerBattle>;
      try {
        off = buildTrainerBattle(type, variant, wave, seed);
      } finally {
        spy.mockRestore();
      }
      cleanUp(off);
      const extras = (members: MemberSummary[]) => members.slice(range.start, range.start + range.count);
      return {
        on: on.members,
        off: off.members,
        ...range,
        target,
        rerolled: range.count > 0 && !extras(off.members).some(isStrong),
        extras,
      };
    }

    it.each(STRONG_SAMPLE)(
      "gives $name's filled parties a strong extra and leaves everything else as it was",
      async ({ type, variant, weak, pool }) => {
        await startQuietRun(GameModes.ENDLESS, 300);
        const config = trainerConfigs[type];
        const specialty = config.hasSpecialtyType() ? config.specialtyType : undefined;
        const own = pool ? ownLines(type) : undefined;
        let filled = 0;
        let rerolled = 0;
        let specialtyChecks = 0;
        let ownChecks = 0;
        for (const wave of WAVES) {
          for (let s = 0; s < SEEDS; s++) {
            const label = `${TrainerType[type]} wave ${wave} seed ${s}`;
            const both = buildBoth(type, variant, wave, `strong-${s}`);
            const { on, off, start, count, target } = both;
            expect(on, label).toHaveLength(off.length);
            // The trainer's own members before the extras are rolled first and never change
            expect(on.slice(0, start), label).toEqual(off.slice(0, start));
            if (count === 0) {
              expect(on, label).toEqual(off);
              continue;
            }
            filled++;
            expect(both.extras(on).some(isStrong), label).toBe(true);
            if (!both.rerolled) {
              // An extra was strong already: the very same party, ids included, so nothing more was drawn
              expect(on, label).toEqual(off);
              continue;
            }
            rerolled++;
            // The last extra, just before the ace, is the one re-rolled; the extras before it stay
            expect(target, label).toBe(start + count - 1);
            if (target == null) {
              continue;
            }
            const strong = on[target];
            expect(isStrong(strong), `${label}: ${SpeciesId[strong.species]}`).toBe(true);
            expect(strong.evolvable, label).toEqual([]);
            expect(strong.level, label).toBe(off[target].level);
            expect(strong.trainerSlot, label).toBe(off[target].trainerSlot);
            expect(on.slice(start, target), label).toEqual(off.slice(start, target));
            for (const [i, m] of on.entries()) {
              if (i !== target) {
                expect(sameLine(m.species, strong.species), `${label} slot ${i}`).toBe(false);
              }
            }
            // A strong species of the trainer's own pool comes first and, inside that pool or outside it, a specialist
            // keeps its type, whenever one is in no other member's line. Local fork (2026-11-08), review fix: the own
            // pool before any outside species of the specialty type, as the rule was given
            const others = on.filter((_, i) => i !== target);
            const free = getStrongExtraSpecies().filter(id => !others.some(m => sameLine(m.species, id)));
            const isOfSpecialty = (id: SpeciesId) =>
              specialty == null || speciesDataRegistry.getSpecies(id).isOfType(specialty);
            const strongLabel = `${label}: ${SpeciesId[strong.species]}`;
            const freeOwn = own ? free.filter(id => own.has(id)) : [];
            if (freeOwn.length > 0) {
              ownChecks++;
              expect(own?.has(strong.species), strongLabel).toBe(true);
            }
            if (specialty != null && (freeOwn.length > 0 ? freeOwn : free).some(isOfSpecialty)) {
              specialtyChecks++;
              expect(strong.types, strongLabel).toContain(specialty);
            }
            // The members after the extras (the ace) are the trainer's own: one only changes where the old extra's line
            // had pushed it off its own roll. Local fork (2026-11-08), review fix: the strong pick no longer takes the
            // ace's line and pushes the ace onto a re-roll
            for (let i = target + 1; i < on.length; i++) {
              if (on[i].species !== off[i].species) {
                expect(sameLine(on[i].species, off[target].species), `${label} ace slot ${i}`).toBe(true);
                break;
              }
            }
          }
        }
        // Waves 300 and 560 always add extras to these trainers
        expect(filled).toBeGreaterThanOrEqual(SEEDS * 2);
        if (weak) {
          expect(rerolled).toBeGreaterThan(0);
        }
        if (rerolled > 0 && specialty != null) {
          expect(specialtyChecks).toBeGreaterThan(0);
        }
        if (rerolled > 0 && own && getStrongExtraSpecies().some(id => own.has(id))) {
          expect(ownChecks).toBeGreaterThan(0);
        }
      },
      120_000,
    );

    it("leaves gym leaders, who already field five or six from wave 100, as they were", async () => {
      await startQuietRun(GameModes.ENDLESS, 300);
      for (const type of [TrainerType.BROCK, TrainerType.MISTY, TrainerType.TATE]) {
        const variant = type === TrainerType.TATE ? TrainerVariant.DOUBLE : TrainerVariant.DEFAULT;
        for (const wave of WAVES) {
          // Their template function reads the current battle, which `Battle` itself reads before it becomes current:
          // stand on a battle of the same wave first, as the game does from one wave to the next
          cleanUp(buildTrainerBattle(type, variant, wave, "gym", { generate: false }));
          const both = buildBoth(type, variant, wave, "gym");
          expect(both.count, `${TrainerType[type]} wave ${wave}`).toBe(0);
          expect(both.target).toBeUndefined();
          expect(both.on).toEqual(both.off);
        }
      }
    });

    it("rolls the same strong extra from the same seed, fused in Spliced Endless", async () => {
      await startQuietRun(GameModes.SPLICED_ENDLESS, 300);
      for (const [type, variant] of [
        [TrainerType.YOUNGSTER, TrainerVariant.DEFAULT],
        [TrainerType.TWINS, TrainerVariant.DOUBLE],
      ] as const) {
        for (const wave of [300, 560]) {
          const label = `${TrainerType[type]} wave ${wave}`;
          const first = buildBoth(type, variant, wave, "spliced");
          expect(first.extras(first.on).some(isStrong), label).toBe(true);
          for (const m of first.on) {
            expect(m.fusion, label).toBeDefined();
            expect(m.evolvable, label).toEqual([]);
          }
          const again = buildTrainerBattle(type, variant, wave, "spliced");
          expect(again.members, label).toEqual(first.on);
          cleanUp(again);
        }
      }
    });

    // Local fork (2026-11-08), review fix: the strong pick took the line of the trainer's own ace, which is rolled after
    // the extras, and pushed the ace onto a re-roll (a weaker species), so the party gained nothing
    it.each([
      { name: "Beauty", type: TrainerType.BEAUTY, wave: 1000, partyTemplateIndex: 0, ace: SpeciesId.MILOTIC },
      { name: "Officer", type: TrainerType.OFFICER, wave: 250, partyTemplateIndex: 3, ace: SpeciesId.ARCANINE },
      {
        name: "Parasol Lady",
        type: TrainerType.PARASOL_LADY,
        wave: 1000,
        partyTemplateIndex: 1,
        ace: SpeciesId.KINGDRA,
      },
    ])("keeps $name's own strong ace and gives the extras another strong line", async ({ type, wave, ...rest }) => {
      await startQuietRun(GameModes.ENDLESS, 300);
      const options = { partyTemplateIndex: rest.partyTemplateIndex };
      const on = buildTrainerBattle(type, TrainerVariant.DEFAULT, wave, "p0", options);
      const range = getEndlessFillExtraRange(baseTemplate(on.trainer), on.trainer.getPartyTemplate());
      cleanUp(on);
      const spy = vi.spyOn(Trainer.prototype, "getEndlessStrongExtraIndex").mockReturnValue(undefined);
      let off: ReturnType<typeof buildTrainerBattle>;
      try {
        off = buildTrainerBattle(type, TrainerVariant.DEFAULT, wave, "p0", options);
      } finally {
        spy.mockRestore();
      }
      cleanUp(off);
      const extras = (members: MemberSummary[]) => members.slice(range.start, range.start + range.count);
      // Without the rule no extra is strong and the ace, last, is
      expect(range.start + range.count).toBe(off.members.length - 1);
      expect(extras(off.members).some(isStrong)).toBe(false);
      expect(off.members.at(-1)?.species).toBe(rest.ace);
      // With it the ace stays, and the strong extra is of another line
      expect(on.members.at(-1)?.species).toBe(rest.ace);
      expect(extras(on.members).some(isStrong)).toBe(true);
      expect(on.members.slice(0, -1).filter(m => sameLine(m.species, rest.ace))).toEqual([]);
      expect(on.members.slice(0, range.start)).toEqual(off.members.slice(0, range.start));
    });

    // Local fork (2026-11-08), review fix: a specialist went to an outside species of its specialty type before the
    // strong species of its own pool (a Baker whose Volcarona was out got an Arcanine or a Magmortar)
    it("takes a specialist's strong extra from its own pool before an outside species of its type", async () => {
      await startQuietRun(GameModes.ENDLESS, 300);
      const config = trainerConfigs[TrainerType.BAKER];
      const ownStrong = getTrainerStrongExtraPool(config);
      // Baker's Fire specialty only sets Rotom's form; its own strong species are Snorlax, Blissey, Ursaluna, Hydrapple
      // and the one Fire type, Volcarona
      expect(ownStrong.filter(id => speciesDataRegistry.getSpecies(id).isOfType(config.specialtyType))).toEqual([
        SpeciesId.VOLCARONA,
      ]);
      const original = config.partyMemberFuncs[0];
      config.partyMemberFuncs[0] = getRandomPartyMemberFunc([SpeciesId.VOLCARONA]);
      let rerolled = 0;
      const cases = [300, 560].flatMap(wave => Array.from({ length: SEEDS }, (_, s) => ({ wave, s })));
      try {
        for (const { wave, s } of cases) {
          const label = `wave ${wave} seed ${s}`;
          const both = buildBoth(TrainerType.BAKER, TrainerVariant.DEFAULT, wave, `baker-${s}`);
          expect(both.on[0].species, label).toBe(SpeciesId.VOLCARONA);
          const strongExtras = both.extras(both.on).filter(isStrong);
          expect(strongExtras.length, label).toBeGreaterThan(0);
          for (const m of strongExtras) {
            expect(ownStrong, `${label}: ${SpeciesId[m.species]}`).toContain(m.species);
            expect(m.species, label).not.toBe(SpeciesId.VOLCARONA);
          }
          rerolled += both.rerolled ? 1 : 0;
        }
      } finally {
        config.partyMemberFuncs[0] = original;
      }
      expect(rerolled).toBeGreaterThan(0);
    });

    // Local fork (2026-11-08), review fix: a re-roll from the slot's own source gives up on the duplicate check after its
    // retries, and such a Pokémon was taken as the strong extra
    it("never repeats a line with the strong extra, even where its source re-roll gives up on the duplicate check", async () => {
      await startQuietRun(GameModes.ENDLESS, 300);
      const funcs = trainerConfigs[TrainerType.TWINS].partyMemberFuncs;
      const original = funcs[0];
      // The first Twin's function gives Snorlax every time but for the extra's own first roll, a weak Furret
      const snorlax = getRandomPartyMemberFunc([SpeciesId.SNORLAX]);
      const sentret = getRandomPartyMemberFunc([SpeciesId.SENTRET]);
      let calls = 0;
      funcs[0] = (...args) => (++calls === 2 ? sentret(...args) : snorlax(...args));
      try {
        for (let s = 0; s < 2; s++) {
          calls = 0;
          const label = `seed ${s}`;
          const built = buildTrainerBattle(TrainerType.TWINS, TrainerVariant.DOUBLE, 100, `dup-${s}`);
          expect(built.members, label).toHaveLength(3);
          expect(built.members[0].species, label).toBe(SpeciesId.SNORLAX);
          const extra = built.members[2];
          expect(isStrong(extra), `${label}: ${SpeciesId[extra.species]}`).toBe(true);
          expect(sameLine(extra.species, SpeciesId.SNORLAX), label).toBe(false);
          expect(extra.trainerSlot, label).toBe(TrainerSlot.TRAINER);
          cleanUp(built);
        }
      } finally {
        funcs[0] = original;
      }
    }, 120_000);
  });

  // Local fork (2026-11-09), the user: "원래도 엘리트 트레이너였던 녀석들은 어느정도 웨이브 지나면 전설 허용룰로 하죠". From
  // Endless wave 300 the elite trainers (Ace Trainer, Snow Ace Trainer and their Ace Duo pairs) make sure their party has
  // one strong member, legend group allowed
  describe("elite trainers' legend rule", () => {
    const ELITE_SAMPLE = [
      { name: "Ace Trainer", type: TrainerType.ACE_TRAINER, variant: TrainerVariant.DEFAULT },
      { name: "Ace Trainer Female", type: TrainerType.ACE_TRAINER, variant: TrainerVariant.FEMALE },
      { name: "Ace Duo", type: TrainerType.ACE_TRAINER, variant: TrainerVariant.DOUBLE },
      { name: "Snow Ace Trainer", type: TrainerType.SNOW_ACE_TRAINER, variant: TrainerVariant.DEFAULT },
      { name: "Snow Ace Duo", type: TrainerType.SNOW_ACE_TRAINER, variant: TrainerVariant.DOUBLE },
    ];
    const ELITE_WAVES = [299, 300, 560, 1000];
    /** Biomes the seeds go through: few strong species (Town), legendaries in the boss tiers (Volcano, Sea), others */
    const ELITE_BIOMES = [BiomeId.TOWN, BiomeId.VOLCANO, BiomeId.SEA, BiomeId.FOREST, BiomeId.MOUNTAIN];
    /** The strong species of Volcano's pools, boss tiers included */
    const VOLCANO_STRONG = [
      SpeciesId.ARCANINE,
      SpeciesId.MAGMORTAR,
      SpeciesId.VOLCARONA,
      SpeciesId.HISUI_ARCANINE,
      SpeciesId.MOLTRES,
      SpeciesId.HEATRAN,
      SpeciesId.VOLCANION,
      SpeciesId.CHI_YU,
      SpeciesId.RESHIRAM,
    ];

    /** Strong under the elite rule: the legend group counts */
    function isStrongAny(m: MemberSummary): boolean {
      return m.bst >= STRONG_EXTRA_MIN_BST;
    }

    function sameLine(a: SpeciesId, b: SpeciesId): boolean {
      const lineOf = (s: SpeciesId) => [s, ...speciesDataRegistry.getPrevolutionChain(s)];
      return lineOf(a).includes(b) || lineOf(b).includes(a);
    }

    /** Pools of one tier each, the rest empty */
    function poolsOf(entries: Partial<Record<BiomePoolTier, SpeciesId[]>>): ArenaPokemonPools {
      const pools = {} as Record<BiomePoolTier, readonly SpeciesId[]>;
      for (const tier of Object.values(BiomePoolTier).filter((t): t is BiomePoolTier => typeof t === "number")) {
        pools[tier] = entries[tier] ?? [];
      }
      return pools;
    }

    /** The same battle with the rule on and off (the elite slot reported as none), the slot read with the rule on. */
    function buildEliteBoth(type: TrainerType, variant: TrainerVariant, wave: number, seed: string) {
      const on = buildTrainerBattle(type, variant, wave, seed);
      const target = on.trainer.getEndlessEliteStrongIndex();
      cleanUp(on);
      const spy = vi.spyOn(Trainer.prototype, "getEndlessEliteStrongIndex").mockReturnValue(undefined);
      let off: ReturnType<typeof buildTrainerBattle>;
      try {
        off = buildTrainerBattle(type, variant, wave, seed);
      } finally {
        spy.mockRestore();
      }
      cleanUp(off);
      return { on: on.members, off: off.members, target, double: on.double };
    }

    it("covers the trainers called 엘리트 트레이너 / 엘리트 콤비, in Endless from wave 300", async () => {
      await startQuietRun(GameModes.ENDLESS, 300);
      expect(ENDLESS_ELITE_LEGEND_WAVE).toBe(300);
      expect(ENDLESS_ELITE_TRAINER_TYPES).toEqual([TrainerType.ACE_TRAINER, TrainerType.SNOW_ACE_TRAINER]);
      for (const type of ENDLESS_ELITE_TRAINER_TYPES) {
        expect(isEndlessEliteLegendBattle(type, undefined)).toBe(false);
        expect(isEndlessEliteLegendBattle(type, 299)).toBe(false);
        expect(isEndlessEliteLegendBattle(type, 300)).toBe(true);
        expect(isEndlessEliteLegendBattle(type, 1000)).toBe(true);
      }
      for (const type of [TrainerType.VETERAN, TrainerType.YOUNGSTER, TrainerType.BREEDER]) {
        expect(isEndlessEliteLegendBattle(type, 560)).toBe(false);
      }
      // A legend-group pick is possible: the list with the legend group has legendaries, sub-legendaries, Ultra Beasts,
      // mythicals and Paradox species; the event-only species stay out; the list without it is unchanged
      const withLegends = getStrongExtraSpecies(true);
      for (const id of [
        SpeciesId.MEWTWO,
        SpeciesId.HEATRAN,
        SpeciesId.KARTANA,
        SpeciesId.DARKRAI,
        SpeciesId.GREAT_TUSK,
        SpeciesId.IRON_VALIANT,
      ]) {
        expect(withLegends, SpeciesId[id]).toContain(id);
      }
      for (const id of [SpeciesId.ETERNATUS, SpeciesId.ARCEUS, SpeciesId.MEW, SpeciesId.BLOODMOON_URSALUNA]) {
        expect(withLegends, SpeciesId[id]).not.toContain(id);
      }
      expect(withLegends).toEqual(expect.arrayContaining([...getStrongExtraSpecies()]));
      for (const id of getStrongExtraSpecies()) {
        const species = speciesDataRegistry.getSpecies(id);
        expect(species.legendary || species.subLegendary || species.mythical, SpeciesId[id]).toBe(false);
      }
      // The biome's own strong species include the legendaries of its boss tiers
      game.scene.newArena(BiomeId.VOLCANO);
      expect(getStrongPoolSpecies(game.scene.arena.getForkPokemonPools())).toEqual(VOLCANO_STRONG);
      // Local fork (2026-11-09): the pools are the biome's for the time of day of the battle's wave (waves 15 apart
      // never share one), built from the biome data rather than read from the wild pools, one object per time of day
      const { arena } = game.scene;
      const timesOfDay = new Set<TimeOfDay>();
      for (const wave of [300, 315]) {
        const built = buildTrainerBattle(TrainerType.ACE_TRAINER, TrainerVariant.DEFAULT, wave, "pools", {
          generate: false,
        });
        const pools = arena.getForkPokemonPools();
        expect(arena.getForkPokemonPools()).toBe(pools);
        const timeOfDay = arena.getTimeOfDay();
        timesOfDay.add(timeOfDay);
        for (const [tier, pool] of Object.entries(allBiomes.get(BiomeId.VOLCANO).pokemonPool)) {
          expect(pools[Number(tier) as BiomePoolTier], `wave ${wave} tier ${tier}`).toEqual([
            ...pool[TimeOfDay.ALL],
            ...pool[timeOfDay],
          ]);
        }
        cleanUp(built);
      }
      expect(timesOfDay.size).toBe(2);
    });

    it.each([
      { mode: GameModes.ENDLESS, seeds: 5 },
      { mode: GameModes.SPLICED_ENDLESS, seeds: 2 },
    ])(
      "$mode: one strong member per party from wave 300, legend group allowed, nothing else changed",
      async ({ mode, seeds }) => {
        await startQuietRun(mode, 300);
        let kept = 0;
        let repicked = 0;
        let legends = 0;
        let volcanoChecks = 0;
        for (let s = 0; s < seeds; s++) {
          // Each seed in its own biome
          const biome = ELITE_BIOMES[s % ELITE_BIOMES.length];
          game.scene.newArena(biome);
          for (const wave of ELITE_WAVES) {
            for (const { type, variant } of ELITE_SAMPLE) {
              const label = `${TrainerType[type]} ${TrainerVariant[variant]} wave ${wave} seed ${s} biome ${biome}`;
              const { on, off, target, double } = buildEliteBoth(type, variant, wave, `elite-${s}`);
              expect(on, label).toHaveLength(MAX_TRAINER_PARTY_SIZE);
              expect(off, label).toHaveLength(MAX_TRAINER_PARTY_SIZE);
              // Their own filter keeps the legend group out of their stock parties
              expect(
                off.filter(m => m.special),
                label,
              ).toEqual([]);
              if (mode === GameModes.SPLICED_ENDLESS) {
                for (const m of on) {
                  expect(m.fusion, label).toBeDefined();
                }
              }
              if (wave < ENDLESS_ELITE_LEGEND_WAVE) {
                expect(target, label).toBeUndefined();
                expect(on, label).toEqual(off);
                continue;
              }
              expect(target, label).toBe(MAX_TRAINER_PARTY_SIZE - 1);
              expect(on.some(isStrongAny), label).toBe(true);
              if (off.some(isStrongAny)) {
                // A member was strong already: the very same party, ids included, so nothing more was drawn
                kept++;
                expect(on, label).toEqual(off);
                continue;
              }
              repicked++;
              if (target == null) {
                continue;
              }
              // Only the last member changes: one pick for the party, a pair's shared one included
              expect(on.slice(0, target), label).toEqual(off.slice(0, target));
              const pick = on[target];
              const pickLabel = `${label}: ${SpeciesId[pick.species]}`;
              expect(isStrongAny(pick), pickLabel).toBe(true);
              expect(pick.evolvable, pickLabel).toEqual([]);
              expect(pick.level, pickLabel).toBe(off[target].level);
              expect(pick.trainerSlot, pickLabel).toBe(double ? TrainerSlot.TRAINER_PARTNER : TrainerSlot.TRAINER);
              for (const [i, m] of on.entries()) {
                if (i !== target) {
                  expect(sameLine(m.species, pick.species), `${pickLabel} vs slot ${i}`).toBe(false);
                }
              }
              if (pick.special) {
                legends++;
              }
              // The biome's own strong species come first while one is in no other member's line
              if (biome === BiomeId.VOLCANO) {
                const free = VOLCANO_STRONG.filter(id => !on.some((m, i) => i !== target && sameLine(m.species, id)));
                if (free.length > 0) {
                  volcanoChecks++;
                  expect(VOLCANO_STRONG, pickLabel).toContain(pick.species);
                }
              }
              // The same seed gives the same party
              if (s === 0) {
                const again = buildTrainerBattle(type, variant, wave, `elite-${s}`);
                expect(again.members, label).toEqual(on);
                cleanUp(again);
              }
            }
          }
        }
        expect(repicked).toBeGreaterThan(0);
        expect(kept).toBeGreaterThan(0);
        expect(legends).toBeGreaterThan(0);
        expect(volcanoChecks).toBeGreaterThan(0);
      },
      300_000,
    );

    it("takes the biome's legendaries from its boss tiers, then a strong species of no type the party has", async () => {
      await startQuietRun(GameModes.ENDLESS, 300);
      const arenaPools = vi.spyOn(game.scene.arena, "getForkPokemonPools");
      let heatran = 0;
      let unclashed = 0;
      try {
        // Pools whose one strong species is a boss-tier legendary: every pick is that legendary
        arenaPools.mockReturnValue(poolsOf({ [BiomePoolTier.BOSS_SUPER_RARE]: [SpeciesId.HEATRAN] }));
        for (let s = 0; s < 8; s++) {
          const { on, off, target } = buildEliteBoth(TrainerType.ACE_TRAINER, TrainerVariant.DEFAULT, 560, `boss-${s}`);
          if (target == null || off.some(isStrongAny)) {
            expect(on).toEqual(off);
            continue;
          }
          heatran++;
          expect(on[target].species, `seed ${s}`).toBe(SpeciesId.HEATRAN);
          expect(on[target].special).toBe(true);
        }
        // No strong species in the pools: a strong species sharing no type with the other members
        arenaPools.mockReturnValue(poolsOf({}));
        for (let s = 0; s < 8; s++) {
          const { on, off, target } = buildEliteBoth(TrainerType.ACE_TRAINER, TrainerVariant.DOUBLE, 560, `type-${s}`);
          if (target == null || off.some(isStrongAny)) {
            continue;
          }
          const others = on.filter((_, i) => i !== target);
          const otherTypes = new Set(others.flatMap(m => m.types));
          const clashes = (id: SpeciesId) => {
            const species = speciesDataRegistry.getSpecies(id);
            return otherTypes.has(species.type1) || (species.type2 != null && otherTypes.has(species.type2));
          };
          const free = getStrongExtraSpecies(true).filter(
            id => !clashes(id) && !others.some(m => sameLine(m.species, id)),
          );
          const pick = on[target];
          expect(isStrongAny(pick), `seed ${s}`).toBe(true);
          if (free.length > 0) {
            unclashed++;
            expect(clashes(pick.species), `seed ${s}: ${SpeciesId[pick.species]}`).toBe(false);
          }
        }
      } finally {
        arenaPools.mockRestore();
      }
      expect(heatran).toBeGreaterThan(0);
      expect(unclashed).toBeGreaterThan(0);
    });

    it("never gives other trainers a legend-group strong extra at wave 560", async () => {
      await startQuietRun(GameModes.ENDLESS, 300);
      game.scene.newArena(BiomeId.VOLCANO);
      let strongExtras = 0;
      for (const [type, variant] of [
        [TrainerType.VETERAN, TrainerVariant.DEFAULT],
        [TrainerType.VETERAN, TrainerVariant.DOUBLE],
        [TrainerType.YOUNGSTER, TrainerVariant.DEFAULT],
      ] as const) {
        for (let s = 0; s < 6; s++) {
          const built = buildTrainerBattle(type, variant, 560, `other-${s}`);
          const label = `${TrainerType[type]} ${TrainerVariant[variant]} seed ${s}`;
          expect(built.trainer.getEndlessEliteStrongIndex(), label).toBeUndefined();
          expect(
            built.members.filter(m => m.special),
            label,
          ).toEqual([]);
          const range = getEndlessFillExtraRange(baseTemplate(built.trainer), built.trainer.getPartyTemplate());
          if (range.count > 0) {
            const extras = built.members.slice(range.start, range.start + range.count);
            expect(
              extras.some(m => m.bst >= STRONG_EXTRA_MIN_BST),
              label,
            ).toBe(true);
            strongExtras++;
          }
          cleanUp(built);
        }
      }
      expect(strongExtras).toBeGreaterThan(0);
    });

    // Local fork (2026-11-09), review fix: the party's size is the battle's level count. At the first battle of a run that
    // starts on wave 300, `Battle` sizes the levels with the template of wave 1 (`getWavePartyTemplate` reads the battle
    // that was current then: none), three members filled up to five, while the members are rolled with the six-member
    // template; the rule used to aim at a sixth member that is never rolled, and this party ended without a strong one
    it("gives the strong pick to the party's last member when the battle was sized with another wave's template", async () => {
      game.override
        .battleType(BattleType.TRAINER)
        .randomTrainer({ trainerType: TrainerType.ACE_TRAINER, trainerVariant: TrainerVariant.DEFAULT });
      const eliteRolls = vi.spyOn(
        Trainer.prototype as unknown as { getEndlessEliteRolls: () => Generator },
        "getEndlessEliteRolls",
      );
      await startRun(GameModes.ENDLESS, ENDLESS_ELITE_LEGEND_WAVE);
      const repicks = eliteRolls.mock.calls.length;
      eliteRolls.mockRestore();

      const { currentBattle } = game.scene;
      const party = game.scene.getEnemyParty().map(summarize);
      expect(currentBattle.trainer?.config.trainerType).toBe(TrainerType.ACE_TRAINER);
      expect(currentBattle.enemyLevels).toHaveLength(party.length);
      expect(party.length).toBeLessThan(currentBattle.trainer?.getPartyTemplate().size ?? 0);
      expect(currentBattle.trainer?.getEndlessEliteStrongIndex()).toBe(party.length - 1);
      // This seed's stock party has no strong member, so the last one is re-picked
      expect(repicks).toBe(1);
      expect(party.some(m => m.bst >= STRONG_EXTRA_MIN_BST)).toBe(true);
    });

    it("leaves Classic Ace Trainers as they were", async () => {
      await startQuietRun(GameModes.CLASSIC, 150);
      for (const variant of [TrainerVariant.DEFAULT, TrainerVariant.DOUBLE]) {
        for (let s = 0; s < 4; s++) {
          const label = `${TrainerVariant[variant]} seed ${s}`;
          const { on, off, target } = buildEliteBoth(TrainerType.ACE_TRAINER, variant, 150, `classic-${s}`);
          expect(target, label).toBeUndefined();
          expect(on, label).toEqual(off);
          expect(
            on.filter(m => m.special),
            label,
          ).toEqual([]);
        }
      }
    });
  });

  it("rolls the same party from the same seed", async () => {
    await startQuietRun(GameModes.ENDLESS, 300);
    for (const [type, variant] of [
      [TrainerType.RUIN_MANIAC, TrainerVariant.DEFAULT],
      [TrainerType.ACE_TRAINER, TrainerVariant.DOUBLE],
    ] as const) {
      const first = buildTrainerBattle(type, variant, 560, "same");
      const firstParty = first.members;
      cleanUp(first);
      const second = buildTrainerBattle(type, variant, 560, "same");
      expect(second.members).toEqual(firstParty);
      cleanUp(second);
      const other = buildTrainerBattle(type, variant, 560, "different");
      expect(other.members).not.toEqual(firstParty);
      cleanUp(other);
    }
  });

  it("keeps a filled trainer party through a save and reload", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.FISHERMAN, trainerVariant: TrainerVariant.DEFAULT });
    await startRun(GameModes.ENDLESS, 412);

    const { currentBattle } = game.scene;
    expect(currentBattle.battleType).toBe(BattleType.TRAINER);
    expect(currentBattle.trainer?.config.trainerType).toBe(TrainerType.FISHERMAN);
    expect(currentBattle.trainer?.forkEndlessFillWave).toBe(412);
    const before = game.scene.getEnemyParty().map(summarize);
    expect(before).toHaveLength(6);
    for (const m of before) {
      expect(m.evolvable).toEqual([]);
    }

    // Serialize the session the way the save does and parse it back the way the load does
    const { gameData } = game.scene;
    const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
    game.reload["sessionData"] = gameData.parseSessionData(json);
    await game.reload.reloadSession();

    expect(game.scene.currentBattle.waveIndex).toBe(412);
    expect(game.scene.currentBattle.trainer?.config.trainerType).toBe(TrainerType.FISHERMAN);
    expect(game.scene.getEnemyParty().map(summarize)).toEqual(before);
  });

  // Local fork (2026-11-09): an elite trainer's party under the legend rule comes back the same after a reload
  it("keeps an elite trainer's party through a save and reload", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER, trainerVariant: TrainerVariant.DEFAULT });
    // Local fork (2026-11-09): this party goes through the re-pick (its stock roll had no strong member)
    const eliteRolls = vi.spyOn(
      Trainer.prototype as unknown as { getEndlessEliteRolls: () => Generator },
      "getEndlessEliteRolls",
    );
    await startRun(GameModes.ENDLESS, 560);
    expect(eliteRolls).toHaveBeenCalledTimes(1);
    eliteRolls.mockRestore();

    const { currentBattle } = game.scene;
    expect(currentBattle.trainer?.config.trainerType).toBe(TrainerType.ACE_TRAINER);
    expect(currentBattle.trainer?.getEndlessEliteStrongIndex()).toBe(MAX_TRAINER_PARTY_SIZE - 1);
    const before = game.scene.getEnemyParty().map(summarize);
    expect(before).toHaveLength(MAX_TRAINER_PARTY_SIZE);
    expect(before.some(m => m.bst >= STRONG_EXTRA_MIN_BST)).toBe(true);

    const { gameData } = game.scene;
    const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
    game.reload["sessionData"] = gameData.parseSessionData(json);
    await game.reload.reloadSession();

    expect(game.scene.currentBattle.waveIndex).toBe(560);
    expect(game.scene.getEnemyParty().map(summarize)).toEqual(before);
  });
});
