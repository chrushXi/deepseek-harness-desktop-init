"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const { listLanIPv4, primaryLanIPv4 } = require("./lan");
const { generatePairCode, DeviceRegistry } = require("./auth");
const { DshClient } = require("./dsh-client");
const { DshFollowStream, fetchWorkspaceBaseline } = require("./dsh-stream");
const os = require("node:os");

const STATIC_DIR = path.join(__dirname, "static");
const DEFAULT_PORT = 17890;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

/**
 * Mobile Bridge：局域网入口 + 配对鉴权 + 转发 dsh session RPC。
 * 仅本地模式：监听 0.0.0.0，手机用 Bearer 设备 token 访问 /m/*。
 */
class MobileBridge {
  /**
   * @param {object} options
   * @param {(line: string) => void} [options.log]
   * @param {(status: object) => void} [options.onStatus]
   */
  constructor(options = {}) {
    this.log = options.log || (() => {});
    this.onStatus = options.onStatus || (() => {});
    this.server = null;
    this.port = DEFAULT_PORT;
    this.enabled = false;
    this.mode = "lan";
    this.pairCode = generatePairCode();
    this.pairCodeIssuedAt = Date.now();
    this.devices = new DeviceRegistry();
    this.dsh = new DshClient();
    this.dshUrl = null;
  }

  get running() {
    return Boolean(this.server);
  }

  publicStatus() {
    const lan = listLanIPv4();
    return {
      enabled: this.enabled,
      mode: this.mode,
      running: this.running,
      port: this.port,
      pairCode: this.pairCode,
      pairCodeIssuedAt: this.pairCodeIssuedAt,
      lanAddresses: lan.map((item) => ({
        iface: item.iface,
        address: item.address,
        url: `http://${item.address}:${this.port}/`,
      })),
      primaryUrl: primaryLanIPv4()
        ? `http://${primaryLanIPv4()}:${this.port}/`
        : null,
      dsh: this.dsh.status(),
      devices: this.devices.list(),
    };
  }

  notify() {
    try {
      this.onStatus(this.publicStatus());
    } catch { /* ignore */ }
  }

  refreshPairCode() {
    this.pairCode = generatePairCode();
    this.pairCodeIssuedAt = Date.now();
    this.notify();
    return this.pairCode;
  }

  /** dsh 服务就绪后注入启动 URL（可含 launch token）。 */
  async attachDsh(url) {
    this.dshUrl = url;
    await this.dsh.connectFromUrl(url);
    this.log(`mobile-bridge: dsh attached ${this.dsh.baseUrl} connected=${this.dsh.connected}`);
    this.notify();
    return this.dsh.status();
  }

  async start(port = DEFAULT_PORT) {
    if (this.server) return this.publicStatus();
    this.port = Number(port) || DEFAULT_PORT;
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        this.log(`mobile-bridge: request error ${err && err.message}`);
        if (!res.headersSent) sendJson(res, 500, { error: "internal_error" });
      });
    });
    this.server.on("upgrade", (req, socket) => {
      // P3：WebSocket 事件流；P1 先拒绝，避免半开连接
      socket.destroy();
    });
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, "0.0.0.0", () => {
        this.server.removeListener("error", reject);
        resolve();
      });
    });
    this.enabled = true;
    this.log(`mobile-bridge: listening on 0.0.0.0:${this.port}`);
    this.notify();
    return this.publicStatus();
  }

  async stop() {
    if (!this.server) {
      this.enabled = false;
      this.notify();
      return this.publicStatus();
    }
    const server = this.server;
    this.server = null;
    await new Promise((resolve) => {
      server.close(() => resolve());
      setTimeout(resolve, 1500);
    });
    this.enabled = false;
    this.log("mobile-bridge: stopped");
    this.notify();
    return this.publicStatus();
  }

  async handle(req, res) {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === "/health") {
      return sendJson(res, 200, { ok: true, ...this.publicStatus() });
    }

    if (pathname === "/m/pair" && req.method === "POST") {
      return this.handlePair(req, res);
    }

    if (pathname.startsWith("/m/")) {
      const device = this.authenticate(req);
      if (!device) {
        return sendJson(res, 401, { error: "unauthorized", message: "请先配对" });
      }
      return this.handleMobileApi(req, res, pathname, url, device);
    }

    return this.serveStatic(pathname, res);
  }

  authenticate(req) {
    const header = req.headers.authorization || "";
    const m = /^Bearer\s+(.+)$/i.exec(header);
    if (m) return this.devices.verify(m[1].trim());
    // SSE EventSource 无法带 Authorization，支持 ?token=
    try {
      const url = new URL(req.url || "/", "http://localhost");
      const q = url.searchParams.get("token");
      if (q) return this.devices.verify(q.trim());
    } catch { /* ignore */ }
    return null;
  }

  /** SSE：把 session/follow 的文本增量推给手机。 */
  async handleSseStream(req, res, sessionId) {
    if (!this.dsh.connected && this.dshUrl) {
      try { await this.dsh.connectFromUrl(this.dshUrl); } catch { /* ignore */ }
    }
    if (!this.dsh.connected || !this.dsh.baseUrl) {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      res.end("dsh unavailable");
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
    });
    res.write(`retry: 2000\n\n`);
    const write = (event, data) => {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch { /* ignore */ }
    };
    write("open", { sessionId });
    const stream = new DshFollowStream({
      baseUrl: this.dsh.baseUrl,
      cookie: this.dsh.cookie,
      sessionId,
      onEvent: (evt) => write(evt.kind || "event", evt),
    });
    const cleanup = () => {
      try { stream.close(); } catch { /* ignore */ }
    };
    req.on("close", cleanup);
    req.on("error", cleanup);
    res.on("close", cleanup);
    try {
      await stream.start();
    } catch (err) {
      write("error", { message: (err && err.message) || "流式连接失败" });
      cleanup();
      try { res.end(); } catch { /* ignore */ }
    }
  }

  async handlePair(req, res) {
    const body = await readJson(req);
    const code = String(body && body.code ? body.code : "").trim();
    const deviceName = String(body && body.deviceName ? body.deviceName : "手机");
    if (!code || code !== this.pairCode) {
      return sendJson(res, 400, {
        error: "bad_pair_code",
        message: "配对码不正确或已过期",
      });
    }
    if (!this.dsh.connected) {
      // 允许配对，但状态里会提示 dsh 未就绪
      this.log("mobile-bridge: pair while dsh disconnected");
    }
    const { device, token } = this.devices.register(deviceName);
    this.pairCode = generatePairCode();
    this.pairCodeIssuedAt = Date.now();
    this.log(`mobile-bridge: paired device ${device.id} (${device.name})`);
    this.notify();
    return sendJson(res, 200, {
      ok: true,
      token,
      device,
      baseUrl: "/",
      apiBase: "/m",
      status: this.publicStatus(),
    });
  }

  async handleMobileApi(req, res, pathname, url, device) {
    if (!pathname.startsWith("/m/")) return sendJson(res, 404, { error: "not_found" });
    const rest = pathname.slice(3);
    const method = req.method || "GET";

    if (rest === "status" && method === "GET") {
      return sendJson(res, 200, this.publicStatus());
    }

    // SSE 流式：GET /m/sessions/:id/stream?token= 或 Authorization
    if (method === "GET" && /^sessions\/([^/]+)\/stream$/.test(rest)) {
      const sessionId = decodeURIComponent(/^sessions\/([^/]+)\/stream$/.exec(rest)[1]);
      return this.handleSseStream(req, res, sessionId);
    }

    if (rest === "sessions" && method === "GET") {
      return this.proxyDsh(res, () => this.dsh.call("session/list", { _request: {} }));
    }

    if (rest === "sessions" && method === "POST") {
      const body = await readJson(req);
      return this.proxyDsh(res, () =>
        this.dsh.call("session/create", {
          request: {
            ...(body && body.cwd ? { cwd: String(body.cwd) } : {}),
            ...(body && body.workspaceId ? { workspaceId: String(body.workspaceId) } : {}),
            ...(body && body.agentPreset ? { agentPreset: String(body.agentPreset) } : {}),
          },
        })
      );
    }

    if (rest === "models" && method === "GET") {
      return this.proxyDsh(res, () => this.dsh.call("session/modelCatalog", {}));
    }

    if (rest === "home" && method === "GET") {
      return sendJson(res, 200, { ok: true, value: { home: os.homedir() } });
    }

    // 项目（workspace）
    if (rest === "workspaces" && method === "GET") {
      return this.proxyDsh(res, async () => {
        return fetchWorkspaceBaseline(this.dsh.baseUrl, this.dsh.cookie);
      });
    }
    if (rest === "workspaces" && method === "POST") {
      const body = await readJson(req);
      let wsPath = String((body && body.path) || "").trim();
      const name = String((body && body.name) || "").trim();
      if (!wsPath && name) {
        // 默认在用户目录下建项目文件夹
        wsPath = require("node:path").join(os.homedir(), name);
      }
      if (!wsPath) return sendJson(res, 400, { error: "missing_path", message: "请提供项目路径或名称" });
      return this.proxyDsh(res, () =>
        this.dsh.call("workspace/create", { request: { path: wsPath } })
      );
    }
    const wsDelete = /^workspaces\/([^/]+)$/.exec(rest);
    if (wsDelete && method === "DELETE") {
      const workspaceId = decodeURIComponent(wsDelete[1]);
      return this.proxyDsh(res, () =>
        this.dsh.call("workspace/delete", { request: { workspaceId } })
      );
    }
    const wsRename = /^workspaces\/([^/]+)\/rename$/.exec(rest);
    if (wsRename && method === "POST") {
      const workspaceId = decodeURIComponent(wsRename[1]);
      const body = await readJson(req);
      return this.proxyDsh(res, () =>
        this.dsh.call("workspace/rename", {
          request: { workspaceId, title: String((body && body.title) || "").trim() || "未命名项目" },
        })
      );
    }

    const sessionMatch = /^sessions\/([^/]+)(?:\/(history|page|prompt|model|cancel|rename|archive))?$/.exec(rest);
    if (sessionMatch) {
      const sessionId = decodeURIComponent(sessionMatch[1]);
      const action = sessionMatch[2] || "";
      if (!action && method === "GET") {
        return this.readHistory(res, sessionId, url);
      }
      if ((action === "history" || action === "page") && method === "GET") {
        return this.readHistory(res, sessionId, url);
      }
      if (action === "prompt" && method === "POST") {
        const body = await readJson(req);
        const text = String(body && body.text != null ? body.text : "").trim();
        if (!text) return sendJson(res, 400, { error: "empty_prompt" });
        const requestId = String(
          (body && body.requestId) ||
          `mobile-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
        );
        return this.proxyDsh(res, () =>
          this.dsh.call("session/prompt", {
            request: {
              requestId,
              sessionId,
              mode: body.mode === "steer" ? "steer" : "queue",
              content: [{ type: "text", text }],
              ...(body.clientTimeZone ? { clientTimeZone: String(body.clientTimeZone) } : {}),
            },
          })
        );
      }
      if (action === "model" && method === "POST") {
        const body = await readJson(req);
        return this.proxyDsh(res, () =>
          this.dsh.call("session/selectModel", {
            request: {
              sessionId,
              provider: String((body && body.provider) || ""),
              model: String((body && body.model) || ""),
              ...(body && body.reasoningEffort
                ? { reasoningEffort: String(body.reasoningEffort) }
                : {}),
            },
          })
        );
      }
      if (action === "cancel" && method === "POST") {
        return this.proxyDsh(res, () =>
          this.dsh.call("session/cancel", { request: { sessionId } })
        );
      }
      if (action === "rename" && method === "POST") {
        const body = await readJson(req);
        return this.proxyDsh(res, () =>
          this.dsh.call("session/rename", {
            request: {
              sessionId,
              title: String((body && body.title) || "").trim() || "未命名会话",
            },
          })
        );
      }
      if (action === "archive" && method === "POST") {
        // 删除/归档会话（与电脑端一致：从列表移除）
        return this.proxyDsh(res, () =>
          this.dsh.call("workspace/archiveSession", { request: { sessionId } })
        );
      }
    }

    return sendJson(res, 404, { error: "not_found", path: pathname });
  }

  /** 读会话历史：先用 list 拿 throughSeq，再 session/page。 */
  async readHistory(res, sessionId, url) {
    const maxMessages = Number(url.searchParams.get("maxMessages") || 80);
    return this.proxyDsh(res, async () => {
      const list = await this.dsh.call("session/list", { _request: {} });
      const items = (list && list.items) || [];
      const row = items.find((s) => s.sessionId === sessionId) || null;
      const asOf = row && row.projections ? row.projections.asOfSeq : undefined;
      // 空会话 throughSeq=-1；有日志用 list 投影 asOfSeq
      const throughSeq = typeof asOf === "number" && asOf >= 0 ? asOf : -1;
      return this.dsh.call("session/page", {
        request: {
          address: { kind: "session", sessionId },
          throughSeq,
          ...(Number.isFinite(maxMessages) && maxMessages > 0 ? { maxMessages } : {}),
        },
      });
    });
  }

  async proxyDsh(res, fn) {
    if (!this.dsh.connected && this.dshUrl) {
      try {
        await this.dsh.connectFromUrl(this.dshUrl);
        this.log(`mobile-bridge: dsh reconnected ${this.dsh.baseUrl}`);
        this.notify();
      } catch (err) {
        this.log(`mobile-bridge: dsh reconnect failed: ${err && err.message}`);
      }
    }
    if (!this.dsh.connected) {
      const detail = this.dsh.lastError || (this.dshUrl ? "连接失败" : "尚未获取电脑端服务地址");
      return sendJson(res, 503, {
        error: "dsh_unavailable",
        message: `电脑端 Harness 服务未就绪：${detail}`,
        dshUrl: this.dshUrl ? this.dsh.baseUrl : null,
        dsh: this.dsh.status(),
      });
    }
    try {
      const value = await fn();
      return sendJson(res, 200, { ok: true, value });
    } catch (err) {
      // 401：标记断开，下次请求会重连
      if (/失效|401|握手/.test(String(err && err.message))) {
        this.dsh.connected = false;
      }
      const status = /失效|401/.test(String(err && err.message)) ? 401 : 502;
      return sendJson(res, status, {
        error: "dsh_error",
        message: err && err.message ? err.message : String(err),
        code: err && err.code,
      });
    }
  }

  serveStatic(pathname, res) {
    let rel = pathname === "/" ? "/index.html" : pathname;
    if (rel.includes("..")) return sendJson(res, 400, { error: "bad_path" });
    const file = path.normalize(path.join(STATIC_DIR, rel));
    if (!file.startsWith(STATIC_DIR)) return sendJson(res, 400, { error: "bad_path" });
    fs.readFile(file, (err, buf) => {
      if (err) {
        // SPA 回退
        fs.readFile(path.join(STATIC_DIR, "index.html"), (err2, html) => {
          if (err2) return sendJson(res, 404, { error: "not_found" });
          res.writeHead(200, { "content-type": MIME[".html"] });
          res.end(html);
        });
        return;
      }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        "content-type": MIME[ext] || "application/octet-stream",
        "cache-control": ext === ".html" ? "no-cache" : "public, max-age=300",
      });
      res.end(buf);
    });
  }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "access-control-allow-origin": "*",
  });
  res.end(body);
}

function readJson(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve(null);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve(null);
      }
    });
    req.on("error", reject);
  });
}

module.exports = { MobileBridge, DEFAULT_PORT };
