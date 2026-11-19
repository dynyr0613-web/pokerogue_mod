import { getPokemonNameWithAffix } from "#app/messages";
import { allMoves, modifierTypes } from "#data/data-lists";
import { giveEnemyDynamax } from "#data/enemy-dynamax";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { FormChangeItem } from "#enums/form-change-item";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";
import type { FormChangeItemModifierType } from "#modifiers/modifier-type";
import { generateModifierType } from "#mystery-encounters/encounter-phase-utils";
import { GameManager } from "#test/framework/game-manager";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local fork (2026-11-19): the main-series Dynamax rules for a Dynamaxed Pokémon (`Pokemon.isDynamaxed`: a G-Max /
 * E-Max form or the Dynamax state), player and enemy alike: no forced switch, no flinch, weight-based moves fail,
 * Behemoth Blade / Bash x2, no Destiny Bond. The user: "다이맥스 강제 교체와 풀죽음, 체중기술 실패, 거수참/탄 두배, 길동무
 * 면역을 넣도록 하죠, 거다이맥스에도 반영이 아직 안되어있다면 거다이맥스에도 넣고".
 */
describe("Local fork - main-series Dynamax rules (2026-11-19)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .battleType(BattleType.WILD)
      .startingWave(5)
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyHasPassiveAbility(false)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .hasPassiveAbility(false)
      .moveset([MoveId.SPLASH])
      .mysteryEncounterChance(0);
    for (const id of [MoveId.DRAGON_TAIL, MoveId.CIRCLE_THROW]) {
      vi.spyOn(allMoves[id], "accuracy", "get").mockReturnValue(100);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Puts the player's `pokemon` (a species without a G-Max form) in the Dynamax state with active Max Mushrooms */
  function givePlayerDynamax(pokemon: Pokemon): void {
    const type = generateModifierType(modifierTypes.RARE_FORM_CHANGE_ITEM, [
      FormChangeItem.MAX_MUSHROOMS,
    ]) as FormChangeItemModifierType;
    game.scene.addModifier(type.newModifier(pokemon));
    expect(pokemon.hasDynamaxState()).toBe(true);
    expect(pokemon.isDynamaxed()).toBe(true);
  }

  /** Puts `pokemon` in its G-Max form (no Dynamax state, `isMax`) */
  function setGmaxForm(pokemon: Pokemon): void {
    const index = pokemon.species.forms.findIndex(f => f.formKey === SpeciesFormKey.GIGANTAMAX);
    expect(index).toBeGreaterThan(0);
    pokemon.formIndex = index;
    expect(pokemon.isMax()).toBe(true);
    expect(pokemon.hasDynamaxState()).toBe(false);
    expect(pokemon.isDynamaxed()).toBe(true);
  }

  /** Puts the enemy in the Dynamax state (as the enemy roll does) */
  function enemyDynamax(enemy: EnemyPokemon): void {
    expect(giveEnemyDynamax(enemy)).toBe(true);
    expect(enemy.isDynamaxed()).toBe(true);
  }

  const dynamaxKinds = [
    { kind: "the Dynamax state", make: (enemy: EnemyPokemon) => enemyDynamax(enemy) },
    { kind: "a G-Max form", make: (enemy: EnemyPokemon) => setGmaxForm(enemy) },
  ];

  describe("forced switching", () => {
    it.each(dynamaxKinds)(
      "Roar and Whirlwind fail against an enemy in $kind, with the can't-be-switched-out message",
      async ({ make }) => {
        game.override.moveset([MoveId.ROAR, MoveId.WHIRLWIND]);
        await game.classicMode.startBattle(SpeciesId.MILOTIC);
        const player = game.field.getPlayerPokemon();
        const enemy = game.field.getEnemyPokemon();
        make(enemy);
        // The enemy AI reads the same move conditions
        expect(allMoves[MoveId.ROAR].applyConditions(player, enemy, -1)).toBe(false);
        expect(allMoves[MoveId.WHIRLWIND].applyConditions(player, enemy, -1)).toBe(false);

        game.move.select(MoveId.ROAR);
        await game.toNextTurn();
        expect(player).toHaveUsedMove({ move: MoveId.ROAR, result: MoveResult.FAIL });
        expect(enemy.switchOutStatus).toBe(false);
        expect(enemy.isOnField()).toBe(true);
        expect(game).toHaveShownMessage(
          i18next.t("moveTriggers:cannotBeSwitchedOut", { pokemonName: getPokemonNameWithAffix(enemy) }),
        );

        game.move.select(MoveId.WHIRLWIND);
        await game.toNextTurn();
        expect(player).toHaveUsedMove({ move: MoveId.WHIRLWIND, result: MoveResult.FAIL });
        expect(enemy.isOnField()).toBe(true);
        expect(game.scene.currentBattle.turn).toBe(3);
      },
    );

    it("Roar still works against an enemy that is not Dynamaxed (a wild one flees)", async () => {
      game.override.moveset([MoveId.ROAR]);
      await game.classicMode.startBattle(SpeciesId.MILOTIC);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      expect(enemy.isDynamaxed()).toBe(false);
      expect(allMoves[MoveId.ROAR].applyConditions(player, enemy, -1)).toBe(true);
      game.move.select(MoveId.ROAR);
      await game.phaseInterceptor.to("BerryPhase", false);
      expect(enemy.switchOutStatus).toBe(true);
    });

    it.each([MoveId.DRAGON_TAIL, MoveId.CIRCLE_THROW])(
      "%s still deals its damage to a Dynamaxed enemy but does not switch it out",
      async moveId => {
        game.override.moveset([moveId]);
        await game.classicMode.startBattle(SpeciesId.MILOTIC);
        const player = game.field.getPlayerPokemon();
        const enemy = game.field.getEnemyPokemon();
        enemyDynamax(enemy);
        // An attack's switch is no move condition: the AI still sees the damage
        expect(allMoves[moveId].applyConditions(player, enemy, -1)).toBe(true);

        game.move.select(moveId);
        await game.toNextTurn();
        expect(player).toHaveUsedMove({ move: moveId, result: MoveResult.SUCCESS });
        expect(enemy).not.toHaveFullHp();
        expect(enemy.switchOutStatus).toBe(false);
        expect(enemy.isOnField()).toBe(true);
      },
    );

    it.each([
      { kind: "the Dynamax state", species: SpeciesId.MILOTIC, gmax: false },
      { kind: "a G-Max form", species: SpeciesId.SNORLAX, gmax: true },
    ])("an enemy's Roar fails against the player's Pokémon in $kind (player side too)", async ({ species, gmax }) => {
      game.override.enemyMoveset(MoveId.ROAR);
      await game.classicMode.startBattle(species, SpeciesId.MAGIKARP);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      if (gmax) {
        setGmaxForm(player);
      } else {
        givePlayerDynamax(player);
      }
      expect(allMoves[MoveId.ROAR].applyConditions(enemy, player, -1)).toBe(false);

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(enemy).toHaveUsedMove({ move: MoveId.ROAR, result: MoveResult.FAIL });
      expect(game.field.getPlayerPokemon()).toBe(player);
      expect(game.scene.getPlayerParty()[0]).toBe(player);
    });

    it("a Dynamaxed Pokémon can still switch itself out (U-turn is not a forced switch)", async () => {
      game.override.moveset([MoveId.U_TURN]);
      await game.classicMode.startBattle(SpeciesId.MILOTIC, SpeciesId.MAGIKARP);
      const player = game.field.getPlayerPokemon();
      givePlayerDynamax(player);
      game.move.select(MoveId.U_TURN);
      game.doSelectPartyPokemon(1);
      await game.toNextTurn();
      expect(game.field.getPlayerPokemon().species.speciesId).toBe(SpeciesId.MAGIKARP);
    });
  });

  describe("flinching", () => {
    it("Fake Out never flinches the player's Pokémon in the Dynamax state (it still takes the damage)", async () => {
      game.override.enemyMoveset(MoveId.FAKE_OUT).moveset([MoveId.TACKLE]);
      await game.classicMode.startBattle(SpeciesId.MILOTIC);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      givePlayerDynamax(player);

      game.move.select(MoveId.TACKLE);
      await game.toNextTurn();
      expect(enemy).toHaveUsedMove({ move: MoveId.FAKE_OUT, result: MoveResult.SUCCESS });
      expect(player).not.toHaveFullHp();
      // Not flinched: its own attack went through
      expect(enemy).not.toHaveFullHp();
    });

    it("control: Fake Out flinches the same Pokémon when it is not Dynamaxed", async () => {
      game.override.enemyMoveset(MoveId.FAKE_OUT).moveset([MoveId.TACKLE]);
      await game.classicMode.startBattle(SpeciesId.MILOTIC);
      const enemy = game.field.getEnemyPokemon();
      game.move.select(MoveId.TACKLE);
      await game.toNextTurn();
      expect(enemy).toHaveFullHp();
    });

    it.each(dynamaxKinds)(
      "the flinch tag is never added to an enemy in $kind (every flinch source goes through it), and the AI counts no flinch",
      async ({ make }) => {
        await game.classicMode.startBattle(SpeciesId.MILOTIC);
        const player = game.field.getPlayerPokemon();
        const enemy = game.field.getEnemyPokemon();
        const fakeOut = allMoves[MoveId.FAKE_OUT];
        const flinchAttr = fakeOut.getAttrs("FlinchAttr")[0];
        expect(flinchAttr.getTargetBenefitScore(player, enemy, fakeOut)).toBeLessThan(0);
        make(enemy);
        expect(enemy.addTag(BattlerTagType.FLINCHED, 0, MoveId.FAKE_OUT, player.id)).toBe(false);
        expect(enemy.getTag(BattlerTagType.FLINCHED)).toBeUndefined();
        expect(flinchAttr.getTargetBenefitScore(player, enemy, fakeOut)).toBe(0);
        // Not Dynamaxed: the tag goes on
        expect(player.addTag(BattlerTagType.FLINCHED, 0, MoveId.FAKE_OUT, enemy.id)).toBe(true);
      },
    );
  });

  describe("weight-based moves", () => {
    it.each([MoveId.LOW_KICK, MoveId.GRASS_KNOT, MoveId.HEAVY_SLAM, MoveId.HEAT_CRASH])(
      "%s fails against a Dynamaxed enemy (a move condition, so the AI scores it as failing)",
      async moveId => {
        game.override.moveset([moveId]);
        await game.classicMode.startBattle(SpeciesId.MILOTIC);
        const player = game.field.getPlayerPokemon();
        const enemy = game.field.getEnemyPokemon();
        expect(allMoves[moveId].applyConditions(player, enemy, -1)).toBe(true);
        enemyDynamax(enemy);
        expect(allMoves[moveId].applyConditions(player, enemy, -1)).toBe(false);

        game.move.select(moveId);
        await game.toNextTurn();
        expect(player).toHaveUsedMove({ move: moveId, result: MoveResult.FAIL });
        expect(enemy).toHaveFullHp();
      },
    );

    it("they fail against a G-Max form too, and work again against a Pokémon that is not Dynamaxed", async () => {
      await game.classicMode.startBattle(SpeciesId.MILOTIC);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      setGmaxForm(enemy);
      for (const id of [MoveId.LOW_KICK, MoveId.GRASS_KNOT, MoveId.HEAVY_SLAM, MoveId.HEAT_CRASH]) {
        expect(allMoves[id].applyConditions(player, enemy, -1), MoveId[id]).toBe(false);
        // The user being Dynamaxed changes nothing: only the target counts
        expect(allMoves[id].applyConditions(enemy, player, -1), MoveId[id]).toBe(true);
      }
    });
  });

  describe("Behemoth Blade / Bash", () => {
    it.each(dynamaxKinds)(
      "deal double damage to an enemy in $kind; Dynamax Cannon is left as it was",
      async ({ make }) => {
        await game.classicMode.startBattle(SpeciesId.MILOTIC);
        const player = game.field.getPlayerPokemon();
        const enemy = game.field.getEnemyPokemon();
        const ids = [MoveId.BEHEMOTH_BLADE, MoveId.BEHEMOTH_BASH, MoveId.DYNAMAX_CANNON];
        const before = ids.map(id => allMoves[id].calculateBattlePower(player, enemy, true));
        make(enemy);
        const after = ids.map(id => allMoves[id].calculateBattlePower(player, enemy, true));
        expect(after[0]).toBe(before[0] * 2);
        expect(after[1]).toBe(before[1] * 2);
        expect(after[2]).toBe(before[2]);
        // The user being Dynamaxed changes nothing
        expect(allMoves[MoveId.BEHEMOTH_BLADE].calculateBattlePower(enemy, player, true)).toBe(before[0]);
      },
    );
  });

  describe("Destiny Bond", () => {
    beforeEach(() => {
      game.override.enemySpecies(SpeciesId.RATTATA).enemyLevel(5).enemyMoveset(MoveId.DESTINY_BOND);
    });

    it.each([
      { kind: "the Dynamax state", species: SpeciesId.MILOTIC, gmax: false },
      { kind: "a G-Max form", species: SpeciesId.SNORLAX, gmax: true },
    ])("never takes down the player's Pokémon in $kind, with the bosses' message", async ({ species, gmax }) => {
      game.override.moveset([MoveId.TACKLE]);
      await game.classicMode.startBattle(species);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      if (gmax) {
        setGmaxForm(player);
      } else {
        givePlayerDynamax(player);
      }

      game.move.select(MoveId.TACKLE);
      game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER]);
      await game.phaseInterceptor.to("BerryPhase");
      expect(enemy).toHaveFainted();
      expect(player).not.toHaveFainted();
      expect(game).toHaveShownMessage(
        i18next.t("battlerTags:destinyBondLapseIsBoss", { pokemonNameWithAffix: getPokemonNameWithAffix(player) }),
      );
    });

    it("control: it takes down the same Pokémon when it is not Dynamaxed", async () => {
      game.override.moveset([MoveId.TACKLE]);
      await game.classicMode.startBattle(SpeciesId.MILOTIC, SpeciesId.MAGIKARP);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      game.move.select(MoveId.TACKLE);
      game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER]);
      await game.phaseInterceptor.to("BerryPhase");
      expect(enemy).toHaveFainted();
      expect(player).toHaveFainted();
    });

    it("the enemy AI scores it as failing while every opponent on the field is Dynamaxed", async () => {
      await game.classicMode.startBattle(SpeciesId.MILOTIC);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const destinyBond = allMoves[MoveId.DESTINY_BOND];
      const attr = destinyBond.getAttrs("DestinyBondAttr")[0];
      expect(attr.getUserBenefitScore(enemy, enemy, destinyBond)).toBeGreaterThan(-20);
      givePlayerDynamax(player);
      expect(attr.getUserBenefitScore(enemy, enemy, destinyBond)).toBe(-20);
    });
  });
});
