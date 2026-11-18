// Local fork (2026-11-14): custom moves. Tests of Gardener (정원사, custom-abilities-1114-f.ts;
// tools/drive/custom_moves_1114/design_spec.json "abilities" GARDENER): on every entry it sets the Garden (정원) on its
// own side for 5 turns (+2 per Mystical Rock stack), and does nothing at all while that side already has one.
import { getPokemonNameWithAffix } from "#app/messages";
import { getCustomPassive } from "#balance/custom-passives";
import { allAbilities, allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattleType } from "#enums/battle-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import i18next from "i18next";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local fork (2026-11-14): custom moves (review fix). Gives the listed species these regular abilities from the very
 * start of the battle (the overrides give one ability to the whole party); every other Pokémon keeps its own. Undone
 * after each test (`restoreMocks`). The same helper as in custom-turnabout.test.ts.
 */
function abilitiesBySpecies(abilities: Partial<Record<SpeciesId, AbilityId>>): void {
  const original = Pokemon.prototype.getAbility;
  vi.spyOn(Pokemon.prototype, "getAbility").mockImplementation(function (this: Pokemon, ignoreOverride?: boolean) {
    const id = abilities[this.species.speciesId];
    return id == null ? original.call(this, ignoreOverride) : allAbilities[id];
  });
}

describe("Custom ability - Gardener", () => {
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
      .ability(AbilityId.GARDENER)
      .moveset([MoveId.SPLASH]);
  });

  // Local fork (2026-11-14): custom moves (review fix). Was -1, which also put it after the Turnabout of every other
  // Pokémon entering at the same time; now the usual 0 (speed order, as in Essentials), and the summon queue puts a
  // Turnabout passive before a Gardener ability on the same Pokémon (tests "with Turnabout on the same Pokémon")
  it("is registered with the usual post-summon priority 0, like Turnabout", () => {
    expect(allAbilities[AbilityId.GARDENER].postSummonPriority).toBe(0);
    expect(allAbilities[AbilityId.TURNABOUT].postSummonPriority).toBe(0);
  });

  it("sets a 5-turn Garden on its own side on entry, with the ability bar and the start message", async () => {
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const player = game.field.getPlayerPokemon();

    expect(player).toHaveAbilityApplied(AbilityId.GARDENER);
    expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.PLAYER, turnCount: 5 });
    expect(game).not.toHaveArenaTag(ArenaTagType.GARDEN, ArenaTagSide.ENEMY);
    expect(game).toHaveShownMessage(i18next.t("arenaTag:gardenOnAddPlayer"));
    expect(game.phaseInterceptor.phaseLog).toContain("ShowAbilityPhase");
  });

  it("does nothing while its side already has a Garden (no refresh, no ability bar, no message)", async () => {
    game.scene.arena.addTag(ArenaTagType.GARDEN, 2, undefined, 0, ArenaTagSide.PLAYER);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const player = game.field.getPlayerPokemon();

    expect(player).not.toHaveAbilityApplied(AbilityId.GARDENER);
    expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.PLAYER, turnCount: 2 });
    expect(game.phaseInterceptor.phaseLog).not.toContain("ShowAbilityPhase");
  });

  it("still sets its own Garden when only the opposing side has one", async () => {
    game.scene.arena.addTag(ArenaTagType.GARDEN, 2, undefined, 0, ArenaTagSide.ENEMY);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);

    expect(game.field.getPlayerPokemon()).toHaveAbilityApplied(AbilityId.GARDENER);
    expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.PLAYER, turnCount: 5 });
    expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.ENEMY, turnCount: 2 });
  });

  it.each([
    { stacks: 1, turns: 7 },
    { stacks: 2, turns: 9 },
  ])("lasts $turns turns with $stacks Mystical Rock stack(s)", async ({ stacks, turns }) => {
    game.override.startingHeldItems([{ name: "MYSTICAL_ROCK", count: stacks }]);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);

    expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.PLAYER, turnCount: turns });
  });

  it("works as a passive too", async () => {
    game.override.ability(AbilityId.BALL_FETCH).passiveAbility(AbilityId.GARDENER).hasPassiveAbility(true);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);

    expect(game.field.getPlayerPokemon()).toHaveAbilityApplied(AbilityId.GARDENER);
    expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.PLAYER, turnCount: 5 });
  });

  it("works for the enemy, on the enemy's side", async () => {
    game.override.ability(AbilityId.BALL_FETCH).enemyAbility(AbilityId.GARDENER);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);

    expect(game.field.getEnemyPokemon()).toHaveAbilityApplied(AbilityId.GARDENER);
    expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.ENEMY, turnCount: 5 });
    expect(game).not.toHaveArenaTag(ArenaTagType.GARDEN, ArenaTagSide.PLAYER);
    expect(game).toHaveShownMessage(i18next.t("arenaTag:gardenOnAddEnemy"));
  });

  it("does nothing under Neutralizing Gas", async () => {
    game.override.enemyAbility(AbilityId.NEUTRALIZING_GAS);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);

    expect(game.field.getPlayerPokemon()).not.toHaveAbilityApplied(AbilityId.GARDENER);
    expect(game).not.toHaveArenaTag(ArenaTagType.GARDEN);
  });

  it("sets it again when it comes back in after the Garden ran out", async () => {
    await game.classicMode.startBattle(SpeciesId.BLISSEY, SpeciesId.CHANSEY);
    // The partner has no ability of its own here
    game.field.mockAbility(game.scene.getPlayerParty()[1], AbilityId.BALL_FETCH);

    game.scene.arena.removeTagOnSide(ArenaTagType.GARDEN, ArenaTagSide.PLAYER, true);
    game.doSwitchPokemon(1);
    await game.toNextTurn();
    expect(game).not.toHaveArenaTag(ArenaTagType.GARDEN);

    game.doSwitchPokemon(1);
    await game.toNextTurn();
    expect(game.field.getPlayerPokemon().species.speciesId).toBe(SpeciesId.BLISSEY);
    // Set this turn, already counted down once at its end
    expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.PLAYER, turnCount: 4 });
  });

  describe("with Turnabout on the same Pokémon", () => {
    it.each([
      {
        name: "Gardener as the ability, Turnabout as the passive",
        ability: AbilityId.GARDENER,
        passive: AbilityId.TURNABOUT,
      },
      {
        name: "Turnabout as the ability, Gardener as the passive",
        ability: AbilityId.TURNABOUT,
        passive: AbilityId.GARDENER,
      },
    ])("swaps first, so the new Garden stays on its own side ($name)", async ({ ability, passive }) => {
      game.override.ability(ability).passiveAbility(passive).hasPassiveAbility(true);
      // Something on the opposing side for Turnabout to take
      game.scene.arena.addTag(ArenaTagType.REFLECT, 5, MoveId.REFLECT, 0, ArenaTagSide.ENEMY);
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const player = game.field.getPlayerPokemon();

      expect(player).toHaveAbilityApplied(AbilityId.TURNABOUT);
      expect(player).toHaveAbilityApplied(AbilityId.GARDENER);
      expect(game).toHaveArenaTag(ArenaTagType.REFLECT, ArenaTagSide.PLAYER);
      expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.PLAYER, turnCount: 5 });
      expect(game).not.toHaveArenaTag(ArenaTagType.GARDEN, ArenaTagSide.ENEMY);
      expect(game).not.toHaveArenaTag(ArenaTagType.REFLECT, ArenaTagSide.ENEMY);
    });
  });

  // Local fork (2026-11-14): custom moves (review fix). Nothing on the field for Turnabout: it stays quiet and keeps its
  // use, and must not then hand the Garden its own Pokémon just planted to the other side (Essentials' marker case)
  describe("with Turnabout on the same Pokémon and nothing to swap", () => {
    it.each([
      {
        name: "Gardener as the ability, Turnabout as the passive",
        ability: AbilityId.GARDENER,
        passive: AbilityId.TURNABOUT,
      },
      {
        name: "Turnabout as the ability, Gardener as the passive",
        ability: AbilityId.TURNABOUT,
        passive: AbilityId.GARDENER,
      },
    ])("keeps the new Garden on its own side and Turnabout unused ($name)", async ({ ability, passive }) => {
      game.override.ability(ability).passiveAbility(passive).hasPassiveAbility(true);
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const player = game.field.getPlayerPokemon();

      expect(player).toHaveAbilityApplied(AbilityId.GARDENER);
      expect(player).not.toHaveAbilityApplied(AbilityId.TURNABOUT);
      expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.PLAYER, turnCount: 5 });
      expect(game).not.toHaveArenaTag(ArenaTagType.GARDEN, ArenaTagSide.ENEMY);
    });
  });

  // Local fork (2026-11-14): custom moves (review fix). Pokémon entering at the same time act in speed order, each one
  // "hazards, then abilities", as in Essentials (es_verify.md: Gardener Lilligant, then the wild Machamp's Turnabout
  // swaps that Garden). Gardener's old post-summon priority -1 made it act after every Turnabout instead.
  describe("with Turnabout on another Pokémon entering at the same time", () => {
    const swapText = (pokemon: Pokemon): string =>
      i18next.t("moveTriggers:swapArenaTags", { pokemonName: getPokemonNameWithAffix(pokemon) });

    it("a faster Gardener plants first, then a slower opposing Turnabout takes the Garden", async () => {
      game.override.enemySpecies(SpeciesId.SHUCKLE).enemyAbility(AbilityId.TURNABOUT);
      await game.classicMode.startBattle(SpeciesId.REGIELEKI);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      expect(player.getEffectiveStat(Stat.SPD)).toBeGreaterThan(enemy.getEffectiveStat(Stat.SPD));

      expect(player).toHaveAbilityApplied(AbilityId.GARDENER);
      expect(enemy).toHaveAbilityApplied(AbilityId.TURNABOUT);
      expect(game).toHaveShownMessage(i18next.t("arenaTag:gardenOnAddPlayer"));
      expect(game).toHaveShownMessage(swapText(enemy));
      expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.ENEMY, turnCount: 5 });
      expect(game).not.toHaveArenaTag(ArenaTagType.GARDEN, ArenaTagSide.PLAYER);
    });

    it("(control) a faster opposing Turnabout finds nothing, stays unused, and the slower Gardener keeps its Garden", async () => {
      game.override.enemySpecies(SpeciesId.REGIELEKI).enemyAbility(AbilityId.TURNABOUT);
      await game.classicMode.startBattle(SpeciesId.SHUCKLE);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      expect(enemy.getEffectiveStat(Stat.SPD)).toBeGreaterThan(player.getEffectiveStat(Stat.SPD));

      expect(player).toHaveAbilityApplied(AbilityId.GARDENER);
      expect(enemy).not.toHaveAbilityApplied(AbilityId.TURNABOUT);
      expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.PLAYER, turnCount: 5 });
      expect(game).not.toHaveArenaTag(ArenaTagType.GARDEN, ArenaTagSide.ENEMY);
    });

    it("in a double battle, a slower partner's Turnabout swaps the faster partner's new Garden away", async () => {
      game.override.battleStyle("double").ability(AbilityId.BALL_FETCH);
      abilitiesBySpecies({ [SpeciesId.REGIELEKI]: AbilityId.GARDENER, [SpeciesId.SHUCKLE]: AbilityId.TURNABOUT });
      await game.classicMode.startBattle(SpeciesId.REGIELEKI, SpeciesId.SHUCKLE);
      const [regieleki, shuckle] = game.scene.getPlayerField();

      expect(regieleki).toHaveAbilityApplied(AbilityId.GARDENER);
      expect(shuckle).toHaveAbilityApplied(AbilityId.TURNABOUT);
      expect(game).toHaveShownMessage(swapText(shuckle));
      expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.ENEMY, turnCount: 5 });
      expect(game).not.toHaveArenaTag(ArenaTagType.GARDEN, ArenaTagSide.PLAYER);
    });
  });

  // Local fork (2026-11-14): custom moves (review fix). Like Grassy Surge (SummonTerrainAiMovegenMoveStatsAbAttr), enemy
  // moveset generation rates the holder's Grass moves x1.3 unless it is a Flying type or has Levitate, since its
  // Garden gives exactly that boost
  describe("enemy moveset generation", () => {
    /** Effective power with `ability` over the same with Ball Fetch, while moveset generation is in progress */
    function powerRatio(pokemon: Pokemon, ability: AbilityId, move: MoveId): number {
      game.field.mockAbility(pokemon, AbilityId.BALL_FETCH);
      const plain = allMoves[move].calculateEffectivePower(pokemon);
      game.field.mockAbility(pokemon, ability);
      return allMoves[move].calculateEffectivePower(pokemon) / plain;
    }

    it.each([
      { species: SpeciesId.BLISSEY, label: "a grounded holder", grass: 1.3 },
      { species: SpeciesId.TROPIUS, label: "a Flying-type holder", grass: 1 },
    ])("rates Grass moves x$grass for $label, the same as Grassy Surge", async ({ species, grass }) => {
      await game.classicMode.startBattle(species);
      const player = game.field.getPlayerPokemon();

      game.scene.movesetGenInProgress = true;
      try {
        expect(powerRatio(player, AbilityId.GARDENER, MoveId.ENERGY_BALL)).toBeCloseTo(grass);
        expect(powerRatio(player, AbilityId.GRASSY_SURGE, MoveId.ENERGY_BALL)).toBeCloseTo(grass);
        expect(powerRatio(player, AbilityId.GARDENER, MoveId.BODY_SLAM)).toBeCloseTo(1);
      } finally {
        game.scene.movesetGenInProgress = false;
      }
    });
  });

  describe("across waves", () => {
    it("sets the Garden again when a trainer battle resets the side effects", async () => {
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      expect(game).toHaveArenaTag(ArenaTagType.GARDEN, ArenaTagSide.PLAYER);
      game.scene.arena.addTag(ArenaTagType.GARDEN, 3, undefined, 0, ArenaTagSide.ENEMY);
      const wave = game.scene.currentBattle.waveIndex;

      // The next wave is a trainer battle, which clears the arena and sends the party out again
      game.override.battleType(BattleType.TRAINER);
      game.move.select(MoveId.SPLASH);
      await game.doKillOpponents();
      await game.toNextWave();

      expect(game.scene.currentBattle.waveIndex).toBe(wave + 1);
      expect(game.scene.currentBattle.battleType).toBe(BattleType.TRAINER);
      expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.PLAYER, turnCount: 5 });
      expect(game).not.toHaveArenaTag(ArenaTagType.GARDEN, ArenaTagSide.ENEMY);
      expect(game.field.getPlayerPokemon()).toHaveAbilityApplied(AbilityId.GARDENER);
    });

    it("(control) keeps the Garden, counting down, between wild waves of the same biome", async () => {
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const wave = game.scene.currentBattle.waveIndex;

      game.move.select(MoveId.SPLASH);
      await game.doKillOpponents();
      await game.toNextWave();

      expect(game.scene.currentBattle.waveIndex).toBe(wave + 1);
      // Set for 5, one turn counted down; the Pokémon stayed in, so Gardener did not fire again
      expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.PLAYER, turnCount: 4 });
      expect(game.field.getPlayerPokemon()).not.toHaveAbilityApplied(AbilityId.GARDENER);
    });
  });

  // Local fork (2026-11-18): the user's answer "교체 및 후보에 등록". The Oddish line (ODDISH, GLOOM, VILEPLUME, BELLOSSOM
  // rows) and the Smoliv line (SMOLIV, ARBOLIVA rows) had Grassy Surge as their passive on the sheet
  // (Design/패시브_종족별.xlsx) and now have Gardener; custom-passives.ts is generated from it.
  describe("species passives", () => {
    it("is the passive of the Oddish and Smoliv lines in our table", () => {
      const lines = [SpeciesId.ODDISH, SpeciesId.GLOOM, SpeciesId.VILEPLUME, SpeciesId.BELLOSSOM];
      lines.push(SpeciesId.SMOLIV, SpeciesId.DOLLIV, SpeciesId.ARBOLIVA);
      for (const speciesId of lines) {
        expect(getCustomPassive(speciesId, ""), SpeciesId[speciesId]).toBe(AbilityId.GARDENER);
      }
    });

    it("(control) leaves the other Grassy Surge rows as they were", () => {
      for (const speciesId of [SpeciesId.CHIKORITA, SpeciesId.TANGELA, SpeciesId.SKIDDO, SpeciesId.TOEDSCOOL]) {
        expect(getCustomPassive(speciesId, ""), SpeciesId[speciesId]).toBe(AbilityId.GRASSY_SURGE);
      }
    });
  });
});
