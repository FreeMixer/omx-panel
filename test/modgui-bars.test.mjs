// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
// The MOD GUI's bar group (the one-panel spec §7.4): a row of faders in the template, each a plain input-control port MOD moves
// live with its own fader film, the label under each the bar's; the screenshot draws the same row. A declared `bars: false`
// leaves the controls as they were; a declared `bars: true` that fails the rule is refused by its code.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BARS_CODES } from '../tools/bars.mjs';
import { generateModgui, resolvePanel } from '../tools/modgui-gen.mjs';
import { BarsRefused } from '../tools/panel-description.mjs';

const FOOT = ["16'", "5 1/3'", "8'", "4'", "2 2/3'", "2'", "1 3/5'", "1 1/3'", "1'"];
const descriptor = (labels = FOOT) => ({
  origin: 'scanned', plugin: { id: 'urn:test:organ', format: 'lv2', name: 'Organ', vendor: 'Test', features: ['audio-effect'] },
  controls: labels.map((l, i) => ({ id: `db${i}`, symbol: `db${i}`, name: l, kind: 'travel', travel: { min: 0, max: 8, step: 1, unit: 'unknown', scale: 'stepped', default: i === 2 ? 8 : 0 } })),
  ports: [],
});
const gen = (d = descriptor(), panel) => new Map(generateModgui(d, { panel, stem: 'organ', source: 'test' }).map(([p, b]) => [p, b]));
const panelOf = (bars) => ({ family: 'none', sections: [{ key: 'drawbars', label: 'Drawbars', controls: FOOT.map((_, i) => `db${i}`), ...(bars === undefined ? {} : { bars }) }] });

test('nine drawbars are a row of faders: widget fader, the footage the label, the fader film emitted', () => {
  const p = resolvePanel(descriptor(), { stem: 'organ' });
  assert.deepEqual(p.sections[0].controls.map((k) => [k.widget, k.bar]), FOOT.map((f) => ['fader', f]));
  const files = gen();
  const html = files.get('modgui/icon-organ.html').toString();
  assert.equal(html.match(/omx-bar"/g).length, 9);
  assert.ok(html.includes('<span class="omx-control-title">5 1/3\'</span>'));
  assert.equal(html.match(/mod-role="input-control-port"/g).length, 9);
  assert.ok(files.has('modgui/knobs/omx-fader.png'));
  assert.equal((files.get('modgui.ttl').toString().match(/lv2:symbol "db/g) ?? []).length, 9);
});
test('arm: a declared bars: false leaves the integer travels as selectors, and the screenshot changes', () => {
  const off = resolvePanel(descriptor(), { panel: panelOf(false), stem: 'organ' });
  assert.ok(off.sections[0].controls.every((k) => k.widget === 'selector' && k.bar === undefined));
  assert.ok(!gen(descriptor(), panelOf(false)).get('modgui/icon-organ.html').toString().includes('omx-bar'));
  assert.ok(!gen(descriptor(), panelOf(false)).get('modgui/screenshot-organ.png').equals(gen().get('modgui/screenshot-organ.png')));
});
test('arm: a labels-out-of-series section stays as it was', () => {
  const odd = descriptor(['16\'', '8\'', 'Reverb', '4\'', '2\'']);
  assert.ok(resolvePanel(odd, { stem: 'organ' }).sections[0].controls.every((k) => k.bar === undefined));
});
test('a declared bars: true that fails a check of the rule is refused by its code', () => {
  const d = descriptor(FOOT.slice(0, 3));
  const panel = { family: 'none', sections: [{ key: 's', label: 'S', controls: ['db0', 'db1', 'db2'], bars: true }] };
  assert.throws(() => resolvePanel(d, { panel, stem: 'organ' }), (e) => e instanceof BarsRefused && e.code === BARS_CODES.few);
});
