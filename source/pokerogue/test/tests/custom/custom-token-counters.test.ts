import { FORK_UNLOCK, isForkItemLocked } from "#balance/fork-unlock";
import { allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import {
  applyEnemyDamageTokens,
  ENEMY_DAMAGE_TOKEN_RULES,
  getEnemyDamageBoostedValue,
  getEnemyDamageBoosterMultiplier,
  getPiercedReductionMultiplier,
  getPiercingTokenWeight,
  getPlayerPiercingTokenStacks,
} from "#modifiers/enemy-damage-tokens";
import type { EnemyPersistentModifier } from "#modifiers/modifier";
import * as Modifier from "#modifiers/modifier";
import { itemPoolChecks, type ModifierTypeKeys, regenerateModifierPoolThresholds } from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import { NumberHolder, toDmgValue } from "#utils/common";
import { getModifierPoolForType } from "#utils/modifier-utils";
import { readFileSync } from "node:fs";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local fork (2026-11-12): the enemy's 대미지 토큰 made additive, and 관통 토큰 (Piercing Token), the party item against
 * the enemy's 보호 토큰 (enemy-damage-tokens.ts). The user: "적의 데미지 증가 / 데미지 감소 / 토큰에 저항할만한 파티
 * 아이템의 구현이네요. 개인적으로 생각해둔건 토큰이 곱연산으로 데미지 감소량 계산 -> 곱연산으로 계산된 수치에 합연산으로
 * 빼는(즉 토큰이 999개여서 받는 데미지 감소가 99.92%정도 되는 경우, 이 아이템이 3개 있어서 3%데미지는 보장된다던가) 파티
 * 아이템인데요" and "데미지 토큰은 그냥 저런거 없이 합연산시키면 편합니다". Later the same day both were cut: "일격 토큰의
 * 데미지 증가량을 3.5%정도까지만 너프해둡시다" (Damage Token 5% -> 3.5% per token) and "관통 토큰도 조금 너프해보죠, 개당
 * 0.25%에 최대 10개정도로" (Piercing Token 1 -> 0.25 percentage point per token, still up to 10).
 *
 * The tests under "in a real battle" go through `Pokemon.getAttackDamage`, which calls `applyEnemyDamageTokens`.
 */
describe("Custom - enemy damage tokens and the Piercing Token", () => {
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
      .battleType(BattleType.WILD)
      .startingWave(75)
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyHasPassiveAbility(false)
      .ability(AbilityId.BALL_FETCH)
      .hasPassiveAbility(false)
      .moveset([MoveId.EARTHQUAKE, MoveId.TACKLE, MoveId.SPLASH])
      .mysteryEncounterChance(0);
  });

  afterEach(() => {
    itemPoolChecks.clear();
  });

  /** Gives the enemy side `count` Damage Tokens (stack set directly, past the 99 cap of waves below 2000 too) */
  async function addEnemyBoosters(count: number): Promise<Modifier.EnemyDamageBoosterModifier> {
    const token = modifierTypes.ENEMY_DAMAGE_BOOSTER().newModifier() as Modifier.EnemyDamageBoosterModifier;
    await game.scene.addEnemyModifier(token as EnemyPersistentModifier, true);
    token.stackCount = count;
    return token;
  }

  /** Gives the enemy side `count` Protection Tokens (stack set directly, so 999 works below wave 2000) */
  async function addEnemyReducers(count: number): Promise<Modifier.EnemyDamageReducerModifier> {
    const token = modifierTypes.ENEMY_DAMAGE_REDUCTION().newModifier() as Modifier.EnemyDamageReducerModifier;
    await game.scene.addEnemyModifier(token as EnemyPersistentModifier, true);
    token.stackCount = count;
    return token;
  }

  /** Gives the player `count` Piercing Tokens (one stack, through the usual add) */
  function addPiercing(count: number): void {
    const token = modifierTypes
      .PIERCING_TOKEN()
      .withIdFromFunc(modifierTypes.PIERCING_TOKEN)
      .newModifier() as Modifier.PiercingTokenModifier;
    token.stackCount = count;
    game.scene.addModifier(token, true);
  }

  function setPiercing(count: number): void {
    const held = game.scene.findModifier(m => m instanceof Modifier.PiercingTokenModifier, true);
    if (held) {
      game.scene.removeModifier(held);
    }
    if (count > 0) {
      addPiercing(count);
    }
  }

  /** What the two calls `getAttackDamage` made before 2026-11-12 do to `value` */
  function oldTokenCalls(source: Pokemon, target: Pokemon, value: number): number {
    const damage = new NumberHolder(value);
    if (!source.isPlayer()) {
      game.scene.applyModifiers(Modifier.EnemyDamageBoosterModifier, false, damage);
    }
    if (!target.isPlayer()) {
      game.scene.applyModifiers(Modifier.EnemyDamageReducerModifier, false, damage);
    }
    return damage.value;
  }

  function helper(source: Pokemon, target: Pokemon, value: number): number {
    const damage = new NumberHolder(value);
    applyEnemyDamageTokens(source, target, damage);
    return damage.value;
  }

  function poolEntry(tier: ModifierTier, id: string) {
    return getModifierPoolForType(ModifierPoolType.PLAYER)[tier].find(w => w.modifierType.id === id);
  }

  it("keeps its numbers in one frozen table; the item has its icon, Korean / English text and save class", () => {
    expect(Object.isFrozen(ENEMY_DAMAGE_TOKEN_RULES)).toBe(true);
    expect(ENEMY_DAMAGE_TOKEN_RULES).toEqual({
      boosterPerStack: 0.035,
      piercingPerStack: 0.0025,
      piercingMaxStack: 10,
      piercingWeight: 3,
    });
    expect(modifierTypes.PIERCING_TOKEN().iconImage).toBe("piercing_token");
    const atlas = JSON.parse(readFileSync("./assets/images/items.json", "utf8")).textures[0].frames as {
      filename: string;
      sourceSize: { w: number; h: number };
      trimmed: boolean;
    }[];
    const frame = atlas.find(f => f.filename === "piercing_token");
    expect(frame?.sourceSize).toEqual({ w: 32, h: 32 });
    expect(frame?.trimmed).toBe(false);
    const ko = JSON.parse(readFileSync("./locales/ko/modifier-type.json", "utf8")).ModifierType;
    const en = JSON.parse(readFileSync("./locales/en/modifier-type.json", "utf8")).ModifierType;
    expect(ko.PIERCING_TOKEN.name).toBe("관통 토큰");
    expect(ko.PIERCING_TOKEN.description).toContain("1개당 0.25%p");
    expect(en.PIERCING_TOKEN.name).toBe("Piercing Token");
    expect(en.PIERCING_TOKEN.description).toContain("0.25 percentage points");
    // The token names the item counters, as the game shows them
    expect(ko.ENEMY_DAMAGE_BOOSTER.name).toBe("대미지 토큰");
    // The Damage Token's text says the new 3.5%
    expect(ko.ENEMY_DAMAGE_BOOSTER.description).toBe("주는 대미지를 3.5% 증가시킨다.");
    expect(en.ENEMY_DAMAGE_BOOSTER.description).toBe("Increases damage by 3.5%.");
    expect(ko.ENEMY_DAMAGE_REDUCTION.name).toBe("보호 토큰");
    // The session loader finds the class in the modifier.ts namespace
    expect(Modifier.PiercingTokenModifier.name).toBe("PiercingTokenModifier");
    expect(modifierTypes.PIERCING_TOKEN().newModifier()).toBeInstanceOf(Modifier.PiercingTokenModifier);
  });

  describe("대미지 토큰 (Damage Token): additive", () => {
    it("multiplies by 1 + 0.035 x stacks instead of 1.05^stacks", () => {
      expect([0, 1, 20, 99, 999].map(getEnemyDamageBoosterMultiplier)).toEqual([
        1,
        1.035,
        expect.closeTo(1.7, 10),
        expect.closeTo(4.465, 10),
        expect.closeTo(35.965, 10),
      ]);
      const token = modifierTypes.ENEMY_DAMAGE_BOOSTER().newModifier() as Modifier.EnemyDamageBoosterModifier;
      expect(token.getMaxStackCount()).toBe(999);
      const applied = (stacks: number, value: number) => {
        token.stackCount = stacks;
        const damage = new NumberHolder(value);
        token.apply(damage);
        return damage.value;
      };
      // 103.5, 107, 446.5, 3596.5, floored
      expect([applied(1, 100), applied(2, 100), applied(99, 100), applied(999, 100)]).toEqual([103, 107, 446, 3596]);
      // toDmgValue's rounding is kept: floor (10.35 -> 10, 7.735 -> 7, 8.47 -> 8), at least 1
      expect([applied(1, 10), applied(3, 7), applied(6, 7), applied(1, 0)]).toEqual([10, 7, 8, 1]);
      // Exact results are not floored 1 short (review, 2026-11-12): as floats, 200 x 1.035 is 206.99999999999997 and
      // 100 x (1 + 0.035 x 30) is 204.99999999999997
      expect(toDmgValue(200 * getEnemyDamageBoosterMultiplier(1))).toBe(206);
      expect(toDmgValue(100 * getEnemyDamageBoosterMultiplier(30))).toBe(204);
      expect([applied(1, 200), applied(1, 400), applied(30, 100), applied(30, 60), applied(98, 900)]).toEqual([
        207, 414, 205, 123, 3987,
      ]);
      expect(getEnemyDamageBoostedValue(200, 1)).toBe(207);
      // Save data: the same args as before (the boost percent, which the constructor does not read back)
      expect(token.getArgs()).toEqual([expect.closeTo(3.5, 10)]);
      token.stackCount = 999;
      const restored = token.clone();
      expect(restored.stackCount).toBe(999);
      expect(restored.getDamageMultiplier()).toBeCloseTo(35.965, 10);
    });

    it("matches whole-number math, floor(damage x (1000 + 35 x stacks) / 1000), for every stack and damage 1-600", () => {
      const token = modifierTypes.ENEMY_DAMAGE_BOOSTER().newModifier() as Modifier.EnemyDamageBoosterModifier;
      const damage = new NumberHolder(0);
      let mismatches = 0;
      for (let stacks = 0; stacks <= 999; stacks++) {
        token.stackCount = stacks;
        for (let value = 1; value <= 600; value++) {
          const scaled = value * (1000 + 35 * stacks);
          damage.value = value;
          token.apply(damage);
          if (damage.value !== (scaled - (scaled % 1000)) / 1000) {
            mismatches++;
          }
        }
      }
      expect(mismatches).toBe(0);
    });

    it("leaves the Protection Token compounding as before: 0.975^n", () => {
      const token = modifierTypes.ENEMY_DAMAGE_REDUCTION().newModifier() as Modifier.EnemyDamageReducerModifier;
      for (const n of [1, 3, 99]) {
        token.stackCount = n;
        expect(token.getDamageMultiplier()).toBe(Math.pow(0.975, n));
        const damage = new NumberHolder(1000);
        token.apply(damage);
        expect(damage.value).toBe(toDmgValue(1000 * Math.pow(0.975, n)));
      }
    });

    it("in a real battle, an enemy's 99 tokens hit for x4.465 (x125 compounding, x5.95 at 5% per token)", async () => {
      await game.classicMode.startBattle(SpeciesId.GARCHOMP);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const tackle = allMoves[MoveId.TACKLE];
      const before = player.getAttackDamage({ source: enemy, move: tackle }).damage;
      await addEnemyBoosters(99);
      expect(getEnemyDamageBoosterMultiplier(99)).toBeCloseTo(4.465, 12);
      // x4.465 in whole numbers: floor(before x 4465 / 1000)
      expect(player.getAttackDamage({ source: enemy, move: tackle }).damage).toBe(Math.floor((before * 4465) / 1000));
      // The player's hits on the enemy are untouched by them
      const earthquake = allMoves[MoveId.EARTHQUAKE];
      const playerHit = enemy.getAttackDamage({ source: player, move: earthquake }).damage;
      game.scene.removeModifier(game.scene.findModifier(m => m.is("EnemyDamageBoosterModifier"), false)!, true);
      expect(enemy.getAttackDamage({ source: player, move: earthquake }).damage).toBe(playerHit);
    });
  });

  describe("관통 토큰 (Piercing Token): the rule", () => {
    it("raises 0.975^n by 0.0025 per token, never above 1, nothing without tokens", () => {
      const pierced = (n: number, m: number) => getPiercedReductionMultiplier(Math.pow(0.975, n), m);
      expect(pierced(0, 3)).toBe(1);
      expect(pierced(99, 0)).toBe(Math.pow(0.975, 99));
      expect(pierced(99, 3)).toBeCloseTo(Math.pow(0.975, 99) + 0.0075, 12);
      expect(pierced(99, 10)).toBeCloseTo(Math.pow(0.975, 99) + 0.025, 12);
      // 999 tokens: 99.99999999% taken away; 3 / 10 Piercing Tokens: at least 0.75% / 2.5% gets through
      expect(pierced(999, 0)).toBeLessThan(1e-10);
      expect(pierced(999, 3)).toBeCloseTo(0.0075, 9);
      expect(pierced(999, 10)).toBeCloseTo(0.025, 9);
      // Capped at the token-free damage: at 0.25%p per token only 1 Protection Token (x0.975) with all 10 reaches it
      expect([pierced(1, 10), pierced(0, 10)]).toEqual([1, 1]);
      expect(getPiercedReductionMultiplier(0.999, 10)).toBe(1);
      expect(getPiercedReductionMultiplier(0.98, 10)).toBe(1);
      expect(getPiercedReductionMultiplier(0.999, 1)).toBe(1);
      // ... and stays below it otherwise
      expect([pierced(1, 9), pierced(1, 3), pierced(2, 10), pierced(5, 10)]).toEqual([
        expect.closeTo(0.9975, 12),
        expect.closeTo(0.9825, 12),
        expect.closeTo(Math.pow(0.975, 2) + 0.025, 12),
        expect.closeTo(Math.pow(0.975, 5) + 0.025, 12),
      ]);
      // More than the max counts as the max
      expect(getPiercedReductionMultiplier(0.5, 15)).toBeCloseTo(0.5 + 0.025, 12);
      expect(getPiercedReductionMultiplier(0.5, -1)).toBe(0.5);
    });

    it("applyEnemyDamageTokens: n = 0 / 99 / 999 with m = 0 / 3 / 10", async () => {
      await game.classicMode.startBattle(SpeciesId.GARCHOMP);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();

      // n = 0: nothing to pierce
      for (const m of [0, 3, 10]) {
        setPiercing(m);
        expect(getPlayerPiercingTokenStacks()).toBe(m);
        expect(helper(player, enemy, 1000), `n=0 m=${m}`).toBe(1000);
      }

      const reducer = await addEnemyReducers(99);
      const expected99 = { 0: 81, 3: 89, 10: 106 } as const;
      for (const m of [0, 3, 10] as const) {
        setPiercing(m);
        expect(helper(player, enemy, 1000), `n=99 m=${m}`).toBe(expected99[m]);
      }

      reducer.stackCount = 999;
      const expected999 = { 0: 1, 3: 7, 10: 25 } as const;
      for (const m of [0, 3, 10] as const) {
        setPiercing(m);
        expect(helper(player, enemy, 1000), `n=999 m=${m}`).toBe(expected999[m]);
      }

      // Capped at the token-free damage: 1 token (x0.975) with 10 Piercing Tokens is exactly the damage without tokens
      reducer.stackCount = 1;
      setPiercing(10);
      expect(helper(player, enemy, 1000)).toBe(1000);
      expect(helper(player, enemy, 997)).toBe(997);
      expect(helper(player, enemy, 1)).toBe(1);
      // 9 of them stop short: x0.9975
      setPiercing(9);
      expect(helper(player, enemy, 1000)).toBe(997);
      reducer.stackCount = 5;
      setPiercing(10);
      expect(helper(player, enemy, 1000)).toBe(906);
    });

    it("applyEnemyDamageTokens does what the two old calls did whenever the player has no Piercing Token", async () => {
      game.override.battleStyle("double");
      await game.classicMode.startBattle(SpeciesId.GARCHOMP, SpeciesId.MACHAMP);
      const [p1, p2] = game.scene.getPlayerField();
      const [e1, e2] = game.scene.getEnemyField();
      await addEnemyBoosters(10);
      await addEnemyReducers(40);
      for (const [source, target] of [
        [p1, e1],
        [e1, p1],
        [e1, e2],
        [e2, e2],
        [p1, p2],
        [p1, p1],
      ] as const) {
        for (const value of [1, 37, 1000]) {
          expect(helper(source, target, value)).toBe(oldTokenCalls(source, target, value));
        }
      }
    });

    it("does nothing for an enemy hitting an enemy, or for anything that hits the player", async () => {
      game.override.battleStyle("double");
      await game.classicMode.startBattle(SpeciesId.GARCHOMP, SpeciesId.MACHAMP);
      const [p1, p2] = game.scene.getPlayerField();
      const [e1, e2] = game.scene.getEnemyField();
      await addEnemyBoosters(10);
      await addEnemyReducers(99);
      setPiercing(10);
      // Enemy on its ally, and on itself (confusion): Damage Tokens x1.35, then the full Protection Tokens, as before
      expect(helper(e1, e2, 1000)).toBe(toDmgValue(1350 * Math.pow(0.975, 99)));
      expect(helper(e2, e2, 1000)).toBe(oldTokenCalls(e2, e2, 1000));
      // Enemy on the player: Damage Tokens only
      expect(helper(e1, p1, 1000)).toBe(1350);
      // The player on itself or its ally (confusion, Earthquake): no token at all
      expect(helper(p1, p1, 1000)).toBe(1000);
      expect(helper(p1, p2, 1000)).toBe(1000);
      // The player on an enemy: pierced (0.975^99 + 0.025)
      expect(helper(p2, e1, 1000)).toBe(106);
    });
  });

  describe("관통 토큰 (Piercing Token): the item", () => {
    it("is a ROGUE reward of weight 3 only while the enemy holds a Protection Token and the party has fewer than 10", async () => {
      await game.classicMode.startBattle(SpeciesId.GARCHOMP);
      const party = game.scene.getPlayerParty();
      const entry = poolEntry(ModifierTier.ROGUE, "PIERCING_TOKEN")!;
      expect(entry).toBeDefined();
      expect(entry.maxWeight).toBe(3);
      const weight = entry.weight as WeightedModifierTypeWeightFunc;
      expect(weight(party, 0)).toBe(0);
      expect(getPiercingTokenWeight()).toBe(0);

      const reducer = await addEnemyReducers(1);
      expect(weight(party, 0)).toBe(3);
      addPiercing(9);
      expect(weight(party, 0)).toBe(3);
      addPiercing(1);
      expect(getPlayerPiercingTokenStacks()).toBe(10);
      expect(weight(party, 0)).toBe(0);

      setPiercing(0);
      game.scene.removeModifier(reducer, true);
      expect(weight(party, 0)).toBe(0);
      // A Damage Token alone does not count
      await addEnemyBoosters(5);
      expect(weight(party, 0)).toBe(0);
    });

    it("stacks to 10 at most, as a party item that nothing can steal; enemies never get it", async () => {
      await game.classicMode.startBattle(SpeciesId.GARCHOMP);
      addPiercing(4);
      addPiercing(6);
      const held = game.scene.findModifier(m => m instanceof Modifier.PiercingTokenModifier, true)!;
      expect(held.getStackCount()).toBe(10);
      expect(held.getMaxStackCount()).toBe(10);
      addPiercing(1);
      expect(held.getStackCount()).toBe(10);
      expect(game.scene.findModifiers(m => m instanceof Modifier.PiercingTokenModifier, true)).toHaveLength(1);
      // Not a held item: no holder, so no thief, Grip Claw or transfer can take it
      expect(held).not.toBeInstanceOf(Modifier.PokemonHeldItemModifier);
      // Only the player's pool has it
      for (const poolType of [
        ModifierPoolType.WILD,
        ModifierPoolType.TRAINER,
        ModifierPoolType.ENEMY_BUFF,
        ModifierPoolType.DAILY_STARTER,
      ]) {
        const pool = getModifierPoolForType(poolType);
        const ids = Object.values(pool).flatMap(tier => tier.map(w => w.modifierType.id));
        expect(ids, `pool ${poolType}`).not.toContain("PIERCING_TOKEN");
      }
      // The class's own apply raises a Protection multiplier the same way
      const multiplier = new NumberHolder(Math.pow(0.975, 99));
      (held as Modifier.PiercingTokenModifier).apply(multiplier);
      expect(multiplier.value).toBeCloseTo(Math.pow(0.975, 99) + 0.025, 12);
    });

    it("is gated by the first Classic clear", async () => {
      game.override.forkContentUnlocked(false);
      await game.classicMode.startBattle(SpeciesId.GARCHOMP);
      await addEnemyReducers(5);
      const party = game.scene.getPlayerParty();
      expect(FORK_UNLOCK.gatedItems.has("PIERCING_TOKEN")).toBe(true);
      expect(isForkItemLocked("PIERCING_TOKEN")).toBe(true);
      vi.spyOn(console, "log").mockImplementation(() => {});
      const offered = () => {
        itemPoolChecks.set("PIERCING_TOKEN" as ModifierTypeKeys, undefined);
        regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0);
        return itemPoolChecks.get("PIERCING_TOKEN" as ModifierTypeKeys);
      };
      expect(offered()).toBe(false);
      game.override.forkContentUnlocked(true);
      expect(isForkItemLocked("PIERCING_TOKEN")).toBe(false);
      expect(offered()).toBe(true);
    });

    it("survives the session save with its stack", async () => {
      game.override.startingModifier([{ name: "PIERCING_TOKEN", count: 3 }]);
      await game.classicMode.startBattle(SpeciesId.GARCHOMP);
      expect(getPlayerPiercingTokenStacks()).toBe(3);
      const { gameData } = game.scene;
      const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
      const session = gameData.parseSessionData(json);
      const saved = session.modifiers.find(m => m.typeId === "PIERCING_TOKEN")!;
      expect(saved).toBeDefined();
      expect(saved.className).toBe("PiercingTokenModifier");
      const restored = saved.toModifier(Modifier[saved.className as keyof typeof Modifier]);
      expect(restored).toBeInstanceOf(Modifier.PiercingTokenModifier);
      expect(restored!.stackCount).toBe(3);
      expect(restored!.type.id).toBe("PIERCING_TOKEN");
    });
  });

  // These go through Pokemon.getAttackDamage, which calls applyEnemyDamageTokens (pokemon.ts)
  describe("in a real battle", () => {
    async function setup(reducers: number) {
      await game.classicMode.startBattle(SpeciesId.GARCHOMP);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const earthquake = allMoves[MoveId.EARTHQUAKE];
      const hit = () => enemy.getAttackDamage({ source: player, move: earthquake }).damage;
      const tokenFree = hit();
      expect(tokenFree).toBeGreaterThan(100);
      await addEnemyReducers(reducers);
      return { player, enemy, hit, tokenFree };
    }

    it("without a Piercing Token, the Protection Tokens work as before", async () => {
      const { hit, tokenFree } = await setup(99);
      expect(hit()).toBe(toDmgValue(tokenFree * Math.pow(0.975, 99)));
    });

    it("99 Protection Tokens: 3 / 10 Piercing Tokens give back 0.75 / 2.5 percentage points", async () => {
      const { hit, tokenFree } = await setup(99);
      setPiercing(3);
      expect(hit()).toBe(toDmgValue(tokenFree * (Math.pow(0.975, 99) + 0.0025 * 3)));
      setPiercing(10);
      expect(hit()).toBe(toDmgValue(tokenFree * (Math.pow(0.975, 99) + 0.0025 * 10)));
    });

    it("999 Protection Tokens and 3 / 10 Piercing Tokens: at least 0.75% / 2.5% gets through", async () => {
      const { hit, tokenFree } = await setup(999);
      expect(hit()).toBe(1);
      setPiercing(3);
      expect(hit()).toBe(toDmgValue(tokenFree * (Math.pow(0.975, 999) + 0.0025 * 3)));
      expect(hit()).toBeGreaterThanOrEqual(Math.floor(tokenFree * 0.0075));
      setPiercing(10);
      expect(hit()).toBe(toDmgValue(tokenFree * (Math.pow(0.975, 999) + 0.0025 * 10)));
      expect(hit()).toBeGreaterThanOrEqual(Math.floor(tokenFree * 0.025));
      // More than the 1 that gets through without them (tokenFree > 100)
      expect(hit()).toBeGreaterThan(1);
    });

    it("never more than the token-free damage", async () => {
      const { hit, tokenFree } = await setup(1);
      setPiercing(10);
      expect(hit()).toBe(tokenFree);
      // 9 stop just short of it: x0.9975
      setPiercing(9);
      expect(hit()).toBe(toDmgValue(tokenFree * (0.975 + 0.0025 * 9)));
    });

    it("a real turn: Earthquake into 999 Protection Tokens with 10 Piercing Tokens takes the 2.5%", async () => {
      const { enemy, tokenFree } = await setup(999);
      setPiercing(10);
      vi.spyOn(enemy, "randBattleSeedIntRange").mockReturnValue(100); // the 85-100% damage roll at its top
      const hpBefore = enemy.hp;
      game.move.select(MoveId.EARTHQUAKE);
      await game.phaseInterceptor.to("BerryPhase", false);
      expect(hpBefore - enemy.hp).toBe(toDmgValue(tokenFree * (Math.pow(0.975, 999) + 0.0025 * 10)));
      expect(hpBefore - enemy.hp).toBeGreaterThan(1);
    });
  });
});
