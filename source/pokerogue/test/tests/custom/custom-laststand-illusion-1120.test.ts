// Local fork (2026-11-20): two small 1.2.0 fixes (the user: "결사항전 관련 실행", "일루전 - 사망 전 잠시 변신 해제").
// - Last Stand (결사항전) traps its own holder with no `TrappedTag` and no ability message, so `CommandPhase.handleTrap`
//   showed nothing: Run in a wild battle left an empty message box that took no input (as Sky Drop did before
//   2026-11-19), and Switch gave no answer at all. Both now show the usual can't-escape message naming the holder's
//   Last Stand and go back to the command menu.
// - Illusion (일루전): a disguised holder that faints from anything (poison, weather, recoil...) briefly shows its true
//   look (sprite, name, battle info) before the faint cry and the "<name> fainted!" message (`FaintPhase`).
import { getPokemonNameWithAffix } from "#app/messages";
import { allAbilities } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { PartyUiMode } from "#enums/party-ui-mode";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import type { CommandPhase } from "#phases/command-phase";
import { GameManager } from "#test/framework/game-manager";
import { PartyUiHandler } from "#ui/party-ui-handler";
import i18next from "i18next";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("1.2.0 fixes of 2026-11-20: Last Stand's own trap, Illusion before fainting", () => {
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
      .startingLevel(100)
      .enemyLevel(5)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyHasPassiveAbility(false)
      .enemyMoveset(MoveId.SPLASH);
  });

  describe("Last Stand traps its holder", () => {
    beforeEach(() => {
      game.override.ability(AbilityId.LAST_STAND).hasPassiveAbility(false).moveset([MoveId.SPLASH]);
    });

    /** The can't-escape message for Last Stand's holder */
    function noEscapeMessage(holder: Pokemon, isSwitch: boolean): string {
      return i18next.t("battle:noEscapePokemon", {
        pokemonName: getPokemonNameWithAffix(holder),
        moveName: allAbilities[AbilityId.LAST_STAND].name,
        escapeVerb: i18next.t(isSwitch ? "battle:escapeVerbSwitch" : "battle:escapeVerbFlee"),
      });
    }

    it("Run in a wild battle says it cannot flee and goes back to the command menu", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
      const feebas = game.field.getPlayerPokemon();
      expect(feebas.isTrapped()).toBe(true);

      const commandPhase = game.scene.phaseManager.getCurrentPhase() as CommandPhase;
      expect(commandPhase.handleCommand(Command.RUN, 0)).toBe(false);
      expect(game.textInterceptor.logs).toContain(noEscapeMessage(feebas, false));
      await vi.waitFor(() => expect(game.scene.ui.mode).toBe(UiMode.COMMAND));

      // The battle goes on from the command menu
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(game.field.getPlayerPokemon()).toBe(feebas);
      expect(game.scene.currentBattle.turn).toBe(2);
    });

    it("Switch says it cannot be switched out and goes back to the command menu", async () => {
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
      const feebas = game.field.getPlayerPokemon();

      await game.scene.ui.setMode(UiMode.PARTY, PartyUiMode.SWITCH, 0, null, PartyUiHandler.FilterNonFainted);
      const commandPhase = game.scene.phaseManager.getCurrentPhase() as CommandPhase;
      expect(commandPhase.handleCommand(Command.POKEMON, 1, false)).toBe(false);
      expect(game.textInterceptor.logs).toContain(noEscapeMessage(feebas, true));
      await vi.waitFor(() => expect(game.scene.ui.mode).toBe(UiMode.COMMAND));

      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(game.field.getPlayerPokemon()).toBe(feebas);
    });

    it("a Ghost-type holder is not trapped by its own Last Stand and can still flee", async () => {
      await game.classicMode.startBattle(SpeciesId.GASTLY, SpeciesId.MAGIKARP);
      const gastly = game.field.getPlayerPokemon();
      expect(gastly.isTrapped()).toBe(false);

      const commandPhase = game.scene.phaseManager.getCurrentPhase() as CommandPhase;
      expect(commandPhase.handleCommand(Command.RUN, 0)).toBe(true);
    });
  });

  describe("Illusion before fainting", () => {
    beforeEach(() => {
      // The player's Zoroark has Illusion as its only ability
      game.override.shiny(false).enemyShiny(false).moveset([MoveId.SPLASH]);
    });

    /** The battle sprite key of the holder's true look, read while its illusion is up */
    function trueSpriteKey(holder: Pokemon): string {
      const { illusion } = holder.summonData;
      holder.summonData.illusion = null;
      const key = holder.getBattleSpriteKey();
      holder.summonData.illusion = illusion;
      return key;
    }

    /**
     * Watch what the holder's sprite shows: the key of the last animation it was given, and that key when its faint
     * cry starts (the cry, the drop and then the "fainted" message follow)
     */
    function watchSprite(holder: Pokemon): { lastKey: () => string | undefined; keyAtFaintCry: () => string[] } {
      const playSprite = vi.spyOn(holder, "playSprite");
      const atFaintCry: string[] = [];
      const faintCry = holder.faintCry.bind(holder);
      vi.spyOn(holder, "faintCry").mockImplementation(callback => {
        atFaintCry.push(playSprite.mock.lastCall?.[2] ?? "none");
        faintCry(callback);
      });
      return { lastKey: () => playSprite.mock.lastCall?.[2], keyAtFaintCry: () => atFaintCry };
    }

    it("a disguised holder fainting from poison shows its true look before it faints", async () => {
      game.override.statusEffect(StatusEffect.POISON);
      await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.FEEBAS);
      const [zoroark, feebas] = game.scene.getPlayerParty();
      expect(zoroark.summonData.illusion?.species).toBe(SpeciesId.FEEBAS);
      const disguisedKey = zoroark.getBattleSpriteKey();
      const trueKey = trueSpriteKey(zoroark);
      expect(trueKey).not.toBe(disguisedKey);
      expect(getPokemonNameWithAffix(zoroark)).toBe(feebas.name);

      zoroark.hp = 1;
      const breakIllusion = vi.spyOn(zoroark, "breakIllusion");
      const sprite = watchSprite(zoroark);

      game.move.select(MoveId.SPLASH);
      game.doSelectPartyPokemon(1);
      await game.toNextTurn();

      expect(zoroark.isFainted()).toBe(true);
      expect(breakIllusion).toHaveReturnedWith(true);
      // Its own sprite was back on screen when it began to faint
      expect(sprite.keyAtFaintCry()).toEqual([trueKey]);
      expect(game.textInterceptor.logs).toContain(i18next.t("battle:fainted", { pokemonNameWithAffix: zoroark.name }));
      expect(game.textInterceptor.logs).not.toContain(
        i18next.t("battle:fainted", { pokemonNameWithAffix: feebas.name }),
      );
    });

    it("a holder whose illusion already ended faints as before, with nothing to reveal", async () => {
      game.override.statusEffect(StatusEffect.POISON);
      await game.classicMode.startBattle(SpeciesId.ZOROARK, SpeciesId.FEEBAS);
      const zoroark = game.field.getPlayerPokemon();
      zoroark.breakIllusion();
      zoroark.hp = 1;
      const breakIllusion = vi.spyOn(zoroark, "breakIllusion");
      const loadAssets = vi.spyOn(zoroark, "loadAssets");

      game.move.select(MoveId.SPLASH);
      game.doSelectPartyPokemon(1);
      await game.toNextTurn();

      expect(zoroark.isFainted()).toBe(true);
      expect(breakIllusion).not.toHaveBeenCalled();
      expect(loadAssets).not.toHaveBeenCalled();
    });

    it("a disguised wild enemy does the same, and the message names the foe itself", async () => {
      game.override.enemyAbility(AbilityId.ILLUSION).enemyStatusEffect(StatusEffect.POISON);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const enemy = game.field.getEnemyPokemon();
      // A wild holder has no party to copy, so it is given a look here, as a trainer's Pokémon gets one (an enemy
      // trainer whose Pokémon is at 1 HP and poisoned would switch it out instead)
      enemy.setIllusion(game.field.getPlayerPokemon());
      expect(enemy.summonData.illusion?.species).toBe(SpeciesId.FEEBAS);
      const trueKey = trueSpriteKey(enemy);
      expect(trueKey).not.toBe(enemy.getBattleSpriteKey());
      const disguisedName = getPokemonNameWithAffix(enemy);

      enemy.hp = 1;
      const sprite = watchSprite(enemy);

      game.move.select(MoveId.SPLASH);
      await game.phaseInterceptor.to("VictoryPhase", false);

      expect(enemy.isFainted()).toBe(true);
      expect(sprite.keyAtFaintCry()).toEqual([trueKey]);
      const trueName = i18next.t("battle:wildPokemonWithAffix", { pokemonName: enemy.name });
      expect(game.textInterceptor.logs).toContain(i18next.t("battle:fainted", { pokemonNameWithAffix: trueName }));
      expect(game.textInterceptor.logs).not.toContain(
        i18next.t("battle:fainted", { pokemonNameWithAffix: disguisedName }),
      );
    });
  });
});
