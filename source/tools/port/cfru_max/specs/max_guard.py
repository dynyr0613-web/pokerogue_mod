# Local fork (2026-11-19): Max Guard, rebuilt from CFRU ANIM_MAX_GUARD (Complete FireRed Upgrade, Skeli and the CFRU
# team; extract/ANIM_MAX_GUARD.txt). A self move: the engine plays it with target == user, skips every USER cel and
# draws the user with the TARGET cel (battle-anims.ts: `if (isUser && target === user) continue`), so the flex is
# keyed on both battler cels and every graphic uses focus "user" (USER_TARGET collapses onto the user).
# CFRU beats (194 GBA f) -> ours (48 frames):
#   f0    Dynamax flex (2x in 32 f, hold 32 f, back in 8 f); no BG darkening   -> f0..14 (flex 15 frames, both cels)
#   f72   goto vanilla Move_PROTECT: waitplaysewithpan SE_M_REFLECT, 16 = the sound plays, then the script waits
#         16 f                                                     -> f13 (PRSFX- Protect.wav, see note), during the
#                                                                     flex snap-back
#   f88   the 64x64 PROTECT shield appears at attacker (+24, 0), alpha-blended
#                                                                  -> f15 (PRAS- Protect hex shield, the game's own
#                                                                     Protect art, popping in to ~90 px)
#   f88-194 shield palette cycles every 2 f, drifts left 0.375 px/f (~46 GBA px), 90 f then fades out
#                                                                  -> f15..45: the 5 Protect colour frames ping-pong,
#                                                                     drift +18 -> -14 px, fade f39..45
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403

MOVE_ID = "MAX_GUARD"

SHIELD_Y = -12      # the x1.5 user's visual centre is 16 px above its graphic focus at rest; 4 px lower keeps the
                    # top of the shield on screen for an enemy user (the Dynamaxed enemy reaches the top edge)
SHIELD_ZOOM = 220   # PRAS- Protect is a 40 px hex cluster: 220 % = ~88 px, about the Dynamaxed user's body
PALETTE_CYCLE = [0, 1, 2, 3, 4, 3, 2, 1]   # cyan -> white -> cyan: vanilla Protect rotates its palette every 2 f


def self_flex(a, t0=0):
    """dynamax_flex() keys only a.user; on a self move the engine draws the user with the TARGET cel, so the same
    zoom / lift keys go on a.target too (the USER cel is skipped in game; the standard preview still shows it)."""
    end = dynamax_flex(a, t0)
    peak, grow, hold, shrink = FLEX["peak"], FLEX["grow"], FLEX["hold"], FLEX["shrink"]
    lift = round(48 * (peak - 100) / 100)
    t1, t2 = t0 + grow, t0 + grow + hold
    a.target.key(t0, zoom=100, pos=(0, 0))
    a.target.key(t1, zoom=peak, pos=(0, -lift), ease="out")
    a.target.key(t2, zoom=peak, pos=(0, -lift))
    a.target.key(end, zoom=100, pos=(0, 0), ease="in")
    return end


def build(a):
    L = 48
    begin(a, "CFRU- Max Guard", L)
    shield = sub_cells(a, "PROTECT")                       # PRAS- Protect frames 0-4 (cyan -> white)
    cycle = [shield[i] for i in PALETTE_CYCLE]
    glow = a.cells("pr:Light1", frames=[6], tint=(120, 240, 255, 0.8))[0]

    # --- the flex (CFRU waits for it before Move_PROTECT)
    flex_end = self_flex(a, 0)

    # --- the shield: pops in after the flex, shimmers (palette cycle), drifts left across the user, fades out.
    # x drift is not mirrored for an enemy user, exactly like CFRU (AnimProtect: x2 -= 0.375 px/f on either side)
    t0, t1 = flex_end, L - 2
    life = t1 - t0
    s = a.sprite(glow, t0, t0 + 5, focus="user", blend="add", priority=1)
    s.key(0, pos=at_user(18, SHIELD_Y), zoom=120, opacity=220)
    s.key(2, pos=at_user(17, SHIELD_Y), zoom=260, opacity=160, ease="out")
    s.key(4, pos=at_user(16, SHIELD_Y), zoom=300, opacity=0)
    s = a.sprite(cycle, t0, t1, focus="user", priority=1)
    s.move(at_user(18, SHIELD_Y), at_user(-14, SHIELD_Y), t_to=life - 1)       # linear, like CFRU's drift
    s.key(0, zoom=SHIELD_ZOOM * 0.6, opacity=120)
    s.key(2, zoom=SHIELD_ZOOM * 1.06, opacity=235, ease="out")
    s.key(4, zoom=SHIELD_ZOOM, opacity=215)
    s.key(life - 7, zoom=SHIELD_ZOOM, opacity=205)
    s.key(life - 1, zoom=SHIELD_ZOOM * 1.04, opacity=0, ease="in")

    # CFRU / vanilla: waitplaysewithpan plays SE_M_REFLECT first and then waits 16 f before the shield (2026-11-19
    # review: the sound was 2 frames after the shield, the reverse order)
    a.sound(flex_end - 2, "PRSFX- Protect.wav", volume=100)

    a.note("Shield: vanilla Move_PROTECT's PROTECT sprite is not in the CFRU download; PRAS- Protect (the game's own "
           "Protect hexes, 5 colour frames played back and forth as the palette cycle) at 220 % stands in for it")
    a.note("Sound: CFRU plays SE_M_REFLECT (PRSFX- Reflect.wav, 1.98 s = ~1 s end hold); the game's own "
           "PRSFX- Protect.wav (1.43 s, ~0.7 s hold) is used instead")
    a.note("Self move: the flex is keyed on the TARGET cel too (the engine skips USER cels when target == user); "
           "the standard preview shows the right battler flexing as a stand-in")
    a.note("Additive pop glow when the shield appears (pr:Light1, 4 frames) is ours; CFRU shows the shield at once")
