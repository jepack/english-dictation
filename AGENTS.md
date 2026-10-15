# Audio generation rules

These rules apply to every change made in this dictation/phonics site, including changes requested through Feishu.

- The default and production TTS engine is the persistent local IndexTTS2 service at `http://127.0.0.1:8776`.
- Always generate or refresh lesson audio with `python3 scripts/generate_audio.py`.
- Do not call `scripts/kokoro_tts_worker.py` and do not add an automatic Kokoro fallback. A synthesis error must be reported instead of silently publishing Kokoro audio.
- Submit complete words or complete sentences to TTS. Never submit a letter, phoneme spelling, or syllable fragment such as `s`, `p`, `ea`, or `k` as a standalone TTS request.
- Phonics chunks are visual teaching hints. Slow/split playback uses the continuous `en-slow|<whole phrase>` recording derived from the same natural whole-phrase IndexTTS2 recording.
- Normal playback uses `en|<whole phrase>`. Keep playback rate at 1 in the browser because Feishu WebView is unreliable with `playbackRate`.
- Before publishing, test the changed phrase with `python3 scripts/generate_audio.py --only '<anchored regex>'` and verify both normal and slow manifest keys for English.
