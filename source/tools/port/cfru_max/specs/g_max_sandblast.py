# Local fork (2026-11-19): G-Max Sandblast, rebuilt from CFRU ANIM_G_MAX_SANDBLAST (Complete FireRed Upgrade, Skeli
# and the CFRU team; extract/ANIM_G_MAX_SANDBLAST.txt). Group g8. CFRU builds it as Max Quake (target shake 56 toggles
# instead of 64) + SE_M_SAND_TOMB and 3 vanilla SandTombSwirlingDirt calls; the body is specs/_fam_quake.py.
# CFRU beats (477 GBA f) -> ours (71 frames):
#   f0    explosion puffs tinted reddish pink 8/16 (0x447F); BG darkens 14/16; Dynamax flex (72 f)
#                                                                  -> puff cells baked; dark f0..8; flex f0..14
#   f72   dirt mound under the attacker (180 f); it sinks into the ground (Dig, f73-223); GROUND_DIGGING x4
#                                                                  -> mound f15..36, the user squashes into it
#                                                                     f15..25 (wobble, fades), clods f15 / f18 / f21
#   f207  Rollout path: mud / rocks hop and reddish puffs pop along the attacker -> target path; 5th GROUND_DIGGING
#                                                                  -> f23..24 two puffs climb out of the mound, f24..33
#                                                                     one step a frame (+ clods at f24)
#   f271  SE_M_EXPLOSION; target shakes vertically (56 toggles, to f383); 4 x DIRT_GEYSER 14 f apart
#                                                                  -> shake f32..51 (+ a soft earth tone), columns
#                                                                     f32 / f37 / f42 / f47
#   f383  SE_M_SAND_TOMB; 3 x SandTombSwirlingDirt 12 f apart (6 sand particles, 2 f apart, rising around the target
#         on a sine path, 20-30 f each)                           -> f52 / f55 / f58, 5-8 frames each (to f69)
#   f448  attacker at 14/16 black made visible; BG and attacker fade back (29 f)
#                                                                  -> user back dark at f62, BG and user f62..70
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403
from _fam_quake import quake_body, sand_vortex, user_return  # noqa: E402

MOVE_ID = "G_MAX_SANDBLAST"


def build(a):
    L = 71
    k = quake_body(a, "CFRU- G-Max Sandblast", L, shake_frames=20)
    sand_vortex(a, k["shake_end"], calls=3, gap=3)
    user_return(a, L - 9)

    a.note("Body = Max Quake (specs/_fam_quake.py: Dig mound PRAS- Dig frame 0, rollout trail on the user -> target "
           "centre line, risers all on the target although CFRU's MUD_SAND risers start at the attacker, a soft "
           "earth tone k 0.45 that CFRU does not have)")
    a.note("Sand Tomb vortex: the vanilla MUD_SAND tile is missing; the clumps are PokeRogue's own Sand Tomb particle "
           "(PRAS- Sand Tomb frames 1-2); the sine swing is GBA px x1.0 (x1.3 would put it 65 px out)")
