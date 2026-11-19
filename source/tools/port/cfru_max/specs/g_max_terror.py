# Local fork (2026-11-19): G-Max Terror, rebuilt from CFRU ANIM_G_MAX_TERROR (Complete FireRed Upgrade, Skeli and the
# CFRU team; extract/ANIM_G_MAX_TERROR.txt). Max Phantasm's body (specs/_fam_phantasm.py) followed by the red Mean
# Look eye.
# CFRU beats (395 GBA f) -> ours (73 frames):
#   f0    pink object tints (+ VERTICAL_HEX royal blue); BG darkens; flex; SE_M_NIGHTMARE
#                                                                  -> f0..8 dark, flex f0..14
#   f0    5 pink objects grow round the attacker, f72 arc to the target (SE_M_SAND_ATTACK), wait 16 f
#         (SE_M_STRENGTH), slam                                    -> f0..8 grow, f15..22 arc, f22..25 wait, f26 slam
#   f132  target shakes and blends royal blue; 3 NEN geysers 14 f apart
#                                                                  -> f27..44 shake, blue peak f35; f27, f32, f37
#   f236  the blue fades (33 f); EYE tinted 8/16 red; target sent behind the eye; SE_M_PSYBEAM, SE_M_CONFUSE_RAY x4
#         (15 f apart), SE_M_LEER after 85 f; the Mean Look eye pulses ~71 f, shrinks, reappears, jitters 16 f,
#         fades (~130 f)                                           -> f45..52 blue fades; eye f45..64 (fades in
#                                                                     f45..49 pulsing to f55, shrinks f56..58, back
#                                                                     f59 jittering to f64, fades f61..64), Psybeam
#                                                                     f45, Confuse Ray f46 / f52, Leer f59
#   f366  BG brightens (29 f)                                      -> f65..72
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403
from _fam_phantasm import phantasm_body, mean_look_eye  # noqa: E402

MOVE_ID = "G_MAX_TERROR"


def build(a):
    L = 73
    eye_t0 = 45        # as the last geyser column dies down (CFRU waits for the target shake, f236)
    eye_len = 20
    phantasm_body(a, "CFRU- G-Max Terror", L, tone_fade=eye_t0, bg_fade_out=L - 1 - (eye_t0 + eye_len))
    mean_look_eye(a, eye_t0, length=eye_len)
    a.note("Body as Max Phantasm (same family module); the post-geyser blue hold is cut: the eye starts at f45 as "
           "the last column dies down, so the move stays within 75 frames")
    a.note("Eye: CFRU's Mean_Look.png blended exactly 8/16 toward 0x001F (the builder's tint= would leave the "
           "dark-grey eye a dim maroon); SE_M_CONFUSE_RAY x2 instead of x4 (one per pulse pair)")
    a.note("SE_M_SAND_ATTACK (played by CFRU's SpriteCB_MaxPhantasmObject) is not in _common.SE: "
           "'PRSFX- Sand Attack.wav' through the family module's se_extra()")
