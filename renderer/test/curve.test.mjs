// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The renderer's curve (the one-panel spec §7.2): drawn from points the host gives, never computed inside; the axes and the basis
 * word from the description; the frame and the word alone while no points were given. Held by value: the stroke is where the
 * mapping of the points to the frame puts it, a bar's cell is the control's, and a refused set of points changes nothing.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CLI, DATA, FIXTURES, ROOT, descriptionFile, render, rects, scratch, stateFile } from './harness.mjs';

const fx = FIXTURES.find((f) => f.name === 'dyn-curve');
const look = JSON.parse(readFileSync(join(ROOT, 'tools/look.json'), 'utf8')).tokens;
const ACCENT = [1, 3, 5].map((i) => parseInt(look['--accent'].slice(i, i + 2), 16));
const geometry = JSON.parse(readFileSync(join(DATA, 'look/geometry.json'), 'utf8')).geometry;

const BODY = [1, 3, 5].map((i) => parseInt(look['--surface-3'].slice(i, i + 2), 16));
/** The stroke's pixels inside `frame`: a pixel that is the accent over the frame's body, part way (the stroke is a hairline, so its
 * edge pixels blend): along the body-to-accent line by at least 0.4 and off it by less than 25. */
function strokes(img, frame) {
  const out = [], d = ACCENT.map((c, k) => c - BODY[k]), dd = d.reduce((s, v) => s + v * v, 0);
  for (let y = frame.y + 5; y < frame.y + frame.h - 17; y++) for (let x = frame.x + 5; x < frame.x + frame.w - 5; x++) {
    const i = (y * img.w + x) * 4, p = [0, 1, 2].map((k) => img.data[i + k] - BODY[k]);
    const t = p.reduce((s, v, k) => s + v * d[k], 0) / dd;
    const off = Math.hypot(...p.map((v, k) => v - t * d[k]));
    if (t > 0.4 && off < 25) out.push([x, y]);
  }
  return out;
}
const near = (pixels, [x, y], r = 1.5) => pixels.some(([px, py]) => Math.hypot(px - x, py - y) <= r);

// the frame at scale 1: the section's, after the title, the section padding in
const g = geometry;
const FRAME = { x: g.pad + g.sectionPad, y: g.sectionTop + g.sectionTitleH, w: 5 * g.cellW + 2 * g.sectionPad - 2 * g.sectionPad, h: g.curveH };
const inner = { ix: FRAME.x + 5, iy: FRAME.y + 5, iw: FRAME.w - 10, ih: FRAME.h - 10 - 12 };

const withCurves = (dir, curves, kind) => {
  let desc = descriptionFile(fx, dir);
  if (kind) {
    const d = JSON.parse(readFileSync(desc, 'utf8'));
    d.displays[0].kind = kind;
    desc = join(dir, 'edited.layout.json');
    writeFileSync(desc, JSON.stringify(d, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  }
  const state = JSON.parse(readFileSync(stateFile(fx, dir), 'utf8'));
  const file = join(dir, 'curved.state.json');
  writeFileSync(file, JSON.stringify({ ...state, curves }));
  return { desc, state: file };
};

test('with no points the display is its frame and its basis word, and no stroke', () => {
  const dir = scratch();
  const img = render(descriptionFile(fx, dir), stateFile(fx, dir));
  assert.deepEqual(strokes(img, FRAME), []);
});

test('a transfer curve is drawn at the frame positions the points map to: linear dB, one span for input and output', () => {
  const dir = scratch();
  const x = Array.from({ length: 81 }, (_, i) => -80 + i);
  const y = x.map((v) => (v < -20 ? v : -20 + (v + 20) / 4));
  const { desc, state } = withCurves(dir, { 0: { x, y } });
  const px = strokes(render(desc, state), FRAME);
  assert.ok(px.length > 100);
  const at = (xv, yv) => [inner.ix + ((xv + 80) / 80) * inner.iw, inner.iy + inner.ih - ((yv + 80) / 80) * inner.ih];
  for (const [xv, yv] of [[-80, -80], [-50, -50], [-20, -20], [-10, -17.5], [0, -15]]) assert.ok(near(px, at(xv, yv)), `the stroke passes (${xv}, ${yv}) at ${at(xv, yv)}`);
  // arm: a knee moved by 10 dB is another stroke: (-20,-20) is on the original and no longer on the moved one
  const moved = withCurves(dir, { 0: { x, y: x.map((v) => (v < -10 ? v : -10 + (v + 10) / 4)) } });
  const pm = strokes(render(moved.desc, moved.state), FRAME);
  assert.ok(near(pm, at(-10, -10)) && !near(pm, at(0, -15), 1));
});

test('an eq response is a log frequency axis with dB symmetric about 0: its ends sit on the frame and 0 dB on the middle line', () => {
  const dir = scratch();
  const x = Array.from({ length: 121 }, (_, i) => 20 * Math.pow(1000, i / 120));
  const y = x.map((f) => 9 * Math.exp(-Math.pow(Math.log2(f / 1000) / 0.8, 2)));
  const { desc, state } = withCurves(dir, { 0: { x, y } }, 'eq_response');
  const px = strokes(render(desc, state), FRAME);
  const mid = inner.iy + inner.ih / 2, top = 12; // the next 6 dB above 9 is 12
  assert.ok(near(px, [inner.ix, mid]), 'the first point, 20 Hz at 0 dB, is the left end on the middle');
  assert.ok(near(px, [inner.ix + inner.iw, mid]), 'the last, 20 kHz');
  assert.ok(near(px, [inner.ix + 0.5 * inner.iw, mid - (y[60] / top) * (inner.ih / 2)]), '1 kHz, at the log middle, 9 dB up');
});

test('points that do not ascend, or are not finite, are refused and the panel is not drawn', () => {
  const dir = scratch();
  for (const bad of [{ x: [-80, -80, 0], y: [0, 0, 0] }, { x: [-80, -40, 0], y: [0, 'x', 0] }, { x: [-80], y: [0] }, { x: [-80, 0], y: [0] }]) {
    const { desc, state } = withCurves(dir, { 0: bad });
    assert.throws(() => render(desc, state), /./);
  }
  const { desc, state } = withCurves(dir, { 7: { x: [-80, 0], y: [-80, 0] } });
  assert.throws(() => render(desc, state), /./, 'a display the panel does not have');
});

test('a bar is its control cell: the control rect of a drawbar is where the row puts it, one cell wide', () => {
  const organ = FIXTURES.find((f) => f.name === 'organ');
  const dir = scratch();
  const r = rects(descriptionFile(organ, dir));
  assert.equal(r.length, 11);
  const [a, b] = r;
  assert.equal(b[0] - a[0], g.cellW);
  assert.equal(a[2], g.cellW);
  assert.equal(a[1], b[1]);
});
