import { getGameMode } from "#app/game-mode";
import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Nature } from "#enums/nature";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import {
  getPlayerModifierTypeOptions,
  type ModifierTypeGenerator,
  type ModifierTypeOption,
  PokemonNatureChangeModifierType,
} from "#modifiers/modifier-type";
import * as EncounterTransformationSequence from "#mystery-encounters/encounter-transformation-sequence";
import * as MysteryEncounters from "#mystery-encounters/mystery-encounter-biomes";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { TitlePhase } from "#phases/title-phase";
import { GameManager } from "#test/framework/game-manager";
import { runMysteryEncounterToEnd } from "#test/utils/encounter-test-utils";
import { generateStarters } from "#test/utils/game-manager-utils";
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import { getEnumValues } from "#utils/enums";
import { getModifierPoolForType } from "#utils/modifier-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local fork, the user's request of 2026-11-06: "성격 민트도 우리 파티 내에 이 성격을 가진 포켓몬이 있거나(있었거나),
 * 이 민트가 보상에 한번이라도 나온 적이 있는 경우에 안나오게".
 */
describe("Custom - mints leave out natures the party has had and mints already offered", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH])
      .startingLevel(50);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function startEndless(species: SpeciesId[]): Promise<void> {
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.ENDLESS);
      game.scene.offsetGym = false;
      const starters = generateStarters(game.scene, species);
      const selectStarterPhase = new SelectStarterPhase();
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      selectStarterPhase.initBattle(starters);
    });
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    await game.phaseInterceptor.to("CommandPhase", false);
  }

  const mintGenerator = () => modifierTypes.MINT() as ModifierTypeGenerator;

  /** Rolls the mint generator `n` times for the player party and returns the natures it gave */
  function rollMints(n: number): Set<Nature | null> {
    const party = game.scene.getPlayerParty();
    const generator = mintGenerator();
    const seen = new Set<Nature | null>();
    for (let i = 0; i < n; i++) {
      const type = generator.generateType(party) as PokemonNatureChangeModifierType | null;
      seen.add(type ? type.getNature() : null);
    }
    return seen;
  }

  function mintWeight(): number {
    const entry = getModifierPoolForType(ModifierPoolType.PLAYER)[ModifierTier.ULTRA].find(
      w => w.modifierType.id === "MINT",
    )!;
    expect(entry.maxWeight).toBe(4);
    return (entry.weight as WeightedModifierTypeWeightFunc)(game.scene.getPlayerParty(), 0);
  }

  function setNatures(pokemon: PlayerPokemon, nature: Nature): void {
    // Straight assignment: a fresh party member that has always had this nature
    pokemon.nature = nature;
    pokemon.customPokemonData.nature = -1;
  }

  it("never offers the nature of a current party member", async () => {
    await startEndless([SpeciesId.FEEBAS, SpeciesId.MAGIKARP]);
    const [a, b] = game.scene.getPlayerParty();
    setNatures(a, Nature.ADAMANT);
    setNatures(b, Nature.TIMID);
    game.scene.forkSeenNatures.clear();
    game.scene.forkOfferedMintNatures.clear();

    const offerable = game.scene.getOfferableMintNatures();
    expect(offerable).toHaveLength(23);
    expect(offerable).not.toContain(Nature.ADAMANT);
    expect(offerable).not.toContain(Nature.TIMID);
    const rolled = rollMints(500);
    expect(rolled.has(Nature.ADAMANT)).toBe(false);
    expect(rolled.has(Nature.TIMID)).toBe(false);
    expect(rolled.has(null)).toBe(false);
    expect(rolled.size).toBeGreaterThan(15);
  });

  it("keeps leaving out a nature after a mint changes it and after its Pokémon leaves the party", async () => {
    await startEndless([SpeciesId.FEEBAS, SpeciesId.MAGIKARP, SpeciesId.ABRA]);
    const [a, b, c] = game.scene.getPlayerParty();
    setNatures(a, Nature.ADAMANT);
    setNatures(b, Nature.TIMID);
    setNatures(c, Nature.BOLD);
    game.scene.forkSeenNatures.clear();
    game.scene.forkOfferedMintNatures.clear();

    // A mint (or an encounter) changes Adamant to Jolly: both count from now on
    a.setCustomNature(Nature.JOLLY);
    // ...and again to Modest: Jolly was on the party, Adamant is still its own nature
    a.setCustomNature(Nature.MODEST);
    expect(a.getNature()).toBe(Nature.MODEST);

    // Timid leaves through an encounter, Bold is released from the party screen
    game.scene.removePokemonFromPlayerParty(b);
    await game.scene.removePartyMemberModifiers(game.scene.getPlayerParty().indexOf(c));
    game.scene.getPlayerParty().splice(game.scene.getPlayerParty().indexOf(c), 1);
    expect(game.scene.getPlayerParty()).toEqual([a]);

    const offerable = game.scene.getOfferableMintNatures();
    for (const nature of [Nature.ADAMANT, Nature.JOLLY, Nature.MODEST, Nature.TIMID, Nature.BOLD]) {
      expect(offerable, Nature[nature]).not.toContain(nature);
    }
    expect(offerable).toHaveLength(20);
  });

  it("never offers a mint again once it has been shown, even if it was not taken", async () => {
    await startEndless([SpeciesId.FEEBAS]);
    setNatures(game.scene.getPlayerParty()[0], Nature.HARDY);
    game.scene.forkSeenNatures.clear();
    game.scene.forkOfferedMintNatures.clear();
    const party = game.scene.getPlayerParty();

    const [option] = getPlayerModifierTypeOptions(1, party, [], {
      guaranteedModifierTypeFuncs: [modifierTypes.MINT],
      fillRemaining: false,
    });
    expect(option.type).toBeInstanceOf(PokemonNatureChangeModifierType);
    const shown = (option.type as PokemonNatureChangeModifierType).getNature();
    expect(shown).not.toBe(Nature.HARDY);
    expect([...game.scene.forkOfferedMintNatures]).toEqual([shown]);
    expect(rollMints(500).has(shown)).toBe(false);
    expect(game.scene.getOfferableMintNatures()).toHaveLength(23);
  });

  it("gives four different natures when one reward list holds four mints (Weird Dream), and only as many as are left", async () => {
    await startEndless([SpeciesId.FEEBAS]);
    const party = game.scene.getPlayerParty();
    const fourMints = () =>
      getPlayerModifierTypeOptions(4, party, [], {
        guaranteedModifierTypeFuncs: [modifierTypes.MINT, modifierTypes.MINT, modifierTypes.MINT, modifierTypes.MINT],
        fillRemaining: false,
      }).map(o => (o.type as PokemonNatureChangeModifierType).getNature());

    for (let i = 0; i < 5; i++) {
      game.scene.forkOfferedMintNatures.clear();
      const natures = fourMints();
      expect(natures).toHaveLength(4);
      expect(new Set(natures).size).toBe(4);
    }

    // Only two natures left: two mints, the other two slots stay empty
    const own = game.scene.getPlayerParty()[0].getNature();
    const left = getEnumValues(Nature)
      .filter(n => n !== own)
      .slice(0, 2);
    game.scene.forkOfferedMintNatures = new Set(getEnumValues(Nature).filter(n => !left.includes(n)));
    expect([...fourMints()].sort()).toEqual([...left].sort());
  });

  it.each([3, 2, 1, 0])(
    "runs the real Weird Dream reward screen with %i nature(s) left: one mint per free nature, all different",
    async left => {
      game.override.mysteryEncounterChance(100).startingWave(45).startingBiome(BiomeId.CAVE).disableTrainerWaves();
      vi.spyOn(EncounterTransformationSequence, "doPokemonTransformationSequence").mockImplementation(() =>
        Promise.resolve(),
      );
      vi.spyOn(MysteryEncounters, "mysteryEncountersByBiome", "get").mockReturnValue(
        new Map<BiomeId, MysteryEncounterType[]>([[BiomeId.CAVE, [MysteryEncounterType.WEIRD_DREAM]]]),
      );
      await game.runToMysteryEncounter(MysteryEncounterType.WEIRD_DREAM, [
        SpeciesId.MAGBY,
        SpeciesId.HAUNTER,
        SpeciesId.ABRA,
      ]);
      const oldNatures = game.scene.getPlayerParty().map(p => p.getNature());
      await runMysteryEncounterToEnd(game, 1);
      await game.phaseInterceptor.to("SelectModifierPhase", false);

      // The dream replaced the team: the old natures stay recorded, the new ones are on the party now
      const offerableNow = game.scene.getOfferableMintNatures();
      for (const nature of [...oldNatures, ...game.scene.getPlayerParty().map(p => p.getNature())]) {
        expect(offerableNow, Nature[nature]).not.toContain(nature);
      }
      // Use up every offerable nature but `left` of them, as earlier rewards would have
      const free = offerableNow.slice(0, left);
      for (const nature of offerableNow.slice(left)) {
        game.scene.forkOfferedMintNatures.add(nature);
      }
      expect(game.scene.getOfferableMintNatures()).toEqual(free);

      await game.phaseInterceptor.to("SelectModifierPhase");
      expect(game.scene.ui.mode).toBe(UiMode.MODIFIER_SELECT);
      const handler = game.scene.ui.handlers.find(h => h instanceof ModifierSelectUiHandler) as ModifierSelectUiHandler;
      const ids = handler.options.map(o => o.modifierTypeOption.type.id);
      expect(ids).toEqual(["MEMORY_MUSHROOM", "ROGUE_BALL", ...new Array(left).fill("MINT")]);
      const mintNatures = handler.options
        .slice(2)
        .map(o => (o.modifierTypeOption.type as PokemonNatureChangeModifierType).getNature());
      expect([...mintNatures].sort()).toEqual([...free].sort());
      expect(game.scene.getOfferableMintNatures()).toEqual([]);
    },
  );

  it("shows the same Fight or Flight mint after a reload and saves the list from before the encounter rolled it", async () => {
    game.override.mysteryEncounterChance(100).startingWave(45).startingBiome(BiomeId.CAVE).disableTrainerWaves();
    vi.spyOn(MysteryEncounters, "mysteryEncountersByBiome", "get").mockReturnValue(
      new Map<BiomeId, MysteryEncounterType[]>([[BiomeId.CAVE, [MysteryEncounterType.FIGHT_OR_FLIGHT]]]),
    );
    // The guarded item is a mint (its nature still comes from the offerable list)
    game.override.itemRewards([{ name: "MINT" }]);
    await game.runToMysteryEncounter(MysteryEncounterType.FIGHT_OR_FLIGHT, [SpeciesId.FEEBAS, SpeciesId.MAGIKARP]);
    const mintOf = () =>
      (
        (game.scene.currentBattle.mysteryEncounter!.misc as ModifierTypeOption).type as PokemonNatureChangeModifierType
      ).getNature();
    const shown = mintOf();
    expect(game.scene.forkOfferedMintNatures.has(shown)).toBe(true);
    const offeredCount = game.scene.forkOfferedMintNatures.size;

    // The wave-start save comes after onInit rolled the item, but keeps the list from before it
    const saved = game.reload["sessionData"];
    expect(saved.forkOfferedMintNatures ?? []).not.toContain(shown);
    expect(game.scene.forkOfferedMintNaturesAtWaveStart).toBeUndefined();

    // Reload to the same wave, the way "Continue" or a Retry does, and run the encounter's onInit again
    const scene = game.scene;
    const titlePhase = new TitlePhase();
    scene.phaseManager.clearPhaseQueue();
    vi.spyOn(scene.gameData, "getSession").mockReturnValue(Promise.resolve(saved));
    scene.phaseManager.unshiftPhase(titlePhase);
    game.endPhase();
    scene.modifiers = [];
    await titlePhase["loadSaveSlot"](0);
    await game.phaseInterceptor.to("EncounterPhase");

    expect(game.scene.currentBattle.mysteryEncounter?.encounterType).toBe(MysteryEncounterType.FIGHT_OR_FLIGHT);
    expect(mintOf()).toBe(shown);
    expect(game.scene.forkOfferedMintNatures.size).toBe(offeredCount);
  });

  it("stops offering mints once every nature is used up, and comes back if one is free again", async () => {
    await startEndless([SpeciesId.FEEBAS]);
    game.scene.forkOfferedMintNatures.clear();
    expect(mintWeight()).toBe(4);
    const own = game.scene.getPlayerParty()[0].getNature();
    for (const nature of getEnumValues(Nature)) {
      game.scene.forkOfferedMintNatures.add(nature);
    }
    expect(game.scene.getOfferableMintNatures()).toEqual([]);
    expect(mintWeight()).toBe(0);
    expect(rollMints(20)).toEqual(new Set([null]));

    // A nature freed in this test only (nothing frees one in a real run) shows the rule is the only filter
    const free = getEnumValues(Nature).find(n => n !== own)!;
    game.scene.forkOfferedMintNatures.delete(free);
    expect(mintWeight()).toBe(4);
    expect(rollMints(20)).toEqual(new Set([free]));
  });

  it("still gives a mint of a nature named by an encounter or override, and ignores enemy parties", async () => {
    await startEndless([SpeciesId.FEEBAS]);
    const own = game.scene.getPlayerParty()[0].getNature();
    const named = mintGenerator().generateType([], [own]) as PokemonNatureChangeModifierType;
    expect(named.getNature()).toBe(own);

    for (const nature of getEnumValues(Nature)) {
      game.scene.forkOfferedMintNatures.add(nature);
    }
    expect(mintGenerator().generateType([game.field.getEnemyPokemon()])).not.toBeNull();
  });

  it("keeps both lists through the session save and load", async () => {
    await startEndless([SpeciesId.FEEBAS, SpeciesId.MAGIKARP]);
    const [a, b] = game.scene.getPlayerParty();
    setNatures(a, Nature.ADAMANT);
    setNatures(b, Nature.TIMID);
    game.scene.forkSeenNatures.clear();
    game.scene.forkOfferedMintNatures.clear();
    game.scene.forkOfferedMintNatures.add(Nature.CALM);
    game.scene.removePokemonFromPlayerParty(b);

    const { gameData } = game.scene;
    const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
    const session = gameData.parseSessionData(json);
    expect([...(session.forkSeenNatures ?? [])].sort()).toEqual([Nature.ADAMANT, Nature.TIMID].sort());
    expect(session.forkOfferedMintNatures).toEqual([Nature.CALM]);

    game.scene.forkSeenNatures = new Set();
    game.scene.forkOfferedMintNatures = new Set();
    game.reload["sessionData"] = session;
    await game.reload.reloadSession();

    expect(game.scene.getPlayerParty().map(p => p.getNature())).toEqual([Nature.ADAMANT]);
    expect(game.scene.forkSeenNatures.has(Nature.TIMID)).toBe(true);
    expect(game.scene.forkOfferedMintNatures.has(Nature.CALM)).toBe(true);
    const offerable = game.scene.getOfferableMintNatures();
    expect(offerable).not.toContain(Nature.TIMID);
    expect(offerable).not.toContain(Nature.CALM);
    expect(offerable).toHaveLength(22);
  });

  it("starts a save from before this change with the party it has now", async () => {
    await startEndless([SpeciesId.FEEBAS]);
    setNatures(game.scene.getPlayerParty()[0], Nature.ADAMANT);
    const { gameData } = game.scene;
    const raw = JSON.parse(
      JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v)),
    );
    delete raw.forkSeenNatures;
    delete raw.forkOfferedMintNatures;
    const session = gameData.parseSessionData(JSON.stringify(raw));

    game.scene.forkSeenNatures = new Set([Nature.BOLD]);
    game.scene.forkOfferedMintNatures = new Set([Nature.CALM]);
    game.reload["sessionData"] = session;
    await game.reload.reloadSession();

    expect([...game.scene.forkSeenNatures]).toEqual([Nature.ADAMANT]);
    expect([...game.scene.forkOfferedMintNatures]).toEqual([]);
  });
});
