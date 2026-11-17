import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { activeOverrides } from "#app/overrides";
import {
  applyEndlessEnemyLevelFactor,
  getEndlessEnemyLevelFactor,
  getEndlessLevelBonus,
} from "#balance/endless-level-scaling";
import { signatureSpecies } from "#balance/signature-species";
import { EntryHazardTag } from "#data/arena-tag";
// Local fork (2026-11-12): the Endless trainers' extra fusion roll
import {
  type EndlessTrainerFusionStrongRule,
  getEndlessTrainerFusionMember,
  withEndlessTrainerFusionMember,
} from "#data/enemy-trainer-fusion";
import type { PokemonSpecies } from "#data/pokemon-species";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { PartyMemberStrength } from "#enums/party-member-strength";
import type { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { TeraAIMode } from "#enums/tera-ai-mode";
import { TrainerPoolTier } from "#enums/trainer-pool-tier";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import type { EnemyPokemon } from "#field/pokemon";
import type { PersistentModifier } from "#modifiers/modifier";
// Local fork (2026-11-08): Endless trainers' minimum party size and their strong extra
import {
  fillEndlessTrainerPartyTemplate,
  getEndlessFillExtraRange,
  getEndlessFillSeedGroup,
  getEndlessFillSlotFuncIndex,
  getStrongExtraSpecies,
  getStrongPoolSpecies,
  getTrainerStrongExtraPool,
  isEndlessEliteLegendBattle,
  isStrongEndlessExtra,
  isStrongExtraSpecies,
  STRONG_EXTRA_DIRECT_PICKS,
  STRONG_EXTRA_SOURCE_REROLLS,
} from "#trainers/endless-trainer-party";
import type { TrainerConfig } from "#trainers/trainer-config";
import { trainerConfigs } from "#trainers/trainer-config";
import { TrainerPartyCompoundTemplate, TrainerPartyTemplate } from "#trainers/trainer-party-template";
import { randSeedInt, randSeedItem } from "#utils/common";
import { getRandomLocaleEntry } from "#utils/i18n";
import { isTeraBlockedForm } from "#utils/pokemon-utils"; // Local fork (2026-11-10): enemy battle forms
import { toCamelCase } from "#utils/strings";
import i18next from "i18next";
import Phaser from "phaser";

export class Trainer extends Phaser.GameObjects.Container {
  public config: TrainerConfig;
  public variant: TrainerVariant;
  public partyTemplateIndex: number;
  public partnerName: string;
  public nameKey: string;
  public partnerNameKey: string | undefined;
  public originalIndexes: { [key: number]: number } = {};
  private representedSpecies: Partial<Record<SpeciesId, SpeciesId[]>> = {};
  /**
   * Local fork (2026-11-08): the wave of the standard Endless / Spliced Endless trainer battle this trainer fills its
   * party up for ({@linkcode getPartyTemplate}, endless-trainer-party.ts); `undefined` everywhere else. Set by `Battle`.
   */
  public forkEndlessFillWave: number | undefined;

  /**
   * Create a new Trainer.
   * @param trainerType - The {@linkcode TrainerType} for this trainer, used to determine
   * name, sprite, party contents and other details.
   * @param variant - The {@linkcode TrainerVariant} for this trainer (if any are available)
   * @param partyTemplateIndex - If provided, will override the trainer's party template with the given
   * version.
   * @param nameKey - If provided, will override the name key of the trainer
   * @param partnerNameKey - If provided, will override the
   * @param trainerConfigOverride - If provided, will override the trainer config for the given trainer type
   * @todo Review how many of these parameters we actually need
   */
  constructor(
    trainerType: TrainerType,
    variant: TrainerVariant,
    partyTemplateIndex?: number,
    nameKey?: string,
    partnerNameKey?: string,
    trainerConfigOverride?: TrainerConfig,
  ) {
    super(globalScene, -72, 80);
    this.config =
      trainerConfigOverride
      ?? (Object.hasOwn(trainerConfigs, trainerType)
        ? trainerConfigs[trainerType]
        : trainerConfigs[TrainerType.ACE_TRAINER]);

    this.variant = variant;
    this.partyTemplateIndex = Math.min(
      partyTemplateIndex === undefined ? randSeedItem(this.config.partyTemplates.map((_, i) => i)) : partyTemplateIndex,
      this.config.partyTemplates.length - 1,
    );
    // TODO: Rework this and add actual error handling for missing names
    const classKey = `trainersCommon:${toCamelCase(TrainerType[trainerType])}`;
    if (i18next.exists(classKey, { returnObjects: true })) {
      if (nameKey) {
        this.nameKey = nameKey;
        this.name = i18next.t(nameKey);
      } else {
        const genderKey = i18next.exists(`${classKey}.male`)
          ? variant === TrainerVariant.FEMALE
            ? ".female"
            : ".male"
          : "";
        [this.nameKey, this.name] = getRandomLocaleEntry(`${classKey}${genderKey}`);
      }

      if (variant === TrainerVariant.DOUBLE) {
        if (this.config.doubleOnly) {
          if (partnerNameKey) {
            this.partnerNameKey = partnerNameKey;
            this.partnerName = i18next.t(this.partnerNameKey);
          } else {
            [this.name, this.partnerName] = this.name.split(" & ");
          }
        } else {
          const partnerGenderKey = i18next.exists(`${classKey}.female`) ? ".female" : "";
          [this.partnerNameKey, this.partnerName] = getRandomLocaleEntry(`${classKey}${partnerGenderKey}`);
        }
      }
    }

    switch (this.variant) {
      case TrainerVariant.FEMALE:
        if (!this.config.hasGenders) {
          variant = TrainerVariant.DEFAULT;
        }
        break;
      case TrainerVariant.DOUBLE:
        if (!this.config.hasDouble) {
          variant = TrainerVariant.DEFAULT;
        }
        break;
    }

    const getSprite = (hasShadow?: boolean, forceFemale?: boolean): Phaser.GameObjects.Sprite =>
      globalScene
        .addFieldSprite(
          0,
          0,
          this.config.getSpriteKey(variant === TrainerVariant.FEMALE || forceFemale, this.isDouble()),
        )
        .setOrigin(0.5, 1)
        .setRenderNodeRole("Submitter", globalScene.spriteSubmitter, {
          tone: [0.0, 0.0, 0.0, 0.0],
          hasShadow: !!hasShadow,
        })
        .setRenderNodeRole("BatchHandler", globalScene.spriteBatchHandler);

    const sprite = getSprite(true);
    const tintSprite = getSprite();

    tintSprite.setVisible(false);

    this.add(sprite);
    this.add(tintSprite);

    if (variant === TrainerVariant.DOUBLE && !this.config.doubleOnly) {
      const partnerSprite = getSprite(true, true);
      const partnerTintSprite = getSprite(false, true);

      partnerTintSprite.setVisible(false);

      sprite.x = -4;
      tintSprite.x = -4;
      partnerSprite.x = 28;
      partnerTintSprite.x = 28;

      this.add(partnerSprite);
      this.add(partnerTintSprite);
    }
  }

  getKey(forceFemale?: boolean): string {
    return this.config.getSpriteKey(this.variant === TrainerVariant.FEMALE || forceFemale, this.isDouble());
  }

  /**
   * Returns the name of the trainer based on the provided trainer slot and the option to include a title.
   * @param trainerSlot - The slot to determine which name to use; default `TrainerSlot.NONE`
   * @param includeTitle - Whether to include the title in the returned name; default `false`
   * @returns - The formatted name of the trainer
   */
  getName(trainerSlot: TrainerSlot = TrainerSlot.NONE, includeTitle = false): string {
    // Get the base title based on the trainer slot and variant.
    let name = this.config.getTitle(trainerSlot, this.variant);

    // Determine the title to include based on the configuration and includeTitle flag.
    let title = includeTitle && this.config.title ? this.config.title : null;
    const evilTeamTitles = ["grunt"];
    if (this.name === "" && evilTeamTitles.some(t => name.toLocaleLowerCase().includes(t))) {
      // This is a evil team grunt so we localize it by only using the "name" as the title
      title = i18next.t(`trainerClasses:${toCamelCase(name)}`);
      console.log("Localized grunt name: " + title);
      // Since grunts are not named we can just return the title
      return title;
    }

    // If the trainer has a name (not null or undefined).
    if (this.name) {
      // If the title should be included.
      if (includeTitle) {
        // Get the localized trainer class name from the i18n file and set it as the title.
        // This is used for trainer class names, not titles like "Elite Four, Champion, etc."
        title = i18next.t(`trainerClasses:${toCamelCase(name)}`);
      }

      // If no specific trainer slot is set.
      if (trainerSlot) {
        // Assign the name based on the trainer slot:
        // Use 'this.name' if 'trainerSlot' is TRAINER.
        // Otherwise, use 'this.partnerName' if it exists, or 'this.name' if it doesn't.
        name = trainerSlot === TrainerSlot.TRAINER ? this.name : this.partnerName || this.name;
      } else {
        // Use the trainer's name.
        name = this.name;
        // If there is a partner name, concatenate it with the trainer's name using "&".
        if (this.partnerName) {
          name = `${name} & ${this.partnerName}`;
        }
      }
    }

    if (this.config.titleDouble && this.variant === TrainerVariant.DOUBLE && !this.config.doubleOnly) {
      title = this.config.titleDouble;
      name = i18next.t(`trainerNames:${toCamelCase(this.config.nameDouble)}`);
    }

    console.log(title ? `${title} ${name}` : name);

    // Return the formatted name, including the title if it is set.
    return title ? `${title} ${name}` : name;
  }

  isDouble(): boolean {
    return this.config.doubleOnly || this.variant === TrainerVariant.DOUBLE;
  }

  /**
   * Return whether the trainer is a duo, like Tate & Liza
   */
  isPartner(): boolean {
    return this.variant === TrainerVariant.DOUBLE;
  }

  getMixedBattleBgm(): string {
    return this.config.mixedBattleBgm;
  }

  getBattleBgm(): string {
    return this.config.battleBgm;
  }

  getEncounterBgm(): string {
    return this.variant
      ? (this.variant === TrainerVariant.DOUBLE ? this.config.doubleEncounterBgm : this.config.femaleEncounterBgm)
          || this.config.encounterBgm
      : this.config.encounterBgm;
  }

  getEncounterMessages(): string[] {
    return this.variant
      ? (this.variant === TrainerVariant.DOUBLE
          ? this.config.doubleEncounterMessages
          : this.config.femaleEncounterMessages) || this.config.encounterMessages
      : this.config.encounterMessages;
  }

  getVictoryMessages(): string[] {
    return this.variant
      ? (this.variant === TrainerVariant.DOUBLE ? this.config.doubleVictoryMessages : this.config.femaleVictoryMessages)
          || this.config.victoryMessages
      : this.config.victoryMessages;
  }

  getDefeatMessages(): string[] {
    return this.variant
      ? (this.variant === TrainerVariant.DOUBLE ? this.config.doubleDefeatMessages : this.config.femaleDefeatMessages)
          || this.config.defeatMessages
      : this.config.defeatMessages;
  }

  getPartyTemplate(): TrainerPartyTemplate {
    const template = this.getOwnPartyTemplate();
    // Local fork (2026-11-08): a standard Endless trainer battle fills the party up to its wave's minimum size
    return this.forkEndlessFillWave == null
      ? template
      : fillEndlessTrainerPartyTemplate(template, this.forkEndlessFillWave);
  }

  /** Local fork (2026-11-08), review fix: the trainer's own party template, before any Endless fill. */
  private getOwnPartyTemplate(): TrainerPartyTemplate {
    return this.config.partyTemplateFunc
      ? this.config.partyTemplateFunc()
      : this.config.partyTemplates[this.partyTemplateIndex];
  }

  /**
   * Local fork (2026-11-08), review fix: roll an Endless extra member with slot function `funcIndex`, re-rolling (up to
   * 10 times, in the same seeded sequence) while its evolution line is already in the party, as generic members do.
   */
  private genEndlessExtraFromSlotFunc(
    funcIndex: number,
    level: number,
    template: TrainerPartyTemplate,
    index: number,
  ): EnemyPokemon {
    const func = this.config.partyMemberFuncs[funcIndex];
    const strength = template.getStrength(index);
    const evoKind = template.getEvoThresholdKind(index);
    let pokemon = func(level, strength, evoKind);
    for (let attempt = 0; attempt < 10 && this.isEvolutionLineRepresented(pokemon.species.speciesId); attempt++) {
      pokemon.destroy();
      pokemon = func(level, strength, evoKind);
    }
    this.representedSpecies[pokemon.species.speciesId] = speciesDataRegistry.getPrevolutionChain(
      pokemon.species.speciesId,
    );
    return pokemon;
  }

  /** Local fork (2026-11-08), review fix: the duplicate check of {@linkcode genNewPartyMemberSpecies}. */
  private isEvolutionLineRepresented(speciesId: SpeciesId): boolean {
    for (
      let current: SpeciesId | null = speciesId;
      current !== null;
      current = speciesDataRegistry.getPrevolution(current)
    ) {
      if (current in this.representedSpecies) {
        return true;
      }
    }
    return Object.values(this.representedSpecies).some(line => line?.includes(speciesId));
  }

  /**
   * Local fork (2026-11-08): whether party member `index` is rolled the generic way or by an Endless extra's slot
   * function (`genPartyMember`), not by one of the trainer's own fixed slot functions.
   */
  private isEndlessRerollableSlot(index: number, template: TrainerPartyTemplate, ownSize: number): boolean {
    const funcs = this.config.partyMemberFuncs;
    return (
      this.usesPairSpeciesPools()
      || getEndlessFillSlotFuncIndex(funcs, ownSize, index) != null
      || !(Object.hasOwn(funcs, index) || Object.hasOwn(funcs, index - template.size))
    );
  }

  /** Local fork (2026-11-08): whether `genPartyMember` rolls from the signature pools of a named pair (Tate & Liza). */
  private usesPairSpeciesPools(): boolean {
    return !!this.config.trainerTypeDouble && this.isDouble() && !this.config.doubleOnly;
  }

  /**
   * Local fork (2026-11-08): the party index of the Endless extra that has to be strong ({@linkcode isStrongEndlessExtra})
   * when no extra before it is: the last extra (just before the ace's part of a compound template, the last slot after a
   * simple one) that is not taken by one of the trainer's own fixed slot functions, which keep their species.
   * @returns The index, `undefined` when the battle adds no extras
   */
  public getEndlessStrongExtraIndex(): number | undefined {
    if (this.forkEndlessFillWave == null) {
      return undefined;
    }
    const template = this.getPartyTemplate();
    const ownTemplate = this.getOwnPartyTemplate();
    const { start, count } = getEndlessFillExtraRange(ownTemplate, template);
    for (let index = start + count - 1; index >= start; index--) {
      if (this.isEndlessRerollableSlot(index, template, ownTemplate.size)) {
        return index;
      }
    }
    return undefined;
  }

  /**
   * Local fork (2026-11-09): the party index that is re-picked under the elite trainers' "legendaries allowed" rule
   * ({@linkcode isEndlessEliteLegendBattle}) when no member of the party is strong, legend group included: the last
   * member not taken by one of the trainer's own fixed slot functions (for the Ace Trainers' templates, the last member;
   * one Trainer rolls a pair's shared party, so an Ace Duo has one such index too).
   * @returns The index, `undefined` when the rule does not apply to this battle
   */
  public getEndlessEliteStrongIndex(): number | undefined {
    if (!isEndlessEliteLegendBattle(this.config.trainerType, this.forkEndlessFillWave)) {
      return undefined;
    }
    const template = this.getPartyTemplate();
    const ownSize = this.getOwnPartyTemplate().size;
    // Local fork (2026-11-09), review fix: the party has one member per level of the battle. `Battle` sized it with
    // `getPartyLevels` while the battle before it was current, and `getWavePartyTemplate` reads that battle's wave (none at
    // the first battle of a run started past wave 1), so the template read now can be larger than the party; the index
    // of a member that is never rolled left the party without its strong member. Without the battle, as
    // `getPartyLevels` sizes the party
    const battle = globalScene.currentBattle;
    const size =
      battle?.trainer === this && battle.enemyLevels
        ? battle.enemyLevels.length
        : Math.max(template.size, this.isDouble() ? 2 : 1);
    for (let index = size - 1; index >= 0; index--) {
      if (this.isEndlessRerollableSlot(index, template, ownSize)) {
        return index;
      }
    }
    return undefined;
  }

  /**
   * Local fork (2026-11-08): the types of the members rolled before `index` for `trainerSlot` (all of them when that
   * trainer has none yet), read from the species form each was generated as.
   * @returns Every such type, and the ones the most members have
   */
  private getEndlessMemberTypes(index: number, trainerSlot: TrainerSlot): { all: PokemonType[]; top: PokemonType[] } {
    const earlier = globalScene.currentBattle.enemyParty.slice(0, index).filter(p => p != null);
    const sameTrainer = earlier.filter(p => p.trainerSlot === trainerSlot);
    const counts = new Map<PokemonType, number>();
    for (const pokemon of sameTrainer.length > 0 ? sameTrainer : earlier) {
      const form = pokemon.getSpeciesForm(true);
      for (const type of form.type2 == null || form.type2 === form.type1 ? [form.type1] : [form.type1, form.type2]) {
        counts.set(type, (counts.get(type) ?? 0) + 1);
      }
    }
    const most = Math.max(0, ...counts.values());
    return { all: [...counts.keys()], top: [...counts.keys()].filter(t => counts.get(t) === most) };
  }

  /**
   * Local fork (2026-11-08), review fix: the lines the members after party index `index` (the trainer's ace part) roll
   * when the extra there keeps out of their way. They are rolled ahead, each in its own seeded sequence (nothing is drawn
   * from the extra's), with `first` standing in at `index`, and dropped again; the party and the represented lines are
   * put back as they were.
   * Local fork (2026-11-09): also their types and whether one is strong with the legend group allowed, for the elite
   * trainers' rule (nothing new is drawn for those).
   * @param first - The extra as rolled
   * @param represented - The represented lines from before `first` was rolled
   * @param index - The extra's party index
   * @returns The lines, keyed like the represented lines; the types; whether one of them is strong (legends allowed)
   */
  private getEndlessLaterMembers(
    first: EnemyPokemon,
    represented: Partial<Record<SpeciesId, SpeciesId[]>>,
    index: number,
  ): { lines: Partial<Record<SpeciesId, SpeciesId[]>>; types: PokemonType[]; anyStrong: boolean } {
    const battle = globalScene.currentBattle;
    const party = battle.enemyParty;
    const partyBefore = party.slice();
    const representedBefore = this.representedSpecies;
    const lines: Partial<Record<SpeciesId, SpeciesId[]>> = {};
    const types: PokemonType[] = [];
    let anyStrong = false;
    const rolled: EnemyPokemon[] = [];
    this.representedSpecies = { ...represented };
    party[index] = first;
    try {
      for (let later = index + 1; later < (battle.enemyLevels?.length ?? 0); later++) {
        const pokemon = this.genPartyMember(later);
        rolled.push(pokemon);
        party[later] = pokemon;
        lines[pokemon.species.speciesId] = speciesDataRegistry.getPrevolutionChain(pokemon.species.speciesId);
        types.push(...pokemon.getTypes());
        anyStrong ||= isStrongEndlessExtra(pokemon, true);
      }
    } finally {
      party.splice(0, party.length, ...partyBefore);
      for (const pokemon of rolled) {
        pokemon.destroy();
      }
      this.representedSpecies = representedBefore;
    }
    return { lines, types, anyStrong };
  }

  /**
   * Local fork (2026-11-08): the user wants at least one strong member among the Endless extras while the trainer keeps
   * its character. Turn `first`, the strong-extra slot as rolled, into a strong extra when it is not one, drawing in the
   * same seeded sequence:
   * 1. its own source again, up to {@linkcode STRONG_EXTRA_SOURCE_REROLLS} times: a generic slot rolls its species from
   *    the same pool or filter (skipped when that pool holds no strong species), a slot function or a named pair's
   *    pools roll the whole Pokémon (`reroll`);
   * 2. a direct pick from the trainer's own pool ({@linkcode getTrainerStrongExtraPool}, generic slots only), species
   *    of the trainer's first type list below first, then any species of that pool;
   * 3. strong species sharing a type with the trainer: its specialty type first, then (or without one) the type(s) most
   *    of its other members so far have, then any of their types;
   * 4. any strong species.
   * A trainer with a specialty type keeps to that type inside its own pool while the pool has a strong species of it,
   * and outside it until its specialty list runs out. Each pick goes through the generic path's evolution rules and the
   * duplicate line check, also against the lines the members after this slot (the trainer's ace) roll, and a Pokémon
   * whose generated form misses the bar is dropped. If nothing qualifies, `first` stays.
   * Local fork (2026-11-09): with `legends` (the elite trainers' "legendaries allowed" rule) `first` is the party's last
   * free member, the legend group counts as strong, a strong member after the slot (a fixed slot of the trainer) is
   * enough, and the tries are {@linkcode getEndlessEliteRolls} instead.
   * @param first - The extra as rolled
   * @param reroll - Rolls the extra again from its own source
   * @param represented - The represented lines from before `first` was rolled
   * @param level - The extra's level
   * @param index - The extra's party index
   * @param ownSize - The size of the trainer's own template
   * @param legends - Whether the elite trainers' rule applies instead of the strong-extra rule
   * @returns The extra to use
   */
  private rollStrongEndlessExtra(
    first: EnemyPokemon,
    reroll: () => EnemyPokemon,
    represented: Partial<Record<SpeciesId, SpeciesId[]>>,
    level: number,
    index: number,
    ownSize: number,
    legends = false,
  ): EnemyPokemon {
    if (isStrongEndlessExtra(first, legends)) {
      return first;
    }
    // Local fork (2026-11-08), review fix: the members after this slot are the trainer's own (its ace), so the pick keeps
    // out of the lines they roll; it used to take the ace's species and push the ace onto a re-roll (a Beauty's Milotic
    // ace became a Purugly, an Officer's Arcanine a Jolteon)
    const later = this.getEndlessLaterMembers(first, represented, index);
    // Local fork (2026-11-09): the elite rule's guarantee covers the whole party, so a strong member after the slot will do
    if (legends && later.anyStrong) {
      return first;
    }
    const blocked = { ...represented, ...later.lines };
    const specialty = !legends && this.config.hasSpecialtyType() ? this.config.specialtyType : undefined;
    const rolls = legends
      ? this.getEndlessEliteRolls(first, blocked, level, index, later.types)
      : this.getStrongEndlessExtraRolls(first, reroll, blocked, level, index, ownSize, specialty);
    for (const [roll, anyType] of rolls) {
      this.representedSpecies = { ...blocked };
      const pokemon = roll();
      if (!pokemon) {
        continue;
      }
      // Local fork (2026-11-08), review fix: a re-roll from the source gives up on the duplicate check after its own
      // retries; the strong extra never repeats a line
      this.representedSpecies = { ...blocked };
      if (
        isStrongEndlessExtra(pokemon, legends)
        && (anyType || specialty == null || pokemon.getSpeciesForm(true).isOfType(specialty))
        && !this.isEvolutionLineRepresented(pokemon.species.speciesId)
      ) {
        first.destroy();
        this.representedSpecies = {
          ...represented,
          [pokemon.species.speciesId]: speciesDataRegistry.getPrevolutionChain(pokemon.species.speciesId),
        };
        return pokemon;
      }
      pokemon.destroy();
    }

    this.representedSpecies = {
      ...represented,
      [first.species.speciesId]: speciesDataRegistry.getPrevolutionChain(first.species.speciesId),
    };
    return first;
  }

  /**
   * Local fork (2026-11-08): the tries of {@linkcode rollStrongEndlessExtra} in order, each a roll and whether it may be
   * of any type. Lazy, so each try draws its candidate right before its roll and nothing after the one that is kept.
   * A roll that knows its species first builds the Pokémon only when the species can qualify, else gives `undefined`.
   */
  private *getStrongEndlessExtraRolls(
    first: EnemyPokemon,
    reroll: () => EnemyPokemon,
    represented: Partial<Record<SpeciesId, SpeciesId[]>>,
    level: number,
    index: number,
    ownSize: number,
    specialty: PokemonType | undefined,
  ): Generator<[() => EnemyPokemon | undefined, boolean]> {
    // The trainer's types: its specialty type, then (or else) its members' most common types, then any of their types
    const memberTypes = this.getEndlessMemberTypes(index, first.trainerSlot);
    const typeSets = [...(specialty == null ? [] : [[specialty]]), memberTypes.top, memberTypes.all];
    const sharing = (types: PokemonType[]) => (speciesId: SpeciesId) =>
      types.some(t => speciesDataRegistry.getSpecies(speciesId).isOfType(t));
    const sharesType = sharing(typeSets[0]);
    const template = this.getPartyTemplate();
    const strength = template.getStrength(index);
    // The generic path's evolution rules (genPartyMember), then the Pokémon if the species can be the strong extra
    const build = (rolled: PokemonSpecies, anyType: boolean): EnemyPokemon | undefined => {
      const species = speciesDataRegistry.getSpecies(
        rolled.getSpeciesForLevel(level, true, true, strength, template.evoLevelThresholdKind),
      );
      return isStrongExtraSpecies(species) && (anyType || specialty == null || species.isOfType(specialty))
        ? globalScene.addEnemyPokemon(species, level, first.trainerSlot)
        : undefined;
    };

    // 1. The slot's own source: a generic slot rolls its species again (its pool is known), slot functions and the pools
    // of named pairs roll the whole Pokémon
    const genericSlot =
      !this.usesPairSpeciesPools() && getEndlessFillSlotFuncIndex(this.config.partyMemberFuncs, ownSize, index) == null;
    // Local fork (2026-11-08), review fix: the trainer's own pool comes before any type, as the rule was given; inside it a
    // specialist keeps to its type while the pool has a strong species of it (a Baker whose Volcarona is already out
    // gets its own Snorlax, Blissey, Ursaluna or Hydrapple, no longer an outside Fire type)
    const ownPool = genericSlot ? getTrainerStrongExtraPool(this.config) : undefined;
    const ownAnyType = specialty != null && ownPool != null && !ownPool.some(sharesType);
    if (ownPool == null || ownPool.length > 0) {
      const sourceRoll = genericSlot ? () => build(this.genNewPartyMemberSpecies(level, strength), ownAnyType) : reroll;
      for (let attempt = 0; attempt < STRONG_EXTRA_SOURCE_REROLLS; attempt++) {
        yield [sourceRoll, ownAnyType];
      }
    }

    // 2. to 4. Direct picks, each species tried once; the own pool and, past the specialty type, any type may do
    const strong = getStrongExtraSpecies();
    const picks: [readonly SpeciesId[], boolean][] = [
      [ownPool?.filter(sharesType) ?? [], false],
      [ownPool ?? [], true],
      ...typeSets.map((types, i): [SpeciesId[], boolean] => [strong.filter(sharing(types)), i > 0]),
      [strong, true],
    ];
    const tried = new Set<SpeciesId>();
    for (const [pool, anyType] of picks) {
      this.representedSpecies = { ...represented };
      let candidates = pool.filter(s => !tried.has(s) && !this.isEvolutionLineRepresented(s));
      for (let pick = 0; pick < STRONG_EXTRA_DIRECT_PICKS && candidates.length > 0; pick++) {
        const speciesId = randSeedItem(candidates);
        tried.add(speciesId);
        candidates = candidates.filter(s => s !== speciesId);
        yield [() => build(speciesDataRegistry.getSpecies(speciesId), anyType), anyType];
      }
    }
  }

  /**
   * Local fork (2026-11-09): the tries of {@linkcode rollStrongEndlessExtra} under the elite trainers' "legendaries
   * allowed" rule, in order, drawn lazily in the slot's own seeded sequence; each species is tried once, up to
   * {@linkcode STRONG_EXTRA_DIRECT_PICKS} from each list:
   * 1. the strong species of the arena's current pools, boss tiers included ({@linkcode getStrongPoolSpecies}), so the
   *    pick fits the place (a volcano: Arcanine, Hisuian Arcanine, Magmortar, Volcarona, Moltres, Heatran, Volcanion,
   *    Chi-Yu, Reshiram);
   * 2. any strong species, legend group included ({@linkcode getStrongExtraSpecies}), of no type another member has (the
   *    elite templates are balanced);
   * 3. any strong species, legend group included.
   * Each species goes through the generic path's evolution rules and is built only when that form's species is strong;
   * lines in the party or rolled by the members after the slot are skipped.
   * @param first - The member as rolled
   * @param represented - The lines to keep out of (the party's and the later members')
   * @param level - The member's level
   * @param index - The member's party index
   * @param laterTypes - The types of the members after the slot
   */
  private *getEndlessEliteRolls(
    first: EnemyPokemon,
    represented: Partial<Record<SpeciesId, SpeciesId[]>>,
    level: number,
    index: number,
    laterTypes: readonly PokemonType[],
  ): Generator<[() => EnemyPokemon | undefined, boolean]> {
    const template = this.getPartyTemplate();
    const strength = template.getStrength(index);
    const build = (speciesId: SpeciesId): EnemyPokemon | undefined => {
      const species = speciesDataRegistry.getSpecies(
        speciesDataRegistry
          .getSpecies(speciesId)
          .getSpeciesForLevel(level, true, true, strength, template.evoLevelThresholdKind),
      );
      return isStrongExtraSpecies(species, true)
        ? globalScene.addEnemyPokemon(species, level, first.trainerSlot)
        : undefined;
    };
    // The other members' types as the balanced template compares them (`genNewPartyMemberSpecies`)
    const otherTypes = new Set<PokemonType>([
      ...globalScene.currentBattle.enemyParty
        .slice(0, index)
        .filter(p => p != null)
        .flatMap(p => p.getTypes()),
      ...laterTypes,
    ]);
    const clashes = (speciesId: SpeciesId) => {
      const species = speciesDataRegistry.getSpecies(speciesId);
      return otherTypes.has(species.type1) || (species.type2 != null && otherTypes.has(species.type2));
    };
    const strong = getStrongExtraSpecies(true);
    const picks: (() => readonly SpeciesId[])[] = [
      () => getStrongPoolSpecies(globalScene.arena.getForkPokemonPools()),
      () => strong.filter(s => !clashes(s)),
      () => strong,
    ];
    const tried = new Set<SpeciesId>();
    for (const pool of picks) {
      this.representedSpecies = { ...represented };
      let candidates = pool().filter(s => !tried.has(s) && !this.isEvolutionLineRepresented(s));
      for (let pick = 0; pick < STRONG_EXTRA_DIRECT_PICKS && candidates.length > 0; pick++) {
        const speciesId = randSeedItem(candidates);
        tried.add(speciesId);
        candidates = candidates.filter(s => s !== speciesId);
        yield [() => build(speciesId), true];
      }
    }
  }

  public getPartyLevels(waveIndex: number): number[] {
    const ret: number[] = [];
    let partyTemplate = this.getPartyTemplate();

    const difficultyWaveIndex = globalScene.gameMode.getWaveForDifficulty(waveIndex);
    const baseLevel = 1 + difficultyWaveIndex / 2 + Math.pow(difficultyWaveIndex / 25, 2);
    // Local fork (2026-11-13): 08 명세 4번, past Endless wave 500 the Candy Jar term S(w) is added to every member's
    // final level, after the slot multiplier (endless-level-scaling.ts); 0 in every other case
    const endlessLevelBonus = getEndlessLevelBonus(globalScene.gameMode, difficultyWaveIndex);
    // Local fork (2026-11-13): from Endless battle wave 4000 every member's final level is multiplied by the same
    // f = max(1, P / C) ^ 0.5 (09 명세 1번 square-root damping), P the player's highest party level, C the wave's EXP
    // level cap (endless-level-scaling.ts; the user: "적의 에이스 포켓몬이 플레이어의 가장 높은 레벨의 포켓몬의 레벨에
    // 비례하도록"), so the ace (~1.007-1.009 x C) ends up at ~1.007-1.009 x C x f; exactly 1 (no change) in every other case
    const playerFollowFactor = getEndlessEnemyLevelFactor(globalScene.gameMode, waveIndex);

    if (this.isDouble() && partyTemplate.size < 2) {
      partyTemplate = new TrainerPartyTemplate(2, partyTemplate.strength);
    }

    for (let i = 0; i < partyTemplate.size; i++) {
      let multiplier = 1;

      const strength = partyTemplate.getStrength(i);

      switch (strength) {
        case PartyMemberStrength.WEAKEST:
          multiplier = 0.95;
          break;
        case PartyMemberStrength.WEAKER:
          multiplier = 1;
          break;
        case PartyMemberStrength.WEAK:
          multiplier = 1.05;
          break;
        case PartyMemberStrength.AVERAGE:
          multiplier = 1.12;
          break;
        case PartyMemberStrength.STRONG:
          multiplier = 1.22;
          break;
        case PartyMemberStrength.STRONGER:
          multiplier = 1.24;
          break;
        case PartyMemberStrength.STRONGEST:
          multiplier = 1.25;
          break;
      }

      let levelOffset = 0;

      if (strength < PartyMemberStrength.STRONG) {
        multiplier = Math.min(multiplier + 0.025 * Math.floor(difficultyWaveIndex / 25), 1.225);
        levelOffset = -Math.floor((difficultyWaveIndex / 50) * (PartyMemberStrength.STRONG - strength));
      }

      // Local fork (2026-11-13): + S(w), then x f
      const level = applyEndlessEnemyLevelFactor(
        Math.ceil(baseLevel * multiplier) + levelOffset + endlessLevelBonus,
        playerFollowFactor,
      );
      ret.push(level);
    }

    return ret;
  }

  public genPartyMember(index: number): EnemyPokemon {
    const battle = globalScene.currentBattle;
    const level = battle.enemyLevels?.[index]!; // TODO: is this bang correct?

    let ret!: EnemyPokemon;
    // Local fork (2026-11-08), review fix: the size of the trainer's own template when the Endless fill added members,
    // else 0 (no member counts as an extra then)
    const ownTemplate = this.forkEndlessFillWave == null ? undefined : this.getOwnPartyTemplate();
    const ownSize = ownTemplate && this.getPartyTemplate().size > ownTemplate.size ? ownTemplate.size : 0;
    // Local fork (2026-11-09): under the elite trainers' "legendaries allowed" rule (from Endless wave 300) the party's last
    // free member is re-picked (rollStrongEndlessExtra with legends) when no member before it is strong, legend group
    // included, and its own roll is not; the rule takes the place of the strong-extra rule for those battles
    const eliteLegends = isEndlessEliteLegendBattle(this.config.trainerType, this.forkEndlessFillWave);
    const eliteSlot =
      eliteLegends
      && !activeOverrides.ENEMY_SPECIES_OVERRIDE
      && index === this.getEndlessEliteStrongIndex()
      && !battle.enemyParty.slice(0, index).some(p => p != null && isStrongEndlessExtra(p, true));
    // Local fork (2026-11-08): the strong-extra slot is re-rolled (rollStrongEndlessExtra) when no extra before it is
    // strong and its own roll is not; every other member, and every party that needs no re-roll, draws as before
    const strongExtraSlot =
      !eliteLegends
      && ownTemplate != null
      && ownSize > 0
      && !activeOverrides.ENEMY_SPECIES_OVERRIDE
      && index === this.getEndlessStrongExtraIndex()
      && !battle.enemyParty
        .slice(getEndlessFillExtraRange(ownTemplate, this.getPartyTemplate()).start, index)
        .some(p => p != null && isStrongEndlessExtra(p));
    const genMon = () => {
      const template = this.getPartyTemplate();
      const strength: PartyMemberStrength = template.getStrength(index);

      if (!(this.config.trainerTypeDouble && this.isDouble() && !this.config.doubleOnly)) {
        // Local fork (2026-11-08), review fix: an Endless extra of a trainer whose own slots all come from slot functions
        // (Twins, Young Couple, Mysterious Sisters) reuses those functions instead of rolling from the whole dex
        const extraFuncIndex = getEndlessFillSlotFuncIndex(this.config.partyMemberFuncs, ownSize, index);
        if (extraFuncIndex != null) {
          ret = this.genEndlessExtraFromSlotFunc(extraFuncIndex, level, template, index);
          return;
        }
        if (Object.hasOwn(this.config.partyMemberFuncs, index)) {
          ret = this.config.partyMemberFuncs[index](level, strength, template.getEvoThresholdKind(index));
          this.representedSpecies[ret.species.speciesId] = speciesDataRegistry.getPrevolutionChain(
            ret.species.speciesId,
          );
          return;
        }
        if (Object.hasOwn(this.config.partyMemberFuncs, index - template.size)) {
          ret = this.config.partyMemberFuncs[index - template.size](
            level,
            template.getStrength(index),
            template.getEvoThresholdKind(index),
          );
          this.representedSpecies[ret.species.speciesId] = speciesDataRegistry.getPrevolutionChain(
            ret.species.speciesId,
          );
          return;
        }
      }
      let offset = 0;

      if (template instanceof TrainerPartyCompoundTemplate) {
        for (const innerTemplate of template.templates) {
          if (offset + innerTemplate.size > index) {
            break;
          }
          offset += innerTemplate.size;
        }
      }

      let newSpeciesPool: SpeciesId[] = [];
      let useNewSpeciesPool = false;

      // If we are in a double battle of named trainers,
      // we need to use alternate species pools (generate half the party from each trainer)
      if (this.config.trainerTypeDouble && this.isDouble() && !this.config.doubleOnly) {
        useNewSpeciesPool = true;

        const speciesPoolPartner = signatureSpecies[TrainerType[this.config.trainerTypeDouble]];
        const speciesPool = signatureSpecies[TrainerType[this.config.trainerType]];

        // Get the species that are already in the enemy party so we dont generate the same species twice
        const alreadyUsedSpecies = battle.enemyParty.map(p => p.species.speciesId);

        // Filter out the species that are already in the enemy party from the main trainer species pool
        const speciesPoolFiltered = speciesPool
          .filter(sp => {
            // Since some species pools have arrays in them (use either of those species),
            // we need to check if one of the species is already in the party and filter the whole array if it is
            if (Array.isArray(sp)) {
              return !sp.some(s => alreadyUsedSpecies.includes(s));
            }
            return !alreadyUsedSpecies.includes(sp);
          })
          .flat();

        // Filter out the species that are already in the enemy party from the partner trainer species pool
        const speciesPoolPartnerFiltered = speciesPoolPartner
          .filter(sp => {
            // Since some species pools have arrays in them (use either of those species),
            // we need to check if one of the species is already in the party and filter the whole array if it is
            if (Array.isArray(sp)) {
              return !sp.some(s => alreadyUsedSpecies.includes(s));
            }
            return !alreadyUsedSpecies.includes(sp);
          })
          .flat();

        // If the index is even, use the species pool for the main trainer (that way he only uses his own pokemon in battle)
        if (!(index % 2)) {
          // Since the only currently allowed double battle with named trainers is Tate & Liza,
          // we need to make sure that Solrock is the first pokemon in the party for Tate and Lunatone for Liza
          if (index === 0 && TrainerType[this.config.trainerType] === TrainerType[TrainerType.TATE]) {
            newSpeciesPool = [SpeciesId.SOLROCK];
          } else if (index === 0 && TrainerType[this.config.trainerType] === TrainerType[TrainerType.LIZA]) {
            newSpeciesPool = [SpeciesId.LUNATONE];
          } else {
            newSpeciesPool = speciesPoolFiltered;
          }
          // If the index is odd, use the species pool for the partner trainer (that way he only uses his own pokemon in battle)
          // Since the only currently allowed double battle with named trainers is Tate & Liza,
          // we need to make sure that Solrock is the first pokemon in the party for Tate and Lunatone for Liza
        } else if (index === 1 && TrainerType[this.config.trainerTypeDouble] === TrainerType[TrainerType.TATE]) {
          newSpeciesPool = [SpeciesId.SOLROCK];
        } else if (index === 1 && TrainerType[this.config.trainerTypeDouble] === TrainerType[TrainerType.LIZA]) {
          newSpeciesPool = [SpeciesId.LUNATONE];
        } else {
          newSpeciesPool = speciesPoolPartnerFiltered;
        }
        if (newSpeciesPool.length === 0) {
          useNewSpeciesPool = false;
        }
      }

      let species = this.genNewPartyMemberSpecies(level, strength);
      if (useNewSpeciesPool) {
        species = speciesDataRegistry.getSpecies(randSeedItem(newSpeciesPool));
      } else if (template.isSameSpecies(index) && index > offset) {
        species = speciesDataRegistry.getSpecies(
          battle.enemyParty[offset].species.getTrainerSpeciesForLevel(
            level,
            false,
            template.getStrength(offset),
            template.evoLevelThresholdKind,
          ),
        );
      }

      if (newSpeciesPool) {
        species = speciesDataRegistry.getSpecies(
          species.getSpeciesForLevel(level, true, true, strength, template.evoLevelThresholdKind),
        );
      }

      ret = globalScene.addEnemyPokemon(
        species,
        level,
        !this.isDouble() || !(index % 2) ? TrainerSlot.TRAINER : TrainerSlot.TRAINER_PARTNER,
      );
      this.representedSpecies[species.speciesId] = speciesDataRegistry.getPrevolutionChain(species.speciesId);
    };
    const seedOffset = this.config.hasStaticParty
      ? this.config.getDerivedType() + ((index + 1) << 8)
      : globalScene.currentBattle.waveIndex
        + (this.config.getDerivedType() << 10)
        // Local fork (2026-11-08), review fix: Endless extras of a shared-seed trainer get their own group (0 otherwise)
        + (((this.config.useSameSeedForAllMembers ? getEndlessFillSeedGroup(ownSize, index) : index) + 1) << 8);

    // Local fork (2026-11-12): the extra fusion roll of an Endless trainer's Pokémon happens in its constructor, which has
    // no trainer slot yet, so the member is described while it is built (enemy-trainer-fusion.ts; the user, approving
    // the plan: "합체 포켓몬도 추천안대로 넣어두고"); nothing is drawn here
    const fusionMember = getEndlessTrainerFusionMember(this, this.getEndlessFusionSlot(index, ownSize, eliteLegends));

    withEndlessTrainerFusionMember(fusionMember, () =>
      globalScene.executeWithSeedOffset(() => {
        // Local fork (2026-11-08): the strong extra continues the slot's own seeded sequence after its normal roll
        // Local fork (2026-11-09): so does the elite trainers' strong member
        const represented = strongExtraSlot || eliteSlot ? { ...this.representedSpecies } : undefined;
        genMon();
        if (represented) {
          const reroll = () => {
            genMon();
            return ret;
          };
          ret = this.rollStrongEndlessExtra(ret, reroll, represented, level, index, ownSize, eliteSlot);
        }
      }, seedOffset),
    );

    return ret;
  }

  /**
   * Local fork (2026-11-12): what the Endless trainers' fusion roll (enemy-trainer-fusion.ts) needs to know about party
   * member `index`: whether it comes from one of the trainer's own config slots (a slot function `genPartyMember` uses
   * for it, not an Endless extra reusing one) or a named pair's signature pools, which never fuse from the roll; and the
   * strong-member rule that covers it: `elite` for a free member under the elite trainers' "legendaries allowed" rule,
   * `extra` for an Endless extra (the members the fill added) under the strong-extra rule.
   * @param index - The party index
   * @param ownSize - The size of the trainer's own template when the Endless fill added members, else 0
   * @param eliteLegends - Whether the elite trainers' rule applies to this battle
   */
  private getEndlessFusionSlot(
    index: number,
    ownSize: number,
    eliteLegends: boolean,
  ): { fixedSlot: boolean; strongRule: EndlessTrainerFusionStrongRule | undefined } {
    const template = this.getPartyTemplate();
    const fixedSlot = this.usesPairSpeciesPools() || !this.isEndlessRerollableSlot(index, template, ownSize);
    let strongRule: EndlessTrainerFusionStrongRule | undefined;
    if (eliteLegends) {
      strongRule = "elite";
    } else if (ownSize > 0) {
      const { start, count } = getEndlessFillExtraRange(this.getOwnPartyTemplate(), template);
      strongRule = index >= start && index < start + count ? "extra" : undefined;
    }
    return { fixedSlot, strongRule };
  }

  genNewPartyMemberSpecies(level: number, strength: PartyMemberStrength, attempt?: number): PokemonSpecies {
    const battle = globalScene.currentBattle;
    const template = this.getPartyTemplate();
    let baseSpecies: PokemonSpecies;
    if (this.config.speciesPools) {
      const tierValue = randSeedInt(512);
      let tier: TrainerPoolTier;
      if (tierValue >= 156) {
        tier = TrainerPoolTier.COMMON;
      } else if (tierValue >= 32) {
        tier = TrainerPoolTier.UNCOMMON;
      } else if (tierValue >= 6) {
        tier = TrainerPoolTier.RARE;
      } else if (tierValue >= 1) {
        tier = TrainerPoolTier.SUPER_RARE;
      } else {
        tier = TrainerPoolTier.ULTRA_RARE;
      }
      console.log(TrainerPoolTier[tier]);
      while (!Object.hasOwn(this.config.speciesPools, tier) || this.config.speciesPools[tier].length === 0) {
        console.log(
          `Downgraded trainer Pokemon rarity tier from ${TrainerPoolTier[tier]} to ${TrainerPoolTier[tier - 1]}`,
        );
        tier--;
      }
      const tierPool = this.config.speciesPools[tier];
      let rolledSpecies = randSeedItem(tierPool);
      while (typeof rolledSpecies !== "number") {
        rolledSpecies = randSeedItem(tierPool);
      }
      baseSpecies = speciesDataRegistry.getSpecies(rolledSpecies);
    } else {
      baseSpecies = globalScene.randomSpecies(battle.waveIndex, level, false, this.config.speciesFilter);
    }

    let ret = speciesDataRegistry.getSpecies(
      baseSpecies.getTrainerSpeciesForLevel(level, true, strength, template.evoLevelThresholdKind),
    );
    let retry = false;

    console.log(ret.getName());

    // Retry if an evolved mon was rolled but it wouldn't be evolved at this point
    if (speciesDataRegistry.getPrevolutionChain(baseSpecies.speciesId).includes(ret.speciesId)) {
      retry = true;
    } else if (template.isBalanced(battle.enemyParty.length)) {
      const partyMemberTypes = battle.enemyParty.flatMap(p => p.getTypes());
      if (
        partyMemberTypes.indexOf(ret.type1) > -1
        || (ret.type2 !== null && partyMemberTypes.indexOf(ret.type2) > -1)
      ) {
        retry = true;
      }
    }

    // Retry if a mon or its prevolution(s) is already in the party
    if (!retry) {
      let currentSpeciesId: SpeciesId | null = ret.speciesId;
      while (currentSpeciesId !== null) {
        if (currentSpeciesId in this.representedSpecies) {
          retry = true;
          break;
        }
        currentSpeciesId = speciesDataRegistry.getPrevolution(currentSpeciesId);
      }
    }

    // Retry if the evolution of the mon is already in the party
    if (!retry) {
      const preEvolutionLines = Object.values(this.representedSpecies);
      for (const line of preEvolutionLines) {
        if (line.includes(ret.speciesId)) {
          retry = true;
          break;
        }
      }
    }

    if (retry && (attempt ?? 0) < 25) {
      console.log("Rerolling party member...");
      ret = this.genNewPartyMemberSpecies(level, strength, (attempt ?? 0) + 1);
    }

    return ret;
  }

  getPartyMemberMatchupScores(trainerSlot: TrainerSlot = TrainerSlot.NONE, forSwitch = false): [number, number][] {
    if (trainerSlot && !this.isDouble()) {
      trainerSlot = TrainerSlot.NONE;
    }

    const party = globalScene.getEnemyParty();
    const nonFaintedLegalPartyMembers = party
      .slice(globalScene.currentBattle.getBattlerCount())
      .filter(p => p.isAllowedInBattle())
      .filter(p => !trainerSlot || p.trainerSlot === trainerSlot);
    const partyMemberScores = nonFaintedLegalPartyMembers.map(p => {
      const playerField = globalScene.getPlayerField().filter(p => p.isAllowedInBattle());
      let score = 0;

      if (playerField.length > 0) {
        for (const playerPokemon of playerField) {
          score += p.getMatchupScore(playerPokemon);
          if (playerPokemon.species.legendary) {
            score /= 2;
          }
        }
        score /= playerField.length;
        if (forSwitch && !p.isOnField()) {
          globalScene.arena
            .findTagsOnSide(t => t instanceof EntryHazardTag, ArenaTagSide.ENEMY)
            .map(t => (score *= (t as EntryHazardTag).getMatchupScoreMultiplier(p)));
        }
      }

      return [party.indexOf(p), score];
    }) as [number, number][];

    return partyMemberScores;
  }

  getSortedPartyMemberMatchupScores(partyMemberScores: [number, number][] = this.getPartyMemberMatchupScores()) {
    const sortedPartyMemberScores = partyMemberScores.slice(0);
    sortedPartyMemberScores.sort((a, b) => {
      const scoreA = a[1];
      const scoreB = b[1];
      return scoreA < scoreB ? 1 : scoreA > scoreB ? -1 : 0;
    });

    return sortedPartyMemberScores;
  }

  getNextSummonIndex(
    trainerSlot: TrainerSlot = TrainerSlot.NONE,
    partyMemberScores: [number, number][] = this.getPartyMemberMatchupScores(trainerSlot),
  ): number {
    if (trainerSlot && !this.isDouble()) {
      trainerSlot = TrainerSlot.NONE;
    }

    const sortedPartyMemberScores = this.getSortedPartyMemberMatchupScores(partyMemberScores);

    const maxScorePartyMemberIndexes = partyMemberScores
      .filter(pms => pms[1] === sortedPartyMemberScores[0][1])
      .map(pms => pms[0]);

    if (maxScorePartyMemberIndexes.length > 1) {
      let rand: number;
      // TODO: should this use `randSeedItem`?

      globalScene.executeWithSeedOffset(
        () => (rand = randSeedInt(maxScorePartyMemberIndexes.length)),
        globalScene.currentBattle.turn << 2,
      );
      return maxScorePartyMemberIndexes[rand!];
    }

    return maxScorePartyMemberIndexes[0];
  }

  getPartyMemberModifierChanceMultiplier(index: number): number {
    switch (this.getPartyTemplate().getStrength(index)) {
      case PartyMemberStrength.WEAKER:
        return 0.75;
      case PartyMemberStrength.WEAK:
        return 0.675;
      case PartyMemberStrength.AVERAGE:
        return 0.5625;
      case PartyMemberStrength.STRONG:
        return 0.45;
      case PartyMemberStrength.STRONGER:
        return 0.375;
      default:
        console.warn("getPartyMemberModifierChanceMultiplier not defined. Using default 0");
        return 0;
    }
  }

  genModifiers(party: readonly EnemyPokemon[]): PersistentModifier[] {
    if (this.config.genModifiersFunc) {
      return this.config.genModifiersFunc(party);
    }
    return [];
  }

  genAI(party: readonly EnemyPokemon[]) {
    if (this.config.genAIFuncs) {
      this.config.genAIFuncs.forEach(f => f(party));
    }
    console.log("Generated AI funcs");
  }

  loadAssets(): Promise<void> {
    return this.config.loadAssets(this.variant);
  }

  initSprite(): void {
    this.getSprites().map((sprite, i) => sprite.setTexture(this.getKey(!!i)).setFrame(0));
    this.getTintSprites().map((tintSprite, i) => tintSprite.setTexture(this.getKey(!!i)).setFrame(0));
  }

  /**
   * Attempts to animate a given set of {@linkcode Phaser.GameObjects.Sprite}
   * @see {@linkcode Phaser.GameObjects.Sprite.play}
   * @param sprite {@linkcode Phaser.GameObjects.Sprite} to animate
   * @param tintSprite {@linkcode Phaser.GameObjects.Sprite} placed on top of the sprite to add a color tint
   * @param animConfig {@linkcode Phaser.Types.Animations.PlayAnimationConfig} to pass to {@linkcode Phaser.GameObjects.Sprite.play}
   * @returns true if the sprite was able to be animated
   */
  tryPlaySprite(
    sprite: Phaser.GameObjects.Sprite,
    tintSprite: Phaser.GameObjects.Sprite,
    animConfig: Phaser.Types.Animations.PlayAnimationConfig,
  ): boolean {
    // Show an error in the console if there isn't a texture loaded
    if (sprite.texture.key === "__MISSING") {
      console.error(`No texture found for '${animConfig.key}'!`);

      return false;
    }
    // Don't try to play an animation when there isn't one
    if (sprite.texture.frameTotal <= 1) {
      console.warn(`No animation found for '${animConfig.key}'. Is this intentional?`);

      return false;
    }

    sprite.play(animConfig);
    tintSprite.play(animConfig);

    return true;
  }

  playAnim(): void {
    const trainerAnimConfig = {
      key: this.getKey(),
      repeat: 0,
      startFrame: 0,
    };
    const sprites = this.getSprites();
    const tintSprites = this.getTintSprites();

    this.tryPlaySprite(sprites[0], tintSprites[0], trainerAnimConfig);

    // Queue an animation for the second trainer if this is a double battle against two separate trainers
    if (this.variant === TrainerVariant.DOUBLE && !this.config.doubleOnly) {
      const partnerTrainerAnimConfig = {
        key: this.getKey(true),
        repeat: 0,
        startFrame: 0,
      };

      this.tryPlaySprite(sprites[1], tintSprites[1], partnerTrainerAnimConfig);
    }
  }

  getSprites(): Phaser.GameObjects.Sprite[] {
    const ret: Phaser.GameObjects.Sprite[] = [this.getAt(0)];
    if (this.variant === TrainerVariant.DOUBLE && !this.config.doubleOnly) {
      ret.push(this.getAt(2));
    }
    return ret;
  }

  getTintSprites(): Phaser.GameObjects.Sprite[] {
    const ret: Phaser.GameObjects.Sprite[] = [this.getAt(1)];
    if (this.variant === TrainerVariant.DOUBLE && !this.config.doubleOnly) {
      ret.push(this.getAt(3));
    }
    return ret;
  }

  tint(color: number, alpha?: number, duration?: number, ease?: string): void {
    const tintSprites = this.getTintSprites();
    tintSprites.forEach(tintSprite => {
      tintSprite //
        .setTint(color)
        .setTintMode(Phaser.TintModes.FILL)
        .setVisible(true);

      if (duration) {
        tintSprite.setAlpha(0);

        globalScene.tweens.add({
          targets: tintSprite,
          alpha: alpha || 1,
          duration,
          ease: ease || "Linear",
        });
      } else {
        tintSprite.setAlpha(alpha);
      }
    });
  }

  untint(duration: number, ease?: string): void {
    const tintSprites = this.getTintSprites();
    tintSprites.map(tintSprite => {
      if (duration) {
        globalScene.tweens.add({
          targets: tintSprite,
          alpha: 0,
          duration,
          ease: ease || "Linear",
          onComplete: () => {
            tintSprite.setVisible(false);
            tintSprite.setAlpha(1);
          },
        });
      } else {
        tintSprite.setVisible(false);
        tintSprite.setAlpha(1);
      }
    });
  }

  /**
   * Determines whether a Trainer should Terastallize their Pokemon
   * @param pokemon {@linkcode EnemyPokemon} Trainer Pokemon in question
   * @returns boolean Whether the EnemyPokemon should Terastalize this turn
   */
  shouldTera(pokemon: EnemyPokemon): boolean {
    if (
      this.config.trainerAI.teraMode === TeraAIMode.INSTANT_TERA
      && !pokemon.isTerastallized
      && this.config.trainerAI.instantTeras.includes(pokemon.initialTeamIndex)
      && !globalScene.currentBattle.enemyFaintsHistory.some(f => f.pokemon.id === pokemon.id)
      // Local fork (2026-11-10): never in a form the player could not Terastallize in either (Mega, Primal,
      // Gigantamax...: `canSpeciesTera`'s rule), now that enemies can come in one (enemy-battle-forms.ts)
      && !isTeraBlockedForm(pokemon)
    ) {
      return true;
    }
    return false;
  }
}
