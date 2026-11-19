# Local fork (2026-11-19): the shared body of Max Mindstorm and G-Max Gravitas, rebuilt from CFRU ANIM_MAX_MINDSTORM /
# ANIM_G_MAX_GRAVITAS (Complete FireRed Upgrade, Skeli and the CFRU team; extract/ANIM_MAX_MINDSTORM.txt,
# extract/ANIM_G_MAX_GRAVITAS.txt). CFRU's Gravitas only re-tints the ring palettes (purple 0x5413 + sky blue 0x7FEE
# instead of purple + pinkish purple 0x7D3D) and then jumps to MAX_MINDSTORM_BEGIN, so the target flashes and blend
# stay 0x7D3D in both; both specs call mindstorm_body() with their two ring colours.
# CFRU beats (275 GBA f) -> ours (L = 60 frames):
#   f0    BG darkens 14/16 (29 f); Dynamax flex (72 f); a spinning Aura Sphere rises from the attacker 4 px/f and
#         leaves through the top of the screen (22 f); SE_WARP_IN
#                                                          -> dark f0..8, flex f0..14, sphere f0..9 (additive glow;
#                                                             it leaves the screen sooner for an enemy user, who
#                                                             stands near the top, as in CFRU), SE f0
#   f72   24 rings (pink/purple pairs 2 f apart, a pair every 4 f) fall from 90 px above the attacker onto the
#         target's feet (0, +20) in 21 f each, growing 1.5x; SE_M_PSYBEAM2 x10 11 f apart
#                                                          -> f11..24: 10 rings in CFRU's pairs (1 frame apart, a
#                                                             pair every 3 frames), 7 frames each (last lands f30),
#                                                             falling straight down onto the target's feet (see the
#                                                             note: one file plays for both sides); Psywave x2
#   f80   (after the 4th ring) target sways 8 px for 6 half-cycles (to f176, into the shake) and flashes 0x7D3D
#         12/16 4 times (f80-152)                          -> sway f13..38 (3 cycles, under the shake from f26),
#                                                             4 flashes (peaks f14/f17/f20/f23)
#   f130  target shakes vertically (56 toggles) and blends to 0x7D3D (1 step / 4 f); 3 MINDSTORM_GEYSERs 14 f apart
#         (orange explosion column + sky-blue needles shooting up); they start before the last rings land
#                                                          -> shake f26..51, tone peaks f34 and holds; geysers f26,
#                                                             f31, f36 (geyser(kind="psychic")), done by f47
#   f242  colour and darkening fade back (2 f steps)      -> f51..58 tone, f51..59 dark stage
import math
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403

__all__ = ["mindstorm_body", "MINDSTORM_L", "RING_PINK", "RING_PURPLE", "RING_SKY", "se_file"]

MINDSTORM_L = 60
CHEST_REST = -14           # the x1.5 user's visual centre at rest (_STYLE.md section 3)

# GOLD_RING (vanilla FireRed, missing from the download) is the 16x32 edge-on Supersonic ring. PRAS- Psybeam holds
# the same 16x32 edge-on ring in four colours (blue, violet, purple, pink), closer than the SUBS round Healing Wish
# rings. (source, frames, opts) per CFRU ring colour:
# (review 2026-11-19: CFRU's purple is the gold palette 12/16 toward #9C00AC, a plum purple (hue ~300); ring 1 of
# the sheet (115, 0, 255) read blue-violet, so the purple ring is now ring 2 (181, 0, 247); the sky ring is paler,
# closer to CFRU's pink-petal palette 10/16 toward #73FFFF, about (165, 219, 240))
RING_PINK = ("pr:PRAS- Psybeam", [3], {})           # PINK_PETAL palette 7/16 toward 0x7D3D (pinkish purple)
RING_PURPLE = ("pr:PRAS- Psybeam", [2], {})         # GOLD_RING 12/16 toward 0x5413 (purple)
RING_SKY = ("pr:PRAS- Psybeam", [0], {"hue": -45, "tint": (165, 219, 240, 0.7)})   # 10/16 toward 0x7FEE (sky blue)

# the sphere's height above its start per frame: a short launch, then CFRU's speed
SPHERE_RISE = [0, 6, 16, 30, 48, 66, 84, 102, 120, 138]
# the rings start 76 px above the target centre: just above the top edge for the player's target (each ring is in
# view from its 2nd frame: at -100 only the last 3-4 of its 7 frames showed and the rain read as a short pile on
# the target), about 44 px above the head of an enemy user's target (the player; the ring fades in on its first
# frame), and fall 17 px a frame. (Starting much higher crashes maxanim's preview renderer, which cannot draw a
# normal-blend sprite lying wholly above the top edge; the game itself would not mind.)
RING_TOP = -76

# a little sideways jitter so consecutive rings read as separate (CFRU drops all of them on one line)
RING_DX = [0, 4, -4, 2, -2, 5, -5, 1, -3, 3, -1, 4, -4]


def se_file(a, t, file, volume=100, pitch=100):
    """A sound file that the shared SE table does not map (same checks as _common.se: the file must exist; a
    report note when it is over 1.6 s)."""
    if not os.path.exists(os.path.join("D:/PokeRogueDev/pokerogue/assets/audio/battle_anims", file)):
        raise FileNotFoundError(f"{file} is not in assets/audio/battle_anims")
    secs = sound_secs(file)
    if secs is not None and secs > 1.6:
        a.note(f"se_file: '{file}' is {secs:.2f} s: about {secs / 2:.1f} s of end hold")
    a.sound(t, file, volume=volume, pitch=pitch)
    return t


def mindstorm_body(a, sheet, ring_a, ring_b, L=MINDSTORM_L, label=""):
    """Max Mindstorm's choreography; ring_a / ring_b = (source, frames, opts) of the two alternating ring colours
    (CFRU launches ring_a first in every pair)."""
    begin(a, sheet, L)
    fade = L - 9                                   # f51: CFRU f242

    sphere = cfru_cells(a, "Aura_Sphere.png")
    rings = [source_cells(a, src, frames=list(fr), **dict(opts))[0] for src, fr, opts in (ring_a, ring_b)]

    # --- opening: dark stage, flex, the Aura Sphere shot up off the top of the screen
    dark_stage(a, 0, L - 1, fade_in=8, fade_out=8)
    flex_end = dynamax_flex(a, 0)
    se(a, 0, "SE_WARP_IN")
    life = 10
    s = a.sprite(sphere, 0, life, focus="user", blend="add")
    for k in range(life):
        # CFRU: 4 GBA px a frame up (about 16-18 anim px a frame here, after a short launch), wobbling sideways,
        # spinning 10/frame
        s.key(k, pos=at_user(3 * math.sin(k * 1.3), CHEST_REST - 2 - SPHERE_RISE[k]), angle=-30 * k, zoom=65 + 2 * k)
    s.key(0, opacity=200)
    s.key(1, opacity=255)

    # --- the ring rain: CFRU's pairs (ring_a, then ring_b 2 GBA f later; a pair every 4 GBA f) as pairs 1 frame
    # apart, a pair every 3 frames, straight down onto the target's feet, growing 1x -> 1.5x (GrowingRing). (Review
    # 2026-11-19: one ring every frame on this short vertical path stacked 4-5 overlapping rings into a tangle on
    # the target; the pair rhythm keeps CFRU's doubled rings and leaves a gap between pairs.) A ring fades in during
    # its first frame: for an enemy user the start point is on screen (above the player), for the player user it
    # is just above the top edge.
    t_ring = flex_end - 4                          # f11: as the flex starts to snap back
    ring_life = 7                                  # CFRU: 21 GBA f each
    starts = [3 * p + m for p in range(5) for m in (0, 1)]   # f11, 12, 14, 15, ... 23, 24: 10 of CFRU's 24 rings
    for i, dt in enumerate(starts):
        t = t_ring + dt
        dx = RING_DX[i % len(RING_DX)]
        r = a.sprite(rings[i % 2], t, t + ring_life, focus="target")
        r.move(at_target(dx, RING_TOP), at_target(dx * 0.4, gba(20)), t_to=ring_life - 1)
        r.zoom(120, 185, t_to=ring_life - 1)
        r.key(0, opacity=110)
        r.key(1, opacity=255)
        r.key(ring_life - 2, opacity=255)
        r.key(ring_life - 1, opacity=170)
    se_file(a, t_ring, "PRSFX- Psywave.wav", volume=90)
    se_file(a, t_ring + 7, "PRSFX- Psywave.wav", volume=85, pitch=106)

    # --- after the 4th ring: the target sways sideways 8 GBA px for 3 cycles and flashes pinkish purple 4 times.
    # CFRU's sway (f80-176) runs on into the vertical shake of the geysers (from f130), so ours does too: f13..38,
    # about 8 frames a cycle (13 frames for all three read as a jitter, not a sway); the shake adds on top
    t_sway, t_hit = t_ring + 2, t_ring + 15        # f13, f26
    span = 25                                      # to f38
    for k in range(span + 1):
        a.target.key(t_sway + k, pos=(gba(8) * math.sin(2 * math.pi * 3 * k / span), 0))
    flash = tone_for("psychic", 0.75)              # 12/16
    for j in range(4):                             # AnimTask_pal_fade_complex: 4 flashes, 3 frames apart
        f0 = t_sway + 3 * j
        a.target.key(f0, tone=[0, 0, 0, 0])
        a.target.key(f0 + 1, tone=flash, ease="out")
    a.target.key(t_sway + 12, tone=[0, 0, 0, 0], ease="in")

    # --- impact: vertical shake + slow blend to 0x7D3D, three needle geysers; the colour holds to the fade
    impact(a, t_hit, fade + 7, "psychic", ramp=8, release=7, shake_end=fade)
    geyser(a, t_hit, "psychic", type_="psychic", count=3, gap=5)

    a.note(f"{label}: the rings fall straight down onto the target instead of from 90 px above the attacker: one "
           f"file plays for both sides, and a USER_TARGET path flips its y for an enemy user (the rings would rise "
           f"from below it), so the rain is written around the target")
    a.note(f"{label}: GOLD_RING (missing vanilla particle) -> PRAS- Psybeam's 16x32 edge-on ring (the same shape and "
           f"size) in the CFRU colours; 10 of CFRU's 24 rings, in its pairs (1 frame apart, a pair every 3 frames)")
    a.note(f"{label}: the Aura Sphere is drawn additively (a glowing energy ball; CFRU draws it plainly)")
    a.note(f"{label}: the target sways f13..38, 3 cycles (CFRU's AnimTask_SwayMon runs on under the geyser shake), "
           f"with CFRU's 4 pinkish-purple flashes (AnimTask_pal_fade_complex) at f13..24")
    a.note(f"{label}: SE_M_PSYBEAM2 x10 -> PRSFX- Psywave.wav x2 (Psybeam.wav is 1.63 s: 0.82 s of end hold; the "
           f"shared SE table has no Psywave entry, so se_file() checks the file)")
    return fade
