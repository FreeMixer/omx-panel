// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The page sequence of the parity fixtures (one-panel spec 7.5 and 7.14): every fixture the repo draws, cut at 4 (Zynthian)
 * and 8 (the console, the X-Touch, CLAP remote-controls) by the one cut, holds the same controls in the same order and the
 * same boundaries (a boundary at 8 is a boundary at 4), a skin's reorder moves the first page at both widths, and a hidden
 * band leaves blank slots at both with no reflow. Drawing is not touched: the renderer's parity test runs unchanged.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { describe } from '../dist/tools/describe.mjs';
import { pagesOf, panelLayout } from '../dist/tools/panel-description.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const json = (f) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
const FIXTURES = [
  ['organ (the upper drawbars)', 'test/fixtures/organ/organ.descriptor.json'],
  ['an EQ with bands', 'test/fixtures/eq-marks/eq.descriptor.json', 'test/fixtures/eq-marks/eq.panel.json'],
  ['a compressor', 'test/fixtures/dyn-curve/dyn.descriptor.json', 'test/fixtures/dyn-curve/dyn.panel.json'],
  ['ZamComp, laid out from its scan', 'examples/worked-example/zamcomp/zamcomp.descriptor.json'],
  ['ZamComp, under its panel', 'examples/worked-example/zamcomp/zamcomp.descriptor.json', 'examples/worked-example/zamcomp/zamcomp.panel.json'],
  ['omx-delay', 'test/fixtures/omx-delay/omx-delay.descriptor.json', 'test/fixtures/omx-delay/omx-delay.panel.json'],
];
const laidOut = (descriptor, panel) => panelLayout(json(descriptor), { panel: panel ? json(panel) : undefined });

// the page boundaries, as the index in the non-blank sequence at which a page starts
const starts = (pages) => {
  let n = 0;
  return new Set(pages.map((p) => { const at = n; n += p.ids.filter((i) => i !== null).length; return at; }));
};
const sequence = (pages) => pages.flatMap((p) => p.ids).filter((i) => i !== null);

for (const [name, descriptor, panel] of FIXTURES) {
  test(`${name}: the same controls in the same order at 4 and 8, every wide boundary a narrow one, each control once`, () => {
    const x = laidOut(descriptor, panel);
    const four = pagesOf(x, { perPage: 4 }), eight = pagesOf(x, { perPage: 8 });
    assert.deepEqual(sequence(four), sequence(eight), 'order');
    assert.equal(new Set(sequence(eight)).size, x.controls.length, 'every control once');
    for (const at of starts(eight)) assert.ok(starts(four).has(at), `the page that starts at control ${at} at 8 starts a page at 4`);
    assert.ok(four.every((p) => p.ids.length === 4) && eight.every((p) => p.ids.length === 8));
    assert.equal(four[0].pageName, 'Easy');
    assert.equal(eight[0].pageName, 'Easy');
  });
}

test('an 8-band graphic EQ\'s bar group is one section kept whole: at 8 on one page, at 4 split only at its own boundary', () => {
  const controls = Array.from({ length: 8 }, (_, i) => ({ id: `g${i}`, symbol: `g${i}`, name: `${i}`, kind: 'travel', meaning: 'band_gain', travel: { min: -12, max: 12, unit: 'dB', scale: 'linear', default: 0 } }));
  const d = { origin: 'scanned', plugin: { id: 'urn:test:geq', format: 'lv2', name: 'GEQ', features: ['audio-effect'] }, controls: [...controls, { id: 'out', symbol: 'out', name: 'Out', kind: 'travel', travel: { min: -12, max: 12, unit: 'dB', scale: 'linear', default: 0 } }], ports: [], easy: ['out'] };
  const skin = { schema: 1, plugin: 'urn:test:geq', licence: 'CC0-1.0', sections: [{ key: 'bands', label: 'Bands', bars: true, controls: controls.map((c) => c.symbol) }, { key: 'out', label: 'Out', controls: ['out'] }] };
  const at8 = describe(d, { skin, perPage: 8 }).description.pages, at4 = describe(d, { skin, perPage: 4 }).description.pages;
  assert.deepEqual(at8.map((p) => [p.pageName, p.ids.filter((i) => i !== null)]), [['Easy', ['out']], ['Bands', controls.map((c) => c.id)]]);
  assert.deepEqual(at4.map((p) => p.ids.filter((i) => i !== null).length), [1, 4, 4]);
  assert.deepEqual(sequence(at4), sequence(at8));
});

for (const perPage of [4, 8]) {
  test(`a skin's sections reorder moves the first page, and its easy wins, at ${perPage}`, () => {
    const d = json('test/fixtures/omx-delay/omx-delay.descriptor.json');
    const panel = json('test/fixtures/omx-delay/omx-delay.panel.json');
    const symbols = d.controls.map((c) => c.symbol ?? c.id);
    const skin = (extra) => ({ schema: 1, plugin: d.plugin.id, licence: 'CC0-1.0', ...extra });
    const first = (s) => describe(d, { panel, skin: s, perPage }).description.pages[0];
    const bare = first(skin({ easy: [] }));
    const reorder = first(skin({ easy: [], sections: [{ key: 'last', label: 'Last', controls: [...symbols].reverse() }] }));
    assert.notDeepEqual(reorder.ids, bare.ids, 'the reorder moved the first page');
    assert.equal(reorder.pageName === 'Last' || reorder.pageName.startsWith('Last:'), true);
    const one = first(skin({ easy: [symbols[2]] }));
    assert.equal(one.pageName, 'Easy');
    assert.equal(one.ids[0], d.controls[2].id);
  });
}
