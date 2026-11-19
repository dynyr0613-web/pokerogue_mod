# Local fork (2026-11-19): G-Max Foam Burst, rebuilt from CFRU ANIM_G_MAX_FOAMBURST (Complete FireRed Upgrade, Skeli
# and the CFRU team; extract/ANIM_G_MAX_FOAMBURST.txt). CFRU writes it as a prelude to ANIM_MAX_GEYSER: HYDRO_PUMP and
# WATER_IMPACT tinted 10/16 toward white (0x7FFF), then `goto ANIM_MAX_GEYSER_BEGIN`. So the body is the Max Geyser
# family (specs/_fam_geyser.py) with white foam balls and a foam-white orb; the timing is Max Geyser's exactly.
# CFRU beats (333 GBA f) -> ours (61 frames):
#   f0    HYDRO_PUMP + WATER_IMPACT palettes blended 10/16 to white -> baked into the sheet cells (ball, orb)
#   f0    BG darkens 14/16; Dynamax flex                            -> f0..8 dark stage, flex f0..14
#   f5    8 LARGE_BUBBLES on the attacker, SE_M_CRABHAMMER each     -> f1..10 bubble pairs, SE f1 and f7
#   f88   SE_M_HYDRO_PUMP; BG shake; stream of 36 foam balls + 6 bubble shots
#                                                                   -> f15..34 one foam ball a frame, bubble shots
#                                                                      f15..35 every 4 frames; no BG shake
#   f100  target shakes; 7 small bubbles burst off it after every pair
#                                                                   -> shake f22..52 (+ soft foam-white tone),
#                                                                      bubbles f22..34
#   f124  SE_M_HYDRO_PUMP again                                     -> f27
#   f160  big foam-white orb (15 + 48 + 15 f) + 9 bubble bursts with SE_M_SELF_DESTRUCT / SE_M_CRABHAMMER
#                                                                   -> orb f36..58, 6 bursts f37..47
#   f304  BG brightens                                              -> f52..60
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _fam_geyser import *  # noqa: E401,E702,F403

MOVE_ID = "G_MAX_FOAM_BURST"

# CFRU AnimTask_BlendParticle HYDRO_PUMP and WATER_IMPACT (the orb's palette) 10/16 -> 0x7FFF. FOAM_WHITE (channels
# above 255) approximates the GBA's linear blend with a.cells' luminance-scaled tint (see _fam_geyser.py); a plain
# (255, 255, 255) tint turned the balls grey and the sphere grey-lavender (2026-11-19 review)
FOAM_TINT = FOAM_WHITE + (FOAM_K,)
FOAM_ORB_TINT = FOAM_WHITE + (FOAM_K,)
FOAM_TONE = blend_tone((235, 245, 255), 0.4)  # ours: CFRU has no target blend


def build(a):
    build_geyser(a, "CFRU- G-Max Foam Burst", L=61, ball_tint=FOAM_TINT, orb_tint=FOAM_ORB_TINT, tone=FOAM_TONE)
    a.note("CFRU: no target blend in G-Max Foam Burst; a soft foam-white tone (blend_tone((235, 245, 255), 0.4)) "
           "was added so the hit reads")
    a.note("CFRU shakes the darkened battle BG during the stream; the dark stage is a black AddBg: left out")
    a.note("Same reductions as Max Geyser (20 stream balls for 36, 4 of 7 target bubbles, 6 of 9 orb bursts)")
    a.note("Foam: the 10/16 white blend is baked into the ball and the water sphere with tint (300, 320, 340, 10/16): "
           "a.cells' tint scales its target by luminance, so plain white gave grey balls and a grey-lavender sphere")
