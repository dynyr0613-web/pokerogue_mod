import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { SpeciesId } from "#enums/species-id";
import { StruggleRecoilAttr } from "#moves/move";
import { GameManager } from "#test/framework/game-manager";
import { toDmgValue } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// Local fork (2026-11-18): Struggle's recoil grows 1/4 -> 2/4 -> 3/4 -> all of max HP over Struggles in a row, so a
// battle where both sides are out of PP and heal more than a fixed 1/4 (the stuck 5850 sim battle) still ends.
describe("Custom - Struggle recoil grows with every Struggle in a row", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .ability(AbilityId.BALL_FETCH)
      .battleStyle("single")
      .criticalHits(false)
      .startingLevel(50)
      .enemySpecies(SpeciesId.BLISSEY)
      .enemyLevel(100)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  it("takes 1/4, 2/4, 3/4 and then all of the user's max HP", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.MAGIKARP);
    const player = game.field.getPlayerPokemon();
    const maxHp = player.getMaxHp();

    for (const ratio of [0.25, 0.5, 0.75]) {
      player.hp = maxHp;
      game.move.use(MoveId.STRUGGLE);
      await game.toNextTurn();
      expect(player.getLastXMoves()[0].move).toBe(MoveId.STRUGGLE);
      expect(maxHp - player.hp).toBe(toDmgValue(maxHp * ratio));
    }

    player.hp = maxHp;
    game.move.use(MoveId.STRUGGLE);
    await game.phaseInterceptor.to("FaintPhase", false);
    expect(player.hp).toBe(0);
    expect(player.isFainted()).toBe(true);
  });

  it("starts over at 1/4 after a different move", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    const maxHp = player.getMaxHp();

    game.move.use(MoveId.STRUGGLE);
    await game.toNextTurn();
    player.hp = maxHp;
    game.move.use(MoveId.STRUGGLE);
    await game.toNextTurn();
    expect(maxHp - player.hp).toBe(toDmgValue(maxHp * 0.5));

    game.move.use(MoveId.SPLASH);
    await game.toNextTurn();

    player.hp = maxHp;
    game.move.use(MoveId.STRUGGLE);
    await game.toNextTurn();
    expect(maxHp - player.hp).toBe(toDmgValue(maxHp * 0.25));
  });

  it("grows the same way when the Struggle comes from running out of PP", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    const maxHp = player.getMaxHp();
    game.move.changeMoveset(player, MoveId.TACKLE);
    const tackle = player.getMoveset()[0];
    // The helper finds the move's slot when called; the command itself runs in the CommandPhase, after the PP is gone,
    // and turns into Struggle there (`CommandPhase` useStruggle)
    const selectWithoutPp = () => {
      tackle.ppUsed = 0;
      game.move.select(MoveId.TACKLE);
      tackle.ppUsed = tackle.getMovePp();
    };

    selectWithoutPp();
    await game.toNextTurn();
    expect(player.getLastXMoves()[0].move).toBe(MoveId.STRUGGLE);
    expect(maxHp - player.hp).toBe(toDmgValue(maxHp * 0.25));

    player.hp = maxHp;
    selectWithoutPp();
    await game.toNextTurn();
    expect(player.getLastXMoves()[0].move).toBe(MoveId.STRUGGLE);
    expect(maxHp - player.hp).toBe(toDmgValue(maxHp * 0.5));
  });

  it("keeps growing across a turn the user flinched", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    const maxHp = player.getMaxHp();

    game.move.use(MoveId.STRUGGLE);
    await game.toNextTurn();

    // flinched right before its move: the Struggle is not used this turn
    game.move.use(MoveId.STRUGGLE);
    game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
    await game.phaseInterceptor.to("MovePhase", false);
    player.addTag(BattlerTagType.FLINCHED);
    await game.toNextTurn();
    expect(player.getLastXMoves()[0].move).toBe(MoveId.NONE);

    player.hp = maxHp;
    game.move.use(MoveId.STRUGGLE);
    await game.toNextTurn();
    expect(maxHp - player.hp).toBe(toDmgValue(maxHp * 0.5));
  });

  it("knocks out a boss on its fourth Struggle in a row whatever its bars", async () => {
    game.override.enemyHealthSegments(3);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.field.getEnemyPokemon();
    const maxHp = enemy.getMaxHp();

    for (const ratio of [0.25, 0.5, 0.75]) {
      enemy.hp = maxHp;
      game.move.use(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.STRUGGLE);
      await game.toNextTurn();
      expect(enemy.getLastXMoves()[0].move).toBe(MoveId.STRUGGLE);
      expect(maxHp - enemy.hp).toBe(toDmgValue(maxHp * ratio));
    }

    enemy.hp = maxHp;
    game.move.use(MoveId.SPLASH);
    await game.move.forceEnemyMove(MoveId.STRUGGLE);
    await game.phaseInterceptor.to("MoveEndPhase");
    await game.phaseInterceptor.to("MoveEndPhase");
    expect(enemy.isFainted()).toBe(true);
  });

  it("counts only this battle's Struggles in a row, whatever their result", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    const history = player.getMoveHistory();
    const entry = (move: MoveId, result = MoveResult.SUCCESS) => ({ move, targets: [], result, useMode: 0 }) as any;

    history.splice(0);
    history.push(entry(MoveId.TACKLE), entry(MoveId.STRUGGLE), entry(MoveId.STRUGGLE, MoveResult.FAIL));
    // a turn it could not move (flinch, sleep ...) is recorded as NONE and neither counts nor ends the run
    history.push(entry(MoveId.NONE, MoveResult.FAIL));
    history.push(entry(MoveId.STRUGGLE)); // the current use
    player.waveData.moveHistoryAtStart = history;
    player.waveData.moveHistoryLengthAtStart = 0;
    expect(StruggleRecoilAttr.getStreak(player)).toBe(3);

    // a new wave began after the second entry: only the Struggles since then count
    player.waveData.moveHistoryLengthAtStart = 2;
    expect(StruggleRecoilAttr.getStreak(player)).toBe(2);

    // a replaced history (the user left the field) counts from its start
    player.waveData.moveHistoryAtStart = [];
    player.waveData.moveHistoryLengthAtStart = 2;
    expect(StruggleRecoilAttr.getStreak(player)).toBe(3);
  });

  it("says so in the Korean and English move descriptions", () => {
    const read = (lang: string) =>
      JSON.parse(readFileSync(join(process.cwd(), "locales", lang, "move.json"), "utf-8")).struggle.effect as string;
    expect(read("ko")).toContain("연달아 쓸 때마다 반동이 1/4씩 커진다");
    expect(read("en")).toContain("1/4 more for each Struggle in a row");
  });
});
