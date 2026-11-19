# Local fork (2026-11-19): G-Max Malodor, rebuilt from CFRU ANIM_G_MAX_MALODOR (Complete FireRed Upgrade, Skeli and
# the CFRU team; extract/ANIM_G_MAX_MALODOR.txt): Max Ooze on a Garbage Falls BG with garbage-green columns. Body
# shared with Max Ooze: specs/_fam_ooze.py.
# CFRU beats (318 GBA f) -> ours (55 frames):
#   f0    Dynamax flex (72 f); SE_M_BUBBLE3 x3; 6 MALODOR_REVERSAL bubbles (POISON_BUBBLE drawn with the RAZOR_LEAF
#         palette: green) orbit the attacker (52 f)                  -> flex f0..14, SE f0 / f5, orbit f1..14
#                                                                       (Sludge Bomb bubble tinted leaf green)
#   f0    battle BG fades out, BG_GARBAGE_FALLS fades in, scrolling 0.94 px/f vertically
#                                                                    -> f0..6 PRAS- Thousand WA BG (murky green)
#                                                                       fades in, drifting down 63 px in all (the
#                                                                       texture does not tile vertically)
#   f72   SE_M_HYDRO_PUMP, GARBAGE_COLUMN (the poison column with the garbage palette) on target (+30, +5)
#                                                                    -> f15
#   f120  SE_M_HYDRO_PUMP, column 2 at (-50, -10)                    -> f23
#   f168  SE_SHIP, column 3 at (-10, -25)                            -> f31
#   f171  target shakes vertically and blends 0 -> 16/16 garbage green 0x2DCC
#                                                                    -> shake f32..44, green peaks f40
#   f269  the columns vanish; colour fades back; BG restored          -> columns gone f45, colour + BG out f46..54
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _fam_ooze import *  # noqa: E401,E702,F403

MOVE_ID = "G_MAX_MALODOR"
# PRAS- Thousand WA BG is 406x195 (244 field px tall at x1.25) and shows a seam when wrapped vertically: the screen
# (180 px) starts 63 px into the tile and drifts to its top row, so no seam ever enters the view
BG_TOP = (-63, 0)
# CFRU draws the bubble tiles with the RAZOR_LEAF palette (leaf greens)
LEAF_GREEN = (100, 205, 70, 0.8)
# 0x2DCC (98, 115, 90) is a dull grey-green; blend_tone() of it only darkens a sprite, so red and blue are pulled
# down harder than green to make the dirty green read (gray stays 0)
GARBAGE_TONE = [-70, 15, -70, 0]


def build(a):
    bubbles = sub_cells(a, "POISON_BUBBLE", tint=LEAF_GREEN)
    columns = tag_cells(a, "GARBAGE_COLUMN")             # Poison_Column.png + Palette_Only/Garbage_Poison_Column
    ooze_body(a, "CFRU- G-Max Malodor", "PRAS- Thousand WA BG", BG_TOP, bubbles, columns, tone=GARBAGE_TONE)
    a.note("BG: BG_GARBAGE_FALLS is not in the download; PRAS- Thousand WA BG (murky dark green) stands in. It does "
           "not tile vertically, so it drifts only 63 px (CFRU scrolls ~200 px over the move)")
    a.note(f"Target colour: garbage green 0x2DCC approximated by the tone {GARBAGE_TONE} (blend_tone of it only "
           "darkens); see GARBAGE_TONE")
