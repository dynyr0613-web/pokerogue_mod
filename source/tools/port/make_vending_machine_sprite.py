# Local fork (2026-11-08): intro sprite for the "자판기" (VENDING_MACHINE) mystery encounter.
"""Build the Vending Machine mystery encounter sprite for the PokeRogue fork (2026-11-08).

  D:/SpriteGen/comfyui/ComfyUI_windows_portable/python_embeded/python.exe -I make_vending_machine_sprite.py [--preview-only OUT.png]

No vending machine image on disk may be used, so the machine is built here from plain rectangles at 1x, the same way
make_tinkaton_forge_sprite.py builds its anvil. Nothing is random: every run draws the same pixels.

Shape: a box seen from the front and a little from above and to the left (oblique, depth vector (2, -1) per step,
3 steps), so a 3-row top face and a 6-column right side face show beside the 42x71 front. With the 1px outline the
sprite is 50x76 (the official GTS is 77x78), so it stands about as tall as the GTS family.

Front, top to bottom:
  - the white/light sign panel (lit sign) with a two-tone blue wave band and three drink-coloured dots
  - the glass window (recessed, dark glass) with three shelves: blue bottles (Fresh Water), pink cans (Soda Pop) and
    yellow cans (Lemonade), four of each, plus two "/" glare streaks across the glass; beside it the button column:
    three selection buttons in the shelves' colours, a tiny price display, the coin slot plate with its slit
  - the dark dispenser tray (push flap over a black opening) and the coin return cup
  - a dark grey kick plate with vent slits
Lit from the top-left: the front's top edge is the highlight line, the top face, the front's left column and the
ledges under the recesses are the light red, the front is the mid red, the right side face the dark red (deepest in
its lower half), recesses are shaded on their top/left inner edges, raised parts (buttons, coin plate) on their
bottom/right. The glare crosses the glass at (x - left) + (y - top) in GLARE_STREAKS and lifts every colour it crosses
to that material's lightest shade, so it reads as one streak over glass, bottles, cans and shelves alike.

Colours (32): 5 reds, the official GTS pedestal greys for metal (global_trade_system.png) plus a deeper grey for the
kick plate's side, 4 shades for each drink, 3 glass shades, the white sign with two blues; outline (27, 29, 33) like
the GTS pedestal.

Output: assets/images/mystery-encounters/vending_machine.png   palette PNG (index 0 transparent)
        assets/images/mystery-encounters/vending_machine.json  global_trade_system.json with only the image name and
                                                               the sizes changed (CRLF kept)
        D:/PokeRogueDev/docs/vending_machine_preview.png        6x, next to the official global_trade_system.png for
                                                               scale (bottom-aligned), on mid grey (top) and a dark
                                                               background (bottom)
--preview-only OUT.png writes just the preview to OUT.png (for tuning) and installs nothing.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I leaves the script folder off sys.path

from PIL import Image

import install_vest_icons as vest

ME = os.path.join(vest.IMG, "mystery-encounters")
NAME = "vending_machine"
GTS = os.path.join(ME, "global_trade_system")
JSON_TEMPLATE = GTS + ".json"
PREVIEW = r"D:\PokeRogueDev\docs\vending_machine_preview.png"

W, H = 50, 76  # with the outline
SIZE_RANGE = ((44, 56), (70, 78))

OUTLINE = (27, 29, 33)
# body reds, lit from the top-left
RED_HI = (255, 118, 104)
RED_LIGHT = (232, 64, 60)
RED_MID = (198, 36, 44)
RED_DARK = (140, 22, 40)
RED_DEEP = (100, 16, 34)
# metal: the GTS pedestal greys
MET_HI = (204, 210, 216)
MET_LIGHT = (148, 158, 164)
MET_MID = (87, 100, 117)
MET_DARK = (59, 67, 80)
MET_DEEP = (40, 45, 56)  # the kick plate's side
# the lit sign
WHITE = (248, 248, 248)
SIGN_SHADE = (208, 216, 228)
WAVE_LIGHT = (96, 176, 240)
WAVE_DARK = (40, 104, 200)
# glass and the dark parts
GLASS_HI = (120, 150, 184)
GLASS = (44, 60, 92)
GLASS_DARK = (28, 38, 64)
TRAY = (14, 14, 20)
DISPLAY_LIT = (120, 240, 160)
# drinks: (highlight, light, mid, dark)
BLUE = ((206, 236, 255), (110, 186, 250), (54, 122, 226), (30, 66, 156))
PINK = ((255, 212, 236), (250, 138, 196), (226, 78, 154), (150, 38, 104))
YELLOW = ((255, 250, 190), (250, 226, 86), (232, 176, 30), (166, 110, 22))
CAP = WHITE

# the box: front face, depth steps of (2, -1)
FX0, FX1, FY0, FY1 = 1, 42, 4, 74
DEPTH = 3
PLINTH_Y = 70  # first kick plate row

# front layout (inclusive rectangles, outer frame lines)
SIGN = (3, 6, 40, 17)
WINDOW = (3, 19, 29, 52)
PANEL = (31, 19, 40, 52)
TRAY_BOX = (5, 56, 27, 65)
CUP = (33, 57, 38, 62)

GLARE_STREAKS = (19, 20, 24)  # (x - left) + (y - top) inside the window: a 2 px streak and a 1 px one

N4 = ((1, 0), (-1, 0), (0, 1), (0, -1))


class Canvas:
    def __init__(self) -> None:
        self.px = {}

    def put(self, x: int, y: int, c: tuple) -> None:
        assert 1 <= x < W - 1 and 1 <= y < H - 1, (x, y)
        self.px[(x, y)] = c

    def fill(self, x0: int, y0: int, x1: int, y1: int, c: tuple) -> None:
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.put(x, y, c)

    def frame(self, x0: int, y0: int, x1: int, y1: int, c: tuple) -> None:
        for x in range(x0, x1 + 1):
            self.put(x, y0, c)
            self.put(x, y1, c)
        for y in range(y0, y1 + 1):
            self.put(x0, y, c)
            self.put(x1, y, c)

    def map(self, x: int, y: int, table: dict) -> None:
        c = self.px.get((x, y))
        if c in table:
            self.px[(x, y)] = table[c]


def body(cv: Canvas) -> None:
    """the red box: top face, front, right side face, and the kick plate"""
    # top face: row y = FY0 - k spans the front's top edge moved by k depth half-steps
    for k in range(1, DEPTH + 1):
        y = FY0 - k
        for x in range(FX0 + 2 * k, FX1 + 2 * k + 1):
            cv.put(x, y, RED_LIGHT)
    # side face: column x = FX1 + i (i 1..6) starts one row under the top face's right end
    for i in range(1, 2 * DEPTH + 1):
        x = FX1 + i
        rise = (i + 1) // 2
        for y in range(FY0 - rise + 1, FY1 - rise + 1):
            if y >= PLINTH_Y - rise:
                c = MET_DARK if y == PLINTH_Y - rise else MET_DEEP
            else:
                c = RED_DARK if y < 46 - rise else RED_DEEP
            cv.put(x, y, c)
    # front
    cv.fill(FX0, FY0, FX1, PLINTH_Y - 1, RED_MID)
    cv.fill(FX0, FY0, FX1, FY0, RED_HI)  # the front's top edge catches the light
    cv.fill(FX0, FY0, FX0, PLINTH_Y - 1, RED_LIGHT)  # the left column
    cv.put(FX0, FY0, RED_HI)
    # kick plate with vent slits
    cv.fill(FX0, PLINTH_Y, FX1, FY1, MET_DARK)
    cv.fill(FX0, PLINTH_Y, FX1, PLINTH_Y, MET_MID)
    cv.put(FX0, PLINTH_Y, MET_LIGHT)
    for x in range(FX0 + 3, FX1 - 2, 3):
        cv.fill(x, PLINTH_Y + 2, x + 1, PLINTH_Y + 3, OUTLINE)


def recess_ledges(cv: Canvas) -> None:
    """the body row under each recess faces up and catches the light; the row over it is in its lip's shade"""
    for x0, _y0, x1, y1 in (WINDOW, PANEL, TRAY_BOX):
        for x in range(x0, x1 + 1):
            cv.put(x, y1 + 1, RED_LIGHT)


def sign(cv: Canvas) -> None:
    x0, y0, x1, y1 = SIGN
    cv.frame(x0, y0, x1, y1, OUTLINE)
    cv.fill(x0 + 1, y0 + 1, x1 - 1, y1 - 1, WHITE)
    # a wave band across the lower half: light blue crest over a darker blue body, period 8 px
    crest = [0, 0, 1, 1, 2, 2, 1, 1]
    for x in range(x0 + 1, x1):
        top = y0 + 6 + crest[(x - x0) % 8]
        for y in range(top, y1):
            cv.put(x, y, WAVE_LIGHT if y == top else WAVE_DARK)
    # three dots in the drinks' colours on the white part
    for i, drink in enumerate((BLUE, PINK, YELLOW)):
        cx = x0 + 11 + 7 * i
        cv.fill(cx, y0 + 2, cx + 1, y0 + 3, drink[2])
        cv.put(cx, y0 + 2, drink[1])


def bottle(cv: Canvas, x: int, y: int, drink: tuple) -> None:
    """5x9 at (x, y): cap, neck and shoulder 3 px wide, then a 5 px body with a white label band"""
    hi, light, mid, dark = drink
    cv.fill(x + 1, y, x + 3, y, CAP)
    cv.put(x + 3, y, MET_LIGHT)
    for yy in (y + 1, y + 2):
        cv.put(x + 1, yy, hi if yy == y + 2 else light)
        cv.put(x + 2, yy, light if yy == y + 2 else mid)
        cv.put(x + 3, yy, dark)
    for yy in range(y + 3, y + 9):
        cols = (light, hi if yy == y + 3 else light, mid, mid, dark)
        if yy in (y + 5, y + 6):
            cols = (SIGN_SHADE, WHITE, WHITE, SIGN_SHADE, MET_LIGHT)
        for i, c in enumerate(cols):
            cv.put(x + i, yy, c)


def can(cv: Canvas, x: int, y: int, drink: tuple) -> None:
    """5x7 at (x, y): lid, rim, body, bottom rim"""
    hi, light, mid, dark = drink
    cv.fill(x + 1, y, x + 3, y, MET_HI)
    cv.put(x + 3, y, MET_LIGHT)
    cv.fill(x, y + 1, x + 4, y + 1, MET_LIGHT)
    cv.put(x + 4, y + 1, MET_MID)
    for yy in range(y + 2, y + 6):
        for i, c in enumerate((light, hi if yy == y + 2 else light, mid, mid, dark)):
            cv.put(x + i, yy, c)
    cv.put(x + 2, y + 3, light)  # a little stripe on the can
    cv.put(x + 3, y + 3, light)
    cv.fill(x + 1, y + 6, x + 3, y + 6, MET_MID)
    cv.put(x + 3, y + 6, MET_DARK)


def window(cv: Canvas) -> None:
    x0, y0, x1, y1 = WINDOW
    cv.frame(x0, y0, x1, y1, OUTLINE)
    ix0, iy0, ix1, iy1 = x0 + 1, y0 + 1, x1 - 1, y1 - 1
    cv.fill(ix0, iy0, ix1, iy1, GLASS)
    cv.fill(ix0, iy0, ix1, iy0, GLASS_DARK)  # the recess's top and left inner edges are in shade
    cv.fill(ix0, iy0, ix0, iy1, GLASS_DARK)
    # shelves: (drink kind, colours, item height); 4 items of 5 px with 1 px gaps, from ix0 + 1
    y = iy0 + 1
    for kind, drink, h in (("bottle", BLUE, 9), ("can", PINK, 7), ("can", YELLOW, 7)):
        for n in range(4):
            x = ix0 + 1 + 6 * n
            (bottle if kind == "bottle" else can)(cv, x, y, drink)
        y += h
        cv.fill(ix0, y, ix1, y, MET_HI)  # the shelf edge
        cv.fill(ix0, y + 1, ix1, y + 1, MET_MID)
        cv.put(ix0, y, MET_LIGHT)
        y += 3
    assert y - 1 == iy1 + 1, ("shelves do not fill the window", y, iy1)
    # the glare: a 2 px and a 1 px "/" streak (x + y constant); whatever they cross turns to its lightest shade
    glare = {GLASS: GLASS_HI, GLASS_DARK: GLASS_HI, MET_MID: MET_HI, MET_LIGHT: MET_HI, MET_DARK: MET_LIGHT}
    glare.update({SIGN_SHADE: WHITE, CAP: WHITE})
    for drink in (BLUE, PINK, YELLOW):
        glare.update({c: drink[0] for c in drink[1:]})
    for x in range(ix0, ix1 + 1):
        for y in range(iy0, iy1 + 1):
            if (x - ix0) + (y - iy0) in GLARE_STREAKS:
                cv.map(x, y, glare)


def button(cv: Canvas, x: int, y: int, drink: tuple) -> None:
    """a raised 6x4 button: outline, the drink's colour lit top-left"""
    cv.frame(x, y, x + 5, y + 3, OUTLINE)
    cv.fill(x + 1, y + 1, x + 4, y + 2, drink[2])
    cv.fill(x + 1, y + 1, x + 3, y + 1, drink[1])
    cv.put(x + 1, y + 1, drink[0])
    cv.put(x + 4, y + 2, drink[3])


def panel(cv: Canvas) -> None:
    x0, y0, x1, y1 = PANEL
    cv.frame(x0, y0, x1, y1, OUTLINE)
    cv.fill(x0 + 1, y0 + 1, x1 - 1, y1 - 1, MET_LIGHT)
    cv.fill(x0 + 1, y0 + 1, x1 - 1, y0 + 1, MET_HI)  # lit top and left, shaded right
    cv.fill(x0 + 1, y0 + 1, x0 + 1, y1 - 1, MET_HI)
    cv.fill(x1 - 1, y0 + 2, x1 - 1, y1 - 1, MET_MID)
    for i, drink in enumerate((BLUE, PINK, YELLOW)):
        button(cv, x0 + 2, y0 + 2 + 5 * i, drink)
    # a tiny price display
    cv.fill(x0 + 2, y0 + 18, x0 + 7, y0 + 20, OUTLINE)
    for x in (x0 + 3, x0 + 5, x0 + 6):
        cv.put(x, y0 + 19, DISPLAY_LIT)
    # the coin slot plate: raised, with the slit
    px0, py0, px1, py1 = x0 + 2, y0 + 23, x0 + 7, y0 + 30
    cv.frame(px0, py0, px1, py1, OUTLINE)
    cv.fill(px0 + 1, py0 + 1, px1 - 1, py1 - 1, MET_LIGHT)
    cv.fill(px0 + 1, py0 + 1, px1 - 2, py0 + 1, WHITE)
    cv.fill(px0 + 1, py0 + 1, px0 + 1, py1 - 2, MET_HI)
    cv.fill(px1 - 1, py0 + 2, px1 - 1, py1 - 1, MET_MID)
    cv.fill(px0 + 2, py1 - 1, px1 - 1, py1 - 1, MET_MID)
    cv.fill(px0 + 2, py0 + 2, px0 + 3, py0 + 5, OUTLINE)  # the slit, 2x4
    cv.fill(px0 + 2, py0 + 6, px0 + 3, py0 + 6, MET_HI)  # its lower lip catches the light


def tray(cv: Canvas) -> None:
    x0, y0, x1, y1 = TRAY_BOX
    cv.frame(x0, y0, x1, y1, OUTLINE)
    ix0, iy0, ix1, iy1 = x0 + 1, y0 + 1, x1 - 1, y1 - 1
    # the push flap (upper half) over the black opening
    cv.fill(ix0, iy0, ix1, iy0 + 3, MET_DARK)
    cv.fill(ix0, iy0, ix1, iy0, MET_MID)
    cv.put(ix0, iy0, MET_LIGHT)
    cv.fill(ix0, iy0 + 4, ix1, iy1, TRAY)
    cv.fill(ix0, iy1, ix1, iy1, MET_DARK)  # the tray's bottom lip
    # the coin return cup
    cx0, cy0, cx1, cy1 = CUP
    cv.frame(cx0, cy0, cx1, cy1, OUTLINE)
    cv.fill(cx0 + 1, cy0 + 1, cx1 - 1, cy1 - 1, TRAY)
    cv.fill(cx0 + 1, cy1 - 1, cx1 - 1, cy1 - 1, MET_DARK)


def outline(cv: Canvas) -> Image.Image:
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    p = im.load()
    for (x, y), c in cv.px.items():
        p[x, y] = (*c, 255)
    for y in range(H):
        for x in range(W):
            if (x, y) not in cv.px and any((x + dx, y + dy) in cv.px for dx, dy in N4):
                p[x, y] = (*OUTLINE, 255)
    return im


def machine() -> Image.Image:
    cv = Canvas()
    body(cv)
    recess_ledges(cv)
    sign(cv)
    window(cv)
    panel(cv)
    tray(cv)
    return outline(cv)


def check(im: Image.Image) -> None:
    (wmin, wmax), (hmin, hmax) = SIZE_RANGE
    assert im.size == (W, H) and wmin <= im.width <= wmax and hmin <= im.height <= hmax, im.size
    assert im.getbbox() == (0, 0, im.width, im.height), "bounds are not tight"
    data = list(im.get_flattened_data())
    assert {p[3] for p in data} <= {0, 255}, "alpha is not binary"
    assert len({p for p in data if p[3]}) < 256


def install_json(w: int, h: int) -> None:
    raw = open(JSON_TEMPLATE, "rb").read().decode("utf-8")
    assert "\r\n" in raw and "\n" not in raw.replace("\r\n", "")
    assert raw.count('"w": 77') == 4 and raw.count('"h": 78') == 4 and raw.count('"image": "global_trade_system.png"') == 1
    text = raw.replace('"w": 77', f'"w": {w}').replace('"h": 78', f'"h": {h}')
    text = text.replace('"image": "global_trade_system.png"', f'"image": "{NAME}.png"')
    data = json.loads(text)
    tex = data["textures"][0]
    f = tex["frames"][0]
    assert len(tex["frames"]) == 1 and tex["size"] == f["sourceSize"] == {"w": w, "h": h}
    assert f["frame"] == f["spriteSourceSize"] == {"x": 0, "y": 0, "w": w, "h": h}
    open(os.path.join(ME, NAME + ".json"), "wb").write(text.encode("utf-8"))


def preview(sprite: Image.Image, path: str, scale: int = 6) -> None:
    """the machine and the official GTS side by side, bottom-aligned, on mid grey and on a dark background"""
    gts = Image.open(GTS + ".png").convert("RGBA")
    gap = 8
    h = max(sprite.height, gts.height)
    cols = [(sprite, gap), (gts, 2 * gap + sprite.width * scale)]
    sheet = Image.new("RGBA", (sprite.width * scale + gts.width * scale + 3 * gap, 2 * h * scale + 3 * gap), (255, 255, 255, 255))
    for row, bg in enumerate([(128, 128, 128, 255), (34, 30, 44, 255)]):
        for im, x in cols:
            tile = Image.new("RGBA", (im.width, h), bg)
            tile.alpha_composite(im, (0, h - im.height))
            sheet.paste(tile.resize((im.width * scale, h * scale), Image.NEAREST), (x, gap + row * (h * scale + gap)))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sheet.convert("RGB").save(path)


if __name__ == "__main__":
    sprite = machine()
    check(sprite)
    print("sprite", sprite.size, "colours", len({p for p in sprite.get_flattened_data() if p[3]}))
    if "--preview-only" in sys.argv:
        preview(sprite, sys.argv[sys.argv.index("--preview-only") + 1])
        raise SystemExit(0)
    out = os.path.join(ME, NAME + ".png")
    vest.to_palette_png(sprite, out)
    assert list(Image.open(out).convert("RGBA").get_flattened_data()) == list(sprite.get_flattened_data())
    install_json(*sprite.size)
    preview(sprite, PREVIEW)
    print("installed", NAME, "and", PREVIEW)
