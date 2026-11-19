# Local fork (2026-11-19): Max Rockfall, rebuilt from CFRU ANIM_MAX_ROCKFALL (Complete FireRed Upgrade, Skeli and the
# CFRU team; extract/ANIM_MAX_ROCKFALL.txt). Group g8.
# CFRU beats (239 GBA f) -> ours (56 frames):
#   f0    BG darkens 14/16 (29 f); Dynamax flex (72 f); SE_M_ROCK_THROW x3, 8 f apart
#                                                                  -> f0..8 dark, flex f0..14, rock throw f0 / f3 / f6
#   f0    STONE_PILLAR (64x64 x1.75) grows out of the ground at target x-30 (4-frame anim, 12 f each)
#                                                                  -> f1..10 Stone_Pillar frames 3-2-1-0 (rubble ->
#                                                                     full pillar, a stage per rock-throw sound), left
#                                                                     of the target, base on its feet
#   f72   the pillar topples sideways onto the target; SE_FALL     -> f15..23 tips over its bottom corner (ease in)
#   f82   target blends 11/16 toward black (cast shadow, 30 f)     -> f17..23, held
#   f112  SE_M_STRENGTH; AnimTask_SquishTarget (squash 16 f, hold 64 f, restore 16 f)
#                                                                  -> f23 hit, squash f23..26, hold, restore f41..46;
#                                                                     the pillar settles with a small bounce
#   f127  horizontal shake of the BG and all battlers; one EXPLOSION_GEYSER (orange)
#                                                                  -> shake f25..32 (both battlers), column f25..36
#   f149  pillar removed (37 f after the fall)                     -> fades f32..34 under the column
#   f187  shadow fades 11 -> 0 (23 f)                              -> f40..47
#   f210  hidden battlers visible, BG brightens (29 f)             -> f47..55
import math
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403

MOVE_ID = "MAX_ROCKFALL"

# Stone_Pillar.png (64x64 frames, scale 1 in the 96 px cell): the pillar body spans cell x 22..54, y 20..80 (cell
# centre 48), i.e. in sprite-local units of zoom / 100: x -0.26..+0.06, y -0.28..+0.32. CFRU draws it x1.75 (GBA
# 105 px tall, its top off the screen); ours at zoom 170 is 102 px tall, 54 px thick.
PILLAR_ZOOM = 170
BODY_RIGHT = 0.06    # body's right edge (the side facing the target), local x / zoom
BODY_BOTTOM = 0.32   # body's base, local y / zoom
# the pivot of the fall: the body's bottom-right corner, standing 32 px left of the target centre on its feet line.
# CFRU: sprite at target x-30 GBA (body centre -47 GBA = -62 px, right edge -25 px); a bit further out here so a wide
# target sprite is not covered by the standing pillar. Focus "target" never mirrors, so for an enemy user the pillar
# also stands left of the (player's) target and falls right onto it: on screen for both sides, same picture.
PIVOT = (-32, 30)
# angle (degrees, clockwise) per frame from the start of the fall: accelerating (ease in), lands on the target's head
# and presses it down to rest leaning on the squashed target (CFRU rotates it onto the target; a pillar lying flat
# would hide the squash completely), then a small bounce
FALL = [0, 1.5, 5, 10, 17, 26, 34, 42, 50]
SETTLE = [56, 51, 54]
SQUASH = (122, 48)   # zoomX / zoomY of the squashed target (CFRU AnimTask_SquishTarget flattens it vertically)


def _rot_cw(dx, dy, deg):
    """Rotate a screen offset (y down) clockwise by deg degrees."""
    r = math.radians(deg)
    return dx * math.cos(r) - dy * math.sin(r), dx * math.sin(r) + dy * math.cos(r)


def build(a):
    L = 56
    begin(a, "CFRU- Max Rockfall", L)
    pillar = tag_cells(a, "STONE_PILLAR", frames=[3, 2, 1, 0])   # rubble -> full pillar (the PNG stores the full pillar first)

    # --- opening: dark stage, flex, rock-throw sounds while the pillar grows beside the target
    dark_stage(a, 0, L - 1, fade_in=8, fade_out=8)
    flex_end = dynamax_flex(a, 0)
    for i, t in enumerate((0, 3, 6)):
        se(a, t, "SE_M_ROCK_THROW", volume=90 if i else 100)

    # sprite centre for a rotation of `deg` about the pivot (the engine rotates a graphic about its own centre)
    px, py = at_target(*PIVOT)
    c0 = (-BODY_RIGHT * PILLAR_ZOOM, -BODY_BOTTOM * PILLAR_ZOOM)   # sprite centre relative to the pivot, upright

    def centre(deg):
        dx, dy = _rot_cw(c0[0], c0[1], deg)
        return px + dx, py + dy

    fall0 = flex_end                       # f15: CFRU f72, the topple starts as the flex ends
    land = fall0 + len(FALL) - 1           # f23: CFRU f112
    gone = land + 12                       # CFRU: removed 37 f after the fall
    t_rise = 1
    # 2026-11-19 review: one growth stage per rock-throw sound (f1 / f4 / f7, full at f10): CFRU's 4 x 12 f growth
    # takes 2/3 of the 72 f flex, so the pillar is barely up before it topples (was cell_every 2: full at f7)
    s = a.sprite(pillar, t_rise, gone, focus="target", cell_every=3, loop=False, zoom=PILLAR_ZOOM)
    s.key(0, pos=centre(0), angle=0)
    for k, deg in enumerate(FALL + SETTLE):                      # keys are relative to the sprite's start
        s.key(fall0 - t_rise + k, pos=centre(deg), angle=-deg)  # engine angle: positive = counter-clockwise
    life = gone - t_rise
    s.fade(255, 255, t_from=0, t_to=life - 3)
    s.fade(255, 0, t_from=life - 3, t_to=life)                   # visible to life - 1: 255, 170, 85
    se(a, fall0, "SE_FALL")

    # --- the pillar's shadow darkens the target as it falls (CFRU 11/16 toward black, scaled by 0.75 like the type
    # tones: an additive -176 would crush every mid tone to black), held until CFRU's f187
    shadow = blend_tone((0, 0, 0), 0.75 * 11 / 16)
    rel = L - 16                           # f40: shadow fades back over 7 frames (CFRU f187-210)
    a.target.key(fall0 + 2, tone=[0, 0, 0, 0])
    a.target.key(land, tone=shadow, ease="out")
    a.target.key(rel, tone=shadow)
    a.target.key(rel + 7, tone=[0, 0, 0, 0], ease="in")

    # --- impact: squash flat (feet kept on the ground: the cel is scaled about its centre, so it moves down by
    # half the lost height of a ~64 px sprite), hold, restore; screen shake and one explosion column right after
    se(a, land, "SE_M_STRENGTH", volume=110)
    sx, sy = SQUASH
    drop = 32 * (1 - sy / 100)
    a.target.key(land, zoomX=100, zoomY=100, pos=(0, 0))
    a.target.key(land + 3, zoomX=sx, zoomY=sy, pos=(0, drop), ease="out")
    a.target.key(rel + 1, zoomX=sx, zoomY=sy, pos=(0, drop))
    a.target.key(rel + 6, zoomX=100, zoomY=100, pos=(0, 0), ease="out")
    hit = land + 2                         # CFRU f127 (15 f after the hit)
    for b in (a.user, a.target):           # AnimTask_screen_shake: horizontal, 4-5 px, decaying
        b.shake(hit, hit + 4, amp=4, period=1, axis="x")
        b.shake(hit + 4, hit + 8, amp=2, period=1, axis="x")
    geyser(a, hit, None, type_="rock", count=1, puffs=10, puff_zoom=115, puff_opacity=220)

    a.note("Pillar: CFRU's SpriteCB_StonePillar rotation is not in the download; ours tips over its bottom-right "
           "corner and comes to rest leaning on the squashed target (about 55 degrees) instead of lying flat, so the "
           "squash under it reads; focus target (never mirrored): it stands left of the target and falls right for "
           "both sides (CFRU mirrors x for an enemy attacker)")
    a.note("CFRU's player-side branch (enemy attacker: pillar y -33, SE_M_MEGA_KICK2, slightly earlier impact) is "
           "folded into the one file; AnimTask_AllBanksInvisibleExceptAttackerAndTarget has no equivalent (an "
           "animation only drives the user and target cels)")
