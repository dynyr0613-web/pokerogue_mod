// Local fork (2026-11-20): move styles, S1 of 1.2.0 (docs/1.2.0_후보_개정_20261120.md 9). The user: "기술 선택 후
// 강공(위력 1.5배, 추가효과 변경 x, 선공기일 경우 우선도 -1에 위력 2배), 중공(그대로), 속공(위력 0.8배, 우선도 +1) /
// 변화기에 해당 x, 드래곤테일 해당 x, 속이기/만나자마자/기선제압 같은 경우는 가능". After the player picks a damaging
// move the fight menu asks 강공 / 중공 / 속공 (the setting "기술 스타일 선택" turns it off); the style moves the order and
// scales the power of that one move use (src/data/moves/move-style.ts).

import { devBridgeApi } from "#app/dev-bridge/dev-bridge";
import { settings } from "#app/global-settings-manager";
import { allMoves } from "#data/data-lists";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { MoveStyle } from "#enums/move-style";
import { MoveUseMode } from "#enums/move-use-mode";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { UiMode } from "#enums/ui-mode";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import {
  getMoveStylePowerMultiplier,
  getMoveStylePriorityShift,
  isMoveStyleOffered,
  MOVE_STYLE_RULES,
} from "#moves/move-style";
import { PokemonMove } from "#moves/pokemon-move";
import type { CommandPhase } from "#phases/command-phase";
import { MovePhase } from "#phases/move-phase";
import { defaultSettings } from "#system/default-settings";
import { GameManager } from "#test/framework/game-manager";
import type { FightUiHandler } from "#ui/fight-ui-handler";
import type { OptionSelectUiHandler } from "#ui/option-select-ui-handler";
import { readFileSync } from "node:fs";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Custom - Move styles (S1, 1.2.0)", () => {
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Choose `moveId` for the player's Pokémon in `pkmIndex` in `style`, as the style choice does */
  function selectWithStyle(
    moveId: MoveId,
    style: MoveStyle,
    pkmIndex: BattlerIndex.PLAYER | BattlerIndex.PLAYER_2 = BattlerIndex.PLAYER,
    targetIndex?: BattlerIndex,
  ): void {
    const position = game.scene
      .getPlayerField()
      [pkmIndex].getMoveset()
      .findIndex(m => m.moveId === moveId);
    expect(position).toBeGreaterThanOrEqual(0);
    game.onNextPrompt("CommandPhase", UiMode.COMMAND, () => {
      game.scene.ui
        .setMode(UiMode.FIGHT, (game.scene.phaseManager.getCurrentPhase() as CommandPhase).getFieldIndex())
        .catch(() => {});
    });
    game.onNextPrompt("CommandPhase", UiMode.FIGHT, () => {
      (game.scene.phaseManager.getCurrentPhase() as CommandPhase).handleCommand(
        Command.FIGHT,
        position,
        MoveUseMode.NORMAL,
        undefined,
        style,
      );
    });
    game.selectTarget(position, targetIndex);
  }

  /** The Pokémon in the order their `MovePhase`s start */
  function recordMoveOrder(): Pokemon[] {
    const order: Pokemon[] = [];
    const start = MovePhase.prototype.start;
    vi.spyOn(MovePhase.prototype, "start").mockImplementation(function (this: MovePhase) {
      order.push(this.pokemon);
      start.call(this);
    });
    return order;
  }

  /** The power of every real (not simulated) damage calculation of `moveId` by `source` */
  function recordPower(moveId: MoveId, source: Pokemon): number[] {
    const powers: number[] = [];
    const move = allMoves[moveId];
    const calculate = move.calculateBattlePower;
    vi.spyOn(move, "calculateBattlePower").mockImplementation((src, target, simulated, category) => {
      const power = calculate.call(move, src, target, simulated, category);
      if (src === source && !simulated) {
        powers.push(power);
      }
      return power;
    });
    return powers;
  }

  describe("rules", () => {
    it("강공: priority -1 and power x1.5 (x2 for a priority move); 속공: priority +1 and power x0.8", () => {
      expect(getMoveStylePriorityShift(MoveStyle.STRONG)).toBe(-1);
      expect(getMoveStylePriorityShift(MoveStyle.AGILE)).toBe(1);
      expect(getMoveStylePriorityShift(MoveStyle.NORMAL)).toBe(0);
      expect(getMoveStylePowerMultiplier(MoveStyle.STRONG, allMoves[MoveId.TACKLE])).toBe(1.5);
      expect(getMoveStylePowerMultiplier(MoveStyle.STRONG, allMoves[MoveId.QUICK_ATTACK])).toBe(2);
      expect(getMoveStylePowerMultiplier(MoveStyle.STRONG, allMoves[MoveId.FAKE_OUT])).toBe(2);
      expect(getMoveStylePowerMultiplier(MoveStyle.AGILE, allMoves[MoveId.TACKLE])).toBe(0.8);
      expect(getMoveStylePowerMultiplier(MoveStyle.AGILE, allMoves[MoveId.QUICK_ATTACK])).toBe(0.8);
      expect(getMoveStylePowerMultiplier(MoveStyle.NORMAL, allMoves[MoveId.QUICK_ATTACK])).toBe(1);
      expect(MOVE_STYLE_RULES[MoveStyle.NORMAL]).toEqual({
        priorityShift: 0,
        powerMultiplier: 1,
        priorityMovePowerMultiplier: 1,
      });
    });

    it("keeps its numbers (append only: a queued two-turn move saves them)", () => {
      expect({ ...MoveStyle }).toEqual({ NORMAL: 0, STRONG: 1, AGILE: 2 });
    });

    it("offers a style for the player's damaging moves only", async () => {
      await game.classicMode.startBattle(SpeciesId.MACHAMP);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const offered = (moveId: MoveId) => isMoveStyleOffered(player, new PokemonMove(moveId));

      for (const moveId of [
        MoveId.TACKLE,
        MoveId.FAKE_OUT,
        MoveId.FIRST_IMPRESSION,
        MoveId.UPPER_HAND,
        MoveId.QUICK_ATTACK,
        MoveId.DOUBLE_KICK,
        MoveId.SOLAR_BEAM,
      ]) {
        expect.soft(offered(moveId), MoveId[moveId]).toBe(true);
      }
      for (const moveId of [
        MoveId.GROWL,
        MoveId.SWORDS_DANCE,
        MoveId.DRAGON_TAIL,
        MoveId.CIRCLE_THROW,
        MoveId.SEISMIC_TOSS,
        MoveId.SUPER_FANG,
        MoveId.COUNTER,
        MoveId.FISSURE,
        MoveId.STRUGGLE,
        // Added after review: the style would not reach the hit two turns later
        MoveId.FUTURE_SIGHT,
        MoveId.DOOM_DESIRE,
      ]) {
        expect.soft(offered(moveId), MoveId[moveId]).toBe(false);
      }
      // A slot made a Max move (다이사탕) or a Z-Move is not offered
      expect(
        isMoveStyleOffered(player, new PokemonMove(MoveId.TACKLE, 0, 0, undefined, { kind: "max", moveId: 0 })),
      ).toBe(false);
      // Enemies never use a style
      expect(isMoveStyleOffered(enemy, new PokemonMove(MoveId.TACKLE))).toBe(false);
    });
  });

  describe("move order", () => {
    it("속공 moves a slower Pokémon first", async () => {
      game.override.enemyMoveset(MoveId.TACKLE);
      await game.classicMode.startBattle(SpeciesId.MACHAMP);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      game.move.changeMoveset(player, [MoveId.TACKLE]);
      player.setStat(Stat.SPD, 50);
      enemy.setStat(Stat.SPD, 150);
      const order = recordMoveOrder();

      // (control) 중공: the faster enemy first
      selectWithStyle(MoveId.TACKLE, MoveStyle.NORMAL);
      await game.toNextTurn();
      expect(order).toEqual([enemy, player]);

      order.length = 0;
      selectWithStyle(MoveId.TACKLE, MoveStyle.AGILE);
      await game.toEndOfTurn();
      expect(order).toEqual([player, enemy]);
    });

    it("강공 moves a faster Pokémon last, and leaves the enemy's same move alone", async () => {
      game.override.enemyMoveset(MoveId.TACKLE);
      await game.classicMode.startBattle(SpeciesId.MACHAMP);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      game.move.changeMoveset(player, [MoveId.TACKLE]);
      player.setStat(Stat.SPD, 150);
      enemy.setStat(Stat.SPD, 50);
      const order = recordMoveOrder();
      // Added after review: one spy for both Tackles, so the enemy's power is seen too
      const powers = new Map<Pokemon, number[]>([
        [player, []],
        [enemy, []],
      ]);
      const tackle = allMoves[MoveId.TACKLE];
      const calculate = tackle.calculateBattlePower;
      vi.spyOn(tackle, "calculateBattlePower").mockImplementation((src, target, simulated, category) => {
        const power = calculate.call(tackle, src, target, simulated, category);
        if (!simulated) {
          powers.get(src)?.push(power);
        }
        return power;
      });

      selectWithStyle(MoveId.TACKLE, MoveStyle.STRONG);
      await game.toEndOfTurn();
      expect(order).toEqual([enemy, player]);
      expect(powers.get(player)).toEqual([60]);
      expect(powers.get(enemy)).toEqual([40]);
    });

    it("drops to 중공 when Encore puts another move in place of the chosen one", async () => {
      game.override.enemyMoveset([MoveId.SPLASH, MoveId.ENCORE]);
      await game.classicMode.startBattle(SpeciesId.MACHAMP);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      game.move.changeMoveset(player, [MoveId.TACKLE, MoveId.QUICK_ATTACK]);
      enemy.setStat(Stat.SPD, 999);
      const powers = recordPower(MoveId.TACKLE, player);

      selectWithStyle(MoveId.TACKLE, MoveStyle.NORMAL);
      await game.move.selectEnemyMove(MoveId.SPLASH);
      await game.toNextTurn();
      expect(powers).toEqual([40]);

      // 강공 Quick Attack (priority 0) moves after the faster enemy's Encore, which turns it into Tackle
      selectWithStyle(MoveId.QUICK_ATTACK, MoveStyle.STRONG);
      await game.move.selectEnemyMove(MoveId.ENCORE);
      await game.toEndOfTurn();
      expect(enemy).toHaveUsedMove({ move: MoveId.ENCORE, result: MoveResult.SUCCESS });
      expect(powers).toEqual([40, 40]);
    });

    it("강공 Quick Attack has priority 0 (speed decides) and double power", async () => {
      game.override.enemyMoveset(MoveId.TACKLE);
      await game.classicMode.startBattle(SpeciesId.MACHAMP);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      game.move.changeMoveset(player, [MoveId.QUICK_ATTACK]);
      player.setStat(Stat.SPD, 50);
      enemy.setStat(Stat.SPD, 150);
      const order = recordMoveOrder();
      const powers = recordPower(MoveId.QUICK_ATTACK, player);

      // (control) 중공 Quick Attack goes first
      selectWithStyle(MoveId.QUICK_ATTACK, MoveStyle.NORMAL);
      await game.toNextTurn();
      expect(order).toEqual([player, enemy]);
      expect(powers).toEqual([40]);

      order.length = 0;
      powers.length = 0;
      selectWithStyle(MoveId.QUICK_ATTACK, MoveStyle.STRONG);
      await game.toEndOfTurn();
      expect(order).toEqual([enemy, player]);
      expect(powers).toEqual([80]);
    });

    it("is chosen per Pokémon in doubles", async () => {
      game.override.battleStyle("double").enemySpecies(SpeciesId.CHANSEY);
      await game.classicMode.startBattle(SpeciesId.MACHAMP, SpeciesId.SNORLAX);
      const [player1, player2] = game.scene.getPlayerField();
      const [enemy1, enemy2] = game.scene.getEnemyField();
      game.move.changeMoveset(player1, [MoveId.TACKLE]);
      game.move.changeMoveset(player2, [MoveId.TACKLE]);
      player1.setStat(Stat.SPD, 50);
      player2.setStat(Stat.SPD, 300);
      enemy1.setStat(Stat.SPD, 100);
      enemy2.setStat(Stat.SPD, 100);
      const order = recordMoveOrder();
      // One spy for both players' Tackles
      const powers = new Map<Pokemon, number[]>([
        [player1, []],
        [player2, []],
      ]);
      const tackle = allMoves[MoveId.TACKLE];
      const calculate = tackle.calculateBattlePower;
      vi.spyOn(tackle, "calculateBattlePower").mockImplementation((src, target, simulated, category) => {
        const power = calculate.call(tackle, src, target, simulated, category);
        if (!simulated) {
          powers.get(src)?.push(power);
        }
        return power;
      });

      selectWithStyle(MoveId.TACKLE, MoveStyle.AGILE, BattlerIndex.PLAYER, BattlerIndex.ENEMY);
      selectWithStyle(MoveId.TACKLE, MoveStyle.STRONG, BattlerIndex.PLAYER_2, BattlerIndex.ENEMY_2);
      await game.toEndOfTurn();

      // The slowest goes first with 속공 and the fastest last with 강공; the enemies' Splash in between
      expect(order).toHaveLength(4);
      expect(order[0]).toBe(player1);
      expect(order[3]).toBe(player2);
      expect(powers.get(player1)).toEqual([32]);
      expect(powers.get(player2)).toEqual([60]);
    });

    it("counts for Upper Hand: it answers a 속공 Tackle but not a 중공 one", async () => {
      game.override.enemyMoveset(MoveId.UPPER_HAND);
      await game.classicMode.startBattle(SpeciesId.MACHAMP);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      game.move.changeMoveset(player, [MoveId.TACKLE]);

      selectWithStyle(MoveId.TACKLE, MoveStyle.NORMAL);
      await game.toNextTurn();
      expect(enemy).toHaveUsedMove({ move: MoveId.UPPER_HAND, result: MoveResult.FAIL });

      selectWithStyle(MoveId.TACKLE, MoveStyle.AGILE);
      await game.toEndOfTurn();
      expect(enemy).toHaveUsedMove({ move: MoveId.UPPER_HAND, result: MoveResult.SUCCESS });
    });

    it("makes a 속공 move a priority move for Psychic Terrain", async () => {
      game.override.startingTerrain(TerrainType.PSYCHIC);
      await game.classicMode.startBattle(SpeciesId.MACHAMP);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      game.move.changeMoveset(player, [MoveId.TACKLE]);

      selectWithStyle(MoveId.TACKLE, MoveStyle.AGILE);
      await game.toEndOfTurn();
      expect(player).toHaveUsedMove({ move: MoveId.TACKLE, result: MoveResult.FAIL });
      expect(enemy).toHaveFullHp();
    });
  });

  describe("power", () => {
    it("강공 Tackle has 60 power, 속공 32, and the PP use stays 1", async () => {
      await game.classicMode.startBattle(SpeciesId.MACHAMP);
      const player = game.field.getPlayerPokemon();
      game.move.changeMoveset(player, [MoveId.TACKLE]);
      const powers = recordPower(MoveId.TACKLE, player);

      selectWithStyle(MoveId.TACKLE, MoveStyle.STRONG);
      await game.toNextTurn();
      expect(powers).toEqual([60]);
      expect(player).toHaveUsedPP(MoveId.TACKLE, 1);

      powers.length = 0;
      selectWithStyle(MoveId.TACKLE, MoveStyle.AGILE);
      await game.toEndOfTurn();
      expect(powers).toEqual([32]);
      expect(player).toHaveUsedPP(MoveId.TACKLE, 2);
      // The use is over: nothing is left in flight
      expect(player.turnData.moveStyleUse).toBeUndefined();
    });

    it("scales every hit of a multi-hit move", async () => {
      await game.classicMode.startBattle(SpeciesId.MACHAMP);
      const player = game.field.getPlayerPokemon();
      game.move.changeMoveset(player, [MoveId.DOUBLE_KICK]);
      const powers = recordPower(MoveId.DOUBLE_KICK, player);

      selectWithStyle(MoveId.DOUBLE_KICK, MoveStyle.STRONG);
      await game.toEndOfTurn();
      expect(powers).toEqual([45, 45]);
    });

    it("leaves a move copied by Dancer at 중공, even the same move", async () => {
      game.override.ability(AbilityId.DANCER).enemyMoveset(MoveId.FIERY_DANCE);
      await game.classicMode.startBattle(SpeciesId.ORICORIO);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      game.move.changeMoveset(player, [MoveId.FIERY_DANCE]);
      enemy.setStat(Stat.SPD, 999);
      const powers = recordPower(MoveId.FIERY_DANCE, player);

      selectWithStyle(MoveId.FIERY_DANCE, MoveStyle.STRONG);
      await game.toEndOfTurn();
      // The Dancer copy right after the enemy's dance, then the player's own 강공 Fiery Dance
      expect(powers).toEqual([80, 120]);
    });

    it("keeps the style for the attack turn of a two-turn move", async () => {
      await game.classicMode.startBattle(SpeciesId.MACHAMP);
      const player = game.field.getPlayerPokemon();
      game.move.changeMoveset(player, [MoveId.SOLAR_BEAM]);
      const powers = recordPower(MoveId.SOLAR_BEAM, player);

      selectWithStyle(MoveId.SOLAR_BEAM, MoveStyle.STRONG);
      await game.toNextTurn();
      expect(powers).toEqual([]);
      expect(player.getMoveQueue()[0]).toMatchObject({ move: MoveId.SOLAR_BEAM, moveStyle: MoveStyle.STRONG });

      await game.toEndOfTurn();
      expect(powers).toEqual([180]);
    });

    it("keeps the style when the two-turn move fires at once (Solar Beam in sun)", async () => {
      game.override.weather(WeatherType.SUNNY);
      await game.classicMode.startBattle(SpeciesId.MACHAMP);
      const player = game.field.getPlayerPokemon();
      game.move.changeMoveset(player, [MoveId.SOLAR_BEAM]);
      const powers = recordPower(MoveId.SOLAR_BEAM, player);

      selectWithStyle(MoveId.SOLAR_BEAM, MoveStyle.STRONG);
      await game.toEndOfTurn();
      expect(powers).toEqual([180]);
      expect(player.getMoveQueue()).toHaveLength(0);
    });
  });

  describe("fight menu", () => {
    beforeEach(() => {
      settings.update("general", "moveStyleChoice", true);
    });

    /** Open the fight menu and press A on the move in `position` */
    function pressMove(position: number): void {
      game.onNextPrompt("CommandPhase", UiMode.COMMAND, () => {
        game.scene.ui.setMode(UiMode.FIGHT, 0).catch(() => {});
      });
      game.onNextPrompt("CommandPhase", UiMode.FIGHT, () => {
        const handler = game.scene.ui.getHandler<FightUiHandler>();
        handler.setCursor(position);
        handler.processInput(Button.ACTION);
      });
    }

    it("asks 강공 / 중공 / 속공 / 취소 with the cursor on 중공 and records the choice", async () => {
      await game.classicMode.startBattle(SpeciesId.MACHAMP);
      const player = game.field.getPlayerPokemon();
      game.move.changeMoveset(player, [MoveId.TACKLE, MoveId.GROWL]);

      pressMove(0);
      let shown: { options: number; cursor: number } | undefined;
      game.onNextPrompt("CommandPhase", UiMode.OPTION_SELECT, () => {
        const handler = game.scene.ui.getHandler<OptionSelectUiHandler>();
        shown = { options: (handler as any).options.length, cursor: handler.getCursor() };
        handler.setCursor(0); // 강공
        handler.processInput(Button.ACTION);
      });
      await game.phaseInterceptor.to("TurnStartPhase", false);

      expect(shown).toEqual({ options: 4, cursor: 1 });
      expect(game.scene.currentBattle.turnCommands[BattlerIndex.PLAYER]).toMatchObject({
        command: Command.FIGHT,
        move: { move: MoveId.TACKLE },
        moveStyle: MoveStyle.STRONG,
      });
    });

    it("goes back to the move list on cancel, and a status move is chosen at once", async () => {
      await game.classicMode.startBattle(SpeciesId.MACHAMP);
      const player = game.field.getPlayerPokemon();
      game.move.changeMoveset(player, [MoveId.TACKLE, MoveId.GROWL]);

      pressMove(0);
      game.onNextPrompt("CommandPhase", UiMode.OPTION_SELECT, () => {
        game.scene.ui.getHandler().processInput(Button.CANCEL);
      });
      let backInFightMenu = false;
      game.onNextPrompt("CommandPhase", UiMode.FIGHT, () => {
        backInFightMenu = game.scene.currentBattle.turnCommands[BattlerIndex.PLAYER] == null;
        const handler = game.scene.ui.getHandler<FightUiHandler>();
        handler.setCursor(1); // Growl
        handler.processInput(Button.ACTION);
      });
      await game.phaseInterceptor.to("TurnStartPhase", false);

      expect(backInFightMenu).toBe(true);
      const command = game.scene.currentBattle.turnCommands[BattlerIndex.PLAYER];
      expect(command?.move?.move).toBe(MoveId.GROWL);
      expect(command?.moveStyle).toBeUndefined();
    });

    it("is answered by the Dev Bridge's useMove (중공 unless a style is given)", async () => {
      await game.classicMode.startBattle(SpeciesId.MACHAMP);
      const player = game.field.getPlayerPokemon();
      game.move.changeMoveset(player, [MoveId.TACKLE]);

      await devBridgeApi.useMove(0, undefined, "agile");
      await game.phaseInterceptor.to("TurnStartPhase", false);
      expect(game.scene.currentBattle.turnCommands[BattlerIndex.PLAYER]?.moveStyle).toBe(MoveStyle.AGILE);

      await game.toNextTurn();
      await devBridgeApi.useMove(0);
      await game.phaseInterceptor.to("TurnStartPhase", false);
      const command = game.scene.currentBattle.turnCommands[BattlerIndex.PLAYER];
      expect(command?.move?.move).toBe(MoveId.TACKLE);
      expect(command?.moveStyle).toBeUndefined();
    });

    it("is on by default (the test helper turns it off for other tests)", () => {
      expect(defaultSettings.general.moveStyleChoice).toBe(true);
    });

    it("has its words in both locales (the user's 강공 / 중공 / 속공)", () => {
      const read = (path: string) => JSON.parse(readFileSync(path, "utf-8"));
      expect(read("locales/ko/fight-ui-handler.json")).toMatchObject({
        moveStyleStrong: "강공",
        moveStyleNormal: "중공",
        moveStyleAgile: "속공",
      });
      expect(read("locales/en/fight-ui-handler.json")).toMatchObject({
        moveStyleStrong: "Strong Style",
        moveStyleNormal: "Normal",
        moveStyleAgile: "Agile Style",
      });
      expect(read("locales/ko/settings.json").moveStyleChoice).toBe("기술 스타일 선택");
      expect(read("locales/en/settings.json").moveStyleChoice).toBe("Move Style Choice");
    });

    it("chooses the move at once (중공) with the setting off", async () => {
      settings.update("general", "moveStyleChoice", false);
      await game.classicMode.startBattle(SpeciesId.MACHAMP);
      const player = game.field.getPlayerPokemon();
      game.move.changeMoveset(player, [MoveId.TACKLE]);
      const modes: UiMode[] = [];
      const setOverlayMode = game.scene.ui.setOverlayMode.bind(game.scene.ui);
      vi.spyOn(game.scene.ui, "setOverlayMode").mockImplementation((mode, ...args) => {
        modes.push(mode);
        return setOverlayMode(mode, ...args);
      });

      pressMove(0);
      await game.phaseInterceptor.to("TurnStartPhase", false);

      expect(modes).not.toContain(UiMode.OPTION_SELECT);
      const command = game.scene.currentBattle.turnCommands[BattlerIndex.PLAYER];
      expect(command?.move?.move).toBe(MoveId.TACKLE);
      expect(command?.moveStyle).toBeUndefined();
    });
  });
});
