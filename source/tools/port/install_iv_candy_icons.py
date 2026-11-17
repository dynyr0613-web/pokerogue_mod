"""Install the IV Candy item icons (개체값사탕) into the PokeRogue fork.

  D:/SpriteGen/comfyui/ComfyUI_windows_portable/python_embeded/python.exe -I install_iv_candy_icons.py

Source: the six positive IV candies of Cobblemon 1.7.3 (assets/cobblemon/textures/item/iv_candy/*.png, 16x16),
read straight from the jar in the user's Cobbleverse instance. Cobblemon is MPL-2.0 (the jar's LICENSE and
fabric.mod.json; https://gitlab.com/cable-mc/cobblemon); the item textures carry no separate licence. The copies
we make are scaled 2x and stay under MPL-2.0: see REUSE.toml, LICENSES/MPL-2.0.txt and CREDITS.md.

Output: assets/images/items/<name>_candy.png  32x32 palette PNG, the 16x16 candy scaled 2x (nearest) and centred
        assets/images/items.json / items.png   six untrimmed 32x32 frames with the same names

Re-running is safe: existing frames are redrawn in place (pass --keep-pngs to only refresh the atlas from the
PNGs in assets/images/items/), new ones are appended below the sheet (install_vest_icons.update_atlas).
"""

import importlib.util
import os
import sys
import zipfile
from io import BytesIO

from PIL import Image

JAR = r"C:\Users\jaehe\curseforge\minecraft\Instances\___ __\mods\Cobblemon-fabric-1.7.3+1.21.1.jar"
GAME = r"D:\PokeRogueDev\pokerogue"
ITEMS = os.path.join(GAME, "assets", "images", "items")
CANVAS = 32
# Cobblemon name -> stat, in PokeRogue's stat order (HP, Atk, Def, SpAtk, SpDef, Spd)
NAMES = ["health_candy", "mighty_candy", "tough_candy", "smart_candy", "courage_candy", "quick_candy"]

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("install_vest_icons", os.path.join(HERE, "install_vest_icons.py"))
vest = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vest)


def make_pngs() -> None:
    with zipfile.ZipFile(JAR) as z:
        for name in NAMES:
            src = Image.open(BytesIO(z.read(f"assets/cobblemon/textures/item/iv_candy/{name}.png"))).convert("RGBA")
            assert src.size == (16, 16), (name, src.size)
            big = src.resize((32, 32), Image.NEAREST)
            vest.to_palette_png(vest.centre(big), os.path.join(ITEMS, name + ".png"))
    print("pngs:", NAMES)


if __name__ == "__main__":
    if "--keep-pngs" not in sys.argv:
        make_pngs()
    vest.update_atlas(NAMES)
    print("done")
