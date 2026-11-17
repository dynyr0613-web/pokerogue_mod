"""Install the Mark Charm (증표부적) item icon into the fork's `items` atlas (2026-11-17).

    py install_mark_charm_icon.py <game folder>      e.g. the installed resources/game, or pokerogue/assets

Local fork (2026-11-18): the source is PokéSprite's 32x32 key-item/mark-charm.png
(item-icons/pokesprite_key-item_mark-charm.png, https://github.com/msikma/pokesprite), drawn as it is. It replaces the
64x64 sprite of the PokeAPI sprites repository that this script halved with LANCZOS (282 smeared colours and a white rim
no other icon has). install_pokesprite_icons.py installs it with the other PokéSprite icons; this script installs just
this one frame with that script's code: an untrimmed 32x32 frame "mark_charm" (redrawn in place on re-runs, a new row
under the sheet when the atlas has none), items.json written in the TexturePacker style the other port scripts read (the
2026-11-17 version wrote it compact), and the loose copy images/items/mark_charm.png.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I leaves the script folder off sys.path

import install_pokesprite_icons as pokesprite  # noqa: E402

NAME = "mark_charm"


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    pokesprite.install(Path(sys.argv[1]), {NAME})


if __name__ == "__main__":
    main()
