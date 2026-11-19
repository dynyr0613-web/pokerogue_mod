# Local fork (2026-11-19): G-Max Snooze, rebuilt from CFRU ANIM_G_MAX_SNOOZE (Complete FireRed Upgrade, Skeli and the
# CFRU team; extract/ANIM_G_MAX_SNOOZE.txt). CFRU builds it as Max Darkness with light-blue holes (SHADOW_BALL drawn
# with the ICE_CHUNK palette), only purple orbs (pink-orb tint 12/16) and a longer target shake (72 toggles): the
# shared body is specs/_fam_darkness.py (its header maps every CFRU beat to our frames).
# CFRU beats (261 GBA f) -> ours (66 frames):
#   f0    flex, SE_M_THUNDERBOLT2 x5 (ours Spark2 x3), two light-blue holes spin on the attacker
#                                                                                  -> f0..14, holes f0..38
#   f72   BG darkens; 17 launches of 2 purple orbs on sine waves                 -> f13 dark, f15..31
#   f84   target shakes (72 toggles, 20 f longer than Darkness)                  -> f21..56
#   f106  target turns deep purple, big purple orb, 2 x 5 dark red puffs         -> f32..52 (puffs f32..41)
#   f228  BG and colour fade back                                                -> f57..65
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _fam_darkness import *  # noqa: E401,E702,F403

MOVE_ID = "G_MAX_SNOOZE"


def build(a):
    L = 66
    build_darkness(a, "CFRU- G-Max Snooze", L, hole_tint=HOLE_SNOOZE, orb_tints=[PURPLE_ORB_SNOOZE],
                   fade_at=L - 9, label="G-Max Snooze")
