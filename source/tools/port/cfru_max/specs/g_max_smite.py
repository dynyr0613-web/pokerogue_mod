# Local fork (2026-11-19): G-Max Smite, rebuilt from CFRU ANIM_G_MAX_SMITE (Complete FireRed Upgrade, Skeli and the
# CFRU team; extract/ANIM_G_MAX_SMITE.txt). Body shared with Max Starfall: specs/_fam_starfall.py.
# CFRU beats (386 GBA f) -> ours (61 frames):
#   f0    SPARK tinted 16/16 toward light blue 0x7FAF; BG darkens 14/16 (29 f); Dynamax flex (72 f)
#                                                                  -> f0..7 dark, flex f0..14 (tint baked in the cells)
#   f32   Max Starfall's 3 twinkles above the target (LEER, SE_M_DETECT)
#                                                                  -> f6..10 (the 5-step leer glint)
#   f72   Max Starfall's 3 big yellow stars drop onto the target's feet and stay 119 f (SE_FALL)
#                                                                  -> f15..18 fall, rest f19..38, shrink away f39..41
#   f104  SE_M_MEGA_KICK x3; 13 waves (4 f apart) of 3 light-blue spark lines (SPARK 8x32, 2x) shooting straight up
#         from the star positions (SpriteCB_Geyser, 4 px/f)        -> 7 waves f21..33, 2 frames apart, 6 frames each
#                                                                     (16 anim px a frame); kicks f21/25/29
#   f161  (9 f after the last wave) target blends to light blue 0x7F0C (one step / 7 f), shakes horizontally (4 px x
#         96), a pillar with the Smite beam frame (Straight_Beam frame 1, light-blue edges) rises on it (180 f),
#         SE_M_SOLAR_BEAM; the last sparks are still rising and the stars stay until f207
#                                                                  -> f35..51 pillar (2 frames after the last wave),
#                                                                     light blue peaks f45 and holds, shake f35..51
#   f353  light blue and darkening fade back (2 f steps)           -> f52..59 tone, f52..60 dark stage
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403
from _fam_starfall import STARFALL_TIMES, starfall_opening, smite_sparks, starfall_finish  # noqa: E402

MOVE_ID = "G_MAX_SMITE"

# CFRU's target blend 0x7F0C (#62C5FF) is not in EXTRA_COLORS ("light_blue" there is the spark tint 0x7FAF)
SMITE_TARGET = gba_rgb(0x7F0C)


def build(a):
    L = 61
    begin(a, "CFRU- G-Max Smite", L)
    dark_stage(a, 0, L - 1, fade_in=8, fade_out=8)
    # review 2026-11-19: CFRU launches all 13 spark waves first and starts the target pillar 9 GBA f after the last
    # one; the old 8 waves (f21..35) ran 2 frames past the pillar's start (f33). Now 7 waves end at f33, pillar f35.
    t_target = 35                                       # CFRU f161: the target pillar, while the last sparks fly
    starfall_opening(a, star_end=t_target + 7)          # CFRU keeps the stars 46 f into the target pillar
    smite_sparks(a, STARFALL_TIMES["middle"], waves=7, gap=2)
    starfall_finish(a, t_target, beam_frame=1, tone=blend_tone(SMITE_TARGET), life=L - 9 - t_target)

    a.note("SPARK: the vanilla particle is not in the download; GEN8- Thundercage frames 2-3 (thin vertical "
           "lightning lines, CFRU's SPARK is an 8x32 line at 2x) tinted 0.94 toward 0x7FAF, additive")
    a.note("YELLOW_STAR: PRAS- Meteor Mash frame 2 at scale 4 (see Max Starfall)")
    a.note("Spark lines: CFRU launches 13 waves 4 GBA f apart (39 sprites); ours 7 waves 2 frames apart (21), "
           "at most 9 alive at once; the target pillar starts 2 frames after the last wave (CFRU 9 GBA f)")
