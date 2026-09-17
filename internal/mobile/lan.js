"use strict";

const os = require("node:os");

/** 收集本机非 internal IPv4，供设置页展示与手机连接。 */
function listLanIPv4() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets || {})) {
    for (const net of nets[name] || []) {
      if (net && net.family === "IPv4" && !net.internal) {
        out.push({ iface: name, address: net.address });
      }
    }
  }
  return out;
}

function primaryLanIPv4() {
  const list = listLanIPv4();
  return list.length > 0 ? list[0].address : null;
}

module.exports = { listLanIPv4, primaryLanIPv4 };
