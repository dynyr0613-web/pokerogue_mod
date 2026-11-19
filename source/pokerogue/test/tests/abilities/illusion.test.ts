import { Gender } from "#data/gender";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Local fork (2026-11-19): turned on again for the fork's Illusion (C10, the user: "c10 일루전의 효과를 탈 + 랜덤 아군
// 변신으로 해두기"): a random ally's look on entry and Disguise's block. A wild holder has no ally to copy, so these
// tests use the player's Zoroark (Illusion is its only ability); the fork's own cases are in
// test/tests/custom/custom-illusion-1119.test.ts.
describe("Abilities - Illusion", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH, MoveId.TACKLE]);
  });

  it("creates illusion at the start", async () => {
    await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.FEEBAS);
    const zoroark = game.field.getPlayerPokemon();

    expect(zoroark.summonData.illusion?.species).toBe(SpeciesId.FEEBAS);
  });

  it("breaks after receiving a damaging move", async () => {
    await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.FEEBAS);
    game.move.select(MoveId.SPLASH);
    await game.move.forceEnemyMove(MoveId.TACKLE);

    await game.phaseInterceptor.to("TurnEndPhase");

    const zoroark = game.field.getPlayerPokemon();

    expect(zoroark.summonData.illusion).toBeNull();
    expect(zoroark.getNameToRender()).toBe("Zoroark");
  });

  it("breaks after getting its ability changed", async () => {
    await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.FEEBAS);
    game.move.select(MoveId.SPLASH);
    await game.move.forceEnemyMove(MoveId.WORRY_SEED);

    await game.phaseInterceptor.to("TurnEndPhase");

    expect(game.field.getPlayerPokemon().summonData.illusion).toBeNull();
  });

  it("breaks when neutralizing gas comes in", async () => {
    game.override.enemyAbility(AbilityId.NEUTRALIZING_GAS);
    await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.FEEBAS);

    expect(game.field.getPlayerPokemon().summonData.illusion).toBeNull();
  });

  it("does not activate if neutralizing gas is active", async () => {
    game.override.enemyAbility(AbilityId.NEUTRALIZING_GAS);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.ZOROARK, SpeciesId.FEEBAS);

    game.doSwitchPokemon(1);
    await game.toNextTurn();

    const zoroark = game.field.getPlayerPokemon();
    expect(zoroark.species.speciesId).toBe(SpeciesId.ZOROARK);
    expect(zoroark.summonData.illusion).toBeFalsy();
  });

  // TODO: This doesn't actually check that the ai calls the function this way... useless test
  it("causes enemy AI to consider the illusion's type instead of the actual type when considering move effectiveness", async () => {
    game.override.enemyMoveset([MoveId.FLAMETHROWER, MoveId.PSYCHIC, MoveId.TACKLE]);
    await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.FERROTHORN);

    const enemy = game.field.getEnemyPokemon();
    const zoroark = game.field.getPlayerPokemon();

    const flameThrower = enemy.getMoveset()[0]!.getMove();
    const psychic = enemy.getMoveset()[1]!.getMove();
    const flameThrowerEffectiveness = zoroark.getAttackTypeEffectiveness(flameThrower.type, {
      source: enemy,
      move: flameThrower,
      useIllusion: true,
    });
    const psychicEffectiveness = zoroark.getAttackTypeEffectiveness(psychic.type, {
      source: enemy,
      move: psychic,
      useIllusion: true,
    });
    // As Ferrothorn (Grass/Steel), Flamethrower is 4x and Psychic 0.5x; the real Dark-type Zoroark is immune to Psychic
    expect(flameThrowerEffectiveness).toBeGreaterThan(psychicEffectiveness);
    expect(psychicEffectiveness).toBeGreaterThan(0);
  });

  it("should not break from indirect damage from status, weather or recoil", async () => {
    game.override.enemySpecies(SpeciesId.GIGALITH).enemyAbility(AbilityId.SAND_STREAM);

    await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.AZUMARILL);

    game.move.use(MoveId.FLARE_BLITZ);
    await game.move.forceEnemyMove(MoveId.WILL_O_WISP);
    await game.toEndOfTurn();

    const zoroark = game.field.getPlayerPokemon();
    expect(zoroark.summonData.illusion).not.toBeNull();
  });

  it("copies the name, nickname, gender and pokeball from the illusion source, in the holder's own shininess", async () => {
    await game.classicMode.startBattle(SpeciesId.ABRA, SpeciesId.ZOROARK, SpeciesId.AXEW);

    const zoroark = game.scene.getPlayerParty()[1];
    const axew = game.scene.getPlayerParty()[2];
    axew.shiny = true;
    axew.nickname = btoa(unescape(encodeURIComponent("axew nickname")));
    axew.gender = Gender.FEMALE;
    axew.pokeball = PokeballType.GREAT_BALL;
    // Abra and Axew can be copied; pick Axew
    vi.spyOn(zoroark, "randBattleSeedInt").mockReturnValueOnce(1);

    game.doSwitchPokemon(1);

    await game.phaseInterceptor.to("TurnEndPhase");

    expect(game.field.getPlayerPokemon()).toBe(zoroark);
    expect(zoroark.summonData.illusion?.name).toBe("Axew");
    expect(zoroark.getNameToRender()).toBe("axew nickname");
    expect(zoroark.getGender(false, true)).toBe(Gender.FEMALE);
    expect(zoroark.isShiny(true)).toBe(zoroark.shiny);
    expect(zoroark.getPokeball(true)).toBe(PokeballType.GREAT_BALL);
  });

  it("breaks when suppressed", async () => {
    await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.FEEBAS);
    const zoroark = game.field.getPlayerPokemon();

    expect(zoroark.summonData.illusion).not.toBeNull();

    game.move.select(MoveId.SPLASH);
    await game.move.forceEnemyMove(MoveId.GASTRO_ACID);
    await game.phaseInterceptor.to("BerryPhase");

    expect(zoroark).toHaveFullHp();
    expect(zoroark.summonData.illusion).toBeNull();
  });
});
