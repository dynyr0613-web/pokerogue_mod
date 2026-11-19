# Local fork (2026-11-19): Max Hailstorm, rebuilt from CFRU ANIM_MAX_HAILSTORM (Complete FireRed Upgrade, Skeli and
# the CFRU team; extract/ANIM_MAX_HAILSTORM.txt). Body shared with G-Max Resonance: specs/_fam_hailstorm.py.
# CFRU beats (220 GBA f) -> ours (54 frames):
#   f0    BG darkens 14/16 (29 f); Dynamax flex (72 f)               -> f0..8 dark, flex f0..14
#   f72   target side to the BG layer; vanilla Hail task: 30 hailstones fall diagonally (4 right, 8 down per f)
#         onto 10 points around the target until ~f172, full-size ones leave an ICE_CRYSTALS impact; SE_FALL
#                                                                    -> f15..41: 22 hailstones (PRAS- Ice 17
#                                                                       tinted white), 5 frames in the air, landing
#                                                                       f20..41, every 2nd with the crystal burst
#                                                                       (PRAS- Ice 8-11)
#   f72   giant ice rock 1 (ICE_ROCK 2x) falls 60 px at 3 px/f onto target x-40, shatters (5 frames x 3 f); SE_FALL
#                                                                    -> launch f15, lands f21 (thud), shatter f21..25
#   f104  rock 2 (2x) at x+30, SE_FALL (SE_M_STRENGTH thuds 15 f after each launch)
#                                                                    -> launch f23, lands f29 (thud), shatter f29..33
#   f136  rock 3 (2.5x) at the centre                                -> launch f31, lands f37, shatter f37..41
#   f143  all battlers shake horizontally (4 px decaying), SE_M_STRENGTH, target slid 21 px down in 4 f
#                                                                    -> f33 (the big rock's lower edge reaches the
#                                                                       target centre), shake f33..45, push f33..35
#   f191  target slides back (16 f); BG brightens (29 f)             -> slide f45..50, dark stage out f45..53
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _fam_hailstorm import *  # noqa: E401,E702,F403

MOVE_ID = "MAX_HAILSTORM"


def build(a):
    hailstorm_body(a, "CFRU- Max Hailstorm", scene=None, with_hail=True)
    a.note("Hail: CFRU's vanilla task drops 30 hailstones over ~100 GBA f; ours drops 22, landing f20..41 (the "
           "vanilla HAIL particle is not in the download: SUBS 'HAIL' = PRAS- Ice 17, tinted toward white and "
           "cropped so the stone sits at the top of its cell; see _fam_hailstorm.HAIL_BOX)")
