"use strict";

const path = require("node:path");
const { randomUUID } = require("node:crypto");

/**
 * dsh Remote stream 客户端：连 /api/remote.mux，打开 session/follow。
 * 用于把 assistant 文本增量推给手机端。
 */
function loadWsModule() {
  if (process.env.DSH_MOBILE_WS_PATH) {
    try {
      return require(process.env.DSH_MOBILE_WS_PATH);
    } catch { /* fallthrough */ }
  }
  const candidates = [];
  try {
    // 桌面托管运行时（由 main 注入）
    if (process.env.DSH_RUNTIME_DIR) {
      candidates.push(path.join(process.env.DSH_RUNTIME_DIR, "node_modules", "ws"));
    }
  } catch { /* ignore */ }
  // 常见 userData 路径兜底
  try {
    const { app } = require("electron");
    candidates.push(path.join(app.getPath("userData"), "dsh-runtime", "node_modules", "ws"));
  } catch { /* not in electron */ }
  for (const c of candidates) {
    try {
      return require(c);
    } catch { /* next */ }
  }
  try {
    return require("ws");
  } catch {
    return null;
  }
}

function textFromChunk(chunk) {
  if (chunk == null) return "";
  if (typeof chunk === "string") return chunk;
  if (typeof chunk !== "object") return "";
  if (chunk.type === "text-delta" && typeof chunk.text === "string") return chunk.text;
  if (chunk.type === "reasoning-delta" && typeof chunk.text === "string") return "";
  if (chunk.type === "text" && typeof chunk.text === "string") return chunk.text;
  if (typeof chunk.text === "string" && !chunk.type) return chunk.text;
  if (typeof chunk.delta === "string") return chunk.delta;
  if (Array.isArray(chunk.content)) {
    return chunk.content
      .map((p) => (p && p.type === "text" && typeof p.text === "string" ? p.text : ""))
      .filter(Boolean)
      .join("");
  }
  return "";
}

/**
 * 跟随一个会话，把流式事件回调出去。
 * @param {object} options
 * @param {string} options.baseUrl http://127.0.0.1:port
 * @param {string|null} options.cookie
 * @param {string} options.sessionId
 * @param {(evt: object) => void} options.onEvent
 */
class DshFollowStream {
  constructor(options) {
    this.baseUrl = options.baseUrl;
    this.cookie = options.cookie || null;
    this.sessionId = options.sessionId;
    this.onEvent = options.onEvent || (() => {});
    this.socket = null;
    this.streamId = null;
    this.closed = false;
    this.liveText = "";
  }

  get wsUrl() {
    const u = new URL("/api/remote.mux", this.baseUrl);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    return u.href;
  }

  async start() {
    const WebSocket = loadWsModule();
    if (!WebSocket) throw new Error("缺少 WebSocket 模块，无法建立流式连接");
    if (this.closed) return;
    this.streamId = randomUUID();
    const headers = {};
    if (this.cookie) headers.cookie = this.cookie;
    await new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.wsUrl, {
        headers,
        handshakeTimeout: 8000,
      });
      this.socket = ws;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch { /* ignore */ }
        reject(err);
      };
      ws.once("open", () => {
        settled = true;
        resolve();
      });
      ws.once("error", (err) => fail(err || new Error("mux WebSocket 错误")));
      ws.once("unexpected-response", () => fail(new Error("mux WebSocket 握手被拒绝")));
      ws.on("message", (data) => this._onMessage(String(data)));
      ws.on("close", () => {
        this.closed = true;
      });
    });
    if (this.closed) throw new Error("mux WebSocket 已关闭");
    // 打开 session/follow
    this._send({
      type: "open",
      streamId: this.streamId,
      endpoint: "session/follow",
      payload: {
        args: {
          request: {
            address: { kind: "session", sessionId: this.sessionId },
            assistantStream: true,
            maxMessages: 1,
          },
        },
      },
    });
  }

  _send(obj) {
    if (!this.socket || this.socket.readyState !== 1) return;
    this.socket.send(JSON.stringify(obj));
  }

  _onMessage(text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (!msg || msg.streamId !== this.streamId) return;
    if (msg.type === "item") {
      this._onItem(msg.value);
      return;
    }
    if (msg.type === "end") {
      this.closed = true;
      try { this.socket && this.socket.close(); } catch { /* ignore */ }
      return;
    }
    if (msg.type === "error") {
      this.onEvent({
        kind: "error",
        message: (msg.error && msg.error.message) || "流式连接错误",
      });
    }
  }

  _onItem(value) {
    if (!value || typeof value !== "object") return;
    // snapshot：可带已有 assistantStream
    if (value.type === "snapshot") {
      const as = value.assistantStream;
      if (as && as.activeAttempt && Array.isArray(as.activeAttempt.stream)) {
        for (const rec of as.activeAttempt.stream) {
          const chunk = rec && rec.chunk != null ? rec.chunk : rec;
          const t = textFromChunk(chunk);
          if (t) {
            this.liveText += t;
            this.onEvent({ kind: "delta", text: t, full: this.liveText });
          }
        }
      }
      this.onEvent({ kind: "snapshot", cursor: value.cursor });
      return;
    }
    if (value.type === "event" && value.event) {
      const ev = value.event;
      if (ev.type === "user/message") {
        this.liveText = "";
        this.onEvent({ kind: "user", event: ev });
        return;
      }
      if (ev.type === "assistant/message") {
        this.liveText = "";
        this.onEvent({ kind: "assistant-final", event: ev });
        return;
      }
      if (ev.type === "assistant/live-chunk") {
        const t = textFromChunk(ev.data && ev.data.chunk);
        if (t) {
          this.liveText += t;
          this.onEvent({ kind: "delta", text: t, full: this.liveText });
        }
        return;
      }
      this.onEvent({ kind: "event", event: ev });
      return;
    }
    if (value.type === "assistant-stream" && value.frame) {
      const frame = value.frame;
      if (frame.type === "start") {
        this.liveText = "";
        this.onEvent({ kind: "stream-start", attemptId: frame.attemptId });
        return;
      }
      if (frame.type === "chunk") {
        const t = textFromChunk(frame.chunk);
        if (t) {
          this.liveText += t;
          this.onEvent({ kind: "delta", text: t, full: this.liveText });
        }
        return;
      }
      if (frame.type === "end") {
        this.onEvent({ kind: "stream-end", outcome: frame.outcome });
        return;
      }
    }
  }

  close() {
    this.closed = true;
    this.streamId = null;
    try {
      if (this.socket) {
        this.socket.removeAllListeners();
        this.socket.close();
      }
    } catch { /* ignore */ }
    this.socket = null;
  }
}

/**
 * 一次性拉取 workspace/follow 的 baseline（项目列表）。
 */
async function fetchWorkspaceBaseline(baseUrl, cookie, timeoutMs = 5000) {
  const WebSocket = loadWsModule();
  if (!WebSocket) throw new Error("缺少 WebSocket 模块");
  const u = new URL("/api/remote.mux", baseUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  const headers = cookie ? { cookie } : {};
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(u.href, { headers, handshakeTimeout: timeoutMs });
    const streamId = randomUUID();
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* ignore */ }
      if (err) reject(err);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error("读取项目列表超时")), timeoutMs);
    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "open",
        streamId,
        endpoint: "workspace/follow",
        payload: { args: {} },
      }));
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      finish(err || new Error("workspace/follow 连接失败"));
    });
    ws.on("message", (data) => {
      let msg;
      try { msg = JSON.parse(String(data)); } catch { return; }
      if (!msg || msg.streamId !== streamId) return;
      if (msg.type === "item" && msg.value && msg.value.type === "baseline") {
        clearTimeout(timer);
        finish(null, {
          items: msg.value.items || [],
          archivedSessionIds: msg.value.archivedSessionIds || [],
        });
        return;
      }
      if (msg.type === "error") {
        clearTimeout(timer);
        finish(new Error((msg.error && msg.error.message) || "workspace/follow 失败"));
        return;
      }
      if (msg.type === "end") {
        clearTimeout(timer);
        finish(new Error("workspace/follow 未返回 baseline"));
      }
    });
    ws.on("close", () => {
      clearTimeout(timer);
      if (!settled) finish(new Error("workspace/follow 已关闭"));
    });
  });
}

module.exports = { DshFollowStream, textFromChunk, loadWsModule, fetchWorkspaceBaseline };
