/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { getPokemonNameWithAffix } from "#app/messages";
import { allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { ZCrystalModifierType } from "#modifiers/modifier-type";
import type { PokemonMove } from "#moves/pokemon-move";
import { ZMAX_RULES } from "#moves/zmax-data";
import { GameManager } from "#test/framework/game-manager";
import { toDmgValue } from "#utils/common";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const koFiles = import.meta.glob("../../../locales/ko/**/*.json", { eager: true, import: "default" });

/**
 * Local fork (2026-11-16): Z-Moves and Max Moves end to end: the rewards (zmax-items.ts) convert move slots
 * (move-transform.ts), the converted moves fight with the registry entries' effects (move.ts), and the session keeps
 * them. The user: "다이사탕 사용 시 원하는 기술을 다이 기술로 바꿈 / 해당 포켓몬의 전용기는 거다이 기술로 바꿈 (멜메탈:
 * 불릿펀치 -> 다이스틸, 더블펀처 -> 거다이융격)", "z + 다이기술: Z다이너클, Z다이스틸 같은 이름이 되며, 위력 200 고정,
 * 방어/판별 등의 효과를 뚫고 1/2 데미지". Design: tools/drive/zmax_1116/design_spec.md.
 */
describe("Z / Max moves 2026-11-16: integration", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .hasPassiveAbility(false)
      .enemyHasPassiveAbility(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Melmetal (can Gigantamax, signature Double Iron Bash) knowing `moves`, set after the start (no moveset override) */
  async function startMelmetal(moves: MoveId[]): Promise<PlayerPokemon> {
    await game.classicMode.startBattle(SpeciesId.MELMETAL);
    const melmetal = game.field.getPlayerPokemon();
    game.move.changeMoveset(melmetal, moves);
    return melmetal;
  }

  /** Use a 다이사탕 on move `moveIndex` of `pokemon`, as the reward screen does after "yes" */
  function useCandy(pokemon: PlayerPokemon, moveIndex: number): boolean {
    return game.scene.addModifier(modifierTypes.DYNAMAX_CANDY().newModifier(pokemon, moveIndex)!);
  }

  /** Use a type Z crystal on move `moveIndex` of `pokemon` */
  function useCrystal(pokemon: PlayerPokemon, moveIndex: number, type: PokemonType): boolean {
    return game.scene.addModifier(new ZCrystalModifierType(type).newModifier(pokemon, moveIndex)!);
  }

  /** `target`'s damage from `source`'s `move` as the forecast sees it (max roll, no protection in between) */
  function forecast(source: Pokemon, target: Pokemon, move: PokemonMove): number {
    return target.getAttackDamage({ source, move: move.getMove(), simulated: true }).damage;
  }

  /** Run `body` with the Korean text loaded (the test backend serves English only), then go back to English */
  async function inKorean(body: () => void): Promise<void> {
    const { loadPath } = i18next.options.backend as { loadPath: (lng: string, ns: string[]) => string };
    for (const ns of i18next.options.ns as readonly string[]) {
      const file = /locales\/ko\/(.+?\.json)/.exec(loadPath("ko", [ns]))?.[1];
      const json = file ? koFiles[`../../../locales/ko/${file}`] : undefined;
      if (json) {
        i18next.addResourceBundle("ko", ns, json, true, true);
      }
    }
    await i18next.changeLanguage("ko");
    try {
      for (const m of allMoves) {
        m.localize();
      }
      body();
    } finally {
      await i18next.changeLanguage("en");
      for (const m of allMoves) {
        m.localize();
      }
    }
  }

  it("다이사탕 on Melmetal: 불릿펀치 -> 다이스틸, 더블펀처 -> 거다이융격 (the user's example), once per slot", async () => {
    const melmetal = await startMelmetal([MoveId.BULLET_PUNCH, MoveId.DOUBLE_IRON_BASH]);

    expect(useCandy(melmetal, 0)).toBe(true);
    expect(useCandy(melmetal, 1)).toBe(true);
    const [bulletPunch, doubleIronBash] = melmetal.moveset;
    expect(bulletPunch.transform).toEqual({ kind: "max", moveId: MoveId.MAX_STEELSPIKE });
    expect(doubleIronBash.transform).toEqual({ kind: "gmax", moveId: MoveId.G_MAX_MELTDOWN });
    // the slots keep their own moves (and PP); the derived moves have the Max powers of the base moves
    expect(bulletPunch.moveId).toBe(MoveId.BULLET_PUNCH);
    expect(doubleIronBash.moveId).toBe(MoveId.DOUBLE_IRON_BASH);
    expect(bulletPunch.getMove().power).toBe(90);
    expect(doubleIronBash.getMove().power).toBe(140);
    expect(bulletPunch.getMove().category).toBe(MoveCategory.PHYSICAL);
    expect(doubleIronBash.getMovePp()).toBe(allMoves[MoveId.DOUBLE_IRON_BASH].pp);

    // a Max / G-Max move takes no second candy
    expect(useCandy(melmetal, 0)).toBe(false);
    expect(bulletPunch.transform).toEqual({ kind: "max", moveId: MoveId.MAX_STEELSPIKE });

    await inKorean(() => {
      expect(allMoves[MoveId.BULLET_PUNCH].name).toBe("불릿펀치");
      expect(allMoves[MoveId.DOUBLE_IRON_BASH].name).toBe("더블펀처");
      expect(bulletPunch.getName()).toBe("다이스틸");
      expect(doubleIronBash.getName()).toBe("거다이융격");
    });
    expect(bulletPunch.getName()).toBe("Max Steelspike");
  });

  it("Z crystal + candy (either order) make Z다이스틸: power 200, through Protect for 1/2", async () => {
    const melmetal = await startMelmetal([MoveId.BULLET_PUNCH, MoveId.IRON_HEAD, MoveId.DOUBLE_IRON_BASH]);
    const enemy = game.field.getEnemyPokemon();

    // crystal first (Z move), then the candy
    expect(useCrystal(melmetal, 0, PokemonType.STEEL)).toBe(true);
    expect(melmetal.moveset[0].transform).toEqual({ kind: "z", moveId: MoveId.CORKSCREW_CRASH__PHYSICAL });
    expect(useCandy(melmetal, 0)).toBe(true);
    // candy first (Max move), then the crystal
    expect(useCandy(melmetal, 1)).toBe(true);
    expect(melmetal.moveset[1].transform).toEqual({ kind: "max", moveId: MoveId.MAX_STEELSPIKE });
    expect(useCrystal(melmetal, 1, PokemonType.STEEL)).toBe(true);
    // a G-Max move takes no crystal ("거다이맥스 기술 제외")
    expect(useCandy(melmetal, 2)).toBe(true);
    expect(useCrystal(melmetal, 2, PokemonType.STEEL)).toBe(false);
    expect(melmetal.moveset[2].transform).toEqual({ kind: "gmax", moveId: MoveId.G_MAX_MELTDOWN });

    for (const slot of melmetal.moveset.slice(0, 2)) {
      expect(slot.transform).toEqual({ kind: "zMax", moveId: MoveId.MAX_STEELSPIKE });
      const move = slot.getMove();
      expect(move.power).toBe(ZMAX_RULES.zMaxPower);
      expect(move.name).toBe(`Z-${allMoves[MoveId.MAX_STEELSPIKE].name}`);
      const pierce = move.getAttrs("ProtectPierceAttr");
      expect(pierce).toHaveLength(1);
      expect(pierce[0].multiplier).toBe(ZMAX_RULES.zMaxProtectPierceMultiplier);
      expect(pierce[0].ignoresMaxGuard).toBe(true);
    }
    await inKorean(() => {
      expect(melmetal.moveset[0].getName()).toBe("Z다이스틸");
    });

    const full = forecast(melmetal, enemy, melmetal.moveset[0]);
    vi.spyOn(enemy, "randBattleSeedIntRange").mockReturnValue(100);
    game.move.select(MoveId.BULLET_PUNCH);
    await game.move.forceEnemyMove(MoveId.PROTECT);
    await game.toEndOfTurn();

    expect(melmetal).toHaveUsedMove({
      move: MoveId.BULLET_PUNCH,
      derivedMoveId: MoveId.MAX_STEELSPIKE,
      result: MoveResult.SUCCESS,
    });
    expect(enemy.getMaxHp() - enemy.hp).toBe(toDmgValue(full * ZMAX_RULES.zMaxProtectPierceMultiplier));
    expect(game).toHaveShownMessage(
      i18next.t("battle:protectPierced", { pokemonNameWithAffix: getPokemonNameWithAffix(enemy) }),
    );
    // Max Steelspike's effect still applies: Defense +1
    expect(melmetal).toHaveStatStage(Stat.DEF, 1);
  });

  it("Max Guard made from a status move blocks a plain Max move and Feint", async () => {
    const melmetal = await startMelmetal([MoveId.TAIL_WHIP, MoveId.BULLET_PUNCH]);
    expect(useCandy(melmetal, 0)).toBe(true);
    expect(melmetal.moveset[0].transform).toEqual({ kind: "max", moveId: MoveId.MAX_GUARD });
    expect(melmetal.moveset[0].getMove().priority).toBe(4);

    // The enemy's Body Slam is a Max Strike (as a Training Session copy of a player Pokémon would have it)
    const enemy = game.field.getEnemyPokemon();
    game.move.changeMoveset(enemy, [MoveId.BODY_SLAM, MoveId.FEINT]);
    enemy.moveset[0].transform = { kind: "max", moveId: MoveId.MAX_STRIKE };

    game.move.select(MoveId.TAIL_WHIP);
    await game.move.selectEnemyMove(MoveId.BODY_SLAM);
    await game.toNextTurn();
    expect(melmetal).toHaveUsedMove({ move: MoveId.TAIL_WHIP, derivedMoveId: MoveId.MAX_GUARD });
    expect(enemy).toHaveUsedMove({ move: MoveId.BODY_SLAM, derivedMoveId: MoveId.MAX_STRIKE });
    expect(melmetal).toHaveFullHp();
    expect(melmetal).toHaveStatStage(Stat.SPD, 0); // Max Strike's Speed drop is blocked too

    // The chained Max Guard succeeds here
    vi.spyOn(melmetal, "randBattleSeedInt").mockReturnValue(0);
    game.move.select(MoveId.TAIL_WHIP);
    await game.move.selectEnemyMove(MoveId.FEINT);
    await game.phaseInterceptor.to("MoveEndPhase"); // Max Guard (+4)
    expect(melmetal).toHaveBattlerTag(BattlerTagType.MAX_GUARD);
    await game.phaseInterceptor.to("MoveEndPhase"); // Feint (+2)
    expect(enemy).toHaveUsedMove(MoveId.FEINT);
    expect(melmetal).toHaveFullHp();
    expect(melmetal).toHaveBattlerTag(BattlerTagType.MAX_GUARD); // Feint does not lift it
  });

  it("keeps every kind of conversion through a session save and reload, and fights with it afterwards", async () => {
    const melmetal = await startMelmetal([
      MoveId.BULLET_PUNCH,
      MoveId.DOUBLE_IRON_BASH,
      MoveId.IRON_HEAD,
      MoveId.SWORDS_DANCE,
    ]);
    useCandy(melmetal, 0); // 다이스틸
    useCandy(melmetal, 1); // 거다이융격
    useCrystal(melmetal, 2, PokemonType.STEEL); // 강철Z (Corkscrew Crash)
    useCrystal(melmetal, 3, PokemonType.NORMAL); // Z칼춤
    useCandy(melmetal, 3); // Z다이검무
    const transforms = melmetal.moveset.map(m => m.transform);
    expect(transforms).toEqual([
      { kind: "max", moveId: MoveId.MAX_STEELSPIKE },
      { kind: "gmax", moveId: MoveId.G_MAX_MELTDOWN },
      { kind: "z", moveId: MoveId.CORKSCREW_CRASH__PHYSICAL },
      { kind: "zMax", moveId: MoveId.MAX_SWORDS_DANCE },
    ]);
    melmetal.moveset[0].ppUsed = 3;
    melmetal.moveset[0].ppUp = 2;

    const { gameData } = game.scene;
    const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
    const session = gameData.parseSessionData(json);
    expect(session.party[0].moveset.map(m => m.transform)).toEqual(transforms);
    // an unconverted slot is saved as before (no `transform` key)
    expect(JSON.parse(json).enemyParty[0].moveset[0]).not.toHaveProperty("transform");

    game.reload["sessionData"] = session;
    await game.reload.reloadSession();
    const loaded = game.field.getPlayerPokemon();
    expect(loaded).not.toBe(melmetal);
    expect(loaded.moveset.map(m => m.transform)).toEqual(transforms);
    expect(loaded.moveset[0].ppUsed).toBe(3);
    expect(loaded.moveset[0].getMovePp()).toBe(melmetal.moveset[0].getMovePp());
    expect(loaded.moveset.map(m => m.getMove().id)).toEqual([
      MoveId.MAX_STEELSPIKE,
      MoveId.G_MAX_MELTDOWN,
      MoveId.CORKSCREW_CRASH__PHYSICAL,
      MoveId.MAX_SWORDS_DANCE,
    ]);

    // Z다이검무 after the reload: Attack +4
    game.move.select(MoveId.SWORDS_DANCE);
    await game.toNextTurn();
    expect(loaded).toHaveUsedMove({ move: MoveId.SWORDS_DANCE, derivedMoveId: MoveId.MAX_SWORDS_DANCE });
    expect(loaded).toHaveStatStage(Stat.ATK, ZMAX_RULES.zMaxSwordsDanceStages);
  });

  it("Parental Bond does not double a converted Max move", async () => {
    game.override.ability(AbilityId.PARENTAL_BOND);
    const melmetal = await startMelmetal([MoveId.BULLET_PUNCH, MoveId.IRON_HEAD]);
    useCandy(melmetal, 0);
    const enemy = game.field.getEnemyPokemon();
    expect(melmetal.moveset[0].getMove().canBeMultiStrikeEnhanced(melmetal)).toBe(false);
    expect(melmetal.moveset[1].getMove().canBeMultiStrikeEnhanced(melmetal)).toBe(true);

    game.move.select(MoveId.BULLET_PUNCH);
    await game.toEndOfTurn();
    expect(enemy.turnData.attacksReceived).toHaveLength(1);
    expect(enemy.turnData.attacksReceived[0]).toMatchObject({
      move: MoveId.BULLET_PUNCH,
      derivedMoveId: MoveId.MAX_STEELSPIKE,
    });
  });

  it("judges a converted slot's own selection rules by the converted move", async () => {
    game.override.ability(AbilityId.LAST_STAND).enemySpecies(SpeciesId.MELMETAL);
    const melmetal = await startMelmetal([MoveId.GIGATON_HAMMER, MoveId.U_TURN]);

    // Last Stand (결사항전) bars self-switching moves; U-turn made Max Flutterby no longer switches out
    expect(melmetal.isMoveSelectable(MoveId.U_TURN)[0]).toBe(false);
    expect(useCandy(melmetal, 1)).toBe(true);
    expect(melmetal.moveset[1].transform).toEqual({ kind: "max", moveId: MoveId.MAX_FLUTTERBY });
    expect(melmetal.isMoveSelectable(MoveId.U_TURN)).toEqual([true, ""]);

    // Gigaton Hammer cannot be used twice in a row; made Max Steelspike, it can
    expect(useCandy(melmetal, 0)).toBe(true);
    game.move.select(MoveId.GIGATON_HAMMER);
    await game.toNextTurn();
    expect(melmetal).toHaveUsedMove({ move: MoveId.GIGATON_HAMMER, derivedMoveId: MoveId.MAX_STEELSPIKE });
    expect(melmetal.isMoveSelectable(MoveId.GIGATON_HAMMER)).toEqual([true, ""]);
    expect(melmetal.moveset[0].isUsable(melmetal, false, true)[0]).toBe(true);
  });

  it("G-Max Chi Strike's critical-hit stages add to Focus Energy's", async () => {
    await game.classicMode.startBattle(SpeciesId.MACHAMP);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    player.addTag(BattlerTagType.CRIT_BOOST, 0, MoveId.FOCUS_ENERGY, player.id);
    expect(enemy.getCritStage(player, allMoves[MoveId.TACKLE])).toBe(2);
    player.addTag(BattlerTagType.G_MAX_CHI_STRIKE, 0, MoveId.G_MAX_CHI_STRIKE, player.id);
    expect(enemy.getCritStage(player, allMoves[MoveId.TACKLE])).toBe(3);
  });

  it("Clearing Gust blows G-Max Steelsurge away too", async () => {
    game.override.ability(AbilityId.CLEARING_GUST);
    game.scene.arena.addTag(ArenaTagType.G_MAX_STEELSURGE, 0, undefined, 0, ArenaTagSide.PLAYER);
    await game.classicMode.startBattle(SpeciesId.MILTANK);
    const player = game.field.getPlayerPokemon();
    expect(player).toHaveFullHp();
    expect(player).toHaveAbilityApplied(AbilityId.CLEARING_GUST);
    expect(game).not.toHaveArenaTag(ArenaTagType.G_MAX_STEELSURGE, ArenaTagSide.PLAYER);
  });

  it("names the G-Max fields and Steelsurge in the arena flyout", () => {
    for (const key of ["gMaxWildfire", "gMaxVineLash", "gMaxCannonade", "gMaxVolcalith", "gMaxSteelsurge"]) {
      const text = i18next.t(`arenaFlyout:${key}`);
      expect(text, key).not.toBe(key);
      expect(text, key).toMatch(/^G-Max /);
    }
  });

  /** Review fixes (tools/drive/zmax_1116/review_fixes.md) */
  describe("review fixes", () => {
    it("crit stage: Focus Energy and Dragon Cheer held together do not add up; G-Max Chi Strike adds on top", async () => {
      await game.classicMode.startBattle(SpeciesId.MAGIKARP);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      player.addTag(BattlerTagType.DRAGON_CHEER, 0, MoveId.DRAGON_CHEER, player.id);
      expect(enemy.getCritStage(player, allMoves[MoveId.TACKLE])).toBe(1); // not a Dragon type: +1
      // Psych Up of a Focus Energy user (or a Lansat Berry) adds Focus Energy's tag beside Dragon Cheer's
      player.addTag(BattlerTagType.CRIT_BOOST, 0, MoveId.FOCUS_ENERGY, player.id);
      expect(player).toHaveBattlerTag(BattlerTagType.CRIT_BOOST);
      expect(player).toHaveBattlerTag(BattlerTagType.DRAGON_CHEER);
      expect(enemy.getCritStage(player, allMoves[MoveId.TACKLE])).toBe(1);
      player.addTag(BattlerTagType.G_MAX_CHI_STRIKE, 0, MoveId.G_MAX_CHI_STRIKE, player.id);
      expect(enemy.getCritStage(player, allMoves[MoveId.TACKLE])).toBe(2);
    });

    it("Counter / Mirror Coat judge a converted hit by the category of the move as used", async () => {
      game.override.startingLevel(5);
      await game.classicMode.startBattle(SpeciesId.PIKACHU);
      const pikachu = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      game.move.changeMoveset(pikachu, [MoveId.THUNDERBOLT, MoveId.SLUDGE_BOMB]);
      // special Thunderbolt made physical Catastropika; special Sludge Bomb made Max Ooze (registry entry: PHYSICAL)
      pikachu.moveset[0].transform = { kind: "zExclusive", moveId: MoveId.CATASTROPIKA };
      pikachu.moveset[1].transform = { kind: "max", moveId: MoveId.MAX_OOZE };
      expect(pikachu.moveset[0].getMove().category).toBe(MoveCategory.PHYSICAL);
      expect(pikachu.moveset[1].getMove().category).toBe(MoveCategory.SPECIAL);
      game.move.changeMoveset(enemy, [MoveId.COUNTER, MoveId.MIRROR_COAT]);

      game.move.select(MoveId.THUNDERBOLT);
      await game.move.selectEnemyMove(MoveId.MIRROR_COAT);
      await game.toNextTurn();
      expect(enemy).toHaveUsedMove({ move: MoveId.MIRROR_COAT, result: MoveResult.FAIL });
      expect(pikachu).toHaveFullHp();

      let enemyHp = enemy.hp;
      game.move.select(MoveId.THUNDERBOLT);
      await game.move.selectEnemyMove(MoveId.COUNTER);
      await game.toNextTurn();
      expect(enemy).toHaveUsedMove({ move: MoveId.COUNTER, result: MoveResult.SUCCESS });
      expect(pikachu.getMaxHp() - pikachu.hp).toBe(toDmgValue((enemyHp - enemy.hp) * 2));

      const pikachuHp = pikachu.hp;
      enemyHp = enemy.hp;
      game.move.select(MoveId.SLUDGE_BOMB);
      await game.move.selectEnemyMove(MoveId.MIRROR_COAT);
      await game.toNextTurn();
      expect(enemy).toHaveUsedMove({ move: MoveId.MIRROR_COAT, result: MoveResult.SUCCESS });
      expect(pikachuHp - pikachu.hp).toBe(toDmgValue((enemyHp - enemy.hp) * 2));
    });

    it("a partner's Decorate / Life Dew reach a Max-Guarded Pokémon, as they reach one behind Protect", async () => {
      game.override.battleStyle("double");
      await game.classicMode.startBattle(SpeciesId.MELMETAL, SpeciesId.ALCREMIE);
      const [melmetal, alcremie] = game.scene.getPlayerField();
      game.move.changeMoveset(melmetal, [MoveId.TAIL_WHIP]);
      game.move.changeMoveset(alcremie, [MoveId.DECORATE, MoveId.LIFE_DEW]);
      melmetal.moveset[0].transform = { kind: "max", moveId: MoveId.MAX_GUARD };

      game.move.select(MoveId.TAIL_WHIP, BattlerIndex.PLAYER);
      game.move.select(MoveId.DECORATE, BattlerIndex.PLAYER_2, BattlerIndex.PLAYER);
      await game.toNextTurn();
      expect(melmetal).toHaveUsedMove({
        move: MoveId.TAIL_WHIP,
        derivedMoveId: MoveId.MAX_GUARD,
        result: MoveResult.SUCCESS,
      });
      expect(alcremie).toHaveUsedMove({ move: MoveId.DECORATE, result: MoveResult.SUCCESS });
      expect(melmetal).toHaveStatStage(Stat.ATK, 2);
      expect(melmetal).toHaveStatStage(Stat.SPATK, 2);

      const halfHp = Math.floor(melmetal.getMaxHp() / 2);
      melmetal.hp = halfHp;
      vi.spyOn(melmetal, "randBattleSeedInt").mockReturnValue(0); // the chained Max Guard succeeds
      game.move.select(MoveId.TAIL_WHIP, BattlerIndex.PLAYER);
      game.move.select(MoveId.LIFE_DEW, BattlerIndex.PLAYER_2);
      await game.toNextTurn();
      expect(melmetal).toHaveUsedMove({ move: MoveId.TAIL_WHIP, result: MoveResult.SUCCESS });
      expect(melmetal.hp).toBeGreaterThan(halfHp);
    });

    it("Lightning Rod draws a converted Electric move (Max Lightning, Gigavolt Havoc from a spread move)", async () => {
      game.override.battleStyle("double").enemySpecies(SpeciesId.MAGIKARP).enemyLevel(50);
      await game.classicMode.startBattle(SpeciesId.PIKACHU, SpeciesId.MAGIKARP);
      const [pikachu, magikarp] = game.scene.getPlayerField();
      const [enemy1, enemy2] = game.scene.getEnemyField();
      game.field.mockAbility(enemy2, AbilityId.LIGHTNING_ROD);
      game.move.changeMoveset(pikachu, [MoveId.THUNDERBOLT, MoveId.DISCHARGE]);
      game.move.changeMoveset(magikarp, [MoveId.SPLASH]);
      pikachu.moveset[0].transform = { kind: "max", moveId: MoveId.MAX_LIGHTNING };
      pikachu.moveset[1].transform = { kind: "z", moveId: MoveId.GIGAVOLT_HAVOC__SPECIAL };

      game.move.select(MoveId.THUNDERBOLT, BattlerIndex.PLAYER, BattlerIndex.ENEMY);
      game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
      await game.toNextTurn();
      expect(pikachu).toHaveUsedMove({ move: MoveId.THUNDERBOLT, derivedMoveId: MoveId.MAX_LIGHTNING });
      expect(enemy1).toHaveFullHp();
      expect(enemy2).toHaveFullHp();
      expect(enemy2).toHaveStatStage(Stat.SPATK, 1);

      game.move.select(MoveId.DISCHARGE, BattlerIndex.PLAYER, BattlerIndex.ENEMY);
      game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
      await game.toNextTurn();
      expect(pikachu).toHaveUsedMove({ move: MoveId.DISCHARGE, derivedMoveId: MoveId.GIGAVOLT_HAVOC__SPECIAL });
      expect(enemy1).toHaveFullHp();
      expect(enemy2).toHaveFullHp();
      expect(enemy2).toHaveStatStage(Stat.SPATK, 2);
    });

    it("Sucker Punch fails against an attack slot made a status Z-Move (Tackle -> Extreme Evoboost)", async () => {
      await game.classicMode.startBattle(SpeciesId.EEVEE);
      const eevee = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      game.move.changeMoveset(eevee, [MoveId.TACKLE]);
      eevee.moveset[0].transform = { kind: "zExclusive", moveId: MoveId.EXTREME_EVOBOOST };
      game.move.changeMoveset(enemy, [MoveId.SUCKER_PUNCH]);

      game.move.select(MoveId.TACKLE);
      await game.move.selectEnemyMove(MoveId.SUCKER_PUNCH);
      await game.toNextTurn();
      expect(enemy).toHaveUsedMove({ move: MoveId.SUCKER_PUNCH, result: MoveResult.FAIL });
      expect(eevee).toHaveFullHp();
      expect(eevee).toHaveUsedMove({ move: MoveId.TACKLE, derivedMoveId: MoveId.EXTREME_EVOBOOST });
      expect(eevee).toHaveStatStage(Stat.ATK, 2);
    });

    it("the Z-Power heal comes before the base move's HP check: Z-Belly Drum / Z-Fillet Away work at 40% HP", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();
      game.move.changeMoveset(snorlax, [MoveId.BELLY_DRUM, MoveId.FILLET_AWAY]);
      snorlax.moveset[0].transform = { kind: "z", moveId: MoveId.BELLY_DRUM };
      snorlax.moveset[1].transform = { kind: "z", moveId: MoveId.FILLET_AWAY };
      const maxHp = snorlax.getMaxHp();
      const halfCut = maxHp - toDmgValue(maxHp / 2);

      snorlax.hp = Math.floor(maxHp * 0.4);
      game.move.select(MoveId.BELLY_DRUM);
      await game.toNextTurn();
      expect(snorlax).toHaveUsedMove({ move: MoveId.BELLY_DRUM, result: MoveResult.SUCCESS });
      expect(snorlax).toHaveStatStage(Stat.ATK, 6);
      expect(snorlax).toHaveHp(halfCut);
      expect(game).toHaveShownMessage(
        i18next.t("moveTriggers:zPowerHeal", { pokemonName: getPokemonNameWithAffix(snorlax) }),
      );

      snorlax.hp = Math.floor(maxHp * 0.4);
      game.move.select(MoveId.FILLET_AWAY);
      await game.toNextTurn();
      expect(snorlax).toHaveUsedMove({ move: MoveId.FILLET_AWAY, result: MoveResult.SUCCESS });
      expect(snorlax).toHaveStatStage(Stat.SPATK, 2);
      expect(snorlax).toHaveStatStage(Stat.SPD, 2);
      expect(snorlax).toHaveHp(halfCut);
    });

    it("Wimp Out triggers after a Sheer Force user's Max Ooze (a Max move has no secondary-effect chance)", async () => {
      game.override.ability(AbilityId.WIMP_OUT).enemySpecies(SpeciesId.NIDOKING).enemyAbility(AbilityId.SHEER_FORCE);
      await game.classicMode.startBattle(SpeciesId.WIMPOD, SpeciesId.TYRUNT);
      const wimpod = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      game.move.changeMoveset(wimpod, [MoveId.ENDURE]);
      game.move.changeMoveset(enemy, [MoveId.SLUDGE_BOMB]);
      enemy.moveset[0].transform = { kind: "max", moveId: MoveId.MAX_OOZE };
      wimpod.hp = Math.ceil(wimpod.getMaxHp() * 0.51);

      game.move.select(MoveId.ENDURE);
      await game.move.selectEnemyMove(MoveId.SLUDGE_BOMB);
      game.doSelectPartyPokemon(1);
      await game.phaseInterceptor.to("TurnEndPhase");
      expect(enemy).toHaveUsedMove({ move: MoveId.SLUDGE_BOMB, derivedMoveId: MoveId.MAX_OOZE });
      expect(game.phaseInterceptor.phaseLog).toContain("SwitchSummonPhase");
      expect(game.scene.getPlayerParty()[1]).toBe(wimpod);
      expect(wimpod.getHpRatio()).toBeLessThan(0.5);
    });

    it("AI: a Max side effect on the foes scores as the user's benefit, judged on the real foes", async () => {
      await game.classicMode.startBattle(SpeciesId.MAGIKARP);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon(); // the AI user
      game.move.changeMoveset(enemy, [MoveId.TACKLE, MoveId.THUNDERBOLT, MoveId.DAZZLING_GLEAM]);
      enemy.moveset[0].transform = { kind: "max", moveId: MoveId.MAX_STRIKE };
      enemy.moveset[1].transform = { kind: "gmax", moveId: MoveId.G_MAX_VOLT_CRASH };
      enemy.moveset[2].transform = { kind: "gmax", moveId: MoveId.G_MAX_SMITE };
      const [maxStrike, voltCrash, smite] = enemy.moveset.map(m => m.getMove());

      // Max Strike: Speed -1 on the foes is +4 for the user, nothing as a (flipped) target score
      const statAttr = maxStrike.getAttrs("MaxMoveStatStageChangeAttr")[0];
      expect(statAttr.getUserBenefitScore(enemy, player, maxStrike)).toBe(4);
      expect(statAttr.getTargetBenefitScore(enemy, enemy, maxStrike)).toBe(0);
      expect(
        allMoves[MoveId.MAX_KNUCKLE]
          .getAttrs("MaxMoveStatStageChangeAttr")[0]
          .getUserBenefitScore(enemy, player, allMoves[MoveId.MAX_KNUCKLE]),
      ).toBe(4);

      // G-Max Volt Crash: +10 while a foe can still be paralysed; the user's own status does not matter
      const statusAttr = voltCrash.getAttrs("MaxMoveStatusAttr")[0];
      expect(statusAttr.getUserBenefitScore(enemy, player, voltCrash)).toBe(10);
      enemy.doSetStatus(StatusEffect.BURN);
      expect(statusAttr.getUserBenefitScore(enemy, player, voltCrash)).toBe(10);
      player.doSetStatus(StatusEffect.PARALYSIS);
      expect(statusAttr.getUserBenefitScore(enemy, player, voltCrash)).toBe(0);
      expect(statusAttr.getTargetBenefitScore(enemy, enemy, voltCrash)).toBe(0);

      // G-Max Smite: +5 while a foe is not confused yet
      const tagAttr = smite.getAttrs("MaxMoveBattlerTagAttr")[0];
      expect(tagAttr.getUserBenefitScore(enemy, player, smite)).toBe(5);
      player.addTag(BattlerTagType.CONFUSED, 3, MoveId.G_MAX_SMITE, enemy.id);
      expect(tagAttr.getUserBenefitScore(enemy, player, smite)).toBe(0);
      expect(tagAttr.getTargetBenefitScore(enemy, enemy, smite)).toBe(0);
    });
  });
});
