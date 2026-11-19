# Local fork (2026-11-19): Max Quake, rebuilt from CFRU ANIM_MAX_QUAKE (Complete FireRed Upgrade, Skeli and the CFRU
# team; extract/ANIM_MAX_QUAKE.txt). Group g8; the body is shared with G-Max Sandblast (specs/_fam_quake.py).
# CFRU beats (430 GBA f) -> ours (64 frames):
#   f0    explosion puffs tinted reddish pink 8/16 (0x447F); BG darkens 14/16; Dynamax flex (72 f)
#                                                                  -> puff cells baked; dark f0..8; flex f0..14
#   f72   dirt mound (2 halves, 180 f) under the attacker; it sinks into the ground (Dig, wavy, f73-223);
#         GROUND_DIGGING x4 (4 clods out of the hole + SE_M_DIG, 32 f apart)
#                                                                  -> mound f15..36 (PokeRogue's Dig mound), the user
#                                                                     squashes into it f15..25 (wobble, fades out),
#                                                                     clods + dig SE f15 / f18 / f21
#   f207  AnimTask_Rollout + RolloutPathExplosions: mud / rocks hop and reddish puffs pop along the attacker ->
#         target path (90 f); the 5th GROUND_DIGGING             -> f23..24 two puffs climb out of the mound, f24..33
#                                                                     one step a frame (+ clods at f24)
#   f271  SE_M_EXPLOSION; target shakes vertically (64 toggles, to f399); 4 x DIRT_GEYSER 14 f apart
#         (reddish puffs + rocks / mud rising)                    -> shake f32..54 (+ a soft earth tone, CFRU has
#                                                                     none), columns f32 / f37 / f42 / f47 (to f58)
#   f399  attacker at 14/16 black made visible; BG and attacker fade back (29 f)
#                                                                  -> user back dark at f55, BG and user f55..63
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403
from _fam_quake import quake_body, user_return  # noqa: E402

MOVE_ID = "MAX_QUAKE"


def build(a):
    L = 64
    k = quake_body(a, "CFRU- Max Quake", L, shake_frames=22)
    user_return(a, L - 9)

    a.note("CFRU's DIRT_GEYSER places its MUD_SAND risers at the ATTACKER (vanilla AnimMudSportDirt reads the "
           "attacker position), so mud also sprays out of the empty dig hole; ours keeps all risers on the target "
           "(geyser kind 'ground')")
    a.note("Dig: no scanline clipping in the engine; the user squashes toward its feet behind the mound (priority 1) "
           "and fades, instead of sliding down under a clipped ground line. DIRT_MOUND = PokeRogue's own Dig mound "
           "(PRAS- Dig frame 0), not the SUBS rubble frame")
    a.note("Rollout trail: on the user -> target centre line (USER_TARGET y offsets flip for an enemy user, so a "
           "ground-level path would run at head height there); the attacker's Rollout wind-up is invisible in CFRU "
           "too (the attacker is underground) and is left out")
    a.note("CFRU has no target blend in Max Quake; a soft earth-brown tone (k 0.45) is added so the hit reads")
