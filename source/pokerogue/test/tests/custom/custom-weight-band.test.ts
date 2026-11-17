import { getPokemonNameWithAffix } from "#app/messages";
import { FULL_RULE_HELD_ITEM_IDS } from "#balance/endless-balance";
import { FORK_UNLOCK, isForkItemLocked } from "#balance/fork-unlock";
import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import {
  ChampionBeltModifier,
  getCustomModifierClass,
  getHpBeltCount,
  getHpBeltMaxHp,
  getHpBeltPercent,
  HP_BELTS,
  type HpBeltId,
  WeightBandModifier,
} from "#modifiers/custom-held-items";
import { ENEMY_CUSTOM_ITEMS } from "#modifiers/enemy-custom-items";
import type { PokemonHeldItemModifier, TurnHeldItemTransferModifier } from "#modifiers/modifier";
import * as Modifier from "#modifiers/modifier";
import {
  itemPoolChecks,
  type ModifierTypeKeys,
  type PokemonHeldItemModifierType,
  regenerateModifierPoolThresholds,
} from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import { getItemIconScale, HP_BELT_ICON_SCALE } from "#ui/item-icon-scale";
import { getModifierPoolForType } from "#utils/modifier-utils";
import { existsSync, readFileSync } from "node:fs";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local fork (2026-11-12): Weight Band (중량밴드, ULTRA = 하이퍼, +10% max HP each, up to 3) and Champion Belt
 * (챔피언벨트, MASTER, +45%, one). The user, from the bulk-item shortlist: "파워웨이트만 넣죠, 하이퍼(10%),
 * 마스터(45%) 하나씩, 하이퍼는 최대 3개로. 이미지는 제가 만들어올게요", then "여기 파워웨이트랑 챔피언벨트
 * 이미지입니다", and for the hyper one "헬스벨트" and then "이름 중량벤드로 바꿔두죠, hp 아이템 이름을" (written 중량밴드, the usual spelling of 밴드) (파워웨이트 is the mainline HP EV item).
 */
describe("Custom held items - Weight Band, Champion Belt", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  /** The stats the belts leave alone */
  const OTHER_STATS = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD] as const;

  const ITEMS = [
    // id, class, icon, ko name, tier, pool weight, cap
    ["WEIGHT_BAND", WeightBandModifier, "weight_band", "중량밴드", ModifierTier.ULTRA, 4, 3],
    ["CHAMPION_BELT", ChampionBeltModifier, "champion_belt", "챔피언벨트", ModifierTier.MASTER, 3, 1],
  ] as const;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyHasPassiveAbility(false)
      .ability(AbilityId.BALL_FETCH)
      .hasPassiveAbility(false)
      .moveset([MoveId.SPLASH, MoveId.THIEF]);
  });

  afterEach(() => {
    itemPoolChecks.clear();
    vi.restoreAllMocks();
  });

  function poolEntry(tier: ModifierTier, id: string) {
    return getModifierPoolForType(ModifierPoolType.PLAYER)[tier].find(w => w.modifierType.id === id);
  }

  function weightOf(tier: ModifierTier, id: string, party: Pokemon[]): number {
    return (poolEntry(tier, id)!.weight as WeightedModifierTypeWeightFunc)(party, 0);
  }

  type ItemId = HpBeltId | "MYSTERY_ENCOUNTER_MACHO_BRACE" | "LEFTOVERS" | "MINI_BLACK_HOLE";

  function itemType(id: ItemId): PokemonHeldItemModifierType {
    return modifierTypes[id]().withIdFromFunc(modifierTypes[id]) as PokemonHeldItemModifierType;
  }

  /**
   * Gives `pokemon` one `id`, as a reward does: added, then the party's stats are recalculated (unless `update` is off)
   * @returns Whether it was added (`false` at the cap; `addModifier`'s own result is `false` for a plain held item)
   */
  function give(pokemon: Pokemon, id: ItemId, update = true): boolean {
    const before = held(pokemon, id)?.getStackCount() ?? 0;
    game.scene.addModifier(itemType(id).newModifier(pokemon), !update, false, false, true);
    return (held(pokemon, id)?.getStackCount() ?? 0) > before;
  }

  function held(pokemon: Pokemon, id: string): PokemonHeldItemModifier | undefined {
    return pokemon.getHeldItems().find(m => m.type.id === id);
  }

  /**
   * Starts a battle with a level 100 Gyarados (base HP 95) leading; with HP IV 0 its HP stat is exactly 300
   * ((2 x 95 + 0) x 100 / 100 + 100 + 10), with IV 5 it is 305. The IVs are set through the override, which a reloaded
   * session applies again. With `withMagikarp`, a Magikarp follows it in the party
   */
  async function startGyarados(hpIv: 0 | 5, withMagikarp = false): Promise<Pokemon> {
    game.override.playerIVs([hpIv, 31, 31, 31, 31, 31]);
    if (withMagikarp) {
      await game.classicMode.startBattle(SpeciesId.GYARADOS, SpeciesId.MAGIKARP);
    } else {
      await game.classicMode.startBattle(SpeciesId.GYARADOS);
    }
    const gyarados = game.scene.getPlayerParty()[0];
    expect(gyarados.ivs[Stat.HP]).toBe(hpIv);
    gyarados.hp = gyarados.getMaxHp();
    return gyarados;
  }

  it("keep their numbers in one frozen table: +10% up to 3 (weight 4), +45% one (weight 3)", () => {
    expect(Object.isFrozen(HP_BELTS)).toBe(true);
    expect(HP_BELTS).toEqual({
      WEIGHT_BAND: { percentPerPiece: 10, maxHeld: 3, poolWeight: 4 },
      CHAMPION_BELT: { percentPerPiece: 45, maxHeld: 1, poolWeight: 3 },
    });
    expect(Object.isFrozen(HP_BELTS.WEIGHT_BAND) && Object.isFrozen(HP_BELTS.CHAMPION_BELT)).toBe(true);
  });

  it("have icons, Korean / English text, save classes, pool entries at their tiers, the full-item rule and the gate", () => {
    const atlas = JSON.parse(readFileSync("./assets/images/items.json", "utf8")).textures[0].frames as {
      filename: string;
      sourceSize: { w: number; h: number };
      trimmed: boolean;
    }[];
    const ko = JSON.parse(readFileSync("./locales/ko/modifier-type.json", "utf8")).ModifierType;
    const en = JSON.parse(readFileSync("./locales/en/modifier-type.json", "utf8")).ModifierType;
    for (const [id, cls, icon, koName, tier, weight] of ITEMS) {
      expect(modifierTypes[id]().iconImage).toBe(icon);
      expect(modifierTypes[id]().localeKey).toBe(`modifierType:ModifierType.${id}`);
      const frame = atlas.find(f => f.filename === icon);
      expect(frame?.sourceSize, icon).toEqual({ w: 32, h: 32 });
      expect(frame?.trimmed, icon).toBe(false);
      // the user's own art, drawn at 0.75 (30 pixels wide, the official belts and bands 21-22)
      expect(existsSync(`./assets/images/items/${icon}.png`), icon).toBe(true);
      expect(getItemIconScale(icon), icon).toBe(HP_BELT_ICON_SCALE);
      expect(ko[id]?.name, id).toBe(koName);
      expect(en[id]?.name && en[id]?.description, id).toBeTruthy();
      expect(getCustomModifierClass(cls.name)).toBe(cls);
      const entry = poolEntry(tier, id);
      expect(entry?.maxWeight, id).toBe(weight);
      expect(entry?.modifierType.tier, id).toBe(tier);
      // in no other tier of the player's pool
      for (const other of [
        ModifierTier.COMMON,
        ModifierTier.GREAT,
        ModifierTier.ULTRA,
        ModifierTier.ROGUE,
        ModifierTier.MASTER,
      ]) {
        if (other !== tier) {
          expect(poolEntry(other, id), `${id} in tier ${other}`).toBeUndefined();
        }
      }
      expect(FULL_RULE_HELD_ITEM_IDS.has(id), id).toBe(true);
      expect(FORK_UNLOCK.gatedItems.has(id), id).toBe(true);
    }
    expect(HP_BELT_ICON_SCALE).toBe(0.75);
    expect(en.WEIGHT_BAND.name).toBe("Weight Band");
    expect(en.CHAMPION_BELT.name).toBe("Champion Belt");
    expect(ko.WEIGHT_BAND.description).toBe(
      "무게를 단 훈련용 밴드. 지니게 하면 최대 HP가 1개당 10%씩 상승한다(합연산, 최대 3개).",
    );
    expect(ko.CHAMPION_BELT.description).toBe(
      "챔피언에게 주어지는 벨트. 지니게 하면 최대 HP가 45% 상승한다(중량밴드와 합연산, 최대 1개).",
    );
  });

  it("raise a max HP by 10% per Weight Band and 45% for the Champion Belt, added up and rounded down once", () => {
    // 300: x1.1 / x1.2 / x1.3, +champion x1.75; champion alone x1.45
    expect([0, 10, 20, 30, 75, 45, 55].map(p => getHpBeltMaxHp(300, p))).toEqual([300, 330, 360, 390, 525, 435, 465]);
    // 305: 335.5 -> 335, 366, 396.5 -> 396 (rounding each +10% on its own would give 395), x1.75 = 533.75 -> 533
    expect([10, 20, 30, 75, 45].map(p => getHpBeltMaxHp(305, p))).toEqual([335, 366, 396, 533, 442]);
    // small and odd stats: 1 HP stays 1 (x1.75 = 1.75), 7 -> 7.7 / 12.25, 999 x 1.55 = 1548.45
    expect([getHpBeltMaxHp(1, 75), getHpBeltMaxHp(7, 10), getHpBeltMaxHp(7, 75)]).toEqual([1, 7, 12]);
    expect(getHpBeltMaxHp(999, 55)).toBe(1548);
  });

  it("give a 300 HP Gyarados 330 / 360 / 390 HP with 1-3 Weight Bands and 525 with the Champion Belt too", async () => {
    const gyarados = await startGyarados(0);
    expect(gyarados.getMaxHp()).toBe(300);
    const stats = OTHER_STATS.map(s => gyarados.getStat(s, false));
    const maxHps: number[] = [];
    for (let i = 0; i < 3; i++) {
      expect(give(gyarados, "WEIGHT_BAND")).toBe(true);
      maxHps.push(gyarados.getMaxHp());
    }
    expect(maxHps).toEqual([330, 360, 390]);
    expect(getHpBeltCount(gyarados, "WEIGHT_BAND")).toBe(3);
    expect(give(gyarados, "CHAMPION_BELT")).toBe(true);
    expect(getHpBeltPercent(gyarados)).toBe(75);
    expect(gyarados.getMaxHp()).toBe(525);
    // HP only: the other stats are untouched
    expect(OTHER_STATS.map(s => gyarados.getStat(s, false))).toEqual(stats);
  });

  it("round down once on an odd HP stat: 305 HP with 3 Weight Bands is 396, with the Champion Belt too 533", async () => {
    const gyarados = await startGyarados(5);
    expect(gyarados.getMaxHp()).toBe(305);
    const atk = gyarados.getStat(Stat.ATK, false);
    give(gyarados, "CHAMPION_BELT");
    expect(gyarados.getMaxHp()).toBe(442); // 305 x 1.45 = 442.25
    for (let i = 0; i < 3; i++) {
      give(gyarados, "WEIGHT_BAND");
    }
    expect(gyarados.getMaxHp()).toBe(533); // 305 x 1.75 = 533.75
    game.scene.removeModifier(held(gyarados, "CHAMPION_BELT")!);
    game.scene.updateModifiers(true);
    expect(gyarados.getMaxHp()).toBe(396); // 305 x 1.3 = 396.5; +10% rounded down three times would be 395
    expect(gyarados.getStat(Stat.ATK, false)).toBe(atk);
  });

  it("multiply the final HP stat, after the Macho Brace", async () => {
    const gyarados = await startGyarados(0);
    give(gyarados, "MYSTERY_ENCOUNTER_MACHO_BRACE");
    held(gyarados, "MYSTERY_ENCOUNTER_MACHO_BRACE")!.stackCount = 5; // +2 HP each
    gyarados.calculateStats();
    expect(gyarados.getMaxHp()).toBe(310);
    for (let i = 0; i < 3; i++) {
      give(gyarados, "WEIGHT_BAND");
    }
    // 310 x 1.3 = 403 (before the Macho Brace it would be 390 + 10 = 400)
    expect(gyarados.getMaxHp()).toBe(403);
  });

  it("leave Wonder Guard's HP at 1", async () => {
    game.override
      .ability(AbilityId.WONDER_GUARD)
      .startingHeldItems([{ name: "WEIGHT_BAND", count: 3 }, { name: "CHAMPION_BELT" }]);
    await game.classicMode.startBattle(SpeciesId.SHEDINJA);
    const shedinja = game.field.getPlayerPokemon();
    expect(getHpBeltPercent(shedinja)).toBe(75);
    expect(shedinja.getMaxHp()).toBe(1);
    expect(shedinja.hp).toBe(1);
  });

  it("raise the current HP by the max HP gained, and cut it back to the max HP once they are gone", async () => {
    const gyarados = await startGyarados(0);
    gyarados.hp = 200;
    give(gyarados, "WEIGHT_BAND");
    expect([gyarados.hp, gyarados.getMaxHp()]).toEqual([230, 330]);
    give(gyarados, "CHAMPION_BELT");
    expect([gyarados.hp, gyarados.getMaxHp()]).toEqual([365, 465]); // +135

    // Removed (only a release or a fusion can take them): the HP never stays above the max HP
    game.scene.removeModifier(held(gyarados, "CHAMPION_BELT")!);
    game.scene.updateModifiers(true);
    expect([gyarados.hp, gyarados.getMaxHp()]).toEqual([330, 330]);
    game.scene.removeModifier(held(gyarados, "WEIGHT_BAND")!);
    game.scene.updateModifiers(true);
    expect([gyarados.hp, gyarados.getMaxHp()]).toEqual([300, 300]);

    // A fainted holder is not revived by one
    gyarados.hp = 0;
    give(gyarados, "WEIGHT_BAND");
    expect([gyarados.hp, gyarados.getMaxHp()]).toEqual([0, 330]);
  });

  it("stop at 3 / 1 per Pokémon: the reward screen cannot give one more to a member at the cap", async () => {
    const gyarados = (await startGyarados(0, true)) as PlayerPokemon;
    const magikarp = game.scene.getPlayerParty()[1] as PlayerPokemon;
    const tooMany = i18next.t("modifierType:ModifierType.PokemonHeldItemModifierType.extra.tooMany", {
      pokemonName: getPokemonNameWithAffix(gyarados),
    });
    for (const [id, , , , , , cap] of ITEMS) {
      for (let i = 0; i < cap; i++) {
        expect(itemType(id).selectFilter!(gyarados), `${id} ${i}/${cap}`).toBeNull();
        expect(give(gyarados, id)).toBe(true);
      }
      expect(held(gyarados, id)!.getStackCount()).toBe(cap);
      expect(itemType(id).selectFilter!(gyarados)).toBe(tooMany);
      // the other member still can take one
      expect(itemType(id).selectFilter!(magikarp)).toBeNull();
      // and a direct add fails at the cap
      expect(give(gyarados, id)).toBe(false);
      expect(held(gyarados, id)!.getStackCount()).toBe(cap);
    }
    expect(gyarados.getMaxHp()).toBe(525);
  });

  it("sit in the pool at 4 / 3 while a party member can take one, and drop to 0 at the cap", async () => {
    const gyarados = await startGyarados(0);
    const party = game.scene.getPlayerParty();
    expect(weightOf(ModifierTier.ULTRA, "WEIGHT_BAND", party)).toBe(4);
    expect(weightOf(ModifierTier.MASTER, "CHAMPION_BELT", party)).toBe(3);
    give(gyarados, "WEIGHT_BAND");
    give(gyarados, "WEIGHT_BAND");
    expect(weightOf(ModifierTier.ULTRA, "WEIGHT_BAND", party)).toBe(4);
    give(gyarados, "WEIGHT_BAND");
    expect(weightOf(ModifierTier.ULTRA, "WEIGHT_BAND", party)).toBe(0);
    expect(weightOf(ModifierTier.MASTER, "CHAMPION_BELT", party)).toBe(3);
    give(gyarados, "CHAMPION_BELT");
    expect(weightOf(ModifierTier.MASTER, "CHAMPION_BELT", party)).toBe(0);
  });

  it("follow the full-item rule: one member at the cap leaves them out for the whole party", async () => {
    const gyarados = await startGyarados(0, true);
    const party = game.scene.getPlayerParty();
    for (let i = 0; i < 3; i++) {
      give(gyarados, "WEIGHT_BAND");
    }
    give(gyarados, "CHAMPION_BELT");
    // Magikarp holds none, but Gyarados is full
    expect(getHpBeltCount(party[1], "WEIGHT_BAND")).toBe(0);
    expect(weightOf(ModifierTier.ULTRA, "WEIGHT_BAND", party)).toBe(0);
    expect(weightOf(ModifierTier.MASTER, "CHAMPION_BELT", party)).toBe(0);
  });

  it("cannot be moved or stolen: Pickup, Thief and the Mini Black Hole pass over them", async () => {
    game.override.enemyHeldItems([{ name: "WEIGHT_BAND", count: 2 }, { name: "CHAMPION_BELT" }, { name: "LEFTOVERS" }]);
    const gyarados = await startGyarados(0);
    const enemy = game.field.getEnemyPokemon();
    for (const [id, cls] of ITEMS) {
      const item = held(enemy, id)!;
      expect(item).toBeInstanceOf(cls);
      expect(item.isTransferable, id).toBe(false);
    }

    // Pickup's loot holds only what the enemy could lose
    game.scene.currentBattle.postBattleLoot = [];
    game.scene.currentBattle.addPostBattleLoot(enemy);
    expect(game.scene.currentBattle.postBattleLoot.map(m => m.type.id)).toEqual(["LEFTOVERS"]);
    game.scene.currentBattle.postBattleLoot = [];

    // Thief (30%, forced) takes the Leftovers, not the higher-tier Champion Belt
    vi.spyOn(Phaser.Math.RND, "frac").mockReturnValue(0);
    game.move.select(MoveId.THIEF);
    await game.phaseInterceptor.to("BerryPhase", false);
    expect(gyarados.getHeldItems().map(m => m.type.id)).toEqual(["LEFTOVERS"]);
    expect(getHpBeltCount(enemy, "WEIGHT_BAND")).toBe(2);
    expect(getHpBeltCount(enemy, "CHAMPION_BELT")).toBe(1);

    // The other way round: an enemy's Mini Black Hole finds nothing to take from a holder of only belts
    game.scene.removeModifier(held(gyarados, "LEFTOVERS")!);
    give(gyarados, "WEIGHT_BAND");
    give(gyarados, "CHAMPION_BELT");
    const hole = itemType("MINI_BLACK_HOLE").newModifier(enemy) as TurnHeldItemTransferModifier;
    expect(hole.apply(enemy)).toBe(false);
    expect(
      gyarados
        .getHeldItems()
        .map(m => m.type.id)
        .sort(),
    ).toEqual(["CHAMPION_BELT", "WEIGHT_BAND"]);
  });

  it("are in no enemy pool and no enemy fork item list", () => {
    for (const poolType of [
      ModifierPoolType.WILD,
      ModifierPoolType.TRAINER,
      ModifierPoolType.ENEMY_BUFF,
      ModifierPoolType.DAILY_STARTER,
    ]) {
      const ids = Object.values(getModifierPoolForType(poolType))
        .flat()
        .map(w => w.modifierType.id);
      for (const [id] of ITEMS) {
        expect(ids, `${id} in pool ${ModifierPoolType[poolType]}`).not.toContain(id);
      }
    }
    const enemyIds: string[] = ENEMY_CUSTOM_ITEMS.candidates.map(c => c.id);
    for (const [id] of ITEMS) {
      expect(enemyIds).not.toContain(id);
    }
  });

  it("are not offered before the first Classic clear", async () => {
    await startGyarados(0);
    const party = game.scene.getPlayerParty();
    const offered = () => {
      for (const [id] of ITEMS) {
        itemPoolChecks.set(id as ModifierTypeKeys, undefined);
      }
      regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0);
      return ITEMS.map(([id]) => itemPoolChecks.get(id as ModifierTypeKeys));
    };
    expect(offered()).toEqual([true, true]);

    game.override.forkContentUnlocked(false);
    for (const [id] of ITEMS) {
      expect(isForkItemLocked(id), id).toBe(true);
    }
    expect(offered()).toEqual([false, false]);

    game.override.forkContentUnlocked(true);
    expect(offered()).toEqual([true, true]);
  });

  it("keep 2 + 1 and the max and current HP through a session save and load", async () => {
    game.override.startingHeldItems([{ name: "WEIGHT_BAND", count: 2 }, { name: "CHAMPION_BELT" }]);
    const gyarados = await startGyarados(0);
    expect(gyarados.getMaxHp()).toBe(495); // 300 x 1.65
    gyarados.hp = 400;

    const { gameData } = game.scene;
    const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
    const session = gameData.parseSessionData(json);
    for (const [id, cls, , , , , cap] of ITEMS) {
      const saved = session.modifiers.find(m => m.typeId === id)!;
      expect(saved.className, id).toBe(cls.name);
      expect(saved.args, id).toEqual([gyarados.id]);
      // biome-ignore lint/performance/noDynamicNamespaceImportAccess: the session loader looks classes up by name here
      const restored = saved.toModifier(Modifier[saved.className]) as PokemonHeldItemModifier;
      expect(restored).toBeInstanceOf(cls);
      expect(restored.stackCount, id).toBe(id === "WEIGHT_BAND" ? 2 : 1);
      expect(restored.getMaxHeldItemCount(gyarados), id).toBe(cap);
    }

    game.reload["sessionData"] = session;
    await game.reload.reloadSession();
    const [loaded] = game.scene.getPlayerParty();
    expect(getHpBeltCount(loaded, "WEIGHT_BAND")).toBe(2);
    expect(getHpBeltCount(loaded, "CHAMPION_BELT")).toBe(1);
    expect(held(loaded, "WEIGHT_BAND")).toBeInstanceOf(WeightBandModifier);
    expect(held(loaded, "CHAMPION_BELT")).toBeInstanceOf(ChampionBeltModifier);
    expect(held(loaded, "WEIGHT_BAND")!.isTransferable).toBe(false);
    expect(held(loaded, "CHAMPION_BELT")!.isTransferable).toBe(false);
    expect([loaded.hp, loaded.getMaxHp()]).toEqual([400, 495]);
    loaded.calculateStats();
    expect([loaded.hp, loaded.getMaxHp()]).toEqual([400, 495]);
  });

  it("apply once to a fusion's HP stat, with the fused-away member's belts moved over up to the cap", async () => {
    const gyarados = (await startGyarados(0, true)) as PlayerPokemon;
    const magikarp = game.scene.getPlayerParty()[1] as PlayerPokemon;
    give(gyarados, "WEIGHT_BAND");
    give(gyarados, "WEIGHT_BAND");
    give(gyarados, "CHAMPION_BELT");
    give(magikarp, "WEIGHT_BAND");
    give(magikarp, "WEIGHT_BAND");

    gyarados.fuse(magikarp);
    expect(game.scene.getPlayerParty()).toHaveLength(1);
    expect(game.scene.getPlayerParty()[0]).toBe(gyarados);
    expect(getHpBeltCount(gyarados, "WEIGHT_BAND")).toBe(3);
    expect(getHpBeltCount(gyarados, "CHAMPION_BELT")).toBe(1);
    const fusedMaxHp = gyarados.getMaxHp();

    // without the belts: HP base ceil((95 + 20) / 2) = 58, (2 x 58 + 0) + 110 = 226
    const belts = gyarados.getHeldItems();
    for (const belt of belts) {
      game.scene.removeModifier(belt);
    }
    gyarados.calculateStats();
    expect(gyarados.getMaxHp()).toBe(226);
    expect(fusedMaxHp).toBe(395); // 226 x 1.75 = 395.5, once on the fused stat
  });
});
