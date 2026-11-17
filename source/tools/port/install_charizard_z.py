"""Install the improved Mega Charizard Z sprites (2026-11-02) into PokeRogue.

  python -I install_charizard_z.py            (run with the ComfyUI embedded python, which has PIL)

The Essentials files (Graphics/Pokemon/*/CHARIZARD_4.png) were replaced by the image session's improved
version (bluer shadows, small ice crystals at the tips, ice-coloured tail flame). This rebuilds PokeRogue's
6-mega-z front/back (normal and 1-star shiny) the way install_assets.py made them (shrink, crop to the
drawing) and repaints the 6-mega-z / 6s-mega-z icon frames inside pokemon_icons_1 in place.

Safety: it first checks that the same steps applied to the pre-install Essentials files (the backup)
reproduce the current PokeRogue files exactly, and backs the current files up before writing.
"""

import json
import os
import shutil
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ESS = r"C:\Users\jaehe\OneDrive\바탕 화면\Pokemon Essentials v21.1 2023-07-30\Graphics\Pokemon"
OLD = r"C:\Users\jaehe\OneDrive\바탕 화면\Pokemon Essentials v21.1 2023-07-30\Design\backup\sprites_20261102_212512"
GAME = r"D:\PokeRogueDev\pokerogue"
IMG = os.path.join(GAME, "assets", "images")
STEM = "6-mega-z"
SPRITES = [("Front", "", 2), ("Front shiny", "shiny", 2), ("Back", "back", 3), ("Back shiny", os.path.join("back", "shiny"), 3)]
ICONS = [("Icons", "6-mega-z"), ("Icons shiny", "6s-mega-z")]
BACKUP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backup_6-mega-z_20261102")


def shrink(path, factor):
    """Same as install_assets.downscale + the crop in write_sprite."""
    im = Image.open(path).convert("RGBA")
    im = im.resize((im.width // factor, im.height // factor), Image.NEAREST)
    return im.crop(im.getbbox())


def icon_canvas(path):
    """Same as install_assets.py: first 64x64 frame -> 32x32 -> drawing centred at the bottom of 40x30."""
    im = Image.open(path).convert("RGBA").crop((0, 0, 64, 64)).resize((32, 32), Image.NEAREST)
    part = im.crop(im.getbbox())
    canvas = Image.new("RGBA", (40, 30), (0, 0, 0, 0))
    canvas.paste(part, ((40 - part.width) // 2, 30 - part.height), part)
    return canvas


def same(a, b):
    return a.size == b.size and a.tobytes() == b.tobytes()


def sprite_json(name, w, h):
    return {"textures": [{"image": name + ".png", "format": "RGBA8888", "size": {"w": w, "h": h}, "scale": 1,
                          "frames": [{"filename": "0001.png", "rotated": False, "trimmed": False, "sourceSize": {"w": w, "h": h},
                                      "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h}, "frame": {"x": 0, "y": 0, "w": w, "h": h}}]}],
            "meta": {"app": "tools/port/install_assets.py", "version": "3.0"}}


def main():
    atlas_png = os.path.join(IMG, "pokemon_icons_1.png")
    atlas = json.load(open(os.path.join(IMG, "pokemon_icons_1.json"), encoding="utf-8"))
    frames = {f["filename"]: f for f in atlas["textures"][0]["frames"]}
    sheet = Image.open(atlas_png).convert("RGBA")

    # 1. the method must reproduce what is there now from the old Essentials files
    for sub, folder, f in SPRITES:
        cur = Image.open(os.path.join(IMG, "pokemon", folder, STEM + ".png")).convert("RGBA")
        if not same(shrink(os.path.join(OLD, sub, "CHARIZARD_4.png"), f), cur):
            raise SystemExit("old %s does not reproduce the current PokeRogue file; stop" % sub)
    for sub, key in ICONS:
        fr = frames[key]
        x, y, w, h = (fr["frame"][k] for k in ("x", "y", "w", "h"))
        sx, sy = fr["spriteSourceSize"]["x"], fr["spriteSourceSize"]["y"]
        old = icon_canvas(os.path.join(OLD, sub, "CHARIZARD_4.png")).crop((sx, sy, sx + w, sy + h))
        if not same(old, sheet.crop((x, y, x + w, y + h))):
            raise SystemExit("old %s icon does not match the atlas frame %s; stop" % (sub, key))
    print("check: the old sprites reproduce the current PokeRogue files and icon frames")

    # 2. back up the current files
    os.makedirs(BACKUP, exist_ok=True)
    for _, folder, _ in SPRITES:
        for ext in (".png", ".json"):
            src = os.path.join(IMG, "pokemon", folder, STEM + ext)
            dst = os.path.join(BACKUP, folder.replace(os.sep, "_") or "front", STEM + ext)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
    shutil.copy2(atlas_png, os.path.join(BACKUP, "pokemon_icons_1.png"))
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

    # 4. icon frames, in place (the crystals sit inside the old drawing, so the trimmed box must not change)
    for sub, key in ICONS:
        fr = frames[key]
        x, y, w, h = (fr["frame"][k] for k in ("x", "y", "w", "h"))
        canvas = icon_canvas(os.path.join(ESS, sub, "CHARIZARD_4.png"))
        box = canvas.getbbox()
        if (box[0], box[1], box[2] - box[0], box[3] - box[1]) != (fr["spriteSourceSize"]["x"], fr["spriteSourceSize"]["y"], w, h):
            raise SystemExit("new %s icon has a different trimmed box %s; the atlas would need a new frame" % (sub, box))
        part = canvas.crop(box)
        sheet.paste(Image.new("RGBA", (w, h), (0, 0, 0, 0)), (x, y))
        sheet.paste(part, (x, y))
        print("icon:", key, "repainted at", (x, y, w, h))
    sheet.save(atlas_png)
    print("done")


if __name__ == "__main__":
    main()
