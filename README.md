# 英语听写站

手机可点控的英语听写网站（GitHub Pages）。  
以后每次听写加到 `data/dictations.json`，推送后手机刷新即可；「复习」可练全部或错题本。

## 手机怎么用

1. 打开站点链接（HTTPS）
2. 选一套听写 → 点「开始听写」
3. 默认：写完点「下一个」（节奏你控制）
4. 可选标记「不会/错了」进错题本，之后在「复习」里再练

用 **音频文件 / 在线 TTS** 播放，不依赖系统 `speechSynthesis`，飞书内置浏览器一般也能听。可「添加到主屏幕」。

## 怎么加新听写

推荐一键（文本题单 → JSON + mp3）：

```bash
# 题目格式见 examples/sample-items.txt
python3 scripts/add_dictation.py \
  --id g3-xxx-2026-10-09 \
  --title "三年级 · 新主题" \
  --tags 句子 \
  --from-lines items.txt \
  --generate-audio

git add data/dictations.json audio
git commit -m "Add dictation: g3-xxx"
GIT_HTTP_VERSION=1.1 git push origin main
```

也可手改 `data/dictations.json` 后只跑 `python3 scripts/generate_audio.py`。  
细节见 [ADDING.md](ADDING.md)。一两分钟后手机刷新即可。

## 本地预览

```bash
cd dictation-site
python3 -m http.server 8765
# 浏览器打开 http://127.0.0.1:8765
```

## 托管

本仓库启用 GitHub Pages：Settings → Pages → Deploy from branch `main` / root（或 `/docs`，以仓库设置为准）。
