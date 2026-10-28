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
  r.run = (args = ['--no-scan'], lv2path = `${r.lv2}:${r.out}`, extra = {}) => {
    const env = { ...process.env, PATH: `${r.bin}:${process.env.PATH}`, LV2_PATH: lv2path, MODGUI_DIR: r.out, STATE_DIR: r.state, DESCRIPTOR_DIRS: r.desc, ...extra };
    if (lv2path === null) delete env.LV2_PATH; // null: the variable is not set
    return spawnSync(SYNC, args, { encoding: 'utf8', env });
  };
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
    d.controls = [{ id: 'note', name: 'Note', kind: 'text', meaning: 'unknown' }];
  });
  const run = r.run();
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /no MOD GUI for urn:test:trig: Error: modgui-gen: 'note' is not a declared control input with a travel/);
  assert.match(run.stdout, /1 could not be drawn/);
});

test('a trigger control beside a normal one is left off the face and named in the summary line', { skip }, () => {
  const r = rig();
  bundle(r.lv2, 'testzlfo', 'urn:test:zlfo', 'Test ZLFO');
  descriptor(r.desc, 'testzlfo.json', 'urn:test:zlfo', 'scanned-lv2-compressor.json', (d) => {
    d.controls = [...d.controls.filter((c) => c.id === 'makeup'), { id: 'cv_trigger', name: 'Trigger', kind: 'trigger', meaning: 'unknown' }];
  });
  const run = r.run();
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /1 written/);
  assert.match(run.stdout, /0 could not be drawn, and left trigger controls off the face \(.*: cv_trigger\)/);
  assert.doesNotMatch(readFileSync(join(r.out, r.bundles()[0], 'manifest.ttl'), 'utf8'), /cv_trigger/);
});

test('a plugin whose only control is a trigger has nothing to draw', { skip }, () => {
  const r = rig();
  bundle(r.lv2, 'testtrig2', 'urn:test:trig2', 'Test Trigger Only');
  descriptor(r.desc, 'testtrig2.json', 'urn:test:trig2', 'scanned-lv2-compressor.json', (d) => {
    d.controls = [{ id: 'cv_trigger', name: 'Trigger', kind: 'trigger', meaning: 'unknown' }];
  });
  const run = r.run();
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /1 with nothing to draw/);
  assert.deepEqual(r.bundles(), []);
});

test('a bundle without our marker is left alone, and one of ours goes with its plugin', { skip }, () => {
  const r = rig();
  bundle(r.lv2, 'testgain', 'urn:test:gain', 'Test Gain');
  descriptor(r.desc, 'testgain.json', 'urn:test:gain', 'scanned-lv2-compressor.json', (d) => {
    d.controls = d.controls.filter((c) => c.id === 'makeup');
  });
  mkdirSync(join(r.out, 'omx-modgui-testgain.lv2'));
  writeFileSync(join(r.out, 'omx-modgui-testgain.lv2', 'theirs.txt'), 'not ours');
  const blocked = r.run();
  assert.match(blocked.stdout, /skip urn:test:gain: .*omx-modgui-testgain\.lv2 is not ours/);
  assert.deepEqual(readdirSync(join(r.out, 'omx-modgui-testgain.lv2')), ['theirs.txt']);
  rmSync(join(r.out, 'omx-modgui-testgain.lv2'), { recursive: true });
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

test('the bundles may share a folder with plugins: a plugin there still gets a GUI, under a name of its own', { skip }, () => {
  const r = rig();
  bundle(r.out, 'testgain', 'urn:test:gain', 'Test Gain'); // a hand-installed plugin in the folder the GUIs go to
  descriptor(r.desc, 'testgain.json', 'urn:test:gain', 'scanned-lv2-compressor.json', (d) => {
    d.controls = d.controls.filter((c) => c.id === 'makeup');
  });
  const run = r.run(['--no-scan'], r.out);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /wrote .*omx-modgui-testgain\.lv2 for urn:test:gain/);
  assert.deepEqual(readdirSync(join(r.out, 'testgain.lv2')).sort(), ['manifest.ttl', 'testgain.so'.replace('.so', '.ttl')].sort());
  const again = r.run(['--no-scan'], r.out);
  assert.match(again.stdout, /0 written, 1 up to date/, 'our own bundle is not mistaken for the plugin shipping a GUI');
  assert.equal(r.bundles().filter((n) => n.startsWith('omx-modgui-')).length, 1);
});

test('--check without LV2_PATH reads the search list plugin-hostd and plugin-qualify read, and says where the GUIs go', () => {
  const r = rig();
  const run = r.run(['--check'], null);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^LV2 search list \(from plugin-hostd's default\):$/m);
  assert.match(run.stdout, /^ {2}\/usr\/lib64\/lv2\n {2}\/usr\/lib\/lv2\n {2}\/usr\/local\/lib\/lv2$/m);
  assert.match(run.stdout, /modgui: it is NOT on that list/);
});

test('--check lists the CLAP search list, CLAP_PATH first, then the specification\'s', () => {
  const r = rig();
  const run = r.run(['--check'], '/x', { CLAP_PATH: '/opt/clap-a:/opt/clap-b', HOME: '/home/nobody' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /CLAP search list .*:\n {2}\/opt\/clap-a\n {2}\/opt\/clap-b\n {2}\/home\/nobody\/\.clap\n {2}\/usr\/lib\/clap$/m);
});

test('--check reads the LV2_PATH the units of the programs that show the GUIs run with, and names the one that lacks the folder', () => {
  const r = rig();
  const fake = (theirs) => {
    writeFileSync(join(r.bin, 'systemctl'), `#!/bin/sh
case "$1" in
  cat) [ "$2" = mod-ui.service ] ;;
  show) echo "HOME=/root LV2_PATH=${theirs}" ;;
esac
`, { mode: 0o755 });
  };
  fake('/usr/lib/lv2');
  const missing = r.run(['--check'], r.lv2);
  assert.match(missing.stdout, /^mod-ui: reads LV2_PATH and .*modgui is NOT on it; it will not show these GUIs until it is$/m);
  assert.doesNotMatch(missing.stdout, /^mod-host:/m, 'a unit that does not exist is not reported');
  fake(`/usr/lib/lv2:${r.out}`);
  assert.match(r.run(['--check'], r.lv2).stdout, /^mod-ui: reads LV2_PATH and .*modgui is on it$/m);
});

test('the unit runs after plugin-qualify-sync once enabled, under limits, and there is no apt hook', () => {
  const unit = readFileSync(join(ROOT, 'systemd/omx-modgui-sync.service'), 'utf8');
  assert.match(unit, /^After=.*\bplugin-qualify-sync\.service\b/m, 'it waits for the sync that writes its descriptors');
  assert.doesNotMatch(unit, /^WantedBy=.*\bplugin-qualify-sync\.service\b/m, 'a Wants resolved at the sync\'s start loses the run when two scans overlap (#61)');
  assert.match(unit, /^WantedBy=multi-user\.target$/m);
  const dropin = readFileSync(join(ROOT, 'systemd/plugin-qualify-sync.service.d/omx-modgui-sync.conf'), 'utf8');
  const post = dropin.match(/^ExecStartPost=-.*$/m)?.[0];
  assert.ok(post, 'the drop-in queues the GUI sync after each scan, its failure ignored');
  assert.ok(post.indexOf('systemctl is-enabled -q omx-modgui-sync.service') >= 0 && post.indexOf('is-enabled') < post.indexOf('systemctl start --no-block omx-modgui-sync.service'), 'it asks is-enabled before it starts');
  assert.match(readFileSync(join(ROOT, 'Makefile'), 'utf8'), /plugin-qualify-sync\.service\.d\/omx-modgui-sync\.conf/, 'make install ships the drop-in');
  assert.match(readFileSync(join(ROOT, 'packaging/omx-panel.spec'), 'utf8'), /plugin-qualify-sync\.service\.d\/omx-modgui-sync\.conf/, 'the rpm lists it');
  for (const limit of ['CPUQuota=', 'MemoryMax=', 'TasksMax=', 'IOSchedulingClass=idle', 'RestrictRealtime=yes', 'Nice=19']) assert.ok(unit.includes(limit), limit);
  assert.doesNotMatch(unit, /^WantedBy=.*\bdefault\.target\b/m);
  assert.equal(existsSync(join(ROOT, 'etc/apt')), false, 'the Debian-only apt hook is gone: the sync follows the standard triggers');
  assert.doesNotMatch(readFileSync(join(ROOT, 'Makefile'), 'utf8'), /apt/);
});
