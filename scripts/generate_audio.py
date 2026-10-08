#!/usr/bin/env python3
"""从 dictations.json 预生成 mp3，供任意浏览器用 <audio> 播放（不依赖 speechSynthesis）。"""

from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "dictations.json"
AUDIO_DIR = ROOT / "audio"
MANIFEST = AUDIO_DIR / "manifest.json"

VOICES = {
    "en": "Samantha",
    "zh": "Tingting",
}

FIXED = [
    ("zh", "下一个。"),
    ("zh", "听写结束。做得很好！"),
]


def key(lang: str, text: str) -> str:
    return f"{lang}|{text}"


def file_stem(lang: str, text: str) -> str:
    h = hashlib.md5(key(lang, text).encode("utf-8")).hexdigest()[:12]
    return f"{lang}_{h}"


def collect_phrases(data: dict) -> list[tuple[str, str]]:
    seen: set[str] = set()
    out: list[tuple[str, str]] = []

    def add(lang: str, text: str) -> None:
        text = (text or "").strip()
        if not text:
            return
        k = key(lang, text)
        if k in seen:
            return
        seen.add(k)
        out.append((lang, text))

    for lang, text in FIXED:
        add(lang, text)

    for d in data.get("dictations", []):
        sections: set[str] = set()
        for item in d.get("items", []):
            sec = (item.get("section") or "听写").strip()
            sections.add(sec)
            add("zh", item.get("promptZh") or "")
            add("en", item.get("text") or "")
        for sec in sorted(sections):
            add("zh", f"{sec}开始。")

    return out


def synth(lang: str, text: str, mp3: Path) -> None:
    voice = VOICES[lang]
    with tempfile.TemporaryDirectory() as td:
        aiff = Path(td) / "out.aiff"
        subprocess.run(
            ["say", "-v", voice, "-o", str(aiff), text],
            check=True,
        )
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(aiff),
                "-codec:a",
                "libmp3lame",
                "-qscale:a",
                "4",
                str(mp3),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


def main() -> None:
    data = json.loads(DATA.read_text(encoding="utf-8"))
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    phrases = collect_phrases(data)
    manifest: dict[str, str] = {}
    made = 0
    for lang, text in phrases:
        stem = file_stem(lang, text)
        rel = f"audio/{stem}.mp3"
        mp3 = ROOT / rel
        if not mp3.exists():
            print(f"generate {rel}  ({lang}) {text!r}")
            synth(lang, text, mp3)
            made += 1
        else:
            print(f"keep     {rel}  ({lang}) {text!r}")
        manifest[key(lang, text)] = rel

    MANIFEST.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"done: {len(manifest)} clips, {made} newly generated → {MANIFEST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
