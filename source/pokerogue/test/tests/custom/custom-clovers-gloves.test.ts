import { FULL_RULE_HELD_ITEM_IDS, partyHoldsMax } from "#balance/endless-balance";
import { allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import {
  FourLeafCloverLeafModifier,
  FourLeafCloverModifier,
  GoldenFourLeafCloverModifier,
  getCloverLuck,
  getCustomModifierClass,
  LUCK_CLOVERS,
  MasterPunchingGloveModifier,
  PunchingGloveModifier,
} from "#modifiers/custom-held-items";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
// biome-ignore lint/performance/noNamespaceImport: the session loader looks classes up in this namespace
import * as Modifier from "#modifiers/modifier";
import { getPartyLuckValue, type PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import { toDmgValue } from "#utils/common";
import { getModifierPoolForType } from "#utils/modifier-utils";
import { readFileSync } from "node:fs";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local fork (2026-11-11): the luck clovers (네잎클로버 잎 / 네잎클로버 / 황금 네잎클로버) and the punching gloves
 * (펀치글러브 / 마스터 펀치글러브). The user: "네잎클로버 잎(슈퍼, 4개 모으면 행운 +1 …, 최대 4개) / 네잎클로버(하이퍼,
 * 행운 +1, … 최대 3) / 황금 네잎클로버(로그, 행운+3, 최대 2개) / 펀치글러브(하이퍼, 주먹류 기술 데미지 1.1배 + 비접촉
 * (단단한발톱의 보너스는 받는데 킬가르도가 쓰는 킹실드의 공격 랭크하락 효과는 안받도록 …), 최대 1개) / 마스터
 * 펀치글러브(마스터, … 모든 접촉기에게 비접촉 판정 추가 + 1.2배 위력 + 보이지않는주먹 효과(포챔스 기준))".
 */
describe("Custom items - luck clovers and punching gloves", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  const CLOVERS = [
    { id: "FOUR_LEAF_CLOVER_LEAF", cls: FourLeafCloverLeafModifier, tier: ModifierTier.GREAT, weight: 3, max: 4 },
    { id: "FOUR_LEAF_CLOVER", cls: FourLeafCloverModifier, tier: ModifierTier.ULTRA, weight: 3, max: 3 },
    { id: "GOLDEN_FOUR_LEAF_CLOVER", cls: GoldenFourLeafCloverModifier, tier: ModifierTier.ROGUE, weight: 2, max: 2 },
  ] as const;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyHasPassiveAbility(false)
      .ability(AbilityId.BALL_FETCH)
      .hasPassiveAbility(false)
      .shiny(false)
      .moveset([MoveId.MACH_PUNCH, MoveId.FIRE_PUNCH, MoveId.TACKLE, MoveId.SPLASH]);
  });

  function poolEntry(tier: ModifierTier, id: string) {
    return getModifierPoolForType(ModifierPoolType.PLAYER)[tier].find(w => w.modifierType.id === id);
  }

  function addClover(id: (typeof CLOVERS)[number]["id"], count: number): void {
    const clover = modifierTypes[id]().withIdFromFunc(modifierTypes[id]).newModifier() as Modifier.PersistentModifier;
    clover.stackCount = count;
    game.scene.addModifier(clover, true);
  }

  function gloveType(name: "PUNCHING_GLOVE" | "MASTER_PUNCHING_GLOVE"): PokemonHeldItemModifierType {
    return modifierTypes[name]().withIdFromFunc(modifierTypes[name]) as PokemonHeldItemModifierType;
  }

  function power(move: MoveId, source: Pokemon, target: Pokemon): number {
    return allMoves[move].calculateBattlePower(source, target, true);
  }

  it("have their icons, Korean / English text and save classes; the gloves are on the full-item rule list", () => {
    const atlas = JSON.parse(readFileSync("./assets/images/items.json", "utf8")).textures[0].frames as {
      filename: string;
      sourceSize: { w: number; h: number };
      trimmed: boolean;
    }[];
    const ko = JSON.parse(readFileSync("./locales/ko/modifier-type.json", "utf8")).ModifierType;
    const en = JSON.parse(readFileSync("./locales/en/modifier-type.json", "utf8")).ModifierType;
    for (const [id, icon, koName, cls] of [
      ["FOUR_LEAF_CLOVER_LEAF", "four_leaf_clover_leaf", "네잎클로버 잎", FourLeafCloverLeafModifier],
      ["FOUR_LEAF_CLOVER", "four_leaf_clover", "네잎클로버", FourLeafCloverModifier],
      ["GOLDEN_FOUR_LEAF_CLOVER", "golden_four_leaf_clover", "황금 네잎클로버", GoldenFourLeafCloverModifier],
      ["PUNCHING_GLOVE", "punching_glove", "펀치글러브", PunchingGloveModifier],
      ["MASTER_PUNCHING_GLOVE", "master_punching_glove", "마스터 펀치글러브", MasterPunchingGloveModifier],
    ] as const) {
      expect(modifierTypes[id]().iconImage).toBe(icon);
      const frame = atlas.find(f => f.filename === icon);
      expect(frame?.sourceSize, icon).toEqual({ w: 32, h: 32 });
      expect(frame?.trimmed, icon).toBe(false);
      expect(ko[id]?.name, id).toBe(koName);
      expect(ko[id]?.description, id).toBeTruthy();
      expect(en[id]?.name && en[id]?.description, id).toBeTruthy();
      expect(getCustomModifierClass(cls.name)).toBe(cls);
    }
    // the Master TM's icon (the item itself is part B)
    expect(atlas.find(f => f.filename === "master_tm")?.sourceSize).toEqual({ w: 32, h: 32 });
    expect(FULL_RULE_HELD_ITEM_IDS.has("PUNCHING_GLOVE")).toBe(true);
    expect(FULL_RULE_HELD_ITEM_IDS.has("MASTER_PUNCHING_GLOVE")).toBe(true);
  });

  describe("luck clovers", () => {
    it("give leaf 0/0/0/1, clover 1/2/3 and golden 3/6 luck", () => {
      expect([1, 2, 3, 4].map(n => getCloverLuck("FOUR_LEAF_CLOVER_LEAF", n))).toEqual([0, 0, 0, 1]);
      expect([1, 2, 3].map(n => getCloverLuck("FOUR_LEAF_CLOVER", n))).toEqual([1, 2, 3]);
      expect([1, 2].map(n => getCloverLuck("GOLDEN_FOUR_LEAF_CLOVER", n))).toEqual([3, 6]);
      expect(CLOVERS.map(c => LUCK_CLOVERS[c.id].maxStack)).toEqual([4, 3, 2]);
    });

    it("add to the party's luck on top of the shiny luck, capped at 14, and stack only to their max", async () => {
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      const party = game.scene.getPlayerParty();
      expect(getPartyLuckValue(party)).toBe(0);

      addClover("FOUR_LEAF_CLOVER_LEAF", 3);
      expect(getPartyLuckValue(party)).toBe(0); // 3 leaves are not a whole clover yet
      addClover("FOUR_LEAF_CLOVER_LEAF", 1);
      expect(getPartyLuckValue(party)).toBe(1);
      addClover("FOUR_LEAF_CLOVER_LEAF", 1); // a fifth leaf does not stack
      expect(game.scene.findModifier(m => m instanceof FourLeafCloverLeafModifier)!.stackCount).toBe(4);

      addClover("FOUR_LEAF_CLOVER", 2);
      addClover("GOLDEN_FOUR_LEAF_CLOVER", 1);
      expect(getPartyLuckValue(party)).toBe(1 + 2 + 3);

      // shiny luck 7 + clovers 6 = 13; one more golden clover goes past 14 and is capped
      vi.spyOn(party[0], "getLuck").mockReturnValue(7);
      expect(getPartyLuckValue(party)).toBe(13);
      addClover("GOLDEN_FOUR_LEAF_CLOVER", 1);
      expect(getPartyLuckValue(party)).toBe(14);
    });

    it("add to the Daily run's seeded luck too, capped at 14", async () => {
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      const party = game.scene.getPlayerParty();
      const { gameMode } = game.scene;
      gameMode.isDaily = true;
      try {
        const seeded = getPartyLuckValue(party);
        expect(seeded).toBeGreaterThanOrEqual(0);
        addClover("FOUR_LEAF_CLOVER", 3);
        expect(getPartyLuckValue(party)).toBe(Math.min(seeded + 3, 14));
        addClover("GOLDEN_FOUR_LEAF_CLOVER", 2);
        expect(getPartyLuckValue(party)).toBe(Math.min(seeded + 9, 14));
      } finally {
        gameMode.isDaily = false;
      }
    });

    it("sit in GREAT / ULTRA / ROGUE at weights 3 / 3 / 2, left out at their max or once luck is already 14", async () => {
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      const party = game.scene.getPlayerParty();
      for (const { id, tier, weight: weightValue, max } of CLOVERS) {
        const entry = poolEntry(tier, id)!;
        expect(entry, id).toBeDefined();
        expect(entry.maxWeight).toBe(weightValue);
        const weight = entry.weight as WeightedModifierTypeWeightFunc;
        expect(weight(party, 0), id).toBe(weightValue);
        addClover(id, max - 1);
        expect(weight(party, 0), `${id} at ${max - 1}`).toBe(weightValue);
        addClover(id, 1);
        expect(weight(party, 0), `${id} at max`).toBe(0);
      }
      game.scene.removeModifier(game.scene.findModifier(m => m instanceof GoldenFourLeafCloverModifier)!);
      game.scene.removeModifier(game.scene.findModifier(m => m instanceof FourLeafCloverModifier)!);
      const clover = poolEntry(ModifierTier.ULTRA, "FOUR_LEAF_CLOVER")!.weight as WeightedModifierTypeWeightFunc;
      expect(clover(party, 0)).toBe(3);
      vi.spyOn(party[0], "getLuck").mockReturnValue(14); // already SSS without it: it would do nothing
      expect(clover(party, 0)).toBe(0);
    });

    // Local fork (2026-11-11), after review: only the fixed final boss follows, so nothing would read the luck
    it("are left out of the last Classic reward screen (wave 199), like the Amulet Coin", async () => {
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      const party = game.scene.getPlayerParty();
      const weights = () =>
        CLOVERS.map(({ id, tier }) => (poolEntry(tier, id)!.weight as WeightedModifierTypeWeightFunc)(party, 0));
      const amuletCoin = poolEntry(ModifierTier.ULTRA, "AMULET_COIN")!.weight as WeightedModifierTypeWeightFunc;
      expect(weights()).toEqual([3, 3, 2]);
      game.scene.currentBattle.waveIndex = 199;
      expect(amuletCoin(party, 0)).toBe(0);
      expect(weights()).toEqual([0, 0, 0]);
    });

    it("survive the session save as party items with their stack", async () => {
      game.override.startingModifier([
        { name: "FOUR_LEAF_CLOVER_LEAF", count: 3 },
        { name: "FOUR_LEAF_CLOVER", count: 2 },
        { name: "GOLDEN_FOUR_LEAF_CLOVER", count: 1 },
      ]);
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      const { gameData } = game.scene;
      const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
      const session = gameData.parseSessionData(json);
      for (const [{ id, cls }, count] of CLOVERS.map((c, i) => [c, [3, 2, 1][i]] as const)) {
        const saved = session.modifiers.find(m => m.typeId === id)!;
        expect(saved.className).toBe(cls.name);
        const restored = saved.toModifier(Modifier[saved.className]);
        expect(restored).toBeInstanceOf(cls);
        expect(restored!.stackCount).toBe(count);
      }
    });
  });

  describe("punching gloves", () => {
    it("Punching Glove: punches x1.1 power, other contact moves unchanged; Master: contact x1.2, never both", async () => {
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      const user = game.field.getPlayerPokemon();
      const target = game.field.getEnemyPokemon();
      expect(power(MoveId.FIRE_PUNCH, user, target)).toBe(75);

      game.scene.addModifier(gloveType("PUNCHING_GLOVE").newModifier(user), true);
      expect(power(MoveId.FIRE_PUNCH, user, target)).toBe(82.5); // 75 * 11 / 10, exact
      expect(power(MoveId.MACH_PUNCH, user, target)).toBe(44);
      expect(power(MoveId.TACKLE, user, target)).toBe(40);

      // the Master glove supersedes the plain one: x1.2, not x1.32
      game.scene.addModifier(gloveType("MASTER_PUNCHING_GLOVE").newModifier(user), true);
      expect(
        user
          .getHeldItems()
          .map(m => m.type.id)
          .sort(),
      ).toEqual(["MASTER_PUNCHING_GLOVE", "PUNCHING_GLOVE"]);
      expect(power(MoveId.FIRE_PUNCH, user, target)).toBe(90);
      expect(power(MoveId.TACKLE, user, target)).toBe(48);
    });

    it("hide contact from the target's side only: Tough Claws still boosts, Unseen Fist's rule follows the user", async () => {
      game.override.ability(AbilityId.TOUGH_CLAWS).startingHeldItems([{ name: "PUNCHING_GLOVE" }]);
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      const user = game.field.getPlayerPokemon();
      const target = game.field.getEnemyPokemon();
      const contact = (move: MoveId, targetSide: boolean) =>
        allMoves[move].doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user, target, targetSide });

      expect(contact(MoveId.MACH_PUNCH, false)).toBe(true);
      expect(contact(MoveId.MACH_PUNCH, true)).toBe(false);
      expect(contact(MoveId.TACKLE, true)).toBe(true); // the plain glove only covers punches
      expect(power(MoveId.MACH_PUNCH, user, target)).toBeCloseTo(40 * 1.3 * 1.1, 8);
      expect(allMoves[MoveId.MACH_PUNCH].doesFlagEffectApply({ flag: MoveFlags.IGNORE_PROTECT, user, target })).toBe(
        false,
      );
    });

    it("King's Shield still blocks a gloved punch but lowers no Attack; a tackle into it does", async () => {
      game.override.enemyMoveset([MoveId.KINGS_SHIELD, MoveId.SPLASH]).startingHeldItems([{ name: "PUNCHING_GLOVE" }]);
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      const user = game.field.getPlayerPokemon();
      const target = game.field.getEnemyPokemon();

      game.move.select(MoveId.MACH_PUNCH);
      await game.move.selectEnemyMove(MoveId.KINGS_SHIELD);
      await game.toNextTurn();
      expect(target.isFullHp()).toBe(true); // blocked
      expect(user.getStatStage(Stat.ATK)).toBe(0);

      // a turn without protection, so the next King's Shield cannot fail as a consecutive use
      game.move.select(MoveId.SPLASH);
      await game.move.selectEnemyMove(MoveId.SPLASH);
      await game.toNextTurn();

      game.move.select(MoveId.TACKLE);
      await game.move.selectEnemyMove(MoveId.KINGS_SHIELD);
      await game.toNextTurn();
      expect(target.isFullHp()).toBe(true);
      expect(user.getStatStage(Stat.ATK)).toBe(-1);
    });

    it("Rough Skin hurts nothing for a gloved punch, but does for a tackle", async () => {
      game.override.enemyAbility(AbilityId.ROUGH_SKIN).startingHeldItems([{ name: "PUNCHING_GLOVE" }]);
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      const user = game.field.getPlayerPokemon();
      const target = game.field.getEnemyPokemon();

      game.move.select(MoveId.MACH_PUNCH);
      await game.toNextTurn();
      expect(target.isFullHp()).toBe(false);
      expect(user.isFullHp()).toBe(true);

      game.move.select(MoveId.TACKLE);
      await game.toNextTurn();
      expect(user.getMaxHp() - user.hp).toBe(toDmgValue(user.getMaxHp() / 8));
    });

    it("Master glove: contact moves go through King's Shield for 1/4 damage and no Attack drop", async () => {
      game.override.enemyMoveset(MoveId.KINGS_SHIELD).startingHeldItems([{ name: "MASTER_PUNCHING_GLOVE" }]);
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      const user = game.field.getPlayerPokemon();
      const target = game.field.getEnemyPokemon();
      expect(allMoves[MoveId.TACKLE].doesFlagEffectApply({ flag: MoveFlags.IGNORE_PROTECT, user, target })).toBe(true);
      expect(
        allMoves[MoveId.TACKLE].doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user, target, targetSide: true }),
      ).toBe(false);

      const unprotected = target.getAttackDamage({
        source: user,
        move: allMoves[MoveId.TACKLE],
        simulated: true,
      }).damage;
      target.addTag(BattlerTagType.PROTECTED);
      const protectedHit = target.getAttackDamage({
        source: user,
        move: allMoves[MoveId.TACKLE],
        simulated: true,
      }).damage;
      expect(protectedHit).toBe(toDmgValue(unprotected * 0.25));
      target.removeTag(BattlerTagType.PROTECTED);

      game.move.select(MoveId.TACKLE);
      await game.toNextTurn();
      expect(target.isFullHp()).toBe(false);
      expect(user.getStatStage(Stat.ATK)).toBe(0);
    });

    it("Master glove with Unseen Fist: the 1/4 applies once", async () => {
      game.override.ability(AbilityId.UNSEEN_FIST).startingHeldItems([{ name: "MASTER_PUNCHING_GLOVE" }]);
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      const user = game.field.getPlayerPokemon();
      const target = game.field.getEnemyPokemon();
      const unprotected = target.getAttackDamage({
        source: user,
        move: allMoves[MoveId.TACKLE],
        simulated: true,
      }).damage;
      target.addTag(BattlerTagType.PROTECTED);
      const protectedHit = target.getAttackDamage({
        source: user,
        move: allMoves[MoveId.TACKLE],
        simulated: true,
      }).damage;
      expect(protectedHit).toBe(toDmgValue(unprotected * 0.25));
    });

    // Local fork (2026-11-11), after review: the 1/4 rule's gaps
    it("Master glove: one-hit KO moves are still stopped by protection; fixed damage goes through for 1/4", async () => {
      game.override
        .ability(AbilityId.NO_GUARD)
        .moveset([MoveId.GUILLOTINE, MoveId.SEISMIC_TOSS, MoveId.SPLASH])
        .enemyMoveset([MoveId.PROTECT, MoveId.SPLASH])
        .startingHeldItems([{ name: "MASTER_PUNCHING_GLOVE" }]);
      await game.classicMode.startBattle(SpeciesId.MACHAMP);
      const user = game.field.getPlayerPokemon();
      const target = game.field.getEnemyPokemon();
      const ignoresProtect = (move: MoveId) =>
        allMoves[move].doesFlagEffectApply({ flag: MoveFlags.IGNORE_PROTECT, user, target });
      expect(ignoresProtect(MoveId.GUILLOTINE)).toBe(false);
      expect(ignoresProtect(MoveId.SEISMIC_TOSS)).toBe(true);

      const toss = () =>
        target.getAttackDamage({ source: user, move: allMoves[MoveId.SEISMIC_TOSS], simulated: true }).damage;
      expect(toss()).toBe(100);
      target.addTag(BattlerTagType.PROTECTED);
      expect(toss()).toBe(25);
      target.removeTag(BattlerTagType.PROTECTED);

      // a No Guard Guillotine into Protect: blocked, no knockout
      game.move.select(MoveId.GUILLOTINE);
      await game.move.selectEnemyMove(MoveId.PROTECT);
      await game.toNextTurn();
      expect(target.isFullHp()).toBe(true);

      // a turn without protection, so the next Protect cannot fail as a consecutive use
      game.move.select(MoveId.SPLASH);
      await game.move.selectEnemyMove(MoveId.SPLASH);
      await game.toNextTurn();

      game.move.select(MoveId.SEISMIC_TOSS);
      await game.move.selectEnemyMove(MoveId.PROTECT);
      await game.toNextTurn();
      expect(target.getMaxHp() - target.hp).toBe(25);
    });

    it("Master glove: a move that ignores protection by itself is not weakened into it", async () => {
      game.override.startingHeldItems([{ name: "MASTER_PUNCHING_GLOVE" }]);
      await game.classicMode.startBattle(SpeciesId.MACHAMP);
      const user = game.field.getPlayerPokemon();
      const target = game.field.getEnemyPokemon();
      const drill = () =>
        target.getAttackDamage({ source: user, move: allMoves[MoveId.HYPER_DRILL], simulated: true }).damage;
      const open = drill();
      target.addTag(BattlerTagType.PROTECTED);
      expect(drill()).toBe(open);
      // a plain contact move into the same Protect is quartered
      const tackle = target.getAttackDamage({ source: user, move: allMoves[MoveId.TACKLE], simulated: true }).damage;
      target.removeTag(BattlerTagType.PROTECTED);
      const openTackle = target.getAttackDamage({
        source: user,
        move: allMoves[MoveId.TACKLE],
        simulated: true,
      }).damage;
      expect(tackle).toBe(toDmgValue(openTackle * 0.25));
    });

    it.each([
      { ability: AbilityId.BALL_FETCH, name: "alone" },
      { ability: AbilityId.UNSEEN_FIST, name: "with Unseen Fist" },
    ])(
      "Master glove $name: Quick Guard is gone through for 1/4 too, once even with Protect up",
      async ({ ability }) => {
        game.override.ability(ability).startingHeldItems([{ name: "MASTER_PUNCHING_GLOVE" }]);
        await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
        const user = game.field.getPlayerPokemon();
        const target = game.field.getEnemyPokemon();
        const machPunch = () =>
          target.getAttackDamage({ source: user, move: allMoves[MoveId.MACH_PUNCH], simulated: true }).damage;
        const open = machPunch();

        game.scene.arena.addTag(ArenaTagType.QUICK_GUARD, 1, MoveId.QUICK_GUARD, target.id, ArenaTagSide.ENEMY, true);
        expect(machPunch()).toBe(toDmgValue(open * 0.25));
        target.addTag(BattlerTagType.PROTECTED);
        expect(machPunch()).toBe(toDmgValue(open * 0.25));
      },
    );

    it("a Master glove holder leaves the plain glove out of rewards for the whole party (full-item rule)", async () => {
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN, SpeciesId.MACHAMP);
      const party = game.scene.getPlayerParty();
      const plainWeight = poolEntry(ModifierTier.ULTRA, "PUNCHING_GLOVE")!.weight as WeightedModifierTypeWeightFunc;
      expect(plainWeight(party, 0)).toBe(6);
      // Machamp still knows punches and holds no glove, but Hitmonchan's Master glove counts as a full plain glove
      game.scene.addModifier(gloveType("MASTER_PUNCHING_GLOVE").newModifier(party[0]), true);
      expect(partyHoldsMax(party, "PUNCHING_GLOVE")).toBe(true);
      expect(plainWeight(party, 0)).toBe(0);
    });

    it("a Master glove holder is never given a plain glove; a plain holder can take a Master glove", async () => {
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN, SpeciesId.MACHAMP);
      const [chan, champ] = game.scene.getPlayerParty() as PlayerPokemon[];
      game.scene.addModifier(gloveType("MASTER_PUNCHING_GLOVE").newModifier(chan), true);
      game.scene.addModifier(gloveType("PUNCHING_GLOVE").newModifier(champ), true);

      expect(gloveType("PUNCHING_GLOVE").selectFilter!(chan)).not.toBeNull();
      expect(gloveType("MASTER_PUNCHING_GLOVE").selectFilter!(champ)).toBeNull();
      const plain = champ.getHeldItems().find(m => m instanceof PunchingGloveModifier)!;
      expect(game.scene.tryTransferHeldItemModifier(plain, chan, false)).toBe(false);
      const master = chan.getHeldItems().find(m => m instanceof MasterPunchingGloveModifier)!;
      expect(game.scene.tryTransferHeldItemModifier(master, champ, false)).toBe(true);
      expect(
        champ
          .getHeldItems()
          .map(m => m.type.id)
          .sort(),
      ).toEqual(["MASTER_PUNCHING_GLOVE", "PUNCHING_GLOVE"]);
    });

    it("sit in ULTRA at 6 / MASTER at 8 while someone could use them; left out for a Master holder and at the cap", async () => {
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
      const party = game.scene.getPlayerParty();
      const [user] = party;
      const plain = poolEntry(ModifierTier.ULTRA, "PUNCHING_GLOVE")!;
      const master = poolEntry(ModifierTier.MASTER, "MASTER_PUNCHING_GLOVE")!;
      expect([plain.maxWeight, master.maxWeight]).toEqual([6, 8]);
      const plainWeight = plain.weight as WeightedModifierTypeWeightFunc;
      const masterWeight = master.weight as WeightedModifierTypeWeightFunc;
      expect([plainWeight(party, 0), masterWeight(party, 0)]).toEqual([6, 8]);

      // no punching move: no plain glove (a contact move still calls the Master one)
      vi.spyOn(user, "getMoveset").mockReturnValue(user.getMoveset().filter(m => m.moveId === MoveId.TACKLE));
      expect([plainWeight(party, 0), masterWeight(party, 0)]).toEqual([0, 8]);
      vi.mocked(user.getMoveset).mockRestore();

      const held: PokemonHeldItemModifier = gloveType("MASTER_PUNCHING_GLOVE").newModifier(user);
      game.scene.addModifier(held, true);
      expect([plainWeight(party, 0), masterWeight(party, 0)]).toEqual([0, 0]);
    });
  });
});
