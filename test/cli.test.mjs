// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The CLI: exit 0 a valid package, 1 an invalid one with the fault named, 2 a usage or read error.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (...args) => spawnSync(process.execPath, [join(ROOT, 'bin/omx-panel.mjs'), ...args], { encoding: 'utf8' });

test('a valid package directory: exit 0', () => {
  const r = run('validate', join(ROOT, 'examples/skins/org.example.plate'));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^ok   .*skin\.json$/m);
});

test('an invalid file: exit 1, the fault named by file and path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omx-panel-'));
  const file = join(dir, 'skin.json');
  writeFileSync(file, JSON.stringify({ requires: { 'omx-panel-schema': '>= 1.0.0' }, plugin: 'x' }));
  const r = run('validate', file);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL .*skin\.json required \/ /);
});

test('usage and read errors: exit 2', () => {
  assert.equal(run().status, 2);
  assert.equal(run('validate').status, 2);
  assert.equal(run('validate', '/nonexistent/skin.json').status, 2);
});
