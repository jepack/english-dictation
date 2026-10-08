# 英语听写站

手机可点控的英语听写网站（GitHub Pages）。  
以后每次听写加到 `data/dictations.json`，推送后手机刷新即可；「复习」可练全部或错题本。

## 手机怎么用

1. 打开站点链接（HTTPS）
2. 选一套听写 → 点「开始听写」
3. 默认：写完点「下一个」（节奏你控制）
4. 可选标记「不会/错了」进错题本，之后在「复习」里再练

建议用 **Safari / Chrome**，可「添加到主屏幕」。

## 怎么加新听写

编辑 `data/dictations.json`，在 `dictations` 数组里追加一套，例如：

```json
{
  "id": "g3-xxx-2026-10-09",
  "title": "三年级 · 新主题",
  "grade": "三年级",
  "date": "2026-10-09",
  "tags": ["句子"],
  "note": "写完点下一个",
  "items": [
    {
      "section": "句子",
      "promptZh": "第一题",
      "text": "This is a cat.",
      "answer": "This is a cat."
    }
  ]
}
```

然后：

```bash
git add data/dictations.json
git commit -m "Add dictation: g3-xxx"
git push
```

一两分钟后手机刷新网站即可看到。

## 本地预览

```bash
cd dictation-site
python3 -m http.server 8765
# 浏览器打开 http://127.0.0.1:8765
```

## 托管

本仓库启用 GitHub Pages：Settings → Pages → Deploy from branch `main` / root（或 `/docs`，以仓库设置为准）。
