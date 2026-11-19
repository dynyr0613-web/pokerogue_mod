# Local fork (2026-11-19): Max Darkness, rebuilt from CFRU ANIM_MAX_DARKNESS (Complete FireRed Upgrade, Skeli and the
# CFRU team; extract/ANIM_MAX_DARKNESS.txt). The body is shared with G-Max Snooze: specs/_fam_darkness.py (its header
# maps every CFRU beat to our frames).
# CFRU beats (241 GBA f) -> ours (63 frames):
#   f0    flex, SE_M_THUNDERBOLT2 x5 (ours Spark2 x3), two red-rimmed black holes spin on the attacker
#                                                                                  -> f0..14, holes f0..38
#   f72   BG darkens; 17 launches of 2 orbs, alternating reddish pink / purple, on sine waves -> f13 dark, f15..31
#   f84   target shakes (62 toggles)                                                   -> f21..53
#   f106  target turns deep purple, big purple orb, 2 x 5 dark red puffs               -> f32..52 (puffs f32..41)
#   f208  BG and colour fade back                                                      -> f54..62
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _fam_darkness import *  # noqa: E401,E702,F403

MOVE_ID = "MAX_DARKNESS"


def build(a):
    L = 63
    build_darkness(a, "CFRU- Max Darkness", L, hole_tint=HOLE_DARKNESS, orb_tints=[PINK_ORB, PURPLE_ORB],
                   fade_at=L - 9, label="Max Darkness")
