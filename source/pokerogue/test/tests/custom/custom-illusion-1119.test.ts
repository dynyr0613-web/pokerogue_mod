// Local fork (2026-11-19): tests of Illusion (일루전) = Disguise's effect + disguised as a random ally (C10, the user:
// "c10 일루전의 효과를 탈 + 랜덤 아군 변신으로 해두기"). On entry the holder takes the look of an ally of its own party;
// the first damaging hit is blocked for 1/8 of its max HP, as Disguise does, and the illusion wears off, spent until
// the battle ends or the holder faints (ab-attrs.ts, `IllusionPreSummonAbAttr` and `IllusionBlockDamageAbAttr`).
// Local fork (2026-11-20): the ally is picked once at the start of the battle (seeded RNG), fainted or not, and kept
// for every entry of that battle even after it faints (the user: "일루전은 전투 시작할 때 모방할 아군을 지정해서 아군들이
// 죽어도 모방하도록"; `IllusionBattleStartAbAttr`, `PokemonBattleData.illusionAllyId`).
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

  // Changed 2026-11-20: the pick now includes fainted allies and is made once per battle
  it("picks with the battle's seeded RNG among all the other party members, a fainted one included", async () => {
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
    zoroark.battleData.illusionAllyId = null; // as before the battle-start pick
    party[1].hp = 0; // Feebas fainted

    const roll = vi.spyOn(zoroark, "randBattleSeedInt").mockReturnValueOnce(0);
    applyAbAttrs("IllusionBattleStartAbAttr", { pokemon: zoroark });

    expect(roll).toHaveBeenCalledWith(4); // Feebas, Magikarp, Abra, Axew
    expect(zoroark.battleData.illusionAllyId).toBe(party[1].id);

    applyAbAttrs("PreSummonAbAttr", { pokemon: zoroark });
    expect(roll).toHaveBeenCalledTimes(1); // the entry uses the pick, no new roll
    expect(zoroark.summonData.illusion?.species).toBe(SpeciesId.FEEBAS);
    expect(zoroark.getNameToRender()).toBe(party[1].name);
  });

  it("picks its ally at the start of the battle, before it enters, and every entry of the battle uses that ally", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.ZOROARK, SpeciesId.MAGIKARP);
    const [feebas, zoroark, magikarp] = game.scene.getPlayerParty();

    // Picked at battle start while still in the party
    expect(zoroark.isOnField()).toBe(false);
    expect(zoroark.summonData.illusion).toBeNull();
    const allyId = zoroark.battleData.illusionAllyId;
    const chosen = [feebas, magikarp].find(p => p.id === allyId);
    expect(chosen, "one of the two other party members").toBeDefined();

    const roll = vi.spyOn(zoroark, "randBattleSeedInt");
    for (let entry = 0; entry < 3; entry++) {
      game.doSwitchPokemon(game.scene.getPlayerParty().indexOf(zoroark));
      await game.toNextTurn();
      expect(game.field.getPlayerPokemon()).toBe(zoroark);
      expect(zoroark.summonData.illusion?.species).toBe(chosen!.species.speciesId);
      expect(zoroark.getNameToRender()).toBe(chosen!.name);

      // Back out, to the party member it does not look like
      const other = chosen === feebas ? magikarp : feebas;
      game.doSwitchPokemon(game.scene.getPlayerParty().indexOf(other));
      await game.toNextTurn();
      expect(zoroark.summonData.illusion).toBeNull();
    }
    expect(zoroark.battleData.illusionAllyId).toBe(allyId);
    expect(roll).not.toHaveBeenCalledWith(2); // never rolled again
  });

  it("keeps copying the picked ally after it faints, also as the last Pokémon standing", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.ZOROARK, SpeciesId.MAGIKARP);
    const [feebas, zoroark, magikarp] = game.scene.getPlayerParty();
    zoroark.battleData.illusionAllyId = feebas.id; // the battle-start pick: the lead, Feebas
    magikarp.hp = 0;
    feebas.hp = 1;

    // Feebas faints; Zoroark is the only one left to send in
    game.move.select(MoveId.SPLASH);
    await game.move.forceEnemyMove(MoveId.TACKLE);
    game.doSelectPartyPokemon(1);
    await game.toNextTurn();

    expect(feebas.isFainted()).toBe(true);
    expect(game.field.getPlayerPokemon()).toBe(zoroark);
    expect(zoroark.summonData.illusion?.species).toBe(SpeciesId.FEEBAS);
    expect(zoroark.getNameToRender()).toBe(feebas.name);
    expect(zoroark.battleData.illusionAllyId).toBe(feebas.id);
  });

  it("re-enters as the same ally after its own faint and revival", async () => {
    await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
    const zoroark = game.field.getPlayerPokemon();
    const species = zoroark.summonData.illusion?.species;
    expect(species).toBeDefined();

    // Spent, fainted (the faint reset re-arms it), then revived and sent in again
    zoroark.battleData.illusionUsed = true;
    zoroark.breakIllusion();
    zoroark.hp = 0;
    applyAbAttrs("PostFaintAbAttr", { pokemon: zoroark });
    zoroark.hp = 1;
    applyAbAttrs("PreSummonAbAttr", { pokemon: zoroark });

    expect(zoroark.summonData.illusion?.species).toBe(species);
  });

  it("an ally that left the party is replaced by a new pick at the next entry", async () => {
    await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.FEEBAS);
    const zoroark = game.field.getPlayerPokemon();
    zoroark.breakIllusion();
    zoroark.battleData.illusionAllyId = 12345; // no longer in the party (fused into another, released)

    applyAbAttrs("PreSummonAbAttr", { pokemon: zoroark });

    const feebas = game.scene.getPlayerParty()[1];
    expect(zoroark.battleData.illusionAllyId).toBe(feebas.id);
    expect(zoroark.summonData.illusion?.species).toBe(SpeciesId.FEEBAS);
  });

  it("a new battle makes a new pick; a wild wave in the same biome keeps it", async () => {
    // Wave 4 stays a plain wild wave; wave 5 is still Classic's fixed trainer battle
    game.override.startingWave(3).disableTrainerWaves().mysteryEncounterChance(0);
    await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.ZOROARK, SpeciesId.MAGIKARP);
    const zoroark = game.scene.getPlayerParty()[1];
    const firstPick = zoroark.battleData.illusionAllyId;
    expect(firstPick).not.toBeNull();
    const roll = vi.spyOn(zoroark, "randBattleSeedInt");

    // Wave 4: another wild wave in the same biome, so the same battle for the player's Pokémon
    game.move.select(MoveId.SPLASH);
    await game.doKillOpponents();
    await game.toNextWave();
    expect(game.scene.currentBattle.waveIndex).toBe(4);
    expect(zoroark.battleData.illusionAllyId).toBe(firstPick);
    expect(roll).not.toHaveBeenCalledWith(2);

    // Wave 5: Classic's first trainer battle resets the battle data, and the encounter picks again
    game.move.select(MoveId.SPLASH);
    await game.doKillOpponents();
    await game.toNextWave();
    expect(game.scene.currentBattle.waveIndex).toBe(5);
    expect(game.scene.currentBattle.battleType).toBe(BattleType.TRAINER);
    expect(roll).toHaveBeenCalledWith(2);
    const party = game.scene.getPlayerParty();
    expect(party.filter(p => p !== zoroark).map(p => p.id)).toContain(zoroark.battleData.illusionAllyId);
  });

  // Review fix (2026-11-20): `NewBiomeEncounterPhase` resets the battle data a second time, after the encounter's pick
  it("a new biome keeps the pick made at its start, for the lead and a bench holder, also after a reload", async () => {
    game.override.startingWave(10).disableTrainerWaves().mysteryEncounterChance(0);
    await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.FEEBAS, SpeciesId.ZORUA, SpeciesId.MAGIKARP);

    // Wave 10 to 11 changes the biome
    game.move.select(MoveId.SPLASH);
    await game.doKillOpponents();
    await game.toNextWave();
    expect(game.phaseInterceptor.phaseLog).toContain("NewBiomeEncounterPhase");

    const [zoroark, , zorua] = game.scene.getPlayerParty();
    const leadPick = zoroark.battleData.illusionAllyId;
    const benchPick = zorua.battleData.illusionAllyId;
    expect(leadPick, "the lead keeps its pick").not.toBeNull();
    expect(benchPick, "the bench holder picked before entering").not.toBeNull();
    const leadAlly = game.scene.getPlayerParty().find(p => p.id === leadPick);
    const benchAlly = game.scene.getPlayerParty().find(p => p.id === benchPick);
    expect(zoroark.summonData.illusion?.species).toBe(leadAlly?.species.speciesId);

    // The bench holder enters as its pick, with no new roll
    const roll = vi.spyOn(zorua, "randBattleSeedInt");
    game.doSwitchPokemon(2);
    await game.toNextTurn();
    expect(game.field.getPlayerPokemon()).toBe(zorua);
    expect(zorua.summonData.illusion?.species).toBe(benchAlly?.species.speciesId);
    expect(roll).not.toHaveBeenCalled();

    // The wave-start save holds the same picks
    await game.reload.reloadSession();
    const party = game.scene.getPlayerParty();
    expect(party[0].battleData.illusionAllyId).toBe(leadPick);
    expect(party[2].battleData.illusionAllyId).toBe(benchPick);
    expect(party[0].summonData.illusion?.species).toBe(leadAlly?.species.speciesId);
  });

  it("keeps its own look with no ally to copy", async () => {
    await game.classicMode.startBattle(SpeciesId.ZOROARK);
    expect(game.field.getPlayerPokemon().summonData.illusion).toBeNull();
    expect(game.field.getPlayerPokemon().battleData.illusionAllyId).toBeNull();
  });

  it("a wild holder keeps its own look", async () => {
    game.override.enemySpecies(SpeciesId.ZORUA).enemyAbility(AbilityId.ILLUSION);
    await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.FEEBAS);
    expect(game.field.getEnemyPokemon().summonData.illusion).toBeNull();
    expect(game.field.getEnemyPokemon().battleData.illusionAllyId).toBeNull();
  });

  it("the picks survive a reload of the saved wave, for the player and an enemy trainer", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER, trainerVariant: TrainerVariant.DEFAULT })
      .startingWave(30)
      .enemyAbility(AbilityId.ILLUSION)
      .enemyLevel(50);
    await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.ZOROARK, SpeciesId.MAGIKARP);
    const playerPick = game.scene.getPlayerParty()[1].battleData.illusionAllyId;
    const enemyPicks = game.scene.getEnemyParty().map(p => p.battleData.illusionAllyId);
    expect(playerPick).not.toBeNull();
    expect(enemyPicks.every(id => id != null)).toBe(true);
    const enemyLook = game.field.getEnemyPokemon().summonData.illusion?.species;

    await game.reload.reloadSession();

    expect(game.scene.getPlayerParty()[1].battleData.illusionAllyId).toBe(playerPick);
    expect(game.scene.getEnemyParty().map(p => p.battleData.illusionAllyId)).toEqual(enemyPicks);
    expect(game.field.getEnemyPokemon().summonData.illusion?.species).toBe(enemyLook);
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

  // Changed 2026-11-20: the same ally as before, not a new random one
  it("switching out with the illusion still up gives it back, as the same ally, on the next entry", async () => {
    await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
    const zoroark = game.field.getPlayerPokemon();
    const species = zoroark.summonData.illusion?.species;
    expect(species).toBeDefined();

    game.doSwitchPokemon(1);
    await game.toNextTurn();
    expect(zoroark.summonData.illusion).toBeNull(); // ended on switching out

    game.doSwitchPokemon(1);
    await game.toNextTurn();
    expect(zoroark.summonData.illusion?.species).toBe(species);
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

  // Local fork (2026-11-20): the battle's pick is a saved number, and the faint reset keeps it
  it("the pick is kept through a faint, saved as the ally's id, and cleared for a new battle", async () => {
    await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.FEEBAS);
    const zoroark = game.field.getPlayerPokemon();
    const feebas = game.scene.getPlayerParty()[1];
    expect(zoroark.battleData.illusionAllyId).toBe(feebas.id);

    zoroark.battleData.illusionUsed = true;
    zoroark.hp = 0;
    applyAbAttrs("PostFaintAbAttr", { pokemon: zoroark });
    expect(zoroark.battleData.illusionAllyId).toBe(feebas.id);

    expect(new PokemonBattleData(JSON.parse(JSON.stringify(zoroark.battleData))).illusionAllyId).toBe(feebas.id);
    // An older save has no such field, and a damaged one is ignored: the holder picks again
    expect(new PokemonBattleData({ illusionUsed: true }).illusionAllyId).toBeNull();
    expect(new PokemonBattleData(JSON.parse('{"illusionAllyId":"x"}')).illusionAllyId).toBeNull();

    zoroark.resetBattleAndWaveData();
    expect(zoroark.battleData.illusionAllyId).toBeNull();
  });
});
