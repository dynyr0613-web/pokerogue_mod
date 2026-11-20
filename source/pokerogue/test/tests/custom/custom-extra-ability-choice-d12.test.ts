// Local fork (2026-11-20): 1.2.0 D12 leftovers (the user: "포켓몬 도감에서 선택"). The species whose extra ability
// ("추가 조정 특성") replaced an ability2 they had, and the three Megas whose extra ability sat in a hidden slot their
// base species can't reach, get an on/off choice in the Pokédex's ability list (extra-ability-choice.ts). It is saved
// per species on the line's starter entry (`StarterDataEntry.extraAbilityChoice`), applies to the player's Pokémon of
// the line in runs, and enemies keep the default.

import { saveKey } from "#app/constants";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import {
  applyExtraAbilityChoice,
  canChangeExtraAbilityChoice,
  EXTRA_ABILITY_CHOICES,
  getPlayerAbilitySlots,
  isExtraAbilityOn,
  setExtraAbilityOn,
} from "#balance/extra-ability-choice";
import { allAbilities } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { Challenges } from "#enums/challenges";
import { MoveId } from "#enums/move-id";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameData } from "#system/game-data";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import type { StarterDataEntry } from "#types/save-data";
import type { OptionSelectItem, OptionSelectModeConfig } from "#types/ui-types";
import { FilterTextRow } from "#ui/filter-text";
import { PokedexPageUiHandler } from "#ui/pokedex-page-ui-handler";
import { PokedexUiHandler } from "#ui/pokedex-ui-handler";
import { readFileSync } from "node:fs";
import { AES, enc } from "crypto-js";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const SYSTEM_FIXTURE = "./test/utils/saves/fork-1.1.0-system.prsv";

/** `saveSystem`'s replacer: big attribute flags as numbers when they fit, as strings otherwise */
function systemReplacer(_k: string, v: unknown): unknown {
  if (typeof v !== "bigint") {
    return v;
  }
  return v <= 0x80000000 ? Number(v) : v.toString();
}

/** The species with the choice: [species, its line's starter, extra ability, the "off" ability, kind] */
const EXPECTED: readonly [SpeciesId, SpeciesId, AbilityId, AbilityId, "slot2" | "mega"][] = [
  [SpeciesId.MAGNEMITE, SpeciesId.MAGNEMITE, AbilityId.TRANSISTOR, AbilityId.STURDY, "slot2"],
  [SpeciesId.MAGNETON, SpeciesId.MAGNEMITE, AbilityId.TRANSISTOR, AbilityId.STURDY, "slot2"],
  [SpeciesId.MAGNEZONE, SpeciesId.MAGNEMITE, AbilityId.TRANSISTOR, AbilityId.STURDY, "slot2"],
  [SpeciesId.ALOLA_MAROWAK, SpeciesId.CUBONE, AbilityId.GORILLA_TACTICS, AbilityId.LIGHTNING_ROD, "slot2"],
  [SpeciesId.PORYGON, SpeciesId.PORYGON, AbilityId.SPACE_WARP, AbilityId.DOWNLOAD, "slot2"],
  [SpeciesId.PORYGON2, SpeciesId.PORYGON, AbilityId.SPACE_WARP, AbilityId.DOWNLOAD, "slot2"],
  [SpeciesId.PORYGON_Z, SpeciesId.PORYGON, AbilityId.SPACE_WARP, AbilityId.DOWNLOAD, "slot2"],
  [SpeciesId.MANTYKE, SpeciesId.MANTYKE, AbilityId.LIGHTNING_ROD, AbilityId.WATER_ABSORB, "slot2"],
  [SpeciesId.MANTINE, SpeciesId.MANTYKE, AbilityId.LIGHTNING_ROD, AbilityId.WATER_ABSORB, "slot2"],
  [SpeciesId.GENGAR, SpeciesId.GASTLY, AbilityId.WICKED_SCHEME, AbilityId.SHADOW_TAG, "mega"],
  [SpeciesId.LATIAS, SpeciesId.LATIAS, AbilityId.SPEED_BOOST, AbilityId.LEVITATE, "mega"],
  [SpeciesId.LATIOS, SpeciesId.LATIOS, AbilityId.SPEED_BOOST, AbilityId.LEVITATE, "mega"],
];

function megaForm(speciesId: SpeciesId) {
  const form = speciesDataRegistry.getSpecies(speciesId).forms.find(f => f.formKey === SpeciesFormKey.MEGA);
  if (form == null) {
    throw new Error(`${SpeciesId[speciesId]} has no Mega form`);
  }
  return form;
}

describe("D12 leftovers - the extra ability chosen in the Pokédex", () => {
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
      .enemyLevel(50)
      .enemySpecies(SpeciesId.MAGNEMITE)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The line's starter entry of `speciesId` in the current save */
  function entryOf(speciesId: SpeciesId): StarterDataEntry {
    return game.scene.gameData.starterData[speciesDataRegistry.getStarter(speciesId)];
  }

  describe("the table", () => {
    it("has the 9 replaced ability2 rows and the 3 Megas, with their lines' starters", () => {
      expect([...EXTRA_ABILITY_CHOICES.values()].map(r => [r.speciesId, r.extra, r.off, r.kind] as const)).toEqual(
        EXPECTED.map(([id, , extra, off, kind]) => [id, extra, off, kind]),
      );
      for (const [speciesId, starter] of EXPECTED) {
        expect(speciesDataRegistry.getStarter(speciesId), SpeciesId[speciesId]).toBe(starter);
      }
    });

    it("matches the species data: ability2 holds the extra ability, the old one is gone", () => {
      for (const row of EXTRA_ABILITY_CHOICES.values()) {
        if (row.kind !== "slot2") {
          continue;
        }
        const species = speciesDataRegistry.getSpecies(row.speciesId);
        expect(species.ability2, SpeciesId[row.speciesId]).toBe(row.extra);
        expect([species.ability1, species.ability2, species.abilityHidden]).not.toContain(row.off);
        expect(row.defaultOn).toBe(true);
      }
    });

    it("matches the Megas: their own ability, the extra one only in a hidden slot the base species can't reach", () => {
      for (const row of EXTRA_ABILITY_CHOICES.values()) {
        if (row.kind !== "mega") {
          continue;
        }
        const form = megaForm(row.speciesId);
        expect([form.ability1, form.ability2, form.abilityHidden]).toEqual([row.off, row.off, row.extra]);
        const species = speciesDataRegistry.getSpecies(row.speciesId);
        expect(species.abilityHidden, SpeciesId[row.speciesId]).toBe(AbilityId.NONE);
        expect(row.defaultOn).toBe(false);
      }
    });
  });

  describe("the saved choice", () => {
    it("has the default without a choice (older saves): ability2 rows on, Megas off", () => {
      const entry = { abilityAttr: 1 } as StarterDataEntry;
      expect(isExtraAbilityOn(SpeciesId.MAGNEZONE, entry)).toBe(true);
      expect(isExtraAbilityOn(SpeciesId.GENGAR, entry)).toBe(false);
      // A value that is not a boolean is no choice
      const broken = { extraAbilityChoice: { [SpeciesId.MAGNEZONE]: "off" } } as unknown as StarterDataEntry;
      expect(isExtraAbilityOn(SpeciesId.MAGNEZONE, broken)).toBe(true);
      // A species without the choice is never "on"
      expect(isExtraAbilityOn(SpeciesId.BULBASAUR, entry)).toBe(false);
    });

    it("loads the 1.1.0 save with every species on its default", async () => {
      await game.importData(SYSTEM_FIXTURE);
      for (const [speciesId] of EXPECTED) {
        expect(entryOf(speciesId).extraAbilityChoice, SpeciesId[speciesId]).toBeUndefined();
      }
      expect(isExtraAbilityOn(SpeciesId.MAGNEMITE)).toBe(true);
      expect(isExtraAbilityOn(SpeciesId.LATIOS)).toBe(false);
    });

    it("is kept per species on the line's starter entry, through saving and loading", async () => {
      await game.runToTitle();
      expect(setExtraAbilityOn(SpeciesId.MAGNETON, false)).toBe(true);
      expect(setExtraAbilityOn(SpeciesId.GENGAR, true)).toBe(true);
      // A species without the choice saves nothing
      expect(setExtraAbilityOn(SpeciesId.BULBASAUR, true)).toBe(false);
      expect(entryOf(SpeciesId.MAGNETON).extraAbilityChoice).toEqual({ [SpeciesId.MAGNETON]: false });
      expect(entryOf(SpeciesId.GENGAR).extraAbilityChoice).toEqual({ [SpeciesId.GENGAR]: true });
      expect(entryOf(SpeciesId.BULBASAUR).extraAbilityChoice).toBeUndefined();
      // The other species of the line keep their own (default) choice
      expect(isExtraAbilityOn(SpeciesId.MAGNEMITE)).toBe(true);
      expect(isExtraAbilityOn(SpeciesId.MAGNETON)).toBe(false);
      // Choosing the default again is kept as chosen
      expect(setExtraAbilityOn(SpeciesId.MAGNEZONE, true)).toBe(true);
      expect(entryOf(SpeciesId.MAGNEZONE).extraAbilityChoice).toEqual({
        [SpeciesId.MAGNETON]: false,
        [SpeciesId.MAGNEZONE]: true,
      });

      // Export (short keys, encrypted) and load into a fresh GameData, as the fixture test does
      const json = JSON.stringify(game.scene.gameData.getSystemSaveData(), systemReplacer);
      const exported = AES.encrypt(game.scene.gameData["convertSystemDataStr"](json, true), saveKey).toString();
      const fresh = new GameData();
      game.scene.gameData = fresh;
      expect(
        await fresh["initSystem"](fresh["convertSystemDataStr"](AES.decrypt(exported, saveKey).toString(enc.Utf8))),
      ).toBe(true);
      expect(fresh.starterData[SpeciesId.MAGNEMITE].extraAbilityChoice).toEqual({
        [SpeciesId.MAGNETON]: false,
        [SpeciesId.MAGNEZONE]: true,
      });
      expect(fresh.starterData[SpeciesId.GASTLY].extraAbilityChoice).toEqual({ [SpeciesId.GENGAR]: true });
      expect(isExtraAbilityOn(SpeciesId.MAGNETON)).toBe(false);
      expect(isExtraAbilityOn(SpeciesId.GENGAR)).toBe(true);
    });
  });

  describe("the player's Pokémon and the enemies", () => {
    it("gives the player's ability2 the old ability when off; the enemy keeps the extra one", async () => {
      await game.classicMode.startBattle(SpeciesId.MAGNEMITE);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      player.abilityIndex = 1;
      enemy.abilityIndex = 1;

      // Default (on): today's species data
      expect(player.getAbility().id).toBe(AbilityId.TRANSISTOR);
      expect(enemy.getAbility().id).toBe(AbilityId.TRANSISTOR);

      setExtraAbilityOn(SpeciesId.MAGNEMITE, false);
      expect(player.getAbility().id).toBe(AbilityId.STURDY);
      expect(player.hasAbility(AbilityId.STURDY)).toBe(true);
      expect(player.hasAbility(AbilityId.TRANSISTOR)).toBe(false);
      expect(enemy.getAbility().id).toBe(AbilityId.TRANSISTOR);

      // The other slots never change
      player.abilityIndex = 0;
      expect(player.getAbility().id).toBe(AbilityId.MAGNET_PULL);
      player.abilityIndex = 2;
      expect(player.getAbility().id).toBe(AbilityId.ANALYTIC);
    });

    it("lets each species of the line follow its own choice (Magnemite on, Magneton off)", async () => {
      await game.runToTitle();
      setExtraAbilityOn(SpeciesId.MAGNETON, false);
      const magnemite = game.scene.addPlayerPokemon(speciesDataRegistry.getSpecies(SpeciesId.MAGNEMITE), 30, 1);
      const magneton = game.scene.addPlayerPokemon(speciesDataRegistry.getSpecies(SpeciesId.MAGNETON), 30, 1);
      expect(magnemite.getAbility().id).toBe(AbilityId.TRANSISTOR);
      expect(magneton.getAbility().id).toBe(AbilityId.STURDY);
    });

    it("applies the current choice to a party member loaded from a saved run", async () => {
      await game.runToTitle();
      const porygonZ = game.scene.addPlayerPokemon(speciesDataRegistry.getSpecies(SpeciesId.PORYGON_Z), 60, 1);
      expect(porygonZ.getAbility().id).toBe(AbilityId.SPACE_WARP);
      const saved = new PokemonData(porygonZ);

      // Chosen in the Pokédex before the run is continued
      setExtraAbilityOn(SpeciesId.PORYGON_Z, false);
      const loaded = saved.toPokemon();
      expect(loaded.isPlayer()).toBe(true);
      expect(loaded.abilityIndex).toBe(1);
      expect(loaded.getAbility().id).toBe(AbilityId.DOWNLOAD);
    });

    it("turns the Mega's every slot into the extra ability when on, only in the Mega form", async () => {
      await game.runToTitle();
      const gengarSpecies = speciesDataRegistry.getSpecies(SpeciesId.GENGAR);
      const megaIndex = gengarSpecies.forms.findIndex(f => f.formKey === SpeciesFormKey.MEGA);
      const gengar = game.scene.addPlayerPokemon(gengarSpecies, 60, 0, megaIndex);

      // Default (off): the Mega's own ability, as before
      expect(gengar.getAbility().id).toBe(AbilityId.SHADOW_TAG);
      gengar.abilityIndex = 2;
      expect(gengar.getAbility().id).toBe(AbilityId.SHADOW_TAG);

      setExtraAbilityOn(SpeciesId.GENGAR, true);
      for (const index of [0, 1, 2]) {
        gengar.abilityIndex = index;
        expect(gengar.getAbility().id, `slot ${index}`).toBe(AbilityId.WICKED_SCHEME);
      }
      // The base form is not touched
      gengar.formIndex = 0;
      gengar.abilityIndex = 0;
      expect(gengar.getAbility().id).toBe(AbilityId.CURSED_BODY);

      // Latias and Latios too
      setExtraAbilityOn(SpeciesId.LATIOS, true);
      const latiosSpecies = speciesDataRegistry.getSpecies(SpeciesId.LATIOS);
      const latiosMega = latiosSpecies.forms.findIndex(f => f.formKey === SpeciesFormKey.MEGA);
      const latios = game.scene.addPlayerPokemon(latiosSpecies, 60, 0, latiosMega);
      const latias = game.scene.addPlayerPokemon(speciesDataRegistry.getSpecies(SpeciesId.LATIAS), 60, 0, latiosMega);
      expect(latios.getAbility().id).toBe(AbilityId.SPEED_BOOST);
      expect(latias.getAbility().id).toBe(AbilityId.LEVITATE);
    });

    it("leaves the enemy's Mega its own ability whatever the player chose", async () => {
      game.override.enemySpecies(SpeciesId.GENGAR);
      await game.classicMode.startBattle(SpeciesId.GENGAR);
      const megaIndex = speciesDataRegistry
        .getSpecies(SpeciesId.GENGAR)
        .forms.findIndex(f => f.formKey === SpeciesFormKey.MEGA);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      for (const pokemon of [player, enemy]) {
        pokemon.formIndex = megaIndex;
        pokemon.abilityIndex = 0;
      }
      setExtraAbilityOn(SpeciesId.GENGAR, true);
      expect(player.getAbility().id).toBe(AbilityId.WICKED_SCHEME);
      expect(enemy.getAbility().id).toBe(AbilityId.SHADOW_TAG);
    });

    // Review fix (2026-11-20): the choice is about the species data's slot, so a challenge's change stays
    it("leaves the Ability Randomizer's ability alone (a Mega turned on is not forced to the extra one)", async () => {
      game.challengeMode.addChallenge(Challenges.ABILITY_RANDOMIZER, 1, 1);
      await game.challengeMode.startBattle(SpeciesId.GENGAR);
      const player = game.field.getPlayerPokemon();
      const megaIndex = player.species.forms.findIndex(f => f.formKey === SpeciesFormKey.MEGA);
      player.formIndex = megaIndex;
      player.abilityIndex = 0;
      const randomized = player.getSpeciesForm().getAbility(0);
      // The randomizer did change the slot (the seed is fixed in the tests)
      expect(randomized).not.toBe(AbilityId.SHADOW_TAG);
      expect(randomized).not.toBe(AbilityId.WICKED_SCHEME);
      expect(player.getAbility().id).toBe(randomized);
      setExtraAbilityOn(SpeciesId.GENGAR, true);
      expect(player.getAbility().id).toBe(randomized);
    });

    it("follows the fusion species' choice for a fused player Pokémon", async () => {
      await game.runToTitle();
      const pokemon = game.scene.addPlayerPokemon(speciesDataRegistry.getSpecies(SpeciesId.BULBASAUR), 30, 0);
      pokemon.fusionSpecies = speciesDataRegistry.getSpecies(SpeciesId.MANTINE);
      pokemon.fusionFormIndex = 0;
      pokemon.fusionAbilityIndex = 1;
      expect(pokemon.isFusion()).toBe(true);
      expect(pokemon.getAbility().id).toBe(AbilityId.LIGHTNING_ROD);
      setExtraAbilityOn(SpeciesId.MANTINE, false);
      expect(pokemon.getAbility().id).toBe(AbilityId.WATER_ABSORB);
    });

    it("gives the Pokédex and the starter screen the same slots", () => {
      const entryOff = { extraAbilityChoice: { [SpeciesId.MANTYKE]: false } } as StarterDataEntry;
      const mantyke = speciesDataRegistry.getSpecies(SpeciesId.MANTYKE);
      expect(applyExtraAbilityChoice(mantyke, 1, mantyke.ability2, entryOff)).toBe(AbilityId.WATER_ABSORB);
      expect(applyExtraAbilityChoice(mantyke, 0, mantyke.ability1, entryOff)).toBe(AbilityId.SWIFT_SWIM);
      // getPlayerAbilitySlots reads the save; with no save choice, the default
      expect(getPlayerAbilitySlots(mantyke)).toEqual([
        AbilityId.SWIFT_SWIM,
        AbilityId.LIGHTNING_ROD,
        AbilityId.WATER_VEIL,
      ]);
      // A species with no hidden ability keeps the empty slot
      const latias = speciesDataRegistry.getSpecies(SpeciesId.LATIAS);
      expect(getPlayerAbilitySlots(latias)).toEqual([latias.ability1, latias.ability2, AbilityId.NONE]);
    });
  });

  describe("the Pokédex page", () => {
    async function openPage(speciesId: SpeciesId, formIndex = 0): Promise<PokedexPageUiHandler> {
      await game.scene.ui.setOverlayMode(UiMode.POKEDEX_PAGE, speciesDataRegistry.getSpecies(speciesId), {
        formIndex,
      });
      const handler = game.scene.ui.getHandler();
      expect(handler).toBeInstanceOf(PokedexPageUiHandler);
      const page = handler as PokedexPageUiHandler;
      // The description box can't draw its mask in the headless tests
      vi.spyOn(page["infoOverlay"], "show").mockReturnValue(true);
      return page;
    }

    function extraOptions(page: PokedexPageUiHandler): { options: OptionSelectItem[]; index: number | undefined } {
      const options: OptionSelectItem[] = [];
      const index: number | undefined = page["addExtraAbilityOptions"](options);
      return { options, index };
    }

    it("shows the abilities with the choice and switches it from the ability list, saving at once", async () => {
      await game.runToTitle();
      expect(canChangeExtraAbilityChoice()).toBe(true);
      const save = vi.spyOn(game.scene.gameData, "saveSystem").mockResolvedValue(true);
      const page = await openPage(SpeciesId.MAGNETON);
      expect(page["ability2"]).toBe(AbilityId.TRANSISTOR);

      const { options, index } = extraOptions(page);
      expect(index).toBe(1);
      expect(options[0]).toMatchObject({ label: "Extra Ability:", selectable: false });
      expect(options[1].label).toBe("On: Transistor");

      expect(options[1].handler()).toBe(true);
      expect(save).toHaveBeenCalledTimes(1);
      expect(isExtraAbilityOn(SpeciesId.MAGNETON)).toBe(false);
      expect(page["ability2"]).toBe(AbilityId.STURDY);
      // The list comes back with the cursor on the choice
      await vi.waitFor(() => expect(game.scene.ui.mode).toBe(UiMode.OPTION_SELECT));
      const config = game.scene.ui.getHandler()["config"] as OptionSelectModeConfig;
      const labels = config.options.map(o => o.label);
      expect(labels).toContain("Off: Sturdy");
      expect(labels).toContain("Sturdy");
      expect(labels).not.toContain("Transistor");
      expect(config.initialCursor).toBe(labels.indexOf("Off: Sturdy"));
    });

    it("shows a Mega's own ability when off, the extra one in every slot when on", async () => {
      await game.runToTitle();
      vi.spyOn(game.scene.gameData, "saveSystem").mockResolvedValue(true);
      const gengar = speciesDataRegistry.getSpecies(SpeciesId.GENGAR);
      const page = await openPage(
        SpeciesId.GENGAR,
        gengar.forms.findIndex(f => f.formKey === SpeciesFormKey.MEGA),
      );
      expect([page["ability1"], page["ability2"], page["abilityHidden"]]).toEqual([
        AbilityId.SHADOW_TAG,
        undefined,
        undefined,
      ]);
      const { options, index } = extraOptions(page);
      expect(options[index!].label).toBe("Off: Shadow Tag");
      expect(options[index!].handler()).toBe(true);
      expect([page["ability1"], page["ability2"], page["abilityHidden"]]).toEqual([
        AbilityId.WICKED_SCHEME,
        undefined,
        undefined,
      ]);
    });

    it("has no choice for other species, Alolan Marowak's starter Cubone included", async () => {
      await game.runToTitle();
      const page = await openPage(SpeciesId.CUBONE);
      const options: OptionSelectItem[] = [];
      expect(page["addExtraAbilityOptions"](options)).toBeUndefined();
      expect(options).toEqual([]);
    });

    // Review fix (2026-11-20): the Pokédex list's ability filter finds the species by the abilities its page shows
    it("filters the Pokédex list by the abilities with the choice", async () => {
      await game.runToTitle();
      setExtraAbilityOn(SpeciesId.MAGNETON, false);
      await game.scene.ui.setOverlayMode(UiMode.POKEDEX);
      const handler = game.scene.ui.getHandler();
      expect(handler).toBeInstanceOf(PokedexUiHandler);
      const dex = handler as PokedexUiHandler;
      const filtered = (abilityId: AbilityId): SpeciesId[] => {
        dex["filterText"].setValue(FilterTextRow.ABILITY_1, allAbilities[abilityId].name);
        return dex["filteredPokemonData"].map(p => p.species.speciesId);
      };
      const sturdy = filtered(AbilityId.STURDY);
      expect(sturdy).toContain(SpeciesId.MAGNETON);
      expect(sturdy).not.toContain(SpeciesId.MAGNEMITE);
      const transistor = filtered(AbilityId.TRANSISTOR);
      expect(transistor).toContain(SpeciesId.MAGNEMITE);
      expect(transistor).not.toContain(SpeciesId.MAGNETON);
    });

    it("can't be changed during a run", async () => {
      await game.classicMode.startBattle(SpeciesId.MAGNEMITE);
      expect(game.scene.phaseManager.getCurrentPhase().phaseName).toBe("CommandPhase");
      expect(canChangeExtraAbilityChoice()).toBe(false);
    });

    it("only says why when chosen during a run (the party's way into the Pokédex)", async () => {
      await game.runToTitle();
      const page = await openPage(SpeciesId.PORYGON2);
      vi.spyOn(game.scene.phaseManager, "getCurrentPhase").mockReturnValue({ phaseName: "CommandPhase" } as never);
      const save = vi.spyOn(game.scene.gameData, "saveSystem").mockResolvedValue(true);
      const { options, index } = extraOptions(page);
      expect(options[index!].handler()).toBe(false);
      expect(page["infoOverlay"].show).toHaveBeenLastCalledWith(
        "On: ability 2 is Space Warp. Off: Download. Only for your own Pokémon.\nCan't be changed during a run.",
      );
      expect(save).not.toHaveBeenCalled();
      expect(isExtraAbilityOn(SpeciesId.PORYGON2)).toBe(true);
    });
  });

  it("has its texts in ko and en", () => {
    const keys = [
      "extraAbility",
      "extraAbilityOn",
      "extraAbilityOff",
      "extraAbilitySlotDescription",
      "extraAbilityMegaDescription",
      "extraAbilityLocked",
    ];
    for (const lang of ["ko", "en"]) {
      const texts = JSON.parse(readFileSync(`locales/${lang}/pokedex-ui-handler.json`, "utf-8"));
      for (const key of keys) {
        expect(texts[key], `${lang} ${key}`).toBeTruthy();
      }
    }
    const ko = JSON.parse(readFileSync("locales/ko/pokedex-ui-handler.json", "utf-8"));
    expect(ko.extraAbility).toBe("추가 조정 특성:");
    expect(ko.extraAbilityOn).toBe("켬: {{ability}}");
    expect(ko.extraAbilityOff).toBe("끔: {{ability}}");
    expect(ko.extraAbilityLocked).toBe("런 도중에는 바꿀 수 없다.");
    expect(i18next.t("pokedexUiHandler:extraAbilitySlotDescription", { extra: "Transistor", off: "Sturdy" })).toBe(
      "On: ability 2 is Transistor. Off: Sturdy. Only for your own Pokémon.",
    );
  });
});
