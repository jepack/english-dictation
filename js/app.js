(() => {
  const DATA_URL = "./data/dictations.json";
  const MANIFEST_URL = "./audio/manifest.json";

  const state = {
    data: null,
    audioManifest: {},
    view: "home", // home | hub | dictation | play | review
    currentHub: null,
    currentId: null,
    playKind: "dictation", // ear | exam | dictation
    items: [],
    index: -1,
    running: false,
    waitingNext: false,
    autoTimer: null,
    reviewWrongOnly: false,
    currentAudio: null,
    earRevealEn: false,
    earRevealZh: false,
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

  function earMode() {
    const el = document.querySelector('input[name="earMode"]:checked');
    return el ? el.value : "tap";
  }

  function isEarPlay() {
    return state.playKind === "ear";
  }

  function meaningOf(item) {
    if (!item) return "";
    return String(item.meaningZh || item.answer || "").trim();
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

  function setEarButtons({ playing = false, afterHear = false } = {}) {
    $("btnStart").disabled = playing;
    $("btnStop").disabled = !playing && !state.running;
    $("btnReplay").disabled = !afterHear;
    $("btnNext").disabled = !afterHear;
    $("btnShowEn").disabled = !afterHear;
    $("btnShowZh").disabled = !afterHear;
    $("btnHearZh").disabled = !afterHear || !meaningOf(state.items[state.index]);
    $("btnWrong").disabled = true;
    $("btnOk").disabled = true;
  }

  function showItem(reveal = false) {
    const i = state.index;
    const item = state.items[i];
    if (!item) return;
    const section = item.section || (isEarPlay() ? "磨耳朵" : "听写");
    $("badge").textContent = `${section} · ${i + 1}/${state.items.length}`;
    $("count").textContent = `${i + 1} / ${state.items.length}`;
    $("bar").style.width = `${((i + 1) / state.items.length) * 100}%`;

    if (isEarPlay()) {
      const en = state.earRevealEn || reveal;
      const zh = state.earRevealZh;
      const sp = $("speaker");
      if (item.speaker) {
        sp.hidden = false;
        sp.textContent = item.speaker;
        sp.dataset.who = item.speaker;
      } else {
        sp.hidden = true;
        sp.textContent = "";
        delete sp.dataset.who;
      }
      $("display").textContent = en ? item.text : "（先听，再点看英文）";
      $("display").classList.toggle("blur", false);
      $("display").classList.toggle("is-placeholder", !en);
      const meaningEl = $("meaning");
      meaningEl.hidden = false;
      if (zh) {
        meaningEl.textContent = meaningOf(item) || "（暂无中文）";
        meaningEl.classList.remove("is-placeholder");
      } else {
        meaningEl.textContent = "点「中文意思」对照含义";
        meaningEl.classList.add("is-placeholder");
      }
      return;
    }

    $("speaker").hidden = true;
    const label = item.answer || item.text;
    $("display").textContent = label;
    const show = reveal || $("showText").checked;
    $("display").classList.toggle("blur", !show);
    $("display").classList.remove("is-placeholder");
    $("meaning").hidden = true;
  }

  function fillAnswers() {
    const ol = $("answerList");
    ol.innerHTML = "";
    state.items.forEach((item) => {
      const li = document.createElement("li");
      if (isEarPlay()) {
        const zh = meaningOf(item);
        const who = item.speaker ? `<strong>${escapeHtml(item.speaker)}: </strong>` : "";
        li.innerHTML = `${who}<span class="ans-en">${escapeHtml(item.text)}</span>${
          zh ? ` <span class="ans-zh">— ${escapeHtml(zh)}</span>` : ""
        }`;
      } else {
        li.textContent = item.answer || item.text;
      }
      ol.appendChild(li);
    });
  }

  async function playCurrentEar() {
    const item = state.items[state.index];
    state.waitingNext = false;
    state.earRevealEn = false;
    state.earRevealZh = false;
    setEarButtons({ playing: true });
    showItem();
    $("prompt").textContent = item.speaker
      ? `仔细听——${item.speaker} 在说…`
      : "仔细听英文…";

    // 对话：先点名角色，再听句子，更有交流感
    if (item.speaker) {
      await speak(item.speaker, "en-US");
      await waitMs(220);
    }
    await speak(item.text, "en-US");
    if (!state.running) return;

    if (earMode() === "link") {
      state.earRevealEn = true;
      state.earRevealZh = true;
      showItem();
      $("prompt").textContent = "对照中文意思…";
      await waitMs(450);
      const zh = meaningOf(item);
      if (zh) await speak(zh, "zh-CN");
      if (!state.running) return;
      await waitMs(700);
      setEarButtons({ afterHear: true });
      state.waitingNext = true;
      $("btnStop").disabled = false;
      $("btnStart").disabled = true;
      clearAuto();
      state.autoTimer = setTimeout(() => {
        if (state.running) goNext();
      }, 900);
      $("hint").textContent = "连听模式：英→中后自动下一句；也可提前点「下一句」。";
      return;
    }

    setEarButtons({ afterHear: true });
    $("btnStop").disabled = false;
    $("btnStart").disabled = true;
    state.waitingNext = true;
    $("prompt").textContent = "点「看英文」或点中间区域；点「中文意思」对照含义";
    $("hint").textContent = "一句一句点：听 → 对照英文 → 对照中文 → 下一句。也可「听中文」。";
  }

  async function playCurrentDictation() {
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

  async function playCurrent() {
    if (state.index < 0 || state.index >= state.items.length) return;
    if (isEarPlay()) await playCurrentEar();
    else await playCurrentDictation();
  }

  async function startPlay() {
    stopSpeech();
    clearAuto();
    state.running = true;
    state.index = 0;
    state.earRevealEn = false;
    state.earRevealZh = false;
    $("btnStart").textContent = isEarPlay() ? "重新开始" : "重新开始";
    $("hint").textContent = "播放中…调大音量。";
    await playCurrent();
  }

  async function finishPlay() {
    state.running = false;
    state.waitingNext = false;
    $("btnNext").disabled = true;
    $("btnReplay").disabled = true;
    $("btnStop").disabled = true;
    $("btnStart").disabled = false;
    $("btnWrong").disabled = true;
    $("btnOk").disabled = true;
    if (isEarPlay()) {
      $("btnShowEn").disabled = true;
      $("btnShowZh").disabled = true;
      $("btnHearZh").disabled = true;
      $("prompt").textContent = "本组听完啦。可打开下方英中对照再扫一眼。";
      $("display").textContent = "Nice listening!";
      $("display").classList.remove("blur", "is-placeholder");
      $("meaning").hidden = false;
      $("meaning").textContent = "做得好";
      $("meaning").classList.remove("is-placeholder");
      $("badge").textContent = "完成";
      $("hint").textContent = "想再练就点「重新开始」，或换一组场景。";
      await speak("听完了。做得很好！", "zh-CN");
    } else {
      $("prompt").textContent = "听写结束！可打开下方答案核对。";
      $("display").textContent = "All done!";
      $("display").classList.remove("blur");
      $("badge").textContent = "完成";
      $("hint").textContent = "全部完成。错题可在「复习」里再练。";
      await speak("听写结束。做得很好！", "zh-CN");
    }
  }

  async function goNext() {
    if (!state.running) return;
    clearAuto();
    stopSpeech();
    if (state.index >= state.items.length - 1) {
      await finishPlay();
      return;
    }
    state.index += 1;
    state.earRevealEn = false;
    state.earRevealZh = false;
    if (!isEarPlay()) {
      await speak("下一个。", "zh-CN");
      await waitMs(200);
    } else {
      await waitMs(180);
    }
    await playCurrent();
  }

  async function replay() {
    if (state.index < 0 || !state.running) return;
    clearAuto();
    stopSpeech();
    if (isEarPlay()) {
      // 只重听英文，保留已揭开的对照
      $("prompt").textContent = "再听一遍英文…";
      setEarButtons({ playing: true });
      $("btnStop").disabled = false;
      await speak(state.items[state.index].text, "en-US");
      if (!state.running) return;
      setEarButtons({ afterHear: true });
      $("btnStop").disabled = false;
      $("btnStart").disabled = true;
      state.waitingNext = true;
      $("prompt").textContent = "继续点对照，或下一句";
      return;
    }
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
    $("btnShowEn").disabled = true;
    $("btnShowZh").disabled = true;
    $("btnHearZh").disabled = true;
  }

  function applyPlayChrome() {
    const ear = isEarPlay();
    document.body.classList.toggle("mode-ear", ear);
    $("play-options-dictation").hidden = ear;
    $("play-options-ear").hidden = !ear;
    $("controls-ear").hidden = !ear;
    $("controls-mark").hidden = ear;
    $("meaning").hidden = !ear;
    $("answersSummary").textContent = ear
      ? "英中对照（整组速览）"
      : "答案（写完再打开核对）";
    $("modeHint").textContent = ear
      ? earMode() === "link"
        ? "英→中连听"
        : "一句一句点"
      : mode() === "manual"
        ? "手动点控"
        : "按长度自动等";
  }

  function openPlay(id, items, title, playKind) {
    state.currentId = id;
    state.items = items;
    state.index = -1;
    state.running = false;
    state.playKind = playKind || "dictation";
    state.earRevealEn = false;
    state.earRevealZh = false;
    clearAuto();
    stopSpeech();
    setView("play");
    applyPlayChrome();
    const back = $("play-back");
    if (state.playKind === "ear" || state.playKind === "exam") {
      back.href = `#/hub/${encodeURIComponent(state.playKind)}`;
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
    if (isEarPlay()) {
      $("prompt").textContent = "点「开始磨耳朵」——先听，再对照中文意思";
      $("display").textContent = "Listen first";
      $("display").classList.remove("blur", "is-placeholder");
      $("meaning").hidden = false;
      $("meaning").textContent = "听懂意思，不急着写";
      $("meaning").classList.add("is-placeholder");
      $("speaker").hidden = true;
      $("btnStart").textContent = "开始磨耳朵";
      $("btnReplay").textContent = "再听英文";
      $("btnNext").textContent = "下一句";
      $("hint").textContent =
        "磨耳朵：听英文 → 点看英文 / 中文意思 → 可听中文。连听模式会自动英→中→下一句。";
    } else {
      $("prompt").textContent = "点「开始听写」——你控制什么时候开始";
      $("display").textContent = "Ready?";
      $("display").classList.remove("blur", "is-placeholder");
      $("meaning").hidden = true;
      $("speaker").hidden = true;
      $("btnStart").textContent = "开始听写";
      $("btnReplay").textContent = "再读一遍";
      $("btnNext").textContent = "下一个";
      $("hint").textContent = "飞书 / Safari / Chrome 均可；用音频播放，调大音量后开始。";
    }
    $("count").textContent = `0 / ${items.length}`;
    $("bar").style.width = "0%";
    $("btnStart").disabled = false;
    $("btnNext").disabled = true;
    $("btnReplay").disabled = true;
    $("btnStop").disabled = true;
    $("btnWrong").disabled = true;
    $("btnOk").disabled = true;
    $("btnShowEn").disabled = true;
    $("btnShowZh").disabled = true;
    $("btnHearZh").disabled = true;
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
      const kind = d.hub === "ear" || d.hub === "exam" ? d.hub : "dictation";
      openPlay(
        d.id,
        d.items.map((it, idx) => ({
          ...it,
          meaningZh: it.meaningZh || (kind === "ear" ? it.answer : undefined),
          _dictationId: d.id,
          _itemIndex: idx,
        })),
        d.title,
        kind
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
        wrongOnly ? "错题复习" : "全部复习",
        "dictation"
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

    $("btnShowEn").addEventListener("click", () => {
      if (!isEarPlay() || state.index < 0) return;
      state.earRevealEn = true;
      showItem();
      $("prompt").textContent = "对照英文；再点「中文意思」映射含义";
    });
    $("btnShowZh").addEventListener("click", () => {
      if (!isEarPlay() || state.index < 0) return;
      state.earRevealZh = true;
      if (!state.earRevealEn) state.earRevealEn = true;
      showItem();
      $("prompt").textContent = "英中已对照。可「听中文」或下一句";
    });
    $("btnHearZh").addEventListener("click", async () => {
      if (!isEarPlay() || state.index < 0) return;
      const zh = meaningOf(state.items[state.index]);
      if (!zh) return;
      state.earRevealZh = true;
      state.earRevealEn = true;
      showItem();
      clearAuto();
      stopSpeech();
      $("prompt").textContent = "听中文意思…";
      await speak(zh, "zh-CN");
      if (state.running) {
        $("prompt").textContent = "可以再听英文，或下一句";
        state.waitingNext = true;
      }
    });
    $("stage").addEventListener("click", () => {
      if (!isEarPlay() || !state.running || state.index < 0) return;
      if ($("btnShowEn").disabled) return;
      if (!state.earRevealEn) {
        state.earRevealEn = true;
        showItem();
        $("prompt").textContent = "已显示英文；再点可看中文意思";
        return;
      }
      if (!state.earRevealZh) {
        state.earRevealZh = true;
        showItem();
        $("prompt").textContent = "英中已对照。可「听中文」或下一句";
      }
    });

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
    document.querySelectorAll('input[name="earMode"]').forEach((r) => {
      r.addEventListener("change", () => {
        $("modeHint").textContent = earMode() === "link" ? "英→中连听" : "一句一句点";
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
