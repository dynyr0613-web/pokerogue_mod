# Local fork (2026-11-09): item icon "choice_band" for the MASTER-tier Choice Band (구애머리띠) + a preview of the three
# Choice item icons next to the vests.
"""Build the "choice_band" item icon for the PokeRogue fork (2026-11-09), add it to the items atlas, write a preview.

  D:/SpriteGen/comfyui/ComfyUI_windows_portable/python_embeded/python.exe -I install_choice_band_icon.py [--preview-only]

Choice Scarf and Choice Specs already have upstream frames in assets/images/items.{json,png} ("choice_scarf",
"choice_specs", trimmed 24x24 / 24x18 in a 32x32 source box); only Choice Band has none.

Source: the Essentials project's Graphics/Items/CHOICEBAND.png (48x48, drawn at 1x, read-only), made the way
D:/PokeRogueDev/tools/port/install_vest_icons.py made the vest icons: cropped to its 44x44 bounding box, halved by a
2x2 majority vote (ties go to the darker colour so the outline survives), centred on a transparent 32x32 canvas and
saved as a palette PNG. The helpers are imported from that script.

Atlas: an untrimmed 32x32 frame "choice_band" in the first free 32x32 slot of the rows the fork scripts already added
(free_slot from make_tinkaton_forge_sprite.py: 1px clear of every frame, fully transparent in the sheet), a new row
under everything only when none is free. items.json is re-serialised only after checking that this reproduces the file
byte for byte (tab indent, CRLF, the final bare LF). Re-runs redraw the frame in place, so the script is idempotent.
The first run backs items.json/items.png up to D:/PokeRogueDev/tools/port/backup_items_choice_band_20261109/ (never
overwritten).

Output: assets/images/items/choice_band.png        32x32 palette PNG (like items/assault_vest.png)
        assets/images/items.json / items.png        frame "choice_band"
        D:/PokeRogueDev/docs/choice_items_preview.png  the three Choice item icons and the two vests, each in its 32x32
                                                     frame at x4 on a dark background, with the Korean names
--preview-only writes just the preview from the current atlas and installs nothing.
"""

import json
import os
import shutil
import sys

PORT = r"D:\PokeRogueDev\tools\port"
sys.path.insert(0, PORT)  # -I leaves script folders off sys.path; the helpers live with the older port scripts

from PIL import Image, ImageDraw, ImageFont

import install_vest_icons as vest
from make_tinkaton_forge_sprite import free_slot

SRC = r"C:\Users\jaehe\OneDrive\바탕 화면\Pokemon Essentials v21.1 2023-07-30\Graphics\Items\CHOICEBAND.png"
ICON = "choice_band"
BACKUP = os.path.join(PORT, "backup_items_choice_band_20261109")
ATLAS_JSON = os.path.join(vest.IMG, "items.json")
ATLAS_PNG = os.path.join(vest.IMG, "items.png")
PREVIEW = r"D:\PokeRogueDev\docs\choice_items_preview.png"
FONT = r"C:\Windows\Fonts\malgun.ttf"
FONT_BOLD = r"C:\Windows\Fonts\malgunbd.ttf"

# (atlas frame, locale key) in preview order
PREVIEW_ITEMS = [
    ("choice_band", "CHOICE_BAND"),
    ("choice_scarf", "CHOICE_SCARF"),
    ("choice_specs", "CHOICE_SPECS"),
    ("assault_vest", "ASSAULT_VEST"),
    ("bulletproof_vest", "BULLETPROOF_VEST"),
]
MAG = 4
BG = (27, 29, 38)
CARD = (38, 42, 54)
CARD_EDGE = (58, 63, 80)
FRAME_EDGE = (70, 76, 96)
TEXT = (232, 232, 240)
SUB = (160, 164, 184)
ACCENT = (240, 192, 96)


def load_atlas() -> tuple[dict, Image.Image]:
    with open(ATLAS_JSON, encoding="utf-8") as f:
        data = json.load(f)
    return data, Image.open(ATLAS_PNG).convert("RGBA")


def frame_canvas(data: dict, sheet: Image.Image, name: str) -> Image.Image:
    """A frame rebuilt on its untrimmed 32x32 source box, as Phaser places it."""
    fr = next(f for f in data["textures"][0]["frames"] if f["filename"] == name)
    g, s = fr["frame"], fr["spriteSourceSize"]
    out = Image.new("RGBA", (fr["sourceSize"]["w"], fr["sourceSize"]["h"]), (0, 0, 0, 0))
    out.paste(sheet.crop((g["x"], g["y"], g["x"] + g["w"], g["y"] + g["h"])), (s["x"], s["y"]))
    px = out.load()
    for y in range(out.height):  # the sheet's transparent pixels can carry RGB; make them plain (0,0,0,0)
        for x in range(out.width):
            if px[x, y][3] == 0:
                px[x, y] = (0, 0, 0, 0)
    return out


def band_icon() -> Image.Image:
    src = Image.open(SRC).convert("RGBA")
    icon = vest.centre(vest.shrink_majority(src.crop(src.getbbox())))
    assert icon.size == (vest.CANVAS, vest.CANVAS)
    assert {p[3] for p in icon.get_flattened_data()} <= {0, 255}
    return icon


def install_icon(icon: Image.Image) -> None:
    if not os.path.isdir(BACKUP):
        os.makedirs(BACKUP)
        shutil.copy2(ATLAS_JSON, os.path.join(BACKUP, "items.json"))
        shutil.copy2(ATLAS_PNG, os.path.join(BACKUP, "items.png"))
    loose = os.path.join(vest.ITEMS, ICON + ".png")
    vest.to_palette_png(icon, loose)
    assert list(Image.open(loose).convert("RGBA").get_flattened_data()) == list(icon.get_flattened_data())
    raw = open(ATLAS_JSON, "rb").read()
    data = json.loads(raw)
    body = json.dumps(data, indent="\t", ensure_ascii=False).replace("\n", "\r\n").encode("utf-8")
    if not raw.startswith(body) or raw[len(body):].strip(b"\r\n"):
        raise SystemExit("items.json is not in the expected TexturePacker style; refusing to rewrite it")
    tail = raw[len(body):]
    tex = data["textures"][0]
    sheet = Image.open(ATLAS_PNG).convert("RGBA")
    old_size = sheet.size
    before = {f["filename"]: frame_canvas(data, sheet, f["filename"]) for f in tex["frames"] if f["filename"] != ICON}
    frame = next((f for f in tex["frames"] if f["filename"] == ICON), None)
    if frame is None:
        slot = free_slot(tex["frames"], sheet)
        if slot is None:  # a new row under everything, like install_vest_icons.update_atlas
            slot = (0, sheet.height + 1)
            grown = Image.new("RGBA", (sheet.width, slot[1] + vest.CANVAS), (0, 0, 0, 0))
            grown.paste(sheet, (0, 0))
            sheet = grown
        frame = {
            "filename": ICON,
            "rotated": False,
            "trimmed": False,
            "sourceSize": {"w": vest.CANVAS, "h": vest.CANVAS},
            "spriteSourceSize": {"x": 0, "y": 0, "w": vest.CANVAS, "h": vest.CANVAS},
            "frame": {"x": slot[0], "y": slot[1], "w": vest.CANVAS, "h": vest.CANVAS},
        }
        tex["frames"].append(frame)
    f = frame["frame"]
    assert (f["w"], f["h"]) == icon.size and not frame["trimmed"] and not frame["rotated"]
    sheet.paste(Image.new("RGBA", icon.size, (0, 0, 0, 0)), (f["x"], f["y"]))  # clear, then draw
    sheet.paste(icon, (f["x"], f["y"]), icon)
    tex["size"] = {"w": sheet.width, "h": sheet.height}
    sheet.save(ATLAS_PNG)
    text = json.dumps(data, indent="\t", ensure_ascii=False).replace("\n", "\r\n").encode("utf-8") + tail
    json.loads(text)
    open(ATLAS_JSON, "wb").write(text)
    # read back: the new frame is the icon and every other frame is untouched
    data2, sheet2 = load_atlas()
    assert list(frame_canvas(data2, sheet2, ICON).get_flattened_data()) == list(icon.get_flattened_data())
    for name, img in before.items():
        assert list(frame_canvas(data2, sheet2, name).get_flattened_data()) == list(img.get_flattened_data()), name
    print("atlas:", ICON, "at", (f["x"], f["y"]), "sheet", old_size, "->", sheet.size)


def ko_names() -> dict:
    with open(os.path.join(vest.GAME, "locales", "ko", "modifier-type.json"), encoding="utf-8") as fh:
        return json.load(fh)["ModifierType"]


def preview() -> None:
    data, sheet = load_atlas()
    names = ko_names()
    font = ImageFont.truetype(FONT, 18)
    small = ImageFont.truetype(FONT, 13)
    title_font = ImageFont.truetype(FONT_BOLD, 20)
    box = vest.CANVAS * MAG  # 128
    card_w, card_h, gap, pad = box + 40, box + 84, 14, 20
    w = pad * 2 + len(PREVIEW_ITEMS) * card_w + (len(PREVIEW_ITEMS) - 1) * gap
    h = pad + 34 + card_h + pad
    img = Image.new("RGBA", (w, h), BG + (255,))
    d = ImageDraw.Draw(img)
    d.text((pad, pad - 4), "마스터 등급 · 구애 아이템 3종 (왼쪽) / 기존 조끼 (오른쪽) · 32x32 프레임 x4", font=title_font, fill=TEXT)
    y0 = pad + 34
    for i, (frame, key) in enumerate(PREVIEW_ITEMS):
        x0 = pad + i * (card_w + gap)
        d.rounded_rectangle((x0, y0, x0 + card_w - 1, y0 + card_h - 1), 10, fill=CARD, outline=CARD_EDGE)
        icon = frame_canvas(data, sheet, frame).resize((box, box), Image.NEAREST)
        ix, iy = x0 + 20, y0 + 16
        d.rectangle((ix - 1, iy - 1, ix + box, iy + box), outline=FRAME_EDGE)
        img.alpha_composite(icon, (ix, iy))
        name = names[key]["name"]
        tw = d.textlength(name, font=font)
        d.text((x0 + (card_w - tw) / 2, iy + box + 10), name, font=font, fill=ACCENT if key.startswith("CHOICE") else TEXT)
        sw = d.textlength(frame, font=small)
        d.text((x0 + (card_w - sw) / 2, iy + box + 36), frame, font=small, fill=SUB)
    img.convert("RGB").save(PREVIEW)
    print("preview:", PREVIEW, img.size)


if __name__ == "__main__":
    if "--preview-only" not in sys.argv:
        install_icon(band_icon())
    preview()
    print("done")
