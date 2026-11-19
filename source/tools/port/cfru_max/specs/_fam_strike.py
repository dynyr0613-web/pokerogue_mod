# Local fork (2026-11-19): the Max Strike family body, shared by G-Max Gold Rush / Cuddle / Replenish (rebuilt from
# CFRU ANIM_G_MAX_GOLDRUSH / ANIM_G_MAX_CUDDLE / ANIM_G_MAX_REPLENISH, Complete FireRed Upgrade, Skeli and the CFRU
# team). CFRU builds all three as ANIM_MAX_STRIKE with a typed geyser sub-script: the same dark stage, flex, two-stage
# rumble (MAX_STRIKE_SCREEN_SHAKE), slow blend of the target to bright yellow 0x73DF and 3 columns 14 GBA f apart,
# where EXPLOSION_GEYSER becomes EXPLOSION_COINS_GEYSER / EXPLOSION_HEART_GEYSER / EXPLOSION_BERRY_GEYSER: the same 15
# explosion puffs plus 16 particles per column (COIN / RED_HEART / BERRY_NORMAL, SpriteCB_Geyser: spawned at
# target (-4 / +13 / +4 / -16, +16) and shot straight up 4 GBA px a frame out of the top of the screen).
# specs/max_strike.py (the exemplar, another group's file) is not changed; strike_body(a, sheet) with the default
# kind=None writes exactly what it writes (checked 2026-11-19: identical JSON and sheet), so it can call this later.
#
# CFRU beats (209 GBA f) -> ours (50 frames), the same for all four moves:
#   f0    BG darkens 14/16 (29 f); Dynamax flex (72 f)             -> f0..8 dark, flex f0..14
#   f0    MAX_STRIKE_SCREEN_SHAKE: SE_M_STRENGTH x3 + light shake 28 f, x3 more + strong shake 44 f (to f94)
#                                                                  -> f0..4 light, f5..17 strong (battler cels)
#   f72   target shakes vertically (52 toggles) and blends slowly to bright yellow 0x73DF
#                                                                  -> shake f15..40, yellow peaks at f22
#   f72   3 typed columns 14 f apart: 15 puffs + 16 risers each, SE_M_SELF_DESTRUCT
#                                                                  -> f15, f20, f25: 9 puffs + 7 risers each (7 f)
#   f134  columns done; the target stays yellow until f176         -> f36..40
#   f176  yellow and darkening fade back together                  -> f41..48 tone, f41..49 dark stage
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403

STRIKE_LEN = 50


def riser(a, kind, zoom=None, frames=None, **opts):
    """geyser() riser spec {"cells", "zoom", "blend"} for a GEYSER_RISE kind with its zoom / frame order / cell
    options (tint, ...) overridden; frames index the kind's own frame list (e.g. [0, 0, 1] holds the first cell).
    Only the cells the order uses go into the sheet (2026-11-19 review)."""
    src, fr, base_opts, base_zoom, blend = GEYSER_RISE[kind][0]
    order = list(range(len(fr))) if frames is None else list(frames)
    uniq = sorted(set(order))
    made = dict(zip(uniq, source_cells(a, src, frames=[fr[i] for i in uniq], **dict(base_opts, **opts))))
    return {"cells": [made[i] for i in order], "zoom": base_zoom if zoom is None else zoom, "blend": blend}


def strike_body(a, sheet, kind=None, rises=7, rise_life=7, puffs=None, note=None):
    """The Max Strike body. kind: None (plain EXPLOSION_GEYSER, Max Strike), a GEYSER_RISE kind ("coin", "heart",
    "berry") or a riser() spec. rises: risers per column (CFRU 16; budget), one a frame. rise_life: 7 frames at 16 px
    a frame, about 100 px, well above the column (CFRU's fly on until they leave the screen; 8 crashed the builder
    preview for the small berry: maxanim render_frame fails on a graphic more than its own height above the
    field). puffs: puffs per column (None = 10 for Max Strike, 9 with risers: peak 22 graphics). The risers of all
    three columns are drawn in front of all the puffs (riser-only geyser(puffs=0) calls after the puff pass, one per
    column), so they read over the explosions. Returns the frame the hit starts (the flex end)."""
    if puffs is None:
        puffs = 10 if kind is None else 9
    L = STRIKE_LEN
    begin(a, sheet, L)
    fade = L - 9  # f41: CFRU f176, the yellow and the dark stage start fading back together

    # --- opening: dark stage, flex, the two-stage rumble (the strong half runs into the first column, as in CFRU)
    dark_stage(a, 0, L - 1, fade_in=8, fade_out=8)
    flex_end = dynamax_flex(a, 0)
    screen_rumble(a, 0, weak=5, strong=13, amp1=2, amp2=5, sounds=(2, 3))

    # --- impact: the target shakes and turns bright yellow while three columns burst on it; it stays yellow (still
    # shaking) after the columns, then the colour fades with the dark stage
    impact(a, flex_end, fade + 7, "normal", ramp=7, release=7, shake_end=fade)
    geyser(a, flex_end, None, type_="normal", count=3, gap=5, puffs=puffs, puff_zoom=115, puff_opacity=220)
    if kind is None:
        a.note("Timing: CFRU blends the target to yellow over 80 GBA f (mostly hidden by the puffs); ours peaks 7 "
               "frames after the hit and holds until f41, so the yellow target shows on the dark stage after the last "
               "column (f36..41) before it fades back with the darkness, as in CFRU")
    else:
        # one riser-only call per column (2026-11-19 review): in one geyser(count=3, gap=5) call the lane index
        # (riser + column) % 4 puts the risers two columns launch on the same frame (7 risers a column, 5 frames
        # apart) in the same lane at the same height, so 4 of the 21 were hidden exact duplicates (28 wasted cels);
        # with count=1 calls the lane is riser % 4, and a column 5 frames later launches one lane over
        for g in range(3):
            geyser(a, flex_end + 5 * g, kind, type_="normal", count=1, puffs=0, rises=rises, rise_life=rise_life,
                   sound=False)
        a.note("Timing: as Max Strike (specs/_fam_strike.py): the yellow peaks 7 frames after the hit and holds until "
               "f41, then fades back with the dark stage")
        a.note(f"Risers: CFRU shoots 16 particles per column (behind the puffs, subpriority +4 vs +2); ours {rises} "
               f"per column, one a frame, drawn in front of the puffs: the column tops are off screen (the target "
               f"stands near the top), so behind the puffs they would hardly show")
    if note:
        a.note(note)
    return flex_end
