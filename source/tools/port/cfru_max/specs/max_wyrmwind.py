# Local fork (2026-11-19): Max Wyrmwind, rebuilt from CFRU ANIM_MAX_WYRMWIND (Complete FireRed Upgrade, Skeli and the
# CFRU team; extract/ANIM_MAX_WYRMWIND.txt). The body is shared with G-Max Depletion: specs/_fam_wyrmwind.py (its
# header maps every CFRU beat to our frames).
# CFRU beats (265 GBA f) -> ours (57 frames):
#   f0    tornado + gust tinted 8/16 toward pink 0x5818; flex; SE_M_DOUBLE_TEAM x4; tornado grows on the attacker
#                                                          -> f0..14
#   f72   tornado glides to the target (16 f); SE_M_STRING_SHOT   -> f15..19
#   f88   dark stage (14 f), SE_M_TWISTER, target shakes      -> f20..24 dark, shake f20..48
#   f98   target blends to pink 0x5818 (1 step / 6 f); 6 gust swirls circle the target 10 f apart
#                                                          -> tone f20..34 held; gusts f23..33, 14 frames each
#   f230  tornado vanishes; f232 pink and darkness fade back  -> tornado out f41..44; fade f48..56
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _fam_wyrmwind import *  # noqa: E401,E702,F403
from _common import gba_rgb, tone_for

MOVE_ID = "MAX_WYRMWIND"
PINK = gba_rgb(0x5818)   # CFRU's tornado, gust and target blend colour (#C500B4)


def build(a):
    wyrmwind_body(a, "CFRU- Max Wyrmwind", tornado_rgb=PINK, tornado_k=0.5, gust_rgb=PINK, gust_k=0.5,
                  tone=tone_for("dragon"), label="Max Wyrmwind")
