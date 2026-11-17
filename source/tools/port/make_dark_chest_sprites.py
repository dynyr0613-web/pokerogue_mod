# Local fork (2026-11-08): sprites for the "수수께끼 상자?" (DARK_MYSTERIOUS_CHEST) mystery encounter.
"""Build the black chests of the "수수께끼 상자?" mystery encounter for the PokeRogue fork (2026-11-08).

  D:/SpriteGen/comfyui/ComfyUI_windows_portable/python_embeded/python.exe -I make_dark_chest_sprites.py [--preview-only OUT.png]

Sources (read only): assets/images/mystery-encounters/mysterious_chest_blue.{png,json} and mysterious_chest_red.{png,json},
the official Mysterious Chest: a 54x492 atlas of 9 untrimmed frames (closed, lid lifting, lid open with glowing contents).
Both atlases are the same chest with the same gold trim; they differ only in the glow inside (blue = treasure, red = the
Gimmighoul trap). The encounter swaps blue for red at the moment the chest opens.

The idea doc (docs/미스터리조우_아이디어_20261108.md, 1. 수수께끼 상자?): blue chest -> black + gold, red chest -> black +
crimson, so the trap shows itself when the chest turns red. Only colours change: every pixel keeps its place and alpha
(opaque or fully transparent), the atlas layout and frames stay the same, the json is the source json with only its image
name changed (CRLF and the final newline kept).

Every part of the chest has colours of its own in the source, so a plain colour table per variant is enough (no regions):
  outline   (15,15,15)                       unchanged in both
  trim      4 golds, the frame of the chest   blue: unchanged gold; red: crimson ramp (TRIM_CRIMSON)
  panels    2 light blues, the box's sides     near-black (BODY), a cool slate a step lighter than the band
  band      3 indigos, the strap and the lid's underside   near-black with a violet hint (BODY), darker than the panels
  lock      2 lavenders, the round lock (also its smear in the lid-flying frame)
            blue: bright gold, yellower than the trim so it still reads as its own part (LOCK_GOLD)
            red: crimson, a step brighter than the trim (LOCK_CRIMSON); the doc says black + crimson, so no gold is left
  glow      the contents' blue (or red) glow and the white sparkles   unchanged (the treasure/trap colours stay)
The chest has no studs: the lock is its only round metal part. The script asserts that each source holds only the colours
its table knows, so a changed source fails loudly.

Output: assets/images/mystery-encounters/dark_mysterious_chest_blue.{png,json}
        assets/images/mystery-encounters/dark_mysterious_chest_red.{png,json}
        D:/PokeRogueDev/docs/dark_chest_preview.png  6x, every frame (the whole atlas strip), columns
            blue original | blue new | red original | red new, on mid grey (left half) and a dark background (right half)
--preview-only OUT.png writes just the preview to OUT.png (for tuning) and installs nothing.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I leaves the script folder off sys.path

from PIL import Image

import install_vest_icons as vest

ME = os.path.join(vest.IMG, "mystery-encounters")
VARIANTS = ("blue", "red")
PREVIEW = r"D:\PokeRogueDev\docs\dark_chest_preview.png"
SIZE = (54, 492)
FRAMES = 9

# source colours (the official chest palette)
OUTLINE = (15, 15, 15)
GOLD = ((115, 61, 4), (161, 99, 22), (201, 155, 58), (229, 202, 105))  # trim, dark -> light
PANEL_SHADE, PANEL = (71, 117, 190), (128, 185, 225)  # side panels: shaded side, lit front
BAND_DARK, BAND, BAND_LIGHT = (28, 18, 69), (61, 47, 119), (94, 90, 158)  # strap and the lid's underside
LOCK, LOCK_LIGHT = (162, 158, 211), (217, 217, 255)  # the round lock: its rings, its face
GLOW = {
    "blue": ((44, 125, 222), (84, 160, 251), (173, 229, 255), (239, 255, 255)),
    "red": ((225, 34, 64), (240, 83, 73), (250, 149, 132), (254, 209, 201), (239, 255, 255)),
}

# new colours
BODY = {
    PANEL: (58, 56, 70),
    PANEL_SHADE: (40, 38, 50),
    BAND_LIGHT: (46, 40, 58),
    BAND: (31, 27, 40),
    BAND_DARK: (21, 18, 28),
}
TRIM_CRIMSON = dict(zip(GOLD, ((72, 8, 20), (128, 16, 32), (178, 28, 44), (222, 62, 70))))
LOCK_GOLD = {LOCK: (222, 170, 54), LOCK_LIGHT: (255, 236, 148)}
LOCK_CRIMSON = {LOCK: (196, 36, 52), LOCK_LIGHT: (246, 104, 100)}

TABLES = {
    "blue": {OUTLINE: OUTLINE, **{g: g for g in GOLD}, **BODY, **LOCK_GOLD, **{c: c for c in GLOW["blue"]}},
    "red": {OUTLINE: OUTLINE, **TRIM_CRIMSON, **BODY, **LOCK_CRIMSON, **{c: c for c in GLOW["red"]}},
}


def src_name(variant: str) -> str:
    return f"mysterious_chest_{variant}"


def new_name(variant: str) -> str:
    return f"dark_mysterious_chest_{variant}"


def recolour(src: Image.Image, table: dict) -> Image.Image:
    stray = {p[:3] for p in src.get_flattened_data() if p[3]} - set(table)
    assert not stray, f"colours with no mapping {sorted(stray)}"
    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    sp, op = src.load(), out.load()
    for y in range(src.height):
        for x in range(src.width):
            r, g, b, a = sp[x, y]
            if a:
                op[x, y] = (*table[(r, g, b)], 255)
    return out


def check(src: Image.Image, new: Image.Image) -> None:
    assert src.size == new.size == SIZE, (src.size, new.size)
    sp, np_ = src.load(), new.load()
    for y in range(src.height):
        for x in range(src.width):
            assert sp[x, y][3] in (0, 255) and np_[x, y][3] == sp[x, y][3], (x, y)


def check_json(variant: str) -> None:
    """the source atlas still has the layout this recipe was written for: 9 untrimmed, unrotated frames"""
    data = json.load(open(os.path.join(ME, src_name(variant) + ".json"), encoding="utf-8"))
    tex = data["textures"][0]
    assert (tex["size"]["w"], tex["size"]["h"]) == SIZE, tex["size"]
    assert len(tex["frames"]) == FRAMES and not any(f["rotated"] or f["trimmed"] for f in tex["frames"])


def install_json(variant: str) -> None:
    raw = open(os.path.join(ME, src_name(variant) + ".json"), "rb").read()
    text = raw.decode("utf-8")
    old = f'"image": "{src_name(variant)}.png"'
    assert text.count(old) == 1
    text = text.replace(old, f'"image": "{new_name(variant)}.png"')
    json.loads(text)
    open(os.path.join(ME, new_name(variant) + ".json"), "wb").write(text.encode("utf-8"))


def preview(pairs: list, path: str, scale: int = 6) -> None:
    """pairs = [(original, new) per variant]; one column per image, the whole atlas strip, grey half then dark half."""
    gap = 8
    w, h = SIZE[0] * scale, SIZE[1] * scale
    images = [im for pair in pairs for im in pair]
    cols = 2 * len(images)
    sheet = Image.new("RGBA", (cols * w + (cols + 1) * gap + gap, h + 2 * gap), (255, 255, 255, 255))
    for half, bg in enumerate([(128, 128, 128, 255), (34, 30, 44, 255)]):
        for i, im in enumerate(images):
            tile = Image.new("RGBA", SIZE, bg)
            tile.alpha_composite(im)
            x = gap + half * (len(images) * (w + gap) + gap) + i * (w + gap)
            sheet.paste(tile.resize((w, h), Image.NEAREST), (x, gap))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sheet.convert("RGB").save(path)


if __name__ == "__main__":
    pairs = []
    for v in VARIANTS:
        check_json(v)
        src = Image.open(os.path.join(ME, src_name(v) + ".png")).convert("RGBA")
        new = recolour(src, TABLES[v])
        check(src, new)
        pairs.append((src, new))
    if "--preview-only" in sys.argv:
        preview(pairs, sys.argv[sys.argv.index("--preview-only") + 1])
        raise SystemExit(0)
    for v, (src, new) in zip(VARIANTS, pairs):
        out = os.path.join(ME, new_name(v) + ".png")
        vest.to_palette_png(new, out)
        installed = Image.open(out).convert("RGBA")
        assert list(installed.get_flattened_data()) == list(new.get_flattened_data()), "palette PNG does not round-trip"
        install_json(v)
        print("installed", new_name(v))
    preview(pairs, PREVIEW)
    print("preview", PREVIEW)
