#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * easy.test.mjs — the Easy face (docs/panel-layout.md, "The Easy face"), by value: a declared list wins and is refused
 * whole when wrong, the roles answer in their family's order, an indexed role spreads across its span, the order fills what
 * the roles leave, the pages put Easy first with no control twice, and the canonical form does not move.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { EASY_ROLES, EasyRefused, easyOf } from '../tools/easy.mjs';
import { pagesOf, panelCanonical, panelLayout } from '../tools/panel-description.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const control = (symbol, extra = {}) => ({ symbol, meaning: null, standard: { widget: 'knob' }, ...extra });
const role = (r, symbol, index = 0) => ({ role: r, index, symbol });
const x = (family, roles, controls) => ({ family, roles, controls });

test('the roles answer in the family row\'s order, whatever order the plugin lists them', () => {
  const controls = ['release', 'attack', 'mix', 'makeup', 'ratio', 'threshold', 'knee'].map((s) => control(s));
  const roles = ['release', 'attack', 'mix', 'makeup', 'ratio', 'threshold', 'knee'].map((s) => role(s, s));
  assert.deepEqual(easyOf(x('dynamics', roles, controls)), ['threshold', 'ratio', 'makeup', 'mix', 'attack', 'release']);
});

test('every family of the layout has a row, and no row is past the rule\'s six', () => {
  for (const family of ['none', 'gate', 'dynamics', 'limiter', 'deesser', 'eq', 'filter', 'drive', 'modulation', 'delay', 'reverb', 'pitch']) {
    assert.ok(Array.isArray(EASY_ROLES[family]), family);
    assert.ok(EASY_ROLES[family].length <= 6, family);
  }
});

test('an indexed role spreads across its span: 31 bands show both ends, an unused place is the output', () => {
  const bands = Array.from({ length: 31 }, (_, i) => `b${i}`);
  const controls = [...bands.map((s) => control(s)), control('out')];
  const roles = [...bands.map((s, i) => role('band_gain', s, i)), role('output', 'out')];
  assert.deepEqual(easyOf(x('eq', roles, controls)), ['b0', 'b8', 'b15', 'b23', 'b30', 'out']);
  const reversed = [...roles].reverse();
  assert.deepEqual(easyOf(x('eq', reversed, controls)), ['b0', 'b8', 'b15', 'b23', 'b30', 'out']);
});

test('fewer bands than places are all taken', () => {
  const bands = ['a', 'b', 'c'];
  const controls = bands.map((s) => control(s));
  assert.deepEqual(easyOf(x('eq', bands.map((s, i) => role('band_gain', s, i)), controls)), ['a', 'b', 'c']);
});

test('the order fills up to four when the roles give fewer, skipping what no face can set', () => {
  const controls = [
    control('meter', { standard: { widget: 'meter' } }),
    control('shot', { standard: { widget: 'switch', momentary: true } }),
    control('byp', { meaning: 'bypass' }),
    control('a'), control('b'), control('c'), control('d'), control('e'),
  ];
  assert.deepEqual(easyOf(x('none', [], controls)), ['a', 'b', 'c', 'd']);
  assert.deepEqual(easyOf(x('drive', [role('drive', 'c')], controls)), ['c', 'a', 'b', 'd']);
});

test('a plugin with fewer controls shows them all', () => {
  assert.deepEqual(easyOf(x('none', [], [control('a'), control('b')])), ['a', 'b']);
});

test('a declared list wins, in its own order, past the rule\'s cap', () => {
  const controls = Array.from({ length: 9 }, (_, i) => control(`c${i}`));
  const declared = ['c7', 'c6', 'c5', 'c4', 'c3', 'c2', 'c1', 'c0'];
  assert.deepEqual(easyOf(x('none', [], controls), { declared }), declared);
});

test('a wrong declared list is refused whole, by name, never trimmed', () => {
  const controls = [...Array.from({ length: 9 }, (_, i) => control(`c${i}`)), control('m', { standard: { widget: 'meter' } })];
  const refused = (declared, match) => assert.throws(() => easyOf(x('none', [], controls), { declared }), (e) => e instanceof EasyRefused && e.code === 'PANEL_EASY_REFUSED' && match.test(e.message));
  refused(['nope'], /'nope'.*no control/);
  refused(['m'], /'m'.*no face/);
  refused(['c0', 'c0'], /'c0'.*twice/);
  refused(controls.slice(0, 9).map((c) => c.symbol), /at most 8/);
  refused([], /empty/);
});

const delay = {
  origin: 'authored',
  plugin: { id: 'org.example.delay', format: 'clap', name: 'Delay', features: ['audio-effect'] },
  ports: [],
  controls: [
    { id: 0, symbol: 'pingpong', name: 'pingpong', kind: 'toggle' },
    { id: 1, symbol: 'tone', name: 'tone', kind: 'travel', group: ['Colour'], meaning: 'tone', travel: { min: 0, max: 1, unit: '', default: 0.5, scale: 'linear' } },
    { id: 2, symbol: 'time', name: 'time', kind: 'travel', group: ['Main'], meaning: 'delay', travel: { min: 1, max: 2000, unit: 'ms', default: 350, scale: 'log' } },
    { id: 3, symbol: 'feedback', name: 'feedback', kind: 'travel', group: ['Main'], meaning: 'feedback', travel: { min: 0, max: 1, unit: '', default: 0.3, scale: 'linear' } },
    { id: 4, symbol: 'gr', name: 'gr', kind: 'travel', readonly: true, travel: { min: -60, max: 0, unit: 'dB', default: 0, scale: 'linear' } },
  ],
};

test('the layout carries the list; the canonical form does not move for it', () => {
  const plain = panelLayout(delay);
  const declared = panelLayout({ ...delay, easy: ['pingpong', 'time'] });
  assert.deepEqual(declared.easy, ['pingpong', 'time']);
  assert.deepEqual(plain.easy.slice(0, 2), ['time', 'feedback']);
  assert.equal(panelCanonical(plain), panelCanonical(declared));
  assert.ok(!panelCanonical(declared).includes('easy'));
});

test('a declared panel\'s easy wins over the descriptor\'s', () => {
  const panel = { family: 'none', sections: [{ key: 'all', label: 'All', controls: ['pingpong', 'tone', 'time', 'feedback', 'gr'] }], easy: ['tone'] };
  assert.deepEqual(panelLayout({ ...delay, easy: ['time'] }, { panel }).easy, ['tone']);
});

test('the Easy page comes first, no control twice, and the declared list moves nothing else', () => {
  const l = panelLayout({ ...delay, easy: ['time', 'tone'] });
  const first = pagesOf(l);
  assert.equal(first[0].pageName, 'Easy');
  assert.deepEqual(first[0].ids.filter((v) => v !== null), [2, 1]);
  const all = first.flatMap((p) => p.ids).filter((v) => v !== null);
  assert.equal(new Set(all).size, all.length, 'no control on two pages');
  assert.deepEqual([...all].sort((a, b) => a - b), [0, 1, 2, 3, 4]);
});

test('at two controls a page: more than two Easy controls run on to "Easy 2"', () => {
  const l = panelLayout({ ...delay, easy: ['time', 'tone', 'feedback', 'pingpong'] });
  assert.deepEqual(pagesOf(l, { perPage: 2 }).slice(0, 2).map((p) => [p.pageName, p.ids]), [['Easy', [2, 1]], ['Easy 2', [3, 0]]]);
});

test('the command prints the pages, Easy first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'easy-'));
  const file = join(dir, 'd.json');
  writeFileSync(file, JSON.stringify({ ...delay, easy: ['tone'] }));
  const r = spawnSync(process.execPath, [join(ROOT, 'bin/omx-panel.mjs'), 'layout', '--descriptor', file, '--pages', '--per-page', '4', '--easy-first'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const pages = JSON.parse(r.stdout);
  assert.equal(pages[0].pageName, 'Easy');
  assert.deepEqual(pages[0].ids, [1, null, null, null]);
});

test('a scanned descriptor takes the easy of the descriptor its package installed, by plugin id', async () => {
  const { easyFromInstalled } = await import('../tools/easy-installed.mjs');
  const authored = { plugin: { id: 'org.example.delay' }, easy: ['timeMs', 'tone'], controls: [{ id: 0, symbol: 'timeMs', name: 'time' }, { id: 1, symbol: 'tone', name: 'tone' }] };
  const clap = { origin: 'scanned', plugin: { id: 'org.example.delay', format: 'clap' }, controls: [{ id: 0, name: 'Time' }, { id: 1, name: 'Tone' }] };
  const lv2 = { origin: 'scanned', plugin: { id: 'org.example.delay', format: 'lv2' }, controls: [{ id: 'tone', name: 'Tone' }, { id: 'timeMs', name: 'Time' }] };
  assert.deepEqual(easyFromInstalled(clap, [authored]), ['p0', 'p1']);
  assert.deepEqual(easyFromInstalled(lv2, [authored]), ['timeMs', 'tone']);
  assert.equal(easyFromInstalled({ ...clap, plugin: { id: 'other' } }, [authored]), undefined);
  assert.equal(easyFromInstalled({ ...clap, controls: [{ id: 0, name: 'Time' }] }, [authored]), undefined, 'a key this binary lacks: no list rather than half of one');
});
