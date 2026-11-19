# Local fork (2026-11-19): the Max Flare family body (CFRU ANIM_MAX_FLARE / ANIM_G_MAX_WILDFIRE_MOVE, Complete FireRed
# Upgrade, Skeli and the CFRU team). CFRU builds G-Max Wildfire as a rewrite of Max Flare: the same SE, dark stage,
# swelling red ball on the attacker, BG_INFERNO_OVERDRIVE and three flame geysers, with a red phoenix leading the
# volley and every projectile on a high arc. `flare_body()` is Max Flare's body taken from the exemplar
# specs/max_flare.py (constants imported from it, choreography unchanged), parameterised by the arcs and an optional
# custom projectile. With Max Flare's parameters it compiles to exactly the JSON and sheet of specs/max_flare.py
# (checked 2026-11-19), so max_flare.py could later call it too; it is not edited here (another author's file).
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403
from max_flare import ARCS as FLARE_ARCS, BALL_COLOURS, VOLLEY_DROP, VOLLEY_START  # noqa: E402,F401

FLARE_NOTES = [
    "CFRU: no target blend in Max Flare; a 0.55 red tone was added so the hit reads at game scale",
    "BG: CFRU fades the dark stage out and BG_INFERNO_OVERDRIVE in, scrolling; ours cuts black -> "
    "PRAS- Burning BG at f11 under a Fire3 flare, static (the texture does not tile when scrolled)",
    "Fireballs: CFRU sends all six on one arc to the target centre 4 GBA f apart; ours are 2 frames apart "
    "with slightly different arcs and landing spots so six balls read instead of one train",
]


def ball_projectile(a, t, travel, start, end, height, ball, halo):
    """One Max Flare fireball: additive halo + the tinted Flash Cannon ball on a linear arc, pulsing (CFRU affine
    anim 1: grows 1.5x, then +-4 pulses), landing on the target on its last visible frame."""
    g = a.sprite(halo, t, t + travel, focus="user_target", blend="add", opacity=130, zoom=135)
    # t_to = travel - 1: the last visible frame is the landing (a key at the life end is never shown)
    g.arc(start, end, height=height, t_to=travel - 1)
    s = a.sprite(ball, t, t + travel, focus="user_target")
    s.arc(start, end, height=height, t_to=travel - 1)
    s.key(0, zoom=56)
    s.key(3, zoom=80, ease="out")
    for k in range(4, travel, 2):
        s.key(k, zoom=72 if k % 4 == 0 else 84)
    s.key(travel - 1, zoom=76)
    return s


def flare_body(a, sheet, L=54, arcs=FLARE_ARCS, colours=BALL_COLOURS, order=(0, 0, 1, 1, 2, 2), travel=10, gap=2,
               projectile=None, notes=FLARE_NOTES):
    """Max Flare's choreography (see specs/max_flare.py for the CFRU beat table): dark stage + flex + the red ball
    swelling on the attacker (f0..14), black -> PRAS- Burning BG cut under a Fire3 flare (f8..11), a volley of
    len(order) projectiles `gap` frames apart from the flex end, `travel` frames each on arcs[i] = (height, landing),
    impact + three flame geysers at f24 / f29 / f34, everything back by L - 1.
    `projectile(a, i, t, travel, start, end, height, balls, halo)` may draw projectile i itself (return True), e.g.
    G-Max Wildfire's leading phoenix; otherwise ball `order[i]` flies. Returns the flex end frame."""
    begin(a, sheet, L)
    balls = [cfru_cells(a, "Flash_Cannon_Ball.png", tint=(r, g, b, 0.94))[0] for r, g, b in colours]
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
    s.key(14, pos=at_user(2, VOLLEY_DROP), zoom=62)       # sinks to where the volley leaves (VOLLEY_START)
    s = a.sprite(flash, 10, 14, focus="user", blend="add", pos=at_user(2, -22), zoom=180, loop=False)
    s.fade(255, 130, t_from=2, t_to=3)

    # --- the inferno, gone by the last frame
    scene_bg(a, 11, L - 1, "PRAS- Burning BG", fade_out=6)

    # --- the volley: every projectile starts ON the user's focus point (USER_TARGET y offsets flip for an enemy
    # user, so a start above it would land below the enemy instead)
    for i in range(len(order)):
        t = flex_end + gap * i
        h, end = arcs[i]
        if projectile and projectile(a, i, t, travel, VOLLEY_START, end, h, balls, halo):
            continue
        ball_projectile(a, t, travel, VOLLEY_START, end, h, balls[order[i]], halo)
    for k in range(4):
        se(a, flex_end + 3 * k, "SE_M_FLAME_WHEEL2", volume=90)

    # --- impact: shake + soft red tone, three flame geysers 14 GBA f apart
    impact(a, 24, 47, "fire", k=0.55, ramp=6, release=7)
    geyser(a, 24, "fire", type_="fire", count=3, gap=5)

    for n in notes or ():
        a.note(n)
    return flex_end
