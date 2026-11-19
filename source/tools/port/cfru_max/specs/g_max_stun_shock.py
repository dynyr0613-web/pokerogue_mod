# Local fork (2026-11-19): G-Max Stun Shock, rebuilt from CFRU ANIM_G_MAX_STUNSHOCK (Complete FireRed Upgrade, Skeli
# and the CFRU team; extract/ANIM_G_MAX_STUNSHOCK.txt). CFRU: tint UNUSED_LIGHTNING, LIGHTNING and SPARK_2 10/16 toward
# purplish pink 0x701D, then goto ANIM_MAX_LIGHTNING_BEGIN. Same body as Max Lightning (specs/_fam_lightning.py) with
# the particles baked purplish pink; BG, screen flashes and the target's colour stay yellow, as in CFRU.
# CFRU beats (302 GBA f) -> ours (61 frames): the Max Lightning table (specs/max_lightning.py), i.e.
#   f0    particle tint 10/16 0x701D; BG_MAX_LIGHTNING in, scrolling   -> sheet cells tinted; f0..4 storm BG in
#   f32   flex + 4 (pink) spark bursts, attacker yellow pulses         -> f4..18
#   f104  (pink) lightning column; f111 shake, 2 yellow screen flashes -> f19..27; f21..52; f21..22, f25..26
#   f126  target to yellow + 3 (pink) spark pillars, (pink) bolts at x+20 / x-20
#                                                                      -> f27..35 ramp; pillars f27/35/43, bolts f34/42
#   f269  yellow and the BG fade back                                  -> f53..60
import os, sys; sys.path.insert(0, os.path.dirname(__file__)); from _common import *  # noqa: E401,E702,F403
from _fam_lightning import lightning_body, STORM_BG  # noqa: E402

MOVE_ID = "G_MAX_STUN_SHOCK"

# AnimTask_BlendParticle 10/16 toward 0x701D (#EE00E6), the three particle palettes
PARTICLE_TINT = EXTRA_COLORS["purplish_pink"] + (0.62,)


def build(a):
    lightning_body(a, "CFRU- G-Max Stun Shock", tint=PARTICLE_TINT)
    a.note(f"Same body as Max Lightning; sparks and bolts baked 10/16 toward 0x701D. BG '{STORM_BG}' stands in for "
           f"BG_MAX_LIGHTNING; the yellow screen flashes and the target's yellow blend are CFRU's (its Stun Shock "
           f"prelude recolours only the particles)")
