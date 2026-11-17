"""Install the Mega Melmetal shiny the image session made.

  python -I install_melmetal_epic.py            (run with the ComfyUI embedded python, which has PIL)

Essentials: the new sprites become the normal shiny (Front shiny / Back shiny / Icons shiny MELMETAL_2.png).
PokeRogue:  the same art becomes the 3-star (epic) variant of 809-mega: variant/809-mega_3.{png,json},
            variant/back/809-mega_3.{png,json}, a [0, 0, 2] entry in variant/_masterlist.json (front and back)
            and an 809-mega_3 icon frame in pokemon_icons_7v. The 1-star shiny keeps the old sprite.
            Run install_melmetal_tier2.py afterwards: with [0, 0, 2] the 2-star shows as non-shiny.
"""

import json
import os
import shutil

from PIL import Image

SRC = r"D:\SpriteGen\output\final\mega_melmetal_shiny"
ESS = r"C:\Users\jaehe\OneDrive\바탕 화면\Pokemon Essentials v21.1 2023-07-30\Graphics\Pokemon"
GAME = r"D:\PokeRogueDev\pokerogue"
IMG = os.path.join(GAME, "assets", "images")
KEY = "809-mega"


def install_essentials() -> None:
    for sub in ("Front shiny", "Back shiny", "Icons shiny"):
        src = os.path.join(SRC, "essentials", sub, "MELMETAL_2.png")
        dst = os.path.join(ESS, sub, "MELMETAL_2.png")
        shutil.copy2(src, dst)
        print("essentials:", dst)


def write_variant_sprite(src_png: str, src_json: str, out_stem: str) -> None:
    os.makedirs(os.path.dirname(out_stem), exist_ok=True)
    shutil.copy2(src_png, out_stem + ".png")
    data = json.load(open(src_json, encoding="utf-8"))
    data["textures"][0]["image"] = os.path.basename(out_stem) + ".png"
    with open(out_stem + ".json", "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, indent="\t")
        f.write("\n")
    print("pokerogue:", out_stem + ".png")


def _insert_entry(lines: list, start: int, end: int, indent: str, key: str, value: list) -> None:
    """Insert `"key": [..]` into the entry lines[start:end] of one section, keeping numeric order.

    Lines look like `\t"809": [0, 1, 1],`; the last entry of a section has no trailing comma.
    """
    import re

    entry_re = re.compile(r'^' + indent + r'"([0-9]+)([^"]*)":')

    def sort_key(k: str):
        m = re.match(r"([0-9]+)(.*)", k)
        return (int(m.group(1)), m.group(2))

    pos = end
    for i in range(start, end):
        m = entry_re.match(lines[i])
        if m and sort_key(m.group(1) + m.group(2)) > sort_key(key):
            pos = i
            break
    new = f'{indent}"{key}": [{", ".join(str(v) for v in value)}]'
    if pos < end:
        lines.insert(pos, new + ",")
    else:  # becomes the last entry: the previous last entry needs a comma now
        lines[end - 1] = lines[end - 1].rstrip() + ","
        lines.insert(end, new)


def update_masterlist() -> None:
    """Edit the file textually so its own style (tab indent, one entry per line, CRLF) stays intact."""
    path = os.path.join(IMG, "pokemon", "variant", "_masterlist.json")
    raw = open(path, encoding="utf-8", newline="").read()
    newline = "\r\n" if "\r\n" in raw else "\n"
    lines = raw.split(newline)
    if any(f'"{KEY}":' in line for line in lines):
        data = json.loads(raw)
        # [0, 2, 2] once install_melmetal_tier2.py has given the 2-star its sprite
        if data.get(KEY) in ([0, 0, 2], [0, 2, 2]) and data.get("back", {}).get(KEY) == data.get(KEY):
            print("masterlist: already has", KEY)
            return
        raise SystemExit(f"masterlist already mentions {KEY} with other values; edit it by hand")
    back_start = next(i for i, line in enumerate(lines) if line.startswith('\t"back": {'))
    back_end = next(i for i in range(back_start + 1, len(lines)) if lines[i].startswith("\t}"))
    # back section first so the top-level indices stay valid
    _insert_entry(lines, back_start + 1, back_end, "\t\t", KEY, [0, 0, 2])
    _insert_entry(lines, 1, back_start, "\t", KEY, [0, 0, 2])
    text = newline.join(lines)
    data = json.loads(text)  # must still parse
    assert data[KEY] == [0, 0, 2] and data["back"][KEY] == [0, 0, 2]
    open(path, "w", encoding="utf-8", newline="").write(text)
    print("masterlist:", KEY, "->", data[KEY], "back", data["back"][KEY])


def icon_frame(icon_path: str) -> Image.Image:
    """First frame of an Essentials icon sheet, shrunk the way install_assets.py did, on a 40x30 canvas."""
    sheet = Image.open(icon_path).convert("RGBA")
    frame = sheet.crop((0, 0, sheet.width // 2, sheet.height))
    small = frame.resize((32, 32 * frame.height // frame.width), Image.NEAREST)
    part = small.crop(small.getbbox())
    canvas = Image.new("RGBA", (40, 30), (0, 0, 0, 0))
    canvas.paste(part, ((40 - part.width) // 2, 30 - part.height), part)
    return canvas


def add_to_atlas(name: str, frames: dict, source: tuple) -> None:
    png = os.path.join(IMG, name + ".png")
    js = os.path.join(IMG, name + ".json")
    raw = open(js, encoding="utf-8", newline="").read()
    newline = "\r\n" if "\r\n" in raw else "\n"
    data = json.loads(raw)
    tex = data["textures"][0]
    have = {f["filename"] for f in tex["frames"]}
    frames = {k: v for k, v in frames.items() if k not in have}
    if not frames:
        print("atlas:", name, "already has the frame")
        return
    sheet = Image.open(png).convert("RGBA")
    row_h = max(im.getbbox()[3] - im.getbbox()[1] for im in frames.values())
    total_w = sum(im.getbbox()[2] - im.getbbox()[0] + 1 for im in frames.values())
    new = Image.new("RGBA", (max(sheet.width, total_w), sheet.height + row_h + 1), (0, 0, 0, 0))
    new.paste(sheet, (0, 0))
    x, y = 0, sheet.height + 1
    for key, im in frames.items():
        box = im.getbbox()
        part = im.crop(box)
        new.paste(part, (x, y))
        tex["frames"].append({"filename": key, "rotated": False, "trimmed": True, "sourceSize": {"w": source[0], "h": source[1]},
                              "spriteSourceSize": {"x": box[0], "y": box[1], "w": part.width, "h": part.height},
                              "frame": {"x": x, "y": y, "w": part.width, "h": part.height}})
        x += part.width + 1
    tex["size"] = {"w": new.width, "h": new.height}
    new.save(png)
    # The file is TexturePacker output: tab indent, CRLF, trailing newline. Re-serialising with the same
    # settings reproduces it, so the diff is only the new frame and the size.
    text = json.dumps(data, indent="\t", ensure_ascii=False).replace("\n", newline) + newline
    open(js, "w", encoding="utf-8", newline="").write(text)
    print("atlas:", name, "+", list(frames))


def install_pokerogue() -> None:
    write_variant_sprite(os.path.join(SRC, "pokerogue", "shiny", f"{KEY}.png"),
                         os.path.join(SRC, "pokerogue", "shiny", f"{KEY}.json"),
                         os.path.join(IMG, "pokemon", "variant", f"{KEY}_3"))
    write_variant_sprite(os.path.join(SRC, "pokerogue", "back", "shiny", f"{KEY}.png"),
                         os.path.join(SRC, "pokerogue", "back", "shiny", f"{KEY}.json"),
                         os.path.join(IMG, "pokemon", "variant", "back", f"{KEY}_3"))
    update_masterlist()
    add_to_atlas("pokemon_icons_7v", {f"{KEY}_3": icon_frame(os.path.join(SRC, "essentials", "Icons shiny", "MELMETAL_2.png"))}, (40, 30))


if __name__ == "__main__":
    install_essentials()
    install_pokerogue()
    print("done")
