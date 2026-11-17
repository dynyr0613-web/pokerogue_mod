import { getPokemonNameWithAffix } from "#app/messages";
import { FULL_RULE_HELD_ITEM_IDS } from "#balance/endless-balance";
import { allMoves, modifierTypes } from "#data/data-lists";
import { PokemonSummonData } from "#data/pokemon-data";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { EFFECTIVE_STATS, type EffectiveStat, getStatKey, Stat, type StatStage } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { BATTLE_HELD_ITEMS, type BattleHeldItemId, getHighestStat } from "#modifiers/battle-held-items";
import {
  BoosterEnergyModifier,
  ClearAmuletModifier,
  getCustomModifierClass,
  MuscleBandModifier,
  ThroatSprayModifier,
  WiseGlassesModifier,
} from "#modifiers/custom-held-items";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import * as Modifier from "#modifiers/modifier";
import type { ModifierOverride, PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import { NumberHolder } from "#utils/common";
import { getModifierPoolForType } from "#utils/modifier-utils";
import { readFileSync } from "node:fs";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local fork (2026-11-11): 클리어참 / 부스트에너지 / 목스프레이 / 힘의머리띠 / 박식안경. The user: "클리어참 / 부스트에너지
 * 추가해두죠. 클리어참은 효과 그대로 로그 등급, 부스트에너지(로그)는 일반 포켓몬이 가지고있으면 가장 높은 능력 1.2배, 패러독스
 * 포켓몬(코라미라이돈 포함)은 1.5배. 목스프레이(전투당 한번, 소리 기술 사용 시 특수공격 +1)도 넣어둡시다, 하이퍼 정도가
 * 적당하겠네요. 힘의머리띠 / 박식안경도 하이퍼 등급으로 넣어두죠".
 */
describe("Custom items - Clear Amulet, Booster Energy, Throat Spray, Muscle Band, Wise Glasses", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  const ITEMS = [
    // id, class, icon, ko name, tier, pool weight, Cobblemon icon (new 32x32 frame)
    ["CLEAR_AMULET", ClearAmuletModifier, "clear_amulet", "클리어참", ModifierTier.ROGUE, 3, true],
    ["BOOSTER_ENERGY", BoosterEnergyModifier, "booster_energy", "부스트에너지", ModifierTier.ROGUE, 4, false],
    ["THROAT_SPRAY", ThroatSprayModifier, "throat_spray", "목스프레이", ModifierTier.ULTRA, 6, true],
    ["MUSCLE_BAND", MuscleBandModifier, "muscle_band", "힘의머리띠", ModifierTier.ULTRA, 4, false],
    ["WISE_GLASSES", WiseGlassesModifier, "wise_glasses", "박식안경", ModifierTier.ULTRA, 4, false],
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
      .shiny(false)
      .moveset([MoveId.TACKLE, MoveId.CLOSE_COMBAT, MoveId.HYPER_VOICE, MoveId.SPLASH]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function poolEntry(tier: ModifierTier, id: string) {
    return getModifierPoolForType(ModifierPoolType.PLAYER)[tier].find(w => w.modifierType.id === id);
  }

  function weightOf(tier: ModifierTier, id: string, party: Pokemon[]): number {
    return (poolEntry(tier, id)!.weight as WeightedModifierTypeWeightFunc)(party, 0);
  }

  /** Gives the player's `pokemon` the item and returns it */
  function give(pokemon: Pokemon, id: BattleHeldItemId): PokemonHeldItemModifier {
    const type = modifierTypes[id]().withIdFromFunc(modifierTypes[id]) as PokemonHeldItemModifierType;
    game.scene.addModifier(type.newModifier(pokemon) as PokemonHeldItemModifier, true, false, false, true);
    return pokemon.getHeldItems().find(m => m.type.id === id)!;
  }

  it("have icons, Korean / English text, save classes, pool entries at their tiers and the full-item rule", () => {
    const atlas = JSON.parse(readFileSync("./assets/images/items.json", "utf8")).textures[0].frames as {
      filename: string;
      sourceSize: { w: number; h: number };
      trimmed: boolean;
    }[];
    const ko = JSON.parse(readFileSync("./locales/ko/modifier-type.json", "utf8")).ModifierType;
    const en = JSON.parse(readFileSync("./locales/en/modifier-type.json", "utf8")).ModifierType;
    for (const [id, cls, icon, koName, tier, weight, cobblemon] of ITEMS) {
      expect(modifierTypes[id]().iconImage).toBe(icon);
      const frame = atlas.find(f => f.filename === icon);
      expect(frame?.sourceSize, icon).toEqual({ w: 32, h: 32 });
      if (cobblemon) {
        expect(frame?.trimmed, icon).toBe(false);
      }
      expect(ko[id]?.name, id).toBe(koName);
      expect(ko[id]?.description, id).toBeTruthy();
      expect(en[id]?.name && en[id]?.description, id).toBeTruthy();
      expect(getCustomModifierClass(cls.name)).toBe(cls);
      expect(poolEntry(tier, id)?.maxWeight, id).toBe(weight);
      // Local fork (2026-11-11): Muscle Band / Wise Glasses up to 99 like the type boosters, the others one each
      expect(BATTLE_HELD_ITEMS[id].maxHeld, id).toBe(id === "MUSCLE_BAND" || id === "WISE_GLASSES" ? 99 : 1);
      expect(BATTLE_HELD_ITEMS[id].poolWeight, id).toBe(weight);
      expect(FULL_RULE_HELD_ITEM_IDS.has(id), id).toBe(true);
    }
    const koMessages = JSON.parse(readFileSync("./locales/ko/modifier.json", "utf8"));
    expect(koMessages.clearAmuletApply && koMessages.throatSprayApply).toBeTruthy();
  });

  it("survive the session save, one each", async () => {
    game.override.startingHeldItems(ITEMS.map(([id]) => ({ name: id })));
    await game.classicMode.startBattle(SpeciesId.EXPLOUD);
    const user = game.field.getPlayerPokemon();
    const { gameData } = game.scene;
    const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
    const session = gameData.parseSessionData(json);
    for (const [id, cls] of ITEMS) {
      const saved = session.modifiers.find(m => m.typeId === id)!;
      expect(saved.className, id).toBe(cls.name);
      // biome-ignore lint/performance/noDynamicNamespaceImportAccess: the session loader looks classes up by name here
      const restored = saved.toModifier(Modifier[saved.className]) as PokemonHeldItemModifier;
      expect(restored).toBeInstanceOf(cls);
      expect(restored.stackCount, id).toBe(1);
      expect(restored.getMaxHeldItemCount(user), id).toBe(BATTLE_HELD_ITEMS[id].maxHeld);
    }
  });

  describe("Clear Amulet", () => {
    it("blocks Intimidate and a foe's Growl with its message, but not its holder's own Close Combat", async () => {
      game.override
        .enemyAbility(AbilityId.INTIMIDATE)
        .enemyMoveset(MoveId.GROWL)
        .startingHeldItems([{ name: "CLEAR_AMULET" }]);
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      const user = game.field.getPlayerPokemon();
      expect(user).toHaveStatStage(Stat.ATK, 0); // Intimidate
      const amulet = user.getHeldItems().find(m => m instanceof ClearAmuletModifier)!;
      expect(game).toHaveShownMessage(
        i18next.t("modifier:clearAmuletApply", {
          pokemonNameWithAffix: getPokemonNameWithAffix(user),
          typeName: amulet.type.name,
        }),
      );

      game.move.select(MoveId.CLOSE_COMBAT);
      await game.toNextTurn();
      expect(user).toHaveStatStage(Stat.ATK, 0); // Growl
      expect(user).toHaveStatStage(Stat.DEF, -1); // its own Close Combat
      expect(user).toHaveStatStage(Stat.SPDEF, -1);
      expect(user.getHeldItems()).toContain(amulet); // not used up
    });

    it("lets Intimidate through without one", async () => {
      game.override.enemyAbility(AbilityId.INTIMIDATE);
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      expect(game.field.getPlayerPokemon()).toHaveStatStage(Stat.ATK, -1);
    });

    it.each([
      { name: "Defiant", ability: AbilityId.DEFIANT, stat: Stat.ATK as EffectiveStat },
      { name: "Competitive", ability: AbilityId.COMPETITIVE, stat: Stat.SPATK as EffectiveStat },
    ])("nothing falls, so $name does not trigger", async ({ ability, stat }) => {
      game.override
        .enemyAbility(AbilityId.INTIMIDATE)
        .ability(ability)
        .startingHeldItems([{ name: "CLEAR_AMULET" }]);
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      const user = game.field.getPlayerPokemon();
      expect(user).toHaveStatStage(Stat.ATK, 0);
      expect(user).toHaveStatStage(stat, 0);
    });

    it("comes before Mirror Armor: nothing is reflected", async () => {
      game.override
        .enemyAbility(AbilityId.INTIMIDATE)
        .ability(AbilityId.MIRROR_ARMOR)
        .startingHeldItems([{ name: "CLEAR_AMULET" }]);
      await game.classicMode.startBattle(SpeciesId.CORVIKNIGHT);
      expect(game.field.getPlayerPokemon()).toHaveStatStage(Stat.ATK, 0);
      expect(game.field.getEnemyPokemon()).toHaveStatStage(Stat.ATK, 0);
    });

    // Local fork (2026-11-11), after review
    it.each<{ name: string; items: ModifierOverride[]; atk: StatStage; spd: StatStage }>([
      { name: "with", items: [{ name: "CLEAR_AMULET" }], atk: 0, spd: 0 },
      { name: "without", items: [], atk: -1, spd: 1 },
    ])("Rattled answers Intimidate only $name nothing to stop the drop", async ({ items, atk, spd }) => {
      game.override.enemyAbility(AbilityId.INTIMIDATE).ability(AbilityId.RATTLED).startingHeldItems(items);
      await game.classicMode.startBattle(SpeciesId.DUNSPARCE);
      const user = game.field.getPlayerPokemon();
      expect(user).toHaveStatStage(Stat.ATK, atk);
      expect(user).toHaveStatStage(Stat.SPD, spd);
    });

    it("blocks the Speed drops of a foe's Syrup Bomb", async () => {
      game.override.enemyHeldItems([{ name: "CLEAR_AMULET" }]).moveset([MoveId.SYRUP_BOMB, MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.MAGIKARP);
      const enemy = game.field.getEnemyPokemon();

      game.move.select(MoveId.SYRUP_BOMB);
      await game.move.forceHit();
      await game.toNextTurn();
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(enemy).toHaveBattlerTag(BattlerTagType.SYRUP_BOMB);
      expect(enemy).toHaveStatStage(Stat.SPD, 0);
    });

    it("blocks a foe's Octolock drops every turn without its message", async () => {
      game.override.enemyMoveset(MoveId.OCTOLOCK).startingHeldItems([{ name: "CLEAR_AMULET" }]);
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      const user = game.field.getPlayerPokemon();

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(user).toHaveBattlerTag(BattlerTagType.OCTOLOCK);
      expect(user).toHaveStatStage(Stat.DEF, 0);
      expect(user).toHaveStatStage(Stat.SPDEF, 0);
      const amulet = user.getHeldItems().find(m => m instanceof ClearAmuletModifier)!;
      expect(game).not.toHaveShownMessage(
        i18next.t("modifier:clearAmuletApply", {
          pokemonNameWithAffix: getPokemonNameWithAffix(user),
          typeName: amulet.type.name,
        }),
      );
    });

    it("keeps a foe's Parting Shot user in, as nothing falls", async () => {
      game.override.enemyHeldItems([{ name: "CLEAR_AMULET" }]).moveset([MoveId.PARTING_SHOT, MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.FEEBAS);
      const enemy = game.field.getEnemyPokemon();

      game.move.select(MoveId.PARTING_SHOT);
      await game.toNextTurn();
      expect(enemy).toHaveStatStage(Stat.ATK, 0);
      expect(enemy).toHaveStatStage(Stat.SPATK, 0);
      expect(game.field.getPlayerPokemon().species.speciesId).toBe(SpeciesId.MAGIKARP);
    });

    it.each<{ name: string; ability: AbilityId; stages: StatStage }>([
      { name: "Contrary turns the drops into raises", ability: AbilityId.CONTRARY, stages: 1 },
      { name: "the target has Mirror Armor (as in Showdown)", ability: AbilityId.MIRROR_ARMOR, stages: 0 },
    ])("lets Parting Shot switch its user out when $name", async ({ ability, stages }) => {
      game.override
        .enemyAbility(ability)
        .enemyHeldItems([{ name: "CLEAR_AMULET" }])
        .moveset([MoveId.PARTING_SHOT, MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.FEEBAS);
      const enemy = game.field.getEnemyPokemon();

      game.move.select(MoveId.PARTING_SHOT);
      game.doSelectPartyPokemon(1);
      await game.toNextTurn();
      expect(enemy).toHaveStatStage(Stat.ATK, stages);
      expect(enemy).toHaveStatStage(Stat.SPATK, stages);
      expect(game.field.getPlayerPokemon().species.speciesId).toBe(SpeciesId.FEEBAS);
    });
  });

  describe("Booster Energy", () => {
    /** The stat after the holder's held items, as `Pokemon.getEffectiveStat` and the summary apply them */
    function boosted(p: Pokemon, stat: Stat, base = 100): number {
      const value = new NumberHolder(base);
      game.scene.applyModifiers(Modifier.StatBoosterModifier, true, p, stat, value);
      return value.value;
    }

    function setStats(p: Pokemon, values: readonly number[]): void {
      EFFECTIVE_STATS.forEach((stat, i) => p.setStat(stat, values[i]));
    }

    function boostedStats(p: Pokemon): EffectiveStat[] {
      return EFFECTIVE_STATS.filter(stat => boosted(p, stat) !== 100);
    }

    it("x1.2 on the highest stat only; ties go Atk > Def > SpA > SpD > Spe; stat stages count", async () => {
      await game.classicMode.startBattle(SpeciesId.EXPLOUD);
      const user = game.field.getPlayerPokemon();
      give(user, "BOOSTER_ENERGY");

      setStats(user, [200, 150, 301, 120, 100]);
      expect(getHighestStat(user)).toBe(Stat.SPATK);
      expect(boostedStats(user)).toEqual([Stat.SPATK]);
      expect(boosted(user, Stat.SPATK)).toBe(120);
      expect(user.getEffectiveStat(Stat.SPATK)).toBe(361); // 301 * 12 / 10 = 361.2, floored
      expect(user.getEffectiveStat(Stat.ATK)).toBe(200);

      setStats(user, [250, 250, 250, 250, 250]);
      expect(boostedStats(user)).toEqual([Stat.ATK]);
      setStats(user, [100, 200, 120, 200, 200]);
      expect(boostedStats(user)).toEqual([Stat.DEF]);
      setStats(user, [100, 100, 100, 100, 101]);
      expect(boostedStats(user)).toEqual([Stat.SPD]);

      user.setStatStage(Stat.SPDEF, 1); // 100 x1.5 beats 101
      expect(boostedStats(user)).toEqual([Stat.SPDEF]);
      expect(user.getTag(BattlerTagType.QUARK_DRIVE)).toBeUndefined();
      expect(user.getTag(BattlerTagType.PROTOSYNTHESIS)).toBeUndefined();
    });

    it.each([
      { name: "a Paradox Pokémon", species: SpeciesId.IRON_VALIANT },
      { name: "Koraidon", species: SpeciesId.KORAIDON },
      { name: "Miraidon", species: SpeciesId.MIRAIDON },
    ])("x1.5 for $name", async ({ species }) => {
      await game.classicMode.startBattle(species);
      const user = game.field.getPlayerPokemon();
      give(user, "BOOSTER_ENERGY");
      setStats(user, [100, 100, 301, 100, 100]);
      expect(boostedStats(user)).toEqual([Stat.SPATK]);
      expect(boosted(user, Stat.SPATK)).toBe(150);
      expect(user.getEffectiveStat(Stat.SPATK)).toBe(451); // 301 * 15 / 10 = 451.5, floored
    });
  });

  describe("Throat Spray", () => {
    it("Sp. Atk +1 after a sound move, once per battle; a move without sound does nothing", async () => {
      game.override.startingHeldItems([{ name: "THROAT_SPRAY" }]);
      await game.classicMode.startBattle(SpeciesId.MAGIKARP); // weak, so the foe stays in
      const user = game.field.getPlayerPokemon();

      game.move.select(MoveId.TACKLE);
      await game.toNextTurn();
      expect(user).toHaveStatStage(Stat.SPATK, 0);
      expect(user.waveData.throatSprayUsed).toBe(false);

      game.move.select(MoveId.HYPER_VOICE);
      await game.toNextTurn();
      expect(user).toHaveStatStage(Stat.SPATK, 1);
      const spray = user.getHeldItems().find(m => m instanceof ThroatSprayModifier)!;
      expect(game).toHaveShownMessage(
        i18next.t("modifier:throatSprayApply", {
          pokemonNameWithAffix: getPokemonNameWithAffix(user),
          typeName: spray.type.name,
          statName: i18next.t(getStatKey(Stat.SPATK)),
        }),
      );

      game.move.select(MoveId.HYPER_VOICE);
      await game.toNextTurn();
      expect(user).toHaveStatStage(Stat.SPATK, 1); // once per battle
      expect(user.getHeldItems()).toContain(spray); // not used up
    });

    // Local fork (2026-11-11), after review: stat stages carry over into the next wild wave, so a holder that stays in
    // must not add another +1 every wave
    it("does not stack across wild waves while its +1 is still there; works again after a switch, the next wave", async () => {
      game.override.startingHeldItems([{ name: "THROAT_SPRAY" }]);
      await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.FEEBAS);
      const user = game.field.getPlayerPokemon();

      game.move.select(MoveId.HYPER_VOICE);
      await game.toNextTurn();
      expect(user).toHaveStatStage(Stat.SPATK, 1);
      // saved and loaded with the stat stages
      const saved = JSON.parse(JSON.stringify(user.summonData));
      expect(saved.throatSprayUsed).toBe(true);
      expect(new PokemonSummonData(saved).throatSprayUsed).toBe(true);

      user.resetWaveData(); // what every new wave does (EncounterPhase / NextEncounterPhase); the stat stages stay
      game.move.select(MoveId.HYPER_VOICE);
      await game.toNextTurn();
      expect(user).toHaveStatStage(Stat.SPATK, 1);

      /** Out and back in: switching out clears the stat stages and the summon-long use */
      const switchOutAndBack = async () => {
        game.doSwitchPokemon(1);
        await game.toNextTurn();
        game.doSwitchPokemon(1);
        await game.toNextTurn();
        expect(game.field.getPlayerPokemon()).toBe(user);
        expect(user).toHaveStatStage(Stat.SPATK, 0);
        expect(user.summonData.throatSprayUsed).toBe(false);
      };

      await switchOutAndBack();
      game.move.select(MoveId.HYPER_VOICE); // its first use this wave
      await game.toNextTurn();
      expect(user).toHaveStatStage(Stat.SPATK, 1);

      await switchOutAndBack();
      game.move.select(MoveId.HYPER_VOICE);
      await game.toNextTurn();
      expect(user).toHaveStatStage(Stat.SPATK, 0); // still once per battle (wave), even after a switch

      user.resetWaveData();
      game.move.select(MoveId.HYPER_VOICE);
      await game.toNextTurn();
      expect(user).toHaveStatStage(Stat.SPATK, 1);
    });

    it("does not work with Sheer Force on a sound move it boosts, as in Showdown", async () => {
      game.override
        .ability(AbilityId.SHEER_FORCE)
        .moveset([MoveId.SNARL, MoveId.HYPER_VOICE])
        .startingHeldItems([{ name: "THROAT_SPRAY" }]);
      await game.classicMode.startBattle(SpeciesId.MAGIKARP);
      const user = game.field.getPlayerPokemon();

      game.move.select(MoveId.SNARL); // a secondary effect: Sheer Force boosts it
      await game.toNextTurn();
      expect(user).toHaveStatStage(Stat.SPATK, 0);
      expect(user.waveData.throatSprayUsed).toBe(false);

      game.move.select(MoveId.HYPER_VOICE); // none: the spray works
      await game.toNextTurn();
      expect(user).toHaveStatStage(Stat.SPATK, 1);
    });

    it("is offered while a party member knows a sound move and holds none", async () => {
      await game.classicMode.startBattle(SpeciesId.EXPLOUD, SpeciesId.MAGIKARP);
      const [exploud, magikarp] = game.scene.getPlayerParty();
      game.move.changeMoveset(exploud, [MoveId.HYPER_VOICE, MoveId.TACKLE]);
      game.move.changeMoveset(magikarp, [MoveId.TACKLE, MoveId.SPLASH]);
      expect(weightOf(ModifierTier.ULTRA, "THROAT_SPRAY", [magikarp])).toBe(0);
      expect(weightOf(ModifierTier.ULTRA, "THROAT_SPRAY", [exploud, magikarp])).toBe(6);
      give(exploud, "THROAT_SPRAY");
      expect(weightOf(ModifierTier.ULTRA, "THROAT_SPRAY", [exploud, magikarp])).toBe(0);
    });
  });

  describe("Muscle Band and Wise Glasses", () => {
    it("x1.1 power on physical / special moves only", async () => {
      await game.classicMode.startBattle(SpeciesId.EXPLOUD);
      const user = game.field.getPlayerPokemon();
      const target = game.field.getEnemyPokemon();
      // the category as used goes along, as `Pokemon.getBaseDamage` passes it (after review)
      const power = (move: MoveId) =>
        allMoves[move].calculateBattlePower(user, target, true, user.getMoveCategory(target, allMoves[move]));
      expect([power(MoveId.TACKLE), power(MoveId.WATER_GUN), power(MoveId.HYPER_VOICE)]).toEqual([40, 40, 90]);

      const band = give(user, "MUSCLE_BAND");
      expect([power(MoveId.TACKLE), power(MoveId.WATER_GUN), power(MoveId.HYPER_VOICE)]).toEqual([44, 40, 90]);
      expect(power(MoveId.GROWL)).toBe(-1); // status moves have no power
      game.scene.removeModifier(band);

      give(user, "WISE_GLASSES");
      expect([power(MoveId.TACKLE), power(MoveId.WATER_GUN), power(MoveId.HYPER_VOICE)]).toEqual([40, 44, 99]);
    });

    // Local fork (2026-11-11), the user: "힘의머리띠 / 박식안경 의 최대 개수는 타입 강화 아이템들처럼 99로 둡시다, 힘의머리띠 / 박식안경 끼리는 합연산으로 계산하게 하고"
    it("stack up to 99 like the type boosters, added up: x1.1, x1.2, x1.3", async () => {
      await game.classicMode.startBattle(SpeciesId.EXPLOUD);
      const user = game.field.getPlayerPokemon();
      const target = game.field.getEnemyPokemon();
      const power = (move: MoveId) =>
        allMoves[move].calculateBattlePower(user, target, true, user.getMoveCategory(target, allMoves[move]));
      const band = give(user, "MUSCLE_BAND");
      expect(band.getMaxHeldItemCount(user)).toBe(99);
      give(user, "MUSCLE_BAND");
      expect(band.stackCount).toBe(2);
      expect(power(MoveId.TACKLE)).toBe(48); // 40 x 12/10, not 40 x 1.1 x 1.1
      give(user, "MUSCLE_BAND");
      expect(power(MoveId.TACKLE)).toBe(52); // 40 x 13/10
      expect(power(MoveId.HYPER_VOICE)).toBe(90); // the bands leave special moves alone
      give(user, "WISE_GLASSES");
      give(user, "WISE_GLASSES");
      expect([power(MoveId.TACKLE), power(MoveId.HYPER_VOICE)]).toEqual([52, 108]); // 90 x 12/10
    });

    // Local fork (2026-11-11), after review: working the category out inside `calculateBattlePower` sent Shell Side Arm
    // into endless recursion (its forecast runs `getBaseDamage`), held item or not
    it("work with Shell Side Arm: by the category it turns out, and left out of its forecast", async () => {
      game.override.moveset([MoveId.SHELL_SIDE_ARM, MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.SLOWBRO);
      const user = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const powerSpy = vi.spyOn(allMoves[MoveId.SHELL_SIDE_ARM], "calculateBattlePower");
      /** Sp. Atk a little above Attack against even defences: special, though a band counted in would turn it */
      const useShellSideArm = async () => {
        user.setStat(Stat.ATK, 200);
        user.setStat(Stat.SPATK, 210);
        enemy.setStat(Stat.DEF, 200);
        enemy.setStat(Stat.SPDEF, 200);
        const hpBefore = enemy.hp;
        game.move.select(MoveId.SHELL_SIDE_ARM);
        await game.toNextTurn();
        expect(enemy.hp).toBeLessThan(hpBefore);
      };

      await useShellSideArm(); // no item
      expect(powerSpy).toHaveLastReturnedWith(90);

      const band = give(user, "MUSCLE_BAND");
      await useShellSideArm(); // still special: the band stays out of the forecast and does not boost it
      expect(powerSpy).toHaveLastReturnedWith(90);
      game.scene.removeModifier(band);

      give(user, "WISE_GLASSES");
      await useShellSideArm();
      expect(powerSpy).toHaveLastReturnedWith(99);
    });

    it("are offered while a party member with a move of their category holds none", async () => {
      await game.classicMode.startBattle(SpeciesId.EXPLOUD, SpeciesId.MAGIKARP);
      const [exploud, magikarp] = game.scene.getPlayerParty();
      game.move.changeMoveset(exploud, [MoveId.HYPER_VOICE, MoveId.GROWL]);
      game.move.changeMoveset(magikarp, [MoveId.TACKLE, MoveId.SPLASH]);
      expect(weightOf(ModifierTier.ULTRA, "MUSCLE_BAND", [exploud])).toBe(0);
      expect(weightOf(ModifierTier.ULTRA, "MUSCLE_BAND", [exploud, magikarp])).toBe(4);
      expect(weightOf(ModifierTier.ULTRA, "WISE_GLASSES", [magikarp])).toBe(0);
      expect(weightOf(ModifierTier.ULTRA, "WISE_GLASSES", [exploud, magikarp])).toBe(4);
      // Local fork (2026-11-11): still offered while they hold fewer than 99
      give(magikarp, "MUSCLE_BAND");
      give(exploud, "WISE_GLASSES");
      expect(weightOf(ModifierTier.ULTRA, "MUSCLE_BAND", [exploud, magikarp])).toBe(4);
      expect(weightOf(ModifierTier.ULTRA, "WISE_GLASSES", [exploud, magikarp])).toBe(4);
    });
  });
});
