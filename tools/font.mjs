// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * font.mjs — a reader for the TrueType font file the look bundles (tools/fonts/, named by `--font-file`
 * in tools/look.json): the tables a line of text needs and nothing else — head, maxp, hhea, hmtx, cmap
 * (format 4 and 12), loca and glyf, composites included. A glyph comes out as closed contours of
 * straight segments in font units (quadratic curves flattened by a fixed number of steps, in integer
 * arithmetic on the control points and plain +, -, *, / on doubles: nothing here calls a
 * transcendental function, so the same file gives the same outline on every host).
 *
 * Pure: it is given bytes and returns data.
 */

/** Straight segments one quadratic curve is cut into. */
const CURVE_STEPS = 8;

export function parseFont(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (v.getUint32(0) !== 0x00010000 && tag(0) !== 'true') throw new Error('font: not a TrueType (glyf) font file');
  const tables = {};
  for (let i = 0, n = v.getUint16(4); i < n; i++) tables[tag(12 + i * 16)] = v.getUint32(12 + i * 16 + 8);
  for (const t of ['head', 'maxp', 'hhea', 'hmtx', 'cmap', 'loca', 'glyf']) if (tables[t] === undefined) throw new Error(`font: no '${t}' table`);
  const unitsPerEm = v.getUint16(tables.head + 18);
  const longLoca = v.getInt16(tables.head + 50) === 1;
  const numGlyphs = v.getUint16(tables.maxp + 4);
  const ascent = v.getInt16(tables.hhea + 4);
  const descent = v.getInt16(tables.hhea + 6);
  const numHMetrics = v.getUint16(tables.hhea + 34);

  const advance = (g) => v.getUint16(tables.hmtx + 4 * Math.min(g, numHMetrics - 1));
  const glyphAt = (g) => {
    const a = longLoca ? v.getUint32(tables.loca + 4 * g) : v.getUint16(tables.loca + 2 * g) * 2;
    const b = longLoca ? v.getUint32(tables.loca + 4 * g + 4) : v.getUint16(tables.loca + 2 * g + 2) * 2;
    return b > a ? tables.glyf + a : -1;
  };

  // cmap: the Unicode BMP (format 4) or full (format 12) subtable.
  let cmapAt = -1;
  for (let i = 0, n = v.getUint16(tables.cmap + 2); i < n; i++) {
    const rec = tables.cmap + 4 + i * 8;
    const pid = v.getUint16(rec), eid = v.getUint16(rec + 2), off = tables.cmap + v.getUint32(rec + 4);
    const fmt = v.getUint16(off);
    if (pid === 3 && eid === 10 && fmt === 12) { cmapAt = off; break; }
    if (((pid === 3 && eid === 1) || pid === 0) && (fmt === 4 || fmt === 12) && cmapAt < 0) cmapAt = off;
  }
  if (cmapAt < 0) throw new Error('font: no Unicode cmap');
  const glyphOf = (cp) => {
    if (v.getUint16(cmapAt) === 12) {
      for (let i = 0, n = v.getUint32(cmapAt + 12); i < n; i++) {
        const o = cmapAt + 16 + i * 12, lo = v.getUint32(o), hi = v.getUint32(o + 4);
        if (cp >= lo && cp <= hi) return v.getUint32(o + 8) + cp - lo;
      }
      return 0;
    }
    const segs = v.getUint16(cmapAt + 6) / 2;
    const ends = cmapAt + 14, starts = ends + segs * 2 + 2, deltas = starts + segs * 2, ranges = deltas + segs * 2;
    for (let i = 0; i < segs; i++) {
      if (cp > v.getUint16(ends + i * 2)) continue;
      if (cp < v.getUint16(starts + i * 2)) return 0;
      const ro = v.getUint16(ranges + i * 2), delta = v.getInt16(deltas + i * 2);
      if (ro === 0) return (cp + delta) & 0xffff;
      const g = v.getUint16(ranges + i * 2 + ro + (cp - v.getUint16(starts + i * 2)) * 2);
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  };

  /** The points of a glyph as contours of [x, y, onCurve], transformed by [a, b, c, d, e, f]. */
  const points = (g, m, depth) => {
    if (g >= numGlyphs || depth > 6) return [];
    const at = glyphAt(g);
    if (at < 0) return [];
    const nContours = v.getInt16(at);
    if (nContours < 0) {
      const out = [];
      let o = at + 10, more = true;
      while (more) {
        const flags = v.getUint16(o), sub = v.getUint16(o + 2);
        o += 4;
        let dx, dy;
        if (flags & 1) { dx = v.getInt16(o); dy = v.getInt16(o + 2); o += 4; } else { dx = v.getInt8(o); dy = v.getInt8(o + 1); o += 2; }
        if (!(flags & 2)) dx = dy = 0; // matched points are not supported; a font that uses them draws them unmoved
        let a = 1, b = 0, c = 0, d = 1;
        const f2 = (p) => v.getInt16(p) / 16384;
        if (flags & 8) { a = d = f2(o); o += 2; } else if (flags & 0x40) { a = f2(o); d = f2(o + 2); o += 4; } else if (flags & 0x80) { a = f2(o); b = f2(o + 2); c = f2(o + 4); d = f2(o + 6); o += 8; }
        // child -> parent -> m
        const child = [a * m[0] + b * m[2], a * m[1] + b * m[3], c * m[0] + d * m[2], c * m[1] + d * m[3], dx * m[0] + dy * m[2] + m[4], dx * m[1] + dy * m[3] + m[5]];
        out.push(...points(sub, child, depth + 1));
        more = (flags & 0x20) !== 0;
      }
      return out;
    }
    const ends = [];
    let o = at + 10;
    for (let i = 0; i < nContours; i++, o += 2) ends.push(v.getUint16(o));
    const n = nContours ? ends[nContours - 1] + 1 : 0;
    o += 2 + v.getUint16(o);
    const flags = [];
    while (flags.length < n) {
      const f = v.getUint8(o++);
      flags.push(f);
      if (f & 8) for (let r = v.getUint8(o++); r > 0; r--) flags.push(f);
    }
    const coord = (short, same) => {
      const out = [];
      let val = 0;
      for (let i = 0; i < n; i++) {
        const f = flags[i];
        if (f & short) { const d = v.getUint8(o++); val += f & same ? d : -d; } else if (!(f & same)) { val += v.getInt16(o); o += 2; }
        out.push(val);
      }
      return out;
    };
    const xs = coord(2, 16), ys = coord(4, 32);
    const contours = [];
    let first = 0;
    for (const end of ends) {
      const c = [];
      for (let i = first; i <= end; i++) c.push([xs[i] * m[0] + ys[i] * m[2] + m[4], xs[i] * m[1] + ys[i] * m[3] + m[5], flags[i] & 1]);
      contours.push(c);
      first = end + 1;
    }
    return contours;
  };

  /** Closed polygons (arrays of [x, y]) of a glyph, in font units, y up. */
  const outline = (g) => points(g, [1, 0, 0, 1, 0, 0], 0).map((pts) => {
    // Start on an on-curve point; two off-curve points in a row imply one midway between them.
    const ring = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      ring.push(p);
      if (!p[2] && !q[2]) ring.push([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, 1]);
    }
    let s = ring.findIndex((p) => p[2]);
    if (s < 0) s = 0;
    const r = [...ring.slice(s), ...ring.slice(0, s)];
    const poly = [];
    for (let i = 0; i < r.length; i++) {
      const p = r[i];
      if (p[2]) { poly.push([p[0], p[1]]); continue; }
      const a = r[i - 1], b = r[(i + 1) % r.length];
      for (let k = 1; k < CURVE_STEPS; k++) {
        const t = k / CURVE_STEPS, u = 1 - t;
        poly.push([u * u * a[0] + 2 * u * t * p[0] + t * t * b[0], u * u * a[1] + 2 * u * t * p[1] + t * t * b[1]]);
      }
    }
    return poly;
  });

  const cache = new Map();
  return {
    unitsPerEm, ascent, descent,
    /** `{ advance, polys }` of a character; a character the font lacks is its .notdef. */
    glyph(ch) {
      const cp = ch.codePointAt(0);
      if (!cache.has(cp)) {
        const g = glyphOf(cp);
        cache.set(cp, { has: g !== 0, advance: advance(g), polys: outline(g) });
      }
      return cache.get(cp);
    },
  };
}
