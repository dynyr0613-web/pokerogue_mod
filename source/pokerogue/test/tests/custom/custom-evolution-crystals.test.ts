import { getGameMode } from "#app/game-mode";
import { FULL_RULE_HELD_ITEM_IDS } from "#balance/endless-balance";
import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { GameModes } from "#enums/game-modes";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { EffectiveStat } from "#enums/stat";
import { Stat } from "#enums/stat";
import { UiMode } from "#enums/ui-mode";
import { Unlockables } from "#enums/unlockables";
import type { Pokemon } from "#field/pokemon";
import {
  ChoiceItemModifier,
  EVOLUTION_CRYSTAL_MULTIPLIER,
  EVOLUTION_CRYSTAL_STATS,
  EvolutionCrystalModifier,
  getEvolutionBoostMultiplier,
} from "#modifiers/custom-held-items";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import * as Modifier from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import { SummaryUiMode } from "#ui/summary-ui-handler";
import { getModifierPoolForType } from "#utils/modifier-utils";
import { readFileSync } from "node:fs";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local fork (2026-11-09): Red / Blue Eviolite (붉은진화의휘석 / 푸른진화의휘석; ids RED_/BLUE_EVOLUTION_CRYSTAL,
 * renamed in the game text at the user's request: "이름 걍 붉은/푸른 진화의휘석으로 해둡시다"), ULTRA tier. The user:
 * "진화의휘석 계열 아이템을 추가해보죠. 붉은진화의휘석: 공격 / 푸른진화의휘석: 특수공격 을 옵션으로 해서". The Eviolite's
 * Attack / Sp. Atk versions: x1.5 while the holder can still evolve, half of it for a half-evolvable fusion, nothing
 * while Gigantamax'd; separate items from the Eviolite and from each other, one of each per Pokémon.
 */
describe("Custom held items - Evolution Crystals", () => {
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
      .moveset([MoveId.SPLASH]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const crystals = [
    { name: "RED_EVOLUTION_CRYSTAL", stat: Stat.ATK, icon: "red_evolution_crystal" },
    { name: "BLUE_EVOLUTION_CRYSTAL", stat: Stat.SPATK, icon: "blue_evolution_crystal" },
  ] as const;
  type CrystalName = (typeof crystals)[number]["name"];
  type ItemName = CrystalName | "EVIOLITE" | "CHOICE_BAND";
  const statsShown = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD] as const;

  /** A fresh item for `pokemon`, with its type id set the way `overrideHeldItems` and the reward pools do. */
  function newItem(name: ItemName, pokemon: Pokemon): PokemonHeldItemModifier {
    return modifierTypes[name]().withIdFromFunc(modifierTypes[name]).newModifier(pokemon) as PokemonHeldItemModifier;
  }

  /** Give every Pokémon in `party` one of each item in `names` */
  function giveEveryone(party: readonly Pokemon[], names: readonly ItemName[]): PokemonHeldItemModifier[] {
    return party.flatMap(holder =>
      names.map(name => {
        const held = newItem(name, holder);
        game.scene.addModifier(held, true);
        return held;
      }),
    );
  }

  function heldItem(pokemon: Pokemon, id: string): PokemonHeldItemModifier | undefined {
    return pokemon.getHeldItems().find(m => m.type.id === id);
  }

  function crystalsOf(pokemon: Pokemon): EvolutionCrystalModifier[] {
    return pokemon.getHeldItems().filter((m): m is EvolutionCrystalModifier => m instanceof EvolutionCrystalModifier);
  }

  /** The stat with and without held items, and their ratio as `getEffectiveStat` floors it */
  function expectBoost(pokemon: Pokemon, stat: EffectiveStat, multiplier: number): void {
    const base = pokemon.getEffectiveStat(stat, { ignoreHeldItems: true });
    expect(pokemon.getEffectiveStat(stat), `stat ${stat} x${multiplier}`).toBe(Math.floor(base * multiplier));
  }

  /** Fuse `ally`'s species into `pokemon` (as the upstream Eviolite test does, after `PlayerPokemon.fuse`) */
  function fuse(pokemon: Pokemon, ally: Pokemon): void {
    pokemon.fusionSpecies = ally.species;
    pokemon.fusionFormIndex = ally.formIndex;
    pokemon.fusionAbilityIndex = ally.abilityIndex;
    pokemon.fusionShiny = ally.shiny;
    pokemon.fusionVariant = ally.variant;
    pokemon.fusionGender = ally.gender;
    pokemon.fusionLuck = ally.luck;
  }

  function ultraEntry(id: CrystalName | "EVIOLITE") {
    const entry = getModifierPoolForType(ModifierPoolType.PLAYER)[ModifierTier.ULTRA].find(
      w => w.modifierType.id === id,
    )!;
    expect(entry, id).toBeDefined();
    return entry;
  }

  it("are two items with their own stat, icon, locale entries and the full-item rule", () => {
    expect(EVOLUTION_CRYSTAL_MULTIPLIER).toBe(1.5);
    expect(EVOLUTION_CRYSTAL_STATS).toEqual({ RED_EVOLUTION_CRYSTAL: Stat.ATK, BLUE_EVOLUTION_CRYSTAL: Stat.SPATK });
    const atlas = JSON.parse(readFileSync("./assets/images/items.json", "utf8"));
    const frames: { filename: string; sourceSize: { w: number; h: number } }[] = atlas.textures[0].frames;
    for (const { name, icon } of crystals) {
      expect(FULL_RULE_HELD_ITEM_IDS.has(name), name).toBe(true);
      expect(modifierTypes[name]().iconImage).toBe(icon);
      expect(modifierTypes[name]().localeKey).toBe(`modifierType:ModifierType.${name}`);
      const frame = frames.find(f => f.filename === icon);
      expect(frame, icon).toBeDefined();
      expect(frame!.sourceSize).toEqual({ w: 32, h: 32 });
    }
    for (const [lang, red, blue] of [
      [
        "ko",
        {
          name: "붉은진화의휘석",
          description: "진화의 이상한 붉은 덩어리. 지니게 하면 진화 전 포켓몬의 공격이 1.5배로 올라간다.",
        },
        {
          name: "푸른진화의휘석",
          description: "진화의 이상한 푸른 덩어리. 지니게 하면 진화 전 포켓몬의 특수공격이 1.5배로 올라간다.",
        },
      ],
      ["en", { name: "Red Eviolite" }, { name: "Blue Eviolite" }],
    ] as const) {
      const json = JSON.parse(readFileSync(`./locales/${lang}/modifier-type.json`, "utf8"));
      const entries: Record<string, { name: string; description: string }> = json.ModifierType;
      expect(entries.RED_EVOLUTION_CRYSTAL, lang).toMatchObject(red);
      expect(entries.BLUE_EVOLUTION_CRYSTAL, lang).toMatchObject(blue);
      expect(entries.RED_EVOLUTION_CRYSTAL.description, lang).toBeTruthy();
      expect(entries.BLUE_EVOLUTION_CRYSTAL.description, lang).toBeTruthy();
      const keys = Object.keys(entries);
      expect(keys.indexOf("RED_EVOLUTION_CRYSTAL"), lang).toBe(keys.indexOf("EVIOLITE") + 1);
      expect(keys.indexOf("BLUE_EVOLUTION_CRYSTAL"), lang).toBe(keys.indexOf("EVIOLITE") + 2);
    }
    // The ko stat names the descriptions use
    const info = JSON.parse(readFileSync("./locales/ko/pokemon-info.json", "utf8"));
    expect(info.stat.atk).toBe("공격");
    expect(info.stat.spatk).toBe("특수공격");
  });

  describe.each(crystals)("$name", ({ name, stat }) => {
    it("multiplies only its own stat by 1.5 for a Pokémon that can still evolve, shown in green on the summary", async () => {
      game.override.startingHeldItems([{ name }]);
      await game.classicMode.startBattle(SpeciesId.PICHU);
      const pichu = game.field.getPlayerPokemon();

      const [item] = crystalsOf(pichu);
      expect(item).toBeDefined();
      expect(item.type.id).toBe(name);
      expect(item.getStat()).toBe(stat);
      expect(item.stackCount).toBe(1);
      expect(item.isTransferable).toBe(true);
      // Not an Eviolite to the code that counts Eviolites (see "are separate items" below)
      expect(item).not.toBeInstanceOf(Modifier.EvolutionStatBoosterModifier);
      expect(item).toBeInstanceOf(Modifier.StatBoosterModifier);

      const base = pichu.getEffectiveStat(stat, { ignoreHeldItems: true });
      expect(base).toBe(pichu.getStat(stat, false));
      expect(pichu.getEffectiveStat(stat)).toBe(Math.floor(base * 1.5));
      for (const untouched of statsShown) {
        if (untouched !== stat) {
          expectBoost(pichu, untouched, 1);
        }
      }

      // The summary's stats page shows the raised value in green (`getHeldItemBoostedStat`, private)
      await game.scene.ui.setModeWithoutClear(UiMode.SUMMARY, pichu, SummaryUiMode.DEFAULT, 1 /* Page.STATS */);
      const summary = game.scene.ui.getHandler() as unknown as {
        getHeldItemBoostedStat(s: Stat): number | null;
      };
      expect(summary.getHeldItemBoostedStat(stat)).toBe(Math.floor(pichu.getStat(stat) * 1.5));
      const other = stat === Stat.ATK ? Stat.SPATK : Stat.ATK;
      expect(summary.getHeldItemBoostedStat(other)).toBeNull();
    });

    it("does nothing for a fully evolved Pokémon", async () => {
      game.override.startingHeldItems([{ name }]);
      await game.classicMode.startBattle(SpeciesId.RAICHU);
      const raichu = game.field.getPlayerPokemon();
      const [item] = crystalsOf(raichu);
      expect(item).toBeDefined();
      for (const s of statsShown) {
        expectBoost(raichu, s, 1);
      }
    });

    it("gives a fusion x1.5 when both species can evolve, x1.25 when one can, nothing when neither can", async () => {
      game.override.startingHeldItems([{ name }]);
      await game.classicMode.startBattle(SpeciesId.PICHU, SpeciesId.CLEFFA, SpeciesId.CLEFABLE, SpeciesId.RAICHU);
      const [pichu, cleffa, clefable, raichu] = game.scene.getPlayerParty();
      const [item] = crystalsOf(pichu);
      expect(item).toBeDefined();
      const pichuSpecies = pichu.species;

      // The holder's own species is swapped to Raichu for the last two (its stats stay; only the ratio is checked)
      for (const [holderSpecies, fusionSource, multiplier] of [
        [pichuSpecies, cleffa, 1.5],
        [pichuSpecies, clefable, 1.25],
        [raichu.species, cleffa, 1.25],
        [raichu.species, clefable, 1],
      ] as const) {
        pichu.species = holderSpecies;
        fuse(pichu, fusionSource);
        expect(pichu.isFusion()).toBe(true);
        expect(getEvolutionBoostMultiplier(pichu, 1.5)).toBe(multiplier);
        expectBoost(pichu, stat, multiplier);
        expectBoost(pichu, stat === Stat.ATK ? Stat.SPATK : Stat.ATK, 1);
      }
    });

    it("does nothing while the holder is Gigantamax'd", async () => {
      game.override.startingHeldItems([{ name }]).starterForms({ [SpeciesId.EEVEE]: 2 });
      await game.classicMode.startBattle(SpeciesId.EEVEE);
      const eevee = game.field.getPlayerPokemon();
      expect(eevee.isMax()).toBe(true);
      // Eevee can still evolve: only G-Max stops the boost
      expect(getEvolutionBoostMultiplier(eevee, 1.5)).toBe(1.5);
      expect(crystalsOf(eevee)).toHaveLength(1);
      expectBoost(eevee, stat, 1);
    });

    it("is one per Pokémon: a second copy and a transfer onto a holder are refused", async () => {
      game.override.startingHeldItems([{ name }]);
      await game.classicMode.startBattle(SpeciesId.PICHU, SpeciesId.CLEFFA);
      const [pichu, cleffa] = game.scene.getPlayerParty();
      const [item] = crystalsOf(pichu);
      expect(item.getMaxHeldItemCount(pichu)).toBe(1);
      expect(item.getMaxStackCount()).toBe(1);

      game.scene.addModifier(newItem(name, pichu), true);
      expect(crystalsOf(pichu)).toHaveLength(1);
      expect(item.stackCount).toBe(1);

      const cleffaItem = newItem(name, cleffa);
      game.scene.addModifier(cleffaItem, true);
      expect(game.scene.tryTransferHeldItemModifier(cleffaItem, pichu, false)).toBe(false);
      expect(crystalsOf(cleffa)).toHaveLength(1);
      expect(item.stackCount).toBe(1);

      // ...but it moves to a Pokémon without one
      game.scene.removeModifier(item);
      expect(game.scene.tryTransferHeldItemModifier(cleffaItem, pichu, false)).toBe(true);
      expect(crystalsOf(cleffa)).toHaveLength(0);
      expect(crystalsOf(pichu).map(m => m.type.id)).toEqual([name]);
    });

    it("survives the session save round trip with the holder's id and the stat as args", async () => {
      game.override.startingHeldItems([{ name }]);
      await game.classicMode.startBattle(SpeciesId.PICHU);
      const pichu = game.field.getPlayerPokemon();
      const [item] = crystalsOf(pichu);
      expect(item.getArgs()).toEqual([pichu.id, stat]);
      expect(item.clone()).toBeInstanceOf(EvolutionCrystalModifier);
      expect(item.clone().getArgs()).toEqual([pichu.id, stat]);

      const { gameData } = game.scene;
      const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
      const saved = gameData.parseSessionData(json).modifiers.find(m => m.typeId === name)!;
      expect(saved.className).toBe("EvolutionCrystalModifier");
      expect(saved.args).toEqual([pichu.id, stat]);

      // `GameData.loadSession` looks the class up in the `modifier.ts` namespace, where it is absent
      expect(Modifier[saved.className]).toBeUndefined();
      const restored = saved.toModifier(Modifier[saved.className]) as EvolutionCrystalModifier;
      expect(restored).toBeInstanceOf(EvolutionCrystalModifier);
      expect(restored.getStat()).toBe(stat);
      expect(restored.type.id).toBe(name);
      expect(restored.stackCount).toBe(1);
      expect(restored.match(item)).toBe(true);
      saved.stackCount = 3;
      expect(saved.toModifier(Modifier[saved.className])!.stackCount).toBe(1);
    });
  });

  describe("with the Eviolite", () => {
    it("Eviolite, red and blue on one Pokémon all apply, and none is counted as another", async () => {
      game.override.startingHeldItems([
        { name: "EVIOLITE" },
        { name: "RED_EVOLUTION_CRYSTAL" },
        { name: "BLUE_EVOLUTION_CRYSTAL" },
      ]);
      await game.classicMode.startBattle(SpeciesId.PICHU);
      const pichu = game.field.getPlayerPokemon();
      const eviolite = heldItem(pichu, "EVIOLITE")!;
      const red = heldItem(pichu, "RED_EVOLUTION_CRYSTAL")!;
      const blue = heldItem(pichu, "BLUE_EVOLUTION_CRYSTAL")!;
      expect(eviolite).toBeInstanceOf(Modifier.EvolutionStatBoosterModifier);
      expect([eviolite, red, blue].map(m => m.stackCount)).toEqual([1, 1, 1]);
      expect(pichu.getHeldItems()).toHaveLength(3);

      for (const s of [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF] as const) {
        expectBoost(pichu, s, 1.5);
      }
      expectBoost(pichu, Stat.SPD, 1);

      // No pair matches, in either direction (Eviolite's own `matchType` takes every EvolutionStatBoosterModifier)
      for (const a of [eviolite, red, blue]) {
        for (const b of [eviolite, red, blue]) {
          expect(a.matchType(b), `${a.type.id} vs ${b.type.id}`).toBe(a === b);
        }
      }
      // Choice Band is also an Attack x1.5 StatBoosterModifier: still a different item
      const band = newItem("CHOICE_BAND", pichu);
      expect(band).toBeInstanceOf(ChoiceItemModifier);
      expect(band.matchType(red)).toBe(false);
      expect(red.matchType(band)).toBe(false);
    });

    it("a crystal joins a holder of the Eviolite (and the reverse) without stacking into it or being capped by it", async () => {
      game.override.startingHeldItems([{ name: "EVIOLITE" }]);
      await game.classicMode.startBattle(SpeciesId.PICHU, SpeciesId.CLEFFA);
      const [pichu, cleffa] = game.scene.getPlayerParty();
      const eviolite = heldItem(pichu, "EVIOLITE")!;

      for (const name of ["RED_EVOLUTION_CRYSTAL", "BLUE_EVOLUTION_CRYSTAL"] as const) {
        const item = newItem(name, cleffa);
        game.scene.addModifier(item, true);
        expect(game.scene.canTransferHeldItemModifier(item, pichu)).toBe(true);
        expect(game.scene.tryTransferHeldItemModifier(item, pichu, false)).toBe(true);
        expect(heldItem(pichu, name)!.stackCount).toBe(1);
        expect(eviolite.stackCount).toBe(1);
        expect(heldItem(pichu, "EVIOLITE")).toBe(eviolite);
      }
      expect(pichu.getHeldItems().map(m => m.type.id)).toHaveLength(3);
      // A second Eviolite is still refused by the first
      const secondEviolite = newItem("EVIOLITE", cleffa);
      game.scene.addModifier(secondEviolite, true);
      expect(game.scene.tryTransferHeldItemModifier(secondEviolite, pichu, false)).toBe(false);

      // The reverse: Cleffa holds both crystals and takes Pichu's Eviolite
      const cleffaRed = newItem("RED_EVOLUTION_CRYSTAL", cleffa);
      const cleffaBlue = newItem("BLUE_EVOLUTION_CRYSTAL", cleffa);
      game.scene.addModifier(cleffaRed, true);
      game.scene.addModifier(cleffaBlue, true);
      game.scene.removeModifier(secondEviolite);
      expect(game.scene.tryTransferHeldItemModifier(eviolite, cleffa, false)).toBe(true);
      expect(
        cleffa
          .getHeldItems()
          .map(m => m.type.id)
          .sort(),
      ).toEqual(["BLUE_EVOLUTION_CRYSTAL", "EVIOLITE", "RED_EVOLUTION_CRYSTAL"]);
      expect(cleffa.getHeldItems().every(m => m.stackCount === 1)).toBe(true);
    });

    it("can be stolen from an enemy, unless one of the player's Pokémon already holds that crystal", async () => {
      game.override.enemyHeldItems([{ name: "RED_EVOLUTION_CRYSTAL" }, { name: "BLUE_EVOLUTION_CRYSTAL" }]);
      game.override.startingHeldItems([{ name: "BLUE_EVOLUTION_CRYSTAL" }]);
      await game.classicMode.startBattle(SpeciesId.PICHU, SpeciesId.CLEFFA);
      const [pichu, cleffa] = game.scene.getPlayerParty();
      const enemy = game.field.getEnemyPokemon();
      const enemyRed = heldItem(enemy, "RED_EVOLUTION_CRYSTAL")!;
      const enemyBlue = heldItem(enemy, "BLUE_EVOLUTION_CRYSTAL")!;
      expect(enemyRed.isTransferable).toBe(true);
      expect(game.scene.canTakeHeldItem(enemyRed, pichu)).toBe(true);
      // Pichu holds a blue crystal (the cap), so steal rolls skip the enemy's for the whole party
      expect(game.scene.canTakeHeldItem(enemyBlue, pichu)).toBe(false);
      expect(game.scene.canTakeHeldItem(enemyBlue, cleffa)).toBe(false);
      // An enemy thief only needs room
      expect(game.scene.canTakeHeldItem(heldItem(pichu, "BLUE_EVOLUTION_CRYSTAL")!, enemy)).toBe(false);
      game.scene.removeModifier(enemyBlue, true);
      expect(game.scene.canTakeHeldItem(heldItem(pichu, "BLUE_EVOLUTION_CRYSTAL")!, enemy)).toBe(true);
    });
  });

  describe("reward pool", () => {
    it("sit in the ULTRA tier of the player pool at weight 10 each while the Eviolite is unlocked and someone can evolve", async () => {
      await game.classicMode.startBattle(SpeciesId.PICHU, SpeciesId.CLEFFA);
      const party = game.scene.getPlayerParty();
      const [pichu, cleffa] = party;
      const { gameData } = game.scene;

      for (const { name } of crystals) {
        const entry = ultraEntry(name);
        expect(entry.modifierType.tier).toBe(ModifierTier.ULTRA);
        expect(entry.maxWeight).toBe(10);
        const weight = entry.weight as WeightedModifierTypeWeightFunc;
        expect(weight, name).toBeInstanceOf(Function);

        // Locked like the Eviolite, then unlocked
        gameData.unlocks[Unlockables.EVIOLITE] = false;
        expect(weight(party, 0)).toBe(0);
        gameData.unlocks[Unlockables.EVIOLITE] = true;
        expect(weight(party, 0)).toBe(10);

        // Not in a Fresh Start challenge, even unlocked
        const freshStart = vi.spyOn(game.scene.gameMode, "isFreshStartChallenge").mockReturnValue(true);
        expect(weight(party, 0)).toBe(0);
        freshStart.mockRestore();

        // In a Daily run even locked
        const classic = game.scene.gameMode;
        gameData.unlocks[Unlockables.EVIOLITE] = false;
        game.scene.gameMode = getGameMode(GameModes.DAILY);
        expect(weight(party, 0)).toBe(10);
        game.scene.gameMode = classic;
        gameData.unlocks[Unlockables.EVIOLITE] = true;

        // The Eviolite and the other crystal held by everyone do not matter
        const others = giveEveryone(party, ["EVIOLITE", ...crystals.map(c => c.name).filter(n => n !== name)]);
        expect(weight(party, 0)).toBe(10);

        // One holder of this crystal is enough to leave it out (Cleffa could still take one: the full-item rule)
        const held = newItem(name, pichu);
        game.scene.addModifier(held, true);
        expect(crystalsOf(cleffa).some(m => m.type.id === name)).toBe(false);
        expect(weight(party, 0)).toBe(0);
        game.scene.removeModifier(held);
        expect(weight(party, 0)).toBe(10);
        for (const m of others) {
          game.scene.removeModifier(m);
        }
      }
    });

    it("leave a party with nobody able to evolve, or only Gigantamax'd ones, without them", async () => {
      game.override.starterForms({ [SpeciesId.EEVEE]: 2 });
      await game.classicMode.startBattle(SpeciesId.RAICHU, SpeciesId.EEVEE);
      const party = game.scene.getPlayerParty();
      const [raichu, eevee] = party;
      expect(eevee.isMax()).toBe(true);
      game.scene.gameData.unlocks[Unlockables.EVIOLITE] = true;

      for (const id of ["EVIOLITE", ...crystals.map(c => c.name)] as const) {
        const weight = ultraEntry(id).weight as WeightedModifierTypeWeightFunc;
        expect(weight(party, 0), id).toBe(0);
        // ...and Raichu fused with an unevolved species (normal-form Eevee) is enough, as for the Eviolite
        fuse(raichu, eevee);
        raichu.fusionFormIndex = 0;
        expect(raichu.isMax()).toBe(false);
        expect(weight(party, 0), id).toBe(10);
        raichu.fusionSpecies = null;
      }
    });

    it("are not in the trainer, wild, enemy buff or daily starter pools, like the Eviolite", () => {
      for (const poolType of [
        ModifierPoolType.TRAINER,
        ModifierPoolType.WILD,
        ModifierPoolType.ENEMY_BUFF,
        ModifierPoolType.DAILY_STARTER,
      ]) {
        const ids = Object.values(getModifierPoolForType(poolType))
          .flat()
          .map(w => w.modifierType.id);
        for (const id of ["EVIOLITE", ...crystals.map(c => c.name)]) {
          expect(ids, `${poolType} ${id}`).not.toContain(id);
        }
      }
    });
  });

  it("Eviolite and both crystals survive a full session reload with their boosts", async () => {
    game.override.startingHeldItems([
      { name: "EVIOLITE" },
      { name: "RED_EVOLUTION_CRYSTAL" },
      { name: "BLUE_EVOLUTION_CRYSTAL" },
    ]);
    await game.classicMode.startBattle(SpeciesId.PICHU);
    const pichu = game.field.getPlayerPokemon();
    const stats = statsShown.map(s => pichu.getEffectiveStat(s));

    const { gameData } = game.scene;
    const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
    const session = gameData.parseSessionData(json);
    game.reload["sessionData"] = session;
    await game.reload.reloadSession();

    const loaded = game.field.getPlayerPokemon();
    expect(loaded).not.toBe(pichu);
    expect(loaded.id).toBe(pichu.id);
    expect(
      loaded
        .getHeldItems()
        .map(m => m.type.id)
        .sort(),
    ).toEqual(["BLUE_EVOLUTION_CRYSTAL", "EVIOLITE", "RED_EVOLUTION_CRYSTAL"]);
    expect(
      crystalsOf(loaded)
        .map(m => m.getStat())
        .sort(),
    ).toEqual([Stat.ATK, Stat.SPATK].sort());
    expect(statsShown.map(s => loaded.getEffectiveStat(s))).toEqual(stats);
    for (const s of [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF] as const) {
      expectBoost(loaded, s, 1.5);
    }
  });
});
