"""Install the Assault Vest / Bulletproof Vest item icons into the PokeRogue fork.

  D:/SpriteGen/comfyui/ComfyUI_windows_portable/python_embeded/python.exe -I install_vest_icons.py

Source: the Essentials project's Graphics/Items/ASSAULTVEST.png (48x48, 6 colours, drawn at 1x, read-only).
Output: assets/images/items/assault_vest.png     32x32 palette PNG, the vest shrunk to 21x18 and centred
        assets/images/items/bulletproof_vest.png the same vest with its reds turned grey
        assets/images/items.json / items.png      two untrimmed 32x32 frames, "assault_vest" and "bulletproof_vest"

Re-running is safe: existing frames are redrawn in place (so the image session can drop better PNGs into
assets/images/items/ and re-run with --keep-pngs to only refresh the atlas), new ones are appended below
the sheet. items.json keeps its TexturePacker style (tab indent, CRLF, the original final newline).

Local fork (2026-11-18): superseded as an installer. Both vests are PokéSprite's Assault Vest (items/hold-item/
assault-vest.png) since install_pokesprite_icons.py, the Bulletproof Vest with this script's red -> grey mapping keyed to
PokéSprite's colours; a plain run stops unless --essentials is given. The helpers (update_atlas, to_palette_png, centre,
shrink_majority) stay for the scripts that import them.
"""

import json
import os
import sys
from collections import Counter

from PIL import Image

SRC = r"C:\Users\jaehe\OneDrive\바탕 화면\Pokemon Essentials v21.1 2023-07-30\Graphics\Items\ASSAULTVEST.png"
GAME = r"D:\PokeRogueDev\pokerogue"
IMG = os.path.join(GAME, "assets", "images")
ITEMS = os.path.join(IMG, "items")
CANVAS = 32

# red -> grey for the Bulletproof Vest; the outline (48,48,48) and the dark (64,64,64) pixels stay as they are
GREY = {
    (200, 80, 80, 255): (150, 152, 158, 255),  # lit body
    (176, 56, 64, 255): (118, 120, 126, 255),  # body
    (144, 48, 56, 255): (88, 90, 96, 255),  # shade
    (96, 72, 80, 255): (84, 84, 90, 255),  # collar shadow
}


def shrink_majority(im: Image.Image) -> Image.Image:
    """Halve a 1x pixel-art image by 2x2 majority vote; ties go to the darker colour so outlines survive.

    A block with fewer than two opaque pixels becomes transparent.
    """
    w, h = im.width // 2, im.height // 2
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px, op = im.load(), out.load()
    for y in range(h):
        for x in range(w):
            block = [px[2 * x + dx, 2 * y + dy] for dx in (0, 1) for dy in (0, 1)]
            opaque = [p for p in block if p[3] > 0]
            if len(opaque) < 2:
                continue
            counts = Counter(opaque)
            top = max(counts.values())
            op[x, y] = min((c for c, n in counts.items() if n == top), key=lambda c: c[0] + c[1] + c[2])
    return out


def centre(im: Image.Image) -> Image.Image:
    part = im.crop(im.getbbox())
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.paste(part, ((CANVAS - part.width) // 2, (CANVAS - part.height) // 2), part)
    return canvas


def recolour(im: Image.Image, table: dict) -> Image.Image:
    out = im.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            px[x, y] = table.get(px[x, y], px[x, y])
    return out


def to_palette_png(im: Image.Image, path: str) -> None:
    """Save like items/eviolite.png: mode P, index 0 transparent, one entry per colour."""
    colours = sorted({p for p in im.getdata() if p[3] > 0})
    assert len(colours) < 256
    index = {c: i + 1 for i, c in enumerate(colours)}
    pal = Image.new("P", im.size, 0)
    pal.putpalette([0, 0, 0] + [v for c in colours for v in c[:3]])
    pp, px = pal.load(), im.load()
    for y in range(im.height):
        for x in range(im.width):
            if px[x, y][3] > 0:
                pp[x, y] = index[px[x, y]]
    pal.save(path, transparency=0, optimize=True)


def make_pngs() -> None:
    src = Image.open(SRC).convert("RGBA")
    vest = centre(shrink_majority(src.crop(src.getbbox())))
    to_palette_png(vest, os.path.join(ITEMS, "assault_vest.png"))
    to_palette_png(recolour(vest, GREY), os.path.join(ITEMS, "bulletproof_vest.png"))
    print("pngs: assault_vest.png, bulletproof_vest.png", vest.getbbox())


def update_atlas(names: list) -> None:
    js = os.path.join(IMG, "items.json")
    png = os.path.join(IMG, "items.png")
    raw = open(js, "rb").read()
    data = json.loads(raw)
    # The file is TexturePacker output: tab indent and CRLF, but its very last newline is a bare LF.
    # Re-serialising the parsed data must reproduce the file byte for byte before we touch it.
    body = json.dumps(data, indent="\t", ensure_ascii=False).replace("\n", "\r\n").encode("utf-8")
    if not raw.startswith(body) or raw[len(body):].strip(b"\r\n"):
        raise SystemExit("items.json is not in the expected TexturePacker style; refusing to rewrite it")
    tail = raw[len(body):]

    tex = data["textures"][0]
    frames = {f["filename"]: f for f in tex["frames"]}
    sheet = Image.open(png).convert("RGBA")
    new = [n for n in names if n not in frames]
    if new:
        # one new row of 32x32 cells under everything, 1px apart like the rows the earlier scripts added
        y = sheet.height + 1
        grown = Image.new("RGBA", (max(sheet.width, len(new) * (CANVAS + 1) - 1), y + CANVAS), (0, 0, 0, 0))
        grown.paste(sheet, (0, 0))
        sheet = grown
        for i, n in enumerate(new):
            frame = {
                "filename": n,
                "rotated": False,
                "trimmed": False,
                "sourceSize": {"w": CANVAS, "h": CANVAS},
                "spriteSourceSize": {"x": 0, "y": 0, "w": CANVAS, "h": CANVAS},
                "frame": {"x": i * (CANVAS + 1), "y": y, "w": CANVAS, "h": CANVAS},
            }
            tex["frames"].append(frame)
            frames[n] = frame
    for n in names:
        f = frames[n]["frame"]
        icon = Image.open(os.path.join(ITEMS, n + ".png")).convert("RGBA")
        assert icon.size == (f["w"], f["h"]), (n, icon.size)
        sheet.paste(Image.new("RGBA", icon.size, (0, 0, 0, 0)), (f["x"], f["y"]))  # clear, then draw
        sheet.paste(icon, (f["x"], f["y"]), icon)
    tex["size"] = {"w": sheet.width, "h": sheet.height}
    sheet.save(png)
    text = json.dumps(data, indent="\t", ensure_ascii=False).replace("\n", "\r\n").encode("utf-8") + tail
    json.loads(text)  # must still parse
    open(js, "wb").write(text)
    print("atlas:", "added" if new else "redrew", names, "size", tex["size"])


if __name__ == "__main__":
    # Local fork (2026-11-18): superseded by install_pokesprite_icons.py (the user: "아이콘 화풍은 포케스프라이트로
    # 통일"); a plain run would put the Essentials vests back over PokéSprite's, so it needs --essentials
    if "--essentials" not in sys.argv:
        raise SystemExit("superseded by install_pokesprite_icons.py; pass --essentials to install the Essentials vests anyway")
    if "--keep-pngs" not in sys.argv:
        make_pngs()
    update_atlas(["assault_vest", "bulletproof_vest"])
    print("done")
