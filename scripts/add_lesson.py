#!/usr/bin/env python3
"""追加一套点读课到 lessons.json，并可选生成音频。

示例：
  python3 scripts/add_lesson.py \\
    --id g3-unit1-2026-10-14 \\
    --title "三年级 · Unit 1 点读" \\
    --from-lines lesson-items.txt \\
    --generate-audio

from-lines 格式：
  # 单词
  space|space|单音节|a_e 发 /eɪ/
  beautiful|beau/ti/ful|重音第一拍|beau=/bjuː/

  # 句子
  This is a big cake.|This/is/a/big/cake|实词略重|cake 同 a_e
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "lessons.json"


def guess_kind(text: str) -> str:
    t = text.strip()
    if " " in t or t.endswith((".", "?", "!")):
        return "sentence"
    return "word"


def default_syllables(text: str, kind: str) -> list[str]:
    if kind == "sentence":
        return [w for w in re.findall(r"[A-Za-z']+", text)]
    return [text.strip()]


def parse_lines(raw: str) -> list[dict]:
    items: list[dict] = []
    section_kind = "word"
    n = 0
    for line in raw.splitlines():
        s = line.strip()
        if not s or s.startswith("//"):
            continue
        if s.startswith("#"):
            title = s.lstrip("#").strip().lower()
            section_kind = "sentence" if "句" in title or "sentence" in title else "word"
            continue
        parts = [p.strip() for p in s.split("|")]
        text = parts[0]
        if not text:
            continue
        n += 1
        # 段落标题只作默认；有空格/句末标点则按句子
        kind = guess_kind(text)
        if kind == "word" and section_kind == "sentence":
            kind = "sentence"

        syllables: list[str]
        if len(parts) > 1 and parts[1]:
            syllables = [x for x in re.split(r"[/·\s]+", parts[1]) if x]
        else:
            syllables = default_syllables(text, kind)

        stress = parts[2] if len(parts) > 2 else ""
        tips = parts[3] if len(parts) > 3 else ""
        grammar = parts[4] if len(parts) > 4 else ""

        items.append(
            {
                "id": f"i{n}",
                "kind": kind,
                "text": text,
                "syllables": syllables,
                "stressNote": stress,
                "tipsZh": tips,
                "grammarZh": grammar,
                "corrections": [],
            }
        )
    return items


def load_items_json(raw: str) -> list[dict]:
    data = json.loads(raw)
    if not isinstance(data, list):
        raise SystemExit("--items-json 必须是数组")
    out: list[dict] = []
    for i, it in enumerate(data, 1):
        if isinstance(it, str):
            text = it.strip()
            kind = guess_kind(text)
            item = {
                "id": f"i{i}",
                "kind": kind,
                "text": text,
                "syllables": default_syllables(text, kind),
                "stressNote": "",
                "tipsZh": "",
                "grammarZh": "",
                "corrections": [],
            }
        else:
            text = (it.get("text") or "").strip()
            if not text:
                raise SystemExit(f"第 {i} 条缺少 text")
            kind = (it.get("kind") or guess_kind(text)).strip()
            syllables = it.get("syllables") or default_syllables(text, kind)
            item = {
                "id": it.get("id") or f"i{i}",
                "kind": kind,
                "text": text,
                "syllables": list(syllables),
                "stressNote": it.get("stressNote") or "",
                "tipsZh": it.get("tipsZh") or "",
                "grammarZh": it.get("grammarZh") or "",
                "corrections": it.get("corrections") or [],
            }
        out.append(item)
    return out


def slug_ok(s: str) -> bool:
    return bool(re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", s))


def main() -> None:
    today = date.today().isoformat()
    p = argparse.ArgumentParser(description="追加一套点读课并可选生成 mp3")
    p.add_argument("--id", required=True)
    p.add_argument("--title", required=True)
    p.add_argument("--grade", default="三年级")
    p.add_argument("--date", default=today)
    p.add_argument("--tags", default="点读")
    p.add_argument("--note", default="教读：慢读 → 拆分两次 → 快读")
    p.add_argument("--source-note", default="")
    p.add_argument("--from-lines", type=Path)
    p.add_argument("--items-json")
    p.add_argument("--items-file", type=Path)
    p.add_argument("--generate-audio", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    if not slug_ok(args.id):
        raise SystemExit("--id 建议用小写字母数字与连字符，如 g3-unit1-2026-10-14")

    if args.from_lines:
        items = parse_lines(args.from_lines.read_text(encoding="utf-8"))
    elif args.items_file:
        items = load_items_json(args.items_file.read_text(encoding="utf-8"))
    elif args.items_json:
        items = load_items_json(args.items_json)
    else:
        raise SystemExit("请提供 --from-lines / --items-json / --items-file")

    if not items:
        raise SystemExit("没有条目")

    lesson = {
        "id": args.id,
        "title": args.title,
        "grade": args.grade,
        "date": args.date,
        "tags": [t.strip() for t in args.tags.split(",") if t.strip()],
        "note": args.note,
        "sourceNote": args.source_note,
        "items": items,
    }

    if args.dry_run:
        print(json.dumps(lesson, ensure_ascii=False, indent=2))
        return

    data = json.loads(DATA.read_text(encoding="utf-8")) if DATA.exists() else {
        "version": 1,
        "siteTitle": "英语点读",
        "siteSubtitle": "飞书建课 · 慢读拆分快读 · 视频纠音",
        "lessons": [],
    }
    lessons = data.setdefault("lessons", [])
    if any(x.get("id") == args.id for x in lessons):
        raise SystemExit(f"id 已存在: {args.id}")
    lessons.insert(0, lesson)
    DATA.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {DATA.relative_to(ROOT)}  (+{len(items)} items, id={args.id})")

    if args.generate_audio:
        r = subprocess.run([sys.executable, str(ROOT / "scripts" / "generate_audio.py")])
        raise SystemExit(r.returncode)


if __name__ == "__main__":
    main()
