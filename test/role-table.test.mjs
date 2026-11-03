// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The role table (tools/role-table.mjs) as a consumer reads it: `@openmixer/omx-panel/role-table`, resolved
 * through the package's own exports, is data a browser loads as it is (no import, no file read), and it is THE
 * table: the layout and the skin package's D6 check hand out these very objects, and the schema's indexed roles
 * are its indexed roles.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDEXED_ROLES, REQUIRED_ROLES, ROLES } from '@openmixer/omx-panel/role-table';
import * as layout from '@openmixer/omx-panel/panel-description';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = readFileSync(join(ROOT, 'tools/role-table.mjs'), 'utf8');

/** What keeps a module out of a browser: an import of anything, or a read of the disk. */
const notBrowserSafe = (text) =>
  [...text.matchAll(/^\s*import\b[^\n]*|\bimport\s*\(|\brequire\s*\(|\breadFileSync\b|\bnode:[a-z]/gm)].map((m) => m[0].trim());

test('the role table is data a browser loads: no import, no file read', () => {
  assert.deepEqual(notBrowserSafe(SOURCE), []);
});

test('sabotage: an import or a file read in the table is named', () => {
  const planted = "import { readFileSync } from 'node:fs';\nexport const X = JSON.parse(readFileSync('x'));\n";
  assert.ok(notBrowserSafe(planted).length >= 2);
});

test("the indexed roles are the schema's indexedRole", () => {
  const schema = JSON.parse(readFileSync(join(ROOT, 'schema/panel.schema.json'), 'utf8'));
  assert.deepEqual([...INDEXED_ROLES], schema.$defs.indexedRole.enum);
});

test('every family has its roles and its required ones, and each required role is one of its roles', () => {
  assert.deepEqual(Object.keys(REQUIRED_ROLES).sort(), Object.keys(ROLES).sort());
  assert.deepEqual(Object.keys(ROLES).sort(), [...layout.FAMILIES].sort());
  const strays = Object.entries(REQUIRED_ROLES).flatMap(([family, alts]) =>
    alts.flat().filter((role) => !(role in ROLES[family])).map((role) => `${family}.${role}`),
  );
  assert.deepEqual(strays, []);
});

test('the layout hands out the very same table, not a copy of it', () => {
  assert.equal(layout.ROLES, ROLES);
  assert.equal(layout.INDEXED_ROLES, INDEXED_ROLES);
});
