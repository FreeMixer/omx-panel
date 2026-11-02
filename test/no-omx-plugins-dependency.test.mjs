// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// omx-plugins builds with omx-panel, so omx-panel builds and runs with nothing of omx-plugins: no package dependency
// on it in either format, none installed by the jobs that run the suite, no read of its parameter-contract header, and
// the unit table answers from a contract directory that holds only omx-contract and plugin-hostd.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** The package names a dependency line or field lists. */
const names = (text) => text.split(',').map((s) => s.trim().split(/[\s(]/)[0]).filter(Boolean);

/** A debian/control field, its continuation lines joined. */
const debField = (name) => {
  const m = new RegExp(`^${name}:((?:.*)(?:\\n[ \\t].*)*)`, 'm').exec(read('debian/control'));
  assert.ok(m, `debian/control has no ${name}`);
  return m[1];
};

test('the RPM names omx-plugins as neither a build nor a run requirement', () => {
  const lines = read('packaging/omx-panel.spec').split('\n').filter((l) => /^(BuildRequires|Requires):/.test(l));
  assert.ok(lines.some((l) => l.includes('omx-contract-data')), 'the spec parsed no requirements');
  assert.deepEqual(lines.filter((l) => /omx-plugins/.test(l)), []);
});

test('the DEB names omx-plugins as neither a build nor a run dependency', () => {
  for (const field of ['Build-Depends', 'Depends']) {
    const deps = names(debField(field));
    assert.ok(deps.includes('omx-contract-data'), `${field} parsed no omx-contract-data`);
    assert.deepEqual(deps.filter((d) => d.startsWith('omx-plugins') || d.startsWith('libomx-plugins')), [], field);
  }
});

test('the jobs that run the suite install nothing of omx-plugins', () => {
  for (const f of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
    const installs = read(f).split('\n').filter((l) => /\bdnf install\b/.test(l) && !l.trim().startsWith('#'));
    assert.ok(installs.some((l) => l.includes('omx-contract-data')), `${f}: no vocabulary install found`);
    assert.deepEqual(installs.filter((l) => l.includes('omx-plugins')), [], f);
  }
});

test('no tool reads omx_param_contract.h or $OMX_PARAM_CONTRACT_H', () => {
  const dirs = ['bin', 'tools'];
  const files = dirs.flatMap((d) => readdirSync(join(ROOT, d), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(d, e.name)));
  assert.ok(files.includes(join('tools', 'vocabulary.mjs')), 'the walk missed tools/vocabulary.mjs');
  assert.deepEqual(files.filter((f) => /omx_param_contract\.h|OMX_PARAM_CONTRACT_H/.test(read(f))), []);
});

test('a contract directory with no omx-plugins answers the unit table with the declared codes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omx-panel-no-plugins-'));
  const put = (rel, value) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), JSON.stringify(value));
  };
  put('3/omx-contract/param-contract.json', { OMX_PARAM_CONTRACT_UNITS: { kind: 'sheet', value: { none: 0, db: 13, lufs: 259 } } });
  put('lv2.json', { PLUGIN_HOSTD_LV2_MAP: { kind: 'formatMap', rows: { unit: { word: { word: 'controls[].travel.unit', transform: 'lookup', values: { 'units:db': 'dB' } } } } } });
  const code = `const v = await import(${JSON.stringify(join(ROOT, 'dist/tools/vocabulary.mjs'))});
    process.stdout.write(JSON.stringify([v.servedToken('dB'), v.servedToken('LUFS'), v.servedToken('dB/s') ?? null, v.paramUnits().get('LUFS')]));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8',
    env: { ...process.env, OMX_CONTRACT_PATH: dir, PLUGIN_HOSTD_TABLES: dir, PKG_CONFIG: '/nonexistent/pkg-config' },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), ['db', 'lufs', null, 259]);
});
