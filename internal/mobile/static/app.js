/* DeepSeek Harness 手机端客户端 */
(function () {
  "use strict";

  const state = {
    host: localStorage.getItem("dsh_m_host") || "",
    token: localStorage.getItem("dsh_m_token") || "",
    device: JSON.parse(localStorage.getItem("dsh_m_device") || "null"),
    sessions: [],
    sessionId: localStorage.getItem("dsh_m_session") || null,
    sessionTitle: "",
    messages: [], // { role: 'user'|'ai', text, id }
    models: null,
    currentModel: JSON.parse(localStorage.getItem("dsh_m_model") || "null"),
    sending: false,
    pollTimer: null,
    liveEs: null,
    liveText: "",
    liveEl: null,
    workspaces: [],
    actionSessionId: null,
    home: "",
    thinkingEl: null,
    thinkingTimer: null,
    thinkingStartedAt: 0,
    generating: false,
    pendingQueue: [], // { id, text }
    stickBottom: true,
    selectMode: false,
    selectedIds: new Set(),
    modelsLoadedAt: 0,
  };

  const $ = (id) => document.getElementById(id);

  function apiBase() {
    return (state.host || "").replace(/\/+$/, "");
  }

  async function api(path, options = {}) {
    if (!state.token) throw new Error("未配对");
    const res = await fetch(`${apiBase()}${path}`, {
      ...options,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${state.token}`,
        ...(options.headers || {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.message || body.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.payload = body;
      throw err;
    }
    return body;
  }

  function persist() {
    localStorage.setItem("dsh_m_host", state.host || "");
    localStorage.setItem("dsh_m_token", state.token || "");
    localStorage.setItem("dsh_m_device", JSON.stringify(state.device));
    localStorage.setItem("dsh_m_session", state.sessionId || "");
    localStorage.setItem("dsh_m_model", JSON.stringify(state.currentModel));
  }

  function showView(name) {
    $("view-pair").hidden = name !== "pair";
    $("view-chat").hidden = name !== "chat";
  }

  function setBadge(text, cls) {
    const el = $("conn-light");
    if (!el) return;
    el.title = text || "连接状态";
    el.setAttribute("aria-label", text || "连接状态");
    el.className = `conn-light${cls ? ` ${cls}` : ""}`;
  }

  function setStatus(text) {
    const el = $("chat-status");
    if (!text) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.textContent = text;
  }

  // ---------- 滚动策略：仅贴底时自动滚 ----------
  function isNearBottom(el, threshold = 48) {
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }

  function scrollToBottom(smooth) {
    const stream = $("chat-stream");
    if (!stream) return;
    stream.scrollTo({
      top: stream.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
    state.stickBottom = true;
    updateScrollBottomBtn();
  }

  function maybeScrollBottom(smooth) {
    if (state.stickBottom) scrollToBottom(smooth);
  }

  function updateScrollBottomBtn() {
    const btn = $("btn-scroll-bottom");
    if (!btn) return;
    btn.hidden = state.stickBottom;
  }

  function initScrollPolicy() {
    const stream = $("chat-stream");
    if (!stream || stream.dataset.scrollInit) return;
    stream.dataset.scrollInit = "1";
    stream.addEventListener("scroll", () => {
      state.stickBottom = isNearBottom(stream);
      updateScrollBottomBtn();
    }, { passive: true });
    $("btn-scroll-bottom").addEventListener("click", () => scrollToBottom(true));
  }

  // ---------- 配对 ----------
  $("pair-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const host = $("pair-host").value.trim().replace(/\/+$/, "");
    const code = $("pair-code").value.trim();
    const deviceName = $("pair-name").value.trim() || navigator.userAgent.slice(0, 32) || "手机";
    const btn = $("pair-submit");
    const errEl = $("pair-error");
    errEl.hidden = true;
    btn.disabled = true;
    btn.textContent = "连接中…";
    try {
      const res = await fetch(`${host}/m/pair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, deviceName }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "配对失败");
      state.host = host;
      state.token = body.token;
      state.device = body.device;
      persist();
      await enterChat(true);
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = err && err.message ? err.message : "无法连接电脑，请检查地址与配对码";
    } finally {
      btn.disabled = false;
      btn.textContent = "连接电脑";
    }
  });

  async function enterChat(fresh) {
    showView("chat");
    initScrollPolicy();
    setBadge("连接中…");
    setStatus("");
    try {
      const st = await api("/m/status");
      if (st && st.dsh && st.dsh.connected) {
        setBadge("已连接电脑", "ok");
      } else if (st && st.dsh && st.dsh.lastError) {
        setBadge("电脑服务异常", "err");
        setStatus(`电脑端 Harness：${st.dsh.lastError}`);
      } else {
        setBadge("电脑服务未就绪", "err");
        setStatus("电脑端 Harness 服务未就绪，请确认桌面端已进入主界面");
      }
      if (fresh || !state.sessionId) await ensureSession();
      await Promise.all([loadModels(), loadHistory()]);
      startLiveStream();
      startPolling();
    } catch (err) {
      if (err && err.status === 401) {
        logout("登录已失效，请重新配对");
        return;
      }
      setBadge("连接失败", "err");
      setStatus((err && err.message) || "无法连接");
    }
  }

  function logout(msg) {
    state.token = "";
    state.device = null;
    state.sessionId = null;
    state.messages = [];
    stopPolling();
    stopLiveStream();
    finishLiveBubble();
    stopThinkingRow();
    persist();
    $("pair-host").value = state.host || guessHostFromPage();
    showView("pair");
    if (msg) {
      $("pair-error").hidden = false;
      $("pair-error").textContent = msg;
    }
  }

  function guessHostFromPage() {
    return `${location.origin}`;
  }

  // ---------- 会话 ----------
  async function ensureSession() {
    const list = await api("/m/sessions");
    const items = (list.value && list.value.items) || [];
    state.sessions = items;
    // 优先最近更新、非 blank 的会话，保证与电脑端同屏
    const active =
      items.find((s) => !s.blank) ||
      items[0];
    if (active) {
      state.sessionId = active.sessionId;
      state.sessionTitle = titleOf(active);
    } else {
      const created = await api("/m/sessions", { method: "POST", body: "{}" });
      state.sessionId = created.value && created.value.sessionId;
      state.sessionTitle = "新会话";
      state.messages = [];
    }
    persist();
    $("chat-title").textContent = state.sessionTitle || "会话";
    renderSessions();
  }

  function titleOf(session) {
    if (!session) return "会话";
    if (session.blank) return "新会话";
    const proj = session.projections && session.projections.values;
    if (proj) {
      for (const key of ["sessionTitle", "title", "displayName"]) {
        if (typeof proj[key] === "string" && proj[key].trim()) return proj[key].trim();
      }
    }
    const id = String(session.sessionId || "");
    return `会话 ${id.slice(0, 8)}`;
  }

  async function openSession(sessionId) {
    stopLiveStream();
    finishLiveBubble();
    stopThinkingRow();
    state.sessionId = sessionId;
    state.messages = [];
    const found = state.sessions.find((s) => s.sessionId === sessionId);
    state.sessionTitle = titleOf(found);
    $("chat-title").textContent = state.sessionTitle || "会话";
    persist();
    closeDrawer("sessions");
    await Promise.all([loadModels(), loadHistory()]);
    startLiveStream();
  }

  async function loadHistory() {
    if (!state.sessionId) return;
    try {
      const page = await api(`/m/sessions/${encodeURIComponent(state.sessionId)}/history?maxMessages=80`);
      const next = mapHistory(page.value);
      const generating = state.generating || state.thinkingEl || state.liveEl;
      if (generating) {
        // 生成中：只更新数据，不整页清空（避免冲掉「深度求索中」/live）
        state.messages = next;
        // 若历史里已有完整助手回复且不是 live 进行中，再收口
        const last = next[next.length - 1];
        if (last && last.role === "ai" && !state.liveEl) {
          stopThinkingRow();
          setGenerating(false);
          renderMessages();
          flushQueuedWhenIdle().catch(() => {});
        }
        setStatus("");
        return;
      }
      state.messages = next;
      renderMessages();
      const last = next[next.length - 1];
      if (last && last.role === "ai") {
        setGenerating(false);
        flushQueuedWhenIdle().catch(() => {});
      }
      setStatus("");
    } catch (err) {
      setStatus((err && err.message) || "加载历史失败");
    }
  }

  /** 去掉 harness 内部注入，不展示给用户。 */
  function stripInternalText(text) {
    if (!text) return "";
    let out = String(text);
    out = out.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "");
    out = out.replace(/<system-reminder>[\s\S]*$/i, "");
    out = out.replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, "");
    out = out.replace(/<runtime_context>[\s\S]*?<\/runtime_context>/gi, "");
    // 整段 runtime context 快照（往往从这里一直到结尾）
    const rt = out.search(/Current runtime context\./i);
    if (rt >= 0) {
      const after = out.slice(rt + 24);
      // 若后面基本没有「用户可见」正文标记，则整段丢弃
      if (!/\n\n[^A-Z]/.test(after) || after.length < 2000) {
        out = out.slice(0, rt);
      } else {
        out = out.slice(0, rt) + "\n" + stripInternalText(after);
      }
    }
    out = out.replace(/Current DSH file policy:[\s\S]*?(?=\n\n|$)/i, "");
    out = out.replace(/\n{3,}/g, "\n\n").trim();
    return out;
  }

  function isMostlyInternal(text) {
    const raw = String(text || "");
    if (!raw.trim()) return true;
    if (/<system-reminder>/i.test(raw) && stripInternalText(raw).length < 80) return true;
    if (/^<system-reminder>/i.test(raw.trim())) return true;
    if (/^Current runtime context\./i.test(raw.trim())) return true;
    const stripped = stripInternalText(raw);
    if (!stripped) return true;
    return false;
  }

  function mapHistory(page) {
    const out = [];
    if (!page) return out;
    const records = page.records || page.events || page.items || [];
    for (const rec of records) {
      const event = rec && rec.event ? rec.event : rec;
      if (!event || !event.type) continue;
      if (event.type === "user/message") {
        const raw = extractText(event.data);
        if (isMostlyInternal(raw)) continue;
        const text = stripInternalText(raw);
        if (!text) continue;
        out.push({ role: "user", text, id: event.seq || out.length });
      } else if (event.type === "assistant/message") {
        const msg = event.data && event.data.message ? event.data.message : event.data;
        const raw = extractText(msg);
        const text = stripInternalText(raw);
        if (!text) continue;
        out.push({ role: "ai", text, id: event.seq || out.length });
      }
    }
    return out;
  }

  function extractText(data) {
    if (!data) return "";
    if (typeof data === "string") return data;
    if (typeof data.text === "string") return data.text;
    if (typeof data.content === "string") return data.content;
    if (Array.isArray(data.content)) {
      return data.content
        .map((part) => {
          if (!part) return "";
          if (typeof part === "string") return part;
          if (part.type === "text" && typeof part.text === "string") return part.text;
          if (typeof part.text === "string") return part.text;
          return "";
        })
        .filter(Boolean)
        .join("\n");
    }
    if (data.message) return extractText(data.message);
    return "";
  }

  function emptyEl() {
    let el = document.getElementById("chat-empty");
    if (!el) {
      el = document.createElement("div");
      el.id = "chat-empty";
      el.className = "chat-empty";
      el.innerHTML = `<div class="chat-empty-logo"><span class="ds-run-mark static" aria-hidden="true"><i></i><i></i><i></i><i></i></span></div><div class="chat-empty-title">有什么可以帮你？</div><div class="chat-empty-sub">与电脑端同一会话，消息实时同步</div>`;
    }
    return el;
  }

  function renderMessages() {
    const stream = $("chat-stream");
    const stick = state.stickBottom;
    // 先抓住临时节点，innerHTML 清空会把它们摘掉，需要再挂回去
    const thinkingEl = state.thinkingEl;
    const liveEl = state.liveEl;
    stream.innerHTML = "";
    if (state.messages.length === 0) {
      const empty = emptyEl();
      empty.hidden = false;
      stream.appendChild(empty);
    } else {
      for (const msg of state.messages) {
        stream.appendChild(renderMsg(msg));
      }
    }
    // 生成中：thinking / live 气泡保持在最底部
    if (liveEl) {
      stream.appendChild(liveEl);
      state.liveEl = liveEl;
    }
    if (thinkingEl) {
      stream.appendChild(thinkingEl);
      state.thinkingEl = thinkingEl;
    }
    if (stick) scrollToBottom(false);
  }

  function renderMsg(msg) {
    const wrap = document.createElement("div");
    wrap.className = `msg msg-${msg.role === "user" ? "user" : "ai"}`;
    if (msg.role === "user") {
      const body = document.createElement("div");
      body.className = "user-line";
      body.textContent = msg.text;
      wrap.appendChild(body);
    } else {
      const body = document.createElement("div");
      body.className = "ai-body md";
      body.innerHTML = (window.DshMd && DshMd.renderMarkdown(msg.text)) || DshMdSafeFallback(msg.text);
      wrap.appendChild(body);
    }
    return wrap;
  }

  function DshMdSafeFallback(text) {
    return `<p class="md-p">${String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`;
  }

  function appendLocalMsg(role, text) {
    const msg = { role, text, id: `local-${Date.now()}-${Math.random().toString(16).slice(2, 8)}` };
    state.messages.push(msg);
    const stream = $("chat-stream");
    const empty = document.getElementById("chat-empty");
    if (empty) empty.hidden = true;
    if (state.messages.length === 1) stream.innerHTML = "";
    stream.appendChild(renderMsg(msg));
    maybeScrollBottom(false);
    return msg;
  }

  // ---------- 模型 ----------
  async function loadModels(opts = {}) {
    const force = !!opts.force;
    const maxAge = 30_000;
    if (!force && state.models && Date.now() - state.modelsLoadedAt < maxAge) {
      applyModelLabel();
      return;
    }
    try {
      const res = await api("/m/models");
      state.models = res.value || null;
      state.modelsLoadedAt = Date.now();
      applyModelLabel();
      if (!$("sheet-model").hidden) renderModelList();
    } catch {
      /* 模型目录失败不阻塞聊天 */
    }
  }

  function applyModelLabel() {
    const label = $("model-label");
    if (state.models && state.models.default && state.models.default.model) {
      const d = state.models.default;
      const groups = state.models.groups || [];
      const g = groups.find((x) => x.id === d.provider);
      const model = g && (g.models || []).find((m) => m.id === d.model);
      label.textContent = (model && (model.name || model.id)) || d.model;
      state.currentModel = { provider: d.provider, model: d.model };
    } else if (state.currentModel && state.currentModel.model) {
      label.textContent = state.currentModel.model;
    } else {
      label.textContent = "选择模型";
    }
  }

  function renderModelList() {
    const box = $("model-list");
    box.innerHTML = "";
    if (!state.models) {
      box.innerHTML = `<div class="model-group">暂无模型目录</div>`;
      return;
    }
    for (const group of state.models.groups || []) {
      const head = document.createElement("div");
      head.className = "model-group";
      head.textContent = group.name || group.id;
      box.appendChild(head);
      for (const model of group.models || []) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "model-item";
        const selected =
          state.currentModel &&
          state.currentModel.provider === group.id &&
          state.currentModel.model === model.id;
        if (selected) btn.classList.add("on");
        btn.innerHTML = `<div class="n"></div><div class="d"></div>`;
        btn.querySelector(".n").textContent = model.name || model.id;
        btn.querySelector(".d").textContent = model.description || model.id;
        btn.addEventListener("click", async () => {
          if (!state.sessionId) return;
          // 乐观更新，立刻关闭 sheet
          const prev = state.currentModel;
          state.currentModel = { provider: group.id, model: model.id };
          persist();
          applyModelLabel();
          renderModelList();
          closeSheet("model");
          try {
            await api(`/m/sessions/${encodeURIComponent(state.sessionId)}/model`, {
              method: "POST",
              body: JSON.stringify({
                provider: group.id,
                model: model.id,
                ...(model.reasoning && model.reasoning.defaultEffort
                  ? { reasoningEffort: model.reasoning.defaultEffort }
                  : {}),
              }),
            });
          } catch (err) {
            state.currentModel = prev;
            persist();
            applyModelLabel();
            renderModelList();
            setStatus(err.message || "切换模型失败");
          }
        });
        box.appendChild(btn);
      }
    }
  }

  // ---------- 发送 / 停止 / 排队（对齐 dsh） ----------
  const input = $("composer-input");
  const sendBtn = $("btn-send");
  const icoSend = sendBtn.querySelector(".ico-send");
  const icoStop = sendBtn.querySelector(".ico-stop");

  function setGenerating(on) {
    state.generating = !!on;
    syncSendButton();
  }

  /** 生成中且输入为空 → 停止；否则发送。 */
  function syncSendButton() {
    const hasText = !!input.value.trim();
    const stopMode = state.generating && !hasText;
    icoSend.hidden = stopMode;
    icoStop.hidden = !stopMode;
    sendBtn.classList.toggle("is-stop", stopMode);
    sendBtn.setAttribute("aria-label", stopMode ? "停止生成" : "发送");
    sendBtn.disabled = stopMode ? false : !hasText || state.sending;
  }

  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
    syncSendButton();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onPrimaryAction();
    }
  });

  sendBtn.addEventListener("click", () => onPrimaryAction());

  async function onPrimaryAction() {
    const text = input.value.trim();
    if (state.generating && !text) {
      await stopGenerate();
      return;
    }
    if (!text || !state.sessionId) return;
    if (state.generating) {
      // 生成中有内容：入队，显示待发条 + 「立即发送」
      enqueuePending(text);
      return;
    }
    await sendNow(text, "queue");
  }

  function brandMarkHtml() {
    return `<span class="ds-run-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`;
  }

  function ensureThinkingRow() {
    if (state.thinkingEl && state.thinkingEl.isConnected) return state.thinkingEl;
    const stream = $("chat-stream");
    const empty = document.getElementById("chat-empty");
    if (empty) empty.hidden = true;
    // 若已有 live 气泡则不再叠 thinking
    if (state.liveEl && state.liveEl.isConnected) return state.liveEl;
    const wrap = document.createElement("div");
    wrap.className = "msg msg-ai msg-thinking";
    wrap.innerHTML = `<div class="think-row">${brandMarkHtml()}<span class="think-text">深度求索中...</span></div>`;
    stream.appendChild(wrap);
    state.thinkingEl = wrap;
    state.thinkingStartedAt = Date.now();
    stopThinkingTimer();
    state.thinkingTimer = setInterval(() => {
      const el = state.thinkingEl;
      if (!el || !el.isConnected) {
        stopThinkingTimer();
        return;
      }
      const sec = Math.floor((Date.now() - state.thinkingStartedAt) / 1000);
      const textEl = el.querySelector(".think-text");
      if (!textEl) return;
      if (sec >= 15) textEl.textContent = `深度求索中... ${sec}秒`;
      else textEl.textContent = "深度求索中...";
    }, 1000);
    maybeScrollBottom(true);
    setGenerating(true);
    return wrap;
  }

  function stopThinkingTimer() {
    if (state.thinkingTimer) clearInterval(state.thinkingTimer);
    state.thinkingTimer = null;
  }

  function stopThinkingRow() {
    stopThinkingTimer();
    if (state.thinkingEl && state.thinkingEl.isConnected) state.thinkingEl.remove();
    state.thinkingEl = null;
  }

  // ---------- 待发队列条 ----------
  function renderQueueList() {
    const box = $("queue-list");
    if (!box) return;
    box.innerHTML = "";
    if (!state.pendingQueue.length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    for (const item of state.pendingQueue) {
      const row = document.createElement("div");
      row.className = "queue-item";
      const text = document.createElement("div");
      text.className = "queue-text";
      text.textContent = item.text;
      const act = document.createElement("button");
      act.type = "button";
      act.className = "queue-now";
      act.textContent = "立即发送";
      act.addEventListener("click", () => flushPendingNow(item.id));
      row.appendChild(text);
      row.appendChild(act);
      box.appendChild(row);
    }
  }

  function enqueuePending(text) {
    const id = `q-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    state.pendingQueue.push({ id, text });
    input.value = "";
    input.style.height = "auto";
    renderQueueList();
    syncSendButton();
  }

  async function flushPendingNow(id) {
    const idx = state.pendingQueue.findIndex((x) => x.id === id);
    if (idx < 0) return;
    const item = state.pendingQueue[idx];
    state.pendingQueue.splice(idx, 1);
    renderQueueList();
    try {
      // 立即发送：steer 抢占当前轮
      await sendNow(item.text, "steer");
    } catch {
      // 失败则放回队列顶部
      state.pendingQueue.unshift(item);
      renderQueueList();
    }
  }

  async function flushQueuedWhenIdle() {
    if (state.generating || state.pendingQueue.length === 0) return;
    const item = state.pendingQueue.shift();
    renderQueueList();
    if (!item) return;
    try {
      await sendNow(item.text, "queue");
    } catch {
      state.pendingQueue.unshift(item);
      renderQueueList();
    }
  }

  async function stopGenerate() {
    if (!state.sessionId) return;
    try {
      await api(`/m/sessions/${encodeURIComponent(state.sessionId)}/cancel`, {
        method: "POST",
        body: "{}",
      });
      setStatus("已停止生成");
    } catch (err) {
      setStatus(err.message || "停止失败");
      return;
    }
    stopThinkingRow();
    finishLiveBubble();
    setGenerating(false);
    setTimeout(() => {
      loadHistory().catch(() => {});
      flushQueuedWhenIdle().catch(() => {});
    }, 300);
  }

  async function sendNow(text, mode) {
    if (!state.sessionId) return;
    state.sending = true;
    syncSendButton();
    const userMsg = appendLocalMsg("user", text);
    input.value = "";
    input.style.height = "auto";
    ensureThinkingRow();
    setGenerating(true);

    try {
      await api(`/m/sessions/${encodeURIComponent(state.sessionId)}/prompt`, {
        method: "POST",
        body: JSON.stringify({
          text,
          mode: mode === "steer" ? "steer" : "queue",
          requestId: `m-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      setStatus("");
      // 保持「深度求索中」直到流式首包；此期间不要 loadHistory 清空
      startLiveStream();
      // 首包之后再拉历史（由 SSE 的 user/assistant-final 触发）
    } catch (err) {
      stopThinkingRow();
      setGenerating(false);
      const msg = (err && err.message) || "发送失败";
      setStatus(`发送失败：${msg}`);
      if (userMsg && userMsg.text) {
        input.value = userMsg.text;
      }
      state.messages = state.messages.filter((m) => m.id !== userMsg.id);
      renderMessages();
    } finally {
      state.sending = false;
      syncSendButton();
    }
  }

  // ---------- 流式输出（SSE） ----------
  function ensureLiveBubble() {
    if (state.liveEl && state.liveEl.isConnected) return state.liveEl;
    // 首包前保留「深度求索中」，有文字后再撤
    setGenerating(true);
    const stream = $("chat-stream");
    const empty = document.getElementById("chat-empty");
    if (empty) empty.hidden = true;
    const wrap = document.createElement("div");
    wrap.className = "msg msg-ai msg-live";
    wrap.innerHTML = `<div class="live-head">${brandMarkHtml()}</div><div class="bubble"></div>`;
    stream.appendChild(wrap);
    state.liveEl = wrap;
    state.liveText = "";
    maybeScrollBottom(false);
    return wrap;
  }

  function appendLiveDelta(text) {
    if (!text) return;
    const wrap = ensureLiveBubble();
    stopThinkingRow();
    state.liveText += text;
    // 流式：纯文本；收口后再 Markdown
    wrap.querySelector(".bubble").textContent = state.liveText;
    maybeScrollBottom(false);
  }

  function finishLiveBubble() {
    if (state.liveEl && state.liveEl.isConnected) {
      // 收口：若已有最终历史则直接移除；否则转成正式 AI 消息
      const text = state.liveText;
      state.liveEl.remove();
      if (text) {
        const last = state.messages[state.messages.length - 1];
        if (!last || last.role !== "ai" || last.text !== text) {
          state.messages.push({ role: "ai", text, id: `live-${Date.now()}` });
          renderMessages();
        }
      }
    }
    state.liveEl = null;
    state.liveText = "";
    stopThinkingRow();
    setGenerating(false);
    flushQueuedWhenIdle().catch(() => {});
  }

  function stopLiveStream() {
    if (state.liveEs) {
      try { state.liveEs.close(); } catch { /* ignore */ }
      state.liveEs = null;
    }
  }

  function startLiveStream() {
    if (!state.sessionId || !state.token) return;
    stopLiveStream();
    const url = `${apiBase()}/m/sessions/${encodeURIComponent(state.sessionId)}/stream?token=${encodeURIComponent(state.token)}`;
    let es;
    try {
      es = new EventSource(url);
    } catch {
      return;
    }
    state.liveEs = es;
    es.addEventListener("delta", (e) => {
      try {
        const data = JSON.parse(e.data);
        appendLiveDelta(data.text || "");
      } catch { /* ignore */ }
    });
    es.addEventListener("stream-start", () => {
      // 开始流式：重置 live 文本，但保留「深度求索中」直到首包文字
      if (state.liveEl && state.liveEl.isConnected) {
        state.liveText = "";
        const b = state.liveEl.querySelector(".bubble");
        if (b) b.textContent = "";
      }
      setGenerating(true);
    });
    es.addEventListener("assistant-final", () => {
      finishLiveBubble();
      stopThinkingRow();
      setGenerating(false);
      loadHistory().catch(() => {});
      flushQueuedWhenIdle().catch(() => {});
    });
    es.addEventListener("user", () => {
      loadHistory().catch(() => {});
    });
    es.addEventListener("error", () => {
      // EventSource 自身错误或服务端 error 事件；依赖轮询兜底
    });
    es.onerror = () => {
      // 网络断开时浏览器会重连；我们保留句柄
    };
  }

  // ---------- 轮询同步（SSE 的兜底与历史对齐） ----------
  function startPolling() {
    stopPolling();
    state.pollTimer = setInterval(async () => {
      if (!state.sessionId) return;
      try {
        await loadHistory();
      } catch { /* ignore */ }
    }, 2000);
  }

  function stopPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  // ---------- UI 事件 ----------
  async function refreshSidebar() {
    let archived = new Set();
    try {
      const ws = await api("/m/workspaces");
      state.workspaces = (ws.value && ws.value.items) || [];
      for (const id of (ws.value && ws.value.archivedSessionIds) || []) archived.add(String(id));
    } catch {
      state.workspaces = [];
    }
    try {
      const list = await api("/m/sessions");
      const items = (list.value && list.value.items) || [];
      // archive 只是从工作区隐藏；session.list 仍会返回，这里按归档集过滤
      state.sessions = items.filter((s) => !archived.has(String(s.sessionId)));
    } catch (err) {
      if (err.status === 401) {
        logout("请重新配对");
        return;
      }
    }
    try {
      const home = await api("/m/home");
      state.home = (home.value && home.value.home) || "";
    } catch { /* ignore */ }
    renderSessions();
  }

  $("btn-sessions").addEventListener("click", async () => {
    $("drawer-sessions").hidden = false;
    await refreshSidebar();
  });
  $("btn-model").addEventListener("click", async () => {
    $("sheet-model").hidden = false;
    if (state.models) renderModelList();
    loadModels({ force: true }).then(() => renderModelList()).catch(() => {});
  });
  $("btn-more").addEventListener("click", () => { $("sheet-more").hidden = false; });

  async function createSession(opts = {}) {
    stopLiveStream();
    finishLiveBubble();
    stopThinkingRow();
    const created = await api("/m/sessions", {
      method: "POST",
      body: JSON.stringify({
        ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}),
        ...(opts.cwd ? { cwd: opts.cwd } : {}),
      }),
    });
    state.sessionId = created.value && created.value.sessionId;
    state.sessionTitle = "新会话";
    state.messages = [];
    persist();
    $("chat-title").textContent = "新会话";
    renderMessages();
    startLiveStream();
    closeDrawer("sessions");
    await refreshSidebar();
  }

  // 底部不再放「新会话」；侧栏保留
  const newSessionDrawer = $("btn-new-session-drawer");
  if (newSessionDrawer) {
    newSessionDrawer.addEventListener("click", async () => {
      try {
        await createSession();
      } catch (err) {
        setStatus(err.message || "新建会话失败");
      }
    });
  }
  $("btn-new-project").addEventListener("click", async () => {
    $("sheet-project").hidden = false;
    if (!state.home) {
      try {
        const home = await api("/m/home");
        state.home = (home.value && home.value.home) || "";
      } catch { /* ignore */ }
    }
    updateProjectPathHint();
  });
  $("project-name").addEventListener("input", updateProjectPathHint);
  $("btn-create-project").addEventListener("click", async () => {
    const name = $("project-name").value.trim();
    if (!name) {
      $("project-name").focus();
      return;
    }
    try {
      const created = await api("/m/workspaces", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      const workspace = created.value && created.value.workspace;
      $("sheet-project").hidden = true;
      $("project-name").value = "";
      await refreshSidebar();
      // 在新项目下建会话
      if (workspace && workspace.workspaceId) {
        await createSession({ workspaceId: workspace.workspaceId, cwd: workspace.path });
      }
    } catch (err) {
      setStatus(err.message || "新建项目失败");
    }
  });

  function updateProjectPathHint() {
    const name = $("project-name").value.trim();
    const el = $("project-path-hint");
    if (!name) {
      el.textContent = state.home ? `路径：${state.home}/<名称>` : "路径：用户目录/<名称>";
      return;
    }
    el.textContent = `路径：${state.home ? state.home + "/" : ""}${name}`;
  }

  $("btn-cancel-turn").addEventListener("click", async () => {
    closeSheet("more");
    await stopGenerate();
  });
  $("btn-refresh").addEventListener("click", async () => {
    closeSheet("more");
    await enterChat(false);
  });
  $("btn-disconnect").addEventListener("click", () => {
    closeSheet("more");
    logout();
  });

  $("btn-delete-session").addEventListener("click", async () => {
    const id = state.actionSessionId;
    closeSheet("session-actions");
    if (!id) return;
    if (!window.confirm("确定删除该会话？电脑端列表中将移除。")) return;
    try {
      await api(`/m/sessions/${encodeURIComponent(id)}/archive`, { method: "POST", body: "{}" });
      // 本地立刻去掉，避免 refresh 闪回
      state.sessions = state.sessions.filter((s) => String(s.sessionId) !== String(id));
      state.workspaces = state.workspaces.map((ws) => ({
        ...ws,
        sessionIds: (ws.sessionIds || []).filter((sid) => String(sid) !== String(id)),
      }));
      if (state.sessionId === id) {
        stopLiveStream();
        finishLiveBubble();
        stopThinkingRow();
        state.sessionId = null;
        state.messages = [];
        persist();
        renderMessages();
      }
      renderSessions();
      await refreshSidebar();
      setStatus("会话已删除");
    } catch (err) {
      setStatus(err.message || "删除失败");
    }
  });
  $("btn-rename-session").addEventListener("click", async () => {
    const id = state.actionSessionId;
    closeSheet("session-actions");
    if (!id) return;
    const title = window.prompt("新名称", state.sessionTitle || "");
    if (!title || !title.trim()) return;
    try {
      await api(`/m/sessions/${encodeURIComponent(id)}/rename`, {
        method: "POST",
        body: JSON.stringify({ title: title.trim() }),
      });
      if (state.sessionId === id) {
        state.sessionTitle = title.trim();
        $("chat-title").textContent = state.sessionTitle;
      }
      await refreshSidebar();
    } catch (err) {
      setStatus(err.message || "重命名失败");
    }
  });

  document.querySelectorAll("[data-close]").forEach((el) => {
    el.addEventListener("click", () => {
      const which = el.getAttribute("data-close");
      if (which === "sessions") closeDrawer("sessions");
      if (which === "model") closeSheet("model");
      if (which === "more") closeSheet("more");
      if (which === "project") closeSheet("project");
      if (which === "session-actions") closeSheet("session-actions");
    });
  });

  function closeDrawer(name) {
    if (name === "sessions") $("drawer-sessions").hidden = true;
  }
  function closeSheet(name) {
    if (name === "model") $("sheet-model").hidden = true;
    if (name === "more") $("sheet-more").hidden = true;
    if (name === "project") $("sheet-project").hidden = true;
    if (name === "session-actions") $("sheet-session-actions").hidden = true;
  }

  function enterSelectMode(initialId) {
    state.selectMode = true;
    state.selectedIds = new Set(initialId ? [initialId] : []);
    $("select-bar").hidden = false;
    $("drawer-actions").hidden = true;
    $("btn-select-mode").hidden = true;
    $("btn-select-cancel").hidden = false;
    $("drawer-title").textContent = `已选 ${state.selectedIds.size}`;
    renderSessions();
  }

  function exitSelectMode() {
    state.selectMode = false;
    state.selectedIds = new Set();
    $("select-bar").hidden = true;
    $("drawer-actions").hidden = false;
    $("btn-select-mode").hidden = false;
    $("btn-select-cancel").hidden = true;
    $("drawer-title").textContent = "会话与项目";
    renderSessions();
  }

  $("btn-select-mode").addEventListener("click", () => enterSelectMode());
  $("btn-select-cancel").addEventListener("click", () => exitSelectMode());
  $("btn-select-all").addEventListener("click", () => {
    const ids = state.sessions.map((s) => s.sessionId);
    if (state.selectedIds.size >= ids.length) state.selectedIds = new Set();
    else state.selectedIds = new Set(ids);
    $("drawer-title").textContent = `已选 ${state.selectedIds.size}`;
    renderSessions();
  });
  $("btn-batch-delete").addEventListener("click", async () => {
    const ids = [...state.selectedIds];
    if (!ids.length) return;
    if (!window.confirm(`确定删除选中的 ${ids.length} 个会话？`)) return;
    setStatus(`正在删除 ${ids.length} 个会话…`);
    let ok = 0;
    let fail = 0;
    const done = new Set();
    for (const id of ids) {
      try {
        await api(`/m/sessions/${encodeURIComponent(id)}/archive`, { method: "POST", body: "{}" });
        ok++;
        done.add(String(id));
        if (state.sessionId === id) {
          stopLiveStream();
          finishLiveBubble();
          stopThinkingRow();
          state.sessionId = null;
          state.messages = [];
          persist();
          renderMessages();
        }
      } catch {
        fail++;
      }
    }
    state.sessions = state.sessions.filter((s) => !done.has(String(s.sessionId)));
    exitSelectMode();
    renderSessions();
    await refreshSidebar();
    setStatus(fail ? `已删除 ${ok} 个，失败 ${fail} 个` : `已删除 ${ok} 个会话`);
  });

  function sessionRow(session) {
    const btn = document.createElement("button");
    btn.type = "button";
    const selected = state.selectedIds.has(session.sessionId);
    btn.className =
      "session-item" +
      (session.sessionId === state.sessionId ? " on" : "") +
      (selected ? " selected" : "") +
      (state.selectMode ? " select-mode" : "");
    const t = document.createElement("div");
    t.className = "t";
    const titleWrap = document.createElement("div");
    titleWrap.className = "t-row";
    if (state.selectMode) {
      const box = document.createElement("span");
      box.className = "check" + (selected ? " on" : "");
      box.textContent = selected ? "✓" : "";
      titleWrap.appendChild(box);
    }
    const nameEl = document.createElement("span");
    nameEl.className = "t-name";
    nameEl.textContent = titleOf(session);
    titleWrap.appendChild(nameEl);
    if (session.running) {
      const spin = document.createElement("span");
      spin.className = "ds-run-mark spin";
      spin.innerHTML = "<i></i><i></i><i></i><i></i>";
      titleWrap.appendChild(spin);
    }
    t.appendChild(titleWrap);
    const meta = document.createElement("div");
    meta.className = "s";
    const when = session.updatedAt ? new Date(session.updatedAt).toLocaleString() : "";
    meta.textContent = [session.running ? "运行中" : "", session.blank ? "空白" : "", when].filter(Boolean).join(" · ");
    btn.appendChild(t);
    btn.appendChild(meta);

    const openActions = () => {
      if (state.selectMode) return;
      state.actionSessionId = session.sessionId;
      $("session-actions-title").textContent = titleOf(session);
      $("sheet-session-actions").hidden = false;
    };

    btn.addEventListener("click", () => {
      if (state.selectMode) {
        if (state.selectedIds.has(session.sessionId)) state.selectedIds.delete(session.sessionId);
        else state.selectedIds.add(session.sessionId);
        $("drawer-title").textContent = `已选 ${state.selectedIds.size}`;
        renderSessions();
        return;
      }
      openSession(session.sessionId);
    });

    let pressTimer = null;
    const startPress = () => {
      pressTimer = setTimeout(() => {
        pressTimer = null;
        if (!state.selectMode) enterSelectMode(session.sessionId);
        else openActions();
      }, 500);
    };
    const cancelPress = () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    };
    btn.addEventListener("touchstart", startPress, { passive: true });
    btn.addEventListener("touchend", cancelPress);
    btn.addEventListener("touchmove", cancelPress, { passive: true });
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (!state.selectMode) enterSelectMode(session.sessionId);
      else openActions();
    });
    btn.addEventListener("dblclick", openActions);
    return btn;
  }

  function renderSessions() {
    const box = $("session-list");
    box.innerHTML = "";

    const projectHead = document.createElement("div");
    projectHead.className = "model-group";
    projectHead.textContent = "项目";
    box.appendChild(projectHead);
    if (state.workspaces.length === 0) {
      const empty = document.createElement("div");
      empty.className = "session-empty";
      empty.textContent = "暂无项目，点上方「新建项目」";
      box.appendChild(empty);
    }
    const sessionById = new Map(state.sessions.map((s) => [s.sessionId, s]));
    const used = new Set();
    for (const ws of state.workspaces) {
      const head = document.createElement("button");
      head.type = "button";
      head.className = "project-item";
      head.innerHTML = `<span class="project-icon">▣</span><span class="project-title"></span>`;
      head.querySelector(".project-title").textContent = ws.title || ws.path || "项目";
      head.addEventListener("click", () => {
        if (state.selectMode) return;
        createSession({ workspaceId: ws.workspaceId, cwd: ws.path }).catch((err) => {
          setStatus(err.message || "新建会话失败");
        });
      });
      box.appendChild(head);
      for (const sid of ws.sessionIds || []) {
        const s = sessionById.get(sid);
        if (!s) continue;
        used.add(sid);
        box.appendChild(sessionRow(s));
      }
    }

    const recentHead = document.createElement("div");
    recentHead.className = "model-group";
    recentHead.textContent = "最近";
    box.appendChild(recentHead);
    const rest = state.sessions.filter((s) => !used.has(s.sessionId));
    if (rest.length === 0 && state.workspaces.length === 0) {
      const empty2 = document.createElement("div");
      empty2.className = "session-empty";
      empty2.textContent = "暂无会话";
      box.appendChild(empty2);
    } else {
      for (const s of rest) box.appendChild(sessionRow(s));
    }
  }

  // ---------- 启动 ----------
  syncSendButton();
  function parsePairFromUrl() {
    try {
      const url = new URL(location.href);
      const pair = url.searchParams.get("pair") || "";
      const hostParam = url.searchParams.get("host") || "";
      const host = hostParam || `${url.protocol}//${url.host}`;
      // 清理地址栏，避免配对码残留
      if (url.searchParams.has("pair") || url.searchParams.has("host")) {
        url.searchParams.delete("pair");
        url.searchParams.delete("host");
        history.replaceState(null, "", url.pathname + url.search + url.hash);
      }
      return { host, pair: pair.trim() };
    } catch {
      return { host: "", pair: "" };
    }
  }

  async function tryAutoPair(pair) {
    if (!pair || !/^\d{6}$/.test(pair)) return false;
    $("pair-host").value = state.host || guessHostFromPage();
    $("pair-code").value = pair;
    $("pair-name").value = $("pair-name").value || "手机";
    $("pair-error").hidden = true;
    const btn = $("pair-submit");
    btn.disabled = true;
    btn.textContent = "扫码连接中…";
    try {
      const host = (state.host || guessHostFromPage()).replace(/\/+$/, "");
      const res = await fetch(`${host}/m/pair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: pair,
          deviceName: $("pair-name").value.trim() || "手机",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "配对失败");
      state.host = host;
      state.token = body.token;
      state.device = body.device;
      persist();
      await enterChat(true);
      return true;
    } catch (err) {
      $("pair-error").hidden = false;
      $("pair-error").textContent = (err && err.message) || "扫码配对失败，请手动输入";
      return false;
    } finally {
      btn.disabled = false;
      btn.textContent = "连接电脑";
    }
  }

  async function boot() {
    const fromQr = parsePairFromUrl();
    if (fromQr.host) state.host = fromQr.host;
    $("pair-host").value = state.host || guessHostFromPage();
    // 扫码：即使已有 token 也重新配对（配对码一次性，扫了就换新设备 token）
    if (fromQr.pair) {
      showView("pair");
      const ok = await tryAutoPair(fromQr.pair);
      if (!ok && state.token && state.host) {
        // 配对失败但本地仍有旧凭证时，仍尝试进入聊天
        enterChat(false);
      }
      return;
    }
    if (state.token && state.host) {
      enterChat(false);
    } else {
      showView("pair");
    }
  }

  boot();
})();
