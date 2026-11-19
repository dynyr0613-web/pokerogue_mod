# Local fork (2026-11-19): G-Max Vine Lash, rebuilt from CFRU ANIM_G_MAX_VINE_LASH_MOVE (Complete FireRed Upgrade,
# Skeli and the CFRU team; extract/ANIM_G_MAX_VINE_LASH_MOVE.txt).
# CFRU beats (230 GBA f) -> ours (56 frames):
#   f0    Leer tinted 12/16 red 0x001F, explosions 8/16 reddish pink 0x447F; BG darkens 14/16; Dynamax flex
#                                                                  -> f0..8 dark, flex f0..14
#   f32   SE_M_DETECT, two red Leer glints at attacker (-15, -45) and (+15, -45), 5 frames x 3 f
#                                                                  -> f11..15 (PRAS- Leer, the vanilla twinkle)
#   f72   VINE_LASH x4, 7 f apart: two vines (Power Whip lash, one mirrored) at target x-20 / x+20, SE_M_SCRATCH;
#         after the first, the target shakes sideways (offset 5, 14 steps)
#                                                                  -> f15, f17, f20, f22 (PRAS- Grass 23-27, the
#                                                                     game's Vine Whip / Power Whip lash, at 2x);
#                                                                     sideways shake f15..21
#   f93   target shakes vertically (52 toggles) and blends pink 0x54DF (one step / 3 f); 3 explosion columns
#         (reddish-pink puffs) 14 f apart                          -> shake f22..47, pink peaks f29, columns f22,
#                                                                     f27, f32 (done by f42)
#   f135  columns done; the target stays pink and shaking until f197
#                                                                  -> f42..47 (pink shows on the dark stage)
#   f197  pink and darkening fade back together                    -> f47..54 tone, f47..55 dark stage
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403

MOVE_ID = "G_MAX_VINE_LASH"

LEER_RED = (255, 0, 0, 0.75)                          # CFRU BlendParticle LEER 12/16 toward 0x001F
PUFF_PINK = EXTRA_COLORS["reddish_pink"] + (0.5,)     # CFRU BlendParticle UNUSED_EXPLOSION_2 8/16 toward 0x447F
TARGET_PINK = blend_tone(gba_rgb(0x54DF), 0.75)       # CFRU pal_fade PAL_DEF -> 16/16 0x54DF (#FF31AC)
LASHES = [0, 2, 5, 7]           # CFRU: 7 GBA f apart (2.33 of our frames)
# CFRU hits the same spot four times; a few px apart so the four lashes read. 2026-11-19 review: the lash art sits in
# the lower half of its cell (32 px below the sprite point at 2x), so at target y -6..+2 the lashes on a player
# target (enemy user) were 40-75 % behind the message window (field y 132+); 12 px higher keeps them in view and the
# tops stay on screen for an enemy target
LASH_Y = [-18, -12, -22, -14]
VINE_X, VINE_ZOOM = 22, 200     # CFRU: target x -20 / +20 GBA, affine 2x (the 32 px vine -> 64 px)
GLINT_Y = -40                   # px above the user's focus point (see build)


def build(a):
    L = 56
    begin(a, "CFRU- G-Max Vine Lash", L)
    fade = L - 9  # f47: CFRU f197, the pink and the dark stage start fading back together
    glint = a.cells("pr:PRAS- Leer", frames=[0, 1, 2, 3, 4], tint=LEER_RED)
    vine = a.cells("pr:PRAS- Grass", frames=[23, 24, 25, 26, 27])   # Vine Whip / Power Whip lash, 5 frames

    # --- opening: dark stage and flex; the attacker's eyes glint red near the top of the flex
    dark_stage(a, 0, L - 1, fade_in=8, fade_out=8)
    flex_end = dynamax_flex(a, 0)
    t_glint = 11                    # CFRU f32
    se(a, t_glint, "SE_M_DETECT")
    for dx in (-18, 18):
        # CFRU (+-15, -45) GBA on the 2x flexed sprite: near the top of the head. GLINT_Y keeps the glints on screen for
        # an enemy user too (a Dynamaxed enemy's head reaches the top edge)
        a.sprite(glint, t_glint, t_glint + 5, focus="user", loop=False, pos=at_user(dx, GLINT_Y), zoom=130)

    # --- four double lashes on the target: one vine normal, one mirrored, either side of the target
    for k, (dt, dy) in enumerate(zip(LASHES, LASH_Y)):
        t = flex_end + dt
        se(a, t, "SE_M_SCRATCH", volume=95, pitch=100 + 4 * k)
        a.sprite(vine, t, t + 5, focus="target", loop=False, pos=at_target(-VINE_X, dy), zoom=VINE_ZOOM)
        a.sprite(vine, t, t + 5, focus="target", loop=False, mirror=True, pos=at_target(VINE_X, dy), zoom=VINE_ZOOM)
    # CFRU AnimTask_screen_shake on the target after the first lash: sideways, decaying
    t = flex_end
    a.target.shake(t, t + 3, amp=4, period=1, axis="x")
    a.target.shake(t + 3, t + 5, amp=3, period=1, axis="x")
    a.target.shake(t + 5, t + 7, amp=2, period=1, axis="x")

    # --- impact with the fourth lash: vertical shake, pink, three reddish-pink explosion columns; the target stays
    # pink (still shaking) after the columns, then the colour fades with the dark stage
    t_hit = flex_end + LASHES[-1]
    impact(a, t_hit, fade + 7, "grass", tone=TARGET_PINK, ramp=7, release=7, shake_end=fade)
    geyser(a, t_hit, None, puff_tint=PUFF_PINK, count=3, gap=5, puffs=10, puff_zoom=115, puff_opacity=220)

    a.note("Vines: CFRU's VINE_LASH_VINE draws the vanilla UNUSED_VINE_2 tiles with the Power Whip lash frames; the "
           "game's own Vine Whip / Power Whip lash (PRAS- Grass 23-27, one vine mirrored, exactly CFRU's layout) "
           "stands in instead of the rough SUBS entry (pr:grass arcs)")
    a.note("Glints: CFRU's (+-15, -45) on the 2x flexed attacker is the top of its head; ours sit at -40 px so an "
           "enemy user's glints stay on screen")
    a.note("Lash height: CFRU whips at the target centre; ours sit 12-22 px higher (the lash art hangs in the lower "
           "half of its cell), so the lashes on a player target are not hidden by the message window")
    a.note("Timing: the pink tone peaks 7 frames after the fourth lash and holds until f47 (CFRU f197), so it shows "
           "on the dark stage after the last column before it fades back with the darkness, as in CFRU")
