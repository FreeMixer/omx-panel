// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The shipped fixtures (tools/fixtures.mjs): `@openmixer/omx-panel/fixtures`, resolved through the package's own
 * exports, names a bundle under dist/ that holds every file of the tree's fixtures/ byte for byte, so a package that
 * tests against it needs no copy of its own.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES_DIR, MODGUI_ECHO } from '@openmixer/omx-panel/fixtures';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = (dir) => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => relative(dir, join(e.parentPath, e.name))).sort();

test('the package export names the fixtures under dist/', () => {
  assert.equal(relative(ROOT, FIXTURES_DIR), join('dist', 'fixtures'));
  assert.equal(relative(FIXTURES_DIR, MODGUI_ECHO), join('modgui', 'omx-fixture-echo.lv2'));
});

test('dist/ carries every fixture file of the tree, byte for byte', () => {
  const tree = files(join(ROOT, 'fixtures'));
  assert.ok(tree.length > 0);
  assert.deepEqual(files(FIXTURES_DIR), tree);
  for (const f of tree) assert.ok(readFileSync(join(FIXTURES_DIR, f)).equals(readFileSync(join(ROOT, 'fixtures', f))), f);
});

test('the MOD GUI echo bundle holds its plugin, its modgui.ttl and its art', () => {
  for (const f of ['manifest.ttl', 'echo.ttl', 'modgui.ttl', 'modgui/stylesheet-echo.css', 'modgui/icon-echo.html', 'modgui/knobs/knob-sprite.png'])
    assert.ok(files(MODGUI_ECHO).includes(f), f);
});
