import { PLAYER_HELD_ITEM_CAPS } from "#balance/endless-balance";
import { allMoves, modifierTypes } from "#data/data-lists";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { getCustomModifierClass, PRISM_SPLASH_RATIO, PrismModifier } from "#modifiers/custom-held-items";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import { CritBoosterModifier, PokemonMultiHitModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import { getModifierPoolForType } from "#utils/modifier-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The user's item changes of 2026-11-05: Scope Lens up to 3 (+1 crit stage each), Multi Lens up to 4 with the
 * first hit fixed at 75%, and the MASTER item Prism (half of each single-target hit lands on the target's
 * partner). The vests (up to 3, added up) are in custom-vests.test.ts.
 * Local fork (2026-11-13): 10 명세 1번, Multi Lens up to 3 on the player's Pokémon (4 strikes, 75/25/25/25 = x1.50).
 */
describe("Custom items 2026-11-05 - Scope Lens, Multi Lens, Prism", () => {
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
      .startingLevel(99)
      .enemyLevel(99)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .passiveAbility(AbilityId.NO_GUARD)
      .moveset([MoveId.TACKLE, MoveId.SPLASH, MoveId.ROCK_SLIDE, MoveId.SEISMIC_TOSS]);
  });

  function newItem(name: "SCOPE_LENS" | "MULTI_LENS" | "PRISM" | "LEEK", pokemon: Pokemon): PokemonHeldItemModifier {
    return modifierTypes[name]().withIdFromFunc(modifierTypes[name]).newModifier(pokemon) as PokemonHeldItemModifier;
  }

  describe("Scope Lens", () => {
    it.each([1, 2, 3])("adds one crit stage per lens (%i)", async count => {
      game.override.startingHeldItems([{ name: "SCOPE_LENS", count }]);
      await game.classicMode.startBattle(SpeciesId.MAGIKARP);
      const player = game.field.getPlayerPokemon();
      const lens = player.getHeldItems().find(m => m instanceof CritBoosterModifier)!;
      expect(lens.stackCount).toBe(count);
      expect(game.field.getEnemyPokemon().getCritStage(player, allMoves[MoveId.TACKLE])).toBe(count);
    });

    it("stacks to 3 on the player's Pokemon, 1 on an enemy, and Leek stays at 1", async () => {
      game.override.startingHeldItems([{ name: "SCOPE_LENS" }]).enemyHeldItems([{ name: "SCOPE_LENS" }]);
      await game.classicMode.startBattle(SpeciesId.FARFETCHD);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const lens = player.getHeldItems().find(m => m instanceof CritBoosterModifier)!;
      expect(lens.getMaxStackCount()).toBe(PLAYER_HELD_ITEM_CAPS.SCOPE_LENS);
      for (let i = 0; i < 4; i++) {
        game.scene.addModifier(newItem("SCOPE_LENS", player), true);
      }
      expect(lens.stackCount).toBe(3);
      expect(
        enemy
          .getHeldItems()
          .find(m => m instanceof CritBoosterModifier)!
          .getMaxHeldItemCount(enemy),
      ).toBe(1);
      expect(newItem("LEEK", player).getMaxHeldItemCount(player)).toBe(1);
    });
  });

  describe("Multi Lens", () => {
    it("stacks to 3 on the player's Pokemon in Classic and 2 on an enemy", async () => {
      // Local fork (2026-11-13): 10 명세 1번, "아군 멀티렌즈 최대 보유 상한 4 → 3 (적 상한 2는 그대로 유지)"
      expect(PLAYER_HELD_ITEM_CAPS.MULTI_LENS).toBe(3);
      game.override
        .startingHeldItems([{ name: "MULTI_LENS", count: PLAYER_HELD_ITEM_CAPS.MULTI_LENS }])
        .enemyHeldItems([{ name: "MULTI_LENS" }]);
      await game.classicMode.startBattle(SpeciesId.MAGIKARP);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const lens = player.getHeldItems().find(m => m instanceof PokemonMultiHitModifier)!;
      expect(lens.stackCount).toBe(3);
      expect(lens.getMaxStackCount()).toBe(PLAYER_HELD_ITEM_CAPS.MULTI_LENS);
      expect(
        enemy
          .getHeldItems()
          .find(m => m instanceof PokemonMultiHitModifier)!
          .getMaxHeldItemCount(enemy),
      ).toBe(2);
    });

    it("keeps the 75% first hit on fixed-damage moves too", async () => {
      game.override.startingHeldItems([{ name: "MULTI_LENS", count: PLAYER_HELD_ITEM_CAPS.MULTI_LENS }]);
      await game.classicMode.startBattle(SpeciesId.MAGIKARP);
      const enemy = game.field.getEnemyPokemon();
      const spy = vi.spyOn(enemy, "getAttackDamage");

      game.move.select(MoveId.SEISMIC_TOSS);
      await game.phaseInterceptor.to("MoveEndPhase", false);

      // Seismic Toss deals the user's level (99) per strike, scaled by the lens multiplier
      expect(spy.mock.results.map(r => r.value?.damage)).toEqual([74, 24, 24, 24]);
    });

    /**
     * The player's Pokémon (a Lapras: no STAB on Tackle) uses Tackle, a fixed 100 base damage per strike; returns each
     * strike's damage
     */
    async function tackleStrikes(): Promise<number[]> {
      const enemy = game.field.getEnemyPokemon();
      const spy = vi.spyOn(enemy, "getAttackDamage");
      vi.spyOn(enemy, "getBaseDamage").mockReturnValue(100);
      game.move.select(MoveId.TACKLE);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
      await game.phaseInterceptor.to("MoveEndPhase", false);
      return spy.mock.results.map(r => r.value?.damage);
    }

    // Local fork (2026-11-13): 10 명세 1번, "3개 (아군 상한): 4연타 (75% + 25% + 25% + 25% = 총합 ×1.50)"
    it("gives the player's 3 lenses 4 strikes: 75/25/25/25, x1.50 in all", async () => {
      game.override.startingHeldItems([{ name: "MULTI_LENS", count: 3 }]);
      await game.classicMode.startBattle(SpeciesId.LAPRAS);
      const player = game.field.getPlayerPokemon();

      const strikes = await tackleStrikes();

      expect(player.turnData.hitCount).toBe(4);
      expect(strikes).toEqual([75, 25, 25, 25]);
      expect(strikes.reduce((a, b) => a + b, 0)).toBe(150);
    });

    // "기존 세이브 호환: 이미 4개를 든 세이브를 불러올 경우를 대비해 ... Math.min(stackCount, 3)(아군 기준)으로 클램프"
    it("lets only 3 of an older stack of 4 lenses strike on the player's Pokemon, keeping the stack", async () => {
      game.override.startingHeldItems([{ name: "MULTI_LENS", count: 4 }]);
      await game.classicMode.startBattle(SpeciesId.LAPRAS);
      const player = game.field.getPlayerPokemon();
      const lens = player.getHeldItems().find(m => m instanceof PokemonMultiHitModifier)!;
      expect(lens.stackCount).toBe(4);
      expect(lens.getEffectiveStackCount(player)).toBe(PLAYER_HELD_ITEM_CAPS.MULTI_LENS);

      const strikes = await tackleStrikes();

      expect(player.turnData.hitCount).toBe(1 + PLAYER_HELD_ITEM_CAPS.MULTI_LENS);
      expect(strikes).toEqual([75, 25, 25, 25]);
      // the item itself is untouched
      expect(lens.stackCount).toBe(4);
    });

    it("still finds Parental Bond's strike after an older stack of 4 lenses", async () => {
      game.override.startingHeldItems([{ name: "MULTI_LENS", count: 4 }]).ability(AbilityId.PARENTAL_BOND);
      await game.classicMode.startBattle(SpeciesId.LAPRAS);
      const player = game.field.getPlayerPokemon();

      const strikes = await tackleStrikes();

      // 1 + 3 lens strikes + Parental Bond's, which the lens leaves alone (only Parental Bond's own 0.25x)
      expect(player.turnData.hitCount).toBe(1 + PLAYER_HELD_ITEM_CAPS.MULTI_LENS + 1);
      expect(strikes).toEqual([75, 25, 25, 25, 25]);
    });

    it("lets an enemy strike with its whole stack, even past its base cap of 2 (copied stacks)", async () => {
      game.override
        .enemySpecies(SpeciesId.LAPRAS) // no STAB on Tackle
        .enemyHeldItems([{ name: "MULTI_LENS", count: 4 }])
        .enemyMoveset(MoveId.TACKLE);
      await game.classicMode.startBattle(SpeciesId.LAPRAS);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const lens = enemy.getHeldItems().find(m => m instanceof PokemonMultiHitModifier)!;
      expect(lens.getMaxHeldItemCount(enemy)).toBe(2);
      expect(lens.getEffectiveStackCount(enemy)).toBe(4);
      const spy = vi.spyOn(player, "getAttackDamage");
      vi.spyOn(player, "getBaseDamage").mockReturnValue(100);

      game.move.select(MoveId.SPLASH);
      game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER]);
      await game.phaseInterceptor.to("MoveEndPhase", false);

      expect(enemy.turnData.hitCount).toBe(5);
      expect(spy.mock.results.map(r => r.value?.damage)).toEqual([75, 25, 25, 25, 25]);
    });
  });

  describe("Prism", () => {
    beforeEach(() => {
      game.override.battleStyle("double");
    });

    /** Player 1 uses `move` on enemy 1 (single target) or on both; player 2 splashes; enemies splash */
    async function attack(move: MoveId): Promise<void> {
      if (allMoves[move].isMultiTarget()) {
        game.move.select(move, BattlerIndex.PLAYER);
      } else {
        game.move.select(move, BattlerIndex.PLAYER, BattlerIndex.ENEMY);
      }
      game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
      await game.toEndOfTurn();
    }

    function lost(pokemon: Pokemon): number {
      return pokemon.getMaxHp() - pokemon.hp;
    }

    it("sends 50% of a single-target hit to the target's partner", async () => {
      game.override.startingHeldItems([{ name: "PRISM" }]);
      await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.MAGIKARP);
      const [target, partner] = game.scene.getEnemyField();
      vi.spyOn(target, "getBaseDamage").mockReturnValue(100);

      await attack(MoveId.TACKLE);

      expect(lost(target)).toBe(100);
      expect(lost(partner)).toBe(100 * PRISM_SPLASH_RATIO);
    });

    for (const [count, share] of [
      [2, 75],
      [3, 100],
    ] as const) {
      it(`sends ${share}% with ${count} Prisms`, async () => {
        game.override.startingHeldItems([{ name: "PRISM", count }]);
        await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.MAGIKARP);
        const [target, partner] = game.scene.getEnemyField();
        vi.spyOn(target, "getBaseDamage").mockReturnValue(100);

        await attack(MoveId.TACKLE);

        expect(lost(target)).toBe(100);
        expect(lost(partner)).toBe(share);
      });
    }

    // Local fork (2026-11-13): 3 lenses since 10 명세 1번 (4 before)
    it("splashes every Multi Lens strike: 75/25/25/25 on the target, 37/12/12/12 on the partner", async () => {
      game.override.startingHeldItems([
        { name: "PRISM" },
        { name: "MULTI_LENS", count: PLAYER_HELD_ITEM_CAPS.MULTI_LENS },
      ]);
      await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.MAGIKARP);
      const [target, partner] = game.scene.getEnemyField();
      vi.spyOn(target, "getBaseDamage").mockReturnValue(100);

      await attack(MoveId.TACKLE);

      expect(lost(target)).toBe(75 + 25 * 3);
      expect(lost(partner)).toBe(37 + 12 * 3);
    });

    it("does nothing for spread moves", async () => {
      game.override.startingHeldItems([{ name: "PRISM" }]);
      await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.MAGIKARP);
      const [first, second] = game.scene.getEnemyField();
      vi.spyOn(first, "getBaseDamage").mockReturnValue(100);
      vi.spyOn(second, "getBaseDamage").mockReturnValue(100);

      await attack(MoveId.ROCK_SLIDE);

      // Each takes only its own spread hit (100 x 0.75)
      expect(lost(first)).toBe(75);
      expect(lost(second)).toBe(75);
    });

    it("treats Expanding Force in Psychic Terrain as a spread move", async () => {
      game.override
        .startingHeldItems([{ name: "PRISM" }])
        .moveset([MoveId.EXPANDING_FORCE, MoveId.SPLASH])
        .startingTerrain(TerrainType.PSYCHIC);
      await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.MAGIKARP);
      const [first, second] = game.scene.getEnemyField();
      vi.spyOn(first, "getBaseDamage").mockReturnValue(100);
      vi.spyOn(second, "getBaseDamage").mockReturnValue(100);

      game.move.select(MoveId.EXPANDING_FORCE, BattlerIndex.PLAYER, BattlerIndex.ENEMY);
      game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
      await game.toEndOfTurn();

      // Both foes take only the spread hit (x0.75), no splash on top
      expect(lost(first)).toBe(lost(second));
      expect(lost(first)).toBeGreaterThan(0);
      expect(first.turnData.attacksReceived).toHaveLength(1);
      expect(lost(first)).toBe(first.turnData.attacksReceived[0].damage);
    });

    it("lets a partner with Wimp Out flee after a Multi Lens splash takes it below half", async () => {
      game.override.startingHeldItems([
        { name: "PRISM" },
        { name: "MULTI_LENS", count: PLAYER_HELD_ITEM_CAPS.MULTI_LENS },
      ]);
      await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.MAGIKARP);
      const [target, partner] = game.scene.getEnemyField();
      game.field.mockAbility(partner, AbilityId.WIMP_OUT);
      vi.spyOn(target, "getBaseDamage").mockReturnValue(100);
      partner.hp = Math.floor(partner.getMaxHp() / 2) + 40;
      const startHp = partner.hp;

      await attack(MoveId.TACKLE);

      // 37 + 12 x 3 = 73 splash in four strikes (3 lenses since 2026-11-13); Wimp Out checks the total after the last one
      expect(startHp - partner.hp).toBe(73);
      expect(partner.switchOutStatus).toBe(true);
    });

    it("does not reach a partner that protected itself", async () => {
      game.override.startingHeldItems([{ name: "PRISM" }]);
      await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.MAGIKARP);
      const [target, partner] = game.scene.getEnemyField();
      vi.spyOn(target, "getBaseDamage").mockReturnValue(100);

      game.move.select(MoveId.TACKLE, BattlerIndex.PLAYER, BattlerIndex.ENEMY);
      game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
      await game.move.forceEnemyMove(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.PROTECT);
      await game.toEndOfTurn();

      expect(lost(target)).toBe(100);
      expect(lost(partner)).toBe(0);
    });

    it("does nothing without a Prism or in a single battle", async () => {
      await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.MAGIKARP);
      const [target, partner] = game.scene.getEnemyField();
      vi.spyOn(target, "getBaseDamage").mockReturnValue(100);
      await attack(MoveId.TACKLE);
      expect(lost(target)).toBe(100);
      expect(lost(partner)).toBe(0);
    });

    it("is harmless in a single battle", async () => {
      game.override.battleStyle("single").startingHeldItems([{ name: "PRISM" }]);
      await game.classicMode.startBattle(SpeciesId.MAGIKARP);
      const enemy = game.field.getEnemyPokemon();
      vi.spyOn(enemy, "getBaseDamage").mockReturnValue(100);
      game.move.select(MoveId.TACKLE);
      await game.toEndOfTurn();
      expect(lost(enemy)).toBe(100);
    });

    it("stacks to 3 on the player's Pokemon (1 on an enemy), is restored from saves, and leaves the pool once one holds 3", async () => {
      game.override.startingHeldItems([{ name: "PRISM" }]);
      await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.FEEBAS);
      const party = game.scene.getPlayerParty();
      const prism = party[0].getHeldItems().find(m => m instanceof PrismModifier)!;
      expect(prism.getMaxStackCount()).toBe(3);
      expect(prism.getMaxHeldItemCount(game.field.getEnemyPokemon())).toBe(1);
      expect(getCustomModifierClass("PrismModifier")).toBe(PrismModifier);

      const entry = getModifierPoolForType(ModifierPoolType.PLAYER)[ModifierTier.MASTER].find(
        w => w.modifierType.id === "PRISM",
      )!;
      expect(entry.maxWeight).toBe(12);
      const weight = entry.weight as WeightedModifierTypeWeightFunc;
      // Only the lead got one from the starting override; both still have room
      expect(weight(party, 0)).toBe(12);
      for (let i = 0; i < 2; i++) {
        game.scene.addModifier(newItem("PRISM", party[0]), true);
      }
      expect(prism.stackCount).toBe(3);
      // Since 2026-11-06 one full holder is enough: no Prism while the lead holds 3, though Feebas has room
      expect(weight(party, 0)).toBe(0);
      // a fourth Prism is refused
      game.scene.addModifier(newItem("PRISM", party[0]), true);
      expect(prism.stackCount).toBe(3);
    });
  });
});
