# Local fork (2026-11-08): item icon "berry_juice_dark" for the "강력한 물질?" (DARK_STRONG_STUFF) mystery encounter.
"""Build the "berry_juice_dark" item icon for the PokeRogue fork (2026-11-08) and append it to the items atlas.

  D:/SpriteGen/comfyui/ComfyUI_windows_portable/python_embeded/python.exe -I make_dark_juice_icon.py [--preview-only OUT.png]

A recolour of the official "berry_juice_good" frame of assets/images/items.{json,png} (a halved shell cup with a
striped straw, filled with orange/yellow juice): only the juice changes, to a near-black liquid with a faint wine/plum
sheen and a small glint, so it reads as the same cup filled with something ominous. The shell, its pale rim, the straw
and the outline keep their exact pixels, and the alpha mask is identical to the source frame (asserted).

The source frame is trimmed (22x21 at 5,5 of a 32x32 sourceSize); it is put back into its 32x32 canvas first, so the
icon sits exactly where berry_juice_good sits. The juice is the 4-connected region of the juice colours seeded from the
orange and yellow pixels: ORANGE (the darker back of the surface), YELLOW (the lit front of the surface) and the PALE
pixels that touch them (the far edge just under the back rim). PALE also speckles the shell's lower body; those pixels
are not connected to the juice and stay. berry_juice_bad repaints every pixel of that region (besides its drip over the
rim and down the shell), so it is the juice as the original artists drew it (44 pixels: 16 orange, 19 yellow, 9 pale;
asserted).

Recolour, lit from the top-left like the source:
  ORANGE (203,125,74) -> DEEP  (22,12,22)    near-black with a violet cast: the back of the surface, the edges
  YELLOW (228,195,102) -> BODY (52,24,46)    dark plum: the lit front of the surface (keeps the source's two lit lobes)
  PALE (217,207,128)   -> SHEEN (106,38,74)  dark wine red: the thin far edge under the back rim, where light catches
  GLINT (150,78,128) on GLINT_PIXELS: a 2-pixel highlight on the top of the left lit lobe, left of the straw
None of these colours occurs in the source frame, and all differ from the outline (32,32,32).

Atlas: appended like make_tinkaton_forge_sprite.install_icon added "forged_steel": an untrimmed 32x32 frame in the first
free 32x32 slot of the rows the fork already added (free_slot from that script: 1px clear of every frame, fully
transparent in the sheet), a new row under everything only when none is free; items.json is re-serialised only after
checking that this reproduces the file byte for byte (tab indent, CRLF, the final bare LF). Re-runs redraw the frame in
place, so the script is deterministic and re-runnable. The first run backs items.json/items.png up to
tools/port/backup_items_berry_juice_dark_20261108/ (never overwritten).

Output: assets/images/items/berry_juice_dark.png   32x32 palette PNG (like items/forged_steel.png)
        assets/images/items.json / items.png        frame "berry_juice_dark"
        D:/PokeRogueDev/docs/dark_juice_preview.png  8x: berry_juice_good | berry_juice_bad | berry_juice_dark, each in
                                                     its 32x32 frame, on mid grey (top) and a dark background (bottom)
--preview-only OUT.png writes just the preview to OUT.png and installs nothing.
"""

import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I leaves the script folder off sys.path

from PIL import Image

import install_vest_icons as vest
from make_tinkaton_forge_sprite import free_slot

SOURCE = "berry_juice_good"
BAD = "berry_juice_bad"
ICON = "berry_juice_dark"
PREVIEW = r"D:\PokeRogueDev\docs\dark_juice_preview.png"
BACKUP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backup_items_berry_juice_dark_20261108")
ATLAS_JSON = os.path.join(vest.IMG, "items.json")
ATLAS_PNG = os.path.join(vest.IMG, "items.png")

OUTLINE = (32, 32, 32, 255)
# the juice colours of berry_juice_good
ORANGE = (203, 125, 74, 255)
YELLOW = (228, 195, 102, 255)
PALE = (217, 207, 128, 255)
# every colour of the berry_juice_good frame, so a changed source stops the script instead of half-recolouring it
SOURCE_COLOURS = {
    OUTLINE,
    (87, 110, 44, 255),
    (133, 129, 73, 255),
    (162, 148, 84, 255),
    ORANGE,
    (177, 199, 98, 255),
    (204, 176, 121, 255),
    YELLOW,
    PALE,
    (206, 217, 167, 255),
    (238, 207, 159, 255),
    (226, 250, 219, 255),
    (244, 252, 255, 255),
}
JUICE_COUNTS = {ORANGE: 16, YELLOW: 19, PALE: 9}

DEEP = (22, 12, 22, 255)
BODY = (52, 24, 46, 255)
SHEEN = (106, 38, 74, 255)
GLINT = (150, 78, 128, 255)
RECOLOUR = {ORANGE: DEEP, YELLOW: BODY, PALE: SHEEN}
GLINT_PIXELS = [(12, 14), (13, 14)]  # 32x32 canvas coordinates; the top of the left lit (yellow) lobe


def load_atlas() -> tuple:
    data = json.loads(open(ATLAS_JSON, "rb").read())
    return data, Image.open(ATLAS_PNG).convert("RGBA")


def frame_canvas(data: dict, sheet: Image.Image, name: str) -> Image.Image:
    """an atlas frame put back into its sourceSize canvas"""
    f = next(f for f in data["textures"][0]["frames"] if f["filename"] == name)
    assert not f["rotated"] and f["sourceSize"] == {"w": vest.CANVAS, "h": vest.CANVAS}, (name, f)
    g, s = f["frame"], f["spriteSourceSize"]
    assert (g["w"], g["h"]) == (s["w"], s["h"]), (name, f)
    out = Image.new("RGBA", (vest.CANVAS, vest.CANVAS), (0, 0, 0, 0))
    out.paste(sheet.crop((g["x"], g["y"], g["x"] + g["w"], g["y"] + g["h"])), (s["x"], s["y"]))
    px = out.load()
    for y in range(out.height):  # the sheet's transparent pixels carry RGB (76,105,113); make them plain (0,0,0,0)
        for x in range(out.width):
            if px[x, y][3] == 0:
                px[x, y] = (0, 0, 0, 0)
    return out


def juice_mask(src: Image.Image) -> set:
    px = src.load()
    seeds = [(x, y) for y in range(src.height) for x in range(src.width) if px[x, y] in (ORANGE, YELLOW)]
    mask, todo = set(seeds), list(seeds)
    while todo:
        x, y = todo.pop()
        for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if n not in mask and 0 <= n[0] < src.width and 0 <= n[1] < src.height and px[n] in RECOLOUR:
                mask.add(n)
                todo.append(n)
    return mask


def dark_icon(src: Image.Image) -> Image.Image:
    colours = {p for p in src.get_flattened_data() if p[3] > 0}
    assert colours == SOURCE_COLOURS, sorted(colours ^ SOURCE_COLOURS)
    assert {p[3] for p in src.get_flattened_data()} <= {0, 255}
    new = {DEEP, BODY, SHEEN, GLINT}
    assert not new & colours and OUTLINE not in new and len(new) == 4
    mask = juice_mask(src)
    sp = src.load()
    counts = {c: sum(1 for p in mask if sp[p] == c) for c in RECOLOUR}
    assert counts == JUICE_COUNTS and len(mask) == sum(JUICE_COUNTS.values()), counts
    out = src.copy()
    op = out.load()
    for p in mask:
        op[p] = RECOLOUR[sp[p]]
    for p in GLINT_PIXELS:
        assert p in mask and sp[p] == YELLOW, p
        op[p] = GLINT
    # only the juice changed; the alpha mask is the source's
    for y in range(src.height):
        for x in range(src.width):
            assert op[x, y][3] == sp[x, y][3], ("alpha changed", x, y)
            assert (x, y) in mask or op[x, y] == sp[x, y], ("shell/straw/outline pixel changed", x, y)
    assert out.getchannel("A").tobytes() == src.getchannel("A").tobytes()
    return out


def install_icon(icon: Image.Image, src: Image.Image) -> None:
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
    # read both back: the new frame is the icon, and berry_juice_good is untouched
    data2, sheet2 = load_atlas()
    back = frame_canvas(data2, sheet2, ICON)
    assert list(back.get_flattened_data()) == list(icon.get_flattened_data()), "icon did not land in the atlas"
    assert back.getchannel("A").tobytes() == src.getchannel("A").tobytes()
    assert list(frame_canvas(data2, sheet2, SOURCE).get_flattened_data()) == list(src.get_flattened_data())
    print("atlas:", ICON, "at", (f["x"], f["y"]), "sheet", old_size, "->", sheet.size)


def preview(images: list, path: str, scale: int = 8) -> None:
    gap = 8
    size = vest.CANVAS * scale
    out = Image.new("RGB", (len(images) * (size + gap) + gap, 2 * (size + gap) + gap), (255, 255, 255))
    for row, bg in enumerate([(128, 128, 128, 255), (34, 30, 44, 255)]):
        for col, im in enumerate(images):
            tile = Image.new("RGBA", im.size, bg)
            tile.alpha_composite(im)
            out.paste(tile.resize((size, size), Image.NEAREST).convert("RGB"), (gap + col * (size + gap), gap + row * (size + gap)))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out.save(path)


if __name__ == "__main__":
    data, sheet = load_atlas()
    good = frame_canvas(data, sheet, SOURCE)
    bad = frame_canvas(data, sheet, BAD)
    icon = dark_icon(good)
    print("icon bbox", icon.getbbox(), "juice pixels", len(juice_mask(good)))
    if "--preview-only" in sys.argv:
        preview([good, bad, icon], sys.argv[sys.argv.index("--preview-only") + 1])
        raise SystemExit(0)
    install_icon(icon, good)
    preview([good, bad, icon], PREVIEW)
    print("installed", ICON, "and", PREVIEW)
