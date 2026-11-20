// Local fork (2026-11-20): 1.2.0 fixes (the user: "따라가때리기 - 본가 그대로", "원더룸 - 본가 규칙 따르기").
// Pursuit (따라가때리기, custom-pursuit.ts) now behaves as in the main series (Generations IV-VII, as Pokémon Showdown has
// it): it also catches a foe leaving through its own switching move (U-turn ...) but not Baton Pass or Wimp Out, never
// misses a foe it catches, and the switcher's Destiny Bond does not hold. Wonder Room (원더룸) keeps the main series'
// exceptions: Download, Protosynthesis / Quark Drive / Booster Energy, Body Press and Shell Side Arm's check read the
// Pokémon's own Defense / Sp. Def with the other defensive stat's stages; Beast Boost sees the swap; Psyshock, Psystrike,
// Secret Sword and confusion follow the swap.
import { beastBoostHighestStatCalc } from "#abilities/custom-ability-helpers";
import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { getHighestStat } from "#modifiers/battle-held-items";
import { MoveEndPhase } from "#phases/move-end-phase";
import { MovePhase } from "#phases/move-phase";
import { SwitchSummonPhase } from "#phases/switch-summon-phase";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Local fork (2026-11-20) - Pursuit and Wonder Room as in the main series", () => {
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

  describe("Pursuit (따라가때리기)", () => {
    beforeEach(() => {
      game.override
        .moveset([MoveId.U_TURN, MoveId.BATON_PASS, MoveId.DESTINY_BOND, MoveId.SPLASH])
        .enemyMoveset([MoveId.PURSUIT, MoveId.SPLASH]);
    });

    it("catches a Pokémon leaving through U-turn after its move, at double power, before it goes", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MILOTIC);
      const [feebas, milotic] = game.scene.getPlayerParty();
      const enemy = game.field.getEnemyPokemon();
      const powerSpy = vi.spyOn(allMoves[MoveId.PURSUIT], "calculateBattlePower");

      game.move.select(MoveId.U_TURN);
      await game.move.selectEnemyMove(MoveId.PURSUIT);
      game.doSelectPartyPokemon(1);
      await game.toNextTurn();

      expect(enemy.hp).toBeLessThan(enemy.getMaxHp()); // U-turn landed first
      expect(feebas.hp).toBeLessThan(feebas.getMaxHp());
      expect(powerSpy).toHaveLastReturnedWith(80);
      expect(game.field.getPlayerPokemon()).toBe(milotic);
      expect(milotic.hp).toBe(milotic.getMaxHp());
      const pursuits = enemy.getMoveHistory().filter(m => m.move === MoveId.PURSUIT);
      expect(pursuits).toHaveLength(1);
      expect(pursuits[0].result).toBe(MoveResult.SUCCESS);
      // The Pokémon that came in counts its first turn as after any U-turn (Fake Out works next turn)
      expect(milotic.summonData.waveTurnCount).toBe(1);
    });

    it("knocking out the U-turn user cancels its switch; it is replaced like any fainted Pokémon", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MILOTIC, SpeciesId.MAGIKARP);
      const [feebas, milotic, magikarp] = game.scene.getPlayerParty();
      feebas.hp = 1;

      game.move.select(MoveId.U_TURN);
      await game.move.selectEnemyMove(MoveId.PURSUIT);
      game.doSelectPartyPokemon(2); // the replacement picked after the faint
      await game.toNextTurn();

      expect(feebas.isFainted()).toBe(true);
      expect(game.field.getPlayerPokemon()).toBe(magikarp);
      expect(milotic.isOnField()).toBe(false);
      expect(game.phaseInterceptor.phaseLog.filter(p => p === "SwitchSummonPhase")).toHaveLength(1);
    });

    it("catches an enemy trainer's Pokémon leaving through U-turn", async () => {
      game.override.startingWave(5).moveset(MoveId.PURSUIT).enemySpecies(SpeciesId.NINJASK).enemyMoveset(MoveId.U_TURN);
      await game.classicMode.startBattle(SpeciesId.SHUCKLE);
      const [enemy1, enemy2] = game.scene.getEnemyParty();
      const powerSpy = vi.spyOn(allMoves[MoveId.PURSUIT], "calculateBattlePower");

      game.move.select(MoveId.PURSUIT);
      await game.toNextTurn();

      expect(game.field.getEnemyPokemon()).toBe(enemy2);
      expect(enemy1.hp).toBeLessThan(enemy1.getMaxHp());
      expect(enemy2.hp).toBe(enemy2.getMaxHp());
      expect(powerSpy).toHaveLastReturnedWith(80);
      expect(
        game.field
          .getPlayerPokemon()
          .getMoveHistory()
          .filter(m => m.move === MoveId.PURSUIT),
      ).toHaveLength(1);
    });

    it.each([
      { name: "Volt Switch", moveId: MoveId.VOLT_SWITCH },
      { name: "Flip Turn", moveId: MoveId.FLIP_TURN },
      { name: "Parting Shot", moveId: MoveId.PARTING_SHOT },
      { name: "Chilly Reception", moveId: MoveId.CHILLY_RECEPTION },
    ])("catches $name the same way", async ({ moveId }) => {
      game.override.moveset([moveId, MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MILOTIC);
      const [feebas, milotic] = game.scene.getPlayerParty();
      const powerSpy = vi.spyOn(allMoves[MoveId.PURSUIT], "calculateBattlePower");

      game.move.select(moveId);
      await game.move.selectEnemyMove(MoveId.PURSUIT);
      game.doSelectPartyPokemon(1);
      await game.toNextTurn();

      expect(feebas.hp).toBeLessThan(feebas.getMaxHp());
      expect(powerSpy).toHaveLastReturnedWith(80);
      expect(game.field.getPlayerPokemon()).toBe(milotic);
      expect(milotic.hp).toBe(milotic.getMaxHp());
    });

    // Local fork (2026-11-20), review: the order, the Double Battle retarget and the enemy knock-out path
    it("runs U-turn's end first, then the Pursuit, then the switch", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MILOTIC);
      const feebas = game.field.getPlayerPokemon();
      const log: string[] = [];
      const moveEndStart = MoveEndPhase.prototype.start;
      vi.spyOn(MoveEndPhase.prototype, "start").mockImplementation(function (this: MoveEndPhase) {
        log.push(this.getPokemon() === feebas ? "U-turn end" : "other end");
        return moveEndStart.call(this);
      });
      const moveStart = MovePhase.prototype.start;
      vi.spyOn(MovePhase.prototype, "start").mockImplementation(function (this: MovePhase) {
        log.push(MoveId[this.move.moveId]);
        return moveStart.call(this);
      });
      const switchStart = SwitchSummonPhase.prototype.start;
      vi.spyOn(SwitchSummonPhase.prototype, "start").mockImplementation(function (this: SwitchSummonPhase) {
        log.push("switch");
        return switchStart.call(this);
      });

      game.move.select(MoveId.U_TURN);
      await game.move.selectEnemyMove(MoveId.PURSUIT);
      game.doSelectPartyPokemon(1);
      await game.toNextTurn();

      expect(log).toEqual(["U_TURN", "U-turn end", "PURSUIT", "other end", "switch"]);
    });

    it("turns a Pursuit aimed at the partner on the U-turn user in a Double Battle", async () => {
      game.override.battleStyle("double");
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP, SpeciesId.MILOTIC);
      const [feebas, magikarp, milotic] = game.scene.getPlayerParty();
      const powerSpy = vi.spyOn(allMoves[MoveId.PURSUIT], "calculateBattlePower");

      game.move.select(MoveId.U_TURN, BattlerIndex.PLAYER, BattlerIndex.ENEMY);
      game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
      await game.move.selectEnemyMove(MoveId.PURSUIT, BattlerIndex.PLAYER_2);
      await game.move.selectEnemyMove(MoveId.SPLASH);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.PLAYER_2, BattlerIndex.ENEMY, BattlerIndex.ENEMY_2]);
      game.doSelectPartyPokemon(2);
      await game.toNextTurn();

      expect(feebas.hp).toBeLessThan(feebas.getMaxHp());
      expect(magikarp.hp).toBe(magikarp.getMaxHp());
      expect(milotic.hp).toBe(milotic.getMaxHp());
      expect(game.scene.getPlayerField()).toContain(milotic);
      expect(powerSpy).toHaveBeenCalledTimes(1);
      expect(powerSpy).toHaveLastReturnedWith(80);
    });

    it("an enemy trainer's U-turn user knocked out by it is replaced once, by the trainer", async () => {
      game.override.startingWave(5).moveset(MoveId.PURSUIT).enemySpecies(SpeciesId.NINJASK).enemyMoveset(MoveId.U_TURN);
      await game.classicMode.startBattle(SpeciesId.SHUCKLE);
      const [enemy1, enemy2] = game.scene.getEnemyParty();
      enemy1.hp = 1;

      game.move.select(MoveId.PURSUIT);
      await game.toNextTurn();

      expect(enemy1.isFainted()).toBe(true);
      expect(game.field.getEnemyPokemon()).toBe(enemy2);
      expect(enemy2.hp).toBe(enemy2.getMaxHp());
      expect(enemy2.isOnField()).toBe(true);
    });

    it("does not catch Baton Pass: the Pokémon passed to takes a normal Pursuit", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MILOTIC);
      const [feebas, milotic] = game.scene.getPlayerParty();
      const powerSpy = vi.spyOn(allMoves[MoveId.PURSUIT], "calculateBattlePower");

      game.move.select(MoveId.BATON_PASS);
      await game.move.selectEnemyMove(MoveId.PURSUIT);
      game.doSelectPartyPokemon(1);
      await game.toNextTurn();

      expect(game.field.getPlayerPokemon()).toBe(milotic);
      expect(feebas.hp).toBe(feebas.getMaxHp());
      expect(milotic.hp).toBeLessThan(milotic.getMaxHp());
      expect(powerSpy).toHaveLastReturnedWith(40);
    });

    it("does not catch Shed Tail: the Pursuit meets the substitute it leaves behind", async () => {
      game.override.moveset([MoveId.SHED_TAIL, MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MILOTIC);
      const milotic = game.scene.getPlayerParty()[1];
      const powerSpy = vi.spyOn(allMoves[MoveId.PURSUIT], "calculateBattlePower");

      game.move.select(MoveId.SHED_TAIL);
      await game.move.selectEnemyMove(MoveId.PURSUIT);
      game.doSelectPartyPokemon(1);
      await game.toNextTurn();

      expect(game.field.getPlayerPokemon()).toBe(milotic);
      expect(powerSpy).toHaveBeenCalled();
      expect(powerSpy).not.toHaveReturnedWith(80);
    });

    it("never misses a Pokémon it catches switching out", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MILOTIC);
      const feebas = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      // Any accuracy check now misses: only Pursuit's own "never misses" can land it
      vi.spyOn(enemy, "getAccuracyMultiplier").mockReturnValue(0);

      game.move.select(MoveId.SPLASH);
      await game.move.selectEnemyMove(MoveId.PURSUIT);
      await game.toNextTurn();
      expect(enemy.getLastXMoves(1)[0].result).toBe(MoveResult.MISS);
      expect(feebas.hp).toBe(feebas.getMaxHp());

      game.doSwitchPokemon(1);
      await game.move.selectEnemyMove(MoveId.PURSUIT);
      await game.toNextTurn();
      expect(enemy.getLastXMoves(1)[0].result).toBe(MoveResult.SUCCESS);
      expect(feebas.hp).toBeLessThan(feebas.getMaxHp());
    });

    it("also never misses a U-turn user it catches", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MILOTIC);
      const feebas = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      vi.spyOn(enemy, "getAccuracyMultiplier").mockReturnValue(0);

      game.move.select(MoveId.U_TURN);
      await game.move.selectEnemyMove(MoveId.PURSUIT);
      game.doSelectPartyPokemon(1);
      await game.toNextTurn();

      expect(enemy.getLastXMoves(1)[0].result).toBe(MoveResult.SUCCESS);
      expect(feebas.hp).toBeLessThan(feebas.getMaxHp());
    });

    it("is not taken down by the Destiny Bond of the Pokémon it knocks out as it switches", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MILOTIC, SpeciesId.MAGIKARP);
      const [feebas, , magikarp] = game.scene.getPlayerParty();
      const enemy = game.field.getEnemyPokemon();

      game.move.select(MoveId.DESTINY_BOND);
      await game.move.selectEnemyMove(MoveId.SPLASH);
      await game.toNextTurn();
      expect(feebas).toHaveBattlerTag(BattlerTagType.DESTINY_BOND);

      feebas.hp = 1;
      game.doSwitchPokemon(1);
      await game.move.selectEnemyMove(MoveId.PURSUIT);
      game.doSelectPartyPokemon(2); // the replacement picked after the faint
      await game.toNextTurn();

      expect(feebas.isFainted()).toBe(true);
      expect(enemy.isFainted()).toBe(false);
      expect(game.field.getPlayerPokemon()).toBe(magikarp);
    });

    it("does not catch a Pokémon leaving through Wimp Out", async () => {
      game.override
        .battleStyle("double")
        .ability(AbilityId.WIMP_OUT)
        .startingLevel(50)
        .enemySpecies(SpeciesId.HOUNDOOM)
        .enemyMoveset([MoveId.PURSUIT, MoveId.CRUNCH, MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.WIMPOD, SpeciesId.FEEBAS, SpeciesId.MILOTIC);
      const [wimpod, , milotic] = game.scene.getPlayerParty();
      wimpod.hp = Math.floor(wimpod.getMaxHp() / 2) + 2;
      const powerSpy = vi.spyOn(allMoves[MoveId.PURSUIT], "calculateBattlePower");

      game.move.select(MoveId.SPLASH);
      game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
      await game.move.selectEnemyMove(MoveId.CRUNCH, BattlerIndex.PLAYER);
      await game.move.selectEnemyMove(MoveId.PURSUIT, BattlerIndex.PLAYER);
      game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER, BattlerIndex.PLAYER_2, BattlerIndex.ENEMY_2]);
      game.doSelectPartyPokemon(2); // Wimp Out's switch
      await game.toNextTurn();

      expect(wimpod.isOnField()).toBe(false);
      expect(game.scene.getPlayerField()).toContain(milotic);
      expect(powerSpy).toHaveBeenCalled();
      expect(powerSpy).not.toHaveReturnedWith(80);
    });
  });

  describe("Wonder Room (원더룸)", () => {
    const addWonderRoom = (source: Pokemon) =>
      game.scene.arena.addTag(ArenaTagType.WONDER_ROOM, 5, MoveId.WONDER_ROOM, source.id);
    const removeWonderRoom = () => game.scene.arena.removeTagOnSide(ArenaTagType.WONDER_ROOM, ArenaTagSide.BOTH);

    it("Download ignores it: the foe's own Defense against its own Sp. Def", async () => {
      game.override.ability(AbilityId.DOWNLOAD);
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.PORYGON);
      const porygon = game.scene.getPlayerParty()[1];
      const enemy = game.field.getEnemyPokemon();
      enemy.setStat(Stat.DEF, 100);
      enemy.setStat(Stat.SPDEF, 400);
      addWonderRoom(enemy);
      // As swapped, the Defense would be the higher one now
      expect(enemy.getEffectiveStat(Stat.DEF)).toBeGreaterThan(enemy.getEffectiveStat(Stat.SPDEF));

      game.doSwitchPokemon(1);
      await game.toNextTurn();

      expect(game.field.getPlayerPokemon()).toBe(porygon);
      expect(porygon.getStatStage(Stat.ATK)).toBe(1);
      expect(porygon.getStatStage(Stat.SPATK)).toBe(0);
    });

    it("Download and Booster Energy's pick read the other defensive stat's stages (the games' quirk)", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const enemy = game.field.getEnemyPokemon();
      enemy.setStat(Stat.DEF, 100);
      enemy.setStat(Stat.SPDEF, 120);
      enemy.setStatStage(Stat.SPDEF, -2);
      const opts = { ignoreWonderRoom: true };

      // Without Wonder Room the option changes nothing
      expect(enemy.getEffectiveStat(Stat.DEF, opts)).toBe(100);
      expect(enemy.getEffectiveStat(Stat.SPDEF, opts)).toBe(60);

      addWonderRoom(enemy);
      expect(enemy.getEffectiveStat(Stat.DEF, opts)).toBe(50); // own Defense 100, Sp. Def stage -2
      expect(enemy.getEffectiveStat(Stat.SPDEF, opts)).toBe(120); // own Sp. Def 120, Defense stage 0
      // Every other read keeps the swap
      expect(enemy.getEffectiveStat(Stat.DEF)).toBe(120);
      expect(enemy.getEffectiveStat(Stat.SPDEF)).toBe(50);
    });

    it("Protosynthesis / Quark Drive / Booster Energy pick the highest stat as if it were not up", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const feebas = game.field.getPlayerPokemon();
      feebas.setStat(Stat.ATK, 50);
      feebas.setStat(Stat.DEF, 400);
      feebas.setStat(Stat.SPATK, 50);
      feebas.setStat(Stat.SPDEF, 100);
      feebas.setStat(Stat.SPD, 50);
      expect(getHighestStat(feebas)).toBe(Stat.DEF);

      addWonderRoom(feebas);
      expect(getHighestStat(feebas)).toBe(Stat.DEF);
    });

    it("Beast Boost sees the swap (its plain stats, no stages)", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const feebas = game.field.getPlayerPokemon();
      feebas.setStat(Stat.ATK, 50);
      feebas.setStat(Stat.DEF, 400);
      feebas.setStat(Stat.SPATK, 50);
      feebas.setStat(Stat.SPDEF, 100);
      feebas.setStat(Stat.SPD, 50);
      feebas.setStatStage(Stat.SPDEF, 6);
      expect(beastBoostHighestStatCalc(feebas)).toEqual([{ stat: Stat.DEF, stages: 1 }]);

      addWonderRoom(feebas);
      expect(beastBoostHighestStatCalc(feebas)).toEqual([{ stat: Stat.SPDEF, stages: 1 }]);
    });

    it("Body Press uses the user's own Defense with its Sp. Def stages", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const feebas = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const bodyPress = () =>
        enemy.getAttackDamage({ source: feebas, move: allMoves[MoveId.BODY_PRESS], simulated: true }).damage;
      feebas.setStat(Stat.DEF, 300);
      feebas.setStat(Stat.SPDEF, 100);
      const plain = bodyPress();
      feebas.setStatStage(Stat.DEF, 2);
      const defBoosted = bodyPress();
      expect(defBoosted).toBeGreaterThan(plain);
      feebas.setStatStage(Stat.DEF, 0);

      addWonderRoom(feebas);
      expect(bodyPress()).toBe(plain); // own Defense 300, not the swapped 100
      feebas.setStatStage(Stat.SPDEF, 2);
      expect(bodyPress()).toBe(defBoosted); // the Sp. Def +2 counts as the Defense +2 did
      feebas.setStatStage(Stat.SPDEF, 0);
      feebas.setStatStage(Stat.DEF, 2);
      expect(bodyPress()).toBe(plain); // the Defense stages do not
    });

    it("Psyshock, Psystrike and Secret Sword follow the swap", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const feebas = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const damage = (moveId: MoveId) =>
        enemy.getAttackDamage({ source: feebas, move: allMoves[moveId], simulated: true }).damage;
      const moves = [MoveId.PSYSHOCK, MoveId.PSYSTRIKE, MoveId.SECRET_SWORD];

      enemy.setStat(Stat.DEF, 400);
      enemy.setStat(Stat.SPDEF, 100);
      const noRoom = moves.map(damage);
      addWonderRoom(feebas);
      const room = moves.map(damage);
      room.forEach((d, i) => expect(d).toBeGreaterThan(noRoom[i]));

      removeWonderRoom();
      enemy.setStat(Stat.DEF, 100);
      enemy.setStat(Stat.SPDEF, 400);
      expect(moves.map(damage)).toEqual(room);
    });

    it("confusion damage follows the swap", async () => {
      game.override.confusionActivation(true).moveset(MoveId.SPLASH);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const feebas = game.field.getPlayerPokemon();
      vi.spyOn(feebas, "randBattleSeedIntRange").mockReturnValue(100);
      const selfHit = async () => {
        feebas.hp = feebas.getMaxHp();
        feebas.addTag(BattlerTagType.CONFUSED, 5, MoveId.NONE, game.field.getEnemyPokemon().id);
        game.move.select(MoveId.SPLASH);
        await game.toNextTurn();
        return feebas.getMaxHp() - feebas.hp;
      };

      feebas.setStat(Stat.DEF, 400);
      feebas.setStat(Stat.SPDEF, 100);
      const noRoom = await selfHit();
      addWonderRoom(feebas);
      const room = await selfHit();
      expect(room).toBeGreaterThan(noRoom);

      removeWonderRoom();
      feebas.setStat(Stat.DEF, 100);
      feebas.setStat(Stat.SPDEF, 400);
      expect(await selfHit()).toBe(room);
    });

    it("Shell Side Arm picks its category from the target's own Defense and Sp. Def", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const feebas = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const shellSideArm = allMoves[MoveId.SHELL_SIDE_ARM];
      feebas.setStat(Stat.ATK, 200);
      feebas.setStat(Stat.SPATK, 200);
      enemy.setStat(Stat.DEF, 100);
      enemy.setStat(Stat.SPDEF, 400);
      expect(feebas.getMoveCategory(enemy, shellSideArm)).toBe(MoveCategory.PHYSICAL);

      addWonderRoom(feebas);
      expect(feebas.getMoveCategory(enemy, shellSideArm)).toBe(MoveCategory.PHYSICAL);
      // A real physical move still meets the swapped Defense
      expect(enemy.getEffectiveStat(Stat.DEF)).toBe(400);
    });
  });
});
