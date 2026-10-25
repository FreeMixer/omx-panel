// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * tools/modgui-import.mjs (docs/skin-package.md, "Importing a MOD GUI"), built: over a
 * fixture modgui bundle of our own (test/fixtures/modgui, no MOD art), the package it writes parses under §6.3, its
 * labels and order equal the bundle's, its files are the bundle's byte for byte, and every refusal code of the
 * declaration is produced by a bundle that earns it, with nothing written. The CEO arm runs the spec's own proof
 * where caps-lv2 is installed. Moved from the console with its assertions unchanged; each `expect` there is an
 * `assert` here.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../dist/src/skin-package.js';
import { importModgui } from '../dist/tools/modgui-import.mjs';
import { parseTurtle } from '../dist/tools/turtle-read.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(PKG, 'test/fixtures/modgui/omx-fixture-echo.lv2');
const PLUGIN = 'urn:openmixer:fixture:echo';
const CEO = '/usr/lib64/lv2/mod-caps-CEO.lv2';
const TOOL = join(PKG, 'dist/tools/modgui-import.mjs');

const scratch = mkdtempSync(join(tmpdir(), 'omx-modgui-import-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const fresh = (name) => join(scratch, `${name}-${n++}`);

/** A copy of the fixture with one file rewritten, so each refusal is earned by one edit; an edit that does not land is red. */
function edited(file, edit) {
  const b = fresh('bundle');
  cpSync(FIXTURE, b, { recursive: true });
  if (edit) {
    const before = readFileSync(join(b, file), 'utf8');
    const after = edit(before);
    assert.notEqual(after, before, `the edit of ${file} landed`);
    writeFileSync(join(b, file), after);
  }
  return b;
}

/** Every file under `dir`, relative, sorted. */
function files(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => relative(dir, join(d.parentPath, d.name)))
    .sort();
}

/** The fixture's own ports, read from its modgui.ttl by the reader: the bundle's facts, not the test's. */
function bundlePorts() {
  const path = join(FIXTURE, 'modgui.ttl');
  const t = parseTurtle(readFileSync(path, 'utf8'), pathToFileURL(path).href);
  const of = (s, p) => t.find((x) => x.s.v === s && x.p.v === `${core.LV2_NS}${p}`).o.v;
  return t
    .filter((x) => x.p.v === `${core.MODGUI_NS}port`)
    .map((x) => ({ index: Number(of(x.o.v, 'index')), symbol: of(x.o.v, 'symbol'), name: of(x.o.v, 'name') }));
}

const produced = new Set();
function refused(bundle, code, opts = {}) {
  const out = opts.out ?? fresh('out');
  const before = existsSync(out) ? files(out) : [];
  assert.throws(() => importModgui({ bundle, out, plugin: opts.plugin }, core), (e) => e.code === code);
  // Nothing written: the out directory holds exactly what it held before, and no temporary.
  assert.deepEqual(existsSync(out) ? readdirSync(out).filter((f) => !before.some((b) => b.startsWith(f))) : [], []);
  produced.add(code);
}

describe('modgui-import: the fixture bundle becomes a §6 skin package', () => {
  const out = fresh('out');
  const r = importModgui({ bundle: FIXTURE, out }, core);
  const pkg = join(out, core.encodeSkinId(PLUGIN));
  const text = readFileSync(join(pkg, core.SKIN_OVERRIDE_FILE), 'utf8');
  const parsed = core.parseSkinOverride(text, PLUGIN);

  it('writes skin.json under the §6.1 name, and it parses under §6.3', () => {
    assert.equal(r.dir, pkg);
    assert.equal(pkg.endsWith('urn%3Aopenmixer%3Afixture%3Aecho'), true);
    assert.equal(parsed.ok, true);
  });

  it('its control order is the bundle lv2:index order, its labels the bundle lv2:name', () => {
    const ports = bundlePorts().sort((a, b) => a.index - b.index);
    assert.deepEqual(parsed.override.sections, [{ key: 'modgui', label: 'Echo', controls: ports.map((p) => p.symbol) }]);
    assert.deepEqual(parsed.override.sections[0].controls, ['time', 'feedback', 'tone', 'mix']);
    assert.deepEqual(parsed.override.labels, Object.fromEntries(ports.map((p) => [p.symbol, { label: p.name }])));
    assert.deepEqual(parsed.override.labels.feedback, { label: 'Repeats' });
  });

  it('records the licence it found and where it read it', () => {
    assert.equal(parsed.override.plugin, PLUGIN);
    assert.equal(parsed.override.licence, 'GPL-3.0-or-later');
    assert.deepEqual(parsed.override.source, {
      kind: 'modgui',
      bundle: FIXTURE,
      licenceEvidence: 'echo.ttl doap:license <http://spdx.org/licenses/GPL-3.0-or-later>',
    });
  });

  it('copies the modgui whole (template, stylesheet, knob sprite, images) and its TTL byte for byte; the screenshot is the backdrop', () => {
    const src = join(FIXTURE, 'modgui');
    assert.deepEqual(files(join(pkg, 'modgui')), [...files(src), 'modgui.ttl'].sort());
    for (const f of files(src)) assert.equal(readFileSync(join(pkg, 'modgui', f)).equals(readFileSync(join(src, f))), true, f);
    assert.equal(readFileSync(join(pkg, 'modgui/modgui.ttl'), 'utf8'), readFileSync(join(FIXTURE, 'modgui.ttl'), 'utf8'));
    assert.equal(parsed.override.backdrop, 'art/screenshot-echo.png');
    assert.equal(readFileSync(join(pkg, parsed.override.backdrop)).equals(readFileSync(join(src, 'screenshot-echo.png'))), true);
    for (const f of ['skin.json', 'art/screenshot-echo.png']) assert.ok(files(pkg).includes(f), f);
  });

  it('writes no view, family or roles', () => {
    assert.deepEqual(Object.keys(parsed.override).sort(), ['backdrop', 'labels', 'licence', 'plugin', 'schema', 'sections', 'source']);
    assert.equal(existsSync(join(pkg, 'view')), false);
    assert.equal(r.brand, 'openmixer');
  });
});

describe('modgui-import: refusals name the code and the file, and write nothing', () => {
  it('MODGUI_NO_LICENCE: no doap:license on the plugin or its project', () => {
    refused(edited('echo.ttl', (t) => t.replace(/^\s*doap:license .*$/m, '')), 'MODGUI_NO_LICENCE');
  });

  it('MODGUI_LICENCE_REFUSED: GPL-2.0-only is outside the allow-list, and the refusal names it and the file', () => {
    assert.equal(core.SKIN_LICENCE_ALLOW_LIST.includes('GPL-2.0-only'), false);
    const b = edited('echo.ttl', (t) => t.replace('licenses/GPL-3.0-or-later>', 'licenses/GPL-2.0-only>'));
    assert.throws(() => importModgui({ bundle: b, out: fresh('out') }, core), (e) =>
      e.code === 'MODGUI_LICENCE_REFUSED' && e.file === join(b, 'echo.ttl') && e.detail.includes('GPL-2.0-only'));
    refused(b, 'MODGUI_LICENCE_REFUSED');
  });

  it('MODGUI_LICENCE_UNMAPPED: a licence IRI the map does not read', () => {
    refused(edited('echo.ttl', (t) => t.replace('http://spdx.org/licenses/GPL-3.0-or-later', 'http://example.org/our-terms')), 'MODGUI_LICENCE_UNMAPPED');
  });

  it('MODGUI_UNKNOWN_PROPERTY: a modgui property the declaration does not list, on the gui or on a port', () => {
    refused(edited('modgui.ttl', (t) => t.replace('modgui:brand', 'modgui:notAProperty <modgui/icon-echo.html> ;\n        modgui:brand')), 'MODGUI_UNKNOWN_PROPERTY');
    refused(edited('modgui.ttl', (t) => t.replace('lv2:name "Blend" ;', 'lv2:name "Blend" ;\n            lv2:default 0.5 ;')), 'MODGUI_UNKNOWN_PROPERTY');
  });

  it("accepts mod-ui's full gui property list: javascript, documentation, discussionURL, settingsTemplate, monitoredOutputs do not refuse a real bundle", () => {
    const b = edited('modgui.ttl', (t) =>
      t.replace(
        'modgui:brand "openmixer" ;',
        [
          'modgui:javascript <modgui/icon-echo.html> ;',
          'modgui:documentation <modgui/icon-echo.html> ;',
          'modgui:discussionURL "https://forum.moddevices.com/" ;',
          'modgui:settingsTemplate <modgui/icon-echo.html> ;',
          'modgui:monitoredOutputs "mix" ;',
          'modgui:brand "openmixer" ;',
        ].join('\n        '),
      ),
    );
    const out = fresh('out');
    assert.doesNotThrow(() => importModgui({ bundle: b, out }, core));
    assert.equal(existsSync(join(out, core.encodeSkinId(PLUGIN), 'skin.json')), true);
  });

  it("MODGUI_PORT_UNKNOWN: a modgui:port symbol none of the plugin's own lv2:port carries, named with its file", () => {
    const b = edited('modgui.ttl', (t) => t.replace('lv2:symbol "tone" ;', 'lv2:symbol "colour" ;'));
    assert.throws(() => importModgui({ bundle: b, out: fresh('out') }, core), (e) =>
      e.code === 'MODGUI_PORT_UNKNOWN' && e.file === join(b, 'modgui.ttl') && e.detail.includes('"colour"'));
    refused(b, 'MODGUI_PORT_UNKNOWN');
  });

  it('MODGUI_IMAGE_NOT_FOUND: an icon template image the resources directory does not hold, named with the template', () => {
    const img = (src) => (t) => t.replace('<div class="mod-control-group">', `<img src="${src}">\n  <div class="mod-control-group">`);
    const b = edited('modgui/icon-echo.html', img('/resources/knobs/missing.png{{{cns}}}'));
    assert.throws(() => importModgui({ bundle: b, out: fresh('out') }, core), (e) =>
      e.code === 'MODGUI_IMAGE_NOT_FOUND' && e.file === join(b, 'modgui/icon-echo.html') && e.detail.includes('knobs/missing.png'));
    refused(b, 'MODGUI_IMAGE_NOT_FOUND');
    refused(edited('modgui/icon-echo.html', (t) => t.replace('class="mod-knob-image"', 'class="mod-knob-image" style="background-image: url(/resources/gone.png)"')), 'MODGUI_IMAGE_NOT_FOUND');
    // An image the template names that the bundle holds, its Mustache suffix dropped, imports.
    assert.doesNotThrow(() => importModgui({ bundle: edited('modgui/icon-echo.html', img('/resources/knobs/knob-sprite.png{{{ns}}}')), out: fresh('out') }, core));
    // One that climbs out of the resources directory escapes what the package carries.
    refused(edited('modgui/icon-echo.html', img('/resources/../echo.ttl')), 'MODGUI_PATH_ESCAPE');
  });

  it("the stylesheet's images are not checked: a shared pedal theme names files the bundle does not carry, on purpose", () => {
    const b = edited('modgui/stylesheet-echo.css', (t) => `${t}.omx-fixture-echo.six-knobs { background-image: url(/resources/pedals/boxy/six-knobs-red.png{{{cns}}}); }\n`);
    assert.doesNotThrow(() => importModgui({ bundle: b, out: fresh('out') }, core));
  });

  it('copies each file-valued property with the package, inside the resources directory or not; a web documentation is kept as text', () => {
    const b = edited('modgui.ttl', (t) =>
      t.replace('modgui:brand "openmixer" ;', 'modgui:javascript <echo-gui.js> ;\n        modgui:documentation <https://example.org/echo> ;\n        modgui:brand "openmixer" ;'));
    writeFileSync(join(b, 'echo-gui.js'), 'function (event) {}\n');
    const out = fresh('out');
    const r = importModgui({ bundle: b, out }, core);
    assert.equal(readFileSync(join(r.dir, 'modgui', 'echo-gui.js'), 'utf8'), 'function (event) {}\n');
    assert.deepEqual(files(r.dir).filter((f) => f.includes('example.org')), []);
  });

  it('MODGUI_PATH_ESCAPE: a file-valued property outside the bundle, javascript and settingsTemplate as much as the screenshot', () => {
    refused(edited('modgui.ttl', (t) => t.replace('modgui:brand "openmixer" ;', 'modgui:javascript <file:///etc/hostname> ;\n        modgui:brand "openmixer" ;')), 'MODGUI_PATH_ESCAPE');
    refused(edited('modgui.ttl', (t) => t.replace('modgui:brand "openmixer" ;', 'modgui:settingsTemplate <https://example.org/settings.html> ;\n        modgui:brand "openmixer" ;')), 'MODGUI_PATH_ESCAPE');
  });

  it('MODGUI_IMAGE_NOT_FOUND: the settings template is checked as the icon template is', () => {
    const b = edited('modgui.ttl', (t) => t.replace('modgui:brand "openmixer" ;', 'modgui:settingsTemplate <modgui/settings-echo.html> ;\n        modgui:brand "openmixer" ;'));
    writeFileSync(join(b, 'modgui', 'settings-echo.html'), '<div class="mod-settings"><img src="/resources/settings-missing.png{{{ns}}}"></div>\n');
    assert.throws(() => importModgui({ bundle: b, out: fresh('out') }, core), (e) =>
      e.code === 'MODGUI_IMAGE_NOT_FOUND' && e.file === join(b, 'modgui', 'settings-echo.html'));
    refused(b, 'MODGUI_IMAGE_NOT_FOUND');
  });

  it('MODGUI_PATH_ESCAPE: a resource that resolves outside the bundle', () => {
    refused(edited('modgui.ttl', (t) => t.replace('<modgui/thumbnail-echo.png>', '<file:///etc/hostname>')), 'MODGUI_PATH_ESCAPE');
    const b = edited('modgui.ttl');
    symlinkSync(tmpdir(), join(b, 'modgui', 'escape'));
    refused(b, 'MODGUI_PATH_ESCAPE');
    refused(edited('modgui.ttl', (t) => t.replace('<modgui/screenshot-echo.png>', '<../../screenshot.png>')), 'MODGUI_NOT_FOUND');
  });

  it('MODGUI_TTL_INVALID: a TTL that does not parse', () => {
    refused(edited('modgui.ttl', (t) => t.replace('modgui:brand "openmixer" ;', 'modgui:brand "openmixer ;')), 'MODGUI_TTL_INVALID');
  });

  it('MODGUI_NOT_FOUND: a bundle without a modgui', () => {
    const b = edited('manifest.ttl');
    rmSync(join(b, 'modgui.ttl'));
    refused(b, 'MODGUI_NOT_FOUND');
  });

  it('MODGUI_TARGET_EXISTS: an existing package is never overwritten', () => {
    const out = fresh('out');
    importModgui({ bundle: FIXTURE, out }, core);
    const skin = join(out, core.encodeSkinId(PLUGIN), 'skin.json');
    writeFileSync(skin, 'the operator edited this');
    refused(FIXTURE, 'MODGUI_TARGET_EXISTS', { out });
    assert.equal(readFileSync(skin, 'utf8'), 'the operator edited this');
  });

  it('the CLI prints the refusal as one JSON line and exits 3', () => {
    const b = edited('echo.ttl', (t) => t.replace('licenses/GPL-3.0-or-later>', 'licenses/GPL-2.0-only>'));
    const out = fresh('out');
    const run = spawnSync('node', [TOOL, b, '--out', out], { encoding: 'utf8' });
    assert.equal(run.status, 3);
    const line = run.stdout.split('\n').find((l) => l.startsWith('MODGUI-IMPORT-JSON '));
    const got = JSON.parse(line.slice('MODGUI-IMPORT-JSON '.length));
    assert.deepEqual({ verdict: got.verdict, code: got.code, file: got.file }, { verdict: 'refused', code: 'MODGUI_LICENCE_REFUSED', file: join(b, 'echo.ttl') });
    assert.equal(existsSync(out), false);
  });

  it('every refusal code the declaration lists is produced above', () => {
    assert.deepEqual([...produced].sort(), [...core.MODGUI_IMPORT_REFUSALS].sort());
  });
});

describe('modgui-import: the proof on the installed caps CEO', { skip: !existsSync(CEO) && `${CEO} is not installed` }, () => {
  it('labels Profit, Level, Damping on ppm, volume, damping, and the licence recorded', () => {
    const r = importModgui({ bundle: CEO, out: fresh('out') }, core);
    assert.deepEqual(r.skin.sections[0].controls, ['ppm', 'volume', 'damping']);
    assert.deepEqual(r.skin.labels, { ppm: { label: 'Profit' }, volume: { label: 'Level' }, damping: { label: 'Damping' } });
    assert.equal(r.skin.licence, 'GPL-2.0-or-later');
    assert.equal(r.skin.source.licenceEvidence, 'CEO.ttl doap:license <http://usefulinc.com/doap/licenses/gpl>');
  });
});
