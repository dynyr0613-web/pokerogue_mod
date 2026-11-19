// Local fork (2026-11-19): 1.2.0 E2 part A (the user: "e2 구현"). Four moves that were only partly implemented (shown
// with " (P)") now work in full: Uproar (소란피기, UproarTag), Rollout (구르기) and Ice Ball (아이스볼) (RolloutTag +
// RolloutPowerAttr), and Pursuit (따라가때리기, custom-pursuit.ts + SwitchSummonPhase).
import { getPokemonNameWithAffix } from "#app/messages";
import { isUproarActive } from "#data/battler-tags";
import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import i18next from "i18next";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Local fork (2026-11-19) - partial moves made whole (E2 part A)", () => {
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
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SHUCKLE)
      .startingLevel(100)
      .enemyLevel(100)
      .enemyMoveset(MoveId.SPLASH);
  });

  it("no longer marks the four moves as partial", () => {
    for (const moveId of [MoveId.UPROAR, MoveId.ROLLOUT, MoveId.ICE_BALL, MoveId.PURSUIT]) {
      expect(allMoves[moveId].name, MoveId[moveId]).not.toContain("(P)");
    }
  });

  describe("Uproar (소란피기)", () => {
    beforeEach(() => {
      game.override.moveset([MoveId.UPROAR, MoveId.SPLASH]);
    });

    it("locks the user in for 3 turns, using PP once", async () => {
      await game.classicMode.startBattle(SpeciesId.EXPLOUD);
      const player = game.field.getPlayerPokemon();

      game.move.select(MoveId.UPROAR);
      await game.toNextTurn();
      expect(player).toHaveBattlerTag({ tagType: BattlerTagType.UPROAR, turnCount: 2 });
      expect(player.getMoveQueue()).toHaveLength(1);

      await game.toNextTurn(); // turn 2: no command, the queued Uproar runs
      expect(player).toHaveBattlerTag({ tagType: BattlerTagType.UPROAR, turnCount: 1 });

      await game.toNextTurn(); // turn 3: the last one
      expect(player).not.toHaveBattlerTag(BattlerTagType.UPROAR);
      expect(player.getMoveQueue()).toHaveLength(0);
      const uses = player.getMoveHistory().filter(m => m.move === MoveId.UPROAR);
      expect(uses).toHaveLength(3);
      expect(uses.every(m => m.result === MoveResult.SUCCESS)).toBe(true);
      expect(player.getMoveset().find(m => m.moveId === MoveId.UPROAR)?.ppUsed).toBe(1);
      expect(game.textInterceptor.logs).toContain(
        i18next.t("battlerTags:uproarOnRemove", { pokemonNameWithAffix: getPokemonNameWithAffix(player) }),
      );

      // Free again: a new command is taken
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(player).toHaveUsedMove(MoveId.SPLASH);
    });

    it("keeps every Pokémon awake while it lasts: sleep moves and Rest fail", async () => {
      game.override.enemyMoveset([MoveId.SPORE, MoveId.REST]);
      await game.classicMode.startBattle(SpeciesId.EXPLOUD);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.move.select(MoveId.UPROAR);
      await game.move.selectEnemyMove(MoveId.SPORE);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
      await game.toNextTurn();

      expect(player).toHaveStatusEffect(StatusEffect.NONE);
      expect(game.textInterceptor.logs).toContain(
        i18next.t("battlerTags:uproarPreventSleep", { pokemonNameWithAffix: getPokemonNameWithAffix(player) }),
      );

      expect(enemy.hp).toBeLessThan(enemy.getMaxHp());
      await game.move.selectEnemyMove(MoveId.REST);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
      await game.toNextTurn();

      expect(enemy).toHaveStatusEffect(StatusEffect.NONE);
      expect(enemy).toHaveUsedMove({ move: MoveId.REST, result: MoveResult.FAIL });
    });

    it("wakes every sleeping Pokémon on the field, one with Soundproof too", async () => {
      game.override.battleStyle("double").enemyStatusEffect(StatusEffect.SLEEP);
      await game.classicMode.startBattle(SpeciesId.EXPLOUD, SpeciesId.FEEBAS);
      const [enemy1, enemy2] = game.scene.getEnemyField();
      enemy1.setTempAbility(AbilityId.SOUNDPROOF);

      game.move.select(MoveId.UPROAR, BattlerIndex.PLAYER);
      game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.PLAYER_2, BattlerIndex.ENEMY, BattlerIndex.ENEMY_2]);
      await game.toEndOfTurn();

      // The random target of the stubbed RNG is the second enemy, which has no Soundproof (the hit would fail on the first)
      expect(game.field.getPlayerPokemon()).toHaveUsedMove({
        move: MoveId.UPROAR,
        targets: [BattlerIndex.ENEMY_2],
        result: MoveResult.SUCCESS,
      });
      expect(enemy2).toHaveStatusEffect(StatusEffect.NONE);
      // E2 review: as in the current games, Soundproof blocks the hit but not the wake-up
      expect(enemy1).toHaveStatusEffect(StatusEffect.NONE);
      expect(game.textInterceptor.logs).toContain(
        i18next.t("battlerTags:uproarWake", { pokemonNameWithAffix: getPokemonNameWithAffix(enemy1) }),
      );
    });

    it("ends early on Throat Chop", async () => {
      game.override.enemyMoveset([MoveId.THROAT_CHOP, MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.EXPLOUD);
      const player = game.field.getPlayerPokemon();

      game.move.select(MoveId.UPROAR);
      await game.move.selectEnemyMove(MoveId.THROAT_CHOP);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
      await game.toNextTurn();
      expect(player).toHaveBattlerTag(BattlerTagType.THROAT_CHOPPED);
      expect(isUproarActive()).toBe(false);

      // The lock is lifted (Uproar cannot be used), so a new command is taken, and the uproar ends with it
      game.move.select(MoveId.SPLASH);
      await game.move.selectEnemyMove(MoveId.SPLASH);
      await game.toNextTurn();
      expect(player).toHaveUsedMove(MoveId.SPLASH);
      expect(player).not.toHaveBattlerTag(BattlerTagType.UPROAR);
      expect(player.getMoveQueue()).toHaveLength(0);
    });
  });

  describe.each([
    { name: "Rollout (구르기)", moveId: MoveId.ROLLOUT },
    { name: "Ice Ball (아이스볼)", moveId: MoveId.ICE_BALL },
  ])("$name", ({ moveId }) => {
    beforeEach(() => {
      // A weak user against a sturdy target, so five hits never knock it out
      game.override.moveset([moveId, MoveId.DEFENSE_CURL, MoveId.SPLASH]).startingLevel(5);
    });

    /** Use the chain for `turns` turns (chosen only on the first) and return the power of each hit */
    async function rollFor(turns: number): Promise<number[]> {
      const powerSpy = vi.spyOn(allMoves[moveId], "calculateBattlePower");
      const powers: number[] = [];
      game.move.select(moveId);
      for (let i = 0; i < turns; i++) {
        game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
        await game.toNextTurn();
        powers.push(powerSpy.mock.results.at(-1)?.value);
      }
      return powers;
    }

    it("locks the user in for 5 turns, doubling the power on each hit, then starts over", async () => {
      vi.spyOn(allMoves[moveId], "accuracy", "get").mockReturnValue(100);
      await game.classicMode.startBattle(SpeciesId.MAGIKARP);
      const player = game.field.getPlayerPokemon();

      const powers = await rollFor(5);
      expect(powers).toEqual([30, 60, 120, 240, 480]);
      expect(player).not.toHaveBattlerTag(BattlerTagType.ROLLOUT);
      expect(player.getMoveQueue()).toHaveLength(0);
      expect(player.getMoveset().find(m => m.moveId === moveId)?.ppUsed).toBe(1);

      expect(await rollFor(1)).toEqual([30]); // a new chain
      expect(player).toHaveBattlerTag({ tagType: BattlerTagType.ROLLOUT, turnCount: 4 });
    });

    it("doubles every hit once Defense Curl was used", async () => {
      vi.spyOn(allMoves[moveId], "accuracy", "get").mockReturnValue(100);
      await game.classicMode.startBattle(SpeciesId.MAGIKARP);

      game.move.select(MoveId.DEFENSE_CURL);
      await game.toNextTurn();

      expect(await rollFor(5)).toEqual([60, 120, 240, 480, 960]);
    });

    it("ends the chain on a miss", async () => {
      await game.classicMode.startBattle(SpeciesId.MAGIKARP);
      const player = game.field.getPlayerPokemon();
      const powerSpy = vi.spyOn(allMoves[moveId], "calculateBattlePower");

      game.move.select(moveId);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
      await game.move.forceHit();
      await game.toNextTurn();
      expect(powerSpy).toHaveLastReturnedWith(30);
      expect(player).toHaveBattlerTag(BattlerTagType.ROLLOUT);

      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
      await game.move.forceMiss();
      await game.toNextTurn();
      expect(player).toHaveUsedMove({ move: moveId, result: MoveResult.MISS });
      expect(player).not.toHaveBattlerTag(BattlerTagType.ROLLOUT);
      expect(player.getMoveQueue()).toHaveLength(0);

      game.move.select(moveId);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
      await game.move.forceHit();
      await game.toNextTurn();
      expect(powerSpy).toHaveLastReturnedWith(30);
    });
  });

  describe("Pursuit (따라가때리기)", () => {
    it("hits a switching target before it leaves, at double power, and does not move again", async () => {
      game.override.enemyMoveset([MoveId.PURSUIT, MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MILOTIC);
      const [feebas, milotic] = game.scene.getPlayerParty();
      const enemy = game.field.getEnemyPokemon();
      const powerSpy = vi.spyOn(allMoves[MoveId.PURSUIT], "calculateBattlePower");

      game.doSwitchPokemon(1);
      await game.move.selectEnemyMove(MoveId.PURSUIT);
      await game.toNextTurn();

      expect(game.field.getPlayerPokemon()).toBe(milotic);
      expect(feebas.hp).toBeLessThan(feebas.getMaxHp());
      expect(milotic.hp).toBe(milotic.getMaxHp());
      expect(powerSpy).toHaveLastReturnedWith(80);
      const pursuits = enemy.getMoveHistory().filter(m => m.move === MoveId.PURSUIT);
      expect(pursuits).toHaveLength(1);
      expect(pursuits[0].result).toBe(MoveResult.SUCCESS);
    });

    it("has its normal power when the target stays in", async () => {
      game.override.enemyMoveset([MoveId.PURSUIT, MoveId.SPLASH]).moveset(MoveId.SPLASH);
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MILOTIC);
      const powerSpy = vi.spyOn(allMoves[MoveId.PURSUIT], "calculateBattlePower");

      game.move.select(MoveId.SPLASH);
      await game.move.selectEnemyMove(MoveId.PURSUIT);
      await game.toNextTurn();

      expect(powerSpy).toHaveLastReturnedWith(40);
      expect(game.field.getPlayerPokemon().hp).toBeLessThan(game.field.getPlayerPokemon().getMaxHp());
    });

    it("catches an enemy trainer's Pokémon switching out", async () => {
      game.override.startingWave(5).moveset(MoveId.PURSUIT).enemySpecies(SpeciesId.MAGIKARP);
      await game.classicMode.startBattle(SpeciesId.HOUNDOOM);
      const [enemy1, enemy2] = game.scene.getEnemyParty();
      const powerSpy = vi.spyOn(allMoves[MoveId.PURSUIT], "calculateBattlePower");

      game.move.select(MoveId.PURSUIT);
      game.forceEnemyToSwitch();
      await game.toNextTurn();

      expect(game.field.getEnemyPokemon()).toBe(enemy2);
      expect(enemy1.hp).toBeLessThan(enemy1.getMaxHp());
      expect(enemy2.hp).toBe(enemy2.getMaxHp());
      expect(powerSpy).toHaveLastReturnedWith(80);
    });

    it("knocking out the switching Pokémon cancels the switch; it is replaced like any fainted Pokémon", async () => {
      game.override.enemyMoveset([MoveId.PURSUIT, MoveId.SPLASH]).enemySpecies(SpeciesId.HOUNDOOM);
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MILOTIC, SpeciesId.MAGIKARP);
      const [feebas, milotic, magikarp] = game.scene.getPlayerParty();
      feebas.hp = 1;

      game.doSwitchPokemon(1);
      await game.move.selectEnemyMove(MoveId.PURSUIT);
      game.doSelectPartyPokemon(2); // the replacement picked after the faint
      await game.toNextTurn();

      expect(feebas.isFainted()).toBe(true);
      expect(game.field.getPlayerPokemon()).toBe(magikarp);
      expect(milotic.isOnField()).toBe(false);
      expect(milotic.hp).toBe(milotic.getMaxHp());
    });

    it("catches whichever foe switches in a Double Battle", async () => {
      game.override.battleStyle("double").enemyMoveset([MoveId.PURSUIT, MoveId.SPLASH]).moveset(MoveId.SPLASH);
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP, SpeciesId.MILOTIC);
      const [feebas, magikarp, milotic] = game.scene.getPlayerParty();
      const powerSpy = vi.spyOn(allMoves[MoveId.PURSUIT], "calculateBattlePower");

      game.doSwitchPokemon(2);
      game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
      await game.move.selectEnemyMove(MoveId.PURSUIT, BattlerIndex.PLAYER_2);
      await game.move.selectEnemyMove(MoveId.SPLASH);
      await game.toNextTurn();

      expect(game.scene.getPlayerField()).toContain(milotic);
      expect(feebas.hp).toBeLessThan(feebas.getMaxHp());
      expect(magikarp.hp).toBe(magikarp.getMaxHp());
      expect(milotic.hp).toBe(milotic.getMaxHp());
      expect(powerSpy).toHaveLastReturnedWith(80);
    });

    // Local fork (2026-11-19), E2 review: a Pursuit hit as it leaves does not set off Wimp Out / Emergency Exit (it used
    // to queue a second switch on top of the chosen one)
    it("does not set off Wimp Out on the Pokémon it catches switching out", async () => {
      game.override
        .ability(AbilityId.WIMP_OUT)
        .startingLevel(60)
        .enemySpecies(SpeciesId.HOUNDOOM)
        .enemyLevel(20)
        .enemyMoveset([MoveId.PURSUIT, MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.WIMPOD, SpeciesId.FEEBAS, SpeciesId.MILOTIC);
      const [wimpod, feebas] = game.scene.getPlayerParty();
      wimpod.hp = Math.floor(wimpod.getMaxHp() / 2) + 2;

      game.doSwitchPokemon(1);
      await game.move.selectEnemyMove(MoveId.PURSUIT);
      await game.toNextTurn();

      expect(wimpod.getHpRatio()).toBeLessThan(0.5);
      expect(wimpod.isFainted()).toBe(false);
      expect(game.field.getPlayerPokemon()).toBe(feebas);
      expect(game.phaseInterceptor.phaseLog).not.toContain("SwitchPhase");
    });

    // Local fork (2026-11-19), E2 review: a pursuer that Terastallizes that turn does so before its Pursuit
    it("lets a pursuer Terastallize before it hits", async () => {
      game.override.startingWave(5).moveset(MoveId.PURSUIT).enemySpecies(SpeciesId.MAGIKARP);
      await game.classicMode.startBattle(SpeciesId.HOUNDOOM);
      const player = game.field.getPlayerPokemon();
      const teraWhenHit: boolean[] = [];
      const calculateBattlePower = allMoves[MoveId.PURSUIT].calculateBattlePower.bind(allMoves[MoveId.PURSUIT]);
      vi.spyOn(allMoves[MoveId.PURSUIT], "calculateBattlePower").mockImplementation((...args) => {
        teraWhenHit.push(player.isTerastallized);
        return calculateBattlePower(...args);
      });

      game.move.selectWithTera(MoveId.PURSUIT);
      game.forceEnemyToSwitch();
      await game.toNextTurn();

      expect(player.isTerastallized).toBe(true);
      expect(teraWhenHit.length).toBeGreaterThan(0);
      expect(teraWhenHit).not.toContain(false);
      const log = game.phaseInterceptor.phaseLog;
      expect(log.indexOf("TeraPhase")).toBeLessThan(log.indexOf("MovePhase"));
    });
  });
});
