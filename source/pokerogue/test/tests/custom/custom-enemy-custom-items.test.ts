import { getGameMode } from "#app/game-mode";
import { CHOICE_ITEM_TYPE_IDS } from "#data/battler-tags";
import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { GameModes } from "#enums/game-modes";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { Unlockables } from "#enums/unlockables";
import type { Pokemon } from "#field/pokemon";
import { applyLifeOrbDamage, isRadioactiveWasteHealer, LifeOrbModifier } from "#modifiers/custom-held-items";
import {
  ENEMY_CUSTOM_ITEMS,
  type EnemyCustomItemCandidate,
  enemyCustomItemDice,
  getEnemyChoiceItemLimit,
  getEnemyCustomItemBattleKind,
  getEnemyCustomItemCandidates,
  getEnemyCustomItemChance,
  getEnemyCustomItemScaledChance,
  getEnemyCustomItemSlots,
  newEnemyCustomItem,
  pickEnemyCustomItem,
  rollEnemyCustomItems,
} from "#modifiers/enemy-custom-items";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local fork (2026-11-10): the fork's held items on enemy trainer Pokémon and wild bosses (enemy-custom-items.ts). The
 * user: "보스와 트레이너에 추가하고". Lean on purpose.
 */
describe("Custom held items - on enemy trainers and wild bosses", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    // Keep what the encounter rolled for the enemies: that is what these tests look at
    game.override.removeEnemyStartingItems = false;
    game.override
      .battleStyle("single")
      .startingWave(75)
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH])
      .mysteryEncounterChance(0);
  });

  const forkIds = new Set<string>(ENEMY_CUSTOM_ITEMS.candidates.map(c => c.id));
  const forkItemsOf = (pokemon: Pokemon) => pokemon.getHeldItems().filter(m => forkIds.has(m.type.id));
  const idsOf = (candidates: readonly EnemyCustomItemCandidate[]) => candidates.map(c => c.id);
  const candidate = (id: string) => ENEMY_CUSTOM_ITEMS.candidates.find(c => c.id === id)!;

  it("keeps its numbers in one frozen table, without the empty vessels or Forged Steel", () => {
    expect(Object.isFrozen(ENEMY_CUSTOM_ITEMS)).toBe(true);
    expect(Object.isFrozen(ENEMY_CUSTOM_ITEMS.chance)).toBe(true);
    expect(Object.isFrozen(ENEMY_CUSTOM_ITEMS.candidates)).toBe(true);
    expect(ENEMY_CUSTOM_ITEMS.candidates.every(c => Object.isFrozen(c))).toBe(true);
    // Local fork (2026-11-12): trainer 15 -> 10, boss trainer 30 -> 20, wild boss unchanged (the user: "트레이너전에서
    // 커스텀 아이템 개수 하락")
    expect(ENEMY_CUSTOM_ITEMS.chance).toEqual({ trainer: 10, bossTrainer: 20, wildBoss: 30 });
    expect(ENEMY_CUSTOM_ITEMS.candidates.map(c => [c.id, c.weight, c.minWave, c.requires ?? null])).toEqual([
      ["LIFE_ORB", 3, 40, null],
      ["TRAINING_SHACKLES", 2, 40, null],
      ["RADIOACTIVE_WASTE", 2, 40, "poisonType"],
      ["RED_EVOLUTION_CRYSTAL", 2, 20, "canEvolve"],
      ["BLUE_EVOLUTION_CRYSTAL", 2, 20, "canEvolve"],
      ["CHOICE_BAND", 1, 70, "physical"],
      ["CHOICE_SPECS", 1, 70, "special"],
      ["CHOICE_SCARF", 1, 70, null],
      ["CHOICE_ARMOR", 1, 70, null],
      ["ASSAULT_VEST", 1, 70, null],
      ["BULLETPROOF_VEST", 1, 70, null],
      ["PRISM", 1, 70, "doubleBattle"],
      ["ULTIMATE_GENE", 1, 70, null],
      ["FLAME_FURNACE", 1, 70, null],
      ["TOXIC_DISTILLATE", 1, 70, null],
      ["SUPERCONDUCTING_COIL", 1, 70, null],
    ]);
    for (const id of forkIds) {
      expect(modifierTypes[id as keyof typeof modifierTypes], id).toBeInstanceOf(Function);
    }
    for (const id of ["FLAME_CAULDRON", "TOXIC_DISTILLER", "DISCHARGED_COIL", "FORGED_STEEL"]) {
      expect(forkIds.has(id), id).toBe(false);
    }
  });

  it("offers only what the Pokémon can use, from its wave on, and nothing it already holds", async () => {
    game.override.battleType(BattleType.WILD);
    await game.classicMode.startBattle(SpeciesId.GRIMER, SpeciesId.SNORLAX, SpeciesId.ALAKAZAM);
    const [grimer, snorlax, alakazam] = game.scene.getPlayerParty();
    const { gameData } = game.scene;

    // Local fork (2026-11-10), review fix: the crystals follow the Eviolite's gate, as in the player pool: none while
    // the Eviolite is locked or in a Fresh Start challenge
    gameData.unlocks[Unlockables.EVIOLITE] = false;
    expect(idsOf(getEnemyCustomItemCandidates(grimer, 20, false))).toEqual([]);
    gameData.unlocks[Unlockables.EVIOLITE] = true;
    const freshStart = vi.spyOn(game.scene.gameMode, "isFreshStartChallenge").mockReturnValue(true);
    expect(idsOf(getEnemyCustomItemCandidates(grimer, 20, false))).toEqual([]);
    freshStart.mockRestore();

    // Grimer: Poison type, can evolve, Attack 80 > Sp. Atk 40
    expect(idsOf(getEnemyCustomItemCandidates(grimer, 19, false))).toEqual([]);
    expect(idsOf(getEnemyCustomItemCandidates(grimer, 20, false))).toEqual([
      "RED_EVOLUTION_CRYSTAL",
      "BLUE_EVOLUTION_CRYSTAL",
    ]);
    expect(idsOf(getEnemyCustomItemCandidates(grimer, 40, false))).toEqual([
      "LIFE_ORB",
      "TRAINING_SHACKLES",
      "RADIOACTIVE_WASTE",
      "RED_EVOLUTION_CRYSTAL",
      "BLUE_EVOLUTION_CRYSTAL",
    ]);
    const late = [
      "CHOICE_SCARF",
      "CHOICE_ARMOR",
      "ASSAULT_VEST",
      "BULLETPROOF_VEST",
      "ULTIMATE_GENE",
      "FLAME_FURNACE",
      "TOXIC_DISTILLATE",
      "SUPERCONDUCTING_COIL",
    ];
    const grimerAt70 = idsOf(getEnemyCustomItemCandidates(grimer, 70, false));
    expect(grimerAt70).toEqual([
      "LIFE_ORB",
      "TRAINING_SHACKLES",
      "RADIOACTIVE_WASTE",
      "RED_EVOLUTION_CRYSTAL",
      "BLUE_EVOLUTION_CRYSTAL",
      "CHOICE_BAND",
      ...late,
    ]);
    // Prism only in a double battle
    expect(idsOf(getEnemyCustomItemCandidates(grimer, 70, true))).toEqual([
      ...grimerAt70.slice(0, 10),
      "PRISM",
      ...grimerAt70.slice(10),
    ]);

    // Snorlax: fully evolved, not Poison, Attack 110 > Sp. Atk 65 -> no crystals, no waste, Band
    expect(idsOf(getEnemyCustomItemCandidates(snorlax, 70, false))).toEqual([
      "LIFE_ORB",
      "TRAINING_SHACKLES",
      "CHOICE_BAND",
      ...late,
    ]);
    // Alakazam: Sp. Atk 135 > Attack 50 -> Specs, not Band
    expect(idsOf(getEnemyCustomItemCandidates(alakazam, 70, false))).toEqual([
      "LIFE_ORB",
      "TRAINING_SHACKLES",
      "CHOICE_SPECS",
      ...late,
    ]);

    // Already held (by matchType): a Life Orb, and a Flame Cauldron, which is the Flame Furnace's item
    game.scene.addModifier(newEnemyCustomItem("LIFE_ORB", grimer), true);
    game.scene.addModifier(
      modifierTypes.FLAME_CAULDRON().withIdFromFunc(modifierTypes.FLAME_CAULDRON).newModifier(grimer)!,
      true,
    );
    expect(idsOf(getEnemyCustomItemCandidates(grimer, 70, false))).toEqual(
      grimerAt70.filter(id => id !== "LIFE_ORB" && id !== "FLAME_FURNACE"),
    );
  });

  it("leaves Radioactive Waste out for a Poison type its trainer may Terastallize out of Poison", async () => {
    // Local fork (2026-11-10), review fix: Agatha (Ghost Elite Four) picks a random Tera in genAI, after the items are
    // rolled, and gives it her specialty type: a Tera Ghost Grimer would be poisoned by the Waste
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.AGATHA, trainerVariant: TrainerVariant.DEFAULT })
      .enemySpecies(SpeciesId.GRIMER);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const config = game.scene.currentBattle.trainer!.config;
    expect(config.trainerType).toBe(TrainerType.AGATHA);
    expect(config.specialtyType).toBe(PokemonType.GHOST);
    expect(config.genAIFuncs.length).toBeGreaterThan(0);
    const grimer = game.field.getEnemyPokemon();
    const hasWaste = () => idsOf(getEnemyCustomItemCandidates(grimer, 75, false)).includes("RADIOACTIVE_WASTE");
    expect(isRadioactiveWasteHealer(grimer)).toBe(true);
    expect(hasWaste()).toBe(false);
    // No party member got one at the encounter either
    for (const pokemon of game.scene.getEnemyParty()) {
      expect(forkItemsOf(pokemon).map(m => m.type.id)).not.toContain("RADIOACTIVE_WASTE");
    }

    const savedTeraType = grimer.teraType;
    try {
      // A Poison specialty (Koga, Janine...) keeps it Poison through the Tera: the Waste is back
      config.specialtyType = PokemonType.POISON;
      expect(hasWaste()).toBe(true);
      // A known instant-Tera Pokémon goes by its own Tera type: Ghost loses it, Stellar keeps the Poison typing
      vi.spyOn(config.trainerAI, "instantTeras", "get").mockReturnValue([grimer.initialTeamIndex]);
      grimer.teraType = PokemonType.GHOST;
      expect(hasWaste()).toBe(false);
      grimer.teraType = PokemonType.STELLAR;
      expect(hasWaste()).toBe(true);
    } finally {
      config.specialtyType = PokemonType.GHOST;
      grimer.teraType = savedTeraType;
    }
  });

  it("picks by the two rolls: under the chance, then by weight in table order", () => {
    const candidates = [candidate("LIFE_ORB"), candidate("TRAINING_SHACKLES"), candidate("SUPERCONDUCTING_COIL")];
    expect(pickEnemyCustomItem(15, candidates, 14, 0)).toBe("LIFE_ORB");
    expect(pickEnemyCustomItem(15, candidates, 15, 0)).toBeNull();
    expect(pickEnemyCustomItem(30, candidates, 29, 2)).toBe("LIFE_ORB");
    expect(pickEnemyCustomItem(30, candidates, 0, 3)).toBe("TRAINING_SHACKLES");
    expect(pickEnemyCustomItem(30, candidates, 0, 4)).toBe("TRAINING_SHACKLES");
    expect(pickEnemyCustomItem(30, candidates, 0, 5)).toBe("SUPERCONDUCTING_COIL");
    expect(pickEnemyCustomItem(100, [], 0, 0)).toBeNull();
    expect(pickEnemyCustomItem(0, candidates, 0, 0)).toBeNull();
  });

  it("gives each Pokémon of a trainer exactly one when the rolls are forced; it works and can be taken", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER, trainerVariant: TrainerVariant.DEFAULT });
    // The chance roll hits, the weight roll takes the last candidate: the Superconducting Coil (wave 75, no requirement)
    const dice = vi.spyOn(enemyCustomItemDice, "roll").mockImplementation(range => (range === 100 ? 0 : range - 1));
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const { currentBattle } = game.scene;
    expect(currentBattle.battleType).toBe(BattleType.TRAINER);
    const config = currentBattle.trainer!.config;
    expect(config.isBoss).toBe(false);
    const party = game.scene.getEnemyParty();
    expect(party.length).toBeGreaterThan(0);
    for (const pokemon of party) {
      expect(forkItemsOf(pokemon).map(m => m.type.id)).toEqual(["SUPERCONDUCTING_COIL"]);
    }
    expect(dice).toHaveBeenCalledTimes(party.length * 2);

    const enemy = game.field.getEnemyPokemon();
    expect(getEnemyCustomItemBattleKind(enemy)).toBe("trainer");
    expect(getEnemyCustomItemChance(enemy)).toBe(10);
    config.isBoss = true;
    try {
      expect(getEnemyCustomItemBattleKind(enemy)).toBe("trainer");
      expect(getEnemyCustomItemChance(enemy)).toBe(20);
    } finally {
      config.isBoss = false;
    }

    // It works: Snorlax's Speed x1.4
    const base = enemy.getEffectiveStat(Stat.SPD, { ignoreHeldItems: true });
    expect(enemy.getEffectiveStat(Stat.SPD)).toBe(Math.floor((base * 14) / 10));

    // It stays transferable, so a thief (Thief, Grip Claw...) can take it
    const coil = forkItemsOf(enemy)[0] as PokemonHeldItemModifier;
    const feebas = game.field.getPlayerPokemon();
    expect(coil.isTransferable).toBe(true);
    expect(game.scene.canTakeHeldItem(coil, feebas)).toBe(true);
    expect(game.scene.tryTransferHeldItemModifier(coil, feebas, false)).toBe(true);
    expect(forkItemsOf(feebas).map(m => m.type.id)).toEqual(["SUPERCONDUCTING_COIL"]);
    expect(forkItemsOf(enemy)).toEqual([]);
  });

  it("gives a wild boss exactly one when the rolls are forced: the Life Orb, at its reward tier", async () => {
    game.override.battleType(BattleType.WILD).enemyHealthSegments(3);
    vi.spyOn(enemyCustomItemDice, "roll").mockReturnValue(0);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const boss = game.field.getEnemyPokemon();
    expect(boss.isBoss()).toBe(true);
    expect(getEnemyCustomItemBattleKind(boss)).toBe("wildBoss");
    expect(getEnemyCustomItemChance(boss)).toBe(30);
    const items = forkItemsOf(boss);
    expect(items.map(m => m.type.id)).toEqual(["LIFE_ORB"]);
    expect(items[0]).toBeInstanceOf(LifeOrbModifier);
    expect(items[0].stackCount).toBe(1);
    expect(items[0].type.tier).toBe(ModifierTier.ROGUE);
    expect(items[0].isTransferable).toBe(true);
    const damage = new NumberHolder(100);
    applyLifeOrbDamage(boss, damage);
    expect(damage.value).toBe(130);

    // Local fork (2026-11-12): in Endless a wild boss keeps its old numbers: 4 slots at wave 600 (a trainer's Pokémon: 3)
    game.scene.clearEnemyHeldItemModifiers(boss);
    game.scene.gameMode = getGameMode(GameModes.ENDLESS);
    try {
      expect(rollEnemyCustomItems(boss, 600).map(m => m.type.id)).toEqual([
        "LIFE_ORB",
        "TRAINING_SHACKLES",
        "CHOICE_BAND",
        "ASSAULT_VEST",
      ]);
    } finally {
      game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    }
  });

  // Local fork (2026-11-10): the user: "커스텀 아이템이 나올 확률 + 최대 갯수는 엔드리스일 때 라운드가 점점 진행하며
  // 확률을 높여보죠"
  it("in Endless raises the chance and the number of slots with the wave; elsewhere one slot at the base chance", () => {
    expect(Object.isFrozen(ENEMY_CUSTOM_ITEMS.endless)).toBe(true);
    expect(Object.isFrozen(ENEMY_CUSTOM_ITEMS.endless.wildBoss)).toBe(true);
    expect(Object.isFrozen(ENEMY_CUSTOM_ITEMS.endless.trainer)).toBe(true);
    // Local fork (2026-11-12): the wild bosses keep the old row, the trainer battles get their own (the user:
    // "트레이너전에서 커스텀 아이템 개수 하락")
    expect(ENEMY_CUSTOM_ITEMS.endless).toEqual({
      wildBoss: { chanceEveryWaves: 100, chanceStep: 5, maxChance: 90, slotEveryWaves: 200, maxSlots: 6 },
      trainer: { chanceEveryWaves: 100, chanceStep: 3, maxChance: 60, slotEveryWaves: 300, maxSlots: 4 },
    });

    // A wild boss: exactly as before
    const bossChance = (wave: number, endless = true) => getEnemyCustomItemScaledChance(30, wave, endless, "wildBoss");
    expect([bossChance(99), bossChance(100), bossChance(600), bossChance(5000)]).toEqual([30, 35, 60, 90]);
    const bossSlots = (wave: number, endless = true) => getEnemyCustomItemSlots(wave, endless, "wildBoss");
    expect([bossSlots(1), bossSlots(199), bossSlots(200), bossSlots(600), bossSlots(1000), bossSlots(5000)]).toEqual([
      1, 1, 2, 4, 6, 6,
    ]);

    // A trainer's Pokémon: +3 per 100 waves up to 60, a slot per 300 waves up to 4
    const chance = (base: number, wave: number, endless = true) =>
      getEnemyCustomItemScaledChance(base, wave, endless, "trainer");
    expect([10, 100, 300, 600, 1000, 1500, 1700, 5000].map(wave => chance(10, wave))).toEqual([
      10, 13, 19, 28, 40, 55, 60, 60,
    ]);
    expect([600, 1000, 1500, 5000].map(wave => chance(20, wave))).toEqual([38, 50, 60, 60]);
    expect([chance(0, 600), chance(10, 600, false), chance(20, 5000, false), bossChance(5000, false)]).toEqual([
      0, 10, 20, 30,
    ]);
    const slots = (wave: number, endless = true) => getEnemyCustomItemSlots(wave, endless, "trainer");
    expect([1, 299, 300, 599, 600, 900, 1000, 5000].map(wave => slots(wave))).toEqual([1, 1, 2, 2, 3, 4, 4, 4]);
    expect([slots(5000, false), bossSlots(5000, false)]).toEqual([1, 1]);

    // Expected items per Pokémon (chance x slots), the numbers the change was planned with
    const expected = (base: number, wave: number) => (chance(base, wave) / 100) * slots(wave);
    const ordinary = [300, 600, 1000, 1500, 1700].map(wave => expected(10, wave));
    [0.38, 0.84, 1.6, 2.2, 2.4].forEach((value, i) => expect(ordinary[i]).toBeCloseTo(value, 10));
    const bossTrainer = [600, 1000, 1500].map(wave => expected(20, wave));
    [1.14, 2.0, 2.4].forEach((value, i) => expect(bossTrainer[i]).toBeCloseTo(value, 10));
  });

  it("in Endless fills several slots with different items", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER, trainerVariant: TrainerVariant.DEFAULT });
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const enemy = game.field.getEnemyPokemon();
    game.scene.clearEnemyHeldItemModifiers(enemy);
    // Every chance roll hits and every weight roll takes the first candidate left
    const dice = vi.spyOn(enemyCustomItemDice, "roll").mockReturnValue(0);
    game.scene.gameMode = getGameMode(GameModes.ENDLESS);
    // Local fork (2026-11-12): a trainer's Pokémon gets 3 slots at wave 600 (4 before; a wild boss still gets 4)
    const items = rollEnemyCustomItems(enemy, 600);
    expect(items).toHaveLength(3);
    const ids = items.map(m => m.type.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual(["LIFE_ORB", "TRAINING_SHACKLES", "CHOICE_BAND"]);
    expect(dice).toHaveBeenCalledTimes(6);
    // The same Pokémon in Classic: one slot
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    expect(rollEnemyCustomItems(enemy, 600)).toHaveLength(1);
  });

  // Local fork (2026-11-12): the user: "커스텀 아이템은 구애시리즈는 웬만해선 한개, 높은 웨이브에서만 객체당 두개 가능.
  // 합체형 아이템은 이전 기준 따르기"
  it("caps the Choice items at 1 per Pokémon, 2 from difficulty wave 1000, in its frozen table", () => {
    const { choiceLimit } = ENEMY_CUSTOM_ITEMS;
    expect(Object.isFrozen(choiceLimit)).toBe(true);
    expect(Object.isFrozen(choiceLimit.ids)).toBe(true);
    expect(choiceLimit).toEqual({
      ids: ["CHOICE_BAND", "CHOICE_SPECS", "CHOICE_SCARF", "CHOICE_ARMOR"],
      max: 1,
      highWave: 1000,
      highWaveMax: 2,
    });
    // The same four as the Choice lock's list
    expect(new Set<string>(choiceLimit.ids)).toEqual(CHOICE_ITEM_TYPE_IDS);
    expect([1, 70, 600, 999, 1000, 1001, 5000].map(getEnemyChoiceItemLimit)).toEqual([1, 1, 1, 1, 2, 2, 2]);
    // The vessel items' entries are as they were (the empty vessels are still not offered: first test)
    for (const id of ["FLAME_FURNACE", "TOXIC_DISTILLATE", "SUPERCONDUCTING_COIL"]) {
      expect(candidate(id)).toEqual({ id, weight: 1, minWave: 70 });
    }
  });

  it("with forced dice gives an Endless enemy one Choice item below wave 1000 and two at wave 1000", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER, trainerVariant: TrainerVariant.DEFAULT });
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const enemy = game.field.getEnemyPokemon();
    game.scene.clearEnemyHeldItemModifiers(enemy);
    expect(game.scene.currentBattle.double).toBe(false);
    const choiceIds = new Set<string>(ENEMY_CUSTOM_ITEMS.choiceLimit.ids);
    const vesselIds = ["FLAME_FURNACE", "TOXIC_DISTILLATE", "SUPERCONDUCTING_COIL"];
    const choicesIn = (ids: readonly string[]) => ids.filter(id => choiceIds.has(id));
    // Every chance roll hits; every weight roll is 5, which for Snorlax (Life Orb 3 + Training Shackles 2 first) lands
    // on the first Choice item left, as long as one is offered
    const dice = vi.spyOn(enemyCustomItemDice, "roll").mockImplementation(range => (range === 100 ? 0 : 5));
    game.scene.gameMode = getGameMode(GameModes.ENDLESS);
    try {
      // Wave 999: 4 slots (Local fork 2026-11-12: a trainer's Pokémon; 5 before), the dice would take a Choice item
      // every time; only the Choice Band is given
      const below = rollEnemyCustomItems(enemy, 999).map(m => m.type.id);
      expect(getEnemyCustomItemSlots(999, true, "trainer")).toBe(4);
      expect(below).toEqual(["CHOICE_BAND", "ASSAULT_VEST", "BULLETPROOF_VEST", "ULTIMATE_GENE"]);
      expect(choicesIn(below)).toHaveLength(1);
      expect(dice).toHaveBeenCalledTimes(8);

      // Wave 1000: 4 slots (6 before), two Choice items, then the others
      const at = rollEnemyCustomItems(enemy, 1000).map(m => m.type.id);
      expect(at).toEqual(["CHOICE_BAND", "CHOICE_SCARF", "ASSAULT_VEST", "BULLETPROOF_VEST"]);
      expect(choicesIn(at)).toHaveLength(2);
      // The cap takes no slot and no roll: 4 slots of 2 rolls each, every roll used
      expect(dice).toHaveBeenCalledTimes(16);

      // A Choice item it already holds counts too, and the vessel items stay offered after the cap
      void game.scene.addEnemyModifier(newEnemyCustomItem("CHOICE_ARMOR", enemy), true);
      expect(forkItemsOf(enemy).map(m => m.type.id)).toEqual(["CHOICE_ARMOR"]);
      const offered = (wave: number, picked: PokemonHeldItemModifier[] = []) =>
        idsOf(getEnemyCustomItemCandidates(enemy, wave, false, picked));
      expect(choicesIn(offered(999))).toEqual([]);
      expect(offered(999)).toEqual(expect.arrayContaining(vesselIds));
      expect(choicesIn(offered(1000))).toEqual(["CHOICE_BAND", "CHOICE_SCARF"]);
      expect(choicesIn(offered(1000, [newEnemyCustomItem("CHOICE_BAND", enemy)]))).toEqual([]);
      expect(offered(1000, [newEnemyCustomItem("CHOICE_BAND", enemy)])).toEqual(expect.arrayContaining(vesselIds));
      expect(choicesIn(rollEnemyCustomItems(enemy, 999).map(m => m.type.id))).toEqual([]);
      expect(choicesIn(rollEnemyCustomItems(enemy, 1000).map(m => m.type.id))).toEqual(["CHOICE_BAND"]);
    } finally {
      game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    }
  });

  it("never gives one to an ordinary wild Pokémon, and rolls nothing for it", async () => {
    game.override.battleType(BattleType.WILD).enemyHealthSegments(1);
    const dice = vi.spyOn(enemyCustomItemDice, "roll").mockReturnValue(0);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const wild = game.field.getEnemyPokemon();
    expect(wild.isBoss()).toBe(false);
    expect(getEnemyCustomItemBattleKind(wild)).toBeNull();
    expect(getEnemyCustomItemChance(wild)).toBe(0);
    expect(forkItemsOf(wild)).toEqual([]);
    expect(dice).not.toHaveBeenCalled();
    // It has candidates at this wave: only the chance keeps it out
    expect(getEnemyCustomItemCandidates(wild, 75, false).length).toBeGreaterThan(0);
  });
});
