// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * describe.test.mjs — the one derivation (tools/describe.mjs, the one-panel spec §3.1): the family rule of §3.1.1 with no list of
 * plugins, the meaning inference (tools/meaning-infer.mjs), the derived displays with their basis, roles with shape and shapes,
 * the params as contract facts, the refusals by code, the skin's bars. Each rule is held by value, with an arm that breaks
 * its input and reads the result change. Over the built tree (the skin application is built).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { candidatesOf, describe, DESCRIBE_CODES, familyRule } from '../dist/tools/describe.mjs';
import { inferBands, shapesOf } from '../dist/tools/meaning-infer.mjs';

const travel = (name, meaning, t = {}, extra = {}) => ({ name, kind: 'travel', ...(meaning ? { meaning } : {}), travel: { min: 0, max: 1, unit: 'unknown', scale: 'linear', default: 0, ...t }, ...extra });
const dyn = (names = ['threshold', 'ratio', 'attack', 'release']) => names.map((n) => travel(n, n, { min: n === 'ratio' ? 1 : -60, max: n === 'ratio' ? 20 : 0, unit: n === 'ratio' ? 'ratio' : n === 'threshold' ? 'dB' : 'ms' }));
const descriptor = (controls, ext, extra = {}) => ({
  origin: 'scanned', plugin: { id: 'urn:test:plugin', format: 'lv2', name: 'Test', features: ['audio-effect'] },
  controls: controls.map((c, i) => ({ id: `c${i}`, symbol: `c${i}`, ...c })), ports: [], ...(ext ? { extensions: ext } : {}), ...extra,
});
const lv2 = (...classes) => ({ lv2: Object.fromEntries(classes.map((c) => [c, true])) });
const named = (c, id) => ({ ...c, id, symbol: id });

// an LSP-shaped parametric EQ: no meanings, band symbols f_N g_N w_N ft_N, a linear gain, the width in octaves, a shape choice
const FT = { kind: 'choice', ids: ['off', 'bell', 'hishelf', 'loshelf'], labels: ['Off', 'Bell', 'Hi-shelf', 'Lo-shelf'], values: [0, 1, 2, 3], default: 'bell' };
const eqControls = (bands = 4) => Array.from({ length: bands }, (_, i) => [
  named({ name: `Frequency ${i}`, kind: 'travel', travel: { min: 10, max: 20000, unit: 'Hz', scale: 'log', default: 1000 } }, `f_${i}`),
  named({ name: `Gain ${i}`, kind: 'travel', travel: { min: 0.001, max: 1000, unit: 'unknown', scale: 'log', default: 1 } }, `g_${i}`),
  named({ name: `Width ${i}`, kind: 'travel', travel: { min: 0.1, max: 4, unit: 'oct', scale: 'linear', default: 1 } }, `w_${i}`),
  named({ name: `Filter type ${i}`, ...FT }, `ft_${i}`),
]).flat();
const eqDescriptor = (ext, bands) => ({ origin: 'scanned', plugin: { id: 'urn:test:eq', format: 'lv2', name: 'EQ', features: ['audio-effect'] }, controls: eqControls(bands), ports: [], ...(ext ? { extensions: ext } : {}) });

// -- §3.1.1 the family rule
test('a declared compressor class, backed by its controls, is the dynamics family with its curve, modelled', () => {
  const { description, refusals } = describe(descriptor(dyn(), lv2('lv2:CompressorPlugin')));
  assert.equal(description.family, 'dynamics');
  assert.deepEqual(description.displays.map((d) => [d.kind, d.basis, d.source]), [['transfer_curve', 'modelled', 'family']]);
  assert.deepEqual(refusals, []);
});
test('the CLAP feature gives the candidate as the LV2 class does', () => {
  const d = descriptor(dyn(), { clap: { 'clap_plugin_descriptor.features': ['audio-effect', 'compressor'] } }, { plugin: { id: 'x.clap', format: 'clap', name: 'C', features: ['audio-effect'] } });
  assert.equal(describe(d).description.family, 'dynamics');
});
test('the class may be written as rdf:type, in full or as a CURIE', () => {
  assert.deepEqual(candidatesOf(descriptor(dyn(), { lv2: { 'rdf:type': ['http://lv2plug.in/ns/lv2core#CompressorPlugin', 'lv2:Plugin'] } })), ['dynamics']);
});
test('arm: a declared class whose controls lack a backing role gets no family', () => {
  const { description } = describe(descriptor(dyn(['threshold', 'ratio', 'attack']), lv2('lv2:CompressorPlugin')));
  assert.equal(description.family, 'none');
  assert.deepEqual(description.displays, []);
  assert.deepEqual(description.roles, []);
});
test('arm: the same controls without the declared class get no family: the meanings alone name none', () => {
  assert.equal(describe(descriptor(dyn())).description.family, 'none');
});
test('arm: an unrelated declared class is no candidate', () => {
  assert.equal(describe(descriptor(dyn(), lv2('lv2:ReverbPlugin', 'lv2:Plugin'))).description.family, 'none');
});
test('two declared families: kept only when exactly one passes the required roles', () => {
  const both = lv2('lv2:CompressorPlugin', 'lv2:GatePlugin');
  assert.equal(describe(descriptor(dyn(), both)).description.family, 'dynamics');
  const gate = [travel('threshold', 'threshold', { unit: 'dB' }), travel('range', 'range', { unit: 'dB' }), travel('attack', 'attack', { unit: 'ms' }), travel('release', 'release', { unit: 'ms' })];
  assert.equal(describe(descriptor(gate, both)).description.family, 'gate');
  // arm: the controls back both, so no family
  const either = [...dyn(), travel('range', 'range', { unit: 'dB' })].map((c, i) => named(c, `d${i}`));
  assert.equal(describe(descriptor(either, both)).description.family, 'none');
});
test('the family of a curated and of an uncurated plugin of one descriptor is the same: nothing but the descriptor is read', () => {
  const d = descriptor(dyn(), lv2('lv2:CompressorPlugin'));
  assert.deepEqual(describe(d).description.family, describe(structuredClone(d)).description.family);
  assert.deepEqual(familyRule(d, {}).family, 'dynamics');
});
test('a user override naming a family wins; one the controls do not back is refused by code and the panel is none', () => {
  const d = descriptor([travel('Level'), travel('Pan')]);
  const applyOverride = () => ({ descriptor: d, family: 'dynamics', answered: {}, dropped: [], warnings: [], refused: [] });
  const { description, refusals } = describe(d, { overrides: [{}], applyOverride });
  assert.equal(description.family, 'none');
  assert.deepEqual(refusals.map((r) => r.code), [DESCRIBE_CODES.familyNotBacked]);
  const ok = describe(descriptor(dyn()), { overrides: [{}], applyOverride: (x) => ({ descriptor: x, family: 'dynamics', dropped: [], refused: [] }) });
  assert.equal(ok.description.family, 'dynamics');
});
test('layers with no applyOverride function are refused by code, the panel still made', () => {
  const { description, refusals } = describe(descriptor(dyn(), lv2('lv2:CompressorPlugin')), { overrides: [{}] });
  assert.equal(description.family, 'dynamics');
  assert.deepEqual(refusals.map((r) => r.code), [DESCRIBE_CODES.overrideUnavailable]);
});

// -- Q9 the band inference on every surface
test('an LSP-shaped EQ with the declared class is an eq from inferred bands: frequency, gain, q, type, each marked', () => {
  const { description } = describe(eqDescriptor(lv2('lv2:ParaEQPlugin'), 4));
  assert.equal(description.family, 'eq');
  const r = (role, index) => description.roles.find((x) => x.role === role && x.index === index);
  assert.deepEqual(r('band_freq', 2), { role: 'band_freq', index: 2, symbol: 'f_2', unit: 'hz', inferred: true });
  assert.deepEqual(r('band_gain', 2), { role: 'band_gain', index: 2, symbol: 'g_2', unit: 'coef', inferred: true });
  assert.deepEqual(r('band_q', 2), { role: 'band_q', index: 2, symbol: 'w_2', unit: 'oct', inferred: true });
  assert.deepEqual(r('band_type', 2).shapes, ['off', 'bell', 'highshelf', 'lowshelf']);
  assert.ok(description.roles.every((x) => x.inferred === true));
  assert.deepEqual(description.displays.map((d) => [d.kind, d.basis]), [['eq_response', 'modelled']]);
});
test('arm: the same EQ without the declared class is plain sections: no family, no roles, no display', () => {
  const { description } = describe(eqDescriptor(undefined, 4));
  assert.equal(description.family, 'none');
  assert.deepEqual([description.roles, description.displays], [[], []]);
});
test('arm: the inference states no band for controls that look like none, so the class is not kept', () => {
  const d = descriptor([travel('Volume'), travel('Pan')], lv2('lv2:EQPlugin'));
  assert.equal(describe(d).description.family, 'none');
  assert.deepEqual(inferBands(d.controls), { outcome: 'no-confident-inference', reason: 'no-band' });
});
test('a descriptor word beats the inference: a control with a meaning is read as the descriptor says', () => {
  const controls = [named(travel('Freq', 'frequency', { min: 20, max: 20000, unit: 'Hz', scale: 'log', default: 1000 }), 'a'), named(travel('Boost', 'gain', { min: -12, max: 12, unit: 'dB' }), 'b')];
  const { description } = describe(descriptor(controls, lv2('lv2:EQPlugin')));
  assert.equal(description.family, 'eq');
  assert.ok(description.roles.every((r) => r.inferred === undefined));
});
test('a band whose shape no parameter selects carries it on band_freq; a high-pass with no gain is the head filter', () => {
  const controls = [
    named(travel('HP Freq', undefined, { min: 20, max: 500, unit: 'Hz' }), 'hp_f'), named(travel('HP Q', undefined, { min: 0.3, max: 4, unit: 'unknown' }), 'hp_q'),
    named(travel('Freq 1', undefined, { min: 20, max: 20000, unit: 'Hz' }), 'f1'), named(travel('Gain 1', undefined, { min: -18, max: 18, unit: 'dB' }), 'g1'),
    named(travel('LoShelf Freq', undefined, { min: 20, max: 500, unit: 'Hz' }), 'ls_f'), named(travel('LoShelf Gain', undefined, { min: -18, max: 18, unit: 'dB' }), 'ls_g'),
  ];
  const v = inferBands(controls);
  assert.equal(v.outcome, 'inferred');
  assert.deepEqual(v.roles.filter((r) => r.symbol === 'hp_f').map((r) => r.role), ['hpf_freq']);
  assert.equal(v.roles.find((r) => r.symbol === 'ls_f').shape, 'lowshelf');
  assert.equal(v.roles.find((r) => r.symbol === 'f1').shape, 'bell');
});
test('a control with a meaning is not read by the inference: a band stands on the controls the descriptor leaves unnamed', () => {
  const freq = named(travel('Freq 1', 'frequency', { min: 20, max: 20000, unit: 'Hz' }), 'f1');
  const gain = named(travel('Gain 1', undefined, { min: -12, max: 12, unit: 'dB' }), 'g1');
  assert.equal(inferBands([freq, gain]).outcome, 'no-confident-inference');
  assert.equal(inferBands([{ ...freq, meaning: undefined }, gain]).outcome, 'inferred');
});
test('a declared band_type role names the shape of each choice value from the choice labels, not only an inferred one', async () => {
  const { panelLayout } = await import('../dist/tools/panel-description.mjs');
  const d = eqDescriptor(undefined, 1);
  const panel = { family: 'eq', sections: [{ key: 'eq', label: 'EQ', controls: ['f_0', 'g_0', 'w_0', 'ft_0'] }], roles: { band_freq: ['f_0'], band_gain: ['g_0'], band_type: ['ft_0'] } };
  const role = panelLayout({ ...d, controls: d.controls.map((c) => ({ ...c, meaning: c.symbol === 'f_0' ? 'frequency' : c.symbol === 'g_0' ? 'gain' : undefined })) }, { panel }).roles.find((r) => r.role === 'band_type');
  assert.deepEqual(role.shapes, ['off', 'bell', 'highshelf', 'lowshelf']);
  assert.equal(role.inferred, undefined);
});
test('shapes: one word per choice value from 0, "-" for a label that is none', () => {
  assert.deepEqual(shapesOf({ ...FT, labels: ['Off', 'Peak', 'Weird', 'Notch'] }), ['off', 'bell', '-', 'notch']);
  assert.equal(shapesOf({ ...FT, labels: ['A', 'B', 'C', 'D'] }), undefined);
});

// -- displays and basis
test('a declared graph is exact only on an authored descriptor that says so, else modelled', () => {
  const controls = dyn().map((c) => ({ ...c, symbol: c.name, id: c.name }));
  const panel = (basis) => ({ family: 'dynamics', sections: [{ key: 'dyn', label: 'Dyn', controls: controls.map((c) => c.symbol), graph: 'dynamics-curve', basis }] });
  const base = { plugin: { id: 'urn:x', format: 'lv2', name: 'X', features: ['audio-effect'] }, controls, ports: [] };
  assert.equal(describe({ ...base, origin: 'authored' }, { panel: panel('exact') }).description.displays[0].basis, 'exact');
  assert.equal(describe({ ...base, origin: 'authored' }, { panel: panel(undefined) }).description.displays[0].basis, 'modelled');
  assert.equal(describe({ ...base, origin: 'scanned' }, { panel: panel('exact') }).description.displays[0].basis, 'modelled');
});
test('the display is on the section holding the first required role', () => {
  const controls = [...dyn().map((c, i) => ({ ...c, group: ['Detector'] })), travel('Mix', 'wetDryRatio', {}, { group: ['Output'] })];
  const { description } = describe(descriptor(controls, lv2('lv2:CompressorPlugin')));
  assert.deepEqual(description.displays.map((d) => d.section), ['detector']);
});

// -- params and refusals
test('params: the contract facts of each control', () => {
  const { description } = describe(descriptor([
    travel('Cut', undefined, { min: 0, max: 20000, unit: 'Hz', scale: 'log', default: 100 }),
    travel('Drive', undefined, { min: 0, max: 24, unit: 'dB', default: 6 }),
    { name: 'Mode', kind: 'choice', ids: ['a', 'b'], labels: ['Alpha', 'Beta'], values: [0, 1], default: 'b' },
    { name: 'On', kind: 'toggle', default: true },
  ]));
  const [cut, drive, mode, on] = description.params;
  assert.equal(cut.scale, 'linear', 'log over a floor at zero is served linear');
  assert.deepEqual([drive.unit, drive.scale, drive.step, drive.default], ['db', 'linear', 0, 6]);
  assert.deepEqual([mode.enumLabels, mode.default, mode.step, mode.scale], [['Alpha', 'Beta'], 1, 1, 'stepped']);
  assert.deepEqual([on.min, on.max, on.default], [0, 1, 1]);
});
test('log over a positive floor stays log', () => {
  assert.equal(describe(descriptor([travel('Cut', undefined, { min: 20, max: 20000, unit: 'Hz', scale: 'log' })])).description.params[0].scale, 'log');
});
test('describe never throws: no control, a bad key, a bar group refused are each a refusal code and no description', () => {
  assert.deepEqual(describe(descriptor([])).refusals.map((r) => r.code), [DESCRIBE_CODES.noControls]);
  assert.equal(describe(descriptor([])).description, null);
  const bad = describe(descriptor([travel('A'), travel('B')]), { ns: 'Bad Key' });
  assert.deepEqual([bad.description, bad.refusals[0].code], [null, DESCRIBE_CODES.layoutInvalid]);
  const four = Array.from({ length: 3 }, (_, i) => ({ ...travel(`Step ${i + 1}`), symbol: `s${i}`, id: `s${i}` }));
  const barred = describe(descriptor(four), { panel: { sections: [{ key: 's', label: 'S', controls: ['s0', 's1', 's2'], bars: true }] } });
  assert.deepEqual([barred.description, barred.refusals[0].code], [null, 'PANEL_BARS_TOO_FEW']);
});

// -- bars in the description and in the skin
test('a section of the description carries its bars; the fingerprint does not move with them', () => {
  const steps = Array.from({ length: 8 }, (_, i) => travel(`Step ${i + 1}`, undefined, { min: 0, max: 8, step: 1, scale: 'stepped' }));
  const d = descriptor(steps);
  const a = describe(d).description;
  assert.equal(a.sections[0].bars[0].controls.length, 8);
  const off = describe(d, { panel: { sections: [{ key: 'controls', label: 'Controls', controls: d.controls.map((c) => c.symbol), bars: false }] } }).description;
  assert.equal(off.sections[0].bars, undefined);
  assert.equal(a.fingerprint, off.fingerprint);
});
test('a skin section says bars: false to remove them, true to make one; a failing true is dropped by name', () => {
  const steps = Array.from({ length: 8 }, (_, i) => travel(`Step ${i + 1}`, undefined, { min: 0, max: 8, step: 1, scale: 'stepped' }));
  const d = descriptor([...steps, travel('Other')]);
  const skin = (bars) => ({ schema: 1, plugin: 'urn:test:plugin', licence: 'CC0-1.0', sections: [{ key: 'controls', controls: d.controls.map((c) => c.symbol), bars }] });
  assert.equal(describe(d, { skin: skin(undefined) }).description.sections[0].bars[0].controls.length, 8);
  assert.equal(describe(d, { skin: skin(false) }).description.sections[0].bars, undefined);
  const forced = describe(d, { skin: skin(true) });
  assert.equal(forced.description.sections[0].bars, undefined);
  assert.deepEqual(forced.refusals.map((r) => [r.code, r.args.reason]), [[DESCRIBE_CODES.skinDropped, 'PANEL_BARS_FACTS_DIFFER']]);
});

// -- the pages amendment (spec 7.14): describe serves `easy`, cuts after the skin
test('the description serves the Easy controls: the descriptor\'s own, in its order', () => {
  const d = descriptor([travel('A'), travel('B'), travel('C')]);
  assert.deepEqual(describe({ ...d, easy: ['c2', 'c0'] }).description.easy, ['c2', 'c0']);
  assert.deepEqual(describe(descriptor(dyn(), lv2('lv2:CompressorPlugin'))).description.easy.length > 0, true);
});
test('the pages are cut after the skin applies: a skin that reorders the sections moves the first page', () => {
  const d = descriptor(Array.from({ length: 5 }, (_, i) => travel(`N${i}`)));
  const skin = { schema: 1, plugin: 'urn:test:plugin', licence: 'CC0-1.0', sections: [{ key: 'controls', controls: ['c3', 'c1', 'c0', 'c2', 'c4'] }] };
  assert.deepEqual(describe(d).description.pages[0].ids.slice(0, 5), ['c0', 'c1', 'c2', 'c3', 'c4']);
  assert.deepEqual(describe(d, { skin }).description.pages[0].ids.slice(0, 5), ['c3', 'c1', 'c0', 'c2', 'c4']);
  // a skin's two sections are two pages, in its order
  const two = { ...skin, sections: [{ key: 'b', label: 'B', controls: ['c4', 'c3'] }, { key: 'a', label: 'A', controls: ['c0', 'c1', 'c2'] }] };
  assert.deepEqual(describe(d, { skin: two }).description.pages.map((p) => [p.pageName, p.ids.slice(0, 3)]), [['B', ['c4', 'c3', null]], ['A', ['c0', 'c1', 'c2']]]);
});
