"""Install the Mark Charm (증표부적) item icon into the fork's `items` atlas (2026-11-17).

    python -I install_mark_charm_icon.py <game folder>      e.g. the installed resources/game, or pokerogue/assets

Source: item-icons/mark-charm.png, the 64x64 Mark Charm sprite of the PokeAPI sprites repository
(https://github.com/PokeAPI/sprites, sprites/items/mark-charm.png), halved to the atlas' 32x32.
Output: images/items.png / items.json, one untrimmed 32x32 frame "mark_charm" appended below the sheet (redrawn in
place on re-runs).
"""
import json
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
NAME = "mark_charm"
SIZE = 32


def main() -> None:
    images = Path(sys.argv[1]) / "images"
    atlas_path = images / "items.json"
    atlas = json.loads(atlas_path.read_text(encoding="utf-8"))
    texture = atlas["textures"][0]
    sheet = Image.open(images / texture["image"]).convert("RGBA")
    icon = Image.open(HERE / "item-icons" / "mark-charm.png").convert("RGBA").resize((SIZE, SIZE), Image.LANCZOS)
    # Hard edges, like the other icons
    icon.putalpha(icon.getchannel("A").point(lambda a: 255 if a >= 128 else 0))

    frame = next((f for f in texture["frames"] if f["filename"] == NAME), None)
    if frame is None:
        x, y = 0, sheet.height
        grown = Image.new("RGBA", (sheet.width, sheet.height + SIZE), (0, 0, 0, 0))
        grown.paste(sheet, (0, 0))
        sheet = grown
        frame = {
            "filename": NAME,
            "rotated": False,
            "trimmed": False,
            "sourceSize": {"w": SIZE, "h": SIZE},
            "spriteSourceSize": {"x": 0, "y": 0, "w": SIZE, "h": SIZE},
            "frame": {"x": x, "y": y, "w": SIZE, "h": SIZE},
        }
        texture["frames"].append(frame)
        texture["size"] = {"w": sheet.width, "h": sheet.height}
    rect = frame["frame"]
    sheet.paste(Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0)), (rect["x"], rect["y"]))
    sheet.paste(icon, (rect["x"], rect["y"]))
    sheet.save(images / texture["image"], optimize=True)
    atlas_path.write_text(json.dumps(atlas, separators=(",", ":")), encoding="utf-8")
    print(f"{NAME} -> {rect}")


if __name__ == "__main__":
    main()
