import { allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { getEvStatPoints } from "#modifiers/ev-items";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import type { ModifierOverride } from "#modifiers/modifier-type";
import { applyMoveAttrs } from "#moves/apply-attrs";
import type { Move } from "#moves/move";
import { GameManager } from "#test/framework/game-manager";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local fork (2026-11-13): 08 명세 1번, Foul Play (속임수) in the main series' way for every attacker. The target's
 * plain Attack (no held items, no Attack abilities, the nature at x1.1 / x0.9 without the Soul Dew) and its Attack
 * stages; the user's own Attack items and abilities on top, as for any physical move. Before, an enemy's Foul Play
 * copied the ace's Choice Band, Ultimate Gene, Flame Furnace, Booster Energy and Soul Dew x10.
 */
describe("Custom - Foul Play reads the target's plain Attack (08 명세 1번)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  /** Set in `beforeEach` (the move list is only built once the game is) */
  let foulPlay: Move;

  /** The stacked physical ace of the 5850 experiment: every Attack multiplier item plus ten Soul Dews */
  const ACE_ITEMS: ModifierOverride[] = [
    { name: "CHOICE_BAND" },
    { name: "ULTIMATE_GENE" },
    { name: "FLAME_FURNACE" },
    { name: "BOOSTER_ENERGY" },
    { name: "SOUL_DEW", count: 10 },
  ];
  const ACE_ITEM_IDS = ["CHOICE_BAND", "ULTIMATE_GENE", "FLAME_FURNACE", "BOOSTER_ENERGY", "SOUL_DEW"];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    foulPlay = allMoves[MoveId.FOUL_PLAY];
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .startingLevel(100)
      .enemyLevel(100)
      .ability(AbilityId.BALL_FETCH)
      .hasPassiveAbility(false)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyHasPassiveAbility(false)
      .playerIVs(31)
      .enemyIVs(31)
      .nature(Nature.ADAMANT)
      .enemyNature(Nature.ADAMANT)
      .shiny(false)
      .enemyShiny(false)
      .moveset([MoveId.FOUL_PLAY, MoveId.CRUNCH, MoveId.TACKLE, MoveId.SPLASH])
      .enemyMoveset(MoveId.SPLASH);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * The main-series Attack worked out by hand: the species' base Attack, IV, EVs, level, and an Adamant nature at x1.1
   * (rounded up, as `calculateStats` does for a raised stat)
   */
  function plainAdamantAttack(pokemon: Pokemon): number {
    const base = pokemon.getSpeciesForm(true).baseStats[Stat.ATK];
    const raw =
      Math.floor(((2 * base + pokemon.ivs[Stat.ATK] + getEvStatPoints(pokemon.evs[Stat.ATK])) * pokemon.level) / 100)
      + 5;
    return Math.ceil(raw * 1.1);
  }

  /** `getBaseDamage`'s formula with the given Attack and the defender's own Defense as the engine works it out */
  function expectedBaseDamage(user: Pokemon, target: Pokemon, atk: number): number {
    const def = target.getEffectiveStat(Stat.DEF, { opponent: user, move: foulPlay, forDefend: true });
    const power = foulPlay.calculateBattlePower(user, target, true, MoveCategory.PHYSICAL);
    return (((2 * user.level) / 5 + 2) * power * atk) / def / 50 + 2;
  }

  function foulPlayBaseDamage(user: Pokemon, target: Pokemon, isCritical = false): number {
    return target.getBaseDamage({ source: user, move: foulPlay, moveCategory: MoveCategory.PHYSICAL, isCritical });
  }

  function foulPlayDamage(user: Pokemon, target: Pokemon): number {
    return target.getAttackDamage({ source: user, move: foulPlay, simulated: true }).damage;
  }

  /** The Attack Foul Play gives `user` against `target` (the move attribute on its own) */
  function foulPlayAttack(user: Pokemon, target: Pokemon): number {
    const atk = new NumberHolder(0);
    applyMoveAttrs("VariableAtkAttr", user, target, foulPlay, atk);
    return atk.value;
  }

  /**
   * Takes every held item off `target` (Defense held where it was, since the Ultimate Gene also raises it) and returns
   * `user`'s Foul Play damage after that
   */
  function damageWithoutTargetItems(user: Pokemon, target: Pokemon): number {
    const def = target.getEffectiveStat(Stat.DEF, { opponent: user, move: foulPlay, forDefend: true });
    const realGetEffectiveStat = target.getEffectiveStat.bind(target);
    vi.spyOn(target, "getEffectiveStat").mockImplementation((stat, params) =>
      stat === Stat.DEF ? def : realGetEffectiveStat(stat, params),
    );
    for (const item of target.getHeldItems()) {
      game.scene.removeModifier(item, !target.isPlayer());
    }
    target.calculateStats();
    expect(target.getHeldItems()).toHaveLength(0);
    return foulPlayDamage(user, target);
  }

  it("an enemy's Foul Play ignores the player ace's Choice Band, Ultimate Gene, Flame Furnace, Booster Energy and Soul Dew x10", async () => {
    game.override.startingHeldItems(ACE_ITEMS).enemySpecies(SpeciesId.UMBREON);
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const ace = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    expect(ace.getHeldItems().map(m => m.type.id)).toEqual(expect.arrayContaining(ACE_ITEM_IDS));

    const plain = plainAdamantAttack(ace);
    // The items do work on the ace's own Attack: the Soul Dew in the stat, the four multipliers on top (x2.8 or more)
    expect(ace.getStat(Stat.ATK)).toBeGreaterThan(plain * 1.8);
    expect(ace.getEffectiveStat(Stat.ATK)).toBeGreaterThan(ace.getStat(Stat.ATK) * 2.8);

    // Foul Play reads none of that
    expect(ace.getFoulPlayStat(Stat.ATK)).toBe(plain);
    expect(foulPlayAttack(enemy, ace)).toBe(plain);
    expect(foulPlayBaseDamage(enemy, ace)).toBe(expectedBaseDamage(enemy, ace, plain));

    // The whole hit is the same as against the ace holding nothing
    const damage = foulPlayDamage(enemy, ace);
    expect(damage).toBeGreaterThan(0);
    expect(damageWithoutTargetItems(enemy, ace)).toBe(damage);
  });

  it("the player's Foul Play ignores the enemy's items and Soul Dew x10 the same way", async () => {
    game.override.enemyHeldItems(ACE_ITEMS).enemySpecies(SpeciesId.GARCHOMP);
    await game.classicMode.startBattle(SpeciesId.UMBREON);
    const umbreon = game.field.getPlayerPokemon();
    const enemyAce = game.field.getEnemyPokemon();
    expect(enemyAce.getHeldItems().map(m => m.type.id)).toEqual(expect.arrayContaining(ACE_ITEM_IDS));

    const plain = plainAdamantAttack(enemyAce);
    expect(enemyAce.getStat(Stat.ATK)).toBeGreaterThan(plain * 1.8);
    expect(enemyAce.getEffectiveStat(Stat.ATK)).toBeGreaterThan(enemyAce.getStat(Stat.ATK) * 2.8);

    expect(enemyAce.getFoulPlayStat(Stat.ATK)).toBe(plain);
    expect(foulPlayAttack(umbreon, enemyAce)).toBe(plain);
    expect(foulPlayBaseDamage(umbreon, enemyAce)).toBe(expectedBaseDamage(umbreon, enemyAce, plain));

    const damage = foulPlayDamage(umbreon, enemyAce);
    expect(damage).toBeGreaterThan(0);
    expect(damageWithoutTargetItems(umbreon, enemyAce)).toBe(damage);
  });

  it("an enemy's Foul Play in a real turn lands within the damage roll and no longer one-shots the stacked ace", async () => {
    game.override.startingHeldItems(ACE_ITEMS).enemySpecies(SpeciesId.UMBREON).enemyMoveset(MoveId.FOUL_PLAY);
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const ace = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const expected = foulPlayDamage(enemy, ace);
    // What the copied effective Attack (the old rule) would have done
    expect(ace.getEffectiveStat(Stat.ATK, { opponent: ace })).toBeGreaterThan(5 * ace.getFoulPlayStat(Stat.ATK));

    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();

    const lost = ace.getMaxHp() - ace.hp;
    expect(ace.isFainted()).toBe(false);
    expect(lost).toBeLessThanOrEqual(expected);
    expect(lost).toBeGreaterThanOrEqual(Math.floor(expected * 0.85) - 1);
  });

  it("keeps the target's Attack stages (+2 doubles it; a critical hit ignores a drop)", async () => {
    game.override.startingHeldItems(ACE_ITEMS).enemySpecies(SpeciesId.UMBREON);
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const ace = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const plain = plainAdamantAttack(ace);

    ace.setStatStage(Stat.ATK, 2);
    expect(foulPlayAttack(enemy, ace)).toBe(plain * 2);
    expect(foulPlayBaseDamage(enemy, ace)).toBe(expectedBaseDamage(enemy, ace, plain * 2));

    ace.setStatStage(Stat.ATK, -2);
    expect(foulPlayAttack(enemy, ace)).toBe(Math.floor(plain / 2));
    // The user's own stages do not count
    enemy.setStatStage(Stat.ATK, 6);
    expect(foulPlayBaseDamage(enemy, ace)).toBe(expectedBaseDamage(enemy, ace, Math.floor(plain / 2)));
    // A critical hit ignores the target's Attack drop, as it does the user's own for any physical move
    expect(foulPlayBaseDamage(enemy, ace, true)).toBeGreaterThan(foulPlayBaseDamage(enemy, ace));
    const critDef = ace.getEffectiveStat(Stat.DEF, {
      opponent: enemy,
      move: foulPlay,
      forDefend: true,
      isCritical: true,
    });
    const power = foulPlay.calculateBattlePower(enemy, ace, true, MoveCategory.PHYSICAL);
    expect(foulPlayBaseDamage(enemy, ace, true)).toBe((((2 * enemy.level) / 5 + 2) * power * plain) / critDef / 50 + 2);
  });

  it("the user's own Attack items apply on top, as for any physical move (Choice Band x1.5)", async () => {
    game.override
      .startingHeldItems(ACE_ITEMS)
      .enemySpecies(SpeciesId.UMBREON)
      .enemyHeldItems([{ name: "CHOICE_BAND" }]);
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const ace = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const plain = plainAdamantAttack(ace);

    expect(foulPlayAttack(enemy, ace)).toBe(Math.floor(plain * 1.5));
    expect(foulPlayBaseDamage(enemy, ace)).toBe(expectedBaseDamage(enemy, ace, Math.floor(plain * 1.5)));
  });

  it("leaves other physical moves alone: the ace's own Crunch still uses all its items", async () => {
    game.override.startingHeldItems(ACE_ITEMS).enemySpecies(SpeciesId.UMBREON);
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const ace = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const crunch = allMoves[MoveId.CRUNCH];

    const atk = ace.getEffectiveStat(Stat.ATK, { opponent: enemy });
    expect(atk).toBeGreaterThan(ace.getStat(Stat.ATK) * 2.8);
    const def = enemy.getEffectiveStat(Stat.DEF, { opponent: ace, move: crunch, forDefend: true });
    const power = crunch.calculateBattlePower(ace, enemy, true, MoveCategory.PHYSICAL);
    expect(enemy.getBaseDamage({ source: ace, move: crunch, moveCategory: MoveCategory.PHYSICAL })).toBe(
      (((2 * ace.level) / 5 + 2) * power * atk) / def / 50 + 2,
    );
  });

  it("matches calculateStats' Attack without a Soul Dew (vitamins, EVs, Macho Brace, raised / lowered / neutral natures)", async () => {
    game.override.startingHeldItems([
      { name: "BASE_STAT_BOOSTER", type: Stat.ATK, count: 10 },
      { name: "MYSTERY_ENCOUNTER_MACHO_BRACE", count: 50 },
    ]);
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const ace = game.field.getPlayerPokemon();
    ace.evs[Stat.ATK] = 252;

    const natures = [Nature.ADAMANT, Nature.MODEST, Nature.HARDY];
    const plainByNature = new Map<Nature, number>();
    for (const nature of natures) {
      ace.setNature(nature);
      expect(ace.getFoulPlayStat(Stat.ATK), Nature[nature]).toBe(ace.getStat(Stat.ATK));
      plainByNature.set(nature, ace.getStat(Stat.ATK));
    }

    // Ten Soul Dews move the stat itself; Foul Play reads the plain x1.1 where they raise it, but the real (lowered)
    // stat where they lower it (review fix: never more than the stat the Pokémon really has)
    const soulDew = modifierTypes
      .SOUL_DEW()
      .withIdFromFunc(modifierTypes.SOUL_DEW)
      .newModifier(ace) as PokemonHeldItemModifier;
    soulDew.stackCount = 10;
    game.scene.addModifier(soulDew, true, false, false, true);
    expect(ace.getHeldItems().find(m => m.type.id === "SOUL_DEW")?.stackCount).toBe(10);
    for (const nature of natures) {
      ace.setNature(nature);
      if (nature === Nature.ADAMANT) {
        expect(ace.getStat(Stat.ATK)).toBeGreaterThan(plainByNature.get(nature)!);
      } else if (nature === Nature.MODEST) {
        expect(ace.getStat(Stat.ATK)).toBeLessThan(plainByNature.get(nature)!);
      }
      const expected = nature === Nature.MODEST ? ace.getStat(Stat.ATK) : plainByNature.get(nature)!;
      expect(ace.getFoulPlayStat(Stat.ATK), Nature[nature]).toBe(expected);
    }
  });

  // Local fork (2026-11-19): ten Soul Dews pushed a lowered Attack to 1 until A4; it is now x0.9 x 0.9^10, about 31%
  // (the user: "마음의물방울은 하락 성격만 곱연산으로 처리하도록"), and Foul Play still reads that real Attack, not the plain x0.9
  it("never reads more than the target's real Attack: a special ace whose Soul Dews lowered Attack gives that Attack", async () => {
    game.override.startingLevel(5000);
    await game.classicMode.startBattle(SpeciesId.LATIOS);
    const ace = game.field.getPlayerPokemon();
    ace.setNature(Nature.MODEST);
    const plain = ace.getStat(Stat.ATK);
    const soulDew = modifierTypes
      .SOUL_DEW()
      .withIdFromFunc(modifierTypes.SOUL_DEW)
      .newModifier(ace) as PokemonHeldItemModifier;
    soulDew.stackCount = 10;
    game.scene.addModifier(soulDew, true, false, false, true);
    ace.calculateStats();
    const real = ace.getStat(Stat.ATK);
    expect(real).toBeGreaterThan(1);
    expect(real).toBeLessThan(plain / 2);
    expect(ace.getFoulPlayStat(Stat.ATK)).toBe(real);
  });

  it("leaves out Gorilla Tactics' x1.5 Attack, which upstream keeps as an in-battle stat override", async () => {
    game.override.ability(AbilityId.GORILLA_TACTICS).enemySpecies(SpeciesId.UMBREON);
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const ace = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const plain = plainAdamantAttack(ace);

    game.move.select(MoveId.TACKLE);
    await game.toNextTurn();

    expect(ace.getTag(BattlerTagType.GORILLA_TACTICS)).toBeDefined();
    expect(ace.getStat(Stat.ATK, false)).toBeGreaterThan(plain);
    expect(ace.getFoulPlayStat(Stat.ATK)).toBe(plain);
    expect(foulPlayAttack(enemy, ace)).toBe(plain);
  });
});
