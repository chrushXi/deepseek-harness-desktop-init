"use strict";

/**
 * QR 码生成（字节模式，纠错 L/M，版本 1–10）。
 * 基于 Project Nayuki QR Code generator（MIT）的精简移植，无外部依赖。
 * 供软件设置页「扫码配对」使用。
 */

// ---- GF(256) Reed-Solomon ----
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree) {
  const result = [];
  for (let i = 0; i < degree - 1; i++) result.push(0);
  result.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] ^= gfMul(coef, factor);
    });
  }
  return result;
}

// ---- capacity tables (version 1..10) ----
const ECC_PER_BLOCK = {
  1:  [7, 10, 13, 17],
  2:  [10, 16, 22, 28],
  3:  [15, 26, 36, 44],
  4:  [20, 36, 52, 64],
  5:  [26, 48, 72, 88],
  6:  [36, 64, 96, 112],
  7:  [40, 72, 108, 130],
  8:  [48, 88, 132, 156],
  9:  [60, 110, 160, 192],
  10: [72, 130, 192, 224],
};
const NUM_BLOCKS = {
  1:  [1, 1, 1, 1],
  2:  [1, 1, 1, 1],
  3:  [1, 1, 2, 2],
  4:  [1, 2, 2, 4],
  5:  [1, 2, 4, 4],
  6:  [2, 4, 4, 4],
  7:  [2, 4, 6, 5],
  8:  [2, 4, 6, 6],
  9:  [2, 5, 8, 8],
  10: [4, 5, 8, 8],
};
const ECL_INDEX = { L: 0, M: 1, Q: 2, H: 3 };
const ECL_FORMAT = { L: 1, M: 0, Q: 3, H: 2 };

function rawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(ver, ecl) {
  const i = ECL_INDEX[ecl];
  return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ver][i] * NUM_BLOCKS[ver][i];
}

function utf8Bytes(text) {
  return Array.from(Buffer.from(String(text), "utf8"));
}

function encodeCodewords(text, ecl) {
  const bytes = utf8Bytes(text);
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const capBits = dataCodewords(v, ecl) * 8;
    const ccBits = v < 10 ? 8 : 16;
    if (4 + ccBits + bytes.length * 8 <= capBits) {
      version = v;
      break;
    }
  }
  if (!version) throw new Error("内容过长，无法生成二维码");

  const capBits = dataCodewords(version, ecl) * 8;
  const bits = [];
  const push = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(4, 4); // byte mode
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  // terminator + pad
  push(0, Math.min(4, capBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  for (let pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) push(pad, 8);

  const dataCw = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    dataCw.push(b);
  }

  const ei = ECL_INDEX[ecl];
  const numBlocks = NUM_BLOCKS[version][ei];
  const eccLen = ECC_PER_BLOCK[version][ei];
  const rawCw = Math.floor(rawDataModules(version) / 8);
  const numShort = numBlocks - (rawCw % numBlocks);
  const shortDataLen = Math.floor(rawCw / numBlocks) - eccLen;

  const blocks = [];
  const div = rsDivisor(eccLen);
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const len = shortDataLen + (i < numShort ? 0 : 1);
    const dat = dataCw.slice(k, k + len);
    k += len;
    const ecc = rsRemainder(dat, div);
    blocks.push({ dat, ecc });
  }

  const all = [];
  for (let i = 0; i < shortDataLen + 1; i++) {
    for (const block of blocks) {
      if (i < block.dat.length) all.push(block.dat[i]);
    }
  }
  for (let i = 0; i < eccLen; i++) {
    for (const block of blocks) all.push(block.ecc[i]);
  }
  return { version, ecl, codewords: all };
}

function buildMatrix(version, ecl, codewords) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => Array(size).fill(false));
  const isFn = Array.from({ length: size }, () => Array(size).fill(false));

  const setFn = (x, y, dark) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y][x] = dark;
    isFn[y][x] = true;
  };

  // timing
  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }

  // finders
  const finder = (ox, oy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = ox + dx;
        const y = oy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, dist !== 2 && dist !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);

  // alignment
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
    const xs = [6];
    for (let i = size - 7; xs.length < numAlign; i -= step) xs.splice(1, 0, i);
    for (const y of xs) {
      for (const x of xs) {
        if ((x === 6 && y === 6) || (x === 6 && y === size - 7) || (x === size - 7 && y === 6)) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            setFn(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
          }
        }
      }
    }
  }

  setFn(8, size - 8, true); // dark module

  const drawFormat = (mask) => {
    const data = (ECL_FORMAT[ecl] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(i));
    setFn(8, 7, bit(6));
    setFn(8, 8, bit(7));
    setFn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(i));
    setFn(8, size - 8, true);
  };
  drawFormat(0);

  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFn(a, b, bit);
      setFn(b, a, bit);
    }
  }

  // data placement
  let i = 0;
  const bitAt = (idx) => ((codewords[idx >>> 3] >>> (7 - (idx & 7))) & 1) !== 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFn[y][x] && i < codewords.length * 8) {
          modules[y][x] = bitAt(i);
          i++;
        }
      }
    }
  }

  const maskFn = (mask, x, y) => {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return false;
    }
  };

  const applyMask = (mask) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!isFn[y][x] && maskFn(mask, x, y)) modules[y][x] = !modules[y][x];
      }
    }
  };

  const penalty = () => {
    let p = 0;
    for (let y = 0; y < size; y++) {
      let run = 1;
      for (let x = 1; x < size; x++) {
        if (modules[y][x] === modules[y][x - 1]) {
          run++;
          if (run === 5) p += 3;
          else if (run > 5) p += 1;
        } else run = 1;
      }
    }
    for (let x = 0; x < size; x++) {
      let run = 1;
      for (let y = 1; y < size; y++) {
        if (modules[y][x] === modules[y - 1][x]) {
          run++;
          if (run === 5) p += 3;
          else if (run > 5) p += 1;
        } else run = 1;
      }
    }
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = modules[y][x];
        if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) p += 3;
      }
    }
    // finder-like
    return p;
  };

  let best = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask);
    drawFormat(mask);
    const score = penalty();
    if (score < bestScore) {
      bestScore = score;
      best = mask;
    }
    applyMask(mask);
  }
  applyMask(best);
  drawFormat(best);
  return { size, modules };
}

function generateQr(text, options = {}) {
  const ecl = options.ecl === "L" ? "L" : "M";
  const { version, codewords } = encodeCodewords(text, ecl);
  return buildMatrix(version, ecl, codewords);
}

function renderQrSvg(text, options = {}) {
  const { size, modules } = generateQr(text, options);
  const scale = options.scale || 4;
  const quiet = options.quiet != null ? options.quiet : 2;
  const dim = (size + quiet * 2) * scale;
  let dark = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!modules[y][x]) continue;
      dark += `<rect x="${(x + quiet) * scale}" y="${(y + quiet) * scale}" width="${scale}" height="${scale}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="#fff"/><g fill="#000">${dark}</g></svg>`;
}

module.exports = { generateQr, renderQrSvg };
