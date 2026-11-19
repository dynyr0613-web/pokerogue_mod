# Local fork (2026-11-18, polished 2026-11-19): Max Strike, rebuilt from CFRU ANIM_MAX_STRIKE (Complete FireRed
# Upgrade, Skeli and the CFRU team; extract/ANIM_MAX_STRIKE.txt). Exemplar for specs/_STYLE.md. Also the base of
# G-Max Gold Rush / Cuddle / Replenish (the same body with coin / heart / berry geysers: geyser(kind="coin" |
# "heart" | "berry")).
# CFRU beats (209 GBA f) -> ours (50 frames):
#   f0    BG darkens 14/16 (29 f); Dynamax flex (72 f)             -> f0..8 dark, flex f0..14
#   f0    MAX_STRIKE_SCREEN_SHAKE: SE_M_STRENGTH x3 + light shake of the battlers and BG for 28 f, then x3 more with
#         a strong shake for 44 f, running 22 f into the first column (to f94)
#                                                                  -> f0..4 light, f5..17 strong (battler cels)
#   f72   target shakes vertically (52 toggles = 104 f) and blends slowly to bright yellow 0x73DF (one step / 5 f)
#                                                                  -> shake f15..40, yellow peaks at f22
#   f72   3 explosion columns 14 f apart (EXPLOSION_GEYSER)        -> f15, f20, f25 (done by f36)
#   f134  columns done; the target stays yellow (full at f153) and shaking until f176
#                                                                  -> f36..40 (yellow shows on the dark stage)
#   f176  yellow and darkening fade back together (2 f steps)      -> f41..48 tone, f41..49 dark stage
# CIRCLE_OF_LIGHT is loaded by the CFRU script but never launched, so it is not used here.
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403

MOVE_ID = "MAX_STRIKE"


def build(a):
    L = 50
    begin(a, "CFRU- Max Strike", L)
    fade = L - 9  # f41: CFRU f176, the yellow and the dark stage start fading back together

    # --- opening: dark stage, flex, the two-stage rumble (the strong half runs into the first column, as in CFRU)
    dark_stage(a, 0, L - 1, fade_in=8, fade_out=8)
    flex_end = dynamax_flex(a, 0)
    screen_rumble(a, 0, weak=5, strong=13, amp1=2, amp2=5, sounds=(2, 3))

    # --- impact: the target shakes and turns bright yellow while three explosion columns burst on it; it stays
    # yellow (still shaking) after the columns, then the colour fades with the dark stage
    impact(a, flex_end, fade + 7, "normal", ramp=7, release=7, shake_end=fade)
    geyser(a, flex_end, None, type_="normal", count=3, gap=5, puffs=10, puff_zoom=115, puff_opacity=220)

    a.note("Timing: CFRU blends the target to yellow over 80 GBA f (mostly hidden by the puffs); ours peaks 7 frames "
           "after the hit and holds until f41, so the yellow target shows on the dark stage after the last column "
           "(f36..41) before it fades back with the darkness, as in CFRU")
