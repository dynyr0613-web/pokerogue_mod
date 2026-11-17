/*
 * Local fork (2026-11-08): draw scales for `items` atlas icons. The user's notes (docs/다음_패치_메모.md §4):
 * "라운드 클리어 보상, 능력치 창에서 표시되는 아이템들 크기도 약간씩 줄여야" and
 * "저희가 추가한 사탕류는 유독 크네요, 크기를 10%정도 더 줄이기로".
 * Local fork (2026-11-11): per-icon scales for more of the fork's icons, picked by the user from a comparison sheet
 * (docs/item_icon_size_compare.png): "펀치글러브 0.7, 목스프레이 0.6, 프리즘 0.9, 개체값사탕 0.75로 합시다".
 * The atlas frames stay untouched (resampling 32x32 pixel art by 0.9 would blur it); each draw site scales its sprite.
 */

/** Side of every frame in the `items` atlas (all frames have an untrimmed 32x32 source size) */
export const ITEM_ICON_SOURCE_SIZE = 32;

/** Item icons on the round-clear reward / shop screen draw 10% smaller (one row, the fork's two rows, the shop) */
export const REWARD_ITEM_ICON_SCALE = 0.9;

/** Held-item icons in the summary (능력치) screen draw 10% smaller */
export const SUMMARY_ITEM_ICON_SCALE = 0.9;

/** Extra scale for 사탕더미 (Candy Pile), which looks big next to the official icons (2026-11-08) */
export const FORK_CANDY_ICON_SCALE = 0.9;

/** Extra scale for the six IV candies: 0.9 on 2026-11-08, 0.75 since 2026-11-11 (the user: "개체값사탕 0.75") */
export const IV_CANDY_ICON_SCALE = 0.75;

/**
 * The fork's candy icons: the six IV candies (기력의사탕 … 속도의사탕, Cobblemon's 16x16 art scaled 2x by
 * tools/port/install_iv_candy_icons.py) and 사탕더미 (Candy Pile, tools/port/install_candy_pile_icon.py).
 * Kept as plain frame names so this module needs no modifier imports; a test keeps it in step with
 * `IvCandyModifierType.items` and the CANDY_PILE type.
 */
export const FORK_CANDY_ICONS: ReadonlySet<string> = new Set([
  "health_candy",
  "mighty_candy",
  "tough_candy",
  "smart_candy",
  "courage_candy",
  "quick_candy",
  "candy_pile",
]);

/**
 * Local fork (2026-11-12): the scale of 중량밴드 / 챔피언벨트 (Weight Band / Champion Belt), the user's own art ("여기
 * 파워웨이트랑 챔피언벨트 이미지입니다"). Both are 30 pixels wide in their 32x32 frames, where the official belts and
 * bands (교정깁스, 달인의띠, 기합의머리띠) are 21-22: 0.75 brings them to that width (docs/belt_icons_preview.png)
 */
export const HP_BELT_ICON_SCALE = 0.75;

/**
 * Local fork (2026-11-12): the scale of the six EV items (파워웨이트 … 파워앵클릿), Cobblemon's textures scaled 2x (the
 * user: "아이콘은 또 코블버스에서 가져온 뒤 배율만 조정하면 됩니다"). Their rings are 28 pixels wide (파워렌즈 32) and solid,
 * where the official belts and bands are 21-22 and thin; 0.7, the Punching Glove's (also a solid 28-pixel Cobblemon
 * icon), brings them to about 20 (docs/ev_items_icon_preview.png shows 0.6 / 0.7 / 0.8 next to the atlas' items)
 */
export const EV_ITEM_ICON_SCALE = 0.7;

/** Local fork (2026-11-12): the EV items' frame names (`EV_RULES.items` in ev-items.ts; a test keeps them in step) */
export const EV_ITEM_ICONS: readonly string[] = Object.freeze([
  "power_weight",
  "power_bracer",
  "power_belt",
  "power_lens",
  "power_band",
  "power_anklet",
]);

/**
 * Local fork (2026-11-16): the scales of the Z-Moves and Max Moves rewards' icons, Cobblemon: Mega Showdown's 16x16
 * textures scaled 2x (tools/port_zmax_1116/make_cobbleverse_icons.py). The user: "아이콘은 언제나처럼 코블버스 쪽에서
 * 빼오면 됩니다 / 거기에 다이사탕이랑 z링, z 크리스탈들 도트 이미지가 다 있어요 / 이미지가 크지 않도록 배율 조절도
 * 해주세요". Measured in the 32x32 frames (visible width x height, opaque pixels; docs/zmax_icons_preview.png):
 * - Z crystals 32x18 (320-336 px) against the official crystal `ultranecrozium_z` 28x13 (208 px): 0.8 gives 25.6x14.4
 *   (205-215 px).
 */
export const Z_CRYSTAL_ICON_SCALE = 0.8;

/**
 * Local fork (2026-11-16): Z링 is a solid 28x28 disc (668 px) like the EV items (0.7); the official 다이맥스밴드 is 21x21
 * (295 px) and 메가링 18x14 (206 px): 0.7 gives 19.6x19.6 (327 px). See {@linkcode Z_CRYSTAL_ICON_SCALE}
 */
export const Z_RING_ICON_SCALE = 0.7;

/**
 * Local fork (2026-11-16): 다이사탕 is a star that fills the whole 32x32 frame (604 px, with gaps between its arms); the
 * official 이상한사탕 is 21x21 (209 px): 0.65 gives 20.8x20.8 (255 px). See {@linkcode Z_CRYSTAL_ICON_SCALE}
 */
export const DYNAMAX_CANDY_ICON_SCALE = 0.65;

/**
 * Local fork (2026-11-16): the frame names of the 18 type Z crystals and the 16 exclusive ones (`Z_TYPE_CRYSTAL_ICONS`
 * in zmax-items.ts and `EXCLUSIVE_Z[].icon` in zmax-data.ts; a test keeps them in step). `ultranecrozium_z`, Necrozma's
 * form change item, keeps PokeRogue's own icon and scale; the reward crystal is `ultranecrozium_z_crystal`
 */
export const Z_CRYSTAL_ICONS: readonly string[] = Object.freeze([
  "normalium_z",
  "fightinium_z",
  "flyinium_z",
  "poisonium_z",
  "groundium_z",
  "rockium_z",
  "buginium_z",
  "ghostium_z",
  "steelium_z",
  "firium_z",
  "waterium_z",
  "grassium_z",
  "electrium_z",
  "psychium_z",
  "icium_z",
  "dragonium_z",
  "darkinium_z",
  "fairium_z",
  "pikanium_z",
  "aloraichium_z",
  "decidium_z",
  "incinium_z",
  "primarium_z",
  "eevium_z",
  "snorlium_z",
  "mewnium_z",
  "tapunium_z",
  "marshadium_z",
  "kommonium_z",
  "lycanium_z",
  "mimikium_z",
  "solganium_z",
  "lunalium_z",
  "ultranecrozium_z_crystal",
]);

/**
 * Every icon drawn at another scale than 1, by frame name. The candies as above; the Cobblemon icons that fill the
 * whole 32x32 frame (펀치글러브 and 마스터 펀치글러브 share one drawing) and 프리즘 as the user chose on 2026-11-11;
 * 클리어참 0.7 (2026-11-13);
 * the two HP belts (2026-11-12, {@linkcode HP_BELT_ICON_SCALE}); the six EV items (2026-11-12,
 * {@linkcode EV_ITEM_ICON_SCALE}); Z링, 다이사탕 and the Z crystals (2026-11-16, {@linkcode Z_CRYSTAL_ICON_SCALE}).
 */
export const ITEM_ICON_SCALES: ReadonlyMap<string, number> = new Map([
  ["health_candy", IV_CANDY_ICON_SCALE],
  ["mighty_candy", IV_CANDY_ICON_SCALE],
  ["tough_candy", IV_CANDY_ICON_SCALE],
  ["smart_candy", IV_CANDY_ICON_SCALE],
  ["courage_candy", IV_CANDY_ICON_SCALE],
  ["quick_candy", IV_CANDY_ICON_SCALE],
  ["candy_pile", FORK_CANDY_ICON_SCALE],
  ["punching_glove", 0.7],
  ["master_punching_glove", 0.7],
  ["throat_spray", 0.6],
  ["prism", 0.9],
  // Local fork (2026-11-13): the user: "저희 클리어참도 0.7배로 해둡시다 크기" (a Cobblemon icon that fills the frame)
  ["clear_amulet", 0.7],
  ["weight_band", HP_BELT_ICON_SCALE],
  ["champion_belt", HP_BELT_ICON_SCALE],
  ...EV_ITEM_ICONS.map(icon => [icon, EV_ITEM_ICON_SCALE] as const),
  // Local fork (2026-11-16): the Cobbleverse (Mega Showdown) icons of the Z-Moves and Max Moves rewards
  ["z_ring", Z_RING_ICON_SCALE],
  ["dynamax_candy", DYNAMAX_CANDY_ICON_SCALE],
  ...Z_CRYSTAL_ICONS.map(icon => [icon, Z_CRYSTAL_ICON_SCALE] as const),
]);

/**
 * Per-icon draw scale, multiplied into whatever scale a draw site already uses.
 * @param iconImage - The frame name in the `items` atlas
 * @returns The icon's entry in {@linkcode ITEM_ICON_SCALES}, 1 for every other icon
 */
export function getItemIconScale(iconImage: string | null | undefined): number {
  return (iconImage != null && ITEM_ICON_SCALES.get(iconImage)) || 1;
}

/**
 * How far to move an items-atlas sprite along one axis so its icon stays centred when its scale changes.
 * Sprites with origin 0.5 need no shift; the modifier bar and summary icons use origin (0, 0.5).
 * @param origin - The sprite's origin on that axis
 * @param scaleBefore - The scale the draw site used before (its centre is kept)
 * @param scaleAfter - The new scale
 * @returns The offset to add to the sprite's position on that axis
 */
export function getItemIconCentringOffset(origin: number, scaleBefore: number, scaleAfter: number): number {
  return (0.5 - origin) * ITEM_ICON_SOURCE_SIZE * (scaleBefore - scaleAfter);
}
