# 加新听写（给哆啦A梦 / 自己）

## 推荐：一键脚本

```bash
cd dictation-site
# 编辑题目文本（见 examples/sample-items.txt）
python3 scripts/add_dictation.py \
  --id g3-主题-2026-10-09 \
  --title "三年级 · 主题" \
  --tags 句子 \
  --from-lines items.txt \
  --generate-audio
```

`items.txt`：每行一句英文；`# 段落名` 换段；`朗读|答案` 可分开。

## 或手改 JSON

1. 打开 `data/dictations.json`，在 `dictations` 数组最前追加
2. `id` 唯一，建议：`g3-主题-日期`
3. `items[].text` = 朗读；`answer` = 展示（可不同，如 `cook → cooking`）
4. 生成音频（Mac：`say` + `ffmpeg`）：

```bash
python3 scripts/generate_audio.py
```

站点优先播本地 mp3，没有再试在线 TTS。

## 上线

```bash
git add data/dictations.json audio
git commit -m "Add dictation: g3-主题"
GIT_HTTP_VERSION=1.1 git push origin main
```

Pages 约 1–2 分钟：https://jepack.github.io/english-dictation/

听写时点「不会/错了」进浏览器本地错题本，换机不同步。

Agent 流程见 excel 仓库：`.cursor/skills/english-dictation-site/SKILL.md`
