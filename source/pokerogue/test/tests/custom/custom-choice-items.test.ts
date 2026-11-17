import { getPokemonNameWithAffix } from "#app/messages";
import { FULL_RULE_HELD_ITEM_IDS } from "#balance/endless-balance";
import { CHOICE_ITEM_TYPE_IDS, ChoiceLockTag, GorillaTacticsTag, loadBattlerTag } from "#data/battler-tags";
import { allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { SpeciesId } from "#enums/species-id";
import type { EffectiveStat } from "#enums/stat";
import { Stat } from "#enums/stat";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import {
  CHOICE_ARMOR_MULTIPLIER,
  CHOICE_ARMOR_STATS,
  CHOICE_ITEM_MULTIPLIER,
  CHOICE_ITEM_STATS,
  ChoiceArmorModifier,
  ChoiceItemModifier,
} from "#modifiers/custom-held-items";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import * as Modifier from "#modifiers/modifier";
import { ModifierData } from "#system/modifier-data";
import { GameManager } from "#test/framework/game-manager";
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import { SummaryUiMode } from "#ui/summary-ui-handler";
import { getModifierPoolForType } from "#utils/modifier-utils";
import { readFileSync } from "node:fs";
import i18next from "i18next";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Local fork (2026-11-09): Choice Band / Choice Scarf / Choice Specs (구애머리띠 / 구애스카프 / 구애안경), MASTER tier.
 * The user: "마스터 등급 아이템들에 구애머리띠 / 스카프 / 안경 넣어두죠. 사용 후 기술이 고정되는건 교대하면 풀리게" (like
 * Gorilla Tactics, 무아지경). Attack / Speed / Sp. Atk x1.5 while held, and a move lock (`ChoiceLockTag`) from the
 * holder's first executed move until it leaves the field or the battle ends.
 * Local fork (2026-11-09): Choice Armor (구애갑옷), Defense and Sp. Def x1.3 with the same lock (the user: "구애갑옷
 * 아이템을 추가해보죠 ... 기술 고정, 그대신 방/특방 1.3배, 개수 제한 1개, 등급 당연히 마스터").
 */
describe("Custom held items - Choice items", () => {
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
      .enemyLevel(5)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH, MoveId.TACKLE, MoveId.GROWL, MoveId.METRONOME]);
  });

  const items = [
    { name: "CHOICE_BAND", stat: Stat.ATK },
    { name: "CHOICE_SCARF", stat: Stat.SPD },
    { name: "CHOICE_SPECS", stat: Stat.SPATK },
  ] as const;
  /** Local fork (2026-11-09): with Choice Armor */
  type ChoiceName = (typeof items)[number]["name"] | "CHOICE_ARMOR";
  const allNames: readonly ChoiceName[] = [...items.map(i => i.name), "CHOICE_ARMOR"];

  /** A fresh Choice item for `pokemon`, with its type id set the way `overrideHeldItems` and the reward pools do. */
  function newItem(name: ChoiceName, pokemon: Pokemon): PokemonHeldItemModifier {
    return modifierTypes[name]().withIdFromFunc(modifierTypes[name]).newModifier(pokemon) as PokemonHeldItemModifier;
  }

  function choiceItems(pokemon: Pokemon): ChoiceItemModifier[] {
    return pokemon.getHeldItems().filter((m): m is ChoiceItemModifier => m instanceof ChoiceItemModifier);
  }

  function lockOf(pokemon: Pokemon): ChoiceLockTag | undefined {
    return pokemon.getTag(BattlerTagType.CHOICE_LOCK);
  }

  // Local fork (2026-11-09): four with Choice Armor
  it("are four different items whose ids the lock tag knows", () => {
    expect([...CHOICE_ITEM_TYPE_IDS].sort()).toEqual([...allNames].sort());
    expect(CHOICE_ITEM_MULTIPLIER).toBe(1.5);
    for (const { name, stat } of items) {
      expect(CHOICE_ITEM_STATS[name]).toBe(stat);
    }
    expect(CHOICE_ARMOR_STATS).toEqual([Stat.DEF, Stat.SPDEF]);
    expect(CHOICE_ARMOR_MULTIPLIER).toBe(1.3);
    for (const name of allNames) {
      expect(FULL_RULE_HELD_ITEM_IDS.has(name), name).toBe(true);
    }
  });

  describe.each(items)("$name", ({ name, stat }) => {
    it("multiplies only its own stat by 1.5, as an effective stat (the stat itself is untouched)", async () => {
      game.override.startingHeldItems([{ name }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();

      const [item] = choiceItems(snorlax);
      expect(item).toBeDefined();
      expect(item.stackCount).toBe(1);
      expect(item.type.id).toBe(name);
      expect(item.getStats()).toEqual([stat]);
      expect(item.getMultiplier()).toBe(1.5);
      expect(item).not.toBeInstanceOf(ChoiceArmorModifier);
      expect(item.isTransferable).toBe(true);

      const base = snorlax.getEffectiveStat(stat, { ignoreHeldItems: true });
      expect(base).toBe(snorlax.getStat(stat, false));
      expect(snorlax.getEffectiveStat(stat)).toBe(Math.floor(base * 1.5));
      for (const untouched of [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD] as const) {
        if (untouched !== stat) {
          expect(snorlax.getEffectiveStat(untouched)).toBe(
            snorlax.getEffectiveStat(untouched, { ignoreHeldItems: true }),
          );
        }
      }

      // The summary's stats page shows the raised value in green (`getHeldItemBoostedStat`, private)
      await game.scene.ui.setModeWithoutClear(UiMode.SUMMARY, snorlax, SummaryUiMode.DEFAULT, 1 /* Page.STATS */);
      const summary = game.scene.ui.getHandler() as unknown as {
        getHeldItemBoostedStat(s: Stat): number | null;
      };
      expect(summary.getHeldItemBoostedStat(stat)).toBe(Math.floor(snorlax.getStat(stat) * 1.5));
      const other = stat === Stat.ATK ? Stat.SPATK : Stat.ATK;
      expect(summary.getHeldItemBoostedStat(other)).toBeNull();
    });

    it("locks the holder into the first move it uses", async () => {
      game.override.startingHeldItems([{ name }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();
      expect(lockOf(snorlax)).toBeUndefined();
      expect(snorlax.isMoveSelectable(MoveId.TACKLE)[0]).toBe(true);

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(lockOf(snorlax)).toBeInstanceOf(ChoiceLockTag);
      expect(lockOf(snorlax)!.moveId).toBe(MoveId.SPLASH);
      expect(snorlax.isMoveSelectable(MoveId.SPLASH)).toEqual([true, ""]);
      const denied = i18next.t("battle:canOnlyUseMove", {
        moveName: allMoves[MoveId.SPLASH].name,
        pokemonName: getPokemonNameWithAffix(snorlax),
      });
      for (const move of [MoveId.TACKLE, MoveId.GROWL, MoveId.METRONOME]) {
        expect(snorlax.isMoveSelectable(move)).toEqual([false, denied]);
      }
      // The fight menu goes through `trySelectMove` (CommandPhase), which refuses the other moves
      expect(snorlax.trySelectMove(1)[0]).toBe(false);
      expect(snorlax.trySelectMove(0)[0]).toBe(true);

      // ...and the lock holds on the next turn
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(lockOf(snorlax)!.moveId).toBe(MoveId.SPLASH);
      expect(snorlax.hasRestrictingTag(MoveId.TACKLE)).toBe(true);
    });

    it("is one per Pokémon for the player and for enemies", async () => {
      game.override.startingHeldItems([{ name }]).enemyHeldItems([{ name }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);
      const [snorlax, feebas] = game.scene.getPlayerParty();
      const [item] = choiceItems(snorlax);
      expect(item.getMaxHeldItemCount(snorlax)).toBe(1);
      expect(item.getMaxStackCount()).toBe(1);

      game.scene.addModifier(newItem(name, snorlax), true);
      expect(choiceItems(snorlax)).toHaveLength(1);
      expect(item.stackCount).toBe(1);
      const feebasItem = newItem(name, feebas);
      game.scene.addModifier(feebasItem, true);
      expect(game.scene.tryTransferHeldItemModifier(feebasItem, snorlax, false)).toBe(false);
      expect(choiceItems(feebas)).toHaveLength(1);

      const magikarp = game.field.getEnemyPokemon();
      const [enemyItem] = choiceItems(magikarp);
      expect(enemyItem.getMaxHeldItemCount(magikarp)).toBe(1);
    });

    it("survives the session save round trip with the holder's id and the stat as args", async () => {
      game.override.startingHeldItems([{ name }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();
      const [item] = choiceItems(snorlax);
      expect(item.getArgs()).toEqual([snorlax.id, stat]);
      expect(item.clone()).toBeInstanceOf(ChoiceItemModifier);
      expect(item.clone().getArgs()).toEqual([snorlax.id, stat]);

      const { gameData } = game.scene;
      const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
      const saved = gameData.parseSessionData(json).modifiers.find(m => m.typeId === name)!;
      expect(saved.className).toBe("ChoiceItemModifier");
      expect(saved.args).toEqual([snorlax.id, stat]);

      // `GameData.loadSession` looks the class up in the `modifier.ts` namespace, where it is absent
      expect(Modifier[saved.className]).toBeUndefined();
      const restored = saved.toModifier(Modifier[saved.className]) as ChoiceItemModifier;
      expect(restored).toBeInstanceOf(ChoiceItemModifier);
      expect(restored.getStats()).toEqual([stat]);
      expect(restored.getMultiplier()).toBe(1.5);
      expect(restored.type.id).toBe(name);
      expect(restored.stackCount).toBe(1);
      expect(restored.match(item)).toBe(true);
      saved.stackCount = 3;
      expect(saved.toModifier(Modifier[saved.className])!.stackCount).toBe(1);
    });
  });

  it("the three are separate items: one holder can carry several, with every boost and a single lock", async () => {
    game.override.startingHeldItems([{ name: "CHOICE_BAND" }, { name: "CHOICE_SPECS" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const snorlax = game.field.getPlayerPokemon();
    const [band, specs] = choiceItems(snorlax);
    expect(band.matchType(specs)).toBe(false);
    expect(choiceItems(snorlax)).toHaveLength(2);
    expect(snorlax.getEffectiveStat(Stat.ATK)).toBe(
      Math.floor(snorlax.getEffectiveStat(Stat.ATK, { ignoreHeldItems: true }) * 1.5),
    );
    expect(snorlax.getEffectiveStat(Stat.SPATK)).toBe(
      Math.floor(snorlax.getEffectiveStat(Stat.SPATK, { ignoreHeldItems: true }) * 1.5),
    );

    game.move.select(MoveId.GROWL);
    await game.toNextTurn();
    expect(snorlax.summonData.tags.filter(t => t.tagType === BattlerTagType.CHOICE_LOCK)).toHaveLength(1);
    expect(lockOf(snorlax)!.moveId).toBe(MoveId.GROWL);
  });

  describe("move lock", () => {
    beforeEach(() => {
      game.override.startingHeldItems([{ name: "CHOICE_BAND" }]);
    });

    it("a status move locks too", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();

      game.move.select(MoveId.GROWL);
      await game.toNextTurn();

      expect(lockOf(snorlax)!.moveId).toBe(MoveId.GROWL);
      expect(snorlax.isMoveSelectable(MoveId.TACKLE)[0]).toBe(false);
      expect(snorlax.isMoveSelectable(MoveId.GROWL)[0]).toBe(true);
    });

    it("a calling move locks itself, not the move it called", async () => {
      game.move.forceMetronomeMove(MoveId.TACKLE);
      game.override.enemyLevel(100);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();

      game.move.select(MoveId.METRONOME);
      await game.toEndOfTurn();

      expect(snorlax.getLastXMoves(-1)).toEqual([
        expect.objectContaining({ move: MoveId.TACKLE, useMode: MoveUseMode.FOLLOW_UP }),
        expect.objectContaining({ move: MoveId.METRONOME, useMode: MoveUseMode.NORMAL }),
      ]);
      expect(lockOf(snorlax)!.moveId).toBe(MoveId.METRONOME);
      expect(snorlax.hasRestrictingTag(MoveId.TACKLE)).toBe(true);
      expect(snorlax.hasRestrictingTag(MoveId.METRONOME)).toBe(false);
    });

    it("Struggle does not lock", async () => {
      game.override.enemyLevel(100);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();

      // Selected while Tackle still has PP (the helper insists), then every move runs out before the command
      // resolves, so the CommandPhase falls back to Struggle
      game.move.select(MoveId.TACKLE);
      for (const m of snorlax.getMoveset()) {
        m.ppUsed = m.getMovePp();
      }
      await game.toNextTurn();

      expect(snorlax.getLastXMoves()[0].move).toBe(MoveId.STRUGGLE);
      expect(lockOf(snorlax)).toBeUndefined();
      for (const m of snorlax.getMoveset()) {
        m.ppUsed = 0;
      }
      expect(snorlax.isMoveSelectable(MoveId.SPLASH)[0]).toBe(true);
      expect(snorlax.isMoveSelectable(MoveId.TACKLE)[0]).toBe(true);
    });

    it("switching out releases it, and a fresh lock starts after the holder comes back", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);
      const snorlax = game.field.getPlayerPokemon();

      game.move.select(MoveId.GROWL);
      await game.toNextTurn();
      expect(lockOf(snorlax)!.moveId).toBe(MoveId.GROWL);

      game.doSwitchPokemon(1);
      await game.toNextTurn();
      expect(snorlax.isOnField()).toBe(false);
      expect(lockOf(snorlax)).toBeUndefined();

      game.doSwitchPokemon(1);
      await game.toNextTurn();
      expect(game.field.getPlayerPokemon()).toBe(snorlax);
      expect(lockOf(snorlax)).toBeUndefined();
      expect(snorlax.isMoveSelectable(MoveId.SPLASH)[0]).toBe(true);

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(lockOf(snorlax)!.moveId).toBe(MoveId.SPLASH);
      expect(snorlax.isMoveSelectable(MoveId.GROWL)[0]).toBe(false);
    });

    it("its own U-turn releases it", async () => {
      game.override.moveset([MoveId.SPLASH, MoveId.U_TURN]).enemyLevel(100);
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);
      const snorlax = game.field.getPlayerPokemon();

      game.move.select(MoveId.U_TURN);
      game.doSelectPartyPokemon(1);
      await game.toNextTurn();

      expect(snorlax.isOnField()).toBe(false);
      expect(lockOf(snorlax)).toBeUndefined();
    });

    it("being blown away by the opponent's Whirlwind releases it", async () => {
      game.override.enemyLevel(100).enemyMoveset([MoveId.SPLASH, MoveId.WHIRLWIND]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);
      const snorlax = game.field.getPlayerPokemon();

      game.move.select(MoveId.GROWL);
      await game.move.selectEnemyMove(MoveId.SPLASH);
      await game.toNextTurn();
      expect(lockOf(snorlax)!.moveId).toBe(MoveId.GROWL);

      game.move.select(MoveId.GROWL);
      await game.move.selectEnemyMove(MoveId.WHIRLWIND);
      await game.toNextTurn();

      expect(snorlax.isOnField()).toBe(false);
      expect(lockOf(snorlax)).toBeUndefined();
    });

    it("fainting clears it", async () => {
      game.override.enemyMoveset([MoveId.TACKLE]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);
      const snorlax = game.field.getPlayerPokemon();

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(lockOf(snorlax)!.moveId).toBe(MoveId.SPLASH);

      snorlax.hp = 1;
      game.move.select(MoveId.SPLASH);
      game.doSelectPartyPokemon(1);
      await game.toNextTurn();

      expect(snorlax.isFainted()).toBe(true);
      expect(lockOf(snorlax)).toBeUndefined();
    });

    it("the end of the battle clears it, while the holder stays on the field for the next wave", async () => {
      game.override.startingWave(3).disableTrainerWaves();
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();

      game.move.select(MoveId.TACKLE); // knocks out the level 5 Magikarp
      await game.toNextWave();

      expect(game.scene.currentBattle.waveIndex).toBe(4);
      expect(game.field.getPlayerPokemon()).toBe(snorlax);
      expect(lockOf(snorlax)).toBeUndefined();
      expect(snorlax.isMoveSelectable(MoveId.SPLASH)[0]).toBe(true);
    });

    it("losing the item ends it from the next move selection on; the tag goes at the end of the turn", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);
      const [snorlax, feebas] = game.scene.getPlayerParty();

      game.move.select(MoveId.GROWL);
      await game.toNextTurn();
      expect(snorlax.isMoveSelectable(MoveId.SPLASH)[0]).toBe(false);

      const [band] = choiceItems(snorlax);
      expect(game.scene.tryTransferHeldItemModifier(band, feebas, false)).toBe(true);
      expect(choiceItems(snorlax)).toHaveLength(0);
      expect(choiceItems(feebas)).toHaveLength(1);
      // the lock no longer restricts anything...
      expect(snorlax.isMoveSelectable(MoveId.SPLASH)[0]).toBe(true);
      expect(snorlax.getEffectiveStat(Stat.ATK)).toBe(snorlax.getEffectiveStat(Stat.ATK, { ignoreHeldItems: true }));

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      // ...and is gone after the turn; using Splash without an item started no new lock
      expect(lockOf(snorlax)).toBeUndefined();
      expect(snorlax.getLastXMoves()[0].move).toBe(MoveId.SPLASH);
      expect(snorlax.isMoveSelectable(MoveId.TACKLE)[0]).toBe(true);
    });

    // Local fork (2026-11-09, review fix): a lock on a move the holder no longer knows used to leave it only Struggle
    describe("a lock on a move the holder no longer knows lifts, and the next move locks anew", () => {
      it("Mimic", async () => {
        game.override.moveset([MoveId.MIMIC, MoveId.SPLASH]).enemyLevel(100).enemyMoveset(MoveId.GROWL);
        await game.classicMode.startBattle(SpeciesId.SNORLAX);
        const snorlax = game.field.getPlayerPokemon();

        game.move.select(MoveId.MIMIC);
        game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER]);
        await game.toNextTurn();

        expect(snorlax.getMoveset().map(m => m.moveId)).toEqual([MoveId.GROWL, MoveId.SPLASH]);
        expect(lockOf(snorlax)).toBeUndefined();
        expect(snorlax.isMoveSelectable(MoveId.GROWL)[0]).toBe(true);
        expect(snorlax.isMoveSelectable(MoveId.SPLASH)[0]).toBe(true);

        game.move.select(MoveId.SPLASH);
        await game.toNextTurn();
        expect(snorlax.getLastXMoves()[0].move).toBe(MoveId.SPLASH);
        expect(lockOf(snorlax)!.moveId).toBe(MoveId.SPLASH);
        expect(snorlax.isMoveSelectable(MoveId.GROWL)[0]).toBe(false);
      });

      it("Transform", async () => {
        game.override
          .moveset([MoveId.TRANSFORM, MoveId.SPLASH])
          .enemyLevel(100)
          .enemyMoveset([MoveId.GROWL, MoveId.TACKLE]);
        await game.classicMode.startBattle(SpeciesId.MEW);
        const mew = game.field.getPlayerPokemon();

        game.move.select(MoveId.TRANSFORM);
        await game.move.forceEnemyMove(MoveId.GROWL);
        await game.toNextTurn();

        const copied = mew.getMoveset().map(m => m.moveId);
        expect(copied).not.toContain(MoveId.TRANSFORM);
        expect(copied.length).toBeGreaterThan(0);
        expect(lockOf(mew)).toBeUndefined();
        for (const move of copied) {
          expect(mew.isMoveSelectable(move)[0], MoveId[move]).toBe(true);
        }

        game.move.select(copied[0]);
        await game.move.forceEnemyMove(MoveId.GROWL);
        await game.toNextTurn();
        expect(mew.getLastXMoves()[0].move).toBe(copied[0]);
        expect(lockOf(mew)!.moveId).toBe(copied[0]);
      });

      it("the locked move replaced mid-battle (a level-up in a trainer battle)", async () => {
        game.override.moveset([MoveId.GROWL, MoveId.TACKLE]).enemyLevel(100);
        await game.classicMode.startBattle(SpeciesId.SNORLAX);
        const snorlax = game.field.getPlayerPokemon();

        game.move.select(MoveId.GROWL);
        await game.toNextTurn();
        expect(lockOf(snorlax)!.moveId).toBe(MoveId.GROWL);

        game.move.changeMoveset(snorlax, [MoveId.BODY_SLAM, MoveId.TACKLE]);
        expect(snorlax.isMoveSelectable(MoveId.BODY_SLAM)[0]).toBe(true);
        expect(snorlax.isMoveSelectable(MoveId.TACKLE)[0]).toBe(true);

        game.move.select(MoveId.TACKLE);
        await game.toNextTurn();
        expect(snorlax.getLastXMoves()[0].move).toBe(MoveId.TACKLE);
        expect(lockOf(snorlax)!.moveId).toBe(MoveId.TACKLE);
        expect(snorlax.isMoveSelectable(MoveId.BODY_SLAM)[0]).toBe(false);
      });
    });

    it("a mid-battle session save keeps the lock and its move", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();
      game.move.select(MoveId.GROWL);
      await game.toNextTurn();

      const { gameData } = game.scene;
      const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
      const savedTags = gameData.parseSessionData(json).party[0].summonData.tags;
      const saved = savedTags.find(t => t.tagType === BattlerTagType.CHOICE_LOCK);
      expect(saved).toBeInstanceOf(ChoiceLockTag);
      expect((saved as ChoiceLockTag).moveId).toBe(MoveId.GROWL);

      const loaded = loadBattlerTag({ tagType: BattlerTagType.CHOICE_LOCK, turnCount: 0, moveId: MoveId.TACKLE });
      expect(loaded).toBeInstanceOf(ChoiceLockTag);
      expect((loaded as ChoiceLockTag).moveId).toBe(MoveId.TACKLE);
      expect(snorlax.getTag(BattlerTagType.CHOICE_LOCK)).toBeDefined();
    });
  });

  it("with Gorilla Tactics: both lock the same move, both boosts apply, and the ability's lock outlives the item", async () => {
    game.override.ability(AbilityId.GORILLA_TACTICS).startingHeldItems([{ name: "CHOICE_BAND" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);
    const [snorlax, feebas] = game.scene.getPlayerParty();
    const atk = snorlax.getStat(Stat.ATK, false);

    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();

    const gorilla = snorlax.getTag(BattlerTagType.GORILLA_TACTICS);
    expect(gorilla).toBeInstanceOf(GorillaTacticsTag);
    expect(gorilla!.moveId).toBe(MoveId.SPLASH);
    expect(lockOf(snorlax)!.moveId).toBe(MoveId.SPLASH);
    expect(snorlax.isMoveSelectable(MoveId.SPLASH)[0]).toBe(true);
    const [selectable, msg] = snorlax.isMoveSelectable(MoveId.TACKLE);
    expect(selectable).toBe(false);
    expect(msg).toBe(lockOf(snorlax)!.selectionDeniedText(snorlax));
    expect(msg).toBe(gorilla!.selectionDeniedText(snorlax));
    // Gorilla Tactics raises the stat itself, the Band the effective stat: x2.25 as in the main series
    expect(snorlax.getStat(Stat.ATK, false)).toBeCloseTo(atk * 1.5);
    expect(snorlax.getEffectiveStat(Stat.ATK)).toBe(Math.floor(snorlax.getStat(Stat.ATK, false) * 1.5));

    // Without the Band, Gorilla Tactics still holds the Pokémon to Splash
    const [band] = choiceItems(snorlax);
    expect(game.scene.tryTransferHeldItemModifier(band, feebas, false)).toBe(true);
    expect(snorlax.isMoveSelectable(MoveId.TACKLE)[0]).toBe(false);
    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();
    expect(lockOf(snorlax)).toBeUndefined();
    expect(snorlax.getTag(BattlerTagType.GORILLA_TACTICS)!.moveId).toBe(MoveId.SPLASH);
    expect(snorlax.isMoveSelectable(MoveId.TACKLE)[0]).toBe(false);
  });

  it("an enemy holder only picks its locked move, until it loses the item", async () => {
    game.override
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyLevel(100)
      .enemyHeldItems([{ name: "CHOICE_SPECS" }])
      .enemyMoveset([MoveId.WATER_GUN, MoveId.GROWL, MoveId.SPLASH])
      .moveset([MoveId.SPLASH, MoveId.KNOCK_OFF]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.field.getEnemyPokemon();

    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();
    const lock = lockOf(enemy)!;
    expect(lock).toBeInstanceOf(ChoiceLockTag);
    const locked = enemy.getLastXMoves()[0].move;
    expect(lock.moveId).toBe(locked);
    for (const move of [MoveId.WATER_GUN, MoveId.GROWL, MoveId.SPLASH]) {
      expect(enemy.isMoveSelectable(move)[0]).toBe(move === locked);
    }

    for (let turn = 0; turn < 3; turn++) {
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
    }
    const used = enemy.getLastXMoves(-1).map(m => m.move);
    expect(used).toHaveLength(4);
    expect(new Set(used)).toEqual(new Set([locked]));

    // Knock Off removes the Specs: the lock stops restricting at once and is dropped at the end of the turn
    game.move.select(MoveId.KNOCK_OFF);
    await game.toNextTurn();
    expect(choiceItems(enemy)).toHaveLength(0);
    expect(lockOf(enemy)).toBeUndefined();
    for (const move of [MoveId.WATER_GUN, MoveId.GROWL, MoveId.SPLASH]) {
      expect(enemy.isMoveSelectable(move)[0]).toBe(true);
    }
  });

  // Local fork (2026-11-09, review): coverage, no defect found
  it("a holder whose locked move is out of PP or disabled Struggles and stays locked (enemy and player)", async () => {
    game.override
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyLevel(100)
      .enemyHeldItems([{ name: "CHOICE_SPECS" }])
      .startingHeldItems([{ name: "CHOICE_BAND" }])
      .moveset([MoveId.GROWL, MoveId.SPLASH, MoveId.DISABLE]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    // `enemyMoveset` rebuilds the moveset on every read, which would refill the PP
    game.move.changeMoveset(enemy, [MoveId.WATER_GUN, MoveId.GROWL]);

    game.move.select(MoveId.DISABLE);
    game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER]);
    await game.toNextTurn();
    const enemyLock = lockOf(enemy)!.moveId;
    expect(lockOf(player)!.moveId).toBe(MoveId.DISABLE);
    expect([MoveId.WATER_GUN, MoveId.GROWL]).toContain(enemyLock);
    // Disable hit the enemy's locked move: it Struggles from now on
    game.move.select(MoveId.DISABLE);
    await game.toNextTurn();
    expect(enemy.getLastXMoves()[0].move).toBe(MoveId.STRUGGLE);
    expect(lockOf(enemy)!.moveId).toBe(enemyLock);

    // The player's locked Disable runs out of PP: the command falls back to Struggle (selected while it still has PP,
    // as the helper insists, then drained before the command resolves)
    game.move.select(MoveId.DISABLE);
    const disable = player.getMoveset().find(m => m.moveId === MoveId.DISABLE)!;
    disable.ppUsed = disable.getMovePp();
    expect(player.getMoveset().some(m => m.isUsable(player, false, true)[0])).toBe(false);
    await game.toNextTurn();
    expect(player.getLastXMoves()[0].move).toBe(MoveId.STRUGGLE);
    expect(lockOf(player)!.moveId).toBe(MoveId.DISABLE);
  });

  // Local fork (2026-11-09): Choice Armor (구애갑옷), Defense and Sp. Def x1.3, the same lock, one per Pokémon, MASTER
  describe("Choice Armor (구애갑옷)", () => {
    function armorOf(pokemon: Pokemon): ChoiceArmorModifier | undefined {
      return pokemon.getHeldItems().find((m): m is ChoiceArmorModifier => m instanceof ChoiceArmorModifier);
    }

    function unboosted(pokemon: Pokemon, stat: EffectiveStat): number {
      return pokemon.getEffectiveStat(stat, { ignoreHeldItems: true });
    }

    it("has its Korean and English text right after the Choice Specs, and its own icon", () => {
      for (const [lang, name, description] of [
        [
          "ko",
          "구애갑옷",
          "지닌 포켓몬의 방어와 특수방어가 1.3배가 되지만, 처음 쓴 기술만 계속 쓸 수 있다. 교체하거나 배틀이 끝나면 풀린다.",
        ],
        [
          "en",
          "Choice Armor",
          "Raises the holder’s Defense and Sp. Def by 30%, but it can only use the first move it used. Switching out or the end of the battle lifts the lock.",
        ],
      ] as const) {
        const json = JSON.parse(readFileSync(`./locales/${lang}/modifier-type.json`, "utf8"));
        const entries: Record<string, { name: string; description: string }> = json.ModifierType;
        expect(entries.CHOICE_ARMOR, lang).toEqual({ name, description });
        const keys = Object.keys(entries);
        expect(keys.indexOf("CHOICE_ARMOR"), lang).toBe(keys.indexOf("CHOICE_SPECS") + 1);
      }
      expect(modifierTypes.CHOICE_ARMOR().iconImage).toBe("choice_armor");
      expect(modifierTypes.CHOICE_ARMOR().localeKey).toBe("modifierType:ModifierType.CHOICE_ARMOR");
    });

    it("multiplies Defense and Sp. Def by 1.3 and nothing else, as effective stats the summary shows in green", async () => {
      game.override.startingHeldItems([{ name: "CHOICE_ARMOR" }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();

      const armor = armorOf(snorlax)!;
      expect(armor).toBeInstanceOf(ChoiceItemModifier);
      expect(choiceItems(snorlax)).toEqual([armor]);
      expect(armor.type.id).toBe("CHOICE_ARMOR");
      expect(armor.getStats()).toEqual([Stat.DEF, Stat.SPDEF]);
      expect(armor.getMultiplier()).toBe(1.3);
      expect(armor.stackCount).toBe(1);
      expect(armor.isTransferable).toBe(true);

      for (const stat of [Stat.DEF, Stat.SPDEF] as const) {
        expect(unboosted(snorlax, stat)).toBe(snorlax.getStat(stat, false));
        expect(snorlax.getEffectiveStat(stat), Stat[stat]).toBe(Math.floor(unboosted(snorlax, stat) * 1.3));
      }
      for (const stat of [Stat.ATK, Stat.SPATK, Stat.SPD] as const) {
        expect(snorlax.getEffectiveStat(stat), Stat[stat]).toBe(unboosted(snorlax, stat));
      }

      await game.scene.ui.setModeWithoutClear(UiMode.SUMMARY, snorlax, SummaryUiMode.DEFAULT, 1 /* Page.STATS */);
      const summary = game.scene.ui.getHandler() as unknown as {
        getHeldItemBoostedStat(s: Stat): number | null;
      };
      expect(summary.getHeldItemBoostedStat(Stat.DEF)).toBe(Math.floor(snorlax.getStat(Stat.DEF) * 1.3));
      expect(summary.getHeldItemBoostedStat(Stat.SPDEF)).toBe(Math.floor(snorlax.getStat(Stat.SPDEF) * 1.3));
      for (const stat of [Stat.ATK, Stat.SPATK, Stat.SPD] as const) {
        expect(summary.getHeldItemBoostedStat(stat), Stat[stat]).toBeNull();
      }
    });

    it("locks the holder into the first move it uses when it is the only Choice item held", async () => {
      game.override.startingHeldItems([{ name: "CHOICE_ARMOR" }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();
      expect(lockOf(snorlax)).toBeUndefined();

      game.move.select(MoveId.GROWL);
      await game.toNextTurn();

      const lock = lockOf(snorlax)!;
      expect(lock).toBeInstanceOf(ChoiceLockTag);
      expect(lock.moveId).toBe(MoveId.GROWL);
      expect(lock.isInForce(snorlax)).toBe(true);
      expect(snorlax.isMoveSelectable(MoveId.GROWL)).toEqual([true, ""]);
      for (const move of [MoveId.SPLASH, MoveId.TACKLE, MoveId.METRONOME]) {
        expect(snorlax.isMoveSelectable(move)).toEqual([false, lock.selectionDeniedText(snorlax)]);
      }

      game.move.select(MoveId.GROWL);
      await game.toNextTurn();
      expect(lockOf(snorlax)!.moveId).toBe(MoveId.GROWL);
      expect(snorlax.hasRestrictingTag(MoveId.TACKLE)).toBe(true);
    });

    it("with another Choice item: every boost applies, there is one lock, and it holds while either is held", async () => {
      game.override.startingHeldItems([{ name: "CHOICE_ARMOR" }, { name: "CHOICE_SCARF" }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);
      const [snorlax, feebas] = game.scene.getPlayerParty();
      const armor = armorOf(snorlax)!;
      const scarf = choiceItems(snorlax).find(m => m.type.id === "CHOICE_SCARF")!;
      expect(choiceItems(snorlax)).toHaveLength(2);
      expect(armor.matchType(scarf)).toBe(false);
      expect(scarf.matchType(armor)).toBe(false);
      expect(snorlax.getEffectiveStat(Stat.DEF)).toBe(Math.floor(unboosted(snorlax, Stat.DEF) * 1.3));
      expect(snorlax.getEffectiveStat(Stat.SPDEF)).toBe(Math.floor(unboosted(snorlax, Stat.SPDEF) * 1.3));
      expect(snorlax.getEffectiveStat(Stat.SPD)).toBe(Math.floor(unboosted(snorlax, Stat.SPD) * 1.5));
      expect(snorlax.getEffectiveStat(Stat.ATK)).toBe(unboosted(snorlax, Stat.ATK));

      game.move.select(MoveId.GROWL);
      await game.toNextTurn();
      expect(snorlax.summonData.tags.filter(t => t.tagType === BattlerTagType.CHOICE_LOCK)).toHaveLength(1);
      expect(lockOf(snorlax)!.moveId).toBe(MoveId.GROWL);

      // Without the armor, the Scarf keeps the lock in force
      expect(game.scene.tryTransferHeldItemModifier(armor, feebas, false)).toBe(true);
      expect(armorOf(snorlax)).toBeUndefined();
      expect(snorlax.getEffectiveStat(Stat.DEF)).toBe(unboosted(snorlax, Stat.DEF));
      expect(snorlax.isMoveSelectable(MoveId.SPLASH)[0]).toBe(false);
      game.move.select(MoveId.GROWL);
      await game.toNextTurn();
      expect(lockOf(snorlax)!.moveId).toBe(MoveId.GROWL);
      expect(snorlax.isMoveSelectable(MoveId.SPLASH)[0]).toBe(false);
    });

    it("losing the armor while holding no other Choice item ends the lock", async () => {
      game.override.startingHeldItems([{ name: "CHOICE_ARMOR" }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);
      const [snorlax, feebas] = game.scene.getPlayerParty();

      game.move.select(MoveId.GROWL);
      await game.toNextTurn();
      expect(snorlax.isMoveSelectable(MoveId.SPLASH)[0]).toBe(false);

      expect(game.scene.tryTransferHeldItemModifier(armorOf(snorlax)!, feebas, false)).toBe(true);
      expect(armorOf(snorlax)).toBeUndefined();
      expect(armorOf(feebas)).toBeDefined();
      expect(lockOf(snorlax)!.isInForce(snorlax)).toBe(false);
      expect(snorlax.isMoveSelectable(MoveId.SPLASH)[0]).toBe(true);
      expect(snorlax.getEffectiveStat(Stat.DEF)).toBe(unboosted(snorlax, Stat.DEF));

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(lockOf(snorlax)).toBeUndefined();
      expect(snorlax.isMoveSelectable(MoveId.TACKLE)[0]).toBe(true);
    });

    it("switching out and fainting release it", async () => {
      game.override.startingHeldItems([{ name: "CHOICE_ARMOR" }]).enemyMoveset([MoveId.TACKLE]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
      const snorlax = game.field.getPlayerPokemon();

      game.move.select(MoveId.GROWL);
      await game.toNextTurn();
      expect(lockOf(snorlax)!.moveId).toBe(MoveId.GROWL);

      game.doSwitchPokemon(1);
      await game.toNextTurn();
      expect(snorlax.isOnField()).toBe(false);
      expect(lockOf(snorlax)).toBeUndefined();

      game.doSwitchPokemon(1);
      await game.toNextTurn();
      expect(game.field.getPlayerPokemon()).toBe(snorlax);
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(lockOf(snorlax)!.moveId).toBe(MoveId.SPLASH);

      snorlax.hp = 1;
      game.move.select(MoveId.SPLASH);
      game.doSelectPartyPokemon(2);
      await game.toNextTurn();
      expect(snorlax.isFainted()).toBe(true);
      expect(lockOf(snorlax)).toBeUndefined();
    });

    it("the end of the battle clears it, while the holder stays on the field for the next wave", async () => {
      game.override
        .startingHeldItems([{ name: "CHOICE_ARMOR" }])
        .startingWave(3)
        .disableTrainerWaves();
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();

      game.move.select(MoveId.TACKLE); // knocks out the level 5 Magikarp
      await game.toNextWave();

      expect(game.scene.currentBattle.waveIndex).toBe(4);
      expect(game.field.getPlayerPokemon()).toBe(snorlax);
      expect(armorOf(snorlax)).toBeDefined();
      expect(lockOf(snorlax)).toBeUndefined();
      expect(snorlax.isMoveSelectable(MoveId.SPLASH)[0]).toBe(true);
    });

    it("with Gorilla Tactics: both lock the same move; the ability raises Attack, the armor the defences", async () => {
      game.override.ability(AbilityId.GORILLA_TACTICS).startingHeldItems([{ name: "CHOICE_ARMOR" }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);
      const [snorlax, feebas] = game.scene.getPlayerParty();
      const atk = snorlax.getStat(Stat.ATK, false);

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();

      expect(snorlax.getTag(BattlerTagType.GORILLA_TACTICS)!.moveId).toBe(MoveId.SPLASH);
      expect(lockOf(snorlax)!.moveId).toBe(MoveId.SPLASH);
      expect(snorlax.isMoveSelectable(MoveId.TACKLE)[0]).toBe(false);
      expect(snorlax.getStat(Stat.ATK, false)).toBeCloseTo(atk * 1.5);
      expect(snorlax.getEffectiveStat(Stat.ATK)).toBe(unboosted(snorlax, Stat.ATK));
      expect(snorlax.getEffectiveStat(Stat.DEF)).toBe(Math.floor(unboosted(snorlax, Stat.DEF) * 1.3));

      // Without the armor, Gorilla Tactics still holds the Pokémon to Splash; the Choice lock goes after the turn
      expect(game.scene.tryTransferHeldItemModifier(armorOf(snorlax)!, feebas, false)).toBe(true);
      expect(snorlax.isMoveSelectable(MoveId.TACKLE)[0]).toBe(false);
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(lockOf(snorlax)).toBeUndefined();
      expect(snorlax.getTag(BattlerTagType.GORILLA_TACTICS)!.moveId).toBe(MoveId.SPLASH);
    });

    it("is one per Pokémon for the player and for enemies, capped only against another Choice Armor", async () => {
      game.override.startingHeldItems([{ name: "CHOICE_ARMOR" }]).enemyHeldItems([{ name: "CHOICE_ARMOR" }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);
      const [snorlax, feebas] = game.scene.getPlayerParty();
      const armor = armorOf(snorlax)!;
      expect(armor.getMaxHeldItemCount(snorlax)).toBe(1);
      expect(armor.getMaxStackCount()).toBe(1);

      game.scene.addModifier(newItem("CHOICE_ARMOR", snorlax), true);
      expect(snorlax.getHeldItems().filter(m => m instanceof ChoiceArmorModifier)).toHaveLength(1);
      expect(armor.stackCount).toBe(1);
      const feebasArmor = newItem("CHOICE_ARMOR", feebas);
      game.scene.addModifier(feebasArmor, true);
      expect(armor.matchType(feebasArmor)).toBe(true);
      expect(game.scene.tryTransferHeldItemModifier(feebasArmor, snorlax, false)).toBe(false);
      expect(armorOf(feebas)).toBe(feebasArmor);

      // The Band / Scarf / Specs are other items: each still fits beside the armor
      for (const { name } of items) {
        game.scene.addModifier(newItem(name, snorlax), true);
      }
      expect(
        choiceItems(snorlax)
          .map(m => m.type.id)
          .sort(),
      ).toEqual([...allNames].sort());
      for (const other of choiceItems(snorlax).filter(m => m !== armor)) {
        expect(armor.matchType(other), other.type.id).toBe(false);
        expect(other.matchType(armor), other.type.id).toBe(false);
      }

      const magikarp = game.field.getEnemyPokemon();
      expect(armorOf(magikarp)!.getMaxHeldItemCount(magikarp)).toBe(1);
    });

    it("survives a session save and reload, and the Band / Scarf / Specs still load from their saved args", async () => {
      game.override.startingHeldItems([{ name: "CHOICE_ARMOR" }, { name: "CHOICE_BAND" }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();
      const armor = armorOf(snorlax)!;
      expect(armor.getArgs()).toEqual([snorlax.id]);
      expect(armor.clone()).toBeInstanceOf(ChoiceArmorModifier);
      expect(armor.clone().getArgs()).toEqual([snorlax.id]);
      expect(armor.clone().getStats()).toEqual([Stat.DEF, Stat.SPDEF]);
      const stats = ([Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD] as const).map(s =>
        snorlax.getEffectiveStat(s),
      );

      const { gameData } = game.scene;
      const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
      const session = gameData.parseSessionData(json);
      const saved = session.modifiers.find(m => m.typeId === "CHOICE_ARMOR")!;
      expect(saved.className).toBe("ChoiceArmorModifier");
      expect(saved.args).toEqual([snorlax.id]);
      expect(session.modifiers.find(m => m.typeId === "CHOICE_BAND")!.args).toEqual([snorlax.id, Stat.ATK]);

      // `GameData.loadSession` looks the class up in the `modifier.ts` namespace, where it is absent
      expect(Modifier[saved.className]).toBeUndefined();
      const restored = saved.toModifier(Modifier[saved.className]) as ChoiceArmorModifier;
      expect(restored).toBeInstanceOf(ChoiceArmorModifier);
      expect(restored.getStats()).toEqual([Stat.DEF, Stat.SPDEF]);
      expect(restored.getMultiplier()).toBe(1.3);
      expect(restored.type.id).toBe("CHOICE_ARMOR");
      expect(restored.match(armor)).toBe(true);
      saved.stackCount = 3;
      expect(saved.toModifier(Modifier[saved.className])!.stackCount).toBe(1);
      saved.stackCount = 1;

      // Saves made before the armor existed: a Band / Scarf / Specs saved as [holder id, stat]
      for (const { name, stat } of items) {
        const old = new ModifierData(
          { player: true, typeId: name, className: "ChoiceItemModifier", args: [snorlax.id, stat], stackCount: 1 },
          true,
        );
        const item = old.toModifier(Modifier[old.className]) as ChoiceItemModifier;
        expect(item, name).toBeInstanceOf(ChoiceItemModifier);
        expect(item).not.toBeInstanceOf(ChoiceArmorModifier);
        expect(item.type.id).toBe(name);
        expect(item.getStats()).toEqual([stat]);
        expect(item.getMultiplier()).toBe(1.5);
        expect(item.pokemonId).toBe(snorlax.id);
      }

      // The whole session through a reload
      game.reload["sessionData"] = session;
      await game.reload.reloadSession();
      const [loaded] = game.scene.getPlayerParty();
      expect(
        choiceItems(loaded)
          .map(m => m.type.id)
          .sort(),
      ).toEqual(["CHOICE_ARMOR", "CHOICE_BAND"]);
      expect(armorOf(loaded)).toBeInstanceOf(ChoiceArmorModifier);
      expect(armorOf(loaded)!.getStats()).toEqual([Stat.DEF, Stat.SPDEF]);
      expect(
        ([Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD] as const).map(s => loaded.getEffectiveStat(s)),
      ).toEqual(stats);
    });
  });

  // Local fork (2026-11-09): Choice Armor too
  it("sit in the MASTER tier of the player pool at weight 8 each, left out once one party member holds one", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);
    const party = game.scene.getPlayerParty();
    const master = getModifierPoolForType(ModifierPoolType.PLAYER)[ModifierTier.MASTER];

    for (const name of allNames) {
      const entry = master.find(w => w.modifierType.id === name)!;
      expect(entry, name).toBeDefined();
      expect(entry.modifierType.tier).toBe(ModifierTier.MASTER);
      expect(entry.maxWeight).toBe(8);
      const weight = entry.weight as WeightedModifierTypeWeightFunc;
      expect(weight(party, 0)).toBe(8);

      const held = entry.modifierType.newModifier(party[1]) as PokemonHeldItemModifier;
      game.scene.addModifier(held, true);
      expect(choiceItems(party[1]).some(m => m.type.id === name)).toBe(true);
      expect(choiceItems(party[0])).toHaveLength(0);
      // Feebas holds one and Snorlax has room: one holder is enough to leave it out
      expect(weight(party, 0)).toBe(0);
    }
    // Not in the trainer or enemy pools, like the vests
    for (const poolType of [ModifierPoolType.TRAINER, ModifierPoolType.WILD]) {
      const pool = getModifierPoolForType(poolType);
      const ids = Object.values(pool)
        .flat()
        .map(w => w.modifierType.id);
      for (const name of allNames) {
        expect(ids).not.toContain(name);
      }
    }
  });
});
