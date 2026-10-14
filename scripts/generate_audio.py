#!/usr/bin/env python3
"""Pre-generate bilingual audio with the local Kokoro neural TTS runtime.

The site always plays generated files through ``<audio>``. It never calls the
browser speech synthesizer or macOS ``say``. A versioned hash in every file
name prevents browsers from reusing clips made by an older voice profile.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "dictations.json"
LESSONS = ROOT / "data" / "lessons.json"
AUDIO_DIR = ROOT / "audio"
MANIFEST = AUDIO_DIR / "manifest.json"
WORKER = ROOT / "scripts" / "kokoro_tts_worker.py"

DEFAULT_RUNTIME = ROOT.parents[1] / "runtime" / "kokoro-tts"
RUNTIME = Path(os.environ.get("KOKORO_TTS_ROOT", DEFAULT_RUNTIME)).expanduser()
PYTHON = RUNTIME / ".venv312" / "bin" / "python"
MODEL_DIR = RUNTIME / "models"

ENGINE_VERSION = "kokoro-v1.1-zh-fp32-v1"
VOICE_CONFIG = {
    # Clear Mandarin female voice, slightly slowed for tones and syllables.
    "zh": {"voice": "zf_001", "speed": 0.95},
    # Clear American English female voice at an early primary-school pace.
    "en": {"voice": "af_maple", "speed": 0.70},
}

FIXED = [
    ("zh", "下一个。"),
    ("zh", "听写结束。做得很好！"),
    ("zh", "慢读。"),
    ("zh", "拆开读。"),
    ("zh", "再拆一次。"),
    ("zh", "快读。"),
    ("zh", "跟我读。"),
]


def key(lang: str, text: str) -> str:
    return f"{lang}|{text}"


def file_stem(lang: str, text: str) -> str:
    cfg = VOICE_CONFIG[lang]
    profile = "|".join(
        (ENGINE_VERSION, cfg["voice"], str(cfg["speed"]), key(lang, text))
    )
    digest = hashlib.sha256(profile.encode("utf-8")).hexdigest()[:16]
    return f"{lang}_{digest}"


def collect_phrases(data: dict) -> list[tuple[str, str]]:
    seen: set[str] = set()
    out: list[tuple[str, str]] = []

    def add(lang: str, text: str) -> None:
        text = (text or "").strip()
        if not text:
            return
        phrase_key = key(lang, text)
        if phrase_key in seen:
            return
        seen.add(phrase_key)
        out.append((lang, text))

    for lang, text in FIXED:
        add(lang, text)

    for dictation in data.get("dictations", []):
        sections: set[str] = set()
        for item in dictation.get("items", []):
            section = (item.get("section") or "听写").strip()
            sections.add(section)
            add("zh", item.get("promptZh") or "")
            add("en", item.get("text") or "")
        for section in sorted(sections):
            add("zh", f"{section}开始。")

    if LESSONS.exists():
        lessons = json.loads(LESSONS.read_text(encoding="utf-8"))
        for lesson in lessons.get("lessons", []):
            for item in lesson.get("items", []):
                add("en", item.get("text") or "")
                for part in item.get("syllables") or []:
                    add("en", str(part).strip())

    return out


def validate_runtime() -> None:
    required = (
        PYTHON,
        WORKER,
        MODEL_DIR / "kokoro-v1.1-zh.onnx",
        MODEL_DIR / "voices-v1.1-zh.bin",
    )
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        joined = "\n  - ".join(missing)
        raise SystemExit(f"Kokoro TTS runtime is incomplete:\n  - {joined}")


def main() -> None:
    validate_runtime()
    data = json.loads(DATA.read_text(encoding="utf-8")) if DATA.exists() else {"dictations": []}
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    phrases = collect_phrases(data)
    manifest: dict[str, str] = {}
    jobs: list[dict] = []

    for lang, text in phrases:
        cfg = VOICE_CONFIG[lang]
        rel = f"audio/{file_stem(lang, text)}.wav"
        output = ROOT / rel
        if output.exists() and output.stat().st_size > 44:
            print(f"keep     {rel}  ({lang}/{cfg['voice']}) {text!r}")
        else:
            jobs.append(
                {
                    "lang": lang,
                    "text": text,
                    "voice": cfg["voice"],
                    "speed": cfg["speed"],
                    "output": str(output),
                }
            )
        manifest[key(lang, text)] = rel

    if jobs:
        with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8") as job_file:
            json.dump(jobs, job_file, ensure_ascii=False)
            job_file.flush()
            subprocess.run(
                [
                    str(PYTHON),
                    "-u",
                    str(WORKER),
                    "--model-dir",
                    str(MODEL_DIR),
                    "--jobs",
                    job_file.name,
                ],
                check=True,
            )

    # Publish only after every requested clip has succeeded.
    manifest_part = MANIFEST.with_suffix(".part.json")
    manifest_part.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    manifest_part.replace(MANIFEST)
    print(f"done: {len(manifest)} clips, {len(jobs)} newly generated -> {MANIFEST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
