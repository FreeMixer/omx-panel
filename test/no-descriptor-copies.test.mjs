// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * omx-contract publishes the example descriptors (@openmixer/omx-contract/examples/descriptors/*); the tests read
 * them from there. No fixture of this tree may carry one again, by name or by bytes: a copy goes stale the day the
 * owner's changes (one did, missing the control symbols). A fixture omx-contract does not publish stays here.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const PUBLISHED = join(dirname(require.resolve('@openmixer/omx-contract/package.json')), 'examples', 'descriptors');
const published = new Map(readdirSync(PUBLISHED).map((f) => [f, readFileSync(join(PUBLISHED, f)).toString('base64')]));
const bytes = new Map([...published].map(([f, b]) => [b, f]));

/** Each local file that is a published example again: its name, or its bytes under another name. */
const copies = (files) =>
  files.flatMap(({ name, data }) => {
    if (published.has(name)) return [`${name}: omx-contract publishes it`];
    const same = bytes.get(data.toString('base64'));
    return same ? [`${name}: the bytes of omx-contract's ${same}`] : [];
  });

const LOCAL = join(ROOT, 'test', 'fixtures', 'descriptors');
const local = () => readdirSync(LOCAL).map((name) => ({ name, data: readFileSync(join(LOCAL, name)) }));

test('omx-contract publishes example descriptors (a check over nothing proves nothing)', () => {
  assert.ok(published.size >= 4, `${published.size} under ${PUBLISHED}`);
});

test("no fixture is one of omx-contract's example descriptors again", () => {
  assert.deepEqual(copies(local()), []);
});

test('sabotage: a published example by its name, or by its bytes under another, is named', () => {
  const [name, b64] = [...published][0];
  assert.deepEqual(copies([{ name, data: Buffer.from('{}') }]), [`${name}: omx-contract publishes it`]);
  assert.deepEqual(copies([{ name: 'renamed.json', data: Buffer.from(b64, 'base64') }]), [`renamed.json: the bytes of omx-contract's ${name}`]);
});
