# Local fork (2026-11-19): G-Max Replenish, rebuilt from CFRU ANIM_G_MAX_REPLENISH (Complete FireRed Upgrade, Skeli
# and the CFRU team; extract/ANIM_G_MAX_REPLENISH.txt): Max Strike whose columns are EXPLOSION_BERRY_GEYSER (15 puffs
# + 16 BERRY_NORMAL particles each, gAnimCmdBerryChomp). Body and beat table: specs/_fam_strike.py.
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _fam_strike import *  # noqa: E401,E702,F403

MOVE_ID = "G_MAX_REPLENISH"


def build(a):
    # CFRU's own Berry_Normal.png (whole berry, bitten berry): whole for 3 frames, then the chomp, once per riser
    # (7 cells for the 7-frame riser life, so the loop never shows the whole berry again)
    berry = riser(a, "berry", zoom=50, frames=[0, 0, 0, 1, 1, 1, 1])
    strike_body(a, "CFRU- G-Max Replenish", kind=berry)
    a.note("BERRY_NORMAL: CFRU's own brown berry (Berry_Normal.png) at zoom 50, about GBA size (zoom 60 = x 1.3 "
           "crowded the column); the chomp anim plays once per riser (whole 3 frames, then bitten) instead of "
           "flickering every frame")
