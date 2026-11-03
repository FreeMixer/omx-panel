#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * copies-check.mjs — no tracked file of a tree is a copy of what omx-panel renders or ships. The knob and fader film
 * strips are every bundle's same render of the look (a build writes them: `omx-panel modgui --films-only`), and the
 * fixture bundles ship with the package (@openmixer/omx-panel/fixtures): a consumer that commits one of them byte for
 * byte keeps a copy that goes stale on omx-panel's next release.
 *
 *   omx-panel copies <tree>        exit 0 no copy, 1 each copy named with what it copies, 2 usage or not a git tree
 *   omx-panel copies --self-test   the check over a scratch tree: clean, then a film strip and a fixture file put back
 *
 * A tree's tracked files are `git ls-files`; a symbolic link is not a copy. omx-panel's own tree holds the fixtures
 * at their own paths, and those are the fixtures, not copies of them.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES_DIR } from './fixtures.mjs';
import { loadLook, renderFaderFilm, renderFilm } from './modgui-gen.mjs';

const HERE = fileURLToPath(import.meta.url);
const PACKAGE_NAME = '@openmixer/omx-panel';
const USAGE = 'usage: copies-check.mjs <tree> | --self-test\n';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** What omx-panel renders or ships, by digest: each a name a reader can follow, and its path in omx-panel's tree. */
export function canonicalFiles() {
  const tokens = loadLook().tokens;
  const out = new Map();
  out.set(sha(renderFilm(tokens)), { name: 'the knob film strip (omx-panel modgui --films-only)', path: null });
  out.set(sha(renderFaderFilm(tokens)), { name: 'the fader film strip (omx-panel modgui --films-only)', path: null });
  for (const e of readdirSync(FIXTURES_DIR, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const at = join(e.parentPath, e.name);
    const path = join('fixtures', relative(FIXTURES_DIR, at)).split('\\').join('/');
    out.set(sha(readFileSync(at)), { name: `${path} (${PACKAGE_NAME}/fixtures)`, path });
  }
  return out;
}

/** Whether `tree` is omx-panel's own, whose fixtures/ is where the fixtures live. */
function isOwnTree(tree) {
  const pkg = join(tree, 'package.json');
  try {
    return existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf8')).name === PACKAGE_NAME;
  } catch {
    return false;
  }
}

/** Every tracked file of `tree` that is byte for byte something omx-panel renders or ships: [path, what it copies]. */
export function copiesIn(tree, canon = canonicalFiles()) {
  const listed = execFileSync('git', ['-C', tree, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const own = isOwnTree(tree);
  const found = [];
  for (const path of listed) {
    const at = join(tree, path);
    if (!existsSync(at)) continue;
    const st = lstatSync(at);
    if (!st.isFile() || st.size === 0) continue;
    const hit = canon.get(sha(readFileSync(at)));
    if (!hit || (own && hit.path === path)) continue;
    found.push([path, hit.name]);
  }
  return found;
}

function check(tree) {
  if (spawnSync('git', ['-C', tree, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' }).status !== 0) {
    process.stderr.write(`copies-check: ${tree} is not a git work tree\n`);
    return 2;
  }
  const found = copiesIn(tree);
  for (const [path, name] of found) process.stderr.write(`copies-check: COPY ${path} is ${name}; delete it and take it from omx-panel\n`);
  if (found.length) return 1;
  process.stdout.write(`copies-check: ${tree} keeps no copy of what omx-panel renders or ships\n`);
  return 0;
}

/** The check over a scratch tree: clean passes, a film strip or a fixture file put back fails naming it. */
function selfTest() {
  const tree = mkdtempSync(join(tmpdir(), 'copies-check-'));
  const git = (...a) => execFileSync('git', ['-C', tree, ...a], { stdio: 'ignore' });
  git('init', '-q');
  writeFileSync(join(tree, 'README'), 'a consumer\n');
  git('add', '.');
  const run = () => spawnSync(process.execPath, [HERE, tree], { encoding: 'utf8' });
  const arms = [];
  const arm = (what, ok) => arms.push([what, ok]);
  let r = run();
  arm('a clean tree passes', r.status === 0);
  const knob = join(tree, 'plugin.lv2/modgui/knobs/omx-knob.png');
  mkdirSync(dirname(knob), { recursive: true });
  writeFileSync(knob, renderFilm(loadLook().tokens));
  git('add', '.');
  r = run();
  arm('a committed knob film strip fails, named', r.status === 1 && r.stderr.includes('plugin.lv2/modgui/knobs/omx-knob.png'));
  git('rm', '-q', '--cached', 'plugin.lv2/modgui/knobs/omx-knob.png');
  arm('an untracked one is the build\'s, not a copy', run().status === 0);
  const fixture = join(tree, 'test/echo.ttl');
  mkdirSync(dirname(fixture), { recursive: true });
  copyFileSync(join(FIXTURES_DIR, 'modgui/omx-fixture-echo.lv2/echo.ttl'), fixture);
  git('add', 'test/echo.ttl');
  r = run();
  arm('a committed fixture file fails, named', r.status === 1 && r.stderr.includes('test/echo.ttl'));
  arm('a tree that is not git is a usage error', spawnSync(process.execPath, [HERE, mkdtempSync(join(tmpdir(), 'copies-check-bare-'))], { encoding: 'utf8', env: { ...process.env, GIT_CEILING_DIRECTORIES: tmpdir() } }).status === 2);
  let failed = 0;
  for (const [what, ok] of arms) {
    process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${what}\n`);
    if (!ok) failed++;
  }
  return failed ? 1 : 0;
}

export function main(argv) {
  if (argv.length !== 1) {
    process.stderr.write(USAGE);
    return 2;
  }
  return argv[0] === '--self-test' ? selfTest() : check(resolve(argv[0]));
}

if (process.argv[1] && resolve(process.argv[1]) === HERE) process.exit(main(process.argv.slice(2)));
