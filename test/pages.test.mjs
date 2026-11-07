// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// pagesOf cuts a laid-out panel into pages of N controls (#93): by hand-built layouts, so it needs no vocabulary.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GROUP, pagesOf } from '../tools/panel-description.mjs';

const control = (param, label, group) => ({ param, label, section: 0, ...(group ? { [GROUP]: group } : {}) });
const band = (groups = []) => ({
  sections: [{ label: 'Band' }],
  controls: ['Freq', 'Gain', 'Q', 'Type', 'On'].map((l, i) => control(i + 1, l, groups[i])),
});
const names = (pages) => pages.map((p) => p.pageName);

test('five controls at N=8: one page, named for the section, as the default makes it', () => {
  const x = band();
  const eight = pagesOf(x, { perPage: 8 });
  assert.deepEqual(eight, [{ section: 0, sectionName: 'Band', pageName: 'Band', ids: [1, 2, 3, 4, 5, null, null, null] }]);
  assert.deepEqual(pagesOf(x), eight);
});

test('five controls at N=4: pages of four, named by the controls they hold', () => {
  const pages = pagesOf(band(), { perPage: 4 });
  assert.deepEqual(pages.map((p) => p.ids), [[1, 2, 3, 4], [5, null, null, null]]);
  assert.deepEqual(names(pages), ['Band: Freq - Type', 'Band: On']);
});

test('the width left out is eight, and a section of several pages names each page by the controls it holds', () => {
  const x = { sections: [{ label: 'S' }], controls: Array.from({ length: 10 }, (_, i) => control(i, `c${i}`)) };
  assert.deepEqual(names(pagesOf(x)), ['S: c0 - c7', 'S: c8 - c9']);
  assert.deepEqual(pagesOf(x).map((p) => p.ids.length), [8, 8]);
});

test('a group that fits a page is not split; one wider than a page is cut', () => {
  const kept = pagesOf(band(['A', 'A', 'B', 'B', 'B']), { perPage: 4 });
  assert.deepEqual(kept.map((p) => p.ids), [[1, 2, null, null], [3, 4, 5, null]]);
  const cut = pagesOf(band(['A', 'A', 'A', 'A', 'A']), { perPage: 4 });
  assert.deepEqual(cut.map((p) => p.ids), [[1, 2, 3, 4], [5, null, null, null]]);
});

test('N must be a whole number of at least 1', () => {
  for (const perPage of [0, -1, 2.5, NaN]) assert.throws(() => pagesOf(band(), { perPage }), /--per-page/);
});

// the one ruling of the pages amendment (spec 7.14): a control the values hide keeps its slot, blank
const hidden = (c) => ({ ...c, visible: 9, mask: 0n, visibleWhen: { symbol: 'gov', default: 0 } });
test('a hidden control keeps its slot, blank: the controls after it do not move up, at both widths', () => {
  const x = band();
  x.controls[1] = hidden(x.controls[1]);
  assert.deepEqual(pagesOf(x, { perPage: 8 }).map((p) => p.ids), [[1, null, 3, 4, 5, null, null, null]]);
  assert.deepEqual(pagesOf(x, { perPage: 4 }).map((p) => p.ids), [[1, null, 3, 4], [5, null, null, null]]);
});
test('a section every control of which is hidden still has its page, all blank', () => {
  const x = band();
  x.controls = x.controls.map(hidden);
  assert.deepEqual(pagesOf(x, { perPage: 8 }).map((p) => p.ids), [[null, null, null, null, null, null, null, null]]);
});
test('the values show a hidden control in its own slot', () => {
  const x = band();
  x.controls[1] = { ...hidden(x.controls[1]), mask: 1n << 3n };
  assert.deepEqual(pagesOf(x, { perPage: 8, values: { gov: 3 } })[0].ids.slice(0, 3), [1, 2, 3]);
});

// ---- the one cut (spec 7.14): Easy first, remote pages as given, groups whole at every width
const ctl = (param, label, section = 0, group, symbol = `s${param}`) => ({ param, label, section, symbol, ...(group ? { [GROUP]: group } : {}) });
const flat = (pages) => pages.flatMap((p) => p.ids).filter((id) => id !== null);
const bandsX = (n = 6, easy = []) => ({
  sections: [{ label: 'Bands' }],
  controls: Array.from({ length: n }, (_, b) => ['Freq', 'Gain', 'Q'].map((l, k) => ctl(b * 3 + k + 1, `${l}${b}`, 0, `b${b}`))).flat(),
  easy,
});

test('a group is kept whole at every width: the same controls in the same order, no group split by a page end', () => {
  const x = bandsX();
  for (const perPage of [3, 4, 6, 8]) {
    const pages = pagesOf(x, { perPage });
    assert.deepEqual(flat(pages), x.controls.map((c) => c.param), `order at ${perPage}`);
    for (let b = 0; b < 6; b++) {
      const own = [b * 3 + 1, b * 3 + 2, b * 3 + 3];
      const at = pages.filter((p) => own.some((id) => p.ids.includes(id)));
      if (perPage >= 3) assert.equal(at.length, 1, `band ${b} on one page at ${perPage}`);
    }
  }
  assert.deepEqual(pagesOf(x, { perPage: 4 }).map((p) => p.ids), Array.from({ length: 6 }, (_, b) => [b * 3 + 1, b * 3 + 2, b * 3 + 3, null]));
  assert.deepEqual(pagesOf(x, { perPage: 8 }).map((p) => p.ids.filter((i) => i !== null).length), [6, 6, 6]);
});
test('a group longer than a page is the only split, at its own boundary: never mixed with its neighbour', () => {
  const x = { sections: [{ label: 'S' }], controls: [ctl(1, 'a', 0, 'A'), ctl(2, 'b', 0, 'B'), ctl(3, 'c', 0, 'B'), ctl(4, 'd', 0, 'B'), ctl(5, 'e', 0, 'B'), ctl(6, 'f', 0, 'B'), ctl(7, 'g', 0, 'C')] };
  assert.deepEqual(pagesOf(x, { perPage: 4 }).map((p) => p.ids), [[1, null, null, null], [2, 3, 4, 5], [6, null, null, null], [7, null, null, null]]);
});
test('controls with no group are each their own: they fill a page', () => {
  assert.deepEqual(pagesOf(band(), { perPage: 4 }).map((p) => p.ids), [[1, 2, 3, 4], [5, null, null, null]]);
});
test('below two encoders a bar group is plain controls: one a page', () => {
  assert.deepEqual(pagesOf(bandsX(1), { perPage: 1 }).map((p) => p.ids), [[1], [2], [3]]);
});

test('the Easy controls come first, always, in the list order, and a derived page holds a control once', () => {
  const x = bandsX(2, ['s5', 's1']);
  for (const perPage of [4, 8]) {
    const pages = pagesOf(x, { perPage });
    assert.equal(pages[0].pageName, 'Easy');
    assert.deepEqual(pages[0].ids.slice(0, 2), [5, 1]);
    assert.equal(new Set(flat(pages)).size, flat(pages).length, `no control twice at ${perPage}`);
    assert.deepEqual([...flat(pages)].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  }
  assert.deepEqual(pagesOf({ ...x, easy: ['s1', 's2', 's3'] }, { perPage: 2 }).slice(0, 2).map((p) => [p.pageName, p.ids]), [['Easy', [1, 2]], ['Easy 2', [3, null]]]);
  assert.deepEqual(flat(pagesOf({ ...x, easy: ['nope'] }, { perPage: 8 })), [1, 2, 3, 4, 5, 6], 'a symbol of no control is no slot');
});
test('a hidden Easy control keeps its slot on the Easy page, blank', () => {
  const x = bandsX(1, ['s2', 's1']);
  x.controls[1] = hidden(x.controls[1]);
  assert.deepEqual(pagesOf(x, { perPage: 4 })[0].ids, [null, 1, null, null]);
});

test('the same controls, in the same order, at 4 and 8, and a hidden band leaves blank slots with no reflow at both', () => {
  const x = bandsX(3, ['s1']);
  x.controls = x.controls.map((c) => (c.param >= 4 && c.param <= 6 ? hidden(c) : c));
  for (const perPage of [4, 8]) {
    const got = pagesOf(x, { perPage }).flatMap((p) => p.ids);
    const at = (id) => got.indexOf(id);
    assert.deepEqual(got.filter((i) => i !== null), [1, 2, 3, 7, 8, 9]);
    assert.equal(got.length % perPage, 0);
    assert.ok(at(7) - at(3) > 1, `band 1's three slots stay between the bands at ${perPage}`);
  }
  assert.deepEqual(pagesOf(x, { perPage: 4 }).map((p) => p.ids), [[1, null, null, null], [2, 3, null, null], [null, null, null, null], [7, 8, 9, null]]);
});

test('remote pages replace the derived ones and are not edited', () => {
  const x = bandsX(2, ['s1']);
  const remote = [{ name: 'Mix', ids: [6, 5, null, 1] }, { name: 'Tone', ids: [2] }];
  const pages = pagesOf(x, { perPage: 8, remote });
  assert.deepEqual(pages.map((p) => [p.pageName, p.ids]), [
    ['Easy', [1, null, null, null, null, null, null, null]],
    ['Mix', [6, 5, null, 1, null, null, null, null]],
    ['Tone', [2, null, null, null, null, null, null, null]],
  ], 'an Easy control may sit on its remote page too; the sections are not cut');
  assert.deepEqual(pagesOf(x, { perPage: 8, remote: [] }), pagesOf(x, { perPage: 8 }), 'no remote page declared: the derived cut');
});
test('a remote slot hidden, read-only or empty is blank; a remote page wider than the width runs on', () => {
  const x = bandsX(1);
  x.controls[0] = hidden(x.controls[0]);
  assert.deepEqual(pagesOf(x, { perPage: 4, remote: [{ name: 'R', ids: [1, 2, 99, null] }] })[0].ids, [null, 2, null, null]);
  assert.deepEqual(pagesOf(x, { perPage: 2, remote: [{ name: 'R', ids: [2, 3, 2] }] }).map((p) => [p.pageName, p.ids]), [['R', [2, 3]], ['R 2', [2, null]]]);
});
