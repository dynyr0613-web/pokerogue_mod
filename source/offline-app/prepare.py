"""Prepare the offline app's bundled documents, icon and AGPL source package.

Run before `npm run dist` (any Python 3 with Pillow; the ComfyUI embedded Python has it):
    D:/SpriteGen/comfyui/ComfyUI_windows_portable/python_embeded/python.exe -I D:/PokeRogueDev/offline-app/prepare.py
"""
import json
import shutil
import subprocess
import zipfile
from datetime import date
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

APP = Path(__file__).resolve().parent
FORK = APP.parent / "pokerogue"
TOOLS = APP.parent / "tools"
DOCS = APP / "docs"
BUILD = APP / "build"


def git_files(repo: Path) -> list[str]:
    out = subprocess.run(
        ["git", "-C", str(repo), "ls-files", "-co", "--exclude-standard", "-z"],
        check=True,
        capture_output=True,
    ).stdout.decode("utf-8")
    return [f for f in out.split("\0") if f]


def move_old_source_zips(keep: Path) -> None:
    """2026-11-19 (1.2.0): the AGPL source only needs the newest zip, but every older dated zip in docs/source used
    to ship too (six, about 50 MB, by 1.1.0). Older pokerogue-local-source-*.zip files are moved (never deleted) to
    offline-app/old_source_zips/, which is not packaged; a name already there gets a -2, -3 ... suffix."""
    old_dir = APP / "old_source_zips"
    for path in sorted(keep.parent.glob("pokerogue-local-source-*.zip")):
        if path.name == keep.name:
            continue
        old_dir.mkdir(exist_ok=True)
        dest = old_dir / path.name
        n = 2
        while dest.exists():
            dest = old_dir / f"{path.stem}-{n}{path.suffix}"
            n += 1
        shutil.move(str(path), str(dest))
        print(f"old source zip moved: {path.name} -> {dest.relative_to(APP).as_posix()}")


def make_source_zip() -> Path:
    """AGPL-3.0 corresponding source: the fork's code (with all local changes), the locale files,
    the build-time scripts under tools/port and this wrapper. Game art and audio are shipped in their
    original form inside the installed game folder."""
    target = DOCS / "source" / f"pokerogue-local-source-{date.today():%Y%m%d}.zip"
    target.parent.mkdir(parents=True, exist_ok=True)
    move_old_source_zips(target)
    skip_top = {"assets", "locales", "dist", "node_modules", "saves_import"}
    count = 0
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for rel in git_files(FORK):
            top = rel.split("/", 1)[0]
            path = FORK / rel
            if top in skip_top or not path.is_file():
                continue
            zf.write(path, f"pokerogue/{rel}")
            count += 1
        for rel in git_files(FORK / "locales"):
            path = FORK / "locales" / rel
            if path.is_file():
                zf.write(path, f"pokerogue/locales/{rel}")
                count += 1
        for path in sorted((TOOLS / "port").glob("*")):
            if path.is_file() and path.suffix in {".py", ".md", ".txt", ".diff"}:
                zf.write(path, f"tools/port/{path.name}")
                count += 1
        # 2026-11-19: the Max Move animation builder and its per-move specs (CFRU re-creation); the CFRU download,
        # the extraction, the inventory and the previews stay out
        for sub in ("cfru_max", "cfru_max/specs"):
            for path in sorted((TOOLS / "port" / sub).glob("*")):
                if path.is_file() and path.suffix in {".py", ".md"}:
                    zf.write(path, f"tools/port/{sub}/{path.name}")
                    count += 1
        # 2026-11-19: save-backup.js (the startup save backup main.js requires) is part of the wrapper too
        for name in ("main.js", "save-backup.js", "package.json", "prepare.py"):
            zf.write(APP / name, f"offline-app/{name}")
            count += 1
        zf.writestr(
            "BUILD.txt",
            "How this build was made\n"
            "1. pokerogue/: pnpm install, then `pnpm exec vite build --mode app` (output: pokerogue/dist).\n"
            "   The game art and audio come from https://github.com/pagefaultgames/pokerogue-assets\n"
            "   (commit in pokerogue/.gitmodules + the submodule pointer); the fork's own extra images are\n"
            "   written into that folder by tools/port/*.py.\n"
            "2. offline-app/: npm install, python prepare.py, npm run dist (Electron + electron-builder).\n",
        )
    print(f"source zip: {target} ({count} files, {target.stat().st_size / 1e6:.1f} MB)")
    return target


def make_icon() -> None:
    """A plain placeholder icon (no game or franchise artwork)."""
    BUILD.mkdir(exist_ok=True)
    size = 256
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((8, 8, size - 8, size - 8), radius=48, fill=(30, 36, 64, 255))
    d.rounded_rectangle((8, size - 76, size - 8, size - 8), radius=48, fill=(196, 52, 52, 255))
    d.rectangle((8, size - 76, size - 8, size - 52), fill=(196, 52, 52, 255))
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 104)
        small = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 30)
    except OSError:
        font = small = ImageFont.load_default()
    d.text((size / 2, 104), "PR", font=font, fill=(245, 245, 245, 255), anchor="mm")
    d.text((size / 2, size - 42), "OFFLINE", font=small, fill=(255, 255, 255, 255), anchor="mm")
    img.save(BUILD / "icon.png")
    img.save(BUILD / "icon.ico", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    print(f"icon: {BUILD / 'icon.ico'}")


def copy_licenses() -> None:
    shutil.copyfile(FORK / "LICENSE", DOCS / "LICENSE.txt")
    lic = DOCS / "licenses"
    if lic.exists():
        shutil.rmtree(lic)
    shutil.copytree(FORK / "assets" / "LICENSES", lic / "assets")
    shutil.copytree(FORK / "LICENSES", lic / "code")
    shutil.copyfile(FORK / "assets" / "REUSE.toml", lic / "assets" / "REUSE.toml")
    print(f"licenses: {lic}")


if __name__ == "__main__":
    DOCS.mkdir(exist_ok=True)
    version = json.loads((APP / "package.json").read_text(encoding="utf-8"))["version"]
    print(f"version {version}")
    copy_licenses()
    make_icon()
    make_source_zip()
