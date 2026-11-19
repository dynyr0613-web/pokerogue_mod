# Local fork (2026-11-19): Max Lightning, rebuilt from CFRU ANIM_MAX_LIGHTNING (Complete FireRed Upgrade, Skeli and
# the CFRU team; extract/ANIM_MAX_LIGHTNING.txt). The body is shared with G-Max Stun Shock: specs/_fam_lightning.py.
# CFRU beats (302 GBA f) -> ours (61 frames):
#   f0    battle BG fades out, BG_MAX_LIGHTNING fades in (32 f) and scrolls left 1 px/f to the end
#                                                                  -> f0..4 arena -> PRAS- Thunder BG (stand-in),
#                                                                     scrolling left 4 field px a frame
#   f32   Dynamax flex (72 f); 4 spark bursts round the attacker 12 f apart (3 sparks each, SE_M_THUNDERBOLT2);
#         the attacker flashes yellow 8/16 four times              -> flex f4..18, bursts f4/7/10/13 (4 frames each),
#                                                                     pulses f5..17
#   f104  lightning column strikes the target (3 UNUSED_LIGHTNING pieces, SE_M_TRI_ATTACK2)
#                                                                  -> f19..27 (one Thundercage bolt, Spark2)
#   f111  target shakes vertically until f269                      -> f21..52
#   f111  BG + all battlers flash 16/16 yellow, f116 back, f121 yellow, f126 back
#                                                                  -> f21..22 and f25..26: PRAS- Electric Terrain BG
#                                                                     (golden) cut in, both battlers toned yellow
#   f126  target blends to yellow 0x17BF (one step / 2 f)          -> f27..35 ramp, held to f53
#   f126  spark pillar 1 (rings at y 0/-22/-44/-66, 44 f, SE_M_TRI_ATTACK2)
#                                                                  -> f27 (rings 1 frame apart, 7 frames each)
#   f164  bolt at target x+20 (LIGHTNING x3); f166 pillar 2         -> f34 bolt, f35 pillar
#   f204  bolt at target x-20 (SE_M_THUNDER_WAVE); f206 pillar 3   -> f42 bolt, f43 pillar (ends f52)
#   f269  yellow fades back; UnsetPsychicBackground (33 f)         -> f53..60 tone and storm BG fade together
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403
from _fam_lightning import lightning_body, STORM_BG, FLASH_BG  # noqa: E402

MOVE_ID = "MAX_LIGHTNING"


def build(a):
    lightning_body(a, "CFRU- Max Lightning", tint=None)
    a.note(f"BG: CFRU's BG_MAX_LIGHTNING is not in the download; '{STORM_BG}' (storm clouds, tiles on x) stands in "
           f"and scrolls left like CFRU's (not mirrored for an enemy user: one file plays both sides)")
    a.note(f"Flashes: CFRU blends BG + all battlers 16/16 to 0x17BF (a flat yellow screen); ours cuts to "
           f"'{FLASH_BG}' for 2 frames and tones both battlers 0.9 toward the yellow so they stay readable")
    a.note("Pillars: 13 sparks each (one centre spark per ring instead of CFRU's three radius-5 sparks), turning "
           "60 degrees a frame (CFRU's 40/256 per GBA frame strobes at 20 fps); the top rings clip above the "
           "target on the player side, as in CFRU")
    a.note("Sparks round the attacker: 4 bursts as in CFRU, SE_M_THUNDERBOLT2 on bursts 1 and 3 only (a 1.6 s "
           "crackle each)")
