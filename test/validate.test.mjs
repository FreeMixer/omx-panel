// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The example skin validates; each broken copy of it is refused at the path the schema names; and each refusal has its
// sabotage: with that guard taken out of the schema the broken copy is accepted, so the test would go red.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSchema, makeValidator, validateSkin } from '../lib/validate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const example = () => JSON.parse(readFileSync(join(ROOT, 'examples/skins/org.example.plate/skin.json'), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

test('the example skin validates', () => {
  assert.deepEqual(validateSkin(example()), { ok: true, errors: [] });
});

// [name, break the example, the path and keyword that refuse it, weaken the schema so the guard is gone]
const BROKEN = [
  ['no licence', (d) => { delete d.licence; }, ['/', 'required'], (s) => { s.required = s.required.filter((k) => k !== 'licence'); }],
  ['no schema version', (d) => { delete d.schema; }, ['/', 'required'], (s) => { s.required = s.required.filter((k) => k !== 'schema'); }],
  ['a schema version other than 1', (d) => { d.schema = 2; }, ['/schema', 'const'], (s) => { delete s.properties.schema.const; }],
  ['the requires of the old format', (d) => { d.requires = { 'omx-panel-schema': '>= 1.0.0' }; }, ['/', 'additionalProperties'], (s) => { delete s.additionalProperties; }],
  ['an empty plugin id', (d) => { d.plugin = ''; }, ['/plugin', 'minLength'], (s) => { delete s.properties.plugin.minLength; }],
  ['a field the format does not have', (d) => { d.verdict = 'good'; }, ['/', 'additionalProperties'], (s) => { delete s.additionalProperties; }],
  ['a blank licence', (d) => { d.licence = '  '; }, ['/licence', 'pattern'], (s) => { delete s.properties.licence.pattern; }],
  ['a source of an unknown kind', (d) => { d.source.kind = 'stolen'; }, ['/source/kind', 'enum'], (s) => { delete s.properties.source.properties.kind.enum; }],
  ['a family the panel has no place for', (d) => { d.family = 'vocoder'; }, ['/family', 'enum'], (s) => { delete s.$defs.family.enum; }],
  ['a backdrop that leaves the package', (d) => { d.backdrop = 'art/../../etc/passwd'; }, ['/backdrop', 'pattern'], (s) => { delete s.properties.backdrop.pattern; }],
  ['a backdrop outside art/', (d) => { d.backdrop = '/etc/passwd'; }, ['/backdrop', 'pattern'], (s) => { delete s.properties.backdrop.pattern; }],
  ['a view entry outside view/', (d) => { d.view = { entry: 'art/plate.js', api: '1.1' }; }, ['/view/entry', 'pattern'], (s) => { delete s.properties.view.properties.entry.pattern; }],
  ['a skin API version that is not MAJOR.MINOR', (d) => { d.view = { entry: 'view/index.mjs', api: '1' }; }, ['/view/api', 'pattern'], (s) => { delete s.properties.view.properties.api.pattern; }],
  ['a MOD GUI entry beside a view', (d) => { d.view = { entry: 'view/index.mjs', api: '1.1' }; d.modgui = { entry: 'modgui/icon.html' }; }, ['/view', 'false schema'], (s) => { delete s.dependentSchemas; }],
  ['a MOD GUI source whose template leaves modgui/', (d) => { d.source = { kind: 'modgui', modgui: { html: '../x.html', css: 'modgui/s.css' } }; }, ['/source/modgui/html', 'pattern'], (s) => { delete s.properties.source.properties.modgui.properties.html.pattern; }],
  ['a section with no controls', (d) => { delete d.sections[0].controls; }, ['/sections/0', 'required'], (s) => { s.properties.sections.items.required = ['key']; }],
  ['a section key that is not a key', (d) => { d.sections[0].key = 'Main Section'; }, ['/sections/0/key', 'pattern'], (s) => { delete s.$defs.key.pattern; }],
  ['a visibility rule with a text value', (d) => { d.visibleWhen.damping.values = ['on']; }, ['/visibleWhen/damping/values/0', 'type'], (s) => { s.properties.visibleWhen.additionalProperties.properties.values.items = {}; }],
  ['a visibility value past 63', (d) => { d.visibleWhen.damping.values = [64]; }, ['/visibleWhen/damping/values/0', 'maximum'], (s) => { delete s.properties.visibleWhen.additionalProperties.properties.values.items.maximum; }],
  ['a display of an unknown kind', (d) => { d.displays = [{ kind: 'vu_needle', section: 'main', source: 'meters' }]; }, ['/displays/0/kind', 'enum'], (s) => { delete s.properties.displays.items.properties.kind.enum; }],
];

for (const [name, breakIt, [path, keyword], weaken] of BROKEN) {
  test(`refused: ${name}`, () => {
    const doc = clone(example());
    breakIt(doc);
    const { ok, errors } = validateSkin(doc);
    assert.equal(ok, false, 'the broken copy was accepted');
    assert.ok(errors.some((e) => e.path === path && e.code === keyword), `refused at ${path} by ${keyword}: ${JSON.stringify(errors)}`);
  });
  test(`sabotage: without its guard the schema accepts ${name}`, () => {
    const schema = loadSchema();
    weaken(schema);
    const doc = clone(example());
    breakIt(doc);
    const { ok, errors } = makeValidator(schema)(doc);
    assert.deepEqual(errors.filter((e) => e.path === path && e.code === keyword), [], 'the guard is still there');
    assert.ok(ok || errors.every((e) => !(e.path === path)), 'something else still refuses the same place');
  });
}
