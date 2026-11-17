"""Install the golden Hyper GTS terminal sprite into the PokeRogue fork (2026-11-05).

  D:/SpriteGen/comfyui/ComfyUI_windows_portable/python_embeded/python.exe -I install_hyper_gts_sprite.py [source.png]

Source: the image session's gold recolour of the GTS terminal, D:/SpriteGen/output/hyper_gts/hyper_global_trade_system.png
by default (77x78, same layout as assets/images/mystery-encounters/global_trade_system.png). Read-only.
Output: assets/images/mystery-encounters/hyper_global_trade_system.png  palette PNG, alpha snapped to 0/255
        assets/images/mystery-encounters/hyper_global_trade_system.json the GTS atlas json with its image name changed
The Hyper GTS encounter then uses spriteKey "hyper_global_trade_system".
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I leaves the script folder off sys.path

from PIL import Image

import install_vest_icons as vest

SRC = r"D:\SpriteGen\output\hyper_gts\hyper_global_trade_system.png"
ME = os.path.join(vest.IMG, "mystery-encounters")
NAME = "hyper_global_trade_system"


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
    original = Image.open(os.path.join(ME, "global_trade_system.png"))
    src = Image.open(src_path).convert("RGBA")
    if src.size != original.size:
        raise SystemExit(f"expected {original.size}, got {src.size}: {src_path}")
    vest.to_palette_png(snap_alpha(src), os.path.join(ME, NAME + ".png"))

    raw = open(os.path.join(ME, "global_trade_system.json"), "rb").read()
    text = raw.decode("utf-8")
    assert text.count('"image": "global_trade_system.png"') == 1
    text = text.replace('"image": "global_trade_system.png"', f'"image": "{NAME}.png"')
    json.loads(text)
    open(os.path.join(ME, NAME + ".json"), "wb").write(text.encode("utf-8"))
    print("installed", NAME, "from", src_path)
