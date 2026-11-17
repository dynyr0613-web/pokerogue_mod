# Local fork (2026-11-08): sprites for the "두드리짱의 대장간" (TINKATON_FORGE) mystery encounter.
"""Build the Tinkaton's Forge mystery encounter sprite and the "forged_steel" item icon for the PokeRogue fork (2026-11-08).

  D:/SpriteGen/comfyui/ComfyUI_windows_portable/python_embeded/python.exe -I make_tinkaton_forge_sprite.py [--preview-only OUT.png]

The user's request: "아이콘: 적당한 모루 + 두드리짱 도트 붙여넣기" (a plain anvil with Tinkaton's pixel sprite pasted on).

Anvil: no anvil exists in PokeRogue's images (battle-anims, arenas, items, mystery-encounters were looked through) nor in
the Essentials Graphics or D:/PartyPatch, so it is built here from simple shapes at 1x, one rectangle span per row
(see ANVIL_BIG / ANVIL_ICON): a pointed horn on the left whose underside curves up into the face, a one-row-lower step,
the flat face with a hardy hole near the heel, a narrow waist and a wide base with two feet and an arch. Colours are the
official GTS pedestal's greys (global_trade_system.png), so it sits well next to the GTS family; lit from the top-left:
  OUTLINE (27,29,33) 1px 4-connected outline, also the hardy hole
  HIGHLIGHT (204,210,216) the highlight line along every top edge (face, step, horn's upper slope)
  LIGHT (148,158,164) the second row of the top surfaces, the base's shoulders, the left edges
  MID (87,100,117) the fronts
  DARK (59,67,80) the face's lip and the horn's underside, the heel end, the waist's right side and the shadow under the
       face, the base's right end and bottom row

Tinkaton: the first frame of assets/images/pokemon/959.png through 959.json (Aseprite or TexturePacker atlas; trimmed
and rotated frames are put back into their sourceSize canvas), pasted pixel for pixel, no scaling. Tinkaton holds its
hammer upright on its right side (the viewer's left): the hammer head over its head, the handle down to the ground. The
anvil stands in front of it on that side, so the hammer is raised over the anvil and the handle's lower end and the hand
pass behind the anvil; Tinkaton's body stays fully visible. Both stand on one ground line (the anvil's bottom outline row
is Tinkaton's frame bottom row, which is also its lowest opaque row). The result is cropped to its opaque pixels.

Icon "forged_steel": the smaller anvil ANVIL_ICON (29x14 with its outline, same shapes and colours) centred in a 32x32
frame, appended to assets/images/items.{json,png} like install_vest_icons.update_atlas does it (untrimmed 32x32 frame,
items.json re-serialised only after checking that this reproduces the file byte for byte: tab indent, CRLF, the final
bare LF), except that it takes the first free 32x32 slot in the rows the fork already added (1px apart from every
frame, fully transparent in the sheet) and grows the sheet only when none is free. Re-runs redraw the frame in place.
The first run backs items.json/items.png up to tools/port/backup_items_forged_steel_20261108/ (never overwritten).

Output: assets/images/mystery-encounters/tinkaton_forge.png   palette PNG
        assets/images/mystery-encounters/tinkaton_forge.json  the single-frame format of global_trade_system.json
        assets/images/items/forged_steel.png                  32x32 palette PNG
        assets/images/items.json / items.png                  frame "forged_steel"
        D:/PokeRogueDev/docs/tinkaton_forge_preview.png        6x: the sprite and the icon (in its 32x32 frame), on mid
                                                               grey (top) and a dark background (bottom)
--preview-only OUT.png writes just the preview to OUT.png and installs nothing.
"""

import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I leaves the script folder off sys.path

from PIL import Image

import install_vest_icons as vest

ME = os.path.join(vest.IMG, "mystery-encounters")
NAME = "tinkaton_forge"
ICON = "forged_steel"
TINKATON = os.path.join(vest.IMG, "pokemon", "959")
JSON_TEMPLATE = os.path.join(ME, "global_trade_system.json")
PREVIEW = r"D:\PokeRogueDev\docs\tinkaton_forge_preview.png"
BACKUP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backup_items_forged_steel_20261108")

# the GTS pedestal greys
OUTLINE = (27, 29, 33)
DARK = (59, 67, 80)
MID = (87, 100, 117)
LIGHT = (148, 158, 164)
HIGHLIGHT = (204, 210, 216)

# Anvil shapes, x grows to the right, rows from the top, without the outline.
#   top:   (first x, last x) per row of the horn + step + face block; row 0 is the face's top only (the step and the
#          horn start one row lower), the horn's tip is the row with first x 0, the last row is the lip
#   waist: half widths around cx, one per row
#   base:  (half width, half width of the arch gap or 0) around cx, one per row
#   hole:  the hardy hole's pixels on the face
ANVIL_BIG = {
    "top": [(19, 43), (5, 43), (1, 43), (0, 43), (2, 43), (5, 43), (9, 43), (13, 43)],
    "waist": [10, 8, 7, 7, 7, 8, 10],
    "base": [(13, 0), (15, 0), (16, 0), (16, 0), (16, 6), (16, 8)],
    "cx": 29,
    "hole": [(38, 1), (39, 1)],
}
ANVIL_ICON = {
    "top": [(10, 25), (3, 25), (0, 25), (2, 25), (6, 25)],
    "waist": [6, 4, 4, 5],
    "base": [(8, 0), (10, 0), (10, 4)],
    "cx": 16,
    "hole": [(21, 1)],
}
ANVIL_BIG_SIZE = (48, 23)  # with the outline
ANVIL_ICON_SIZE = (29, 14)
ANVIL_RIGHT = 30  # the anvil's rightmost (outline) column, in Tinkaton's frame coordinates
N4 = ((1, 0), (-1, 0), (0, 1), (0, -1))


def anvil_pixels(spec: dict) -> dict:
    """{(x, y): part} for the anvil's body, part in top / waist / base"""
    px = {}
    for y, (x0, x1) in enumerate(spec["top"]):
        for x in range(x0, x1 + 1):
            px[(x, y)] = "top"
    y = len(spec["top"])
    cx = spec["cx"]
    for hw in spec["waist"]:
        for x in range(cx - hw, cx + hw + 1):
            px[(x, y)] = "waist"
        y += 1
    for hw, gap in spec["base"]:
        for x in range(cx - hw, cx + hw + 1):
            if not (gap and abs(x - cx) <= gap):
                px[(x, y)] = "base"
        y += 1
    return px


def anvil_colours(px: dict, hole: list) -> dict:
    lip = max(y for (_, y), part in px.items() if part == "top")
    col = {}
    for (x, y), part in px.items():
        up, down = (x, y - 1) in px, (x, y + 1) in px
        left, right = (x - 1, y) in px, (x + 1, y) in px
        if part == "top":
            c = HIGHLIGHT if not up else LIGHT if (x, y - 2) not in px else MID
            if y == lip or not down:
                c = DARK  # the face's lip, the horn's underside
            if not right and up:
                c = DARK  # the heel end
        elif part == "waist":
            c = LIGHT if not left else MID
            if (x + 1, y) not in px or (x + 2, y) not in px:
                c = DARK  # the shaded right side
            if px.get((x, y - 1)) == "top":
                c = DARK  # the shadow under the face
        else:
            under_waist_edge = px.get((x, y - 1)) == "waist" and not ((x - 1, y - 1) in px and (x + 1, y - 1) in px)
            c = LIGHT if not up or under_waist_edge or not left else MID  # shoulders and the left end
            if not right or not down:
                c = DARK  # the right end and the bottom row
        col[(x, y)] = c
    for p in hole:
        assert p in px, p
        col[p] = OUTLINE
    return col


def anvil(spec: dict) -> Image.Image:
    px = anvil_pixels(spec)
    col = anvil_colours(px, spec["hole"])
    xs, ys = [x for x, _ in px], [y for _, y in px]
    assert min(xs) == 0 and min(ys) == 0
    im = Image.new("RGBA", (max(xs) + 3, max(ys) + 3), (0, 0, 0, 0))
    p = im.load()
    for (x, y), c in col.items():
        p[x + 1, y + 1] = (*c, 255)
    for y in range(im.height):
        for x in range(im.width):
            if (x - 1, y - 1) not in px and any((x - 1 + dx, y - 1 + dy) in px for dx, dy in N4):
                p[x, y] = (*OUTLINE, 255)
    return im


def tinkaton_frame() -> Image.Image:
    """the first frame of 959.json, put back into its sourceSize canvas"""
    data = json.load(open(TINKATON + ".json", encoding="utf-8"))
    frames = data["frames"] if "frames" in data else data["textures"][0]["frames"]
    if isinstance(frames, dict):  # TexturePacker "JSON (Hash)"
        frames = [dict(v, filename=k) for k, v in frames.items()]
    f = sorted(frames, key=lambda fr: fr["filename"])[0]
    sheet = Image.open(TINKATON + ".png").convert("RGBA")
    r, s, size = f["frame"], f["spriteSourceSize"], f["sourceSize"]
    if f.get("rotated"):  # stored turned 90 degrees clockwise: w x h becomes h x w in the sheet
        part = sheet.crop((r["x"], r["y"], r["x"] + r["h"], r["y"] + r["w"])).rotate(90, expand=True)
    else:
        part = sheet.crop((r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"]))
    assert part.size == (s["w"], s["h"]), (part.size, s)
    out = Image.new("RGBA", (size["w"], size["h"]), (0, 0, 0, 0))
    out.paste(part, (s["x"], s["y"]))
    assert {p[3] for p in out.get_flattened_data()} <= {0, 255}, "Tinkaton has soft alpha"
    return out


def composite(tink: Image.Image, anv: Image.Image) -> tuple:
    """(sprite, (Tinkaton's x, y in it), (the anvil's x, y in it))"""
    bottom = tink.getbbox()[3]
    assert bottom == tink.height, "Tinkaton's feet do not reach its frame bottom"
    ax = ANVIL_RIGHT - anv.width + 1
    off = max(0, -ax)
    canvas = Image.new("RGBA", (max(tink.width + off, ax + off + anv.width), tink.height), (0, 0, 0, 0))
    canvas.alpha_composite(tink, (off, 0))
    canvas.alpha_composite(anv, (ax + off, bottom - anv.height))  # in front, on Tinkaton's ground line
    box = canvas.getbbox()
    out = canvas.crop(box)
    return out, (off - box[0], -box[1]), (ax + off - box[0], bottom - anv.height - box[1])


def check_sprite(sprite: Image.Image, tink: Image.Image, anv: Image.Image, tpos: tuple, apos: tuple) -> None:
    assert sprite.getbbox() == (0, 0, sprite.width, sprite.height), "bounds are not tight"
    sp, tp, ap = sprite.load(), tink.load(), anv.load()
    for y in range(sprite.height):
        for x in range(sprite.width):
            assert sp[x, y][3] in (0, 255), (x, y)
            ax, ay = x - apos[0], y - apos[1]
            if 0 <= ax < anv.width and 0 <= ay < anv.height and ap[ax, ay][3]:
                assert sp[x, y] == ap[ax, ay], (x, y)
                continue
            tx, ty = x - tpos[0], y - tpos[1]
            want = tp[tx, ty] if 0 <= tx < tink.width and 0 <= ty < tink.height else (0, 0, 0, 0)
            assert sp[x, y] == want or (sp[x, y][3] == 0 and want[3] == 0), ("Tinkaton pixel changed", x, y)
    assert apos[1] + anv.height == tpos[1] + tink.height == sprite.height, "not on one ground line"


def install_json(w: int, h: int) -> None:
    raw = open(JSON_TEMPLATE, "rb").read().decode("utf-8")
    assert raw.count('"w": 77') == 4 and raw.count('"h": 78') == 4 and raw.count('"image": "global_trade_system.png"') == 1
    text = raw.replace('"w": 77', f'"w": {w}').replace('"h": 78', f'"h": {h}')
    text = text.replace('"image": "global_trade_system.png"', f'"image": "{NAME}.png"')
    data = json.loads(text)
    tex = data["textures"][0]
    f = tex["frames"][0]
    assert len(tex["frames"]) == 1 and tex["size"] == f["sourceSize"] == {"w": w, "h": h}
    assert f["frame"] == f["spriteSourceSize"] == {"x": 0, "y": 0, "w": w, "h": h}
    open(os.path.join(ME, NAME + ".json"), "wb").write(text.encode("utf-8"))


def icon_image() -> Image.Image:
    anv = anvil(ANVIL_ICON)
    assert anv.size == ANVIL_ICON_SIZE, anv.size
    out = vest.centre(anv)
    assert out.size == (vest.CANVAS, vest.CANVAS)
    return out


def free_slot(frames: list, sheet: Image.Image) -> tuple | None:
    """the first 32x32 cell, in the rows of untrimmed 32x32 frames the fork scripts added, that is 1px clear of every
    frame and fully transparent in the sheet"""
    rects = [(f["frame"]["x"], f["frame"]["y"], f["frame"]["w"], f["frame"]["h"]) for f in frames]
    rows = sorted({f["frame"]["y"] for f in frames if not f["trimmed"] and f["frame"]["w"] == f["frame"]["h"] == vest.CANVAS})
    for y in rows:
        for x in range(0, sheet.width - vest.CANVAS + 1, vest.CANVAS + 1):
            if any(x - 1 < rx + rw and rx < x + vest.CANVAS + 1 and y - 1 < ry + rh and ry < y + vest.CANVAS + 1 for rx, ry, rw, rh in rects):
                continue
            if y + vest.CANVAS > sheet.height:
                continue
            if sheet.crop((x, y, x + vest.CANVAS, y + vest.CANVAS)).getbbox() is None:
                return x, y
    return None


def install_icon(icon: Image.Image) -> None:
    js, png = os.path.join(vest.IMG, "items.json"), os.path.join(vest.IMG, "items.png")
    if not os.path.isdir(BACKUP):
        os.makedirs(BACKUP)
        shutil.copy2(js, os.path.join(BACKUP, "items.json"))
        shutil.copy2(png, os.path.join(BACKUP, "items.png"))
    vest.to_palette_png(icon, os.path.join(vest.ITEMS, ICON + ".png"))
    raw = open(js, "rb").read()
    data = json.loads(raw)
    body = json.dumps(data, indent="\t", ensure_ascii=False).replace("\n", "\r\n").encode("utf-8")
    if not raw.startswith(body) or raw[len(body):].strip(b"\r\n"):
        raise SystemExit("items.json is not in the expected TexturePacker style; refusing to rewrite it")
    tail = raw[len(body):]
    tex = data["textures"][0]
    sheet = Image.open(png).convert("RGBA")
    old_size = sheet.size
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
    sheet.save(png)
    text = json.dumps(data, indent="\t", ensure_ascii=False).replace("\n", "\r\n").encode("utf-8") + tail
    json.loads(text)
    open(js, "wb").write(text)
    back = Image.open(png).convert("RGBA").crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"]))
    assert list(back.get_flattened_data()) == list(icon.get_flattened_data()), "icon did not land in the atlas"
    print("atlas: forged_steel at", (f["x"], f["y"]), "sheet", old_size, "->", sheet.size)


def preview(sprite: Image.Image, icon: Image.Image, path: str, scale: int = 6) -> None:
    gap = 8
    w, h = sprite.width * scale, sprite.height * scale
    iw = icon.width * scale
    sheet = Image.new("RGBA", (w + iw + 3 * gap, 2 * h + 3 * gap), (255, 255, 255, 255))
    for row, bg in enumerate([(128, 128, 128, 255), (34, 30, 44, 255)]):
        for col, (im, x) in enumerate([(sprite, gap), (icon, 2 * gap + w)]):
            tile = Image.new("RGBA", im.size, bg)
            tile.alpha_composite(im)
            sheet.paste(tile.resize((im.width * scale, im.height * scale), Image.NEAREST), (x, gap + row * (h + gap)))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sheet.convert("RGB").save(path)


if __name__ == "__main__":
    big = anvil(ANVIL_BIG)
    assert big.size == ANVIL_BIG_SIZE and 40 <= big.width <= 48, big.size
    tink = tinkaton_frame()
    sprite, tpos, apos = composite(tink, big)
    check_sprite(sprite, tink, big, tpos, apos)
    icon = icon_image()
    print("sprite", sprite.size, "Tinkaton at", tpos, "anvil at", apos, "icon bbox", icon.getbbox())
    if "--preview-only" in sys.argv:
        preview(sprite, icon, sys.argv[sys.argv.index("--preview-only") + 1])
        raise SystemExit(0)
    out = os.path.join(ME, NAME + ".png")
    vest.to_palette_png(sprite, out)
    assert list(Image.open(out).convert("RGBA").get_flattened_data()) == list(sprite.get_flattened_data())
    install_json(*sprite.size)
    install_icon(icon)
    preview(sprite, icon, PREVIEW)
    print("installed", NAME, ICON, "and", PREVIEW)
