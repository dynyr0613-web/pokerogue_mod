"""Preview of the item icon draw scales of 2026-11-08 (docs/다음_패치_메모.md §4).

  D:/SpriteGen/comfyui/ComfyUI_windows_portable/python_embeded/python.exe -I make_item_icon_scale_preview.py

Reads assets/images/items.{json,png} (read-only) and writes D:/PokeRogueDev/docs/item_icon_scale_preview.png:
for a few official icons and the fork's candies, the size an icon is drawn at on the one-row reward screen now
(x1.0 = 32 game px) next to the new size (x0.9, the fork's candies x0.81), both magnified 4x with nearest neighbour.
The numbers match src/ui/utils/item-icon-scale.ts; the game itself only changes draw scales, never the atlas.
"""

import json
import os

from PIL import Image, ImageDraw, ImageFont

GAME = r"D:\PokeRogueDev\pokerogue"
OUT = r"D:\PokeRogueDev\docs\item_icon_scale_preview.png"
FONT = r"C:\Windows\Fonts\malgun.ttf"
FONT_BOLD = r"C:\Windows\Fonts\malgunbd.ttf"

SOURCE = 32  # every items-atlas frame has a 32x32 source size
MAG = 4  # game pixels -> preview pixels
REWARD_SCALE = 0.9
CANDY_SCALE = 0.9
CANDIES = ["candy_pile", "health_candy", "mighty_candy", "tough_candy", "smart_candy", "courage_candy", "quick_candy"]
OFFICIAL = ["leftovers", "sitrus_berry", "rare_candy", "candy_jar"]

BG = (27, 29, 38)
CARD = (38, 42, 54)
CARD_EDGE = (58, 63, 80)
OLD_BOX = (92, 98, 120)
TEXT = (232, 232, 240)
SUB = (160, 164, 184)
ACCENT = (240, 192, 96)
NEW = (120, 210, 150)


def load_atlas() -> tuple[Image.Image, dict]:
    with open(os.path.join(GAME, "assets", "images", "items.json"), encoding="utf-8") as f:
        atlas = json.load(f)
    sheet = Image.open(os.path.join(GAME, "assets", "images", "items.png")).convert("RGBA")
    frames = {fr["filename"]: fr for fr in atlas["textures"][0]["frames"]}
    return sheet, frames


def icon(sheet: Image.Image, frames: dict, name: str) -> Image.Image:
    """The frame rebuilt on its untrimmed 32x32 source box, as Phaser places it."""
    fr = frames[name]
    f, sss = fr["frame"], fr["spriteSourceSize"]
    out = Image.new("RGBA", (fr["sourceSize"]["w"], fr["sourceSize"]["h"]), (0, 0, 0, 0))
    out.paste(sheet.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"])), (sss["x"], sss["y"]))
    assert out.size == (SOURCE, SOURCE), (name, out.size)
    return out


def ko_names() -> dict:
    def read(name: str) -> dict:
        with open(os.path.join(GAME, "locales", "ko", name), encoding="utf-8") as f:
            return json.load(f)

    mt, berry = read("modifier-type.json"), read("berry.json")
    names = {
        "leftovers": mt["ModifierType"]["LEFTOVERS"]["name"],
        "rare_candy": mt["ModifierType"]["RARE_CANDY"]["name"],
        "candy_jar": mt["ModifierType"]["CANDY_JAR"]["name"],
        "candy_pile": mt["ModifierType"]["CANDY_PILE"]["name"],
        "sitrus_berry": berry["sitrus"]["name"],
    }
    names.update(mt["IvCandyItem"])
    return names


def main() -> None:
    sheet, frames = load_atlas()
    names = ko_names()
    title_font = ImageFont.truetype(FONT_BOLD, 30)
    head_font = ImageFont.truetype(FONT, 18)
    name_font = ImageFont.truetype(FONT_BOLD, 19)
    small_font = ImageFont.truetype(FONT, 15)

    cell = SOURCE * MAG  # 128: the current drawn box
    pad = 14
    card_w = pad * 3 + cell * 2
    card_h = 40 + cell + 46
    cols = len(CANDIES)
    top = 150
    group_gap = 44
    width = pad * 2 + cols * card_w + (cols - 1) * pad
    height = top + 2 * (card_h + group_gap) + pad
    img = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(img)

    d.text((pad + 4, 14), "아이템 아이콘 크기 미리보기 (라운드 클리어 보상 화면, 1줄 배율)", font=title_font, fill=TEXT)
    d.text(
        (pad + 4, 58),
        "왼쪽: 지금 (x1.0 = 32px)   오른쪽: 변경 (x0.9 = 28.8px, 포크 사탕류는 x0.81 = 25.9px)   "
        "게임 픽셀을 4배로, 최근접 이웃 확대",
        font=head_font,
        fill=SUB,
    )
    d.text(
        (pad + 4, 86),
        "같은 배율이 2줄 보상(0.8 → 0.72 / 사탕 0.648)과 상점(0.75 → 0.675 / 0.6075)에도 적용. "
        "능력치 창: 16px → 14.4px (사탕 13.0px). 아이템 바: 사탕만 16px → 14.4px.",
        font=head_font,
        fill=SUB,
    )
    d.text((pad + 4, 112), "회색 테두리 = 지금 그려지는 32x32 칸 (위치는 가운데 그대로)", font=head_font, fill=SUB)

    groups = [("공식 아이콘 (x0.9)", OFFICIAL), ("포크에서 추가한 사탕류 (x0.9 x0.9 = x0.81)", CANDIES)]
    y = top
    for label, items in groups:
        d.text((pad + 4, y), label, font=name_font, fill=ACCENT)
        y += 30
        for i, name in enumerate(items):
            x = pad + i * (card_w + pad)
            d.rectangle((x, y, x + card_w - 1, y + card_h - 1), fill=CARD, outline=CARD_EDGE)
            d.text((x + pad, y + 8), f"{names[name]}  ({name})", font=small_font, fill=TEXT)

            src = icon(sheet, frames, name)
            scale_new = REWARD_SCALE * (CANDY_SCALE if name in CANDIES else 1)
            for j, scale in enumerate((1.0, scale_new)):
                bx = x + pad + j * (cell + pad)
                by = y + 36
                d.rectangle((bx, by, bx + cell - 1, by + cell - 1), outline=OLD_BOX)
                size = round(SOURCE * scale * MAG)
                drawn = src.resize((size, size), Image.NEAREST)
                off = (cell - size) // 2
                img.paste(drawn, (bx + off, by + off), drawn)
                caption = "지금 x1.0 (32px)" if j == 0 else f"변경 x{scale:g} ({SOURCE * scale:.1f}px)"
                d.text((bx + 2, by + cell + 6), caption, font=small_font, fill=SUB if j == 0 else NEW)
        y += card_h + group_gap - 30

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img.save(OUT, optimize=True)
    print("wrote", OUT, img.size)


if __name__ == "__main__":
    main()
