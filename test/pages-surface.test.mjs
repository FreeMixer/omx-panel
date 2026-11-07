// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The command that serves the one cut to a surface that is not node, and the rule that no surface path of this repo owns a page
 * size (one-panel spec 7.14): `omx-panel describe --pages --per-page N` prints what the library call returns, and the only
 * literal width in the sources is the default PAGE_SIZE of panel-description.mjs.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { describe } from '../dist/tools/describe.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (...args) => spawnSync(process.execPath, [join(ROOT, 'dist/bin/omx-panel.mjs'), ...args], { encoding: 'utf8' });
const FIX = join(ROOT, 'test/fixtures/organ');
const descriptor = join(FIX, 'organ.descriptor.json');
const tmp = mkdtempSync(join(tmpdir(), 'omx-pages-'));
const write = (name, v) => { const f = join(tmp, name); writeFileSync(f, JSON.stringify(v)); return f; };
const d = JSON.parse(readFileSync(descriptor, 'utf8'));

for (const perPage of [4, 8]) {
  test(`describe --pages --per-page ${perPage} prints the library's cut, value for value`, () => {
    const r = run('describe', '--descriptor', descriptor, '--pages', '--per-page', String(perPage));
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), describe(d, { perPage }).description.pages);
  });
}
test('describe --pages with the width left out is the default cut, and the pages are Easy first', () => {
  const r = run('describe', '--descriptor', descriptor, '--pages');
  assert.deepEqual(JSON.parse(r.stdout), describe(d).description.pages);
  assert.equal(JSON.parse(r.stdout)[0].pageName, 'Easy');
});
test('describe --skin applies the skin before the cut: its easy and its sections', () => {
  const symbols = d.controls.map((c) => c.symbol ?? c.id);
  const skin = { schema: 1, plugin: d.plugin.id, licence: 'CC0-1.0', easy: [symbols[1]], sections: [{ key: 'all', label: 'All', controls: [...symbols].reverse() }] };
  const r = run('describe', '--descriptor', descriptor, '--skin', write('skin.json', skin), '--pages', '--per-page', '4');
  assert.deepEqual(JSON.parse(r.stdout), describe(d, { skin, perPage: 4 }).description.pages);
  assert.equal(JSON.parse(r.stdout)[0].ids[0], d.controls[1].id);
});
test('describe --remote: the host\'s declared pages replace the derived ones, as given', () => {
  const remote = [{ name: 'Mix', ids: [d.controls[3].id, d.controls[0].id] }];
  const r = run('describe', '--descriptor', descriptor, '--remote', write('remote.json', remote), '--pages', '--per-page', '4');
  assert.deepEqual(JSON.parse(r.stdout), describe(d, { remote, perPage: 4 }).description.pages);
  assert.deepEqual(JSON.parse(r.stdout).map((p) => p.pageName), ['Easy', 'Mix']);
});
test('describe without --pages serves the description and the refusals; a bad width is a usage error', () => {
  const r = run('describe', '--descriptor', descriptor);
  assert.deepEqual(JSON.parse(r.stdout), JSON.parse(JSON.stringify(describe(d))));
  for (const bad of ['0', '-1', '2.5', 'x']) assert.equal(run('describe', '--descriptor', descriptor, '--pages', '--per-page', bad).status, 2, bad);
  assert.equal(run('describe').status, 2);
});

// ---- no surface path owns a page size
const LITERAL_WIDTH = /\bperPage\s*[:=]\s*[0-9]|\bPAGE_SIZE\s*=|--per-page['"`]?\s*,\s*['"`]?[0-9]|\bpagesOf\([^)]*\b(?:size|width)\s*[:=]\s*[0-9]/;
const sources = (dir) => readdirSync(dir).flatMap((n) => {
  const f = join(dir, n);
  return statSync(f).isDirectory() ? (n === 'node_modules' ? [] : sources(f)) : /\.(mjs|ts|js)$/.test(n) && !n.endsWith('.d.ts') && !n.endsWith('.d.mts') ? [f] : [];
});
test('the only literal page size in the sources is the default of the one cut', () => {
  const hits = ['bin', 'tools', 'src', 'lib'].flatMap((d) => sources(join(ROOT, d)))
    .flatMap((f) => readFileSync(f, 'utf8').split('\n').map((line, i) => [relative(ROOT, f), i + 1, line]).filter(([, , line]) => LITERAL_WIDTH.test(line)));
  assert.deepEqual(hits.map(([f, , line]) => `${f}: ${line.trim()}`), ['tools/panel-description.mjs: export const PAGE_SIZE = 8;']);
});
test('arm: the rule reads a surface that plants a width', () => {
  for (const planted of ['pagesOf(x, { perPage: 4 })', 'const perPage = 8;', 'spawn(["describe", "--per-page", "4"])', 'const PAGE_SIZE = 4;']) assert.ok(LITERAL_WIDTH.test(planted), planted);
  for (const fine of ['pagesOf(x, { perPage })', 'perPage: surface.width', 'perPage: Number(raw)']) assert.ok(!LITERAL_WIDTH.test(fine), fine);
});
