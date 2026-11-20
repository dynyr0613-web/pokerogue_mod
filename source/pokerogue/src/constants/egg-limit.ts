/**
 * Local fork (2026-11-20): the most Eggs the player may hold, 999 instead of 99 (the user: "알 최대 갯수를 늘리고 알 목록
 * 창에서 옆으로 넘기기 가 가능하게 하죠, 1/99 페이지 이런 식으로 보이도록"; the main session chose 999).
 * Checked by the egg gacha (each pull and "전부 뽑기") and by buying an Egg with candies in the starter select and the
 * Pokédex. `EGG_FREE_GACHA_PULLS_OVERRIDE` (gacha) and `UNLIMITED_EGG_COUNT_OVERRIDE` (candies) still lift it, and the
 * Eggs a Mystery Encounter gives are not checked (as before).
 * The egg list shows the Eggs in pages of 99 (`EGG_LIST_PAGE_SIZE` in `egg-list-ui-handler.ts`).
 */
export const EGG_LIMIT = 999;
