import { speciesDataRegistry } from "#app/global-species-data-registry";
import { activeOverrides } from "#app/overrides";
import { modifierTypes } from "#data/data-lists";
import {
  canTakeBattleForm,
  ENEMY_BATTLE_FORMS,
  enemyBattleFormDice,
  getBaseFormIndex,
  getBattleFormItem,
  getBattleFormOptions,
  getEnemyBattleFormChance,
  getSignatureBattleForm,
  getSignatureFormOptions,
  getSignatureSlot,
  getTrainerBattleFormTier,
  isBattleFormKey,
  isSignaturePartner,
  LATE_SIGNATURE_BATTLE_FORMS,
  rollTrainerBattleForm,
  SIGNATURE_BATTLE_FORMS,
  type TrainerBattleFormTier,
  transformToBattleForm,
} from "#data/enemy-battle-forms";
import { SpeciesFormChangeItemTrigger } from "#data/form-change-triggers";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { FormChangeItem } from "#enums/form-change-item";
import { MoveId } from "#enums/move-id";
import { PokeballType } from "#enums/pokeball";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { TeraAIMode } from "#enums/tera-ai-mode";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import type { Pokemon } from "#field/pokemon";
import { PokemonFormChangeItemModifier, type PokemonHeldItemModifier } from "#modifiers/modifier";
import { PokemonMove } from "#moves/pokemon-move";
import { ModifierData } from "#system/modifier-data";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import { TrainerConfig, trainerConfigs } from "#trainers/trainer-config";
import { willTerastallize } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local fork (2026-11-10): enemy Pokémon in a battle form (Mega / G-Max / Primal), the item they hold for it, and the
 * capture rule (enemy-battle-forms.ts). The user: "낮은 확률로 적 트레이너가 메가진화 / 다이맥스 / 원시회귀 포켓몬을
 * 들고 나올수있게 하죠, 물론 메가스톤 / 다이버섯은 뺏을 수 없는 아이템으로 판정하고." and "가끔 이미
 * 메가진화/거다이맥스/원시회귀를 한채로 야생에 등장하는 포켓몬들의 확률도 넣어두도록 하죠. + 포획 후에는 메가스톤을
 * 보상으로 먹어야 메가진화/다이맥스 시킬 수 있도록(원시회귀를 한채로 나온 그란돈/가이오가, 메가진화를 한 레쿠쟈는
 * 주홍구슬/쪽빛구슬/메가진화 상태를 유지하게 따로 판정하고)". Lean on purpose.
 * Local fork (2026-11-10): the trainer chance by wave and tier, and the signature trainers. The user: "적 트레이너가
 * 메가/다이맥스/원시회귀 포켓몬을 쓸 확률도 라운드 진행 시 점점 높여보죠. 이전에 정했던 엘리트 트레이너들이 전설을
 * 가지고 나올 수도 있던 것처럼, 엘리트 트레이너와 일반 트레이너의 확률을 다르게 해서. 그리고 몇몇 트레이너들은
 * 메가진화/다이맥스/원시회귀 포켓몬이 무엇이 나올 수 있는지 확정해두죠. 예시) 난천-한카리아스 z, 마적-원시그란돈,
 * 아강-원시가이오가, 월로(게임 내에 있다면)-오리진 기라티나, 단델-거다이 리자몽, 비주기-메가뮤츠(xy는 랜덤) 이런 식으로."
 */
describe("Custom enemy battle forms - Mega / G-Max / Primal enemies and their capture", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingWave(75)
      .startingLevel(50)
      .enemyLevel(50)
      .enemyHealthSegments(1)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH])
      .mysteryEncounterChance(0);
  });

  const formItemsOf = (pokemon: Pokemon, player = pokemon.isPlayer()) =>
    game.scene.findModifiers(
      m => m instanceof PokemonFormChangeItemModifier && m.pokemonId === pokemon.id,
      player,
    ) as PokemonFormChangeItemModifier[];
  const formsOf = (pokemon: Pokemon) => getBattleFormOptions(pokemon).map(o => [o.formIndex, o.formKey, o.item]);
  const enemyForms = (species: SpeciesId, formIndex: number) =>
    vi.spyOn(activeOverrides, "ENEMY_FORM_OVERRIDES", "get").mockReturnValue({ [species]: formIndex });
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

  it("keeps its numbers in one frozen table; trainers and wild Pokémon only from difficulty wave 50", () => {
    expect(Object.isFrozen(ENEMY_BATTLE_FORMS)).toBe(true);
    expect(Object.isFrozen(ENEMY_BATTLE_FORMS.trainer)).toBe(true);
    expect(Object.values(ENEMY_BATTLE_FORMS.trainer).every(t => Object.isFrozen(t))).toBe(true);
    expect(Object.isFrozen(ENEMY_BATTLE_FORMS.keepOnCapture)).toBe(true);
    expect(ENEMY_BATTLE_FORMS.keepOnCapture.every(k => Object.isFrozen(k))).toBe(true);
    // Local fork (2026-11-10): the trainer chance by tier, growing with the wave
    expect(ENEMY_BATTLE_FORMS.trainer).toEqual({
      ordinary: { chance: 10, step: 5, everyWaves: 100, max: 50, minWave: 50 },
      elite: { chance: 20, step: 10, everyWaves: 100, max: 80, minWave: 50 },
      boss: { chance: 20, step: 10, everyWaves: 100, max: 80, minWave: 50 },
    });
    expect(ENEMY_BATTLE_FORMS.wild).toEqual({ chance: 2, minWave: 50 });
    expect(ENEMY_BATTLE_FORMS.wildBoss).toEqual({ chance: 5, minWave: 50 });
    expect(ENEMY_BATTLE_FORMS.keepOnCapture.map(k => [k.species, k.formKey, k.item])).toEqual([
      [SpeciesId.GROUDON, SpeciesFormKey.PRIMAL, FormChangeItem.RED_ORB],
      [SpeciesId.KYOGRE, SpeciesFormKey.PRIMAL, FormChangeItem.BLUE_ORB],
      [SpeciesId.RAYQUAZA, SpeciesFormKey.MEGA, FormChangeItem.RAYQUAZITE],
    ]);

    expect(getEnemyBattleFormChance(BattleType.TRAINER, false, 49)).toBe(0);
    expect(getEnemyBattleFormChance(BattleType.TRAINER, false, 50)).toBe(10);
    expect(getEnemyBattleFormChance(BattleType.WILD, false, 49)).toBe(0);
    expect(getEnemyBattleFormChance(BattleType.WILD, false, 50)).toBe(2);
    expect(getEnemyBattleFormChance(BattleType.WILD, true, 49)).toBe(0);
    expect(getEnemyBattleFormChance(BattleType.WILD, true, 120)).toBe(5);
    expect(getEnemyBattleFormChance(BattleType.MYSTERY_ENCOUNTER, true, 120)).toBe(0);

    // Local fork (2026-11-10): waves 49, 50, 149, 150, 650, 850, 1000 and far on
    const curve = (tier: TrainerBattleFormTier) =>
      [49, 50, 149, 150, 650, 850, 1000, 5000].map(w => getEnemyBattleFormChance(BattleType.TRAINER, false, w, tier));
    expect(curve("ordinary")).toEqual([0, 10, 10, 15, 40, 50, 50, 50]);
    expect(curve("elite")).toEqual([0, 20, 20, 30, 80, 80, 80, 80]);
    expect(curve("boss")).toEqual([0, 20, 20, 30, 80, 80, 80, 80]);
    expect(getEnemyBattleFormChance(BattleType.WILD, false, 5000, "elite")).toBe(2);
    const tierOf = (type: TrainerType) => getTrainerBattleFormTier(trainerConfigs[type]);
    expect(
      [TrainerType.YOUNGSTER, TrainerType.VETERAN, TrainerType.ACE_TRAINER, TrainerType.SNOW_ACE_TRAINER].map(tierOf),
    ).toEqual(["ordinary", "ordinary", "elite", "elite"]);
    expect(
      [TrainerType.BROCK, TrainerType.LANCE, TrainerType.CYNTHIA, TrainerType.ROCKET_BOSS_GIOVANNI_1].map(tierOf),
    ).toEqual(["boss", "boss", "boss", "boss"]);
  });

  it("fixes the signature trainers' battle forms in one frozen table, each a form and item of the game", () => {
    expect(Object.isFrozen(SIGNATURE_BATTLE_FORMS)).toBe(true);
    const summary = Object.fromEntries(
      Object.entries(SIGNATURE_BATTLE_FORMS).map(([type, signature]) => {
        expect(Object.isFrozen(signature)).toBe(true);
        expect(Object.isFrozen(signature.forms)).toBe(true);
        // Every signature trainer is a boss trainer (its roll uses the boss chance) with a config of its own
        expect(trainerConfigs[Number(type)].trainerType).toBe(Number(type));
        expect(getTrainerBattleFormTier(trainerConfigs[Number(type)])).toBe("boss");
        for (const { formKey, item } of signature.forms) {
          // Reached from the species' own form through an active item trigger of that item
          // Local fork (2026-11-11): its own form is its first one (Giratina's: Altered Forme); every signature form is
          // a battle form except Volo's Origin Giratina, a signature-only form
          const ownFormKey = speciesDataRegistry.getSpecies(signature.species).forms[0]?.formKey ?? "";
          const formChange = speciesDataRegistry
            .getFormChanges(signature.species)
            .find(fc => fc.formKey === formKey && fc.preFormKey === ownFormKey);
          const trigger = formChange?.findTrigger(SpeciesFormChangeItemTrigger) as SpeciesFormChangeItemTrigger;
          expect([isBattleFormKey(formKey), trigger?.item, trigger?.active]).toEqual([
            Number(type) !== TrainerType.VOLO,
            item,
            true,
          ]);
        }
        return [TrainerType[Number(type)], [SpeciesId[signature.species], ...signature.forms.map(f => f.formKey)]];
      }),
    );
    expect(summary).toEqual({
      CYNTHIA: ["GARCHOMP", SpeciesFormKey.MEGA_Z],
      MAXIE: ["GROUDON", SpeciesFormKey.PRIMAL],
      MAXIE_2: ["GROUDON", SpeciesFormKey.PRIMAL],
      ARCHIE: ["KYOGRE", SpeciesFormKey.PRIMAL],
      ARCHIE_2: ["KYOGRE", SpeciesFormKey.PRIMAL],
      LEON: ["CHARIZARD", SpeciesFormKey.GIGANTAMAX],
      GIOVANNI: ["MEWTWO", SpeciesFormKey.MEGA_X, SpeciesFormKey.MEGA_Y],
      ROCKET_BOSS_GIOVANNI_1: ["MEWTWO", SpeciesFormKey.MEGA_X, SpeciesFormKey.MEGA_Y],
      ROCKET_BOSS_GIOVANNI_2: ["MEWTWO", SpeciesFormKey.MEGA_X, SpeciesFormKey.MEGA_Y],
      STEVEN: ["METAGROSS", SpeciesFormKey.MEGA],
      DIANTHA: ["GARDEVOIR", SpeciesFormKey.MEGA],
      LYSANDRE: ["GYARADOS", SpeciesFormKey.MEGA],
      LYSANDRE_2: ["GYARADOS", SpeciesFormKey.MEGA],
      KORRINA: ["LUCARIO", SpeciesFormKey.MEGA],
      LANCE: ["DRAGONITE", SpeciesFormKey.MEGA],
      LANCE_CHAMPION: ["DRAGONITE", SpeciesFormKey.MEGA],
      BLUE: ["PIDGEOT", SpeciesFormKey.MEGA],
      RAIHAN: ["DURALUDON", SpeciesFormKey.GIGANTAMAX],
      ROSE: ["COPPERAJAH", SpeciesFormKey.GIGANTAMAX],
      ROSE_2: ["COPPERAJAH", SpeciesFormKey.GIGANTAMAX],
      SABRINA: ["ALAKAZAM", SpeciesFormKey.MEGA],
      // Local fork (2026-11-11): the fork's named trainers (named-trainers.ts)
      VOLO: ["GIRATINA", SpeciesFormKey.ORIGIN],
      PEONY: ["COPPERAJAH", SpeciesFormKey.GIGANTAMAX],
    });
  });

  it("finds the Mega / Primal / G-Max forms reached through an item, never Eternamax", async () => {
    game.override.enemySpecies(SpeciesId.MAGIKARP);
    await game.classicMode.startBattle(
      SpeciesId.CHARIZARD,
      SpeciesId.GROUDON,
      SpeciesId.RAYQUAZA,
      SpeciesId.PIKACHU,
      SpeciesId.ETERNATUS,
    );
    const [charizard, groudon, rayquaza, pikachu, eternatus] = game.scene.getPlayerParty();
    for (const p of [charizard, groudon, rayquaza, pikachu, eternatus]) {
      p.formIndex = 0;
    }

    // Charizard: the fork's Mega Z (Charizardite Z) first, as in its form changes, then X, Y and G-Max
    expect(formsOf(charizard)).toEqual([
      [4, SpeciesFormKey.MEGA_Z, FormChangeItem.CHARIZARDITE_Z],
      [1, SpeciesFormKey.MEGA_X, FormChangeItem.CHARIZARDITE_X],
      [2, SpeciesFormKey.MEGA_Y, FormChangeItem.CHARIZARDITE_Y],
      [3, SpeciesFormKey.GIGANTAMAX, FormChangeItem.MAX_MUSHROOMS],
    ]);
    expect(formsOf(groudon)).toEqual([[1, SpeciesFormKey.PRIMAL, FormChangeItem.RED_ORB]]);
    expect(formsOf(rayquaza)).toEqual([[1, SpeciesFormKey.MEGA, FormChangeItem.RAYQUAZITE]]);
    // Pikachu: G-Max from the normal and the Partner form, none from a Cosplay form
    expect(formsOf(pikachu)).toEqual([[8, SpeciesFormKey.GIGANTAMAX, FormChangeItem.MAX_MUSHROOMS]]);
    pikachu.formIndex = 1;
    expect(formsOf(pikachu)).toEqual([[8, SpeciesFormKey.GIGANTAMAX, FormChangeItem.MAX_MUSHROOMS]]);
    pikachu.formIndex = 2;
    expect(formsOf(pikachu)).toEqual([]);
    expect(canTakeBattleForm(pikachu)).toBe(false);
    // Eternatus: its Max Mushrooms lead to Eternamax, which is not a battle form here
    expect(formsOf(eternatus)).toEqual([]);
    expect(canTakeBattleForm(eternatus)).toBe(false);

    expect(canTakeBattleForm(charizard)).toBe(true);
    expect(getBattleFormItem(charizard)).toBeNull();
    charizard.formIndex = 1;
    expect(canTakeBattleForm(charizard)).toBe(false);
    expect(formsOf(charizard)).toEqual([]);
    expect(getBattleFormItem(charizard)).toBe(FormChangeItem.CHARIZARDITE_X);
    expect(getBaseFormIndex(charizard)).toBe(0);
    groudon.formIndex = 1;
    expect(getBattleFormItem(groudon)).toBe(FormChangeItem.RED_ORB);
    // Two starting forms (normal / Partner): one of them, without touching the run's seeded sequence
    pikachu.formIndex = 8;
    const rngState = Phaser.Math.RND.state();
    expect([0, 1]).toContain(getBaseFormIndex(pikachu));
    expect(Phaser.Math.RND.state()).toBe(rngState);
  });

  it("gives one trainer Pokémon a battle form when forced, holding its stone, which cannot be stolen or looted", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER, trainerVariant: TrainerVariant.DEFAULT })
      .enemySpecies(SpeciesId.CHARIZARD);
    game.override.removeEnemyStartingItems = false;
    const dice = vi.spyOn(enemyBattleFormDice, "roll").mockReturnValue(0);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const party = game.scene.getEnemyParty();
    expect(party.length).toBeGreaterThan(1);
    // One roll for the battle, one for the Pokémon, one for the form
    expect(dice).toHaveBeenCalledTimes(3);
    const transformed = party.filter(p => p.isMega() || p.isMax());
    expect(transformed).toEqual([party[0]]);
    const mega = party[0];
    expect(mega.getFormKey()).toBe(SpeciesFormKey.MEGA_Z);
    expect(mega.forkBattleFormBaseIndex).toBe(0);
    expect(getBaseFormIndex(mega)).toBe(0);
    for (const other of party.slice(1)) {
      expect(other.formIndex).toBe(0);
      expect(formItemsOf(other)).toEqual([]);
    }

    const [stone] = formItemsOf(mega);
    expect(formItemsOf(mega)).toHaveLength(1);
    expect(stone.formChangeItem).toBe(FormChangeItem.CHARIZARDITE_Z);
    expect(stone.active).toBe(true);
    // Not transferable: every steal (Thief, Covet, Knock Off, Grip Claw, Pickpocket, Magician) filters on this
    expect(stone.isTransferable).toBe(false);
    expect(mega.getHeldItems().filter(i => i.isTransferable)).not.toContain(stone);
    game.scene.currentBattle.addPostBattleLoot(mega);
    expect(game.scene.currentBattle.postBattleLoot).not.toContain(stone);
    // Holding it changes no form: the item trigger only looks at the player's items
    expect(game.scene.triggerPokemonFormChange(mega, SpeciesFormChangeItemTrigger)).toBe(false);
    expect(mega.getFormKey()).toBe(SpeciesFormKey.MEGA_Z);

    // A save keeps both: the stone (its type id lets the session rebuild it) and the form to go back to at capture
    expect(stone.type.id).toBe("RARE_FORM_CHANGE_ITEM");
    const restored = new ModifierData(stone, false).toModifier(PokemonFormChangeItemModifier);
    expect(restored).toBeInstanceOf(PokemonFormChangeItemModifier);
    const restoredStone = restored as PokemonFormChangeItemModifier;
    expect([restoredStone.formChangeItem, restoredStone.pokemonId, restoredStone.isTransferable]).toEqual([
      FormChangeItem.CHARIZARDITE_Z,
      mega.id,
      false,
    ]);
    const saved = new PokemonData(JSON.parse(JSON.stringify(new PokemonData(mega))));
    expect(saved.forkBattleFormBaseIndex).toBe(0);
    expect("forkBattleFormBaseIndex" in JSON.parse(JSON.stringify(new PokemonData(party[1])))).toBe(false);
  });

  it("keeps Mega / Max and Tera apart: no instant-Tera Pokémon is transformed, and a transformed one never Terastallizes", async () => {
    // Local fork (2026-11-10), review fix: the trainer Terastallizes its first Pokémon, as a rival does its starter
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER, trainerVariant: TrainerVariant.DEFAULT })
      .enemySpecies(SpeciesId.CHARIZARD);
    const { trainerAI } = trainerConfigs[TrainerType.ACE_TRAINER];
    const instantTeras = vi.spyOn(trainerAI, "instantTeras", "get").mockReturnValue([0]);
    const dice = vi.spyOn(enemyBattleFormDice, "roll").mockReturnValue(0);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const party = game.scene.getEnemyParty();
    const trainer = game.scene.currentBattle.trainer!;
    expect(trainer.config.trainerAI).toBe(trainerAI);
    expect(party.length).toBeGreaterThan(1);
    expect(dice).toHaveBeenCalledTimes(3);
    // The first eligible Pokémon (dice 0) is now the second one
    expect(party.filter(p => p.isMega() || p.isMax())).toEqual([party[1]]);
    const mega = party[1];

    // Even listed as an instant-Tera Pokémon, the Mega never Terastallizes (isTeraBlockedForm; Local fork
    // (2026-11-18): the enemy's rule only, the player's Mega / Dynamaxed Pokémon can: custom-dynamax-state.test.ts)
    instantTeras.mockReturnValue([0, 1]);
    const savedMode = trainerAI.teraMode;
    trainerAI.teraMode = TeraAIMode.INSTANT_TERA;
    try {
      expect(trainer.shouldTera(party[0])).toBe(true);
      expect(trainer.shouldTera(mega)).toBe(false);
      expect(willTerastallize(party[0])).toBe(true);
      expect(willTerastallize(mega)).toBe(false);
    } finally {
      trainerAI.teraMode = savedMode;
    }
    instantTeras.mockRestore();

    // The random Tera of gym leaders and the Elite Four (genAI, after the roll) passes over it: a set slot falls to
    // another Pokémon, and a Tera for everyone stops once no Pokémon that can is left
    const slotConfig = new TrainerConfig(TrainerType.ACE_TRAINER).setRandomTeraModifiers(() => 1, 1);
    slotConfig.genAIFuncs.forEach(f => f(party));
    expect(slotConfig.trainerAI.instantTeras).toHaveLength(1);
    expect(slotConfig.trainerAI.instantTeras).not.toContain(1);
    const allConfig = new TrainerConfig(TrainerType.ACE_TRAINER).setRandomTeraModifiers(() => party.length);
    allConfig.genAIFuncs.forEach(f => f(party));
    expect([...allConfig.trainerAI.instantTeras].sort((a, b) => a - b)).toEqual(
      party.map((_, i) => i).filter(i => i !== 1),
    );
  });

  it("rolls an elite trainer at the elite chance (20% on wave 75, where an ordinary trainer has 10%)", async () => {
    // Local fork (2026-11-10): 15 misses the ordinary 10% but hits the elite 20%
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER, trainerVariant: TrainerVariant.DEFAULT })
      .enemySpecies(SpeciesId.CHARIZARD);
    const dice = vi.spyOn(enemyBattleFormDice, "roll").mockReturnValueOnce(15).mockReturnValue(0);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const trainer = game.scene.currentBattle.trainer!;
    expect(getTrainerBattleFormTier(trainer.config)).toBe("elite");
    expect(getEnemyBattleFormChance(BattleType.TRAINER, false, 75, "elite")).toBe(20);
    expect(getEnemyBattleFormChance(BattleType.TRAINER, false, 75)).toBe(10);
    expect(dice.mock.calls[0]).toEqual([100]);
    const party = game.scene.getEnemyParty();
    expect(party.filter(p => p.isMega() || p.isMax())).toEqual([party[0]]);
    expect(party[0].getFormKey()).toBe(SpeciesFormKey.MEGA_Z);
  });

  it("makes Cynthia's Garchomp Mega Garchomp Z, holding Garchompite Z, switching her config's plain Mega with no roll", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.CYNTHIA, trainerVariant: TrainerVariant.DEFAULT });
    game.override.removeEnemyStartingItems = false;
    const dice = vi.spyOn(enemyBattleFormDice, "roll").mockReturnValue(0);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const party = game.scene.getEnemyParty();
    const garchomp = party.find(p => p.species.speciesId === SpeciesId.GARCHOMP)!;
    expect(garchomp).toBe(party[5]);
    expect(garchomp.getFormKey()).toBe(SpeciesFormKey.MEGA_Z);
    expect(garchomp.isBoss()).toBe(true);
    // No battle roll for her: her config's Mega Garchomp (plain or Z at random) only switches to Mega Z
    expect(dice).not.toHaveBeenCalledWith(100);
    // A signature trainer never transforms another member
    expect(party.filter(p => p.isMega() || p.isMax())).toEqual([garchomp]);
    expect(formItemsOf(garchomp).map(m => [m.formChangeItem, m.active, m.isTransferable])).toEqual([
      [FormChangeItem.GARCHOMPITE_Z, true, false],
    ]);

    // The switch itself: her config's plain Mega Garchomp becomes Mega Z, going back to its own form at capture
    garchomp.formIndex = garchomp.species.forms.findIndex(f => f.formKey === SpeciesFormKey.MEGA);
    garchomp.forkBattleFormBaseIndex = undefined;
    dice.mockClear();
    expect(rollTrainerBattleForm(party)).toBe(garchomp);
    expect(garchomp.getFormKey()).toBe(SpeciesFormKey.MEGA_Z);
    expect(garchomp.forkBattleFormBaseIndex).toBe(0);
    expect(dice).not.toHaveBeenCalledWith(100);
    // Already in it: it stays, nothing rolled
    dice.mockClear();
    expect(rollTrainerBattleForm(party)).toBe(garchomp);
    expect(dice).not.toHaveBeenCalled();
  });

  it("puts Primal Groudon in Maxie's party in place of his ace when his roll hits (no Groudon in his first battle)", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.MAXIE, trainerVariant: TrainerVariant.DEFAULT });
    game.override.removeEnemyStartingItems = false;
    const dice = vi.spyOn(enemyBattleFormDice, "roll").mockReturnValue(0);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const party = game.scene.getEnemyParty();
    expect(party).toHaveLength(6);
    // The battle roll (boss chance), then the form
    expect(dice.mock.calls).toEqual([[100], [1]]);
    const groudon = party[5];
    expect(party.filter(p => p.species.speciesId === SpeciesId.GROUDON)).toEqual([groudon]);
    expect(party.some(p => p.species.speciesId === SpeciesId.CAMERUPT)).toBe(false);
    expect(groudon.getFormKey()).toBe(SpeciesFormKey.PRIMAL);
    // Made as a trainer Pokémon in the ace's place: its level, slot, party index and boss bars
    expect([groudon.level, groudon.trainerSlot, groudon.initialTeamIndex, groudon.bossSegments]).toEqual([
      50,
      TrainerSlot.TRAINER,
      5,
      2,
    ]);
    expect(groudon.hasTrainer()).toBe(true);
    expect(groudon.getMoveset().length).toBeGreaterThan(0);
    expect(groudon.getSprite()).toBeDefined();
    expect(party.filter(p => p.isMega() || p.isMax())).toEqual([groudon]);
    expect(formItemsOf(groudon).map(m => [m.formChangeItem, m.active, m.isTransferable])).toEqual([
      [FormChangeItem.RED_ORB, true, false],
    ]);
    // The Pokédex saw the Primal form
    const { seenAttr } = game.scene.gameData.dexData[SpeciesId.GROUDON];
    expect(seenAttr & game.scene.gameData.getFormAttr(1)).not.toBe(0n);
    // The next free slot skips the transformed one
    expect(getSignatureSlot(party, SIGNATURE_BATTLE_FORMS[TrainerType.MAXIE]!)).toBe(4);
  });

  it("gives Giovanni's Mewtwo Mega X or Mega Y at random, next to his config's Mega Kangaskhan", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ROCKET_BOSS_GIOVANNI_2, trainerVariant: TrainerVariant.DEFAULT })
      .enemyMoveset([]);
    game.override.removeEnemyStartingItems = false;
    // The battle roll hits (0), then the second of Mega X / Mega Y
    const dice = vi.spyOn(enemyBattleFormDice, "roll").mockReturnValueOnce(0).mockReturnValue(1);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const party = game.scene.getEnemyParty();
    expect(dice.mock.calls).toEqual([[100], [2]]);
    const mewtwo = party[5];
    expect(mewtwo.species.speciesId).toBe(SpeciesId.MEWTWO);
    expect(mewtwo.getFormKey()).toBe(SpeciesFormKey.MEGA_Y);
    expect(formItemsOf(mewtwo).map(m => m.formChangeItem)).toEqual([FormChangeItem.MEWTWONITE_Y]);
    // Local fork (2026-11-10), review fix: its new Mega Y moveset still has the Shadow Ball his config makes sure of
    expect(mewtwo.moveset.map(m => m.moveId)).toContain(MoveId.SHADOW_BALL);
    expect(mewtwo.forkMovesetEdits).toHaveLength(1);
    expect(party.filter(p => p.isMega() || p.isMax()).map(p => p.species.speciesId)).toEqual([
      SpeciesId.KANGASKHAN,
      SpeciesId.MEWTWO,
    ]);
    // From its own form a Mewtwo can go to either
    mewtwo.formIndex = 0;
    const signature = SIGNATURE_BATTLE_FORMS[TrainerType.GIOVANNI]!;
    expect(getSignatureFormOptions(mewtwo, signature).map(o => [o.formKey, o.item])).toEqual([
      [SpeciesFormKey.MEGA_X, FormChangeItem.MEWTWONITE_X],
      [SpeciesFormKey.MEGA_Y, FormChangeItem.MEWTWONITE_Y],
    ]);
    expect(SIGNATURE_BATTLE_FORMS[TrainerType.ROCKET_BOSS_GIOVANNI_1]).toBe(signature);
  });

  it("keeps Korrina on Mega Lucario only and gives Raihan Mega Archaludon past wave 200 (Endless only)", () => {
    // Local fork (2026-11-11), the user: "코르니는 그냥 메루카만 쓰게 하고, 금랑은 200웨이브가 넘어가면(즉 엔드리스에서만)
    // 메가 브리두라스를 쓰도록 하죠."
    const formOf = (type: TrainerType, wave: number) => {
      const signature = getSignatureBattleForm(type, wave);
      return signature ? [SpeciesId[signature.species], ...signature.forms.map(f => f.formKey)] : null;
    };
    expect([1, 200, 1000].map(wave => formOf(TrainerType.KORRINA, wave))).toEqual(
      Array(3).fill(["LUCARIO", SpeciesFormKey.MEGA]),
    );
    expect([1, 200, 201, 1000].map(wave => formOf(TrainerType.RAIHAN, wave))).toEqual([
      ["DURALUDON", SpeciesFormKey.GIGANTAMAX],
      ["DURALUDON", SpeciesFormKey.GIGANTAMAX],
      ["ARCHALUDON", SpeciesFormKey.MEGA],
      ["ARCHALUDON", SpeciesFormKey.MEGA],
    ]);
    // The Elite Four Raihan has no signature until then (his ordinary boss roll)
    expect([200, 201].map(wave => formOf(TrainerType.RAIHAN_ELITE, wave))).toEqual([
      null,
      ["ARCHALUDON", SpeciesFormKey.MEGA],
    ]);
    expect(Object.isFrozen(LATE_SIGNATURE_BATTLE_FORMS)).toBe(true);
    expect(getTrainerBattleFormTier(trainerConfigs[TrainerType.RAIHAN_ELITE])).toBe("boss");
    // Mega Archaludon (our custom Mega) is reached from Archaludon's own form through the active Archaludonite trigger
    const formChange = speciesDataRegistry
      .getFormChanges(SpeciesId.ARCHALUDON)
      .find(fc => fc.formKey === SpeciesFormKey.MEGA && fc.preFormKey === "");
    const trigger = formChange?.findTrigger(SpeciesFormChangeItemTrigger) as SpeciesFormChangeItemTrigger;
    expect([trigger?.item, trigger?.active]).toEqual([FormChangeItem.ARCHALUDONITE, true]);
    expect(getSignatureBattleForm(TrainerType.RAIHAN, 201)?.forms[0].item).toBe(FormChangeItem.ARCHALUDONITE);
    // Local fork (2026-11-12): and a fixed G-Max Duraludon tail (custom-fixed-trainer-fusions.test.ts)
    expect(LATE_SIGNATURE_BATTLE_FORMS[TrainerType.RAIHAN]?.fusion).toEqual({
      species: SpeciesId.DURALUDON,
      formKey: SpeciesFormKey.GIGANTAMAX,
    });
  });

  // Local fork (2026-11-12): past wave 200 his Mega Archaludon is no roll any more: it is always there, fused with a
  // G-Max Duraludon tail (fixed trainer fusions; the user: "합체를 좀 고정해보죠"); the roll is forced to miss to show it
  it("always puts Mega Archaludon, fused with G-Max Duraludon, in Raihan's party past wave 200, with no roll", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.RAIHAN, trainerVariant: TrainerVariant.DEFAULT });
    // The first battle's roll misses, so the party stays as his config made it
    const dice = vi.spyOn(enemyBattleFormDice, "roll").mockReturnValue(99);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const party = game.scene.getEnemyParty();
    expect(party.some(p => p.isMega() || p.isMax())).toBe(false);

    // The same party on a wave past 200: the late signature is used, with no roll
    game.scene.currentBattle.waveIndex = 250;
    dice.mockClear();
    const mega = rollTrainerBattleForm(party);
    expect(dice).not.toHaveBeenCalled();
    expect([mega && SpeciesId[mega.species.speciesId], mega?.getFormKey()]).toEqual([
      "ARCHALUDON",
      SpeciesFormKey.MEGA,
    ]);
    expect([mega?.fusionSpecies?.speciesId, mega?.getFusionFormKey()]).toEqual([
      SpeciesId.DURALUDON,
      SpeciesFormKey.GIGANTAMAX,
    ]);
    const line = [SpeciesId.DURALUDON, SpeciesId.ARCHALUDON];
    expect(party.filter(p => line.includes(p.species.speciesId))).toEqual([mega]);
    expect(party.filter(p => p.isMega() || p.isMax())).toEqual([mega]);
  });

  it("keeps Archie's hand-picked Kyogre moves on its Primal Kyogre moveset", async () => {
    // Local fork (2026-11-10), review fix: his config makes sure of an Ice move and swaps Aqua Tail for Origin Pulse and
    // Blizzard for Ice Beam; the Primal form's new moveset gets the same edits, in the same order
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ARCHIE_2, trainerVariant: TrainerVariant.DEFAULT })
      .enemyMoveset([]);
    const dice = vi.spyOn(enemyBattleFormDice, "roll").mockReturnValue(0);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const kyogre = game.scene.getEnemyParty()[5];
    expect(dice.mock.calls).toEqual([[100], [1]]);
    expect([kyogre.species.speciesId, kyogre.getFormKey()]).toEqual([SpeciesId.KYOGRE, SpeciesFormKey.PRIMAL]);
    expect(kyogre.forkMovesetEdits).toHaveLength(3);
    expect(kyogre.moveset.some(m => m.getMove().type === PokemonType.ICE && m.getMove().power > 1)).toBe(true);

    // On a known new moveset: Blizzard already counts as the Ice move, then Aqua Tail and Blizzard are swapped
    kyogre.formIndex = 0;
    kyogre.forkBattleFormBaseIndex = undefined;
    const generated = [MoveId.AQUA_TAIL, MoveId.BLIZZARD, MoveId.SURF, MoveId.THUNDER];
    vi.spyOn(kyogre, "generateAndPopulateMoveset").mockImplementation(() => {
      kyogre.moveset = generated.map(m => new PokemonMove(m));
    });
    transformToBattleForm(kyogre, getBattleFormOptions(kyogre)[0]);
    expect(kyogre.getFormKey()).toBe(SpeciesFormKey.PRIMAL);
    expect(kyogre.moveset.map(m => m.moveId)).toEqual([
      MoveId.ORIGIN_PULSE,
      MoveId.ICE_BEAM,
      MoveId.SURF,
      MoveId.THUNDER,
    ]);
    // Remembered again, once each
    expect(kyogre.forkMovesetEdits).toHaveLength(3);
  });

  it("leaves a signature partner's Pokémon out of the main trainer's roll in a named double battle (Red & Blue)", async () => {
    // Local fork (2026-11-10), review fix: Blue's battle form stays his Mega Pidgeot, so Red's roll passes over his
    // Pokémon. The battle roll hits, then the last eligible Pokémon (one of Blue's if they counted), then the last form.
    game.override
      .battleStyle("double")
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.RED, trainerVariant: TrainerVariant.DOUBLE })
      .enemySpecies(SpeciesId.CHARIZARD);
    const dice = vi.spyOn(enemyBattleFormDice, "roll").mockImplementation(range => (range === 100 ? 0 : range - 1));
    await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP);

    const trainer = game.scene.currentBattle.trainer!;
    expect([trainer.config.trainerType, trainer.config.trainerTypeDouble, trainer.isDouble()]).toEqual([
      TrainerType.RED,
      TrainerType.BLUE,
      true,
    ]);
    expect(isSignaturePartner(trainer.config)).toBe(true);
    expect(isSignaturePartner(trainerConfigs[TrainerType.WALLACE])).toBe(true);
    expect(isSignaturePartner(trainerConfigs[TrainerType.BLUE])).toBe(false);
    expect(isSignaturePartner(trainerConfigs[TrainerType.ACE_TRAINER])).toBe(false);

    const party = game.scene.getEnemyParty();
    const blues = party.filter(p => p.trainerSlot === TrainerSlot.TRAINER_PARTNER);
    expect(blues.length).toBeGreaterThan(0);
    expect(blues.some(p => p.isMega() || p.isMax())).toBe(false);
    // Only Red's own Pokémon that will not Terastallize counted, and the last of them took the form
    const reds = party.filter(p => p.trainerSlot === TrainerSlot.TRAINER && !willTerastallize(p));
    expect(dice.mock.calls.slice(0, 2)).toEqual([[100], [reds.length]]);
    expect(party.filter(p => p.isMega() || p.isMax())).toEqual([reds.at(-1)]);
  });

  it("leaves Leon's config G-Max Charizard as it is, holding Max Mushrooms, with no roll", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.LEON, trainerVariant: TrainerVariant.DEFAULT });
    game.override.removeEnemyStartingItems = false;
    const dice = vi.spyOn(enemyBattleFormDice, "roll").mockReturnValue(0);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const party = game.scene.getEnemyParty();
    expect(dice).not.toHaveBeenCalled();
    const charizard = party.find(p => p.species.speciesId === SpeciesId.CHARIZARD)!;
    expect(charizard.getFormKey()).toBe(SpeciesFormKey.GIGANTAMAX);
    expect(party.filter(p => p.isMega() || p.isMax())).toEqual([charizard]);
    expect(formItemsOf(charizard).map(m => m.formChangeItem)).toEqual([FormChangeItem.MAX_MUSHROOMS]);
  });

  it("puts a wild Pokémon in a battle form when forced, remembering its own form (Partner Pikachu to G-Max)", async () => {
    game.override.battleType(BattleType.WILD).enemySpecies(SpeciesId.PIKACHU);
    game.override.removeEnemyStartingItems = false;
    enemyForms(SpeciesId.PIKACHU, 1);
    const dice = vi.spyOn(enemyBattleFormDice, "roll").mockReturnValue(0);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const pikachu = game.field.getEnemyPokemon();
    expect(dice).toHaveBeenCalledTimes(2);
    expect(pikachu.getFormKey()).toBe(SpeciesFormKey.GIGANTAMAX);
    expect(pikachu.isMax()).toBe(true);
    expect(pikachu.getSpriteScale()).toBe(1.5);
    expect(pikachu.forkBattleFormBaseIndex).toBe(1);
    expect(getBaseFormIndex(pikachu)).toBe(1);
    expect(formItemsOf(pikachu).map(m => [m.formChangeItem, m.active, m.isTransferable])).toEqual([
      [FormChangeItem.MAX_MUSHROOMS, true, false],
    ]);
  });

  it("gives a caught Mega back in its own form, without its Mega Stone; its other items still move", async () => {
    game.override.battleType(BattleType.WILD).enemySpecies(SpeciesId.CHARIZARD);
    game.override.removeEnemyStartingItems = false;
    vi.spyOn(enemyBattleFormDice, "roll").mockReturnValue(0);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const enemy = game.field.getEnemyPokemon();
    expect(enemy.getFormKey()).toBe(SpeciesFormKey.MEGA_Z);
    expect(formItemsOf(enemy).map(m => m.formChangeItem)).toEqual([FormChangeItem.CHARIZARDITE_Z]);
    const leftovers = modifierTypes.LEFTOVERS().withIdFromFunc(modifierTypes.LEFTOVERS).newModifier(enemy);
    await game.scene.addEnemyModifier(leftovers as PokemonHeldItemModifier);
    const otherItems = enemy
      .getHeldItems()
      .filter(m => !(m instanceof PokemonFormChangeItemModifier))
      .map(m => m.type.id);
    expect(otherItems).toContain("LEFTOVERS");
    const formChanges = vi.spyOn(game.scene, "triggerPokemonFormChange");

    const caught = await catchEnemy();
    expect(caught.species.speciesId).toBe(SpeciesId.CHARIZARD);
    expect(caught.id).toBe(enemy.id);
    expect(caught.formIndex).toBe(0);
    expect(caught.isMega()).toBe(false);
    expect(formItemsOf(caught, true)).toEqual([]);
    expect(caught.getHeldItems().map(m => m.type.id)).toEqual(otherItems);
    expect(formChanges.mock.results.every(r => r.value === false)).toBe(true);
    // The Pokédex records the form the player got, not the Mega
    const { caughtAttr } = game.scene.gameData.dexData[SpeciesId.CHARIZARD];
    expect(caughtAttr & game.scene.gameData.getFormAttr(0)).not.toBe(0n);
    expect(caughtAttr & game.scene.gameData.getFormAttr(4)).toBe(0n);
  });

  it("lets a caught Primal Groudon stay Primal with the Red Orb, made for it when the enemy held none", async () => {
    game.override.battleType(BattleType.WILD).enemySpecies(SpeciesId.GROUDON);
    enemyForms(SpeciesId.GROUDON, 1);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const enemy = game.field.getEnemyPokemon();
    expect(enemy.getFormKey()).toBe(SpeciesFormKey.PRIMAL);
    // The test helper took every enemy item away at the start, the Red Orb included
    expect(formItemsOf(enemy)).toEqual([]);
    const formChanges = vi.spyOn(game.scene, "triggerPokemonFormChange");

    const caught = await catchEnemy();
    expect(caught.species.speciesId).toBe(SpeciesId.GROUDON);
    expect(caught.getFormKey()).toBe(SpeciesFormKey.PRIMAL);
    expect(formItemsOf(caught, true).map(m => [m.formChangeItem, m.active, m.isTransferable, m.type.id])).toEqual([
      [FormChangeItem.RED_ORB, true, false, "RARE_FORM_CHANGE_ITEM"],
    ]);
    expect(formChanges.mock.results.every(r => r.value === false)).toBe(true);
  });

  it("lets a caught Mega Rayquaza stay Mega with the Rayquazite it held", async () => {
    game.override.battleType(BattleType.WILD).enemySpecies(SpeciesId.RAYQUAZA);
    game.override.removeEnemyStartingItems = false;
    enemyForms(SpeciesId.RAYQUAZA, 1);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const enemy = game.field.getEnemyPokemon();
    expect(enemy.getFormKey()).toBe(SpeciesFormKey.MEGA);
    // An enemy made Mega elsewhere (here the form override) holds its stone too
    const [stone] = formItemsOf(enemy);
    expect(formItemsOf(enemy)).toHaveLength(1);
    expect(stone.formChangeItem).toBe(FormChangeItem.RAYQUAZITE);
    const formChanges = vi.spyOn(game.scene, "triggerPokemonFormChange");

    const caught = await catchEnemy();
    expect(caught.species.speciesId).toBe(SpeciesId.RAYQUAZA);
    expect(caught.getFormKey()).toBe(SpeciesFormKey.MEGA);
    expect(formItemsOf(caught, true)).toEqual([stone]);
    expect(stone.active).toBe(true);
    expect(formChanges.mock.results.every(r => r.value === false)).toBe(true);
  });
});
