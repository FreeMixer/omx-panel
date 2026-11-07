// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The MOD GUI's static curve (the one-panel spec §7.4, Q6, §7.6): the polyline in the template and the screenshot, computed by omx-dsp's
// TypeScript twin at the come-up values, with its caption word; a mark at each band an authored descriptor declares a planter's, and
// none where no origin is declared. Needs the twin (`@openmixer/omx-dsp`, not yet released): skipped without it, unless OMX_PANEL_DSP=required.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { generateModgui, resolvePanel, curveGeometry, STATIC_CURVE } from '../tools/modgui-gen.mjs';
import { panelLayout } from '../tools/panel-description.mjs';

const twin = await import('@openmixer/omx-dsp').then((m) => m, () => null);
const opts = twin ? {} : { skip: 'omx-dsp twin (@openmixer/omx-dsp) not installed' };
const read = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const eq = () => [read('eq-marks/eq.descriptor.json'), read('eq-marks/eq.panel.json')];
const dyn = () => [read('dyn-curve/dyn.descriptor.json'), read('dyn-curve/dyn.panel.json')];
const html = (d, panel) => new Map(generateModgui(d, { panel, stem: 'x', source: 'test' })).get('modgui/icon-x.html').toString();
const polyline = (h) => h.match(/<polyline class="omx-curve-line" fill="none" points="([^"]+)"/)[1].split(' ').map((p) => p.split(',').map(Number));

test('a compressor\'s static curve is the twin\'s transfer curve at the come-up values, as a polyline of its points', opts, () => {
  const [d, panel] = dyn();
  const sec = resolvePanel(d, { panel, stem: 'x' }).sections[0];
  const want = twin.curvePoints({
    kind: 'transfer_curve', family: 'dynamics', ...STATIC_CURVE,
    terms: [['threshold', 'dB', -18], ['ratio', 'ratio', 4]].map(([role, unit, value]) => ({ role, value, unit: unit === 'dB' ? 'db' : unit })),
  });
  assert.equal(sec.displays[0].curve.points.length, want.points.length);
  assert.deepEqual(sec.displays[0].curve.points, want.points);
  const line = polyline(html(d, panel));
  assert.equal(line.length, want.points.length);
  // below the knee the output is the input (the unity line), above it the 4:1 slope: the stroke bends where the threshold is
  const geo = curveGeometry(sec.displays[0].curve, 'transfer_curve', 360, 84, 1);
  assert.deepEqual(geo.poly.map((p) => p.map((v) => Math.round(v * 100) / 100)), line);
  const slope = (a, b) => (b[1] - a[1]) / (b[0] - a[0]);
  assert.ok(Math.abs(slope(line[2], line[3]) - slope(line[5], line[6])) < 0.02, 'a straight line below the knee');
  assert.ok(slope(line.at(-3), line.at(-2)) > slope(line[2], line[3]), 'flatter above it (screen y grows downward)');
});
test('arm: a different ratio is a different stroke', opts, () => {
  const [d, panel] = dyn();
  const was = polyline(html(d, panel));
  d.controls.find((c) => c.symbol === 'ratio').travel.default = 10;
  assert.notDeepEqual(polyline(html(d, panel)), was);
});
test('the screenshot carries the stroke: it differs from the frame-only face', opts, () => {
  const [d, panel] = dyn();
  const shot = (x) => new Map(generateModgui(x, { panel, stem: 'x', source: 't' })).get('modgui/screenshot-x.png');
  const with_ = shot(d);
  d.controls.find((c) => c.symbol === 'ratio').travel.default = 10;
  assert.ok(!with_.equals(shot(d)));
});

test('an EQ with two planted bands carries two marks, each at the band\'s own depth, the letter of its planter', opts, () => {
  const [d, panel] = eq();
  const curve = resolvePanel(d, { panel, stem: 'x' }).sections[0].displays[0].curve;
  assert.deepEqual(curve.marks.map((m) => [m.freq, m.origin]), [[1000, 'fbs-fixed'], [3150, 'hrp']]);
  const h = html(d, panel);
  assert.equal(h.match(/<circle /g).length, 2);
  assert.deepEqual([...h.matchAll(/<text [^>]*>([A-Z])<\/text>/g)].map((m) => m[1]), ['F', 'H']);
  // the mark sits on the stroke: its x is the log position of its frequency
  const geo = curveGeometry(curve, 'eq_response', 360, 84, 1);
  assert.ok(geo.marks[0].at[0] < geo.marks[1].at[0]);
});
test('arm: with no origins declared there are no marks: nothing is inferred', opts, () => {
  const [d, panel] = eq();
  delete panel.origins;
  const h = html(d, panel);
  assert.ok(!h.includes('<circle'));
  assert.ok(h.includes('omx-curve-line'));
});

test('an origin is declared by an authored descriptor, from the closed set, on a band_freq role', () => {
  const [d, panel] = eq();
  assert.throws(() => panelLayout({ ...d, origin: 'scanned' }, { panel }), /only an authored descriptor declares an origin/);
  assert.throws(() => panelLayout(d, { panel: { ...panel, origins: { f1: 'someone' } } }), /none of fbs-fixed, fbs-live, hrp, room-mode/);
  assert.throws(() => panelLayout(d, { panel: { ...panel, origins: { g1: 'hrp' } } }), /no band_freq role/);
  const layout = panelLayout(d, { panel });
  assert.deepEqual(layout.roles.filter((r) => r.origin).map((r) => [r.symbol, r.origin]), [['f1', 'fbs-fixed'], ['f2', 'hrp']]);
});
test('the origin words are the twin\'s', opts, async () => {
  const { BAND_ORIGINS } = await import('../tools/panel-description.mjs');
  assert.deepEqual(['user', ...BAND_ORIGINS], twin.CURVE_WORDS.origins);
});
