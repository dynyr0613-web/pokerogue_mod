"""Give Mega Melmetal's 2-star shiny the same sprite as its 1-star shiny.

  python -I install_melmetal_tier2.py            (run with the ComfyUI embedded python, which has PIL)

install_melmetal_epic.py set variant/_masterlist.json "809-mega" to [0, 0, 2]. A 0 in the 2-star slot
makes getSpriteId return the plain non-shiny "809-mega" for variant 1, so a 2-star Mega Melmetal (and a
fusion using it) looked unshiny. The intent was that the 1- and 2-star shinies keep the old recoloured
shiny, so the 2-star becomes a separate sprite that copies it:
  variant/809-mega_2.{png,json} and variant/back/809-mega_2.{png,json} from shiny/ and back/shiny/,
  "809-mega": [0, 2, 2] in the masterlist (front and back), and an 809-mega_2 icon frame in
  pokemon_icons_7v copied from 809s-mega in pokemon_icons_7.
Re-runnable: each step skips what is already there.
"""

import json
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from install_melmetal_epic import IMG, KEY, add_to_atlas, write_variant_sprite  # noqa: E402

OLD = "[0, 0, 2]"
NEW = "[0, 2, 2]"


def install_sprites() -> None:
    for sub in ("", "back"):
        src = os.path.join(IMG, "pokemon", sub, "shiny", KEY)
        out = os.path.join(IMG, "pokemon", "variant", sub, f"{KEY}_2")
        if os.path.exists(out + ".png"):
            print("sprite: already there", out + ".png")
            continue
        write_variant_sprite(src + ".png", src + ".json", out)


def update_masterlist() -> None:
    """Textual edit, so the file keeps its tab indent and CRLF."""
    path = os.path.join(IMG, "pokemon", "variant", "_masterlist.json")
    raw = open(path, encoding="utf-8", newline="").read()
    old_line, new_line = f'"{KEY}": {OLD}', f'"{KEY}": {NEW}'
    if raw.count(new_line) == 2:
        print("masterlist: already", NEW)
        return
    if raw.count(old_line) != 2:
        raise SystemExit(f"masterlist: expected {old_line} twice (front and back); edit it by hand")
    text = raw.replace(old_line, new_line)
    data = json.loads(text)
    assert data[KEY] == [0, 2, 2] and data["back"][KEY] == [0, 2, 2]
    open(path, "w", encoding="utf-8", newline="").write(text)
    print("masterlist:", KEY, "->", NEW, "(front and back)")


def shiny_icon() -> Image.Image:
    """The 809s-mega frame of pokemon_icons_7, back on its 40x30 canvas."""
    data = json.load(open(os.path.join(IMG, "pokemon_icons_7.json"), encoding="utf-8"))
    frame = next(f for f in data["textures"][0]["frames"] if f["filename"] == "809s-mega")
    sheet = Image.open(os.path.join(IMG, "pokemon_icons_7.png")).convert("RGBA")
    box = frame["frame"]
    part = sheet.crop((box["x"], box["y"], box["x"] + box["w"], box["y"] + box["h"]))
    canvas = Image.new("RGBA", (frame["sourceSize"]["w"], frame["sourceSize"]["h"]), (0, 0, 0, 0))
    canvas.paste(part, (frame["spriteSourceSize"]["x"], frame["spriteSourceSize"]["y"]), part)
    return canvas


if __name__ == "__main__":
    install_sprites()
    update_masterlist()
    add_to_atlas("pokemon_icons_7v", {f"{KEY}_2": shiny_icon()}, (40, 30))
    print("done")
