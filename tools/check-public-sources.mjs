#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * check-public-sources.mjs — `make public-sources`: this repo's ALLOW list over the shared engine
 * (public-sources-check.mjs, exported so every consumer declares the forbidden-pattern list and the
 * scan/check/self-test logic once, omx-panel#114). Only the ALLOW list and ROOT are this repo's own.
 *
 *   node tools/check-public-sources.mjs [--root <tree>] [--self-test]
 *
 * Exit 0 clean; 1 a private pointer, each named file:line; 2 usage.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main as runCheck } from './public-sources-check.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Exemptions: `file` matches the path, `line` (optional) the offending line; `why` is the reason. */
export const ALLOW = [
  { file: /^tools\/check-public-sources\.mjs$/, why: 'this check names what it forbids' },
  { file: /^test\/skin-package\.test\.mjs$/, line: /h\.vue\.h\(/, why: 'a view reaches Vue through the skin host, h.vue, never a .vue file' },
];

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCheck(process.argv.slice(2), { root: ROOT, allow: ALLOW, probe: { path: 'tools/check-public-sources.mjs' } });
}
