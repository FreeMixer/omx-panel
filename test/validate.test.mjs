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
  ['no requires', (d) => { delete d.requires; }, ['/', 'required'], (s) => { s.required = s.required.filter((k) => k !== 'requires'); }],
  ['a requires with no schema floor', (d) => { d.requires = {}; }, ['/requires', 'required'], (s) => { delete s.properties.requires.required; }],
  ['a schema ceiling in place of a floor', (d) => { d.requires['omx-skins-schema'] = '< 2.0.0'; }, ['/requires/omx-skins-schema', 'pattern'], (s) => { delete s.$defs.floor.pattern; }],
  ['an exact schema version in place of a floor', (d) => { d.requires['omx-skins-schema'] = '1.0.0'; }, ['/requires/omx-skins-schema', 'pattern'], (s) => { delete s.$defs.floor.pattern; }],
  ['an empty plugin id', (d) => { d.plugin = ''; }, ['/plugin', 'minLength'], (s) => { delete s.properties.plugin.minLength; }],
  ['a field the format does not have', (d) => { d.verdict = 'good'; }, ['/', 'additionalProperties'], (s) => { delete s.additionalProperties; }],
  ['a licence that is not an identifier', (d) => { d.licence = 'GPL 3 or later'; }, ['/licence', 'pattern'], (s) => { delete s.properties.licence.pattern; }],
  ['a source of an unknown kind', (d) => { d.source.kind = 'stolen'; }, ['/source/kind', 'enum'], (s) => { delete s.properties.source.properties.kind.enum; }],
  ['a backdrop that leaves the package', (d) => { d.backdrop = 'art/../../etc/passwd'; }, ['/backdrop', 'pattern'], (s) => { delete s.properties.backdrop.pattern; }],
  ['a backdrop outside art/', (d) => { d.backdrop = '/etc/passwd'; }, ['/backdrop', 'pattern'], (s) => { delete s.properties.backdrop.pattern; }],
  ['a view entry outside view/', (d) => { d.view = { entry: 'art/plate.js', api: '1.1' }; }, ['/view/entry', 'pattern'], (s) => { delete s.properties.view.properties.entry.pattern; }],
  ['a skin API version that is not MAJOR.MINOR', (d) => { d.view = { entry: 'view/index.mjs', api: '1' }; }, ['/view/api', 'pattern'], (s) => { delete s.properties.view.properties.api.pattern; }],
  ['a section with no controls', (d) => { delete d.sections[0].controls; }, ['/sections/0', 'required'], (s) => { s.properties.sections.items.required = ['key']; }],
  ['a section key that is not a key', (d) => { d.sections[0].key = 'Main Section'; }, ['/sections/0/key', 'pattern'], (s) => { delete s.properties.sections.items.properties.key.pattern; }],
  ['a visibility rule with a text value', (d) => { d.visibleWhen.damping.values = ['on']; }, ['/visibleWhen/damping/values/0', 'type'], (s) => { delete s.properties.visibleWhen.additionalProperties.properties.values.items.type; }],
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
