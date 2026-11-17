# Local fork (2026-11-18): PokéSprite item icons for the fork's own items, one installer for all of them.
"""Install PokéSprite's 32x32 item icons into the fork's `items` atlas (2026-11-18).

    py install_pokesprite_icons.py <game folder>      e.g. D:/PokeRogueDev/pokerogue/assets, or an installed
                                                      resources/game (the folder whose images/ holds items.json)

The user: "아이콘은 전부 수정하고" / "아이콘 화풍은 포케스프라이트로 통일". The icons the fork took from Cobblemon /
Cobblemon: Mega Showdown (16x16 textures scaled 2x), shrank from Essentials (48x48 halved) or from PokeAPI (64x64
halved) become the main-series art PokeRogue's own icons come from: PokéSprite (https://github.com/msikma/pokesprite,
items/...), 32x32 originals copied byte for byte into item-icons/ next to this script as
pokesprite_<PokéSprite folder>_<file>.png. They are drawn at scale 1 like PokeRogue's own icons
(src/ui/utils/item-icon-scale.ts has no entries for them any more).

  IV candies  health_candy ... quick_candy  <- av-candy/{health,mighty,tough,smart,courage,quick}.png
              (HP, Atk, Def, SpAtk, SpDef, Spe, as IvCandyModifierType.items)
  EV items    power_weight ... power_anklet <- ev-item/power-{weight,bracer,belt,lens,band,anklet}.png
  held items  throat_spray, assault_vest, life_orb, choice_band <- hold-item/<the same names, dashed>.png
  Z-Moves     z_ring <- key-item/z-ring.png, dynamax_candy <- other-item/dynamax-candy.png,
              the 34 reward crystals <- z-crystals/<name>-z--bag.png (ultranecrozium_z_crystal <-
              ultranecrozium-z--bag.png; Necrozma's form change item `ultranecrozium_z` keeps PokeRogue's own frame)
  Mark Charm  mark_charm <- key-item/mark-charm.png

Derived by recolouring only (no drawing):
  bulletproof_vest  the PokéSprite Assault Vest with its reds turned grey (BULLETPROOF_GREY; not a main-series item)
  charizardite_z, galladite_z, baxcalibrite_z, archaludonite (the fork's custom Mega Stones; no official art exists):
                    PokeRogue's own official 14x14 stones (charizardite_x, galladite, baxcalibrite, garchompite) with
                    their palettes swapped, the way the official Z-A stones are swaps of older ones (garchompite_z is
                    garchompite's pixels in other colours). Each table keeps the colours of the earlier 18x18 icon
                    (Essentials stones recoloured): for every base colour, the colour the old icon had at the same
                    places (area-weighted vote), the outline and the white highlight kept. melmetalite, the user's own
                    art, is not touched.

Atlas: every icon is a 32x32 image; the PokéSprite ones go in untrimmed 32x32 frames, the stones in trimmed 16x16
frames at (8, 8) like the official stones. An existing frame is redrawn in its own slot (its old pixels cleared first)
when the new one fits there, otherwise (and for a frame the atlas lacks) it goes in a new row under everything.
items.json is read in either style it has had (TexturePacker's tab indent + CRLF with a final bare LF, or the compact
one install_mark_charm_icon.py wrote on 2026-11-17), each checked to re-serialise byte for byte, and always written
back in the TexturePacker style the other port scripts (install_vest_icons.update_atlas, install_user_item_icons.py)
expect. Afterwards every installed frame is read back and every other frame is checked unchanged. Loose copies go to
images/items/<name>.png (palette PNG, index 0 transparent) when that folder exists. Re-runs are idempotent.
"""
import json
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ICON_DIR = HERE / "item-icons"
SIZE = 32


def _ps(folder: str, name: str) -> str:
    return f"pokesprite_{folder}_{name}.png"


Z_CRYSTALS = [
    "normalium", "fightinium", "flyinium", "poisonium", "groundium", "rockium", "buginium", "ghostium", "steelium",
    "firium", "waterium", "grassium", "electrium", "psychium", "icium", "dragonium", "darkinium", "fairium",
    "pikanium", "aloraichium", "decidium", "incinium", "primarium", "eevium", "snorlium", "mewnium", "tapunium",
    "marshadium", "kommonium", "lycanium", "mimikium", "solganium", "lunalium",
]

# atlas frame -> PokéSprite original in item-icons/
POKESPRITE = {
    "health_candy": _ps("av-candy", "health"),
    "mighty_candy": _ps("av-candy", "mighty"),
    "tough_candy": _ps("av-candy", "tough"),
    "smart_candy": _ps("av-candy", "smart"),
    "courage_candy": _ps("av-candy", "courage"),
    "quick_candy": _ps("av-candy", "quick"),
    "power_weight": _ps("ev-item", "power-weight"),
    "power_bracer": _ps("ev-item", "power-bracer"),
    "power_belt": _ps("ev-item", "power-belt"),
    "power_lens": _ps("ev-item", "power-lens"),
    "power_band": _ps("ev-item", "power-band"),
    "power_anklet": _ps("ev-item", "power-anklet"),
    "throat_spray": _ps("hold-item", "throat-spray"),
    "assault_vest": _ps("hold-item", "assault-vest"),
    "life_orb": _ps("hold-item", "life-orb"),
    "choice_band": _ps("hold-item", "choice-band"),
    "z_ring": _ps("key-item", "z-ring"),
    "dynamax_candy": _ps("other-item", "dynamax-candy"),
    "mark_charm": _ps("key-item", "mark-charm"),
    **{f"{z}_z": _ps("z-crystals", f"{z}-z--bag") for z in Z_CRYSTALS},
    "ultranecrozium_z_crystal": _ps("z-crystals", "ultranecrozium-z--bag"),
}

# Bulletproof Vest: PokéSprite's Assault Vest reds -> grey (the mapping install_vest_icons.py used on the Essentials vest,
# keyed to PokéSprite's colours); the outline (32,32,32) and the dark grey (65,65,65) stay
BULLETPROOF_GREY = {
    (205, 82, 82): (150, 152, 158),  # lit body
    (180, 57, 65): (118, 120, 126),  # body
    (148, 49, 57): (88, 90, 96),  # shade
    (98, 74, 82): (84, 84, 90),  # collar shadow
}

# custom Mega Stone -> (official base stone in the atlas, base colour -> new colour); colours not listed stay
STONES = {
    "charizardite_z": ("charizardite_x", {
        (65, 67, 67): (66, 70, 68),
        (41, 120, 166): (114, 167, 160),
        (81, 118, 174): (127, 165, 185),
        (91, 120, 253): (155, 229, 255),
        (62, 158, 253): (155, 247, 255),
        (161, 164, 170): (206, 208, 211),
        (72, 199, 249): (155, 255, 250),
        (186, 203, 250): (228, 248, 255),
        (160, 246, 249): (192, 255, 238),
    }),
    # the old icon has no white: its highlight and lower rim are light grey, so white goes grey here too
    "galladite_z": ("galladite", {
        (135, 127, 127): (96, 111, 88),
        (83, 161, 160): (109, 56, 123),
        (218, 77, 130): (70, 166, 55),
        (128, 162, 166): (121, 68, 135),
        (127, 173, 187): (128, 84, 135),
        (235, 147, 157): (114, 166, 107),
        (183, 201, 210): (160, 130, 160),
        (251, 176, 179): (134, 178, 119),
        (224, 228, 227): (172, 157, 172),
        (251, 215, 217): (155, 184, 148),
        (237, 232, 227): (164, 178, 178),
        (255, 255, 255): (191, 191, 191),
    }),
    # the old icon's red streak between the navy swirl and the purple band sits where baxcalibrite has its purple edge
    "baxcalibrite_z": ("baxcalibrite", {
        (38, 99, 138): (38, 49, 80),
        (117, 99, 164): (164, 42, 1),
        (111, 146, 177): (102, 122, 140),
        (162, 141, 207): (124, 85, 157),
        (161, 166, 185): (20, 31, 62),
        (118, 170, 228): (90, 96, 116),
        (177, 178, 225): (132, 156, 168),
        (199, 205, 229): (144, 119, 164),
        (181, 228, 232): (132, 156, 168),
        (228, 250, 253): (152, 166, 172),
    }),
    # garchompite already has the old icon's layout of colours: grey-blue body, red swirl, yellow band
    "archaludonite": ("garchompite", {
        (136, 46, 53): (175, 100, 100),
        (77, 78, 80): (96, 100, 129),
        (206, 39, 22): (190, 102, 102),
        (96, 88, 91): (112, 100, 129),
        (102, 98, 125): (138, 158, 213),
        (133, 129, 73): (152, 148, 119),
        (246, 173, 25): (228, 186, 128),
        (228, 124, 124): (198, 139, 139),
        (250, 211, 52): (236, 219, 135),
        (251, 231, 160): (236, 227, 211),
    }),
}
# colours a base stone may have besides its table: the outline and the white highlight
STONE_KEEP = {(32, 32, 32), (255, 255, 255)}
# the trimmed box of the official stones' frames (their 14x14 art sits at (9, 9) inside it)
STONE_TRIM = (8, 8, 24, 24)

# ---------------------------------------------------------------------------------------------------------- helpers


def pixels(im: Image.Image):
    px = im.load()
    return [(x, y, px[x, y]) for y in range(im.height) for x in range(im.width)]


def hard_alpha(im: Image.Image, what: str) -> Image.Image:
    im = im.convert("RGBA")
    soft = [p for _, _, p in pixels(im) if 0 < p[3] < 255]
    if soft:
        raise SystemExit(f"{what}: {len(soft)} half-transparent pixels; expected hard alpha")
    px = im.load()
    for x, y, p in pixels(im):
        if p[3] == 0:
            px[x, y] = (0, 0, 0, 0)  # transparent pixels made plain, as the atlas stores them
    return im


def recolour(im: Image.Image, table: dict, keep: set, what: str) -> Image.Image:
    out = im.copy()
    px = out.load()
    for x, y, p in pixels(out):
        if p[3] == 0:
            px[x, y] = (0, 0, 0, 0)
            continue
        if p[3] != 255:
            raise SystemExit(f"{what}: alpha {p[3]} at {(x, y)}; expected hard alpha")
        if p[:3] in table:
            px[x, y] = table[p[:3]] + (255,)
        elif p[:3] not in keep:
            raise SystemExit(f"{what}: colour {p[:3]} at {(x, y)} is in no table; has the base art changed?")
    return out


def to_palette_png(im: Image.Image, path: Path) -> None:
    """Save like items/eviolite.png: mode P, index 0 transparent, one entry per colour."""
    colours = sorted({p for _, _, p in pixels(im) if p[3] > 0})
    if len(colours) >= 256:
        raise SystemExit(f"{path.name}: {len(colours)} colours")
    index = {c: i + 1 for i, c in enumerate(colours)}
    pal = Image.new("P", im.size, 0)
    pal.putpalette([0, 0, 0] + [v for c in colours for v in c[:3]])
    pp = pal.load()
    for x, y, p in pixels(im):
        if p[3] > 0:
            pp[x, y] = index[p]
    pal.save(path, transparency=0, optimize=True)


def read_atlas(path: Path) -> dict:
    """Parse items.json after checking that one of its two known styles re-serialises it byte for byte."""
    raw = path.read_bytes()
    data = json.loads(raw)
    texture_packer = json.dumps(data, indent="\t", ensure_ascii=False).replace("\n", "\r\n").encode("utf-8")
    compact = json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if raw.startswith(texture_packer) and not raw[len(texture_packer):].strip(b"\r\n"):
        return data
    if raw.rstrip(b"\r\n") == compact:
        return data
    raise SystemExit(f"{path} is in neither known style; refusing to rewrite it")


def write_atlas(path: Path, data: dict) -> None:
    """TexturePacker style: tab indent, CRLF, the final newline a bare LF (as upstream's file)."""
    text = json.dumps(data, indent="\t", ensure_ascii=False).replace("\n", "\r\n").encode("utf-8") + b"\n"
    json.loads(text)
    path.write_bytes(text)


def frame_image(sheet: Image.Image, frame: dict) -> Image.Image:
    """A frame on its untrimmed source box"""
    r, s, src = frame["frame"], frame["spriteSourceSize"], frame["sourceSize"]
    out = Image.new("RGBA", (src["w"], src["h"]), (0, 0, 0, 0))
    out.paste(sheet.crop((r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"])), (s["x"], s["y"]))
    return out


# ---------------------------------------------------------------------------------------------------------- icons


def build_icons(sheet: Image.Image, frames: dict) -> dict:
    """name -> (32x32 RGBA icon, trimmed box or None)"""
    icons = {}
    for name, file in POKESPRITE.items():
        im = hard_alpha(Image.open(ICON_DIR / file), file)
        if im.size != (SIZE, SIZE):
            raise SystemExit(f"{file}: {im.size}, expected {SIZE}x{SIZE}")
        icons[name] = (im, None)
    icons["bulletproof_vest"] = (recolour(icons["assault_vest"][0], BULLETPROOF_GREY, {(32, 32, 32), (65, 65, 65)},
                                          "bulletproof_vest"), None)
    for name, (base, table) in STONES.items():
        if base not in frames:
            raise SystemExit(f"{name}: the base stone {base} is not in the atlas")
        art = frame_image(sheet, frames[base])
        if art.size != (SIZE, SIZE) or art.getbbox() != (9, 9, 23, 23):
            raise SystemExit(f"{name}: {base} is not the official 14x14 stone ({art.size}, {art.getbbox()})")
        icons[name] = (recolour(art, table, STONE_KEEP, f"{name} <- {base}"), STONE_TRIM)
    return icons


def place(sheet: Image.Image, frames: dict, data: dict, icons: dict) -> Image.Image:
    texture = data["textures"][0]
    missing = []
    for name, (im, trim) in icons.items():
        box = trim or (0, 0, SIZE, SIZE)
        w, h = box[2] - box[0], box[3] - box[1]
        frame = frames.get(name)
        if frame is not None and frame["frame"]["w"] >= w and frame["frame"]["h"] >= h and not frame["rotated"]:
            r = frame["frame"]
            sheet.paste(Image.new("RGBA", (r["w"], r["h"]), (0, 0, 0, 0)), (r["x"], r["y"]))  # clear the old slot
            x, y = r["x"], r["y"]
        else:
            if frame is not None:  # too small a slot: clear it and drop the frame
                r = frame["frame"]
                sheet.paste(Image.new("RGBA", (r["w"], r["h"]), (0, 0, 0, 0)), (r["x"], r["y"]))
                texture["frames"].remove(frame)
            missing.append(name)
            continue
        frame.update({
            "trimmed": trim is not None,
            "sourceSize": {"w": SIZE, "h": SIZE},
            "spriteSourceSize": {"x": box[0], "y": box[1], "w": w, "h": h},
            "frame": {"x": x, "y": y, "w": w, "h": h},
        })
        part = im.crop(box)
        sheet.paste(part, (x, y), part)
    if missing:
        # new rows of 32x32 cells under everything, 1px apart like the rows the earlier scripts added
        per_row = max(1, (sheet.width + 1) // (SIZE + 1))
        top = sheet.height + 1
        rows = (len(missing) + per_row - 1) // per_row
        grown = Image.new("RGBA", (sheet.width, top + rows * (SIZE + 1) - 1), (0, 0, 0, 0))
        grown.paste(sheet, (0, 0))
        sheet = grown
        for i, name in enumerate(missing):
            im, trim = icons[name]
            box = trim or (0, 0, SIZE, SIZE)
            x, y = (i % per_row) * (SIZE + 1), top + (i // per_row) * (SIZE + 1)
            frame = {
                "filename": name,
                "rotated": False,
                "trimmed": trim is not None,
                "sourceSize": {"w": SIZE, "h": SIZE},
                "spriteSourceSize": {"x": box[0], "y": box[1], "w": box[2] - box[0], "h": box[3] - box[1]},
                "frame": {"x": x, "y": y, "w": box[2] - box[0], "h": box[3] - box[1]},
            }
            texture["frames"].append(frame)
            frames[name] = frame
            part = im.crop(box)
            sheet.paste(part, (x, y), part)
        texture["size"] = {"w": sheet.width, "h": sheet.height}
    return sheet


def install(game_folder: Path, only: set | None = None) -> None:
    """Install every icon, or only the frames named in `only` (install_mark_charm_icon.py installs just its own)"""
    images = Path(game_folder) / "images"
    atlas_path = images / "items.json"
    data = read_atlas(atlas_path)
    texture = data["textures"][0]
    sheet_path = images / texture["image"]
    sheet = Image.open(sheet_path).convert("RGBA")
    frames = {f["filename"]: f for f in texture["frames"]}
    before = {n: frame_image(sheet, f).tobytes() for n, f in frames.items()}

    icons = build_icons(sheet, frames)
    if only is not None:
        unknown = only - icons.keys()
        if unknown:
            raise SystemExit(f"no such icons: {sorted(unknown)}")
        icons = {n: v for n, v in icons.items() if n in only}
    sheet = place(sheet, frames, data, icons)
    sheet.save(sheet_path, optimize=True)
    write_atlas(atlas_path, data)

    # read everything back: the installed frames are the icons, every other frame is as it was
    data = read_atlas(atlas_path)
    sheet = Image.open(sheet_path).convert("RGBA")
    frames = {f["filename"]: f for f in data["textures"][0]["frames"]}
    for name, (im, _trim) in icons.items():
        if frame_image(sheet, frames[name]).tobytes() != im.tobytes():
            raise SystemExit(f"{name}: the atlas frame does not read back as the icon")
    changed = [n for n, b in before.items() if n not in icons and frame_image(sheet, frames[n]).tobytes() != b]
    if changed:
        raise SystemExit(f"other frames changed: {changed}")

    loose = images / "items"
    if loose.is_dir():
        for name, (im, _trim) in icons.items():
            to_palette_png(im, loose / f"{name}.png")
    print(f"{len(icons)} icons installed in {atlas_path} ({texture['size']['w']}x{texture['size']['h']})"
          + (f", loose copies in {loose}" if loose.is_dir() else ""))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    install(Path(sys.argv[1]))
