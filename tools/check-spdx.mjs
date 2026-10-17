#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * check-spdx.mjs — `make spdx`: every tracked source, script, workflow and document carries the licence line and the
 * author's copyright line in its first lines. A file of data the format forbids comments in (JSON, the licence text,
 * the lock file) is listed in EXEMPT with the reason.
 *
 *   node tools/check-spdx.mjs [--root <tree>] [--self-test]
 *
 * Exit 0 clean; 1 a file without them, each named; 2 usage.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPDX = /SPDX-License-Identifier: GPL-3\.0-or-later/;
const COPYRIGHT = /Copyright \(C\) 2026 Pau Aliagas <linuxnow@gmail\.com>/;

/** Files that cannot carry a comment, or whose licence text is another's: the reason is the entry. */
export const EXEMPT = [
  [/\.json$/, 'JSON has no comments'],
  [/^LICENSE$/, 'the licence text'],
  [/^\.gitignore$/, 'a list of patterns'],
  [/^debian\/(changelog|control|source\/format|copyright)$/, 'Debian metadata, a format of its own'],
  [/^examples\/.*\.png$/, 'example art'],
];

/** The tracked files that do not carry both lines in their first 20 lines. */
export function missing(files, read) {
  return files.filter((f) => {
    if (EXEMPT.some(([re, why]) => re.test(f) && why !== null)) return false;
    const head = read(f).split('\n').slice(0, 20).join('\n');
    return !(SPDX.test(head) && COPYRIGHT.test(head));
  });
}

function selfTest() {
  const files = { 'a.mjs': '// SPDX-License-Identifier: GPL-3.0-or-later\n// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>\n', 'b.mjs': 'x\n', 'c.json': '{}', 'd.mjs': '// SPDX-License-Identifier: GPL-3.0-or-later\n' };
  const got = missing(Object.keys(files), (f) => files[f]);
  if (JSON.stringify(got) !== JSON.stringify(['b.mjs', 'd.mjs'])) throw new Error(`self-test: ${JSON.stringify(got)}`);
}

function main(argv) {
  const root = argv.includes('--root') ? resolve(argv[argv.indexOf('--root') + 1]) : ROOT;
  if (argv.includes('--self-test')) {
    selfTest();
    return 0;
  }
  const files = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const bad = missing(files, (f) => {
    try { return readFileSync(resolve(root, f), 'utf8'); } catch { return ''; }
  });
  for (const f of bad) process.stdout.write(`FAIL ${f}: no SPDX licence line and copyright line in its first lines\n`);
  if (!bad.length) process.stdout.write(`ok   ${files.length} tracked files, every one carries the licence or is exempt with a reason\n`);
  return bad.length ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
