# Local fork (2026-11-18): shared pieces for the CFRU Max Move specs (rebuilt from Complete FireRed Upgrade, by Skeli
# and the CFRU team; credit them, non-commercial). Import from a spec with
#     import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *
# Everything here only calls the public `a` (maxanim.Anim) API (CFRU_BOXES needs the `box` option of a.cells,
# added to maxanim.py 2026-11-19). Read specs/_STYLE.md first: it says when to use which helper and the timing budget.
# 2026-11-19: cfru_cells picks the scale itself (64 px frames at scale 2 were cropped), cuts Leaves.png by
# CFRU_BOXES (its 16 px grid halves most leaves), sub_cells routes CFRU sources through cfru_cells, GEYSER_RISE names
# its particles by tag (source_cells), CFRU_REPLACED lists the tags CFRU ships although the inventory says missing,
# more SE entries.
#
# Coordinates (maxanim / engine): anim space, the user's centre is (0, 0) and the target's (128, -64); negative y is
# up. A "target" focus sprite at the target's centre is written at (128, -64) (the engine subtracts 128 / adds 64),
# so use at_target(dx, dy) / at_user(dx, dy) to place things around one battler.
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
INVENTORY = os.path.join(ROOT, "inventory")
EXTRACT = os.path.join(ROOT, "extract")
AUDIO_DIR = "D:/PokeRogueDev/pokerogue/assets/audio/battle_anims"

__all__ = [
    "GBA_PX", "gba", "gba_f", "at_user", "at_target", "gba_rgb", "blend_tone",
    "TYPE_COLORS", "EXTRA_COLORS", "type_color", "tone_for", "tint_for",
    "begin", "dynamax_flex", "FLEX", "DARK", "dark_stage", "bg_fade", "scene_bg", "bg_seams",
    "impact", "screen_rumble", "geyser", "GEYSER_PUFFS", "GEYSER_RISE", "big_orb",
    "SUBS", "sub_cells", "cfru_info", "cfru_cells", "CFRU_TAGS", "tag_cells", "PALETTE_PAIRS", "CFRU_BOXES",
    "CFRU_REPLACED", "FRAME_SIZE_FIX", "source_cells",
    "SE", "se", "SE_NOTES", "sound_secs",
]

# ----------------------------------------------------------------------------------------------------------------------
# GBA -> our units
# ----------------------------------------------------------------------------------------------------------------------
GBA_PX = 1.3  # GBA px -> anim px for sizes / offsets around one battler (field 320 px vs GBA 240 px; 1.25..1.33)


def gba(dx, dy=None):
    """Scale a GBA pixel offset (or a pair) to anim px."""
    if dy is None:
        return dx * GBA_PX
    return dx * GBA_PX, dy * GBA_PX


def gba_f(n):
    """GBA frames (60 fps) -> our anim frames (20 fps), at least 1. Max specs then compress further (see _STYLE.md)."""
    return max(1, int(round(n / 3)))


def at_user(dx=0.0, dy=0.0):
    """Anim coordinates for a focus "user" sprite dx / dy anim px from the user's centre (screen directions)."""
    return (dx, dy)


def at_target(dx=0.0, dy=0.0):
    """Anim coordinates for a focus "target" sprite dx / dy anim px from the target's centre (screen directions)."""
    return (128.0 + dx, -64.0 + dy)


# ----------------------------------------------------------------------------------------------------------------------
# colours
# ----------------------------------------------------------------------------------------------------------------------
def gba_rgb(c15):
    """A GBA BGR555 colour (as written in the CFRU scripts, e.g. 0x73DF) -> (r, g, b) 0..255."""
    return (int((c15 & 31) * 255 / 31), int(((c15 >> 5) & 31) * 255 / 31), int(((c15 >> 10) & 31) * 255 / 31))


def blend_tone(rgb, k=0.75):
    """Battler tone [r, g, b, 0] that approximates a GBA BlendPalette toward `rgb` (engine_spec.md section 9:
    tone ~ (C - 128) * 2 * coeff/16). k = 1 is a full 16/16 blend (a flat silhouette); 0.75 keeps the sprite's
    shading readable. Gray stays 0 (the shader uses it raw as a 0..1 mix)."""
    return [max(-255, min(255, int(round((c - 128) * 2 * k)))) for c in rgb] + [0]


# type: (CFRU BGR555 colour or None, our rgb when None, name, where CFRU uses it, puff tint or None)
# puff_tint follows CFRU where it recolours geyser puffs (ghost NEN_EXPLODE, ground TECTONIC_EXPLODE, bug's light-green
# explosions); the tints of types CFRU never gives a geyser are ours, for G-Max variants and new combinations.
# rgb is the CFRU BGR555 colour converted, or our own pick (marked "ours") where the CFRU script has no blend for
# that type. "tint" recolours neutral particles (white orbs, rings) toward the type; "puff_tint" recolours the
# geyser explosion puffs (None = keep the orange explosion, as in CFRU's plain EXPLOSION_GEYSER).
_TYPE_SRC = {
    "normal":   (0x73DF, None, "Bright yellow", "ANIM_MAX_STRIKE target blend 0x73DF (one step / 5 f)", None),
    "fire":     (0x057C, None, "Red", "ANIM_MAX_FLARE fireball tint 0x057C (Flare itself has no target blend)", None),
    "water":    (None, (64, 136, 248), "Water blue", "ours: ANIM_MAX_GEYSER has no target blend (WATER_IMPACT blue orb)",
                 (64, 136, 248, 0.55)),
    "electric": (0x17BF, None, "Yellow", "ANIM_MAX_LIGHTNING target blend 0x17BF (one step / 2 f)", (255, 238, 41, 0.45)),
    "grass":    (0x33F2, None, "Light green", "ANIM_MAX_OVERGROWTH target blend 0x33F2 (one step / 4 f)", None),
    "ice":      (None, (150, 230, 255), "Ice blue", "ours: ANIM_MAX_HAILSTORM has no target blend",
                 (150, 230, 255, 0.6)),
    "fighting": (0x0E5F, None, "Orange", "ANIM_MAX_KNUCKLE target blend 0x0E5F (one step / 3 f)", None),
    "poison":   (0x6038, None, "Purple", "ANIM_MAX_OOZE target blend 0x6038 (one step / 3 f)", (197, 8, 197, 0.55)),
    "ground":   (None, (200, 140, 70), "Earth brown",
                 "ours: ANIM_MAX_QUAKE has no target blend; its puffs are tinted 8/16 toward 0x447F (puff_tint)",
                 (255, 24, 139, 0.5)),
    "flying":   (None, (220, 240, 255), "Sky white", "ours: ANIM_MAX_AIRSTREAM only brightens its particles (0x7FFF)",
                 (220, 240, 255, 0.6)),
    "psychic":  (0x7D3D, None, "Pinkish purple", "ANIM_MAX_MINDSTORM target blend 0x7D3D (one step / 4 f); its "
                 "MINDSTORM_GEYSER puffs are the plain orange ones", None),
    "bug":      (0x33D5, None, "Light green", "ANIM_MAX_FLUTTERBY particle tint 0x33D5 (no target blend)",
                 (172, 246, 98, 0.62)),
    "rock":     (None, (200, 160, 96), "Sand brown", "ours: ANIM_MAX_ROCKFALL has no target blend", None),
    "ghost":    (0x5C05, None, "Royal blue", "ANIM_MAX_PHANTASM target blend 0x5C05 (one step / 4 f); NEN puffs use it",
                 (41, 0, 189, 0.62)),
    "dragon":   (0x5818, None, "Pink", "ANIM_MAX_WYRMWIND target blend 0x5818 (one step / 6 f)", (197, 0, 180, 0.5)),
    "dark":     (0x3006, None, "Purple", "ANIM_MAX_DARKNESS target blend 0x3006 (one step / 4 f)", (90, 0, 205, 0.6)),
    "steel":    (None, (200, 200, 216), "Silver", "ours: ANIM_MAX_STEELSPIKE has no target blend", (200, 200, 216, 0.5)),
    "fairy":    (0x7A5B, None, "Pink", "ANIM_MAX_STARFALL target blend 0x7A5B (one step / 7 f)", (222, 148, 246, 0.55)),
}

# hand-tuned battler tones where the plain formula reads wrong at game scale
_TONE_OVERRIDE = {
    # 0x73DF is a near-white cream; pushed toward yellow so "turns bright yellow" reads on screen
    "normal": [200, 170, 70, 0],
}

TYPE_COLORS = {}
for _t, (_c, _rgb, _name, _src, _puff) in _TYPE_SRC.items():
    _rgb = gba_rgb(_c) if _c is not None else _rgb
    TYPE_COLORS[_t] = {
        "gba": _c,                      # the CFRU BGR555 colour, or None (our pick)
        "rgb": _rgb,                    # flash / blend colour
        "name": _name,
        "cfru": _src,
        "tone": _TONE_OVERRIDE.get(_t, blend_tone(_rgb)),   # peak battler tone for impact()
        "tint": (_rgb[0], _rgb[1], _rgb[2], 0.8),           # a.cells(..., tint=...) for neutral particles
        "puff_tint": _puff,             # geyser explosion recolour (None = orange explosion)
    }

# the other blend colours the Max / G-Max scripts use (for G-Max variants and particle tints)
EXTRA_COLORS = {
    "garbage_green": gba_rgb(0x2DCC),   # G-Max Malodor target
    "red": gba_rgb(0x001D),             # G-Max Depletion target
    "pure_red": gba_rgb(0x001F),        # G-Max Terror eye / Vine Lash
    "light_blue": gba_rgb(0x7FAF),      # G-Max Smite
    "sky_blue": gba_rgb(0x7FEE),        # Mindstorm needles, Gravitas
    "royal_blue": gba_rgb(0x5C05),
    "reddish_pink": gba_rgb(0x447F),    # Quake / Sandblast / Vine Lash puffs
    "pink_hot": gba_rgb(0x7CBF),        # Phantasm objects 10/16
    "purple_violet": gba_rgb(0x5413),   # Mindstorm gold rings 12/16
    "purple_deep": gba_rgb(0x640B),     # Darkness pink orbs
    "pinkish_red": gba_rgb(0x441F),     # Darkness orbs
    "orange": gba_rgb(0x01DD),          # Flare orange ball
    "yellow_orange": gba_rgb(0x063C),   # Flare "yellow" ball
    "gold_orange": gba_rgb(0x121C),     # G-Max Meltdown
    "greenish": gba_rgb(0x46A0),        # G-Max Steelsurge
    "purplish_pink": gba_rgb(0x701D),   # G-Max Stun Shock
    "white": gba_rgb(0x7FFF),
}


def type_color(t):
    return TYPE_COLORS[t.lower()]


def tone_for(t, k=1.0):
    """The type's impact tone scaled by k (0..1; 1 = the TYPE_COLORS peak)."""
    tone = TYPE_COLORS[t.lower()]["tone"]
    return [int(round(c * k)) for c in tone[:3]] + [0]


def tint_for(t, amount=None):
    r, g, b, am = TYPE_COLORS[t.lower()]["tint"]
    return (r, g, b, am if amount is None else amount)


# ----------------------------------------------------------------------------------------------------------------------
# setup, Dynamax flex
# ----------------------------------------------------------------------------------------------------------------------
def begin(a, sheet, frames):
    """Common setup: length, sheet name and own-focus battler cels (so vertical battler moves such as the flex lift
    or a target pushed down keep their screen direction when an enemy uses the move)."""
    a.length(frames).sheet(sheet)
    a.user.focus = "own"
    a.target.focus = "own"
    return a


FLEX = {"peak": 125, "grow": 6, "hold": 6, "shrink": 3}  # 15 frames; CFRU 32 + 32 + 8 GBA f to 2x


def dynamax_flex(a, t0=0, peak=FLEX["peak"], grow=FLEX["grow"], hold=FLEX["hold"], shrink=FLEX["shrink"], lift=None):
    """CFRU AnimTask_DynamaxGrowth (attack variant): the attacker grows, holds and snaps back. CFRU goes to 2x over
    32 + 32 + 8 GBA frames; our Dynamaxed user is already drawn x1.5, so the default is 125 % over 6 + 6 + 3 = 15
    frames. `lift` (default 48 * (peak - 100) / 100, about a 64 px sprite's foot drop) raises the sprite so it grows
    up from its feet instead of sinking through the floor. Returns the frame the flex ends."""
    if a.user.focus == "user_target":
        a.user.focus = "own"  # the lift must stay "up" for an enemy user
    if lift is None:
        lift = round(48 * (peak - 100) / 100)
    t1, t2, t3 = t0 + grow, t0 + grow + hold, t0 + grow + hold + shrink
    a.user.key(t0, zoom=100, pos=(0, 0))
    a.user.key(t1, zoom=peak, pos=(0, -lift), ease="out")
    a.user.key(t2, zoom=peak, pos=(0, -lift))
    a.user.key(t3, zoom=100, pos=(0, 0), ease="in")
    return t3


# ----------------------------------------------------------------------------------------------------------------------
# backgrounds
# ----------------------------------------------------------------------------------------------------------------------
DARK = 223  # 14/16 black: CFRU AnimTask_pal_fade PAL_BG 0 -> 0xE toward black


def _check_end(a, t, what):
    if t > a.frames - 1:
        raise ValueError(f"{what} ends at f{t}, after the last frame f{a.frames - 1}: call a.length() first and "
                         f"finish background fades before the last frame")


def bg_fade(a, t, frm, to, frames, step=8):
    """Fade the current background's opacity from `frm` to `to` over `frames`, as UpdateBg tweens of at most `step`
    frames each. (Every bg event adds 2 x duration to the end hold, so long single tweens cost dead time.)"""
    frames = max(1, int(frames))
    n = max(1, math.ceil(frames / step))
    for i in range(n):
        s0 = t + round(frames * i / n)
        s1 = t + round(frames * (i + 1) / n)
        v = round(frm + (to - frm) * (i + 1) / n)
        a.bg_update(s0, opacity=v, duration=s1 - s0)
    _check_end(a, t + frames, "bg_fade")
    return t + frames


def dark_stage(a, t0, t1, opacity=DARK, fade_in=8, fade_out=8):
    """The CFRU dark stage: the battle background (not the battlers or particles) blends 14/16 toward black, a
    spotlight look. Ours: a black background (AddBg image "") fading in from t0 and fully gone at t1 (fade_out
    frames before). A later scene_bg() replaces it (one background at a time)."""
    a.bg(t0, "", opacity=0)
    bg_fade(a, t0, 0, opacity, fade_in)
    if t1 is not None:
        bg_fade(a, t1 - fade_out, opacity, 0, fade_out)
        _check_end(a, t1, "dark_stage")


def _image_size(name):
    try:
        from PIL import Image
        with Image.open(os.path.join("D:/PokeRogueDev/pokerogue/assets/images/battle_anims", name + ".png")) as im:
            return im.size
    except Exception:
        return None


def bg_seams(name):
    """How badly a background texture shows its tile seam when scrolled: (x, y) = mean colour jump across the
    wrap / mean jump between two inner neighbours. About 1-4 tiles cleanly; 10+ shows a visible seam."""
    try:
        from PIL import Image
        with Image.open(os.path.join("D:/PokeRogueDev/pokerogue/assets/images/battle_anims", name + ".png")) as im:
            im = im.convert("RGB")
            w, h = im.size
            px = im.load()

            def jump(p, q):
                return sum(abs(c1 - c2) for c1, c2 in zip(p, q))
            ex = sum(jump(px[0, y], px[w - 1, y]) for y in range(h)) / h
            ix = sum(jump(px[w // 2, y], px[w // 2 + 1, y]) for y in range(h)) / h
            ey = sum(jump(px[x, 0], px[x, h - 1]) for x in range(w)) / w
            iy = sum(jump(px[x, h // 2], px[x, h // 2 + 1]) for x in range(w)) / w
            return ex / max(1.0, ix), ey / max(1.0, iy)
    except Exception:
        return None


def scene_bg(a, t0, t1, image, opacity=255, fade_in=0, fade_out=6, scroll=None, step=4, frm=0):
    """A full animation background (CFRU loadBG1 + AnimTask_scroll_background), e.g. "PRAS- Burning BG" for CFRU's
    BG_INFERNO_OVERDRIVE. AddBg at t0 (replacing any dark stage), opacity `frm` -> `opacity` over fade_in (0 = cut
    straight to `opacity`), fade out so it is gone at t1 (None = keep). `scroll` = (vx, vy) field px per frame,
    written as chained UpdateBg moves of `step` frames (a long single tween would add 2 x its length to the end
    hold). The 1120 x 720 sprite can travel at most 800 x 540 px before the screen edge shows. Only scroll a
    texture that tiles on that axis (bg_seams(); a note is added to the build report when it does not)."""
    vx, vy = scroll or (0, 0)
    if scroll:
        seams = bg_seams(image)
        if seams and ((vx and seams[0] > 6) or (vy and seams[1] > 6)):
            a.note(f"scene_bg: '{image}' does not tile on the scrolled axis (seam ratio x {seams[0]:.0f}, "
                   f"y {seams[1]:.0f}): the seam will slide across the screen")
    ax = 320 if vx < 0 else (-480 if vx > 0 else 0)
    ay = 284 if vy < 0 else (-256 if vy > 0 else 0)
    a.bg(t0, image, opacity=opacity if not fade_in else frm, x=ax, y=ay)
    if fade_in:
        bg_fade(a, t0, frm, opacity, fade_in)
    end = (t1 if t1 is not None else a.frames - 1)
    if scroll:
        span = end - t0
        if abs(vx) * span > 800 or abs(vy) * span > 540:
            raise ValueError(f"scene_bg scroll {scroll} over {span} frames leaves the background sprite: slow it down")
        t = t0
        while t < end:
            d = min(step, end - t)
            tt = t + d - t0
            kw = {}
            if vx:
                kw["x"] = 2 * (ax + vx * tt)
            if vy:
                kw["y"] = 2 * (ay + vy * tt)
            a.bg_update(t, duration=d, **kw)
            t += d
    if t1 is not None:
        bg_fade(a, t1 - fade_out, opacity, 0, fade_out)
        _check_end(a, t1, "scene_bg")


# ----------------------------------------------------------------------------------------------------------------------
# impact on the target, screen rumble
# ----------------------------------------------------------------------------------------------------------------------
def impact(a, t0, t1, type_, amp=5, period=1, axis="y", ramp=None, release=8, k=1.0, tone=None, shake=True,
           shake_end=None):
    """The CFRU impact phase: target shake (AnimTask_move_bank bank_target 0 4: 4 GBA px down and back, toggling
    every 2 f -> amp 5 anim px, period 1 here) over [t0, shake_end or t1) plus a target tone toward the type colour
    (CFRU AnimTask_pal_fade PAL_DEF 0 -> 16/16, slow; back 16 -> 0, fast). `ramp` frames to the peak (default a third
    of the span), held, then `release` frames back to 0 ending at t1. k scales the tone; tone overrides it.
    2026-11-19: `shake_end` stops the shake before the tone release (CFRU's shake ends where the colour and the BG
    start fading back, e.g. Max Strike f176), so the release can overlap the dark-stage fade-out."""
    if t1 - release <= t0:
        raise ValueError(f"impact({t0}, {t1}): release {release} leaves no time to reach the peak")
    if shake and amp:
        a.target.shake(t0, t1 if shake_end is None else shake_end, amp=amp, period=period, axis=axis)
    peak = tone if tone is not None else tone_for(type_, k)
    if ramp is None:
        ramp = max(2, (t1 - t0) // 3)
    r1 = min(t0 + ramp, t1 - release)
    a.target.key(t0, tone=[0, 0, 0, 0])
    a.target.key(r1, tone=peak, ease="out")
    a.target.key(t1 - release, tone=peak)
    a.target.key(t1, tone=[0, 0, 0, 0], ease="in")
    return t1


def screen_rumble(a, t0, weak=6, strong=10, amp1=2, amp2=5, sound="SE_M_STRENGTH", sounds=(2, 3)):
    """CFRU MAX_STRIKE_SCREEN_SHAKE (Strike, Gold Rush, Cuddle, Replenish): SE_M_STRENGTH x3 and a light shake of
    all battlers and the BG for 28 GBA f, then x3 more with a strong shake for 44 GBA f. Ours: both battler cels shake
    (x and y) `weak` frames at amp1 then `strong` frames at amp2; `sounds` = how many SE in each stage.
    (A black dark stage cannot show a BG shake; the arena platforms are not part of the animation.)
    Returns the frame it ends."""
    t1 = t0 + weak
    t2 = t1 + strong
    for b in (a.user, a.target):
        b.shake(t0, t1, amp=amp1, period=1, axis="xy")
        b.shake(t1, t2, amp=amp2, period=1, axis="xy")
    n1, n2 = sounds
    for i in range(n1):
        se(a, t0 + i * max(1, weak // max(1, n1)), sound, volume=90)
    for i in range(n2):
        se(a, t1 + i * 2, sound, volume=110)
    return t2


# ----------------------------------------------------------------------------------------------------------------------
# substitutes for the vanilla FireRed particles the Max scripts use but the CFRU download lacks
# (chosen by eye from inventory/contact_*.png; "zoom" is the 1:1-with-GBA zoom for that cell, about GBA size x 1.3)
# ----------------------------------------------------------------------------------------------------------------------
SUBS = {
    # -- used by 3+ Max labels
    "UNUSED_EXPLOSION_2": {"src": "pr:fire4", "frames": [1, 2, 3, 4, 5, 6, 7], "zoom": 100,
                           "why": "the geyser puff (26 labels): an orange-white cloud that blooms; fire4 frames 1-7 "
                                  "read as the same 32x32 puff at 1:1 (8-11 are grey smoke, murky on the dark stage)"},
    "CIRCLE_OF_LIGHT": {"src": "pr:PRAS- Strike", "frames": [26], "zoom": 175,
                        "why": "big glowing orb (13 labels): a white glowing sphere; tint it per move"},
    "LEER": {"src": "pr:leer", "frames": [0, 1, 2], "zoom": 100,
             "why": "an FRLG-style leer glint (frames 5-7 of that sheet are a ripper credit: never use them)"},
    "ICE_CRYSTALS": {"src": "pr:PRAS- Ice", "frames": [8, 9, 10, 11], "zoom": 100,
                     "why": "small blue crystals that shatter"},
    "SMALL_BUBBLES": {"src": "pr:PRAS- Water", "frames": [28, 33], "zoom": 100,
                      "why": "a small pale bubble, then its pop"},
    "WATER_IMPACT": {"src": "pr:PRAS- Dive", "frames": [1], "zoom": 100,
                     "why": "cyan splash star, the water version of the impact star"},
    "LIGHTNING": {"src": "pr:GEN8- Thundercage", "frames": [6, 7, 8], "zoom": 100,
                  "why": "a lightning bolt striking down"},
    "UNUSED_LIGHTNING": {"src": "pr:GEN8- Thundercage", "frames": [2, 3, 4, 5], "zoom": 100,
                         "why": "thin vertical lightning segments, stack 3 for CFRU's column"},
    "SPARK_2": {"src": "pr:electric2", "frames": [0, 3, 4, 7], "zoom": 100,
                "why": "single yellow zigzag sparks (crackle around a battler)"},
    "ORBS": {"src": "pr:PRAS- Orbs", "frames": [2, 4], "zoom": 100,
             "why": "PokeRogue's own white orbs; tint per move (CFRU tints ORBS 10/16)"},
    "UNUSED_PINK_ORB": {"src": "pr:Gen9- TwinBeam", "frames": [2], "zoom": 60, "why": "a small pink orb"},
    "SHADOW_BALL": {"src": "pr:Gen9- Rage Fist", "frames": [2, 3, 4, 5], "zoom": 78,
                    "why": "a dark purple ball with a lavender rim, like FRLG's Shadow Ball (it is PokeRogue's own "
                           "purple recolour of the PRAS Shadow Ball; 'PRAS- Shadow Ball' itself is green and black)"},
    "YELLOW_STAR": {"src": "pr:PRAS- Swift", "frames": [0], "zoom": 120, "why": "the Swift star"},
    # -- asked for explicitly
    "IMPACT": {"src": "cfru:Palette_Only/Impact.bmp", "frames": [0], "size": (32, 32), "scale": 2, "zoom": 65,
               "why": "the vanilla impact star exactly as CFRU ships it (the Palette_Only PNG holds the picture)"},
    "EXPLOSION": {"src": "pr:PRAS- Explosions", "frames": [0, 1, 2, 3], "zoom": 160,
                  "why": "PokeRogue's Explosion / Self-Destruct burst: the same 4-step burst as FRLG's"},
    "SPARK": {"src": "pr:electric2", "frames": [1, 2, 5, 6], "zoom": 100, "why": "pairs of yellow sparks"},
    # -- used by 1-2 labels (best effort)
    "AIR_WAVE_2": {"src": "cfru:Punishment.png", "frames": [0, 1, 2, 3, 4], "size": (32, 32), "scale": 2,
                   "tint": (235, 245, 255, 0.85), "zoom": 65,
                   "why": "CFRU draws these crescent tiles with the AIR_WAVE_2 palette; tinted near white"},
    "METAL_SOUND_WAVES": {"src": "pr:PRAS- Supersonic", "frames": [0, 1, 2, 3, 4, 5], "tint": (235, 235, 245, 0.8),
                          "zoom": 100, "why": "expanding rings, tinted grey-white"},
    "GUST": {"src": "pr:Wind1", "frames": [8, 9, 10, 11], "tint": (240, 240, 240, 0.7), "zoom": 100,
             "why": "a wind swirl, green tinted to white"},
    "GOLD_RING": {"src": "pr:PRAS- Healing Wish", "frames": [13, 14, 15], "zoom": 100, "why": "a yellow ring"},
    "PINK_PETAL": {"src": "pr:PRAS- Aromatherapy", "frames": [0, 1, 2, 3], "zoom": 100, "why": "pink petals"},
    "POISON_BUBBLE": {"src": "pr:PRAS- Sludge Bomb", "frames": [0, 1, 2, 3], "zoom": 70, "why": "a purple bubble"},
    "PUNCH_IMPACT": {"src": "pr:PRAS- Strike", "frames": [0], "zoom": 100, "why": "the yellow hit star"},
    "UNUSED_IMPACT_2": {"src": "pr:PRAS- Strike", "frames": [3, 4], "zoom": 100, "why": "a red hit burst"},
    "SPARKLE_6": {"src": "cfru:Green_Star.png", "frames": [0, 1, 2, 3], "size": (16, 16), "scale": 2, "zoom": 65,
                  "why": "CFRU's own 4-point sparkle; tint per move"},
    "FOCUS_ENERGY": {"src": "pr:PRAS- Focus Energy", "frames": [0, 1, 2, 3], "zoom": 100,
                     "why": "PokeRogue's Focus Energy flames"},
    "DIRT_MOUND": {"src": "cfru:Stone_Pillar.png", "frames": [3], "size": (64, 64), "scale": 1, "zoom": 130,
                   "why": "a low rubble pile (last frame of CFRU's crumbling pillar)"},
    "MUD_SAND": {"src": "pr:PRAS- Rock (Essentials)", "frames": [2, 3, 4], "zoom": 100, "why": "small brown clods"},
    "FLAT_ROCK": {"src": "cfru:Rocks.png", "frames": [5], "size": (32, 32), "scale": 2, "zoom": 65,
                  "why": "the flattest CFRU rock"},
    "HAIL": {"src": "pr:PRAS- Ice", "frames": [17], "zoom": 100, "why": "a small hailstone"},
    "ICE_CHUNK": {"src": "pr:PRAS- Ice", "frames": [12], "zoom": 45, "why": "a big ice crystal"},
    "COIN": {"src": "pr:PRAS- Pay Day", "frames": [0, 1, 2, 3], "zoom": 130, "why": "PokeRogue's spinning Pay Day coin"},
    "RED_HEART": {"src": "pr:PRAS- Love", "frames": [5], "tint": (235, 40, 70, 0.55), "zoom": 100,
                  "why": "the Attract heart (21x17) tinted red; CFRU's Heart_Stamp is a heart inside a red disc "
                         "(a stamp), not the small vanilla heart"},
    "BIRD": {"src": "pr:Firebird", "frames": [14, 15, 16, 17, 18], "zoom": 100,
             "why": "a fire phoenix for G-Max Wildfire's red bird"},
    "PROTECT": {"src": "pr:PRAS- Protect", "frames": [0, 1, 2, 3, 4], "zoom": 100, "why": "PokeRogue's Protect"},
    "SPORE": {"src": "pr:PRAS- Cotton Spore", "frames": [0], "zoom": 100, "why": "a cotton spore puff"},
    "RAZOR_LEAF": {"src": "cfru:Leaves.png", "frames": [0, 1, 3, 4], "zoom": 65,
                   "why": "CFRU's own leaves (CFRU_BOXES cuts the 48x48 wallpaper into whole leaves); the vanilla "
                          "Razor Leaf is a similar small green leaf"},
    "MUSIC_NOTES": {"src": "pr:normal1", "frames": [0, 1, 2, 3, 4, 5], "zoom": 70, "why": "yellow music notes"},
    "PURPLE_HAND_OUTLINE": {"src": "cfru:Assurance_Hand.bmp", "frames": [0], "size": (32, 32), "scale": 2,
                            "tint": (150, 60, 220, 0.8), "zoom": 65, "why": "CFRU's hand tinted purple"},
    "THIN_RING": {"src": "pr:PRAS- Me First", "frames": [2, 4, 6, 8, 10], "zoom": 100, "why": "a thin cyan ring"},
    "ROOTS": {"src": "pr:PRAS- Frenzy Plant", "frames": [10, 11, 12], "zoom": 100, "why": "roots / vines (rough)"},
    "UNUSED_VINE_2": {"src": "pr:grass", "frames": [1, 5, 6, 7], "zoom": 100, "why": "a green vine arc (rough)"},
}


def sub_cells(a, tag, frames=None, **opts):
    """Cells of the substitute for a missing vanilla tag ("ANIM_TAG_" optional). `frames` picks from the entry's
    own list by position (e.g. frames=[0, 2]) or None for all; opts override tint / hue / scale / flip.
    CFRU sources go through cfru_cells (frame size, palette pair, CFRU_BOXES)."""
    tag = tag.replace("ANIM_TAG_", "")
    e = SUBS[tag]
    fr = e["frames"] if frames is None else [e["frames"][i] for i in frames]
    kw = {k: e[k] for k in ("size", "scale", "tint", "hue", "flip", "palette", "alpha") if k in e}
    kw.update(opts)
    if e["src"].startswith("cfru:"):
        kw.pop("size", None)
        return cfru_cells(a, e["src"][5:], frames=fr, **kw)
    return a.cells(e["src"], frames=fr, **kw)


# Tags that inventory/cfru_particles.json lists under "vanilla_tags_used_by_max_scripts_not_in_download" although
# CFRU ships its own art for them (extract/particles.json: weHaveIt, "CFRU replaces the vanilla ..."). They need no
# substitute: tag_cells() takes the CFRU file (with its palette pair).
CFRU_REPLACED = {
    "VERTICAL_HEX": "Image_Only/Arrows.png drawn with Palette_Only/Fusion_Flare.bmp (not Hexes.png)",
    "SMALL_EMBER": "Embers.png (5 flame frames, 32x32)",
    "LEAF": "Leaves.png (9 leaves cut by CFRU_BOXES: the sheet is not a 16 px grid)",
    "SEED": "Leech_Seed.png (seed, sprout, sprout)",
    "SHARP_TEETH": "Teeth.png (Max Flare / Wildfire / Centiferno load it only as a spare palette slot)",
    "ICE_ROCK_SINGLE": "Ice_Rock.png (first 3 frames)",
    "STONE_PILLAR_MULTI": "Stone_Pillar.png (first 3 frames)",
    "HANDS_AND_FEET": "Thrash.png (fist, paw, foot, hand)",
    "EYE": "Mean_Look.png (64x64)",
}


# ----------------------------------------------------------------------------------------------------------------------
# CFRU particles: frame sizes, palette pairs, tag lookup
# ----------------------------------------------------------------------------------------------------------------------
_cfru = None


def _load_cfru():
    global _cfru
    if _cfru is None:
        with open(os.path.join(INVENTORY, "cfru_particles.json"), encoding="utf-8") as fh:
            _cfru = {p["file"]: p for p in json.load(fh)["particles"]}
    return _cfru


# frame sizes the inventory guessed wrong (its "heuristic: square frames" fallback), checked by eye on the image
FRAME_SIZE_FIX = {
    # 32x448: seven 32x64 columns growing from the ground (Max Ooze / G-Max Malodor), not fourteen 32x32 halves
    "Poison_Column.png": (32, 64),
    "Palette_Only/Garbage_Poison_Column.png": (32, 64),
}


def cfru_info(file):
    """inventory/cfru_particles.json entry: frame_size (w, h), frames, palette_16, ... for a CFRU particle file
    (with FRAME_SIZE_FIX applied)."""
    info = dict(_load_cfru()[file])
    if file in FRAME_SIZE_FIX:
        w, h = FRAME_SIZE_FIX[file]
        iw, ih = info["size"]
        info["frame_size"] = [w, h]
        info["frames"] = (iw // w) * (ih // h)
    return info


# CFRU sheets whose pictures are not on a regular frame grid: explicit (x, y, w, h) boxes, one per "frame", found as
# the connected sprites of the PNG and checked by eye. Leaves.png (48x48) is a wallpaper of nine leaves at different
# angles; its 16 px grid cuts most of them in half (one leaf wraps over the top / bottom edge and is left out).
CFRU_BOXES = {
    "Leaves.png": [(1, 1, 15, 14), (16, 8, 15, 14), (17, 25, 15, 13), (33, 33, 15, 15),
                   (36, 2, 12, 10), (36, 17, 12, 12), (0, 18, 13, 12), (1, 34, 12, 12)],
}


def cfru_cells(a, file, frames=None, scale=None, palette=None, **opts):
    """Cells of a CFRU particle with its correct frame size (frames stacked vertically), or its CFRU_BOXES.
    scale None = automatic: 2 (the usual whole-number upscale; a 32 px particle at zoom 65 is about GBA size x 1.3)
    when a frame fits 48 px, else 1 (a 64 px frame at scale 2 would be cropped to the 96 px cell); set zoom on
    the sprite for the final size."""
    info = cfru_info(file)
    w, h = info["frame_size"]
    boxes = CFRU_BOXES.get(file)
    if boxes:
        w, h = max(b[2] for b in boxes), max(b[3] for b in boxes)
    if frames is None:
        frames = list(range(len(boxes) if boxes else info["frames"]))
    if scale is None:
        scale = 2 if max(w, h) <= 48 else 1
    if max(w, h) * scale > 96:
        raise ValueError(f"{file}: a {w}x{h} frame at scale {scale} does not fit the 96 px cell; use scale 1 + zoom")
    if palette is None and file in PALETTE_PAIRS:
        palette = PALETTE_PAIRS[file]
    if palette:
        opts["palette"] = palette
    if boxes:
        out = []
        for f in frames:
            out += a.cells("cfru:" + file, frames=[0], box=boxes[f % len(boxes)], scale=scale, **opts)
        return out
    return a.cells("cfru:" + file, frames=frames, size=(w, h), scale=scale, **opts)


# Image_Only graphics and the Palette_Only palette CFRU draws them with (from extract/particles.json)
PALETTE_PAIRS = {
    "Image_Only/Arrows.png": "Palette_Only/Fusion_Flare.bmp",      # ANIM_TAG_VERTICAL_HEX (the NEN geyser hexes)
    "Image_Only/Anchor.png": "Palette_Only/Natural_Gift_Ring.bmp",  # ANIM_TAG_ANCHOR
}

# tags we have as CFRU files: tag -> (image file, palette file or None)
CFRU_TAGS = {}


def _load_tags():
    if CFRU_TAGS:
        return CFRU_TAGS
    with open(os.path.join(EXTRACT, "particles.json"), encoding="utf-8") as fh:
        for p in json.load(fh)["particles"]:
            if p.get("weHaveIt") and p.get("imageFile"):
                img, pal = p["imageFile"], p.get("paletteFile")
                CFRU_TAGS[p["tag"].replace("ANIM_TAG_", "")] = (img, pal if pal and pal != img else None)
    return CFRU_TAGS


def tag_cells(a, tag, frames=None, scale=None, **opts):
    """Cells for a CFRU ANIM_TAG: the CFRU file (with its palette pair) when the download has it, else SUBS."""
    tag = tag.replace("ANIM_TAG_", "")
    tags = _load_tags()
    if tag in tags:
        img, pal = tags[tag]
        if pal and "palette" not in opts:
            opts["palette"] = pal  # e.g. GARBAGE_COLUMN = the Poison_Column picture with the garbage palette
        return cfru_cells(a, img, frames=frames, scale=scale, **opts)
    if tag in SUBS:
        return sub_cells(a, tag, frames=frames, **opts)
    raise KeyError(f"no CFRU file or substitute for ANIM_TAG_{tag}")


# ----------------------------------------------------------------------------------------------------------------------
# sounds: GBA song ids the Max scripts play -> existing files in assets/audio/battle_anims
# (picked from inventory/sounds.json gba_se_candidates; short files preferred, because the longest sound in a file
#  sets the end hold to about half its length; "PRSFX- " files play at half volume in the game)
# ----------------------------------------------------------------------------------------------------------------------
SE = {
    "SE_M_SELF_DESTRUCT": "PRSFX- Selfedestruct2.wav",  # 0xAA, every geyser puff (1.13 s; the file name is misspelt)
    "SE_M_EXPLOSION": "PRSFX- Explosion.wav",           # 0xAB (1.51 s)
    "SE_M_MEGA_KICK": "PRSFX- Megakick.wav",            # 0x85, Flare / Starfall / Smite opening (0.98 s)
    "SE_M_MEGA_KICK2": "Mega Punch.m4a",                # 0x86, Rockfall / Steelspike hits (0.97 s)
    "SE_M_STRENGTH": "PRSFX- Strength.wav",             # 0xCF, Strike rumble (0.91 s)
    "SE_M_FLAME_WHEEL": "PRSFX- Flame Wheel1.wav",      # 0x89
    "SE_M_FLAME_WHEEL2": "PRSFX- Flame Wheel2.wav",     # 0x8A, Flare fireballs (0.76 s)
    "SE_M_THUNDERBOLT2": "PRSFX- Thunderbolt2.wav",     # 0x70
    "SE_M_THUNDER_WAVE": "PRSFX- Thunder Wave.wav",     # 0x83
    "SE_M_TRI_ATTACK2": "PRSFX- Spark2.wav",            # 0xD6, electric pillars (Tri Attack is 3.2 s)
    "SE_M_NIGHTMARE": "PRSFX- Nightmare.wav",           # 0x72
    "SE_M_BUBBLE3": "PRSFX- Bubble.wav",                # 0x77
    "SE_M_STRING_SHOT": "PRSFX- String Shot1.wav",      # 0x7A
    "SE_M_ROCK_THROW": "PRSFX- Rock Throw1.wav",        # 0x7C
    "SE_M_GUST2": "gust.m4a",                           # 0x7E
    "SE_M_GUST": "gust.m4a",                            # 0x7D
    "SE_M_DOUBLE_SLAP": "PRSFX- Double Slap.wav",       # 0x7F (1.9 s: ~1 s end hold)
    "SE_M_DOUBLE_TEAM": "PRSFX- Double Team.wav",       # 0x80
    "SE_M_CRABHAMMER": "PRSFX- Crabhammer.wav",         # 0x87
    "SE_M_JUMP_KICK": "PRSFX- Jump Kick1.wav",          # 0x88
    "SE_M_SCRATCH": "PRSFX- Scratch.wav",               # 0x94
    "SE_M_RAZOR_WIND2": "PRSFX- Razor Wind2.wav",       # 0x99
    "SE_M_HYDRO_PUMP": "PRSFX- Hydro Pump.wav",         # 0x9D
    "SE_M_HORN_ATTACK": "PRSFX- Horn Attack.wav",       # 0x9F
    "SE_M_DRAGON_RAGE": "PRSFX- Dragon Rage.wav",       # 0xA4
    "SE_M_BELLY_DRUM": "PRSFX- Belly Drum.wav",         # 0xB2
    "SE_M_METRONOME": "PRSFX- Metronome.wav",           # 0xB3
    "SE_M_PSYBEAM": "PRSFX- Psybeam.wav",               # 0xB6 (1.63 s)
    "SE_M_PSYBEAM2": "PRSFX- Psybeam.wav",              # 0xC1 (1.63 s)
    "SE_M_LEER": "PRSFX- Leer.wav",                     # 0xB9
    "SE_M_SWAGGER": "PRSFX- Swagger2.wav",              # 0xBA
    "SE_M_CONFUSE_RAY": "PRSFX- Confuse Ray.wav",       # 0xBD
    "SE_M_GIGA_DRAIN": "PRSFX- Giga Drain2.wav",        # 0xC0
    "SE_M_SOLAR_BEAM": "PRSFX- Solar Beam2.wav",        # 0xC2 (1.74 s)
    "SE_M_MINIMIZE": "PRSFX- Minimize1.wav",            # 0xC5
    "SE_M_REFLECT": "PRSFX- Reflect.wav",               # 0xC8 (2.0 s: ~1 s end hold)
    "SE_M_DETECT": "PRSFX- Detect.wav",                 # 0xCA
    "SE_M_DIG": "PRSFX- Dig2.wav",                      # 2026-11-19 (review): vanilla GROUND_DIGGING; Dig1 is 1.35 s
    "SE_M_SAND_ATTACK": "PRSFX- Sand Attack.wav",       # 2026-11-19 (review): 0x98, Flutterby / Phantasm objects
    "SE_M_PROTECT": "PRSFX- Protect.wav",               # 2026-11-19 (review): Max Guard (shorter than Reflect)
    "SE_M_SAND_TOMB": "PRSFX- Sand Tomb.wav",           # 0xDF
    "SE_M_TWISTER": "PRSFX- Twister.wav",               # 0xE4 (1.69 s)
    "SE_FALL": "PRSFX- Sky Drop2.wav",                  # 0x25, falling rocks / stars (1.05 s)
    "SE_WARP_IN": "PRSFX- Teleport.wav",                # 0x27
    "SE_SHIP": "PRSFX- Horn Drill2.wav",                # 0x13 (a horn blast; rough)
    "SE_LEDGE": "PRSFX- Bounce4.wav",                   # 0x0A (rough)
    # common move SEs that are not in the Max scripts but useful
    "SE_M_FLAMETHROWER": "PRSFX- Flamethrower.wav",
    "SE_M_EMBER": "PRSFX- Ember.wav",
    "SE_M_THUNDERBOLT": "PRSFX- Thunderbolt2.wav",
    "SE_M_EARTHQUAKE": "PRSFX- Earthquake1.wav",
    "SE_M_HAIL": "PRSFX- Hail.wav",
    "SE_M_ICY_WIND": "PRSFX- Icy Wind2.wav",
    "SE_M_SURF": "PRSFX- Water Pulse.wav",
    "SE_M_BARRIER": "PRSFX- Barrier.wav",
    "SE_M_STAT_INCREASE": "PRSFX- Stat Up.wav",
    "SE_M_STAT_DECREASE": "PRSFX- Stat Down.wav",
    "SE_M_SACRED_FIRE": "PRSFX- Sacred Fire1.wav",     # 1.0 s (Sacred Fire2 is 3.8 s)
    "SE_M_HEAT_WAVE": "PRSFX- Heat Wave.wav",           # 2.1 s: about 1 s of end hold
    "SE_M_CHARGE": "PRSFX- Charge.wav",
    "SE_M_WATERFALL": "PRSFX- Waterfall2.wav",          # 0.65 s (Waterfall1 is 2.1 s)
    "SE_M_HYPER_BEAM": "PRSFX- Hyper Beam.wav",         # 2.5 s: about 1.2 s of end hold, use early or not at all
    "SE_M_SANDSTORM": "PRSFX- Sandstorm.wav",
    "SE_M_BLIZZARD": "PRSFX- Petal Blizzard2.wav",      # 1.2 s wind; Blizzard itself is 2.8 s
    "SE_M_TOXIC": "PRSFX- Toxic1.wav",
    "SE_M_PETAL_DANCE": "PRSFX- Petal Dance.wav",
    "SE_M_COMET_PUNCH": "PRSFX- Comet Punch.wav",
    "SE_M_SWORDS_DANCE": "PRSFX- Swords Dance2.wav",
    "SE_M_MOONLIGHT": "PRSFX- Moonlight.wav",
}
SE_NOTES = {
    "SE_SHIP": "no ship horn in the game; Horn Drill2 is a rough stand-in",
    "SE_LEDGE": "no ledge hop; Bounce4 is a rough stand-in",
    "SE_M_TRI_ATTACK2": "Tri Attack is 3.2 s (1.6 s end hold); Spark2 is short",
}


_SOUND_SECS = None


def sound_secs(file):
    """Length in seconds of a battle_anims sound (inventory/sounds.json), or None."""
    global _SOUND_SECS
    if _SOUND_SECS is None:
        _SOUND_SECS = {}
        try:
            with open(os.path.join(INVENTORY, "sounds.json"), encoding="utf-8") as fh:
                for s in json.load(fh).get("sounds", []):
                    if s.get("source") == "pokerogue" and s.get("duration_s") is not None:
                        _SOUND_SECS[s["file"]] = s["duration_s"]
        except OSError:
            pass
    return _SOUND_SECS.get(file)


def se(a, t, name, volume=100, pitch=100):
    """Play the game file mapped to a GBA SE name (SE dict) at frame t. 2026-11-19: adds a build-report note when
    the file is longer than 1.6 s (the end hold is about half the longest sound: over 0.8 s of dead time)."""
    f = SE[name]
    if not os.path.exists(os.path.join(AUDIO_DIR, f)):
        raise FileNotFoundError(f"{name} -> {f} is not in assets/audio/battle_anims")
    secs = sound_secs(f)
    # 2026-11-19 (review): the engine's end hold is ceil(totalDuration * 1000 / 33.33), the file length whatever the
    # pitch (battle-anims.ts AnimTimedSoundEvent.execute), so pitch does not shorten it
    if secs is not None and secs > 1.6:
        a.note(f"se: {name} -> '{f}' is {secs:.2f} s: about {secs / 2:.1f} s of end hold; prefer a shorter SE")
    a.sound(t, f, volume=volume, pitch=pitch)
    return t


# ----------------------------------------------------------------------------------------------------------------------
# the geyser (CFRU EXPLOSION_GEYSER family) and the big glowing orb
# ----------------------------------------------------------------------------------------------------------------------
# the 15 explosion puffs of every CFRU geyser, GBA px from the target centre, one per GBA frame
GEYSER_PUFFS = [(3, 5), (-11, -15), (8, -5), (-6, 18), (0, 5), (3, -11), (-11, -31), (8, -21), (-6, 2), (0, -11),
                (3, -27), (-11, -47), (8, -37), (-6, -14), (0, -27)]
# x of the rising particles (SpriteCB_Geyser at target (x, +16)), cycling; 0x100D wraps to +13 and drifts right
_RISE_X = [(-4, -1), (13, 1), (4, -1), (-16, -1)]

# typed rising particles: kind -> list of (source, frames, opts, zoom, blend); a list entry per particle family,
# used alternately (e.g. leaf + spore). Sources: "tag:<ANIM_TAG>" (tag_cells: the CFRU file or its SUBS entry, the
# way the scripts name them), "sub:<tag>" (SUBS), "cfru:<file>" (cfru_cells) or "pr:" / "es:" (a.cells).
GEYSER_RISE = {
    "fire": [("tag:SMALL_EMBER", [1, 2, 3, 2], {}, 70, "normal")],                     # MAX_FLARE_GEYSER_FLAME
    "ghost": [("tag:VERTICAL_HEX", [0, 1, 2, 3, 4, 5, 6, 7, 8],
               {"tint": (41, 0, 189, 0.62)}, 75, "normal")],                          # NEN_GEYSER_HEX, 10/16 0x5C05
    "psychic": [("tag:NEEDLE", [0], {"tint": (115, 255, 255, 0.62)}, 60, "normal")],   # 10/16 toward 0x7FEE
    "grass": [("tag:LEAF", [0, 1, 2, 3, 4, 5, 6, 7], {}, 75, "normal"),
              ("sub:SPORE", [0], {}, 100, "normal")],                                 # LEAVES_COTTON: leaf + spore
    "ground": [("tag:ROCKS", [0, 2, 4], {}, 45, "normal"),
               ("sub:MUD_SAND", [0, 1, 2], {}, 100, "normal")],                       # DIRT_GEYSER: rock + mud
    "coin": [("sub:COIN", [0, 1, 2, 3], {}, 130, "normal")],                          # Gold Rush
    "heart": [("sub:RED_HEART", [0], {}, 120, "normal")],                             # Cuddle
    "berry": [("tag:BERRY_NORMAL", [0, 1], {}, 45, "normal")],                        # Replenish
    "apple": [("tag:LEAF", [0, 1, 2, 3, 4, 5, 6, 7], {}, 75, "normal"),
              ("tag:APPLE", [0], {}, 45, "normal")],                                  # Tartness / Sweetness
}


def source_cells(a, src, frames=None, **opts):
    """Cells from any source string: "tag:<ANIM_TAG>" | "sub:<tag>" | "cfru:<file>" | "pr:<sheet>" | "es:<sheet>"."""
    kind, name = src.split(":", 1)
    if kind == "tag":
        return tag_cells(a, name, frames=frames, **opts)
    if kind == "sub":
        return sub_cells(a, name, frames=frames, **opts)
    if kind == "cfru":
        opts.pop("size", None)
        return cfru_cells(a, name, frames=frames, **opts)
    return a.cells(src, frames=frames if frames is not None else [0], **opts)


def _rise_cells(a, kind):
    if isinstance(kind, dict):
        return [(kind["cells"], kind.get("zoom", 100), kind.get("blend", "normal"))]
    if isinstance(kind, (list, tuple)) and kind and isinstance(kind[0], int):
        return [(list(kind), 100, "normal")]
    fams = GEYSER_RISE[kind]
    return [(source_cells(a, src, frames=list(fr), **dict(opts)), zoom, blend) for src, fr, opts, zoom, blend in fams]


def geyser(a, t0, kind=None, count=3, gap=5, puffs=8, puff_life=6, puff_zoom=100, puff_tint="type", type_=None,
           rises=6, rise_speed=16, rise_life=6, sound=True, priority=1, puff_cells=None, puff_opacity=235):
    """The shared CFRU geyser sub-script (EXPLOSION_GEYSER, MAX_FLARE_GEYSER, NEN_GEYSER, MINDSTORM_GEYSER, ...):
    explosion puffs climbing from the target's feet to above its head (CFRU: 15 puffs, one per GBA frame, i.e. a
    column in about 5 of our frames) plus, for the typed geysers, particles shooting straight up from below the
    target (CFRU SpriteCB_Geyser: 4 GBA px per GBA frame, about 16 anim px per frame). Called `count` times `gap`
    frames apart (CFRU: 3x, 14 GBA f apart).

    kind: None (plain EXPLOSION_GEYSER) | a GEYSER_RISE key ("fire", "ghost", "psychic", "grass", "ground", "coin",
          "heart", "berry", "apple") | a list of cell indices | {"cells": [...], "zoom": z, "blend": "add"}.
    type_: the move type, for the puff tint (TYPE_COLORS puff_tint); puff_tint=None keeps orange, or pass a tint.
    puffs / rises: how many of CFRU's 15 puffs / 16 risers to keep per call (budget: about 24 graphics a frame).
    The puff is UNUSED_EXPLOSION_2's substitute (SUBS) unless puff_cells is given. Returns the frame the last
    column finishes."""
    if puff_tint == "type":
        puff_tint = TYPE_COLORS[type_]["puff_tint"] if type_ else None
    if puff_cells is None:
        opts = {"tint": puff_tint} if puff_tint else {}
        n = len(SUBS["UNUSED_EXPLOSION_2"]["frames"])
        # resample the bloom to puff_life frames (only those cells go into the sheet)
        picks = [min(n - 1, int(i * n / puff_life)) for i in range(puff_life)]
        uniq = sorted(set(picks))
        made = dict(zip(uniq, sub_cells(a, "UNUSED_EXPLOSION_2", frames=uniq, **opts)))
        puff_cells = [made[p] for p in picks]
    fams = _rise_cells(a, kind) if kind is not None else []
    end = t0
    for g in range(count):
        tg = t0 + g * gap
        if sound:
            se(a, tg, "SE_M_SELF_DESTRUCT", volume=90 if g else 100, pitch=100 + 6 * g)
        idx = [int(round(i * (len(GEYSER_PUFFS) - 1) / max(1, puffs - 1))) for i in range(puffs)]
        for i in idx:
            gx, gy = GEYSER_PUFFS[i]
            ts = tg + i // 3   # one CFRU puff per GBA frame = 3 per anim frame
            s = a.sprite(puff_cells, ts, ts + len(puff_cells), focus="target", priority=priority, loop=False,
                         pos=at_target(*gba(gx, gy)), zoom=puff_zoom)
            s.fade(puff_opacity, puff_opacity, t_from=0, t_to=len(puff_cells) - 3)
            s.fade(puff_opacity, puff_opacity // 2, t_from=len(puff_cells) - 3, t_to=len(puff_cells) - 1)
            end = max(end, ts + len(puff_cells))
        for j in range(rises if fams else 0):
            cells, zoom, blend = fams[j % len(fams)]
            # 2026-11-19 (review): with gap 5 the risers that columns g and g + 1 launch on the same frame shared a
            # lane (j + g and j - gap + g + 1 are equal mod 4) and were drawn on top of each other; now 2 lanes apart
            rx, drift = _RISE_X[(j + g * (gap + 2)) % len(_RISE_X)]
            ts = tg + j
            x0, y0 = gba(rx, 16)
            s = a.sprite(cells, ts, ts + rise_life, focus="target", blend=blend, priority=priority, cell_every=1,
                         zoom=zoom)
            s.move(at_target(x0, y0), at_target(x0 + drift * 2 * rise_life, y0 - rise_speed * rise_life))
            s.fade(255, 255, t_from=0, t_to=rise_life - 2)
            s.fade(255, 0, t_from=rise_life - 2, t_to=rise_life)
            end = max(end, ts + rise_life)
    return end


def big_orb(a, t0, cells=None, focus="target", pos=None, tint=None, size=200, grow=5, hold=16, shrink=5,
            blend="add", priority=1, opacity=230):
    """CFRU's big glowing orb finish (CIRCLE_OF_LIGHT 64x64 via AnimGrowingChargeOrb + the MushroomCloud affine: grows
    from 1/16 to ~2x in 15 GBA f, holds 48 f, shrinks in 15 f). Ours: grow / hold / shrink frames, `size` = the peak
    zoom of the CIRCLE_OF_LIGHT substitute (175 = GBA 1x; CFRU's 2x would be 350, use 200-260 to keep the target
    visible). Additive by default. Returns the frame it ends."""
    if cells is None:
        cells = sub_cells(a, "CIRCLE_OF_LIGHT", **({"tint": tint} if tint else {}))
    if pos is None:
        pos = at_target() if focus == "target" else (at_user() if focus == "user" else (128, -64))
    t3 = t0 + grow + hold + shrink
    s = a.sprite(cells, t0, t3, focus=focus, blend=blend, priority=priority, pos=pos)
    s.key(0, zoom=size / 16, opacity=opacity)
    s.key(grow, zoom=size, ease="out")
    s.key(grow + hold, zoom=size * 0.95)
    s.key(grow + hold + shrink - 1, zoom=size / 10, opacity=opacity * 0.6, ease="in")
    return t3
