# Local fork (2026-11-19): Max Geyser, rebuilt from CFRU ANIM_MAX_GEYSER (Complete FireRed Upgrade, Skeli and the
# CFRU team; extract/ANIM_MAX_GEYSER.txt). The body is specs/_fam_geyser.py (shared with G-Max Foam Burst and
# G-Max Cannonade).
# CFRU beats (333 GBA f) -> ours (61 frames):
#   f0    BG darkens 14/16 (29 f); Dynamax flex (72 f)             -> f0..8 dark stage, flex f0..14
#   f5    8 LARGE_BUBBLES on the attacker 4 f apart, each wobbling up for 25 f, SE_M_CRABHAMMER with each
#                                                                  -> f1..10 (bubble pairs riding the flex, 8 frames
#                                                                     each), SE at f1 and f7
#   f72   target side to the BG layer                              -> (nothing to do)
#   f88   SE_M_HYDRO_PUMP; BG shakes horizontally for ~160 f       -> f15 SE; no BG shake (see notes)
#   f88   the stream: 18 pairs of hydro-pump balls every 4 f (25 f flight, growing to 2x) + a bubble shot every 12 f
#                                                                  -> f15..34 one ball a frame (8 frames each, first
#                                                                     lands f22), bubble shots f15, 19, ... 35
#   f100  target shakes vertically (102 toggles, to f304); 7 small bubbles burst off it after every pair (to f160)
#                                                                  -> shake f22..52 (+ soft blue tone), 4 bubbles every
#                                                                     2 frames f22..34
#   f124  SE_M_HYDRO_PUMP again                                    -> f27
#   f160  big water orb on the target (15 + 48 + 15 f); 9 bubble bursts 5 f apart, SE_M_SELF_DESTRUCT +
#         SE_M_CRABHAMMER each                                     -> orb f36..58 (5 + 13 + 5), 6 bursts f37..47,
#                                                                     explosion SE f36, 40, 44, crabhammer f39
#   f304  shake ends, BG brightens over 29 f                       -> f52..60 dark stage and tone fade together
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _fam_geyser import *  # noqa: E401,E702,F403

MOVE_ID = "MAX_GEYSER"


def build(a):
    build_geyser(a, "CFRU- Max Geyser", L=61)
    a.note("CFRU: no target blend in Max Geyser; a 0.5 water-blue tone was added so the hit reads at game scale")
    a.note("CFRU shakes the (darkened) battle BG horizontally during the stream (AnimTask_screen_shake 5 1 67); the "
           "dark stage is a black AddBg, so there is nothing to shake: left out")
    a.note("Stream: CFRU launches 36 balls in pairs (2 f apart, every 4 f); ours one a frame for 20 frames with a few "
           "px of spread; target bubbles: 4 of CFRU's 7 per burst, explosion bursts: 6 of 9 with 5 of 7 bubbles "
           "(graphics budget)")
