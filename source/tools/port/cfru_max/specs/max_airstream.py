# Local fork (2026-11-19): Max Airstream, rebuilt from CFRU ANIM_MAX_AIRSTREAM (Complete FireRed Upgrade, Skeli and
# the CFRU team; extract/ANIM_MAX_AIRSTREAM.txt).
# CFRU beats (194 GBA f) -> ours (48 frames):
#   f0    METAL_SOUND_WAVES palette made grayscale and blended 9/16 toward white
#                                                                  -> baked into the ring cell (SUBS grey-white tint)
#   f0    BG darkens 14/16 (29 f); Dynamax flex (72 f)             -> f0..8 dark, flex f0..14
#   f0    5 AIRSTREAM_SPINNING_BLADE (AIR_WAVE_2 crescents flipping every 3 f), launched 2 f apart with extra delays
#         0/4/8/12/16 (= every 6 f), each spiralling out of the attacker for 56 f (AnimFireSpiralOutward: angle
#         +10/256 a frame, radius +0.81 px a frame: 2.2 turns out to 45 px); SE_M_GUST2 x5 (f0..8)
#                                                                  -> f0, 2, 4, 6, 8, 12 frames each, 1.8 turns out to
#                                                                     64 px around the chest (follows the flex lift);
#                                                                     gust f0 + f6
#   f70   SE_M_JUMP_KICK x11, 7 f apart; 20 AIRSTREAM_RINGs, one every 2 f, each flies attacker (+16, 0) -> target in
#         22 f (the 32x64 METAL_SOUND_WAVES sprite, spinning)      -> 18 rings f15..32, one a frame, 7 frames each,
#                                                                     landing on their last frame (f21..38); Jump
#                                                                     Kick every 3 frames f15..36
#   f78   target shakes horizontally (4 px, 29 toggles every 3 f, to f165), after the 4th ring
#                                                                  -> f18..39 (plus a soft white tone: CFRU has none)
#   f165  BG brightens back (29 f)                                 -> f39..47
import math
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403

MOVE_ID = "MAX_AIRSTREAM"

BLADE_STARTS = [0, 2, 4, 6, 8]   # CFRU 0/6/12/18/24 GBA f (2 f apart + 0/4/8/12/16 delays)
BLADE_LIFE = 12                  # CFRU 56 GBA f (18.7 frames), compressed into the flex
BLADE_TURNS = 1.8                # CFRU 2.2 turns; a little slower so the crescents stay readable at 20 fps
BLADE_RADIUS = 64                # CFRU 45 GBA px x 1.3 = 59; a little more so the last turn clears the x1.5 body
RING_START = (20, 0)             # CFRU attacker + (16, 0) GBA px; USER_TARGET, on the focus point's height
RING_END = (128, -64)            # the target centre
RING_COUNT = 18
RING_LIFE = 7                    # CFRU 22 GBA f
# the tall ring stands across the user -> target line (26.6 deg). Both sides share that line's slope and the ring is
# symmetric, so the unmirrored angle is right for an enemy user too (checked in preview/max_airstream_opp.png)
RING_TILT = math.degrees(math.atan2(64, 128))
# per-ring (zoomX, zoomY), cycling: one ring a frame on one path would sit in the same places every frame (a frozen
# tube); a 3-step size cycle makes the pattern visibly run forward one ring a frame
RING_SIZES = [(52, 130), (38, 96), (45, 112)]


def chest_y(t):
    """The x1.5 user's chest (graphic focus offset) during the flex: -14 at rest, -22 at the peak (lift 12)."""
    if t <= 0:
        return -14.0
    if t < 6:
        return -14.0 - 8.0 * (1 - (1 - t / 6) ** 2)      # ease out, like the flex growth
    if t <= 12:
        return -22.0
    if t < 15:
        return -22.0 + 8.0 * ((t - 12) / 3) ** 2          # ease in, like the snap back
    return -14.0


def build(a):
    L = 48
    begin(a, "CFRU- Max Airstream", L)
    blades = sub_cells(a, "AIR_WAVE_2")                   # CFRU's crescent tiles tinted near white (SUBS)
    ring = sub_cells(a, "METAL_SOUND_WAVES", frames=[0])  # the big Supersonic ring tinted grey-white (SUBS)

    # --- opening: dark stage, flex, gusts (CFRU plays SE_M_GUST2 five times in 8 GBA f: one thick gust)
    dark_stage(a, 0, L - 1, fade_in=8, fade_out=8)
    flex_end = dynamax_flex(a, 0)
    se(a, 0, "SE_M_GUST2", volume=90)
    se(a, 6, "SE_M_GUST2", volume=75)

    # --- five air crescents spiralling out of the attacker's chest (AnimFireSpiralOutward: x = sin(a) r, y = cos(a) r,
    # starting below the centre and turning counter-clockwise on screen; focus "user" keeps that for an enemy user,
    # as CFRU does). The 5 crescent cells cycle every frame: CFRU flips the crescent every 3 GBA f.
    for t0 in BLADE_STARTS:
        s = a.sprite(blades, t0, t0 + BLADE_LIFE, focus="user", cell_every=1, zoom=65)
        for k in range(BLADE_LIFE):
            u = k / (BLADE_LIFE - 1)
            ang = 2 * math.pi * BLADE_TURNS * u
            r = 4 + (BLADE_RADIUS - 4) * u
            s.key(k, pos=at_user(2 + math.sin(ang) * r, chest_y(t0 + k) + math.cos(ang) * r))
        s.fade(0, 255, t_from=0, t_to=1)
        s.fade(255, 255, t_from=1, t_to=BLADE_LIFE - 3)
        s.fade(255, 0, t_from=BLADE_LIFE - 3, t_to=BLADE_LIFE)

    # --- the ring stream: tall rings (CFRU's 32x64 wave sprite) rushing in a straight line into the target
    for i in range(RING_COUNT):
        t0 = flex_end + i
        zx, zy = RING_SIZES[i % len(RING_SIZES)]
        s = a.sprite(ring, t0, t0 + RING_LIFE, focus="user_target", angle=RING_TILT)
        s.move(RING_START, RING_END, t_to=RING_LIFE - 1)       # lands on its last visible frame
        s.key(0, zoomX=zx * 0.8, zoomY=zy * 0.8, opacity=140)  # comes out of the attacker
        s.key(1, zoomX=zx, zoomY=zy, opacity=235)
    for k in range(8):
        se(a, flex_end + 3 * k, "SE_M_JUMP_KICK", volume=85)

    # --- the target shakes sideways from the 4th ring on, with a soft white tone; the BG brightens back after
    impact(a, flex_end + 3, L - 4, "flying", amp=5, period=1, axis="x", k=0.45, ramp=6, release=5,
           shake_end=L - 9)

    a.note("CFRU: no target blend in Max Airstream; a 0.45 sky-white tone was added so the hits read at game scale")
    a.note("Rings: the vanilla METAL_SOUND_WAVES (a 32x64 wave sprite that CFRU spins) is not in the CFRU download; "
           "the Supersonic ring tinted grey-white (SUBS) squashed to about 45 x 112 % stands in for the tall wave, "
           "tilted 26.6 deg across the flight line instead of spinning (a spinning ellipse chain read as a tangle). "
           "The tilt is right for an enemy user too: same line slope, symmetric art")
    a.note("Rings: 18 one a frame instead of 20 two GBA f apart; sizes cycle in threes so the stream visibly runs "
           "forward (identical rings one a frame would look frozen at 20 fps)")
    a.note("Blades: 12 frames each, 1.8 turns to 64 px (CFRU 56 GBA f, 2.2 turns to 45 GBA px) so all five finish "
           "just after the flex and the last turn clears the Dynamaxed body")
