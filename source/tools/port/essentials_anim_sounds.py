"""Local fork (2026-11-18): copy the Z-move animation sounds the game lacks from the Essentials project (Audio/SE/Anim,
.ogg) into pokerogue/assets/audio/battle_anims as 16-bit PCM .wav (the format of the game's other 1180 anim sounds), so
tools/port/essentials_anims.py convert can reference them. The user: "Z-다이 전용 전투 에니메이션은 아마 자료가
에센셜용으로 꽤 많이 있을거라 그걸 얻어오면 되고". Same source as the animations (Pokémon Reborn's PRSFX set).
Needs PyAV (av), e.g. ComfyUI's embedded Python:  <python with av> -I essentials_anim_sounds.py
Reads essentials_anims_manifest.json's missingSounds; never overwrites an existing game file.
"""
import json
import os
import sys

import av

HERE = os.path.dirname(os.path.abspath(__file__))
ESSENTIALS = "C:/Users/jaehe/OneDrive/바탕 화면/Pokemon Essentials v21.1 2023-07-30"
OUT = "D:/PokeRogueDev/pokerogue/assets/audio/battle_anims"

manifest = json.load(open(os.path.join(HERE, "essentials_anims_manifest.json"), encoding="utf-8"))
done, skipped = [], []
for name, cands in manifest["missingSounds"].items():
    if not cands:
        skipped.append(name)
        continue
    src = os.path.join(ESSENTIALS, "Audio", "SE", "Anim", cands[0])
    dst = os.path.join(OUT, os.path.splitext(cands[0])[0] + ".wav")
    if os.path.exists(dst):
        continue
    with av.open(src) as inp:
        stream = inp.streams.audio[0]
        rate = stream.rate or stream.codec_context.sample_rate
        layout = stream.layout.name if stream.layout else "stereo"
        with av.open(dst, "w", format="wav") as out:
            o = out.add_stream("pcm_s16le", rate=rate, layout=layout)
            resampler = av.AudioResampler(format="s16", layout=layout, rate=rate)
            for frame in inp.decode(stream):
                for rf in resampler.resample(frame):
                    for p in o.encode(rf):
                        out.mux(p)
            for rf in resampler.resample(None):
                for p in o.encode(rf):
                    out.mux(p)
            for p in o.encode(None):
                out.mux(p)
    done.append(os.path.basename(dst))
print(f"wrote {len(done)} wav, no source for {len(skipped)}: {skipped}")
json.dump({"written": done, "noSource": skipped}, open(os.path.join(HERE, "essentials_anim_sounds_written.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
