// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The command as the packages ship it (dist/bin/omx-panel.mjs): validate exits 0 on a valid package, 1 on an invalid
// one with the fault named, 2 on a usage or read error; layout, modgui, import and look each do their tool's job.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (...args) => spawnSync(process.execPath, [join(ROOT, 'dist/bin/omx-panel.mjs'), ...args], { encoding: 'utf8' });
const FIX = join(ROOT, 'test/fixtures/omx-delay');

test('a valid package directory: exit 0', () => {
  const r = run('validate', join(ROOT, 'examples/skins/org.example.plate'));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^ok   .*skin\.json$/m);
});

test('an invalid file: exit 1, the fault named by file and path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omx-panel-'));
  const file = join(dir, 'skin.json');
  writeFileSync(file, JSON.stringify({ schema: 1, plugin: 'x' }));
  const r = run('validate', file);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL .*skin\.json required \/ /);
});

test('usage and read errors: exit 2', () => {
  assert.equal(run().status, 2);
  assert.equal(run('validate').status, 2);
  assert.equal(run('validate', '/nonexistent/skin.json').status, 2);
  assert.equal(run('nonsense').status, 2);
  assert.equal(run('layout').status, 2);
});

test('layout: a descriptor under its declared panel, as JSON, canonical text and pages', () => {
  const args = ['layout', '--descriptor', join(FIX, 'omx-delay.descriptor.json'), '--panel', join(FIX, 'omx-delay.panel.json'), '--ns', 'fx.delay'];
  const json = run(...args);
  assert.equal(json.status, 0, json.stderr);
  const x = JSON.parse(json.stdout);
  assert.equal(x.family, 'delay');
  assert.deepEqual(x.controls.map((c) => c.symbol), ['pingpong', 'fxDelayTime', 'fxDelayFeedback', 'mix', 'tone']);
  const canonical = run(...args, '--canonical');
  assert.match(canonical.stdout, /^org\.openmixer\.panel-description\/1\nfamily\tdelay\nsection\t0\tdelay\tfx\.delay\.section\.delay\n/);
  const pages = JSON.parse(run(...args, '--pages').stdout);
  assert.deepEqual(pages.map((p) => [p.pageName, p.ids.filter((i) => i !== null).length]), [['Delay', 5]]);
});

test('modgui: --check over omx-plugins\' committed omx-delay MOD GUI is clean', () => {
  const r = run('modgui', '--check', '--descriptor', join(FIX, 'omx-delay.descriptor.json'), '--panel', join(FIX, 'omx-delay.panel.json'),
    '--out', join(FIX, 'omx-delay.lv2'), '--source', 'plugins/omx-delay/omx-delay.decl.json (its panel block) and tools/look.json');
  assert.equal(r.status, 0, r.stderr);
});

test('import: the fixture bundle becomes a package that validates; a refused licence exits 3 with nothing written', () => {
  const out = mkdtempSync(join(tmpdir(), 'omx-panel-skins-'));
  const r = run('import', join(ROOT, 'test/fixtures/modgui/omx-fixture-echo.lv2'), '--out', out);
  assert.equal(r.status, 0, r.stderr);
  const line = JSON.parse(r.stdout.split('\n').find((l) => l.startsWith('MODGUI-IMPORT-JSON ')).slice('MODGUI-IMPORT-JSON '.length));
  assert.equal(line.verdict, 'written');
  assert.equal(run('validate', line.dir).status, 0);
  assert.equal(JSON.parse(readFileSync(join(line.dir, 'skin.json'), 'utf8')).schema, 1);
  const none = join(mkdtempSync(join(tmpdir(), 'omx-panel-none-')), 'skins');
  const bad = run('import', '/nonexistent.lv2', '--out', none);
  assert.equal(bad.status, 3);
  assert.equal(existsSync(none), false);
});

test('look: --check finds look.json fresh', () => {
  const r = run('look', '--check');
  assert.equal(r.status, 0, r.stderr);
});
