// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// One schema, said twice: schema/skin-package.schema.json (what `omx-panel validate` checks) and parseSkinOverride
// (src/skin-package.ts, what a reader applies) give one verdict on the example and on each broken copy of it. The
// differences are listed, each with its reason, and held: a new one is red until it is listed. The JSON schema's
// family list, display kinds and sources are tools/panel-description.mjs's.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateSkin, loadSchema } from '../dist/lib/validate.mjs';
import { parseSkinOverride, PANEL_FAMILIES, PANEL_DISPLAY_KINDS, PANEL_DISPLAY_SOURCES } from '../dist/src/skin-package.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ID = 'org.example.plate';
const example = () => JSON.parse(readFileSync(join(ROOT, 'examples/skins/org.example.plate/skin.json'), 'utf8'));

const CASES = [
  ['the example', () => {}],
  ['no licence', (d) => { delete d.licence; }],
  ['a blank licence', (d) => { d.licence = ' '; }],
  ['an SPDX expression as the licence', (d) => { d.licence = 'GPL-3.0-or-later AND CC-BY-4.0'; }],
  ['no schema version', (d) => { delete d.schema; }],
  ['schema 2', (d) => { d.schema = 2; }],
  ['schema "1" as text', (d) => { d.schema = '1'; }],
  ['an empty plugin id', (d) => { d.plugin = ''; }],
  ['a source of an unknown kind', (d) => { d.source.kind = 'stolen'; }],
  ['a MOD GUI source inside modgui/', (d) => { d.source = { kind: 'modgui', bundle: '/b.lv2', licenceEvidence: 'x', modgui: { html: 'modgui/i.html', css: 'modgui/s.css' } }; }],
  ['a MOD GUI source whose template leaves modgui/', (d) => { d.source = { kind: 'modgui', modgui: { html: '../i.html', css: 'modgui/s.css' } }; }],
  ['a family the panel has no place for', (d) => { d.family = 'vocoder'; }],
  ['a house view of none', (d) => { d.houseView = 'none'; }],
  ['a role naming a number', (d) => { d.roles.decay = 7; }],
  ['a section key that is not a key', (d) => { d.sections[0].key = 'Main Section'; }],
  ['a section label key that is not a key', (d) => { d.sections[0].labelKey = 'Main'; }],
  ['a section with no controls', (d) => { delete d.sections[0].controls; }],
  ['a label key that is not a key', (d) => { d.labels.decay = { labelKey: 'Decay' }; }],
  ['a visibility value past 63', (d) => { d.visibleWhen.damping.values = [64]; }],
  ['a visibility value that is not an integer', (d) => { d.visibleWhen.damping.values = [1.5]; }],
  ['a display of a known kind', (d) => { d.displays = [{ kind: 'meter', section: 'main', source: 'meters' }]; }],
  ['a display of an unknown kind', (d) => { d.displays = [{ kind: 'vu_needle', section: 'main', source: 'meters' }]; }],
  ['a display with no section', (d) => { d.displays = [{ kind: 'meter', source: 'meters' }]; }],
  ['a backdrop that leaves the package', (d) => { d.backdrop = 'art/../../etc/passwd'; }],
  ['a backdrop with a backslash', (d) => { d.backdrop = 'art\\plate.png'; }],
  ['a backdrop outside art/', (d) => { d.backdrop = '/etc/passwd'; }],
  ['a view under view/', (d) => { d.view = { entry: 'view/index.mjs', api: '1.1' }; }],
  ['a view entry outside view/', (d) => { d.view = { entry: 'art/plate.js', api: '1.1' }; }],
  ['a MOD GUI opt-in', (d) => { d.modgui = { entry: 'modgui/icon.html' }; }],
  ['a MOD GUI opt-in beside a view', (d) => { d.view = { entry: 'view/index.mjs', api: '1.1' }; d.modgui = { entry: 'modgui/icon.html' }; }],
  ['a MOD GUI opt-in outside modgui/', (d) => { d.modgui = { entry: 'view/icon.html' }; }],
  ['a field the format does not have', (d) => { d.verdict = 'good'; }],
  ['a view API version that is not MAJOR.MINOR', (d) => { d.view = { entry: 'view/index.mjs', api: '1' }; }],
  ['two sections with one key', (d) => { d.sections.push({ key: 'main', controls: [] }); }],
];

/** Where the two differ, and why: [case, the validator's verdict, the reader's]. */
const DIFFER = new Map([
  ['a field the format does not have', [false, true, 'the validator refuses a field the format does not have, so an author learns of a typo; a reader ignores it']],
  ['a view API version that is not MAJOR.MINOR', [false, true, 'the validator holds the version to MAJOR.MINOR; a reader refuses it at resolve time by the version rule (SKIN_API_MISMATCH)']],
  ['two sections with one key', [true, false, 'JSON Schema cannot say that a key is unique across the array; the reader refuses it']],
]);

for (const [name, breakIt] of CASES) {
  test(`one verdict: ${name}`, () => {
    const doc = example();
    breakIt(doc);
    const schema = validateSkin(doc).ok;
    const reader = parseSkinOverride(JSON.stringify(doc), ID).ok;
    const known = DIFFER.get(name);
    if (known) assert.deepEqual([schema, reader], known.slice(0, 2), known[2]);
    else assert.equal(schema, reader, `the validator says ${schema}, the reader ${reader}`);
  });
}

test('the example passes both, and every listed difference is a case above', () => {
  assert.equal(validateSkin(example()).ok, true);
  assert.equal(parseSkinOverride(JSON.stringify(example()), ID).ok, true);
  for (const name of DIFFER.keys()) assert.ok(CASES.some(([n]) => n === name), name);
});

test('the JSON schema lists the panel families, display kinds and sources the layout declares', () => {
  const s = loadSchema();
  assert.deepEqual(s.$defs.family.enum, [...PANEL_FAMILIES]);
  assert.deepEqual(s.properties.displays.items.properties.kind.enum, [...PANEL_DISPLAY_KINDS]);
  assert.deepEqual(s.properties.displays.items.properties.source.enum, [...PANEL_DISPLAY_SOURCES]);
});
