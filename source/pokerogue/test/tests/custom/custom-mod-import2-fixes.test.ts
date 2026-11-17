// Local fork (2026-11-17): the second import of the pokerogue_mod repository (worn marks, the mark Pokédex, the Endless
// raid, the Mark Charm ...) and what its integration review fixed:
// 1. the raid's Terastallized boss could also take a Mega / Max / Primal battle form;
// 2. a retried or reloaded raid did not clear stat changes at the HP thresholds again;
// 3. Fresh Start's starter took its saved worn mark along once the Pokédex page had been opened and closed;
// 4. Pikachu (a starter whose line's root is Pichu) could never wear a mark, and counted as a line of its own in the
//    mark Pokédex, where nothing but the Perfect IV Mark ever reaches it;
// 5. the Eternatus Mark's achievement did not unlock when Eternatus itself was the last catch;
// 6. a mark obtained before the lines kept their own collections was "???" in the mark Pokédex.

import { speciesDataRegistry } from "#app/global-species-data-registry";
import { FORK_UNLOCK } from "#balance/fork-unlock";
import { canTakeBattleForm } from "#data/enemy-battle-forms";
import { applyRaidTurnEnd, ENDLESS_RAID_WAVE, isRaidBoss } from "#data/endless-raid";
import { getGameMode } from "#app/game-mode";
import { BattleType } from "#enums/battle-type";
import { Challenges } from "#enums/challenges";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { PokemonMark } from "#enums/pokemon-mark";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { TrainerSlot } from "#enums/trainer-slot";
import { UiMode } from "#enums/ui-mode";
import { EnemyPokemon } from "#field/pokemon";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { achvs } from "#system/achv";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import type { StarterSpeciesId } from "#types/starter-species-id";
import type { MarkDexUiHandler } from "#ui/mark-dex-ui-handler";
import type { StarterSelectUiHandler } from "#ui/starter-select-ui-handler";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Local fork - second mod import: review fixes", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.criticalHits(false).moveset([MoveId.SPLASH]).enemyMoveset(MoveId.SPLASH);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("gives a Terastallized Pokémon no battle form", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    // Built directly: `addEnemyPokemon` would swap in the test's enemy species override
    const charizard = new EnemyPokemon(speciesDataRegistry.getSpecies(SpeciesId.CHARIZARD), 80, TrainerSlot.NONE, true);
    expect(canTakeBattleForm(charizard)).toBe(true);
    charizard.isTerastallized = true;
    expect(canTakeBattleForm(charizard)).toBe(false);
    charizard.destroy();
  });

  it("clears stat changes at every threshold again when the raid boss comes back from the save", async () => {
    game.override.startingWave(ENDLESS_RAID_WAVE).seed("raid").mysteryEncounterChance(100);
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.ENDLESS);
      game.scene.offsetGym = false;
      const starters = generateStarters(game.scene, [SpeciesId.GARCHOMP, SpeciesId.MILOTIC]);
      game.scene.setSeed("raid");
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    vi.spyOn(game.scene.ui, "shouldSkipDialogue").mockReturnValue(true);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await game.phaseInterceptor.to("CommandPhase", false);

    const boss = game.scene.getEnemyParty()[0];
    expect(isRaidBoss(boss)).toBe(true);
    // The boss' own battle forms stay off: it is Terastallized
    expect(canTakeBattleForm(boss)).toBe(false);
    const [player] = game.scene.getPlayerField();
    boss.hp = Math.floor(boss.getMaxHp() * 0.2);
    player.setStatStage(Stat.ATK, 4);
    applyRaidTurnEnd(boss);
    expect(player.getStatStage(Stat.ATK)).toBe(0);

    // A retry or a session loaded in the same window: the same id, at the wave's start
    const reloaded = new PokemonData(boss).toPokemon(BattleType.WILD, 0, true) as EnemyPokemon;
    expect(reloaded.id).toBe(boss.id);
    expect(isRaidBoss(reloaded)).toBe(true);
    reloaded.hp = Math.floor(reloaded.getMaxHp() * 0.7);
    player.setStatStage(Stat.ATK, 4);
    applyRaidTurnEnd(reloaded);
    expect(player.getStatStage(Stat.ATK)).toBe(0);
    reloaded.destroy();
  });

  /** The starter select at the title, with Pichu's line wearing a mark; `getWornMark` is what a starter is given */
  async function starterSelect(freshStart: boolean): Promise<(id: SpeciesId) => PokemonMark | undefined> {
    if (freshStart) {
      game.challengeMode.addChallenge(Challenges.FRESH_START, 1, 1);
    }
    await game.runToTitle();
    if (game.challengeMode.challenges.length > 0) {
      game.scene.gameMode.challenges = game.challengeMode.challenges;
    }
    const { starterData } = game.scene.gameData;
    starterData[SpeciesId.PICHU].marks = [PokemonMark.RARE_MARK];
    starterData[SpeciesId.PICHU].equippedMark = PokemonMark.RARE_MARK;
    starterData[SpeciesId.PIKACHU].marks = [PokemonMark.PERFECT_IV_MARK];
    starterData[SpeciesId.PIKACHU].equippedMark = undefined;
    const handler = game.scene.ui.handlers[UiMode.STARTER_SELECT] as StarterSelectUiHandler;
    return id => handler["getWornMark"](id as StarterSpeciesId);
  }

  it("lets Pikachu wear its line's mark, kept with Pichu's collection", async () => {
    expect(speciesDataRegistry.getSpecies(SpeciesId.PIKACHU).getRootSpeciesId()).toBe(SpeciesId.PICHU);
    const getWornMark = await starterSelect(false);
    expect(getWornMark(SpeciesId.PIKACHU)).toBe(PokemonMark.RARE_MARK);
    expect(getWornMark(SpeciesId.PICHU)).toBe(PokemonMark.RARE_MARK);
  });

  it("takes the worn mark away in Fresh Start, however the starter was added", async () => {
    const getWornMark = await starterSelect(true);
    expect(getWornMark(SpeciesId.PICHU)).toBeUndefined();
    expect(getWornMark(SpeciesId.PIKACHU)).toBeUndefined();
    // The save keeps it
    expect(game.scene.gameData.starterData[SpeciesId.PICHU].equippedMark).toBe(PokemonMark.RARE_MARK);
  });

  it("counts Pikachu in Pichu's line in the mark Pokédex, and a mark obtained before the line collections", async () => {
    await game.runToTitle();
    const { gameData } = game.scene;
    const handler = game.scene.ui.handlers[UiMode.MARK_DEX] as MarkDexUiHandler;
    handler["readCollection"]();
    const ids: number[] = handler["starterIds"];
    expect(ids).toContain(SpeciesId.PICHU);
    expect(ids).not.toContain(SpeciesId.PIKACHU);
    expect(ids.every(id => !speciesDataRegistry.hasPrevolution(id))).toBe(true);

    // Counted in markCounts by the earlier build, on no line
    const mark = PokemonMark.ROWDY_MARK;
    for (const entry of Object.values(gameData.starterData)) {
      entry.marks = [];
    }
    gameData.markCounts[mark] = 1;
    // The test scene's images have no tint mode
    for (const cell of [...handler["listedCells"], ...handler["hiddenCells"]]) {
      cell.base.setTintMode ??= () => cell.base;
    }
    handler["readCollection"]();
    handler["updateMarkCells"]();
    expect(handler["isObtained"](mark)).toBe(true);
    delete gameData.markCounts[mark];
    handler["readCollection"]();
    handler["updateMarkCells"]();
    expect(handler["isObtained"](mark)).toBe(false);
  });

  it("unlocks the Eternatus Mark's achievement with the catch of Eternatus itself", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    const { gameData } = game.scene;
    for (const id of Object.keys(gameData.starterData).map(Number)) {
      gameData.dexData[id as SpeciesId].caughtAttr = 1n;
    }
    gameData.dexData[SpeciesId.ETERNATUS].caughtAttr = 0n;
    delete gameData.achvUnlocks[achvs.ETERNATUS_MARK.id];
    const eternatus = new EnemyPokemon(speciesDataRegistry.getSpecies(SpeciesId.ETERNATUS), 60, TrainerSlot.NONE, false);
    eternatus.marks = [];
    await gameData.setPokemonCaught(eternatus, true, false, false);
    expect(gameData.dexData[SpeciesId.ETERNATUS].caughtAttr).not.toBe(0n);
    expect(Object.hasOwn(gameData.achvUnlocks, achvs.ETERNATUS_MARK.id)).toBe(true);
    eternatus.destroy();
  });

  it("keeps the Mark Charm out of the reward pools until the first Classic clear", () => {
    expect(FORK_UNLOCK.gatedItems.has("MARK_CHARM")).toBe(true);
  });
});
