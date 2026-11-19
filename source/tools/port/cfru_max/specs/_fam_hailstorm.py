# Local fork (2026-11-19): shared body of Max Hailstorm and G-Max Resonance, rebuilt from CFRU ANIM_MAX_HAILSTORM /
# ANIM_G_MAX_RESONANCE (Complete FireRed Upgrade, Skeli and the CFRU team; extract/ANIM_MAX_HAILSTORM.txt,
# extract/ANIM_G_MAX_RESONANCE.txt). Both scripts call the same MAX_HAILSTORM_ROCKS_ON_* sub-scripts: three giant
# ice rocks (ANIM_TAG_ICE_ROCK, 64x64 shown 2x / 2x / 2.5x) fall 60 GBA px onto the target at x -40, +30 and 0 and
# shatter; with the third rock the target is pushed 21 GBA px down, every battler shakes, then it slides back.
# Max Hailstorm adds the vanilla Hail task (30 hailstones) on a darkened BG; G-Max Resonance has no hail and swaps
# the dark stage for BG_AURORA_BEAM scrolling sideways. The spec files only choose those two things.
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403

# --- timeline (our frames, 20 fps); CFRU frames in brackets (60 fps, Max Hailstorm default path)
FLEX_END = 15                  # [f72]  flex done, the rocks / hail start
ROCK_T = (15, 23, 31)          # [f72, f104, f136] launches; CFRU 32 GBA f apart -> 8 frames
FALL = 6                       # 60 GBA px at 3 px/f = 20 GBA f -> 6 frames (lands on the 7th)
PUSH_T = 33                    # [f143] the big rock's lower edge reaches the target's centre: push + shake + thud
PUSH_HOLD_END = 45             # [f191] 48 GBA f held -> 12 frames
BACK_END = 50                  # [f207] 16 GBA f slide back -> 5 frames
LENGTH = 54                    # dark stage / scene BG fades back over the last 8 frames, together with the slide

# CFRU HAILSTORM_ICE_ROCK / HAILSTORM_LARGER_ICE_ROCK args: x offset from the target (GBA px), affine size. CFRU does
# not mirror x (the target-on-player branch uses the same -40 / 30 / 0), and neither do we (focus "target").
ROCKS = [(-40, 2.0), (30, 2.0), (0, 2.5)]
ROCK_DROP = 60                 # GBA px above the landing point
PUSH_PX = gba(21)              # Template_SlideMonToOffset (0, +21) over 4 GBA f
# hail landing points around the target (anim px from its centre; CFRU: 10 points around the target)
HAIL_PTS = [(-40, 22), (-14, -8), (8, 26), (30, -2), (46, 18), (-30, -24), (18, -26), (-6, 12), (36, 32), (-46, 4)]
# vanilla hail falls diagonally 4 px right / 8 px down per GBA frame -> (15.6, 31.2) anim px per frame
HAIL_STEP = (gba(4 * 3), gba(8 * 3))
HAIL_FALL = 5                  # frames in the air: the start is above the screen for a target on either side
                               # (review 2026-11-19: with 4 the stones over a bottom-side target popped in at y 5-23)
# the hailstone (SUBS HAIL = PRAS- Ice frame 17) cropped with 78 transparent px below it, so the stone sits at the
# top of its 96 px cell (centre 38 px above the cell centre). Review 2026-11-19: the preview renderer crashes on a
# cel whose 96 px box lies wholly above the canvas, so such frames must be hidden; with a centred stone that hid 11
# frames in which the stone WAS on screen for an enemy user (a bottom-side target is 64 px lower). With the box
# reaching 86 px below the stone, a hidden frame is off screen on both sides.
HAIL_BOX = (236, 330, 16, 96)  # x, y, w, h in PRAS- Ice.png (frame 17 is the cell at 192, 288; stone at 238-250 x 332-348)
HAIL_UP = 38                   # stone centre above the cell centre (cell px)


def ice_rocks(a, t_launch=ROCK_T, zoom_k=1.0, tint=None):
    """The three CFRU ice rocks: frame 0 falling (constant speed), frames 1-4 the shatter (1 per frame, as CFRU's
    5 x 3 GBA f). Rock picture ~30 px in its 64 px frame; 2x / 2.5x x 1.3 -> zoom 260 / 325 (78 / 98 px rocks).
    Returns the landing frames."""
    rock = tag_cells(a, "ICE_ROCK", **({"tint": tint} if tint else {}))   # Ice_Rock.png, 5 frames 64x64, scale 1
    lands = []
    for (gx, size), t in zip(ROCKS, t_launch):
        x = gba(gx)
        z = 130 * size * zoom_k
        cells = [rock[0]] * FALL + [rock[1], rock[1], rock[2], rock[3], rock[4]]
        s = a.sprite(cells, t, t + len(cells), focus="target", loop=False, zoom=z)
        s.move(at_target(x, -gba(ROCK_DROP)), at_target(x, 0), t_to=FALL)
        # CFRU just removes the rock after its last shatter frame; a light fade only (review 2026-11-19: 120 turned
        # the white shards into grey dust on the dark stage)
        s.fade(255, 255, t_from=0, t_to=len(cells) - 2)
        s.fade(255, 205, t_from=len(cells) - 2, t_to=len(cells) - 1)
        lands.append(t + FALL)
    return lands


def hail(a, t0=FLEX_END, t1=41, count=22, impact_every=2):
    """The vanilla Hail task CFRU runs under the rocks (30 hailstones onto 10 points around the target; full-size
    ones leave an ICE_CRYSTALS impact). Ours: `count` hailstones landing evenly over [t0 + HAIL_FALL, t1], each
    falling HAIL_FALL frames along the vanilla diagonal; every `impact_every`-th leaves the crystal burst."""
    # PRAS- Ice 17 (SUBS "HAIL"), pushed toward hail white, cropped so the stone sits at the top of its cell
    stone = a.cells(SUBS["HAIL"]["src"], frames=[0], box=HAIL_BOX, tint=(225, 245, 255, 0.55))
    crystals = sub_cells(a, "ICE_CRYSTALS")                     # PRAS- Ice 8-11, blue crystal shattering
    first = t0 + HAIL_FALL
    for i in range(count):
        tl = first + round(i * (t1 - first) / max(1, count - 1))   # landing frame
        px, py = HAIL_PTS[(i * 3) % len(HAIL_PTS)]                 # stride 3 so neighbours land apart
        big = i % impact_every == 0
        z = 150 if big else 105
        off = HAIL_UP * z / 100                                    # sprite centre below the stone
        sx, sy = px - HAIL_STEP[0] * HAIL_FALL, py - HAIL_STEP[1] * HAIL_FALL
        s = a.sprite(stone, tl - HAIL_FALL, tl + 1, focus="target", zoom=z)
        s.move(at_target(sx, sy + off), at_target(px, py + off), t_to=HAIL_FALL)
        # hidden while the cell box (stone - 10 z .. stone + 86 z) lies wholly above the screen for a top-side
        # target (field y = 52 + dy): the stone is then off screen for a target on either side, and the preview
        # renderer crashes on such a cel
        below = (48 + HAIL_UP) * z / 100
        for k in range(HAIL_FALL + 1):
            above = 52 + sy + HAIL_STEP[1] * k + below < 2
            s.key(k, opacity=0 if above else 255)
        if big:
            c = a.sprite(crystals, tl + 1, tl + 1 + len(crystals), focus="target", loop=False,
                         pos=at_target(px, py), zoom=100)
            c.fade(255, 140, t_from=len(crystals) - 2, t_to=len(crystals) - 1)
    return t1


def push_and_shake(a, t=PUSH_T, hold_end=PUSH_HOLD_END, back_end=BACK_END):
    """CFRU MAX_HAILSTORM_REJOIN: AnimTask_screen_shake (all battlers, horizontal, 4 px decaying over 8 steps,
    ~40 GBA f) + SE_M_STRENGTH, the target slid 21 GBA px down in 4 GBA f, held 48 f, slid back in 16 f.
    (begin() gives the battler cels their own focus, so "down" stays down when an enemy uses the move.)"""
    se(a, t, "SE_M_STRENGTH", volume=110)
    a.target.key(t, pos=(0, 0))
    a.target.key(t + 2, pos=(0, PUSH_PX), ease="out")
    a.target.key(hold_end, pos=(0, PUSH_PX))
    a.target.key(back_end, pos=(0, 0), ease="inout")
    for b in (a.user, a.target):
        b.shake(t, t + 4, amp=5, period=1, axis="x")
        b.shake(t + 4, t + 8, amp=3, period=1, axis="x")
        b.shake(t + 8, t + 13, amp=2, period=1, axis="x")


def rock_sounds(a, lands, launches=ROCK_T):
    """CFRU: SE_FALL at every launch (twice for the first rock: the hail's and the rock's), SE_M_STRENGTH thuds in
    between. Ours: SE_FALL per launch, a thud when rocks 1 and 2 land (the third thud is the push's)."""
    for i, t in enumerate(launches):
        se(a, t, "SE_FALL", volume=95 if i else 100, pitch=100 + 4 * i)
    for t in lands[:2]:
        se(a, t, "SE_M_STRENGTH", volume=95)


def hailstorm_body(a, sheet, scene=None, scroll=(-16, 0), with_hail=True, tone_k=0.45, rock_tint=None):
    """The whole Max Hailstorm / G-Max Resonance animation (LENGTH frames).
    scene: None = CFRU's 14/16 dark stage for the whole move (Max Hailstorm); a BG name = dark stage, then black
    under the flex and a cut to that scene BG at f11, scrolled by `scroll` field px a frame (G-Max Resonance:
    "PRAS- Aurora BG" for BG_AURORA_BEAM). with_hail: the vanilla Hail task (Max Hailstorm only). rock_tint: an
    a.cells tint for the rocks (Resonance pushes them bluer so they part from the pale green aurora)."""
    L = LENGTH
    begin(a, sheet, L)
    if scene is None:
        dark_stage(a, 0, L - 1, fade_in=8, fade_out=8)
    else:
        dark_stage(a, 0, None, fade_in=6)
        bg_fade(a, 8, DARK, 255, 3)              # full black under the flex peak, then the cut
        scene_bg(a, 11, L - 1, scene, scroll=scroll, fade_out=8)
    dynamax_flex(a, 0)

    if with_hail:
        hail(a)
    lands = ice_rocks(a, tint=rock_tint)
    rock_sounds(a, lands)
    push_and_shake(a)
    # CFRU has no target blend here; a soft ice tone from the push to the end so the hit reads (house rule: note)
    impact(a, PUSH_T, L - 1, "ice", k=tone_k, ramp=4, release=8, shake=False)
    a.note(f"CFRU has no target blend in Max Hailstorm / G-Max Resonance; a soft ice tone (k {tone_k}) was added "
           f"from the push (f{PUSH_T}) and fades with the background")
    a.note("Rocks: CFRU's x offsets -40 / +30 / 0 are not mirrored in CFRU either (the target-on-player branch "
           "uses the same values, only its pauses are 5-7 GBA f longer); kept for both sides")
    return L
