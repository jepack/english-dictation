#!/usr/bin/env python3
"""Generate lesson audio for the dictation / reading-coach site.

English uses Microsoft Edge neural TTS (en-US-JennyNeural) for clear US
pronunciation suitable for kids learning English. Chinese teaching prompts
still use the local IndexTTS2 service so Feishu Chinese cues stay consistent.

For English, one natural whole-phrase recording is generated and a continuous
slow version is derived from it. Letter and syllable fragments are visual hints
only; they are never submitted to TTS as standalone words.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "dictations.json"
LESSONS = ROOT / "data" / "lessons.json"
AUDIO_DIR = ROOT / "audio"
MANIFEST = AUDIO_DIR / "manifest.json"
SERVICE_URL = "http://127.0.0.1:8776/v1/tts"
ENGINE_VERSION = "edge-jenny-en-indextts2-zh-v1"
SLOW_RATE = 0.62
EN_VOICE = "en-US-JennyNeural"
EN_RATE = "-5%"


def find_ffmpeg() -> str:
    candidates = (
        os.environ.get("FFMPEG"),
        shutil.which("ffmpeg"),
        str(Path.home() / ".local" / "bin" / "ffmpeg"),
        "/usr/local/bin/ffmpeg",
        "/opt/homebrew/bin/ffmpeg",
    )
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    raise SystemExit("ffmpeg was not found; set FFMPEG to its absolute path")


FFMPEG = find_ffmpeg()

FIXED = [
    ("zh", "下一个。"),
    ("zh", "听写结束。做得很好！"),
    ("zh", "慢读。"),
    ("zh", "拆开读。"),
    ("zh", "再拆一次。"),
    ("zh", "正常读。"),
    ("zh", "跟我读。"),
]


def key(lang: str, text: str, variant: str = "normal") -> str:
    suffix = "-slow" if variant == "slow" else ""
    return f"{lang}{suffix}|{text}"


def file_stem(lang: str, text: str, variant: str = "normal") -> str:
    profile = f"{ENGINE_VERSION}|{variant}|{key(lang, text)}"
    digest = hashlib.sha256(profile.encode("utf-8")).hexdigest()[:16]
    suffix = "_slow" if variant == "slow" else ""
    return f"{lang}{suffix}_{digest}"


def collect_phrases() -> list[tuple[str, str]]:
    """Collect whole phrases only, with newest English lessons first."""
    seen: set[str] = set()
    english: list[tuple[str, str]] = []
    chinese: list[tuple[str, str]] = []

    def add(lang: str, text: str) -> None:
        text = (text or "").strip()
        phrase_key = key(lang, text)
        if not text or phrase_key in seen:
            return
        seen.add(phrase_key)
        (english if lang == "en" else chinese).append((lang, text))

    if LESSONS.exists():
        lessons = json.loads(LESSONS.read_text(encoding="utf-8"))
        for lesson in reversed(lessons.get("lessons", [])):
            for item in lesson.get("items", []):
                add("en", item.get("text") or "")

    if DATA.exists():
        data = json.loads(DATA.read_text(encoding="utf-8"))
        for dictation in reversed(data.get("dictations", [])):
            sections: set[str] = set()
            for item in dictation.get("items", []):
                section = (item.get("section") or "听写").strip()
                sections.add(section)
                add("en", item.get("text") or "")
                add("zh", item.get("promptZh") or "")
            for section in sorted(sections):
                add("zh", f"{section}开始。")

    for lang, text in FIXED:
        add(lang, text)
    return english + chinese


def collect_lesson_phrases(lesson_id: str) -> list[tuple[str, str]]:
    if not LESSONS.exists():
        raise SystemExit(f"lessons file not found: {LESSONS}")
    lessons = json.loads(LESSONS.read_text(encoding="utf-8")).get("lessons", [])
    lesson = next((item for item in lessons if item.get("id") == lesson_id), None)
    if lesson is None:
        raise SystemExit(f"lesson not found: {lesson_id}")
    phrases: list[tuple[str, str]] = []
    seen: set[str] = set()
    for item in lesson.get("items", []):
        text = (item.get("text") or "").strip()
        if text and key("en", text) not in seen:
            seen.add(key("en", text))
            phrases.append(("en", text))
    # The lesson UI also speaks these navigation/teaching prompts. Include
    # them so a complete lesson never mixes engines for Chinese cues.
    for lang, text in FIXED:
        if key(lang, text) not in seen:
            seen.add(key(lang, text))
            phrases.append((lang, text))
    return phrases


def atomic_manifest(manifest: dict[str, str]) -> None:
    part = MANIFEST.with_suffix(".part.json")
    part.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    part.replace(MANIFEST)


def request_indextts_wav(text: str) -> Path:
    body = json.dumps({"text": text, "mode": "normal"}, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        SERVICE_URL, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=1800) as response:
            result = json.load(response)
    except (urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError(f"IndexTTS2 service request failed for {text!r}: {exc}") from exc
    if not result.get("ok"):
        raise RuntimeError(f"IndexTTS2 failed for {text!r}: {result}")
    wav = Path(result["path"])
    if not wav.exists() or wav.stat().st_size <= 44:
        raise RuntimeError(f"IndexTTS2 returned a missing/empty WAV: {wav}")
    return wav


async def _edge_tts_to_mp3(text: str, destination: Path) -> None:
    import edge_tts

    communicate = edge_tts.Communicate(text, EN_VOICE, rate=EN_RATE)
    await communicate.save(str(destination))


def request_english_wav(text: str, scratch: Path) -> Path:
    """Synthesize clear US English via Edge neural TTS, then decode to WAV."""
    mp3 = scratch / "edge.mp3"
    wav = scratch / "edge.wav"
    asyncio.run(_edge_tts_to_mp3(text, mp3))
    if not mp3.exists() or mp3.stat().st_size < 200:
        raise RuntimeError(f"edge-tts produced empty audio for {text!r}")
    subprocess.run(
        [
            FFMPEG,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(mp3),
            "-ac",
            "1",
            "-ar",
            "44100",
            "-c:a",
            "pcm_s16le",
            str(wav),
        ],
        check=True,
    )
    if not wav.exists() or wav.stat().st_size <= 44:
        raise RuntimeError(f"edge-tts WAV decode failed for {text!r}")
    return wav


def request_wav(lang: str, text: str, scratch: Path) -> Path:
    if lang == "en":
        return request_english_wav(text, scratch)
    return request_indextts_wav(text)


def encode_mp3(source: Path, destination: Path, slow: bool = False) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    part = destination.with_suffix(".part.mp3")
    cmd = [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-i", str(source)]
    if slow:
        cmd += [
            "-af",
            f"aresample=44100:resampler=soxr:precision=28,atempo={SLOW_RATE},lowpass=f=9800,alimiter=limit=0.9",
        ]
    cmd += ["-codec:a", "libmp3lame", "-q:a", "3", str(part)]
    subprocess.run(cmd, check=True)
    if not part.exists() or part.stat().st_size < 500:
        raise RuntimeError(f"encoded MP3 is too small: {part}")
    part.replace(destination)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lesson-id", help="generate one complete lesson plus UI prompts")
    parser.add_argument("--only", help="regular expression matched against phrase text")
    parser.add_argument("--limit", type=int, help="generate at most this many selected phrases")
    args = parser.parse_args()

    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    try:
        import edge_tts  # noqa: F401
    except ImportError as exc:
        raise SystemExit("edge-tts is required for English audio; pip install edge-tts") from exc

    phrases = collect_lesson_phrases(args.lesson_id) if args.lesson_id else collect_phrases()
    needs_zh = any(lang == "zh" for lang, _ in phrases)
    if needs_zh:
        try:
            with urllib.request.urlopen("http://127.0.0.1:8776/health", timeout=5) as response:
                health = json.load(response)
        except Exception as exc:
            raise SystemExit(f"IndexTTS2 service is not ready (needed for Chinese): {exc}") from exc
        if not health.get("ready"):
            raise SystemExit(f"IndexTTS2 service is not ready: {health}")

    if args.only:
        pattern = re.compile(args.only, re.IGNORECASE)
        phrases = [(lang, text) for lang, text in phrases if pattern.search(text)]
    if args.limit is not None:
        phrases = phrases[: max(0, args.limit)]

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}
    made = 0
    for index, (lang, text) in enumerate(phrases, 1):
        normal_rel = f"audio/{file_stem(lang, text)}.mp3"
        normal_path = ROOT / normal_rel
        slow_rel = f"audio/{file_stem(lang, text, 'slow')}.mp3"
        slow_path = ROOT / slow_rel
        need_normal = not normal_path.exists() or normal_path.stat().st_size < 500
        need_slow = lang == "en" and (not slow_path.exists() or slow_path.stat().st_size < 500)

        print(f"[{index}/{len(phrases)}] {lang} {text!r}", flush=True)
        if need_normal or need_slow:
            with tempfile.TemporaryDirectory(prefix="dictation-tts-") as tmp:
                wav = request_wav(lang, text, Path(tmp))
                if need_normal:
                    encode_mp3(wav, normal_path)
                if need_slow:
                    encode_mp3(wav, slow_path, slow=True)
            made += 1

        # Publish every completed phrase, allowing safe resumable migration.
        manifest[key(lang, text)] = normal_rel
        if lang == "en":
            manifest[key(lang, text, "slow")] = slow_rel
        atomic_manifest(manifest)

    print(f"done: {len(phrases)} selected, {made} newly generated; engine={ENGINE_VERSION}")


if __name__ == "__main__":
    main()
