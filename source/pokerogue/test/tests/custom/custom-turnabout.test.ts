// Local fork (2026-11-14): custom moves. Tests of Turnabout (전세역전, custom-abilities-1114-f.ts;
// tools/drive/custom_moves_1114/design_spec.json "abilities" TURNABOUT): on entry it swaps both sides' effects like
// Court Change (the Garden included), keeping remaining turns and hazard layers, once per battle (wave); with nothing
// to swap it stays quiet and keeps its use. Also the Tailwind fix (wind reactions on the receiving side) and the guard
// that keeps it out of the enemies' custom passives.
import { getPokemonNameWithAffix } from "#app/messages";
import { allAbilities } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { ENEMY_BLOCKED_CUSTOM_PASSIVES, enemyRollsCustomPassive, Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import i18next from "i18next";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Gives the listed species these regular abilities from the very start of the battle (the overrides give one ability
 * to the whole party); every other Pokémon keeps its own. Undone after each test (`restoreMocks`).
 */
function abilitiesBySpecies(abilities: Partial<Record<SpeciesId, AbilityId>>): void {
  const original = Pokemon.prototype.getAbility;
  vi.spyOn(Pokemon.prototype, "getAbility").mockImplementation(function (this: Pokemon, ignoreOverride?: boolean) {
    const id = abilities[this.species.speciesId];
    return id == null ? original.call(this, ignoreOverride) : allAbilities[id];
  });
}

/** The first id at or after `start` whose enemy custom-passive roll is `wanted` */
function idWithRoll(wanted: boolean, start = 1): number {
  let id = start;
  while (enemyRollsCustomPassive(id) !== wanted) {
    id++;
  }
  return id;
}

describe("Custom ability - Turnabout", () => {
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
      .ability(AbilityId.TURNABOUT)
      .moveset([MoveId.SPLASH]);
  });

  /** Court Change's message, reused by Turnabout */
  function swapMessage(pokemon: Pokemon): string {
    return i18next.t("moveTriggers:swapArenaTags", { pokemonName: getPokemonNameWithAffix(pokemon) });
  }

  function swapMessageCount(pokemon: Pokemon): number {
    const message = swapMessage(pokemon);
    return game.textInterceptor.logs.filter(log => log === message).length;
  }

  /** Lays `tagType` on `side` before or during a battle, `layers` times for hazards */
  function lay(tagType: ArenaTagType, side: ArenaTagSide.PLAYER | ArenaTagSide.ENEMY, turns = 0, layers = 1): void {
    for (let i = 0; i < layers; i++) {
      game.scene.arena.addTag(tagType, turns, undefined, 0, side);
    }
  }

  it("swaps everything on entry, keeping turns and layers, with the ability bar and Court Change's message", async () => {
    lay(ArenaTagType.REFLECT, ArenaTagSide.ENEMY, 5);
    lay(ArenaTagType.TAILWIND, ArenaTagSide.ENEMY, 4);
    lay(ArenaTagType.STEALTH_ROCK, ArenaTagSide.PLAYER);
    lay(ArenaTagType.SPIKES, ArenaTagSide.PLAYER, 0, 2);
    lay(ArenaTagType.GARDEN, ArenaTagSide.PLAYER, 3);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const player = game.field.getPlayerPokemon();

    expect(player).toHaveAbilityApplied(AbilityId.TURNABOUT);
    expect(game).toHaveShownMessage(swapMessage(player));
    expect(game.phaseInterceptor.phaseLog).toContain("ShowAbilityPhase");

    expect(game).toHaveArenaTag({ tagType: ArenaTagType.REFLECT, side: ArenaTagSide.PLAYER, turnCount: 5 });
    expect(game).toHaveArenaTag({ tagType: ArenaTagType.TAILWIND, side: ArenaTagSide.PLAYER, turnCount: 4 });
    expect(game).toHaveArenaTag(ArenaTagType.STEALTH_ROCK, ArenaTagSide.ENEMY);
    expect(game).toHaveArenaTag({ tagType: ArenaTagType.SPIKES, side: ArenaTagSide.ENEMY, layers: 2 });
    expect(game).toHaveArenaTag({ tagType: ArenaTagType.GARDEN, side: ArenaTagSide.ENEMY, turnCount: 3 });
    for (const tagType of [ArenaTagType.STEALTH_ROCK, ArenaTagType.SPIKES, ArenaTagType.GARDEN]) {
      expect(game).not.toHaveArenaTag(tagType, ArenaTagSide.PLAYER);
    }
    for (const tagType of [ArenaTagType.REFLECT, ArenaTagType.TAILWIND]) {
      expect(game).not.toHaveArenaTag(tagType, ArenaTagSide.ENEMY);
    }
  });

  it("takes its own side's hazard damage first, then swaps the hazards", async () => {
    lay(ArenaTagType.STEALTH_ROCK, ArenaTagSide.PLAYER);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const player = game.field.getPlayerPokemon();

    // Blissey (Normal) takes Stealth Rock's neutral 1/8
    expect(player).toHaveTakenDamage(Math.floor(player.getMaxHp() / 8));
    expect(player).toHaveAbilityApplied(AbilityId.TURNABOUT);
    expect(game).toHaveArenaTag(ArenaTagType.STEALTH_ROCK, ArenaTagSide.ENEMY);
    expect(game).not.toHaveArenaTag(ArenaTagType.STEALTH_ROCK, ArenaTagSide.PLAYER);

    const logs = game.textInterceptor.logs;
    const hurt = logs.indexOf(
      i18next.t("arenaTag:stealthRockActivateTrap", { pokemonNameWithAffix: getPokemonNameWithAffix(player) }),
    );
    expect(hurt).toBeGreaterThanOrEqual(0);
    expect(logs.indexOf(swapMessage(player))).toBeGreaterThan(hurt);
  });

  it("does not swap when its own side's hazards knock it out on the way in", async () => {
    await game.classicMode.startBattle(SpeciesId.BLISSEY, SpeciesId.SHUCKLE, SpeciesId.CHANSEY);
    const [, holder] = game.scene.getPlayerParty();
    // Only the Pokémon coming in has Turnabout here
    game.field.mockAbility(game.field.getPlayerPokemon(), AbilityId.BALL_FETCH);
    game.field.mockAbility(game.scene.getPlayerParty()[2], AbilityId.BALL_FETCH);

    lay(ArenaTagType.STEALTH_ROCK, ArenaTagSide.PLAYER);
    lay(ArenaTagType.REFLECT, ArenaTagSide.ENEMY, 5);
    holder.hp = 1;
    game.doSwitchPokemon(1);
    await game.phaseInterceptor.to("SwitchPhase", false);
    game.doSelectPartyPokemon(2);
    await game.toNextTurn();

    expect(holder).toHaveFainted();
    expect(holder).not.toHaveAbilityApplied(AbilityId.TURNABOUT);
    expect(game).toHaveArenaTag(ArenaTagType.REFLECT, ArenaTagSide.ENEMY);
    expect(game).toHaveArenaTag(ArenaTagType.STEALTH_ROCK, ArenaTagSide.PLAYER);
  });

  it("stays quiet and keeps its use with nothing to swap, then swaps on a later entry the same battle", async () => {
    await game.classicMode.startBattle(SpeciesId.BLISSEY, SpeciesId.CHANSEY);
    const [holder, partner] = game.scene.getPlayerParty();
    game.field.mockAbility(partner, AbilityId.BALL_FETCH);

    expect(holder).not.toHaveAbilityApplied(AbilityId.TURNABOUT);
    expect(game).not.toHaveShownMessage(swapMessage(holder));
    expect(game.phaseInterceptor.phaseLog).not.toContain("ShowAbilityPhase");

    game.doSwitchPokemon(1);
    await game.toNextTurn();
    lay(ArenaTagType.REFLECT, ArenaTagSide.ENEMY, 5);
    game.doSwitchPokemon(1);
    await game.toNextTurn();

    expect(game.field.getPlayerPokemon()).toBe(holder);
    expect(holder).toHaveAbilityApplied(AbilityId.TURNABOUT);
    expect(game).toHaveArenaTag(ArenaTagType.REFLECT, ArenaTagSide.PLAYER);
  });

  it("works once per battle: a second entry does not swap again", async () => {
    lay(ArenaTagType.REFLECT, ArenaTagSide.ENEMY, 5);
    await game.classicMode.startBattle(SpeciesId.BLISSEY, SpeciesId.CHANSEY);
    const [holder, partner] = game.scene.getPlayerParty();
    game.field.mockAbility(partner, AbilityId.BALL_FETCH);
    expect(game).toHaveArenaTag(ArenaTagType.REFLECT, ArenaTagSide.PLAYER);

    game.doSwitchPokemon(1);
    await game.toNextTurn();
    lay(ArenaTagType.LIGHT_SCREEN, ArenaTagSide.ENEMY, 5);
    game.doSwitchPokemon(1);
    await game.toNextTurn();

    expect(game.field.getPlayerPokemon()).toBe(holder);
    expect(swapMessageCount(holder)).toBe(1);
    expect(game).toHaveArenaTag(ArenaTagType.LIGHT_SCREEN, ArenaTagSide.ENEMY);
    expect(game).toHaveArenaTag(ArenaTagType.REFLECT, ArenaTagSide.PLAYER);
  });

  it("works as a passive too", async () => {
    game.override.ability(AbilityId.BALL_FETCH).passiveAbility(AbilityId.TURNABOUT).hasPassiveAbility(true);
    lay(ArenaTagType.REFLECT, ArenaTagSide.ENEMY, 5);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);

    expect(game.field.getPlayerPokemon()).toHaveAbilityApplied(AbilityId.TURNABOUT);
    expect(game).toHaveArenaTag(ArenaTagType.REFLECT, ArenaTagSide.PLAYER);
  });

  it("works for the enemy", async () => {
    game.override.ability(AbilityId.BALL_FETCH).enemyAbility(AbilityId.TURNABOUT);
    lay(ArenaTagType.STEALTH_ROCK, ArenaTagSide.ENEMY);
    lay(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER, 4);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);

    expect(game.field.getEnemyPokemon()).toHaveAbilityApplied(AbilityId.TURNABOUT);
    expect(game).toHaveArenaTag(ArenaTagType.STEALTH_ROCK, ArenaTagSide.PLAYER);
    expect(game).toHaveArenaTag({ tagType: ArenaTagType.TAILWIND, side: ArenaTagSide.ENEMY, turnCount: 4 });
  });

  it("leaves effects on both sides alone (Trick Room, terrain-like BOTH tags) and does not fire for them alone", async () => {
    await game.classicMode.startBattle(SpeciesId.BLISSEY, SpeciesId.CHANSEY);
    const [holder, partner] = game.scene.getPlayerParty();
    game.field.mockAbility(partner, AbilityId.BALL_FETCH);

    game.doSwitchPokemon(1);
    await game.toNextTurn();
    game.scene.arena.addTag(ArenaTagType.TRICK_ROOM, 5, MoveId.TRICK_ROOM, 0);
    game.doSwitchPokemon(1);
    await game.toNextTurn();

    expect(holder).not.toHaveAbilityApplied(AbilityId.TURNABOUT);
    expect(game).toHaveArenaTag(ArenaTagType.TRICK_ROOM, ArenaTagSide.BOTH);
  });

  it("does nothing under Neutralizing Gas, fires once the gas is gone, and never again after the next gas", async () => {
    game.override.enemyAbility(AbilityId.NEUTRALIZING_GAS);
    lay(ArenaTagType.REFLECT, ArenaTagSide.ENEMY, 5);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const holder = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    expect(holder).not.toHaveAbilityApplied(AbilityId.TURNABOUT);
    expect(game).toHaveArenaTag(ArenaTagType.REFLECT, ArenaTagSide.ENEMY);

    // The gas wears off: abilities come back (`applyOnGainAbAttrs`) and Turnabout uses its one swap
    game.scene.arena.removeTag(ArenaTagType.NEUTRALIZING_GAS);
    expect(holder).toHaveAbilityApplied(AbilityId.TURNABOUT);
    expect(game).toHaveArenaTag(ArenaTagType.REFLECT, ArenaTagSide.PLAYER);

    // A second gas comes and goes: already used, so the Reflect stays where it is
    game.scene.arena.addTag(ArenaTagType.NEUTRALIZING_GAS, 0, undefined, enemy.id);
    game.scene.arena.removeTag(ArenaTagType.NEUTRALIZING_GAS);
    expect(game).toHaveArenaTag(ArenaTagType.REFLECT, ArenaTagSide.PLAYER);
    expect(game).not.toHaveArenaTag(ArenaTagType.REFLECT, ArenaTagSide.ENEMY);

    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();
    expect(swapMessageCount(holder)).toBe(1);
  });

  it("can be copied by Trace, which then swaps once for the copier", async () => {
    game.override.ability(AbilityId.TRACE).enemyAbility(AbilityId.TURNABOUT);
    lay(ArenaTagType.REFLECT, ArenaTagSide.ENEMY, 5);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    // Both swap once (the Reflect goes there and back); the copier's swap is recorded as Turnabout
    expect(player).toHaveAbilityApplied(AbilityId.TURNABOUT);
    expect(enemy).toHaveAbilityApplied(AbilityId.TURNABOUT);
    expect(swapMessageCount(player)).toBe(1);
    expect(swapMessageCount(enemy)).toBe(1);
    expect(game).toHaveArenaTag(ArenaTagType.REFLECT, ArenaTagSide.ENEMY);
  });

  describe("in a double battle", () => {
    beforeEach(() => {
      game.override.battleStyle("double");
    });

    it("two leads with Turnabout swap twice (back where it was), with the message twice", async () => {
      lay(ArenaTagType.REFLECT, ArenaTagSide.ENEMY, 5);
      await game.classicMode.startBattle(SpeciesId.BLISSEY, SpeciesId.CHANSEY);
      const [blissey, chansey] = game.scene.getPlayerField();

      expect(blissey).toHaveAbilityApplied(AbilityId.TURNABOUT);
      expect(chansey).toHaveAbilityApplied(AbilityId.TURNABOUT);
      expect(swapMessageCount(blissey)).toBe(1);
      expect(swapMessageCount(chansey)).toBe(1);
      expect(game).toHaveArenaTag(ArenaTagType.REFLECT, ArenaTagSide.ENEMY);
      expect(game).not.toHaveArenaTag(ArenaTagType.REFLECT, ArenaTagSide.PLAYER);
    });

    it("one Turnabout lead with Stealth Rock on its side: who takes the rocks follows the speed order (recorded)", async () => {
      // Recorded for the comparison with Essentials (impl_plan.md A-9): each Pokémon's entry runs hazards then
      // abilities, fastest first. The Turnabout holder (Regieleki, fastest) takes the rocks and sends them across;
      // the slower Pokémon on both sides enter after that, so the enemies take them and its partner does not.
      game.override.ability(AbilityId.BALL_FETCH).enemySpecies(SpeciesId.SNORLAX);
      abilitiesBySpecies({ [SpeciesId.REGIELEKI]: AbilityId.TURNABOUT });
      lay(ArenaTagType.STEALTH_ROCK, ArenaTagSide.PLAYER);
      await game.classicMode.startBattle(SpeciesId.REGIELEKI, SpeciesId.SHUCKLE);
      const [holder, partner] = game.scene.getPlayerField();
      const enemies = game.scene.getEnemyField();
      expect(partner).not.toHaveAbilityApplied(AbilityId.TURNABOUT);

      expect(holder).toHaveAbilityApplied(AbilityId.TURNABOUT);
      expect(holder).not.toHaveFullHp();
      expect(game).toHaveArenaTag(ArenaTagType.STEALTH_ROCK, ArenaTagSide.ENEMY);
      expect(game).not.toHaveArenaTag(ArenaTagType.STEALTH_ROCK, ArenaTagSide.PLAYER);
      const record = {
        partner: partner.isFullHp() ? "untouched" : "hurt",
        enemies: enemies.map(e => (e.isFullHp() ? "untouched" : "hurt")),
      };
      expect(record).toEqual({ partner: "untouched", enemies: ["hurt", "hurt"] });
    });
  });

  describe("wind reactions after the swap (Tailwind fix, Court Change too)", () => {
    it("Turnabout: the receiving side reacts (Wind Power), the setter's side does not react again (Wind Rider)", async () => {
      game.override
        .ability(AbilityId.BALL_FETCH)
        .enemyAbility(AbilityId.WIND_RIDER)
        .enemyMoveset([MoveId.TAILWIND, MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.BLISSEY, SpeciesId.CHANSEY);
      const partner = game.scene.getPlayerParty()[1];
      const enemy = game.field.getEnemyPokemon();
      // The Pokémon coming in has Turnabout and, as its passive, Wind Power (Wind Rider would also react to entering
      // with a Tailwind on its side, which is not what this test is about)
      game.field.mockAbility(partner, AbilityId.TURNABOUT);
      game.field.mockAbility(partner, AbilityId.WIND_POWER, true);
      vi.spyOn(partner, "hasPassive").mockReturnValue(true);

      game.move.select(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.TAILWIND);
      await game.toNextTurn();
      expect(game).toHaveArenaTag(ArenaTagType.TAILWIND, ArenaTagSide.ENEMY);
      expect(enemy).toHaveStatStage(Stat.ATK, 1);

      game.doSwitchPokemon(1);
      await game.move.forceEnemyMove(MoveId.SPLASH);
      await game.toNextTurn();

      expect(partner).toHaveAbilityApplied(AbilityId.TURNABOUT);
      expect(game).toHaveArenaTag(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER);
      expect(partner).toHaveBattlerTag(BattlerTagType.CHARGED);
      // Before the fix the setter's allies reacted again on the swap (Wind Rider +1 more)
      expect(enemy).toHaveStatStage(Stat.ATK, 1);
    });

    it("Court Change: the receiving side's Wind Power charges, not the setter's", async () => {
      game.override
        .ability(AbilityId.WIND_POWER)
        .enemyAbility(AbilityId.WIND_POWER)
        .enemyMoveset([MoveId.TAILWIND, MoveId.SPLASH])
        .moveset([MoveId.SPLASH, MoveId.COURT_CHANGE]);
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.move.select(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.TAILWIND);
      await game.toNextTurn();
      expect(enemy).toHaveBattlerTag(BattlerTagType.CHARGED);
      expect(player).not.toHaveBattlerTag(BattlerTagType.CHARGED);
      enemy.removeTag(BattlerTagType.CHARGED);

      game.move.select(MoveId.COURT_CHANGE);
      await game.move.forceEnemyMove(MoveId.SPLASH);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
      await game.toEndOfTurn();

      expect(game).toHaveArenaTag(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER);
      expect(player).toHaveBattlerTag(BattlerTagType.CHARGED);
      expect(enemy).not.toHaveBattlerTag(BattlerTagType.CHARGED);
    });
  });

  describe("enemy custom passive guard", () => {
    beforeEach(() => {
      game.override.ability(AbilityId.BALL_FETCH).enemyHasPassiveAbility(true).enemySpecies(SpeciesId.GARCHOMP);
    });

    it("lists Turnabout as blocked", () => {
      expect([...ENEMY_BLOCKED_CUSTOM_PASSIVES]).toEqual([AbilityId.TURNABOUT]);
    });

    it("an enemy whose species' custom passive is Turnabout keeps its base passive even when its id rolls", async () => {
      await game.classicMode.startBattle(SpeciesId.MAGIKARP);
      const enemy = game.field.getEnemyPokemon();
      const base = enemy.species.getPassiveAbility(enemy.formIndex);
      enemy.id = idWithRoll(true);

      // (control) with an ordinary custom passive the roll gives ours
      const custom = vi.spyOn(enemy.species, "getCustomPassiveAbility").mockReturnValue(AbilityId.MOXIE);
      expect(enemy.usesCustomPassive()).toBe(true);
      expect(enemy.getPassiveAbility()).toBe(allAbilities[AbilityId.MOXIE]);

      custom.mockReturnValue(AbilityId.TURNABOUT);
      expect(enemy.usesCustomPassive()).toBe(false);
      expect(enemy.getPassiveAbility()).toBe(allAbilities[base]);
    });

    it("the player's Pokémon can still pick Turnabout from our table", async () => {
      await game.classicMode.startBattle(SpeciesId.MAGIKARP);
      const player = game.field.getPlayerPokemon();
      vi.spyOn(player.species, "getCustomPassiveAbility").mockReturnValue(AbilityId.TURNABOUT);
      player.customPassiveSpecies = [player.species.speciesId];

      expect(player.getPassiveAbility()).toBe(allAbilities[AbilityId.TURNABOUT]);
    });
  });
});
