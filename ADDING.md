# 加新听写（给哆啦A梦 / 自己）

1. 打开 `data/dictations.json`
2. 在 `dictations` 数组**最前面或最后**追加一套对象
3. `id` 必须唯一，建议：`g3-主题-日期`
4. `items[].text` = 朗读内容；`answer` = 答案展示（可与 text 不同，如 `cook → cooking`）
5. 提交并 push 到 GitHub，Pages 自动更新

听写时点「不会/错了」会进浏览器本地错题本，换机不同步。
