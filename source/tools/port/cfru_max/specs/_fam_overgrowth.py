# Local fork (2026-11-19): the shared body of Max Overgrowth and G-Max Tartness, rebuilt from CFRU ANIM_MAX_OVERGROWTH /
# ANIM_G_MAX_TARTNESS (Complete FireRed Upgrade, Skeli and the CFRU team; extract/ANIM_MAX_OVERGROWTH.txt,
# extract/ANIM_G_MAX_TARTNESS.txt). CFRU writes G-Max Tartness as Max Overgrowth with giant golden apples
# (GOLDEN_APPLE, same template, same growing anim) instead of the giant mushrooms and apples instead of the cotton
# spores in the leaf geysers. Both spec files call build_overgrowth() with their sprout and geyser particles.
#
# CFRU beats (317 GBA f) -> ours (64 frames):
#   f0    BG darkens 14/16 (29 f); Dynamax flex (72 f); 4 seeds pop up from the attacker 2 f apart and fly off the top
#         (SE_M_HORN_ATTACK each)                                  -> dark f0..7, flex f0..14, seeds f1..8,
#                                                                     Horn Attack x2
#   f72   4 big seeds (2x) drop 64 px onto the target's feet 16 f apart, accelerating, a SE_M_STRENGTH thud as each
#         lands; they stay and vanish together (f165)              -> drops f15, 18, 21, 24 (3 frames each), thuds
#                                                                     f17..26, all gone at f31
#   f152  4 giant mushrooms / golden apples (2x, growing frames) sprout at the target, one behind it, for 45 f
#         (SE_M_METRONOME x4, 1 f apart)                           -> f28..39 (grown by f31), Metronome x2
#   f180  target shakes (52 toggles) and blends 0 -> 16/16 light green 0x33F2; 3 leaf geysers 14 f apart (explosion
#         column + leaves and cotton / apples shooting up)         -> f34, f39, f44 (done ~f50); green peaks f41
#   f241  columns done; the target stays green and shaking until f284
#                                                                  -> f50..54
#   f284  green and the dark stage fade back together              -> f55..63
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403
from _common import _RISE_X  # noqa: E402  CFRU's riser lanes (SpriteCB_Geyser x -4 / +13 / +4 / -16, drift)

# review 2026-11-19: the leaf geysers' risers are drawn here instead of by geyser(kind=...):
#  - GEYSER_RISE 'apple' draws APPLE at zoom 45 (18 px); CFRU's OVERGROWTH_APPLE_GEYSER is a 1:1 OAM_OFF_32x32
#    sprite of a 20 GBA px apple = 26 px (zoom 65), bigger than the leaves, as in CFRU;
#  - geyser(count=3, gap=5, rises=6) puts lane (riser + column) % 4: riser 5 of a column and riser 0 of the next
#    launch on the same frame in the same lane, so one particle a column sat exactly on another (here a leaf hid an
#    apple / spore). Ours uses lane (riser + 3 * column) % 4 (no collisions, each column starts one lane over);
#  - all risers are created after all puffs, so the leaves and apples read over the explosions (as in
#    specs/_fam_strike.py; CFRU draws them just behind the puffs, but there 3 columns would hide most of them).
RISER_ZOOM = {"tag:APPLE": 65}

# the target blend 0x33F2 (light green, #94FF62): TYPE_COLORS' formula tone [30, 190, -45] adds red too and turns
# warm sprites yellow; less red and blue keeps "turns light green" readable on most sprites
GREEN_TONE = [-30, 170, -60, 0]
# OVERGROWTH_SEEDS_UP: start offsets from the attacker (GBA px; 0x100D wraps to +13 and drifts right) and x drift
SEEDS_UP = [(-4, -16, -6), (13, -16, 10), (4, -12, 4), (-16, -16, -10)]
# OVERGROWTH_SEEDS_DOWN: where the 4 big seeds land (GBA px from the target centre); the 3rd is drawn behind it
SEEDS_DOWN = [(30, 20, False), (-30, 20, False), (3, 16, True), (-3, 24, False)]
# OVERGROWTH_GIANT_MUSHROOMS / TARTNESS_GIANT_APPLES: (x, y, behind) GBA px from the target centre
SPROUTS = [(30, 1, False), (-30, 1, False), (3, -3, True), (-3, 5, False)]


def leaf_risers(a, t0, kind, count=3, gap=5, rises=6, rise_life=6, rise_speed=16):
    """The typed risers of LEAVES_COTTON / LEAVES_APPLE_EXPLOSION_GEYSER (SpriteCB_Geyser: from target (x, +16)
    straight up 4 GBA px a GBA frame), the same motion as geyser()'s with the families of GEYSER_RISE[kind]
    alternating, RISER_ZOOM overrides and collision-free lanes (see the note above). Call after geyser(kind=None)."""
    fams = [(source_cells(a, src, frames=list(fr), **dict(opts)), RISER_ZOOM.get(src, zoom), blend)
            for src, fr, opts, zoom, blend in GEYSER_RISE[kind]]
    for g in range(count):
        tg = t0 + g * gap
        for j in range(rises):
            cells, zoom, blend = fams[j % len(fams)]
            rx, drift = _RISE_X[(j + 3 * g) % len(_RISE_X)]
            ts = tg + j
            x0, y0 = gba(rx, 16)
            s = a.sprite(cells, ts, ts + rise_life, focus="target", blend=blend, zoom=zoom)
            s.move(at_target(x0, y0), at_target(x0 + drift * 2 * rise_life, y0 - rise_speed * rise_life))
            s.fade(255, 255, t_from=0, t_to=rise_life - 2)
            s.fade(255, 0, t_from=rise_life - 2, t_to=rise_life)


def build_overgrowth(a, sheet, L, sprout_tag, sprout_zoom, geyser_kind, label):
    """The Max Overgrowth body. sprout_tag: the CFRU tag of the 4 giant sprouts ("MUSHROOM" / "GOLDEN_APPLE", both
    4 growing frames of 32x32, CFRU draws them 2x); sprout_zoom: their zoom (130 = CFRU's 2x x 1.3);
    geyser_kind: the GEYSER_RISE family of the leaf geysers ("grass" = leaf + cotton spore, "apple" = leaf + apple)."""
    begin(a, sheet, L)
    fade = L - 9                                         # f55: green and darkness fade back together
    seed = tag_cells(a, "SEED", frames=[0])              # Leech_Seed.png frame 0: the seed (not the sprouts)
    sprout = tag_cells(a, sprout_tag, frames=[0, 1, 2, 3])

    # --- opening: dark stage, flex, four small seeds popping off the attacker and out of the top of the screen
    dark_stage(a, 0, L - 1, fade_in=8, fade_out=L - 1 - fade)
    flex_end = dynamax_flex(a, 0)
    for i, (gx, gy, drift) in enumerate(SEEDS_UP):
        t = 1 + i                                        # CFRU 2 GBA f apart
        life = 6
        x0, y0 = gx * 1.5, -30 + gy                      # the upper body of the flexing x1.5 user (lift 12)
        s = a.sprite(seed, t, t + life, focus="user", zoom=60)
        v = min(15.0, (y0 + 98) / (life - 2))            # ~4 GBA px / GBA f; the last visible frame stays >= y -98
        s.move(at_user(x0, y0), at_user(x0 + drift, y0 - v * (life - 1)), t_to=life - 1)
        s.zoom(60, 110, t_from=0, t_to=3, ease="out")    # gSpriteAffineAnimTable_GrowingFist
        # the last frame is invisible: an enemy user's seed is far above the screen by then (it left the top a few
        # frames earlier), and the builder's preview cannot draw a graphic entirely above the field
        s.fade(255, 255, t_from=0, t_to=life - 2)
        s.key(life - 1, opacity=0)
    for k in range(2):
        se(a, 1 + 2 * k, "SE_M_HORN_ATTACK", volume=90)

    # --- four big seeds drop onto the target's feet (AnimRockTomb: from 64 px above, speed 3, 4, 5 ... per GBA f),
    # a thud as each lands; they stay until the sprouts have grown, then vanish together
    sprout_t = flex_end + 13                             # f28: CFRU f152, 24 GBA f after the last thud
    seeds_gone = sprout_t + 3
    for i, (gx, gy, behind) in enumerate(SEEDS_DOWN):
        t = flex_end + 3 * i                             # CFRU 16 GBA f apart
        land = at_target(*gba(gx, gy))
        s = a.sprite(seed, t, seeds_gone, focus="target", priority=2 if behind else 1, zoom=135)
        s.key(0, pos=(land[0], land[1] - gba(64)))
        s.key(2, pos=land, ease="in")                    # accelerating fall, landed on its 3rd frame
        se(a, t + 2, "SE_M_STRENGTH", volume=85)

    # --- the giant sprouts: four growing frames, one behind the target; CFRU holds them 45 GBA f, they vanish
    # while the first geyser bursts
    hit = sprout_t + 6                                   # f34: CFRU f180, 28 GBA f after the sprouts
    sprout_end = hit + 6
    for k in range(2):
        se(a, sprout_t + k, "SE_M_METRONOME", volume=90)
    for gx, gy, behind in SPROUTS:
        s = a.sprite(sprout, sprout_t, sprout_end, focus="target", priority=2 if behind else 1, loop=False,
                     pos=at_target(*gba(gx, gy)), zoom=sprout_zoom)

    # --- impact: the target shakes and turns light green while three leaf geysers burst on it; it stays green
    # (still shaking) after the columns, then the colour fades with the dark stage
    impact(a, hit, fade + 7, "grass", ramp=7, release=7, shake_end=fade, tone=GREEN_TONE)
    geyser(a, hit, None, type_="grass", count=3, gap=5)    # puffs (orange LIGHTBURN_EXPLODE) + SE per column
    leaf_risers(a, hit, geyser_kind, count=3, gap=5)

    name = sprout_tag.lower().replace('_', ' ')
    a.note(f"{label}: giant {name} sprouts at zoom {sprout_zoom} (CFRU's 2x would be 130): they "
           "stand around and in front of the target, so slightly smaller keeps its outline readable")
    a.note(f"{label}: SE_M_HORN_ATTACK x4 -> x2, SE_M_METRONOME x4 -> x2 (one sound per beat); the four "
           "SE_M_STRENGTH thuds are kept, one per landing seed")
    a.note(f"{label}: target tone {GREEN_TONE} instead of TYPE_COLORS grass [30, 190, -45]: the additive tone "
           "with +30 red turned warm sprites yellow; CFRU's 16/16 blend toward 0x33F2 is plainly light green")
    a.note(f"{label}: geyser risers drawn by leaf_risers() (specs/_fam_overgrowth.py): APPLE at zoom 65 (CFRU 1:1; "
           "GEYSER_RISE has 45), no lane collisions between columns, all risers in front of the puffs")
    a.note(f"{label}: CFRU's large seeds land 16 GBA f apart (5 frames); ours 3 frames apart so the sprouts follow "
           "quickly; the green tone peaks 7 frames after the first geyser and holds until the fade (as Max Strike)")
    return hit
