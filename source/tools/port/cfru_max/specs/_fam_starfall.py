# Local fork (2026-11-19): shared body of Max Starfall and G-Max Smite, rebuilt from CFRU ANIM_MAX_STARFALL and
# ANIM_G_MAX_SMITE (Complete FireRed Upgrade, Skeli and the CFRU team; extract/ANIM_MAX_STARFALL.txt,
# extract/ANIM_G_MAX_SMITE.txt). Both scripts call the same STARFALL_STAR_TWINKLE and STARFALL_STARS_FALL and end with
# the same 7-segment STARFALL_BEAM pillar on the target; Smite swaps Starfall's three side pillars (STARFALL_BEAMS_UP)
# for 13 waves of light-blue spark lines (SMITE_CREATE_ELECTRICITY), draws its target pillar with beam frame 1 (the
# light-blue "Smite" frame of Straight_Beam.png) and blends the target light blue (0x7F0C) instead of pink (0x7A5B).
# Used by specs/max_starfall.py and specs/g_max_smite.py (files starting with _ are not built on their own).
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403

__all__ = ["STARS", "STAR_REST", "starfall_opening", "star_pillar", "side_pillars", "smite_sparks", "starfall_finish",
           "STARFALL_TIMES"]

# CFRU positions, GBA px from the target centre (x right, y down): the three stars (STARFALL_STAR x, y), the pillars
# rising from them (STARFALL_BEAM x, bottom segment y) and the spark lines (SMITE_SPARK_LINE x, y). The middle one is
# the 0x42 / 0x43 sprite (drawn in front of the other two).
STARS = [(30, 20), (-30, 20), (3, 16)]
STAR_REST = [gba(x, y) for x, y in STARS]            # (39, 26), (-39, 26), (3.9, 20.8) anim px
PILLAR_X = [30, -30, 3]
PILLAR_BOTTOM = [19, 19, 17]                        # centre of the lowest of the 7 segments (16 px apart, up to y-77)
SPARK_FROM = [(30, 3), (-30, 3), (3, -1)]

# The twinkles: CFRU puts them at the very top of the screen (GBA y 6) above the target's x; our target-relative y -40
# is the top for the enemy target at the top right (field y 12: the 38 px burst frame is cut by about 7 px, as CFRU's
# 32 px glint at y 6 is; review 2026-11-19: -44 cut 11 px) and still above the player's head when an enemy uses the
# move. The stars appear just above the twinkle (CFRU: 64 GBA px above their resting place, which for the enemy
# target is the screen top) and drop with acceleration.
TWINKLE_Y = -40
STAR_START_Y = -50

# the frames every beat starts on (shared so the two specs and the header tables agree)
STARFALL_TIMES = {"twinkle": 6, "fall": 15, "land": 19, "middle": 21}

SEG = 16 * GBA_PX       # one STARFALL_BEAM segment (16 GBA px) in anim px


def _beam_cells(a, frame):
    """Straight_Beam.png frame (0 = white with lilac-pink edges: Starfall; 1 = white with light-blue edges: Smite) at
    scale 2: a 32 x 32 px uniform vertical strip, so stretching it vertically keeps its look (CFRU's stacked 16 px
    segments become one stretched sprite here)."""
    return cfru_cells(a, "Straight_Beam.png", frames=[frame])


def starfall_opening(a, star_cells=None, times=STARFALL_TIMES, star_zoom=68, star_end=None):
    """CFRU f0-104 of both moves: BG darkens, Dynamax flex, three twinkles at the top of the screen above the target
    (SE_M_DETECT), then (after the flex) three big yellow stars drop onto the target's feet (SE_FALL) and stay.
    `star_end` = the frame the stars are gone (they shrink away over the last 3 frames). Returns the star sprites."""
    t_tw, t_fall, t_land = times["twinkle"], times["fall"], times["land"]
    flex_end = dynamax_flex(a, 0)
    assert flex_end <= t_fall

    # --- twinkles (STARFALL_TWINKLE: the LEER glint plays sLeerAnimTable once, 5 frames x 3 GBA f, and vanishes).
    # pr:leer frames 0-4 are that whole 5-step glint (small glint, star, burst, small spark, streak); SUBS lists only
    # 0-2, and frames 5-7 are a ripper credit (never used). Review 2026-11-19: was 0, 1, 2, 1, 0.
    tw = sub_cells(a, "LEER") + a.cells("pr:leer", frames=[3, 4])
    for gx, _gy in STARS:
        a.sprite(tw, t_tw, t_tw + 5, focus="target", loop=False, pos=at_target(gba(gx), TWINKLE_Y), zoom=125)
    se(a, t_tw, "SE_M_DETECT", volume=90)

    # --- the stars fall (AnimRockTomb: appears 64 GBA px up, accelerates down, stays 119 f)
    if star_cells is None:
        # YELLOW_STAR stand-in: the upright 5-point star of PRAS- Meteor Mash (frame 2, 16 x 14 px) at scale 4 reads
        # like CFRU's 2x Swift star; the skewed PRAS- Swift star (SUBS) looks flat at this size
        star_cells = a.cells("pr:PRAS- Meteor Mash", frames=[2], scale=4)
    se(a, t_fall, "SE_FALL")
    stars = []
    end = star_end if star_end is not None else a.frames - 1
    for rx, ry in STAR_REST:
        s = a.sprite(star_cells, t_fall, end, focus="target", zoom=star_zoom)
        s.key(0, pos=at_target(rx, STAR_START_Y), opacity=255)
        s.key(t_land - t_fall, pos=at_target(rx, ry), ease="in")
        life = end - t_fall
        s.key(life - 3, zoom=star_zoom, opacity=255)
        s.key(life - 1, zoom=star_zoom * 0.35, opacity=120, ease="in")
        stars.append(s)
    return stars


def star_pillar(a, cells, t0, life, x, bottom_gba, segs=8, build=3, widen_at=2, thin=21, wide=42, flicker=0.14,
                shrink=3, blend="normal", opacity=235):
    """One STARFALL_BEAM column on the target: CFRU stacks 7 16x16 segments from `bottom_gba` (GBA y of the lowest
    segment's centre) upward 16 px apart, one per GBA frame (here: grown bottom-up over `build` frames), each widening
    from 1x to 2x 6 f after the first (`widen_at` frames) and then flickering in width. Ours: one stretched sprite of
    the beam strip, `thin` -> `wide` anim px wide; it narrows away over the last `shrink` frames. segs=8 (one segment
    more than CFRU) so the top also leaves the screen for the player-side target, which stands lower than CFRU's."""
    gx = gba(x)
    bottom = gba(bottom_gba) + SEG / 2
    height = SEG * segs
    s = a.sprite(cells, t0, t0 + life, focus="target", blend=blend, opacity=opacity)
    zx = lambda w: w / 32 * 100  # noqa: E731  (the strip is 32 px wide at scale 2)
    zy = lambda h: h / 32 * 100  # noqa: E731
    for k in range(build):
        h = height * (k + 1) / build
        s.key(k, pos=at_target(gx, bottom - h / 2), zoomY=zy(h))
    s.key(0, zoomX=zx(thin))
    s.key(widen_at, zoomX=zx(thin))
    s.key(widen_at + 1, zoomX=zx(wide), ease="out")
    for k in range(widen_at + 2, life - shrink):
        s.key(k, zoomX=zx(wide * (1 - flicker if k % 2 else 1)))
    s.key(life - shrink, zoomX=zx(wide), opacity=opacity)
    s.key(life - 1, zoomX=zx(wide * 0.15), opacity=opacity * 0.6, ease="in")
    return s


def side_pillars(a, t0, life=17, beam_frame=0, blend="add", opacity=215, wide=38):
    """Starfall's STARFALL_BEAMS_UP: a pillar rises from each star (SE_M_MEGA_KICK x3, 13 GBA f apart). CFRU's three
    opaque 32 px pillars stand almost edge to edge in front of the target for 105 f; ours are additive light (and a
    little narrower) so the target and the stars still show through the wall."""
    cells = _beam_cells(a, beam_frame)
    for x, b in zip(PILLAR_X, PILLAR_BOTTOM):
        star_pillar(a, cells, t0, life, x, b, blend=blend, opacity=opacity, wide=wide)
    for k in range(3):
        se(a, t0 + 4 * k, "SE_M_MEGA_KICK", volume=95 if k == 0 else 85)


def smite_sparks(a, t0, waves=8, gap=2, life=6, speed=16, drift=2):
    """Smite's SMITE_CREATE_ELECTRICITY x13: three spark lines (SPARK 8x32 at 2x, tinted 16/16 toward 0x7FAF) shoot
    straight up from the star positions every 4 GBA f (SpriteCB_Geyser: 4 GBA px a GBA frame = 16 anim px a frame,
    drifting right 1 px per 2 f), plus SE_M_MEGA_KICK x3 like Starfall. Ours: `waves` waves `gap` frames apart."""
    # SPARK stand-in: GEN8- Thundercage frames 2 / 3 are thin vertical lightning lines about CFRU's 16 x 64 GBA size
    # (the SUBS SPARK entry, pr:electric2, is a pair of small yellow zigzags, not a line); light blue like 0x7FAF
    blue = EXTRA_COLORS["light_blue"]
    cells = a.cells("pr:GEN8- Thundercage", frames=[2, 3], tint=(blue[0], blue[1], blue[2], 0.94))
    for w in range(waves):
        t = t0 + w * gap
        for i, (gx, gy) in enumerate(SPARK_FROM):
            x, y = gba(gx, gy)
            s = a.sprite(cells[(w + i) % 2], t, t + life, focus="target", blend="add")
            s.move(at_target(x, y), at_target(x + drift * (life - 1), y - speed * (life - 1)), t_to=life - 1)
            s.fade(240, 240, t_from=0, t_to=life - 3)
            s.fade(240, 60, t_from=life - 3, t_to=life - 1)
    for k in range(3):
        se(a, t0 + 4 * k, "SE_M_MEGA_KICK", volume=95 if k == 0 else 85)
    return t0 + (waves - 1) * gap + life


def starfall_finish(a, t0, beam_frame, type_=None, tone=None, life=19):
    """CFRU STARFALL_TARGET_BEAM_UP / SMITE_TARGET_BEAM_UP and the end: the target blends slowly to the move colour
    (one step / 7 f) and shakes horizontally (4 GBA px, 96 toggles) while a pillar rises on it (180 f, SE_M_SOLAR_BEAM);
    then the colour and the dark stage fade back together. The dark stage must run to a.frames - 1 (fade_out 8)."""
    L = a.frames
    fade = L - 9                                   # colour and darkness fade back together (CFRU f391 / f353)
    if t0 + life > fade + 1:
        raise ValueError(f"target pillar f{t0}..{t0 + life} runs into the fade at f{fade}")
    star_pillar(a, _beam_cells(a, beam_frame), t0, life, 0, 19, flicker=0.12)
    # Solar Beam2 is 1.74 s: 0.88 s of end hold (the engine's hold uses the file length, not the played rate, so a
    # higher pitch would not shorten it); kept, it is CFRU's sound for both moves (and G-Max Finale)
    se(a, t0, "SE_M_SOLAR_BEAM", volume=95)
    impact(a, t0, fade + 7, type_, amp=4, period=1, axis="x", ramp=10, release=7, shake_end=fade, tone=tone)
    return fade
