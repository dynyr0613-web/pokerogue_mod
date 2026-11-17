import { speciesDataRegistry } from "#app/global-species-data-registry";
import { FORK_UNLOCK, isForkContentUnlocked, isForkItemLocked } from "#balance/fork-unlock";
import { allAbilities, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { FormChangeItem } from "#enums/form-change-item";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { UiMode } from "#enums/ui-mode";
import { Unlockables } from "#enums/unlockables";
import { enemyRollsCustomPassive } from "#field/pokemon";
import { ENEMY_CUSTOM_ITEMS, enemyCustomItemDice, rollEnemyCustomItems } from "#modifiers/enemy-custom-items";
import {
  FormChangeItemModifierType,
  getPlayerModifierTypeOptions,
  itemPoolChecks,
  type ModifierTypeKeys,
  regenerateModifierPoolThresholds,
} from "#modifiers/modifier-type";
import { generateModifierType } from "#mystery-encounters/encounter-phase-utils";
import { GameManager } from "#test/framework/game-manager";
import { PokedexPageUiHandler } from "#ui/pokedex-page-ui-handler";
import { getModifierPoolForType } from "#utils/modifier-utils";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** The first id at or after `start` whose 1-in-8 roll of our passive is `wanted` */
function idWithRoll(wanted: boolean, start = 1): number {
  let id = start;
  while (enemyRollsCustomPassive(id) !== wanted) {
    id++;
  }
  return id;
}

/** The fork's own Mega Stones, by `FormChangeItem` name */
const MEGA_STONES = ["CHARIZARDITE_Z", "BAXCALIBRITE_Z", "GALLADITE_Z", "MELMETALITE", "ARCHALUDONITE"];

/**
 * Local fork (2026-11-12): most custom items and the custom passives unlock with the first Classic clear
 * (fork-unlock.ts). The user: "저희 대부분의 커스텀 아이템과 커스텀 패시브는 클래식 클리어 후 해금으로 하죠. 개조를
 * 하는 주된 이유가 엔드리스에 있어서요." Every other test runs unlocked (test/setup/vitest.setup.ts).
 */
describe("Custom - fork content unlocks with the first Classic clear", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .battleType(BattleType.WILD)
      .startingWave(75)
      .startingLevel(60)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.GARCHOMP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH])
      .mysteryEncounterChance(0);
  });

  afterEach(() => {
    itemPoolChecks.clear();
  });

  /** Which ids of the player's pool have weight right now (`itemPoolChecks` after a regeneration) */
  function offeredIds(): Map<string, boolean | undefined> {
    const pool = getModifierPoolForType(ModifierPoolType.PLAYER);
    const ids = [...new Set(Object.values(pool).flatMap(tier => tier.map(w => w.modifierType.id)))];
    for (const id of ids) {
      itemPoolChecks.set(id as ModifierTypeKeys, undefined);
    }
    regenerateModifierPoolThresholds(game.scene.getPlayerParty(), ModifierPoolType.PLAYER, 0);
    return new Map(ids.map(id => [id, itemPoolChecks.get(id as ModifierTypeKeys)]));
  }

  // Local fork (2026-11-12): 37 items with the Piercing Token (관통 토큰), 39 with the Weight Band and the Champion Belt
  // (중량밴드 / 챔피언벨트), 45 with the six EV items (파워웨이트 … 파워앵클릿); Local fork (2026-11-13): 46 with the
  // Guard Token (방호 토큰, 09 명세 4번); Local fork (2026-11-16): 49 with the Z-Ring, Dynamax Candy and Z crystals
  // (Z링 / 다이사탕 / Z크리스탈)
  it("keeps the gate in one frozen table: Endless's unlock flag and 49 items + 5 Mega Stones", () => {
    expect(Object.isFrozen(FORK_UNLOCK)).toBe(true);
    expect(FORK_UNLOCK.unlockable).toBe(Unlockables.ENDLESS_MODE);
    expect(FORK_UNLOCK.gatedItems.size).toBe(54);
    const pool = getModifierPoolForType(ModifierPoolType.PLAYER);
    const poolIds = new Set(Object.values(pool).flatMap(tier => tier.map(w => w.modifierType.id)));
    for (const id of FORK_UNLOCK.gatedItems) {
      if (MEGA_STONES.includes(id)) {
        expect(FormChangeItem[id as keyof typeof FormChangeItem], id).toBeGreaterThanOrEqual(140);
        expect(FormChangeItem[id as keyof typeof FormChangeItem], id).toBeLessThan(150);
      } else {
        expect(modifierTypes[id as keyof typeof modifierTypes], id).toBeInstanceOf(Function);
        expect(poolIds.has(id), id).toBe(true);
      }
    }
    // The fusion results and Forged Steel are in no pool, so they need no gate
    for (const id of ["FLAME_FURNACE", "TOXIC_DISTILLATE", "SUPERCONDUCTING_COIL", "FORGED_STEEL", "FOCUS_BAND"]) {
      expect(FORK_UNLOCK.gatedItems.has(id), id).toBe(false);
    }
  });

  it("reads the save's Endless unlock when no override is set, and the dev unlock override", async () => {
    game.override.forkContentUnlocked(null);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const { gameData } = game.scene;

    gameData.unlocks[Unlockables.ENDLESS_MODE] = false;
    expect(isForkContentUnlocked()).toBe(false);
    expect(isForkItemLocked("LIFE_ORB")).toBe(true);
    expect(isForkItemLocked("LEFTOVERS")).toBe(false);

    gameData.unlocks[Unlockables.ENDLESS_MODE] = true;
    expect(isForkContentUnlocked()).toBe(true);
    expect(isForkItemLocked("LIFE_ORB")).toBe(false);

    gameData.unlocks[Unlockables.ENDLESS_MODE] = false;
    game.override.enableUnlockable([Unlockables.ENDLESS_MODE]);
    expect(isForkContentUnlocked()).toBe(true);
  });

  it("offers no fork item while locked, and changes nothing else in the player's pool", async () => {
    game.override.forkContentUnlocked(false);
    await game.classicMode.startBattle(SpeciesId.GARCHOMP, SpeciesId.MELMETAL, SpeciesId.MACHAMP);

    const locked = offeredIds();
    game.override.forkContentUnlocked(true);
    const unlocked = offeredIds();

    const lockedPoolIds = [...FORK_UNLOCK.gatedItems].filter(id => locked.has(id));
    // Local fork (2026-11-12): 39 -> 45 with the six EV items; 2026-11-13: 46 with the Guard Token; 2026-11-16: 49 with
    // the Z-Ring, Dynamax Candy and Z crystals
    expect(lockedPoolIds).toHaveLength(49);
    expect(lockedPoolIds.filter(id => locked.get(id) !== false)).toEqual([]);
    // Unlocked, the plain ones are back (the others wait for their own conditions)
    const plain = ["ASSAULT_VEST", "BULLETPROOF_VEST", "LIFE_ORB", "CANDY_PILE", "CHOICE_SCARF", "METRONOME"];
    expect(plain.filter(id => unlocked.get(id) !== true)).toEqual([]);
    const changed = [...unlocked].filter(
      ([id, offered]) => !FORK_UNLOCK.gatedItems.has(id) && locked.get(id) !== offered,
    );
    expect(changed).toEqual([]);
    expect(unlocked.get("LEFTOVERS")).toBe(true);
  });

  it("rolls no fork item in any reward tier while locked", async () => {
    game.override.forkContentUnlocked(false);
    await game.classicMode.startBattle(SpeciesId.GARCHOMP, SpeciesId.MELMETAL, SpeciesId.MACHAMP);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const party = game.scene.getPlayerParty();
    regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0);
    for (const tier of [ModifierTier.GREAT, ModifierTier.ULTRA, ModifierTier.ROGUE, ModifierTier.MASTER]) {
      for (let i = 0; i < 5; i++) {
        for (const option of getPlayerModifierTypeOptions(4, party, [tier, tier, tier, tier])) {
          expect(FORK_UNLOCK.gatedItems.has(option.type.id), option.type.id).toBe(false);
        }
      }
    }
  });

  it("leaves our own Mega Stones out of the form change items while locked", async () => {
    game.override.forkContentUnlocked(false);
    await game.classicMode.startBattle(SpeciesId.MELMETAL);
    await game.scene.addModifier(generateModifierType(modifierTypes.MEGA_BRACELET)!.newModifier()!);

    // Melmetal's only Mega Stone is ours (Melmetalite); its G-Max needs the Dynamax Band, not held here
    expect(generateModifierType(modifierTypes.RARE_FORM_CHANGE_ITEM)).toBeNull();

    game.override.forkContentUnlocked(true);
    const stone = generateModifierType(modifierTypes.RARE_FORM_CHANGE_ITEM);
    expect(stone).toBeInstanceOf(FormChangeItemModifierType);
    expect((stone as FormChangeItemModifierType).formChangeItem).toBe(FormChangeItem.MELMETALITE);
  });

  it("gives enemies no fork item while locked, without a roll", async () => {
    game.override
      .forkContentUnlocked(false)
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER, trainerVariant: TrainerVariant.DEFAULT });
    game.override.removeEnemyStartingItems = false;
    const dice = vi.spyOn(enemyCustomItemDice, "roll").mockReturnValue(0);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const forkIds = new Set<string>(ENEMY_CUSTOM_ITEMS.candidates.map(c => c.id));
    const enemies = game.scene.getEnemyParty();
    expect(enemies.length).toBeGreaterThan(0);
    for (const enemy of enemies) {
      expect(enemy.getHeldItems().filter(m => forkIds.has(m.type.id))).toEqual([]);
      expect(rollEnemyCustomItems(enemy, 75)).toEqual([]);
    }
    expect(dice).not.toHaveBeenCalled();

    // Unlocked, the same forced rolls give one
    game.override.forkContentUnlocked(true);
    expect(rollEnemyCustomItems(game.field.getEnemyPokemon(), 75)).toHaveLength(1);
  });

  it("uses the base passives while locked, keeps the choices, and brings ours back once unlocked", async () => {
    game.override.forkContentUnlocked(false).enemyHasPassiveAbility(true);
    await game.classicMode.startBattle(SpeciesId.GARCHOMP, SpeciesId.FEEBAS);
    const [garchomp, feebas] = game.scene.getPlayerParty();
    const base = garchomp.species.getPassiveAbility(garchomp.formIndex);
    const ours = garchomp.species.getCustomPassiveAbility(garchomp.formIndex);
    expect(ours).toBe(AbilityId.MOXIE);
    expect(base).not.toBe(ours);

    // The player's choice
    garchomp.customPassiveSpecies = [SpeciesId.GARCHOMP];
    expect(garchomp.usesCustomPassive()).toBe(false);
    expect(garchomp.getPassiveAbility()).toBe(allAbilities[base]);
    expect(garchomp.customPassiveSpecies).toEqual([SpeciesId.GARCHOMP]);
    // A species that takes over the choice (Weird Dream, GTS) still inherits it for later
    feebas.inheritPassiveChoice(garchomp);
    expect(feebas.customPassiveSpecies).toContain(SpeciesId.FEEBAS);

    // The enemy's 1-in-8 roll
    const enemy = game.field.getEnemyPokemon();
    enemy.id = idWithRoll(true);
    expect(enemy.usesCustomPassive()).toBe(false);
    expect(enemy.getPassiveAbility()).toBe(allAbilities[base]);

    game.override.forkContentUnlocked(true);
    expect(garchomp.usesCustomPassive()).toBe(true);
    expect(garchomp.getPassiveAbility()).toBe(allAbilities[AbilityId.MOXIE]);
    expect(enemy.usesCustomPassive()).toBe(true);
    expect(enemy.getPassiveAbility()).toBe(allAbilities[AbilityId.MOXIE]);
  });

  // Local fork (2026-11-12), review: the Pokédex page shows the passive a species uses, so locked it is the base one
  it("shows the base passive on the Pokédex page while locked, ours once unlocked", async () => {
    await game.runToTitle();
    const garchomp = speciesDataRegistry.getSpecies(SpeciesId.GARCHOMP);
    game.scene.gameData.starterData[SpeciesId.GIBLE].customPassiveSpecies = [SpeciesId.GARCHOMP];
    game.override.forkContentUnlocked(false);
    await game.scene.ui.setOverlayMode(UiMode.POKEDEX_PAGE, garchomp, {});
    const handler = game.scene.ui.getHandler();
    expect(handler).toBeInstanceOf(PokedexPageUiHandler);
    const page = handler as PokedexPageUiHandler;
    expect(page["passive"]).toBe(garchomp.getPassiveAbility(0));
    expect(page["passive"]).not.toBe(AbilityId.MOXIE);

    game.override.forkContentUnlocked(true);
    page["starterSetup"]();
    expect(page["passive"]).toBe(AbilityId.MOXIE);
    // The choice itself was never touched
    expect(game.scene.gameData.starterData[SpeciesId.GIBLE].customPassiveSpecies).toEqual([SpeciesId.GARCHOMP]);
  });

  it("has the starter menu's locked passive texts", () => {
    expect(i18next.t("starterSelectUiHandler:managePassiveLocked")).toBe("Choose Passives (Locked)");
    expect(i18next.t("starterSelectUiHandler:customPassiveLocked")).toBe(
      "Custom passives unlock once you clear Classic.",
    );
  });
});
