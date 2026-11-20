/**
 * Local fork (2026-11-20), items V1 + V2 and the user's V4 note: Fire moves of Pokémon whose own flames are not orange
 * play their animation in their flames' colour. The user: "V1 실행", "V2 - 실행", "V4 - x, 메가리자몽 y가 쓰는 불 기술
 * 정도만 흰색 변환".
 *
 * - Who: {@linkcode FLAME_COLOR_TABLE}, one row per species (or one form of it). Edit it there: any of the four
 *   {@linkcode FLAME_COLORS} works at once; a fifth colour needs its sheet copies made first (a Pillow recolour script
 *   kept outside the repository) and its name added to `FlameColor`.
 * - What: a move whose ACTUAL type (`Pokemon.getMoveType`: Weather Ball in sun, -ate abilities, Normalize, Electrify,
 *   Tera Blast... all count) is Fire, used by a Pokémon whose current species / form is in the table (a fusion: its
 *   head, `Pokemon.species`; a transformed Pokémon: the form it copied; under Illusion: the disguise), draws the
 *   graphic cels of its animation from the colour copy of its sheet when the sheet is one of
 *   {@linkcode FLAME_RECOLOR_GRAPHICS}. Max / G-Max / Z Fire moves follow the same rule (Inferno Overdrive draws from
 *   "PRAS- Fire", Max Flare and G-Max Centiferno from "CFRU- Max Flare", G-Max Wildfire from its own sheet; G-Max
 *   Fireball plays Pyro Ball's, which has no copies). Backgrounds, sounds and the Pokémon cels stay
 *   as they are, and so does everything else (a non-Fire move from the same Pokémon, a Fire move from anyone else).
 * - The copies: "<sheet> (<colour>).png" next to the sheet in `images/battle_anims`. Only the flame colours changed
 *   (red to yellow hues), each pixel's alpha kept; see CREDITS.md.
 * - Loading: `Pokemon.loadAssets` queues the copies its Fire moves need (`loadMoveAnimations`), and a `MoveAnim` whose
 *   copy is still missing (a move learned or called mid-battle, a type change) loads it before it plays. If that load
 *   fails, the animation plays with the original sheet.
 */

import { globalScene } from "#app/global-scene";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import Phaser from "phaser";

/** The flame colours that have sheet copies */
export type FlameColor = "blue" | "white" | "purple" | "green";

/** Every {@linkcode FlameColor}, in the order the copies were made */
export const FLAME_COLORS: readonly FlameColor[] = Object.freeze(["blue", "white", "purple", "green"]);

/** A row of {@linkcode FLAME_COLOR_TABLE} */
export interface FlameColorEntry {
  readonly species: SpeciesId;
  /** The form's key (`SpeciesFormKey` or the form's own); left out, the row is for every form of the species */
  readonly formKey?: string;
  readonly color: FlameColor;
}

/**
 * Who uses which flame colour. One row per species or form; a row with a `formKey` wins over the species' row.
 * Mega Charizard X: the user's example (V1). Mega Charizard Y: the user's V4 note. The user left V2's other species to
 * Claude (any row may be changed): the Litwick line, Hisuian Typhlosion and Ceruledge burn with purple flames, Alolan
 * Marowak with green ones.
 */
export const FLAME_COLOR_TABLE: readonly FlameColorEntry[] = Object.freeze([
  { species: SpeciesId.CHARIZARD, formKey: SpeciesFormKey.MEGA_X, color: "blue" },
  { species: SpeciesId.CHARIZARD, formKey: SpeciesFormKey.MEGA_Y, color: "white" },
  { species: SpeciesId.LITWICK, color: "purple" },
  { species: SpeciesId.LAMPENT, color: "purple" },
  { species: SpeciesId.CHANDELURE, color: "purple" },
  { species: SpeciesId.HISUI_TYPHLOSION, color: "purple" },
  { species: SpeciesId.CERULEDGE, color: "purple" },
  { species: SpeciesId.ALOLA_MAROWAK, color: "green" },
]);

/**
 * The animation sheets that have colour copies: the flame sheets of Fire moves. "PRAS- Fire" is also drawn by
 * Outrage, Dragon Rage, Lash Out, Poltergeist, Beak Blast and Malicious Moonsault, and the elemental punch / fang and
 * Blaze Kick sheets by their other-type siblings; those never swap, since only a Fire move does. Not copied: sheets
 * whose flames are already another colour (Blue Flare, Will-O-Wisp, Mystical Fire, Bitter Blade), sheets that are not
 * flames (Heat Wave's, Sunny Day's, Mind Blown's, Burning Bulwark's) or not only flames (Armor Cannon's), and the two
 * sheets that are not Pokémon Reborn's or CFRU's (Pyro Ball's, also G-Max Fireball's; Raging Fury's). "CFRU- G-Max
 * Wildfire" is in: a Dynamax Candy turns any Charizard's Fire slot into G-Max Wildfire, Mega Charizard X / Y's too.
 */
export const FLAME_RECOLOR_GRAPHICS: ReadonlySet<string> = new Set([
  "PRAS- Fire",
  "PRAS- Eruption",
  "PRAS- Fire Spin",
  "PRAS- Magma Storm",
  "PRAS- Shell Trap",
  "PRAS- Fusion Flare",
  "PRAS- Elemental Punch",
  "PRAS- Elemental Fangs",
  "PRAS- Blaze Kick",
  "CFRU- Max Flare",
  "CFRU- G-Max Wildfire",
]);

/** The texture key (and file name without ".png") of `graphic`'s copy in `color` */
export function getFlameGraphicKey(graphic: string, color: FlameColor): string {
  return `${graphic} (${color})`;
}

/** The flame colour of `species` in the form `formKey`, or `undefined` for orange flames */
export function getSpeciesFlameColor(species: SpeciesId, formKey: string): FlameColor | undefined {
  let speciesRow: FlameColorEntry | undefined;
  for (const row of FLAME_COLOR_TABLE) {
    if (row.species !== species) {
      continue;
    }
    if (row.formKey === undefined) {
      speciesRow ??= row;
    } else if (row.formKey === formKey) {
      return row.color;
    }
  }
  return speciesRow?.color;
}

/**
 * The flame colour of `pokemon` as it looks now: its current species / form (a fusion's head; a transformed Pokémon's
 * copied form; under Illusion, the disguise's, so the flames never give the disguise away). `undefined` for orange
 * flames.
 */
export function getPokemonFlameColor(pokemon: Pokemon): FlameColor | undefined {
  const form = pokemon.getSpeciesForm(false, true);
  return getSpeciesFlameColor(form.speciesId, form.getFormKey());
}

/**
 * The colour copy a move animation drawing `graphic` uses when `user` uses it as a `moveType` move, or `undefined` for
 * the original sheet
 */
export function getMoveFlameGraphicKey(
  graphic: string | undefined,
  user: Pokemon | null | undefined,
  moveType: PokemonType | undefined,
): string | undefined {
  if (!graphic || !user || moveType !== PokemonType.FIRE || !FLAME_RECOLOR_GRAPHICS.has(graphic)) {
    return;
  }
  const color = getPokemonFlameColor(user);
  return color ? getFlameGraphicKey(graphic, color) : undefined;
}

/** Queues the copy `key` the way `loadAnimAssets` queues a sheet (96x96 frames); the caller starts the loader */
export function queueFlameGraphic(key: string): void {
  if (!globalScene.textures.exists(key)) {
    globalScene.loadSpritesheet(key, "battle_anims", 96);
  }
}

/** How long a play-time load may hold an animation before it plays with the original sheet */
const FLAME_LOAD_TIMEOUT_MS = 3000;

/**
 * Loads the copy `key` now. Resolves when the loader is done (or after {@linkcode FLAME_LOAD_TIMEOUT_MS}, so a stuck
 * load never holds the battle); the caller checks `textures.exists(key)` afterwards.
 */
export function loadFlameGraphic(key: string): Promise<void> {
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve();
      }
    };
    const timer = setTimeout(finish, FLAME_LOAD_TIMEOUT_MS);
    if (globalScene.textures.exists(key)) {
      finish();
      return;
    }
    globalScene.loadSpritesheet(key, "battle_anims", 96);
    globalScene.load.once(Phaser.Loader.Events.COMPLETE, finish);
    if (!globalScene.load.isLoading()) {
      globalScene.load.start();
    }
  });
}
