import { allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { Button } from "#enums/buttons";
import { Challenges } from "#enums/challenges";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { ShopCursorTarget } from "#enums/shop-cursor-target";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import {
  getMasterTmMoves,
  getMasterTmMovesByType,
  hasMasterTmMove,
  isMasterTmMove,
  MASTER_TM_EXCLUDED_MOVES,
  MASTER_TM_POOL_WEIGHT,
  MASTER_TM_TYPES,
  MasterTmModifier,
} from "#modifiers/custom-consumables";
import { MasterTmModifierType } from "#modifiers/modifier-type";
import { PokemonMove } from "#moves/pokemon-move";
import { isZMaxOnlyMove } from "#moves/zmax-data";
import { GameManager } from "#test/framework/game-manager";
import { MockSprite } from "#test/mocks/mocks-container/mock-sprite";
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import type { ConfirmUiHandler } from "#ui/confirm-ui-handler";
import { getMasterTmMoveLabel, getMasterTmTypeLabel, MASTER_TM_PICKER_ROWS } from "#ui/master-tm-picker";
import type { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import type { OptionSelectUiHandler } from "#ui/option-select-ui-handler";
import type { PartyUiHandler } from "#ui/party-ui-handler";
import { getModifierPoolForType } from "#utils/modifier-utils";
import { readFileSync } from "node:fs";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local fork (2026-11-11): the Master TM (마스터 기술머신). The user: "마스터 기술머신(마스터, 형태는 검은색 기술머신,
 * 로그볼과 비슷한 색조합, 선택 후 소모됨, 선택한 포켓몬에게 "어느 기술이던지" 가르칠 수 있음, 노가드 + 일격기 조합도
 * 가능(어차피 일격기는 보스에게 맞지 않으니까))".
 */
describe("Custom items - Master TM (마스터 기술머신)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  /** UI waits: the reward screen animates for over a second, the party screen fades in */
  const WAIT = { timeout: 15_000, interval: 10 };

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingLevel(100)
      .startingWave(3)
      .disableTrainerWaves()
      .itemRewards([{ name: "MASTER_TM" }])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(5)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .hasPassiveAbility(false)
      .moveset([MoveId.SPLASH]);
    // The harness's sprites have no frame, which the option list measures to make room for the type list's TM icons
    vi.spyOn(MockSprite.prototype, "setTexture").mockImplementation(function (this: MockSprite) {
      this.frame ??= { width: 32, height: 32 };
      return this;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const ui = () => game.scene.ui;
  const rewardHandler = () => ui().handlers[UiMode.MODIFIER_SELECT] as ModifierSelectUiHandler;
  const partyHandler = () => ui().handlers[UiMode.PARTY] as PartyUiHandler;
  const optionHandler = () => ui().handlers[UiMode.OPTION_SELECT] as OptionSelectUiHandler;
  const confirmHandler = () => ui().handlers[UiMode.CONFIRM] as ConfirmUiHandler;
  const optionLabels = () => (optionHandler()["options"] as { label: string }[]).map(o => o.label);
  /** The option the list cursor is on, counting the rows scrolled past */
  const optionIndex = () => optionHandler().getCursor() + optionHandler()["scrollCursor"];
  const cancelLabel = () => i18next.t("menu:cancel");

  /** Win the wave and wait on the reward screen (the Master TM is reward 0) */
  async function toRewardScreen(): Promise<void> {
    game.move.select(MoveId.SPLASH);
    await game.doKillOpponents();
    await game.phaseInterceptor.to("SelectModifierPhase");
    await vi.waitFor(() => {
      expect(ui().mode).toBe(UiMode.MODIFIER_SELECT);
      expect(rewardHandler()["awaitingActionInput"]).toBe(true);
    }, WAIT);
    expect(rewardHandler().options[0].modifierTypeOption.type.id).toBe("MASTER_TM");
  }

  /** Pick the Master TM on the reward screen and wait for the party screen */
  async function pickMasterTm(): Promise<void> {
    const rewards = rewardHandler();
    rewards.setRowCursor(ShopCursorTarget.REWARDS);
    rewards.setCursor(0);
    expect(rewards.processInput(Button.ACTION)).toBe(true);
    await waitForParty();
  }

  async function waitForParty(): Promise<void> {
    await vi.waitFor(() => {
      expect(ui().mode).toBe(UiMode.PARTY);
      expect(partyHandler().active).toBe(true);
    }, WAIT);
  }

  /** On the party screen: party slot `slot`, then "Use" */
  function useOn(slot: number): void {
    const party = partyHandler();
    party.setCursor(slot);
    party.processInput(Button.ACTION); // the Pokémon's options
    party.processInput(Button.ACTION); // Use
  }

  /** Waits for an option list whose labels are `labels` */
  async function waitForList(labels: string[]): Promise<void> {
    await vi.waitFor(() => {
      expect(ui().mode).toBe(UiMode.OPTION_SELECT);
      expect(optionHandler().active).toBe(true);
      expect(optionLabels()).toEqual(labels);
    }, WAIT);
  }

  /** Moves the list cursor down to option `index` (wrapping like a player would) and presses A */
  function choose(index: number): void {
    const handler = optionHandler();
    for (let n = 0; n < optionLabels().length && optionIndex() !== index; n++) {
      handler.processInput(Button.DOWN);
    }
    expect(optionIndex()).toBe(index);
    handler.processInput(Button.ACTION);
  }

  function typeLabels(pokemon: Pokemon): string[] {
    const byType = getMasterTmMovesByType(pokemon);
    return [
      ...MASTER_TM_TYPES.filter(t => byType.has(t)).map(t => getMasterTmTypeLabel(t, byType.get(t)!.length)),
      cancelLabel(),
    ];
  }

  function moveLabels(pokemon: Pokemon, type: PokemonType): string[] {
    const moves = getMasterTmMovesByType(pokemon).get(type) ?? [];
    return [...moves.map(m => getMasterTmMoveLabel(allMoves[m])), cancelLabel()];
  }

  /** From the type list: type `type`, then move `move` (lists checked on the way), stopping at the yes / no question */
  async function chooseTypeAndMove(pokemon: Pokemon, type: PokemonType, move: MoveId): Promise<void> {
    const types = typeLabels(pokemon);
    await waitForList(types);
    choose(types.indexOf(getMasterTmTypeLabel(type, getMasterTmMovesByType(pokemon).get(type)!.length)));
    const moves = moveLabels(pokemon, type);
    await waitForList(moves);
    choose(moves.indexOf(getMasterTmMoveLabel(allMoves[move])));
    await vi.waitFor(() => {
      expect(ui().mode).toBe(UiMode.CONFIRM);
      expect(confirmHandler().active).toBe(true);
    }, WAIT);
  }

  function noMasterTmLeft(): void {
    expect(game.scene.modifiers.some(m => m instanceof MasterTmModifier)).toBe(false);
    const session = game.scene.gameData.getSessionSaveData();
    expect(session.modifiers.some(m => m.typeId === "MASTER_TM")).toBe(false);
  }

  it("is a MASTER-tier reward of weight 2 (6 before 2026-11-12) with the black TM icon and Korean / English text", async () => {
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    const pikachu = game.field.getPlayerPokemon();

    const type = modifierTypes.MASTER_TM();
    expect(type).toBeInstanceOf(MasterTmModifierType);
    expect(type.iconImage).toBe("master_tm");
    const atlas = JSON.parse(readFileSync("./assets/images/items.json", "utf8")).textures[0].frames as {
      filename: string;
      sourceSize: { w: number; h: number };
    }[];
    expect(atlas.find(f => f.filename === "master_tm")?.sourceSize).toEqual({ w: 32, h: 32 });
    const ko = JSON.parse(readFileSync("./locales/ko/modifier-type.json", "utf8")).ModifierType.MASTER_TM;
    const en = JSON.parse(readFileSync("./locales/en/modifier-type.json", "utf8")).ModifierType.MASTER_TM;
    expect(ko.name).toBe("마스터 기술머신");
    expect(en.name).toBe("Master TM");
    for (const text of [ko, en]) {
      expect(text.description).toBeTruthy();
      expect(text.chooseType && text.chooseMove && text.confirmTeach).toBeTruthy();
      expect([...Object.keys(text.category)].sort()).toEqual(["physical", "special", "status"]);
    }

    const entry = getModifierPoolForType(ModifierPoolType.PLAYER)[ModifierTier.MASTER].find(
      w => w.modifierType.id === "MASTER_TM",
    )!;
    expect(entry).toBeDefined();
    expect(entry.maxWeight).toBe(MASTER_TM_POOL_WEIGHT);
    // Local fork (2026-11-12): 6 -> 2 (the user: "마스터 기술머신의 가중치 하락")
    expect(MASTER_TM_POOL_WEIGHT).toBe(2);
    const weight = entry.weight as WeightedModifierTypeWeightFunc;
    expect(weight([pikachu], 0)).toBe(2);
    // a Pokémon that already knows every move it could learn cannot take it, and the reward is left out
    const knowsAll = allMoves.filter(m => isMasterTmMove(m.id)).map(m => new PokemonMove(m.id));
    vi.spyOn(pikachu, "getMoveset").mockReturnValue(knowsAll);
    expect(hasMasterTmMove(pikachu)).toBe(false);
    expect(weight([pikachu], 0)).toBe(0);
    expect((type as MasterTmModifierType).selectFilter?.(pikachu)).toBeTruthy();
  });

  it("can teach any implemented move, signature and one-hit KO moves included; known, unimplemented and internal moves are left out", async () => {
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    const pikachu = game.field.getPlayerPokemon();
    game.move.changeMoveset(pikachu, [MoveId.SPLASH, MoveId.THUNDERBOLT]);

    const moves = getMasterTmMoves(pikachu);
    // one-hit KO moves and other Pokémon's signature moves, none of which Pikachu learns
    for (const move of [
      MoveId.GUILLOTINE,
      MoveId.HORN_DRILL,
      MoveId.FISSURE,
      MoveId.SHEER_COLD,
      MoveId.SPACIAL_REND,
      MoveId.V_CREATE,
      MoveId.DRAGON_ASCENT,
      MoveId.SKETCH,
    ]) {
      expect(moves, MoveId[move]).toContain(move);
    }
    expect(pikachu.getLearnableLevelMoves().some(m => m[1] === MoveId.SPACIAL_REND)).toBe(false);
    // known moves, Struggle / no move, everything marked unimplemented, and (Local fork 2026-11-16) the Z-Moves and
    // Max Moves, now implemented but kept out by `isZMaxOnlyMove`
    for (const move of [
      MoveId.SPLASH,
      MoveId.THUNDERBOLT,
      MoveId.STRUGGLE,
      MoveId.NONE,
      MoveId.BREAKNECK_BLITZ__PHYSICAL,
      MoveId.CATASTROPIKA,
      MoveId.MAX_FLARE,
      MoveId.MAX_GUARD,
      MoveId.G_MAX_MELTDOWN,
      MoveId.MAX_SWORDS_DANCE,
    ]) {
      expect(moves, MoveId[move]).not.toContain(move);
    }
    expect(MASTER_TM_EXCLUDED_MOVES).toEqual(new Set([MoveId.NONE, MoveId.STRUGGLE]));
    expect(allMoves.filter(m => m.isUnimplemented).every(m => !moves.includes(m.id))).toBe(true);
    const implemented = allMoves.filter(
      m => !m.isUnimplemented && !MASTER_TM_EXCLUDED_MOVES.has(m.id) && !isZMaxOnlyMove(m.id),
    );
    expect(moves).toHaveLength(implemented.length - 2);

    // by type: every move under its own type, all 18 types used, each list in name order
    const byType = getMasterTmMovesByType(pikachu);
    expect([...byType.keys()].sort((a, b) => a - b)).toEqual([...MASTER_TM_TYPES].sort((a, b) => a - b));
    expect([...byType.values()].flat().sort((a, b) => a - b)).toEqual(moves);
    const collator = new Intl.Collator(i18next.language);
    for (const [type, list] of byType) {
      expect(list.every(m => allMoves[m].type === type)).toBe(true);
      const names = list.map(m => allMoves[m].name);
      expect(names).toEqual([...names].sort(collator.compare));
    }
    expect(getMasterTmMoveLabel(allMoves[MoveId.GUILLOTINE])).toBe("Guillotine  Phys. 250 30%");
    expect(getMasterTmMoveLabel(allMoves[MoveId.SWORDS_DANCE])).toBe("Swords Dance  Status");
    expect(getMasterTmMoveLabel(allMoves[MoveId.AERIAL_ACE])).toBe("Aerial Ace  Phys. 60");
    expect(getMasterTmTypeLabel(PokemonType.FIRE, 7)).toBe("Fire (7)");
  });

  // Local fork (2026-11-11), after review: the item must not be spent on a move the run never lets the player use
  it("leaves out the moves a challenge forbids the player: Revival Blessing in Hardcore", async () => {
    expect(isMasterTmMove(MoveId.REVIVAL_BLESSING)).toBe(true); // no challenge yet
    game.challengeMode.addChallenge(Challenges.HARDCORE, 1, 1);
    await game.challengeMode.startBattle(SpeciesId.PIKACHU);
    const pikachu = game.field.getPlayerPokemon();

    expect(isMasterTmMove(MoveId.REVIVAL_BLESSING)).toBe(false);
    const moves = getMasterTmMoves(pikachu);
    expect(moves).not.toContain(MoveId.REVIVAL_BLESSING);
    expect(moves).toContain(MoveId.GUILLOTINE);
    expect(getMasterTmMovesByType(pikachu).get(PokemonType.NORMAL)).not.toContain(MoveId.REVIVAL_BLESSING);
  });

  it("goes reward -> party -> the 18 types -> that type's moves -> yes, teaches a one-hit KO move, and is used up", async () => {
    await game.classicMode.startBattle(SpeciesId.PIKACHU, SpeciesId.SNORLAX);
    const pikachu = game.field.getPlayerPokemon();
    game.move.changeMoveset(pikachu, [MoveId.SPLASH, MoveId.THUNDERBOLT]);

    await toRewardScreen();
    await pickMasterTm();
    useOn(0);

    // 18 types with their TM icon and move count, then Cancel; 8 rows at a time
    const types = typeLabels(pikachu);
    await waitForList(types);
    expect(types).toHaveLength(19);
    expect(types[0]).toBe(
      getMasterTmTypeLabel(PokemonType.NORMAL, getMasterTmMovesByType(pikachu).get(PokemonType.NORMAL)!.length),
    );
    expect(optionHandler()["maxOptions"]).toBe(MASTER_TM_PICKER_ROWS);
    const icons = (optionHandler()["options"] as { iconsConfig?: { frame: string }[] }[]).map(
      o => o.iconsConfig?.[0]?.frame,
    );
    expect(icons.slice(0, 18)).toEqual(MASTER_TM_TYPES.map(t => `tm_${PokemonType[t].toLowerCase()}`));

    // Normal: its moves in name order, Splash (known) left out
    choose(0);
    const normal = moveLabels(pikachu, PokemonType.NORMAL);
    await waitForList(normal);
    expect(normal).not.toContain(getMasterTmMoveLabel(allMoves[MoveId.SPLASH]));
    expect(normal.at(-1)).toBe(cancelLabel());
    // left / right turn a page of 8
    optionHandler().processInput(Button.RIGHT);
    expect(optionIndex()).toBe(MASTER_TM_PICKER_ROWS);
    optionHandler().processInput(Button.RIGHT);
    expect(optionIndex()).toBe(2 * MASTER_TM_PICKER_ROWS);
    optionHandler().processInput(Button.LEFT);
    optionHandler().processInput(Button.LEFT);
    expect(optionIndex()).toBe(0);
    choose(normal.indexOf(getMasterTmMoveLabel(allMoves[MoveId.GUILLOTINE])));
    await vi.waitFor(() => expect(ui().mode).toBe(UiMode.CONFIRM), WAIT);
    // nothing is made before yes
    expect(game.isCurrentPhase("SelectModifierPhase")).toBe(true);
    noMasterTmLeft();

    confirmHandler().processInput(Button.ACTION); // yes
    await game.phaseInterceptor.to("LearnMovePhase");

    expect(pikachu.getMoveset().map(m => m.moveId)).toEqual([MoveId.SPLASH, MoveId.THUNDERBOLT, MoveId.GUILLOTINE]);
    // learned like a TM: a Memory Mushroom can bring it back, and the reward screen does not come back
    expect(pikachu.usedTMs).toContain(MoveId.GUILLOTINE);
    expect(game.scene.phaseManager.hasPhaseOfType("SelectModifierPhase")).toBe(false);
    noMasterTmLeft();
    const saved = game.scene.gameData.getSessionSaveData().party[0];
    expect(saved.moveset.map(m => m.moveId)).toContain(MoveId.GUILLOTINE);
  });

  it("with four moves goes through the normal forget flow and replaces the chosen move with a signature move", async () => {
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    const pikachu = game.field.getPlayerPokemon();
    const before = [MoveId.SPLASH, MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL];
    game.move.changeMoveset(pikachu, before);

    await toRewardScreen();
    await pickMasterTm();
    useOn(0);
    await chooseTypeAndMove(pikachu, PokemonType.DRAGON, MoveId.SPACIAL_REND);
    confirmHandler().processInput(Button.ACTION); // yes

    game.onNextPrompt("LearnMovePhase", UiMode.CONFIRM, () => {
      ui().processInput(Button.ACTION); // forget a move? yes
    });
    game.onNextPrompt("LearnMovePhase", UiMode.SUMMARY, () => {
      ui().setCursor(2); // Quick Attack
      ui().processInput(Button.ACTION);
    });
    await game.phaseInterceptor.to("LearnMovePhase");

    expect(pikachu.getMoveset().map(m => m.moveId)).toEqual([
      MoveId.SPLASH,
      MoveId.THUNDERBOLT,
      MoveId.SPACIAL_REND,
      MoveId.IRON_TAIL,
    ]);
    expect(game.scene.phaseManager.hasPhaseOfType("SelectModifierPhase")).toBe(false);
    noMasterTmLeft();
  });

  it("stopping the lesson at the forget prompt returns to the reward screen with the Master TM still offered", async () => {
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    const pikachu = game.field.getPlayerPokemon();
    const before = [MoveId.SPLASH, MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK, MoveId.IRON_TAIL];
    game.move.changeMoveset(pikachu, before);

    await toRewardScreen();
    await pickMasterTm();
    useOn(0);
    await chooseTypeAndMove(pikachu, PokemonType.GROUND, MoveId.FISSURE);
    confirmHandler().processInput(Button.ACTION); // yes

    game.onNextPrompt("LearnMovePhase", UiMode.CONFIRM, () => {
      ui().processInput(Button.CANCEL); // forget a move? no
    });
    game.onNextPrompt("LearnMovePhase", UiMode.CONFIRM, () => {
      ui().processInput(Button.ACTION); // stop teaching? yes
    });
    await game.phaseInterceptor.to("LearnMovePhase");

    expect(pikachu.getMoveset().map(m => m.moveId)).toEqual(before);
    expect(pikachu.usedTMs).not.toContain(MoveId.FISSURE);
    await game.phaseInterceptor.to("SelectModifierPhase");
    await vi.waitFor(() => expect(ui().mode).toBe(UiMode.MODIFIER_SELECT), WAIT);
    expect(rewardHandler().options[0].modifierTypeOption.type.id).toBe("MASTER_TM");
    noMasterTmLeft();
  });

  it("steps back one level at a time with the cursor kept; cancelling the party screen returns to the rewards with nothing used", async () => {
    await game.classicMode.startBattle(SpeciesId.PIKACHU, SpeciesId.SNORLAX);
    const [pikachu, snorlax] = game.scene.getPlayerParty() as PlayerPokemon[];
    game.move.changeMoveset(pikachu, [MoveId.SPLASH]);
    game.move.changeMoveset(snorlax, [MoveId.SPLASH]);

    await toRewardScreen();
    await pickMasterTm();

    // Snorlax -> types -> back to the party, on Snorlax
    useOn(1);
    await waitForList(typeLabels(snorlax));
    optionHandler().processInput(Button.CANCEL);
    await waitForParty();
    expect(partyHandler().getCursor()).toBe(1);

    // again: Snorlax -> Ice (far down the list) -> Sheer Cold -> no -> back on Sheer Cold -> back on Ice
    useOn(1);
    const types = typeLabels(snorlax);
    await waitForList(types);
    const ice = types.indexOf(
      getMasterTmTypeLabel(PokemonType.ICE, getMasterTmMovesByType(snorlax).get(PokemonType.ICE)!.length),
    );
    choose(ice);
    const iceMoves = moveLabels(snorlax, PokemonType.ICE);
    await waitForList(iceMoves);
    const sheerCold = iceMoves.indexOf(getMasterTmMoveLabel(allMoves[MoveId.SHEER_COLD]));
    choose(sheerCold);
    await vi.waitFor(() => expect(ui().mode).toBe(UiMode.CONFIRM), WAIT);
    confirmHandler().processInput(Button.CANCEL); // no
    await waitForList(iceMoves);
    expect(optionIndex()).toBe(sheerCold);
    optionHandler().processInput(Button.CANCEL); // back to the types
    await waitForList(types);
    expect(optionIndex()).toBe(ice);
    expect(optionHandler()["scrollCursor"]).toBeGreaterThan(0);

    // back to the party, then out of it: the same rewards, nothing taught or added
    optionHandler().processInput(Button.CANCEL);
    await waitForParty();
    partyHandler().processInput(Button.CANCEL);
    await vi.waitFor(() => {
      expect(ui().mode).toBe(UiMode.MODIFIER_SELECT);
      expect(rewardHandler()["awaitingActionInput"]).toBe(true);
    }, WAIT);
    expect(game.isCurrentPhase("SelectModifierPhase")).toBe(true);
    expect(rewardHandler().options[0].modifierTypeOption.type.id).toBe("MASTER_TM");
    expect(pikachu.getMoveset().map(m => m.moveId)).toEqual([MoveId.SPLASH]);
    expect(snorlax.getMoveset().map(m => m.moveId)).toEqual([MoveId.SPLASH]);
    expect(snorlax.usedTMs).toEqual([]);
    noMasterTmLeft();
  });

  // The user's premise for allowing No Guard + one-hit KO moves; the rule itself is the game's (OneHitKOAttr)
  it("confirms the existing rule: a one-hit KO move never knocks out a boss, even with No Guard", async () => {
    game.override
      .ability(AbilityId.NO_GUARD)
      .moveset([MoveId.GUILLOTINE])
      .criticalHits(false)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyLevel(100)
      .enemyHealthSegments(3);
    await game.classicMode.startBattle(SpeciesId.KINGLER);
    const boss = game.field.getEnemyPokemon();
    expect(boss.isBoss()).toBe(true);

    game.move.select(MoveId.GUILLOTINE);
    await game.phaseInterceptor.to("TurnEndPhase");

    // No Guard makes it hit, but it lands as an ordinary attack instead of a knockout
    expect(boss.isFainted()).toBe(false);
    expect(boss.hp).toBeGreaterThan(0);
    expect(boss.hp).toBeLessThan(boss.getMaxHp());
  });

  it("gives a No Guard user's one-hit KO moves 150 power against a boss, and keeps 250 otherwise", async () => {
    // Local fork (2026-11-11), the user: "노가드 포켓몬 + 일격기 포켓몬 으로 더블배틀을 할 때는 제외하고 노가드 포켓몬이
    // 일격기를 가질 경우에는 위력을 150정도로 조정하도록 하죠" (NoGuardOneHitKOPowerAttr)
    game.override
      .ability(AbilityId.NO_GUARD)
      .moveset([MoveId.GUILLOTINE])
      .criticalHits(false)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyLevel(100)
      .enemyHealthSegments(3);
    await game.classicMode.startBattle(SpeciesId.KINGLER);
    const kingler = game.field.getPlayerPokemon();
    const boss = game.field.getEnemyPokemon();
    const power = (moveId: MoveId) => allMoves[moveId].calculateBattlePower(kingler, boss, true);
    const ohkoMoves = [MoveId.GUILLOTINE, MoveId.HORN_DRILL, MoveId.FISSURE, MoveId.SHEER_COLD];
    expect(ohkoMoves.map(power)).toEqual([150, 150, 150, 150]);

    // A user without No Guard of its own (a double-battle ally's No Guard does not count) keeps 250
    const noGuard = vi.spyOn(kingler, "hasAbilityWithAttr").mockReturnValue(false);
    expect(ohkoMoves.map(power)).toEqual([250, 250, 250, 250]);
    noGuard.mockRestore();

    // A target it can knock out is unaffected (the move knocks it out anyway)
    vi.spyOn(boss, "isBossImmune").mockReturnValue(false);
    expect(power(MoveId.GUILLOTINE)).toBe(250);
  });
});
