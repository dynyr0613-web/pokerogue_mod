import { speciesDataRegistry } from "#app/global-species-data-registry";
import { getCustomPassive } from "#balance/custom-passives";
import { modifierTypes } from "#data/data-lists";
import type { PokemonSpeciesForm } from "#data/pokemon-species";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { FormChangeItem } from "#enums/form-change-item";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { PERMANENT_STATS } from "#enums/stat";
import type { PlayerPokemon } from "#field/pokemon";
import { PokemonFormChangeItemModifier } from "#modifiers/modifier";
import { FormChangeItemModifierType, type FusePokemonModifierType } from "#modifiers/modifier-type";
import { variantData } from "#sprites/variant";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import { getAppRootDir } from "#test/utils/sprite-utils";
import { getModifierType } from "#utils/modifier-utils";
import { getFusedSpeciesName } from "#utils/pokemon-utils";
import fs from "node:fs";
import path from "node:path";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/*
 * DNA Splicers with our five custom Megas, next to an official Mega (Charizard X) so any difference shows up.
 * Fusion rules in this codebase: the head gives the first type, the passive and the form changes
 * (only `pokemon.species` is checked for form changes), the tail gives the second type and the ability.
 * Unsplicing keeps the head only; the tail is lost by design ("... will be lost" in the confirmation).
 */

interface MegaCase {
  /** English battle name of the Mega form */
  name: string;
  species: SpeciesId;
  item: FormChangeItem;
  formKey: string;
  types: PokemonType[];
  ability: AbilityId;
  /** The Mega form's base passive (species `passives` map) */
  passive: AbilityId;
  /** Sprite id of the Mega form's front sprite */
  sprite: string;
  official?: boolean;
}

const MEGAS: MegaCase[] = [
  {
    name: "Mega Charizard Z",
    species: SpeciesId.CHARIZARD,
    item: FormChangeItem.CHARIZARDITE_Z,
    formKey: SpeciesFormKey.MEGA_Z,
    types: [PokemonType.ICE, PokemonType.FLYING],
    ability: AbilityId.FROSTFIRE,
    passive: AbilityId.SLUSH_RUSH,
    sprite: "6-mega-z",
  },
  {
    name: "Mega Gallade Z",
    species: SpeciesId.GALLADE,
    item: FormChangeItem.GALLADITE_Z,
    formKey: SpeciesFormKey.MEGA_Z,
    types: [PokemonType.PSYCHIC, PokemonType.FIGHTING],
    ability: AbilityId.MIND_BLADE,
    passive: AbilityId.SUPER_LUCK,
    sprite: "475-mega-z",
  },
  {
    name: "Mega Melmetal",
    species: SpeciesId.MELMETAL,
    item: FormChangeItem.MELMETALITE,
    formKey: SpeciesFormKey.MEGA,
    types: [PokemonType.STEEL],
    ability: AbilityId.IRON_FIST,
    passive: AbilityId.STEEL_BODY,
    sprite: "809-mega",
  },
  {
    name: "Mega Baxcalibur Z",
    species: SpeciesId.BAXCALIBUR,
    item: FormChangeItem.BAXCALIBRITE_Z,
    formKey: SpeciesFormKey.MEGA_Z,
    types: [PokemonType.DRAGON, PokemonType.ICE],
    ability: AbilityId.HILT_CANNON,
    passive: AbilityId.SNOW_WARNING,
    sprite: "998-mega-z",
  },
  {
    name: "Mega Archaludon",
    species: SpeciesId.ARCHALUDON,
    item: FormChangeItem.ARCHALUDONITE,
    formKey: SpeciesFormKey.MEGA,
    types: [PokemonType.STEEL, PokemonType.DRAGON],
    ability: AbilityId.STEEL_BODY,
    passive: AbilityId.STEELWORKER,
    // Local fork (2026-11-11): no art of its own yet, so it shows the base Archaludon's sprites (formSpriteKey "")
    sprite: "1018",
  },
  {
    name: "Mega Charizard X",
    species: SpeciesId.CHARIZARD,
    item: FormChangeItem.CHARIZARDITE_X,
    formKey: SpeciesFormKey.MEGA_X,
    types: [PokemonType.FIRE, PokemonType.DRAGON],
    ability: AbilityId.TOUGH_CLAWS,
    passive: AbilityId.LEVITATE,
    sprite: "6-mega-x",
    official: true,
  },
];

/** The splice partner: mono Water (no Mega is Water), no forms, no gender differences */
const PARTNER = SpeciesId.VAPOREON;
const PARTNER_ABILITY = AbilityId.WATER_ABSORB;
const PARTNER_PASSIVE = AbilityId.REGENERATOR;

const IMAGES = path.join(getAppRootDir(), "assets", "images");

/** The png/json pair `BattleScene.loadPokemonAtlas` fetches for a sprite key or id */
function atlasFiles(key: string): string[] {
  const atlasPath = key.replace(/^pkmn__/, "").replace(/__/g, "/");
  const dir = /_[1-3]$/.test(atlasPath) ? path.join(IMAGES, "pokemon", "variant") : path.join(IMAGES, "pokemon");
  return [".png", ".json"].map(ext => path.join(dir, atlasPath + ext));
}

function missingFiles(...keys: string[]): string[] {
  return keys
    .flatMap(atlasFiles)
    .filter(f => !fs.existsSync(f))
    .map(f => path.relative(IMAGES, f).replace(/\\/g, "/"));
}

const iconFrames = new Map<string, Set<string>>();
function hasIconFrame(atlasKey: string, frame: string): boolean {
  let frames = iconFrames.get(atlasKey);
  if (!frames) {
    const file = path.join(IMAGES, `${atlasKey}.json`);
    const json = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { textures: [] };
    frames = new Set<string>(
      json.textures.flatMap((t: { frames: { filename: string }[] }) => t.frames.map(f => f.filename)),
    );
    iconFrames.set(atlasKey, frames);
  }
  return frames.has(frame);
}

/** The game loads this at boot; make sure the sprite ids below see the real variant table */
function ensureVariantData(): void {
  if (!variantData["6-mega-x"]) {
    const file = path.join(IMAGES, "pokemon", "variant", "_masterlist.json");
    Object.assign(variantData, JSON.parse(fs.readFileSync(file, "utf8")));
  }
}

function fusedBaseStats(head: PokemonSpeciesForm, tail: PokemonSpeciesForm): number[] {
  return PERMANENT_STATS.map(s => Math.ceil((head.baseStats[s] + tail.baseStats[s]) / 2));
}

const typeNames = (types: PokemonType[]) => types.map(t => PokemonType[t]);
const abilityName = (id: AbilityId) => AbilityId[id];

function observe(label: string, data: object): void {
  console.log(`[mega-fusion] ${label} ${JSON.stringify(data)}`);
}

describe("DNA Splicers with custom Megas", () => {
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
      .battleType(BattleType.WILD)
      // Level 100 so no EXP, level-up moves or evolutions get in the way of the next wave
      .startingLevel(100)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(5)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      // Head and tail share these four moves, so the LearnMovePhases queued by a splice end on their own
      .moveset([MoveId.SPLASH, MoveId.TACKLE, MoveId.GROWL, MoveId.HARDEN]);
  });

  const splicers = () => getModifierType(modifierTypes.DNA_SPLICERS) as FusePokemonModifierType;
  /** The party menu's filter for DNA Splicers: `null` means the Pokemon can be picked (as head or as tail) */
  const spliceRefusal = (pokemon: PlayerPokemon) => splicers().selectFilter?.(pokemon) ?? null;

  /** Use DNA Splicers the way the reward screen does: the first pick is the head, the second the tail */
  function splice(head: PlayerPokemon, tail: PlayerPokemon): void {
    expect(game.scene.addModifier(splicers().newModifier(head, tail))).toBe(true);
  }

  function giveStone(pokemon: PlayerPokemon, item: FormChangeItem): void {
    game.scene.addModifier(new FormChangeItemModifierType(item).newModifier(pokemon), false, true);
  }

  function heldStones(pokemon: PlayerPokemon): PokemonFormChangeItemModifier[] {
    return game.scene.findModifiers(
      m => m instanceof PokemonFormChangeItemModifier && m.pokemonId === pokemon.id,
    ) as PokemonFormChangeItemModifier[];
  }

  async function passTurn(): Promise<void> {
    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();
  }

  function roundTrip(pokemon: PlayerPokemon): PlayerPokemon {
    const json = JSON.stringify(new PokemonData(pokemon), (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    return new PokemonData(JSON.parse(json)).toPokemon() as PlayerPokemon;
  }

  const megaIndexOf = (m: MegaCase) =>
    speciesDataRegistry.getSpecies(m.species).forms.findIndex(f => f.formKey === m.formKey);
  const partnerForm = () => speciesDataRegistry.getSpecies(PARTNER);

  describe.each(MEGAS)("$name", m => {
    const tag = m.official ? `${m.name} (official)` : m.name;

    it("Mega Evolves as the head of a splice when it gets its stone", async () => {
      await game.classicMode.startBattle(m.species, PARTNER);
      const [head, partner] = game.scene.getPlayerParty();
      partner.abilityIndex = 0;
      const baseForm = head.getSpeciesForm();

      splice(head, partner);
      expect(head.isFusion()).toBe(true);
      expect(head.getFormKey()).toBe("");
      expect(head.getTypes()).toEqual([baseForm.type1, PokemonType.WATER]);
      const statsBefore = [...head.stats];
      const nameBefore = head.name;

      giveStone(head, m.item);
      await passTurn();

      const megaIndex = megaIndexOf(m);
      const megaForm = head.getSpeciesForm();
      expect(head.formIndex).toBe(megaIndex);
      expect(head.getFormKey()).toBe(m.formKey);
      expect(head.isMega()).toBe(true);
      expect(head.isFusion()).toBe(true);
      expect(head.getTypes()).toEqual([m.types[0], PokemonType.WATER]);
      // a fusion takes the tail's ability and the head's passive
      expect(head.getAbility().id).toBe(PARTNER_ABILITY);
      expect(head.getPassiveAbility().id).toBe(m.passive);
      head.customPassiveSpecies = [m.species];
      const customPassive = head.getPassiveAbility().id;
      expect(customPassive).toBe(getCustomPassive(m.species, m.formKey));
      head.customPassiveSpecies = [];

      // stats now average the Mega form, not the base form, with the tail
      expect(head.calculateBaseStats()).toEqual(fusedBaseStats(megaForm, partnerForm()));
      expect(head.stats).not.toEqual(statsBefore);
      const stats = [...head.stats];
      head.calculateStats();
      expect(head.stats).toEqual(stats);

      expect(head.species.getName(head.formIndex)).toBe(m.name);
      expect(head.name).toBe(getFusedSpeciesName(m.name, partnerForm().name));
      expect(head.name).not.toBe(nameBefore);

      expect(head.getBattleSpriteId(false)).toBe(m.sprite);
      expect(head.getBattleSpriteId(true)).toBe(`back__${m.sprite}`);
      const spriteKeys = [
        head.getSpriteKey(),
        head.getBattleSpriteKey(false),
        head.getBattleSpriteKey(true),
        head.getFusionBattleSpriteKey(false),
        head.getFusionBattleSpriteKey(true),
      ];
      expect(missingFiles(...spriteKeys)).toEqual([]);
      expect(hasIconFrame(head.getIconAtlasKey(), head.getIconId())).toBe(true);
      expect(hasIconFrame(head.getFusionIconAtlasKey(), head.getFusionIconId())).toBe(true);

      observe(`${tag} head (spliced, then stone)`, {
        formIndex: head.formIndex,
        formKey: head.getFormKey(),
        types: typeNames(head.getTypes()),
        ability: abilityName(head.getAbility().id),
        passive: abilityName(head.getPassiveAbility().id),
        customPassive: abilityName(customPassive),
        name: head.name,
        baseStats: head.calculateBaseStats(),
        spriteKeys,
        icon: [head.getIconAtlasKey(), head.getIconId()],
        fusionIcon: [head.getFusionIconAtlasKey(), head.getFusionIconId()],
      });
    });

    it("stays Mega when a Mega head is spliced, and into the next wave", async () => {
      await game.classicMode.startBattle(m.species, PARTNER);
      const [head, partner] = game.scene.getPlayerParty();
      partner.abilityIndex = 0;

      giveStone(head, m.item);
      await passTurn();
      expect(head.getFormKey()).toBe(m.formKey);

      // DNA Splicers accept a Mega as either pick
      expect(spliceRefusal(head)).toBeNull();
      expect(spliceRefusal(partner)).toBeNull();
      splice(head, partner);
      // ...and refuse a Pokemon that is already a fusion
      expect(spliceRefusal(head)).not.toBeNull();

      const megaIndex = megaIndexOf(m);
      expect(head.formIndex).toBe(megaIndex);
      expect(head.getTypes()).toEqual([m.types[0], PokemonType.WATER]);
      expect(head.getAbility().id).toBe(PARTNER_ABILITY);
      expect(head.getPassiveAbility().id).toBe(m.passive);
      expect(head.calculateBaseStats()).toEqual(fusedBaseStats(head.getSpeciesForm(), partnerForm()));

      game.move.select(MoveId.SPLASH);
      await game.doKillOpponents();
      await game.toNextWave();

      expect(game.scene.currentBattle.waveIndex).toBe(2);
      expect(game.field.getPlayerPokemon()).toBe(head);
      expect(head.isFusion()).toBe(true);
      expect(head.formIndex).toBe(megaIndex);
      expect(head.getTypes()).toEqual([m.types[0], PokemonType.WATER]);
      expect(heldStones(head).map(s => [s.formChangeItem, s.active])).toEqual([[m.item, true]]);

      observe(`${tag} Mega head spliced`, {
        wave: game.scene.currentBattle.waveIndex,
        formKey: head.getFormKey(),
        types: typeNames(head.getTypes()),
        ability: abilityName(head.getAbility().id),
        passive: abilityName(head.getPassiveAbility().id),
      });
    });

    it("fuses as the tail in Mega form", async () => {
      await game.classicMode.startBattle(PARTNER, m.species);
      const [head, tail] = game.scene.getPlayerParty();
      tail.abilityIndex = 0;

      // Mega Evolve the tail on the bench first
      giveStone(tail, m.item);
      await passTurn();
      const megaIndex = megaIndexOf(m);
      expect(tail.formIndex).toBe(megaIndex);
      const megaForm = tail.getSpeciesForm();

      expect(spliceRefusal(tail)).toBeNull();
      splice(head, tail);
      expect(game.scene.getPlayerParty()).toHaveLength(1);
      expect(game.scene.getPlayerParty()[0]).toBe(head);

      expect(head.fusionSpecies?.speciesId).toBe(m.species);
      expect(head.fusionFormIndex).toBe(megaIndex);
      expect(head.getFusionFormKey()).toBe(m.formKey);
      expect(head.isMega()).toBe(true);
      expect(head.getTypes()).toEqual([PokemonType.WATER, m.types[1] ?? m.types[0]]);
      expect(head.getAbility().id).toBe(m.ability);
      for (const slot of [0, 1, 2]) {
        head.fusionAbilityIndex = slot;
        expect(head.getAbility().id, `ability slot ${slot}`).toBe(m.ability);
      }
      head.fusionAbilityIndex = 0;
      expect(head.getPassiveAbility().id).toBe(PARTNER_PASSIVE);
      expect(head.calculateBaseStats()).toEqual(fusedBaseStats(partnerForm(), megaForm));

      expect(head.fusionSpecies?.getName(head.fusionFormIndex)).toBe(m.name);
      expect(head.name).toBe(getFusedSpeciesName(partnerForm().name, m.name));

      expect(head.getFusionBattleSpriteId(false)).toBe(m.sprite);
      expect(head.getFusionBattleSpriteId(true)).toBe(`back__${m.sprite}`);
      const spriteKeys = [
        head.getBattleSpriteKey(false),
        head.getBattleSpriteKey(true),
        head.getFusionBattleSpriteKey(false),
        head.getFusionBattleSpriteKey(true),
      ];
      expect(missingFiles(...spriteKeys)).toEqual([]);
      expect(hasIconFrame(head.getFusionIconAtlasKey(), head.getFusionIconId())).toBe(true);
      // the tail's stone moves to the head with the rest of its items
      const stonesAfterSplice = heldStones(head).map(s => [FormChangeItem[s.formChangeItem], s.active]);

      // a turn in battle (and the queued LearnMovePhases) leaves the Mega tail alone
      await passTurn();
      expect(head.fusionFormIndex).toBe(megaIndex);
      expect(head.getTypes()).toEqual([PokemonType.WATER, m.types[1] ?? m.types[0]]);

      const loaded = roundTrip(head);
      expect(loaded.fusionSpecies?.speciesId).toBe(m.species);
      expect(loaded.fusionFormIndex).toBe(megaIndex);
      expect(loaded.getFusionFormKey()).toBe(m.formKey);
      expect(loaded.getTypes()).toEqual(head.getTypes());
      expect(loaded.getAbility().id).toBe(m.ability);
      expect(loaded.getPassiveAbility().id).toBe(PARTNER_PASSIVE);
      expect(loaded.calculateBaseStats()).toEqual(head.calculateBaseStats());
      expect(loaded.name).toBe(head.name);
      expect(loaded.getFusionBattleSpriteKey(false)).toBe(head.getFusionBattleSpriteKey(false));

      observe(`${tag} tail`, {
        fusionFormIndex: head.fusionFormIndex,
        fusionFormKey: head.getFusionFormKey(),
        types: typeNames(head.getTypes()),
        ability: abilityName(head.getAbility().id),
        passive: abilityName(head.getPassiveAbility().id),
        name: head.name,
        baseStats: head.calculateBaseStats(),
        spriteKeys,
        fusionIcon: [head.getFusionIconAtlasKey(), head.getFusionIconId()],
        stonesAfterSplice,
        loaded: {
          fusionFormIndex: loaded.fusionFormIndex,
          types: typeNames(loaded.getTypes()),
          ability: abilityName(loaded.getAbility().id),
        },
      });
    });

    it("unsplices back to the head with its own form; the tail is not restored", async () => {
      await game.classicMode.startBattle(m.species, PARTNER, PARTNER, m.species);
      const [megaHead, partnerTail, partnerHead, megaTail] = game.scene.getPlayerParty();
      partnerTail.abilityIndex = 0;
      megaTail.abilityIndex = 0;
      // the head's ability index is random too; its unfused ability is checked below
      partnerHead.abilityIndex = 0;

      giveStone(megaHead, m.item);
      giveStone(megaTail, m.item);
      await passTurn();
      const megaIndex = megaIndexOf(m);
      expect([megaHead.formIndex, megaTail.formIndex]).toEqual([megaIndex, megaIndex]);
      const megaForm = megaHead.getSpeciesForm();

      splice(megaHead, partnerTail);
      splice(partnerHead, megaTail);
      const party = game.scene.getPlayerParty();
      expect(party).toHaveLength(2);
      expect([party[0] === megaHead, party[1] === partnerHead]).toEqual([true, true]);

      await megaHead.unfuse();
      expect(megaHead.isFusion()).toBe(false);
      expect(megaHead.formIndex).toBe(megaIndex);
      expect(megaHead.getTypes()).toEqual(m.types);
      expect(megaHead.getAbility().id).toBe(m.ability);
      expect(megaHead.getPassiveAbility().id).toBe(m.passive);
      expect(megaHead.calculateBaseStats()).toEqual(megaForm.baseStats);
      expect(megaHead.name).toBe(m.name);
      expect(missingFiles(megaHead.getBattleSpriteKey(false), megaHead.getBattleSpriteKey(true))).toEqual([]);

      await partnerHead.unfuse();
      expect(partnerHead.isFusion()).toBe(false);
      expect(partnerHead.getTypes()).toEqual([PokemonType.WATER]);
      expect(partnerHead.getAbility().id).toBe(PARTNER_ABILITY);
      expect(partnerHead.calculateBaseStats()).toEqual(partnerForm().baseStats);
      expect(partnerHead.name).toBe(partnerForm().name);

      // Unsplicing never gives the tail back
      expect(game.scene.getPlayerParty().map(p => p.species.speciesId)).toEqual([m.species, PARTNER]);

      observe(`${tag} unsplice`, {
        megaHead: {
          formKey: megaHead.getFormKey(),
          types: typeNames(megaHead.getTypes()),
          ability: abilityName(megaHead.getAbility().id),
          name: megaHead.name,
          stones: heldStones(megaHead).map(s => [FormChangeItem[s.formChangeItem], s.active]),
        },
        partnerHead: {
          types: typeNames(partnerHead.getTypes()),
          ability: abilityName(partnerHead.getAbility().id),
          name: partnerHead.name,
          // the stone the Mega tail carried in stays on the unspliced partner
          stones: heldStones(partnerHead).map(s => [FormChangeItem[s.formChangeItem], s.active]),
        },
        party: game.scene.getPlayerParty().map(p => SpeciesId[p.species.speciesId]),
      });
    });

    it("shows a shiny sprite that exists for every shiny tier, as head and as tail", async () => {
      const megaIndex = megaIndexOf(m);
      game.override.starterForms({ [m.species]: megaIndex });
      await game.classicMode.startBattle(PARTNER, m.species, m.species, PARTNER);
      const [partnerHead, megaTail, megaHead, partnerTail] = game.scene.getPlayerParty();
      splice(partnerHead, megaTail);
      splice(megaHead, partnerTail);
      expect([megaHead.formIndex, partnerHead.fusionFormIndex]).toEqual([megaIndex, megaIndex]);

      ensureVariantData();
      // The sprite id is the variant table key too (`${species}-${formKey}`, or the base id for Mega Archaludon)
      const variantKey = m.sprite;
      const frontSet: number[] | undefined = variantData[variantKey];
      const backSet: number[] | undefined = variantData.back?.[variantKey];
      const problems: string[] = [];
      const seen: Record<string, string[]> = {};

      const checkSprite = (where: string, id: string, variantSet: number[] | undefined, variant: number) => {
        const atlasPath = id.replace(/__/g, "/");
        problems.push(...missingFiles(id).map(f => `${where}: missing ${f}`));
        const palette = variantSet?.[variant] === 1;
        if (palette && !fs.existsSync(path.join(IMAGES, "pokemon", "variant", `${atlasPath}.json`))) {
          problems.push(`${where}: missing palette variant/${atlasPath}.json`);
        }
        const shiny = id.includes("shiny__") || /_[23]$/.test(id) || palette;
        if (!shiny) {
          problems.push(`${where}: ${id} is the normal (not shiny) sprite`);
        }
      };
      const checkIcon = (where: string, atlas: string, frame: string) => {
        if (!hasIconFrame(atlas, frame)) {
          problems.push(`${where}: icon ${frame} not in ${atlas}`);
        }
        if (!/^\d+s/.test(frame) && !/_[23]$/.test(frame)) {
          problems.push(`${where}: icon ${frame} is not a shiny icon`);
        }
      };

      for (const variant of [0, 1, 2] as const) {
        const tier = `${variant + 1}-star`;
        megaHead.shiny = true;
        megaHead.variant = variant;
        partnerHead.fusionShiny = true;
        partnerHead.fusionVariant = variant;

        const headFront = megaHead.getBattleSpriteId(false);
        const headBack = megaHead.getBattleSpriteId(true);
        const tailFront = partnerHead.getFusionBattleSpriteId(false);
        const tailBack = partnerHead.getFusionBattleSpriteId(true);
        checkSprite(`head ${tier} front`, headFront, frontSet, variant);
        checkSprite(`head ${tier} back`, headBack, backSet, variant);
        checkSprite(`tail ${tier} front`, tailFront, frontSet, variant);
        checkSprite(`tail ${tier} back`, tailBack, backSet, variant);
        checkIcon(`head ${tier}`, megaHead.getIconAtlasKey(), megaHead.getIconId());
        checkIcon(`tail ${tier}`, partnerHead.getFusionIconAtlasKey(), partnerHead.getFusionIconId());
        seen[tier] = [
          headFront,
          headBack,
          tailFront,
          tailBack,
          `${megaHead.getIconAtlasKey()}/${megaHead.getIconId()}`,
          `${partnerHead.getFusionIconAtlasKey()}/${partnerHead.getFusionIconId()}`,
        ];
      }

      observe(`${tag} shiny tiers`, {
        variantData: { front: frontSet ?? null, back: backSet ?? null },
        seen,
        problems,
      });
      expect(problems).toEqual([]);
    });
  });
});
