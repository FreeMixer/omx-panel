// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * A control a declared panel shows only for certain values of another (the description's `visibleWhen` and `mask`,
 * docs/panel-layout.md "Visibility") is drawn by value: hidden, it is drawn exactly as a description without it, and a
 * section it empties takes no space; shown, exactly as a description with no rule. The governing value is the come-up
 * one (`visibleWhen.default`) until the host sets it (the state's `integers`). An arm reads `atLeast` as an equality and
 * the "shown" check goes red.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { FIXTURES, compare, descriptionFile, rects, render, scratch, stateFile } from './harness.mjs';

const fx = FIXTURES.find((f) => f.name === 'zamcomp-panel');
/** The governed controls: one of the first section's seven, the middle section's only one, and both of the last's. */
const GOVERNED = ['rat', 'mak', 'gr', 'outlevel'];
const ALL = (1n << 64n) - 1n;
const atLeast = (n) => (ALL ^ ((1n << BigInt(n)) - 1n)).toString(16);

/** The fixture's description and state, `edit` applied to the description, in files. */
function files(edit = (x) => x, { integers, dropState = [] } = {}) {
  const dir = scratch();
  const x = edit(JSON.parse(readFileSync(descriptionFile(fx, dir), 'utf8')));
  const d = join(dir, 'edited.layout.json');
  writeFileSync(d, JSON.stringify(x));
  const state = JSON.parse(readFileSync(stateFile(fx, dir), 'utf8'));
  for (const s of dropState) delete state.values[s];
  if (integers) state.integers = integers;
  const st = join(dir, 'edited.state.json');
  writeFileSync(st, JSON.stringify(state));
  return [d, st];
}

/** `GOVERNED` shown by `mode` with `mask`, its come-up value `def`. */
const governed = (mask, def) => (x) => ({
  ...x,
  controls: x.controls.map((c) => (GOVERNED.includes(c.symbol) ? { ...c, visible: 99, mask, visibleWhen: { symbol: 'mode', default: def } } : c)),
});

/** The description without the `GOVERNED` controls and without the sections they emptied. */
function without(x) {
  const controls = x.controls.filter((k) => !GOVERNED.includes(k.symbol));
  const kept = x.sections.map((_s, i) => controls.some((k) => k.section === i));
  assert.deepEqual(kept, [true, false, false], 'the middle and the last sections are emptied');
  const index = kept.map((_k, i) => kept.slice(0, i).filter(Boolean).length);
  return { ...x, sections: x.sections.filter((_s, i) => kept[i]), controls: controls.map((k) => ({ ...k, section: index[k.section] })) };
}

const same = (a, b, what) => {
  const d = compare(a, b);
  assert.ok(d.sameSize && d.exact, `${what}: ${a.w}x${a.h} against ${b.w}x${b.h}, ${d.off} pixels differ`);
};

const plain = () => render(...files());
const absent = () => render(...files(without, { dropState: GOVERNED }));

test('hidden at its come-up value: drawn exactly as the panel without it, its emptied section taking no space', () => {
  for (const scale of [1, 2]) {
    const [d, st] = files(governed(atLeast(2), 1));
    same(render(d, st, { scale }), render(...files(without, { dropState: GOVERNED }), { scale }), `${scale}x`);
  }
  const [d] = files(governed(atLeast(2), 1));
  const cells = rects(d);
  // --rects writes "hidden" for a control with no cell
  JSON.parse(readFileSync(d, 'utf8')).controls.forEach((c, i) => {
    assert.equal(cells[i].length === 1 && Number.isNaN(cells[i][0]), GOVERNED.includes(c.symbol), `${c.symbol}: ${cells[i]}`);
  });
});

test('shown once the host sets the governing value, exactly as the panel with no rule', () => {
  for (const mode of [2, 9, 63]) same(render(...files(governed(atLeast(2), 1), { integers: { mode } })), plain(), `mode ${mode}`);
  same(render(...files(governed(atLeast(2), 1), { integers: { mode: 1 } })), absent(), 'mode 1');
  // the come-up value alone shows it when its bit is set
  same(render(...files(governed(atLeast(2), 5))), plain(), 'come-up 5');
  // a value outside 0..63 shows nothing that a rule governs
  same(render(...files(governed(atLeast(0), 1), { integers: { mode: 64 } })), absent(), 'mode 64');
});

test('sabotage: atLeast read as an equality hides the control at a larger value, and the "shown" check goes red', () => {
  const equals = (n) => (1n << BigInt(n)).toString(16);
  assert.throws(() => same(render(...files(governed(equals(2), 1), { integers: { mode: 9 } })), plain(), 'mode 9'), assert.AssertionError);
});

test('a description whose rule lacks its mask is refused', () => {
  const [d, st] = files((x) => ({ ...x, controls: x.controls.map((c) => (c.symbol === GOVERNED[0] ? { ...c, visibleWhen: { symbol: 'mode', default: 1 }, mask: undefined } : c)) }));
  assert.throws(() => render(d, st), /visibleWhen/);
});

test('the state may not set a value no control is governed by', () => {
  assert.throws(() => render(...files(undefined, { integers: { mode: 2 } })), /governs no control/);
});
