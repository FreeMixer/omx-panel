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

test('the default cut is the plain one of eight with numbered pages', () => {
  const x = { sections: [{ label: 'S' }], controls: Array.from({ length: 10 }, (_, i) => control(i, `c${i}`)) };
  assert.deepEqual(names(pagesOf(x)), ['S 1', 'S 2']);
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
