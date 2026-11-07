// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * harness.mjs — what the renderer's tests share: the fixtures (one of our plugins, one third-party LV2
 * plugin), each laid out by `omx-panel layout` and given the readings a host would give (the MOD GUI's
 * own: each control at its default, its text as the face writes it), the renderer run over them, and
 * a PNG read back to pixels. Reads the built tree (the parent's `npm ci && make`) and renderer/build/.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

export const RENDERER = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = resolve(RENDERER, '..');
export const CLI = join(RENDERER, 'build', 'omx-panel-render');
/** The tools directory the renderer reads the look, the geometry and the font from: the source tree's. */
export const DATA = join(ROOT, 'tools');
const OMX_PANEL = join(ROOT, 'dist', 'bin', 'omx-panel.mjs');

/** The panels drawn: ours (omx-delay, a declared panel) and a third party's LV2 plugin (ZamComp, scanned), the latter
 * both as the layout lays it out from the scan alone and under the panel the worked example writes for it. Each names
 * the MOD GUI face the generator committed for it, where one exists. */
/** Whether omx-dsp's TypeScript twin is installed (`@openmixer/omx-dsp`, not yet released): a fixture that draws a curve needs it, and
 * is skipped without it unless OMX_PANEL_DSP=required. */
export const HAVE_TWIN = await import('@openmixer/omx-dsp').then(() => true, () => false);
export const skipWithoutTwin = (fx) => (fx.needsTwin && !HAVE_TWIN ? { skip: 'omx-dsp twin (@openmixer/omx-dsp) not installed' } : {});

export const FIXTURES = [
  { name: 'omx-delay', descriptor: 'test/fixtures/omx-delay/omx-delay.descriptor.json', panel: 'test/fixtures/omx-delay/omx-delay.panel.json', stem: 'omx-delay', screenshot: 'test/fixtures/omx-delay/omx-delay.lv2/modgui/screenshot-omx-delay.png' },
  // a bar group (nine drawbars by their footage, a section of its own) beside two knobs: the rule finds the run, the renderer and the MOD GUI draw it as a row of faders
  { name: 'organ', descriptor: 'test/fixtures/organ/organ.descriptor.json', stem: 'organ' },
  // a compressor whose declared panel draws its curve: the frame and the basis word in the caption place, the points the host's
  { name: 'dyn-curve', descriptor: 'test/fixtures/dyn-curve/dyn.descriptor.json', panel: 'test/fixtures/dyn-curve/dyn.panel.json', stem: 'dyn', needsTwin: true },
  // an EQ whose bands two planters own: the static curve through omx-dsp's twin, and a mark at each planted band
  { name: 'eq-marks', descriptor: 'test/fixtures/eq-marks/eq.descriptor.json', panel: 'test/fixtures/eq-marks/eq.panel.json', stem: 'eq', needsTwin: true },
  { name: 'zamcomp', descriptor: 'examples/worked-example/zamcomp/zamcomp.descriptor.json', stem: 'ZamComp' },
  { name: 'zamcomp-panel', descriptor: 'examples/worked-example/zamcomp/zamcomp.descriptor.json', panel: 'examples/worked-example/zamcomp/zamcomp.panel.json', stem: 'ZamComp' },
];

const modgui = await import(join(ROOT, 'dist', 'tools', 'modgui-gen.mjs'));
const { renderFace, layout, loadLook, resolvePanel } = modgui;

/** The fixture as the MOD GUI generator resolves it: its sections with each control's travel and default. */
export function resolved(fx) {
  const descriptor = JSON.parse(readFileSync(join(ROOT, fx.descriptor), 'utf8'));
  const panel = fx.panel ? JSON.parse(readFileSync(join(ROOT, fx.panel), 'utf8')) : undefined;
  return resolvePanel(descriptor, { panel, stem: fx.stem });
}

/** The MOD GUI generator's face of the fixture at `scale`, as pixels. */
export function face(fx, scale) {
  const p = resolved(fx);
  return decodePng(renderFace({ ...layout(p), brand: p.brand, name: p.name ?? p.stem }, loadLook(), scale));
}

/** The fixture's panel description, as `omx-panel layout` writes it, in a file. */
export function descriptionFile(fx, dir) {
  const args = [OMX_PANEL, 'layout', '--descriptor', join(ROOT, fx.descriptor), ...(fx.panel ? ['--panel', join(ROOT, fx.panel)] : [])];
  const file = join(dir, `${fx.name}.layout.json`);
  writeFileSync(file, execFileSync(process.execPath, args, { encoding: 'utf8' }));
  return file;
}

/** The host's side, in a file: the title, and every control at its default with the text the MOD GUI face shows;
 * `readings` gives some controls (a meter's level) a reading of their own. */
export function stateFile(fx, dir, readings = {}) {
  const p = resolved(fx);
  const values = { ...readings };
  for (const k of p.sections.flatMap((s) => s.controls)) {
    if (k.widget === 'display' || k.symbol in values) continue;
    const text = modgui.valueText(k);
    if (k.widget === 'selector') values[k.symbol] = { at: Math.max(0, k.options.findIndex((o) => o.value === k.def)), count: k.options.length, text };
    else if (k.widget === 'switch') values[k.symbol] = { fraction: k.def >= 0.5 ? 1 : 0, text };
    else values[k.symbol] = { fraction: modgui.travelFraction(k, k.def), text };
  }
  // the points and marks the MOD GUI's static curve was drawn from, handed to the renderer as a host would
  const curves = {}, marks = {};
  let at = 0;
  for (const sec of p.sections) for (const dsp of sec.displays) {
    if (dsp.curve?.points) curves[at] = { x: dsp.curve.points.map((q) => q.x), y: dsp.curve.points.map((q) => q.y) };
    if (dsp.curve?.marks?.length) marks[at] = dsp.curve.marks.map((m) => ({ freq: m.freq, depth: m.depthDb, letter: modgui.ORIGIN_LETTER[m.origin] }));
    at++;
  }
  const file = join(dir, `${fx.name}.state.json`);
  writeFileSync(file, JSON.stringify({ brand: p.brand, name: p.name ?? p.stem, values, curves, marks }, null, 2));
  return file;
}

export const scratch = () => mkdtempSync(join(tmpdir(), 'omx-panel-render-'));

/** The renderer over a description and a state: `{ w, h, data }`, RGBA with straight alpha unless `format`/`alpha` say
 * otherwise. `size` [w, h] in device px, or the natural size; `window` reads a window's frame instead (natural size). */
export function render(description, state, { scale = 1, size, format = 'rgba', alpha = 'straight', window = false } = {}) {
  const dir = scratch();
  const out = join(dir, 'out.raw');
  const args = ['--description', description, '--data', DATA, '--state', state, '--scale', String(scale), '--format', format, '--alpha', alpha, '--raw', out];
  if (size) args.push('--width', String(size[0]), '--height', String(size[1]));
  if (window) args.push('--window');
  const [w, h] = execFileSync(CLI, args, { encoding: 'utf8' }).trim().split(' ').map(Number);
  return { w, h, data: new Uint8Array(readFileSync(out)) };
}

/** A PNG's pixels, RGBA: 8-bit RGBA, not interlaced, every scanline filter None (what both of this tree's writers make). */
export function decodePng(bytes) {
  const b = Buffer.from(bytes);
  let at = 8, w = 0, h = 0;
  const idat = [];
  while (at < b.length) {
    const n = b.readUInt32BE(at), type = b.toString('latin1', at + 4, at + 8), body = b.subarray(at + 8, at + 8 + n);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0); h = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) throw new Error('decodePng: not 8-bit RGBA, not interlaced');
    } else if (type === 'IDAT') idat.push(body);
    at += 12 + n;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    if (raw[y * (w * 4 + 1)] !== 0) throw new Error(`decodePng: row ${y} is filtered`);
    data.set(raw.subarray(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1)), y * w * 4);
  }
  return { w, h, data };
}

/** How two images differ: `{ sameSize, exact, off, worst }` — `off` the pixels whose channels differ by more than `tol`. */
export function compare(a, b, tol = 0) {
  if (a.w !== b.w || a.h !== b.h) return { sameSize: false, exact: false, off: Infinity, worst: Infinity };
  let off = 0, worst = 0, exact = true;
  for (let i = 0; i < a.data.length; i += 4) {
    let d = 0;
    for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(a.data[i + k] - b.data[i + k]));
    if (d) exact = false;
    if (d > tol) off++;
    worst = Math.max(worst, d);
  }
  return { sameSize: true, exact, off, worst };
}

/** The licence the golden images carry, in a tEXt chunk ahead of the pixels: they are this tree's work. */
const LICENCE = 'SPDX-License-Identifier: GPL-3.0-or-later\nCopyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>\n';

/** A PNG of RGBA pixels: its licence, then filter None, zlib at its best. */
export function encodePng({ w, h, data }) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, body) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0); out.write(type, 4, 'latin1'); body.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(data.buffer, data.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('tEXt', Buffer.from(`Comment\0\n${LICENCE}`, 'latin1')), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Each control's cell where the renderer places it in a box: `[x, y, w, h]` in device px, in the description's order. */
export function rects(description, { scale = 1, size } = {}) {
  const args = ['--description', description, '--data', DATA, '--scale', String(scale), '--rects'];
  if (size) args.push('--width', String(size[0]), '--height', String(size[1]));
  return execFileSync(CLI, args, { encoding: 'utf8' }).trim().split('\n').slice(1).map((l) => l.split(' ').map(Number));
}

// ------------------------------------------------------------------------- the tolerance mode of the parity check (spec 7.5, Q7)
// Where the rasteriser is ours (the renderer against the MOD GUI face) the check is `compare`, exact. A surface that draws with another
// rasteriser (the console in a browser, Zynthian's Tk) is held to the renderer's drawing by the three checks below: the stroke of the
// curve layer within `px` of the other's both ways, the bars' heights within a pixel, and the bars' count, order and labels equal as text.

const look = JSON.parse(readFileSync(join(ROOT, 'tools', 'look.json'), 'utf8')).tokens;
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** The stroke pixels of the curve layer inside `frame` ({x, y, w, h}, device px): a pixel that is the accent over the frame's body, part
 * way (a hairline's edge pixels blend): along the body-to-accent line by at least 0.4 and off it by less than 25. The frame's own rim and
 * its caption are outside the inner area; no text is read. */
export function strokePixels(img, frame, inset = 5) {
  const accent = rgb(look['--accent']), body = rgb(look['--surface-3']);
  const d = accent.map((c, k) => c - body[k]), dd = d.reduce((s, v) => s + v * v, 0);
  const out = [];
  for (let y = frame.y + inset; y < frame.y + frame.h - inset - 12; y++) for (let x = frame.x + inset; x < frame.x + frame.w - inset; x++) {
    const i = (y * img.w + x) * 4, p = [0, 1, 2].map((k) => img.data[i + k] - body[k]);
    const t = p.reduce((s, v, k) => s + v * d[k], 0) / dd;
    if (t > 0.4 && Math.hypot(...p.map((v, k) => v - t * d[k])) < 25) out.push([x, y]);
  }
  return out;
}

/** Whether every stroke pixel of `a` is within `px` of a stroke pixel of `b` and the other way round: `{ ok, missing, extra }`, the pixels of
 * `a` with none near in `b` and of `b` with none near in `a`. `px` is 1 for the console, 2 for Tk, at 1x. */
export function strokeParity(a, b, px) {
  const near = (set, [x, y]) => set.some(([sx, sy]) => Math.hypot(sx - x, sy - y) <= px);
  const missing = a.filter((p) => !near(b, p)), extra = b.filter((p) => !near(a, p));
  return { ok: a.length > 0 && missing.length === 0 && extra.length === 0, missing, extra };
}

/** Each bar's measure in a rendering: `rects` are the bars' control cells (`rects()`), the measure the height of the fader cap above the foot of
 * the fader (the cap is the look's `--ink-dim`), in device px; `null` for a cell with no cap. */
export function barHeights(img, rects) {
  const cap = rgb(look['--ink-dim']);
  return rects.map(([x, y, w, h]) => {
    const cx = Math.round(x + w / 2);
    for (let yy = Math.round(y); yy < Math.round(y + h); yy++) {
      const i = (yy * img.w + cx) * 4;
      if ([0, 1, 2].every((k) => Math.abs(img.data[i + k] - cap[k]) <= 2)) return Math.round(y + h) - yy;
    }
    return null;
  });
}

/** Two sets of bars, each `{ labels, heights }`: the count, the order and the labels equal as text, every height within `px` (1). */
export function barParity(a, b, px = 1) {
  const faults = [];
  if (a.labels.length !== b.labels.length) faults.push(`count ${a.labels.length} against ${b.labels.length}`);
  else {
    a.labels.forEach((l, i) => { if (l !== b.labels[i]) faults.push(`label ${i}: '${l}' against '${b.labels[i]}'`); });
    a.heights.forEach((h, i) => { if (h === null || b.heights[i] === null || Math.abs(h - b.heights[i]) > px) faults.push(`height ${i}: ${h} against ${b.heights[i]}`); });
  }
  return { ok: faults.length === 0, faults };
}
