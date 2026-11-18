import { pokerogueApi } from "#api/api";
import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { ALPHA_SPRITE_SCALE, MINI_SPRITE_SCALE } from "#data/alpha-pokemon";
import { enemyBattleFormDice, getBattleFormOptions } from "#data/enemy-battle-forms";
import {
  canTakeEnemyDynamax,
  ENEMY_DYNAMAX,
  enemyDynamaxDice,
  getEnemyDynamaxChance,
  getTrainerDynamaxOrder,
  getTrainerDynamaxRule,
  giveEnemyDynamax,
  prepareEnemyDynamaxCapture,
  rollTrainerDynamax,
  rollWildDynamax,
} from "#data/enemy-dynamax";
import { enemyMoveConversionDice } from "#data/enemy-move-conversions";
import { catchPokemon } from "#data/mystery-encounters/utils/encounter-pokemon-utils";
import { DYNAMAX_HP_MULTIPLIER, DYNAMAX_SPRITE_SCALE } from "#data/pokemon-forms-dynamax";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { FormChangeItem } from "#enums/form-change-item";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { PokeballType } from "#enums/pokeball";
import { PokemonMark } from "#enums/pokemon-mark";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { UiMode } from "#enums/ui-mode";
import { EnemyPokemon, type Pokemon } from "#field/pokemon";
import { PokemonFormChangeItemModifier, PokemonHeldItemModifier } from "#modifiers/modifier";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import { getEndlessBossHpMultiplier } from "#trainers/endless-boss-bars";
import { isTeraBlockedForm } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

/**
 * Local fork (2026-11-18): enemy Pokémon in the Dynamax state (enemy-dynamax.ts, hooked in encounter-phase.ts; the
 * state in pokemon-forms-dynamax.ts; capture in attempt-capture-phase.ts and `catchPokemon`). The user: "적 다이맥스
 * 상태 넣고".
 */
describe("Custom enemy Dynamax - enemies in the Dynamax state", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let dice: MockInstance<(range: number) => number>;
  let formDice: MockInstance<(range: number) => number>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingWave(75)
      .startingLevel(100)
      .enemyLevel(40)
      .enemyHealthSegments(1)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyHasPassiveAbility(false)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .hasPassiveAbility(false)
      .moveset([MoveId.SPLASH])
      .criticalHits(false)
      .mysteryEncounterChance(0);
    // The mushrooms are an enemy item: keep them (the helper takes every enemy item away by default)
    game.override.removeEnemyStartingItems = false;
    // No battle form and no move conversion unless a test asks for one
    formDice = vi.spyOn(enemyBattleFormDice, "roll").mockReturnValue(99);
    vi.spyOn(enemyMoveConversionDice, "roll").mockReturnValue(99);
    dice = vi.spyOn(enemyDynamaxDice, "roll").mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The Max Mushrooms the enemy `pokemon` holds */
  const mushroomsOf = (pokemon: Pokemon) =>
    game.scene.findModifiers(
      m =>
        m instanceof PokemonFormChangeItemModifier
        && m.pokemonId === pokemon.id
        && m.formChangeItem === FormChangeItem.MAX_MUSHROOMS,
      pokemon.isPlayer(),
    ) as PokemonFormChangeItemModifier[];
  /** The form-change items `pokemon` holds */
  const formItemsOf = (pokemon: Pokemon) =>
    (
      game.scene.findModifiers(
        m => m instanceof PokemonFormChangeItemModifier && m.pokemonId === pokemon.id,
        pokemon.isPlayer(),
      ) as PokemonFormChangeItemModifier[]
    ).map(m => m.formChangeItem);

  /** The scale of `pokemon` outside the state: an alpha's or a Mini Mark's (wild Pokémon roll them) */
  function ownScale(pokemon: Pokemon): number {
    if (pokemon.alphaBoost > 0) {
      return ALPHA_SPRITE_SCALE;
    }
    return pokemon.hasMark(PokemonMark.MINI_MARK) ? MINI_SPRITE_SCALE : 1;
  }

  /** The max HP of the enemy `pokemon` without its mushrooms (taken off and put back; its full HP stays full) */
  function maxHpWithoutState(pokemon: Pokemon): number {
    const [mushrooms] = mushroomsOf(pokemon);
    const enemyModifiers = game.scene["enemyModifiers"];
    const index = enemyModifiers.indexOf(mushrooms);
    enemyModifiers.splice(index, 1);
    pokemon.calculateStats();
    const without = pokemon.getMaxHp();
    enemyModifiers.splice(index, 0, mushrooms);
    pokemon.calculateStats();
    return without;
  }

  /** `pokemon` is in the Dynamax state from the roll: same form, the mushrooms, full HP at x1.5, drawn x1.5 */
  function expectDynamaxed(pokemon: Pokemon): void {
    expect(pokemon.hasDynamaxState()).toBe(true);
    expect(pokemon.isDynamaxed()).toBe(true);
    expect(pokemon.isMax()).toBe(false);
    expect(mushroomsOf(pokemon).map(m => [m.active, m.isTransferable, m.type.id])).toEqual([
      [true, false, "RARE_FORM_CHANGE_ITEM"],
    ]);
    const maxHp = pokemon.getMaxHp();
    expect(pokemon.hp).toBe(maxHp);
    expect(maxHp).toBe(Math.floor(maxHpWithoutState(pokemon) * DYNAMAX_HP_MULTIPLIER));
    expect([pokemon.getMaxHp(), pokemon.hp]).toEqual([maxHp, maxHp]);
    expect(pokemon.getSpriteScale()).toBeCloseTo(DYNAMAX_SPRITE_SCALE * ownScale(pokemon));
  }

  function expectPlain(pokemon: Pokemon): void {
    expect(pokemon.hasDynamaxState()).toBe(false);
    expect(mushroomsOf(pokemon)).toEqual([]);
  }

  it("keeps its numbers in one frozen table: per trainer battle / wild Pokémon, growing with the wave, the ace", () => {
    expect(Object.isFrozen(ENEMY_DYNAMAX)).toBe(true);
    expect(Object.isFrozen(ENEMY_DYNAMAX.trainer)).toBe(true);
    expect(Object.values(ENEMY_DYNAMAX.trainer).every(t => Object.isFrozen(t))).toBe(true);
    expect(Object.isFrozen(ENEMY_DYNAMAX.wild)).toBe(true);
    expect(Object.isFrozen(ENEMY_DYNAMAX.wildBoss)).toBe(true);
    expect(ENEMY_DYNAMAX).toEqual({
      trainer: {
        ordinary: { chance: 3, step: 2, everyWaves: 100, max: 20, minWave: 50, perParty: 1, aceFirst: true },
        elite: { chance: 8, step: 4, everyWaves: 100, max: 40, minWave: 50, perParty: 1, aceFirst: true },
        boss: { chance: 8, step: 4, everyWaves: 100, max: 40, minWave: 50, perParty: 1, aceFirst: true },
      },
      wild: { chance: 1, minWave: 50 },
      wildBoss: { chance: 5, step: 2, everyWaves: 100, max: 20, minWave: 50 },
    });

    const waves = [1, 49, 50, 149, 150, 250, 750, 850, 950, 1000, 5849];
    const curve = (battleType: BattleType, isBoss: boolean, tier?: "ordinary" | "elite" | "boss") =>
      waves.map(w => getEnemyDynamaxChance(battleType, isBoss, w, tier));
    expect(curve(BattleType.TRAINER, false)).toEqual([0, 0, 3, 3, 5, 7, 17, 19, 20, 20, 20]);
    expect(curve(BattleType.TRAINER, false, "ordinary")).toEqual([0, 0, 3, 3, 5, 7, 17, 19, 20, 20, 20]);
    expect(curve(BattleType.TRAINER, false, "elite")).toEqual([0, 0, 8, 8, 12, 16, 36, 40, 40, 40, 40]);
    expect(curve(BattleType.TRAINER, false, "boss")).toEqual([0, 0, 8, 8, 12, 16, 36, 40, 40, 40, 40]);
    // A trainer's Pokémon with boss bars has the boss numbers whatever its trainer
    expect(curve(BattleType.TRAINER, true, "ordinary")).toEqual([0, 0, 8, 8, 12, 16, 36, 40, 40, 40, 40]);
    expect(curve(BattleType.WILD, false)).toEqual([0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(curve(BattleType.WILD, false, "elite")).toEqual([0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(curve(BattleType.WILD, true)).toEqual([0, 0, 5, 5, 7, 9, 19, 20, 20, 20, 20]);
    expect(curve(BattleType.MYSTERY_ENCOUNTER, true)).toEqual(waves.map(() => 0));

    expect(getTrainerDynamaxRule("ordinary", false)).toEqual({ perParty: 1, aceFirst: true });
    expect(getTrainerDynamaxRule("ordinary", true)).toEqual({ perParty: 1, aceFirst: true });
    expect(getTrainerDynamaxRule("elite", false)).toEqual({ perParty: 1, aceFirst: true });
    expect(getTrainerDynamaxRule("boss", false)).toEqual({ perParty: 1, aceFirst: true });

    // From the ace down: the most boss bars, the highest level, the later slot; else party order
    const party = [
      { level: 10, bossSegments: 0 },
      { level: 12, bossSegments: 0 },
      { level: 12, bossSegments: 0 },
      { level: 11, bossSegments: 0 },
    ] as EnemyPokemon[];
    expect(getTrainerDynamaxOrder(party, true)).toEqual([party[2], party[1], party[3], party[0]]);
    expect(getTrainerDynamaxOrder(party, false)).toEqual(party);
    const bossParty = [{ level: 13, bossSegments: 2 }, { level: 12, bossSegments: 3 }, { level: 14 }] as EnemyPokemon[];
    expect(getTrainerDynamaxOrder(bossParty, true)).toEqual([bossParty[1], bossParty[0], bossParty[2]]);
  });

  it("puts a wild Pokémon in the Dynamax state when forced: its form stays (a G-Max species' too), HP x1.5 full", async () => {
    game.override.battleType(BattleType.WILD).enemySpecies(SpeciesId.MACHAMP);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);

    const enemy = game.field.getEnemyPokemon();
    // One roll: the chance
    expect(dice.mock.calls).toEqual([[100]]);
    expectDynamaxed(enemy);
    // Machamp has a G-Max form; an enemy's mushrooms never take it there
    expect(enemy.formIndex).toBe(0);
    expect(enemy.getFormKey()).toBe("");
    expect(formItemsOf(enemy)).toEqual([FormChangeItem.MAX_MUSHROOMS]);
    // The state is no blocked form for the enemy's Tera rules
    expect(isTeraBlockedForm(enemy)).toBe(false);

    // ...and it fights in it: Splash on both sides, nothing changes
    const maxHp = enemy.getMaxHp();
    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();
    expect(enemy.hasDynamaxState()).toBe(true);
    expect([enemy.getMaxHp(), enemy.hp]).toEqual([maxHp, maxHp]);
  });

  it("rolls nothing past the chance: a failed roll leaves the wild Pokémon as it is", async () => {
    game.override.battleType(BattleType.WILD).enemySpecies(SpeciesId.MACHAMP);
    dice.mockReturnValue(1); // the wild chance on wave 75 is 1%: 1 >= 1 fails
    await game.classicMode.startBattle(SpeciesId.BLISSEY);

    expect(dice.mock.calls).toEqual([[100]]);
    expectPlain(game.field.getEnemyPokemon());
  });

  it("keeps a wild boss's bars: the same segments over the larger max HP", async () => {
    game.override.battleType(BattleType.WILD).enemySpecies(SpeciesId.SNORLAX).enemyHealthSegments(3);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);

    const enemy = game.field.getEnemyPokemon();
    expect(enemy.isBoss()).toBe(true);
    expectDynamaxed(enemy);
    expect([enemy.bossSegments, enemy.bossSegmentIndex]).toEqual([3, 2]);
  });

  it("dynamaxes at most one Pokémon of an ordinary trainer's party, its ace, with one roll per battle", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.VETERAN, trainerVariant: TrainerVariant.DEFAULT })
      .enemySpecies(SpeciesId.MACHAMP);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);

    const party = game.scene.getEnemyParty();
    expect(party.length).toBeGreaterThan(1);
    // One roll for the whole battle (2026-11-18: the table's numbers are per battle)
    expect(dice.mock.calls).toEqual([[100]]);
    const [ace] = getTrainerDynamaxOrder(party, true);
    expect(party.filter(p => p.hasDynamaxState())).toEqual([ace]);
    expectDynamaxed(ace);
    for (const p of party.filter(p => p !== ace)) {
      expectPlain(p);
    }
  });

  it("dynamaxes an elite trainer's ace with one roll per battle; a failed roll gives it to nobody", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER, trainerVariant: TrainerVariant.DEFAULT })
      .enemySpecies(SpeciesId.MACHAMP);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);

    const party = game.scene.getEnemyParty();
    expect(party.length).toBeGreaterThan(2);
    const order = getTrainerDynamaxOrder(party, true);
    const ace = order[0];
    expect(ace.level).toBe(Math.max(...party.map(p => p.level)));
    expect(dice.mock.calls).toEqual([[100]]);
    expect(party.filter(p => p.hasDynamaxState())).toEqual([ace]);
    expectDynamaxed(ace);

    // Taken off again (as at a capture), the party rolls once more: a failed roll gives it to nobody (one roll per
    // battle, not one per member)
    prepareEnemyDynamaxCapture(ace);
    expectPlain(ace);
    dice.mockClear().mockReturnValue(99);
    expect(rollTrainerDynamax(party)).toEqual([]);
    expect(dice.mock.calls).toEqual([[100]]);
    expect(party.some(p => p.hasDynamaxState())).toBe(false);
    // A hit goes to the ace again
    dice.mockClear().mockReturnValue(0);
    expect(rollTrainerDynamax(party)).toEqual([ace]);
  });

  it("dynamaxes a boss trainer's (gym leader's) ace", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.BROCK, trainerVariant: TrainerVariant.DEFAULT });
    await game.classicMode.startBattle(SpeciesId.BLISSEY);

    const party = game.scene.getEnemyParty();
    const [ace] = getTrainerDynamaxOrder(party, true);
    expect(ace.level).toBe(Math.max(...party.map(p => p.level)));
    expect(dice.mock.calls).toEqual([[100]]);
    expect(party.filter(p => p.hasDynamaxState())).toEqual([ace]);
    expectDynamaxed(ace);
  });

  it("lets a Mega enemy take it too (Mega + Dynamax), holding its stone and the mushrooms", async () => {
    formDice.mockReturnValue(0); // the battle-form roll hits and takes the first form: Mega Charizard Z
    game.override.battleType(BattleType.WILD).enemySpecies(SpeciesId.CHARIZARD);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);

    const enemy = game.field.getEnemyPokemon();
    expect(enemy.getFormKey()).toBe(SpeciesFormKey.MEGA_Z);
    expect(enemy.isMega()).toBe(true);
    expectDynamaxed(enemy);
    expect(formItemsOf(enemy).sort()).toEqual([FormChangeItem.CHARIZARDITE_Z, FormChangeItem.MAX_MUSHROOMS].sort());
    // The enemy's Tera rules stay: a Mega one still does not Terastallize
    expect(isTeraBlockedForm(enemy)).toBe(true);
  });

  it("never rolls for a G-Max enemy: it holds its form's mushrooms and is not in the state", async () => {
    // The battle-form roll hits and takes the last form: G-Max Charizard
    formDice.mockImplementation(range => (range === 100 ? 0 : range - 1));
    game.override.battleType(BattleType.WILD).enemySpecies(SpeciesId.CHARIZARD);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);

    const enemy = game.field.getEnemyPokemon();
    expect(enemy.getFormKey()).toBe(SpeciesFormKey.GIGANTAMAX);
    expect(dice).not.toHaveBeenCalled();
    expect(enemy.hasDynamaxState()).toBe(false);
    expect(enemy.isDynamaxed()).toBe(true);
    expect(formItemsOf(enemy)).toEqual([FormChangeItem.MAX_MUSHROOMS]);
    expect(canTakeEnemyDynamax(enemy)).toBe(false);
    expect(giveEnemyDynamax(enemy)).toBe(false);
    expect(formItemsOf(enemy)).toEqual([FormChangeItem.MAX_MUSHROOMS]);
  });

  it("never takes Eternatus (head or tail), a holder of mushrooms or a player's Pokémon", async () => {
    game.override.battleType(BattleType.WILD).enemySpecies(SpeciesId.SNORLAX);
    dice.mockReturnValue(99);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const enemy = game.field.getEnemyPokemon() as EnemyPokemon;
    expectPlain(enemy);
    expect(canTakeEnemyDynamax(enemy)).toBe(true);
    expect(canTakeEnemyDynamax(game.field.getPlayerPokemon())).toBe(false);

    const eternatusSpecies = speciesDataRegistry.getSpecies(SpeciesId.ETERNATUS);
    const eternatus = new EnemyPokemon(eternatusSpecies, 80, TrainerSlot.NONE, false);
    expect(canTakeEnemyDynamax(eternatus)).toBe(false);
    eternatus.destroy();

    enemy.fusionSpecies = eternatusSpecies;
    enemy.fusionFormIndex = 0;
    expect(canTakeEnemyDynamax(enemy)).toBe(false);
    expect(giveEnemyDynamax(enemy)).toBe(false);
    enemy.fusionSpecies = null;
    expectPlain(enemy);

    // A fusion is no obstacle otherwise; once in the state it takes no second mushrooms
    expect(giveEnemyDynamax(enemy)).toBe(true);
    expect(canTakeEnemyDynamax(enemy)).toBe(false);
    expect(giveEnemyDynamax(enemy)).toBe(false);
    expect(mushroomsOf(enemy)).toHaveLength(1);
  });

  it("never rolls the Classic final boss", async () => {
    game.override.startingWave(200);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);

    expect(game.scene.currentBattle.isClassicFinalBoss).toBe(true);
    expect(dice).not.toHaveBeenCalled();
    expect(game.field.getEnemyPokemon().hasDynamaxState()).toBe(false);
  });

  it("never rolls the Daily final boss", async () => {
    vi.spyOn(pokerogueApi.daily, "getSeed").mockResolvedValue("test-seed");
    game.override.startingWave(50).startingBiome(BiomeId.END);
    await game.runToFinalBossEncounter([SpeciesId.BLISSEY], GameModes.DAILY);

    const { currentBattle, gameMode } = game.scene;
    expect(gameMode.isDaily).toBe(true);
    expect(gameMode.isWaveFinal(currentBattle.waveIndex)).toBe(true);
    // Its difficulty wave has a chance, so only the final-boss rule keeps it out
    const difficultyWave = gameMode.getWaveForDifficulty(currentBattle.waveIndex);
    expect(getEnemyDynamaxChance(BattleType.WILD, true, difficultyWave)).toBeGreaterThan(0);
    expect(dice).not.toHaveBeenCalled();
    expect(game.field.getEnemyPokemon().hasDynamaxState()).toBe(false);
  });

  it("never rolls in a mystery-encounter battle (wild and trainer, unit)", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.VETERAN, trainerVariant: TrainerVariant.DEFAULT })
      .enemySpecies(SpeciesId.MACHAMP);
    dice.mockReturnValue(99);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const party = game.scene.getEnemyParty();
    expect(party.some(p => p.hasDynamaxState())).toBe(false);
    dice.mockClear().mockReturnValue(0);

    const isMe = vi.spyOn(game.scene.currentBattle, "isBattleMysteryEncounter").mockReturnValue(true);
    expect(rollTrainerDynamax(party)).toEqual([]);
    expect(rollWildDynamax(party[0], 0)).toBe(false);
    expect(dice).not.toHaveBeenCalled();
    expect(party.some(p => p.hasDynamaxState())).toBe(false);

    // The same battle without it rolls (a forced hit: the ace, the ordinary trainer's cap of 1)
    isMe.mockRestore();
    const [ace] = getTrainerDynamaxOrder(party, true);
    expect(rollTrainerDynamax(party)).toEqual([ace]);
    expect(party.filter(p => p.hasDynamaxState())).toEqual([ace]);
  });

  it("keeps the state through a session save and reload, rolling nothing again", async () => {
    game.override.battleType(BattleType.WILD).enemySpecies(SpeciesId.MACHAMP);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const enemy = game.field.getEnemyPokemon();
    expectDynamaxed(enemy);
    const saved = { id: enemy.id, maxHp: enemy.getMaxHp(), hp: enemy.hp, scale: enemy.getSpriteScale() };

    dice.mockClear();
    await game.reload.reloadSession();
    const loaded = game.field.getEnemyPokemon();
    expect(loaded).not.toBe(enemy);
    expect(dice).not.toHaveBeenCalled();
    expect(loaded.id).toBe(saved.id);
    expect(loaded.hasDynamaxState()).toBe(true);
    expect(mushroomsOf(loaded)).toHaveLength(1);
    expect([loaded.getMaxHp(), loaded.hp]).toEqual([saved.maxHp, saved.hp]);
    expect(loaded.getSpriteScale()).toBeCloseTo(saved.scale);
    loaded.calculateStats();
    expect([loaded.getMaxHp(), loaded.hp]).toEqual([saved.maxHp, saved.hp]);
  });

  /** Throws a Master Ball at the enemy and returns the caught Pokémon (the last party member) */
  async function catchEnemy(): Promise<Pokemon> {
    const partySize = game.scene.getPlayerParty().length;
    game.scene.pokeballCounts[PokeballType.MASTER_BALL] = 1;
    game.doThrowPokeball(PokeballType.MASTER_BALL);
    await game.phaseInterceptor.to("TurnEndPhase");
    const party = game.scene.getPlayerParty();
    expect(party).toHaveLength(partySize + 1);
    return party.at(-1)!;
  }

  it("gives a caught enemy without the mushrooms and without the x1.5 HP, its HP in proportion (a thrown ball)", async () => {
    game.override.battleType(BattleType.WILD).enemySpecies(SpeciesId.MACHAMP);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const enemy = game.field.getEnemyPokemon();
    expectDynamaxed(enemy);
    const withState = enemy.getMaxHp();
    const without = maxHpWithoutState(enemy);
    enemy.hp = Math.floor(withState * 0.6);
    const hp = enemy.hp;
    const scale = ownScale(enemy);

    const caught = await catchEnemy();
    expect(caught.id).toBe(enemy.id);
    expect(formItemsOf(caught)).toEqual([]);
    expect(caught.hasDynamaxState()).toBe(false);
    expect(caught.isDynamaxed()).toBe(false);
    expect(caught.getMaxHp()).toBe(without);
    expect(caught.hp).toBe(Math.round((hp * without) / withState));
    expect(caught.getSpriteScale()).toBeCloseTo(scale);
  });

  it("gives a Pokémon caught by a mystery encounter without them too (catchPokemon)", async () => {
    game.override.battleType(BattleType.WILD).enemySpecies(SpeciesId.MACHAMP);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const enemy = game.field.getEnemyPokemon() as EnemyPokemon;
    expectDynamaxed(enemy);
    const without = maxHpWithoutState(enemy);

    const partySize = game.scene.getPlayerParty().length;
    await catchPokemon(enemy, null, PokeballType.POKEBALL, false);
    const party = game.scene.getPlayerParty();
    expect(party).toHaveLength(partySize + 1);
    const caught = party.at(-1)!;
    expect(caught.id).toBe(enemy.id);
    expect(formItemsOf(caught)).toEqual([]);
    expect(caught.hasDynamaxState()).toBe(false);
    expect([caught.getMaxHp(), caught.hp]).toEqual([without, without]);
  });

  /** The held items of `pokemon` that sit in the player's item list */
  const playerItemsOf = (pokemon: Pokemon) =>
    game.scene.findModifiers(m => m instanceof PokemonHeldItemModifier && m.pokemonId === pokemon.id, true);

  // Review fix (2026-11-18): a capture copied every enemy item to the player's list (upstream), so a Dynamaxed partner's
  // mushrooms were read there and a G-Max form change was looked for on its behalf
  it("copies only the caught Pokémon's items in a double battle: a fainted Dynamaxed partner keeps its own (ball)", async () => {
    game.override.battleStyle("double").battleType(BattleType.WILD).enemySpecies(SpeciesId.MACHAMP);
    await game.classicMode.startBattle(SpeciesId.BLISSEY, SpeciesId.CHANSEY);
    const [target, partner] = game.scene.getEnemyField();
    expectDynamaxed(target);
    expectDynamaxed(partner);
    // A ball is thrown only at a lone enemy: the partner has fainted
    partner.hp = 0;
    const formChange = vi.spyOn(game.scene, "triggerPokemonFormChange");

    const caught = await catchEnemy();
    expect(caught.id).toBe(target.id);
    expect(formItemsOf(caught)).toEqual([]);
    expect(playerItemsOf(partner)).toEqual([]);
    expect(formChange.mock.calls.filter(([pokemon]) => pokemon === partner)).toEqual([]);
    expect([partner.formIndex, partner.getFormKey()]).toEqual([0, ""]);
  });

  it("copies only the caught Pokémon's items in a double battle (catchPokemon), the partner on the field", async () => {
    game.override.battleStyle("double").battleType(BattleType.WILD).enemySpecies(SpeciesId.MACHAMP);
    await game.classicMode.startBattle(SpeciesId.BLISSEY, SpeciesId.CHANSEY);
    const [target, partner] = game.scene.getEnemyField() as EnemyPokemon[];
    expectDynamaxed(partner);
    const formChange = vi.spyOn(game.scene, "triggerPokemonFormChange");

    await catchPokemon(target, null, PokeballType.POKEBALL, false);
    expect(game.scene.getPlayerParty().at(-1)!.id).toBe(target.id);
    expect(playerItemsOf(partner)).toEqual([]);
    expect(formChange.mock.calls.filter(([pokemon]) => pokemon === partner)).toEqual([]);
    expectDynamaxed(partner);
    expect(partner.getFormKey()).toBe("");
  });

  it("gives a caught G-Max enemy back in its base form with its HP as before (never the state's ratio on the way)", async () => {
    formDice.mockImplementation(range => (range === 100 ? 0 : range - 1));
    game.override.battleType(BattleType.WILD).enemySpecies(SpeciesId.CHARIZARD);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const enemy = game.field.getEnemyPokemon();
    expect(enemy.getFormKey()).toBe(SpeciesFormKey.GIGANTAMAX);
    expect(getBattleFormOptions(enemy)).toEqual([]);
    const gmaxMaxHp = enemy.getMaxHp();
    enemy.hp = Math.floor(gmaxMaxHp / 2);
    const hp = enemy.hp;

    const caught = await catchEnemy();
    expect(caught.getFormKey()).toBe("");
    expect(formItemsOf(caught)).toEqual([]);
    expect(caught.hasDynamaxState()).toBe(false);
    const baseMaxHp = caught.getMaxHp();
    // As before the enemy Dynamax state: the HP stays (the max HP's rise added), at most the new max
    expect(caught.hp).toBe(Math.min(hp + Math.max(0, baseMaxHp - gmaxMaxHp), baseMaxHp));
  });

  /** Starts an Endless run on `wave` the way the title screen would (as custom-endless-boss-bars.test.ts does) */
  async function startEndlessRun(wave: number, seed = "enemy-dynamax"): Promise<void> {
    game.override.startingWave(wave).seed(seed);
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.ENDLESS);
      game.scene.offsetGym = false;
      const starters = generateStarters(game.scene, [SpeciesId.FEEBAS]);
      game.scene.setSeed(seed);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    await game.phaseInterceptor.to("CommandPhase", false);
  }

  it("puts an Endless boss trainer's ace past wave 200 in the state on top of its bars and their HP correction", async () => {
    // No health-segment override: it turns the Endless boss bars off
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.BROCK, trainerVariant: TrainerVariant.DEFAULT })
      .enemyHealthSegments(0);
    await startEndlessRun(201);

    const party = game.scene.getEnemyParty();
    const ace = party.at(-1)!;
    expect(getTrainerDynamaxOrder(party, true)[0]).toBe(ace);
    expect(party.filter(p => p.hasDynamaxState())).toEqual([ace]);
    const bars = ace.forkBossHpBars!;
    expect(bars).toBeGreaterThanOrEqual(2);
    expect([ace.bossSegments, ace.bossSegmentIndex]).toEqual([bars, bars - 1]);
    expectDynamaxed(ace);

    // The bars' correction is still there under the x1.5: without the mushrooms, x (1 + 0.25 x (bars - 1)) on the rest
    const [mushrooms] = mushroomsOf(ace);
    const enemyModifiers = game.scene["enemyModifiers"];
    enemyModifiers.splice(enemyModifiers.indexOf(mushrooms), 1);
    ace.calculateStats();
    const corrected = ace.getMaxHp();
    ace.forkBossHpBars = undefined;
    ace.calculateStats();
    const plain = ace.getMaxHp();
    expect(corrected).toBe(Math.floor(plain * getEndlessBossHpMultiplier(bars)));
    ace.forkBossHpBars = bars;
    enemyModifiers.push(mushrooms);
    ace.calculateStats();
    expect([ace.getMaxHp(), ace.hp]).toEqual([
      Math.floor(corrected * DYNAMAX_HP_MULTIPLIER),
      Math.floor(corrected * DYNAMAX_HP_MULTIPLIER),
    ]);
  });
});
