# Local fork (2026-11-19): the Max Quake family body (group g8), shared by specs/max_quake.py and
# specs/g_max_sandblast.py. CFRU (Complete FireRed Upgrade, Skeli and the CFRU team) builds ANIM_G_MAX_SANDBLAST as
# ANIM_MAX_QUAKE (with a shorter target shake) followed by SE_M_SAND_TOMB and three vanilla SandTombSwirlingDirt calls,
# so both specs call quake_body() and Sandblast adds sand_vortex().
#
# Pieces (CFRU / vanilla FireRed names):
#   dig_down       Template_DigMound x2 + AnimTask_DigDownMovement + GROUND_DIGGING (DigThrowDirt): a dirt mound in
#                  front of the user's feet, the user sinking into it with a wavy wobble, clods thrown out of the hole
#   rollout_trail  AnimTask_Rollout + AnimTask_RolloutPathExplosions: mud / rock hops and reddish-pink explosion puffs
#                  along the user -> target line, alternating sides
#   dirt_geysers   SE_M_EXPLOSION, the target shaking, 4 x DIRT_GEYSER (reddish-pink puffs + rocks and mud rising)
#   user_return    the attacker made visible at 14/16 black and faded back with the background
#   sand_vortex    SandTombSwirlingDirt (AnimParticleInVortex): sand clumps rising around the target on a sine path
import math
import os

from _common import *  # noqa: F401,F403
import _common

# GBA song names the Max Quake family plays that _common.SE does not map (reported to the lead; short files first)
SE_EXTRA = {
    "SE_M_DIG": "PRSFX- Dig2.wav",   # vanilla Dig (GROUND_DIGGING); Dig2 is 0.52 s (Dig1 is 1.35 s)
}


def se_x(a, t, name, volume=100, pitch=100):
    """se() with the family's extra SE names (SE_EXTRA); same existence check."""
    if name in SE:
        return se(a, t, name, volume=volume, pitch=pitch)
    f = SE_EXTRA[name]
    if not os.path.exists(os.path.join(_common.AUDIO_DIR, f)):
        raise FileNotFoundError(f"{name} -> {f} is not in assets/audio/battle_anims")
    a.sound(t, f, volume=volume, pitch=pitch)
    return t


# DigThrowDirt (vanilla gDirtPlumeSpriteTemplate / AnimDirtPlumeParticle): per clod (side, dx, dy, arc) in GBA px;
# side +1 starts 24 px right of the attacker's feet, -1 24 px left (dx mirrored), arc = upward amplitude, 18 f each
CLODS = [(1, 12, 4, 16), (1, 16, 4, 10), (-1, 14, 4, 18), (-1, 12, 4, 16)]

# SandTombSwirlingDirt (vanilla AnimParticleInVortex), 6 particles 2 GBA f apart: (y offset below the target centre,
# rise speed in 1/256 px per GBA f, duration GBA f, angle step /256 per GBA f, x amplitude) in GBA px
VORTEX = [(32, 528, 30, 10, 50), (36, 480, 20, 13, -46), (37, 576, 20, 5, 42), (35, 400, 25, 8, -42),
          (32, 512, 25, 13, 46), (37, 464, 30, 12, -50)]

# unit vectors of the user -> target line in USER_TARGET space ((0, 0) -> (128, -64)): along it and perpendicular
# ("below" the line for the player; the enemy-side mirror flips the side, and the trail alternates sides anyway)
_LEN = math.hypot(128, -64)
ALONG = (128 / _LEN, -64 / _LEN)
ACROSS = (64 / _LEN, 128 / _LEN)


def quake_cells(a):
    """The family's cells: the PokeRogue Dig mound (DIRT_MOUND stand-in), the MUD_SAND clods, CFRU's rocks, the
    geyser puff tinted reddish pink 8/16 (0x447F, as CFRU's AnimTask_BlendParticle does; the same cells geyser()
    makes for type ground) and the Sand Tomb clumps."""
    return {
        "mound": a.cells("pr:PRAS- Dig", frames=[0])[0],
        "clods": sub_cells(a, "MUD_SAND"),
        "rocks": tag_cells(a, "ROCKS", frames=[0, 2, 4]),
        "puff": sub_cells(a, "UNUSED_EXPLOSION_2", frames=[0, 1, 2, 3, 4, 5],
                          tint=TYPE_COLORS["ground"]["puff_tint"]),
    }


def _clod_burst(a, c, t, k, life=6, sound=True):
    """One GROUND_DIGGING call: 4 clods hop out of the hole at the user's feet, SE_M_DIG. The user is drawn x1.5,
    so the hole edges are 30 px out (GBA 24) and the hops a little longer than GBA x1.3."""
    if sound:
        se_x(a, t, "SE_M_DIG", volume=85)
    for i, (side, dx, dy, arc) in enumerate(CLODS):
        x0, y0 = side * 30, 26
        x1, y1 = x0 + side * dx * 1.6, y0 + dy * 1.3
        s = a.sprite(c["clods"][(i + k) % len(c["clods"])], t, t + life, focus="user", zoom=100)
        s.arc(at_user(x0, y0), at_user(x1, y1), height=arc * 1.3, t_to=life - 1)
        s.fade(255, 255, t_from=0, t_to=life - 2)
        s.fade(255, 120, t_from=life - 2, t_to=life - 1)


def dig_down(a, c, t0, sink=10, bursts=(0, 3, 6), mound_end=None):
    """The attacker digs in (CFRU f72-223): the mound appears in front of its feet (priority 1, so it hides the
    sinking body's base), the user cel squashes toward its feet (zoomY; the x1.5 user's cel is scaled about its centre
    and lifted 16 px by the engine, so the feet stay put when it moves down 48 x (1 - zoomY)) and slides a little
    lower with a wavy x wobble, fading out at the end; dirt clods thrown out at t0 + bursts. Returns the frame the user
    is gone."""
    if mound_end is None:
        mound_end = t0 + sink + 12
    m = a.sprite(c["mound"], t0, mound_end, focus="user", pos=at_user(0, 27))
    life = mound_end - t0
    m.key(0, zoomX=110, zoomY=40)
    m.key(2, zoomX=165, zoomY=150, ease="out")
    m.fade(255, 255, t_from=0, t_to=life - 4)
    m.fade(255, 0, t_from=life - 4, t_to=life)
    for k, b in enumerate(bursts):
        _clod_burst(a, c, t0 + b, k)
    gone = t0 + sink
    low = 0.12
    a.user.key(t0, zoomX=100, zoomY=100, pos=(0, 0), opacity=255)
    a.user.key(gone, zoomX=100, zoomY=low * 100, pos=(0, 48 * (1 - low) + 6), ease="in")
    a.user.key(gone - 4, opacity=255)
    a.user.key(gone - 1, opacity=0)        # linear: the flattened top must not linger over the mound
    a.user.shake(t0 + 1, gone, amp=2, period=1, axis="x")
    return gone


def rollout_trail(a, c, t0, steps=10, u0=0.14, u1=0.9, life=5, dig=True, hole=2):
    """AnimTask_Rollout + AnimTask_RolloutPathExplosions (CFRU f207-297): one step a frame along the user -> target
    line, each a reddish-pink puff popping a little to one side (alternating) and a mud clod or rock hopping off.
    USER_TARGET focus: the line is the same screen segment for either side (only reversed). It runs through the
    battlers' centres: an offset toward the feet would land at head height for an enemy user (y flips). The hops
    are low (8 px), so their bulge flipping for an enemy user does not matter. Returns the frame the last puff ends.
    2026-11-19 review: CFRU's path starts at the attacker's feet (y + 24), i.e. at the dig hole, but the centre line
    starts 30-45 px above the mound for a player user, so the trail used to pop out of thin air there. `hole` puffs
    now climb straight out of the mound first (focus user, x 0: the same picture for either side; for an enemy user
    the centre line starts just above its mound, so they only thicken the start)."""
    if dig:
        _clod_burst(a, c, t0, 3)   # CFRU starts the fifth GROUND_DIGGING together with the rollout
    for k in range(hole):
        t = t0 - hole + 1 + k
        y0 = 22 - 16 * k                       # mound top (the mound sits at at_user(0, 27)), then the chest
        p = a.sprite(c["puff"], t, t + life, focus="user", loop=False, zoom=72 + 8 * k)
        p.move(at_user(0, y0), at_user(0, y0 - 10), t_to=life - 1)
        p.fade(235, 235, t_from=0, t_to=life - 2)
        p.fade(235, 110, t_from=life - 2, t_to=life - 1)
    for k in range(steps):
        u = u0 + (u1 - u0) * k / max(1, steps - 1)
        bx, by = 128 * u, -64 * u
        side = 1 if k % 2 == 0 else -1
        nx, ny = ACROSS[0] * side, ACROSS[1] * side
        t = t0 + k
        p = a.sprite(c["puff"], t, t + life, focus="user_target", loop=False, zoom=82)
        p.move((bx + nx * 4, by + ny * 4), (bx + nx * 11 + ALONG[0] * 4, by + ny * 11 + ALONG[1] * 4),
               t_to=life - 1)
        p.fade(235, 235, t_from=0, t_to=life - 2)
        p.fade(235, 110, t_from=life - 2, t_to=life - 1)
        cell = c["rocks"][k // 2 % len(c["rocks"])] if k % 2 else c["clods"][k // 2 % len(c["clods"])]
        h = a.sprite(cell, t, t + life, focus="user_target", zoom=30 if k % 2 else 95)
        h.arc((bx, by), (bx - nx * 12 + ALONG[0] * 10, by - ny * 12 + ALONG[1] * 10), height=8, t_to=life - 1)
    return t0 + steps - 1 + life


def dirt_geysers(a, t0, count=4, gap=5, puffs=7, rises=5):
    """SE_M_EXPLOSION and CFRU's 4 x DIRT_GEYSER 14 GBA f apart (geyser kind "ground": reddish-pink puffs, CFRU rocks
    and MUD_SAND clods rising). Returns the frame the last column ends."""
    se(a, t0, "SE_M_EXPLOSION")
    return geyser(a, t0, "ground", type_="ground", count=count, gap=gap, puffs=puffs, rises=rises)


def user_return(a, t, fade=8):
    """CFRU: the hidden attacker is set to 14/16 black, made visible and faded back from black together with the
    BG. The cel snaps back to its normal size under opacity 0, then shows dark and brightens over `fade` frames."""
    dark = blend_tone((0, 0, 0), 14 / 16)
    a.user.key(t - 2, tone=[0, 0, 0, 0])   # the tone track's first key: no tone before (the cel is hidden here)
    a.user.key(t - 1, zoomX=100, zoomY=100, pos=(0, 0), opacity=0, tone=dark)
    a.user.key(t + 1, opacity=255)
    a.user.key(t + fade, tone=[0, 0, 0, 0], ease="out")


def quake_body(a, sheet, L, shake_frames, flex=True, geyser_gap=5, steps=10, sink=10, tone_k=0.45):
    """The whole Max Quake choreography up to the end of the shake on a length-L file (dark stage to L - 1). Returns
    a dict of key frames (dig, gone, trail, trail_end, geysers, columns_end, shake_end) and the cells; the spec adds
    its own tail (Sandblast: sand_vortex) and calls user_return()."""
    begin(a, sheet, L)
    c = quake_cells(a)
    dark_stage(a, 0, L - 1, fade_in=8, fade_out=8)
    t_dig = dynamax_flex(a, 0) if flex else 0
    gone = dig_down(a, c, t_dig, sink=sink, mound_end=t_dig + sink + 12)
    t_trail = gone - 1
    trail_end = rollout_trail(a, c, t_trail, steps=steps)
    t_g = t_trail + steps - 2              # the explosion as the trail reaches the target (CFRU overlaps them)
    shake_end = t_g + shake_frames
    columns_end = dirt_geysers(a, t_g, gap=geyser_gap)
    if tone_k:
        # CFRU Max Quake has no target blend; a soft earth-brown tone lets the hit read (released with the shake)
        impact(a, t_g, shake_end + 7, "ground", k=tone_k, ramp=6, release=7, shake_end=shake_end)
    else:
        a.target.shake(t_g, shake_end, amp=5, period=1, axis="y")
    return {"cells": c, "dig": t_dig, "gone": gone, "trail": t_trail, "trail_end": trail_end, "geysers": t_g,
            "columns_end": columns_end, "shake_end": shake_end}


def sand_vortex(a, t0, calls=3, gap=3, spread=0.67, rise=1.2, amp=1.0, frames_per_gba=0.27, zoom=(85, 100)):
    """SE_M_SAND_TOMB + `calls` x SandTombSwirlingDirt (CFRU: 3 calls 12 GBA f apart, 6 particles 2 f apart). Each
    particle (vanilla AnimParticleInVortex) starts at the target's feet, rises at its own speed and swings on a sine
    of its own amplitude and angular speed for its own duration. Ours samples that path once a frame, with GBA time
    compressed by `frames_per_gba` (30 GBA f -> 8 frames), rise x `rise` and swing x `amp` in anim px (GBA x1.3
    would put the swing 65 px out, wider than the target); focus target, so up stays up for either side and the
    symmetric swing needs no mirroring. Sand clumps = PRAS- Sand Tomb (the game's own Sand Tomb particle; the
    vanilla MUD_SAND tile is missing). Returns the frame the last particle ends."""
    cells = a.cells("pr:PRAS- Sand Tomb", frames=[1, 2])
    se(a, t0, "SE_M_SAND_TOMB")
    end = t0
    for k in range(calls):
        for j, (y0, speed, dur, step, sw) in enumerate(VORTEX):
            t = t0 + k * gap + int(round(j * spread))
            life = max(4, int(round(dur * frames_per_gba)))
            s = a.sprite(cells[(j + k) % 2], t, t + life, focus="target")
            z0 = zoom[(j + k) % 2]
            for i in range(life):
                g = i * dur / max(1, life - 1)                       # GBA frame of this sample
                th = 2 * math.pi * step * g / 256
                x = sw * amp * math.sin(th)
                y = y0 - speed * g / 256 * rise
                # depth cue (ours): a clump is a little bigger on the near half of its swing
                s.key(i, pos=at_target(x, y), zoom=z0 * (0.85 + 0.2 * math.cos(th)))
            s.fade(240, 240, t_from=0, t_to=life - 3)
            s.fade(240, 0, t_from=life - 3, t_to=life)
            end = max(end, t + life)
    return end
