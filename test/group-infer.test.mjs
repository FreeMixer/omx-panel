// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * tools/group-infer.mjs (docs/group-inference.md; plugin-hostd#218, G1), built: over real LV2 TTL copied from installed
 * plugins (test/fixtures/lv2-groups, provenance in SOURCES there), each rule yields the groups asserted here, the
 * rules fire in their order (a control one rule placed is never regrouped by a later one), a plugin that already
 * carries its groups (ours first) is nothing to do, and a plugin the rules cannot group with confidence is refused
 * with the reason. The installed arm reads every omx-*.lv2 bundle on this machine, where omx-plugins is installed.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBundle } from '../dist/tools/modgui-import.mjs';
import {
  HOST_DESIGNATIONS,
  MAX_GROUPS,
  RULES,
  SECTION_WORDS,
  inferGroups,
  lv2Symbol,
  placeableControls,
  pluginUris,
  readModguiLayout,
  readPluginPorts,
} from '../dist/tools/group-infer.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(PKG, 'test/fixtures/lv2-groups');
const INSTALLED = '/usr/lib64/lv2';

/** One fixture plugin, read as the generator will read it: the bundle's TTL, the plugin's ports, its MOD GUI. */
function load(dir, uri) {
  const triples = readBundle(join(FIXTURES, dir));
  const uris = pluginUris(triples);
  const u = uri ?? uris[0];
  assert.ok(uris.includes(u), `${dir} describes ${u}`);
  return { plugin: readPluginPorts(triples, u), modgui: readModguiLayout(triples, u) };
}
const infer = (dir, uri) => {
  const { plugin, modgui } = load(dir, uri);
  return inferGroups(plugin, modgui);
};
/** The groups as `name: rule: ports` lines, the shape every rule's assertion below reads. */
const shape = (groups) => groups.map((g) => `${g.name} [${g.rule}] ${g.ports.join(' ')}`);

/** Every grouped verdict: each placeable control in exactly one group, symbols valid and unique, priority in order. */
function assertWellFormed(verdict, plugin) {
  assert.equal(verdict.outcome, 'grouped');
  const placeable = placeableControls(plugin.ports).map((p) => p.symbol).sort();
  const members = verdict.groups.flatMap((g) => g.ports).sort();
  assert.deepEqual(members, placeable, 'every control is placed once');
  const symbols = verdict.groups.map((g) => g.symbol);
  assert.equal(new Set(symbols).size, symbols.length, 'group symbols are unique');
  for (const s of symbols) assert.match(s, /^[_a-zA-Z][_a-zA-Z0-9]*$/, `${s} is an lv2:symbol`);
  assert.deepEqual(verdict.groups.map((g) => g.displayPriority), verdict.groups.map((_, i) => verdict.groups.length - i));
  for (const g of verdict.groups) for (const p of g.ports) assert.ok(!p.startsWith('_:'), `${p} is a port symbol, not a blank node`);
}

describe('a plugin that already carries its groups is nothing to do', () => {
  for (const dir of ['omx-comp', 'omx-eq8']) {
    it(`our own ${dir}`, () => {
      assert.deepEqual(infer(dir), { outcome: 'nothing-to-do', reason: 'own-groups-complete' });
    });
  }

  it('omx-comp: the enabled port is the host\'s bypass, needs no group, and is the only control outside one', () => {
    const { plugin } = load('omx-comp');
    const outside = plugin.ports.filter((p) => p.control && p.input && p.group === undefined);
    assert.deepEqual(outside.map((p) => p.symbol), ['enabled']);
    assert.ok(HOST_DESIGNATIONS.has(outside[0].designation));
  });

  it('a third party\'s complete groups (x42 matrixmixer)', () => {
    assert.deepEqual(infer('x42-matrixmixer'), { outcome: 'nothing-to-do', reason: 'own-groups-complete' });
  });

  const ours = existsSync(INSTALLED) ? readdirSync(INSTALLED).filter((n) => /^omx-.*\.lv2$/.test(n)) : [];
  it(`every installed omx-*.lv2 bundle (${ours.length} here)`, { skip: ours.length === 0 && 'omx-plugins is not installed here' }, () => {
    for (const b of ours) {
      const triples = readBundle(join(INSTALLED, b));
      for (const uri of pluginUris(triples)) {
        const v = inferGroups(readPluginPorts(triples, uri), readModguiLayout(triples, uri));
        assert.deepEqual(v, { outcome: 'nothing-to-do', reason: 'own-groups-complete' }, `${b}: ${uri}`);
      }
    }
  });

  it('a plugin whose controls fit one screen, with no groups, is nothing to do', () => {
    const ports = ['a', 'b', 'c', 'd'].map((s, i) => ({ symbol: `x_${s}`, name: `X ${s}`, index: i, control: true, input: true }));
    assert.deepEqual(inferGroups({ uri: 'urn:t', ports }), { outcome: 'nothing-to-do', reason: 'fits-one-screen' });
  });

  it('a plugin with no control is nothing to do', () => {
    const ports = [{ symbol: 'in', name: 'In', index: 0, control: false, input: true }];
    assert.deepEqual(inferGroups({ uri: 'urn:t', ports }), { outcome: 'nothing-to-do', reason: 'no-controls' });
  });
});

describe('each rule, on real plugins', () => {
  it('1: the plugin\'s own partial groups are kept, node and symbol and label (mda RezFilter)', () => {
    const { plugin, modgui } = load('mda-rezfilter');
    const v = inferGroups(plugin, modgui);
    assertWellFormed(v, plugin);
    assert.deepEqual(shape(v.groups), [
      'Filter [1] freq res',
      'More [5] output env_vcf',
      'Envelope [1] attack release',
      'LFO [3] lfo_vcf lfo_rate',
      'More 2 [5] trigger max_freq',
    ]);
    const own = v.groups.filter((g) => g.rule === 1);
    assert.deepEqual(own.map((g) => [g.symbol, g.node]), [
      ['filt', 'http://drobilla.net/plugins/mda/RezFilter/filt'],
      ['env', 'http://drobilla.net/plugins/mda/RezFilter/env'],
    ]);
  });

  it('1: own groups that state lv2:displayPriority keep it; generated groups follow below the lowest (omx-eq8)', () => {
    // no installed plugin states a group priority: the omx-eq8 fixture copy adds 30, 20 and 10 (SOURCES)
    const { plugin } = load('omx-eq8');
    assert.deepEqual(inferGroups(plugin, null), { outcome: 'nothing-to-do', reason: 'own-groups-complete' });
    const hpfLost = { ...plugin, ports: plugin.ports.map((p) => (p.group === 'urn:openmixer:eq8#hpf' ? { ...p, group: undefined } : p)) };
    const v = inferGroups(hpfLost, null);
    assert.equal(v.outcome, 'grouped');
    assert.deepEqual(v.groups.map((g) => [g.name, g.rule, g.displayPriority]), [['HPF', 3, 9], ['LPF', 1, 10], ['Bands', 1, 30]]);
  });

  it('1: when one own group states no priority, every group counts down in port order (omx-eq8, bands unstated)', () => {
    const { plugin } = load('omx-eq8');
    const groups = { ...plugin.groups, 'urn:openmixer:eq8#bands': { ...plugin.groups['urn:openmixer:eq8#bands'], displayPriority: undefined } };
    const ports = plugin.ports.map((p) => (p.group === 'urn:openmixer:eq8#hpf' ? { ...p, group: undefined } : p));
    const v = inferGroups({ ...plugin, ports, groups }, null);
    assert.deepEqual(v.groups.map((g) => [g.name, g.displayPriority]), [['HPF', 3], ['LPF', 2], ['Bands', 1]]);
  });

  it('2: lv2:designation groups the filter; rule 3 does not take those two back (mda JX10)', () => {
    const v = infer('mda-jx10');
    // glide shares nothing with any other control: the plugin is left as it is
    assert.equal(v.outcome, 'no-confident-grouping');
    assert.equal(v.reason, 'unplaced-controls');
    assert.deepEqual(v.attempt.unplaced, ['glide']);
    const filter = v.attempt.groups.find((g) => g.name === 'Filter');
    assert.deepEqual(filter, { symbol: 'filter', name: 'Filter', displayPriority: 5, ports: ['vcf_freq', 'vcf_reso'], rule: 2 });
    // "VCF Freq" and "VCF Reso" share rule 3's key "vcf" with VCF Env/LFO/Vel, yet stay where rule 2 put them
    assert.equal(v.attempt.placedBy.vcf_freq, 2);
    assert.equal(v.attempt.placedBy.vcf_reso, 2);
    assert.deepEqual(v.attempt.groups.find((g) => g.name === 'VCF').ports, ['vcf_env', 'vcf_lfo', 'vcf_vel']);
    // the plugin's own two envelopes are rule 1's, though their controls carry envelope designations
    assert.deepEqual(v.attempt.groups.filter((g) => g.rule === 1).map((g) => g.symbol), ['filt_env', 'amp_env']);
  });

  it('3: a shared leading word, one group per band (C* Eq4p, "A: Mode" ... "D: Gain")', () => {
    const { plugin, modgui } = load('caps-eq4p');
    assert.ok(modgui, 'Eq4p ships a MOD GUI');
    const v = inferGroups(plugin, modgui);
    assertWellFormed(v, plugin);
    assert.deepEqual(shape(v.groups), [
      'A [3] a_mode a_freq a_q a_gain',
      'B [3] b_mode b_freq b_q b_gain',
      'C [3] c_mode c_freq c_q c_gain',
      'D [3] d_mode d_freq d_q d_gain',
    ]);
  });

  it('3: a shared trailing number is one group per number, a leading word takes the bare word with it (x42 fil4)', () => {
    for (const uri of ['http://gareus.org/oss/lv2/fil4#mono', 'http://gareus.org/oss/lv2/fil4#stereo']) {
      const { plugin, modgui } = load('x42-fil4', uri);
      const v = inferGroups(plugin, modgui);
      assertWellFormed(v, plugin);
      assert.deepEqual(shape(v.groups), [
        'General [5] gain peakreset',
        'Highpass [3] HighPass HPfreq HPQ',
        'Lowpass [3] LowPass LPfreq LPQ',
        'Lowshelf [3] LSsec LSfreq LSq LSgain',
        'Section 1 [3] sec1 freq1 q1 gain1',
        'Section 2 [3] sec2 freq2 q2 gain2',
        'Section 3 [3] sec3 freq3 q3 gain3',
        'Section 4 [3] sec4 freq4 q4 gain4',
        'Highshelf [3] HSsec HSfreq HSq HSgain',
      ]);
    }
  });

  it('3: numbered controls with no section word are "Group N" (Calf X-Over 4 Band)', () => {
    const { plugin } = load('calf-xover4band');
    const v = inferGroups(plugin, null);
    assertWellFormed(v, plugin);
    assert.deepEqual(shape(v.groups), [
      'General [5] level mode',
      // the symbols number the transitions from 0 (`freq0` is "Transition 1") and the bands from 1: two numberings,
      // so the symbol pass places nothing; the names number both from 1, the transitions lacking only the last band
      'Group 1 [3] freq0 level1 active1 phase1 delay1',
      'Group 2 [3] freq1 level2 active2 phase2 delay2',
      'Group 3 [3] freq2 level3 active3 phase3 delay3',
      'Group 4 [3] level4 active4 phase4 delay4',
    ]);
  });

  it('3: the symbol numbers the bands where the name prints a frequency (LSP Graphic Equalizer x16 Stereo)', () => {
    const { plugin, modgui } = load('lsp-graph-eq-x16');
    const v = inferGroups(plugin, modgui);
    assertWellFormed(v, plugin);
    const bands = Array.from({ length: 16 }, (_, b) => `Group ${b} [3] xs_${b} xm_${b} xe_${b} g_${b}`);
    assert.deepEqual(shape(v.groups), [
      'Input [3] g_in ife_l ife_r',
      'Output [3] g_out ofe_l ofe_r bal',
      'More [5] mode slope react shift zoom',
      'Return [3] rfe_l rfe_r',
      ...bands,
    ]);
  });

  it('3: names first would have made a 64-control "Band" blob of the same plugin: the pass order is the fix', () => {
    const { plugin, modgui } = load('lsp-graph-eq-x16');
    const namesFirst = [['name', 'trailing'], ['name', 'leading'], ['symbol', 'trailing'], ['symbol', 'leading']];
    const v = inferGroups(plugin, modgui, { prefixPasses: namesFirst });
    const blob = (v.groups ?? v.attempt.groups).find((g) => g.name === 'Band');
    assert.equal(blob?.ports.length, 64);
  });

  it('3: a numbered stem some control breaks ("Band gain 1K", "31.5") is placed by no numbered group', () => {
    const ports = [
      ['g_a', 'Band gain 16'], ['s_a', 'Band solo 16'], ['g_b', 'Band gain 25'], ['s_b', 'Band solo 25'],
      ['g_c', 'Band gain 1K'], ['s_c', 'Band solo 1K'],
    ].map(([symbol, name], i) => ({ symbol, name, index: i, control: true, input: true }));
    const v = inferGroups({ uri: 'urn:t', ports });
    const groups = v.groups ?? v.attempt.groups;
    assert.ok(!groups.some((g) => /^Group /.test(g.name)), JSON.stringify(shape(groups)));
  });

  it('3: two unrelated numberings are no band pattern: attack stages 1-4, release stages 1-3 (AMS advenv)', () => {
    const { plugin } = load('ams-advenv');
    const v = inferGroups(plugin, null);
    // the number passes place nothing ("Attack Time 4" has no release beside it); the leading words find the stages
    assert.ok(!(v.groups ?? v.attempt.groups).some((g) => /^Group /.test(g.name)));
    assert.deepEqual(shape(v.groups), [
      'General [5] timeScale sustain delay',
      'Attack [3] attackTime1 attackTime2 attackTime3 attackTime4 attackLevel1 attackLevel2 attackLevel3',
      'Release [3] releaseTime1 releaseTime2 releaseTime3 releaseLevel1 releaseLevel2',
    ]);
  });

  it('3: a stem numbered inside the pattern but fewer is another thing numbered, left to later passes', () => {
    const ports = [];
    for (const b of [1, 2, 3]) ports.push({ symbol: `gain${b}`, name: `Gain ${b}` }, { symbol: `pan${b}`, name: `Pan ${b}` });
    // {2, 3} is inside {1, 2, 3} but neither the pattern nor the pattern less its last number
    ports.push({ symbol: 'trig2', name: 'Trig 2' }, { symbol: 'trig3', name: 'Trig 3' });
    const v = inferGroups({ uri: 'urn:t', ports: ports.map((p, i) => ({ ...p, index: i, control: true, input: true })) });
    assert.equal(v.outcome, 'grouped');
    assert.deepEqual(shape(v.groups).slice(0, 3), ['Group 1 [3] gain1 pan1', 'Group 2 [3] gain2 pan2', 'Group 3 [3] gain3 pan3']);
    assert.ok(v.groups.slice(3).some((g) => g.ports.join(' ') === 'trig2 trig3'), JSON.stringify(shape(v.groups)));
  });

  it('4: a shared units:unit, refused when two controls remain in no group (ZamGate)', () => {
    const v = infer('zam-gate');
    assert.equal(v.outcome, 'no-confident-grouping');
    assert.equal(v.reason, 'unplaced-controls');
    assert.deepEqual(shape(v.attempt.groups), ['Time [4] att rel', 'Level [4] thr mak close']);
    assert.deepEqual(v.attempt.unplaced, ['sidechain', 'mode']);
  });

  it('5: an index run alone is no grouping: refused when it places most controls (Calf Compressor)', () => {
    const v = infer('calf-compressor');
    assert.equal(v.outcome, 'no-confident-grouping');
    assert.equal(v.reason, 'mostly-by-index');
    assert.deepEqual(shape(v.attempt.groups), [
      'General [5] bypass level_in threshold ratio',
      'Time [4] attack release',
      'More [5] makeup knee detection stereo_link mix',
    ]);
  });

  it('6: the plugin\'s own MOD GUI: its face is Main, the rest More (C* AutoFilter)', () => {
    const { plugin, modgui } = load('caps-autofilter');
    assert.deepEqual(modgui.ports.map((p) => p.symbol), ['filter', 'frequency', 'Q', 'depth']);
    const v = inferGroups(plugin, modgui);
    assertWellFormed(v, plugin);
    assert.deepEqual(shape(v.groups), ['More [6] mode lfoenv rate shape', 'Main [6] filter frequency Q depth']);
    // without its MOD GUI nothing in the plugin's words groups it
    assert.equal(inferGroups(plugin, null).outcome, 'no-confident-grouping');
  });
});

describe('the rules fire in their order', () => {
  it('a plugin rule 3 groups whole is never reached by rule 6, though it has a MOD GUI (C* Eq4p)', () => {
    const v = infer('caps-eq4p');
    assert.ok(Object.values(v.placedBy).every((r) => r === 3));
  });

  it('designated controls stay in rule 2\'s group though their names share a prefix with others', () => {
    const P = 'http://lv2plug.in/ns/ext/parameters#';
    const ports = [
      { symbol: 'env_att', name: 'Env Attack', designation: `${P}attack` },
      { symbol: 'env_dec', name: 'Env Decay', designation: `${P}decay` },
      { symbol: 'env_depth', name: 'Env Depth' },
      { symbol: 'env_amount', name: 'Env Amount' },
      { symbol: 'out_gain', name: 'Out Gain' },
      { symbol: 'out_pan', name: 'Out Pan' },
    ].map((p, i) => ({ ...p, index: i, control: true, input: true }));
    const v = inferGroups({ uri: 'urn:t', ports });
    assert.equal(v.outcome, 'grouped');
    // rule 3's "env" key equals the key every member of rule 2's Envelope shares: it adds to that group, never
    // takes env_att or env_dec into a group of its own
    assert.deepEqual(shape(v.groups), ['Envelope [2] env_att env_dec env_depth env_amount', 'Out [3] out_gain out_pan']);
    assert.deepEqual(v.placedBy, { env_att: 2, env_dec: 2, env_depth: 3, env_amount: 3, out_gain: 3, out_pan: 3 });
  });

  it('the order is the contract: rule 3 before rule 2 would group the same controls differently (mda JX10)', () => {
    const { plugin, modgui } = load('mda-jx10');
    const swapped = [RULES[0], RULES[2], RULES[1], ...RULES.slice(3)];
    const v = inferGroups(plugin, modgui, { rules: swapped });
    assert.equal(v.attempt.placedBy.vcf_freq, 3);
    assert.notDeepEqual(v.attempt.groups, infer('mda-jx10').attempt.groups);
  });
});

describe('no confident grouping: the plugin is left exactly as it is', () => {
  const refused = {
    'swh-gate': 'unplaced-controls',
    'swh-delayorama': 'unplaced-controls',
    'calf-multichorus': 'unplaced-controls',
    'x42-fat1': 'unplaced-controls',
    'x42-darc': 'unplaced-controls',
  };
  for (const [dir, reason] of Object.entries(refused)) {
    it(`${dir}: ${reason}`, () => {
      const { plugin, modgui } = load(dir);
      const v = inferGroups(plugin, modgui);
      assert.equal(v.outcome, 'no-confident-grouping');
      assert.equal(v.reason, reason);
      assert.ok(!('groups' in v), 'a refusal carries no groups to write');
    });
  }

  it(`more than MAX_GROUPS (${MAX_GROUPS}) groups is refused`, () => {
    const ports = [];
    for (let b = 1; b <= MAX_GROUPS + 1; b++) {
      ports.push({ symbol: `freq${b}`, name: `Freq ${b}` }, { symbol: `gain${b}`, name: `Gain ${b}` });
    }
    const v = inferGroups({ uri: 'urn:t', ports: ports.map((p, i) => ({ ...p, index: i, control: true, input: true })) });
    assert.equal(v.reason, 'too-many-groups');
    assert.equal(v.attempt.groups.length, MAX_GROUPS + 1);
  });

  it('one group holding every control is never made: the rule leaves them for the next', () => {
    const P = 'http://lv2plug.in/ns/ext/parameters#';
    const ports = ['attack', 'decay', 'sustain', 'release', 'hold'].map((d, i) => ({
      symbol: d, name: d, index: i, control: true, input: true, designation: `${P}${d}`,
    }));
    const v = inferGroups({ uri: 'urn:t', ports });
    assert.equal(v.outcome, 'no-confident-grouping');
    assert.equal(v.reason, 'unplaced-controls');
  });

  it('the plugin\'s own single group, with no lv2:symbol, is one group: too few', () => {
    const ports = ['a', 'b', 'c', 'd', 'e'].map((s, i) => ({ symbol: s, name: s, index: i, control: true, input: true, group: 'urn:t#all' }));
    const v = inferGroups({ uri: 'urn:t', ports, groups: { 'urn:t#all': { name: 'All' } } });
    assert.equal(v.outcome, 'no-confident-grouping');
    assert.equal(v.reason, 'too-few-groups');
  });
});

describe('the inputs', () => {
  it('the function is pure: its input is unchanged and a second run yields the same verdict', () => {
    const { plugin, modgui } = load('x42-fil4', 'http://gareus.org/oss/lv2/fil4#mono');
    const before = JSON.stringify({ plugin, modgui });
    const a = inferGroups(plugin, modgui);
    assert.equal(JSON.stringify({ plugin, modgui }), before);
    assert.deepEqual(inferGroups(plugin, modgui), a);
  });

  it('the reader keeps audio-port groups out: Calf\'s pg:group on its audio ports leaves its controls ungrouped', () => {
    const { plugin } = load('calf-compressor');
    assert.ok(plugin.ports.some((p) => !p.control && p.group !== undefined), 'calf groups its audio ports');
    assert.ok(placeableControls(plugin.ports).every((p) => p.group === undefined));
  });

  it('a plugin without a MOD GUI reads as null, the test omx-modgui-sync makes', () => {
    assert.equal(load('calf-compressor').modgui, null);
  });

  it('docs/group-inference.md lists SECTION_WORDS as the module holds them', () => {
    const doc = readFileSync(join(PKG, 'docs/group-inference.md'), 'utf8');
    const m = doc.match(/\(`SECTION_WORDS`: ([^)]*)\)/);
    assert.ok(m, 'the doc names SECTION_WORDS and its words');
    assert.deepEqual(m[1].split(/,\s*/).map((w) => w.trim()), [...SECTION_WORDS]);
  });

  it('lv2Symbol makes a valid symbol of any text', () => {
    assert.equal(lv2Symbol('Section 1'), 'section_1');
    assert.equal(lv2Symbol('1st'), 'g_1st');
    assert.equal(lv2Symbol('***'), 'group');
  });
});
