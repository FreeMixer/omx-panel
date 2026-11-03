// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The public-sources-check engine (tools/public-sources-check.mjs, exported so a consumer declares only its
// own ALLOW list and ROOT and shares the forbidden-pattern list, the scan/check logic and the self-test
// vectors — omx-panel#114). check-public-sources.mjs is this repo's thin CLI wrapper on top.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { check, scan, selfTest } from '../dist/tools/public-sources-check.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('scan catches each forbidden pattern and nothing a clean name trips, respecting an allow list', () => {
  assert.deepEqual(scan('a.md', 'see FreeMixer/openmixer for it', []).map((o) => o.kind), ['the private openmixer repository']);
  assert.deepEqual(scan('a.md', 'the OpenMixer console engine', []), []);
  const lineAllow = [{ file: /^a\.md$/, line: /^exempt/ }];
  assert.deepEqual(scan('a.md', 'exempt FreeMixer/openmixer', lineAllow), []);
  assert.equal(scan('a.md', 'not exempt FreeMixer/openmixer', lineAllow).length, 1);
  const wholeFileAllow = [{ file: /^b\.md$/ }];
  assert.deepEqual(scan('b.md', 'FreeMixer/openmixer\nopenmixer-ops', wholeFileAllow), []);
});

test('check walks a tree’s git-tracked files and reports path:line:kind, skipping untracked and binary files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'public-sources-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  writeFileSync(join(dir, 'clean.md'), 'the OpenMixer console engine\n');
  writeFileSync(join(dir, 'leak.md'), 'one\nsee FreeMixer/openmixer here\n');
  writeFileSync(join(dir, 'untracked.md'), 'FreeMixer/openmixer\n');
  writeFileSync(join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 0]));
  execFileSync('git', ['add', 'clean.md', 'leak.md', 'bin.dat'], { cwd: dir });
  assert.deepEqual(check(dir, []), ['leak.md:2: the private openmixer repository']);
});

test('selfTest passes with a working allow list, and names the break when the allowlist is ignored', () => {
  const allow = [{ file: /^x\.mjs$/ }];
  assert.doesNotThrow(() => selfTest(allow, { path: 'x.mjs' }));
  assert.throws(() => selfTest([], { path: 'x.mjs' }), /allowlist ignored/);
});

test('this repo’s check-public-sources.mjs (the thin wrapper) passes --self-test and its own tree clean', () => {
  const selfTestRun = spawnSync(process.execPath, [join(ROOT, 'tools/check-public-sources.mjs'), '--self-test'], { encoding: 'utf8' });
  assert.equal(selfTestRun.status, 0);
  assert.match(selfTestRun.stdout, /the allowlist holds/);
  const treeRun = spawnSync(process.execPath, [join(ROOT, 'tools/check-public-sources.mjs')], { encoding: 'utf8' });
  assert.equal(treeRun.status, 0);
  assert.match(treeRun.stdout, /no tracked file points into a private repository/);
});

test('--root over a throwaway tree holding a private pointer: exit 1, the file:line:kind named', () => {
  const dir = mkdtempSync(join(tmpdir(), 'public-sources-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  writeFileSync(join(dir, 'note.md'), 'see FreeMixer/openmixer for the private context\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  const r = spawnSync(process.execPath, [join(ROOT, 'tools/check-public-sources.mjs'), '--root', dir], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /note\.md:1: the private openmixer repository/);
});
