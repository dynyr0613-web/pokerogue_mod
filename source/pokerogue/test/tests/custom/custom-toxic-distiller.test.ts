import { FULL_RULE_HELD_ITEM_IDS } from "#balance/endless-balance";
import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { EffectiveStat } from "#enums/stat";
import { Stat } from "#enums/stat";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import {
  FlameFurnaceModifier,
  getCustomModifierClass,
  SHACKLES_GENE_CAULDRON,
  ToxicDistillateModifier,
  ToxicDistillerModifier,
} from "#modifiers/custom-held-items";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import { PartyUiHandler } from "#ui/party-ui-handler";
import { getModifierPoolForType } from "#utils/modifier-utils";
import { readFileSync } from "node:fs";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Local fork (2026-11-10): Toxic Distiller (맹독증류기, ROGUE) and Toxic Distillate (맹독증류액, MASTER, in no pool), the
 * Flame Cauldron / Flame Furnace pair for the Toxic Orb. The user: "맹독 증류기(화염 가마솥과 동일하되 맹독구슬 버전,
 * 올려주는 스탯은 방어와 특수방어 1.3배)". Lean on purpose: one absorb test is enough.
 */
describe("Custom held items - Toxic Distiller, Toxic Distillate", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(5)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH, MoveId.TACKLE]);
  });

  type Name = "TOXIC_DISTILLER" | "TOXIC_DISTILLATE" | "FLAME_CAULDRON" | "TOXIC_ORB" | "FLAME_ORB";
  const newItem = (name: Name, pokemon: Pokemon) =>
    modifierTypes[name]().withIdFromFunc(modifierTypes[name]).newModifier(pokemon) as PokemonHeldItemModifier;
  const heldItem = (pokemon: Pokemon, id: string) => pokemon.getHeldItems().find(m => m.type.id === id);
  const weightOf = (tier: ModifierTier, id: string) =>
    getModifierPoolForType(ModifierPoolType.PLAYER)[tier].find(w => w.modifierType.id === id)!
      .weight as WeightedModifierTypeWeightFunc;
  /** The stat with held items is the stat without them times `numerator / denominator`, floored */
  function expectMultiplier(pokemon: Pokemon, stat: EffectiveStat, numerator: number, denominator = 1): void {
    const base = pokemon.getEffectiveStat(stat, { ignoreHeldItems: true });
    expect(pokemon.getEffectiveStat(stat), Stat[stat]).toBe(Math.floor((base * numerator) / denominator));
  }

  it("keeps its numbers, icons, text and save classes; the distiller is a ROGUE reward under the full-item rule", () => {
    expect(SHACKLES_GENE_CAULDRON.TOXIC_DISTILLER).toEqual({ maxHeld: 1, poolWeight: 4 });
    expect(SHACKLES_GENE_CAULDRON.TOXIC_DISTILLATE).toEqual({
      maxHeld: 1,
      stats: [Stat.DEF, Stat.SPDEF],
      multiplier: 1.3,
    });
    expect(modifierTypes.TOXIC_DISTILLER().iconImage).toBe("toxic_distiller");
    expect(modifierTypes.TOXIC_DISTILLATE().iconImage).toBe("toxic_distillate");
    expect(getCustomModifierClass("ToxicDistillerModifier")).toBe(ToxicDistillerModifier);
    expect(getCustomModifierClass("ToxicDistillateModifier")).toBe(ToxicDistillateModifier);
    expect(FULL_RULE_HELD_ITEM_IDS.has("TOXIC_DISTILLER")).toBe(true);
    expect(modifierTypes.TOXIC_DISTILLATE().tier).toBe(ModifierTier.MASTER);
    const pool = Object.values(getModifierPoolForType(ModifierPoolType.PLAYER)).flat();
    expect(pool.filter(w => w.modifierType.id === "TOXIC_DISTILLER").map(w => w.modifierType.tier)).toEqual([
      ModifierTier.ROGUE,
    ]);
    expect(pool.some(w => w.modifierType.id === "TOXIC_DISTILLATE")).toBe(false);

    const entries = (lang: string) =>
      JSON.parse(readFileSync(`./locales/${lang}/modifier-type.json`, "utf8")).ModifierType;
    expect(entries("ko").TOXIC_DISTILLER).toEqual({
      name: "맹독증류기",
      description: "아무것도 담기지 않은 증류기다. 증류할 독한 무언가가 필요한 듯하다.",
    });
    expect(entries("ko").TOXIC_DISTILLATE).toEqual({
      name: "맹독증류액",
      description: "맹독이 진하게 증류되어 담긴 플라스크다. 독한 기운으로 방어와 특수방어를 1.3배로 만들어준다.",
    });
    expect(entries("en").TOXIC_DISTILLER.name).toBe("Toxic Distiller");
    expect(entries("en").TOXIC_DISTILLATE.name).toBe("Toxic Distillate");
  });

  it("the distiller does nothing; the distillate raises only Defense and Sp. Def x1.3", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);
    const [snorlax, feebas] = game.scene.getPlayerParty();
    game.scene.addModifier(newItem("TOXIC_DISTILLER", snorlax), true);
    game.scene.addModifier(newItem("TOXIC_DISTILLATE", feebas), true);
    expect(heldItem(snorlax, "TOXIC_DISTILLER")).toBeInstanceOf(ToxicDistillerModifier);
    expect(heldItem(feebas, "TOXIC_DISTILLATE")).toBeInstanceOf(ToxicDistillateModifier);
    for (const stat of [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD] as const) {
      expectMultiplier(snorlax, stat, 1);
      expectMultiplier(feebas, stat, stat === Stat.DEF || stat === Stat.SPDEF ? 13 : 10, 10);
    }
  });

  it("takes in a Toxic Orb and becomes the distillate; a cauldron on the same holder only takes the Flame Orb", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const snorlax = game.field.getPlayerPokemon();
    game.scene.addModifier(newItem("TOXIC_DISTILLER", snorlax), true);
    game.scene.addModifier(newItem("FLAME_CAULDRON", snorlax), true);

    game.scene.addModifier(newItem("TOXIC_ORB", snorlax), true);
    expect(heldItem(snorlax, "TOXIC_ORB")).toBeUndefined();
    expect(heldItem(snorlax, "TOXIC_DISTILLER")).toBeUndefined();
    expect(heldItem(snorlax, "TOXIC_DISTILLATE")).toBeInstanceOf(ToxicDistillateModifier);
    expect(heldItem(snorlax, "FLAME_CAULDRON")).toBeDefined();

    game.scene.addModifier(newItem("FLAME_ORB", snorlax), true);
    expect(heldItem(snorlax, "FLAME_FURNACE")).toBeInstanceOf(FlameFurnaceModifier);
    expect(heldItem(snorlax, "TOXIC_DISTILLATE")).toBeDefined();
    expect(
      snorlax
        .getHeldItems()
        .map(m => m.type.id)
        .sort(),
    ).toEqual(["FLAME_FURNACE", "TOXIC_DISTILLATE"]);
  });

  it("the shared ignition table still turns a cauldron saved as lit (2026-11-09) into a furnace", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const snorlax = game.field.getPlayerPokemon();
    const type = modifierTypes.FLAME_CAULDRON().withIdFromFunc(modifierTypes.FLAME_CAULDRON);
    // As the session loader builds it: the saved args [pokemonId, lit], then the stack count
    const Cauldron = getCustomModifierClass("FlameCauldronModifier")!;
    game.scene.addModifier(new Cauldron(type, snorlax.id, true, 1), true);
    expect(heldItem(snorlax, "FLAME_CAULDRON")).toBeUndefined();
    expect(heldItem(snorlax, "FLAME_FURNACE")).toBeInstanceOf(FlameFurnaceModifier);
  });

  it("a distillate keeps distillers out of rewards, and its holder cannot take a distiller", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);
    const party = game.scene.getPlayerParty();
    const [snorlax, feebas] = party;
    const weight = weightOf(ModifierTier.ROGUE, "TOXIC_DISTILLER");
    expect(weight(party, 0)).toBe(4);
    game.scene.addModifier(newItem("TOXIC_DISTILLATE", snorlax), true);
    expect(weight(party, 0)).toBe(0);

    expect(modifierTypes.TOXIC_DISTILLER().selectFilter!(snorlax as PlayerPokemon)).not.toBeNull();
    expect(modifierTypes.TOXIC_DISTILLER().selectFilter!(feebas as PlayerPokemon)).toBeNull();
    const feebasDistiller = newItem("TOXIC_DISTILLER", feebas);
    game.scene.addModifier(feebasDistiller, true);
    expect(PartyUiHandler.FilterItemMaxStacks(snorlax as PlayerPokemon, feebasDistiller)).not.toBeNull();
    expect(game.scene.tryTransferHeldItemModifier(feebasDistiller, snorlax, false)).toBe(false);
    expect(heldItem(snorlax, "TOXIC_DISTILLER")).toBeUndefined();
  });

  it("a distiller holder brings the Toxic Orb but not Radioactive Waste; not once it cannot be poisoned", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS, SpeciesId.MAGNEMITE);
    const party = game.scene.getPlayerParty();
    const [snorlax, feebas, magnemite] = party;
    const toxicOrb = weightOf(ModifierTier.ULTRA, "TOXIC_ORB");
    const waste = weightOf(ModifierTier.ROGUE, "RADIOACTIVE_WASTE");
    // Ball Fetch, Splash and Tackle, no Poison type: no reason for either
    expect([toxicOrb(party, 0), waste(party, 0)]).toEqual([0, 0]);

    game.scene.addModifier(newItem("TOXIC_DISTILLER", snorlax), true);
    expect([toxicOrb(party, 0), waste(party, 0)]).toEqual([10, 0]);
    // Not while the holder holds an orb (a Flame Orb, which a distiller does not take in)
    game.scene.addModifier(newItem("FLAME_ORB", snorlax), true);
    expect(heldItem(snorlax, "TOXIC_DISTILLER")).toBeDefined();
    expect(toxicOrb(party, 0)).toBe(0);
    expect(game.scene.tryTransferHeldItemModifier(heldItem(snorlax, "FLAME_ORB")!, feebas, false)).toBe(true);
    expect(toxicOrb(party, 0)).toBe(10);
    // Not for a holder that cannot be badly poisoned (Magnemite, a Steel type)
    expect(game.scene.tryTransferHeldItemModifier(heldItem(snorlax, "TOXIC_DISTILLER")!, magnemite, false)).toBe(true);
    expect([toxicOrb(party, 0), waste(party, 0)]).toEqual([0, 0]);
  });

  // Local fork (2026-11-10): the distillate counted as an orb at first; the user: "맹독증류액을 지닌 독폭주/포이즌힐
  // 포켓몬 … 맹독 구슬이 나오도록 하죠"
  it("a distillate holder with Poison Heal still brings the Toxic Orb, which it then keeps", async () => {
    game.override.ability(AbilityId.POISON_HEAL);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const party = game.scene.getPlayerParty();
    const snorlax = party[0];
    const toxicOrb = weightOf(ModifierTier.ULTRA, "TOXIC_ORB");
    game.scene.addModifier(newItem("TOXIC_DISTILLATE", snorlax), true);
    expect(toxicOrb(party, 0)).toBe(10);
    game.scene.addModifier(newItem("TOXIC_ORB", snorlax), true);
    expect(heldItem(snorlax, "TOXIC_ORB")).toBeDefined();
    expect(heldItem(snorlax, "TOXIC_DISTILLATE")).toBeDefined();
    expect(toxicOrb(party, 0)).toBe(0);
  });
});
