# Local fork (2026-11-19): G-Max Gold Rush, rebuilt from CFRU ANIM_G_MAX_GOLDRUSH (Complete FireRed Upgrade, Skeli and
# the CFRU team; extract/ANIM_G_MAX_GOLDRUSH.txt): Max Strike whose columns are EXPLOSION_COINS_GEYSER (15 puffs + 16
# spinning COIN particles each). Body and beat table: specs/_fam_strike.py.
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _fam_strike import *  # noqa: E401,E702,F403

MOVE_ID = "G_MAX_GOLD_RUSH"


def build(a):
    # COIN substitute: PokeRogue's Pay Day coin (SUBS). Its sheet holds a small and a large pair of the same coin
    # (face, ridged rim); cycling all four made the coin pulse in size every frame, so the spin flips between the
    # large face and the large rim (2026-11-19 review). Zoom 160: the 8x14 coin is about 13x22 px, CFRU's 16 px
    # OAM coin x 1.3.
    coin = riser(a, "coin", zoom=160, frames=[3, 2])
    strike_body(a, "CFRU- G-Max Gold Rush", kind=coin)
    a.note("COIN: the vanilla FRLG coin is not in the CFRU download; PokeRogue's Pay Day coin, its large face and "
           "large rim frames flipping every frame (the spin), at zoom 160 (about GBA size x 1.3) so the gold reads "
           "over the orange explosion puffs")
