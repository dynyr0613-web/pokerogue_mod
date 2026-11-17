"""Install the Life Orb (생명의구슬) item icon into the PokeRogue fork (2026-11-05, provisional like the vests).

  D:/SpriteGen/comfyui/ComfyUI_windows_portable/python_embeded/python.exe -I install_life_orb_icon.py

Source: the Essentials project's Graphics/Items/LIFEORB.png (48x48, drawn at 1x, read-only).
Output: assets/images/items/life_orb.png  32x32 palette PNG, the orb halved by majority vote and centred
        assets/images/items.json / items.png  one untrimmed 32x32 frame "life_orb" (redrawn in place on re-runs)
Reuses install_vest_icons.py's helpers.

Local fork (2026-11-18): superseded. The frame is PokéSprite's items/hold-item/life-orb.png since
install_pokesprite_icons.py; this script stops unless --essentials is given.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I leaves the script folder off sys.path

from PIL import Image

import install_vest_icons as vest

SRC = r"C:\Users\jaehe\OneDrive\바탕 화면\Pokemon Essentials v21.1 2023-07-30\Graphics\Items\LIFEORB.png"

if __name__ == "__main__":
    # Local fork (2026-11-18): superseded by install_pokesprite_icons.py (the user: "아이콘 화풍은 포케스프라이트로
    # 통일"); a plain run would put the Essentials Life Orb back over PokéSprite's, so it needs --essentials
    if "--essentials" not in sys.argv:
        raise SystemExit("superseded by install_pokesprite_icons.py; pass --essentials to install the Essentials Life Orb anyway")
    if "--keep-pngs" not in sys.argv:
        src = Image.open(SRC).convert("RGBA")
        orb = vest.centre(vest.shrink_majority(src.crop(src.getbbox())))
        vest.to_palette_png(orb, os.path.join(vest.ITEMS, "life_orb.png"))
        print("png: life_orb.png", orb.getbbox())
    vest.update_atlas(["life_orb"])
    print("done")
