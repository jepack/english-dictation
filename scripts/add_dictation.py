#!/usr/bin/env python3
"""快速追加一套听写到 dictations.json，并可选生成音频。

示例：
  # 每行一句英文；可用「|」写 答案；用「# 段落名」换 section
  python3 scripts/add_dictation.py \\
    --id g3-pets-2026-10-09 \\
    --title "三年级 · 宠物" \\
    --from-lines items.txt \\
    --generate-audio

  # 或 JSON 数组 items
  python3 scripts/add_dictation.py \\
    --id g3-pets-2026-10-09 \\
    --title "三年级 · 宠物" \\
    --items-json '[{"text":"I have a cat.","answer":"I have a cat."}]' \\
    --generate-audio
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
DATA = ROOT / "data" / "dictations.json"
CN_NUM = "零一二三四五六七八九十"


def prompt_zh(n: int) -> str:
    if 1 <= n <= 10:
        return f"第{CN_NUM[n]}题"
    return f"第{n}题"


def parse_lines(text: str, default_section: str) -> list[dict]:
    items: list[dict] = []
    section = default_section
    idx_in_section = 0
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("//"):
            continue
        if line.startswith("#"):
            section = line.lstrip("#").strip() or default_section
            idx_in_section = 0
            continue
        if "|" in line:
            speak, answer = [p.strip() for p in line.split("|", 1)]
        else:
            speak = answer = line
        if not speak:
            continue
        speaker = ""
        # 对话行：Mia: Hello!  → speaker + text
        m = re.match(r"^([A-Za-z][A-Za-z0-9_-]{0,20})\s*:\s*(.+)$", speak)
        if m:
            speaker = m.group(1)
            speak = m.group(2).strip()
        idx_in_section += 1
        row = {
            "section": section,
            "promptZh": prompt_zh(idx_in_section),
            "text": speak,
            "answer": answer or speak,
        }
        if speaker:
            row["speaker"] = speaker
        # 答案像中文时，顺带写入 meaningZh（磨耳朵对照）
        if answer and answer != speak and re.search(r"[\u4e00-\u9fff]", answer):
            row["meaningZh"] = answer
        items.append(row)
    return items


def load_items_json(raw: str) -> list[dict]:
    data = json.loads(raw)
    if not isinstance(data, list):
        raise SystemExit("--items-json 必须是数组")
    out: list[dict] = []
    counts: dict[str, int] = {}
    for i, it in enumerate(data, 1):
        if isinstance(it, str):
            speak = answer = it.strip()
            section = "听写"
            prompt = prompt_zh(i)
        else:
            speak = (it.get("text") or "").strip()
            answer = (it.get("answer") or speak).strip()
            section = (it.get("section") or "听写").strip()
            counts[section] = counts.get(section, 0) + 1
            prompt = (it.get("promptZh") or prompt_zh(counts[section])).strip()
        if not speak:
            raise SystemExit(f"第 {i} 题缺少 text")
        out.append(
            {
                "section": section,
                "promptZh": prompt,
                "text": speak,
                "answer": answer,
            }
        )
    return out


def slug_ok(s: str) -> bool:
    return bool(re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", s))


def main() -> None:
    today = date.today().isoformat()
    p = argparse.ArgumentParser(description="追加一套听写并可选生成 mp3")
    p.add_argument("--id", required=True, help="唯一 id，如 g3-pets-2026-10-09")
    p.add_argument("--title", required=True, help='标题，如 "三年级 · 宠物"')
    p.add_argument("--grade", default="三年级")
    p.add_argument("--date", default=today)
    p.add_argument("--tags", default="", help="逗号分隔，如 句子,动词ing")
    p.add_argument("--note", default="写完点下一个")
    p.add_argument(
        "--hub",
        default="",
        help='分类：ear / exam / dictation（默认不写字段）',
    )
    p.add_argument("--section", default="句子", help="--from-lines 默认段落名")
    p.add_argument("--from-lines", type=Path, help="文本文件：每行一句，# 换段，| 分隔答案")
    p.add_argument("--items-json", help="items JSON 数组字符串")
    p.add_argument("--items-file", type=Path, help="items JSON 文件")
    p.add_argument("--generate-audio", action="store_true", help="跑 generate_audio.py")
    p.add_argument("--dry-run", action="store_true", help="只打印将写入的对象，不写文件")
    args = p.parse_args()

    if not slug_ok(args.id):
        raise SystemExit("--id 建议只用小写字母数字和连字符，如 g3-pets-2026-10-09")

    sources = sum(
        bool(x) for x in (args.from_lines, args.items_json, args.items_file)
    )
    if sources != 1:
        raise SystemExit("请且仅指定一种：--from-lines / --items-json / --items-file")

    if args.from_lines:
        items = parse_lines(args.from_lines.read_text(encoding="utf-8"), args.section)
    elif args.items_file:
        items = load_items_json(args.items_file.read_text(encoding="utf-8"))
    else:
        items = load_items_json(args.items_json)

    if not items:
        raise SystemExit("没有解析到任何题目")

    tags = [t.strip() for t in args.tags.split(",") if t.strip()]
    entry = {
        "id": args.id,
        "title": args.title,
        "grade": args.grade,
        "date": args.date,
        "tags": tags,
        "note": args.note,
        "items": items,
    }
    if args.hub.strip():
        hub = args.hub.strip()
        if hub not in {"ear", "exam", "dictation"}:
            raise SystemExit("--hub 只能是 ear / exam / dictation")
        entry["hub"] = hub
        if hub == "ear":
            for it in items:
                if not it.get("meaningZh") and it.get("answer") and re.search(
                    r"[\u4e00-\u9fff]", it["answer"]
                ):
                    it["meaningZh"] = it["answer"]
                # 磨耳朵不播「第N题」
                if it.get("speaker"):
                    it["promptZh"] = it["speaker"]
                elif it.get("section"):
                    it["promptZh"] = it["section"]

    if args.dry_run:
        print(json.dumps(entry, ensure_ascii=False, indent=2))
        return

    data = json.loads(DATA.read_text(encoding="utf-8"))
    ids = {d.get("id") for d in data.get("dictations", [])}
    if args.id in ids:
        raise SystemExit(f"id 已存在：{args.id}")

    data.setdefault("dictations", []).insert(0, entry)
    DATA.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"added {args.id}: {len(items)} items → {DATA.relative_to(ROOT)}")

    if args.generate_audio:
        script = ROOT / "scripts" / "generate_audio.py"
        subprocess.run([sys.executable, str(script)], cwd=ROOT, check=True)


if __name__ == "__main__":
    main()
