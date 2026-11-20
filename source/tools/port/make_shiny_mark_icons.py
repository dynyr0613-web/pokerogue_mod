"""Build the three shiny mark icons (ribbonmarkshiny{yellow,mint,red}.png, 40x40) from PokeRogue's Shiny Charm item icon
(2026-11-18, the user: "저 하늘색 부적 사진 기준으로 색변환해서 아이콘을 새로 만들어도 됩니다. 초록색 부분은 다른
아이콘들도 저 부분의 색이 다르게 하면 좋겠군요").

What the script runs (build_exact()):
1. The charm (frame "shiny_charm" of images/items.png, 19x22 drawn) grows about 15% to 22x25 without scaling (the user:
   "살짝만 키우죠, 15% 정도만"): three of its columns and three of its rows are drawn twice (DOUBLE_COLUMNS /
   DOUBLE_ROWS, see grow()), so its proportions stay. It is centred in the 40x40 cell, the size of the other mark icons.
2. The outlines the doubling left 2 px thick are thinned back to 1 px (see thin()): an outer black pixel that touches
   no colour and whose removal keeps the line connected goes; a 2x2 black block with colour on both sides gives one of
   its columns (or rows) to the colour beside it.
3. Each of the charm's colours is recoloured by its role: the star's four blues/cyans and the charm's blue to the tier's
   hue (spread a little, as in the original), the two greens of the small sparkles to the tier's two ACCENTS colours,
   the outline and white unchanged.

build() is the first version (the charm scaled 1.5x, nearest, to 28x33 at (6, 3), the sparkles to an accent hue); it
is kept but no longer run. (Comment corrected 2026-11-20: it used to describe only that first version.)

usage: py make_shiny_mark_icons.py <items atlas folder: .../images> <out folder>
"""
import colorsys
import json
import sys
from pathlib import Path

from PIL import Image

BLACK = (32, 32, 32)
WHITE = (255, 255, 255)
STAR_HUE = 197  # the charm's main cyan
GREEN_HUE = 90  # its light green
# tier: (star hue, accent hue)
TIERS = {
    "yellow": (49, 330),
    "mint": (158, 55),
    "red": (0, 270),
}
# 2026-11-18, the user: "보조색은 노란색에 진한 파란색, 민트색에 채도가 낮은 밝은 하늘색, 붉은색에 약간 칙칙한 느낌의
# 남색/검은색 사이의 색": the small sparkles' two greens (light, dark) become these
ACCENTS = {
    "yellow": ((70, 98, 214), (40, 62, 168)),
    "mint": ((190, 222, 238), (146, 186, 210)),
    "red": ((74, 78, 112), (50, 52, 80)),
}
LIGHT_GREEN, GREEN = (172, 234, 110), (101, 202, 82)
SIZE, CELL, AT = (28, 33), 40, (6, 3)


def load_charm(images: Path) -> Image.Image:
    atlas = json.loads((images / "items.json").read_text(encoding="utf-8"))
    frame = next(f for t in atlas["textures"] for f in t["frames"] if f["filename"] == "shiny_charm")
    sheet = Image.open(images / atlas["textures"][0]["image"]).convert("RGBA")
    r = frame["frame"]
    charm = sheet.crop((r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"]))
    return charm.crop(charm.getbbox())


def kind(px, p):
    c = px.get(p)
    if c is None or c[3] < 128:
        return "t"
    return "b" if c[:3] == BLACK else "c"


N4 = [(1, 0), (-1, 0), (0, 1), (0, -1)]
N8 = [(-1, -1), (0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0)]


def simple(px, p) -> bool:
    nb = [(p[0] + dx, p[1] + dy) for dx, dy in N8 if kind(px, (p[0] + dx, p[1] + dy)) == "b"]
    if not nb:
        return False
    seen, stack = {nb[0]}, [nb[0]]
    while stack:
        q = stack.pop()
        for dx, dy in N8:
            r = (q[0] + dx, q[1] + dy)
            if r in nb and r not in seen:
                seen.add(r)
                stack.append(r)
    return len(seen) == len(nb)


def thin(img: Image.Image) -> Image.Image:
    W, H = img.size
    px = {(x, y): img.getpixel((x, y)) for y in range(H) for x in range(W)}
    changed = True
    while changed:
        changed = False
        for y in range(H):
            for x in range(W):
                p = (x, y)
                if kind(px, p) != "b":
                    continue
                if not any(kind(px, (x + dx, y + dy)) == "t" for dx, dy in N4):
                    continue
                if any(kind(px, (x + dx, y + dy)) == "c" for dx, dy in N8):
                    continue
                if sum(kind(px, (x + dx, y + dy)) == "b" for dx, dy in N8) < 2 or not simple(px, p):
                    continue
                px[p] = (0, 0, 0, 0)
                changed = True
    # 2x2 black blocks between colours: the left column (or top row) takes the colour beside it
    for y in range(H - 1):
        for x in range(W - 1):
            block = [(x, y), (x + 1, y), (x, y + 1), (x + 1, y + 1)]
            if not all(kind(px, p) == "b" for p in block):
                continue
            left, right = [(x - 1, y), (x - 1, y + 1)], [(x + 2, y), (x + 2, y + 1)]
            above, below = [(x, y - 1), (x + 1, y - 1)], [(x, y + 2), (x + 1, y + 2)]
            if all(kind(px, p) == "c" for p in left + right):
                px[(x, y)], px[(x, y + 1)] = px[left[0]], px[left[1]]
            elif all(kind(px, p) == "c" for p in above + below):
                px[(x, y)], px[(x + 1, y)] = px[above[0]], px[above[1]]
    out = Image.new("RGBA", (W, H))
    for p, c in px.items():
        out.putpixel(p, c)
    return out


def recolour(rgb, star_hue: float, accent_hue: float):
    if rgb in (BLACK, WHITE):
        return rgb
    h, l, s = colorsys.rgb_to_hls(*(v / 255 for v in rgb))
    h *= 360
    if 60 <= h <= 150:  # the greens of the small sparkles
        nh = accent_hue + (h - GREEN_HUE) * 0.5
    else:  # the star and the charm: the tier's hue, the original spread narrowed
        nh = star_hue + (h - STAR_HUE) * 0.4
    r, g, b = colorsys.hls_to_rgb((nh % 360) / 360, l, s)
    return (round(r * 255), round(g * 255), round(b * 255))


# 2026-11-18, the user: "살짝만 키우죠, 15% 정도만": 19x22 -> 22x25, three columns and three rows drawn twice
GROW = 0.15


def line_cost(img: Image.Image, index: int, columns: bool) -> int:
    """How much doubling this column (or row) changes the drawing: its black pixels that are part of a line across
    it (doubling them makes the line 2 px thick) and its single-pixel colour details."""
    W, H = img.size
    cost = 0
    n = H if columns else W
    for k in range(n):
        p = (index, k) if columns else (k, index)
        a, b = ((index - 1, k), (index + 1, k)) if columns else ((k, index - 1), (k, index + 1))
        c = img.getpixel(p)
        if c[3] < 128:
            continue
        same = lambda q: 0 <= q[0] < W and 0 <= q[1] < H and img.getpixel(q)[:3] == c[:3] and img.getpixel(q)[3] >= 128
        if c[:3] in (LIGHT_GREEN, GREEN, WHITE):
            cost += 5  # the small sparkles and the highlights: doubled they look much bigger
        elif not same(a) and not same(b):
            cost += 3 if c[:3] == BLACK else 1
    return cost


def pick(img: Image.Image, count: int, columns: bool) -> list[int]:
    """The columns (or rows) to double: one in each of `count` equal bands, so the drawing grows evenly and keeps its
    proportions, and in each band the one whose doubling changes the least (`line_cost`), nearest the band's middle."""
    n = img.size[0] if columns else img.size[1]
    chosen: list[int] = []
    for b in range(count):
        lo, hi = round(b * n / count), round((b + 1) * n / count)
        mid = (lo + hi - 1) / 2
        band = [i for i in range(max(lo, 1), min(hi, n - 1))]
        chosen.append(min(band, key=lambda i: (line_cost(img, i, columns), abs(i - mid))))
    return chosen


# The rows and columns doubled, in the charm's own 19x22 pixels. The star's centre is (11, 12) and its arms reach the
# outline at columns 5 / 17 and rows 6 / 18: one column in each side arm (6, 16) and one row in each of the top and bottom
# arms (7, 17) keep the four arms the same length (the user: "별 모양 자체는 또 아래쪽만 한칸이 짧네요"; doubling the
# bottom outline row 18 had made that tip's outline 2 px, and taking it off the arm 1 px short). Column 2 (the charm's
# body) and row 3 (the chain) are the third. None crosses the small sparkles or the white highlights.
DOUBLE_COLUMNS = [2, 6, 16]
DOUBLE_ROWS = [3, 7, 17]


def grow(img: Image.Image) -> Image.Image:
    W, H = img.size
    cols, rows = DOUBLE_COLUMNS, DOUBLE_ROWS
    xs = [x for x in range(W) for _ in range(2 if x in cols else 1)]
    ys = [y for y in range(H) for _ in range(2 if y in rows else 1)]
    out = Image.new("RGBA", (len(xs), len(ys)), (0, 0, 0, 0))
    for ny, y in enumerate(ys):
        for nx, x in enumerate(xs):
            out.putpixel((nx, ny), img.getpixel((x, y)))
    print("doubled columns", cols, "rows", rows, "->", out.size)
    return out


def build_exact(images: Path, out_dir: Path) -> dict[str, Image.Image]:
    """The charm as it is drawn (no scaling, so its proportions stay), centred in the 40x40 cell and recoloured: the
    star and the charm to the tier's hue, the small sparkles to ACCENTS."""
    # the doubled rows and columns leave a few outlines 2 px thick (the charm body's top edge through row 17): thinned
    # back to 1 px where they touch no colour, as in thin()
    charm = thin(grow(load_charm(images)))
    made = {}
    for name, (star, _accent) in TIERS.items():
        img = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
        img.alpha_composite(charm, ((CELL - charm.width) // 2, (CELL - charm.height) // 2))
        light, dark = ACCENTS[name]
        for y in range(CELL):
            for x in range(CELL):
                c = img.getpixel((x, y))
                if c[3] < 128:
                    continue
                rgb = c[:3]
                new = light if rgb == LIGHT_GREEN else dark if rgb == GREEN else recolour(rgb, star, 0)
                img.putpixel((x, y), (*new, 255))
        out_dir.mkdir(parents=True, exist_ok=True)
        img.save(out_dir / f"ribbonmarkshiny{name}.png")
        made[name] = img
    return made


def build(images: Path, out_dir: Path, tiers=TIERS) -> dict[str, Image.Image]:
    charm = load_charm(images)
    up = charm.resize(SIZE, Image.NEAREST)
    cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    cell.alpha_composite(up, AT)
    base = thin(cell)
    made = {}
    for name, (star, accent) in tiers.items():
        img = base.copy()
        for y in range(CELL):
            for x in range(CELL):
                c = img.getpixel((x, y))
                if c[3] >= 128:
                    img.putpixel((x, y), (*recolour(c[:3], star, accent), 255))
        out_dir.mkdir(parents=True, exist_ok=True)
        img.save(out_dir / f"ribbonmarkshiny{name}.png")
        made[name] = img
    return made


if __name__ == "__main__":
    build_exact(Path(sys.argv[1]), Path(sys.argv[2]))
    print("ok")
