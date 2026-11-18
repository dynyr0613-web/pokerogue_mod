# Local fork (2026-11-18): Essentials battle animations -> PokeRogue battle-anims JSON (Z / Max / G-Max moves).
# The user: "Z-다이 전용 전투 에니메이션은 아마 자료가 에센셜용으로 꽤 많이 있을거라 그걸 얻어오면 되고"
#
# Reads the user's local Pokemon Essentials v21.1 project only (Data/PkmnAnimations.rxdata, Ruby Marshal 4.8) and
# runs nothing from it. Ruby Marshal reading is a copy of D:/PartyPatch/tools/rbmarshal.py, extended with user classes
# ('C', needed for PBAnimations / PBAnimation, which are Array subclasses), ivars kept on arrays, and the object table
# kept the way Ruby's marshal.c fills it (class refs, floats, bignums, 'U' before its data).
#
#   py -I essentials_anims.py list    [--essentials DIR]             every animation name + graphics
#   py -I essentials_anims.py report  [--essentials DIR]             Z / Max / G-Max coverage (what exists, what's missing)
#   py -I essentials_anims.py convert [--essentials DIR] [--pokerogue DIR] [--dry-run] [--overwrite]
#   py -I essentials_anims.py dump --name "Move:BREAKNECKBLITZ"      one animation's raw data as JSON
#
# convert writes assets/battle-anims/<toKebabCase(MoveId name)>.json for every Z / exclusive Z / Max / G-Max move that
# has a "Move:<ID>" (and "OppMove:<ID>") animation, skipping files upstream PokeRogue already has (--overwrite replaces
# them), writes the sheets / backgrounds it needs into assets/images/battle_anims and lists everything it did in
# essentials_anims_manifest.json beside this file (a later run refreshes only its own files).
#
# Conversion rules, checked against upstream PokeRogue's files that came from the same Essentials (PRAS) animations
# (flamethrower, thunderbolt, tackle, earthquake, protect, catastropika: every cel field equal):
# - one JSON object per animation: {graphic, frames, frameTimedEvents, position, hue}; with an "OppMove:" version the
#   file is [player, opponent] (PokeRogue plays [1] for an enemy user and swaps user / target, like Essentials).
# - Essentials' frame 0 is left out (upstream's frame i is Essentials' frame i + 1); timed events keep their numbers.
# - cel: x = (X - 128) / 2, y = (Y - 224) / 2 (Essentials' focus points 128,224 / 384,96 become 0,0 / 128,-64);
#   pattern -1 / -2 -> target 0 (user) / 1 (target), else target 2 (graphic) with graphicFrame = pattern; focus,
#   priority, zoomX/Y, angle, mirror, opacity, blendType, visible, locked, tone, color, flash copied as they are.
# - graphic: the sheet name without ".png"; images are Essentials' halved by point sampling at (2x + 1, 2y + 1), which
#   reproduces upstream's sheets pixel for pixel, and loaded as 96x96 frames. Essentials cuts patterns 5 per row of
#   192px and draws nothing for a pattern outside the image, Phaser slices width // 96 columns: so a written sheet is
#   exactly 5 frames wide with whole-frame rows (padded), a cel whose pattern Essentials cannot show is made invisible,
#   and a sheet already in the game is reused only when Phaser's frame n there is the same picture as Essentials'
#   pattern n for every pattern used (else the halved copy is written as "<name> (Essentials).png").
# - Sounds the game lacks are dropped (the Essentials project has most of them as .ogg in Audio/SE/Anim; the manifest's
#   "missingSounds" lists them). The Max / G-Max moves have no animation in the Essentials data ("~ Max Moves ~" is
#   empty) and 10,000,000 Volt Thunderbolt only a placeholder, so `report` lists them as missing.
# - timings: type 0 -> AnimTimedSoundEvent (resourceName = the game's file with the same name stem, e.g. ".ogg" ->
#   the game's ".m4a" like upstream; dropped when the game has no such sound), type 1 -> AnimTimedAddBgEvent, type 2 ->
#   AnimTimedUpdateBgEvent (unset bgX / bgY / opacity stay unset: Essentials keeps them and PokeRogue skips undefined
#   ones), foreground events (types 3 / 4) are dropped (no foreground layer in PokeRogue; upstream drops them too).
#   Timings are read in frame order, as Essentials plays them (its list order can put a background's updates before
#   the background itself, e.g. Tectonic Rage); an update before any background is dropped (nothing to tween).
import argparse
import json
import os
import re
import struct
import sys
import zlib

DEFAULT_ESSENTIALS = "C:/Users/jaehe/OneDrive/바탕 화면/Pokemon Essentials v21.1 2023-07-30"
DEFAULT_POKEROGUE = "D:/PokeRogueDev/pokerogue"


# ----------------------------------------------------------------------------------------------------------------------
# Ruby Marshal 4.8 reader
# ----------------------------------------------------------------------------------------------------------------------
class RObj:
    """A Ruby object ('o'), struct ('S'), or user-dumped object ('u' / 'U' / 'd')."""

    def __init__(self, cls, ivars=None, data=None):
        self.cls, self.ivars, self.data = cls, ivars if ivars is not None else {}, data

    def __getitem__(self, k):
        return self.ivars.get(k)

    def __repr__(self):
        return f"<{self.cls}>"


class RArr(list):
    """A Ruby Array; `cls` / `ivars` are set for a user class ('C') or an array with ivars ('I')."""

    cls = "Array"
    ivars = None


class RHash(dict):
    cls = "Hash"
    ivars = None


class Reader:
    def __init__(self, data):
        if data[:2] != b"\x04\x08":
            raise ValueError("not a Ruby Marshal 4.8 file")
        self.d, self.i, self.syms, self.objs = data, 2, [], []

    def byte(self):
        b = self.d[self.i]
        self.i += 1
        return b

    def fixnum(self):
        c = self.byte()
        if c > 127:
            c -= 256
        if c == 0:
            return 0
        if 5 <= c <= 127:
            return c - 5
        if -128 <= c <= -5:
            return c + 5
        if c > 0:
            v = int.from_bytes(self.d[self.i:self.i + c], "little")
            self.i += c
            return v
        n = -c
        v = int.from_bytes(self.d[self.i:self.i + n], "little")
        self.i += n
        return v - (1 << (8 * n))

    def raw(self):
        n = self.fixnum()
        s = self.d[self.i:self.i + n]
        self.i += n
        return s

    def entry(self, v):
        self.objs.append(v)
        return v

    def symbol(self):
        t = chr(self.byte())
        if t == ":":
            s = self.raw().decode("utf-8", "replace")
            self.syms.append(s)
            return s
        if t == ";":
            return self.syms[self.fixnum()]
        if t == "I":   # symbol with encoding ivars
            s = self.symbol()
            for _ in range(self.fixnum()):
                self.symbol()
                self.read()
            return s
        raise ValueError(f"expected a symbol at {self.i - 1}, got {t!r}")

    def read(self):
        t = chr(self.byte())
        if t == "0":
            return None
        if t == "T":
            return True
        if t == "F":
            return False
        if t == "i":
            return self.fixnum()
        if t == ":":
            self.i -= 1
            return self.symbol()
        if t == ";":
            return self.syms[self.fixnum()]
        if t == "@":
            return self.objs[self.fixnum()]
        if t == "I":
            idx = len(self.objs)
            v = self.read()
            ivars = {}
            for _ in range(self.fixnum()):
                k = self.symbol()
                ivars[k] = self.read()
            if isinstance(v, bytes):
                # a String with its encoding: decode it (replace the table entry too, so links see the same text)
                s = v.decode("utf-8", "replace")
                if idx < len(self.objs) and self.objs[idx] is v:
                    self.objs[idx] = s
                return s
            if isinstance(v, (RArr, RHash, RObj)):
                if v.ivars is None:
                    v.ivars = {}
                v.ivars.update(ivars)
            return v
        if t == "e":
            self.symbol()
            return self.read()
        if t == "C":
            cls = self.symbol()
            v = self.read()
            if isinstance(v, (RArr, RHash)):
                v.cls = cls
            return v
        if t == '"':
            return self.entry(self.raw())
        if t == "[":
            a = self.entry(RArr())
            for _ in range(self.fixnum()):
                a.append(self.read())
            return a
        if t in "{}":
            h = self.entry(RHash())
            for _ in range(self.fixnum()):
                k = self.read()
                v = self.read()
                try:
                    h[k] = v
                except TypeError:
                    h[repr(k)] = v
            if t == "}":
                self.read()
            return h
        if t == "o":
            cls = self.symbol()
            o = self.entry(RObj(cls))
            for _ in range(self.fixnum()):
                k = self.symbol()
                o.ivars[k] = self.read()
            return o
        if t == "S":
            cls = self.symbol()
            o = self.entry(RObj(cls))
            for _ in range(self.fixnum()):
                k = self.symbol()
                o.ivars[k] = self.read()
            return o
        if t == "f":
            s = self.raw()
            try:
                v = float(s)
            except ValueError:
                v = s
            return self.entry(v)
        if t == "l":
            sign = self.byte()
            n = self.fixnum()
            v = int.from_bytes(self.d[self.i:self.i + 2 * n], "little")
            self.i += 2 * n
            return self.entry(v if sign == ord("+") else -v)
        if t == "u":
            cls = self.symbol()
            return self.entry(RObj(cls, data=self.raw()))
        if t == "U":
            cls = self.symbol()
            o = self.entry(RObj(cls))
            o.data = self.read()
            return o
        if t == "d":
            cls = self.symbol()
            o = self.entry(RObj(cls))
            o.data = self.read()
            return o
        if t in "cmM":
            return self.entry(RObj("Class", data=self.raw()))
        if t == "/":
            s = self.raw()
            self.byte()
            return self.entry(s)
        raise ValueError(f"unsupported marshal type {t!r} at {self.i - 1}")


def load_marshal(path):
    with open(path, "rb") as f:
        return Reader(f.read()).read()


# ----------------------------------------------------------------------------------------------------------------------
# Essentials animation model
# ----------------------------------------------------------------------------------------------------------------------
# AnimFrame indices (Data/Scripts/011_Battle/007_Other battle code/007_BattleAnimationPlayer.rb)
X, Y, ZOOMX, ANGLE, MIRROR, BLENDTYPE, VISIBLE, PATTERN, OPACITY = 0, 1, 2, 3, 4, 5, 6, 7, 8
ZOOMY, COLORRED, COLORGREEN, COLORBLUE, COLORALPHA = 11, 12, 13, 14, 15
TONERED, TONEGREEN, TONEBLUE, TONEGRAY, LOCKED = 16, 17, 18, 19, 20
FLASHRED, FLASHGREEN, FLASHBLUE, FLASHALPHA, PRIORITY, FOCUS = 21, 22, 23, 24, 25, 26


def s(v):
    if v is None:
        return ""
    if isinstance(v, bytes):
        return v.decode("utf-8", "replace")
    return str(v)


def color_of(robj):
    """RGSS Color (_dump: 4 doubles r, g, b, a)"""
    if isinstance(robj, RObj) and isinstance(robj.data, (bytes, bytearray)) and len(robj.data) >= 32:
        return list(struct.unpack("<4d", robj.data[:32]))
    return None


class Anim:
    def __init__(self, o):
        iv = o.ivars or {}
        self.id = iv.get("@id")
        self.name = s(iv.get("@name"))
        self.graphic = s(iv.get("@graphic"))
        self.hue = iv.get("@hue") or 0
        self.position = iv.get("@position")
        self.speed = iv.get("@speed")
        self.frames = iv.get("@array") or []
        self.timing = iv.get("@timing") or []

    def timings(self):
        out = []
        for t in self.timing:
            iv = t.ivars
            out.append({
                "frame": iv.get("@frame"),
                "type": iv.get("@timingType") or 0,
                "name": s(iv.get("@name")),
                "volume": iv.get("@volume"),
                "pitch": iv.get("@pitch"),
                "bgX": iv.get("@bgX"),
                "bgY": iv.get("@bgY"),
                "opacity": iv.get("@opacity"),
                "colorRed": iv.get("@colorRed"),
                "colorGreen": iv.get("@colorGreen"),
                "colorBlue": iv.get("@colorBlue"),
                "colorAlpha": iv.get("@colorAlpha"),
                "duration": iv.get("@duration"),
                "flashScope": iv.get("@flashScope"),
                "flashColor": color_of(iv.get("@flashColor")),
                "flashDuration": iv.get("@flashDuration"),
            })
        return out

    def background_names(self):
        return sorted({t["name"] for t in self.timings() if t["type"] in (1, 3) and t["name"]})

    def sound_names(self):
        return sorted({t["name"] for t in self.timings() if t["type"] == 0 and t["name"]})


def load_anims(essentials):
    data = load_marshal(os.path.join(essentials, "Data", "PkmnAnimations.rxdata"))
    arr = data.ivars.get("@array") if isinstance(data, RArr) and data.ivars else data
    return [Anim(a) for a in arr if a is not None and isinstance(a, (RArr, RObj)) and a.ivars]


# ----------------------------------------------------------------------------------------------------------------------
# Which moves: Essentials internal move ids -> PokeRogue MoveId enum names
# ----------------------------------------------------------------------------------------------------------------------
# Z moves come in a physical and a special MoveId in PokeRogue (one animation in Essentials covers both)
Z_TYPE_MOVES = [
    "BREAKNECK_BLITZ", "ALL_OUT_PUMMELING", "SUPERSONIC_SKYSTRIKE", "ACID_DOWNPOUR", "TECTONIC_RAGE",
    "CONTINENTAL_CRUSH", "SAVAGE_SPIN_OUT", "NEVER_ENDING_NIGHTMARE", "CORKSCREW_CRASH", "INFERNO_OVERDRIVE",
    "HYDRO_VORTEX", "BLOOM_DOOM", "GIGAVOLT_HAVOC", "SHATTERED_PSYCHE", "SUBZERO_SLAMMER", "DEVASTATING_DRAKE",
    "BLACK_HOLE_ECLIPSE", "TWINKLE_TACKLE",
]
EXCLUSIVE_Z_MOVES = [
    "CATASTROPIKA", "SINISTER_ARROW_RAID", "MALICIOUS_MOONSAULT", "OCEANIC_OPERETTA", "GUARDIAN_OF_ALOLA",
    "SOUL_STEALING_7_STAR_STRIKE", "STOKED_SPARKSURFER", "PULVERIZING_PANCAKE", "EXTREME_EVOBOOST",
    "GENESIS_SUPERNOVA", "TEN_MILLION_VOLT_THUNDERBOLT", "LIGHT_THAT_BURNS_THE_SKY", "SEARING_SUNRAZE_SMASH",
    "MENACING_MOONRAZE_MAELSTROM", "LETS_SNUGGLE_FOREVER", "SPLINTERED_STORMSHARDS", "CLANGOROUS_SOULBLAZE",
]
MAX_MOVES = [
    "MAX_FLARE", "MAX_FLUTTERBY", "MAX_LIGHTNING", "MAX_STRIKE", "MAX_KNUCKLE", "MAX_PHANTASM", "MAX_HAILSTORM",
    "MAX_OOZE", "MAX_GEYSER", "MAX_AIRSTREAM", "MAX_STARFALL", "MAX_WYRMWIND", "MAX_MINDSTORM", "MAX_ROCKFALL",
    "MAX_QUAKE", "MAX_DARKNESS", "MAX_OVERGROWTH", "MAX_STEELSPIKE", "MAX_GUARD",
]
GMAX_MOVES = [
    "G_MAX_WILDFIRE", "G_MAX_BEFUDDLE", "G_MAX_VOLT_CRASH", "G_MAX_GOLD_RUSH", "G_MAX_CHI_STRIKE", "G_MAX_TERROR",
    "G_MAX_RESONANCE", "G_MAX_CUDDLE", "G_MAX_REPLENISH", "G_MAX_MALODOR", "G_MAX_STONESURGE", "G_MAX_WIND_RAGE",
    "G_MAX_STUN_SHOCK", "G_MAX_FINALE", "G_MAX_DEPLETION", "G_MAX_GRAVITAS", "G_MAX_VOLCALITH", "G_MAX_SANDBLAST",
    "G_MAX_SNOOZE", "G_MAX_TARTNESS", "G_MAX_SWEETNESS", "G_MAX_SMITE", "G_MAX_STEELSURGE", "G_MAX_MELTDOWN",
    "G_MAX_FOAM_BURST", "G_MAX_CENTIFERNO", "G_MAX_VINE_LASH", "G_MAX_CANNONADE", "G_MAX_DRUM_SOLO",
    "G_MAX_FIREBALL", "G_MAX_HYDROSNIPE", "G_MAX_ONE_BLOW", "G_MAX_RAPID_FLOW",
]
# Fork-only Max status move (다이검무): no main-series counterpart, so no Essentials animation of its own
FORK_ONLY = ["MAX_SWORDS_DANCE"]
# Per-user versions the Essentials data has beside a move's "Move:" animation (other sheet patterns and tones: Tapu
# Lele's pink, Bulu's red, Fini's blue). PokeRogue keys move animations by MoveId alone, and the Essentials project
# plays none of them either (its Move:GUARDIANOFALOLA, Tapu Koko's yellow fist, plays for every Tapu), so they are not
# converted; convert lists them in the manifest's notes as a known limitation (review note 2026-11-18)
UNCONVERTED_VARIANTS = {
    "GUARDIANOFALOLA": ["Guardian of Alola Lele", "Guardian of Alola Bulu", "Guardian of Alola Fini"],
}


def essentials_id(enum_name):
    """PokeRogue enum name -> Essentials internal id (letters and digits only, upper case)"""
    return re.sub(r"[^A-Z0-9]", "", enum_name.upper())


def kebab(enum_name):
    """toKebabCase(MoveId[x]) for an UPPER_SNAKE enum name"""
    return re.sub(r"[-_ ]+", "-", enum_name.strip("_")).lower()


def z_enum_names(base):
    return [f"{base}__PHYSICAL", f"{base}__SPECIAL"]


def all_targets():
    """(group, Essentials id, [PokeRogue enum names]) for every Z / Max / G-Max move"""
    out = []
    for b in Z_TYPE_MOVES:
        out.append(("z", essentials_id(b), z_enum_names(b)))
    for b in EXCLUSIVE_Z_MOVES:
        out.append(("zExclusive", essentials_id(b), [b]))
    for b in MAX_MOVES:
        out.append(("max", essentials_id(b), [b]))
    for b in GMAX_MOVES:
        # Essentials (DBK) names G-Max moves "GMAXWILDFIRE"
        out.append(("gmax", essentials_id(b), [b]))
    return out


def index_by_move(anims):
    """{"Move:X": Anim, "OppMove:X": Anim} (first animation of each name wins, as Essentials' lookup does)"""
    out = {}
    for a in anims:
        if a.name and a.name not in out:
            out[a.name] = a
    return out




# ----------------------------------------------------------------------------------------------------------------------
# PNG (pure Python: no image library is needed or run)
# ----------------------------------------------------------------------------------------------------------------------
PNG_SIG = b"\x89PNG\r\n\x1a\n"


def png_decode(path):
    """-> (width, height, RGBA bytes)"""
    with open(path, "rb") as f:
        data = f.read()
    if data[:8] != PNG_SIG:
        raise ValueError(f"{path}: not a PNG")
    i, idat, plte, trns = 8, [], None, None
    w = h = bd = ct = il = None
    while i < len(data):
        (ln,) = struct.unpack(">I", data[i:i + 4])
        typ, body = data[i + 4:i + 8], data[i + 8:i + 8 + ln]
        i += 12 + ln
        if typ == b"IHDR":
            w, h, bd, ct, _comp, _flt, il = struct.unpack(">IIBBBBB", body)
        elif typ == b"PLTE":
            plte = body
        elif typ == b"tRNS":
            trns = body
        elif typ == b"IDAT":
            idat.append(body)
        elif typ == b"IEND":
            break
    if il:
        raise ValueError(f"{path}: interlaced PNG not supported")
    if bd not in (1, 2, 4, 8):
        raise ValueError(f"{path}: bit depth {bd} not supported")
    raw = zlib.decompress(b"".join(idat))
    chans = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct]
    bits = chans * bd
    stride = (w * bits + 7) // 8
    bpp = max(1, bits // 8)
    rows, prev, p = [], bytearray(stride), 0
    for _ in range(h):
        f = raw[p]
        line = bytearray(raw[p + 1:p + 1 + stride])
        p += 1 + stride
        if f == 1:
            for x in range(bpp, stride):
                line[x] = (line[x] + line[x - bpp]) & 255
        elif f == 2:
            line = bytearray((a + b) & 255 for a, b in zip(line, prev))
        elif f == 3:
            for x in range(stride):
                left = line[x - bpp] if x >= bpp else 0
                line[x] = (line[x] + ((left + prev[x]) >> 1)) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                b = prev[x]
                c = prev[x - bpp] if x >= bpp else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line)
        prev = line
    out = bytearray(w * h * 4)
    o = 0
    if ct == 6 and bd == 8:
        for line in rows:
            out[o:o + w * 4] = line
            o += w * 4
    elif ct == 2 and bd == 8:
        for line in rows:
            for x in range(w):
                out[o:o + 4] = bytes((line[3 * x], line[3 * x + 1], line[3 * x + 2], 255))
                o += 4
    elif ct in (0, 3, 4):
        if ct == 3:
            pal = [bytes((plte[3 * k], plte[3 * k + 1], plte[3 * k + 2], trns[k] if trns and k < len(trns) else 255))
                   for k in range(len(plte) // 3)]
        for line in rows:
            if ct == 4:
                for x in range(w):
                    g, a = line[2 * x], line[2 * x + 1]
                    out[o:o + 4] = bytes((g, g, g, a))
                    o += 4
                continue
            per = 8 // bd if bd < 8 else 1
            mask = (1 << bd) - 1
            for x in range(w):
                if bd == 8:
                    v = line[x]
                else:
                    byte = line[x // per]
                    v = (byte >> (8 - bd * (x % per + 1))) & mask
                if ct == 3:
                    out[o:o + 4] = pal[v]
                else:
                    g = v * 255 // mask
                    out[o:o + 4] = bytes((g, g, g, 255))
                o += 4
    else:
        raise ValueError(f"{path}: colour type {ct} / depth {bd} not supported")
    return w, h, bytes(out)


def normalize_transparent(px):
    """Fully transparent pixels -> (0, 0, 0, 0), so images compare by what they show"""
    b = bytearray(px)
    for i in range(3, len(b), 4):
        if b[i] == 0:
            b[i - 3] = b[i - 2] = b[i - 1] = 0
    return bytes(b)


def downscale_half(w, h, px):
    """Halve an image by point sampling at (2x + 1, 2y + 1) (ImageMagick's "-sample 50%"). Upstream PokeRogue's sheets
    are exactly this of the Essentials (PRAS) ones: checked on "PRAS- Fire", "PRAS- Thunder BG" and the edges of
    "PRAS- Breakneck Blitz" / "PRAS- Twinkle Tackle", where the art's 2x2 blocks are offset by a pixel and an average
    or the top-left pixel gives other results."""
    nw, nh = w // 2, h // 2
    out = bytearray(nw * nh * 4)
    o = 0
    for y in range(nh):
        row = (2 * y + 1) * w * 4
        for x in range(nw):
            i = row + (2 * x + 1) * 4
            out[o:o + 4] = px[i:i + 4] if px[i + 3] else b"\0\0\0\0"
            o += 4
    return nw, nh, bytes(out)


def _chunk(typ, body):
    return struct.pack(">I", len(body)) + typ + body + struct.pack(">I", zlib.crc32(typ + body) & 0xFFFFFFFF)


def png_encode(w, h, px):
    """RGBA bytes -> PNG bytes (palette + tRNS when there are 256 colours or fewer, as upstream's sheets are)"""
    colours = {}
    for i in range(0, len(px), 4):
        c = px[i:i + 4]
        if c not in colours:
            colours[c] = len(colours)
            if len(colours) > 256:
                break
    if len(colours) <= 256:
        # opaque colours after the transparent ones keep tRNS short
        order = sorted(colours, key=lambda c: (c[3] == 255, c))
        index = {c: k for k, c in enumerate(order)}
        rows = bytearray()
        for y in range(h):
            rows.append(0)
            base = y * w * 4
            rows.extend(index[px[base + 4 * x:base + 4 * x + 4]] for x in range(w))
        trns = bytes(c[3] for c in order)
        trns = trns[:max((k + 1 for k, a in enumerate(trns) if a != 255), default=0)]
        body = _chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 3, 0, 0, 0))
        body += _chunk(b"PLTE", b"".join(c[:3] for c in order))
        if trns:
            body += _chunk(b"tRNS", trns)
    else:
        rows = bytearray()
        for y in range(h):
            rows.append(0)
            rows.extend(px[y * w * 4:(y + 1) * w * 4])
        body = _chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    return PNG_SIG + body + _chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + _chunk(b"IEND", b"")


def frame_block(w, px, idx, size=96, cols=None):
    """The `idx`th size x size frame of a sheet (5 columns, like Essentials' 192px / PokeRogue's 96px frames)"""
    cols = cols or (w // size)
    fx, fy = (idx % cols) * size, (idx // cols) * size
    out = bytearray()
    for y in range(fy, fy + size):
        start = (y * w + fx) * 4
        out += px[start:start + size * 4]
    return bytes(out)


# ----------------------------------------------------------------------------------------------------------------------
# Conversion
# ----------------------------------------------------------------------------------------------------------------------
def num(v, default=0):
    if v is None:
        return default
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def stem(name):
    base, ext = os.path.splitext(name)
    return base if ext.lower() in (".png", ".gif", ".wav", ".ogg", ".mp3", ".m4a", ".mid") else name


def convert_cel(cel, pattern_shown=None):
    """
    One Essentials cel -> one PokeRogue frame entry (keys and defaults as upstream's files have them).
    pattern_shown(p) says whether Essentials draws pattern p of the sheet at all (its src_rect lies inside the image);
    a pattern outside the image shows nothing in Essentials, so the cel is made invisible (Phaser would draw the whole
    sheet for a frame it does not have).
    """
    pattern = num(cel[PATTERN], 0)
    target = 0 if pattern == -1 else 1 if pattern == -2 else 2
    get = lambda i, d=0: num(cel[i], d) if len(cel) > i and cel[i] is not None else d  # noqa: E731
    out = {
        "x": num((get(X) - 128) * 0.5),
        "y": num((get(Y) - 224) * 0.5),
        "zoomX": get(ZOOMX, 100),
        "zoomY": get(ZOOMY, get(ZOOMX, 100)),
    }
    if get(ANGLE):
        out["angle"] = get(ANGLE)
    if get(MIRROR):
        out["mirror"] = True
    out["visible"] = get(VISIBLE, 1) == 1
    if pattern >= 0 and pattern_shown is not None and not pattern_shown(pattern):
        out["visible"] = False
        pattern = 0
    if get(BLENDTYPE):
        out["blendType"] = get(BLENDTYPE)
    out["target"] = target
    out["graphicFrame"] = pattern if pattern >= 0 else 0
    out["opacity"] = get(OPACITY, 255)
    for key, idx in (("color", (COLORRED, COLORGREEN, COLORBLUE, COLORALPHA)),
                     ("tone", (TONERED, TONEGREEN, TONEBLUE, TONEGRAY)),
                     ("flash", (FLASHRED, FLASHGREEN, FLASHBLUE, FLASHALPHA))):
        vals = [get(i) for i in idx]
        if any(vals):
            out[key] = vals
    if get(LOCKED) == 1:
        out["locked"] = True
    out["priority"] = get(PRIORITY, 1)
    out["focus"] = get(FOCUS, 4)
    return out


def convert_anim(a, sound_res, bg_res, notes, pattern_shown=None):
    """
    Essentials Anim -> PokeRogue anim JSON object.
    sound_res(name) -> the game's file name for that sound, or None (dropped);
    bg_res(name) -> the graphic name to use for a background, or None (dropped with the update events that follow it).
    Upstream's converted files leave out Essentials' frame 0 (checked: Flamethrower, Thunderbolt, Tackle, Earthquake,
    Protect and Catastropika are Essentials frames 1.. exactly) while timed events keep their frame numbers.
    """
    frames = [[convert_cel(c, pattern_shown) for c in (fr or []) if c is not None] for fr in a.frames[1:]]
    events = {}
    bg_live = False
    # Essentials plays timings by frame number, not by list order (Move:TECTONICRAGE lists its background's fade-in,
    # scroll and fade-out before the background itself): walk them by frame, list order kept within a frame, so whether
    # a background is set yet is known when an update event comes (review fix 2026-11-18)
    for t in sorted(a.timings(), key=lambda t: num(t["frame"])):
        fi = num(t["frame"])
        if t["type"] == 0:
            res = sound_res(t["name"]) if t["name"] else ""
            if res is None:
                notes.append(f"{a.name}: sound '{t['name']}' is not in the game's audio, dropped")
                continue
            ev = {"frameIndex": fi, "resourceName": res, "volume": num(t["volume"], 80), "pitch": num(t["pitch"], 100),
                  "eventType": "AnimTimedSoundEvent"}
        elif t["type"] == 1:
            res = bg_res(t["name"]) if t["name"] else ""
            if res is None:
                notes.append(f"{a.name}: background '{t['name']}' not found, dropped")
                bg_live = False
                continue
            bg_live = True
            ev = {"frameIndex": fi, "resourceName": res, "bgX": num(t["bgX"]), "bgY": num(t["bgY"]),
                  "opacity": num(t["opacity"]), "duration": num(t["duration"], 5), "eventType": "AnimTimedAddBgEvent"}
        elif t["type"] == 2:
            if not bg_live:
                # Essentials then recolours its plain background colour; PokeRogue has nothing to tween
                notes.append(f"{a.name}: background update at frame {fi} comes before any background, dropped")
                continue
            # Essentials leaves unset fields unchanged; PokeRogue's AnimTimedUpdateBgEvent skips undefined ones too
            ev = {"frameIndex": fi, "resourceName": ""}
            for k in ("bgX", "bgY", "opacity"):
                if t[k] is not None:
                    ev[k] = num(t[k])
            ev["duration"] = num(t["duration"], 5)
            ev["eventType"] = "AnimTimedUpdateBgEvent"
        else:
            # Foreground graphic / colour (types 3, 4): PokeRogue has no foreground layer; upstream drops them too
            notes.append(f"{a.name}: foreground event '{t['name'] or 'colour'}' at frame {fi} has no PokeRogue "
                         "counterpart, dropped")
            continue
        events.setdefault(str(fi), []).append(ev)
    return {
        "graphic": stem(a.graphic),
        "frames": frames,
        "frameTimedEvents": events,
        "position": num(a.position, 4),
        "hue": num(a.hue, 0),
    }


def used_patterns(a, pattern_shown=None):
    return sorted({num(c[PATTERN]) for fr in a.frames for c in (fr or [])
                   if c is not None and num(c[PATTERN]) >= 0 and (pattern_shown is None or pattern_shown(num(c[PATTERN])))})


ESS_FRAME = 192   # Essentials' animation frames: 192x192, 5 per row (pbSpriteSetAnimFrame)
ESS_COLUMNS = 5


def png_size(path):
    with open(path, "rb") as f:
        head = f.read(24)
    return struct.unpack(">II", head[16:24])


def pattern_shown_in(path):
    """For an Essentials sheet: pattern p -> whether its 192x192 src_rect starts inside the image"""
    w, h = png_size(path)
    return lambda p: (p % ESS_COLUMNS) * ESS_FRAME < w and (p // ESS_COLUMNS) * ESS_FRAME < h


def as_sheet(w, h, px, size=96, columns=ESS_COLUMNS):
    """A halved sheet laid out as Phaser slices it: exactly `columns` frames wide (Phaser's frame n is then Essentials'
    pattern n) and whole frames high (a partial last row, which Essentials draws clipped, gets transparent padding)."""
    nw = size * columns
    nh = -(-h // size) * size
    if (nw, nh) == (w, h):
        return w, h, px
    out = bytearray(nw * nh * 4)
    cw = min(w, nw) * 4
    for y in range(h):
        out[y * nw * 4:y * nw * 4 + cw] = px[y * w * 4:y * w * 4 + cw]
    return nw, nh, bytes(out)


# ----------------------------------------------------------------------------------------------------------------------
# Commands
# ----------------------------------------------------------------------------------------------------------------------
def graphics_dir(essentials):
    return os.path.join(essentials, "Graphics", "Animations")


def find_graphic(essentials, name):
    """Graphics/Animations/<name>(.png) (case-insensitive), or None"""
    d = graphics_dir(essentials)
    want = stem(name).lower()
    for f in os.listdir(d):
        base, ext = os.path.splitext(f)
        if base.lower() == want and ext.lower() == ".png":
            return os.path.join(d, f)
    return None


def source_of(graphic):
    g = graphic.lower()
    if g.startswith("pras-"):
        return "PRAS"
    if g.startswith("gen8-") or g.startswith("gen 8"):
        return "GEN8"
    return "other"


def cmd_list(args):
    anims = load_anims(args.essentials)
    for a in anims:
        print(f"{a.id}\t{a.name}\t{a.graphic}\tframes={len(a.frames)}\tbg={','.join(a.background_names())}")
    print(f"{len(anims)} animations", file=sys.stderr)


def coverage(args):
    anims = load_anims(args.essentials)
    by = index_by_move(anims)
    rows = []
    for group, eid, enums in all_targets():
        rows.append((group, eid, enums, by.get(f"Move:{eid}"), by.get(f"OppMove:{eid}")))
    return anims, rows


def cmd_report(args):
    anims, rows = coverage(args)
    have = miss = 0
    for group, eid, enums, move, opp in rows:
        if move or opp:
            have += 1
            parts = []
            for a in (move, opp):
                if not a:
                    continue
                gfx = [a.graphic] + a.background_names()
                missing = [g for g in gfx if g and not find_graphic(args.essentials, g)]
                parts.append(f"{a.name} [{len(a.frames)}f, hue {a.hue}] gfx={gfx} src={source_of(a.graphic)}"
                             + (f" MISSING={missing}" if missing else "") + f" sounds={a.sound_names()}")
            print(f"HAVE  {group:10s} {eid:28s} -> {','.join(kebab(e) for e in enums)}\n      " + "\n      ".join(parts))
        else:
            miss += 1
            print(f"MISS  {group:10s} {eid:28s} -> {','.join(kebab(e) for e in enums)}")
    print(f"\n{have} with an animation, {miss} without")
    known = {f"{p}:{eid}" for _, eid, _, _, _ in rows for p in ("Move", "OppMove")}
    extra = [a.name for a in anims if re.search(r"MAX|ZMOVE|Z-MOVE|DYNAMAX|GMAX|ZPOWER", a.name.upper())
             and a.name not in known]
    if extra:
        print("Other Max / Z-like animation names: " + ", ".join(sorted(set(extra))))


def sound_index(pokerogue):
    """{lower-case stem: file name} of the game's battle-anim sounds"""
    d = os.path.join(pokerogue, "assets", "audio", "battle_anims")
    out = {}
    for f in sorted(os.listdir(d)):
        out.setdefault(os.path.splitext(f)[0].lower(), f)
    return out


MANIFEST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "essentials_anims_manifest.json")


class GraphicPlanner:
    """Decides, per Essentials graphic, which PokeRogue graphic name an animation uses (and writes new ones)."""

    def __init__(self, args, own_files):
        self.args = args
        self.out_img = os.path.join(args.pokerogue, "assets", "images", "battle_anims")
        self.done = {}
        self.written = []
        self.reused = []
        self.notes = []
        self.own_files = own_files

    def _existing(self, name):
        p = os.path.join(self.out_img, name + ".png")
        return p if os.path.exists(p) else None

    def resolve(self, name, patterns=None):
        """-> graphic name to reference, or None if the Essentials file is missing"""
        key = (stem(name), tuple(patterns) if patterns is not None else None)
        if key in self.done:
            return self.done[key]
        base = stem(name)
        src = find_graphic(self.args.essentials, base)
        if not src:
            self.notes.append(f"graphic '{base}' is not in the Essentials project")
            self.done[key] = None
            return None
        w, h, px = png_decode(src)
        dw, dh, dpx = downscale_half(w, h, normalize_transparent(px))
        # what gets written: sheets in Phaser's frame layout, backgrounds as they are
        ow, oh, opx = as_sheet(dw, dh, dpx) if patterns is not None else (dw, dh, dpx)
        chosen = None
        for cand in (base, base + " (Essentials)"):
            existing = self._existing(cand)
            if not existing:
                chosen = cand
                if not self.args.dry_run:
                    with open(os.path.join(self.out_img, cand + ".png"), "wb") as f:
                        f.write(png_encode(ow, oh, opx))
                self.written.append(cand + ".png")
                break
            if cand + ".png" in self.own_files:
                # written by an earlier run of this tool: refresh it
                chosen = cand
                if not self.args.dry_run:
                    with open(existing, "wb") as f:
                        f.write(png_encode(ow, oh, opx))
                self.written.append(cand + ".png")
                break
            ew, eh, epx = png_decode(existing)
            epx = normalize_transparent(epx)
            if patterns is None and (ew, eh) == (dw, dh) and epx == dpx:
                chosen = cand
                self.reused.append(f"{cand}.png (same image)")
                break
            if patterns is not None:
                # Phaser slices the existing sheet into ew // 96 columns; each used pattern must be that frame, whole,
                # and the same picture as in the Essentials sheet
                ecols = ew // 96
                if ecols and all((p // ecols + 1) * 96 <= eh
                                 and frame_block(ew, epx, p, cols=ecols) == frame_block(ow, opx, p, cols=ESS_COLUMNS)
                                 for p in patterns):
                    chosen = cand
                    self.reused.append(f"{cand}.png (the frames used are the same)")
                    break
            self.notes.append(f"graphic '{cand}' already in the game differs from the Essentials one "
                              f"({ew}x{eh} vs {dw}x{dh}); trying another name")
        self.done[key] = chosen
        return chosen


def cmd_convert(args):
    anims, rows = coverage(args)
    sounds = sound_index(args.pokerogue)
    out_json = os.path.join(args.pokerogue, "assets", "battle-anims")
    try:
        with open(MANIFEST, encoding="utf-8") as f:
            old = json.load(f)
    except (OSError, ValueError):
        old = {}
    own_json = set(old.get("json", []))
    own_img = set(old.get("images", []))
    planner = GraphicPlanner(args, own_img)
    notes, written, skipped, entries, missing_sounds = [], [], [], [], {}

    def sound_res(name):
        hit = sounds.get(stem(name).lower())
        if hit is None:
            es = os.path.join(args.essentials, "Audio", "SE", "Anim")
            cands = [f for f in os.listdir(es) if os.path.splitext(f)[0].lower() == stem(name).lower()] \
                if os.path.isdir(es) else []
            missing_sounds[name] = cands
        return hit

    for group, eid, enums, move, opp in rows:
        if not (move or opp):
            continue
        targets = [e for e in enums]
        files = [kebab(e) + ".json" for e in targets]
        upstream = [f for f in files if os.path.exists(os.path.join(out_json, f)) and f not in own_json]
        if upstream and not args.overwrite:
            skipped.extend(upstream)
            continue
        objs = []
        graphics = set()
        for a in (move, opp):
            if not a:
                continue
            src = find_graphic(args.essentials, a.graphic) if a.graphic else None
            shown = pattern_shown_in(src) if src else None
            sheet = planner.resolve(a.graphic, used_patterns(a, shown)) if a.graphic else ""
            if sheet is None:
                notes.append(f"{a.name}: sheet '{a.graphic}' missing, animation not converted")
                objs = []
                break

            def bg_res(n):
                r = planner.resolve(n)
                if r:
                    graphics.add(r)
                return r

            obj = convert_anim(a, sound_res, bg_res, notes, shown)
            obj["graphic"] = sheet
            if sheet:
                graphics.add(sheet)
            objs.append(obj)
        if not objs:
            continue
        data = objs[0] if len(objs) == 1 else objs
        for e, fn in zip(targets, files):
            if not args.dry_run:
                with open(os.path.join(out_json, fn), "w", encoding="utf-8", newline="\n") as f:
                    json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
                    f.write("\n")
            written.append(fn)
            entries.append({"moveId": e, "group": group, "file": fn,
                            "essentials": [a.name for a in (move, opp) if a],
                            "graphics": sorted(graphics),
                            "source": source_of((move or opp).graphic)})
    names = {a.name for a in anims}
    for eid, variants in UNCONVERTED_VARIANTS.items():
        found = [v for v in variants if v in names]
        if found:
            notes.append(f"Move:{eid}: the Essentials data also has {', '.join(repr(v) for v in found)} (one per user "
                         f"species); PokeRogue keys move animations by MoveId and the Essentials project plays none of "
                         f"them, so Move:{eid} plays for every user (known limitation, not converted)")
    # files an earlier run of this tool wrote that this run no longer needs
    stale = []
    for name in sorted(own_img - set(planner.written)):
        stale.append(os.path.join("images", "battle_anims", name))
        if not args.dry_run and os.path.exists(os.path.join(planner.out_img, name)):
            os.remove(os.path.join(planner.out_img, name))
    for name in sorted(own_json - set(written)):
        stale.append(os.path.join("battle-anims", name))
        if not args.dry_run and os.path.exists(os.path.join(out_json, name)):
            os.remove(os.path.join(out_json, name))
    result = {
        "removedStale": stale,
        "json": written,
        "images": sorted(set(planner.written)),
        "imagesReused": sorted(set(planner.reused)),
        "skippedUpstream": skipped,
        "missingSounds": missing_sounds,
        "notes": notes + planner.notes,
        "entries": entries,
        "missing": [{"group": g, "essentials": eid, "moveIds": enums} for g, eid, enums, m, o in rows if not (m or o)],
    }
    if not args.dry_run:
        with open(MANIFEST, "w", encoding="utf-8", newline="\n") as f:
            json.dump(result, f, ensure_ascii=False, indent=1)
            f.write("\n")
    print(json.dumps({k: v for k, v in result.items() if k != "entries"}, ensure_ascii=False, indent=1))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("cmd", choices=["list", "report", "convert", "dump"])
    p.add_argument("--essentials", default=DEFAULT_ESSENTIALS)
    p.add_argument("--pokerogue", default=DEFAULT_POKEROGUE)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--overwrite", action="store_true", help="also replace animation files upstream PokeRogue has")
    p.add_argument("--name", default=None)
    args = p.parse_args()
    if args.cmd == "list":
        cmd_list(args)
    elif args.cmd == "report":
        cmd_report(args)
    elif args.cmd == "convert":
        cmd_convert(args)
    elif args.cmd == "dump":
        for a in load_anims(args.essentials):
            if a.name == args.name:
                print(json.dumps({"id": a.id, "name": a.name, "graphic": a.graphic, "hue": a.hue,
                                  "position": a.position, "speed": a.speed, "timings": a.timings(),
                                  "frames": [[list(c) if c is not None else None for c in (fr or [])]
                                             for fr in a.frames]},
                                 ensure_ascii=False, default=str))
                break


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
