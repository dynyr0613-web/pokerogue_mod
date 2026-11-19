# Local fork (2026-11-19): the shared body of Max Darkness and G-Max Snooze, rebuilt from CFRU ANIM_MAX_DARKNESS /
# ANIM_G_MAX_SNOOZE (Complete FireRed Upgrade, Skeli and the CFRU team; extract/ANIM_MAX_DARKNESS.txt,
# extract/ANIM_G_MAX_SNOOZE.txt). CFRU writes G-Max Snooze as Max Darkness with light-blue holes (SHADOW_BALL tiles
# drawn with the ICE_CHUNK palette instead of VERTICAL_HEX), only purple orbs (the pink-orb tint 12/16 instead of
# 10/16) and a longer target shake (72 toggles instead of 62). Both spec files call build_darkness() with their
# colours; everything else is one body.
#
# CFRU beats (Max Darkness 241 GBA f / Snooze 261) -> ours (63 / 66 frames):
#   f0    Dynamax flex (72 f); SE_M_THUNDERBOLT2 x5 9 f apart; two spinning SHADOW_BALL "holes" appear on the attacker
#         at x -20 / +20 for 145 f                                  -> flex f0..14, Spark2 crackle x3 (f0, f5, f10),
#                                                                      holes f0..38 (pop in, spin, ride the flex)
#   f72   BG darkens 0 -> 14/16 in 14 f                             -> dark stage fades in f13..17
#   f72   17 launches 2 f apart, each 2 orbs from the holes to the target in 30 f on opposite sine waves (amplitude
#         +-32, one bump down then one up), SE_M_MINIMIZE each; Darkness alternates pink / purple, Snooze all purple
#                                                                   -> f15..31 one launch a frame, 8 frames each,
#                                                                      Minimize x6
#   f84   target shakes vertically (62 / 72 toggles)                -> f21 (after the 6th launch) to the fade
#   f106  target blends 0 -> 16/16 toward deep purple 0x3006; SE_M_SELF_DESTRUCT x6; big dark-purple orb
#         (CIRCLE_OF_LIGHT 14/16 0x3006, grow 15 / hold 48 / shrink 15) on the target; 2 x 5 dark explosion puffs
#         (NEN_EXPLODE: the puff drawn with the unblended VERTICAL_HEX palette, orange -> dark red), 3 f apart,
#         the second set 15 f later                                 -> f32: tone peaks f39; orb f32..52 (5 + 12 + 4);
#                                                                      puffs f32..36 and f37..41; Self-Destruct x2
#   f184  orb gone, target still purple and shaking until f208 / f228 -> f53..54 / f53..57
#   f208  BG and target colour fade back over 33 f                  -> 8 frames, ending on the last frame
import math
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403

# CFRU particle tints (AnimTask_BlendParticle): ORBS 10/16 toward 0x441F (reddish pink); UNUSED_PINK_ORB (the pink orb
# palette the purple orbs use) 10/16 (Snooze 12/16) toward 0x640B (purple); CIRCLE_OF_LIGHT 14/16 toward 0x3006.
# The orbs share the ORBS tiles (PokeRogue's own white PRAS- Orbs, the SUBS stand-in): pink = white tinted toward
# 0x441F; purple = the pink-orb palette blended toward 0x640B, i.e. a violet.
PINK_ORB = (255, 0, 139, 0.62)
PURPLE_ORB = (150, 60, 205, 0.8)
PURPLE_ORB_SNOOZE = (128, 40, 210, 0.86)
# holes: CFRU draws the SHADOW_BALL tiles with another tag's palette. Darkness: VERTICAL_HEX = Fusion_Flare.bmp
# (orange -> dark red ramp, black) -> a black hole with a red rim; Snooze: ICE_CHUNK (pale blues) -> light blue.
HOLE_DARKNESS = (248, 40, 16, 0.85)
# review 2026-11-19: (150, 210, 255, 0.85) left a dark slate core (the tint keeps the Rage Fist ball's dark centre
# dark grey); the tint at full strength gives a light-blue rim and a slate-blue centre, the light-blue hole CFRU
# describes (the luminance-keeping tint cannot lighten the centre further)
HOLE_SNOOZE = (160, 215, 255, 1.0)
# NEN_EXPLODE puffs: UNUSED_EXPLOSION_2 drawn with the VERTICAL_HEX palette (unblended in Darkness): Fusion_Flare is
# black + dark reds with one red and one orange, so the clouds are dark; review: (170, 15, 25, 0.82) read as a
# bright salmon red over the violet orb, (125, 8, 28, 0.9) is the darker blood red of that palette
PUFF_TINT = (125, 8, 28, 0.9)
# the target blend 0x3006 (#310062, deep purple): TYPE_COLORS' dark tone [-118, -192, -45] turns warm sprites dark
# red (orange -> (122, 0, 5)); less red and more blue moves them toward crimson-purple (orange -> (100, 0, 35)) and
# keeps greys / whites purple. (An additive tone cannot turn every colour the same purple; gray must stay 0.)
DARK_TONE = [-140, -195, -15, 0]
# the big orb: 0x3006 is a near-black purple; additive on the dark stage it would vanish, so the stand-in is a
# brighter violet glowing additively over the purple-toned target (see the note)
ORB_TINT = (110, 30, 210, 0.9)

# CFRU DARKNESS_CLOUD_EXPLOSION: the 5 puff positions (GBA px from the target centre), 3 GBA f apart
CLOUD_PUFFS = [(0, 0), (24, -24), (-16, 16), (-24, -12), (16, 16)]

HOLE_X = 38        # CFRU x +-20 GBA on a 64 px attacker (on its edges); ours on the edges of the x1.5 Dynamax user
HOLE_Y = -8        # just above the user's focus point: the orbs leave USER_TARGET y 0, 8 px below (either side)
# review: during the flex the holes ride on the body (the x1.5 user's centre is 16 px above its focus at rest, 28 px
# at the flex peak, and it is 25 % wider), then sink to HOLE_Y as the flex snaps back and the first orbs leave
HOLE_FLEX = (46, -24)
HOLE_REST_Y = -14
HOLE_ZOOM = 72     # the Rage Fist ball (SHADOW_BALL stand-in) at 72 = ~40 px, CFRU's 32 GBA px x 1.3
ORB_ZOOM = 75      # review: the 16 px PRAS orb at 105 was 17 px; CFRU's orb is an 8x8 OAM (~10 px): 75 = 12 px
ORB_AMP = 36       # CFRU +-32 GBA (vertical); a little less keeps the dipping orb on screen
FLIGHT = 8         # CFRU 30 GBA f (10 frames)
LAUNCHES = 17


def _orb_offset(u, amp):
    """CFRU AnimToTargetInSinWave: y2 += Sin(phase, amp), phase 0..127 (half a sine), then the sign flips and the
    phase restarts: one bump of +amp, then one of -amp. CFRU stops at phase ~210 of 256 (the orb vanishes 29 GBA px
    off the target); ours runs the full 256 so each orb ends on the target centre."""
    ph = 256 * u
    if ph <= 128:
        return amp * math.sin(math.pi * ph / 128)
    return -amp * math.sin(math.pi * (ph - 128) / 128)


def build_darkness(a, sheet, L, hole_tint, orb_tints, fade_at, label):
    """The Max Darkness body. orb_tints: the tint per launch, cycled (Darkness: pink, purple; Snooze: purple).
    fade_at: the frame the dark stage and the purple tone start fading back (L - 9)."""
    begin(a, sheet, L)
    hole = sub_cells(a, "SHADOW_BALL", frames=[0, 1, 2, 3], tint=hole_tint)
    orb_cells = [sub_cells(a, "ORBS", tint=t) for t in orb_tints]          # each [big, small]: a twinkle
    puff_src = list(range(len(SUBS["UNUSED_EXPLOSION_2"]["frames"])))
    picks = [min(len(puff_src) - 1, int(i * len(puff_src) / 6)) for i in range(6)]
    made = dict(zip(sorted(set(picks)), sub_cells(a, "UNUSED_EXPLOSION_2", frames=sorted(set(picks)), tint=PUFF_TINT)))
    puff = [made[p] for p in picks]

    # --- opening: flex with the two holes spinning on the attacker, the hole crackle (CFRU SE_M_THUNDERBOLT2 x5;
    # ours the short Spark2 crackle x3: Thunderbolt2 is 1.58 s and the end hold is half the longest sound)
    flex_end = dynamax_flex(a, 0)
    for k in range(3):
        se(a, 5 * k, "SE_M_TRI_ATTACK2", volume=90)
    launch0 = flex_end                       # f15: CFRU f72, right after the flex
    last_launch = launch0 + LAUNCHES - 1     # f31
    # review: CFRU keeps the holes 145 GBA f, past the last launch and into the big orb; ours stay until the last
    # pair lands (f39) instead of vanishing 2 frames after it leaves
    hole_end = last_launch + FLIGHT
    for side in (-1, 1):
        s = a.sprite(hole, 0, hole_end, focus="user", cell_every=2)
        # ride the flex (FLEX 6 + 6 + 3), then sit just above the launch point
        s.key(0, pos=at_user(side * HOLE_X, HOLE_REST_Y))
        s.key(6, pos=at_user(side * HOLE_FLEX[0], HOLE_FLEX[1]), ease="out")
        s.key(12, pos=at_user(side * HOLE_FLEX[0], HOLE_FLEX[1]))
        s.key(flex_end, pos=at_user(side * HOLE_X, HOLE_Y), ease="in")
        s.key(0, zoom=30)
        s.key(2, zoom=HOLE_ZOOM, ease="out")
        s.key(hole_end - 3, zoom=HOLE_ZOOM)
        s.key(hole_end - 1, zoom=20, ease="in")
        s.spin(0, -30 * hole_end)            # sAffineAnims_ShadowBall: 10 deg / GBA f, both the same way

    # --- the darkness falls as the orbs start (CFRU darkens fast at f72), gone on the last frame
    dark_stage(a, flex_end - 2, L - 1, fade_in=5, fade_out=L - 1 - fade_at)

    # --- 17 launches, one a frame: two orbs from the holes on opposite sine waves, ending on the target
    for i in range(LAUNCHES):
        t = launch0 + i
        cells = orb_cells[i % len(orb_cells)]
        for side in (-1, 1):
            s = a.sprite(cells, t, t + FLIGHT, focus="user_target", zoom=ORB_ZOOM)
            start = (side * HOLE_X, 0.0)
            end = (128.0, -64.0)
            for k in range(FLIGHT):
                u = k / (FLIGHT - 1)
                x = start[0] + (end[0] - start[0]) * u
                y = start[1] + (end[1] - start[1]) * u + _orb_offset(u, -side * ORB_AMP)
                s.key(k, pos=(x, y))
    for k in range(6):
        se(a, launch0 + 3 * k, "SE_M_MINIMIZE", volume=80)

    # --- impact: shake from the 6th launch; the purple tone, the big orb and the dark puffs right after the last
    # launch (CFRU f106), while the last orbs are still landing
    hit = last_launch + 1                    # f32
    a.target.shake(launch0 + 6, fade_at, amp=5, period=1, axis="y")
    impact(a, hit, fade_at + 7, "dark", ramp=7, release=7, shake=False, tone=DARK_TONE)
    big_orb(a, hit, tint=ORB_TINT, size=230, grow=5, hold=12, shrink=4, opacity=215)
    for g in range(2):
        tg = hit + 5 * g                     # CFRU: the second DARKNESS_CLOUD_EXPLOSION 15 GBA f later
        se(a, tg, "SE_M_SELF_DESTRUCT", volume=95 if g == 0 else 85, pitch=100 + 6 * g)
        for j, (gx, gy) in enumerate(CLOUD_PUFFS):
            ts = tg + j                      # 3 GBA f apart
            s = a.sprite(puff, ts, ts + len(puff), focus="target", loop=False, pos=at_target(*gba(gx, gy)),
                         zoom=110)
            s.fade(230, 230, t_from=0, t_to=len(puff) - 3)
            s.fade(230, 110, t_from=len(puff) - 3, t_to=len(puff) - 1)

    a.note(f"{label}: CFRU's orbs stop at phase ~210/256 of their sine (29 GBA px off the target); ours run the "
           "full wave and end on the target centre")
    a.note(f"{label}: CIRCLE_OF_LIGHT is blended 14/16 toward 0x3006, a near-black purple; drawn additively on the "
           "dark stage that would not show, so the orb is a brighter violet (110, 30, 210) at opacity 215, glowing "
           "over the purple-toned target")
    a.note(f"{label}: CFRU un-blends the target with colour 0x40C0 (a small pop); ours releases the same purple tone")
    a.note(f"{label}: target tone {DARK_TONE} instead of TYPE_COLORS dark [-118, -192, -45]: the formula tone turned "
           "warm sprites dark red; this one keeps them crimson-purple (CFRU blends 16/16 to deep purple 0x3006)")
    a.note(f"{label}: the holes ride the flex (centre and width of the growing user) and stay until the last orbs "
           "land (f39); CFRU keeps them 145 GBA f, into the big orb")
    a.note(f"{label}: SE_M_THUNDERBOLT2 x5 -> SE_M_TRI_ATTACK2 (Spark2, 0.92 s) x3: Thunderbolt2 is 1.58 s and "
           "alone set an 800 ms end hold (the engine uses the file length, not the pitch); SE_M_MINIMIZE x17 -> x6, "
           "SE_M_SELF_DESTRUCT x6 -> one per puff set")
    return hit
