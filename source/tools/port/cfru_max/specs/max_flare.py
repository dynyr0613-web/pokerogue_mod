# Local fork (2026-11-18, polished 2026-11-19): Max Flare, rebuilt from CFRU ANIM_MAX_FLARE (Complete FireRed
# Upgrade, Skeli and the CFRU team; extract/ANIM_MAX_FLARE.txt). Exemplar for specs/_STYLE.md.
# CFRU beats (237 GBA f) -> ours (54 frames):
#   f0    SE_M_MEGA_KICK, BG darkens 14/16, Dynamax flex, red Flash Cannon ball swells on the attacker (~1.5x, 72 f)
#                                                                  -> f0..14 (flex 15 frames, ball 45% -> 95% -> 75%,
#                                                                     sinking at f14 to the volley's start point)
#   f33   BG fades to BG_INFERNO_OVERDRIVE (scrolls left 5 px/f)   -> f8..10 black to full, f11 cut to PRAS- Burning BG
#                                                                       (the game's Inferno Overdrive BG) under a Fire3
#                                                                       flare; not scrolled: that texture has a seam
#   f65   6 balls (red, red, orange, orange, yellow, yellow), 4 f apart, low arcs to the target in 50 f, pulsing,
#         SE_M_FLAME_WHEEL2 x4                                     -> f15..25 (2 frames apart), 10 frames each,
#                                                                     landing on the target on their last frame
#   f89   target shakes vertically (58 toggles)                    -> f24..47 (plus a soft red tone: CFRU has none)
#   f105  3 flame geysers 14 f apart (explosion column + embers); they start before the first ball lands, as in CFRU
#                                                                  -> f24, f29, f34
#   f205  inferno removed, BG back to normal                       -> f47..53
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403

MOVE_ID = "MAX_FLARE"

# CFRU tints the white Flash Cannon ball 15/16 toward 0x057C / 0x01DD / 0x063C (three orange-reds that look alike at
# game scale); pushed apart into a readable red / orange / yellow
BALL_COLOURS = [(225, 50, 20), (255, 130, 20), (255, 215, 50)]
# arc height and landing spot per ball: CFRU sends all six to the target centre on one low arc (amplitude 5); a
# little spread keeps six separate fireballs readable instead of one train
ARCS = [(10, (122, -58)), (18, (134, -66)), (6, (126, -70)), (22, (130, -56)), (12, (124, -64)), (16, (132, -62))]
# 2026-11-19 review: the volley leaves from the user's focus point and the attacker ball sinks to 8 px above it at
# f14, so the hand-over jumps about 8 px for either side (USER_TARGET y flips for an enemy user; "user" does not)
VOLLEY_START = (2, 0)
VOLLEY_DROP = -8


def build(a):
    L = 54
    begin(a, "CFRU- Max Flare", L)
    balls = [cfru_cells(a, "Flash_Cannon_Ball.png", tint=(r, g, b, 0.94))[0] for r, g, b in BALL_COLOURS]
    halo = a.cells("pr:Light1", frames=[6], tint=(255, 120, 30, 0.85))[0]       # soft 52 px glow, additive
    flash = a.cells("pr:Fire3", frames=[5, 6, 7, 8])                             # ignition flare at the BG cut

    # --- opening: dark stage, flex, the ball swelling on the attacker's chest (it follows the flex lift: the x1.5
    # user's centre is 16 px above its graphic focus at rest, 28 px at the flex peak)
    se(a, 0, "SE_M_MEGA_KICK")
    dark_stage(a, 0, None, fade_in=6)            # replaced by the inferno at f11
    bg_fade(a, 8, DARK, 255, 3)                  # to full black, so the cut to the fire BG is clean
    flex_end = dynamax_flex(a, 0)
    s = a.sprite(halo, 0, 15, focus="user", blend="add")
    s.key(0, pos=at_user(2, -12), zoom=90, opacity=0)
    s.key(6, pos=at_user(2, -22), zoom=300, opacity=200, ease="out")
    s.key(11, pos=at_user(2, -22), zoom=300, opacity=200)
    s.key(14, pos=at_user(2, VOLLEY_DROP), zoom=160, opacity=60, ease="in")
    s = a.sprite(balls[0], 0, 15, focus="user", opacity=240)
    s.key(0, pos=at_user(2, -12), zoom=45)
    s.key(7, pos=at_user(2, -22), zoom=95, ease="out")     # CFRU: swells to ~1.5x over 32 f
    s.key(12, pos=at_user(2, -22), zoom=75, ease="inout")  # back over 32 f
    # holds, then sinks to where the volley leaves (VOLLEY_START): CFRU launches at 1x, so no size pop either
    s.key(14, pos=at_user(2, VOLLEY_DROP), zoom=62)
    s = a.sprite(flash, 10, 14, focus="user", blend="add", pos=at_user(2, -22), zoom=180, loop=False)
    s.fade(255, 130, t_from=2, t_to=3)

    # --- the inferno, gone by the last frame
    scene_bg(a, 11, L - 1, "PRAS- Burning BG", fade_out=6)

    # --- six fireballs arcing to the target. They start ON the user's focus point (VOLLEY_START y = 0): USER_TARGET
    # y offsets flip for an enemy user, so any start above the focus point lands below the enemy instead (the old
    # (2, -6) start jumped 8 px from the attacker ball for the player but 20 px for an enemy user)
    travel = 10
    for i in range(6):
        t = flex_end + 2 * i
        h, end = ARCS[i]
        start = VOLLEY_START
        g = a.sprite(halo, t, t + travel, focus="user_target", blend="add", opacity=130, zoom=135)
        # t_to = travel - 1: the last visible frame is the landing (a key at the life end is never shown)
        g.arc(start, end, height=h, t_to=travel - 1)
        s = a.sprite(balls[i // 2], t, t + travel, focus="user_target")
        s.arc(start, end, height=h, t_to=travel - 1)
        # CFRU affine anim 1: grows 1.5x, then pulses +-4
        s.key(0, zoom=56)
        s.key(3, zoom=80, ease="out")
        for k in range(4, travel, 2):
            s.key(k, zoom=72 if k % 4 == 0 else 84)
        s.key(travel - 1, zoom=76)
    for k in range(4):
        se(a, flex_end + 3 * k, "SE_M_FLAME_WHEEL2", volume=90)

    # --- impact: shake + soft red tone, three flame geysers 14 GBA f apart
    impact(a, 24, 47, "fire", k=0.55, ramp=6, release=7)
    geyser(a, 24, "fire", type_="fire", count=3, gap=5)

    a.note("CFRU: no target blend in Max Flare; a 0.55 red tone was added so the hit reads at game scale")
    a.note("BG: CFRU fades the dark stage out and BG_INFERNO_OVERDRIVE in, scrolling; ours cuts black -> "
           "PRAS- Burning BG at f11 under a Fire3 flare, static (the texture does not tile when scrolled)")
    a.note("Fireballs: CFRU sends all six on one arc to the target centre 4 GBA f apart; ours are 2 frames apart "
           "with slightly different arcs and landing spots so six balls read instead of one train")
