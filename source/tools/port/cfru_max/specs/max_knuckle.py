# Local fork (2026-11-19): Max Knuckle, rebuilt from CFRU ANIM_MAX_KNUCKLE (Complete FireRed Upgrade, Skeli and the
# CFRU team; extract/ANIM_MAX_KNUCKLE.txt).
# CFRU beats (244 GBA f) -> ours (58 frames):
#   f0    alpha blend on, BG darkens 14/16 (29 f), Dynamax flex (72 f), SE_M_DRAGON_RAGE
#                                                                  -> f0..8 dark, flex f0..14
#   f0    MAX_KNUCKLE_USER_FIST: the HANDS_AND_FEET fist in the VERTICAL_HEX palette (orange-red), alpha-blended,
#         on the attacker, grows 1x -> 2x over 64 f, holds to f60, jitters +-2 px for 10 f, gone at f70
#                                                                  -> f0..14 (grows to f9, jitters f11..14)
#   f0    vanilla EndureEffect: 5 focus-energy flames rise around the attacker, 4 f apart, 24 f each
#                                                                  -> f0..13 (PRAS- Focus Energy flames, starting
#                                                                     at the attacker's lower body: see FLAME_LIFT)
#   f72   SE_M_DETECT, MAX_KNUCKLE_TWINKLE: a Leer twinkle in the top screen corner on the attacker's side (15 f)
#                                                                  -> f14..18 on the fist's path just behind the
#                                                                     attacker (see the note)
#   f87   SE_M_SWAGGER, MAX_KNUCKLE_FLYING_FIST (PUNCH_IMPACT): from the top corner behind the attacker through the
#         target (reaches it in 20 f) and off screen; rotated, holds 7 f, grows 2x over 15 f
#                                                                  -> f17..26: the orange fist over a spinning
#                                                                     PUNCH_IMPACT star, from off screen behind the
#                                                                     attacker past its chest, on the target at f24
#   f107  target shakes vertically (52 toggles) and blends to orange 0x0E5F (one step / 3 f); 3 explosion columns
#         14 f apart                                               -> shake f24..49, orange peaks f31, columns f24,
#                                                                     f29, f34 (done by f44)
#   f149  columns done; the target stays orange and shaking until f211
#                                                                  -> f44..49 (orange shows on the dark stage)
#   f211  orange and darkening fade back together                  -> f49..56 tone, f49..57 dark stage
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403

MOVE_ID = "MAX_KNUCKLE"

# vanilla EndureEffect flames: (GBA dx, dy from the attacker centre, start in our frames)
ENDURE_FLAMES = [(-24, 26, 0), (14, 28, 1), (-5, 10, 3), (28, 26, 4), (-12, 0, 5)]
# 2026-11-19 review: the battle HUD (drawn over the field) covers the bottom of both attackers: the message window
# (field y 132-180) hides a player attacker's feet and the player's HP box (x 180-310, y 87-129) sits right under an
# enemy attacker's feet, so flames starting at the feet (CFRU) were hidden for their first 3-4 frames on either side.
# They start this much higher (at the lower body) and rise linearly.
FLAME_LIFT = 24
FLAME_RISE = 32                 # px each flame rises over its 8 frames (higher reaches the enemy's HP box)
# the flying fist's path in USER_TARGET space. CFRU starts it in the top screen corner behind the attacker
# (GBA (-32, -32)). 2026-11-19 review: the old top-corner path ((-110, -74)) ran its first 4-5 frames behind the
# enemy's HP box (field x 10-140, y 23-55) for a player user and behind the player's HP box for an enemy user (y
# flips), 70-90 % hidden, with the twinkle fully hidden on both sides. No single USER_TARGET path from a top corner
# can avoid both boxes (the mirror of "from the top left" is "from the bottom right", under the message window), so
# the fist now enters off screen behind the attacker at its chest height and flies past its chest up into the
# target: clean for a player user, about a third covered for 2 frames near the end for an enemy user.
FIST_START = (-135, 20)
FIST_END = (241, -100)          # through the target and off the far edge (same line, continued 3 frames)
TWINKLE = (-64, -3)             # on the fist's path, just behind the attacker on either side, clear of the HUD
FIST_TRAVEL = 7                 # CFRU: reaches the target in 20 GBA f


def build(a):
    L = 58
    begin(a, "CFRU- Max Knuckle", L)
    fade = L - 9  # f49: CFRU f211, the orange and the dark stage start fading back together
    fist = tag_cells(a, "HANDS_AND_FEET", frames=[0], palette="Palette_Only/Fusion_Flare.bmp")[0]
    flames = sub_cells(a, "FOCUS_ENERGY")                     # PRAS- Focus Energy frames 0-3
    twinkle = a.cells("pr:PRAS- Leer", frames=[0, 1, 2, 3, 4])  # the vanilla Leer twinkle, 5 frames
    star = sub_cells(a, "PUNCH_IMPACT")[0]                    # PRAS- Strike's yellow hit star

    # --- opening: dark stage, flex, Dragon Rage roar
    se(a, 0, "SE_M_DRAGON_RAGE")
    dark_stage(a, 0, L - 1, fade_in=8, fade_out=8)
    flex_end = dynamax_flex(a, 0)

    # --- focus flames rising around the attacker (behind the fist: created first)
    for dx, dy, t in ENDURE_FLAMES:
        # GBA offsets on a 64 px sprite -> the x1.5 user (centre 16 px up), lifted clear of the HUD (FLAME_LIFT)
        x, y = dx * 1.5, dy * 1.5 - 16 - FLAME_LIFT
        s = a.sprite(flames, t, t + 8, focus="user", cell_every=2, loop=False, zoom=170)
        s.move(at_user(x, y), at_user(x, y - FLAME_RISE))
        s.fade(255, 255, t_to=5)
        s.fade(255, 0, t_from=5, t_to=8)

    # --- the giant translucent fist on the attacker: grows with the flex, jitters, gone when the flex ends
    s = a.sprite(fist, 0, flex_end, focus="user", opacity=190)
    s.key(0, pos=at_user(2, -14), zoom=50, opacity=150)
    s.key(6, pos=at_user(2, -22), ease="out")
    s.key(9, zoom=100, opacity=190, ease="out")      # CFRU: 1x -> 2x over 64 GBA f (32 -> 64 GBA px)
    for k, jx in zip(range(11, 15), (2, -2, 2, -2)):  # CFRU: jitters +-2 px for its last 10 f
        s.key(k, pos=at_user(2 + jx, -22 + 8 * (k - 11) / 3), zoom=100)
    s.key(14, opacity=110)

    # --- the twinkle where the punch will come from, then the flying fist
    se(a, flex_end - 1, "SE_M_DETECT")
    s = a.sprite(twinkle, flex_end - 1, flex_end + 4, focus="user_target", loop=False, pos=TWINKLE, zoom=150)
    t = flex_end + 2
    se(a, t, "SE_M_SWAGGER")
    life = FIST_TRAVEL + 4          # 3 more frames through the target and off the far edge, fading
    for cell, z0, z1, spin in ((star, 150, 250, True), (fist, 70, 125, False)):
        s = a.sprite(cell, t, t + life, focus="user_target")
        s.move(FIST_START, (128, -64), t_to=FIST_TRAVEL)           # linear; on the target at f24
        s.key(life - 1, pos=FIST_END)
        s.key(0, zoom=z0)
        s.key(2, zoom=z0)                                          # CFRU: holds 7 GBA f ...
        s.key(FIST_TRAVEL, zoom=z1, ease="out")                    # ... then grows 2x
        s.key(life - 1, zoom=z1 * 1.1)
        s.key(FIST_TRAVEL, opacity=255)
        s.key(life - 1, opacity=0)
        if spin:
            s.spin(0, -270, t_to=life - 1)                         # CFRU: rotated (the star is symmetric)

    # --- impact: the target shakes and turns orange while three explosion columns burst on it; it stays orange
    # (still shaking) after the columns, then the colour fades with the dark stage
    t_hit = t + FIST_TRAVEL
    impact(a, t_hit, fade + 7, "fighting", ramp=7, release=7, shake_end=fade)
    geyser(a, t_hit, None, type_="fighting", count=3, gap=5, puffs=10, puff_zoom=115, puff_opacity=220)

    a.note("Twinkle + flying fist: CFRU uses fixed top screen corners per side (top left / top right); one "
           "USER_TARGET path cannot (y offsets flip for an enemy user), and a top-corner path runs behind the HP "
           "boxes on both sides (the HUD is drawn over the field). The fist enters off screen behind the attacker at "
           "its chest height and flies past its chest into the target; the twinkle sits on that path just behind "
           "the attacker, clear of the HUD on either side")
    a.note("Focus flames: started 24 px higher than CFRU's feet position (FLAME_LIFT) and rising linearly, because "
           "the message window / the player's HP box cover the attackers' feet")
    a.note("Flying fist: CFRU's MAX_KNUCKLE_FLYING_FIST draws the vanilla PUNCH_IMPACT (not in the download); ours "
           "is the SUBS star (PRAS- Strike) spinning and growing, with the user's orange fist on top so the punch reads")
    a.note("Timing: the orange tone peaks 7 frames after the hit and holds until f49 (CFRU f211), so it shows on the "
           "dark stage after the last column before it fades back with the darkness, as in CFRU")
