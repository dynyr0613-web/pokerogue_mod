# Local fork (2026-11-19): the Max Geyser family body, shared by specs/max_geyser.py, specs/g_max_foam_burst.py and
# specs/g_max_cannonade.py. Rebuilt from CFRU ANIM_MAX_GEYSER / ANIM_G_MAX_FOAMBURST / ANIM_G_MAX_CANNONADE_MOVE
# (Complete FireRed Upgrade, Skeli and the CFRU team; extract/ANIM_MAX_GEYSER.txt and the two variants).
#
# CFRU structure (all three):
#   dark stage + Dynamax flex; 8 LARGE_BUBBLES (the vanilla small-bubble pair, ICE_CRYSTALS tiles) wobble up on the
#   attacker 4 f apart with SE_M_CRABHAMMER; then the attack proper (Geyser / Foam Burst: a 72 f stream of 36
#   hydro-pump balls + 6 bubble shots; Cannonade: 8 volleys of 3 balls arcing from the cannon positions + 1 bubble
#   shot), 7 small bubbles bursting off the target after every pair / volley, the target shaking vertically; the
#   finish is a big glowing orb (CIRCLE_OF_LIGHT drawn with the WATER_IMPACT palette) on the target with 9 bursts of
#   7 bubbles (SE_M_SELF_DESTRUCT + SE_M_CRABHAMMER each), then the BG comes back.
# Foam Burst = Geyser with HYDRO_PUMP and WATER_IMPACT tinted 10/16 toward white (0x7FFF): `ball_tint` / `orb_rgb`.
#
# Stand-ins (the vanilla particles are not in the CFRU download):
#   LARGE_BUBBLES (ICE_CRYSTALS bubble-pair frames) -> a pair: 'PRAS- Water' 36 (rainbow-sheen bubble) + 28 (small
#       pale bubble). SUBS["ICE_CRYSTALS"] is the crystal reading of that sheet, wrong for this template.
#   SMALL_BUBBLES -> SUBS (PRAS- Water 28, then the 33 pop) for the drifting bubbles; 36 for the bubble shot.
#       2026-11-19 review: 28 is lavender, which read purple on the dark stage; tinted to a pale water blue.
#   GEYSER_EXPLOSION (CIRCLE_OF_LIGHT tiles drawn with the WATER_IMPACT palette, an opaque OBJ: CFRU moves the target
#       to the BG layer so it covers the target) -> 2026-11-19 review: 'PRAS- Oceanic Operetta' 0 (PokeRogue's shaded
#       water sphere) tinted 4/10 toward the WATER_IMPACT blue, normal blend. The shared CIRCLE_OF_LIGHT stand-in
#       (PRAS- Strike 26) tinted blue is a flat disc, and additive it turned the target white instead of covering it.
#   HYDRO_PUMP -> the CFRU file itself (Hydro_Pump.bmp, a 16 px water ball; HydroCannonBall affine grows it 2x).
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _common import *  # noqa: E402,F403

# the WATER_IMPACT palette's mid blue (the orb colour); Foam Burst blends it 10/16 toward white
WATER_ORB = (70, 150, 255)
FOAM_K = 10 / 16
# the orb: PokeRogue's shaded water sphere, a little toward the WATER_IMPACT blue (its own blue is (100, 146, 232))
ORB_SRC = ("pr:PRAS- Oceanic Operetta", 0)
ORB_TINT = (WATER_ORB[0], WATER_ORB[1], WATER_ORB[2], 0.4)
# a.cells(tint=) pulls toward rgb x (0.35 + 0.9 x luminance), which darkens a white target on mid-tone art (a 10/16
# blend toward (255, 255, 255) gave grey-lavender foam); channel values above 255 approximate the GBA's linear
# BlendPalette toward white while keeping the shading (checked by eye on the ball and the sphere)
FOAM_WHITE = (300, 320, 340)
# SMALL_BUBBLES: the lavender 'PRAS- Water' 28 pulled toward a pale water blue (vanilla small bubbles are white-blue)
BUBBLE_TINT = (200, 235, 255, 0.55)


def toward_white(rgb, k=FOAM_K):
    return tuple(int(round(c + (255 - c) * k)) for c in rgb)


# CFRU LARGE_BUBBLES args (GBA px from the attacker centre; x mirrored by CFRU for an opponent attacker, ours are
# "user" focus offsets, so they keep screen directions on both sides: the set is roughly symmetric anyway)
FLEX_BUBBLES = [(10, 10), (-15, 0), (20, 10), (0, -10), (-10, 15), (25, 20), (-20, 20), (12, 0)]
# MAX_GEYSER_BUBBLES_ON_TARGET x offsets (y 0) and MAX_GEYSER_EXPLOSION_BUBBLES (x, y), GBA px from the target centre
TARGET_BUBBLES = [(0, 0), (5, 0), (10, 0), (15, 0), (-5, 0), (-10, 0), (-15, 0)]
EXPLOSION_BUBBLES = [(0, 0), (5, 5), (10, 10), (15, -10), (-5, 5), (-10, 10), (-15, -10)]
# G-Max Cannonade: CFRU fires from the DPE G-Max Blastoise cannon positions, (-10,-10) (15,-2) (17,5) for a player
# attacker with arc amplitudes -20 / -20 / +10 (two up, one down), and (-18,-20) (9,-10) (12,9) with 20 / -20 / 5
# for an opponent attacker. One file plays for both sides here, and USER_TARGET offsets flip x AND y for an enemy
# user, so the muzzles sit near the focus height (inside the x1.5 body either way: player 8-22 px below its visual
# centre, enemy 10-24 px below; any y shift helps one side by what it costs the other, since the visual centre is 16
# px above the focus on both) and spread along x (behind / front stays behind / front when mirrored); the arc
# heights flip too, which turns CFRU's player fan (up, up, down) into its opponent fan (down, down, up).
CANNONS = [((-14.0, -8.0), 21), ((18.0, -4.0), 14), ((24.0, 6.0), -12)]

# the x1.5 user's visual centre is 16 px above its graphic focus at rest, 28 px at the flex peak (lift 12, 125 %)
REST_Y, PEAK_Y = -16.0, -28.0


def _flex_track(t):
    """(centre y, scale) of the flexing user at frame t (dynamax_flex at f0 with the FLEX defaults)."""
    g, h, s = FLEX["grow"], FLEX["hold"], FLEX["shrink"]
    pk = FLEX["peak"] / 100
    if t <= 0:
        u = 0.0
    elif t < g:
        u = 1 - (1 - t / g) ** 2          # ease out
    elif t <= g + h:
        u = 1.0
    elif t < g + h + s:
        u = 1 - ((t - g - h) / s) ** 2    # ease in
    else:
        u = 0.0
    return REST_Y + (PEAK_Y - REST_Y) * u, 1 + (pk - 1) * u


def make_cells(a, ball_tint=None, orb_tint=ORB_TINT):
    """Sheet cells for the family: ball, the bubble pair, drifting bubble + pop, the orb (a 70 px sphere)."""
    opts = {"tint": ball_tint} if ball_tint else {}
    c = {
        "ball": tag_cells(a, "HYDRO_PUMP", frames=[0], **opts)[0],
        "bubble": a.cells("pr:PRAS- Water", frames=[36])[0],          # rainbow-sheen bubble, 24 px
        # [pale blue 16 px bubble, its pop]
        "small": (sub_cells(a, "SMALL_BUBBLES", frames=[0], tint=BUBBLE_TINT)
                  + sub_cells(a, "SMALL_BUBBLES", frames=[1])),
        "orb": a.cells(ORB_SRC[0], frames=[ORB_SRC[1]], **({"tint": orb_tint} if orb_tint else {})),
    }
    return c


def flex_bubbles(a, c, t0=1, life=8, sounds=(1, 7)):
    """CFRU f5-58: 8 LARGE_BUBBLES on the attacker, 4 GBA f apart, each wobbling sideways (sin, 4 GBA px) and rising
    slowly (48/256 px a GBA frame) for 25 f, SE_M_CRABHAMMER with each. Ours: 8 bubble pairs ~1.3 frames apart,
    8 frames each, riding the flex (centre and spread follow the user's lift and growth)."""
    for i, (gx, gy) in enumerate(FLEX_BUBBLES):
        ts = t0 + round(i * 4 / 3)
        big = a.sprite(c["bubble"], ts, ts + life, focus="user", opacity=230)
        small = a.sprite(c["small"][0], ts, ts + life, focus="user", opacity=220)
        for k in range(life):
            cy, sc = _flex_track(ts + k)
            ph = math.radians(11 * 3 * k * 360 / 256)
            wob = 5 * math.sin(ph)
            rise = 0.6 * k * 1.3
            x = gx * 1.6 * sc + wob
            y = cy + gy * 1.6 * sc - rise
            z = 85 if k else 50
            big.key(k, pos=(x, y), zoom=z)
            small.key(k, pos=(x + 9, y - 9), zoom=55 if k else 30)
        big.fade(230, 0, t_from=life - 2, t_to=life - 1)
        small.fade(220, 0, t_from=life - 2, t_to=life - 1)
    for t in sounds:
        se(a, t, "SE_M_CRABHAMMER", volume=80)


def drift_bubbles(a, c, t, spots, life=5, seed=0, speed=(3.5, 6.5), zoom=70, keep=None):
    """Template_SmallDriftingBubbles (vanilla AnimSmallDriftingBubbles): small bubbles appear at target + spot and
    drift off in random directions (mostly up and out) for 21 GBA f, then vanish. Ours: `life` frames with the pop
    cell on the last one; directions from a seeded RNG so the build is stable. `keep` = how many of the spots."""
    rnd = random.Random(seed)
    # keep: an even spread across x, both ends included (CFRU's sets run x -15..+15)
    by_x = sorted(spots)
    picks = spots if keep is None else [by_x[round(i * (len(by_x) - 1) / max(1, keep - 1))] for i in range(keep)]
    bub, pop = c["small"]
    for gx, gy in picks:
        ang = math.radians(rnd.uniform(200, 340) if rnd.random() < 0.8 else rnd.uniform(-20, 200))
        sp = rnd.uniform(*speed)
        x0, y0 = at_target(*gba(gx, gy))
        x0 += rnd.uniform(-3, 3)
        y0 += rnd.uniform(-3, 3)
        s = a.sprite([bub] * (life - 1) + [pop], t, t + life, focus="target", loop=False, zoom=zoom)
        s.move((x0, y0), (x0 + math.cos(ang) * sp * (life - 1), y0 + math.sin(ang) * sp * (life - 1)),
               ease="out", t_to=life - 1)
        s.key(life - 1, zoom=zoom * 0.8)


def stream(a, c, t0, t1, flight=8, seed=1):
    """CFRU MAX_GEYSER_SHOT x18 (f88-158): pairs of hydro-pump balls, 2 GBA f apart, every 4 f, flying straight from
    the attacker to the target in 25 f (AnimShadowBall) and growing to 2x (HydroCannonBall affine). Ours: one ball a
    frame over [t0, t1), `flight` frames each (landing on the last visible frame), a few px of alternating spread so
    the stream has some body. USER_TARGET: mirrored for an enemy user (the ball is round)."""
    rnd = random.Random(seed)
    for i, t in enumerate(range(t0, t1)):
        j = (-3.0, 3.0, 0.0)[i % 3]
        start = (2.0 + rnd.uniform(-2, 2), j * 0.6)
        end = (128.0 + j + rnd.uniform(-3, 3), -64.0 - j + rnd.uniform(-3, 3))
        s = a.sprite(c["ball"], t, t + flight, focus="user_target")
        s.move(start, end, t_to=flight - 1)
        s.key(0, zoom=50)
        s.key(flight - 1, zoom=118, ease="out")


def bubble_shots(a, c, times, flight=8, heights=(6, -5, 9, -7, 4, -9)):
    """CFRU GEYSER_BUBBLE_SHOT (SMALL_BUBBLES tile, AnimShadowBall, 25 f to the target), every 12 GBA f in Geyser,
    once in Cannonade. Ours: the rainbow bubble, slightly curved so it reads beside the straight stream."""
    for i, t in enumerate(times):
        s = a.sprite(c["bubble"], t, t + flight, focus="user_target", opacity=235)
        s.arc((0.0, 2.0), (126.0, -62.0), height=heights[i % len(heights)], t_to=flight - 1)
        s.key(0, zoom=70)
        s.key(flight - 1, zoom=110)


def cannon_volleys(a, c, t0, volleys=8, gap=2, flight=6, muzzle=True):
    """CFRU MAX_CANNONADE_SHOT x8 (f88-130): 3 balls from the cannon positions, 2 GBA f apart, arcing to the target in
    14 f (SpriteCB_CannonadeBall); volleys 6 GBA f apart. Ours: volleys `gap` frames apart, shots at +0 / +0 / +1,
    `flight` frames each, landing spread a little per volley. `muzzle`: a small splash where each ball leaves (ours,
    so the cannons read; CFRU shows none). Returns the frame the last ball lands."""
    pop = a.cells("pr:PRAS- Water", frames=[33, 34]) if muzzle else None   # white burst, then its splash ring
    last = t0
    for v in range(volleys):
        tv = t0 + v * gap
        for k, ((sx, sy), h) in enumerate(CANNONS):
            ts = tv + (0, 0, 1)[k]
            end = (128.0 + (-6, 4, 8, -3)[(v + k) % 4], -64.0 + (3, -5, 2, -2)[(v + 2 * k) % 4])
            hh = h + (-3, 1, 0, -1)[(v + k) % 4]
            s = a.sprite(c["ball"], ts, ts + flight, focus="user_target")
            s.arc((sx, sy), end, height=hh, t_to=flight - 1)
            s.key(0, zoom=55)
            s.key(flight - 1, zoom=105, ease="out")
            if muzzle:  # created after the ball so the flash is on top of it (under it, frame 0 was hidden)
                a.sprite(pop, ts, ts + 2, focus="user_target", loop=False, pos=(sx, sy), zoom=80, opacity=235)
            last = max(last, ts + flight - 1)
    return last


def finale(a, c, t0, bursts=6, gap=2, keep=5, grow=5, hold=13, shrink=5, size=140, opacity=220, sounds=True):
    """CFRU f160 (Geyser) / f136 (Cannonade): GEYSER_EXPLOSION, the big WATER_IMPACT-coloured orb on the target
    (grows in 15 f, holds 48, shrinks in 15; an opaque OBJ over the target, which CFRU moved to the BG layer), with 9
    MAX_GEYSER_EXPLOSION_BUBBLES bursts 5 f apart (7 bubbles, SE_M_SELF_DESTRUCT + SE_M_CRABHAMMER each). Ours:
    big_orb 5 + 13 + 5 frames with the 70 px water sphere (size 140 = about 98 px, its top stays on screen; normal
    blend, opacity 220 so the target shows faintly through), `bursts` bursts of `keep` bubbles `gap` frames apart,
    the explosion SE on every 2nd burst and one crabhammer. Returns the frame the orb ends."""
    end = big_orb(a, t0, cells=c["orb"], size=size, grow=grow, hold=hold, shrink=shrink, blend="normal",
                  opacity=opacity)
    for b in range(bursts):
        drift_bubbles(a, c, t0 + 1 + b * gap, EXPLOSION_BUBBLES, life=6, seed=100 + b, speed=(4.0, 7.0),
                      zoom=85, keep=keep)
    if sounds:
        for i in range(0, bursts, 2):
            se(a, t0 + i * gap, "SE_M_SELF_DESTRUCT", volume=95 if i else 100, pitch=100 + 4 * i)
        se(a, t0 + 3, "SE_M_CRABHAMMER", volume=85)
    return end


def build_geyser(a, sheet, L=61, ball_tint=None, orb_tint=ORB_TINT, tone=None, cannon=False):
    """The whole family. Geyser / Foam Burst: L 61 (stream f15-34, orb f36). Cannonade: L 59 (volleys f15-30, orb
    f33). `tone` = the target's peak battler tone (CFRU has no target blend in any of the three)."""
    begin(a, sheet, L)
    c = make_cells(a, ball_tint=ball_tint, orb_tint=orb_tint)
    fade = L - 9  # the dark stage and the target colour fade back together (CFRU f304 / f266)

    # --- opening: dark stage, flex, the bubble pairs on the attacker
    dark_stage(a, 0, L - 1, fade_in=8, fade_out=8)
    flex_end = dynamax_flex(a, 0)
    flex_bubbles(a, c, t0=1)

    # --- the attack: SE_M_HYDRO_PUMP, then the stream (Geyser) or the cannon volleys (Cannonade)
    se(a, flex_end, "SE_M_HYDRO_PUMP")
    if cannon:
        flight = 6
        last = cannon_volleys(a, c, flex_end, volleys=8, gap=2, flight=flight)
        hit = flex_end + flight - 1
        bubble_shots(a, c, [flex_end + 12], heights=(8,))
        for v in range(8):  # MAX_GEYSER_BUBBLES_ON_TARGET after every volley (as its balls land)
            drift_bubbles(a, c, flex_end + v * 2 + flight - 1, TARGET_BUBBLES, seed=10 + v, keep=3)
        orb_t = last - 2
    else:
        flight = 8
        stream(a, c, flex_end, flex_end + 20, flight=flight)
        bubble_shots(a, c, [flex_end + 4 * i for i in range(6)], flight=flight)
        se(a, flex_end + 12, "SE_M_HYDRO_PUMP", volume=90)  # CFRU's second SE_M_HYDRO_PUMP (f124)
        hit = flex_end + flight - 1
        for k, t in enumerate(range(hit, flex_end + 20, 2)):  # MAX_GEYSER_BUBBLES_ON_TARGET after every pair
            drift_bubbles(a, c, t, TARGET_BUBBLES, seed=10 + k, keep=4)
        orb_t = flex_end + 21

    # --- the target shakes from the first hit until the BG fade, with a soft tone (CFRU: no target blend)
    impact(a, hit, fade + 7, "water", tone=tone, k=0.5, ramp=6, release=7, shake_end=fade)

    # --- the big water orb and the bubble bursts
    end = finale(a, c, orb_t)
    a.note("Stand-ins: LARGE_BUBBLES (vanilla ICE_CRYSTALS bubble-pair frames) -> 'PRAS- Water' 36 + 28 as a pair; "
           "SMALL_BUBBLES -> 'PRAS- Water' 28 tinted pale water blue (it is lavender) + the 33 pop; GEYSER_EXPLOSION "
           "(CIRCLE_OF_LIGHT with the WATER_IMPACT palette, opaque over the target) -> 'PRAS- Oceanic Operetta' 0, "
           "PokeRogue's shaded water sphere, normal blend at opacity 220 (the shared CIRCLE_OF_LIGHT stand-in tinted "
           "blue was a flat disc that, additive, turned the target white)")
    if end > L - 1:
        raise ValueError(f"orb ends at f{end}, after the last frame f{L - 1}")
    return {"flex_end": flex_end, "hit": hit, "orb": orb_t, "orb_end": end, "fade": fade}
