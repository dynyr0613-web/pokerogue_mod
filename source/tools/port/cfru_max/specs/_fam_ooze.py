# Local fork (2026-11-19): shared body of Max Ooze and G-Max Malodor, rebuilt from CFRU ANIM_MAX_OOZE /
# ANIM_G_MAX_MALODOR (Complete FireRed Upgrade, Skeli and the CFRU team; extract/ANIM_MAX_OOZE.txt,
# extract/ANIM_G_MAX_MALODOR.txt). Malodor is Ooze re-coloured: the orbiting bubbles take the RAZOR_LEAF palette,
# BG_POISON becomes BG_GARBAGE_FALLS, POISON_COLUMN becomes GARBAGE_COLUMN (the same picture with the garbage
# palette) and the target blends garbage green 0x2DCC instead of purple 0x6038. The spec files pass those.
import math
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403

# --- timeline (our frames); CFRU frames in brackets
LENGTH = 55
ORBIT = (1, 15)                # [f0-52] 6 bubbles orbit the attacker during the flex (from f1: the BG is added at f0)
COLUMNS = [                    # CFRU POISON_COLUMN args: target x, y (GBA px), our start frame
    (30, 5, 15),               # [f72]  SE_M_HYDRO_PUMP
    (-50, -10, 23),            # [f120] SE_M_HYDRO_PUMP (48 GBA f apart -> 8 frames)
    (-10, -25, 31),            # [f168] SE_SHIP
]
HIT = 32                       # [f171] target shake + colour blend start (3 GBA f after the last column)
COL_END = 45                   # [f269] the columns vanish together
RELEASE = 46                   # [f269] colour fades back (CFRU 49 GBA f), BG restored (CFRU 32 GBA f)

# AnimReversalOrb (OOZE_REVERSAL / MALODOR_REVERSAL, arg 0x1a): angle +9/256 per GBA f from 0, 42, 84, 126, 168,
# 210; x radius grows 4 GBA px / f and y radius 1 px / f for 26 f, then shrinks (a flat 4:1 ring around the waist);
# in front of the attacker while angle < 64 or > 195 (the lower half of the ring), behind it otherwise.
ORBIT_STARTS = [0, 42, 84, 126, 168, 210]
ORBIT_RX, ORBIT_RY = 78, 20    # CFRU peaks at 104 x 26 GBA px; scaled to stay on screen for a user on either side
ORBIT_TURNS = 1.5              # CFRU 52 GBA f x 9/256 = 1.83 turns
# the column: 32x64 frames (grows from a stub over frames 0-3, then cycles 4-6), shown 2x (LargeHailRock affine)
COLUMN_ZOOM = 260              # 2x x 1.3
COLUMN_LIFT = -12              # anim px: CFRU's columns reach 64 GBA px below their centre (col 1 ends ~40 GBA px
                               # under the target's feet); lifted a little so the bases stay clear of a player-side
                               # user, col 3 (the highest) still starting just under the feet


def _flex_progress(t):
    """0..1 of dynamax_flex at frame t (6 grow, 6 hold, 3 back), to follow the x1.5 user's centre."""
    if t <= 0 or t >= 15:
        return 0.0
    if t < 6:
        u = t / 6
        return 1 - (1 - u) * (1 - u)
    if t < 12:
        return 1.0
    u = (t - 12) / 3
    return 1 - u * u


def orbit_bubbles(a, cells, t0=ORBIT[0], t1=ORBIT[1], zoom=100):
    """CFRU's six AnimReversalOrb bubbles around the attacker. Each bubble is split into runs in front of the
    attacker (priority 1) and behind it (priority 2, over the BG), one sprite per run, created bubble by bubble so
    every bubble keeps the same slot (the engine re-applies a slot's priority when it changes)."""
    life = t1 - t0
    for st in ORBIT_STARTS:
        runs = []                       # [front?, [(t, x, y, z)]]
        for k in range(life):
            t = t0 + k
            u = k / (life - 1)
            r = 1 - abs(2 * u - 1)      # grows then shrinks (CFRU: linear, 26 f each way)
            ang = (st + 256 * ORBIT_TURNS * u) % 256
            rad = ang / 256 * 2 * math.pi
            cx, cy = at_user(0, -14 - 8 * _flex_progress(t))   # the x1.5 user's centre, lifted with the flex
            x = cx + math.sin(rad) * ORBIT_RX * r
            y = cy + math.cos(rad) * ORBIT_RY * r
            z = zoom * min(1.0, 0.45 + 0.55 * k / 2)            # GrowingFist affine: the bubble swells in
            front = ang < 64 or ang > 195
            if not runs or runs[-1][0] != front:
                runs.append([front, []])
            runs[-1][1].append((t, x, y, z))
        for front, pts in runs:
            ta, tb = pts[0][0], pts[-1][0] + 1
            s = a.sprite(cells, ta, tb, focus="user", priority=1 if front else 2)
            for t, x, y, z in pts:
                s.key(t - ta, pos=(x, y), zoom=z)


def poison_columns(a, cells, end=COL_END, zoom=COLUMN_ZOOM, lift=COLUMN_LIFT, sounds=True):
    """CFRU POISON_COLUMN / GARBAGE_COLUMN (SpriteCB_SpriteOnMonForDuration, in front of the target): each appears
    at its target offset, grows from a stub (frames 0-3) and cycles frames 4-6 until they all vanish together."""
    snd = ["SE_M_HYDRO_PUMP", "SE_M_HYDRO_PUMP", "SE_SHIP"]
    for i, (gx, gy, t) in enumerate(COLUMNS):
        if sounds:
            se(a, t, snd[i], volume=100 if i < 2 else 90)
        s = a.sprite(cells, t, end, focus="target", pos=at_target(gba(gx), gba(gy) + lift), zoom=zoom)
        s.cell_override = (lambda t0: (lambda f: cells[f - t0] if f - t0 < 4 else cells[4 + (f - t0 - 4) % 3]))(t)
        s.fade(245, 245, t_from=0, t_to=end - t - 2)
        s.fade(245, 150, t_from=end - t - 2, t_to=end - t - 1)


def drift_bg(a, t0, t1, image, top_from, top_to, fade_in=6, fade_out=8, step=4):
    """A scene BG (CFRU loadBG1 + AnimTask_scroll_background) that slides vertically between two positions of the
    texture: top_from / top_to = the field y of the BG sprite's top edge (texture row 0) at t0 / t1 (0 = the
    texture's top row at the top of the screen; negative = shifted up). Unlike scene_bg it starts at a chosen
    offset, so a texture that only tiles in part (PRAS- Sludge Wave FG: opaque rows 50-383) or not at all
    vertically (PRAS- Thousand WA BG) can drift without showing a seam or a transparent band. AddBg bgY = top + 284;
    UpdateBg bgY (half units) = 2 x (top + 284). Fades in from 0 over fade_in (the arena shows through, as CFRU's
    BG cross-fade) and out to 0 by t1."""
    a.bg(t0, image, opacity=0 if fade_in else 255, x=0, y=round(top_from + 284))
    if fade_in:
        bg_fade(a, t0, 0, 255, fade_in)
    span = t1 - t0
    t = t0
    while t < t1:
        d = min(step, t1 - t)
        u = (t + d - t0) / span
        a.bg_update(t, duration=d, y=round(2 * (top_from + (top_to - top_from) * u + 284)))
        t += d
    bg_fade(a, t1 - fade_out, 255, 0, fade_out)
    if t1 > a.frames - 1:
        raise ValueError("drift_bg must end by the last frame")


def ooze_body(a, sheet, bg, bg_top, bubble_cells, column_cells, tone_type="poison", tone=None):
    """The whole Max Ooze / G-Max Malodor animation (LENGTH frames). bg / bg_top: the BG_POISON / BG_GARBAGE_FALLS
    stand-in and its (top_from, top_to) drift; bubble_cells / column_cells: the recoloured particles; tone: the
    target's blend (None = TYPE_COLORS[tone_type])."""
    L = LENGTH
    begin(a, sheet, L)
    # no dark stage in CFRU: the battle BG fades straight to the poison BG, which scrolls until the end
    drift_bg(a, 0, L - 1, bg, bg_top[0], bg_top[1], fade_in=6, fade_out=L - 1 - RELEASE)
    dynamax_flex(a, 0)
    se(a, 0, "SE_M_BUBBLE3")                   # CFRU soundcomplex x3, 13 GBA f apart; ours x2
    se(a, 5, "SE_M_BUBBLE3", volume=80, pitch=110)
    orbit_bubbles(a, bubble_cells)
    poison_columns(a, column_cells)
    # CFRU: AnimTask_move_bank (target, y 4 px, 47 toggles) + pal_fade 0 -> 16/16 one step / 3 f, held until the
    # columns vanish, then 16 -> 0; the colour reads after the columns go (they cover the target, as in CFRU)
    impact(a, HIT, L - 1, tone_type, ramp=8, release=L - 1 - RELEASE, shake_end=COL_END, tone=tone)
    a.note("Orbit: CFRU's AnimReversalOrb ring peaks at 104 x 26 GBA px; ours 78 x 20 anim px so it stays on "
           "screen for a user on either side; front / back halves as in CFRU (priority 1 / 2 runs per bubble)")
    a.note("Columns: CFRU centres them on the target offsets, so their bases sit 64 GBA px lower (near the "
           f"player's side of the field); ours are lifted {-COLUMN_LIFT} px (zoom {COLUMN_ZOOM} % = CFRU's 2x) so "
           "their bases sit 6-45 px under the target's feet (col 3 highest, as in CFRU)")
    a.note("BG scroll: CFRU's offset (0, -0.94) px/f moves the picture down (reversed for an enemy attacker, which "
           "one file cannot do): ours drifts down for both sides")
    return L
