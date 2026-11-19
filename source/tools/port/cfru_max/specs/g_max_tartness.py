# Local fork (2026-11-19): G-Max Tartness, rebuilt from CFRU ANIM_G_MAX_TARTNESS (Complete FireRed Upgrade, Skeli and
# the CFRU team; extract/ANIM_G_MAX_TARTNESS.txt). CFRU builds it as Max Overgrowth with giant golden apples instead
# of the mushrooms and apples instead of the cotton spores in the leaf geysers: the shared body is
# specs/_fam_overgrowth.py (its header maps every CFRU beat to our frames).
# CFRU beats (317 GBA f) -> ours (64 frames):
#   f0    BG darkens, flex, 4 seeds pop up from the attacker and fly off the top   -> f0..14, seeds f1..8
#   f72   4 big seeds drop onto the target's feet with thuds                       -> f15..26
#   f152  4 giant golden apples grow around the target (one behind it)             -> f28..39
#   f180  target shakes and turns light green; 3 leaf + apple geysers              -> f34, f39, f44
#   f284  green and darkness fade back                                             -> f55..63
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _fam_overgrowth import *  # noqa: E401,E702,F403

MOVE_ID = "G_MAX_TARTNESS"


def build(a):
    build_overgrowth(a, "CFRU- G-Max Tartness", 64, sprout_tag="GOLDEN_APPLE", sprout_zoom=125, geyser_kind="apple",
                     label="G-Max Tartness")
