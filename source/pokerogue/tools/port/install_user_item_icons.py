# Local fork (2026-11-09): item icons made from the user's own reference pictures.
"""Install item icons built from the user's reference art into the items atlas (2026-11-09).

  D:/SpriteGen/comfyui/ComfyUI_windows_portable/python_embeded/python.exe -I install_user_item_icons.py

Icons (each a 32x32 RGBA PNG, already made):
  prism         D:/PokeRogueDev/tools/port_prism/prism_icon_32.png
                (make_prism_icon.py from the user's Prism picture; the user asked for a sharper bottom point)
  forged_steel  D:/PokeRogueDev/tools/port_forged_steel/forged_steel_icon_32.png
                (make_forged_steel_icon.py from the user's Forged Steel picture; replaces the anvil icon,
                 the user: "새 아이콘으로 바꾸죠")

  melmetalite   D:/PokeRogueDev/tools/port_melmetalite/melmetalite_icon_16.png
                (make_melmetalite_icon.py from the user's 12x12 picture, B = 16x16 on the official Mega Stone
                 silhouette; replaces the old trimmed 18x18 frame, whose pixels are cleared)

A frame that exists as an untrimmed 32x32 (forged_steel) is redrawn in place; a trimmed or other-sized one (melmetalite)
is cleared and replaced; a new one (prism) goes in the first free 32x32 slot of the
rows the fork scripts added (free_slot), or a new row under everything. Frames are untrimmed 32x32, like the vests.
items.json is rewritten only after checking that re-serialising reproduces it byte for byte (tab indent, CRLF, the
final bare LF). Every other frame is checked unchanged afterwards. The loose copy goes to assets/images/items/<name>.png.
The first run backs items.json/items.png up to D:/PokeRogueDev/tools/port/backup_items_user_icons_20261109/ (never
overwritten).
Re-runs are idempotent.
"""

import json
import os
import shutil
import sys

PORT = r"D:\PokeRogueDev\tools\port"
sys.path.insert(0, PORT)  # -I leaves script folders off sys.path; the helpers live with the older port scripts

from PIL import Image

import install_vest_icons as vest
from make_tinkaton_forge_sprite import free_slot


ICONS = [
    ("prism", r"D:\PokeRogueDev\tools\port_prism\prism_icon_32.png"),
    ("forged_steel", r"D:\PokeRogueDev\tools\port_forged_steel\forged_steel_icon_32.png"),
    # the user picked B (16x16 like the official Mega Stones) over A (native 12x12): "B안으로 가죠"
    ("melmetalite", r"D:\PokeRogueDev\tools\port_melmetalite\melmetalite_icon_16.png"),
    # 구애갑옷 (Choice Armor): the armor item shape recoloured white (tools/port_choice_armor/make_choice_armor_icon.py);
    # choice_armor_icon_32.png is a copy of the candidate in use: the user picked the 축복받은갑옷 shape and asked for its
    # grey parts in Choice Scarf blue plus shape/size experiments (armor_experiments.py); now exp/C3_F1_Z2.png
    ("choice_armor", r"D:\PokeRogueDev\tools\port_choice_armor\choice_armor_icon_32.png"),
    # 붉은진화의수정 / 푸른진화의수정: the Eviolite icon with its hue turned red / blue
    # (tools/port_evo_crystals/make_evo_crystal_icons.py)
    ("red_evolution_crystal", r"D:\PokeRogueDev\tools\port_evo_crystals\red_evolution_crystal.png"),
    ("blue_evolution_crystal", r"D:\PokeRogueDev\tools\port_evo_crystals\blue_evolution_crystal.png"),
    # 트레이닝족쇄 / 궁극유전자 / 화염가마솥: recolours of macho_brace / dna_splicers / berry_pot, variant A
    # (tools/port_new_items_1109/make_icons.py)
    ("training_shackles", r"D:\PokeRogueDev\tools\port_new_items_1109\training_shackles_A.png"),
    # 궁극유전자 redrawn on the user's request after the Cobbleverse (LumyMon) items 빛나는 복제 촉매 and 고대 DNA, used
    # only as a reference (tools/port_new_items_1109/make_ultimate_gene_icon.py); was the dna_splicers recolour
    ("ultimate_gene", r"D:\PokeRogueDev\tools\port_new_items_1109\ultimate_gene2_A.png"),
    # 화염가마솥 is an empty pot; the flaming pot (A) shows once it swallowed a Flame Orb (the user: "원래
    # 그릇만 있다가, 화염구슬을 얻으면 a안처럼 변하는걸로")
    # final: 2안's round back rim + the first empty pot's front half of the mouth (the user: "2안으로 가시죠" and
    # "아가리 아래쪽 반이 이 전에 만든 화염가마솥(평소)에서 그린거랑 똑같게"); lit = A (make_cauldron_icons.py)
    ("flame_cauldron", r"D:\PokeRogueDev\tools\port_new_items_1109\flame_cauldron_final_empty.png"),
    ("flame_cauldron_lit", r"D:\PokeRogueDev\tools\port_new_items_1109\flame_cauldron_final_lit.png"),
    # 방사성폐기물: a yellow drum with a radiation sign and green waste, drawn as a simple prop; second version with the
    # lid, ribs and bottom on one elliptical arc and the trefoil redrawn (the user's notes on A;
    # tools/port_new_items_1109/make_radioactive_waste_icon2.py); the user picked B (the smaller 7x7 trefoil) over F:
    # "그냥 b안으로 가죠"
    ("radioactive_waste", r"D:\PokeRogueDev\tools\port_new_items_1109\radioactive_waste2_B.png"),
    # 맹독증류기 (empty flask) / 맹독증류액 (purple flask): the user's own 32x32 pixel images, used as they are (2026-11-10)
    ("toxic_distiller", r"D:\PokeRogueDev\tools\port_new_items_1110\user_toxic_distiller_empty.png"),
    ("toxic_distillate", r"D:\PokeRogueDev\tools\port_new_items_1110\user_toxic_distiller_full.png"),
    # 방전코일 (grey, dull) / 초전도코일 (gold, glowing): the user's own 32x32 pixel images, used as they are (2026-11-10)
    ("discharged_coil", r"D:\PokeRogueDev\tools\port_new_items_1110\user_discharged_coil.png"),
    ("superconducting_coil", r"D:\PokeRogueDev\tools\port_new_items_1110\user_superconducting_coil.png"),
    # Local fork (2026-11-11): placeholders the user may replace with their own art (tools/port_new_items_1111/make_icons.py,
    # preview docs/new_items_1111_icon_preview.png): 네잎클로버 잎 / 네잎클로버 (drawn, simple props), 황금 네잎클로버 (the
    # clover in Golden Punch's golds), 마스터 기술머신 (tm_normal recoloured black with the Rogue Ball's colours, the user:
    # "형태는 검은색 기술머신, 로그볼과 비슷한 색조합"), 펀치글러브 (a plain red boxing glove, drawn) and 마스터 펀치글러브 (that
    # glove in black with the Rogue Ball's colours: "기존 펀치글러브 디자인을 검게 변경, 로그볼과 비슷한 색조합")
    ("four_leaf_clover_leaf", r"D:\PokeRogueDev\tools\port_new_items_1111\four_leaf_clover_leaf.png"),
    ("four_leaf_clover", r"D:\PokeRogueDev\tools\port_new_items_1111\four_leaf_clover.png"),
    ("golden_four_leaf_clover", r"D:\PokeRogueDev\tools\port_new_items_1111\golden_four_leaf_clover.png"),
    ("master_tm", r"D:\PokeRogueDev\tools\port_new_items_1111\master_tm.png"),
    ("punching_glove", r"D:\PokeRogueDev\tools\port_new_items_1111\punching_glove.png"),
    ("master_punching_glove", r"D:\PokeRogueDev\tools\port_new_items_1111\master_punching_glove.png"),
    # Local fork (2026-11-11): the second batch (tools/port_new_items_1111b/make_icons.py, preview
    # docs/new_items_1111b_icon_preview.png), placeholders the user may replace: 씨앗주머니 (berry_pouch recoloured green
    # and seed brown, the user: "열매주머니의 색깔을 조금 다르게 해서 제작"), 연료 (a red oil drum brimming with glossy
    # black oil that spills down its front, with an oil-drop mark, drawn on the Radioactive Waste drum's shape:
    # "드럼통에 담긴 기름 모양으로 합시다"; redrawn after review so the oil reads at 1x) and 정밀렌즈
    # (scope_lens in gunmetal, red and teal: "초점렌즈 색깔을 좀 바꿔서"). 파워풀허브 / 메트로놈 / 속임수주사위 / 달인의띠 use
    # the upstream icons already in the atlas
    ("seed_pouch", r"D:\PokeRogueDev\tools\port_new_items_1111b\seed_pouch.png"),
    # Local fork (2026-11-11): 연료 and 정밀렌즈 are the user's own images now ("여기 연료용으로 가져온 이미지랑 렌즈용
    # 이미지에요", "씨앗주머니는 저거 그대로 쓰죠"); the drawn fuel.png / precision_lens.png stay for reference only
    ("fuel", r"D:\PokeRogueDev\tools\port_new_items_1111b\user_fuel.png"),
    ("precision_lens", r"D:\PokeRogueDev\tools\port_new_items_1111b\user_precision_lens.png"),
    # Local fork (2026-11-11): the third batch (tools/port_new_items_1111c/make_icons.py, preview
    # docs/new_items_1111c_icon_preview.png): 클리어참 and 목스프레이 are Cobblemon 1.7.3's textures from the user's
    # Cobbleverse jar (MPL-2.0, The Cobblemon Team), scaled 2x like the Punching Glove; 부스트에너지 / 힘의머리띠 /
    # 박식안경 use the upstream icons already in the atlas
    ("clear_amulet", r"D:\PokeRogueDev\tools\port_new_items_1111c\clear_amulet.png"),
    ("throat_spray", r"D:\PokeRogueDev\tools\port_new_items_1111c\throat_spray.png"),
    # Local fork (2026-11-12): 관통 토큰 (Piercing Token), the Protection Token's coin (wl_guard_spec) with its greens in
    # the player's blue (tools/port_new_items_1112/make_icons.py, preview docs/piercing_token_icon_preview.png); a
    # placeholder the user may replace
    ("piercing_token", r"D:\PokeRogueDev\tools\port_new_items_1112\piercing_token.png"),
    # Local fork (2026-11-13): 방호 토큰 (Guard Token, 09 명세 4번), the same coin (wl_guard_spec) with its greens hue-rotated
    # to magenta, the one hue no token uses (tools/port_new_items_1113/make_guard_token_icon.py, preview
    # docs/guard_token_icon_preview.png with an orange alternative); a placeholder the user may replace
    ("guard_token", r"D:\PokeRogueDev\tools\port_new_items_1113\guard_token.png"),
    # Local fork (2026-11-12): 중량밴드 / 챔피언벨트 (Weight Band / Champion Belt), the user's own pixel art ("여기
    # 파워웨이트랑 챔피언벨트 이미지입니다"; the hyper one renamed "중량밴드"). user_weight_band.png is their 32x32 PNG as
    # sent; user_champion_belt.png is their 256x256 PNG (kept as user_champion_belt_x8.png), an exact 8x upscale of a
    # 32x32 grid, sampled back with nearest (tools/port_new_items_1112/make_belt_icons.py, preview
    # docs/belt_icons_preview.png). They replaced the earlier macho_brace-recolour placeholders: on 2026-11-12 the two
    # placeholder frames were renamed to these names in place (same sheet cells) and their loose copies deleted, a
    # one-off step no longer in this script, so the names power_weight / POWER_WEIGHT are free for the EV items
    ("weight_band", r"D:\PokeRogueDev\tools\port_new_items_1112\user_weight_band.png"),
    ("champion_belt", r"D:\PokeRogueDev\tools\port_new_items_1112\user_champion_belt.png"),
    # Local fork (2026-11-12): the six EV items (파워웨이트 / 파워리스트 / 파워벨트 / 파워렌즈 / 파워밴드 / 파워앵클릿), Cobblemon
    # 1.7.3's held item textures of the same names from the user's Cobbleverse jar (MPL-2.0, The Cobblemon Team), scaled
    # 2x like the Clear Amulet (tools/port_new_items_1112/make_ev_item_icons.py, preview docs/ev_items_icon_preview.png).
    # The user: "아이콘은 또 코블버스에서 가져온 뒤 배율만 조정하면 됩니다" (scales in src/ui/utils/item-icon-scale.ts)
    ("power_weight", r"D:\PokeRogueDev\tools\port_new_items_1112\power_weight.png"),
    ("power_bracer", r"D:\PokeRogueDev\tools\port_new_items_1112\power_bracer.png"),
    ("power_belt", r"D:\PokeRogueDev\tools\port_new_items_1112\power_belt.png"),
    ("power_lens", r"D:\PokeRogueDev\tools\port_new_items_1112\power_lens.png"),
    ("power_band", r"D:\PokeRogueDev\tools\port_new_items_1112\power_band.png"),
    ("power_anklet", r"D:\PokeRogueDev\tools\port_new_items_1112\power_anklet.png"),
    # Local fork (2026-11-16): Z-Moves and Max Moves (the user: "z링 보유 시 ... Z 크리스탈이 보상 테이블에 등록됨", "다이사탕
    # 사용 시 원하는 기술을 다이 기술로 바꿈"). Since the second install the icons are Cobblemon: Mega Showdown 1.7.3's
    # textures from the user's Cobbleverse jar (Yajat Kaul and contributors, Mega Showdown License v2.1, textures CC
    # BY-NC-SA 4.0), scaled 2x (tools/port_zmax_1116/make_cobbleverse_icons.py, preview docs/zmax_icons_preview.png).
    # The user: "아이콘은 언제나처럼 코블버스 쪽에서 빼오면 됩니다 / 거기에 다이사탕이랑 z링, z 크리스탈들 도트 이미지가 다
    # 있어요 / 이미지가 크지 않도록 배율 조절도 해주세요" (scales in src/ui/utils/item-icon-scale.ts).
    # ultranecrozium_z_crystal is the reward, a frame beside Necrozma's form change item ultranecrozium_z (left as it is).
    # The first install's recolour placeholders (make_icons.py) are kept in tools/port_zmax_1116/recolour_backup/
    *[
        (name, rf"D:\PokeRogueDev\tools\port_zmax_1116\{name}.png")
        for name in [
            "z_ring",
            "dynamax_candy",
            "normalium_z",
            "fightinium_z",
            "flyinium_z",
            "poisonium_z",
            "groundium_z",
            "rockium_z",
            "buginium_z",
            "ghostium_z",
            "steelium_z",
            "firium_z",
            "waterium_z",
            "grassium_z",
            "electrium_z",
            "psychium_z",
            "icium_z",
            "dragonium_z",
            "darkinium_z",
            "fairium_z",
            "pikanium_z",
            "aloraichium_z",
            "decidium_z",
            "incinium_z",
            "primarium_z",
            "eevium_z",
            "snorlium_z",
            "mewnium_z",
            "tapunium_z",
            "marshadium_z",
            "kommonium_z",
            "lycanium_z",
            "mimikium_z",
            "solganium_z",
            "lunalium_z",
            "ultranecrozium_z_crystal",
        ]
    ],
]
BACKUP = os.path.join(PORT, "backup_items_user_icons_20261109")
ATLAS_JSON = os.path.join(vest.IMG, "items.json")
ATLAS_PNG = os.path.join(vest.IMG, "items.png")


def frame_canvas(data: dict, sheet: Image.Image, name: str) -> Image.Image:
    """A frame rebuilt on its untrimmed source box, as Phaser places it (transparent pixels made plain)."""
    fr = next(f for f in data["textures"][0]["frames"] if f["filename"] == name)
    g, s = fr["frame"], fr["spriteSourceSize"]
    out = Image.new("RGBA", (fr["sourceSize"]["w"], fr["sourceSize"]["h"]), (0, 0, 0, 0))
    out.paste(sheet.crop((g["x"], g["y"], g["x"] + g["w"], g["y"] + g["h"])), (s["x"], s["y"]))
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            if px[x, y][3] == 0:
                px[x, y] = (0, 0, 0, 0)
    return out


def load_icon(path: str) -> Image.Image:
    icon = Image.open(path).convert("RGBA")
    assert icon.size == (vest.CANVAS, vest.CANVAS), (path, icon.size)
    px = icon.load()
    for y in range(icon.height):  # hard alpha only, plain transparent pixels
        for x in range(icon.width):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255) if a >= 128 else (0, 0, 0, 0)
    return icon


def main() -> None:
    icons = [(name, load_icon(path)) for name, path in ICONS]
    if not os.path.isdir(BACKUP):
        os.makedirs(BACKUP)
        shutil.copy2(ATLAS_JSON, os.path.join(BACKUP, "items.json"))
        shutil.copy2(ATLAS_PNG, os.path.join(BACKUP, "items.png"))
    raw = open(ATLAS_JSON, "rb").read()
    data = json.loads(raw)
    body = json.dumps(data, indent="\t", ensure_ascii=False).replace("\n", "\r\n").encode("utf-8")
    if not raw.startswith(body) or raw[len(body):].strip(b"\r\n"):
        raise SystemExit("items.json is not in the expected TexturePacker style; refusing to rewrite it")
    tail = raw[len(body):]
    tex = data["textures"][0]
    sheet = Image.open(ATLAS_PNG).convert("RGBA")
    old_size = sheet.size
    names = {n for n, _ in icons}
    before = {f["filename"]: frame_canvas(data, sheet, f["filename"]) for f in tex["frames"] if f["filename"] not in names}
    placed = []
    for name, icon in icons:
        loose = os.path.join(vest.ITEMS, name + ".png")
        vest.to_palette_png(icon, loose)
        assert list(Image.open(loose).convert("RGBA").get_flattened_data()) == list(icon.get_flattened_data()), loose
        frame = next((f for f in tex["frames"] if f["filename"] == name), None)
        if frame is not None and (frame["trimmed"] or frame["rotated"] or (frame["frame"]["w"], frame["frame"]["h"]) != icon.size):
            # an older trimmed frame (e.g. melmetalite, 18x18): clear its pixels if no other frame shares them, then
            # give the name a new untrimmed 32x32 frame below
            g = frame["frame"]
            shared = any(o is not frame and o["frame"]["x"] < g["x"] + g["w"] and g["x"] < o["frame"]["x"] + o["frame"]["w"]
                         and o["frame"]["y"] < g["y"] + g["h"] and g["y"] < o["frame"]["y"] + o["frame"]["h"] for o in tex["frames"])
            if not shared:
                sheet.paste(Image.new("RGBA", (g["w"], g["h"]), (0, 0, 0, 0)), (g["x"], g["y"]))
            tex["frames"].remove(frame)
            frame = None
        if frame is None:
            slot = free_slot(tex["frames"], sheet)
            if slot is None:
                slot = (0, sheet.height + 1)
                grown = Image.new("RGBA", (sheet.width, slot[1] + vest.CANVAS), (0, 0, 0, 0))
                grown.paste(sheet, (0, 0))
                sheet = grown
            frame = {
                "filename": name,
                "rotated": False,
                "trimmed": False,
                "sourceSize": {"w": vest.CANVAS, "h": vest.CANVAS},
                "spriteSourceSize": {"x": 0, "y": 0, "w": vest.CANVAS, "h": vest.CANVAS},
                "frame": {"x": slot[0], "y": slot[1], "w": vest.CANVAS, "h": vest.CANVAS},
            }
            tex["frames"].append(frame)
        f = frame["frame"]
        assert (f["w"], f["h"]) == icon.size and not frame["trimmed"] and not frame["rotated"], name
        sheet.paste(Image.new("RGBA", icon.size, (0, 0, 0, 0)), (f["x"], f["y"]))  # clear, then draw
        sheet.paste(icon, (f["x"], f["y"]), icon)
        placed.append((name, (f["x"], f["y"])))
    tex["size"] = {"w": sheet.width, "h": sheet.height}
    sheet.save(ATLAS_PNG)
    text = json.dumps(data, indent="\t", ensure_ascii=False).replace("\n", "\r\n").encode("utf-8") + tail
    json.loads(text)
    open(ATLAS_JSON, "wb").write(text)
    # read back: the icons are in place and every other frame is untouched
    data2 = json.loads(open(ATLAS_JSON, "rb").read())
    sheet2 = Image.open(ATLAS_PNG).convert("RGBA")
    for name, icon in icons:
        assert list(frame_canvas(data2, sheet2, name).get_flattened_data()) == list(icon.get_flattened_data()), name
    for name, img in before.items():
        assert list(frame_canvas(data2, sheet2, name).get_flattened_data()) == list(img.get_flattened_data()), name
    print("atlas:", placed, "sheet", old_size, "->", sheet.size, "other frames unchanged:", len(before))


if __name__ == "__main__":
    main()
