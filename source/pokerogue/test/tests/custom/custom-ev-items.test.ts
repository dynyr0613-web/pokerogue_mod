import { speciesDataRegistry } from "#app/global-species-data-registry";
import { activeOverrides } from "#app/overrides";
import { FULL_RULE_HELD_ITEM_IDS } from "#balance/endless-balance";
import { FORK_UNLOCK, isForkItemLocked } from "#balance/fork-unlock";
import { modifierTypes } from "#data/data-lists";
import type { SpeciesFormChange } from "#data/pokemon-forms";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Nature } from "#enums/nature";
import { PokeballType } from "#enums/pokeball";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { PERMANENT_STATS, Stat } from "#enums/stat";
import { TrainerSlot } from "#enums/trainer-slot";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { EvItemModifier, gainEvsFromItems, getCustomModifierClass, getHeldEvItem } from "#modifiers/custom-held-items";
import { ENEMY_CUSTOM_ITEMS } from "#modifiers/enemy-custom-items";
import {
  addEvs,
  EV_ITEM_IDS,
  EV_RULES,
  type EvItemId,
  emptyEvs,
  getEvStatPoints,
  normalizeEvs,
} from "#modifiers/ev-items";
import * as Modifier from "#modifiers/modifier";
import {
  itemPoolChecks,
  type ModifierTypeKeys,
  type PokemonHeldItemModifierType,
  regenerateModifierPoolThresholds,
} from "#modifiers/modifier-type";
import * as EncounterTransformationSequence from "#mystery-encounters/encounter-transformation-sequence";
import * as MysteryEncounters from "#mystery-encounters/mystery-encounter-biomes";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import { runMysteryEncounterToEnd } from "#test/utils/encounter-test-utils";
import type { WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import { EV_ITEM_ICON_SCALE, EV_ITEM_ICONS, getItemIconScale } from "#ui/item-icon-scale";
import { SummaryUiMode } from "#ui/summary-ui-handler";
import { getModifierPoolForType } from "#utils/modifier-utils";
import { existsSync, readFileSync } from "node:fs";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local fork (2026-11-12): EVs (노력치) and the six EV items. The user: "노력치 아이템도 추가해보죠 / 종류별로 전부
 * 로그등급으로, 그 아이템을 지닌 포켓몬이 전투에 관여하여서 경험치를 얻었을 경우(첫 턴에 등장 후 교체만 해도 됨, 학습장치로
 * 경험치를 얻는건 제외), 해당 노력치 +1, 최대 노력치는 252. / 노력치 총합 제한은 없고, 각 노력치 아이템은 파티당 하나만
 * 나온다는 제한만 둡시다 … / 이러면 능력치 계산식에 노력치를 둬야하긴 하겠네요 / 아이콘은 또 코블버스에서 가져온 뒤 배율만
 * 조정하면 됩니다."
 */
describe("Custom - EVs and the EV items", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  const ITEMS = [
    // id, stat, icon, ko name, en name
    ["POWER_WEIGHT", Stat.HP, "power_weight", "파워웨이트", "Power Weight"],
    ["POWER_BRACER", Stat.ATK, "power_bracer", "파워리스트", "Power Bracer"],
    ["POWER_BELT", Stat.DEF, "power_belt", "파워벨트", "Power Belt"],
    ["POWER_LENS", Stat.SPATK, "power_lens", "파워렌즈", "Power Lens"],
    ["POWER_BAND", Stat.SPDEF, "power_band", "파워밴드", "Power Band"],
    ["POWER_ANKLET", Stat.SPD, "power_anklet", "파워앵클릿", "Power Anklet"],
  ] as const;

  /** Gyarados' base stats: HP 95, Atk 125, Def 79, SpA 60, SpD 100, Spe 81 */
  const GYARADOS = [95, 125, 79, 60, 100, 81];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .battleType(BattleType.WILD)
      .mysteryEncounterChance(0)
      .startingLevel(100)
      .enemyLevel(20)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyHasPassiveAbility(false)
      .ability(AbilityId.BALL_FETCH)
      .hasPassiveAbility(false)
      .nature(Nature.HARDY)
      .playerIVs(31)
      .moveset([MoveId.TACKLE, MoveId.HYPER_VOICE, MoveId.SPLASH]);
  });

  afterEach(() => {
    itemPoolChecks.clear();
    vi.restoreAllMocks();
  });

  function poolEntry(tier: ModifierTier, id: string) {
    return getModifierPoolForType(ModifierPoolType.PLAYER)[tier].find(w => w.modifierType.id === id);
  }

  function weightOf(id: string, party: Pokemon[]): number {
    return (poolEntry(ModifierTier.ROGUE, id)!.weight as WeightedModifierTypeWeightFunc)(party, 0);
  }

  function itemType(id: EvItemId): PokemonHeldItemModifierType {
    return modifierTypes[id]().withIdFromFunc(modifierTypes[id]) as PokemonHeldItemModifierType;
  }

  /** Gives `pokemon` one `id`, as a reward does; returns whether it was added */
  function give(pokemon: Pokemon, id: EvItemId): boolean {
    const before = getHeldEvItem(pokemon, id)?.getStackCount() ?? 0;
    game.scene.addModifier(itemType(id).newModifier(pokemon), false, false, false, true);
    return (getHeldEvItem(pokemon, id)?.getStackCount() ?? 0) > before;
  }

  /** The main series' stat formula, in whole numbers (neutral nature) */
  function mainSeriesStat(base: number, iv: number, ev: number, level: number, hp: boolean): number {
    const core = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100);
    return hp ? core + level + 10 : core + 5;
  }

  /** Brings the first enemy down to 1 HP so any hit knocks it out */
  function weakenEnemies(): void {
    for (const enemy of game.scene.getEnemyField()) {
      enemy.hp = 1;
    }
  }

  // Local fork (2026-11-13): HP's cap doubled to 504 ("노력치 아이템도 hp만 상한을 두배로"): the table has
  // hpCapMultiplier, and the helpers hold HP to 504 (custom-hp-growth-items.test.ts tests the rest)
  it("keep every number in one frozen table: 252 per stat (HP x2), floor(EV / 4), +1 per enemy, one held, weight 2", () => {
    expect(Object.isFrozen(EV_RULES) && Object.isFrozen(EV_RULES.items)).toBe(true);
    expect({ ...EV_RULES, items: undefined }).toEqual({
      maxPerStat: 252,
      hpCapMultiplier: 2,
      evsPerStatPoint: 4,
      gainPerEnemy: 1,
      maxHeld: 1,
      poolWeight: 2,
      items: undefined,
    });
    expect(EV_ITEM_IDS).toEqual(ITEMS.map(([id]) => id));
    for (const [id, stat, icon] of ITEMS) {
      expect(EV_RULES.items[id]).toEqual({ stat, icon });
      expect(Object.isFrozen(EV_RULES.items[id])).toBe(true);
    }
    // helpers
    expect(emptyEvs()).toEqual([0, 0, 0, 0, 0, 0]);
    expect([0, 3, 4, 7, 8, 251, 252].map(getEvStatPoints)).toEqual([0, 0, 1, 1, 2, 62, 63]);
    expect(normalizeEvs(undefined)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(normalizeEvs([600, 300, -4, 4.9, "8", Number.NaN])).toEqual([504, 252, 0, 4, 8, 0]);
    const evs = [503, 0, 0, 0, 0, 252];
    expect(addEvs(evs, Stat.HP, 1)).toBe(true);
    expect(addEvs(evs, Stat.HP, 1)).toBe(false);
    expect(addEvs(evs, Stat.SPD, 1)).toBe(false);
    expect(addEvs(evs, Stat.ATK, 5)).toBe(true);
    expect(evs).toEqual([504, 5, 0, 0, 0, 252]);
  });

  it("have Cobblemon icons at 0.7, Korean / English text, a save class, ROGUE pool entries, the full-item rule and the gate", () => {
    const atlas = JSON.parse(readFileSync("./assets/images/items.json", "utf8")).textures[0].frames as {
      filename: string;
      sourceSize: { w: number; h: number };
      trimmed: boolean;
    }[];
    const ko = JSON.parse(readFileSync("./locales/ko/modifier-type.json", "utf8")).ModifierType;
    const en = JSON.parse(readFileSync("./locales/en/modifier-type.json", "utf8")).ModifierType;
    expect(getCustomModifierClass("EvItemModifier")).toBe(EvItemModifier);
    expect(EV_ITEM_ICON_SCALE).toBe(0.7);
    expect(EV_ITEM_ICONS).toEqual(ITEMS.map(([, , icon]) => icon));
    for (const [id, stat, icon, koName, enName] of ITEMS) {
      const type = itemType(id);
      expect(type.iconImage).toBe(icon);
      expect(type.localeKey).toBe(`modifierType:ModifierType.${id}`);
      const frame = atlas.find(f => f.filename === icon);
      expect(frame?.sourceSize, icon).toEqual({ w: 32, h: 32 });
      expect(frame?.trimmed, icon).toBe(false);
      expect(existsSync(`./assets/images/items/${icon}.png`), icon).toBe(true);
      expect(getItemIconScale(icon), icon).toBe(EV_ITEM_ICON_SCALE);
      expect(ko[id]?.name, id).toBe(koName);
      // Local fork (2026-11-13): HP's item says 504
      expect(ko[id]?.description, id).toContain(`노력치가 1 오른다(최대 ${stat === Stat.HP ? 504 : 252}`);
      expect(en[id]?.name, id).toBe(enName);
      expect(en[id]?.description, id).toContain("EVs rise by 1");
      const entry = poolEntry(ModifierTier.ROGUE, id);
      expect(entry?.maxWeight, id).toBe(2);
      expect(entry?.modifierType.tier, id).toBe(ModifierTier.ROGUE);
      for (const other of [ModifierTier.COMMON, ModifierTier.GREAT, ModifierTier.ULTRA, ModifierTier.MASTER]) {
        expect(poolEntry(other, id), `${id} in tier ${other}`).toBeUndefined();
      }
      expect(FULL_RULE_HELD_ITEM_IDS.has(id), id).toBe(true);
      expect(FORK_UNLOCK.gatedItems.has(id), id).toBe(true);
      expect(Stat[stat]).toBeDefined();
    }
    const summaryKo = JSON.parse(readFileSync("./locales/ko/pokemon-summary.json", "utf8"));
    expect([summaryKo.ivs, summaryKo.evs]).toEqual(["개체값", "노력치"]);
  });

  it("add floor(EV / 4) to every stat at levels 50 / 100 / 1000, HP and the others alike", async () => {
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    const gyarados = game.field.getPlayerPokemon();
    expect(gyarados.evs).toEqual([0, 0, 0, 0, 0, 0]);
    expect(gyarados.getNature()).toBe(Nature.HARDY);
    for (const level of [50, 100, 1000]) {
      for (const ev of [0, 3, 4, 252]) {
        gyarados.level = level;
        gyarados.evs = [ev, ev, ev, ev, ev, ev];
        gyarados.calculateStats();
        for (const stat of PERMANENT_STATS) {
          expect(gyarados.getStat(stat, false), `L${level} EV ${ev} ${Stat[stat]}`).toBe(
            mainSeriesStat(GYARADOS[stat], 31, ev, level, stat === Stat.HP),
          );
        }
      }
    }
    // the plain numbers: level 100, HP 331 -> 332 (EV 4) -> 394 (EV 252); Attack 286 -> 287 -> 349
    const at = (level: number, ev: number) => {
      gyarados.level = level;
      gyarados.evs = [ev, ev, 0, 0, 0, 0];
      gyarados.calculateStats();
      return [gyarados.getStat(Stat.HP, false), gyarados.getStat(Stat.ATK, false)];
    };
    expect([at(100, 0), at(100, 4), at(100, 252)]).toEqual([
      [331, 286],
      [332, 287],
      [394, 349],
    ]);
    expect([at(50, 0), at(50, 4), at(50, 252)]).toEqual([
      [170, 145],
      [171, 146],
      [202, 177],
    ]);
    expect([at(1000, 0), at(1000, 4), at(1000, 252)]).toEqual([
      [3220, 2815],
      [3230, 2825],
      [3850, 3445],
    ]);
  });

  it("leave Shedinja's HP at 1 and still raise its other stats", async () => {
    game.override.ability(AbilityId.WONDER_GUARD);
    await game.classicMode.startBattle(SpeciesId.SHEDINJA);
    const shedinja = game.field.getPlayerPokemon();
    const atk = shedinja.getStat(Stat.ATK, false);
    shedinja.evs = [252, 252, 0, 0, 0, 0];
    shedinja.calculateStats();
    expect(shedinja.getMaxHp()).toBe(1);
    expect(shedinja.hp).toBe(1);
    expect(shedinja.getStat(Stat.ATK, false)).toBe(atk + 63);
  });

  it("give +1 in the item's stat to the holder that knocks an enemy out, also at the level cap", async () => {
    game.override.levelCap(50); // the level 100 Gyarados gets no EXP at all
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    const gyarados = game.field.getPlayerPokemon();
    give(gyarados, "POWER_BRACER");
    const atk = gyarados.getStat(Stat.ATK, false);
    const exp = gyarados.exp;
    weakenEnemies();

    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("VictoryPhase");

    expect(gyarados.evs).toEqual([0, 1, 0, 0, 0, 0]);
    // 1 EV is no stat point yet; the stats were recalculated with it
    expect(gyarados.getStat(Stat.ATK, false)).toBe(atk);
    await game.phaseInterceptor.to("BattleEndPhase", false);
    expect(gyarados.exp).toBe(exp);
    expect(gyarados.evs).toEqual([0, 1, 0, 0, 0, 0]);
  });

  it("count a member that was out on the first turn and switched out, but not one that never came out", async () => {
    game.override.levelCap(200);
    await game.classicMode.startBattle(SpeciesId.GYARADOS, SpeciesId.MAGIKARP, SpeciesId.FEEBAS);
    const [gyarados, magikarp, feebas] = game.scene.getPlayerParty();
    give(gyarados, "POWER_BRACER");
    give(magikarp, "POWER_WEIGHT");
    give(feebas, "POWER_LENS"); // stays in the party all battle

    game.doSwitchPokemon(1);
    await game.toNextTurn();
    expect(game.field.getPlayerPokemon()).toBe(magikarp);

    weakenEnemies();
    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("VictoryPhase");

    expect([...game.scene.currentBattle.playerParticipantIds].sort()).toEqual([gyarados.id, magikarp.id].sort());
    expect(gyarados.evs).toEqual([0, 1, 0, 0, 0, 0]);
    expect(magikarp.evs).toEqual([1, 0, 0, 0, 0, 0]);
    expect(feebas.evs).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("give nothing to a holder that gets EXP only through the EXP Share (학습장치)", async () => {
    game.override.levelCap(200).startingModifier([{ name: "EXP_SHARE" }]);
    await game.classicMode.startBattle(SpeciesId.GYARADOS, SpeciesId.MAGIKARP);
    const [gyarados, magikarp] = game.scene.getPlayerParty();
    give(magikarp, "POWER_WEIGHT");
    const exp = magikarp.exp;
    weakenEnemies();

    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("BattleEndPhase", false);

    expect(magikarp.exp).toBeGreaterThan(exp); // the EXP Share's EXP did come
    expect(game.scene.currentBattle.playerParticipantIds.has(magikarp.id)).toBe(false);
    expect(magikarp.evs).toEqual([0, 0, 0, 0, 0, 0]);
    expect(gyarados.evs).toEqual([0, 0, 0, 0, 0, 0]); // holds nothing
  });

  // Local fork (2026-11-13): HP stops at 504 now (was 251 -> 252)
  it("give +2 for two enemies knocked out in a double battle, and stop at the cap (HP 504)", async () => {
    game.override.battleStyle("double").enemyLevel(1);
    await game.classicMode.startBattle(SpeciesId.GYARADOS, SpeciesId.MAGIKARP);
    const [gyarados, magikarp] = game.scene.getPlayerParty();
    give(gyarados, "POWER_BRACER");
    give(magikarp, "POWER_WEIGHT");
    magikarp.evs = [503, 0, 0, 0, 0, 0];
    weakenEnemies();

    game.move.select(MoveId.HYPER_VOICE, BattlerIndex.PLAYER);
    game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
    await game.phaseInterceptor.to("BattleEndPhase", false);

    expect(game.scene.getEnemyParty().every(e => e.isFainted())).toBe(true);
    expect(gyarados.evs).toEqual([0, 2, 0, 0, 0, 0]);
    expect(magikarp.evs).toEqual([504, 0, 0, 0, 0, 0]);
  });

  // Local fork (2026-11-13): HP goes on to 504, so 504 gains and HP 504
  it("have no total cap: one Pokémon holding all six reaches the cap in every stat (252, HP 504)", async () => {
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    const gyarados = game.field.getPlayerPokemon();
    for (const [id] of ITEMS) {
      expect(give(gyarados, id), id).toBe(true);
      expect(give(gyarados, id), `${id} twice`).toBe(false); // one per Pokémon
    }
    let gains = 0;
    while (gainEvsFromItems(gyarados)) {
      gains++;
    }
    expect(gains).toBe(504);
    expect(gyarados.evs).toEqual([504, 252, 252, 252, 252, 252]);
    expect(gyarados.evs.reduce((a, b) => a + b, 0)).toBe(1764);
    for (const stat of PERMANENT_STATS) {
      expect(gyarados.getStat(stat, false), Stat[stat]).toBe(
        mainSeriesStat(GYARADOS[stat], 31, stat === Stat.HP ? 504 : 252, 100, stat === Stat.HP),
      );
    }
  });

  it("keep the EVs through a session save and load; a save without them loads as all 0", async () => {
    await game.classicMode.startBattle(SpeciesId.GYARADOS, SpeciesId.MAGIKARP);
    const [gyarados] = game.scene.getPlayerParty();
    give(gyarados, "POWER_LENS");
    gyarados.evs = [252, 0, 4, 100, 252, 7];
    gyarados.calculateStats();
    gyarados.hp = gyarados.getMaxHp();
    const stats = gyarados.stats.slice();

    const { gameData } = game.scene;
    const json = JSON.stringify(gameData.getSessionSaveData(), (_, v) => (typeof v === "bigint" ? v.toString() : v));
    const session = gameData.parseSessionData(json);
    expect(session.party[0].evs).toEqual([252, 0, 4, 100, 252, 7]);
    expect("evs" in session.party[1]).toBe(false); // no EVs: the save has no field for them
    for (const enemy of session.enemyParty) {
      expect("evs" in enemy).toBe(false);
    }
    const saved = session.modifiers.find(m => m.typeId === "POWER_LENS")!;
    expect(saved.className).toBe("EvItemModifier");
    expect(saved.args).toEqual([gyarados.id, Stat.SPATK]);
    // biome-ignore lint/performance/noDynamicNamespaceImportAccess: the session loader looks classes up by name here
    const restored = saved.toModifier(Modifier[saved.className]) as EvItemModifier;
    expect(restored).toBeInstanceOf(EvItemModifier);
    expect(restored.getStat()).toBe(Stat.SPATK);

    // an old save (before EVs) loads as all 0
    const old = new PokemonData(JSON.parse(JSON.stringify({ ...session.party[0], evs: undefined })));
    expect(old.evs).toBeUndefined();

    game.reload["sessionData"] = session;
    await game.reload.reloadSession();
    const [loaded, loadedKarp] = game.scene.getPlayerParty();
    expect(loaded.evs).toEqual([252, 0, 4, 100, 252, 7]);
    expect(loaded.stats).toEqual(stats);
    expect(loadedKarp.evs).toEqual([0, 0, 0, 0, 0, 0]);
    expect(getHeldEvItem(loaded, "POWER_LENS")?.getStat()).toBe(Stat.SPATK);
  });

  it("an old save's Pokémon (no EVs field) gets all 0", async () => {
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    const gyarados = game.field.getPlayerPokemon();
    gyarados.evs = [10, 10, 10, 10, 10, 10];
    const data = new PokemonData(gyarados);
    delete data.evs;
    const copy = data.toPokemon() as PlayerPokemon;
    expect(copy.evs).toEqual([0, 0, 0, 0, 0, 0]);
    copy.destroy();
  });

  it("keep the EVs through evolution, a Mega Evolution, a fusion (the head's) and unfusing; Shedinja copies Nincada's", async () => {
    await game.classicMode.runToSummon(SpeciesId.CHARMANDER, SpeciesId.NINCADA, SpeciesId.CHARIZARD);
    const [charmander, nincada, charizard] = game.scene.getPlayerParty() as PlayerPokemon[];

    charmander.evs = [0, 252, 0, 0, 0, 0];
    await charmander.evolve(speciesDataRegistry.getEvolutions(SpeciesId.CHARMANDER)[0], charmander.getSpeciesForm());
    expect(charmander.species.speciesId).toBe(SpeciesId.CHARMELEON);
    expect(charmander.evs).toEqual([0, 252, 0, 0, 0, 0]);

    nincada.evs = [8, 0, 0, 0, 0, 12];
    await nincada.evolve(speciesDataRegistry.getEvolutions(SpeciesId.NINCADA)[0], nincada.getSpeciesForm());
    expect(nincada.evs).toEqual([8, 0, 0, 0, 0, 12]);
    const shedinja = game.scene.getPlayerParty().find(p => p.species.speciesId === SpeciesId.SHEDINJA)!;
    expect(shedinja.evs).toEqual([8, 0, 0, 0, 0, 12]);
    expect(shedinja.evs).not.toBe(nincada.evs);

    charizard.evs = [0, 0, 0, 252, 0, 252];
    await charizard.changeForm({ formKey: SpeciesFormKey.MEGA_X } as SpeciesFormChange);
    expect(charizard.getFormKey()).toBe(SpeciesFormKey.MEGA_X);
    expect(charizard.evs).toEqual([0, 0, 0, 252, 0, 252]);

    // the fused Pokémon keeps the head's EVs; the tail's go with its IVs and nature
    charmander.fuse(charizard);
    expect(charmander.isFusion()).toBe(true);
    expect(charmander.evs).toEqual([0, 252, 0, 0, 0, 0]);
    await charmander.unfuse();
    expect(charmander.isFusion()).toBe(false);
    expect(charmander.evs).toEqual([0, 252, 0, 0, 0, 0]);
  });

  it("Shedinja gets Nincada's other held items but not its EV item, which stays one per party", async () => {
    // Local fork (2026-11-12, review): upstream copies every held item of Nincada onto Shedinja; an EV item would then
    // exist twice ("각 노력치 아이템은 파티당 하나만")
    await game.classicMode.runToSummon(SpeciesId.NINCADA);
    const nincada = game.field.getPlayerPokemon();
    give(nincada, "POWER_ANKLET");
    game.scene.addModifier(
      modifierTypes.LEFTOVERS().withIdFromFunc(modifierTypes.LEFTOVERS).newModifier(nincada),
      false,
      false,
      false,
      true,
    );
    await nincada.evolve(speciesDataRegistry.getEvolutions(SpeciesId.NINCADA)[0], nincada.getSpeciesForm());
    const shedinja = game.scene.getPlayerParty().find(p => p.species.speciesId === SpeciesId.SHEDINJA)!;
    expect(shedinja).toBeDefined();
    const ids = (p: Pokemon) => p.getHeldItems().map(m => m.type.id);
    expect(ids(nincada)).toEqual(expect.arrayContaining(["POWER_ANKLET", "LEFTOVERS"]));
    expect(ids(shedinja)).toContain("LEFTOVERS");
    expect(ids(shedinja)).not.toContain("POWER_ANKLET");
    expect(game.scene.findModifiers(m => m instanceof EvItemModifier, true)).toHaveLength(1);
  });

  it("an encounter's copy of a party member gets its EVs as it gets its IVs; other enemies have none", async () => {
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    const gyarados = game.field.getPlayerPokemon();
    gyarados.evs = [0, 252, 0, 0, 0, 0];
    const copy = game.scene.addEnemyPokemon(
      gyarados.species,
      gyarados.level,
      TrainerSlot.NONE,
      true,
      false,
      new PokemonData(gyarados),
    );
    expect(copy.ivs).toEqual(gyarados.ivs);
    expect(copy.evs).toEqual([0, 252, 0, 0, 0, 0]);
    expect(copy.evs).not.toBe(gyarados.evs);
    copy.destroy();
    expect(game.field.getEnemyPokemon().evs).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("sit in the ROGUE pool at 2 each, 0 while any party member holds that one", async () => {
    await game.classicMode.startBattle(SpeciesId.GYARADOS, SpeciesId.MAGIKARP);
    const party = game.scene.getPlayerParty();
    for (const [id] of ITEMS) {
      expect(weightOf(id, party), id).toBe(2);
    }
    give(party[1], "POWER_BELT");
    for (const [id] of ITEMS) {
      expect(weightOf(id, party), id).toBe(id === "POWER_BELT" ? 0 : 2);
    }
    // the other member could hold one, but the party already has it
    expect(itemType("POWER_BELT").selectFilter!(party[0] as PlayerPokemon)).toBeNull();
    game.scene.removeModifier(getHeldEvItem(party[1], "POWER_BELT")!);
    expect(weightOf("POWER_BELT", party)).toBe(2);
  });

  it("move between the player's Pokémon like any held item, one per Pokémon", async () => {
    await game.classicMode.startBattle(SpeciesId.GYARADOS, SpeciesId.MAGIKARP);
    const [gyarados, magikarp] = game.scene.getPlayerParty();
    give(gyarados, "POWER_ANKLET");
    const item = getHeldEvItem(gyarados, "POWER_ANKLET")!;
    expect(item.isTransferable).toBe(true);
    expect(game.scene.tryTransferHeldItemModifier(item, magikarp, false)).toBe(true);
    expect(getHeldEvItem(gyarados, "POWER_ANKLET")).toBeUndefined();
    expect(getHeldEvItem(magikarp, "POWER_ANKLET")?.getStat()).toBe(Stat.SPD);

    // a holder cannot take a second one
    give(gyarados, "POWER_ANKLET");
    const second = getHeldEvItem(gyarados, "POWER_ANKLET")!;
    expect(game.scene.tryTransferHeldItemModifier(second, magikarp, false)).toBe(false);
    expect(getHeldEvItem(magikarp, "POWER_ANKLET")!.getStackCount()).toBe(1);
  });

  it("never go to enemies: in no enemy pool or enemy item list, and an enemy holder gains nothing", async () => {
    for (const poolType of [
      ModifierPoolType.WILD,
      ModifierPoolType.TRAINER,
      ModifierPoolType.ENEMY_BUFF,
      ModifierPoolType.DAILY_STARTER,
    ]) {
      const ids = Object.values(getModifierPoolForType(poolType))
        .flat()
        .map(w => w.modifierType.id);
      for (const [id] of ITEMS) {
        expect(ids, `${id} in pool ${ModifierPoolType[poolType]}`).not.toContain(id);
      }
    }
    const enemyIds: string[] = ENEMY_CUSTOM_ITEMS.candidates.map(c => c.id);
    for (const [id] of ITEMS) {
      expect(enemyIds).not.toContain(id);
    }

    game.override.enemyHeldItems([{ name: "POWER_BRACER" }]);
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    const enemy = game.field.getEnemyPokemon();
    expect(enemy.getHeldItems().some(m => m instanceof EvItemModifier)).toBe(true);
    expect(gainEvsFromItems(enemy)).toBe(false);
    expect(enemy.evs).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("are not offered before the first Classic clear", async () => {
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    const party = game.scene.getPlayerParty();
    const offered = () => {
      for (const [id] of ITEMS) {
        itemPoolChecks.set(id as ModifierTypeKeys, undefined);
      }
      regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0);
      return ITEMS.map(([id]) => itemPoolChecks.get(id as ModifierTypeKeys));
    };
    expect(offered()).toEqual(ITEMS.map(() => true));

    game.override.forkContentUnlocked(false);
    for (const [id] of ITEMS) {
      expect(isForkItemLocked(id), id).toBe(true);
    }
    expect(offered()).toEqual(ITEMS.map(() => false));

    game.override.forkContentUnlocked(true);
    expect(offered()).toEqual(ITEMS.map(() => true));
  });

  it("follow the EXP: a lead switched out at the opening switch prompt gets no EXP and no EVs; the one sent in does", async () => {
    // "첫 턴에 등장 후 교체만 해도 됨" counts a switch on the first turn (the participant test above); the free switch the
    // "Switch" battle style offers before the first turn leaves the lead out of the battle's participants, and so out of
    // its EXP, as in the base game ("경험치를 얻었을 경우")
    game.override.levelCap(200);
    await game.classicMode.runToSummon(SpeciesId.FEEBAS, SpeciesId.GYARADOS);
    const [feebas, gyarados] = game.scene.getPlayerParty();
    give(feebas, "POWER_WEIGHT");
    give(gyarados, "POWER_BRACER");
    await game.classicMode.startBattleWithSwitch(1);
    expect(game.field.getPlayerPokemon()).toBe(gyarados);
    const exp = feebas.exp;
    weakenEnemies();

    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("BattleEndPhase", false);

    expect([...game.scene.currentBattle.playerParticipantIds]).toEqual([gyarados.id]);
    expect(feebas.exp).toBe(exp);
    expect(feebas.evs).toEqual([0, 0, 0, 0, 0, 0]);
    expect(gyarados.evs).toEqual([0, 1, 0, 0, 0, 0]);
  });

  it("are never taken by an enemy, so catching a thief cannot bring a second one into the party", async () => {
    game.override.enemyMoveset(MoveId.THIEF);
    await game.classicMode.startBattle(SpeciesId.GYARADOS, SpeciesId.MAGIKARP);
    const gyarados = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    give(gyarados, "POWER_BRACER");
    const leftovers = modifierTypes.LEFTOVERS().withIdFromFunc(modifierTypes.LEFTOVERS) as PokemonHeldItemModifierType;
    game.scene.addModifier(leftovers.newModifier(gyarados), false, false, false, true);
    const bracer = getHeldEvItem(gyarados, "POWER_BRACER")!;
    expect(bracer.isTransferable).toBe(true); // still moved in the party menu
    expect(game.scene.canTakeHeldItem(bracer, enemy)).toBe(false);

    // Thief (30%, forced) takes the Leftovers, never the EV item of the same tier
    const frac = vi.spyOn(Phaser.Math.RND, "frac").mockReturnValue(0);
    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();
    expect(enemy.getHeldItems().map(m => m.type.id)).toEqual(["LEFTOVERS"]);
    expect(getHeldEvItem(gyarados, "POWER_BRACER")).toBe(bracer);
    // and then finds nothing to take
    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();
    expect(enemy.getHeldItems().map(m => m.type.id)).toEqual(["LEFTOVERS"]);
    expect(getHeldEvItem(gyarados, "POWER_BRACER")).toBe(bracer);
    frac.mockRestore();
    // the Grip Claw's and the Mini Black Hole's roll (HeldItemTransferModifier) finds nothing either
    const holeType = modifierTypes.MINI_BLACK_HOLE().withIdFromFunc(modifierTypes.MINI_BLACK_HOLE);
    const hole = (holeType as PokemonHeldItemModifierType).newModifier(enemy) as Modifier.TurnHeldItemTransferModifier;
    expect(hole.apply(enemy)).toBe(false);

    // catching the thief brings the Leftovers back, and the party still has one Power Bracer
    game.scene.pokeballCounts[PokeballType.MASTER_BALL] = 1;
    game.doThrowPokeball(PokeballType.MASTER_BALL);
    await game.phaseInterceptor.to("TurnEndPhase");
    const party = game.scene.getPlayerParty();
    expect(party).toHaveLength(3);
    expect(party.filter(p => getHeldEvItem(p, "POWER_BRACER"))).toEqual([gyarados]);
    expect(party[2].getHeldItems().map(m => m.type.id)).toEqual(["LEFTOVERS"]);
  });

  describe("in the Weird Dream (이상한 꿈)", () => {
    beforeEach(() => {
      vi.spyOn(activeOverrides, "BATTLE_TYPE_OVERRIDE", "get").mockReturnValue(null);
      game.override.mysteryEncounterChance(100).startingWave(45).startingBiome(BiomeId.CAVE).disableTrainerWaves();
      vi.spyOn(EncounterTransformationSequence, "doPokemonTransformationSequence").mockResolvedValue();
      vi.spyOn(MysteryEncounters, "mysteryEncountersByBiome", "get").mockReturnValue(
        new Map<BiomeId, MysteryEncounterType[]>([[BiomeId.CAVE, [MysteryEncounterType.WEIRD_DREAM]]]),
      );
    });

    const PARTY = [SpeciesId.MAGBY, SpeciesId.HAUNTER, SpeciesId.ABRA];
    const EVS = [
      [252, 252, 0, 0, 0, 0],
      [0, 0, 100, 0, 252, 4],
      [8, 0, 0, 252, 0, 252],
    ];

    /** The stat points `pokemon`'s EVs add to each stat (its stats minus its stats without EVs) */
    function evPoints(pokemon: Pokemon): number[] {
      pokemon.calculateStats();
      const withEvs = pokemon.stats.slice();
      const evs = pokemon.evs;
      pokemon.evs = emptyEvs();
      pokemon.calculateStats();
      const without = pokemon.stats.slice();
      pokemon.evs = evs;
      pokemon.calculateStats();
      return withEvs.map((v, s) => v - without[s]);
    }

    it("a transformed Pokémon keeps its EVs (accepting the dream)", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.WEIRD_DREAM, PARTY);
      const before = game.scene.getPlayerParty().slice();
      before.forEach((p, i) => {
        p.evs = EVS[i].slice();
      });

      await runMysteryEncounterToEnd(game, 1);
      await game.phaseInterceptor.to("SelectModifierPhase", false);

      const after = game.scene.getPlayerParty();
      expect(after).toHaveLength(3);
      after.forEach((p, i) => {
        expect(p.species.speciesId, `${i}`).not.toBe(before[i].species.speciesId);
        expect(p.evs, `${i}`).toEqual(EVS[i]);
        expect(p.evs, `${i}`).not.toBe(before[i].evs);
        // the stats already count them: floor(EV / 4) at level 100 with the neutral nature the dream rolls
        const stats = p.stats.slice();
        expect(evPoints(p), `${i}`).toEqual(EVS[i].map(getEvStatPoints));
        expect(p.stats, `${i}`).toEqual(stats);
      });
    });

    it("the 'future self' team copies the party's EVs as it copies the IVs; the party keeps its own", async () => {
      game.override.enemyLevel(100); // the party's level, so floor(EV / 4) shows as it is
      await game.runToMysteryEncounter(MysteryEncounterType.WEIRD_DREAM, PARTY);
      const party = game.scene.getPlayerParty().slice();
      party.forEach((p, i) => {
        p.evs = EVS[i].slice();
      });

      await runMysteryEncounterToEnd(game, 2, undefined, true);

      const enemies = game.scene.getEnemyParty();
      expect(enemies).toHaveLength(3);
      enemies.forEach((e, i) => {
        expect(e.evs, `${i}`).toEqual(EVS[i]);
        expect(e.evs, `${i}`).not.toBe(party[i].evs);
        const stats = e.stats.slice();
        expect(evPoints(e), `${i}`).toEqual(EVS[i].map(getEvStatPoints));
        expect(e.stats, `${i}`).toEqual(stats);
      });
      expect(game.scene.getPlayerParty().map(p => p.evs)).toEqual(EVS);
    });
  });

  it("show on the summary's stats page as a third view (stats -> 개체값 -> 노력치), the EV alone per stat", async () => {
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    const gyarados = game.field.getPlayerPokemon();
    gyarados.evs = [252, 0, 4, 100, 252, 7];
    const texts = vi.spyOn(game.scene.add, "text");

    await game.scene.ui.setModeWithoutClear(UiMode.SUMMARY, gyarados, SummaryUiMode.DEFAULT, 1 /* Page.STATS */);
    type View = { visible: boolean; list: unknown[] };
    const summary = game.scene.ui.getHandler() as unknown as {
      permStatsContainer: View;
      ivContainer: View;
      evContainer: View;
      statsViewLabel: { text: string; visible?: boolean };
      processInput(button: Button): boolean;
    };
    // what each text object of the EV view was made with (the mock text keeps no content)
    const contentOf = new Map<unknown, unknown>(texts.mock.results.map((r, i) => [r.value, texts.mock.calls[i][2]]));
    const evTexts = summary.evContainer.list.map(o => contentOf.get(o));
    expect(evTexts).toHaveLength(12);
    const statNames = PERMANENT_STATS.map(s => i18next.t(`pokemonInfo:stat.${Stat[s].toLowerCase()}`));
    expect(evTexts.filter((_, i) => i % 2 === 0)).toEqual(statNames);
    // the EV alone: "EV/252" (42 px at 100 and over) did not fit the right-hand column's 40 px value box (x 174-213);
    // the emerald font's digits are 6 px, so three digits are 18 px
    const values = evTexts.filter((_, i) => i % 2 === 1);
    expect(values).toEqual(["252", "0", "4", "100", "252", "7"]);
    expect(values.every(v => /^\d{1,3}$/.test(String(v)))).toBe(true);

    const shown = () => [summary.permStatsContainer.visible, summary.ivContainer.visible, summary.evContainer.visible];
    expect(shown()).toEqual([true, false, false]);
    expect(summary.statsViewLabel.text).toBe("");
    summary.processInput(Button.ACTION);
    expect(shown()).toEqual([false, true, false]);
    expect(summary.statsViewLabel.text).toBe(i18next.t("pokemonSummary:ivs"));
    summary.processInput(Button.ACTION);
    expect(shown()).toEqual([false, false, true]);
    expect(summary.statsViewLabel.text).toBe(i18next.t("pokemonSummary:evs"));
    summary.processInput(Button.ACTION);
    expect(shown()).toEqual([true, false, false]);
    expect(summary.statsViewLabel.text).toBe("");
  });
});
