(() => {
  const DATA_URL = "./data/dictations.json";

  const state = {
    data: null,
    view: "home", // home | play | review
    currentId: null,
    items: [],
    index: -1,
    running: false,
    waitingNext: false,
    autoTimer: null,
    reviewWrongOnly: false,
  };

  const $ = (id) => document.getElementById(id);

  function mode() {
    const el = document.querySelector('input[name="mode"]:checked');
    return el ? el.value : "manual";
  }

  function writeSecondsFor(text) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    const letters = clean.replace(/[^A-Za-z]/g, "").length;
    const words = clean.split(/\s+/).filter(Boolean).length;
    const sec = 6 + letters * 0.55 + words * 0.8;
    return Math.min(28, Math.max(8, Math.round(sec)));
  }

  function stopSpeech() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  function clearAuto() {
    if (state.autoTimer) {
      clearTimeout(state.autoTimer);
      state.autoTimer = null;
    }
  }

  function waitMs(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function pickVoice(langPrefix) {
    const voices = window.speechSynthesis.getVoices();
    const prefer = [
      "Samantha",
      "Karen",
      "Daniel",
      "Google US English",
      "Microsoft Aria",
      "Tingting",
      "Ting-Ting",
      "Google 普通话",
      "Mei-Jia",
    ];
    const langMatches = voices.filter(
      (v) => v.lang && v.lang.toLowerCase().startsWith(langPrefix)
    );
    for (const name of prefer) {
      const hit = langMatches.find((v) => v.name.includes(name));
      if (hit) return hit;
    }
    return langMatches[0] || null;
  }

  function speak(text, lang) {
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window)) {
        resolve();
        return;
      }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = lang.startsWith("zh") ? 0.95 : 0.88;
      const voice = pickVoice(lang.slice(0, 2).toLowerCase());
      if (voice) u.voice = voice;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    });
  }

  function getDictation(id) {
    return state.data.dictations.find((d) => d.id === id);
  }

  function loadWrongSet() {
    try {
      return JSON.parse(localStorage.getItem("dictation-wrong") || "{}");
    } catch {
      return {};
    }
  }

  function saveWrongSet(map) {
    localStorage.setItem("dictation-wrong", JSON.stringify(map));
  }

  function markWrong(dictationId, itemIndex) {
    const map = loadWrongSet();
    const key = `${dictationId}#${itemIndex}`;
    map[key] = {
      dictationId,
      itemIndex,
      at: Date.now(),
    };
    saveWrongSet(map);
  }

  function clearWrong(dictationId, itemIndex) {
    const map = loadWrongSet();
    delete map[`${dictationId}#${itemIndex}`];
    saveWrongSet(map);
  }

  function buildReviewItems({ wrongOnly }) {
    const wrong = loadWrongSet();
    const items = [];
    for (const d of state.data.dictations) {
      d.items.forEach((item, idx) => {
        const key = `${d.id}#${idx}`;
        if (wrongOnly && !wrong[key]) return;
        items.push({
          ...item,
          _dictationId: d.id,
          _itemIndex: idx,
          _sourceTitle: d.title,
        });
      });
    }
    return items;
  }

  function setView(view) {
    state.view = view;
    $("view-home").hidden = view !== "home";
    $("view-play").hidden = view !== "play";
    $("view-review").hidden = view !== "review";
    document.querySelectorAll(".nav-tabs button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === view);
    });
  }

  function renderHome() {
    const list = $("card-list");
    list.innerHTML = "";
    const dicts = state.data.dictations.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    if (!dicts.length) {
      list.innerHTML = `<div class="empty">还没有听写。把新题加到 <code>data/dictations.json</code> 即可。</div>`;
      return;
    }
    for (const d of dicts) {
      const a = document.createElement("a");
      a.className = "card";
      a.href = `#/play/${encodeURIComponent(d.id)}`;
      a.innerHTML = `
        <h2>${escapeHtml(d.title)}</h2>
        <div class="meta">${escapeHtml(d.grade || "")} · ${escapeHtml(d.date || "")} · ${d.items.length} 题
          ${d.note ? `<br>${escapeHtml(d.note)}` : ""}
        </div>
        <div class="tags">${(d.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
      `;
      list.appendChild(a);
    }
  }

  function renderReviewHome() {
    const wrongCount = Object.keys(loadWrongSet()).length;
    const total = state.data.dictations.reduce((n, d) => n + d.items.length, 0);
    $("review-stats").textContent = `共 ${state.data.dictations.length} 套听写，${total} 题；错题本 ${wrongCount} 题`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showItem(reveal = false) {
    const i = state.index;
    const item = state.items[i];
    if (!item) return;
    const label = item.answer || item.text;
    const section = item.section || "听写";
    $("badge").textContent = `${section} · ${i + 1}/${state.items.length}`;
    $("count").textContent = `${i + 1} / ${state.items.length}`;
    $("bar").style.width = `${((i + 1) / state.items.length) * 100}%`;
    $("display").textContent = label;
    const show = reveal || $("showText").checked;
    $("display").classList.toggle("blur", !show);
  }

  function fillAnswers() {
    const ol = $("answerList");
    ol.innerHTML = "";
    state.items.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item.answer || item.text;
      ol.appendChild(li);
    });
  }

  async function playCurrent() {
    if (state.index < 0 || state.index >= state.items.length) return;
    const item = state.items[state.index];
    state.waitingNext = false;
    $("btnNext").disabled = true;
    $("btnReplay").disabled = true;
    $("btnStop").disabled = false;
    $("btnStart").disabled = true;
    $("btnWrong").disabled = true;
    $("btnOk").disabled = true;

    showItem(false);
    $("prompt").textContent = "正在朗读…请听";

    // 换 section 时轻提示
    const prev = state.items[state.index - 1];
    if (state.index === 0 || (prev && prev.section !== item.section)) {
      await speak(`${item.section || "听写"}开始。`, "zh-CN");
    }

    await speak(item.promptZh || `第${state.index + 1}题`, "zh-CN");
    await waitMs(300);
    await speak(item.text, "en-US");
    await waitMs(650);
    await speak(item.text, "en-US");

    if (!state.running) return;

    $("btnWrong").disabled = false;
    $("btnOk").disabled = false;

    if (mode() === "manual") {
      state.waitingNext = true;
      $("prompt").textContent = "写完了点「下一个」；可选标记对/错进错题本";
      $("btnNext").disabled = false;
      $("btnReplay").disabled = false;
      $("hint").textContent = "手机上大按钮点控。空格/回车也可下一个。";
    } else {
      const sec = writeSecondsFor(item.answer || item.text);
      $("prompt").textContent = `请书写…大约 ${sec} 秒（可提前点下一个）`;
      $("btnNext").disabled = false;
      $("btnReplay").disabled = false;
      $("hint").textContent = `自动等待约 ${sec} 秒（按长度估算）。`;
      clearAuto();
      state.autoTimer = setTimeout(() => {
        if (state.running) goNext();
      }, sec * 1000);
    }
  }

  async function startPlay() {
    if (!("speechSynthesis" in window)) {
      $("prompt").textContent = "当前浏览器不支持朗读，请用 Safari / Chrome。";
      return;
    }
    stopSpeech();
    clearAuto();
    state.running = true;
    state.index = 0;
    $("btnStart").textContent = "重新开始";
    await playCurrent();
  }

  async function goNext() {
    if (!state.running) return;
    clearAuto();
    stopSpeech();
    if (state.index >= state.items.length - 1) {
      state.running = false;
      state.waitingNext = false;
      $("prompt").textContent = "听写结束！可打开下方答案核对。";
      $("display").textContent = "All done!";
      $("display").classList.remove("blur");
      $("badge").textContent = "完成";
      $("btnNext").disabled = true;
      $("btnReplay").disabled = true;
      $("btnStop").disabled = true;
      $("btnStart").disabled = false;
      $("btnWrong").disabled = true;
      $("btnOk").disabled = true;
      $("hint").textContent = "全部完成。错题可在「复习」里再练。";
      await speak("听写结束。做得很好！", "zh-CN");
      return;
    }
    state.index += 1;
    await speak("下一个。", "zh-CN");
    await waitMs(200);
    await playCurrent();
  }

  async function replay() {
    if (state.index < 0 || !state.running) return;
    clearAuto();
    stopSpeech();
    await playCurrent();
  }

  function stopAll() {
    state.running = false;
    state.waitingNext = false;
    clearAuto();
    stopSpeech();
    $("prompt").textContent = "已停止。想继续再点「开始」。";
    $("btnNext").disabled = true;
    $("btnReplay").disabled = true;
    $("btnStop").disabled = true;
    $("btnStart").disabled = false;
    $("btnWrong").disabled = true;
    $("btnOk").disabled = true;
  }

  function openPlay(id, items, title) {
    state.currentId = id;
    state.items = items;
    state.index = -1;
    state.running = false;
    clearAuto();
    stopSpeech();
    setView("play");
    $("play-title").textContent = title;
    $("badge").textContent = "准备就绪";
    $("prompt").textContent = "点「开始听写」——你控制什么时候开始";
    $("display").textContent = "Ready?";
    $("display").classList.remove("blur");
    $("count").textContent = `0 / ${items.length}`;
    $("bar").style.width = "0%";
    $("btnStart").textContent = "开始听写";
    $("btnStart").disabled = false;
    $("btnNext").disabled = true;
    $("btnReplay").disabled = true;
    $("btnStop").disabled = true;
    $("btnWrong").disabled = true;
    $("btnOk").disabled = true;
    $("hint").textContent = "建议 Safari / Chrome 打开，调大音量后开始。";
    fillAnswers();
    $("answersBox").open = false;
  }

  function route() {
    const hash = location.hash || "#/";
    const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    if (!parts.length || parts[0] === "home") {
      setView("home");
      renderHome();
      return;
    }
    if (parts[0] === "review") {
      setView("review");
      renderReviewHome();
      return;
    }
    if (parts[0] === "play" && parts[1]) {
      const id = decodeURIComponent(parts[1]);
      const d = getDictation(id);
      if (!d) {
        location.hash = "#/";
        return;
      }
      openPlay(
        d.id,
        d.items.map((it, idx) => ({ ...it, _dictationId: d.id, _itemIndex: idx })),
        d.title
      );
      return;
    }
    if (parts[0] === "review-play") {
      const wrongOnly = parts[1] === "wrong";
      const items = buildReviewItems({ wrongOnly });
      if (!items.length) {
        setView("review");
        renderReviewHome();
        $("review-empty").hidden = false;
        $("review-empty").textContent = wrongOnly
          ? "错题本还是空的。听写时点「不会/错了」才会收录。"
          : "还没有可复习的题目。";
        return;
      }
      $("review-empty").hidden = true;
      openPlay(
        wrongOnly ? "review-wrong" : "review-all",
        items,
        wrongOnly ? "错题复习" : "全部复习"
      );
      return;
    }
    location.hash = "#/";
  }

  function bind() {
    document.querySelectorAll(".nav-tabs button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = btn.dataset.view;
        if (v === "home") location.hash = "#/";
        if (v === "review") location.hash = "#/review";
      });
    });

    $("btnStart").addEventListener("click", startPlay);
    $("btnNext").addEventListener("click", goNext);
    $("btnReplay").addEventListener("click", replay);
    $("btnStop").addEventListener("click", stopAll);

    $("btnWrong").addEventListener("click", () => {
      const item = state.items[state.index];
      if (!item || item._dictationId == null) return;
      markWrong(item._dictationId, item._itemIndex);
      $("hint").textContent = "已加入错题本（可在「复习」里再练）";
    });
    $("btnOk").addEventListener("click", () => {
      const item = state.items[state.index];
      if (!item || item._dictationId == null) return;
      clearWrong(item._dictationId, item._itemIndex);
      $("hint").textContent = "已从错题本移除（如果之前有的话）";
    });

    $("showText").addEventListener("change", () => {
      if (state.index >= 0) showItem();
    });
    document.querySelectorAll('input[name="mode"]').forEach((r) => {
      r.addEventListener("change", () => {
        $("modeHint").textContent = mode() === "manual" ? "手动点控" : "按长度自动等";
      });
    });

    $("btnReviewAll").addEventListener("click", () => {
      location.hash = "#/review-play/all";
    });
    $("btnReviewWrong").addEventListener("click", () => {
      location.hash = "#/review-play/wrong";
    });
    $("btnClearWrong").addEventListener("click", () => {
      if (confirm("清空错题本？")) {
        saveWrongSet({});
        renderReviewHome();
      }
    });

    document.addEventListener("keydown", (e) => {
      if ((e.code === "Space" || e.code === "Enter") && state.waitingNext && !$("btnNext").disabled) {
        e.preventDefault();
        goNext();
      }
    });

    window.addEventListener("hashchange", route);
    if ("speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
  }

  async function init() {
    bind();
    const res = await fetch(DATA_URL);
    state.data = await res.json();
    $("site-title").textContent = state.data.siteTitle || "英语听写站";
    $("site-sub").textContent = state.data.siteSubtitle || "";
    route();
  }

  init().catch((err) => {
    console.error(err);
    $("card-list").innerHTML = `<div class="empty">加载失败：请用网站方式打开（不要直接双击本地文件时若被拦，请用 GitHub Pages 链接）。</div>`;
  });
})();
