# Local fork (2026-11-19): the shared body of Max Steelspike, G-Max Steelsurge and G-Max Meltdown, rebuilt from CFRU
# ANIM_MAX_STEELSPIKE (Complete FireRed Upgrade, Skeli and the CFRU team; extract/ANIM_MAX_STEELSPIKE.txt). CFRU's two
# G-Max moves are the same script with the LARGE_SPIKE palette blended 7/16 toward one colour first
# (ANIM_G_MAX_STEELSURGE 0x46A0 greenish, ANIM_G_MAX_MELTDOWN 0x121C gold-orange), so all three specs call
# steelspike_body() with their own spike blend (CFRU BlendPalette, done exactly) and target tone.
# CFRU beats (226 GBA f) -> ours (48 frames):
#   f0    BG darkens 14/16 (29 f); Dynamax flex (72 f)             -> f0..8 dark, flex f0..14
#   f72   AnimTask_MaxSteelspike: LARGE_SPIKE (32x64, 4-frame emerge anim) spikes burst out of the ground one after
#         another along the attacker -> target path (16 steps, ~35 f)
#                                                                  -> f13..24: 12 spikes, one a frame, each emerging in
#                                                                     4 frames, standing 2, sinking back in 2
#   ~f107 two big curved spikes (affine, rotated +-45 deg) at target x-5 / x+5, standing 50 f
#                                                                  -> f24..37: emerge f24..27 crossed through the target
#                                                                     (+-38 deg, zoom 140), stand, sink f34..37
#   f157  SE_M_MEGA_KICK2; target shakes horizontally (8 px, 20 toggles every 2 f = 40 f)
#                                                                  -> f30..41 (starts while the big spikes still stand)
#   f197  BG back to normal (29 f)                                 -> f39..47 (with the soft target tone release)
# The path spikes sit on the USER_TARGET centre line with zero y offset and the art below the anchor (the spike's base is
# 32 px under its cell centre at zoom 100), so their bases run along the ground between the feet for either side:
# a USER_TARGET y offset flips for an enemy user, the picture inside the cell does not.
import math
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403

L = 48
WAVE_T0 = 13          # the first path spike: as the flex snaps back (the user lands)
WAVE_N = 12           # CFRU: 16 steps; 12 spikes one frame apart cover the same path at our frame rate
WAVE_P = (0.36, 0.86)  # fraction of the user -> target line covered by the path (clear of the x1.5 user's body)
WAVE_ZOOM = (96, 128)  # the spikes grow toward the target (CFRU: all the same size, 64 GBA px = zoom 130)
# small per-spike jitter (x, y) so the row reads as rugged rock-like ground, not a ruler line; y jitter flips sign for an
# enemy user, which does not matter for jitter
WAVE_JITTER = [(0, 0), (3, 3), (-2, -2), (2, 2), (-3, 1), (2, -2), (-1, 3), (3, -1), (-2, 2), (1, -3), (-2, 1), (0, 0)]
BIG_T0 = 24
BIG_ZOOM = 140
BIG_ANGLE = 38        # CFRU +-45 deg; a little steeper keeps the X on the target's body
BIG_DX = 8            # CFRU target x +-5 GBA px
HIT = 30              # SE_M_MEGA_KICK2 + horizontal shake

# G-Max colours: CFRU AnimTask_BlendParticle ANIM_TAG_LARGE_SPIKE 7/16 toward 0x46A0 (Steelsurge) / 0x121C
# (Meltdown), i.e. BlendPalette: every 5-bit palette colour c -> c + ((C - c) * 7 >> 4). 2026-11-19 review: done
# exactly (gba_blend_cells) instead of with the house a.cells tint, which keeps dark pixels dark (black at 7/16 toward
# 0x46A0 gave (0, 26, 21) instead of the GBA's (0, 74, 57)): the house tint made Meltdown's black spike body read as
# brown wood even when pushed to 10/16. The exact 7/16 blend gives CFRU's teal and copper-gold spikes.
GREENISH_BLEND = (0x46A0, 7)
GOLD_BLEND = (0x121C, 7)


def sheen_tone(rgb, lift, k=0.4):
    """A soft target tone toward `rgb` lightened by `lift` (0..1 toward white): a metallic sheen in the spike colour
    that brightens the target like Max Steelspike's silver tone, instead of blend_tone(rgb)'s red / blue cuts that turn
    warm sprites muddy on the dark stage."""
    return blend_tone(tuple(c + (255 - c) * lift for c in rgb), k)


# soft target tones for the hit (CFRU has no target blend in these scripts). 2026-11-19 review: blend_tone(0x46A0, 0.4)
# was [-102, 35, 10, 0] (warm targets went dark olive) and blend_tone(0x121C, 0.4) [82, 2, -77, 0] (a flat orange);
# now a mint sheen [0, 68, 55, 0] and a warm gold sheen [88, 32, -23, 0], next to Steelspike's silver [54, 54, 66, 0].
GREENISH_TONE = sheen_tone(EXTRA_COLORS["greenish"], 0.5)
GOLD_TONE = sheen_tone(EXTRA_COLORS["gold_orange"], 0.3)


def gba_blend(img, c15, coeff):
    """GBA BlendPalette on every visible pixel of an RGBA image: 5-bit channels, c + ((C - c) * coeff >> 4)."""
    C = (c15 & 31, (c15 >> 5) & 31, (c15 >> 10) & 31)
    out = img.copy()
    px = out.load()
    for j in range(out.height):
        for i in range(out.width):
            r, g, b, al = px[i, j]
            if al:
                c5 = [int(round(v * 31 / 255)) for v in (r, g, b)]
                o5 = [c + (((cc - c) * coeff) >> 4) for c, cc in zip(c5, C)]
                px[i, j] = tuple(int(v * 255 / 31) for v in o5) + (al,)
    return out


def gba_blend_cells(a, cells_src, frames, size, scale, c15, coeff):
    """Cells of a CFRU particle recoloured exactly like CFRU's AnimTask_BlendParticle (a recolour of the existing
    picture, added with the public a.cell_image). make_cell comes from the builder module that made `a` (maxanim, run
    as __main__ or imported); without it this falls back to the house tint at coeff/16."""
    mx = sys.modules.get(type(a).__module__)
    make_cell = getattr(mx, "make_cell", None)
    if make_cell is None:
        a.note("gba_blend_cells: maxanim.make_cell not found; fell back to the house tint")
        return a.cells(cells_src, frames=frames, size=size, scale=scale, tint=gba_rgb(c15) + (coeff / 16,))
    return [a.cell_image(gba_blend(make_cell(cells_src, f, size=size, scale=scale), c15, coeff)) for f in frames]


def spike_cells(a, blend=None):
    """The 4 LARGE_SPIKE emerge frames (CFRU Large_Spike.png, 32x64 at scale 1), optionally palette-blended like CFRU:
    blend = (BGR555 colour, coeff /16)."""
    if not blend:
        return tag_cells(a, "LARGE_SPIKE")
    w, h = cfru_info("Large_Spike.png")["frame_size"]
    return gba_blend_cells(a, "cfru:Large_Spike.png", [0, 1, 2, 3], (w, h), 1, *blend)


def steelspike_body(a, sheet, spike_blend=None, tone=None, glint_tint=(235, 240, 255, 0.85), sounds=None):
    """The whole animation. spike_blend: (BGR555 colour, coeff /16) of CFRU's AnimTask_BlendParticle on the spikes
    (None = CFRU's own black steel with white edges); tone: the soft target tone of the hit (CFRU has no target
    blend; [r, g, b, 0]); glint_tint: colour of the sparkle on the big spikes' tips when they lock in place."""
    begin(a, sheet, L)
    sp = spike_cells(a, spike_blend)
    emerge = [sp[0], sp[1], sp[2], sp[3]]
    stand = [sp[3]] * 2
    sink = [sp[2], sp[1]]
    glint = sub_cells(a, "SPARKLE_6", tint=glint_tint)

    # --- opening: dark stage, flex
    fade = L - 9                                   # f39: CFRU f197, the BG brightens again
    dark_stage(a, 0, L - 1, fade_in=8, fade_out=8)
    flex_end = dynamax_flex(a, 0)
    assert WAVE_T0 <= flex_end <= BIG_T0  # the path starts as the user lands from the flex

    # --- the spike path: one spike a frame along the user -> target ground line, each emerging (4 frames), standing (2)
    # and sinking back (2). Anchors sit ON the USER_TARGET centre line (y offset ~0) and the art hangs below the anchor,
    # so the bases follow the ground line for either side (see the header).
    p0, p1 = WAVE_P
    z0, z1 = WAVE_ZOOM
    cells = emerge + stand + sink
    for i in range(WAVE_N):
        u = i / (WAVE_N - 1)
        p = p0 + (p1 - p0) * u
        jx, jy = WAVE_JITTER[i % len(WAVE_JITTER)]
        t = WAVE_T0 + i
        s = a.sprite(cells, t, t + len(cells), focus="user_target", loop=False, mirror=bool(i % 2),
                     pos=(128 * p + jx, -64 * p + jy), zoom=round(z0 + (z1 - z0) * u))
        s.fade(255, 255, t_from=0, t_to=len(cells) - 2)
        s.fade(255, 120, t_from=len(cells) - 2, t_to=len(cells) - 1)

    # --- the two big curved spikes, crossed through the target (focus target: no mirroring; the pair is symmetric, so
    # the angles read the same for an enemy user)
    big_cells = emerge + [sp[3]] * 6 + [sp[3], sp[2], sp[1], sp[0]]
    life = len(big_cells)
    for side in (-1, 1):
        s = a.sprite(big_cells, BIG_T0, BIG_T0 + life, focus="target", loop=False, angle=side * BIG_ANGLE)
        s.key(0, pos=at_target(side * BIG_DX, 6), zoom=BIG_ZOOM - 10)
        s.key(3, pos=at_target(side * BIG_DX, 2), zoom=BIG_ZOOM + 8, ease="out")   # thrust
        s.key(5, zoom=BIG_ZOOM)
        s.key(life - 4, opacity=255)
        s.key(life - 1, opacity=150)
    # a glint on each tip as the spikes lock in place (CFRU has none; marks the stab at game scale)
    tip = BIG_ZOOM / 100 * 30   # tip distance from the cell centre along the spike
    for side in (-1, 1):
        ang = math.radians(BIG_ANGLE)
        tx, ty = side * BIG_DX - side * tip * math.sin(ang), 2 - tip * math.cos(ang)
        g = a.sprite(glint, BIG_T0 + 3, BIG_T0 + 9, focus="target", blend="add", loop=False, cell_every=2,
                     pos=at_target(tx, ty), zoom=90)
        g.key(2, zoom=120, ease="out")
        g.key(5, zoom=60, opacity=150)

    # --- the hit: CFRU SE_M_MEGA_KICK2 and a horizontal shake (8 GBA px, 20 toggles); a soft tone so it reads
    impact(a, HIT, fade + 7, "steel", amp=5, period=1, axis="x", ramp=4, release=7, shake_end=HIT + 12,
           tone=tone if tone is not None else tone_for("steel", 0.5))

    # --- sounds (CFRU plays only SE_M_MEGA_KICK2; the task's spikes are silent in the script)
    for t, name, vol, pitch in (sounds or [
        (WAVE_T0, "SE_M_ROCK_THROW", 90, 100),         # the ground cracks open
        (WAVE_T0 + 3, "SE_M_HORN_ATTACK", 90, 100),    # spikes stabbing up, rising pitch
        (WAVE_T0 + 7, "SE_M_HORN_ATTACK", 90, 110),
        (BIG_T0, "SE_M_SWORDS_DANCE", 100, 100),       # the big spikes ring as they cross
        (HIT, "SE_M_MEGA_KICK2", 100, 100),            # CFRU
    ]):
        se(a, t, name, volume=vol, pitch=pitch)

    a.note("CFRU AnimTask_MaxSteelspike is C code (not in the download); its extract summary was followed: spikes "
           "along the attacker -> target path, then two curved spikes rotated +-45 deg at target x+-5 for 50 f")
    a.note("Path spikes: anchored on the USER_TARGET centre line with no y offset (the art hangs below the anchor), so "
           "their bases follow the ground between the feet for an enemy user too")
    a.note("Hit: CFRU waits until the big spikes vanish before SE_M_MEGA_KICK2 and the shake; ours starts them 6 "
           "frames after the spikes cross, while they still stand, so the stab reads as the hit")
    a.note("Additions: a soft target tone (CFRU has no target blend), sounds for the spikes (rock crack, horn stabs, "
           "a sword ring; CFRU's task plays none from the script) and a sparkle on the big spikes' tips")
    return a
