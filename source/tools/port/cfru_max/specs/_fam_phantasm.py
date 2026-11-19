# Local fork (2026-11-19): the shared body of Max Phantasm and G-Max Terror, rebuilt from CFRU ANIM_MAX_PHANTASM /
# ANIM_G_MAX_TERROR (Complete FireRed Upgrade, Skeli and the CFRU team; extract/ANIM_MAX_PHANTASM.txt,
# extract/ANIM_G_MAX_TERROR.txt). CFRU's Terror is a copy of Phantasm's script (pink objects, flex, royal-blue NEN
# geysers) followed by the vanilla Mean Look eye tinted red, so both specs call phantasm_body(); Terror adds
# mean_look_eye(). Group g3 file (specs/max_phantasm.py, specs/g_max_terror.py); the beat tables are in the specs.
#
# - haunted_objects(): PHANTASM_OBJ_1..5 (SpriteCB_MaxPhantasmObject): a rock, the Assurance hand, a log, an anchor
#   (Anchor.png drawn with the CHAIN_LINK palette, as the template does) and a razor shell, all tinted 10/16 toward
#   0x7CBF (pink). Each grows from 1/16 at its spot round the attacker during the flex, arcs (amplitude 40) to its
#   spot round the target when the flex ends (SE_M_SAND_ATTACK), waits 16 GBA f (SE_M_STRENGTH) and slams into the
#   target centre at 8 px/f.
#   They travel between the battlers, so they are USER_TARGET sprites, and a USER_TARGET offset is mirrored through
#   the user's focus point for an enemy user (x and y). CFRU's start cluster is centred 8 / 10 GBA px up-left of
#   the attacker; ours is that cluster moved onto the focus point, so it surrounds the attacker on either side (the
#   five objects only trade places). Arc heights are kept low (they bulge down for an enemy user, style section 4).
# - mean_look_eye(): gMeanLookEyeSpriteTemplate (vanilla Mean Look's eye; CFRU's Mean_Look.png) tinted 8/16 toward
#   0x001F: fades in pulsing, shrinks, reappears, jitters, fades out (~130 GBA f).
# - gba_tag_cells(): every CFRU particle tint here (objects 10/16 pink, NEN hexes 10/16 royal blue, eye 8/16 red) is
#   baked as the GBA's BlendPalette does it, c + (t - c) * k/16 per channel. (2026-11-19 review: the builder's tint=
#   scales the tint colour by pixel brightness, which left the dark rock and log a dull mauve, the hexes maroon and
#   the eye a dim maroon; CFRU's blend makes them bright pink, royal purple and red.)
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _common import *  # noqa: E402,F403
import _common  # noqa: E402  (_load_tags: the CFRU tag -> (file, palette) table behind tag_cells)

PINK = EXTRA_COLORS["pink_hot"]          # 0x7CBF, AnimTask_BlendParticle 10/16
EYE_RED = EXTRA_COLORS["pure_red"]       # 0x001F, AnimTask_BlendParticle ANIM_TAG_EYE 8/16
ROYAL_BLUE = EXTRA_COLORS["royal_blue"]  # 0x5C05, AnimTask_BlendParticle ANIM_TAG_VERTICAL_HEX 10/16
HEX_ZOOM = 75                            # GEYSER_RISE["ghost"]'s size: a 16 px hex at scale 2 -> 24 px


def gba_tag_cells(a, tag, frames, color, coeff, palette=None):
    """Cells of a CFRU ANIM_TAG (its file, palette pair and frame size, scale 2 up to 48 px frames else 1, as
    tag_cells picks them) blended `coeff`/16 toward `color` exactly like the GBA's BlendPalette."""
    sys.path.insert(0, os.path.dirname(HERE))
    from maxanim import make_cell   # the builder's own cell maker (same source, scale and transparency)
    img_file, pal = _common._load_tags()[tag]
    pal = palette or pal
    w, h = cfru_info(img_file)["frame_size"]
    out = []
    for f in frames:
        img = make_cell("cfru:" + img_file, f, size=(w, h), scale=2 if max(w, h) <= 48 else 1, palette=pal)
        px = img.load()
        for j in range(img.height):
            for i in range(img.width):
                r, g, b, al = px[i, j]
                if al:
                    px[i, j] = tuple(round(c + (t - c) * coeff / 16) for c, t in zip((r, g, b), color)) + (al,)
        out.append(a.cell_image(img))
    return out

# (tag, palette override, CFRU start offset round the attacker, CFRU end offset round the target), GBA px
OBJECTS = [
    ("ROCKS", None, (-30, -40), (30, -10)),
    ("ASSURANCE_HAND", None, (-40, -10), (0, -30)),
    ("WOOD", None, (-30, 20), (20, 10)),
    ("ANCHOR", "Chain_Link.png", (30, -25), (-20, 10)),   # PHANTASM_OBJ_4: ANCHOR tiles, CHAIN_LINK palette
    ("RAZOR_SHELL", None, (30, 5), (-30, -10)),
]
START_CENTROID = (-8, -10)        # mean of the five CFRU start offsets (moved onto the user's focus point)
START_SCALE = (1.6, 1.0)          # GBA px -> anim px round the x1.5 Dynamax user (wider; low enough for the feet)
ARC_HEIGHTS = [18, 12, 8, 20, 14]  # CFRU: amplitude 40 for all; varied and kept low (USER_TARGET y flips)
OBJ_ZOOM = 70                     # a 32 px particle at scale 2: GBA size x ~1.4

# sounds the CFRU sprite callbacks play that _common.SE does not map (reported 2026-11-19); existing game files
_EXTRA_SE = {"SE_M_SAND_ATTACK": "PRSFX- Sand Attack.wav"}   # 1.14 s


def se_extra(a, t, name, volume=100, pitch=100):
    """se() for GBA SE names that _common.SE lacks (_EXTRA_SE); a.sound() raises if the file does not exist."""
    if name in SE:
        return se(a, t, name, volume=volume, pitch=pitch)
    f = _EXTRA_SE[name]
    secs = sound_secs(f)
    if secs is not None and secs > 1.6:
        a.note(f"se_extra: {name} -> '{f}' is {secs:.2f} s: about {secs / 2:.1f} s of end hold")
    a.sound(t, f, volume=volume, pitch=pitch)
    return t


def haunted_objects(a, t0, launch, arc=7, wait=3, slam=2, grow=8):
    """The five pink objects: grow at the attacker from t0 (grow frames), hover until `launch` (the flex end), arc to
    the target in `arc` frames, wait, slam into its centre in `slam` frames and vanish. Returns the slam end (the
    frame the geysers start)."""
    arrive = launch + arc
    hit = arrive + wait + slam
    se_extra(a, launch, "SE_M_SAND_ATTACK", volume=90)
    se(a, arrive, "SE_M_STRENGTH", volume=100)
    cx, cy = START_CENTROID
    sx, sy = START_SCALE
    for i, (tag, pal, (x0, y0), (x1, y1)) in enumerate(OBJECTS):
        cell = gba_tag_cells(a, tag, [0], PINK, 10, palette=pal)
        start = ((x0 - cx) * sx, (y0 - cy) * sy)
        spot = (128 + gba(x1), -64 + gba(y1))
        s = a.sprite(cell, t0, hit, focus="user_target")
        s.key(0, pos=start, zoom=OBJ_ZOOM / 16)
        s.key(grow, pos=start, zoom=OBJ_ZOOM, ease="out")       # gSpriteAffineAnimTable_GrowToNormalSize
        s.arc(start, spot, height=ARC_HEIGHTS[i], t_from=launch - t0, t_to=arrive - t0)
        s.key(arrive - t0 + wait, pos=spot)
        s.key(hit - t0 - 1, pos=(128, -64), ease="in")         # the slam: last visible frame on the target centre
    return hit


def phantasm_body(a, name, L, tone_fade, bg_fade_out=8):
    """The Max Phantasm body: dark stage, flex, haunted objects, then from the slam the target shakes and turns royal
    blue while three NEN geysers burst on it. The blue (and the shake) hold until `tone_fade`, then the colour
    returns over 7 frames; the dark stage fades out over the last `bg_fade_out` frames (ending at L - 1).
    Returns (hit, geyser_end)."""
    begin(a, name, L)
    dark_stage(a, 0, L - 1, fade_in=8, fade_out=bg_fade_out)
    se(a, 0, "SE_M_NIGHTMARE", volume=100)
    flex_end = dynamax_flex(a, 0)
    hit = haunted_objects(a, 0, flex_end)
    impact(a, hit, tone_fade + 7, "ghost", ramp=8, release=7, shake_end=tone_fade)
    # NEN_GEYSER_HEX: Arrows.png's hex (all 9 frames are the same picture, so one cell) with the Fusion_Flare
    # palette, blended 10/16 toward royal blue: a purple hex with a lighter rim (GEYSER_RISE["ghost"] bakes the
    # same tint through tint=, which comes out near-black maroon)
    hexes = gba_tag_cells(a, "VERTICAL_HEX", [0], ROYAL_BLUE, 10)
    end = geyser(a, hit, {"cells": hexes, "zoom": HEX_ZOOM, "blend": "normal"}, type_="ghost", count=3, gap=5)
    a.note("Tints: objects 10/16 toward 0x7CBF and the NEN hexes 10/16 toward 0x5C05 are baked as exact GBA blends "
           "(family gba_tag_cells); the builder's brightness-scaled tint= left the rock / log dull mauve and the "
           "hexes near-black maroon (GEYSER_RISE['ghost'] is bypassed: one hex cell, all 9 Arrows frames are the "
           "same picture)")
    return hit, end


def eye_cell(a):
    """CFRU's Mean_Look.png (ANIM_TAG_EYE) blended 8/16 toward pure red exactly like the GBA."""
    return gba_tag_cells(a, "EYE", [0], EYE_RED, 8)[0]


def mean_look_eye(a, t0, length=20, zoom=120, opacity=235):
    """gMeanLookEyeSpriteTemplate on the target (in front of it, CFRU moves the target to the BG layer): fades in
    while pulsing (affine loop), shrinks, reappears, jitters and fades out. CFRU ~130 GBA f (fade-in 32, pulses to
    ~71, shrink, back, jitter 16, fade-out); ours `length` frames: pulses to length - 9, a 3-frame shrink, back with
    a 4-frame jitter, fading over the last 4. SE_M_PSYBEAM, SE_M_CONFUSE_RAY (x4 in CFRU, x2 here) and SE_M_LEER
    at the jitter. Returns the end frame."""
    cell = eye_cell(a)
    s = a.sprite(cell, t0, t0 + length, focus="target", pos=at_target(0, 0))
    shrink = length - 9       # pulses before this
    back = shrink + 3         # reappears, then jitters to the end
    s.key(0, opacity=0, zoom=zoom * 0.85)
    s.key(4, opacity=opacity)
    for k in range(0, shrink, 2):                 # the pulse: up 2 frames, down 2 frames
        s.key(k, zoom=zoom * (0.92 if (k // 2) % 2 == 0 else 1.12))
    s.key(shrink, zoom=zoom * 1.0)
    s.key(back - 1, zoom=zoom * 0.25, ease="in")  # shrinks
    s.key(back, zoom=zoom * 1.08, ease="out")      # reappears
    for k in range(back, length):                 # jitters
        dx = 3 if (k - back) % 2 == 0 else -3
        s.key(k, pos=at_target(dx, 0))
    s.key(length - 4, opacity=opacity)
    s.key(length - 1, opacity=40)
    se(a, t0, "SE_M_PSYBEAM", volume=90)
    se(a, t0 + 1, "SE_M_CONFUSE_RAY", volume=85)
    se(a, t0 + 7, "SE_M_CONFUSE_RAY", volume=85)
    se(a, t0 + back, "SE_M_LEER", volume=100)
    return t0 + length
