# House style for the CFRU Max Move specs (2026-11-18, updated 2026-11-19)

Every Max / G-Max / Max Guard animation is rebuilt from its CFRU script (`extract/ANIM_*.txt`, CFRU by Skeli and
the CFRU team) with the shared pieces in `specs/_common.py`. Read `README.md` (builder API) and `engine_spec.md`
(how the game plays the files) first. The two exemplars are `specs/max_flare.py` (charge on the attacker, scene
background, a projectile volley, typed geysers; 54 frames) and `specs/max_strike.py` (rumble, colour impact, plain
explosion columns; 50 frames).

## 0. Helper list (`specs/_common.py`)

| helper | what it does |
|---|---|
| `begin(a, sheet, L)` | length, sheet name, battler cels with their own focus (up stays up for an enemy user) |
| `dynamax_flex(a, t0=0)` | the user grows to 125 %, holds, snaps back (6 + 6 + 3 frames), lifted so the feet stay put; returns the end frame |
| `dark_stage(a, t0, t1)` / `DARK` | CFRU's 14/16 black stage: black AddBg "" fading in from t0, gone by t1 |
| `bg_fade(a, t, frm, to, frames)` | opacity tween of the current BG, split into steps of at most 8 frames (end hold) |
| `scene_bg(a, t0, t1, image, scroll=...)` | a full anim BG (CFRU loadBG1), optional seam-checked scroll, faded out by t1 |
| `bg_seams(name)` | seam ratio (x, y) of a BG texture: about 1-4 scrolls cleanly |
| `impact(a, t0, t1, type, shake_end=)` | CFRU impact phase: target vertical shake (to `shake_end`, default t1) + tone toward the type colour, released by t1 |
| `screen_rumble(a, t0)` | MAX_STRIKE_SCREEN_SHAKE: both battlers shake light then strong, SE_M_STRENGTH x5 |
| `geyser(a, t0, kind, type_=)` | the shared explosion-column sub-script, x3 staggered, with typed risers |
| `big_orb(a, t0, ...)` | CFRU's big glowing-orb finish (CIRCLE_OF_LIGHT stand-in, grow / hold / shrink, additive) |
| `TYPE_COLORS`, `type_color`, `tone_for(type, k)`, `tint_for(type)`, `EXTRA_COLORS`, `blend_tone(rgb, k)`, `gba_rgb(c15)` | colours (section 6) |
| `SUBS`, `sub_cells(a, tag)` | stand-ins for the 41 vanilla particles CFRU does not ship (section 8) |
| `tag_cells(a, tag)` | any CFRU ANIM_TAG: the CFRU file (palette pair, boxes) or its SUBS entry |
| `cfru_cells(a, file)`, `cfru_info(file)`, `FRAME_SIZE_FIX`, `CFRU_BOXES`, `PALETTE_PAIRS`, `CFRU_TAGS`, `CFRU_REPLACED` | CFRU particles with the right frame cut |
| `source_cells(a, "tag:/sub:/cfru:/pr:/es:...")` | one entry point for all of the above |
| `SE`, `se(a, t, "SE_M_...")`, `SE_NOTES` | GBA song names -> existing game sounds |
| `gba(dx, dy)`, `gba_f(n)`, `at_user(dx, dy)`, `at_target(dx, dy)`, `GBA_PX` | unit conversion and placement |
| `GEYSER_PUFFS`, `GEYSER_RISE` | CFRU's 15 puff positions; the typed riser families |

## 1. File layout

```python
# Local fork (date): <Move>, rebuilt from CFRU ANIM_<LABEL> (Complete FireRed Upgrade, Skeli and the CFRU team; ...)
# CFRU beats (N GBA f) -> ours (L frames):
#   f0    <what CFRU does>                                   -> f<ours>
#   ...
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *

MOVE_ID = "MAX_FOO"

def build(a):
    L = 56
    begin(a, "CFRU- Max Foo", L)   # length, sheet name, own-focus battler cels
    ...
```

- The header comment maps every CFRU beat to our frames. Someone checking the port reads only that table.
- `MOVE_ID` is the game's MoveId enum name (engine_spec.md section 2), not the CFRU label: `G_MAX_VOLT_CRASH`,
  `G_MAX_WIND_RAGE`, `G_MAX_GOLD_RUSH`, `G_MAX_VINE_LASH`, ... (CFRU writes `ANIM_G_MAX_VOLTCRASH`,
  `ANIM_G_MAX_WINDRAGE`, `ANIM_G_MAX_GOLDRUSH`, `ANIM_G_MAX_VINE_LASH_MOVE`). The build warns when the name is not
  in `src/enums/move-id.ts`; a wrong name writes a file the game never fetches.
- Sheet name: `CFRU- <Move name>` (unique; texture keys are global in the game).
- Anything you changed on purpose against CFRU goes in `a.note("...")` (it lands in `build_report.json`).

## 2. Timing budget

20 fps, one frame 50 ms. CFRU counts 60 fps GBA frames: divide by 3 (`gba_f(n)`), then compress the waits.

| beat | CFRU (GBA f) | ours (frames) | helper |
|---|---|---|---|
| dark stage in | 29 | 6-8 | `dark_stage(a, 0, L - 1)` |
| Dynamax flex | 72 (32 grow, 32 hold, 8 back) | **15** (6 + 6 + 3) | `dynamax_flex(a, 0)` |
| charge / wind-up on the attacker | runs during the flex | inside the flex | — |
| projectiles | 50 each, 4 apart | **10 each, 2 apart**, linear | `a.sprite(...).arc(...)` |
| impact phase (shake + tone) | 100-160 | 23-28 | `impact(a, t0, t1, type)` |
| geyser columns | 33 each, 14 apart, x3 | 11 each, **5 apart**, x3 | `geyser(a, t0, kind, type_=...)` |
| glowing orb finish | 15 + 48 + 15 | 5 + 16 + 5 | `big_orb(a, t0, ...)` |
| colour and BG back | 30 + 30 | 6-8, overlapping | `impact(release=...)`, `dark_stage` / `scene_bg` fade out |

- Total 40-75 frames (2-3.75 s). The exemplars: Flare 54, Strike 50.
- Start the hit (first geyser, shake) right where the flex ends or the first projectile lands; do not leave the
  screen idle more than about 6 frames. After the last particle, finish within about 10 frames (tone release and
  the BG fade-out overlap; CFRU runs them one after the other).
- Overlaps CFRU has are fine to keep: Flare's first geyser starts before the first fireball lands; Strike's strong
  rumble runs 2-3 frames into the first column.
- A keyframe at the end of a sprite's life is never shown (a sprite on [t0, t1) shows relative frames
  0..t1-t0-1, and `move` / `arc` / `fade` default `t_to` to t1-t0). For an arrival (a projectile landing on the
  target) end the path at `t_to=life - 1`, as Flare's volley does; for fades the default is fine.
- When the target's colour change is part of the move (Strike yellow, Knuckle orange, Phantasm blue, ...), CFRU
  holds it after the geysers and fades it back together with the dark stage: hold the tone until the BG fade
  starts and release over the same frames (`impact(a, t0, fade + 7, type, release=7, shake_end=fade)` with
  `dark_stage(..., fade_out=8)` ending at L - 1, as in Strike). The puffs hide the target while they burst.
- **End hold**: after the last frame the game waits max(event ret): half the length of the longest sound, or
  2 x the longest background tween, at 60 fps (`end_hold_ms` in the report). Keep it under about 0.8 s: no sound
  longer than about 1.6 s, background tweens of at most 8 frames (`bg_fade` / `scene_bg` split long ones).
- All background fades must finish by the last frame (the helpers raise if not).

## 3. The Dynamax flex

- `dynamax_flex(a, t0=0)`: 125 % (the user is already drawn x1.5 by the game), 6 + 6 + 3 frames, lifted 12 px so it
  grows from its feet. Every Max attack starts with it at f0, except Max Lightning / Volt Crash / Stun Shock (after
  their BG swap, as in CFRU) and the four G-Max moves that are plain move anims in CFRU (Drum Solo, Fireball,
  Hydrosnipe, Rapid Flow).
- CFRU draws no aura during the flex. What happens on the attacker during the flex is the move's own wind-up (Flare:
  the red ball swelling).
- Things placed on the user: the game's centre for graphics is the unscaled sprite's centre, but the x1.5 user is
  drawn 16 px higher, and 28 px higher at the flex peak (lift 12). Use `at_user(2, -14)` for the chest at rest and
  key the sprite to `at_user(2, -22)` during the flex (Flare's ball does this).
- Keep a charge on the attacker smaller than its body (Flare's ball peaks at zoom 95 = 61 px on a ~120 px flexed
  user; CFRU's ball is 48 GBA px on a 128 GBA px flexed sprite). Glows around it: additive, opacity <= 200, and
  remember `pr:Light1` frame 6 is 52 px, so zoom 300 is already 156 px.

## 4. Focus and mirroring (one file plays for both sides)

- `begin()` writes the battler cels with their own focus, so vertical battler moves (flex lift, vertical shakes, a
  target pushed down) keep their screen direction when an enemy uses the move.
- Particles around one battler: focus `"target"` / `"user"` with `at_target(dx, dy)` / `at_user(dx, dy)`. They
  never mirror: up stays up (geysers, orbs, rain). x offsets do not mirror either, so keep them symmetric.
- Particles that travel between the battlers: focus `"user_target"`, from about `(0, 0)` to `(128, -64)`. For an enemy
  user the game mirrors this through the midpoint: x **and y** offsets flip. Keep arcs low (heights 6-22, like
  CFRU's) and start ON the focus point's height (`(2, 0)` in Flare): a start y of -6 is 6 px up for the player but
  6 px down for an enemy. A charge sitting on the user (focus `"user"`, at `at_user(2, -14..-22)`) cannot meet a
  USER_TARGET start on both sides; sink it to about `at_user(2, -8)` on its last frame so the hand-over jumps
  about 8 px either way (Flare). Angles are not mirrored: avoid rotated USER_TARGET sprites, or use symmetric art
  (the build report adds a "check: rotated user_target sprites" note).
- Volleys: launch at least 2 frames apart and move linearly (`arc(..., ease=None)`); an ease-in keeps the balls
  bunched on the attacker and the volley reads as one train. Vary the arc height and the landing spot a little
  (`ARCS` in Flare) so each projectile stays separate.
- Always check `preview/<id>_opp.png` as well as `preview/<id>.png`.
- Max Guard is a self move: USER_TARGET collapses onto the user; use focus `"user"` only.

## 5. Backgrounds

- Dark stage = CFRU's BG palette fade to 14/16 black: `dark_stage(a, 0, L - 1)` (black AddBg "", 223). Battlers and
  particles stay bright, which is the spotlight look.
- Only one background exists at a time. A later AddBg replaces the dark stage **instantly**, and fading the new one
  in from 0 shows the arena through it. To go from the dark stage to a scene BG, fade the black to 255
  (`bg_fade(a, t, DARK, 255, 3)`) and cut to the scene BG at full opacity (`scene_bg(a, t, L - 1, name)`), ideally
  under a flash. That is how Flare does it.
- CFRU BGs we have stand-ins for: BG_INFERNO_OVERDRIVE -> `PRAS- Burning BG` (the game's Inferno Overdrive BG).
  Others: pick from `inventory/backgrounds*.png` / `max_shortlist.json`.
- Scrolling (`scene_bg(scroll=(vx, vy))`) only for textures that tile on that axis: `bg_seams(name)` gives the seam
  ratio (about 1-4 is clean; `PRAS- Fire BG` x 3.5 scrolls; `PRAS- Burning BG` x 57 does not). The helper adds a
  report note when the seam would show.
- Whole-screen colour flashes (CFRU blends of BG + all battlers) are a coloured BG for 1-2 frames, plus battler
  tones; Pokemon stay in front of every BG.

## 6. Colours

- `TYPE_COLORS[type]`: `rgb` (CFRU's blend colour where the script has one, our pick otherwise, see `cfru`),
  `tone` (the impact peak, about 3/4 of a full GBA blend), `tint` (for neutral particles), `puff_tint` (geyser
  puffs). `tone_for(type, k)` scales the tone; `EXTRA_COLORS` holds the G-Max and particle blend colours.
- Battler tone gray stays 0. Tones are additive: positive values brighten, negative darken; ghost / dark tones are
  dark and saturated on purpose (CFRU blends to royal blue / deep purple).
- Graphics take no tone in the game: bake colours into cells (`tint=(r, g, b, amount)`, `hue=`). CFRU's
  BlendParticle 15/16 ~ amount 0.94, 10/16 ~ 0.62, 8/16 ~ 0.5.
- When CFRU's own colours are too close to read at game scale, push them apart and say so in a note (Flare's
  three ball colours are all orange-reds in CFRU).
- When CFRU has no target blend (Flare, Geyser, Hailstorm, Steelspike, ...), a soft tone (`impact(k=0.5)`) is
  allowed so the hit reads; note it.

## 7. Geysers

- `geyser(a, t0, kind, type_=type, count=3, gap=5)` is the shared CFRU sub-script: explosion puffs climbing from
  the target's feet to above its head (CFRU's 15 puff positions x 1.3, 3 puffs per our frame, so a column in about
  5 frames) plus typed particles shooting straight up (16 anim px a frame).
- `kind`: `None` (EXPLOSION_GEYSER: Strike, Knuckle, Rockfall, Vine Lash), `"fire"` (MAX_FLARE_GEYSER), `"ghost"`
  (NEN_GEYSER), `"psychic"` (MINDSTORM_GEYSER), `"grass"` (LEAVES_COTTON), `"apple"` (Tartness), `"ground"`
  (DIRT_GEYSER, use `count=4`), `"coin"` / `"heart"` / `"berry"` (Gold Rush / Cuddle / Replenish), or your own cells.
- The puff is the UNUSED_EXPLOSION_2 stand-in (`SUBS`); `type_` picks its tint the way CFRU does (NEN royal blue,
  TECTONIC reddish pink, otherwise orange).
- Budget: `puffs=8, rises=6` per column with flames (Flare peaks at 23 graphics with its volley), `puffs=10`
  without (Strike 12). Overlapping columns double the count, so keep `gap` >= 5.
- Puffs cover the target for the length of the columns; that is intended (CFRU does the same). Keep puffs at
  zoom 100-115 and opacity 220-235 so its edges show. When the target's colour change is the point of the move
  (Strike's yellow), peak the tone within about 7 frames of the first column and HOLD it until the BG fade (section
  2): at game scale three columns hide the target almost completely, so the colour reads in the 5-6 frames after
  the last column, not between the puffs.
- The puff stand-in is `pr:fire4` frames 1-7 (an orange-white cloud that blooms into grey smoke). `pr:Fire3`
  frames 12-22 at zoom 60-65 are the alternative for a hotter, spikier column (checked; not used by default).
- SpriteCB_Geyser-style risers are created per call; Max Lightning's SPARKSURF_SPARK_GEYSER (rings of sparks) is a
  different structure and is not covered by `geyser()`.

## 8. Missing vanilla particles

- CFRU uses 41 vanilla FireRed particles that the download does not have (`extract/particles.json` missingList).
  `SUBS[tag]` names the closest existing graphic (`src`, `frames`, the 1:1 `zoom`, `why`); `sub_cells(a, tag)`
  adds it to the sheet (`frames=` picks positions in the entry's own list).
- `inventory/cfru_particles.json` also lists VERTICAL_HEX, SMALL_EMBER, LEAF, SEED, SHARP_TEETH, ICE_ROCK_SINGLE,
  STONE_PILLAR_MULTI, HANDS_AND_FEET and EYE as missing, but CFRU ships its own art for them (`CFRU_REPLACED`):
  `tag_cells` takes the CFRU file.
- `tag_cells(a, tag)` takes any CFRU ANIM_TAG: the CFRU file with its palette pair when we have it, else the SUBS
  entry. `cfru_cells(a, file)` uses the right frame size from `inventory/cfru_particles.json` (with
  `FRAME_SIZE_FIX` for the guessed ones) or the `CFRU_BOXES` of sheets that are not on a grid (Leaves.png).
  Scale is automatic: 2 for frames up to 48 px, 1 for 64 px frames (scale 2 would crop them to the 96 px cell);
  set zoom for the final size (a 32 px particle at scale 2, zoom 65 = GBA size x 1.3).
- Do not use frames 5-7 of `pr:leer` (a ripper credit) or any frame with text.
- Check a new particle by eye before using it: frame cuts guessed by a heuristic can split pictures in half.

## 9. Sounds

- `se(a, t, "SE_M_...")` plays the mapped game file (`SE` dict; all files exist; every SE the Max scripts use is
  mapped, plus common move SEs). Map new GBA SEs there, short files first (the end hold).
- The geyser SE (SE_M_SELF_DESTRUCT) is `PRSFX- Selfedestruct2.wav` (1.13 s, the file name is misspelt in the game);
  the rumble is `PRSFX- Strength.wav`; Flare's opening `PRSFX- Megakick.wav`, its volley `PRSFX- Flame Wheel2.wav`.
- One sound per beat, not per particle: CFRU plays SE_M_SELF_DESTRUCT on 5 puffs of every column; we play it once
  per column (`geyser` does it, pitch rising 6 % per column).
- "PRSFX- " files play at half volume in the game; plain `.m4a` files at full volume. Keep volume 80-110.
- `se()` adds a report note for files over 1.6 s (Double Slap 1.9 s, Reflect 2.0 s, Solar Beam2 1.7 s, Twister
  1.7 s, Psybeam 1.6 s, Heat Wave 2.1 s, Hyper Beam 2.5 s): each adds about half its length of dead time after the
  last frame. Pitch does not change the hold: the engine counts the file length (corrected 2026-11-19 after review).
- 3-6 distinct sound events per move is plenty.

## 10. Layering

- Every frame holds the two battler cels first (the builder does this).
- Effects in front of everything: priority 1 (the default). Behind the Pokemon but above a BG: priority 2, first
  shown at least one frame after its AddBg, and not alive across a later AddBg (the engine places a slot's
  priority only when it changes, and a new AddBg goes on top of an old priority-2 slot). Never priority 0
  together with a background (the BG covers it). The build warns about both.
- Draw order between graphics = the order the spec creates the sprites (the builder lists them that way and the
  engine stacks new slots on top), so create what must be in front last (Flare: halo, then ball).
- Additive blend (`blend="add"`) for glows, flashes, orbs, energy; normal for solid things (balls, rocks, puffs).
  Blend "sub" renders as normal on WebGL: do not use it.
- At most about 24 graphics in a frame (`max_graphics_per_frame` in the report); the exemplars stay at 12-23.

## 11. Checking

```
cd D:/PokeRogueDev/tools/port/cfru_max
D:/SpriteGen/comfyui/ComfyUI_windows_portable/python_embeded/python.exe -I maxanim.py build max_foo --no-write [--gif]
```

Then look at `preview/max_foo.png`, `preview/max_foo_opp.png` (every 2nd frame) and `preview/max_foo_sheet.png`:

- both battlers visible except where an effect is meant to cover them;
- nothing important off screen (the target sits near the top: columns above its head clip, which is fine);
- the enemy-side version starts and ends in the right places;
- the console line: 40-75 frames, at most 24 graphics, hold under about 800 ms, 0 warnings;
- the `notes` in `build_report.json` (long sounds, rotated USER_TARGET sprites, BG seams).
