"""Install the Candy Pile (사탕더미) item icon into the PokeRogue fork (2026-11-05).

  D:/SpriteGen/comfyui/ComfyUI_windows_portable/python_embeded/python.exe -I install_candy_pile_icon.py [source.png]

Source: the image session's final icon, D:/SpriteGen/output/candy_pile/candy_pile.png by default (32x32, made for this
fork at the user's request). Read-only.
Output: assets/images/items/candy_pile.png  32x32 palette PNG; alpha snapped to 0/255, the picture centred
        assets/images/items.json / items.png  one untrimmed 32x32 frame "candy_pile" (redrawn in place on re-runs)
Reuses install_vest_icons.py's helpers. modifier-type.ts's CANDY_PILE entry then uses the "candy_pile" icon.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I leaves the script folder off sys.path

from PIL import Image

import install_vest_icons as vest

SRC = r"D:\SpriteGen\output\candy_pile\candy_pile.png"


def snap_alpha(im: Image.Image) -> Image.Image:
    out = im.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255) if a >= 128 else (0, 0, 0, 0)
    return out


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    src_path = args[0] if args else SRC
    src = Image.open(src_path).convert("RGBA")
    if src.size != (vest.CANVAS, vest.CANVAS):
        raise SystemExit(f"expected a {vest.CANVAS}x{vest.CANVAS} icon, got {src.size}: {src_path}")
    icon = vest.centre(snap_alpha(src))
    colours = {p for p in icon.getdata() if p[3] > 0}
    print("source:", src_path, "bbox", icon.getbbox(), "colours", len(colours))
    vest.to_palette_png(icon, os.path.join(vest.ITEMS, "candy_pile.png"))
    vest.update_atlas(["candy_pile"])
    print("done")
