#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * compare.test.mjs — Compare A/B/C/D and the undo ring (docs/compare.md), by value: each op's document and moves, and the
 * same vectors through the command a host that is not JavaScript runs.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COMPARE_FORMAT, COMPARE_SLOTS, CompareRefused, RING_BOUND, capture, copyTo, emptyCompare, emptyRing, filledSlots, redo, switchTo, undo } from '../tools/compare.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'omx-panel.mjs');
const run = (op, input, ...args) => {
  const r = spawnSync(process.execPath, [CLI, 'compare', op, ...args], { input: JSON.stringify(input), encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr, out: r.status === 0 ? JSON.parse(r.stdout) : null };
};

test('the slots are four, the document names its format, and a new one holds nothing', () => {
  assert.deepEqual(COMPARE_SLOTS, ['A', 'B', 'C', 'D']);
  assert.deepEqual(emptyCompare(), { format: COMPARE_FORMAT, active: 'A', slots: {} });
  assert.equal(COMPARE_FORMAT, 'org.openmixer.compare/1');
});

test('going to an empty slot takes a copy: nothing moves', () => {
  const r = switchTo(emptyCompare(), { t: -18, r: 3 }, 'B');
  assert.deepEqual(r.moves, []);
  assert.deepEqual(r.doc, { format: COMPARE_FORMAT, active: 'B', slots: { A: { t: -18, r: 3 }, B: { t: -18, r: 3 } } });
  assert.deepEqual(filledSlots(r.doc), ['A', 'B']);
});

test('A to B and back brings each set of values back, with a move per control that differs, sorted', () => {
  const inB = switchTo(emptyCompare(), { t: -18, r: 3, k: 1 }, 'B').doc;
  const toA = switchTo(inB, { t: -30, r: 8, k: 1 }, 'A');
  assert.deepEqual(toA.moves, [{ symbol: 'r', value: 3 }, { symbol: 't', value: -18 }]);
  assert.deepEqual(toA.doc.slots.B, { t: -30, r: 8, k: 1 });
  const toB = switchTo(toA.doc, { t: -18, r: 3, k: 1 }, 'B');
  assert.deepEqual(toB.moves, [{ symbol: 'r', value: 8 }, { symbol: 't', value: -30 }]);
});

test('going to the slot it is in stores nothing new and moves nothing', () => {
  const doc = emptyCompare();
  assert.deepEqual(switchTo(doc, { t: 1 }, 'A'), { doc, moves: [], unknown: [] });
});

test('a control the slot holds and the plugin does not is named and kept; one the slot lacks keeps its value', () => {
  const doc = { format: COMPARE_FORMAT, active: 'A', slots: { B: { t: -30, gone: 7 } } };
  const r = switchTo(doc, { t: -18, added: 2 }, 'B');
  assert.deepEqual(r.moves, [{ symbol: 't', value: -30 }]);
  assert.deepEqual(r.unknown, ['gone']);
  const back = switchTo(r.doc, { t: -30, added: 2 }, 'A');
  assert.equal(back.doc.slots.B.gone, 7, 'leaving the slot does not lose it');
});

test('copy puts the running values in another slot and moves nothing; onto the running slot it is refused', () => {
  const r = copyTo(emptyCompare(), { t: 1 }, 'C');
  assert.deepEqual(r.moves, []);
  assert.deepEqual(r.doc.slots, { C: { t: 1 } });
  assert.equal(r.doc.active, 'A');
  assert.throws(() => copyTo(emptyCompare(), { t: 1 }, 'A'), (e) => e instanceof CompareRefused && e.code === 'COMPARE_COPY_TO_RUNNING');
});

test('a slot that is not one, a document of another format and a value that is no number are refused', () => {
  assert.throws(() => switchTo(emptyCompare(), {}, 'E'), (e) => e.code === 'COMPARE_NO_SLOT');
  assert.throws(() => switchTo({ format: 'x', active: 'A', slots: {} }, {}, 'B'), (e) => e.code === 'COMPARE_FORMAT');
  assert.throws(() => switchTo(emptyCompare(), { t: 'loud' }, 'B'), (e) => e.code === 'COMPARE_VALUE');
  assert.throws(() => switchTo(emptyCompare(), { t: Number.NaN }, 'B'), (e) => e.code === 'COMPARE_VALUE');
});

test('undo and redo step the values with moves, and stand still at either end', () => {
  let ring = capture(emptyRing(), { t: 1 });
  ring = capture(ring, { t: 2 });
  assert.equal(capture(ring, { t: 2 }), ring, 'the same values twice are one step');
  const u = undo(ring, { t: 3 });
  assert.deepEqual(u.moves, [{ symbol: 't', value: 2 }]);
  const u2 = undo(u.ring, { t: 2 });
  assert.deepEqual(u2.moves, [{ symbol: 't', value: 1 }]);
  const u3 = undo(u2.ring, { t: 1 });
  assert.deepEqual(u3.moves, []);
  assert.equal(u3.ring, u2.ring);
  const r = redo(u2.ring, { t: 1 });
  assert.deepEqual(r.moves, [{ symbol: 't', value: 2 }]);
  const r2 = redo(r.ring, { t: 2 });
  assert.deepEqual(r2.moves, [{ symbol: 't', value: 3 }]);
  assert.deepEqual(redo(r2.ring, { t: 3 }).moves, []);
});

test('a step that equals what is running is skipped, and a new capture ends the redo', () => {
  const ring = capture(capture(emptyRing(), { t: 1 }), { t: 2 });
  assert.deepEqual(undo(ring, { t: 2 }).moves, [{ symbol: 't', value: 1 }]);
  const u = undo(ring, { t: 9 });
  assert.equal(capture(u.ring, { t: 5 }).redo.length, 0);
});

test('the ring holds the last 64, oldest out', () => {
  let ring = emptyRing();
  for (let i = 0; i < RING_BOUND + 5; i++) ring = capture(ring, { t: i });
  assert.equal(RING_BOUND, 64);
  assert.equal(ring.undo.length, 64);
  assert.deepEqual(ring.undo[0], { t: 5 });
});

test('the command is the same module: the document, the moves, a queue of captures, a refusal', () => {
  const s = run('switch', { doc: { format: COMPARE_FORMAT, active: 'A', slots: { B: { t: -30 } } }, values: { t: -18 } }, '--to', 'B');
  assert.equal(s.status, 0, s.stderr);
  assert.deepEqual(s.out.moves, [{ symbol: 't', value: -30 }]);
  assert.deepEqual(s.out.doc.slots.A, { t: -18 });
  const fresh = run('switch', { values: { t: 1 } }, '--to', 'C');
  assert.deepEqual(fresh.out.doc.slots, { A: { t: 1 }, C: { t: 1 } });
  const c = run('copy', { values: { t: 1 } }, '--to', 'D');
  assert.deepEqual(c.out.doc.slots, { D: { t: 1 } });
  const u = run('undo', { captures: [{ t: 1 }, { t: 2 }], values: { t: 3 } });
  assert.deepEqual(u.out.moves, [{ symbol: 't', value: 2 }]);
  assert.deepEqual(u.out.ring.redo, [{ t: 3 }]);
  const rr = run('redo', { ring: u.out.ring, values: { t: 2 } });
  assert.deepEqual(rr.out.moves, [{ symbol: 't', value: 3 }]);
  const no = run('switch', { values: {} }, '--to', 'Z');
  assert.equal(no.status, 1);
  assert.match(no.stderr, /COMPARE_NO_SLOT/);
  assert.equal(run('nothing', {}).status, 2);
});
