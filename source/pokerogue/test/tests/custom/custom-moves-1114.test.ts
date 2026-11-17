// Local fork (2026-11-14): custom moves, stage 2. Tests of the effects and learnsets of the four custom moves
// (tools/drive/custom_moves_1114/design_spec.json "moves", each "시험할 것" list): 승화 / Sublimation (Hydro Steam
// reversed), 정원가꾸기 / Gardening (the Garden on the user's side), 쇄빙참 / Icebreaker (x2 against a frozen target, then
// thaws it) and 뒤통수치기 / Blindside (super effective on Fighting). The Garden's own effects, Gardener and Turnabout are
// tested in custom-garden / custom-gardener / custom-turnabout.test.ts, the scaffold in custom-moves-1114-scaffold.
import { __INTERNAL_TEST_EXPORTS } from "#app/ai/ai-moveset-gen";
import { EVOLVE_MOVE } from "#app/constants";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { getPokemonNameWithAffix } from "#app/messages";
import { speciesEggMoves } from "#balance/egg-moves";
import { tmPoolTiers } from "#balance/tm-pool-tiers";
import { allMoves } from "#data/data-lists";
import { getStatusEffectHealText } from "#data/status-effect";
import { TerrainType } from "#data/terrain";
import { getTypeDamageMultiplierColor, type TypeDamageMultiplier } from "#data/type";
import { getWeatherMultiplierForMove } from "#data/weather";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { Button } from "#enums/buttons";
import { Challenges } from "#enums/challenges";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { TypeHints } from "#enums/type-hints";
import { UiMode } from "#enums/ui-mode";
import { WeatherType } from "#enums/weather-type";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";
import { isMasterTmMove } from "#modifiers/custom-consumables";
import { invalidMetronomeMoves, invalidSleepTalkMoves } from "#moves/invalid-moves";
import { PokemonMove } from "#moves/pokemon-move";
import { GameManager } from "#test/framework/game-manager";
import type { MockText } from "#test/mocks/mocks-container/mock-text";
import { FightUiHandler } from "#ui/fight-ui-handler";
import i18next from "i18next";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const CUSTOM_MOVES = [MoveId.SUBLIMATION, MoveId.GARDENING, MoveId.ICEBREAKER, MoveId.BLINDSIDE] as const;

/** Every level-up learner in design_spec.json, `EVOLVE_MOVE` (0) for "진화할 때" */
const LEARNERS: readonly [species: SpeciesId, level: number, move: MoveId][] = [
  // 승화 (Sublimation)
  [SpeciesId.SLUGMA, 31, MoveId.SUBLIMATION],
  [SpeciesId.MAGCARGO, 31, MoveId.SUBLIMATION],
  [SpeciesId.NUMEL, 30, MoveId.SUBLIMATION],
  [SpeciesId.CAMERUPT, 30, MoveId.SUBLIMATION],
  [SpeciesId.TORKOAL, 30, MoveId.SUBLIMATION],
  [SpeciesId.CARKOL, 30, MoveId.SUBLIMATION],
  [SpeciesId.COALOSSAL, 30, MoveId.SUBLIMATION],
  [SpeciesId.TURTONATOR, 28, MoveId.SUBLIMATION],
  [SpeciesId.SCOVILLAIN, 35, MoveId.SUBLIMATION],
  [SpeciesId.VOLCANION, 42, MoveId.SUBLIMATION],
  // 정원가꾸기 (Gardening)
  [SpeciesId.ODDISH, 30, MoveId.GARDENING],
  [SpeciesId.GLOOM, 34, MoveId.GARDENING],
  [SpeciesId.VILEPLUME, EVOLVE_MOVE, MoveId.GARDENING],
  [SpeciesId.BELLOSSOM, EVOLVE_MOVE, MoveId.GARDENING],
  [SpeciesId.SUNKERN, 25, MoveId.GARDENING],
  [SpeciesId.SUNFLORA, 25, MoveId.GARDENING],
  [SpeciesId.FLABEBE, 26, MoveId.GARDENING],
  [SpeciesId.FLOETTE, 29, MoveId.GARDENING],
  [SpeciesId.FLORGES, EVOLVE_MOVE, MoveId.GARDENING],
  [SpeciesId.COMFEY, 36, MoveId.GARDENING],
  [SpeciesId.SMOLIV, 25, MoveId.GARDENING],
  [SpeciesId.DOLLIV, 25, MoveId.GARDENING],
  [SpeciesId.ARBOLIVA, 25, MoveId.GARDENING],
  // 쇄빙참 (Icebreaker)
  [SpeciesId.SNEASEL, 30, MoveId.ICEBREAKER],
  [SpeciesId.WEAVILE, 30, MoveId.ICEBREAKER],
  [SpeciesId.CUBCHOO, 27, MoveId.ICEBREAKER],
  [SpeciesId.BEARTIC, 27, MoveId.ICEBREAKER],
  [SpeciesId.FRIGIBAX, 34, MoveId.ICEBREAKER],
  [SpeciesId.ARCTIBAX, 34, MoveId.ICEBREAKER],
  [SpeciesId.BAXCALIBUR, 34, MoveId.ICEBREAKER],
  [SpeciesId.OSHAWOTT, 27, MoveId.ICEBREAKER],
  [SpeciesId.DEWOTT, 30, MoveId.ICEBREAKER],
  [SpeciesId.SAMUROTT, 30, MoveId.ICEBREAKER],
  [SpeciesId.HISUI_SAMUROTT, 30, MoveId.ICEBREAKER],
  // 뒤통수치기 (Blindside)
  [SpeciesId.SCRAGGY, 26, MoveId.BLINDSIDE],
  [SpeciesId.SCRAFTY, 26, MoveId.BLINDSIDE],
  [SpeciesId.PANCHAM, 26, MoveId.BLINDSIDE],
  [SpeciesId.PANGORO, 26, MoveId.BLINDSIDE],
  [SpeciesId.PURRLOIN, 25, MoveId.BLINDSIDE],
  [SpeciesId.LIEPARD, 25, MoveId.BLINDSIDE],
  [SpeciesId.MASCHIFF, 28, MoveId.BLINDSIDE],
  [SpeciesId.MABOSSTIFF, 28, MoveId.BLINDSIDE],
  [SpeciesId.OBSTAGOON, 38, MoveId.BLINDSIDE],
];

/** Every [species, move] pair with one of the custom moves in its level-up data (base and form-specific lists) */
function findCustomLevelMoves(): [species: SpeciesId, level: number, move: MoveId][] {
  const found: [SpeciesId, number, MoveId][] = [];
  for (const species of speciesDataRegistry.getAllSpecies()) {
    const data = speciesDataRegistry.getSpeciesData(species.speciesId);
    const lists = [data.levelMoves, ...Object.values(data.formLevelMoves ?? {})];
    for (const list of lists) {
      for (const [level, move] of list) {
        if ((CUSTOM_MOVES as readonly MoveId[]).includes(move)) {
          found.push([species.speciesId, level, move]);
        }
      }
    }
  }
  return found;
}

describe("Custom moves 2026-11-14", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH);
  });

  /** The damage `move` would deal now, as the AI and the damage forecast see it (no critical hit, max roll) */
  function forecast(source: Pokemon, target: Pokemon, move: MoveId): number {
    return target.getAttackDamage({ source, move: allMoves[move], simulated: true }).damage;
  }

  describe("learnsets and pools", () => {
    it.each(
      LEARNERS.map(([species, level, move]) => ({
        name: `${SpeciesId[species]} ${MoveId[move]}`,
        species,
        level,
        move,
      })),
    )("$name at level $level (0 = on evolution)", ({ species, level, move }) => {
      const levelMoves = speciesDataRegistry.getLevelMoves(species);
      expect(levelMoves.filter(([, m]) => m === move)).toEqual([[level, move]]);
    });

    it("has no learner outside the spec and none at level 1-5 (kept out of the starter move pick)", () => {
      const found = findCustomLevelMoves();
      expect(found).toEqual(expect.arrayContaining(LEARNERS.map(l => [...l])));
      expect(found).toHaveLength(LEARNERS.length);
      for (const [species, level, move] of found) {
        expect(level === EVOLVE_MOVE || level >= 6, `${SpeciesId[species]} ${MoveId[move]} ${level}`).toBe(true);
      }
    });

    it("keeps each level-up list in level order around the new rows", () => {
      for (const [species] of LEARNERS) {
        const levels = speciesDataRegistry.getSpeciesData(species).levelMoves.map(([level]) => level);
        expect(levels, SpeciesId[species]).toEqual([...levels].sort((a, b) => a - b));
      }
    });

    it("leaves out the forms and relatives the spec excludes", () => {
      const excluded: [SpeciesId, MoveId][] = [
        [SpeciesId.HISUI_SNEASEL, MoveId.ICEBREAKER],
        [SpeciesId.GALAR_ZIGZAGOON, MoveId.BLINDSIDE],
        [SpeciesId.GALAR_LINOONE, MoveId.BLINDSIDE],
        [SpeciesId.KINGAMBIT, MoveId.BLINDSIDE],
        [SpeciesId.URSHIFU, MoveId.BLINDSIDE],
        [SpeciesId.CAPSAKID, MoveId.SUBLIMATION],
        [SpeciesId.CHARIZARD, MoveId.SUBLIMATION],
        [SpeciesId.ORICORIO, MoveId.SUBLIMATION],
        [SpeciesId.RILLABOOM, MoveId.GARDENING],
      ];
      for (const [species, move] of excluded) {
        expect(
          speciesDataRegistry.getLevelMoves(species).some(([, m]) => m === move),
          `${SpeciesId[species]} ${MoveId[move]}`,
        ).toBe(false);
      }
    });

    it("gives Gardening to every Flabébé / Floette / Florges form (Eternal Flower Floette included)", () => {
      for (const species of [SpeciesId.FLABEBE, SpeciesId.FLOETTE, SpeciesId.FLORGES]) {
        const forms = speciesDataRegistry.getSpecies(species).forms;
        expect(forms.length, SpeciesId[species]).toBeGreaterThan(1);
        forms.forEach((form, index) => {
          expect(
            speciesDataRegistry.getLevelMoves(species, index).some(([, m]) => m === MoveId.GARDENING),
            `${SpeciesId[species]} ${form.formKey}`,
          ).toBe(true);
        });
      }
    });

    it("are in no TM drop, species TM list or egg move list", () => {
      for (const move of CUSTOM_MOVES) {
        expect(tmPoolTiers[move], MoveId[move]).toBeUndefined();
        expect(
          Object.values(speciesEggMoves).some(eggMoves => (eggMoves as readonly MoveId[]).includes(move)),
          MoveId[move],
        ).toBe(false);
      }
      for (const species of speciesDataRegistry.getAllSpecies()) {
        const data = speciesDataRegistry.getSpeciesData(species.speciesId);
        const tms = [...data.tms, ...Object.values(data.formTms ?? {}).flat()];
        for (const move of CUSTOM_MOVES) {
          expect(tms.includes(move), `${SpeciesId[species.speciesId]} ${MoveId[move]}`).toBe(false);
        }
      }
    });

    it("are implemented, so the Master TM, Metronome and Sleep Talk can use them (spec: left callable)", () => {
      for (const move of CUSTOM_MOVES) {
        expect(allMoves[move].isUnimplemented, MoveId[move]).toBe(false);
        expect(allMoves[move].name, MoveId[move]).not.toContain("(N)");
        expect(isMasterTmMove(move), MoveId[move]).toBe(true);
        expect(invalidMetronomeMoves.has(move), MoveId[move]).toBe(false);
        expect(invalidSleepTalkMoves.has(move), MoveId[move]).toBe(false);
      }
    });

    it("lets a Gloom evolving into Vileplume learn Gardening on evolution", async () => {
      await game.classicMode.startBattle(SpeciesId.VILEPLUME);
      const vileplume = game.field.getPlayerPokemon();
      const evolutionMoves = vileplume
        .getLevelMoves({ startingLevel: vileplume.level + 1, includeEvolutionMoves: true })
        .filter(([level]) => level === EVOLVE_MOVE)
        .map(([, move]) => move);
      expect(evolutionMoves).toContain(MoveId.GARDENING);
    });
  });

  describe("승화 (Sublimation)", () => {
    beforeEach(() => {
      game.override.moveset([MoveId.SUBLIMATION, MoveId.FLAMETHROWER]);
    });

    it.each<{ name: string; weather?: WeatherType; cloudNine?: boolean; sublimation: number; fire: number }>([
      { name: "Rain", weather: WeatherType.RAIN, sublimation: 1.5, fire: 0.5 },
      { name: "no weather", sublimation: 1, fire: 1 },
      { name: "Sun", weather: WeatherType.SUNNY, sublimation: 1.5, fire: 1.5 },
      { name: "Harsh Sunlight", weather: WeatherType.HARSH_SUN, sublimation: 1.5, fire: 1.5 },
      { name: "Sandstorm", weather: WeatherType.SANDSTORM, sublimation: 1, fire: 1 },
      { name: "Snow", weather: WeatherType.SNOW, sublimation: 1, fire: 1 },
      { name: "Rain under Cloud Nine", weather: WeatherType.RAIN, cloudNine: true, sublimation: 1, fire: 1 },
    ])(
      "deals x$sublimation in $name (a plain Fire move x$fire), same roll",
      async ({ weather, cloudNine, sublimation, fire }) => {
        if (weather != null) {
          game.override.weather(weather);
        }
        if (cloudNine) {
          game.override.enemyAbility(AbilityId.CLOUD_NINE);
        }
        await game.classicMode.startBattle(SpeciesId.VOLCANION);
        const player = game.field.getPlayerPokemon();
        const enemy = game.field.getEnemyPokemon();

        expect(getWeatherMultiplierForMove(player, allMoves[MoveId.SUBLIMATION])).toBe(sublimation);
        expect(getWeatherMultiplierForMove(player, allMoves[MoveId.FLAMETHROWER])).toBe(fire);

        // Same Pokémon, same roll: the damage with this weather against the damage with the weather cleared
        const withWeather = forecast(player, enemy, MoveId.SUBLIMATION);
        const savedWeather = game.scene.arena.weather;
        game.scene.arena.weather = null;
        const withoutWeather = forecast(player, enemy, MoveId.SUBLIMATION);
        game.scene.arena.weather = savedWeather;
        expect(withoutWeather).toBeGreaterThan(50);
        expect(withWeather / withoutWeather).toBeCloseTo(sublimation, 1);
      },
    );

    it("fails in Heavy Rain like any Fire attack, with the weather message and no damage", async () => {
      game.override.weather(WeatherType.HEAVY_RAIN);
      await game.classicMode.startBattle(SpeciesId.VOLCANION);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.move.select(MoveId.SUBLIMATION);
      await game.toEndOfTurn();

      expect(player).toHaveUsedMove({ move: MoveId.SUBLIMATION, result: MoveResult.FAIL });
      expect(game).toHaveShownMessage(i18next.t("weather:heavyRainEffectMessage"));
      expect(enemy).toHaveFullHp();
    });

    it.each([
      { name: "Sunbathe", ability: AbilityId.SUNBATHE },
      { name: "Mega Sol", ability: AbilityId.MEGA_SOL },
    ])("counts as Sun for a $name user in Rain: x1.5, not x4.5", async ({ ability }) => {
      game.override.weather(WeatherType.RAIN).ability(ability);
      await game.classicMode.startBattle(SpeciesId.VOLCANION);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(getWeatherMultiplierForMove(player, allMoves[MoveId.SUBLIMATION])).toBe(1.5);
      const inRain = forecast(player, enemy, MoveId.SUBLIMATION);
      // Same roll without the ability and without weather
      game.field.mockAbility(player, AbilityId.BALL_FETCH);
      const savedWeather = game.scene.arena.weather;
      game.scene.arena.weather = null;
      const plain = forecast(player, enemy, MoveId.SUBLIMATION);
      game.scene.arena.weather = savedWeather;
      expect(inRain / plain).toBeCloseTo(1.5, 1);
    });

    it("turned Ice-type by Frostfire: x1.5 in Rain", async () => {
      game.override.weather(WeatherType.RAIN).ability(AbilityId.FROSTFIRE);
      await game.classicMode.startBattle(SpeciesId.VOLCANION);
      const player = game.field.getPlayerPokemon();

      expect(player.getMoveType(allMoves[MoveId.SUBLIMATION])).toBe(PokemonType.ICE);
      expect(getWeatherMultiplierForMove(player, allMoves[MoveId.SUBLIMATION])).toBe(1.5);
    });

    it("turned Ice-type by Frostfire: x1 in Heavy Rain and does not fail", async () => {
      game.override.weather(WeatherType.HEAVY_RAIN).ability(AbilityId.FROSTFIRE);
      await game.classicMode.startBattle(SpeciesId.VOLCANION);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      expect(getWeatherMultiplierForMove(player, allMoves[MoveId.SUBLIMATION])).toBe(1);
      game.move.select(MoveId.SUBLIMATION);
      await game.toEndOfTurn();

      expect(player).toHaveUsedMove({ move: MoveId.SUBLIMATION, result: MoveResult.SUCCESS });
      expect(game).not.toHaveShownMessage(i18next.t("weather:heavyRainEffectMessage"));
      expect(enemy).not.toHaveFullHp();
    });

    it("thaws a frozen target it hits", async () => {
      game.override.enemyStatusEffect(StatusEffect.FREEZE);
      await game.classicMode.startBattle(SpeciesId.VOLCANION);
      const enemy = game.field.getEnemyPokemon();

      game.move.select(MoveId.SUBLIMATION);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
      await game.phaseInterceptor.to("MoveEndPhase");

      expect(enemy).toHaveStatusEffect(StatusEffect.NONE);
      expect(game).toHaveShownMessage(getStatusEffectHealText(StatusEffect.FREEZE, getPokemonNameWithAffix(enemy)));
    });

    it("does not thaw its frozen user (no self-thaw), unlike Flame Wheel", async () => {
      game.override.statusEffect(StatusEffect.FREEZE).moveset([MoveId.SUBLIMATION, MoveId.FLAME_WHEEL]);
      await game.classicMode.startBattle(SpeciesId.VOLCANION);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.move.select(MoveId.SUBLIMATION);
      await game.toNextTurn();
      expect(player).toHaveStatusEffect(StatusEffect.FREEZE);
      expect(enemy).toHaveFullHp();

      // (control) a self-thawing Fire move does thaw it in the same setup
      game.move.select(MoveId.FLAME_WHEEL);
      await game.toEndOfTurn();
      expect(player).toHaveStatusEffect(StatusEffect.NONE);
    });

    it("deals exactly the damage the AI forecast (getAttackDamage) gives, in Rain", async () => {
      game.override.weather(WeatherType.RAIN);
      await game.classicMode.startBattle(SpeciesId.VOLCANION);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const expected = forecast(player, enemy, MoveId.SUBLIMATION);

      game.move.select(MoveId.SUBLIMATION);
      await game.toEndOfTurn();

      expect(enemy.getInverseHp()).toBe(expected);
    });

    describe("enemy moveset generation", () => {
      it("is boosted (x1.5), not halved, for a Drizzle user, while a plain Fire move is halved", async () => {
        await game.classicMode.startBattle(SpeciesId.VOLCANION);
        const player = game.field.getPlayerPokemon();
        const ratio = (move: MoveId): number => {
          game.field.mockAbility(player, AbilityId.BALL_FETCH);
          const plain = allMoves[move].calculateEffectivePower(player);
          game.field.mockAbility(player, AbilityId.DRIZZLE);
          return allMoves[move].calculateEffectivePower(player) / plain;
        };

        game.scene.movesetGenInProgress = true;
        try {
          expect(ratio(MoveId.SUBLIMATION)).toBeCloseTo(1.5);
          expect(ratio(MoveId.FLAMETHROWER)).toBeCloseTo(0.5);
        } finally {
          game.scene.movesetGenInProgress = false;
        }
      });

      it("keeps Rain Dance next to Sublimation, and drops it next to a plain Fire move", async () => {
        await game.classicMode.startBattle(SpeciesId.SLUGMA);
        const slugma = game.field.getPlayerPokemon();
        const { filterUselessMoves } = __INTERNAL_TEST_EXPORTS;

        slugma.moveset = [new PokemonMove(MoveId.RAIN_DANCE), new PokemonMove(MoveId.SUBLIMATION)];
        expect(filterUselessMoves(slugma, false)).toBe(false);
        expect(slugma.moveset.map(m => m.moveId)).toEqual([MoveId.RAIN_DANCE, MoveId.SUBLIMATION]);

        slugma.moveset = [new PokemonMove(MoveId.RAIN_DANCE), new PokemonMove(MoveId.FLAMETHROWER)];
        expect(filterUselessMoves(slugma, false)).toBe(true);
        expect(slugma.moveset.map(m => m.moveId)).toEqual([MoveId.FLAMETHROWER]);
      });
    });
  });

  describe("정원가꾸기 (Gardening)", () => {
    beforeEach(() => {
      game.override.moveset([MoveId.GARDENING, MoveId.SPLASH, MoveId.ENERGY_BALL]);
    });

    it("sets a 5-turn Garden on the user's side only, with the start message and, 5 turns later, the end message", async () => {
      await game.classicMode.startBattle(SpeciesId.FLORGES);
      const player = game.field.getPlayerPokemon();

      game.move.select(MoveId.GARDENING);
      await game.phaseInterceptor.to("MoveEndPhase");
      expect(player).toHaveUsedMove({ move: MoveId.GARDENING, result: MoveResult.SUCCESS });
      expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.PLAYER, turnCount: 5 });
      expect(game).not.toHaveArenaTag(ArenaTagType.GARDEN, ArenaTagSide.ENEMY);
      expect(game).toHaveShownMessage(i18next.t("arenaTag:gardenOnAddPlayer"));
      await game.toNextTurn();

      for (let left = 4; left >= 2; left--) {
        expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.PLAYER, turnCount: left });
        game.move.select(MoveId.SPLASH);
        await game.toNextTurn();
      }
      expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.PLAYER, turnCount: 1 });
      expect(game).not.toHaveShownMessage(i18next.t("arenaTag:gardenOnRemovePlayer"));

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(game).not.toHaveArenaTag(ArenaTagType.GARDEN);
      expect(game).toHaveShownMessage(i18next.t("arenaTag:gardenOnRemovePlayer"));
    });

    it("sets the Garden on the enemy's side when the enemy uses it", async () => {
      await game.classicMode.startBattle(SpeciesId.FLORGES);

      game.move.select(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.GARDENING);
      await game.toEndOfTurn();

      expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.ENEMY, turnCount: 4 });
      expect(game).not.toHaveArenaTag(ArenaTagType.GARDEN, ArenaTagSide.PLAYER);
      expect(game).toHaveShownMessage(i18next.t("arenaTag:gardenOnAddEnemy"));
    });

    it("fails while the user's side has a Garden, leaving its remaining turns as they were", async () => {
      await game.classicMode.startBattle(SpeciesId.FLORGES);
      const player = game.field.getPlayerPokemon();

      game.move.select(MoveId.GARDENING);
      await game.toNextTurn();
      expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.PLAYER, turnCount: 4 });

      game.textInterceptor.logs.splice(0);
      game.move.select(MoveId.GARDENING);
      await game.phaseInterceptor.to("MoveEndPhase");
      expect(player).toHaveUsedMove({ move: MoveId.GARDENING, result: MoveResult.FAIL });
      expect(game).toHaveShownMessage(i18next.t("battle:attackFailed"));
      expect(game).not.toHaveShownMessage(i18next.t("arenaTag:gardenOnAddPlayer"));
      expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.PLAYER, turnCount: 4 });
      await game.toEndOfTurn();
      expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.PLAYER, turnCount: 3 });
    });

    it("in a double battle, sets one Garden for both Pokémon on the user's side (one start message)", async () => {
      game.override.battleStyle("double");
      await game.classicMode.startBattle(SpeciesId.FLORGES, SpeciesId.BLISSEY);

      game.move.select(MoveId.GARDENING, BattlerIndex.PLAYER);
      game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
      await game.toEndOfTurn();

      expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.PLAYER, turnCount: 4 });
      expect(game).not.toHaveArenaTag(ArenaTagType.GARDEN, ArenaTagSide.ENEMY);
      const startText = i18next.t("arenaTag:gardenOnAddPlayer");
      expect(game.textInterceptor.logs.filter(log => log === startText)).toHaveLength(1);
    });

    it("still works when only the opposing side has a Garden", async () => {
      await game.classicMode.startBattle(SpeciesId.FLORGES);
      game.scene.arena.addTag(ArenaTagType.GARDEN, 3, undefined, 0, ArenaTagSide.ENEMY);

      game.move.select(MoveId.GARDENING);
      await game.phaseInterceptor.to("MoveEndPhase");

      expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.PLAYER, turnCount: 5 });
      expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.ENEMY, turnCount: 3 });
    });

    it.each([
      { stacks: 1, turns: 7 },
      { stacks: 2, turns: 9 },
    ])("lasts $turns turns with $stacks Mystical Rock stack(s)", async ({ stacks, turns }) => {
      game.override.startingHeldItems([{ name: "MYSTICAL_ROCK", count: stacks }]);
      await game.classicMode.startBattle(SpeciesId.FLORGES);

      game.move.select(MoveId.GARDENING);
      await game.phaseInterceptor.to("MoveEndPhase");

      expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.PLAYER, turnCount: turns });
      // The attr's shared turn count is never changed per use
      expect(allMoves[MoveId.GARDENING].getAttrs("AddGardenTagAttr")[0].turnCount).toBe(5);
    });

    it("can be used under Grassy Terrain; Grass moves still get x1.3 once", async () => {
      game.override.startingTerrain(TerrainType.GRASSY);
      await game.classicMode.startBattle(SpeciesId.FLORGES);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const energyBall = allMoves[MoveId.ENERGY_BALL];
      const terrainOnly = energyBall.calculateBattlePower(player, enemy, true);

      game.move.select(MoveId.GARDENING);
      await game.phaseInterceptor.to("MoveEndPhase");

      expect(player).toHaveUsedMove({ move: MoveId.GARDENING, result: MoveResult.SUCCESS });
      expect(game).toHaveTerrain(TerrainType.GRASSY);
      expect(game).toHaveArenaTag(ArenaTagType.GARDEN, ArenaTagSide.PLAYER);
      expect(terrainOnly).toBe(Math.round(90 * 1.3));
      expect(energyBall.calculateBattlePower(player, enemy, true)).toBe(terrainOnly);
    });

    it("gets Prankster's +1 priority as a status move", async () => {
      await game.classicMode.startBattle(SpeciesId.FLORGES);
      const player = game.field.getPlayerPokemon();

      expect(allMoves[MoveId.GARDENING].getPriority(player)).toBe(0);
      game.field.mockAbility(player, AbilityId.PRANKSTER);
      expect(allMoves[MoveId.GARDENING].getPriority(player)).toBe(1);
    });

    it("is blocked by Taunt", async () => {
      await game.classicMode.startBattle(SpeciesId.FLORGES);
      const player = game.field.getPlayerPokemon();

      game.move.select(MoveId.GARDENING);
      await game.move.forceEnemyMove(MoveId.TAUNT);
      game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER]);
      await game.toNextTurn();

      expect(player).toHaveUsedMove({ move: MoveId.NONE, result: MoveResult.FAIL });
      expect(game).not.toHaveArenaTag(ArenaTagType.GARDEN);
      expect(player.isMoveSelectable(MoveId.GARDENING)[0]).toBe(false);
    });

    describe("AI", () => {
      it("scores it 6 while the user's side has no Garden, and as failing while it has one", async () => {
        await game.classicMode.startBattle(SpeciesId.FLORGES);
        const player = game.field.getPlayerPokemon();
        const enemy = game.field.getEnemyPokemon();
        const gardening = allMoves[MoveId.GARDENING];

        expect(gardening.getUserBenefitScore(enemy, enemy, gardening)).toBe(6);
        expect(gardening.applyConditions(enemy, enemy, -1)).toBe(true);

        game.scene.arena.addTag(ArenaTagType.GARDEN, 5, undefined, 0, ArenaTagSide.ENEMY);
        expect(gardening.getUserBenefitScore(enemy, enemy, gardening)).toBe(0);
        expect(gardening.applyConditions(enemy, enemy, -1)).toBe(false);
        // the player's own side is still free
        expect(gardening.applyConditions(player, player, -1)).toBe(true);
      });

      it("a smart (boss) enemy does not use it again while its Garden is up", async () => {
        game.override.enemyHealthSegments(2).enemyMoveset([MoveId.GARDENING, MoveId.TACKLE]);
        await game.classicMode.startBattle(SpeciesId.FLORGES);
        const enemy = game.field.getEnemyPokemon();
        game.scene.arena.addTag(ArenaTagType.GARDEN, 5, undefined, 0, ArenaTagSide.ENEMY);

        game.move.select(MoveId.SPLASH);
        await game.toEndOfTurn();

        expect(enemy).toHaveUsedMove(MoveId.TACKLE);
      });

      it("a Gardener boss or trainer Pokémon does not get it in its moveset pool", async () => {
        await game.classicMode.startBattle(SpeciesId.FLORGES);
        const enemy = game.field.getEnemyPokemon();
        const { filterMovePool } = __INTERNAL_TEST_EXPORTS;
        const makePool = () =>
          new Map<MoveId, number>([
            [MoveId.GARDENING, 1],
            [MoveId.BODY_SLAM, 1],
          ]);

        const control = makePool();
        filterMovePool(control, true, false, enemy as EnemyPokemon, false);
        expect([...control.keys()]).toEqual([MoveId.GARDENING, MoveId.BODY_SLAM]);

        game.override.enemyAbility(AbilityId.GARDENER);
        for (const [isBoss, hasTrainer] of [
          [true, false],
          [false, true],
        ]) {
          const pool = makePool();
          filterMovePool(pool, isBoss, hasTrainer, enemy as EnemyPokemon, false);
          expect([...pool.keys()]).toEqual([MoveId.BODY_SLAM]);
        }
      });
    });
  });

  describe("쇄빙참 (Icebreaker)", () => {
    beforeEach(() => {
      game.override.moveset([MoveId.ICEBREAKER, MoveId.SPLASH]);
    });

    /** Uses Icebreaker before the enemy moves (no forced status roll) and returns the power it was used with */
    async function useIcebreakerFirst(): Promise<MockInstance> {
      const powerSpy = vi.spyOn(allMoves[MoveId.ICEBREAKER], "calculateBattlePower");
      powerSpy.mockClear();
      game.move.select(MoveId.ICEBREAKER);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
      await game.phaseInterceptor.to("MoveEndPhase");
      return powerSpy;
    }

    it("hits a frozen target with x2 power (140), then thaws it with Pokérogue's thaw message", async () => {
      game.override.enemyStatusEffect(StatusEffect.FREEZE);
      await game.classicMode.startBattle(SpeciesId.WEAVILE);
      const enemy = game.field.getEnemyPokemon();
      const thawText = getStatusEffectHealText(StatusEffect.FREEZE, getPokemonNameWithAffix(enemy));

      const powerSpy = await useIcebreakerFirst();

      expect(powerSpy).toHaveLastReturnedWith(140);
      expect(enemy).not.toHaveFullHp();
      expect(enemy).toHaveStatusEffect(StatusEffect.NONE);
      expect(game).toHaveShownMessage(thawText);
      expect(game.textInterceptor.logs.filter(log => log === thawText)).toHaveLength(1);
    });

    it("hits a target that is not frozen with its base power 70, and thaws nothing", async () => {
      await game.classicMode.startBattle(SpeciesId.WEAVILE);
      const enemy = game.field.getEnemyPokemon();

      const powerSpy = await useIcebreakerFirst();

      expect(powerSpy).toHaveLastReturnedWith(70);
      expect(enemy).not.toHaveFullHp();
      expect(game).not.toHaveShownMessage(getStatusEffectHealText(StatusEffect.FREEZE, getPokemonNameWithAffix(enemy)));
    });

    it("against a frozen target behind a substitute: no x2, no thaw", async () => {
      game.override.enemyStatusEffect(StatusEffect.FREEZE);
      await game.classicMode.startBattle(SpeciesId.WEAVILE);
      const enemy = game.field.getEnemyPokemon();
      enemy.addTag(BattlerTagType.SUBSTITUTE, 0, MoveId.NONE, enemy.id);

      const powerSpy = await useIcebreakerFirst();

      expect(powerSpy).toHaveLastReturnedWith(70);
      expect(enemy).toHaveStatusEffect(StatusEffect.FREEZE);
      expect(game).not.toHaveShownMessage(getStatusEffectHealText(StatusEffect.FREEZE, getPokemonNameWithAffix(enemy)));
    });

    it("shows no thaw message when it knocks the frozen target out", async () => {
      game.override.enemyStatusEffect(StatusEffect.FREEZE);
      await game.classicMode.startBattle(SpeciesId.WEAVILE);
      const enemy = game.field.getEnemyPokemon();
      enemy.hp = 1;

      await useIcebreakerFirst();

      expect(enemy).toHaveFainted();
      expect(game).not.toHaveShownMessage(getStatusEffectHealText(StatusEffect.FREEZE, getPokemonNameWithAffix(enemy)));
    });

    it("with Multi Lens: every strike at x2, one thaw after the last", async () => {
      game.override.enemyStatusEffect(StatusEffect.FREEZE).startingHeldItems([{ name: "MULTI_LENS", count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.WEAVILE);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const thawText = getStatusEffectHealText(StatusEffect.FREEZE, getPokemonNameWithAffix(enemy));

      const powerSpy = await useIcebreakerFirst();

      expect(player.turnData.hitCount).toBe(2);
      const powers = powerSpy.mock.results.map(result => result.value);
      expect(powers.length).toBeGreaterThanOrEqual(2);
      expect(
        powers.every(power => power === 140),
        `${powers}`,
      ).toBe(true);
      expect(enemy).toHaveStatusEffect(StatusEffect.NONE);
      expect(game.textInterceptor.logs.filter(log => log === thawText)).toHaveLength(1);
    });

    it("with Parental Bond: the second strike is still doubled (1/4 of the first), one thaw", async () => {
      game.override.enemyStatusEffect(StatusEffect.FREEZE).ability(AbilityId.PARENTAL_BOND);
      await game.classicMode.startBattle(SpeciesId.WEAVILE);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const thawText = getStatusEffectHealText(StatusEffect.FREEZE, getPokemonNameWithAffix(enemy));

      game.move.select(MoveId.ICEBREAKER);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
      await game.phaseInterceptor.to("DamageAnimPhase");
      const firstStrike = enemy.getInverseHp();
      await game.phaseInterceptor.to("MoveEndPhase", false);
      const secondStrike = enemy.getInverseHp() - firstStrike;

      expect(player.turnData.hitCount).toBe(2);
      expect(secondStrike).toBe(Math.max(1, Math.floor(0.25 * firstStrike)));
      expect(enemy).toHaveStatusEffect(StatusEffect.NONE);
      expect(game.textInterceptor.logs.filter(log => log === thawText)).toHaveLength(1);
    });

    it("is boosted x1.5 by Sharpness as a slicing move: 105, and 210 against a frozen target", async () => {
      game.override.ability(AbilityId.SHARPNESS);
      await game.classicMode.startBattle(SpeciesId.HISUI_SAMUROTT);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const icebreaker = allMoves[MoveId.ICEBREAKER];

      expect(icebreaker.calculateBattlePower(player, enemy, true)).toBe(105);
      enemy.doSetStatus(StatusEffect.FREEZE);
      expect(icebreaker.calculateBattlePower(player, enemy, true)).toBe(210);
    });

    it("is computed from Sp. Atk with Mind Blade", async () => {
      await game.classicMode.startBattle(SpeciesId.WEAVILE);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      player.stats[Stat.ATK] = 50;
      player.stats[Stat.SPATK] = 300;

      const before = forecast(player, enemy, MoveId.ICEBREAKER);
      game.field.mockAbility(player, AbilityId.MIND_BLADE);
      const after = forecast(player, enemy, MoveId.ICEBREAKER);

      expect(after).toBeGreaterThan(before * 3);
    });

    it("does not thaw its frozen user when chosen (only the usual freeze check)", async () => {
      game.override.statusEffect(StatusEffect.FREEZE);
      await game.classicMode.startBattle(SpeciesId.WEAVILE);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.move.select(MoveId.ICEBREAKER);
      await game.toEndOfTurn();

      expect(player).toHaveStatusEffect(StatusEffect.FREEZE);
      expect(enemy).toHaveFullHp();
      expect(game).not.toHaveShownMessage(
        getStatusEffectHealText(StatusEffect.FREEZE, getPokemonNameWithAffix(player)),
      );
    });

    it("deals exactly the damage the AI forecast gives against a frozen target (x2 included)", async () => {
      game.override.enemyStatusEffect(StatusEffect.FREEZE);
      await game.classicMode.startBattle(SpeciesId.WEAVILE);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const expected = forecast(player, enemy, MoveId.ICEBREAKER);
      expect(allMoves[MoveId.ICEBREAKER].calculateBattlePower(player, enemy, true)).toBe(140);

      await useIcebreakerFirst();

      expect(enemy.getInverseHp()).toBe(expected);
    });
  });

  describe("뒤통수치기 (Blindside)", () => {
    beforeEach(() => {
      game.override.moveset([MoveId.BLINDSIDE, MoveId.CRUNCH]);
    });

    function expectEffectiveness(
      user: Pokemon,
      target: Pokemon,
      types: PokemonType[],
      expected: TypeDamageMultiplier,
    ): void {
      target.summonData.types = types;
      const move = allMoves[MoveId.BLINDSIDE];
      const eff = target.getAttackTypeEffectiveness(user.getMoveType(move), { source: user, move });
      expect(eff, `Blindside vs ${types.map(t => PokemonType[t]).join("/")}`).toBe(expected);
    }

    it.each<{ name: string; types: PokemonType[]; eff: TypeDamageMultiplier }>([
      { name: "Fighting", types: [PokemonType.FIGHTING], eff: 2 },
      { name: "Fighting/Psychic (Gallade, Medicham)", types: [PokemonType.PSYCHIC, PokemonType.FIGHTING], eff: 4 },
      { name: "Fighting/Ghost (Annihilape, Marshadow)", types: [PokemonType.FIGHTING, PokemonType.GHOST], eff: 4 },
      { name: "Fighting/Steel (Lucario)", types: [PokemonType.FIGHTING, PokemonType.STEEL], eff: 2 },
      { name: "Fighting/Water", types: [PokemonType.WATER, PokemonType.FIGHTING], eff: 2 },
      { name: "Fighting/Dark (Scrafty, Pangoro)", types: [PokemonType.DARK, PokemonType.FIGHTING], eff: 1 },
      { name: "Fighting/Fairy", types: [PokemonType.FIGHTING, PokemonType.FAIRY], eff: 1 },
      { name: "Psychic (not Fighting)", types: [PokemonType.PSYCHIC], eff: 2 },
      { name: "Fairy (not Fighting)", types: [PokemonType.FAIRY], eff: 0.5 },
      { name: "Normal (not Fighting)", types: [PokemonType.NORMAL], eff: 1 },
    ])("is x$eff against $name", async ({ types, eff }) => {
      await game.classicMode.startBattle(SpeciesId.SCRAFTY);
      expectEffectiveness(game.field.getPlayerPokemon(), game.field.getEnemyPokemon(), types, eff);
    });

    it.each([
      { name: "Machamp", species: SpeciesId.MACHAMP, eff: 2 },
      { name: "Gallade", species: SpeciesId.GALLADE, eff: 4 },
      { name: "Annihilape", species: SpeciesId.ANNIHILAPE, eff: 4 },
      { name: "Scrafty", species: SpeciesId.SCRAFTY, eff: 1 },
    ])("is x$eff against $name, with its real typing", async ({ species, eff }) => {
      game.override.enemySpecies(species);
      await game.classicMode.startBattle(SpeciesId.SCRAFTY);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const move = allMoves[MoveId.BLINDSIDE];
      expect(enemy.getAttackTypeEffectiveness(player.getMoveType(move), { source: player, move })).toBe(eff);
      // (control) a plain Dark move against the same Pokémon
      expect(
        enemy.getAttackTypeEffectiveness(PokemonType.DARK, { source: player, move: allMoves[MoveId.CRUNCH] }),
      ).toBe(eff / 4);
    });

    it("uses the Tera type: a Normal-type Terastallized into Fighting takes x2, a Fighting-type into Normal x1", async () => {
      await game.classicMode.startBattle(SpeciesId.SCRAFTY);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      enemy.teraType = PokemonType.FIGHTING;
      enemy.isTerastallized = true;
      expectEffectiveness(player, enemy, [PokemonType.NORMAL], 2);
      enemy.teraType = PokemonType.NORMAL;
      expectEffectiveness(player, enemy, [PokemonType.FIGHTING], 1);
    });

    it("stays x2 against Fighting when its type changes (Normalize)", async () => {
      await game.classicMode.startBattle(SpeciesId.SCRAFTY);
      const player = game.field.getPlayerPokemon();
      game.field.mockAbility(player, AbilityId.NORMALIZE);

      expect(player.getMoveType(allMoves[MoveId.BLINDSIDE])).toBe(PokemonType.NORMAL);
      expectEffectiveness(player, game.field.getEnemyPokemon(), [PokemonType.FIGHTING], 2);
    });

    it("stays x2 against Fighting in an Inverse Battle", async () => {
      await game.classicMode.startBattle(SpeciesId.SCRAFTY);
      game.challengeMode.overrideGameWithChallenges(Challenges.INVERSE_BATTLE, 1, 1);

      expectEffectiveness(game.field.getPlayerPokemon(), game.field.getEnemyPokemon(), [PokemonType.FIGHTING], 2);
    });

    it("shows 'super effective' against a Fighting type and deals exactly the forecast damage", async () => {
      game.override.enemySpecies(SpeciesId.MACHAMP);
      await game.classicMode.startBattle(SpeciesId.SCRAFTY);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const expected = forecast(player, enemy, MoveId.BLINDSIDE);

      game.move.select(MoveId.BLINDSIDE);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
      await game.toEndOfTurn();

      expect(game).toHaveShownMessage(i18next.t("battle:hitResultSuperEffective"));
      expect(enemy.getInverseHp()).toBe(expected);
    });

    it("shows the super-effective type hint on the move selection screen against a Fighting type", async () => {
      game.override.enemySpecies(SpeciesId.MACHAMP);
      game.settings.typeHints(TypeHints.HIGH_CONTRAST);
      await game.classicMode.startBattle(SpeciesId.SCRAFTY);

      game.onNextPrompt("CommandPhase", UiMode.COMMAND, () => {
        game.scene.ui.getHandler<FightUiHandler>().processInput(Button.ACTION); // select "Fight"
      });
      game.onNextPrompt("CommandPhase", UiMode.FIGHT, () => {
        const { ui } = game.scene;
        const texts = ui
          .getByName<Phaser.GameObjects.Container>(FightUiHandler.MOVES_CONTAINER_NAME)
          .getAll<Phaser.GameObjects.Text>();
        const colorOf = (key: string) =>
          (texts.find(text => text.text === i18next.t(key)) as unknown as MockText | undefined)?.color;

        expect.soft(colorOf("move:blindside.name")).toBe(getTypeDamageMultiplierColor(2, "offense", true));
        // (control) Crunch is resisted by the same Pokémon
        expect.soft(colorOf("move:crunch.name")).toBe(getTypeDamageMultiplierColor(0.5, "offense", true));
        ui.getHandler().processInput(Button.ACTION);
      });
      await game.phaseInterceptor.to("TurnStartPhase");
    });
  });
});
