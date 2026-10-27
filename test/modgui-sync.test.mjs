// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// omx-modgui-sync over a real lilv world: a tiny LV2 bundle, a scanned descriptor in DESCRIPTOR_DIRS, the installed
// omx-panel. A plugin gets a bundle (its brand the plugin name when the descriptor states no vendor), a second run finds
// it fresh, a plugin with nothing to draw is counted and fails nothing, a bundle that is not ours is left alone, and one
// of ours goes with its plugin.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SYNC = join(ROOT, 'bin/omx-modgui-sync');
const lilv = spawnSync('python3', ['-I', '-c', 'import lilv']).status === 0;
const skip = !lilv && 'python3-lilv is not installed';

const bundle = (lv2, dir, uri, name) => {
  mkdirSync(join(lv2, `${dir}.lv2`), { recursive: true });
  writeFileSync(join(lv2, `${dir}.lv2`, 'manifest.ttl'), `@prefix lv2: <http://lv2plug.in/ns/lv2core#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
<${uri}> a lv2:Plugin ; lv2:binary <${dir}.so> ; rdfs:seeAlso <${dir}.ttl> .
`);
  writeFileSync(join(lv2, `${dir}.lv2`, `${dir}.ttl`), `@prefix lv2: <http://lv2plug.in/ns/lv2core#> .
@prefix doap: <http://usefulinc.com/ns/doap#> .
<${uri}> a lv2:Plugin ; doap:name "${name}" ;
  lv2:port [ a lv2:InputPort , lv2:ControlPort ; lv2:index 0 ; lv2:symbol "gain" ; lv2:name "Gain" ;
             lv2:default 0.0 ; lv2:minimum -40.0 ; lv2:maximum 20.0 ] .
`);
};

/** A descriptor file for `uri` from a fixture, its vendor removed: a plugin that states none. */
const descriptor = (desc, file, uri, fixture, mutate = () => {}) => {
  const d = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/descriptors', fixture), 'utf8'));
  d.plugin.id = uri;
  d.plugin.uri = uri;
  delete d.plugin.vendor;
  mutate(d);
  writeFileSync(join(desc, file), JSON.stringify(d));
};

function rig() {
  const dir = mkdtempSync(join(tmpdir(), 'omx-modgui-sync-'));
  const r = { dir, lv2: join(dir, 'lv2'), out: join(dir, 'modgui'), state: join(dir, 'state'), desc: join(dir, 'desc'), bin: join(dir, 'bin') };
  for (const d of [r.lv2, r.out, r.desc, r.bin]) mkdirSync(d, { recursive: true });
  symlinkSync(join(ROOT, 'dist/bin/omx-panel.mjs'), join(r.bin, 'omx-panel'));
  r.run = (args = ['--no-scan'], lv2path = `${r.lv2}:${r.out}`) =>
    spawnSync(SYNC, args, {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${r.bin}:${process.env.PATH}`, LV2_PATH: lv2path, MODGUI_DIR: r.out, STATE_DIR: r.state, DESCRIPTOR_DIRS: r.desc },
    });
  r.bundles = () => readdirSync(r.out).filter((n) => n.endsWith('.lv2'));
  return r;
}

test('a plugin that ships no MOD GUI gets a bundle, its brand the plugin name when the descriptor states no vendor', { skip }, () => {
  const r = rig();
  bundle(r.lv2, 'testgain', 'urn:test:gain', 'Test Gain');
  descriptor(r.desc, 'testgain.json', 'urn:test:gain', 'scanned-lv2-compressor.json', (d) => {
    d.controls = d.controls.filter((c) => c.id === 'makeup');
    d.plugin.name = 'Test Gain';
  });
  const first = r.run();
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.match(first.stdout, /^omx-modgui-sync: wrote .*testgain\.lv2 for urn:test:gain$/m);
  assert.match(first.stdout, /1 written, 0 up to date/);
  const [name] = r.bundles();
  assert.equal(r.bundles().length, 1);
  for (const f of ['modgui.ttl', 'manifest.ttl', '.omx-modgui-sync']) assert.ok(existsSync(join(r.out, name, f)), f);
  assert.match(readFileSync(join(r.out, name, 'manifest.ttl'), 'utf8'), /modgui:brand "Test Gain"/);
  assert.equal(readFileSync(join(r.out, name, '.omx-modgui-sync'), 'utf8').split('\n')[0], 'urn:test:gain');
  const again = r.run();
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /0 written, 1 up to date/);
});

test('a plugin with nothing to draw is counted and fails nothing: exit 0, no bundle', { skip }, () => {
  const r = rig();
  bundle(r.lv2, 'testsynth', 'urn:test:synth', 'Test Synth');
  descriptor(r.desc, 'testsynth.json', 'urn:test:synth', 'scanned-lv2-hidden-only.json');
  const run = r.run();
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /0 written, 0 up to date, 0 ship their own, 0 without a descriptor, 0 without controls, 1 with nothing to draw, 0 removed, 0 could not be drawn/);
  assert.deepEqual(r.bundles(), []);
});

test('a refusal other than nothing-to-draw is named in the summary and still exits 0', { skip }, () => {
  const r = rig();
  bundle(r.lv2, 'testtrig', 'urn:test:trig', 'Test Trigger');
  descriptor(r.desc, 'testtrig.json', 'urn:test:trig', 'scanned-lv2-compressor.json', (d) => {
    d.controls = [{ id: 'cv_trigger', name: 'Trigger', kind: 'trigger', meaning: 'unknown' }];
  });
  const run = r.run();
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /no MOD GUI for urn:test:trig: Error: modgui-gen: 'cv_trigger' is not a declared control input with a travel/);
  assert.match(run.stdout, /1 could not be drawn/);
});

test('a bundle without our marker is left alone, and one of ours goes with its plugin', { skip }, () => {
  const r = rig();
  bundle(r.lv2, 'testgain', 'urn:test:gain', 'Test Gain');
  descriptor(r.desc, 'testgain.json', 'urn:test:gain', 'scanned-lv2-compressor.json', (d) => {
    d.controls = d.controls.filter((c) => c.id === 'makeup');
  });
  mkdirSync(join(r.out, 'testgain.lv2'));
  writeFileSync(join(r.out, 'testgain.lv2', 'theirs.txt'), 'not ours');
  const blocked = r.run();
  assert.match(blocked.stdout, /skip urn:test:gain: .*testgain\.lv2 is not ours/);
  assert.deepEqual(readdirSync(join(r.out, 'testgain.lv2')), ['theirs.txt']);
  rmSync(join(r.out, 'testgain.lv2'), { recursive: true });
  assert.equal(r.run().status, 0);
  assert.equal(r.bundles().length, 1);
  rmSync(join(r.lv2, 'testgain.lv2'), { recursive: true });
  const gone = r.run();
  assert.match(gone.stdout, /removed .*: urn:test:gain ships its own MOD GUI now or is gone/);
  assert.deepEqual(r.bundles(), []);
});

test('a bundle directory off LV2_PATH is noted, not refused', { skip }, () => {
  const r = rig();
  const run = r.run(['--no-scan'], r.lv2);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /note: .*modgui is not on LV2_PATH; MOD-UI shows these GUIs once it is/);
});

test('--dry-run writes nothing', { skip }, () => {
  const r = rig();
  bundle(r.lv2, 'testgain', 'urn:test:gain', 'Test Gain');
  descriptor(r.desc, 'testgain.json', 'urn:test:gain', 'scanned-lv2-compressor.json', (d) => {
    d.controls = d.controls.filter((c) => c.id === 'makeup');
  });
  const run = r.run(['--dry-run', '--no-scan']);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /would write .*testgain\.lv2 for urn:test:gain/);
  assert.deepEqual(r.bundles(), []);
});
