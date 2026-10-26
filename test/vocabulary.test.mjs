// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// Where tools/vocabulary.mjs finds the contract directory: $OMX_CONTRACT_PATH (a `:` list, the first holding a package
// wins), else omx-contract's pkg-config `contractdir`, else /usr/share/omx-contract/contract.d, the directory
// omx-contract-data installs with no omx-contract.pc. Each case runs in its own process, its environment set, and
// `omx-panel vocabulary` reads each source from where the lookup puts it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VOCABULARY = join(ROOT, 'dist/tools/vocabulary.mjs');
const NO_PKG_CONFIG = '/nonexistent/pkg-config';

/** The environment of a case: none of the lookup's variables but those given. */
function envOf(set) {
  const env = { ...process.env };
  for (const k of ['OMX_CONTRACT_PATH', 'OMX_CONTRACT_SCHEMA', 'PLUGIN_HOSTD_TABLES', 'OMX_PARAM_CONTRACT_H', 'PKG_CONFIG']) delete env[k];
  return { ...env, ...set };
}

/** The value of `expr` over the module's exports `v`, evaluated in a process with `set` as its lookup environment. */
function lookup(expr, set) {
  const code = `const v = await import(${JSON.stringify(VOCABULARY)}); process.stdout.write(JSON.stringify(${expr}));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: envOf(set) });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

const command = (args, set) => spawnSync(process.execPath, [join(ROOT, 'dist/bin/omx-panel.mjs'), 'vocabulary', ...args], { encoding: 'utf8', env: envOf(set) });

/** A contract directory holding `pkgs`: { <package>: { <relative file>: <json> } }. */
function contractDir(pkgs) {
  const dir = mkdtempSync(join(tmpdir(), 'omx-panel-contract-'));
  for (const [pkg, files] of Object.entries(pkgs)) {
    for (const [rel, body] of Object.entries(files)) {
      const file = join(dir, '3', pkg, rel);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(body));
    }
  }
  return dir;
}

const LV2 = { PLUGIN_HOSTD_LV2_MAP: { kind: 'formatMap', rows: { unit: { word: { word: 'controls[].travel.unit', transform: 'lookup', values: { 'units:db': 'dB', 'units:hz': 'Hz' } } } } } };
const DESCRIPTOR = { controls: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };

test('no $OMX_CONTRACT_PATH and no pkg-config: the directory omx-contract-data installs', () => {
  assert.deepEqual(lookup('v.contractDirs()', { PKG_CONFIG: NO_PKG_CONFIG }), ['/usr/share/omx-contract/contract.d']);
  assert.equal(lookup('v.contractDataDir()', { PKG_CONFIG: NO_PKG_CONFIG }), '/usr/share/omx-contract');
  assert.equal(lookup('v.contractSchemaFile()', { PKG_CONFIG: NO_PKG_CONFIG }), '/usr/share/omx-contract/omx-contract.schema.json');
  assert.equal(lookup('v.lv2TableFile()', { PKG_CONFIG: NO_PKG_CONFIG }), '/usr/share/omx-contract/contract.d/3/plugin-hostd/formats/lv2.json');
});

test('pkg-config, where omx-contract.pc is installed, names the directories', () => {
  const bin = mkdtempSync(join(tmpdir(), 'omx-panel-pc-'));
  const fake = join(bin, 'pkg-config');
  writeFileSync(fake, '#!/bin/sh\ncase "$1 $2" in\n  "--variable=contractdir omx-contract") echo /pc/contract.d ;;\n  "--variable=datadir omx-contract") echo /pc/data ;;\n  *) exit 1 ;;\nesac\n');
  chmodSync(fake, 0o755);
  assert.deepEqual(lookup('v.contractDirs()', { PKG_CONFIG: fake }), ['/pc/contract.d']);
  assert.equal(lookup('v.contractDataDir()', { PKG_CONFIG: fake }), '/pc/data');
  assert.deepEqual(lookup('v.contractDirs()', { PKG_CONFIG: fake, OMX_CONTRACT_PATH: '/env/a:/env/b' }), ['/env/a', '/env/b'], '$OMX_CONTRACT_PATH comes before pkg-config');
});

test('$OMX_CONTRACT_PATH: the first directory that holds a package is the one read', () => {
  const a = contractDir({ 'omx-plugins': { 'plugins/omx-delay.json': DESCRIPTOR } });
  const b = contractDir({ 'plugin-hostd': { 'formats/lv2.json': LV2 }, 'omx-plugins': { 'plugins/omx-delay.json': DESCRIPTOR, 'plugins/omx-comp.json': DESCRIPTOR } });
  const set = { OMX_CONTRACT_PATH: `${a}:${b}`, PKG_CONFIG: NO_PKG_CONFIG };
  assert.equal(lookup('v.lv2TableFile()', set), join(b, '3/plugin-hostd/formats/lv2.json'));
  assert.equal(lookup(`v.installedDescriptorFile('omx-plugins/omx-delay')`, set), join(a, '3/omx-plugins/plugins/omx-delay.json'));
  assert.equal(lookup(`v.installedDescriptorFile('omx-plugins/omx-comp')`, set), join(b, '3/omx-plugins/plugins/omx-comp.json'));
  assert.deepEqual(lookup('v.lv2UnitTable()', set), { dB: 'units:db', Hz: 'units:hz' });
});

test('omx-panel vocabulary reads each source where the lookup puts it, and fails on one that is missing', () => {
  const dir = contractDir({ 'plugin-hostd': { 'formats/lv2.json': LV2 }, 'omx-plugins': { 'plugins/omx-delay.json': DESCRIPTOR } });
  const schema = join(dir, 'omx-contract.schema.json');
  writeFileSync(schema, JSON.stringify({ $defs: { meaning: { enum: ['gain', 'delay', 'unknown'] } } }));
  const header = join(dir, 'omx_param_contract.h');
  writeFileSync(header, 'enum omx_clap_param_unit {\n  OMX_CLAP_UNIT_NONE = 0, OMX_CLAP_UNIT_DB = 13,\n  OMX_CLAP_UNIT_DBU = 0x101,\n};\n');
  const set = { OMX_CONTRACT_PATH: dir, OMX_CONTRACT_SCHEMA: schema, OMX_PARAM_CONTRACT_H: header, PKG_CONFIG: NO_PKG_CONFIG };
  const r = command(['omx-plugins/omx-delay'], set);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(`^ok   contractdir ${dir}$`, 'm'));
  assert.match(r.stdout, /^ok   meanings 2 from /m);
  assert.match(r.stdout, new RegExp(`^ok   lv2-units 2 from ${join(dir, '3/plugin-hostd/formats/lv2.json')}$`, 'm'));
  assert.match(r.stdout, /^ok   param-contract 3 units from /m);
  assert.match(r.stdout, new RegExp(`^ok   descriptor omx-plugins/omx-delay 3 controls from ${join(dir, '3/omx-plugins/plugins/omx-delay.json')}$`, 'm'));
  const missing = command(['omx-plugins/omx-nothing'], set);
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /^FAIL descriptor omx-plugins\/omx-nothing vocabulary: no descriptor omx-plugins\/omx-nothing is installed/m);
});

test('an install with omx-contract-data and no omx-contract.pc reads its schema from the default directory', { skip: !existsSync('/usr/share/omx-contract/omx-contract.schema.json') && 'omx-contract-data is not installed' }, () => {
  const r = command([], { PKG_CONFIG: NO_PKG_CONFIG });
  assert.match(r.stdout, /^ok   contractdir \/usr\/share\/omx-contract\/contract\.d$/m);
  assert.match(r.stdout, /^ok   meanings \d+ from \/usr\/share\/omx-contract\/omx-contract\.schema\.json$/m);
});
