// Local fork (2026-11-14): passive rebalance. Tests of Clearing Gust (선풍, custom-abilities-1114-e.ts): on entry it
// blows its own side's Stealth Rock, Spikes, Toxic Spikes and Sticky Web away before they act on it
// (`ClearOwnSideEntryHazardsAbAttr`, applied by `PostSummonPhase`).
import { getPokemonNameWithAffix } from "#app/messages";
import { getCustomPassive } from "#balance/custom-passives";
import { allAbilities } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattleType } from "#enums/battle-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import type { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import i18next from "i18next";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** The hazards Clearing Gust blows away, in the order they are laid here. */
const HAZARDS = [
  ArenaTagType.STEALTH_ROCK,
  ArenaTagType.SPIKES,
  ArenaTagType.TOXIC_SPIKES,
  ArenaTagType.STICKY_WEB,
] as const;

/** `arenaTag` removal message key of each hazard (without the side suffix). */
const REMOVE_KEYS = ["stealthRockOnRemove", "spikesOnRemove", "toxicSpikesOnRemove", "stickyWebOnRemove"] as const;

/** `arenaTag` message key of each hazard acting on a Pokémon (Toxic Spikes poisons quietly). */
const TRAP_KEYS = ["stealthRockActivateTrap", "spikesActivateTrap", "stickyWebActivateTrap"] as const;

/**
 * The player's Pokémon. Grounded and neither Poison- nor Steel-type, so all four hazards would act on them (the Hoppip
 * line itself is Flying, which Spikes, Toxic Spikes and Sticky Web skip). The ability comes from the overrides.
 */
const HOLDER = SpeciesId.MILTANK;
const PARTNER = SpeciesId.TAUROS;

describe("Custom ability - Clearing Gust", () => {
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
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.CLEARING_GUST)
      .moveset([MoveId.SPLASH, MoveId.TACKLE]);
  });

  /** Lays one layer of each hazard on `side`. */
  function layHazards(side: ArenaTagSide.PLAYER | ArenaTagSide.ENEMY): void {
    for (const tagType of HAZARDS) {
      game.scene.arena.addTag(tagType, 0, undefined, 0, side);
    }
  }

  function triggerMessage(pokemon: Pokemon): string {
    return i18next.t("battle:clearingGustBlewAwayHazards", {
      pokemonNameWithAffix: getPokemonNameWithAffix(pokemon),
      abilityName: allAbilities[AbilityId.CLEARING_GUST].name,
    });
  }

  /** `pokemon` came in untouched: the hazards on its `side` are gone, with the ability bar and the messages. */
  function expectBlownAway(pokemon: Pokemon, side: ArenaTagSide.PLAYER | ArenaTagSide.ENEMY): void {
    expect(pokemon).toHaveFullHp();
    expect(pokemon).toHaveStatusEffect(StatusEffect.NONE);
    expect(pokemon).toHaveStatStage(Stat.SPD, 0);
    expect(pokemon).toHaveAbilityApplied(AbilityId.CLEARING_GUST);
    for (const tagType of HAZARDS) {
      expect(game).not.toHaveArenaTag(tagType, side);
    }
    expect(game).toHaveShownMessage(triggerMessage(pokemon));
    const suffix = side === ArenaTagSide.PLAYER ? "Player" : "Enemy";
    for (const key of REMOVE_KEYS) {
      expect(game).toHaveShownMessage(i18next.t(`arenaTag:${key}${suffix}`));
    }
    for (const key of TRAP_KEYS) {
      expect(game).not.toHaveShownMessage(
        i18next.t(`arenaTag:${key}`, { pokemonNameWithAffix: getPokemonNameWithAffix(pokemon) }),
      );
    }
  }

  it("is the passive of the Hoppip line in our table (HOPPIP row of the sheet)", () => {
    for (const speciesId of [SpeciesId.HOPPIP, SpeciesId.SKIPLOOM, SpeciesId.JUMPLUFF]) {
      expect(getCustomPassive(speciesId, ""), SpeciesId[speciesId]).toBe(AbilityId.CLEARING_GUST);
    }
  });

  it("(control) without it, the same hazards hurt, poison and slow the same Pokémon", async () => {
    game.override.ability(AbilityId.BALL_FETCH);
    layHazards(ArenaTagSide.PLAYER);
    await game.classicMode.startBattle(HOLDER);
    const player = game.field.getPlayerPokemon();

    // Stealth Rock 1/8 (neutral) + Spikes 1/8, then poison and Speed -1
    expect(player).toHaveTakenDamage(Math.floor(player.getMaxHp() / 8) * 2);
    expect(player).toHaveStatusEffect(StatusEffect.POISON);
    expect(player).toHaveStatStage(Stat.SPD, -1);
    for (const tagType of HAZARDS) {
      expect(game).toHaveArenaTag(tagType, ArenaTagSide.PLAYER);
    }
  });

  it("blows away Stealth Rock, Spikes, Toxic Spikes and Sticky Web before they act, at the start of a battle", async () => {
    layHazards(ArenaTagSide.PLAYER);
    await game.classicMode.startBattle(HOLDER);
    const player = game.field.getPlayerPokemon();

    expectBlownAway(player, ArenaTagSide.PLAYER);
    expect(game.phaseInterceptor.phaseLog).toContain("ShowAbilityPhase");
  });

  it("shows the trigger message before the hazards' own removal messages", async () => {
    layHazards(ArenaTagSide.PLAYER);
    await game.classicMode.startBattle(HOLDER);
    const logs = game.textInterceptor.logs;

    const trigger = logs.indexOf(triggerMessage(game.field.getPlayerPokemon()));
    expect(trigger).toBeGreaterThanOrEqual(0);
    for (const key of REMOVE_KEYS) {
      expect(logs.indexOf(i18next.t(`arenaTag:${key}Player`))).toBeGreaterThan(trigger);
    }
  });

  it("works as a passive too", async () => {
    game.override.ability(AbilityId.BALL_FETCH).passiveAbility(AbilityId.CLEARING_GUST);
    layHazards(ArenaTagSide.PLAYER);
    await game.classicMode.startBattle(HOLDER);

    expectBlownAway(game.field.getPlayerPokemon(), ArenaTagSide.PLAYER);
  });

  it("works for the enemy, on its own side", async () => {
    game.override.ability(AbilityId.BALL_FETCH).enemyAbility(AbilityId.CLEARING_GUST);
    layHazards(ArenaTagSide.ENEMY);
    await game.classicMode.startBattle(HOLDER);

    expectBlownAway(game.field.getEnemyPokemon(), ArenaTagSide.ENEMY);
  });

  it("leaves the opposing side's hazards alone", async () => {
    layHazards(ArenaTagSide.PLAYER);
    layHazards(ArenaTagSide.ENEMY);
    await game.classicMode.startBattle(HOLDER);
    const enemy = game.field.getEnemyPokemon();

    expectBlownAway(game.field.getPlayerPokemon(), ArenaTagSide.PLAYER);
    for (const tagType of HAZARDS) {
      expect(game).toHaveArenaTag(tagType, ArenaTagSide.ENEMY);
    }
    // The enemy (no Clearing Gust) still came in through them: Stealth Rock 1/8 + Spikes 1/8, poison, Speed -1
    expect(enemy).toHaveTakenDamage(Math.floor(enemy.getMaxHp() / 8) * 2);
    expect(enemy).toHaveStatusEffect(StatusEffect.POISON);
    expect(enemy).toHaveStatStage(Stat.SPD, -1);
  });

  it("does nothing, with no ability bar or message, when its side has no hazards", async () => {
    game.override.enemyAbility(AbilityId.CLEARING_GUST);
    // Both sides hold it, and neither side has hazards
    await game.classicMode.startBattle(HOLDER);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    for (const pokemon of [player, enemy]) {
      expect(pokemon).not.toHaveAbilityApplied(AbilityId.CLEARING_GUST);
      expect(game).not.toHaveShownMessage(triggerMessage(pokemon));
    }
    expect(game.phaseInterceptor.phaseLog).not.toContain("ShowAbilityPhase");
  });

  it("does nothing when only the opposing side has hazards", async () => {
    layHazards(ArenaTagSide.ENEMY);
    await game.classicMode.startBattle(HOLDER);
    const player = game.field.getPlayerPokemon();

    expect(player).not.toHaveAbilityApplied(AbilityId.CLEARING_GUST);
    expect(game).not.toHaveShownMessage(triggerMessage(player));
    for (const tagType of HAZARDS) {
      expect(game).toHaveArenaTag(tagType, ArenaTagSide.ENEMY);
    }
  });

  it("removes the hazards whatever Magic Guard would block: no poison, no Speed drop, the tags are gone", async () => {
    // Magic Guard alone stops the Stealth Rock and Spikes damage but not Toxic Spikes or Sticky Web
    game.override.ability(AbilityId.MAGIC_GUARD).passiveAbility(AbilityId.CLEARING_GUST);
    layHazards(ArenaTagSide.PLAYER);
    await game.classicMode.startBattle(HOLDER);

    expectBlownAway(game.field.getPlayerPokemon(), ArenaTagSide.PLAYER);
  });

  it("clears them for a replacement sent in after a faint", async () => {
    await game.classicMode.startBattle(HOLDER, PARTNER);
    const [holder, partner] = game.scene.getPlayerParty();
    expect(holder).not.toHaveAbilityApplied(AbilityId.CLEARING_GUST);

    layHazards(ArenaTagSide.PLAYER);
    game.move.use(MoveId.MEMENTO);
    game.doSelectPartyPokemon(1);
    await game.toNextTurn();

    expect(holder).toHaveFainted();
    expect(partner.isOnField()).toBe(true);
    expectBlownAway(partner, ArenaTagSide.PLAYER);
  });

  it.each<{ name: string; act: () => Promise<void> }>([
    {
      name: "a switch from the menu",
      act: async () => {
        game.doSwitchPokemon(1);
      },
    },
    {
      name: "U-turn",
      act: async () => {
        game.move.use(MoveId.U_TURN);
        game.doSelectPartyPokemon(1);
      },
    },
    {
      name: "Baton Pass",
      act: async () => {
        game.move.use(MoveId.BATON_PASS);
        game.doSelectPartyPokemon(1);
      },
    },
    {
      name: "the enemy's Whirlwind (dragged out)",
      act: async () => {
        game.move.use(MoveId.SPLASH);
        await game.move.forceEnemyMove(MoveId.WHIRLWIND);
      },
    },
  ])("clears them for the Pokémon coming in through $name", async ({ act }) => {
    await game.classicMode.startBattle(HOLDER, PARTNER);
    const partner = game.scene.getPlayerParty()[1];

    layHazards(ArenaTagSide.PLAYER);
    await act();
    await game.toNextTurn();

    expect(partner.isOnField()).toBe(true);
    expectBlownAway(partner, ArenaTagSide.PLAYER);
  });

  describe("for a trainer's Pokémon", () => {
    beforeEach(() => {
      game.override
        .ability(AbilityId.BALL_FETCH)
        .enemyAbility(AbilityId.CLEARING_GUST)
        .battleType(BattleType.TRAINER)
        .randomTrainer({ trainerType: TrainerType.ACE_TRAINER, trainerVariant: TrainerVariant.DEFAULT });
    });

    it("clears the enemy's side for the next Pokémon after a faint", async () => {
      await game.classicMode.startBattle(HOLDER);
      const first = game.field.getEnemyPokemon();
      expect(game.scene.getEnemyParty().length, "the trainer needs a second Pokémon").toBeGreaterThanOrEqual(2);

      layHazards(ArenaTagSide.ENEMY);
      first.hp = 1;
      // At 1 HP the trainer AI would switch it out first (`EnemyCommandPhase`); keep it in so that it faints
      vi.spyOn(first, "isTrapped").mockReturnValue(true);
      game.move.select(MoveId.TACKLE);
      await game.toNextTurn();

      const next = game.field.getEnemyPokemon();
      expect(first).toHaveFainted();
      expect(next).not.toBe(first);
      expectBlownAway(next, ArenaTagSide.ENEMY);
    });

    it("clears the enemy's side for the Pokémon it brings in with U-turn", async () => {
      // Bulky enough to take the U-turn
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const first = game.field.getEnemyPokemon();

      layHazards(ArenaTagSide.ENEMY);
      game.move.use(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.U_TURN);
      await game.toNextTurn();

      const next = game.field.getEnemyPokemon();
      expect(first.isOnField()).toBe(false);
      expect(first).not.toHaveFainted();
      expect(next).not.toBe(first);
      expectBlownAway(next, ArenaTagSide.ENEMY);
    });
  });
});
