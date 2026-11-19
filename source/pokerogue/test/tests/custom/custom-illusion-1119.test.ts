// Local fork (2026-11-19): tests of Illusion (일루전) = Disguise's effect + disguised as a random ally (C10, the user:
// "c10 일루전의 효과를 탈 + 랜덤 아군 변신으로 해두기"). On entry the holder takes the look of a random non-fainted ally
// of its own party (seeded RNG); the first damaging hit is blocked for 1/8 of its max HP, as Disguise does, and the
// illusion wears off, spent until the battle ends or the holder faints (ab-attrs.ts, `IllusionPreSummonAbAttr` and
// `IllusionBlockDamageAbAttr`).
import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { getPokemonNameWithAffix } from "#app/messages";
import { allAbilities } from "#data/data-lists";
import { PokemonBattleData } from "#data/pokemon-data";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import type { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import { toDmgValue } from "#utils/common";
import i18next from "i18next";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Custom ability - Illusion (C10)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    // The player's Zoroark has Illusion as its only ability, so no ability override on the player's side
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .shiny(false)
      .enemyShiny(false)
      .startingLevel(100)
      .enemyLevel(5)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyHasPassiveAbility(false)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH, MoveId.TACKLE, MoveId.SUBSTITUTE]);
  });

  /** The illusion-break message, naming the holder itself */
  function breakMessage(pokemon: Pokemon): string {
    return i18next.t("abilityTriggers:illusionBreak", { pokemonName: getPokemonNameWithAffix(pokemon, false) });
  }

  it("is implemented: no (N) marker, and it is the Zorua line's ability", () => {
    expect(allAbilities[AbilityId.ILLUSION].unimplemented).toBe(false);
    expect(allAbilities[AbilityId.ILLUSION].name.endsWith("(N)")).toBe(false);
  });

  it("enters with the look of a random ally: sprite, name, gender, Poke Ball and icon", async () => {
    await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
    const [zoroark, ...allies] = game.scene.getPlayerParty();

    const illusion = zoroark.summonData.illusion;
    expect(illusion).not.toBeNull();
    const ally = allies.find(p => p.species.speciesId === illusion!.species);
    expect(ally, "an ally of its own party").toBeDefined();

    expect(zoroark.getNameToRender()).toBe(ally!.name);
    expect(getPokemonNameWithAffix(zoroark)).toBe(ally!.name);
    expect(zoroark.getGender(false, true)).toBe(ally!.gender);
    expect(zoroark.getPokeball(true)).toBe(ally!.pokeball);
    expect(zoroark.getBattleSpriteId()).toBe(ally!.getBattleSpriteId());
    expect(zoroark.getIconId(false, true)).toBe(ally!.getIconId());
    expect(zoroark.getTypes({ useIllusion: true })).toEqual(ally!.getTypes());
    // Its true self is unchanged
    expect(zoroark.getNameToRender({ useIllusion: false })).toBe(zoroark.name);
    expect(zoroark.getTypes()).toEqual([PokemonType.DARK]);
  });

  it("picks the ally with the battle's seeded RNG among the non-fainted allies other than itself", async () => {
    await game.classicMode.startBattle(
      SpeciesId.ZOROARK,
      SpeciesId.FEEBAS,
      SpeciesId.MAGIKARP,
      SpeciesId.ABRA,
      SpeciesId.AXEW,
    );
    const party = game.scene.getPlayerParty();
    const zoroark = party[0];
    zoroark.breakIllusion();
    party[1].hp = 0; // Feebas fainted

    const roll = vi.spyOn(zoroark, "randBattleSeedInt").mockReturnValueOnce(2);
    applyAbAttrs("PreSummonAbAttr", { pokemon: zoroark });

    expect(roll).toHaveBeenCalledWith(3); // Magikarp, Abra, Axew
    expect(zoroark.summonData.illusion?.species).toBe(SpeciesId.AXEW);
  });

  it("keeps its own look with no ally to copy", async () => {
    await game.classicMode.startBattle(SpeciesId.ZOROARK);
    expect(game.field.getPlayerPokemon().summonData.illusion).toBeNull();
  });

  it("a wild holder keeps its own look", async () => {
    game.override.enemySpecies(SpeciesId.ZORUA).enemyAbility(AbilityId.ILLUSION);
    await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.FEEBAS);
    expect(game.field.getEnemyPokemon().summonData.illusion).toBeNull();
  });

  it("an enemy takes the look of another Pokemon of its own trainer", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER, trainerVariant: TrainerVariant.DEFAULT })
      .startingWave(30)
      .enemyAbility(AbilityId.ILLUSION)
      .enemyLevel(50);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const [lead, ...others] = game.scene.getEnemyParty();
    expect(others.length, "the trainer needs a second Pokemon").toBeGreaterThanOrEqual(1);
    const illusion = lead.summonData.illusion;
    expect(illusion).not.toBeNull();
    expect(others.map(p => p.species.speciesId)).toContain(illusion!.species);
    expect(getPokemonNameWithAffix(lead)).toBe(
      i18next.t("battle:foePokemonWithAffix", { pokemonName: lead.getNameToRender() }),
    );
  });

  it("an enemy's illusion blocks the player's first hit the same way, and the message names the foe itself", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER, trainerVariant: TrainerVariant.DEFAULT })
      .startingWave(30)
      .enemyAbility(AbilityId.ILLUSION)
      .enemyLevel(50);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const enemy = game.field.getEnemyPokemon();
    const maxHp = enemy.getMaxHp();
    expect(enemy.summonData.illusion).not.toBeNull();

    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("MoveEndPhase");

    expect(enemy).toHaveTakenDamage(toDmgValue(maxHp / 8));
    expect(enemy.summonData.illusion).toBeNull();
    expect(game).toHaveShownMessage(
      i18next.t("abilityTriggers:illusionBreak", {
        pokemonName: i18next.t("battle:foePokemonWithAffix", { pokemonName: enemy.name }),
      }),
    );
  });

  it("blocks the first damaging hit for 1/8 of its max HP, like Disguise, then shows its true look", async () => {
    await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.FEEBAS);
    const zoroark = game.field.getPlayerPokemon();
    const maxHp = zoroark.getMaxHp();
    expect(zoroark.summonData.illusion).not.toBeNull();

    game.move.select(MoveId.SPLASH);
    await game.move.forceEnemyMove(MoveId.TACKLE);
    await game.phaseInterceptor.to("MoveEndPhase", false);
    await game.toEndOfTurn();

    expect(zoroark).toHaveTakenDamage(toDmgValue(maxHp / 8));
    expect(zoroark.summonData.illusion).toBeNull();
    expect(zoroark.battleData.illusionUsed).toBe(true);
    expect(zoroark.getNameToRender()).toBe(zoroark.name);
    expect(game).toHaveShownMessage(breakMessage(zoroark));

    // The next hit is not blocked
    const hpAfterBlock = zoroark.hp;
    game.move.select(MoveId.SPLASH);
    await game.toEndOfTurn();
    expect(zoroark.hp).toBeLessThan(hpAfterBlock);
    expect(zoroark.hp).toBeGreaterThan(hpAfterBlock - toDmgValue(maxHp / 8));
  });

  it("does not trigger on a move that deals no damage or on a hit taken by its substitute", async () => {
    await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.FEEBAS);
    const zoroark = game.field.getPlayerPokemon();

    // Confusion cannot hurt the Dark-type Zoroark, whatever it looks like
    game.move.select(MoveId.SPLASH);
    await game.move.forceEnemyMove(MoveId.CONFUSION);
    await game.toEndOfTurn();
    expect(zoroark).toHaveFullHp();
    expect(zoroark.summonData.illusion).not.toBeNull();

    game.move.select(MoveId.SUBSTITUTE);
    await game.move.forceEnemyMove(MoveId.SPLASH);
    await game.toEndOfTurn();
    const hpWithSubstitute = zoroark.hp;

    game.move.select(MoveId.SPLASH);
    await game.move.forceEnemyMove(MoveId.TACKLE);
    await game.toEndOfTurn();
    expect(zoroark.hp).toBe(hpWithSubstitute);
    expect(zoroark.summonData.illusion).not.toBeNull();
    expect(zoroark.battleData.illusionUsed).toBe(false);
  });

  it("does not block a hit that ignores abilities (as Disguise), but that hit still breaks it", async () => {
    game.override.enemyAbility(AbilityId.MOLD_BREAKER);
    await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.FEEBAS);
    const zoroark = game.field.getPlayerPokemon();
    const maxHp = zoroark.getMaxHp();

    game.move.select(MoveId.SPLASH);
    await game.move.forceEnemyMove(MoveId.TACKLE);
    await game.toEndOfTurn();

    expect(zoroark.hp).toBeLessThan(maxHp);
    expect(zoroark).not.toHaveTakenDamage(toDmgValue(maxHp / 8));
    expect(zoroark.summonData.illusion).toBeNull();
    expect(zoroark.battleData.illusionUsed).toBe(true);
    expect(game).toHaveShownMessage(breakMessage(zoroark));
  });

  it("is spent for the battle: no new illusion when it comes back after the block", async () => {
    await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
    const zoroark = game.field.getPlayerPokemon();

    game.move.select(MoveId.SPLASH);
    await game.move.forceEnemyMove(MoveId.TACKLE);
    await game.toNextTurn();
    expect(zoroark.battleData.illusionUsed).toBe(true);

    game.doSwitchPokemon(1);
    await game.toNextTurn();
    expect(game.field.getPlayerPokemon()).not.toBe(zoroark);
    game.doSwitchPokemon(1); // Zoroark is now second in the party
    await game.toNextTurn();

    expect(game.field.getPlayerPokemon()).toBe(zoroark);
    expect(zoroark.summonData.illusion).toBeNull();
  });

  it("switching in keeps the illusion through the summon, and the send-out text names the copied ally", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.ZOROARK, SpeciesId.MAGIKARP);
    const zoroark = game.scene.getPlayerParty()[1];

    game.doSwitchPokemon(1);
    await game.toEndOfTurn();

    expect(game.field.getPlayerPokemon()).toBe(zoroark);
    const illusion = zoroark.summonData.illusion;
    expect(illusion).not.toBeNull();
    expect([SpeciesId.FEEBAS, SpeciesId.MAGIKARP]).toContain(illusion!.species);
    expect(game.textInterceptor.logs.some(log => log.includes(zoroark.getNameToRender()))).toBe(true);
    expect(game.textInterceptor.logs.some(log => log.includes(zoroark.name))).toBe(false);
  });

  it("switching out with the illusion still up gives a new one on the next entry", async () => {
    await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
    const zoroark = game.field.getPlayerPokemon();
    expect(zoroark.summonData.illusion).not.toBeNull();

    game.doSwitchPokemon(1);
    await game.toNextTurn();
    expect(zoroark.summonData.illusion).toBeNull(); // ended on switching out

    game.doSwitchPokemon(1);
    await game.toNextTurn();
    expect(zoroark.summonData.illusion).not.toBeNull();
    expect(zoroark.battleData.illusionUsed).toBe(false);
  });

  // Review fix (2026-11-19): `SummonPhase.start` also applies `PreSummonAbAttr` to the Pokémon a switch takes out
  it("a holder leaving the field does not roll a new illusion on its way out", async () => {
    await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
    const zoroark = game.field.getPlayerPokemon();
    zoroark.breakIllusion(); // ended without being spent (Neutralizing Gas gone, an evolution...)
    const setIllusion = vi.spyOn(zoroark, "setIllusion");

    game.doSwitchPokemon(1);
    await game.toNextTurn();

    expect(setIllusion).not.toHaveBeenCalled();
    expect(game.textInterceptor.logs).toContain(i18next.t("battle:playerComeBack", { pokemonName: zoroark.name }));
  });

  it("a fainted holder does not take a new illusion when it is replaced", async () => {
    game.override.enemyAbility(AbilityId.MOLD_BREAKER);
    await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
    const zoroark = game.field.getPlayerPokemon();
    zoroark.hp = 1;
    const setIllusion = vi.spyOn(zoroark, "setIllusion");

    game.move.select(MoveId.SPLASH);
    await game.move.forceEnemyMove(MoveId.TACKLE);
    game.doSelectPartyPokemon(1);
    await game.toNextTurn();

    expect(zoroark.isFainted()).toBe(true);
    expect(setIllusion).not.toHaveBeenCalled();
    expect(zoroark.summonData.illusion).toBeNull();
  });

  it("losing its ability ends the illusion without spending it, and the message names the holder", async () => {
    await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.FEEBAS);
    const zoroark = game.field.getPlayerPokemon();

    game.move.select(MoveId.SPLASH);
    await game.move.forceEnemyMove(MoveId.WORRY_SEED);
    await game.toEndOfTurn();

    expect(zoroark.summonData.illusion).toBeNull();
    expect(zoroark.battleData.illusionUsed).toBe(false);
    expect(game).toHaveShownMessage(breakMessage(zoroark));
    expect(game).toHaveShownMessage(
      i18next.t("moveTriggers:acquiredAbility", {
        pokemonName: zoroark.name,
        abilityName: allAbilities[AbilityId.INSOMNIA].name,
      }),
    );
  });

  it("a fainted holder gets its illusion back, and so does a new battle; the save keeps the spent state", async () => {
    await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.FEEBAS);
    const zoroark = game.field.getPlayerPokemon();

    zoroark.battleData.illusionUsed = true;
    zoroark.hp = 0;
    applyAbAttrs("PostFaintAbAttr", { pokemon: zoroark });
    expect(zoroark.battleData.illusionUsed).toBe(false);

    zoroark.battleData.illusionUsed = true;
    expect(new PokemonBattleData(zoroark.battleData).illusionUsed).toBe(true);
    expect(new PokemonBattleData(JSON.parse(JSON.stringify(zoroark.battleData))).illusionUsed).toBe(true);
    zoroark.resetBattleAndWaveData();
    expect(zoroark.battleData.illusionUsed).toBe(false);
  });
});
