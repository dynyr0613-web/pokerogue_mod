// Local fork (2026-11-19): 1.2.0 item A5. Shell Side Arm (셸암즈) makes contact when it is physical for a use (no
// longer partial): Tough Claws, Rough Skin / Iron Barbs, protection moves and the Master Punching Glove follow the
// category the use decided, an exact tie is rolled once per use, and other moves are unchanged.
import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import { toDmgValue } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Shell Side Arm - contact when physical (2026-11-19)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  const shellSideArm = () => allMoves[MoveId.SHELL_SIDE_ARM];

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
      .enemyHasPassiveAbility(false)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .hasPassiveAbility(false)
      .moveset([MoveId.SHELL_SIDE_ARM, MoveId.TACKLE, MoveId.WATER_GUN, MoveId.SPLASH]);
  });

  /** Make the forecast pick `category` clearly: the user's matching attacking stat is far higher, defences equal */
  function leanTo(category: MoveCategory.PHYSICAL | MoveCategory.SPECIAL, user: Pokemon, target: Pokemon): void {
    const physical = category === MoveCategory.PHYSICAL;
    user.setStat(Stat.ATK, physical ? 300 : 100);
    user.setStat(Stat.SPATK, physical ? 100 : 300);
    target.setStat(Stat.DEF, 200);
    target.setStat(Stat.SPDEF, 200);
  }

  /** The power `calculateBattlePower` last returned (the damage step's, as nothing runs after it in these turns) */
  function lastPower(spy: { mock: { results: { value: unknown }[] } }): number {
    return spy.mock.results.at(-1)?.value as number;
  }

  it("is no longer marked partial", () => {
    expect(shellSideArm().name).not.toContain("(P)");
  });

  it.each([
    { name: "physical", category: MoveCategory.PHYSICAL, power: 117 },
    { name: "special", category: MoveCategory.SPECIAL, power: 90 },
  ] as const)("Tough Claws: x1.3 only when $name ($power power)", async ({ category, power }) => {
    game.override.ability(AbilityId.TOUGH_CLAWS);
    await game.classicMode.startBattle(SpeciesId.SLOWBRO);
    const user = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const powerSpy = vi.spyOn(shellSideArm(), "calculateBattlePower");
    leanTo(category, user, enemy);

    game.move.select(MoveId.SHELL_SIDE_ARM);
    await game.toNextTurn();

    expect(enemy).not.toHaveFullHp();
    expect(lastPower(powerSpy)).toBeCloseTo(power, 8);
  });

  it.each([
    { ability: AbilityId.ROUGH_SKIN, abilityName: "Rough Skin", category: MoveCategory.PHYSICAL, hurt: true },
    { ability: AbilityId.ROUGH_SKIN, abilityName: "Rough Skin", category: MoveCategory.SPECIAL, hurt: false },
    { ability: AbilityId.IRON_BARBS, abilityName: "Iron Barbs", category: MoveCategory.PHYSICAL, hurt: true },
    { ability: AbilityId.IRON_BARBS, abilityName: "Iron Barbs", category: MoveCategory.SPECIAL, hurt: false },
  ] as const)("$abilityName hurts the user: $hurt (category $category)", async ({ ability, category, hurt }) => {
    game.override.enemyAbility(ability);
    await game.classicMode.startBattle(SpeciesId.SLOWBRO);
    const user = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    leanTo(category, user, enemy);

    game.move.select(MoveId.SHELL_SIDE_ARM);
    await game.toNextTurn();

    expect(enemy).not.toHaveFullHp();
    expect(user.getMaxHp() - user.hp).toBe(hurt ? toDmgValue(user.getMaxHp() / 8) : 0);
  });

  it.each([
    { name: "physical", category: MoveCategory.PHYSICAL, atkStage: -1 },
    { name: "special", category: MoveCategory.SPECIAL, atkStage: 0 },
  ] as const)("King's Shield blocks it; lowers Attack only when $name", async ({ category, atkStage }) => {
    game.override.enemyMoveset([MoveId.KINGS_SHIELD, MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.SLOWBRO);
    const user = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    leanTo(category, user, enemy);

    game.move.select(MoveId.SHELL_SIDE_ARM);
    await game.move.selectEnemyMove(MoveId.KINGS_SHIELD);
    await game.toNextTurn();

    expect(enemy).toHaveFullHp();
    expect(user.getStatStage(Stat.ATK)).toBe(atkStage);
  });

  it.each([
    { name: "physical", category: MoveCategory.PHYSICAL, power: 108 },
    { name: "special", category: MoveCategory.SPECIAL, power: 90 },
  ] as const)("Master Punching Glove covers it only when $name", async ({ category, power }) => {
    game.override.enemyAbility(AbilityId.ROUGH_SKIN).startingHeldItems([{ name: "MASTER_PUNCHING_GLOVE" }]);
    await game.classicMode.startBattle(SpeciesId.SLOWBRO);
    const user = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const powerSpy = vi.spyOn(shellSideArm(), "calculateBattlePower");
    leanTo(category, user, enemy);

    game.move.select(MoveId.SHELL_SIDE_ARM);
    await game.phaseInterceptor.to("MoveEffectPhase", false);
    // the glove's Unseen Fist rule and target-side hiding follow the category too
    const physical = category === MoveCategory.PHYSICAL;
    expect(shellSideArm().doesFlagEffectApply({ flag: MoveFlags.IGNORE_PROTECT, user, target: enemy })).toBe(physical);
    expect(
      shellSideArm().doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user, target: enemy, targetSide: false }),
    ).toBe(physical);
    expect(
      shellSideArm().doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user, target: enemy, targetSide: true }),
    ).toBe(false);
    await game.toNextTurn();

    expect(enemy).not.toHaveFullHp();
    expect(lastPower(powerSpy)).toBeCloseTo(power, 8);
    // the glove keeps a physical Shell Side Arm's contact from Rough Skin, as for any contact move
    expect(user).toHaveFullHp();
  });

  // 2026-11-19, review: the 1/4 through protection itself (the glove's `applyMasterGloveProtectDamage` and Unseen Fist's
  // damage condition get the target, so they know the category), not only the protect-bypass flag
  it.each([
    { source: "Master Punching Glove", glove: true, category: MoveCategory.PHYSICAL, through: true },
    { source: "Master Punching Glove", glove: true, category: MoveCategory.SPECIAL, through: false },
    { source: "Unseen Fist", glove: false, category: MoveCategory.PHYSICAL, through: true },
    { source: "Unseen Fist", glove: false, category: MoveCategory.SPECIAL, through: false },
  ] as const)(
    "$source: through Protect for 1/4 only when physical (category $category)",
    async ({ glove, category, through }) => {
      game.override.enemyMoveset([MoveId.PROTECT, MoveId.SPLASH]);
      if (glove) {
        game.override.startingHeldItems([{ name: "MASTER_PUNCHING_GLOVE" }]);
      } else {
        game.override.ability(AbilityId.UNSEEN_FIST);
      }
      await game.classicMode.startBattle(SpeciesId.SLOWBRO);
      const user = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      leanTo(category, user, enemy);
      const damage = () => enemy.getAttackDamage({ source: user, move: shellSideArm(), simulated: true }).damage;

      const open = damage();
      enemy.addTag(BattlerTagType.PROTECTED);
      const intoProtect = damage();
      enemy.removeTag(BattlerTagType.PROTECTED);
      expect(intoProtect).toBe(through ? toDmgValue(open * 0.25) : open);

      game.move.select(MoveId.SHELL_SIDE_ARM);
      await game.move.selectEnemyMove(MoveId.PROTECT);
      await game.toNextTurn();
      expect(enemy.isFullHp()).toBe(!through);
    },
  );

  /**
   * Every forecast is an exact tie; the user's tie-break rolls alternate (0 = physical, 1 = special) from the value
   * `nextRoll` sets, so a second roll within one use would pick the other category. `rolls` counts them, and
   * `damageCategories` gets the category of every real damage step.
   */
  function setUpTie(): {
    user: Pokemon;
    enemy: Pokemon;
    rolls: () => number;
    nextRoll: (value: 0 | 1) => void;
    damageCategories: MoveCategory[];
  } {
    const user = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const realGetBaseDamage = enemy.getBaseDamage.bind(enemy);
    const damageCategories: MoveCategory[] = [];
    vi.spyOn(enemy, "getBaseDamage").mockImplementation(params => {
      if (params.categoryForecast) {
        return 100;
      }
      if (params.move.id === MoveId.SHELL_SIDE_ARM && params.simulated === false) {
        damageCategories.push(params.moveCategory);
      }
      return realGetBaseDamage(params);
    });
    const realRandBattleSeedInt = user.randBattleSeedInt.bind(user);
    let rolls = 0;
    let next = 0;
    vi.spyOn(user, "randBattleSeedInt").mockImplementation((range, min) => {
      if (range !== 2) {
        return realRandBattleSeedInt(range, min);
      }
      rolls++;
      const value = next;
      next ^= 1;
      return value;
    });
    return {
      user,
      enemy,
      rolls: () => rolls,
      nextRoll: value => {
        next = value;
      },
      damageCategories,
    };
  }

  it("an exact tie is rolled once per use, and the damage, Tough Claws and Rough Skin all agree", async () => {
    game.override.ability(AbilityId.TOUGH_CLAWS).enemyAbility(AbilityId.ROUGH_SKIN);
    await game.classicMode.startBattle(SpeciesId.SLOWBRO);
    const { user, enemy, rolls, nextRoll, damageCategories } = setUpTie();
    const powerSpy = vi.spyOn(shellSideArm(), "calculateBattlePower");

    for (const roll of [0, 1] as const) {
      user.hp = user.getMaxHp();
      game.move.select(MoveId.SHELL_SIDE_ARM);
      await game.phaseInterceptor.to("MoveEffectPhase", false);
      nextRoll(roll);
      const rollsBefore = rolls();
      const categoriesBefore = damageCategories.length;
      await game.toNextTurn();

      const physical = roll === 0;
      expect(rolls() - rollsBefore).toBe(1);
      expect(damageCategories.slice(categoriesBefore)).toEqual([
        physical ? MoveCategory.PHYSICAL : MoveCategory.SPECIAL,
      ]);
      expect(lastPower(powerSpy)).toBeCloseTo(physical ? 117 : 90, 8);
      expect(user.getMaxHp() - user.hp).toBe(physical ? toDmgValue(user.getMaxHp() / 8) : 0);
      expect(enemy).not.toHaveFullHp();
    }
  });

  it("every hit of one use keeps the category (Parental Bond): one roll, Rough Skin on each physical hit", async () => {
    game.override.ability(AbilityId.PARENTAL_BOND).enemyAbility(AbilityId.ROUGH_SKIN);
    await game.classicMode.startBattle(SpeciesId.SLOWBRO);
    const { user, rolls, nextRoll, damageCategories } = setUpTie();

    game.move.select(MoveId.SHELL_SIDE_ARM);
    await game.phaseInterceptor.to("MoveEffectPhase", false);
    nextRoll(0); // physical; a second roll would turn the second hit special
    const rollsBefore = rolls();
    await game.toNextTurn();

    expect(rolls() - rollsBefore).toBe(1);
    expect(damageCategories).toEqual([MoveCategory.PHYSICAL, MoveCategory.PHYSICAL]);
    expect(user.getMaxHp() - user.hp).toBe(2 * toDmgValue(user.getMaxHp() / 8));
  });

  it("leaves other moves alone: Tackle makes contact and gets Tough Claws, Water Gun neither", async () => {
    game.override.ability(AbilityId.TOUGH_CLAWS).enemyAbility(AbilityId.ROUGH_SKIN);
    await game.classicMode.startBattle(SpeciesId.SLOWBRO);
    const user = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const power = (move: MoveId) => allMoves[move].calculateBattlePower(user, enemy, true);

    expect(allMoves[MoveId.TACKLE].hasContactFlag()).toBe(true);
    expect(allMoves[MoveId.WATER_GUN].hasContactFlag(user, enemy)).toBe(false);
    expect(allMoves[MoveId.PHOTON_GEYSER].hasContactFlag(user, enemy)).toBe(false);
    expect(shellSideArm().hasContactFlag()).toBe(false); // no use, no target: non-contact
    expect(shellSideArm().hasContactFlag(user, user)).toBe(false); // moveset generation's self-target
    expect(power(MoveId.TACKLE)).toBeCloseTo(52);
    expect(power(MoveId.WATER_GUN)).toBe(40);

    game.move.select(MoveId.WATER_GUN);
    await game.toNextTurn();
    expect(user).toHaveFullHp();

    game.move.select(MoveId.TACKLE);
    await game.toNextTurn();
    expect(user.getMaxHp() - user.hp).toBe(toDmgValue(user.getMaxHp() / 8));
  });
});
