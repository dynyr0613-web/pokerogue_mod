# Keeps the asset and locale diffs minimal: trailing newlines on the atlas JSON files we wrote, and the
# English modifier-type.json restored from git with only our five stone names inserted.
import json, os, re, subprocess

GAME = r"D:\PokeRogueDev\pokerogue"
ASSETS = os.path.join(GAME, "assets")
LOCALES = os.path.join(GAME, "locales")

# 1. Atlas JSON files: json.dump leaves no final newline; upstream files end with LF.
changed = subprocess.run(["git", "-C", ASSETS, "status", "--short"], capture_output=True, text=True, encoding="utf-8").stdout
fixed = 0
for line in changed.splitlines():
    path = line[3:].strip().strip('"')
    if path.endswith(".json"):
        full = os.path.join(ASSETS, path)
        data = open(full, "rb").read()
        if not data.endswith(b"\n"):
            open(full, "wb").write(data + b"\n")
            fixed += 1
print("atlas files given a trailing newline:", fixed)

# 2. en/modifier-type.json: start from HEAD and insert the five keys at the end of the FormChangeItem block.
STONES = {"CHARIZARDITE_Z": "Charizardite Z", "BAXCALIBRITE_Z": "Baxcalibrite Z", "GALLADITE_Z": "Galladite Z",
          "MELMETALITE": "Melmetalite", "ARCHALUDONITE": "Archaludonite"}
rel = "en/modifier-type.json"
head = subprocess.run(["git", "-C", LOCALES, "show", f"HEAD:{rel}"], capture_output=True, encoding="utf-8").stdout
nl = "\r\n" if "\r\n" in head else "\n"
lines = head.split(nl)
start = next(i for i, l in enumerate(lines) if re.match(r'\s*"FormChangeItem": \{', l))
indent = re.match(r"(\s*)", lines[start]).group(1)
end = next(i for i in range(start + 1, len(lines)) if lines[i].startswith(indent + "}"))
last = end - 1
if not lines[last].rstrip().endswith(","):
    lines[last] = lines[last].rstrip() + ","
item_indent = re.match(r"(\s*)", lines[last]).group(1)
new = [f'{item_indent}"{k}": "{v}",' for k, v in STONES.items()]
new[-1] = new[-1].rstrip(",")
lines[start + 1:end] = [l for l in lines[start + 1:end] if not any(f'"{k}"' in l for k in STONES)] + new
text = nl.join(lines)
json.loads(text)  # must still parse
open(os.path.join(LOCALES, rel), "w", encoding="utf-8", newline="").write(text)
print("en/modifier-type.json rebuilt from HEAD with", len(STONES), "keys")
