# Local fork (2026-11-19): G-Max Cuddle, rebuilt from CFRU ANIM_G_MAX_CUDDLE (Complete FireRed Upgrade, Skeli and the
# CFRU team; extract/ANIM_G_MAX_CUDDLE.txt): Max Strike whose columns are EXPLOSION_HEART_GEYSER (15 puffs + 16
# RED_HEART particles each). Body and beat table: specs/_fam_strike.py.
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _fam_strike import *  # noqa: E401,E702,F403

MOVE_ID = "G_MAX_CUDDLE"

# The SUBS tint (235, 40, 70) at 0.55 leaves the pink Attract heart a pink-red; CFRU's RED_HEART is a plain red heart.
# 0.8 keeps the heart's shading and reads red over the orange puffs (Cuddle is the only user of RED_HEART).
HEART_TINT = (235, 25, 40, 0.8)


def build(a):
    heart = riser(a, "heart", zoom=110, tint=HEART_TINT)
    strike_body(a, "CFRU- G-Max Cuddle", kind=heart)
    a.note("RED_HEART: the vanilla heart is not in the CFRU download; the Attract heart (PRAS- Love frame 5) tinted "
           "0.8 toward red (stronger than the SUBS 0.55, which stays pink) at zoom 110")
