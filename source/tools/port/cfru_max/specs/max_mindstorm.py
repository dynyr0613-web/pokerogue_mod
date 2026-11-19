# Local fork (2026-11-19): Max Mindstorm, rebuilt from CFRU ANIM_MAX_MINDSTORM (Complete FireRed Upgrade, Skeli and the
# CFRU team; extract/ANIM_MAX_MINDSTORM.txt). The body is shared with G-Max Gravitas: specs/_fam_mindstorm.py (its
# header maps every CFRU beat to our frames).
# CFRU beats (275 GBA f) -> ours (60 frames):
#   f0    dark stage, flex, spinning Aura Sphere shot off the top of the screen, SE_WARP_IN
#                                                          -> f0..14 (sphere f0..9)
#   f72   24 rings (pink 0x7D3D 7/16 + purple 0x5413 12/16) rain onto the target, SE_M_PSYBEAM2 x10
#                                                          -> f11..30 (10 rings, pink / purple pairs)
#   f80   target sways and flashes pinkish purple             -> f13..26
#   f130  shake, blend 0x7D3D, 3 needle geysers 14 f apart    -> f26 / f31 / f36, tone held to f51
#   f242  colour and darkness fade back                       -> f51..59
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _fam_mindstorm import *  # noqa: E401,E702,F403

MOVE_ID = "MAX_MINDSTORM"


def build(a):
    mindstorm_body(a, "CFRU- Max Mindstorm", RING_PINK, RING_PURPLE, label="Max Mindstorm")
