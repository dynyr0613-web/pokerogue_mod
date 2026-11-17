import { getPokemonNameWithAffix } from "#app/messages"; // Local fork (2026-11-10)
import { allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { AssaultVestModifier, BulletproofVestModifier } from "#modifiers/custom-held-items";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import * as Modifier from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import { getModifierPoolForType } from "#utils/modifier-utils";
import { readFileSync } from "node:fs"; // Local fork (2026-11-10)
import i18next from "i18next"; // Local fork (2026-11-10)
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Custom held items - vests", () => {
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
      .enemySpecies(SpeciesId.RATTATA)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH]);
  });

  const vests = [
    { name: "ASSAULT_VEST", cls: AssaultVestModifier, stat: Stat.SPDEF, other: Stat.DEF },
    { name: "BULLETPROOF_VEST", cls: BulletproofVestModifier, stat: Stat.DEF, other: Stat.SPDEF },
  ] as const;

  /** A fresh vest for `pokemon`, with its type id set the way `overrideHeldItems` and the reward pools do. */
  function newVest(name: (typeof vests)[number]["name"], pokemon: Pokemon): PokemonHeldItemModifier {
    return modifierTypes[name]().withIdFromFunc(modifierTypes[name]).newModifier(pokemon) as PokemonHeldItemModifier;
  }

  describe.each(vests)("$name", ({ name, cls, stat, other }) => {
    it("multiplies only its own stat by 1.5", async () => {
      game.override.startingHeldItems([{ name }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();

      const vest = snorlax.getHeldItems().find(m => m instanceof cls);
      expect(vest).toBeDefined();
      expect(vest!.stackCount).toBe(1);
      expect(vest!.type.id).toBe(name);
      expect(vest!.isTransferable).toBe(true);

      const base = snorlax.getEffectiveStat(stat, { ignoreHeldItems: true });
      expect(base).toBe(snorlax.getStat(stat, false));
      expect(snorlax.getEffectiveStat(stat)).toBe(Math.floor(base * 1.5));
      for (const untouched of [other, Stat.ATK, Stat.SPATK, Stat.SPD] as const) {
        expect(snorlax.getEffectiveStat(untouched)).toBe(
          snorlax.getEffectiveStat(untouched, { ignoreHeldItems: true }),
        );
      }
    });

    it("stacks up to 3 on the player's Pokemon, adding 50% each (x1.5 / x2 / x2.5)", async () => {
      game.override.startingHeldItems([{ name }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);
      const [snorlax, feebas] = game.scene.getPlayerParty();
      const vest = snorlax.getHeldItems().find(m => m instanceof cls)!;
      expect(vest.getMaxHeldItemCount(snorlax)).toBe(3);
      expect(vest.getMaxStackCount()).toBe(3);
      const base = snorlax.getEffectiveStat(stat, { ignoreHeldItems: true });

      for (const [stacks, mult] of [
        [1, 1.5],
        [2, 2],
        [3, 2.5],
      ] as const) {
        if (stacks > 1) {
          game.scene.addModifier(newVest(name, snorlax), true);
        }
        expect(vest.stackCount).toBe(stacks);
        expect(snorlax.getEffectiveStat(stat)).toBe(Math.floor(base * mult));
        expect(snorlax.getEffectiveStat(other)).toBe(snorlax.getEffectiveStat(other, { ignoreHeldItems: true }));
      }

      // A fourth copy is refused, and so is a transfer onto a full holder
      game.scene.addModifier(newVest(name, snorlax), true);
      expect(vest.stackCount).toBe(3);
      expect(snorlax.getHeldItems().filter(m => m instanceof cls)).toHaveLength(1);
      const feebasVest = newVest(name, feebas);
      game.scene.addModifier(feebasVest, true);
      expect(game.scene.tryTransferHeldItemModifier(feebasVest, snorlax, false)).toBe(false);
      expect(vest.stackCount).toBe(3);
      expect(feebas.getHeldItems().filter(m => m instanceof cls)).toHaveLength(1);
    });

    it("stays at one for an enemy", async () => {
      game.override.enemyHeldItems([{ name }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const rattata = game.field.getEnemyPokemon();
      const vest = rattata.getHeldItems().find(m => m instanceof cls)!;
      expect(vest.getMaxHeldItemCount(rattata)).toBe(1);
    });

    it("survives the session save round trip with only the holder's id as args", async () => {
      game.override.startingHeldItems([{ name }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();
      const vest = snorlax.getHeldItems().find(m => m instanceof cls)!;
      expect(vest.getArgs()).toEqual([snorlax.id]);
      expect(vest.clone()).toBeInstanceOf(cls);
      expect(vest.clone().getArgs()).toEqual([snorlax.id]);

      const { gameData } = game.scene;
      const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
      const saved = gameData.parseSessionData(json).modifiers.find(m => m.typeId === name)!;
      expect(saved.className).toBe(cls.name);
      expect(saved.args).toEqual([snorlax.id]);
      expect(saved.stackCount).toBe(1);

      // `GameData.loadSession` looks the class up by name in the `modifier.ts` namespace, where ours is absent
      expect(Modifier[saved.className]).toBeUndefined();
      const restored = saved.toModifier(Modifier[saved.className])!;
      expect(restored).toBeInstanceOf(cls);
      expect(restored.getArgs()).toEqual([snorlax.id]);
      expect(restored.stackCount).toBe(1);
      expect(restored.type.id).toBe(name);
      expect(restored.match(vest)).toBe(true);

      // A saved stack of 3 loads as 3, an over-stacked save is clamped back to 3
      saved.stackCount = 3;
      expect(saved.toModifier(Modifier[saved.className])!.stackCount).toBe(3);
      saved.stackCount = 5;
      expect(saved.toModifier(Modifier[saved.className])!.stackCount).toBe(3);
    });
  });

  it("the two vests are different items that can be held together", async () => {
    game.override.startingHeldItems([{ name: "ASSAULT_VEST" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const snorlax = game.field.getPlayerPokemon();
    const assault = snorlax.getHeldItems().find(m => m instanceof AssaultVestModifier)!;
    const bulletproof = newVest("BULLETPROOF_VEST", snorlax);

    expect(assault.matchType(bulletproof)).toBe(false);
    expect(bulletproof.matchType(assault)).toBe(false);
    game.scene.addModifier(bulletproof, true);
    expect(snorlax.getHeldItems().filter(m => m instanceof AssaultVestModifier)).toHaveLength(1);
    expect(snorlax.getHeldItems().filter(m => m instanceof BulletproofVestModifier)).toHaveLength(1);

    const def = snorlax.getEffectiveStat(Stat.DEF, { ignoreHeldItems: true });
    const spDef = snorlax.getEffectiveStat(Stat.SPDEF, { ignoreHeldItems: true });
    expect(snorlax.getEffectiveStat(Stat.DEF)).toBe(Math.floor(def * 1.5));
    expect(snorlax.getEffectiveStat(Stat.SPDEF)).toBe(Math.floor(spDef * 1.5));
  });

  it("multiplies with Eviolite while its own stacks add up", async () => {
    game.override.startingHeldItems([{ name: "ASSAULT_VEST", count: 2 }, { name: "EVIOLITE" }]);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const feebas = game.field.getPlayerPokemon();
    const base = feebas.getEffectiveStat(Stat.SPDEF, { ignoreHeldItems: true });
    // Eviolite x1.5, two vests x2 (not x1.5 x1.5)
    expect(feebas.getEffectiveStat(Stat.SPDEF)).toBe(Math.floor(base * 3));
  });

  // The summary screen shows the raw stat (`Pokemon.getStat`), like it does for Eviolite, so the vest's
  // boost is only visible in damage. Simulated damage has no random roll, so it can be compared exactly.
  describe.each([
    { name: "ASSAULT_VEST", cls: AssaultVestModifier, hit: MoveId.WATER_GUN, other: MoveId.TACKLE },
    { name: "BULLETPROOF_VEST", cls: BulletproofVestModifier, hit: MoveId.TACKLE, other: MoveId.WATER_GUN },
  ] as const)("$name in damage", ({ name, cls, hit, other }) => {
    it("cuts the damage of its own category and leaves the other category alone", async () => {
      game.override.startingHeldItems([{ name }]).startingLevel(50).enemyLevel(50);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();
      const rattata = game.field.getEnemyPokemon();
      const damage = (moveId: MoveId) =>
        snorlax.getAttackDamage({ source: rattata, move: allMoves[moveId], simulated: true }).damage;

      const withVest = [damage(hit), damage(other)];
      game.scene.removeModifier(snorlax.getHeldItems().find(m => m instanceof cls)!);
      const without = [damage(hit), damage(other)];

      expect(without[0]).toBeGreaterThan(0);
      expect(withVest[0]).toBeLessThan(without[0]);
      expect(withVest[0]).toBeLessThanOrEqual(Math.ceil(without[0] / 1.5) + 1);
      expect(withVest[1]).toBe(without[1]);
    });
  });

  it("sits in the MASTER tier of the player pool at weight 12 until one party member holds 3", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);
    const party = game.scene.getPlayerParty();
    const master = getModifierPoolForType(ModifierPoolType.PLAYER)[ModifierTier.MASTER];

    for (const { name, cls } of vests) {
      const entry = master.find(w => w.modifierType.id === name)!;
      expect(entry).toBeDefined();
      expect(entry.modifierType.tier).toBe(ModifierTier.MASTER);
      expect(entry.maxWeight).toBe(12);
      const weight = entry.weight as WeightedModifierTypeWeightFunc;

      expect(weight(party, 0)).toBe(12);
      for (let i = 0; i < 3; i++) {
        game.scene.addModifier(entry.modifierType.newModifier(party[0]), true);
      }
      expect(party[0].getHeldItems().find(m => m instanceof cls)!.stackCount).toBe(3);
      // Snorlax is full and Feebas has room: since 2026-11-06 one full holder is enough to leave it out
      expect(weight(party, 0)).toBe(0);
    }
  });

  // Local fork (2026-11-10): the user: "돌격조끼와 방탄조끼에 랭크업 기술 사용 불가를 넣어둡시다"
  describe.each([
    { name: "ASSAULT_VEST", cls: AssaultVestModifier, raise: MoveId.SWORDS_DANCE, itemName: "돌격조끼" },
    { name: "BULLETPROOF_VEST", cls: BulletproofVestModifier, raise: MoveId.CALM_MIND, itemName: "방탄조끼" },
  ] as const)("$name and stat-raising moves", ({ name, cls, raise, itemName }) => {
    it("blocks selecting a stat-raising move, not a damaging move with a self-boost; removing the vest lifts it", async () => {
      game.override
        .startingHeldItems([{ name }])
        .moveset([raise, MoveId.FLAME_CHARGE, MoveId.SPLASH])
        .enemySpecies(SpeciesId.SNORLAX)
        .enemyLevel(100);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();

      const denied = i18next.t("battle:vestNoStatRaiseMove", {
        pokemonNameWithAffix: getPokemonNameWithAffix(snorlax),
        itemName: modifierTypes[name]().name,
      });
      expect(snorlax.isMoveSelectable(raise)).toEqual([false, denied]);
      // The fight menu goes through `trySelectMove`, the AI and Struggle through `isUsable(…, forSelection)`
      expect(snorlax.trySelectMove(0)[0]).toBe(false);
      expect(snorlax.getMoveset()[0].isUsable(snorlax, false, true)[0]).toBe(false);
      expect(snorlax.isMoveSelectable(MoveId.SPLASH)).toEqual([true, ""]);
      // The Korean text names the vest
      const ko = (file: string) => JSON.parse(readFileSync(`./locales/ko/${file}.json`, "utf8"));
      expect(ko("modifier-type").ModifierType[name].name).toBe(itemName);
      expect(ko("battle").vestNoStatRaiseMove).toBe(
        "{{pokemonNameWithAffix}}[[는]] {{itemName}} 때문에\n능력을 올리는 기술을 쓸 수 없다!",
      );

      game.move.select(MoveId.FLAME_CHARGE);
      await game.toEndOfTurn();
      expect(snorlax.getStatStage(Stat.SPD)).toBe(1);

      game.scene.removeModifier(snorlax.getHeldItems().find(m => m instanceof cls)!);
      expect(snorlax.isMoveSelectable(raise)).toEqual([true, ""]);
    });
  });

  it("makes a stat-raising move used anyway (called by Metronome) fail", async () => {
    game.override.startingHeldItems([{ name: "ASSAULT_VEST" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const snorlax = game.field.getPlayerPokemon();
    game.move.use(MoveId.METRONOME);
    game.move.forceMetronomeMove(MoveId.SWORDS_DANCE);
    await game.toEndOfTurn();
    expect(snorlax.getStatStage(Stat.ATK)).toBe(0);
  });
});
