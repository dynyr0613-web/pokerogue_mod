/**
 * Local fork (2026-11-10): enemy Pokémon in a battle form (Mega Evolution 메가진화, Gigantamax 거다이맥스, Primal
 * Reversion 원시회귀), the item they hold for it, and what catching one gives. The user:
 * - "낮은 확률로 적 트레이너가 메가진화 / 다이맥스 / 원시회귀 포켓몬을 들고 나올수있게 하죠, 물론 메가스톤 / 다이버섯은
 *   뺏을 수 없는 아이템으로 판정하고."
 * - "가끔 이미 메가진화/거다이맥스/원시회귀를 한채로 야생에 등장하는 포켓몬들의 확률도 넣어두도록 하죠. + 포획 후에는
 *   메가스톤을 보상으로 먹어야 메가진화/다이맥스 시킬 수 있도록(원시회귀를 한채로 나온 그란돈/가이오가, 메가진화를 한
 *   레쿠쟈는 주홍구슬/쪽빛구슬/메가진화 상태를 유지하게 따로 판정하고)"
 *
 * - Battle forms: the forms a Pokémon reaches from its current form through an item (an active
 *   `SpeciesFormChangeItemTrigger`) whose key is in {@linkcode BATTLE_FORM_KEYS} (every Mega key, Primal, every
 *   Gigantamax key; never Eternamax, so Eternatus has none). The fork's own stones count: Charizardite Z, Baxcalibrite Z,
 *   Galladite Z, Melmetalite, Archaludonite.
 * - Trainers: once per trainer battle, at the trainer's chance, ONE random eligible Pokémon of the enemy party (not a
 *   fusion, not already Mega / Primal / Max, with a battle form to go to, {@linkcode canTakeBattleForm}) takes one of its
 *   battle forms at random. At most one per party, besides a Mega a trainer config already gives (Red's, a champion's...).
 * - Local fork (2026-11-10): the trainer's chance grows with the difficulty wave and depends on its tier, in every game
 *   mode ({@linkcode ENEMY_BATTLE_FORMS}.trainer, {@linkcode getTrainerBattleFormTier}): ordinary trainers, the elite
 *   trainers (`ENDLESS_ELITE_TRAINER_TYPES`: Ace Trainer, Snow Ace Trainer) and boss trainers (`isBoss`: gym leaders,
 *   Elite Four, champions, evil-team bosses...). The user: "적 트레이너가 메가/다이맥스/원시회귀 포켓몬을 쓸 확률도 라운드
 *   진행 시 점점 높여보죠. 이전에 정했던 엘리트 트레이너들이 전설을 가지고 나올 수도 있던 것처럼, 엘리트 트레이너와 일반
 *   트레이너의 확률을 다르게 해서."
 * - Local fork (2026-11-10): signature trainers ({@linkcode SIGNATURE_BATTLE_FORMS}). The user: "그리고 몇몇 트레이너들은
 *   메가진화/다이맥스/원시회귀 포켓몬이 무엇이 나올 수 있는지 확정해두죠. 예시) 난천-한카리아스 z, 마적-원시그란돈,
 *   아강-원시가이오가, 월로(게임 내에 있다면)-오리진 기라티나, 단델-거다이 리자몽, 비주기-메가뮤츠(xy는 랜덤) 이런 식으로."
 *   Their battle-form Pokémon is always the listed one: a member of the species a trainer config already put in another
 *   battle form (Cynthia's Mega Garchomp) switches to the listed form with no roll, one already in it stays; otherwise,
 *   when the trainer's roll hits, a member of the species takes the form, and with no member of the species the species
 *   is put in place of one member ({@linkcode getSignatureSlot}), in the form. They never transform another member.
 *   Local fork (2026-11-10), review fix: as the partner of a named double battle, their members are left out of the
 *   main trainer's roll ({@linkcode isSignaturePartner}); a member they transform keeps its trainer config's
 *   hand-picked moves on its new moveset ({@linkcode transformToBattleForm}).
 * - Mega / Max and Tera never meet (Local fork (2026-11-18), review fix: no longer "as for the player", whose Mega /
 *   G-Max can now Terastallize, `canSpeciesTera`; the enemy rule is unchanged): the trainer roll skips the trainer's
 *   instant-Tera Pokémon (`willTerastallize`: a rival's starter, Red's Pikachu...), the random Tera that
 *   `Trainer.genAI` picks later (gym leaders, Elite Four: `setRandomTeraModifiers`) skips a Pokémon in a battle form,
 *   and `Trainer.shouldTera` / `willTerastallize` refuse one (`isTeraBlockedForm`, pokemon-utils.ts).
 * - Wild: each eligible wild Pokémon rolls `wild.chance` percent, `wildBoss.chance` when it is a boss.
 * - Both only from difficulty wave `minWave`. Nothing is rolled before that, for an ineligible Pokémon, in a
 *   mystery-encounter battle (encounter-phase.ts returns before its hooks for them), for the Classic final boss or for
 *   the Daily final boss (its config may set its moveset), so the seeded sequence is unchanged there.
 * - Hooks: encounter-phase.ts party creation (wild: right after each Pokémon is made; trainer: after the whole party,
 *   Endless strong extra included, is made, and before any member is marked seen or set on the field), before the boss
 *   bars of a double wild battle are split by base total and before the sprites load.
 * - The item: `BattleScene.generateEnemyModifiers` gives every enemy in a battle form the item that leads there (Mega
 *   Stone 메가스톤, Max Mushrooms 다이버섯, Red Orb 주홍구슬, Blue Orb 쪽빛구슬; {@linkcode newEnemyBattleFormItem}),
 *   a trainer config's Mega and a mystery encounter's included. `PokemonFormChangeItemModifier.isTransferable` is
 *   false, so Thief / Covet / Knock Off / Grip Claw / Pickpocket / Magician / Pickup and the post-battle loot never take
 *   it. Giving it to an enemy changes no form: the item trigger only searches the player's items.
 * - Capture (attempt-capture-phase.ts, and `catchPokemon` for mystery encounters; {@linkcode prepareBattleFormCapture}):
 *   the caught Pokémon goes back to its own form ({@linkcode getBaseFormIndex}) and its battle-form item stays behind,
 *   so the player needs that Mega Stone / Max Mushrooms from the rewards (with the Mega Bracelet / Dynamax Band, as for
 *   any Pokémon) to transform it again. Primal Groudon (그란돈), Primal Kyogre (가이오가) and Mega Rayquaza (레쿠쟈) keep
 *   their form and come holding the Red Orb / Blue Orb / Rayquazite, active (`keepOnCapture`). This happens before
 *   anything reads the catch (Pokédex entry, challenge check, party copy), so all of them see the form the player gets;
 *   the Exp. and score of the catch are that form's too.
 *
 * - Local fork (2026-11-12): fixed trainer fusions ({@linkcode LATE_SIGNATURE_BATTLE_FORMS}, `fusion`). The user:
 *   "합체를 좀 고정해보죠 / 난천(메한카 + 메한카z) 라던가. / 비주기(메가뮤츠x+메가뮤츠y)라던가." Past battle wave 200 (Endless
 *   only, as for Raihan's "200웨이브가 넘어가면(즉 엔드리스에서만)") a roster trainer always fields its late signature (the
 *   head: one form, held item, no roll) with a fixed tail fused onto it ({@linkcode applyFixedTrainerFusion}): Cynthia's
 *   Mega Garchomp + Mega Garchomp Z, Giovanni's Mega Mewtwo X + Mega Mewtwo Y... On wave 200 and before, and in every
 *   other mode, nothing of it runs (no extra random number), so those battles are as before.
 *
 * Every tunable number is in {@linkcode ENEMY_BATTLE_FORMS}, the signature list in {@linkcode SIGNATURE_BATTLE_FORMS}
 * (Local fork (2026-11-10)). Tests force the rolls through {@linkcode enemyBattleFormDice} or read
 * {@linkcode getEnemyBattleFormChance}.
 */

import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { activeOverrides } from "#app/overrides"; // Local fork (2026-11-10): signature trainers
import { BASE_HIDDEN_ABILITY_RATE } from "#balance/rates"; // Local fork (2026-11-12): fixed trainer fusions
import { isDailyFinalBoss } from "#data/daily-seed-utils";
import { modifierTypes } from "#data/data-lists";
import { SpeciesFormChangeItemTrigger } from "#data/form-change-triggers";
import { Gender } from "#data/gender"; // Local fork (2026-11-12): fixed trainer fusions
import type { SpeciesFormChange } from "#data/pokemon-forms";
import { BattleType } from "#enums/battle-type";
import { ChallengeType } from "#enums/challenge-type";
import { FormChangeItem } from "#enums/form-change-item";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot"; // Local fork (2026-11-10): signature trainers
import { TrainerType } from "#enums/trainer-type";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";
import { PokemonFormChangeItemModifier } from "#modifiers/modifier";
import type { FormChangeItemModifierType, ModifierTypeGenerator } from "#modifiers/modifier-type";
import { ENDLESS_ELITE_TRAINER_TYPES } from "#trainers/endless-trainer-party"; // Local fork (2026-11-10): trainer tiers
import type { TrainerConfig } from "#trainers/trainer-config"; // Local fork (2026-11-10): trainer tiers
import { applyChallenges } from "#utils/challenge-utils";
import { randSeedInt, randSeedItem } from "#utils/common";
import { isTeraBlockedForm, willTerastallize } from "#utils/pokemon-utils";

/** Local fork (2026-11-10): one entry of {@linkcode ENEMY_BATTLE_FORMS}.keepOnCapture */
export interface BattleFormKeptOnCapture {
  /** The species */
  readonly species: SpeciesId;
  /** The battle form it keeps when caught in it */
  readonly formKey: SpeciesFormKey;
  /** The item the caught Pokémon comes holding (active), so the form has its item, as a reward-made one would */
  readonly item: FormChangeItem;
}

/**
 * Local fork (2026-11-10): a battle-form chance and how it grows with the difficulty wave `w`
 * (`gameMode.getWaveForDifficulty`), {@linkcode getBattleFormChanceAt}: 0 before `minWave`, from it
 * `min(max, chance + floor((w - minWave) / everyWaves) * step)`; an entry without `step` stays at `chance`.
 */
export interface BattleFormChanceCurve {
  /** The percent chance (0-100) at `minWave` */
  readonly chance: number;
  /** The first difficulty wave it can happen */
  readonly minWave: number;
  /** The percentage points added every `everyWaves` waves past `minWave` */
  readonly step?: number;
  /** The waves each `step` takes */
  readonly everyWaves?: number;
  /** The highest the chance gets */
  readonly max?: number;
}

/**
 * Local fork (2026-11-10): the trainer tiers of {@linkcode ENEMY_BATTLE_FORMS}.trainer
 * ({@linkcode getTrainerBattleFormTier}):
 * - `ordinary`: every other trainer;
 * - `elite`: the elite trainers, `ENDLESS_ELITE_TRAINER_TYPES` (Ace Trainer, Snow Ace Trainer, both genders and their
 *   Ace Duo pairs: 엘리트 트레이너 / 엘리트 콤비);
 * - `boss`: a trainer whose config `isBoss` (gym leaders, Elite Four, champions, evil-team admins and bosses, rivals'
 *   boss battles...).
 */
export type TrainerBattleFormTier = "ordinary" | "elite" | "boss";

/**
 * Local fork (2026-11-10): every number of the enemy battle forms, in one place.
 * - `trainer`: per trainer tier ({@linkcode TrainerBattleFormTier}), the percent chance per trainer battle that one
 *   eligible Pokémon of the enemy party comes in a battle form ({@linkcode BattleFormChanceCurve}: `chance` at
 *   `minWave`, plus `step` every `everyWaves` waves, at most `max`), in every game mode. The user: "적 트레이너가
 *   메가/다이맥스/원시회귀 포켓몬을 쓸 확률도 라운드 진행 시 점점 높여보죠. 이전에 정했던 엘리트 트레이너들이 전설을
 *   가지고 나올 수도 있던 것처럼, 엘리트 트레이너와 일반 트레이너의 확률을 다르게 해서."
 *   - `ordinary`: 10% at wave 50, +5 every 100 waves (15% at 150, 40% at 650), 50% from wave 850;
 *   - `elite`: 20% at wave 50, +10 every 100 waves (30% at 150), 80% from wave 650;
 *   - `boss`: the elite numbers, an entry of their own so the two can be tuned apart;
 * - `wild`: the percent chance (0-100) per eligible ordinary wild Pokémon, from difficulty wave `minWave`;
 * - `wildBoss`: the same per eligible wild boss (`isBoss()`);
 * - `keepOnCapture`: the battle forms a caught Pokémon keeps, with the item it comes holding; every other one goes
 *   back to its own form without its item.
 */
export const ENEMY_BATTLE_FORMS = Object.freeze({
  trainer: Object.freeze({
    ordinary: Object.freeze({ chance: 10, step: 5, everyWaves: 100, max: 50, minWave: 50 }),
    elite: Object.freeze({ chance: 20, step: 10, everyWaves: 100, max: 80, minWave: 50 }),
    boss: Object.freeze({ chance: 20, step: 10, everyWaves: 100, max: 80, minWave: 50 }),
  }),
  wild: Object.freeze({ chance: 2, minWave: 50 }),
  wildBoss: Object.freeze({ chance: 5, minWave: 50 }),
  keepOnCapture: Object.freeze<readonly BattleFormKeptOnCapture[]>([
    // Primal Groudon keeps the Red Orb (주홍구슬), Primal Kyogre the Blue Orb (쪽빛구슬), Mega Rayquaza the Rayquazite
    Object.freeze({ species: SpeciesId.GROUDON, formKey: SpeciesFormKey.PRIMAL, item: FormChangeItem.RED_ORB }),
    Object.freeze({ species: SpeciesId.KYOGRE, formKey: SpeciesFormKey.PRIMAL, item: FormChangeItem.BLUE_ORB }),
    Object.freeze({ species: SpeciesId.RAYQUAZA, formKey: SpeciesFormKey.MEGA, item: FormChangeItem.RAYQUAZITE }),
  ]),
});

/** Local fork (2026-11-10): a signature trainer's battle-form Pokémon ({@linkcode SIGNATURE_BATTLE_FORMS}) */
export interface SignatureBattleForm {
  /** The species */
  readonly species: SpeciesId;
  /**
   * Its battle forms the trainer uses, one at random when there are several (Mewtwo: Mega X or Mega Y), each with the
   * item of its form change (the tests check each against the species' form changes)
   */
  readonly forms: readonly { readonly formKey: SpeciesFormKey; readonly item: FormChangeItem }[];
}

/** Local fork (2026-11-10): a frozen {@linkcode SignatureBattleForm} */
function signatureForm(species: SpeciesId, ...forms: [SpeciesFormKey, FormChangeItem][]): SignatureBattleForm {
  return Object.freeze({
    species,
    forms: Object.freeze(forms.map(([formKey, item]) => Object.freeze({ formKey, item }))),
  });
}

const MEGA_GARCHOMP_Z = signatureForm(SpeciesId.GARCHOMP, [SpeciesFormKey.MEGA_Z, FormChangeItem.GARCHOMPITE_Z]);
const PRIMAL_GROUDON = signatureForm(SpeciesId.GROUDON, [SpeciesFormKey.PRIMAL, FormChangeItem.RED_ORB]);
const PRIMAL_KYOGRE = signatureForm(SpeciesId.KYOGRE, [SpeciesFormKey.PRIMAL, FormChangeItem.BLUE_ORB]);
const GIGANTAMAX_CHARIZARD = signatureForm(SpeciesId.CHARIZARD, [
  SpeciesFormKey.GIGANTAMAX,
  FormChangeItem.MAX_MUSHROOMS,
]);
const MEGA_MEWTWO_X_Y = signatureForm(
  SpeciesId.MEWTWO,
  [SpeciesFormKey.MEGA_X, FormChangeItem.MEWTWONITE_X],
  [SpeciesFormKey.MEGA_Y, FormChangeItem.MEWTWONITE_Y],
);
const MEGA_METAGROSS = signatureForm(SpeciesId.METAGROSS, [SpeciesFormKey.MEGA, FormChangeItem.METAGROSSITE]);
const MEGA_GARDEVOIR = signatureForm(SpeciesId.GARDEVOIR, [SpeciesFormKey.MEGA, FormChangeItem.GARDEVOIRITE]);
const MEGA_GYARADOS = signatureForm(SpeciesId.GYARADOS, [SpeciesFormKey.MEGA, FormChangeItem.GYARADOSITE]);
const MEGA_LUCARIO = signatureForm(SpeciesId.LUCARIO, [SpeciesFormKey.MEGA, FormChangeItem.LUCARIONITE]);
const MEGA_DRAGONITE = signatureForm(SpeciesId.DRAGONITE, [SpeciesFormKey.MEGA, FormChangeItem.DRAGONINITE]);
const MEGA_PIDGEOT = signatureForm(SpeciesId.PIDGEOT, [SpeciesFormKey.MEGA, FormChangeItem.PIDGEOTITE]);
const GIGANTAMAX_DURALUDON = signatureForm(SpeciesId.DURALUDON, [
  SpeciesFormKey.GIGANTAMAX,
  FormChangeItem.MAX_MUSHROOMS,
]);
const GIGANTAMAX_COPPERAJAH = signatureForm(SpeciesId.COPPERAJAH, [
  SpeciesFormKey.GIGANTAMAX,
  FormChangeItem.MAX_MUSHROOMS,
]);
const MEGA_ALAKAZAM = signatureForm(SpeciesId.ALAKAZAM, [SpeciesFormKey.MEGA, FormChangeItem.ALAKAZITE]);
/**
 * Local fork (2026-11-11): Origin Giratina with the Griseous Core (큰백금옥), a signature form that is no battle form
 * ({@linkcode isSignatureOnlyForm})
 */
const ORIGIN_GIRATINA = signatureForm(SpeciesId.GIRATINA, [SpeciesFormKey.ORIGIN, FormChangeItem.GRISEOUS_CORE]);

/**
 * Local fork (2026-11-10): the trainers whose battle-form Pokémon is fixed ({@linkcode rollTrainerBattleForm}), by
 * trainer type (the main trainer of a named double battle; its partner's members are left alone; review fix: a
 * signature partner's members are left out of a main trainer's ordinary roll, {@linkcode isSignaturePartner}).
 * The user: "그리고 몇몇 트레이너들은 메가진화/다이맥스/원시회귀 포켓몬이 무엇이 나올 수 있는지 확정해두죠. 예시) 난천-한카리아스 z,
 * 마적-원시그란돈, 아강-원시가이오가, 월로(게임 내에 있다면)-오리진 기라티나, 단델-거다이 리자몽, 비주기-메가뮤츠(xy는
 * 랜덤) 이런 식으로."
 * - From the user: Cynthia 난천 (Mega Garchomp Z), Maxie 마적 (Primal Groudon, both battles), Archie 아강 (Primal
 *   Kyogre, both battles), Leon 단델 (Gigantamax Charizard), Giovanni 비주기 (Mega Mewtwo X or Y at random: the gym
 *   leader and both Rocket Boss battles). Volo 월로 (Origin Giratina) was not a trainer in this game then.
 * - Local fork (2026-11-11): Volo 월로 is a trainer now (trainer-config.ts, named-trainers.ts): Origin Giratina holding the
 *   Griseous Core (큰백금옥). Origin Forme is no battle form (not Mega / G-Max / Primal), so it is a signature-only form
 *   ({@linkcode isSignatureOnlyForm}): only a signature trainer's Pokémon takes it or holds its item; every other rule
 *   stays the Mega / G-Max / Primal one. His config fields the Giratina in its Origin Forme, so it stays, with no roll.
 *   Peony 피오니 (also new) gets Gigantamax Copperajah, the form of his Galarian Star Tournament ace.
 * - Added in the same spirit (trainer, form and item all in the game): Steven (Mega Metagross), Diantha (Mega
 *   Gardevoir), Lysandre (Mega Gyarados, both battles), Korrina (Mega Lucario), Lance (Mega Dragonite: the Elite Four
 *   and the champion), Blue (Mega Pidgeot), Raihan (Gigantamax Duraludon), Rose (Gigantamax Copperajah, both battles),
 *   Sabrina (Mega Alakazam). Red is left out: his config already gives a Mega Venusaur, Charizard X or Blastoise.
 * - Already given by the trainer's own config (so it simply stays): Leon's G-Max Charizard, Steven's Mega Metagross,
 *   Diantha's Mega Gardevoir, Lysandre's second battle Mega Gyarados, the champion Lance's Mega Dragonite, Blue's Mega
 *   Pidgeot, Rose's second battle G-Max Copperajah; Cynthia's config Mega Garchomp (Mega or Mega Z at random) becomes
 *   Mega Z.
 */
export const SIGNATURE_BATTLE_FORMS: Readonly<Partial<Record<TrainerType, SignatureBattleForm>>> = Object.freeze({
  [TrainerType.CYNTHIA]: MEGA_GARCHOMP_Z,
  [TrainerType.MAXIE]: PRIMAL_GROUDON,
  [TrainerType.MAXIE_2]: PRIMAL_GROUDON,
  [TrainerType.ARCHIE]: PRIMAL_KYOGRE,
  [TrainerType.ARCHIE_2]: PRIMAL_KYOGRE,
  [TrainerType.LEON]: GIGANTAMAX_CHARIZARD,
  [TrainerType.GIOVANNI]: MEGA_MEWTWO_X_Y,
  [TrainerType.ROCKET_BOSS_GIOVANNI_1]: MEGA_MEWTWO_X_Y,
  [TrainerType.ROCKET_BOSS_GIOVANNI_2]: MEGA_MEWTWO_X_Y,
  [TrainerType.STEVEN]: MEGA_METAGROSS,
  [TrainerType.DIANTHA]: MEGA_GARDEVOIR,
  [TrainerType.LYSANDRE]: MEGA_GYARADOS,
  [TrainerType.LYSANDRE_2]: MEGA_GYARADOS,
  [TrainerType.KORRINA]: MEGA_LUCARIO,
  [TrainerType.LANCE]: MEGA_DRAGONITE,
  [TrainerType.LANCE_CHAMPION]: MEGA_DRAGONITE,
  [TrainerType.BLUE]: MEGA_PIDGEOT,
  [TrainerType.RAIHAN]: GIGANTAMAX_DURALUDON,
  [TrainerType.ROSE]: GIGANTAMAX_COPPERAJAH,
  [TrainerType.ROSE_2]: GIGANTAMAX_COPPERAJAH,
  [TrainerType.SABRINA]: MEGA_ALAKAZAM,
  // Local fork (2026-11-11): the fork's named trainers (named-trainers.ts)
  [TrainerType.VOLO]: ORIGIN_GIRATINA,
  [TrainerType.PEONY]: GIGANTAMAX_COPPERAJAH,
});

/** Local fork (2026-11-11): Mega Archaludon (our custom Mega, holding the Archaludonite), Raihan's late signature */
const MEGA_ARCHALUDON = signatureForm(SpeciesId.ARCHALUDON, [SpeciesFormKey.MEGA, FormChangeItem.ARCHALUDONITE]);
/** Local fork (2026-11-12): fixed-fusion heads that are no trainer's signature before wave 200 (one form, no choice) */
const MEGA_GARCHOMP = signatureForm(SpeciesId.GARCHOMP, [SpeciesFormKey.MEGA, FormChangeItem.GARCHOMPITE]);
const MEGA_MEWTWO_X = signatureForm(SpeciesId.MEWTWO, [SpeciesFormKey.MEGA_X, FormChangeItem.MEWTWONITE_X]);
/**
 * Local fork (2026-11-12): Origin Dialga with the Adamant Crystal (금강옥), a signature-only form like Volo's Origin
 * Giratina ({@linkcode isSignatureOnlyForm}: no battle form, so only a signature trainer's Pokémon takes it or holds it)
 */
const ORIGIN_DIALGA = signatureForm(SpeciesId.DIALGA, [SpeciesFormKey.ORIGIN, FormChangeItem.ADAMANT_CRYSTAL]);

/**
 * Local fork (2026-11-12): the tail of a fixed trainer fusion ({@linkcode LateSignatureBattleForm}.fusion): a species and
 * the form it is fused in (a Mega, G-Max or Origin form, kept as the fusion's form; it holds no item for it)
 */
export interface SignatureFusionTail {
  /** The tail's species */
  readonly species: SpeciesId;
  /** The tail's form key (`fusionFormIndex` is its index in the species' forms) */
  readonly formKey: SpeciesFormKey;
}

/** Local fork (2026-11-11): a signature that replaces the trainer's own past a wave ({@linkcode LATE_SIGNATURE_BATTLE_FORMS}) */
export interface LateSignatureBattleForm {
  /** The last wave of the trainer's own signature; from the next wave on, `signature` is used */
  readonly afterWave: number;
  /** The signature used past `afterWave` */
  readonly signature: SignatureBattleForm;
  /**
   * Local fork (2026-11-12): the tail fused onto the signature Pokémon past `afterWave`. With it the signature is no
   * roll: the trainer always fields it, in its (single) form, fused with this tail ({@linkcode applyFixedTrainerFusion})
   */
  readonly fusion?: SignatureFusionTail;
}

/** Local fork (2026-11-12): a frozen {@linkcode LateSignatureBattleForm}, with a frozen fusion tail when given */
function lateSignature(
  afterWave: number,
  signature: SignatureBattleForm,
  tail?: [SpeciesId, SpeciesFormKey],
): LateSignatureBattleForm {
  return Object.freeze({
    afterWave,
    signature,
    ...(tail && { fusion: Object.freeze({ species: tail[0], formKey: tail[1] }) }),
  });
}

const CYNTHIA_FUSION = lateSignature(200, MEGA_GARCHOMP, [SpeciesId.GARCHOMP, SpeciesFormKey.MEGA_Z]);
const GIOVANNI_FUSION = lateSignature(200, MEGA_MEWTWO_X, [SpeciesId.MEWTWO, SpeciesFormKey.MEGA_Y]);
const MAXIE_FUSION = lateSignature(200, PRIMAL_GROUDON, [SpeciesId.CAMERUPT, SpeciesFormKey.MEGA]);
const ARCHIE_FUSION = lateSignature(200, PRIMAL_KYOGRE, [SpeciesId.SHARPEDO, SpeciesFormKey.MEGA]);
const LYSANDRE_FUSION = lateSignature(200, MEGA_GYARADOS, [SpeciesId.PYROAR, SpeciesFormKey.MEGA]);
const LANCE_FUSION = lateSignature(200, MEGA_DRAGONITE, [SpeciesId.AERODACTYL, SpeciesFormKey.MEGA]);
const RAIHAN_FUSION = lateSignature(200, MEGA_ARCHALUDON, [SpeciesId.DURALUDON, SpeciesFormKey.GIGANTAMAX]);
const ROSE_FUSION = lateSignature(200, GIGANTAMAX_COPPERAJAH, [SpeciesId.MELMETAL, SpeciesFormKey.MEGA]);
const CYRUS_FUSION = lateSignature(200, ORIGIN_DIALGA, [SpeciesId.PALKIA, SpeciesFormKey.ORIGIN]);

/**
 * Local fork (2026-11-11): the signatures that change past a wave, by trainer type ({@linkcode getSignatureBattleForm}).
 * The wave is the battle's own wave (not the difficulty wave), so past 200 is Endless only (Classic ends at 200).
 * - Raihan 금랑: Mega Archaludon past wave 200, for the gym leader (G-Max Duraludon until then) and the Elite Four
 *   (no signature until then: his ordinary boss roll). The user: "금랑은 200웨이브가 넘어가면(즉 엔드리스에서만) 메가
 *   브리두라스를 쓰도록 하죠." His Duraludon evolves into Archaludon at those levels, so the Archaludon takes the Mega;
 *   a party with neither gets one in the Duraludon line's slot or the ace's ({@linkcode getSignatureSlot}).
 * - Korrina 코르니 stays on Mega Lucario only, never Mega Lucario Z (the user: "코르니는 그냥 메루카만 쓰게 하고").
 * - Local fork (2026-11-12): fixed trainer fusions, past wave 200 too (Endless only). The user: "합체를 좀 고정해보죠 /
 *   난천(메한카 + 메한카z) 라던가. / 비주기(메가뮤츠x+메가뮤츠y)라던가." Every entry has a `fusion` tail now, so past its
 *   wave the trainer always fields the head below (no roll, no choice of form) fused with the tail
 *   ({@linkcode applyFixedTrainerFusion}); Raihan's Mega Archaludon, a roll until now, is always there too.
 *   - From the user: Cynthia 난천 (Mega Garchomp + Mega Garchomp Z), Giovanni 비주기 (Mega Mewtwo X + Mega Mewtwo Y: the
 *     gym leader and both Rocket Boss battles).
 *   - In the same spirit: Maxie (Primal Groudon + Mega Camerupt), Archie (Primal Kyogre + Mega Sharpedo), Leon
 *     (G-Max Charizard + Mega Charizard X), Steven (Mega Metagross + Mega Aggron), Diantha (Mega Gardevoir + the
 *     official Mega Gallade), Lysandre (Mega Gyarados + Mega Pyroar), Lance (Mega Dragonite + Mega Aerodactyl), Blue
 *     (Mega Pidgeot + Mega Alakazam), Raihan (Mega Archaludon + G-Max Duraludon), Rose (G-Max Copperajah + our Mega
 *     Melmetal), Volo (Origin Giratina + the official Mega Lucario), Cyrus (Origin Dialga holding the Adamant Crystal +
 *     Origin Palkia; no signature before wave 200).
 *   - Left out on purpose: Korrina (Mega Lucario only), Sabrina, Peony, Red, and every other trainer.
 *   - Local fork (2026-11-12), review finding: Endless has no fixed battles and draws its trainers from the biome
 *     trainer pools alone, so past wave 200 a real game met only Giovanni (the Laboratory gym leader), Raihan (the
 *     Wasteland gym leader) and Volo (Ruins, Temple); the others are Classic / Challenge fixed battles, all on wave 200
 *     or before. Now one version of each other entry (Cynthia, Maxie 2, Archie 2, Leon, Steven, Diantha, Lysandre 2, the
 *     champion Lance, Blue, Rose 2, Cyrus 2) is a boss trainer of one biome past wave 200 in Endless / Spliced Endless
 *     (named-trainers.ts, FORK_LATE_BOSS_TRAINER_BIOMES). The Rocket Boss Giovanni, the first Maxie / Archie /
 *     Lysandre / Rose / Cyrus and the Elite Four Lance and Raihan keep their entries for their Classic battles, which
 *     never pass wave 200.
 */
export const LATE_SIGNATURE_BATTLE_FORMS: Readonly<Partial<Record<TrainerType, LateSignatureBattleForm>>> =
  Object.freeze({
    [TrainerType.RAIHAN]: RAIHAN_FUSION,
    [TrainerType.RAIHAN_ELITE]: RAIHAN_FUSION,
    // Local fork (2026-11-12): fixed trainer fusions
    [TrainerType.CYNTHIA]: CYNTHIA_FUSION,
    [TrainerType.GIOVANNI]: GIOVANNI_FUSION,
    [TrainerType.ROCKET_BOSS_GIOVANNI_1]: GIOVANNI_FUSION,
    [TrainerType.ROCKET_BOSS_GIOVANNI_2]: GIOVANNI_FUSION,
    [TrainerType.MAXIE]: MAXIE_FUSION,
    [TrainerType.MAXIE_2]: MAXIE_FUSION,
    [TrainerType.ARCHIE]: ARCHIE_FUSION,
    [TrainerType.ARCHIE_2]: ARCHIE_FUSION,
    [TrainerType.LEON]: lateSignature(200, GIGANTAMAX_CHARIZARD, [SpeciesId.CHARIZARD, SpeciesFormKey.MEGA_X]),
    [TrainerType.STEVEN]: lateSignature(200, MEGA_METAGROSS, [SpeciesId.AGGRON, SpeciesFormKey.MEGA]),
    [TrainerType.DIANTHA]: lateSignature(200, MEGA_GARDEVOIR, [SpeciesId.GALLADE, SpeciesFormKey.MEGA]),
    [TrainerType.LYSANDRE]: LYSANDRE_FUSION,
    [TrainerType.LYSANDRE_2]: LYSANDRE_FUSION,
    [TrainerType.LANCE]: LANCE_FUSION,
    [TrainerType.LANCE_CHAMPION]: LANCE_FUSION,
    [TrainerType.BLUE]: lateSignature(200, MEGA_PIDGEOT, [SpeciesId.ALAKAZAM, SpeciesFormKey.MEGA]),
    [TrainerType.ROSE]: ROSE_FUSION,
    [TrainerType.ROSE_2]: ROSE_FUSION,
    [TrainerType.VOLO]: lateSignature(200, ORIGIN_GIRATINA, [SpeciesId.LUCARIO, SpeciesFormKey.MEGA]),
    [TrainerType.CYRUS]: CYRUS_FUSION,
    [TrainerType.CYRUS_2]: CYRUS_FUSION,
  });

/**
 * Local fork (2026-11-12): the late signature of `trainerType` when it applies on `waveIndex` (the current battle's wave
 * by default), that is past its `afterWave` ({@linkcode LATE_SIGNATURE_BATTLE_FORMS}); else `undefined`
 */
export function getActiveLateSignature(
  trainerType: TrainerType,
  waveIndex: number = globalScene.currentBattle?.waveIndex ?? 0,
): LateSignatureBattleForm | undefined {
  const late = LATE_SIGNATURE_BATTLE_FORMS[trainerType];
  return late && waveIndex > late.afterWave ? late : undefined;
}

/**
 * Local fork (2026-11-11): the signature of `trainerType` on `waveIndex` (the current battle's wave by default): its
 * late signature past its wave ({@linkcode LATE_SIGNATURE_BATTLE_FORMS}), else its own
 * ({@linkcode SIGNATURE_BATTLE_FORMS}), else `undefined`
 * Local fork (2026-11-12): through {@linkcode getActiveLateSignature}, the same rule
 */
export function getSignatureBattleForm(
  trainerType: TrainerType,
  waveIndex: number = globalScene.currentBattle?.waveIndex ?? 0,
): SignatureBattleForm | undefined {
  return getActiveLateSignature(trainerType, waveIndex)?.signature ?? SIGNATURE_BATTLE_FORMS[trainerType];
}

/** Local fork (2026-11-10): the form keys that count as battle forms: every Mega key, Primal, every Gigantamax key */
export const BATTLE_FORM_KEYS: readonly string[] = Object.freeze([
  SpeciesFormKey.MEGA,
  SpeciesFormKey.MEGA_X,
  SpeciesFormKey.MEGA_Y,
  SpeciesFormKey.MEGA_Z,
  SpeciesFormKey.MEGA_ORIGINAL,
  SpeciesFormKey.MEGA_CURLY,
  SpeciesFormKey.MEGA_DROOPY,
  SpeciesFormKey.MEGA_STRETCHY,
  SpeciesFormKey.PRIMAL,
  SpeciesFormKey.GIGANTAMAX,
  SpeciesFormKey.GIGANTAMAX_SINGLE,
  SpeciesFormKey.GIGANTAMAX_RAPID,
]);

/** Local fork (2026-11-10): a battle form a Pokémon can go to from its current form */
export interface EnemyBattleFormOption {
  /** The target form's index in `species.forms` */
  readonly formIndex: number;
  /** The target form's key */
  readonly formKey: string;
  /** The item of the form change (the Mega Stone, Max Mushrooms, Red / Blue Orb) */
  readonly item: FormChangeItem;
}

/** Local fork (2026-11-10): whether `formKey` is a battle form's key ({@linkcode BATTLE_FORM_KEYS}) */
export function isBattleFormKey(formKey: string): boolean {
  return BATTLE_FORM_KEYS.includes(formKey);
}

/** Local fork (2026-11-10): the item of a form change made by an active item trigger into a battle form, or `null` */
function getBattleFormChangeItem(formChange: SpeciesFormChange): FormChangeItem | null {
  if (!isBattleFormKey(formChange.formKey) || isBattleFormKey(formChange.preFormKey)) {
    return null;
  }
  const trigger = formChange.findTrigger(SpeciesFormChangeItemTrigger) as SpeciesFormChangeItemTrigger | null;
  return trigger?.active ? trigger.item : null;
}

/** Local fork (2026-11-10): the species' form changes into a battle form, with their item */
function getBattleFormChanges(pokemon: Pokemon): { formChange: SpeciesFormChange; item: FormChangeItem }[] {
  return getSpeciesBattleFormChanges(pokemon.species.speciesId);
}

/**
 * Local fork (2026-11-12): the form changes of species `speciesId` into a battle form (Mega / G-Max / Primal through an
 * active item trigger), with their item, from any of its forms and whatever their conditions (the battle-form part of
 * {@linkcode getBattleFormOptions} before it looks at a Pokémon: its form, its moves). Split out of
 * `getBattleFormChanges` for the species-level check of the Endless trainers' fusion roll ({@linkcode speciesHasBattleForm}).
 */
export function getSpeciesBattleFormChanges(
  speciesId: SpeciesId,
): { formChange: SpeciesFormChange; item: FormChangeItem }[] {
  if (!speciesDataRegistry.hasFormChanges(speciesId)) {
    return [];
  }
  return speciesDataRegistry.getFormChanges(speciesId).flatMap(formChange => {
    const item = getBattleFormChangeItem(formChange);
    return item == null ? [] : [{ formChange, item }];
  });
}

/**
 * Local fork (2026-11-12): whether species `speciesId` has a battle form at all ({@linkcode getSpeciesBattleFormChanges}),
 * decided for the species, not a Pokémon: Rayquaza counts although its Mega needs Dragon Ascent, which a Pokémon being
 * built has no moves for yet. Eternatus has none (Eternamax is not a battle form). The Endless trainers' fusion roll
 * leaves these species alone (enemy-trainer-fusion.ts), so the battle-form roll keeps its candidates.
 */
export function speciesHasBattleForm(speciesId: SpeciesId): boolean {
  return getSpeciesBattleFormChanges(speciesId).length > 0;
}

/**
 * Local fork (2026-11-10): the battle forms `pokemon` can go to from its current form, in the species' form-change
 * order (Charizard: Mega Z, Mega X, Mega Y, G-Max). A form change with conditions counts only when they all hold.
 */
export function getBattleFormOptions(pokemon: Pokemon): EnemyBattleFormOption[] {
  const formKey = pokemon.getFormKey();
  const { forms } = pokemon.species;
  return getBattleFormChanges(pokemon).flatMap(({ formChange, item }) => {
    if (formChange.preFormKey !== formKey || !formChange.conditions.every(c => c.predicate(pokemon))) {
      return [];
    }
    const formIndex = forms.findIndex(f => f.formKey === formChange.formKey);
    return formIndex < 0 ? [] : [{ formIndex, formKey: formChange.formKey, item }];
  });
}

/**
 * Local fork (2026-11-10): whether `pokemon` can be given a battle form: not a fusion, not already in a Mega / Primal /
 * Max form, and with a battle form to go to (Eternatus has none: Eternamax is not a battle form here).
 * 2026-11-17: nor Terastallized (the Endless raid's boss, endless-raid.ts, is from the start): Mega / Max and Tera
 * never meet.
 */
export function canTakeBattleForm(pokemon: Pokemon): boolean {
  return (
    !pokemon.isFusion()
    && !pokemon.isTerastallized
    && !pokemon.isMega()
    && !pokemon.isMax()
    && pokemon.species.speciesId !== SpeciesId.ETERNATUS
    && getBattleFormOptions(pokemon).length > 0
  );
}

/**
 * Local fork (2026-11-10): the item that leads to the battle form `pokemon` is in (a Mega Stone, Max Mushrooms, the Red
 * / Blue Orb), or `null` when its form is not a battle form reached through an item.
 */
export function getBattleFormItem(pokemon: Pokemon): FormChangeItem | null {
  const formKey = pokemon.getFormKey();
  if (!isBattleFormKey(formKey)) {
    return null;
  }
  return getBattleFormChanges(pokemon).find(({ formChange }) => formChange.formKey === formKey)?.item ?? null;
}

/**
 * Local fork (2026-11-10): the form `pokemon` had before its battle form: the one {@linkcode transformToBattleForm}
 * remembered, else the form the battle form's item change starts from. Pikachu (normal / Partner), Toxtricity (Amped /
 * Low Key) and Meowstic (male / female) have two: the one `getSpeciesFormIndex` gives it (by gender and nature; run on
 * a side seed so the run's seeded sequence is untouched) when it is one of them, else the first. A Pokémon not in a
 * battle form keeps its form.
 */
export function getBaseFormIndex(pokemon: Pokemon): number {
  const { species } = pokemon;
  const remembered = (pokemon as Pokemon & Pick<EnemyPokemon, "forkBattleFormBaseIndex">).forkBattleFormBaseIndex;
  if (remembered != null && species.forms[remembered] && !isBattleFormKey(species.forms[remembered].formKey)) {
    return remembered;
  }
  const formKey = pokemon.getFormKey();
  if (!isBattleFormKey(formKey)) {
    return pokemon.formIndex;
  }
  const candidates = [
    ...new Set(
      getBattleFormChanges(pokemon)
        .filter(({ formChange }) => formChange.formKey === formKey)
        .map(({ formChange }) => species.forms.findIndex(f => f.formKey === formChange.preFormKey))
        .filter(index => index >= 0),
    ),
  ];
  if (candidates.length === 0) {
    return pokemon.formIndex;
  }
  if (candidates.length === 1) {
    return candidates[0];
  }
  let natural = -1;
  globalScene.executeWithSeedOffset(() => {
    natural = globalScene.getSpeciesFormIndex(species, pokemon.gender, pokemon.nature, true);
  }, globalScene.currentBattle?.waveIndex ?? 0);
  return candidates.includes(natural) ? natural : candidates[0];
}

/** Local fork (2026-11-10): keeps the ability index inside the current form's abilities, as `changeForm` does */
function clampAbilityIndex(pokemon: Pokemon): void {
  const abilityCount = pokemon.getSpeciesForm().getAbilityCount();
  if (pokemon.abilityIndex >= abilityCount) {
    pokemon.abilityIndex = abilityCount - 1;
  }
}

/**
 * Local fork (2026-11-10): puts the enemy in a battle form, as a trainer config does for its Megas, before its sprite
 * loads: the form (remembering the one it had, for {@linkcode getBaseFormIndex} at capture), its name, the ability
 * index clamped as `changeForm` does, the G-Max scale, a new moveset for the form (a rival's keeps its signature pool;
 * the edits its trainer config made to its old moveset are made again; the challenges' moveset rules apply again), its
 * stats, and the Pokédex's seen form.
 */
export function transformToBattleForm(enemy: EnemyPokemon, option: EnemyBattleFormOption): void {
  setBattleFormIndex(enemy, option);
  rebuildForNewForm(enemy);
  console.log(`[enemy-battle-forms] ${enemy.name} takes its ${option.formKey} form`);
}

/**
 * Local fork (2026-11-12): the form part of {@linkcode transformToBattleForm} (split out, unchanged, for the fixed trainer
 * fusions): remembers the form it had for {@linkcode getBaseFormIndex} at capture, then sets the new one
 */
function setBattleFormIndex(enemy: EnemyPokemon, option: EnemyBattleFormOption): void {
  enemy.forkBattleFormBaseIndex ??= enemy.formIndex;
  enemy.formIndex = option.formIndex;
}

/**
 * Local fork (2026-11-12): the rest of {@linkcode transformToBattleForm} (split out, unchanged, for the fixed trainer
 * fusions, which also run it on a Pokémon whose form stays and only its fusion changed): its name, the ability index
 * clamped, the scale, a new moveset with the trainer config's edits made again and the challenges' rules, its stats and
 * the Pokédex's seen form
 */
function rebuildForNewForm(enemy: EnemyPokemon): void {
  enemy.generateName();
  clampAbilityIndex(enemy);
  enemy.updateScale();
  const trainer = globalScene.currentBattle?.trainer;
  // Local fork (2026-11-10), review fix: the trainer config's hand-picked moves (`replaceInMoveset` /
  // `addIfNotInMoveset` after its own moveset: Archie's Kyogre's Ice Beam, Origin Pulse and no Blizzard, Maxie's
  // Groudon's Fire Punch, Giovanni's Mewtwo's Shadow Ball) are made again on the form's moveset, in order, as a config
  // does for its own Megas (form, moveset, then its edits); they use no random number
  const configEdits = enemy.forkMovesetEdits ?? [];
  enemy.forkMovesetEdits = undefined;
  enemy.generateAndPopulateMoveset(!!trainer && trainer.config.getDerivedType() === TrainerType.RIVAL);
  for (const edit of configEdits) {
    edit(enemy);
  }
  applyChallenges(ChallengeType.MOVESET_MODIFY, enemy);
  enemy.calculateStats();
  globalScene.gameData.setPokemonSeen(enemy, false);
}

/**
 * Local fork (2026-11-10): the percent chance of `curve` on difficulty wave `difficultyWave`: 0 before its `minWave`,
 * then `min(max, chance + floor((difficultyWave - minWave) / everyWaves) * step)` ({@linkcode BattleFormChanceCurve})
 */
export function getBattleFormChanceAt(curve: BattleFormChanceCurve, difficultyWave: number): number {
  if (difficultyWave < curve.minWave) {
    return 0;
  }
  const { step = 0, everyWaves = 0, max = 100 } = curve;
  const steps = step > 0 && everyWaves > 0 ? Math.floor((difficultyWave - curve.minWave) / everyWaves) : 0;
  return Math.min(max, curve.chance + steps * step);
}

/**
 * Local fork (2026-11-10): the tier of a trainer for its battle-form chance ({@linkcode TrainerBattleFormTier}): `boss`
 * when its config `isBoss`, `elite` for the elite trainers (`ENDLESS_ELITE_TRAINER_TYPES`, both genders and their Ace
 * Duo pairs share the type), `ordinary` for every other trainer
 */
export function getTrainerBattleFormTier(config: TrainerConfig): TrainerBattleFormTier {
  if (config.isBoss) {
    return "boss";
  }
  return ENDLESS_ELITE_TRAINER_TYPES.includes(config.trainerType) ? "elite" : "ordinary";
}

/**
 * Local fork (2026-11-10): the percent chance of a battle form ({@linkcode ENEMY_BATTLE_FORMS}): the trainer tier's
 * entry per trainer battle, `wildBoss` / `wild` per wild Pokémon; 0 before the entry's `minWave` and for other battles.
 * @param battleType - The battle's type
 * @param isBoss - Whether the wild Pokémon is a boss (ignored for trainers)
 * @param difficultyWave - The wave for difficulty (`gameMode.getWaveForDifficulty`)
 * @param trainerTier - The trainer's tier ({@linkcode getTrainerBattleFormTier}; ignored for wild Pokémon); default
 * `ordinary`
 */
export function getEnemyBattleFormChance(
  battleType: BattleType,
  isBoss: boolean,
  difficultyWave: number,
  trainerTier: TrainerBattleFormTier = "ordinary",
): number {
  let entry: BattleFormChanceCurve;
  if (battleType === BattleType.TRAINER) {
    entry = ENEMY_BATTLE_FORMS.trainer[trainerTier];
  } else if (battleType === BattleType.WILD) {
    entry = isBoss ? ENEMY_BATTLE_FORMS.wildBoss : ENEMY_BATTLE_FORMS.wild;
  } else {
    return 0;
  }
  return getBattleFormChanceAt(entry, difficultyWave);
}

/**
 * Local fork (2026-11-10): the seeded roller of the battle-form rolls (`roll(range)` returns an integer in
 * [0, range)). A test hook: tests stub `roll` with `vi.spyOn(enemyBattleFormDice, "roll")` to force an outcome; game
 * code never replaces it. Kept apart from {@linkcode ENEMY_BATTLE_FORMS}, which stays frozen.
 */
export const enemyBattleFormDice = {
  roll: (range: number): number => randSeedInt(range),
};

/**
 * Local fork (2026-11-10): the current battle's difficulty wave, or `null` when no battle form may be rolled in it: a
 * mystery encounter, the Classic final boss, and the Daily final boss (its config may set its moveset, which a new
 * form would replace)
 * Local fork (2026-11-18): exported for the enemy Z / Max move conversions (enemy-move-conversions.ts), which skip the
 * same battles (the user: "적의 기술은 그냥 낮은 확률로 적 포켓몬 기술 중 하나가 z기술/다이맥스기술 중 하나로 대체되게")
 */
export function getBattleFormRollWave(): number | null {
  const battle = globalScene.currentBattle;
  if (!battle || battle.isClassicFinalBoss || battle.isBattleMysteryEncounter() || isDailyFinalBoss(battle.waveIndex)) {
    return null;
  }
  return globalScene.gameMode.getWaveForDifficulty(battle.waveIndex);
}

/**
 * Local fork (2026-11-10): rolls whether a newly made wild Pokémon comes in a battle form, and which one; called by
 * encounter-phase.ts for each wild Pokémon. Nothing is rolled when its chance is 0 or it is not eligible.
 * @returns Whether it was transformed
 */
export function rollWildBattleForm(enemy: EnemyPokemon): boolean {
  const wave = getBattleFormRollWave();
  if (wave == null) {
    return false;
  }
  const chance = getEnemyBattleFormChance(globalScene.currentBattle.battleType, enemy.isBoss(), wave);
  if (chance <= 0 || !canTakeBattleForm(enemy) || enemyBattleFormDice.roll(100) >= chance) {
    return false;
  }
  const options = getBattleFormOptions(enemy);
  transformToBattleForm(enemy, options[enemyBattleFormDice.roll(options.length)]);
  return true;
}

/**
 * Local fork (2026-11-10): rolls once whether one Pokémon of the enemy trainer's party comes in a battle form, then
 * which Pokémon and which form; called by encounter-phase.ts after the whole party is made, before any member is marked
 * seen, set on the field or loads its sprite. Nothing is rolled when the chance is 0 or no Pokémon is eligible. A
 * Pokémon the trainer will Terastallize (`willTerastallize`: its instant-Tera slots known at this point) is not
 * eligible, so no enemy is both Mega / Max and Terastallized.
 * Local fork (2026-11-10): the chance is the trainer tier's ({@linkcode getTrainerBattleFormTier}) on this difficulty
 * wave; a signature trainer ({@linkcode SIGNATURE_BATTLE_FORMS}) goes through {@linkcode rollSignatureBattleForm}
 * instead, which may put a new Pokémon in `party`. Local fork (2026-11-10), review fix: the partner's members of a named
 * double battle whose partner is a signature trainer ({@linkcode isSignaturePartner}) are not eligible either.
 * Local fork (2026-11-12): a trainer whose late signature applies and has a fusion tail (past wave 200; the user: "합체를
 * 좀 고정해보죠") rolls nothing: {@linkcode applyFixedTrainerFusion} always gives it its fused signature Pokémon.
 * @param party - The enemy party (`currentBattle.enemyParty`)
 * @returns The Pokémon in the battle form this roll gave (a signature trainer's: also one switched to or already in its
 * signature form; a fixed fusion's head), or `null`
 */
export function rollTrainerBattleForm(party: EnemyPokemon[]): EnemyPokemon | null {
  const wave = getBattleFormRollWave();
  const trainer = globalScene.currentBattle?.trainer;
  if (wave == null || !trainer) {
    return null;
  }
  // Local fork (2026-11-12): fixed trainer fusions, before anything is rolled; nothing of it before its wave
  const fixedFusion = getActiveLateSignature(trainer.config.trainerType);
  if (fixedFusion?.fusion) {
    return applyFixedTrainerFusion(party, fixedFusion.signature, fixedFusion.fusion);
  }
  const tier = getTrainerBattleFormTier(trainer.config);
  const chance = getEnemyBattleFormChance(globalScene.currentBattle.battleType, false, wave, tier);
  // Local fork (2026-11-11): getSignatureBattleForm, so a late signature applies past its wave (Raihan)
  const signature = getSignatureBattleForm(trainer.config.trainerType);
  if (signature) {
    return rollSignatureBattleForm(party, signature, chance);
  }
  if (chance <= 0) {
    return null;
  }
  // Local fork (2026-11-10), review fix: not the trainer's instant-Tera Pokémon (a rival's starter, Red's Pikachu...);
  // the random Tera picked later by `Trainer.genAI` skips a Pokémon in a battle form instead (setRandomTeraModifiers)
  // Local fork (2026-11-10), review fix: nor, in a named double battle, the members of a signature partner (Blue's in
  // Red & Blue's, Steven's in Wallace & Steven's), whose battle form stays the fixed one (none from this roll)
  const partnerFixed = isSignaturePartner(trainer.config);
  const eligible = party.filter(
    p =>
      p
      && canTakeBattleForm(p)
      && !willTerastallize(p)
      && !(partnerFixed && p.trainerSlot === TrainerSlot.TRAINER_PARTNER),
  );
  if (eligible.length === 0 || enemyBattleFormDice.roll(100) >= chance) {
    return null;
  }
  const enemy = eligible[enemyBattleFormDice.roll(eligible.length)];
  const options = getBattleFormOptions(enemy);
  transformToBattleForm(enemy, options[enemyBattleFormDice.roll(options.length)]);
  return enemy;
}

/**
 * Local fork (2026-11-10), review fix: whether the partner of a named double battle with this main trainer's config
 * (`trainerTypeDouble`: Blue for Red, Steven for Wallace) is a signature trainer ({@linkcode SIGNATURE_BATTLE_FORMS}),
 * so the main trainer's roll leaves its members (`TrainerSlot.TRAINER_PARTNER`) alone. A battle without a partner has no
 * such members.
 */
export function isSignaturePartner(config: TrainerConfig): boolean {
  return config.trainerTypeDouble != null && getSignatureBattleForm(config.trainerTypeDouble) != null;
}

/** Local fork (2026-11-10): whether `pokemon` is in one of the signature's forms */
function isInSignatureForm(pokemon: Pokemon, signature: SignatureBattleForm): boolean {
  const formKey = pokemon.getFormKey();
  return pokemon.species.speciesId === signature.species && signature.forms.some(f => f.formKey === formKey);
}

/**
 * Local fork (2026-11-10): the signature's forms `pokemon` can go to from its current form (none for another species)
 * Local fork (2026-11-11): its battle forms first, then its signature-only forms ({@linkcode isSignatureOnlyForm}:
 * Origin Giratina), each reached from the current form through an active item trigger of the signature's item. A
 * signature of battle forms only has no signature-only form, so its options are the same as before.
 */
export function getSignatureFormOptions(pokemon: Pokemon, signature: SignatureBattleForm): EnemyBattleFormOption[] {
  if (pokemon.species.speciesId !== signature.species) {
    return [];
  }
  return [
    ...getBattleFormOptions(pokemon).filter(o => signature.forms.some(f => f.formKey === o.formKey)),
    ...getSignatureOnlyFormOptions(pokemon, signature),
  ];
}

/**
 * Local fork (2026-11-11): whether a signature form is no battle form ({@linkcode BATTLE_FORM_KEYS}): Volo's Origin
 * Giratina. Only a signature trainer's own Pokémon takes such a form or holds its item ({@linkcode
 * getSignatureOnlyFormItem}); Mega / G-Max / Primal keep every rule of their own. The user: "월로(게임 내에 있다면)-
 * 오리진 기라티나".
 */
export function isSignatureOnlyForm(formKey: string): boolean {
  return !isBattleFormKey(formKey);
}

/**
 * Local fork (2026-11-11): the signature's signature-only forms ({@linkcode isSignatureOnlyForm}) `pokemon` reaches from
 * its current form: a form change of its species into that form, from the current form, whose conditions all hold and
 * whose active item trigger is the signature's item (Giratina: Altered to Origin with the Griseous Core)
 */
function getSignatureOnlyFormOptions(pokemon: Pokemon, signature: SignatureBattleForm): EnemyBattleFormOption[] {
  const { speciesId, forms } = pokemon.species;
  if (!speciesDataRegistry.hasFormChanges(speciesId)) {
    return [];
  }
  const formKey = pokemon.getFormKey();
  const formChanges = speciesDataRegistry.getFormChanges(speciesId);
  return signature.forms.flatMap(({ formKey: target, item }) => {
    if (!isSignatureOnlyForm(target)) {
      return [];
    }
    const reachable = formChanges.some(fc => {
      if (fc.formKey !== target || fc.preFormKey !== formKey || !fc.conditions.every(c => c.predicate(pokemon))) {
        return false;
      }
      const trigger = fc.findTrigger(SpeciesFormChangeItemTrigger) as SpeciesFormChangeItemTrigger | null;
      return trigger?.active === true && trigger.item === item;
    });
    const formIndex = forms.findIndex(f => f.formKey === target);
    return reachable && formIndex >= 0 ? [{ formIndex, formKey: target, item }] : [];
  });
}

/**
 * Local fork (2026-11-11): whether `pokemon` can be given one of the signature's forms: not a fusion, not already in a
 * Mega / Primal / Max form, with a signature form to go to ({@linkcode getSignatureFormOptions}). For a signature of
 * battle forms this is `canTakeBattleForm` and a signature form to go to, as before; it also lets Altered Giratina take
 * its Origin Forme, which is no battle form.
 */
export function canTakeSignatureForm(pokemon: Pokemon, signature: SignatureBattleForm): boolean {
  return (
    !pokemon.isFusion()
    && !pokemon.isMega()
    && !pokemon.isMax()
    && pokemon.species.speciesId !== SpeciesId.ETERNATUS
    && getSignatureFormOptions(pokemon, signature).length > 0
  );
}

/**
 * Local fork (2026-11-11): the item of the signature-only form ({@linkcode isSignatureOnlyForm}) `enemy` is in, when it
 * is a Pokémon of the current battle's trainer (not the partner's of a named double battle) and that trainer's
 * signature names its species and form (Volo's Origin Giratina: the Griseous Core); else `null`. Any other Pokémon in
 * such a form (a wild Origin Giratina) holds nothing for it, as before.
 */
export function getSignatureOnlyFormItem(enemy: Pokemon): FormChangeItem | null {
  const trainer = globalScene.currentBattle?.trainer;
  if (!trainer || enemy.isPlayer() || (enemy as EnemyPokemon).trainerSlot === TrainerSlot.TRAINER_PARTNER) {
    return null;
  }
  const signature = getSignatureBattleForm(trainer.config.trainerType);
  if (!signature || enemy.species.speciesId !== signature.species) {
    return null;
  }
  const formKey = enemy.getFormKey();
  return signature.forms.find(f => f.formKey === formKey && isSignatureOnlyForm(f.formKey))?.item ?? null;
}

/**
 * Local fork (2026-11-10): the party index a signature trainer's signature Pokémon is put in at
 * ({@linkcode rollSignatureBattleForm}), or -1: among the main trainer's members (not its partner's) that are neither
 * in a battle form already (a config's Mega) nor an instant-Tera slot (`willTerastallize`), the last one of the
 * signature species' evolution line (Kadabra for Mega Alakazam, Archaludon for G-Max Duraludon, so no line is in the
 * party twice), else the last one (usually the trainer's ace, whose boss bars the new Pokémon takes over). None while
 * the enemy species override is set (it would replace the species).
 */
export function getSignatureSlot(party: readonly EnemyPokemon[], signature: SignatureBattleForm): number {
  if (activeOverrides.ENEMY_SPECIES_OVERRIDE) {
    return -1;
  }
  const free = party.flatMap((p, i) =>
    p != null && p.trainerSlot !== TrainerSlot.TRAINER_PARTNER && !isTeraBlockedForm(p) && !willTerastallize(p)
      ? [i]
      : [],
  );
  const root = speciesDataRegistry.getSpecies(signature.species).getRootSpeciesId();
  return free.filter(i => party[i].species.getRootSpeciesId() === root).at(-1) ?? free.at(-1) ?? -1;
}

/**
 * Local fork (2026-11-10): puts a new Pokémon of the signature species in the signature form in place of `party[index]`
 * ({@linkcode getSignatureSlot}), made as the Endless strong extra is (`addEnemyPokemon` at the member's level and
 * trainer slot, so it is a trainer Pokémon with the trainer's IVs, friendship and moveset rules), with the member's
 * boss bars and ball (set before it is initialised, as a trainer config does for its ace) and party place (its
 * `initialTeamIndex`, which the trainer's Tera AI reads), then put in the form ({@linkcode transformToBattleForm}:
 * name, moveset, stats, Pokédex). The member it replaces is destroyed; nothing of it was marked seen or loaded yet.
 * When the new Pokémon cannot take the form (an Endless splice), it is dropped and the member stays.
 * Local fork (2026-11-12): with `fixedTail` (a fixed trainer fusion's head), a fusion the new Pokémon was made with (the
 * fusion token, Spliced Endless) is dropped first, and it takes the signature's first form with that tail fused on
 * ({@linkcode setUpFixedFusion}), no roll; without it, all is as before.
 * @returns The new Pokémon, or `null`
 */
function putInSignaturePokemon(
  party: EnemyPokemon[],
  index: number,
  signature: SignatureBattleForm,
  fixedTail?: SignatureFusionTail,
): EnemyPokemon | null {
  const replaced = party[index];
  const pokemon = globalScene.addEnemyPokemon(
    speciesDataRegistry.getSpecies(signature.species),
    replaced.level,
    replaced.trainerSlot,
    false,
    false,
    undefined,
    p => {
      if (replaced.isBoss()) {
        p.setBoss(true, replaced.bossSegments);
      }
      p.pokeball = replaced.pokeball;
    },
  );
  pokemon.initialTeamIndex = replaced.initialTeamIndex;
  // Local fork (2026-11-12): a fixed fusion's head drops the fusion it was made with; its own tail is set below
  if (fixedTail && pokemon.isFusion()) {
    pokemon.clearFusionSpecies();
  }
  // Local fork (2026-11-11): canTakeSignatureForm, so a signature-only form (Origin Giratina) can be put in too; for
  // a signature of battle forms it is the canTakeBattleForm check as before
  const options = canTakeSignatureForm(pokemon, signature) ? getSignatureFormOptions(pokemon, signature) : [];
  if (options.length === 0) {
    pokemon.destroy();
    return null;
  }
  if (fixedTail) {
    setUpFixedFusion(pokemon, options[0], fixedTail);
  } else {
    transformToBattleForm(pokemon, options[enemyBattleFormDice.roll(options.length)]);
  }
  party[index] = pokemon;
  replaced.destroy();
  console.log(`[enemy-battle-forms] ${pokemon.name} takes the place of party member ${index}`);
  return pokemon;
}

/**
 * Local fork (2026-11-10): a signature trainer's member of the signature species that is already in a battle form (a
 * trainer config's own, {@linkcode rollSignatureBattleForm} step 1): it stays when that is a signature form, else goes
 * back to its own form ({@linkcode getBaseFormIndex}) and takes a signature form (one at random when there are
 * several). A spliced one, or one that cannot reach a signature form from its own form, stays as it is.
 * @returns `pokemon` when it ends in a signature form, else `null`
 */
function settleSignatureForm(pokemon: EnemyPokemon, signature: SignatureBattleForm): EnemyPokemon | null {
  if (isInSignatureForm(pokemon, signature)) {
    return pokemon;
  }
  if (pokemon.isFusion()) {
    return null;
  }
  const formIndex = pokemon.formIndex;
  pokemon.formIndex = getBaseFormIndex(pokemon);
  const options = getSignatureFormOptions(pokemon, signature);
  if (options.length === 0) {
    pokemon.formIndex = formIndex;
    return null;
  }
  transformToBattleForm(pokemon, options[enemyBattleFormDice.roll(options.length)]);
  return pokemon;
}

/**
 * Local fork (2026-11-10): the battle form of a signature trainer ({@linkcode SIGNATURE_BATTLE_FORMS}), from
 * {@linkcode rollTrainerBattleForm}. Only the main trainer's members count (in a named double battle its partner's are
 * left alone), and the trainer never puts another member in a battle form instead.
 * 1. A member of the species already in a battle form (a trainer config's own: Cynthia's Mega Garchomp, Leon's G-Max
 *    Charizard) stays when it is a signature form, else goes back to its own form and takes a signature form (one at
 *    random when there are several; {@linkcode settleSignatureForm}); no roll for either. A spliced one stays as it is.
 * 2. Otherwise, once the trainer's roll (`chance`) hits: the last member of the species that can take a signature form
 *    (not a fusion, not an instant-Tera slot) takes one; with no member of the species in the party, the species is put
 *    in place of a member ({@linkcode getSignatureSlot}, {@linkcode putInSignaturePokemon}). A party that holds the
 *    species but cannot transform it (spliced, Terastallizing), or has no slot for it, rolls nothing.
 * @returns The member in the signature form, or `null`
 */
function rollSignatureBattleForm(
  party: EnemyPokemon[],
  signature: SignatureBattleForm,
  chance: number,
): EnemyPokemon | null {
  const ofSpecies = party.filter(
    p => p != null && p.trainerSlot !== TrainerSlot.TRAINER_PARTNER && p.species.speciesId === signature.species,
  );
  // Local fork (2026-11-11): or in a signature-only form (Volo's config Origin Giratina), which then stays as it is
  const inForm = ofSpecies.find(p => isBattleFormKey(p.getFormKey()) || isInSignatureForm(p, signature));
  if (inForm) {
    return settleSignatureForm(inForm, signature);
  }
  if (chance <= 0) {
    return null;
  }
  const target = ofSpecies
    // Local fork (2026-11-11): canTakeSignatureForm (canTakeBattleForm with a signature form to go to, for a signature
    // of battle forms as before; Altered Giratina for Volo's)
    .filter(p => canTakeSignatureForm(p, signature) && !willTerastallize(p))
    .at(-1);
  const slot = target || ofSpecies.length > 0 ? -1 : getSignatureSlot(party, signature);
  if ((!target && slot < 0) || enemyBattleFormDice.roll(100) >= chance) {
    return null;
  }
  if (!target) {
    return putInSignaturePokemon(party, slot, signature);
  }
  const options = getSignatureFormOptions(target, signature);
  transformToBattleForm(target, options[enemyBattleFormDice.roll(options.length)]);
  return target;
}

/**
 * Local fork (2026-11-12): a fixed trainer fusion ({@linkcode LATE_SIGNATURE_BATTLE_FORMS}, `fusion`), from
 * {@linkcode rollTrainerBattleForm} past the entry's wave; nothing is rolled for it (only the seeded draws of the new
 * moveset, the tail's ability slot and, when it changes, the Tera type). The user: "합체를 좀 고정해보죠 / 난천(메한카 +
 * 메한카z) 라던가. / 비주기(메가뮤츠x+메가뮤츠y)라던가."
 * - The head is a main-trainer member of the signature species (in a {@linkcode rollSignatureBattleForm} way: one in a
 *   battle form or a signature form first, else the last one), whatever its Tera plan (its Mega / Max form will
 *   block a Tera anyway); with none, a new one is put in place of a member ({@linkcode getSignatureSlot},
 *   {@linkcode putInSignaturePokemon}).
 * - A fusion the head already has (the fusion token, the Endless trainers' extra roll, Spliced Endless) is dropped.
 * - It takes the signature's form (its first one; there is one per entry) unless it is already in a signature form
 *   (Leon's G-Max Charizard, Steven's Mega Metagross, Volo's Origin Giratina, from their configs), and the tail is fused
 *   onto it ({@linkcode setUpFixedFusion}).
 * - A member of the species that cannot reach the form from its own form is replaced by a new one.
 * Only the main trainer's members count; a signature partner of a named double battle is left alone.
 * @returns The fused head, or `null` when there is no slot for it
 */
export function applyFixedTrainerFusion(
  party: EnemyPokemon[],
  signature: SignatureBattleForm,
  tail: SignatureFusionTail,
): EnemyPokemon | null {
  const ofSpecies = party.filter(
    p => p != null && p.trainerSlot !== TrainerSlot.TRAINER_PARTNER && p.species.speciesId === signature.species,
  );
  const head =
    ofSpecies.find(p => isBattleFormKey(p.getFormKey()) || isInSignatureForm(p, signature)) ?? ofSpecies.at(-1);
  if (!head) {
    const slot = getSignatureSlot(party, signature);
    return slot < 0 ? null : putInSignaturePokemon(party, slot, signature, tail);
  }
  if (head.isFusion()) {
    head.clearFusionSpecies();
  }
  if (isInSignatureForm(head, signature)) {
    setUpFixedFusion(head, null, tail);
    return head;
  }
  const formIndex = head.formIndex;
  head.formIndex = getBaseFormIndex(head);
  const options = getSignatureFormOptions(head, signature);
  if (options.length === 0) {
    head.formIndex = formIndex;
    return putInSignaturePokemon(party, party.indexOf(head), signature, tail);
  }
  setUpFixedFusion(head, options[0], tail);
  return head;
}

/**
 * Local fork (2026-11-12): puts the head of a fixed trainer fusion in the signature form `option` (`null`: it stays in
 * its form), fuses `tail` onto it ({@linkcode setFixedFusionTail}), rolls its Tera type again from the fused types
 * when it is none of them (as a fused enemy's is rolled in the `Pokemon` constructor), then makes everything that
 * depends on the form and the fusion again as {@linkcode transformToBattleForm} does (name, moveset from the fused
 * learnset with the trainer config's edits, stats, Pokédex), at full HP.
 */
function setUpFixedFusion(head: EnemyPokemon, option: EnemyBattleFormOption | null, tail: SignatureFusionTail): void {
  if (option) {
    setBattleFormIndex(head, option);
  }
  setFixedFusionTail(head, tail);
  const types = head.getTypes({ includeTeraType: false, bypassSummonData: true, ignoreThirdType: true });
  if (!types.includes(head.teraType)) {
    head.teraType = randSeedItem(types);
  }
  rebuildForNewForm(head);
  head.hp = head.getMaxHp();
  console.log(`[enemy-battle-forms] ${head.name} is a fixed fusion (${SpeciesId[tail.species]} ${tail.formKey})`);
}

/**
 * Local fork (2026-11-12): the fusion fields of a fixed trainer fusion's tail, set as `Pokemon.generateFusionSpecies`
 * sets an enemy's, on the tail's species and form: the ability slot from the tail form's abilities (hidden at the same
 * 1 in 256 a trainer's Pokémon has, else one of the two at random), the gender from the head's id and the tail's ratio,
 * not shiny (an enemy's fusion is made before its shiny roll, so its tail never is) and its luck 0; the head's luck
 * counts its own shininess only.
 */
function setFixedFusionTail(head: EnemyPokemon, tail: SignatureFusionTail): void {
  const species = speciesDataRegistry.getSpecies(tail.species);
  const fusionFormIndex = Math.max(
    species.forms.findIndex(f => f.formKey === tail.formKey),
    0,
  );
  const form = species.forms[fusionFormIndex] ?? species;
  const hasHiddenAbility = !randSeedInt(BASE_HIDDEN_ABILITY_RATE);
  const randAbilityIndex = randSeedInt(2);
  head.fusionSpecies = species;
  head.fusionFormIndex = fusionFormIndex;
  head.fusionAbilityIndex =
    form.abilityHidden && hasHiddenAbility ? 2 : form.ability2 === form.ability1 ? 0 : randAbilityIndex;
  head.fusionShiny = false;
  head.fusionVariant = 0;
  if (species.malePercent == null) {
    head.fusionGender = Gender.GENDERLESS;
  } else {
    head.fusionGender = (head.id % 256) * 0.390625 < species.malePercent ? Gender.MALE : Gender.FEMALE;
  }
  head.fusionLuck = 0;
  head.fusionCustomPokemonData = null;
  head.luck = head.shiny ? head.variant + 1 : 0;
}

/**
 * Local fork (2026-11-10): a new active form-change item `item` for `pokemon`, its type made by the reward generator
 * (`RARE_FORM_CHANGE_ITEM` below 150, as the generators split them, else `FORM_CHANGE_ITEM`) so it carries the type id
 * and tier a save needs to restore it, on the enemy's side and on the player's after a capture.
 * Local fork (2026-11-18): exported for the enemy Dynamax state's Max Mushrooms (enemy-dynamax.ts; the user: "적
 * 다이맥스 상태 넣고"), made the same way, so a save restores them with the enemy's other items.
 */
export function newFormChangeItem(item: FormChangeItem, pokemon: Pokemon): PokemonFormChangeItemModifier {
  const typeFunc = item < 150 ? modifierTypes.RARE_FORM_CHANGE_ITEM : modifierTypes.FORM_CHANGE_ITEM;
  const generator = typeFunc().withIdFromFunc(typeFunc).withTierFromPool(ModifierPoolType.PLAYER);
  const type = (generator as ModifierTypeGenerator).generateType([], [item]) as FormChangeItemModifierType;
  return type.newModifier(pokemon) as PokemonFormChangeItemModifier;
}

/** Local fork (2026-11-10): the form-change items the enemy `pokemon` holds */
function getEnemyFormChangeItems(pokemon: Pokemon): PokemonFormChangeItemModifier[] {
  return globalScene.findModifiers(
    m => m instanceof PokemonFormChangeItemModifier && m.pokemonId === pokemon.id,
    false,
  ) as PokemonFormChangeItemModifier[];
}

/**
 * Local fork (2026-11-10): the item an enemy in a battle form should hold for it (active, not transferable), or `null`
 * when it is in no battle form or already holds that item; `BattleScene.generateEnemyModifiers` adds it.
 */
export function newEnemyBattleFormItem(enemy: EnemyPokemon): PokemonFormChangeItemModifier | null {
  // Local fork (2026-11-11): or a signature trainer's signature-only form's item (Volo's Origin Giratina: the Griseous
  // Core), active and not transferable like the others
  const item = getBattleFormItem(enemy) ?? getSignatureOnlyFormItem(enemy);
  if (item == null || getEnemyFormChangeItems(enemy).some(m => m.formChangeItem === item)) {
    return null;
  }
  return newFormChangeItem(item, enemy);
}

/** Local fork (2026-11-10): the {@linkcode ENEMY_BATTLE_FORMS}.keepOnCapture entry for `pokemon`'s form, if any */
export function getBattleFormKeptOnCapture(pokemon: Pokemon): BattleFormKeptOnCapture | undefined {
  const formKey = pokemon.getFormKey();
  return ENEMY_BATTLE_FORMS.keepOnCapture.find(k => k.species === pokemon.species.speciesId && k.formKey === formKey);
}

/**
 * Local fork (2026-11-10): readies a just-caught enemy in a battle form for the capture code, which then copies the
 * Pokémon and every item its side holds to the player; called first thing by the capture code.
 * - Primal Groudon / Primal Kyogre / Mega Rayquaza (`keepOnCapture`): stay as they are and hold their item, active
 *   (made here if the enemy did not hold it), so the player's copy holds it. Its form does not change again when it
 *   reaches the player: the item's forward form change starts from the base form, and the reverse one needs it
 *   inactive.
 * - Every other one: back to its own form ({@linkcode getBaseFormIndex}), with its name, ability index and stats, and
 *   its battle-form items (the ones of this form and of the forms it can reach) are taken off it, so they never reach
 *   the player; its other items move as before.
 */
export function prepareBattleFormCapture(pokemon: EnemyPokemon): void {
  const item = getBattleFormItem(pokemon);
  if (item == null) {
    return;
  }
  const held = getEnemyFormChangeItems(pokemon);
  const kept = getBattleFormKeptOnCapture(pokemon);
  if (kept) {
    const keptItem = held.find(m => m.formChangeItem === kept.item);
    if (keptItem) {
      keptItem.active = true;
    } else {
      globalScene.addEnemyModifier(newFormChangeItem(kept.item, pokemon), true);
    }
    return;
  }

  pokemon.formIndex = getBaseFormIndex(pokemon);
  pokemon.forkBattleFormBaseIndex = undefined;
  pokemon.generateName();
  clampAbilityIndex(pokemon);
  pokemon.calculateStats();
  const battleFormItems = new Set([item, ...getBattleFormOptions(pokemon).map(option => option.item)]);
  for (const modifier of held) {
    if (battleFormItems.has(modifier.formChangeItem)) {
      globalScene.removeModifier(modifier, true);
    }
  }
}
