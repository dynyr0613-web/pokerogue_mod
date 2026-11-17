"""Build the sinister "GTS?" mystery encounter sprite for the PokeRogue fork (2026-11-08).

  D:/SpriteGen/comfyui/ComfyUI_windows_portable/python_embeded/python.exe -I make_dark_gts_sprite.py [--preview-only OUT.png]

Source (read only): assets/images/mystery-encounters/global_trade_system.png, the official 77x78 GTS terminal (navy
globe with a glowing cyan grid, orbit rings and two round satellites, a navy top plate on a grey pedestal, a small grey
computer with a cyan screen), and its atlas json global_trade_system.json.

The user's colour spec: globe black, the rings' outer part (their navy border outside the globe) black, the stripes
(the glowing grid and ring lines) and the satellites red, the grey part of the pedestal black, the computer black,
its monitor screen red. Only colours change: every pixel keeps its place and its alpha (opaque or fully transparent).

The same source colour shows up in several parts (the screen uses the ring cyans, the computer uses the pedestal
greys), so the image is split into regions first and each region gets its own colour table:
  screen   the computer's cyan/blue pixels (the monitor screen with its face): red ramp (SCREEN_MAP)
  pc       the computer's other pixels (black outline, bezel, stand, keyboard): near-black ramp a step darker than
           the pedestal, so the black computer stands out in front of it (PC_MAP). The computer is its black outline
           and everything inside it (computer_mask: a flood from the edge of the COMPUTER box through non-black
           pixels; whatever the flood cannot reach is the computer).
  pedestal the grey cone outside the computer: charcoal-black ramp, kept a little lighter than the globe and the top
           plate so the plate's edge still reads against it (PEDESTAL_MAP)
  globe    everything else: the globe with its shadow side and highlight, the ring borders, the navy top plate on the
           pedestal (globe-coloured in the original, so it goes black with the globe), every OUTLINE pixel (the
           globe's shadow-side edge, the plate rim, the pedestal outline: all INK), and all the glowing lines and
           satellites (cyan ramp -> red ramp) (GLOBE_MAP)
Each ramp keeps the original shading steps (outline -> shadow -> base -> light -> highlight), so the black parts keep
their form. Every region asserts that it holds only the colours its table knows, so a changed source fails loudly.
Colours tuned by eye on 2026-11-08 against grey, green, sand and dark backgrounds.

Output: assets/images/mystery-encounters/dark_global_trade_system.png  palette PNG (install_vest_icons.to_palette_png)
        assets/images/mystery-encounters/dark_global_trade_system.json the GTS atlas json with its image name changed
        D:/PokeRogueDev/docs/dark_gts_preview.png                      original and new side by side, 6x, on grey
                                                                        and on a dark background
--preview-only OUT.png writes just the preview to OUT.png (for tuning) and installs nothing.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I leaves the script folder off sys.path

from PIL import Image

import install_vest_icons as vest

ME = os.path.join(vest.IMG, "mystery-encounters")
SRC_NAME = "global_trade_system"
NAME = "dark_global_trade_system"
PREVIEW = r"D:\PokeRogueDev\docs\dark_gts_preview.png"

COMPUTER = (27, 51, 47, 75)  # x0, y0, x1, y1 (exclusive) around the computer in the GTS image (see computer_mask)
COMPUTER_BBOX = (26, 51, 44, 71)  # the computer's own pixels span exactly this box (inclusive)
N4 = ((1, 0), (-1, 0), (0, 1), (0, -1))
N8 = N4 + ((1, 1), (1, -1), (-1, 1), (-1, -1))

# source colours (the GTS palette)
BLACK = (0, 0, 0)  # computer outline, plate rim lines
OUTLINE = (27, 29, 33)  # outline of the globe's shadow side, the plate and the pedestal
NAVY_DARK = (13, 28, 61)  # globe shadow side, top plate
NAVY = (28, 46, 106)  # globe body, ring borders outside the globe, plate edge
PLATE_BLUE = (34, 46, 103)  # lit right side of the top plate
NAVY_MID = (38, 69, 122)  # globe highlight, outer
NAVY_LIGHT = (53, 90, 146)  # globe highlight, core
BLUE = (23, 93, 167)  # dark edge of the glowing lines; screen border
CYAN = (33, 172, 240)  # glowing lines; screen
CYAN_BRIGHT = (74, 244, 255)  # glowing line cores and satellites; the screen's face
GREY_DARK = ((59, 67, 80), (57, 66, 80))  # pedestal / computer shade
GREY_MID = ((87, 100, 117), (87, 101, 119), (87, 102, 119))  # pedestal / computer body
GREY_LIGHT = ((148, 158, 164), (150, 160, 167))  # pedestal lit side, computer bezel, keys
GREY_WHITE = (204, 210, 216)  # pedestal highlights

# new colours
INK = (0, 0, 0)  # outlines
GLOBE_SHADOW = (14, 14, 18)
GLOBE_BASE = (26, 26, 32)
GLOBE_LIGHT = (44, 44, 54)
GLOBE_SHINE = (62, 62, 76)
RED_DARK = (128, 14, 16)
RED = (220, 32, 32)
RED_BRIGHT = (255, 84, 72)
PEDESTAL_DARK = (30, 30, 36)
PEDESTAL_MID = (40, 40, 48)
PEDESTAL_LIGHT = (54, 54, 64)
PEDESTAL_WHITE = (86, 86, 100)
PC_DARK = (18, 18, 22)
PC_MID = (28, 28, 34)
PC_LIGHT = (44, 44, 52)
SCREEN_EDGE = (110, 10, 12)
SCREEN = (196, 24, 24)
SCREEN_FACE = (255, 120, 104)

RED_RAMP = {BLUE: RED_DARK, CYAN: RED, CYAN_BRIGHT: RED_BRIGHT}
GLOBE_MAP = {
    BLACK: INK,
    OUTLINE: INK,
    NAVY_DARK: GLOBE_SHADOW,
    NAVY: GLOBE_BASE,
    PLATE_BLUE: GLOBE_BASE,
    NAVY_MID: GLOBE_LIGHT,
    NAVY_LIGHT: GLOBE_SHINE,
    **RED_RAMP,
}
PEDESTAL_MAP = {
    OUTLINE: INK,
    **dict.fromkeys(GREY_DARK, PEDESTAL_DARK),
    **dict.fromkeys(GREY_MID, PEDESTAL_MID),
    **dict.fromkeys(GREY_LIGHT, PEDESTAL_LIGHT),
    GREY_WHITE: PEDESTAL_WHITE,
}
PC_MAP = {
    BLACK: INK,
    **dict.fromkeys(GREY_DARK, PC_DARK),
    **dict.fromkeys(GREY_MID, PC_MID),
    **dict.fromkeys(GREY_LIGHT, PC_LIGHT),
}
SCREEN_MAP = {BLUE: SCREEN_EDGE, CYAN: SCREEN, CYAN_BRIGHT: SCREEN_FACE}


def computer_mask(px, size) -> set:
    """the computer's own pixels: its black outline and everything inside it. The area around COMPUTER is flooded
    from its edge through non-black pixels (4-connected, so the outline's diagonal steps hold the flood); whatever the
    flood cannot reach is the computer (same rule as make_super_gts_sprite.computer_mask)."""
    w, h = size
    x0, y0 = max(COMPUTER[0] - 2, 0), max(COMPUTER[1] - 2, 0)
    x1, y1 = min(COMPUTER[2] + 2, w), min(COMPUTER[3] + 2, h)
    area = {(x, y) for y in range(y0, y1) for x in range(x0, x1)}
    black = {p for p in area if px[p][3] and px[p][:3] == BLACK}
    stack = [(x, y) for x, y in area if (x in (x0, x1 - 1) or y in (y0, y1 - 1)) and (x, y) not in black]
    outside = set(stack)
    while stack:
        x, y = stack.pop()
        for dx, dy in N4:
            q = (x + dx, y + dy)
            if q in area and q not in outside and q not in black:
                outside.add(q)
                stack.append(q)
    inside = area - outside - black
    mask = inside | {(x, y) for x, y in black if any((x + dx, y + dy) in inside for dx, dy in N8)}
    xs, ys = [x for x, _ in mask], [y for _, y in mask]
    assert (min(xs), min(ys), max(xs), max(ys)) == COMPUTER_BBOX, (min(xs), min(ys), max(xs), max(ys))
    return mask


def regions(im: Image.Image) -> dict:
    """{region name: set of (x, y)} for every opaque pixel; see the module docstring. OUTLINE pixels outside the
    computer (the globe's shadow-side edge, the plate rim and the pedestal outline) all fall in "globe"; they turn
    INK either way."""
    px = im.load()
    pc = computer_mask(px, im.size)
    greys = set(PEDESTAL_MAP) - {OUTLINE}
    out = {"screen": set(), "pc": set(), "pedestal": set(), "globe": set()}
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            c = (r, g, b)
            if (x, y) in pc:
                out["screen" if c in SCREEN_MAP else "pc"].add((x, y))
            elif c in greys:
                out["pedestal"].add((x, y))
            else:
                out["globe"].add((x, y))
    return out


def recolour(src: Image.Image) -> Image.Image:
    tables = {"screen": SCREEN_MAP, "pc": PC_MAP, "pedestal": PEDESTAL_MAP, "globe": GLOBE_MAP}
    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    sp, op = src.load(), out.load()
    for name, pixels in regions(src).items():
        table = tables[name]
        stray = {sp[p][:3] for p in pixels} - set(table)
        assert not stray, f"{name}: colours with no mapping {sorted(stray)}"
        for p in pixels:
            op[p] = (*table[sp[p][:3]], 255)
    return out


def preview(src: Image.Image, new: Image.Image, path: str, scale: int = 6) -> None:
    """original | new, on mid grey (top) and on a dark background (bottom)."""
    gap = 8
    w, h = src.width * scale, src.height * scale
    sheet = Image.new("RGBA", (2 * w + 3 * gap, 2 * h + 3 * gap), (255, 255, 255, 255))
    for row, bg in enumerate([(128, 128, 128, 255), (34, 30, 44, 255)]):
        for col, im in enumerate([src, new]):
            tile = Image.new("RGBA", src.size, bg)
            tile.alpha_composite(im)
            sheet.paste(tile.resize((w, h), Image.NEAREST), (gap + col * (w + gap), gap + row * (h + gap)))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sheet.convert("RGB").save(path)


def check(src: Image.Image, new: Image.Image) -> None:
    assert new.size == src.size == (77, 78), new.size
    sp, np_ = src.load(), new.load()
    for y in range(src.height):
        for x in range(src.width):
            assert sp[x, y][3] in (0, 255) and np_[x, y][3] == sp[x, y][3], (x, y)


def install_json() -> None:
    raw = open(os.path.join(ME, SRC_NAME + ".json"), "rb").read()
    text = raw.decode("utf-8")
    old = f'"image": "{SRC_NAME}.png"'
    assert text.count(old) == 1
    text = text.replace(old, f'"image": "{NAME}.png"')
    json.loads(text)
    open(os.path.join(ME, NAME + ".json"), "wb").write(text.encode("utf-8"))


if __name__ == "__main__":
    src = Image.open(os.path.join(ME, SRC_NAME + ".png")).convert("RGBA")
    new = recolour(src)
    check(src, new)
    if "--preview-only" in sys.argv:
        preview(src, new, sys.argv[sys.argv.index("--preview-only") + 1])
        raise SystemExit(0)
    vest.to_palette_png(new, os.path.join(ME, NAME + ".png"))
    installed = Image.open(os.path.join(ME, NAME + ".png")).convert("RGBA")
    assert list(installed.get_flattened_data()) == list(new.get_flattened_data()), "palette PNG does not round-trip"
    install_json()
    preview(src, new, PREVIEW)
    print("installed", NAME, "and", PREVIEW)
