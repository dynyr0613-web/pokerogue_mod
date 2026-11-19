# Local fork (2026-11-19): G-Max Resonance, rebuilt from CFRU ANIM_G_MAX_RESONANCE (Complete FireRed Upgrade, Skeli
# and the CFRU team; extract/ANIM_G_MAX_RESONANCE.txt): Max Hailstorm's ice rocks on a scrolling Aurora Beam BG, no
# hail. Body shared with Max Hailstorm: specs/_fam_hailstorm.py.
# CFRU beats (226 GBA f) -> ours (54 frames):
#   f0    BG darkens 14/16 (29 f); Dynamax flex (72 f)               -> f0..6 dark, flex f0..14
#   f42   battle BG fades out, BG_AURORA_BEAM fades in (to f74), scrolling 4 px/f sideways until the end
#                                                                    -> f8..10 black to full, f11 cut to
#                                                                       PRAS- Aurora BG (the game's Aurora Beam BG),
#                                                                       scrolled 16 field px a frame (= CFRU's speed)
#   f74   giant ice rock 1 (2x) onto target x-40, SE_FALL x2          -> launch f15, lands f21 (thud), shatter f21..25
#   f106  rock 2 (2x) at x+30                                        -> launch f23, lands f29 (thud), shatter f29..33
#   f138  rock 3 (2.5x) at the centre                                -> launch f31, lands f37, shatter f37..41
#   f145  all battlers shake horizontally, SE_M_STRENGTH, target slid 21 px down
#                                                                    -> f33, shake f33..45, push f33..35
#   f193  target slides back (16 f); UnsetPsychicBackground restores the BG (to f225)
#                                                                    -> slide f45..50, aurora fades out f45..53
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _fam_hailstorm import *  # noqa: E401,E702,F403

MOVE_ID = "G_MAX_RESONANCE"
ROCK_TINT = (120, 170, 255, 0.4)


def build(a):
    hailstorm_body(a, "CFRU- G-Max Resonance", scene="PRAS- Aurora BG", scroll=(-16, 0), with_hail=False,
                   rock_tint=ROCK_TINT)
    a.note("Rocks: tinted slightly toward blue (ROCK_TINT): CFRU's white-cyan ICE_ROCK palette all but vanishes on "
           "the pale green / white curtains of PRAS- Aurora BG")
    a.note("BG: CFRU fades the dark stage out and BG_AURORA_BEAM in; ours goes black under the flex peak and cuts "
           "to PRAS- Aurora BG at f11 (one background at a time: fading it in from 0 would show the arena). "
           "It scrolls left 16 field px a frame (CFRU: BG offset +4 px/f, i.e. the picture moves left)")
