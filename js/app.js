(() => {
  const DATA_URL = "./data/dictations.json";
  const MANIFEST_URL = "./audio/manifest.json";

  const state = {
    data: null,
    audioManifest: {},
    view: "home", // home | hub | dictation | play | review
    currentHub: null,
    currentId: null,
    items: [],
    index: -1,
    running: false,
    waitingNext: false,
    autoTimer: null,
    reviewWrongOnly: false,
    currentAudio: null,
  };

  const HUB_META = {
    ear: { title: "日常磨耳朵", subtitle: "生活场景听力，不仿课本" },
    exam: { title: "考试听力", subtitle: "江苏真卷题型专项" },
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

  function langKey(lang) {
    return String(lang || "en").toLowerCase().startsWith("zh") ? "zh" : "en";
  }

  function manifestPath(text, lang) {
    const k = `${langKey(lang)}|${text}`;
    return state.audioManifest[k] || null;
  }

  function onlineTtsUrl(text, lang) {
    const q = encodeURIComponent(text);
    if (langKey(lang) === "zh") {
      return `https://fanyi.baidu.com/gettts?lan=zh&text=${q}&spd=5&source=web`;
    }
    // 有道词典语音：各端 WebView 一般都能用 <audio> 播
    return `https://dict.youdao.com/dictvoice?audio=${q}&type=2`;
  }

  function stopSpeech() {
    if (state.currentAudio) {
      try {
        state.currentAudio.onended = null;
        state.currentAudio.onerror = null;
        state.currentAudio.pause();
        state.currentAudio.removeAttribute("src");
        state.currentAudio.load();
      } catch {
        /* ignore */
      }
      state.currentAudio = null;
    }
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

  function playAudioUrl(url) {
    return new Promise((resolve) => {
      const audio = new Audio();
      state.currentAudio = audio;
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        if (state.currentAudio === audio) state.currentAudio = null;
        resolve(ok);
      };
      audio.preload = "auto";
      audio.onended = () => done(true);
      audio.onerror = () => done(false);
      audio.src = url;
      const p = audio.play();
      if (p && typeof p.then === "function") {
        p.catch(() => done(false));
      }
    });
  }

  function speakViaSynthesis(text, lang) {
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window)) {
        resolve(false);
        return;
      }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = langKey(lang) === "zh" ? 0.95 : 0.88;
      const voices = window.speechSynthesis.getVoices();
      const prefix = langKey(lang);
      const hit = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(prefix));
      if (hit) u.voice = hit;
      u.onend = () => resolve(true);
      u.onerror = () => resolve(false);
      window.speechSynthesis.speak(u);
    });
  }

  /** 任意浏览器：本地 mp3 → 在线 TTS 音频 → speechSynthesis（可选） */
  async function speak(text, lang) {
    const t = String(text || "").trim();
    if (!t) return;

    const local = manifestPath(t, lang);
    if (local) {
      const ok = await playAudioUrl(local);
      if (ok) return;
    }

    const okOnline = await playAudioUrl(onlineTtsUrl(t, lang));
    if (okOnline) return;

    await speakViaSynthesis(t, lang);
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
    $("view-hub").hidden = view !== "hub";
    $("view-dictation").hidden = view !== "dictation";
    $("view-play").hidden = view !== "play";
    $("view-review").hidden = view !== "review";
    const navView = view === "hub" ? "home" : view;
    document.querySelectorAll(".nav-tabs button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === navView);
    });
  }

  function packsForHub(hubId) {
    return (state.data.dictations || [])
      .filter((d) => (d.hub || "dictation") === hubId)
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  function renderPackCards(container, dicts, emptyHtml) {
    container.innerHTML = "";
    if (!dicts.length) {
      container.innerHTML = emptyHtml;
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
      container.appendChild(a);
    }
  }

  function renderHome() {
    const list = $("hub-list");
    list.innerHTML = "";
    const hubs = state.data.hubs || [
      { id: "ear", title: HUB_META.ear.title, subtitle: HUB_META.ear.subtitle, desc: "", accent: "warm" },
      { id: "exam", title: HUB_META.exam.title, subtitle: HUB_META.exam.subtitle, desc: "", accent: "teal" },
    ];
    for (const h of hubs) {
      const n = packsForHub(h.id).length;
      const a = document.createElement("a");
      a.className = `hub-card hub-${h.accent === "warm" ? "warm" : "teal"}`;
      a.href = `#/hub/${encodeURIComponent(h.id)}`;
      a.innerHTML = `
        <p class="hub-kicker">${h.id === "ear" ? "Daily listening" : "Exam listening"}</p>
        <h2>${escapeHtml(h.title)}</h2>
        <p class="hub-sub">${escapeHtml(h.subtitle || "")}</p>
        <p class="hub-desc">${escapeHtml(h.desc || "")}</p>
        <span class="hub-count">${n ? `${n} 套可练` : "内容准备中"}</span>
      `;
      list.appendChild(a);
    }
  }

  function renderHub(hubId) {
    state.currentHub = hubId;
    const hub =
      (state.data.hubs || []).find((h) => h.id === hubId) ||
      { id: hubId, ...(HUB_META[hubId] || { title: hubId, subtitle: "" }), desc: "" };
    $("hub-title").textContent = hub.title || hubId;
    $("hub-desc").textContent = hub.desc || hub.subtitle || "";
    const empty =
      hubId === "ear"
        ? `<div class="empty">日常磨耳朵套题即将上线（剑桥 Starters 等权威材料取向，不仿课本）。</div>`
        : hubId === "exam"
          ? `<div class="empty">考试听力套题即将上线（江苏真卷题型：听选 / 排序 / 判断 / 应答）。</div>`
          : `<div class="empty">这个分类还没有套题。</div>`;
    renderPackCards($("hub-card-list"), packsForHub(hubId), empty);
  }

  function renderDictationList() {
    renderPackCards(
      $("card-list"),
      packsForHub("dictation"),
      `<div class="empty">还没有听写。把新题加到 <code>data/dictations.json</code>，并设 <code>hub: "dictation"</code>。</div>`
    );
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
    const zhHint = item.promptZh || `第${state.index + 1}题`;
    $("prompt").textContent = "正在播放…请听";

    const prev = state.items[state.index - 1];
    if (state.index === 0 || (prev && prev.section !== item.section)) {
      await speak(`${item.section || "听写"}开始。`, "zh-CN");
    }

    await speak(zhHint, "zh-CN");
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
    stopSpeech();
    clearAuto();
    state.running = true;
    state.index = 0;
    $("btnStart").textContent = "重新开始";
    $("hint").textContent = "播放中…调大音量。";
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
    const back = $("play-back");
    if (state.currentHub && (state.currentHub === "ear" || state.currentHub === "exam")) {
      back.href = `#/hub/${encodeURIComponent(state.currentHub)}`;
      back.textContent = "← 返回分类";
    } else if (id === "review-wrong" || id === "review-all") {
      back.href = "#/review";
      back.textContent = "← 返回复习";
    } else {
      back.href = "#/dictation";
      back.textContent = "← 返回听写";
    }
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
    $("hint").textContent = "飞书 / Safari / Chrome 均可；用音频播放，调大音量后开始。";
    fillAnswers();
    $("answersBox").open = false;
  }

  function route() {
    const hash = location.hash || "#/";
    const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    if (!parts.length || parts[0] === "home") {
      state.currentHub = null;
      setView("home");
      renderHome();
      return;
    }
    if (parts[0] === "hub" && parts[1]) {
      const hubId = decodeURIComponent(parts[1]);
      if (hubId !== "ear" && hubId !== "exam") {
        location.hash = "#/";
        return;
      }
      setView("hub");
      renderHub(hubId);
      return;
    }
    if (parts[0] === "dictation") {
      state.currentHub = "dictation";
      setView("dictation");
      renderDictationList();
      return;
    }
    if (parts[0] === "review") {
      state.currentHub = null;
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
      if (!state.currentHub) {
        state.currentHub = d.hub || "dictation";
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
      state.currentHub = null;
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
        if (v === "dictation") location.hash = "#/dictation";
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
    const [dataRes, manRes] = await Promise.all([
      fetch(DATA_URL),
      fetch(MANIFEST_URL).catch(() => null),
    ]);
    state.data = await dataRes.json();
    if (manRes && manRes.ok) {
      state.audioManifest = await manRes.json();
    }
    $("site-title").textContent = state.data.siteTitle || "三年级英语听力";
    $("site-sub").textContent = state.data.siteSubtitle || "";
    route();
  }

  init().catch((err) => {
    console.error(err);
    const el = $("hub-list") || $("card-list");
    if (el) {
      el.innerHTML = `<div class="empty">加载失败：请用网站方式打开（不要直接双击本地文件时若被拦，请用 GitHub Pages 链接）。</div>`;
    }
  });
})();
