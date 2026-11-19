# Local fork (2026-11-18): a small choreography builder for PokeRogue move animations (Max / G-Max / Max Guard).
# The user: "CFRU 받아서 만들기" — rebuild the Complete FireRed Upgrade (Skeli) Max Move animations in PokeRogue's
# battle-anims JSON format. Each move is a Python spec (specs/<id>.py, a `build(a)` function) that places sprites
# with keyframes; this module turns it into
#   - assets/battle-anims/<kebab id>.json  (one AnimConfig object, played for both sides: focus USER_TARGET mirrors)
#   - assets/images/battle_anims/<sheet>.png (a composite sheet of 96x96 cells, 5 per row: one graphic per animation)
#   - preview/<id>.png (a contact sheet of rendered frames) for review.
# Run with an interpreter that has Pillow (the ComfyUI embedded Python), always with -I:
#   python.exe -I maxanim.py build  [ids...] [--no-write] [--gif]   compile specs (all when no ids), write game files +
#                                    previews (<id>.png player side, <id>_opp.png enemy side, --gif: animated copies)
#   python.exe -I maxanim.py preview <id>                    preview only
#
# Engine facts this relies on (src/data/battle-anims.ts):
# - one frame = getFrameMs(3) = 50 ms (20 fps). Every frame lists the user cel (target 0), the target cel (target 1)
#   and the graphic cels (target 2) in draw-index order; the real battler sprites are hidden on frame 0 and only the
#   cels are shown, so EVERY frame carries both battler cels.
# - anim space: user focus point (0, 0), target focus point (128, -64). focus 3 (USER_TARGET) maps that line onto the
#   real user -> target line (an enemy user mirrors it, and graphics flip), focus 1 / 2 are offsets from the target /
#   user, focus 4 (SCREEN) is the field position (x + 106, y + 116).
# - graphics take x, y, zoomX / zoomY (percent), angle (degrees, counter-clockwise), mirror, opacity 0-255, blendType
#   (0 normal, 1 add, 2 subtract -> Phaser DIFFERENCE), visible, priority (0-3), graphicFrame. Tone / color are NOT
#   applied to graphics (bake tints into the sheet); battler cels take tone [r, g, b, gray] (-255..255) and opacity.
# - backgrounds: AnimTimedAddBgEvent (image from battle_anims, or "" for a black rectangle) with opacity, then
#   AnimTimedUpdateBgEvent tweens opacity / bgX / bgY over `duration` frames.
import json
import math
import os
import re
import sys
import importlib.util

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
POKEROGUE = "D:/PokeRogueDev/pokerogue"
ANIM_DIR = os.path.join(POKEROGUE, "assets", "battle-anims")
SHEET_DIR = os.path.join(POKEROGUE, "assets", "images", "battle_anims")
AUDIO_DIR = os.path.join(POKEROGUE, "assets", "audio", "battle_anims")
CFRU_DIR = "D:/PokeRogueDev/downloads/cfru_20261118/Attack_Particles"
# The Pokemon Essentials v21.1 project for "es:" sources (none of the 38 specs uses one); set ESSENTIALS_DIR to use it
ESSENTIALS = os.environ.get("ESSENTIALS_DIR", "")
SPEC_DIR = os.path.join(HERE, "specs")
PREVIEW_DIR = os.path.join(HERE, "preview")
CELL = 96
COLS = 5
FOCUS = {"target": 1, "user": 2, "user_target": 3, "screen": 4}
BLEND = {"normal": 0, "add": 1, "sub": 2}
USER_PT = (0.0, 0.0)
TARGET_PT = (128.0, -64.0)


def kebab(move_id: str) -> str:
    """The game's toKebabCase for MoveId names (2026-11-19: runs of _ - or space become one '-', as the engine does;
    the old replace() gave 'a--b' for a double underscore)."""
    return re.sub(r"[-_ ]+", "-", move_id.strip("_- ")).lower()


_move_ids = None


def known_move_id(move_id):
    """True when MOVE_ID is a MoveId enum name in the fork (src/enums/move-id.ts, read only), None when unreadable.
    (2026-11-19: CFRU labels such as G_MAX_VOLTCRASH differ from the MoveIds such as G_MAX_VOLT_CRASH; a wrong name
    writes a file the game never fetches.)"""
    global _move_ids
    if _move_ids is None:
        try:
            with open(os.path.join(POKEROGUE, "src", "enums", "move-id.ts"), encoding="utf-8") as fh:
                _move_ids = set(re.findall(r"^\s*([A-Z0-9_]+)\s*[,=]", fh.read(), re.M))
        except OSError:
            _move_ids = set()
    return (move_id in _move_ids) if _move_ids else None


# ----------------------------------------------------------------------------------------------------------------------
# easing / interpolation
# ----------------------------------------------------------------------------------------------------------------------
def ease(kind, u):
    u = max(0.0, min(1.0, u))
    if kind in (None, "linear"):
        return u
    if kind == "in":
        return u * u
    if kind == "out":
        return 1 - (1 - u) * (1 - u)
    if kind == "inout":
        return 3 * u * u - 2 * u * u * u
    if kind == "in3":
        return u * u * u
    if kind == "out3":
        return 1 - (1 - u) ** 3
    if kind == "step":
        return 0.0 if u < 1 else 1.0
    raise ValueError(f"unknown ease {kind}")


def lerp(a, b, u):
    if isinstance(a, (list, tuple)):
        return [lerp(x, y, u) for x, y in zip(a, b)]
    return a + (b - a) * u


class Track:
    """Keyframes of one property: [(t, value, ease_into_this_key)], t in frames relative to the owner's start."""

    def __init__(self, default):
        self.default = default
        self.keys = []

    def set(self, t, v, e=None):
        self.keys.append((t, v, e))
        self.keys.sort(key=lambda k: k[0])

    def at(self, t):
        if not self.keys:
            return self.default
        if t <= self.keys[0][0]:
            return self.keys[0][1]
        for (t0, v0, _), (t1, v1, e1) in zip(self.keys, self.keys[1:]):
            if t0 <= t <= t1:
                if t1 == t0:
                    return v1
                return lerp(v0, v1, ease(e1, (t - t0) / (t1 - t0)))
        return self.keys[-1][1]


# ----------------------------------------------------------------------------------------------------------------------
# sheet sources
# ----------------------------------------------------------------------------------------------------------------------
_img_cache = {}


def _load(path):
    if path not in _img_cache:
        _img_cache[path] = Image.open(path).convert("RGBA")
    return _img_cache[path]


def _pr_frame(sheet, frame):
    img = _load(os.path.join(SHEET_DIR, sheet + ".png"))
    cols = img.width // CELL
    x, y = (frame % cols) * CELL, (frame // cols) * CELL
    return img.crop((x, y, x + CELL, y + CELL))


def _es_frame(sheet, pattern):
    """An Essentials Graphics/Animations pattern (192px cells, 5 per row) halved by point sampling, as the game does."""
    img = _load(os.path.join(ESSENTIALS, "Graphics", "Animations", sheet + ".png"))
    x, y = (pattern % 5) * 192, (pattern // 5) * 192
    big = img.crop((x, y, x + 192, y + 192))
    out = Image.new("RGBA", (CELL, CELL))
    bp, op = big.load(), out.load()
    for j in range(CELL):
        for i in range(CELL):
            op[i, j] = bp[2 * i + 1, 2 * j + 1]
    return out


def _cfru_frame(name, frame, w, h, palette=None):
    """One frame of a CFRU particle (frames stacked vertically, w x h each). `palette`: another CFRU image whose
    colours replace this one's by palette index (for Image_Only / Palette_Only pairs)."""
    path = os.path.join(CFRU_DIR, name)
    raw = Image.open(path)
    if palette:
        pal = Image.open(os.path.join(CFRU_DIR, palette))
        if raw.mode == "P" and pal.mode == "P":
            raw = raw.copy()
            raw.putpalette(pal.getpalette())
            if "transparency" in pal.info:
                raw.info["transparency"] = pal.info["transparency"]
    if raw.mode == "P":
        # GBA: palette index 0 is transparent
        rgba = raw.convert("RGBA")
        idx = raw.load()
        px = rgba.load()
        for j in range(raw.height):
            for i in range(raw.width):
                if idx[i, j] == 0:
                    px[i, j] = (0, 0, 0, 0)
        img = rgba
    else:
        img = raw.convert("RGBA")
    cols = max(1, img.width // w)
    fx, fy = (frame % cols) * w, (frame // cols) * h
    return img.crop((fx, fy, fx + w, fy + h))


def _tint(img, rgb, amount):
    """Mix every visible pixel's colour toward `rgb` by `amount` (0..1), keeping alpha and brightness shape."""
    out = img.copy()
    px = out.load()
    for j in range(out.height):
        for i in range(out.width):
            r, g, b, a = px[i, j]
            if a:
                lum = (r * 299 + g * 587 + b * 114) / 1000 / 255
                tr, tg, tb = (c * (0.35 + 0.9 * lum) for c in rgb)
                px[i, j] = (
                    int(min(255, r + (tr - r) * amount)),
                    int(min(255, g + (tg - g) * amount)),
                    int(min(255, b + (tb - b) * amount)),
                    a,
                )
    return out


def _hue(img, degrees):
    import colorsys

    out = img.copy()
    px = out.load()
    d = degrees / 360.0
    for j in range(out.height):
        for i in range(out.width):
            r, g, b, a = px[i, j]
            if a:
                h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
                r2, g2, b2 = colorsys.hls_to_rgb((h + d) % 1.0, l, s)
                px[i, j] = (int(r2 * 255), int(g2 * 255), int(b2 * 255), a)
    return out


def _box_crop(src_kind, name, box, palette=None):
    """2026-11-19: crop an explicit (x, y, w, h) rectangle of a source image instead of a frame of its grid (for
    sheets whose pictures are not on a regular grid, e.g. CFRU's Leaves.png). pr: the whole PokeRogue sheet; cfru:
    the whole particle PNG (palette pair and index-0 transparency applied); es: the whole Essentials sheet, halved
    like the game (box in the halved sheet's pixels)."""
    x, y, w, h = (int(v) for v in box)
    if src_kind == "pr":
        img = _load(os.path.join(SHEET_DIR, name + ".png"))
    elif src_kind == "cfru":
        full = Image.open(os.path.join(CFRU_DIR, name))
        img = _cfru_frame(name, 0, full.width, full.height, palette)
    elif src_kind == "es":
        big = _load(os.path.join(ESSENTIALS, "Graphics", "Animations", name + ".png"))
        img = big.resize((big.width // 2, big.height // 2), Image.NEAREST)
    else:
        raise ValueError(src_kind)
    return img.crop((x, y, x + w, y + h))


def make_cell(src, frame=0, size=None, scale=1, tint=None, hue=None, flip=False, palette=None, alpha=None, box=None):
    """src: 'pr:<PokeRogue sheet>' | 'es:<Essentials sheet>' | 'cfru:<file>' ; returns a 96x96 RGBA cell.
    box=(x, y, w, h) (added 2026-11-19) crops that rectangle of the source instead of grid frame `frame`."""
    kind, name = src.split(":", 1)
    if box is not None:
        img = _box_crop(kind, name, box, palette)
    elif kind == "pr":
        img = _pr_frame(name, frame)
    elif kind == "es":
        img = _es_frame(name, frame)
    elif kind == "cfru":
        w, h = size or (16, 16)
        img = _cfru_frame(name, frame, w, h, palette)
    else:
        raise ValueError(src)
    if scale != 1:
        img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.NEAREST)
    if flip:
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
    if hue:
        img = _hue(img, hue)
    if tint:
        img = _tint(img, tint[:3], tint[3] if len(tint) > 3 else 0.6)
    if alpha is not None:
        a = img.getchannel("A").point(lambda v: int(v * alpha))
        img.putalpha(a)
    cell = Image.new("RGBA", (CELL, CELL))
    if img.width > CELL or img.height > CELL:
        l, t = (img.width - CELL) // 2, (img.height - CELL) // 2
        img = img.crop((max(0, l), max(0, t), max(0, l) + min(CELL, img.width), max(0, t) + min(CELL, img.height)))
    cell.paste(img, ((CELL - img.width) // 2, (CELL - img.height) // 2), img)
    return cell


# ----------------------------------------------------------------------------------------------------------------------
# the builder
# ----------------------------------------------------------------------------------------------------------------------
class Sprite:
    def __init__(self, anim, cells, t0, t1, focus, blend, priority, cell_every, loop, mirror, order):
        self.anim, self.cells, self.t0, self.t1 = anim, list(cells), t0, t1
        self.focus, self.blend, self.priority = focus, blend, priority
        self.cell_every, self.loop, self.mirror, self.order = max(1, cell_every), loop, mirror, order
        self.x, self.y = Track(0.0), Track(0.0)
        self.zx, self.zy = Track(100.0), Track(100.0)
        self.angle, self.opacity = Track(0.0), Track(255.0)
        self.cell_override = None

    # all keyframe helpers take times RELATIVE to t0 unless absolute=True
    def _t(self, t, absolute):
        return t - self.t0 if absolute else t

    def key(self, t, absolute=False, ease=None, **props):
        t = self._t(t, absolute)
        for k, v in props.items():
            if k == "pos":
                self.x.set(t, float(v[0]), ease)
                self.y.set(t, float(v[1]), ease)
            elif k == "zoom":
                self.zx.set(t, float(v), ease)
                self.zy.set(t, float(v), ease)
            elif k in ("x", "y"):
                getattr(self, k).set(t, float(v), ease)
            elif k == "zoomX":
                self.zx.set(t, float(v), ease)
            elif k == "zoomY":
                self.zy.set(t, float(v), ease)
            elif k in ("angle", "opacity"):
                getattr(self, k).set(t, float(v), ease)
            else:
                raise ValueError(f"unknown prop {k}")
        return self

    def move(self, a, b, ease=None, t_from=0, t_to=None):
        """Straight line from a to b over [t_from, t_to] (relative; t_to defaults to the life end)."""
        t_to = (self.t1 - self.t0) if t_to is None else t_to
        self.key(t_from, pos=a)
        self.key(t_to, pos=b, ease=ease)
        return self

    def arc(self, a, b, height, steps=8, ease=None, t_from=0, t_to=None):
        """A parabolic hop from a to b, `height` pixels up at the middle (negative y is up)."""
        t_to = (self.t1 - self.t0) if t_to is None else t_to
        for i in range(steps + 1):
            u = i / steps
            ue = globals()["ease"](ease, u)
            x = a[0] + (b[0] - a[0]) * ue
            y = a[1] + (b[1] - a[1]) * ue - height * 4 * ue * (1 - ue)
            self.key(t_from + (t_to - t_from) * u, pos=(x, y))
        return self

    def orbit(self, center, rx, ry, start_deg, turns, t_from=0, t_to=None, steps_per_turn=12):
        t_to = (self.t1 - self.t0) if t_to is None else t_to
        n = max(2, int(abs(turns) * steps_per_turn))
        for i in range(n + 1):
            u = i / n
            a = math.radians(start_deg + 360 * turns * u)
            self.key(t_from + (t_to - t_from) * u, pos=(center[0] + rx * math.cos(a), center[1] - ry * math.sin(a)))
        return self

    def zoom(self, a, b, ease=None, t_from=0, t_to=None):
        t_to = (self.t1 - self.t0) if t_to is None else t_to
        self.key(t_from, zoom=a)
        self.key(t_to, zoom=b, ease=ease)
        return self

    def fade(self, a, b, ease=None, t_from=0, t_to=None):
        t_to = (self.t1 - self.t0) if t_to is None else t_to
        self.key(t_from, opacity=a)
        self.key(t_to, opacity=b, ease=ease)
        return self

    def spin(self, a, b, ease=None, t_from=0, t_to=None):
        t_to = (self.t1 - self.t0) if t_to is None else t_to
        self.key(t_from, angle=a)
        self.key(t_to, angle=b, ease=ease)
        return self

    def cell_at(self, t):
        if self.cell_override:
            return self.cell_override(t)
        i = (t - self.t0) // self.cell_every
        n = len(self.cells)
        i = i % n if self.loop else min(i, n - 1)
        return self.cells[i]


class Battler:
    """A battler cel track. `focus` (added 2026-11-18 for the Max moves, default unchanged):
    - "user_target" (default): the cel is written with focus 3 (USER_TARGET) at base + offset. Offsets follow the
      user -> target line, so for an ENEMY user both x and y offsets are mirrored (a "lift" of y -10 becomes a drop).
    - "own" (or "user" for a.user / "target" for a.target): the cel is written with the battler's own focus (2 for the
      user, 1 for the target). Offsets are then plain screen directions for either side: up stays up, right stays right.
      Use this for vertical moves (Dynamax flex lift, vertical shakes, being pushed down)."""

    def __init__(self, base, which=0):
        self.base = base
        self.which = which  # 0 = user cel, 1 = target cel
        self.focus = "user_target"
        self.x, self.y = Track(0.0), Track(0.0)
        self.zx, self.zy = Track(100.0), Track(100.0)
        self.opacity = Track(255.0)
        self.tone = Track([0.0, 0.0, 0.0, 0.0])
        self.angle = Track(0.0)
        self.visible_ranges = []  # [(t0, t1)] where hidden
        self.shakes = []

    def key(self, t, ease=None, **props):
        for k, v in props.items():
            if k == "pos":
                self.x.set(t, float(v[0]), ease)
                self.y.set(t, float(v[1]), ease)
            elif k == "zoom":
                self.zx.set(t, float(v), ease)
                self.zy.set(t, float(v), ease)
            elif k in ("x", "y", "opacity", "angle"):
                getattr(self, k).set(t, float(v), ease)
            elif k == "zoomX":
                self.zx.set(t, float(v), ease)
            elif k == "zoomY":
                self.zy.set(t, float(v), ease)
            elif k == "tone":
                self.tone.set(t, [float(c) for c in v], ease)
            else:
                raise ValueError(f"unknown battler prop {k}")
        return self

    def tone_pulse(self, t0, t1, tone, hold=0.4):
        """Fade the tone in to `tone` and back out over [t0, t1]."""
        mid0 = t0 + (t1 - t0) * (0.5 - hold / 2)
        mid1 = t0 + (t1 - t0) * (0.5 + hold / 2)
        self.key(t0, tone=[0, 0, 0, 0])
        self.key(mid0, tone=tone, ease="out")
        self.key(mid1, tone=tone)
        self.key(t1, tone=[0, 0, 0, 0], ease="in")
        return self

    def shake(self, t0, t1, amp=3, period=2, axis="x"):
        self.shakes.append((t0, t1, amp, period, axis))
        return self

    def hide(self, t0, t1):
        self.visible_ranges.append((t0, t1))
        return self

    def at(self, t):
        x, y = self.x.at(t), self.y.at(t)
        for t0, t1, amp, period, axis in self.shakes:
            if t0 <= t < t1:
                k = (t - t0) // max(1, period)
                d = amp if k % 2 == 0 else -amp
                if axis in ("x", "xy"):
                    x += d
                if axis in ("y", "xy"):
                    y += d / 2
        visible = not any(t0 <= t < t1 for t0, t1 in self.visible_ranges)
        return {
            "x": self.base[0] + x,
            "y": self.base[1] + y,
            "zoomX": self.zx.at(t),
            "zoomY": self.zy.at(t),
            "angle": self.angle.at(t),
            "opacity": self.opacity.at(t),
            # rgb are ints; gray is the shader's raw 0..1 mix factor (2026-11-19: no longer rounded, 0.5 became 0)
            "tone": [round(c) for c in self.tone.at(t)[:3]] + [round(c, 3) for c in self.tone.at(t)[3:]],
            "visible": visible,
        }


class Anim:
    def __init__(self, move_id):
        self.move_id = move_id
        self.file = kebab(move_id)
        self.sheet_name = None
        self.frames = 40
        self._cells = []  # images
        self._cell_keys = {}
        self.sprites = []
        self.user = Battler(USER_PT, 0)
        self.target = Battler(TARGET_PT, 1)
        self.bg_events = []
        self.sound_events = []
        self.notes = []

    # ---- setup
    def length(self, frames):
        self.frames = int(frames)
        return self

    def sheet(self, name):
        """The composite sheet's file name (without .png) in assets/images/battle_anims."""
        self.sheet_name = name
        return self

    def cells(self, src, frames=(0,), **opts):
        """Add cells to the composite sheet; returns their indices (reused when the same cell was added before)."""
        out = []
        for f in frames:
            key = (src, f, json.dumps(opts, sort_keys=True, default=str))
            if key not in self._cell_keys:
                self._cell_keys[key] = len(self._cells)
                self._cells.append(make_cell(src, f, **opts))
            out.append(self._cell_keys[key])
        return out

    def cell_image(self, img):
        """Add an already made 96x96 RGBA cell (e.g. a combined picture)."""
        self._cells.append(img)
        return len(self._cells) - 1

    # ---- sprites
    def sprite(self, cells, t0, t1, focus="user_target", blend="normal", priority=1, cell_every=1, loop=True,
               mirror=False, pos=None, zoom=None, opacity=None, angle=None):
        if isinstance(cells, int):
            cells = [cells]
        s = Sprite(self, cells, int(t0), int(t1), focus, blend, priority, cell_every, loop, mirror, len(self.sprites))
        if pos is not None:
            s.key(0, pos=pos)
        if zoom is not None:
            s.key(0, zoom=zoom)
        if opacity is not None:
            s.key(0, opacity=opacity)
        if angle is not None:
            s.key(0, angle=angle)
        self.sprites.append(s)
        return s

    # ---- background / sound
    def bg(self, t, image="", opacity=255, duration=0, x=0, y=0):
        """Show a background (image name in battle_anims, "" = black) at frame t, fading in over `duration` frames
        from 0 when duration > 0."""
        self.bg_events.append({"t": int(t), "kind": "add", "image": image, "opacity": 0 if duration else opacity,
                               "duration": 0, "x": x, "y": y})
        if duration:
            self.bg_events.append({"t": int(t), "kind": "update", "opacity": opacity, "duration": int(duration)})
        return self

    def bg_update(self, t, opacity=None, duration=0, x=None, y=None):
        self.bg_events.append({"t": int(t), "kind": "update", "opacity": opacity, "duration": int(duration),
                               "x": x, "y": y})
        return self

    def sound(self, t, name, volume=100, pitch=100):
        if not os.path.exists(os.path.join(AUDIO_DIR, name)):
            raise FileNotFoundError(f"sound {name} not in assets/audio/battle_anims")
        self.sound_events.append({"t": int(t), "name": name, "volume": volume, "pitch": pitch})
        return self

    def note(self, text):
        self.notes.append(text)
        return self

    # ---- compile
    def sprite_state(self, s, t):
        rt = t - s.t0
        return {
            "x": s.x.at(rt),
            "y": s.y.at(rt),
            "zoomX": s.zx.at(rt),
            "zoomY": s.zy.at(rt),
            "angle": s.angle.at(rt),
            "opacity": max(0.0, min(255.0, s.opacity.at(rt))),
            "cell": s.cell_at(t),
        }

    def compile(self):
        if not self.sheet_name:
            raise ValueError("call a.sheet(name)")
        frames = []
        for t in range(self.frames):
            fr = []
            for who, b in ((0, self.user), (1, self.target)):
                st = b.at(t)
                if b.focus == "user_target":
                    bfocus = 3
                elif b.focus in ("own", "user", "target"):
                    bfocus = 2 if who == 0 else 1
                else:
                    raise ValueError(f"battler focus {b.focus!r}: use 'user_target' or 'own'")
                cel = {
                    "x": round(st["x"], 2), "y": round(st["y"], 2),
                    "zoomX": round(st["zoomX"], 2), "zoomY": round(st["zoomY"], 2),
                    "visible": st["visible"], "target": who, "graphicFrame": 0,
                    "opacity": round(st["opacity"]), "locked": True, "priority": 1, "focus": bfocus,
                }
                if st["angle"]:
                    cel["angle"] = round(st["angle"], 2)
                if any(st["tone"]):
                    cel["tone"] = st["tone"]
                fr.append(cel)
            for s in self.sprites:
                if not (s.t0 <= t < s.t1):
                    continue
                st = self.sprite_state(s, t)
                cel = {
                    "x": round(st["x"], 2), "y": round(st["y"], 2),
                    "zoomX": round(st["zoomX"], 2), "zoomY": round(st["zoomY"], 2),
                    "visible": st["opacity"] > 0, "target": 2, "graphicFrame": st["cell"],
                    "opacity": round(st["opacity"]), "priority": s.priority, "focus": FOCUS[s.focus],
                }
                if st["angle"]:
                    cel["angle"] = round(st["angle"], 2)
                if s.mirror:
                    cel["mirror"] = True
                if BLEND[s.blend]:
                    cel["blendType"] = BLEND[s.blend]
                fr.append(cel)
            frames.append(fr)
        events = {}
        for e in self.sound_events:
            events.setdefault(e["t"], []).append({
                "frameIndex": e["t"], "resourceName": e["name"], "volume": e["volume"], "pitch": e["pitch"],
                "eventType": "AnimTimedSoundEvent"})
        for e in self.bg_events:
            if e["kind"] == "add":
                ev = {"frameIndex": e["t"], "resourceName": e["image"], "bgX": e["x"], "bgY": e["y"],
                      "opacity": e["opacity"], "duration": e["duration"], "eventType": "AnimTimedAddBgEvent"}
            else:
                ev = {"frameIndex": e["t"], "resourceName": "", "duration": e["duration"],
                      "eventType": "AnimTimedUpdateBgEvent"}
                if e.get("opacity") is not None:
                    ev["opacity"] = e["opacity"]
                if e.get("x") is not None:
                    ev["bgX"] = e["x"]
                if e.get("y") is not None:
                    ev["bgY"] = e["y"]
            events.setdefault(e["t"], []).append(ev)
        # Add before Update within a frame (PokeRogue runs them in list order)
        for k in events:
            events[k].sort(key=lambda ev: {"AnimTimedAddBgEvent": 0, "AnimTimedUpdateBgEvent": 1}.get(ev["eventType"], 2))
        return {
            "graphic": self.sheet_name,
            "frames": frames,
            "frameTimedEvents": {str(k): v for k, v in sorted(events.items())},
            "position": 3,
            "hue": 0,
        }

    def sheet_image(self):
        n = max(1, len(self._cells))
        rows = (n + COLS - 1) // COLS
        img = Image.new("RGBA", (COLS * CELL, rows * CELL))
        for i, c in enumerate(self._cells):
            img.paste(c, ((i % COLS) * CELL, (i // COLS) * CELL))
        return img


# ----------------------------------------------------------------------------------------------------------------------
# preview (a rough re-implementation of BattleAnim.play's placement)
# 2026-11-18 (Max moves): also renders the enemy-side case (`opp=True`: the user stands top right, the target bottom
# left, USER_TARGET graphics are mirrored, exactly what a single-object file does when an enemy uses the move), draws
# the user at the Dynamax container scale (USER_SCALE, 1.5), layers priorities 0 / 2 / 3 like the engine, and follows
# background scrolling (AddBg / UpdateBg bgX / bgY). Uncovered background areas show magenta.
# ----------------------------------------------------------------------------------------------------------------------
FIELD_W, FIELD_H = 320, 180
USER_POS = (106, 148)
TARGET_POS = (234, 84)
HALF_H = 32
SRC = (106, 116, 234, 52)
USER_SCALE = 1.5    # a Max move user is Dynamaxed: the game draws it x1.5 (getSpriteScale)
TARGET_SCALE = 1.0


def _feet(opp):
    """(user feet, target feet) on the field for the player-side (opp False) or enemy-side (opp True) user."""
    return (TARGET_POS, USER_POS) if opp else (USER_POS, TARGET_POS)


def place(x, y, focus, opp=False):
    U, T = _feet(opp)
    if focus == 1:
        return T[0] + (x - 128), T[1] - HALF_H + (y + 64)
    if focus == 2:
        return U[0] + x, U[1] - HALF_H + y
    if focus == 3:
        uy, ty = U[1] - HALF_H, T[1] - HALF_H
        return U[0] + (x / 128) * (T[0] - U[0]), uy + (-y / 64) * (ty - uy)
    return x + 106, y + 116


def _battler_img(kind):
    img = Image.new("RGBA", (64, 64))
    d = ImageDraw.Draw(img)
    col = (90, 150, 230, 255) if kind == 0 else (230, 120, 90, 255)
    d.ellipse((8, 4, 56, 62), fill=col, outline=(20, 20, 20, 255), width=2)
    d.ellipse((20, 18, 30, 28) if kind else (34, 18, 44, 28), fill=(255, 255, 255, 255))
    return img


def _apply_tone(img, tone):
    if not any(tone):
        return img
    r, g, b, gray = tone
    out = img.copy()
    px = out.load()
    for j in range(out.height):
        for i in range(out.width):
            pr, pg, pb, pa = px[i, j]
            if pa:
                if gray:
                    l = (pr * 299 + pg * 587 + pb * 114) // 1000
                    k = min(1.0, gray)  # the shader uses gray raw as a 0..1 mix factor
                    pr, pg, pb = (int(c + (l - c) * k) for c in (pr, pg, pb))
                px[i, j] = (max(0, min(255, pr + r)), max(0, min(255, pg + g)), max(0, min(255, pb + b)), pa)
    return out


def _behind(cel, has_bg):
    """Engine draw layer of a GRAPHIC cel: 'hidden' (priority 0 under a background), 'behind' the Pokemon or 'front'."""
    p, focus = cel.get("priority", 1), cel.get("focus", 1)
    if p == 0:
        return "hidden" if has_bg else "behind"
    if p == 2:
        return "behind" if (has_bg or focus in (1, 2)) else "front"
    if p == 3:
        return "behind" if focus in (1, 2) else "front"
    return "front"


def render_frame(anim_json, sheet_img, f, bg_state, opp=False):
    canvas = Image.new("RGBA", (FIELD_W, FIELD_H), (120, 150, 110, 255))
    d = ImageDraw.Draw(canvas)
    d.ellipse((USER_POS[0] - 50, USER_POS[1] - 6, USER_POS[0] + 50, USER_POS[1] + 14), fill=(95, 125, 85, 255))
    d.ellipse((TARGET_POS[0] - 44, TARGET_POS[1] - 6, TARGET_POS[0] + 44, TARGET_POS[1] + 12), fill=(95, 125, 85, 255))
    bg_img, bg_alpha = bg_state
    has_bg = bg_img is not None
    cols = sheet_img.width // CELL
    layers = list(anim_json["frames"][f])

    def draw_cel(cel):
        if not cel.get("visible", True) or cel.get("opacity", 255) <= 0:
            return
        oy = 0
        if cel["target"] == 2:
            gf = cel["graphicFrame"]
            src = sheet_img.crop(((gf % cols) * CELL, (gf // cols) * CELL, (gf % cols) * CELL + CELL, (gf // cols) * CELL + CELL))
            x, y = place(cel["x"], cel["y"], cel.get("focus", 1), opp)
            cs = 1.0
            flip = opp and cel.get("focus", 1) == 3
        else:
            src = _apply_tone(_battler_img(cel["target"]), cel.get("tone", [0, 0, 0, 0]))
            x, y = place(cel["x"], cel["y"], cel.get("focus", 3), opp)
            cs = USER_SCALE if cel["target"] == 0 else TARGET_SCALE
            oy = -HALF_H * (cs - 1)  # the engine shifts a scaled Pokemon copy up by height/2 * (scale - 1)
            flip = False
        zx, zy = cel.get("zoomX", 100) / 100 * cs, cel.get("zoomY", 100) / 100 * cs
        if cel.get("mirror"):
            src = src.transpose(Image.FLIP_LEFT_RIGHT)
        if flip:
            src = src.transpose(Image.FLIP_LEFT_RIGHT)
        w, h = max(1, int(src.width * abs(zx))), max(1, int(src.height * abs(zy)))
        if w > 1400 or h > 1400:
            return
        im = src.resize((w, h), Image.NEAREST)
        if zx < 0:
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
        if cel.get("angle"):
            im = im.rotate(cel["angle"], expand=True, resample=Image.NEAREST)
        a = cel.get("opacity", 255) / 255
        if a < 1:
            im.putalpha(im.getchannel("A").point(lambda v: int(v * a)))
        px, py = int(x - im.width / 2), int(y + oy - im.height / 2)
        if cel.get("blendType") == 1 and cel["target"] == 2:
            from PIL import ImageChops
            add = Image.new("RGB", im.size)
            add.paste(im, (0, 0), im)
            big = Image.new("RGB", (FIELD_W + 2 * im.width, FIELD_H + 2 * im.height))
            big.paste(canvas.convert("RGB"), (im.width, im.height))
            box = (px + im.width, py + im.height, px + 2 * im.width, py + 2 * im.height)
            mixed = ImageChops.add(big.crop(box), add)
            big.paste(mixed, box[:2])
            canvas.paste(big.crop((im.width, im.height, im.width + FIELD_W, im.height + FIELD_H)), (0, 0))
        else:
            # 2026-11-19: a graphic wholly off the field (e.g. rising past the top) is drawn by the game without
            # trouble; the preview just skips it (PIL raises when the source box falls outside the image)
            if px + im.width <= 0 or py + im.height <= 0 or px >= FIELD_W or py >= FIELD_H:
                return
            canvas.alpha_composite(im, (max(0, px), max(0, py)), (max(0, -px), max(0, -py)))

    if has_bg and bg_alpha > 0:
        tile = bg_img.copy()
        tile.putalpha(tile.getchannel("A").point(lambda v: int(v * bg_alpha)))
        canvas.alpha_composite(tile)
    graphics = [c for c in layers if c["target"] == 2]
    for cel in graphics:
        if _behind(cel, has_bg) == "behind":
            draw_cel(cel)
    for cel in layers:
        if cel["target"] in (0, 1):
            draw_cel(cel)
    for cel in graphics:
        if _behind(cel, has_bg) == "front":
            draw_cel(cel)
    return canvas


def _bg_texture(name):
    if name == "":
        return None
    p = os.path.join(SHEET_DIR, name if name.endswith(".png") else name + ".png")
    if not os.path.exists(p):
        return "missing"
    src = _load(p)
    return src.resize((int(src.width * 1.25), int(src.height * 1.25)), Image.NEAREST)


def _bg_image(name, sx=-320.0, sy=-284.0):
    """The visible 320x180 window of a background sprite whose top-left corner is at field (sx, sy): a 896x576
    tileSprite scaled x1.25 (1120x720 field px), the texture repeating from that corner. Uncovered = magenta."""
    img = Image.new("RGBA", (FIELD_W, FIELD_H), (255, 0, 255, 255))
    x0, y0, x1, y1 = int(round(sx)), int(round(sy)), int(round(sx + 1120)), int(round(sy + 720))
    tex = _bg_texture(name)
    if tex is None:
        ImageDraw.Draw(img).rectangle((x0, y0, x1 - 1, y1 - 1), fill=(0, 0, 0, 255))
        return img
    if tex == "missing":
        return img
    tw, th = tex.size
    layer = Image.new("RGBA", (FIELD_W, FIELD_H))
    for yy in range(y0 + ((0 - y0) // th) * th, FIELD_H, th):
        for xx in range(x0 + ((0 - x0) // tw) * tw, FIELD_W, tw):
            layer.alpha_composite(tex, (max(0, xx), max(0, yy)), (max(0, -xx), max(0, -yy)))
    mask = Image.new("L", (FIELD_W, FIELD_H), 0)
    ImageDraw.Draw(mask).rectangle((x0, y0, x1 - 1, y1 - 1), fill=255)
    img.paste(layer, (0, 0), mask)
    return img


def bg_states(anim_json):
    """Per frame: (background image or None, alpha 0..1), following AddBg / UpdateBg (opacity and position tweens,
    linear over `duration` frames, started after the cels of their frame like the engine)."""
    n = len(anim_json["frames"])
    ev = {int(k): v for k, v in anim_json["frameTimedEvents"].items()}
    name = None
    base = {"alpha": 0.0, "x": -320.0, "y": -284.0}
    tweens = {}  # prop -> (start_value, end_value, start_frame, frames)
    cache = {}
    states = []

    def cur(prop, f):
        if prop in tweens:
            a0, a1, t0, dur = tweens[prop]
            u = 1.0 if dur <= 0 else max(0.0, min(1.0, (f - t0) / dur))
            return a0 + (a1 - a0) * u
        return base[prop]

    for f in range(n):
        # events run in the same game step as the cels of their frame, so they show in that frame
        for e in ev.get(f, []):
            if e["eventType"] == "AnimTimedAddBgEvent":
                name = e["resourceName"]
                base = {"alpha": e.get("opacity", 0) / 255, "x": e.get("bgX", 0) - 320.0, "y": e.get("bgY", 0) - 284.0}
                tweens = {}
            elif e["eventType"] == "AnimTimedUpdateBgEvent" and name is not None:
                dur = max(0, e.get("duration", 0))
                for prop, key, conv in (("alpha", "opacity", lambda v: v / 255), ("x", "bgX", lambda v: v * 0.5 - 320),
                                        ("y", "bgY", lambda v: v * 0.5 - 284)):
                    if e.get(key) is not None:
                        tweens[prop] = (cur(prop, f), conv(e[key]), f, dur)
        vals = {p: cur(p, f) for p in base}
        for p in list(tweens):
            a0, a1, t0, dur = tweens[p]
            if f - t0 >= dur:
                base[p] = a1
                del tweens[p]
        if name is None:
            states.append((None, 0.0))
        else:
            key = (name, round(vals["x"]), round(vals["y"]))
            if key not in cache:
                cache[key] = _bg_image(name, vals["x"], vals["y"])
            states.append((cache[key], vals["alpha"]))
    return states


def preview(anim_json, sheet_img, out_path, every=2, cols=6, scale=1, opp=False, gif_path=None):
    n = len(anim_json["frames"])
    idx = list(range(0, n, every))
    states = bg_states(anim_json)
    font = ImageFont.load_default()
    rows = (len(idx) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * FIELD_W * scale, rows * (FIELD_H + 12) * scale), (30, 30, 30, 255))
    rendered = {}
    for k, f in enumerate(idx):
        fr = rendered[f] = render_frame(anim_json, sheet_img, f, states[f], opp)
        if scale != 1:
            fr = fr.resize((FIELD_W * scale, FIELD_H * scale), Image.NEAREST)
        x, y = (k % cols) * FIELD_W * scale, (k // cols) * (FIELD_H + 12) * scale
        sheet.paste(fr, (x, y + 12 * scale))
        ImageDraw.Draw(sheet).text((x + 3, y + 1), f"f{f}" + (" (enemy user)" if opp and k == 0 else ""),
                                   fill=(255, 255, 255, 255), font=font)
    sheet.convert("RGB").save(out_path)
    if gif_path:
        frames = [(rendered.get(f) or render_frame(anim_json, sheet_img, f, states[f], opp)).convert("RGB")
                  for f in range(n)]
        frames = [fr.resize((FIELD_W * 2, FIELD_H * 2), Image.NEAREST) for fr in frames]
        frames[0].save(gif_path, save_all=True, append_images=frames[1:], duration=50, loop=0)
    return out_path


# ----------------------------------------------------------------------------------------------------------------------
# report helpers (2026-11-18): end hold estimate and file-rule warnings
# ----------------------------------------------------------------------------------------------------------------------
_sound_secs = None


def sound_seconds(name):
    """Duration of a battle_anims sound, from inventory/sounds.json (None when unknown)."""
    global _sound_secs
    if _sound_secs is None:
        _sound_secs = {}
        p = os.path.join(HERE, "inventory", "sounds.json")
        if os.path.exists(p):
            with open(p, encoding="utf-8") as fh:
                for s in json.load(fh).get("sounds", []):
                    if s.get("source") == "pokerogue" and s.get("duration_s") is not None:
                        _sound_secs[s["file"]] = s["duration_s"]
    return _sound_secs.get(name)


def end_hold_ms(a):
    """The engine waits max(event ret) x 16.67 ms after the last frame (battle-anims.ts: r = max(len - f + ret, r)).
    Sound ret = ceil(seconds * 1000 / 33.33); background ret = 2 * duration. Independent of the event's frame."""
    rets = [0]
    for e in a.sound_events:
        s = sound_seconds(e["name"])
        if s is not None:
            rets.append(math.ceil(s * 1000 / 33.33))
    for e in a.bg_events:
        rets.append(2 * e["duration"])
    return round(max(rets) * 1000 / 60)


def warnings_for(a, data, max_graphics=24):
    out = []
    n = len(data["frames"])
    if known_move_id(a.move_id) is False:
        out.append(f"MOVE_ID {a.move_id} is not a MoveId enum name (src/enums/move-id.ts): the game would never "
                   f"fetch {a.file}.json")
    if not 40 <= n <= 75:
        out.append(f"length {n} frames is outside the 40-75 budget")
    busy = [i for i, fr in enumerate(data["frames"]) if sum(1 for c in fr if c["target"] == 2) > max_graphics]
    if busy:
        out.append(f"more than {max_graphics} graphics in frames {busy[0]}..{busy[-1]} ({len(busy)} frames)")
    first_add = min((e["t"] for e in a.bg_events if e["kind"] == "add"), default=None)
    for e in a.bg_events:
        if e["kind"] == "update":
            if first_add is None or e["t"] < first_add:
                out.append(f"UpdateBg at f{e['t']} before the first AddBg")
            if e["t"] + e["duration"] > n - 1:
                out.append(f"UpdateBg at f{e['t']} (duration {e['duration']}) ends after the last frame {n - 1}")
    adds = sorted((e for e in a.bg_events if e["kind"] == "add"), key=lambda e: e["t"])
    for i, e in enumerate(adds):
        nxt = adds[i + 1]["t"] if i + 1 < len(adds) else n
        seen = e["opacity"] > 0 or any(u["kind"] == "update" and (u.get("opacity") or 0) > 0 and e["t"] <= u["t"] < nxt
                                       for u in a.bg_events)
        if not seen:
            out.append(f"AddBg '{e['image']}' at f{e['t']} is never visible")
    # 2026-11-19 review: layering / mirroring / tone checks (engine_spec.md sections 6, 8, 9)
    add_frames = sorted(e["t"] for e in a.bg_events if e["kind"] == "add")
    p0 = [i for i, fr in enumerate(data["frames"]) if add_frames and i >= add_frames[0]
          and any(c["target"] == 2 and c.get("visible") and c.get("priority") == 0 for c in fr)]
    if p0:
        out.append(f"priority 0 graphics while a background exists (frames {p0[0]}..{p0[-1]}): the BG covers them")
    for b in add_frames:
        near = [i for i in (b - 1, b, b + 1) if 0 <= i < n
                and any(c["target"] == 2 and c.get("priority") == 2 for c in data["frames"][i])]
        if near and min(near) <= b:
            out.append(f"priority 2 graphics at f{min(near)}..f{max(near)} around the AddBg at f{b}: a slot set to "
                       f"priority 2 before or on that frame ends up under the new background; first show it at "
                       f"f{b + 1} or later")
    rot = sorted({s.order for s in a.sprites if s.focus == "user_target"
                  and any(abs(s.angle.at(t - s.t0)) > 0.5 for t in range(s.t0, s.t1))})
    if rot:  # a note, not a warning: spinning symmetric art (coins, stars) is fine
        a.note(f"check: rotated user_target sprites {rot[:6]}; angles are not mirrored when an enemy uses the move "
               f"(fine for symmetric art; look at preview/<id>_opp.png)")
    gray = [i for i, fr in enumerate(data["frames"]) if any(c["target"] in (0, 1) and len(c.get("tone", [])) > 3
                                                           and c["tone"][3] for c in fr)]
    if gray:
        out.append(f"battler tone gray != 0 in frames {gray[0]}..{gray[-1]} (house rule: keep 0; the shader uses "
                   f"it raw as a 0..1 mix, Essentials-style 255 inverts the colours)")
    if any(s.blend == "sub" for s in a.sprites):
        out.append("blend 'sub' renders as normal on WebGL")
    for s in a.sprites:
        if max(s.cells) >= len(a._cells):
            out.append(f"sprite {s.order} uses a cell outside the sheet")
    return out


# ----------------------------------------------------------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------------------------------------------------------
def load_spec(spec_id):
    path = os.path.join(SPEC_DIR, spec_id + ".py")
    spec = importlib.util.spec_from_file_location("spec_" + spec_id, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def build_one(spec_id, write=True, every=2, gif=False):
    mod = load_spec(spec_id)
    move_id = getattr(mod, "MOVE_ID", spec_id.upper())
    a = Anim(move_id)
    mod.build(a)
    data = a.compile()
    sheet = a.sheet_image()
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    prev = preview(data, sheet, os.path.join(PREVIEW_DIR, spec_id + ".png"), every=every,
                   gif_path=os.path.join(PREVIEW_DIR, spec_id + ".gif") if gif else None)
    preview(data, sheet, os.path.join(PREVIEW_DIR, spec_id + "_opp.png"), every=every, opp=True,
            gif_path=os.path.join(PREVIEW_DIR, spec_id + "_opp.gif") if gif else None)
    sheet.save(os.path.join(PREVIEW_DIR, spec_id + "_sheet.png"))
    if write:
        with open(os.path.join(ANIM_DIR, a.file + ".json"), "w", encoding="utf-8", newline="\n") as fh:
            json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
        sheet.save(os.path.join(SHEET_DIR, a.sheet_name + ".png"))
    hold = end_hold_ms(a)
    info = {
        "spec": spec_id, "move": move_id, "file": a.file + ".json", "sheet": a.sheet_name + ".png",
        "frames": a.frames, "cells": len(a._cells), "sprites": len(a.sprites),
        "max_graphics_per_frame": max((sum(1 for c in fr if c["target"] == 2) for fr in data["frames"]), default=0),
        "sounds": sorted({e["name"] for e in a.sound_events}),
        "backgrounds": sorted({e["image"] for e in a.bg_events if e["kind"] == "add"}),
        "end_hold_ms": hold, "total_ms": a.frames * 50 + 50 + hold,
        "warnings": warnings_for(a, data),
        "preview": prev, "notes": a.notes,
    }
    return info


def main(argv):
    if not argv or argv[0] not in ("build", "preview"):
        print(__doc__ or "usage: build [ids] [--no-write] [--gif] | preview <id>")
        return 2
    write = argv[0] == "build" and "--no-write" not in argv
    gif = "--gif" in argv
    ids = [x for x in argv[1:] if not x.startswith("--")]
    if not ids:
        ids = sorted(f[:-3] for f in os.listdir(SPEC_DIR) if f.endswith(".py") and not f.startswith("_"))
    report = []
    for i in ids:
        info = build_one(i, write=write, gif=gif)
        report.append(info)
        print(f"{i}: {info['frames']} frames, max {info['max_graphics_per_frame']} graphics/frame, "
              f"hold {info['end_hold_ms']} ms, total {info['total_ms']} ms, {len(info['warnings'])} warnings")
        for w in info["warnings"]:
            print("  warning: " + w.encode("ascii", "replace").decode("ascii"))
    out = os.path.join(HERE, "build_report.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1)
    print(f"built {len(report)} -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
