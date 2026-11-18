/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { speciesDataRegistry } from "#app/global-species-data-registry";
import { getPokemonNameWithAffix } from "#app/messages";
import { modifierTypes } from "#data/data-lists";
import { getLevelTotalExp } from "#data/exp";
import { SpeciesFormChangeItemTrigger } from "#data/form-change-triggers";
import { DYNAMAX_HP_MULTIPLIER } from "#data/pokemon-forms-dynamax";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { FormChangeItem } from "#enums/form-change-item";
import { MoveId } from "#enums/move-id";
import { PartyUiMode } from "#enums/party-ui-mode";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { TrainerSlot } from "#enums/trainer-slot";
import { UiMode } from "#enums/ui-mode";
import { EnemyPokemon, type PlayerPokemon, type Pokemon } from "#field/pokemon";
import type { PokemonFormChangeItemModifier } from "#modifiers/modifier";
import { type FormChangeItemModifierType, ZCrystalModifierType } from "#modifiers/modifier-type";
import { getDynamaxCandyWeight, ZMAX_REWARD_RULES } from "#modifiers/zmax-items";
import { generateModifierType } from "#mystery-encounters/encounter-phase-utils";
import { achvs } from "#system/achv";
import { GameManager } from "#test/framework/game-manager";
import { PartyOption, PartyUiHandler } from "#ui/party-ui-handler";
import { canSpeciesTera, isPlayerTeraBlockedForm, isTeraBlockedForm } from "#utils/pokemon-utils";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local fork (2026-11-18): Dynamax without a G-Max form and Mega + Dynamax for the player (pokemon-forms-dynamax.ts).
 * The user: "거다이맥스 아니어도 다이맥스 가능하게(특성과 패시브는 유지)해보죠 / 메가몬도 다이맥스 가능하게 해서 메가 + 다이맥스 +
 * z기술 + 테라스탈 같은 조합도 가능하게 해보고".
 */
describe("Local fork - the Dynamax state (2026-11-18)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .startingLevel(50)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH, MoveId.DRAGON_CLAW, MoveId.AIR_SLASH, MoveId.SURF]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A form-change item for `pokemon` as the reward screen makes it (type id and tier, so a save keeps it), active */
  function formItem(pokemon: Pokemon, item: FormChangeItem): PokemonFormChangeItemModifier {
    const type = generateModifierType(modifierTypes.RARE_FORM_CHANGE_ITEM, [item]) as FormChangeItemModifierType;
    expect(type.formChangeItem).toBe(item);
    return type.newModifier(pokemon) as PokemonFormChangeItemModifier;
  }

  /** Give `pokemon` the form-change item `item` (as the reward screen does) and return it */
  function give(pokemon: Pokemon, item: FormChangeItem): PokemonFormChangeItemModifier {
    const modifier = formItem(pokemon, item);
    game.scene.addModifier(modifier);
    return modifier;
  }

  /** Play a turn of Splash so the queued form changes run */
  async function runTurn(): Promise<void> {
    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();
  }

  function ensureTeraOrb(): void {
    if (!game.scene.findModifier(m => m.is("TerastallizeAccessModifier"))) {
      game.scene.addModifier(modifierTypes.TERA_ORB().newModifier()!);
    }
  }

  it("Max Mushrooms on a species without a G-Max form: the Dynamax state, same form, ability and passive, HP x1.5, scale 1.5", async () => {
    await game.classicMode.startBattle(SpeciesId.MILOTIC);
    const milotic = game.field.getPlayerPokemon();
    expect(speciesDataRegistry.hasFormChanges(SpeciesId.MILOTIC)).toBe(false);
    const before = {
      formIndex: milotic.formIndex,
      abilityIndex: milotic.abilityIndex,
      ability: milotic.getAbility().id,
      passive: milotic.getPassiveAbility().id,
      maxHp: milotic.getMaxHp(),
      atk: milotic.getStat(Stat.ATK),
      scale: milotic.getSpriteScale(),
    };
    milotic.hp = Math.floor(before.maxHp / 2) + 1;
    const hpBefore = milotic.hp;
    const fieldScale = vi.spyOn(game.scene, "updateFieldScale");
    delete game.scene.gameData.achvUnlocks[achvs.GIGANTAMAX.id];

    give(milotic, FormChangeItem.MAX_MUSHROOMS);

    expect(milotic.hasDynamaxState()).toBe(true);
    expect(milotic.isDynamaxed()).toBe(true);
    expect(milotic.isMax()).toBe(false);
    expect(milotic.formIndex).toBe(before.formIndex);
    expect(milotic.abilityIndex).toBe(before.abilityIndex);
    expect(milotic.getAbility().id).toBe(before.ability);
    expect(milotic.getPassiveAbility().id).toBe(before.passive);
    expect(milotic.getMaxHp()).toBe(Math.floor(before.maxHp * DYNAMAX_HP_MULTIPLIER));
    expect(milotic.getStat(Stat.ATK)).toBe(before.atk);
    // the current HP keeps its ratio
    expect(milotic.hp).toBe(Math.round((hpBefore * milotic.getMaxHp()) / before.maxHp));
    expect(milotic.getSpriteScale()).toBeCloseTo(before.scale * 1.5);
    expect(milotic.scaleX).toBeCloseTo(milotic.getSpriteScale());
    expect(fieldScale).toHaveBeenCalled();
    expect(game.scene.gameData.achvUnlocks).toHaveProperty(achvs.GIGANTAMAX.id);

    // no form change comes
    await runTurn();
    expect(game.phaseInterceptor.phaseLog).not.toContain("FormChangePhase");
    expect(milotic.formIndex).toBe(before.formIndex);
    expect(milotic.hasDynamaxState()).toBe(true);
    expect(milotic.getMaxHp()).toBe(Math.floor(before.maxHp * DYNAMAX_HP_MULTIPLIER));
  });

  it("a G-Max species in its base form still takes its G-Max form with the mushrooms, not the state", async () => {
    await game.classicMode.startBattle(SpeciesId.CHARIZARD);
    const charizard = game.field.getPlayerPokemon();
    give(charizard, FormChangeItem.MAX_MUSHROOMS);
    await runTurn();

    expect(game.phaseInterceptor.phaseLog).toContain("FormChangePhase");
    expect(charizard.getFormKey()).toBe(SpeciesFormKey.GIGANTAMAX);
    expect(charizard.isMax()).toBe(true);
    expect(charizard.hasDynamaxState()).toBe(false);
    expect(charizard.isDynamaxed()).toBe(true);
    expect(charizard.getSpriteScale()).toBe(1.5);
    expect(charizard.hp).toBeLessThanOrEqual(charizard.getMaxHp());
  });

  it("Mega + Dynamax: Mega Charizard X and Mega Garchomp take the mushrooms as the Dynamax state, staying Mega", async () => {
    await game.classicMode.startBattle(SpeciesId.CHARIZARD, SpeciesId.GARCHOMP);
    const [charizard, garchomp] = game.scene.getPlayerParty();
    give(charizard, FormChangeItem.CHARIZARDITE_X);
    give(garchomp, FormChangeItem.GARCHOMPITE);
    await runTurn();
    expect(charizard.getFormKey()).toBe(SpeciesFormKey.MEGA_X);
    expect(garchomp.getFormKey()).toBe(SpeciesFormKey.MEGA);
    const megaMaxHp = [charizard.getMaxHp(), garchomp.getMaxHp()];
    const megaAbilities = [charizard.getAbility().id, garchomp.getAbility().id];

    give(charizard, FormChangeItem.MAX_MUSHROOMS);
    give(garchomp, FormChangeItem.MAX_MUSHROOMS);
    for (const [i, pokemon] of [charizard, garchomp].entries()) {
      expect(pokemon.isMega()).toBe(true);
      expect(pokemon.hasDynamaxState()).toBe(true);
      expect(pokemon.isDynamaxed()).toBe(true);
      expect(pokemon.getMaxHp()).toBe(Math.floor(megaMaxHp[i] * DYNAMAX_HP_MULTIPLIER));
      expect(pokemon.getAbility().id).toBe(megaAbilities[i]);
      expect(pokemon.getSpriteScale()).toBe(1.5);
    }

    // no form change: both stay Mega (the stone comes first, the G-Max form only without it)
    await runTurn();
    expect(charizard.getFormKey()).toBe(SpeciesFormKey.MEGA_X);
    expect(garchomp.getFormKey()).toBe(SpeciesFormKey.MEGA);
    expect(charizard.hasDynamaxState()).toBe(true);

    // the party menu lists the mushrooms beside the active stone (and only the active stone of the others)
    give(charizard, FormChangeItem.CHARIZARDITE_Y).active = false;
    const partyHandler = game.scene.ui.handlers[UiMode.PARTY] as PartyUiHandler;
    expect(partyHandler.getFormChangeItemsModifiers(charizard).map(m => m.formChangeItem)).toEqual([
      FormChangeItem.CHARIZARDITE_X,
      FormChangeItem.MAX_MUSHROOMS,
    ]);
  });

  it("switches the stone and the mushrooms independently: Mega X + Dynamax <-> G-Max, mushrooms off -> Mega X", async () => {
    await game.classicMode.startBattle(SpeciesId.CHARIZARD);
    const charizard = game.field.getPlayerPokemon();
    const stone = give(charizard, FormChangeItem.CHARIZARDITE_X);
    await runTurn();
    const mushrooms = give(charizard, FormChangeItem.MAX_MUSHROOMS);
    expect(charizard.getFormKey()).toBe(SpeciesFormKey.MEGA_X);
    expect(charizard.hasDynamaxState()).toBe(true);

    // stone off: straight to the G-Max form (the mushrooms are still active)
    stone.active = false;
    expect(game.scene.triggerPokemonFormChange(charizard, SpeciesFormChangeItemTrigger)).toBe(true);
    await runTurn();
    expect(charizard.getFormKey()).toBe(SpeciesFormKey.GIGANTAMAX);
    expect(charizard.hasDynamaxState()).toBe(false);
    expect(charizard.isDynamaxed()).toBe(true);
    // the party menu now lists both stones' rule (none active: all of them) and the mushrooms
    const partyHandler = game.scene.ui.handlers[UiMode.PARTY] as PartyUiHandler;
    expect(partyHandler.getFormChangeItemsModifiers(charizard)).toEqual([stone, mushrooms]);

    // stone on again, on the G-Max form: Mega X + the Dynamax state
    stone.active = true;
    expect(game.scene.triggerPokemonFormChange(charizard, SpeciesFormChangeItemTrigger)).toBe(true);
    await runTurn();
    expect(charizard.getFormKey()).toBe(SpeciesFormKey.MEGA_X);
    expect(charizard.hasDynamaxState()).toBe(true);
    const dynamaxMaxHp = charizard.getMaxHp();

    // mushrooms off: no form change, the state ends, the current HP keeps its ratio
    charizard.hp = Math.floor(dynamaxMaxHp * 0.75);
    const hp = charizard.hp;
    mushrooms.active = false;
    expect(game.scene.triggerPokemonFormChange(charizard, SpeciesFormChangeItemTrigger)).toBe(false);
    charizard.calculateStats();
    expect(charizard.getFormKey()).toBe(SpeciesFormKey.MEGA_X);
    expect(charizard.hasDynamaxState()).toBe(false);
    expect(charizard.isDynamaxed()).toBe(false);
    expect(charizard.getMaxHp()).toBeLessThan(dynamaxMaxHp);
    expect(charizard.hp).toBe(Math.round((hp * charizard.getMaxHp()) / dynamaxMaxHp));

    // mushrooms on and off again: back where it was, nothing healed
    const plainHp = charizard.hp;
    mushrooms.active = true;
    charizard.calculateStats();
    mushrooms.active = false;
    charizard.calculateStats();
    expect(charizard.hp).toBe(plainHp);
  });

  it("switches the mushrooms on the reward screen's party menu: the state ends and starts with a message", async () => {
    game.override.battleType(BattleType.WILD).enemySpecies(SpeciesId.MAGIKARP);
    await game.classicMode.startBattle(SpeciesId.MILOTIC);
    const milotic = game.field.getPlayerPokemon() as PlayerPokemon;
    give(milotic, FormChangeItem.MAX_MUSHROOMS);
    const dynamaxMaxHp = milotic.getMaxHp();
    milotic.hp = Math.floor(dynamaxMaxHp / 3);
    const hp = milotic.hp;
    game.move.select(MoveId.SPLASH);
    await game.doKillOpponents();
    await game.phaseInterceptor.to("SelectModifierPhase");

    await game.scene.ui.setModeWithoutClear(UiMode.PARTY, PartyUiMode.CHECK);
    const partyHandler = game.scene.ui.getHandler() as PartyUiHandler;
    partyHandler.setCursor(0);
    const showText = vi.spyOn(partyHandler, "showText");
    expect(partyHandler.getFormChangeItemsModifiers(milotic).map(m => m.formChangeItem)).toEqual([
      FormChangeItem.MAX_MUSHROOMS,
    ]);

    // off
    expect(partyHandler["processActionButtonForOptions"](PartyOption.FORM_CHANGE_ITEM)).toBe(true);
    expect(milotic.hasDynamaxState()).toBe(false);
    expect(milotic.getMaxHp()).toBeLessThan(dynamaxMaxHp);
    expect(milotic.hp).toBe(Math.round((hp * milotic.getMaxHp()) / dynamaxMaxHp));
    expect(milotic.getSpriteScale()).toBe(1);
    expect(showText.mock.calls.at(-1)?.[0]).toBe(
      i18next.t("battlePokemonForm:dynamaxEnd", { pokemonName: getPokemonNameWithAffix(milotic, false) }),
    );

    // on again
    expect(partyHandler["processActionButtonForOptions"](PartyOption.FORM_CHANGE_ITEM)).toBe(true);
    expect(milotic.hasDynamaxState()).toBe(true);
    expect(milotic.getMaxHp()).toBe(dynamaxMaxHp);
    expect(Math.abs(milotic.hp - hp)).toBeLessThanOrEqual(1);
    expect(milotic.getSpriteScale()).toBe(1.5);
    expect(showText.mock.calls.at(-1)?.[0]).toBe(
      i18next.t("battlePokemonForm:dynamaxChange", { pokemonName: getPokemonNameWithAffix(milotic, false) }),
    );
  });

  it("offers Max Mushrooms to a species without a G-Max form only with the Dynamax Band, and not to a holder", async () => {
    await game.classicMode.startBattle(SpeciesId.MILOTIC);
    const milotic = game.field.getPlayerPokemon() as PlayerPokemon;
    const party = game.scene.getPlayerParty();
    const generator = modifierTypes.RARE_FORM_CHANGE_ITEM();
    for (const band of game.scene.findModifiers(m => m.is("GigantamaxAccessModifier"))) {
      game.scene.removeModifier(band);
    }
    expect(generator.generateType(party)).toBeNull();
    expect(milotic.isFormChangeItemCompatible(FormChangeItem.MAX_MUSHROOMS)).toBe(true);

    game.scene.addModifier(modifierTypes.DYNAMAX_BAND().newModifier()!);
    const offered = generator.generateType(party) as FormChangeItemModifierType;
    expect(offered?.formChangeItem).toBe(FormChangeItem.MAX_MUSHROOMS);
    // the common generator (plates, drives...) never offers them
    expect(modifierTypes.FORM_CHANGE_ITEM().generateType(party)).toBeNull();

    give(milotic, FormChangeItem.MAX_MUSHROOMS);
    expect(generator.generateType(party)).toBeNull();

    // Local fork (2026-11-18), review fix: a holder (active or not) is "no effect" for another one, which it could not
    // hold (the reward would become the stack-full fallback item)
    expect(milotic.isFormChangeItemCompatible(FormChangeItem.MAX_MUSHROOMS)).toBe(false);
    expect(offered.selectFilter?.(milotic)).toBe(PartyUiHandler.NoEffectMessage);
    const held = milotic.getHeldItems().find(m => m.is("PokemonFormChangeItemModifier"))!;
    held.active = false;
    expect(milotic.isFormChangeItemCompatible(FormChangeItem.MAX_MUSHROOMS)).toBe(false);
  });

  // Local fork (2026-11-18), review fix: a G-Max species given the mushrooms in its base form is not in the Dynamax
  // state while its form change waits, so its HP follows the G-Max form change as before (the rise added)
  it("a damaged G-Max species given the mushrooms gains its G-Max form's HP rise, as before, never the state's ratio", async () => {
    game.override.startingLevel(100);
    await game.classicMode.startBattle(SpeciesId.VENUSAUR);
    const venusaur = game.field.getPlayerPokemon();
    const baseMaxHp = venusaur.getMaxHp();
    venusaur.hp = Math.floor(baseMaxHp / 2);
    const hp = venusaur.hp;

    give(venusaur, FormChangeItem.MAX_MUSHROOMS);
    expect(venusaur.getFormKey()).toBe("");
    expect(venusaur.hasDynamaxState()).toBe(false);
    expect(venusaur.isDynamaxed()).toBe(false);
    expect(venusaur.getMaxHp()).toBe(baseMaxHp);
    expect(venusaur.hp).toBe(hp);
    expect(venusaur.getSpriteScale()).toBe(1);

    await runTurn();
    expect(venusaur.getFormKey()).toBe(SpeciesFormKey.GIGANTAMAX);
    const gmaxMaxHp = venusaur.getMaxHp();
    expect(gmaxMaxHp).toBeGreaterThan(baseMaxHp);
    expect(venusaur.hp).toBe(hp + gmaxMaxHp - baseMaxHp);
  });

  // Local fork (2026-11-18), review fix: evolving into a G-Max species while in the Dynamax state ends in the G-Max form
  // after the evolution scene (EvolutionPhase), so a session reload no longer changes the form, ability or HP
  it("a Pokémon in the Dynamax state that evolves into a G-Max species takes its G-Max form at once; a reload keeps it", async () => {
    game.override
      .battleType(BattleType.WILD)
      .startingWave(55)
      .startingLevel(35)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(5)
      .mysteryEncounterChance(0);
    await game.classicMode.startBattle(SpeciesId.CHARMELEON);
    const pokemon = game.field.getPlayerPokemon() as PlayerPokemon;
    give(pokemon, FormChangeItem.MAX_MUSHROOMS);
    expect(pokemon.hasDynamaxState()).toBe(true);
    pokemon.exp = getLevelTotalExp(36, pokemon.species.growthRate) - 1;

    game.move.select(MoveId.SPLASH);
    await game.doKillOpponents();
    await game.toNextWave();

    const { phaseLog } = game.phaseInterceptor;
    expect(phaseLog).toContain("EvolutionPhase");
    expect(phaseLog.lastIndexOf("FormChangePhase")).toBeGreaterThan(phaseLog.indexOf("EndEvolutionPhase"));
    expect(game.field.getPlayerPokemon()).toBe(pokemon);
    expect(pokemon.species.speciesId).toBe(SpeciesId.CHARIZARD);
    expect(pokemon.getFormKey()).toBe(SpeciesFormKey.GIGANTAMAX);
    expect(pokemon.hasDynamaxState()).toBe(false);
    expect(pokemon.isDynamaxed()).toBe(true);
    pokemon.hp = Math.floor(pokemon.getMaxHp() * 0.6);
    const saved = {
      formKey: pokemon.getFormKey(),
      ability: pokemon.getAbility().id,
      passive: pokemon.getPassiveAbility().id,
      maxHp: pokemon.getMaxHp(),
      hp: pokemon.hp,
    };

    const { gameData } = game.scene;
    const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
    game.reload["sessionData"] = gameData.parseSessionData(json);
    game.phaseInterceptor.clearLogs();
    await game.reload.reloadSession();

    expect(game.phaseInterceptor.phaseLog).not.toContain("FormChangePhase");
    const loaded = game.field.getPlayerPokemon();
    expect(loaded).not.toBe(pokemon);
    expect({
      formKey: loaded.getFormKey(),
      ability: loaded.getAbility().id,
      passive: loaded.getPassiveAbility().id,
      maxHp: loaded.getMaxHp(),
      hp: loaded.hp,
    }).toEqual(saved);
  });

  it("offers the Dynamax Candy while a party member is in the Dynamax state", async () => {
    await game.classicMode.startBattle(SpeciesId.MILOTIC);
    const milotic = game.field.getPlayerPokemon();
    game.move.changeMoveset(milotic, [MoveId.SURF]);
    const party = game.scene.getPlayerParty();
    expect(getDynamaxCandyWeight(party)).toBe(0);
    give(milotic, FormChangeItem.MAX_MUSHROOMS);
    expect(getDynamaxCandyWeight(party)).toBe(ZMAX_REWARD_RULES.dynamaxCandy.weight);
  });

  it("lets the player's Mega / G-Max / Dynamaxed Pokémon Terastallize and stay so; the enemy rules stay", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP, SpeciesId.CHARIZARD);
    ensureTeraOrb();
    const [garchomp, charizard] = game.scene.getPlayerParty();
    give(garchomp, FormChangeItem.GARCHOMPITE);
    give(charizard, FormChangeItem.MAX_MUSHROOMS);
    await runTurn();
    expect(garchomp.isMega()).toBe(true);
    expect(charizard.isMax()).toBe(true);
    expect(canSpeciesTera(garchomp)).toBe(true);
    expect(canSpeciesTera(charizard)).toBe(true);
    give(garchomp, FormChangeItem.MAX_MUSHROOMS);
    expect(garchomp.hasDynamaxState()).toBe(true);
    expect(canSpeciesTera(garchomp)).toBe(true);

    // a Mega / G-Max form change no longer ends the player's Terastallization
    garchomp.isTerastallized = true;
    garchomp.resetTeraOnMajorFormChange(SpeciesFormKey.MEGA);
    garchomp.resetTeraOnMajorFormChange(SpeciesFormKey.GIGANTAMAX);
    expect(garchomp.isTerastallized).toBe(true);
    garchomp.isTerastallized = false;

    // the enemy: a Mega is still blocked, and its Mega form change still ends its Tera
    const species = speciesDataRegistry.getSpecies(SpeciesId.CHARIZARD);
    const enemy = new EnemyPokemon(species, 80, TrainerSlot.NONE, true);
    enemy.formIndex = species.forms.findIndex(f => f.formKey === SpeciesFormKey.MEGA_X);
    expect(isTeraBlockedForm(enemy)).toBe(true);
    expect(isPlayerTeraBlockedForm(enemy)).toBe(false);
    enemy.isTerastallized = true;
    // (off the field: no sprite or info box to redraw)
    vi.spyOn(enemy, "updateRenderNodeData").mockResolvedValue();
    enemy.resetTeraOnMajorFormChange();
    expect(enemy.isTerastallized).toBe(false);
    enemy.destroy();

    // Ultra Necrozma stays blocked for the player too
    const necrozmaSpecies = speciesDataRegistry.getSpecies(SpeciesId.NECROZMA);
    const necrozma = new EnemyPokemon(necrozmaSpecies, 80, TrainerSlot.NONE, true);
    necrozma.formIndex = necrozmaSpecies.forms.findIndex(f => f.formKey === "ultra");
    expect(isPlayerTeraBlockedForm(necrozma)).toBe(true);
    necrozma.destroy();
  });

  it("keeps Mega + the Dynamax state through a session save and reload", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const garchomp = game.field.getPlayerPokemon();
    give(garchomp, FormChangeItem.GARCHOMPITE);
    await runTurn();
    give(garchomp, FormChangeItem.MAX_MUSHROOMS);
    garchomp.hp = Math.floor(garchomp.getMaxHp() * 0.6);
    const saved = { maxHp: garchomp.getMaxHp(), hp: garchomp.hp, formKey: garchomp.getFormKey() };
    expect(saved.formKey).toBe(SpeciesFormKey.MEGA);
    expect(garchomp.hasDynamaxState()).toBe(true);

    const { gameData } = game.scene;
    const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
    game.reload["sessionData"] = gameData.parseSessionData(json);
    await game.reload.reloadSession();

    const loaded = game.field.getPlayerPokemon();
    expect(loaded).not.toBe(garchomp);
    expect(loaded.getFormKey()).toBe(SpeciesFormKey.MEGA);
    expect(loaded.hasDynamaxState()).toBe(true);
    expect(loaded.getMaxHp()).toBe(saved.maxHp);
    expect(loaded.hp).toBe(saved.hp);
    expect(loaded.getSpriteScale()).toBe(1.5);
    loaded.calculateStats();
    expect([loaded.getMaxHp(), loaded.hp]).toEqual([saved.maxHp, saved.hp]);
  });

  it("one Pokémon at once: Mega X + Dynamax + a Z slot and a Max slot + Terastallized, using its Z-Move", async () => {
    game.override.enemyLevel(200);
    await game.classicMode.startBattle(SpeciesId.CHARIZARD);
    ensureTeraOrb();
    const charizard = game.field.getPlayerPokemon() as PlayerPokemon;
    // the slots themselves (a moveset override would hide their conversions)
    game.move.changeMoveset(charizard, [MoveId.SPLASH, MoveId.DRAGON_CLAW, MoveId.AIR_SLASH, MoveId.SURF]);
    give(charizard, FormChangeItem.CHARIZARDITE_X);
    await runTurn();
    give(charizard, FormChangeItem.MAX_MUSHROOMS);
    expect(charizard.getFormKey()).toBe(SpeciesFormKey.MEGA_X);
    expect(charizard.hasDynamaxState()).toBe(true);
    const dynamaxMaxHp = charizard.getMaxHp();

    // Dragon Claw -> a Z-Move (Devastating Drake), Air Slash -> a Max Move (Max Airstream)
    expect(game.scene.addModifier(new ZCrystalModifierType(PokemonType.DRAGON).newModifier(charizard, 1)!)).toBe(true);
    expect(game.scene.addModifier(modifierTypes.DYNAMAX_CANDY().newModifier(charizard, 2)!)).toBe(true);
    expect(charizard.moveset[1].transform).toEqual({ kind: "z", moveId: MoveId.DEVASTATING_DRAKE__PHYSICAL });
    expect(charizard.moveset[2].transform).toEqual({ kind: "max", moveId: MoveId.MAX_AIRSTREAM });
    expect(canSpeciesTera(charizard)).toBe(true);

    game.move.selectWithTera(MoveId.DRAGON_CLAW);
    await game.toEndOfTurn();

    expect(charizard.isTerastallized).toBe(true);
    expect(charizard.getFormKey()).toBe(SpeciesFormKey.MEGA_X);
    expect(charizard.hasDynamaxState()).toBe(true);
    expect(charizard.getMaxHp()).toBe(dynamaxMaxHp);
    expect(charizard).toHaveUsedMove({ move: MoveId.DRAGON_CLAW, derivedMoveId: MoveId.DEVASTATING_DRAKE__PHYSICAL });
    const enemy = game.field.getEnemyPokemon();
    expect(enemy.hp).toBeLessThan(enemy.getMaxHp());
  });
});
