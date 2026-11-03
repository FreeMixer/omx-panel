// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The engine every repo's `check-public-sources.mjs` runs: the tracked files state public facts
 * only and never point into a private repository, branch, issue or path (decided 2026-10-13). A
 * prose or comment that needs the origin of a value says what the value is and why, and cites only
 * public repositories.
 *
 * `PRIVATE` is the one forbidden-pattern list, shared verbatim. A consumer keeps its own ALLOW
 * list (its exemptions, each with the reason it is functional or frozen) and its own ROOT, and
 * calls `main` from its CLI entry point — the only things that differ repo to repo (omx-panel#114).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const PRIVATE = [
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

/** The offences of one file's text against `allow` (a consumer's ALLOW list): `[{ line, kind }]`. */
export function scan(path, text, allow) {
  const rules = allow.filter((a) => a.file.test(path));
  if (rules.some((a) => !a.line)) return [];
  const out = [];
  text.split('\n').forEach((l, i) => {
    if (rules.some((a) => a.line.test(l))) return;
    for (const [kind, re] of PRIVATE) if (re.test(l)) out.push({ line: i + 1, kind });
  });
  return out;
}

/** Every tracked file under `root` scanned against `allow`: `["path:line: kind", ...]`. */
export function check(root, allow) {
  const files = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0').filter(Boolean);
  const bad = [];
  for (const f of files) {
    let text;
    try { text = readFileSync(join(root, f), 'utf8'); } catch { continue; }
    if (text.includes('\0')) continue;
    for (const o of scan(f, text, allow)) bad.push(`${f}:${o.line}: ${o.kind}`);
  }
  return bad;
}

const SELF_TEST_HITS = {
  'a.md': 'see FreeMixer/openmixer for it', 'b.json': '"x": "openmixer-ops"', 'c.mjs': '// openmixer#1580',
  'd.h': '/* omx-dsp-dev#32 */', 'e.md': 'branch integration/x', 'f.mjs': "// packages/core/src/eq.ts",
  'g.md': 'Mixer.vue', 'h.md': 'docs/design/specs/x', 'i.md': 'harness/gen.mjs', 'j.md': '2026-09-27-precision-limiter.md',
  'l.md': 'as the transient spec §3 has it', 'm.md': 'the room-analysis design §4', 'n.md': 'tracked in issue #106',
};
const SELF_TEST_CLEAN = ['libomx-contract-dev and omx-contract-devel', '@openmixer/omx-contract', 'the OpenMixer console engine', 'omx-dsp#12', 'disintegration/x'];

/**
 * `allow`'s self-test: every forbidden pattern is caught, every clean name passes, and (when
 * `probe` names a path and a hit key) that path's whole-file exemption actually suppresses one.
 */
export function selfTest(allow, probe) {
  for (const [f, t] of Object.entries(SELF_TEST_HITS)) if (scan(f, t, allow).length !== 1) throw new Error(`self-test: ${f} not caught`);
  for (const t of SELF_TEST_CLEAN) if (scan('k.md', t, allow).length) throw new Error(`self-test: ${t} flagged`);
  if (probe && scan(probe.path, SELF_TEST_HITS[probe.hitKey ?? 'f.mjs'], allow).length) throw new Error('self-test: allowlist ignored');
  console.log('public sources self-test: every private name is caught, public names pass, the allowlist holds');
}

/** A CLI entry point's whole body: `node x.mjs [--root <tree>] [--self-test]`, given its own `root` and `allow`. */
export function main(argv, { root, allow, probe }) {
  if (argv.includes('--self-test')) return selfTest(allow, probe);
  const i = argv.indexOf('--root');
  const bad = check(i >= 0 ? resolve(argv[i + 1]) : root, allow);
  for (const b of bad) console.log(`  ${b}`);
  console.log(bad.length ? `public sources: ${bad.length} private pointer(s); state the fact instead and cite public repositories only` : 'public sources: no tracked file points into a private repository');
  process.exit(bad.length ? 1 : 0);
}
