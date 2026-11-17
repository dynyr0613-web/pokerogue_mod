"""Thin the black lines of the shiny mark icons, which the 1.5x nearest upscale left 2-3 px thick in places.

A black pixel becomes transparent when it touches the outside (a transparent 4-neighbour), touches no coloured pixel
(8-neighbourhood: so every coloured pixel keeps its outline), and is a simple point (its black 8-neighbours stay one
connected group without it: so the charm's chain and the outlines never break). Repeated until nothing changes.

usage: py -I shiny_thin.py <in.png> <out.png> [<preview.png>]
"""
import sys

sys.path.append(r"C:\Users\jaehe\AppData\Roaming\Python\Python313\site-packages")
from PIL import Image

BLACK = (32, 32, 32)
src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGBA")
W, H = im.size
px = {(x, y): im.getpixel((x, y)) for y in range(H) for x in range(W)}


def kind(p):
    c = px.get(p)
    if c is None or c[3] < 128:
        return "t"
    return "b" if c[:3] == BLACK else "c"


N4 = [(1, 0), (-1, 0), (0, 1), (0, -1)]
N8 = [(-1, -1), (0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0)]


def simple(p):
    """Its black 8-neighbours form one 8-connected group (and there is at least one)."""
    nb = [(p[0] + dx, p[1] + dy) for dx, dy in N8 if kind((p[0] + dx, p[1] + dy)) == "b"]
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


removed = []
changed = True
while changed:
    changed = False
    for y in range(H):
        for x in range(W):
            p = (x, y)
            if kind(p) != "b":
                continue
            if not any(kind((x + dx, y + dy)) == "t" for dx, dy in N4):
                continue
            if any(kind((x + dx, y + dy)) == "c" for dx, dy in N8):
                continue
            # an end of a line (one black neighbour) stays: thinning, not shortening
            if sum(kind((x + dx, y + dy)) == "b" for dx, dy in N8) < 2:
                continue
            if not simple(p):
                continue
            px[p] = (0, 0, 0, 0)
            removed.append(p)
            changed = True

out = Image.new("RGBA", (W, H))
for p, c in px.items():
    out.putpixel(p, c)
out.save(dst)
print(len(removed), "removed")
