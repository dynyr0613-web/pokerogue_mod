// Local fork (2026-11-20): the held-item moves of 1.2.0 D5 (docs/1.2.0_후보_개정_20261120.md 14). The user:
// "구현: ... 자연의은혜(나무열매 선택, 위력과 타입 표시, 열매주머니 발동 가능), 트릭/바꿔치기(주는 템은 선택, 받는 아이템은
// 랜덤), 내던지기(도구 선택), 내던지기용 xlsx표도 제작 ... / 도구 변경은 전투 후 되돌아옴 / 적 또한 플레이어 도구 간섭 가능
// ... / n1 그대로". Trick, Switcheroo, Fling and Natural Gift, the fight menu's item choice and its command flow, the
// enemy rule, the Fling table and the per-battle ledger that puts the items back (src/data/moves/held-item-moves.ts).

import { devBridgeApi } from "#app/dev-bridge/dev-bridge";
import { settings } from "#app/global-settings-manager";
import { getPokemonNameWithAffix } from "#app/messages";
import { activeOverrides } from "#app/overrides";
import { allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BerryType } from "#enums/berry-type";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { FormChangeItem } from "#enums/form-change-item";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { MoveStyle } from "#enums/move-style";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokeballType } from "#enums/pokeball";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { PERMANENT_STATS, Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import { type BerryModifier, PokemonHeldItemModifier, PreserveBerryModifier } from "#modifiers/modifier";
import { ModifierTypeGenerator } from "#modifiers/modifier-type";
import { FLING_TABLE } from "#moves/fling-table";
import {
  canFlingItem,
  getFlingEntry,
  getHeldItemKey,
  getHeldItemMoveLedger,
  getHeldItemMoveOptions,
  NATURAL_GIFT_TABLE,
  pickHeldItem,
  revertHeldItemMoveChanges,
} from "#moves/held-item-moves";
import { StealHeldItemChanceAttr } from "#moves/move";
import type { CommandPhase } from "#phases/command-phase";
import { GameManager } from "#test/framework/game-manager";
import { MockSprite } from "#test/mocks/mocks-container/mock-sprite";
import type { FightUiHandler } from "#ui/fight-ui-handler";
import type { OptionSelectUiHandler } from "#ui/option-select-ui-handler";
import { getEnumValues } from "#utils/enums";
import { readFileSync } from "node:fs";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Custom - held-item moves (1.2.0 D5): Trick, Switcheroo, Fling, Natural Gift", () => {
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
      .startingLevel(100)
      .enemySpecies(SpeciesId.BLISSEY)
      .enemyLevel(100)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TRICK, MoveId.FLING, MoveId.NATURAL_GIFT, MoveId.SPLASH]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    revertHeldItemMoveChanges(); // never leave a ledger to the next test
  });

  /** `pokemon`'s held items as key -> count */
  function itemsOf(pokemon: Pokemon): Record<string, number> {
    return Object.fromEntries(pokemon.getHeldItems().map(i => [getHeldItemKey(i), i.stackCount]));
  }

  /** Choose `moveId` with the held item of `key` (and a style), as the fight menu's item choice does */
  function selectWithItem(
    moveId: MoveId,
    key?: string,
    style?: MoveStyle,
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
        key,
      );
    });
    game.selectTarget(position, targetIndex);
  }

  /** The power of every real damage calculation of `moveId` by `source` */
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

  describe("tables", () => {
    it("are implemented now", () => {
      for (const moveId of [MoveId.TRICK, MoveId.SWITCHEROO, MoveId.FLING, MoveId.NATURAL_GIFT]) {
        expect(allMoves[moveId].isUnimplemented, MoveId[moveId]).toBe(false);
      }
    });

    it("Natural Gift: the Gen 6+ type and power of each of the 11 berries (N1)", () => {
      expect(NATURAL_GIFT_TABLE).toEqual({
        [BerryType.SITRUS]: { type: PokemonType.PSYCHIC, power: 80 },
        [BerryType.LUM]: { type: PokemonType.FLYING, power: 80 },
        [BerryType.LEPPA]: { type: PokemonType.FIGHTING, power: 80 },
        [BerryType.LIECHI]: { type: PokemonType.GRASS, power: 100 },
        [BerryType.GANLON]: { type: PokemonType.ICE, power: 100 },
        [BerryType.SALAC]: { type: PokemonType.FIGHTING, power: 100 },
        [BerryType.PETAYA]: { type: PokemonType.POISON, power: 100 },
        [BerryType.APICOT]: { type: PokemonType.GROUND, power: 100 },
        [BerryType.LANSAT]: { type: PokemonType.FLYING, power: 100 },
        [BerryType.STARF]: { type: PokemonType.PSYCHIC, power: 100 },
        [BerryType.ENIGMA]: { type: PokemonType.BUG, power: 100 },
      });
      expect(Object.keys(NATURAL_GIFT_TABLE)).toHaveLength(getEnumValues(BerryType).length);
    });

    it("Fling: every held-item type of the fork has its own row; items that never move cannot be thrown", async () => {
      await game.classicMode.startBattle(SpeciesId.PIKACHU);
      const pokemon = game.field.getPlayerPokemon();
      const candidates: unknown[] = [
        ...getEnumValues(BerryType),
        ...getEnumValues(PokemonType).filter(t => t >= PokemonType.NORMAL && t <= PokemonType.FAIRY),
        ...PERMANENT_STATS,
        ...getEnumValues(FormChangeItem),
        "LIGHT_BALL",
        "THICK_CLUB",
        "METAL_POWDER",
        "QUICK_POWDER",
        "DEEP_SEA_SCALE",
        "DEEP_SEA_TOOTH",
      ];
      const held: PokemonHeldItemModifier[] = [];
      for (const [id, func] of Object.entries(modifierTypes)) {
        const type = (func as () => any)();
        const types: any[] = [];
        if (type instanceof ModifierTypeGenerator) {
          type.withIdFromFunc(func as any);
          for (const c of candidates) {
            const generated = type.generateType([pokemon], [c]);
            if (generated) {
              types.push(generated);
            }
          }
        } else {
          type.withIdFromFunc?.(func as any);
          types.push(type);
        }
        for (const t of types) {
          let modifier: unknown;
          try {
            modifier = t.newModifier(pokemon, 0);
          } catch {
            continue;
          }
          if (modifier instanceof PokemonHeldItemModifier) {
            expect(t.id, `${id} has an id`).toBeTruthy();
            held.push(modifier);
          }
        }
      }
      expect(held.length).toBeGreaterThan(80);

      const keys = new Set<string>();
      for (const item of held) {
        const key = getHeldItemKey(item);
        keys.add(key);
        keys.add(key.split(":")[0]);
        const row = FLING_TABLE[key] ?? FLING_TABLE[key.split(":")[0]];
        expect(row, `fling-table.ts row for ${key}`).toBeDefined();
        expect(getFlingEntry(item)).toBe(row);
        if (!item.isTransferable) {
          expect(canFlingItem(item), `${key} never moves, so it is never thrown`).toBe(false);
        }
        if (canFlingItem(item)) {
          expect(getFlingEntry(item).power, key).toBeGreaterThan(0);
        }
      }
      // No row for an item the fork does not have
      for (const key of Object.keys(FLING_TABLE)) {
        expect(keys.has(key), `fling-table.ts row ${key} is a held item`).toBe(true);
      }
    });

    it("Fling: mainline powers and effects of the items the user named", () => {
      const row = (key: string) => FLING_TABLE[key];
      expect(row("FLAME_ORB")).toMatchObject({ power: 30, effect: "burn", source: "mainline" });
      expect(row("TOXIC_ORB")).toMatchObject({ power: 30, effect: "toxic", source: "mainline" });
      expect(row("KINGS_ROCK")).toMatchObject({ power: 30, effect: "flinch", source: "mainline" });
      expect(row("SPECIES_STAT_BOOSTER:LIGHT_BALL")).toMatchObject({ power: 30, effect: "paralysis" });
      expect(row("ATTACK_TYPE_BOOSTER:POISON")).toMatchObject({ power: 70, effect: "poison" });
      expect(row("WHITE_HERB")).toMatchObject({ power: 10, effect: "whiteHerb" });
      expect(row("BERRY:SITRUS")).toMatchObject({ power: 10, effect: "berry" });
      expect(row("ATTACK_TYPE_BOOSTER:ROCK").power).toBe(100);
      expect(row("SPECIES_STAT_BOOSTER:THICK_CLUB").power).toBe(90);
      expect(row("GRIP_CLAW").power).toBe(90);
      expect(row("QUICK_CLAW").power).toBe(80);
      expect(row("ASSAULT_VEST").power).toBe(80);
      expect(row("CHOICE_BAND").power).toBe(10);
      expect(row("FORM_CHANGE_ITEM").throwable).toBe(false);
      expect(row("BASE_STAT_BOOSTER").throwable).toBe(false);
    });

    it("Fling: the rows keep the one-line shape tools/fling/fling_table.py reads", () => {
      const text = readFileSync("src/data/moves/fling-table.ts", "utf-8").replace(/\r\n/g, "\n");
      const block = text.split("// <fling-table:begin>")[1].split("// <fling-table:end>")[0].split("\n").slice(1);
      const rows = block.filter(l => l.trim() !== "");
      expect(rows.length).toBe(Object.keys(FLING_TABLE).length);
      for (const line of rows) {
        expect(line).toMatch(/^ {2}(?:"[A-Z0-9_:]+"|[A-Z0-9_]+): \{ power: \d+(?:, [a-zA-Z]+: [^{}]+)* \},$/);
      }
    });

    it("has its words in both locales", () => {
      const read = (path: string) => JSON.parse(readFileSync(path, "utf-8"));
      for (const lang of ["ko", "en"]) {
        const triggers = read(`locales/${lang}/move-trigger.json`);
        for (const key of ["switchedItems", "obtainedItem", "flungItem", "heldItemsReturned"]) {
          expect(triggers[key], `${lang} ${key}`).toBeTruthy();
        }
        expect(read(`locales/${lang}/battle.json`).moveDisabledNoFlingItem).toBeTruthy();
        const fight = read(`locales/${lang}/fight-ui-handler.json`);
        expect(fight.heldItemChoiceFling).toContain("{{power}}");
        expect(fight.heldItemChoiceNaturalGift).toContain("{{type}}");
      }
    });
  });

  describe("Trick / Switcheroo", () => {
    it("gives the chosen item and takes a random one of the target's, one unit each way", async () => {
      game.override
        .startingHeldItems([
          { name: "LEFTOVERS", count: 2 },
          { name: "LIFE_ORB", count: 1 },
        ])
        .enemyHeldItems([{ name: "SHELL_BELL", count: 2 }]);
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      selectWithItem(MoveId.TRICK, "LEFTOVERS");
      await game.toNextTurn();

      expect(player).toHaveUsedMove({ move: MoveId.TRICK, result: MoveResult.SUCCESS });
      expect(itemsOf(player)).toEqual({ LEFTOVERS: 1, LIFE_ORB: 1, SHELL_BELL: 1 });
      expect(itemsOf(enemy)).toEqual({ SHELL_BELL: 1, LEFTOVERS: 1 });
      expect(game).toHaveShownMessage(
        i18next.t("moveTriggers:switchedItems", { pokemonName: getPokemonNameWithAffix(player) }),
      );
      expect(getHeldItemMoveLedger()).toEqual(
        expect.arrayContaining([
          { pokemonId: player.id, key: "LEFTOVERS", delta: -1 },
          { pokemonId: player.id, key: "SHELL_BELL", delta: 1 },
          { pokemonId: enemy.id, key: "LEFTOVERS", delta: 1 },
          { pokemonId: enemy.id, key: "SHELL_BELL", delta: -1 },
        ]),
      );

      // The battle's end puts everything back
      expect(revertHeldItemMoveChanges()).toBe(true);
      expect(itemsOf(player)).toEqual({ LEFTOVERS: 2, LIFE_ORB: 1 });
      expect(getHeldItemMoveLedger()).toEqual([]);
    });

    it("Switcheroo does the same", async () => {
      game.override
        .moveset([MoveId.SWITCHEROO, MoveId.SPLASH])
        .startingHeldItems([{ name: "QUICK_CLAW", count: 1 }])
        .enemyHeldItems([{ name: "SCOPE_LENS", count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.LIEPARD);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      selectWithItem(MoveId.SWITCHEROO, "QUICK_CLAW");
      await game.toNextTurn();

      expect(itemsOf(player)).toEqual({ SCOPE_LENS: 1 });
      expect(itemsOf(enemy)).toEqual({ QUICK_CLAW: 1 });
    });

    it("only takes with nothing to give, only gives with nothing to take, fails with neither", async () => {
      game.override.enemyHeldItems([{ name: "LEFTOVERS", count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      // Nothing to give: Trick takes
      game.move.select(MoveId.TRICK);
      await game.toNextTurn();
      expect(itemsOf(player)).toEqual({ LEFTOVERS: 1 });
      expect(itemsOf(enemy)).toEqual({});

      // Nothing to take: it gives back what the player now holds
      game.move.select(MoveId.TRICK);
      await game.toNextTurn();
      expect(itemsOf(player)).toEqual({});
      expect(itemsOf(enemy)).toEqual({ LEFTOVERS: 1 });

      // The enemy loses its item, and then neither has anything
      enemy.loseHeldItem(enemy.getHeldItems()[0]);
      game.scene.updateModifiers(false);
      game.move.select(MoveId.TRICK);
      await game.toNextTurn();
      expect(player).toHaveUsedMove({ move: MoveId.TRICK, result: MoveResult.FAIL });
    });

    it("fails against Sticky Hold", async () => {
      game.override
        .startingHeldItems([{ name: "LEFTOVERS", count: 1 }])
        .enemyHeldItems([{ name: "SHELL_BELL", count: 1 }])
        .enemyAbility(AbilityId.STICKY_HOLD);
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      selectWithItem(MoveId.TRICK, "LEFTOVERS");
      await game.toNextTurn();

      expect(player).toHaveUsedMove({ move: MoveId.TRICK, result: MoveResult.FAIL });
      expect(itemsOf(player)).toEqual({ LEFTOVERS: 1 });
      expect(itemsOf(enemy)).toEqual({ SHELL_BELL: 1 });
      // ...which the user's own Sticky Hold does not do
      expect(allMoves[MoveId.TRICK].applyConditions(enemy, player, -1)).toBe(true);
    });

    it("never moves an item that cannot move (a form change item)", async () => {
      game.override
        .startingHeldItems([{ name: "LEFTOVERS", count: 1 }])
        .enemyHeldItems([{ name: "RARE_FORM_CHANGE_ITEM", type: FormChangeItem.ADAMANT_CRYSTAL, count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      selectWithItem(MoveId.TRICK, "LEFTOVERS");
      await game.toNextTurn();
      expect(itemsOf(player)).toEqual({});
      expect(itemsOf(enemy)).toMatchObject({ LEFTOVERS: 1, "RARE_FORM_CHANGE_ITEM:ADAMANT_CRYSTAL": 1 });
    });

    it("the command keeps only a usable choice, and a chosen item gone by the time of the move makes it fail", async () => {
      game.override
        .startingHeldItems([
          { name: "LEFTOVERS", count: 1 },
          { name: "LIFE_ORB", count: 1 },
        ])
        .enemyHeldItems([{ name: "SHELL_BELL", count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      // An item the Pokémon does not hold is not recorded
      selectWithItem(MoveId.TRICK, "QUICK_CLAW");
      await game.phaseInterceptor.to("TurnStartPhase", false);
      expect(game.scene.currentBattle.turnCommands[BattlerIndex.PLAYER]?.heldItemKey).toBeUndefined();
      await game.toNextTurn();
      revertHeldItemMoveChanges();

      selectWithItem(MoveId.TRICK, "LIFE_ORB");
      await game.phaseInterceptor.to("TurnStartPhase", false);
      expect(game.scene.currentBattle.turnCommands[BattlerIndex.PLAYER]?.heldItemKey).toBe("LIFE_ORB");
      // Knocked away before the move
      player.loseHeldItem(player.getHeldItems().find(i => getHeldItemKey(i) === "LIFE_ORB")!);
      const before = itemsOf(enemy);
      await game.toNextTurn();
      expect(player).toHaveUsedMove({ move: MoveId.TRICK, result: MoveResult.FAIL });
      expect(itemsOf(enemy)).toEqual(before);
    });

    it("lifts the Choice lock of the Pokémon that gives or gets a Choice item", async () => {
      game.override
        .startingHeldItems([{ name: "CHOICE_SCARF", count: 1 }])
        .enemyHeldItems([{ name: "LEFTOVERS", count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      selectWithItem(MoveId.TRICK, "CHOICE_SCARF");
      await game.toNextTurn();

      expect(itemsOf(enemy)).toEqual({ CHOICE_SCARF: 1 });
      // The Trick user (locked into Trick by its Scarf) is free again
      expect(player.getTag(BattlerTagType.CHOICE_LOCK)).toBeUndefined();
      expect(player.trySelectMove(player.getMoveset().findIndex(m => m.moveId === MoveId.SPLASH))[0]).toBe(true);
      // The target locks into the next move it uses with the Scarf (Splash, after the Trick)
      expect(enemy.getTag(BattlerTagType.CHOICE_LOCK)).toMatchObject({ moveId: MoveId.SPLASH });
    });

    it("an enemy's Trick swaps the player's items too, and the battle's end puts them back", async () => {
      game.override.startingHeldItems([{ name: "LEFTOVERS", count: 1 }]).enemyHeldItems([
        { name: "TOXIC_ORB", count: 1 },
        { name: "SHELL_BELL", count: 1 },
      ]);
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      // The AI gives the harmful Toxic Orb
      expect(allMoves[MoveId.TRICK].getUserBenefitScore(enemy, player, allMoves[MoveId.TRICK])).toBe(10);
      game.move.select(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.TRICK);
      await game.toNextTurn();

      expect(itemsOf(player)).toEqual({ TOXIC_ORB: 1 });
      expect(itemsOf(enemy)).toEqual({ SHELL_BELL: 1, LEFTOVERS: 1 });

      game.move.select(MoveId.SPLASH);
      await game.doKillOpponents();
      await game.toNextWave();

      expect(itemsOf(player)).toEqual({ LEFTOVERS: 1 });
      expect(game).toHaveShownMessage(i18next.t("moveTriggers:heldItemsReturned"));
    });

    it("the AI does not use it when nothing can change hands", async () => {
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      expect(allMoves[MoveId.TRICK].applyConditions(enemy, player, -1)).toBe(false); // the AI's -20
    });

    // Local fork (2026-11-20), review: a called Trick has no menu choice, so the rule picks the item
    it("a Trick called by Metronome gives the item the rule picks", async () => {
      game.override
        .moveset([MoveId.METRONOME, MoveId.SPLASH])
        .startingHeldItems([{ name: "LEFTOVERS", count: 1 }])
        .enemyHeldItems([{ name: "SHELL_BELL", count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
      const player = game.field.getPlayerPokemon();
      game.move.forceMetronomeMove(MoveId.TRICK);

      game.move.select(MoveId.METRONOME);
      await game.toNextTurn();

      expect(itemsOf(player)).toEqual({ SHELL_BELL: 1 });
      expect(itemsOf(game.field.getEnemyPokemon())).toEqual({ LEFTOVERS: 1 });
    });

    // Local fork (2026-11-20), review: the effect of a status move does not reach a target behind a Substitute
    // (MoveEffectPhase; as upstream, the move is not marked as failed)
    it("nothing changes hands with a target behind a Substitute", async () => {
      game.override
        .startingHeldItems([{ name: "LEFTOVERS", count: 1 }])
        .enemyHeldItems([{ name: "SHELL_BELL", count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      enemy.addTag(BattlerTagType.SUBSTITUTE, 0, MoveId.SUBSTITUTE, enemy.id);

      selectWithItem(MoveId.TRICK, "LEFTOVERS");
      await game.toNextTurn();

      expect(itemsOf(player)).toEqual({ LEFTOVERS: 1 });
      expect(itemsOf(enemy)).toEqual({ SHELL_BELL: 1 });
      expect(getHeldItemMoveLedger()).toEqual([]);
    });
  });

  describe("Fling", () => {
    it("throws the chosen item with its power and effect, and the item comes back after the battle", async () => {
      game.override.startingHeldItems([
        { name: "FLAME_ORB", count: 1 },
        { name: "LEFTOVERS", count: 1 },
      ]);
      await game.classicMode.startBattle(SpeciesId.LUCARIO);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const powers = recordPower(MoveId.FLING, player);
      const orbName = player.getHeldItems().find(i => getHeldItemKey(i) === "FLAME_ORB")!.type.name;

      selectWithItem(MoveId.FLING, "FLAME_ORB");
      await game.toNextTurn();

      expect(player).toHaveUsedMove({ move: MoveId.FLING, result: MoveResult.SUCCESS });
      expect(powers).toEqual([30]);
      expect(enemy).toHaveStatusEffect(StatusEffect.BURN);
      expect(itemsOf(player)).toEqual({ LEFTOVERS: 1 });
      expect(player.status).toBeFalsy(); // its own orb was thrown before the turn's end
      expect(game).toHaveShownMessage(
        i18next.t("moveTriggers:flungItem", { pokemonName: getPokemonNameWithAffix(player), itemName: orbName }),
      );

      game.move.select(MoveId.SPLASH);
      await game.doKillOpponents();
      await game.phaseInterceptor.to("BattleEndPhase");
      expect(itemsOf(player)).toEqual({ FLAME_ORB: 1, LEFTOVERS: 1 });
    });

    it("is thrown even when it misses; the effect needs a hit", async () => {
      game.override.startingHeldItems([{ name: "TOXIC_ORB", count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.LUCARIO);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      selectWithItem(MoveId.FLING, "TOXIC_ORB");
      await game.move.forceMiss();
      await game.toNextTurn();

      expect(itemsOf(player)).toEqual({});
      expect(enemy.status).toBeFalsy();
    });

    it("King's Rock makes a slower target flinch; White Herb restores its lowered stats; a berry is eaten by it", async () => {
      game.override.startingHeldItems([
        { name: "KINGS_ROCK", count: 1 },
        { name: "WHITE_HERB", count: 1 },
        { name: "BERRY", type: BerryType.SITRUS, count: 1 },
      ]);
      await game.classicMode.startBattle(SpeciesId.LUCARIO);
      const enemy = game.field.getEnemyPokemon();

      selectWithItem(MoveId.FLING, "KINGS_ROCK");
      await game.move.selectEnemyMove(MoveId.SPLASH);
      game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
      await game.phaseInterceptor.to("MoveEndPhase");
      expect(enemy.getTag(BattlerTagType.FLINCHED)).toBeDefined();
      await game.toNextTurn();

      enemy.setStatStage(Stat.ATK, -2);
      selectWithItem(MoveId.FLING, "WHITE_HERB");
      await game.toNextTurn();
      expect(enemy).toHaveStatStage(Stat.ATK, 0);

      enemy.hp = Math.floor(enemy.getMaxHp() / 3);
      const hpBefore = enemy.hp;
      selectWithItem(MoveId.FLING, "BERRY:SITRUS");
      await game.toNextTurn();
      expect(enemy.battleData.hasEatenBerry).toBe(true);
      expect(enemy.battleData.berriesEaten).toEqual([]); // not its own berry: Harvest cannot bring it back
      // 10 power of damage, then a quarter of its HP back
      expect(enemy.hp).toBeGreaterThan(hpBefore);
    });

    it("the rule throws the strongest item (enemies, and a move that was not chosen in the menu)", async () => {
      game.override.enemyHeldItems([
        { name: "LEFTOVERS", count: 1 },
        { name: "QUICK_CLAW", count: 1 },
      ]);
      await game.classicMode.startBattle(SpeciesId.LUCARIO);
      const enemy = game.field.getEnemyPokemon();

      game.move.select(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.FLING);
      await game.toNextTurn();

      expect(itemsOf(enemy)).toEqual({ LEFTOVERS: 1 });
      // An enemy's thrown item does not come back
      expect(getHeldItemMoveLedger()).toEqual([]);
    });

    it("the AI scores it by the item it would throw, and leaves it out without one", async () => {
      game.override.enemyHeldItems([{ name: "LEFTOVERS", count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.LUCARIO);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      game.move.changeMoveset(enemy, [MoveId.FLING, MoveId.SPLASH]);
      const fling = allMoves[MoveId.FLING];
      const fling10 = fling.getTargetBenefitScore(enemy, player, fling);

      const quickClaw = modifierTypes.QUICK_CLAW().withIdFromFunc(modifierTypes.QUICK_CLAW).newModifier(enemy);
      await game.scene.addEnemyModifier(quickClaw as PokemonHeldItemModifier);
      // A stronger throw is a better move (target scores count against the target)
      expect(fling.getTargetBenefitScore(enemy, player, fling)).toBeLessThan(fling10);

      for (const item of enemy.getHeldItems()) {
        enemy.loseHeldItem(item);
      }
      expect(enemy.getMoveset()[0].isUsable(enemy, false, true)[0]).toBe(false);
    });

    it("cannot be chosen without an item it can throw", async () => {
      game.override.startingHeldItems([{ name: "BASE_STAT_BOOSTER", type: Stat.ATK, count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.LUCARIO);
      const player = game.field.getPlayerPokemon();

      const [usable, reason] = player.trySelectMove(player.getMoveset().findIndex(m => m.moveId === MoveId.FLING));
      expect(usable).toBe(false);
      expect(reason).toBe(
        i18next.t("battle:moveDisabledNoFlingItem", { pokemonNameWithAffix: getPokemonNameWithAffix(player) }),
      );
      expect(getHeldItemMoveOptions(player, MoveId.FLING)).toEqual([]);
    });

    it("takes the S1 style on top of the item's power (강공 x1.5)", async () => {
      game.override.startingHeldItems([{ name: "QUICK_CLAW", count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.LUCARIO);
      const player = game.field.getPlayerPokemon();
      const powers = recordPower(MoveId.FLING, player);

      selectWithItem(MoveId.FLING, "QUICK_CLAW", MoveStyle.STRONG);
      await game.toNextTurn();

      expect(powers).toEqual([120]);
    });

    // Local fork (2026-11-20), review: main series (Showdown's onPrepareHit) lets the item go before Protect is checked
    it("is thrown into Protect all the same; a thrown Choice item lifts the Choice lock", async () => {
      game.override.startingHeldItems([{ name: "CHOICE_BAND", count: 1 }]).enemyMoveset(MoveId.PROTECT);
      await game.classicMode.startBattle(SpeciesId.LUCARIO);
      const player = game.field.getPlayerPokemon();

      selectWithItem(MoveId.FLING, "CHOICE_BAND");
      await game.toNextTurn();

      expect(itemsOf(player)).toEqual({});
      expect(player.getTag(BattlerTagType.CHOICE_LOCK)).toBeUndefined();
      expect(getHeldItemMoveLedger()).toEqual([{ pokemonId: player.id, key: "CHOICE_BAND", delta: -1 }]);
    });
  });

  describe("Natural Gift", () => {
    it("takes the chosen berry's type and power, and uses the berry up like eating it", async () => {
      game.override.startingHeldItems([
        { name: "BERRY", type: BerryType.SITRUS, count: 1 },
        { name: "BERRY", type: BerryType.SALAC, count: 1 },
      ]);
      await game.classicMode.startBattle(SpeciesId.MEGANIUM);
      const player = game.field.getPlayerPokemon();
      const powers = recordPower(MoveId.NATURAL_GIFT, player);
      const types: PokemonType[] = [];
      const getMoveType = player.getMoveType.bind(player);
      vi.spyOn(player, "getMoveType").mockImplementation((move, simulated) => {
        const type = getMoveType(move, simulated);
        if (move.id === MoveId.NATURAL_GIFT && game.scene.phaseManager.getCurrentPhase()?.is("MoveEffectPhase")) {
          types.push(type);
        }
        return type;
      });

      selectWithItem(MoveId.NATURAL_GIFT, "BERRY:SITRUS");
      await game.toNextTurn();

      expect(player).toHaveUsedMove({ move: MoveId.NATURAL_GIFT, result: MoveResult.SUCCESS });
      expect(powers).toEqual([80]);
      expect(types).toContain(PokemonType.PSYCHIC);
      expect(types).not.toContain(PokemonType.FIGHTING);
      expect(itemsOf(player)).toEqual({ "BERRY:SALAC": 1 });
      expect(player.battleData.berriesEaten).toEqual([BerryType.SITRUS]);
      expect(player.battleData.hasEatenBerry).toBe(false); // not Belch's "ate a berry", not Cud Chew's
      // Eaten: it does not come back after the battle
      expect(getHeldItemMoveLedger()).toEqual([]);
    });

    it("the Berry Pouch can keep the berry (열매주머니 발동 가능)", async () => {
      game.override
        .startingHeldItems([{ name: "BERRY", type: BerryType.LUM, count: 1 }])
        .startingModifier([{ name: "BERRY_POUCH", count: 3 }]);
      await game.classicMode.startBattle(SpeciesId.MEGANIUM);
      const player = game.field.getPlayerPokemon();
      const apply = vi.spyOn(PreserveBerryModifier.prototype, "apply");
      vi.spyOn(player, "randBattleSeedInt").mockReturnValue(0);

      selectWithItem(MoveId.NATURAL_GIFT, "BERRY:LUM");
      await game.toNextTurn();

      expect(apply).toHaveBeenCalled();
      expect(player).toHaveUsedMove({ move: MoveId.NATURAL_GIFT, result: MoveResult.SUCCESS });
      expect(itemsOf(player)).toEqual({ "BERRY:LUM": 1 });
      expect(player.battleData.berriesEaten).toEqual([]);
    });

    // Local fork (2026-11-20), review: Natural Gift is not in the Parental Bond exceptions (unlike Fling)
    it("with Parental Bond: two strikes for one berry", async () => {
      game.override
        .ability(AbilityId.PARENTAL_BOND)
        .startingHeldItems([{ name: "BERRY", type: BerryType.SITRUS, count: 2 }]);
      await game.classicMode.startBattle(SpeciesId.MEGANIUM);
      const player = game.field.getPlayerPokemon();
      const powers = recordPower(MoveId.NATURAL_GIFT, player);

      selectWithItem(MoveId.NATURAL_GIFT, "BERRY:SITRUS");
      await game.toNextTurn();

      expect(powers).toHaveLength(2);
      expect(powers[0]).toBe(80);
      expect(itemsOf(player)).toEqual({ "BERRY:SITRUS": 1 });
      expect(player.battleData.berriesEaten).toEqual([BerryType.SITRUS]);
    });

    it("cannot be chosen without a berry", async () => {
      await game.classicMode.startBattle(SpeciesId.MEGANIUM);
      const player = game.field.getPlayerPokemon();
      const [usable] = player.trySelectMove(player.getMoveset().findIndex(m => m.moveId === MoveId.NATURAL_GIFT));
      expect(usable).toBe(false);
    });

    it("the rule picks a super-effective berry, else the strongest", async () => {
      game.override
        .startingHeldItems([{ name: "LEFTOVERS", count: 1 }])
        .enemyHeldItems([
          { name: "BERRY", type: BerryType.SITRUS, count: 1 },
          { name: "BERRY", type: BerryType.SALAC, count: 1 },
        ])
        .enemySpecies(SpeciesId.MEGANIUM);
      await game.classicMode.startBattle(SpeciesId.MACHAMP);
      const machamp = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const options = getHeldItemMoveOptions(enemy, MoveId.NATURAL_GIFT);

      // Psychic Sitrus (80) is super effective on Machamp; Fighting Salac (100) is not
      expect((pickHeldItem(enemy, MoveId.NATURAL_GIFT, options, machamp) as BerryModifier).berryType).toBe(
        BerryType.SITRUS,
      );
      // Against a Pokémon neither hits super effectively, the strongest
      const lucario = { getAttackTypeEffectiveness: () => 1 } as unknown as Pokemon;
      expect((pickHeldItem(enemy, MoveId.NATURAL_GIFT, options, lucario) as BerryModifier).berryType).toBe(
        BerryType.SALAC,
      );

      game.move.select(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.NATURAL_GIFT);
      await game.toNextTurn();
      expect(itemsOf(enemy)).toEqual({ "BERRY:SALAC": 1 });
    });
  });

  describe("fight menu", () => {
    beforeEach(() => {
      settings.update("general", "moveStyleChoice", true);
      // The headless mock sprite has no frame, which the option menu measures for the item icons; give it one
      vi.spyOn(MockSprite.prototype, "setTexture").mockImplementation(function (this: MockSprite, _key, frame) {
        this.frame = { width: 16, height: 16, name: frame };
        return this;
      });
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

    const fightHandler = () => game.scene.ui.handlers[UiMode.FIGHT] as FightUiHandler;

    it("Fling: the item first, then the style; the command records both", async () => {
      game.override.startingHeldItems([
        { name: "LEFTOVERS", count: 1 },
        { name: "QUICK_CLAW", count: 1 },
      ]);
      await game.classicMode.startBattle(SpeciesId.LUCARIO);

      pressMove(1);
      let itemChoice: { options: string[]; open: string | null } | undefined;
      game.onNextPrompt("CommandPhase", UiMode.OPTION_SELECT, () => {
        const handler = game.scene.ui.getHandler<OptionSelectUiHandler>();
        itemChoice = { options: (handler as any).options.map((o: any) => o.label), open: fightHandler().openChoice };
        handler.setCursor(1); // Quick Claw
        handler.processInput(Button.ACTION);
      });
      let styleOpen: string | null = null;
      game.onNextPrompt("CommandPhase", UiMode.OPTION_SELECT, () => {
        styleOpen = fightHandler().openChoice;
        const handler = game.scene.ui.getHandler<OptionSelectUiHandler>();
        handler.setCursor(0); // 강공
        handler.processInput(Button.ACTION);
      });
      await game.phaseInterceptor.to("TurnStartPhase", false);

      expect(itemChoice?.open).toBe("heldItem");
      expect(itemChoice?.options).toHaveLength(3); // two items and 취소
      expect(itemChoice?.options[1]).toContain("80");
      expect(styleOpen).toBe("moveStyle");
      expect(game.scene.currentBattle.turnCommands[BattlerIndex.PLAYER]).toMatchObject({
        command: Command.FIGHT,
        move: { move: MoveId.FLING },
        heldItemKey: "QUICK_CLAW",
        moveStyle: MoveStyle.STRONG,
      });
    });

    it("cancel goes back one step: from the style to the item (cursor kept), from the item to the moves", async () => {
      game.override.startingHeldItems([
        { name: "LEFTOVERS", count: 1 },
        { name: "QUICK_CLAW", count: 1 },
      ]);
      await game.classicMode.startBattle(SpeciesId.LUCARIO);

      pressMove(1);
      game.onNextPrompt("CommandPhase", UiMode.OPTION_SELECT, () => {
        const handler = game.scene.ui.getHandler<OptionSelectUiHandler>();
        handler.setCursor(1);
        handler.processInput(Button.ACTION);
      });
      game.onNextPrompt("CommandPhase", UiMode.OPTION_SELECT, () => {
        game.scene.ui.getHandler().processInput(Button.CANCEL); // style -> item
      });
      let back: { open: string | null; cursor: number } | undefined;
      game.onNextPrompt("CommandPhase", UiMode.OPTION_SELECT, () => {
        const handler = game.scene.ui.getHandler<OptionSelectUiHandler>();
        back = { open: fightHandler().openChoice, cursor: handler.getCursor() };
        handler.processInput(Button.CANCEL); // item -> moves
      });
      let inMoves = false;
      game.onNextPrompt("CommandPhase", UiMode.FIGHT, () => {
        inMoves = game.scene.currentBattle.turnCommands[BattlerIndex.PLAYER] == null;
        const handler = game.scene.ui.getHandler<FightUiHandler>();
        handler.setCursor(3); // Splash
        handler.processInput(Button.ACTION);
      });
      await game.phaseInterceptor.to("TurnStartPhase", false);

      expect(back).toEqual({ open: "heldItem", cursor: 1 });
      expect(inMoves).toBe(true);
      const command = game.scene.currentBattle.turnCommands[BattlerIndex.PLAYER];
      expect(command?.move?.move).toBe(MoveId.SPLASH);
      expect(command?.heldItemKey).toBeUndefined();
    });

    it("Trick: the item to give, then the move (no style)", async () => {
      game.override
        .startingHeldItems([
          { name: "LEFTOVERS", count: 1 },
          { name: "LIFE_ORB", count: 1 },
        ])
        .enemyHeldItems([{ name: "SHELL_BELL", count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM);

      pressMove(0);
      game.onNextPrompt("CommandPhase", UiMode.OPTION_SELECT, () => {
        const handler = game.scene.ui.getHandler<OptionSelectUiHandler>();
        handler.setCursor(1); // Life Orb
        handler.processInput(Button.ACTION);
      });
      await game.phaseInterceptor.to("TurnStartPhase", false);

      const command = game.scene.currentBattle.turnCommands[BattlerIndex.PLAYER];
      expect(command).toMatchObject({ move: { move: MoveId.TRICK }, heldItemKey: "LIFE_ORB" });
      expect(command?.moveStyle).toBeUndefined();
    });

    it("Natural Gift: each line shows the berry's type and power, and so does the move info", async () => {
      game.override.startingHeldItems([
        { name: "BERRY", type: BerryType.SITRUS, count: 1 },
        { name: "BERRY", type: BerryType.SALAC, count: 1 },
      ]);
      await game.classicMode.startBattle(SpeciesId.MEGANIUM);

      pressMove(2);
      let shown: { labels: string[]; power: string; frame: unknown } | undefined;
      game.onNextPrompt("CommandPhase", UiMode.OPTION_SELECT, () => {
        const handler = game.scene.ui.getHandler<OptionSelectUiHandler>();
        const fight = fightHandler() as any;
        const setTexture = vi.spyOn(fight.typeIcon, "setTexture");
        handler.setCursor(1); // Salac: Fighting 100
        shown = {
          labels: (handler as any).options.map((o: any) => o.label),
          power: fight.powerText.text,
          frame: setTexture.mock.calls.at(-1)?.[1],
        };
        handler.processInput(Button.CANCEL);
      });
      game.onNextPrompt("CommandPhase", UiMode.FIGHT, () => {
        const handler = game.scene.ui.getHandler<FightUiHandler>();
        handler.setCursor(3);
        handler.processInput(Button.ACTION);
      });
      await game.phaseInterceptor.to("TurnStartPhase", false);

      const fighting = i18next.t("pokemonInfo:type.fighting");
      const psychic = i18next.t("pokemonInfo:type.psychic");
      expect(shown?.labels[0]).toContain(psychic);
      expect(shown?.labels[0]).toContain("80");
      expect(shown?.labels[1]).toContain(fighting);
      expect(shown?.labels[1]).toContain("100");
      expect(shown?.power).toBe("100");
      expect(shown?.frame).toBe("fighting");
    });

    it("the Dev Bridge's useMove picks the item by line, key or name (the first line when left out)", async () => {
      game.override.startingHeldItems([
        { name: "LEFTOVERS", count: 1 },
        { name: "QUICK_CLAW", count: 1 },
      ]);
      await game.classicMode.startBattle(SpeciesId.LUCARIO);

      await devBridgeApi.useMove(1, undefined, "normal", "QUICK_CLAW");
      await game.phaseInterceptor.to("TurnStartPhase", false);
      expect(game.scene.currentBattle.turnCommands[BattlerIndex.PLAYER]?.heldItemKey).toBe("QUICK_CLAW");
      await game.toNextTurn();

      // Quick Claw is gone (thrown); Leftovers is the first line
      await devBridgeApi.useMove(1);
      await game.phaseInterceptor.to("TurnStartPhase", false);
      const command = game.scene.currentBattle.turnCommands[BattlerIndex.PLAYER];
      expect(command?.heldItemKey).toBe("LEFTOVERS");
      expect(command?.moveStyle).toBeUndefined();
    });
  });

  describe("revert after battle (도구 변경은 전투 후 되돌아옴)", () => {
    it("an item moved twice is where it started, and nothing is given twice", async () => {
      game.override
        .startingHeldItems([{ name: "LEFTOVERS", count: 1 }])
        .enemyHeldItems([{ name: "SHELL_BELL", count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      selectWithItem(MoveId.TRICK, "LEFTOVERS");
      await game.toNextTurn();
      game.move.select(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.TRICK);
      await game.toNextTurn();

      expect(itemsOf(player)).toEqual({ LEFTOVERS: 1 });
      expect(itemsOf(enemy)).toEqual({ SHELL_BELL: 1 });
      expect(getHeldItemMoveLedger()).toEqual([]);
      expect(revertHeldItemMoveChanges()).toBe(false);
      expect(itemsOf(player)).toEqual({ LEFTOVERS: 1 });
    });

    it("a lent item stolen back (Thief, Pickpocket ...) is not doubled", async () => {
      game.override
        .startingHeldItems([{ name: "LEFTOVERS", count: 2 }])
        .enemyHeldItems([{ name: "SHELL_BELL", count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      selectWithItem(MoveId.TRICK, "LEFTOVERS");
      await game.toNextTurn();
      // A steal through the usual transfer (as Thief does) takes the lent Leftovers back
      const lent = enemy.getHeldItems().find(i => getHeldItemKey(i) === "LEFTOVERS")!;
      expect(game.scene.tryTransferHeldItemModifier(lent, player, false)).toBe(true);
      expect(itemsOf(player)).toEqual({ LEFTOVERS: 2, SHELL_BELL: 1 });

      revertHeldItemMoveChanges();
      expect(itemsOf(player)).toEqual({ LEFTOVERS: 2 });
    });

    it("gives back up to the stack cap", async () => {
      game.override
        .startingHeldItems([{ name: "LEFTOVERS", count: 4 }])
        .enemyHeldItems([{ name: "SHELL_BELL", count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
      const player = game.field.getPlayerPokemon();

      selectWithItem(MoveId.TRICK, "LEFTOVERS");
      await game.toNextTurn();
      // It got back to its cap of 4 some other way meanwhile
      player.getHeldItems().find(i => getHeldItemKey(i) === "LEFTOVERS")!.stackCount = 4;
      const warn = vi.spyOn(console, "warn");

      revertHeldItemMoveChanges();
      expect(itemsOf(player)).toEqual({ LEFTOVERS: 4 });
      expect(warn).toHaveBeenCalled();
    });

    it("a caught enemy gives the player's item back and gets its own back", async () => {
      game.override
        .startingHeldItems([{ name: "LEFTOVERS", count: 1 }])
        .enemyHeldItems([{ name: "SHELL_BELL", count: 1 }])
        .enemySpecies(SpeciesId.MAGIKARP);
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
      const player = game.field.getPlayerPokemon();
      const enemyId = game.field.getEnemyPokemon().id;

      selectWithItem(MoveId.TRICK, "LEFTOVERS");
      await game.toNextTurn();

      game.scene.pokeballCounts[PokeballType.MASTER_BALL] = 1;
      game.doThrowPokeball(PokeballType.MASTER_BALL);
      await game.toNextWave();

      const caught = game.scene.getPlayerParty().find(p => p.id === enemyId);
      expect(caught).toBeDefined();
      expect(itemsOf(player)).toEqual({ LEFTOVERS: 1 });
      expect(itemsOf(caught!)).toEqual({ SHELL_BELL: 1 });
    });

    // Local fork (2026-11-20), review fix: the ledger used to outlive a session reload, so the reloaded battle's end gave
    // the lent item back a second time (the session is saved at the wave's start, before the Trick)
    it("a battle quit midway and continued (Save & Quit) gives nothing back twice", async () => {
      game.override
        .startingHeldItems([{ name: "LEFTOVERS", count: 1 }])
        .enemyHeldItems([{ name: "SHELL_BELL", count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM);

      selectWithItem(MoveId.TRICK, "LEFTOVERS");
      await game.toNextTurn();
      expect(itemsOf(game.field.getPlayerPokemon())).toEqual({ SHELL_BELL: 1 });
      expect(getHeldItemMoveLedger()).not.toEqual([]);

      // Continue from the wave's start, as Save & Quit and Continue do
      await game.reload.reloadSession();
      expect(getHeldItemMoveLedger()).toEqual([]);
      expect(itemsOf(game.field.getPlayerPokemon())).toEqual({ LEFTOVERS: 1 });

      game.move.select(MoveId.SPLASH);
      await game.doKillOpponents();
      await game.toNextWave();
      expect(itemsOf(game.scene.getPlayerParty()[0])).toEqual({ LEFTOVERS: 1 });
    });

    it("the scene's reset (back to the title) drops the ledger without settling it", async () => {
      game.override
        .startingHeldItems([{ name: "LEFTOVERS", count: 1 }])
        .enemyHeldItems([{ name: "SHELL_BELL", count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM);

      selectWithItem(MoveId.TRICK, "LEFTOVERS");
      await game.toNextTurn();
      expect(getHeldItemMoveLedger()).not.toEqual([]);

      game.scene.reset(false, true);
      expect(getHeldItemMoveLedger()).toEqual([]);
      expect(revertHeldItemMoveChanges()).toBe(false);
    });

    it("double battles: a Trick between the player's own Pokémon is put back too", async () => {
      game.override.battleStyle("double").startingHeldItems([{ name: "LEFTOVERS", count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM, SpeciesId.ALAKAZAM);
      const [first, second] = game.scene.getPlayerField();

      // The second (no items) takes from its partner
      game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER);
      game.move.select(MoveId.TRICK, BattlerIndex.PLAYER_2, BattlerIndex.PLAYER);
      await game.toNextTurn();
      expect(itemsOf(first)).toEqual({});
      expect(itemsOf(second)).toEqual({ LEFTOVERS: 1 });

      revertHeldItemMoveChanges();
      expect(itemsOf(first)).toEqual({ LEFTOVERS: 1 });
      expect(itemsOf(second)).toEqual({});
    });
  });

  // Local fork (2026-11-20 night): the user: "도둑질도 되돌림". An enemy's Thief / Covet on a player's Pokémon goes in the
  // same ledger as Trick; the player's own steals, Pickpocket, Magician, Grip Claw and Mini Black Hole stay lasting
  describe("an enemy's Thief / Covet goes back too (도둑질도 되돌림)", () => {
    /** Thief / Covet steal every time (the move's own chance is 30%) */
    function stealAlways(moveId: MoveId): void {
      vi.spyOn(allMoves[moveId], "attrs", "get").mockReturnValue([new StealHeldItemChanceAttr(1)]);
    }

    it.each([
      { name: "Thief", moveId: MoveId.THIEF },
      { name: "Covet", moveId: MoveId.COVET },
    ])("an enemy's $name takes a player's item, and the battle's end gives it back", async ({ moveId }) => {
      stealAlways(moveId);
      game.override
        .startingHeldItems([{ name: "LEFTOVERS", count: 1 }])
        .enemyHeldItems([{ name: "SHELL_BELL", count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.move.select(MoveId.SPLASH);
      await game.move.forceEnemyMove(moveId);
      await game.toNextTurn();
      expect(itemsOf(player)).toEqual({});
      expect(itemsOf(enemy)).toEqual({ SHELL_BELL: 1, LEFTOVERS: 1 });
      expect(getHeldItemMoveLedger()).toContainEqual({ pokemonId: player.id, key: "LEFTOVERS", delta: -1 });

      game.move.select(MoveId.SPLASH);
      await game.doKillOpponents();
      await game.toNextWave();
      expect(itemsOf(player)).toEqual({ LEFTOVERS: 1 });
      expect(game).toHaveShownMessage(i18next.t("moveTriggers:heldItemsReturned"));
    });

    it("the player's own Thief keeps what it takes, and a plain transfer (Magician, Grip Claw ...) stays", async () => {
      stealAlways(MoveId.THIEF);
      game.override
        .moveset([MoveId.THIEF, MoveId.SPLASH])
        .startingHeldItems([{ name: "LEFTOVERS", count: 1 }])
        .enemyHeldItems([{ name: "SHELL_BELL", count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      game.move.select(MoveId.THIEF);
      await game.toNextTurn();
      expect(itemsOf(player)).toEqual({ LEFTOVERS: 1, SHELL_BELL: 1 });
      // A transfer that is not Thief / Covet, as Magician or Grip Claw make, is not written
      const leftovers = player.getHeldItems().find(i => getHeldItemKey(i) === "LEFTOVERS")!;
      expect(game.scene.tryTransferHeldItemModifier(leftovers, enemy, false)).toBe(true);
      expect(getHeldItemMoveLedger()).toEqual([]);

      game.move.select(MoveId.SPLASH);
      await game.doKillOpponents();
      await game.toNextWave();
      expect(itemsOf(player)).toEqual({ SHELL_BELL: 1 });
    });

    it("a wild thief that is caught gives the item back and keeps its own", async () => {
      stealAlways(MoveId.THIEF);
      game.override
        .startingHeldItems([{ name: "LEFTOVERS", count: 1 }])
        .enemyHeldItems([{ name: "SHELL_BELL", count: 1 }])
        .enemySpecies(SpeciesId.MAGIKARP);
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const enemyId = enemy.id;

      game.move.select(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.THIEF);
      await game.toNextTurn();
      expect(itemsOf(enemy)).toEqual({ SHELL_BELL: 1, LEFTOVERS: 1 });

      game.scene.pokeballCounts[PokeballType.MASTER_BALL] = 1;
      game.doThrowPokeball(PokeballType.MASTER_BALL);
      await game.toNextWave();

      const caught = game.scene.getPlayerParty().find(p => p.id === enemyId);
      expect(caught).toBeDefined();
      expect(itemsOf(player)).toEqual({ LEFTOVERS: 1 });
      expect(itemsOf(caught!)).toEqual({ SHELL_BELL: 1 });
    });

    it("running away gives it back", async () => {
      stealAlways(MoveId.THIEF);
      game.override.startingHeldItems([{ name: "LEFTOVERS", count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
      const player = game.field.getPlayerPokemon();

      game.move.select(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.THIEF);
      await game.toNextTurn();
      expect(itemsOf(player)).toEqual({});

      vi.spyOn(activeOverrides, "RUN_SUCCESS_OVERRIDE", "get").mockReturnValue(true);
      (game.scene.phaseManager.getCurrentPhase() as CommandPhase).handleCommand(Command.RUN, 0);
      await game.phaseInterceptor.to("BattleEndPhase");
      expect(itemsOf(player)).toEqual({ LEFTOVERS: 1 });
    });

    it("double battles: it goes back to the Pokémon it was taken from", async () => {
      stealAlways(MoveId.THIEF);
      game.override.battleStyle("double").startingHeldItems([{ name: "LEFTOVERS", count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM, SpeciesId.ALAKAZAM);
      const [first, second] = game.scene.getPlayerField();
      // The second one holds the Leftovers
      const leftovers = first.getHeldItems()[0];
      expect(game.scene.tryTransferHeldItemModifier(leftovers, second, false)).toBe(true);

      game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER);
      game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
      await game.move.forceEnemyMove(MoveId.THIEF, BattlerIndex.PLAYER_2);
      await game.move.forceEnemyMove(MoveId.SPLASH);
      await game.toNextTurn();
      expect(itemsOf(second)).toEqual({});

      game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER);
      game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
      await game.doKillOpponents();
      await game.toNextWave();
      expect(itemsOf(first)).toEqual({});
      expect(itemsOf(second)).toEqual({ LEFTOVERS: 1 });
    });

    it("an item lent by Trick that an enemy steals back is not given twice", async () => {
      stealAlways(MoveId.THIEF);
      game.override
        .startingHeldItems([{ name: "LEFTOVERS", count: 1 }])
        .enemyHeldItems([{ name: "SHELL_BELL", count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      selectWithItem(MoveId.TRICK, "LEFTOVERS");
      await game.toNextTurn();
      game.move.select(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.THIEF);
      await game.toNextTurn();
      expect(itemsOf(player)).toEqual({});
      expect(itemsOf(enemy)).toEqual({ LEFTOVERS: 1, SHELL_BELL: 1 });

      revertHeldItemMoveChanges();
      expect(itemsOf(player)).toEqual({ LEFTOVERS: 1 });
    });
  });
});
