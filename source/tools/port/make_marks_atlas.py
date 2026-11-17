"""Build the marks' and ribbons' icon atlas (images/marks/marks.png + .json) for pokemon-marks.ts.

The 40x40 icons in mark-icons/ are PKHeX's ribbon sprites (https://github.com/kwsch/PKHeX,
PKHeX.Drawing.Misc/Resources/img/ribbons, GPL-3.0), named as there. Each atlas frame is named after its
`PokemonMark` in camelCase (`getMarkKey`).

    python -I make_marks_atlas.py <game folder>      e.g. the installed resources/game, or pokerogue/assets
"""
import json
import re
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ICONS = HERE / "mark-icons"
SIZE = 40
COLUMNS = 10

# PokemonMark name -> PKHeX file name (without "ribbon" and ".png")
SOURCES = {
    "CHAMPION_RIBBON": "championg3",
    "HOENN_CHAMPION_RIBBON": "championg6hoenn",
    "SINNOH_CHAMPION_RIBBON": "championsinnoh",
    "KALOS_CHAMPION_RIBBON": "championkalos",
    "ALOLA_CHAMPION_RIBBON": "championalola",
    "GALAR_CHAMPION_RIBBON": "championgalar",
    "PALDEA_CHAMPION_RIBBON": "championpaldea",
    "LEGEND_RIBBON": "legend",
    "ALPHA_MARK": "markalpha",
}
for name in (
    "LUNCHTIME SLEEPY_TIME DUSK DAWN RAINY STORMY SNOWY BLIZZARD DRY SANDSTORM MISTY UNCOMMON RARE ROWDY "
    "ABSENT_MINDED JITTERY EXCITED CHARISMATIC CALMNESS INTENSE ZONED_OUT JOYFUL ANGRY SMILEY TEARY UPBEAT PEEVED "
    "INTELLECTUAL FEROCIOUS CRAFTY SCOWLING KINDLY FLUSTERED PUMPED_UP ZERO_ENERGY PRIDEFUL UNSURE HUMBLE THORNY "
    "VIGOR SLUMP"
).split():
    SOURCES[f"{name}_MARK"] = "mark" + name.replace("_", "").lower()


def camel(name: str) -> str:
    return re.sub(r"_([a-z])", lambda m: m.group(1).upper(), name.lower())


def main() -> None:
    out_dir = Path(sys.argv[1]) / "images" / "marks"
    out_dir.mkdir(parents=True, exist_ok=True)
    names = list(SOURCES)
    rows = (len(names) + COLUMNS - 1) // COLUMNS
    sheet = Image.new("RGBA", (COLUMNS * SIZE, rows * SIZE), (0, 0, 0, 0))
    frames = []
    for i, name in enumerate(names):
        icon = Image.open(ICONS / f"ribbon{SOURCES[name]}.png").convert("RGBA")
        assert icon.size == (SIZE, SIZE), (name, icon.size)
        x, y = (i % COLUMNS) * SIZE, (i // COLUMNS) * SIZE
        sheet.paste(icon, (x, y))
        rect = {"x": x, "y": y, "w": SIZE, "h": SIZE}
        frames.append(
            {
                "filename": camel(name),
                "rotated": False,
                "trimmed": False,
                "sourceSize": {"w": SIZE, "h": SIZE},
                "spriteSourceSize": {"x": 0, "y": 0, "w": SIZE, "h": SIZE},
                "frame": rect,
            }
        )
    sheet.save(out_dir / "marks.png", optimize=True)
    atlas = {
        "textures": [
            {
                "image": "marks.png",
                "format": "RGBA8888",
                "size": {"w": sheet.width, "h": sheet.height},
                "scale": 1,
                "frames": frames,
            }
        ],
        "meta": {"app": "tools/port/make_marks_atlas.py"},
    }
    (out_dir / "marks.json").write_text(json.dumps(atlas, separators=(",", ":")), encoding="utf-8")
    print(f"{len(frames)} icons -> {out_dir / 'marks.png'}")


if __name__ == "__main__":
    main()
