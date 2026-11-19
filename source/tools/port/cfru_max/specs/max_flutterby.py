# Local fork (2026-11-19): Max Flutterby, rebuilt from CFRU ANIM_MAX_FLUTTERBY (Complete FireRed Upgrade, Skeli and the
# CFRU team; extract/ANIM_MAX_FLUTTERBY.txt).
# CFRU beats (265 GBA f) -> ours (63 frames):
#   f0    EXPLOSION / UNUSED_EXPLOSION_2 / CIRCLE_OF_LIGHT tinted light green (10/16 0x3FB5, 10/16 0x33D5, 12/16
#         0x33D5); BG darkens 14/16 (29 f); Dynamax flex (72 f)    -> tints baked in the cells; f0..7 dark, flex f0..14
#   f0    4 butterflies (BUTTERFLY = SPARKLE_6) appear around the attacker (+-30, -30 / +10) and wait for the flex;
#         SE_M_REFLECT pans target -> attacker                     -> f0..14 fluttering at (+-44, +-24); SE_M_DETECT
#                                                                     instead (Reflect is 2.0 s: 1 s of end hold)
#   f72   the flex ends: each grows 1.5x and arcs to the target centre in 16 f (amplitude -20 top / +20 bottom),
#         SE_M_SAND_ATTACK; f73 4 'tail' butterflies (y -40 / +20) follow
#                                                                  -> f15..20 and f16..21 (5-frame arcs)
#   f76   target shakes horizontally (4 px, 72 toggles = 144 f)    -> f17..50
#   f76   4 x CREATE_FLUTTERBIES: 5 light-green explosions on the target, 4 f apart (the 5th shares its frame with
#         the next wave's 1st), each but the 5th with a pair of butterflies from an attacker corner (TL, BL, TR, BR),
#         SE_M_SELF_DESTRUCT each                                  -> explosions f17..33 (one step a frame), one
#                                                                     butterfly a step (the 1-GBA-frame "tail" twin
#                                                                     would sit on the same spot at 20 fps), one
#                                                                     sound per wave (f17/21/25/29)
#   f140  sound stops; f156 (the last butterflies land) target shakes vertically (4 px, 40 toggles), SE_M_SELF_DESTRUCT
#         x6 (6 f apart), a big light-green CIRCLE_OF_LIGHT orb grows on the target (15 f), holds (48 f), shrinks
#         (15 f); 2 x 5 light-green puffs (LIGHTBURN_EXPLODE) 3 f apart, the second batch 15 f later
#                                                                  -> f38..57 orb (4 + 12 + 4), puffs f38..42 and
#                                                                     f43..47, shake f38..57, 2 sounds
#   f236  BG back (29 f)                                           -> f54..62 (overlapping the orb's shrink)
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403

MOVE_ID = "MAX_FLUTTERBY"

LIGHT_GREEN_EXPLOSION = gba_rgb(0x3FB5)     # EXPLOSION 10/16
LIGHT_GREEN = gba_rgb(0x33D5)               # UNUSED_EXPLOSION_2 10/16, CIRCLE_OF_LIGHT 12/16 (= TYPE_COLORS bug)

# Butterfly start points, USER_TARGET anim px from the user's focus point, with the arc amplitude (+ = bulges up).
# CFRU's corners are (+-30, -30 / +10) and the tails (+-30, -40 / +20) GBA px; USER_TARGET y offsets flip when an
# enemy uses the move, so ours are symmetric about the focus point (the set maps onto itself on either side) and a
# little wider than the Dynamaxed x1.5 body.
CORNERS = {"TL": (-44, -24, 26), "BL": (-44, 24, -26), "TR": (44, -24, 26), "BR": (44, 24, -26)}
TAILS = {"TL": (-44, -42, 26), "BL": (-44, 42, -26), "TR": (44, -42, 26), "BR": (44, 42, -26)}
# explosion / puff spots on the target (CFRU GBA px, x right, y down)
BURSTS = [(0, 0), (24, -24), (-16, 16), (-24, -12), (16, 16)]
TARGET = (128, -64)
FLIGHT = 5          # frames of travel (CFRU 16 GBA f); visible on t0..t0+FLIGHT, landing on the last frame


def _flap(s, t_from, t_to, zoom_of):
    """SPARKLE_6 'butterfly': CFRU only grows it (gSpriteAffineAnimTable_Flutterby); a wing beat (zoomX narrowing every
    other frame) makes the sparkle read as a butterfly at game scale."""
    for k in range(t_from, t_to + 1):
        z = zoom_of(k)
        s.key(k, zoomX=z * (0.55 if k % 2 else 1.0), zoomY=z)


def _butterfly(a, cells, t0, start, launch, amp, land=(0, 0)):
    """One BUTTERFLY: visible at `start` from t0, flies from `launch` on (SpriteCB_MaxFlutterby: grows 1.5x and arcs
    to the target centre in 16 GBA f) and is destroyed on arrival."""
    life = launch - t0 + FLIGHT + 1
    s = a.sprite(cells, t0, t0 + life, focus="user_target", cell_every=2)
    hover = launch - t0
    s.key(0, pos=start, opacity=0 if hover > 2 else 255)
    if hover > 2:
        s.key(2, opacity=255)
        for k in range(2, hover, 2):         # a slow flutter in place while the user flexes
            s.key(k, pos=(start[0], start[1] + (-2 if (k // 2) % 2 else 2)))
    end = (TARGET[0] + land[0], TARGET[1] + land[1])
    s.arc(start, end, height=amp, t_from=hover, t_to=hover + FLIGHT)
    # the 12 px sparkle at scale 2: zoom 62 would be GBA 1x x1.3 (15 px), too small to read on the field; ours start
    # at 21 px and grow 1.5x to 31 px like CFRU's affine anim
    base, peak = 88, 130
    _flap(s, 0, life - 1, lambda k: base if k <= hover else min(peak, base + (peak - base) * (k - hover) / 3))
    return s


def build(a):
    L = 63
    begin(a, "CFRU- Max Flutterby", L)
    dark_stage(a, 0, L - 1, fade_in=8, fade_out=8)
    flex_end = dynamax_flex(a, 0)

    # SPARKLE_6 stand-in (SUBS): CFRU's own 4-point Green_Star sparkle, nudged toward Max Flutterby's light green
    fly = sub_cells(a, "SPARKLE_6", frames=[0, 1], tint=(LIGHT_GREEN[0], LIGHT_GREEN[1], LIGHT_GREEN[2], 0.45))
    # CFRU blends EXPLOSION / UNUSED_EXPLOSION_2 10/16 toward light green; a plain tint turns the orange bursts'
    # dark outlines brown, so the orange is hue-shifted to green first and then tinted a little (white cores stay)
    boom = sub_cells(a, "EXPLOSION", hue=70, tint=(LIGHT_GREEN_EXPLOSION[0], LIGHT_GREEN_EXPLOSION[1],
                                                   LIGHT_GREEN_EXPLOSION[2], 0.35))

    # --- the first butterflies: 4 wait around the attacker during the flex, 4 tails join as they leave
    se(a, 1, "SE_M_DETECT", volume=80)
    for i, key in enumerate(("TL", "BL", "TR", "BR")):
        x, y, amp = CORNERS[key]
        _butterfly(a, fly, 0, (x, y), flex_end, amp, land=((i % 2) * 6 - 3, (i // 2) * 6 - 3))
    for i, key in enumerate(("TL", "BL", "TR", "BR")):
        x, y, amp = TAILS[key]
        _butterfly(a, fly, flex_end, (x, y), flex_end + 1, amp, land=(3 - (i % 2) * 6, 3 - (i // 2) * 6))
    # SpriteCB_MaxFlutterby plays SE_M_SAND_ATTACK on launch (not in the shared SE map; the file exists)
    a.sound(flex_end, "PRSFX- Sand Attack.wav", volume=90)

    # --- 4 waves of explosions on the target, a butterfly from an attacker corner with each of the first four
    t_wave = flex_end + 2                                  # CFRU f76: before the first butterflies land, as in CFRU
    a.target.shake(t_wave, 51, amp=4, period=1, axis="x")
    for w in range(4):
        se(a, t_wave + 4 * w, "SE_M_SELF_DESTRUCT", volume=85, pitch=100 + 4 * w)
        for k in range(5):
            if w < 3 and k == 4:
                continue                                   # the 5th burst is the next wave's 1st (same GBA frame)
            t = t_wave + 4 * w + k
            gx, gy = BURSTS[k]
            s = a.sprite([boom[0], boom[1], boom[2], boom[3], boom[3]], t, t + 5, focus="target", loop=False,
                         pos=at_target(*gba(gx, gy)), zoom=135)
            s.fade(235, 235, t_from=0, t_to=3)
            s.fade(235, 110, t_from=3, t_to=4)
            if k < 4:
                key = ("TL", "BL", "TR", "BR")[k]
                x, y, amp = CORNERS[key]
                _butterfly(a, fly, t, (x, y), t, amp, land=(((w + k) % 3) * 5 - 5, ((w * 2 + k) % 3) * 5 - 5))

    # --- the big light-green orb on the target with two batches of puffs; the target shakes vertically
    t_orb = t_wave + 4 * 3 + 3 + FLIGHT + 1                # the last wave butterfly lands, then the orb (CFRU f156)
    a.target.shake(t_orb, t_orb + 20, amp=4, period=1, axis="y")
    big_orb(a, t_orb, tint=(LIGHT_GREEN[0], LIGHT_GREEN[1], LIGHT_GREEN[2], 0.75), size=215, grow=4, hold=12,
            shrink=4, opacity=220)
    se(a, t_orb, "SE_M_SELF_DESTRUCT", volume=100)
    se(a, t_orb + 4, "SE_M_SELF_DESTRUCT", volume=90, pitch=106)
    n = len(SUBS["UNUSED_EXPLOSION_2"]["frames"])
    puff = sub_cells(a, "UNUSED_EXPLOSION_2", frames=sorted({min(n - 1, int(i * n / 6)) for i in range(6)}),
                     hue=65, tint=(LIGHT_GREEN[0], LIGHT_GREEN[1], LIGHT_GREEN[2], 0.35))
    for batch in range(2):
        for k, (gx, gy) in enumerate(BURSTS):
            t = t_orb + 5 * batch + k
            s = a.sprite(puff, t, t + len(puff), focus="target", loop=False, pos=at_target(*gba(gx, gy)), zoom=105)
            s.fade(230, 230, t_from=0, t_to=len(puff) - 3)
            s.fade(230, 100, t_from=len(puff) - 3, t_to=len(puff) - 1)

    # --- a soft light-green tone from the first bursts until the dark stage fades (CFRU has no target blend)
    impact(a, t_wave + 3, L - 2, "bug", k=0.45, ramp=8, release=7, shake=False)

    a.note("CFRU: no target blend in Max Flutterby; a soft (0.45) light-green tone was added so the hit reads")
    a.note("Sound: SE_M_REFLECT (0xC8) during the flex is 2.0 s (about 1 s of end hold): SE_M_DETECT stands in; "
           "SE_M_SAND_ATTACK (the butterflies' launch sound) is not in the shared SE map: PRSFX- Sand Attack.wav "
           "is played directly")
    a.note("Butterflies: SPARKLE_6 = CFRU's Green_Star sparkle (SUBS) with a wing beat (zoomX); CFRU's 1-GBA-frame "
           "'tail' twins are dropped in the waves (they would overlap at 20 fps): 8 + 16 butterflies instead of 72; "
           "drawn at 21 -> 31 px (CFRU 1x -> 1.5x would be 15 -> 23 px, hard to see at game scale)")
    a.note("Colours: explosions and puffs are hue-shifted orange -> green (70 / 65 deg) plus a 0.35 light-green tint "
           "instead of CFRU's plain 10/16 blend (a tint alone turns their dark outlines brown)")
