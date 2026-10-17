// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The skin package validator: a skin.json against the schema. This is the stub the loader grows
 * from; it checks the shape and nothing else. The rules that need the plugin's description (a
 * control id that exists, a role that fits its control) and the licence rules are the loader's.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

export const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema', 'skin-package.schema.json');

/** The schema as the file holds it. */
export function loadSchema(path = SCHEMA_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** A validator over `schema` (the file's own by default). `validateSkin(doc)` returns `{ ok, errors }`, each error `{ path, code, message }`, `code` the Ajv keyword that refused (`required`, `pattern`, ...). */
export function makeValidator(schema = loadSchema()) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const check = ajv.compile(schema);
  return function validateSkin(doc) {
    const ok = check(doc) === true;
    const errors = ok ? [] : (check.errors ?? []).map((e) => ({ path: e.instancePath === '' ? '/' : e.instancePath, code: e.keyword, message: e.message ?? '' }));
    return { ok, errors };
  };
}

export const validateSkin = makeValidator();
