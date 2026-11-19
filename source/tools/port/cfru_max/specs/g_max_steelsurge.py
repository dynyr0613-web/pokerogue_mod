# Local fork (2026-11-19, reviewed 2026-11-19): G-Max Steelsurge, rebuilt from CFRU ANIM_G_MAX_STEELSURGE (Complete
# FireRed Upgrade, Skeli and the CFRU team; extract/ANIM_G_MAX_STEELSURGE.txt): CFRU blends the LARGE_SPIKE palette
# 7/16 toward 0x46A0 (greenish) and jumps into ANIM_MAX_STEELSPIKE_BEGIN, so this is the Max Steelspike body
# (specs/_fam_steelspike.py, which holds the beat table) with greenish spikes.
# CFRU beats (226 GBA f) -> ours (48 frames):
#   f0    spikes blended 7/16 toward 0x46A0; BG darkens; Dynamax flex -> exact GBA blend baked into the sheet;
#                                                                     f0..8 dark, flex f0..14
#   f72   greenish spikes burst from the ground along the path (16)  -> f13..24 (12 spikes, one a frame)
#   ~f107 two big curved spikes (+-45 deg) at target x+-5, 50 f      -> f24..37, crossed through the target
#   f157  SE_M_MEGA_KICK2, target shakes horizontally (40 f)         -> f30..41 (+ a soft mint sheen: CFRU has no tone)
#   f197  BG back to normal                                         -> f39..47
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403
from _fam_steelspike import steelspike_body, GREENISH_BLEND, GREENISH_TONE  # noqa: E402

MOVE_ID = "G_MAX_STEELSURGE"


def build(a):
    steelspike_body(a, "CFRU- G-Max Steelsurge", spike_blend=GREENISH_BLEND, tone=GREENISH_TONE,
                    glint_tint=(200, 255, 230, 0.85))
    a.note("Colour: the spikes use CFRU's exact palette blend (7/16 toward 0x46A0); the target tone is a mint sheen "
           "(0x46A0 lightened halfway to white) so warm targets brighten instead of going olive")
