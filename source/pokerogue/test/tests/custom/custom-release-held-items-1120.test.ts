// Local fork (2026-11-20): Q1, a released Pokémon's held items can go to another Pokémon first (the user: "실행" to
// "놓아줄 때 지닌 도구 옮기기"; release-held-items.ts):
// 1. the move is the party screen's "transfer all", capped at what the receiver can hold; what is over stays
// 2. released from the party menu, the items go to a party member picked on the party screen, with a warning (and a
//    second chance) when some of them do not fit
// 3. released to make room for a Pokémon being caught, they go to that Pokémon by default, or to a party member

import { modifierTypes } from "#data/data-lists";
import {
  countHeldItems,
  countHeldItemsOverLimit,
  getCatchReleaseTarget,
  getTransferableHeldItems,
  giveKeptHeldItemsTo,
  hasKeptHeldItems,
  keepHeldItemsForCaughtPokemon,
  setCatchReleaseTarget,
  transferAllHeldItems,
} from "#data/release-held-items";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { Button } from "#enums/buttons";
import { MoveId } from "#enums/move-id";
import { PartyUiMode } from "#enums/party-ui-mode";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import { PokemonHeldItemModifier } from "#modifiers/modifier";
import type { PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import type { ConfirmUiHandler } from "#ui/confirm-ui-handler";
import type { OptionSelectUiHandler } from "#ui/option-select-ui-handler";
import { PartyUiHandler } from "#ui/party-ui-handler";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const WAIT = { timeout: 15_000, interval: 10 };

describe("Local fork - Q1, moving a released Pokémon's held items (2026-11-20)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .battleType(BattleType.WILD)
      .startingWave(3)
      .startingLevel(50)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(5)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH]);
  });

  afterEach(() => {
    setCatchReleaseTarget(null);
    giveKeptHeldItemsTo(null);
    vi.restoreAllMocks();
  });

  const ui = () => game.scene.ui;
  const partyHandler = () => ui().handlers[UiMode.PARTY] as PartyUiHandler;
  const optionHandler = () => ui().handlers[UiMode.OPTION_SELECT] as OptionSelectUiHandler;
  const confirmHandler = () => ui().handlers[UiMode.CONFIRM] as ConfirmUiHandler;
  const optionLabels = () => (optionHandler()["options"] as { label: string }[]).map(o => o.label);
  const t = (key: string, options?: Record<string, unknown>) => i18next.t(`partyUiHandler:${key}`, options);

  type HeldId = "LEFTOVERS" | "QUICK_CLAW" | "SCOPE_LENS";

  /**
   * Gives `pokemon` (the player's or the enemy's) `count` of the held item `id` (caps: Leftovers 4, Quick Claw 3, Scope
   * Lens 1 for the enemy and 3 for the player, `PLAYER_HELD_ITEM_CAPS`)
   */
  function give(pokemon: Pokemon, id: HeldId, count: number): void {
    const type = modifierTypes[id]().withIdFromFunc(modifierTypes[id]) as PokemonHeldItemModifierType;
    const item = type.newModifier(pokemon) as PokemonHeldItemModifier;
    item.stackCount = count;
    if (pokemon.isPlayer()) {
      game.scene.addModifier(item, true);
    } else {
      void game.scene.addEnemyModifier(item, true);
    }
    game.scene.updateModifiers(pokemon.isPlayer());
  }

  /** The Leftovers and Quick Claws `pokemon` holds, by item id */
  function held(pokemon: Pokemon): Partial<Record<HeldId, number>> {
    const items = game.scene.findModifiers(
      m =>
        m instanceof PokemonHeldItemModifier
        && m.pokemonId === pokemon.id
        && (m.type.id === "LEFTOVERS" || m.type.id === "QUICK_CLAW" || m.type.id === "SCOPE_LENS"),
      pokemon.isPlayer(),
    );
    return Object.fromEntries(items.map(m => [m.type.id, m.stackCount]));
  }

  async function waitForMode(mode: UiMode): Promise<void> {
    await vi.waitFor(() => {
      expect(ui().mode).toBe(mode);
      expect(ui().getHandler().active).toBe(true);
    }, WAIT);
  }

  async function waitForList(labels: string[]): Promise<void> {
    await waitForMode(UiMode.OPTION_SELECT);
    await vi.waitFor(() => expect(optionLabels()).toEqual(labels), WAIT);
  }

  /** Moves the list cursor down to option `index` and presses A */
  function choose(index: number): void {
    const handler = optionHandler();
    for (let n = 0; n < index; n++) {
      handler.processInput(Button.DOWN);
    }
    expect(handler.getCursor()).toBe(index);
    handler.processInput(Button.ACTION);
  }

  /** Waits for the party screen's message to wait for A, then presses it */
  async function pressOnPrompt(): Promise<void> {
    await vi.waitFor(() => expect(partyHandler()["awaitingActionInput"]).toBe(true), WAIT);
    partyHandler().processInput(Button.ACTION);
  }

  /** The party screen during a battle, then "release" on slot `slot` and "yes" */
  async function releaseFromPartyMenu(slot: number): Promise<void> {
    await ui().setMode(UiMode.PARTY, PartyUiMode.SWITCH, 0, null, PartyUiHandler.FilterNonFainted);
    const party = partyHandler();
    party.setCursor(slot);
    party["processReleaseOption"](game.scene.getPlayerParty()[slot]);
    await waitForMode(UiMode.CONFIRM);
    confirmHandler().processInput(Button.ACTION); // release? yes
  }

  describe("1. the move", () => {
    it("moves every transferable stack like the party screen's transfer all, capped at the receiver's room", async () => {
      await game.classicMode.startBattle(SpeciesId.BULBASAUR, SpeciesId.CHARMANDER, SpeciesId.SQUIRTLE);
      const [bulbasaur, charmander, squirtle] = game.scene.getPlayerParty();
      give(squirtle, "LEFTOVERS", 3);
      give(squirtle, "QUICK_CLAW", 1);
      give(bulbasaur, "LEFTOVERS", 2);

      const items = getTransferableHeldItems(squirtle);
      expect(countHeldItems(items)).toBe(4);
      expect(countHeldItemsOverLimit(items, bulbasaur)).toBe(1); // Leftovers: 2 held + 3 over a cap of 4
      expect(countHeldItemsOverLimit(items, charmander)).toBe(0); // holds none: the stacks go over whole

      expect(transferAllHeldItems(squirtle, bulbasaur)).toBe(1);
      expect(held(bulbasaur)).toEqual({ LEFTOVERS: 4, QUICK_CLAW: 1 });
      expect(held(squirtle)).toEqual({ LEFTOVERS: 1 });
    });

    it("keeps the items of a Pokémon released for a catch, then gives them to the caught one", async () => {
      await game.classicMode.startBattle(SpeciesId.BULBASAUR, SpeciesId.CHARMANDER, SpeciesId.SQUIRTLE);
      const [bulbasaur, charmander, squirtle] = game.scene.getPlayerParty();
      give(squirtle, "LEFTOVERS", 3);
      give(bulbasaur, "LEFTOVERS", 2);

      setCatchReleaseTarget(bulbasaur);
      expect(getCatchReleaseTarget()).toBe(bulbasaur);
      keepHeldItemsForCaughtPokemon(squirtle, 1);
      expect(held(squirtle)).toEqual({});
      expect(hasKeptHeldItems()).toBe(true);
      // 1 Leftovers does not fit; the player was told of it, so nothing is left to announce
      expect(giveKeptHeldItemsTo(bulbasaur)).toBe(0);
      expect(held(bulbasaur)).toEqual({ LEFTOVERS: 4 });
      expect(getCatchReleaseTarget()).toBeNull();
      expect(hasKeptHeldItems()).toBe(false);

      // Not told: the loss is announced after the catch
      give(squirtle, "QUICK_CLAW", 2);
      give(charmander, "QUICK_CLAW", 2);
      keepHeldItemsForCaughtPokemon(squirtle);
      expect(giveKeptHeldItemsTo(charmander)).toBe(1);
      expect(held(charmander)).toEqual({ QUICK_CLAW: 3 });

      // No one joined: all kept items are lost
      give(squirtle, "QUICK_CLAW", 2);
      keepHeldItemsForCaughtPokemon(squirtle);
      expect(giveKeptHeldItemsTo(null)).toBe(2);
      expect(giveKeptHeldItemsTo(bulbasaur)).toBe(0); // nothing kept any more
    });

    it("counts a caught Pokémon's room with the caps it will have in the party", async () => {
      await game.classicMode.startBattle(SpeciesId.BULBASAUR);
      const enemy = game.field.getEnemyPokemon();
      const bulbasaur = game.field.getPlayerPokemon();
      give(enemy, "LEFTOVERS", 2);
      give(bulbasaur, "LEFTOVERS", 3);
      const item = getTransferableHeldItems(bulbasaur)[0];
      const enemyLeftovers = game.scene.findModifier(
        m => m instanceof PokemonHeldItemModifier && m.pokemonId === enemy.id,
        false,
      ) as PokemonHeldItemModifier;
      const partyCap = enemyLeftovers.getMaxHeldItemCount(bulbasaur);
      expect(countHeldItemsOverLimit([item], enemy)).toBe(Math.max(3 - (partyCap - 2), 0));

      // Review (2026-11-20): an item whose cap differs for the player: the Scope Lens, 1 for the enemy, 3 in the party.
      // The enemy holds 1, so 2 more fit once it is caught (with the enemy's cap none would)
      give(enemy, "SCOPE_LENS", 1);
      give(bulbasaur, "SCOPE_LENS", 3);
      const lens = getTransferableHeldItems(bulbasaur).find(m => m.type.id === "SCOPE_LENS")!;
      const enemyLens = game.scene.findModifier(
        m => m instanceof PokemonHeldItemModifier && m.pokemonId === enemy.id && m.type.id === "SCOPE_LENS",
        false,
      ) as PokemonHeldItemModifier;
      expect(enemyLens.getMaxHeldItemCount(enemy)).toBe(1);
      expect(enemyLens.getMaxHeldItemCount(bulbasaur)).toBe(3);
      expect(countHeldItemsOverLimit([lens], enemy)).toBe(1);
      expect(enemy.isPlayer()).toBe(false); // the stand-in for the caps leaves the Pokémon itself alone
    });
  });

  describe("2. released from the party menu", () => {
    it("asks first, then gives all to the member picked on the party screen, and releases", async () => {
      await game.classicMode.startBattle(SpeciesId.BULBASAUR, SpeciesId.CHARMANDER, SpeciesId.SQUIRTLE);
      const [bulbasaur, charmander, squirtle] = game.scene.getPlayerParty();
      give(squirtle, "LEFTOVERS", 3);
      give(squirtle, "QUICK_CLAW", 1);

      await releaseFromPartyMenu(2);
      await waitForList([t("releaseItemsToOther"), t("releaseItemsDontMove"), t("cancel")]);
      choose(0);

      const party = partyHandler();
      await waitForMode(UiMode.PARTY);
      expect(party["releaseItemSource"]).toBe(2);
      expect(party.getCursor()).toBe(0);
      const slots = party["partySlots"];
      expect(slots[0].slotDescriptionLabel.text).toBe(`${t("able")} (2)`);
      expect(slots[1].slotDescriptionLabel.text).toBe(`${t("able")} (2)`);

      party.processInput(Button.ACTION); // to Bulbasaur
      expect(held(bulbasaur)).toEqual({ LEFTOVERS: 3, QUICK_CLAW: 1 });
      expect(held(squirtle)).toEqual({});
      expect(party["releaseItemSource"]).toBe(-1);
      await pressOnPrompt(); // "the items went to Bulbasaur!"
      await pressOnPrompt(); // goodbye
      await vi.waitFor(() => expect(game.scene.getPlayerParty()).toEqual([bulbasaur, charmander]), WAIT);
      expect(held(bulbasaur)).toEqual({ LEFTOVERS: 3, QUICK_CLAW: 1 });
    });

    it("refuses a member that can take none, warns about what does not fit, and releases nothing on no", async () => {
      await game.classicMode.startBattle(SpeciesId.BULBASAUR, SpeciesId.CHARMANDER, SpeciesId.SQUIRTLE);
      const [bulbasaur, charmander, squirtle] = game.scene.getPlayerParty();
      give(squirtle, "LEFTOVERS", 2);
      give(squirtle, "QUICK_CLAW", 1);
      give(bulbasaur, "LEFTOVERS", 4);
      give(charmander, "LEFTOVERS", 4);
      give(charmander, "QUICK_CLAW", 3);

      await releaseFromPartyMenu(2);
      await waitForList([t("releaseItemsToOther"), t("releaseItemsDontMove"), t("cancel")]);
      choose(0);
      const party = partyHandler();
      await waitForMode(UiMode.PARTY);
      const slots = party["partySlots"];
      expect(slots[0].slotDescriptionLabel.text).toBe(`${t("able")} (1)`); // the Quick Claw only
      expect(slots[1].slotDescriptionLabel.text).toBe(t("notAble"));

      party.setCursor(1);
      expect(party.processInput(Button.ACTION)).toBe(false); // Charmander is full
      expect(party["releaseItemSource"]).toBe(2);

      party.setCursor(0);
      party.processInput(Button.ACTION);
      expect(held(bulbasaur)).toEqual({ LEFTOVERS: 4, QUICK_CLAW: 1 });
      expect(held(squirtle)).toEqual({ LEFTOVERS: 2 });
      await waitForMode(UiMode.CONFIRM); // "2 can't be moved... release anyway?"
      confirmHandler().processInput(Button.CANCEL); // no
      await waitForMode(UiMode.PARTY);
      expect(game.scene.getPlayerParty()).toEqual([bulbasaur, charmander, squirtle]);
      expect(held(squirtle)).toEqual({ LEFTOVERS: 2 });
    });

    it("releases after the warning on yes, the items over the limit lost with it", async () => {
      await game.classicMode.startBattle(SpeciesId.BULBASAUR, SpeciesId.CHARMANDER, SpeciesId.SQUIRTLE);
      const [bulbasaur, charmander, squirtle] = game.scene.getPlayerParty();
      give(squirtle, "LEFTOVERS", 2);
      give(squirtle, "QUICK_CLAW", 1);
      give(bulbasaur, "LEFTOVERS", 4);

      await releaseFromPartyMenu(2);
      await waitForList([t("releaseItemsToOther"), t("releaseItemsDontMove"), t("cancel")]);
      choose(0);
      await waitForMode(UiMode.PARTY);
      partyHandler().processInput(Button.ACTION); // to Bulbasaur
      await waitForMode(UiMode.CONFIRM);
      confirmHandler().processInput(Button.ACTION); // yes
      await pressOnPrompt(); // goodbye
      await vi.waitFor(() => expect(game.scene.getPlayerParty()).toEqual([bulbasaur, charmander]), WAIT);
      expect(held(bulbasaur)).toEqual({ LEFTOVERS: 4, QUICK_CLAW: 1 });
      expect(
        game.scene.findModifiers(m => m instanceof PokemonHeldItemModifier && m.pokemonId === squirtle.id),
      ).toEqual([]);
    });

    it("leaves the pick with B, and releases at once a Pokémon with nothing to pass on", async () => {
      await game.classicMode.startBattle(SpeciesId.BULBASAUR, SpeciesId.CHARMANDER, SpeciesId.SQUIRTLE);
      const [bulbasaur, charmander, squirtle] = game.scene.getPlayerParty();
      give(squirtle, "QUICK_CLAW", 1);

      await releaseFromPartyMenu(2);
      await waitForList([t("releaseItemsToOther"), t("releaseItemsDontMove"), t("cancel")]);
      choose(0);
      const party = partyHandler();
      await waitForMode(UiMode.PARTY);
      party.processInput(Button.CANCEL);
      expect(party["releaseItemSource"]).toBe(-1);
      expect(held(squirtle)).toEqual({ QUICK_CLAW: 1 });
      expect(game.scene.getPlayerParty()).toHaveLength(3);

      // Charmander holds nothing: released as before, without the question
      party.setCursor(1);
      party["processReleaseOption"](charmander);
      await waitForMode(UiMode.CONFIRM);
      confirmHandler().processInput(Button.ACTION);
      await pressOnPrompt(); // goodbye
      await vi.waitFor(() => expect(game.scene.getPlayerParty()).toEqual([bulbasaur, squirtle]), WAIT);
    });
  });

  describe("3. released for a Pokémon being caught", () => {
    const SIX = [
      SpeciesId.BULBASAUR,
      SpeciesId.CHARMANDER,
      SpeciesId.SQUIRTLE,
      SpeciesId.PIKACHU,
      SpeciesId.EEVEE,
      SpeciesId.MEOWTH,
    ] as const;

    /** Throws a Master Ball with a full party and says yes to releasing one */
    function throwAndAgreeToRelease(): void {
      game.scene.pokeballCounts[PokeballType.MASTER_BALL] = 1;
      game.doThrowPokeball(PokeballType.MASTER_BALL);
      game.onNextPrompt("AttemptCapturePhase", UiMode.OPTION_SELECT, () => {
        expect(optionLabels()[2]).toBe(i18next.t("menu:yes"));
        choose(2);
      });
    }

    /** On the release party screen: slot `slot`, then "release" (its first option) */
    function releaseSlotOnPrompt(slot: number): void {
      game.onNextPrompt("AttemptCapturePhase", UiMode.PARTY, () => {
        const party = partyHandler();
        party.setCursor(slot);
        party.processInput(Button.ACTION); // its options
        party.processInput(Button.ACTION); // release
      });
    }

    it("gives the items to the caught Pokémon by default, after warning about what it cannot hold", async () => {
      await game.classicMode.startBattle(...SIX);
      const enemy = game.field.getEnemyPokemon();
      const meowth = game.scene.getPlayerParty()[5];
      give(meowth, "LEFTOVERS", 3);
      give(meowth, "QUICK_CLAW", 1);
      give(enemy, "LEFTOVERS", 2);
      // Review (2026-11-20): the Scope Lens cap is 1 for the enemy and 3 in the party: both lenses fit once caught
      give(meowth, "SCOPE_LENS", 2);
      give(enemy, "SCOPE_LENS", 1);

      throwAndAgreeToRelease();
      releaseSlotOnPrompt(5);
      const enemyName = enemy.getNameToRender({ useIllusion: false });
      game.onNextPrompt("AttemptCapturePhase", UiMode.OPTION_SELECT, () => {
        expect(optionLabels()).toEqual([
          t("releaseItemsToCaught", { pokemonName: enemyName }),
          t("releaseItemsToOther"),
          t("releaseItemsDontMove"),
          t("cancel"),
        ]);
        expect(getCatchReleaseTarget()).toBe(enemy);
        choose(0);
      });
      game.onNextPrompt("AttemptCapturePhase", UiMode.CONFIRM, () => {
        // 1 Leftovers will not fit (the lenses do, with the party's cap): release anyway
        expect(partyHandler()["message"].text).toBe(t("releaseItemsOverLimit", { amount: 1 }));
        confirmHandler().processInput(Button.ACTION);
      });
      game.onNextPrompt(
        "AttemptCapturePhase",
        UiMode.PARTY,
        () => partyHandler().processInput(Button.ACTION),
        undefined,
        true,
      );
      await game.phaseInterceptor.to("TurnEndPhase");

      const party = game.scene.getPlayerParty();
      expect(party).toHaveLength(6);
      expect(party).not.toContain(meowth);
      // Released from the last slot, the cursor steps back one and the caught Pokémon goes in there (as upstream)
      const caught = party.find(p => p.id === enemy.id);
      expect(caught).toBe(party[4]);
      expect(held(caught!)).toEqual({ LEFTOVERS: 4, QUICK_CLAW: 1, SCOPE_LENS: 3 });
      expect(getCatchReleaseTarget()).toBeNull();
      expect(hasKeptHeldItems()).toBe(false);
    });

    it("can give them to a party member instead; the caught Pokémon takes the released one's slot", async () => {
      await game.classicMode.startBattle(...SIX);
      const enemy = game.field.getEnemyPokemon();
      const [bulbasaur] = game.scene.getPlayerParty();
      const eevee = game.scene.getPlayerParty()[4];
      give(eevee, "QUICK_CLAW", 2);

      throwAndAgreeToRelease();
      releaseSlotOnPrompt(4);
      game.onNextPrompt("AttemptCapturePhase", UiMode.OPTION_SELECT, () => choose(1)); // to another Pokémon
      game.onNextPrompt("AttemptCapturePhase", UiMode.PARTY, () => {
        const party = partyHandler();
        expect(party["releaseItemSource"]).toBe(4);
        expect(party.getCursor()).toBe(0);
        party.processInput(Button.ACTION); // to Bulbasaur
      });
      game.onNextPrompt(
        "AttemptCapturePhase",
        UiMode.PARTY,
        () => partyHandler().processInput(Button.ACTION),
        undefined,
        true,
      );
      game.onNextPrompt(
        "AttemptCapturePhase",
        UiMode.PARTY,
        () => partyHandler().processInput(Button.ACTION),
        undefined,
        true,
      );
      await game.phaseInterceptor.to("TurnEndPhase");

      const party = game.scene.getPlayerParty();
      expect(party).toHaveLength(6);
      expect(party).not.toContain(eevee);
      expect(party[4].id).toBe(enemy.id);
      expect(held(bulbasaur)).toEqual({ QUICK_CLAW: 2 });
      expect(held(party[4])).toEqual({});
    });
  });

  it("has every new text in Korean and English", async () => {
    const keys = [
      "releaseItemsQuestion",
      "releaseItemsToCaught",
      "releaseItemsToOther",
      "releaseItemsDontMove",
      "releaseItemsChooseTarget",
      "releaseItemsMoved",
      "releaseItemsOverLimit",
      "releaseItemsLost",
    ];
    const { readFileSync } = await import("node:fs");
    for (const lang of ["ko", "en"]) {
      const json = JSON.parse(readFileSync(`./locales/${lang}/party-ui-handler.json`, "utf8")) as Record<
        string,
        string
      >;
      for (const key of keys) {
        expect(json[key], `${lang} ${key}`).toBeTruthy();
      }
      expect(json.releaseItemsOverLimit).toContain("{{amount}}");
      expect(json.releaseItemsLost).toContain("{{amount}}");
    }
  });
});
