(() => {
  const DATA_URL = "./data/lessons.json";
  const MANIFEST_URL = "./audio/manifest.json";
  const SLOW_RATE = 0.7;

  const state = {
    data: null,
    audioManifest: {},
    view: "home",
    lessonId: null,
    items: [],
    index: 0,
    running: false,
    currentAudio: null,
    abort: false,
  };

  const $ = (id) => document.getElementById(id);

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
    return `https://dict.youdao.com/dictvoice?audio=${q}&type=2`;
  }

  function stopSpeech() {
    state.abort = true;
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
    state.running = false;
    syncButtons();
  }

  function waitMs(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function playAudioUrl(url, rate = 1) {
    return new Promise((resolve) => {
      if (state.abort) return resolve(false);
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
      try {
        audio.playbackRate = rate;
      } catch {
        /* ignore */
      }
      const p = audio.play();
      if (p && typeof p.then === "function") {
        p.catch(() => done(false));
      }
    });
  }

  function speakSynth(text, lang, rate = 1) {
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window) || state.abort) return resolve(false);
      const u = new SpeechSynthesisUtterance(text);
      u.lang = langKey(lang) === "zh" ? "zh-CN" : "en-US";
      u.rate = rate;
      u.onend = () => resolve(true);
      u.onerror = () => resolve(false);
      window.speechSynthesis.speak(u);
    });
  }

  async function speak(text, lang = "en", rate = 1) {
    text = String(text || "").trim();
    if (!text || state.abort) return false;
    const local = manifestPath(text, lang);
    if (local) {
      const ok = await playAudioUrl(local, rate);
      if (ok || state.abort) return ok;
    }
    const online = onlineTtsUrl(text, lang);
    const ok2 = await playAudioUrl(online, rate);
    if (ok2 || state.abort) return ok2;
    return speakSynth(text, lang, rate);
  }

  function chunksFor(item) {
    const sy = (item.syllables || []).map((s) => String(s).trim()).filter(Boolean);
    if (sy.length) return sy;
    if ((item.kind || "") === "sentence") {
      return String(item.text || "").match(/[A-Za-z']+/g) || [item.text];
    }
    return [item.text];
  }

  function latestCorrection(item) {
    const list = item.corrections || [];
    return list.length ? list[list.length - 1] : null;
  }

  function setPhase(label) {
    $("badge").textContent = label;
    $("phaseHint").textContent = label;
  }

  function renderSplit(chunks, activeIdx) {
    const el = $("splitLine");
    if (!chunks || chunks.length <= 1) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    el.hidden = false;
    el.innerHTML = chunks
      .map((c, i) => {
        const cls = i === activeIdx ? "chunk active" : "chunk";
        return `<span class="${cls}">${escapeHtml(c)}</span>`;
      })
      .join('<span class="sep">·</span>');
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderItem() {
    const item = state.items[state.index];
    if (!item) return;
    const n = state.items.length;
    $("count").textContent = `${state.index + 1} / ${n}`;
    $("bar").style.width = `${((state.index + 1) / Math.max(1, n)) * 100}%`;
    $("display").textContent = item.text || "";
    $("kindLabel").textContent = (item.kind || "word") === "sentence" ? "句子" : "单词";

    const chunks = chunksFor(item);
    renderSplit(chunks, -1);

    const stress = (item.stressNote || "").trim();
    $("stressLine").hidden = !stress;
    $("stressLine").textContent = stress ? `重音：${stress}` : "";

    const tips = (item.tipsZh || "").trim();
    const grammar = (item.grammarZh || "").trim();
    const tipBox = $("tipBox");
    if (tips || grammar) {
      tipBox.hidden = false;
      $("tipsZh").textContent = tips;
      $("grammarZh").hidden = !grammar;
      $("grammarZh").textContent = grammar ? `语法：${grammar}` : "";
    } else {
      tipBox.hidden = true;
    }

    const corr = latestCorrection(item);
    const fixBox = $("fixBox");
    if (corr && corr.coach) {
      fixBox.hidden = false;
      $("fixText").textContent = corr.coach;
    } else {
      fixBox.hidden = true;
      $("fixText").textContent = "";
    }

    setPhase("准备就绪");
    syncButtons();
  }

  function syncButtons() {
    const has = state.items.length > 0 && state.view === "play";
    const busy = state.running;
    ["btnTeach", "btnSlow", "btnSplit", "btnFast", "btnReplayTeach", "btnPrev", "btnNext"].forEach(
      (id) => {
        const el = $(id);
        if (!el) return;
        if (id === "btnStop") return;
        el.disabled = !has || busy;
      }
    );
    $("btnStop").disabled = !busy;
    if (has && !busy) {
      $("btnPrev").disabled = state.index <= 0;
      $("btnNext").disabled = state.index >= state.items.length - 1 && !busy;
      if (state.index >= state.items.length - 1) {
        $("btnNext").disabled = true;
      }
    }
  }

  async function playSlow(item) {
    setPhase("慢读");
    await speak("慢读。", "zh", 1);
    if (state.abort) return;
    await speak(item.text, "en", SLOW_RATE);
  }

  async function playSplit(item, rounds = 2) {
    const chunks = chunksFor(item);
    for (let r = 0; r < rounds; r++) {
      if (state.abort) return;
      setPhase(r === 0 ? "拆开读" : "再拆一次");
      await speak(r === 0 ? "拆开读。" : "再拆一次。", "zh", 1);
      if (state.abort) return;
      for (let i = 0; i < chunks.length; i++) {
        if (state.abort) return;
        renderSplit(chunks, i);
        await speak(chunks[i], "en", 0.85);
        await waitMs(280);
      }
      renderSplit(chunks, -1);
      await waitMs(350);
    }
  }

  async function playFast(item) {
    setPhase("快读");
    await speak("快读。", "zh", 1);
    if (state.abort) return;
    await speak(item.text, "en", 1);
  }

  async function teachOnce() {
    const item = state.items[state.index];
    if (!item || state.running) return;
    state.abort = false;
    state.running = true;
    syncButtons();
    try {
      setPhase("跟我读");
      await speak("跟我读。", "zh", 1);
      if (state.abort) return;
      await playSlow(item);
      if (state.abort) return;
      await playSplit(item, 2);
      if (state.abort) return;
      await playFast(item);
      if (!state.abort) setPhase("这一条练完了 · 可再教或下一条");
    } finally {
      state.running = false;
      syncButtons();
    }
  }

  async function runStep(fn) {
    const item = state.items[state.index];
    if (!item || state.running) return;
    state.abort = false;
    state.running = true;
    syncButtons();
    try {
      await fn(item);
      if (!state.abort) setPhase("就绪");
    } finally {
      state.running = false;
      syncButtons();
    }
  }

  function showHome() {
    stopSpeech();
    state.view = "home";
    state.lessonId = null;
    $("view-home").hidden = false;
    $("view-play").hidden = true;
    renderHome();
  }

  function openLesson(id) {
    const lesson = (state.data.lessons || []).find((l) => l.id === id);
    if (!lesson) {
      showHome();
      return;
    }
    stopSpeech();
    state.view = "play";
    state.lessonId = id;
    state.items = lesson.items || [];
    state.index = 0;
    $("view-home").hidden = true;
    $("view-play").hidden = false;
    $("play-title").textContent = lesson.title || id;
    $("play-note").textContent = lesson.note || "";
    $("site-title").textContent = state.data.siteTitle || "英语点读";
    renderItem();
  }

  function renderHome() {
    const list = $("card-list");
    const lessons = (state.data && state.data.lessons) || [];
    if (!lessons.length) {
      list.innerHTML = `<p class="empty">还没有点读课。飞书发课本照片给哆啦A梦即可生成。</p>`;
      return;
    }
    list.innerHTML = lessons
      .map((l) => {
        const tags = (l.tags || [])
          .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
          .join("");
        const n = (l.items || []).length;
        return `<a class="card" href="#/lesson/${encodeURIComponent(l.id)}">
          <h2>${escapeHtml(l.title || l.id)}</h2>
          <div class="meta">${escapeHtml(l.grade || "")} · ${escapeHtml(l.date || "")} · ${n} 条
          ${l.sourceNote ? `<br/>${escapeHtml(l.sourceNote)}` : ""}</div>
          <div class="tags">${tags}</div>
        </a>`;
      })
      .join("");
  }

  function route() {
    const hash = location.hash || "#/";
    const m = hash.match(/^#\/lesson\/([^/?]+)/);
    if (m) {
      openLesson(decodeURIComponent(m[1]));
    } else {
      showHome();
    }
  }

  function bind() {
    $("btnTeach").addEventListener("click", () => teachOnce());
    $("btnReplayTeach").addEventListener("click", () => teachOnce());
    $("btnSlow").addEventListener("click", () => runStep(playSlow));
    $("btnSplit").addEventListener("click", () => runStep((it) => playSplit(it, 2)));
    $("btnFast").addEventListener("click", () => runStep(playFast));
    $("btnStop").addEventListener("click", () => {
      stopSpeech();
      setPhase("已停止");
    });
    $("btnPrev").addEventListener("click", () => {
      if (state.index <= 0) return;
      stopSpeech();
      state.index -= 1;
      renderItem();
    });
    $("btnNext").addEventListener("click", () => {
      if (state.index >= state.items.length - 1) return;
      stopSpeech();
      state.index += 1;
      renderItem();
    });
    $("btnBack").addEventListener("click", (e) => {
      e.preventDefault();
      location.hash = "#/";
    });
    window.addEventListener("hashchange", route);
  }

  async function boot() {
    bind();
    const [data, manifest] = await Promise.all([
      fetch(DATA_URL).then((r) => r.json()),
      fetch(MANIFEST_URL)
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({})),
    ]);
    state.data = data;
    state.audioManifest = manifest || {};
    $("site-title").textContent = data.siteTitle || "英语点读";
    $("site-sub").textContent = data.siteSubtitle || "";
    route();
  }

  boot().catch((err) => {
    console.error(err);
    $("card-list").innerHTML = `<p class="empty">加载失败：${escapeHtml(String(err))}</p>`;
  });
})();
