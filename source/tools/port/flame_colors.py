"""
Items V1 + V2 (2026-11-20): colour copies of the flame sheets of PokeRogue's Fire move animations.
The user: "V1 실행", "V2 - 실행", "V4 - x, 메가리자몽 y가 쓰는 불 기술 정도만 흰색 변환".

Each sheet below gets one copy per colour, "<sheet> (<colour>).png" next to it in assets/images/battle_anims.
Only the flame pixels change: a colour counts as flame when its hue is red to yellow (330..75 degrees) and it is not
grey (saturation >= 0.2). Every other colour (the grey fist of the elemental punches, white fangs, white cores and
sparks, the blue of an ice frame) stays as it is, and so does the alpha of every pixel.

- blue / purple / green: the hue is mapped along the flame (dark red rim -> the deep shade, orange body -> the middle,
  yellow core -> the light shade), saturation kept, and the brightness set so the colour's luma (Rec. 601) is the
  original's: the dark rim stays dark (the outline stays readable) and the hot core stays light.
- white: luma lifted to 1 - 0.62 * (1 - luma) ^ 1.6 (rim ~0.57, body ~0.8, core ~0.95) with a faint cool tint at the
  rim only (hue 215, saturation 0.12 fading to 0 at the core): white flames whose outline still shows on light
  backgrounds.

Palette sheets keep their palette indices (only the palette entries change); RGBA sheets are mapped pixel by pixel.

Usage: python -I flame_colors.py <pokerogue dir> [<preview dir>]
"""

import colorsys
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

# Sheets used by Fire moves' animations (the game swaps them only when the move's actual type is Fire):
# PRAS- Fire: 25 Fire moves + Inferno Overdrive; the sheet is shared with Outrage, Dragon Rage, Lash Out, Poltergeist,
# Beak Blast and Malicious Moonsault, which never swap. Elemental Punch / Fangs and Blaze Kick hold the flames of
# Fire Punch / Fire Fang / Blaze Kick next to the frames of their other-type siblings. CFRU- Max Flare: Max Flare and
# G-Max Centiferno (CFRU's alias). CFRU- G-Max Wildfire: G-Max Wildfire, which a Dynamax Candy gives every Charizard's
# Fire slot (Mega Charizard X / Y included).
SHEETS = [
    "PRAS- Fire",
    "PRAS- Eruption",
    "PRAS- Fire Spin",
    "PRAS- Magma Storm",
    "PRAS- Shell Trap",
    "PRAS- Fusion Flare",
    "PRAS- Elemental Punch",
    "PRAS- Elemental Fangs",
    "PRAS- Blaze Kick",
    "CFRU- Max Flare",
    "CFRU- G-Max Wildfire",
]

# (hue at the rim, hue at the core) in degrees
HUES = {
    "blue": (232, 192),
    "purple": (268, 298),
    "green": (132, 82),
}
COLOURS = ["blue", "white", "purple", "green"]


def luma(r: float, g: float, b: float) -> float:
    return 0.299 * r + 0.587 * g + 0.114 * b


def is_flame(r: int, g: int, b: int) -> bool:
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    deg = h * 360
    return s >= 0.2 and v >= 0.05 and (deg <= 75 or deg >= 330)


def recolour(rgb: tuple[int, int, int], colour: str) -> tuple[int, int, int]:
    r, g, b = rgb
    if not is_flame(r, g, b):
        return rgb
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    y = luma(r / 255, g / 255, b / 255)
    deg = h * 360
    signed = deg if deg < 180 else deg - 360  # -30 .. 75
    t = min(1.0, max(0.0, (signed + 15) / 75))  # 0 at the dark red rim, 1 at the yellow core
    if colour == "white":
        # near white body, a mid slate-grey rim (a faint cool tint, fading to none at the core) so the outline stays
        y2 = 1 - 0.62 * (1 - y) ** 1.6
        h2, s2 = 215 / 360, 0.12 * (1 - t)
        # at hue h2, saturation s2: luma(v=1) = 1 - s2 * (1 - luma of the pure hue)
        pure = luma(*colorsys.hsv_to_rgb(h2, 1, 1))
        top = 1 - s2 * (1 - pure)
        v2 = min(1.0, y2 / top)
        out = colorsys.hsv_to_rgb(h2, s2, v2)
        return tuple(round(c * 255) for c in out)
    rim, core = HUES[colour]
    h2 = (rim + (core - rim) * t) / 360
    pure = luma(*colorsys.hsv_to_rgb(h2, 1, 1))
    s2 = s
    top = 1 - s2 * (1 - pure)
    if top < y:
        # too light for this saturation at full brightness: drop saturation until the luma fits
        s2 = (1 - y) / (1 - pure)
        top = y
    v2 = min(1.0, y / top)
    out = colorsys.hsv_to_rgb(h2, s2, v2)
    return tuple(round(c * 255) for c in out)


def make_copy(src_path: Path, colour: str, out_path: Path) -> None:
    src = Image.open(src_path)
    if src.mode == "P":
        pal = src.getpalette()
        new_pal = []
        for i in range(len(pal) // 3):
            new_pal += list(recolour(tuple(pal[i * 3 : i * 3 + 3]), colour))
        out = src.copy()
        out.putpalette(new_pal)
        params = {}
        if "transparency" in src.info:
            params["transparency"] = src.info["transparency"]
        out.save(out_path, optimize=True, **params)
        return
    assert src.mode == "RGBA", (src_path, src.mode)
    cache: dict = {}
    data = []
    for r, g, b, a in src.convert("RGBA").get_flattened_data():
        if a == 0:
            data.append((r, g, b, a))
            continue
        key = (r, g, b)
        if key not in cache:
            cache[key] = recolour(key, colour)
        data.append((*cache[key], a))
    out = Image.new("RGBA", src.size)
    out.putdata(data)
    out.save(out_path, optimize=True)


def frame(sheet: Image.Image, index: int) -> Image.Image:
    cols = sheet.width // 96
    x, y = (index % cols) * 96, (index // cols) * 96
    return sheet.crop((x, y, x + 96, y + 96))


def render_flamethrower(root: Path, sheet_name: str, frames: list[int], out_path: Path, label: str) -> Image.Image:
    """Draws frames of flamethrower.json (player side) as the game places them with both Pokemon on their default spots"""
    anim = json.loads((root / "assets/battle-anims/flamethrower.json").read_text(encoding="utf-8"))[0]
    sheet = Image.open(root / "assets/images/battle_anims" / f"{sheet_name}.png").convert("RGBA")
    tiles = []
    for bg in [(52, 60, 76, 255), (214, 226, 236, 255)]:
        for fi in frames:
            canvas = Image.new("RGBA", (200, 120), bg)
            d = ImageDraw.Draw(canvas)
            # user at (106, 116), target at (234, 52) in the game's anim space; this crop starts at (70, 10)
            ox, oy = 70, 10
            d.ellipse((106 - ox - 14, 116 - oy - 14, 106 - ox + 14, 116 - oy + 14), outline=(120, 120, 120, 255))
            d.ellipse((234 - ox - 14, 52 - oy - 14, 234 - ox + 14, 52 - oy + 14), outline=(120, 120, 120, 255))
            for cel in anim["frames"][fi]:
                if cel["target"] != 2 or not cel.get("visible", True):
                    continue
                img = frame(sheet, cel["graphicFrame"])
                zx, zy = cel["zoomX"] / 100, cel["zoomY"] / 100
                if zx != 1 or zy != 1:
                    img = img.resize((max(1, round(96 * zx)), max(1, round(96 * zy))), Image.NEAREST)
                if cel.get("mirror"):
                    img = img.transpose(Image.FLIP_LEFT_RIGHT)
                if cel.get("angle"):
                    img = img.rotate(cel["angle"], resample=Image.NEAREST, expand=True)
                alpha = cel.get("opacity", 255) / 255
                if alpha < 1:
                    a = img.getchannel("A").point(lambda p: round(p * alpha))
                    img.putalpha(a)
                x = cel["x"] + 106 - ox - img.width // 2
                y = cel["y"] + 116 - oy - img.height // 2
                canvas.alpha_composite(img, (round(x), round(y)))
            tiles.append(canvas)
    strip = Image.new("RGBA", (200 * len(frames), 120 * 2 + 14), (0, 0, 0, 255))
    ImageDraw.Draw(strip).text((4, 1), label, fill=(255, 255, 255, 255))
    for i, tile in enumerate(tiles):
        strip.paste(tile, ((i % len(frames)) * 200, 14 + (i // len(frames)) * 120))
    strip = strip.resize((strip.width * 2, strip.height * 2), Image.NEAREST)
    strip.save(out_path)
    return strip


def main() -> None:
    root = Path(sys.argv[1])
    preview = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    folder = root / "assets/images/battle_anims"
    for name in SHEETS:
        for colour in COLOURS:
            make_copy(folder / f"{name}.png", colour, folder / f"{name} ({colour}).png")
    print("sheets ok")
    if preview:
        preview.mkdir(parents=True, exist_ok=True)
        frames = [3, 7, 11, 14]
        strips = [render_flamethrower(root, "PRAS- Fire", frames, preview / "flamethrower_orange.png", "original")]
        for colour in COLOURS:
            strips.append(
                render_flamethrower(
                    root, f"PRAS- Fire ({colour})", frames, preview / f"flamethrower_{colour}.png", colour
                )
            )
        sheet = Image.new("RGBA", (strips[0].width, sum(s.height for s in strips)), (0, 0, 0, 255))
        y = 0
        for s in strips:
            sheet.paste(s, (0, y))
            y += s.height
        sheet.save(preview / "flamethrower_all.png")
        # every copied sheet next to its original, for checking the other sheets
        for name in SHEETS:
            src = Image.open(folder / f"{name}.png").convert("RGBA")
            row = Image.new("RGBA", (src.width * 5 + 40, src.height), (52, 60, 76, 255))
            row.alpha_composite(src, (0, 0))
            for i, colour in enumerate(COLOURS):
                row.alpha_composite(Image.open(folder / f"{name} ({colour}).png").convert("RGBA"), ((i + 1) * (src.width + 10), 0))
            row.save(preview / f"sheet_{name.replace(' ', '_')}.png")
        print("previews ok")


if __name__ == "__main__":
    main()
