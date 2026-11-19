# Local fork (2026-11-19): Max Steelspike, rebuilt from CFRU ANIM_MAX_STEELSPIKE (Complete FireRed Upgrade, Skeli and
# the CFRU team; extract/ANIM_MAX_STEELSPIKE.txt). The body is shared with G-Max Steelsurge / Meltdown
# (specs/_fam_steelspike.py, which holds the beat table); this one keeps CFRU's own LARGE_SPIKE palette (black steel
# with white edges).
# CFRU beats (226 GBA f) -> ours (48 frames):
#   f0    BG darkens 14/16; Dynamax flex                            -> f0..8 dark, flex f0..14
#   f72   steel spikes burst from the ground along the path (16)     -> f13..24 (12 spikes, one a frame)
#   ~f107 two big curved spikes (+-45 deg) at target x+-5, 50 f      -> f24..37, crossed through the target
#   f157  SE_M_MEGA_KICK2, target shakes horizontally (40 f)         -> f30..41 (+ a soft silver tone: CFRU has none)
#   f197  BG back to normal                                         -> f39..47
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403
from _fam_steelspike import steelspike_body  # noqa: E402

MOVE_ID = "MAX_STEELSPIKE"


def build(a):
    steelspike_body(a, "CFRU- Max Steelspike", spike_blend=None, tone=tone_for("steel", 0.5))
