// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * visible-when.test.mjs — a declared panel shows a control by another control's value (`visibleWhen`,
 * docs/panel-layout.md "Visibility"), held by value on a strip-shaped EQ: 32 band slots of five controls and a band
 * count `eqBands`, each band's controls `{ param: 'eqBands', atLeast: n }`.
 *
 *   1. the rule is carried into the description's `visible` and `mask` (and the fingerprint), and refused when it is
 *      not one;
 *   2. the page cut drops what the values hide: eqBands 4 shows bands 1..4 and no page of eight holds a hidden band,
 *      eqBands 9 shows 9;
 *   3. the MOD GUI hides what the come-up values hide and its script follows the governing port;
 *   4. the schema's rule takes either form and refuses the rest.
 *
 * Two sabotage arms read the checks go red: `atLeast` read as an equality, and a page cut that ignores visibility.
 * Needs no installed vocabulary: the strip's family is none.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { generateModgui } from '../tools/modgui-gen.mjs';
import { isVisible, pagesOf, panelCanonical, panelFingerprint, panelLayout, visibilityMask } from '../tools/panel-description.mjs';

const BANDS = 32;
const FIELDS = ['Freq', 'Gain', 'Q', 'Type', 'On'];
const sym = (n, f) => `b${n}${f}`;

/** The strip's EQ as an authored descriptor: the switch, the band count (1..32, default `def`), then every band's five controls. */
function strip(def = 4) {
  const controls = [
    { symbol: 'eqOn', name: 'EQ', kind: 'toggle', default: true },
    { symbol: 'eqBands', name: 'Bands', kind: 'travel', travel: { min: 1, max: BANDS, step: 1, default: def, unit: '', scale: 'linear' } },
  ];
  for (let n = 1; n <= BANDS; n++) {
    controls.push(
      { symbol: sym(n, 'Freq'), name: `${n} Freq`, kind: 'travel', travel: { min: 20, max: 20000, default: 1000, unit: 'Hz', scale: 'log' } },
      { symbol: sym(n, 'Gain'), name: `${n} Gain`, kind: 'travel', travel: { min: -18, max: 18, default: 0, unit: 'dB', scale: 'linear' } },
      { symbol: sym(n, 'Q'), name: `${n} Q`, kind: 'travel', travel: { min: 0.1, max: 10, default: 0.7, unit: '', scale: 'log' } },
      { symbol: sym(n, 'Type'), name: `${n} Type`, kind: 'choice', ids: ['bell', 'shelf'], values: [0, 1], default: 'bell' },
      { symbol: sym(n, 'On'), name: `${n} On`, kind: 'toggle', default: true },
    );
  }
  controls.forEach((c, i) => { c.id = i; c.group = ['EQ']; });
  return { plugin: { id: 'urn:example:strip-eq', format: 'lv2', name: 'Strip EQ', vendor: 'Example' }, origin: 'authored', controls };
}

const bandSymbols = (n) => FIELDS.map((f) => sym(n, f));

/** The declared panel: one EQ section, the switch and the count first, then the bands in band order; `rule(n)` each band's. */
function declared(rule = (n) => ({ param: 'eqBands', atLeast: n })) {
  const bands = Array.from({ length: BANDS }, (_, k) => k + 1);
  return {
    family: 'none',
    sections: [{ key: 'eq', label: 'EQ', controls: ['eqOn', 'eqBands', ...bands.flatMap(bandSymbols)] }],
    visibleWhen: Object.fromEntries(bands.flatMap((n) => bandSymbols(n).map((s) => [s, rule(n)]))),
  };
}

/** The bands whose controls the pages hold, and whether any band is cut short; ids are the descriptor's indexes. */
function bandsOnPages(pages, descriptor) {
  const held = new Set(pages.flatMap((p) => p.ids).filter((id) => id !== null).map((id) => descriptor.controls[id].symbol));
  const bands = [];
  for (let n = 1; n <= BANDS; n++) {
    const have = bandSymbols(n).filter((s) => held.has(s)).length;
    if (have === FIELDS.length) bands.push(n);
    else if (have) bands.push(`partial ${n}`);
  }
  return bands;
}

const upTo = (n) => Array.from({ length: n }, (_, k) => k + 1);

/** The check every cut is held to: the pages hold bands 1..`count`, whole, and no other. */
function pagesShowBands(pages, descriptor, count) {
  assert.deepEqual(bandsOnPages(pages, descriptor), upTo(count));
}

test('the rule is carried into visible and mask: atLeast n sets bits n..63, values sets its own bits', () => {
  const d = strip();
  const x = panelLayout(d, { panel: declared() });
  const band5 = x.controls.find((c) => c.symbol === 'b5Freq');
  assert.equal(band5.visible, 1, 'visible is the governing parameter\'s id');
  assert.equal(band5.mask, ((1n << 64n) - 1n) ^ 0b11111n);
  assert.deepEqual(band5.visibleWhen, { symbol: 'eqBands', default: 4 });
  assert.equal(x.controls.find((c) => c.symbol === 'eqBands').visible, null);
  assert.equal(visibilityMask({ values: [1, 2] }), 0b110n);
  assert.equal(visibilityMask({ atLeast: 0 }), (1n << 64n) - 1n);
  assert.equal(visibilityMask({ atLeast: 63 }), 1n << 63n);
  assert.ok(panelCanonical(x).split('\n').includes('control\tb5Freq\teq\tknob\t\t1\tffffffffffffffe0'));
  // the rule is part of the fingerprint
  const plain = panelLayout(d, { panel: { ...declared(), visibleWhen: {} } });
  assert.notEqual(panelFingerprint(x), panelFingerprint(plain));
});

test('a rule that is not one is refused by name', () => {
  const d = strip();
  const refuse = (visibleWhen, re) => assert.throws(() => panelLayout(d, { panel: { ...declared(), visibleWhen } }), re);
  refuse({ b1Freq: { param: 'b2Gain', atLeast: 1 } }, /not an integer or toggle parameter/);
  refuse({ b1Freq: { param: 'nothing', atLeast: 1 } }, /'nothing', no parameter/);
  refuse({ b1Freq: { param: 'eqBands', atLeast: 64 } }, /atLeast is an integer 0\.\.63/);
  refuse({ b1Freq: { param: 'eqBands', values: [1, 64] } }, /values are integers 0\.\.63/);
  refuse({ b1Freq: { param: 'eqBands', values: [1.5] } }, /values are integers 0\.\.63/);
  refuse({ b1Freq: { param: 'eqBands', values: [1], atLeast: 1 } }, /one of values or atLeast/);
  refuse({ b1Freq: { param: 'eqBands' } }, /one of values or atLeast/);
  refuse({ b1Freq: { param: 'b1Freq', atLeast: 1 } }, /governed by itself/);
  refuse({ unlisted: { param: 'eqBands', atLeast: 1 } }, /'unlisted', which no panel section lists/);
  // a toggle and a choice govern
  for (const param of ['eqOn', 'b2Type']) assert.doesNotThrow(() => panelLayout(d, { panel: { ...declared(), visibleWhen: { b1Freq: { param, values: [1] } } } }));
});

test('eqBands 4 (its come-up value): bands 1..4 shown, and no page of eight holds a hidden band', () => {
  const d = strip(4);
  const x = panelLayout(d, { panel: declared() });
  assert.deepEqual(upTo(BANDS).filter((n) => isVisible(x.controls.find((c) => c.symbol === sym(n, 'Freq')))), upTo(4));
  for (const perPage of [undefined, 8, 4]) {
    const pages = pagesOf(x, { perPage });
    pagesShowBands(pages, d, 4);
    // the switch, the count and four bands: 22 controls
    assert.equal(pages.flatMap((p) => p.ids).filter((id) => id !== null).length, 22);
  }
  assert.equal(pagesOf(x).length, 3);
});

test('eqBands 9: bands 1..9 shown; the cut follows the value, not the come-up one', () => {
  const d = strip(4);
  const x = panelLayout(d, { panel: declared() });
  for (const perPage of [undefined, 8]) pagesShowBands(pagesOf(x, { perPage, values: { eqBands: 9 } }), d, 9);
  assert.equal(pagesOf(x, { values: { eqBands: 9 } }).length, 6);
  pagesShowBands(pagesOf(x, { values: { eqBands: 32 } }), d, 32);
  // the same at come-up: a strip that comes up with nine bands
  const d9 = strip(9);
  pagesShowBands(pagesOf(panelLayout(d9, { panel: declared() })), d9, 9);
  // a description read back from its JSON (the mask as hex) cuts the same
  const json = JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? v.toString(16) : v)));
  pagesShowBands(pagesOf(json, { values: { eqBands: 9 } }), d, 9);
});

test('a section the values empty has no page', () => {
  const d = strip(1);
  const panel = declared();
  panel.sections = [{ key: 'head', label: 'Head', controls: ['eqOn', 'eqBands'] }, ...upTo(BANDS).map((n) => ({ key: `band_${n}`, label: `Band ${n}`, controls: bandSymbols(n) }))];
  const pages = pagesOf(panelLayout(d, { panel }), { perPage: 8, values: { eqBands: 3 } });
  assert.deepEqual(pages.map((p) => p.pageName), ['Head', 'Band 1', 'Band 2', 'Band 3']);
});

test('sabotage: atLeast read as an equality shows one band, and the check goes red', () => {
  const d = strip(4);
  const equals = panelLayout(d, { panel: declared((n) => ({ param: 'eqBands', values: [n] })) });
  assert.throws(() => pagesShowBands(pagesOf(equals, { values: { eqBands: 9 } }), d, 9), assert.AssertionError);
  assert.deepEqual(bandsOnPages(pagesOf(equals, { values: { eqBands: 9 } }), d), [9]);
});

test('sabotage: a page cut that ignores visibility puts hidden bands on the pages, and the check goes red', () => {
  const d = strip(4);
  const x = panelLayout(d, { panel: declared() });
  const blind = { ...x, controls: x.controls.map((c) => ({ ...c, visible: null })) };
  assert.throws(() => pagesShowBands(pagesOf(blind), d, 4), assert.AssertionError);
  assert.equal(bandsOnPages(pagesOf(blind), d).length, BANDS);
});

test('the MOD GUI hides what the come-up values hide, and its script follows the governing port', () => {
  const made = (def) => new Map(generateModgui(strip(def), { panel: declared(), stem: 'strip', source: 'test' }));
  const four = made(4);
  const template = four.get('modgui/icon-strip.html').toString();
  const tagOf = (s) => template.match(new RegExp(`<div class="omx-control[^>]*data-symbol="${s}"[^>]*>`))[0];
  assert.doesNotMatch(tagOf('b4Freq'), /display:none/);
  assert.match(tagOf('b5Freq'), /display:none/);
  assert.match(tagOf('b5Freq'), /data-visible-port="eqBands" data-visible-mask="ffffffffffffffe0"/);
  assert.doesNotMatch(tagOf('eqBands'), /data-visible-port/);
  assert.match(four.get('modgui.ttl').toString(), /modgui:javascript <modgui\/script-strip\.js>/);
  // the screenshot draws what the come-up values show
  assert.notDeepEqual(four.get('modgui/screenshot-strip.png'), made(9).get('modgui/screenshot-strip.png'));

  // the script, run as MOD runs it: each control's display follows bit `value` of its mask
  const script = four.get('modgui/script-strip.js').toString().replace(/^\/\/.*\n/gm, '');
  const fn = new Function(`return (${script});`)();
  const nodes = [...template.matchAll(/<div class="omx-control[^>]*>/g)].map(([tag]) => {
    const attr = (a) => tag.match(new RegExp(`${a}="([^"]*)"`))?.[1] ?? null;
    return { symbol: attr('data-symbol'), getAttribute: attr, style: { display: /display:none/.test(tag) ? 'none' : '' } };
  });
  const icon = { find: (sel) => ({ each: (f) => nodes.filter((k) => k.getAttribute('data-visible-port') === sel.match(/"([^"]+)"/)[1]).forEach((k) => f.call(k)) }) };
  const shownBands = () => upTo(BANDS).filter((n) => nodes.find((k) => k.symbol === sym(n, 'Freq')).style.display === '');
  fn({ type: 'start', icon, ports: [{ symbol: 'eqBands', value: 4 }, { symbol: 'eqOn', value: 1 }] });
  assert.deepEqual(shownBands(), upTo(4));
  fn({ type: 'change', icon, symbol: 'eqBands', value: 9 });
  assert.deepEqual(shownBands(), upTo(9));
  fn({ type: 'change', icon, symbol: 'eqBands', value: 32 });
  assert.deepEqual(shownBands(), upTo(32));
  fn({ type: 'change', icon, symbol: 'eqBands', value: 1 });
  assert.deepEqual(shownBands(), [1]);
});

test('the schema\'s rule takes values or atLeast, never both, 0..63', () => {
  const schema = JSON.parse(readFileSync(new URL('../schema/panel.schema.json', import.meta.url), 'utf8'));
  const ajv = new Ajv2020({ strict: false });
  ajv.addSchema(schema);
  const ok = ajv.compile({ $ref: `${schema.$id}#/$defs/visibleWhen` });
  assert.equal(ok(declared().visibleWhen), true);
  assert.equal(ok({ a: { param: 'eqBands', values: [0, 63] } }), true);
  for (const bad of [{ param: 'eqBands', atLeast: 64 }, { param: 'eqBands', values: [64] }, { param: 'eqBands', values: [1], atLeast: 1 }, { param: 'eqBands' }, { atLeast: 1 }, { param: 'eqBands', values: [] }]) {
    assert.equal(ok({ a: bad }), false, JSON.stringify(bad));
  }
});
