// Local fork (2026-11-20): 1.2.0, Stalwart as in Pokémon Champions 1.3.0 (the user: "포켓몬 챔피언스 기준
// 굳건한정신 특성 업데이트"). Besides ignoring redirection (Follow Me, Storm Drain ...), the holder's moves ignore the
// target's Substitute, like Infiltrator's Substitute bypass (screens, Safeguard and Mist still apply to Stalwart).
// `IgnoreSubstituteAbAttr`, read in `Move.hitsSubstitute`, as ability or passive, for player and enemy holders.

import { SubstituteTag } from "#data/battler-tags";
import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import { toDmgValue } from "#utils/common";
import { readFileSync } from "node:fs";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/** Gives `pokemon` a Substitute doll (1/4 of its max HP) without spending its HP, as the Infiltrator tests do. */
function addSubstitute(pokemon: Pokemon): SubstituteTag {
  pokemon.addTag(BattlerTagType.SUBSTITUTE, 0, MoveId.NONE, pokemon.id);
  const sub = pokemon.getTag(SubstituteTag);
  expect(sub).toBeDefined();
  return sub!;
}

describe("Local fork - Stalwart ignores Substitute (Pokémon Champions 1.3.0)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .ability(AbilityId.STALWART)
      .passiveAbility(AbilityId.BALL_FETCH)
      .battleStyle("single")
      .criticalHits(false)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyPassiveAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(100)
      .enemyLevel(100);
  });

  it("has the new Korean and English descriptions", () => {
    const description = (lang: string): string =>
      JSON.parse(readFileSync(`./locales/${lang}/ability.json`, "utf8")).stalwart.description;
    expect(description("ko")).toBe(
      "상대의 기술을 끌어모으는 특성이나 기술의 영향을 받지 않고, 상대의 대타출동을 무시하고 기술을 쓸 수 있다.",
    );
    expect(description("en")).toBe(
      "The Pokémon ignores the effects of Abilities and moves that draw in moves, and its moves ignore the target's substitute.",
    );
  });

  it("a Stalwart user's attack hits the real target and leaves the Substitute intact", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const feebas = game.field.getPlayerPokemon();
    const snorlax = game.field.getEnemyPokemon();
    const sub = addSubstitute(snorlax);
    const subHp = sub.hp;

    expect(allMoves[MoveId.TACKLE].hitsSubstitute(feebas, snorlax)).toBe(false);

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();

    expect(snorlax).not.toHaveFullHp();
    expect(snorlax.getTag(SubstituteTag)).toBe(sub);
    expect(sub.hp).toBe(subHp);
    expect(feebas).toHaveAbilityApplied(AbilityId.STALWART);
  });

  it("secondary effects of a Stalwart user's attack reach the real target", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const snorlax = game.field.getEnemyPokemon();
    const sub = addSubstitute(snorlax);
    const subHp = sub.hp;

    game.move.use(MoveId.BREAKING_SWIPE);
    await game.toEndOfTurn();

    expect(snorlax).not.toHaveFullHp();
    expect(snorlax).toHaveStatStage(Stat.ATK, -1);
    expect(sub.hp).toBe(subHp);
  });

  it("a Stalwart user's status moves and stat-lowering moves go through the Substitute", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const snorlax = game.field.getEnemyPokemon();
    addSubstitute(snorlax);

    game.move.use(MoveId.CHARM);
    await game.toEndOfTurn();
    expect(snorlax).toHaveStatStage(Stat.ATK, -2);

    game.move.use(MoveId.SPORE);
    await game.toEndOfTurn();
    expect(snorlax).toHaveStatusEffect(StatusEffect.SLEEP);
  });

  it("works as a passive ability", async () => {
    game.override.ability(AbilityId.BALL_FETCH).passiveAbility(AbilityId.STALWART);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const snorlax = game.field.getEnemyPokemon();
    const sub = addSubstitute(snorlax);
    const subHp = sub.hp;

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();

    expect(snorlax).not.toHaveFullHp();
    expect(sub.hp).toBe(subHp);
  });

  it("works for an enemy holder against the player's Substitute", async () => {
    game.override.ability(AbilityId.BALL_FETCH).enemyAbility(AbilityId.STALWART).enemyMoveset(MoveId.TACKLE);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const feebas = game.field.getPlayerPokemon();
    const sub = addSubstitute(feebas);
    const subHp = sub.hp;

    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();

    expect(feebas).not.toHaveFullHp();
    expect(sub.hp).toBe(subHp);
  });

  it("a user without Stalwart still hits the Substitute", async () => {
    game.override.ability(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const feebas = game.field.getPlayerPokemon();
    const snorlax = game.field.getEnemyPokemon();
    const sub = addSubstitute(snorlax);
    const subHp = sub.hp;

    expect(allMoves[MoveId.TACKLE].hitsSubstitute(feebas, snorlax)).toBe(true);

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();

    expect(snorlax).toHaveFullHp();
    expect(sub.hp).toBeLessThan(subHp);

    game.move.use(MoveId.CHARM);
    await game.toEndOfTurn();
    expect(snorlax).toHaveStatStage(Stat.ATK, 0);
  });

  it("does not bypass screens (only the Substitute, unlike Infiltrator)", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const feebas = game.field.getPlayerPokemon();
    const snorlax = game.field.getEnemyPokemon();
    const preScreenDmg = snorlax.getAttackDamage({ source: feebas, move: allMoves[MoveId.TACKLE] }).damage;

    game.scene.arena.addTag(ArenaTagType.REFLECT, 1, MoveId.NONE, snorlax.id, ArenaTagSide.ENEMY, true);

    const postScreenDmg = snorlax.getAttackDamage({ source: feebas, move: allMoves[MoveId.TACKLE] }).damage;
    expect(postScreenDmg).toBeLessThan(preScreenDmg);
  });

  it("Infiltrator is unchanged: it still bypasses Substitute and screens", async () => {
    game.override.ability(AbilityId.INFILTRATOR);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const feebas = game.field.getPlayerPokemon();
    const snorlax = game.field.getEnemyPokemon();
    const preScreenDmg = snorlax.getAttackDamage({ source: feebas, move: allMoves[MoveId.TACKLE] }).damage;
    game.scene.arena.addTag(ArenaTagType.REFLECT, 1, MoveId.NONE, snorlax.id, ArenaTagSide.ENEMY, true);
    expect(snorlax.getAttackDamage({ source: feebas, move: allMoves[MoveId.TACKLE] }).damage).toBe(preScreenDmg);

    const sub = addSubstitute(snorlax);
    const subHp = sub.hp;

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();

    expect(snorlax).not.toHaveFullHp();
    expect(sub.hp).toBe(subHp);
    expect(feebas).toHaveAbilityApplied(AbilityId.INFILTRATOR);
  });

  it("still ignores redirection, and hits the chosen target through its Substitute", async () => {
    game.override.battleStyle("double").enemySpecies(SpeciesId.SNORLAX);
    await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP);

    const [enemy1, enemy2] = game.scene.getEnemyField();
    const sub = addSubstitute(enemy2);
    const subHp = sub.hp;

    game.move.use(MoveId.TACKLE, BattlerIndex.PLAYER, BattlerIndex.ENEMY_2);
    game.move.use(MoveId.SPLASH, BattlerIndex.PLAYER_2);
    await game.move.selectEnemyMove(MoveId.FOLLOW_ME);
    await game.move.selectEnemyMove(MoveId.SPLASH);
    await game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER, BattlerIndex.PLAYER_2, BattlerIndex.ENEMY_2]);
    await game.toEndOfTurn();

    expect(enemy1).toHaveFullHp();
    expect(enemy2).not.toHaveFullHp();
    expect(sub.hp).toBe(subHp);
  });

  // Local fork (2026-11-20), review: regressions around the Substitute bypass
  it("does not bypass Safeguard (unlike Infiltrator)", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const feebas = game.field.getPlayerPokemon();
    const snorlax = game.field.getEnemyPokemon();
    game.scene.arena.addTag(ArenaTagType.SAFEGUARD, 5, MoveId.NONE, snorlax.id, ArenaTagSide.ENEMY, true);
    expect(snorlax.isSafeguarded(feebas)).toBe(true);

    game.move.use(MoveId.SPORE);
    await game.toEndOfTurn();

    expect(snorlax).toHaveStatusEffect(StatusEffect.NONE);
  });

  it("a hit through the Substitute breaks Disguise, as Infiltrator's does", async () => {
    game.override.enemySpecies(SpeciesId.MIMIKYU).enemyAbility(AbilityId.DISGUISE);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const mimikyu = game.field.getEnemyPokemon();
    expect(mimikyu.formIndex).toBe(0);
    const sub = addSubstitute(mimikyu);
    const subHp = sub.hp;

    // Water Gun, not Tackle: Mimikyu is a Ghost type
    game.move.use(MoveId.WATER_GUN);
    await game.toEndOfTurn();

    expect(mimikyu.formIndex).toBe(1);
    expect(mimikyu).toHaveTakenDamage(toDmgValue(mimikyu.getMaxHp() / 8));
    expect(sub.hp).toBe(subHp);
  });

  it("goes through a doll passed on by Shed Tail", async () => {
    game.override.ability(AbilityId.BALL_FETCH).enemyAbility(AbilityId.STALWART).enemyMoveset(MoveId.TACKLE);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.FEEBAS);
    const magikarp = game.field.getPlayerPokemon();

    game.move.use(MoveId.SHED_TAIL);
    game.doSelectPartyPokemon(1);
    await game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
    await game.toEndOfTurn();

    const feebas = game.field.getPlayerPokemon();
    expect(feebas.species.speciesId).toBe(SpeciesId.FEEBAS);
    const sub = feebas.getTag(SubstituteTag);
    expect(sub).toBeDefined();
    // The doll is untouched: Stalwart's Tackle hit Feebas itself
    expect(sub!.hp).toBe(Math.floor(magikarp.getMaxHp() / 4));
    expect(feebas).not.toHaveFullHp();
  });
});
