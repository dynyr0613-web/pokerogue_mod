/*
 * Local fork (2026-11-08): draw scales for `items` atlas icons. The user's notes (docs/다음_패치_메모.md §4):
 * "라운드 클리어 보상, 능력치 창에서 표시되는 아이템들 크기도 약간씩 줄여야" and
 * "저희가 추가한 사탕류는 유독 크네요, 크기를 10%정도 더 줄이기로".
 * Local fork (2026-11-11): per-icon scales for more of the fork's icons, picked by the user from a comparison sheet
 * (docs/item_icon_size_compare.png): "펀치글러브 0.7, 목스프레이 0.6, 프리즘 0.9, 개체값사탕 0.75로 합시다".
 * Local fork (2026-11-18): the icons that came from Cobblemon / Mega Showdown (16x16 scaled 2x) are now PokéSprite's
 * 32x32 originals (see {@linkcode POKESPRITE_ITEM_ICONS}) and draw at 1 like PokeRogue's own icons.
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

/**
 * Local fork (2026-11-12): the scale of 중량밴드 / 챔피언벨트 (Weight Band / Champion Belt), the user's own art ("여기
 * 파워웨이트랑 챔피언벨트 이미지입니다"). Both are 30 pixels wide in their 32x32 frames, where the official belts and
 * bands (교정깁스, 달인의띠, 기합의머리띠) are 21-22: 0.75 brings them to that width (docs/belt_icons_preview.png)
 */
export const HP_BELT_ICON_SCALE = 0.75;

/**
 * Local fork (2026-11-18): the six IV candies' frame names (기력의사탕 … 속도의사탕, `IvCandyModifierType.items`; a test
 * keeps them in step). PokéSprite's Let's Go candies (items/av-candy) since 2026-11-18; they were Cobblemon's drawn at
 * 0.9 (2026-11-08) and 0.75 (2026-11-11, the user: "개체값사탕 0.75")
 */
export const IV_CANDY_ICONS: readonly string[] = Object.freeze([
  "health_candy",
  "mighty_candy",
  "tough_candy",
  "smart_candy",
  "courage_candy",
  "quick_candy",
]);

/**
 * Local fork (2026-11-12): the EV items' frame names (`EV_RULES.items` in ev-items.ts; a test keeps them in step).
 * PokéSprite's items/ev-item since 2026-11-18; Cobblemon's textures scaled 2x and drawn at 0.7 before
 */
export const EV_ITEM_ICONS: readonly string[] = Object.freeze([
  "power_weight",
  "power_bracer",
  "power_belt",
  "power_lens",
  "power_band",
  "power_anklet",
]);

/**
 * Local fork (2026-11-16): the frame names of the 18 type Z crystals and the 16 exclusive ones (`Z_TYPE_CRYSTAL_ICONS`
 * in zmax-items.ts and `EXCLUSIVE_Z[].icon` in zmax-data.ts; a test keeps them in step). `ultranecrozium_z`, Necrozma's
 * form change item, keeps PokeRogue's own icon; the reward crystal is `ultranecrozium_z_crystal`.
 * Local fork (2026-11-18): PokéSprite's items/z-crystals/<name>-z--bag.png; Mega Showdown's textures scaled 2x and drawn
 * at 0.8 before
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
 * Local fork (2026-11-18): the fork's icons that are PokéSprite's 32x32 originals (https://github.com/msikma/pokesprite,
 * the set PokeRogue's own item icons come from), installed by tools/port/install_pokesprite_icons.py. The user:
 * "아이콘은 전부 수정하고" / "아이콘 화풍은 포케스프라이트로 통일". They draw at 1 like PokeRogue's own icons, so none has an
 * entry in {@linkcode ITEM_ICON_SCALES} any more (before: IV candies 0.75, EV items 0.7, 목스프레이 0.6, Z링 0.7,
 * 다이사탕 0.65, Z crystals 0.8). 방탄조끼 is the new 돌격조끼 recoloured grey (not a main-series item). The four custom
 * Mega Stones are recolours of PokeRogue's own 14x14 stones and also draw at 1.
 */
/** Local fork (2026-11-18): the IV candies' scale (see {@linkcode ITEM_ICON_SCALES}) */
export const IV_CANDY_ICON_SCALE = 1.5;

export const POKESPRITE_ITEM_ICONS: ReadonlySet<string> = new Set([
  ...IV_CANDY_ICONS,
  ...EV_ITEM_ICONS,
  "throat_spray",
  "assault_vest",
  "bulletproof_vest",
  "life_orb",
  "choice_band",
  "z_ring",
  "dynamax_candy",
  ...Z_CRYSTAL_ICONS,
  "mark_charm",
]);

/**
 * Every icon drawn at another scale than 1, by frame name: 사탕더미 as above; the Cobblemon icons PokéSprite has no art for,
 * which fill the whole 32x32 frame (펀치글러브 and 마스터 펀치글러브 share one drawing; 클리어참 0.7 since 2026-11-13), and
 * 프리즘 as the user chose on 2026-11-11; the two HP belts (2026-11-12, {@linkcode HP_BELT_ICON_SCALE}).
 * Local fork (2026-11-18): the PokéSprite icons ({@linkcode POKESPRITE_ITEM_ICONS}) lost their entries.
 */
export const ITEM_ICON_SCALES: ReadonlyMap<string, number> = new Map([
  ["candy_pile", FORK_CANDY_ICON_SCALE],
  // Local fork (2026-11-18): PokéSprite's IV candies are an 11x11 drawing in the 32x32 frame (Let's Go's), half the
  // size of the other candies; drawn at 1.5 they keep the size the user chose for them on 11-11 (22x22 at 0.75), the
  // pixels themselves unchanged
  ...IV_CANDY_ICONS.map(icon => [icon, IV_CANDY_ICON_SCALE] as [string, number]),
  ["punching_glove", 0.7],
  ["master_punching_glove", 0.7],
  ["prism", 0.9],
  // Local fork (2026-11-13): the user: "저희 클리어참도 0.7배로 해둡시다 크기" (a Cobblemon icon that fills the frame)
  ["clear_amulet", 0.7],
  ["weight_band", HP_BELT_ICON_SCALE],
  ["champion_belt", HP_BELT_ICON_SCALE],
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
