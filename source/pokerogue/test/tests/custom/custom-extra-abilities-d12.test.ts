// Local fork (2026-11-19): 1.2.0 D12, the passive sheet's extra abilities ("추가 조정 특성"; the user: "d12 실행").
// The column (47 rows, read from the Drive sheet on 2026-11-19) goes into the species' ability slots by the main
// session's rule: the first free slot (ability2 when it is NONE or the same as ability1, then the hidden ability when it
// is NONE or a duplicate); with three different abilities, ability2 is replaced and the hidden ability kept. Every row of
// the sheet landed in ability2. Row 47 (Armored Mewtwo, "MEWTWO,3") has no form in the fork and is left out.
// Also: the three abilities the column needed and the fork did not have (custom-abilities-1119-d12.ts).

import { speciesDataRegistry } from "#app/global-species-data-registry";
import { getCustomPassive } from "#balance/custom-passives";
import { allAbilities, allMoves } from "#data/data-lists";
import type { PokemonForm, PokemonSpecies } from "#data/pokemon-species";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import { toCamelCase } from "#utils/strings";
import { readFileSync } from "node:fs";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

type AbilityName = keyof typeof AbilityId;
type SpeciesName = keyof typeof SpeciesId;

/** The sheet's "추가 조정 특성 ID" per row (Essentials IDs: the fork's `AbilityId` name without underscores). */
const SHEET_ABILITY: Readonly<Record<number, string>> = {
  1: "THICKFAT",
  2: "QUARKDRIVE",
  3: "STRONGJAW",
  4: "PICKPOCKET",
  5: "ARCHMAGE",
  6: "TRANSISTOR",
  7: "WICKEDSCHEME",
  8: "SUNBATHE",
  9: "GORILLATACTICS",
  10: "SPACEWARP",
  11: "SPACEWARP",
  12: "LIGHTNINGROD",
  13: "DROUGHT",
  14: "ADAPTABILITY",
  15: "ADAPTABILITY",
  16: "WICKEDSCHEME",
  17: "LIGHTNINGROD",
  18: "STEELBODY",
  19: "ELECTRICSURGE",
  20: "DROUGHT",
  21: "DRIZZLE",
  22: "SANDRUSH",
  23: "MEGASOL",
  24: "INTREPIDSWORD",
  25: "TRANSISTOR",
  26: "GORILLATACTICS",
  27: "SOLARPOWER",
  28: "SANDFORCE",
  29: "ROUGHSKIN",
  30: "SNOWWARNING",
  31: "SLUSHRUSH",
  32: "ROCKHEAD",
  33: "SANDFORCE",
  34: "POLARLIGHT",
  35: "STEELBODY",
  36: "SPEEDBOOST",
  37: "SPEEDBOOST",
  38: "MOXIE",
  39: "STAMINA",
  40: "SPEEDBOOST",
  41: "GRASSYSURGE",
  42: "OVERAWE",
  43: "LASTSTAND",
  44: "AERILATE",
  45: "DESOLATELAND",
  46: "GRIT",
  47: "LASTSTAND",
};

/** Sheet rows with no species or form in the fork */
const NOT_IN_FORK: readonly number[] = [47];

interface SlotRow {
  /** Row of the sheet's column (1-47) */
  readonly row: number;
  readonly species: SpeciesName;
  /** `null`: the species itself (and its base form when it has forms); else the form that got the ability */
  readonly formKey: string | null;
  /** What ability2 held before ("NONE": empty, so it was ability1) */
  readonly replaced: AbilityName;
  /** Final [ability1, ability2, hidden] */
  readonly slots: readonly [AbilityName, AbilityName, AbilityName];
}

function slotRow(
  row: number,
  species: SpeciesName,
  formKey: string | null,
  replaced: AbilityName,
  slots: readonly [AbilityName, AbilityName, AbilityName],
): SlotRow {
  return { row, species, formKey, replaced, slots };
}

/** Every member each row covers (계열: the whole line; 특성 변화: that member onward; the rest: that form) */
const SLOT_TABLE: readonly SlotRow[] = [
  slotRow(1, "VENUSAUR", "gigantamax", "NONE", ["EFFECT_SPORE", "THICK_FAT", "EFFECT_SPORE"]),
  slotRow(2, "PIKACHU", "gigantamax", "NONE", ["LIGHTNING_ROD", "QUARK_DRIVE", "LIGHTNING_ROD"]),
  slotRow(3, "ZUBAT", null, "NONE", ["INNER_FOCUS", "STRONG_JAW", "INFILTRATOR"]),
  slotRow(3, "GOLBAT", null, "NONE", ["INNER_FOCUS", "STRONG_JAW", "INFILTRATOR"]),
  slotRow(3, "CROBAT", null, "NONE", ["INNER_FOCUS", "STRONG_JAW", "INFILTRATOR"]),
  slotRow(4, "MEOWTH", "gigantamax", "TECHNICIAN", ["TECHNICIAN", "PICKPOCKET", "TECHNICIAN"]),
  slotRow(5, "ALAKAZAM", "mega", "TRACE", ["TRACE", "ARCHMAGE", "TRACE"]),
  slotRow(6, "MAGNEMITE", null, "STURDY", ["MAGNET_PULL", "TRANSISTOR", "ANALYTIC"]),
  slotRow(6, "MAGNETON", null, "STURDY", ["MAGNET_PULL", "TRANSISTOR", "ANALYTIC"]),
  slotRow(6, "MAGNEZONE", null, "STURDY", ["MAGNET_PULL", "TRANSISTOR", "ANALYTIC"]),
  slotRow(7, "GENGAR", "mega", "NONE", ["SHADOW_TAG", "WICKED_SCHEME", "NONE"]),
  slotRow(8, "ALOLA_EXEGGUTOR", null, "NONE", ["FRISK", "SUNBATHE", "HARVEST"]),
  slotRow(9, "ALOLA_MAROWAK", null, "LIGHTNING_ROD", ["CURSED_BODY", "GORILLA_TACTICS", "ROCK_HEAD"]),
  slotRow(10, "PORYGON", null, "DOWNLOAD", ["TRACE", "SPACE_WARP", "ANALYTIC"]),
  slotRow(10, "PORYGON2", null, "DOWNLOAD", ["TRACE", "SPACE_WARP", "ANALYTIC"]),
  slotRow(11, "PORYGON_Z", null, "DOWNLOAD", ["ADAPTABILITY", "SPACE_WARP", "ANALYTIC"]),
  slotRow(12, "GALAR_ZAPDOS", null, "NONE", ["DEFIANT", "LIGHTNING_ROD", "NONE"]),
  slotRow(13, "GALAR_MOLTRES", null, "NONE", ["BERSERK", "DROUGHT", "NONE"]),
  slotRow(14, "MEWTWO", "mega-x", "NONE", ["STEADFAST", "ADAPTABILITY", "STEADFAST"]),
  slotRow(15, "MEWTWO", "mega-y", "NONE", ["INSOMNIA", "ADAPTABILITY", "INSOMNIA"]),
  slotRow(16, "MISDREAVUS", null, "NONE", ["LEVITATE", "WICKED_SCHEME", "NONE"]),
  slotRow(16, "MISMAGIUS", null, "NONE", ["LEVITATE", "WICKED_SCHEME", "NONE"]),
  slotRow(17, "MANTYKE", null, "WATER_ABSORB", ["SWIFT_SWIM", "LIGHTNING_ROD", "WATER_VEIL"]),
  slotRow(17, "MANTINE", null, "WATER_ABSORB", ["SWIFT_SWIM", "LIGHTNING_ROD", "WATER_VEIL"]),
  slotRow(18, "SKARMORY", "mega", "STALWART", ["STALWART", "STEEL_BODY", "STALWART"]),
  slotRow(19, "RAIKOU", null, "NONE", ["PRESSURE", "ELECTRIC_SURGE", "INNER_FOCUS"]),
  slotRow(20, "ENTEI", null, "NONE", ["PRESSURE", "DROUGHT", "INNER_FOCUS"]),
  slotRow(21, "SUICUNE", null, "NONE", ["PRESSURE", "DRIZZLE", "INNER_FOCUS"]),
  slotRow(22, "TYRANITAR", "mega", "NONE", ["SAND_STREAM", "SAND_RUSH", "SAND_STREAM"]),
  slotRow(23, "SCEPTILE", "mega", "NONE", ["LIGHTNING_ROD", "MEGA_SOL", "LIGHTNING_ROD"]),
  slotRow(24, "GALLADE", "mega", "INNER_FOCUS", ["INNER_FOCUS", "INTREPID_SWORD", "INNER_FOCUS"]),
  slotRow(25, "MANECTRIC", "mega", "INTIMIDATE", ["INTIMIDATE", "TRANSISTOR", "INTIMIDATE"]),
  slotRow(26, "SHARPEDO", "mega", "NONE", ["STRONG_JAW", "GORILLA_TACTICS", "STRONG_JAW"]),
  slotRow(27, "CAMERUPT", "mega", "SHEER_FORCE", ["SHEER_FORCE", "SOLAR_POWER", "SHEER_FORCE"]),
  slotRow(28, "VIBRAVA", null, "NONE", ["LEVITATE", "SAND_FORCE", "NONE"]),
  slotRow(28, "FLYGON", null, "NONE", ["LEVITATE", "SAND_FORCE", "NONE"]),
  slotRow(29, "CACNEA", null, "NONE", ["SAND_VEIL", "ROUGH_SKIN", "WATER_ABSORB"]),
  slotRow(29, "CACTURNE", null, "NONE", ["SAND_VEIL", "ROUGH_SKIN", "WATER_ABSORB"]),
  slotRow(30, "FROSLASS", null, "NONE", ["SNOW_CLOAK", "SNOW_WARNING", "CURSED_BODY"]),
  slotRow(31, "FROSLASS", "mega", "NONE", ["SNOW_WARNING", "SLUSH_RUSH", "SNOW_WARNING"]),
  slotRow(32, "SALAMENCE", null, "NONE", ["INTIMIDATE", "ROCK_HEAD", "MOXIE"]),
  slotRow(33, "REGIROCK", null, "NONE", ["CLEAR_BODY", "SAND_FORCE", "STURDY"]),
  slotRow(34, "REGICE", null, "NONE", ["CLEAR_BODY", "POLAR_LIGHT", "ICE_BODY"]),
  slotRow(35, "REGISTEEL", null, "NONE", ["CLEAR_BODY", "STEEL_BODY", "LIGHT_METAL"]),
  slotRow(36, "LATIAS", "mega", "NONE", ["LEVITATE", "SPEED_BOOST", "NONE"]),
  slotRow(37, "LATIOS", "mega", "NONE", ["LEVITATE", "SPEED_BOOST", "NONE"]),
  slotRow(38, "DEOXYS", "attack", "NONE", ["PRESSURE", "MOXIE", "NONE"]),
  slotRow(39, "DEOXYS", "defense", "NONE", ["PRESSURE", "STAMINA", "NONE"]),
  slotRow(40, "DEOXYS", "speed", "NONE", ["PRESSURE", "SPEED_BOOST", "NONE"]),
  slotRow(41, "TURTWIG", null, "NONE", ["OVERGROW", "GRASSY_SURGE", "SHELL_ARMOR"]),
  slotRow(41, "GROTLE", null, "NONE", ["OVERGROW", "GRASSY_SURGE", "SHELL_ARMOR"]),
  slotRow(41, "TORTERRA", null, "NONE", ["OVERGROW", "GRASSY_SURGE", "SHELL_ARMOR"]),
  slotRow(42, "PIPLUP", null, "NONE", ["TORRENT", "OVERAWE", "COMPETITIVE"]),
  slotRow(42, "PRINPLUP", null, "NONE", ["TORRENT", "OVERAWE", "COMPETITIVE"]),
  slotRow(42, "EMPOLEON", null, "NONE", ["TORRENT", "OVERAWE", "COMPETITIVE"]),
  slotRow(43, "KRICKETUNE", null, "NONE", ["SWARM", "LAST_STAND", "TECHNICIAN"]),
  slotRow(44, "ROTOM", "fan", "NONE", ["LEVITATE", "AERILATE", "NONE"]),
  slotRow(45, "HEATRAN", "mega", "NONE", ["FLASH_FIRE", "DESOLATE_LAND", "FLASH_FIRE"]),
  slotRow(46, "BLOODMOON_URSALUNA", null, "NONE", ["MINDS_EYE", "GRIT", "NONE"]),
];

/**
 * Members whose new ability is also one of their passives (the game's own passive or our sheet's `custom-passives`
 * entry), so that Pokémon can end up with the same ability twice
 */
const PASSIVE_DUPLICATES: readonly string[] = ["GALLADE mega: custom passive INTREPID_SWORD"];

function label(row: SlotRow): string {
  return `row ${row.row} ${row.species}${row.formKey == null ? "" : ` (${row.formKey})`}`;
}

/** The species (or form) data each table row checks; a base-species row also checks the base form */
function slotHolders(row: SlotRow): { species: PokemonSpecies; holders: (PokemonSpecies | PokemonForm)[] } {
  const species = speciesDataRegistry.getSpecies(SpeciesId[row.species]);
  if (row.formKey == null) {
    return { species, holders: species.forms.length > 0 ? [species, species.forms[0]] : [species] };
  }
  const form = species.forms.find(f => f.formKey === row.formKey);
  if (form == null) {
    throw new Error(`${label(row)}: no such form`);
  }
  return { species, holders: [form] };
}

function slotsOf(holder: PokemonSpecies | PokemonForm): [AbilityName, AbilityName, AbilityName] {
  return [
    AbilityId[holder.ability1] as AbilityName,
    AbilityId[holder.ability2] as AbilityName,
    AbilityId[holder.abilityHidden] as AbilityName,
  ];
}

describe("D12 - the passive sheet's extra abilities in the species' ability slots", () => {
  it("covers every row of the sheet's column", () => {
    const rows = new Set([...SLOT_TABLE.map(r => r.row), ...NOT_IN_FORK]);
    expect([...rows].sort((a, b) => a - b)).toEqual(Object.keys(SHEET_ABILITY).map(Number));
    expect(rows.size).toBe(47);
  });

  it.each(SLOT_TABLE.map(r => [label(r), r] as const))("%s has the final slots", (_label, row) => {
    const { holders } = slotHolders(row);
    for (const holder of holders) {
      expect(slotsOf(holder)).toEqual(row.slots);
      // the sheet's ability, in ability2 (the first free slot, or the replaced one)
      expect(AbilityId[holder.ability2].replaceAll("_", "")).toBe(SHEET_ABILITY[row.row]);
    }
    // what ability2 held before is gone, unless it was empty (then it was ability1, which stays)
    if (row.replaced !== "NONE" && row.replaced !== row.slots[0] && row.replaced !== row.slots[2]) {
      expect(row.slots).not.toContain(row.replaced);
    }
  });

  it("leaves the other forms of a species alone", () => {
    // e.g. Froslass's base form and Mega both changed, but not by each other's row; Gallade's Mega Z stays
    const galladeMegaZ = speciesDataRegistry.getSpecies(SpeciesId.GALLADE).forms.find(f => f.formKey === "mega-z");
    expect(galladeMegaZ && slotsOf(galladeMegaZ)).toEqual(["MIND_BLADE", "MIND_BLADE", "MIND_BLADE"]);
    const venusaur = speciesDataRegistry.getSpecies(SpeciesId.VENUSAUR);
    expect(slotsOf(venusaur)).toEqual(["OVERGROW", "OVERGROW", "CHLOROPHYLL"]);
    expect(slotsOf(venusaur.forms[1])).toEqual(["THICK_FAT", "THICK_FAT", "THICK_FAT"]);
    const rotomHeat = speciesDataRegistry.getSpecies(SpeciesId.ROTOM).forms.find(f => f.formKey === "heat");
    expect(rotomHeat && slotsOf(rotomHeat)).toEqual(["LEVITATE", "LEVITATE", "NONE"]);
  });

  it("skips Armored Mewtwo, which the fork does not have", () => {
    const mewtwo = speciesDataRegistry.getSpecies(SpeciesId.MEWTWO);
    expect(mewtwo.forms.map(f => f.formKey)).toEqual(["", "mega-x", "mega-y"]);
  });

  it("lists the members whose new ability is also their passive", () => {
    const duplicates: string[] = [];
    for (const row of SLOT_TABLE) {
      const { species, holders } = slotHolders(row);
      const formIndex = row.formKey == null ? 0 : species.forms.findIndex(f => f.formKey === row.formKey);
      const added = holders[0].ability2;
      const where = `${row.species}${row.formKey == null ? "" : ` ${row.formKey}`}`;
      if (speciesDataRegistry.getPassive(species.speciesId, formIndex) === added) {
        duplicates.push(`${where}: passive ${AbilityId[added]}`);
      }
      if (getCustomPassive(species.speciesId, row.formKey ?? "") === added) {
        duplicates.push(`${where}: custom passive ${AbilityId[added]}`);
      }
    }
    expect(duplicates).toEqual(PASSIVE_DUPLICATES);
  });
});

describe("D12 - the new abilities", () => {
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
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH, MoveId.ICE_BEAM, MoveId.TACKLE]);
  });

  it("are registered at the end of the enum with ko and en texts", () => {
    const ids = [AbilityId.ARCHMAGE, AbilityId.WICKED_SCHEME, AbilityId.GRIT];
    expect(ids).toEqual([AbilityId.TURNABOUT + 1, AbilityId.TURNABOUT + 2, AbilityId.TURNABOUT + 3]);
    for (const lang of ["ko", "en"]) {
      const locale = JSON.parse(readFileSync(`locales/${lang}/ability.json`, "utf-8"));
      for (const id of ids) {
        expect(allAbilities[id].id).toBe(id);
        expect(locale[toCamelCase(AbilityId[id])]?.name, `${lang} ${AbilityId[id]}`).toBeTruthy();
        expect(locale[toCamelCase(AbilityId[id])]?.description, `${lang} ${AbilityId[id]}`).toBeTruthy();
      }
    }
    const ko = JSON.parse(readFileSync("locales/ko/ability.json", "utf-8"));
    expect(ko.archmage).toEqual({ name: "대마도사", description: "특수공격이 2배가 된다." });
    expect(ko.wickedScheme).toEqual({
      name: "흑심",
      description: "배틀에서 처음 등장했을 때 특수공격이 크게 올라간다.",
    });
    expect(ko.grit).toEqual({ name: "투혼", description: "상태 이상이 되면 투지가 불타올라 특수공격이 올라간다." });
  });

  describe("Archmage", () => {
    it("doubles Sp. Atk for special moves only", async () => {
      game.override.ability(AbilityId.ARCHMAGE);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const spAtk = player.stats[Stat.SPATK];

      expect(player.getEffectiveStat(Stat.SPATK, { move: allMoves[MoveId.ICE_BEAM] })).toBe(spAtk * 2);
      expect(player.getEffectiveStat(Stat.SPATK, { move: allMoves[MoveId.TACKLE] })).toBe(spAtk);
      expect(player.getEffectiveStat(Stat.ATK, { move: allMoves[MoveId.TACKLE] })).toBe(player.stats[Stat.ATK]);
    });

    it("works as a passive too and raises special damage", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const iceBeam = allMoves[MoveId.ICE_BEAM];
      const plain = enemy.getAttackDamage({ source: player, move: iceBeam, simulated: true }).damage;

      game.override.passiveAbility(AbilityId.ARCHMAGE);
      expect(player.getEffectiveStat(Stat.SPATK, { move: iceBeam })).toBe(player.stats[Stat.SPATK] * 2);
      expect(enemy.getAttackDamage({ source: player, move: iceBeam, simulated: true }).damage).toBeGreaterThan(plain);
    });
  });

  describe("Wicked Scheme", () => {
    beforeEach(() => {
      game.override.ability(AbilityId.WICKED_SCHEME);
    });

    it("raises Sp. Atk by 2 on entry and nothing else", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const feebas = game.field.getPlayerPokemon();

      expect(feebas).toHaveAbilityApplied(AbilityId.WICKED_SCHEME);
      expect(feebas).toHaveStatStage(Stat.SPATK, 2);
      expect(feebas).toHaveStatStage(Stat.ATK, 0);
      expect(feebas).toHaveStatStage(Stat.DEF, 0);
      expect(feebas).toHaveStatStage(Stat.SPD, 0);
    });

    it("does not trigger again when it comes back in during the same battle", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
      const [feebas, magikarp] = game.scene.getPlayerParty();
      expect(feebas).toHaveStatStage(Stat.SPATK, 2);

      game.doSwitchPokemon(1);
      await game.toNextTurn();
      expect(game.field.getPlayerPokemon()).toBe(magikarp);
      expect(magikarp).toHaveStatStage(Stat.SPATK, 2);

      game.doSwitchPokemon(1);
      await game.toNextTurn();
      expect(game.field.getPlayerPokemon()).toBe(feebas);
      expect(feebas).toHaveStatStage(Stat.SPATK, 0);
    });
  });

  describe("Grit", () => {
    beforeEach(() => {
      game.override.ability(AbilityId.GRIT);
    });

    it("does nothing without a status condition", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();

      expect(player.getEffectiveStat(Stat.SPATK, { move: allMoves[MoveId.ICE_BEAM] })).toBe(player.stats[Stat.SPATK]);
    });

    it("multiplies Sp. Atk by 1.5 for special moves while it has a status condition", async () => {
      game.override.statusEffect(StatusEffect.BURN);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const spAtk = player.stats[Stat.SPATK];

      expect(player.status?.effect).toBe(StatusEffect.BURN);
      expect(player.getEffectiveStat(Stat.SPATK, { move: allMoves[MoveId.ICE_BEAM] })).toBe(Math.floor(spAtk * 1.5));
      expect(player.getEffectiveStat(Stat.SPATK, { move: allMoves[MoveId.TACKLE] })).toBe(spAtk);
      expect(player.getEffectiveStat(Stat.ATK, { move: allMoves[MoveId.TACKLE] })).toBe(player.stats[Stat.ATK]);
    });
  });
});
