# Local fork (2026-11-19): G-Max Gravitas, rebuilt from CFRU ANIM_G_MAX_GRAVITAS (Complete FireRed Upgrade, Skeli and the
# CFRU team; extract/ANIM_G_MAX_GRAVITAS.txt): Max Mindstorm with the rings recoloured purple 0x5413 + sky blue 0x7FEE.
# CFRU's prelude only re-tints the ring palettes and jumps to MAX_MINDSTORM_BEGIN, so the target flashes and blend stay
# Mindstorm's pinkish purple 0x7D3D. The body is shared: specs/_fam_mindstorm.py (its header maps every CFRU beat).
# CFRU beats (275 GBA f) -> ours (60 frames):
#   f0    dark stage, flex, spinning Aura Sphere shot off the top of the screen, SE_WARP_IN
#                                                          -> f0..14 (sphere f0..9)
#   f72   24 rings (sky blue 0x7FEE 10/16 on the pink-petal palette + purple 0x5413 12/16) rain onto the target,
#         SE_M_PSYBEAM2 x10                               -> f11..30 (10 rings, sky blue / purple pairs)
#   f80   target sways and flashes pinkish purple             -> f13..26
#   f130  shake, blend 0x7D3D, 3 needle geysers 14 f apart    -> f26 / f31 / f36, tone held to f51
#   f242  colour and darkness fade back                       -> f51..59
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _fam_mindstorm import *  # noqa: E401,E702,F403

MOVE_ID = "G_MAX_GRAVITAS"


def build(a):
    mindstorm_body(a, "CFRU- G-Max Gravitas", RING_SKY, RING_PURPLE, label="G-Max Gravitas")
    a.note("G-Max Gravitas: the target keeps Mindstorm's pinkish-purple flashes and blend (0x7D3D), as in CFRU, "
           "where only the ring palettes change")
