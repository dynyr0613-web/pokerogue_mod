// Local fork (2026-11-20): 1.2.0 D5, the N-moves that stay unimplemented (the user: "구현 목록에 없는 n기술은
// 알기술/레벨업 - 다른 기술로 대체, 기술머신 - 보상 가중치 0 조정", "트릭 기술머신 등급 상승").
// Snatch (가로채기), Embargo (금제), Magic Room (매직룸), Ally Switch (사이드체인지) and Bestow (기프트패스) are replaced in
// every level-up learnset (the table: docs/N기술_대체표_20261120.md; none is an egg move), their TMs never drop as
// rewards but keep their TM numbers and species TM data, Trick's TM is 슈퍼 (GREAT), and the Clowning Around Mr. Mime
// has Light Screen in place of Ally Switch.
import type { BattleScene } from "#app/battle-scene";
import { RELEARN_MOVE } from "#app/constants";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { speciesEggMoves } from "#balance/egg-moves";
import { getTmNumber, tmPoolTiers, ZERO_WEIGHT_TMS } from "#balance/tm-pool-tiers";
import { allMoves, modifierTypes } from "#data/data-lists";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { PlayerPokemon } from "#field/pokemon";
import type { ModifierTypeGenerator, TmModifierType } from "#modifiers/modifier-type";
import { ClowningAroundEncounter } from "#mystery-encounters/clowning-around-encounter";
import { GameManager } from "#test/framework/game-manager";
import { initSceneWithoutEncounterPhase } from "#test/utils/game-manager-utils";
import { getStarterMoves } from "#ui/starter-select-ui-utils";
import Phaser from "phaser";
import type { Writable } from "type-fest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const REPLACED_MOVES = [MoveId.SNATCH, MoveId.EMBARGO, MoveId.MAGIC_ROOM, MoveId.ALLY_SWITCH, MoveId.BESTOW] as const;
const ZERO_WEIGHT = [MoveId.EMBARGO, MoveId.MAGIC_ROOM, MoveId.ALLY_SWITCH] as const;

describe("Local fork (2026-11-20) - N-moves replaced in learnsets, TM reward weight 0, Trick TM tier", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let scene: BattleScene;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    scene = game.scene;
    game.override.battleStyle("single");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("level-up and egg moves (알기술/레벨업 - 다른 기술로 대체)", () => {
    it("no level-up or form level-up learnset has one of the five moves", () => {
      for (const species of speciesDataRegistry.getAllSpecies()) {
        const data = speciesDataRegistry.getSpeciesData(species.speciesId);
        const entries = [
          ...data.levelMoves.map(lm => ["base", lm] as const),
          ...Object.entries(data.formLevelMoves ?? {}).flatMap(([form, lms]) => lms.map(lm => [form, lm] as const)),
        ];
        for (const [form, [level, move]] of entries) {
          expect(
            (REPLACED_MOVES as readonly MoveId[]).includes(move),
            `${SpeciesId[species.speciesId]} ${form} ${level} ${MoveId[move]}`,
          ).toBe(false);
        }
      }
    });

    it("no egg move list (rare egg moves included) has one of the five moves", () => {
      for (const [species, eggMoves] of Object.entries(speciesEggMoves)) {
        for (const move of REPLACED_MOVES) {
          expect((eggMoves as readonly MoveId[]).includes(move), `${species} ${MoveId[move]}`).toBe(false);
        }
      }
    });

    it("puts implemented moves at the same levels (spot checks), each once", () => {
      const cases: [SpeciesId, number, MoveId, string?][] = [
        [SpeciesId.HOOPA, 4, MoveId.PROTECT],
        [SpeciesId.KADABRA, 1, MoveId.MAGIC_COAT],
        [SpeciesId.SNORLAX, RELEARN_MOVE, MoveId.THIEF],
        [SpeciesId.GALAR_MR_MIME, 15, MoveId.ROLE_PLAY],
        [SpeciesId.MR_RIME, 15, MoveId.ROLE_PLAY],
        [SpeciesId.LUNATONE, 46, MoveId.TRICK_ROOM],
        [SpeciesId.DELPHOX, 68, MoveId.WONDER_ROOM],
        [SpeciesId.CHANSEY, 20, MoveId.HEAL_BELL],
        [SpeciesId.MANDIBUZZ, 41, MoveId.TAUNT],
        [SpeciesId.DEOXYS, 46, MoveId.TAUNT, "normal"],
        [SpeciesId.DEOXYS, 46, MoveId.TAUNT, "defense"],
      ];
      for (const [species, level, move, form] of cases) {
        const levelMoves = speciesDataRegistry.getLevelMoves(species, form);
        const label = `${SpeciesId[species]} ${form ?? ""} ${MoveId[move]}`;
        expect(
          levelMoves.filter(([, m]) => m === move),
          label,
        ).toEqual([[level, move]]);
        expect(allMoves[move].isUnimplemented, label).toBe(false);
      }
    });

    it("Hoopa's starter picks (level 1-5) have Protect, not Ally Switch", () => {
      const starterMoves = getStarterMoves(SpeciesId.HOOPA, 0);
      expect(starterMoves).toContain(MoveId.PROTECT);
      expect(starterMoves).not.toContain(MoveId.ALLY_SWITCH);
    });
  });

  describe("TMs (기술머신 - 보상 가중치 0 조정)", () => {
    it("Embargo, Magic Room and Ally Switch have weight 0 but keep their tier entry and TM number", () => {
      expect([...ZERO_WEIGHT_TMS].sort()).toEqual([...ZERO_WEIGHT].sort());
      for (const move of ZERO_WEIGHT) {
        expect(tmPoolTiers[move], MoveId[move]).toBe(ModifierTier.COMMON);
        expect(getTmNumber(move), MoveId[move]).not.toBe("000");
      }
      // Snatch and Bestow never had a TM
      expect(tmPoolTiers[MoveId.SNATCH]).toBeUndefined();
      expect(tmPoolTiers[MoveId.BESTOW]).toBeUndefined();
      // Species TM data stays for the Pokédex
      expect(speciesDataRegistry.getTms(SpeciesId.GOTHITA)).toEqual(
        expect.arrayContaining([MoveId.EMBARGO, MoveId.MAGIC_ROOM, MoveId.ALLY_SWITCH]),
      );
    });

    it("the TM reward generator never deals them, even if they counted as implemented", async () => {
      await game.classicMode.startBattle(SpeciesId.GOTHITA);
      const party = scene.getPlayerParty();
      const generator = modifierTypes.TM_COMMON() as ModifierTypeGenerator;
      // Only the weight-0 filter keeps them out: pretend they were implemented
      const restore = ZERO_WEIGHT.map(move => [move, allMoves[move].isUnimplemented] as const);
      for (const move of ZERO_WEIGHT) {
        (allMoves[move] as Writable<(typeof allMoves)[number]>).isUnimplemented = false;
      }
      try {
        const tms = vi.spyOn(party[0] as PlayerPokemon, "getCompatibleTms");
        tms.mockReturnValue([...ZERO_WEIGHT]);
        expect(generator.generateType(party)).toBeNull();

        tms.mockReturnValue([...ZERO_WEIGHT, MoveId.PAY_DAY]);
        for (let i = 0; i < 20; i++) {
          expect((generator.generateType(party) as TmModifierType).moveId).toBe(MoveId.PAY_DAY);
        }
      } finally {
        for (const [move, value] of restore) {
          (allMoves[move] as Writable<(typeof allMoves)[number]>).isUnimplemented = value;
        }
      }
    });

    it("Trick's TM is 슈퍼 (GREAT) (트릭 기술머신 등급 상승)", () => {
      expect(tmPoolTiers[MoveId.TRICK]).toBe(ModifierTier.GREAT);
    });
  });

  it("the Clowning Around Mr. Mime has Light Screen in place of Ally Switch", () => {
    initSceneWithoutEncounterPhase(scene, [SpeciesId.LAPRAS, SpeciesId.GENGAR, SpeciesId.ABRA]);
    scene.currentBattle.mysteryEncounter = ClowningAroundEncounter;
    ClowningAroundEncounter.populateDialogueTokensFromRequirements();
    ClowningAroundEncounter.onInit!();
    const mrMime = ClowningAroundEncounter.enemyPartyConfigs.at(-1)!.pokemonConfigs![0];
    expect(mrMime.species?.speciesId).toBe(SpeciesId.MR_MIME);
    expect(mrMime.moveSet).toEqual([MoveId.TEETER_DANCE, MoveId.LIGHT_SCREEN, MoveId.DAZZLING_GLEAM, MoveId.PSYCHIC]);
    for (const move of mrMime.moveSet!) {
      expect(allMoves[move].isUnimplemented, MoveId[move]).toBe(false);
    }
  });
});
