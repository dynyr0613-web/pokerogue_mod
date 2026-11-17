# Vest item icons (돌격조끼 / 방탄조끼)

`install_vest_icons.py` builds the two held-item icons the local PokeRogue fork uses for
`ASSAULT_VEST` and `BULLETPROOF_VEST` and registers them in the `items` atlas.

- Source: `C:/Users/jaehe/OneDrive/바탕 화면/Pokemon Essentials v21.1 2023-07-30/Graphics/Items/ASSAULTVEST.png`
  (Pokémon Essentials v21.1 item icon, 48×48, six colours, drawn at 1× — not a clean 2× upscale).
  The Essentials project is only read, never written.
- `assets/images/items/assault_vest.png`: the vest shrunk to 21×18 with a 2×2 majority vote (ties go to the
  darker colour so the outline survives), centred on a transparent 32×32 canvas, saved as a palette PNG like
  `eviolite.png`.
- `assets/images/items/bulletproof_vest.png`: the same sprite with the four reds mapped to greys
  (see `GREY` in the script); outline and dark pixels are kept.
- `assets/images/items.json` + `items.png`: two untrimmed 32×32 frames appended in a new row under the sheet.
  The JSON is rewritten in its own TexturePacker style (tab indent, CRLF, original final newline), so the diff
  is only the two frames and the sheet size.

Run with the ComfyUI embedded Python (has PIL):

    D:/SpriteGen/comfyui/ComfyUI_windows_portable/python_embeded/python.exe -I D:/PokeRogueDev/tools/port/install_vest_icons.py

To swap in hand-made icons later, overwrite the two PNGs in `assets/images/items/` (32×32, transparent
background) and re-run with `--keep-pngs`; the atlas frames are redrawn in place.
