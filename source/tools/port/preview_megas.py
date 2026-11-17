# Builds one sheet of the converted Mega sprites, icons and stones, on a neutral background, to check them by eye.
import json, os
from PIL import Image

IMG = r"D:\PokeRogueDev\pokerogue\assets\images"
OUT = r"D:\PokeRogueDev\tools\port\megas_preview.png"
MEGAS = [("6-mega-z", 1), ("475-mega-z", 4), ("809-mega", 7), ("998-mega-z", 9), ("1018-mega", 9)]
sheet = Image.new("RGBA", (5 * 112 * 2, 4 * 112 * 2), (120, 150, 170, 255))


def frame(atlas, name):
    data = json.load(open(os.path.join(IMG, atlas + ".json"), encoding="utf-8"))
    png = Image.open(os.path.join(IMG, atlas + ".png")).convert("RGBA")
    for f in data["textures"][0]["frames"]:
        if f["filename"] == name:
            b = f["frame"]
            return png.crop((b["x"], b["y"], b["x"] + b["w"], b["y"] + b["h"]))
    raise KeyError(name)


def put(im, col, row):
    im = im.resize((im.width * 2, im.height * 2), Image.NEAREST)
    x = col * 224 + (224 - im.width) // 2
    y = row * 224 + (224 - im.height) // 2
    sheet.paste(im, (x, y), im)


for col, (stem, gen) in enumerate(MEGAS):
    for row, sub in enumerate(["", "shiny", "back"]):
        put(Image.open(os.path.join(IMG, "pokemon", sub, stem + ".png")).convert("RGBA"), col, row)
    num, _, key = stem.partition("-")
    icon = frame(f"pokemon_icons_{gen}", stem)
    shiny = frame(f"pokemon_icons_{gen}", f"{num}s-{key}")
    strip = Image.new("RGBA", (icon.width + shiny.width + 4, max(icon.height, shiny.height)), (0, 0, 0, 0))
    strip.paste(icon, (0, 0))
    strip.paste(shiny, (icon.width + 4, 0))
    put(strip, col, 3)
for i, name in enumerate(["charizardite_z", "galladite_z", "melmetalite", "baxcalibrite_z", "archaludonite"]):
    im = frame("items", name)
    sheet.paste(im, (i * 224 + 8, 3 * 224 + 8), im)
sheet.save(OUT)
print(OUT, sheet.size)
