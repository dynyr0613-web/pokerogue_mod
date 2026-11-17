/**
 * Local fork (2026-11-12): most of the fork's custom items and the custom passives unlock with the first Classic clear
 * (the user: "저희 대부분의 커스텀 아이템과 커스텀 패시브는 클래식 클리어 후 해금으로 하죠. 개조를 하는 주된 이유가
 * 엔드리스에 있어서요.").
 *
 * - The flag: {@linkcode FORK_UNLOCK}.unlockable, `Unlockables.ENDLESS_MODE`. It is what the first Classic win unlocks
 *   (`GameOverPhase.handleUnlocks` queues the `UnlockPhase` that sets it), it is saved with the system data, and the
 *   title menu already offers Endless only once it is set, so "unlocked" means exactly "Endless is open". It applies in
 *   every mode (Classic, Challenge, Daily...); an Endless run is always unlocked, since it needs the same flag to start.
 * - Locked = the original game:
 *   1. the reward pools offer none of {@linkcode FORK_UNLOCK}.gatedItems (weight 0 in
 *      `regenerateModifierPoolThresholds`, modifier-type.ts; the fork's own Mega Stones are left out of the form change
 *      item generator, `FormChangeItemModifierTypeGenerator`);
 *   2. enemies roll none of the fork items (`rollEnemyCustomItems`, enemy-custom-items.ts);
 *   3. every Pokémon uses the base game's passive (`Pokemon.usesCustomPassive`): the starter menu's passive choice is
 *      closed (it says when it opens) and the enemies' 1-in-8 roll of our passive is off. The saved choices
 *      (`StarterDataEntry.customPassiveSpecies`) are kept as they are and take effect again once unlocked.
 * - Not gated: upstream items the fork changed (초점렌즈, 멀티렌즈 caps...), the QoL rules, mystery encounters and their
 *   own rewards, the custom Megas and abilities themselves, enemy buffs and the Endless balance.
 *
 * Tests run unlocked (test/setup/vitest.setup.ts sets `FORK_CONTENT_UNLOCK_OVERRIDE` to `true`); a test of the locked
 * state turns it off with `game.override.forkContentUnlocked(false)`.
 */

import { globalScene } from "#app/global-scene";
import { activeOverrides } from "#app/overrides";
import { FormChangeItem } from "#enums/form-change-item";
import { Unlockables } from "#enums/unlockables";

/**
 * Local fork (2026-11-12): the fork content gate (see the file comment), in one place. `gatedItems` holds modifier type
 * ids (the keys of `modifierTypes`) and the `FormChangeItem` names of the fork's own Mega Stones. "대부분" (most): to
 * exempt an item, delete its line and it is offered before the first Classic clear too.
 */
export const FORK_UNLOCK = Object.freeze({
  /** The save flag that opens the fork content: set by the first Classic win */
  unlockable: Unlockables.ENDLESS_MODE,
  /** What the reward pools leave out while locked */
  gatedItems: new Set<string>([
    "ASSAULT_VEST", // 돌격조끼
    "BULLETPROOF_VEST", // 방탄조끼
    "PRISM", // 프리즘
    "LIFE_ORB", // 생명의구슬
    "CANDY_PILE", // 사탕더미
    "IV_CANDY", // 기력의사탕 / 힘의사탕 / 수비의사탕 / 지식의사탕 / 마음의사탕 / 속도의사탕
    "CHOICE_BAND", // 구애머리띠
    "CHOICE_SCARF", // 구애스카프
    "CHOICE_SPECS", // 구애안경
    "CHOICE_ARMOR", // 구애갑옷
    "RED_EVOLUTION_CRYSTAL", // 붉은진화의휘석
    "BLUE_EVOLUTION_CRYSTAL", // 푸른진화의휘석
    "TRAINING_SHACKLES", // 트레이닝족쇄
    "ULTIMATE_GENE", // 궁극유전자
    "RADIOACTIVE_WASTE", // 방사성폐기물
    "FLAME_CAULDRON", // 화염가마솥
    "TOXIC_DISTILLER", // 맹독증류기
    "DISCHARGED_COIL", // 방전코일
    "FOUR_LEAF_CLOVER_LEAF", // 네잎클로버 잎
    "FOUR_LEAF_CLOVER", // 네잎클로버
    "GOLDEN_FOUR_LEAF_CLOVER", // 황금 네잎클로버
    "MASTER_TM", // 마스터 기술머신
    "PUNCHING_GLOVE", // 펀치글러브
    "MASTER_PUNCHING_GLOVE", // 마스터 펀치글러브
    "POWER_HERB", // 파워풀허브
    "METRONOME", // 메트로놈
    "LOADED_DICE", // 속임수주사위
    "SEED_POUCH", // 씨앗주머니
    "FUEL", // 연료
    "EXPERT_BELT", // 달인의띠
    "PRECISION_LENS", // 정밀렌즈
    "CLEAR_AMULET", // 클리어참
    "BOOSTER_ENERGY", // 부스트에너지
    "THROAT_SPRAY", // 목스프레이
    "MUSCLE_BAND", // 힘의머리띠
    "WISE_GLASSES", // 박식안경
    "PIERCING_TOKEN", // 관통 토큰 (Local fork 2026-11-12)
    "GUARD_TOKEN", // 방호 토큰 (Local fork 2026-11-13, 09 명세 4번)
    "WEIGHT_BAND", // 중량밴드 (Local fork 2026-11-12)
    "CHAMPION_BELT", // 챔피언벨트 (Local fork 2026-11-12)
    "POWER_WEIGHT", // 파워웨이트 (Local fork 2026-11-12, the EV items)
    "POWER_BRACER", // 파워리스트
    "POWER_BELT", // 파워벨트
    "POWER_LENS", // 파워렌즈
    "POWER_BAND", // 파워밴드
    "POWER_ANKLET", // 파워앵클릿
    "Z_RING", // Z링 (Local fork 2026-11-16, Z-Moves and Max Moves)
    "DYNAMAX_CANDY", // 다이사탕
    "Z_CRYSTAL", // Z크리스탈 (노말Z … / 피카츄Z …)
    // The fork's own Mega Stones (FormChangeItem 140-144, in no upstream pool)
    "CHARIZARDITE_Z", // 리자몽나이트Z
    "BAXCALIBRITE_Z", // 드닐레이브나이트Z
    "GALLADITE_Z", // 엘레이드나이트Z
    "MELMETALITE", // 멜메탈나이트
    "ARCHALUDONITE", // 브리두라스나이트
  ]) as ReadonlySet<string>,
});

/**
 * Local fork (2026-11-12): whether this save has the fork's custom items and passives: the first Classic clear
 * ({@linkcode FORK_UNLOCK}.unlockable, which the dev override `ITEM_UNLOCK_OVERRIDE` can also force), or
 * `FORK_CONTENT_UNLOCK_OVERRIDE` when it is set (tests: `true` unless a test turns it off).
 */
export function isForkContentUnlocked(): boolean {
  const override = activeOverrides.FORK_CONTENT_UNLOCK_OVERRIDE;
  if (override != null) {
    return override;
  }
  return globalScene?.gameData?.isUnlocked(FORK_UNLOCK.unlockable) ?? false;
}

/**
 * Local fork (2026-11-12): whether the reward pools leave out the item with modifier type id `id` right now (locked, and
 * the id is in {@linkcode FORK_UNLOCK}.gatedItems)
 */
export function isForkItemLocked(id: string): boolean {
  return FORK_UNLOCK.gatedItems.has(id) && !isForkContentUnlocked();
}

/** Local fork (2026-11-12): whether the form change item generator leaves out `item` right now (one of our Mega Stones) */
export function isForkFormChangeItemLocked(item: FormChangeItem): boolean {
  return isForkItemLocked(FormChangeItem[item]);
}
