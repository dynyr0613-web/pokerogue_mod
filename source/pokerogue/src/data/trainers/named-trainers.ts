/*
 * Local fork (2026-11-11): named trainers of the later games as boss trainers of the biome pools, where gym leaders
 * appear: 월로 (Volo), 주혜 (Irida), 찬석 (Adaman), 전목 (Kamado), 소니아 (Sonia), 호브 (Hop), 피오니 (Peony), 올림 (Sada),
 * 투로 (Turo), 시유 (Carmine), 브라이어 (Briar). The user: "인터넷에서 에셋을 찾아보죠. 에센셜에 쓸 수 있는 네임드
 * 트레이너 도트 이미지/대사 에셋들을" and "네, 추가해주세요. 대사는 최대한 원작 느낌을 살릴 수 있도록 하죠."
 * - Types: src/enums/trainer-type.ts (400 on, appended); configs: trainer-config.ts (`initForForkNamedTrainer`,
 *   `setForkNamedTrainerParty`); dialogue: dialogue.ts and locales/{ko,en}/dialogue.json; names and titles:
 *   locales/{ko,en}/trainer-names.json and trainer-titles.json; biomes: src/data/balance/biomes/*.ts (BOSS tier);
 *   Volo's Origin Giratina: SIGNATURE_BATTLE_FORMS (enemy-battle-forms.ts); sprites: assets/images/trainer/<key>.png,
 *   unedited Pokémon Showdown sprites by Brumirage and kyledove (CREDITS.md, REUSE.toml).
 * - This file holds their wave rules, which trainer-config.ts (party) and arena.ts (biome pool draw) read.
 * - Local fork (2026-11-12): and the late boss trainers' ({@linkcode FORK_LATE_BOSS_TRAINER_BIOMES}): past battle wave
 *   200 in Endless / Spliced Endless, the champions and evil-team bosses with a fixed trainer fusion
 *   (LATE_SIGNATURE_BATTLE_FORMS, enemy-battle-forms.ts) are boss trainers of one biome pool each, drawn through the
 *   same filter ({@linkcode filterTrainerPoolForWave}).
 */

import { globalScene } from "#app/global-scene";
import { BiomeId } from "#enums/biome-id";
import { TrainerType } from "#enums/trainer-type";
import { VoucherType } from "#enums/voucher-type";

/** Local fork (2026-11-11): the fork's named trainers, in their enum order */
export const FORK_NAMED_TRAINER_TYPES: readonly TrainerType[] = Object.freeze([
  TrainerType.VOLO,
  TrainerType.IRIDA,
  TrainerType.ADAMAN,
  TrainerType.KAMADO,
  TrainerType.SONIA,
  TrainerType.HOP,
  TrainerType.PEONY,
  TrainerType.SADA,
  TrainerType.TURO,
  TrainerType.CARMINE,
  TrainerType.BRIAR,
]);

/**
 * Local fork (2026-11-11): the difficulty wave from which a named trainer whose original ace is a legendary fields it
 * (Volo's Origin Giratina, Hop's Zacian / Zamazenta, Sada's Koraidon, Turo's Miraidon, Briar's Terapagos): the first
 * Classic gym wave with a full six-member gym party (`GYM_LEADER_5`), before the evil team bosses' legendaries (165).
 * Before it the party is the original team without the legendary, the ace being the original co-ace.
 */
export const FORK_NAMED_TRAINER_LEGEND_WAVE = 110;

/**
 * Local fork (2026-11-11): the first difficulty wave on which a named trainer can be drawn from a biome pool, for the
 * ones whose whole team is legendary or Paradox Pokémon with no early stage: Volo (always with his Origin Giratina, the
 * user's "월로(게임 내에 있다면)-오리진 기라티나"), Sada (Paradox Pokémon, Koraidon) and Turo (Paradox Pokémon,
 * Miraidon). Every other one can be drawn from the first gym wave, its party scaled to the wave as a gym leader's is.
 */
export const FORK_NAMED_TRAINER_MIN_WAVES: Readonly<Partial<Record<TrainerType, number>>> = Object.freeze({
  [TrainerType.VOLO]: FORK_NAMED_TRAINER_LEGEND_WAVE,
  [TrainerType.SADA]: FORK_NAMED_TRAINER_LEGEND_WAVE,
  [TrainerType.TURO]: FORK_NAMED_TRAINER_LEGEND_WAVE,
});

/**
 * Local fork (2026-11-12): the late boss trainers and the biome whose BOSS trainer tier holds each. Endless has no fixed
 * battles and draws its trainers from the biome trainer pools alone, so the champions and evil-team bosses, whose fixed
 * trainer fusion applies past battle wave 200 (LATE_SIGNATURE_BATTLE_FORMS, enemy-battle-forms.ts), could not be met
 * there. The user: "합체를 좀 고정해보죠 / 난천(메한카 + 메한카z) 라던가. / 비주기(메가뮤츠x+메가뮤츠y)라던가." and
 * "개조를 하는 주된 이유가 엔드리스에 있어서요". One trainer type each (its strongest version), listed in its biome's
 * BOSS tier after the biome's own trainers and drawn only past {@linkcode FORK_LATE_BOSS_TRAINER_AFTER_WAVE} in Endless
 * / Spliced Endless ({@linkcode canDrawTrainerOnWave}); on wave 200 and before, and in every other mode, the tier is
 * drawn as before, with the same seeds. Giovanni (Laboratory gym), Raihan (Wasteland gym) and Volo (Ruins, Temple)
 * were already in biome pools.
 */
export const FORK_LATE_BOSS_TRAINER_BIOMES: Readonly<Partial<Record<TrainerType, BiomeId>>> = Object.freeze({
  [TrainerType.CYNTHIA]: BiomeId.WASTELAND,
  [TrainerType.MAXIE_2]: BiomeId.VOLCANO,
  [TrainerType.ARCHIE_2]: BiomeId.SEABED,
  [TrainerType.LEON]: BiomeId.METROPOLIS,
  [TrainerType.STEVEN]: BiomeId.CAVE,
  [TrainerType.DIANTHA]: BiomeId.FAIRY_CAVE,
  [TrainerType.LYSANDRE_2]: BiomeId.CONSTRUCTION_SITE,
  [TrainerType.LANCE_CHAMPION]: BiomeId.LAKE,
  [TrainerType.BLUE]: BiomeId.GRASS,
  [TrainerType.ROSE_2]: BiomeId.FACTORY,
  [TrainerType.CYRUS_2]: BiomeId.SPACE,
});

/**
 * Local fork (2026-11-12): the last battle wave on which no late boss trainer is drawn
 * ({@linkcode FORK_LATE_BOSS_TRAINER_BIOMES}): the fixed trainer fusions' `afterWave`. The battle's own wave, as for the
 * fusions, so past it is Endless only.
 */
export const FORK_LATE_BOSS_TRAINER_AFTER_WAVE = 200;

/** Local fork (2026-11-12): whether `trainerType` is a late boss trainer ({@linkcode FORK_LATE_BOSS_TRAINER_BIOMES}) */
export function isForkLateBossTrainer(trainerType: TrainerType): boolean {
  return FORK_LATE_BOSS_TRAINER_BIOMES[trainerType] != null;
}

/**
 * Local fork (2026-11-12), review fix: the highest voucher type a repeat win over a late boss trainer pays out by in
 * Endless ({@linkcode getTrainerRepeatVoucherType}): a gym leader's (an Egg Voucher), what every other trainer of the
 * biome BOSS tiers pays.
 */
export const FORK_LATE_BOSS_TRAINER_REPEAT_VOUCHER_CAP = VoucherType.PLUS;

/**
 * Local fork (2026-11-12), review fix: the voucher type a repeat win over a boss trainer whose voucher is already
 * unlocked pays out by (`TrainerVictoryPhase`, `[VOUCHER, VOUCHER, VOUCHER_PLUS, VOUCHER_PREMIUM][type]`). A champion's
 * voucher is PREMIUM (money x10), so every win over one gives an Egg Voucher Plus: once a run in Classic, but a late boss
 * trainer is met in Endless from a biome pool ({@linkcode FORK_LATE_BOSS_TRAINER_BIOMES}), again on every pass through
 * its biome, where it takes the draw a gym leader worth an Egg Voucher would have had. The user asked to meet the fixed
 * fusions there ("합체를 좀 고정해보죠" / "개조를 하는 주된 이유가 엔드리스에 있어서요"), not for more egg pulls, so
 * in Endless / Spliced Endless a late boss trainer pays at most {@linkcode FORK_LATE_BOSS_TRAINER_REPEAT_VOUCHER_CAP},
 * as the gym leaders and named trainers of the same tiers do. Its first win's voucher unlock (once per account, the
 * same voucher a Classic win unlocks) and every other trainer and mode are unchanged.
 * @param trainerType - The defeated trainer's type
 * @param voucherType - Its voucher's own type (`vouchers[TrainerType[trainerType]].voucherType`)
 */
export function getTrainerRepeatVoucherType(trainerType: TrainerType, voucherType: VoucherType): VoucherType {
  return globalScene.gameMode.isEndless && isForkLateBossTrainer(trainerType)
    ? Math.min(voucherType, FORK_LATE_BOSS_TRAINER_REPEAT_VOUCHER_CAP)
    : voucherType;
}

/** Local fork (2026-11-11): the current battle's difficulty wave (`gameMode.getWaveForDifficulty`), 0 out of battle */
function getCurrentDifficultyWave(): number {
  const waveIndex = globalScene.currentBattle?.waveIndex;
  return waveIndex == null ? 0 : globalScene.gameMode.getWaveForDifficulty(waveIndex);
}

/**
 * Local fork (2026-11-11): whether a named trainer fields its legendary ace in the current battle
 * ({@linkcode FORK_NAMED_TRAINER_LEGEND_WAVE})
 */
export function isForkNamedTrainerLegendWave(): boolean {
  return getCurrentDifficultyWave() >= FORK_NAMED_TRAINER_LEGEND_WAVE;
}

/**
 * Local fork (2026-11-11): whether a biome pool may give `trainerType` on wave `waveIndex`
 * ({@linkcode FORK_NAMED_TRAINER_MIN_WAVES}); every trainer without a first wave may
 * Local fork (2026-11-12): a late boss trainer only past battle wave {@linkcode FORK_LATE_BOSS_TRAINER_AFTER_WAVE} in
 * Endless / Spliced Endless ({@linkcode FORK_LATE_BOSS_TRAINER_BIOMES})
 */
export function canDrawTrainerOnWave(trainerType: TrainerType, waveIndex: number): boolean {
  if (isForkLateBossTrainer(trainerType)) {
    return !!globalScene.gameMode.isEndless && waveIndex > FORK_LATE_BOSS_TRAINER_AFTER_WAVE;
  }
  const minWave = FORK_NAMED_TRAINER_MIN_WAVES[trainerType];
  return minWave == null || globalScene.gameMode.getWaveForDifficulty(waveIndex) >= minWave;
}

/**
 * Local fork (2026-11-11): a biome trainer pool tier without the named trainers that cannot be drawn on `waveIndex`
 * yet ({@linkcode canDrawTrainerOnWave}); a tier without such a trainer is returned as it is, so its draw is unchanged
 * Local fork (2026-11-12): nor the late boss trainers that cannot be drawn there. They come last in their tier, so the
 * tier left is the one the biome had before, in its order, and draws the same trainer on the same seed as before.
 */
export function filterTrainerPoolForWave(pool: readonly TrainerType[], waveIndex: number): readonly TrainerType[] {
  return pool.some(t => FORK_NAMED_TRAINER_MIN_WAVES[t] != null || isForkLateBossTrainer(t))
    ? pool.filter(t => canDrawTrainerOnWave(t, waveIndex))
    : pool;
}

/**
 * Local fork (2026-11-11), review fix: the seed offset the current battle's victory line is drawn on
 * (`TrainerVictoryPhase`). A named trainer's encounter line N goes with its victory line N
 * (dialogue.ts: Volo's mask, Sada's and Turo's protocol), which holds when both are drawn on the same offset: the wave's
 * in a trainer battle, but in a Mystery Encounter's battle (Mysterious Challengers' brutal option draws from the biome's
 * boss pool) the encounter line is drawn on the encounter's own offset (`MysteryEncounter.getSeedOffset`,
 * mystery-encounter-phases.ts), so a named trainer's victory line is drawn on that one there too. Every other trainer,
 * and every battle without an encounter offset, keeps the wave's, as before.
 */
export function getTrainerVictorySeedOffset(): number {
  const battle = globalScene.currentBattle;
  const trainerType = battle.trainer?.config.trainerType;
  const encounterOffset = battle.isBattleMysteryEncounter() ? battle.mysteryEncounter?.getSeedOffset() : undefined;
  return trainerType != null && FORK_NAMED_TRAINER_TYPES.includes(trainerType) && typeof encounterOffset === "number"
    ? encounterOffset
    : battle.waveIndex;
}
