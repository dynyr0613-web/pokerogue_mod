// Local fork (2026-11-20): 1.2.0 D5 (the user: "구현: 참기, ... 선취"). Bide (참기) and Me First (선취) are no longer
// "(N)": Bide follows the Gen 5+ rules (BideTag + BideAttr / BideDamageAttr / BideRedirectAttr), Me First the Gen 4-7
// ones (MeFirstAttr, invalidMeFirstMoves, PokemonTurnData.meFirstMove).
import { getPokemonNameWithAffix } from "#app/messages";
import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { MoveUseMode } from "#enums/move-use-mode";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { TrainerType } from "#enums/trainer-type";
import type { Pokemon } from "#field/pokemon";
import { invalidMeFirstMoves } from "#moves/invalid-moves";
import { isMoveStyleOffered } from "#moves/move-style";
import { PokemonMove } from "#moves/pokemon-move";
import { GameManager } from "#test/framework/game-manager";
import { getStarterMoves } from "#ui/starter-select-ui-utils";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Local fork (2026-11-20) - Bide (참기) and Me First (선취)", () => {
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
      .hasPassiveAbility(false)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyHasPassiveAbility(false)
      .enemySpecies(SpeciesId.SHUCKLE)
      .startingLevel(100)
      .enemyLevel(100)
      .enemyMoveset(MoveId.TACKLE);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const storingText = (p: Pokemon) =>
    i18next.t("battlerTags:bideStoring", { pokemonNameWithAffix: getPokemonNameWithAffix(p) });
  const unleashText = (p: Pokemon) =>
    i18next.t("battlerTags:bideUnleash", { pokemonNameWithAffix: getPokemonNameWithAffix(p) });

  it("no longer marks either move as unimplemented; neither gets a style window", async () => {
    for (const moveId of [MoveId.BIDE, MoveId.ME_FIRST]) {
      expect(allMoves[moveId].isUnimplemented, MoveId[moveId]).toBe(false);
      expect(allMoves[moveId].name, MoveId[moveId]).not.toContain("(N)");
    }
    expect(allMoves[MoveId.BIDE].priority).toBe(1);

    game.override.moveset([MoveId.BIDE, MoveId.ME_FIRST, MoveId.TACKLE]);
    await game.classicMode.startBattle(SpeciesId.MACHOP);
    const player = game.field.getPlayerPokemon();
    const slot = (moveId: MoveId) => player.getMoveset().find(m => m.moveId === moveId);
    expect(isMoveStyleOffered(player, slot(MoveId.BIDE))).toBe(false); // fixed damage
    expect(isMoveStyleOffered(player, slot(MoveId.ME_FIRST))).toBe(false); // status move
    expect(isMoveStyleOffered(player, slot(MoveId.TACKLE))).toBe(true);
  });

  it("a new Machop gets Bide among its starter moves, and it can be used", async () => {
    expect(getStarterMoves(SpeciesId.MACHOP, 0)).toContain(MoveId.BIDE);
    game.override.moveset([MoveId.BIDE, MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.MACHOP);
    const player = game.field.getPlayerPokemon();
    expect(new PokemonMove(MoveId.BIDE).isUsable(player)[0]).toBe(true);
  });

  describe("Bide (참기)", () => {
    beforeEach(() => {
      game.override.moveset([MoveId.BIDE, MoveId.SPLASH, MoveId.MIMIC]);
    });

    it("locks the user in for 3 uses on 1 PP, then strikes the attacker for twice the damage taken", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.move.select(MoveId.BIDE);
      await game.toNextTurn();
      expect(player).toHaveBattlerTag({ tagType: BattlerTagType.BIDE, turnCount: 2 });
      expect(player).toHaveUsedMove({ move: MoveId.BIDE, targets: [BattlerIndex.PLAYER], result: MoveResult.SUCCESS });
      expect(player.getMoveQueue()).toHaveLength(1);
      expect(game).toHaveShownMessage(storingText(player));
      expect(enemy).toHaveFullHp();

      await game.toNextTurn(); // turn 2: no command, the queued Bide stores again
      expect(player).toHaveBattlerTag({ tagType: BattlerTagType.BIDE, turnCount: 1 });
      const stored = player.getMaxHp() - player.hp;
      expect(stored).toBeGreaterThan(0);
      expect(player.getTag(BattlerTagType.BIDE)?.storedDamage).toBe(stored);
      expect(player.getTag(BattlerTagType.BIDE)?.lastAttackerId).toBe(enemy.id);
      expect(enemy).toHaveFullHp();

      // Turn 3: the release, before the foe's Tackle (priority +1); checked at once, before any turn-end healing
      await game.phaseInterceptor.to("MoveEndPhase");
      expect(enemy.getMaxHp() - enemy.hp).toBe(stored * 2);
      await game.toNextTurn();
      expect(game).toHaveShownMessage(unleashText(player));
      expect(player).not.toHaveBattlerTag(BattlerTagType.BIDE);
      expect(player.getMoveQueue()).toHaveLength(0);
      const uses = player.getMoveHistory().filter(m => m.move === MoveId.BIDE);
      expect(uses).toHaveLength(3);
      expect(uses[2]).toMatchObject({ targets: [BattlerIndex.ENEMY], result: MoveResult.SUCCESS });
      expect(player.getMoveset().find(m => m.moveId === MoveId.BIDE)?.ppUsed).toBe(1);

      // Free again: a new command is taken
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(player).toHaveUsedMove(MoveId.SPLASH);
    });

    it("fails on the release when it took no damage", async () => {
      game.override.enemyMoveset(MoveId.SPLASH);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.move.select(MoveId.BIDE);
      await game.toNextTurn();
      await game.toNextTurn();
      await game.toNextTurn();

      expect(player).toHaveUsedMove({ move: MoveId.BIDE, result: MoveResult.FAIL });
      expect(game).toHaveShownMessage(unleashText(player));
      expect(game).toHaveShownMessage(i18next.t("battle:attackFailed"));
      expect(enemy).toHaveFullHp();
      expect(player).not.toHaveBattlerTag(BattlerTagType.BIDE);
    });

    it("does not affect Ghost types (Gen 5+)", async () => {
      game.override.enemySpecies(SpeciesId.GASTLY);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.move.select(MoveId.BIDE);
      await game.toNextTurn();
      await game.toNextTurn();
      expect(player.getTag(BattlerTagType.BIDE)?.storedDamage).toBeGreaterThan(0);
      await game.toNextTurn();

      expect(enemy).toHaveFullHp();
      expect(player).not.toHaveBattlerTag(BattlerTagType.BIDE);
    });

    it("strikes the Pokémon that damaged it last (double battle)", async () => {
      game.override.battleStyle("double");
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);
      const [player] = game.scene.getPlayerField();
      const [enemy1, enemy2] = game.scene.getEnemyField();

      game.move.select(MoveId.BIDE, BattlerIndex.PLAYER);
      game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
      await game.move.selectEnemyMove(MoveId.TACKLE, BattlerIndex.PLAYER);
      await game.move.selectEnemyMove(MoveId.TACKLE, BattlerIndex.PLAYER);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.PLAYER_2, BattlerIndex.ENEMY, BattlerIndex.ENEMY_2]);
      await game.toNextTurn();
      expect(player.getTag(BattlerTagType.BIDE)?.lastAttackerId).toBe(enemy2.id);

      // Turn 2: the second foe hits first, the first one last
      game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
      await game.move.selectEnemyMove(MoveId.TACKLE, BattlerIndex.PLAYER);
      await game.move.selectEnemyMove(MoveId.TACKLE, BattlerIndex.PLAYER);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.PLAYER_2, BattlerIndex.ENEMY_2, BattlerIndex.ENEMY]);
      await game.toNextTurn();
      const stored = player.getMaxHp() - player.hp;
      expect(player.getTag(BattlerTagType.BIDE)?.storedDamage).toBe(stored);
      expect(player.getTag(BattlerTagType.BIDE)?.lastAttackerId).toBe(enemy1.id);

      game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
      await game.move.selectEnemyMove(MoveId.SPLASH);
      await game.move.selectEnemyMove(MoveId.SPLASH);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.PLAYER_2, BattlerIndex.ENEMY, BattlerIndex.ENEMY_2]);
      await game.phaseInterceptor.to("MoveEndPhase"); // the release (priority +1)

      expect(player).toHaveUsedMove({ move: MoveId.BIDE, targets: [BattlerIndex.ENEMY], result: MoveResult.SUCCESS });
      expect(enemy1.getMaxHp() - enemy1.hp).toBe(stored * 2);
      expect(enemy2).toHaveFullHp();
    });

    it("ends with nothing released when the user is fully paralyzed on a storing turn", async () => {
      game.override.statusEffect(StatusEffect.PARALYSIS).statusActivation(false);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.move.select(MoveId.BIDE);
      await game.toNextTurn();
      expect(player).toHaveBattlerTag(BattlerTagType.BIDE);

      game.override.statusActivation(true); // turn 2: fully paralyzed
      await game.toNextTurn();
      expect(player).toHaveUsedMove({ move: MoveId.NONE, result: MoveResult.FAIL });
      expect(player).not.toHaveBattlerTag(BattlerTagType.BIDE);
      expect(player.getMoveQueue()).toHaveLength(0);

      // A new command is taken, and no release comes
      game.override.statusActivation(false);
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(player).toHaveUsedMove(MoveId.SPLASH);
      expect(enemy).toHaveFullHp();
    });

    it("ends when the user is forced out", async () => {
      game.override.enemyMoveset(MoveId.WHIRLWIND);
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);
      const snorlax = game.field.getPlayerPokemon();

      game.move.select(MoveId.BIDE);
      await game.toNextTurn();

      expect(game.field.getPlayerPokemon()).not.toBe(snorlax);
      expect(snorlax).not.toHaveBattlerTag(BattlerTagType.BIDE);
      expect(snorlax.getMoveQueue()).toHaveLength(0);
    });

    it("cannot be copied by Mimic while the target is still storing", async () => {
      game.override.enemyMoveset(MoveId.BIDE).moveset([MoveId.MIMIC, MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.MEW);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.move.select(MoveId.MIMIC);
      await game.toNextTurn();
      expect(enemy).toHaveBattlerTag(BattlerTagType.BIDE);
      expect(player).toHaveUsedMove({ move: MoveId.MIMIC, result: MoveResult.FAIL });

      // Once Bide is over (no tag), Bide can be copied
      const mimic = allMoves[MoveId.MIMIC];
      expect(mimic.applyConditions(player, enemy, -1)).toBe(false);
      enemy.removeTag(BattlerTagType.BIDE);
      expect(mimic.applyConditions(player, enemy, -1)).toBe(true);
    });

    // Review fix: the release is one strike (Showdown's release hit skips Parental Bond); Parental Bond doubled it, so
    // it dealt 4x the stored damage
    it("releases in one strike, not doubled by Parental Bond", async () => {
      game.override.ability(AbilityId.PARENTAL_BOND);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      expect(allMoves[MoveId.BIDE].canBeMultiStrikeEnhanced(player)).toBe(false);

      game.move.select(MoveId.BIDE);
      await game.toNextTurn();
      await game.toNextTurn();
      const stored = player.getTag(BattlerTagType.BIDE)?.storedDamage ?? 0;
      expect(stored).toBeGreaterThan(0);

      await game.phaseInterceptor.to("MoveEndPhase"); // the release (priority +1)
      expect(enemy.getMaxHp() - enemy.hp).toBe(stored * 2);
      expect(player.turnData.hitCount).toBe(1);
    });

    // Review fix: Bide has no "mirror" flag in the main series (Showdown), so Mirror Move fails on it
    it("cannot be copied by Mirror Move (the user does not start a Bide)", async () => {
      game.override.enemyMoveset(MoveId.BIDE).moveset([MoveId.MIRROR_MOVE, MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(enemy).toHaveUsedMove({ move: MoveId.BIDE, result: MoveResult.SUCCESS });

      game.move.select(MoveId.MIRROR_MOVE);
      await game.toNextTurn();
      expect(player).toHaveUsedMove({ move: MoveId.MIRROR_MOVE, result: MoveResult.FAIL });
      expect(player).not.toHaveBattlerTag(BattlerTagType.BIDE);
    });

    it("works for enemies: aimed at the attacker, locked in, released at the player", async () => {
      game.override.enemyMoveset(MoveId.BIDE).moveset([MoveId.TACKLE, MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      expect(enemy.getNextMove()).toMatchObject({ move: MoveId.BIDE, targets: [BattlerIndex.ATTACKER] });

      game.move.select(MoveId.TACKLE);
      await game.toNextTurn();
      expect(enemy).toHaveBattlerTag({ tagType: BattlerTagType.BIDE, turnCount: 2 });
      game.move.select(MoveId.TACKLE);
      await game.toNextTurn();
      const stored = enemy.getTag(BattlerTagType.BIDE)?.storedDamage ?? 0;
      expect(stored).toBeGreaterThan(0);
      expect(player).toHaveFullHp();

      game.move.select(MoveId.SPLASH);
      await game.phaseInterceptor.to("MoveEndPhase"); // the release (priority +1)
      expect(player.getMaxHp() - player.hp).toBe(stored * 2);
      expect(enemy).toHaveUsedMove({ move: MoveId.BIDE, targets: [BattlerIndex.PLAYER], result: MoveResult.SUCCESS });
    });

    it("AI: scored by HP (about a 40-power attack at full HP), never against Ghost types", async () => {
      game.override.enemyMoveset([MoveId.BIDE, MoveId.SPLASH]).moveset(MoveId.SPLASH);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const enemy = game.field.getEnemyPokemon();
      const bide = allMoves[MoveId.BIDE];

      expect(bide.getUserBenefitScore(enemy, enemy, bide)).toBe(8);
      // The best-scored move is picked when the AI's roll keeps it
      vi.spyOn(game.scene, "randBattleSeedInt").mockReturnValue(0);
      expect(enemy.getNextMove()).toMatchObject({ move: MoveId.BIDE, targets: [BattlerIndex.ATTACKER] });

      enemy.hp = Math.floor(enemy.getMaxHp() / 10);
      expect(bide.getUserBenefitScore(enemy, enemy, bide)).toBeLessThan(0);
      expect(enemy.getNextMove().move).toBe(MoveId.SPLASH);

      enemy.hp = enemy.getMaxHp();
      vi.spyOn(game.field.getPlayerPokemon(), "getAttackTypeEffectiveness").mockReturnValue(0);
      expect(bide.getUserBenefitScore(enemy, enemy, bide)).toBe(-20);
    });
  });

  describe("Me First (선취)", () => {
    beforeEach(() => {
      game.override.moveset([MoveId.ME_FIRST, MoveId.SPLASH]);
    });

    it("uses the foe's chosen attack first, at 1.5x power, against it", async () => {
      await game.classicMode.startBattle(SpeciesId.MEW);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const powerSpy = vi.spyOn(allMoves[MoveId.TACKLE], "calculateBattlePower");

      game.move.select(MoveId.ME_FIRST);
      await game.toEndOfTurn();

      expect(player).toHaveUsedMove({
        move: MoveId.TACKLE,
        targets: [BattlerIndex.ENEMY],
        useMode: MoveUseMode.FOLLOW_UP,
        result: MoveResult.SUCCESS,
      });
      expect(player).toHaveUsedMove({ move: MoveId.ME_FIRST, result: MoveResult.SUCCESS }, 1);
      expect(enemy).not.toHaveFullHp();
      expect(enemy).toHaveUsedMove(MoveId.TACKLE); // the foe still moves afterwards

      const powers = (source: Pokemon) =>
        powerSpy.mock.calls.flatMap((call, i) => (call[0] === source ? [powerSpy.mock.results[i].value] : []));
      expect(powers(player).length).toBeGreaterThan(0);
      expect(powers(player).every(p => p === 60)).toBe(true); // Tackle 40 x1.5
      expect(powers(enemy).length).toBeGreaterThan(0);
      expect(powers(enemy).every(p => p < 60)).toBe(true); // the foe's own Tackle is not boosted
    });

    it("fails when the foe chose a status move", async () => {
      game.override.enemyMoveset(MoveId.SPLASH);
      await game.classicMode.startBattle(SpeciesId.MEW);
      const player = game.field.getPlayerPokemon();

      game.move.select(MoveId.ME_FIRST);
      await game.toEndOfTurn();
      expect(player).toHaveUsedMove({ move: MoveId.ME_FIRST, result: MoveResult.FAIL });
    });

    it("fails when the foe has already moved", async () => {
      await game.classicMode.startBattle(SpeciesId.MEW);
      const player = game.field.getPlayerPokemon();

      game.move.select(MoveId.ME_FIRST);
      game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER]);
      await game.toEndOfTurn();
      expect(player).toHaveUsedMove({ move: MoveId.ME_FIRST, result: MoveResult.FAIL });
    });

    // Review fix: the Pokémon a U-turn brought in chose nothing; Me First copied the U-turn of the one before it, still
    // in that slot's command, and the user U-turned
    it("fails against a Pokémon switched in this turn (the command in its slot is the previous one's)", async () => {
      game.override
        .battleType(BattleType.TRAINER)
        .randomTrainer({ trainerType: TrainerType.YOUNGSTER })
        .enemySpecies(SpeciesId.RATTATA)
        .enemyLevel(10)
        .enemyMoveset(MoveId.U_TURN);
      await game.classicMode.startBattle(SpeciesId.MEW);
      const player = game.field.getPlayerPokemon();
      const first = game.field.getEnemyPokemon();
      expect(game.scene.getEnemyParty().length).toBeGreaterThan(1);

      game.move.select(MoveId.ME_FIRST);
      game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER]);
      await game.toEndOfTurn();

      expect(game.field.getEnemyPokemon()).not.toBe(first);
      expect(player).toHaveUsedMove({ move: MoveId.ME_FIRST, result: MoveResult.FAIL });
      expect(player.getLastXMoves(-1).some(m => m.move === MoveId.U_TURN)).toBe(false);
    });

    it("fails against a counter move, and against a slot converted into a Max move", async () => {
      expect(invalidMeFirstMoves.has(MoveId.COUNTER)).toBe(true);
      expect(invalidMeFirstMoves.has(MoveId.FOCUS_PUNCH)).toBe(true);
      expect(invalidMeFirstMoves.has(MoveId.BIDE)).toBe(true);

      game.override.enemyMoveset([MoveId.COUNTER, MoveId.TACKLE]);
      await game.classicMode.startBattle(SpeciesId.MEW);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.move.select(MoveId.ME_FIRST);
      await game.move.selectEnemyMove(MoveId.COUNTER);
      await game.toNextTurn();
      expect(player).toHaveUsedMove({ move: MoveId.ME_FIRST, result: MoveResult.FAIL });

      game.move.changeMoveset(enemy, [MoveId.COUNTER, MoveId.TACKLE]);
      enemy.moveset[1].transform = { kind: "max", moveId: MoveId.MAX_STRIKE };
      game.move.select(MoveId.ME_FIRST);
      await game.move.selectEnemyMove(MoveId.TACKLE);
      await game.toNextTurn();
      expect(player).toHaveUsedMove({ move: MoveId.ME_FIRST, result: MoveResult.FAIL });
      expect(enemy).toHaveUsedMove({ move: MoveId.TACKLE, derivedMoveId: MoveId.MAX_STRIKE });
    });

    it("works for enemies: the foe uses the player's chosen attack first, at 1.5x power", async () => {
      game.override.enemySpecies(SpeciesId.MEW).enemyMoveset([MoveId.ME_FIRST]).moveset([MoveId.TACKLE, MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const powerSpy = vi.spyOn(allMoves[MoveId.TACKLE], "calculateBattlePower");

      game.move.select(MoveId.TACKLE);
      game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER]);
      await game.toEndOfTurn();

      expect(enemy).toHaveUsedMove({
        move: MoveId.TACKLE,
        targets: [BattlerIndex.PLAYER],
        useMode: MoveUseMode.FOLLOW_UP,
        result: MoveResult.SUCCESS,
      });
      expect(player).not.toHaveFullHp();
      const enemyPowers = powerSpy.mock.calls.flatMap((call, i) =>
        call[0] === enemy ? [powerSpy.mock.results[i].value] : [],
      );
      expect(enemyPowers.length).toBeGreaterThan(0);
      expect(enemyPowers.every(p => p === 60)).toBe(true);
    });

    it("AI: worth the target's attacks when faster, -20 when slower (without reading the player's command)", async () => {
      game.override.enemySpecies(SpeciesId.MEW).enemyMoveset([MoveId.ME_FIRST]).moveset([MoveId.TACKLE, MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const meFirst = allMoves[MoveId.ME_FIRST];

      // Tackle 40 x1.5 -> 12, Splash 0: 6 on average (a benefit to the user is a negative target score)
      expect(meFirst.getTargetBenefitScore(enemy, player, meFirst)).toBe(-6);

      vi.spyOn(enemy, "getEffectiveStat").mockReturnValue(1);
      expect(meFirst.getTargetBenefitScore(enemy, player, meFirst)).toBe(20);
    });
  });
});
