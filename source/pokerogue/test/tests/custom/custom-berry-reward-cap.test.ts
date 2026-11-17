import { getGameMode } from "#app/game-mode";
import { ENDLESS_HELD_ITEM_CAPS } from "#balance/endless-balance";
import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BerryType } from "#enums/berry-type";
import { GameModes } from "#enums/game-modes";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import { BerryModifier } from "#modifiers/modifier";
import {
  type BerryModifierType,
  getFullBerryTypes,
  type ModifierTypeGenerator,
  type PokemonHeldItemModifierType,
} from "#modifiers/modifier-type";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import { PartyUiHandler } from "#ui/party-ui-handler";
import { getEnumValues } from "#utils/enums";
import { getModifierPoolForType } from "#utils/modifier-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local fork, the user's request of 2026-11-06:
 * - every berry stacks to 20 for the player's Pokémon in Endless (was 99);
 * - a stack already above 20 from an older save is kept, but can't grow until it is eaten below 20;
 * - a berry type is not offered as a reward while even one of the player's Pokémon holds its maximum;
 * - the same rule for the Wide Lens (광각렌즈), the only other held item the user chose for it.
 */
describe("Custom - berry cap 20 and full berries left out of rewards", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.UNNERVE)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.UNNERVE)
      .moveset([MoveId.SPLASH])
      .startingLevel(50);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function startEndless(species: SpeciesId[]): Promise<void> {
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.ENDLESS);
      game.scene.offsetGym = false;
      const starters = generateStarters(game.scene, species);
      const selectStarterPhase = new SelectStarterPhase();
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      selectStarterPhase.initBattle(starters);
    });
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    await game.phaseInterceptor.to("CommandPhase", false);
  }

  function berry(pokemon: Pokemon, berryType: BerryType): BerryModifier | undefined {
    return pokemon.getHeldItems().find(m => m instanceof BerryModifier && m.berryType === berryType) as
      | BerryModifier
      | undefined;
  }

  /** Gives `pokemon` a stack of `count` berries of `berryType`, bypassing the cap like an old save would */
  function setBerries(pokemon: Pokemon, berryType: BerryType, count: number): BerryModifier {
    let mod = berry(pokemon, berryType);
    if (!mod) {
      const type = (modifierTypes.BERRY() as ModifierTypeGenerator).generateType([], [berryType]) as BerryModifierType;
      mod = type.newModifier(pokemon) as BerryModifier;
      mod.stackCount = count;
      game.scene.addModifier(mod, true, false, false, true);
      mod = berry(pokemon, berryType)!;
    }
    mod.stackCount = count;
    return mod;
  }

  /** Rolls the reward berry generator `n` times for `party` and counts the types */
  function rollBerries(party: readonly Pokemon[], n: number): Map<BerryType | null, number> {
    const counts = new Map<BerryType | null, number>();
    const generator = modifierTypes.BERRY() as ModifierTypeGenerator;
    for (let i = 0; i < n; i++) {
      const type = generator.generateType(party) as BerryModifierType | null;
      const key = type ? (type.getPregenArgs()[0] as BerryType) : null;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  it("caps every berry at 20 for the player in Endless", async () => {
    expect(ENDLESS_HELD_ITEM_CAPS.BERRY).toBe(20);
    await startEndless([SpeciesId.FEEBAS]);
    const player = game.field.getPlayerPokemon();
    for (const berryType of getEnumValues(BerryType)) {
      expect(setBerries(player, berryType, 1).getMaxStackCount(), BerryType[berryType]).toBe(20);
    }
  });

  it("keeps a stack above 20 but lets it gain nothing until it is eaten below 20", async () => {
    await startEndless([SpeciesId.FEEBAS]);
    const player = game.field.getPlayerPokemon();
    const sitrus = setBerries(player, BerryType.SITRUS, 35);
    expect(sitrus.getStackCount()).toBe(35);

    // No room: reward pickup, transfers and the party screen all treat it as full
    expect(game.scene.hasRoomForHeldItem(sitrus, player)).toBe(false);
    const extra = sitrus.clone();
    extra.stackCount = 1;
    game.scene.addModifier(extra, true, false, false, true);
    expect(berry(player, BerryType.SITRUS)!.getStackCount()).toBe(35);

    const sitrusType = (modifierTypes.BERRY() as ModifierTypeGenerator).generateType(
      [],
      [BerryType.SITRUS],
    ) as PokemonHeldItemModifierType;
    expect(sitrusType.selectFilter!(player)).not.toBeNull();
    expect(PartyUiHandler.FilterItemMaxStacks(player, sitrus)).not.toBeNull();

    // Eaten down to 19: room for one again
    sitrus.stackCount = 19;
    expect(game.scene.hasRoomForHeldItem(sitrus, player)).toBe(true);
    expect(sitrusType.selectFilter!(player)).toBeNull();
  });

  it("leaves a berry out of the rewards when only one of several Pokémon holds 20", async () => {
    await startEndless([SpeciesId.FEEBAS, SpeciesId.MAGIKARP]);
    const [first, second] = game.scene.getPlayerParty();
    setBerries(first, BerryType.SITRUS, 20);
    setBerries(first, BerryType.LUM, 27); // over the cap from an older save
    setBerries(first, BerryType.LEPPA, 19); // one short: still offered
    setBerries(second, BerryType.LIECHI, 20);
    // The second Pokémon has room for Sitrus and Lum, which must not matter
    expect(berry(second, BerryType.SITRUS)).toBeUndefined();

    const party = game.scene.getPlayerParty();
    expect([...getFullBerryTypes(party)].sort()).toEqual([BerryType.SITRUS, BerryType.LUM, BerryType.LIECHI].sort());

    const counts = rollBerries(party, 3000);
    expect(counts.get(BerryType.SITRUS) ?? 0).toBe(0);
    expect(counts.get(BerryType.LUM) ?? 0).toBe(0);
    expect(counts.get(BerryType.LIECHI) ?? 0).toBe(0);
    expect(counts.get(null) ?? 0).toBe(0);
    // The rest keep their relative odds. Of the 96 weight, Sitrus 16 + Lum 16 + Liechi 6 are gone, leaving 58:
    // Leppa 16/58 (about 27.6%), each of the seven other berries 6/58 (about 10.3%)
    expect((counts.get(BerryType.LEPPA) ?? 0) / 3000).toBeGreaterThan(0.24);
    expect((counts.get(BerryType.LEPPA) ?? 0) / 3000).toBeLessThan(0.31);
    expect((counts.get(BerryType.STARF) ?? 0) / 3000).toBeGreaterThan(0.08);
    expect((counts.get(BerryType.STARF) ?? 0) / 3000).toBeLessThan(0.13);
  });

  it("offers no berry at all once every type is full on someone", async () => {
    await startEndless([SpeciesId.FEEBAS]);
    const player = game.field.getPlayerPokemon();
    for (const berryType of getEnumValues(BerryType)) {
      setBerries(player, berryType, 20);
    }
    // null makes the reward roll pick another item
    expect(rollBerries(game.scene.getPlayerParty(), 50).get(null)).toBe(50);
  });

  it("keeps the old odds while no berry is full, and never filters an enemy party", async () => {
    await startEndless([SpeciesId.FEEBAS]);
    const counts = rollBerries(game.scene.getPlayerParty(), 3000);
    expect(counts.get(null) ?? 0).toBe(0);
    // Sitrus 1/6, Starf 1/16
    expect((counts.get(BerryType.SITRUS) ?? 0) / 3000).toBeGreaterThan(0.14);
    expect((counts.get(BerryType.SITRUS) ?? 0) / 3000).toBeLessThan(0.2);
    expect((counts.get(BerryType.STARF) ?? 0) / 3000).toBeGreaterThan(0.045);
    expect((counts.get(BerryType.STARF) ?? 0) / 3000).toBeLessThan(0.085);

    const enemy = game.field.getEnemyPokemon();
    const player = game.field.getPlayerPokemon();
    setBerries(player, BerryType.SITRUS, 20);
    expect(getFullBerryTypes([enemy]).size).toBe(0);
    expect(getFullBerryTypes(game.scene.getPlayerParty()).has(BerryType.SITRUS)).toBe(true);
  });

  it("uses each mode's own cap: 2 Sitrus is already full in Classic", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const player = game.field.getPlayerPokemon();
    setBerries(player, BerryType.SITRUS, 2);
    expect(getFullBerryTypes(game.scene.getPlayerParty()).has(BerryType.SITRUS)).toBe(true);
    expect(rollBerries(game.scene.getPlayerParty(), 500).get(BerryType.SITRUS) ?? 0).toBe(0);
  });

  it("drops the Wide Lens from the Ultra pool once one Pokémon holds 3, even if another has none", async () => {
    await startEndless([SpeciesId.FEEBAS, SpeciesId.MAGIKARP]);
    const [first, second] = game.scene.getPlayerParty();
    const party = game.scene.getPlayerParty();
    const entry = getModifierPoolForType(ModifierPoolType.PLAYER)[ModifierTier.ULTRA].find(
      w => w.modifierType.id === "WIDE_LENS",
    )!;
    expect(entry).toBeDefined();
    expect(entry.maxWeight).toBe(7);
    const weight = entry.weight as WeightedModifierTypeWeightFunc;
    expect(weight(party, 0)).toBe(7);

    // Rewards stamp the type id with withIdFromFunc; the pool weight looks the lens up by that id
    const lensType = modifierTypes.WIDE_LENS().withIdFromFunc(modifierTypes.WIDE_LENS) as PokemonHeldItemModifierType;
    const lens = lensType.newModifier(first);
    lens.stackCount = 2;
    game.scene.addModifier(lens, true, false, false, true);
    const held = first.getHeldItems().find(m => m.type.id === "WIDE_LENS")!;
    expect(held.getMaxHeldItemCount(first)).toBe(3);
    expect(weight(party, 0)).toBe(7);

    held.stackCount = 3;
    expect(second.getHeldItems().some(m => m.type.id === "WIDE_LENS")).toBe(false);
    expect(weight(party, 0)).toBe(0);

    held.stackCount = 2;
    expect(weight(party, 0)).toBe(7);
  });
});
