// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The parity harness's tolerance mode (the one-panel spec §7.5, Q7), held by value: a stroke within 1 px (the console) or 2 px (Tk) of the
 * renderer's both ways, bar heights within a pixel, bar count, order and labels equal as text. Each check has an arm that breaks its input
 * and reads it go red. The curves come from omx-dsp's twin through the MOD GUI's own computation, so the tests need it.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { FIXTURES, ROOT, barHeights, barParity, descriptionFile, render, rects, scratch, skipWithoutTwin, stateFile, strokeParity, strokePixels } from './harness.mjs';

const g = JSON.parse(readFileSync(join(ROOT, 'tools/look/geometry.json'), 'utf8')).geometry;
const fxEq = FIXTURES.find((f) => f.name === 'eq-marks');
const fxOrgan = FIXTURES.find((f) => f.name === 'organ');
// the curve frame of the EQ fixture at 1x: one section of 12 controls (8 to a row), the curve row under its title
const FRAME = { x: g.pad + g.sectionPad, y: g.sectionTop + g.sectionTitleH, w: 8 * g.cellW + 2 * g.sectionPad - 2 * g.sectionPad, h: g.curveH };

const drawn = () => { const dir = scratch(); return render(descriptionFile(fxEq, dir), stateFile(fxEq, dir)); };
/** `img` with its curve layer moved by (dx, dy): the inner area of the frame shifted, the body colour filling what it leaves. */
function shifted(img, dx, dy) {
  const out = { ...img, data: new Uint8Array(img.data) };
  const at = (x, y) => (y * img.w + x) * 4;
  const body = img.data.slice(at(FRAME.x + 6, FRAME.y + 6), at(FRAME.x + 6, FRAME.y + 6) + 4);
  for (let y = FRAME.y + 5; y < FRAME.y + FRAME.h - 17; y++) for (let x = FRAME.x + 5; x < FRAME.x + FRAME.w - 5; x++) out.data.set(body, at(x, y));
  for (let y = FRAME.y + 5; y < FRAME.y + FRAME.h - 17; y++) for (let x = FRAME.x + 5; x < FRAME.x + FRAME.w - 5; x++) {
    const sx = x - dx, sy = y - dy;
    if (sx >= FRAME.x + 5 && sx < FRAME.x + FRAME.w - 5 && sy >= FRAME.y + 5 && sy < FRAME.y + FRAME.h - 17) out.data.set(img.data.slice(at(sx, sy), at(sx, sy) + 4), at(x, y));
  }
  return out;
}

test('a stroke is within 1 px of itself, and a pixel off is still within 1 px', skipWithoutTwin(fxEq), () => {
  const a = drawn();
  const sa = strokePixels(a, FRAME);
  assert.ok(sa.length > 200, 'there is a stroke to compare');
  assert.ok(strokeParity(sa, sa, 1).ok);
  assert.ok(strokeParity(sa, strokePixels(shifted(a, 1, 0), FRAME), 1).ok);
  assert.ok(strokeParity(sa, strokePixels(shifted(a, 0, 1), FRAME), 1).ok);
});
test('arm: two pixels off fails the console\'s 1 px and passes Tk\'s 2 px', skipWithoutTwin(fxEq), () => {
  const a = drawn(), sa = strokePixels(a, FRAME), sb = strokePixels(shifted(a, 0, 2), FRAME);
  assert.ok(!strokeParity(sa, sb, 1).ok);
  assert.ok(strokeParity(sa, sb, 2).ok);
  assert.ok(!strokeParity(sa, strokePixels(shifted(a, 0, 4), FRAME), 2).ok);
});
test('arm: the check runs both ways: a stroke the other lacks, and one the first lacks, are each refused', skipWithoutTwin(fxEq), () => {
  const sa = strokePixels(drawn(), FRAME);
  const half = sa.filter(([x]) => x < FRAME.x + FRAME.w / 2);
  // `half` lacks the right half of the stroke: from the full one's side that is a stroke with no match, from the other's side nothing is extra
  const there = strokeParity(sa, half, 1), back = strokeParity(half, sa, 1);
  assert.ok(there.missing.length > 0 && there.extra.length === 0);
  assert.ok(back.missing.length === 0 && back.extra.length > 0);
  assert.ok(!there.ok && !back.ok);
  assert.ok(!strokeParity([], sa, 1).ok, 'no stroke at all is no parity');
});

const barsOfOrgan = (state) => {
  const dir = scratch();
  const desc = descriptionFile(fxOrgan, dir);
  const img = render(desc, state ?? stateFile(fxOrgan, dir));
  const r = rects(desc).slice(0, 9);
  const labels = JSON.parse(readFileSync(desc, 'utf8')).sections[0].bars[0].labels;
  return { labels, heights: barHeights(img, r), dir, desc };
};
test('the drawbars: the renderer against itself, and against a surface a pixel off', () => {
  const a = barsOfOrgan();
  assert.equal(a.heights.length, 9);
  assert.ok(a.heights.every((h) => h > 0));
  assert.ok(barParity(a, a).ok);
  assert.ok(barParity(a, { ...a, heights: a.heights.map((h) => h + 1) }).ok);
});
test('arm: a bar two pixels off, a missing bar, a label changed or out of order, are each refused', () => {
  const a = barsOfOrgan();
  assert.ok(!barParity(a, { ...a, heights: a.heights.map((h, i) => (i === 3 ? h + 2 : h)) }).ok);
  assert.ok(!barParity(a, { labels: a.labels.slice(1), heights: a.heights.slice(1) }).ok);
  assert.ok(!barParity(a, { ...a, labels: a.labels.map((l, i) => (i === 0 ? `${l} ` : l)) }).ok);
  const swapped = [...a.labels];
  [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  assert.ok(!barParity(a, { ...a, labels: swapped }).ok);
});
test('the heights are the bars\' values: moving a drawbar moves its height by its travel', () => {
  const a = barsOfOrgan();
  const dir = scratch();
  const st = JSON.parse(readFileSync(stateFile(fxOrgan, dir), 'utf8'));
  st.values.db3 = { fraction: 1, text: '8' };
  const file = join(dir, 'moved.state.json');
  writeFileSync(file, JSON.stringify(st));
  const b = barsOfOrgan(file);
  assert.ok(b.heights[3] > a.heights[3] + 10);
  assert.ok(!barParity(a, b).ok);
  assert.deepEqual(b.heights.filter((_, i) => i !== 3), a.heights.filter((_, i) => i !== 3));
});
