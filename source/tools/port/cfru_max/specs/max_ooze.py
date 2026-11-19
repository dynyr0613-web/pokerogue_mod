# Local fork (2026-11-19): Max Ooze, rebuilt from CFRU ANIM_MAX_OOZE (Complete FireRed Upgrade, Skeli and the CFRU
# team; extract/ANIM_MAX_OOZE.txt). Body shared with G-Max Malodor: specs/_fam_ooze.py.
# CFRU beats (318 GBA f) -> ours (55 frames):
#   f0    no darkening; Dynamax flex (72 f); SE_M_BUBBLE3 x3 13 f apart; 6 POISON_BUBBLEs orbit the attacker
#         (AnimReversalOrb: flat ring growing then shrinking, behind the attacker on the back half, 52 f)
#                                                                    -> flex f0..14, SE f0 / f5, orbit f1..14
#                                                                       (PRAS- Sludge Bomb bubble, SUBS)
#   f0    battle BG fades out, BG_POISON fades in (f16-32), scrolling 0.94 px/f vertically to the end
#                                                                    -> f0..6 PRAS- Sludge Wave FG (purple) fades in,
#                                                                       drifting down ~3.7 px a frame (= CFRU speed)
#   f72   SE_M_HYDRO_PUMP, POISON_COLUMN (32x64, 2x) erupts on target (+30, +5), held to f269
#                                                                    -> f15
#   f120  SE_M_HYDRO_PUMP, column 2 at (-50, -10)                    -> f23
#   f168  SE_SHIP, column 3 at (-10, -25)                            -> f31
#   f171  target shakes vertically (to f265) and blends 0 -> 16/16 purple 0x6038 (one step / 3 f)
#                                                                    -> shake f32..44, purple peaks f40
#   f269  the columns vanish together; purple fades back (49 f); BG restored (32 f)
#                                                                    -> columns gone f45, purple + BG out f46..54
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _fam_ooze import *  # noqa: E401,E702,F403

MOVE_ID = "MAX_OOZE"
# PRAS- Sludge Wave FG (640x576) is opaque only in rows 50-383 (field 62-479 at x1.25): the screen's top edge drifts
# from texture row 280 to row 77 (field px), never reaching the transparent band
BG_TOP = (-280, -77)


def build(a):
    bubbles = sub_cells(a, "POISON_BUBBLE")              # PRAS- Sludge Bomb 0-3
    columns = tag_cells(a, "POISON_COLUMN")              # CFRU Poison_Column.png, 7 frames 32x64
    ooze_body(a, "CFRU- Max Ooze", "PRAS- Sludge Wave FG", BG_TOP, bubbles, columns, tone_type="poison")
    a.note("BG: BG_POISON is not in the download; PRAS- Sludge Wave FG (the purple Sludge Wave overlay) stands in")
