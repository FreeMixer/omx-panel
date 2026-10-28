// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * group-infer.mjs — the port groups an LV2 plugin lacks, inferred from what it already states
 * (docs/group-inference.md; plugin-hostd#218, lane G1). Pure: a plugin's parsed ports, and its MOD GUI
 * layout when it has one, in; a verdict out. Nothing here reads or writes a bundle beyond the two
 * readers that turn parsed Turtle triples (tools/turtle-read.mjs) into those inputs.
 *
 * The rules run in this order, each over the controls no earlier rule placed; a placed control is never
 * moved by a later rule:
 *   1 the plugin's own pg:group assignments, partial or whole;
 *   2 lv2:designation (the LV2 parameters vocabulary: envelope, dynamics, filter, oscillator, output);
 *   3 a shared name or symbol prefix ("Band 1 ..." / `b1_`), or a shared trailing number ("Gain 1",
 *     "Freq 1": one group per number);
 *   4 a shared units:unit;
 *   5 a contiguous run of lv2:index;
 *   6 the plugin's own MOD GUI layout: the controls on its face, and the ones it leaves off.
 *
 * The verdict is one of:
 *   { outcome: 'nothing-to-do', reason }        the plugin is left exactly as it is;
 *   { outcome: 'grouped', groups, placedBy }     every group with lv2:symbol, lv2:name, lv2:displayPriority
 *                                                and its member ports BY SYMBOL (never by blank node);
 *   { outcome: 'no-confident-grouping', reason, detail, attempt }
 *                                                the plugin is left exactly as it is; `attempt` is what the
 *                                                rules found, for a diagnosis only.
 */

const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const LV2 = 'http://lv2plug.in/ns/lv2core#';
const PG = 'http://lv2plug.in/ns/ext/port-groups#';
const UNITS = 'http://lv2plug.in/ns/extensions/units#';
const PPROPS = 'http://lv2plug.in/ns/ext/port-props#';
const PARAM = 'http://lv2plug.in/ns/ext/parameters#';
const TIME = 'http://lv2plug.in/ns/ext/time#';
const MODGUI = 'http://moddevices.com/ns/modgui#';

// ---------------------------------------------------------------------------------------------------------------
// Confidence: the thresholds, each with why.

/**
 * Controls one screen of the Zynthian touchscreen shows. A plugin with this many placeable controls or fewer
 * already fits one screen, so groups would not change what the operator sees: nothing to do.
 */
export const SCREEN_SIZE = 4;

/**
 * The smallest group the rules may make. A group of one is a screen with one control: worse than port order,
 * which at least fills the screen. The plugin's OWN groups (rule 1) are exempt: what the plugin states is kept.
 */
export const MIN_GROUP_SIZE = 2;

/**
 * Controls a confident grouping may leave unplaced. Zero: an unplaced control falls into the consumer's catch-all
 * ("Params" on the touchscreen) beside our groups, which is a layout nobody inferred. Every control is placed, or
 * the plugin is left alone.
 */
export const MAX_UNPLACED = 0;

/**
 * At least two groups. One group holding every control is what the plugin shows today with a title on top.
 */
export const MIN_GROUPS = 2;

/**
 * At most this many groups. A group is at least one screen; the widest plugin grouped by band that we know
 * (a 32-band equaliser: omx-eq32) needs 32. Beyond that the rules are slicing something that is not a set of
 * sections (a long step sequencer, a matrix), and port order is the safer layout.
 */
export const MAX_GROUPS = 32;

/**
 * The share of controls rule 5 (a contiguous run of lv2:index) may place. Index runs carry no meaning of their
 * own: they only fill the gaps between groups the plugin's words (rules 1-4, 6) found. When the gaps are most of
 * the plugin, the "grouping" is port order cut at arbitrary points: not confident.
 */
export const MAX_INDEX_RUN_SHARE = 0.5;

/**
 * Designations the host drives, never shown as a control on a screen: they need no group and do not count as
 * placeable. lv2:enabled is the touchscreen's bypass (zynthian_lv2.py reads it as such).
 */
export const HOST_DESIGNATIONS = new Set([
  `${LV2}enabled`,
  `${LV2}freeWheeling`,
  `${LV2}latency`,
  `${LV2}control`,
  `${PARAM}bypass`,
  `${PARAM}sampleRate`,
  `${TIME}beatsPerMinute`,
  `${TIME}beatsPerBar`,
  `${TIME}bar`,
  `${TIME}beat`,
  `${TIME}barBeat`,
  `${TIME}speed`,
  `${TIME}frame`,
  `${TIME}framesPerSecond`,
]);

/** Rule 2: what each designation (the LV2 parameters vocabulary) says a control belongs to. */
const DESIGNATION_GROUP = {
  [`${PARAM}attack`]: 'envelope',
  [`${PARAM}decay`]: 'envelope',
  [`${PARAM}sustain`]: 'envelope',
  [`${PARAM}release`]: 'envelope',
  [`${PARAM}hold`]: 'envelope',
  [`${PARAM}delay`]: 'envelope',
  [`${PARAM}threshold`]: 'dynamics',
  [`${PARAM}ratio`]: 'dynamics',
  [`${PARAM}cutoffFrequency`]: 'filter',
  [`${PARAM}resonance`]: 'filter',
  [`${PARAM}waveform`]: 'oscillator',
  [`${PARAM}pulseWidth`]: 'oscillator',
  [`${PARAM}frequency`]: 'oscillator',
  [`${PARAM}amplitude`]: 'oscillator',
  [`${PARAM}gain`]: 'output',
  [`${PARAM}wetLevel`]: 'output',
  [`${PARAM}dryLevel`]: 'output',
  [`${PARAM}wetDryRatio`]: 'output',
};
const DESIGNATION_NAMES = { envelope: 'Envelope', dynamics: 'Dynamics', filter: 'Filter', oscillator: 'Oscillator', output: 'Output' };
/** In a plugin with a threshold or a ratio, attack, release and hold are the detector's, not an envelope's. */
const DYNAMICS_ALSO = new Set([`${PARAM}attack`, `${PARAM}release`, `${PARAM}hold`]);

/** Rule 4: a unit's group name; any other unit is named by its rdfs:label, else its IRI's last segment. */
const UNIT_NAMES = {
  hz: 'Frequency',
  khz: 'Frequency',
  mhz: 'Frequency',
  db: 'Level',
  ms: 'Time',
  s: 'Time',
  min: 'Time',
  bpm: 'Tempo',
  beat: 'Time',
  bar: 'Time',
  pc: 'Amount',
  coef: 'Amount',
  degree: 'Phase',
  semitone12TET: 'Pitch',
  cent: 'Tuning',
  oct: 'Pitch',
  midiNote: 'Note',
  frame: 'Time',
};

/** Rule 3: a word that names a numbered section; "Section 1" names the group of every control numbered 1. */
// Only words that name a section and never a parameter: "Delay 1" or "Filter 1" may be one control of section 1.
export const SECTION_WORDS = new Set([
  'band', 'section', 'channel', 'ch', 'osc', 'oscillator', 'voice', 'step', 'tap', 'stage', 'lfo', 'env', 'envelope',
  'part', 'layer', 'op', 'operator',
]);

export const RULES = [
  { n: 1, name: 'own pg:group', run: ruleOwnGroups },
  { n: 2, name: 'lv2:designation', run: ruleDesignation },
  { n: 3, name: 'name or symbol prefix', run: rulePrefix },
  { n: 4, name: 'units:unit', run: ruleUnit },
  { n: 5, name: 'contiguous lv2:index', run: ruleIndexRun },
  { n: 6, name: 'MOD GUI layout', run: ruleModgui },
];

// ---------------------------------------------------------------------------------------------------------------
// The inference.

/**
 * @typedef {{ symbol: string, name: string, index: number, control: boolean, input: boolean,
 *   designation?: string, unit?: string, unitLabel?: string, group?: string, notOnGui?: boolean }} Port
 * @typedef {{ symbol?: string, name?: string, displayPriority?: number }} OwnGroup
 * @typedef {{ uri: string, ports: Port[], groups?: Record<string, OwnGroup> }} PluginPorts
 * @typedef {{ ports: { symbol: string, index: number, name?: string }[] }} ModguiLayout
 * @typedef {{ symbol: string, name: string, displayPriority: number, ports: string[], rule: number, node?: string }} Group
 */

/** The controls a screen shows: control inputs, not host-driven, not marked notOnGUI. In lv2:index order. */
export function placeableControls(ports) {
  return ports
    .filter((p) => p.control && p.input && !p.notOnGui && !(p.designation && HOST_DESIGNATIONS.has(p.designation)))
    .sort((a, b) => a.index - b.index);
}

/**
 * Infer `plugin`'s port groups. `modgui` is the plugin's own MOD GUI layout, or null when it has none.
 * @param {PluginPorts} plugin
 * @param {ModguiLayout | null} [modgui]
 * @param {{ rules?: typeof RULES, prefixPasses?: typeof PREFIX_PASSES }} [options] another rule order, or another
 *   order of rule 3's passes (the orders are the contract: tests only)
 */
export function inferGroups(plugin, modgui = null, options = {}) {
  const controls = placeableControls(plugin.ports);
  const ownGroups = plugin.groups ?? {};
  if (controls.length === 0) return { outcome: 'nothing-to-do', reason: 'no-controls' };
  if (controls.every((p) => p.group !== undefined && typeof ownGroups[p.group]?.symbol === 'string')) {
    return { outcome: 'nothing-to-do', reason: 'own-groups-complete' };
  }
  if (controls.length <= SCREEN_SIZE && controls.every((p) => p.group === undefined)) {
    return { outcome: 'nothing-to-do', reason: 'fits-one-screen' };
  }

  const state = {
    plugin,
    modgui,
    controls,
    prefixPasses: options.prefixPasses,
    /** @type {Map<string, number>} symbol -> the rule that placed it */
    placedBy: new Map(),
    /** @type {{ key: string, name: string, ports: Port[], rule: number, node?: string, own?: OwnGroup, stated?: OwnGroup }[]} */
    groups: [],
  };
  for (const rule of options.rules ?? RULES) rule.run(state, rule.n);

  const groups = finish(state);
  const unplaced = controls.filter((p) => !state.placedBy.has(p.symbol)).map((p) => p.symbol);
  const placedBy = Object.fromEntries([...state.placedBy].sort((a, b) => indexOf(state, a[0]) - indexOf(state, b[0])));
  const attempt = { groups, unplaced, placedBy };
  const refuse = (reason, detail) => ({ outcome: 'no-confident-grouping', reason, detail, attempt });

  if (unplaced.length > MAX_UNPLACED) return refuse('unplaced-controls', `${unplaced.length} control(s) in no group: ${unplaced.join(', ')}`);
  const lone = groups.find((g) => g.rule !== 1 && g.ports.length < MIN_GROUP_SIZE);
  if (lone) return refuse('group-of-one', `group ${lone.symbol} holds ${lone.ports.length}`);
  if (groups.length < MIN_GROUPS) return refuse('too-few-groups', `${groups.length} group(s)`);
  if (groups.length > MAX_GROUPS) return refuse('too-many-groups', `${groups.length} groups, at most ${MAX_GROUPS}`);
  const byIndex = controls.filter((p) => state.placedBy.get(p.symbol) === 5).length;
  if (byIndex > MAX_INDEX_RUN_SHARE * controls.length) {
    return refuse('mostly-by-index', `${byIndex} of ${controls.length} controls placed only by a contiguous lv2:index run`);
  }
  return { outcome: 'grouped', groups, placedBy };
}

const indexOf = (state, symbol) => state.controls.find((p) => p.symbol === symbol)?.index ?? Infinity;
const unplacedOf = (state) => state.controls.filter((p) => !state.placedBy.has(p.symbol));

/** Place `ports` in a new group (or in `into`, an existing one). */
function place(state, rule, { key, name, node, own, stated }, ports, into) {
  const g = into ?? { key, name, ports: [], rule, node, own, stated };
  for (const p of ports) {
    g.ports.push(p);
    state.placedBy.set(p.symbol, rule);
  }
  if (!into) state.groups.push(g);
  return g;
}

/** A class of controls that would be every control is no grouping at all. */
const isEverything = (state, ports) => ports.length >= state.controls.length;

/**
 * The groups as the verdict states them: symbols unique, ports by index, groups in port order. Display priority:
 * when every group the plugin states itself carries an lv2:displayPriority, those keep theirs and the generated ones
 * follow below the lowest, in port order; otherwise all count down from the number of groups, in port order.
 */
function finish(state) {
  const ordered = state.groups
    .map((g) => ({ ...g, ports: [...g.ports].sort((a, b) => a.index - b.index) }))
    .sort((a, b) => (a.ports[0]?.index ?? Infinity) - (b.ports[0]?.index ?? Infinity));
  const ownPriority = (g) => (g.rule === 1 ? g.stated?.displayPriority : undefined);
  const own = ordered.filter((g) => g.rule === 1);
  const keepOwn = own.length > 0 && own.every((g) => Number.isInteger(ownPriority(g)));
  let next = keepOwn ? Math.min(...own.map(ownPriority)) - 1 : ordered.length;
  const priorities = ordered.map((g) => (keepOwn && g.rule === 1 ? ownPriority(g) : next--));
  const taken = new Set();
  const names = new Set();
  return ordered.map((g, i) => {
    let symbol = g.own?.symbol ?? lv2Symbol(g.key);
    for (let k = 2; taken.has(symbol); k++) symbol = `${lv2Symbol(g.key)}_${k}`;
    taken.add(symbol);
    let name = g.name;
    for (let k = 2; names.has(name); k++) name = `${g.name} ${k}`;
    names.add(name);
    /** @type {Group} */
    const out = { symbol, name, displayPriority: priorities[i], ports: g.ports.map((p) => p.symbol), rule: g.rule };
    if (g.node !== undefined) out.node = g.node;
    return out;
  });
}

/** A valid lv2:symbol ([_a-zA-Z][_a-zA-Z0-9]*) from any text. */
export function lv2Symbol(text) {
  const s = String(text).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return s === '' ? 'group' : /^[0-9]/.test(s) ? `g_${s}` : s;
}

/** "filt_env" -> "Filt Env", for a group the plugin names by symbol only. */
const humanize = (s) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();

// ---------------------------------------------------------------------------------------------------------------
// The rules. Each sees only unplaced controls and never moves a placed one.

/** 1: the plugin's own pg:group assignments. The plugin's node, symbol, name and priority are kept. */
function ruleOwnGroups(state, rule) {
  const own = state.plugin.groups ?? {};
  const byNode = new Map();
  for (const p of unplacedOf(state)) {
    if (p.group === undefined) continue;
    if (!byNode.has(p.group)) byNode.set(p.group, []);
    byNode.get(p.group).push(p);
  }
  for (const [node, ports] of byNode) {
    const info = own[node] ?? {};
    const tail = node.replace(/[/#]+$/, '').split(/[/#:]/).pop() ?? 'group';
    const symbol = info.symbol ?? lv2Symbol(tail);
    place(state, rule, { key: symbol, name: info.name ?? humanize(symbol), node, own: info.symbol ? info : undefined, stated: info }, ports);
  }
}

/** 2: lv2:designation, through the parameters vocabulary. */
function ruleDesignation(state, rule) {
  const all = state.controls;
  const dynamics = all.some((p) => p.designation === `${PARAM}threshold` || p.designation === `${PARAM}ratio`);
  const classes = new Map();
  for (const p of unplacedOf(state)) {
    let kind = p.designation ? DESIGNATION_GROUP[p.designation] : undefined;
    if (kind === undefined) continue;
    if (dynamics && DYNAMICS_ALSO.has(p.designation)) kind = 'dynamics';
    if (!classes.has(kind)) classes.set(kind, []);
    classes.get(kind).push(p);
  }
  for (const [kind, ports] of classes) {
    if (ports.length >= MIN_GROUP_SIZE && !isEverything(state, ports)) place(state, rule, { key: kind, name: DESIGNATION_NAMES[kind] }, ports);
  }
}

/** A name's words: bracketed text dropped, split at punctuation, spaces and letter-digit boundaries. */
export function nameTokens(name) {
  return String(name)
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .split(/[^\p{L}\p{N}#]+/u)
    .flatMap((w) => w.split(/(?<=\p{L})(?=\p{N})|(?<=\p{N})(?=\p{L})/u))
    .filter(Boolean);
}

/** A symbol's words: split at `_`, `-`, a lower-to-upper case change and letter-digit boundaries. */
export function symbolTokens(symbol) {
  return String(symbol)
    .split(/[_\-.]+/)
    .flatMap((w) => w.split(/(?<=[a-z])(?=[A-Z])|(?<=\p{L})(?=\p{N})|(?<=\p{N})(?=\p{L})/u))
    .filter(Boolean);
}

const isNumber = (t) => /^\p{N}+$/u.test(t);

/**
 * The leading key of a token list: its first word, or its first two when the second is a number and more follows
 * ("Band 1 Freq" -> "band 1"); none when nothing would remain after the key (a name of one word has no prefix).
 */
function leadingKey(tokens) {
  if (tokens.length >= 3 && isNumber(tokens[1])) return { key: tokens.slice(0, 2).join(' ').toLowerCase(), words: tokens.slice(0, 2) };
  if (tokens.length >= 2) return { key: tokens[0].toLowerCase(), words: tokens.slice(0, 1) };
  return null;
}

const TOKENS = { name: (p) => nameTokens(p.name), symbol: (p) => symbolTokens(p.symbol) };
const PASSES = { trailing: trailingNumber, leading: leadingWord };

/**
 * Rule 3's passes, in order. The symbol's trailing number comes first: a symbol numbers a band the same way on every
 * control (`xs_9`, `g_9`), where a name may print its frequency ("Band gain 1K", "31.5") and number nothing.
 */
export const PREFIX_PASSES = [
  ['symbol', 'trailing'],
  ['name', 'trailing'],
  ['name', 'leading'],
  ['symbol', 'leading'],
];

/** 3: a shared trailing number (one group per number), then a shared leading word, in PREFIX_PASSES order. */
function rulePrefix(state, rule) {
  for (const [source, pass] of state.prefixPasses ?? PREFIX_PASSES) PASSES[pass](state, rule, TOKENS[source]);
}

/**
 * Controls whose last word is their only number ("Gain 1", "Freq 1", `gain1`) are one group per number, when the
 * plugin repeats the pattern: at least two numbers, each on at least MIN_GROUP_SIZE controls. A stem is numbered
 * only when its whole pattern is: every control whose word after the stem starts with a digit ("Band gain 16",
 * "Band gain 1K", "Band gain 31.5") lands in a numbered group, or the pass places none of that stem's controls.
 */
function trailingNumber(state, rule, tokensOf) {
  const left = unplacedOf(state).map((p) => ({ p, t: tokensOf(p).map((w) => w.toLowerCase()) }));
  let members = [];
  for (const { p, t } of left) {
    if (t.length < 2 || !isNumber(t[t.length - 1]) || t.slice(0, -1).some(isNumber)) continue;
    members.push({ p, n: String(Number(t[t.length - 1])), stem: tokensOf(p).slice(0, -1) });
  }
  const stemKey = (m) => m.stem.join(' ').toLowerCase();
  let repeated;
  for (;;) {
    const classes = new Map();
    for (const m of members) {
      if (!classes.has(m.n)) classes.set(m.n, []);
      classes.get(m.n).push(m);
    }
    repeated = [...classes].filter(([, ms]) => ms.length >= MIN_GROUP_SIZE);
    const inRepeated = new Set(repeated.flatMap(([, ms]) => ms.map((m) => m.p.symbol)));
    // A stem whose pattern some control breaks (a singleton number, a "1K", a "31.5") is dropped whole.
    const broken = new Set();
    for (const stem of new Set(members.map(stemKey))) {
      const words = stem.split(' ');
      const sharers = left.filter(({ t }) => t.length > words.length && words.every((w, i) => t[i] === w) && /^\p{N}/u.test(t[words.length]));
      if (sharers.some(({ p }) => !inRepeated.has(p.symbol))) broken.add(stem);
    }
    if (broken.size === 0) break;
    members = members.filter((m) => !broken.has(stemKey(m)));
  }
  if (repeated.length < 2) return;
  for (const [n, ms] of repeated) {
    // the section word may be in the names when the pass numbered the symbols (fil4: `sec1` is "Section 1")
    const stems = ms.flatMap((m) => [m.stem, nameTokens(m.p.name).slice(0, -1), symbolTokens(m.p.symbol).slice(0, -1)]);
    const section = stems.find((s) => s.length === 1 && SECTION_WORDS.has(s[0].toLowerCase()));
    const word = section ? capitalize(section[0]) : 'Group';
    place(state, rule, { key: `${word} ${n}`, name: `${word} ${n}` }, ms.map((m) => m.p));
  }
}

const capitalize = (w) => (w === w.toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w);

/**
 * Controls that share a leading key form a group; a control whose whole name is that key joins it ("Highpass"
 * beside "Highpass Frequency"). A key every member of an EARLIER group shares adds its controls to that group
 * instead (rule 2's "VCF Freq", "VCF Reso" take "VCF Env"), so one section is not cut in two.
 */
function leadingWord(state, rule, tokensOf) {
  const classes = new Map();
  const whole = new Map();
  for (const p of unplacedOf(state)) {
    const t = tokensOf(p);
    const k = leadingKey(t);
    if (k) {
      if (!classes.has(k.key)) classes.set(k.key, { words: k.words, ports: [] });
      classes.get(k.key).ports.push(p);
    } else if (t.length > 0) {
      const key = t.join(' ').toLowerCase();
      if (!whole.has(key)) whole.set(key, []);
      whole.get(key).push(p);
    }
  }
  for (const [key, c] of classes) c.ports.push(...(whole.get(key) ?? []));

  // An earlier group whose members all share one key; a key two earlier groups share names neither.
  const groupKey = new Map();
  for (const g of state.groups) {
    const keys = new Set(g.ports.map((p) => leadingKey(tokensOf(p))?.key ?? null));
    const [only] = keys;
    if (keys.size === 1 && only !== null) groupKey.set(only, groupKey.has(only) ? null : g);
  }
  for (const [key, c] of classes) {
    const into = groupKey.get(key);
    if (into) {
      place(state, rule, {}, c.ports, into);
      continue;
    }
    if (c.ports.length < MIN_GROUP_SIZE || isEverything(state, c.ports)) continue;
    const name = c.words.map(capitalize).join(' ');
    place(state, rule, { key: name, name }, c.ports);
  }
}

/** 4: a shared units:unit. */
function ruleUnit(state, rule) {
  const classes = new Map();
  for (const p of unplacedOf(state)) {
    if (p.unit === undefined) continue;
    if (!classes.has(p.unit)) classes.set(p.unit, []);
    classes.get(p.unit).push(p);
  }
  for (const [unit, ports] of classes) {
    if (ports.length < MIN_GROUP_SIZE || isEverything(state, ports)) continue;
    const tail = unit.split(/[#/]/).pop() ?? unit;
    const name = (unit.startsWith(UNITS) ? UNIT_NAMES[tail] : undefined) ?? ports[0].unitLabel ?? humanize(tail);
    place(state, rule, { key: name, name }, ports);
  }
}

/**
 * 5: a run of controls next to each other in lv2:index order (other ports between them do not break a run), none
 * placed. A run at the very start is "General", any other "More".
 */
function ruleIndexRun(state, rule) {
  const runs = [];
  let run = [];
  for (const p of state.controls) {
    if (state.placedBy.has(p.symbol)) {
      if (run.length) runs.push(run);
      run = [];
    } else run.push(p);
  }
  if (run.length) runs.push(run);
  for (const r of runs) {
    if (r.length < MIN_GROUP_SIZE || isEverything(state, r)) continue;
    const name = r[0] === state.controls[0] ? 'General' : 'More';
    place(state, rule, { key: name, name }, r);
  }
}

/** 6: the plugin's own MOD GUI: the controls its face shows are "Main", the ones it leaves off "More". */
function ruleModgui(state, rule) {
  if (!state.modgui) return;
  const face = new Map(state.modgui.ports.map((p) => [p.symbol, p.index]));
  const left = unplacedOf(state);
  const on = left.filter((p) => face.has(p.symbol)).sort((a, b) => (face.get(a.symbol) ?? 0) - (face.get(b.symbol) ?? 0));
  const off = left.filter((p) => !face.has(p.symbol));
  for (const [name, ports] of [['Main', on], ['More', off]]) {
    if (ports.length >= MIN_GROUP_SIZE && !isEverything(state, ports)) place(state, rule, { key: name, name }, ports);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The readers: parsed Turtle triples (tools/turtle-read.mjs, or modgui-import's readBundle) in, the inputs out.

const termKey = (t) => (t.t === 'bnode' ? `_:${t.v}` : t.v);

function index(triples) {
  const bySubject = new Map();
  for (const t of triples) {
    const k = termKey(t.s);
    if (!bySubject.has(k)) bySubject.set(k, []);
    bySubject.get(k).push(t);
  }
  const all = (s, p) => (bySubject.get(s) ?? []).filter((t) => t.p.v === p).map((t) => t.o);
  return { all, one: (s, p) => all(s, p)[0] };
}

/** A literal in no language or in English, before any other. */
function plainLiteral(terms) {
  const lits = terms.filter((t) => t.t === 'lit');
  return (lits.find((t) => !t.lang) ?? lits.find((t) => /^en\b/i.test(t.lang ?? '')) ?? lits[0])?.v;
}

/**
 * The plugins the triples describe, by URI: every subject typed lv2:Plugin, or carrying an indexed lv2:port (a plugin's own
 * file read without its bundle's manifest, which is where some bundles, LSP's, state the type).
 */
export function pluginUris(triples) {
  // a preset carries lv2:port too, but its ports state values, never an lv2:index
  const indexed = new Set(triples.filter((t) => t.p.v === `${LV2}index`).map((t) => termKey(t.s)));
  const isPlugin = (t) =>
    t.s.t === 'iri' && ((t.p.v === `${RDF}type` && t.o.v === `${LV2}Plugin`) || (t.p.v === `${LV2}port` && indexed.has(termKey(t.o))));
  return [...new Set(triples.filter(isPlugin).map((t) => t.s.v))].sort();
}

/**
 * The ports of plugin `uri` as the rules read them, and the plugin's own group nodes.
 * @returns {PluginPorts}
 */
export function readPluginPorts(triples, uri) {
  const { all, one } = index(triples);
  const groups = {};
  const ports = all(uri, `${LV2}port`).map((node) => {
    const k = termKey(node);
    const types = new Set(all(k, `${RDF}type`).map((t) => t.v));
    const val = (p) => one(k, p);
    const idx = Number(val(`${LV2}index`)?.v);
    const symbol = val(`${LV2}symbol`)?.v;
    /** @type {Port} */
    const port = {
      symbol: symbol ?? '',
      name: plainLiteral(all(k, `${LV2}name`)) ?? symbol ?? '',
      index: Number.isInteger(idx) ? idx : -1,
      control: types.has(`${LV2}ControlPort`),
      input: types.has(`${LV2}InputPort`),
    };
    const designation = val(`${LV2}designation`);
    if (designation?.t === 'iri') port.designation = designation.v;
    const unit = val(`${UNITS}unit`);
    if (unit && unit.t !== 'lit') {
      port.unit = termKey(unit);
      const label = plainLiteral(all(termKey(unit), `${RDFS}label`)) ?? plainLiteral(all(termKey(unit), `${UNITS}symbol`));
      if (label) port.unitLabel = label;
    }
    const group = val(`${PG}group`);
    if (group && group.t !== 'lit') {
      port.group = termKey(group);
      if (!(port.group in groups)) {
        const g = {};
        const gs = one(port.group, `${LV2}symbol`);
        if (gs?.t === 'lit') g.symbol = gs.v;
        const gn = plainLiteral(all(port.group, `${LV2}name`)) ?? plainLiteral(all(port.group, `${RDFS}label`));
        if (gn) g.name = gn;
        const gp = Number(one(port.group, `${LV2}displayPriority`)?.v);
        if (Number.isInteger(gp)) g.displayPriority = gp;
        groups[port.group] = g;
      }
    }
    if (all(k, `${LV2}portProperty`).some((t) => t.v === `${PPROPS}notOnGUI`)) port.notOnGui = true;
    return port;
  });
  return { uri, ports: ports.sort((a, b) => a.index - b.index), groups };
}

/**
 * The plugin's own MOD GUI layout: the ports its `modgui:gui` names, in their order; null when the plugin has no
 * MOD GUI (the test omx-modgui-sync makes: a `modgui:gui` on the plugin's URI).
 * @returns {ModguiLayout | null}
 */
export function readModguiLayout(triples, uri) {
  const { all, one } = index(triples);
  const guis = all(uri, `${MODGUI}gui`);
  if (guis.length === 0) return null;
  const ports = guis.flatMap((gui) =>
    all(termKey(gui), `${MODGUI}port`).map((node) => {
      const k = termKey(node);
      return { symbol: one(k, `${LV2}symbol`)?.v ?? '', index: Number(one(k, `${LV2}index`)?.v), name: one(k, `${LV2}name`)?.v };
    }),
  );
  return { ports: ports.filter((p) => p.symbol !== '').sort((a, b) => a.index - b.index) };
}
