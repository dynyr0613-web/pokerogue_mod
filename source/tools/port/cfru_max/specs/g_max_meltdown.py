# Local fork (2026-11-19, reviewed 2026-11-19): G-Max Meltdown, rebuilt from CFRU ANIM_G_MAX_MELTDOWN (Complete FireRed
# Upgrade, Skeli and the CFRU team; extract/ANIM_G_MAX_MELTDOWN.txt): CFRU blends the LARGE_SPIKE palette 7/16 toward
# 0x121C (gold-orange) and jumps into ANIM_MAX_STEELSPIKE, so this is the Max Steelspike body (specs/_fam_steelspike.py,
# which holds the beat table) with gold-orange spikes.
# CFRU beats (226 GBA f) -> ours (48 frames):
#   f0    spikes blended 7/16 toward 0x121C; BG darkens; Dynamax flex -> exact GBA blend baked into the sheet (copper-
#                                                                     gold); f0..8 dark, flex f0..14
#   f72   gold spikes burst from the ground along the path (16)      -> f13..24 (12 spikes, one a frame)
#   ~f107 two big curved spikes (+-45 deg) at target x+-5, 50 f      -> f24..37, crossed through the target
#   f157  SE_M_MEGA_KICK2, target shakes horizontally (40 f)         -> f30..41 (+ a warm gold sheen: CFRU has no tone)
#   f197  BG back to normal                                         -> f39..47
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403
from _fam_steelspike import steelspike_body, GOLD_BLEND, GOLD_TONE  # noqa: E402

MOVE_ID = "G_MAX_MELTDOWN"


def build(a):
    steelspike_body(a, "CFRU- G-Max Meltdown", spike_blend=GOLD_BLEND, tone=GOLD_TONE,
                    glint_tint=(255, 235, 170, 0.85))
    a.note("Colour: the spikes use CFRU's exact palette blend (7/16 toward 0x121C: copper-gold body, peach edges; the "
           "house tint kept the black body dark brown, which read as wood even at 10/16); the target tone is a warm "
           "gold sheen (0x121C lightened 30% toward white)")
