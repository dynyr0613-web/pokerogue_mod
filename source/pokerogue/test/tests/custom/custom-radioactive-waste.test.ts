import { FULL_RULE_HELD_ITEM_IDS } from "#balance/endless-balance";
import { modifierTypes } from "#data/data-lists";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import { getCustomModifierClass, RADIOACTIVE_WASTE, RadioactiveWasteModifier } from "#modifiers/custom-held-items";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import * as Modifier from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import { toDmgValue } from "#utils/common";
import { getModifierPoolForType } from "#utils/modifier-utils";
import { readFileSync } from "node:fs";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local fork (2026-11-09): Radioactive Waste (방사성폐기물), ROGUE, one per Pokémon. The user: "아이템: 방사성 폐기물 도
 * 추가해두죠. 독 포켓몬이 지니면 매턴 최대체력의 1/8 회복, 아니면 독 상태이상(강철 제외)가 되도록. 등급은 로그로 둡시다."
 */
describe("Custom held items - Radioactive Waste (방사성폐기물)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(5)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH, MoveId.TACKLE]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A fresh item for `pokemon`, with its type id set the way `overrideHeldItems` and the reward pools do. */
  function newItem(name: "RADIOACTIVE_WASTE" | "TOXIC_ORB", pokemon: Pokemon): PokemonHeldItemModifier {
    return modifierTypes[name]().withIdFromFunc(modifierTypes[name]).newModifier(pokemon) as PokemonHeldItemModifier;
  }

  function heldItem(pokemon: Pokemon, id: string): PokemonHeldItemModifier | undefined {
    return pokemon.getHeldItems().find(m => m.type.id === id);
  }

  function poolEntry(tier: ModifierTier, id: string) {
    return getModifierPoolForType(ModifierPoolType.PLAYER)[tier].find(w => w.modifierType.id === id);
  }

  /** One turn of Splash on both sides */
  async function splashTurn(): Promise<void> {
    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();
  }

  it("keeps its numbers in one table: one per Pokémon, weight 4, 1/8 heal, regular poison", () => {
    expect(RADIOACTIVE_WASTE).toEqual({
      maxHeld: 1,
      poolWeight: 4,
      healDivisor: 8,
      status: StatusEffect.POISON,
    });
  });

  it("has its icon, locale keys and Korean / English text, and is on the full-item rule list", () => {
    expect(modifierTypes.RADIOACTIVE_WASTE().iconImage).toBe("radioactive_waste");
    expect(modifierTypes.RADIOACTIVE_WASTE().localeKey).toBe("modifierType:ModifierType.RADIOACTIVE_WASTE");
    expect(getCustomModifierClass("RadioactiveWasteModifier")).toBe(RadioactiveWasteModifier);
    expect(FULL_RULE_HELD_ITEM_IDS.has("RADIOACTIVE_WASTE")).toBe(true);

    for (const [lang, expected] of [
      [
        "ko",
        {
          name: "방사성폐기물",
          description: "독 타입 포켓몬이 지니면 매 턴 최대 HP의 1/8을 회복한다. 다른 포켓몬이 지니면 독 상태가 된다.",
        },
      ],
      ["en", { name: "Radioactive Waste" }],
    ] as const) {
      const json = JSON.parse(readFileSync(`./locales/${lang}/modifier-type.json`, "utf8"));
      const entries: Record<string, { name: string; description: string }> = json.ModifierType;
      expect(entries.RADIOACTIVE_WASTE, lang).toMatchObject(expected);
      expect(entries.RADIOACTIVE_WASTE.description, lang).toBeTruthy();
      // Right after the Flame Cauldron, the ROGUE item added before it
      const keys = Object.keys(entries);
      expect(keys.indexOf("RADIOACTIVE_WASTE"), lang).toBe(keys.indexOf("FLAME_CAULDRON") + 1);
    }
    // The in-game Korean words the description uses
    expect(JSON.parse(readFileSync("./locales/ko/pokemon-info.json", "utf8")).type.poison).toBe("독");
    const status = JSON.parse(readFileSync("./locales/ko/status-effect.json", "utf8"));
    expect([status.poison.name, status.toxic.name]).toEqual(["독", "맹독"]);
  });

  it("has an untrimmed 32x32 frame in the items atlas", () => {
    const atlas = JSON.parse(readFileSync("./assets/images/items.json", "utf8"));
    const frames: { filename: string; sourceSize: { w: number; h: number }; trimmed: boolean }[] =
      atlas.textures[0].frames;
    const frame = frames.find(f => f.filename === "radioactive_waste");
    expect(frame).toBeDefined();
    expect(frame!.sourceSize).toEqual({ w: 32, h: 32 });
    expect(frame!.trimmed).toBe(false);
  });

  describe("held by a Poison type", () => {
    it("heals 1/8 of its max HP at the end of each turn, with Leftovers' message naming the item", async () => {
      game.override.startingHeldItems([{ name: "RADIOACTIVE_WASTE" }]);
      await game.classicMode.startBattle(SpeciesId.GRIMER);
      const grimer = game.field.getPlayerPokemon();
      const waste = heldItem(grimer, "RADIOACTIVE_WASTE")!;
      expect(waste).toBeInstanceOf(RadioactiveWasteModifier);
      expect(grimer.isOfType(PokemonType.POISON)).toBe(true);
      const max = grimer.getMaxHp();
      const start = Math.floor(max / 4);
      grimer.hp = start;
      const t = vi.spyOn(i18next, "t");

      await splashTurn();
      expect(grimer).toHaveHp(start + toDmgValue(max / 8));
      expect(t).toHaveBeenCalledWith("modifier:turnHealApply", expect.objectContaining({ typeName: waste.type.name }));

      await splashTurn();
      expect(grimer).toHaveHp(start + 2 * toDmgValue(max / 8));
      expect(grimer).toHaveStatusEffect(StatusEffect.NONE);
      // Not used up
      expect(heldItem(grimer, "RADIOACTIVE_WASTE")).toBe(waste);
    });

    it("does nothing at full HP and is never poisoned by it", async () => {
      game.override.startingHeldItems([{ name: "RADIOACTIVE_WASTE" }]);
      await game.classicMode.startBattle(SpeciesId.GRIMER);
      const grimer = game.field.getPlayerPokemon();
      const waste = heldItem(grimer, "RADIOACTIVE_WASTE")!;
      const apply = vi.spyOn(waste, "apply");
      const t = vi.spyOn(i18next, "t");

      await splashTurn();
      expect(grimer).toHaveFullHp();
      expect(grimer).toHaveStatusEffect(StatusEffect.NONE);
      expect(apply).toHaveBeenCalledWith(grimer, "heal");
      expect(apply).toHaveBeenCalledWith(grimer, "poison");
      expect(apply.mock.results.map(r => r.value)).toEqual([false, false]);
      expect(t).not.toHaveBeenCalledWith("modifier:turnHealApply", expect.anything());
    });

    it("is stopped by Heal Block, as Leftovers is", async () => {
      game.override.startingHeldItems([{ name: "RADIOACTIVE_WASTE" }]);
      await game.classicMode.startBattle(SpeciesId.GRIMER);
      const grimer = game.field.getPlayerPokemon();
      const start = Math.floor(grimer.getMaxHp() / 2);
      grimer.hp = start;
      grimer.addTag(BattlerTagType.HEAL_BLOCK, 5, MoveId.HEAL_BLOCK, game.field.getEnemyPokemon().id);

      await splashTurn();
      expect(grimer.getTag(BattlerTagType.HEAL_BLOCK)).toBeDefined();
      expect(grimer).toHaveHp(start);
    });

    it("counts the Tera Type: a Snorlax Terastallized into Poison heals and is not poisoned", async () => {
      game.override.startingHeldItems([{ name: "RADIOACTIVE_WASTE" }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();
      snorlax.teraType = PokemonType.POISON;
      snorlax.isTerastallized = true;
      expect(snorlax.isOfType(PokemonType.POISON)).toBe(true);
      const max = snorlax.getMaxHp();
      const start = Math.floor(max / 2);
      snorlax.hp = start;

      await splashTurn();
      expect(snorlax).toHaveHp(start + toDmgValue(max / 8));
      expect(snorlax).toHaveStatusEffect(StatusEffect.NONE);
    });

    // Local fork (2026-11-09): reviewer finding. A Stellar Tera keeps its original types for the item, the same view
    // `canSetStatus` uses; before, the holder neither healed nor (being Poison there) got poisoned, and with Corrosion
    // it poisoned itself every turn
    it.each([
      { what: "no ability", ability: AbilityId.BALL_FETCH },
      { what: "Corrosion", ability: AbilityId.CORROSION },
    ])("keeps healing after a Stellar Tera, which keeps the original types ($what)", async ({ ability }) => {
      game.override.startingHeldItems([{ name: "RADIOACTIVE_WASTE" }]).ability(ability);
      await game.classicMode.startBattle(SpeciesId.GRIMER);
      const grimer = game.field.getPlayerPokemon();
      grimer.teraType = PokemonType.STELLAR;
      grimer.isTerastallized = true;
      // The default view sees only Stellar
      expect(grimer.isOfType(PokemonType.POISON)).toBe(false);
      expect(grimer.isOfType(PokemonType.POISON, { returnOriginalTypesIfStellar: true })).toBe(true);
      const max = grimer.getMaxHp();
      const start = Math.floor(max / 2);
      grimer.hp = start;

      await splashTurn();
      expect(grimer).toHaveHp(start + toDmgValue(max / 8));
      expect(grimer).toHaveStatusEffect(StatusEffect.NONE);
    });

    it("works for an enemy holder", async () => {
      game.override.enemySpecies(SpeciesId.GRIMER).enemyHeldItems([{ name: "RADIOACTIVE_WASTE" }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const enemy = game.field.getEnemyPokemon();
      const max = enemy.getMaxHp();
      enemy.hp = 1;

      await splashTurn();
      expect(enemy).toHaveHp(1 + toDmgValue(max / 8));
      expect(enemy).toHaveStatusEffect(StatusEffect.NONE);
    });
  });

  describe("held by any other Pokémon", () => {
    it("poisons the holder (regular poison, not bad poison) at the end of the turn, naming the item", async () => {
      game.override.startingHeldItems([{ name: "RADIOACTIVE_WASTE" }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();
      const waste = heldItem(snorlax, "RADIOACTIVE_WASTE")!;
      const t = vi.spyOn(i18next, "t");

      await splashTurn();
      expect(snorlax).toHaveStatusEffect(StatusEffect.POISON);
      expect(t).toHaveBeenCalledWith(
        "statusEffect:poison.obtainSource",
        expect.objectContaining({ sourceText: waste.type.name }),
      );
      expect(t).not.toHaveBeenCalledWith("statusEffect:toxic.obtainSource", expect.anything());
      // Not used up, and no heal for a non-Poison holder
      expect(heldItem(snorlax, "RADIOACTIVE_WASTE")).toBe(waste);
      expect(t).not.toHaveBeenCalledWith("modifier:turnHealApply", expect.anything());
    });

    it("does not heal a non-Poison holder that has lost HP", async () => {
      game.override.startingHeldItems([{ name: "RADIOACTIVE_WASTE" }]).ability(AbilityId.IMMUNITY);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();
      const start = Math.floor(snorlax.getMaxHp() / 2);
      snorlax.hp = start;

      await splashTurn();
      expect(snorlax).toHaveHp(start);
      expect(snorlax).toHaveStatusEffect(StatusEffect.NONE);
    });

    it.each([
      { what: "a Steel type", species: SpeciesId.REGISTEEL, ability: AbilityId.BALL_FETCH },
      { what: "a Steel / Ground type", species: SpeciesId.STEELIX, ability: AbilityId.BALL_FETCH },
      { what: "a Pokémon with Immunity", species: SpeciesId.SNORLAX, ability: AbilityId.IMMUNITY },
    ])("does not poison $what", async ({ species, ability }) => {
      game.override.startingHeldItems([{ name: "RADIOACTIVE_WASTE" }]).ability(ability);
      await game.classicMode.startBattle(species);
      const holder = game.field.getPlayerPokemon();
      expect(holder.isOfType(PokemonType.POISON)).toBe(false);

      await splashTurn();
      expect(holder).toHaveStatusEffect(StatusEffect.NONE);
      expect(holder).toHaveFullHp();
    });

    // Local fork (2026-11-09): reviewer finding. The user's "강철 제외" holds even with Corrosion, which lets a held
    // Toxic Orb poison a Steel type (abilities/corrosion.test.ts)
    it.each([
      { what: "a Steel type", species: SpeciesId.REGISTEEL, tera: undefined },
      { what: "a Pokémon Terastallized into Steel", species: SpeciesId.SNORLAX, tera: PokemonType.STEEL },
      { what: "a Steel type Terastallized into Stellar", species: SpeciesId.REGISTEEL, tera: PokemonType.STELLAR },
    ])("does not poison $what with Corrosion either", async ({ species, tera }) => {
      game.override.startingHeldItems([{ name: "RADIOACTIVE_WASTE" }]).ability(AbilityId.CORROSION);
      await game.classicMode.startBattle(species);
      const holder = game.field.getPlayerPokemon();
      if (tera !== undefined) {
        holder.teraType = tera;
        holder.isTerastallized = true;
      }

      await splashTurn();
      expect(holder).toHaveStatusEffect(StatusEffect.NONE);
      expect(holder).toHaveFullHp();
    });

    // Local fork (2026-11-09): reviewer finding. Like the Toxic Orb, the holder is the source of its own poison, so
    // Safeguard (which only stops other Pokémon's statuses) does not stop it; Misty Terrain does
    it("is not stopped by Safeguard, as the Toxic Orb is not", async () => {
      game.override.startingHeldItems([{ name: "RADIOACTIVE_WASTE" }]).moveset([MoveId.SAFEGUARD]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();

      game.move.select(MoveId.SAFEGUARD);
      await game.toNextTurn();
      expect(game.scene.arena.getTagOnSide(ArenaTagType.SAFEGUARD, ArenaTagSide.PLAYER)).toBeDefined();
      expect(snorlax).toHaveStatusEffect(StatusEffect.POISON);
    });

    it("is stopped by Misty Terrain", async () => {
      game.override.startingHeldItems([{ name: "RADIOACTIVE_WASTE" }]).enemyAbility(AbilityId.MISTY_SURGE);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();
      expect(game.scene.arena.terrain?.terrainType).toBe(TerrainType.MISTY);

      await splashTurn();
      expect(game.scene.arena.terrain?.terrainType).toBe(TerrainType.MISTY);
      expect(snorlax).toHaveStatusEffect(StatusEffect.NONE);
    });

    it("does not change a status the holder already has", async () => {
      game.override.startingHeldItems([{ name: "RADIOACTIVE_WASTE" }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();
      snorlax.doSetStatus(StatusEffect.BURN);

      await splashTurn();
      expect(snorlax).toHaveStatusEffect(StatusEffect.BURN);
    });

    it("is not an orb: held with a Toxic Orb, the orb acts first and the holder is badly poisoned", async () => {
      game.override.startingHeldItems([{ name: "TOXIC_ORB" }, { name: "RADIOACTIVE_WASTE" }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();
      const waste = heldItem(snorlax, "RADIOACTIVE_WASTE")!;
      expect(waste).not.toBeInstanceOf(Modifier.TurnStatusEffectModifier);
      expect(heldItem(snorlax, "TOXIC_ORB")).toBeDefined();
      expect(waste.matchType(heldItem(snorlax, "TOXIC_ORB")!)).toBe(false);

      await splashTurn();
      expect(snorlax).toHaveStatusEffect(StatusEffect.TOXIC);
      expect(snorlax.getHeldItems().map(m => m.type.id)).toEqual(["TOXIC_ORB", "RADIOACTIVE_WASTE"]);
    });

    it("works for an enemy holder", async () => {
      game.override.enemyHeldItems([{ name: "RADIOACTIVE_WASTE" }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const enemy = game.field.getEnemyPokemon();

      await splashTurn();
      expect(enemy).toHaveStatusEffect(StatusEffect.POISON);
    });
  });

  it("is one per Pokémon, and moves to another Pokémon that has none", async () => {
    game.override.startingHeldItems([{ name: "RADIOACTIVE_WASTE" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);
    const [snorlax, feebas] = game.scene.getPlayerParty();
    const waste = heldItem(snorlax, "RADIOACTIVE_WASTE")!;
    expect(waste.getMaxHeldItemCount(snorlax)).toBe(1);
    expect(waste.isTransferable).toBe(true);
    game.scene.addModifier(newItem("RADIOACTIVE_WASTE", snorlax), true);
    expect(waste.stackCount).toBe(1);

    const feebasWaste = newItem("RADIOACTIVE_WASTE", feebas);
    game.scene.addModifier(feebasWaste, true);
    expect(game.scene.tryTransferHeldItemModifier(feebasWaste, snorlax, false)).toBe(false);
    expect(waste.stackCount).toBe(1);

    game.scene.removeModifier(heldItem(feebas, "RADIOACTIVE_WASTE")!);
    expect(game.scene.tryTransferHeldItemModifier(waste, feebas, false)).toBe(true);
    expect(heldItem(snorlax, "RADIOACTIVE_WASTE")).toBeUndefined();
    expect(heldItem(feebas, "RADIOACTIVE_WASTE")).toBeInstanceOf(RadioactiveWasteModifier);
  });

  describe("save data", () => {
    it("saves only the holder's id and comes back as its own class", async () => {
      game.override.startingHeldItems([{ name: "RADIOACTIVE_WASTE" }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();
      const waste = heldItem(snorlax, "RADIOACTIVE_WASTE")!;
      expect(waste.getArgs()).toEqual([snorlax.id]);
      expect(waste.clone()).toBeInstanceOf(RadioactiveWasteModifier);
      expect(waste.clone().getArgs()).toEqual([snorlax.id]);

      const { gameData } = game.scene;
      const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
      const session = gameData.parseSessionData(json);
      const saved = session.modifiers.find(m => m.typeId === "RADIOACTIVE_WASTE")!;
      expect(saved.className).toBe("RadioactiveWasteModifier");
      expect(saved.args).toEqual([snorlax.id]);
      expect(saved.stackCount).toBe(1);
      // `GameData.loadSession` looks the class up in the `modifier.ts` namespace, where it is absent
      expect(Modifier[saved.className]).toBeUndefined();
      const restored = saved.toModifier(Modifier[saved.className]) as PokemonHeldItemModifier;
      expect(restored).toBeInstanceOf(RadioactiveWasteModifier);
      expect(restored.type.id).toBe("RADIOACTIVE_WASTE");
      expect(restored.pokemonId).toBe(snorlax.id);
      expect(restored.match(waste)).toBe(true);
      saved.stackCount = 3;
      expect(saved.toModifier(Modifier[saved.className])!.stackCount).toBe(1);
    });

    it("survives a full session reload and still poisons its holder", async () => {
      game.override.startingHeldItems([{ name: "RADIOACTIVE_WASTE" }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();

      const { gameData } = game.scene;
      const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
      game.reload["sessionData"] = gameData.parseSessionData(json);
      await game.reload.reloadSession();

      const loaded = game.field.getPlayerPokemon();
      expect(loaded).not.toBe(snorlax);
      expect(loaded.getHeldItems().map(m => `${m.type.id}x${m.stackCount}`)).toEqual(["RADIOACTIVE_WASTEx1"]);
      expect(heldItem(loaded, "RADIOACTIVE_WASTE")).toBeInstanceOf(RadioactiveWasteModifier);

      await splashTurn();
      expect(loaded).toHaveStatusEffect(StatusEffect.POISON);
    });
  });

  describe("reward pool", () => {
    function wasteWeight(party: Pokemon[]): number {
      return (poolEntry(ModifierTier.ROGUE, "RADIOACTIVE_WASTE")!.weight as WeightedModifierTypeWeightFunc)(party, 0);
    }

    it("sits in ROGUE only, at weight 4", () => {
      const entry = poolEntry(ModifierTier.ROGUE, "RADIOACTIVE_WASTE")!;
      expect(entry).toBeDefined();
      expect(entry.modifierType.tier).toBe(ModifierTier.ROGUE);
      expect(entry.maxWeight).toBe(4);
      expect(entry.weight).toBeInstanceOf(Function);
      for (const tier of [ModifierTier.COMMON, ModifierTier.GREAT, ModifierTier.ULTRA, ModifierTier.MASTER]) {
        expect(poolEntry(tier, "RADIOACTIVE_WASTE"), `tier ${tier}`).toBeUndefined();
      }
      for (const poolType of [
        ModifierPoolType.TRAINER,
        ModifierPoolType.WILD,
        ModifierPoolType.ENEMY_BUFF,
        ModifierPoolType.DAILY_STARTER,
      ]) {
        const ids = Object.values(getModifierPoolForType(poolType))
          .flat()
          .map(w => w.modifierType.id);
        expect(ids, `${poolType}`).not.toContain("RADIOACTIVE_WASTE");
      }
    });

    it("is 0 when no party member is a Poison type or would want to be poisoned", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);
      expect(wasteWeight(game.scene.getPlayerParty())).toBe(0);
    });

    it("is 4 with a Poison type, and 0 once any party member holds one (the full-item rule)", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GRIMER);
      const party = game.scene.getPlayerParty();
      const [snorlax, grimer] = party;
      expect(wasteWeight(party)).toBe(4);

      game.scene.addModifier(newItem("RADIOACTIVE_WASTE", grimer), true);
      expect(wasteWeight(party)).toBe(0);
      game.scene.removeModifier(heldItem(grimer, "RADIOACTIVE_WASTE")!);
      expect(wasteWeight(party)).toBe(4);

      // Held by Snorlax, who does not want it: still left out, though Grimer has none
      game.scene.addModifier(newItem("RADIOACTIVE_WASTE", snorlax), true);
      expect(heldItem(grimer, "RADIOACTIVE_WASTE")).toBeUndefined();
      expect(wasteWeight(party)).toBe(0);
    });

    // Local fork (2026-11-09): the same view of the types as the item itself (reviewer finding)
    it("still counts a Poison type Terastallized into Stellar", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GRIMER);
      const party = game.scene.getPlayerParty();
      const grimer = party[1];
      grimer.teraType = PokemonType.STELLAR;
      grimer.isTerastallized = true;
      expect(wasteWeight(party)).toBe(4);
    });

    it.each([
      { what: "Poison Heal", ability: AbilityId.POISON_HEAL, moves: [MoveId.SPLASH] },
      { what: "Toxic Boost", ability: AbilityId.TOXIC_BOOST, moves: [MoveId.SPLASH] },
      { what: "Guts", ability: AbilityId.GUTS, moves: [MoveId.SPLASH] },
      { what: "Facade", ability: AbilityId.BALL_FETCH, moves: [MoveId.FACADE] },
    ])("is 4 with a member the Toxic Orb is offered for ($what)", async ({ ability, moves }) => {
      game.override.ability(ability).moveset(moves);
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);
      const party = game.scene.getPlayerParty();
      expect(wasteWeight(party)).toBe(4);
      // The same condition as the Toxic Orb's
      expect((poolEntry(ModifierTier.ULTRA, "TOXIC_ORB")!.weight as WeightedModifierTypeWeightFunc)(party, 0)).toBe(10);
    });

    it("is 0 for a Guts Steel type, which cannot be poisoned", async () => {
      game.override.ability(AbilityId.GUTS);
      await game.classicMode.startBattle(SpeciesId.REGISTEEL);
      expect(wasteWeight(game.scene.getPlayerParty())).toBe(0);
    });

    it("leaves the Toxic Orb reward as it was: a waste holder still gets it, an orb holder does not", async () => {
      game.override.ability(AbilityId.GUTS);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const party = game.scene.getPlayerParty();
      const [snorlax] = party;
      const orbWeight = poolEntry(ModifierTier.ULTRA, "TOXIC_ORB")!.weight as WeightedModifierTypeWeightFunc;
      expect(orbWeight(party, 0)).toBe(10);
      game.scene.addModifier(newItem("RADIOACTIVE_WASTE", snorlax), true);
      expect(orbWeight(party, 0)).toBe(10);
      game.scene.removeModifier(heldItem(snorlax, "RADIOACTIVE_WASTE")!);

      // Holding a Toxic Orb, it is no longer offered either item for the poison
      game.scene.addModifier(newItem("TOXIC_ORB", snorlax), true);
      expect(orbWeight(party, 0)).toBe(0);
      expect(wasteWeight(party)).toBe(0);
    });
  });
});
