# Local fork (2026-11-19): G-Max Wildfire, rebuilt from CFRU ANIM_G_MAX_WILDFIRE_MOVE (Complete FireRed Upgrade, Skeli
# and the CFRU team; extract/ANIM_G_MAX_WILDFIRE_MOVE.txt). CFRU builds it as Max Flare with a red phoenix leading the
# volley and every projectile on a high arc, so the body is the Max Flare family (specs/_fam_flare.py, Max Flare's
# exemplar choreography) with Wildfire's projectiles.
# CFRU beats (237 GBA f) -> ours (54 frames):
#   f0    SE_M_MEGA_KICK, BG darkens 14/16, Dynamax flex, red Flash Cannon ball swells on the attacker
#                                                                  -> f0..14 (as Max Flare)
#   f33   BG fades to BG_INFERNO_OVERDRIVE (scrolling)             -> f8..10 black, f11 PRAS- Burning BG under a flare
#   f65   WILDFIRE_BIRD: the BIRD tinted 15/16 red 0x057C, 64x64, pulsing, AnimMissileArc (rotated along its path),
#         attacker -> target in 50 f, amplitude -35 (high)         -> f15..24: PRAS- Brave Bird (the game's Sky
#                                                                     Attack bird) tinted red, turned to its path,
#                                                                     with a yellow glow under it
#   f69   5 fireballs (red, orange, orange, yellow, yellow) 4 f apart, same high arc, SE_M_FLAME_WHEEL2 x4
#                                                                  -> f17..25 (2 frames apart), 10 frames each
#   f89   target shakes vertically (58 toggles)                    -> f24..47 (plus Max Flare's soft red tone)
#   f105  3 flame geysers 14 f apart                               -> f24, f29, f34
#   f205  inferno removed, BG back to normal                       -> f47..53
import math
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403
from _fam_flare import flare_body  # noqa: E402

MOVE_ID = "G_MAX_WILDFIRE"

# (height, landing) per projectile, bird first. CFRU: all six on amplitude -35 (Max Flare: 5). Max Flare's arcs are
# 6-22 px; these are 28-36, still spread so the six read separately. A USER_TARGET arc that bulges up for a player
# user bulges down for an enemy user (y offsets flip), so they stop at 36: an enemy's volley dips to about the
# player's head height instead of into the message box.
ARCS = [(34, (128, -66)), (28, (122, -58)), (36, (134, -66)), (30, (126, -70)), (34, (130, -56)), (32, (124, -62))]
# the fireballs after the bird: red, orange, orange, yellow, yellow (CFRU's Wildfire order; Flare has two reds)
ORDER = (0, 0, 1, 1, 2, 2)      # index 0 is drawn by bird() instead
# CFRU: 15/16 toward 0x057C (red-orange). On the red inferno BG a flat red bird vanishes; a lighter red-orange keeps
# the white bird's shading and a yellow-white glow rides under it
BIRD_TINT = (255, 100, 30, 0.88)
BIRD_GLOW = (255, 205, 100, 0.8)
BIRD_ZOOM = 100                 # the 64 x 57 bird -> ~64 px, bigger than the ~45 px fireballs


def _bird_cell(a):
    """PRAS- Brave Bird (head up) tinted red and turned 90 deg clockwise so the head points right: a sprite pointing
    along +x and rotated to its direction of travel stays correct for an enemy user (the engine flips USER_TARGET
    graphics horizontally and keeps the angle, which is exactly the point-mirrored path's direction)."""
    make_cell = sys.modules[type(a).__module__].make_cell   # the builder's own cell maker (maxanim or __main__)
    img = make_cell("pr:PRAS- Brave Bird", 0, tint=BIRD_TINT)
    return a.cell_image(img.rotate(-90))


def _arc_angle(start, end, height, u):
    """Screen angle (counter-clockwise degrees, the engine's convention) of Sprite.arc's tangent at u (player side;
    anim space = screen directions there)."""
    dx = end[0] - start[0]
    dy = (end[1] - start[1]) - height * 4 * (1 - 2 * u)
    return math.degrees(math.atan2(-dy, dx))


def _fly(s, start, end, height, travel):
    """Arc + heading keys for the bird."""
    s.arc(start, end, height=height, t_to=travel - 1)
    for i in range(9):
        u = i / 8
        s.key((travel - 1) * u, angle=_arc_angle(start, end, height, u))


def bird(a, i, t, travel, start, end, height, balls, halo):
    if i != 0:
        return False
    cell = _bird_cell(a)
    glow = a.cells("pr:Light1", frames=[6], tint=BIRD_GLOW)[0]
    g = a.sprite(glow, t, t + travel, focus="user_target", blend="add", opacity=210, zoom=190)
    g.arc(start, end, height=height, t_to=travel - 1)
    s = a.sprite(cell, t, t + travel, focus="user_target")
    _fly(s, start, end, height, travel)
    # CFRU affine anim 1 (as the fireballs): grows 1.5x, then pulses
    s.key(0, zoom=BIRD_ZOOM * 0.6)
    s.key(3, zoom=BIRD_ZOOM, ease="out")
    for k in range(4, travel, 2):
        s.key(k, zoom=BIRD_ZOOM * (0.94 if k % 4 == 0 else 1.04))
    s.key(travel - 1, zoom=BIRD_ZOOM)
    return True


def build(a):
    flare_body(a, "CFRU- G-Max Wildfire", L=54, arcs=ARCS, order=ORDER, projectile=bird, notes=[
        "Body: the Max Flare family (specs/_fam_flare.py = specs/max_flare.py's choreography); CFRU's Wildfire is the "
        "same script with the bird and high arcs",
        "Bird: vanilla ANIM_TAG_BIRD (the Sky Attack bird) is not in the CFRU download; PRAS- Brave Bird (PokeRogue's "
        "Sky Attack bird) tinted red-orange stands in, turned to point along +x so its heading follows the arc on "
        "both sides (the 'rotated user_target sprites' check note is expected); the yellow glow under it is ours",
        "Arcs: CFRU's amplitude -35 arcs go up on both sides; one USER_TARGET path cannot (y offsets flip for an "
        "enemy user), so ours bulge up 28-36 px for a player user and dip as far for an enemy user, where each "
        "projectile is about half hidden behind the player's HP box for ~2 of its 10 frames (Max Flare's lower "
        "arcs: about 40 %)",
        "CFRU: no target blend in Wildfire either; Max Flare's 0.55 red tone is kept so the hit reads",
    ])
