"""Build the Super GTS (슈퍼 GTS) encounter sprite for the PokeRogue fork (2026-11-07).

  D:/SpriteGen/comfyui/ComfyUI_windows_portable/python_embeded/python.exe -I make_super_gts_sprite.py [--install] [--preview out.png]
      [--split-parts [--force]] [--remake-part NAME] [--ring-model gts|new] [--from-scratch] [--generated-doll]
      [--export-doll out.png]

The sprite is four part images in super_gts_parts/ next to this script, each a full 77x88 layer so they line up
when stacked: pedestal.png (with the shadow under the doll's tail), pc.png, doll.png, rings.png (both rings, front
and back halves together). compose stacks them back to front: pedestal, the rings' back halves, doll, the rings'
front halves, pc; which ring pixels are front is worked out from the ring geometry (ring_front_pixels), so the rings
stay one picture to edit. When all four files are there the build uses them as they are, so they can be edited by
hand; --split-parts writes them from scratch (refusing to overwrite without --force), --from-scratch ignores them.
Split on 2026-11-07: the stacked parts give the installed sprite exactly, pixel for pixel. --remake-part NAME
rewrites one part from scratch.
Pedestal (make_pedestal, remade 2026-11-07): the hole behind the computer filled in, and the dark top plate drawn
as a whole ellipse like the GTS's (PLATE, fitted to the GTS plate) instead of the globe-cut band; then the plate and
the base ellipse grown so the plate meets the doll's raised tail, in place of the shaded wedge that used to fill the
gap under it (ground_shadow, now off). Final layout (2026-11-07, the user's call): everything lifted LIFT = 2 rows to
make room below, then the plate 1 px wider each side and 2 px taller up and down (PLATE_GROW) and the base and grey
cone 1 px wider each side and 2 px longer (BASE_GROW); the computer goes down with the base, so it keeps its place
on the cone's front (that leaves it at its old canvas rows); last, the doll and rings came back down 1 row
(DOLL_RING_DROP), so the tail all but meets the plate (a 1 px sliver under its very tip). The canvas stays 77x88; the
pedestal spans x 0..75.
Rings: two models (RING_MODELS): "gts", the GTS terminal's own two rings fitted to its pixels with its big beads, and
"new", the two waist rings drawn for this sprite. Side by side on the doll (2026-11-07) "new" won: with "gts" the
right big bead sits beside the eye sparkle and reads as a second eye, and the steep ring crosses the head and face;
"new" keeps the face clear. RING_MODEL picks the model; rings.png and compose's front/back split both follow it.
The from-scratch build:

The doll comes from super_gts_doll.png next to this script: the user's hand edit of this script's generated doll
(3rd revision, 2026-11-07) with a light polish: white background cleared; the short line on the left foot joined to
the foot's vertical line at (11, 47); a 2x2 clump at the bottom rim (37, 58) and a missing line side (20, 29) made
BLUE. The 2nd revision's polish was 16 pixels: a stray dot, three 2x2 clumps, 10 missing sides. --generated-doll
ignores that file and builds the doll here instead (sub.png + draw_grid); --export-doll writes the 64x64 doll that
the build used. The 64x64 frame is placed as a whole (DOLL_FRAME_BOX), so trimming the art does not move it.

The user's design: the GTS pedestal with the battle Substitute doll on it instead of the globe, the doll made a bit
bigger and given the GTS look (navy with a glowing blue grid, plus the orbit rings).
Inputs (read only, both from the fork's own assets):
  assets/images/mystery-encounters/global_trade_system.png  77x78 GTS terminal: navy globe, cyan grid and rings, grey
                                                             pedestal with a small computer
  assets/images/pokemon/sub.png                              32x32 Substitute doll shown in battle
Steps: the pedestal and computer are kept from the GTS as two layers (the pedestal: rows from PEDESTAL_TOP down, the
globe's leftovers on its top becoming the dark top plate; the computer: its own outlined pixels, computer_mask).
Layer order, back to front: pedestal, back ring halves, doll, front ring halves, computer, so the doll stands on the
plate uncut and only the computer covers it. The thin gap under the doll's raised tail is shaded down to the plate
(ground_shadow), so the doll does not look like it floats. The generated doll: sub.png doubled with Scale2x, its greens and
whites mapped onto the GTS navy palette, a grid drawn over it that follows its outline and centre line (draw_grid),
and two tilted rings with glowing beads drawn around it (back halves behind the doll, front halves over it). The
canvas grows upward by EXTRA_TOP rows. Grid lines and rings follow the GTS line rule: a 1-px bright core with one
darker pixel on each side.
2026-11-07 (2nd pass, the user's rule): the grid used to be meridians/parallels of an ellipse fitted to the doll's
box, so it ignored the head, ears, belly and feet and broke into 12 pieces at the belly colours, a face rectangle
and the outline; now it is level lines of outline/centre-line coordinates plus a rim, unbroken except where the
doll's own black lines pass over it.
--install writes assets/images/mystery-encounters/super_global_trade_system.png (palette PNG) and .json (the GTS
atlas json with the new image name and size).
"""

import json
import math
import os
import sys

from PIL import Image

GAME = r"D:\PokeRogueDev\pokerogue"
DOLL_ART = os.path.join(os.path.dirname(os.path.abspath(__file__)), "super_gts_doll.png")  # the user's finished doll
ME = os.path.join(GAME, "assets", "images", "mystery-encounters")
SUB = os.path.join(GAME, "assets", "images", "pokemon", "sub.png")
NAME = "super_global_trade_system"

EXTRA_TOP = 10  # rows added above the GTS canvas for the taller doll
PEDESTAL_TOP = 56  # first GTS row that belongs to the pedestal (the globe sits above it)
COMPUTER = (27, 51, 47, 75)  # x0, y0, x1, y1 (exclusive) around the computer in the GTS image (see computer_mask)
DOLL_FEET_Y = 62  # GTS-row where the doll's lowest pixel lands
DOLL_FRAME_BOX = (2, 2, 62, 62)  # the generated doll's box inside its 64x64 frame (Scale2x of sub.png's 1..31 box)
GROUND_GAP_MAX = 0  # gaps up to this many px between the doll's underside and the plate are shaded (ground_shadow);
# 0 = off since 2026-11-07: the user found the filled wedge under the tail awkward, and the grown plate meets the tail
# instead (PLATE_GROW), leaving only a 1-2 px sliver under the very tip of the tail
CANVAS = (77, 88)  # the GTS canvas (77x78) plus EXTRA_TOP rows
PARTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "super_gts_parts")
PARTS = ("pedestal", "pc", "doll", "rings")  # <name>.png in PARTS_DIR, each a full CANVAS layer (see compose)
PEDESTAL_OUTLINE = (27, 29, 33)  # the GTS pedestal's outline colour
PLATE = (38.0, 57.5, 31.0, 5.0, 4.3)  # the top plate in GTS pixels: centre x, centre y, rx, ry behind, ry in front;
# fitted to the GTS's own plate (its back rim at the sides, x 7..68, and where its grey cone starts in front)
PLATE_BLUE = (34, 46, 103)  # the GTS plate's lit blue
CONE_COLOURS = {(57, 66, 80), (59, 67, 80), (87, 100, 117), (87, 101, 119), (87, 102, 119), (148, 158, 164),
                (150, 160, 167), (204, 210, 216)}  # the GTS pedestal's greys
CONE_SPLIT = 38  # GTS column behind the computer where the cone's shaded half meets its lit half
PLATE_GROW = (1, 2)  # px the top plate ellipse grows (to each side, up and down) past the GTS's (make_pedestal)
BASE_GROW = (1, 2)  # px the base grows (to each side, down mid-front); the grey cone widens and lengthens with it
BASE_RX = 37.5  # half width of the GTS pedestal's base ellipse (it spans x 1..75)
LIFT = 2  # everything sits this many rows higher than the GTS rows + EXTRA_TOP, leaving room below the pedestal
DOLL_RING_DROP = 1  # ...except the doll and the rings, which then come back down this many rows (the user's finish)
CONE_SHADE, CONE_SHADE_TOP, CONE_SEAM, CONE_LIT = (87, 100, 117), (87, 101, 119), (59, 67, 80), (148, 158, 164)

# GTS palette
OUTLINE = (0, 0, 0)
NAVY_DARK = (13, 28, 61)
NAVY = (28, 46, 106)
NAVY_MID = (38, 69, 122)
NAVY_LIGHT = (53, 90, 146)
BLUE = (23, 93, 167)
CYAN = (33, 172, 240)
CYAN_BRIGHT = (74, 244, 255)

# sub.png colour -> GTS colour
DOLL_MAP = {
    (0, 0, 0): OUTLINE,
    (72, 96, 56): NAVY_DARK,
    (80, 80, 72): NAVY_DARK,
    (120, 136, 88): NAVY,
    (144, 160, 104): NAVY_MID,
    (160, 184, 128): NAVY_MID,
    (184, 208, 152): NAVY_LIGHT,
    (184, 184, 176): NAVY_MID,
    (208, 200, 192): NAVY_LIGHT,
    (248, 248, 248): BLUE,
}
EYE_SPARKLE_BOX = (16, 9, 22, 15)  # x0, y0, x1, y1 in sub.png: the white sparkle in the eye glows cyan

# Ring models, each ring (cx, cy, rx, ry, tilt in degrees, bead angles in degrees, bead size) in canvas pixels.
RING_MODELS = {
    # the GTS terminal's own two rings, moved down EXTRA_TOP rows: ellipses fitted to its pixels (the wide ring to its
    # left and right loops and the front arc under the globe, rms 0.8 px; the steep ring through its top-right loop,
    # its lower-left loop and the arc between them), with the big lit beads where the GTS has them
    "gts": [(37.45, 39.11, 35.37, 10.24, 4.28, [135.7], "big"), (34.75, 39.25, 35.7, 11.0, -46.1, [67.8], "big")],
    # the two rings drawn for this sprite (2026-11-07): centred 62% down the doll, small beads
    "new": [(38.0, 49.2, 36, 7, -12, [200], "small"), (38.0, 49.2, 33, 6, 14, [-20, 165], "small")],
}
RING_MODEL = "new"  # which model rings.png is drawn from and compose splits by; --ring-model NAME overrides


def rings() -> list:
    """the chosen ring model, lifted LIFT rows like everything else and dropped DOLL_RING_DROP with the doll"""
    name = sys.argv[sys.argv.index("--ring-model") + 1] if "--ring-model" in sys.argv else RING_MODEL
    return [(cx, cy - LIFT + DOLL_RING_DROP, *rest) for cx, cy, *rest in RING_MODELS[name]]

# Grid on the doll (see draw_grid). Lengths are in the doubled doll (64x64) unless marked sub.png.
GRID_CENTRE = [(14.75, 3.5), (13.0, 9.0), (10.0, 18.0), (9.0, 21.5), (9.25, 24.0), (10.25, 26.0), (11.0, 27.5)]
# ^ sub.png points of the doll's centre line: the notch between the ears, then the light seam down the belly
GRID_EAR_CUT = 9  # the head top for the parallels is measured from this row; the ears rise above it
GRID_PARALLELS = [0.16, 0.43]  # v values: brow line, chin line (the rim is v = 0 and 1); lower down, the two front
# ring halves cross the body, and a waist line (v ~ 0.6-0.7) would run 1-3 px beside them
GRID_MERIDIANS = [(-0.5, -1.0, 0.16), (0.0, 0.43, 1.0), (1 / 3, 0.43, 1.0), (2 / 3, -1.0, 1.0)]
# ^ (u, v_from, v_to): u = -1 left outline, 0 centre line, +1 right outline (the rim is u = -1 and +1); the centre
#   line and u = 1/3 only start below the face, and the left half of the body is narrow enough for rim + centre
GRID_FACE_BAND = (0.16, 0.43, 43)  # (v_from, v_to, x_max): no meridians cross the face (brow, eye, sparkle)
GRID_RIM_DEPTH = 3  # the rim stays within this many pixels of the silhouette (where black lines meet the outline)


def scale2x(im: Image.Image) -> Image.Image:
    """EPX / Scale2x: doubles pixel art, rounding diagonal steps instead of making 2x2 blocks."""
    w, h = im.size
    src = im.load()
    out = Image.new("RGBA", (w * 2, h * 2), (0, 0, 0, 0))
    dst = out.load()

    def at(x, y):
        x = min(max(x, 0), w - 1)
        y = min(max(y, 0), h - 1)
        return src[x, y]

    for y in range(h):
        for x in range(w):
            p = src[x, y]
            a, b, c, d = at(x, y - 1), at(x + 1, y), at(x - 1, y), at(x, y + 1)
            e0 = a if (c == a and c != d and a != b) else p
            e1 = b if (a == b and a != c and b != d) else p
            e2 = c if (d == c and d != b and c != a) else p
            e3 = d if (b == d and b != a and d != c) else p
            dst[2 * x, 2 * y] = e0
            dst[2 * x + 1, 2 * y] = e1
            dst[2 * x, 2 * y + 1] = e2
            dst[2 * x + 1, 2 * y + 1] = e3
    return out


def make_doll() -> Image.Image:
    sub = Image.open(SUB).convert("RGBA")
    px = sub.load()
    x0, y0, x1, y1 = EYE_SPARKLE_BOX
    for y in range(sub.height):
        for x in range(sub.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            if (r, g, b) == (248, 248, 248) and x0 <= x < x1 and y0 <= y < y1:
                px[x, y] = (*CYAN_BRIGHT, 255)
                continue
            if (r, g, b) not in DOLL_MAP:
                raise SystemExit(f"unmapped doll colour {(r, g, b)} at {(x, y)}")
            px[x, y] = (*DOLL_MAP[(r, g, b)], 255)
    doll = scale2x(sub)
    draw_grid(doll)
    return doll


N4 = ((1, 0), (-1, 0), (0, 1), (0, -1))
N8 = tuple((dx, dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1) if dx or dy)


def smooth(values: dict, k: int) -> dict:
    """moving average over keys key-k .. key+k that exist"""
    out = {}
    for key in values:
        window = [values[j] for j in range(key - k, key + k + 1) if j in values]
        out[key] = sum(window) / len(window)
    return out


def along(points, y):
    """x of the polyline `points` (sorted by y) at height y, held flat beyond its ends"""
    if y <= points[0][1]:
        return points[0][0]
    for (xa, ya), (xb, yb) in zip(points, points[1:]):
        if ya <= y <= yb:
            return xa + (xb - xa) * (y - ya) / (yb - ya)
    return points[-1][0]


def load_doll_art() -> Image.Image:
    """the user's hand-finished doll (DOLL_ART): 64x64, GTS palette only, fully opaque or fully clear"""
    doll = Image.open(DOLL_ART).convert("RGBA")
    assert doll.size == (64, 64), doll.size
    palette = {OUTLINE, NAVY_DARK, NAVY, NAVY_MID, NAVY_LIGHT, BLUE, CYAN, CYAN_BRIGHT}
    for p in doll.get_flattened_data():
        assert p[3] in (0, 255) and (p[3] == 0 or p[:3] in palette), f"doll art pixel {p} is off the palette"
    return doll


def draw_grid(doll: Image.Image) -> None:
    """GTS grid on the doubled doll that follows the doll's outline and its centre line.

    Each pixel gets two coordinates. u runs across its row: -1 at the left outline, 0 on the centre line
    (GRID_CENTRE: the notch between the ears, then the light seam down the belly), +1 at the right outline.
    v runs down its column: 0 at the top of the head (GRID_EAR_CUT), 1 at the bottom outline. Meridians are the
    level lines of u and parallels the level lines of v, so they bend with the head, belly, feet and tail; the rim is
    a line just inside the outline (u = +-1, v = 0 and 1). A level line is the set of pixels at or above the level
    that have a 4-neighbour below it, which is always an unbroken 8-connected line. Lines are drawn by the GTS rule:
    a 1-px CYAN_BRIGHT core with one darker pixel on each side (BLUE, or NAVY_DARK on the outline side of the rim).
    Lines only stop at the doll's own black lines (which pass over them) and around the face band and eye sparkle.
    """
    px = doll.load()
    w, h = doll.size
    body = {NAVY_DARK, NAVY, NAVY_MID, NAVY_LIGHT, BLUE}

    def solid(x, y):
        return 0 <= x < w and 0 <= y < h and px[x, y][3] > 0

    rows = [y for y in range(h) if any(solid(x, y) for x in range(w))]
    cols = [x for x in range(w) if any(solid(x, y) for y in range(h))]
    left = smooth({y: min(x for x in range(w) if solid(x, y)) + 1 for y in rows}, 2)
    right = smooth({y: max(x for x in range(w) if solid(x, y)) - 1 for y in rows}, 2)
    centre_pts = [(2 * x + 0.5, 2 * y + 0.5) for x, y in GRID_CENTRE]
    mid = {y: along(centre_pts, y) for y in rows}
    top, bottom = {}, {}
    for x in cols:
        ys = [y for y in range(h) if solid(x, y)]
        top[x] = max(min(ys) + 1, GRID_EAR_CUT)
        bottom[x] = max(ys) - 1
    top, bottom = smooth(top, 3), smooth(bottom, 3)

    def u(x, y):
        c = mid[y]
        return (x - c) / max(right[y] - c, 1) if x >= c else (x - c) / max(c - left[y], 1)

    def v(x, y):
        return (y - top[x]) / max(bottom[x] - top[x], 1)

    # the eye sparkle and a 1-px ring around it stay clear
    keep_clear = set()
    sx0, sy0, sx1, sy1 = (2 * q for q in EYE_SPARKLE_BOX)
    for y in range(sy0, sy1):
        for x in range(sx0, sx1):
            if px[x, y][:3] == CYAN_BRIGHT:
                keep_clear.update((x + dx, y + dy) for dx, dy in N8 + ((0, 0),))

    def drawable(x, y):
        return solid(x, y) and px[x, y][:3] in body and (x, y) not in keep_clear

    lines = {}
    band0, band1, band_x = GRID_FACE_BAND
    for y in rows:
        for x in range(w):
            if not drawable(x, y):
                continue
            uu, vv = u(x, y), v(x, y)
            near = [q for q in ((x + dx, y + dy) for dx, dy in N4) if solid(*q)]
            for level, v_from, v_to in GRID_MERIDIANS:
                if v_from <= vv <= v_to and not (band0 < vv < band1 and x <= band_x):
                    if uu >= level and any(u(*q) < level for q in near):
                        lines.setdefault(("u", level), set()).add((x, y))
            for level in GRID_PARALLELS:
                if vv >= level and any(v(*q) < level for q in near):
                    lines.setdefault(("v", level), set()).add((x, y))

    # rim: the first drawable pixels inside the outline. The outline is the edge layer plus any black joined to it;
    # where a black line meets the outline the rim may step in, but never deeper than GRID_RIM_DEPTH.
    edge = {(x, y) for y in range(h) for x in range(w)
            if solid(x, y) and not all(solid(x + dx, y + dy) for dx, dy in N4)}
    outline = set(edge)
    stack = [p for p in edge if px[p][:3] == OUTLINE]
    while stack:
        x, y = stack.pop()
        for dx, dy in N8:
            q = (x + dx, y + dy)
            if q not in outline and solid(*q) and px[q][:3] == OUTLINE:
                outline.add(q)
                stack.append(q)
    depth = {p: 0 for p in edge}
    frontier = list(edge)
    while frontier:
        nxt = []
        for x, y in frontier:
            for dx, dy in N4:
                q = (x + dx, y + dy)
                if solid(*q) and q not in depth:
                    depth[q] = depth[(x, y)] + 1
                    nxt.append(q)
        frontier = nxt
    rim = set()
    for (x, y), d in depth.items():
        if 0 < d <= GRID_RIM_DEPTH and (x, y) not in outline and drawable(x, y):
            if any((x + dx, y + dy) in outline for dx, dy in N4):
                rim.add((x, y))

    # Where the head curves away, a line can run along the rim instead of meeting it, which would make a doubled
    # bright stripe. Each line drops its pixels that touch the rim, except the one that joins it to the rim.
    core = set(rim)
    for pixels in lines.values():
        kept = {p for p in pixels if not any((p[0] + dx, p[1] + dy) in rim for dx, dy in N8)}
        joints = {p for p in pixels - kept if any((p[0] + dx, p[1] + dy) in kept for dx, dy in N8)}
        core |= kept | joints

    side = set()
    for x, y in core:
        side.update(q for q in ((x + dx, y + dy) for dx, dy in N4) if q not in core and drawable(*q))
    for p in side:
        px[p] = (*(NAVY_DARK if p in edge else BLUE), 255)
    for p in core:
        px[p] = (*CYAN_BRIGHT, 255)


def ring_points(cx, cy, rx, ry, tilt_deg, steps=720):
    t = math.radians(tilt_deg)
    for i in range(steps):
        a = 2 * math.pi * i / steps
        ex, ey = rx * math.cos(a), ry * math.sin(a)
        yield a, cx + ex * math.cos(t) - ey * math.sin(t), cy + ex * math.sin(t) + ey * math.cos(t)


def ring_path(cx, cy, rx, ry, tilt):
    """the ring as a closed 1-px path of (pixel, angle): dense samples, repeats dropped, then every L-corner pixel
    (one whose two path neighbours already touch diagonally) removed, so it is a clean unbroken 8-connected line"""
    path = []
    for a, x, y in ring_points(cx, cy, rx, ry, tilt, steps=2880):
        p = (round(x), round(y))
        if not path or path[-1][0] != p:
            path.append((p, a))
    while path[0][0] == path[-1][0]:
        path.pop()
    for (p, _), (q, _) in zip(path, path[1:] + path[:1]):
        assert max(abs(p[0] - q[0]), abs(p[1] - q[1])) == 1, (p, q)
    i = 0
    while i < len(path):
        (ax, ay), (bx, by) = path[i - 1][0], path[(i + 1) % len(path)][0]
        if abs(ax - bx) == 1 and abs(ay - by) == 1:
            del path[i]
            i = max(i - 1, 0)
        else:
            i += 1
    return path


BEADS = {
    # size: (centre on the pixel grid?, [(d^2 limit, colour)...] from the inside out); NAVY rings never cover a ring core
    "small": (True, [(1, CYAN_BRIGHT), (5, CYAN), (9, NAVY)]),  # 3x3 light in a 5x5 glow
    "big": (False, [(7.5, CYAN_BRIGHT), (11, CYAN), (14.5, BLUE), (19, NAVY)]),  # the GTS's ~6x6 lit blobs
}


def bead_pixels(ring_list, front=None):
    """[(x, y, colour)] of every bead (of one half, if front is given), drawn inside out"""
    out = []
    for cx, cy, rx, ry, tilt, bead_angles, size in ring_list:
        snap, layers = BEADS[size]
        for bead in bead_angles:
            a = math.radians(bead)
            if front is not None and (math.sin(a) > 0) != front:
                continue
            bx, by = bead_xy(cx, cy, rx, ry, tilt, a)
            if snap:
                bx, by = round(bx), round(by)
            reach = int(math.sqrt(layers[-1][0])) + 1
            for y in range(int(by) - reach, int(by) + reach + 2):
                for x in range(int(bx) - reach, int(bx) + reach + 2):
                    d2 = (x - bx) ** 2 + (y - by) ** 2
                    for limit, colour in layers:
                        if d2 <= limit:
                            out.append((x, y, colour))
                            break
    return out


def draw_rings(canvas: Image.Image, front: bool, ring_list=None) -> None:
    """one half of every ring (front: the lower half, which faces the viewer) by the GTS rule: a CYAN_BRIGHT core
    with a NAVY pixel on each side, and the beads as lit blobs with a NAVY rim. Sides never cover any ring's core,
    so the halves join without a gap and crossing rings stay whole."""
    ring_list = ring_list or rings()
    px = canvas.load()
    w, h = canvas.size
    every_core, cores = set(), set()
    for cx, cy, rx, ry, tilt, _, _ in ring_list:
        for p, a in ring_path(cx, cy, rx, ry, tilt):
            every_core.add(p)
            if (math.sin(a) > 0) == front:
                cores.add(p)

    def put(p, colour):
        if 0 <= p[0] < w and 0 <= p[1] < h:
            px[p] = (*colour, 255)

    for x, y in cores:
        for dx, dy in N4:
            if (x + dx, y + dy) not in every_core:
                put((x + dx, y + dy), NAVY)
    for p in cores:
        put(p, CYAN_BRIGHT)
    for x, y, colour in bead_pixels(ring_list, front):
        if colour != NAVY or (x, y) not in every_core:
            put((x, y), colour)


def bead_xy(cx, cy, rx, ry, tilt, a):
    t = math.radians(tilt)
    ex, ey = rx * math.cos(a), ry * math.sin(a)
    return cx + ex * math.cos(t) - ey * math.sin(t), cy + ex * math.sin(t) + ey * math.cos(t)


def build() -> Image.Image:
    """the sprite: from the four part images in PARTS_DIR when they are all there (the user may edit them), else
    from scratch (make_parts); --from-scratch forces the latter"""
    parts = None if "--from-scratch" in sys.argv else load_parts()
    return compose(parts or make_parts())


def load_parts():
    paths = {name: os.path.join(PARTS_DIR, name + ".png") for name in PARTS}
    if not all(os.path.exists(p) for p in paths.values()):
        return None
    parts = {}
    for name, path in paths.items():
        im = Image.open(path).convert("RGBA")
        assert im.size == CANVAS, f"{path} is {im.size}, every part must be {CANVAS}"
        assert all(p[3] in (0, 255) for p in im.get_flattened_data()), f"{path} has semi-transparent pixels"
        parts[name] = im
    return parts


def save_parts(parts: dict) -> None:
    os.makedirs(PARTS_DIR, exist_ok=True)
    for name in PARTS:
        path = os.path.join(PARTS_DIR, name + ".png")
        if os.path.exists(path) and "--force" not in sys.argv:
            raise SystemExit(f"{path} exists (it may hold edits); pass --force to overwrite the parts")
    for name in PARTS:
        parts[name].save(os.path.join(PARTS_DIR, name + ".png"))
        print("part", os.path.join(PARTS_DIR, name + ".png"))


def ring_front_pixels(width: int, height: int) -> set:
    """Canvas pixels that belong to the rings' front (lower) halves. The rings image is one picture; this is how
    compose knows which of its pixels go behind the doll and which in front, the same way draw_rings layers them:
    a front core pixel, or a pixel beside one, is front; a back core pixel, or one beside only back cores, is back;
    a bead's pixels follow the bead's half. Anything else (an edit away from the rings) takes the half of the
    nearest core pixel, a tie or a pixel more than 6 px from every ring going to the front."""
    ring_list = rings()
    front_core, back_core = set(), set()
    for cx, cy, rx, ry, tilt, _, _ in ring_list:
        for p, a in ring_path(cx, cy, rx, ry, tilt):
            (front_core if math.sin(a) > 0 else back_core).add(p)
    back_core -= front_core
    bead_half = {(x, y): False for x, y, _ in bead_pixels(ring_list, False)}
    bead_half.update({(x, y): True for x, y, _ in bead_pixels(ring_list, True)})
    front = set()
    for y in range(height):
        for x in range(width):
            p = (x, y)
            if p in bead_half:
                is_front = bead_half[p]
            elif p in front_core or p in back_core:
                is_front = p in front_core
            elif any((x + dx, y + dy) in front_core for dx, dy in N4):
                is_front = True
            elif any((x + dx, y + dy) in back_core for dx, dy in N4):
                is_front = False
            else:
                df = min(((x - qx) ** 2 + (y - qy) ** 2 for qx, qy in front_core), default=1e9)
                db = min(((x - qx) ** 2 + (y - qy) ** 2 for qx, qy in back_core), default=1e9)
                is_front = df <= db or db > 36
            if is_front:
                front.add(p)
    return front


def compose(parts: dict) -> Image.Image:
    """stack the parts, back to front: pedestal, rings behind the doll, doll, rings in front, pc"""
    rings = parts["rings"]
    front = ring_front_pixels(*rings.size)
    back_half, front_half = rings.copy(), rings.copy()
    bpx, fpx = back_half.load(), front_half.load()
    for y in range(rings.height):
        for x in range(rings.width):
            if (x, y) in front:
                bpx[x, y] = (0, 0, 0, 0)
            else:
                fpx[x, y] = (0, 0, 0, 0)
    canvas = Image.new("RGBA", rings.size, (0, 0, 0, 0))
    for layer in (parts["pedestal"], back_half, parts["doll"], front_half, parts["pc"]):
        canvas.alpha_composite(layer)
    return canvas


def remake_part(name: str) -> None:
    """rewrite one part from scratch; the pedestal's tail shadow is fitted to the doll part already on disk"""
    assert name in PARTS, name
    doll_path = os.path.join(PARTS_DIR, "doll.png")
    doll = Image.open(doll_path).convert("RGBA") if name == "pedestal" and os.path.exists(doll_path) else None
    os.makedirs(PARTS_DIR, exist_ok=True)
    make_parts(doll)[name].save(os.path.join(PARTS_DIR, name + ".png"))
    print("remade part", os.path.join(PARTS_DIR, name + ".png"))


def make_parts(doll_layer=None) -> dict:
    """the four parts from scratch, each on the full canvas: the pedestal (with the shadow under the doll's tail),
    the pc, the doll and both rings; doll_layer, if given, stands in for the doll"""
    gts = Image.open(os.path.join(ME, "global_trade_system.png")).convert("RGBA")
    W, H = gts.width, gts.height + EXTRA_TOP
    assert (W, H) == CANVAS
    gpx = gts.load()

    # From the GTS: the computer (its own pixels only), which goes in front of everything, and the pedestal, which
    # goes behind the doll so the doll's feet stand on the plate instead of being cut by it.
    computer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    cpx = computer.load()
    in_computer = computer_mask(gts)
    # the computer stands on the base's front, so it goes down with the base's growth: it keeps the GTS's 5 rows of
    # cone below it instead of floating up the taller front
    for x, y in in_computer:
        cpx[x, y + EXTRA_TOP - LIFT + BASE_GROW[1]] = gpx[x, y]
    pedestal = make_pedestal(gts, in_computer)
    ppx = pedestal.load()

    doll = make_doll() if "--generated-doll" in sys.argv or not os.path.exists(DOLL_ART) else load_doll_art()
    # the 64x64 frame is placed as a whole (not by the doll's own box), so trimming the art never moves it: the
    # generated doll fills DOLL_FRAME_BOX, whose bottom lands on DOLL_FEET_Y and whose height places the rings
    fx0, fy0, fx1, fy1 = DOLL_FRAME_BOX
    dx = (W - (fx1 - fx0)) // 2 - fx0
    dy = DOLL_FEET_Y + EXTRA_TOP - LIFT + DOLL_RING_DROP - fy1
    if doll_layer is None:
        doll_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        doll_layer.alpha_composite(doll, (dx, dy))

    ring_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw_rings(ring_layer, False)
    back_only = ring_layer.copy()
    draw_rings(ring_layer, True)

    # the shadow under the doll's tail belongs to the plate, so it goes into the pedestal part
    seen = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for layer in (pedestal, back_only, doll_layer):
        seen.alpha_composite(layer)
    for p, colour in ground_shadow(seen, doll_layer, pedestal).items():
        ppx[p] = (*colour, 255)
    return {"pedestal": pedestal, "pc": computer, "doll": doll_layer, "rings": ring_layer}


def make_pedestal(gts: Image.Image, in_computer: set) -> Image.Image:
    """The GTS pedestal with the globe gone and nothing missing: the grey cone, with the hole behind the computer
    filled in (its shaded left half and lit right half meeting at CONE_SPLIT), and on top the dark plate as a whole
    ellipse (PLATE) like the GTS's: its back rim and sides in the pedestal's outline colour, as where the GTS shows
    them, its front lip dark, and inside navy, lit along the front (NAVY on the left, the GTS's plate blue on the
    right) and along the right inner rim."""
    gpx = gts.load()
    W, H = CANVAS
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    opx = out.load()

    def plate_at(spec):
        pcx, pcy, prx, pry_back, pry_front = spec

        def inside(x, y):
            dy = y + 0.5 - pcy
            return ((x + 0.5 - pcx) / prx) ** 2 + (dy / (pry_front if dy > 0 else pry_back)) ** 2 <= 1
        return inside

    def front_edges(inside):
        edges = {}
        for x in range(W):
            rows = [y for y in range(H) if inside(x, y)]
            if rows:
                edges[x] = max(rows)
        return edges

    # the GTS's cone: between the pedestal's outline pixels in each row, below the GTS's own plate (PLATE)
    gts_plate = plate_at(PLATE)
    gts_front = front_edges(gts_plate)
    cone = {}
    for y in range(PEDESTAL_TOP, gts.height):
        rim = [x for x in range(gts.width) if gpx[x, y][3] and gpx[x, y][:3] == PEDESTAL_OUTLINE]
        if not rim:
            continue
        for x in range(min(rim), max(rim) + 1):
            if gts_plate(x, y):
                continue
            p = gpx[x, y]
            keep = p[3] and (p[:3] in CONE_COLOURS or p[:3] == PEDESTAL_OUTLINE) and (x, y) not in in_computer
            if keep:
                colour = p[:3]
            else:  # behind the computer, or a globe/ring leftover below the plate
                below = y - gts_front.get(x, y)
                if x < CONE_SPLIT:
                    colour = CONE_SHADE_TOP if below <= 3 else CONE_SHADE
                elif x == CONE_SPLIT:
                    colour = CONE_SEAM
                else:
                    colour = CONE_SHADE if below <= 2 else CONE_LIT
            cone[(x, y)] = colour

    # Grow the plate (PLATE_GROW) and the base (BASE_GROW). The cone widens first: its left half moves left and its
    # right half right by BASE_GROW[0], the columns beside CONE_SPLIT (behind the computer) repeated to fill the
    # middle. Then every column is moved and stretched (nearest row) from its old span to its new one: from just under
    # the grown plate's front lip down to the old bottom pushed down by the base's growth there (the full amount
    # mid-front, tapering to nothing at the far sides).
    cx, cy, rx, ry_back, ry_front = PLATE
    gx, gy = PLATE_GROW
    plate = plate_at((cx, cy, rx + gx, ry_back + gy, ry_front + gy))
    new_front = front_edges(plate)
    bx, by = BASE_GROW
    old_cols = {x for x, _ in cone}

    def old_column(x):
        if x <= CONE_SPLIT - 1 - bx:
            return x + bx
        if x < CONE_SPLIT:
            return CONE_SPLIT - 1
        if x == CONE_SPLIT:
            return CONE_SPLIT
        if x <= CONE_SPLIT + bx:
            return CONE_SPLIT + 1
        return x - bx

    for x in range(W):
        ox = old_column(x)
        if ox not in old_cols:
            continue
        rows = sorted(y for xx, y in cone if xx == ox)
        t0, b0 = rows[0], rows[-1]
        u = (x + 0.5 - cx) / (BASE_RX + bx)
        b1 = b0 + round(by * math.sqrt(max(0.0, 1 - u * u)))
        t1 = new_front[x] + 1 if x in new_front else t0
        for y in range(t1, b1 + 1):
            src = t0 + round((y - t1) * (b0 - t0) / (b1 - t1)) if b1 > t1 else t0
            if (ox, src) in cone:
                opx[x, y + EXTRA_TOP - LIFT] = (*cone[(ox, src)], 255)
    front_edge = new_front
    rx += gx

    # the plate
    cells = {(x, y) for y in range(H) for x in range(W) if plate(x, y)}
    edge = {(x, y) for x, y in cells if any((x + dx, y + dy) not in cells for dx, dy in N4)}
    for x, y in cells:
        if (x, y) in edge:
            colour = PEDESTAL_OUTLINE if y + 0.5 <= cy + 1 else NAVY_DARK
        elif front_edge.get(x, -9) - y <= 2:
            colour = NAVY if x + 0.5 < cx else PLATE_BLUE
        elif x + 0.5 > cx + rx / 2 and any((x + dx, y + dy) in edge for dx, dy in N8):
            colour = PLATE_BLUE
        else:
            colour = NAVY_DARK
        opx[x, y + EXTRA_TOP - LIFT] = (*colour, 255)
    return out


def ground_shadow(seen: Image.Image, doll: Image.Image, pedestal: Image.Image) -> dict:
    """Close the thin gap between the doll's underside (its raised tail on the right) and the plate, which made the
    doll look like it floats: in every column where the gap is 1..GROUND_GAP_MAX px, the clear pixels between the doll
    and the plate become plate-dark NAVY_DARK, a shadow on the plate; fill pixels that face open air on the side get
    the pedestal's outline colour so the silhouette stays closed. `seen` is what is drawn so far; returns the fill."""
    spx, dpx, ppx = seen.load(), doll.load(), pedestal.load()
    W, H = seen.size
    filled = {}
    for x in range(W):
        doll_ys = [y for y in range(H) if dpx[x, y][3]]
        plate_ys = [y for y in range(H) if ppx[x, y][3]]
        if not doll_ys or not plate_ys:
            continue
        bottom, top = max(doll_ys), min(plate_ys)
        if 1 <= top - bottom - 1 <= GROUND_GAP_MAX:
            for y in range(bottom + 1, top):
                if spx[x, y][3] == 0:
                    filled[(x, y)] = NAVY_DARK
    for x, y in filled:
        if any(not (0 <= x + ddx < W) or (spx[x + ddx, y][3] == 0 and (x + ddx, y) not in filled) for ddx in (-1, 1)):
            filled[(x, y)] = PEDESTAL_OUTLINE
    return filled


def computer_mask(gts: Image.Image) -> set:
    """the GTS computer's own pixels: its black outline and everything inside it. The area around COMPUTER is
    flooded from its edge through non-black pixels (4-connected, so the outline's diagonal steps hold the flood);
    whatever the flood cannot reach is the computer."""
    px = gts.load()
    x0, y0 = max(COMPUTER[0] - 2, 0), max(COMPUTER[1] - 2, 0)
    x1, y1 = min(COMPUTER[2] + 2, gts.width), min(COMPUTER[3] + 2, gts.height)
    area = {(x, y) for y in range(y0, y1) for x in range(x0, x1)}
    black = {p for p in area if px[p][3] and px[p][:3] == OUTLINE}
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
    assert (min(xs), min(ys), max(xs), max(ys)) == (26, 51, 44, 71), (min(xs), min(ys), max(xs), max(ys))
    return mask


def to_palette_png(im: Image.Image, path: str) -> None:
    colours = sorted({p[:3] for p in im.get_flattened_data() if p[3] > 0})
    assert len(colours) < 256
    index = {c: i + 1 for i, c in enumerate(colours)}
    pal = Image.new("P", im.size, 0)
    pal.putpalette([0, 0, 0] + [v for c in colours for v in c])
    pp, px = pal.load(), im.load()
    for y in range(im.height):
        for x in range(im.width):
            if px[x, y][3] > 0:
                pp[x, y] = index[px[x, y][:3]]
    pal.save(path, transparency=0, optimize=True)


def install(im: Image.Image) -> None:
    to_palette_png(im, os.path.join(ME, NAME + ".png"))
    data = json.loads(open(os.path.join(ME, "global_trade_system.json"), encoding="utf-8").read())
    tex = data["textures"][0]
    tex["image"] = NAME + ".png"
    tex["size"] = {"w": im.width, "h": im.height}
    frame = tex["frames"][0]
    frame["sourceSize"] = {"w": im.width, "h": im.height}
    frame["spriteSourceSize"] = {"x": 0, "y": 0, "w": im.width, "h": im.height}
    frame["frame"] = {"x": 0, "y": 0, "w": im.width, "h": im.height}
    text = json.dumps(data, indent="\t", ensure_ascii=False).replace("\n", "\r\n")
    open(os.path.join(ME, NAME + ".json"), "w", encoding="utf-8", newline="").write(text)
    print("installed", NAME, im.size)


if __name__ == "__main__":
    if "--split-parts" in sys.argv:
        save_parts(make_parts())
    if "--remake-part" in sys.argv:
        remake_part(sys.argv[sys.argv.index("--remake-part") + 1])
    image = build()
    if "--preview" in sys.argv:
        out = sys.argv[sys.argv.index("--preview") + 1]
        gts = Image.open(os.path.join(ME, "global_trade_system.png")).convert("RGBA")
        sheet = Image.new("RGBA", (gts.width + image.width + 12, image.height), (60, 70, 90, 255))
        sheet.alpha_composite(gts, (0, image.height - gts.height))
        sheet.alpha_composite(image, (gts.width + 12, 0))
        sheet.resize((sheet.width * 5, sheet.height * 5), Image.NEAREST).save(out)
        print("preview", out, image.size)
    if "--install" in sys.argv:
        install(image)
    if "--export-doll" in sys.argv:
        out = sys.argv[sys.argv.index("--export-doll") + 1]
        use_art = "--generated-doll" not in sys.argv and os.path.exists(DOLL_ART)
        (load_doll_art() if use_art else make_doll()).save(out)
        print("doll", out)
