"""Clean the mark and ribbon icons into plain pixel art (2026-11-18, the user: "증표 아이콘들이 애매한 색(예를 들어 …
우두머리 증표는 흰색/빨간색 중간 색들이 좀 있다)들이 좀 있거든요, 그것들도 대대적으로 수정해보죠. 도트 스프라이트에서
굳이 그런 애매한 색을 쓸 이유는 없으니까요").

PKHeX's ribbon and mark sprites are small renders: soft (semi-transparent) edges, anti-aliasing between areas (a pink
ring between a white outline and a red body) and smooth, slightly noisy gradients: a few hundred colours in a 40x40
icon. For each icon:
1. Hard edges: a pixel is either opaque (alpha >= ALPHA_CUT) or transparent.
2. The render's noise is smoothed first (each pixel averaged with the neighbours of nearly the same colour, so edges
   stay), in CIE Lab.
3. A small palette: k-means on the smoothed pixels, K the smallest that keeps the drawing (mean error <= MEAN_DE, and at
   most BAD_MAX pixels that fit no palette colour), each palette entry a real colour of the icon (the one nearest its
   cluster's centre, no averaged, muddy colours); near-duplicates (white and an off-white) merged, and a colour that only
   sits between two others (an anti-aliasing step) dropped.
4. Each pixel to its palette colour; a pixel between two palette colours of its neighbours (anti-aliasing) or at the
   edge (mixed with the background) goes to the nearer neighbouring colour.
5. Stray single pixels left by the gradients take the colour around them, when that colour is close to theirs.
Icons that are already plain pixel art (few colours, hard edges) come out unchanged.

usage: py clean_mark_icons.py <in dir> <out dir> [names...]      (sheets: <out dir>/_compare_*.png)
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ALPHA_CUT = 128
SMOOTH_DE = 9.0  # neighbours this close in colour are averaged together
MEAN_DE = 3.0
MAX_DE = 6.0
BAD_MAX = 2
MAX_K = 20
MERGE_DE = 3.5
BLEND_DE = 5.0
BLEND_SHARE = 0.12
SPECK_DE = 14.0
PLAIN_MAX = 16  # an icon with hard edges and at most this many colours is already plain pixel art
# per-icon overrides, by file name: {"MEAN_DE": ..., "MAX_DE": ..., "SMOOTH_DE": ..., "SPECK_DE": ..., "K": fixed
# palette size}, "EXTRA": [[r, g, b], ...] colours to keep,
# "POSTER": {"y_from": row, "levels": [[brightness limit, [r, g, b]], ...]} grey steps for a subtle grey drawing; {"KEEP": True} leaves an icon as it is. Chosen icon by icon on 2026-11-18 by comparing zoomed results
# (D:/PokeRogueDev/import_mod_20261117/mark_clean_tune.txt has the reasons)
OVERRIDES: dict[str, dict] = {
    "ribbonchampionalola.png": {"K": 5, "SMOOTH_DE": 15, "SPECK_DE": 45},
    "ribbonchampiong3.png": {"K": 7},
    "ribbonchampiong6hoenn.png": {"K": 7, "SMOOTH_DE": 15, "SPECK_DE": 45},
    "ribbonchampiongalar.png": {"K": 7},
    "ribbonchampionkalos.png": {"K": 8, "SMOOTH_DE": 20},
    "ribbonchampionpaldea.png": {"SMOOTH_DE": 6, "SPECK_DE": 45},
    "ribbonchampionsinnoh.png": {"SMOOTH_DE": 6, "SPECK_DE": 45},
    "ribboneffortatk.png": {"K": 10},
    "ribboneffortdef.png": {"K": 11},
    "ribbonefforthp.png": {"K": 10, "SMOOTH_DE": 12},
    "ribboneffortspatk.png": {"SMOOTH_DE": 13},
    "ribboneffortspd.png": {"SMOOTH_DE": 13},
    "ribbonfootprint.png": {"SPECK_DE": 70},
    "ribbonfootprintgrand.png": {"SPECK_DE": 70},
    "ribbonhisui.png": {"SMOOTH_DE": 30, "K": 5, "POSTER": {"y_from": 19, "levels": [[163, [146, 143, 143]], [196, [176, 172, 172]], [999, [212, 208, 206]]]}},
    "ribbonlegend.png": {"SMOOTH_DE": 6},
    "ribbonmarkabsentminded.png": {"K": 2},
    "ribbonmarkalpha.png": {"K": 2, "SMOOTH_DE": 20},
    "ribbonmarkalphagold.png": {"K": 2},
    "ribbonmarkangry.png": {"K": 2},
    "ribbonmarkblizzard.png": {"K": 2},
    "ribbonmarkcalmness.png": {"K": 4, "SMOOTH_DE": 16},
    "ribbonmarkcharismatic.png": {"K": 3, "SMOOTH_DE": 23},
    "ribbonmarkcrafty.png": {"K": 7},
    "ribbonmarkdry.png": {"K": 2},
    "ribbonmarkexcited.png": {"K": 4},
    "ribbonmarkferocious.png": {"K": 5, "SMOOTH_DE": 40},
    "ribbonmarkflustered.png": {"K": 2, "SMOOTH_DE": 34},
    "ribbonmarkgourmand.png": {"K": 4},
    "ribbonmarkhumble.png": {"K": 10, "SMOOTH_DE": 26},
    "ribbonmarkintellectual.png": {"K": 4, "SMOOTH_DE": 18},
    "ribbonmarkintense.png": {"K": 2},
    "ribbonmarkitemfinder.png": {"K": 2},
    "ribbonmarkjittery.png": {"K": 4},
    "ribbonmarkjumbo.png": {"K": 3, "SMOOTH_DE": 5},
    "ribbonmarkkindly.png": {"K": 2},
    "ribbonmarklunchtime.png": {"K": 3, "SMOOTH_DE": 14},
    "ribbonmarkmightiest.png": {"K": 2},
    "ribbonmarkmisty.png": {"K": 4, "SMOOTH_DE": 18},
    "ribbonmarkpartner.png": {"K": 4, "SMOOTH_DE": 14},
    "ribbonmarkpeeved.png": {"K": 2, "SMOOTH_DE": 36},
    "ribbonmarkprideful.png": {"K": 4},
    "ribbonmarkpumpedup.png": {"K": 2},
    "ribbonmarkrainy.png": {"K": 2},
    "ribbonmarkrare.png": {"SMOOTH_DE": 16},
    "ribbonmarkrowdy.png": {"K": 4},
    "ribbonmarksandstorm.png": {"K": 2, "SMOOTH_DE": 28},
    "ribbonmarkscowling.png": {"K": 2},
    "ribbonmarkslump.png": {"K": 2, "SMOOTH_DE": 22},
    "ribbonmarksmiley.png": {"SMOOTH_DE": 6},
    "ribbonmarksnowy.png": {"K": 2},
    "ribbonmarkstormy.png": {"K": 4},
    "ribbonmarkunsure.png": {"K": 2},
    "ribbonmarkupbeat.png": {"K": 3},
    "ribbonmarkvigor.png": {"K": 2},
    "ribbonmarkzeroenergy.png": {"SMOOTH_DE": 20},
    "ribbonmarkzonedout.png": {"K": 2},
    "ribbonmasterrank.png": {"K": 9, "SMOOTH_DE": 6},
    "ribbontowermaster.png": {"K": 10},
}
# pixels set by hand after the cleaning, by file name: (x, y) -> (r, g, b) or None for transparent
_W, _B = (255, 255, 255), (173, 104, 40)
PATCHES: dict[str, dict[tuple[int, int], tuple[int, int, int] | None]] = {
    # the Uncommon Mark's three cats: the original's eyes sit between pixels and came out uneven (slanted on the top
    # cat, mismatched on the two below); each eye made a 1x3 bar, the pair symmetric on its face
    "ribbonmarkuncommon.png": {
        **{(17, y): _W for y in (12, 13, 14)},
        **{(18, y): _B for y in (12, 13, 14)},
        **{(21, y): _B for y in (12, 13, 14)},
        **{(22, y): _W for y in (12, 13, 14)},
        (8, 26): _W,
        **{(8, y): _B for y in (27, 28, 29)},
        **{(12, y): _B for y in (27, 28, 29)},
        (13, 27): _W,
        (13, 28): _W,
        (26, 27): _W,
        (26, 28): _W,
        **{(27, y): _B for y in (27, 28, 29)},
        (31, 26): _W,
        **{(31, y): _B for y in (27, 28, 29)},
    },
}
# The marks (ribbonmark*) are stickers with a soft grey drop shadow below and to the right: its semi-transparent grey
# pixels at the outer edge are not part of the drawing and go before anything else
SHADOW_PREFIX = "ribbonmark"
# a light, almost neutral colour (Lab L >= WHITE_L, chroma <= WHITE_C) is the icon's white: made plain white, the same
# in every icon (the renders' whites are tinted by their surroundings: #faebef on a red mark)
WHITE_L, WHITE_C = 92.0, 9.0
WHITE = (255, 255, 255)

N8 = [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)]


def srgb_to_lab(c):
    def lin(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

    r, g, b = (lin(v) for v in c)
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883

    def f(t):
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116

    fx, fy, fz = f(x), f(y), f(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def de(a, b):
    return math.dist(a, b)


def smooth(lab: dict) -> dict:
    out = {}
    for (x, y), L in lab.items():
        acc, w = [0.0, 0.0, 0.0], 0.0
        for dx, dy in [(0, 0)] + N8:
            q = lab.get((x + dx, y + dy))
            if q is None:
                continue
            d = de(L, q)
            if d > SMOOTH_DE:
                continue
            k = 2.0 if (dx, dy) == (0, 0) else 1.0
            for i in range(3):
                acc[i] += q[i] * k
            w += k
        out[(x, y)] = tuple(v / w for v in acc)
    return out


def kmeans(points: list, k: int) -> list:
    """Plain k-means on the smoothed pixel colours; deterministic farthest-point start."""
    # start from the colour with the most near neighbours, then the farthest ones
    centres = [max(points[:: max(1, len(points) // 200)], key=lambda p: sum(de(p, q) < 6 for q in points[::4]))]
    while len(centres) < k:
        centres.append(max(points, key=lambda p: min(de(p, c) for c in centres)))
    for _ in range(20):
        groups = [[] for _ in centres]
        for p in points:
            groups[min(range(len(centres)), key=lambda j: de(p, centres[j]))].append(p)
        new = [tuple(sum(p[d] for p in g) / len(g) for d in range(3)) if g else c for g, c in zip(groups, centres)]
        if new == centres:
            break
        centres = new
    return centres


def blend_end(P, A, B):
    """If Lab colour P lies between A and B (an anti-aliasing step), the nearer of the two, else None."""
    ab = [B[d] - A[d] for d in range(3)]
    n2 = sum(v * v for v in ab)
    if n2 == 0:
        return None
    t = sum((P[d] - A[d]) * ab[d] for d in range(3)) / n2
    if not 0.0 < t < 1.0:
        return None
    proj = [A[d] + t * ab[d] for d in range(3)]
    if de(P, proj) > BLEND_DE:
        return None
    return A if t < 0.5 else B


def tidy_palette(palette: list, use: dict) -> list:
    """Merge near-duplicates (keeping the more used) and drop colours that only sit between two others."""
    keep: list = []
    for p in sorted(palette, key=lambda q: -use.get(q, 0)):
        if all(de(p, q) > MERGE_DE for q in keep):
            keep.append(p)
    total = sum(use.values()) or 1
    changed = True
    while changed and len(keep) > 2:
        changed = False
        for p in sorted(keep, key=lambda q: use.get(q, 0)):
            if use.get(p, 0) / total > BLEND_SHARE:
                continue
            others = [q for q in keep if q != p]
            if any(blend_end(p, a, b) is not None for a in others for b in others if a < b):
                keep = others
                changed = True
                break
    return keep


def map_pixels(sm: dict, palette: list) -> tuple[dict, float, int]:
    near = {pos: min(palette, key=lambda q: de(L, q)) for pos, L in sm.items()}
    out, total, n, bad = {}, 0.0, 0, 0
    for (x, y), q in near.items():
        L = sm[(x, y)]
        e = de(L, q)
        if e <= MAX_DE:
            out[(x, y)] = q
            total += e
            n += 1
            continue
        around = {near[(x + dx, y + dy)] for dx, dy in N8 if (x + dx, y + dy) in near} | {q}
        if any((x + dx, y + dy) not in near for dx, dy in N8):
            out[(x, y)] = min(around, key=lambda c: de(L, c))  # an edge pixel mixed with the background
            continue
        end = None
        for A in around:
            for B in around:
                if A < B:
                    end = blend_end(L, A, B) or end
        if end is None:
            bad += 1
            out[(x, y)] = q
        else:
            out[(x, y)] = end
    return out, (total / n if n else 0.0), bad


def despeckle(mapped: dict, sm: dict) -> dict:
    out = dict(mapped)
    for (x, y), q in mapped.items():
        nb = [mapped[(x + dx, y + dy)] for dx, dy in N8 if (x + dx, y + dy) in mapped]
        if len(nb) < 8 or q in nb:
            continue
        m = max(set(nb), key=nb.count)
        if nb.count(m) >= 5 and de(sm[(x, y)], m) <= SPECK_DE:
            out[(x, y)] = m
    return out


def drop_shadow(img: Image.Image, rgb: dict) -> dict:
    """The marks' drop shadow: semi-transparent (alpha < 250), nearly neutral, mid-dark pixels at the outer edge, peeled
    off from the outside in (it is up to 2 px wide)."""
    rgb = dict(rgb)
    for _ in range(3):
        gone = []
        for (x, y), c in rgb.items():
            if img.getpixel((x, y))[3] >= 250:
                continue
            L, a, b = srgb_to_lab(c)
            if not (15 <= L <= 82 and math.hypot(a, b) <= 12):
                continue
            if any((x + dx, y + dy) not in rgb for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                gone.append((x, y))
        if not gone:
            break
        for p in gone:
            del rgb[p]
    return rgb


def clean(img: Image.Image, name: str = "") -> tuple[Image.Image, int, int]:
    """(cleaned icon, colours before, colours after)."""
    global MEAN_DE, MAX_DE, SMOOTH_DE, SPECK_DE
    img = img.convert("RGBA")
    W, H = img.size
    rgb = {}
    for y in range(H):
        for x in range(W):
            p = img.getpixel((x, y))
            if p[3] >= ALPHA_CUT:
                rgb[(x, y)] = p[:3]
    if not rgb:
        return img, 0, 0
    if name.startswith(SHADOW_PREFIX):
        rgb = drop_shadow(img, rgb)
    lab_cache = {c: srgb_to_lab(c) for c in set(rgb.values())}
    lab = {pos: lab_cache[c] for pos, c in rgb.items()}
    before = len(lab_cache)
    ov = OVERRIDES.get(name, {})
    # already plain pixel art (hard edges and few colours: the Gen 4 ribbons, the icons made from item sprites, the
    # shiny marks) is left exactly as it is
    plain = all(p[3] in (0, 255) for p in img.get_flattened_data()) and before <= PLAIN_MAX
    if ov.get("KEEP") or (plain and not ov):
        return img, before, before
    saved = (MEAN_DE, MAX_DE, SMOOTH_DE, SPECK_DE)
    MEAN_DE, MAX_DE = ov.get("MEAN_DE", MEAN_DE), ov.get("MAX_DE", MAX_DE)
    SMOOTH_DE, SPECK_DE = ov.get("SMOOTH_DE", SMOOTH_DE), ov.get("SPECK_DE", SPECK_DE)
    try:
        if before <= 2:
            palette = list(lab_cache.values())
            mapped = lab
        else:
            sm = smooth(lab)
            points = list(sm.values())
            ks = [ov["K"]] if "K" in ov else range(2, min(MAX_K, before) + 1)
            for k in ks:
                centres = kmeans(points, k)
                # each centre to the icon's real colour nearest it
                real = sorted(set(lab_cache.values()))
                palette = list({min(real, key=lambda r: de(r, c)) for c in centres})
                # colours an icon must keep (override EXTRA: a subtle emblem a smaller palette loses)
                for extra in ov.get("EXTRA", []):
                    palette.append(min(real, key=lambda r: de(r, srgb_to_lab(tuple(extra)))))
                palette = list(set(palette))
                use = {}
                for L in points:
                    q = min(palette, key=lambda c: de(L, c))
                    use[q] = use.get(q, 0) + 1
                palette = tidy_palette(palette, use)
                mapped, mean, bad = map_pixels(sm, palette)
                if mean <= MEAN_DE and bad <= BAD_MAX:
                    break
            mapped = despeckle(mapped, sm)
    finally:
        MEAN_DE, MAX_DE, SMOOTH_DE, SPECK_DE = saved
    rgb_of = {l: c for c, l in lab_cache.items()}
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    colours_used = set()
    for pos, q in mapped.items():
        c = rgb_of[q]
        if q[0] >= WHITE_L and math.hypot(q[1], q[2]) <= WHITE_C:
            c = WHITE
        out.putpixel(pos, (*c, 255))
        colours_used.add(c)
    poster = ov.get("POSTER")
    if poster:
        # a grey area whose subtle drawing no palette keeps (the Hisui Ribbon's emblem): its neutral pixels from row
        # y_from down are set by the original's brightness in fixed steps, and dark ones there take the outline
        outline = min(colours_used, key=lambda c: sum(c))
        for (x, y), q in mapped.items():
            if y < poster["y_from"]:
                continue
            r, g, b, a = img.getpixel((x, y))
            lum = 0.299 * r + 0.587 * g + 0.114 * b
            if lum < 120:
                if max(rgb_of[q]) - min(rgb_of[q]) > 18:
                    out.putpixel((x, y), (*outline, 255))
                continue
            if max(r, g, b) - min(r, g, b) > 18:
                continue
            for limit, colour in poster["levels"]:
                if lum < limit:
                    out.putpixel((x, y), (*colour, 255))
                    colours_used.add(tuple(colour))
                    break
    for pos, c in PATCHES.get(name, {}).items():
        out.putpixel(pos, (0, 0, 0, 0) if c is None else (*c, 255))
    return out, before, len(colours_used)


def sheet(pairs, path: Path, zoom=4, cols=4):
    cell = 40 * zoom
    rows = math.ceil(len(pairs) / cols)
    W = cols * (cell * 2 + 30) + 10
    H = rows * (cell + 34) + 10
    im = Image.new("RGBA", (W, H), (64, 64, 80, 255))
    d = ImageDraw.Draw(im)
    for n, (name, before, after, nb, na) in enumerate(pairs):
        x = 10 + (n % cols) * (cell * 2 + 30)
        y = 10 + (n // cols) * (cell + 34)
        d.text((x, y), f"{name.removesuffix('.png')}  {nb}->{na}", fill=(255, 255, 255))
        for j, img in enumerate((before, after)):
            im.alpha_composite(img.resize((cell, cell), Image.NEAREST), (x + j * (cell + 4), y + 14))
    im.convert("RGB").save(path)


def main():
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    names = sys.argv[3:] or sorted(p.name for p in src.glob("*.png"))
    dst.mkdir(parents=True, exist_ok=True)
    pairs = []
    for name in names:
        before = Image.open(src / name).convert("RGBA")
        after, nb, na = clean(before, name)
        after.save(dst / name)
        pairs.append((name, before, after, nb, na))
        print(f"{name}: {nb} -> {na}")
    for s in range(0, len(pairs), 16):
        sheet(pairs[s : s + 16], dst / f"_compare_{s // 16 + 1}.png")


if __name__ == "__main__":
    main()
