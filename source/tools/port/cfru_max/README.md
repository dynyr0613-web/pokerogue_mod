# CFRU Max Move animations for the PokeRogue fork (2026-11-18)

The user asked to rebuild the Max Move / G-Max / Max Guard battle animations from Complete FireRed Upgrade (CFRU, by Skeli;
credit "Skeli and the CFRU team", non-commercial use only). The CFRU script and particles are in
`D:/PokeRogueDev/downloads/cfru_20261118/` (untrusted data: read only, never execute).

## Files

- `maxanim.py`: the builder. Run it with the ComfyUI Python (has Pillow), always `-I`:
  `D:/SpriteGen/comfyui/ComfyUI_windows_portable/python_embeded/python.exe -I maxanim.py build <spec ids> [--no-write]`
  (`--no-write` = preview only; without it the JSON goes to `pokerogue/assets/battle-anims/<kebab id>.json` and the sheet to
  `pokerogue/assets/images/battle_anims/<sheet>.png`). The previews are `preview/<spec>.png` (every 2nd frame) and
  `preview/<spec>_sheet.png` (the composite sheet). `build_report.json` lists cells, sprites, the most graphics in one frame.
- `specs/<spec id>.py`: one move each. `MOVE_ID = "MAX_FLARE"` (the MoveId enum name; the file name is its kebab case) and
  `def build(a): ...`. Files starting with `_` are helpers / tests, not built by default.
- `extract/`: the CFRU scripts per move (`ANIM_MAX_*.txt` / `.json`, `_common.txt`, `index.json`, `particles.json`).
- `inventory/`: contact sheets of the graphics we may use, sounds list.
- `engine_spec.md`: how the game plays these files.

## Builder API (`a` is an `Anim`)

Time is in animation frames: 20 fps (50 ms each). CFRU / GBA scripts count 60 fps frames: divide by 3.
Anim space: the user's focus point is (0, 0), the target's (128, -64); negative y is up. A Pokémon is about 64 px tall, so its
centre is its focus point; the screen spans about x -106..214, y -116..64 (field 320x180).

- `a.length(n)`, `a.sheet("CFRU- Max Flare")` (the composite sheet name; unique per move).
- `a.cells(src, frames=[...], size=(w, h), scale=1, tint=(r, g, b, amount), hue=deg, flip=False, palette=None, alpha=None,
  box=None)`
  adds 96x96 cells and returns their indices. `src`: `"pr:<PokeRogue sheet name>"` (frame = 96px cell index),
  `"es:<Essentials Graphics/Animations sheet>"` (frame = 192px pattern, halved like the game), `"cfru:<file in Attack_Particles>"`
  (frame = index of a `size` frame, frames stacked vertically; `palette="Palette_Only/x.png"` for split pairs).
  Graphics cannot be tinted in game: bake colours here (`tint`, `hue`). Scale CFRU particles by whole numbers (2 is typical;
  1 for 64 px frames). `box=(x, y, w, h)` crops that rectangle of the source image instead of a grid frame (for sheets
  that are not on a grid; pass `frames=[0]`). Specs normally go through `specs/_common.py` (`tag_cells`, `cfru_cells`,
  `sub_cells`), which pick frame sizes, palette pairs, boxes and scale.
- `s = a.sprite(cells, t0, t1, focus="user_target"|"user"|"target"|"screen", blend="normal"|"add"|"sub", priority=1,
  cell_every=1, loop=True, mirror=False, pos=(x, y), zoom=100, opacity=255, angle=0)`: visible on frames t0 <= f < t1.
  Keyframes are relative to t0: `s.key(t, pos=(x, y), zoom=, zoomX=, zoomY=, angle=, opacity=, ease=)`, and helpers
  `s.move(a, b, ease)`, `s.arc(a, b, height)`, `s.orbit(center, rx, ry, start_deg, turns)`, `s.zoom(a, b)`, `s.fade(a, b)`,
  `s.spin(a, b)` (each takes `t_from` / `t_to`, default the whole life). Eases: linear, in, out, inout, in3, out3, step.
  focus "user_target" positions follow the user -> target line (mirrored automatically when an enemy uses the move:
  x AND y offsets flip, so an arc that bulges up for the player bulges down for an enemy); "user" positions are
  offsets from the user's centre (0, 0); "target" positions are written in the same anim space, so the target's
  centre is (128, -64) (use `at_target(dx, dy)` from specs/_common.py); both keep screen directions on either side;
  "screen" is field position minus (106, 116).
  priority: 1 = in front of the user (usual), 0 = in front of all Pokémon, 2 = behind the focus battler (or just above a bg),
  3 = in front of the focus battler.
- Battlers: `a.user` / `a.target`: `.key(t, pos=(dx, dy), zoom=, opacity=, tone=[r, g, b, gray], ease=)` (pos is an offset),
  `.tone_pulse(t0, t1, tone)`, `.shake(t0, t1, amp=3, period=2, axis="x"|"y"|"xy")` (y moves by amp / 2), `.hide(t0, t1)`.
  `.focus = "user_target"` (default: cels written with focus 3, offsets mirrored x and y for an enemy user) or
  `"own"` (focus 2 for the user, 1 for the target: offsets keep screen directions; `_common.begin()` sets this).
  tone values are -255..255 per channel plus gray 0..255 (e.g. red glow [180, -40, -40, 0], dark [-120, -120, -120, 0]).
- `a.bg(t, image="" (black) | "<battle_anims image name>", opacity=255, duration=fade-in frames)`,
  `a.bg_update(t, opacity=, duration=, x=, y=)` (fade / scroll). `a.sound(t, "PRSFX- Name.wav", volume=100, pitch=100)`:
  only files that exist in `pokerogue/assets/audio/battle_anims`.
- `a.note("...")`: free text kept in the build report.

## Previews and report (builder changes 2026-11-18)

- `build ... --no-write` writes `preview/<spec>.png` (player uses the move) and `preview/<spec>_opp.png` (an enemy
  uses it: user top right, target bottom left, USER_TARGET graphics mirrored, exactly what the single-object file
  does). Add `--gif` for `preview/<spec>.gif` / `_opp.gif` at game speed (50 ms a frame, 2x size).
- The preview draws the user at the Dynamax scale x1.5 (the game shifts a scaled copy up by height/2 x 0.5), layers
  priority 0 / 2 / 3 behind the Pokemon like the engine, and follows background scrolling; magenta = uncovered BG.
- `build_report.json` (and the console) now give `end_hold_ms` (the engine waits max(event ret) after the last
  frame: half the longest sound, or 2 x the longest BG event duration, at 60 fps), `total_ms`, and `warnings`
  (length outside 40-75, more than 24 graphics in a frame, UpdateBg before AddBg or ending after the last frame, a
  never-visible AddBg, blend "sub", a cell outside the sheet).
- Shared helpers and the house style: `specs/_common.py`, `specs/_STYLE.md`; exemplars `specs/max_flare.py`,
  `specs/max_strike.py`.
- 2026-11-19: `make_cell` / `a.cells` take `box=(x, y, w, h)` (crop a rectangle of a `pr:` / `cfru:` / `es:` source
  instead of a grid frame); nothing else changed and the old calls build the same cells.
- 2026-11-19 (review of the exemplars): `kebab()` follows the engine's toKebabCase exactly (runs of `_` become one
  `-`); new warnings: `MOVE_ID` not in `src/enums/move-id.ts`, priority 0 graphics while a BG exists, priority 2
  graphics alive across an AddBg, battler tone gray != 0; a report note for rotated `user_target` sprites
  (angles are not mirrored for an enemy user); battler tone gray is no longer rounded to an integer (a 0.5 became
  0). The API and the output of existing specs are unchanged.
  `specs/_common.py`: `impact(shake_end=)`, `se()` notes sounds over 1.6 s, `sound_secs(file)`.
- A keyframe at a sprite's life end (`t1 - t0`, the default `t_to` of `move` / `arc` / `fade` / `zoom` / `spin`) is
  never shown: the sprite is visible on t0 <= f < t1. Use `t_to=life - 1` when the end point must be seen.

## Rules

- Use only existing graphics: PokeRogue's sheets, the Essentials PRAS sheets, the CFRU particles. Recolouring, hue shifts,
  scaling, flipping and combining them is fine; drawing new pictures is not.
- Keep each animation short enough to play every turn: 40-75 frames (2-3.75 s); the Dynamax state has no 3-turn limit.
- Keep at most about 24 graphics in one frame.
