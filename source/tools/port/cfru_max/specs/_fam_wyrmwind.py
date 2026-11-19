# Local fork (2026-11-19): the shared body of Max Wyrmwind and G-Max Depletion, rebuilt from CFRU ANIM_MAX_WYRMWIND /
# ANIM_G_MAX_DEPLETION (Complete FireRed Upgrade, Skeli and the CFRU team; extract/ANIM_MAX_WYRMWIND.txt,
# extract/ANIM_G_MAX_DEPLETION.txt). CFRU writes Depletion as a copy of the Wyrmwind script with other blend colours
# (tornado 10/16 toward 0x001D instead of 8/16 toward 0x5818, gusts 8/16 toward 0x001F, target blend 0x001D), so
# both specs call wyrmwind_body() with their colours.
# CFRU beats (265 GBA f) -> ours (L = 57 frames):
#   f0    tornado + gust palettes tinted; Dynamax flex (72 f); SE_M_DOUBLE_TEAM x4 10 f apart; the tornado (64x64,
#         3-frame loop) sits on the attacker and grows 1x -> 2x over 64 f
#                                                          -> f0..14 flex; tornado on the user's chest zoom 40 -> 95,
#                                                             following the flex lift, sinking at f14 to the glide
#                                                             start; SE x3 (f0, f4, f8)
#   f72   tornado glides to target (0, -32) in 16 f; SE_M_STRING_SHOT
#                                                          -> f15..19 (USER_TARGET, straight), SE f15
#   f88   BG darkens to 14/16 in 14 f; SE_M_TWISTER; target shakes vertically (72 toggles, to f232); the tornado
#         towers over the target                          -> f20 dark stage in 5 frames, gust.m4a, shake f20..48;
#                                                             tornado swells to zoom 160 standing on the target's feet
#   f98   target blends slowly to the move colour (1 step / 6 f, full at f195); 6 HURRICANE_GUST swirls 10 f apart,
#         each circling the target on a 32 x 8 ellipse for 71 f
#                                                          -> tone ramps f20..34 and holds; gusts f23..33 (2 frames
#                                                             apart), 14 frames each (1.25 turns): the vanilla gust
#                                                             whirlwind ("PRAS- Gust" frame 0), mirrored on the
#                                                             back half of the ellipse for the palette rotation
#   f230  tornado vanishes                                 -> fades f41..44 (gone 4 frames before the fade, so the
#                                                             coloured target reads on the dark stage)
#   f232  colour and darkening fade back (2 f steps)       -> f48..55 tone, f48..56 dark stage
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403

__all__ = ["wyrmwind_body", "WYRMWIND_L"]

WYRMWIND_L = 57
# the x1.5 user's visual centre is 16 px above its focus point at rest, 28 px at the flex peak (_STYLE.md section 3)
CHEST_REST, CHEST_FLEX = -12, -22
# HURRICANE_GUST (gEllipticalGustSpriteTemplate): target (0, -16) + 20 -> centre 4 GBA px below the target centre,
# x = 32 sin, y = 8 cos, starting at angle 191/256 (the left end), 5/256 of a turn per GBA frame (1.39 turns in 71 f)
GUST_CENTRE = at_target(*gba(0, 4))
GUST_RX, GUST_RY = gba(32), gba(8)


def _mix(c1, c2, k):
    return tuple(int(round(x + (y - x) * k)) for x, y in zip(c1, c2))


def wyrmwind_body(a, sheet, tornado_rgb, tornado_k, gust_rgb, gust_k, tone, L=WYRMWIND_L, label=""):
    """Max Wyrmwind's choreography with the given colours. tornado_rgb / tornado_k: CFRU's BlendParticle on the
    (light blue) Tornado.png palette; gust_rgb / gust_k: the blend on the grey/white GUST palette (our gust is the
    same vanilla whirlwind, "PRAS- Gust" frame 0, tinted the same way); tone: the target's battler tone peak."""
    begin(a, sheet, L)
    fade = L - 9                                   # f48: CFRU f232, colour and darkness fade back together

    tornado = cfru_cells(a, "Tornado.png", tint=(*tornado_rgb, tornado_k))   # 64 px frames, scale 1
    # GUST: the vanilla 32x64 grey whirlwind (gEllipticalGustSpriteTemplate) is in the game as "PRAS- Gust" frame 0
    # (PokeRogue's own Gust anim circles it round the target at zoom 100); CFRU blends its grey/white palette
    # gust_k toward gust_rgb, which the tint reproduces. A mirrored copy is shown while it travels right-to-left
    # (the back half of the ellipse), as PokeRogue's Gust does; that flip stands in for the palette rotation.
    gust_n, gust_m = a.cells("pr:PRAS- Gust", frames=[0], tint=(*gust_rgb, gust_k)) + \
        a.cells("pr:PRAS- Gust", frames=[0], tint=(*gust_rgb, gust_k), flip=True)

    # --- the flex with the tornado on the attacker (CFRU: drawn in front of it, growing 1x -> 2x with the flex)
    flex_end = dynamax_flex(a, 0)
    for k, t in enumerate((0, 4, 8)):
        se(a, t, "SE_M_DOUBLE_TEAM", volume=90 - 5 * k)
    s = a.sprite(tornado, 0, flex_end, focus="user", cell_every=1)
    s.key(0, pos=at_user(0, CHEST_REST), zoom=40, opacity=0)
    s.key(2, opacity=240)
    s.key(6, pos=at_user(0, CHEST_FLEX), zoom=80, ease="out")
    s.key(11, pos=at_user(0, CHEST_FLEX), zoom=95)
    # sinks to 4 px above the focus point: the glide below starts ON the focus point (USER_TARGET y flips for an
    # enemy user), so the hand-over moves 4 px either way
    s.key(flex_end - 1, pos=at_user(0, -4), zoom=100, ease="in")

    # --- the glide onto the target (straight, 16 GBA f), arriving on its last frame
    glide = 5
    se(a, flex_end, "SE_M_STRING_SHOT", volume=95)
    s = a.sprite(tornado, flex_end, flex_end + glide, focus="user_target", cell_every=1, opacity=225)
    s.move((0, 0), (128, -64), t_to=glide - 1)
    s.zoom(100, 115, t_to=glide - 1)

    # --- on the target: the tornado swells and stands on the target's feet (CFRU: target (0, -32) at 2x, i.e.
    # bottom at the feet and twice the target's height; ours zoom 160 so the target still shows through the gaps)
    t_on = flex_end + glide                        # f20
    t_off = fade - 4                               # f44: gone 4 frames before the fade
    s = a.sprite(tornado, t_on, t_off + 1, focus="target", cell_every=1)
    s.key(0, pos=at_target(0, 0), zoom=115, opacity=225)
    s.key(3, pos=at_target(0, -18), zoom=160, ease="out")
    s.key(t_off - t_on - 3, opacity=225)
    s.key(t_off - t_on, opacity=0, ease="in")

    # --- dark stage, the twister sound, shake + slow colour, held to the fade
    dark_stage(a, t_on, L - 1, fade_in=5, fade_out=8)
    se(a, t_on, "SE_M_GUST2", volume=80)
    se(a, t_on + 12, "SE_M_GUST2", volume=65, pitch=95)
    impact(a, t_on, fade + 7, None, tone=tone, ramp=14, release=7, shake_end=fade)

    # --- six gust whirlwinds circling the target, 2 frames apart (CFRU 10 GBA f), 1.25 turns in 14 frames; CFRU
    # starts each at the left end of the ellipse and runs it left-to-right along the front (start_deg 180)
    life, turns = 14, 1.25
    for i in range(6):
        t = t_on + 3 + 2 * i
        # per-frame cell: the mirrored whirlwind while it moves right-to-left (orbit angle 0..180 deg: the back half)
        cells = []
        for k in range(life):
            deg = (180 + 360 * turns * min(k, life - 1) / (life - 1)) % 360
            cells.append(gust_m if deg < 180 else gust_n)
        g = a.sprite(cells, t, t + life, focus="target", cell_every=1, loop=False, zoom=90)
        g.orbit(GUST_CENTRE, GUST_RX, GUST_RY, 180, turns, t_to=life - 1)
        g.key(0, opacity=110)
        g.key(1, opacity=215)
        g.key(life - 3, opacity=215)
        g.key(life - 1, opacity=70)

    gust_col = _mix((192, 192, 192), gust_rgb, gust_k)
    a.note(f"{label}: GUST is a vanilla particle the CFRU download lacks; the game has the same 32x64 whirlwind as "
           f"'PRAS- Gust' frame 0 (PokeRogue's Gust anim), tinted {gust_k:.2f} toward {gust_rgb} like CFRU's "
           f"BlendParticle (mid grey -> about {gust_col}); mirrored on the back half of the ellipse in place of "
           f"AnimTask_AnimateGustTornadoPalette (the SUBS entry, Wind1 frames 8-11, is a sparkle ring, not a gust)")
    a.note(f"{label}: tornado at zoom 160 on the target (CFRU 2x = zoom 200 would bury the target); it leaves 4 "
           f"frames before the colour fades so the coloured target reads on the dark stage")
    a.note(f"{label}: SE_M_TWISTER (PRSFX- Twister.wav, 1.69 s: 0.85 s of end hold) -> SE_M_GUST2 (gust.m4a, 1.0 s) "
           f"twice; the gust swirls are the HURRICANE_GUST sub-script")
    return fade
