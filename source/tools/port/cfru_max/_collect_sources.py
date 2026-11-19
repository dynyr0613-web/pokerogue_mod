# 2026-11-19: which source graphics the 38 CFRU Max animations use (for the credits); builds with --no-write semantics
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import maxanim
used = {}
orig = maxanim.make_cell
def wrapped(src, frame=0, *args, **kw):
    used.setdefault(src, set()).add(str(frame) if "box" not in kw else f"box{kw['box']}")
    return orig(src, frame, *args, **kw)
maxanim.make_cell = wrapped
specs = sorted(f[:-3] for f in os.listdir(maxanim.SPEC_DIR) if f.endswith(".py") and not f.startswith("_"))
per_spec = {}
for s in specs:
    before = set(used)
    mod = maxanim.load_spec(s)
    a = maxanim.Anim(getattr(mod, "MOVE_ID", s.upper()))
    mod.build(a)
    per_spec[s] = sorted(k for k in used)  # cumulative is fine for credits
out = {"sources": {k: sorted(v) for k, v in sorted(used.items())}, "specs": specs}
json.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "sources_used.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
kinds = {}
for k in used:
    kinds.setdefault(k.split(":", 1)[0], []).append(k.split(":", 1)[1])
print(json.dumps({k: sorted(v) for k, v in kinds.items()}, ensure_ascii=True))
