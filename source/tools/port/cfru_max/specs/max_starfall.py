# Local fork (2026-11-19): Max Starfall, rebuilt from CFRU ANIM_MAX_STARFALL (Complete FireRed Upgrade, Skeli and the
# CFRU team; extract/ANIM_MAX_STARFALL.txt). Body shared with G-Max Smite: specs/_fam_starfall.py.
# CFRU beats (424 GBA f) -> ours (61 frames):
#   f0    BG darkens 14/16 (29 f); Dynamax flex (72 f)             -> f0..7 dark, flex f0..14
#   f32   3 twinkles at the top of the screen above target x+30, x-30, x+3 (LEER, SE_M_DETECT)
#                                                                  -> f6..10, the 5-step leer glint (target-relative
#                                                                     y -40: the screen top for the enemy target,
#                                                                     above the player's head when an enemy uses it)
#   f72   (flex over) 3 big yellow stars drop 64 px with acceleration onto target (+30,+20) (-30,+20) (+3,+16) and
#         stay 119 f (SE_FALL)                                     -> f15..18 fall (ease in), rest f19..35, shrink
#                                                                     away f35..37
#   f104  SE_M_MEGA_KICK x3 (13 f apart); a light pillar rises from each star: 7 Straight_Beam segments (frame 0,
#         lilac-pink edges) from y+19 to y-77, one per frame, widening 2x after 6 f, flickering, 105 f
#                                                                  -> f21..37: built bottom-up f21..23, wide f24,
#                                                                     flicker, narrow away f35..37; kicks f21/25/29
#   f199  target blends to pink 0x7A5B (one step / 7 f), shakes horizontally (4 px x 96), a pillar rises on the
#         target itself (180 f), SE_M_SOLAR_BEAM                   -> f34..51 pillar, pink peaks f44 and holds,
#                                                                     shake f34..51
#   f391  pink and darkening fade back (2 f steps)                 -> f52..59 tone, f52..60 dark stage
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403
from _fam_starfall import STARFALL_TIMES, starfall_opening, side_pillars, starfall_finish  # noqa: E402

MOVE_ID = "MAX_STARFALL"


def build(a):
    L = 61
    begin(a, "CFRU- Max Starfall", L)
    dark_stage(a, 0, L - 1, fade_in=8, fade_out=8)
    t_target = 34                                       # CFRU f199: the target pillar
    starfall_opening(a, star_end=t_target + 4)          # stars gone 2 frames after the target pillar starts (f207)
    side_pillars(a, STARFALL_TIMES["middle"], life=17, beam_frame=0)
    starfall_finish(a, t_target, beam_frame=0, type_="fairy", life=L - 9 - t_target)

    a.note("YELLOW_STAR: CFRU's vanilla star is not in the download; PRAS- Meteor Mash frame 2 (an upright 5-point "
           "yellow star) at scale 4, zoom 68 (about 44 px) stands in for the 2x star (SUBS names the skewed PRAS- Swift star)")
    a.note("STARFALL_BEAM: the 7 stacked 16x16 segments are one Straight_Beam strip stretched vertically (one "
           "segment taller, so the top also leaves the screen above the player-side target), grown bottom-up over 3 "
           "frames, widened 1x -> 2x and flickering like CFRU's affine anim; the side pillars are additive light so "
           "the target shows through CFRU's wall of three pillars")
    a.note("Timing: CFRU's 105 f side pillars and 180 f target pillar become 17 and 18 frames; the pink blend "
           "peaks 10 frames into the target pillar and holds until the dark stage fades back, as in CFRU")
