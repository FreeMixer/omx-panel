// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * bars.test.mjs — the bar group of a section (tools/bars.mjs, the one-panel spec §6, FreeMixer/omx-panel#135): a rule held by
 * value, each check with an arm that breaks its input and reads the result change. setBfree's upper drawbars, an 8-band graphic
 * EQ and a 16-step sequencer become bar groups; 3 matching controls, mixed ranges or units, labels out of series stay knobs.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { barsOf, BARS_CODES, MAX_BARS } from '../tools/bars.mjs';
import { BarsRefused, panelLayout } from '../tools/panel-description.mjs';

const travel = (label, extra = {}, t = {}) => ({ id: label, name: label, label, kind: 'travel', travel: { min: 0, max: 8, step: 1, unit: 'unknown', scale: 'stepped', default: 0, ...t }, ...extra });
const items = (controls) => controls.map((c) => ({ symbol: c.id, label: c.label, control: c }));
const runsOf = (controls, declared) => barsOf(items(controls), declared).runs;
const FOOT = ["16'", "5 1/3'", "8'", "4'", "2 2/3'", "2'", "1 3/5'", "1 1/3'", "1'"];

test('setBfree upper drawbars, by footage, are one bar group labelled by the footage', () => {
  const [run] = runsOf(FOOT.map((f) => travel(f)));
  assert.deepEqual(run.labels, FOOT);
  assert.equal(run.controls.length, 9);
});
test('a footage also reads as `DB <footage>`, the label the footage', () => {
  const [run] = runsOf(FOOT.map((f) => travel(`DB ${f}`)));
  assert.deepEqual(run.labels, FOOT);
});
test('an 8-band graphic EQ ("Band N Gain") is one group, the label the varying number', () => {
  const [run] = runsOf(Array.from({ length: 8 }, (_, i) => travel(`Band ${i + 1} Gain`, {}, { min: -12, max: 12, step: 0, unit: 'dB', scale: 'linear' })));
  assert.deepEqual(run.labels, ['1', '2', '3', '4', '5', '6', '7', '8']);
});
test('frequencies in rising order are a series, the label the frequency as written', () => {
  const labels = ['63 Hz', '125 Hz', '250 Hz', '500 Hz', '1k', '2 kHz', '4k', '8k'];
  const [run] = runsOf(labels.map((l) => travel(l)));
  assert.deepEqual(run.labels, labels);
});
test('arm: frequencies out of rising order are no series', () => {
  assert.deepEqual(runsOf(['63 Hz', '125 Hz', '100 Hz', '500 Hz', '1k'].map((l) => travel(l))), []);
});
test('a 16-step sequencer is one group of 16 labelled 1..16', () => {
  const [run] = runsOf(Array.from({ length: 16 }, (_, i) => travel(`Step ${i + 1}`)));
  assert.equal(run.controls.length, MAX_BARS);
  assert.equal(run.labels[15], '16');
});
test('a run longer than 16 is cut into runs of 16, in order; a remainder under 4 is no run, the same on every surface', () => {
  const runs = runsOf(Array.from({ length: 22 }, (_, i) => travel(`Partial ${i + 1}`)));
  assert.deepEqual(runs.map((r) => r.controls.length), [16, 6]);
  assert.equal(runs[1].labels[0], '17');
});
test('negative: 3 matching controls stay knobs', () => {
  assert.deepEqual(runsOf(Array.from({ length: 3 }, (_, i) => travel(`Step ${i + 1}`))), []);
});
test('negative arm: a tenth bar of a different range ends the run at nine, and it is still a group of nine', () => {
  const nine = FOOT.map((f) => travel(f));
  const [run, ...more] = runsOf([...nine, travel("1/2'", {}, { max: 100 })]);
  assert.equal(run.controls.length, 9);
  assert.equal(more.length, 0);
});
test('negative arm: a run of 4 where the fourth has another range is 3 matching controls, knobs', () => {
  assert.deepEqual(runsOf([travel('Step 1'), travel('Step 2'), travel('Step 3'), travel('Step 4', {}, { max: 100 })]), []);
});
test('negative arm: a different unit or scale in the run breaks it', () => {
  assert.deepEqual(runsOf([travel('Step 1'), travel('Step 2'), travel('Step 3'), travel('Step 4', {}, { unit: 'dB' }), travel('Step 5')]), []);
  assert.deepEqual(runsOf([travel('Step 1'), travel('Step 2'), travel('Step 3'), travel('Step 4', {}, { scale: 'linear' }), travel('Step 5')]), []);
});
test('negative arm: labels out of series are no group', () => {
  assert.deepEqual(runsOf([travel('Step 1'), travel('Step 2'), travel('Reverb'), travel('Step 4'), travel('Step 5')]), []);
});
test('negative arm: a toggle, a choice, a hidden or a read-only control is no bar and ends the run', () => {
  const four = Array.from({ length: 4 }, (_, i) => travel(`Step ${i + 1}`));
  for (const odd of [{ kind: 'toggle', travel: undefined }, { kind: 'choice', travel: undefined, ids: ['a'] }, { hidden: true }, { readonly: true }]) {
    assert.deepEqual(runsOf([...four.slice(0, 2), { ...four[2], ...odd }, ...four.slice(3), travel('Step 5')]), [], JSON.stringify(odd));
  }
});
test('the numbers must vary: four controls all labelled "Gain 1" are no series', () => {
  assert.deepEqual(runsOf(Array.from({ length: 4 }, (_, i) => travel('Gain 1', { id: `g${i}` }))), []);
});
test('two runs over different bands in one section are two groups, each with its own row', () => {
  const runs = runsOf([...FOOT.map((f) => travel(f)), travel('Other'), ...Array.from({ length: 5 }, (_, i) => travel(`Step ${i + 1}`))]);
  assert.deepEqual(runs.map((r) => r.controls.length), [9, 5]);
});
test('ties: gains, frequencies and Qs over the same bands: the level meaning takes the bars, the others are tied to each bar', () => {
  const band = (i) => [
    travel(`Band ${i} Freq`, { id: `f${i}`, meaning: 'frequency' }, { min: 20, max: 20000, step: 0, unit: 'Hz', scale: 'log' }),
  ];
  const freqs = Array.from({ length: 4 }, (_, i) => band(i + 1)[0]);
  const qs = Array.from({ length: 4 }, (_, i) => travel(`Q ${i + 1}`, { id: `q${i + 1}`, meaning: 'q' }, { min: 0.1, max: 10, step: 0, unit: 'unknown', scale: 'linear' }));
  const gains = Array.from({ length: 4 }, (_, i) => travel(`Gain ${i + 1}`, { id: `g${i + 1}`, meaning: 'gain' }, { min: -12, max: 12, step: 0, unit: 'dB', scale: 'linear' }));
  const [run, ...more] = runsOf([...freqs, ...qs, ...gains]);
  assert.deepEqual(run.controls, ['g1', 'g2', 'g3', 'g4']);
  assert.deepEqual(run.tied[0], ['f1', 'q1']);
  assert.equal(more.length, 0);
});
test('ties without a level meaning: the first run in the section takes the bars', () => {
  const a = Array.from({ length: 4 }, (_, i) => travel(`Freq ${i + 1}`, { id: `a${i}` }, { max: 1, step: 0, scale: 'linear' }));
  const b = Array.from({ length: 4 }, (_, i) => travel(`Amount ${i + 1}`, { id: `b${i}` }, { max: 5, step: 0, scale: 'linear' }));
  const [run] = runsOf([...a, ...b]);
  assert.deepEqual(run.controls, ['a0', 'a1', 'a2', 'a3']);
  assert.deepEqual(run.tied[2], ['b2']);
});
test('declared bars: false forbids the inference', () => {
  assert.deepEqual(runsOf(FOOT.map((f) => travel(f)), false), []);
});
test('declared bars: true takes the controls in order, and the checks still refuse by name', () => {
  const four = Array.from({ length: 4 }, (_, i) => travel(`Step ${i + 1}`));
  assert.equal(barsOf(items(four), true).runs[0].controls.length, 4);
  assert.equal(barsOf(items(four.slice(0, 3)), true).refusal.code, BARS_CODES.few);
  assert.equal(barsOf(items([...four.slice(0, 3), { ...four[3], kind: 'toggle', travel: undefined }]), true).refusal.code, BARS_CODES.kind);
  assert.equal(barsOf(items([...four.slice(0, 3), travel('Step 4', {}, { max: 9 })]), true).refusal.code, BARS_CODES.facts);
  assert.equal(barsOf(items([...four.slice(0, 3), travel('Other')]), true).refusal.code, BARS_CODES.series);
});

// the layout carries it
const descriptor = (controls) => ({ origin: 'scanned', plugin: { id: 'urn:test:organ', format: 'lv2', name: 'Organ', features: ['audio-effect'] }, controls: controls.map((c, i) => ({ ...c, id: i, symbol: `c${i}` })), ports: [] });
test('the layout carries the bars on the section, out of the canonical form', async () => {
  const { panelCanonical } = await import('../tools/panel-description.mjs');
  const withBars = panelLayout(descriptor(FOOT.map((f) => travel(f))));
  assert.equal(withBars.sections[0].bars[0].controls.length, 9);
  const without = panelLayout(descriptor(FOOT.map((f) => travel(f))), { panel: { sections: [{ key: 'organ', label: 'Organ', controls: FOOT.map((_, i) => `c${i}`), bars: false }] } });
  assert.equal(without.sections[0].bars, undefined);
  // the canonical form (and so the fingerprint) is the same with and without the bars
  assert.equal(panelCanonical(withBars), panelCanonical({ ...withBars, sections: withBars.sections.map(({ bars: _b, ...s }) => s) }));
  assert.ok(without.sections.every((sec) => !('bars' in sec)));
});
test('a declared bars: true that fails the rule refuses the layout by its code', () => {
  const d = descriptor(['a', 'b', 'c'].map((l) => travel(l)));
  assert.throws(() => panelLayout(d, { panel: { sections: [{ key: 's', label: 'S', controls: ['c0', 'c1', 'c2'], bars: true }] } }), (e) => e instanceof BarsRefused && e.code === BARS_CODES.few);
});
