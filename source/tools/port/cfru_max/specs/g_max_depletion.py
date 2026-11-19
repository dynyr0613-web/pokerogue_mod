# Local fork (2026-11-19): G-Max Depletion, rebuilt from CFRU ANIM_G_MAX_DEPLETION (Complete FireRed Upgrade, Skeli and
# the CFRU team; extract/ANIM_G_MAX_DEPLETION.txt): Max Wyrmwind recoloured red. The body is shared with Max Wyrmwind:
# specs/_fam_wyrmwind.py (its header maps every CFRU beat to our frames).
# CFRU beats (265 GBA f) -> ours (57 frames):
#   f0    tornado tinted 10/16 toward 0x001D, gust 8/16 toward 0x001F; flex; SE_M_DOUBLE_TEAM x4; tornado grows on
#         the attacker                                    -> f0..14
#   f72   tornado glides to the target (16 f); SE_M_STRING_SHOT   -> f15..19
#   f88   dark stage (14 f), SE_M_TWISTER, target shakes      -> f20..24 dark, shake f20..48
#   f98   target blends to red 0x001D (1 step / 6 f); 6 gust swirls circle the target 10 f apart
#                                                          -> tone f20..34 held; gusts f23..33, 14 frames each
#   f230  tornado vanishes; f232 red and darkness fade back   -> tornado out f41..44; fade f48..56
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _fam_wyrmwind import *  # noqa: E401,E702,F403
from _common import gba_rgb, blend_tone, EXTRA_COLORS

MOVE_ID = "G_MAX_DEPLETION"
TORNADO_RED = EXTRA_COLORS["red"]   # 0x001D (#EE0000): tornado 10/16 and the target blend
GUST_RED = gba_rgb(0x001F)          # 0x001F (#FF0000): gusts 8/16


def build(a):
    wyrmwind_body(a, "CFRU- G-Max Depletion", tornado_rgb=TORNADO_RED, tornado_k=0.62, gust_rgb=GUST_RED,
                  gust_k=0.5, tone=blend_tone(TORNADO_RED), label="G-Max Depletion")
