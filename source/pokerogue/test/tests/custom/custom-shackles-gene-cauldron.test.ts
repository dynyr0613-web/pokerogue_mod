import { FULL_RULE_HELD_ITEM_IDS } from "#balance/endless-balance";
import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import type { EffectiveStat } from "#enums/stat";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import {
  FlameCauldronModifier,
  FlameFurnaceModifier,
  getCustomModifierClass,
  SHACKLES_GENE_CAULDRON,
  TrainingShacklesModifier,
  UltimateGeneModifier,
} from "#modifiers/custom-held-items";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import * as Modifier from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import { PartyUiHandler } from "#ui/party-ui-handler";
import { SummaryUiHandler, SummaryUiMode } from "#ui/summary-ui-handler";
import { NumberHolder } from "#utils/common";
import { getModifierPoolForType } from "#utils/modifier-utils";
import { readFileSync } from "node:fs";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local fork (2026-11-09): Training Shackles (트레이닝족쇄, ROGUE, up to 2), Ultimate Gene (궁극유전자, MASTER, one) and
 * Flame Cauldron (화염가마솥, ROGUE, one). The user: "트레이닝 족쇄(착용시 스피드 절반, 나머지 모든 스탯 1.1배)(2개까지
 * 가능, 2개면 스피드1/3, 모든 스탯 2.2배)(등급 로그)랑 궁극유전자(마스터)(모든 스탯 1.2배, 뮤츠/메가뮤츠X/메가뮤츠Y가 사용
 * 시 효과 두배, 최대 하나), 화염가마솥(근성/열폭주를 템으로 만든 버전, 근성과 다르게 화사에만 발동, 로그 등급) 추가해두죠".
 */
describe("Custom held items - Training Shackles, Ultimate Gene, Flame Cauldron", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(5)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH, MoveId.TACKLE]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const newItems = [
    { name: "TRAINING_SHACKLES", icon: "training_shackles", cls: TrainingShacklesModifier, cap: 2 },
    { name: "ULTIMATE_GENE", icon: "ultimate_gene", cls: UltimateGeneModifier, cap: 1 },
    { name: "FLAME_CAULDRON", icon: "flame_cauldron", cls: FlameCauldronModifier, cap: 1 },
  ] as const;
  type NewName = (typeof newItems)[number]["name"];
  /** The other stat items they must never stack with or be capped against */
  const otherStatItems = [
    "CHOICE_BAND",
    "CHOICE_SCARF",
    "CHOICE_SPECS",
    "CHOICE_ARMOR",
    "ASSAULT_VEST",
    "BULLETPROOF_VEST",
    "EVIOLITE",
    "RED_EVOLUTION_CRYSTAL",
    "BLUE_EVOLUTION_CRYSTAL",
  ] as const;
  type ItemName = NewName | (typeof otherStatItems)[number];
  const nonHpStats = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD] as const;

  /** A fresh item for `pokemon`, with its type id set the way `overrideHeldItems` and the reward pools do. */
  function newItem(name: ItemName, pokemon: Pokemon): PokemonHeldItemModifier {
    return modifierTypes[name]().withIdFromFunc(modifierTypes[name]).newModifier(pokemon) as PokemonHeldItemModifier;
  }

  function heldItem(pokemon: Pokemon, id: string): PokemonHeldItemModifier | undefined {
    return pokemon.getHeldItems().find(m => m.type.id === id);
  }

  /**
   * The stat with held items is the stat without them times `numerator / denominator`, floored as `getEffectiveStat`
   * does. Local fork (2026-11-09): whole numbers keep the expected value exact (`Math.floor(175 * 1.4)` is 244, the
   * right answer 245), so a float slip in the item shows up here instead of being copied.
   */
  function expectMultiplier(pokemon: Pokemon, stat: EffectiveStat, numerator: number, denominator = 1): void {
    const base = pokemon.getEffectiveStat(stat, { ignoreHeldItems: true });
    expect(pokemon.getEffectiveStat(stat), `${Stat[stat]} x${numerator}/${denominator} of ${base}`).toBe(
      Math.floor((base * numerator) / denominator),
    );
  }

  /** Max HP after every stat-boosting held item: HP is never touched */
  function hpAfterItems(pokemon: Pokemon): number {
    const hp = new NumberHolder(pokemon.getMaxHp());
    game.scene.applyModifiers(Modifier.StatBoosterModifier, pokemon.isPlayer(), pokemon, Stat.HP, hp);
    return hp.value;
  }

  /** Fuse `ally`'s species into `pokemon` (as the upstream Eviolite test does, after `PlayerPokemon.fuse`) */
  function fuse(pokemon: Pokemon, ally: Pokemon): void {
    pokemon.fusionSpecies = ally.species;
    pokemon.fusionFormIndex = ally.formIndex;
    pokemon.fusionAbilityIndex = ally.abilityIndex;
    pokemon.fusionShiny = ally.shiny;
    pokemon.fusionVariant = ally.variant;
    pokemon.fusionGender = ally.gender;
    pokemon.fusionLuck = ally.luck;
  }

  type SummaryInternals = {
    getHeldItemBoostedStat(s: Stat): number | null;
    getHeldItemStatStyle(s: Stat, boosted: number | null): TextStyle;
  };

  async function openSummary(pokemon: Pokemon): Promise<SummaryInternals> {
    await game.scene.ui.setModeWithoutClear(UiMode.SUMMARY, pokemon, SummaryUiMode.DEFAULT, 1 /* Page.STATS */);
    return game.scene.ui.getHandler() as unknown as SummaryInternals;
  }

  function poolEntry(tier: ModifierTier, id: string) {
    return getModifierPoolForType(ModifierPoolType.PLAYER)[tier].find(w => w.modifierType.id === id);
  }

  it("keep every number in one table: the user's numbers", () => {
    expect(SHACKLES_GENE_CAULDRON.TRAINING_SHACKLES.maxHeld).toBe(2);
    expect(SHACKLES_GENE_CAULDRON.TRAINING_SHACKLES.poolWeight).toBe(4);
    expect(SHACKLES_GENE_CAULDRON.TRAINING_SHACKLES.raisedStats).toEqual([Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF]);
    // Local fork (2026-11-10): the other stats x1.2 / x1.4 (were x1.1 / x2.2), Speed unchanged
    expect(SHACKLES_GENE_CAULDRON.TRAINING_SHACKLES.byCount).toEqual([
      { speed: 1 / 2, othersTenths: 12 },
      { speed: 1 / 3, othersTenths: 14 },
    ]);
    expect(SHACKLES_GENE_CAULDRON.ULTIMATE_GENE).toEqual({
      maxHeld: 1,
      poolWeight: 8,
      stats: [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD],
      tenths: 12,
      boostedTenths: 14,
      boostedSpecies: [SpeciesId.MEWTWO],
    });
    // Local fork (2026-11-10): the cauldron has no effect of its own; the furnace it becomes has the x1.5
    expect(SHACKLES_GENE_CAULDRON.FLAME_CAULDRON).toEqual({ maxHeld: 1, poolWeight: 4 });
    expect(SHACKLES_GENE_CAULDRON.FLAME_FURNACE).toEqual({
      maxHeld: 1,
      stats: [Stat.ATK, Stat.SPATK],
      multiplier: 1.3,
    });
  });

  it("have their icons, locale keys and Korean / English text, and load back from saves by class name", () => {
    // Local fork (2026-11-09): the icons are untrimmed 32x32 frames of the items atlas, plus the Flame Cauldron's
    // flaming look (installed by tools/port/install_user_item_icons.py)
    const atlas = JSON.parse(readFileSync("./assets/images/items.json", "utf8"));
    const frames: { filename: string; sourceSize: { w: number; h: number }; trimmed: boolean }[] =
      atlas.textures[0].frames;
    for (const icon of [...newItems.map(i => i.icon), "flame_cauldron_lit"]) {
      const frame = frames.find(f => f.filename === icon);
      expect(frame, icon).toBeDefined();
      expect(frame!.sourceSize, icon).toEqual({ w: 32, h: 32 });
      expect(frame!.trimmed, icon).toBe(false);
    }
    for (const { name, icon, cls } of newItems) {
      expect(modifierTypes[name]().iconImage).toBe(icon);
      expect(modifierTypes[name]().localeKey).toBe(`modifierType:ModifierType.${name}`);
      expect(getCustomModifierClass(cls.name)).toBe(cls);
      expect(FULL_RULE_HELD_ITEM_IDS.has(name), name).toBe(true);
    }
    for (const [lang, expected] of [
      [
        "ko",
        {
          TRAINING_SHACKLES: {
            name: "트레이닝족쇄",
            description:
              "지니게 하면 스피드가 절반이 되는 대신 공격·방어·특수공격·특수방어가 1.2배가 된다. 2개를 지니면 스피드가 1/3이 되고 그 능력들이 1.4배가 된다.",
          },
          ULTIMATE_GENE: {
            name: "궁극유전자",
            description: "지니게 하면 공격·방어·특수공격·특수방어·스피드가 1.2배가 된다. 뮤츠가 지니면 1.4배가 된다.",
          },
          FLAME_CAULDRON: {
            name: "화염가마솥",
            description: "무언가 타고 남은 재가 담긴 솥이다, 다시 불을 붙일 무언가가 필요한 듯 하다.",
          },
        },
      ],
      [
        "en",
        {
          TRAINING_SHACKLES: { name: "Training Shackles" },
          ULTIMATE_GENE: { name: "Ultimate Gene" },
          FLAME_CAULDRON: { name: "Flame Cauldron" },
        },
      ],
    ] as const) {
      const json = JSON.parse(readFileSync(`./locales/${lang}/modifier-type.json`, "utf8"));
      const entries: Record<string, { name: string; description: string }> = json.ModifierType;
      const keys = Object.keys(entries);
      for (const { name } of newItems) {
        expect(entries[name], `${lang} ${name}`).toMatchObject(expected[name]);
        expect(entries[name].description, `${lang} ${name}`).toBeTruthy();
      }
      // Next to each other, in this order
      expect(keys.indexOf("ULTIMATE_GENE"), lang).toBe(keys.indexOf("TRAINING_SHACKLES") + 1);
      expect(keys.indexOf("FLAME_CAULDRON"), lang).toBe(keys.indexOf("TRAINING_SHACKLES") + 2);
    }
    // The in-game Korean words the descriptions use
    const info = JSON.parse(readFileSync("./locales/ko/pokemon-info.json", "utf8"));
    expect([info.stat.atk, info.stat.def, info.stat.spatk, info.stat.spdef, info.stat.spd]).toEqual([
      "공격",
      "방어",
      "특수공격",
      "특수방어",
      "스피드",
    ]);
    expect(JSON.parse(readFileSync("./locales/ko/status-effect.json", "utf8")).burn.name).toBe("화상");
    expect(JSON.parse(readFileSync("./locales/ko/pokemon.json", "utf8")).mewtwo).toBe("뮤츠");
  });

  describe("Training Shackles (트레이닝족쇄)", () => {
    it("one: Speed x1/2, Attack / Defense / Sp. Atk / Sp. Def x1.2, HP unchanged; the summary shows Speed in blue", async () => {
      game.override.startingHeldItems([{ name: "TRAINING_SHACKLES" }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();
      const shackles = heldItem(snorlax, "TRAINING_SHACKLES") as TrainingShacklesModifier;
      expect(shackles).toBeInstanceOf(TrainingShacklesModifier);
      expect(shackles).toBeInstanceOf(Modifier.StatBoosterModifier);
      expect(shackles.stackCount).toBe(1);
      expect(shackles.isTransferable).toBe(true);
      expect(shackles.getMultipliers()).toEqual({ speed: 1 / 2, others: 1.2 });

      expectMultiplier(snorlax, Stat.SPD, 1, 2);
      for (const stat of [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF] as const) {
        expectMultiplier(snorlax, stat, 12, 10);
      }
      expect(hpAfterItems(snorlax)).toBe(snorlax.getMaxHp());

      const styles = vi.spyOn(SummaryUiHandler.prototype as unknown as SummaryInternals, "getHeldItemStatStyle");
      const summary = await openSummary(snorlax);
      const speed = summary.getHeldItemBoostedStat(Stat.SPD);
      expect(speed).toBe(Math.floor(snorlax.getStat(Stat.SPD) / 2));
      expect(summary.getHeldItemStatStyle(Stat.SPD, speed)).toBe(TextStyle.SUMMARY_BLUE);
      const atk = summary.getHeldItemBoostedStat(Stat.ATK);
      expect(atk).toBe(Math.floor((snorlax.getStat(Stat.ATK) * 12) / 10));
      expect(summary.getHeldItemStatStyle(Stat.ATK, atk)).toBe(TextStyle.SUMMARY_GREEN);
      expect(summary.getHeldItemStatStyle(Stat.ATK, null)).toBe(TextStyle.WINDOW_ALT);
      // The stats page drew Speed with the lowered style and the four others with the raised one
      const drawn = styles.mock.calls.map((call, i) => [call[0], styles.mock.results[i].value]);
      expect(drawn).toEqual(
        expect.arrayContaining([
          [Stat.SPD, TextStyle.SUMMARY_BLUE],
          [Stat.ATK, TextStyle.SUMMARY_GREEN],
          [Stat.DEF, TextStyle.SUMMARY_GREEN],
          [Stat.SPATK, TextStyle.SUMMARY_GREEN],
          [Stat.SPDEF, TextStyle.SUMMARY_GREEN],
        ]),
      );
      expect(drawn.some(([stat, style]) => stat === Stat.SPD && style !== TextStyle.SUMMARY_BLUE)).toBe(false);
    });

    it("two: Speed x1/3, the other four x1.4, HP unchanged", async () => {
      game.override.startingHeldItems([{ name: "TRAINING_SHACKLES", count: 2 }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();
      const shackles = heldItem(snorlax, "TRAINING_SHACKLES") as TrainingShacklesModifier;
      expect(snorlax.getHeldItems()).toHaveLength(1);
      expect(shackles.stackCount).toBe(2);
      expect(shackles.getMultipliers()).toEqual({ speed: 1 / 3, others: 1.4 });

      expectMultiplier(snorlax, Stat.SPD, 1, 3);
      for (const stat of [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF] as const) {
        expectMultiplier(snorlax, stat, 14, 10);
      }
      expect(hpAfterItems(snorlax)).toBe(snorlax.getMaxHp());

      const summary = await openSummary(snorlax);
      const speed = summary.getHeldItemBoostedStat(Stat.SPD);
      expect(speed).toBe(Math.floor(snorlax.getStat(Stat.SPD) / 3));
      expect(summary.getHeldItemStatStyle(Stat.SPD, speed)).toBe(TextStyle.SUMMARY_BLUE);
      expect(summary.getHeldItemBoostedStat(Stat.DEF)).toBe(Math.floor((snorlax.getStat(Stat.DEF) * 14) / 10));
    });

    it("stack to 2 and no further; a single pair moves onto a holder of one but not onto a holder of two", async () => {
      game.override.startingHeldItems([{ name: "TRAINING_SHACKLES" }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);
      const [snorlax, feebas] = game.scene.getPlayerParty();
      const shackles = heldItem(snorlax, "TRAINING_SHACKLES")!;
      expect(shackles.getMaxHeldItemCount(snorlax)).toBe(2);
      expect(shackles.getMaxStackCount()).toBe(2);

      const feebasShackles = newItem("TRAINING_SHACKLES", feebas);
      game.scene.addModifier(feebasShackles, true);
      expect(game.scene.tryTransferHeldItemModifier(feebasShackles, snorlax, false)).toBe(true);
      // The transfer replaces the holder's stack with a new one of 2
      const pair = heldItem(snorlax, "TRAINING_SHACKLES")!;
      expect(pair).toBeInstanceOf(TrainingShacklesModifier);
      expect(pair.stackCount).toBe(2);
      expect(snorlax.getHeldItems()).toHaveLength(1);
      expect(heldItem(feebas, "TRAINING_SHACKLES")).toBeUndefined();

      game.scene.addModifier(newItem("TRAINING_SHACKLES", snorlax), true);
      expect(heldItem(snorlax, "TRAINING_SHACKLES")!.stackCount).toBe(2);
      const another = newItem("TRAINING_SHACKLES", feebas);
      game.scene.addModifier(another, true);
      expect(game.scene.tryTransferHeldItemModifier(another, snorlax, false)).toBe(false);
      expect(heldItem(snorlax, "TRAINING_SHACKLES")!.stackCount).toBe(2);
      expect(heldItem(feebas, "TRAINING_SHACKLES")!.stackCount).toBe(1);
      expect(shackles.getMaxHeldItemCount(feebas)).toBe(2);
      // An enemy's cap is 2 as well
      const magikarp = game.field.getEnemyPokemon();
      expect(newItem("TRAINING_SHACKLES", magikarp).getMaxHeldItemCount(magikarp)).toBe(2);
    });
  });

  describe("Ultimate Gene (궁극유전자)", () => {
    it("raises every stat but HP by 1.2 on anyone but Mewtwo, green on the summary", async () => {
      game.override.startingHeldItems([{ name: "ULTIMATE_GENE" }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();
      const gene = heldItem(snorlax, "ULTIMATE_GENE") as UltimateGeneModifier;
      expect(gene).toBeInstanceOf(UltimateGeneModifier);
      expect(gene.isTransferable).toBe(true);
      expect(UltimateGeneModifier.isBoostedHolder(snorlax)).toBe(false);
      expect(gene.getMultiplierFor(snorlax)).toBe(1.2);
      for (const stat of nonHpStats) {
        expectMultiplier(snorlax, stat, 12, 10);
      }
      expect(hpAfterItems(snorlax)).toBe(snorlax.getMaxHp());

      const summary = await openSummary(snorlax);
      for (const stat of nonHpStats) {
        const shown = summary.getHeldItemBoostedStat(stat);
        expect(shown, Stat[stat]).toBe(Math.floor(snorlax.getStat(stat) * 1.2));
        expect(summary.getHeldItemStatStyle(stat, shown)).toBe(TextStyle.SUMMARY_GREEN);
      }
    });

    it("gives Mewtwo x1.4 in its normal, Mega X and Mega Y forms; HP unchanged", async () => {
      game.override.startingHeldItems([{ name: "ULTIMATE_GENE" }]);
      await game.classicMode.startBattle(SpeciesId.MEWTWO);
      const mewtwo = game.field.getPlayerPokemon();
      const gene = heldItem(mewtwo, "ULTIMATE_GENE") as UltimateGeneModifier;

      for (const formKey of ["", SpeciesFormKey.MEGA_X, SpeciesFormKey.MEGA_Y]) {
        const formIndex = mewtwo.species.forms.findIndex(f => f.formKey === formKey);
        expect(formIndex, formKey).toBeGreaterThanOrEqual(0);
        mewtwo.formIndex = formIndex;
        mewtwo.calculateStats();
        expect(mewtwo.species.forms[mewtwo.formIndex].formKey).toBe(formKey);
        expect(mewtwo.getSpeciesForm(true).speciesId).toBe(SpeciesId.MEWTWO);
        expect(UltimateGeneModifier.isBoostedHolder(mewtwo), formKey).toBe(true);
        expect(gene.getMultiplierFor(mewtwo)).toBe(1.4);
        for (const stat of nonHpStats) {
          expectMultiplier(mewtwo, stat, 14, 10);
        }
        expect(hpAfterItems(mewtwo)).toBe(mewtwo.getMaxHp());
      }
    });

    // Local fork (2026-11-09): a reviewer found Mewtwo 1 point low on these stats while x1.4 was a float multiply
    it("gives Mewtwo an exact x1.4: 175 becomes 245 in battle and on the summary, not 244", async () => {
      game.override.startingHeldItems([{ name: "ULTIMATE_GENE" }]);
      await game.classicMode.startBattle(SpeciesId.MEWTWO);
      const mewtwo = game.field.getPlayerPokemon();
      const summary = await openSummary(mewtwo);
      for (const [value, expected] of [
        [45, 63],
        [175, 245],
        [180, 252],
        [350, 490],
        [700, 980],
      ] as const) {
        // Each one floors 1 low as a float multiply (175 * 1.4 is 244.99999999999997)
        expect(Math.floor(value * 1.4), `${value} * 1.4`).toBe(expected - 1);
        for (const stat of nonHpStats) {
          mewtwo.setStat(stat, value);
          expect(mewtwo.getEffectiveStat(stat), `${Stat[stat]} ${value}`).toBe(expected);
          expect(summary.getHeldItemBoostedStat(stat), `summary ${Stat[stat]} ${value}`).toBe(expected);
        }
      }
      expect((heldItem(mewtwo, "ULTIMATE_GENE") as UltimateGeneModifier).getTenthsFor(mewtwo)).toBe(14);
    });

    it("gives a fusion x1.4 when Mewtwo is either of its species, x1.2 otherwise", async () => {
      game.override.startingHeldItems([{ name: "ULTIMATE_GENE" }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.MEWTWO, SpeciesId.FEEBAS);
      const [snorlax, mewtwo, feebas] = game.scene.getPlayerParty();
      const gene = heldItem(snorlax, "ULTIMATE_GENE") as UltimateGeneModifier;
      const snorlaxSpecies = snorlax.species;

      for (const [holderSpecies, fusionSource, tenths] of [
        [snorlaxSpecies, mewtwo, 14],
        [mewtwo.species, feebas, 14],
        [snorlaxSpecies, feebas, 12],
      ] as const) {
        snorlax.species = holderSpecies;
        fuse(snorlax, fusionSource);
        expect(snorlax.isFusion()).toBe(true);
        expect(gene.getTenthsFor(snorlax)).toBe(tenths);
        expect(gene.getMultiplierFor(snorlax)).toBe(tenths / 10);
        for (const stat of nonHpStats) {
          expectMultiplier(snorlax, stat, tenths, 10);
        }
      }
    });

    it("is one per Pokémon: a second copy and a transfer onto a holder are refused", async () => {
      game.override.startingHeldItems([{ name: "ULTIMATE_GENE" }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);
      const [snorlax, feebas] = game.scene.getPlayerParty();
      const gene = heldItem(snorlax, "ULTIMATE_GENE")!;
      expect(gene.getMaxHeldItemCount(snorlax)).toBe(1);
      game.scene.addModifier(newItem("ULTIMATE_GENE", snorlax), true);
      expect(gene.stackCount).toBe(1);
      const feebasGene = newItem("ULTIMATE_GENE", feebas);
      game.scene.addModifier(feebasGene, true);
      expect(game.scene.tryTransferHeldItemModifier(feebasGene, snorlax, false)).toBe(false);
      expect(gene.stackCount).toBe(1);
      expect(heldItem(feebas, "ULTIMATE_GENE")).toBe(feebasGene);
    });
  });

  // Local fork (2026-11-10): the user reworked it: "화염가마솥(기본) 설명: 무언가 타고 남은 재가 담긴 솥이다 … (화염구슬
  // 삼키고 나서) 불꽃화로 … 공격과 특수공격을 1.5배로 만들어준다 … 보상 테이블에서 등장하지 않는 마스터볼 등급 아이템", and
  // "화염구슬을 잘 흡수하는지에 대한 테스트는 안돌려도 됩니다" (so no absorb tests here)
  describe("Flame Cauldron (화염가마솥) and Flame Furnace (불꽃화로)", () => {
    it("the cauldron does nothing by itself, even while burned", async () => {
      game.override.startingHeldItems([{ name: "FLAME_CAULDRON" }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();
      expect(heldItem(snorlax, "FLAME_CAULDRON")).toBeInstanceOf(FlameCauldronModifier);
      snorlax.doSetStatus(StatusEffect.BURN);
      for (const stat of nonHpStats) {
        expectMultiplier(snorlax, stat, 1);
      }
    });

    it("the furnace raises Attack and Sp. Atk x1.3 always (nerfed from x1.5), is MASTER tier and in no reward pool", async () => {
      game.override.startingHeldItems([{ name: "FLAME_FURNACE" }]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();
      const furnace = heldItem(snorlax, "FLAME_FURNACE")!;
      expect(furnace).toBeInstanceOf(FlameFurnaceModifier);
      expect(furnace.getMaxHeldItemCount(snorlax)).toBe(1);
      expect(furnace.type.iconImage).toBe("flame_cauldron_lit");
      expect(getCustomModifierClass("FlameFurnaceModifier")).toBe(FlameFurnaceModifier);
      expectMultiplier(snorlax, Stat.ATK, 13, 10);
      expectMultiplier(snorlax, Stat.SPATK, 13, 10);
      for (const stat of [Stat.DEF, Stat.SPDEF, Stat.SPD] as const) {
        expectMultiplier(snorlax, stat, 1);
      }
      expect(hpAfterItems(snorlax)).toBe(snorlax.getMaxHp());
      expect(modifierTypes.FLAME_FURNACE().tier).toBe(ModifierTier.MASTER);
      const pool = getModifierPoolForType(ModifierPoolType.PLAYER);
      expect(
        Object.values(pool)
          .flat()
          .some(w => w.modifierType.id === "FLAME_FURNACE"),
      ).toBe(false);
      for (const lang of ["ko", "en"]) {
        const entry = JSON.parse(readFileSync(`./locales/${lang}/modifier-type.json`, "utf8")).ModifierType
          .FLAME_FURNACE;
        expect(entry.name, lang).toBe(lang === "ko" ? "불꽃화로" : "Flame Furnace");
      }
    });

    // Local fork (2026-11-10): the user's bug report: "불꽃화로가 있는데 화염가마솥이 나옴 + 화염가마솥이 불꽃화로 있는
    // 포켓몬한테 줄 수 있음"
    it("a Flame Furnace keeps the cauldron out of rewards, and its holder cannot take a cauldron", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);
      const party = game.scene.getPlayerParty();
      const [snorlax, feebas] = party;
      const weight = poolEntry(ModifierTier.ROGUE, "FLAME_CAULDRON")!.weight as WeightedModifierTypeWeightFunc;
      expect(weight(party, 0)).toBe(4);
      game.scene.addModifier(
        modifierTypes.FLAME_FURNACE().withIdFromFunc(modifierTypes.FLAME_FURNACE).newModifier(snorlax),
        true,
      );
      expect(heldItem(snorlax, "FLAME_FURNACE")).toBeDefined();
      expect(weight(party, 0)).toBe(0);

      // Refused for the furnace holder by the reward's party filter, the party menu and a transfer; Feebas can take one
      expect(modifierTypes.FLAME_CAULDRON().selectFilter!(snorlax as PlayerPokemon)).not.toBeNull();
      expect(modifierTypes.FLAME_CAULDRON().selectFilter!(feebas as PlayerPokemon)).toBeNull();
      const feebasCauldron = newItem("FLAME_CAULDRON", feebas);
      game.scene.addModifier(feebasCauldron, true);
      expect(PartyUiHandler.FilterItemMaxStacks(snorlax as PlayerPokemon, feebasCauldron)).not.toBeNull();
      expect(game.scene.tryTransferHeldItemModifier(feebasCauldron, snorlax, false)).toBe(false);
      expect(heldItem(snorlax, "FLAME_CAULDRON")).toBeUndefined();
      expect(heldItem(feebas, "FLAME_CAULDRON")).toBeDefined();
    });

    // Local fork (2026-11-09): the user: "화염구슬의 드롭 조건도 설정이 되었나요? 화염구슬이 특정 조건에서만 등장하는
    // 아이템이다보니". Upstream offers the Flame Orb only to Guts / Quick Feet / Marvel Scale / Magic Guard / Flare
    // Boost or Facade / Psycho Shift users; a cauldron holder now counts too.
    const orb = (name: "FLAME_ORB" | "TOXIC_ORB", pokemon: Pokemon) =>
      modifierTypes[name]().withIdFromFunc(modifierTypes[name]).newModifier(pokemon) as PokemonHeldItemModifier;

    it("makes the Flame Orb show up in rewards for its holder, who has none of the upstream reasons", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
      const party = game.scene.getPlayerParty();
      const [snorlax, feebas, magikarp] = party;
      const weight = poolEntry(ModifierTier.ULTRA, "FLAME_ORB")!.weight as WeightedModifierTypeWeightFunc;
      // Ball Fetch, Splash and Tackle: no upstream reason
      expect(weight(party, 0)).toBe(0);

      game.scene.addModifier(newItem("FLAME_CAULDRON", snorlax), true);
      expect(weight(party, 0)).toBe(10);

      // Not once the holder already holds an orb (Toxic Orb included, as upstream)
      game.scene.addModifier(orb("TOXIC_ORB", snorlax), true);
      expect(weight(party, 0)).toBe(0);
      expect(game.scene.tryTransferHeldItemModifier(heldItem(snorlax, "TOXIC_ORB")!, feebas, false)).toBe(true);
      expect(weight(party, 0)).toBe(10);

      // The fork's full-item rule (2026-11-06): one Flame Orb anywhere in the party leaves it out (Magikarp: Feebas
      // already holds the Toxic Orb, and a Pokémon holds only one orb)
      game.scene.addModifier(orb("FLAME_ORB", magikarp), true);
      expect(heldItem(magikarp, "FLAME_ORB")).toBeDefined();
      expect(weight(party, 0)).toBe(0);
    });

    it("does not bring the Flame Orb to a holder that cannot be burned (a Fire type)", async () => {
      game.override.startingHeldItems([{ name: "FLAME_CAULDRON" }]);
      await game.classicMode.startBattle(SpeciesId.CHARMANDER);
      const party = game.scene.getPlayerParty();
      expect(heldItem(party[0], "FLAME_CAULDRON")).toBeDefined();
      const weight = poolEntry(ModifierTier.ULTRA, "FLAME_ORB")!.weight as WeightedModifierTypeWeightFunc;
      expect(weight(party, 0)).toBe(0);
    });

    // Local fork (2026-11-10): the furnace counted as an orb at first; the user: "불꽃화로를 든 근성/열폭주 포켓몬 …
    // 화염 … 구슬이 나오도록 하죠"
    it("a furnace holder with Guts still brings the Flame Orb, which it then keeps", async () => {
      game.override.ability(AbilityId.GUTS);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const party = game.scene.getPlayerParty();
      const snorlax = party[0];
      const weight = poolEntry(ModifierTier.ULTRA, "FLAME_ORB")!.weight as WeightedModifierTypeWeightFunc;
      const furnace = modifierTypes.FLAME_FURNACE().withIdFromFunc(modifierTypes.FLAME_FURNACE).newModifier(snorlax);
      game.scene.addModifier(furnace as PokemonHeldItemModifier, true);
      expect(weight(party, 0)).toBe(10);
      game.scene.addModifier(orb("FLAME_ORB", snorlax), true);
      expect(heldItem(snorlax, "FLAME_ORB")).toBeDefined();
      expect(heldItem(snorlax, "FLAME_FURNACE")).toBeDefined();
      expect(weight(party, 0)).toBe(0);
    });

    it("a furnace alone is no reason for the Flame Orb", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const party = game.scene.getPlayerParty();
      const weight = poolEntry(ModifierTier.ULTRA, "FLAME_ORB")!.weight as WeightedModifierTypeWeightFunc;
      const furnace = modifierTypes.FLAME_FURNACE().withIdFromFunc(modifierTypes.FLAME_FURNACE).newModifier(party[0]);
      game.scene.addModifier(furnace as PokemonHeldItemModifier, true);
      expect(weight(party, 0)).toBe(0);
    });
  });

  it("never match, stack with or get capped by each other or the other stat items (Choice items, vests, Eviolites)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);
    const [snorlax, feebas] = game.scene.getPlayerParty();
    const names = [...newItems.map(i => i.name), ...otherStatItems] as const;
    const items = names.map(name => newItem(name, snorlax));
    for (const a of items) {
      for (const b of items) {
        expect(a.matchType(b), `${a.type.id} vs ${b.type.id}`).toBe(a.type.id === b.type.id);
      }
    }
    // A second copy of each new item matches the first
    for (const { name } of newItems) {
      expect(newItem(name, feebas).matchType(items[names.indexOf(name)]), name).toBe(true);
    }

    // All on one Pokémon: every one is its own stack of 1
    for (const item of items) {
      game.scene.addModifier(item, true);
    }
    expect(snorlax.getHeldItems()).toHaveLength(names.length);
    expect(snorlax.getHeldItems().every(m => m.stackCount === 1)).toBe(true);
    // ...and the new ones still move onto it from Feebas (Training Shackles up to 2)
    for (const { name } of newItems) {
      const moving = newItem(name, feebas);
      game.scene.addModifier(moving, true);
      const expected = name === "TRAINING_SHACKLES";
      expect(game.scene.tryTransferHeldItemModifier(moving, snorlax, false), name).toBe(expected);
    }
    expect(heldItem(snorlax, "TRAINING_SHACKLES")!.stackCount).toBe(2);
    expect(heldItem(snorlax, "CHOICE_BAND")!.stackCount).toBe(1);
  });

  it("all held together multiply: two shackles, the gene and a Flame Furnace", async () => {
    game.override.startingHeldItems([
      { name: "TRAINING_SHACKLES", count: 2 },
      { name: "ULTIMATE_GENE" },
      { name: "FLAME_FURNACE" }, // Local fork (2026-11-10): the furnace has the cauldron's old x1.5
    ]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const snorlax = game.field.getPlayerPokemon();
    const raw = (stat: EffectiveStat) => snorlax.getEffectiveStat(stat, { ignoreHeldItems: true });
    // In the order the items were added: shackles, gene (in tenths, Local fork 2026-11-09), furnace
    // Local fork (2026-11-10): two shackles x1.4 in tenths (were x2.2)
    expect(snorlax.getEffectiveStat(Stat.ATK)).toBe(Math.floor(((((raw(Stat.ATK) * 14) / 10) * 12) / 10) * 1.3));
    expect(snorlax.getEffectiveStat(Stat.DEF)).toBe(Math.floor((((raw(Stat.DEF) * 14) / 10) * 12) / 10));
    expect(snorlax.getEffectiveStat(Stat.SPD)).toBe(Math.floor((raw(Stat.SPD) * (1 / 3) * 12) / 10));
    const summary = await openSummary(snorlax);
    const speed = summary.getHeldItemBoostedStat(Stat.SPD);
    expect(summary.getHeldItemStatStyle(Stat.SPD, speed)).toBe(TextStyle.SUMMARY_BLUE);
  });

  describe("save data", () => {
    it("each saves only the holder's id and comes back as its own class (shackles keep a stack of 2)", async () => {
      game.override.startingHeldItems([
        { name: "TRAINING_SHACKLES", count: 2 },
        { name: "ULTIMATE_GENE" },
        { name: "FLAME_CAULDRON" },
      ]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const snorlax = game.field.getPlayerPokemon();
      snorlax.doSetStatus(StatusEffect.BURN);

      const { gameData } = game.scene;
      const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
      const session = gameData.parseSessionData(json);
      for (const { name, cls, cap } of newItems) {
        const item = heldItem(snorlax, name)!;
        const args = [snorlax.id];
        expect(item.getArgs(), name).toEqual(args);
        expect(item.clone()).toBeInstanceOf(cls);
        expect(item.clone().getArgs()).toEqual(args);
        expect(item.clone().stackCount).toBe(item.stackCount);

        // A new instance from the saved args (what `ModifierData.toModifier` does)
        const rebuilt = new (getCustomModifierClass(cls.name)!)(item.type, ...item.getArgs(), item.stackCount);
        expect(rebuilt).toBeInstanceOf(cls);
        expect(rebuilt.match(item)).toBe(true);

        const saved = session.modifiers.find(m => m.typeId === name)!;
        expect(saved.className).toBe(cls.name);
        expect(saved.args).toEqual(args);
        expect(saved.stackCount).toBe(cap);
        // `GameData.loadSession` looks the class up in the `modifier.ts` namespace, where it is absent
        expect(Modifier[saved.className]).toBeUndefined();
        const restored = saved.toModifier(Modifier[saved.className]) as PokemonHeldItemModifier;
        expect(restored).toBeInstanceOf(cls);
        expect(restored.type.id).toBe(name);
        expect(restored.pokemonId).toBe(snorlax.id);
        expect(restored.stackCount).toBe(cap);
        expect(restored.match(item)).toBe(true);
        saved.stackCount = 3;
        expect(saved.toModifier(Modifier[saved.className])!.stackCount, name).toBe(cap);
        saved.stackCount = cap;
      }
    });

    it("survive a full session reload with the same effective stats", async () => {
      game.override.startingHeldItems([
        { name: "TRAINING_SHACKLES", count: 2 },
        { name: "ULTIMATE_GENE" },
        { name: "FLAME_CAULDRON" },
      ]);
      await game.classicMode.startBattle(SpeciesId.MEWTWO);
      const mewtwo = game.field.getPlayerPokemon();
      const stats = nonHpStats.map(s => mewtwo.getEffectiveStat(s));

      const { gameData } = game.scene;
      const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
      game.reload["sessionData"] = gameData.parseSessionData(json);
      await game.reload.reloadSession();

      const loaded = game.field.getPlayerPokemon();
      expect(loaded).not.toBe(mewtwo);
      expect(
        loaded
          .getHeldItems()
          .map(m => `${m.type.id}x${m.stackCount}`)
          .sort(),
      ).toEqual(["FLAME_CAULDRONx1", "TRAINING_SHACKLESx2", "ULTIMATE_GENEx1"]);
      expect(nonHpStats.map(s => loaded.getEffectiveStat(s))).toEqual(stats);
      expect(heldItem(loaded, "TRAINING_SHACKLES")).toBeInstanceOf(TrainingShacklesModifier);
      expect(heldItem(loaded, "ULTIMATE_GENE")).toBeInstanceOf(UltimateGeneModifier);
      expect(heldItem(loaded, "FLAME_CAULDRON")).toBeInstanceOf(FlameCauldronModifier);
    });
  });

  describe("reward pool", () => {
    it("Training Shackles and Flame Cauldron sit in ROGUE at weight 4, the gene in MASTER at 8; each left out at the cap", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.FEEBAS);
      const party = game.scene.getPlayerParty();
      const [snorlax, feebas] = party;

      for (const [name, tier, weightValue, cap] of [
        ["TRAINING_SHACKLES", ModifierTier.ROGUE, 4, 2],
        ["FLAME_CAULDRON", ModifierTier.ROGUE, 4, 1],
        ["ULTIMATE_GENE", ModifierTier.MASTER, 8, 1],
      ] as const) {
        const entry = poolEntry(tier, name)!;
        expect(entry, name).toBeDefined();
        expect(entry.modifierType.tier).toBe(tier);
        expect(entry.maxWeight).toBe(weightValue);
        // In no other tier
        for (const other of [
          ModifierTier.COMMON,
          ModifierTier.GREAT,
          ModifierTier.ULTRA,
          ModifierTier.ROGUE,
          ModifierTier.MASTER,
        ]) {
          if (other !== tier) {
            expect(poolEntry(other, name), `${name} in tier ${other}`).toBeUndefined();
          }
        }
        const weight = entry.weight as WeightedModifierTypeWeightFunc;
        expect(weight, name).toBeInstanceOf(Function);
        expect(weight(party, 0)).toBe(weightValue);

        // One holder at the cap is enough to leave it out (Feebas could still take one: the full-item rule)
        const held = newItem(name, snorlax);
        game.scene.addModifier(held, true);
        const stack = heldItem(snorlax, name)!;
        stack.stackCount = cap - 1;
        if (cap > 1) {
          expect(weight(party, 0), `${name} at ${cap - 1}/${cap}`).toBe(weightValue);
        }
        stack.stackCount = cap;
        expect(heldItem(feebas, name)).toBeUndefined();
        expect(weight(party, 0), `${name} at ${cap}/${cap}`).toBe(0);
        game.scene.removeModifier(stack);
        expect(weight(party, 0)).toBe(weightValue);
      }
    });

    it("are not in the trainer, wild, enemy buff or daily starter pools", () => {
      for (const poolType of [
        ModifierPoolType.TRAINER,
        ModifierPoolType.WILD,
        ModifierPoolType.ENEMY_BUFF,
        ModifierPoolType.DAILY_STARTER,
      ]) {
        const ids = Object.values(getModifierPoolForType(poolType))
          .flat()
          .map(w => w.modifierType.id);
        for (const { name } of newItems) {
          expect(ids, `${poolType} ${name}`).not.toContain(name);
        }
      }
    });
  });
});
