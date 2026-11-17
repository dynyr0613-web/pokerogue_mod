# Converts our Mega sprites, stone icons and text into PokeRogue's asset and locale formats.
import json, os, shutil
from PIL import Image

ESS = r"C:\Users\jaehe\OneDrive\바탕 화면\Pokemon Essentials v21.1 2023-07-30\Graphics"
GAME = r"D:\PokeRogueDev\pokerogue"
IMG = os.path.join(GAME, "assets", "images")
MEGAS = [("CHARIZARD_4", 6, "mega-z", 1), ("GALLADE_2", 475, "mega-z", 4), ("MELMETAL_2", 809, "mega", 7),
         ("BAXCALIBUR_2", 998, "mega-z", 9),
         # Mega Archaludon has no art of its own yet, so it borrows the base form's sprites
         ("ARCHALUDON", 1018, "mega", 9)]
STONES = {"CHARIZARDITEZ": "charizardite_z", "BAXCALIBRITEZ": "baxcalibrite_z", "GALLADITEZ": "galladite_z",
          "MELMETALITE": "melmetalite", "ARCHALUDONITE": "archaludonite"}


def downscale(path, factor):
    im = Image.open(path).convert("RGBA")
    return im.resize((im.width // factor, im.height // factor), Image.NEAREST)


def write_sprite(im, out):
    box = im.getbbox()
    im = im.crop(box)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    im.save(out + ".png")
    w, h = im.size
    data = {"textures": [{"image": os.path.basename(out) + ".png", "format": "RGBA8888", "size": {"w": w, "h": h}, "scale": 1,
                          "frames": [{"filename": "0001.png", "rotated": False, "trimmed": False, "sourceSize": {"w": w, "h": h},
                                      "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h}, "frame": {"x": 0, "y": 0, "w": w, "h": h}}]}],
            "meta": {"app": "tools/port/install_assets.py", "version": "3.0"}}
    with open(out + ".json", "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, indent="\t")
        f.write("\n")


def add_to_atlas(name, frames, source):
    """Appends images below an atlas and registers them as trimmed frames."""
    png = os.path.join(IMG, name + ".png")
    js = os.path.join(IMG, name + ".json")
    data = json.load(open(js, encoding="utf-8"))
    tex = data["textures"][0]
    have = {f["filename"] for f in tex["frames"]}
    frames = {k: v for k, v in frames.items() if k not in have}
    if not frames:
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
    with open(js, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, indent="\t", ensure_ascii=False)
        f.write("\n")


icons = {}
for ess, num, key, gen in MEGAS:
    stem = f"{num}-{key}"
    for sub, folder, factor in [("Front", "", 2), ("Front shiny", "shiny", 2), ("Back", "back", 3), ("Back shiny", os.path.join("back", "shiny"), 3)]:
        write_sprite(downscale(os.path.join(ESS, "Pokemon", sub, ess + ".png"), factor), os.path.join(IMG, "pokemon", folder, stem))
    for sub, name in [("Icons", f"{num}-{key}"), ("Icons shiny", f"{num}s-{key}")]:
        im = Image.open(os.path.join(ESS, "Pokemon", sub, ess + ".png")).convert("RGBA").crop((0, 0, 64, 64))
        im = im.resize((32, 32), Image.NEAREST)
        part = im.crop(im.getbbox())
        canvas = Image.new("RGBA", (40, 30), (0, 0, 0, 0))
        canvas.paste(part, ((40 - part.width) // 2, 30 - part.height), part)
        icons.setdefault(gen, {})[name] = canvas
    cry = os.path.join(GAME, "assets", "audio", "cry")
    src = {6: "6-mega-y", 475: "475-mega", 809: "809", 998: "998-mega", 1018: "1018"}[num]
    target = os.path.join(cry, stem + ".m4a")
    if not os.path.exists(target):
        shutil.copy2(os.path.join(cry, src + ".m4a"), target)
for gen, frames in icons.items():
    add_to_atlas(f"pokemon_icons_{gen}", frames, (40, 30))

stones = {}
for ess, key in STONES.items():
    im = Image.open(os.path.join(ESS, "Items", ess + ".png")).convert("RGBA")
    stones[key] = im.resize((32, 32), Image.NEAREST)
add_to_atlas("items", stones, (32, 32))

AB = {
    "steelBody": ("Steel Body", "Ignores the target's stat changes and is immune to status moves from others.", "강철몸", "상대의 능력 변화를 무시하며, 상대의 변화 기술을 받지 않는다."),
    "fortitude": ("Fortitude", "Raises Sp. Def by one stage when hit by an attack.", "인내", "공격을 받으면 특수방어가 올라간다."),
    "deadeye": ("Deadeye", "Raises the critical hit ratio by two stages.", "정조준", "급소 랭크가 2단계 올라간다."),
    "galeHerald": ("Gale Herald", "Whips up a Tailwind on entering battle.", "바람몰이", "등장했을 때 순풍을 일으킨다."),
    "polarLight": ("Polar Light", "Sets up Aurora Veil on entering battle.", "극광", "등장했을 때 오로라베일을 펼친다."),
    "footwork": ("Footwork", "Powers up kicking moves.", "발재간", "차기 기술의 위력이 올라간다."),
    "scorch": ("Scorch", "In harsh sunlight, boosts Attack but loses HP every turn.", "작열", "날씨가 맑으면 공격이 올라가지만 매 턴 HP가 줄어든다."),
    "turboEngine": ("Turbo Engine", "Turns the sunlight harsh on entry and boosts Sp. Atk in it.", "터보엔진", "등장했을 때 날씨를 맑게 하고, 맑을 때 특수공격이 올라간다."),
    "goldenPulse": ("Golden Pulse", "Sets Electric Terrain on entry and boosts Attack in it.", "금빛고동", "등장했을 때 일렉트릭필드를 깔고, 그 필드에서 공격이 올라간다."),
    "overawe": ("Overawe", "Lowers the opposing Pokémon's Sp. Atk on entering battle.", "위압", "등장했을 때 상대의 특수공격을 낮춘다."),
    "lastStand": ("Last Stand", "Below half HP, raises all stats but can no longer flee or switch.", "결사항전", "HP가 절반 아래로 떨어지면 모든 능력이 올라가지만 도망치거나 교체할 수 없게 된다."),
    "lightThief": ("Light Thief", "On entering battle, steals all of the opposing side's raised stat stages.", "빛강탈", "등장했을 때 상대가 올린 능력 변화를 모두 빼앗는다."),
    "bladeDance": ("Blade Dance", "Sharply raises Attack on entering battle, once per battle.", "검무", "배틀에서 한 번, 등장했을 때 공격이 크게 올라간다."),
    "ironFortress": ("Iron Fortress", "Sharply raises Defense on entering battle, once per battle.", "철옹성", "배틀에서 한 번, 등장했을 때 방어가 크게 올라간다."),
    "shrapnel": ("Shrapnel", "Scatters Stealth Rock when hit by a physical attack.", "돌파편", "물리 공격을 받으면 스텔스록을 뿌린다."),
    "warMachine": ("War Machine", "Raises all stats on entering battle, once per battle.", "전투 병기", "배틀에서 한 번, 등장했을 때 모든 능력이 올라간다."),
    "frostfire": ("Frostfire", "Fire-type moves become Ice-type and are slightly stronger.", "빙염", "불꽃타입 기술이 얼음타입이 되고 위력이 조금 올라간다."),
    "hiltCannon": ("Hilt Cannon", "Powers up pulse and beam moves.", "칼자루포", "파동 기술과 빔 기술의 위력이 올라간다."),
    "mindBlade": ("Mind Blade", "Physical slicing moves are calculated with Sp. Atk.", "심검", "베는 물리 기술을 특수공격으로 계산한다."),
}
ITEMS = {"CHARIZARDITE_Z": ("Charizardite Z", "리자몽나이트Z"), "BAXCALIBRITE_Z": ("Baxcalibrite Z", "드닐레이브나이트Z"), "GALLADITE_Z": ("Galladite Z", "엘레이드나이트Z"),
         "MELMETALITE": ("Melmetalite", "멜메탈나이트"), "ARCHALUDONITE": ("Archaludonite", "브리두라스나이트")}
PASSIVE_LABEL = ("Switch passive to {{passive}}", "패시브 변경: {{passive}}")


def edit(lang, name, fn):
    path = os.path.join(GAME, "locales", lang, name)
    raw = open(path, encoding="utf-8", newline="").read()
    data = json.loads(raw)
    fn(data)
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if "\r\n" in raw:
        text = text.replace("\n", "\r\n")
    open(path, "w", encoding="utf-8", newline="").write(text)


for idx, lang in ((0, "en"), (1, "ko")):
    def abilities(d):
        for key, v in AB.items():
            d[key] = {"name": v[idx * 2], "description": v[idx * 2 + 1]}
    edit(lang, "ability.json", abilities)

    def items(d):
        for key, v in ITEMS.items():
            d["FormChangeItem"][key] = v[idx]
    edit(lang, "modifier-type.json", items)

    def labels(d):
        d["changePassive"] = PASSIVE_LABEL[idx]
    edit(lang, "starter-select-ui-handler.json", labels)
print("assets and text installed")
