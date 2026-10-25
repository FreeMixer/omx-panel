// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * panel-description.mjs — a plugin's panel laid out from its DESCRIPTOR (omx-contract's descriptor
 * words: each control's kind, travel with its unit and scale, choice ids, label, group and meaning, the
 * ports, the origin), so a plugin from any origin gets a layout (docs/panel-layout.md). A declared
 * panel, ours, adds the family, the sections, the order, the roles, the widgets, the graphs and the
 * per-placement come-up values on top. The result is org.openmixer.panel-description/1:
 * the family, the sections in order, one control per listed parameter, the roles its family takes, a
 * display per section `graph` the extension names, and the canonical serialisation whose SHA-256 is
 * the fingerprint. omx-plugins writes the rows its faces serve from it (its include/omx_panel_description.h)
 * and reads what a built face serves back against it. The descriptor is the only input: a declaration is
 * rendered to its descriptor by its owner first.
 *
 * The vocabulary below is the extension's: its families, each family's roles with the units a role
 * accepts, and the displays a family draws in closed form. A declaration's role the family has no
 * place for, or whose parameter's unit the role does not take, is not published (a host would drop
 * it and the fingerprint would no longer be what it reads); the generated header names each one.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { meaningOfRole, servedToken } from './vocabulary.mjs';

export const PANEL_ID = 'org.openmixer.panel-description/1';

/** The extension's families, by enum value. */
export const FAMILIES = ['none', 'gate', 'dynamics', 'limiter', 'deesser', 'eq', 'filter', 'drive', 'modulation', 'delay', 'reverb', 'pitch'];

/** The widgets a face serves, by enum value. */
export const WIDGETS = ['auto', 'knob', 'fader', 'switch', 'selector'];

/** The standard widgets a panel picks from a descriptor; a representation (a skin) draws each. */
export const STANDARD_WIDGETS = ['knob', 'fader', 'switch', 'selector', 'meter', 'curve', 'xy', 'display'];
/** What a meter measures. */
export const MEASUREMENTS = ['peak', 'rms', 'vu', 'ppm', 'lufs'];
/** The units a read-only travel is a level meter in, and the measurement a unit itself names. */
const LEVEL_UNITS = ['dB', 'dBFS', 'dBu', 'LUFS'];
const MEASUREMENT_OF_UNIT = { LUFS: 'lufs' };
/** A declared panel's widget names -> the standard widget (`choice` is the older spelling of a selector). */
const DECLARED_WIDGET = { knob: 'knob', fader: 'fader', switch: 'switch', selector: 'selector', choice: 'selector' };
/** A standard widget -> the widget a face serves: a selector is AUTO (it needs CLAP_PARAM_IS_ENUM,
 * which the faces do not set), and so is any widget the extension has no value for. */
const SERVED_WIDGET = { knob: 'knob', fader: 'fader', switch: 'switch' };

/**
 * The standard widget control `c` (a descriptor control) is drawn with: `{ widget }`, a meter's with
 * its `measurement` (null when the descriptor does not state it), a trigger's switch `momentary`. A
 * declared widget wins; else a read-only travel in a level unit is a meter and any other read-only
 * control a display, a toggle or a trigger a switch, a choice a selector, a travel a knob.
 */
export function widgetOf(c, declared) {
  if (declared !== undefined) return { widget: DECLARED_WIDGET[declared] ?? declared };
  if (c.readonly) {
    const unit = c.travel?.unit;
    return LEVEL_UNITS.includes(unit) ? { widget: 'meter', measurement: MEASUREMENT_OF_UNIT[unit] ?? null } : { widget: 'display' };
  }
  if (c.kind === 'toggle') return { widget: 'switch' };
  if (c.kind === 'trigger') return { widget: 'switch', momentary: true };
  if (c.kind === 'choice') return { widget: 'selector' };
  return { widget: 'knob' };
}

/** The widget a face serves for a standard widget. */
export const servedWidget = (standard) => SERVED_WIDGET[standard] ?? 'auto';

/** The display kinds and sources, by enum value. */
export const DISPLAY_KINDS = ['gain_reduction_bar', 'transfer_curve', 'eq_response', 'meter'];
export const DISPLAY_SOURCES = ['family', 'meters', 'gain_adjustment', 'curve'];
export const PLACEMENTS = ['insert', 'return', 'bus', 'master'];

/** A section `graph` -> the display the extension names for it; a graph with none here is the
 * renderer's own (delay taps, a decay envelope, an LFO). */
const DISPLAY_OF_GRAPH = { 'eq-curve': 'eq_response', 'dynamics-curve': 'transfer_curve', 'transfer-curve': 'transfer_curve' };
/** The displays a host computes from a family's roles in closed form. */
const CLOSED_FORMS = { gate: ['transfer_curve'], dynamics: ['transfer_curve'], eq: ['eq_response'], drive: ['transfer_curve'] };

/** A descriptor unit -> the token a role checks it against: the param-contract extension's own table,
 * so a unit it serves is a unit a role can take. A unit it has no token for (`unknown` among them) is
 * a plain number and takes no role. */
export const unitToken = (unit) => servedToken(unit);

const T = ['ms', 's'], LVL = ['db', 'dbfs', 'dbu', 'lufs'], DB = ['db'], FREQ = ['hz', 'khz'], PLAIN = ['none', 'pc', 'coef'], RATIO = ['ratio', 'coef'], CHOICE = ['none'];
const WET = { mix: ['pc', 'coef', 'none'], output: DB };
/** Each family's roles and the units each accepts. */
export const ROLES = {
  none: {},
  gate: { threshold: LVL, range: DB, attack: T, release: T, hold: T, knee_start: DB, knee_end: DB, hysteresis: DB, ratio: RATIO, key_listen: CHOICE },
  dynamics: { threshold: LVL, ratio: RATIO, attack: T, release: T, knee: DB, makeup: DB, lookahead: ['ms'], ...WET },
  limiter: { ceiling: LVL, release: T, lookahead: ['ms'], threshold: LVL, ...WET },
  deesser: { frequency: FREQ, threshold: LVL, range: DB, width: ['oct'], ratio: RATIO, attack: T, release: T, knee: DB, mode: CHOICE, listen: CHOICE, ...WET },
  eq: { band_type: CHOICE, band_freq: FREQ, band_gain: ['db', 'coef'], band_q: ['none', 'coef', 'oct'], band_on: CHOICE, hpf_freq: FREQ, hpf_slope: ['none', 'db'], hpf_on: CHOICE, lpf_freq: FREQ, lpf_slope: ['none', 'db'], lpf_on: CHOICE, output: DB },
  filter: { cutoff: FREQ, resonance: PLAIN, filter_type: CHOICE, ...WET },
  drive: { drive: DB, tone: PLAIN, model: CHOICE, ...WET },
  modulation: { rate: ['hz', 'bpm'], depth: PLAIN, feedback: PLAIN, voices: CHOICE, spread: PLAIN, shape: CHOICE, ...WET },
  delay: { time: T, feedback: PLAIN, tone: PLAIN, sync: CHOICE, division: CHOICE, pingpong: CHOICE, ...WET },
  reverb: { size: PLAIN, decay: T, algorithm: CHOICE, predelay: ['ms'], damping: PLAIN, width: PLAIN, low_cut: FREQ, high_cut: FREQ, ...WET },
  pitch: { shift: ['semitone12TET', 'cent'], fine: ['cent'], ...WET },
};

/** The roles that repeat by index, one control per band: schema/panel.schema.json's `$defs.indexedRole`. */
export const INDEXED_ROLES = JSON.parse(readFileSync(new URL('../schema/panel.schema.json', import.meta.url), 'utf8')).$defs.indexedRole.enum;

/**
 * The meanings each family stands on, in the order inference tries them: `backs`, one of which a
 * declared family needs among its controls' meanings (null: none yet has a word, a rotor's speeds and
 * an LFO's shape have no meaning); `infer`, the sets of meanings any one of which, all present, makes
 * a plugin with no declared panel that family.
 */
export const FAMILY_MEANINGS = {
  limiter: { backs: ['ceiling'], infer: [['ceiling']] },
  deesser: { backs: ['frequency', 'threshold'], infer: [['frequency', 'threshold', 'listen']] },
  gate: { backs: ['threshold'], infer: [['threshold', 'range']] },
  dynamics: { backs: ['threshold', 'ratio'], infer: [['threshold', 'ratio']] },
  eq: { backs: ['gain', 'frequency'], infer: [['frequency', 'gain', 'q']] },
  filter: { backs: ['cutoffFrequency'], infer: [['cutoffFrequency']] },
  drive: { backs: ['drive'], infer: [['drive']] },
  delay: { backs: ['delay'], infer: [['delay', 'feedback']] },
  reverb: { backs: ['size', 'decay'], infer: [['size'], ['decay']] },
  pitch: { backs: ['shift'], infer: [['shift']] },
  modulation: { backs: null, infer: [['rate', 'depth']] },
};

/**
 * The family of a plugin whose controls are `controls` (descriptor controls): `{ family }`, and for a
 * declared family none of its controls' meanings backs, `{ family, needs }` naming what it lacks. With
 * no declared family, an effect takes the first family whose meanings it carries; an instrument, or a
 * plugin no family fits, is none.
 */
export function familyOf(controls, declared, features = []) {
  const have = new Set(controls.map((c) => c.meaning).filter(Boolean));
  if (declared !== undefined) {
    // the declaration's family is one of the extension's (the schema's $defs.family is the same closed
    // set); a family the extension has no place for is none: no house view
    const family = FAMILIES.includes(declared) ? declared : 'none';
    const backs = FAMILY_MEANINGS[family]?.backs;
    return backs && !backs.some((m) => have.has(m)) ? { family, needs: backs } : { family };
  }
  if (features.includes('instrument')) return { family: 'none' };
  for (const [family, { infer }] of Object.entries(FAMILY_MEANINGS)) if (infer.some((all) => all.every((m) => have.has(m)))) return { family };
  return { family: 'none' };
}

/** The roles of `family` that meaning `m` names: each role of the family whose meaning is `m`. */
const rolesOfMeaning = (family, m) => Object.keys(ROLES[family]).filter((role) => meaningOfRole(role) === m);

const KEY = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;
const KEY_MAX = 63, LABEL_MAX = 255;

/** camelCase -> snake_case, the key grammar's spelling of a symbol or section key. */
export const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

/** A free text (a group's name) in the key grammar: snake_case, any other character an underscore. */
const keyOfText = (s) => {
  const k = snake(s).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(k) ? k : `s_${k}`;
};

/** The key a layout names a control by: its symbol, else an LV2 control's id (its port symbol), else its name. */
export const keyOf = (c) => c.symbol ?? (typeof c.id === 'string' ? c.id : c.name);

/** The ports a layout carries: the audio inputs and outputs with their channels, the side-chain, the notes in. */
function portsOf(ports = []) {
  const audio = (direction) => ports.filter((p) => p.kind === 'audio' && p.direction === direction).map((p) => ({ id: p.id, name: p.name, role: p.role ?? 'main', channels: p.channels ?? null }));
  return { inputs: audio('in'), outputs: audio('out'), sidechain: ports.some((p) => p.kind === 'audio' && p.direction === 'in' && p.role === 'sidechain'), notes: ports.some((p) => (p.kind === 'note' || p.kind === 'midi') && p.direction === 'in') };
}

/**
 * The panel of `descriptor`, of any origin. `panel` (a declaration's) gives the family, sections,
 * order, roles, widgets and graphs; with none, the sections are the controls' groups, the family the
 * one their meanings make and the roles the ones their meanings play. `ns` is the label-key namespace
 * (without one the label keys are null); `choiceUnits` and `byKind` are a declaration's extras.
 */
export function panelLayout(descriptor, { panel, ns, where = `descriptor ${descriptor.plugin?.id}`, choiceUnits = {}, byKind = {} } = {}) {
  const all = descriptor.controls;
  const byKey = new Map(all.map((c, i) => [keyOf(c), i]));
  const control = (sym) => all[byKey.get(sym)];
  const unitOf = (c) => c.travel?.unit ?? choiceUnits[keyOf(c)] ?? '';
  const key = (k, what) => {
    if (!KEY.test(k) || k.length > KEY_MAX) throw new Error(`${where}: ${what} '${k}' is not a key of ${PANEL_ID} ([a-z][a-z0-9_]*, dotted, at most ${KEY_MAX} bytes)`);
    return k;
  };
  const labelKey = (k, what) => (ns ? key(`${ns}.${k}`, what) : null);
  const label = (s, what) => {
    if (Buffer.byteLength(s) > LABEL_MAX) throw new Error(`${where}: ${what} label is longer than ${LABEL_MAX} bytes`);
    return s;
  };

  const { family, needs } = familyOf(all, panel ? panel.family : undefined, descriptor.plugin?.features);
  // a declared family stands on its controls' meanings: a transient designer is no compressor
  if (needs) {
    const have = [...new Set(all.map((c) => c.meaning).filter(Boolean))];
    throw new Error(`${where}: the ${family} family needs a control meaning ${needs.join(' or ')}, and its meanings are ${have.join(', ') || 'none'}: its family is none`);
  }

  // the sections, each with the controls it lists: the declared panel's, else one per group path
  let listed;
  if (panel) listed = panel.sections.map((s) => ({ key: snake(s.key), label: s.label, controls: s.controls, graph: s.graph }));
  else {
    const groups = new Map();
    for (const c of all) {
      if (c.hidden) continue;
      const path = c.group?.length ? c.group : ['Controls'];
      const k = path.map(keyOfText).join('.');
      if (!groups.has(k)) groups.set(k, { key: k, label: path.join(' / '), controls: [] });
      groups.get(k).controls.push(keyOf(c));
    }
    listed = [...groups.values()];
  }
  const sections = listed.map((s) => {
    const k = key(s.key, 'section key');
    return { key: k, labelKey: labelKey(`section.${k}`, 'section label key'), label: label(s.label, `section '${s.key}'`) };
  });
  if (new Set(sections.map((s) => s.key)).size !== sections.length) throw new Error(`${where}: two panel sections share a key`);

  const seen = new Set();
  const controls = listed.flatMap((s, section) =>
    s.controls.map((sym) => {
      const c = control(sym);
      if (!c) throw new Error(`${where}: panel section '${s.key}' lists '${sym}', no parameter`);
      if (seen.has(sym)) throw new Error(`${where}: '${sym}' is a control twice`);
      seen.add(sym);
      const standard = widgetOf(c, panel?.widgets?.[sym]);
      if (standard.widget === 'switch' && c.kind !== 'toggle' && c.kind !== 'trigger') throw new Error(`${where}: '${sym}' is drawn as a switch and is not a toggle`);
      return {
        symbol: sym, param: c.id, section, sectionKey: sections[section].key, widget: servedWidget(standard.widget), standard,
        labelKey: labelKey(snake(sym), 'control label key'), label: label(c.label ?? c.name, `'${sym}'`), visible: null, mask: 0n,
        unit: unitOf(c), meaning: c.meaning ?? null,
      };
    }),
  );

  const table = ROLES[family];
  const roles = [], unpublished = [];
  const bind = (role, index, sym) => {
    const c = control(sym);
    if (!c) throw new Error(`${where}: role '${role}' names '${sym}', no parameter`);
    const unit = unitOf(c);
    if (!table[role]) unpublished.push({ role, symbol: sym, why: `not a role of the ${family} family` });
    else if (!table[role].includes(unitToken(unit))) unpublished.push({ role, symbol: sym, why: `the ${role} role takes ${table[role].join(', ')}, not ${unit || 'no unit'}` });
    else roles.push({ role, index, symbol: sym, param: c.id, unit });
  };
  if (panel) {
    // an indexed role (an EQ band's) names every band's symbol in order: one row per band, its index the band's
    for (const [role, syms] of Object.entries(panel.roles ?? {})) [syms].flat().forEach((sym, index) => bind(role, index, sym));
  } else {
    // each meaning plays the one role of the family it names; an indexed role takes every control of
    // its meaning, any other its first, and a second is named
    const played = new Map();
    for (const c of all) {
      if (c.hidden || c.readonly || !c.meaning) continue;
      const named = rolesOfMeaning(family, c.meaning);
      if (named.length !== 1) continue;
      const [role] = named;
      const n = played.get(role) ?? 0;
      if (n && !INDEXED_ROLES.includes(role)) unpublished.push({ role, symbol: keyOf(c), why: `the ${role} role is played by ${roles.find((r) => r.role === role)?.symbol ?? 'another control'}` });
      else bind(role, n, keyOf(c));
      played.set(role, n + 1);
    }
  }

  const displays = listed.flatMap((s, section) => {
    const kind = DISPLAY_OF_GRAPH[s.graph];
    if (!kind) return [];
    if (!CLOSED_FORMS[family]?.includes(kind)) throw new Error(`${where}: section '${s.key}' draws ${s.graph}, and the ${family} family has no ${kind} a host computes`);
    return [{ kind, section, sectionKey: sections[section].key, source: 'family', meters: [null, null], curve: null, floor: null, labelKey: labelKey(`display.${kind}`, 'display label key'), label: label(s.label, `section '${s.key}'`) }];
  });

  // the contract's per-kind defaults: each channel kind the placement it is, the value inside the travel
  const defaults = all.flatMap((c, i) =>
    Object.entries(byKind[keyOf(c)] ?? {}).map(([kind, value]) => {
      const placement = PLACEMENT_OF_KIND[kind];
      if (!placement) throw new Error(`${where}: '${keyOf(c)}' comes up differently on a ${kind} channel, which has no placement of ${PANEL_ID}; add it to PLACEMENT_OF_KIND`);
      const [min, max] = c.travel ? [c.travel.min, c.travel.max] : c.values ? [Math.min(...c.values), Math.max(...c.values)] : [0, 1];
      const integer = c.kind !== 'travel' || c.travel.step === 1;
      if (!(value >= min && value <= max) || (integer && !Number.isInteger(value))) throw new Error(`${where}: '${keyOf(c)}' on ${kind} comes up at ${value}, outside its travel`);
      return { placement, symbol: keyOf(c), param: i, value };
    }),
  );

  return { origin: descriptor.origin, family, sections, controls, roles, unpublished, displays, defaults, ports: portsOf(descriptor.ports) };
}

/** A channel kind whose default a contract travel states (byKind) -> the placement it is. */
const PLACEMENT_OF_KIND = { fxReturn: 'return', main: 'master' };

/** The surface's slots per page, CLAP_REMOTE_CONTROLS_COUNT. */
export const PAGE_SIZE = 8;

/** The pages of clap.remote-controls/2 by the page rule: each section's controls in order, cut into
 * pages of eight, a section of several pages numbering them; a short page's slots are null. */
export function pagesOf(x) {
  return x.sections.flatMap((s, section) => {
    const ids = x.controls.filter((c) => c.section === section).map((c) => c.param);
    const count = Math.ceil(ids.length / PAGE_SIZE);
    return [...Array(count).keys()].map((k) => {
      const slots = ids.slice(k * PAGE_SIZE, (k + 1) * PAGE_SIZE);
      while (slots.length < PAGE_SIZE) slots.push(null);
      return { section, sectionName: s.label, pageName: count > 1 ? `${s.label} ${k + 1}` : s.label, ids: slots };
    });
  });
}

/** The shortest decimal that round-trips to the same binary64, -0 written 0. */
const shortest = (n) => (Object.is(n, -0) ? '0' : String(n));
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The canonical serialisation: UTF-8, LF after every line, TAB-separated, parameters by symbol, the
 * fallback labels left out. */
export function panelCanonical(x) {
  const lines = [PANEL_ID, `family\t${x.family}`];
  x.sections.forEach((s, i) => lines.push(['section', i, s.key, s.labelKey].join('\t')));
  for (const c of x.controls) lines.push(['control', c.symbol, c.sectionKey, c.widget, c.labelKey, c.visible ?? '-', c.mask.toString(16)].join('\t'));
  for (const r of [...x.roles].sort((a, b) => byCodeUnit(a.role, b.role) || a.index - b.index)) lines.push(['role', r.role, r.index, r.symbol].join('\t'));
  for (const v of x.displays) {
    const floor = v.floor === null ? '-' : typeof v.floor === 'number' ? shortest(v.floor) : v.floor;
    const meter = (m) => (m === null ? '-' : String(m));
    lines.push(['display', v.kind, v.sectionKey, v.source, meter(v.meters[0]), meter(v.meters[1]), v.curve ?? '-', floor, v.labelKey].join('\t'));
  }
  const order = (p) => PLACEMENTS.indexOf(p);
  for (const p of [...x.defaults].sort((a, b) => order(a.placement) - order(b.placement) || byCodeUnit(a.symbol, b.symbol))) lines.push(['default', p.placement, p.symbol, shortest(p.value)].join('\t'));
  return `${lines.join('\n')}\n`;
}

/** The fingerprint: lowercase hex SHA-256 of the canonical serialisation. */
export const panelFingerprint = (x) => createHash('sha256').update(panelCanonical(x)).digest('hex');
