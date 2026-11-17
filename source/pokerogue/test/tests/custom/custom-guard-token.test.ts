import { getGameMode } from "#app/game-mode";
import { FORK_UNLOCK, isForkItemLocked } from "#balance/fork-unlock";
import { allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { GameModes } from "#enums/game-modes";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import { ENEMY_CUSTOM_ITEMS } from "#modifiers/enemy-custom-items";
import {
  applyEnemyDamageTokens,
  enemyHoldsDamageToken,
  GUARD_TOKEN_RULES,
  getGuardedDamageValue,
  getGuardTokenMultiplier,
  getGuardTokenWeight,
  getPlayerGuardTokenStacks,
} from "#modifiers/enemy-damage-tokens";
import type { EnemyPersistentModifier } from "#modifiers/modifier";
import * as Modifier from "#modifiers/modifier";
import {
  FormChangeItemModifierType,
  itemPoolChecks,
  ModifierTypeGenerator,
  type ModifierTypeKeys,
  PokemonHeldItemModifierType,
  regenerateModifierPoolThresholds,
} from "#modifiers/modifier-type";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import { getItemIconScale } from "#ui/item-icon-scale";
import { NumberHolder, toDmgValue } from "#utils/common";
import { getModifierPoolForType } from "#utils/modifier-utils";
import { readFileSync } from "node:fs";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local fork (2026-11-13): 방호 토큰 (Guard Token, `GUARD_TOKEN`), the player's GREAT party item against the enemy's
 * 대미지 토큰, from the outside evaluator's round-3 spec (09 명세 4번): "1개당 아군이 받는 피해 0.5%씩 곱연산 감소
 * (× 0.995^n)", "최대 개수 도달 시: 최종 받는 피해가 원래의 70% ~ 75% 수준", "가중치 4, 조건: 적에게 대미지 토큰이 1개 이상
 * 있고 … 아군의 방호 토큰이 최대 개수 미만일 때 (클래식·챌린지·데일리에서는 가중치 0)". Its recommended cap, 65.
 *
 * The tests under "in a real battle" go through `Pokemon.getAttackDamage`, which calls `applyEnemyDamageTokens`.
 */
describe("Custom - 방호 토큰 (Guard Token)", () => {
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
      .enemyLevel(150)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyHasPassiveAbility(false)
      .ability(AbilityId.BALL_FETCH)
      .hasPassiveAbility(false)
      .moveset([MoveId.EARTHQUAKE, MoveId.SPLASH])
      .mysteryEncounterChance(0);
  });

  afterEach(() => {
    itemPoolChecks.clear();
    vi.restoreAllMocks();
  });

  /** Gives the enemy side `count` Damage Tokens (stack set directly) */
  async function addEnemyBoosters(count: number): Promise<Modifier.EnemyDamageBoosterModifier> {
    const token = modifierTypes.ENEMY_DAMAGE_BOOSTER().newModifier() as Modifier.EnemyDamageBoosterModifier;
    await game.scene.addEnemyModifier(token as EnemyPersistentModifier, true);
    token.stackCount = count;
    return token;
  }

  /** Gives the enemy side `count` Protection Tokens (stack set directly) */
  async function addEnemyReducers(count: number): Promise<Modifier.EnemyDamageReducerModifier> {
    const token = modifierTypes.ENEMY_DAMAGE_REDUCTION().newModifier() as Modifier.EnemyDamageReducerModifier;
    await game.scene.addEnemyModifier(token as EnemyPersistentModifier, true);
    token.stackCount = count;
    return token;
  }

  /** Gives the player `count` Guard Tokens (one stack, through the usual add, so the cap holds) */
  function addGuard(count: number): void {
    const token = modifierTypes
      .GUARD_TOKEN()
      .withIdFromFunc(modifierTypes.GUARD_TOKEN)
      .newModifier() as Modifier.GuardTokenModifier;
    token.stackCount = count;
    game.scene.addModifier(token, true);
  }

  /** Sets the player's Guard Tokens to exactly `count` (0 removes them) */
  function setGuard(count: number): void {
    const held = game.scene.findModifier(m => m instanceof Modifier.GuardTokenModifier, true);
    if (held) {
      game.scene.removeModifier(held);
    }
    if (count > 0) {
      addGuard(count);
    }
  }

  function setPiercing(count: number): void {
    const token = modifierTypes
      .PIERCING_TOKEN()
      .withIdFromFunc(modifierTypes.PIERCING_TOKEN)
      .newModifier() as Modifier.PiercingTokenModifier;
    token.stackCount = count;
    game.scene.addModifier(token, true);
  }

  function helper(source: Pokemon, target: Pokemon, value: number): number {
    const damage = new NumberHolder(value);
    applyEnemyDamageTokens(source, target, damage);
    return damage.value;
  }

  /** What `applyEnemyDamageTokens` did before the Guard Token (2026-11-12): the boosters, then the reducers */
  function beforeGuard(source: Pokemon, target: Pokemon, value: number): number {
    const damage = new NumberHolder(value);
    if (!source.isPlayer()) {
      game.scene.applyModifiers(Modifier.EnemyDamageBoosterModifier, false, damage);
    }
    if (!target.isPlayer()) {
      game.scene.applyModifiers(Modifier.EnemyDamageReducerModifier, false, damage);
    }
    return damage.value;
  }

  /** Exact floor(damage x (10000 + 350 s) / 10000 x 199^m / 200^m), at least 1, in whole numbers */
  function exactGuarded(damage: number, s: number, m: number): number {
    const num = BigInt(damage) * BigInt(10_000 + 350 * s) * 199n ** BigInt(m);
    const den = 10_000n * 200n ** BigInt(m);
    const q = Number(num / den);
    return Math.max(1, q);
  }

  function poolEntry(tier: ModifierTier, id: string) {
    return getModifierPoolForType(ModifierPoolType.PLAYER)[tier].find(w => w.modifierType.id === id);
  }

  /** The total weight of the player's GREAT tier, the way `regenerateModifierPoolThresholds` adds it up */
  function greatTotal(party: Pokemon[]): number {
    let total = 0;
    for (const entry of getModifierPoolForType(ModifierPoolType.PLAYER)[ModifierTier.GREAT]) {
      const existing = game.scene.findModifiers(m => m.type.id === entry.modifierType.id, true);
      const type =
        entry.modifierType instanceof ModifierTypeGenerator
          ? entry.modifierType.generateType(party)
          : entry.modifierType;
      const open =
        existing.length === 0
        || type instanceof PokemonHeldItemModifierType
        || type instanceof FormChangeItemModifierType
        || existing.some(m => m.stackCount < m.getMaxStackCount(true));
      if (!open) {
        continue;
      }
      total +=
        entry.weight instanceof Function ? (entry.weight as WeightedModifierTypeWeightFunc)(party, 0) : entry.weight;
    }
    return total;
  }

  it("keeps its numbers in one frozen table; the item has its icon, Korean / English text and save class", () => {
    expect(Object.isFrozen(GUARD_TOKEN_RULES)).toBe(true);
    expect(GUARD_TOKEN_RULES).toEqual({ perStackMultiplier: 0.995, maxStacks: 65, poolWeight: 4 });
    expect(modifierTypes.GUARD_TOKEN().iconImage).toBe("guard_token");
    const atlas = JSON.parse(readFileSync("./assets/images/items.json", "utf8")).textures[0].frames as {
      filename: string;
      sourceSize: { w: number; h: number };
      trimmed: boolean;
    }[];
    const frame = atlas.find(f => f.filename === "guard_token");
    expect(frame?.sourceSize).toEqual({ w: 32, h: 32 });
    expect(frame?.trimmed).toBe(false);
    // Same coin as the official tokens, so drawn at their scale
    expect(getItemIconScale("guard_token")).toBe(1);
    const ko = JSON.parse(readFileSync("./locales/ko/modifier-type.json", "utf8")).ModifierType;
    const en = JSON.parse(readFileSync("./locales/en/modifier-type.json", "utf8")).ModifierType;
    expect(ko.GUARD_TOKEN).toEqual({
      name: "방호 토큰",
      description: "아군이 적의 공격으로 받는 대미지를 1개당 0.5%씩 곱연산으로 줄여 준다.",
    });
    expect(en.GUARD_TOKEN).toEqual({
      name: "Guard Token",
      description: "Reduces damage taken by party Pokémon from foes' attacks by 0.5% per stack (multiplicative).",
    });
    // The session loader finds the class in the modifier.ts namespace
    expect(Modifier.GuardTokenModifier.name).toBe("GuardTokenModifier");
    expect(modifierTypes.GUARD_TOKEN().newModifier()).toBeInstanceOf(Modifier.GuardTokenModifier);
  });

  describe("the rule", () => {
    it("multiplies by 0.995^m: exactly at 1, 10 and 65; more than 65 counts as 65; 1 without one", () => {
      expect(getGuardTokenMultiplier(1)).toBe(0.995);
      expect(getGuardTokenMultiplier(10)).toBe(Math.pow(0.995, 10));
      expect(getGuardTokenMultiplier(10)).toBeCloseTo(0.951110130465771, 14);
      expect(getGuardTokenMultiplier(65)).toBe(Math.pow(0.995, 65));
      // 0.721939 (the spec writes 0.72196 and x0.7220; 72.19% to two places, still "70~75%")
      expect(getGuardTokenMultiplier(65)).toBeCloseTo(0.72194, 5);
      // The spec's table (09 명세 4-2): 30 x0.8604, 50 x0.7783, 60 x0.7403
      expect([30, 50, 60].map(getGuardTokenMultiplier)).toEqual([
        expect.closeTo(0.8604, 4),
        expect.closeTo(0.7783, 4),
        expect.closeTo(0.7403, 4),
      ]);
      // Capped at 65
      for (const m of [66, 70, 100, 999]) {
        expect(getGuardTokenMultiplier(m), `m=${m}`).toBe(Math.pow(0.995, 65));
      }
      expect([0, -1].map(getGuardTokenMultiplier)).toEqual([1, 1]);
      // The class's own apply lowers a multiplier the same way
      const token = modifierTypes.GUARD_TOKEN().newModifier() as Modifier.GuardTokenModifier;
      token.stackCount = 65;
      const multiplier = new NumberHolder(1);
      token.apply(multiplier);
      expect(multiplier.value).toBe(Math.pow(0.995, 65));
      expect(token.getMaxStackCount()).toBe(65);
      expect(token.clone().stackCount).toBe(65);
    });

    it("floors once over the Damage Tokens and the Guard Tokens, at least 1", () => {
      expect(getGuardedDamageValue(1000, [], 1)).toBe(995);
      expect(getGuardedDamageValue(1000, [], 10)).toBe(951);
      expect(getGuardedDamageValue(1000, [], 65)).toBe(721);
      expect(getGuardedDamageValue(1000, [], 70)).toBe(721);
      // 10 Damage Tokens (x1.35) and 65 Guard Tokens: 1350 x 0.72194 = 974.6
      expect(getGuardedDamageValue(1000, [10], 65)).toBe(974);
      // One floor: 3 x 1.035 x 0.995 = 3.089 -> 3, where flooring after each step gave floor(3.105) = 3 -> floor(2.985) = 2
      expect(getGuardedDamageValue(3, [1], 1)).toBe(3);
      // Never below 1
      expect([getGuardedDamageValue(1, [], 65), getGuardedDamageValue(0, [], 1)]).toEqual([1, 1]);
      // Exact against whole-number math (199^m / 200^m) for a sweep of damages, Damage and Guard Tokens
      const mismatches = [0, 1, 99, 999].flatMap(s =>
        [1, 2, 10, 64, 65].flatMap(m =>
          Array.from({ length: 2000 }, (_, i) => i + 1).filter(
            d => getGuardedDamageValue(d, s > 0 ? [s] : [], m) !== exactGuarded(d, s, m),
          ),
        ),
      );
      expect(mismatches).toEqual([]);
    });

    it("applyEnemyDamageTokens: only an enemy hitting the player's Pokémon, nothing else changes", async () => {
      game.override.battleStyle("double");
      await game.classicMode.startBattle(SpeciesId.GARCHOMP, SpeciesId.MACHAMP);
      const [p1, p2] = game.scene.getPlayerField();
      const [e1, e2] = game.scene.getEnemyField();

      // Guard Tokens alone: x0.995^m on an enemy's hit on the player
      for (const m of [1, 10, 65]) {
        setGuard(m);
        expect(getPlayerGuardTokenStacks()).toBe(m);
        expect(helper(e1, p1, 1000), `m=${m}`).toBe(toDmgValue(1000 * Math.pow(0.995, m)));
        expect(helper(e2, p2, 1000), `m=${m}`).toBe(toDmgValue(1000 * Math.pow(0.995, m)));
      }

      // With 10 Damage Tokens: one floor over both
      await addEnemyBoosters(10);
      setGuard(65);
      expect(helper(e1, p1, 1000)).toBe(974);
      expect(helper(e1, p1, 37)).toBe(getGuardedDamageValue(37, [10], 65));
      // Enemy on its ally or itself: the Damage Tokens only, as before
      expect(helper(e1, e2, 1000)).toBe(1350);
      expect(helper(e2, e2, 1000)).toBe(beforeGuard(e2, e2, 1000));
      // The player on an enemy, itself or its ally: untouched
      expect([helper(p1, e1, 1000), helper(p1, p1, 1000), helper(p1, p2, 1000)]).toEqual([1000, 1000, 1000]);

      // With Protection Tokens and Piercing Tokens too, every pair but enemy -> player is what it was before
      await addEnemyReducers(40);
      setPiercing(3);
      for (const [source, target] of [
        [p1, e1],
        [e1, e2],
        [e2, e2],
        [p1, p2],
        [p1, p1],
      ] as const) {
        for (const value of [1, 37, 1000]) {
          const guarded = helper(source, target, value);
          setGuard(0);
          expect(guarded, `${source.name} -> ${target.name}, ${value}`).toBe(helper(source, target, value));
          setGuard(65);
        }
      }

      // Without a Guard Token, enemy -> player is exactly the old step (the Damage Tokens' whole-number math)
      setGuard(0);
      for (const value of [1, 37, 1000, 123_457]) {
        expect(helper(e1, p1, value)).toBe(beforeGuard(e1, p1, value));
      }
    });
  });

  // These go through Pokemon.getAttackDamage, which calls applyEnemyDamageTokens (pokemon.ts)
  describe("in a real battle", () => {
    it("an enemy's attack on the player: x0.995^m at 1, 10 and 65 Guard Tokens, capped past 65", async () => {
      await game.classicMode.startBattle(SpeciesId.GARCHOMP);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const doubleEdge = allMoves[MoveId.DOUBLE_EDGE];
      const hit = () => player.getAttackDamage({ source: enemy, move: doubleEdge }).damage;
      const tokenFree = hit();
      expect(tokenFree).toBeGreaterThan(200);
      for (const m of [1, 10, 65]) {
        setGuard(m);
        expect(hit(), `m=${m}`).toBe(toDmgValue(tokenFree * Math.pow(0.995, m)));
      }
      expect(hit()).toBeLessThan(tokenFree * 0.73);
      // 65 is the most the party can hold: adding more keeps 65 and the same damage
      addGuard(10);
      expect(getPlayerGuardTokenStacks()).toBe(65);
      expect(hit()).toBe(toDmgValue(tokenFree * Math.pow(0.995, 65)));
    });

    it("stacks with the enemy's Damage Tokens: 99 tokens and 65 Guard Tokens, one floor", async () => {
      await game.classicMode.startBattle(SpeciesId.GARCHOMP);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const doubleEdge = allMoves[MoveId.DOUBLE_EDGE];
      const hit = () => player.getAttackDamage({ source: enemy, move: doubleEdge }).damage;
      const tokenFree = hit();
      await addEnemyBoosters(99);
      const boosted = hit();
      expect(boosted).toBe(Math.floor((tokenFree * 44_650) / 10_000));
      setGuard(65);
      expect(hit()).toBe(getGuardedDamageValue(tokenFree, [99], 65));
      expect(hit()).toBe(Math.floor(tokenFree * 4.465 * Math.pow(0.995, 65)));
      setGuard(10);
      expect(hit()).toBe(getGuardedDamageValue(tokenFree, [99], 10));
    });

    it("leaves the player's attacks on an enemy unchanged", async () => {
      await game.classicMode.startBattle(SpeciesId.GARCHOMP);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const earthquake = allMoves[MoveId.EARTHQUAKE];
      const hit = () => enemy.getAttackDamage({ source: player, move: earthquake }).damage;
      const plain = hit();
      await addEnemyBoosters(99);
      setGuard(65);
      expect(hit()).toBe(plain);
      // ... also through the Protection Tokens and Piercing Tokens
      await addEnemyReducers(99);
      setPiercing(10);
      const pierced = hit();
      setGuard(0);
      expect(hit()).toBe(pierced);
    });

    it("a real turn: the enemy's Double-Edge into 65 Guard Tokens and 99 Damage Tokens", async () => {
      game.override.enemyMoveset(MoveId.DOUBLE_EDGE);
      await game.classicMode.startBattle(SpeciesId.GARCHOMP);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const tokenFree = player.getAttackDamage({ source: enemy, move: allMoves[MoveId.DOUBLE_EDGE] }).damage;
      await addEnemyBoosters(99);
      setGuard(65);
      player.setStat(Stat.HP, 1_000_000);
      player.hp = 1_000_000;
      vi.spyOn(player, "randBattleSeedIntRange").mockReturnValue(100); // the 85-100% damage roll at its top
      const hpBefore = player.hp;
      game.move.select(MoveId.SPLASH);
      await game.phaseInterceptor.to("BerryPhase", false);
      expect(hpBefore - player.hp).toBe(getGuardedDamageValue(tokenFree, [99], 65));
      expect(hpBefore - player.hp).toBeLessThan(Math.floor(tokenFree * 4.465));
    });

    it("leaves confusion self-hits unchanged", async () => {
      game.override.confusionActivation(true);
      await game.classicMode.startBattle(SpeciesId.GARCHOMP);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      await addEnemyBoosters(99);
      setGuard(65);
      player.addTag(BattlerTagType.CONFUSED, 5, MoveId.CONFUSE_RAY, enemy.id);
      vi.spyOn(player, "randBattleSeedIntRange").mockReturnValue(100);
      const atk = player.getEffectiveStat(Stat.ATK);
      const def = player.getEffectiveStat(Stat.DEF);
      // battler-tags.ts ConfusedTag: a 40-power typeless hit on itself, at the top roll
      const selfHit = toDmgValue((((2 * player.level) / 5 + 2) * 40 * atk) / def / 50 + 2);
      const hpBefore = player.hp;
      game.move.select(MoveId.EARTHQUAKE);
      await game.phaseInterceptor.to("BerryPhase", false);
      expect(hpBefore - player.hp).toBe(selfHit);
    });

    // Local fork (2026-11-13), round-3 review: fixed damage returns from getAttackDamage before the token step, so the
    // Guard Tokens skip it exactly as the Damage Tokens do (Seismic Toss / Night Shade, Counter / Mirror Coat / Metal
    // Burst, Super Fang...); every hit of a multi-hit move goes through it on its own
    it("skips fixed-damage moves like the Damage Tokens do, and guards each hit of a multi-hit move", async () => {
      game.override.enemyMoveset([MoveId.SEISMIC_TOSS, MoveId.DOUBLE_KICK]);
      await game.classicMode.startBattle(SpeciesId.GARCHOMP);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const doubleKick = allMoves[MoveId.DOUBLE_KICK];
      const tokenFree = player.getAttackDamage({ source: enemy, move: doubleKick }).damage;
      await addEnemyBoosters(99);
      setGuard(65);
      expect(player.getAttackDamage({ source: enemy, move: allMoves[MoveId.SEISMIC_TOSS] }).damage).toBe(enemy.level);
      player.setStat(Stat.HP, 1_000_000);
      player.hp = 1_000_000;
      vi.spyOn(player, "randBattleSeedIntRange").mockReturnValue(100); // the 85-100% damage roll at its top

      let hpBefore = player.hp;
      game.move.select(MoveId.SPLASH);
      await game.move.selectEnemyMove(MoveId.SEISMIC_TOSS);
      await game.toNextTurn();
      expect(hpBefore - player.hp).toBe(enemy.level);

      hpBefore = player.hp;
      game.move.select(MoveId.SPLASH);
      await game.move.selectEnemyMove(MoveId.DOUBLE_KICK);
      await game.toNextTurn();
      expect(hpBefore - player.hp).toBe(2 * getGuardedDamageValue(tokenFree, [99], 65));
    });

    it("leaves indirect damage unchanged: poison takes its 1/8", async () => {
      game.override.statusEffect(StatusEffect.POISON);
      await game.classicMode.startBattle(SpeciesId.GARCHOMP);
      const player = game.field.getPlayerPokemon();
      await addEnemyBoosters(99);
      setGuard(65);
      const hpBefore = player.hp;
      game.move.select(MoveId.SPLASH);
      await game.toEndOfTurn();
      expect(hpBefore - player.hp).toBe(toDmgValue(player.getMaxHp() / 8));
    });
  });

  describe("the item", () => {
    it("is a GREAT reward of weight 4 only in Endless while the enemy holds a Damage Token and the party has fewer than 65", async () => {
      await game.classicMode.startBattle(SpeciesId.GARCHOMP);
      const party = game.scene.getPlayerParty();
      const entry = poolEntry(ModifierTier.GREAT, "GUARD_TOKEN")!;
      expect(entry).toBeDefined();
      expect(entry.maxWeight).toBe(4);
      for (const tier of [ModifierTier.COMMON, ModifierTier.ULTRA, ModifierTier.ROGUE, ModifierTier.MASTER]) {
        expect(poolEntry(tier, "GUARD_TOKEN"), `tier ${tier}`).toBeUndefined();
      }
      const weight = entry.weight as WeightedModifierTypeWeightFunc;

      // Classic, even with a Damage Token: 0
      expect(enemyHoldsDamageToken()).toBe(false);
      const booster = await addEnemyBoosters(1);
      expect(enemyHoldsDamageToken()).toBe(true);
      expect(weight(party, 0)).toBe(0);
      for (const mode of [GameModes.CHALLENGE, GameModes.DAILY]) {
        game.scene.gameMode = getGameMode(mode);
        expect(weight(party, 0), GameModes[mode]).toBe(0);
      }

      // Endless (and Spliced Endless) with a Damage Token: 4 up to 64 tokens, 0 at 65
      for (const mode of [GameModes.SPLICED_ENDLESS, GameModes.ENDLESS]) {
        game.scene.gameMode = getGameMode(mode);
        expect(weight(party, 0), GameModes[mode]).toBe(4);
      }
      addGuard(64);
      expect(weight(party, 0)).toBe(4);
      addGuard(1);
      expect(getPlayerGuardTokenStacks()).toBe(65);
      expect(weight(party, 0)).toBe(0);
      expect(getGuardTokenWeight()).toBe(0);

      // Endless without a Damage Token: 0; a Protection Token alone does not count
      setGuard(0);
      game.scene.removeModifier(booster, true);
      expect(weight(party, 0)).toBe(0);
      await addEnemyReducers(5);
      expect(weight(party, 0)).toBe(0);
    });

    it("adds exactly its 4 to the GREAT tier's total in Endless, and nothing once the party holds 65", async () => {
      await game.classicMode.startBattle(SpeciesId.GARCHOMP);
      game.scene.gameMode = getGameMode(GameModes.ENDLESS);
      const party = game.scene.getPlayerParty();
      const without = greatTotal(party);
      await addEnemyBoosters(1);
      expect(greatTotal(party)).toBe(without + 4);
      addGuard(65);
      expect(greatTotal(party)).toBe(without);
      // The reward roll agrees: offered below 65, not at 65
      vi.spyOn(console, "log").mockImplementation(() => {});
      const offered = () => {
        itemPoolChecks.set("GUARD_TOKEN" as ModifierTypeKeys, undefined);
        regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0);
        return itemPoolChecks.get("GUARD_TOKEN" as ModifierTypeKeys);
      };
      expect(offered()).toBe(false);
      setGuard(64);
      expect(offered()).toBe(true);
    });

    it("is gated by the first Classic clear", async () => {
      game.override.forkContentUnlocked(false);
      await game.classicMode.startBattle(SpeciesId.GARCHOMP);
      game.scene.gameMode = getGameMode(GameModes.ENDLESS);
      await addEnemyBoosters(5);
      const party = game.scene.getPlayerParty();
      expect(FORK_UNLOCK.gatedItems.has("GUARD_TOKEN")).toBe(true);
      expect(isForkItemLocked("GUARD_TOKEN")).toBe(true);
      vi.spyOn(console, "log").mockImplementation(() => {});
      const offered = () => {
        itemPoolChecks.set("GUARD_TOKEN" as ModifierTypeKeys, undefined);
        regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0);
        return itemPoolChecks.get("GUARD_TOKEN" as ModifierTypeKeys);
      };
      expect(offered()).toBe(false);
      game.override.forkContentUnlocked(true);
      expect(isForkItemLocked("GUARD_TOKEN")).toBe(false);
      expect(offered()).toBe(true);
    });

    it("stacks to 65 at most, as a party item that nothing can steal; enemies never get it", async () => {
      await game.classicMode.startBattle(SpeciesId.GARCHOMP);
      addGuard(40);
      addGuard(25);
      const held = game.scene.findModifier(m => m instanceof Modifier.GuardTokenModifier, true)!;
      expect(held.getStackCount()).toBe(65);
      expect(held.getMaxStackCount()).toBe(65);
      addGuard(1);
      expect(held.getStackCount()).toBe(65);
      expect(game.scene.findModifiers(m => m instanceof Modifier.GuardTokenModifier, true)).toHaveLength(1);
      // Not a held item: no holder, so no thief, Grip Claw or transfer can take it
      expect(held).not.toBeInstanceOf(Modifier.PokemonHeldItemModifier);
      const heldIds = game.field
        .getPlayerPokemon()
        .getHeldItems()
        .map(m => m.type.id);
      expect(heldIds).not.toContain("GUARD_TOKEN");
      expect(game.scene.findModifiers(m => m instanceof Modifier.GuardTokenModifier, false)).toHaveLength(0);
      // Only the player's pool has it, and the enemies' fork items do not include it
      for (const poolType of [
        ModifierPoolType.WILD,
        ModifierPoolType.TRAINER,
        ModifierPoolType.ENEMY_BUFF,
        ModifierPoolType.DAILY_STARTER,
      ]) {
        const pool = getModifierPoolForType(poolType);
        const ids = Object.values(pool).flatMap(tier => tier.map(w => w.modifierType.id));
        expect(ids, `pool ${poolType}`).not.toContain("GUARD_TOKEN");
      }
      expect(ENEMY_CUSTOM_ITEMS.candidates.map(c => c.id as string)).not.toContain("GUARD_TOKEN");
    });

    it("survives the session save with its stack", async () => {
      game.override.startingModifier([{ name: "GUARD_TOKEN", count: 30 }]);
      await game.classicMode.startBattle(SpeciesId.GARCHOMP);
      expect(getPlayerGuardTokenStacks()).toBe(30);
      const { gameData } = game.scene;
      const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
      const session = gameData.parseSessionData(json);
      const saved = session.modifiers.find(m => m.typeId === "GUARD_TOKEN")!;
      expect(saved).toBeDefined();
      expect(saved.className).toBe("GuardTokenModifier");
      expect(saved.player).toBe(true);
      // biome-ignore lint/performance/noDynamicNamespaceImportAccess: the session loader (game-data.ts) looks it up the same way
      const restored = saved.toModifier(Modifier[saved.className as keyof typeof Modifier]);
      expect(restored).toBeInstanceOf(Modifier.GuardTokenModifier);
      expect(restored!.stackCount).toBe(30);
      expect(restored!.type.id).toBe("GUARD_TOKEN");
      expect(restored!.getMaxStackCount()).toBe(65);
    });
  });

  // Local fork (2026-11-13), round-3 review: the weight is read when the reward screen rolls (SelectModifierPhase ->
  // regenerateModifierPoolThresholds), after the wave's enemy has fainted. These walk real Endless waves to show that
  // the enemy's Damage Tokens are still in the scene's enemy modifier list at that moment (BattleEndPhase clears only
  // the enemies' held items), on the next wave, and after a session save and reload.
  describe("at reward time, in a real Endless run", () => {
    /** Starts a run in `mode` the way the title screen would and stops at the first command */
    async function startRunInMode(mode: GameModes): Promise<void> {
      await game.runToTitle();
      game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
        game.scene.gameMode = getGameMode(mode);
        game.scene.offsetGym = false;
        const starters = generateStarters(game.scene, [SpeciesId.GARCHOMP]);
        const selectStarterPhase = new SelectStarterPhase();
        game.scene.phaseManager.pushNew("EncounterPhase", false);
        selectStarterPhase.initBattle(starters);
      });
      vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
      await game.phaseInterceptor.to("CommandPhase", false);
    }

    /** Gives the enemy side a Damage Token the way AddEnemyBuffModifierPhase adds one (with its id, so saves keep it) */
    async function addEnemyBuffBooster(count: number): Promise<void> {
      const token = modifierTypes
        .ENEMY_DAMAGE_BOOSTER()
        .withIdFromFunc(modifierTypes.ENEMY_DAMAGE_BOOSTER)
        .newModifier() as Modifier.EnemyDamageBoosterModifier;
      await game.scene.addEnemyModifier(token as EnemyPersistentModifier, true, true);
      token.stackCount = count;
    }

    function enemyBoosterStacks(): number[] {
      return game.scene
        .findModifiers(m => m instanceof Modifier.EnemyDamageBoosterModifier, false)
        .map(m => m.getStackCount());
    }

    /**
     * Wins the wave, reads what the reward screen saw when it rolled (the enemy's Damage Tokens, the Guard Token's
     * weight, whether the roll could offer it), skips the rewards and stops at the next wave's first command
     */
    async function winAndReadRewardRoll(): Promise<{
      wave: number;
      boosters: number[];
      weight: number;
      offered: boolean | undefined;
    }> {
      let seen: { wave: number; boosters: number[]; weight: number; offered: boolean | undefined } | undefined;
      itemPoolChecks.set("GUARD_TOKEN" as ModifierTypeKeys, undefined);
      // prompts run in the order they are queued: the turn's command first, then the reward screen
      game.move.select(MoveId.SPLASH);
      game.onNextPrompt(
        "SelectModifierPhase",
        UiMode.MODIFIER_SELECT,
        () => {
          seen = {
            wave: game.scene.currentBattle.waveIndex,
            boosters: enemyBoosterStacks(),
            weight: getGuardTokenWeight(),
            offered: itemPoolChecks.get("GUARD_TOKEN" as ModifierTypeKeys),
          };
        },
        undefined,
        true,
      );
      game.doSelectModifier();
      await game.doKillOpponents();
      await game.phaseInterceptor.to("TurnInitPhase");
      await game.phaseInterceptor.to("CommandPhase");
      expect(seen).toBeDefined();
      return seen!;
    }

    it.each([
      { name: "Endless", mode: GameModes.ENDLESS },
      { name: "Spliced Endless", mode: GameModes.SPLICED_ENDLESS },
    ])("$name: the reward roll sees the enemy's Damage Tokens, on later waves and after a reload", async ({ mode }) => {
      await startRunInMode(mode);
      expect(game.scene.gameMode.modeId).toBe(mode);
      expect(game.scene.currentBattle.waveIndex).toBe(75);

      // No Damage Token yet: weight 0, not offered
      expect(await winAndReadRewardRoll()).toEqual({ wave: 75, boosters: [], weight: 0, offered: false });

      // With one (as after a 50-wave boss), the wave's end leaves it in place for the reward roll
      await addEnemyBuffBooster(3);
      expect(await winAndReadRewardRoll()).toEqual({ wave: 76, boosters: [3], weight: 4, offered: true });

      // Still there on the next wave, and back from the session save (nothing left over: cleared before the load)
      expect(game.scene.currentBattle.waveIndex).toBe(77);
      expect(enemyBoosterStacks()).toEqual([3]);
      game.scene.clearEnemyModifiers();
      expect(getGuardTokenWeight()).toBe(0);
      await game.reload.reloadSession();
      expect(game.scene.gameMode.modeId).toBe(mode);
      expect(game.scene.currentBattle.waveIndex).toBe(77);
      expect(enemyBoosterStacks()).toEqual([3]);
      expect(await winAndReadRewardRoll()).toEqual({ wave: 77, boosters: [3], weight: 4, offered: true });

      // And with the party at 65 the roll leaves it out
      addGuard(65);
      expect(await winAndReadRewardRoll()).toEqual({ wave: 78, boosters: [3], weight: 0, offered: false });
    });
  });
});
