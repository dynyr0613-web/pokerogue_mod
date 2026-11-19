# Local fork (2026-11-19): the shared body of Max Lightning and G-Max Stun Shock, rebuilt from CFRU ANIM_MAX_LIGHTNING
# (Complete FireRed Upgrade, Skeli and the CFRU team; extract/ANIM_MAX_LIGHTNING.txt). CFRU's ANIM_G_MAX_STUNSHOCK only
# tints the three particle palettes (UNUSED_LIGHTNING, LIGHTNING, SPARK_2) 10/16 toward 0x701D and then jumps to
# ANIM_MAX_LIGHTNING_BEGIN, so both specs call lightning_body() with a different particle tint (None = Max Lightning).
# Group g3 file (specs/max_lightning.py, specs/g_max_stun_shock.py); the beat table is in those spec headers.
#
# Pieces:
# - storm_bg(): CFRU loadBG1 BG_MAX_LIGHTNING + AnimTask_scroll_background (-1 GBA px/f). The CFRU BG is not in the
#   download; "PRAS- Thunder BG" (storm clouds over a dark sky, the game's Thunder BG) stands in. It tiles on x
#   (bg_seams 0.8), so it scrolls left like CFRU's (4 field px a frame). AddBg y 284 puts the texture's cloud band
#   at the top of the screen. The two whole-screen yellow flashes (BG + all battlers 16/16 toward 0x17BF) cut to
#   "PRAS- Electric Terrain BG" (golden electric streaks, the closest yellow; "PRAS- Ion Deluge FG" is flat but lime)
#   for 2 frames each and back to the storm at the position it would have scrolled to; the scroll tweens are split
#   so none runs across an AddBg.
# - attacker_sparks(): MAX_LIGHTNING_PLAYER_SPARK_1 / _2 (Template_ElectricSparkPlayer = gSparkElectricitySpriteTemplate:
#   a SPARK_2 spark at angle a, radius 24 around the attacker, rotated r, 12 GBA f), 4 bursts.
# - spark_pillar(): SPARKSURF_SPARK_GEYSER (21 Template_SparkElectricityFlashing sparks orbiting the target in rings at
#   y 0 / -22 / -44 / -66, radius 5 and 21, built bottom-up every 4 GBA f, 44 f each). The three radius-5 sparks of a
#   ring sit within 6 px of each other and read as one, so each ring keeps one centre spark plus the three radius-21
#   sparks (13 instead of 21 per pillar, budget). CFRU spins them 40/256 of a turn per GBA frame (169 degrees per
#   frame of ours, which strobes back and forth); ours turn 60 degrees a frame and flicker / change spark frames.
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _common import *  # noqa: E402,F403

STORM_BG = "PRAS- Thunder BG"     # BG_MAX_LIGHTNING stand-in (tiles on x: scrolls cleanly)
STORM_Y = 284                     # AddBg bgY: the cloud band (texture rows 0-55) at the top of the screen
STORM_X0 = 320                    # AddBg bgX at the start; scrolling left lowers it (covered while >= -480)
FLASH_BG = "PRAS- Electric Terrain BG"  # golden electric streaks for CFRU's 16/16 BG + battlers blend to 0x17BF
FLASH_XY = (320, 284)             # AddBg x / y: the 256x144 texture exactly once on screen (no seam)
FLASH_K = 0.9                     # battler tone during the flash: 0.9 of a full blend toward 0x17BF (still shaded)
FLEX_K = 0.5                      # attacker pulses: AnimTask_pal_fade_complex PAL_ATK 0 -> 8/16 toward 0x17BF

# CFRU Template_ElectricSparkPlayer args (angle, rotation) in 256ths of a turn, radius 24 GBA px, and arg 6 (1 = drawn
# behind the attacker: oam priority + 1); ours: priority 3 with focus "user" = behind the user copy, above the BG
SPARK_BURSTS = [
    [(32, 190, 0), (80, 22, 0), (156, 121, 1)],     # MAX_LIGHTNING_PLAYER_SPARK_1
    [(100, 60, 0), (170, 42, 1), (238, 165, 1)],    # MAX_LIGHTNING_PLAYER_SPARK_2
]
# SPARKSURF_SPARK_GEYSER rings: (y GBA px from the target centre, has the radius-21 trio)
PILLAR_RINGS = [(0, True), (-22, False), (-44, True), (-66, True)]
# ours: ring heights x0.87 and radius 22 anim px (CFRU x1.3 would be 0..-86 with radius 27, i.e. up to 113 px above
# the target). The top ring then reaches 79 px above the target centre, the limit maxanim's preview can draw on the
# player side (a graphic wholly above the field crashes render_frame, reported 2026-11-19); the player-side target
# stands at the top of the screen, so the clipped CFRU top rings were not visible there anyway.
PILLAR_Y_SCALE = 0.87
PILLAR_R = 22.0


def yellow_tone(k):
    """Battler tone toward CFRU's lightning yellow 0x17BF (#FFEE29) at blend strength k (1 = 16/16)."""
    return blend_tone(TYPE_COLORS["electric"]["rgb"], k)


def _tint_opts(tint):
    return {"tint": tint} if tint else {}


def storm_bg(a, t0, t_end, flashes=(), fade_in=5, fade_out=7, vx=-4, step=4):
    """The scrolling storm BG from t0 (faded in from 0 over fade_in: CFRU fades the arena out and its BG in) to t_end
    (faded out by then), cut to FLASH_BG for each (frame, frames) in `flashes`. vx = field px per frame (CFRU: -1 GBA
    px per GBA frame ~ -4). Returns t_end."""
    def x_at(t):
        return STORM_X0 + vx * (t - t0)

    cuts = sorted((ft, ft + fd) for ft, fd in flashes)
    if cuts and cuts[0][0] < t0 + fade_in:
        raise ValueError("storm_bg: the first flash comes before the fade-in ends")
    segs, s = [], t0
    for ft, fe in cuts:
        segs.append((s, ft))
        s = fe
    segs.append((s, t_end))
    for i, (s0, s1) in enumerate(segs):
        a.bg(s0, STORM_BG, opacity=0 if (i == 0 and fade_in) else 255, x=x_at(s0), y=STORM_Y)
        t = s0
        while t < s1:   # scroll steps that stop at the next cut (no tween left running on a destroyed BG)
            d = min(step, s1 - t)
            a.bg_update(t, duration=d, x=2 * x_at(t + d))
            t += d
    if fade_in:
        bg_fade(a, t0, 0, 255, fade_in)
    for ft, fe in cuts:
        a.bg(ft, FLASH_BG, opacity=255, x=FLASH_XY[0], y=FLASH_XY[1])
    bg_fade(a, t_end - fade_out, 255, 0, fade_out)
    if x_at(t_end) < -480:
        raise ValueError("storm_bg: scrolled past the BG sprite's edge")
    return t_end


def _flex_state(t, flex0):
    """(zoom factor, lift px) of dynamax_flex(a, flex0) with the FLEX defaults at frame t (linear approximation)."""
    g, h, s = FLEX["grow"], FLEX["hold"], FLEX["shrink"]
    peak = FLEX["peak"] / 100
    lift = round(48 * (FLEX["peak"] - 100) / 100)
    u = t - flex0
    if u <= 0:
        k = 0.0
    elif u < g:
        k = 1 - (1 - u / g) ** 2          # ease "out"
    elif u <= g + h:
        k = 1.0
    elif u < g + h + s:
        k = 1 - ((u - g - h) / s) ** 2    # ease "in" back
    else:
        k = 0.0
    return 1 + (peak - 1) * k, lift * k


def attacker_sparks(a, flex0, bursts=4, gap=3, life=4, radius=40, tint=None, zoom=65, sound_every=2):
    """CFRU's 4 spark bursts around the attacker during the flex (SPARK_1 / SPARK_2 alternately, 12 GBA f apart),
    each spark crackling for `life` frames on a circle of `radius` anim px around the x1.5 user's centre (which the
    flex lifts and grows: positions follow it). SE_M_THUNDERBOLT2 on every `sound_every`-th burst (CFRU: every
    burst; one long crackle per two bursts keeps it from turning into noise). Returns the last spark's end."""
    cells = tag_cells(a, "SPARK_2", **_tint_opts(tint))
    end = flex0
    for b in range(bursts):
        tb = flex0 + gap * b
        if sound_every and b % sound_every == 0:
            se(a, tb, "SE_M_THUNDERBOLT2", volume=85)
        for j, (ang, rot, behind) in enumerate(SPARK_BURSTS[b % 2]):
            th = ang * 2 * math.pi / 256
            c0 = (j + b) % len(cells)   # each spark starts on a different spark frame and crackles through them
            s = a.sprite(cells[c0:] + cells[:c0], tb, tb + life, focus="user", zoom=zoom, angle=rot * 360 / 256,
                         priority=3 if behind else 1)
            for k in range(life):
                z, lift = _flex_state(tb + k, flex0)
                cy = -16 - lift
                s.key(k, pos=at_user(math.sin(th) * radius * z, cy + math.cos(th) * radius * z))
            s.key(life - 1, opacity=150)
            s.key(0, opacity=255)
            end = max(end, tb + life)
    return end


def attacker_pulses(a, t0, count=4, period=3):
    """AnimTask_pal_fade_complex PAL_ATK: the attacker flashes toward yellow 8/16 and back, `count` times."""
    peak = yellow_tone(FLEX_K)
    for i in range(count):
        t = t0 + i * period
        a.user.key(t, tone=[0, 0, 0, 0])
        a.user.key(t + 1, tone=peak)
        a.user.key(t + period, tone=[0, 0, 0, 0], ease="in")
    return t0 + count * period


def screen_flashes(a, flashes):
    """The whole-screen yellow blend (BG + all battlers 16/16 toward 0x17BF) on (frame, frames) pairs: both battlers
    take a bright yellow tone (the BG cut is storm_bg's)."""
    peak = yellow_tone(FLASH_K)
    for ft, fd in flashes:
        for b in (a.user, a.target):
            b.key(ft - 1, tone=[0, 0, 0, 0])
            b.key(ft, tone=peak)
            b.key(ft + fd - 1, tone=peak)
            b.key(ft + fd, tone=[0, 0, 0, 0])


def column_strike(a, t0, tint=None, x=0, life=9):
    """UNUSED_LIGHTNING x3 at target (0, -32 / -16 / +16): a lightning column striking the target (AnimLightning, 5
    frames 5 / 5 / 8 / 5 / 5 GBA f). Ours: one Thundercage bolt (the UNUSED_LIGHTNING stand-in) covering the same
    span, thin -> thick -> fading."""
    cells = tag_cells(a, "UNUSED_LIGHTNING", **_tint_opts(tint))   # thin, thin, thick, thick
    seq = [cells[0], cells[1], cells[2], cells[3], cells[2], cells[3], cells[2], cells[3], cells[1]][:life]
    s = a.sprite(seq, t0, t0 + life, focus="target", loop=False, pos=at_target(gba(x), gba(-8)))
    s.key(0, zoomX=100, zoomY=118)
    s.fade(255, 255, t_from=0, t_to=life - 3)
    s.fade(255, 90, t_from=life - 3, t_to=life - 1)
    return t0 + life


def side_bolt(a, t0, x, tint=None, life=7):
    """Template_Lightning x3 at target (x, -36 / -20 / +12): a lightning bolt (LIGHTNING) beside the target, 28 GBA f.
    Ours: the Thundercage strike-from-a-flare frames (the LIGHTNING stand-in) over the same span."""
    cells = tag_cells(a, "LIGHTNING", **_tint_opts(tint))
    seq = [cells[0], cells[1], cells[2], cells[1], cells[2], cells[1], cells[0]][:life]
    s = a.sprite(seq, t0, t0 + life, focus="target", loop=False, pos=at_target(gba(x), gba(-12)), zoom=105)
    s.fade(255, 255, t_from=0, t_to=life - 3)
    s.fade(255, 80, t_from=life - 3, t_to=life - 1)
    return t0 + life


def spark_pillar(a, t0, tint=None, life=7, ring_gap=1, zoom=62, spin=60, sound=True):
    """SPARKSURF_SPARK_GEYSER: rings of crackling sparks orbiting the target, built bottom-up `ring_gap` frames apart,
    each spark alive `life` frames (CFRU 44 GBA f). Returns the frame the top ring ends."""
    cells = tag_cells(a, "SPARK_2", **_tint_opts(tint))
    if sound:
        se(a, t0, "SE_M_TRI_ATTACK2", volume=90)
    end = t0
    n = 0
    for k, (gy, trio) in enumerate(PILLAR_RINGS):
        ts = t0 + k * ring_gap
        cy = gy * PILLAR_Y_SCALE
        orbits = [(gba(5), 0)] + ([(PILLAR_R, 0), (PILLAR_R, 64), (PILLAR_R, 128)] if trio else [])
        for j, (r, start) in enumerate(orbits):
            off = n
            c0 = off % len(cells)
            s = a.sprite(cells[c0:] + cells[:c0], ts, ts + life, focus="target", zoom=zoom)
            for f in range(life):
                th = math.radians(start * 360 / 256 + spin * f + 37 * k)
                s.key(f, pos=at_target(math.sin(th) * r, cy + math.cos(th) * r),
                      opacity=255 if (f + off) % 2 == 0 else 150)   # Template_SparkElectricityFlashing flicker
            s.key(life - 1, opacity=110)
            n += 1
        end = max(end, ts + life)
    return end


def lightning_body(a, name, tint=None):
    """The whole ANIM_MAX_LIGHTNING_BEGIN body (61 frames). `tint` = the particle tint (G-Max Stun Shock: 10/16
    toward 0x701D), None for Max Lightning. The BG, the flashes and the target colour stay CFRU's yellow either
    way (CFRU's Stun Shock prelude recolours only the three particle palettes)."""
    L = 61
    begin(a, name, L)
    fade = L - 8                       # f53: CFRU f269, the yellow and the storm BG fade back together
    flashes = [(21, 2), (25, 2)]       # CFRU f111 / f121: 5 GBA f yellow, 5 normal, 5 yellow
    pillars = [27, 35, 43]             # CFRU f126 / f166 / f206 (40 GBA f apart -> 8)

    # --- BG swap (no dark stage in this move): the arena fades into the scrolling storm; yellow flashes cut in
    storm_bg(a, 0, L - 1, flashes=flashes, fade_in=5, fade_out=L - 1 - fade)

    # --- flex after the BG swap, as in CFRU; sparks crackle round the attacker, which pulses yellow 4 times
    flex0 = 4
    flex_end = dynamax_flex(a, flex0)
    attacker_sparks(a, flex0, tint=tint)
    attacker_pulses(a, flex0 + 1, count=4, period=3)

    # --- the lightning column hits; two screen flashes; the target shakes and turns yellow under three spark
    # pillars, interleaved with two bolts at x +20 / -20 (CFRU's x offsets are mirrored for an enemy attacker:
    # symmetric here, so only the order of the two bolts changes)
    column_strike(a, flex_end, tint=tint)
    se(a, flex_end, "SE_M_TRI_ATTACK2", volume=100)
    screen_flashes(a, flashes)
    a.target.shake(flex_end + 2, fade, amp=5, period=1, axis="y")
    impact(a, pillars[0], fade + 7, "electric", ramp=8, release=7, shake=False)
    for i, tp in enumerate(pillars):
        spark_pillar(a, tp, tint=tint)
        if i == 1:
            side_bolt(a, tp - 1, 20, tint=tint)
        elif i == 2:
            side_bolt(a, tp - 1, -20, tint=tint)
            se(a, tp - 1, "SE_M_THUNDER_WAVE", volume=100)
    return L
