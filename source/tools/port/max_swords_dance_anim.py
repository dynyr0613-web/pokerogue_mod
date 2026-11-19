"""
Item E1 (2026-11-19): Max Swords Dance (다이검무) animation made from PokeRogue's Swords Dance animation.
The user: "e1 칼춤 모션 색깔 / 크기 변경으로 제작".

- Sheet: frame 0 of "PRAS- Swords Dance + Signal Beam.png" (the only frame Swords Dance uses), its two palette
  colours swapped for a Dynamax red / magenta pair -> "PRAS- Swords Dance (Max).png" (96x96, palette PNG).
- Animation: swords-dance.json with that sheet and its graphic cels x1.5 (the Dynamax sprite scale): zoom x1.5 and
  the formation grown x1.5 around PIVOT, the point the four swords close in on at the end (frames 11-19) and about
  where a Dynamaxed user's body centre is (the anim focus is the unscaled sprite's centre, so 1/4 of the sprite's
  height lower). Everything else (frames, timing, opacity, angles, sounds, battler cels) unchanged.

Usage: python -I max_swords_dance_anim.py <pokerogue dir>  (needs Pillow; rewrites both files)
"""

import json
import sys
from pathlib import Path

from PIL import Image

SCALE = 1.5
PIVOT = (0, -21)  # offset from the user's sprite centre (AnimFocus.USER)
SRC_SHEET = "PRAS- Swords Dance + Signal Beam"
NEW_SHEET = "PRAS- Swords Dance (Max)"
MAX_SWORDS_DANCE_ID = 958  # MoveId.MAX_SWORDS_DANCE (the test checks it)
GRAPHIC = 2  # AnimFrameTarget.GRAPHIC

# The sword's two colours (light side, shaded side) -> Dynamax red / magenta
RECOLOUR = {
    (156, 190, 233): (255, 82, 140),  # light side: hot magenta-pink
    (126, 153, 188): (200, 24, 72),  # shaded side: Dynamax crimson
}


def num(v: float):
    """Keep whole numbers as ints, like the source file"""
    return int(v) if float(v).is_integer() else v


def build_sheet(root: Path) -> None:
    src = Image.open(root / "assets/images/battle_anims" / f"{SRC_SHEET}.png")
    assert src.mode == "P", src.mode
    transparent = src.info["transparency"]
    frame = src.crop((0, 0, 96, 96))
    pal = src.getpalette()
    # a fresh palette: 0 = transparent, then the swapped colours in RECOLOUR's order
    new_index = {transparent: 0}
    new_pal = [0, 0, 0]
    for old_rgb, new_rgb in RECOLOUR.items():
        i = next(i for i in range(len(pal) // 3) if tuple(pal[i * 3 : i * 3 + 3]) == old_rgb)
        new_index[i] = len(new_pal) // 3
        new_pal += list(new_rgb)
    pixels = list(frame.getdata())
    assert set(pixels) <= set(new_index), f"unexpected palette indices {set(pixels) - set(new_index)}"
    out = Image.new("P", frame.size)
    out.putpalette(new_pal)
    out.putdata([new_index[i] for i in pixels])
    out.save(root / "assets/images/battle_anims" / f"{NEW_SHEET}.png", transparency=0)


def build_anim(root: Path) -> None:
    src = json.loads((root / "assets/battle-anims/swords-dance.json").read_text(encoding="utf-8"))
    src["id"] = MAX_SWORDS_DANCE_ID
    src["graphic"] = NEW_SHEET
    for frame in src["frames"]:
        for cel in frame:
            if cel["target"] != GRAPHIC:
                continue
            assert cel["focus"] == 2, cel  # AnimFocus.USER: offsets are from the user's centre
            cel["x"] = num(PIVOT[0] + (cel["x"] - PIVOT[0]) * SCALE)
            cel["y"] = num(PIVOT[1] + (cel["y"] - PIVOT[1]) * SCALE)
            cel["zoomX"] = num(cel["zoomX"] * SCALE)
            cel["zoomY"] = num(cel["zoomY"] * SCALE)
    text = json.dumps(src, indent=2, ensure_ascii=False)
    (root / "assets/battle-anims/max-swords-dance.json").write_text(text, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    root = Path(sys.argv[1])
    build_sheet(root)
    build_anim(root)
    print("ok")
