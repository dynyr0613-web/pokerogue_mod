# Local fork (2026-11-19): Max Phantasm, rebuilt from CFRU ANIM_MAX_PHANTASM (Complete FireRed Upgrade, Skeli and
# the CFRU team; extract/ANIM_MAX_PHANTASM.txt). The body is shared with G-Max Terror: specs/_fam_phantasm.py.
# CFRU beats (269 GBA f) -> ours (61 frames):
#   f0    rock / hand / log / anchor / shell palettes tinted 10/16 toward 0x7CBF (pink); BG darkens 14/16 (29 f);
#         Dynamax flex (72 f); SE_M_NIGHTMARE                      -> cells baked pink; f0..8 dark, flex f0..14
#   f0    the 5 objects grow from 1/16 round the attacker (30 f) and hover
#                                                                  -> f0..8 grow, hover to f15
#   f72   flex ends: they arc (amplitude 40) to spots round the target in 32 f (SE_M_SAND_ATTACK)
#                                                                  -> f15..22 (low arcs, see the family module)
#   f104  wait 16 f (SE_M_STRENGTH), slam into the target centre at 8 px/f
#                                                                  -> f22 thud, f22..25 wait, f26 slam, gone at f27
#   f132  target shakes vertically (to f236) and blends to royal blue 0x5C05 (one step / 4 f)
#                                                                  -> shake f27..51, blue peaks f35
#   f132  3 NEN geysers 14 f apart (royal-blue puffs + VERTICAL_HEX risers)
#                                                                  -> f27, f32, f37 (done by f48)
#   f236  blue and darkening fade back (2 f steps)                 -> f52..59 tone, f52..60 dark stage
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403
from _fam_phantasm import phantasm_body  # noqa: E402

MOVE_ID = "MAX_PHANTASM"


def build(a):
    L = 61
    fade = L - 9   # f52: CFRU f236, the blue and the dark stage start fading back together
    phantasm_body(a, "CFRU- Max Phantasm", L, tone_fade=fade, bg_fade_out=8)
    a.note("Objects: USER_TARGET sprites (they fly to the target); CFRU's start cluster is moved onto the user's "
           "focus point so it surrounds the attacker on either side (for an enemy user the five swap places), and "
           "the amplitude-40 arcs are 8-20 px (they bulge down for an enemy user)")
    a.note("SE_M_SAND_ATTACK (played by CFRU's SpriteCB_MaxPhantasmObject) is not in _common.SE: "
           "'PRSFX- Sand Attack.wav' through the family module's se_extra()")
    a.note("Timing: the blue peaks 8 frames after the slam and holds until f52 (shown after the last column, "
           "f48..52), then fades with the dark stage, as Max Strike does")
