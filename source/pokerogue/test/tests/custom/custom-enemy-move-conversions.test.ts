import { pokerogueApi } from "#api/api";
import { enemyBattleFormDice, isBattleFormKey } from "#data/enemy-battle-forms";
import {
  convertEnemyMoveSlot,
  ENEMY_MOVE_CONVERSIONS,
  type EnemyMoveConversionSide,
  enemyMoveConversionDice,
  getEnemyMoveConversionChance,
  getEnemyMoveConversionOptions,
  getTrainerMoveConversionCap,
  rollTrainerMoveConversions,
  rollWildMoveConversion,
} from "#data/enemy-move-conversions";
import { catchPokemon } from "#data/mystery-encounters/utils/encounter-pokemon-utils";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";
import { isTransformedMove } from "#moves/move-transform";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

/**
 * Local fork (2026-11-18): enemy Pokémon that come with one move slot already a Z-Move or a Max Move
 * (enemy-move-conversions.ts, hooked in encounter-phase.ts; capture in attempt-capture-phase.ts and `catchPokemon`). The
 * user: "적의 기술은 그냥 낮은 확률로 적 포켓몬 기술 중 하나가 z기술/다이맥스기술 중 하나로 대체되게".
 */
describe("Custom enemy move conversions - enemy Z / Max moves", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let dice: MockInstance<(range: number) => number>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    // No enemy moveset override: it turns the conversions off (the enemies keep their generated movesets)
    game.override
      .battleStyle("single")
      .startingWave(75)
      .startingLevel(100)
      .enemyLevel(40)
      .enemyHealthSegments(1)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyHasPassiveAbility(false)
      .ability(AbilityId.BALL_FETCH)
      .hasPassiveAbility(false)
      .moveset([MoveId.SPLASH])
      .criticalHits(false)
      .mysteryEncounterChance(0);
    // No battle form unless a test asks for one (the battle-form chance is never above 80)
    vi.spyOn(enemyBattleFormDice, "roll").mockReturnValue(99);
    dice = vi.spyOn(enemyMoveConversionDice, "roll").mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const convertedSlots = (pokemon: Pokemon) => pokemon.moveset.filter(slot => slot?.transform);

  /** The pokemon's one converted slot is an attack, and the first option of `side` of its plain moveset */
  function expectFirstOption(pokemon: Pokemon, side: EnemyMoveConversionSide): void {
    expect(convertedSlots(pokemon)).toHaveLength(1);
    const slotIndex = pokemon.moveset.findIndex(m => m?.transform);
    const slot = pokemon.moveset[slotIndex];
    const transform = slot.transform!;
    expect(isTransformedMove(slot.getMove())).toBe(true);
    expect(slot.getMove().category).not.toBe(MoveCategory.STATUS);
    slot.transform = undefined;
    const options = getEnemyMoveConversionOptions(pokemon);
    slot.transform = transform;
    expect(options[side][0]).toEqual({ slotIndex, transform });
    if (side === "max") {
      expect(["max", "gmax"]).toContain(transform.kind);
    } else {
      expect(["z", "zExclusive"]).toContain(transform.kind);
    }
  }

  it("keeps its numbers in one frozen table: per Pokémon, growing with the wave, capped per trainer party", () => {
    expect(Object.isFrozen(ENEMY_MOVE_CONVERSIONS)).toBe(true);
    expect(Object.isFrozen(ENEMY_MOVE_CONVERSIONS.trainer)).toBe(true);
    expect(Object.values(ENEMY_MOVE_CONVERSIONS.trainer).every(t => Object.isFrozen(t))).toBe(true);
    expect(Object.isFrozen(ENEMY_MOVE_CONVERSIONS.wild)).toBe(true);
    expect(Object.isFrozen(ENEMY_MOVE_CONVERSIONS.wildBoss)).toBe(true);
    expect(ENEMY_MOVE_CONVERSIONS).toEqual({
      trainer: {
        ordinary: { chance: 2, step: 1, everyWaves: 100, max: 10, minWave: 50, perParty: 1 },
        elite: { chance: 4, step: 2, everyWaves: 100, max: 20, minWave: 50, perParty: 2 },
        boss: { chance: 4, step: 2, everyWaves: 100, max: 20, minWave: 50, perParty: 2 },
      },
      wild: { chance: 1, minWave: 50 },
      wildBoss: { chance: 5, step: 2, everyWaves: 100, max: 20, minWave: 50 },
      maxMovePercent: 50,
    });

    const waves = [1, 49, 50, 149, 150, 250, 750, 850, 1000, 5849];
    const curve = (battleType: BattleType, isBoss: boolean, tier?: "ordinary" | "elite" | "boss") =>
      waves.map(w => getEnemyMoveConversionChance(battleType, isBoss, w, tier));
    expect(curve(BattleType.TRAINER, false)).toEqual([0, 0, 2, 2, 3, 4, 9, 10, 10, 10]);
    expect(curve(BattleType.TRAINER, false, "ordinary")).toEqual([0, 0, 2, 2, 3, 4, 9, 10, 10, 10]);
    expect(curve(BattleType.TRAINER, false, "elite")).toEqual([0, 0, 4, 4, 6, 8, 18, 20, 20, 20]);
    expect(curve(BattleType.TRAINER, false, "boss")).toEqual([0, 0, 4, 4, 6, 8, 18, 20, 20, 20]);
    // A trainer's Pokémon with boss bars has the boss numbers whatever its trainer
    expect(curve(BattleType.TRAINER, true, "ordinary")).toEqual([0, 0, 4, 4, 6, 8, 18, 20, 20, 20]);
    expect(curve(BattleType.WILD, false)).toEqual([0, 0, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(curve(BattleType.WILD, false, "elite")).toEqual([0, 0, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(curve(BattleType.WILD, true)).toEqual([0, 0, 5, 5, 7, 9, 19, 20, 20, 20]);
    expect(curve(BattleType.MYSTERY_ENCOUNTER, true)).toEqual(waves.map(() => 0));

    expect(getTrainerMoveConversionCap("ordinary", false)).toBe(1);
    expect(getTrainerMoveConversionCap("ordinary", true)).toBe(2);
    expect(getTrainerMoveConversionCap("elite", false)).toBe(2);
    expect(getTrainerMoveConversionCap("boss", false)).toBe(2);
  });

  it("converts only to attacks: the Max side by the 다이사탕 rule (G-Max), the Z side by type or exclusive crystal", async () => {
    game.override.battleType(BattleType.WILD).enemySpecies(SpeciesId.PIKACHU);
    dice.mockReturnValue(99); // nothing at the encounter
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const pikachu = game.field.getEnemyPokemon();
    expect(convertedSlots(pikachu)).toEqual([]);

    game.move.changeMoveset(pikachu, [MoveId.SWORDS_DANCE, MoveId.VOLT_TACKLE, MoveId.QUICK_ATTACK, MoveId.PROTECT]);
    expect(getEnemyMoveConversionOptions(pikachu)).toEqual({
      max: [
        { slotIndex: 1, transform: { kind: "gmax", moveId: MoveId.G_MAX_VOLT_CRASH } },
        { slotIndex: 2, transform: { kind: "max", moveId: MoveId.MAX_STRIKE } },
      ],
      z: [
        { slotIndex: 1, transform: { kind: "zExclusive", moveId: MoveId.CATASTROPIKA } },
        { slotIndex: 2, transform: { kind: "z", moveId: MoveId.BREAKNECK_BLITZ__PHYSICAL } },
      ],
    });

    // Eevee: Eevium Z only makes Extreme Evoboost (a status move), so its Tackle takes the Normalium Z move instead;
    // its Normal attacks are G-Max Cuddle on the Max side (G-Max type rule, no signature move)
    const eevee = game.field.getPlayerPokemon();
    game.move.changeMoveset(eevee, [MoveId.TACKLE, MoveId.GROWL]);
    expect(getEnemyMoveConversionOptions(eevee)).toEqual({
      max: [{ slotIndex: 0, transform: { kind: "gmax", moveId: MoveId.G_MAX_CUDDLE } }],
      z: [{ slotIndex: 0, transform: { kind: "z", moveId: MoveId.BREAKNECK_BLITZ__PHYSICAL } }],
    });

    // Only status moves: nothing to convert, nothing drawn
    game.move.changeMoveset(pikachu, [MoveId.SWORDS_DANCE, MoveId.PROTECT, MoveId.GROWL]);
    dice.mockClear();
    expect(convertEnemyMoveSlot(pikachu)).toBeNull();
    expect(dice).not.toHaveBeenCalled();

    // Only one side possible (Thunder Wave: Catastropika, but Max Guard): that side, with no side roll
    game.move.changeMoveset(pikachu, [MoveId.THUNDER_WAVE, MoveId.SWORDS_DANCE]);
    dice.mockClear().mockReturnValue(0);
    expect(convertEnemyMoveSlot(pikachu)).toEqual({
      slotIndex: 0,
      transform: { kind: "zExclusive", moveId: MoveId.CATASTROPIKA },
    });
    expect(dice.mock.calls).toEqual([[1]]);
    // One slot per Pokémon: a converted one has no more options
    expect(getEnemyMoveConversionOptions(pikachu)).toEqual({ max: [], z: [] });

    // Both sides: half and half, then a random slot of that side
    game.move.changeMoveset(pikachu, [MoveId.SWORDS_DANCE, MoveId.VOLT_TACKLE, MoveId.QUICK_ATTACK, MoveId.PROTECT]);
    dice.mockClear().mockReturnValueOnce(50).mockReturnValueOnce(1);
    expect(convertEnemyMoveSlot(pikachu)?.transform).toEqual({ kind: "z", moveId: MoveId.BREAKNECK_BLITZ__PHYSICAL });
    expect(dice.mock.calls).toEqual([[100], [2]]);
    expect(pikachu.moveset.map(slot => slot.transform)).toEqual([
      undefined,
      undefined,
      { kind: "z", moveId: MoveId.BREAKNECK_BLITZ__PHYSICAL },
      undefined,
    ]);

    game.move.changeMoveset(pikachu, [MoveId.SWORDS_DANCE, MoveId.VOLT_TACKLE, MoveId.QUICK_ATTACK, MoveId.PROTECT]);
    dice.mockClear().mockReturnValue(0);
    expect(convertEnemyMoveSlot(pikachu)?.transform).toEqual({ kind: "gmax", moveId: MoveId.G_MAX_VOLT_CRASH });
    // ...and the enemy fights with it
    game.move.changeMoveset(eevee, [MoveId.SPLASH]);
    game.move.select(MoveId.SPLASH);
    await game.move.selectEnemyMove(MoveId.VOLT_TACKLE);
    await game.phaseInterceptor.to("TurnEndPhase");
    expect(pikachu).toHaveUsedMove({ move: MoveId.VOLT_TACKLE, derivedMoveId: MoveId.G_MAX_VOLT_CRASH });
  });

  it("gives a wild enemy one converted attack slot when forced (Max side), which it uses", async () => {
    game.override.battleType(BattleType.WILD).enemySpecies(SpeciesId.MACHAMP);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);

    const enemy = game.field.getEnemyPokemon();
    // The chance roll, the side roll, the slot roll
    expect(dice.mock.calls.map(([range]) => range).slice(0, 2)).toEqual([100, 100]);
    expect(dice).toHaveBeenCalledTimes(3);
    expectFirstOption(enemy, "max");

    const [slot] = convertedSlots(enemy);
    game.move.select(MoveId.SPLASH);
    await game.move.selectEnemyMove(slot.moveId);
    await game.phaseInterceptor.to("TurnEndPhase");
    expect(enemy).toHaveUsedMove({ move: slot.moveId, derivedMoveId: slot.transform!.moveId });
  });

  it("can give the Z side instead (a type Z move, or an exclusive one)", async () => {
    game.override.battleType(BattleType.WILD).enemySpecies(SpeciesId.MACHAMP);
    dice.mockReturnValueOnce(0).mockReturnValueOnce(99).mockReturnValue(0);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);

    expectFirstOption(game.field.getEnemyPokemon(), "z");
  });

  it("rolls nothing past the chance: a failed roll leaves every slot plain", async () => {
    game.override.battleType(BattleType.WILD).enemySpecies(SpeciesId.MACHAMP);
    dice.mockReturnValue(1); // the wild chance on wave 75 is 1%: 1 >= 1 fails
    await game.classicMode.startBattle(SpeciesId.BLISSEY);

    expect(dice).toHaveBeenCalledTimes(1);
    expect(convertedSlots(game.field.getEnemyPokemon())).toEqual([]);
  });

  it("converts at most one Pokémon of an ordinary trainer's party when forced, one slot", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.VETERAN, trainerVariant: TrainerVariant.DEFAULT })
      .enemySpecies(SpeciesId.MACHAMP);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);

    const party = game.scene.getEnemyParty();
    expect(party.length).toBeGreaterThan(1);
    expect(party.map(p => convertedSlots(p).length)).toEqual(party.map((_, i) => (i === 0 ? 1 : 0)));
    expectFirstOption(party[0], "max");
  });

  it("converts two Pokémon of an elite trainer's party when forced, each one slot", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER, trainerVariant: TrainerVariant.DEFAULT })
      .enemySpecies(SpeciesId.MACHAMP);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);

    const party = game.scene.getEnemyParty();
    expect(party.length).toBeGreaterThan(2);
    expect(party.map(p => convertedSlots(p).length)).toEqual(party.map((_, i) => (i < 2 ? 1 : 0)));
    expectFirstOption(party[0], "max");
    expectFirstOption(party[1], "max");
  });

  it("converts after the battle forms: a Mega made by the battle-form roll keeps its converted slot", async () => {
    vi.spyOn(enemyBattleFormDice, "roll").mockReturnValue(0);
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER, trainerVariant: TrainerVariant.DEFAULT })
      .enemySpecies(SpeciesId.CHARIZARD);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);

    const mega = game.scene.getEnemyParty()[0];
    expect(isBattleFormKey(mega.getFormKey())).toBe(true);
    expectFirstOption(mega, "max");
  });

  it("converts after a wild battle form too", async () => {
    vi.spyOn(enemyBattleFormDice, "roll").mockReturnValue(0);
    game.override.battleType(BattleType.WILD).enemySpecies(SpeciesId.CHARIZARD);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);

    const enemy = game.field.getEnemyPokemon();
    expect(isBattleFormKey(enemy.getFormKey())).toBe(true);
    expectFirstOption(enemy, "max");
  });

  it("never converts while the enemy moveset override is set", async () => {
    game.override.battleType(BattleType.WILD).enemySpecies(SpeciesId.MACHAMP).enemyMoveset([MoveId.TACKLE]);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);

    expect(dice).not.toHaveBeenCalled();
    expect(convertedSlots(game.field.getEnemyPokemon())).toEqual([]);
  });

  it("never converts the Classic final boss", async () => {
    game.override.startingWave(200);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);

    expect(game.scene.currentBattle.isClassicFinalBoss).toBe(true);
    expect(dice).not.toHaveBeenCalled();
    expect(convertedSlots(game.field.getEnemyPokemon())).toEqual([]);
  });

  it("never converts the Daily final boss", async () => {
    vi.spyOn(pokerogueApi.daily, "getSeed").mockResolvedValue("test-seed");
    game.override.startingWave(50).startingBiome(BiomeId.END);
    await game.runToFinalBossEncounter([SpeciesId.BLISSEY], GameModes.DAILY);

    const { currentBattle, gameMode } = game.scene;
    expect(gameMode.isDaily).toBe(true);
    expect(gameMode.isWaveFinal(currentBattle.waveIndex)).toBe(true);
    // Its difficulty wave has a chance, so only the final-boss rule keeps it plain
    const difficultyWave = gameMode.getWaveForDifficulty(currentBattle.waveIndex);
    expect(getEnemyMoveConversionChance(BattleType.WILD, true, difficultyWave)).toBeGreaterThan(0);
    expect(dice).not.toHaveBeenCalled();
    expect(convertedSlots(game.field.getEnemyPokemon())).toEqual([]);
  });

  it("never rolls in a mystery-encounter battle or for the Daily final boss (unit)", async () => {
    game.override.battleType(BattleType.WILD).enemySpecies(SpeciesId.MACHAMP);
    dice.mockReturnValue(99);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const enemy = game.field.getEnemyPokemon() as EnemyPokemon;
    dice.mockClear().mockReturnValue(0);

    const battle = game.scene.currentBattle;
    const isMe = vi.spyOn(battle, "isBattleMysteryEncounter").mockReturnValue(true);
    expect(rollWildMoveConversion(enemy, 0)).toBe(false);
    // (the trainer side is checked in a trainer battle below: here it would return [] for having no trainer)
    isMe.mockRestore();

    const { gameMode } = game.scene;
    const wasDaily = gameMode.isDaily;
    gameMode.isDaily = true;
    vi.spyOn(gameMode, "isWaveFinal").mockReturnValue(true);
    try {
      expect(rollWildMoveConversion(enemy, 0)).toBe(false);
    } finally {
      gameMode.isDaily = wasDaily;
    }
    expect(dice).not.toHaveBeenCalled();
    expect(convertedSlots(enemy)).toEqual([]);

    // The same battle without them rolls (a forced hit converts a slot)
    vi.mocked(gameMode.isWaveFinal).mockRestore();
    expect(rollWildMoveConversion(enemy, 0)).toBe(true);
    expect(convertedSlots(enemy)).toHaveLength(1);
  });

  // Local fork (2026-11-18), review fix: the trainer side of the gate, in a trainer battle (in a wild battle
  // rollTrainerMoveConversions returns [] for having no trainer, gate or not)
  it("never rolls a trainer's party in a mystery-encounter battle (unit)", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.VETERAN, trainerVariant: TrainerVariant.DEFAULT })
      .enemySpecies(SpeciesId.MACHAMP);
    dice.mockReturnValue(99);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const party = game.scene.getEnemyParty();
    expect(game.scene.currentBattle.trainer).toBeDefined();
    expect(party.flatMap(convertedSlots)).toEqual([]);
    dice.mockClear().mockReturnValue(0);

    const isMe = vi.spyOn(game.scene.currentBattle, "isBattleMysteryEncounter").mockReturnValue(true);
    expect(rollTrainerMoveConversions(party)).toEqual([]);
    expect(dice).not.toHaveBeenCalled();
    expect(party.flatMap(convertedSlots)).toEqual([]);

    // The same battle without it rolls (a forced hit converts the first member, the ordinary trainer's cap of 1)
    isMe.mockRestore();
    expect(rollTrainerMoveConversions(party)).toEqual([party[0]]);
    expect(party.map(p => convertedSlots(p).length)).toEqual(party.map((_, i) => (i === 0 ? 1 : 0)));
  });

  it("gives a caught enemy back with plain moves (a thrown ball)", async () => {
    // No player moveset override: it would rewrite the caught Pokémon's first slot
    game.override.battleType(BattleType.WILD).enemySpecies(SpeciesId.MACHAMP).moveset([]);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const enemy = game.field.getEnemyPokemon();
    const moveIds = enemy.moveset.map(slot => slot.moveId);
    expect(convertedSlots(enemy)).toHaveLength(1);

    const partySize = game.scene.getPlayerParty().length;
    game.scene.pokeballCounts[PokeballType.MASTER_BALL] = 1;
    game.doThrowPokeball(PokeballType.MASTER_BALL);
    await game.phaseInterceptor.to("TurnEndPhase");
    const party = game.scene.getPlayerParty();
    expect(party).toHaveLength(partySize + 1);
    const caught = party.at(-1)!;
    expect(caught.id).toBe(enemy.id);
    expect(caught.moveset.map(slot => slot.moveId)).toEqual(moveIds);
    expect(convertedSlots(caught)).toEqual([]);
    expect(caught.moveset.every(slot => !isTransformedMove(slot.getMove()))).toBe(true);
  });

  it("gives a Pokémon caught by a mystery encounter back with plain moves (catchPokemon)", async () => {
    // No player moveset override: it would rewrite the caught Pokémon's first slot
    game.override.battleType(BattleType.WILD).enemySpecies(SpeciesId.MACHAMP).moveset([]);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const enemy = game.field.getEnemyPokemon() as EnemyPokemon;
    const moveIds = enemy.moveset.map(slot => slot.moveId);
    expect(convertedSlots(enemy)).toHaveLength(1);

    const partySize = game.scene.getPlayerParty().length;
    await catchPokemon(enemy, null, PokeballType.POKEBALL, false);
    const party = game.scene.getPlayerParty();
    expect(party).toHaveLength(partySize + 1);
    const caught = party.at(-1)!;
    expect(caught.id).toBe(enemy.id);
    expect(caught.moveset.map(slot => slot.moveId)).toEqual(moveIds);
    expect(convertedSlots(caught)).toEqual([]);
  });

  it("keeps the converted slot through a session save and reload, rolling nothing again", async () => {
    game.override.battleType(BattleType.WILD).enemySpecies(SpeciesId.MACHAMP);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const enemy = game.field.getEnemyPokemon();
    const transforms = enemy.moveset.map(slot => slot.transform);
    expect(transforms.filter(t => t)).toHaveLength(1);
    const convertedIndex = transforms.findIndex(t => t);
    const derivedId = enemy.moveset[convertedIndex].getMove().id;

    dice.mockClear();
    await game.reload.reloadSession();
    const loaded = game.field.getEnemyPokemon();
    expect(loaded).not.toBe(enemy);
    expect(dice).not.toHaveBeenCalled();
    expect(loaded.moveset.map(slot => slot.transform)).toEqual(transforms);
    expect(loaded.moveset[convertedIndex].getMove().id).toBe(derivedId);
    expect(loaded.moveset[convertedIndex].getMove().category).not.toBe(MoveCategory.STATUS);
  });
});
