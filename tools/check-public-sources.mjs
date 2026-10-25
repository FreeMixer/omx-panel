#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * check-public-sources.mjs — `make public-sources`: the tracked files state public facts only and
 * never point into a private repository, branch, issue or path (operator ruling 2026-10-13). A
 * prose or comment that needs the origin of a value says what the value is and why, and cites only
 * public repositories (omx-dsp, omx-contract, omx-plugins, plugin-qualify, omx-panel).
 *
 *   node tools/check-public-sources.mjs [--root <tree>] [--self-test]
 *
 * Exit 0 clean; 1 a private pointer, each named file:line; 2 usage. ALLOW below is the whole list of
 * exemptions, each with the reason it is functional or frozen.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PRIVATE = [
  ['the private openmixer repository', /FreeMixer\/openmixer(?![\w-])/i],
  ['openmixer-ops', /openmixer-ops/i],
  ['an openmixer issue', /openmixer ?#\d+/i],
  ['a private *-dev issue', /\b[a-z0-9]+(?:-[a-z0-9]+)*-dev#\d+/i],
  ['an integration/ branch', /\bintegration\//],
  ['a path in the private packages tree', /\bpackages\/[a-z][a-z0-9-]*\//],
  ['a web-ui file', /\.vue\b/],
  ['a private design document', /\bdocs\/design\//],
  ['a private harness path', /\bharness\/[\w.-]+/],
  ['a dated private spec file', /\b20\d\d-\d\d-\d\d-[a-z0-9-]+\.md\b/],
  ['a citation of a private specification section', /\b(?:spec|design) §\d/i],
  ['a private issue number', /\bissue #\d+/i],
];

/** Exemptions: `file` matches the path, `line` (optional) the offending line; `why` is the reason. */
export const ALLOW = [
  { file: /^tools\/check-public-sources\.mjs$/, why: 'this check names what it forbids' },
  { file: /^test\/skin-package\.test\.mjs$/, line: /h\.vue\.h\(/, why: 'a view reaches Vue through the skin host, h.vue, never a .vue file' },
];

/** The offences of one file's text: `[{ line, kind }]`. */
export function scan(path, text, allow = ALLOW) {
  const rules = allow.filter((a) => a.file.test(path));
  if (rules.some((a) => !a.line)) return [];
  const out = [];
  text.split('\n').forEach((l, i) => {
    if (rules.some((a) => a.line.test(l))) return;
    for (const [kind, re] of PRIVATE) if (re.test(l)) out.push({ line: i + 1, kind });
  });
  return out;
}

export function check(root = ROOT) {
  const files = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0').filter(Boolean);
  const bad = [];
  for (const f of files) {
    let text;
    try { text = readFileSync(join(root, f), 'utf8'); } catch { continue; }
    if (text.includes('\0')) continue;
    for (const o of scan(f, text)) bad.push(`${f}:${o.line}: ${o.kind}`);
  }
  return bad;
}

function selfTest() {
  const hits = {
    'a.md': 'see FreeMixer/openmixer for it', 'b.json': '"x": "openmixer-ops"', 'c.mjs': '// openmixer#1580',
    'd.h': '/* omx-dsp-dev#32 */', 'e.md': 'branch integration/x', 'f.mjs': "// packages/core/src/eq.ts",
    'g.md': 'Mixer.vue', 'h.md': 'docs/design/specs/x', 'i.md': 'harness/gen.mjs', 'j.md': '2026-09-27-precision-limiter.md',
    'l.md': 'as the transient spec §3 has it', 'm.md': 'the room-analysis design §4', 'n.md': 'tracked in issue #106',
  };
  const clean = ['libomx-contract-dev and omx-contract-devel', '@openmixer/omx-contract', 'the OpenMixer console engine', 'omx-dsp#12', 'disintegration/x'];
  for (const [f, t] of Object.entries(hits)) if (scan(f, t).length !== 1) throw new Error(`self-test: ${f} not caught`);
  for (const t of clean) if (scan('k.md', t).length) throw new Error(`self-test: ${t} flagged`);
  if (scan('tools/check-public-sources.mjs', hits['f.mjs']).length) throw new Error('self-test: allowlist ignored');
  console.log('public sources self-test: every private name is caught, public names pass, the allowlist holds');
}

function main(argv) {
  if (argv.includes('--self-test')) return selfTest();
  const i = argv.indexOf('--root');
  const bad = check(resolve(i >= 0 ? argv[i + 1] : ROOT));
  for (const b of bad) console.log(`  ${b}`);
  console.log(bad.length ? `public sources: ${bad.length} private pointer(s); state the fact instead and cite public repositories only` : 'public sources: no tracked file points into a private repository');
  process.exit(bad.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
