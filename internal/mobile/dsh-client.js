"use strict";

const { randomUUID } = require("node:crypto");

/**
 * dsh 0.1.5+ Typert Connection RPC 客户端。
 *
 * POST /api/<ns>/<method>
 * body = { type: "client-request", rpcId, method, payload: { args: { <param>: value } } }
 *
 * 参数名以 typert.host 声明为准：
 *   session/list → args._request
 *   session/page|prompt|create|... → args.request
 *   session/modelCatalog → args（空）
 *
 * 鉴权：GET /?token= 换 cookie。
 */
class DshClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || null;
    this.launchToken = options.launchToken || null;
    this.cookie = null;
    this.connected = false;
    this.lastError = null;
    this._handshaking = null;
  }

  async connectFromUrl(url) {
    if (!url) throw new Error("缺少 dsh 服务地址");
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("dsh 服务地址无效");
    }
    this.baseUrl = `${parsed.protocol}//${parsed.host}`;
    this.launchToken = parsed.searchParams.get("token");
    this.cookie = null;
    this.connected = false;
    await this.handshake();
    return this.status();
  }

  handshake() {
    if (this._handshaking) return this._handshaking;
    this._handshaking = this._doHandshake().finally(() => {
      this._handshaking = null;
    });
    return this._handshaking;
  }

  async _doHandshake() {
    if (!this.baseUrl) throw new Error("尚未设置 dsh 地址");
    // 优先无 token 直连（环回）；避免抢先消费一次性 launch token 导致桌面 UI 鉴权失败
    try {
      await this.call("session/list", { _request: {} });
      this.connected = true;
      this.lastError = null;
      return true;
    } catch (err) {
      this.lastError = err && err.message ? err.message : String(err);
    }
    // 再尝试带 token 换 cookie（此时桌面页面通常已加载完成）
    if (this.launchToken) {
      try {
        const res = await fetch(`${this.baseUrl}/?token=${encodeURIComponent(this.launchToken)}`, {
          redirect: "manual",
          headers: { accept: "text/html,application/json" },
        });
        const cookie = pickSessionCookie(collectSetCookie(res.headers));
        if (cookie) this.cookie = cookie;
      } catch { /* ignore */ }
      try {
        await this.call("session/list", { _request: {} });
        this.connected = true;
        this.lastError = null;
        return true;
      } catch (err) {
        this.connected = false;
        this.lastError = err && err.message ? err.message : String(err);
        throw new Error(`dsh 握手失败：${this.lastError}`);
      }
    }
    this.connected = false;
    throw new Error(`dsh 握手失败：${this.lastError || "无法连接"}`);
  }

  /**
   * @param {string} endpoint 形如 `session/list`
   * @param {object} args 方法参数（会包成 payload.args）
   */
  async call(endpoint, args = {}) {
    if (!this.baseUrl) throw new Error("dsh 未连接");
    if (!/^[A-Za-z0-9_$.-]+\/[A-Za-z0-9_$.-]+$/.test(endpoint)) {
      throw new Error(`非法 RPC 端点：${endpoint}`);
    }
    const rpcId = randomUUID();
    const body = JSON.stringify({
      type: "client-request",
      rpcId,
      method: endpoint,
      payload: { args: args && typeof args === "object" ? args : {} },
    });

    let res = await this._post(`${this.baseUrl}/api/${endpoint}`, body);
    if (res.status === 401) {
      this.cookie = null;
      if (this.launchToken) {
        try {
          const hs = await fetch(`${this.baseUrl}/?token=${encodeURIComponent(this.launchToken)}`, {
            redirect: "manual",
            headers: { accept: "text/html,application/json" },
          });
          const cookie = pickSessionCookie(collectSetCookie(hs.headers));
          if (cookie) this.cookie = cookie;
        } catch { /* ignore */ }
        res = await this._post(`${this.baseUrl}/api/${endpoint}`, body);
      }
    }
    if (res.status === 401) {
      this.connected = false;
      throw new Error("dsh 会话已失效，请重启桌面端服务");
    }
    if (res.status === 403) {
      this.connected = false;
      throw new Error("dsh 拒绝了该请求（Host 信任检查失败）");
    }
    if (res.status === 404) {
      throw new Error(`dsh 无此接口：${endpoint}`);
    }
    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`dsh 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 160)}`);
    }
    const result = parsed && parsed.result;
    if (!result || typeof result !== "object") {
      throw new Error(`dsh 响应格式异常：${text.slice(0, 160)}`);
    }
    if (result.ok === true) {
      this.connected = true;
      this.lastError = null;
      return result.value;
    }
    const message = result.error && result.error.message
      ? result.error.message
      : "dsh 调用失败";
    const error = new Error(message);
    error.code = result.error && result.error.code;
    error.details = result.error && result.error.details;
    this.lastError = message;
    throw error;
  }

  async _post(url, body) {
    return fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      body,
    });
  }

  status() {
    return {
      connected: this.connected,
      baseUrl: this.baseUrl,
      hasLaunchToken: Boolean(this.launchToken),
      hasCookie: Boolean(this.cookie),
      lastError: this.lastError,
    };
  }
}

function collectSetCookie(headers) {
  const list = [];
  const raw = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [headers.get("set-cookie")].filter(Boolean);
  for (const item of raw) {
    if (typeof item === "string") list.push(item);
  }
  return list;
}

function pickSessionCookie(setCookies) {
  const parts = [];
  for (const raw of setCookies) {
    const first = String(raw).split(";")[0];
    if (first && first.includes("=")) parts.push(first.trim());
  }
  if (parts.length === 0) return null;
  return parts.join("; ");
}

module.exports = { DshClient };
