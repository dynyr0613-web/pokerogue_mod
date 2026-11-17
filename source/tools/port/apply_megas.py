# Adds our custom Megas to the PokeRogue source: forms, form changes and stones. Safe to run once.
import re

SRC = r"D:\PokeRogueDev\pokerogue\src"
SPECIES = SRC + r"\data\balance\species"


def form(name, key, t1, t2, h, w, ability, total, hp, atk, df, spa, spd, spe, catch, friend, exp):
    t2 = f"PokemonType.{t2}" if t2 else "null"
    return f"""        new PokemonForm({{
          formName: "{name}",
          formKey: SpeciesFormKey.{key},
          type1: PokemonType.{t1},
          type2: {t2},
          height: {h},
          weight: {w},
          ability1: AbilityId.{ability},
          ability2: AbilityId.NONE,
          abilityHidden: AbilityId.{ability},
          baseTotal: {total},
          baseHp: {hp},
          baseAtk: {atk},
          baseDef: {df},
          baseSpatk: {spa},
          baseSpdef: {spd},
          baseSpd: {spe},
          catchRate: {catch},
          baseFriendship: {friend},
          baseExp: {exp},
        }}),
"""


def change(species, key, item):
    return f"""      new SpeciesFormChange({{
        speciesId: SpeciesId.{species},
        preFormKey: "",
        evoFormKey: SpeciesFormKey.{key},
        trigger: new SpeciesFormChangeItemTrigger(FormChangeItem.{item}),
      }}),
"""


def patch(file, species, new_form, new_change):
    path = f"{SPECIES}\\{file}"
    raw = open(path, encoding="utf-8", newline="").read()
    crlf = "\r\n" in raw
    text = raw.replace("\r\n", "\n")
    start = text.index(f"SpeciesData[SpeciesId.{species}] = {{")
    if new_form.split("\n")[1] in text[start:][:6000]:
        print("already has form", species)
        return
    end = text.index("levelMoves:", start)
    block = text[start:end]
    tail = "      ],\n    }),\n    starter:"
    if tail in block:
        block = block.replace(tail, new_form + tail, 1)
    else:
        # A species with no forms yet gets a Normal form built from its own numbers.
        g = lambda k: re.search(rf"{k}: ([^,\n]+),", block).group(1)
        normal = f"""        new PokemonForm({{
          formName: "Normal",
          formKey: "",
          type1: {g('type1')},
          type2: {g('type2')},
          height: {g('height')},
          weight: {g('weight')},
          ability1: {g('ability1')},
          ability2: {g('ability2')},
          abilityHidden: {g('abilityHidden')},
          baseTotal: {g('baseTotal')},
          baseHp: {g('baseHp')},
          baseAtk: {g('baseAtk')},
          baseDef: {g('baseDef')},
          baseSpatk: {g('baseSpatk')},
          baseSpdef: {g('baseSpdef')},
          baseSpd: {g('baseSpd')},
          catchRate: {g('catchRate')},
          baseFriendship: {g('baseFriendship')},
          baseExp: {g('baseExp')},
          genderDiffs: {g('genderDiffs')},
          formSpriteKey: null,
          isStarterSelectable: true,
        }}),
"""
        block = block.replace("    }),\n    starter:", "      canChangeForm: true,\n      forms: [\n" + normal + new_form + "      ],\n    }),\n    starter:", 1)
    if "    formChanges: [\n" in block:
        block = block.replace("    formChanges: [\n", "    formChanges: [\n" + new_change, 1)
    else:
        block = re.sub(r"(    evolutions: \[[^\n]*\],\n)", lambda m: m.group(1) + "    formChanges: [\n" + new_change + "    ],\n", block, count=1)
    assert "formChanges: [" in block, species
    text = text[:start] + block + text[end:]
    if crlf:
        text = text.replace("\n", "\r\n")
    open(path, "w", encoding="utf-8", newline="").write(text)
    print("patched", species)


def passive(file, species, index, ability):
    """Give one of our Mega forms its own base passive (the ability our passive table assigns it).

    PokeRogue looks a form's passive up by form index and falls back to form 0, so without an entry
    Mega Melmetal showed Meltan's Heatproof (the user, 2026-11-02: "메가멜메탈 특성이 내열이네요, 교체해두죠").
    Idempotent: does nothing when the index already has an entry.
    """
    path = f"{SPECIES}\\{file}"
    raw = open(path, encoding="utf-8", newline="").read()
    crlf = "\r\n" in raw
    text = raw.replace("\r\n", "\n")
    start = text.index(f"SpeciesData[SpeciesId.{species}] = {{")
    end = text.index("levelMoves:", start)
    block = text[start:end]
    m = re.search(r"    passives: (\{[^}]*\}|AbilityId\.\w+),\n", block)
    assert m, species
    if m.group(1).startswith("AbilityId."):
        entries = {0: m.group(1)}
    else:
        entries = {int(k): v for k, v in re.findall(r"(\d+): (AbilityId\.\w+)", m.group(1))}
    if index in entries:
        print("passive already set", species, index, entries[index])
        return
    entries[index] = f"AbilityId.{ability}"
    body = "".join(f"      {k}: {entries[k]},\n" for k in sorted(entries))
    block = block[: m.start()] + "    passives: {\n" + body + "    },\n" + block[m.end() :]
    text = text[:start] + block + text[end:]
    if crlf:
        text = text.replace("\n", "\r\n")
    open(path, "w", encoding="utf-8", newline="").write(text)
    print("passive set", species, index, ability)


# BaseStats in the Essentials PBS are HP, Atk, Def, Spe, SpA, SpD.
patch("generation-01.ts", "CHARIZARD",
      form("Mega Z", "MEGA_Z", "ICE", "FLYING", 1.7, 95, "FROSTFIRE", 634, 78, 94, 88, 149, 95, 130, 45, 50, 267),
      change("CHARIZARD", "MEGA_Z", "CHARIZARDITE_Z"))
patch("generation-04.ts", "GALLADE",
      form("Mega Z", "MEGA_Z", "PSYCHIC", "FIGHTING", 1.6, 56.4, "MIND_BLADE", 618, 68, 95, 75, 150, 115, 115, 45, 35, 259),
      change("GALLADE", "MEGA_Z", "GALLADITE_Z"))
patch("generation-07.ts", "MELMETAL",
      form("Mega", "MEGA", "STEEL", None, 3, 1200, "IRON_FIST", 700, 135, 173, 173, 80, 120, 19, 3, 0, 300),
      change("MELMETAL", "MEGA", "MELMETALITE"))
patch("generation-09.ts", "BAXCALIBUR",
      form("Mega Z", "MEGA_Z", "DRAGON", "ICE", 2.1, 315, "HILT_CANNON", 700, 115, 115, 97, 150, 111, 112, 10, 50, 300),
      change("BAXCALIBUR", "MEGA_Z", "BAXCALIBRITE_Z"))
patch("generation-09.ts", "ARCHALUDON",
      form("Mega", "MEGA", "STEEL", "DRAGON", 2.4, 90, "STEEL_BODY", 700, 90, 150, 110, 150, 80, 120, 10, 50, 300),
      change("ARCHALUDON", "MEGA", "ARCHALUDONITE"))

# Base passives of our Mega forms = the passives our table gives them (custom-passives.ts), so they no
# longer inherit form 0's PokeRogue passive. Form indices: see the forms list of each species above.
passive("generation-01.ts", "CHARIZARD", 4, "SLUSH_RUSH")
passive("generation-04.ts", "GALLADE", 2, "SUPER_LUCK")
passive("generation-07.ts", "MELMETAL", 2, "STEEL_BODY")
passive("generation-09.ts", "BAXCALIBUR", 2, "SNOW_WARNING")
passive("generation-09.ts", "ARCHALUDON", 1, "STEELWORKER")

path = SRC + r"\enums\form-change-item.ts"
raw = open(path, encoding="utf-8", newline="").read()
if "CHARIZARDITE_Z" not in raw:
    nl = "\r\n" if "\r\n" in raw else "\n"
    new = nl.join(["  // Our custom Mega Stones", "  CHARIZARDITE_Z = 140,", "  BAXCALIBRITE_Z,", "  GALLADITE_Z,", "  MELMETALITE,", "  ARCHALUDONITE,", "", "  SHARP_METEORITE = 150,"])
    raw = raw.replace("  SHARP_METEORITE = 150,", new, 1)
    open(path, "w", encoding="utf-8", newline="").write(raw)
    print("stones added")
