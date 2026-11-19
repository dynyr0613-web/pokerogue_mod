# Local fork (2026-11-19): G-Max Cannonade, rebuilt from CFRU ANIM_G_MAX_CANNONADE_MOVE (Complete FireRed Upgrade,
# Skeli and the CFRU team; extract/ANIM_G_MAX_CANNONADE_MOVE.txt). CFRU builds it on the Max Geyser structure with the
# stream replaced by cannon volleys; the body is the Max Geyser family (specs/_fam_geyser.py, cannon=True).
# CFRU beats (295 GBA f) -> ours (59 frames):
#   f0    BG darkens 14/16; Dynamax flex                            -> f0..8 dark stage, flex f0..14
#   f5    8 LARGE_BUBBLES on the attacker, SE_M_CRABHAMMER each     -> f1..10 bubble pairs, SE f1 and f7
#   f88   SE_M_HYDRO_PUMP; BG shake (~160 f)                        -> f15 SE; no BG shake (see notes)
#   f88   8 volleys 6 f apart: 3 hydro-pump balls from the G-Max Blastoise cannon positions, 2 f apart, arcing to the
#         target in 14 f (player fan up / up / down, opponent fan down / up / down)
#                                                                   -> f15..29 every 2 frames, shots +0 / +0 / +1,
#                                                                      6 frames each, a small muzzle splash at each
#                                                                      cannon (ours); first balls land f20
#   f94   target shakes vertically (86 toggles, to f266); 7 small bubbles burst off it after every volley
#                                                                   -> shake f20..50 (+ soft blue tone), 3 bubbles
#                                                                      as each volley lands f20..34
#   f124  one GEYSER_BUBBLE_SHOT                                    -> f27
#   f136  big water orb (15 + 48 + 15 f) + 9 bubble bursts with SE_M_SELF_DESTRUCT / SE_M_CRABHAMMER
#                                                                   -> orb f33..55, 6 bursts f34..44
#   f266  shake ends, BG brightens over 29 f                        -> f50..58 dark stage and tone fade together
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _fam_geyser import *  # noqa: E401,E702,F403

MOVE_ID = "G_MAX_CANNONADE"


def build(a):
    build_geyser(a, "CFRU- G-Max Cannonade", L=59, cannon=True)
    a.note("Cannons: CFRU has separate player / opponent muzzle positions tuned to the DPE G-Max Blastoise sprite "
           "(an AnimTask_IsTargetPlayerSide branch). One file plays for both sides here and USER_TARGET offsets flip "
           "x and y for an enemy user, so the three muzzles sit near the focus height, spread behind / in front "
           "(inside the body on both sides), and the arc heights 21 / 14 / -12 become CFRU's opponent-style fan "
           "when mirrored")
    a.note("Ours: a 2-frame 'PRAS- Water' splash at each muzzle as a ball leaves, so the cannons read (CFRU none)")
    a.note("CFRU: no target blend; a 0.5 water-blue tone was added. The BG shake is left out (black dark stage)")
    a.note("Target bubbles: 3 of CFRU's 7 per volley, orb bursts 6 of 9 with 5 of 7 bubbles (graphics budget)")
