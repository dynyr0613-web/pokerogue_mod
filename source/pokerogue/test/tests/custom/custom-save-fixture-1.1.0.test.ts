// Local fork (2026-11-19): a 1.1.0 save with the fork's data, loaded by the current code (docs/1.2.0_후보_20261119.md,
// B4). The base game's fixtures in test/utils/saves hold no fork data, so nothing checked that a save written by the
// released edition still loads after the fork's own changes.
//
// The fixtures, made once from the 1.1.0 code (2026-11-19) through the game's own save functions (checked in review:
// the working tree then differed from the 1.1.0 source zip, pokerogue-local-source-20261119.zip, only in battle code,
// with src/enums, src/system and src/@types/save-data.ts unchanged):
// - test/utils/saves/fork-1.1.0-system.prsv: `GameData.getSystemSaveData()`, serialized as `saveSystem` does, short
//   keys as the Export Data menu writes them (`convertSystemDataStr(…, true)`), AES-encrypted with `saveKey` like every
//   .prsv file. Fork fields: the mark collection (`markCounts`), the starters' marks, Partner Mark, Best Friends Ribbon,
//   worn mark, alpha boost and switch, per-species passive choice, fork achievements and a named trainer's voucher.
// - test/utils/saves/fork-1.1.0-session.prsv: `GameData.getSessionSaveData()` as JSON, AES-encrypted the same way (the
//   session export). Endless wave 1234 against Volo (TrainerType 400) with Endless boss bars; Charizard in its Mega Z
//   form (custom form 4) holding the Charizardite Z (custom FormChangeItem 140), a G-Max/Max candy conversion and a Z
//   crystal conversion, EVs, marks, the fork passive; an alpha Torkoal in the Dynamax state (active Max Mushrooms)
//   knowing 승화 (custom MoveId 921) with Forged Steel and an Assault Vest; Melmetal with G-Max Meltdown (948) and
//   Z다이검무 (958) conversions and an inactive Melmetalite (143); Piercing and Guard Tokens, the Z-Ring and Mark Charm;
//   the enemy's Damage and Protection Tokens; two fork encounters in the encounter log.
// The writer below made them. Do NOT regenerate these files: they stand for saves of the released 1.1.0 edition. For a
// later release, add new fixtures (fork-1.2.0-*) next to them: delete nothing, set FORK_SAVE_FIXTURE_WRITE=1 with new
// file names, and keep the old tests.

import { saveKey } from "#app/constants";
import { getGameMode } from "#app/game-mode";
import { getStarterAlphaBoost, registerAlpha } from "#data/alpha-pokemon";
import { modifierTypes } from "#data/data-lists";
import {
  awardEndlessMilestoneRibbon,
  awardTrainerRibbon,
  getCollectedMarks,
  getStarterEquippedMark,
  hasEverObtainedMark,
} from "#data/pokemon-marks";
import { BattleType } from "#enums/battle-type";
import { FormChangeItem } from "#enums/form-change-item";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PokemonMark } from "#enums/pokemon-mark";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { UiMode } from "#enums/ui-mode";
import { Unlockables } from "#enums/unlockables";
import type { Pokemon } from "#field/pokemon";
import type { EnemyPersistentModifier, PokemonFormChangeItemModifier } from "#modifiers/modifier";
import { type FormChangeItemModifierType, ZCrystalModifierType } from "#modifiers/modifier-type";
import { generateModifierType } from "#mystery-encounters/encounter-phase-utils";
import { SeenEncounterData } from "#mystery-encounters/mystery-encounter-save-data";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { achvs } from "#system/achv";
import { GameData } from "#system/game-data";
import type { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import type { SessionSaveData } from "#types/save-data";
import fs from "node:fs";
import { AES, enc } from "crypto-js";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const SYSTEM_FIXTURE = "./test/utils/saves/fork-1.1.0-system.prsv";
const SESSION_FIXTURE = "./test/utils/saves/fork-1.1.0-session.prsv";
/** Set to 1 to write fixtures that do not exist yet (an existing file is never overwritten) */
const WRITE_FIXTURES = process.env.FORK_SAVE_FIXTURE_WRITE === "1";

const FIXTURE_WAVE = 1234;
const FIXTURE_SEED = "fork-1.1.0-fixture";
/** Charizard's Mega Z form (custom-save-enum-pins.test.ts pins it) */
const CHARIZARD_MEGA_Z = 4;
/** Fixed timestamps for what the writer unlocks by hand */
const FIXED_TIME = 1_795_000_000_000;

/** `saveSystem`'s replacer: big attribute flags as numbers when they fit, as strings otherwise */
function systemReplacer(_k: string, v: unknown): unknown {
  if (typeof v !== "bigint") {
    return v;
  }
  return v <= 0x80000000 ? Number(v) : v.toString();
}
const sessionReplacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

describe("Local fork - the 1.1.0 save fixture (fork data) loads with the current code", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A rare form-change item for `pokemon` as the reward screen makes it (type id and tier, so the save keeps it) */
  function formItem(pokemon: Pokemon, item: FormChangeItem, active = true): PokemonFormChangeItemModifier {
    const type = generateModifierType(modifierTypes.RARE_FORM_CHANGE_ITEM, [item]) as FormChangeItemModifierType;
    const modifier = type.newModifier(pokemon) as PokemonFormChangeItemModifier;
    modifier.active = active;
    return modifier;
  }

  /** Give `pokemon` `count` of the held item `key` as rewards do (with the type id, so the save keeps it) */
  function giveHeld(pokemon: Pokemon, key: "FORGED_STEEL" | "ASSAULT_VEST", count = 1): void {
    for (let i = 0; i < count; i++) {
      game.scene.addModifier(modifierTypes[key]().withIdFromFunc(modifierTypes[key]).newModifier(pokemon)!);
    }
  }

  /** Give the party `count` of the party item `key` */
  function giveParty(
    key: "PIERCING_TOKEN" | "GUARD_TOKEN" | "Z_RING" | "MARK_CHARM" | "MEGA_BRACELET" | "DYNAMAX_BAND",
    count = 1,
  ): void {
    for (let i = 0; i < count; i++) {
      game.scene.addModifier(modifierTypes[key]().withIdFromFunc(modifierTypes[key]).newModifier()!);
    }
  }

  /** Give the enemy side `count` of a token the way AddEnemyBuffModifierPhase adds one */
  async function giveEnemyToken(key: "ENEMY_DAMAGE_BOOSTER" | "ENEMY_DAMAGE_REDUCTION", count: number): Promise<void> {
    const token = modifierTypes[key]().withIdFromFunc(modifierTypes[key]).newModifier() as EnemyPersistentModifier;
    await game.scene.addEnemyModifier(token, true, true);
    token.stackCount = count;
  }

  /** Mark `pokemon` with `marks` and count them for the collection, as catching or a ribbon award does */
  function mark(pokemon: Pokemon, ...marks: PokemonMark[]): void {
    for (const m of marks) {
      pokemon.addMark(m);
    }
    game.scene.gameData.registerMarks(marks, pokemon);
  }

  it.runIf(WRITE_FIXTURES)("writes the fixtures from the current code (only files that do not exist yet)", async () => {
    expect(fs.existsSync(SYSTEM_FIXTURE) || fs.existsSync(SESSION_FIXTURE), "fixtures are never overwritten").toBe(
      false,
    );
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.VOLO, trainerVariant: TrainerVariant.DEFAULT })
      .startingWave(FIXTURE_WAVE)
      .startingLevel(1250)
      .starterForms({ [SpeciesId.CHARIZARD]: CHARIZARD_MEGA_Z })
      .seed(FIXTURE_SEED);
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.ENDLESS);
      game.scene.offsetGym = false;
      const starters = generateStarters(game.scene, [SpeciesId.CHARIZARD, SpeciesId.TORKOAL, SpeciesId.MELMETAL]);
      game.scene.setSeed(FIXTURE_SEED);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    await game.phaseInterceptor.to("CommandPhase", false);

    const { gameData } = game.scene;
    const [charizard, torkoal, melmetal] = game.scene.getPlayerParty();
    expect(charizard.getFormKey()).toBe("mega-z");

    // Party items first (the Mega Bracelet before the Mega Stone, the Dynamax Band before the mushrooms)
    giveParty("MEGA_BRACELET");
    giveParty("DYNAMAX_BAND");
    giveParty("Z_RING");
    giveParty("MARK_CHARM");
    giveParty("PIERCING_TOKEN", 3);
    giveParty("GUARD_TOKEN", 12);

    // Charizard: Mega Z (stays in the form while its stone is active), candy and crystal conversions, EVs, marks
    game.scene.addModifier(formItem(charizard, FormChangeItem.CHARIZARDITE_Z));
    game.move.changeMoveset(charizard, [MoveId.FLAMETHROWER, MoveId.AIR_SLASH, MoveId.DRAGON_CLAW, MoveId.ROOST]);
    game.scene.addModifier(modifierTypes.DYNAMAX_CANDY().newModifier(charizard, 0)!);
    game.scene.addModifier(new ZCrystalModifierType(PokemonType.FLYING).newModifier(charizard, 1)!);
    charizard.moveset[2].ppUsed = 5;
    charizard.moveset[2].ppUp = 3;
    charizard.evs = [4, 0, 0, 252, 0, 252];
    charizard.customPassiveSpecies = [SpeciesId.CHARMANDER, SpeciesId.CHARMELEON, SpeciesId.CHARIZARD];
    mark(charizard, PokemonMark.RARE_MARK, PokemonMark.PARTNER_MARK, PokemonMark.BEST_FRIENDS_RIBBON);
    charizard.equippedMark = PokemonMark.PARTNER_MARK;
    charizard.calculateStats();

    // Torkoal: an alpha (boost 15) in the Dynamax state, knowing 승화, Forged Steel x3 and an Assault Vest
    game.move.changeMoveset(torkoal, [MoveId.SUBLIMATION, MoveId.EARTH_POWER, MoveId.STEALTH_ROCK, MoveId.YAWN]);
    game.scene.addModifier(modifierTypes.DYNAMAX_CANDY().newModifier(torkoal, 1)!);
    torkoal.setAlphaBoost(15);
    gameData.registerMarks([PokemonMark.ALPHA_MARK, PokemonMark.JUMBO_MARK], torkoal);
    registerAlpha(torkoal);
    game.scene.addModifier(formItem(torkoal, FormChangeItem.MAX_MUSHROOMS));
    giveHeld(torkoal, "FORGED_STEEL", 3);
    giveHeld(torkoal, "ASSAULT_VEST");
    expect(torkoal.isDynamaxed()).toBe(true);

    // Melmetal: G-Max Meltdown, then 강철Z + 다이사탕 on Swords Dance (Z다이검무), an inactive Melmetalite
    game.move.changeMoveset(melmetal, [
      MoveId.DOUBLE_IRON_BASH,
      MoveId.BULLET_PUNCH,
      MoveId.SWORDS_DANCE,
      MoveId.THUNDER_PUNCH,
    ]);
    game.scene.addModifier(modifierTypes.DYNAMAX_CANDY().newModifier(melmetal, 0)!);
    game.scene.addModifier(new ZCrystalModifierType(PokemonType.NORMAL).newModifier(melmetal, 2)!);
    game.scene.addModifier(modifierTypes.DYNAMAX_CANDY().newModifier(melmetal, 2)!);
    game.scene.addModifier(formItem(melmetal, FormChangeItem.MELMETALITE, false));
    giveHeld(melmetal, "FORGED_STEEL");
    mark(melmetal, PokemonMark.MASTER_BALL_MARK);

    // The whole party: Cynthia's ribbon and the wave 1000 Endless ribbon, as the game awards them
    expect(awardTrainerRibbon(TrainerType.CYNTHIA)).toBe(PokemonMark.SINNOH_CHAMPION_RIBBON);
    expect(awardEndlessMilestoneRibbon(1000)).toBe(PokemonMark.GREAT_ABILITY_RIBBON);

    // The enemy side's tokens and the encounter log
    await giveEnemyToken("ENEMY_DAMAGE_BOOSTER", 40);
    await giveEnemyToken("ENEMY_DAMAGE_REDUCTION", 30);
    game.scene.mysteryEncounterSaveData.encounteredEvents.push(
      new SeenEncounterData(MysteryEncounterType.VENDING_MACHINE, MysteryEncounterTier.GREAT, 1201, 0),
      new SeenEncounterData(MysteryEncounterType.ALPHA_ENCOUNTER, MysteryEncounterTier.GREAT, 1220, 0),
    );

    // System data: the starters' choices made in the starter menu, a named trainer's voucher, two fork achievements
    const charmander = gameData.starterData[SpeciesId.CHARMANDER];
    charmander.customPassiveSpecies = [SpeciesId.CHARMANDER, SpeciesId.CHARMELEON, SpeciesId.CHARIZARD];
    charmander.partnerMark = true;
    charmander.bestFriendsRibbon = true;
    charmander.equippedMark = PokemonMark.PARTNER_MARK;
    gameData.starterData[SpeciesId.TORKOAL].alphaEnabled = true;
    gameData.unlocks[Unlockables.ENDLESS_MODE] = true;
    gameData.gameStats.highestEndlessWave = FIXTURE_WAVE;
    gameData.voucherUnlocks.VOLO = FIXED_TIME;
    gameData.achvUnlocks[achvs.LEGENDARY_BIRDS.id] = FIXED_TIME;
    gameData.achvUnlocks[achvs.SWORD_AND_SHIELD.id] = FIXED_TIME;

    const sessionJson = JSON.stringify(gameData.getSessionSaveData(), sessionReplacer);
    const systemJson = JSON.stringify(gameData.getSystemSaveData(), systemReplacer);
    fs.writeFileSync(SESSION_FIXTURE, AES.encrypt(sessionJson, saveKey).toString());
    fs.writeFileSync(
      SYSTEM_FIXTURE,
      AES.encrypt(gameData["convertSystemDataStr"](systemJson, true), saveKey).toString(),
    );
  });

  // #region System data

  /** The system data as the Export Data menu writes it: short keys, AES with `saveKey` (`tryExportData`) */
  function exportSystem(gameData: GameData): string {
    const json = JSON.stringify(gameData.getSystemSaveData(), systemReplacer);
    return AES.encrypt(gameData["convertSystemDataStr"](json, true), saveKey).toString();
  }

  /** The fork's parts of the system data, as plain values */
  function forkSystemView(gameData: GameData) {
    const starters = [SpeciesId.CHARMANDER, SpeciesId.TORKOAL, SpeciesId.MELTAN].map(id => {
      const { marks, customPassiveSpecies, partnerMark, bestFriendsRibbon, equippedMark, alphaBoost, alphaEnabled } =
        gameData.starterData[id];
      return {
        id,
        marks,
        customPassiveSpecies,
        partnerMark,
        bestFriendsRibbon,
        equippedMark,
        alphaBoost,
        alphaEnabled,
      };
    });
    return {
      markCounts: { ...gameData.markCounts },
      starters,
      achvUnlocks: { ...gameData.achvUnlocks },
      voucherUnlocks: { ...gameData.voucherUnlocks },
      endlessUnlocked: gameData.unlocks[Unlockables.ENDLESS_MODE],
      highestEndlessWave: gameData.gameStats.highestEndlessWave,
    };
  }

  /** What the 1.1.0 system fixture holds, written out */
  function expectFixtureSystem(gameData: GameData): void {
    expect(gameData.markCounts).toEqual({
      [PokemonMark.SINNOH_CHAMPION_RIBBON]: 3,
      [PokemonMark.BEST_FRIENDS_RIBBON]: 1,
      [PokemonMark.GREAT_ABILITY_RIBBON]: 3,
      [PokemonMark.RARE_MARK]: 1,
      [PokemonMark.ALPHA_MARK]: 1,
      [PokemonMark.JUMBO_MARK]: 1,
      [PokemonMark.PARTNER_MARK]: 1,
      [PokemonMark.MASTER_BALL_MARK]: 1,
    });
    const charmander = gameData.starterData[SpeciesId.CHARMANDER];
    expect(charmander.marks).toEqual([
      PokemonMark.RARE_MARK,
      PokemonMark.PARTNER_MARK,
      PokemonMark.BEST_FRIENDS_RIBBON,
      PokemonMark.SINNOH_CHAMPION_RIBBON,
      PokemonMark.GREAT_ABILITY_RIBBON,
    ]);
    expect(charmander.customPassiveSpecies).toEqual([SpeciesId.CHARMANDER, SpeciesId.CHARMELEON, SpeciesId.CHARIZARD]);
    expect(charmander.partnerMark).toBe(true);
    expect(charmander.bestFriendsRibbon).toBe(true);
    expect(getStarterEquippedMark(charmander)).toBe(PokemonMark.PARTNER_MARK);
    const torkoal = gameData.starterData[SpeciesId.TORKOAL];
    expect(torkoal.marks).toEqual([
      PokemonMark.ALPHA_MARK,
      PokemonMark.JUMBO_MARK,
      PokemonMark.SINNOH_CHAMPION_RIBBON,
      PokemonMark.GREAT_ABILITY_RIBBON,
    ]);
    expect(getStarterAlphaBoost(torkoal)).toBe(15);
    expect(torkoal.alphaEnabled).toBe(true);
    expect(gameData.starterData[SpeciesId.MELTAN].marks).toEqual([
      PokemonMark.MASTER_BALL_MARK,
      PokemonMark.SINNOH_CHAMPION_RIBBON,
      PokemonMark.GREAT_ABILITY_RIBBON,
    ]);
    // The mark Pokédex reads them
    expect(getCollectedMarks(torkoal)).toContain(PokemonMark.JUMBO_MARK);
    // Achievements (kept by name): the fork's mark and dex ones, and upstream's GIGANTAMAX, which the fork's Dynamax
    // state awards; and a named trainer's voucher
    for (const id of ["MEMORIAL_RIBBON", "HIDDEN_MARK", "GIGANTAMAX", "LEGENDARY_BIRDS", "SWORD_AND_SHIELD"]) {
      expect(gameData.achvUnlocks, id).toHaveProperty(id);
    }
    expect(gameData.achvUnlocks.LEGENDARY_BIRDS).toBe(FIXED_TIME);
    expect(gameData.voucherUnlocks.VOLO).toBe(FIXED_TIME);
    expect(gameData.unlocks[Unlockables.ENDLESS_MODE]).toBe(true);
    expect(gameData.gameStats.highestEndlessWave).toBe(FIXTURE_WAVE);
  }

  it("loads the system save with its fork fields (Import Data path)", async () => {
    await game.importData(SYSTEM_FIXTURE);
    expectFixtureSystem(game.scene.gameData);
    expect(hasEverObtainedMark(PokemonMark.PARTNER_MARK)).toBe(true);
  });

  it("keeps the fork fields through export and import again (load -> save -> load)", async () => {
    await game.importData(SYSTEM_FIXTURE);
    const before = forkSystemView(game.scene.gameData);
    const exported = exportSystem(game.scene.gameData);

    // Into a fresh GameData, the way GameManager.importData loads a .prsv file
    const fresh = new GameData();
    game.scene.gameData = fresh;
    expect(
      await fresh["initSystem"](fresh["convertSystemDataStr"](AES.decrypt(exported, saveKey).toString(enc.Utf8))),
    ).toBe(true);
    expectFixtureSystem(fresh);
    expect(forkSystemView(fresh)).toEqual(before);
  });

  // #endregion System data

  // #region Session data

  /** The session fixture parsed the way "Continue" parses a saved session (`GameData.parseSessionData`) */
  function readSessionFixture(): SessionSaveData {
    const raw = fs.readFileSync(SESSION_FIXTURE, "utf8");
    return game.scene.gameData.parseSessionData(AES.decrypt(raw, saveKey).toString(enc.Utf8));
  }

  /** The fork-relevant parts of a parsed session, as plain values (no timestamps, no play time) */
  function forkSessionView(session: SessionSaveData) {
    const moves = (p: PokemonData) =>
      p.moveset.map(({ moveId, ppUsed, ppUp, transform }) => ({ moveId, ppUsed, ppUp, transform }));
    const mods = (list: SessionSaveData["modifiers"]) =>
      list
        .map(({ typeId, typePregenArgs, args, stackCount, className }) => ({
          typeId,
          typePregenArgs,
          args,
          stackCount,
          className,
        }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return {
      gameMode: session.gameMode,
      waveIndex: session.waveIndex,
      battleType: session.battleType,
      trainer: { trainerType: session.trainer?.trainerType, variant: session.trainer?.variant },
      party: session.party.map(p => ({
        id: p.id,
        species: p.species,
        formIndex: p.formIndex,
        level: p.level,
        abilityIndex: p.abilityIndex,
        moveset: moves(p),
        marks: p.marks,
        equippedMark: p.equippedMark,
        alphaBoost: p.alphaBoost,
        evs: p.evs,
        customPassiveSpecies: p.customPassiveSpecies,
      })),
      enemyParty: session.enemyParty.map(p => ({
        id: p.id,
        species: p.species,
        formIndex: p.formIndex,
        bossSegments: p.bossSegments,
        forkBossHpBars: p.forkBossHpBars,
        moveset: moves(p),
      })),
      modifiers: mods(session.modifiers),
      enemyModifiers: mods(session.enemyModifiers),
      encounteredEvents: session.mysteryEncounterSaveData.encounteredEvents.map(e => ({ ...e })),
    };
  }

  /** Load `session` the way "Continue" on the title screen does (`loadSession` -> `initSessionFromData`) */
  async function continueSession(session: SessionSaveData): Promise<void> {
    game.reload["sessionData"] = session;
    await game.reload.reloadSession();
  }

  const heldItem = (pokemon: Pokemon, typeId: string) => pokemon.getHeldItems().find(m => m.type.id === typeId);
  const formItems = (pokemon: Pokemon) =>
    pokemon
      .getHeldItems()
      .filter(m => m.is("PokemonFormChangeItemModifier"))
      .map(m => {
        const { formChangeItem, active } = m as PokemonFormChangeItemModifier;
        return { formChangeItem, active };
      });
  const partyItemCount = (typeId: string) => game.scene.findModifier(m => m.type.id === typeId)?.getStackCount();
  const enemyItemCount = (typeId: string) => game.scene.findModifier(m => m.type.id === typeId, false)?.getStackCount();

  /** What the 1.1.0 session fixture holds, checked on the loaded game */
  function expectFixtureSessionLoaded(): void {
    const { scene } = game;
    expect(scene.gameMode.modeId).toBe(GameModes.ENDLESS);
    expect(scene.currentBattle.waveIndex).toBe(FIXTURE_WAVE);
    expect(scene.currentBattle.battleType).toBe(BattleType.TRAINER);
    expect(scene.currentBattle.trainer?.config.trainerType).toBe(TrainerType.VOLO);

    const [charizard, torkoal, melmetal] = scene.getPlayerParty();
    expect(scene.getPlayerParty().map(p => p.species.speciesId)).toEqual([
      SpeciesId.CHARIZARD,
      SpeciesId.TORKOAL,
      SpeciesId.MELMETAL,
    ]);

    // Charizard: the custom Mega Z form with its custom stone, a G-Max candy and a Flying Z conversion
    expect(charizard.formIndex).toBe(CHARIZARD_MEGA_Z);
    expect(charizard.getFormKey()).toBe("mega-z");
    expect(formItems(charizard)).toEqual([{ formChangeItem: FormChangeItem.CHARIZARDITE_Z, active: true }]);
    expect(charizard.moveset.map(m => m.moveId)).toEqual([
      MoveId.FLAMETHROWER,
      MoveId.AIR_SLASH,
      MoveId.DRAGON_CLAW,
      MoveId.ROOST,
    ]);
    expect(charizard.moveset.map(m => m.transform)).toEqual([
      { kind: "gmax", moveId: MoveId.G_MAX_WILDFIRE },
      { kind: "z", moveId: MoveId.SUPERSONIC_SKYSTRIKE__SPECIAL },
      undefined,
      undefined,
    ]);
    expect(charizard.moveset.map(m => m.getMove().id)).toEqual([
      MoveId.G_MAX_WILDFIRE,
      MoveId.SUPERSONIC_SKYSTRIKE__SPECIAL,
      MoveId.DRAGON_CLAW,
      MoveId.ROOST,
    ]);
    expect([charizard.moveset[2].ppUsed, charizard.moveset[2].ppUp]).toEqual([5, 3]);
    expect(charizard.marks).toEqual([
      PokemonMark.RARE_MARK,
      PokemonMark.PARTNER_MARK,
      PokemonMark.BEST_FRIENDS_RIBBON,
      PokemonMark.SINNOH_CHAMPION_RIBBON,
      PokemonMark.GREAT_ABILITY_RIBBON,
    ]);
    expect(charizard.equippedMark).toBe(PokemonMark.PARTNER_MARK);
    expect(charizard.evs).toEqual([4, 0, 0, 252, 0, 252]);
    expect(charizard.customPassiveSpecies).toEqual([SpeciesId.CHARMANDER, SpeciesId.CHARMELEON, SpeciesId.CHARIZARD]);
    expect(charizard.usesCustomPassive()).toBe(true);

    // Torkoal: an alpha in the Dynamax state, knowing 승화, with a Max Quake candy conversion and its held items
    expect(torkoal.moveset.map(m => m.moveId)).toEqual([
      MoveId.SUBLIMATION,
      MoveId.EARTH_POWER,
      MoveId.STEALTH_ROCK,
      MoveId.YAWN,
    ]);
    expect(torkoal.moveset[0].getMove().id).toBe(MoveId.SUBLIMATION);
    expect(torkoal.moveset[1].transform).toEqual({ kind: "max", moveId: MoveId.MAX_QUAKE });
    expect(torkoal.alphaBoost).toBe(15);
    expect(torkoal.marks).toEqual([
      PokemonMark.ALPHA_MARK,
      PokemonMark.JUMBO_MARK,
      PokemonMark.SINNOH_CHAMPION_RIBBON,
      PokemonMark.GREAT_ABILITY_RIBBON,
    ]);
    expect(formItems(torkoal)).toEqual([{ formChangeItem: FormChangeItem.MAX_MUSHROOMS, active: true }]);
    expect(torkoal.hasDynamaxState()).toBe(true);
    expect(torkoal.isDynamaxed()).toBe(true);
    expect(heldItem(torkoal, "FORGED_STEEL")?.getStackCount()).toBe(3);
    expect(heldItem(torkoal, "ASSAULT_VEST")?.getStackCount()).toBe(1);

    // Melmetal: G-Max Meltdown and Z다이검무, an inactive Melmetalite (no Mega form)
    expect(melmetal.moveset.map(m => m.transform)).toEqual([
      { kind: "gmax", moveId: MoveId.G_MAX_MELTDOWN },
      undefined,
      { kind: "zMax", moveId: MoveId.MAX_SWORDS_DANCE },
      undefined,
    ]);
    expect(melmetal.moveset[2].getMove().id).toBe(MoveId.MAX_SWORDS_DANCE);
    expect(formItems(melmetal)).toEqual([{ formChangeItem: FormChangeItem.MELMETALITE, active: false }]);
    expect(melmetal.getFormKey()).toBe("");
    expect(heldItem(melmetal, "FORGED_STEEL")?.getStackCount()).toBe(1);
    expect(melmetal.marks).toEqual([
      PokemonMark.MASTER_BALL_MARK,
      PokemonMark.SINNOH_CHAMPION_RIBBON,
      PokemonMark.GREAT_ABILITY_RIBBON,
    ]);

    // Party items
    expect(partyItemCount("PIERCING_TOKEN")).toBe(3);
    expect(partyItemCount("GUARD_TOKEN")).toBe(12);
    for (const typeId of ["Z_RING", "MARK_CHARM", "MEGA_BRACELET", "DYNAMAX_BAND"]) {
      expect(partyItemCount(typeId), typeId).toBe(1);
    }

    // Volo's party at wave 1234: the Endless boss bars, the enemy's tokens, his Giratina in the Dynamax state
    const enemies = scene.getEnemyParty();
    expect(enemies.map(p => p.forkBossHpBars)).toEqual([3, 3, 3, 5, 5, 8]);
    expect(enemies.map(p => p.bossSegments)).toEqual([3, 3, 3, 5, 5, 8]);
    expect(enemies[5].species.speciesId).toBe(SpeciesId.GIRATINA);
    expect(enemies[5].isDynamaxed()).toBe(true);
    expect(enemyItemCount("ENEMY_DAMAGE_BOOSTER")).toBe(40);
    expect(enemyItemCount("ENEMY_DAMAGE_REDUCTION")).toBe(30);

    expect(scene.mysteryEncounterSaveData.encounteredEvents.map(e => e.type)).toEqual([
      MysteryEncounterType.VENDING_MACHINE,
      MysteryEncounterType.ALPHA_ENCOUNTER,
    ]);
  }

  /** Start any battle so there is a run to leave for the title screen, then skip the trainer's dialogue */
  async function startAnyBattle(): Promise<void> {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
  }

  it("parses the session save with its fork data intact", () => {
    const session = readSessionFixture();
    expect(session.gameMode).toBe(GameModes.ENDLESS);
    expect(session.waveIndex).toBe(FIXTURE_WAVE);
    expect(session.trainer?.trainerType).toBe(TrainerType.VOLO);
    const [charizard, torkoal, melmetal] = session.party;
    expect(charizard.formIndex).toBe(CHARIZARD_MEGA_Z);
    expect(charizard.moveset[0].transform).toEqual({ kind: "gmax", moveId: MoveId.G_MAX_WILDFIRE });
    expect(torkoal.moveset[0].moveId).toBe(MoveId.SUBLIMATION);
    expect(torkoal.alphaBoost).toBe(15);
    expect(melmetal.moveset[2].transform).toEqual({ kind: "zMax", moveId: MoveId.MAX_SWORDS_DANCE });
    expect(session.modifiers.find(m => m.typeId === "RARE_FORM_CHANGE_ITEM")?.typePregenArgs).toEqual([
      FormChangeItem.CHARIZARDITE_Z,
    ]);
  });

  it("continues the session with the current code, fork data intact", async () => {
    await startAnyBattle();
    await continueSession(readSessionFixture());
    expectFixtureSessionLoaded();
  });

  it("keeps the fork data through a save and another load (load -> save -> load)", async () => {
    await startAnyBattle();
    const original = readSessionFixture();
    await continueSession(original);

    const { gameData } = game.scene;
    const resaved = gameData.parseSessionData(JSON.stringify(gameData.getSessionSaveData(), sessionReplacer));
    expect(forkSessionView(resaved)).toEqual(forkSessionView(readSessionFixture()));

    // The game resets the scene (both modifier lists) on the way to the title screen; ReloadHelper only clears the
    // player's list, so the enemy's tokens would otherwise be added on top of the ones still there
    game.scene.clearEnemyModifiers();
    await continueSession(resaved);
    expectFixtureSessionLoaded();
  });

  // #endregion Session data
});
