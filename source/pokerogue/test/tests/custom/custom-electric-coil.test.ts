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
  DischargedCoilModifier,
  getCustomModifierClass,
  isLightBall,
  SHACKLES_GENE_CAULDRON,
  SuperconductingCoilModifier,
} from "#modifiers/custom-held-items";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import type { ModifierTypeGenerator, SpeciesStatBoosterModifierType } from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import { PartyUiHandler } from "#ui/party-ui-handler";
import { getModifierPoolForType } from "#utils/modifier-utils";
import { readFileSync } from "node:fs";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Local fork (2026-11-10): Discharged Coil (방전코일, ROGUE) and Superconducting Coil (초전도코일, MASTER, in no pool),
 * the Flame Cauldron / Flame Furnace pair for the Light Ball (전기구슬). The user: "방전코일 / 초전도코일 … 전기구슬
 * 얻으면 변하고 스피드 1.4배, 특이사항으로는 피카츄 계열이 소지 시 증가량 2배(스피드 1.8배)". Lean on purpose.
 */
describe("Custom held items - Discharged Coil, Superconducting Coil", () => {
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

  type Name = "DISCHARGED_COIL" | "SUPERCONDUCTING_COIL";
  const newItem = (name: Name, pokemon: Pokemon) =>
    modifierTypes[name]().withIdFromFunc(modifierTypes[name]).newModifier(pokemon) as PokemonHeldItemModifier;
  const lightBallGenerator = () =>
    modifierTypes
      .RARE_SPECIES_STAT_BOOSTER()
      .withIdFromFunc(modifierTypes.RARE_SPECIES_STAT_BOOSTER) as ModifierTypeGenerator;
  const newLightBall = (pokemon: Pokemon) =>
    lightBallGenerator().generateType([], ["LIGHT_BALL"])!.newModifier(pokemon) as PokemonHeldItemModifier;
  /** The key of the rare species item the generator offers this party, or null when it offers none */
  const offered = (party: Pokemon[]) =>
    (lightBallGenerator().generateType(party) as SpeciesStatBoosterModifierType | null)?.key ?? null;
  const heldItem = (pokemon: Pokemon, id: string) => pokemon.getHeldItems().find(m => m.type.id === id);
  const weightOf = (tier: ModifierTier, id: string) =>
    getModifierPoolForType(ModifierPoolType.PLAYER)[tier].find(w => w.modifierType.id === id)!
      .weight as WeightedModifierTypeWeightFunc;
  /** The stat with held items is the stat without them times `numerator / denominator`, floored */
  function expectMultiplier(pokemon: Pokemon, stat: EffectiveStat, numerator: number, denominator = 1): void {
    const base = pokemon.getEffectiveStat(stat, { ignoreHeldItems: true });
    expect(pokemon.getEffectiveStat(stat), Stat[stat]).toBe(Math.floor((base * numerator) / denominator));
  }

  it("keeps its numbers, icons, text and save classes; the discharged coil is a ROGUE reward under the full-item rule", () => {
    expect(SHACKLES_GENE_CAULDRON.DISCHARGED_COIL).toEqual({ maxHeld: 1, poolWeight: 4 });
    expect(SHACKLES_GENE_CAULDRON.SUPERCONDUCTING_COIL).toEqual({
      maxHeld: 1,
      stats: [Stat.SPD],
      tenths: 14,
      boostedTenths: 18,
      boostedSpecies: [SpeciesId.PICHU, SpeciesId.PIKACHU, SpeciesId.RAICHU, SpeciesId.ALOLA_RAICHU],
    });
    expect(modifierTypes.DISCHARGED_COIL().iconImage).toBe("discharged_coil");
    expect(modifierTypes.SUPERCONDUCTING_COIL().iconImage).toBe("superconducting_coil");
    expect(getCustomModifierClass("DischargedCoilModifier")).toBe(DischargedCoilModifier);
    expect(getCustomModifierClass("SuperconductingCoilModifier")).toBe(SuperconductingCoilModifier);
    expect(FULL_RULE_HELD_ITEM_IDS.has("DISCHARGED_COIL")).toBe(true);
    expect(modifierTypes.SUPERCONDUCTING_COIL().tier).toBe(ModifierTier.MASTER);
    const pool = Object.values(getModifierPoolForType(ModifierPoolType.PLAYER)).flat();
    expect(pool.filter(w => w.modifierType.id === "DISCHARGED_COIL").map(w => w.modifierType.tier)).toEqual([
      ModifierTier.ROGUE,
    ]);
    expect(pool.some(w => w.modifierType.id === "SUPERCONDUCTING_COIL")).toBe(false);

    const entries = (lang: string) =>
      JSON.parse(readFileSync(`./locales/${lang}/modifier-type.json`, "utf8")).ModifierType;
    expect(entries("ko").DISCHARGED_COIL.name).toBe("방전코일");
    expect(entries("ko").SUPERCONDUCTING_COIL.name).toBe("초전도코일");
    // The user's text (2026-11-10): "막힘없이 흐르는 전류로 스피드를 빠르게 만들어준다, 피카츄 계열이 지니면 효과가 배가 된다"
    expect(entries("ko").SUPERCONDUCTING_COIL.description).toBe(
      "전기를 가득 머금어 초전도 상태가 된 코일이다. 막힘없이 흐르는 전류로 스피드를 빠르게 만들어준다, 피카츄 계열이 지니면 효과가 배가 된다.",
    );
    expect(entries("en").DISCHARGED_COIL.name).toBe("Discharged Coil");
    expect(entries("en").SUPERCONDUCTING_COIL.name).toBe("Superconducting Coil");
  });

  it("the discharged coil does nothing; the superconducting coil raises only Speed, x1.4 or x1.8 for the Pikachu line", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS, SpeciesId.PIKACHU, SpeciesId.ALOLA_RAICHU);
    const [snorlax, feebas, pikachu, raichu] = game.scene.getPlayerParty();
    game.scene.addModifier(newItem("DISCHARGED_COIL", snorlax), true);
    for (const p of [feebas, pikachu, raichu]) {
      game.scene.addModifier(newItem("SUPERCONDUCTING_COIL", p), true);
    }
    expect(heldItem(snorlax, "DISCHARGED_COIL")).toBeInstanceOf(DischargedCoilModifier);
    for (const stat of [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD] as const) {
      expectMultiplier(snorlax, stat, 1);
      expectMultiplier(feebas, stat, stat === Stat.SPD ? 14 : 10, 10);
      expectMultiplier(pikachu, stat, stat === Stat.SPD ? 18 : 10, 10);
      expectMultiplier(raichu, stat, stat === Stat.SPD ? 18 : 10, 10);
    }
  });

  it("takes in a Light Ball and becomes the superconducting coil, whichever arrives second", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU);
    const [snorlax, pikachu] = game.scene.getPlayerParty();
    const ball = newLightBall(snorlax);
    expect(isLightBall(ball)).toBe(true);
    game.scene.addModifier(newItem("DISCHARGED_COIL", snorlax), true);
    game.scene.addModifier(ball, true);
    expect(snorlax.getHeldItems().map(m => m.constructor.name)).toEqual(["SuperconductingCoilModifier"]);

    // A Pikachu already holding a Light Ball: the coil arrives second and takes it in
    game.scene.addModifier(newLightBall(pikachu), true);
    game.scene.addModifier(newItem("DISCHARGED_COIL", pikachu), true);
    expect(pikachu.getHeldItems().map(m => m.constructor.name)).toEqual(["SuperconductingCoilModifier"]);
  });

  // Local fork (2026-11-10): the superconducting coil counted as a Light Ball at first; the user: "초전도코일을 지닌 피카츄
  // … 전기 구슬이 나오도록 하죠"
  it("a discharged coil calls the Light Ball for any species; a Pikachu with a superconducting coil still calls it", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU);
    const party = game.scene.getPlayerParty();
    const [snorlax, pikachu] = party;
    expect(offered([snorlax])).toBeNull();
    game.scene.addModifier(newItem("DISCHARGED_COIL", snorlax), true);
    expect(offered([snorlax])).toBe("LIGHT_BALL");
    game.scene.addModifier(newLightBall(snorlax), true);
    expect(heldItem(snorlax, "SUPERCONDUCTING_COIL")).toBeDefined();
    // Done with the Light Ball: a superconducting coil alone is no reason
    expect(offered([snorlax])).toBeNull();

    expect(game.scene.tryTransferHeldItemModifier(heldItem(snorlax, "SUPERCONDUCTING_COIL")!, pikachu, false)).toBe(
      true,
    );
    expect(offered([pikachu])).toBe("LIGHT_BALL");
    // The Light Ball it then gets stays (nothing left to take it in) and works beside the coil
    game.scene.addModifier(newLightBall(pikachu), true);
    expect(
      pikachu
        .getHeldItems()
        .map(m => m.constructor.name)
        .sort(),
    ).toEqual(["SpeciesStatBoosterModifier", "SuperconductingCoilModifier"]);
    expectMultiplier(pikachu, Stat.ATK, 2);
    expectMultiplier(pikachu, Stat.SPD, 18, 10);
    expect(offered([pikachu])).toBeNull();
  });

  it("a superconducting coil keeps discharged coils out of rewards, and its holder cannot take one", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);
    const party = game.scene.getPlayerParty();
    const [snorlax, feebas] = party;
    const weight = weightOf(ModifierTier.ROGUE, "DISCHARGED_COIL");
    expect(weight(party, 0)).toBe(4);
    game.scene.addModifier(newItem("SUPERCONDUCTING_COIL", snorlax), true);
    expect(weight(party, 0)).toBe(0);

    expect(modifierTypes.DISCHARGED_COIL().selectFilter!(snorlax as PlayerPokemon)).not.toBeNull();
    expect(modifierTypes.DISCHARGED_COIL().selectFilter!(feebas as PlayerPokemon)).toBeNull();
    const feebasCoil = newItem("DISCHARGED_COIL", feebas);
    game.scene.addModifier(feebasCoil, true);
    expect(PartyUiHandler.FilterItemMaxStacks(snorlax as PlayerPokemon, feebasCoil)).not.toBeNull();
    expect(game.scene.tryTransferHeldItemModifier(feebasCoil, snorlax, false)).toBe(false);
    expect(heldItem(snorlax, "DISCHARGED_COIL")).toBeUndefined();
  });
});
