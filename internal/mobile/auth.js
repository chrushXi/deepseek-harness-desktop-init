"use strict";

const crypto = require("node:crypto");

/** 生成 6 位数字配对码。 */
function generatePairCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/** 生成设备 token。 */
function generateDeviceToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token), "utf8").digest("hex");
}

/**
 * 设备注册表：内存态 + 可选持久化回调。
 * token 只存哈希，响应里只回显一次明文。
 */
class DeviceRegistry {
  constructor() {
    this.devices = new Map(); // deviceId -> { id, name, tokenHash, createdAt, lastSeenAt, revoked }
  }

  register(name) {
    const id = crypto.randomUUID();
    const token = generateDeviceToken();
    const now = Date.now();
    const device = {
      id,
      name: String(name || "手机").slice(0, 64) || "手机",
      tokenHash: hashToken(token),
      createdAt: now,
      lastSeenAt: now,
      revoked: false,
    };
    this.devices.set(id, device);
    return { device: this.publicView(device), token };
  }

  verify(token) {
    if (!token || typeof token !== "string") return null;
    const h = hashToken(token);
    for (const device of this.devices.values()) {
      if (!device.revoked && device.tokenHash === h) {
        device.lastSeenAt = Date.now();
        return device;
      }
    }
    return null;
  }

  revoke(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device) return false;
    device.revoked = true;
    return true;
  }

  list() {
    return [...this.devices.values()]
      .filter((d) => !d.revoked)
      .map((d) => this.publicView(d));
  }

  publicView(device) {
    return {
      id: device.id,
      name: device.name,
      createdAt: device.createdAt,
      lastSeenAt: device.lastSeenAt,
    };
  }

  /** 导出可持久化数据（含 tokenHash，不含明文 token）。 */
  export() {
    return [...this.devices.values()]
      .filter((d) => !d.revoked)
      .map((d) => ({
        id: d.id,
        name: d.name,
        tokenHash: d.tokenHash,
        createdAt: d.createdAt,
        lastSeenAt: d.lastSeenAt,
      }));
  }

  /** 从持久化数据恢复。 */
  restore(list) {
    this.devices.clear();
    if (!Array.isArray(list)) return;
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const id = String(raw.id || "");
      const tokenHash = String(raw.tokenHash || "");
      if (!id || !tokenHash) continue;
      this.devices.set(id, {
        id,
        name: String(raw.name || "手机").slice(0, 64) || "手机",
        tokenHash,
        createdAt: Number(raw.createdAt) || Date.now(),
        lastSeenAt: Number(raw.lastSeenAt) || Date.now(),
        revoked: false,
      });
    }
  }
}

module.exports = {
  generatePairCode,
  generateDeviceToken,
  hashToken,
  DeviceRegistry,
};
