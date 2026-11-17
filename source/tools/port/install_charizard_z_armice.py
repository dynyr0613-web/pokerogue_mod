"""Install Mega Charizard Z's front with the ice-crystal arm wings (2026-11-03) into PokeRogue.

  python -I install_charizard_z_armice.py [essentials_backup_dir backup_suffix]
                                              (run with the ComfyUI embedded python, which has PIL)

  For a later reinstall, pass the Essentials backup made right before that install (the files PokeRogue was last
  built from) and a new suffix for this script's own backup folder, e.g.
  install_charizard_z_armice.py ".../Design/backup/sprites_20261103_202145" 20261103b

The Essentials Front and Front shiny CHARIZARD_4.png were replaced on 2026-11-03 (both forearm wings redrawn as ice
crystals; back and icons unchanged). This rebuilds PokeRogue's 6-mega-z front, normal and 1-star shiny, the same
way install_charizard_z.py does (shrink, crop to the drawing). Back sprites and icon frames are not touched.

Safety: it first checks that the same steps applied to the pre-install Essentials files (the 2026-11-03 backup)
reproduce the current PokeRogue files exactly, and backs the current files up before writing.
"""

import json
import os
import shutil
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from install_charizard_z import ESS, IMG, STEM, shrink, same, sprite_json  # noqa: E402

OLD = sys.argv[1] if len(sys.argv) > 1 else \
    r"C:\Users\jaehe\OneDrive\바탕 화면\Pokemon Essentials v21.1 2023-07-30\Design\backup\sprites_20261103_194501"
SPRITES = [("Front", "", 2), ("Front shiny", "shiny", 2)]
BACKUP = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                      "backup_6-mega-z_" + (sys.argv[2] if len(sys.argv) > 2 else "20261103"))


def main():
    # 1. the method must reproduce what is there now from the old Essentials files
    for sub, folder, f in SPRITES:
        cur = Image.open(os.path.join(IMG, "pokemon", folder, STEM + ".png")).convert("RGBA")
        if not same(shrink(os.path.join(OLD, sub, "CHARIZARD_4.png"), f), cur):
            raise SystemExit("old %s does not reproduce the current PokeRogue file; stop" % sub)
    print("check: the old sprites reproduce the current PokeRogue files")

    # 2. back up the current files
    for _, folder, _ in SPRITES:
        for ext in (".png", ".json"):
            src = os.path.join(IMG, "pokemon", folder, STEM + ext)
            dst = os.path.join(BACKUP, folder or "front", STEM + ext)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
    print("backup:", BACKUP)

    # 3. sprites from the new Essentials files
    for sub, folder, f in SPRITES:
        im = shrink(os.path.join(ESS, sub, "CHARIZARD_4.png"), f)
        out = os.path.join(IMG, "pokemon", folder, STEM)
        old_size = Image.open(out + ".png").size
        im.save(out + ".png")
        with open(out + ".json", "w", encoding="utf-8", newline="\n") as fh:
            json.dump(sprite_json(STEM, im.width, im.height), fh, indent="\t")
            fh.write("\n")
        print("sprite:", os.path.join(folder, STEM), old_size, "->", im.size)
    print("done")


if __name__ == "__main__":
    main()
