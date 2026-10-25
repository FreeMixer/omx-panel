#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * omx-panel validate <skin.json | skin package directory>...
 *
 * Exit 0 every file is valid; 1 a file is not, each fault named by file and path; 2 a usage or read error.
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { validateSkin } from '../lib/validate.mjs';

const [command, ...targets] = process.argv.slice(2);
if (command !== 'validate' || targets.length === 0) {
  process.stderr.write('usage: omx-panel validate <skin.json | skin package directory>...\n');
  process.exit(2);
}

let failed = 0;
for (const target of targets) {
  let file = target;
  try {
    if (statSync(target).isDirectory()) file = join(target, 'skin.json');
    const result = validateSkin(JSON.parse(readFileSync(file, 'utf8')));
    if (result.ok) {
      process.stdout.write(`ok   ${file}\n`);
    } else {
      failed++;
      for (const e of result.errors) process.stdout.write(`FAIL ${file} ${e.code} ${e.path} ${e.message}\n`);
    }
  } catch (err) {
    process.stderr.write(`omx-panel: ${file}: ${err.message}\n`);
    process.exit(2);
  }
}
process.exit(failed ? 1 : 0);
