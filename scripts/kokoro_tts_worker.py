#!/usr/bin/env python3
"""Batch worker for offline Kokoro neural speech synthesis."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro
from misaki import en, zh


# The lesson intentionally plays word fragments one by one. Dictionary G2P
# treats several of them as unrelated words (or unknown words), so preserve the
# pronunciation they have inside the full teaching word instead.
EN_FRAGMENT_PHONEMES = {
    "col": "kˈɑ",
    "lar": "ləɹ",
    "tea": "tˈi",
    "cher": "ʧˈɛɹ",
    "doc": "dˈɑk",
    "tor": "təɹ",
    "ta": "tˈA",
    "pir": "pəɹ",
    "le": "lˈi",
    "mur": "məɹ",
    "but": "bˈʌ",
    "ter": "Təɹ",
    "for": "fˈɔɹ",
    "ward": "wəɹd",
    "sai": "sˈA",
    "lor": "ləɹ",
    "beau": "bjˈu",
    "ti": "Tə",
    "ful": "fəl",
    # Home-video sentence splits
    "do": "dˈu",
    "ing": "ɪŋ",
    "ma": "mˈA",
    "king": "kɪŋ",
    "vi": "vˈɪ",
    "de": "di",
    "o": "oʊ",
    "grand": "ɡɹˈænd",
    "sing": "sˈɪŋ",
    "cher": "ʧˈɛɹ",
    "ry": "ɹi",
    "kit": "kˈɪt",
    "chen": "ʧən",
    "cook": "kˈʊk",
    "eat": "ˈit",
    "pa": "pɑ",
    "liv": "lˈɪv",
    "watch": "wˈɑʧ",
    "gar": "ɡˈɑɹ",
    "den": "dən",
    "sleep": "slˈip",
    "a": "ə",
    "way": "wˈA",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--jobs", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    jobs = json.loads(args.jobs.read_text(encoding="utf-8"))
    if not jobs:
        return

    kokoro = Kokoro(
        str(args.model_dir / "kokoro-v1.1-zh.onnx"),
        str(args.model_dir / "voices-v1.1-zh.bin"),
    )
    en_g2p = en.G2P(trf=False, british=False, fallback=None)
    zh_g2p = zh.ZHG2P(version="1.1", en_callable=en_g2p)
    phonemizers = {"zh": zh_g2p, "en": en_g2p}

    for index, job in enumerate(jobs, 1):
        output = Path(job["output"])
        output.parent.mkdir(parents=True, exist_ok=True)
        part = output.with_suffix(".part.wav")
        part.unlink(missing_ok=True)

        override = EN_FRAGMENT_PHONEMES.get(job["text"].casefold()) if job["lang"] == "en" else None
        phonemes = override or phonemizers[job["lang"]](job["text"])[0]
        if "❓" in phonemes:
            raise ValueError(f"No pronunciation found for {job['text']!r}: {phonemes!r}")
        samples, sample_rate = kokoro.create(
            phonemes,
            voice=job["voice"],
            speed=float(job["speed"]),
            is_phonemes=True,
            trim=True,
        )
        samples = np.asarray(samples, dtype=np.float32)
        if samples.size == 0 or not np.isfinite(samples).all():
            raise RuntimeError(f"TTS returned invalid audio for {job['text']!r}")

        # Linear scaling adds no pitch/time DSP artifacts and leaves headroom.
        peak = float(np.max(np.abs(samples)))
        if peak > 0.01:
            samples *= 0.88 / peak
        samples = np.clip(samples, -0.95, 0.95)
        sf.write(part, samples, sample_rate, subtype="PCM_16")
        if part.stat().st_size <= 44:
            raise RuntimeError(f"TTS wrote an empty clip for {job['text']!r}")
        part.replace(output)
        print(
            f"generate [{index}/{len(jobs)}] {output.name} "
            f"({job['lang']}/{job['voice']}, {sample_rate} Hz) {job['text']!r}"
        )


if __name__ == "__main__":
    main()
