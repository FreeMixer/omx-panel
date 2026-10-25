// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * raster.mjs — a small RGBA canvas and a PNG writer whose bytes depend only on the pixels, for the
 * MOD GUI's screenshot and thumbnail. Committed images are held byte for byte by `--check`, so
 * nothing here may move with the host: the deflate stream is written with the FIXED Huffman codes
 * of RFC 1951 §3.2.6 and a greedy matcher over a declared list of distances — never zlib, whose
 * output changes with its version — and every coordinate is snapped to 1/16 px before it is
 * sampled, so a last-bit difference in a host's sin/cos cannot reach a pixel.
 *
 * Pure: no clock, no path, no host.
 */

/** Sub-pixel samples per axis: coverage is the fraction of SS×SS points inside a shape. */
const SS = 4;
/** Coordinates and radii are snapped to this grid before sampling. */
export const snap = (v) => Math.round(v * 16) / 16;

/** `#rrggbb` -> [r, g, b]. A token that is not a plain hex colour is refused, never guessed. */
export function rgbOf(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`raster: '${hex}' is not a #rrggbb colour`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function canvas(w, h) {
  if (!(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0)) throw new Error(`raster: bad size ${w}x${h}`);
  return { w, h, data: new Uint8Array(w * h * 4) };
}

/** Source-over of `rgb` at `coverage` (0..1) onto pixel (x, y). */
function blend(c, x, y, rgb, coverage) {
  if (coverage <= 0 || x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 4;
  const a = Math.round(coverage * 255);
  const da = c.data[i + 3];
  const oa = a + Math.round((da * (255 - a)) / 255);
  for (let k = 0; k < 3; k++) {
    const src = rgb[k] * a;
    const dst = Math.round((c.data[i + k] * da * (255 - a)) / 255);
    c.data[i + k] = oa === 0 ? 0 : Math.round((src + dst) / oa);
  }
  c.data[i + 3] = oa;
}

/** Fill every pixel of the box [x0, x1) × [y0, y1) by the fraction of its samples `inside` accepts. */
function fillShape(c, box, inside, rgb) {
  const x0 = Math.max(0, Math.floor(box[0])), y0 = Math.max(0, Math.floor(box[1]));
  const x1 = Math.min(c.w, Math.ceil(box[2])), y1 = Math.min(c.h, Math.ceil(box[3]));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      let n = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) if (inside(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)) n++;
      }
      blend(c, x, y, rgb, n / (SS * SS));
    }
  }
}

/** A rectangle with rounded corners of radius `r`. */
export function roundRect(c, x, y, w, h, r, rgb) {
  [x, y, w, h, r] = [x, y, w, h, r].map(snap);
  const inside = (px, py) => {
    const qx = Math.max(x + r - px, 0, px - (x + w - r));
    const qy = Math.max(y + r - py, 0, py - (y + h - r));
    return px >= x && px <= x + w && py >= y && py <= y + h && qx * qx + qy * qy <= r * r;
  };
  fillShape(c, [x, y, x + w, y + h], inside, rgb);
}

/** A filled disc. */
export function disc(c, cx, cy, r, rgb) {
  [cx, cy, r] = [cx, cy, r].map(snap);
  fillShape(c, [cx - r, cy - r, cx + r, cy + r], (px, py) => (px - cx) ** 2 + (py - cy) ** 2 <= r * r, rgb);
}

/** A segment of half-width `hw` with round caps. */
export function segment(c, ax, ay, bx, by, hw, rgb) {
  [ax, ay, bx, by, hw] = [ax, ay, bx, by, hw].map(snap);
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const inside = (px, py) => {
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    return (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2 <= hw * hw;
  };
  fillShape(c, [Math.min(ax, bx) - hw, Math.min(ay, by) - hw, Math.max(ax, bx) + hw, Math.max(ay, by) + hw], inside, rgb);
}

// ------------------------------------------------------------------------------- PNG + deflate

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1, b = 0;
  for (const x of bytes) { a = (a + x) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}

/** RFC 1951 §3.2.5: [code, base, extra bits] for lengths 3..258 and distances 1..32768. */
const LENGTHS = (() => {
  const out = [];
  let base = 3;
  for (let code = 257; code < 285; code++) {
    const extra = code < 265 ? 0 : Math.floor((code - 261) / 4);
    out.push([code, base, extra]);
    base += 1 << extra;
  }
  out.push([285, 258, 0]);
  return out;
})();
const DISTANCES = (() => {
  const out = [];
  let base = 1;
  for (let code = 0; code < 30; code++) {
    const extra = code < 4 ? 0 : Math.floor((code - 2) / 2);
    out.push([code, base, extra]);
    base += 1 << extra;
  }
  return out;
})();
const lookup = (table, v) => {
  for (let i = table.length - 1; i >= 0; i--) if (table[i][1] <= v) return table[i];
  throw new Error(`raster: no deflate code for ${v}`);
};

function bitWriter() {
  const out = [];
  let acc = 0, n = 0;
  const bits = (value, count) => { // LSB first
    for (let i = 0; i < count; i++) {
      acc |= ((value >>> i) & 1) << n;
      if (++n === 8) { out.push(acc); acc = 0; n = 0; }
    }
  };
  const huff = (code, count) => { // a Huffman code goes MSB first
    for (let i = count - 1; i >= 0; i--) bits((code >>> i) & 1, 1);
  };
  const done = () => { if (n) out.push(acc); return Uint8Array.from(out); };
  return { bits, huff, done };
}

/** The fixed literal/length code of `sym` (RFC 1951 §3.2.6). */
function fixedLit(w, sym) {
  if (sym < 144) w.huff(0x30 + sym, 8);
  else if (sym < 256) w.huff(0x190 + sym - 144, 9);
  else if (sym < 280) w.huff(sym - 256, 7);
  else w.huff(0xc0 + sym - 280, 8);
}

/** One fixed-Huffman deflate block over `raw`, matching only at the `distances` given, greedily. */
export function deflateFixed(raw, distances) {
  const w = bitWriter();
  w.bits(1, 1); // BFINAL
  w.bits(1, 2); // BTYPE = 01, fixed codes
  let i = 0;
  while (i < raw.length) {
    let bestLen = 0, bestDist = 0;
    for (const d of distances) {
      if (d > i || d > 32768) continue;
      let l = 0;
      while (l < 258 && i + l < raw.length && raw[i + l] === raw[i + l - d]) l++;
      if (l > bestLen) { bestLen = l; bestDist = d; }
    }
    if (bestLen >= 3) {
      const [lc, lb, le] = lookup(LENGTHS, bestLen);
      fixedLit(w, lc);
      w.bits(bestLen - lb, le);
      const [dc, db, de] = lookup(DISTANCES, bestDist);
      w.huff(dc, 5);
      w.bits(bestDist - db, de);
      i += bestLen;
    } else {
      fixedLit(w, raw[i]);
      i += 1;
    }
  }
  fixedLit(w, 256);
  return w.done();
}

function chunk(type, body) {
  const head = new Uint8Array(8);
  new DataView(head.buffer).setUint32(0, body.length);
  head.set(Buffer.from(type, 'latin1'), 4);
  const tail = new Uint8Array(4);
  new DataView(tail.buffer).setUint32(0, crc32(Buffer.concat([head.subarray(4), body])));
  return Buffer.concat([head, body, tail]);
}

/** The scanlines PNG compresses: filter byte 0 (None) then the row's RGBA. */
export function scanlines(c) {
  const stride = c.w * 4 + 1;
  const raw = new Uint8Array(stride * c.h);
  for (let y = 0; y < c.h; y++) raw.set(c.data.subarray(y * c.w * 4, (y + 1) * c.w * 4), y * stride + 1);
  return raw;
}

/** A PNG (8-bit RGBA) of the canvas. `period` is a horizontal repeat in pixels worth matching (a
 * film strip's frame width); the matcher also tries the previous pixel and the previous row. */
export function encodePng(c, period = 0) {
  const raw = scanlines(c);
  const stride = c.w * 4 + 1;
  const distances = [4, stride, ...(period > 0 ? [period * 4] : []), 1];
  const z = Buffer.concat([Buffer.from([0x78, 0x01]), deflateFixed(raw, distances), Buffer.alloc(4)]);
  z.writeUInt32BE(adler32(raw), z.length - 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.w, 0);
  ihdr.writeUInt32BE(c.h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', z),
    chunk('IEND', new Uint8Array(0)),
  ]);
}
