# Builds src/data/balance/custom-passives.ts from Design/패시브_종족별.xlsx in the Essentials project.
# Rows that can't be placed in PokeRogue are listed in custom-passives-report.txt.
import collections, glob, os, re, warnings
import openpyxl

warnings.filterwarnings("ignore")
ROOT = r"D:\PokeRogueDev\pokerogue\src"
ESS = r"C:\Users\jaehe\OneDrive\바탕 화면\Pokemon Essentials v21.1 2023-07-30"
OUT = os.path.join(ROOT, "data", "balance", "custom-passives.ts")
REPORT = r"D:\PokeRogueDev\tools\port\custom-passives-report.txt"


def norm(s):
    return re.sub(r"[^A-Z0-9]", "", s.upper())


enum_ab = re.findall(r"^\s*([A-Z][A-Z0-9_]+),", open(os.path.join(ROOT, "enums", "ability-id.ts"), encoding="utf-8").read(), re.M)
ability = {norm(a): a for a in enum_ab}

species = {}   # enum name -> {forms: [keys], parents: []}
for path in glob.glob(os.path.join(ROOT, "data", "balance", "species", "*.ts")):
    text = open(path, encoding="utf-8").read().replace("\r\n", "\n")
    marks = list(re.finditer(r"SpeciesData\[SpeciesId\.(\w+)\]\s*=\s*\{", text))
    for i, m in enumerate(marks):
        block = text[m.start():marks[i + 1].start() if i + 1 < len(marks) else len(text)]
        # Evolutions may sit after levelMoves, so scan the whole block for them and only the head for form keys
        evos = re.findall(r"Evolution\(\{\s*speciesId:\s*SpeciesId\.(\w+)", block)
        block = block[:block.find("levelMoves:") if "levelMoves:" in block else len(block)]
        keys = []
        for k in re.findall(r"formKey:\s*([^,\n]+),", block):
            k = k.strip()
            keys.append(k)
        species[m.group(1)] = {"forms": keys, "evos": evos}
parents = {}
for name, d in species.items():
    for child in d["evos"]:
        parents.setdefault(child, name)
by_norm = {norm(n): n for n in species}
ALIAS = {"NIDORANFE": "NIDORAN_F", "NIDORANMA": "NIDORAN_M"}


def pr_species(ess):
    return ALIAS.get(norm(ess)) or by_norm.get(norm(ess))


# Essentials form names
form_names = {}
for f in glob.glob(os.path.join(ESS, "PBS", "pokemon_forms*.txt")):
    cur = None
    for line in open(f, encoding="utf-8-sig", errors="replace"):
        h = re.match(r"\[(\w+),(\d+)\]", line)
        if h:
            cur = f"{h.group(1)},{h.group(2)}"
        elif cur and line.startswith("FormName"):
            form_names[cur] = line.split("=", 1)[1].strip()

REGION = {"Alolan": "ALOLA", "Galarian": "GALAR", "Hisuian": "HISUI", "Paldean": "PALDEA"}
KEY_VALUES = {"MEGA": "mega", "MEGA_X": "mega-x", "MEGA_Y": "mega-y", "MEGA_Z": "mega-z", "MEGA_ORIGINAL": "mega-original",
              "MEGA_CURLY": "mega-curly", "MEGA_DROOPY": "mega-droopy", "MEGA_STRETCHY": "mega-stretchy", "PRIMAL": "primal",
              "ORIGIN": "origin", "INCARNATE": "incarnate", "THERIAN": "therian", "GIGANTAMAX": "gigantamax",
              "GIGANTAMAX_SINGLE": "gigantamax-single", "GIGANTAMAX_RAPID": "gigantamax-rapid", "ETERNAMAX": "eternamax"}


def key_value(k):
    m = re.match(r"SpeciesFormKey\.(\w+)", k)
    if m:
        return KEY_VALUES[m.group(1)]
    return k.strip('"')


def form_keys(name):
    return [key_value(k) for k in species[name]["forms"]]


def place(row_id, kind, label):
    """Returns (PokeRogue species, form key) for a sheet row, or None."""
    base, _, num = row_id.partition(",")
    fname = form_names.get(row_id, "")
    sp = pr_species(base)
    if not num:
        return (sp, "") if sp else None
    if sp is None:
        return None
    keys = form_keys(sp)
    low = fname.lower()
    if kind == "메가진화":
        if row_id == "FLOETTE,6":
            return ("ETERNAL_FLOETTE", "mega") if "mega" in form_keys("ETERNAL_FLOETTE") else None
        for token, key in [("original", "mega-original"), ("curly", "mega-curly"), ("droopy", "mega-droopy"), ("stretchy", "mega-stretchy")]:
            if token in low and key in keys:
                return sp, key
        for token, key in [(r"\bx$", "mega-x"), (r"\by$", "mega-y"), (r"\bz$", "mega-z")]:
            if re.search(token, low) and key in keys:
                return sp, key
        return (sp, "mega") if "mega" in keys else None
    if kind == "원시회귀":
        return (sp, "primal") if "primal" in keys else None
    if kind == "다이맥스":
        if "eternamax" in low or base == "ETERNATUS":
            return (sp, "eternamax") if "eternamax" in keys else None
        for token, key in [("rapid", "gigantamax-rapid"), ("single", "gigantamax-single")]:
            if token in low and key in keys:
                return sp, key
        hits = [k for k in keys if "gigantamax" in k]
        return (sp, hits[0]) if hits else None
    if kind == "리전폼":
        for word, prefix in REGION.items():
            if word.lower() in low:
                name = f"{prefix}_{sp}"
                if name in species:
                    return name, ""
        if base == "TAUROS":
            word = "combat" if "combat" in low else "blaze" if "blaze" in low else "aqua"
            return ("PALDEA_TAUROS", word) if "PALDEA_TAUROS" in species else None
        return None
    if kind == "성별 폼":
        return (sp, "female") if "female" in keys else None
    # 폼: match a word from the Essentials name against the PokeRogue keys
    SPECIAL = {"FLOETTE,5": ("ETERNAL_FLOETTE", ""), "URSALUNA,1": ("BLOODMOON_URSALUNA", ""), "ZYGARDE,1": ("ZYGARDE", "10-pc"),
               "URSHIFU,1": ("URSHIFU", "rapid-strike"), "NECROZMA,1": ("NECROZMA", "dusk-mane"), "NECROZMA,2": ("NECROZMA", "dawn-wings"),
               "CALYREX,1": ("CALYREX", "ice"), "CALYREX,2": ("CALYREX", "shadow"), "SHAYMIN,1": ("SHAYMIN", "sky"),
               "ORICORIO,1": ("ORICORIO", "pompom"), "ORICORIO,2": ("ORICORIO", "pau"), "ORICORIO,3": ("ORICORIO", "sensu"),
               "LYCANROC,1": ("LYCANROC", "midnight"), "LYCANROC,2": ("LYCANROC", "dusk"),
               "OGERPON,1": ("OGERPON", "wellspring-mask"), "OGERPON,2": ("OGERPON", "hearthflame-mask"), "OGERPON,3": ("OGERPON", "cornerstone-mask"),
               "HOOPA,1": ("HOOPA", "unbound"), "WORMADAM,1": ("WORMADAM", "sandy"), "WORMADAM,2": ("WORMADAM", "trash")}
    if row_id in SPECIAL:
        name, key = SPECIAL[row_id]
        if name in species and (key == "" or key in form_keys(name)):
            return name, key
        return None
    for k in keys:
        if k and any(part and part in low for part in k.split("-")):
            return sp, k
    return None


wb = openpyxl.load_workbook(os.path.join(ESS, "Design", "패시브_종족별.xlsx"), read_only=True, data_only=True)
rows = list(wb["패시브"].iter_rows(min_row=2, values_only=True))
wb.close()
table = collections.defaultdict(dict)
skipped, no_ability = [], []
for r in rows:
    kind, row_id, label, passive = r[0], r[2], r[3], r[10]
    if not row_id or not passive:
        continue
    ab = ability.get(norm(str(passive)))
    if ab is None:
        no_ability.append(f"{row_id} {label}: {passive}")
        continue
    spot = place(str(row_id), kind, label)
    if spot is None:
        skipped.append(f"{kind} {row_id} {label} ({form_names.get(str(row_id), '')}) -> {ab}")
        continue
    table[spot[0]][spot[1]] = ab

# Regional species with no row of their own (PokeRogue splits them off, e.g. HISUI_BASCULIN) use the base
# species' row, as Essentials does for forms without one; then evolutions walk up to the nearest relative.
direct = set(table)
filled = 0
for name in species:
    prefix, _, base = name.partition("_")
    if prefix in REGION.values() and base in species and "" not in table.get(name, {}) and "" in table.get(base, {}):
        table[name][""] = table[base][""]
        filled += 1
for name in species:
    if "" in table.get(name, {}):
        continue
    walk, seen = name, set()
    while walk in parents and walk not in seen:
        seen.add(walk)
        walk = parents[walk]
        if "" in table.get(walk, {}):
            table[name][""] = table[walk][""]
            filled += 1
            break

lines = [
    "// Generated by tools/port/gen_custom_passives.py from the Essentials project's passive sheet. Do not edit by hand.",
    'import { AbilityId } from "#enums/ability-id";',
    'import { SpeciesId } from "#enums/species-id";',
    "",
    "/** Our passives by species and form key; `\"\"` is the base form, used by any form with no entry of its own. */",
    "const customPassives: Partial<Record<SpeciesId, Readonly<Record<string, AbilityId>>>> = {",
]
for name in sorted(table):
    entries = ", ".join(f'"{k}": AbilityId.{v}' for k, v in sorted(table[name].items()))
    lines.append(f"  [SpeciesId.{name}]: {{ {entries} }},")
lines += [
    "};",
    "",
    "/** @returns Our passive for this species and form, or `null` if the sheet has none. */",
    "export function getCustomPassive(speciesId: SpeciesId, formKey: string): AbilityId | null {",
    "  const forms = customPassives[speciesId];",
    '  return forms?.[formKey] ?? forms?.[""] ?? null;',
    "}",
    "",
]
open(OUT, "w", encoding="utf-8", newline="\n").write("\n".join(lines))
with open(REPORT, "w", encoding="utf-8") as f:
    f.write(f"rows {len(rows)}; species in table {len(table)}; inherited {filled}\n\nNo PokeRogue form:\n")
    f.write("\n".join(skipped) + "\n\nNo such ability:\n" + "\n".join(no_ability) + "\n")
print("species", len(table), "direct", len(direct), "inherited", filled, "skipped", len(skipped), "no ability", len(no_ability))
print("\n".join(skipped))
print(no_ability[:20])
