// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * The skin package's pure half (src/skin-package.ts, built): the id encoding (§6.1), the version rule (§7.2), the
 * override's schema and application (§6.3) and the view lint (§7.3). Moved from the console's
 * core with its assertions unchanged; each `expect` there is an `assert` here.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  SKIN_API_VERSION,
  acceptsSkinApi,
  applySkinOverride,
  checkSkinRoles,
  decodeSkinId,
  encodeSkinId,
  MODGUI_FILE_PROPERTIES,
  MODGUI_GUI_PROPERTIES,
  MODGUI_IMPORT_REFUSALS,
  MODGUI_PORT_PROPERTIES,
  MODGUI_RESOURCES_ROUTE,
  MODGUI_SERVER_ROUTES,
  MODGUI_TEMPLATE_PROPERTIES,
  SKIN_LICENCE_ALLOW_LIST,
  SKIN_REFUSAL_CODES,
  isSkinLicenceAllowed,
  lintSkinViewSource,
  parseSkinOverride,
  spdxFromDoapLicence,
  skinBaseUrl,
} from '../dist/src/skin-package.js';

const param = (symbol, unit) => ({ kind: 'number', symbol, name: symbol, unit, scale: 'linear', step: 0, min: 0, max: 1, default: 0 });

const DESC = {
  plugin: 'org.openmixer.stage.delay',
  fingerprint: 'f',
  refusal: null,
  family: 'delay',
  params: [param('timeMs', 'ms'), param('feedback', 'none'), param('mix', 'none'), param('tone', 'none')],
  sections: [
    { key: 'main', labelKey: 'fx.delay.section.main', label: 'Main' },
    { key: 'colour', labelKey: 'fx.delay.section.colour', label: 'Colour' },
  ],
  controls: [
    { symbol: 'timeMs', section: 'main', widget: 'knob', labelKey: 'fx.delay.time', label: 'Time', visibleWhen: null },
    { symbol: 'feedback', section: 'main', widget: 'knob', labelKey: 'fx.delay.feedback', label: 'Feedback', visibleWhen: null },
    { symbol: 'mix', section: 'main', widget: 'knob', labelKey: 'fx.mix', label: 'Mix', visibleWhen: null },
    { symbol: 'tone', section: 'colour', widget: 'knob', labelKey: 'fx.delay.tone', label: 'Tone', visibleWhen: null },
  ],
  roles: [{ role: 'time', index: 0, symbol: 'timeMs' }],
  displays: [],
  placementDefaults: [],
  pages: [],
  presets: [],
  manualPage: null,
  skin: null,
};

describe('the id as a directory name (§6.1)', () => {
  it('keeps a reverse-DNS id, encodes an LV2 URI byte by byte, and never names . or ..', () => {
    assert.equal(encodeSkinId('org.openmixer.stage.delay'), 'org.openmixer.stage.delay');
    assert.equal(encodeSkinId('http://lsp-plug.in/plugins/lv2/comp'), 'http%3A%2F%2Flsp-plug.in%2Fplugins%2Flv2%2Fcomp');
    assert.equal(encodeSkinId('..'), '%2E%2E');
    assert.equal(encodeSkinId('é'), '%C3%A9');
    for (const id of ['org.openmixer.stage.delay', 'http://x/y', '..', 'é']) assert.equal(decodeSkinId(encodeSkinId(id)), id);
    assert.equal(decodeSkinId('%2e%2e'), null);
    assert.equal(skinBaseUrl('http://x/y'), '/skins/http%253A%252F%252Fx%252Fy/');
  });
});

describe('the version rule (§7.2)', () => {
  it('accepts the same major with a minor not above the console’s, and refuses another major', () => {
    assert.equal(SKIN_API_VERSION, '1.1');
    assert.equal(acceptsSkinApi('1.0'), true);
    assert.equal(acceptsSkinApi('1.1'), true);
    assert.equal(acceptsSkinApi('1.2'), false);
    assert.equal(acceptsSkinApi('1.0', '1.3'), true);
    assert.equal(acceptsSkinApi('1.4', '1.3'), false);
    assert.equal(acceptsSkinApi('2.0'), false);
    assert.equal(acceptsSkinApi('0.9'), false);
    assert.equal(acceptsSkinApi('1'), false);
  });
});

describe('the override file (§6.3)', () => {
  const file = (o) => JSON.stringify({ schema: 1, plugin: DESC.plugin, licence: 'GPL-3.0-or-later', ...o });

  it('refuses a file that does not parse, names another plugin, or carries a view escaping view/', () => {
    const codes = [
      parseSkinOverride('{', DESC.plugin),
      parseSkinOverride(file({ plugin: 'other' }), DESC.plugin),
      parseSkinOverride(file({ schema: 2 }), DESC.plugin),
      parseSkinOverride(file({ view: { entry: '../x.mjs', api: '1.0' } }), DESC.plugin),
      parseSkinOverride(file({ backdrop: 'art/../../etc/passwd' }), DESC.plugin),
    ].map((r) => (r.ok ? 'ok' : `${r.refusal.code}:${r.refusal.args?.['field']}`));
    assert.deepEqual(codes, [
      'SKIN_OVERRIDE_INVALID:json',
      'SKIN_OVERRIDE_INVALID:plugin',
      'SKIN_OVERRIDE_INVALID:schema',
      'SKIN_OVERRIDE_INVALID:view',
      'SKIN_OVERRIDE_INVALID:backdrop',
    ]);
    assert.equal(parseSkinOverride(file({}), DESC.plugin).ok, true);
  });

  it('takes a modgui entry under modgui/ as the opt-in, and refuses one escaping it or beside a view (§6.7)', () => {
    const got = parseSkinOverride(file({ modgui: { entry: 'modgui/icon-x.html' } }), DESC.plugin);
    assert.deepEqual(got.ok && got.override.modgui, { entry: 'modgui/icon-x.html' });
    const codes = [
      parseSkinOverride(file({ modgui: { entry: '../icon.html' } }), DESC.plugin),
      parseSkinOverride(file({ modgui: { entry: 'view/icon.html' } }), DESC.plugin),
      parseSkinOverride(file({ modgui: 'modgui/icon.html' }), DESC.plugin),
      parseSkinOverride(file({ modgui: { entry: 'modgui/icon.html' }, view: { entry: 'view/index.mjs', api: '1.0' } }), DESC.plugin),
    ].map((r) => (r.ok ? 'ok' : `${r.refusal.code}:${r.refusal.args?.['field']}`));
    assert.deepEqual(codes, Array(4).fill('SKIN_OVERRIDE_INVALID:modgui'));
  });

  it('passes exactly the allow-listed licences through the modgui gate (§6.6, §6.7)', () => {
    assert.equal(SKIN_LICENCE_ALLOW_LIST.every((l) => isSkinLicenceAllowed(l)), true);
    assert.deepEqual(['', 'GPL-2.0-only', 'AGPL-3.0-or-later', 'Proprietary', 'gpl-3.0-or-later'].map(isSkinLicenceAllowed), [false, false, false, false, false]);
  });

  it('accepts a modgui source naming its own icon and stylesheet inside modgui/, and refuses one escaping it (§6.6)', () => {
    const ok = parseSkinOverride(
      file({ source: { kind: 'modgui', bundle: '/usr/lib/lv2/x.lv2', modgui: { html: 'modgui/icon.html', css: 'modgui/stylesheet.css' } } }),
      DESC.plugin,
    );
    assert.equal(ok.ok, true);
    if (ok.ok) assert.deepEqual(ok.override.source?.modgui, { html: 'modgui/icon.html', css: 'modgui/stylesheet.css' });

    const escaping = parseSkinOverride(file({ source: { kind: 'modgui', modgui: { html: '../x.html', css: 'modgui/stylesheet.css' } } }), DESC.plugin);
    assert.equal(escaping.ok ? 'ok' : escaping.refusal.code, 'SKIN_OVERRIDE_INVALID');

    const outside = parseSkinOverride(file({ source: { kind: 'modgui', modgui: { html: 'art/icon.html', css: 'modgui/stylesheet.css' } } }), DESC.plugin);
    assert.equal(outside.ok, false);
  });

  it('relabels one control and reorders two sections, appends the unnamed, drops the unknown', () => {
    const parsed = parseSkinOverride(
      file({
        sections: [
          { key: 'colour', controls: ['tone', 'nope'] },
          { key: 'main', controls: ['feedback', 'timeMs'] },
        ],
        labels: { feedback: { label: 'Repeats' }, ghost: { label: 'x' } },
        roles: { feedback: 'feedback', ceiling: 'mix' },
      }),
      DESC.plugin,
    );
    if (!parsed.ok) throw new Error('fixture override refused');
    const { description, dropped } = applySkinOverride(DESC, parsed.override);
    assert.deepEqual(description.sections.map((s) => s.key), ['colour', 'main', 'more']);
    assert.equal(description.sections[0].labelKey, 'fx.delay.section.colour');
    assert.deepEqual(description.controls.map((c) => `${c.section}:${c.symbol}`), ['colour:tone', 'main:feedback', 'main:timeMs', 'more:mix']);
    const fb = description.controls.find((c) => c.symbol === 'feedback');
    assert.deepEqual([fb.label, fb.labelKey], ['Repeats', '']);
    assert.deepEqual(description.roles, [{ role: 'feedback', index: 0, symbol: 'feedback' }]);
    assert.deepEqual(dropped, [
      { field: 'sections', entry: 'colour:nope', reason: 'unknown-symbol' },
      { field: 'labels', entry: 'ghost', reason: 'unknown-symbol' },
      { field: 'roles', entry: 'ceiling[0]', reason: 'role-not-in-family' },
    ]);
    // the caller's own fields stand beside the replaced ones
    assert.equal(description.plugin, DESC.plugin);
  });
});

describe('D6 over the panel vocabulary', () => {
  it('drops a role outside the family, a unit the role does not take, an unknown symbol, a repeat and an index on a plain role', () => {
    const params = [param('t', 'ms'), param('f', 'none'), param('g', 'db'), { kind: 'path', symbol: 'p', name: 'p', default: '' }];
    const { roles, dropped } = checkSkinRoles('delay', [
      { role: 'time', index: 0, symbol: 't' },
      { role: 'time', index: 0, symbol: 't' },
      { role: 'time', index: 1, symbol: 't' },
      { role: 'feedback', index: 0, symbol: 'g' },
      { role: 'tone', index: 0, symbol: 'nope' },
      { role: 'tone', index: 0, symbol: 'p' },
      { role: 'ceiling', index: 0, symbol: 'f' },
    ], params);
    assert.deepEqual(roles, [{ role: 'time', index: 0, symbol: 't' }]);
    assert.deepEqual(dropped.map((d) => d.reason), ['role-repeats', 'role-not-in-family', 'role-unit', 'unknown-symbol', 'role-unit', 'role-not-in-family']);
    const eq = checkSkinRoles('eq', [{ role: 'band_gain', index: 3, symbol: 'g' }], params);
    assert.deepEqual(eq.dropped, [], 'an indexed role takes any index');
  });

  it('a caller passes its own check, and it is the one applied', () => {
    const parsed = parseSkinOverride(JSON.stringify({ schema: 1, plugin: DESC.plugin, licence: 'MIT', roles: { feedback: 'feedback' } }), DESC.plugin);
    const none = () => ({ roles: [], dropped: [] });
    assert.deepEqual(applySkinOverride(DESC, parsed.override, none).description.roles, []);
  });
});

describe('the view lint (§7.3) — an accident catcher, not a boundary', () => {
  it('names the first refused word or a non-relative dynamic import, and passes a clean view', () => {
    assert.equal(lintSkinViewSource('export const api = "1.0"; export default (h) => h.vue.h("div")'), null);
    assert.equal(lintSkinViewSource('await fetch("/api/x")'), 'fetch');
    assert.equal(lintSkinViewSource('localStorage.setItem("a", 1)'), 'localStorage');
    assert.equal(lintSkinViewSource('import("https://cdn.example/vue.js")'), 'import(');
    assert.equal(lintSkinViewSource('import(name)'), 'import(');
    assert.equal(lintSkinViewSource('import("./part.mjs")'), null);
  });
});

describe('§6.6 the licence map and the allow-list (§12 Q6)', () => {
  for (const [v, spdx] of [
    [{ iri: 'http://usefulinc.com/doap/licenses/gpl' }, 'GPL-2.0-or-later'],
    [{ iri: 'http://usefulinc.com/doap/licenses/lgpl' }, 'LGPL-2.1-or-later'],
    [{ iri: 'http://spdx.org/licenses/GPL-3.0-or-later' }, 'GPL-3.0-or-later'],
    [{ iri: 'https://spdx.org/licenses/GPL-2.0+.html' }, 'GPL-2.0-or-later'],
    [{ iri: 'http://opensource.org/licenses/isc' }, 'ISC'],
    [{ iri: 'http://opensource.org/licenses/GPL-2.0' }, 'GPL-2.0-only'],
    [{ literal: 'MIT' }, 'MIT'],
    [{ iri: 'http://example.org/my-licence' }, null],
    [{ literal: 'all rights reserved' }, null],
  ]) {
    it(`${JSON.stringify(v)} reads as ${spdx}`, () => {
      assert.equal(spdxFromDoapLicence(v), spdx);
    });
  }
  it('mapping is not permission: GPL-2.0-only and GPL-3.0-only are refused, every listed id is allowed', () => {
    assert.equal(isSkinLicenceAllowed('GPL-2.0-only'), false);
    assert.equal(isSkinLicenceAllowed('GPL-3.0-only'), false);
    for (const id of SKIN_LICENCE_ALLOW_LIST) assert.equal(isSkinLicenceAllowed(id), true);
  });
  it('the importer vocabulary is the spec list', () => {
    assert.equal(MODGUI_IMPORT_REFUSALS.length, 10);
    for (const code of ['MODGUI_PORT_UNKNOWN', 'MODGUI_IMAGE_NOT_FOUND'])assert.ok(MODGUI_IMPORT_REFUSALS.includes(code), code);
    assert.ok(MODGUI_GUI_PROPERTIES.includes('resourcesDirectory'));
    assert.deepEqual(MODGUI_PORT_PROPERTIES, ['index', 'symbol', 'name']);
    for (const code of MODGUI_IMPORT_REFUSALS) assert.ok(SKIN_REFUSAL_CODES.includes(code), code);
  });
  it('the importer vocabulary is the one docs/skin-package.md states, so the two cannot drift apart', () => {
    const doc = readFileSync(new URL('../docs/skin-package.md', import.meta.url), 'utf8');
    const s = doc.slice(doc.indexOf('## Importing a MOD GUI'), doc.indexOf('## What the validator checks'));
    const ticked = (text) => [...text.matchAll(/`(\w+)`/g)].map((m) => m[1]);
    const known = /The known `modgui:gui` properties are mod-ui's whole list[^:]*:([^(]*)\(`MODGUI_GUI_PROPERTIES`\)/.exec(s)[1];
    assert.deepEqual([...MODGUI_GUI_PROPERTIES].sort(), ticked(known).sort());
    const refuses = /It refuses[^:]*:([\s\S]*?`MODGUI_TARGET_EXISTS`)/.exec(s)[1];
    assert.deepEqual([...MODGUI_IMPORT_REFUSALS].sort(), ticked(refuses).filter((w) => w.startsWith('MODGUI_')).sort());
    const fileValued = /The file-valued ones \(([^;]*);/.exec(s)[1];
    assert.deepEqual([...MODGUI_FILE_PROPERTIES].sort(), ticked(fileValued).sort());
    for (const p of MODGUI_FILE_PROPERTIES) assert.ok(MODGUI_GUI_PROPERTIES.includes(p), p);
    assert.deepEqual([...MODGUI_TEMPLATE_PROPERTIES], ['iconTemplate', 'settingsTemplate']);
    for (const p of MODGUI_TEMPLATE_PROPERTIES) assert.ok(MODGUI_FILE_PROPERTIES.includes(p), p);
    assert.ok(s.replace(/\s+/g, ' ').includes("mod-ui's `/resources/` route (`MODGUI_RESOURCES_ROUTE`"));
    assert.equal(MODGUI_RESOURCES_ROUTE, '/resources/');
    const served = /mod-ui's own routes, the directories its static handler serves from its html directory, ([^(]*)\(`MODGUI_SERVER_ROUTES`\)/.exec(s.replace(/\s+/g, ' '))[1];
    assert.deepEqual([...MODGUI_SERVER_ROUTES].sort(), [...served.matchAll(/`(\/[^`]+)`/g)].map((m) => m[1]).sort());
    assert.ok(MODGUI_SERVER_ROUTES.includes('/fonts/') && !MODGUI_SERVER_ROUTES.includes(MODGUI_RESOURCES_ROUTE));
  });
});
