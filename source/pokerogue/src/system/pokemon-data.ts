import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import type { Gender } from "#data/gender";
import { CustomPokemonData, PokemonBattleData, PokemonSummonData } from "#data/pokemon-data";
import { normalizeMarks } from "#data/pokemon-marks";
import { Status } from "#data/status-effect";
import { BattleType } from "#enums/battle-type";
import type { BiomeId } from "#enums/biome-id";
import type { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { PokeballType } from "#enums/pokeball";
import type { PokemonMark } from "#enums/pokemon-mark";
import type { PokemonType } from "#enums/pokemon-type";
import type { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { EnemyPokemon, Pokemon } from "#field/pokemon";
import { hasAnyEvs, normalizeEvs } from "#modifiers/ev-items"; // Local fork (2026-11-12): EVs
import { PokemonMove } from "#moves/pokemon-move";
import type { Variant } from "#sprites/variant";

export class PokemonData {
  public id: number;
  public player: boolean;
  public species: SpeciesId;
  public nickname: string;
  public formIndex: number;
  public abilityIndex: number;
  public passive: boolean;
  /** Species set to our table's passive; see {@linkcode Pokemon.customPassiveSpecies} */
  public customPassiveSpecies: SpeciesId[];
  public shiny: boolean;
  public variant: Variant;
  public pokeball: PokeballType;
  public level: number;
  public exp: number;
  public levelExp: number;
  public gender: Gender;
  public hp: number;
  public stats: number[];
  public ivs: number[];
  /**
   * Local fork (2026-11-12): the Pokémon's EVs (노력치, `Pokemon.evs`); only set when one is above 0, so saves of
   * Pokémon without EVs are unchanged, and a save without them loads as all 0
   */
  declare public evs?: number[] | undefined;
  /**
   * Local fork (2026-11-17): the Pokémon's marks and ribbons (`Pokemon.marks`, pokemon-marks.ts); only set when it has
   * one, so saves of Pokémon without any are unchanged, and a save without them loads as none
   */
  declare public marks?: PokemonMark[] | undefined;
  public nature: Nature;
  public moveset: PokemonMove[];
  public status: Status | null;
  public friendship: number;
  public metLevel: number;
  public metBiome: BiomeId | -1; // -1 for starters
  public metSpecies: SpeciesId;
  public metWave: number; // 0 for unknown (previous saves), -1 for starters
  public luck: number;
  public pauseEvolutions: boolean;
  public pokerus: boolean;
  public usedTMs: MoveId[];
  public teraType: PokemonType;
  public isTerastallized: boolean;
  public stellarTypesBoosted: PokemonType[];

  public fusionSpecies: SpeciesId;
  public fusionFormIndex: number;
  public fusionAbilityIndex: number;
  public fusionShiny: boolean;
  public fusionVariant: Variant;
  public fusionGender: Gender;
  public fusionLuck: number;
  public fusionTeraType: PokemonType;

  public boss: boolean;
  public bossSegments: number;
  /**
   * Local fork (2026-11-10): an enemy's form before its battle form ({@linkcode EnemyPokemon.forkBattleFormBaseIndex});
   * only set when it has one, so other saves are unchanged
   */
  declare public forkBattleFormBaseIndex?: number | undefined;
  /**
   * Local fork (2026-11-13): an Endless boss trainer's member's HP-correction bars ({@linkcode EnemyPokemon.forkBossHpBars},
   * endless-boss-bars.ts, 08 명세 5번); only set when it has them, so other saves are unchanged
   */
  declare public forkBossHpBars?: number | undefined;

  // Effects that need to be preserved between waves
  public summonData: PokemonSummonData;
  public battleData: PokemonBattleData;
  public summonDataSpeciesFormIndex: number;

  public customPokemonData: CustomPokemonData;
  public fusionCustomPokemonData: CustomPokemonData;

  /**
   * Construct a new {@linkcode PokemonData} instance out of a {@linkcode Pokemon}
   * or JSON representation thereof.
   * @param source The {@linkcode Pokemon} to convert into data (or a JSON object representing one)
   */
  // TODO: Remove any from type signature in favor of 2 separate method funcs
  // TODO: change the source to `unknown` or create a method explicitly for converting from raw JSON data
  constructor(source: Pokemon | any) {
    const sourcePokemon = source instanceof Pokemon ? source : undefined;

    this.id = source.id;
    this.player = sourcePokemon?.isPlayer() ?? source.player;
    this.species = sourcePokemon?.species.speciesId ?? source.species;
    this.nickname = source.nickname;
    this.formIndex = Math.max(
      Math.min(source.formIndex, speciesDataRegistry.getSpecies(this.species).forms.length - 1),
      0,
    );
    this.abilityIndex = source.abilityIndex;
    this.passive = source.passive;
    if (Array.isArray(source.customPassiveSpecies)) {
      this.customPassiveSpecies = source.customPassiveSpecies.filter((s: unknown) => typeof s === "number");
    } else {
      // Saves from before the per-species choice held one flag for the whole line
      this.customPassiveSpecies = source.usesCustomPassive
        ? [this.species, ...speciesDataRegistry.getEvolutionChain(this.species)]
        : [];
    }
    this.shiny = source.shiny;
    this.variant = source.variant;
    this.pokeball = source.pokeball ?? PokeballType.POKEBALL;
    this.level = source.level;
    this.exp = source.exp;
    this.levelExp = source.levelExp;
    this.gender = source.gender;
    this.hp = source.hp;
    this.stats = source.stats;
    this.ivs = source.ivs;
    // Local fork (2026-11-12): EVs, see the field
    const evs = normalizeEvs(source.evs);
    if (hasAnyEvs(evs)) {
      this.evs = evs;
    }
    // Local fork (2026-11-17): marks and ribbons, see the field
    const marks = normalizeMarks(source.marks);
    if (marks.length > 0) {
      this.marks = marks;
    }

    // TODO: Can't we move some of this verification stuff to an upgrade script?
    this.nature = source.nature ?? Nature.HARDY;
    this.moveset = source.moveset?.map((m: any) => PokemonMove.loadMove(m)) ?? [];
    this.status = source.status
      ? new Status(
          source.status.effect,
          source.status.toxicTurnCount,
          source.status.sleepTurnsRemaining,
          source.status.freezeTurnsRemaining,
        )
      : null;
    this.friendship = source.friendship ?? speciesDataRegistry.getSpecies(this.species).baseFriendship;
    this.metLevel = source.metLevel || 5;
    this.metBiome = source.metBiome ?? -1;
    this.metSpecies = source.metSpecies;
    this.metWave = source.metWave ?? (this.metBiome === -1 ? -1 : 0);
    this.luck = source.luck ?? (source.shiny ? source.variant + 1 : 0);
    this.pauseEvolutions = !!source.pauseEvolutions;
    this.pokerus = !!source.pokerus;
    this.usedTMs = source.usedTMs ?? [];
    this.teraType = source.teraType as PokemonType;
    this.isTerastallized = !!source.isTerastallized;
    this.stellarTypesBoosted = source.stellarTypesBoosted ?? [];

    this.fusionSpecies = sourcePokemon?.fusionSpecies?.speciesId ?? source.fusionSpecies;
    this.fusionFormIndex = source.fusionFormIndex;
    this.fusionAbilityIndex = source.fusionAbilityIndex;
    this.fusionShiny = source.fusionShiny;
    this.fusionVariant = source.fusionVariant;
    this.fusionGender = source.fusionGender;
    this.fusionLuck = source.fusionLuck ?? (source.fusionShiny ? source.fusionVariant + 1 : 0);
    this.fusionTeraType = (source.fusionTeraType ?? 0) as PokemonType;

    this.boss = (source instanceof EnemyPokemon && !!source.bossSegments) || (!this.player && !!source.boss);
    this.bossSegments = source.bossSegments ?? 0;
    // Local fork (2026-11-10): see enemy-battle-forms.ts
    if (!this.player && typeof source.forkBattleFormBaseIndex === "number") {
      this.forkBattleFormBaseIndex = source.forkBattleFormBaseIndex;
    }
    // Local fork (2026-11-13): see endless-boss-bars.ts
    if (!this.player && typeof source.forkBossHpBars === "number" && source.forkBossHpBars >= 2) {
      this.forkBossHpBars = source.forkBossHpBars;
    }

    this.summonData = new PokemonSummonData(source.summonData);
    this.battleData = new PokemonBattleData(source.battleData);
    this.summonDataSpeciesFormIndex =
      sourcePokemon?.summonData.speciesForm?.formIndex ?? source.summonDataSpeciesFormIndex;

    this.customPokemonData = new CustomPokemonData(source.customPokemonData);
    this.fusionCustomPokemonData = new CustomPokemonData(source.fusionCustomPokemonData);
  }

  toPokemon(battleType?: BattleType, partyMemberIndex = 0, double = false): Pokemon {
    const species = speciesDataRegistry.getSpecies(this.species);
    const ret: Pokemon = this.player
      ? globalScene.addPlayerPokemon(
          species,
          this.level,
          this.abilityIndex,
          this.formIndex,
          this.gender,
          this.shiny,
          this.variant,
          this.ivs,
          this.nature,
          this,
          playerPokemon => {
            if (this.nickname) {
              playerPokemon.nickname = this.nickname;
            }
          },
        )
      : globalScene.addEnemyPokemon(
          species,
          this.level,
          battleType === BattleType.TRAINER
            ? !double || !(partyMemberIndex % 2)
              ? TrainerSlot.TRAINER
              : TrainerSlot.TRAINER_PARTNER
            : TrainerSlot.NONE,
          this.boss,
          false,
          this,
        );

    // when loading from saved session, recover summonData.speciesFrom and form index species object
    // used to stay transformed on reload session
    if (this.summonData.speciesForm) {
      ret.summonData.speciesForm = speciesDataRegistry.getPokemonSpeciesForm(
        this.summonData.speciesForm.speciesId,
        this.summonDataSpeciesFormIndex,
      );
    }
    return ret;
  }
}
