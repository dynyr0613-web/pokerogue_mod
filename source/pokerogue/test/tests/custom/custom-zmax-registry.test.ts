// Local fork (2026-11-16): Z-Moves and Max Moves (tools/drive/zmax_1116/design_spec.md), role A1. The move registry,
// the generated data tables (src/data/moves/zmax-data.ts) and a few effects of the registry entries, used directly as
// moveset moves (the per-slot conversion itself is tested with move-transform.ts).
// The user: "다이사탕 사용 시 원하는 기술을 다이 기술로 바꿈 / 해당 포켓몬의 전용기는 거다이 기술로 바꿈 (멜메탈: 불릿펀치 ->
// 다이스틸, 더블펀처 -> 거다이융격)" and "새로운 기술 다이검무: 칼춤의 다이기술, 공격 랭크 3업".
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { getPokemonNameWithAffix } from "#app/messages";
import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { MoveTarget } from "#enums/move-target";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import { isMasterTmMove } from "#modifiers/custom-consumables";
import { getProtectPierce, ZPowerAttr } from "#moves/move";
import {
  EXCLUSIVE_Z,
  GMAX_MOVES,
  getMaxMovePower,
  getZMovePower,
  getZStatusEffect,
  isZMaxOnlyMove,
  MAX_MOVE_BY_TYPE,
  Z_MOVE_BY_TYPE,
  ZMAX_ONLY_MOVES,
  ZMAX_RULES,
} from "#moves/zmax-data";
import { GameManager } from "#test/framework/game-manager";
import i18next from "i18next";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** The 18 regular types, in enum order */
const TYPES = Array.from({ length: 18 }, (_, i) => i as PokemonType);

describe("Z/Max moves 2026-11-16: registry", () => {
  it("appends the 33 G-Max moves and 다이검무 after Blindside (ids 925-958)", () => {
    expect(MoveId.G_MAX_WILDFIRE).toBe(MoveId.BLINDSIDE + 1);
    expect(MoveId.G_MAX_WILDFIRE).toBe(925);
    expect(MoveId.G_MAX_RAPID_FLOW).toBe(957);
    expect(MoveId.MAX_SWORDS_DANCE).toBe(958);
    expect(MoveId[MoveId.MAX_SWORDS_DANCE + 1]).toBeUndefined();
    expect(allMoves.length).toBe(MoveId.MAX_SWORDS_DANCE + 1);
    expect(allMoves.every((move, index) => move.id === index)).toBe(true);
  });

  it("implements every Z / Max / G-Max id (106), with a name and no (N) suffix", () => {
    expect(ZMAX_ONLY_MOVES.size).toBe(106);
    for (const id of ZMAX_ONLY_MOVES) {
      const move = allMoves[id];
      expect(move.isUnimplemented, MoveId[id]).toBe(false);
      expect(move.name, MoveId[id]).not.toMatch(/\((N|P)\)$/);
      expect(move.name.length, MoveId[id]).toBeGreaterThan(0);
    }
    expect(allMoves[MoveId.MAX_SWORDS_DANCE].name).toBe("Max Swords Dance");
  });

  it("makes every Z / Max / G-Max attack never miss, single target, priority 0 and contactless", () => {
    for (const id of ZMAX_ONLY_MOVES) {
      const move = allMoves[id];
      if (!move.is("AttackMove")) {
        continue;
      }
      expect(move.accuracy, MoveId[id]).toBe(-1);
      expect(move.moveTarget, MoveId[id]).toBe(MoveTarget.NEAR_ENEMY);
      expect(move.priority, MoveId[id]).toBe(0);
      expect(move.hasFlag(MoveFlags.MAKES_CONTACT), MoveId[id]).toBe(false);
      expect(getProtectPierce(move), MoveId[id]).toBeDefined();
    }
  });

  it("pierces protection for 1/4, One Blow / Rapid Flow for full damage through Max Guard", () => {
    const plain = getProtectPierce(allMoves[MoveId.MAX_FLARE])!;
    expect(plain.multiplier).toBe(ZMAX_RULES.protectPierceMultiplier);
    expect(plain.ignoresMaxGuard).toBe(false);
    for (const id of [MoveId.G_MAX_ONE_BLOW, MoveId.G_MAX_RAPID_FLOW]) {
      const pierce = getProtectPierce(allMoves[id])!;
      expect(pierce.multiplier).toBe(1);
      expect(pierce.ignoresMaxGuard).toBe(true);
    }
    expect(getProtectPierce(allMoves[MoveId.TACKLE])).toBeUndefined();
  });

  it("gives Drum Solo / Fireball / Hydrosnipe 160 power and ignores abilities", () => {
    for (const id of [MoveId.G_MAX_DRUM_SOLO, MoveId.G_MAX_FIREBALL, MoveId.G_MAX_HYDROSNIPE]) {
      expect(allMoves[id].power).toBe(160);
      expect(allMoves[id].hasFlag(MoveFlags.IGNORE_ABILITIES)).toBe(true);
    }
  });

  it("makes Max Guard a +4 Protect with its own tag, and 다이검무 Attack +3 without being a dance", () => {
    const maxGuard = allMoves[MoveId.MAX_GUARD];
    expect(maxGuard.priority).toBe(4);
    expect(maxGuard.pp).toBe(10);
    expect(maxGuard.getAttrs("ProtectAttr")[0].tagType).toBe(BattlerTagType.MAX_GUARD);

    const maxSwordsDance = allMoves[MoveId.MAX_SWORDS_DANCE];
    expect(maxSwordsDance.pp).toBe(20);
    expect(maxSwordsDance.type).toBe(PokemonType.NORMAL);
    const [boost] = maxSwordsDance.getAttrs("StatStageChangeAttr");
    expect(boost.stats).toEqual([Stat.ATK]);
    expect(boost.stages).toBe(3);
    expect(maxSwordsDance.hasFlag(MoveFlags.DANCE_MOVE)).toBe(false);
  });
});

describe("Z/Max moves 2026-11-16: zmax-data", () => {
  it("follows the user's Melmetal example: Bullet Punch -> Max 90, Double Iron Bash -> Max 140 / Z 180", () => {
    expect(getMaxMovePower(MoveId.BULLET_PUNCH)).toBe(90);
    expect(getMaxMovePower(MoveId.DOUBLE_IRON_BASH)).toBe(140);
    expect(getZMovePower(MoveId.DOUBLE_IRON_BASH)).toBe(180);
    const melmetal = GMAX_MOVES[`${SpeciesId.MELMETAL}:gigantamax`];
    expect(melmetal.move).toBe(MoveId.G_MAX_MELTDOWN);
    expect(melmetal.signature).toBe(MoveId.DOUBLE_IRON_BASH);
  });

  it("uses the fork's power for default-rule rows and the proposed values for custom moves", () => {
    // Slash is 80 in the fork (Showdown 70): Z 160 / Max 130 instead of 140 / 120
    expect(getZMovePower(MoveId.SLASH)).toBe(160);
    expect(getMaxMovePower(MoveId.SLASH)).toBe(130);
    expect(getZMovePower(MoveId.SUBLIMATION)).toBe(160);
    expect(getMaxMovePower(MoveId.SUBLIMATION)).toBe(130);
    expect(getMaxMovePower(MoveId.CLOSE_COMBAT)).toBe(95); // Fighting: the low table
    expect(getMaxMovePower(MoveId.SWORDS_DANCE)).toBe(0);
    expect(getZMovePower(MoveId.STRUGGLE)).toBe(0);
  });

  it("gives Z-status bonuses from Showdown and the proposals", () => {
    expect(getZStatusEffect(MoveId.SWORDS_DANCE)).toEqual({ effect: "clearnegativeboost" });
    expect(getZStatusEffect(MoveId.SPLASH)).toEqual({ boost: { atk: 3 } });
    expect(getZStatusEffect(MoveId.GARDENING)).toEqual({ boost: { def: 1 } });
    expect(getZStatusEffect(MoveId.NO_RETREAT)).toEqual({ effect: "clearnegativeboost" });
    expect(getZStatusEffect(MoveId.METRONOME)).toBeNull();
    expect(getZStatusEffect(MoveId.TACKLE)).toBeNull();
  });

  it("maps every type to its Max Move and its two Z-Moves", () => {
    expect(MAX_MOVE_BY_TYPE[PokemonType.NORMAL]).toBe(MoveId.MAX_STRIKE);
    expect(MAX_MOVE_BY_TYPE[PokemonType.STEEL]).toBe(MoveId.MAX_STEELSPIKE);
    expect(Z_MOVE_BY_TYPE[PokemonType.FIGHTING]).toEqual({
      physical: MoveId.ALL_OUT_PUMMELING__PHYSICAL,
      special: MoveId.ALL_OUT_PUMMELING__SPECIAL,
    });
    for (const type of TYPES) {
      expect(allMoves[MAX_MOVE_BY_TYPE[type]].type, PokemonType[type]).toBe(type);
      expect(allMoves[Z_MOVE_BY_TYPE[type].physical].type, PokemonType[type]).toBe(type);
      expect(allMoves[Z_MOVE_BY_TYPE[type].special].type, PokemonType[type]).toBe(type);
    }
  });

  it("lists 33 G-Max forms that exist in the fork's species data, each with a G-Max move of its type", () => {
    const entries = Object.entries(GMAX_MOVES);
    expect(entries).toHaveLength(33);
    for (const [key, info] of entries) {
      const [speciesId, formKey] = key.split(":");
      const species = speciesDataRegistry.getSpecies(Number(speciesId) as SpeciesId);
      expect(
        species.forms.some(f => f.formKey === formKey),
        key,
      ).toBe(true);
      expect(allMoves[info.move].type, key).toBe(info.type);
      if (info.signature != null) {
        expect(allMoves[info.signature].type, key).toBe(info.type);
      }
    }
    expect(GMAX_MOVES[`${SpeciesId.URSHIFU}:gigantamax-rapid`].signature).toBe(MoveId.SURGING_STRIKES);
    expect(GMAX_MOVES[`${SpeciesId.EEVEE}:gigantamax`].signature).toBeUndefined();
    expect(GMAX_MOVES[`${SpeciesId.RILLABOOM}:gigantamax`].fixedPower).toBe(160);
  });

  it("lists the 16 exclusive crystals with existing species and form keys", () => {
    expect(EXCLUSIVE_Z).toHaveLength(16);
    expect(new Set(EXCLUSIVE_Z.map(e => e.key)).size).toBe(16);
    for (const crystal of EXCLUSIVE_Z) {
      expect(allMoves[crystal.zMove].type, crystal.key).toBe(crystal.type);
      expect(isZMaxOnlyMove(crystal.zMove), crystal.key).toBe(true);
      for (const { speciesId, formKeys } of crystal.species) {
        const species = speciesDataRegistry.getSpecies(speciesId);
        expect(species, crystal.key).toBeDefined();
        for (const formKey of formKeys ?? []) {
          expect(
            species.forms.some(f => f.formKey === formKey),
            `${crystal.key} ${formKey}`,
          ).toBe(true);
        }
      }
    }
    expect(EXCLUSIVE_Z.find(e => e.key === "ULTRANECROZIUM_Z_CRYSTAL")?.icon).toBe("ultranecrozium_z_crystal");
  });
});

describe("Z/Max moves 2026-11-16: effects", () => {
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
      .enemyLevel(100)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .enemyHeldItems([]);
  });

  it("keeps the Z / Max ids out of Metronome & co. and the Master TM", async () => {
    await game.classicMode.startBattle(SpeciesId.CLEFABLE);
    const metronome = allMoves[MoveId.METRONOME].getAttrs("RandomMoveAttr")[0] as unknown as {
      isMoveAllowed(move: MoveId): boolean;
    };
    expect(metronome.isMoveAllowed(MoveId.TACKLE)).toBe(true);
    for (const id of [MoveId.MAX_FLARE, MoveId.G_MAX_MELTDOWN, MoveId.BREAKNECK_BLITZ__PHYSICAL, MoveId.MAX_GUARD]) {
      expect(metronome.isMoveAllowed(id), MoveId[id]).toBe(false);
      expect(isMasterTmMove(id), MoveId[id]).toBe(false);
    }
    expect(isMasterTmMove(MoveId.SWORDS_DANCE)).toBe(true);
  });

  it("Max Strike hits and lowers the foe's Speed", async () => {
    game.override.moveset([MoveId.MAX_STRIKE]);
    await game.classicMode.startBattle(SpeciesId.MEOWTH);
    const enemy = game.field.getEnemyPokemon();

    game.move.select(MoveId.MAX_STRIKE);
    await game.toEndOfTurn();

    expect(game.field.getPlayerPokemon()).toHaveUsedMove({ move: MoveId.MAX_STRIKE, result: MoveResult.SUCCESS });
    expect(enemy.hp).toBeLessThan(enemy.getMaxHp());
    expect(enemy).toHaveStatStage(Stat.SPD, -1);
  });

  it("Max Knuckle raises the Attack of the user and its partner", async () => {
    game.override.battleStyle("double").moveset([MoveId.MAX_KNUCKLE, MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.MACHAMP, SpeciesId.MEOWTH);
    const [machamp, meowth] = game.scene.getPlayerField();

    game.move.select(MoveId.MAX_KNUCKLE, BattlerIndex.PLAYER, BattlerIndex.ENEMY);
    game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
    await game.toEndOfTurn();

    expect(machamp).toHaveStatStage(Stat.ATK, 1);
    expect(meowth).toHaveStatStage(Stat.ATK, 1);
  });

  it("Max Flare sets the sun and still succeeds when the sun is already up", async () => {
    game.override.moveset([MoveId.MAX_FLARE]).weather(WeatherType.SUNNY);
    await game.classicMode.startBattle(SpeciesId.CHARIZARD);
    const enemy = game.field.getEnemyPokemon();

    game.move.select(MoveId.MAX_FLARE);
    await game.toEndOfTurn();

    expect(game.field.getPlayerPokemon()).toHaveUsedMove({ move: MoveId.MAX_FLARE, result: MoveResult.SUCCESS });
    expect(enemy.hp).toBeLessThan(enemy.getMaxHp());
    expect(game).toHaveWeather(WeatherType.SUNNY);
  });

  it("다이검무 raises Attack by 3", async () => {
    game.override.moveset([MoveId.MAX_SWORDS_DANCE]);
    await game.classicMode.startBattle(SpeciesId.SCIZOR);

    game.move.select(MoveId.MAX_SWORDS_DANCE);
    await game.toEndOfTurn();

    expect(game.field.getPlayerPokemon()).toHaveStatStage(Stat.ATK, 3);
  });

  it("Max Guard protects the user with its own tag", async () => {
    game.override.moveset([MoveId.MAX_GUARD]).enemyMoveset(MoveId.TACKLE);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();

    game.move.select(MoveId.MAX_GUARD);
    await game.phaseInterceptor.to("MoveEndPhase");
    expect(player).toHaveBattlerTag(BattlerTagType.MAX_GUARD);
    await game.toEndOfTurn();

    expect(player).toHaveFullHp();
    expect(game).toHaveShownMessage(
      i18next.t("battlerTags:protectedOnAdd", { pokemonNameWithAffix: getPokemonNameWithAffix(player) }),
    );
  });

  it("counts a converted slot's Max Guard in the Protect chain through `derivedMoveId`", async () => {
    game.override.moveset([MoveId.PROTECT, MoveId.SWORDS_DANCE]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    const protectCondition = allMoves[MoveId.PROTECT].getAttrs("ProtectAttr")[0].getCondition();
    vi.spyOn(player, "randBattleSeedInt").mockReturnValue(1);

    player.pushMoveHistory({
      move: MoveId.SWORDS_DANCE,
      targets: [player.getBattlerIndex()],
      result: MoveResult.SUCCESS,
      useMode: MoveUseMode.NORMAL,
    });
    expect(protectCondition(player, player, allMoves[MoveId.PROTECT])).toBe(true);

    player.pushMoveHistory({
      move: MoveId.SWORDS_DANCE,
      derivedMoveId: MoveId.MAX_GUARD,
      targets: [player.getBattlerIndex()],
      result: MoveResult.SUCCESS,
      useMode: MoveUseMode.NORMAL,
    });
    expect(protectCondition(player, player, allMoves[MoveId.PROTECT])).toBe(false);
  });

  it("G-Max Wildfire burns non-Fire foes for 4 turns at 1/6 of their max HP", async () => {
    game.override.moveset([MoveId.G_MAX_WILDFIRE, MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.CHARIZARD);
    const enemy = game.field.getEnemyPokemon();

    game.move.select(MoveId.G_MAX_WILDFIRE);
    await game.phaseInterceptor.to("MoveEndPhase");
    expect(game).toHaveArenaTag({ tagType: ArenaTagType.G_MAX_WILDFIRE, side: ArenaTagSide.ENEMY, turnCount: 4 });
    expect(game).not.toHaveArenaTag(ArenaTagType.G_MAX_WILDFIRE, ArenaTagSide.PLAYER);
    await game.toNextTurn();

    const hpAfterFirstTurn = enemy.hp;
    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();
    expect(hpAfterFirstTurn - enemy.hp).toBe(Math.floor(enemy.getMaxHp() / 6));
    expect(game).toHaveShownMessage(
      i18next.t("arenaTag:gMaxWildfireLapse", { pokemonNameWithAffix: getPokemonNameWithAffix(enemy) }),
    );
  });

  it("G-Max Steelsurge lays a Steel hazard on the foe's side", async () => {
    game.override.moveset([MoveId.G_MAX_STEELSURGE]);
    await game.classicMode.startBattle(SpeciesId.COPPERAJAH);

    game.move.select(MoveId.G_MAX_STEELSURGE);
    await game.toEndOfTurn();

    expect(game).toHaveArenaTag(ArenaTagType.G_MAX_STEELSURGE, ArenaTagSide.ENEMY);
  });

  it("G-Max Meltdown torments the foe", async () => {
    game.override.moveset([MoveId.G_MAX_MELTDOWN]);
    await game.classicMode.startBattle(SpeciesId.MELMETAL);

    game.move.select(MoveId.G_MAX_MELTDOWN);
    await game.toEndOfTurn();

    expect(game.field.getEnemyPokemon()).toHaveBattlerTag(BattlerTagType.TORMENT);
  });

  it("Upper Hand reads the target's converted slot: Quick Attack as Max Strike (priority 0) makes it fail", async () => {
    game.override.moveset([MoveId.UPPER_HAND]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.field.getEnemyPokemon();
    game.move.changeMoveset(enemy, [MoveId.QUICK_ATTACK]);
    enemy.moveset[0].transform = { kind: "max", moveId: MoveId.MAX_STRIKE };

    game.move.select(MoveId.UPPER_HAND);
    await game.move.selectEnemyMove(MoveId.QUICK_ATTACK);
    await game.phaseInterceptor.to("MoveEndPhase");

    expect(game.field.getPlayerPokemon()).toHaveUsedMove({ move: MoveId.UPPER_HAND, result: MoveResult.FAIL });
  });

  it("applies Z-Power bonuses: Z-Splash Attack +3, Z-Swords Dance resets lowered stats", async () => {
    game.override.moveset([MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();

    player.setStatStage(Stat.DEF, -2);
    player.setStatStage(Stat.SPD, 1);
    new ZPowerAttr(getZStatusEffect(MoveId.SWORDS_DANCE)!).applyZPower(player, MoveId.SWORDS_DANCE);
    expect(player).toHaveStatStage(Stat.DEF, 0);
    expect(player).toHaveStatStage(Stat.SPD, 1);

    new ZPowerAttr(getZStatusEffect(MoveId.SPLASH)!).applyZPower(player, MoveId.SPLASH);
    game.move.select(MoveId.SPLASH);
    await game.toEndOfTurn();

    expect(player).toHaveStatStage(Stat.ATK, 3);
    expect(game).toHaveShownMessage(i18next.t("moveTriggers:zPower", { pokemonName: getPokemonNameWithAffix(player) }));
  });
});
